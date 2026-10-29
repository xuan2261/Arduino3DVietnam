"""Release/PWA contracts that need only Python's standard library."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import unittest
from hashlib import sha1, sha256
from pathlib import Path
from unittest import mock

from scripts import build_site
from scripts.serve import Handler

ROOT = Path(__file__).resolve().parents[1]
CACHE_RE = re.compile(r'const CACHE = "([^"]+)";')
ASSETS_RE = re.compile(r"const ASSETS = \[(.*?)\];", re.DOTALL)


def cache_name(worker_text: str) -> str:
    match = CACHE_RE.search(worker_text)
    if not match:
        raise AssertionError("Service worker cache declaration not found")
    return match.group(1)


def copy_release_sources(target: Path) -> None:
    for filename in build_site.FILES:
        source = ROOT / filename
        destination = target / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


class ReleaseContractTests(unittest.TestCase):
    def test_three_vendor_assets_match_independent_pinned_hashes(self):
        expected = {
            "assets/vendor/three.module.min.js":
                "e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6",
            "assets/vendor/three.core.min.js":
                "61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de",
            "assets/vendor/THREE-LICENSE.txt":
                "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601",
        }
        self.assertEqual(build_site._THREE_PINNED_SHA256, expected)
        for filename, pinned_hash in expected.items():
            self.assertEqual(sha256((ROOT / filename).read_bytes()).hexdigest(), pinned_hash, filename)
        build_site._verify_three_vendor_assets()

    def test_three_vendor_assets_match_official_r180_git_blobs_without_eol_rewrite(self):
        # SHA-1 is Git's historical blob identity here, NOT a security
        # substitute for the independent SHA-256 pins above. Canonical blob
        # bytes protect CI from silent Windows CRLF checkout differences.
        official_r180_blobs = {
            "assets/vendor/three.module.min.js":
                "20d3c112761a519c7780a5ccc9f72a40937fa83b",
            "assets/vendor/three.core.min.js":
                "70c40977daa0f6e1e312c6b58e9bfe49cb5a87a4",
            "assets/vendor/THREE-LICENSE.txt":
                "cf781430404b0ae0ba7d8dea3457a3515dd7c9b9",
        }
        for filename, expected_blob in official_r180_blobs.items():
            data = (ROOT / filename).read_bytes()
            self.assertNotIn(b"\r\n", data, filename)
            git_blob = b"blob " + str(len(data)).encode("ascii") + b"\0" + data
            self.assertEqual(sha1(git_blob).hexdigest(), expected_blob, filename)

    def test_byte_pinned_vendor_and_firmware_metadata_require_portable_checkout(self):
        # On Windows, core.autocrlf may rewrite text files unless these scoped
        # attributes pin LF. Keep actual firmware Intel HEX binary/CRLF.
        attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8").splitlines()
        paths = {
            "assets/vendor/avr/avr8js-0.21.1-source/*.ts": (
                "assets/vendor/avr/avr8js-0.21.1-source/cpu.ts",
                "assets/vendor/avr/avr8js-0.21.1-source/instruction.ts",
                "assets/vendor/avr/avr8js-0.21.1-source/interrupt.ts",
            ),
            "assets/vendor/avr/AVR8JS-LICENSE.txt": ("assets/vendor/avr/AVR8JS-LICENSE.txt",),
            "assets/vendor/avr/PROVENANCE.json": ("assets/vendor/avr/PROVENANCE.json",),
            "assets/firmware/manifest.json": ("assets/firmware/manifest.json",),
        }
        for rule, files in paths.items():
            self.assertIn(rule + " text eol=lf", attributes)
            for filename in files:
                self.assertNotIn(b"\r\n", (ROOT / filename).read_bytes(), filename)
        self.assertIn("assets/firmware/*.hex binary", attributes)

    def test_build_rejects_three_vendor_runtime_or_license_tampering(self):
        for filename in (
            "assets/vendor/three.module.min.js",
            "assets/vendor/three.core.min.js",
            "assets/vendor/THREE-LICENSE.txt",
        ):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory(
                prefix="arduino3d-three-release-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                path = fixture_root / filename
                path.write_bytes(path.read_bytes() + b"\n# tampered\n")
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaisesRegex(RuntimeError, "Three.js"):
                        build_site.build()

    def test_v16_release_manifest_is_exact_complete_and_pwa_aligned(self):
        expected_v16 = [
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
        self.assertEqual(build_site.V16_RELEASE_FILES, expected_v16)
        v16_baseline = build_site.FILES[:83]
        self.assertEqual(len(v16_baseline), 83, "protected v1.6 baseline must remain exactly 83 files")
        self.assertEqual(v16_baseline[-13:], expected_v16,
                         "v1.6 assets must remain in the protected 83-file baseline order")
        self.assertFalse(any(path.startswith("sources/") for path in build_site.FILES),
                         "Reference source histories must never enter the public release")

        for filename in expected_v16:
            source = build_site._release_source(filename)
            self.assertTrue(source.is_file(), filename)
            self.assertFalse(source.is_symlink(), filename)
            self.assertGreater(len(source.read_bytes()), 0, f"v1.6 release asset is empty: {filename}")

        study_ui = (ROOT / "src/resistive-study-ui.js").read_text(encoding="utf-8")
        self.assertIn('from "./dc-resistor-network.js"', study_ui,
                      "User-facing resistive study UI must import the packaged DC solver")

        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        block = ASSETS_RE.search(worker)
        self.assertIsNotNone(block, "Service worker ASSETS list is missing")
        assets = re.findall(r'"([^"]+)"', block.group(1))
        expected_assets = ["./", *[f"./{name}" for name in build_site.FILES if name != "sw.js"]]
        self.assertEqual(assets, expected_assets, "v1.6 SW precache must exactly mirror the 83-file release order")

        with tempfile.TemporaryDirectory(prefix="arduino3d-v16-release-") as temporary:
            fixture_root = (Path(temporary) / "site").resolve()
            fixture_root.mkdir()
            copy_release_sources(fixture_root)
            fixture_dist = (fixture_root / "dist").resolve()
            with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                build_site, "DIST", fixture_dist
            ):
                output = build_site.build()
            for filename in expected_v16:
                self.assertEqual(
                    (output / filename).read_bytes(),
                    (fixture_root / filename).read_bytes(),
                    f"v1.6 release asset bytes changed during packaging: {filename}",
                )
            output_files = {
                path.relative_to(output).as_posix()
                for path in output.rglob("*")
                if path.is_file()
            }
            self.assertEqual(output_files, set(build_site.FILES) | {build_site.MARKER})

    def test_post_v16_practice_release_manifest_is_exact_and_pwa_aligned(self):
        expected_practice = [
            "src/practice-evidence.js",
            "src/practice-evidence-ui.js",
            "styles/practice-evidence.css",
            "docs/PRACTICE_EVIDENCE_NEXT.md",
        ]
        self.assertEqual(build_site.PRACTICE_RELEASE_FILES, expected_practice)
        practice_prefix = build_site.FILES[:87]
        self.assertEqual(len(practice_prefix), 87,
                         "post-v1.6 practice prefix must remain exactly 83 protected + 4 practice files")
        self.assertEqual(practice_prefix[-4:], expected_practice)
        for filename in expected_practice:
            source = build_site._release_source(filename)
            self.assertTrue(source.is_file(), filename)
            self.assertFalse(source.is_symlink(), filename)
            self.assertGreater(len(source.read_bytes()), 0, filename)

        model = (ROOT / "src/practice-evidence.js").read_text(encoding="utf-8")
        ui = (ROOT / "src/practice-evidence-ui.js").read_text(encoding="utf-8")
        self.assertIn('from "./circuit-router.js"', model,
                      "Practice evidence model must package its actual circuit-router dependency")
        self.assertNotIn('from "./practice-evidence.js"', ui,
                         "Presentation-only UI currently consumes evidence via caller, not a direct model import")
        app = (ROOT / "src/app.js").read_text(encoding="utf-8")
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('from "./practice-evidence.js"', app)
        self.assertIn('from "./practice-evidence-ui.js"', app)
        self.assertIn('href="styles/practice-evidence.css"', html)

        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        assets = build_site._service_worker_assets(worker)
        expected_assets = ["./", *[f"./{name}" for name in build_site.FILES if name != "sw.js"]]
        self.assertEqual(assets, expected_assets,
                         "post-v1.6 practice candidate SW precache must exactly mirror 87-file order")

        with tempfile.TemporaryDirectory(prefix="arduino3d-practice-release-") as temporary:
            fixture_root = (Path(temporary) / "site").resolve()
            fixture_root.mkdir()
            copy_release_sources(fixture_root)
            fixture_dist = (fixture_root / "dist").resolve()
            with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                build_site, "DIST", fixture_dist
            ):
                output = build_site.build()
            output_files = {
                path.relative_to(output).as_posix()
                for path in output.rglob("*")
                if path.is_file()
            }
            self.assertEqual(output_files, set(build_site.FILES) | {build_site.MARKER})
            self.assertEqual((output / build_site.MARKER).read_bytes(),
                             b"Generated by scripts/build_site.py\n")

    def test_post_v16_authored_lab_release_suffix_is_exact_and_pwa_aligned(self):
        expected_post_v16_lab = [
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
        expected_post_v16_interaction = [
            "src/practice-observation.js",
            "src/practice-observation-ui.js",
            "src/breadboard-placement-session.js",
            "docs/PRACTICE_OBSERVATION_NEXT.md",
            "docs/RESISTIVE_VISUAL_STUDY_NEXT.md",
        ]
        expected_post_v16_guided_wiring = [
            "src/breadboard-hole-grid.js",
            "src/practice-wire-guidance.js",
            "docs/BREADBOARD_HOLE_PICKER_NEXT.md",
            "docs/PRACTICE_WIRE_GUIDANCE_NEXT.md",
            "docs/SCENE_WIRE_PREVIEW_NEXT.md",
        ]
        self.assertTrue(hasattr(build_site, "POST_V16_LAB_FILES"),
                        "build must expose the exact post-v1.6 authored-lab release suffix")
        self.assertTrue(hasattr(build_site, "POST_V16_INTERACTION_FILES"),
                        "build must expose the exact post-v1.6 interaction release suffix")
        self.assertTrue(hasattr(build_site, "POST_V16_GUIDED_WIRING_FILES"),
                        "build must expose the exact post-v1.6 guided-wiring release suffix")
        self.assertEqual(build_site.POST_V16_LAB_FILES, expected_post_v16_lab)
        self.assertEqual(build_site.POST_V16_INTERACTION_FILES, expected_post_v16_interaction)
        self.assertEqual(build_site.POST_V16_GUIDED_WIRING_FILES, expected_post_v16_guided_wiring)
        self.assertEqual(len(build_site.FILES), 126,
                         "candidate must preserve 118 existing paths + 8 new study assets")
        self.assertEqual(build_site.FILES[87:97], expected_post_v16_lab)
        self.assertEqual(build_site.FILES[97:102], expected_post_v16_interaction)
        self.assertEqual(build_site.FILES[102:107], expected_post_v16_guided_wiring)

        # Hash the ordered path prefixes, not source bytes. These pins make it
        # impossible to silently reorder/replace an older public asset while
        # appending the new candidate suffix.
        protected_v16 = sha256(
            ("\n".join(build_site.FILES[:83]) + "\n").encode("utf-8")
        ).hexdigest()
        protected_practice = sha256(
            ("\n".join(build_site.FILES[:87]) + "\n").encode("utf-8")
        ).hexdigest()
        protected_authored_lab = sha256(
            ("\n".join(build_site.FILES[:97]) + "\n").encode("utf-8")
        ).hexdigest()
        protected_interaction = sha256(
            ("\n".join(build_site.FILES[:102]) + "\n").encode("utf-8")
        ).hexdigest()
        self.assertEqual(
            protected_v16,
            "53c935e8002dd780adc7abe2a40b8e121b754f43b0c9f91418c779082374bf88",
            "the protected 83-file v1.6 path prefix changed",
        )
        self.assertEqual(
            protected_practice,
            "b457c70d5f8c78654870a21797f59f97dfd5fcec1feab132d3e138aecc40b7d5",
            "the protected 87-file practice path prefix changed",
        )
        self.assertEqual(
            protected_authored_lab,
            "48db3b0923e6c4fd178e865fa8954976e152256e324345a504345cacdaa9626f",
            "the protected 97-file authored-lab path prefix changed",
        )
        self.assertEqual(
            protected_interaction,
            "d6eafc58683be16f50559fa5af1bf212537578b16b846b86973777ad8944ce87",
            "the protected 102-file interaction path prefix changed",
        )

        expected_fidelity = [
            "docs/SCENE_VISUAL_FIDELITY_NEXT.md",
            "docs/PRACTICE_CHECKLIST_NEXT.md",
            "docs/SKETCH_LEXICAL_FEEDBACK_NEXT.md",
        ]
        self.assertTrue(hasattr(build_site, "POST_V16_FIDELITY_FILES"))
        self.assertEqual(build_site.POST_V16_FIDELITY_FILES, expected_fidelity)
        self.assertEqual(build_site.FILES[107:110], expected_fidelity)
        protected_guided = sha256(
            ("\n".join(build_site.FILES[:107]) + "\n").encode("utf-8")
        ).hexdigest()
        self.assertEqual(
            protected_guided,
            "c99ef11e4b8e53f4a5ca58ab897da6c509053ebb5495582d63f75ec8e33fb7ec",
            "the protected 107-file guided-wiring path prefix changed",
        )

        expected_inspection = [
            "src/breadboard-authored-groups.js",
            "src/resistive-branch-study.js",
            "src/uno-mechanical-reference.js",
            "docs/BREADBOARD_AUTHORED_GROUPS_NEXT.md",
            "docs/SCENE_WIRE_INSPECTION_NEXT.md",
            "docs/RESISTIVE_BRANCH_STUDY_NEXT.md",
            "docs/UNO_MECHANICAL_REFERENCE_NEXT.md",
            "docs/PRACTICE_PAIR_PREVIEW_NEXT.md",
        ]
        self.assertTrue(hasattr(build_site, "POST_V16_GUIDED_INSPECTION_FILES"))
        self.assertEqual(build_site.POST_V16_GUIDED_INSPECTION_FILES, expected_inspection)
        self.assertEqual(build_site.FILES[110:118], expected_inspection)
        protected_fidelity = sha256(
            ("\n".join(build_site.FILES[:110]) + "\n").encode("utf-8")
        ).hexdigest()
        self.assertEqual(
            protected_fidelity,
            "5a8c277108f4314a4bf7896953a5032aad380f75efa4dda1184135fee51499eb",
            "the protected 110-file previous fidelity path prefix changed",
        )

        for filename in [
            *expected_post_v16_lab,
            *expected_post_v16_interaction,
            *expected_post_v16_guided_wiring,
            *expected_fidelity,
            *expected_inspection,
        ]:
            source = build_site._release_source(filename)
            self.assertTrue(source.is_file(), filename)
            self.assertFalse(source.is_symlink(), filename)
            self.assertGreater(len(source.read_bytes()), 0, filename)

        app = (ROOT / "src/app.js").read_text(encoding="utf-8")
        practice = (ROOT / "src/practice-evidence.js").read_text(encoding="utf-8")
        breadboard_ui = (ROOT / "src/breadboard-topology-ui.js").read_text(encoding="utf-8")
        css = (ROOT / "styles/app.css").read_text(encoding="utf-8")
        self.assertIn('from "./uno-reference.js"', app)
        self.assertIn('from "./sketch-review.js"', app)
        self.assertIn('from "./sketch-review-ui.js"', app)
        self.assertIn('from "./practice-checkpoints.js"', practice)
        self.assertIn('from "./practice-wire-guidance.js"', practice)
        self.assertIn('from "./breadboard-placement.js"', breadboard_ui)
        self.assertIn('from "./breadboard-placement-session.js"', breadboard_ui)
        self.assertIn('from "./breadboard-hole-grid.js"', breadboard_ui)
        self.assertIn('from "./uno-mechanical-reference.js"', app)
        self.assertIn('from "./practice-observation.js"', app)
        self.assertIn('from "./practice-observation-ui.js"', app)
        self.assertIn(".uno-pin-reference", css)
        self.assertIn(".sketch-review", css)

        observation = (ROOT / "src/practice-observation.js").read_text(encoding="utf-8")
        observation_ui = (ROOT / "src/practice-observation-ui.js").read_text(encoding="utf-8")
        placement_session = (ROOT / "src/breadboard-placement-session.js").read_text(encoding="utf-8")
        resistive_ui = (ROOT / "src/resistive-study-ui.js").read_text(encoding="utf-8")
        self.assertIn('from "./breadboard-authored-groups.js"', placement_session)
        self.assertIn('from "./resistive-branch-study.js"', resistive_ui)
        hole_grid = (ROOT / "src/breadboard-hole-grid.js").read_text(encoding="utf-8")
        wire_guidance = (ROOT / "src/practice-wire-guidance.js").read_text(encoding="utf-8")
        self.assertIn('from "./practice-checkpoints.js"', observation)
        self.assertNotRegex(observation, r'(?m)^\s*import\s+.*circuit-router',
                            "practice observation must not import learner-graph authority")
        self.assertNotIn("localStorage", observation,
                         "practice observation is intentionally in-session only")
        self.assertNotIn("innerHTML", observation_ui,
                         "practice observation renderer must keep untrusted text on textContent paths")
        self.assertIn('from "./breadboard-placement.js"', placement_session)
        self.assertNotRegex(placement_session, r'(?m)^\s*import\s+.*circuit-router',
                            "authored hole session must never import electrical topology")
        self.assertNotRegex(placement_session, r'(?m)^\s*import\s+.*scene3d',
                            "authored hole session must not import scene geometry")
        self.assertIn('from "./dc-resistor-network.js"', resistive_ui)
        self.assertNotRegex(resistive_ui, r'(?m)^\s*import\s+.*circuit-router',
                            "resistive study remains independent of the learner netlist")
        self.assertIn('from "./breadboard-topology.js"', hole_grid)
        self.assertNotRegex(hole_grid, r'(?m)^\s*import\s+.*circuit-router',
                            "hole picker must only fill canonical input IDs, never mutate netlist")
        self.assertNotRegex(hole_grid, r'(?m)^\s*import\s+.*scene3d',
                            "hole picker must not infer authored holes from scene geometry")
        self.assertIn('from "./circuit-router.js"', wire_guidance)
        self.assertIn('from "./practice-checkpoints.js"', wire_guidance)
        self.assertNotRegex(wire_guidance, r'(?m)^\s*import\s+.*scene3d',
                            "practice guidance must not own scene navigation")
        self.assertNotRegex(wire_guidance, r'(?m)^\s*import\s+.*breadboard',
                            "practice guidance must remain canonical-topology guidance only")
        self.assertNotIn("document.", wire_guidance,
                         "pure practice guidance must not mutate DOM state")

        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        expected_assets = ["./", *[f"./{name}" for name in build_site.FILES if name != "sw.js"]]
        self.assertEqual(
            build_site._service_worker_assets(worker),
            expected_assets,
            "service-worker precache must exactly mirror the 118-file release order",
        )

    def test_post_v16_study_extension_suffix_and_runtime_integrity(self):
        expected = [
            "src/learner-circuit-history.js",
            "src/sketch-pin-evidence.js",
            "src/uno-mounting-evidence.js",
            "docs/LEARNER_CIRCUIT_HISTORY_NEXT.md",
            "docs/SKETCH_PIN_EVIDENCE_NEXT.md",
            "docs/UNO_MOUNTING_EVIDENCE_NEXT.md",
            "docs/POST_V16_SCENE_COMPONENT_FIDELITY.md",
            "docs/AVR_TIMER2_FIDELITY_NEXT.md",
        ]
        self.assertEqual(build_site.POST_V16_STUDY_EXTENSION_FILES, expected)
        self.assertEqual(build_site.FILES[118:], expected)
        self.assertEqual(len(build_site.FILES), 126)
        self.assertEqual(
            sha256(("\n".join(build_site.FILES[:118]) + "\n").encode()).hexdigest(),
            "7e11ef8d5eb085947061ad1f18ce15b2c1042eb2355dcff74b5fedc4b49408b0",
        )
        for path in expected:
            source = build_site._release_source(path)
            self.assertTrue(source.is_file(), path)
            self.assertFalse(source.is_symlink(), path)
            self.assertGreater(source.stat().st_size, 0, path)
        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        self.assertEqual(build_site._service_worker_assets(worker),
                         ["./", *["./" + name for name in build_site.FILES if name != "sw.js"]])
        app = (ROOT / "src/app.js").read_text(encoding="utf-8")
        for module in expected[:3]:
            self.assertIn('from "./' + Path(module).name + '"', app, module)

    def test_post_v16_study_extension_fails_closed_missing_runtime(self):
        for missing in build_site.POST_V16_STUDY_EXTENSION_FILES[:3]:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(
                prefix="arduino3d-study-extension-missing-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                (fixture_root / missing).unlink()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", (fixture_root / "dist").resolve()
                ):
                    with self.assertRaises(FileNotFoundError):
                        build_site.build()

        with tempfile.TemporaryDirectory(prefix="arduino3d-authored-lab-release-") as temporary:
            fixture_root = (Path(temporary) / "site").resolve()
            fixture_root.mkdir()
            copy_release_sources(fixture_root)
            fixture_dist = (fixture_root / "dist").resolve()
            with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                build_site, "DIST", fixture_dist
            ):
                output = build_site.build()
            output_files = {
                path.relative_to(output).as_posix()
                for path in output.rglob("*")
                if path.is_file()
            }
            self.assertEqual(output_files, set(build_site.FILES) | {build_site.MARKER})

    def test_post_v16_guided_inspection_release_fails_closed_when_runtime_source_is_missing(self):
        for missing in (
            "src/breadboard-authored-groups.js",
            "src/resistive-branch-study.js",
            "src/uno-mechanical-reference.js",
        ):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(
                prefix="arduino3d-guided-inspection-missing-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                (fixture_root / missing).unlink()
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaises(FileNotFoundError):
                        build_site.build()

    def test_post_v16_guided_wiring_release_fails_closed_when_runtime_source_is_missing(self):
        for missing in ("src/breadboard-hole-grid.js", "src/practice-wire-guidance.js"):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(
                prefix="arduino3d-guided-wiring-missing-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                (fixture_root / missing).unlink()
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaises(FileNotFoundError):
                        build_site.build()

    def test_post_v16_interaction_release_fails_closed_when_runtime_source_is_missing(self):
        runtime_sources = (
            "src/practice-observation.js",
            "src/practice-observation-ui.js",
            "src/breadboard-placement-session.js",
        )
        for missing in runtime_sources:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(
                prefix="arduino3d-interaction-missing-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                (fixture_root / missing).unlink()
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaises(FileNotFoundError):
                        build_site.build()

    def test_post_v16_authored_lab_release_fails_closed_when_runtime_source_is_missing(self):
        runtime_sources = (
            "src/uno-reference.js",
            "src/practice-checkpoints.js",
            "src/breadboard-placement.js",
            "src/sketch-review.js",
            "src/sketch-review-ui.js",
        )
        for missing in runtime_sources:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(
                prefix="arduino3d-authored-lab-missing-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                (fixture_root / missing).unlink()
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaises(FileNotFoundError):
                        build_site.build()

    def test_post_v16_practice_release_fails_closed_when_required_asset_is_missing(self):
        for missing in ("src/practice-evidence.js", "src/practice-evidence-ui.js"):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(
                prefix="arduino3d-practice-missing-"
            ) as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                (fixture_root / missing).unlink()
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaises(FileNotFoundError):
                        build_site.build()

    def test_compiled_intel_hex_preserves_original_crlf_bytes_across_git_checkouts(self):
        attributes = (ROOT / ".gitattributes").read_text(encoding="utf-8")
        self.assertRegex(attributes, r"(?m)^assets/firmware/\*\.hex\s+binary\s*$",
                         "Compiled firmware bytes must never undergo Git EOL conversion")
        for lesson_id in range(1, 17):
            data = (ROOT / f"assets/firmware/lesson_{lesson_id:02d}.hex").read_bytes()
            self.assertGreater(data.count(b"\r\n"), 0, f"lesson {lesson_id}: expected compiler CRLF")
            self.assertEqual(data.count(b"\r\n"), data.count(b"\n"),
                             f"lesson {lesson_id}: Git may have normalized compiled bytes")

    def test_service_worker_precache_matches_release_files(self):
        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        block = ASSETS_RE.search(worker)
        self.assertIsNotNone(block, "Service worker ASSETS list is missing")
        assets = re.findall(r'"([^"]+)"', block.group(1))
        expected = ["./", *[f"./{name}" for name in build_site.FILES if name != "sw.js"]]
        self.assertEqual(assets, expected, "Precache order/content must exactly match build allowlist")
        self.assertEqual(len(assets), len(set(assets)), "Precache list contains duplicate URLs")
        self.assertTrue(all(asset.startswith("./") for asset in assets))

    def test_release_allowlist_covers_optional_avr_runtime_and_provenance(self):
        expected = {
            "styles/avr-panel.css",
            "styles/lab-editor.css",
            "src/avr-panel.js",
            "src/lab-layout.js",
            "src/lab-editor-ui.js",
            "src/learning-coach.js",
            "src/firmware-integrity.js",
            "src/avr-runtime.js",
            "src/electrical-solver.js",
            "src/avr-gpio.js",
            "src/avr-timer0.js",
            "src/avr-timer1.js",
            "src/avr-analog-serial.js",
            "src/avr-board-runner.js",
            "docs/GPIO_RUNTIME.md",
            "docs/TIMER0_RUNTIME.md",
            "docs/ANALOG_SERIAL_RUNTIME.md",
            "docs/AVR_BOARD_LAB.md",
            "docs/LAB_LAYOUT.md",
            "docs/SCENE3D_LAB.md",
            "docs/LEARNING_COACH.md",
            "docs/TIMER1_RUNTIME.md",
            "assets/vendor/avr/cpu.js",
            "assets/vendor/avr/instruction.js",
            "assets/vendor/avr/interrupt.js",
            "assets/vendor/avr/avr8js-0.21.1-source/cpu.ts",
            "assets/vendor/avr/avr8js-0.21.1-source/instruction.ts",
            "assets/vendor/avr/avr8js-0.21.1-source/interrupt.ts",
            "assets/vendor/avr/AVR8JS-LICENSE.txt",
            "assets/vendor/avr/PROVENANCE.json",
            "THIRD-PARTY-NOTICES.md",
        }
        self.assertTrue(expected.issubset(build_site.FILES))
        self.assertEqual(
            set(build_site.FIRMWARE_FILES),
            {"assets/firmware/manifest.json", *{f"assets/firmware/lesson_{i:02d}.hex" for i in range(1, 17)}},
        )
        build_site._verify_avr_vendor_assets()

    def test_release_allowlist_rejects_arbitrary_or_escaping_paths(self):
        original = list(build_site.FILES)
        for unsafe in ("../outside.txt", "/absolute.txt", r"C:\outside.txt", "C:/outside.txt"):
            with self.subTest(unsafe=unsafe), mock.patch.object(build_site, "FILES", [*original, unsafe]):
                with self.assertRaisesRegex(RuntimeError, "Unsafe release allowlist"):
                    build_site._verify_release_allowlist()

    def test_third_party_notice_preserves_three_and_records_avr8js_provenance(self):
        notice = (ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        self.assertIn("Three.js r180", notice)
        self.assertIn("avr8js v0.21.1", notice)
        self.assertIn("MIT License", notice)
        self.assertIn("bee6f0a94e0e27786f6bc21aee3c775849fb50fd", notice)
        self.assertIn("assets/vendor/avr/AVR8JS-LICENSE.txt", notice)
        self.assertIn("assets/vendor/avr/PROVENANCE.json", notice)

    def test_build_cache_is_deterministic_and_content_addressed(self):
        source_worker = (ROOT / "sw.js").read_bytes()
        with tempfile.TemporaryDirectory(prefix="arduino3d-release-") as temporary:
            fixture_root = (Path(temporary) / "site").resolve()
            fixture_root.mkdir()
            copy_release_sources(fixture_root)
            fixture_dist = (fixture_root / "dist").resolve()
            with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                build_site, "DIST", fixture_dist
            ):
                first = build_site.build()
                self.assertEqual(
                    (first / build_site.MARKER).read_bytes(),
                    b"Generated by scripts/build_site.py\n",
                    "Release marker must be the same LF bytes on Windows and Linux",
                )
                first_worker = (first / "sw.js").read_text(encoding="utf-8")
                first_cache = cache_name(first_worker)
                self.assertRegex(first_cache, r"^arduino3d-viet-static-[0-9a-f]{16}$")

                second = build_site.build()
                second_cache = cache_name((second / "sw.js").read_text(encoding="utf-8"))
                self.assertEqual(first_cache, second_cache)

                css = fixture_root / "styles/app.css"
                css.write_text(
                    css.read_text(encoding="utf-8") + "\n/* release-contract mutation */\n",
                    encoding="utf-8",
                )
                third = build_site.build()
                third_cache = cache_name((third / "sw.js").read_text(encoding="utf-8"))
                self.assertNotEqual(first_cache, third_cache)

                # Changing Arduino Sketch source without regenerating verified
                # HEX is a safety/provenance error; never ship stale firmware.
                lessons = fixture_root / "src/lessons.js"
                lessons.write_text(
                    lessons.read_text(encoding="utf-8") + "\n/* stale firmware should fail */\n",
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(RuntimeError, "firmware"):
                    build_site.build()

                output_files = {
                    path.relative_to(third).as_posix()
                    for path in third.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(output_files, set(build_site.FILES) | {build_site.MARKER})

        self.assertEqual((ROOT / "sw.js").read_bytes(), source_worker)

    def test_build_rejects_source_sketch_hex_and_flash_firmware_tampering(self):
        cases = {
            "source": lambda manifest, root: manifest.__setitem__("source_sha256", "0" * 64),
            "sketch": lambda manifest, root: manifest["lessons"][0].__setitem__("sketch_sha256", "0" * 64),
            "hex": lambda manifest, root: (root / "assets/firmware/lesson_01.hex").write_bytes(
                (root / "assets/firmware/lesson_01.hex").read_bytes() + b"\n"
            ),
            "flash": lambda manifest, root: manifest["lessons"][0].__setitem__("flash_sha256", "0" * 64),
        }
        for label, mutate in cases.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="arduino3d-fw-release-") as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                manifest_path = fixture_root / "assets/firmware/manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                mutate(manifest, fixture_root)
                if label != "hex":
                    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaisesRegex(RuntimeError, "firmware"):
                        build_site.build()

    def test_build_rejects_avr_vendor_byte_or_provenance_tampering(self):
        for label in ("runtime", "provenance"):
            with self.subTest(label=label), tempfile.TemporaryDirectory(prefix="arduino3d-avr-release-") as temporary:
                fixture_root = (Path(temporary) / "site").resolve()
                fixture_root.mkdir()
                copy_release_sources(fixture_root)
                if label == "runtime":
                    path = fixture_root / "assets/vendor/avr/cpu.js"
                    path.write_text(path.read_text(encoding="utf-8") + "\n// tampered\n", encoding="utf-8")
                else:
                    path = fixture_root / "assets/vendor/avr/PROVENANCE.json"
                    provenance = json.loads(path.read_text(encoding="utf-8"))
                    provenance["upstream"]["version"] = "0.0.0"
                    path.write_text(json.dumps(provenance), encoding="utf-8")
                fixture_dist = (fixture_root / "dist").resolve()
                with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                    build_site, "DIST", fixture_dist
                ):
                    with self.assertRaisesRegex(RuntimeError, "avr8js"):
                        build_site.build()

    def test_build_rejects_synchronized_avr_runtime_and_provenance_tampering(self):
        with tempfile.TemporaryDirectory(prefix="arduino3d-avr-sync-tamper-") as temporary:
            fixture_root = (Path(temporary) / "site").resolve()
            fixture_root.mkdir()
            copy_release_sources(fixture_root)

            runtime_path = fixture_root / "assets/vendor/avr/cpu.js"
            runtime_path.write_bytes(runtime_path.read_bytes() + b"\n// synchronized tamper\n")
            tampered_hash = sha256(runtime_path.read_bytes()).hexdigest()

            provenance_path = fixture_root / "assets/vendor/avr/PROVENANCE.json"
            provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
            for row in provenance["derived_browser_esm"]:
                if row.get("path") == "assets/vendor/avr/cpu.js":
                    row["sha256"] = tampered_hash
                    break
            else:
                self.fail("cpu.js provenance row missing from fixture")
            provenance_path.write_text(json.dumps(provenance, ensure_ascii=False), encoding="utf-8")

            fixture_dist = (fixture_root / "dist").resolve()
            with mock.patch.object(build_site, "ROOT", fixture_root), mock.patch.object(
                build_site, "DIST", fixture_dist
            ):
                with self.assertRaisesRegex(RuntimeError, "avr8js") as raised:
                    build_site.build()
                self.assertIn("pinned checksum", str(raised.exception.__cause__))

    def test_pwa_navigation_contract_is_project_subpath_safe(self):
        manifest = json.loads((ROOT / "site.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest.get("start_url"), "./")
        self.assertEqual(manifest.get("scope"), "./")
        for icon in manifest.get("icons", []):
            self.assertFalse(icon["src"].startswith("/"), icon["src"])

        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertNotRegex(html, r"<(?:base)\b", "A base URL can break Pages project subpaths")
        for reference in re.findall(r'(?:href|src)="([^"]+)"', html):
            if reference.startswith(("http://", "https://", "data:", "#")):
                continue
            self.assertFalse(reference.startswith("/"), reference)

        app = (ROOT / "src/app.js").read_text(encoding="utf-8")
        self.assertIn('navigator.serviceWorker.register("./sw.js")', app)
        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        self.assertIn('req.mode === "navigate" ? caches.match("./index.html")', worker)
        self.assertIn("new URL(req.url).origin !== self.location.origin", worker)

    def test_ci_tests_builds_and_deploys_dist(self):
        workflow = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        test_command = "python -m unittest discover -s tests -v"
        build_command = "python scripts/build_site.py"
        upload_build = "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
        release_gate = "run: python scripts/verify_release_gates.py"
        self.assertIn("pages: write", workflow)
        self.assertIn("id-token: write", workflow)
        self.assertLess(workflow.index(test_command), workflow.index(build_command))
        self.assertLess(workflow.index(build_command), workflow.index(release_gate))
        self.assertLess(workflow.index(release_gate), workflow.index(upload_build),
                        "No deployable artifact may exist before firmware + exact-SHA release gates")
        package_upload = workflow[
            workflow.index(upload_build):workflow.index("\n\n  deploy:", workflow.index(upload_build))
        ]
        self.assertTrue(build_site.MARKER.startswith("."), "Release marker must remain a hidden file")
        self.assertIn("path: dist", package_upload)
        self.assertIn("include-hidden-files: true", package_upload,
                      "Package artifact must retain the hidden release marker used by backup provenance checks")
        self.assertIn("needs: check", workflow)
        self.assertIn("if: github.event_name == 'workflow_dispatch'", workflow,
                      "GitHub Pages must never auto-deploy from a push")
        self.assertIn("uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093", workflow)
        self.assertIn("uses: actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa", workflow)
        self.assertIn("uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e", workflow)
        self.assertGreaterEqual(workflow.count("path: dist"), 2)

    def test_local_http_server_uses_release_mime_types(self):
        handler = Handler.__new__(Handler)
        self.assertTrue(handler.guess_type("src/app.js").startswith("text/javascript"))
        self.assertTrue(handler.guess_type("site.webmanifest").startswith("application/manifest+json"))
        self.assertTrue(handler.guess_type("assets/favicon.svg").startswith("image/svg+xml"))


if __name__ == "__main__":
    unittest.main()
