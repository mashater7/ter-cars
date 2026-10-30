from contextlib import redirect_stdout
import csv
from io import StringIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

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


class PublicationSafetyTests(unittest.TestCase):
    def ready_row(self):
        return {
            "id": "ready",
            "datetime_msk": "2026-10-30 08:00",
            "text": "Ready post",
            "image_url": "",
            "status": "",
        }

    def test_dry_run_shows_due_post_without_api_calls_or_queue_writes(self):
        row = self.ready_row()
        row["datetime_msk"] = (datetime.now(autopost.MSK) - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M")
        output = StringIO()
        with patch.object(autopost, "read_queue", return_value=[row]), \
                patch.object(autopost, "call") as call, \
                patch.object(autopost, "write_queue") as write_queue, \
                patch.object(sys, "argv", ["autopost.py", "--dry-run"]), \
                redirect_stdout(output):
            autopost.main()

        self.assertIn("[К ПУБЛИКАЦИИ]", output.getvalue())
        call.assert_not_called()
        write_queue.assert_not_called()

    def test_main_requires_true_autopublish_flag_before_network_or_queue_write(self):
        row = self.ready_row()
        for value in ("", "false"):
            with self.subTest(autopublish_enabled=value), \
                    patch.object(autopost, "read_queue", return_value=[row]), \
                    patch.object(autopost, "due", return_value=[(row, False)]), \
                    patch.object(autopost, "setting", side_effect=lambda name: value if name == "AUTOPUBLISH_ENABLED" else "token"), \
                    patch.object(autopost, "call") as call, \
                    patch.object(autopost, "write_queue") as write_queue, \
                    patch.object(sys, "argv", ["autopost.py"]):
                with self.assertRaisesRegex(SystemExit, "AUTOPUBLISH_ENABLED"):
                    autopost.main()

                call.assert_not_called()
                write_queue.assert_not_called()

    def test_check_account_rejects_configured_account_other_than_ter_cars_before_api_call(self):
        with patch.object(autopost, "setting", return_value="another_account"), \
                patch.object(autopost, "call", return_value={"username": "another_account"}) as call:
            with self.assertRaises(SystemExit):
                autopost.check_account("token")

            call.assert_not_called()

    def test_main_persists_stale_status_when_enabled_but_token_is_missing(self):
        row = self.ready_row()
        with TemporaryDirectory() as directory:
            queue = Path(directory) / "queue.csv"
            with patch.object(autopost, "QUEUE", queue):
                autopost.write_queue([])
                with patch.object(autopost, "read_queue", return_value=[row]), \
                        patch.object(autopost, "due", return_value=[(row, True)]), \
                        patch.object(autopost, "setting", side_effect=lambda name: "true" if name == "AUTOPUBLISH_ENABLED" else ""), \
                        patch.object(autopost, "call") as call, \
                        patch.object(sys, "argv", ["autopost.py"]):
                    with self.assertRaisesRegex(SystemExit, "ACCESS_TOKEN"):
                        autopost.main()

                with queue.open(encoding="utf-8-sig", newline="") as file:
                    saved = list(csv.DictReader(file, delimiter=";"))
                self.assertEqual("skip:опоздал больше чем на 6 часов", saved[0]["status"])
                call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
