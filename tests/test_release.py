"""Release/PWA contracts that need only Python's standard library."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import unittest
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
            "src/avr-panel.js",
            "src/firmware-integrity.js",
            "src/avr-runtime.js",
            "src/electrical-solver.js",
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
