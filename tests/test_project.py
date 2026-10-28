"""Static and local HTTP checks. Run: python -m unittest discover -s tests -v"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[1]


class StaticProjectTests(unittest.TestCase):
    def test_all_required_files_present(self):
        files = [
            "index.html", "styles/app.css", "src/app.js", "src/lessons.js",
            "src/simulator.js", "src/scene3d.js", "src/storage.js",
            "assets/vendor/three.module.min.js", "assets/vendor/three.core.min.js",
            "assets/vendor/THREE-LICENSE.txt", "scripts/serve.py",
            "site.webmanifest", "assets/favicon.svg",
        ]
        for name in files:
            with self.subTest(file=name):
                self.assertTrue((ROOT / name).is_file())

    def test_vietnamese_app_shell(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('lang="vi"', html)
        self.assertIn("Arduino 3D Việt Nam", html)
        self.assertIn('id="sceneMount"', html)
        self.assertIn('id="quizForm"', html)
        self.assertIn('id="serialConsole"', html)
        self.assertIn('id="lessonSearch"', html)
        self.assertNotIn("https://fonts.googleapis.com", html)

    def test_each_local_module_import_exists(self):
        for p in (ROOT / "src").glob("*.js"):
            js = p.read_text(encoding="utf-8")
            for relative in re.findall(r'(?:from\s+|import\()\s*["\'](\.{1,2}/[^"\']+)["\']', js):
                target = (p.parent / relative).resolve()
                with self.subTest(source=p.name, target=relative):
                    self.assertTrue(target.is_file(), f"Missing import: {target}")

    def test_vendored_three_dependency(self):
        module = (ROOT / "assets/vendor/three.module.min.js").read_text(encoding="utf-8")
        self.assertIn("three.core.min.js", module)
        license_text = (ROOT / "assets/vendor/THREE-LICENSE.txt").read_text(encoding="utf-8")
        self.assertIn("MIT", license_text)

    def test_manifest(self):
        manifest = json.loads((ROOT / "site.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["lang"], "vi")
        self.assertEqual(manifest["start_url"], "./")
        self.assertEqual(manifest["display"], "standalone")

    def test_vietnamese_lessons_exist(self):
        js = (ROOT / "src/lessons.js").read_text(encoding="utf-8")
        ids = [int(x) for x in re.findall(r"\bid: (\d+), slug:", js)]
        self.assertEqual(ids, list(range(1, 17)))
        self.assertGreaterEqual(js.count("quiz:"), 16)
        self.assertGreaterEqual(js.count("wiring:"), 16)

    def test_no_credentials_or_remote_asset_scripts(self):
        for name in ["index.html", "src/app.js", "src/storage.js", "src/lessons.js"]:
            content = (ROOT / name).read_text(encoding="utf-8")
            self.assertNotIn('type="password"', content)
            self.assertNotIn("cdn.jsdelivr.net", content)
            self.assertNotIn("eval(", content)

    def test_http_mime_type_override(self):
        from scripts.serve import Handler
        handler = Handler.__new__(Handler)
        self.assertTrue(handler.guess_type("src/app.js").startswith("text/javascript"))
        self.assertTrue(handler.guess_type("src/lessons.js").startswith("text/javascript"))
        self.assertTrue(handler.guess_type("styles/app.css").startswith("text/css"))


if __name__ == "__main__":
    unittest.main()
