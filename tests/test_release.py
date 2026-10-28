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
    def test_service_worker_precache_matches_release_files(self):
        worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        block = ASSETS_RE.search(worker)
        self.assertIsNotNone(block, "Service worker ASSETS list is missing")
        assets = re.findall(r'"([^"]+)"', block.group(1))
        expected = ["./", *[f"./{name}" for name in build_site.FILES if name != "sw.js"]]
        self.assertCountEqual(assets, expected)
        self.assertEqual(len(assets), len(set(assets)), "Precache list contains duplicate URLs")
        self.assertTrue(all(asset.startswith("./") for asset in assets))

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

                lessons = fixture_root / "src/lessons.js"
                lessons.write_text(
                    lessons.read_text(encoding="utf-8") + "\n/* release-contract mutation */\n",
                    encoding="utf-8",
                )
                third = build_site.build()
                third_cache = cache_name((third / "sw.js").read_text(encoding="utf-8"))
                self.assertNotEqual(first_cache, third_cache)

                output_files = {
                    path.relative_to(third).as_posix()
                    for path in third.rglob("*")
                    if path.is_file()
                }
                self.assertEqual(output_files, set(build_site.FILES) | {build_site.MARKER})

        self.assertEqual((ROOT / "sw.js").read_bytes(), source_worker)

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
        upload_build = "uses: actions/upload-artifact@v4"
        self.assertIn("pages: write", workflow)
        self.assertIn("id-token: write", workflow)
        self.assertLess(workflow.index(test_command), workflow.index(build_command))
        self.assertLess(workflow.index(build_command), workflow.index(upload_build))
        self.assertIn("needs: check", workflow)
        self.assertIn("uses: actions/download-artifact@v4", workflow)
        self.assertIn("uses: actions/upload-pages-artifact@v3", workflow)
        self.assertIn("uses: actions/deploy-pages@v4", workflow)
        self.assertGreaterEqual(workflow.count("path: dist"), 2)

    def test_local_http_server_uses_release_mime_types(self):
        handler = Handler.__new__(Handler)
        self.assertTrue(handler.guess_type("src/app.js").startswith("text/javascript"))
        self.assertTrue(handler.guess_type("site.webmanifest").startswith("application/manifest+json"))
        self.assertTrue(handler.guess_type("assets/favicon.svg").startswith("image/svg+xml"))


if __name__ == "__main__":
    unittest.main()
