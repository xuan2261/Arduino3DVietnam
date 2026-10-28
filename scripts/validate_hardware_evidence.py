"""Validate manually collected hardware evidence for Arduino3DVietnam.

This module is intentionally offline and read-only.  It never opens a serial
port, invokes a compiler/uploader, flashes firmware, or accesses the network.
It validates a bounded JSON evidence file and compares values that the file
explicitly declares as EXPECTED and OBSERVED.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
PROJECT_NAME = "Arduino3DVietnam"
BOARD_NAME = "Arduino Uno R3"
EXPECTED_LESSON_IDS = tuple(range(1, 17))
CANONICAL_LESSONS = {
    1: "Làm quen với Arduino Uno R3",
    2: "Làm LED nhấp nháy",
    3: "Đọc trạng thái nút nhấn",
    4: "Đọc giá trị biến trở",
    5: "Trộn màu với LED RGB",
    6: "Đọc cảm biến ánh sáng",
    7: "Đo khoảng cách bằng siêu âm",
    8: "Phát âm thanh với buzzer",
    9: "Đàn piano mini",
    10: "Điều khiển động cơ DC",
    11: "Đo và cảnh báo nhiệt độ",
    12: "Điều khiển góc servo",
    13: "Điều khiển động cơ bước",
    14: "Chậu cây thông minh",
    15: "Cảm biến lực và lực nhấn",
    16: "Dự án tổng hợp: Góc học tập thông minh",
}

MAX_FILE_BYTES = 512 * 1024
MAX_PATH_CHARS = 1024
MAX_JSON_DEPTH = 12
MAX_JSON_NODES = 10_000
MAX_ARRAY_ITEMS = 128
MAX_KEY_CHARS = 64
MAX_STRING_CHARS = 2_000
MAX_MEASUREMENTS_PER_LESSON = 32
MAX_EVIDENCE_REFS_PER_LESSON = 16
MAX_ABS_NUMBER = 1_000_000_000_000.0
MAX_TEXT_ISSUES = 50

_REPORT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")
_REVISION = re.compile(r"[0-9A-Fa-f]{7,64}\Z")
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TOP_LEVEL_REQUIRED = {
    "schema_version",
    "project",
    "board",
    "report_id",
    "report_created_at",
    "provenance",
    "lessons",
}
_PROVENANCE_REQUIRED = {
    "collector_name",
    "collector_role",
    "collection_method",
    "source_revision",
    "evidence_set_ref",
}
_LESSON_REQUIRED = {
    "lesson_id",
    "lesson_title",
    "reviewed_at",
    "evidence_refs",
    "measurements",
}
_MEASUREMENT_REQUIRED = {"name", "unit", "source_ref"}


class EvidenceError(ValueError):
    """Raised when a path, JSON document, or schema is invalid."""


def _object_without_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError(f"Khóa JSON bị lặp: {key!r}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise EvidenceError(f"Số JSON không hữu hạn không được phép: {value}")


def _walk_json_limits(value: Any, *, path: str = "$", depth: int = 0, count: list[int] | None = None) -> None:
    if count is None:
        count = [0]
    count[0] += 1
    if count[0] > MAX_JSON_NODES:
        raise EvidenceError(f"JSON vượt quá {MAX_JSON_NODES} node")
    if depth > MAX_JSON_DEPTH:
        raise EvidenceError(f"JSON vượt quá độ sâu {MAX_JSON_DEPTH} tại {path}")

    if isinstance(value, dict):
        if len(value) > MAX_ARRAY_ITEMS:
            raise EvidenceError(f"Object có quá nhiều trường tại {path}")
        for key, child in value.items():
            if len(key) > MAX_KEY_CHARS or _CONTROL_CHARS.search(key):
                raise EvidenceError(f"Tên trường không hợp lệ tại {path}")
            _walk_json_limits(child, path=f"{path}.{key}", depth=depth + 1, count=count)
        return
    if isinstance(value, list):
        if len(value) > MAX_ARRAY_ITEMS:
            raise EvidenceError(f"Mảng vượt quá {MAX_ARRAY_ITEMS} phần tử tại {path}")
        for index, child in enumerate(value):
            _walk_json_limits(child, path=f"{path}[{index}]", depth=depth + 1, count=count)
        return
    if isinstance(value, str):
        if len(value) > MAX_STRING_CHARS:
            raise EvidenceError(f"Chuỗi vượt quá {MAX_STRING_CHARS} ký tự tại {path}")
        if _CONTROL_CHARS.search(value):
            raise EvidenceError(f"Chuỗi chứa ký tự điều khiển tại {path}")
        return
    if isinstance(value, float) and not math.isfinite(value):
        raise EvidenceError(f"Số không hữu hạn tại {path}")
    if value is None or isinstance(value, (bool, int, float)):
        return
    raise EvidenceError(f"Kiểu JSON không hỗ trợ tại {path}")


def _checked_input_path(raw_path: str | Path) -> Path:
    text = str(raw_path)
    if not text or len(text) > MAX_PATH_CHARS:
        raise EvidenceError(f"Đường dẫn phải dài 1..{MAX_PATH_CHARS} ký tự")
    if text.startswith(("\\\\", "//")):
        raise EvidenceError("--verify chỉ chấp nhận đường dẫn local; UNC/device path không được phép")
    path = Path(text).expanduser()
    if path.suffix.lower() != ".json":
        raise EvidenceError("Tệp evidence phải có phần mở rộng .json")
    if path.is_symlink():
        raise EvidenceError("Không đọc evidence qua symbolic link")
    try:
        stat = path.stat()
    except OSError as exc:
        raise EvidenceError(f"Không đọc được tệp evidence: {exc}") from exc
    if not path.is_file():
        raise EvidenceError("--verify phải trỏ tới một tệp JSON thường")
    if stat.st_size > MAX_FILE_BYTES:
        raise EvidenceError(f"Tệp evidence vượt quá {MAX_FILE_BYTES} byte")
    return path


def load_evidence(path: str | Path) -> dict[str, Any]:
    """Load one bounded local JSON file without contacting external systems."""
    checked = _checked_input_path(path)
    try:
        raw = checked.read_bytes()
    except OSError as exc:
        raise EvidenceError(f"Không đọc được tệp evidence: {exc}") from exc
    if len(raw) > MAX_FILE_BYTES:
        raise EvidenceError(f"Tệp evidence vượt quá {MAX_FILE_BYTES} byte")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise EvidenceError("Tệp evidence phải là UTF-8 hợp lệ") from exc
    try:
        payload = json.loads(
            text,
            object_pairs_hook=_object_without_duplicate_keys,
            parse_constant=_reject_json_constant,
        )
    except EvidenceError:
        raise
    except json.JSONDecodeError as exc:
        raise EvidenceError(f"JSON không hợp lệ tại dòng {exc.lineno}, cột {exc.colno}") from exc
    if not isinstance(payload, dict):
        raise EvidenceError("Gốc JSON phải là object")
    _walk_json_limits(payload)
    return payload


def _check_keys(value: dict[str, Any], *, required: set[str], optional: set[str], path: str) -> None:
    missing = sorted(required - value.keys())
    unknown = sorted(value.keys() - required - optional)
    if missing:
        raise EvidenceError(f"Thiếu trường tại {path}: {', '.join(missing)}")
    if unknown:
        raise EvidenceError(f"Trường không được phép tại {path}: {', '.join(unknown)}")


def _text(value: Any, *, path: str, maximum: int, allow_newlines: bool = False) -> str:
    if not isinstance(value, str):
        raise EvidenceError(f"{path} phải là chuỗi")
    if not value or len(value) > maximum:
        raise EvidenceError(f"{path} phải dài 1..{maximum} ký tự")
    if _CONTROL_CHARS.search(value):
        raise EvidenceError(f"{path} chứa ký tự điều khiển")
    if not allow_newlines and ("\n" in value or "\r" in value):
        raise EvidenceError(f"{path} không được chứa xuống dòng")
    return value


def _timestamp(value: Any, *, path: str) -> datetime:
    text = _text(value, path=path, maximum=64)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise EvidenceError(f"{path} phải là ISO-8601 hợp lệ") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise EvidenceError(f"{path} phải có múi giờ hoặc Z")
    return parsed


def _number(value: Any, *, path: str, nonnegative: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EvidenceError(f"{path} phải là số")
    number = float(value)
    if not math.isfinite(number) or abs(number) > MAX_ABS_NUMBER:
        raise EvidenceError(f"{path} vượt giới hạn số cho phép")
    if nonnegative and number < 0:
        raise EvidenceError(f"{path} phải >= 0")
    return number


def _scalar(value: Any, *, path: str) -> str | bool | int | float:
    if isinstance(value, str):
        return _text(value, path=path, maximum=512)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        _number(value, path=path)
        return value
    raise EvidenceError(f"{path} phải là chuỗi, boolean hoặc số")


def _validate_expected(value: Any, *, path: str) -> None:
    if not isinstance(value, dict):
        raise EvidenceError(f"{path} phải là object")
    operator = value.get("operator")
    if operator == "eq":
        _check_keys(value, required={"operator", "value"}, optional=set(), path=path)
        _scalar(value["value"], path=f"{path}.value")
        return
    if operator == "between":
        _check_keys(value, required={"operator", "min", "max"}, optional=set(), path=path)
        minimum = _number(value["min"], path=f"{path}.min")
        maximum = _number(value["max"], path=f"{path}.max")
        if minimum > maximum:
            raise EvidenceError(f"{path}.min không được lớn hơn {path}.max")
        return
    if operator == "approx":
        _check_keys(value, required={"operator", "value", "tolerance"}, optional=set(), path=path)
        _number(value["value"], path=f"{path}.value")
        _number(value["tolerance"], path=f"{path}.tolerance", nonnegative=True)
        return
    raise EvidenceError(f"{path}.operator phải là eq, between hoặc approx")


def _validate_schema(payload: dict[str, Any]) -> dict[str, Any]:
    _check_keys(payload, required=_TOP_LEVEL_REQUIRED, optional={"notes"}, path="$")
    if payload["schema_version"] != SCHEMA_VERSION or isinstance(payload["schema_version"], bool):
        raise EvidenceError(f"$.schema_version phải bằng {SCHEMA_VERSION}")
    if payload["project"] != PROJECT_NAME:
        raise EvidenceError(f"$.project phải là {PROJECT_NAME!r}")
    if payload["board"] != BOARD_NAME:
        raise EvidenceError(f"$.board phải là {BOARD_NAME!r}")
    report_id = _text(payload["report_id"], path="$.report_id", maximum=80)
    if not _REPORT_ID.fullmatch(report_id):
        raise EvidenceError("$.report_id chỉ cho phép chữ, số, dấu chấm, gạch dưới và gạch ngang")
    report_created_at = _timestamp(payload["report_created_at"], path="$.report_created_at")
    if "notes" in payload:
        _text(payload["notes"], path="$.notes", maximum=MAX_STRING_CHARS, allow_newlines=True)

    provenance = payload["provenance"]
    if not isinstance(provenance, dict):
        raise EvidenceError("$.provenance phải là object")
    _check_keys(provenance, required=_PROVENANCE_REQUIRED, optional={"notes"}, path="$.provenance")
    _text(provenance["collector_name"], path="$.provenance.collector_name", maximum=120)
    if provenance["collector_role"] != "qualified_educator":
        raise EvidenceError("$.provenance.collector_role phải là 'qualified_educator'")
    if provenance["collection_method"] != "manual_hardware_observation":
        raise EvidenceError("$.provenance.collection_method phải là 'manual_hardware_observation'")
    revision = _text(provenance["source_revision"], path="$.provenance.source_revision", maximum=64)
    if not _REVISION.fullmatch(revision):
        raise EvidenceError("$.provenance.source_revision phải là revision hex dài 7..64 ký tự")
    _text(provenance["evidence_set_ref"], path="$.provenance.evidence_set_ref", maximum=160)
    if "notes" in provenance:
        _text(provenance["notes"], path="$.provenance.notes", maximum=MAX_STRING_CHARS, allow_newlines=True)

    lessons = payload["lessons"]
    if not isinstance(lessons, list):
        raise EvidenceError("$.lessons phải là mảng")
    if len(lessons) > len(EXPECTED_LESSON_IDS):
        raise EvidenceError("$.lessons không được chứa quá 16 bản ghi")

    normalized_lessons: list[dict[str, Any]] = []
    for lesson_index, lesson in enumerate(lessons):
        lesson_path = f"$.lessons[{lesson_index}]"
        if not isinstance(lesson, dict):
            raise EvidenceError(f"{lesson_path} phải là object")
        _check_keys(lesson, required=_LESSON_REQUIRED, optional={"notes"}, path=lesson_path)
        lesson_id = lesson["lesson_id"]
        if isinstance(lesson_id, bool) or not isinstance(lesson_id, int) or lesson_id not in EXPECTED_LESSON_IDS:
            raise EvidenceError(f"{lesson_path}.lesson_id phải nằm trong 1..16")
        _text(lesson["lesson_title"], path=f"{lesson_path}.lesson_title", maximum=160)
        reviewed_at = _timestamp(lesson["reviewed_at"], path=f"{lesson_path}.reviewed_at")
        if "notes" in lesson:
            _text(lesson["notes"], path=f"{lesson_path}.notes", maximum=MAX_STRING_CHARS, allow_newlines=True)

        evidence_refs = lesson["evidence_refs"]
        if not isinstance(evidence_refs, list):
            raise EvidenceError(f"{lesson_path}.evidence_refs phải là mảng")
        if len(evidence_refs) > MAX_EVIDENCE_REFS_PER_LESSON:
            raise EvidenceError(
                f"{lesson_path}.evidence_refs vượt quá {MAX_EVIDENCE_REFS_PER_LESSON} mục"
            )
        for ref_index, evidence_ref in enumerate(evidence_refs):
            _text(evidence_ref, path=f"{lesson_path}.evidence_refs[{ref_index}]", maximum=160)

        measurements = lesson["measurements"]
        if not isinstance(measurements, list):
            raise EvidenceError(f"{lesson_path}.measurements phải là mảng")
        if len(measurements) > MAX_MEASUREMENTS_PER_LESSON:
            raise EvidenceError(
                f"{lesson_path}.measurements vượt quá {MAX_MEASUREMENTS_PER_LESSON} mục"
            )
        normalized_measurements: list[dict[str, Any]] = []
        for measurement_index, measurement in enumerate(measurements):
            measurement_path = f"{lesson_path}.measurements[{measurement_index}]"
            if not isinstance(measurement, dict):
                raise EvidenceError(f"{measurement_path} phải là object")
            _check_keys(
                measurement,
                required=_MEASUREMENT_REQUIRED,
                optional={"expected", "observed", "observed_at", "notes"},
                path=measurement_path,
            )
            _text(measurement["name"], path=f"{measurement_path}.name", maximum=120)
            _text(measurement["unit"], path=f"{measurement_path}.unit", maximum=32)
            _text(measurement["source_ref"], path=f"{measurement_path}.source_ref", maximum=160)
            if "expected" in measurement:
                _validate_expected(measurement["expected"], path=f"{measurement_path}.expected")
            if "observed" in measurement:
                _scalar(measurement["observed"], path=f"{measurement_path}.observed")
            observed_at = None
            if "observed_at" in measurement:
                observed_at = _timestamp(measurement["observed_at"], path=f"{measurement_path}.observed_at")
            if "notes" in measurement:
                _text(
                    measurement["notes"],
                    path=f"{measurement_path}.notes",
                    maximum=MAX_STRING_CHARS,
                    allow_newlines=True,
                )
            normalized_measurements.append(
                {"raw": measurement, "path": measurement_path, "observed_at": observed_at}
            )
        normalized_lessons.append(
            {
                "raw": lesson,
                "path": lesson_path,
                "reviewed_at": reviewed_at,
                "measurements": normalized_measurements,
            }
        )

    return {"report_created_at": report_created_at, "lessons": normalized_lessons}


def _numbers_equal(left: int | float, right: int | float) -> bool:
    return float(left) == float(right)


def _compare(expected: dict[str, Any], observed: str | bool | int | float) -> tuple[str, str]:
    operator = expected["operator"]
    if operator == "eq":
        target = expected["value"]
        if isinstance(target, bool) or isinstance(observed, bool):
            matched = isinstance(target, bool) and isinstance(observed, bool) and target is observed
        elif isinstance(target, (int, float)) and isinstance(observed, (int, float)):
            matched = _numbers_equal(target, observed)
        else:
            matched = type(target) is type(observed) and target == observed
        return ("match", "Giá trị bằng EXPECTED") if matched else ("mismatch", "OBSERVED khác EXPECTED")

    if isinstance(observed, bool) or not isinstance(observed, (int, float)):
        return "incomparable", "OBSERVED phải là số cho phép so sánh này"
    observed_number = float(observed)
    if operator == "between":
        matched = float(expected["min"]) <= observed_number <= float(expected["max"])
        return ("match", "OBSERVED nằm trong khoảng EXPECTED") if matched else (
            "mismatch",
            "OBSERVED nằm ngoài khoảng EXPECTED",
        )
    matched = abs(observed_number - float(expected["value"])) <= float(expected["tolerance"])
    return ("match", "OBSERVED nằm trong dung sai EXPECTED") if matched else (
        "mismatch",
        "OBSERVED nằm ngoài dung sai EXPECTED",
    )


def review_evidence(payload: dict[str, Any]) -> dict[str, Any]:
    """Review schema-compliant evidence and return deterministic findings."""
    normalized = _validate_schema(payload)
    report_created_at: datetime = normalized["report_created_at"]
    normalized_lessons: list[dict[str, Any]] = normalized["lessons"]
    issues: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []

    def issue(code: str, path: str, detail: str) -> None:
        issues.append({"code": code, "path": path, "detail": detail})

    seen: set[int] = set()
    for lesson_info in normalized_lessons:
        lesson = lesson_info["raw"]
        lesson_path = lesson_info["path"]
        lesson_id = lesson["lesson_id"]
        if lesson_id in seen:
            issue("duplicate_lesson", f"{lesson_path}.lesson_id", f"Bài {lesson_id:02d} xuất hiện nhiều lần")
        seen.add(lesson_id)
        expected_title = CANONICAL_LESSONS[lesson_id]
        if lesson["lesson_title"] != expected_title:
            issue(
                "lesson_title_mismatch",
                f"{lesson_path}.lesson_title",
                f"Tên canonical của bài {lesson_id:02d} là {expected_title!r}",
            )
        if lesson_info["reviewed_at"] > report_created_at:
            issue(
                "lesson_timestamp_after_report",
                f"{lesson_path}.reviewed_at",
                "reviewed_at xảy ra sau report_created_at",
            )
        if not lesson["evidence_refs"]:
            issue("evidence_ref_missing", f"{lesson_path}.evidence_refs", "Bài học chưa có evidence_ref")
        if not lesson["measurements"]:
            issue("measurements_missing", f"{lesson_path}.measurements", "Bài học chưa có measurement")

        for measurement_info in lesson_info["measurements"]:
            measurement = measurement_info["raw"]
            measurement_path = measurement_info["path"]
            has_expected = "expected" in measurement
            has_observed = "observed" in measurement
            observed_at = measurement_info["observed_at"]
            if not has_expected:
                issue("expected_missing", f"{measurement_path}.expected", "Không có EXPECTED để so sánh")
            if not has_observed:
                issue("observed_missing", f"{measurement_path}.observed", "Không có OBSERVED để so sánh")
            if has_observed and observed_at is None:
                issue(
                    "observed_timestamp_missing",
                    f"{measurement_path}.observed_at",
                    "OBSERVED cần observed_at có múi giờ",
                )
            if not has_observed and observed_at is not None:
                issue(
                    "observed_value_missing",
                    f"{measurement_path}.observed",
                    "Có observed_at nhưng thiếu OBSERVED",
                )
            if observed_at is not None and observed_at > lesson_info["reviewed_at"]:
                issue(
                    "measurement_timestamp_after_review",
                    f"{measurement_path}.observed_at",
                    "observed_at xảy ra sau reviewed_at của bài học",
                )
            if not (has_expected and has_observed):
                continue
            status, detail = _compare(measurement["expected"], measurement["observed"])
            comparisons.append(
                {
                    "path": measurement_path,
                    "operator": measurement["expected"]["operator"],
                    "status": status,
                }
            )
            if status == "mismatch":
                issue("measurement_mismatch", measurement_path, detail)
            elif status == "incomparable":
                issue("measurement_type_mismatch", measurement_path, detail)

    for lesson_id in EXPECTED_LESSON_IDS:
        if lesson_id not in seen:
            issue("lesson_missing", "$.lessons", f"Thiếu evidence cho bài {lesson_id:02d}")

    issues.sort(key=lambda row: (row["path"], row["code"], row["detail"]))
    comparisons.sort(key=lambda row: (row["path"], row["operator"], row["status"]))
    present_ids = sorted(seen)
    return {
        "schema_version": 1,
        "report_id": payload["report_id"],
        "evidence_consistent": not issues,
        "lesson_count": len(payload["lessons"]),
        "lesson_ids_present": present_ids,
        "comparison_count": len(comparisons),
        "issues": issues,
        "comparisons": comparisons,
        "capabilities": {
            "hardware_access": "none",
            "external_access": "none",
            "meaning": "Chỉ review evidence JSON đã khai báo; không xác minh an toàn điện hoặc phần cứng trực tiếp.",
        },
    }


def verify_file(path: str | Path) -> tuple[dict[str, Any], int]:
    payload = load_evidence(path)
    report = review_evidence(payload)
    return report, 0 if report["evidence_consistent"] else 1


def _print_text(report: dict[str, Any]) -> None:
    state = "consistent" if report["evidence_consistent"] else "issues_found"
    print("Arduino3DVietnam — hardware evidence review")
    print(f"- Evidence state: {state}")
    print(f"- Report ID: {report['report_id']}")
    print(f"- Lessons present: {report['lesson_count']}/16")
    print(f"- EXPECTED/OBSERVED comparisons: {report['comparison_count']}")
    print(f"- Issues: {len(report['issues'])}")
    for row in report["issues"][:MAX_TEXT_ISSUES]:
        print(f"  - {row['code']} @ {row['path']}: {row['detail']}")
    hidden = len(report["issues"]) - MAX_TEXT_ISSUES
    if hidden > 0:
        print(f"  - ... và {hidden} issue khác; dùng --json để xem đầy đủ")
    print("- Scope: evidence JSON only; no hardware/USB/flash/network access.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Review JSON evidence được educator thu thập thủ công cho 16 bài Arduino3DVietnam. "
            "Chỉ đọc tệp local; không dùng USB, upload, flash, network hoặc hệ thống ngoài."
        )
    )
    parser.add_argument("--verify", type=Path, required=True, metavar="EVIDENCE.json", help="Tệp JSON local cần review")
    parser.add_argument("--json", action="store_true", help="In báo cáo JSON máy đọc được")
    return parser


def _configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    _configure_utf8_stdio()
    args = build_parser().parse_args(argv)
    try:
        report, exit_code = verify_file(args.verify)
    except EvidenceError as exc:
        if args.json:
            print(
                json.dumps(
                    {"schema_version": 1, "evidence_consistent": False, "input_error": str(exc)},
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
            )
        else:
            print(f"Evidence input error: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        _print_text(report)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
