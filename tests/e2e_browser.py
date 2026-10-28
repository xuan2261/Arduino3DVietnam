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
import re
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCREENSHOTS = ROOT / "screenshots"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


SOFTWARE_WEBGL_FALLBACK_DIAGNOSTIC = re.compile(
    r"^\[GroupMarkerNotSet\(crbug\.com/242999\)!:[0-9A-F]+\]"
    r"Automatic fallback to software WebGL has been deprecated\. "
    r"Please use the --enable-unsafe-swiftshader "
    r"\(about:flags#enable-unsafe-swiftshader\) flag to opt in to lower "
    r"security guarantees for trusted content\.$"
)
WEBGL_READPIXELS_DIAGNOSTIC = re.compile(
    r"^\[\.WebGL-0x[0-9a-fA-F]+\]"
    r"GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): "
    r"GPU stall due to ReadPixels"
    r"(?: \(this message will no longer repeat\))?$"
)


def classify_browser_gpu_diagnostic(
    text: str,
    location_url: str,
    line_number: int | None,
    column_number: int | None,
    args_count: int,
    page_url: str,
) -> str | None:
    """Classify only known Chromium-internal headless WebGL diagnostics.

    Playwright Chromium routes Runtime.consoleAPICalled through the JS console
    path with its arguments, while browser Log.entryAdded messages are exposed
    with an empty args list. Chromium sometimes attributes those internal GPU
    entries to the current document URL at line/column zero, so that exact case
    is accepted in addition to an empty URL. Page console calls remain fatal.
    """
    if args_count != 0:
        return None
    browser_location = not location_url or (
        location_url == page_url
        and line_number == 0
        and column_number == 0
    )
    if not browser_location:
        return None
    if SOFTWARE_WEBGL_FALLBACK_DIAGNOSTIC.fullmatch(text):
        return "chromium-software-webgl-fallback-deprecation"
    if WEBGL_READPIXELS_DIAGNOSTIC.fullmatch(text):
        return "chromium-webgl-readpixels-driver-stall"
    return None


