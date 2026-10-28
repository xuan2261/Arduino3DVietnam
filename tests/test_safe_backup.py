"""Temporary-fixture tests for the v1.5 local safe-backup contract."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from scripts import package_safe_backup as backup


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return result.stdout.strip()


class Fixture:
    def __init__(self, root: Path):
        self.root = root
        lesson_rows = []
        self.sketch_sources = []
        for lesson_id in range(1, 17):
            sketch = (
                f"// fixture lesson {lesson_id:02d}\n"
                "void setup() {}\n"
                "void loop() {}\n"
            )
            self.sketch_sources.append(sketch)
            lesson_rows.append(
                "  {\n"
                f'    id: {lesson_id}, slug: "lesson-{lesson_id:02d}",\n'
                "    sketch: " + chr(96) + sketch.rstrip() + chr(96) + ",\n"
                "    quiz: {}\n"
                "  }"
            )
        self.lessons = (
            "export const lessons = Object.freeze([\n"
            + ",\n".join(lesson_rows)
            + "\n]);\n"
        ).encode("utf-8")
        self.upstream_snapshots = {
            (
                "assets/vendor/avr/avr8js-0.21.1-source/"
                + filename
            ): f"// upstream fixture {filename}\n".encode("utf-8")
            for filename in ("cpu.ts", "instruction.ts", "interrupt.ts")
        }
        self.hexes = {
            f"lesson_{lesson_id:02d}.hex": (
                f":04000000{lesson_id:02X}000000{(0xFC - lesson_id) & 0xFF:02X}\n"
                ":00000001FF\n"
            ).encode("ascii")
            for lesson_id in range(1, 17)
        }

    def write(self, relative: str, data: bytes) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def initialize(self) -> tuple[str, Path, Path]:
        git(self.root, "init")
        git(self.root, "config", "user.email", "fixture@example.invalid")
        git(self.root, "config", "user.name", "Backup Fixture")
        git(self.root, "config", "core.autocrlf", "false")
        self.write("README.md", b"# fixture\n")
        self.write("index.html", b"<!doctype html><title>fixture</title>\n")
        self.write(
            "site.webmanifest",
            b'{"lang":"vi","start_url":"./","scope":"./"}\n',
        )
        self.write("src/lessons.js", self.lessons)
        self.write("docs/owned.md", b"owned\n")
        self.write("scripts/tool.py", b"print('fixture')\n")
        self.write("tests/test_placeholder.py", b"# fixture\n")
        self.write("sources/upstream/snapshot.txt", b"must never be archived\n")
        self.write(".env", b"TOKEN=must-not-archive\n")
        for relative, data in self.upstream_snapshots.items():
            self.write(relative, data)
        for name, data in self.hexes.items():
            self.write(f"assets/firmware/{name}", data)

        asset_paths = [
            "index.html",
            "site.webmanifest",
            "src/lessons.js",
            *sorted(self.upstream_snapshots),
            "assets/firmware/manifest.json",
            *[
                f"assets/firmware/lesson_{index:02d}.hex"
                for index in range(1, 17)
            ],
        ]
        assets_js = ",\n  ".join(
            json.dumps("./" + name) for name in asset_paths
        )
        sw = (
            'const CACHE = "arduino3d-viet-static-source";\n'
            f'const ASSETS = [\n  "./",\n  {assets_js}\n];\n'
        ).encode("utf-8")
        self.write("sw.js", sw)
        git(
            self.root,
            "add",
            "README.md",
            "index.html",
            "site.webmanifest",
            "sw.js",
            "src",
            "docs",
            "scripts",
            "tests",
            "sources",
            "assets/vendor",
        )
        git(self.root, "commit", "-m", "base source")
        base_sha = git(self.root, "rev-parse", "HEAD")

        manifest = {
            "schema_version": 1,
            "format": "arduino-uno-intel-hex",
            "git_sha": base_sha,
            "source_file": "src/lessons.js",
            "source_sha256": sha(self.lessons),
            "board": "arduino:avr:uno",
            "toolchain": {
                "arduino_cli": "1.5.1",
                "arduino_avr_core": "1.8.6",
                "servo_library": "1.3.0",
            },
            "lessons": [],
        }
        for lesson_id, (name, data) in enumerate(
            sorted(self.hexes.items()),
            start=1,
        ):
            manifest["lessons"].append(
                {
                    "id": lesson_id,
                    "slug": f"lesson-{lesson_id:02d}",
                    "file": name,
                    "sketch_sha256": sha(
                        self.sketch_sources[lesson_id - 1].encode("utf-8")
                    ),
                    "hex_bytes": len(data),
                    "hex_sha256": sha(data),
                    "flash_sha256": sha(
                        backup.export_firmware.parse_intel_hex(
                            data.decode("ascii")
                        )
                    ),
                }
            )
        self.write(
            "assets/firmware/manifest.json",
            (json.dumps(manifest, sort_keys=True) + "\n").encode("utf-8"),
        )
        git(self.root, "add", "assets/firmware")
        git(self.root, "commit", "-m", "firmware bundle")
        head = git(self.root, "rev-parse", "HEAD")

        # Dirty/untracked material must never enter a pinned source backup.
        self.write("docs/uncommitted.md", b"not in HEAD\n")

        dist = self.root / "dist-fixture"
        dist.mkdir()
        self._build_dist(dist, asset_paths)
        return head, dist, self.root / "assets/firmware"

    def _build_dist(self, dist: Path, asset_paths: list[str]) -> None:
        for relative in asset_paths:
            source = self.root / relative
            target = dist / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        source_sw = (self.root / "sw.js").read_text(encoding="utf-8")
        digest = hashlib.sha256()
        for name in sorted(asset_paths):
            digest.update(name.encode("utf-8"))
            digest.update(b"\x00")
            digest.update((dist / name).read_bytes())
        cache = f"arduino3d-viet-static-{digest.hexdigest()[:16]}"
        built_sw = re.sub(
            r'const CACHE = "arduino3d-viet-static-[a-zA-Z0-9-]+";',
            f'const CACHE = "{cache}";',
            source_sw,
            count=1,
        )
        (dist / "sw.js").write_text(
            built_sw,
            encoding="utf-8",
            newline="\n",
        )
        (dist / backup.BUILD_MARKER).write_bytes(
            backup.BUILD_MARKER_BYTES
        )


class SafeBackupTests(unittest.TestCase):
    def make_fixture(self):
        temp = tempfile.TemporaryDirectory(
            prefix="arduino3d-safe-backup-test-"
        )
        root = Path(temp.name)
        fixture = Fixture(root)
        head, dist, firmware = fixture.initialize()
        return temp, fixture, head, dist, firmware

    def test_happy_path_uses_pinned_head_and_preserves_old_backup(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        old = fixture.root / "releases/v1.4.0-20261028"
        old.mkdir(parents=True)
        (old / "keep.txt").write_text("old backup", encoding="utf-8")

        result = backup.create_backup(
            repo_root=fixture.root,
            version_date="v1.5.0-20261028",
            head_sha=head,
            dist_dir=dist,
            firmware_dir=firmware,
        )

        self.assertEqual(
            (old / "keep.txt").read_text(encoding="utf-8"),
            "old backup",
        )
        self.assertEqual(
            result.directory.resolve(),
            (fixture.root / "releases/v1.5.0-20261028").resolve(),
        )
        with ZipFile(result.source_zip) as archive:
            names = archive.namelist()
        self.assertIn("docs/owned.md", names)
        self.assertNotIn("docs/uncommitted.md", names)
        self.assertFalse(any(name.startswith("sources/") for name in names))
        self.assertNotIn(".env", names)
        with ZipFile(result.firmware_zip) as archive:
            self.assertEqual(
                sorted(archive.namelist()),
                sorted(
                    [
                        "assets/firmware/manifest.json",
                        *[
                            f"assets/firmware/lesson_{index:02d}.hex"
                            for index in range(1, 17)
                        ],
                    ]
                ),
            )
        sums = result.sha256sums.read_text(
            encoding="ascii"
        ).splitlines()
        self.assertEqual(len(sums), 4)
        for line in sums:
            digest, filename = line.split("  ", 1)
            self.assertEqual(
                digest,
                sha((result.directory / filename).read_bytes()),
            )

    def test_deterministic_zip_order_and_digest(self):
        files = {
            "z.txt": b"z",
            "a.txt": b"a",
            "nested/b.txt": b"b",
        }
        first = backup._zip_bytes(files)
        second = backup._zip_bytes(
            dict(reversed(list(files.items())))
        )
        self.assertEqual(first, second)
        self.assertEqual(sha(first), sha(second))

    def test_source_zip_excludes_upstream_snapshots_but_dist_keeps_pinned_bytes(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        result = backup.create_backup(
            repo_root=fixture.root,
            version_date="v1.5.0-20261028",
            head_sha=head,
            dist_dir=dist,
            firmware_dir=firmware,
        )
        with ZipFile(result.source_zip) as source_archive:
            source_names = set(source_archive.namelist())
        with ZipFile(result.dist_zip) as dist_archive:
            dist_names = set(dist_archive.namelist())
            for relative, expected in fixture.upstream_snapshots.items():
                self.assertNotIn(relative, source_names)
                self.assertIn(relative, dist_names)
                self.assertEqual(dist_archive.read(relative), expected)
        metadata = json.loads(result.metadata.read_text(encoding="utf-8"))
        self.assertEqual(
            metadata["source"]["excluded_upstream_prefixes"],
            [backup.UPSTREAM_SOURCE_SNAPSHOT_PREFIX],
        )
        self.assertGreater(
            metadata["source"]["verification_blob_count"],
            metadata["source"]["file_count"],
        )

    def test_dist_missing_marker_and_incomplete_are_rejected(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        entries = backup.collect_source_entries(fixture.root, head)
        blobs = backup.read_source_blobs(fixture.root, entries)
        (dist / backup.BUILD_MARKER).unlink()
        with self.assertRaisesRegex(backup.BackupError, "marker"):
            backup.validate_dist_files(
                backup._walk_regular_files(dist),
                blobs,
            )
        (dist / backup.BUILD_MARKER).write_bytes(
            backup.BUILD_MARKER_BYTES
        )
        (dist / "index.html").unlink()
        with self.assertRaisesRegex(backup.BackupError, "thiếu"):
            backup.validate_dist_files(
                backup._walk_regular_files(dist),
                blobs,
            )

    def test_firmware_tampering_is_rejected(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        entries = backup.collect_source_entries(fixture.root, head)
        blobs = backup.read_source_blobs(fixture.root, entries)
        victim = firmware / "lesson_08.hex"
        victim.write_bytes(victim.read_bytes() + b"\n")
        with self.assertRaisesRegex(
            backup.BackupError,
            "pinned HEAD|tamper",
        ):
            backup.validate_firmware_files(
                backup._walk_regular_files(firmware),
                blobs,
                fixture.root,
                head,
            )

    def test_committed_tampered_sketch_hash_is_rejected_against_pinned_source(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        manifest_path = firmware / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["lessons"][4]["sketch_sha256"] = "0" * 64
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        git(fixture.root, "add", "assets/firmware/manifest.json")
        git(fixture.root, "commit", "-m", "tampered sketch hash fixture")
        tampered_head = git(fixture.root, "rev-parse", "HEAD")
        entries = backup.collect_source_entries(
            fixture.root,
            tampered_head,
        )
        blobs = backup.read_source_blobs(fixture.root, entries)
        with self.assertRaisesRegex(
            backup.BackupError,
            "sketch SHA/slug",
        ):
            backup.validate_firmware_files(
                backup._walk_regular_files(firmware),
                blobs,
                fixture.root,
                tampered_head,
            )

    def test_committed_tampered_flash_hash_is_rejected_after_strict_hex_parse(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        manifest_path = firmware / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["lessons"][7]["flash_sha256"] = "0" * 64
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        git(fixture.root, "add", "assets/firmware/manifest.json")
        git(fixture.root, "commit", "-m", "tampered flash hash fixture")
        tampered_head = git(fixture.root, "rev-parse", "HEAD")
        entries = backup.collect_source_entries(
            fixture.root,
            tampered_head,
        )
        blobs = backup.read_source_blobs(fixture.root, entries)
        with self.assertRaisesRegex(
            backup.BackupError,
            "flash SHA",
        ):
            backup.validate_firmware_files(
                backup._walk_regular_files(firmware),
                blobs,
                fixture.root,
                tampered_head,
            )

    def test_outside_root_symlink_is_rejected_when_supported(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        outside = (
            Path(temp.name).parent
            / f"{Path(temp.name).name}-outside.txt"
        )
        outside.write_text("outside", encoding="utf-8")
        self.addCleanup(lambda: outside.unlink(missing_ok=True))
        link = dist / "escape-link.txt"
        try:
            os.symlink(outside, link)
        except (OSError, NotImplementedError) as error:
            self.skipTest(
                f"OS/user cannot create symlink fixture: {error}"
            )
        with self.assertRaisesRegex(
            backup.BackupError,
            "Symlink|reparse",
        ):
            backup._walk_regular_files(dist)

    def test_input_path_through_internal_symlink_is_rejected(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        link = fixture.root / "dist-link"
        try:
            os.symlink(dist, link, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(
                f"OS/user cannot create directory symlink fixture: {error}"
            )
        with self.assertRaisesRegex(
            backup.BackupError,
            "symlink|reparse",
        ):
            backup._resolve_input_under_root(
                fixture.root.resolve(),
                link,
                want_dir=True,
            )

    def test_nested_git_directory_is_rejected_before_packaging(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        nested_git = dist / ".git"
        nested_git.mkdir()
        (nested_git / "config").write_text(
            "must never be enumerated into archive",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(
            backup.BackupError,
            "bị cấm|Nested .git",
        ):
            backup._walk_regular_files(dist)

    def test_zip_traversal_and_wrong_artifact_digest_are_rejected(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        malicious = fixture.root / "artifact.zip"
        with ZipFile(
            malicious,
            "w",
            compression=ZIP_DEFLATED,
        ) as archive:
            archive.writestr("../escape.txt", b"bad")
        with self.assertRaisesRegex(
            backup.BackupError,
            "traversal",
        ):
            backup._zip_files(malicious.read_bytes())
        with self.assertRaisesRegex(
            backup.BackupError,
            "SHA-256",
        ):
            backup.create_backup(
                repo_root=fixture.root,
                version_date="v1.5.0-20261028",
                head_sha=head,
                dist_artifact=malicious,
                dist_artifact_sha256="0" * 64,
                firmware_dir=firmware,
            )

    def test_exact_dist_artifact_is_preserved_byte_for_byte(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        dist_files = backup._walk_regular_files(dist)
        artifact_bytes = backup._zip_bytes(dist_files)
        artifact = fixture.root / "verified-pages-artifact.zip"
        artifact.write_bytes(artifact_bytes)

        result = backup.create_backup(
            repo_root=fixture.root,
            version_date="v1.5.0-20261028",
            head_sha=head,
            dist_artifact=artifact,
            dist_artifact_sha256=sha(artifact_bytes),
            firmware_dir=firmware,
        )

        self.assertEqual(result.dist_zip.read_bytes(), artifact_bytes)
        metadata = json.loads(result.metadata.read_text(encoding="utf-8"))
        self.assertEqual(
            metadata["dist"]["mode"],
            "exact-release-gate-artifact",
        )

    def test_wrong_head_and_existing_target_fail_without_overwrite(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        with self.assertRaisesRegex(
            backup.BackupError,
            "legacy",
        ):
            backup.create_backup(
                repo_root=fixture.root,
                version_date="v1.4.0-20261028",
                head_sha=head,
                dist_dir=dist,
                firmware_dir=firmware,
            )
        with self.assertRaisesRegex(
            backup.BackupError,
            "ngày lịch",
        ):
            backup.create_backup(
                repo_root=fixture.root,
                version_date="v1.5.0-20261340",
                head_sha=head,
                dist_dir=dist,
                firmware_dir=firmware,
            )
        with self.assertRaisesRegex(
            backup.BackupError,
            "HEAD hiện tại",
        ):
            backup.create_backup(
                repo_root=fixture.root,
                version_date="v1.5.0-20261028",
                head_sha="f" * 40,
                dist_dir=dist,
                firmware_dir=firmware,
            )

        target = fixture.root / "releases/v1.5.0-20261028"
        target.mkdir(parents=True)
        sentinel = target / "sentinel.txt"
        sentinel.write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(
            backup.BackupError,
            "overwrite",
        ):
            backup.create_backup(
                repo_root=fixture.root,
                version_date="v1.5.0-20261028",
                head_sha=head,
                dist_dir=dist,
                firmware_dir=firmware,
            )
        self.assertEqual(
            sentinel.read_text(encoding="utf-8"),
            "keep",
        )

    def test_tracked_credential_name_is_fail_closed(self):
        temp, fixture, head, dist, firmware = self.make_fixture()
        self.addCleanup(temp.cleanup)
        git(fixture.root, "add", ".env")
        git(fixture.root, "commit", "-m", "tracked credential fixture")
        credential_head = git(fixture.root, "rev-parse", "HEAD")
        with self.assertRaisesRegex(
            backup.BackupError,
            "nhạy cảm",
        ):
            backup.collect_source_entries(
                fixture.root,
                credential_head,
            )


if __name__ == "__main__":
    unittest.main()
