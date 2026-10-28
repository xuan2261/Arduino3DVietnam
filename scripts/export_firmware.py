"""Compile and export *real* Arduino Uno Intel HEX firmware for the 16 bundled lessons.

This is a strictly optional, manual, GitHub-runner-oriented build step. It is
not a browser C++ compiler, an AVR emulator, a firmware uploader or a means of
accessing serial/USB hardware. It compiles ONLY the reviewed sketches bundled
in src/lessons.js using an existing, pinned arduino-cli toolchain.

The exported manifest records the Git SHA, source SHA, sketch SHA and Intel HEX
SHA so a browser or later reviewer can distinguish real machine code from
JavaScript teaching rules. No package installation occurs inside this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if __package__:
    from . import verify_sketches as existing
else:
    import verify_sketches as existing

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_CLI = "1.5.1"
EXPECTED_CORE = "1.8.6"
EXPECTED_SERVO = "1.3.0"
MAX_HEX_BYTES = 262144
MAX_BINARY_ADDRESS = 0x8000  # ATmega328P 32 KiB flash, including boot section
GIT_SHA = re.compile(r"[0-9a-f]{40}\Z")
FILENAME = re.compile(r"lesson_(?:0[1-9]|1[0-6])\.hex\Z")


class FirmwareError(ValueError):
    """Invalid source, provenance, toolchain, output, or firmware HEX."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_intel_hex(text: str) -> bytes:
    """Strictly parse Intel HEX into 32 KiB AVR flash bytes (0xff = erased).

    Validates record checksums, non-overlap, size, offsets and exactly one EOF.
    Type 04 is accepted only for the zero high address (Uno flash <= 32 KiB).
    No bytes outside the flash range are accepted, even if checksums pass.
    """
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_HEX_BYTES:
        raise FirmwareError("Intel HEX vượt giới hạn kích thước")
    flash = bytearray([0xFF] * MAX_BINARY_ADDRESS)
    used = bytearray(MAX_BINARY_ADDRESS)
    upper = 0
    eof = False
    any_data = False
    lines = text.splitlines()
    if not 1 <= len(lines) <= 8192:
        raise FirmwareError("Intel HEX thiếu bản ghi hoặc có quá nhiều dòng")
    for number, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line or not line.startswith(":") or len(line) % 2 != 1:
            raise FirmwareError(f"Intel HEX dòng {number}: sai định dạng")
        try:
            record = bytes.fromhex(line[1:])
        except ValueError as error:
            raise FirmwareError(f"Intel HEX dòng {number}: ký tự không hợp lệ") from error
        if len(record) < 5 or len(record) != record[0] + 5 or sum(record) % 256 != 0:
            raise FirmwareError(f"Intel HEX dòng {number}: checksum/độ dài sai")
        count, address, kind = record[0], (record[1] << 8) | record[2], record[3]
        data = record[4:-1]
        if eof:
            raise FirmwareError("Intel HEX có dữ liệu sau EOF")
        if kind == 0:
            offset = upper + address
            if not count or offset + count > MAX_BINARY_ADDRESS:
                raise FirmwareError(f"Intel HEX dòng {number}: địa chỉ flash vượt giới hạn")
            for index, value in enumerate(data):
                where = offset + index
                if used[where]:
                    raise FirmwareError(f"Intel HEX dòng {number}: vùng flash bị ghi trùng")
                used[where] = 1
                flash[where] = value
            any_data = True
        elif kind == 1:
            if count != 0 or address != 0:
                raise FirmwareError("Intel HEX EOF không hợp lệ")
            eof = True
        elif kind == 4:
            if count != 2 or address != 0:
                raise FirmwareError("Intel HEX extended address sai")
            upper = int.from_bytes(data, "big") << 16
            if upper:
                raise FirmwareError("Intel HEX nằm ngoài flash ATmega328P")
        else:
            raise FirmwareError(f"Intel HEX record type {kind} không được hỗ trợ")
    if not eof or not any_data:
        raise FirmwareError("Intel HEX không có mã máy hoặc thiếu EOF")
    return bytes(flash)


