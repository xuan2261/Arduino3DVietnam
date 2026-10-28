"""Deterministic tests for the offline hardware-evidence validator."""
from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from scripts import validate_hardware_evidence as validator


def sample_report() -> dict:
    lessons = []
    for lesson_id, title in validator.CANONICAL_LESSONS.items():
        lessons.append(
            {
                "lesson_id": lesson_id,
                "lesson_title": title,
                "reviewed_at": f"2026-10-28T09:{lesson_id:02d}:00+07:00",
                "evidence_refs": [f"lab-log-{lesson_id:02d}"],
                "measurements": [
                    {
                        "name": f"lesson-{lesson_id:02d}-behavior-marker",
                        "unit": "state",
                        "source_ref": f"observation-{lesson_id:02d}",
                        "expected": {"operator": "eq", "value": "observed"},
                        "observed": "observed",
                        "observed_at": f"2026-10-28T08:{lesson_id:02d}:00+07:00",
                    }
                ],
            }
        )
    return {
        "schema_version": 1,
        "project": "Arduino3DVietnam",
        "board": "Arduino Uno R3",
        "report_id": "educator-run-20261028-a",
        "report_created_at": "2026-10-28T10:30:00+07:00",
        "provenance": {
            "collector_name": "Qualified educator fixture",
            "collector_role": "qualified_educator",
            "collection_method": "manual_hardware_observation",
            "source_revision": "cfb9ba05",
            "evidence_set_ref": "offline-lab-notebook-fixture",
        },
        "lessons": lessons,
    }


