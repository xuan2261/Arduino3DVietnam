"""False-green protections for manual GitHub Pages release gates (no network)."""
from __future__ import annotations

import unittest
from unittest import mock

from scripts import verify_release_gates as gates

SHA = "a" * 40
OLD_SHA = "b" * 40
REPO = "example/arduino-3d-viet"


def run(
    *,
    sha: str = SHA,
    status: str = "completed",
    conclusion: str | None = "success",
    event: str = "workflow_dispatch",
    created: str = "2026-10-28T00:00:00Z",
    ident: int = 100,
) -> dict:
    return {
        "id": ident,
        "head_sha": sha,
        "status": status,
        "conclusion": conclusion,
        "event": event,
        "created_at": created,
        "run_attempt": 1,
        "html_url": f"https://github.com/example/arduino-3d-viet/actions/runs/{ident}",
    }


class ReleaseGateTests(unittest.TestCase):
    def test_exact_sha_successes_are_required_for_both_workflows(self):
        with mock.patch.object(
            gates, "request_workflow_runs",
            return_value={"workflow_runs": [run(), run(sha=OLD_SHA, ident=4)]},
        ) as fetch:
            result = gates.verify(REPO, SHA, "synthetic-test-token")
        self.assertEqual(len(result), 2)
        self.assertTrue(all(gate.passed for gate in result))
        self.assertEqual(fetch.call_count, 2)

    def test_stale_pass_cannot_authorize_new_revision(self):
        result = gates.check_workflow("arduino-compile-manual.yml", "Compile", SHA,
                                      {"workflow_runs": [run(sha=OLD_SHA)]})
        self.assertFalse(result.passed)
        self.assertIsNone(result.run_id)

    def test_failed_latest_run_blocks_older_pass_for_same_sha(self):
        old_success = run(ident=12, created="2026-10-27T10:00:00Z")
        new_failure = run(ident=13, created="2026-10-28T10:00:00Z", conclusion="failure")
        result = gates.check_workflow("arduino-compile-manual.yml", "Compile", SHA,
                                      {"workflow_runs": [old_success, new_failure]})
        self.assertFalse(result.passed)
        self.assertEqual(result.run_id, 13)

    def test_queued_or_cancelled_attempt_is_not_success(self):
        for state, conclusion in (("queued", None), ("in_progress", None), ("completed", "cancelled")):
            with self.subTest(state=state):
                check = gates.check_workflow(
                    "browser-e2e-manual.yml", "Browser", SHA,
                    {"workflow_runs": [run(status=state, conclusion=conclusion)]},
                )
                self.assertFalse(check.passed)

    def test_non_manual_event_never_satisfies_gate(self):
        result = gates.check_workflow("browser-e2e-manual.yml", "Browser", SHA,
                                      {"workflow_runs": [run(event="push")]})
        self.assertFalse(result.passed)

    def test_missing_second_workflow_blocks_release(self):
        def fetch(repo, workflow, token):
            return {"workflow_runs": [run()]} if "arduino" in workflow else {"workflow_runs": []}

        with mock.patch.object(gates, "request_workflow_runs", side_effect=fetch):
            result = gates.verify(REPO, SHA, "synthetic-test-token")
        self.assertTrue(result[0].passed)
        self.assertFalse(result[1].passed)

    def test_rejects_invalid_sha_or_repository_without_fetching(self):
        with mock.patch.object(gates, "request_workflow_runs") as fetch:
            with self.assertRaises(ValueError):
                gates.verify("../other", SHA, "test")
            with self.assertRaises(ValueError):
                gates.verify(REPO, "abc", "test")
        fetch.assert_not_called()

    def test_workflow_allowlist_rejects_other_remote_actions(self):
        with self.assertRaises(ValueError):
            gates.request_workflow_runs(REPO, "../delete", "test")

    def test_utf8_output_works_on_legacy_windows_streams(self):
        class Fake:
            def __init__(self):
                self.kwargs = None

            def reconfigure(self, **kwargs):
                self.kwargs = kwargs

        stdout, stderr = Fake(), Fake()
        with mock.patch.object(gates.sys, "stdout", stdout), mock.patch.object(
            gates.sys, "stderr", stderr
        ):
            gates._configure_utf8_stdio()
        self.assertEqual(stdout.kwargs, {"encoding": "utf-8", "errors": "replace"})
        self.assertEqual(stderr.kwargs, {"encoding": "utf-8", "errors": "replace"})

    def test_workflow_file_enforces_manual_samesha_release_gate(self):
        from pathlib import Path

        source = (Path(__file__).resolve().parents[1] / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        self.assertIn("if: github.event_name == 'workflow_dispatch'", source)
        self.assertIn("actions: read", source)
        self.assertIn("scripts/verify_release_gates.py", source)
        self.assertIn("needs: [check, release-gates]", source)


if __name__ == "__main__":
    unittest.main()
