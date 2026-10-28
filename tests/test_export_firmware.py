"""Offline contract tests; fake compiler output is never mistaken for AVR proof."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import export_firmware as fw


def record(address: int, kind: int, payload: bytes = b"") -> str:
    raw = bytes([len(payload), (address >> 8) & 255, address & 255, kind]) + payload
    return ":" + (raw + bytes([(-sum(raw)) & 255])).hex().upper()


def example_hex(value: int = 0) -> str:
    return "\n".join([
        record(0x0000, 0, bytes([value & 255, 0x00, 0x00, 0x00])),
        record(0, 1),
    ]) + "\n"


def sample_manifest(directory: Path, sha: str = "a" * 40) -> dict:
    lessons = []
    for lesson_id in range(1, 17):
        data = example_hex(lesson_id).encode("ascii")
        filename = f"lesson_{lesson_id:02d}.hex"
        (directory / filename).write_bytes(data)
        lessons.append({
            "id": lesson_id,
            "slug": f"lesson-{lesson_id}",
            "file": filename,
            "sketch_sha256": "b" * 64,
            "hex_bytes": len(data),
            "hex_sha256": fw.digest(data),
            "flash_sha256": fw.digest(fw.parse_intel_hex(data.decode("ascii"))),
        })
    result = {
        "schema_version": 1,
        "format": "arduino-uno-intel-hex",
        "git_sha": sha,
        "source_file": "src/lessons.js",
        "source_sha256": "c" * 64,
        "board": "arduino:avr:uno",
        "toolchain": {
            "arduino_cli": fw.EXPECTED_CLI,
            "arduino_avr_core": fw.EXPECTED_CORE,
            "servo_library": fw.EXPECTED_SERVO,
        },
        "lessons": lessons,
    }
    (directory / "manifest.json").write_text(json.dumps(result), encoding="utf-8")
    return result


class FirmwareExportTests(unittest.TestCase):
    def test_parser_validates_hex_checksums_and_bounds(self):
        memory = fw.parse_intel_hex(example_hex(0x5A))
        self.assertEqual(len(memory), 32768)
        self.assertEqual(memory[:4], bytes([0x5A, 0, 0, 0]))
        self.assertEqual(memory[4:], b"\xff" * (32768 - 4))

    def test_parser_rejects_invalid_checksum(self):
        damaged = example_hex(3).replace("00000003", "00000004")
        with self.assertRaisesRegex(fw.FirmwareError, "checksum"):
            fw.parse_intel_hex(damaged)

    def test_parser_rejects_overlapping_records(self):
        source = "\n".join([record(0, 0, b"\x11\x22"), record(1, 0, b"\x33"), record(0, 1)])
        with self.assertRaisesRegex(fw.FirmwareError, "trùng"):
            fw.parse_intel_hex(source)

    def test_parser_rejects_overflow_or_nonzero_upper_address(self):
        for source in (
            "\n".join([record(0x7FFE, 0, b"\x11\x22\x33"), record(0, 1)]),
            "\n".join([record(0, 4, b"\x00\x01"), record(0, 0, b"\x10"), record(0, 1)]),
        ):
            with self.subTest(source=source):
                with self.assertRaises(fw.FirmwareError):
                    fw.parse_intel_hex(source)

    def test_parser_rejects_missing_eof_or_data_after_eof(self):
        for source in (
            record(0, 0, b"\x10"),
            "\n".join([record(0, 0, b"\x10"), record(0, 1), record(1, 0, b"\x11")]),
        ):
            with self.assertRaises(fw.FirmwareError):
                fw.parse_intel_hex(source)

    def test_accepts_complete_allowlisted_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            sample_manifest(path)
            self.assertEqual(len(fw.verify_firmware_bundle(path, expected_sha="a" * 40)["lessons"]), 16)

    def test_wrong_git_revision_and_mutated_hex_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            sample_manifest(path)
            with self.assertRaisesRegex(fw.FirmwareError, "SHA"):
                fw.verify_firmware_bundle(path, expected_sha="f" * 40)
            (path / "lesson_04.hex").write_text(example_hex(7), encoding="ascii")
            with self.assertRaisesRegex(fw.FirmwareError, "khớp"):
                fw.verify_firmware_bundle(path)

    def test_missing_or_unexpected_file_and_version_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            sample_manifest(path)
            (path / "README.txt").write_text("extra", encoding="utf-8")
            with self.assertRaisesRegex(fw.FirmwareError, "dư"):
                fw.verify_firmware_bundle(path)
            (path / "README.txt").unlink()
            manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
            manifest["toolchain"]["servo_library"] = "not-pinned"
            (path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(fw.FirmwareError, "công cụ"):
                fw.verify_firmware_bundle(path)

    def test_build_only_compiles_allowlisted_sketches_with_output_checks(self):
        # This mocks arduino-cli to exercise the packaging mechanics safely.
        # It is NOT evidence of real firmware compilation.
        with tempfile.TemporaryDirectory(prefix="arduino3d-firmware-test-", dir=fw.ROOT) as folder:
            root = Path(folder)
            cli = root / "arduino-cli"
            cli.write_bytes(b"test-binary-not-executed")
            servo = root / "Servo"
            (servo / "src").mkdir(parents=True)
            (servo / "library.properties").write_text("name=Servo\nversion=1.3.0\n", encoding="utf-8")
            (servo / "src" / "Servo.h").write_text("// fixture", encoding="ascii")
            seen = []

            def fake_cli(args, *, timeout=45):
                if args[1] == "version":
                    return "arduino-cli  Version: 1.5.1"
                if args[1:3] == ["core", "list"]:
                    return "arduino:avr 1.8.6 /path/to/avr"
                self.assertEqual(args[1], "compile")
                self.assertNotIn("upload", args)
                self.assertNotIn("--upload", args)
                self.assertIn("--library", args)
                self.assertEqual(args[args.index("--library") + 1], str(servo))
                sketch_name = Path(args[-1]).name
                build_dir = Path(args[args.index("--build-path") + 1])
                lesson_id = int(sketch_name.split("_")[1])
                (build_dir / (sketch_name + ".ino.hex")).write_text(example_hex(lesson_id), encoding="ascii")
                seen.append(lesson_id)
                return "Sketch uses 4 bytes"

            with mock.patch.object(fw, "_run_cli", side_effect=fake_cli):
                target = root / "build"
                report = fw.build_firmware_bundle(cli, servo, target, "a" * 40)
            self.assertEqual(seen, list(range(1, 17)))
            self.assertEqual(len(report["lessons"]), 16)
            self.assertTrue((target / "manifest.json").is_file())
            with self.assertRaisesRegex(fw.FirmwareError, "ghi đè"):
                fw.build_firmware_bundle(cli, servo, target, "a" * 40)

    def test_does_not_write_to_arbitrary_or_source_destinations(self):
        with mock.patch.object(fw, "_verify_dependencies") as verify:
            with self.assertRaises(fw.FirmwareError):
                fw.build_firmware_bundle(Path("cli"), Path("Servo"), fw.ROOT / "src" / "firmware", "a" * 40)
            verify.assert_not_called()


if __name__ == "__main__":
    unittest.main()
