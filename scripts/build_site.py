"""Build a portable static site using only Python standard library.

Output is limited to root/dist. Existing, unrelated dist data is protected:
the script refuses to replace a directory without its own marker.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from hashlib import sha256
from pathlib import Path, PurePosixPath

if __package__:
    from . import export_firmware
else:
    import export_firmware

ROOT = Path(__file__).resolve().parents[1]
DIST = (ROOT / "dist").resolve()
MARKER = ".arduino-3d-viet-generated"
FIRMWARE_FILES = [
    "assets/firmware/manifest.json",
    *[f"assets/firmware/lesson_{index:02d}.hex" for index in range(1, 17)],
]
AVR_VENDOR_RUNTIME_FILES = [
    "assets/vendor/avr/cpu.js",
    "assets/vendor/avr/instruction.js",
    "assets/vendor/avr/interrupt.js",
]
AVR_VENDOR_SOURCE_FILES = [
    "assets/vendor/avr/avr8js-0.21.1-source/cpu.ts",
    "assets/vendor/avr/avr8js-0.21.1-source/instruction.ts",
    "assets/vendor/avr/avr8js-0.21.1-source/interrupt.ts",
]
AVR_VENDOR_FILES = [
    *AVR_VENDOR_RUNTIME_FILES,
    *AVR_VENDOR_SOURCE_FILES,
    "assets/vendor/avr/AVR8JS-LICENSE.txt",
    "assets/vendor/avr/PROVENANCE.json",
]
V16_RELEASE_FILES = [
    "src/lab-explorer.js",
    "src/lab-explorer-ui.js",
    "src/breadboard-topology.js",
    "src/breadboard-topology-ui.js",
    "src/avr-timer2.js",
    "styles/lab-explorer.css",
    "docs/LAB_EXPLORER_V16.md",
    "docs/BREADBOARD_TOPOLOGY_V16.md",
    "docs/TIMER2_V16.md",
    "docs/SCENE3D_V16.md",
    "src/dc-resistor-network.js",
    "src/resistive-study-ui.js",
    "docs/DC_RESISTOR_NETWORK_V16.md",
]
PRACTICE_RELEASE_FILES = [
    "src/practice-evidence.js",
    "src/practice-evidence-ui.js",
    "styles/practice-evidence.css",
    "docs/PRACTICE_EVIDENCE_NEXT.md",
]
POST_V16_LAB_FILES = [
    "src/uno-reference.js",
    "src/practice-checkpoints.js",
    "src/breadboard-placement.js",
    "src/sketch-review.js",
    "src/sketch-review-ui.js",
    "docs/UNO_REFERENCE_NEXT.md",
    "docs/AUTHORED_PRACTICE_CHECKPOINTS.md",
    "docs/BREADBOARD_PHYSICAL_MAPPING_NEXT.md",
    "docs/SCENE_NEXT_3D_QA.md",
    "docs/SKETCH_REVIEW_NEXT.md",
]
POST_V16_INTERACTION_FILES = [
    "src/practice-observation.js",
    "src/practice-observation-ui.js",
    "src/breadboard-placement-session.js",
    "docs/PRACTICE_OBSERVATION_NEXT.md",
    "docs/RESISTIVE_VISUAL_STUDY_NEXT.md",
]
POST_V16_GUIDED_WIRING_FILES = [
    "src/breadboard-hole-grid.js",
    "src/practice-wire-guidance.js",
    "docs/BREADBOARD_HOLE_PICKER_NEXT.md",
    "docs/PRACTICE_WIRE_GUIDANCE_NEXT.md",
    "docs/SCENE_WIRE_PREVIEW_NEXT.md",
]
POST_V16_FIDELITY_FILES = [
    "docs/SCENE_VISUAL_FIDELITY_NEXT.md",
    "docs/PRACTICE_CHECKLIST_NEXT.md",
    "docs/SKETCH_LEXICAL_FEEDBACK_NEXT.md",
]
FILES = [
    "index.html",
    "site.webmanifest",
    "sw.js",
    "styles/app.css",
    "styles/wiring.css",
    "styles/avr-panel.css",
    "styles/lab-editor.css",
    "src/app.js",
    "src/lab-layout.js",
    "src/lab-editor-ui.js",
    "src/learning-coach.js",
    "src/lessons.js",
    "src/simulator.js",
    "src/circuit.js",
    "src/circuit-extended.js",
    "src/circuit-router.js",
    "src/electrical-solver.js",
    "src/wiring-workbench.js",
    "src/storage.js",
    "src/scene3d.js",
    "src/firmware-integrity.js",
    "src/avr-panel.js",
    "src/avr-runtime.js",
    "src/avr-gpio.js",
    "src/avr-timer0.js",
    "src/avr-timer1.js",
    "src/avr-analog-serial.js",
    "src/avr-board-runner.js",
    "assets/favicon.svg",
    "assets/vendor/three.module.min.js",
    "assets/vendor/three.core.min.js",
    "assets/vendor/THREE-LICENSE.txt",
    *AVR_VENDOR_FILES,
    *FIRMWARE_FILES,
    "THIRD-PARTY-NOTICES.md",
    "docs/HUONG_DAN.md",
    "docs/CIRCUIT_ENGINE.md",
    "docs/CIRCUIT_EXTENDED.md",
    "docs/ARDUINO_CODE.md",
    "docs/GPIO_RUNTIME.md",
    "docs/TIMER0_RUNTIME.md",
    "docs/ANALOG_SERIAL_RUNTIME.md",
    "docs/AVR_BOARD_LAB.md",
    "docs/LAB_LAYOUT.md",
    "docs/SCENE3D_LAB.md",
    "docs/LEARNING_COACH.md",
    "docs/TIMER1_RUNTIME.md",
    *V16_RELEASE_FILES,
    *PRACTICE_RELEASE_FILES,
    *POST_V16_LAB_FILES,
    *POST_V16_INTERACTION_FILES,
    *POST_V16_GUIDED_WIRING_FILES,
    *POST_V16_FIDELITY_FILES,
]

_SW_ASSETS_RE = re.compile(r"const ASSETS = \[(.*?)\];", re.DOTALL)
_THREE_PINNED_SHA256 = {
    "assets/vendor/three.module.min.js":
        "e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6",
    "assets/vendor/three.core.min.js":
        "61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de",
    "assets/vendor/THREE-LICENSE.txt":
        "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601",
}
_AVR_UPSTREAM = {
    "repository": "https://github.com/wokwi/avr8js",
    "tag": "v0.21.1",
    "version": "0.21.1",
    "commit": "bee6f0a94e0e27786f6bc21aee3c775849fb50fd",
    "license": "MIT",
}
_AVR_PINNED_SHA256 = {
    "assets/vendor/avr/avr8js-0.21.1-source/cpu.ts":
        "6b947714ba67cd8d09acf90e012d7b15e720a6c7ac0a5478ccd86d07ef021002",
    "assets/vendor/avr/avr8js-0.21.1-source/instruction.ts":
        "fb5ab0837dee73be25609c937219236c96822974f4d2ef43d7d83e5fc1df5475",
    "assets/vendor/avr/avr8js-0.21.1-source/interrupt.ts":
        "3021a736c32b92e1ba06b3d160bfce7959780ff0aa16675ec3e7f069890e7b99",
    "assets/vendor/avr/AVR8JS-LICENSE.txt":
        "71d092fa8944eb36ce929756f620ee5bf31f119d5f78a6941dc04d48f504177b",
    "assets/vendor/avr/cpu.js":
        "d3caa3cbcd70319b45fbfc1c024d21f63f2e49a349543f305efbde51f07a1236",
    "assets/vendor/avr/instruction.js":
        "82664a05845ffb46ed78ea29a7f539e6152dd1626f2cf81df01597c16fef4415",
    "assets/vendor/avr/interrupt.js":
        "fdd767535daa0aba32d3627520e9753cdcb0d8203126a374d40659eddadc5508",
}


def _release_source(filename: str) -> Path:
    """Resolve only a fixed, local release entry below ROOT and outside dist."""
    if not isinstance(filename, str) or not filename or "\\" in filename or ":" in filename:
        raise RuntimeError(f"Unsafe release allowlist entry: {filename!r}")
    pure = PurePosixPath(filename)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise RuntimeError(f"Unsafe release allowlist entry: {filename!r}")
    source = ROOT.joinpath(*pure.parts)
    if source.is_symlink():
        raise RuntimeError(f"Refusing symlinked release file: {filename}")
    try:
        resolved = source.resolve(strict=True)
    except OSError as error:
        raise FileNotFoundError(f"Missing release file: {filename}") from error
    root = ROOT.resolve()
    dist = DIST.resolve()
    if not resolved.is_file() or not resolved.is_relative_to(root) or resolved.is_relative_to(dist):
        raise RuntimeError(f"Release file escapes workspace or targets dist: {filename}")
    return resolved


def _verify_release_allowlist() -> None:
    if len(FILES) != len(set(FILES)):
        raise RuntimeError("Release allowlist contains duplicate paths")
    if FILES.count("sw.js") != 1:
        raise RuntimeError("Release allowlist must contain exactly one sw.js")
    for filename in FILES:
        _release_source(filename)


def _service_worker_assets(worker_text: str) -> list[str]:
    block = _SW_ASSETS_RE.search(worker_text)
    if not block:
        raise RuntimeError("Service worker ASSETS declaration unavailable")
    return re.findall(r'"([^"]+)"', block.group(1))


def _verify_service_worker_assets(worker_text: str) -> None:
    assets = _service_worker_assets(worker_text)
    expected = ["./", *[f"./{name}" for name in FILES if name != "sw.js"]]
    if assets != expected or len(assets) != len(set(assets)):
        raise RuntimeError("Service worker precache must exactly match release allowlist")
    if any(not asset.startswith("./") or asset.startswith("./../") for asset in assets):
        raise RuntimeError("Service worker precache contains a non-subpath-safe URL")


def _verify_three_vendor_assets() -> None:
    """Fail closed unless shipped Three.js r180 runtime/license bytes match pinned hashes."""
    try:
        for filename, expected_hash in _THREE_PINNED_SHA256.items():
            actual_hash = sha256(_release_source(filename).read_bytes()).hexdigest()
            if actual_hash != expected_hash:
                raise ValueError(f"Three.js pinned asset hash mismatch: {filename}")
        license_text = _release_source("assets/vendor/THREE-LICENSE.txt").read_text(encoding="utf-8")
        if "The MIT License" not in license_text or "Permission is hereby granted" not in license_text:
            raise ValueError("Three.js MIT license text is missing")
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        raise RuntimeError("Refusing to package unverified Three.js vendor assets") from error


def _verify_avr_vendor_assets() -> None:
    """Pin avr8js provenance and bytes against an independent checksum anchor."""
    try:
        provenance_path = _release_source("assets/vendor/avr/PROVENANCE.json")
        data = provenance_path.read_bytes()
        if len(data) > 65536:
            raise ValueError("AVR provenance is too large")
        provenance = json.loads(data)
        if not isinstance(provenance, dict):
            raise ValueError("Unsupported AVR provenance schema")
        upstream = provenance.get("upstream")
        if provenance.get("schema_version") != 1 or not isinstance(upstream, dict):
            raise ValueError("Unsupported AVR provenance schema")
        for key, expected in _AVR_UPSTREAM.items():
            if upstream.get(key) != expected:
                raise ValueError(f"Unexpected avr8js provenance field: {key}")

        exact_rows = provenance.get("exact_upstream_files")
        derived_rows = provenance.get("derived_browser_esm")
        if not isinstance(exact_rows, list) or not isinstance(derived_rows, list):
            raise ValueError("Missing AVR provenance file lists")
        exact_hashes = {
            row.get("path"): row.get("sha256")
            for row in exact_rows
            if isinstance(row, dict)
        }
        derived_hashes = {
            row.get("path"): row.get("sha256")
            for row in derived_rows
            if isinstance(row, dict)
        }
        expected_exact = {*AVR_VENDOR_SOURCE_FILES, "assets/vendor/avr/AVR8JS-LICENSE.txt"}
        if len(exact_hashes) != len(exact_rows) or set(exact_hashes) != expected_exact:
            raise ValueError("Unexpected upstream AVR provenance file set")
        if len(derived_hashes) != len(derived_rows) or set(derived_hashes) != set(AVR_VENDOR_RUNTIME_FILES):
            raise ValueError("Unexpected derived AVR provenance file set")
        declared_hashes = {**exact_hashes, **derived_hashes}
        if set(declared_hashes) != set(_AVR_PINNED_SHA256):
            raise ValueError("AVR provenance does not match the pinned checksum file set")
        for filename, expected_hash in _AVR_PINNED_SHA256.items():
            declared_hash = declared_hashes.get(filename)
            if not isinstance(declared_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", declared_hash):
                raise ValueError(f"Invalid AVR SHA-256 for {filename}")
            if declared_hash != expected_hash:
                raise ValueError(f"AVR provenance hash differs from pinned checksum: {filename}")
            if sha256(_release_source(filename).read_bytes()).hexdigest() != expected_hash:
                raise ValueError(f"AVR pinned asset hash mismatch: {filename}")
        license_text = _release_source("assets/vendor/avr/AVR8JS-LICENSE.txt").read_text(encoding="utf-8")
        if "The MIT License (MIT)" not in license_text or "Permission is hereby granted" not in license_text:
            raise ValueError("AVR MIT license text is missing")
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError) as error:
        raise RuntimeError("Refusing to package unverified avr8js vendor assets") from error


def verify_firmware_assets() -> None:
    """Use the firmware exporter's strict source/sketch/HEX/flash verifier."""
    try:
        folder = _release_source("assets/firmware/manifest.json").parent
        manifest = export_firmware.verify_firmware_bundle(folder)
        lessons_source = _release_source("src/lessons.js")
        if manifest.get("source_file") != "src/lessons.js":
            raise export_firmware.FirmwareError("Firmware source_file không đúng allowlist")
        if sha256(lessons_source.read_bytes()).hexdigest() != manifest.get("source_sha256"):
            raise export_firmware.FirmwareError("Firmware source SHA không khớp release source")
    except (export_firmware.FirmwareError, OSError, ValueError, TypeError) as error:
        raise RuntimeError("Refusing to package firmware without verified bytes/provenance") from error


