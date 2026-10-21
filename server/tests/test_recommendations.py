import unittest
from unittest.mock import patch

import faiss
import numpy as np

from tests.support import BackendTest, Startup, catalog, recommendations as rec, store, vector


class PreferenceTests(BackendTest):
    def test_cold_start_requires_a_like_with_a_known_embedding(self):
        for likes, dislikes in (([], []), ([], [1]), ([999], [4])):
            with self.subTest(likes=likes, dislikes=dislikes):
                np.testing.assert_array_equal(rec.compute_pref_vec(likes, dislikes), vector(0))

    def test_dislikes_push_away_without_changing_the_catalog_embeddings(self):
        before = Startup.item_id_to_embedding[1].copy()
        actual = rec.compute_pref_vec([1, 999], [4, 998])
        expected = vector(1, -.35) / np.sqrt(1 + .35 ** 2)
        np.testing.assert_allclose(actual, expected, atol=1e-6)
        np.testing.assert_array_equal(Startup.item_id_to_embedding[1], before)
        self.assertAlmostEqual(float(np.linalg.norm(actual)), 1)

    def test_a_like_thirty_positions_older_has_half_the_influence(self):
        # Unknown/deleted catalog items still occupy their historical positions.
        actual = rec.compute_pref_vec([1] + [999] * 29 + [4], [])
        np.testing.assert_allclose(actual, vector(1, 2) / np.sqrt(5), atol=1e-6)
        reversed_history = rec.compute_pref_vec([4] + [999] * 29 + [1], [])
        np.testing.assert_allclose(reversed_history, vector(2, 1) / np.sqrt(5), atol=1e-6)

    def test_filtered_exploration_pressure_expires_as_new_likes_arrive(self):
        filtered = frozenset(range(1, 31))
        self.assertEqual(rec.filtered_like_share([], filtered), 0)
        self.assertEqual(rec.filtered_like_share(list(range(1, 31)), filtered), 1)
        self.assertEqual(rec.filtered_like_share(list(range(1, 46)), filtered), .5)
        self.assertEqual(rec.filtered_like_share(list(range(1, 61)), filtered), 0)

    def test_map_position_uses_positive_similarity_and_ignores_unmapped_items(self):
        # Item 2 is equally close but has no coordinates; item 5 points away.
        Startup.item_coordinates[5] = (10000, 10000)
        x, y = rec.estimate_coordinates(vector(1))
        self.assertAlmostEqual(x, 8 / 1.8, places=5)
        self.assertAlmostEqual(y, 16 / 1.8, places=5)
        Startup.item_coordinates = {5: (10000, 10000)}
        self.assertIsNone(rec.estimate_coordinates(vector(1)))


