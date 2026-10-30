from contextlib import redirect_stdout
import csv
from io import StringIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import os
import shutil
import subprocess
import textwrap
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


class WorkflowQueuePersistenceTests(unittest.TestCase):
    def test_workflow_uses_node24_compatible_first_party_actions(self):
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/autopost.yml"
        references = [line.split("uses:", 1)[1].strip()
                      for line in workflow.read_text(encoding="utf-8").splitlines()
                      if "uses: actions/" in line]

        self.assertEqual(["actions/checkout@v7.0.1", "actions/checkout@v7.0.1",
                          "actions/upload-artifact@v7.0.2", "actions/checkout@v7.0.1"],
                         references)
        self.assertNotIn("actions/checkout@v4", references)
        self.assertNotIn("actions/upload-artifact@v4", references)

    def test_waiting_run_loads_status_committed_after_its_event_before_publication(self):
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/autopost.yml"
        publish = workflow.read_text(encoding="utf-8").split("  publish:\n", 1)[1].split("  refresh:\n", 1)[0]
        block = publish.split("      - name: Load latest publication queue\n", 1)[1]
        shell = textwrap.dedent(block.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        self.assertLess(publish.index("Load latest publication queue"),
                        publish.index("Block publication after unresolved queue persistence failure"))
        self.assertLess(publish.index("Load latest publication queue"), publish.index("Publish due posts"))
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        with TemporaryDirectory() as directory:
            root = Path(directory)
            remote, editor, runner = (root / name for name in ("remote.git", "editor", "runner"))

            def git(cwd, *args):
                return subprocess.run(["git", "-C", str(cwd), *args], check=True,
                                      capture_output=True, text=True, timeout=30).stdout.strip()

            subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(remote)],
                           check=True, capture_output=True, timeout=30)
            subprocess.run(["git", "clone", str(remote), str(editor)],
                           check=True, capture_output=True, timeout=30)
            git(editor, "config", "user.name", "Test")
            git(editor, "config", "user.email", "test@example.invalid")
            (editor / "api").mkdir()
            row = {"id": "one", "datetime_msk": "2026-10-30 08:00",
                   "text": "Original", "image_url": "", "status": ""}
            with patch.object(autopost, "QUEUE", editor / "api/queue.csv"):
                autopost.write_queue([row])
            git(editor, "add", ".")
            git(editor, "commit", "-m", "Event queue")
            event_commit = git(editor, "rev-parse", "HEAD")
            git(editor, "push", "origin", "main")
            subprocess.run(["git", "clone", str(remote), str(runner)],
                           check=True, capture_output=True, timeout=30)
            git(runner, "checkout", "--detach", event_commit)
            row["status"] = "posted:123"
            with patch.object(autopost, "QUEUE", editor / "api/queue.csv"):
                autopost.write_queue([row])
            git(editor, "add", ".")
            git(editor, "commit", "-m", "Earlier run persisted publication")
            git(editor, "push", "origin", "main")
            latest_commit = git(editor, "rev-parse", "HEAD")
            self.assertNotEqual(event_commit, latest_commit)
            result = subprocess.run([bash, "-eo", "pipefail", "-c", shell], cwd=runner,
                                    env={**os.environ, "GITHUB_REF": "refs/heads/main"},
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertEqual(latest_commit, git(runner, "rev-parse", "HEAD"))
            with patch.object(autopost, "QUEUE", runner / "api/queue.csv"):
                loaded = autopost.read_queue()
            self.assertEqual("posted:123", loaded[0]["status"])
            self.assertEqual([], autopost.due(loaded, datetime(2026, 10, 30, 9, 0, tzinfo=autopost.MSK)))
            # Persistence compares against this same refreshed HEAD, so the prior
            # run's status is not mistaken for a change made by this run.
            self.assertEqual("", git(runner, "diff", "HEAD", "--", "api/queue.csv"))
            git(runner, "remote", "set-url", "origin", str(root / "missing.git"))
            failed = subprocess.run([bash, "-eo", "pipefail", "-c", shell], cwd=runner,
                                    env={**os.environ, "GITHUB_REF": "refs/heads/main"},
                                    capture_output=True, text=True, timeout=60)
            self.assertNotEqual(0, failed.returncode)

    def test_unresolved_publication_blocks_next_run_but_guard_only_failure_does_not(self):
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/autopost.yml"
        block = workflow.read_text(encoding="utf-8").split(
            "      - name: Block publication after unresolved queue persistence failure\n", 1)[1]
        shell = textwrap.dedent(block.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        code = shell.split("python - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
        for publication, persistence, blocked, current_run in (("success", "failure", True, "11"),
                                                               ("success", "failure", True, "10"),
                                                   ("cancelled", "skipped", True, "11"),
                                                   ("cancelled", "success", True, "11"),
                                                   ("failure", "success", True, "11"),
                                                   (None, "success", True, "11"),
                                                   ("skipped", "skipped", False, "11"),
                                                   ("success", "success", False, "11")):
            with self.subTest(publication=publication, persistence=persistence):
                responses = [json.dumps([{"workflow_runs": [{"id": 10, "conclusion": "failure",
                                                              "html_url": "https://example.invalid/run/10"}]}]),
                             json.dumps([{"jobs": [{"name": "publish", "steps": [
                                 {"name": "Publish due posts", "conclusion": publication},
                                 {"name": "Commit queue statuses", "conclusion": persistence}]}]}])]
                with patch.dict(os.environ, {"GH_REPO": "test/repo", "CURRENT_RUN": current_run, "CURRENT_ATTEMPT": "2"}), \
                        patch.object(subprocess, "check_output", side_effect=responses):
                    if blocked:
                        with self.assertRaisesRegex(SystemExit, "Publication blocked") as failure:
                            exec(compile(code, "workflow-guard", "exec"), {})
                        message = str(failure.exception)
                        if publication != "success":
                            self.assertIn("First inspect Threads", message)
                            self.assertIn("artifact may not exist", message)
                            self.assertIn("before editing the queue or resolving this run", message)
                        else:
                            self.assertIn("status persistence failed", message)
                            self.assertIn("recovery artifact", message)
                            self.assertIn("restore any missing or renamed IDs", message)
                    else:
                        exec(compile(code, "workflow-guard", "exec"), {})

    def test_status_push_reconciles_intervening_commit_and_preserves_queue_edits(self):
        self.exercise_status_push(reject_forever=False)

    def test_exhausted_push_retries_fail_with_queue_available_for_recovery(self):
        self.exercise_status_push(reject_forever=True)

    def test_removed_or_renamed_published_id_fails_with_recovery_snapshot(self):
        self.exercise_status_push(reject_forever=False, rename_published=True)

    def exercise_status_push(self, reject_forever, rename_published=False):
        workflow = Path(__file__).resolve().parents[2] / ".github/workflows/autopost.yml"
        block = workflow.read_text(encoding="utf-8").split("      - name: Commit queue statuses\n", 1)[1]
        shell = textwrap.dedent(block.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0])
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        with TemporaryDirectory() as directory:
            root = Path(directory)
            remote, editor, runner = (root / name for name in ("remote.git", "editor", "runner"))

            def git(cwd, *args):
                return subprocess.run(["git", "-C", str(cwd), *args], check=True,
                                      capture_output=True, text=True, timeout=30)

            subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(remote)],
                           check=True, capture_output=True, timeout=30)
            subprocess.run(["git", "clone", str(remote), str(editor)],
                           check=True, capture_output=True, timeout=30)
            git(editor, "config", "user.name", "Test")
            git(editor, "config", "user.email", "test@example.invalid")
            (editor / "api").mkdir()
            queue = editor / "api/queue.csv"
            with patch.object(autopost, "QUEUE", queue):
                autopost.write_queue([{"id": "one", "datetime_msk": "2026-10-30 08:00",
                                       "text": "Original", "image_url": "", "status": ""}])
            git(editor, "add", ".")
            git(editor, "commit", "-m", "Initial queue")
            git(editor, "push", "origin", "main")
            subprocess.run(["git", "clone", str(remote), str(runner)],
                           check=True, capture_output=True, timeout=30)
            with patch.object(autopost, "QUEUE", runner / "api/queue.csv"):
                rows = autopost.read_queue()
                rows[0]["status"] = "posted:123"
                autopost.write_queue(rows)
            with patch.object(autopost, "QUEUE", queue):
                rows = autopost.read_queue()
                rows[0]["text"] = "Edited by owner"
                if rename_published:
                    rows[0]["id"] = "renamed"
                rows.append({"id": "two", "datetime_msk": "2026-10-31 08:00",
                             "text": "New post", "image_url": "", "status": ""})
                autopost.write_queue(rows)
            git(editor, "add", ".")
            git(editor, "commit", "-m", "Owner edits queue")
            # The owner's push runs immediately before the runner's first push.
            hook = runner / ".git/hooks/pre-push"
            hook.write_text("#!/bin/sh\nif [ ! -f .git/raced ]; then\n"
                            "  touch .git/raced\n  unset GIT_DIR GIT_WORK_TREE\n"
                            f"  git -C '{editor.as_posix()}' push origin main || exit 1\nfi\n",
                            encoding="utf-8")
            if reject_forever:
                hook.write_text(hook.read_text(encoding="utf-8") + "exit 1\n", encoding="utf-8")
            hook.chmod(0o755)
            result = subprocess.run([bash, "-eo", "pipefail", "-c", shell], cwd=runner,
                                    env={**os.environ, "GITHUB_REF_NAME": "main", "RUNNER_TEMP": str(root)},
                                    capture_output=True, text=True, timeout=60)
            if rename_published:
                self.assertNotEqual(0, result.returncode)
                self.assertIn("Published queue IDs disappeared", result.stderr)
                with patch.object(autopost, "QUEUE", root / "threads-queue-recovery.csv"):
                    self.assertEqual("posted:123", autopost.read_queue()[0]["status"])
                return
            if reject_forever:
                self.assertNotEqual(0, result.returncode)
                self.assertIn("Recover the queue artifact", result.stderr)
                with patch.object(autopost, "QUEUE", root / "threads-queue-recovery.csv"):
                    self.assertEqual("posted:123", autopost.read_queue()[0]["status"])
                return
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertIn("push rejected", result.stdout)
            git(editor, "pull", "--ff-only")
            with patch.object(autopost, "QUEUE", queue):
                saved = autopost.read_queue()
            self.assertEqual("posted:123", saved[0]["status"])
            self.assertEqual("Edited by owner", saved[0]["text"])
            self.assertEqual("two", saved[1]["id"])
            self.assertEqual("", saved[1]["status"])
            self.assertEqual([], autopost.due([saved[0]], datetime(2026, 10, 30, 9, 0, tzinfo=autopost.MSK)))


if __name__ == "__main__":
    unittest.main()
