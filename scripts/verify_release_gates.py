"""Read-only release gate: require same-commit verified compiler and browser runs.

GitHub Pages must never publish a commit whose exact SHA has not passed both
real Uno C++ compilation and browser WebGL/offline E2E. Workflow metadata is
read from GitHub REST with the workflow's temporary GITHUB_TOKEN, never from
user-supplied PASS labels or saved artifact filenames.

This script reads only: it cannot trigger workflows, deploy, push, or mutate
repositories. Used by the release-gates GitHub Actions job.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

WORKFLOWS = {
    "arduino-compile-manual.yml": "Arduino C++/AVR thật",
    "browser-e2e-manual.yml": "Chrome/Chromium WebGL + offline",
}
API_BASE = "https://api.github.com"
REPOSITORY_PATTERN = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
SHA_PATTERN = re.compile(r"[a-fA-F0-9]{40}\Z")

def valid_repository(repository: str) -> bool:
    if not REPOSITORY_PATTERN.fullmatch(repository):
        return False
    owner, name = repository.split("/", 1)
    # The regex alone accepts '..' as an owner; reject dot path segments
    # instead of letting the HTTP client normalize a different API path.
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


def latest_matching_run(payload: dict[str, Any], sha: str) -> dict[str, Any] | None:
    """Find latest attempt for exact SHA, not any success on another revision."""
    matches = [
        run for run in payload.get("workflow_runs", [])
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
        return Gate(workflow, label, False, "Không có run thủ công cho đúng commit.")
    status, conclusion = run.get("status"), run.get("conclusion")
    run_id = run.get("id")
    safe_id = run_id if isinstance(run_id, int) and run_id > 0 else None
    url = run.get("html_url") if isinstance(run.get("html_url"), str) else None
    if status != "completed" or conclusion != "success":
        return Gate(
            workflow, label, False,
            f"Run gần nhất chưa đạt: status={status}, conclusion={conclusion}.",
            safe_id, url,
        )
    return Gate(workflow, label, True, "Run đã hoàn tất thành công.", safe_id, url)


def request_workflow_runs(repository: str, workflow: str, token: str) -> dict[str, Any]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    if workflow not in WORKFLOWS:
        raise ValueError("Workflow ngoài allowlist")
    if not token:
        raise ValueError("Thiếu token đọc GitHub Actions")
    url = (
        f"{API_BASE}/repos/{repository}/actions/workflows/{workflow}/runs"
        "?event=workflow_dispatch&per_page=100"
    )
    request = Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "arduino3dvietnam-release-gate",
    })
    with urlopen(request, timeout=15) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or not isinstance(payload.get("workflow_runs"), list):
        raise ValueError("GitHub API không trả về danh sách workflow_runs hợp lệ")
    return payload


def verify(repository: str, sha: str, token: str) -> list[Gate]:
    if not valid_repository(repository):
        raise ValueError("Repository phải ở dạng owner/name")
    if not SHA_PATTERN.fullmatch(sha):
        raise ValueError("Commit phải là SHA-1 Git đầy đủ (40 ký tự)")
    gates = []
    for workflow, label in WORKFLOWS.items():
        payload = request_workflow_runs(repository, workflow, token)
        gates.append(check_workflow(workflow, label, sha, payload))
    return gates


def _configure_utf8_stdio() -> None:
    # Windows consoles may still default to cp1252 even when content is UTF-8.
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    _configure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Cổng xuất bản Pages chỉ-đọc cho Arduino3DVietnam")
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--sha", default=os.environ.get("GITHUB_SHA", ""))
    args = parser.parse_args(argv)
    token = os.environ.get("GITHUB_TOKEN", "")
    try:
        gates = verify(args.repository, args.sha, token)
    except (ValueError, HTTPError, URLError, TimeoutError, OSError) as error:
        # Avoid printing request headers, bearer tokens or raw provider errors.
        print(f"Release gate không thể kiểm tra: {type(error).__name__}", file=sys.stderr)
        return 2
    for gate in gates:
        print(
            f"{'PASS' if gate.passed else 'BLOCK'} · {gate.label} · "
            f"{gate.reason} run={gate.run_id or 'none'} "
            f"{gate.url or ''}"
        )
    if not all(gate.passed for gate in gates):
        print("Không triển khai: cần cả hai workflow PASS trên đúng Git SHA.", file=sys.stderr)
        return 1
    print("Đủ bằng chứng để cho phép bước deploy Pages thủ công.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
