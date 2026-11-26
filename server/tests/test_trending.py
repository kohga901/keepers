from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.support import BackendTest, Startup, app, clothes, store
from services import trending_service


def days_ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


class InlineThread:
    """Stands in for threading.Thread so a background refresh runs at start(), deterministically."""
    def __init__(self, target, daemon=None):
        self.target = target

    def start(self):
        self.target()


class TrendingTests(BackendTest):
    def setUp(self):
        super().setUp()
        trending_service.clear_cache()
        self.addCleanup(trending_service.clear_cache)
        self.client = TestClient(app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def like(self, item, *users, age_days=1):
        store.rows["Likes"].extend({"user_id": u, "clothes_id": item, "created_at": days_ago(age_days)} for u in users)

    def recommend(self, user="zoe", n=3, tags=None):
        response = self.client.post("/clothes/recommendations", json={"user_id": user, "n": n, "categories": tags or []})
        self.assertEqual(response.status_code, 200)
        return response.json()["recommendations"]

    def trending_of(self, items):
        flagged = [i for i in items if i["is_trending"]]
        self.assertLessEqual(len(flagged), 1, "a batch has at most one trending item")
        return flagged[0] if flagged else None

    # --- Ranking ---

    def test_rank_counts_distinct_users_combines_copies_and_needs_two_likes(self):
        rows = [{"user_id": u, "clothes_id": i, "created_at": days_ago(1)} for u, i in (
            ("alice", 1), ("carol", 1), ("bob", 2), ("alice", 2),   # product {1, 2}: 3 users
            ("alice", 4), ("bob", 4),                               # 2 users
            ("alice", 3),                                           # 1 user: not trending
        )]
        # Product {1, 2} is shown as copy 1, which has the most likes.
        self.assertEqual(trending_service.rank(rows), [(1, 3), (4, 2)])

    def test_rank_ties_go_to_the_most_recently_liked_product(self):
        rows = [{"user_id": u, "clothes_id": i, "created_at": days_ago(age)} for u, i, age in (
            ("alice", 4, 3), ("bob", 4, 3), ("alice", 6, 1), ("bob", 6, 1))]
        self.assertEqual([i for i, _ in trending_service.rank(rows)], [6, 4])

    def test_rank_ignores_malformed_rows_and_respects_the_window(self):
        rows = [
            {"user_id": "alice", "clothes_id": 4, "created_at": days_ago(1)},
            {"user_id": "bob", "clothes_id": 4, "created_at": "not a date"},
            {"user_id": "carol", "clothes_id": 4, "created_at": None},
            {"user_id": None, "clothes_id": 4, "created_at": days_ago(1)},
            {"user_id": "dave", "clothes_id": 4, "created_at": days_ago(10)},
        ]
        since = datetime.now(timezone.utc) - timedelta(days=7)
        self.assertEqual(trending_service.rank(rows, since=since), [])   # Only alice is valid and recent.
        self.assertEqual(trending_service.rank(rows), [(4, 4)])          # No window: undated rows count.

    # --- Feed ---

    def test_batch_gets_one_trending_item_with_its_like_count(self):
        self.like(5, "bob", "carol")
        items = self.recommend(n=3)
        self.assertEqual(len(items), 3)
        trending = self.trending_of(items)
        self.assertEqual((trending["item_id"], trending["like_count"]), (5, 2))
        self.assertEqual(trending["item_tags"], sorted(Startup.item_tags[5]))
        for item in items:
            if item is not trending:
                self.assertFalse(item["is_trending"])
                self.assertIsNone(item["like_count"])

    def test_no_trending_item_when_nothing_has_enough_recent_likes(self):
        self.like(5, "bob")
        self.like(4, "bob", "carol", age_days=200)
        items = self.recommend(n=3)
        self.assertEqual(len(items), 3)
        self.assertIsNone(self.trending_of(items))

    def test_seen_items_are_skipped_for_the_next_most_liked(self):
        self.like(5, "bob", "carol", "dave")
        self.like(4, "bob", "carol")
        self.react("Dislikes", "zoe", 5)
        self.assertEqual(self.trending_of(self.recommend())["item_id"], 4)

    def test_a_trending_item_is_never_sent_twice(self):
        self.like(5, "bob", "carol", "dave")
        self.like(4, "bob", "carol")
        picks = [self.trending_of(self.recommend(n=1)) for _ in range(3)]
        self.assertEqual([p["item_id"] if p else None for p in picks[:2]], [5, 4])

    def test_copies_of_a_seen_product_count_as_seen(self):
        self.like(2, "bob", "carol", "dave")
        self.like(4, "bob", "carol")
        self.react("Dislikes", "zoe", 1)   # 1 is a copy of 2.
        self.assertEqual(self.trending_of(self.recommend())["item_id"], 4)

    def test_this_weeks_likes_come_before_older_ones_and_older_ones_fill_in(self):
        self.like(4, "a", "b", "c", "d", "e", age_days=20)
        self.like(6, "bob", "carol", age_days=1)
        self.assertEqual(self.trending_of(self.recommend(n=1))["item_id"], 6)
        # This week's list is used up, so the 30 day list fills the slot.
        trending = self.trending_of(self.recommend(n=1))
        self.assertEqual((trending["item_id"], trending["like_count"]), (4, 5))

    def test_tag_filter_applies_to_the_trending_item(self):
        self.like(5, "bob", "carol", "dave")   # pants
        self.like(4, "bob", "carol")           # shirt
        self.assertEqual(self.trending_of(self.recommend(tags=["shirt"]))["item_id"], 4)

    def test_items_far_from_the_users_taste_are_skipped(self):
        # Alice likes item 1, so item 5 (its opposite) clashes and item 3 (close to it) doesn't.
        self.react("Likes", "alice", 1)
        self.like(5, "bob", "carol", "dave")
        self.like(3, "bob", "carol")
        with patch.object(trending_service, "TASTE_KEEP_SHARE", 0.6):
            trending = self.trending_of(self.recommend(user="alice", n=2))
        self.assertEqual(trending["item_id"], 3)

    def test_an_item_exactly_on_the_taste_line_is_allowed(self):
        # Alice likes item 1. Item 3 is the 3rd nearest of 6, exactly on the line at 0.5.
        self.react("Likes", "alice", 1)
        self.like(5, "bob", "carol", "dave")
        self.like(3, "bob", "carol")
        with patch.object(trending_service, "TASTE_KEEP_SHARE", 0.5):
            self.assertEqual(self.trending_of(self.recommend(user="alice", n=2))["item_id"], 3)

    def test_taste_check_can_be_turned_off(self):
        self.react("Likes", "alice", 1)
        self.like(5, "bob", "carol")
        with patch.object(trending_service, "TASTE_KEEP_SHARE", 1.0):
            self.assertEqual(self.trending_of(self.recommend(user="alice", n=2))["item_id"], 5)

    def test_users_with_no_likes_get_no_taste_check(self):
        self.react("Dislikes", "zoe", 3)
        self.like(5, "bob", "carol")
        self.assertEqual(self.trending_of(self.recommend())["item_id"], 5)

    def test_items_no_longer_in_the_catalog_are_skipped(self):
        self.like(5, "bob", "carol", "dave")
        self.like(4, "bob", "carol")
        embeddings = dict(Startup.item_id_to_embedding)
        del embeddings[5]
        with patch.object(Startup, "item_id_to_embedding", embeddings):
            self.assertEqual(self.trending_of(self.recommend())["item_id"], 4)

    def test_a_trending_item_already_in_the_batch_is_marked_not_repeated(self):
        self.like(4, "bob", "carol")
        items = self.recommend(n=5)   # The whole catalog: every product is in the batch.
        products = [frozenset(Startup.duplicates_of(i["item_id"])) for i in items]
        self.assertEqual(len(products), len(set(products)))
        self.assertEqual(self.trending_of(items)["item_id"], 4)

    def test_replaced_item_is_not_lost(self):
        self.like(5, "bob", "carol")
        sent = [i["item_id"] for _ in range(4) for i in self.recommend(n=2)]
        products = [frozenset(Startup.duplicates_of(i)) for i in sent]
        # All 5 products arrive exactly once, including the one the trending item pushed out.
        self.assertEqual(len(products), 5)
        self.assertEqual(len(set(products)), 5)

    def test_requested_items_are_never_replaced_or_made_trending(self):
        store.rows["Item_Requests"].append({"id": 1, "user_id": "zoe", "clothes_id": 5, "status": "approved",
                                            "seen_by_user": False, "created_at": days_ago(1)})
        self.like(5, "bob", "carol", "dave")
        self.like(4, "bob", "carol")
        items = self.recommend(n=2)
        self.assertEqual(items[0]["item_id"], 5)
        self.assertTrue(items[0]["requested_by_you"])
        self.assertFalse(items[0]["is_trending"])
        self.assertEqual(self.trending_of(items)["item_id"], 4)
        self.assertEqual(len(items), 2)

    def test_the_trending_item_never_gets_a_reason(self):
        # The trending item is explained by its "Most liked" badge, so it gets no "Why this?" reason.
        from services import explanation_service
        self.react("Likes", "alice", 1)
        self.like(3, "bob", "carol")
        with patch.object(explanation_service, "REASON_SHARE", 1.0), \
                patch.object(trending_service, "TASTE_KEEP_SHARE", 1.0):
            items = self.recommend(user="alice", n=4)
        trending = self.trending_of(items)
        self.assertEqual(trending["item_id"], 3)
        self.assertIsNone(trending["reason"])
        self.assertTrue(any(i["reason"] for i in items if not i["is_trending"]))

    def test_n_zero_returns_nothing_and_reads_no_likes(self):
        with patch.object(trending_service, "_fetch_recent_likes") as fetch:
            self.assertEqual(self.recommend(n=0), [])
        fetch.assert_not_called()

    # --- Database use ---

    def test_one_likes_query_covers_every_window(self):
        self.like(5, "bob", "carol", age_days=60)
        with patch.object(trending_service, "_fetch_recent_likes", wraps=trending_service._fetch_recent_likes) as fetch:
            self.recommend(n=1)
            self.recommend(n=1)
        self.assertEqual(fetch.call_count, 1)

    def test_trending_item_comes_in_the_batchs_existing_clothing_query(self):
        self.react("Likes", "alice", 1)
        self.like(5, "bob", "carol")
        with patch.object(trending_service, "TASTE_KEEP_SHARE", 1.0), \
                patch.object(clothes, "_fetch_clothing_items", wraps=clothes._fetch_clothing_items) as fetch:
            items = self.recommend(user="alice", n=1)
        self.assertEqual(self.trending_of(items)["item_id"], 5)
        self.assertEqual(fetch.call_count, 1)

    def test_stale_rankings_are_served_while_they_refresh(self):
        self.like(5, "bob", "carol")
        self.assertEqual(self.trending_of(self.recommend(n=1))["item_id"], 5)
        self.like(4, "bob", "carol", "dave")
        with patch.object(trending_service, "CACHE_TTL", 0), \
                patch.object(trending_service.threading, "Thread", InlineThread):
            # This batch still uses the old rankings (nothing left: 5 was sent) ...
            self.assertIsNone(self.trending_of(self.recommend(n=1)))
        # ... while the refresh it started makes the next batch see the new likes.
        self.assertEqual(self.trending_of(self.recommend(n=1))["item_id"], 4)

    def test_a_failed_fetch_does_not_break_the_feed_or_retry_every_batch(self):
        self.like(5, "bob", "carol")
        with patch.object(trending_service, "_fetch_recent_likes", side_effect=RuntimeError("down")) as fetch, \
                self.assertLogs("routers.clothes", level="WARNING"):
            first = self.recommend(n=3)
            second = self.recommend(n=3)
        self.assertEqual((len(first), len(second)), (3, 2))   # 5 products, 3 then the 2 left.
        self.assertIsNone(self.trending_of(first + second))
        self.assertEqual(fetch.call_count, 1)

    def test_a_failed_background_refresh_keeps_the_old_rankings(self):
        self.like(5, "bob", "carol")
        self.like(4, "bob", "carol")
        self.recommend(n=1)
        with patch.object(trending_service, "CACHE_TTL", 0), \
                patch.object(trending_service.threading, "Thread", InlineThread), \
                patch.object(trending_service, "_fetch_recent_likes", side_effect=RuntimeError("down")), \
                self.assertLogs("services.trending_service", level="WARNING"):
            self.assertIsNotNone(self.trending_of(self.recommend(n=1)))


if __name__ == "__main__":
    unittest.main()
