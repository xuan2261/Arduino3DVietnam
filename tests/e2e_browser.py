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

    def lab_scene_point(page, lesson_id: int, *, component_id: str | None = None,
                        terminal_id: str | None = None):
        """Project a canonical conceptual-layout point into the current canvas.

        The production scene remains the source of pointer hit behavior; this
        helper only computes a deterministic screen coordinate from the public
        lab-layout/circuit data after camera reset, so Playwright can issue a
        real pointer click/drag without reaching into private Three.js objects.
        """
        if bool(component_id) == bool(terminal_id):
            raise ValueError("provide exactly one of component_id or terminal_id")
        return page.evaluate(
            """async ({lessonId, componentId, terminalId}) => {
                const [T, layoutModule, router] = await Promise.all([
                    import('./assets/vendor/three.module.min.js'),
                    import('./src/lab-layout.js'),
                    import('./src/circuit-router.js'),
                ]);
                const canvas = document.querySelector('#sceneMount canvas');
                if (!canvas) throw new Error('lab scene canvas missing');
                const layout = layoutModule.createLabLayout(lessonId, router.listTerminals(lessonId));
                const componentHeight = kind => {
                    if (kind === 'arduino-uno') return .46;
                    if (kind === 'breadboard') return .34;
                    if (kind === 'ultrasonic-sensor') return .68;
                    if (kind === 'servo' || kind === 'driver') return .62;
                    if (kind === 'power-source') return .55;
                    return .48;
                };
                let point, targetId;
                if (componentId) {
                    const component = layout.components.find(item => item.id === componentId);
                    if (!component) throw new Error('component not found: ' + componentId);
                    point = new T.Vector3(
                        component.x * .72,
                        Math.max(.2, componentHeight(component.visualKind) / 2),
                        component.z * .72,
                    );
                    targetId = component.id;
                } else {
                    const anchor = layoutModule.labTerminalAnchor(layout, terminalId);
                    const component = layout.components.find(item => item.id === anchor.componentId);
                    if (!component) throw new Error('terminal component missing: ' + terminalId);
                    point = new T.Vector3(
                        anchor.x * .72,
                        componentHeight(component.visualKind) + .10,
                        anchor.z * .72,
                    );
                    targetId = terminalId;
                }
                const rect = canvas.getBoundingClientRect();
                const fov = 38;
                const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
                const theta = .48, phi = .94, zoom = 1;
                const fitted = Math.max(16.7, 18.5 /
                    (2 * Math.tan(T.MathUtils.degToRad(fov / 2)) * Math.max(.45, aspect)));
                const radius = Math.min(48, Math.max(8, fitted * zoom));
                const camera = new T.PerspectiveCamera(fov, aspect, .1, 100);
                camera.position.set(
                    radius * Math.sin(phi) * Math.sin(theta),
                    radius * Math.cos(phi) + 5,
                    radius * Math.sin(phi) * Math.cos(theta),
                );
                const targetX = ((layout.bounds.minX + layout.bounds.maxX) / 2) * .72;
                const targetZ = ((layout.bounds.minZ + layout.bounds.maxZ) / 2) * .72;
                camera.lookAt(targetX, .35, targetZ);
                camera.updateProjectionMatrix();
                camera.updateMatrixWorld(true);
                const projected = point.project(camera);
                return {
                    id: targetId,
                    x: rect.left + (projected.x + 1) * rect.width / 2,
                    y: rect.top + (1 - projected.y) * rect.height / 2,
                    inViewport: projected.z >= -1 && projected.z <= 1,
                    layoutComponents: layout.components.length,
                    layoutTerminals: layout.terminals.length,
                };
            }""",
            {"lessonId": lesson_id, "componentId": component_id, "terminalId": terminal_id},
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
                check("v16-version-badge-release-candidate",
                      "PHÒNG THỰC HÀNH 1.6" in
                      page.locator(".version-pill").inner_text())
                check("desktop-no-overflow",
                      page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

                # The 3D module is a progressive enhancement. Prove the real
                # app-level error boundary keeps lessons, quiz and the canonical
                # wiring workbench usable when the scene module cannot load.
                # Abort only this module in an isolated context; no production
                # code is patched and the main positive-path page stays intact.
                fallback_context = browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    service_workers="block",
                )
                try:
                    fallback_page = fallback_context.new_page()
                    fallback_page_errors: list[str] = []
                    fallback_page.on("pageerror", lambda exc: fallback_page_errors.append(str(exc)))
                    fallback_page.route("**/src/scene3d.js", lambda route: route.abort("failed"))
                    fallback_page.goto(base + "#bai-02", wait_until="domcontentloaded", timeout=15000)
                    fallback_page.wait_for_function(
                        "document.documentElement.dataset.ready === 'fallback'",
                        timeout=15000,
                    )
                    fallback_text = fallback_page.locator("#sceneMount .scene-fallback").inner_text()
                    check("scene-module-failure-explicit-error-boundary",
                          fallback_page.locator("#sceneMount canvas").count() == 0
                          and fallback_page.locator("#sceneMount .scene-fallback").count() == 1
                          and "Không thể tải mô hình 3D" in fallback_text
                          and "Bạn vẫn có thể sử dụng sơ đồ kết nối, bài học, điều khiển và bài kiểm tra" in fallback_text
                          and fallback_page.locator(".lesson-link").count() == 16
                          and fallback_page.locator("#quizChoices input").count() >= 3
                          and not fallback_page_errors,
                          json.dumps({
                              "fallback": fallback_text[:500],
                              "pageErrors": fallback_page_errors,
                          }, ensure_ascii=False))
                    fallback_page.locator("#stageTabWiring").click()
                    check("scene-module-failure-keeps-wiring-workbench-usable",
                          fallback_page.locator("#stageTabWiring").get_attribute("aria-selected") == "true"
                          and fallback_page.locator("#viewport .wiring-view.is-interactive").count() == 1
                          and fallback_page.locator("#sceneMount").is_hidden())
                    fallback_page.locator('.lesson-link[data-lesson="3"]').click()
                    check("scene-module-failure-keeps-lesson-navigation-usable",
                          fallback_page.locator(
                              '.lesson-link[data-lesson="3"]'
                          ).get_attribute("aria-current") == "page"
                          and fallback_page.locator("#quizChoices input").count() >= 3
                          and fallback_page.locator("#codeViewer").inner_text().strip() != "")
                finally:
                    fallback_context.close()

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
                scene_lifecycle_names = {
                    item.get("name") for item in scene_lifecycle.get("results", [])
                }
                check("scene-3d-lifecycle-contracts",
                      scene_lifecycle["failed"] == 0
                      and "touch-11px-jitter-still-selects" in scene_lifecycle_names
                      and "touch-14px-drag-does-not-select" in scene_lifecycle_names
                      and "inspection-read-only-label-mode" in scene_lifecycle_names
                      and "inspection-read-only-label-does-not-mount-or-move-scene" in
                          scene_lifecycle_names
                      and "inspection-read-only-dataset" in scene_lifecycle_names
                      and "pending-wire-source-requires-mounted-edit-layout" in scene_lifecycle_names
                      and "pending-wire-source-is-visual-only" in scene_lifecycle_names
                      and "pending-wire-ghost-is-uncommitted-canonical-hover-only" in
                          scene_lifecycle_names
                      and "pending-wire-first-terminal-visual-prompt" in scene_lifecycle_names
                      and "pending-wire-prompt-is-visual-only" in scene_lifecycle_names
                      and "pending-wire-invalid-id-is-transactional" in scene_lifecycle_names
                      and "edit-exit-clears-pending-wire-preview" in scene_lifecycle_names
                      and "layout-stage-clear-resets-pending-wire-preview" in
                          scene_lifecycle_names
                      and "context-reset-clears-pending-wire-preview" in scene_lifecycle_names,
                      f"{scene_lifecycle['passed']} passed")
                scene_lab = run_page_contract(
                    page, "./tests/scene3d-lab-contracts.js", "runScene3DLabContracts")
                scene_lab_names = {
                    item.get("name") for item in scene_lab.get("results", [])
                }
                check("scene-3d-lab-edit-contracts",
                      scene_lab["failed"] == 0
                      and scene_lab["passed"] == scene_lab["total"]
                      and scene_lab["total"] >= 34
                      and "touch-terminal-jitter-4px-still-taps" in scene_lab_names
                      and "lab-wiring-keeps-conceptual-contract" in scene_lab_names
                      and "layout-dataset-claims" in scene_lab_names,
                      f"{scene_lab['passed']}/{scene_lab['total']} passed")
                scene_v16 = run_page_contract(
                    page, "./tests/scene3d-v16-contracts.js", "runScene3DV16Contracts")
                check("v16-scene-focus-view-recovery-contracts",
                      scene_v16["failed"] == 0
                      and scene_v16["passed"] == scene_v16["total"]
                      and scene_v16["total"] == 39,
                      f"{scene_v16['passed']}/{scene_v16['total']} passed; v1.6 focus/view/LOD/WebGL recovery")
                fidelity = run_page_contract(
                    page, "./tests/scene3d-visual-fidelity-contracts.js",
                    "runScene3DVisualFidelityContracts")
                fidelity_names = {item.get("name") for item in fidelity.get("results", [])}
                check("vnext-threejs-visual-fidelity-instancing-hover-physical-boundary",
                      fidelity["failed"] == 0
                      and fidelity["passed"] == fidelity["total"] == 18
                      and "source-uses-instancing-for-repeated-visual-detail" in fidelity_names
                      and "source-contact-strips-remain-nonauthoritative" in fidelity_names
                      and "compact-viewport-reduces-lod-without-changing-detail-inventory" in fidelity_names
                      and "pending-selection-has-priority-label-feedback" in fidelity_names
                      and "read-only-inspection-does-not-recreate-3d-terminal-geometry" in fidelity_names,
                      f"{fidelity['passed']}/{fidelity['total']} conceptual visual fidelity checks")

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
                avr_a0_panel = run_page_contract(
                    page, "./tests/avr-panel-validation-contracts.js",
                    "runAvrPanelValidationContracts",
                )
                check("v15-avr-a0-default-vref-validation-contract",
                      avr_a0_panel["passed"] == len(avr_a0_panel["checks"])
                      and avr_a0_panel["passed"] >= 3,
                      f"{avr_a0_panel['passed']} passed")
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

                # Peripheral adapters are not complete Arduino Uno models.
                # Exercise each bounded CPU-hook implementation and one real
                # SHA-verified compiled HEX via their browser contracts.
                gpio_contracts = run_page_contract(
                    page, "./tests/avr-gpio-contracts.js", "runAvrGpioContracts")
                check("avr-gpio-real-register-contracts",
                      gpio_contracts["failed"] == 0 and gpio_contracts["passed"] >= 20,
                      f"{gpio_contracts['passed']}/{gpio_contracts['total']} passed")
                timer_contracts = run_page_contract(
                    page, "./tests/avr-timer0-contracts.js", "runAvrTimer0Contracts")
                check("avr-timer0-overflow-clock-contracts",
                      timer_contracts["passed"] == len(timer_contracts["checks"])
                      and timer_contracts["passed"] >= 8,
                      f"{timer_contracts['passed']} passed")
                analog_contracts = run_page_contract(
                    page, "./tests/avr-analog-serial-contracts.js", "runAvrAnalogSerialContracts")
                check("avr-adc-and-usart-tx-contracts",
                      analog_contracts["passed"] == len(analog_contracts["checks"])
                      and analog_contracts["passed"] >= 18,
                      f"{analog_contracts['passed']} passed")
                board_contracts = run_page_contract(
                    page, "./tests/avr-board-contracts.js", "runAvrBoardContracts")
                check("avr-opt-in-board-real-hex-contracts",
                      board_contracts["total"] == board_contracts["passed"]
                      and board_contracts["passed"] >= 9,
                      f"{board_contracts['passed']}/{board_contracts['total']} passed")
                lab_layout_contracts = run_page_contract(
                    page, "./tests/lab-layout-contracts.js", "runLabLayoutContracts")
                check("lab-layout-conceptual-contracts",
                      lab_layout_contracts["failed"] == 0
                      and lab_layout_contracts["passed"] == lab_layout_contracts["total"]
                      and lab_layout_contracts["total"] >= 27,
                      f"{lab_layout_contracts['passed']}/{lab_layout_contracts['total']} passed")
                explorer_contracts = run_page_contract(
                    page, "./tests/lab-explorer-contracts.js", "runLabExplorerContracts")
                check("v16-lab-explorer-model-dom-contracts",
                      explorer_contracts["failed"] == 0
                      and explorer_contracts["passed"] == explorer_contracts["total"]
                      and explorer_contracts["total"] >= 25,
                      f"{explorer_contracts['passed']}/{explorer_contracts['total']} passed")
                breadboard_contracts = run_page_contract(
                    page, "./tests/breadboard-topology-contracts.js",
                    "runBreadboardTopologyContracts")
                check("v16-breadboard-topology-direct-contracts",
                      breadboard_contracts["passed"] == breadboard_contracts["total"]
                      and breadboard_contracts["passed"] == len(breadboard_contracts["checks"])
                      and breadboard_contracts["total"] == 56,
                      f"{breadboard_contracts['passed']}/{breadboard_contracts['total']} passed")
                placement_contracts = run_page_contract(
                    page, "./tests/breadboard-placement-contracts.js",
                    "runBreadboardPlacementContracts")
                check("post-v16-breadboard-placement-direct-contracts",
                      placement_contracts["passed"] == placement_contracts["total"]
                      and placement_contracts["passed"] == len(placement_contracts["checks"])
                      and placement_contracts["total"] == 30,
                      f"{placement_contracts['passed']}/{placement_contracts['total']} passed")
                hole_grid_contracts = run_page_contract(
                    page, "./tests/breadboard-hole-grid-contracts.js",
                    "runBreadboardHoleGridContracts")
                hole_grid_contract_names = set(hole_grid_contracts.get("checks", []))
                check("post-v16-breadboard-hole-grid-direct-contracts",
                      hole_grid_contracts["passed"] == hole_grid_contracts["total"]
                      and hole_grid_contracts["passed"] == len(hole_grid_contracts["checks"])
                      and hole_grid_contracts["total"] == 67
                      and "page-size-fixed-at-eight" in hole_grid_contract_names
                      and "generic-rails-stay-disabled" in hole_grid_contract_names
                      and "bb830-exposes-exact-four-signed-rails" in hole_grid_contract_names
                      and "dom-strip-click-only-fills-input" in hole_grid_contract_names
                      and "dom-explicit-assign-remains-only-placement-gate" in
                          hole_grid_contract_names
                      and "negative-dom-forged-rail-name-does-not-change-input" in
                          hole_grid_contract_names
                      and "negative-dom-partial-picker-controls-rejected" in
                          hole_grid_contract_names,
                      f"{hole_grid_contracts['passed']}/{hole_grid_contracts['total']} passed")
                breadboard_profile = page.evaluate("""async () => {
                    const module = await import('./src/breadboard-topology.js');
                    const generic = module.createBreadboardTopology();
                    const bb830 = module.createBreadboardTopology('busboard-bb830-rev7');
                    const genericRail = module.breadboardNode('P1+1', generic);
                    const bb830Rail = module.breadboardNode('P1+1', bb830);
                    const connected = module.diagnoseBreadboardHolePair('A12', 'E12', generic);
                    const separate = module.diagnoseBreadboardHolePair('E12', 'F12', generic);
                    const unknown = module.diagnoseBreadboardHolePair('P1+1', 'P1+2', generic);
                    return {
                        genericProfile: generic.profileId,
                        genericRailModel: generic.claims.powerRails,
                        genericRailKnown: genericRail !== null,
                        genericPlacementVerified: generic.claims.physicalPlacementVerified,
                        genericInjectsRouter: generic.claims.automaticCircuitRouterInjection,
                        stripConnected: module.areBreadboardHolesConnected('A1', 'E1', generic),
                        centerGapIsolated: !module.areBreadboardHolesConnected('A1', 'F1', generic),
                        bb830Profile: bb830.profileId,
                        bb830RailKnown: bb830Rail?.kind === 'power-rail',
                        bb830PlacementVerified: bb830.claims.physicalPlacementVerified,
                        triState: {
                            connected: [connected.status, connected.connected,
                                connected.circuitRouterInspected],
                            separate: [separate.status, separate.connected,
                                separate.circuitRouterInspected],
                            unknown: [unknown.status, unknown.connected,
                                unknown.circuitRouterInspected],
                        },
                    };
                }""")
                check("v16-breadboard-profile-unverified-default",
                      breadboard_profile["genericProfile"] == "generic-63x10-terminal-strips"
                      and breadboard_profile["genericRailModel"] == "unknown-unmodeled"
                      and not breadboard_profile["genericRailKnown"]
                      and not breadboard_profile["genericPlacementVerified"]
                      and not breadboard_profile["genericInjectsRouter"]
                      and breadboard_profile["stripConnected"]
                      and breadboard_profile["centerGapIsolated"],
                      json.dumps(breadboard_profile, ensure_ascii=False))
                check("v16-breadboard-named-profile-still-no-placement-claim",
                      breadboard_profile["bb830Profile"] == "busboard-bb830-rev7"
                      and breadboard_profile["bb830RailKnown"]
                      and not breadboard_profile["bb830PlacementVerified"],
                      json.dumps(breadboard_profile, ensure_ascii=False))
                check("post-v16-breadboard-profile-tristate-never-false-disconnects-unknown",
                      breadboard_profile["triState"]["connected"] == ["connected", True, False]
                      and breadboard_profile["triState"]["separate"] == ["separate", False, False]
                      and breadboard_profile["triState"]["unknown"] == ["unknown", None, False],
                      json.dumps(breadboard_profile["triState"], ensure_ascii=False))
                hole_grid_contract = page.evaluate("""async () => {
                    const grid = await import('./src/breadboard-hole-grid.js');
                    const first = grid.createBreadboardHoleGridPage({
                        profileId: 'generic-63x10-terminal-strips', page: 1,
                    });
                    const last = grid.createBreadboardHoleGridPage({
                        profileId: 'generic-63x10-terminal-strips', page: 8,
                    });
                    const genericRails = grid.listBreadboardRailChoices(
                        'generic-63x10-terminal-strips');
                    const bb830Rails = grid.listBreadboardRailChoices('busboard-bb830-rev7');
                    const stripPick = grid.pickBreadboardGridHole({
                        profileId: 'generic-63x10-terminal-strips', page: 1, holeId: 'a1',
                    });
                    const railPick = grid.pickBreadboardRailHole({
                        profileId: 'busboard-bb830-rev7', railId: 'P1+', index: '50',
                    });
                    let genericRailRejected = false;
                    try {
                        grid.pickBreadboardRailHole({
                            profileId: 'generic-63x10-terminal-strips', railId: 'P1+', index: 1,
                        });
                    } catch { genericRailRejected = true; }
                    const unsafe = ['<img src=x onerror=1>', 'constructor', '__proto__', 'A1\u0000'];
                    const rejected = [];
                    for (const id of unsafe) {
                        let strip = false;
                        let rail = false;
                        try {
                            grid.pickBreadboardGridHole({
                                profileId: 'generic-63x10-terminal-strips', page: 1, holeId: id,
                            });
                        } catch { strip = true; }
                        try {
                            grid.pickBreadboardRailHole({
                                profileId: 'busboard-bb830-rev7', railId: id, index: 1,
                            });
                        } catch { rail = true; }
                        rejected.push({id, strip, rail});
                    }
                    return {
                        pageSize: first.pageSize,
                        pageCount: first.pageCount,
                        firstColumns: first.columns,
                        firstHoles: first.holes.length,
                        lastColumns: last.columns,
                        lastHoles: last.holes.length,
                        genericRailsEnabled: genericRails.enabled,
                        genericRailReason: genericRails.reason,
                        bb830RailCount: bb830Rails.rails.length,
                        bb830All50: bb830Rails.rails.every(item => item.holes === 50),
                        stripPick,
                        railPick,
                        genericRailRejected,
                        rejected,
                    };
                }""")
                check("post-v16-breadboard-hole-grid-eight-column-profile-contract",
                      hole_grid_contract["pageSize"] == 8
                      and hole_grid_contract["pageCount"] == 8
                      and hole_grid_contract["firstColumns"] == list(range(1, 9))
                      and hole_grid_contract["firstHoles"] == 80
                      and hole_grid_contract["lastColumns"] == list(range(57, 64))
                      and hole_grid_contract["lastHoles"] == 70
                      and not hole_grid_contract["genericRailsEnabled"]
                      and hole_grid_contract["genericRailReason"] == "profile-rails-unverified"
                      and hole_grid_contract["bb830RailCount"] == 4
                      and hole_grid_contract["bb830All50"]
                      and hole_grid_contract["stripPick"]["holeId"] == "A1"
                      and hole_grid_contract["stripPick"]["selectionKind"] ==
                          "terminal-strip-input-only"
                      and hole_grid_contract["stripPick"]["claims"]["placementCreated"] is False
                      and hole_grid_contract["railPick"]["holeId"] == "P1+50"
                      and hole_grid_contract["railPick"]["selectionKind"] ==
                          "bb830-rail-input-only"
                      and hole_grid_contract["railPick"]["claims"]["circuitRouterMutated"] is False
                      and hole_grid_contract["genericRailRejected"],
                      json.dumps(hole_grid_contract, ensure_ascii=False))
                check("post-v16-breadboard-hole-grid-unsafe-ids-fail-closed",
                      len(hole_grid_contract["rejected"]) == 4
                      and all(row["strip"] and row["rail"]
                              for row in hole_grid_contract["rejected"]),
                      json.dumps(hole_grid_contract["rejected"], ensure_ascii=False))
                authored_placement = page.evaluate("""async () => {
                    const placement = await import('./src/breadboard-placement.js');
                    const router = await import('./src/circuit-router.js');
                    const terminals = router.listTerminals(2);
                    const before = JSON.stringify(router.createSampleCircuit(2).wires);
                    const model = placement.createBreadboardPlacement({
                        terminals,
                        terminalToHole: {'D13':'A1', 'R1:A':'E1'},
                    });
                    const validation = placement.validateBreadboardPlacement(model, terminals);
                    const pair = placement.diagnosePlacedTerminalPair(model, 'D13', 'R1:A', terminals);
                    const after = JSON.stringify(router.createSampleCircuit(2).wires);
                    const forged = JSON.parse(JSON.stringify(model));
                    forged.claims.sceneCoordinateMapped = true;
                    let duplicateRejected = false;
                    let unverifiedRailRejected = false;
                    let unknownTerminalRejected = false;
                    try {
                        placement.createBreadboardPlacement({
                            terminals,
                            terminalToHole: {'D13':'A1', 'R1:A':'A1'},
                        });
                    } catch { duplicateRejected = true; }
                    try {
                        placement.createBreadboardPlacement({
                            terminals,
                            terminalToHole: {'D13':'P1+1'},
                        });
                    } catch { unverifiedRailRejected = true; }
                    try {
                        placement.createBreadboardPlacement({
                            terminals,
                            terminalToHole: {'NOT_A_TERMINAL':'A1'},
                        });
                    } catch { unknownTerminalRejected = true; }
                    const d13 = placement.describeArduinoUnoR3Pin('D13');
                    return {
                        model: model.model,
                        validator: model.validatedBy,
                        profile: model.profileId,
                        validationOk: validation.ok,
                        mapped: validation.stats.mapped,
                        d13Hole: placement.mapBreadboardPlacementTerminalToHole(model, 'D13', terminals),
                        pairStatus: pair.status,
                        pairConnected: pair.breadboardInternalConnected,
                        routerInferred: pair.circuitRouterConnectionInferred,
                        claims: model.claims,
                        routerUnchanged: before === after,
                        forgedRejected: !placement.validateBreadboardPlacement(forged, terminals).ok,
                        duplicateRejected,
                        unverifiedRailRejected,
                        unknownTerminalRejected,
                        d13Official: d13?.provenance?.sourceType === 'official-manufacturer-pinout',
                    };
                }""")
                check("post-v16-authored-breadboard-placement-proof-gates",
                      authored_placement["model"] == "explicit-authored-breadboard-placement-v2"
                      and authored_placement["validator"] == "breadboard-placement-v2"
                      and authored_placement["profile"] == "generic-63x10-terminal-strips"
                      and authored_placement["validationOk"]
                      and authored_placement["mapped"] == 2
                      and authored_placement["d13Hole"] == "A1"
                      and authored_placement["pairStatus"] == "same-profile-node"
                      and authored_placement["pairConnected"] is True
                      and authored_placement["routerInferred"] is False
                      and authored_placement["claims"]["explicitAuthoredHoleAssociation"] is True
                      and authored_placement["claims"]["sceneCoordinateMapped"] is False
                      and authored_placement["claims"]["circuitRouterMutated"] is False
                      and authored_placement["claims"]["mechanicalFitVerified"] is False
                      and authored_placement["claims"]["physicalCircuitSafetyVerified"] is False
                      and authored_placement["routerUnchanged"]
                      and authored_placement["forgedRejected"]
                      and authored_placement["duplicateRejected"]
                      and authored_placement["unverifiedRailRejected"]
                      and authored_placement["unknownTerminalRejected"]
                      and authored_placement["d13Official"],
                      json.dumps(authored_placement, ensure_ascii=False))
                uno_reference_contracts = run_page_contract(
                    page, "./tests/uno-reference-contracts.js",
                    "runUnoReferenceContracts")
                check("post-v16-uno-reference-direct-contracts",
                      uno_reference_contracts["passed"] == uno_reference_contracts["total"]
                      and uno_reference_contracts["passed"] ==
                          len(uno_reference_contracts["checks"])
                      and uno_reference_contracts["total"] == 15,
                      f"{uno_reference_contracts['passed']}/{uno_reference_contracts['total']} passed")
                uno_header_aliases = page.evaluate("""() => import('./src/uno-reference.js').then(m => {
                    const pick = id => {
                        const pin = m.getUnoPinReference(id);
                        return pin ? {id:pin.id,group:pin.group,label:pin.functionLabel,physical:pin.physicalHoleVerified} : null;
                    };
                    return {
                        aref: pick('AREF'),
                        sda: pick('SDA'),
                        scl: pick('SCL'),
                        independentI2cPins: m.UNO_REFERENCE_CLAIMS.i2cHeaderCreatesIndependentMicrocontrollerPins,
                    };
                })""")
                check("post-v16-uno-official-aref-sda-scl-header-aliases",
                      uno_header_aliases["aref"]["id"] == "AREF"
                      and uno_header_aliases["aref"]["group"] == "power"
                      and "không phải ngõ cấp nguồn" in uno_header_aliases["aref"]["label"]
                      and uno_header_aliases["sda"]["id"] == "SDA"
                      and uno_header_aliases["sda"]["group"] == "i2c"
                      and "A4" in uno_header_aliases["sda"]["label"]
                      and uno_header_aliases["scl"]["id"] == "SCL"
                      and uno_header_aliases["scl"]["group"] == "i2c"
                      and "A5" in uno_header_aliases["scl"]["label"]
                      and uno_header_aliases["aref"]["physical"] is False
                      and uno_header_aliases["sda"]["physical"] is False
                      and uno_header_aliases["scl"]["physical"] is False
                      and uno_header_aliases["independentI2cPins"] is False,
                      json.dumps(uno_header_aliases, ensure_ascii=False))
                learning_contracts = run_page_contract(
                    page, "./tests/learning-coach-contracts.js", "runLearningCoachContracts")
                check("learning-coach-16-lesson-contracts",
                      learning_contracts["passed"] == learning_contracts["total"]
                      and learning_contracts["passed"] == len(learning_contracts["checks"])
                      and learning_contracts["total"] > 0,
                      f"{learning_contracts['passed']}/{learning_contracts['total']} passed")
                checkpoint_contracts = run_page_contract(
                    page, "./tests/practice-checkpoints-contracts.js",
                    "runPracticeCheckpointContracts")
                check("post-v16-authored-checkpoints-16-lesson-contracts",
                      checkpoint_contracts["passed"] == checkpoint_contracts["total"]
                      and checkpoint_contracts["passed"] == len(checkpoint_contracts["checks"])
                      and checkpoint_contracts["total"] == 37,
                      f"{checkpoint_contracts['passed']}/{checkpoint_contracts['total']} passed")
                practice_contracts = run_page_contract(
                    page, "./tests/practice-evidence-contracts.js", "runPracticeEvidenceContracts")
                check("post-v16-practice-evidence-16-lesson-pure-contracts",
                      practice_contracts["passed"] == practice_contracts["total"]
                      and practice_contracts["passed"] == len(practice_contracts["checks"])
                      and practice_contracts["total"] == 55,
                      f"{practice_contracts['passed']}/{practice_contracts['total']} passed")
                practice_ui_contracts = run_page_contract(
                    page, "./tests/practice-evidence-ui-contracts.js",
                    "runPracticeEvidenceUiContracts")
                practice_ui_names = set(practice_ui_contracts.get("checks", []))
                check("post-v16-practice-evidence-dom-aria-contracts",
                      practice_ui_contracts["passed"] == practice_ui_contracts["total"]
                      and practice_ui_contracts["passed"] ==
                          len(practice_ui_contracts["checks"])
                      and practice_ui_contracts["total"] == 26
                      and "missing-terminal-inspector-callback-fires-only-on-explicit-click" in
                          practice_ui_names
                      and "inspector-button-appears-only-for-proven-authored-missing-canonical-pair-across-48-steps" in
                          practice_ui_names
                      and "covered-extra-only-and-forged-guidance-never-expose-missing-inspector-button" in
                          practice_ui_names,
                      f"{practice_ui_contracts['passed']}/{practice_ui_contracts['total']} passed")
                practice_wire_contracts = run_page_contract(
                    page, "./tests/practice-wire-guidance-contracts.js",
                    "runPracticeWireGuidanceContracts")
                practice_wire_names = set(practice_wire_contracts.get("checks", []))
                check("post-v16-practice-wire-guidance-direct-contracts",
                      practice_wire_contracts["passed"] == practice_wire_contracts["total"]
                      and practice_wire_contracts["passed"] == len(practice_wire_contracts["checks"])
                      and practice_wire_contracts["total"] == 15
                      and "all-48-authored-checkpoints-have-bounded-source-truthful-guidance" in
                          practice_wire_names
                      and "foreign-or-forged-circuit-inputs-fail-closed" in practice_wire_names
                      and "exact-terminal-ids-come-from-router-terminal-set" in practice_wire_names,
                      f"{practice_wire_contracts['passed']}/{practice_wire_contracts['total']} passed")
                practice_wire_unsafe = page.evaluate("""async () => {
                    const [guide, router, lessonModule] = await Promise.all([
                        import('./src/practice-wire-guidance.js'),
                        import('./src/circuit-router.js'),
                        import('./src/lessons.js'),
                    ]);
                    const lesson = lessonModule.lessonById(2);
                    const payloads = ['<img src=x onerror=1>', 'constructor', '__proto__', 'D13 '];
                    const rows = [];
                    for (const terminalId of payloads) {
                        const circuit = JSON.parse(JSON.stringify(router.createCircuit(2)));
                        circuit.wires.push({id:'w1',from:terminalId,to:'GND'});
                        circuit.nextWireId = 2;
                        let rejected = false;
                        try {
                            guide.inspectPracticeWireGuidance({lesson,stepIndex:0,circuit});
                        } catch { rejected = true; }
                        rows.push({terminalId,rejected});
                    }
                    return rows;
                }""")
                check("post-v16-practice-wire-guidance-unsafe-terminal-ids-fail-closed",
                      len(practice_wire_unsafe) == 4
                      and all(row["rejected"] for row in practice_wire_unsafe),
                      json.dumps(practice_wire_unsafe, ensure_ascii=False))
                observation_contracts = run_page_contract(
                    page, "./tests/practice-observation-contracts.js",
                    "runPracticeObservationContracts")
                check("post-v16-practice-observation-48-step-pure-contracts",
                      observation_contracts["passed"] == observation_contracts["total"]
                      and observation_contracts["passed"] ==
                          len(observation_contracts["checks"])
                      and observation_contracts["total"] == 14,
                      f"{observation_contracts['passed']}/{observation_contracts['total']} passed")
                observation_ui_contracts = run_page_contract(
                    page, "./tests/practice-observation-ui-contracts.js",
                    "runPracticeObservationUiContracts")
                check("post-v16-practice-observation-dom-aria-contracts",
                      observation_ui_contracts["passed"] == observation_ui_contracts["total"]
                      and observation_ui_contracts["passed"] ==
                          len(observation_ui_contracts["checks"])
                      and observation_ui_contracts["total"] == 12,
                      f"{observation_ui_contracts['passed']}/{observation_ui_contracts['total']} passed")
                sketch_contracts = run_page_contract(
                    page, "./tests/sketch-review-contracts.js",
                    "runSketchReviewContracts")
                check("post-v16-sketch-review-direct-contracts",
                      sketch_contracts["passed"] == sketch_contracts["total"]
                      and sketch_contracts["passed"] == len(sketch_contracts["checks"])
                      and sketch_contracts["total"] == 19,
                      f"{sketch_contracts['passed']}/{sketch_contracts['total']} passed")
                sketch_ui_contracts = run_page_contract(
                    page, "./tests/sketch-review-ui-contracts.js",
                    "runSketchReviewUiContracts")
                check("post-v16-sketch-review-ui-direct-contracts",
                      sketch_ui_contracts["passed"] == sketch_ui_contracts["total"]
                      and sketch_ui_contracts["passed"] == len(sketch_ui_contracts["checks"])
                      and sketch_ui_contracts["total"] == 14,
                      f"{sketch_ui_contracts['passed']}/{sketch_ui_contracts['total']} passed")
                sketch_review = page.evaluate("""async () => {
                    const {lessons} = await import('./src/lessons.js');
                    const model = await import('./src/sketch-review.js');
                    const ui = await import('./src/sketch-review-ui.js');
                    const falseClaims = [
                        'compiled','semanticValidated','firmwareExecuted',
                        'simulationBehaviorValidated','hardwareValidated',
                        'learnerCompletion','learnerMastery',
                    ];
                    const lessonsChecked = lessons.map(lesson => {
                        const result = model.inspectSketchDraft({
                            lessonId: lesson.id,
                            reference: lesson.sketch,
                            draft: lesson.sketch,
                        });
                        return {
                            lessonId: lesson.id,
                            status: result.status,
                            provenance: result.provenance,
                            claimsFalse: falseClaims.every(key => result.claims?.[key] === false),
                            frozen: Object.isFrozen(result) && Object.isFrozen(result.claims),
                        };
                    });
                    const lesson = lessons.find(item => item.id === 3);
                    const changed = model.inspectSketchDraft({
                        lessonId: lesson.id,
                        reference: lesson.sketch,
                        draft: lesson.sketch + '\\n// learner local draft change\\n',
                    });
                    const section = ui.renderSketchReview(document, changed);
                    let invalidLessonRejected = false;
                    let unknownFieldRejected = false;
                    let bidiRejected = false;
                    let forgedPositiveClaimRejected = false;
                    try {
                        model.inspectSketchDraft({lessonId:17, reference:lesson.sketch, draft:lesson.sketch});
                    } catch { invalidLessonRejected = true; }
                    try {
                        model.inspectSketchDraft({
                            lessonId:lesson.id, reference:lesson.sketch, draft:lesson.sketch,
                            completion:true,
                        });
                    } catch { unknownFieldRejected = true; }
                    try {
                        model.inspectSketchDraft({
                            lessonId:lesson.id,
                            reference:lesson.sketch,
                            draft:lesson.sketch + '\\n// \\u202e hidden bidi',
                        });
                    } catch { bidiRejected = true; }
                    try {
                        const forged = JSON.parse(JSON.stringify(changed));
                        forged.claims.compiled = true;
                        ui.renderSketchReview(document, forged);
                    } catch { forgedPositiveClaimRejected = true; }
                    return {
                        lessonsChecked,
                        changedStatus: changed.status,
                        changedLines: changed.changes.changedLines,
                        changedClaimsFalse: falseClaims.every(key => changed.claims?.[key] === false),
                        boundary: changed.boundaries,
                        uiStatusRole: section.querySelector('[data-sketch-review-status-label]')?.getAttribute('role'),
                        uiStatusLive: section.querySelector('[data-sketch-review-status-label]')?.getAttribute('aria-live'),
                        uiBoundary: section.querySelector('[data-sketch-review-boundary]')?.textContent || '',
                        uiInteractiveControls: section.querySelectorAll('button,input,textarea,select').length,
                        invalidLessonRejected,
                        unknownFieldRejected,
                        bidiRejected,
                        forgedPositiveClaimRejected,
                    };
                }""")
                check("post-v16-sketch-review-bounded-provenance-contract",
                      len(sketch_review["lessonsChecked"]) == 16
                      and all(
                          row["lessonId"] == index
                          and row["status"] == "reference"
                          and row["provenance"]["reference"] == "lesson-reference"
                          and row["provenance"]["draft"] == "editor-draft"
                          and row["claimsFalse"]
                          and row["frozen"]
                          for index, row in enumerate(sketch_review["lessonsChecked"], start=1)
                      )
                      and sketch_review["changedStatus"] == "changed"
                      and sketch_review["changedLines"] > 0
                      and sketch_review["changedClaimsFalse"]
                      and sketch_review["boundary"]["compilesCpp"] is False
                      and sketch_review["boundary"]["executesFirmware"] is False
                      and sketch_review["boundary"]["provesLearnerCompletion"] is False
                      and sketch_review["uiStatusRole"] == "status"
                      and sketch_review["uiStatusLive"] == "polite"
                      and "không biên dịch Arduino C++" in sketch_review["uiBoundary"]
                      and sketch_review["uiInteractiveControls"] == 0
                      and sketch_review["invalidLessonRejected"]
                      and sketch_review["unknownFieldRejected"]
                      and sketch_review["bidiRejected"]
                      and sketch_review["forgedPositiveClaimRejected"],
                      json.dumps(sketch_review, ensure_ascii=False))
                lexical_spoof = page.evaluate("""async () => {
                    const model = await import('./src/sketch-review.js');
                    const ui = await import('./src/sketch-review-ui.js');
                    const reference = [
                        'void setup(){pinMode(13,OUTPUT);}',
                        'void loop(){digitalWrite(13,HIGH);}',
                    ].join(String.fromCharCode(10));
                    const draft = [
                        'void setup(){pinMode(13,OUTPUT);}',
                        'void loop(){// digitalWrite(13,HIGH)',
                        'const char* note="digitalWrite(13,HIGH)";}',
                    ].join(String.fromCharCode(10));
                    const review = model.inspectSketchDraft({lessonId:2,reference,draft});
                    const fake = review.lexical.findings.find(x=>x.id==='digital-write');
                    const real = review.lexical.findings.find(x=>x.id==='pin-mode');
                    const section = ui.renderSketchReview(document,review);
                    return {
                        mode:review.lexical.mode,
                        fakeStatus:fake?.status,
                        fakeDraftCount:fake?.draftCount,
                        realStatus:real?.status,
                        sourceOnly:review.claims?.compiled===false &&
                            review.claims?.firmwareExecuted===false &&
                            review.claims?.learnerMastery===false,
                        uiDifference:section.getAttribute('data-sketch-review-lexical-difference-count'),
                        uiStatusLive:section.querySelector('[data-sketch-review-lexical-summary]')?.getAttribute('aria-live'),
                        escaped:section.querySelector('img,script')===null,
                    };
                }""")
                check("vnext-sketch-lexical-comment-string-spoof-never-compiles-or-grades",
                      lexical_spoof["mode"] == "masked-reference-pattern-scan"
                      and lexical_spoof["fakeStatus"] == "absent"
                      and lexical_spoof["fakeDraftCount"] == 0
                      and lexical_spoof["realStatus"] == "present"
                      and lexical_spoof["sourceOnly"]
                      and int(lexical_spoof["uiDifference"]) >= 1
                      and lexical_spoof["uiStatusLive"] == "polite"
                      and lexical_spoof["escaped"],
                      json.dumps(lexical_spoof, ensure_ascii=False))
                # Timer1 is a strict direct peripheral model contract only.
                # Do NOT attach it to stock bundled Arduino-core firmware: the
                # current model intentionally fails closed outside Normal WGM0.
                timer1_contracts = run_page_contract(
                    page, "./tests/avr-timer1-contracts.js", "runAvrTimer1Contracts")
                check("avr-timer1-direct-model-contracts",
                      timer1_contracts["passed"] == 11
                      and len(timer1_contracts["checks"]) == 11,
                      f"{timer1_contracts['passed']}/11 direct-model checks; no stock-firmware parity claim")
                # Timer2 is likewise a standalone bounded model. It deliberately
                # does not claim stock Arduino-core timing/tone/PWM parity.
                timer2_contracts = run_page_contract(
                    page, "./tests/avr-timer2-contracts.js", "runAvrTimer2Contracts")
                check("v16-avr-timer2-direct-model-contracts",
                      timer2_contracts["passed"] == 10
                      and len(timer2_contracts["checks"]) == 10,
                      f"{timer2_contracts['passed']}/10 direct-model checks; no stock-firmware parity claim")
                dc_network_contracts = run_page_contract(
                    page, "./tests/dc-resistor-network-contracts.js",
                    "runDcResistorNetworkContracts")
                check("v16-dc-resistor-network-standalone-contracts",
                      dc_network_contracts["passed"] == dc_network_contracts["total"]
                      and dc_network_contracts["passed"] == len(dc_network_contracts["checks"])
                      and dc_network_contracts["total"] == 51,
                      f"{dc_network_contracts['passed']}/{dc_network_contracts['total']} standalone linear-resistor checks; no lesson/3D/sensor linkage")
                resistive_ui_contracts = run_page_contract(
                    page, "./tests/resistive-study-ui-contracts.js",
                    "runResistiveStudyUiContracts")
                check("post-v16-resistive-visual-study-direct-contracts",
                      resistive_ui_contracts["passed"] == resistive_ui_contracts["total"]
                      and resistive_ui_contracts["passed"] == len(resistive_ui_contracts["checks"])
                      and resistive_ui_contracts["total"] == 18,
                      f"{resistive_ui_contracts['passed']}/{resistive_ui_contracts['total']} source-verified visual-study checks")
                bb_session_contracts = run_page_contract(
                    page, "./tests/breadboard-placement-session-contracts.js",
                    "runBreadboardPlacementSessionContracts")
                check("post-v16-breadboard-placement-session-direct-contracts",
                      bb_session_contracts["passed"] == bb_session_contracts["total"]
                      and bb_session_contracts["passed"] == len(bb_session_contracts["checks"])
                      and bb_session_contracts["total"] == 22,
                      f"{bb_session_contracts['passed']}/{bb_session_contracts['total']} authored-session checks")

                # Bounded accessibility regression includes tab semantics and
                # computed contrast, not a claim of full WCAG/screen-reader QA.
                # The a11y contract now exercises the real opt-in firmware UI,
                # so run it in an isolated page/context: its input toggles must
                # never change the initial-state assertions on the main page.
                a11y_context = browser.new_context(viewport={"width": 1440, "height": 900})
                try:
                    a11y_page = a11y_context.new_page()
                    capture_console(a11y_page)
                    a11y_page.goto(base, wait_until="domcontentloaded", timeout=15000)
                    ready(a11y_page)
                    accessibility = run_page_contract(
                        a11y_page, "./tests/accessibility-contracts.js", "runAccessibilityContracts")
                finally:
                    a11y_context.close()
                check("accessibility-desktop-no-p1-or-failed-contracts",
                      accessibility["failed"] == 0 and not accessibility["blockers"],
                      json.dumps({
                          "passed": accessibility["passed"],
                          "failed": accessibility["failed"],
                          "skipped": accessibility["skipped"],
                          "blockers": accessibility["blockers"],
                          "failedChecks": [row for row in accessibility["results"] if row["status"] == "FAIL"],
                      }, ensure_ascii=False))
                check("accessibility-probe-isolated-from-avr-runner",
                      not page.locator("#avrPeripheralMode").is_checked()
                      and "Chưa nạp" in page.locator("#avrStatus").inner_text()
                      and page.locator("#avrStep").is_disabled())

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

                # CPU-only remains the default, the bounded peripheral adapter
                # is opt-in and must never create synthetic lesson Serial/LED.
                check("avr-peripheral-opt-in-default-off",
                      not page.locator("#avrPeripheralMode").is_checked()
                      and page.locator("#avrPeripheralInputs").is_hidden()
                      and page.locator("#avrPeripheralState").is_hidden())
                page.locator("#avrPeripheralMode").check()
                check("avr-peripheral-mode-change-invalidates-cpu",
                      page.locator("#avrStep").is_disabled()
                      and page.locator("#avrCycle").is_disabled()
                      and page.locator("#avrReset").is_disabled()
                      and page.locator("#avrMetrics").is_hidden()
                      and page.locator("#avrProvenance").inner_text() == ""
                      and "Hãy nạp lại firmware mẫu" in page.locator("#avrStatus").inner_text()
                      and not page.locator("#avrLoad").is_disabled(),
                      page.locator("#avrStatus").inner_text())
                page.locator("#avrLoad").click()
                page.wait_for_function(
                    "document.querySelector('#avrStatus')?.dataset.kind === 'success'",
                    timeout=20000,
                )
                check("avr-peripheral-sha-verified-load",
                      "Đã xác minh SHA-256" in page.locator("#avrStatus").inner_text()
                      and "ngoại vi có giới hạn" in page.locator("#avrStatus").inner_text()
                      and page.locator("#avrPeripheralInputs").is_visible()
                      and page.locator("#avrPeripheralState").is_visible()
                      and "Timer0" in page.locator("#avrPeripheralState").inner_text())
                check("avr-peripheral-unknown-inputs-not-faked",
                      "chưa nhập điện áp" in page.locator("#avrPeripheralState").inner_text()
                      and "chưa phát byte" in page.locator("#avrPeripheralState").inner_text())
                page.locator("#avrD2Input").select_option("high")
                check("avr-peripheral-external-digital-manual-only",
                      "Đã khai báo D2: high" in page.locator("#avrStatus").inner_text()
                      and "không phải tín hiệu đo" in page.locator("#avrStatus").inner_text())
                page.locator("#avrA0Input").fill("2500")
                page.locator("#avrApplyA0").click()
                check("avr-peripheral-fixed-analog-manual-only",
                      "2500 mV do người học đặt" in page.locator("#avrPeripheralState").inner_text()
                      and "giả định thủ công" in page.locator("#avrStatus").inner_text())
                page.locator("#avrA0Input").fill("5001")
                page.locator("#avrApplyA0").click()
                check("v15-avr-a0-above-5000mv-reference-rejected",
                      page.locator("#avrStatus").get_attribute("data-kind") == "error"
                      and "0 đến 5000 mV" in page.locator("#avrStatus").inner_text()
                      and "2500 mV" in page.locator("#avrPeripheralState").inner_text())
                page.locator("#avrA0Input").fill("5501")
                page.locator("#avrApplyA0").click()
                check("avr-peripheral-overrange-a0-rejected",
                      page.locator("#avrStatus").get_attribute("data-kind") == "error"
                      and "0 đến 5000 mV" in page.locator("#avrStatus").inner_text()
                      and "2500 mV" in page.locator("#avrPeripheralState").inner_text())
                page.locator("#avrA0Input").fill("")
                page.locator("#avrApplyA0").click()
                check("avr-peripheral-cleared-a0-unknown",
                      "chưa nhập điện áp" in page.locator("#avrPeripheralState").inner_text())
                for _ in range(4):
                    page.locator("#avrCycle").click()
                check("avr-peripheral-compiled-d13-gpio",
                      "GPIO PB5 / Arduino D13: output · HIGH" in
                      page.locator("#avrPeripheralState").inner_text()
                      and "Timer0: TCNT0" in page.locator("#avrPeripheralState").inner_text()
                      and "USART0 TX: 0 byte" in page.locator("#avrPeripheralState").inner_text())
                page.locator("#avrReset").click()
                page.wait_for_function(
                    "document.querySelector('#avrStatus')?.textContent.includes('khởi tạo CPU/flash/SRAM')",
                    timeout=10000,
                )
                check("avr-peripheral-reset-clears-assumed-inputs",
                      page.locator("#avrD2Input").input_value() == "floating"
                      and page.locator("#avrA0Input").input_value() == ""
                      and "chưa nhập điện áp" in page.locator("#avrPeripheralState").inner_text())
                page.locator("#avrPeripheralMode").uncheck()
                check("avr-peripheral-opt-out-restores-cpu-only",
                      page.locator("#avrStep").is_disabled()
                      and page.locator("#avrPeripheralInputs").is_hidden()
                      and page.locator("#avrPeripheralState").is_hidden())
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
                    sketch_review_region = page.locator(
                        "#sketchReviewMount [data-sketch-review]"
                    )
                    check(f"lesson-{lesson_id:02d}-render",
                          page.locator("#sceneMount canvas").count() == 1
                          and page.locator("#quizChoices input").count() >= 3
                          and len(page.locator("#codeViewer").inner_text()) > 30
                          and sketch_review_region.count() == 1
                          and sketch_review_region.get_attribute(
                              "data-sketch-review-lesson") == str(lesson_id)
                          and sketch_review_region.get_attribute(
                              "data-sketch-review-status") == "reference")

                # v1.5 editor/coach are lesson-scoped. Lesson 01 intentionally
                # has no external wiring editor; all lessons still get local,
                # non-persistent learning guidance in the Practice info tab.
                for lesson_id in range(1, 17):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    editor_visible = page.locator("#labEditEntry").is_visible()
                    page.locator("#infoTabPractice").click()
                    coach_text = page.locator("#learningCoach").inner_text()
                    lesson_editor_ok = (not editor_visible) if lesson_id == 1 else editor_visible
                    lesson_one_boundary = (
                        "không yêu cầu dây ngoài" in coach_text if lesson_id == 1 else True
                    )
                    check(f"v15-lesson-{lesson_id:02d}-editor-coach-switch",
                          lesson_editor_ok
                          and page.locator("#learningCoach").is_visible()
                          and "BƯỚC 1/" in coach_text
                          and "không đo hay xác nhận phần cứng" in coach_text
                          and lesson_one_boundary,
                          json.dumps({
                              "lesson": lesson_id,
                              "editorVisible": editor_visible,
                              "coach": coach_text[:280],
                          }, ensure_ascii=False))

                # Real lab editor integration on lesson 02: movement/rotation
                # changes the conceptual layout only, while terminal wiring is
                # delegated to the existing circuit-router and must appear in
                # the existing 2D wiring workbench.
                page.locator('.lesson-link[data-lesson="2"]').click()
                page.locator("#infoTabPractice").click()
                untouched_coach = page.locator("#learningCoach").inner_text()
                page.locator("#stageTabWiring").click()
                untouched_2d_wires = page.locator(".wire-connected").count()
                page.locator("#stageTab3d").click()
                check("v15-untouched-reference-not-learner-completion",
                      untouched_2d_wires == 0
                      and "bản tự đấu chưa có dây" in untouched_coach
                      and "Topology đạt" not in untouched_coach,
                      json.dumps({"twoD": untouched_2d_wires,
                                  "coach": untouched_coach[:400]}, ensure_ascii=False))
                check("v15-lab-editor-entry-lesson02",
                      page.locator("#labEditEntry").is_visible()
                      and page.locator("#labEditor").is_hidden()
                      and page.locator("#labEditToggle").get_attribute("aria-expanded") == "false")
                page.locator("#labEditToggle").click()
                check("v15-editor-opens-with-empty-canonical-draft",
                      page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") == "0"
                      and "0 dây" in page.locator("#labStatus").inner_text()
                      and "Topology đạt" not in page.locator("#learningCoach").inner_text(),
                      page.locator("#labStatus").inner_text())
                check("v15-lab-editor-toggle-controls",
                      page.locator("#labEditor").is_visible()
                      and page.locator("#labEditToggle").get_attribute("aria-expanded") == "true"
                      and page.locator("#labComponent option").count() >= 1
                      and page.locator("#labFromPin option").count() >= 2
                      and page.locator("#labToPin option").count() >= 2)
                lab_before = {
                    "component": page.locator("#labComponent").input_value(),
                    "x": float(page.locator("#labPositionX").input_value()),
                    "z": float(page.locator("#labPositionZ").input_value()),
                }
                page.locator('[data-lab-nudge="0.5,0"]').click()
                lab_after_nudge = {
                    "component": page.locator("#labComponent").input_value(),
                    "x": float(page.locator("#labPositionX").input_value()),
                    "z": float(page.locator("#labPositionZ").input_value()),
                    "status": page.locator("#labStatus").inner_text(),
                }
                check("v15-lab-editor-xz-nudge",
                      lab_after_nudge["component"] == lab_before["component"]
                      and (lab_after_nudge["x"] != lab_before["x"]
                           or lab_after_nudge["z"] != lab_before["z"])
                      and abs(lab_after_nudge["x"] * 2 - round(lab_after_nudge["x"] * 2)) < 1e-9
                      and abs(lab_after_nudge["z"] * 2 - round(lab_after_nudge["z"] * 2)) < 1e-9
                      and "Netlist điện không thay đổi" in lab_after_nudge["status"],
                      json.dumps({"before": lab_before, "after": lab_after_nudge}, ensure_ascii=False))
                page.locator("#labPositionX").fill(str(lab_before["x"]))
                page.locator("#labPositionZ").fill(str(lab_before["z"]))
                page.locator("#labPlace").click()
                check("v15-lab-editor-direct-xz-input",
                      float(page.locator("#labPositionX").input_value()) == lab_before["x"]
                      and float(page.locator("#labPositionZ").input_value()) == lab_before["z"]
                      and "Đã cập nhật vị trí minh họa" in page.locator("#labStatus").inner_text())
                page.locator("#labRotateRight").click()
                check("v15-lab-editor-rotate-90",
                      "Đã xoay" in page.locator("#labStatus").inner_text()
                      and "90°" in page.locator("#labStatus").inner_text())

                # displayedCircuit(2) initially resolves to the complete sample.
                # Clear the canonical shared graph first; otherwise connecting a
                # sample edge would correctly fail as a duplicate and the test
                # could accidentally reward a false-positive UI message.
                page.locator("#labClearWires").click()
                check("v15-lab-editor-clear-canonical-before-connect",
                      "Đã xóa" in page.locator("#labStatus").inner_text()
                      and page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") == "0")
                page.locator('#stageTabWiring').click()
                check("v15-lab-editor-clear-syncs-2d",
                      page.locator(".wire-connected").count() == 0)
                page.locator('#stageTab3d').click()

                first_sample_wire = page.evaluate("""() => import('./src/circuit-router.js').then(m => {
                    const sample = m.createSampleCircuit(2);
                    const wire = sample.wires[0];
                    return {from: wire.from, to: wire.to};
                })""")
                page.locator("#labFromPin").select_option(first_sample_wire["from"])
                page.locator("#labToPin").select_option(first_sample_wire["to"])
                page.locator("#labConnect").click()
                check("v15-lab-editor-terminal-connect-router",
                      "Đã nối" in page.locator("#labStatus").inner_text()
                      and first_sample_wire["from"] in page.locator("#labStatus").inner_text()
                      and first_sample_wire["to"] in page.locator("#labStatus").inner_text(),
                      json.dumps(first_sample_wire, ensure_ascii=False))
                page.locator('#stageTabWiring').click()
                wiring_rows = page.locator(".wire-connected").all_inner_texts()
                check("v15-lab-editor-connect-syncs-2d",
                      len(wiring_rows) == 1
                      and first_sample_wire["from"] in wiring_rows[0]
                      and first_sample_wire["to"] in wiring_rows[0],
                      json.dumps(wiring_rows, ensure_ascii=False))
                partial_coach = page.locator("#learningCoach").inner_text()
                check("v15-coach-partial-learner-draft-incomplete",
                      "bản đấu dây đang chỉnh sửa" in partial_coach
                      and "Topology đạt" not in partial_coach,
                      partial_coach[:500])
                page.locator('#stageTab3d').click()
                check("v15-lab-editor-return-3d-preserves-editing",
                      page.locator("#labEditor").is_visible()
                      and page.locator("#labEditToggle").get_attribute("aria-expanded") == "true")
                lesson2_sample_count = page.evaluate(
                    "() => import('./src/circuit-router.js').then(m => m.createSampleCircuit(2).wires.length)"
                )
                page.locator("#labSampleWires").click()
                restored_lab_status = page.locator("#labStatus").inner_text()
                restored_scene_count = page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")
                page.locator('#stageTabWiring').click()
                restored_2d_valid = (
                    page.locator(".wire-status").get_attribute("data-valid") == "true"
                    and not page.locator(".wire-activate").is_disabled()
                )
                page.locator('#stageTab3d').click()
                check("v15-lab-editor-restore-sample-after-sync",
                      "mẫu" in restored_lab_status.lower()
                      and "Topology đáp ứng" in restored_lab_status
                      and restored_scene_count == str(lesson2_sample_count)
                      and restored_2d_valid,
                      json.dumps({
                          "sampleWires": lesson2_sample_count,
                          "sceneWireCount": restored_scene_count,
                          "twoDimensionalValid": restored_2d_valid,
                          "status": restored_lab_status,
                      }, ensure_ascii=False))
                check("v15-coach-updates-to-complete-draft-only",
                      "bản đấu dây đang chỉnh sửa" in page.locator("#learningCoach").inner_text()
                      and "Bản tự đấu hiện tại: Topology đạt" in
                          page.locator("#learningCoach").inner_text())
                page.locator("#labRemoveLastWire").click()
                check("v15-coach-invalidated-when-required-wire-removed",
                      "Bản tự đấu hiện tại: Topology đạt" not in
                          page.locator("#learningCoach").inner_text()
                      and page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") ==
                          str(lesson2_sample_count - 1))
                page.locator("#labSampleWires").click()
                page.locator("#stageTabWiring").click()
                page.locator(".wire-activate").click()
                check("v15-valid-learner-draft-must-be-activated-explicitly",
                      page.locator(".wire-activate").get_attribute("aria-pressed") == "true")
                page.locator("#stageTab3d").click()
                page.locator("#labRemoveLastWire").click()
                check("v15-3d-invalid-edit-revokes-custom-activation",
                      "chưa kích hoạt" in page.locator("#electricalResult").inner_text()
                      and "Bản tự đấu hiện tại: Topology đạt" not in page.locator("#learningCoach").inner_text())
                page.locator("#labSampleWires").click()
                page.locator("#stageTabWiring").click()
                check("v15-3d-repair-does-not-silently-reactivate",
                      page.locator(".wire-activate").get_attribute("aria-pressed") == "false"
                      and page.locator(".wire-inactive").is_hidden()
                      and not page.locator(".wire-activate").is_disabled())
                page.locator("#stageTab3d").click()

                # Motor/pump lessons remain signal-only even when their sample
                # wires are applied through the new 3D editor. The editor may
                # visualize/synchronize them but must not promote activation.
                for lesson_id in (10, 14):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    page.locator("#labEditToggle").click()
                    page.locator("#labSampleWires").click()
                    lab_signal_status = page.locator("#labStatus").inner_text()
                    page.locator('#stageTabWiring').click()
                    wiring_signal_status = page.locator(".wire-status").inner_text()
                    check(f"v15-lab-editor-{lesson_id:02d}-signal-only-fail-closed",
                          "chỉ kiểm tra dây tín hiệu" in lab_signal_status
                          and "nguồn/tải chưa có mô hình" in lab_signal_status
                          and page.locator(".wire-activate").is_disabled()
                          and page.locator(".wire-activate").get_attribute("aria-pressed") == "false"
                          and "không phải mạch hoàn chỉnh" in wiring_signal_status,
                          json.dumps({
                              "lab": lab_signal_status,
                              "wiring": wiring_signal_status,
                          }, ensure_ascii=False))
                    page.locator('#stageTab3d').click()

                # Worker1 scene API supports real pointer picking/dragging for
                # conceptual layouts. Stress lesson 16 (largest component set):
                # pick a movable component through the rendered canvas, drag it
                # through the scene callback, then select two rendered terminal
                # markers so the same circuit-router wire appears in 2D.
                page.locator('.lesson-link[data-lesson="16"]').click()
                page.locator("#labEditToggle").click()
                page.locator('#cameraToolbar [data-camera="reset"]').click()
                page.wait_for_timeout(60)
                canvas = page.locator("#sceneMount canvas")
                scene16_meta = {
                    "mode": canvas.get_attribute("data-lab-layout-mode"),
                    "components": canvas.get_attribute("data-lab-component-count"),
                    "terminals": canvas.get_attribute("data-lab-terminal-count"),
                    "edit": canvas.get_attribute("data-lab-edit"),
                    "physical": canvas.get_attribute("data-lab-physical-verified"),
                    "holes": canvas.get_attribute("data-lab-breadboard-hole-mapping"),
                    "power": canvas.get_attribute("data-lab-electrical-power"),
                }
                check("v15-scene-lesson16-conceptual-layout-stress",
                      scene16_meta["mode"] == "conceptual-layout"
                      and scene16_meta["components"] == "9"
                      and int(scene16_meta["terminals"] or "0") >= 12
                      and scene16_meta["edit"] == "on"
                      and scene16_meta["physical"] == "false"
                      and scene16_meta["holes"] == "false"
                      and scene16_meta["power"] == "false",
                      json.dumps(scene16_meta, ensure_ascii=False))
                scene_target = page.evaluate("""() => Promise.all([
                    import('./src/lab-layout.js'), import('./src/circuit-router.js')
                ]).then(([layoutModule, router]) => {
                    const layout = layoutModule.createLabLayout(16, router.listTerminals(16));
                    return layout.components
                      .filter(item => !item.fixed && item.visualKind !== 'breadboard')
                      .sort((a,b) => (Math.abs(a.x)+Math.abs(a.z))-(Math.abs(b.x)+Math.abs(b.z)))[0].id;
                })""")
                component_point = lab_scene_point(page, 16, component_id=scene_target)
                check("v15-scene-lesson16-pick-target-visible",
                      component_point["inViewport"], json.dumps(component_point))
                page.mouse.click(component_point["x"], component_point["y"])
                page.wait_for_timeout(40)
                check("v15-scene-pointer-select-component",
                      canvas.get_attribute("data-lab-selected-component") == scene_target
                      and page.locator("#labComponent").input_value() == scene_target
                      and "từ 3D" in page.locator("#labStatus").inner_text(),
                      json.dumps({
                          "target": scene_target,
                          "selected": canvas.get_attribute("data-lab-selected-component"),
                          "ui": page.locator("#labComponent").input_value(),
                          "status": page.locator("#labStatus").inner_text(),
                      }, ensure_ascii=False))
                drag_before = (
                    float(page.locator("#labPositionX").input_value()),
                    float(page.locator("#labPositionZ").input_value()),
                )
                page.mouse.move(component_point["x"], component_point["y"])
                page.mouse.down()
                page.mouse.move(component_point["x"] + 44, component_point["y"] + 10, steps=8)
                page.mouse.up()
                page.wait_for_timeout(60)
                drag_after = (
                    float(page.locator("#labPositionX").input_value()),
                    float(page.locator("#labPositionZ").input_value()),
                )
                check("v15-scene-pointer-drag-component",
                      drag_after != drag_before
                      and abs(drag_after[0] * 2 - round(drag_after[0] * 2)) < 1e-9
                      and abs(drag_after[1] * 2 - round(drag_after[1] * 2)) < 1e-9
                      and "Netlist điện không thay đổi" in page.locator("#labStatus").inner_text(),
                      json.dumps({"before": drag_before, "after": drag_after}, ensure_ascii=False))
                # Canvas Escape must clear the same component selection exposed
                # by the accessible HTML inspector; no stale move buttons.
                canvas.focus()
                page.keyboard.press("Escape")
                check("v15-scene-escape-deselect-syncs-inspector",
                      canvas.get_attribute("data-lab-selected-component") == ""
                      and page.locator("#labComponent").input_value() == ""
                      and page.locator("#labPlace").is_disabled()
                      and page.locator("#labRotateRight").is_disabled()
                      and page.locator('[data-lab-nudge="0.5,0"]').is_disabled())

                # The fixed Uno can be selected as a reference, but no input
                # may continue to control the previously selected movable part.
                arduino_pick = lab_scene_point(page, 16, component_id="arduino")
                selected_fixed = False
                for dx, dy in ((0, 0), (-7, 0), (7, 0), (0, -7), (0, 7)):
                    page.mouse.click(arduino_pick["x"] + dx, arduino_pick["y"] + dy)
                    if canvas.get_attribute("data-lab-selected-component") == "arduino":
                        selected_fixed = True
                        break
                check("v15-scene-fixed-arduino-inspector-disables-movement",
                      selected_fixed
                      and page.locator("#labComponent").input_value() == "arduino"
                      and page.locator("#labPlace").is_disabled()
                      and page.locator("#labRotateLeft").is_disabled()
                      and page.locator("#labPositionX").is_disabled(),
                      json.dumps({"pick": arduino_pick,
                                  "selected": canvas.get_attribute("data-lab-selected-component"),
                                  "inspector": page.locator("#labComponent").input_value()}))
                bounds = canvas.bounding_box()
                page.mouse.click(bounds["x"] + 7, bounds["y"] + 7)
                check("v15-scene-background-deselect-syncs-inspector",
                      canvas.get_attribute("data-lab-selected-component") == ""
                      and page.locator("#labComponent").input_value() == ""
                      and page.locator("#labPlace").is_disabled())

                page.locator("#labResetPositions").click()
                page.locator("#labClearWires").click()
                page.locator('#cameraToolbar [data-camera="reset"]').click()
                page.wait_for_timeout(60)
                scene_wire = page.evaluate("""() => import('./src/circuit-router.js').then(m => {
                    const wire = m.createSampleCircuit(16).wires[0];
                    return {from: wire.from, to: wire.to};
                })""")
                from_point = lab_scene_point(page, 16, terminal_id=scene_wire["from"])
                to_point = lab_scene_point(page, 16, terminal_id=scene_wire["to"])
                first_scene_terminal = False
                for dy in range(-16, 17, 4):
                    for dx in range(-16, 17, 4):
                        page.mouse.click(from_point["x"] + dx, from_point["y"] + dy)
                        page.wait_for_timeout(15)
                        if f"Đã chọn {scene_wire['from']}" in page.locator("#labSelectedTerminal").inner_text():
                            first_scene_terminal = True
                            break
                    if first_scene_terminal:
                        break
                second_scene_terminal = False
                if first_scene_terminal:
                    for dy in range(-16, 17, 4):
                        for dx in range(-16, 17, 4):
                            page.mouse.click(to_point["x"] + dx, to_point["y"] + dy)
                            page.wait_for_timeout(15)
                            terminal_note = page.locator("#labSelectedTerminal").inner_text()
                            if ("Nối" in terminal_note and scene_wire["from"] in terminal_note
                                    and scene_wire["to"] in terminal_note):
                                second_scene_terminal = True
                                break
                        if second_scene_terminal:
                            break
                check("v15-scene-terminal-pair-creates-router-wire",
                      first_scene_terminal and second_scene_terminal
                      and canvas.get_attribute("data-lab-wire-count") == "1"
                      and "Đã nối" in page.locator("#labStatus").inner_text(),
                      json.dumps({
                          "wire": scene_wire,
                          "fromPoint": from_point,
                          "toPoint": to_point,
                          "firstSelected": first_scene_terminal,
                          "secondSelected": second_scene_terminal,
                          "wireCount": canvas.get_attribute("data-lab-wire-count"),
                          "note": page.locator("#labSelectedTerminal").inner_text(),
                          "status": page.locator("#labStatus").inner_text(),
                      }, ensure_ascii=False))
                page.locator('#stageTabWiring').click()
                scene_wire_rows = page.locator(".wire-connected").all_inner_texts()
                check("v15-scene-terminal-wire-syncs-2d",
                      any(scene_wire["from"] in row and scene_wire["to"] in row
                          for row in scene_wire_rows),
                      json.dumps(scene_wire_rows, ensure_ascii=False))
                page.locator('#stageTab3d').click()

                # v1.6 Lab Explorer is a projection of the SAME canonical
                # learner graph plus a separately labeled read-only reference
                # sample. Start from a fresh in-memory state so v1.5 edits above
                # cannot make a reference sample look like learner progress.
                page.reload(wait_until="domcontentloaded", timeout=20000)
                ready(page)
                for lesson_id in range(1, 17):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    explorer = page.locator("#labExplorer .lab-explorer")
                    expected_source = "none" if lesson_id == 1 else "learner-empty"
                    expected_scope = (
                        "none" if lesson_id == 1 else
                        "signal-only" if lesson_id in (10, 14) else "topology"
                    )
                    basic = (
                        explorer.is_visible()
                        and explorer.get_attribute("data-lesson-id") == str(lesson_id)
                        and explorer.get_attribute("data-explorer-source") == expected_source
                        and explorer.get_attribute("data-explorer-scope") == expected_scope
                        and explorer.locator("[data-explorer-panel]").count() == 3
                    )
                    if lesson_id == 1:
                        surface_ok = (
                            explorer.locator('[data-explorer-empty="lesson-01"]').count() == 1
                            and explorer.locator("[data-explorer-connect]").count() == 0
                        )
                    else:
                        surface_ok = (
                            explorer.locator(".lab-explorer-schematic-svg").get_attribute("role") == "group"
                            and explorer.locator(".lab-explorer-minimap-svg").get_attribute("role") == "group"
                            and explorer.locator("[data-explorer-reference-toggle]").count() == 1
                        )
                    check(f"v16-explorer-lesson-{lesson_id:02d}-surfaces-source-scope",
                          basic and surface_ok,
                          json.dumps({
                              "lesson": lesson_id,
                              "source": explorer.get_attribute("data-explorer-source"),
                              "scope": explorer.get_attribute("data-explorer-scope"),
                              "panels": explorer.locator("[data-explorer-panel]").count(),
                          }, ensure_ascii=False))

                page.locator('.lesson-link[data-lesson="2"]').click()
                explorer = page.locator("#labExplorer .lab-explorer")
                lesson2_reference_count = page.evaluate(
                    "() => import('./src/circuit-router.js').then(m => m.createSampleCircuit(2).wires.length)"
                )
                learner_wire_list = explorer.locator(
                    '[data-explorer-panel="schematic"] .lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                )
                reference_toggle = explorer.locator("[data-explorer-reference-toggle]")
                check("v16-explorer-fresh-learner-reference-provenance",
                      explorer.get_attribute("data-explorer-source") == "learner-empty"
                      and learner_wire_list.count() == 0
                      and reference_toggle.get_attribute("aria-pressed") == "false"
                      and "mẫu tham khảo" in explorer.locator(".lab-explorer-reference-label").inner_text().lower(),
                      json.dumps({
                          "source": explorer.get_attribute("data-explorer-source"),
                          "learnerWires": learner_wire_list.count(),
                          "referenceLabel": explorer.locator(".lab-explorer-reference-label").inner_text(),
                      }, ensure_ascii=False))
                check("v16-explorer-learner-empty-evidence-never-reference",
                      explorer.get_attribute("data-explorer-source") == "learner-empty"
                      and "Bản tự đấu · chưa có dây" in
                          explorer.locator(".lab-explorer-status").inner_text()
                      and "Mạch mẫu tham khảo" in
                          explorer.locator(".lab-explorer-schematic-meta").inner_text()
                      and learner_wire_list.count() == 0,
                      explorer.locator(".lab-explorer-status").inner_text())
                schematic_svg = explorer.locator(".lab-explorer-schematic-svg")
                minimap_svg = explorer.locator(".lab-explorer-minimap-svg")
                svg_actions = explorer.locator(
                    ".lab-explorer-schematic-svg [role='button'], "
                    ".lab-explorer-minimap-svg [role='button']"
                )
                check("v16-explorer-svg-interactive-roots-are-named-groups",
                      schematic_svg.get_attribute("role") == "group"
                      and minimap_svg.get_attribute("role") == "group"
                      and schematic_svg.get_attribute("aria-label")
                      and minimap_svg.get_attribute("aria-label")
                      and svg_actions.count() > 4
                      and all(
                          svg_actions.nth(index).get_attribute("tabindex") == "0"
                          and bool(svg_actions.nth(index).get_attribute("aria-label"))
                          for index in range(svg_actions.count())
                      ),
                      json.dumps({
                          "schematicRole": schematic_svg.get_attribute("role"),
                          "minimapRole": minimap_svg.get_attribute("role"),
                          "interactiveActions": svg_actions.count(),
                      }, ensure_ascii=False))
                reference_toggle.click()
                check("v16-explorer-reference-overlay-readonly-separated",
                      explorer.locator('[data-explorer-reference-view="on"]').count() == 1
                      and explorer.locator(".lab-explorer-schematic-svg [data-explorer-reference-wire]").count()
                          == lesson2_reference_count
                      and explorer.locator(".lab-explorer-reference-list [data-explorer-reference-wire]").count()
                          == lesson2_reference_count
                      and learner_wire_list.count() == 0
                      and explorer.locator("[data-explorer-disconnect]").count() == 0,
                      json.dumps({
                          "sampleWires": lesson2_reference_count,
                          "svgReference": explorer.locator(
                              ".lab-explorer-schematic-svg [data-explorer-reference-wire]").count(),
                          "learnerWires": learner_wire_list.count(),
                      }, ensure_ascii=False))

                first_reference_wire = page.evaluate("""() => import('./src/circuit-router.js').then(m => {
                    const wire = m.createSampleCircuit(2).wires[0];
                    return {from: wire.from, to: wire.to};
                })""")
                canvas = page.locator("#sceneMount canvas")
                explorer.locator(
                    '.lab-explorer-schematic-svg [data-explorer-component="arduino"]'
                ).click()
                readonly_component_state = {
                    "stage": page.locator("#stageTab3d").get_attribute("aria-selected"),
                    "editorHidden": page.locator("#labEditor").is_hidden(),
                    "editPressed": page.locator("#labEditToggle").get_attribute("aria-pressed"),
                    "inspector": page.locator("#labComponent").input_value(),
                    "sceneSelected": canvas.get_attribute("data-lab-selected-component"),
                    "sceneFocused": canvas.get_attribute("data-lab-focused-component"),
                    "sceneWires": canvas.get_attribute("data-lab-wire-count"),
                }
                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["from"]}"]'
                ).locator("circle").click()
                readonly_first_terminal = explorer.get_attribute(
                    "data-explorer-selected-terminal")
                readonly_first_scene_inspection = canvas.get_attribute(
                    "data-lab-inspected-terminal")
                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["to"]}"]'
                ).locator("circle").click()
                readonly_second_terminal = explorer.get_attribute(
                    "data-explorer-selected-terminal")
                readonly_second_scene_inspection = canvas.get_attribute(
                    "data-lab-inspected-terminal")
                check("post-v16-explorer-readonly-inspection-projects-to-3d",
                      readonly_first_scene_inspection == first_reference_wire["from"]
                      and readonly_second_scene_inspection == first_reference_wire["to"]
                      # Default read-only scene has no mounted edit layout:
                      # report a textual label, never a fake 3D pin halo.
                      and canvas.get_attribute("data-lab-inspection-feedback") == "label"
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and page.locator("#labEditToggle").get_attribute("aria-pressed") == "false"
                      and page.locator("#sceneInspectionStatus").is_visible()
                      and page.locator("#sceneInspectionStatus").get_attribute("role") == "status"
                      and page.locator("#sceneInspectionStatus").get_attribute("aria-live") == "polite"
                      and first_reference_wire["to"] in
                          page.locator("#sceneInspectionStatus").inner_text()
                      and "không xác nhận lỗ cắm vật lý" in
                          page.locator("#sceneInspectionStatus").inner_text(),
                      json.dumps({
                          "first": readonly_first_scene_inspection,
                          "second": readonly_second_scene_inspection,
                          "feedback": canvas.get_attribute("data-lab-inspection-feedback"),
                          "wires": canvas.get_attribute("data-lab-wire-count"),
                          "status": page.locator("#sceneInspectionStatus").inner_text(),
                      }, ensure_ascii=False))
                check("v16-explorer-readonly-inspection-does-not-enter-edit-or-wire",
                      readonly_component_state["stage"] == "true"
                      and readonly_component_state["editorHidden"]
                      and readonly_component_state["editPressed"] == "false"
                      and readonly_component_state["inspector"] == "arduino"
                      and readonly_component_state["sceneSelected"] == ""
                      and readonly_component_state["sceneFocused"] == ""
                      and readonly_component_state["sceneWires"] == "0"
                      and readonly_first_terminal == first_reference_wire["from"]
                      and readonly_second_terminal == first_reference_wire["to"]
                      and page.locator("#labEditor").is_hidden()
                      and page.locator("#labEditToggle").get_attribute("aria-pressed") == "false"
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and explorer.get_attribute("data-explorer-source") == "learner-empty"
                      and learner_wire_list.count() == 0,
                      json.dumps({
                          "component": readonly_component_state,
                          "firstTerminal": readonly_first_terminal,
                          "secondTerminal": readonly_second_terminal,
                          "source": explorer.get_attribute("data-explorer-source"),
                      }, ensure_ascii=False))

                # A minimap action must drive the existing 3D/editor selection,
                # not a parallel Explorer-only selection model. Editing must be
                # explicit; only after this opt-in may 3D focus/wiring activate.
                page.locator("#labEditToggle").click()
                explorer.locator(
                    '.lab-explorer-schematic-svg [data-explorer-component="arduino"]'
                ).click()
                explorer.locator(
                    '[data-explorer-panel="minimap"] .lab-explorer-minimap-svg '
                    '[data-explorer-component="arduino"][data-explorer-focus="arduino"]'
                ).click()
                check("v16-explorer-fixed-arduino-selection-focus-sync",
                      page.locator("#labEditor").is_visible()
                      and page.locator("#labEditToggle").get_attribute("aria-pressed") == "true"
                      and explorer.get_attribute("data-explorer-selected-terminal") == ""
                      and page.locator("#labComponent").input_value() == "arduino"
                      and canvas.get_attribute("data-lab-selected-component") == "arduino"
                      and canvas.get_attribute("data-lab-focused-component") == "arduino"
                      and explorer.locator(
                          '[data-explorer-panel="minimap"] [data-explorer-component="arduino"][data-selected="true"]'
                      ).count() >= 1
                      and explorer.locator(
                          '[data-explorer-panel="minimap"] [data-explorer-component="arduino"][data-focused="true"]'
                      ).count() >= 1
                      and page.locator("#labPlace").is_disabled()
                      and page.locator("#labRotateRight").is_disabled()
                      and "Cố định" in explorer.locator(".lab-explorer-inspector").inner_text(),
                      json.dumps({
                          "editor": page.locator("#labComponent").input_value(),
                          "selected": canvas.get_attribute("data-lab-selected-component"),
                          "focused": canvas.get_attribute("data-lab-focused-component"),
                      }, ensure_ascii=False))

                # A focus-only action must move the camera without implicitly
                # changing the selected component or any netlist state.
                explorer.locator(
                    '.lab-explorer-minimap-equivalent '
                    '[data-explorer-component="breadboard"]:not([data-explorer-focus])'
                ).click()
                camera_only_before_wires = canvas.get_attribute("data-lab-wire-count")
                explorer.locator(
                    '.lab-explorer-minimap-equivalent '
                    '[data-explorer-focus="arduino"]:not([data-explorer-component])'
                ).click()
                check("v16-explorer-focus-is-camera-only",
                      page.locator("#labComponent").input_value() == "breadboard"
                      and canvas.get_attribute("data-lab-selected-component") == "breadboard"
                      and canvas.get_attribute("data-lab-focused-component") == "arduino"
                      and canvas.get_attribute("data-lab-wire-count") == camera_only_before_wires,
                      json.dumps({
                          "selected": canvas.get_attribute("data-lab-selected-component"),
                          "focused": canvas.get_attribute("data-lab-focused-component"),
                          "wires": canvas.get_attribute("data-lab-wire-count"),
                      }, ensure_ascii=False))
                canvas.focus()
                page.keyboard.press("Home")
                home_focus_state = {
                    "canvas": canvas.get_attribute("data-lab-focused-component"),
                    "minimap": explorer.locator(
                        '[data-explorer-panel="minimap"] [data-focused="true"]').count(),
                    "selected": canvas.get_attribute("data-lab-selected-component"),
                }
                explorer.locator(
                    '.lab-explorer-minimap-equivalent '
                    '[data-explorer-focus="arduino"]:not([data-explorer-component])'
                ).click()
                page.locator('#cameraToolbar [data-camera="reset"]').click()
                toolbar_focus_state = {
                    "canvas": canvas.get_attribute("data-lab-focused-component"),
                    "minimap": explorer.locator(
                        '[data-explorer-panel="minimap"] [data-focused="true"]').count(),
                    "selected": canvas.get_attribute("data-lab-selected-component"),
                }
                check("v16-explorer-home-toolbar-reset-refresh-minimap-focus",
                      home_focus_state["canvas"] == ""
                      and home_focus_state["minimap"] == 0
                      and home_focus_state["selected"] == "breadboard"
                      and toolbar_focus_state["canvas"] == ""
                      and toolbar_focus_state["minimap"] == 0
                      and toolbar_focus_state["selected"] == "breadboard",
                      json.dumps({
                          "home": home_focus_state,
                          "toolbar": toolbar_focus_state,
                      }, ensure_ascii=False))

                page.locator("#stageTabWiring").click()
                explorer = page.locator("#labExplorer .lab-explorer")
                focus_while_2d = explorer.locator(
                    '.lab-explorer-minimap-equivalent '
                    '[data-explorer-focus="arduino"]:not([data-explorer-component])'
                )
                check("v16-explorer-focus-disabled-outside-3d-stage",
                      page.locator("#stageTabWiring").get_attribute("aria-selected") == "true"
                      and page.locator("#labEditToggle").get_attribute("aria-pressed") == "true"
                      and focus_while_2d.is_disabled()
                      and focus_while_2d.get_attribute("aria-disabled") == "true"
                      and explorer.locator(
                          '.lab-explorer-minimap-svg '
                          '[data-explorer-component="arduino"][data-explorer-focus]'
                      ).count() == 0
                      and canvas.get_attribute("data-lab-focused-component") == "",
                      json.dumps({
                          "stage": page.locator("#stageTabWiring").get_attribute("aria-selected"),
                          "editing": page.locator("#labEditToggle").get_attribute("aria-pressed"),
                          "focusDisabled": focus_while_2d.is_disabled(),
                          "sceneFocused": canvas.get_attribute("data-lab-focused-component"),
                      }, ensure_ascii=False))
                page.locator("#stageTab3d").click()
                explorer = page.locator("#labExplorer .lab-explorer")

                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["from"]}"]'
                ).locator("circle").click()
                svg_first_terminal_note = page.locator("#labSelectedTerminal").inner_text()
                check("post-v16-3d-pending-wire-first-terminal-visual-only",
                      canvas.get_attribute("data-lab-pending-wire-terminal") ==
                          first_reference_wire["from"]
                      and canvas.get_attribute("data-lab-pending-wire-hover-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-preview") == "none"
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and first_reference_wire["from"] in
                          (canvas.get_attribute("aria-label") or "")
                      and "chưa tạo dây" in (canvas.get_attribute("aria-label") or "").lower()
                      and "chọn chân thứ hai" in svg_first_terminal_note.lower(),
                      json.dumps({
                          "pending": canvas.get_attribute("data-lab-pending-wire-terminal"),
                          "hover": canvas.get_attribute("data-lab-pending-wire-hover-terminal"),
                          "preview": canvas.get_attribute("data-lab-pending-wire-preview"),
                          "wires": canvas.get_attribute("data-lab-wire-count"),
                          "note": svg_first_terminal_note,
                      }, ensure_ascii=False))
                selected_terminal_nodes = explorer.locator(
                    f'[data-explorer-terminal="{first_reference_wire["from"]}"]'
                )
                check("v16-explorer-selected-terminal-aria-synced",
                      explorer.get_attribute("data-explorer-selected-terminal")
                          == first_reference_wire["from"]
                      and selected_terminal_nodes.count() >= 2
                      and all(
                          selected_terminal_nodes.nth(index).get_attribute("aria-pressed") == "true"
                          for index in range(selected_terminal_nodes.count())
                      )
                      and explorer.locator(
                          f'[data-explorer-terminal="{first_reference_wire["from"]}"][data-selected="true"]'
                      ).count() >= 1,
                      json.dumps({
                          "selectedTerminal": explorer.get_attribute(
                              "data-explorer-selected-terminal"),
                          "representations": selected_terminal_nodes.count(),
                      }, ensure_ascii=False))
                cancel_pending = page.locator("#labCancelPendingWire")
                cancel_pending_rect = cancel_pending.bounding_box()
                check("vnext-3d-pending-wire-native-cancel-armed-accessible",
                      cancel_pending.is_enabled()
                      and cancel_pending_rect is not None
                      and cancel_pending_rect["width"] >= 44
                      and cancel_pending_rect["height"] >= 44
                      and cancel_pending.get_attribute("aria-describedby") == "labSelectedTerminal"
                      and first_reference_wire["from"] in
                          (cancel_pending.get_attribute("aria-label") or "")
                      and page.locator("#labEditor").get_attribute(
                          "data-lab-pending-terminal") == first_reference_wire["from"]
                      and canvas.get_attribute("data-lab-wire-count") == "0")
                cancel_pending.focus()
                cancel_pending.press("Enter")
                check("vnext-3d-pending-wire-native-cancel-no-graph-mutation",
                      cancel_pending.is_disabled()
                      and page.locator("#labEditor").get_attribute("data-lab-pending-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-terminal") == ""
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and explorer.get_attribute("data-explorer-selected-terminal") in ("", None)
                      and "hủy chọn chân đầu tiên" in page.locator(
                          "#labSelectedTerminal").inner_text().lower())
                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["from"]}"]'
                ).locator("circle").click()
                page.locator("#labFromPin").focus()
                page.keyboard.press("Escape")
                check("vnext-3d-pending-wire-escape-cancels-not-connection",
                      cancel_pending.is_disabled()
                      and canvas.get_attribute("data-lab-pending-wire-terminal") == ""
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and page.evaluate("document.activeElement?.id") == "labFromPin"
                      and explorer.get_attribute("data-explorer-selected-terminal") in ("", None))
                # Restore an intentional first-terminal click so the historical
                # next SVG action still proves canonical two-terminal connection.
                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["from"]}"]'
                ).locator("circle").click()
                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["to"]}"]'
                ).locator("circle").click()
                learner_wire_list = explorer.locator(
                    '[data-explorer-panel="schematic"] .lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                )
                check("v16-explorer-svg-action-uses-canonical-router",
                      first_reference_wire["from"] in svg_first_terminal_note
                      and explorer.get_attribute("data-explorer-source") == "learner-draft"
                      and learner_wire_list.count() == 1
                      and canvas.get_attribute("data-lab-wire-count") == "1"
                      and canvas.get_attribute("data-lab-pending-wire-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-hover-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-preview") == "none"
                      and explorer.locator(".lab-explorer-schematic-svg [data-explorer-reference-wire]").count()
                          == lesson2_reference_count,
                      json.dumps({
                          "edge": first_reference_wire,
                          "firstTerminalNote": svg_first_terminal_note,
                          "learnerWires": learner_wire_list.count(),
                          "sceneWires": canvas.get_attribute("data-lab-wire-count"),
                          "referenceWires": explorer.locator(
                              ".lab-explorer-schematic-svg [data-explorer-reference-wire]").count(),
                      }, ensure_ascii=False))
                page.locator("#stageTabWiring").click()
                check("v16-explorer-canonical-wire-syncs-existing-2d-workbench",
                      page.locator(".wire-connected").count() == 1
                      and first_reference_wire["from"] in page.locator(".wire-connected").first.inner_text()
                      and first_reference_wire["to"] in page.locator(".wire-connected").first.inner_text())
                page.locator("#stageTab3d").click()

                # Keyboard activation must survive Explorer rerender and update
                # the same editor/scene selection. Focus may move to another
                # equivalent action with the same semantic focus token.
                breadboard_action = explorer.locator(
                    '[data-explorer-panel="minimap"] .lab-explorer-minimap-svg '
                    '[data-explorer-component="breadboard"][data-explorer-focus="breadboard"]'
                )
                breadboard_action.focus()
                breadboard_action.press("Enter")
                check("v16-explorer-keyboard-focus-selection-sync",
                      page.locator("#labComponent").input_value() == "breadboard"
                      and canvas.get_attribute("data-lab-selected-component") == "breadboard"
                      and canvas.get_attribute("data-lab-focused-component") == "breadboard"
                      and page.evaluate(
                          "document.activeElement?.getAttribute('data-explorer-focus') === 'breadboard'"
                      )
                      and not page.locator("#labPlace").is_disabled()
                      and "breadboard" in explorer.locator(".lab-explorer-component-title").inner_text().lower(),
                      json.dumps({
                          "selected": canvas.get_attribute("data-lab-selected-component"),
                          "focused": canvas.get_attribute("data-lab-focused-component"),
                          "activeFocus": page.evaluate(
                              "document.activeElement?.getAttribute('data-explorer-focus')"),
                      }, ensure_ascii=False))

                explorer.locator("[data-explorer-disconnect]").first.click()
                learner_wire_list = explorer.locator(
                    '[data-explorer-panel="schematic"] .lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                )
                check("v16-explorer-disconnect-canonical-path",
                      learner_wire_list.count() == 0
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and explorer.locator(".lab-explorer-schematic-svg [data-explorer-reference-wire]").count()
                          == lesson2_reference_count)
                # Canonical mutation must clear a half-completed two-terminal
                # gesture, otherwise the next click could connect from stale UI.
                explorer.locator("[data-explorer-connect-from]").select_option(
                    first_reference_wire["from"])
                explorer.locator("[data-explorer-connect-to]").select_option(
                    first_reference_wire["to"])
                explorer.locator("[data-explorer-connect]").click()
                explorer.locator(
                    f'.lab-explorer-schematic-svg [data-explorer-terminal="{first_reference_wire["from"]}"]'
                ).locator("circle").click()
                stale_terminal_precondition = (
                    explorer.get_attribute("data-explorer-selected-terminal")
                    == first_reference_wire["from"]
                )
                explorer.locator("[data-explorer-disconnect]").first.click()
                selected_after_canonical = explorer.locator(
                    f'[data-explorer-terminal="{first_reference_wire["from"]}"]'
                )
                check("v16-explorer-canonical-mutation-clears-stale-terminal",
                      stale_terminal_precondition
                      and explorer.get_attribute("data-explorer-selected-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-hover-terminal") == ""
                      and canvas.get_attribute("data-lab-pending-wire-preview") == "none"
                      and explorer.locator(
                          "[data-explorer-selected-terminal-status='none']").count() == 1
                      and all(
                          selected_after_canonical.nth(index).get_attribute("aria-pressed") == "false"
                          for index in range(selected_after_canonical.count())
                      )
                      and "hủy chọn chân đầu tiên" in
                          page.locator("#labSelectedTerminal").inner_text().lower(),
                      json.dumps({
                          "selected": explorer.get_attribute(
                              "data-explorer-selected-terminal"),
                          "note": page.locator("#labSelectedTerminal").inner_text(),
                      }, ensure_ascii=False))

                # Reference overlay is view-local state and must not leak across
                # lesson switches even when both lessons have reference samples.
                if reference_toggle.get_attribute("aria-pressed") != "true":
                    explorer.locator("[data-explorer-reference-toggle]").click()
                page.locator('.lesson-link[data-lesson="3"]').click()
                explorer = page.locator("#labExplorer .lab-explorer")
                check("v16-explorer-reference-overlay-resets-on-lesson-switch",
                      explorer.get_attribute("data-lesson-id") == "3"
                      and explorer.locator("[data-explorer-reference-toggle]").get_attribute(
                          "aria-pressed") == "false"
                      and explorer.locator("[data-explorer-reference-view='off']").count() == 1
                      and explorer.locator("[data-explorer-reference-wire]").count() == 0,
                      json.dumps({
                          "lesson": explorer.get_attribute("data-lesson-id"),
                          "pressed": explorer.locator(
                              "[data-explorer-reference-toggle]").get_attribute("aria-pressed"),
                          "referenceWires": explorer.locator(
                              "[data-explorer-reference-wire]").count(),
                      }, ensure_ascii=False))
                page.locator('.lesson-link[data-lesson="2"]').click()
                explorer = page.locator("#labExplorer .lab-explorer")

                for lesson_id in (10, 14):
                    page.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                    explorer = page.locator("#labExplorer .lab-explorer")
                    explorer.locator("[data-explorer-reference-toggle]").click()
                    sample_count = page.evaluate(
                        f"() => import('./src/circuit-router.js').then(m => m.createSampleCircuit({lesson_id}).wires.length)"
                    )
                    page.locator("#stageTabWiring").click()
                    check(f"v16-explorer-{lesson_id:02d}-signal-only-reference-fail-closed",
                          explorer.get_attribute("data-explorer-scope") == "signal-only"
                          and explorer.locator(".lab-explorer-signal-boundary").count() == 1
                          and explorer.locator(".lab-explorer-schematic-svg [data-explorer-reference-wire]").count()
                              == sample_count
                          and explorer.locator(
                              ".lab-explorer-schematic-svg [data-explorer-wire]").count() == 0
                          and page.locator(".wire-activate").is_disabled()
                          and page.locator(".wire-activate").get_attribute("aria-pressed") == "false",
                          json.dumps({
                              "lesson": lesson_id,
                              "scope": explorer.get_attribute("data-explorer-scope"),
                              "referenceWires": explorer.locator(
                                  ".lab-explorer-schematic-svg [data-explorer-reference-wire]").count(),
                              "sampleWires": sample_count,
                          }, ensure_ascii=False))
                    page.locator("#stageTab3d").click()

                # Breadboard Study is a separate profile explorer. Exercise the
                # user-visible semantics while a real learner wire exists, then
                # prove none of these queries mutate 2D/3D canonical netlist.
                page.locator('.lesson-link[data-lesson="2"]').click()
                explorer = page.locator("#labExplorer .lab-explorer")
                explorer.locator(
                    '[data-explorer-panel="minimap"] .lab-explorer-minimap-svg '
                    '[data-explorer-component="arduino"]'
                ).click()
                page.locator("#labEditToggle").click()
                explorer.locator("[data-explorer-connect-from]").select_option(first_reference_wire["from"])
                explorer.locator("[data-explorer-connect-to]").select_option(first_reference_wire["to"])
                explorer.locator("[data-explorer-connect]").click()
                page.locator("#infoTabPractice").click()
                check("post-v16-explorer-real-canonical-wire-records-session-event-not-mastery",
                      "connect-wire" in page.locator(
                          "#learningCoach [data-practice-observation] "
                          "[data-observation-recorded]").inner_text()
                      and "không đo mastery" in page.locator(
                          "#learningCoach [data-observation-boundary]").inner_text()
                      and page.locator("#completeButton").is_hidden()
                      and explorer.locator(
                          '[data-explorer-panel="schematic"] '
                          '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                      ).count() == 1)
                page.locator("#infoTabOverview").click()
                canvas = page.locator("#sceneMount canvas")
                before_study_scene_wires = canvas.get_attribute("data-lab-wire-count")
                page.locator("#stageTabWiring").click()
                before_study_2d_wires = page.locator(".wire-connected").count()
                page.locator("#stageTab3d").click()

                page.locator("#bbProfile").select_option("generic-63x10-terminal-strips")
                page.locator("#bbHoleA").fill("A1")
                page.locator("#bbHoleB").fill("E1")
                page.locator("#bbCompare").click()
                check("v16-breadboard-study-generic-same-five-hole-strip",
                      page.locator("#bbResult").get_attribute("data-result") == "connected"
                      and page.locator('#bbTopologyDiagram [data-bb-strip-node="strip:1:left"]').count() == 1
                      and page.locator('#bbTopologyDiagram [data-bb-hole="A1"][data-bb-selected]').count() == 1
                      and page.locator('#bbTopologyDiagram [data-bb-hole="E1"][data-bb-selected]').count() == 1
                      and page.locator("#bbTopologyDiagram").get_attribute("data-profile")
                          == "generic-63x10-terminal-strips"
                      and "cùng nhóm tiếp xúc" in page.locator("#bbResult").inner_text()
                      and "không phải đo mạch thực" in page.locator("#bbResult").inner_text())
                page.locator("#bbHoleB").fill("F1")
                page.locator("#bbCompare").click()
                check("v16-breadboard-study-generic-center-gap-separate",
                      page.locator("#bbResult").get_attribute("data-result") == "separate"
                      and page.locator('#bbTopologyDiagram [data-bb-strip-node="strip:1:left"]').count() == 1
                      and page.locator('#bbTopologyDiagram [data-bb-strip-node="strip:1:right"]').count() == 1
                      and "hai nhóm tiếp xúc khác nhau" in page.locator("#bbResult").inner_text()
                      and "jumper hoặc netlist bên ngoài không được kiểm tra" in
                          page.locator("#bbResult").inner_text())
                page.locator("#bbHoleA").fill("P1+1")
                page.locator("#bbHoleB").fill("P1+50")
                page.locator("#bbCompare").click()
                check("v16-breadboard-study-generic-rail-remains-unknown",
                      page.locator("#bbResult").get_attribute("data-result") == "unknown"
                      and "chưa đủ bằng chứng" in page.locator("#bbResult").inner_text().lower()
                      and "không kết luận đã nối hay chưa nối" in
                          page.locator("#bbResult").inner_text().lower()
                      and "nhóm rail chưa được mô hình hóa" in
                          page.locator("#bbTopologyDiagram").inner_text().lower()
                      and "không suy chúng liên thông" in
                          page.locator("#bbTopologyDiagram").inner_text().lower())
                page.locator("#bbProfile").select_option("busboard-bb830-rev7")
                page.locator("#bbCompare").click()
                check("v16-breadboard-study-bb830-rail-profile-connected",
                      page.locator("#bbResult").get_attribute("data-result") == "connected"
                      and page.locator("#bbTopologyDiagram").get_attribute("data-profile")
                          == "busboard-bb830-rev7"
                      and "cùng nhóm tiếp xúc" in page.locator("#bbResult").inner_text()
                      and "không phải đo mạch thực" in page.locator("#bbResult").inner_text()
                      # BB830's manufacturer-backed four 50-hole rails are
                      # separate rail nodes but each is continuous end-to-end.
                      # Never collapse this into a generic unknown/split rail.
                      and "4 rail riêng biệt" in
                          page.locator("#bbTopologyDiagram").inner_text().lower()
                      and "dải liên tục 50 lỗ" in
                          page.locator("#bbTopologyDiagram").inner_text().lower()
                      and "profile đã xác minh" in
                          page.locator("#bbTopologyDiagram").inner_text().lower())
                for bad_hole in ("Z999", "A0"):
                    page.locator("#bbHoleA").fill(bad_hole)
                    page.locator("#bbHoleB").fill("A1")
                    page.locator("#bbCompare").click()
                    check(f"v16-breadboard-study-malformed-{bad_hole.lower()}-fails",
                          page.locator("#bbResult").get_attribute("data-result") == "error"
                          and "Không thể đối chiếu" in page.locator("#bbResult").inner_text())
                check("v16-breadboard-study-conceptual-unmapped-disclosure",
                      page.locator("#bbMappingWarning").get_attribute("data-mapped") == "false"
                      and "conceptual" in page.locator("#bbMappingWarning").inner_text().lower()
                      and page.locator("#bbTopologyDiagram").get_attribute("role") == "img"
                      and "không phải" in
                          (page.locator("#bbTopologyDiagram").get_attribute("aria-label") or "").lower()
                      and page.locator("#bbTopologyDiagram [data-bb-diagram='conceptual-strips']").count() == 1)
                page.locator("#bbProfile").select_option("generic-63x10-terminal-strips")
                # The historical malformed-hole negatives immediately above
                # intentionally leave bbHoleA=A0. Restore two known same-node
                # inputs before asking the new contact explorer to compare
                # against A and B; never downgrade the comparison assertions.
                page.locator("#bbHoleA").fill("A1")
                page.locator("#bbHoleB").fill("E1")
                grid_holes = page.locator("#bbHoleGrid .breadboard-hole-grid-button")
                grid_columns = page.locator("#bbHoleGrid [data-bb-grid-column]")
                check("post-v16-breadboard-hole-picker-eight-column-page-is-input-only",
                      page.locator("#bbHoleGrid").get_attribute("data-state") == "ready"
                      and page.locator("#bbHoleGrid").get_attribute("data-page") == "1"
                      and page.locator("#bbGridPage").get_attribute("data-page") == "1"
                      and page.locator("#bbGridPage").get_attribute("data-page-count") == "8"
                      and grid_columns.count() == 8
                      and grid_holes.count() == 80
                      and page.locator('#bbHoleGrid [data-bb-grid-column="1"]').count() == 1
                      and page.locator('#bbHoleGrid [data-bb-grid-column="8"]').count() == 1
                      and page.locator("#bbGridPrev").is_disabled()
                      and not page.locator("#bbGridNext").is_disabled()
                      and page.locator("#bbGridRail").is_disabled()
                      and page.locator("#bbGridRailHole").is_disabled()
                      and page.locator("#bbPickRail").is_disabled(),
                      json.dumps({
                          "columns": grid_columns.count(),
                          "holes": grid_holes.count(),
                          "page": page.locator("#bbGridPage").inner_text(),
                          "railDisabled": page.locator("#bbPickRail").is_disabled(),
                      }, ensure_ascii=False))
                first_grid_hole = page.locator('#bbHoleGrid [data-bb-grid-hole="A1"]')
                first_grid_hole.focus()
                first_grid_hole.press("Enter")
                check("post-v16-breadboard-hole-picker-keyboard-select-does-not-place-or-wire",
                      page.locator("#bbPlaceHole").input_value() == "A1"
                      and first_grid_hole.get_attribute("aria-pressed") == "true"
                      and page.locator("#bbGridStatus").get_attribute("data-result") == "selected"
                      and "chưa tạo placement" in page.locator("#bbGridStatus").inner_text().lower()
                      and page.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires,
                      page.locator("#bbGridStatus").inner_text())
                contact_members = page.locator(
                    '#bbHoleGrid [data-bb-contact-member="true"]')
                contact_member_holes = sorted(contact_members.evaluate_all(
                    "nodes => nodes.map(node => node.dataset.bbGridHole)"))
                check("vnext-breadboard-contact-five-hole-node-center-gap-boundary",
                      page.locator("#bbHoleGrid").get_attribute("data-bb-contact-state") == "known"
                      and page.locator("#bbHoleGrid").get_attribute("data-bb-contact-hole") == "A1"
                      and page.locator("#bbHoleGrid").get_attribute("data-bb-contact-node") != ""
                      and contact_member_holes == ["A1", "B1", "C1", "D1", "E1"]
                      and page.locator('#bbHoleGrid [data-bb-grid-hole="A1"]').get_attribute(
                          "data-bb-contact-selected") == "true"
                      and page.locator('#bbHoleGrid [data-bb-grid-hole="F1"]').get_attribute(
                          "data-bb-contact-member") is None
                      and page.locator('#bbHoleGrid [data-bb-contact-boundary="center-gap"]').count() == 1
                      and page.locator("#bbGridStatus").get_attribute("data-bb-contact-compare-a") == "same-node"
                      and page.locator("#bbGridStatus").get_attribute("data-bb-contact-compare-b") == "same-node"
                      and "provenance" in page.locator("#bbGridStatus").inner_text().lower()
                      and page.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires,
                      json.dumps({
                          "members": contact_member_holes,
                          "node": page.locator("#bbHoleGrid").get_attribute("data-bb-contact-node"),
                          "status": page.locator("#bbGridStatus").inner_text()[:280],
                      }, ensure_ascii=False))
                page.locator("#bbGridNext").focus()
                page.locator("#bbGridNext").press("Enter")
                check("post-v16-breadboard-hole-picker-page-navigation-bounded",
                      page.locator("#bbHoleGrid").get_attribute("data-page") == "2"
                      and page.locator("#bbGridPage").get_attribute("data-page") == "2"
                      and page.locator("#bbHoleGrid [data-bb-grid-column='9']").count() == 1
                      and page.locator("#bbHoleGrid [data-bb-grid-column='16']").count() == 1
                      and page.locator("#bbHoleGrid .breadboard-hole-grid-button").count() == 80
                      and not page.locator("#bbGridPrev").is_disabled())
                page.locator("#bbGridPrev").press("Enter")
                check("post-v16-breadboard-hole-picker-prev-restores-first-page",
                      page.locator("#bbHoleGrid").get_attribute("data-page") == "1"
                      and page.locator("#bbGridPrev").is_disabled()
                      and page.locator("#bbPlaceHole").input_value() == "A1")
                page.locator("#bbTerminal").select_option("D13")
                page.locator("#bbPlaceHole").fill("a12")
                page.locator("#bbAssignHole").click()
                check("post-v16-breadboard-authored-hole-ui-canonical-session-only",
                      page.locator("#bbPlaceHole").input_value() == "A12"
                      and page.locator("#bbPlaceHole").get_attribute("aria-invalid") == "false"
                      and page.locator("#bbPlacementStatus").get_attribute("data-result") == "assigned"
                      and "D13 → A12" in page.locator("#bbPlacedList").inner_text()
                      and "không tạo dây circuit-router" in page.locator("#bbPlacementStatus").inner_text()
                      and page.locator("#bbMappingWarning").get_attribute("data-mapped") == "session-authored"
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires,
                      page.locator("#bbPlacementStatus").inner_text())
                page.locator("#bbTerminal").select_option("R1:A")
                page.locator("#bbPlaceHole").fill("P1+1")
                page.locator("#bbAssignHole").click()
                check("post-v16-breadboard-authored-generic-unknown-rail-fails-closed",
                      page.locator("#bbPlacementStatus").get_attribute("data-result") == "error"
                      and page.locator("#bbPlaceHole").get_attribute("aria-invalid") == "true"
                      and "D13 → A12" in page.locator("#bbPlacedList").inner_text()
                      and "R1:A →" not in page.locator("#bbPlacedList").inner_text()
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires,
                      page.locator("#bbPlacementStatus").inner_text())
                page.locator("#bbProfile").select_option("busboard-bb830-rev7")
                check("post-v16-breadboard-authored-profile-change-resets-draft",
                      page.locator("#bbPlacementStatus").get_attribute("data-result") == "reset"
                      and page.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                      and page.locator("#bbPlacedList [data-bb-placement-empty]").count() == 1
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires)
                page.locator("#bbGridRail").select_option("P1+")
                page.locator("#bbGridRailHole").fill("1")
                page.locator("#bbPickRail").focus()
                page.locator("#bbPickRail").press("Enter")
                check("post-v16-breadboard-bb830-rail-picker-selects-input-without-placement",
                      page.locator("#bbGridRail option").count() == 4
                      and page.locator("#bbPlaceHole").input_value() == "P1+1"
                      and page.locator("#bbGridStatus").get_attribute("data-result") == "selected"
                      and "chưa tạo placement" in page.locator("#bbGridStatus").inner_text().lower()
                      and page.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires,
                      page.locator("#bbGridStatus").inner_text())
                page.locator("#bbTerminal").select_option("D13")
                page.locator("#bbPlaceHole").fill("P1+1")
                page.locator("#bbAssignHole").click()
                page.locator("#bbTerminal").select_option("R1:A")
                page.locator("#bbPlaceHole").fill("P1+50")
                page.locator("#bbAssignHole").click()
                check("post-v16-breadboard-authored-bb830-known-rail-profile",
                      page.locator("#bbPlacementStatus").get_attribute("data-result") == "assigned"
                      and "D13 → P1+1" in page.locator("#bbPlacedList").inner_text()
                      and "R1:A → P1+50" in page.locator("#bbPlacedList").inner_text()
                      and page.locator("#bbPlacedList [data-bb-placement-item]").count() == 2
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires)
                page.locator('.lesson-link[data-lesson="3"]').click()
                check("post-v16-breadboard-authored-lesson-change-resets-and-refreshes-terminals",
                      page.locator("#bbPlacementStatus").get_attribute("data-result") == "reset"
                      and page.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                      and page.locator("#bbTerminal option").count() == page.evaluate(
                          "() => import('./src/circuit-router.js').then(m => m.listTerminals(3).length)"
                      )
                      and canvas.get_attribute("data-lab-wire-count") == "0")
                page.locator('.lesson-link[data-lesson="1"]').click()
                check("post-v16-breadboard-authored-lesson01-integrated-led-disables-controls",
                      page.locator("#bbTerminal").is_disabled()
                      and page.locator("#bbPlaceHole").is_disabled()
                      and page.locator("#bbAssignHole").is_disabled()
                      and page.locator("#bbRemoveHole").is_disabled()
                      and page.locator("#bbPlacementStatus").get_attribute("data-result") == "disabled"
                      and "LED L tích hợp" in page.locator("#bbPlacementStatus").inner_text())
                page.locator('.lesson-link[data-lesson="2"]').click()
                # The added authored-hole regressions switch lessons 02 -> 03
                # -> 01 -> 02. A lesson switch deliberately exits 3D edit mode,
                # so the conceptual 3D overlay is hidden even though the learner
                # netlist persists. First prove the graph is intact while the
                # editor is off, then explicitly re-enable it to restore the
                # historical 3D/2D parity precondition; never pretend a scene
                # overlay is an electrical source or silently enable editing.
                check("post-v16-breadboard-lesson-switch-preserves-learner-graph-viewonly",
                      page.locator("#labEditToggle").get_attribute("aria-pressed") == "false"
                      and canvas.get_attribute("data-lab-wire-count") == "0"
                      and explorer.locator(
                          '[data-explorer-panel="schematic"] '
                          '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                      ).count() == 1)
                page.locator("#labEditToggle").click()
                check("post-v16-breadboard-explicit-3d-editor-restores-same-learner-graph",
                      page.locator("#labEditToggle").get_attribute("aria-pressed") == "true"
                      and canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires
                      and canvas.get_attribute("data-lab-wire-count") == "1")
                check("v16-breadboard-study-never-mutates-canonical-netlist",
                      canvas.get_attribute("data-lab-wire-count") == before_study_scene_wires
                      and explorer.locator(
                          '[data-explorer-panel="schematic"] '
                          '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                      ).count() == 1)
                page.locator("#stageTabWiring").click()
                check("v16-breadboard-study-never-mutates-existing-2d-netlist",
                      page.locator(".wire-connected").count() == before_study_2d_wires
                      and before_study_2d_wires == 1)
                page.locator("#stageTab3d").click()

                # The standalone resistor study consumes only explicit ideal
                # values. It must neither read nor mutate the lesson graph, AVR
                # state, Serial log, breadboard study, or 3D scene.
                canvas = page.locator("#sceneMount canvas")
                explorer = page.locator("#labExplorer .lab-explorer")
                resistive_before = {
                    "sceneWires": canvas.get_attribute("data-lab-wire-count"),
                    "learnerWires": explorer.locator(
                        '[data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    ).count(),
                    "avrStatus": page.locator("#avrStatus").inner_text(),
                    "avrProvenance": page.locator("#avrProvenance").inner_text(),
                    "serial": page.locator("#serialConsole").inner_text(),
                }
                page.locator("#resistiveV").fill("5")
                page.locator("#resistiveR1").fill("1000")
                page.locator("#resistiveR2").fill("1000")
                page.locator("#resistiveSolve").click()
                resistive_rows = page.locator("#resistiveDetails tbody tr").all_inner_texts()
                check("v16-resistive-study-default-divider-math",
                      page.locator("#resistiveResult").get_attribute("data-result") == "calculated"
                      and ("2,5 V" in page.locator("#resistiveResult").inner_text()
                           or "2.5 V" in page.locator("#resistiveResult").inner_text())
                      and len(resistive_rows) == 2
                      and all(("2,5" in row or "2.5" in row) for row in resistive_rows)
                      and all(("6,25" in row or "6.25" in row) for row in resistive_rows)
                      and "ideal-dc-resistor-model" in page.locator("#resistiveDetails").inner_text(),
                      json.dumps({
                          "status": page.locator("#resistiveResult").inner_text(),
                          "rows": resistive_rows,
                      }, ensure_ascii=False))
                resistive_visual = page.locator("#resistiveDetails [data-resistive-presentation='verified']")
                resistive_svg = resistive_visual.locator("[data-resistive-divider-visual] svg")
                resistive_assumptions = resistive_visual.locator("[data-resistive-assumptions]").inner_text()
                check("post-v16-resistive-visual-divider-source-verified-presentation",
                      resistive_visual.get_attribute("data-resistive-origin") == "ideal-dc-resistor-model"
                      and resistive_svg.get_attribute("role") == "img"
                      and all(token in (resistive_svg.get_attribute("aria-label") or "")
                              for token in ("VCC", "R1", "MID", "R2", "GND"))
                      and ("2,5 V" in (resistive_svg.get_attribute("aria-label") or "")
                           or "2.5 V" in (resistive_svg.get_attribute("aria-label") or ""))
                      and page.locator("#resistiveDetails [data-resistive-divider-table]").count() == 1
                      and len(resistive_rows) == 2
                      and "nguồn DC lý tưởng do người học khai báo" in resistive_assumptions
                      and "kết quả toán học của solver" in resistive_assumptions
                      and "không phải phần cứng Arduino hoặc phép đo" in resistive_assumptions,
                      json.dumps({
                          "origin": resistive_visual.get_attribute("data-resistive-origin"),
                          "svgRole": resistive_svg.get_attribute("role"),
                          "svgName": resistive_svg.get_attribute("aria-label"),
                          "assumptions": resistive_assumptions,
                      }, ensure_ascii=False))
                page.locator("#resistiveR1").fill("0")
                page.locator("#resistiveSolve").click()
                check("v16-resistive-study-zero-resistance-fails-without-stale-output",
                      page.locator("#resistiveResult").get_attribute("data-result") == "error"
                      and page.locator("#resistiveDetails").locator("*").count() == 0
                      and "bị từ chối" in page.locator("#resistiveResult").inner_text()
                      and "2,5 V" not in page.locator("#resistiveResult").inner_text()
                      and "6,25" not in page.locator("#resistiveResult").inner_text(),
                      page.locator("#resistiveResult").inner_text())
                page.locator("#resistiveR1").fill("1000")
                page.locator("#resistiveV").fill("6")
                page.locator("#resistiveSolve").click()
                check("v16-resistive-study-over-5v-fails-without-stale-output",
                      page.locator("#resistiveResult").get_attribute("data-result") == "error"
                      and page.locator("#resistiveDetails").locator("*").count() == 0
                      and "bị từ chối" in page.locator("#resistiveResult").inner_text()
                      and "2,5 V" not in page.locator("#resistiveResult").inner_text()
                      and "6,25" not in page.locator("#resistiveResult").inner_text(),
                      page.locator("#resistiveResult").inner_text())
                resistive_after = {
                    "sceneWires": canvas.get_attribute("data-lab-wire-count"),
                    "learnerWires": explorer.locator(
                        '[data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    ).count(),
                    "avrStatus": page.locator("#avrStatus").inner_text(),
                    "avrProvenance": page.locator("#avrProvenance").inner_text(),
                    "serial": page.locator("#serialConsole").inner_text(),
                }
                check("v16-resistive-study-independent-of-lesson-avr-serial",
                      resistive_after == resistive_before,
                      json.dumps({
                          "before": resistive_before,
                          "after": resistive_after,
                      }, ensure_ascii=False))
                page.locator("#stageTabWiring").click()
                check("v16-resistive-study-never-mutates-existing-2d-netlist",
                      page.locator(".wire-connected").count() == before_study_2d_wires
                      and before_study_2d_wires == 1)
                page.locator("#stageTab3d").click()

                # The v1.5 editor tests deliberately mutate lesson-local circuit
                # drafts for 02/10/14/16. Reload the same source page before the
                # untouched v1.4 regression block so those legacy assertions run
                # against their original clean in-memory baseline. This is test
                # isolation only; no app storage/account state is written here.
                page.reload(wait_until="domcontentloaded", timeout=20000)
                ready(page)

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
                progress_before_sketch_review = page.locator("#progressText").inner_text()
                check("avr-panel-follows-lesson",
                      "bài 03" in page.locator("#avrLoad").inner_text()
                      and "Chưa nạp HEX bài 03" in page.locator("#avrStatus").inner_text())
                check("post-v16-sketch-review-starts-from-reference",
                      page.locator("#sketchReviewMount [data-sketch-review]").get_attribute(
                          "data-sketch-review-lesson") == "3"
                      and page.locator("#sketchReviewMount [data-sketch-review]").get_attribute(
                          "data-sketch-review-status") == "reference"
                      and "không biên dịch Arduino C++" in page.locator(
                          "#sketchReviewMount [data-sketch-review-boundary]").inner_text())
                page.locator("#editCode").click()
                page.locator("#codeEditor").fill("void setup() {}\nvoid loop() {}\n")
                check("edit-is-explicitly-draft",
                      "Mã đã sửa" in page.locator("#codeEditStatus").inner_text())
                check("post-v16-sketch-review-edited-draft-never-completes-lesson",
                      page.locator("#sketchReviewMount [data-sketch-review]").get_attribute(
                          "data-sketch-review-status") == "changed"
                      and int(page.locator(
                          "#sketchReviewMount [data-sketch-review]").get_attribute(
                              "data-sketch-review-changed-lines") or "0") > 0
                      and page.locator("#progressText").inner_text() == progress_before_sketch_review
                      and page.locator("#completeButton").is_hidden())
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
                check("post-v16-sketch-review-restore-reference-no-progress-side-effect",
                      page.locator("#sketchReviewMount [data-sketch-review]").get_attribute(
                          "data-sketch-review-status") == "reference"
                      and page.locator("#progressText").inner_text() == progress_before_sketch_review)
                check("avr-panel-restored-sample-disclosure",
                      "Mã đã sửa" not in page.locator("#avrDraftNote").inner_text()
                      and "mã mẫu" in page.locator("#avrDraftNote").inner_text())

                # Wiring editor: incomplete circuit blocks custom simulation.
                page.locator('.stage-tabs [data-stage="wiring"]').click()
                check("wiring-terminal-controls", page.locator("[data-terminal]").count() == 12)
                check("wiring-missing-disabled",
                      page.locator(".wire-activate").is_disabled())
                # OS/browser pointer cancellation must never finalize a wire,
                # even when the cancellation coordinates overlap a valid pin.
                canceled_touch = page.evaluate("""() => {
                    const from=document.querySelector('[data-terminal="D13"]');
                    const to=document.querySelector('[data-terminal="R_LED:A"]');
                    const rect=node=>node.getBoundingClientRect();
                    const center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
                    const first=center(rect(from)),second=center(rect(to));
                    const opts=(type,point,pointerId)=>new PointerEvent(type,{
                      bubbles:true,cancelable:true,pointerId,pointerType:'touch',
                      button:0,clientX:point.x,clientY:point.y
                    });
                    const target=document.elementFromPoint(second.x,second.y)?.closest('[data-terminal]')?.dataset.terminal;
                    from.dispatchEvent(opts('pointerdown',first,1881));
                    window.dispatchEvent(opts('pointermove',second,1881));
                    window.dispatchEvent(opts('pointercancel',second,1881));
                    return {from:'D13',to:'R_LED:A',target};
                }""")
                check("v15-2d-pointercancel-never-commits-a-wire",
                      canceled_touch["target"] == "R_LED:A"
                      and page.locator(".wire-connected").count() == 0
                      and page.locator(".wire-activate").is_disabled(),
                      json.dumps(canceled_touch,ensure_ascii=False))
                page.wait_for_timeout(20)
                page.evaluate("""() => {
                    const from=document.querySelector('[data-terminal="D13"]');
                    const to=document.querySelector('[data-terminal="R_LED:A"]');
                    const center=node=>{const r=node.getBoundingClientRect();
                      return {x:r.left+r.width/2,y:r.top+r.height/2};};
                    const first=center(from),second=center(to);
                    const event=(type,point,id)=>new PointerEvent(type,{
                      bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',
                      button:0,clientX:point.x,clientY:point.y
                    });
                    from.dispatchEvent(event('pointerdown',first,1891));
                    window.dispatchEvent(event('pointermove',second,1892));
                    window.dispatchEvent(event('pointerup',second,1892));
                    window.dispatchEvent(event('pointercancel',second,1891));
                }""")
                check("v15-2d-other-pointer-cannot-complete-wire",
                      page.locator(".wire-connected").count() == 0)
                page.wait_for_timeout(20)
                page.evaluate("""() => {
                    const from=document.querySelector('[data-terminal="D13"]');
                    const to=document.querySelector('[data-terminal="R_LED:A"]');
                    const center=node=>{const r=node.getBoundingClientRect();
                      return {x:r.left+r.width/2,y:r.top+r.height/2};};
                    const first=center(from),second=center(to);
                    const event=(type,point)=>new PointerEvent(type,{
                      bubbles:true,cancelable:true,pointerId:1882,pointerType:'touch',
                      button:0,clientX:point.x,clientY:point.y
                    });
                    from.dispatchEvent(event('pointerdown',first));
                    window.dispatchEvent(event('pointermove',second));
                    window.dispatchEvent(event('pointerup',second));
                }""")
                check("v15-2d-valid-pointerup-commits-exactly-one-wire",
                      page.locator(".wire-connected").count() == 1)
                page.locator(".wire-actions .wire-action").nth(1).click()
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
                check("v15-2d-invalid-wire-revokes-activation",
                      page.locator(".wire-activate").get_attribute("aria-pressed") == "false"
                      and page.locator(".wire-inactive").is_hidden()
                      and "chưa kích hoạt" in page.locator("#electricalResult").inner_text())
                page.locator("#runButton").click()
                check("invalid-wire-blocks-restart",
                      "Đang dừng" in page.locator("#runStatus").inner_text())
                page.locator(".wire-actions .wire-action").first.click()
                check("v15-2d-repair-does-not-reenable-active-circuit",
                      page.locator(".wire-activate").get_attribute("aria-pressed") == "false"
                      and not page.locator(".wire-activate").is_disabled())
                page.locator("#runButton").click()
                check("repaired-wire-can-run", "Đang chạy" in page.locator("#runStatus").inner_text())
                check("v15-reference-until-explicit-learner-reactivation",
                      "mạch tự đấu hợp lệ" not in page.locator("#simOutput").inner_text())
                page.locator("#runButton").click()
                page.locator(".wire-activate").click()
                page.locator("#runButton").click()
                check("v15-learner-reactivation-restores-checked-mode",
                      page.locator(".wire-activate").get_attribute("aria-pressed") == "true"
                      and "mạch tự đấu hợp lệ" in page.locator("#simOutput").inner_text())
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

                # All 15 lesson netlists are browseable. Motor/pump lessons
                # 10/14 intentionally expose reference SIGNAL topology only,
                # and must not activate an unmodeled power/load circuit.
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
                    if lesson_id in (10, 14):
                        check(f"wiring-{lesson_id:02d}-signal-only-reference",
                              page.locator(".wire-activate").is_disabled()
                              and page.locator(".wire-connected").count() >= 4
                              and "dây tín hiệu tham khảo" in page.locator(".wire-status").inner_text()
                              and "không phải mạch hoàn chỉnh" in page.locator(".wire-status").inner_text())
                        check(f"wiring-{lesson_id:02d}-motor-pump-custom-activation-blocked",
                              page.locator(".wire-activate").is_disabled()
                              and page.locator(".wire-activate").get_attribute("aria-pressed") == "false")
                        page.locator("#runButton").click()
                        check(f"wiring-{lesson_id:02d}-javascript-demo-independent",
                              "Đang chạy" in page.locator("#runStatus").inner_text()
                              and "không phải mạch hoàn chỉnh" in page.locator(".wire-status").inner_text())
                        page.locator("#runButton").click()
                    else:
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
                    if width == 375:
                        small.evaluate("location.hash='#bai-02'")
                        small.wait_for_function(
                            "document.querySelector('.lesson-link[data-lesson=\"2\"]')?.getAttribute('aria-current') === 'page'"
                        )
                        small.locator("#labEditToggle").click()
                        check("v15-mobile-lab-editor-no-horizontal-overflow-375",
                              small.locator("#labEditor").is_visible()
                              and small.evaluate("document.documentElement.scrollWidth <= innerWidth"))
                        small.locator("#infoTabPractice").click()
                        touch_targets = small.evaluate("""() => {
                            const selectors = [
                              '#labEditToggle', '#labEditor button', '#labEditor select', '#labEditor input',
                              '#learningCoach button'
                            ];
                            const nodes = [...new Set(selectors.flatMap(s => [...document.querySelectorAll(s)]))]
                              .filter(node => node.getClientRects().length && !node.disabled);
                            const rows = nodes.map(node => {
                              const rect = node.getBoundingClientRect();
                              return {
                                id: node.id || node.getAttribute('aria-label') || node.textContent.trim().slice(0, 32),
                                width: Number(rect.width.toFixed(1)),
                                height: Number(rect.height.toFixed(1)),
                              };
                            });
                            return {
                              count: rows.length,
                              minimumWidth: Math.min(...rows.map(row => row.width)),
                              minimumHeight: Math.min(...rows.map(row => row.height)),
                              tooSmall: rows.filter(row => row.width < 24 || row.height < 40),
                            };
                        }""")
                        check("v15-mobile-lab-coach-touch-targets-375",
                              touch_targets["count"] >= 15
                              and touch_targets["minimumWidth"] >= 24
                              and touch_targets["minimumHeight"] >= 40
                              and not touch_targets["tooSmall"],
                              json.dumps(touch_targets, ensure_ascii=False))
                        explorer_mobile = small.evaluate("""() => {
                            const root = document.querySelector('#labExplorer .lab-explorer');
                            const controls = [...document.querySelectorAll(
                              '#labExplorer .lab-explorer button, #labExplorer .lab-explorer select'
                            )].filter(node => node.getClientRects().length && !node.disabled);
                            const rows = controls.map(node => {
                              const rect = node.getBoundingClientRect();
                              return {
                                name: node.getAttribute('aria-label') || node.textContent.trim().slice(0, 48),
                                width: Number(rect.width.toFixed(1)),
                                height: Number(rect.height.toFixed(1)),
                              };
                            });
                            const rect = root?.getBoundingClientRect();
                            return {
                              exists: Boolean(root),
                              source: root?.dataset.explorerSource || '',
                              scope: root?.dataset.explorerScope || '',
                              right: rect ? Number(rect.right.toFixed(1)) : null,
                              viewport: innerWidth,
                              scrollWidth: document.documentElement.scrollWidth,
                              controlCount: rows.length,
                              minimumWidth: rows.length ? Math.min(...rows.map(row => row.width)) : 0,
                              minimumHeight: rows.length ? Math.min(...rows.map(row => row.height)) : 0,
                              tooSmall: rows.filter(row => row.width < 24 || row.height < 40),
                            };
                        }""")
                        check("v16-mobile-explorer-no-overflow-touch-controls-375",
                              explorer_mobile["exists"]
                              and explorer_mobile["source"] in ("learner-empty", "learner-draft")
                              and explorer_mobile["scope"] == "topology"
                              and explorer_mobile["scrollWidth"] <= explorer_mobile["viewport"]
                              and explorer_mobile["right"] <= explorer_mobile["viewport"] + 1
                              and explorer_mobile["controlCount"] >= 3
                              and explorer_mobile["minimumWidth"] >= 24
                              and explorer_mobile["minimumHeight"] >= 40
                              and not explorer_mobile["tooSmall"],
                              json.dumps(explorer_mobile, ensure_ascii=False))
                        breadboard_mobile = small.evaluate("""() => {
                            const section = document.querySelector('#breadboardStudy');
                            const controls = [
                              '#bbProfile','#bbHoleA','#bbHoleB','#bbCompare',
                              '#bbTerminal','#bbPlaceHole','#bbAssignHole','#bbRemoveHole',
                              '#bbGridPrev','#bbGridNext'
                            ]
                              .map(selector => document.querySelector(selector))
                              .filter(node => node && !node.disabled);
                            const rows = controls.map(node => {
                              const rect = node.getBoundingClientRect();
                              return {id: node.id, width: rect.width, height: rect.height};
                            });
                            const holeButtons = [...document.querySelectorAll(
                              '#bbHoleGrid .breadboard-hole-grid-button')];
                            const holeRows = holeButtons.map(node => {
                              const rect = node.getBoundingClientRect();
                              return {id: node.dataset.bbGridHole, width: rect.width, height: rect.height};
                            });
                            const rect = section?.getBoundingClientRect();
                            return {
                              exists: Boolean(section),
                              right: rect?.right ?? null,
                              controlCount: rows.length,
                              minimumHeight: Math.min(...rows.map(row => row.height)),
                              tooSmall: rows.filter(row => row.width < 24 || row.height < 40),
                              gridColumns: document.querySelectorAll('#bbHoleGrid [data-bb-grid-column]').length,
                              gridButtons: holeButtons.length,
                              gridButtonMinWidth: Math.min(...holeRows.map(row => row.width)),
                              gridButtonMinHeight: Math.min(...holeRows.map(row => row.height)),
                              gridButtonsTooSmall: holeRows.filter(row => row.width < 44 || row.height < 44),
                              gridRole: document.querySelector('#bbHoleGrid')?.getAttribute('role') || '',
                              gridName: document.querySelector('#bbHoleGrid')?.getAttribute('aria-label') || '',
                              gridStatusRole: document.querySelector('#bbGridStatus')?.getAttribute('role') || '',
                              gridStatusLive: document.querySelector('#bbGridStatus')?.getAttribute('aria-live') || '',
                              genericRailLocked: Boolean(
                                document.querySelector('#bbGridRail')?.disabled &&
                                document.querySelector('#bbGridRailHole')?.disabled &&
                                document.querySelector('#bbPickRail')?.disabled
                              ),
                              documentWidth: document.documentElement.scrollWidth,
                              viewport: innerWidth,
                              mapped: document.querySelector('#bbMappingWarning')?.dataset.mapped || '',
                              authoredStatusRole: document.querySelector('#bbPlacementStatus')?.getAttribute('role') || '',
                              authoredStatusLive: document.querySelector('#bbPlacementStatus')?.getAttribute('aria-live') || '',
                              authoredBoundary: document.querySelector('#bbAuthoredBoundary')?.textContent || '',
                            };
                        }""")
                        check("v16-mobile-breadboard-study-touch-boundary-375",
                              breadboard_mobile["exists"]
                              and breadboard_mobile["right"] <= 376
                              and breadboard_mobile["controlCount"] >= 8
                              and breadboard_mobile["minimumHeight"] >= 40
                              and not breadboard_mobile["tooSmall"]
                              and breadboard_mobile["gridColumns"] == 8
                              and breadboard_mobile["gridButtons"] == 80
                              and breadboard_mobile["gridButtonMinWidth"] >= 44
                              and breadboard_mobile["gridButtonMinHeight"] >= 44
                              and not breadboard_mobile["gridButtonsTooSmall"]
                              and breadboard_mobile["gridRole"] == "group"
                              and "cột 1 đến 8" in breadboard_mobile["gridName"].lower()
                              and breadboard_mobile["gridStatusRole"] == "status"
                              and breadboard_mobile["gridStatusLive"] == "polite"
                              and breadboard_mobile["genericRailLocked"]
                              and breadboard_mobile["documentWidth"] <= breadboard_mobile["viewport"]
                              and breadboard_mobile["mapped"] == "false"
                              and breadboard_mobile["authoredStatusRole"] == "status"
                              and breadboard_mobile["authoredStatusLive"] == "polite"
                              and "do người dùng khai báo trong phiên" in
                                  breadboard_mobile["authoredBoundary"],
                              json.dumps(breadboard_mobile, ensure_ascii=False))
                        mobile_hole = small.locator('#bbHoleGrid [data-bb-grid-hole="A1"]')
                        mobile_hole.focus()
                        mobile_hole.press("Enter")
                        check("post-v16-mobile-breadboard-hole-picker-keyboard-input-only-375",
                              small.locator("#bbPlaceHole").input_value() == "A1"
                              and mobile_hole.get_attribute("aria-pressed") == "true"
                              and small.locator("#bbGridStatus").get_attribute(
                                  "data-result") == "selected"
                              and small.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                              and small.locator("#sceneMount canvas").get_attribute(
                                  "data-lab-wire-count") == "0"
                              and small.evaluate(
                                  "document.documentElement.scrollWidth <= innerWidth"),
                              small.locator("#bbGridStatus").inner_text())
                        small.locator("#resistiveSolve").click()
                        resistive_mobile = small.evaluate("""() => {
                            const section = document.querySelector('#resistiveStudy');
                            const results = document.querySelector('#resistiveDetails');
                            const controls = ['#resistiveV','#resistiveR1','#resistiveR2','#resistiveSolve']
                              .map(selector => document.querySelector(selector))
                              .filter(Boolean);
                            const rows = controls.map(node => {
                              const rect = node.getBoundingClientRect();
                              return {id: node.id, width: rect.width, height: rect.height};
                            });
                            const rect = section?.getBoundingClientRect();
                            return {
                              exists: Boolean(section),
                              right: rect?.right ?? null,
                              viewport: innerWidth,
                              documentScrollWidth: document.documentElement.scrollWidth,
                              minimumHeight: Math.min(...rows.map(row => row.height)),
                              tooSmall: rows.filter(row => row.width < 24 || row.height < 40),
                              result: document.querySelector('#resistiveResult')?.dataset.result || '',
                              detailsClientWidth: results?.clientWidth ?? 0,
                              detailsScrollWidth: results?.scrollWidth ?? 0,
                              visual: Boolean(document.querySelector('[data-resistive-divider-visual]')),
                              svgRole: document.querySelector('[data-resistive-divider-visual] svg')?.getAttribute('role') || '',
                              svgName: document.querySelector('[data-resistive-divider-visual] svg')?.getAttribute('aria-label') || '',
                            };
                        }""")
                        check("v16-mobile-resistive-study-no-document-overflow-375",
                              resistive_mobile["exists"]
                              and resistive_mobile["right"] <= resistive_mobile["viewport"] + 1
                              and resistive_mobile["documentScrollWidth"] <= resistive_mobile["viewport"]
                              and resistive_mobile["minimumHeight"] >= 40
                              and not resistive_mobile["tooSmall"]
                              and resistive_mobile["result"] == "calculated"
                              and resistive_mobile["visual"]
                              and resistive_mobile["svgRole"] == "img"
                              and all(token in resistive_mobile["svgName"]
                                      for token in ("VCC", "R1", "MID", "R2", "GND"))
                              and resistive_mobile["detailsScrollWidth"] >=
                                  resistive_mobile["detailsClientWidth"],
                              json.dumps(resistive_mobile, ensure_ascii=False))
                    context.close()

                # Post-v1.6 candidate: inspect actual step-specific learner
                # topology against a separately sourced reference sample.
                # Evidence of matching sample edges is NOT proof of mastery,
                # physical wiring, measured current or firmware execution.
                practice_context = browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    service_workers="allow",
                )
                try:
                    practice_page = practice_context.new_page()
                    capture_console(practice_page)
                    practice_page.goto(base, wait_until="domcontentloaded", timeout=20000)
                    ready(practice_page)
                    observation_ui_failures = []
                    observation_ui_seen = 0
                    checklist_ui_failures = []
                    checklist_ui_seen = 0
                    for lesson_id in range(1, 17):
                        practice_page.locator(
                            f'.lesson-link[data-lesson="{lesson_id}"]'
                        ).click()
                        practice_page.locator("#infoTabPractice").click()
                        evidence = practice_page.locator(
                            "#learningCoach [data-practice-evidence]")
                        status = evidence.get_attribute("data-practice-status")
                        scope = evidence.get_attribute("data-practice-scope")
                        checkpoint_kind = evidence.get_attribute(
                            "data-practice-checkpoint-kind")
                        checkpoint_id = evidence.get_attribute(
                            "data-practice-checkpoint-id")
                        provenance = evidence.get_attribute(
                            "data-practice-provenance")
                        manual_checkpoint = checkpoint_kind == "manual"
                        check(f"post-v16-practice-lesson-{lesson_id:02d}-truthful-empty-evidence",
                              evidence.count() == 1
                              and evidence.get_attribute("data-practice-lesson") == str(lesson_id)
                              and evidence.get_attribute("data-practice-step") == "0"
                              and evidence.get_attribute("data-practice-matched") == "0"
                              and checkpoint_id == f"lesson-{lesson_id:02d}-step-01"
                              and provenance == "human-authored-from-lesson-text"
                              and evidence.locator(
                                  "[data-practice-provenance-note]").count() == 1
                              and (
                                  scope == "manual"
                                  and status == "manual-checkpoint"
                                  and evidence.locator(
                                      "[data-practice-grouping-note]").count() == 0
                                  if manual_checkpoint else
                                  scope in ("topology", "signal-only")
                                  and status == "not-attempted"
                                  and "Ứng dụng chưa ghi nhận bản tự đấu" in evidence.inner_text()
                                  and evidence.locator(
                                      "[data-practice-grouping-note]").count() == 1
                              )
                              and "không phải xác nhận của giáo viên" in evidence.inner_text()
                              and practice_page.locator("#completeButton").is_hidden(),
                              json.dumps({
                                  "lesson": lesson_id,
                                  "status": status,
                                  "scope": scope,
                                  "checkpointKind": checkpoint_kind,
                                  "checkpointId": checkpoint_id,
                                  "provenance": provenance,
                              },
                                         ensure_ascii=False))
                        for step_index in range(3):
                            observation = practice_page.locator(
                                "#learningCoach [data-practice-observation]")
                            step_evidence = practice_page.locator(
                                "#learningCoach [data-practice-evidence]")
                            checklist = step_evidence.locator("[data-practice-wire-checklist]")
                            row_states = step_evidence.locator("[data-practice-checklist-row]").evaluate_all(
                                "nodes => nodes.map(n => n.dataset.practicePairStatus)")
                            expected_required = int(step_evidence.get_attribute(
                                "data-practice-required") or "0")
                            manual = step_evidence.get_attribute("data-practice-checkpoint-kind") == "manual"
                            checklist_ok = (
                                checklist.count() == 1
                                and checklist.get_attribute("role") == "group"
                                and (len(row_states) == 0 if manual else
                                     len(row_states) == expected_required and expected_required > 0)
                                and all(state == "missing" for state in row_states)
                                and step_evidence.locator(
                                    "[data-practice-extra-review-row]").count() == 0
                                and step_evidence.locator(
                                    "[data-practice-checklist-inspect-terminal]").count() == len(row_states)
                                and step_evidence.get_attribute("data-practice-matched") == "0"
                                and practice_page.locator("#completeButton").is_hidden()
                            )
                            checklist_ui_seen += 1
                            if not checklist_ok:
                                checklist_ui_failures.append({
                                    "lesson": lesson_id,
                                    "step": step_index,
                                    "manual": manual,
                                    "required": expected_required,
                                    "rows": row_states,
                                    "checklistCount": checklist.count(),
                                })
                            observation_text = observation.inner_text()
                            observation_ok = (
                                observation.count() == 1
                                and observation.get_attribute("data-observation-lesson") == str(lesson_id)
                                and observation.get_attribute("data-observation-step") == str(step_index)
                                and observation.get_attribute("data-observation-checkpoint") ==
                                    f"lesson-{lesson_id:02d}-step-{step_index + 1:02d}"
                                and observation.get_attribute("role") == "status"
                                and observation.get_attribute("aria-live") == "polite"
                                and observation.get_attribute("data-observation-status") in (
                                    "no-lesson-event-overlap", "no-editorial-expectation")
                                and "không lưu stepIndex hay timestamp" in observation_text
                                and "không đo mastery" in observation_text
                                and "không tự hoàn thành bài" in observation_text
                                and "không phải điều kiện để chuyển bước" in observation_text
                            )
                            observation_ui_seen += 1
                            if not observation_ok:
                                observation_ui_failures.append({
                                    "lesson": lesson_id,
                                    "step": step_index,
                                    "status": observation.get_attribute("data-observation-status"),
                                    "checkpoint": observation.get_attribute("data-observation-checkpoint"),
                                    "text": observation_text[:240],
                                })
                            if step_index < 2:
                                practice_page.locator("#coachNext").click()
                        practice_page.locator("#coachPrevious").click()
                        practice_page.locator("#coachPrevious").click()
                    check("post-v16-practice-observation-all-48-step-ui-bounded",
                          observation_ui_seen == 48 and not observation_ui_failures,
                          json.dumps({
                              "seen": observation_ui_seen,
                              "failures": observation_ui_failures[:4],
                          }, ensure_ascii=False))
                    check("vnext-48-authored-checkpoint-per-pair-checklist-no-automatic-completion",
                          checklist_ui_seen == 48 and not checklist_ui_failures,
                          json.dumps({
                              "seen": checklist_ui_seen,
                              "failures": checklist_ui_failures[:5],
                          }, ensure_ascii=False))
                    practice_page.locator('.lesson-link[data-lesson="2"]').click()
                    practice_page.locator("#infoTabPractice").click()
                    observation_before_handler = practice_page.locator(
                        "#learningCoach [data-practice-observation]")
                    observation_before_status = observation_before_handler.get_attribute(
                        "data-observation-status")
                    observation_graph_before = practice_page.locator(
                        "#sceneMount canvas").get_attribute("data-lab-wire-count")
                    practice_page.locator(
                        "#learningCoach [data-practice-open-wiring]").click()
                    observation_after_handler = practice_page.locator(
                        "#learningCoach [data-practice-observation]")
                    observation_handler_text = observation_after_handler.inner_text()
                    check("post-v16-practice-observation-real-view-wiring-handler-no-graph-mutation",
                          observation_before_status == "no-lesson-event-overlap"
                          and observation_after_handler.get_attribute(
                              "data-observation-status") == "lesson-event-overlap"
                          and observation_after_handler.get_attribute(
                              "data-observation-lesson-events") == "1"
                          and observation_after_handler.get_attribute(
                              "data-observation-matching-events") == "1"
                          and "view-wiring" in observation_handler_text
                          and "caller báo cho module" in observation_handler_text
                          and "host-only" not in observation_handler_text.lower()
                          and "host app đã ghi nhận" not in observation_handler_text.lower()
                          and "người dùng đã thực hiện" not in observation_handler_text.lower()
                          and "không chứng minh event đã xảy ra tại bước hiện tại" in
                              observation_handler_text
                          and "không đo mastery" in observation_handler_text
                          and "không tự hoàn thành bài" in observation_handler_text
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-wire-count") == observation_graph_before == "0"
                          and practice_page.locator(".wire-connected").count() == 0
                          and practice_page.locator("#completeButton").is_hidden(),
                          json.dumps({
                              "before": observation_before_status,
                              "after": observation_after_handler.get_attribute(
                                  "data-observation-status"),
                              "lessonEvents": observation_after_handler.get_attribute(
                                  "data-observation-lesson-events"),
                              "matchingEvents": observation_after_handler.get_attribute(
                                  "data-observation-matching-events"),
                              "sceneWires": practice_page.locator(
                                  "#sceneMount canvas").get_attribute("data-lab-wire-count"),
                          }, ensure_ascii=False))
                    practice_page.locator("#stageTab3d").click()
                    checklist_inspect = practice_page.locator(
                        "#learningCoach [data-practice-checklist-inspect-terminal]").first
                    checklist_target = checklist_inspect.get_attribute("data-practice-inspect-terminal")
                    checklist_events_before = practice_page.locator(
                        "#learningCoach [data-practice-observation]").get_attribute(
                            "data-observation-lesson-events")
                    checklist_inspect.focus()
                    checklist_inspect.press("Enter")
                    check("vnext-authored-checklist-readonly-inspector-no-wire-journal-or-mastery",
                          checklist_target == "D13"
                          and practice_page.locator("#stageTab3d").get_attribute("aria-selected") == "true"
                          and practice_page.locator("#labEditToggle").get_attribute("aria-pressed") == "false"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-inspected-terminal") == checklist_target
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-wire-count") == "0"
                          and practice_page.locator("#learningCoach [data-practice-observation]").get_attribute(
                              "data-observation-lesson-events") == checklist_events_before
                          and practice_page.locator("#completeButton").is_hidden())
                    # The explicit missing-terminal action is navigation/inspection
                    # only. Prove it revokes an already armed first-terminal gesture
                    # before selecting the exact canonical missing endpoint.
                    missing_terminal_button = practice_page.locator(
                        "#learningCoach [data-practice-inspect-missing-terminal]")
                    missing_terminal_target = missing_terminal_button.get_attribute(
                        "data-practice-inspect-terminal")
                    missing_terminal_is_canonical = practice_page.evaluate(
                        """id => import('./src/circuit-router.js').then(m =>
                          m.listTerminals(2).some(item => item.id === id))""",
                        missing_terminal_target,
                    )
                    practice_page.locator("#labEditToggle").click()
                    practice_page.locator(
                        '#labExplorer .lab-explorer-terminal-actions [data-explorer-terminal="D13"]'
                    ).click()
                    pending_before_missing_inspect = practice_page.locator(
                        "#sceneMount canvas").get_attribute("data-lab-pending-wire-terminal")
                    missing_terminal_button.focus()
                    missing_terminal_button.press("Enter")
                    practice_explorer = practice_page.locator("#labExplorer .lab-explorer")
                    practice_learner_wires = practice_explorer.locator(
                        '[data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    )
                    check("post-v16-practice-missing-terminal-inspector-keyboard-readonly-no-wire",
                          missing_terminal_target == "D13"
                          and missing_terminal_is_canonical
                          and pending_before_missing_inspect == "D13"
                          and practice_page.locator("#stageTab3d").get_attribute(
                              "aria-selected") == "true"
                          and practice_page.locator("#labEditToggle").get_attribute(
                              "aria-pressed") == "false"
                          and practice_page.locator("#labEditor").is_hidden()
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-pending-wire-terminal") == ""
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-pending-wire-preview") == "none"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-inspected-terminal") == missing_terminal_target
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-inspection-feedback") == "label"
                          and practice_explorer.get_attribute(
                              "data-explorer-selected-terminal") == missing_terminal_target
                          and practice_learner_wires.count() == 0
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-wire-count") == "0"
                          and practice_page.locator("#sceneInspectionStatus").is_visible()
                          and missing_terminal_target in
                              practice_page.locator("#sceneInspectionStatus").inner_text()
                          and practice_page.locator("#completeButton").is_hidden(),
                          json.dumps({
                              "target": missing_terminal_target,
                              "pendingBefore": pending_before_missing_inspect,
                              "pendingAfter": practice_page.locator(
                                  "#sceneMount canvas").get_attribute(
                                      "data-lab-pending-wire-terminal"),
                              "inspected": practice_page.locator(
                                  "#sceneMount canvas").get_attribute(
                                      "data-lab-inspected-terminal"),
                              "learnerWires": practice_learner_wires.count(),
                          }, ensure_ascii=False))
                    # A half-completed 3D terminal gesture must be cancelled
                    # when the learner navigates to 2D through Practice. The
                    # first click after returning to 3D must not create a
                    # spurious wire from the stale previous terminal.
                    practice_page.locator("#labEditToggle").click()
                    practice_page.locator(
                        '#labExplorer .lab-explorer-terminal-actions [data-explorer-terminal="D13"]'
                    ).click()
                    armed_before_stage_switch = practice_page.locator(
                        "#labExplorer .lab-explorer").get_attribute(
                            "data-explorer-selected-terminal")
                    pending_before_stage_switch = practice_page.locator(
                        "#sceneMount canvas").get_attribute("data-lab-pending-wire-terminal")
                    practice_page.locator(
                        "#learningCoach [data-practice-open-wiring]").click()
                    selected_on_2d = practice_page.locator(
                        "#labExplorer .lab-explorer").get_attribute(
                            "data-explorer-selected-terminal")
                    pending_on_2d = practice_page.locator(
                        "#sceneMount canvas").get_attribute("data-lab-pending-wire-terminal")
                    practice_page.locator("#stageTab3d").click()
                    selected_on_return = practice_page.locator(
                        "#labExplorer .lab-explorer").get_attribute(
                            "data-explorer-selected-terminal")
                    practice_page.locator(
                        '#labExplorer .lab-explorer-terminal-actions [data-explorer-terminal="R1:A"]'
                    ).click()
                    check("post-v16-practice-3d-pending-terminal-revoked-on-2d-stage-switch",
                          armed_before_stage_switch == "D13"
                          and pending_before_stage_switch == "D13"
                          and selected_on_2d in ("", None)
                          and pending_on_2d in ("", None)
                          and selected_on_return in ("", None)
                          and practice_page.locator(
                              "#labExplorer .lab-explorer").get_attribute(
                                  "data-explorer-selected-terminal") == "R1:A"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-pending-wire-terminal") == "R1:A"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-pending-wire-preview") == "none"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-wire-count") == "0",
                          json.dumps({
                              "armed": armed_before_stage_switch,
                              "pendingBefore": pending_before_stage_switch,
                              "in2D": selected_on_2d,
                              "pending2D": pending_on_2d,
                              "back3D": selected_on_return,
                          }, ensure_ascii=False))
                    # Regression: a REAL WebGL context loss clears both scene
                    # preview and LabEditor firstTerminal. Synthetic restoration
                    # without losing the underlying GL context is not equivalent:
                    # it can make Three.js upload against invalid GL texture state
                    # and produce misleading INVALID_OPERATION warnings. Require
                    # WEBGL_lose_context, await actual loss + restore events, then
                    # prove the next terminal is a new first (never a stale wire).
                    practice_page.locator("#labEditToggle").click()
                    practice_page.locator("#labEditToggle").click()
                    practice_page.locator(
                        '#labExplorer .lab-explorer-terminal-actions [data-explorer-terminal="D13"]'
                    ).click()
                    context_canvas = practice_page.locator("#sceneMount canvas")
                    context_pending_before = context_canvas.get_attribute(
                        "data-lab-pending-wire-terminal")
                    context_wires_before = practice_page.locator(
                        '#labExplorer .lab-explorer [data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    ).count()
                    context_cycle = practice_page.evaluate("""async () => {
                        const canvas = document.querySelector('#sceneMount canvas');
                        const context = canvas?.getContext('webgl2');
                        const extension = context?.getExtension('WEBGL_lose_context');
                        if (!extension) {
                            throw new Error('Real WebGL context-loss extension unavailable; cannot certify context restoration');
                        }
                        const waitCanvasEvent = name => new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Timeout awaiting '+name)), 10000);
                            canvas.addEventListener(name, event => {
                                clearTimeout(timeout);
                                resolve(event);
                            }, {once:true});
                        });
                        const lost = waitCanvasEvent('webglcontextlost');
                        extension.loseContext();
                        const lostEvent = await lost;
                        const loss = {
                            defaultPrevented: lostEvent.defaultPrevented,
                            context: canvas.dataset.sceneContext,
                            pending: canvas.dataset.labPendingWireTerminal,
                            hover: canvas.dataset.labPendingWireHoverTerminal,
                            preview: canvas.dataset.labPendingWirePreview,
                            note: document.getElementById('labSelectedTerminal')?.textContent || '',
                        };
                        // The lost-event listener resolves while event dispatch
                        // may still be unwinding. WebGL restoration must wait for
                        // a new browser task, as in existing scene contracts.
                        await new Promise(resolve => setTimeout(resolve, 0));
                        const restored = waitCanvasEvent('webglcontextrestored');
                        extension.restoreContext();
                        await restored;
                        return {
                            realContextCycle:true,
                            loss,
                            restoredContext:canvas.dataset.sceneContext,
                        };
                    }""")
                    context_loss = context_cycle["loss"]
                    context_note_after_loss = context_loss["note"]
                    practice_page.locator(
                        '#labExplorer .lab-explorer-terminal-actions [data-explorer-terminal="R1:A"]'
                    ).click()
                    context_wires_after = practice_page.locator(
                        '#labExplorer .lab-explorer [data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    ).count()
                    check("post-v16-webgl-context-loss-revokes-pending-first-terminal-no-false-connection",
                          context_cycle["realContextCycle"]
                          and context_cycle["restoredContext"] == "ready"
                          and context_pending_before == "D13"
                          and context_loss["defaultPrevented"]
                          and context_loss["context"] == "lost"
                          and context_loss["pending"] == ""
                          and context_loss["hover"] == ""
                          and context_loss["preview"] == "none"
                          and "hủy chọn chân đầu tiên" in context_note_after_loss.lower()
                          and context_canvas.get_attribute("data-scene-context") == "ready"
                          and context_canvas.get_attribute(
                              "data-lab-pending-wire-terminal") == "R1:A"
                          and context_canvas.get_attribute(
                              "data-lab-pending-wire-preview") == "none"
                          and practice_page.locator(
                              "#labExplorer .lab-explorer").get_attribute(
                                  "data-explorer-selected-terminal") == "R1:A"
                          and "chọn chân thứ hai" in practice_page.locator(
                              "#labSelectedTerminal").inner_text().lower()
                          and context_wires_before == context_wires_after == 0
                          and context_canvas.get_attribute("data-lab-wire-count") == "0",
                          json.dumps({
                              "pendingBefore": context_pending_before,
                              "loss": context_loss,
                              "noteAfterLoss": context_note_after_loss,
                              "pendingAfterNext": context_canvas.get_attribute(
                                  "data-lab-pending-wire-terminal"),
                              "wiresBefore": context_wires_before,
                              "wiresAfter": context_wires_after,
                          }, ensure_ascii=False))
                    practice_page.locator("#labEditToggle").click()
                    evidence = practice_page.locator("#learningCoach [data-practice-evidence]")
                    goto_wires = evidence.locator("[data-practice-open-wiring]")
                    goto_wires.focus()
                    goto_wires.press("Enter")
                    check("post-v16-practice-open-wiring-keyboard-no-implicit-netlist",
                          practice_page.locator("#stageTabWiring").get_attribute("aria-selected") == "true"
                          and practice_page.locator(".wire-connected").count() == 0
                          and practice_page.locator("#completeButton").is_hidden())
                    first_expected = practice_page.evaluate("""() => import('./src/circuit-router.js').then(m => {
                        const first = m.createSampleCircuit(2).wires[0];
                        return {from:first.from,to:first.to};
                    })""")
                    practice_page.locator(
                        f'[data-terminal="{first_expected["from"]}"]').click()
                    practice_page.locator(
                        f'[data-terminal="{first_expected["to"]}"]').click()
                    evidence = practice_page.locator("#learningCoach [data-practice-evidence]")
                    check("post-v16-practice-current-learner-wire-updates-evidence",
                          practice_page.locator(".wire-connected").count() == 1
                          and evidence.get_attribute("data-practice-status") != "not-attempted"
                          and int(evidence.get_attribute("data-practice-matched") or "-1") >= 1
                          and practice_page.locator("#completeButton").is_hidden(),
                          json.dumps({"status": evidence.get_attribute("data-practice-status"),
                                      "matched": evidence.get_attribute("data-practice-matched")},
                                     ensure_ascii=False))
                    practice_page.locator("#coachNext").click()
                    check("post-v16-practice-step-navigator-refreshes-evidence",
                          practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-step") == "1"
                          and "BƯỚC 2/" in practice_page.locator(".coach-progress").inner_text())
                    check("post-v16-authored-manual-step-does-not-inherit-topology-score",
                          practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-status") == "manual-checkpoint"
                          and practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-checkpoint-kind") == "manual"
                          and practice_page.locator(
                              "#learningCoach [data-practice-grouping-note]").count() == 0
                          and "topology dây không được dùng làm điều kiện" in
                              practice_page.locator(
                                  "#learningCoach [data-practice-evidence]").inner_text()
                          and practice_page.locator(".wire-connected").count() == 1
                          and practice_page.locator("#completeButton").is_hidden())
                    check("post-v16-practice-incomplete-step-is-not-pedagogy-verified",
                          practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-checkpoint-kind") == "manual"
                          and practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-provenance") ==
                              "human-authored-from-lesson-text"
                          and "không phải xác nhận của giáo viên" in
                              practice_page.locator(
                                  "#learningCoach [data-practice-provenance-note]").inner_text()
                          and "không phải điều kiện để chuyển bước" in
                              practice_page.locator(
                                  "#learningCoach [data-practice-provenance-note]").inner_text()
                          and practice_page.locator("#completeButton").is_hidden())
                    practice_page.locator("#coachPrevious").click()
                    check("post-v16-return-to-authored-wiring-step-restores-wire-evidence",
                          practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-step") == "0"
                          and practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-checkpoint-kind") == "wiring"
                          and practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-status") == "incomplete"
                          and practice_page.locator(
                              "#learningCoach [data-practice-grouping-note]").count() == 1)
                    practice_page.locator(".wire-actions .wire-action").first.click()
                    evidence = practice_page.locator("#learningCoach [data-practice-evidence]")
                    check("post-v16-reference-copied-graph-is-only-authored-topology-match",
                          evidence.get_attribute("data-practice-status") == "topology-match"
                          and evidence.get_attribute(
                              "data-practice-checkpoint-kind") == "wiring"
                          and int(evidence.get_attribute("data-practice-required") or "0") > 0
                          and practice_page.locator("#completeButton").is_hidden(),
                          evidence.inner_text()[:450])
                    check("post-v16-reference-copied-graph-is-only-sample-group-match",
                          evidence.get_attribute("data-practice-status") == "topology-match"
                          and evidence.get_attribute(
                              "data-practice-provenance") ==
                              "human-authored-from-lesson-text"
                          and evidence.locator("[data-practice-grouping-note]").count() == 1
                          and "không phải xác nhận của giáo viên" in evidence.inner_text()
                          and "không chứng minh người học" in evidence.inner_text()
                          and practice_page.locator("#completeButton").is_hidden(),
                          evidence.inner_text()[:450])
                    for _ in range(16):
                        if practice_page.locator("#coachNext").is_disabled():
                            break
                        practice_page.locator("#coachNext").click()
                    evidence = practice_page.locator("#learningCoach [data-practice-evidence]")
                    check("post-v16-reference-copied-full-topology-manual-step-does-not-complete-quiz",
                          evidence.get_attribute("data-practice-status") == "manual-checkpoint"
                          and evidence.get_attribute(
                              "data-practice-checkpoint-kind") == "manual"
                          and practice_page.locator("#completeButton").is_hidden()
                          and practice_page.locator("#quizFeedback").get_attribute("data-result") is None,
                          evidence.inner_text()[:450])
                    check("post-v16-reference-copied-full-topology-does-not-complete-quiz",
                          practice_page.locator(".wire-connected").count() ==
                              practice_page.evaluate(
                                  "() => import('./src/circuit-router.js').then(m => m.createSampleCircuit(2).wires.length)")
                          and practice_page.locator("#completeButton").is_hidden()
                          and practice_page.locator("#quizFeedback").get_attribute("data-result") is None
                          and "không tự xác nhận" in evidence.inner_text()
                          and "hoàn thành bài học" in evidence.inner_text(),
                          evidence.inner_text()[:450])
                    practice_page.locator("#learningCoach [data-practice-recheck]").click()
                    check("post-v16-practice-recheck-preserves-canonical-wire-count",
                          practice_page.locator(".wire-connected").count() ==
                              practice_page.evaluate(
                                  "() => import('./src/circuit-router.js').then(m => m.createSampleCircuit(2).wires.length)")
                          and practice_page.locator(
                              "#learningCoach [data-practice-recheck]").count() == 1)
                    for _ in range(16):
                        if practice_page.locator("#coachPrevious").is_disabled():
                            break
                        practice_page.locator("#coachPrevious").click()
                    check("post-v16-negative-topology-check-runs-on-authored-wiring-step",
                          practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-step") == "0"
                          and practice_page.locator(
                              "#learningCoach [data-practice-evidence]").get_attribute(
                                  "data-practice-checkpoint-kind") == "wiring")
                    practice_page.locator(".wire-actions .wire-action").nth(1).click()
                    practice_page.locator('[data-terminal="D13"]').click()
                    practice_page.locator('[data-terminal="GND"]').click()
                    evidence = practice_page.locator("#learningCoach [data-practice-evidence]")
                    check("post-v16-practice-short-circuit-never-matches-reference",
                          evidence.get_attribute("data-practice-status") == "needs-correction"
                          and practice_page.locator("#completeButton").is_hidden()
                          and "D13" in evidence.inner_text(),
                          evidence.inner_text()[:450])
                    for signal_lesson in (10, 14):
                        practice_page.locator(
                            f'.lesson-link[data-lesson="{signal_lesson}"]').click()
                        practice_page.locator("#infoTabPractice").click()
                        practice_page.locator(
                            "#learningCoach [data-practice-open-wiring]").click()
                        practice_page.locator(".wire-actions .wire-action").first.click()
                        evidence = practice_page.locator(
                            "#learningCoach [data-practice-evidence]")
                        expected_status = (
                            "manual-checkpoint" if signal_lesson == 10
                            else "signal-topology-match"
                        )
                        expected_scope = "manual" if signal_lesson == 10 else "signal-only"
                        expected_kind = "manual" if signal_lesson == 10 else "wiring"
                        check(f"post-v16-practice-signal-only-{signal_lesson:02d}-never-functional",
                              evidence.get_attribute("data-practice-status") == expected_status
                              and evidence.get_attribute("data-practice-scope") == expected_scope
                              and evidence.get_attribute(
                                  "data-practice-checkpoint-kind") == expected_kind
                              and evidence.locator(
                                  ".practice-evidence-signal-note").count() == 1
                              and practice_page.locator(".wire-activate").is_disabled()
                              and practice_page.locator("#completeButton").is_hidden(),
                              evidence.inner_text()[:450])
                    practice_page.locator('.lesson-link[data-lesson="2"]').click()
                    practice_page.locator("#infoTabPractice").click()
                    practice_page.set_viewport_size({"width": 375, "height": 812})
                    mobile_evidence = practice_page.evaluate("""() => {
                        const root = document.querySelector('[data-practice-evidence]');
                        const controls = Array.from(root?.querySelectorAll('button') || []);
                        const inspect = root?.querySelector('[data-practice-inspect-missing-terminal]');
                        const inspectRect = inspect?.getBoundingClientRect();
                        return {
                            innerWidth,
                            documentWidth: document.documentElement.scrollWidth,
                            buttons: controls.length,
                            smallButtons: controls.filter(x => {
                                const rect=x.getBoundingClientRect();
                                return rect.height < 44 || rect.width < 44;
                            }).length,
                            status: root?.dataset.practiceStatus || '',
                            inspectTarget: inspect?.getAttribute('data-practice-inspect-terminal') || '',
                            inspectWidth: inspectRect?.width ?? 0,
                            inspectHeight: inspectRect?.height ?? 0,
                        };
                    }""")
                    check("post-v16-practice-mobile375-no-overflow-touch-targets",
                          mobile_evidence["documentWidth"] <= mobile_evidence["innerWidth"]
                          and mobile_evidence["buttons"] >= 4
                          and mobile_evidence["smallButtons"] == 0
                          and mobile_evidence["inspectTarget"] == "D13"
                          and mobile_evidence["inspectWidth"] >= 44
                          and mobile_evidence["inspectHeight"] >= 44,
                          json.dumps(mobile_evidence, ensure_ascii=False))
                    # At 375px, the official pinout may expose a read-only 3D
                    # action only for an exact current-lesson terminal. Arm a
                    # transient first terminal first so the action must revoke it.
                    practice_page.locator("#stageTab3d").click()
                    if practice_page.locator("#labEditToggle").get_attribute("aria-pressed") != "true":
                        practice_page.locator("#labEditToggle").click()
                    practice_page.locator(
                        '#labExplorer .lab-explorer-terminal-actions [data-explorer-terminal="D13"]'
                    ).click()
                    pinout_pending_before = practice_page.locator(
                        "#sceneMount canvas").get_attribute("data-lab-pending-wire-terminal")
                    pinout_explorer = practice_page.locator("#labExplorer .lab-explorer")
                    pinout_wire_list = pinout_explorer.locator(
                        '[data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    )
                    pinout_wires_before = pinout_wire_list.count()
                    practice_page.locator("#infoTabPinout").click()
                    d13_pin_button = practice_page.locator('[data-uno-pin-inspect="D13"]')
                    d13_pin_rect = d13_pin_button.bounding_box()
                    alias_pin_buttons = practice_page.locator(
                        '[data-uno-pin-inspect="AREF"], [data-uno-pin-inspect="SDA"], '
                        '[data-uno-pin-inspect="SCL"]'
                    )
                    d13_pin_button.focus()
                    d13_pin_button.press("Enter")
                    pinout_wire_list_after = practice_page.locator(
                        '#labExplorer .lab-explorer [data-explorer-panel="schematic"] '
                        '.lab-explorer-wire-list:not(.lab-explorer-reference-list) [data-explorer-wire]'
                    )
                    check("post-v16-mobile-uno-pinout-inspect-keyboard-readonly-preserves-graph-375",
                          d13_pin_rect is not None
                          and d13_pin_rect["width"] >= 44
                          and d13_pin_rect["height"] >= 44
                          and alias_pin_buttons.count() == 0
                          and pinout_pending_before == "D13"
                          and practice_page.locator("#labEditToggle").get_attribute(
                              "aria-pressed") == "false"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-pending-wire-terminal") == ""
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-inspected-terminal") == "D13"
                          and practice_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-inspection-feedback") == "label"
                          and practice_page.locator("#sceneInspectionStatus").is_visible()
                          and "D13" in practice_page.locator("#sceneInspectionStatus").inner_text()
                          and pinout_wire_list_after.count() == pinout_wires_before
                          and practice_page.locator("#completeButton").is_hidden(),
                          json.dumps({
                              "button": d13_pin_rect,
                              "aliases": alias_pin_buttons.count(),
                              "pendingBefore": pinout_pending_before,
                              "pendingAfter": practice_page.locator(
                                  "#sceneMount canvas").get_attribute(
                                      "data-lab-pending-wire-terminal"),
                              "wiresBefore": pinout_wires_before,
                              "wiresAfter": pinout_wire_list_after.count(),
                          }, ensure_ascii=False))
                finally:
                    practice_context.close()

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
                offline_v15_modules = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [layout, editor, coach, timer1, css] = await Promise.all([
                        import(new URL('./src/lab-layout.js', baseUrl).href),
                        import(new URL('./src/lab-editor-ui.js', baseUrl).href),
                        import(new URL('./src/learning-coach.js', baseUrl).href),
                        import(new URL('./src/avr-timer1.js', baseUrl).href),
                        fetch(new URL('./styles/lab-editor.css', baseUrl), { cache: 'no-store' }),
                    ]);
                    return {
                        layout: typeof layout.createLabLayout === 'function'
                            && typeof layout.moveLabComponent === 'function'
                            && typeof layout.rotateLabComponent === 'function',
                        editor: typeof editor.mountLabEditor === 'function',
                        coach: typeof coach.getLessonGuidance === 'function'
                            && coach.LEARNING_COACH_BOUNDARIES?.physicalValidation === false,
                        timer1: typeof timer1.createAvrTimer1 === 'function'
                            && timer1.AVR_TIMER1_CAPABILITIES?.normalMode === true
                            && timer1.AVR_TIMER1_CAPABILITIES?.pwm === false
                            && timer1.AVR_TIMER1_CAPABILITIES?.servoParity === false,
                        cssOk: css.ok && (await css.text()).includes('.lab-editor'),
                    };
                }""")
                check("offline-v15-lab-coach-timer1-modules-cached",
                      all(offline_v15_modules.values()),
                      json.dumps(offline_v15_modules, ensure_ascii=False))
                offline_v16_modules = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [explorerModel, explorerUi, breadboard, breadboardUi, timer2, dcNetwork, resistiveUi, css] =
                      await Promise.all([
                        import(new URL('./src/lab-explorer.js', baseUrl).href),
                        import(new URL('./src/lab-explorer-ui.js', baseUrl).href),
                        import(new URL('./src/breadboard-topology.js', baseUrl).href),
                        import(new URL('./src/breadboard-topology-ui.js', baseUrl).href),
                        import(new URL('./src/avr-timer2.js', baseUrl).href),
                        import(new URL('./src/dc-resistor-network.js', baseUrl).href),
                        import(new URL('./src/resistive-study-ui.js', baseUrl).href),
                        fetch(new URL('./styles/lab-explorer.css', baseUrl), { cache: 'no-store' }),
                      ]);
                    return {
                        explorerModel: typeof explorerModel.createLabExplorerModel === 'function'
                            && typeof explorerModel.explorerTerminalPosition === 'function',
                        explorerUi: typeof explorerUi.mountLabExplorer === 'function',
                        breadboard: typeof breadboard.createBreadboardTopology === 'function'
                            && breadboard.createBreadboardTopology().claims?.physicalPlacementVerified === false,
                        breadboardUi: typeof breadboardUi.mountBreadboardStudy === 'function',
                        timer2: typeof timer2.createAvrTimer2 === 'function'
                            && timer2.AVR_TIMER2_CAPABILITIES?.normalMode === true
                            && timer2.AVR_TIMER2_CAPABILITIES?.pwm === false
                            && timer2.AVR_TIMER2_CAPABILITIES?.toneParity === false,
                        dcNetwork: typeof dcNetwork.solveResistiveDC === 'function',
                        resistiveUi: typeof resistiveUi.mountResistiveStudy === 'function',
                        cssOk: css.ok && (await css.text()).includes('.lab-explorer'),
                    };
                }""")
                check("v16-offline-explorer-breadboard-timer2-modules-cached",
                      all(offline_v16_modules.values()),
                      json.dumps(offline_v16_modules, ensure_ascii=False))
                practice_offline = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [pure, ui, style] = await Promise.all([
                        import(new URL('./src/practice-evidence.js', baseUrl).href),
                        import(new URL('./src/practice-evidence-ui.js', baseUrl).href),
                        fetch(new URL('./styles/practice-evidence.css', baseUrl),
                              {cache:'no-store'}),
                    ]);
                    return {
                        pure: typeof pure.inspectPracticeEvidence === 'function',
                        ui: typeof ui.renderPracticeEvidence === 'function',
                        css: style.ok && (await style.text()).includes('.practice-evidence'),
                        lesson01: document.querySelectorAll('.lesson-link[data-lesson]').length === 16,
                    };
                }""")
                check("post-v16-practice-modules-and-css-available-offline",
                      all(practice_offline.values()),
                      json.dumps(practice_offline, ensure_ascii=False))
                authored_lab_offline = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [uno, checkpoints, placement, sketch, sketchUi, appCss] =
                      await Promise.all([
                        import(new URL('./src/uno-reference.js', baseUrl).href),
                        import(new URL('./src/practice-checkpoints.js', baseUrl).href),
                        import(new URL('./src/breadboard-placement.js', baseUrl).href),
                        import(new URL('./src/sketch-review.js', baseUrl).href),
                        import(new URL('./src/sketch-review-ui.js', baseUrl).href),
                        fetch(new URL('./styles/app.css', baseUrl), {cache:'no-store'}),
                      ]);
                    const cssText = appCss.ok ? await appCss.text() : '';
                    return {
                        uno: typeof uno.listUnoPinReferences === 'function'
                            && uno.UNO_REFERENCE_CLAIMS?.source === 'official-arduino-uno-r3-pinout',
                        checkpoints: typeof checkpoints.getPracticeCheckpoint === 'function'
                            && checkpoints.PRACTICE_CHECKPOINT_PROVENANCE?.teacherValidated === false,
                        placement: typeof placement.createBreadboardPlacement === 'function'
                            && placement.BREADBOARD_PLACEMENT_MODEL ===
                                'explicit-authored-breadboard-placement-v2',
                        sketch: typeof sketch.inspectSketchDraft === 'function'
                            && sketch.SKETCH_REVIEW_BOUNDARIES?.compilesCpp === false
                            && sketch.SKETCH_REVIEW_BOUNDARIES?.provesLearnerCompletion === false,
                        sketchUi: typeof sketchUi.renderSketchReview === 'function',
                        css: appCss.ok
                            && cssText.includes('.uno-pin-reference')
                            && cssText.includes('.sketch-review'),
                    };
                }""")
                check("post-v16-authored-lab-five-runtime-modules-available-offline",
                      all(authored_lab_offline.values()),
                      json.dumps(authored_lab_offline, ensure_ascii=False))
                interaction_offline = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [model, ui, session, observationDoc, resistiveDoc] = await Promise.all([
                        import(new URL('./src/practice-observation.js', baseUrl).href),
                        import(new URL('./src/practice-observation-ui.js', baseUrl).href),
                        import(new URL('./src/breadboard-placement-session.js', baseUrl).href),
                        fetch(new URL('./docs/PRACTICE_OBSERVATION_NEXT.md', baseUrl)),
                        fetch(new URL('./docs/RESISTIVE_VISUAL_STUDY_NEXT.md', baseUrl)),
                    ]);
                    return {
                        model: typeof model.createPracticeObservationJournal === 'function'
                            && typeof model.inspectPracticeObservation === 'function'
                            && model.PRACTICE_OBSERVATION_MAX_ENTRIES === 128,
                        ui: typeof ui.renderPracticeObservation === 'function'
                            && ui.renderObservation === ui.renderPracticeObservation,
                        session: typeof session.createBreadboardPlacementSession === 'function',
                        observationDoc: observationDoc.ok,
                        resistiveDoc: resistiveDoc.ok,
                    };
                }""")
                check("post-v16-interaction-runtime-and-docs-available-offline",
                      all(interaction_offline.values()),
                      json.dumps(interaction_offline, ensure_ascii=False))
                guided_wiring_offline = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [holeGrid, guidance, holeDoc, guidanceDoc, previewDoc] =
                      await Promise.all([
                        import(new URL('./src/breadboard-hole-grid.js', baseUrl).href),
                        import(new URL('./src/practice-wire-guidance.js', baseUrl).href),
                        fetch(new URL('./docs/BREADBOARD_HOLE_PICKER_NEXT.md', baseUrl)),
                        fetch(new URL('./docs/PRACTICE_WIRE_GUIDANCE_NEXT.md', baseUrl)),
                        fetch(new URL('./docs/SCENE_WIRE_PREVIEW_NEXT.md', baseUrl)),
                      ]);
                    const page1 = holeGrid.createBreadboardHoleGridPage({
                        profileId:'generic-63x10-terminal-strips',page:1,
                    });
                    return {
                        holeGrid: typeof holeGrid.createBreadboardHoleGridPage === 'function'
                            && typeof holeGrid.pickBreadboardGridHole === 'function'
                            && page1.pageSize === 8 && page1.holes.length === 80,
                        guidance: typeof guidance.inspectPracticeWireGuidance === 'function',
                        holeDoc: holeDoc.ok,
                        guidanceDoc: guidanceDoc.ok,
                        previewDoc: previewDoc.ok,
                    };
                }""")
                check("post-v16-guided-wiring-runtime-and-docs-available-offline",
                      all(guided_wiring_offline.values()),
                      json.dumps(guided_wiring_offline, ensure_ascii=False))
                fidelity_docs_offline = app.evaluate("""async () => {
                    const names = [
                        './docs/SCENE_VISUAL_FIDELITY_NEXT.md',
                        './docs/PRACTICE_CHECKLIST_NEXT.md',
                        './docs/SKETCH_LEXICAL_FEEDBACK_NEXT.md',
                    ];
                    const rows = await Promise.all(names.map(async name => {
                        const response = await fetch(new URL(name, document.baseURI), {cache:'no-store'});
                        return {name,ok:response.ok,contents:response.ok ? (await response.text()).length : 0};
                    }));
                    return rows;
                }""")
                check("vnext-three-new-fidelity-provenance-guides-available-offline",
                      len(fidelity_docs_offline) == 3
                      and all(row["ok"] and row["contents"] > 150 for row in fidelity_docs_offline),
                      json.dumps(fidelity_docs_offline, ensure_ascii=False))
                # Requiring the peripheral adapter to load while the browser
                # is actually offline guards its lazy ES-module imports and
                # SHA-verified firmware fetches, not just cached file names.
                app.locator("#avrPeripheralMode").check()
                app.locator("#avrLoad").click()
                app.wait_for_function(
                    "document.querySelector('#avrStatus')?.dataset.kind === 'success'",
                    timeout=20000,
                )
                check("offline-avr-peripheral-sha-verified-load",
                      "Đã xác minh SHA-256" in app.locator("#avrStatus").inner_text()
                      and "ngoại vi có giới hạn" in app.locator("#avrStatus").inner_text()
                      and app.locator("#avrPeripheralState").is_visible()
                      and "chưa nhập điện áp" in app.locator("#avrPeripheralState").inner_text())
                for _ in range(4):
                    app.locator("#avrCycle").click()
                check("offline-compiled-firmware-peripheral-d13",
                      "GPIO PB5 / Arduino D13: output · HIGH" in
                      app.locator("#avrPeripheralState").inner_text()
                      and "USART0 TX: 0 byte" in app.locator("#avrPeripheralState").inner_text())
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

    # The default Windows console codec may be cp1252 even for Vietnamese
    # course text. Do not turn a fully passing browser run into a print error.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
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
