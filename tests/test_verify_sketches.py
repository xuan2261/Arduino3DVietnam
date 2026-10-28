"""Tests cho đường xác minh Arduino C++ an toàn, không cần arduino-cli thật."""
from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import verify_sketches as verifier


class VerifySketchesTests(unittest.TestCase):
    def test_extracts_exact_16_allowlisted_sketches(self):
        sketches = verifier.extract_sketches()
        self.assertEqual([item.lesson_id for item in sketches], list(range(1, 17)))
        self.assertTrue(all("void " in item.source for item in sketches))
        self.assertIn("#include <Servo.h>", sketches[11].source)

    def test_rejects_source_that_does_not_have_full_allowlist(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "lessons.js"
            source.write_text(
                'id: 1, slug: "only-one", sketch: `void setup() {}\nvoid loop() {}`,\n quiz:',
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "1..16"):
                verifier.extract_sketches(source)

    def test_rejects_traversal_slug_in_bundled_source(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "lessons.js"
            text = verifier.LESSONS_FILE.read_text(encoding="utf-8")
            source.write_text(text.replace('slug: "lam-quen-arduino"', 'slug: "../escape"', 1),
                              encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "slug"):
                verifier.extract_sketches(source)

    def test_rejects_direct_compile_with_untrusted_slug(self):
        fake = verifier.Sketch(
            lesson_id=2,
            slug="../../outside",
            source="void setup() {}\nvoid loop() {}",
        )
        with mock.patch.object(verifier, "_run_process") as process:
            with self.assertRaisesRegex(ValueError, "phạm vi"):
                verifier.compile_sketch(fake, Path("C:/Arduino/arduino-cli.exe"))
        process.assert_not_called()

    def test_missing_cli_is_reported_without_fake_compile(self):
        with mock.patch.object(verifier, "find_arduino_cli", return_value=None), mock.patch.object(
            verifier, "_run_process"
        ) as run_process:
            report, exit_code = verifier.verify(compile_requested=True, lesson_ids=[1, 16])
        self.assertEqual(exit_code, 2)
        self.assertEqual(report["capabilities"]["compile"]["state"], "unavailable")
        self.assertEqual(report["capabilities"]["simulation"]["state"], "available")
        self.assertEqual(report["capabilities"]["hardware"]["state"], "unsupported")
        self.assertEqual(
            [row["status"] for row in report["results"]],
            ["skipped_compiler_unavailable", "skipped_compiler_unavailable"],
        )
        run_process.assert_not_called()

    def test_probe_requires_installed_avr_core(self):
        cli = Path("C:/Arduino/arduino-cli.exe")
        responses = [
            subprocess.CompletedProcess([str(cli), "version"], 0, "arduino-cli Version: 1.3.1\n", ""),
            subprocess.CompletedProcess(
                [str(cli), "core", "list", "--format", "json"],
                0,
                '{"platforms":[{"id":"arduino:avr","installed":"1.8.6"}]}',
                "",
            ),
        ]
        with mock.patch.object(verifier, "_run_process", side_effect=responses):
            info = verifier.probe_compiler(cli)
        self.assertTrue(info["available"])
        self.assertTrue(info["core_available"])
        self.assertIn("arduino:avr", info["reason"])

    def test_compile_command_is_compile_only_and_uses_temp_sketch(self):
        sketch = verifier.Sketch(
            lesson_id=1,
            slug="lam-quen-arduino",
            source="void setup() {}\nvoid loop() {}\n",
        )
        captured: list[list[str]] = []

        def fake_run(command, *, timeout, cwd=verifier.ROOT):
            captured.append(command)
            return subprocess.CompletedProcess(command, 0, "Sketch uses 100 bytes", "")

        with mock.patch.object(verifier, "_run_process", side_effect=fake_run):
            result = verifier.compile_sketch(sketch, Path("C:/Arduino/arduino-cli.exe"))

        self.assertEqual(result["status"], "compiled")
        self.assertEqual(len(captured), 1)
        command = captured[0]
        self.assertIn("compile", command)
        self.assertIn(verifier.FQBN, command)
        self.assertNotIn("upload", command)
        self.assertNotIn("core", command)
        self.assertNotIn("install", command)
        sketch_path = Path(command[-1])
        self.assertTrue(sketch_path.name.startswith("lesson_01_"))
        self.assertIn("arduino3dvn-01-", str(sketch_path))

    def test_compile_can_pin_an_existing_library_root(self):
        sketch = verifier.Sketch(
            lesson_id=12,
            slug="dong-co-servo",
            source="#include <Servo.h>\nvoid setup() {}\nvoid loop() {}\n",
        )
        captured: list[list[str]] = []

        def fake_run(command, *, timeout, cwd=verifier.ROOT):
            captured.append(command)
            return subprocess.CompletedProcess(command, 0, "Sketch uses 100 bytes", "")

        with tempfile.TemporaryDirectory() as temp:
            servo = Path(temp) / "Servo"
            servo.mkdir()
            (servo / "library.properties").write_text(
                "name=Servo\nversion=1.3.0\narchitectures=avr\n",
                encoding="utf-8",
            )
            with mock.patch.object(verifier, "_run_process", side_effect=fake_run):
                result = verifier.compile_sketch(
                    sketch,
                    Path("C:/Arduino/arduino-cli.exe"),
                    libraries=[servo],
                )

        self.assertEqual(result["status"], "compiled")
        command = captured[0]
        library_index = command.index("--library")
        self.assertEqual(Path(command[library_index + 1]), servo.resolve())
        self.assertEqual(result["libraries"], [str(servo.resolve())])

    def test_rejects_non_library_path_before_compile(self):
        sketch = verifier.Sketch(
            lesson_id=12,
            slug="dong-co-servo",
            source="#include <Servo.h>\nvoid setup() {}\nvoid loop() {}\n",
        )
        with tempfile.TemporaryDirectory() as temp, mock.patch.object(
            verifier, "_run_process"
        ) as process:
            with self.assertRaisesRegex(ValueError, "library.properties"):
                verifier.compile_sketch(
                    sketch,
                    Path("C:/Arduino/arduino-cli.exe"),
                    libraries=[Path(temp)],
                )
        process.assert_not_called()

    def test_lesson_selection_cannot_escape_allowlist(self):
        with self.assertRaisesRegex(ValueError, "allowlist"):
            verifier.verify(compile_requested=False, lesson_ids=[17])

    def test_utf8_stdio_configuration_handles_legacy_windows_console(self):
        class FakeStream:
            def __init__(self):
                self.calls = []

            def reconfigure(self, **kwargs):
                self.calls.append(kwargs)

        stdout = FakeStream()
        stderr = FakeStream()
        with mock.patch.object(verifier.sys, "stdout", stdout), mock.patch.object(
            verifier.sys, "stderr", stderr
        ):
            verifier._configure_utf8_stdio()
        self.assertEqual(stdout.calls, [{"encoding": "utf-8", "errors": "replace"}])
        self.assertEqual(stderr.calls, [{"encoding": "utf-8", "errors": "replace"}])


if __name__ == "__main__":
    unittest.main()