def _verify_webmanifest(path: Path) -> None:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Web manifest must be valid UTF-8 JSON") from error
    if manifest.get("lang") != "vi" or manifest.get("start_url") != "./" or manifest.get("scope") != "./":
        raise RuntimeError("Web manifest must remain Vietnamese and project-subpath safe")
    for icon in manifest.get("icons", []):
        source = icon.get("src") if isinstance(icon, dict) else None
        if not isinstance(source, str) or source.startswith(("/", "http://", "https://", "//")):
            raise RuntimeError("Web manifest icon path is not project-subpath safe")


def build() -> Path:
    if DIST.parent != ROOT.resolve() or DIST == ROOT.resolve():
        raise RuntimeError("Unsafe dist output path")
    if DIST.exists() and not (DIST / MARKER).is_file():
        raise RuntimeError("Refusing to replace dist without generated marker")
    _verify_release_allowlist()
    sources = {filename: _release_source(filename) for filename in FILES}
    source_worker = sources["sw.js"].read_text(encoding="utf-8")
    _verify_service_worker_assets(source_worker)
    _verify_webmanifest(sources["site.webmanifest"])
    _verify_three_vendor_assets()
    _verify_avr_vendor_assets()
    verify_firmware_assets()
    with tempfile.TemporaryDirectory(prefix=".arduino-site-", dir=ROOT) as temp:
        stage = Path(temp)
        for filename in FILES:
            dest = stage / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(sources[filename], dest)
        # Content-address the service-worker cache. A fixed date/version cache
        # would serve stale sketches and lesson data after future GitHub Pages
        # deployments when sw.js itself did not change.
        digest = sha256()
        for filename in sorted(name for name in FILES if name != "sw.js"):
            digest.update(filename.encode("utf-8"))
            digest.update(b"\0")
            digest.update((stage / filename).read_bytes())
        cache_id = f"arduino3d-viet-static-{digest.hexdigest()[:16]}"
        worker_file = stage / "sw.js"
        patched_worker, changed = re.subn(
            r'const CACHE = "arduino3d-viet-static-[a-zA-Z0-9-]+";',
            f'const CACHE = "{cache_id}";',
            source_worker,
            count=1,
        )
        if changed != 1:
            raise RuntimeError("Service worker cache declaration unavailable")
        _verify_service_worker_assets(patched_worker)
        worker_file.write_text(patched_worker, encoding="utf-8", newline="\n")
        # Path.write_text() translates '\n' to CRLF on Windows; write the
        # verified marker as fixed bytes so local/CI/Pages archives agree.
        (stage / MARKER).write_bytes(b"Generated by scripts/build_site.py\n")
        if DIST.exists():
            shutil.rmtree(DIST)
        shutil.copytree(stage, DIST)
    return DIST


if __name__ == "__main__":
    try:
        output = build()
    except Exception as exc:
        print(f"Build failed: {exc}", file=sys.stderr)
        sys.exit(1)
    print(f"OK: static website exported to {output}")
