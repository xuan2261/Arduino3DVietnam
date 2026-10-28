"""Fail-closed read-only release evidence gate for Arduino3DVietnam.

The final application commit must have successful manual compiler and browser
E2E runs on that exact SHA. Firmware is different: its manifest records the
source commit that was compiled, which may be an ancestor of the final app
commit. The firmware gate binds the checked-in manifest/HEX bytes to one exact
successful, non-expired GitHub Actions artifact and proves that the compiled
source revision contained the same ``src/lessons.js`` bytes.

This script only performs local reads and GitHub REST GET requests. It cannot
trigger workflows, upload artifacts, deploy Pages, push, or mutate the repo.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

if __package__:
    from . import export_firmware
else:
    import export_firmware


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIRMWARE_DIR = ROOT / "assets" / "firmware"
FINAL_SHA_WORKFLOWS = {
    "arduino-compile-manual.yml": "Arduino C++/AVR thật",
    "browser-e2e-manual.yml": "Chrome/Chromium WebGL + offline",
}
FIRMWARE_WORKFLOW = "firmware-hex-manual.yml"
FIRMWARE_WORKFLOW_PATH = ".github/workflows/firmware-hex-manual.yml"
FIRMWARE_ARTIFACT_FILES = frozenset(
    {"manifest.json"} | {f"lesson_{lesson_id:02d}.hex" for lesson_id in range(1, 17)}
)

# Immutable proof selected from the successful private-repository firmware
# export on 2026-10-28. A future firmware rebuild must update these values only
# after the new run/artifact/digest has been independently reviewed.
FIRMWARE_PROOF = {
    "run_id": 40648560140,
    "run_attempt": 1,
    "artifact_id": 12798453179,
    "artifact_name": "arduino-uno-avr-hex-files",
    "artifact_size": 34588,
    "artifact_digest": "sha256:a18a7ec088a4c2098b018f5352233510724648d8d5891800e37aefeff732f026",
}

API_BASE = "https://api.github.com"
REPOSITORY_PATTERN = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
SHA_PATTERN = re.compile(r"[a-fA-F0-9]{40}\Z")
LOWER_SHA_PATTERN = re.compile(r"[a-f0-9]{40}\Z")
SHA256_PATTERN = re.compile(r"[a-f0-9]{64}\Z")
MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024
MAX_ARTIFACT_ARCHIVE_BYTES = 2 * 1024 * 1024
MAX_ARTIFACT_MEMBER_BYTES = 512 * 1024


def valid_repository(repository: str) -> bool:
    if not REPOSITORY_PATTERN.fullmatch(repository):
        return False
    owner, name = repository.split("/", 1)
    return owner not in {".", ".."} and name not in {".", ".."} and (
        ".." not in owner and ".." not in name
    )


@dataclass(frozen=True)
class Gate:
    workflow: str
    label: str
    passed: bool
    reason: str
    run_id: int | None = None
    url: str | None = None


class _SafeRedirectHandler(HTTPRedirectHandler):
    """Follow HTTPS redirects while never forwarding GitHub bearer auth cross-host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        if parsed.scheme != "https" or not parsed.hostname:
            raise URLError("Refusing non-HTTPS GitHub artifact redirect")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            old_host = urlparse(req.full_url).hostname
            if parsed.hostname != old_host:
                redirected.remove_header("Authorization")
        return redirected


def _request(url: str, token: str, *, max_bytes: int, accept: str) -> bytes:
    if not token:
        raise ValueError("Thiếu token đọc GitHub Actions")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "api.github.com":
        raise ValueError("GitHub request phải bắt đầu tại api.github.com qua HTTPS")
    request = Request(
        url,
        headers={
            "Accept": accept,
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "arduino3dvietnam-release-gate",
        },
    )
    opener = build_opener(_SafeRedirectHandler())
    with opener.open(request, timeout=20) as response:
        body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ValueError("GitHub response vượt giới hạn kích thước")
    return body


