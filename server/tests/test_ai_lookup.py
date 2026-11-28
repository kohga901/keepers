from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import os
import threading
from unittest.mock import patch

from fastapi.testclient import TestClient
import httpx

from tests.support import BackendTest, app, store
from services import ai_lookup_service as ai
from routers import ai as ai_router


IDENTIFIED = {"name": "Shirt & jacket", "brand": "unknown", "category": "tops",
              "colors": ["blue"], "identifiers": ["A/B"]}
OUTPUT = {"identifiedItem": IDENTIFIED, "searchSummary": "A blue shirt", "listings": [],
          "isPurchasableFashionItem": True}
RESULT = {"identifiedItem": IDENTIFIED, "searchSummary": "A blue shirt", "listings": [],
          "provider": "openai", "model": "test-model", "sources": [], "searchLinks": []}


class AiLookupTests(BackendTest):
    def setUp(self):
        super().setUp()
        patch.dict(os.environ, {"AI_LOOKUP_MODEL": "test-model", "OPENAI_API_KEY": "server-secret",
                                "GOOGLE_AI_API_KEY": "", "AI_LOOKUP_USER_DAILY_LIMIT": "20",
                                "AI_LOOKUP_DAILY_LIMIT": "500"}).start()
        with ai._lock:
            ai._cache.clear()
            ai._in_flight.clear()
            ai._user_usage.clear()
            ai._day, ai._total_usage = None, 0
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def lookup(self, item=1, token="alice-token", **extra):
        return self.client.post("/ai/lookup", json={"item_id": item, **extra},
                                headers={"Authorization": f"Bearer {token}"} if token else {})

    def test_verified_user_and_catalog_are_required_and_client_cannot_choose_keys_or_images(self):
        with patch.object(ai, "_lookup_provider", return_value=RESULT) as provider:
            for token in (None, "expired"):
                self.assertEqual(self.lookup(token=token).status_code, 401)
            self.assertEqual(self.lookup(999).status_code, 404)
            for body in ({"image_url": "https://attacker.test/a"}, {"provider": "google"},
                         {"api_key": "client-secret"}, {"user_id": "bob"}, {"max_results": 9}):
                self.assertEqual(self.lookup(**body).status_code, 422)
            provider.assert_not_called()
            response = self.lookup()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), RESULT)
            self.assertEqual(provider.call_args.args, ("openai", "test-model", "server-secret",
                             "https://example.test/1.jpg", "Piece 1", 5))

    def test_cache_is_shared_across_users_expires_and_separates_model_and_max_results(self):
        with patch.object(ai, "_lookup_provider", return_value=RESULT) as provider:
            self.assertEqual(self.lookup().status_code, 200)
            self.assertEqual(self.lookup(token="bob-token").status_code, 200)
            self.assertEqual(provider.call_count, 1)
            self.assertEqual(self.lookup(max_results=2).status_code, 200)
            with patch.dict(os.environ, {"AI_LOOKUP_MODEL": "other-model"}):
                self.assertEqual(self.lookup().status_code, 200)
            with ai._lock:
                for key, (_, result) in list(ai._cache.items()):
                    ai._cache[key] = (0, result)
            with patch.object(ai.time, "monotonic", return_value=ai.CACHE_TTL + 1):
                self.assertEqual(self.lookup().status_code, 200)
            self.assertEqual(provider.call_count, 4)

    def test_simultaneous_users_share_one_paid_lookup(self):
        entered, release = threading.Event(), threading.Event()
        def provider(*args):
            entered.set()
            self.assertTrue(release.wait(timeout=5))
            return RESULT
        with patch.object(ai, "_lookup_provider", side_effect=provider) as paid, ThreadPoolExecutor(2) as pool:
            first = pool.submit(ai.lookup_item, "alice", store.rows["Clothing"][0])
            self.assertTrue(entered.wait(timeout=5))
            second = pool.submit(ai.lookup_item, "bob", store.rows["Clothing"][0])
            release.set()
            self.assertEqual(first.result(timeout=5), RESULT)
            self.assertEqual(second.result(timeout=5), RESULT)
            self.assertEqual(paid.call_count, 1)
            self.assertEqual(ai._in_flight, {})

    def test_limits_apply_to_verified_users_and_global_limit_allows_cached_results(self):
        with patch.object(ai, "_lookup_provider", return_value=RESULT) as paid, \
                patch.dict(os.environ, {"AI_LOOKUP_USER_DAILY_LIMIT": "2", "AI_LOOKUP_DAILY_LIMIT": "1"}):
            self.assertEqual(self.lookup().status_code, 200)
            self.assertEqual(self.lookup().status_code, 200)
            self.assertEqual(self.lookup().json(), {"detail": {"code": "quota"}})
            self.assertEqual(self.lookup(token="bob-token").status_code, 200)
            response = self.lookup(3, token="bob-token")
            self.assertEqual(response.status_code, 429)
            self.assertIn("Retry-After", response.headers)
            self.assertEqual(paid.call_count, 1)

    def test_missing_configuration_and_failures_are_safe_and_retryable(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "", "GOOGLE_AI_API_KEY": ""}), patch.object(ai, "_lookup_provider") as paid:
            response = self.lookup()
            self.assertEqual(response.status_code, 503)
            paid.assert_not_called()
        with patch.dict(os.environ, {"GOOGLE_AI_API_KEY": ""}), \
                patch.object(ai, "_lookup_provider", side_effect=[ai.LookupError("quota", 429), RESULT]):
            self.assertEqual(self.lookup().status_code, 429)
            self.assertEqual(self.lookup().status_code, 200)
        with patch.object(ai, "_lookup_provider", side_effect=RuntimeError("server-secret")):
            with self.assertLogs("routers.ai", level="ERROR") as logs:
                response = self.lookup(3)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("server-secret", response.text + "".join(logs.output))

    def test_utc_day_rollover_resets_usage_and_busy_requests_do_not_spend_global_allowance(self):
        with patch.object(ai, "_lookup_provider", return_value=RESULT) as paid, \
                patch.dict(os.environ, {"AI_LOOKUP_USER_DAILY_LIMIT": "1", "AI_LOOKUP_DAILY_LIMIT": "1"}):
            self.assertEqual(self.lookup().status_code, 200)
            self.assertEqual(self.lookup().status_code, 429)
            with ai._lock:
                ai._day -= timedelta(days=1)
            self.assertEqual(self.lookup(3).status_code, 200)
            self.assertEqual(paid.call_count, 2)
        with ai._lock:
            ai._in_flight.update({("busy", index): object() for index in range(ai.MAX_IN_FLIGHT)})
        with patch.dict(os.environ, {"AI_LOOKUP_USER_DAILY_LIMIT": "20", "AI_LOOKUP_DAILY_LIMIT": "500"}):
            response = self.lookup(4)
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.json(), {"detail": {"code": "busy"}})
            self.assertEqual(ai._total_usage, 1)

    def test_lookup_does_not_depend_on_recommendation_index_warmup(self):
        from services import Startup
        Startup.ready = False
        with patch.object(ai, "_lookup_provider", return_value=RESULT):
            self.assertEqual(self.lookup().status_code, 200)

    def provider_call(self, name, handler):
        transport = httpx.MockTransport(handler)
        original_client = httpx.Client
        with patch.object(ai.httpx, "Client", side_effect=lambda **kwargs: original_client(transport=transport, **kwargs)):
            return ai._lookup_provider(name, "test-model", "server-secret", "https://example.test/image.jpg", "Shirt", 2)

    def test_google_identification_produces_encoded_marketplace_searches(self):
        output = {"identifiedItem": IDENTIFIED, "searchSummary": "A blue shirt", "isPurchasableFashionItem": True}
        def handler(request):
            self.assertEqual(request.headers["x-goog-api-key"], "server-secret")
            payload = json.loads(request.content)
            self.assertEqual(payload["contents"][0]["parts"][0]["inlineData"]["data"], "aW1hZ2U=")
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(output)}]}}]})
        with patch.object(ai, "_image_data", return_value={"mimeType": "image/jpeg", "data": "aW1hZ2U="}):
            result = self.provider_call("google", handler)
            self.assertEqual(result["listings"], [])
            self.assertEqual(len(result["searchLinks"]), 2)
            self.assertIn("Shirt%20%26%20jacket%20A%2FB%20blue", result["searchLinks"][0]["url"])
            output["isPurchasableFashionItem"] = False
            self.assertEqual(self.provider_call("google", handler)["searchLinks"], [])

    def test_default_provider_uses_terra_server_key_search_schema_and_citations(self):
        def handler(request):
            self.assertEqual(str(request.url), "https://api.openai.com/v1/responses")
            self.assertEqual(request.headers["Authorization"], "Bearer server-secret")
            payload = json.loads(request.content)
            self.assertEqual(payload["model"], "gpt-6.1-terra")
            self.assertEqual(payload["reasoning"], {"effort": "low"})
            self.assertFalse(payload["store"])
            self.assertEqual(payload["tools"][0]["type"], "web_search")
            self.assertEqual(payload["tool_choice"], "required")
            self.assertEqual(payload["input"][0]["content"][0],
                             {"type": "input_image", "image_url": "https://example.test/1.jpg"})
            self.assertEqual(payload["text"]["format"]["schema"]["additionalProperties"], False)
            return httpx.Response(200, json={"status": "completed", "output": [
                {"type": "message", "content": [{"type": "output_text", "text": json.dumps(OUTPUT),
                  "annotations": [{"url": "https://shop.test/item", "title": "Source"}]}]}]})
        transport = httpx.MockTransport(handler)
        original_client = httpx.Client
        with patch.dict(os.environ, {"OPENAI_API_KEY": "server-secret"}), \
                patch.object(ai.httpx, "Client", side_effect=lambda **kwargs: original_client(transport=transport, **kwargs)):
            os.environ.pop("AI_LOOKUP_PROVIDER", None)
            os.environ.pop("AI_LOOKUP_MODEL", None)
            response = self.lookup()
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["provider"], "openai")
        self.assertEqual(result["model"], "gpt-6.1-terra")
        self.assertEqual(result["sources"], [{"url": "https://shop.test/item", "title": "Source"}])

    def test_openai_identification_builds_links_without_calling_gemini_even_with_no_listings(self):
        listing = {"title": "Shirt", "url": "https://shop.test/item", "seller": "Shop",
                   "displayedPrice": "$35", "condition": "new", "matchType": "similar",
                   "confidence": .6, "evidence": "Same cut"}
        original_client = httpx.Client
        for item_id, listings in enumerate(([], [listing]), start=1):
            calls = []
            def handler(request):
                calls.append(str(request.url))
                self.assertEqual(str(request.url), "https://api.openai.com/v1/responses")
                return httpx.Response(200, json={"status": "completed", "output": [
                    {"type": "message", "content": [{"type": "output_text",
                        "text": json.dumps({**OUTPUT, "listings": listings})}]}]})
            transport = httpx.MockTransport(handler)
            with patch.dict(os.environ, {"GOOGLE_AI_API_KEY": "google-secret"}), \
                    patch.object(ai.httpx, "Client", side_effect=lambda **kwargs: original_client(transport=transport, **kwargs)):
                response = self.lookup(item_id)
                self.assertEqual(response.status_code, 200)
                result = response.json()
                self.assertEqual(result["provider"], "openai")
                self.assertEqual(result["identifiedItem"], IDENTIFIED)
                self.assertEqual(result["listings"], [{**item, "sourceBacked": False} for item in listings])
                self.assertEqual(len(result["searchLinks"]), 5)
                self.assertEqual(result["searchLinks"][1]["url"],
                                 "https://www.ebay.com/sch/i.html?_nkw=Shirt%20%26%20jacket%20A%2FB%20blue")
                self.assertNotIn("isPurchasableFashionItem", result)
                self.assertEqual(self.lookup(item_id, token="bob-token").json(), response.json())
                self.assertEqual(calls, ["https://api.openai.com/v1/responses"])
                self.assertEqual(ai._total_usage, item_id)

    def test_generated_links_omit_unknown_details_and_respect_result_limit(self):
        item = ai.IdentifiedItem.model_validate({**IDENTIFIED, "brand": "  unknown ",
                                               "name": " Shirt   & jacket ",
                                               "identifiers": ["A/B", "unknown"], "colors": ["blue", "blue"]})
        links = ai._marketplace_links(item, 2)
        self.assertEqual([link["marketplace"] for link in links], ["Google Shopping", "eBay"])
        self.assertEqual(links[0]["query"], "Shirt & jacket A/B blue")
        unknown = ai.IdentifiedItem.model_validate({**IDENTIFIED, "name": "unknown",
                                                  "identifiers": [], "colors": []})
        self.assertEqual(ai._marketplace_links(unknown, 5), [])

    def test_nonfashion_openai_identification_does_not_generate_marketplace_links(self):
        def handler(request):
            return httpx.Response(200, json={"status": "completed", "output": [
                {"type": "message", "content": [{"type": "output_text",
                    "text": json.dumps({**OUTPUT, "isPurchasableFashionItem": False})}]}]})
        result = self.provider_call("openai", handler)
        self.assertEqual(result["searchLinks"], [])

    def test_missing_google_key_uses_only_openai(self):
        with patch.dict(os.environ, {"GOOGLE_AI_API_KEY": "", "AI_LOOKUP_PROVIDER": "google"}), \
                patch.object(ai, "_lookup_provider", return_value=RESULT) as paid:
            self.assertEqual(self.lookup().json(), RESULT)
            self.assertEqual(paid.call_count, 1)
            self.assertEqual(paid.call_args.args[0], "openai")

    def test_provider_failures_fall_back_once_without_spending_another_lookup_allowance(self):
        fallback = {**RESULT, "provider": "google", "model": "gemini-3.5-flash-lite"}
        for item, code in enumerate(("timeout", "network", "quota", "unavailable", "unknown"), start=1):
            with patch.dict(os.environ, {"GOOGLE_AI_API_KEY": "google-secret"}), \
                    patch.object(ai, "_lookup_provider", side_effect=[ai.LookupError(code), fallback]) as paid:
                response = self.lookup(item)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), fallback)
                self.assertEqual([call.args[0] for call in paid.call_args_list], ["openai", "google"])
                self.assertEqual(paid.call_args.args[1:3], ("gemini-3.5-flash-lite", "google-secret"))
                self.assertEqual(ai._total_usage, item)
                self.assertEqual(ai._user_usage["alice"], item)

    def test_fallback_cache_is_brief_and_openai_is_retried_after_expiry(self):
        fallback = {**RESULT, "provider": "google"}
        with patch.dict(os.environ, {"GOOGLE_AI_API_KEY": "google-secret"}), \
                patch.object(ai, "_lookup_provider", side_effect=[ai.LookupError("timeout"), fallback, RESULT]) as paid:
            self.assertEqual(self.lookup().json(), fallback)
            self.assertEqual(self.lookup(token="bob-token").json(), fallback)
            self.assertEqual(paid.call_count, 2)
            cached_at = next(iter(ai._cache.values()))[0]
            with patch.object(ai.time, "monotonic", return_value=cached_at + ai.FALLBACK_CACHE_TTL + 1):
                self.assertEqual(self.lookup().json(), RESULT)
            self.assertEqual([call.args[0] for call in paid.call_args_list], ["openai", "google", "openai"])

    def test_missing_primary_key_uses_google_and_both_provider_failures_remain_retryable(self):
        fallback = {**RESULT, "provider": "google"}
        with patch.dict(os.environ, {"OPENAI_API_KEY": "", "GOOGLE_AI_API_KEY": "google-secret"}), \
                patch.object(ai, "_lookup_provider", return_value=fallback) as paid:
            self.assertEqual(self.lookup().json(), fallback)
            self.assertEqual(paid.call_count, 1)
            self.assertEqual(paid.call_args.args[0], "google")
        with patch.dict(os.environ, {"GOOGLE_AI_API_KEY": "google-secret"}), \
                patch.object(ai, "_lookup_provider", side_effect=[
                    ai.LookupError("timeout", 504), ai.LookupError("unavailable", 503), RESULT]) as paid:
            self.assertEqual(self.lookup(3).status_code, 503)
            self.assertEqual(self.lookup(3).json(), RESULT)
            self.assertEqual(paid.call_count, 3)

    def test_provider_errors_and_invalid_output_never_expose_raw_response(self):
        for status, code in [(401, "unavailable"), (404, "unavailable"), (429, "quota"), (500, "unknown")]:
            with self.assertLogs("services.ai_lookup_service", level="WARNING") as logs, self.assertRaises(ai.LookupError) as raised:
                self.provider_call("openai", lambda request: httpx.Response(status, text="server-secret"))
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn("server-secret", str(raised.exception) + "".join(logs.output))
        for content in ({"status": "incomplete"}, {"status": "completed", "output": []}):
            with self.assertRaises(ai.LookupError):
                self.provider_call("openai", lambda request: httpx.Response(200, json=content))
        def timeout(request):
            raise httpx.ReadTimeout("server-secret", request=request)
        with self.assertRaises(ai.LookupError) as raised:
            self.provider_call("openai", timeout)
        self.assertEqual(raised.exception.code, "timeout")

    def test_listing_validation_removes_unsafe_urls_duplicates_and_requires_actual_citation(self):
        listing = {"title": "Shirt", "url": "https://shop.test/1", "seller": "Shop", "displayedPrice": "$35",
                   "condition": "new", "matchType": "similar", "confidence": .6, "evidence": "Same cut"}
        output = ai.SearchOutput.model_validate({**OUTPUT, "listings": [
            {**listing, "url": url} for url in ("http://shop.test/unsafe", "javascript:alert(1)",
                "https://shop.test/1", "https://shop.test/1", "https://shop.test/2", "https://shop.test.evil.test/3")]})
        result = ai._purchase_result("openai", "test-model", output, [
            {"url": "https://shop.test/1", "title": "Source"}, {"url": "http://unsafe.test"}, None], 3)
        self.assertEqual([item["sourceBacked"] for item in result["listings"]], [True, False, False])
        self.assertEqual(len(result["sources"]), 1)

    def test_google_image_download_rejects_private_hosts_redirects_non_images_and_large_files(self):
        with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200))) as client, \
                patch.object(ai.socket, "getaddrinfo", return_value=[(0, 0, 0, "", ("127.0.0.1", 443))]):
            with self.assertRaises(ai.LookupError):
                ai._image_data(client, "https://localhost/image")
        addresses = [(0, 0, 0, "", ("8.8.8.8", 443))]
        for response in [httpx.Response(302, headers={"location": "https://localhost/image"}),
                         httpx.Response(200, headers={"content-type": "text/html"}, content=b"html"),
                         httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"x" * (8 * 1024 * 1024 + 1))]:
            with httpx.Client(transport=httpx.MockTransport(lambda req: response)) as client, \
                    patch.object(ai.socket, "getaddrinfo", return_value=addresses):
                with self.assertRaises(ai.LookupError):
                    ai._image_data(client, "https://example.test/image")

    def test_image_download_pins_validated_ip_and_preserves_tls_hostname(self):
        def handler(request):
            self.assertEqual(request.url.host, "8.8.8.8")
            self.assertEqual(request.headers["host"], "example.test")
            self.assertEqual(request.extensions["sni_hostname"], "example.test")
            self.assertEqual(request.headers["accept-encoding"], "identity")
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"image")
        with httpx.Client(transport=httpx.MockTransport(handler)) as client, \
                patch.object(ai.socket, "getaddrinfo", return_value=[(0, 0, 0, "", ("8.8.8.8", 443))]) as dns:
            self.assertEqual(ai._image_data(client, "https://example.test/image")["data"], "aW1hZ2U=")
            dns.assert_called_once()

    def test_empty_bearer_never_uses_an_implicit_server_session(self):
        with patch.object(store.auth, "get_user", return_value=type("Session", (), {
                "user": type("User", (), {"id": "alice"})()})()) as auth, \
                patch.object(ai, "_lookup_provider", return_value=RESULT) as paid:
            self.assertEqual(self.lookup(token="   ").status_code, 401)
            auth.assert_not_called()
            paid.assert_not_called()

    def test_request_integers_are_strict_and_bounded(self):
        with patch.object(ai, "_lookup_provider") as paid:
            for item in (True, "1", 1.0, 2 ** 63):
                self.assertEqual(self.lookup(item).status_code, 422)
            for count in (True, "2", 2.0):
                self.assertEqual(self.lookup(max_results=count).status_code, 422)
            paid.assert_not_called()

    def test_malformed_provider_envelopes_trigger_safe_fallback(self):
        for body in ([], None, {"status": "completed", "output": [None]},
                     {"status": "completed", "output": [{"type": "message", "content": [None]}]}):
            with self.assertRaises(ai.LookupError) as raised:
                self.provider_call("openai", lambda request: httpx.Response(200, json=body))
            self.assertEqual(raised.exception.code, "unknown")

    def test_busy_lookup_rejects_before_authentication_and_always_releases_capacity(self):
        slots = threading.BoundedSemaphore(1)
        with patch.object(ai_router, "_request_slots", slots), \
                patch.object(store.auth, "get_user", wraps=store.auth.get_user) as auth, \
                patch.object(ai, "_lookup_provider", return_value=RESULT):
            slots.acquire()
            try:
                response = self.lookup()
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.json(), {"detail": {"code": "busy"}})
                auth.assert_not_called()
            finally:
                slots.release()
            self.assertEqual(self.lookup(token="expired").status_code, 401)
            self.assertEqual(self.lookup().status_code, 200)

    def test_image_dns_rejects_mixed_public_private_and_ipv6_addresses(self):
        for ips in (("8.8.8.8", "10.0.0.1"), ("::1",), ("::ffff:127.0.0.1",), ("169.254.169.254",), ()):
            with self.subTest(ips=ips), \
                    httpx.Client(transport=httpx.MockTransport(lambda req: self.fail("Unsafe image fetched"))) as client, \
                    patch.object(ai.socket, "getaddrinfo", return_value=[(0, 0, 0, "", (ip, 443)) for ip in ips]):
                with self.assertRaises(ai.LookupError) as raised:
                    ai._image_data(client, "https://example.test/image")
                self.assertEqual(raised.exception.code, "invalid_image")

    def test_image_stream_is_time_bounded_and_rejects_compression(self):
        addresses = [(0, 0, 0, "", ("8.8.8.8", 443))]
        for headers, code in (({"content-type": "image/jpeg", "content-encoding": "gzip"}, "invalid_image"),
                              ({"content-type": "image/jpeg"}, "timeout")):
            response = httpx.Response(200, headers=headers, stream=httpx.ByteStream(b"image"))
            with httpx.Client(transport=httpx.MockTransport(lambda req: response)) as client, \
                    patch.object(ai.socket, "getaddrinfo", return_value=addresses), \
                    patch.object(ai.time, "monotonic", side_effect=[0, 16]):
                with self.assertRaises(ai.LookupError) as raised:
                    ai._image_data(client, "https://example.test/image")
                self.assertEqual(raised.exception.code, code)

    def test_cache_wait_timeout_is_reported_as_timeout(self):
        from concurrent.futures import Future
        waiting = Future()
        with patch.object(ai, "_lookup_provider", return_value=RESULT):
            self.assertEqual(self.lookup().status_code, 200)
        with ai._lock:
            cache_key = next(iter(ai._cache))
            ai._cache.clear()
            ai._in_flight[cache_key] = waiting
        with patch.object(waiting, "result", side_effect=TimeoutError):
            response = self.lookup()
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json(), {"detail": {"code": "timeout"}})

    def test_provider_clients_ignore_environment_proxies_and_credentials(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(500))
        original_client = httpx.Client
        with patch.object(ai.httpx, "Client", side_effect=lambda **kwargs: original_client(transport=transport, **kwargs)) as client:
            with self.assertRaises(ai.LookupError):
                ai._lookup_provider("openai", "test-model", "server-secret", "https://example.test/image", "Shirt", 2)
            self.assertFalse(client.call_args.kwargs["trust_env"])
