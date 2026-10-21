from unittest.mock import patch

from tests.support import BackendTest, store, user_state


class UserStateTests(BackendTest):
    def test_loaded_history_preserves_recency_prioritizes_likes_and_excludes_copies(self):
        self.react("Likes", "alice", 3, 1)
        self.react("Dislikes", "alice", 1, 4)
        self.react("Likes", "bob", 5)
        for row, timestamp in zip(store.rows["Likes"], [1, 2, 1]):
            row["created_at"] = timestamp
        liked, disliked, seen = user_state.snapshot("alice")
        self.assertEqual(liked, [3, 1])
        self.assertEqual(disliked, [4])
        self.assertEqual(seen, {1, 2, 3, 4})
        self.assertEqual(user_state.snapshot("bob")[0], [5])
        liked.clear(); disliked.clear(); seen.clear()
        self.assertEqual(user_state.snapshot("alice"), ([3, 1], [4], {1, 2, 3, 4}))

    def test_repeated_swipes_move_to_most_recent_and_switching_is_exclusive(self):
        user_state.snapshot("alice")
        user_state.record_swipe("alice", 1, True)
        user_state.record_swipe("alice", 3, True)
        self.assertEqual(user_state.record_swipe("alice", 1, True), ([3, 1], [], False))
        self.assertEqual(user_state.record_swipe("alice", 1, False), ([3], [1], True))
        self.assertEqual(user_state.record_swipe("alice", 1, True), ([3, 1], [], True))

    def test_unliking_does_not_make_the_product_or_its_copies_reappear(self):
        user_state.snapshot("alice")
        user_state.record_swipe("alice", 1, True)
        user_state.mark_served("alice", [3], filtered=True)
        self.assertEqual(user_state.remove_swipe("alice", 1, True), ([], []))
        self.assertEqual(user_state.snapshot("alice")[2], {1, 2, 3})
        self.assertEqual(user_state.filtered_ids("alice"), {3})
        self.assertEqual(user_state.snapshot("bob")[2], set())

    def test_ttl_refresh_picks_up_external_deletions_but_keeps_served_items_seen(self):
        with patch.object(user_state.time, "monotonic", return_value=100):
            self.react("Likes", "alice", 1)
            user_state.snapshot("alice")
            user_state.mark_served("alice", [3], filtered=True)
        store.rows["Likes"] = []
        self.react("Dislikes", "alice", 5)
        with patch.object(user_state.time, "monotonic", return_value=399):
            self.assertEqual(user_state.snapshot("alice")[0], [1])
        with patch.object(user_state.time, "monotonic", return_value=400):
            self.assertEqual(user_state.snapshot("alice"), ([], [5], {1, 2, 3, 5}))
            self.assertEqual(user_state.filtered_ids("alice"), {3})

    def test_history_reads_beyond_one_database_page(self):
        self.react("Likes", "alice", *range(1, 1003))
        self.assertEqual(user_state.snapshot("alice")[0], list(range(1, 1003)))

    def test_missing_timestamp_column_falls_back_without_hiding_other_database_failures(self):
        original = user_state.supabase_fetch_all
        def without_timestamps(build_query):
            if ("created_at", False) in build_query().orders:
                raise RuntimeError("column created_at does not exist")
            yield from original(build_query)
        self.react("Likes", "alice", 3, 1)
        with patch.object(user_state, "supabase_fetch_all", side_effect=without_timestamps), \
                self.assertLogs("services.user_state", level="WARNING"):
            self.assertEqual(user_state.snapshot("alice")[0], [1, 3])
        user_state.forget("alice")
        store.failure = ("Likes", "select")
        with self.assertLogs("db", level="WARNING"), self.assertRaisesRegex(RuntimeError, "unavailable"):
            user_state.snapshot("alice")

    def test_forgetting_after_clear_allows_a_fresh_feed_only_for_that_user(self):
        for user in ("alice", "bob"):
            user_state.snapshot(user)
            user_state.mark_served(user, [1], filtered=True)
        user_state.forget("alice")
        self.assertEqual(user_state.snapshot("alice"), ([], [], set()))
        self.assertEqual(user_state.filtered_ids("alice"), set())
        self.assertEqual(user_state.snapshot("bob")[2], {1, 2})
