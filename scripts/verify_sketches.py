"""Xác minh Sketch Arduino đi kèm dự án bằng toolchain thật khi có sẵn.

Script này không mô phỏng C++, không tải toolchain, không cài core/thư viện và
không nạp firmware. Nó chỉ trích xuất 16 Sketch được đóng gói trong
`src/lessons.js` rồi, khi người dùng truyền `--compile`, gọi một
`arduino-cli` đã tồn tại trên máy để biên dịch cho Arduino Uno.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
LESSONS_FILE = ROOT / "src" / "lessons.js"
EXPECTED_IDS = tuple(range(1, 17))
FQBN = "arduino:avr:uno"
CORE_ID = "arduino:avr"
COMMAND_TIMEOUT_SECONDS = 45
PROBE_TIMEOUT_SECONDS = 8
MAX_OUTPUT_CHARS = 6000
MAX_LIBRARY_PATHS = 8

_LESSON_PATTERN = re.compile(
    r'\bid:\s*(?P<id>\d+),\s*slug:\s*"(?P<slug>[^"]+)".*?'
    r"\bsketch:\s*`(?P<sketch>.*?)`,\s*\n\s*quiz:",
    re.DOTALL,
)
_SAFE_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


@dataclass(frozen=True)
class Sketch:
    lesson_id: int
    slug: str
    source: str


def extract_sketches(path: Path = LESSONS_FILE) -> list[Sketch]:
    """Trích xuất đúng 16 Sketch được phép từ nguồn bài học của dự án."""
    text = path.read_text(encoding="utf-8")
    sketches = [
        Sketch(
            lesson_id=int(match.group("id")),
            slug=match.group("slug"),
            source=match.group("sketch").strip() + "\n",
        )
        for match in _LESSON_PATTERN.finditer(text)
    ]
    ids = tuple(sketch.lesson_id for sketch in sketches)
    if ids != EXPECTED_IDS:
        raise ValueError(
            "Nguồn bài học phải chứa đúng Sketch ID 1..16 theo thứ tự; "
            f"đã đọc được {ids!r}."
        )
    if any(not sketch.source.strip() for sketch in sketches):
        raise ValueError("Có Sketch rỗng trong nguồn bài học.")
    if any(
        not _SAFE_SLUG.fullmatch(sketch.slug) or len(sketch.source.encode("utf-8")) > 16000
        for sketch in sketches
    ):
        raise ValueError("Tên slug Sketch hoặc kích thước nguồn không hợp lệ.")
    return sketches


def _known_cli_candidates() -> Iterable[Path]:
    """Các vị trí cài Arduino IDE phổ biến; không quét toàn bộ ổ đĩa."""
    program_files = os.environ.get("ProgramFiles")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if program_files:
        base = Path(program_files) / "Arduino IDE" / "resources" / "app"
        yield base / "lib" / "backend" / "resources" / "arduino-cli.exe"
        yield (
            base
            / "node_modules"
            / "arduino-ide-extension"
            / "build"
            / "arduino-cli.exe"
        )
    if local_app_data:
        base = (
            Path(local_app_data)
            / "Programs"
            / "Arduino IDE"
            / "resources"
            / "app"
        )
        yield base / "lib" / "backend" / "resources" / "arduino-cli.exe"
        yield (
            base
            / "node_modules"
            / "arduino-ide-extension"
            / "build"
            / "arduino-cli.exe"
        )


def find_arduino_cli() -> Path | None:
    """Tìm arduino-cli hiện hữu mà không tải xuống hoặc thay đổi hệ thống."""
    on_path = shutil.which("arduino-cli")
    if on_path:
        path = Path(on_path)
        if path.is_file():
            return path.resolve()
    for candidate in _known_cli_candidates():
        if candidate.is_file():
            return candidate.resolve()
    return None


def _clip(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(normalized) <= MAX_OUTPUT_CHARS:
        return normalized
    return normalized[:MAX_OUTPUT_CHARS] + "\n…[đã rút gọn]"


def _normalize_library_paths(paths: Iterable[Path]) -> tuple[Path, ...]:
    """Chuẩn hóa các Arduino library root đã có sẵn; không tải/cài thư viện."""
    normalized: list[Path] = []
    seen: set[Path] = set()
    for raw_path in paths:
        path = Path(raw_path).expanduser().resolve()
        if not path.is_dir() or not (path / "library.properties").is_file():
            raise ValueError(
                "--library phải trỏ tới thư mục gốc Arduino library đã có sẵn "
                "và chứa library.properties"
            )
        if path not in seen:
            normalized.append(path)
            seen.add(path)
        if len(normalized) > MAX_LIBRARY_PATHS:
            raise ValueError(f"Chỉ cho phép tối đa {MAX_LIBRARY_PATHS} đường dẫn --library")
    return tuple(normalized)


def _run_process(
    command: list[str],
    *,
    timeout: int,
    cwd: Path = ROOT,
) -> subprocess.CompletedProcess[str]:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(
        command,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
        creationflags=flags,
        env={**os.environ, "NO_COLOR": "1"},
    )


def _json_contains(value: Any, needle: str) -> bool:
    if isinstance(value, dict):
        return any(_json_contains(item, needle) for item in value.values())
    if isinstance(value, list):
        return any(_json_contains(item, needle) for item in value)
    return str(value) == needle


def _probe_core(cli: Path) -> tuple[bool | None, str]:
    """Trả về trạng thái core Arduino AVR; không chạy update/index/install."""
    try:
        result = _run_process(
            [str(cli), "core", "list", "--format", "json"],
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"Không đọc được danh sách core: {exc}"

    if result.returncode == 0:
        try:
            payload = json.loads(result.stdout or "{}")
        except json.JSONDecodeError:
            payload = None
        if payload is not None:
            present = _json_contains(payload, CORE_ID)
            return present, (
                f"Đã tìm thấy core {CORE_ID}."
                if present
                else f"Chưa cài core {CORE_ID}."
            )

    # Tương thích Arduino CLI cũ không hỗ trợ JSON.
    try:
        fallback = _run_process(
            [str(cli), "core", "list"],
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, f"Không đọc được danh sách core: {exc}"
    combined = f"{fallback.stdout}\n{fallback.stderr}"
    if fallback.returncode != 0:
        return None, _clip(combined) or "Lệnh core list thất bại."
    present = CORE_ID in combined
    return present, (
        f"Đã tìm thấy core {CORE_ID}."
        if present
        else f"Chưa cài core {CORE_ID}."
    )


def probe_compiler(cli: Path | None = None) -> dict[str, Any]:
    """Kiểm tra compiler hiện hữu. Không cài đặt hoặc cập nhật gì."""
    resolved = cli if cli is not None else find_arduino_cli()
    if resolved is None:
        return {
            "available": False,
            "path": None,
            "version": None,
            "core_available": False,
            "reason": "Không tìm thấy arduino-cli đã cài trên máy.",
        }
    try:
        result = _run_process(
            [str(resolved), "version"],
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "available": False,
            "path": str(resolved),
            "version": None,
            "core_available": False,
            "reason": f"arduino-cli không chạy được: {exc}",
        }
    version_text = _clip(result.stdout or result.stderr)
    if result.returncode != 0:
        return {
            "available": False,
            "path": str(resolved),
            "version": version_text or None,
            "core_available": False,
            "reason": version_text or "arduino-cli version trả về lỗi.",
        }
    core_available, core_reason = _probe_core(resolved)
    return {
        "available": True,
        "path": str(resolved),
        "version": version_text.splitlines()[0] if version_text else "không rõ",
        "core_available": core_available is True,
        "reason": core_reason,
    }


def compile_sketch(
    sketch: Sketch,
    cli: Path,
    *,
    libraries: Iterable[Path] = (),
) -> dict[str, Any]:
    """Biên dịch một Sketch allowlist trong thư mục tạm; tuyệt đối không upload."""
    if (
        sketch.lesson_id not in EXPECTED_IDS
        or not _SAFE_SLUG.fullmatch(sketch.slug)
        or len(sketch.source.encode("utf-8")) > 16000
    ):
        raise ValueError("Sketch không thuộc phạm vi đường dẫn/kích thước cho phép")
    library_paths = _normalize_library_paths(libraries)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix=f"arduino3dvn-{sketch.lesson_id:02d}-") as tmp:
        temp_root = Path(tmp).resolve()
        sketch_name = f"lesson_{sketch.lesson_id:02d}_{sketch.slug}"
        sketch_dir = temp_root / sketch_name
        build_dir = temp_root / "build"
        sketch_dir.mkdir()
        build_dir.mkdir()
        ino_path = sketch_dir / f"{sketch_name}.ino"
        ino_path.write_text(sketch.source, encoding="utf-8", newline="\n")

        command = [
            str(cli),
            "compile",
            "--fqbn",
            FQBN,
            "--warnings",
            "all",
            "--build-path",
            str(build_dir),
        ]
        for library_path in library_paths:
            command.extend(["--library", str(library_path)])
        command.append(str(sketch_dir))
        try:
            result = _run_process(
                command,
                timeout=COMMAND_TIMEOUT_SECONDS,
                cwd=ROOT,
            )
            status = "compiled" if result.returncode == 0 else "compile_failed"
            detail = _clip("\n".join(x for x in [result.stdout, result.stderr] if x))
            return_code = result.returncode
        except subprocess.TimeoutExpired:
            status = "compile_timeout"
            detail = f"Vượt quá giới hạn {COMMAND_TIMEOUT_SECONDS} giây."
            return_code = None
        except OSError as exc:
            status = "compile_failed"
            detail = f"Không thể chạy arduino-cli: {exc}"
            return_code = None

    return {
        "lesson_id": sketch.lesson_id,
        "slug": sketch.slug,
        "status": status,
        "return_code": return_code,
        "duration_ms": round((time.monotonic() - started) * 1000),
        "detail": detail,
        "libraries": [str(path) for path in library_paths],
    }


def verify(
    *,
    compile_requested: bool,
    lesson_ids: list[int] | None = None,
    lessons_path: Path = LESSONS_FILE,
    cli: Path | None = None,
    libraries: Iterable[Path] = (),
) -> tuple[dict[str, Any], int]:
    sketches = extract_sketches(lessons_path)
    selected_ids = sorted(set(lesson_ids or EXPECTED_IDS))
    invalid = [value for value in selected_ids if value not in EXPECTED_IDS]
    if invalid:
        raise ValueError(f"ID bài học ngoài allowlist 1..16: {invalid!r}")
    selected = [sketch for sketch in sketches if sketch.lesson_id in selected_ids]
    library_paths = _normalize_library_paths(libraries) if compile_requested else ()
    compiler = probe_compiler(cli)
    compile_ready = compiler["available"] and compiler["core_available"]

    report: dict[str, Any] = {
        "schema_version": 1,
        "source": lessons_path.relative_to(ROOT).as_posix(),
        "board_fqbn": FQBN,
        "sketch_count": len(sketches),
        "selected_ids": selected_ids,
        "mode": "compile" if compile_requested else "status",
        "capabilities": {
            "simulation": {
                "state": "available",
                "meaning": "Mô phỏng quy tắc JavaScript; không thực thi Arduino C++.",
            },
            "compile": {
                "state": "available" if compile_ready else "unavailable",
                "meaning": (
                    "Biên dịch thật bằng arduino-cli đã cài sẵn."
                    if compile_ready
                    else "Chưa thể biên dịch thật trong môi trường hiện tại."
                ),
            },
            "hardware": {
                "state": "unsupported",
                "meaning": "Script không kết nối USB, upload firmware hoặc điều khiển bo thật.",
            },
        },
        "compiler": compiler,
        "compile_libraries": [str(path) for path in library_paths],
        "results": [],
    }

    if not compile_requested:
        report["results"] = [
            {
                "lesson_id": sketch.lesson_id,
                "slug": sketch.slug,
                "status": "not_compiled",
            }
            for sketch in selected
        ]
        return report, 0

    if not compile_ready:
        report["results"] = [
            {
                "lesson_id": sketch.lesson_id,
                "slug": sketch.slug,
                "status": "skipped_compiler_unavailable",
            }
            for sketch in selected
        ]
        return report, 2

    resolved_cli = Path(compiler["path"])
    report["results"] = [
        compile_sketch(sketch, resolved_cli, libraries=library_paths)
        for sketch in selected
    ]
    failed = [row for row in report["results"] if row["status"] != "compiled"]
    return report, 1 if failed else 0


def _print_text(report: dict[str, Any]) -> None:
    capabilities = report["capabilities"]
    compiler = report["compiler"]
    print("Xác minh Arduino C++ — Arduino 3D Việt Nam")
    print(f"- Mô phỏng: {capabilities['simulation']['state']} — {capabilities['simulation']['meaning']}")
    print(f"- Biên dịch thật: {capabilities['compile']['state']} — {capabilities['compile']['meaning']}")
    print(f"- Phần cứng: {capabilities['hardware']['state']} — {capabilities['hardware']['meaning']}")
    print(f"- Board compile cố định: {report['board_fqbn']}")
    print(f"- Sketch allowlist: {report['sketch_count']} bài; đang chọn {report['selected_ids']}")
    if compiler["path"]:
        print(f"- arduino-cli: {compiler['path']}")
        print(f"- Phiên bản: {compiler['version']}")
    else:
        print("- arduino-cli: không tìm thấy")
    print(f"- Compiler/core: {compiler['reason']}")
    if report["mode"] == "compile":
        for row in report["results"]:
            print(f"  Bài {row['lesson_id']:02d}: {row['status']}")
            if row.get("detail") and row["status"] != "compiled":
                print("    " + row["detail"].replace("\n", "\n    "))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Kiểm tra 16 Sketch bundled; chỉ compile khi arduino-cli + Arduino AVR core "
            "đã có sẵn. Không tải, cài, upload hoặc chạy trên phần cứng."
        )
    )
    parser.add_argument(
        "--compile",
        action="store_true",
        help="Biên dịch thật các Sketch đã chọn bằng arduino-cli hiện hữu.",
    )
    parser.add_argument(
        "--lesson",
        type=int,
        action="append",
        dest="lesson_ids",
        help="Chỉ chọn bài 1..16; có thể lặp lại. Mặc định chọn cả 16.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="In JSON máy đọc được cho UI/CI.",
    )
    parser.add_argument(
        "--library",
        action="append",
        type=Path,
        default=[],
        dest="libraries",
        help=(
            "Chỉ định thư mục gốc của Arduino library đã cài sẵn cho lệnh compile; "
            "có thể lặp lại, tối đa 8."
        ),
    )
    return parser


def _configure_utf8_stdio() -> None:
    """Giữ tiếng Việt đọc được trên Windows console dùng code page cũ."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    _configure_utf8_stdio()
    args = build_parser().parse_args(argv)
    try:
        report, exit_code = verify(
            compile_requested=args.compile,
            lesson_ids=args.lesson_ids,
            libraries=args.libraries,
        )
    except (OSError, ValueError) as exc:
        if args.json:
            print(
                json.dumps(
                    {
                        "schema_version": 1,
                        "mode": "error",
                        "error": str(exc),
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        else:
            print(f"Lỗi xác minh: {exc}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_text(report)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
