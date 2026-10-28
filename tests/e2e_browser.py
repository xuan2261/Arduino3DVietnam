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
import os
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
    warnings: list[str] = []

    def check(name: str, passed: bool, details: str = "") -> None:
        report.append({"name": name, "passed": bool(passed), "details": details})
        if not passed:
            raise AssertionError(f"{name}: {details}")

    def ready(page) -> None:
        page.wait_for_function("document.documentElement.dataset.ready === '3d'", timeout=20000)

    def run_page_contract(page, module_path: str, export_name: str):
        """Import a browser contract relative to the served app base/subpath."""
        return page.evaluate(
            """async ({ modulePath, exportName }) => {
                const moduleUrl = new URL(modulePath, document.baseURI).href;
                const contract = await import(moduleUrl);
                if (typeof contract[exportName] !== "function") {
                    throw new Error(`Missing contract export ${exportName} from ${moduleUrl}`);
                }
                return await contract[exportName]();
            }""",
            {"modulePath": module_path, "exportName": export_name},
        )

    def capture_console(page) -> None:
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda message: warnings.append(message.text)
                if message.type == "warning" else None)

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
            # The local Windows runner uses existing Chrome; an opt-in GitHub
            # runner can use the pinned Playwright-managed Chromium installed
            # in that disposable runner. Neither mode installs a browser here.
            browser_kind = os.environ.get("ARDUINO_E2E_BROWSER", "chrome").lower()
            if browser_kind not in {"chrome", "chromium"}:
                raise ValueError("ARDUINO_E2E_BROWSER must be chrome or chromium")
            kwargs = {"headless": True}
            if browser_kind == "chrome":
                kwargs["channel"] = "chrome"
            browser = playwright.chromium.launch(**kwargs)
            try:
                desktop = browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    accept_downloads=True,
                    service_workers="allow",
                )
                page = desktop.new_page()
                capture_console(page)
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
                extended = page.evaluate(
                    "() => import('./tests/extended-circuit-contracts.js').then(m => m.runExtendedCircuitContracts())"
                )
                check("extended-circuit-contracts", extended["failed"] == 0,
                      f"{extended['passed']} passed")
                scene_lifecycle = page.evaluate(
                    "() => import('./tests/scene3d-contracts.js').then(m => m.runScene3DContracts())"
                )
                check("scene-3d-lifecycle-contracts", scene_lifecycle["failed"] == 0,
                      f"{scene_lifecycle['passed']} passed")

                # New bounded browser contracts. Imports and firmware fetches
                # resolve from document.baseURI so the same checks remain valid
                # when the app is hosted below a deployment subpath.
                firmware_integrity = run_page_contract(
                    page,
                    "./tests/firmware-integrity-contracts.js",
                    "runFirmwareIntegrityContracts",
                )
                check("firmware-integrity-contracts",
                      firmware_integrity["total"] > 0
                      and firmware_integrity["passed"] == firmware_integrity["total"],
                      f"{firmware_integrity['passed']}/{firmware_integrity['total']} passed")
                avr_runtime = run_page_contract(
                    page,
                    "./tests/avr-runtime-contracts.js",
                    "runAvrRuntimeContracts",
                )
                check("avr-runtime-contracts",
                      avr_runtime["passed"] == len(avr_runtime["checks"])
                      and avr_runtime["passed"] > 0
                      and avr_runtime["engine"].startswith("avr8js@"),
                      f"{avr_runtime['passed']} passed · {avr_runtime['engine']}")
                avr_firmware = page.evaluate("""async () => {
                    const moduleUrl = new URL('./tests/avr-runtime-contracts.js', document.baseURI).href;
                    const firmwareBase = new URL('./assets/firmware/', document.baseURI)
                        .href.replace(/\/$/, '');
                    const contract = await import(moduleUrl);
                    return await contract.runBundledFirmwareContract(firmwareBase);
                }""")
                check("avr-bundled-firmware-contract",
                      avr_firmware["passed"] == 2
                      and avr_firmware["file"] == "lesson_01.hex"
                      and len(avr_firmware["sha256"]) == 64
                      and avr_firmware["cycles"] >= 100000
                      and avr_firmware["ddrb"] & 0x20 != 0
                      and avr_firmware["portb"] & 0x20 != 0,
                      json.dumps(avr_firmware, ensure_ascii=False))
                electrical = run_page_contract(
                    page,
                    "./tests/electrical-solver-contracts.js",
                    "runElectricalSolverContracts",
                )
                check("electrical-solver-contracts",
                      electrical["failed"] == 0
                      and electrical["total"] > 0
                      and electrical["passed"] == electrical["total"],
                      f"{electrical['passed']}/{electrical['total']} passed")
                scene_wiring = run_page_contract(
                    page,
                    "./tests/scene-wiring-contracts.js",
                    "runSceneWiringContracts",
                )
                check("scene-wiring-contracts",
                      scene_wiring["failed"] == 0
                      and scene_wiring["total"] > 0
                      and scene_wiring["passed"] == scene_wiring["total"],
                      f"{scene_wiring['passed']}/{scene_wiring['total']} passed")

                # The optional AVR panel publishes stable DOM IDs in
                # src/avr-panel.js. Exercise real UI actions, including verified
                # firmware load, genuine CPU cycles, and a clean runner reset.
                check("avr-panel-controls-present",
                      all(page.locator(selector).count() == 1 for selector in (
                          "#avrLoad", "#avrStep", "#avrCycle", "#avrReset", "#avrStatus",
                          "#avrMetrics", "#avrProvenance", "#avrDraftNote",
                      )))
                check("avr-panel-initial-bounds",
                      page.locator("#avrStep").is_disabled()
                      and page.locator("#avrCycle").is_disabled()
                      and page.locator("#avrReset").is_disabled()
                      and "Chưa nạp" in page.locator("#avrStatus").inner_text())
                page.locator("#avrLoad").click()
                page.wait_for_function(
                    "document.querySelector('#avrStatus')?.dataset.kind === 'success'",
                    timeout=20000,
                )
                check("avr-panel-load-verified",
                      "Đã xác minh SHA-256" in page.locator("#avrStatus").inner_text()
                      and not page.locator("#avrStep").is_disabled()
                      and not page.locator("#avrCycle").is_disabled()
                      and not page.locator("#avrReset").is_disabled()
                      and not page.locator("#avrMetrics").is_hidden())
                check("avr-panel-provenance-visible",
                      "SHA-256 HEX" in page.locator("#avrProvenance").inner_text()
                      and "Arduino CLI" in page.locator("#avrProvenance").inner_text())
                pc_before_step = page.locator("#avrMetrics .avr-metric strong").nth(0).inner_text()
                cycles_before_step = page.locator("#avrMetrics .avr-metric strong").nth(1).inner_text()
                page.locator("#avrStep").click()
                pc_after_step = page.locator("#avrMetrics .avr-metric strong").nth(0).inner_text()
                cycles_after_step = page.locator("#avrMetrics .avr-metric strong").nth(1).inner_text()
                check("avr-panel-single-opcode-advances",
                      "Đã thực thi 1 lệnh AVR" in page.locator("#avrStatus").inner_text()
                      and pc_after_step != pc_before_step
                      and cycles_after_step != cycles_before_step
                      and not page.locator("#avrStep").is_disabled(),
                      f"PC {pc_before_step}->{pc_after_step}; cycles {cycles_before_step}->{cycles_after_step}")
                page.locator("#avrCycle").click()
                check("avr-panel-cycle-executes",
                      "Đã thực thi" in page.locator("#avrStatus").inner_text()
                      and "chu kỳ" in page.locator("#avrStatus").inner_text())
                page.locator("#avrReset").click()
                page.wait_for_function(
                    "document.querySelector('#avrStatus')?.textContent.includes('khởi tạo CPU/flash/SRAM')",
                    timeout=10000,
                )
                check("avr-panel-reset-clean-runner",
                      "Đã khởi tạo CPU/flash/SRAM" in page.locator("#avrStatus").inner_text()
                      and not page.locator("#avrStep").is_disabled()
                      and not page.locator("#avrCycle").is_disabled())
                page.locator('.lesson-link[data-lesson="2"]').click()
                check("avr-panel-step-resets-on-lesson-switch",
                      page.locator("#avrStep").is_disabled()
                      and page.locator("#avrCycle").is_disabled()
                      and page.locator("#avrReset").is_disabled()
                      and page.locator("#avrMetrics").is_hidden()
                      and "Chưa nạp HEX bài 02" in page.locator("#avrStatus").inner_text())

                # Every lesson must update title and quiz without dropping canvas.
                for lesson_id in range(1, 17):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    check(f"lesson-{lesson_id:02d}-render",
                          page.locator("#sceneMount canvas").count() == 1
                          and page.locator("#quizChoices input").count() >= 3
                          and len(page.locator("#codeViewer").inner_text()) > 30)

                # Electrical UI is intentionally limited to lessons 02/03/05.
                expected_currents = {
                    2: [13.636],
                    3: [13.636],
                    5: [13.636, 12.727, 9.091],
                }
                for lesson_id, expected in expected_currents.items():
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    values = page.locator("#electricalResult .electrical-value").all_inner_texts()
                    parsed = [float(value.removesuffix(" mA").replace(",", ".")) for value in values]
                    check(f"electrical-{lesson_id:02d}-ui",
                          not page.locator("#electricalSection").is_hidden()
                          and len(parsed) == len(expected)
                          and all(abs(actual - target) <= 0.001
                                  for actual, target in zip(parsed, expected))
                          and "Mạch mẫu tham khảo" in page.locator("#electricalResult").inner_text()
                          and "không phải số đo thực tế" in page.locator("#electricalResult").inner_text(),
                          str(values))
                page.locator('.lesson-link[data-lesson="4"]').click()
                check("electrical-unsupported-hidden",
                      page.locator("#electricalSection").is_hidden()
                      and page.locator("#electricalResult").inner_text() == "")

                # Review, edit and export real .ino bytes. No code executed.
                page.locator('.lesson-link[data-lesson="3"]').click()
                check("avr-panel-follows-lesson",
                      "bài 03" in page.locator("#avrLoad").inner_text()
                      and "Chưa nạp HEX bài 03" in page.locator("#avrStatus").inner_text())
                page.locator("#editCode").click()
                page.locator("#codeEditor").fill("void setup() {}\nvoid loop() {}\n")
                check("edit-is-explicitly-draft",
                      "Mã đã sửa" in page.locator("#codeEditStatus").inner_text())
                check("avr-panel-draft-disclosure",
                      "Mã đã sửa" in page.locator("#avrDraftNote").inner_text()
                      and "chưa được biên dịch" in page.locator("#avrDraftNote").inner_text())
                with page.expect_download() as download_info:
                    page.locator("#downloadCode").click()
                download = download_info.value
                check("ino-download-filename", download.suggested_filename == "bai_03.ino")
                check("ino-download-bytes",
                      "void loop()" in Path(download.path()).read_text(encoding="utf-8"))
                page.locator("#restoreCode").click()
                check("ino-restore", "pinMode(BUTTON, INPUT)" in
                      page.locator("#codeViewer").inner_text())
                check("avr-panel-restored-sample-disclosure",
                      "Mã đã sửa" not in page.locator("#avrDraftNote").inner_text()
                      and "mã mẫu" in page.locator("#avrDraftNote").inner_text())

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
                check("electrical-incomplete-draft-blocked",
                      "Bản đấu dây đang chỉnh sửa" in page.locator("#electricalResult").inner_text()
                      and "Chưa thể tính dòng" in page.locator("#electricalResult").inner_text())
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
                canvas = page.locator("#sceneMount canvas")
                check("scene-wiring-ui-conceptual-sync",
                      canvas.get_attribute("data-wiring-mode") == "conceptual-netlist"
                      and canvas.get_attribute("data-wiring-status") == "checked"
                      and canvas.get_attribute("data-wiring-wire-count") == "7"
                      and canvas.get_attribute("data-wiring-physical-map") == "none")
                check("electrical-repaired-draft-calculates",
                      "Bản đấu dây đang chỉnh sửa" in page.locator("#electricalResult").inner_text()
                      and page.locator("#electricalResult .electrical-value").count() == 1)
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

                # All supported lesson circuits are usable in the actual UI:
                # pure engine tests are insufficient when data/sample routing
                # or hidden panel lifecycle can regress.
                wiring_ids = page.evaluate(
                    "() => import('./src/circuit-router.js').then(m => m.supportedWiringLessons())"
                )
                check("wiring-coverage", len(wiring_ids) == 15
                      and 1 not in wiring_ids and len(set(wiring_ids)) == 15,
                      str(wiring_ids))
                for lesson_id in wiring_ids:
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    page.locator('.stage-tabs [data-stage="wiring"]').click()
                    check(f"wiring-{lesson_id:02d}-terminal-ui",
                          page.locator("[data-terminal]").count() >= 4)
                    page.locator(".wire-actions .wire-action").first.click()
                    check(f"wiring-{lesson_id:02d}-valid-sample",
                          not page.locator(".wire-activate").is_disabled()
                          and page.locator(".wire-connected").count() >= 2)
                    page.locator(".wire-activate").click()
                    page.locator("#runButton").click()
                    check(f"wiring-{lesson_id:02d}-active-run",
                          "Đang chạy" in page.locator("#runStatus").inner_text())
                    page.locator("#runButton").click()
                    page.locator('.stage-tabs [data-stage="3d"]').click()
                page.locator('.lesson-link[data-lesson="1"]').click()
                page.locator('.stage-tabs [data-stage="wiring"]').click()
                check("onboard-led-no-external-wiring",
                      page.locator("[data-terminal]").count() == 0
                      and "không cần nối mạch ngoài" in page.locator(".wiring-unsupported").inner_text())
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
                    capture_console(small)
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
                capture_console(app)
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

                # Version-mixing guard: exercise the real app controllerchange
                # listener inside an actually SW-controlled dist page without
                # installing a second worker. Temporarily shadow only the
                # controller identity for the synchronous event, then restore
                # the native getter immediately. This keeps the test isolated
                # while proving an active AVR runner is invalidated and an
                # edited Sketch is preserved for explicit user-controlled reload.
                app.locator("#editCode").click()
                update_draft = "void setup() {}\nvoid loop() { /* update-safe draft */ }\n"
                app.locator("#codeEditor").fill(update_draft)
                check("sw-update-draft-precondition",
                      "Mã đã sửa" in app.locator("#codeEditStatus").inner_text()
                      and app.locator("#codeEditor").input_value() == update_draft)
                app.locator("#avrLoad").click()
                app.wait_for_function(
                    "document.querySelector('#avrStatus')?.dataset.kind === 'success'",
                    timeout=20000,
                )
                check("sw-update-avr-runner-precondition",
                      not app.locator("#avrLoad").is_disabled()
                      and not app.locator("#avrStep").is_disabled()
                      and not app.locator("#avrCycle").is_disabled()
                      and not app.locator("#avrReset").is_disabled())
                simulated_upgrade = app.evaluate("""() => {
                    const container = navigator.serviceWorker;
                    const original = container.controller;
                    if (!original) throw new Error('upgrade regression requires a real SW controller');
                    const replacement = { state: 'activated', scriptURL: original.scriptURL };
                    Object.defineProperty(container, 'controller', {
                        configurable: true,
                        get: () => replacement,
                    });
                    try {
                        container.dispatchEvent(new Event('controllerchange'));
                        // A duplicate event must not create duplicate notices.
                        container.dispatchEvent(new Event('controllerchange'));
                    } finally {
                        delete container.controller;
                    }
                    return {
                        controllerRestored: container.controller === original,
                        noticeCount: document.querySelectorAll('.update-notice').length,
                    };
                }""")
                check("sw-update-controllerchange-blocks-avr",
                      simulated_upgrade["controllerRestored"]
                      and simulated_upgrade["noticeCount"] == 1
                      and app.locator(".update-notice").count() == 1
                      and app.locator(".update-notice").get_attribute("role") == "alert"
                      and "Có phiên bản website mới" in app.locator(".update-notice").inner_text()
                      and "Tải lại phiên bản mới" in app.locator(".update-notice .button").inner_text()
                      and app.locator("#avrLoad").is_disabled()
                      and app.locator("#avrStep").is_disabled()
                      and app.locator("#avrCycle").is_disabled()
                      and app.locator("#avrReset").is_disabled()
                      and app.locator("#avrMetrics").is_hidden()
                      and app.locator("#avrStatus").get_attribute("data-kind") == "error"
                      and "tải lại trang" in app.locator("#avrStatus").inner_text().lower(),
                      json.dumps(simulated_upgrade, ensure_ascii=False))
                check("sw-update-preserves-edited-draft",
                      "Mã đã sửa" in app.locator("#codeEditStatus").inner_text()
                      and app.locator("#codeEditor").input_value() == update_draft
                      and app.locator("#codeEditor").is_visible())

                # First-claim regression: a page can start uncontrolled while a
                # newly activated worker later calls clients.claim(). The app
                # must treat that initial null -> controller transition as the
                # same revision boundary as a later controller replacement.
                # Keep this inside the existing offline context and close the
                # extra page immediately after the bounded regression.
                first_claim = offline.new_page()
                capture_console(first_claim)
                first_claim.add_init_script("""(() => {
                    const container = navigator.serviceWorker;
                    window.__e2eActualSwController = container.controller;
                    window.__e2eSwControllerOverride = null;
                    Object.defineProperty(container, 'controller', {
                        configurable: true,
                        get: () => window.__e2eSwControllerOverride,
                    });
                })();""")
                first_claim.goto(base + "dist/", wait_until="domcontentloaded")
                ready(first_claim)
                check("sw-first-claim-starts-uncontrolled",
                      first_claim.evaluate("navigator.serviceWorker.controller === null")
                      and first_claim.locator(".update-notice").count() == 0
                      and not first_claim.locator("#avrLoad").is_disabled())
                first_claim.locator("#editCode").click()
                first_claim_draft = (
                    "void setup() {}\n"
                    "void loop() { /* preserve across first SW claim */ }\n"
                )
                first_claim.locator("#codeEditor").fill(first_claim_draft)
                check("sw-first-claim-draft-precondition",
                      "Mã đã sửa" in first_claim.locator("#codeEditStatus").inner_text()
                      and first_claim.locator("#codeEditor").input_value() == first_claim_draft)
                first_claim_result = first_claim.evaluate("""() => {
                    const container = navigator.serviceWorker;
                    const replacement = window.__e2eActualSwController || {
                        state: 'activated',
                        scriptURL: new URL('./sw.js', document.baseURI).href,
                    };
                    if (!replacement) throw new Error('first-claim regression requires a non-null replacement');
                    window.__e2eSwControllerOverride = replacement;
                    try {
                        container.dispatchEvent(new Event('controllerchange'));
                    } finally {
                        delete container.controller;
                        delete window.__e2eSwControllerOverride;
                    }
                    return {
                        replacementWasReal: replacement === window.__e2eActualSwController,
                        controllerRestored: container.controller === window.__e2eActualSwController,
                        noticeCount: document.querySelectorAll('.update-notice').length,
                    };
                }""")
                check("sw-first-claim-blocks-avr",
                      first_claim_result["noticeCount"] == 1
                      and first_claim.locator(".update-notice").count() == 1
                      and first_claim.locator(".update-notice").get_attribute("role") == "alert"
                      and "Có phiên bản website mới" in first_claim.locator(".update-notice").inner_text()
                      and first_claim.locator("#avrLoad").is_disabled()
                      and first_claim.locator("#avrStep").is_disabled()
                      and first_claim.locator("#avrCycle").is_disabled()
                      and first_claim.locator("#avrReset").is_disabled()
                      and first_claim.locator("#avrMetrics").is_hidden()
                      and first_claim.locator("#avrStatus").get_attribute("data-kind") == "error"
                      and "tải lại trang" in first_claim.locator("#avrStatus").inner_text().lower(),
                      json.dumps(first_claim_result, ensure_ascii=False))
                check("sw-first-claim-preserves-edited-draft",
                      "Mã đã sửa" in first_claim.locator("#codeEditStatus").inner_text()
                      and first_claim.locator("#codeEditor").input_value() == first_claim_draft
                      and first_claim.locator("#codeEditor").is_visible())
                first_claim.close()
                offline.set_offline(True)
                app.reload(wait_until="domcontentloaded", timeout=20000)
                ready(app)
                check("offline-dist-renders", app.locator("#sceneMount canvas").count() == 1)
                offline_firmware = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [manifestResponse, hexResponse] = await Promise.all([
                        fetch(new URL('./assets/firmware/manifest.json', baseUrl)),
                        fetch(new URL('./assets/firmware/lesson_01.hex', baseUrl)),
                    ]);
                    const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
                    const hex = hexResponse.ok ? await hexResponse.text() : '';
                    return {
                        manifestOk: manifestResponse.ok,
                        lessonCount: manifest?.lessons?.length ?? 0,
                        hexOk: hexResponse.ok,
                        hexLooksIntel: hex.startsWith(':'),
                    };
                }""")
                check("offline-firmware-bundle-cached",
                      offline_firmware["manifestOk"]
                      and offline_firmware["lessonCount"] == 16
                      and offline_firmware["hexOk"]
                      and offline_firmware["hexLooksIntel"],
                      json.dumps(offline_firmware, ensure_ascii=False))
                offline.set_offline(False)
                offline.close()

                desktop.close()
                check("no-uncaught-pageerrors", not errors, "; ".join(errors[:4]))
                check("no-console-warnings", not warnings, "; ".join(warnings[:4]))
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
