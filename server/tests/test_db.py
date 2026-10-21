from types import SimpleNamespace
from unittest.mock import Mock

from tests.support import BackendTest, db, store


class DatabaseBoundaryTests(BackendTest):
    def test_transient_failure_recovers_and_final_failure_is_propagated(self):
        response = SimpleNamespace(data=[{"item_id": 1}])
        query = Mock()
        query.execute.side_effect = [RuntimeError("temporary"), response]
        with self.assertLogs("db", level="WARNING"):
            self.assertIs(db.supabase_execute(query), response)
        query.execute.side_effect = RuntimeError("offline")
        with self.assertLogs("db", level="WARNING"), self.assertRaisesRegex(RuntimeError, "offline"):
            db.supabase_execute(query)
        self.assertEqual(query.execute.call_count, 5)

    def test_paging_handles_partial_empty_and_exact_multiple_final_pages(self):
        for count in (0, 2, 4, 5):
            with self.subTest(count=count):
                store.rows["Clothing"] = [{"item_id": i} for i in reversed(range(count))]
                pages = list(db.supabase_fetch_all(lambda: store.table("Clothing").select("*").order("item_id"), page_size=2))
                self.assertEqual([row["item_id"] for page in pages for row in page], list(range(count)))
                self.assertLess(len(pages[-1]), 2)

    def test_failed_page_does_not_return_a_silently_truncated_catalog(self):
        build = Mock()
        query = build.return_value
        query.range.return_value = query
        query.execute.side_effect = [SimpleNamespace(data=[1, 2]), RuntimeError("offline"), RuntimeError("offline"), RuntimeError("offline")]
        pages = db.supabase_fetch_all(build, page_size=2)
        self.assertEqual(next(pages), [1, 2])
        with self.assertLogs("db", level="WARNING"), self.assertRaisesRegex(RuntimeError, "offline"):
            next(pages)