def verify_firmware_bundle(folder: Path, *, expected_sha: str | None = None) -> dict:
    folder = Path(folder).resolve()
    manifest_path = folder / "manifest.json"
    if not manifest_path.is_file() or manifest_path.stat().st_size > 65536:
        raise FirmwareError("Thiếu manifest hoặc manifest quá lớn")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise FirmwareError("Manifest không phải JSON UTF-8 hợp lệ") from error
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise FirmwareError("Manifest schema không được hỗ trợ")
    if manifest.get("format") != "arduino-uno-intel-hex" or manifest.get("board") != existing.FQBN:
        raise FirmwareError("Manifest không phải firmware Arduino Uno")
    sha = manifest.get("git_sha")
    if not isinstance(sha, str) or not GIT_SHA.fullmatch(sha):
        raise FirmwareError("Git SHA không hợp lệ")
    if expected_sha is not None and sha != expected_sha:
        raise FirmwareError("Git SHA không trùng bản đang xét")
    if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("source_sha256"))):
        raise FirmwareError("Thiếu SHA256 nguồn")
    # Hashing a manifest against itself is not enough. Recompute provenance
    # from the *checked-out* lesson source and all 16 extracted sketches.
    actual_source_sha = digest(existing.LESSONS_FILE.read_bytes())
    if manifest["source_sha256"] != actual_source_sha:
        raise FirmwareError("Firmware được biên dịch từ nguồn bài học khác workspace")
    source_sketches = existing.extract_sketches()
    if manifest.get("toolchain") != {
        "arduino_cli": EXPECTED_CLI,
        "arduino_avr_core": EXPECTED_CORE,
        "servo_library": EXPECTED_SERVO,
    }:
        raise FirmwareError("Không đúng bộ công cụ đã chốt")
    rows = manifest.get("lessons")
    if not isinstance(rows, list) or len(rows) != 16:
        raise FirmwareError("Manifest phải có 16 firmware")
    allowed_files = {"manifest.json"}
    for lesson_id, row in enumerate(rows, 1):
        if not isinstance(row, dict) or row.get("id") != lesson_id:
            raise FirmwareError("ID firmware không đủ và đúng thứ tự 1..16")
        filename = row.get("file")
        if (not isinstance(filename, str) or
                not FILENAME.fullmatch(filename) or
                filename != f"lesson_{lesson_id:02d}.hex"):
            raise FirmwareError("Tên firmware không hợp lệ")
        if not isinstance(row.get("sketch_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sketch_sha256"]):
            raise FirmwareError("Thiếu Sketch SHA256")
        source_sketch = source_sketches[lesson_id - 1]
        if row.get("slug") != source_sketch.slug or row["sketch_sha256"] != digest(source_sketch.source.encode("utf-8")):
            raise FirmwareError("Sketch hash/slug trong manifest không khớp bài học gốc")
        path = (folder / filename).resolve()
        if path.parent != folder or not path.is_file():
            raise FirmwareError("Thiếu firmware từ manifest")
        data = path.read_bytes()
        if (len(data) != row.get("hex_bytes") or len(data) > MAX_HEX_BYTES
                or digest(data) != row.get("hex_sha256")):
            raise FirmwareError(f"HEX bài {lesson_id} không khớp byte/SHA-256")
        try:
            parsed = parse_intel_hex(data.decode("ascii"))
        except UnicodeDecodeError as error:
            raise FirmwareError("HEX không phải ASCII") from error
        if row.get("flash_sha256") != digest(parsed):
            raise FirmwareError(f"Flash SHA256 của bài {lesson_id} không khớp")
        allowed_files.add(filename)
    present_files = {entry.name for entry in folder.iterdir() if entry.is_file()}
    if present_files != allowed_files:
        raise FirmwareError("Gói firmware có tệp dư hoặc thiếu")
    return manifest