def _request_json(url: str, token: str) -> dict[str, Any]:
    body = _request(
        url,
        token,
        max_bytes=MAX_API_RESPONSE_BYTES,
        accept="application/vnd.github+json",
    )
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("GitHub API trả JSON không hợp lệ") from error
    if not isinstance(payload, dict):
        raise ValueError("GitHub API không trả object JSON")
    return payload


def request_workflow_runs(repository: str, workflow: str, token: str) -> dict[str, Any]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    if workflow not in FINAL_SHA_WORKFLOWS:
        raise ValueError("Workflow ngoài allowlist final-SHA")
    url = (
        f"{API_BASE}/repos/{repository}/actions/workflows/{workflow}/runs"
        "?event=workflow_dispatch&per_page=100"
    )
    payload = _request_json(url, token)
    if not isinstance(payload.get("workflow_runs"), list):
        raise ValueError("GitHub API không trả workflow_runs hợp lệ")
    return payload


def request_firmware_run(repository: str, token: str) -> dict[str, Any]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    return _request_json(
        f"{API_BASE}/repos/{repository}/actions/runs/{FIRMWARE_PROOF['run_id']}", token
    )


def request_firmware_artifacts(repository: str, token: str) -> dict[str, Any]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    payload = _request_json(
        f"{API_BASE}/repos/{repository}/actions/runs/{FIRMWARE_PROOF['run_id']}/artifacts",
        token,
    )
    if not isinstance(payload.get("artifacts"), list):
        raise ValueError("GitHub API không trả artifacts hợp lệ")
    return payload


def request_firmware_archive(repository: str, token: str) -> bytes:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    return _request(
        f"{API_BASE}/repos/{repository}/actions/artifacts/{FIRMWARE_PROOF['artifact_id']}/zip",
        token,
        max_bytes=MAX_ARTIFACT_ARCHIVE_BYTES,
        accept="application/vnd.github+json",
    )


