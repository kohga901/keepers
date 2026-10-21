from concurrent.futures import ThreadPoolExecutor
import threading
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np

from tests.support import BackendTest, Startup, app, clothes, store, user_state, vector


class ClothesApiTests(BackendTest):
    def setUp(self):
        super().setUp()
        # No context manager: do not run the live database startup lifespan.
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def recommend(self, user="alice", n=10, tags=None):
        return self.client.post("/clothes/recommendations", json={"user_id": user, "n": n, "categories": tags or []})

    def swipe(self, item, liked=True, user="alice"):
        return self.client.post("/clothes/swipe", json={"user_id": user, "item_id": item, "liked": liked})

    def clear(self, scope, token="alice-token", **extra):
        return self.client.post("/clothes/history/clear", json={"scope": scope, **extra},
                                headers={"Authorization": f"Bearer {token}"} if token else {})

    def test_cold_feed_attaches_tags_collapses_products_and_never_resends_a_batch(self):
        first = self.recommend(n=2)
        self.assertEqual(first.status_code, 200)
        items = first.json()["recommendations"]
        self.assertEqual(len(items), 2)
        for item in items:
            self.assertEqual(item["item_tags"], sorted(Startup.item_tags[item["item_id"]]))
            self.assertTrue(item["item_img"].startswith("https://"))
        seen = set().union(*(set(Startup.duplicates_of(i["item_id"])) for i in items))
        second = self.recommend().json()["recommendations"]
        self.assertFalse(seen & {i["item_id"] for i in second})
        self.assertEqual(len(items) + len(second), 5)
        self.assertEqual(self.recommend().json(), {"recommendations": []})

    def test_filtered_personalized_feed_excludes_swipes_and_records_filter_exposure(self):
        self.react("Likes", "alice", 1)
        self.react("Dislikes", "alice", 6)
        response = self.recommend(tags=["pants", "black"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["item_id"] for item in response.json()["recommendations"]], [3])
        self.assertEqual(user_state.filtered_ids("alice"), {3})
        self.assertEqual(self.recommend(tags=["missing"]).json(), {"recommendations": []})

    def test_database_row_order_cannot_change_recommendation_order(self):
        # Database IN queries do not promise the ranking order requested by the app.
        self.assertEqual([i["item_id"] for i in clothes._fetch_clothing_items([6, 3, 1])], [6, 3, 1])

    def test_simultaneous_requests_for_one_user_cannot_receive_the_same_product(self):
        barrier = threading.Barrier(2)
        def request():
            with TestClient(app, raise_server_exceptions=False) as client:
                # Override lifespan below so both clients only exercise requests.
                barrier.wait(timeout=5)
                response = client.post("/clothes/recommendations", json={"user_id": "alice", "n": 2})
                self.assertEqual(response.status_code, 200)
                return {copy for i in response.json()["recommendations"] for copy in Startup.duplicates_of(i["item_id"])}
        # Client context would otherwise launch the real boot thread.
        from contextlib import asynccontextmanager
        @asynccontextmanager
        async def no_startup(app):
            yield
        with patch.object(app.router, "lifespan_context", no_startup), ThreadPoolExecutor(max_workers=2) as pool:
            a, b = list(pool.map(lambda _: request(), range(2)))
        self.assertTrue(a and b)
        self.assertFalse(a & b)

    def test_swipes_persist_train_and_undo_without_changing_another_users_history(self):
        user_state.snapshot("alice")
        self.react("Likes", "bob", 1)
        for item, liked in [(1, True), (3, True), (4, False), (5, True)]:
            self.assertEqual(self.swipe(str(item), liked).status_code, 200)
        self.assertEqual(self.ids("Likes"), [1, 3, 5])
        self.assertEqual(self.ids("Dislikes"), [4])
        pref = store.rows["User_Preferences"][0]["pref_vec"]
        self.assertAlmostEqual(float(np.linalg.norm(pref)), 1, places=5)
        self.assertEqual(self.swipe(1, False).status_code, 200)
        self.assertEqual(self.ids("Likes"), [3, 5])
        self.assertEqual(self.ids("Dislikes"), [4, 1])
        response = self.client.delete("/clothes/disliked/alice/1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.ids("Dislikes"), [4])
        self.assertEqual(self.ids("Likes", "bob"), [1])
        self.assertTrue({1, 2} <= user_state.snapshot("alice")[2])

    def test_failed_swipe_does_not_train_the_cache_and_can_be_retried(self):
        user_state.snapshot("alice")
        store.failure = ("Likes", "upsert")
        with self.assertLogs("db", level="WARNING"):
            self.assertEqual(self.swipe(1).status_code, 500)
        self.assertEqual(user_state.snapshot("alice"), ([], [], set()))
        store.failure = None
        self.assertEqual(self.swipe(1).status_code, 200)
        self.assertEqual(self.ids("Likes"), [1])

    def test_failed_catalog_read_does_not_mark_items_served(self):
        store.failure = ("Clothing", "select")
        with self.assertLogs("db", level="WARNING"):
            self.assertEqual(self.recommend().status_code, 500)
        self.assertEqual(user_state.snapshot("alice")[2], set())
        store.failure = None
        self.assertEqual(len(self.recommend().json()["recommendations"]), 5)

    def test_clear_all_uses_verified_identity_and_resets_history_taste_and_served_state(self):
        for user in ("alice", "bob"):
            self.react("Likes", user, 1)
            self.react("Dislikes", user, 4)
            store.rows["User_Preferences"].append({"user_id": user, "pref_vec": vector(1).tolist()})
            store.rows["Coordinates"].append({"user_id": user, "x": 10, "y": 20})
            user_state.snapshot(user)
            user_state.mark_served(user, [3], filtered=True)
        self.assertEqual(self.clear("all", user_id="bob").status_code, 200)
        self.assertEqual(self.ids("Likes"), [])
        self.assertEqual(self.ids("Dislikes"), [])
        self.assertEqual(user_state.snapshot("alice"), ([], [], set()))
        self.assertEqual(self.ids("Likes", "bob"), [1])
        self.assertEqual(self.ids("Dislikes", "bob"), [4])
        for table in ("Coordinates", "User_Preferences"):
            self.assertEqual([row["user_id"] for row in store.rows[table]], ["bob"])
        self.assertEqual(user_state.filtered_ids("alice"), set())

    def test_clearing_one_history_preserves_the_other_and_rebuilds_taste(self):
        self.react("Likes", "alice", 1)
        self.react("Dislikes", "alice", 4)
        self.assertEqual(self.clear("disliked").status_code, 200)
        self.assertEqual(self.ids("Likes"), [1])
        self.assertEqual(self.ids("Dislikes"), [])
        np.testing.assert_allclose(store.rows["User_Preferences"][0]["pref_vec"], vector(1))
        self.react("Dislikes", "alice", 5)
        self.assertEqual(self.clear("liked").status_code, 200)
        self.assertEqual(self.ids("Likes"), [])
        self.assertEqual(self.ids("Dislikes"), [5])
        self.assertEqual(store.rows["User_Preferences"], [])
        self.assertEqual(store.rows["Coordinates"], [])

    def test_clear_rejects_invalid_tokens_and_scope_without_mutating_data(self):
        self.react("Likes", "alice", 1)
        for token in (None, "expired"):
            self.assertEqual(self.clear("all", token).status_code, 401)
        self.assertEqual(self.clear("everything").status_code, 422)
        self.assertEqual(self.ids("Likes"), [1])

    def test_warmup_and_malformed_requests_are_rejected_without_writes(self):
        Startup.ready = False
        self.assertEqual(self.recommend().status_code, 503)
        self.assertEqual(self.swipe(1).status_code, 503)
        self.assertEqual(self.client.get("/clothes/tags").status_code, 503)
        Startup.ready = True
        self.assertEqual(self.swipe("not-an-id").status_code, 422)
        self.assertEqual(self.client.post("/clothes/swipe", json={"item_id": 1}).status_code, 422)
        self.assertEqual(store.rows["Likes"], [])

    def test_tag_picker_only_lists_populated_tags_in_category_then_name_order(self):
        tags = self.client.get("/clothes/tags").json()["tags"]
        self.assertEqual([tag["Tag"] for tag in tags], ["black", "white", "pants", "shirt"])

    @unittest.expectedFailure
    def test_regression_cold_cache_dislike_to_like_removes_opposite_database_row(self):
        # BUG: loading after the new like is written hides the earlier dislike
        # from record_swipe(), so switched=False and the DB cleanup is skipped.
        self.react("Dislikes", "alice", 1)
        self.assertEqual(self.swipe(1, True).status_code, 200)
        self.assertEqual(self.ids("Likes"), [1])
        self.assertEqual(self.ids("Dislikes"), [])

    @unittest.expectedFailure
    def test_regression_negative_recommendation_count_is_a_client_error(self):
        self.assertEqual(self.recommend(n=-1).status_code, 422)

    @unittest.expectedFailure
    def test_regression_swipe_cannot_write_another_users_history_without_a_token(self):
        # Unlike clear_history, this route trusts the user_id supplied by a caller.
        self.assertEqual(self.swipe(1, user="bob").status_code, 401)
        self.assertEqual(self.ids("Likes", "bob"), [])
