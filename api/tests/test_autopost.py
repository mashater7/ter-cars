from datetime import datetime, timezone
import unittest

from api import autopost


class QueueTests(unittest.TestCase):
    def test_migrated_queue_has_fourteen_ready_posts(self):
        """Clearing an obsolete delivery channel must make every queued post ready."""
        rows = autopost.read_queue()

        self.assertEqual(14, len(rows))
        self.assertEqual(["" for _ in rows], [row["status"] for row in rows])


class DueTests(unittest.TestCase):
    def test_due_includes_a_slot_at_the_current_time(self):
        now = datetime(2026, 10, 30, 8, 0, tzinfo=autopost.MSK)
        rows = [{"id": "now", "datetime_msk": "2026-10-30 08:00", "status": ""}]

        self.assertEqual([(rows[0], False)], autopost.due(rows, now))

    def test_due_excludes_a_post_with_a_status(self):
        now = datetime(2026, 10, 30, 8, 0, tzinfo=autopost.MSK)
        rows = [{"id": "done", "datetime_msk": "2026-10-30 08:00", "status": "posted:1"}]

        self.assertEqual([], autopost.due(rows, now))

    def test_due_interprets_queue_times_as_utc_plus_three(self):
        now = datetime(2026, 10, 30, 5, 0, tzinfo=timezone.utc)
        rows = [{"id": "msk", "datetime_msk": "2026-10-30 08:00", "status": ""}]

        self.assertEqual([(rows[0], False)], autopost.due(rows, now))

    def test_due_marks_only_posts_later_than_six_hours_as_stale(self):
        now = datetime(2026, 10, 30, 14, 1, tzinfo=autopost.MSK)
        rows = [
            {"id": "boundary", "datetime_msk": "2026-10-30 08:01", "status": ""},
            {"id": "late", "datetime_msk": "2026-10-30 08:00", "status": ""},
        ]

        self.assertEqual([(rows[0], False), (rows[1], True)], autopost.due(rows, now))


if __name__ == "__main__":
    unittest.main()