def main() -> None:
    from scripts.serve import Handler

    report: list[dict[str, object]] = []
    errors: list[str] = []
    warnings: list[dict[str, object]] = []
    console_errors: list[dict[str, object]] = []
    browser_gpu_diagnostics: list[dict[str, object]] = []
    gpu_diagnostic_candidates: list[dict[str, object]] = []
    cdp_log_entries: list[dict[str, object]] = []
    cdp_runtime_console_events: list[dict[str, object]] = []
    cdp_sessions: list[object] = []
    cdp_setup_errors: list[str] = []
    page_sequence = 0

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

    def capture_console(page) -> str:
        nonlocal page_sequence
        page_sequence += 1
        page_key = f"page-{page_sequence}"
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        # Positive provenance for browser-internal diagnostics. Playwright's
        # Chromium bridge turns CDP Log.entryAdded into ConsoleMessage(args=[])
        # while JS console APIs arrive through Runtime.consoleAPICalled with
        # their argument handles. Keep both protocol streams as audit evidence.
        try:
            cdp = page.context.new_cdp_session(page)
            cdp_sessions.append(cdp)

            def on_log_entry(event) -> None:
                entry = event.get("entry") or {}
                cdp_log_entries.append({
                    "pageKey": page_key,
                    "level": entry.get("level"),
                    "source": entry.get("source"),
                    "text": entry.get("text"),
                    "url": entry.get("url") or "",
                    "lineNumber": entry.get("lineNumber", 0),
                    "protocolArgsCount": len(entry.get("args") or []),
                })

            def on_runtime_console(event) -> None:
                if event.get("type") != "warning":
                    return
                args = event.get("args") or []
                stack = (event.get("stackTrace") or {}).get("callFrames") or []
                cdp_runtime_console_events.append({
                    "pageKey": page_key,
                    "type": event.get("type"),
                    "argsCount": len(args),
                    "argValues": [arg.get("value") for arg in args if "value" in arg],
                    "url": stack[0].get("url", "") if stack else "",
                    "lineNumber": stack[0].get("lineNumber", 0) if stack else 0,
                    "columnNumber": stack[0].get("columnNumber", 0) if stack else 0,
                })

            cdp.on("Log.entryAdded", on_log_entry)
            cdp.on("Runtime.consoleAPICalled", on_runtime_console)
            cdp.send("Log.enable")
            cdp.send("Runtime.enable")
        except Exception as error:
            cdp_setup_errors.append(f"{page_key}: {error}")

        def on_console(message) -> None:
            if message.type not in {"warning", "error"}:
                return
            location = message.location or {}
            location_url = str(location.get("url") or "")
            line_number = location.get("lineNumber", location.get("line"))
            column_number = location.get("columnNumber", location.get("column"))
            args_count = len(message.args)
            current_page_url = page.url
            entry: dict[str, object] = {
                "pageKey": page_key,
                "text": message.text,
                "argsCount": args_count,
                "pageUrl": current_page_url,
                "location": {
                    "url": location_url,
                    "lineNumber": line_number,
                    "columnNumber": column_number,
                },
            }
            if message.type == "error":
                console_errors.append(entry)
                return
            diagnostic_kind = classify_browser_gpu_diagnostic(
                message.text,
                location_url,
                line_number,
                column_number,
                args_count,
                current_page_url,
            )
            if diagnostic_kind:
                entry["candidateKind"] = diagnostic_kind
                gpu_diagnostic_candidates.append(entry)
            else:
                warnings.append(entry)
        page.on("console", on_console)
        return page_key

    def reconcile_browser_gpu_diagnostics() -> None:
        allowed_sources = {"rendering", "deprecation"}
        for candidate in gpu_diagnostic_candidates:
            location = candidate["location"]
            log_matches = [entry for entry in cdp_log_entries if
                           entry["pageKey"] == candidate["pageKey"]
                           and entry["level"] == "warning"
                           and entry["text"] == candidate["text"]
                           and entry["url"] == location["url"]
                           and entry["lineNumber"] == location["lineNumber"]]
            browser_matches = [entry for entry in log_matches
                               if entry["source"] in allowed_sources]
            runtime_matches = [entry for entry in cdp_runtime_console_events if
                               entry["pageKey"] == candidate["pageKey"]
                               and candidate["text"] in entry["argValues"]]
            candidate["cdpLogMatches"] = log_matches
            candidate["runtimeConsoleMatches"] = runtime_matches
            if browser_matches:
                candidate["kind"] = candidate.pop("candidateKind")
                candidate["cdpSource"] = browser_matches[0]["source"]
                browser_gpu_diagnostics.append(candidate)
            else:
                # Fail closed: exact text/args/location is still not enough if
                # CDP did not positively identify a rendering/deprecation log.
                warnings.append(candidate)

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
        fallback_fixture = (
            "[GroupMarkerNotSet(crbug.com/242999)!:A0501800AC2D0000]"
            "Automatic fallback to software WebGL has been deprecated. "
            "Please use the --enable-unsafe-swiftshader "
            "(about:flags#enable-unsafe-swiftshader) flag to opt in to lower "
            "security guarantees for trusted content."
        )
        readpixels_fixture = (
            "[.WebGL-0x4c0013d400]GL Driver Message "
            "(OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels"
        )
        readpixels_repeat_fixture = (
            readpixels_fixture + " (this message will no longer repeat)"
        )
        page_fixture = base + "#bai-01"
        check("gpu-diagnostic-classifier-bounded",
              classify_browser_gpu_diagnostic(fallback_fixture, "", 0, 0, 0, page_fixture) ==
              "chromium-software-webgl-fallback-deprecation"
              and classify_browser_gpu_diagnostic(readpixels_fixture, "", 0, 0, 0, page_fixture) ==
              "chromium-webgl-readpixels-driver-stall"
              and classify_browser_gpu_diagnostic(
                  fallback_fixture, page_fixture, 0, 0, 0, page_fixture) ==
              "chromium-software-webgl-fallback-deprecation"
              and classify_browser_gpu_diagnostic(
                  readpixels_fixture, page_fixture, 0, 0, 0, page_fixture) ==
              "chromium-webgl-readpixels-driver-stall"
              and classify_browser_gpu_diagnostic(
                  readpixels_repeat_fixture, page_fixture, 0, 0, 0, page_fixture) ==
              "chromium-webgl-readpixels-driver-stall"
              and classify_browser_gpu_diagnostic(
                  fallback_fixture, page_fixture, 0, 0, 1, page_fixture) is None
              and classify_browser_gpu_diagnostic(
                  fallback_fixture, page_fixture, 1, 0, 0, page_fixture) is None
              and classify_browser_gpu_diagnostic(
                  fallback_fixture, base + "src/app.js", 0, 0, 0, page_fixture) is None
              and classify_browser_gpu_diagnostic(
                  readpixels_fixture, base + "src/scene3d.js", 0, 0, 0, page_fixture) is None
              and classify_browser_gpu_diagnostic(
                  "Application warning from lesson UI", "", 0, 0, 0, page_fixture) is None
              and classify_browser_gpu_diagnostic(
                  readpixels_fixture + " (this message will repeat)",
                  page_fixture, 0, 0, 0, page_fixture) is None
              and classify_browser_gpu_diagnostic(
                  readpixels_fixture.replace("ReadPixels", "ReadPixels extra"),
                  "", 0, 0, 0, page_fixture) is None)
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
                main_page_key = capture_console(page)
                page.goto(base, wait_until="domcontentloaded", timeout=15000)
                ready(page)
                synthetic_warning_start = len(warnings)
                with page.expect_console_message(
                    predicate=lambda message: message.type == "warning"
                    and message.text == fallback_fixture,
                    timeout=5000,
                ) as synthetic_warning_info:
                    page.evaluate("text => console.warn(text)", fallback_fixture)
                synthetic_warning = synthetic_warning_info.value
                synthetic_location = synthetic_warning.location or {}
                synthetic_line = synthetic_location.get("lineNumber", synthetic_location.get("line"))
                synthetic_column = synthetic_location.get("columnNumber", synthetic_location.get("column"))
                synthetic_args_count = len(synthetic_warning.args)
                synthetic_page_url = page.url
                synthetic_location_url = str(synthetic_location.get("url") or "")
                synthetic_index = next((
                    index for index in range(synthetic_warning_start, len(warnings))
                    if warnings[index]["text"] == fallback_fixture
                    and warnings[index]["argsCount"] == synthetic_args_count
                ), None)
                runtime_control_matches = [entry for entry in cdp_runtime_console_events if
                                           entry["pageKey"] == main_page_key
                                           and fallback_fixture in entry["argValues"]]
                check("gpu-diagnostic-page-console-warn-rejected",
                      synthetic_args_count >= 1
                      and synthetic_index is not None
                      and runtime_control_matches
                      and classify_browser_gpu_diagnostic(
                          fallback_fixture,
                          synthetic_location_url,
                          synthetic_line,
                          synthetic_column,
                          synthetic_args_count,
                          synthetic_page_url,
                      ) is None,
                      json.dumps({
                          "argsCount": synthetic_args_count,
                          "pageUrl": synthetic_page_url,
                          "location": synthetic_location,
                          "capturedAsUnexpected": synthetic_index is not None,
                          "runtimeConsoleMatches": runtime_control_matches,
                      }, ensure_ascii=False))
                # Remove only this deliberately injected JS warning after proving
                # the production warning gate captured it as unexpected. A real
                # Chromium GPU diagnostic has argsCount==0 and cannot match here.
                if synthetic_index is not None:
                    del warnings[synthetic_index]

                repeat_warning_start = len(warnings)
                with page.expect_console_message(
                    predicate=lambda message: message.type == "warning"
                    and message.text == readpixels_repeat_fixture,
                    timeout=5000,
                ) as repeat_warning_info:
                    page.evaluate("text => console.warn(text)", readpixels_repeat_fixture)
                repeat_warning = repeat_warning_info.value
                repeat_location = repeat_warning.location or {}
                repeat_line = repeat_location.get("lineNumber", repeat_location.get("line"))
                repeat_column = repeat_location.get("columnNumber", repeat_location.get("column"))
                repeat_args_count = len(repeat_warning.args)
                repeat_page_url = page.url
                repeat_location_url = str(repeat_location.get("url") or "")
                repeat_index = next((
                    index for index in range(repeat_warning_start, len(warnings))
                    if warnings[index]["text"] == readpixels_repeat_fixture
                    and warnings[index]["argsCount"] == repeat_args_count
                ), None)
                repeat_runtime_matches = [entry for entry in cdp_runtime_console_events if
                                          entry["pageKey"] == main_page_key
                                          and readpixels_repeat_fixture in entry["argValues"]]
                check("gpu-diagnostic-repeat-suffix-page-console-warn-rejected",
                      repeat_args_count >= 1
                      and repeat_index is not None
                      and repeat_runtime_matches
                      and classify_browser_gpu_diagnostic(
                          readpixels_repeat_fixture,
                          repeat_location_url,
                          repeat_line,
                          repeat_column,
                          repeat_args_count,
                          repeat_page_url,
                      ) is None,
                      json.dumps({
                          "argsCount": repeat_args_count,
                          "pageUrl": repeat_page_url,
                          "location": repeat_location,
                          "capturedAsUnexpected": repeat_index is not None,
                          "runtimeConsoleMatches": repeat_runtime_matches,
                      }, ensure_ascii=False))
                # Remove only the deliberate JS control after proving it hit
                # the fatal-warning path. Real GPU diagnostics have argsCount=0
                # plus positive CDP Log.entryAdded provenance and cannot match.
                if repeat_index is not None:
                    del warnings[repeat_index]
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
                reconcile_browser_gpu_diagnostics()
                check("no-uncaught-pageerrors", not errors, "; ".join(errors[:4]))
                check("cdp-console-provenance-ready", not cdp_setup_errors,
                      json.dumps(cdp_setup_errors, ensure_ascii=False))
                check("no-console-errors", not console_errors,
                      json.dumps(console_errors[:4], ensure_ascii=False))
                check("no-console-warnings", not warnings,
                      json.dumps(warnings[:4], ensure_ascii=False))
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

    print(json.dumps({
        "total": len(report), "passed": sum(item["passed"] for item in report),
        "failed": sum(not item["passed"] for item in report),
        "browser_gpu_diagnostics": {
            "count": len(browser_gpu_diagnostics),
            "messages": browser_gpu_diagnostics,
        },
        "unexpected_console_warnings": {
            "count": len(warnings),
            "messages": warnings,
        },
        "console_errors": {
            "count": len(console_errors),
            "messages": console_errors,
        },
        "checks": report,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
