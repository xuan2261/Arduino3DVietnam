"""Browser acceptance for Arduino 3D Việt Nam.

Run after building the release: python tests/e2e_browser.py
Requires preinstalled playwright + Chromium; does NOT install browsers,
start external processes, modify user Chrome, or access outside localhost.
Starts one ephemeral HTTP server and one isolated headless browser.
"""
from __future__ import annotations

import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "screenshots"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    from scripts.serve import Handler

    report: list[dict[str, object]] = []
    errors: list[str] = []

    def check(name: str, passed: bool, details: str = "") -> None:
        report.append({"name": name, "passed": bool(passed), "details": details})
        if not passed:
            raise AssertionError(f"{name}: {details}")

    def ready(page) -> None:
        page.wait_for_function("document.documentElement.dataset.ready === '3d'", timeout=20000)

    class QuietHandler(Handler):
        def log_message(self, format: str, *args) -> None:
            # Browser runs request dozens of static assets; log only failures
            # through the explicit E2E assertions, not each successful GET.
            pass

    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT))
    )
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    base = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as playwright:
            # Use the already-installed system Chrome. The Playwright-managed
            # Chromium revision expected by this Python package is not installed;
            # do not download or replace a pinned browser as a test side effect.
            browser = playwright.chromium.launch(headless=True, channel="chrome")
            try:
                desktop = browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    accept_downloads=True,
                    service_workers="allow",
                )
                page = desktop.new_page()
                page.on("pageerror", lambda exc: errors.append(str(exc)))
                page.goto(base, wait_until="domcontentloaded", timeout=15000)
                ready(page)
                SCREENSHOTS.mkdir(exist_ok=True)
                page.screenshot(path=str(SCREENSHOTS / "qa-v1.1-desktop.png"), full_page=False)
                check("desktop-3d", page.locator("#sceneMount canvas").count() == 1)
                check("sidebar-16", page.locator(".lesson-link").count() == 16)
                check("desktop-no-overflow",
                      page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

                contracts = page.evaluate(
                    "() => import('./tests/browser-contracts.js').then(m => m.runContracts())"
                )
                check("simulator-contracts", contracts["failed"] == 0,
                      f"{contracts['passed']} passed")
                circuits = page.evaluate(
                    "() => import('./tests/circuit-contracts.js').then(m => m.runCircuitContracts())"
                )
                check("circuit-contracts", circuits["failed"] == 0,
                      f"{circuits['passed']} passed")

                # Every lesson must update title and quiz without dropping canvas.
                for lesson_id in range(1, 17):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    check(f"lesson-{lesson_id:02d}-render",
                          page.locator("#sceneMount canvas").count() == 1
                          and page.locator("#quizChoices input").count() >= 3
                          and len(page.locator("#codeViewer").inner_text()) > 30)

                # Review, edit and export real .ino bytes. No code executed.
                page.locator('.lesson-link[data-lesson="3"]').click()
                page.locator("#editCode").click()
                page.locator("#codeEditor").fill("void setup() {}\nvoid loop() {}\n")
                check("edit-is-explicitly-draft",
                      "Mã đã sửa" in page.locator("#codeEditStatus").inner_text())
                with page.expect_download() as download_info:
                    page.locator("#downloadCode").click()
                download = download_info.value
                check("ino-download-filename", download.suggested_filename == "bai_03.ino")
                check("ino-download-bytes",
                      "void loop()" in Path(download.path()).read_text(encoding="utf-8"))
                page.locator("#restoreCode").click()
                check("ino-restore", "pinMode(BUTTON, INPUT)" in
                      page.locator("#codeViewer").inner_text())

                # Wiring editor: incomplete circuit blocks custom simulation.
                page.locator('.stage-tabs [data-stage="wiring"]').click()
                check("wiring-terminal-controls", page.locator("[data-terminal]").count() == 12)
                check("wiring-missing-disabled",
                      page.locator(".wire-activate").is_disabled())
                # Real pointer and keyboard-driven terminal interactions
                # exercise the UI path rather than only the pure circuit model.
                page.locator('[data-terminal="5V"]').click()
                page.locator('[data-terminal="BTN:1"]').click()
                check("wiring-click-connect",
                      page.locator(".wire-connected").count() == 1)
                page.locator(".wire-actions .wire-action").nth(1).click()
                check("wiring-clear-after-click",
                      page.locator(".wire-connected").count() == 0)
                page.locator('[data-terminal="D13"]').drag_to(
                    page.locator('[data-terminal="R_LED:A"]'),
                    steps=8,
                )
                check("wiring-drag-connect",
                      page.locator(".wire-connected").count() == 1)
                page.locator(".wire-actions .wire-action").nth(1).click()
                page.locator(".wire-actions .wire-action").first.click()
                check("wiring-sample-complete",
                      not page.locator(".wire-activate").is_disabled()
                      and page.locator(".wire-connected").count() == 7)
                page.screenshot(path=str(SCREENSHOTS / "qa-v1.1-wiring.png"), full_page=False)
                # A fully wired sample with an additional dangerous short must
                # never be marked usable because its functional paths remain.
                page.locator('[data-terminal="5V"]').click()
                page.locator('[data-terminal="GND"]').click()
                check("wiring-dangerous-short-blocked",
                      page.locator(".wire-activate").is_disabled())
                page.locator(".wire-remove").last.click()
                check("wiring-short-removal-restores-validation",
                      not page.locator(".wire-activate").is_disabled())
                page.locator(".wire-activate").click()
                check("wiring-activated", page.locator(".wire-activate").get_attribute("aria-pressed") == "true")
                page.locator("#runButton").click()
                check("custom-circuit-runs", "Đang chạy" in page.locator("#runStatus").inner_text())
                page.locator(".wire-remove").first.click()
                check("invalid-wire-stops", "Đang dừng" in page.locator("#runStatus").inner_text())
                page.locator("#runButton").click()
                check("invalid-wire-blocks-restart",
                      "Đang dừng" in page.locator("#runStatus").inner_text())
                page.locator(".wire-actions .wire-action").first.click()
                page.locator("#runButton").click()
                check("repaired-wire-can-run", "Đang chạy" in page.locator("#runStatus").inner_text())
                page.locator("#runButton").click()
                page.locator('.stage-tabs [data-stage="3d"]').click()
                check("return-3d", page.locator("#sceneMount canvas").count() == 1)

                # Sample presets for LED and RGB must be valid (regression for missing RGB:G).
                for lesson_id in (2, 5):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    page.locator('.stage-tabs [data-stage="wiring"]').click()
                    page.locator(".wire-actions .wire-action").first.click()
                    check(f"wiring-{lesson_id}-sample",
                          not page.locator(".wire-activate").is_disabled())
                    page.locator('.stage-tabs [data-stage="3d"]').click()

                # Quiz progress increments only after explicit completion click.
                page.locator('.lesson-link[data-lesson="1"]').click()
                check("before-quiz-not-done", "0/16" in page.locator("#progressText").inner_text())
                page.locator('#quizChoices input[value="1"]').check()
                page.locator('#quizForm button[type="submit"]').click()
                check("quiz-checked-only", "0/16" in page.locator("#progressText").inner_text())
                page.locator("#completeButton").click()
                check("explicit-completion", "1/16" in page.locator("#progressText").inner_text())
                page.reload(wait_until="domcontentloaded")
                ready(page)
                check("local-progress-persists", "1/16" in page.locator("#progressText").inner_text())

                # Mobile drawer focus and no horizontal scrolling at breakpoint sizes.
                for width in (375, 768, 1024):
                    context = browser.new_context(viewport={"width": width, "height": 812})
                    small = context.new_page()
                    small.on("pageerror", lambda exc: errors.append(str(exc)))
                    small.goto(base + "#bai-03", wait_until="domcontentloaded")
                    ready(small)
                    if width == 375:
                        small.screenshot(path=str(SCREENSHOTS / "qa-v1.1-mobile-375.png"), full_page=False)
                    check(f"no-horizontal-scroll-{width}",
                          small.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                    if width <= 1010:
                        check(f"closed-drawer-inert-{width}",
                              small.locator("#sidebar").get_attribute("aria-hidden") == "true"
                              and small.locator("#sidebar").evaluate("(e) => e.inert"))
                        small.locator("#openSidebar").click()
                        check(f"open-drawer-focused-{width}",
                              small.evaluate("document.activeElement.id==='closeSidebar'"))
                        small.keyboard.press("Escape")
                        check(f"closed-drawer-restored-{width}",
                              small.evaluate(
                                  "document.activeElement.id==='openSidebar' && document.querySelector('#sidebar').inert"
                              ))
                    context.close()

                # Published dist: offline after service worker installation.
                dist = ROOT / "dist"
                if not (dist / ".arduino-3d-viet-generated").is_file():
                    raise AssertionError("Build dist before running offline tests")
                offline = browser.new_context(viewport={"width": 1280, "height": 800},
                                              service_workers="allow")
                app = offline.new_page()
                app.goto(base + "dist/", wait_until="domcontentloaded")
                ready(app)
                check("dist-renders", app.locator("#sceneMount canvas").count() == 1)
                registered = app.evaluate("""async () => {
                    const registration = await navigator.serviceWorker.register('./sw.js');
                    const ready = await navigator.serviceWorker.ready;
                    return {
                        readyState: ready.active?.state || null,
                        registrationState: registration.active?.state || null,
                        scope: ready.scope,
                        caches: await caches.keys()
                    };
                }""")
                # navigator.serviceWorker.ready may resolve while the active
                # worker is still in the final "activating" transition.
                app.wait_for_function("""async () => {
                    const registration = await navigator.serviceWorker.getRegistration('./');
                    return registration?.active?.state === 'activated';
                }""", timeout=15000)
                check("offline-worker-activated",
                      app.evaluate("""async () => {
                          const registration = await navigator.serviceWorker.getRegistration('./');
                          return registration?.active?.state === 'activated';
                      }"""), json.dumps(registered))
                app.reload(wait_until="domcontentloaded")
                ready(app)
                check("offline-worker-controls-page",
                      app.evaluate("Boolean(navigator.serviceWorker.controller)"),
                      "dist page should be controlled before disabling network")
                offline.set_offline(True)
                app.reload(wait_until="domcontentloaded", timeout=20000)
                ready(app)
                check("offline-dist-renders", app.locator("#sceneMount canvas").count() == 1)
                offline.set_offline(False)
                offline.close()

                desktop.close()
                check("no-uncaught-pageerrors", not errors, "; ".join(errors[:4]))
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

    print(json.dumps({
        "total": len(report), "passed": sum(item["passed"] for item in report),
        "failed": sum(not item["passed"] for item in report), "checks": report,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