def _run_cli(command: list[str], *, timeout: int = 45) -> str:
    try:
        result = subprocess.run(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise FirmwareError(f"Arduino CLI không thực hiện được: {type(error).__name__}") from error
    if result.returncode:
        # Bound error text and don't dump environment tokens or source paths.
        msg = (result.stderr or result.stdout)[-1200:]
        raise FirmwareError(f"Arduino CLI trả mã {result.returncode}: {msg}")
    return result.stdout


def _verify_dependencies(cli: Path, servo: Path) -> None:
    if not cli.is_file():
        raise FirmwareError("Không tìm thấy Arduino CLI thực")
    version = _run_cli([str(cli), "version"], timeout=8)
    if f"Version: {EXPECTED_CLI}" not in version:
        raise FirmwareError("Arduino CLI không đúng phiên bản 1.5.1")
    core = _run_cli([str(cli), "core", "list"], timeout=8)
    if not re.search(r"arduino:avr\s+" + re.escape(EXPECTED_CORE) + r"\b", core):
        raise FirmwareError("Chưa xác minh Arduino AVR core 1.8.6")
    props = (servo / "library.properties")
    header = servo / "src" / "Servo.h"
    if not props.is_file() or not header.is_file():
        raise FirmwareError("Servo library root không hợp lệ")
    if not re.search(r"^version\s*=\s*1\.3\.0\s*$", props.read_text(encoding="utf-8"), re.M):
        raise FirmwareError("Servo library không đúng phiên bản 1.3.0")


def build_firmware_bundle(cli: Path, servo: Path, target: Path, git_sha: str) -> dict:
    if not GIT_SHA.fullmatch(git_sha):
        raise FirmwareError("Git SHA phải là 40 ký tự hex viết thường")
    cli, servo, target = Path(cli).resolve(), Path(servo).resolve(), Path(target).resolve()
    if target.exists():
        raise FirmwareError("Từ chối ghi đè gói firmware hiện hữu")
    if target == ROOT or ROOT not in target.parents:
        raise FirmwareError("Thư mục xuất phải nằm trong workspace")
    if any(part.lower() in {".git", "src", "assets", "sources", "dist"} for part in target.relative_to(ROOT).parts):
        raise FirmwareError("Không thể xuất firmware trực tiếp vào source/assets/dist")
    _verify_dependencies(cli, servo)
    sketches = existing.extract_sketches()
    with tempfile.TemporaryDirectory(prefix="arduino3dvn-firmware-", dir=str(ROOT)) as temp:
        stage = Path(temp).resolve() / "bundle"
        stage.mkdir()
        rows = []
        for sketch in sketches:
            with tempfile.TemporaryDirectory(prefix=f"firmware-{sketch.lesson_id:02d}-") as local:
                workspace = Path(local).resolve()
                sketch_name = f"lesson_{sketch.lesson_id:02d}_{sketch.slug}"
                sketch_dir = workspace / sketch_name
                build_dir = workspace / "build"
                sketch_dir.mkdir()
                build_dir.mkdir()
                (sketch_dir / (sketch_name + ".ino")).write_text(sketch.source, encoding="utf-8", newline="\n")
                _run_cli([
                    str(cli), "compile", "--fqbn", existing.FQBN,
                    "--warnings", "all", "--build-path", str(build_dir),
                    "--library", str(servo), str(sketch_dir)
                ])
                hex_candidates = list(build_dir.rglob(sketch_name + ".ino.hex"))
                if len(hex_candidates) != 1:
                    raise FirmwareError(f"Không tìm thấy đúng một .ino.hex cho bài {sketch.lesson_id}")
                raw = hex_candidates[0].read_bytes()
                if len(raw) > MAX_HEX_BYTES:
                    raise FirmwareError("Firmware Intel HEX vượt giới hạn")
                try:
                    flash = parse_intel_hex(raw.decode("ascii"))
                except UnicodeDecodeError as error:
                    raise FirmwareError("Firmware HEX không phải ASCII") from error
                filename = f"lesson_{sketch.lesson_id:02d}.hex"
                (stage / filename).write_bytes(raw)
                rows.append({
                    "id": sketch.lesson_id,
                    "slug": sketch.slug,
                    "file": filename,
                    "sketch_sha256": digest(sketch.source.encode("utf-8")),
                    "hex_bytes": len(raw),
                    "hex_sha256": digest(raw),
                    "flash_sha256": digest(flash),
                })
        manifest = {
            "schema_version": 1,
            "format": "arduino-uno-intel-hex",
            "git_sha": git_sha,
            "source_file": "src/lessons.js",
            "source_sha256": digest(existing.LESSONS_FILE.read_bytes()),
            "board": existing.FQBN,
            "toolchain": {
                "arduino_cli": EXPECTED_CLI,
                "arduino_avr_core": EXPECTED_CORE,
                "servo_library": EXPECTED_SERVO,
            },
            "lessons": rows,
        }
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        verify_firmware_bundle(stage, expected_sha=git_sha)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, target)
    return verify_firmware_bundle(target, expected_sha=git_sha)


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Xuất/kiểm chứng Intel HEX Arduino Uno có SHA256")
    parser.add_argument("--output", default="firmware-output", help="Thư mục mới trong workspace; không ghi đè")
    parser.add_argument("--sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--servo-library", default=os.environ.get("ARDUINO_SERVO_LIBRARY", ""))
    parser.add_argument("--verify", help="Chỉ kiểm tra gói Intel HEX sẵn có, không compile")
    args = parser.parse_args()
    try:
        if args.verify:
            report = verify_firmware_bundle(Path(args.verify), expected_sha=args.sha or None)
            print(f"VERIFY PASS: {len(report['lessons'])} Intel HEX, SHA={report['git_sha']}")
        else:
            cli = existing.find_arduino_cli()
            if not cli or not args.servo_library:
                raise FirmwareError("Thiếu Arduino CLI hoặc --servo-library đã cài sẵn")
            target = Path(args.output)
            if not target.is_absolute():
                target = ROOT / target
            report = build_firmware_bundle(cli, Path(args.servo_library), target, args.sha)
            print(f"EXPORT PASS: {len(report['lessons'])} firmware .hex; SHA={report['git_sha']}")
    except (FirmwareError, OSError, ValueError) as error:
        print(f"Firmware export failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
