import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.support import BackendTest, Startup, app, store, vector


class CatalogMaintenanceTests(BackendTest):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def test_hosted_server_rejects_uploads_and_relabels_without_mutating_catalog(self):
        self.assertEqual(self.client.post("/admin/upload", json={"items": [{"item_name": "Shirt", "item_img": "https://images.test/1"}]}).status_code, 503)
        self.assertEqual(self.client.post("/relabel/submit", json={"item_id": 1, "item_tags": []}).status_code, 503)
        self.assertEqual(len(store.rows["Clothing"]), 6)
        self.assertEqual(len(store.rows["Tagged_Clothing"]), 12)

    def test_upload_isolates_invalid_items_and_immediately_updates_recommendations_and_filters(self):
        patch.dict(os.environ, {"ENABLE_ADMIN_UPLOAD": "1"}).start()
        def embed(url):
            if url.endswith("bad"):
                raise ValueError("Image could not be decoded")
            return vector(.5, .5)
        items = [
            {"item_name": "Unknown tag", "item_img": "https://images.test/1", "item_tags": ["invented"]},
            {"item_name": "Bad image", "item_img": "https://images.test/bad"},
            {"item_name": "New shirt", "item_img": "https://images.test/good", "item_tags": ["shirt", "white"]},
        ]
        with patch("services.clip_service.embed_image_url", side_effect=embed), self.assertLogs(level="ERROR"):
            response = self.client.post("/admin/upload", json={"items": items})
        self.assertEqual(response.status_code, 200)
        results = response.json()["results"]
        self.assertEqual([row["status"] for row in results], ["error", "error", "ok"])
        self.assertIn("Unknown tag", results[0]["error"])
        self.assertEqual(results[2]["item_id"], 7)
        self.assertEqual([row["item_name"] for row in store.rows["Clothing"][-1:]], ["New shirt"])
        self.assertEqual([row["item_id"] for row in store.rows["Embeddings"]], [7])
        self.assertEqual(Startup.resolve_filter(["shirt", "white"]), {4, 7})
        self.assertEqual(Startup.index.ntotal, 7)

    def test_relabel_replaces_persisted_tags_and_live_filter_memberships(self):
        patch.dict(os.environ, {"ENABLE_ADMIN_UPLOAD": "1"}).start()
        response = self.client.post("/relabel/submit", json={"item_id": 4, "item_tags": ["pants", "black", "black"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item_tags"], ["pants", "black"])
        self.assertEqual({row["Tag"] for row in store.rows["Tagged_Clothing"] if row["clothes_id"] == 4}, {"pants", "black"})
        self.assertEqual(store.rows["Relabeled_Clothing"], [{"clothes_id": 4}])
        self.assertEqual(Startup.resolve_filter(["shirt", "white"]), set())
        self.assertIn(4, Startup.resolve_filter(["pants", "black"]))

    def test_invalid_relabel_cannot_delete_existing_tags(self):
        patch.dict(os.environ, {"ENABLE_ADMIN_UPLOAD": "1"}).start()
        before = list(store.rows["Tagged_Clothing"])
        self.assertEqual(self.client.post("/relabel/submit", json={"item_id": 4, "item_tags": ["invented"]}).status_code, 400)
        self.assertEqual(self.client.post("/relabel/submit", json={"item_id": 999, "item_tags": ["black"]}).status_code, 404)
        self.assertEqual(store.rows["Tagged_Clothing"], before)
        self.assertEqual(store.rows["Relabeled_Clothing"], [])
