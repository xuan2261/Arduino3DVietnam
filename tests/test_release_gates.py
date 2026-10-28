"""Fail-closed release gate contracts. Network calls are mocked in this suite."""
from __future__ import annotations

import hashlib
import io
import re
import shutil
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock
from urllib.request import Request

from scripts import verify_release_gates as gates


FINAL_SHA = "a" * 40
OLD_SHA = "b" * 40
FIRMWARE_SHA = "c" * 40
REPO = "example/arduino-3d-viet"
TOKEN = "synthetic-test-token"
NOW = datetime(2026, 10, 28, 8, 0, tzinfo=timezone.utc)
SOURCE_BYTES = b"export const fixture = true;\n"
SOURCE_SHA256 = hashlib.sha256(SOURCE_BYTES).hexdigest()


def run(
    *,
    sha: str = FINAL_SHA,
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


def firmware_run(**changes) -> dict:
    result = {
        "id": gates.FIRMWARE_PROOF["run_id"],
        "head_sha": FIRMWARE_SHA,
        "status": "completed",
        "conclusion": "success",
        "event": "workflow_dispatch",
        "run_attempt": gates.FIRMWARE_PROOF["run_attempt"],
        "path": gates.FIRMWARE_WORKFLOW_PATH,
        "html_url": (
            "https://github.com/example/arduino-3d-viet/actions/runs/"
            + str(gates.FIRMWARE_PROOF["run_id"])
        ),
    }
    result.update(changes)
    return result


def artifact(**changes) -> dict:
    result = {
        "id": gates.FIRMWARE_PROOF["artifact_id"],
        "name": gates.FIRMWARE_PROOF["artifact_name"],
        "size_in_bytes": gates.FIRMWARE_PROOF["artifact_size"],
        "expired": False,
        "digest": gates.FIRMWARE_PROOF["artifact_digest"],
        "expires_at": "2027-01-26T07:12:16Z",
        "workflow_run": {
            "id": gates.FIRMWARE_PROOF["run_id"],
            "head_sha": FIRMWARE_SHA,
        },
    }
    result.update(changes)
    return result


def artifact_payload(item: dict | None = None) -> dict:
    return {"total_count": 1, "artifacts": [item or artifact()]}


def manifest() -> dict:
    return {
        "git_sha": FIRMWARE_SHA,
        "source_sha256": SOURCE_SHA256,
    }


def zip_bytes(files: dict[str, bytes]) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in files.items():
            archive.writestr(name, body)
    return stream.getvalue()


class ReleaseGateTests(unittest.TestCase):
    def test_exact_final_sha_successes_are_required_for_both_workflows(self):
        with mock.patch.object(
            gates,
            "request_workflow_runs",
            return_value={"workflow_runs": [run(), run(sha=OLD_SHA, ident=4)]},
        ) as fetch, mock.patch.object(gates, "verify_firmware_gate", return_value=gates.Gate(
            gates.FIRMWARE_WORKFLOW, "Firmware", True, "ok"
        )):
            result = gates.verify(REPO, FINAL_SHA, TOKEN)
        self.assertEqual(len(result), 3)
        self.assertTrue(all(gate.passed for gate in result))
        self.assertEqual(fetch.call_count, 2)

    def test_stale_final_sha_pass_cannot_authorize_new_revision(self):
        result = gates.check_workflow(
            "arduino-compile-manual.yml",
            "Compile",
            FINAL_SHA,
            {"workflow_runs": [run(sha=OLD_SHA)]},
        )
        self.assertFalse(result.passed)
        self.assertIsNone(result.run_id)

    def test_failed_latest_run_blocks_older_pass_for_same_final_sha(self):
        old_success = run(ident=12, created="2026-10-27T10:00:00Z")
        new_failure = run(ident=13, created="2026-10-28T10:00:00Z", conclusion="failure")
        result = gates.check_workflow(
            "arduino-compile-manual.yml",
            "Compile",
            FINAL_SHA,
            {"workflow_runs": [old_success, new_failure]},
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.run_id, 13)

    def test_queued_cancelled_or_nonmanual_final_run_never_satisfies_gate(self):
        cases = (
            ("queued", None, "workflow_dispatch"),
            ("in_progress", None, "workflow_dispatch"),
            ("completed", "cancelled", "workflow_dispatch"),
            ("completed", "success", "push"),
        )
        for status, conclusion, event in cases:
            with self.subTest(status=status, conclusion=conclusion, event=event):
                check = gates.check_workflow(
                    "browser-e2e-manual.yml",
                    "Browser",
                    FINAL_SHA,
                    {"workflow_runs": [run(status=status, conclusion=conclusion, event=event)]},
                )
                self.assertFalse(check.passed)

    def test_firmware_source_can_be_ancestor_but_not_diverged_or_descendant(self):
        ok, reason = gates.check_commit_lineage(
            FIRMWARE_SHA, FINAL_SHA, {"status": "ahead", "ahead_by": 3, "behind_by": 0}
        )
        self.assertTrue(ok, reason)
        same, _ = gates.check_commit_lineage(
            FINAL_SHA, FINAL_SHA, {"status": "identical", "ahead_by": 0, "behind_by": 0}
        )
        self.assertTrue(same)
        for payload in (
            {"status": "diverged", "ahead_by": 2, "behind_by": 1},
            {"status": "behind", "ahead_by": 0, "behind_by": 2},
            {"status": "ahead", "ahead_by": 3, "behind_by": 1},
        ):
            with self.subTest(payload=payload):
                allowed, _ = gates.check_commit_lineage(FIRMWARE_SHA, FINAL_SHA, payload)
                self.assertFalse(allowed)

    def test_source_hash_must_match_lessons_at_manifest_commit(self):
        ok, _ = gates.check_source_hash(manifest(), SOURCE_BYTES)
        self.assertTrue(ok)
        bad, reason = gates.check_source_hash(manifest(), SOURCE_BYTES + b"changed")
        self.assertFalse(bad)
        self.assertIn("source_sha256", reason)

    def test_pinned_firmware_run_must_match_source_sha_attempt_path_and_success(self):
        self.assertTrue(gates.check_firmware_run(FIRMWARE_SHA, firmware_run()).passed)
        mutations = (
            {"id": gates.FIRMWARE_PROOF["run_id"] + 1},
            {"run_attempt": 2},
            {"path": ".github/workflows/other.yml"},
            {"head_sha": OLD_SHA},
            {"event": "push"},
            {"status": "completed", "conclusion": "failure"},
            {"status": "in_progress", "conclusion": None},
        )
        for changes in mutations:
            with self.subTest(changes=changes):
                self.assertFalse(gates.check_firmware_run(FIRMWARE_SHA, firmware_run(**changes)).passed)

    def test_artifact_requires_exact_id_name_size_digest_run_sha_and_future_expiry(self):
        self.assertTrue(
            gates.check_firmware_artifact(FIRMWARE_SHA, artifact_payload(), now=NOW).passed
        )
        mutations = (
            {"id": gates.FIRMWARE_PROOF["artifact_id"] + 1},
            {"name": "lookalike"},
            {"size_in_bytes": gates.FIRMWARE_PROOF["artifact_size"] + 1},
            {"digest": "sha256:" + "0" * 64},
            {"expired": True},
            {"expires_at": "2026-10-27T00:00:00Z"},
            {"expires_at": "not-a-time"},
            {"workflow_run": {"id": 1, "head_sha": FIRMWARE_SHA}},
            {"workflow_run": {"id": gates.FIRMWARE_PROOF["run_id"], "head_sha": OLD_SHA}},
        )
        for changes in mutations:
            with self.subTest(changes=changes):
                self.assertFalse(
                    gates.check_firmware_artifact(
                        FIRMWARE_SHA, artifact_payload(artifact(**changes)), now=NOW
                    ).passed
                )
        extra = {"total_count": 2, "artifacts": [artifact(), artifact(id=99)]}
        self.assertFalse(gates.check_firmware_artifact(FIRMWARE_SHA, extra, now=NOW).passed)

    def test_local_bundle_requires_all_16_genuine_hex_and_current_lessons_source(self):
        report = gates.verify_local_firmware_bundle(gates.DEFAULT_FIRMWARE_DIR)
        self.assertEqual(len(report["lessons"]), 16)
        with tempfile.TemporaryDirectory() as folder:
            copied = Path(folder) / "firmware"
            shutil.copytree(gates.DEFAULT_FIRMWARE_DIR, copied)
            target = copied / "lesson_04.hex"
            target.write_bytes(target.read_bytes() + b"\n")
            with self.assertRaises(ValueError):
                gates.verify_local_firmware_bundle(copied)

    def test_downloaded_artifact_zip_must_match_digest_and_checkout_bytes_exactly(self):
        local_files = {
            path.name: path.read_bytes()
            for path in gates.DEFAULT_FIRMWARE_DIR.iterdir()
            if path.is_file()
        }
        self.assertEqual(set(local_files), gates.FIRMWARE_ARTIFACT_FILES)
        archive = zip_bytes(local_files)
        digest = "sha256:" + hashlib.sha256(archive).hexdigest()
        gates.verify_artifact_archive(archive, gates.DEFAULT_FIRMWARE_DIR, digest)

        with self.assertRaisesRegex(ValueError, "digest"):
            gates.verify_artifact_archive(archive, gates.DEFAULT_FIRMWARE_DIR, "sha256:" + "0" * 64)

        changed = dict(local_files)
        changed["lesson_01.hex"] += b"\n"
        changed_archive = zip_bytes(changed)
        changed_digest = "sha256:" + hashlib.sha256(changed_archive).hexdigest()
        with self.assertRaisesRegex(ValueError, "khác checkout"):
            gates.verify_artifact_archive(changed_archive, gates.DEFAULT_FIRMWARE_DIR, changed_digest)

        missing = dict(local_files)
        missing.pop("lesson_16.hex")
        missing_archive = zip_bytes(missing)
        missing_digest = "sha256:" + hashlib.sha256(missing_archive).hexdigest()
        with self.assertRaisesRegex(ValueError, "đúng manifest"):
            gates.verify_artifact_archive(missing_archive, gates.DEFAULT_FIRMWARE_DIR, missing_digest)

        traversal = dict(local_files)
        traversal["../escape"] = b"bad"
        traversal_archive = zip_bytes(traversal)
        traversal_digest = "sha256:" + hashlib.sha256(traversal_archive).hexdigest()
        with self.assertRaises(ValueError):
            gates.verify_artifact_archive(traversal_archive, gates.DEFAULT_FIRMWARE_DIR, traversal_digest)

    def test_verify_uses_final_sha_for_compiler_e2e_and_manifest_sha_for_firmware(self):
        firmware_manifest = manifest()
        final_payload = {"workflow_runs": [run()]}
        with mock.patch.object(
            gates, "request_workflow_runs", return_value=final_payload
        ) as workflow_runs, mock.patch.object(
            gates, "verify_local_firmware_bundle", return_value=firmware_manifest
        ), mock.patch.object(
            gates,
            "request_compare",
            return_value={"status": "ahead", "ahead_by": 4, "behind_by": 0},
        ) as compare, mock.patch.object(
            gates, "request_source_at_commit", return_value=SOURCE_BYTES
        ) as source, mock.patch.object(
            gates, "request_firmware_run", return_value=firmware_run()
        ), mock.patch.object(
            gates, "request_firmware_artifacts", return_value=artifact_payload()
        ), mock.patch.object(
            gates, "request_firmware_archive", return_value=b"synthetic-archive"
        ), mock.patch.object(gates, "verify_artifact_archive") as archive_check:
            result = gates.verify(REPO, FINAL_SHA, TOKEN, firmware_dir=Path("unused"), now=NOW)

        self.assertTrue(all(item.passed for item in result))
        self.assertEqual(workflow_runs.call_count, 2)
        self.assertEqual(
            {call.args[1] for call in workflow_runs.call_args_list},
            set(gates.FINAL_SHA_WORKFLOWS),
        )
        compare.assert_called_once_with(REPO, FIRMWARE_SHA, FINAL_SHA, TOKEN)
        source.assert_called_once_with(REPO, FIRMWARE_SHA, TOKEN)
        archive_check.assert_called_once()

    def test_invalid_sha_repository_token_and_workflow_are_rejected_before_network(self):
        with mock.patch.object(gates, "_request_json") as fetch:
            with self.assertRaises(ValueError):
                gates.verify("../other", FINAL_SHA, TOKEN)
            with self.assertRaises(ValueError):
                gates.verify(REPO, "abc", TOKEN)
            with self.assertRaises(ValueError):
                gates.verify(REPO, FINAL_SHA, "")
            with self.assertRaises(ValueError):
                gates.request_workflow_runs(REPO, gates.FIRMWARE_WORKFLOW, TOKEN)
        fetch.assert_not_called()

    def test_cross_host_redirect_strips_authorization_and_rejects_plain_http(self):
        handler = gates._SafeRedirectHandler()
        request = Request(
            "https://api.github.com/repos/example/repo/actions/artifacts/1/zip",
            headers={"Authorization": "Bearer secret", "Accept": "application/zip"},
        )
        redirected = handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "https://artifact-blob.example.net/file.zip?signed=true",
        )
        self.assertIsNotNone(redirected)
        self.assertIsNone(redirected.get_header("Authorization"))
        self.assertEqual(redirected.get_header("Accept"), "application/zip")

        same_host = handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "https://api.github.com/temporary/location",
        )
        self.assertEqual(same_host.get_header("Authorization"), "Bearer secret")

        with self.assertRaises(gates.URLError):
            handler.redirect_request(
                request,
                None,
                302,
                "Found",
                {},
                "http://artifact-blob.example.net/file.zip",
            )

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

    def test_pages_verifies_before_any_artifact_or_pages_upload_and_deploy(self):
        source = (
            Path(__file__).resolve().parents[1] / ".github/workflows/pages.yml"
        ).read_text(encoding="utf-8")
        gate = source.index("scripts/verify_release_gates.py")
        build_upload = source.index("uses: actions/upload-artifact")
        pages_upload = source.index("uses: actions/upload-pages-artifact")
        deploy = source.index("uses: actions/deploy-pages")
        self.assertLess(gate, build_upload)
        self.assertLess(build_upload, pages_upload)
        self.assertLess(pages_upload, deploy)
        self.assertIn("if: github.event_name == 'workflow_dispatch'", source)
        self.assertIn("actions: read", source)
        self.assertIn("needs: [check, release-gates]", source)

    def test_release_workflows_pin_every_github_action_to_full_sha(self):
        root = Path(__file__).resolve().parents[1]
        expected = {
            "actions/checkout": ("11d5960a326750d5838078e36cf38b85af677262", "v4.4.0"),
            "actions/setup-python": ("a26af69be951a213d495a4c3e4e4022e16d87065", "v5.6.0"),
            "actions/upload-artifact": ("ea165f8d65b6e75b540449e92b4886f43607fa02", "v4.6.2"),
            "actions/download-artifact": ("d3f86a106a0bac45b974a628896c90dbdf5c8093", "v4.3.0"),
            "actions/configure-pages": ("983d7736d9b0ae728b81ab479565c72886d7745b", "v5.0.0"),
            "actions/upload-pages-artifact": ("56afc609e74202658d3ffba0e8f6dda462b719fa", "v3.0.1"),
            "actions/deploy-pages": ("d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", "v4.0.5"),
        }
        seen = set()
        for relative in (
            ".github/workflows/pages.yml",
            ".github/workflows/release-gates-manual.yml",
        ):
            source = (root / relative).read_text(encoding="utf-8")
            self.assertNotRegex(source, r"uses:\s+[^\s@]+@v\d+(?:\s|$)")
            for line in source.splitlines():
                match = re.search(
                    r"uses:\s+(actions/[A-Za-z0-9_.-]+)@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)$",
                    line,
                )
                if not match:
                    if "uses:" in line:
                        self.fail(f"Unpinned or undocumented action in {relative}: {line.strip()}")
                    continue
                owner_action, sha, tag = match.groups()
                self.assertIn(owner_action, expected)
                self.assertEqual((sha, tag), expected[owner_action])
                seen.add(owner_action)
        self.assertEqual(seen, set(expected))

    def test_manual_preflight_has_no_deployment_actions(self):
        source = (
            Path(__file__).resolve().parents[1] / ".github/workflows/release-gates-manual.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("scripts/verify_release_gates.py", source)
        self.assertIn("actions: read", source)
        self.assertNotIn("deploy-pages", source)
        self.assertNotIn("upload-pages-artifact", source)


if __name__ == "__main__":
    unittest.main()
