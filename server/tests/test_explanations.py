from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.support import BackendTest, app, clothes, store
from services import explanation_service as why


class ExplanationTests(BackendTest):
    """Catalog (see support.catalog): 1 and 2 are one product along x, 3 is (.8, .6),
    4 is y, 5 is -x, 6 is -y. Tags: 1, 2 shirt+black; 3 pants+black; 4 shirt+white;
    5 pants+white; 6 pants+black."""

    def explain(self, sources, liked, categories=(), user="alice"):
        return why.explain_batch(user, list(sources), sources, liked, list(categories),
                                 clothes._fetch_clothing_items)

    def setUp(self):
        super().setUp()
        # Explain every item so each case is observable; selection is tested on its own.
        patch.object(why, "REASON_SHARE", 1.0).start()

    def test_selection_is_a_stable_share_with_at_least_one_per_batch(self):
        with patch.object(why, "REASON_SHARE", 0.3):
            ids = list(range(1000))
            chosen = why.choose_explained("alice", ids)
            self.assertEqual(chosen, why.choose_explained("alice", ids))
            self.assertTrue(200 < len(chosen) < 400)
            # Another user gets a different selection.
            self.assertNotEqual(chosen, why.choose_explained("bob", ids))
        with patch.object(why, "REASON_SHARE", 0.0):
            self.assertEqual(len(why.choose_explained("alice", [1, 2, 3])), 1)
            self.assertEqual(why.choose_explained("alice", []), [])

    def test_exploit_item_names_the_closest_liked_item(self):
        reason = self.explain({1: "exploit"}, liked=[4, 3])[1]
        self.assertEqual(reason["kind"], "similar_to_like")
        self.assertEqual(reason["text"], "Because you liked Piece 3")
        self.assertEqual(reason["liked_item_id"], 3)
        self.assertEqual(reason["liked_item_img"], "https://example.test/3.jpg")

    def test_copies_of_the_same_product_are_not_used_as_the_reason(self):
        self.assertEqual(why.closest_liked(1, [2]), None)
        self.assertEqual(why.closest_liked(1, [2, 4])[0], 4)

    def test_one_liked_item_is_named_once_per_batch_then_tags_are_used(self):
        # 1 and 2 are both closest to liked 3, and both share "black" with likes 3 and 6.
        reasons = self.explain({1: "exploit", 2: "exploit"}, liked=[3, 6])
        self.assertEqual(reasons[1]["liked_item_id"], 3)
        self.assertEqual(why.closest_liked(2, [3, 6])[0], 3)
        # 3 was already named, so 2 falls back to the tag the user keeps liking.
        self.assertEqual(reasons[2]["kind"], "liked_tags")
        self.assertEqual(reasons[2]["tags"], ["black"])
        self.assertEqual(reasons[2]["text"], "You often like Black items")

    def test_shared_tags_are_ordered_by_how_often_they_were_liked(self):
        # Likes: black x3 (3, 6, 1), pants x2 (3, 6). Item 3 has both.
        counts = why.liked_tag_counts([3, 6, 1])
        self.assertEqual(why.shared_tags(3, counts), ["black", "pants"])

    def test_weak_link_with_no_shared_tags_gives_a_generic_taste_reason(self):
        reason = self.explain({5: "exploit"}, liked=[4])[5]
        self.assertEqual(reason["kind"], "close_to_taste")
        self.assertIsNone(reason["liked_item_id"])

    def test_exploration_and_cold_start_say_so(self):
        reasons = self.explain({4: "adjacent", 5: "random"}, liked=[1])
        self.assertEqual(reasons[4]["kind"], "adjacent")
        self.assertEqual(reasons[5]["kind"], "explore")
        cold = why.explain_batch("alice", [4], {}, [], [], clothes._fetch_clothing_items)
        self.assertEqual(cold[4]["kind"], "cold_start")

    def test_exploration_under_a_filter_names_the_filter(self):
        reason = self.explain({5: "random"}, liked=[1], categories=["pants"])[5]
        self.assertEqual(reason["kind"], "filter")
        self.assertEqual(reason["text"], "Matches your filter: Pants")

    def test_missing_liked_item_row_falls_back_to_generic_reason(self):
        store.rows["Clothing"] = [row for row in store.rows["Clothing"] if row["item_id"] != 3]
        reason = self.explain({1: "exploit"}, liked=[3])[1]
        self.assertEqual(reason["kind"], "close_to_taste")


class ExplanationApiTests(BackendTest):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def recommend(self):
        return self.client.post("/clothes/recommendations", json={"user_id": "alice", "n": 4})

    def test_personalised_feed_explains_some_items(self):
        self.react("Likes", "alice", 3)
        items = self.recommend().json()["recommendations"]
        explained = [i for i in items if i["reason"]]
        self.assertTrue(explained)
        for item in explained:
            self.assertIn(item["reason"]["kind"], {"similar_to_like", "liked_tags", "close_to_taste", "adjacent", "explore"})
            self.assertTrue(item["reason"]["text"])

    def test_cold_feed_explains_as_random(self):
        items = self.recommend().json()["recommendations"]
        self.assertTrue(items)
        self.assertEqual({i["reason"]["kind"] for i in items if i["reason"]}, {"cold_start"})

    def test_explanation_failure_still_returns_the_feed(self):
        with patch.object(clothes, "explain_batch", side_effect=RuntimeError("boom")):
            response = self.recommend()
        self.assertEqual(response.status_code, 200)
        items = response.json()["recommendations"]
        self.assertTrue(items)
        self.assertTrue(all(i["reason"] is None for i in items))