class CatalogTests(BackendTest):
    def test_centering_removes_shared_component_before_cosine_ranking(self):
        raw = np.stack([vector(3, 1), vector(3, -1)])
        centered, mean = Startup.center_embeddings(raw)
        np.testing.assert_allclose(centered, [vector(0, 1), vector(0, -1)], atol=1e-6)
        np.testing.assert_allclose(mean, vector(3 / np.sqrt(10)), atol=1e-6)

    def test_duplicate_products_are_collapsed_but_similar_items_are_preserved(self):
        self.assertEqual(Startup.drop_duplicates([3, 2, 1, 4, 2]), [3, 2, 4])
        self.assertEqual(set(Startup.duplicates_of(1)), {1, 2})

    def test_filters_or_within_category_and_across_categories(self):
        cases = [([], None), (["shirt"], {1, 2, 4}),
                 (["shirt", "pants", "black"], {1, 2, 3, 6}),
                 (["shirt", "black", "black"], {1, 2}),
                 (["shirt", "does-not-exist"], set()), (["unused"], set())]
        for tags, expected in cases:
            with self.subTest(tags=tags):
                self.assertEqual(Startup.resolve_filter(tags), expected)

    def test_relabel_removes_old_filter_memberships_and_updates_new_ones(self):
        Startup.set_item_tags(4, ["pants", "black", "unknown"])
        self.assertEqual(Startup.resolve_filter(["shirt", "white"]), set())
        self.assertEqual(Startup.resolve_filter(["pants", "black"]), {3, 4, 6})
        self.assertEqual(Startup.item_tags[4], {"pants", "black"})
        Startup.set_item_tags(4, [])
        self.assertNotIn(4, Startup.resolve_filter(["pants"]))

    def test_live_upload_is_centered_indexed_and_grouped_with_existing_copies(self):
        Startup.catalog_mean = vector(.6)
        # Normalize (6,8), subtract (.6,0), then normalize again -> (0,1).
        Startup.add_item_embedding(7, vector(6, 8))
        self.assertEqual(Startup.index.ntotal, 7)
        self.assertEqual(set(Startup.duplicates_of(7)), {4, 7})
        np.testing.assert_allclose(Startup.item_id_to_embedding[7], vector(0, 1), atol=1e-6)
        self.assertEqual(Startup.drop_duplicates([7, 4, 3]), [7, 3])

    def test_startup_reads_multiple_embedding_pages_and_decodes_json_vectors(self):
        import json
        store.rows["Embeddings"] = [
            {"item_id": 3, "embedding": vector(0, 1).tolist()},
            {"item_id": 1, "embedding": json.dumps(vector(1).tolist())},
            {"item_id": 2, "embedding": vector(0, -1).tolist()},
        ]
        with patch.object(Startup, "EMBEDDING_PAGE_SIZE", 2):
            ids, embeddings = Startup._fetch_embeddings()
        self.assertEqual(ids, [1, 2, 3])
        np.testing.assert_array_equal(embeddings, [vector(1), vector(0, -1), vector(0, 1)])

    def test_startup_tag_failure_keeps_unfiltered_recommendations_available(self):
        Startup.ready = False
        raw = np.stack([vector(1), vector(0, 1), vector(-1)])
        with patch.object(Startup, "_fetch_embeddings", return_value=([1, 3, 5], raw)), \
                patch.object(Startup, "_fetch_tags", side_effect=RuntimeError("tags unavailable")), \
                self.assertLogs("services.Startup", level="ERROR"):
            Startup.initialize()
        self.assertTrue(Startup.ready)
        self.assertEqual(set(rec.get_recommendations(vector(1), [], n=5)), {1, 3, 5})
        self.assertEqual(Startup.resolve_filter(["shirt"]), set())

    def test_empty_catalog_fails_startup_instead_of_marking_the_server_ready(self):
        Startup.ready = False
        with self.assertLogs("services.Startup", level="ERROR"), self.assertRaisesRegex(RuntimeError, "No embeddings"):
            Startup.initialize()
        self.assertFalse(Startup.ready)


class RankingTests(BackendTest):
    def test_ranked_recommendations_filter_seen_and_duplicate_products(self):
        result = rec.get_recommendations(vector(1), [1, 2], n=10, allowed_ids={1, 2, 3, 4})
        self.assertEqual(set(result), {3, 4})
        result = rec.get_recommendations(vector(1), [], n=10)
        self.assertEqual(len(result), 5)
        self.assertEqual(len(set(result)), 5)
        self.assertEqual(len({1, 2} & set(result)), 1)

    def test_empty_or_exhausted_filters_never_fall_back_to_other_catalog_items(self):
        self.assertEqual(rec.get_recommendations(vector(1), [], n=10, allowed_ids=set()), [])
        self.assertEqual(rec.get_recommendations(vector(1), [3], n=10, allowed_ids={3}), [])

    def test_mmr_prefers_diversity_over_a_second_near_identical_piece(self):
        candidates = np.stack([vector(.8, .6), vector(.8, .6), vector(.7, -np.sqrt(.51))])
        faiss.normalize_L2(candidates)
        self.assertEqual(rec._mmr_select(candidates, vector(1), 2, rec.MMR_LAMBDA), [0, 2])
        self.assertEqual(rec._mmr_select(candidates, vector(1), 2, 1), [0, 1])

    def test_every_client_batch_includes_exploration_and_boost_increases_it(self):
        # Three disjoint pools make each slot's origin observable in the result.
        def sample(boost):
            pools = {"exploit": list(range(100)), "adjacent": list(range(100, 200)), "random": list(range(200, 300))}
            return rec._fill_results(pools, 20, 10, boost)
        for boost, expected in [(0, [8, 1, 1]), (1, [2, 4, 4])]:
            result = sample(boost)
            for batch in (result[:10], result[10:]):
                self.assertEqual([sum(low <= i < low + 100 for i in batch) for low in (0, 100, 200)], expected)

    def test_empty_exploration_pools_fill_from_available_items_without_repeats(self):
        result = rec._fill_results({"exploit": [1, 2, 3, 4], "adjacent": [], "random": [3, 5]}, 10, 3, 1)
        self.assertEqual(set(result), {2, 3, 4, 5})
        self.assertEqual(len(result), 4)


if __name__ == "__main__":
    unittest.main()