def request_source_at_commit(repository: str, sha: str, token: str) -> bytes:
    if not valid_repository(repository) or not LOWER_SHA_PATTERN.fullmatch(sha):
        raise ValueError("Repository hoặc firmware source SHA không hợp lệ")
    payload = _request_json(
        f"{API_BASE}/repos/{repository}/contents/src/lessons.js?ref={sha}", token
    )
    if payload.get("type") != "file" or payload.get("path") != "src/lessons.js":
        raise ValueError("Không đọc được src/lessons.js tại firmware source SHA")
    if payload.get("encoding") != "base64" or not isinstance(payload.get("content"), str):
        raise ValueError("GitHub contents response không có base64 source")
    compact = "".join(payload["content"].split())
    try:
        source = base64.b64decode(compact, validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("GitHub source base64 không hợp lệ") from error
    size = payload.get("size")
    if not isinstance(size, int) or size < 1 or size > MAX_SOURCE_BYTES or len(source) != size:
        raise ValueError("GitHub source size không hợp lệ")
    return source


def request_compare(repository: str, firmware_sha: str, final_sha: str, token: str) -> dict[str, Any]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    if not LOWER_SHA_PATTERN.fullmatch(firmware_sha) or not SHA_PATTERN.fullmatch(final_sha):
        raise ValueError("SHA compare không hợp lệ")
    return _request_json(
        f"{API_BASE}/repos/{repository}/compare/{firmware_sha}...{final_sha}", token
    )


def latest_matching_run(payload: dict[str, Any], sha: str) -> dict[str, Any] | None:
    """Find the latest manual attempt for the exact final application SHA."""
    matches = [
        run
        for run in payload.get("workflow_runs", [])
        if isinstance(run, dict)
        and run.get("head_sha") == sha
        and run.get("event") == "workflow_dispatch"
    ]
    if not matches:
        return None
    return max(
        matches,
        key=lambda run: (
            str(run.get("created_at") or ""),
            int(run.get("run_attempt") or 0),
            int(run.get("id") or 0),
        ),
    )


def check_workflow(workflow: str, label: str, sha: str, payload: dict[str, Any]) -> Gate:
    run = latest_matching_run(payload, sha)
    if run is None:
        return Gate(workflow, label, False, "Không có run thủ công cho đúng final app commit.")
    status, conclusion = run.get("status"), run.get("conclusion")
    run_id = run.get("id")
    safe_id = run_id if isinstance(run_id, int) and run_id > 0 else None
    url = run.get("html_url") if isinstance(run.get("html_url"), str) else None
    if status != "completed" or conclusion != "success":
        return Gate(
            workflow,
            label,
            False,
            f"Run gần nhất chưa đạt: status={status}, conclusion={conclusion}.",
            safe_id,
            url,
        )
    return Gate(workflow, label, True, "Run final-SHA đã hoàn tất thành công.", safe_id, url)


def _parse_github_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.endswith("Z"):
        return None
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return None


def check_firmware_run(manifest_sha: str, run: dict[str, Any]) -> Gate:
    run_id = run.get("id")
    safe_id = run_id if isinstance(run_id, int) and run_id > 0 else None
    url = run.get("html_url") if isinstance(run.get("html_url"), str) else None
    failures = []
    if run_id != FIRMWARE_PROOF["run_id"]:
        failures.append("run id")
    if run.get("run_attempt") != FIRMWARE_PROOF["run_attempt"]:
        failures.append("run attempt")
    if run.get("path") != FIRMWARE_WORKFLOW_PATH:
        failures.append("workflow path")
    if run.get("head_sha") != manifest_sha:
        failures.append("manifest source SHA")
    if run.get("event") != "workflow_dispatch":
        failures.append("event")
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        failures.append("status/conclusion")
    if failures:
        return Gate(
            FIRMWARE_WORKFLOW,
            "Firmware export run",
            False,
            "Pinned firmware run không khớp: " + ", ".join(failures) + ".",
            safe_id,
            url,
        )
    return Gate(
        FIRMWARE_WORKFLOW,
        "Firmware export run",
        True,
        "Pinned firmware run thành công trên manifest source SHA.",
        safe_id,
        url,
    )


def check_firmware_artifact(
    manifest_sha: str,
    artifacts_payload: dict[str, Any],
    *,
    now: datetime,
) -> Gate:
    artifacts = artifacts_payload.get("artifacts")
    if not isinstance(artifacts, list) or artifacts_payload.get("total_count") != 1 or len(artifacts) != 1:
        return Gate(FIRMWARE_WORKFLOW, "Firmware artifact", False, "Run phải có đúng một artifact.")
    artifact = artifacts[0]
    if not isinstance(artifact, dict):
        return Gate(FIRMWARE_WORKFLOW, "Firmware artifact", False, "Artifact metadata không hợp lệ.")
    workflow_run = artifact.get("workflow_run")
    expires_at = _parse_github_time(artifact.get("expires_at"))
    failures = []
    if artifact.get("id") != FIRMWARE_PROOF["artifact_id"]:
        failures.append("artifact id")
    if artifact.get("name") != FIRMWARE_PROOF["artifact_name"]:
        failures.append("artifact name")
    if artifact.get("size_in_bytes") != FIRMWARE_PROOF["artifact_size"]:
        failures.append("artifact size")
    if artifact.get("digest") != FIRMWARE_PROOF["artifact_digest"]:
        failures.append("artifact digest")
    if artifact.get("expired") is not False:
        failures.append("expired")
    if expires_at is None or expires_at <= now:
        failures.append("expires_at")
    if not isinstance(workflow_run, dict):
        failures.append("workflow_run")
    else:
        if workflow_run.get("id") != FIRMWARE_PROOF["run_id"]:
            failures.append("artifact run id")
        if workflow_run.get("head_sha") != manifest_sha:
            failures.append("artifact head SHA")
    if failures:
        return Gate(
            FIRMWARE_WORKFLOW,
            "Firmware artifact",
            False,
            "Pinned artifact không khớp/còn hạn: " + ", ".join(failures) + ".",
            FIRMWARE_PROOF["run_id"],
        )
    return Gate(
        FIRMWARE_WORKFLOW,
        "Firmware artifact",
        True,
        f"Artifact id={FIRMWARE_PROOF['artifact_id']} digest và hạn dùng đã khớp.",
        FIRMWARE_PROOF["run_id"],
    )


def check_commit_lineage(firmware_sha: str, final_sha: str, payload: dict[str, Any]) -> tuple[bool, str]:
    status = payload.get("status")
    behind_by = payload.get("behind_by")
    if firmware_sha == final_sha:
        if status != "identical" or payload.get("ahead_by") != 0 or behind_by != 0:
            return False, "GitHub compare không xác nhận cùng revision."
        return True, "Firmware source SHA trùng final app SHA."
    if status != "ahead" or behind_by != 0:
        return False, "Firmware source SHA không phải ancestor của final app SHA."
    return True, "Firmware source SHA là ancestor hợp lệ của final app SHA."


def check_source_hash(manifest: dict[str, Any], source_bytes: bytes) -> tuple[bool, str]:
    expected = manifest.get("source_sha256")
    if not isinstance(expected, str) or not SHA256_PATTERN.fullmatch(expected):
        return False, "Manifest thiếu source_sha256 hợp lệ."
    actual = hashlib.sha256(source_bytes).hexdigest()
    if actual != expected:
        return False, "src/lessons.js tại manifest.git_sha không khớp source_sha256."
    return True, "Source SHA-256 tại compiled commit đã khớp manifest."


def verify_local_firmware_bundle(firmware_dir: Path) -> dict[str, Any]:
    """Validate local manifest, current lessons source, all 16 HEX and flash hashes."""
    manifest = export_firmware.verify_firmware_bundle(Path(firmware_dir))
    sha = manifest.get("git_sha")
    if not isinstance(sha, str) or not LOWER_SHA_PATTERN.fullmatch(sha):
        raise ValueError("Firmware manifest git_sha phải là SHA-1 viết thường")
    return manifest


def verify_artifact_archive(archive: bytes, firmware_dir: Path, expected_digest: str) -> None:
    if not isinstance(archive, bytes) or not archive or len(archive) > MAX_ARTIFACT_ARCHIVE_BYTES:
        raise ValueError("Firmware artifact archive rỗng hoặc quá lớn")
    if not isinstance(expected_digest, str) or not expected_digest.startswith("sha256:"):
        raise ValueError("Artifact digest không phải SHA-256")
    expected_hex = expected_digest.removeprefix("sha256:")
    if not SHA256_PATTERN.fullmatch(expected_hex):
        raise ValueError("Artifact digest SHA-256 không hợp lệ")
    if hashlib.sha256(archive).hexdigest() != expected_hex:
        raise ValueError("Downloaded artifact ZIP không khớp GitHub artifact digest")

    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            infos = bundle.infolist()
            names = [info.filename for info in infos if not info.is_dir()]
            if len(infos) != len(names) or len(names) != len(set(names)):
                raise ValueError("Artifact ZIP có thư mục hoặc tên file trùng")
            if set(names) != FIRMWARE_ARTIFACT_FILES:
                raise ValueError("Artifact ZIP không có đúng manifest + 16 HEX")
            local_root = Path(firmware_dir).resolve()
            for info in infos:
                if info.flag_bits & 0x1:
                    raise ValueError("Artifact ZIP không được mã hóa")
                if info.file_size < 1 or info.file_size > MAX_ARTIFACT_MEMBER_BYTES:
                    raise ValueError("Artifact member size không hợp lệ")
                local_path = (local_root / info.filename).resolve()
                if local_path.parent != local_root or not local_path.is_file():
                    raise ValueError("Artifact member path không hợp lệ")
                if bundle.read(info) != local_path.read_bytes():
                    raise ValueError(f"Artifact byte khác checkout: {info.filename}")
    except zipfile.BadZipFile as error:
        raise ValueError("Firmware artifact không phải ZIP hợp lệ") from error


def verify_firmware_gate(
    repository: str,
    final_sha: str,
    token: str,
    firmware_dir: Path,
    *,
    now: datetime | None = None,
) -> Gate:
    manifest = verify_local_firmware_bundle(firmware_dir)
    firmware_sha = manifest["git_sha"]

    lineage_ok, lineage_reason = check_commit_lineage(
        firmware_sha,
        final_sha,
        request_compare(repository, firmware_sha, final_sha, token),
    )
    if not lineage_ok:
        return Gate(FIRMWARE_WORKFLOW, "Firmware provenance", False, lineage_reason)

    source_ok, source_reason = check_source_hash(
        manifest, request_source_at_commit(repository, firmware_sha, token)
    )
    if not source_ok:
        return Gate(FIRMWARE_WORKFLOW, "Firmware provenance", False, source_reason)

    run_gate = check_firmware_run(firmware_sha, request_firmware_run(repository, token))
    if not run_gate.passed:
        return run_gate

    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        raise ValueError("now phải có timezone")
    artifact_gate = check_firmware_artifact(
        firmware_sha,
        request_firmware_artifacts(repository, token),
        now=current_time.astimezone(timezone.utc),
    )
    if not artifact_gate.passed:
        return artifact_gate

    try:
        verify_artifact_archive(
            request_firmware_archive(repository, token),
            firmware_dir,
            FIRMWARE_PROOF["artifact_digest"],
        )
    except ValueError as error:
        return Gate(
            FIRMWARE_WORKFLOW,
            "Firmware artifact",
            False,
            str(error),
            FIRMWARE_PROOF["run_id"],
            run_gate.url,
        )

    return Gate(
        FIRMWARE_WORKFLOW,
        "Firmware provenance",
        True,
        lineage_reason + " " + source_reason + " Local 16 HEX trùng byte pinned artifact.",
        FIRMWARE_PROOF["run_id"],
        run_gate.url,
    )


def verify(
    repository: str,
    sha: str,
    token: str,
    *,
    firmware_dir: Path = DEFAULT_FIRMWARE_DIR,
    now: datetime | None = None,
) -> list[Gate]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    if not SHA_PATTERN.fullmatch(sha):
        raise ValueError("Commit phải là SHA-1 Git đầy đủ (40 ký tự)")
    if not token:
        raise ValueError("Thiếu token đọc GitHub Actions")

    gates = []
    for workflow, label in FINAL_SHA_WORKFLOWS.items():
        gates.append(check_workflow(workflow, label, sha, request_workflow_runs(repository, workflow, token)))
    gates.append(verify_firmware_gate(repository, sha, token, firmware_dir, now=now))
    return gates


def _configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    _configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Cổng bằng chứng fail-closed cho Pages Arduino3DVietnam")
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--firmware-dir", default=str(DEFAULT_FIRMWARE_DIR))
    args = parser.parse_args(argv)
    token = os.environ.get("GITHUB_TOKEN", "")
    try:
        gates = verify(
            args.repository,
            args.sha,
            token,
            firmware_dir=Path(args.firmware_dir),
        )
    except (ValueError, HTTPError, URLError, TimeoutError, OSError) as error:
        # Deliberately omit provider bodies/headers/tokens from logs.
        print(f"Release gate không thể kiểm tra: {type(error).__name__}", file=sys.stderr)
        return 2
    for gate in gates:
        print(
            f"{'PASS' if gate.passed else 'BLOCK'} · {gate.label} · "
            f"{gate.reason} run={gate.run_id or 'none'} {gate.url or ''}"
        )
    if not all(gate.passed for gate in gates):
        print(
            "Không triển khai: compiler + E2E phải PASS trên final SHA và firmware proof phải hợp lệ.",
            file=sys.stderr,
        )
        return 1
    print("Đủ bằng chứng để bước Pages kế tiếp được phép đóng gói/upload/deploy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