class HardwareEvidenceTests(unittest.TestCase):
    def test_complete_matching_report_is_consistent(self):
        payload = sample_report()
        payload["lessons"][0]["measurements"][0].update(
            expected={"operator": "between", "min": 100, "max": 200},
            observed=150,
        )
        payload["lessons"][1]["measurements"][0].update(
            expected={"operator": "approx", "value": 1000, "tolerance": 25},
            observed=1025,
        )
        report = validator.review_evidence(payload)
        self.assertTrue(report["evidence_consistent"])
        self.assertEqual(report["lesson_ids_present"], list(range(1, 17)))
        self.assertEqual(report["comparison_count"], 16)
        self.assertEqual(report["issues"], [])
        self.assertEqual({row["status"] for row in report["comparisons"]}, {"match"})

    def test_mismatch_and_numeric_type_mismatch_are_reported(self):
        payload = sample_report()
        first = payload["lessons"][0]["measurements"][0]
        first["observed"] = "different"
        second = payload["lessons"][1]["measurements"][0]
        second["expected"] = {"operator": "between", "min": 0, "max": 10}
        second["observed"] = "not-a-number"
        report = validator.review_evidence(payload)
        codes = {row["code"] for row in report["issues"]}
        self.assertFalse(report["evidence_consistent"])
        self.assertIn("measurement_mismatch", codes)
        self.assertIn("measurement_type_mismatch", codes)
        self.assertEqual(
            {row["status"] for row in report["comparisons"] if "lessons[0]" in row["path"]},
            {"mismatch"},
        )

    def test_missing_expected_or_observed_is_detected_without_comparison(self):
        payload = sample_report()
        payload["lessons"][0]["measurements"][0].pop("expected")
        payload["lessons"][1]["measurements"][0].pop("observed")
        payload["lessons"][1]["measurements"][0].pop("observed_at")
        report = validator.review_evidence(payload)
        codes = [row["code"] for row in report["issues"]]
        self.assertIn("expected_missing", codes)
        self.assertIn("observed_missing", codes)
        self.assertEqual(report["comparison_count"], 14)

    def test_missing_duplicate_title_and_evidence_are_detected(self):
        payload = sample_report()
        payload["lessons"].pop()
        payload["lessons"][1]["lesson_id"] = 1
        payload["lessons"][2]["lesson_title"] = "Wrong title"
        payload["lessons"][3]["evidence_refs"] = []
        payload["lessons"][4]["measurements"] = []
        report = validator.review_evidence(payload)
        codes = {row["code"] for row in report["issues"]}
        self.assertIn("duplicate_lesson", codes)
        self.assertIn("lesson_missing", codes)
        self.assertIn("lesson_title_mismatch", codes)
        self.assertIn("evidence_ref_missing", codes)
        self.assertIn("measurements_missing", codes)

    def test_inconsistent_timestamps_are_detected(self):
        payload = sample_report()
        payload["lessons"][0]["reviewed_at"] = "2026-10-28T11:00:00+07:00"
        payload["lessons"][1]["measurements"][0]["observed_at"] = "2026-10-28T10:00:00+07:00"
        payload["lessons"][1]["reviewed_at"] = "2026-10-28T09:00:00+07:00"
        report = validator.review_evidence(payload)
        codes = {row["code"] for row in report["issues"]}
        self.assertIn("lesson_timestamp_after_report", codes)
        self.assertIn("measurement_timestamp_after_review", codes)

    def test_schema_requires_timezone_known_provenance_and_rejects_unknown_fields(self):
        payload = sample_report()
        payload["report_created_at"] = "2026-10-28T10:30:00"
        with self.assertRaisesRegex(validator.EvidenceError, "múi giờ"):
            validator.review_evidence(payload)

        payload = sample_report()
        payload["provenance"]["collector_role"] = "unknown"
        with self.assertRaisesRegex(validator.EvidenceError, "qualified_educator"):
            validator.review_evidence(payload)

        payload = sample_report()
        payload["claimed_pass"] = True
        with self.assertRaisesRegex(validator.EvidenceError, "không được phép"):
            validator.review_evidence(payload)

    def test_expected_schema_rejects_invalid_ranges_and_nonfinite_numbers(self):
        payload = sample_report()
        payload["lessons"][0]["measurements"][0]["expected"] = {
            "operator": "between",
            "min": 2,
            "max": 1,
        }
        with self.assertRaisesRegex(validator.EvidenceError, "min"):
            validator.review_evidence(payload)

        payload = sample_report()
        payload["lessons"][0]["measurements"][0]["observed"] = float("inf")
        with self.assertRaisesRegex(validator.EvidenceError, "giới hạn số"):
            validator.review_evidence(payload)

    def test_loader_rejects_duplicate_keys_size_suffix_and_long_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            duplicate = root / "duplicate.json"
            duplicate.write_text('{"schema_version": 1, "schema_version": 1}', encoding="utf-8")
            with self.assertRaisesRegex(validator.EvidenceError, "bị lặp"):
                validator.load_evidence(duplicate)

            too_large = root / "large.json"
            too_large.write_bytes(b" " * (validator.MAX_FILE_BYTES + 1))
            with self.assertRaisesRegex(validator.EvidenceError, "vượt quá"):
                validator.load_evidence(too_large)

            wrong_suffix = root / "evidence.txt"
            wrong_suffix.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(validator.EvidenceError, "\.json"):
                validator.load_evidence(wrong_suffix)

        with self.assertRaisesRegex(validator.EvidenceError, "Đường dẫn"):
            validator.load_evidence("x" * (validator.MAX_PATH_CHARS + 1) + ".json")
        with self.assertRaisesRegex(validator.EvidenceError, "local"):
            validator.load_evidence(r"\\server\share\evidence.json")
        with self.assertRaisesRegex(validator.EvidenceError, "local"):
            validator.load_evidence(r"\\?\C:\evidence.json")

    def test_loader_rejects_symbolic_link_when_platform_allows_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "target.json"
            target.write_text("{}", encoding="utf-8")
            link = root / "link.json"
            try:
                os.symlink(target, link)
            except (OSError, NotImplementedError):
                self.skipTest("symbolic links are unavailable in this environment")
            with self.assertRaisesRegex(validator.EvidenceError, "symbolic link"):
                validator.load_evidence(link)

    def test_verify_file_and_cli_are_offline_deterministic_reviews(self):
        payload = sample_report()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "evidence.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            report, exit_code = validator.verify_file(path)
            self.assertEqual(exit_code, 0)
            self.assertTrue(report["evidence_consistent"])
            self.assertEqual(report["capabilities"]["hardware_access"], "none")
            self.assertEqual(report["capabilities"]["external_access"], "none")

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                cli_exit = validator.main(["--verify", str(path), "--json"])
            self.assertEqual(cli_exit, 0)
            decoded = json.loads(stdout.getvalue())
            self.assertTrue(decoded["evidence_consistent"])
            self.assertNotIn("PASS", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
