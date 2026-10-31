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

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

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
    failed_requests: list[dict[str, str]] = []
    page_sequence = 0

    def check(name: str, passed: bool, details: str = "") -> None:
        report.append({"name": name, "passed": bool(passed), "details": details})
        if not passed:
            raise AssertionError(f"{name}: {details}")

    def ready(page) -> None:
        try:
            page.wait_for_function("document.documentElement.dataset.ready === '3d'", timeout=20000)
        except Exception as error:
            # Fail closed on WebGL fallback rather than quietly treating 2D
            # content readiness as real Three.js coverage. Include the actual
            # app state to distinguish a GPU allocation issue from a JS error.
            try:
                actual = page.evaluate("""() => ({
                    ready: document.documentElement.dataset.ready || null,
                    canvas: !!document.querySelector('#sceneMount canvas'),
                    fallback: document.querySelector('.scene-fallback')?.textContent || '',
                    lesson: document.querySelector('#lessonTitle')?.textContent || '',
                    documentState: document.readyState,
                    url: location.href,
                    scripts: Array.from(document.querySelectorAll('script[src]'), script => script.getAttribute('src')),
                    serviceWorkerControlled: !!navigator.serviceWorker?.controller,
                })""")
                actual["recentPageErrors"] = errors[-6:]
                actual["recentConsoleErrors"] = console_errors[-6:]
                actual["recentFailedRequests"] = [
                    item for item in failed_requests[-30:]
                    if item["pageUrl"] == page.url
                ][-8:]
            except Exception as diagnostic_error:
                actual = {"diagnosticError": str(diagnostic_error)}
            raise AssertionError("3D readiness failed: " +
                                 json.dumps(actual, ensure_ascii=True)) from error

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

    def legacy_scene_button_pixel(page, lesson_id: int):
        """Independently project the visible lesson-JS button cap, not a fake DOM click.

        The actual production Three.js raycast and canonical host button path
        remain the authority for whether the real mouse/touch gesture works.
        These coordinates are conceptual scene geometry, never mm/CAD.
        """
        if lesson_id not in (3, 16):
            raise ValueError("3D press control belongs only to lessons 3/16")
        # A prior HTML-keyboard action can legitimately scroll the document
        # down to the control panel, leaving the still-active 3D canvas above
        # the viewport. A real learner must scroll back to the 3D part before
        # pressing it. Scroll BEFORE projecting screen coordinates, rather
        # than sending a synthetic mouse click to a negative/offscreen Y.
        page.locator("#sceneMount canvas").scroll_into_view_if_needed()
        return page.evaluate("""async lessonId => {
            const T=await import('./assets/vendor/three.module.min.js');
            const canvas=document.querySelector('#sceneMount canvas');
            if(!canvas)throw new Error('3D button canvas missing');
            const rect=canvas.getBoundingClientRect();
            const aspect=Math.max(1,canvas.clientWidth)/Math.max(1,canvas.clientHeight);
            const fov=38,theta=.48,phi=.94;
            const fitted=Math.max(16.7,18.5/(2*Math.tan(T.MathUtils.degToRad(fov/2))*Math.max(.45,aspect)));
            const radius=Math.min(48,Math.max(8,fitted));
            const camera=new T.PerspectiveCamera(fov,aspect,.1,100);
            camera.position.set(radius*Math.sin(phi)*Math.sin(theta),
                radius*Math.cos(phi)+5,radius*Math.sin(phi)*Math.cos(theta));
            camera.lookAt(1.15,.35,0);
            camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
            // Legacy module root world position (5.15,.55,.10); cap centers
            // are lesson03 (.0,.57,.0), lesson16 (-.85,.65,.25).
            // The app's initial lesson-JS snapshot places both released cap
            // centers at local y=.57, module root y=.55. Picking the actual
            // mesh center is more deterministic than a point above its top.
            const point=lessonId===3
              ?new T.Vector3(5.15,1.12,.10)
              :new T.Vector3(4.30,1.12,.35);
            const screen=point.project(camera);
            const x=rect.left+(screen.x+1)*rect.width/2;
            const y=rect.top+(1-screen.y)*rect.height/2;
            return Object.freeze({
                x,y,
                inViewport:screen.z>=-1&&screen.z<=1,
                insideCanvas:Math.abs(screen.x)<1&&Math.abs(screen.y)<1,
                onScreen:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,
                canvasUncovered:document.elementFromPoint(x,y)===canvas,
            });
        }""", lesson_id)

    def lesson04_scene_knob_pixel(page):
        """Project the actual lesson04 rotor center for REAL pointer gesture QA.

        The 3D knob is an educational input surface, not a measured shaft
        position or verified physical sweep. Source geometry: current legacy
        module root (5.15,.55,.10), knob local center (0,.65,0). The scene's
        own tagged-mesh raycast remains responsible for actual accepted hits.
        """
        page.locator("#sceneMount canvas").scroll_into_view_if_needed()
        return page.evaluate("""async () => {
            const T=await import('./assets/vendor/three.module.min.js');
            const canvas=document.querySelector('#sceneMount canvas');
            if(!canvas)throw new Error('Lesson04 3D canvas missing');
            const rect=canvas.getBoundingClientRect();
            const aspect=Math.max(1,canvas.clientWidth)/Math.max(1,canvas.clientHeight);
            const fov=38,theta=.48,phi=.94;
            const fitted=Math.max(16.7,18.5/(2*Math.tan(T.MathUtils.degToRad(fov/2))*Math.max(.45,aspect)));
            const radius=Math.min(48,Math.max(8,fitted));
            const camera=new T.PerspectiveCamera(fov,aspect,.1,100);
            camera.position.set(radius*Math.sin(phi)*Math.sin(theta),
                radius*Math.cos(phi)+5,radius*Math.sin(phi)*Math.cos(theta));
            camera.lookAt(1.15,.35,0);
            camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
            const screenPoint=point=>{
                const projected=point.project(camera);
                const x=rect.left+(projected.x+1)*rect.width/2;
                const y=rect.top+(1-projected.y)*rect.height/2;
                return Object.freeze({x,y,
                    insideFrustum:projected.z>=-1&&projected.z<=1,
                    insideCanvas:Math.abs(projected.x)<1&&Math.abs(projected.y)<1,
                    onScreen:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,
                    canvasUncovered:document.elementFromPoint(x,y)===canvas,
                });
            };
            const knob=screenPoint(new T.Vector3(5.15,1.20,.10));
            // Same independent non-hit fixture used by the scene raycast
            // contract: nearby legacy potentiometer body, outside knob mesh.
            const nonKnob=screenPoint(new T.Vector3(5.82,.87,.60));
            // Measure the published mesh itself; this is evidence only and is
            // never used as an enlarged hit target. Production remains the
            // native Three.js raycast against its exact knob mesh.
            const geometry=new T.CylinderGeometry(.51,.51,.38,20);
            const position=geometry.getAttribute('position');
            let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
            const worldCenter=new T.Vector3(5.15,1.20,.10);
            const vertex=new T.Vector3();
            for(let index=0;index<position.count;index++){
                vertex.fromBufferAttribute(position,index).add(worldCenter).project(camera);
                const px=rect.left+(vertex.x+1)*rect.width/2;
                const py=rect.top+(1-vertex.y)*rect.height/2;
                minX=Math.min(minX,px);maxX=Math.max(maxX,px);
                minY=Math.min(minY,py);maxY=Math.max(maxY,py);
            }
            geometry.dispose();
            const projectedBounds=Object.freeze({
                left:minX,top:minY,right:maxX,bottom:maxY,
                width:maxX-minX,height:maxY-minY,
            });
            return Object.freeze({...knob,nonKnob,projectedBounds});
        }""")

    def lesson04_analog_acceptance_state(page):
        """Read host/scene/output agreement without reaching into app-private state."""
        return page.evaluate("""async () => {
            const input=document.querySelector('#control-analog');
            const canvas=document.querySelector('#sceneMount canvas');
            if(!(input instanceof HTMLInputElement)||input.type!=='range'||!canvas){
                throw new Error('Lesson04 canonical analog UI/scene missing');
            }
            const {simulate}=await import('./src/simulator.js');
            const value=Number(input.value);
            const snapshot=simulate(4,{analog:value},0,false,{});
            const rotation=Number(canvas.dataset.lessonPotVisualRotationY);
            return Object.freeze({
                value,
                hostOutput:input.closest('.control-field')?.querySelector('output')?.textContent||'',
                simOutput:document.querySelector('#simOutput')?.textContent||'',
                snapshotValue:snapshot.value,
                snapshotStatus:snapshot.status,
                sceneMode:canvas.dataset.lessonPotMode||'',
                sceneValue:canvas.dataset.lessonPotValue||'',
                gesture:canvas.dataset.lessonPotGesture||'',
                physicalVerified:canvas.dataset.lessonPotPhysicalVerified||'',
                electricalAuthority:canvas.dataset.lessonPotElectricalAuthority||'',
                visualRotation:Number.isFinite(rotation)?rotation:null,
                expectedRotation:value/1023*Math.PI*1.7,
            });
        }""")

    def lesson04_analog_state_agrees(actual: dict[str, object]) -> bool:
        value = int(actual["value"])
        rotation = actual.get("visualRotation")
        return (
            0 <= value <= 1023
            and actual.get("hostOutput") == str(value)
            and actual.get("sceneMode") == "enabled"
            and actual.get("sceneValue") == str(value)
            and actual.get("physicalVerified") == "false"
            and actual.get("electricalAuthority") == "false"
            and actual.get("simOutput") ==
                f"{actual.get('snapshotValue')} · {actual.get('snapshotStatus')}"
            and isinstance(rotation, (int, float))
            and abs(float(rotation) - float(actual["expectedRotation"])) < 1e-8
        )

    def lab_scene_breadboard_hole_points(page, lesson_id: int, hole_ids: list[str]):
        """Project source-defined CONCEPTUAL A1..J63 visual markers for real pointer QA.

        This duplicates only the published scene's drawing transform for the
        test ray origin. The production raycaster + study controller still own
        and validate the actual pointer interaction and canonical ID.
        The coordinates are neither CAD/mm nor an electrical hole mapping.
        """
        return page.evaluate(
            """async ({lessonId,ids}) => {
                const [T, layoutModule, router] = await Promise.all([
                    import('./assets/vendor/three.module.min.js'),
                    import('./src/lab-layout.js'),
                    import('./src/circuit-router.js'),
                ]);
                const layout=layoutModule.createLabLayout(lessonId,router.listTerminals(lessonId));
                const component=layout.components.find(item=>item.visualKind==='breadboard');
                const canvas=document.querySelector('#sceneMount canvas');
                if(!component||!canvas)throw Error('Conceptual breadboard layout/canvas missing');
                const rect=canvas.getBoundingClientRect();
                const aspect=Math.max(1,canvas.clientWidth)/Math.max(1,canvas.clientHeight);
                const fov=38,theta=.48,phi=.94,zoom=1;
                const fitted=Math.max(16.7,18.5/
                    (2*Math.tan(T.MathUtils.degToRad(fov/2))*Math.max(.45,aspect)));
                const radius=Math.min(48,Math.max(8,fitted*zoom));
                const camera=new T.PerspectiveCamera(fov,aspect,.1,100);
                camera.position.set(radius*Math.sin(phi)*Math.sin(theta),
                    radius*Math.cos(phi)+5,radius*Math.sin(phi)*Math.cos(theta));
                camera.lookAt(
                    ((layout.bounds.minX+layout.bounds.maxX)/2)*.72,
                    .35,((layout.bounds.minZ+layout.bounds.maxZ)/2)*.72
                );
                camera.updateProjectionMatrix();
                camera.updateMatrixWorld(true);
                const rowZ=[-.30,-.24,-.18,-.12,-.06,.06,.12,.18,.24,.30];
                return ids.map(id=>{
                    const m=/^([A-J])([1-9]|[1-5][0-9]|6[0-3])$/.exec(id);
                    if(!m)throw Error('Noncanonical test hole '+id);
                    const row=m[1].charCodeAt(0)-65,col=Number(m[2])-1;
                    const localX=-component.width*.72*.39+
                        component.width*.72*.78*col/62;
                    const localZ=component.depth*.72*rowZ[row];
                    const angle=-component.quarterTurns*Math.PI/2;
                    const worldX=component.x*.72+
                        localX*Math.cos(angle)+localZ*Math.sin(angle);
                    const worldZ=component.z*.72+
                        -localX*Math.sin(angle)+localZ*Math.cos(angle);
                    const projected=new T.Vector3(worldX,.33,worldZ).project(camera);
                    const x=rect.left+(projected.x+1)*rect.width/2;
                    const y=rect.top+(1-projected.y)*rect.height/2;
                    return {
                        id,x,y,
                        visible:projected.z>=-1&&projected.z<=1&&
                            x>=rect.left&&x<=rect.right&&
                            y>=rect.top&&y<=rect.bottom,
                        uncovered:document.elementFromPoint(x,y)===canvas,
                    };
                });
            }""",
            {"lessonId":lesson_id,"ids":hole_ids},
        )

    def lab_scene_committed_wire_points(page, lesson_id: int, from_id: str, to_id: str,
                                        wire_index: int = 0):
        """Candidate screen points on a COMMITTED 8-point conceptual route.

        Compute from the existing public logical layout/Three.js projection;
        only actual Playwright pointer input on the canvas can prove picking.
        No internal scene callback or wire ID is invoked by this helper.
        """
        return page.evaluate("""async ({lessonId,fromId,toId,wireIndex}) => {
          const [T,layoutModule,router]=await Promise.all([
            import('./assets/vendor/three.module.min.js'),
            import('./src/lab-layout.js'),
            import('./src/circuit-router.js'),
          ]);
          const layout=layoutModule.createLabLayout(lessonId,router.listTerminals(lessonId));
          const cHeight=kind=>kind==='arduino-uno'?.46:kind==='breadboard'?.34:
            kind==='ultrasonic-sensor'?.68:kind==='servo'||kind==='driver'?.62:
            kind==='power-source'?.55:.48;
          const toWorld=id=>{
            const anchor=layoutModule.labTerminalAnchor(layout,id);
            const component=layout.components.find(x=>x.id===anchor.componentId);
            if(!component)throw new Error('Missing canonical component for '+id);
            return new T.Vector3(anchor.x*.72,cHeight(component.visualKind)+.10,anchor.z*.72);
          };
          const start=toWorld(fromId),end=toWorld(toId);
          const direction=end.x>=start.x?1:-1;
          const lead=Math.min(.36,Math.max(.16,Math.abs(end.x-start.x)*.12));
          const routeOffset=((wireIndex%5)-2)*.085;
          const laneY=Math.max(start.y,end.y)+.34+(wireIndex%4)*.065;
          const midX=(start.x+end.x)/2+routeOffset;
          const points=[start,
            new T.Vector3(start.x,laneY,start.z),
            new T.Vector3(start.x+direction*lead,laneY,start.z),
            new T.Vector3(midX,laneY,start.z),
            new T.Vector3(midX,laneY,end.z),
            new T.Vector3(end.x-direction*lead,laneY,end.z),
            new T.Vector3(end.x,laneY,end.z),end];
          const canvas=document.querySelector('#sceneMount canvas');
          const rect=canvas.getBoundingClientRect();
          const aspect=Math.max(1,canvas.clientWidth)/Math.max(1,canvas.clientHeight);
          const camera=new T.PerspectiveCamera(38,aspect,.1,100);
          const fitted=Math.max(16.7,18.5/(2*Math.tan(T.MathUtils.degToRad(19))*Math.max(.45,aspect)));
          const radius=Math.min(48,Math.max(8,fitted));
          camera.position.set(radius*Math.sin(.94)*Math.sin(.48),radius*Math.cos(.94)+5,
            radius*Math.sin(.94)*Math.cos(.48));
          camera.lookAt(((layout.bounds.minX+layout.bounds.maxX)/2)*.72,.35,
            ((layout.bounds.minZ+layout.bounds.maxZ)/2)*.72);
          camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
          const coords=[];
          for(const [a,b] of [[2,3],[3,4],[4,5],[1,2],[5,6],[0,1],[6,7]]){
            for(const fraction of [.25,.50,.75]){
              const projected=points[a].clone().lerp(points[b],fraction).project(camera);
              const x=rect.left+(projected.x+1)*rect.width/2;
              const y=rect.top+(1-projected.y)*rect.height/2;
              if(projected.z>=-1&&projected.z<=1&&x>=rect.left+10&&x<=rect.right-10&&
                y>=rect.top+10&&y<=rect.bottom-10&&document.elementFromPoint(x,y)===canvas){
                coords.push({x,y,segment:[a,b],fraction});
              }
            }
          }
          return coords;
        }""", {"lessonId":lesson_id,"fromId":from_id,"toId":to_id,"wireIndex":wire_index})

    def capture_console(page) -> str:
        nonlocal page_sequence
        page_sequence += 1
        page_key = f"page-{page_sequence}"
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("requestfailed", lambda request: failed_requests.append({
            "pageUrl": page.url,
            "requestUrl": request.url,
            "failure": request.failure or "unknown",
        }))

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

    class LocalE2EServer(http.server.ThreadingHTTPServer):
        # ThreadingHTTPServer inherits TCPServer's backlog of FIVE. Chromium's
        # initial parallel ES-module requests can exceed that queue under
        # Windows/runner contention and return ERR_CONNECTION_REFUSED for an
        # existing file. Keep the real localhost server and fatal 404/console
        # assertions; only allow bounded pending simultaneous TCP accepts.
        request_queue_size = 128

    server = LocalE2EServer(
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
                      and scene_lifecycle["passed"] == scene_lifecycle["total"] == 422
                      and "lesson-pot-source-pot-actuation-owns-canvas-touch-action-before-pointerdown-and-shares-lab-edit-owner" in
                          scene_lifecycle_names
                      and "lesson-pot-source-pointerup-folds-final-pot-delta-before-clearing-and-stops-if-callback-revokes" in
                          scene_lifecycle_names
                      and "lesson-pot-source-document-hidden-cancels-active-pot-gesture-without-final-replay" in
                          scene_lifecycle_names
                      and "lesson-pot-raycast-default-view-ray-hits-exact-lesson4-knob-center" in
                          scene_lifecycle_names
                      and "lesson4-potentiometer-immediate-host-ack-preserves-fractional-drag-accumulator" in
                          scene_lifecycle_names
                      and "lesson4-potentiometer-pointerup-folds-release-only-delta-before-change" in
                          scene_lifecycle_names
                      and "lesson4-potentiometer-mouse-drag-emits-input-to-original-callback-only" in
                          scene_lifecycle_names
                      and "lesson4-potentiometer-touch-successful-input-change-has-exact-meta" in
                          scene_lifecycle_names
                      and "lesson4-potentiometer-pen-successful-input-change-has-exact-meta" in
                          scene_lifecycle_names
                      and "lesson4-potentiometer-touch-cancel-keeps-last-value-without-final-change-or-stale-replay" in
                          scene_lifecycle_names
                      and "lesson-button-source-lesson3-and-16-own-exact-tagged-button-caps" in
                          scene_lifecycle_names
                      and "lesson3-button-mouse-pointerdown-emits-exact-true-meta" in
                          scene_lifecycle_names
                      and "lesson-button-touch-pointercancel-emits-true-false-exactly-once" in
                          scene_lifecycle_names
                      and "lesson-button-pen-lostcapture-emits-true-false-exactly-once" in
                          scene_lifecycle_names
                      and "lesson-button-context-loss-releases-false-once-and-disables" in
                          scene_lifecycle_names
                      and "committed-wire-repair-source-repair-intent-wireId-maps-to-canonical-id-in-both-identity-gates" in
                          scene_lifecycle_names
                      and "committed-wire-repair-source-ghost-is-explicitly-visual-only-and-nonauthoritative" in
                          scene_lifecycle_names
                      and "committed-wire-repair-mouse-drop-delegates-frozen-proposal-without-auto-confirm" in
                          scene_lifecycle_names
                      and "committed-wire-repair-supports-touch-and-pen-proposal-only" in
                          scene_lifecycle_names
                      and "committed-wire-repair-pointercancel-clears-ghost-without-proposal" in
                          scene_lifecycle_names
                      and "committed-wire-repair-lostcapture-clears-ghost-without-proposal" in
                          scene_lifecycle_names
                      and "committed-wire-repair-same-id-wiring-replacement-cancels-stale-drop" in
                          scene_lifecycle_names
                      and "hole-link-source-ghost-is-explicitly-nonauthoritative" in
                          scene_lifecycle_names
                      and "hole-link-source-same-profile-study-reprojection-does-not-cancel-hole-link-drag" in
                          scene_lifecycle_names
                      and "hole-link-raycast-native-instanced-raycast-selects-exact-instance-id" in
                          scene_lifecycle_names
                      and "breadboard-hole-link-mouse-drop-delegates-exactly-once-with-frozen-meta" in
                          scene_lifecycle_names
                      and "breadboard-hole-link-touch-drop-delegates-exactly-once-with-frozen-meta" in
                          scene_lifecycle_names
                      and "breadboard-hole-link-pen-drop-delegates-exactly-once-with-frozen-meta" in
                          scene_lifecycle_names
                      and "breadboard-hole-link-drop-allows-synchronous-controller-reprojection-without-stale-clear" in
                          scene_lifecycle_names
                      and "breadboard-hole-link-pointercancel-clears-ghost-without-drop" in
                          scene_lifecycle_names
                      and "breadboard-hole-link-lostcapture-clears-ghost-without-drop" in
                          scene_lifecycle_names
                      and "context-loss-resets-breadboard-hole-link-intent-and-ghost" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-active-status-and-630-instance-datasets" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-pointer-selects-canonical-A1-exactly-once" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-row-major-endpoint-J63-is-pointer-selectable" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-rejected-controller-pick-does-not-change-halo" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-drag-becomes-camera-not-selection" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-pointercancel-emits-no-selection" in
                          scene_lifecycle_names
                      and "context-loss-resets-breadboard-hole-study-and-cancels-pointer" in
                          scene_lifecycle_names
                      and "breadboard-hole-study-does-not-steal-committed-wire-priority" in
                          scene_lifecycle_names
                      and "committed-wire-pointer-tap-inspects-current-canonical-wire" in scene_lifecycle_names
                      and "committed-wire-pointer-inspection-is-visual-only" in scene_lifecycle_names
                      and "committed-wire-pointercancel-emits-no-inspection" in scene_lifecycle_names
                      and "committed-wire-inspection-rejects-stale-same-id-different-endpoints" in scene_lifecycle_names
                      and "authored-pair-guide-valid-result-is-frozen-view-only" in scene_lifecycle_names
                      and "authored-pair-guide-does-not-create-wire-or-scene-state-authority" in scene_lifecycle_names
                      and "authored-pair-guide-survives-setWiring-projection-after-guide-mount" in scene_lifecycle_names
                      and "terminal-drag-start" in " ".join(scene_lifecycle_names)
                      and "terminal-link-drag-validates-current-layout-canonical-distinct-endpoints" in
                          scene_lifecycle_names
                      and "terminal-link-drop-delegates-exact-callback-on-drag-only" in
                          scene_lifecycle_names
                      and "terminal-drag-touch-emits-once-through-controller-callback" in
                          scene_lifecycle_names
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
                      and fidelity["passed"] == fidelity["total"] == 31
                      and "source-terminal-drag-reuses-one-visual-only-ghost" in fidelity_names
                      and "source-uses-instancing-for-repeated-visual-detail" in fidelity_names
                      and "source-contact-strips-remain-nonauthoritative" in fidelity_names
                      and "source-component-fidelity-has-conceptual-provenance" in fidelity_names
                      and "clearing-committed-highlight-removes-endpoint-feedback-only" in fidelity_names
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
                scene_hole_bridge_contracts = run_page_contract(
                    page, "./tests/breadboard-scene-pick-contracts.js",
                    "runBreadboardScenePickContracts")
                scene_hole_bridge_names = set(scene_hole_bridge_contracts.get("checks", []))
                check("post-57d8b90-threejs-native-hole-selection-bridge-contracts",
                      scene_hole_bridge_contracts["passed"] ==
                        scene_hole_bridge_contracts["total"] == 24
                      and scene_hole_bridge_contracts.get("failed",0) == 0
                      and len(scene_hole_bridge_names)==24
                      and {
                          "scene-pick-pages-selects-contact-and-stays-input-only",
                          "native-strip-picker-notifies-same-read-only-selection-channel",
                          "scene-pick-rejects-when-3d-edit-is-not-active-with-no-side-effects",
                          "scene-pick-rejects-stale-lesson-and-profile-with-no-side-effects",
                          "scene-meta-must-be-exact-frozen-plain-own-data-pointer-boundary",
                          "scene-pick-rejects-noncanonical-or-nonstrip-hole-ids-atomically",
                          "scene-pick-rejects-stale-canonical-terminal-context-atomically",
                          "observer-errors-cannot-upgrade-selection-to-placement-authority",
                          "hole-link-controls-are-all-or-none-accessible-44px-and-toggle-keeps-focus",
                          "authored-hole-link-scene-first-direct-drag-confirm-is-explicit-and-canonical",
                          "denied-or-accessor-connect-receipt-keeps-ready-preview-and-no-auto-graph",
                          "drag-target-rejects-foreign-meta-profile-unassigned-and-same-hole-without-intent-change",
                          "successful-placement-mutation-revokes-revision-bound-intent-and-prevents-id-reuse",
                          "terminal-profile-and-lesson-changes-revoke-active-intent",
                          "lesson10-and-14-remain-visual-only-before-confirm",
                      }.issubset(scene_hole_bridge_names),
                      f"{scene_hole_bridge_contracts['passed']}/24 exact lesson/profile/frozen-meta/DOM/link-confirm checks")
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
                      and practice_ui_contracts["total"] == 44
                      and "canonical-missing-pairs-expose-native-3d-repair-intents-only-after-click" in
                          practice_ui_names
                      and "canonical-extra-review-pairs-expose-existing-jumper-review-intent-only" in
                          practice_ui_names
                      and "manual-lesson01-matched-and-forged-evidence-never-gain-repair-review-entrypoints" in
                          practice_ui_names
                      and "stale-repair-click-can-be-rejected-by-host-revalidation-without-mutation" in
                          practice_ui_names
                      and "authored-missing-pair-3d-preview-only-after-native-click-with-readonly-boundary" in
                          practice_ui_names
                      and "authored-48-steps-3d-preview-available-only-for-strict-real-missing-wiring-pairs" in
                          practice_ui_names
                      and "matched-manual-extra-reference-unknown-and-forged-rows-never-gain-3d-missing-action" in
                          practice_ui_names
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
                step_attempt_contracts=run_page_contract(
                    page,"./tests/practice-step-attempt-contracts.js",
                    "runPracticeStepAttemptContracts")
                attempt_contract_names=set(step_attempt_contracts.get("checks",[]))
                check("post-85ff-step-scoped-48-checkpoint-attempt-model-dom-contracts",
                      step_attempt_contracts["passed"]==
                        step_attempt_contracts["total"]==15
                      and step_attempt_contracts.get("failed",0)==0
                      and len(attempt_contract_names)==15
                      and {
                          "all-48-authored-steps-bind-exact-source-with-36-manual-12-wiring",
                          "events-require-active-exact-step-and-current-source",
                          "retry-and-cancel-invalidate-stale-callback-tokens",
                          "lesson10-and-14-remain-signal-only-with-no-functional-upgrade",
                          "attempt-model-has-no-circuit-graph-mutation-authority",
                          "native-ui-active-callbacks-pass-exact-token-without-mutating-model",
                      }.issubset(attempt_contract_names),
                      f"{step_attempt_contracts['passed']}/15 step-scoped exact-history/DOM checks")
                guided_contracts=run_page_contract(
                    page,"./tests/practice-guided-task-contracts.js",
                    "runPracticeGuidedTaskContracts")
                check("post-f714-guided-task-48-checkpoint-model-native-dom-contracts",
                      guided_contracts["passed"]==guided_contracts["total"]
                      and guided_contracts.get("failed",0)==0
                      and guided_contracts["total"]>=12,
                      f"{guided_contracts['passed']}/{guided_contracts['total']} guided task contracts")
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
                      and sketch_ui_contracts["total"] == 23,
                      f"{sketch_ui_contracts['passed']}/{sketch_ui_contracts['total']} passed")
                pin_evidence_contracts = run_page_contract(
                    page, "./tests/sketch-pin-evidence-contracts.js",
                    "runSketchPinEvidenceContracts")
                check("vnext-sketch-pin-static-source-only-provenance-negative-contracts",
                      pin_evidence_contracts["passed"] == pin_evidence_contracts["total"] == 23
                      and len(pin_evidence_contracts["checks"]) == 23,
                      f"{pin_evidence_contracts['passed']}/{pin_evidence_contracts['total']} lexical pin evidence; never compiled firmware")
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
                      timer2_contracts["passed"] == 16
                      and len(timer2_contracts["checks"]) == 16,
                      f"{timer2_contracts['passed']}/16 direct-model checks; bounded CTC OCR2A TOP, no stock-firmware parity claim")
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
                      and resistive_ui_contracts["total"] == 23,
                      f"{resistive_ui_contracts['passed']}/{resistive_ui_contracts['total']} source-verified visual-study checks")
                bb_session_contracts = run_page_contract(
                    page, "./tests/breadboard-placement-session-contracts.js",
                    "runBreadboardPlacementSessionContracts")
                check("post-v16-breadboard-placement-session-direct-contracts",
                      bb_session_contracts["passed"] == bb_session_contracts["total"]
                      and bb_session_contracts["passed"] == len(bb_session_contracts["checks"])
                      and bb_session_contracts["total"] == 28,
                      f"{bb_session_contracts['passed']}/{bb_session_contracts['total']} authored-session checks")

                authored_group_contracts = run_page_contract(
                    page, "./tests/breadboard-authored-groups-contracts.js",
                    "runBreadboardAuthoredGroupsContracts")
                check("vnext-breadboard-authored-contact-groups-read-only-negative-contracts",
                      authored_group_contracts["passed"] == authored_group_contracts["total"] == 19
                      and len(authored_group_contracts["checks"]) == 19,
                      f"{authored_group_contracts['passed']}/{authored_group_contracts['total']} session-authored contact group contracts")
                branch_solver_contracts = run_page_contract(
                    page,"./tests/resistive-branch-study-contracts.js",
                    "runResistiveBranchStudyContracts")
                check("vnext-ideal-dc-branch-ohm-kcl-zero-voltage-provenance-contracts",
                      branch_solver_contracts["passed"] == branch_solver_contracts["total"] == 20
                      and len(branch_solver_contracts["checks"]) == 20,
                      f"{branch_solver_contracts['passed']}/{branch_solver_contracts['total']} bounded ideal DC tests")
                uno_mechanical_contracts = run_page_contract(
                    page,"./tests/uno-mechanical-reference-contracts.js",
                    "runUnoMechanicalReferenceContracts")
                check("vnext-uno-a000066-mechanical-outline-source-without-cad-or-pin-map",
                      uno_mechanical_contracts["passed"] == uno_mechanical_contracts["total"] == 18
                      and len(uno_mechanical_contracts["checks"]) == 18,
                      f"{uno_mechanical_contracts['passed']}/{uno_mechanical_contracts['total']} manufacturer bounded geometry checks")
                mounting_evidence_contracts = run_page_contract(
                    page,"./tests/uno-mounting-evidence-contracts.js",
                    "runUnoMountingEvidenceContracts")
                check("vnext-a000066-partial-mounting-hole-axes-source-only-contracts",
                      mounting_evidence_contracts["passed"] == mounting_evidence_contracts["total"] == 13
                      and len(mounting_evidence_contracts["checks"]) == 13,
                      f"{mounting_evidence_contracts['passed']}/{mounting_evidence_contracts['total']} 3 full + 1 partial, not CAD")
                history_contracts = run_page_contract(
                    page,"./tests/learner-circuit-history-contracts.js",
                    "runLearnerCircuitHistoryContracts")
                check("vnext-router-canonical-learner-undo-redo-revision-negative-contracts",
                      history_contracts["passed"] == history_contracts["total"] == 14
                      and len(history_contracts["checks"]) == 14,
                      f"{history_contracts['passed']}/{history_contracts['total']} bounded learner graph history, no physical undo")
                checkpoint_trail_contracts = run_page_contract(
                    page, "./tests/practice-checkpoint-trail-contracts.js",
                    "runPracticeCheckpointTrailContracts")
                check("vnext-48-authored-learner-checkpoint-trail-canonical-negative-contracts",
                      checkpoint_trail_contracts["passed"] ==
                        checkpoint_trail_contracts["total"] == 16
                      and len(checkpoint_trail_contracts["checks"]) == 16,
                      f"{checkpoint_trail_contracts['passed']}/16 authored trail models, all 48 steps, no automatic completion")
                checkpoint_trail_ui_contracts = run_page_contract(
                    page, "./tests/practice-checkpoint-trail-ui-contracts.js",
                    "runPracticeCheckpointTrailUiContracts")
                check("vnext-48-step-native-checkpoint-trail-ui-negative-contracts",
                      checkpoint_trail_ui_contracts["passed"] ==
                        checkpoint_trail_ui_contracts["total"] == 14
                      and len(checkpoint_trail_ui_contracts["checks"]) == 14,
                      f"{checkpoint_trail_ui_contracts['passed']}/14 native trace/navigation checks, no learner-action inference")
                precision_wire_contracts = run_page_contract(
                    page, "./tests/lab-editor-precision-wires-contracts.js",
                    "runLabEditorPrecisionWiresContracts")
                check("vnext-3d-lab-precision-wire-removal-and-drag-bridge-negative-contracts",
                      precision_wire_contracts["passed"] ==
                        precision_wire_contracts["total"] == 6
                      and len(precision_wire_contracts["checks"]) == 6,
                      f"{precision_wire_contracts['passed']}/6 per-wire canonical edit and drag callbacks")

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
                page.locator(".wire-actions .wire-action").filter(has_text="Xóa dây").click()
                # Real pointer and keyboard-driven terminal interactions
                # exercise the UI path rather than only the pure circuit model.
                page.locator('[data-terminal="5V"]').click()
                page.locator('[data-terminal="BTN:1"]').click()
                check("wiring-click-connect",
                      page.locator(".wire-connected").count() == 1)
                check("electrical-incomplete-draft-blocked",
                      "Bản đấu dây đang chỉnh sửa" in page.locator("#electricalResult").inner_text()
                      and "Chưa thể tính dòng" in page.locator("#electricalResult").inner_text())
                page.locator(".wire-actions .wire-action").filter(has_text="Xóa dây").click()
                check("wiring-clear-after-click",
                      page.locator(".wire-connected").count() == 0)
                page.locator('[data-terminal="D13"]').drag_to(
                    page.locator('[data-terminal="R_LED:A"]'),
                    steps=8,
                )
                check("wiring-drag-connect",
                      page.locator(".wire-connected").count() == 1)
                page.locator(".wire-actions .wire-action").filter(has_text="Xóa dây").click()
                page.locator(".wire-actions .wire-action").filter(has_text="Mạch mẫu").click()
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
                page.locator(".wire-actions .wire-action").filter(has_text="Mạch mẫu").click()
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
                    page.locator(".wire-actions .wire-action").filter(has_text="Mạch mẫu").click()
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
                    page.locator(".wire-actions .wire-action").filter(has_text="Mạch mẫu").click()
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
                    practice_page.locator(".wire-actions .wire-action").filter(has_text="Mạch mẫu").click()
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
                    practice_page.locator(".wire-actions .wire-action").filter(has_text="Xóa dây").click()
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
                        practice_page.locator(".wire-actions .wire-action").filter(has_text="Mạch mẫu").click()
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

                # New post-v1.6 guided-inspection phase: exercise the REAL host
                # wiring/Explorer/Practice callbacks on one isolated page. The
                # dotted suggestion and wire highlight cannot become netlist.
                guided_context = browser.new_context(
                    viewport={"width": 1280, "height": 820}, service_workers="allow")
                try:
                    guided = guided_context.new_page()
                    capture_console(guided)
                    guided.goto(base, wait_until="domcontentloaded", timeout=20000)
                    ready(guided)
                    guided.locator('.lesson-link[data-lesson="2"]').click()
                    guided.locator("#bbProfile").select_option("generic-63x10-terminal-strips")
                    guided.locator("#bbTerminal").select_option("D13")
                    guided.locator("#bbPlaceHole").fill("A12")
                    guided.locator("#bbAssignHole").click()
                    guided.locator("#bbTerminal").select_option("R1:A")
                    guided.locator("#bbPlaceHole").fill("B12")
                    guided.locator("#bbAssignHole").click()
                    authored_group = guided.locator("#bbPlacedList [data-bb-authored-groups]")
                    group_rows = authored_group.locator("[data-bb-authored-group]")
                    group_labels = group_rows.all_inner_texts()
                    check("vnext-explicit-two-terminal-authored-hole-groups-same-profile-node-no-wire",
                          authored_group.get_attribute("role") == "region"
                          and authored_group.get_attribute("data-group-count") == "1"
                          and group_rows.count() == 1
                          and group_rows.first.get_attribute("data-bb-authored-group-status") == "known"
                          and group_rows.first.get_attribute("data-bb-authored-group-terminal-count") == "2"
                          and "D13" in group_labels[0] and "A12" in group_labels[0]
                          and "R1:A" in group_labels[0] and "B12" in group_labels[0]
                          and "không tự tạo dây" in authored_group.inner_text().lower()
                          and guided.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") == "0"
                          and guided.locator("#completeButton").is_hidden(),
                          json.dumps({"groups":group_labels}, ensure_ascii=False))
                    guided.locator('.lesson-link[data-lesson="3"]').click()
                    check("vnext-authored-group-lesson-switch-revokes-session-placement",
                          guided.locator("#bbPlacedList [data-bb-placement-item]").count() == 0
                          and guided.locator("#bbPlacedList [data-bb-authored-group]").count() == 0
                          and guided.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") == "0")
                    guided.locator('.lesson-link[data-lesson="2"]').click()
                    guided.locator("#infoTabPinout").click()
                    mech = guided.locator("[data-uno-mechanical-reference='outline-only']")
                    check("vnext-a000066-mechanical-outline-labelled-without-fake-cad-snap",
                          mech.get_attribute("role") == "group"
                          and mech.get_attribute("data-uno-scene-snap") == "unverified"
                          and "68,6" in mech.inner_text() and "53,4" in mech.inner_text()
                          and "66,04 × 50,80 mm" in mech.locator(".uno-mechanical-boundary").inner_text()
                          and "Ø3,2" in mech.inner_text()
                          and mech.locator("svg[role='img']").count() == 1
                          and "không thể hiện tọa độ lỗ" in
                              (mech.locator("svg").get_attribute("aria-label") or "")
                          and mech.locator("a").first.get_attribute("href") ==
                              "https://store.arduino.cc/products/arduino-uno-rev3"
                          and mech.locator("a").nth(1).get_attribute("href") ==
                              "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf"
                          and guided.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") == "0")

                    mounting = mech.locator('[data-uno-mounting-evidence="partial-dimensioned"]')
                    mounting_rows = mounting.locator('[data-uno-mounting-hole]')
                    dimensioned = mounting.locator('[data-uno-mounting-hole][data-uno-mounting-known-axes="x,y"]')
                    lower_left = mounting.locator('[data-uno-mounting-hole="lower-left"]')
                    guided.set_viewport_size({"width":375,"height":812})
                    body_width = guided.evaluate("document.documentElement.scrollWidth <= innerWidth")
                    check("vnext-a000066-only-three-dimensioned-hole-centers-no-physical-snap-375",
                          mounting.get_attribute("role") == "group"
                          and mounting.get_attribute("data-uno-hole-snap") == "unsupported"
                          and mounting_rows.count() == 4
                          and dimensioned.count() == 3
                          and lower_left.get_attribute("data-uno-mounting-known-axes") == "y"
                          and "Chưa có kích thước" in lower_left.inner_text()
                          and "không phải bản vẽ CAD hoàn chỉnh" in
                              mounting.locator(".uno-mounting-boundary").inner_text()
                          and body_width
                          and guided.locator("#sceneMount canvas").get_attribute("data-lab-wire-count") == "0",
                          json.dumps({"holes":mounting_rows.count(),
                              "completeXY":dimensioned.count(),
                              "viewportFits":body_width},ensure_ascii=False))
                    guided.set_viewport_size({"width":1280,"height":820})

                    guided.locator("#infoTabPractice").click()
                    # Regression from Ubuntu CI run 40827999649: inserting a
                    # second corrective action into the old two-column grid
                    # must not squeeze the original inspect target below 44px
                    # on system fonts or on the 375px learner viewport.
                    guided.set_viewport_size({"width":375,"height":812})
                    checklist_targets = guided.evaluate("""() => {
                        const bounds = selector => [...document.querySelectorAll(selector)].map(button => {
                            const rect=button.getBoundingClientRect();
                            return {width:rect.width,height:rect.height,
                              name:button.getAttribute('aria-label')||button.textContent?.trim()||''};
                        });
                        return {
                          inspect:bounds('#learningCoach [data-practice-checklist-inspect-terminal]'),
                          preview:bounds('#learningCoach [data-practice-preview-pair-2d]'),
                          viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
                        };
                    }""")
                    check("vnext-375px-authored-checklist-inspect-and-preview-targets-44px",
                          len(checklist_targets["inspect"]) == 3
                          and len(checklist_targets["preview"]) == 3
                          and all(item["width"] >= 44 and item["height"] >= 44
                                  and item["name"] for kind in ("inspect","preview")
                                  for item in checklist_targets[kind])
                          and checklist_targets["scrollWidth"] <= checklist_targets["viewport"],
                          json.dumps(checklist_targets,ensure_ascii=False))
                    guided.set_viewport_size({"width":1280,"height":820})
                    practice_pair = guided.locator(
                        "#learningCoach [data-practice-preview-pair-2d]").first
                    practice_pair_data = {
                        "from": practice_pair.get_attribute("data-practice-preview-from"),
                        "to": practice_pair.get_attribute("data-practice-preview-to"),
                        "name": practice_pair.get_attribute("aria-label"),
                    }
                    observed_before = guided.locator("#learningCoach [data-practice-observation]").get_attribute(
                        "data-observation-lesson-events")
                    practice_pair.focus()
                    practice_pair.press("Enter")
                    guided.wait_for_function("document.querySelector('[data-wire-suggestion-preview]') !== null")
                    suggested_host = guided.locator(".wiring-view")
                    check("vnext-authored-missing-pair-2d-keyboard-guidance-no-graph-or-journal",
                          practice_pair_data["from"] == "D13"
                          and practice_pair_data["to"] == "R1:A"
                          and "chưa tạo dây" in (practice_pair_data["name"] or "").lower()
                          and guided.locator("#stageTabWiring").get_attribute("aria-selected") == "true"
                          and suggested_host.get_attribute("data-wire-suggested-pair") == "D13|R1:A"
                          and suggested_host.locator("[data-wire-suggestion-preview]").count() == 1
                          and suggested_host.locator('[data-terminal="D13"][data-wire-suggested="from"]').count() == 1
                          and suggested_host.locator('[data-terminal="R1:A"][data-wire-suggested="to"]').count() == 1
                          and suggested_host.locator(".wire-connected").count() == 0
                          and guided.locator("#learningCoach [data-practice-observation]").get_attribute(
                              "data-observation-lesson-events") == observed_before
                          and guided.locator("#completeButton").is_hidden(),
                          json.dumps(practice_pair_data, ensure_ascii=False))
                    suggested_host.locator('[data-terminal="D13"]').click()
                    preview_settle_error = None
                    try:
                        guided.wait_for_function("""() => {
                            const host=document.querySelector('.wiring-view');
                            const d13=host?.querySelector('[data-terminal="D13"]');
                            return !!host
                              && !host.hasAttribute('data-wire-suggested-pair')
                              && host.querySelectorAll('[data-wire-suggestion-preview]').length===0
                              && d13?.getAttribute('aria-pressed')==='true';
                        }""", timeout=5000)
                    except PlaywrightTimeoutError as error:
                        preview_settle_error = str(error)
                    preview_settle = guided.evaluate("""() => {
                        const host=document.querySelector('.wiring-view');
                        const d13=host?.querySelector('[data-terminal="D13"]');
                        return {
                            suggestedPair:host?.getAttribute('data-wire-suggested-pair')??null,
                            previewCount:host?.querySelectorAll('[data-wire-suggestion-preview]').length??-1,
                            d13Pressed:d13?.getAttribute('aria-pressed')??null,
                            wireCount:host?.querySelectorAll('.wire-connected').length??-1,
                        };
                    }""")
                    check("vnext-view-only-2d-preview-clears-when-learner-arms-real-terminal",
                          preview_settle_error is None
                          and suggested_host.get_attribute("data-wire-suggested-pair") is None
                          and suggested_host.locator("[data-wire-suggestion-preview]").count() == 0
                          and suggested_host.locator('[data-terminal="D13"]').get_attribute(
                              "aria-pressed") == "true"
                          and suggested_host.locator(".wire-connected").count() == 0,
                          json.dumps({
                              "settleError": preview_settle_error,
                              **preview_settle,
                          }, ensure_ascii=False))
                    suggested_host.locator('[data-terminal="R1:A"]').click()
                    check("vnext-only-explicit-two-terminal-clicks-create-canonical-wire",
                          suggested_host.locator(".wire-connected").count() == 1
                          and suggested_host.get_attribute("data-wire-suggested-pair") is None
                          and guided.locator("#labExplorer [data-explorer-wire]").count() >= 1)
                    guided.locator("#stageTab3d").click()
                    guided.locator("#labEditToggle").click()
                    wire_button = guided.locator("#labExplorer [data-explorer-highlight-wire]").first
                    wire_id = wire_button.get_attribute("data-explorer-highlight-wire")
                    wire_button.focus()
                    wire_button.press("Enter")
                    scene_canvas = guided.locator("#sceneMount canvas")
                    check("vnext-existing-learner-wire-inspector-highlights-only-committed-3d-route",
                          wire_id is not None and not wire_button.is_disabled()
                          and scene_canvas.get_attribute("data-lab-wire-count") == "1"
                          and scene_canvas.get_attribute("data-lab-highlighted-wire") == wire_id
                          and scene_canvas.get_attribute("data-lab-wire-route-mode") == "elevated-multisegment"
                          and scene_canvas.get_attribute("data-lab-wire-route-point-count") == "8"
                          and scene_canvas.get_attribute("data-lab-pending-wire-terminal") == ""
                          and "nổi bật" in guided.locator("#labExplorer .lab-explorer-status").inner_text().lower(),
                          json.dumps({"wireId":wire_id,
                              "highlight":scene_canvas.get_attribute("data-lab-highlighted-wire"),
                              "route":scene_canvas.get_attribute("data-lab-wire-route-mode")}))
                    # Exercise the actual LabEditor callback-driven layout
                    # replacement. A scene-only visual transform would miss
                    # the setLabLayout teardown that previously lost highlight.
                    guided.locator("#labComponent").select_option("R1")
                    route_revision_before = int(scene_canvas.get_attribute(
                        "data-lab-wire-geometry-revision") or "0")
                    guided.locator('[data-lab-nudge="0.5,0"]').click()
                    route_revision_moved = int(scene_canvas.get_attribute(
                        "data-lab-wire-geometry-revision") or "0")
                    guided.locator("#labRotateRight").click()
                    route_revision_rotated = int(scene_canvas.get_attribute(
                        "data-lab-wire-geometry-revision") or "0")
                    check("vnext-existing-wire-highlight-survives-real-lab-move-and-rotate",
                          route_revision_before < route_revision_moved < route_revision_rotated
                          and scene_canvas.get_attribute("data-lab-highlighted-wire") == wire_id
                          and scene_canvas.get_attribute("data-lab-wire-count") == "1"
                          and guided.locator("#labExplorer [data-explorer-highlight-wire]").count() == 1
                          and scene_canvas.get_attribute("data-lab-pending-wire-terminal") == "",
                          json.dumps({"wireId":wire_id,
                              "revisions":[route_revision_before,route_revision_moved,
                                           route_revision_rotated]}))
                    guided.locator("#stageTabWiring").click()
                    check("vnext-3d-wire-highlight-clears-on-2d-stage-and-persists-learner-graph",
                          scene_canvas.get_attribute("data-lab-highlighted-wire") in ("", None)
                          and guided.locator(".wire-connected").count() == 1
                          and guided.locator("#labExplorer [data-explorer-wire]").count() >= 1)

                    guided.set_viewport_size({"width":375,"height":812})
                    guided.locator("#resistiveTopology").select_option("branch")
                    for selector,value in [
                        ("#resistiveV","5"),("#resistiveR1","1000"),
                        ("#resistiveR2","2000"),("#resistiveR3","2000"),
                    ]: guided.locator(selector).fill(value)
                    guided.locator("#resistiveSolve").click()
                    branch_figure = guided.locator("#resistiveDetails [data-resistive-branch-visual]")
                    branch_name = branch_figure.locator("svg").get_attribute("aria-label")
                    branch_rows = guided.locator("#resistiveDetails [data-resistive-branch-table] tbody tr")
                    branch_targets = guided.evaluate("""() =>
                        ['#resistiveTopology','#resistiveR3','#resistiveSolve'].map(s=>{
                            const r=document.querySelector(s).getBoundingClientRect();
                            return {width:r.width,height:r.height};
                        })""")
                    check("vnext-375px-three-resistor-branch-ohm-kcl-render-without-fake-measurement",
                          guided.locator("#resistiveResult").get_attribute("data-result") == "calculated"
                          and guided.locator("#resistiveResult").get_attribute("data-topology") == "branch"
                          and branch_rows.count() == 3
                          and branch_figure.locator("svg").get_attribute("role") == "img"
                          and all(token in (branch_name or "") for token in ("R1","R2","R3","MID","GND"))
                          and "2,5" in (branch_name or "")
                          and "KCL" in guided.locator("#resistiveDetails").inner_text()
                          and "không phải firmware" in guided.locator("#resistiveDetails").inner_text()
                          and all(item["width"] >= 44 and item["height"] >= 44 for item in branch_targets)
                          and guided.evaluate("document.documentElement.scrollWidth <= innerWidth")
                          and guided.locator(".wire-connected").count() == 1,
                          json.dumps({"name":branch_name,"targets":branch_targets},ensure_ascii=False))
                    guided.locator("#resistiveR3").fill("0")
                    guided.locator("#resistiveSolve").click()
                    check("vnext-branch-invalid-input-clears-stale-numeric-output",
                          guided.locator("#resistiveResult").get_attribute("data-result") == "error"
                          and guided.locator("#resistiveDetails").locator("*").count() == 0)
                    guided.locator("#resistiveTopology").select_option("divider")
                    guided.locator("#resistiveSolve").click()
                    check("vnext-return-to-divider-preserves-legacy-two-resistor-mode",
                          guided.locator("#resistiveResult").get_attribute("data-result") == "calculated"
                          and guided.locator("#resistiveResult").get_attribute("data-topology") == "divider"
                          and guided.locator("#resistiveDetails [data-resistive-divider-table] tbody tr").count() == 2)
                    # Router-generated IDs restart at w1 when a canonical
                    # learner graph is replaced. An old inspection of w1 on
                    # D13-R1:B must not silently become a highlight on the
                    # sample's different w1 edge D13-R1:A.
                    guided.set_viewport_size({"width":1280,"height":820})
                    guided.locator("#stageTab3d").click()
                    if guided.locator("#labEditToggle").get_attribute("aria-pressed") != "true":
                        guided.locator("#labEditToggle").click()
                    guided.locator("#labClearWires").click()
                    guided.locator("#labFromPin").select_option("D13")
                    guided.locator("#labToPin").select_option("R1:B")
                    guided.locator("#labConnect").click()
                    custom_wire = guided.locator("#labExplorer [data-explorer-highlight-wire]").first
                    custom_id = custom_wire.get_attribute("data-explorer-highlight-wire")
                    custom_wire.click()
                    custom_highlight = scene_canvas.get_attribute("data-lab-highlighted-wire")
                    guided.locator("#labSampleWires").click()
                    check("vnext-reused-wire-id-different-endpoints-clears-old-3d-highlight",
                          custom_id == "w1" and custom_highlight == "w1"
                          and scene_canvas.get_attribute("data-lab-highlighted-wire") in ("",None)
                          and scene_canvas.get_attribute("data-lab-wire-count") == "3"
                          and guided.locator("#labExplorer [data-explorer-highlight-wire]").count() == 3
                          and guided.locator("#completeButton").is_hidden(),
                          json.dumps({"oldId":custom_id,"oldHighlight":custom_highlight,
                              "newHighlight":scene_canvas.get_attribute("data-lab-highlighted-wire"),
                              "newWireCount":scene_canvas.get_attribute("data-lab-wire-count")}))
                finally:
                    guided_context.close()

                # Real shared learner graph history across TWO editors and a
                # lesson switch, plus source-only Sketch pin lexical feedback.
                # No preview or undo/redo may become proof of physical wiring,
                # Sketch compilation, mastery or completion.
                history_context = browser.new_context(
                    viewport={"width":1280,"height":820}, service_workers="allow")
                try:
                    history_page=history_context.new_page()
                    capture_console(history_page)
                    history_page.goto(base, wait_until="domcontentloaded", timeout=20000)
                    ready(history_page)
                    history_page.locator('.lesson-link[data-lesson="2"]').click()
                    history_page.locator("#stageTabWiring").click()
                    undo_2d=history_page.locator('.wire-actions [aria-label="Hoàn tác trạng thái đấu dây trước đó trong ứng dụng"]')
                    redo_2d=history_page.locator('.wire-actions [aria-label="Làm lại trạng thái đấu dây tiếp theo trong ứng dụng"]')
                    check("vnext-learner-history-initial-empty-disabled-not-reference-fallback",
                          undo_2d.count()==1 and redo_2d.count()==1
                          and undo_2d.is_disabled() and redo_2d.is_disabled()
                          and history_page.locator(".wiring-view .wire-connected").count()==0)
                    history_page.locator('.wiring-view [data-terminal="D13"]').click()
                    history_page.locator('.wiring-view [data-terminal="R1:A"]').click()
                    check("vnext-real-2d-wire-connect-opens-undo-only",
                          history_page.locator(".wiring-view .wire-connected").count()==1
                          and not undo_2d.is_disabled() and redo_2d.is_disabled()
                          and history_page.locator("#completeButton").is_hidden())
                    undo_2d.click()
                    check("vnext-real-2d-undo-restores-empty-canonical-graph",
                          history_page.locator(".wiring-view .wire-connected").count()==0
                          and undo_2d.is_disabled() and not redo_2d.is_disabled())
                    redo_2d.click()
                    check("vnext-real-2d-redo-restores-exact-learner-edge",
                          history_page.locator(".wiring-view .wire-connected").count()==1
                          and "D13" in history_page.locator(".wiring-view .wire-connected").inner_text()
                          and not undo_2d.is_disabled() and redo_2d.is_disabled())
                    history_page.locator("#stageTab3d").click()
                    history_page.locator("#labEditToggle").click()
                    undo_3d=history_page.locator("#labUndoWire")
                    redo_3d=history_page.locator("#labRedoWire")
                    check("vnext-3d-lab-history-native-controls-from-same-learner-graph",
                          undo_3d.is_visible() and not undo_3d.is_disabled()
                          and redo_3d.is_disabled()
                          and undo_3d.bounding_box()["height"]>=44
                          and history_page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="1")
                    history_page.locator("#labFromPin").select_option("R1:B")
                    history_page.locator("#labToPin").select_option("LED:A")
                    history_page.locator("#labConnect").click()
                    check("vnext-3d-router-connection-records-reversible-graph",
                          history_page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="2"
                          and not undo_3d.is_disabled() and redo_3d.is_disabled())
                    undo_3d.click()
                    check("vnext-3d-undo-revokes-newest-edge-without-reference-fallback",
                          history_page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="1"
                          and not redo_3d.is_disabled())
                    redo_3d.click()
                    check("vnext-3d-redo-restores-newest-canonical-edge",
                          history_page.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="2"
                          and redo_3d.is_disabled())
                    history_page.locator('.lesson-link[data-lesson="3"]').click()
                    history_page.locator("#stageTabWiring").click()
                    history_lesson3_empty=history_page.locator(".wiring-view .wire-connected").count()==0
                    history_page.locator('.lesson-link[data-lesson="2"]').click()
                    history_page.locator("#stageTabWiring").click()
                    restored_count=history_page.locator(".wiring-view .wire-connected").count()
                    history_page.locator('.wire-actions [aria-label="Hoàn tác trạng thái đấu dây trước đó trong ứng dụng"]').click()
                    check("vnext-lesson-switch-preserves-per-lesson-undo-stack-no-cross-lesson-leak",
                          history_lesson3_empty and restored_count==2
                          and history_page.locator(".wiring-view .wire-connected").count()==1
                          and history_page.locator("#completeButton").is_hidden())

                    progress_before_pins=history_page.locator("#progressText").inner_text()
                    wire_count_before_pins=history_page.locator(".wiring-view .wire-connected").count()
                    history_page.locator("#editCode").click()
                    learner_source=(
                        'void setup(){pinMode(13,OUTPUT);}'
                        '\nvoid loop(){'
                        '\n// digitalWrite(12,HIGH);'
                        '\nconst char* spoof="tone(7,440)";'
                        '\ndigitalWrite(13,HIGH);'
                        '\ndigitalWrite(PIN,HIGH);'
                        '\n}'
                    )
                    history_page.locator("#codeEditor").fill(learner_source)
                    pin_region=history_page.locator("#sketchReviewMount [data-sketch-pin-evidence]")
                    pin_calls=pin_region.locator("[data-sketch-pin-evidence-call]")
                    check("vnext-edited-sketch-real-ui-pin-evidence-static-not-compiled-or-wired",
                          pin_region.count()==1
                          and pin_region.get_attribute("data-sketch-pin-evidence-call-count")=="3"
                          and pin_calls.count()==3
                          and pin_region.locator('[data-sketch-pin-evidence-terminal="D13"]').count()==2
                          and pin_region.locator('[data-sketch-pin-evidence-status="unknown"]').count()==1
                          and "không biên dịch Arduino C++" in pin_region.inner_text()
                          and "không chạy firmware" in pin_region.inner_text()
                          and "Mã đã sửa" in history_page.locator("#avrDraftNote").inner_text()
                          and history_page.locator(".wiring-view .wire-connected").count()==wire_count_before_pins
                          and history_page.locator("#progressText").inner_text()==progress_before_pins,
                          json.dumps({"calls":pin_calls.count(),"statuses":pin_calls.all_inner_texts()},ensure_ascii=False))
                finally:
                    history_context.close()

                # New product-capability checks exercise the actual mounted
                # 16-lesson practice trail, native per-wire editing, and
                # Sketch-to-Inspector handoff. A dedicated context avoids
                # carrying false learner progress into the historical tests.
                rich_context = browser.new_context(
                    viewport={"width":1280,"height":820}, service_workers="allow")
                try:
                    rich = rich_context.new_page()
                    capture_console(rich)
                    rich.goto(base, wait_until="domcontentloaded", timeout=20000)
                    ready(rich)
                    trail_rows = []
                    for lesson_id in range(1,17):
                        rich.locator(f'.lesson-link[data-lesson="{lesson_id}"]').click()
                        rich.locator('#infoTabPractice').click()
                        trail = rich.locator('#learningCoach [data-practice-checkpoint-trail]')
                        trail_rows.append({
                            "lesson":lesson_id,
                            "actual":trail.get_attribute("data-practice-trail-lesson"),
                            "rows":trail.locator("[data-practice-trail-step]").count(),
                            "current":trail.get_attribute("data-practice-trail-current-step"),
                            "scope":trail.get_attribute("data-practice-trail-scope"),
                            "manualCount":trail.locator(
                                '[data-practice-trail-step-status="manual-not-automatically-assessed"]').count(),
                            "boundary":"không tự hoàn thành bài" in trail.locator(
                                "[data-practice-trail-boundary]").inner_text(),
                        })
                    check("post-v16-rich-48-authored-checkpoints-real-16-lesson-navigation",
                          len(trail_rows)==16
                          and all(row["actual"]==str(row["lesson"]) and row["rows"]==3
                                  and row["current"]=="0" and row["boundary"]
                                  for row in trail_rows)
                          and all(row["scope"]=="signal-only" for row in trail_rows
                                  if row["lesson"] in (10,14))
                          and all(row["scope"]=="manual-only" for row in trail_rows
                                  if row["lesson"]==1)
                          and all(row["scope"]=="topology" for row in trail_rows
                                  if row["lesson"] in range(2,17) and row["lesson"] not in (10,14)),
                          json.dumps(trail_rows,ensure_ascii=False))

                    rich.locator('.lesson-link[data-lesson="2"]').click()
                    rich.locator('#infoTabPractice').click()
                    trail = rich.locator('#learningCoach [data-practice-checkpoint-trail]')
                    initial_progress = rich.locator("#progressText").inner_text()
                    step_two = trail.locator('[data-practice-trail-navigate-step="1"]')
                    step_two.focus()
                    step_two.press("Enter")
                    moved_trail = rich.locator('#learningCoach [data-practice-checkpoint-trail]')
                    check("post-v16-rich-checkpoint-keyboard-navigation-focus-no-progress",
                          moved_trail.get_attribute("data-practice-trail-current-step")=="1"
                          and moved_trail.locator(
                              '[data-practice-trail-navigate-step="1"]').get_attribute("aria-current")=="step"
                          and rich.evaluate("document.activeElement?.getAttribute('data-practice-trail-navigate-step')")=="1"
                          and rich.locator("#progressText").inner_text()==initial_progress
                          and rich.locator("#completeButton").is_hidden())
                    rich.locator('[data-practice-trail-navigate-step="0"]').click()
                    rich.locator("#labEditToggle").click()
                    rich.locator("#labFromPin").select_option("D13")
                    rich.locator("#labToPin").select_option("R1:A")
                    rich.locator("#labConnect").click()
                    rich.locator("#labFromPin").select_option("R1:B")
                    rich.locator("#labToPin").select_option("LED:A")
                    rich.locator("#labConnect").click()
                    precision = rich.locator("#labEditor [data-lab-precision-wire-list]")
                    precision_buttons = precision.locator("[data-lab-remove-wire-id]")
                    first_precision = precision.locator('[data-lab-remove-wire-id="w1"]')
                    precision_rect = first_precision.bounding_box()
                    check("post-v16-rich-canonical-per-wire-list-exact-two-edges",
                          precision_buttons.count()==2
                          and precision.locator('[data-lab-wire-row="w1"]').count()==1
                          and precision.locator('[data-lab-wire-row="w2"]').count()==1
                          and precision.locator('[data-lab-wire-provenance="learner graph only"]').count()>=1
                          and precision_rect is not None
                          and precision_rect["width"]>=44 and precision_rect["height"]>=44
                          and "D13" in (first_precision.get_attribute("aria-label") or "")
                          and rich.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="2")
                    first_precision.focus()
                    first_precision.press("Enter")
                    remaining_wire = rich.locator('#labEditor [data-lab-wire-row="w2"]')
                    check("post-v16-rich-per-wire-remove-w1-preserves-w2-and-history",
                          precision_buttons.count()==1
                          and remaining_wire.count()==1
                          and precision.locator('[data-lab-wire-row="w1"]').count()==0
                          and rich.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="1"
                          and not rich.locator("#labUndoWire").is_disabled()
                          and rich.locator("#completeButton").is_hidden())
                    check("post-v16-rich-precision-keyboard-remove-restores-next-native-focus",
                          rich.evaluate("document.activeElement?.getAttribute('data-lab-remove-wire-id')")=="w2"
                          and rich.locator('[data-lab-remove-wire-id="w2"]').get_attribute("data-lab-wire-lesson")=="2")
                    rich.locator("#labUndoWire").click()
                    check("post-v16-rich-precision-wire-undo-restores-original-ids",
                          rich.locator('#labEditor [data-lab-wire-row="w1"]').count()==1
                          and rich.locator('#labEditor [data-lab-wire-row="w2"]').count()==1
                          and rich.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="2")
                    rich.locator("#stageTabWiring").click()
                    explorer_ids = rich.locator(
                        "#labExplorer [data-explorer-highlight-wire]").evaluate_all(
                            "(nodes) => [...new Set(nodes.map(node => node.dataset.explorerHighlightWire))].sort()")
                    check("post-v16-rich-precise-3d-graph-syncs-2d-explorer",
                          rich.locator(".wiring-view .wire-connected").count()==2
                          and explorer_ids==["w1","w2"],
                          json.dumps({"learner2d":rich.locator(".wiring-view .wire-connected").all_inner_texts(),
                            "explorerWireIds":explorer_ids},ensure_ascii=False))

                    # Source-draft pin inspection is view-only and must leave
                    # both existing learner wires and completion state alone.
                    rich.locator("#editCode").click()
                    rich.locator("#codeEditor").fill(
                        "void setup(){pinMode(13,OUTPUT);}\n"
                        "void loop(){digitalWrite(13,HIGH);digitalWrite(PIN,HIGH);}"
                    )
                    pin_actions = rich.locator(
                        '#sketchReviewMount [data-sketch-pin-inspect-terminal="D13"]')
                    unknown_pin_actions = rich.locator(
                        '#sketchReviewMount [data-sketch-pin-evidence-status="unknown"] '
                        '[data-sketch-pin-inspect-terminal]')
                    inspected_before = rich.locator(".wiring-view .wire-connected").count()
                    pin_rect = pin_actions.first.bounding_box()
                    check("post-v16-rich-source-literal-pin-inspection-native-action",
                          pin_actions.count()>=1 and unknown_pin_actions.count()==0
                          and pin_rect is not None and pin_rect["height"]>=44
                          and pin_rect["width"]>=44
                          and pin_actions.first.get_attribute("data-sketch-pin-inspect-lesson")=="2"
                          and rich.locator("#progressText").inner_text()==initial_progress)
                    pin_actions.first.click()
                    check("post-v16-rich-sketch-inspector-readonly-cross-surface-no-autowire",
                          rich.locator("#stageTab3d").get_attribute("aria-selected")=="true"
                          and rich.locator("#labEditToggle").get_attribute("aria-pressed")=="false"
                          and "D13" in rich.locator("#sceneInspectionStatus").inner_text()
                          # The 3D conceptual editor overlay is explicitly
                          # unmounted in read-only Inspector mode. Its lab wire
                          # count is therefore 0, NOT the committed learner
                          # graph count. The independent Explorer stays bound
                          # to the canonical learner draft.
                          and rich.locator("#sceneMount canvas").get_attribute("data-lab-layout-mode")=="none"
                          and rich.locator("#sceneMount canvas").get_attribute("data-lab-wire-count")=="0"
                          and rich.locator("#sceneMount canvas").get_attribute("data-lab-pending-wire-terminal")==""
                          and rich.locator("#labExplorer .lab-explorer").get_attribute("data-explorer-source")=="learner-draft"
                          and rich.locator("#progressText").inner_text()==initial_progress
                          and rich.locator("#completeButton").is_hidden()
                          and inspected_before==2)
                    rich.locator("#stageTabWiring").click()
                    inspected_explorer_wire_ids=rich.locator(
                        "#labExplorer [data-explorer-highlight-wire]").evaluate_all(
                            "(nodes) => [...new Set(nodes.map(node => node.dataset.explorerHighlightWire))].sort()")
                    check("post-v16-rich-sketch-inspector-preserves-two-learner-edges-after-readonly-exit",
                          rich.locator(".wiring-view .wire-connected").count()==2
                          and inspected_explorer_wire_ids==["w1","w2"]
                          and rich.locator("#completeButton").is_hidden()
                          and rich.locator("#progressText").inner_text()==initial_progress,
                          json.dumps({"edges":rich.locator(".wiring-view .wire-connected").all_inner_texts(),
                                      "ids":inspected_explorer_wire_ids},ensure_ascii=False))
                    rich.locator("#stageTab3d").click()

                    # Mobile 375px must preserve native touch targets and never
                    # introduce a document-level horizontal scrollbar.
                    rich.locator("#labEditToggle").click()
                    rich.locator('#infoTabPractice').click()
                    rich.set_viewport_size({"width":375,"height":812})
                    mobile_rich = rich.evaluate("""() => {
                      const selectors=[
                        '#learningCoach [data-practice-trail-navigate-step]',
                        '#learningCoach [data-practice-trail-previous]',
                        '#learningCoach [data-practice-trail-next]',
                        '#sketchReviewMount [data-sketch-pin-inspect-terminal]',
                        '#labEditor [data-lab-remove-wire-id]',
                      ];
                      const targets=selectors.flatMap(selector=>[...document.querySelectorAll(selector)]
                        .map(node=>({selector,width:node.getBoundingClientRect().width,
                           height:node.getBoundingClientRect().height,
                           name:node.getAttribute('aria-label')||node.textContent?.trim()||''})));
                      return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
                        targets,checkpoints:document.querySelectorAll(
                          '#learningCoach [data-practice-trail-step]').length};
                    }""")
                    check("post-v16-rich-375px-trail-sketch-44px-no-horizontal-overflow",
                          mobile_rich["viewport"]==375
                          and mobile_rich["scrollWidth"]<=375
                          and mobile_rich["checkpoints"]==3
                          and len([item for item in mobile_rich["targets"]
                              if item["selector"]=="#labEditor [data-lab-remove-wire-id]"])==2
                          and len(mobile_rich["targets"])>=8
                          and all(row["width"]>=44 and row["height"]>=44 and row["name"]
                                  for row in mobile_rich["targets"]),
                          json.dumps(mobile_rich,ensure_ascii=False))

                    # Real pointer movement from one rendered 3D terminal to
                    # another must pass through the same canonical controller,
                    # not a synthetic call to scene callbacks. First locate
                    # both markers using existing scene projection helpers;
                    # marker offsets are tested via actual user input only.
                    rich.set_viewport_size({"width":1280,"height":820})
                    rich.locator('.lesson-link[data-lesson="16"]').click()
                    rich.locator("#labEditToggle").click()
                    rich.locator('#cameraToolbar [data-camera="reset"]').click()
                    rich.wait_for_timeout(60)
                    rich_canvas = rich.locator("#sceneMount canvas")
                    wire16 = rich.evaluate("""() => import('./src/circuit-router.js').then(router => {
                      const wire=router.createSampleCircuit(16).wires[0];
                      return {from:wire.from,to:wire.to};
                    })""")
                    from_proj = lab_scene_point(rich,16,terminal_id=wire16["from"])
                    to_proj = lab_scene_point(rich,16,terminal_id=wire16["to"])
                    source_pixel=None
                    for dy in range(-16,17,4):
                        if source_pixel: break
                        for dx in range(-16,17,4):
                            rich.mouse.click(from_proj["x"]+dx,from_proj["y"]+dy)
                            if rich_canvas.get_attribute("data-lab-pending-wire-terminal")==wire16["from"]:
                                source_pixel=(from_proj["x"]+dx,from_proj["y"]+dy)
                                break
                            if rich_canvas.get_attribute("data-lab-pending-wire-terminal"):
                                rich.locator("#labCancelPendingWire").click()
                    target_pixel=None
                    if source_pixel:
                        for dy in range(-16,17,4):
                            if target_pixel: break
                            for dx in range(-16,17,4):
                                rich.mouse.move(to_proj["x"]+dx,to_proj["y"]+dy)
                                if rich_canvas.get_attribute("data-lab-pending-wire-hover-terminal")==wire16["to"]:
                                    target_pixel=(to_proj["x"]+dx,to_proj["y"]+dy)
                                    break
                    check("post-v16-rich-3d-real-canonical-terminal-pointer-targets-located",
                          bool(source_pixel and target_pixel)
                          and rich_canvas.get_attribute("data-lab-wire-count")=="0"
                          and rich.locator("#completeButton").is_hidden(),
                          json.dumps({"from":wire16["from"],"to":wire16["to"],
                            "sourcePixel":source_pixel,"targetPixel":target_pixel,
                            "sourceProjection":from_proj,"targetProjection":to_proj},ensure_ascii=False))
                    if source_pixel and target_pixel:
                        # Keep the viewport/canvas geometry fixed. Clicking
                        # the native cancel button here would scroll the page
                        # to the editor below the viewport, invalidating the
                        # already-projected real 3D marker coordinates. A
                        # second tap on the same source is the existing
                        # canonical 3D cancel gesture.
                        rich.mouse.click(*source_pixel)
                        check("post-v16-rich-3d-same-terminal-tap-cancels-probe-without-wire",
                              rich_canvas.get_attribute("data-lab-pending-wire-terminal")==""
                              and rich_canvas.get_attribute("data-lab-wire-count")=="0")
                        # Regression for stale two-tap intent: arm terminal A,
                        # begin a different terminal B drag and release over
                        # empty canvas. The controller must revoke A as soon
                        # as B starts dragging, not wait for a valid drop.
                        rich.mouse.click(*source_pixel)
                        check("post-v16-rich-3d-pending-first-terminal-armed-before-cancel-drag",
                              rich_canvas.get_attribute("data-lab-pending-wire-terminal")==wire16["from"]
                              and rich_canvas.get_attribute("data-lab-wire-count")=="0")
                        rich.mouse.move(*target_pixel)
                        rich.mouse.down()
                        canvas_rect=rich_canvas.bounding_box()
                        rich.mouse.move(canvas_rect["x"]+7,canvas_rect["y"]+7,steps=12)
                        rich.mouse.up()
                        check("post-v16-rich-3d-canceled-drag-revokes-prior-two-tap-without-wire",
                              rich_canvas.get_attribute("data-lab-pending-wire-terminal")==""
                              and rich_canvas.get_attribute("data-lab-terminal-drag-preview")=="none"
                              and rich_canvas.get_attribute("data-lab-wire-count")=="0"
                              and rich.locator("#labCancelPendingWire").is_disabled())
                        rich.mouse.click(*target_pixel)
                        check("post-v16-rich-3d-after-cancel-next-tap-only-arms-new-terminal",
                              rich_canvas.get_attribute("data-lab-pending-wire-terminal")==wire16["to"]
                              and rich_canvas.get_attribute("data-lab-wire-count")=="0"
                              and rich.locator("#completeButton").is_hidden())
                        rich.mouse.click(*target_pixel)
                        rich.mouse.move(*source_pixel)
                        rich.mouse.down()
                        rich.mouse.move(*target_pixel,steps=16)
                        drag_hover = {
                            "source":rich_canvas.get_attribute("data-lab-terminal-drag-source"),
                            "target":rich_canvas.get_attribute("data-lab-terminal-drag-target"),
                            "preview":rich_canvas.get_attribute("data-lab-terminal-drag-preview"),
                            "wires":rich_canvas.get_attribute("data-lab-wire-count"),
                        }
                        check("post-v16-rich-3d-real-jumper-drag-ghost-only-before-release",
                              drag_hover["source"]==wire16["from"]
                              and drag_hover["target"]==wire16["to"]
                              and drag_hover["preview"]=="ghost"
                              and drag_hover["wires"]=="0",
                              json.dumps(drag_hover,ensure_ascii=False))
                        rich.mouse.up()
                        check("post-v16-rich-3d-pointer-drop-commits-one-router-wire-not-physical",
                              rich_canvas.get_attribute("data-lab-wire-count")=="1"
                              and rich_canvas.get_attribute("data-lab-terminal-drag-preview")=="none"
                              and rich.locator('#labEditor [data-lab-wire-row="w1"]').count()==1
                              and rich.locator("#completeButton").is_hidden()
                              and "không" in rich.locator("#labEditor").inner_text().lower(),
                              json.dumps({"wire":wire16,
                                "count":rich_canvas.get_attribute("data-lab-wire-count"),
                                "preview":rich_canvas.get_attribute("data-lab-terminal-drag-preview")},ensure_ascii=False))
                        rich.locator("#stageTabWiring").click()
                        dragged_wire_ids=rich.locator(
                            "#labExplorer [data-explorer-highlight-wire]").evaluate_all(
                                "(nodes) => [...new Set(nodes.map(node => node.dataset.explorerHighlightWire))].sort()")
                        check("post-v16-rich-real-3d-jumper-appears-same-2d-learner-graph",
                              rich.locator(".wiring-view .wire-connected").count()==1
                              and dragged_wire_ids==["w1"],
                              json.dumps({"2d":rich.locator(".wiring-view .wire-connected").all_inner_texts(),
                                          "committedWireIds":dragged_wire_ids},ensure_ascii=False))
                    else:
                        # Missing rendered pointer markers is an E2E failure,
                        # not permission to replace real input with synthetic
                        # scene callbacks.
                        check("post-v16-rich-3d-drag-target-unavailable-fails-before-ghost",
                              False,"Could not locate actual 3D marker targets")
                        check("post-v16-rich-3d-drag-target-unavailable-fails-before-commit",
                              False,"Could not execute actual terminal drag")
                        check("post-v16-rich-3d-drag-target-unavailable-fails-before-2d",
                              False,"No actual pointer-drag-created edge")
                finally:
                    rich_context.close()

                # The authored 3D checkpoint guide is a real, click-driven
                # read-only overlay. It must never arm a terminal, clone the
                # reference graph, mark a step complete or claim physical holes.
                guide_context = browser.new_context(
                    viewport={"width":1280,"height":820}, service_workers="allow")
                try:
                    guide_page = guide_context.new_page()
                    capture_console(guide_page)
                    guide_page.goto(base, wait_until="domcontentloaded", timeout=20000)
                    ready(guide_page)
                    guide_page.locator('.lesson-link[data-lesson="2"]').click()
                    guide_page.locator("#infoTabPractice").click()
                    guide_canvas = guide_page.locator("#sceneMount canvas")
                    guide_actions = guide_page.locator(
                        '#learningCoach [data-practice-preview-pair-3d]')
                    check("post-v16-authored-3d-only-from-missing-current-checkpoint",
                          guide_actions.count()==3
                          and guide_page.locator(
                              '#learningCoach [data-practice-pair-status="matched"] '
                              '[data-practice-preview-pair-3d]').count()==0
                          and guide_page.locator(
                              '#learningCoach [data-practice-extra-review-row] '
                              '[data-practice-preview-pair-3d]').count()==0)
                    first_guide=guide_actions.first
                    from_id=first_guide.get_attribute("data-practice-preview-from")
                    to_id=first_guide.get_attribute("data-practice-preview-to")
                    initial_progress=guide_page.locator("#progressText").inner_text()
                    first_guide.click()
                    check("post-v16-authored-3d-visual-guide-canonical-pair-and-no-edit",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="view-only"
                          and guide_canvas.get_attribute("data-lab-authored-guide-from")==from_id
                          and guide_canvas.get_attribute("data-lab-authored-guide-to")==to_id
                          and guide_canvas.get_attribute("data-lab-edit")=="off"
                          and guide_page.locator("#labEditToggle").get_attribute("aria-pressed")=="false"
                          and guide_page.locator("#sceneInspectionStatus").get_attribute(
                              "data-authored-guide")=="view-only")
                    check("post-v16-authored-3d-no-learner-wire-physical-or-progress",
                          guide_canvas.get_attribute("data-lab-wire-count")=="0"
                          and guide_canvas.get_attribute("data-lab-pending-wire-preview")=="none"
                          and guide_canvas.get_attribute("data-wiring-physical-map")=="none"
                          and guide_page.locator("#labExplorer [data-explorer-highlight-wire]").count()==0
                          and guide_page.locator("#progressText").inner_text()==initial_progress
                          and guide_page.locator("#completeButton").is_hidden()
                          and "chưa có dây" in guide_page.locator(
                              "#sceneInspectionStatus").inner_text())
                    dismiss=guide_page.locator(
                        '#sceneInspectionStatus [data-authored-guide-dismiss]')
                    dismiss_rect=dismiss.bounding_box()
                    check("post-v16-authored-3d-dismiss-native-accessible-44px",
                          dismiss_rect is not None and dismiss_rect["width"]>=44
                          and dismiss_rect["height"]>=44
                          and dismiss.inner_text().strip()!="")
                    dismiss.click()
                    check("post-v16-authored-3d-dismiss-clears-only-visual-overlay",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="none"
                          and guide_canvas.get_attribute("data-lab-layout-mode")=="none"
                          and guide_canvas.get_attribute("data-lab-wire-count")=="0"
                          and guide_page.locator("#labEditToggle").get_attribute("aria-pressed")=="false"
                          and guide_page.locator("#progressText").inner_text()==initial_progress)

                    guide_actions.first.click()
                    guide_page.locator(
                        '#learningCoach [data-practice-trail-navigate-step="1"]').click()
                    check("post-v16-authored-3d-step-change-revokes-guide-no-manual-credit",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="none"
                          and guide_page.locator(
                              '#learningCoach [data-practice-trail-current-step]').get_attribute(
                                  'data-practice-trail-current-step')=="1"
                          and guide_page.locator(
                              '#learningCoach [data-practice-preview-pair-3d]').count()==0
                          and guide_page.locator("#progressText").inner_text()==initial_progress)
                    guide_page.locator(
                        '#learningCoach [data-practice-trail-navigate-step="0"]').click()
                    guide_page.locator(
                        '#learningCoach [data-practice-preview-pair-3d]').first.click()
                    guide_page.locator("#stageTabWiring").click()
                    check("post-v16-authored-3d-leaving-stage-revokes-and-2d-stays-empty",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="none"
                          and guide_page.locator(".wiring-view .wire-connected").count()==0
                          and guide_page.locator(
                              '.wiring-view [data-wire-suggestion-preview]').count()==0
                          and guide_page.locator("#progressText").inner_text()==initial_progress)
                    guide_page.locator("#stageTab3d").click()
                    guide_page.locator(
                        '#learningCoach [data-practice-preview-pair-3d]').first.click()
                    guide_page.locator("#labEditToggle").click()
                    check("post-v16-authored-3d-edit-optin-revokes-guide-not-wiring",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="none"
                          and guide_canvas.get_attribute("data-lab-edit")=="on"
                          and guide_canvas.get_attribute("data-lab-wire-count")=="0"
                          and guide_page.locator("#labEditToggle").get_attribute("aria-pressed")=="true")
                    guide_page.locator("#labEditToggle").click()

                    guide_page.locator('.lesson-link[data-lesson="10"]').click()
                    guide_page.locator("#infoTabPractice").click()
                    check("post-v16-authored-3d-lesson10-signal-manual-only-no-invented-edge",
                          guide_page.locator(
                              '#learningCoach [data-practice-trail-scope="signal-only"]').count()==1
                          and guide_page.locator(
                              '#learningCoach [data-practice-preview-pair-3d]').count()==0)
                    guide_page.locator('.lesson-link[data-lesson="14"]').click()
                    guide_page.locator("#infoTabPractice").click()
                    signal_guide=guide_page.locator(
                        '#learningCoach [data-practice-preview-pair-3d]')
                    check("post-v16-authored-3d-signal-lesson-scope-stays-unverified",
                          guide_page.locator(
                              '#learningCoach [data-practice-trail-scope="signal-only"]').count()==1
                          and signal_guide.count()>0)
                    signal_guide.first.click()
                    check("post-v16-authored-3d-signal-guide-does-not-activate-power-model",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="view-only"
                          and guide_canvas.get_attribute("data-lab-wire-count")=="0"
                          and guide_canvas.get_attribute("data-lab-edit")=="off")
                    guide_page.locator('.lesson-link[data-lesson="1"]').click()
                    guide_page.locator("#infoTabPractice").click()
                    check("post-v16-authored-3d-lesson-switch-revokes-and-manual-only",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="none"
                          and guide_page.locator(
                              '#learningCoach [data-practice-preview-pair-3d]').count()==0
                          and guide_page.locator("#progressText").inner_text()==initial_progress)
                    guide_page.locator('.lesson-link[data-lesson="2"]').click()
                    guide_page.locator("#infoTabPractice").click()
                    guide_page.set_viewport_size({"width":375,"height":812})
                    mobile_guide=guide_page.locator(
                        '#learningCoach [data-practice-preview-pair-3d]').first
                    mobile_guide_rect=mobile_guide.bounding_box()
                    check("post-v16-authored-3d-375px-native-preview-no-overflow",
                          mobile_guide_rect is not None
                          and mobile_guide_rect["width"]>=44
                          and mobile_guide_rect["height"]>=44
                          and guide_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                    mobile_guide.click()
                    mobile_dismiss=guide_page.locator(
                        '#sceneInspectionStatus [data-authored-guide-dismiss]')
                    mobile_dismiss_rect=mobile_dismiss.bounding_box()
                    check("post-v16-authored-3d-375px-dismiss-real-touch-target",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="view-only"
                          and mobile_dismiss_rect is not None
                          and mobile_dismiss_rect["width"]>=44
                          and mobile_dismiss_rect["height"]>=44
                          and guide_canvas.get_attribute("data-lab-wire-count")=="0")
                    mobile_dismiss.click()
                    check("post-v16-authored-3d-375px-dismiss-keeps-learner-empty",
                          guide_canvas.get_attribute("data-lab-authored-guide-mode")=="none"
                          and guide_canvas.get_attribute("data-lab-wire-count")=="0"
                          and guide_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                finally:
                    guide_context.close()

                # Post-8d6e420 product phase: a COMMITTED learner wire is an
                # independently inspectable 3D object. Native controls, real
                # 3D pointer input, Explorer, 2D SVG/HTML and undo/remove must
                # agree without manufacturing a single electrical edge.
                inspect_context=browser.new_context(
                    viewport={"width":1280,"height":820},service_workers="allow")
                try:
                    inspect_page=inspect_context.new_page()
                    capture_console(inspect_page)
                    inspect_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(inspect_page)
                    inspect_page.locator('.lesson-link[data-lesson="2"]').click()
                    inspect_page.locator("#infoTabPractice").click()
                    initial_inspect_progress=inspect_page.locator("#progressText").inner_text()
                    inspect_page.locator("#labEditToggle").click()
                    for source,target in [("D13","R1:A"),("R1:B","LED:A")]:
                        inspect_page.locator("#labFromPin").select_option(source)
                        inspect_page.locator("#labToPin").select_option(target)
                        inspect_page.locator("#labConnect").click()
                    inspect_canvas=inspect_page.locator("#sceneMount canvas")
                    inspect_buttons=inspect_page.locator(
                        '#labEditor [data-lab-inspect-wire-id]')
                    inspect_rect=inspect_buttons.first.bounding_box()
                    check("post-8d6e-precise-native-committed-wire-inspect-controls",
                          inspect_buttons.count()==2
                          and inspect_rect is not None
                          and inspect_rect["width"]>=44 and inspect_rect["height"]>=44
                          and not inspect_buttons.first.is_disabled()
                          and "w1" in (inspect_buttons.first.get_attribute("aria-label") or "")
                          and inspect_canvas.get_attribute("data-lab-wire-count")=="2")
                    inspect_buttons.first.focus()
                    inspect_buttons.first.press("Enter")
                    check("post-8d6e-native-keyboard-wire-inspection-cross-3d-explorer",
                          inspect_canvas.get_attribute("data-lab-highlighted-wire")=="w1"
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire="w1"]:not([data-lab-explorer])').count()==4
                          and inspect_page.locator(
                              '#sceneInspectionStatus [data-committed-wire-dismiss]').count()==1
                          and "D13" in inspect_page.locator("#sceneInspectionStatus").inner_text()
                          and inspect_canvas.get_attribute("data-lab-pending-wire-terminal")==""
                          and inspect_page.locator("#progressText").inner_text()==initial_inspect_progress
                          and inspect_page.locator("#completeButton").is_hidden())
                    dismiss_wire=inspect_page.locator(
                        '#sceneInspectionStatus [data-committed-wire-dismiss]')
                    dismiss_rect=dismiss_wire.bounding_box()
                    check("post-8d6e-native-wire-dismiss-is-real-44px-button",
                          dismiss_rect is not None and dismiss_rect["width"]>=44
                          and dismiss_rect["height"]>=44)
                    dismiss_wire.click()
                    check("post-8d6e-native-wire-dismiss-no-electrical-change",
                          inspect_canvas.get_attribute("data-lab-highlighted-wire")==""
                          and inspect_canvas.get_attribute("data-lab-wire-count")=="2"
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire]:not([data-lab-explorer])').count()==0
                          and inspect_page.locator(
                              '#labExplorer [data-lab-explorer]').get_attribute(
                                  "data-explorer-selected-wire")=="")

                    inspect_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    inspect_page.wait_for_timeout(60)
                    wire_pixels=lab_scene_committed_wire_points(
                        inspect_page,2,"R1:B","LED:A",wire_index=1)
                    actual_wire_pixel=None
                    for pixel in wire_pixels:
                        inspect_page.mouse.click(pixel["x"],pixel["y"])
                        if inspect_canvas.get_attribute("data-lab-highlighted-wire")=="w2":
                            actual_wire_pixel=pixel
                            break
                    check("post-8d6e-real-pointer-3d-committed-wire-hit",
                          actual_wire_pixel is not None,
                          json.dumps({"wire":"w2","candidates":wire_pixels,
                            "chosen":actual_wire_pixel},ensure_ascii=False))
                    check("post-8d6e-real-3d-wire-inspection-no-ghost-no-router-mutation",
                          inspect_canvas.get_attribute("data-lab-wire-count")=="2"
                          and inspect_canvas.get_attribute("data-lab-terminal-drag-preview")=="none"
                          and inspect_canvas.get_attribute("data-lab-pending-wire-preview")=="none"
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire="w2"]:not([data-lab-explorer])').count()==4
                          and inspect_page.locator("#progressText").inner_text()==initial_inspect_progress)
                    inspect_page.locator("#stageTabWiring").click()
                    check("post-8d6e-3d-pointer-inspect-persisted-in-2d-and-minimap",
                          inspect_page.locator('.wiring-view [data-wiring-highlight-wire="w2"]').count()>=1
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire="w2"]:not([data-lab-explorer])').count()==4
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire-status="w2"]').count()>0
                          and inspect_page.locator('.wiring-view .wire-connected').count()==2
                          and inspect_page.locator("#progressText").inner_text()==initial_inspect_progress)
                    inspect_page.locator("#stageTab3d").click()
                    check("post-8d6e-2d-return-restores-only-existing-committed-highlight",
                          inspect_canvas.get_attribute("data-lab-highlighted-wire")=="w2"
                          and inspect_canvas.get_attribute("data-lab-wire-count")=="2"
                          and inspect_canvas.get_attribute("data-lab-pending-wire-terminal")==""
                          and inspect_page.locator(
                              '#sceneInspectionStatus [data-committed-wire-dismiss]').count()==1
                          and "w2" in inspect_page.locator("#sceneInspectionStatus").inner_text())
                    inspect_page.locator(
                        '#labEditor [data-lab-remove-wire-id="w2"]').click()
                    check("post-8d6e-removing-exact-inspected-wire-clears-stale-projection",
                          inspect_canvas.get_attribute("data-lab-highlighted-wire")==""
                          and inspect_canvas.get_attribute("data-lab-wire-count")=="1"
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire]:not([data-lab-explorer])').count()==0
                          and inspect_page.locator(
                              '#labExplorer [data-lab-explorer]').get_attribute(
                                  "data-explorer-selected-wire")=="")
                    inspect_page.locator("#labUndoWire").click()
                    check("post-8d6e-undo-restores-wire-not-old-inspection-intent",
                          inspect_canvas.get_attribute("data-lab-wire-count")=="2"
                          and inspect_canvas.get_attribute("data-lab-highlighted-wire")==""
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire]:not([data-lab-explorer])').count()==0
                          and inspect_page.locator(
                              '#labExplorer [data-lab-explorer]').get_attribute(
                                  "data-explorer-selected-wire")=="")
                    inspect_page.set_viewport_size({"width":375,"height":812})
                    inspect_mobile=inspect_page.locator(
                        '#labEditor [data-lab-inspect-wire-id="w1"]')
                    inspect_mobile_rect=inspect_mobile.bounding_box()
                    check("post-8d6e-375px-exact-inspect-accessible-no-overflow",
                          inspect_mobile_rect is not None
                          and inspect_mobile_rect["width"]>=44
                          and inspect_mobile_rect["height"]>=44
                          and inspect_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                    inspect_mobile.focus()
                    inspect_mobile.press("Enter")
                    inspect_page.set_viewport_size({"width":1280,"height":820})
                    # An actual WebGL loss discards the scene's committed-wire
                    # highlight. The app must revoke the SAME selection across
                    # Inspector/schematic/minimap/HTML, status and 2D; restoring
                    # GPU resources must not silently replay inspection intent.
                    # Exercise the real extension and real canvas events, not
                    # synthetic dispatch or a model-only clear.
                    committed_context_cycle=inspect_page.evaluate("""async () => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        const gl=canvas?.getContext('webgl2');
                        const extension=gl?.getExtension('WEBGL_lose_context');
                        if (!extension) {
                            throw new Error('Real WebGL loss unavailable for committed-wire lifecycle QA');
                        }
                        const snapshot=()=>{
                            const root=document.querySelector('#labExplorer [data-lab-explorer]');
                            const status=document.querySelector('#sceneInspectionStatus');
                            return {
                                context:canvas.dataset.sceneContext,
                                highlighted:canvas.dataset.labHighlightedWire,
                                wireCount:canvas.dataset.labWireCount,
                                rootWire:root?.dataset.explorerSelectedWire,
                                rootAria:root?.getAttribute('aria-current'),
                                semantic:[...document.querySelectorAll(
                                    '#labExplorer [data-explorer-selected-wire]:not([data-lab-explorer])'
                                )].map(node=>({
                                    id:node.dataset.explorerSelectedWire,
                                    aria:node.getAttribute('aria-current'),
                                })),
                                committedStatus:status?.dataset.committedWireInspect||'',
                                hidden:status?.hidden===true,
                                dismiss:Boolean(status?.querySelector('[data-committed-wire-dismiss]')),
                            };
                        };
                        const waitEvent=name=>new Promise((resolve,reject)=>{
                            const timeout=setTimeout(()=>reject(new Error('Timeout awaiting '+name)),10000);
                            canvas.addEventListener(name,event=>{
                                clearTimeout(timeout);
                                resolve(event);
                            },{once:true});
                        });
                        const before=snapshot();
                        const lost=waitEvent('webglcontextlost');
                        extension.loseContext();
                        const lostEvent=await lost;
                        const loss=snapshot();
                        await new Promise(resolve=>setTimeout(resolve,0));
                        const restored=waitEvent('webglcontextrestored');
                        extension.restoreContext();
                        await restored;
                        return {before,loss,after:snapshot(),
                                defaultPrevented:lostEvent.defaultPrevented};
                    }""")
                    wire_loss_before=committed_context_cycle["before"]
                    wire_loss=committed_context_cycle["loss"]
                    wire_restored=committed_context_cycle["after"]
                    check("post-8d6e-real-webgl-loss-revokes-exact-wire-across-surfaces",
                          wire_loss_before["context"]=="ready"
                          and wire_loss_before["highlighted"]=="w1"
                          and wire_loss_before["rootWire"]=="w1"
                          and len(wire_loss_before["semantic"])==4
                          and all(item["id"]=="w1" and item["aria"]=="true"
                                  for item in wire_loss_before["semantic"])
                          and wire_loss_before["dismiss"]
                          and committed_context_cycle["defaultPrevented"]
                          and wire_loss["context"]=="lost"
                          and wire_loss["highlighted"]==""
                          and wire_loss["wireCount"]=="2"
                          and wire_loss["rootWire"]==""
                          and wire_loss["rootAria"] is None
                          and wire_loss["semantic"]==[]
                          and wire_loss["committedStatus"]==""
                          and wire_loss["hidden"] and not wire_loss["dismiss"],
                          json.dumps(committed_context_cycle,ensure_ascii=False))
                    check("post-8d6e-real-webgl-restore-never-replays-stale-wire-selection",
                          wire_restored["context"]=="ready"
                          and wire_restored["highlighted"]==""
                          and wire_restored["wireCount"]=="2"
                          and wire_restored["rootWire"]==""
                          and wire_restored["rootAria"] is None
                          and wire_restored["semantic"]==[]
                          and wire_restored["committedStatus"]==""
                          and wire_restored["hidden"] and not wire_restored["dismiss"])
                    inspect_page.locator("#stageTabWiring").click()
                    check("post-8d6e-webgl-loss-revokes-2d-committed-wire-projection",
                          inspect_page.locator(
                              '.wiring-view [data-wiring-highlight-wire]').count()==0
                          and inspect_page.locator('.wiring-view .wire-connected').count()==2
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire]:not([data-lab-explorer])').count()==0
                          and inspect_page.locator(
                              '#labExplorer [data-lab-explorer]').get_attribute(
                                  "data-explorer-selected-wire")=="")
                    inspect_page.locator("#stageTab3d").click()
                    inspect_page.locator('.lesson-link[data-lesson="10"]').click()
                    check("post-8d6e-lesson-change-clears-selection-and-signal-nonclaims",
                          inspect_canvas.get_attribute("data-lab-highlighted-wire")==""
                          and inspect_page.locator(
                              '#labExplorer [data-explorer-selected-wire]:not([data-lab-explorer])').count()==0
                          and inspect_page.locator(
                              '#labExplorer [data-lab-explorer]').get_attribute(
                                  "data-explorer-selected-wire")==""
                          and inspect_page.locator("#progressText").inner_text()==initial_inspect_progress)
                finally:
                    inspect_context.close()

                # Post-57d8b90: canonical A1..J63 breadboard-hole study is a
                # separate opted-in 3D visual interaction. The actual
                # circuit-router graph, Sketch and lesson mastery cannot be
                # changed by selecting a hole; only the explicit native
                # \"Gán lỗ\" action writes an authored in-session placement.
                bb_scene_context=browser.new_context(
                    viewport={"width":1280,"height":820},
                    service_workers="allow",has_touch=True)
                try:
                    bb_scene_page=bb_scene_context.new_page()
                    capture_console(bb_scene_page)
                    bb_scene_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(bb_scene_page)
                    bb_scene_page.locator('.lesson-link[data-lesson="2"]').click()
                    bb_scene_page.locator("#infoTabPractice").click()
                    bb_initial_progress=bb_scene_page.locator("#progressText").inner_text()
                    bb_canvas=bb_scene_page.locator("#sceneMount canvas")
                    bb_toggle=bb_scene_page.locator("#bb3dHolePickToggle")
                    check("post-57d8b90-breadboard-scene-picker-requires-explicit-3d-edit",
                          bb_toggle.is_disabled()
                          and bb_toggle.get_attribute("aria-pressed")=="false"
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#labEditToggle").click()
                    bb_toggle_box=bb_toggle.bounding_box()
                    check("post-57d8b90-breadboard-scene-picker-has-native-44px-opt-in",
                          not bb_toggle.is_disabled()
                          and bb_toggle_box is not None
                          and bb_toggle_box["width"]>=44
                          and bb_toggle_box["height"]>=44
                          and bb_toggle.get_attribute("aria-pressed")=="false")
                    bb_scene_page.locator("#bbTerminal").select_option("D13")
                    bb_toggle.focus()
                    bb_toggle.press("Enter")
                    check("post-57d8b90-opted-in-threejs-630-canonical-hole-visuals",
                          bb_toggle.get_attribute("aria-pressed")=="true"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-study-mode")=="conceptual-strip-study"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-count")=="630"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-physical-verified")=="false"
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator('#bbHoleGrid [data-bb-grid-hole="B1"]').focus()
                    bb_scene_page.locator('#bbHoleGrid [data-bb-grid-hole="B1"]').press("Enter")
                    check("post-57d8b90-native-hole-keyboard-inspection-syncs-3d-no-placement",
                          bb_canvas.get_attribute("data-lab-breadboard-hole-selected")=="B1"
                          and bb_scene_page.locator("#bbPlaceHole").input_value()=="B1"
                          and bb_scene_page.locator(
                              '#bbHoleGrid [data-bb-grid-hole="B1"]').get_attribute(
                                  "aria-pressed")=="true"
                          and bb_scene_page.locator(
                              "#bbPlacedList [data-bb-placement-empty]").count()==1
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#bbGridNext").click()
                    bb_scene_page.locator('#bbHoleGrid [data-bb-grid-hole="E12"]').click()
                    check("post-57d8b90-canonical-page-hole-visual-projection",
                          bb_canvas.get_attribute("data-lab-breadboard-hole-selected")=="E12"
                          and bb_scene_page.locator("#bbPlaceHole").input_value()=="E12"
                          and bb_scene_page.locator("#bbHoleGrid").get_attribute(
                              "data-page")=="2"
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")

                    bb_scene_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    bb_scene_page.wait_for_timeout(60)
                    candidate_holes=["F32","G32","D32","C32","E28","B28","H30"]
                    bb_hole_pixels=lab_scene_breadboard_hole_points(
                        bb_scene_page,2,candidate_holes)
                    actual_hole_pixel=None
                    for pixel in bb_hole_pixels:
                        if not pixel["visible"] or not pixel["uncovered"]:
                            continue
                        bb_scene_page.mouse.click(pixel["x"],pixel["y"])
                        if (bb_canvas.get_attribute("data-lab-breadboard-hole-selected")
                                ==pixel["id"]):
                            actual_hole_pixel=pixel
                            break
                    check("post-57d8b90-real-pointer-picks-exact-canonical-breadboard-hole",
                          actual_hole_pixel is not None,
                          json.dumps({"candidates":bb_hole_pixels,
                                      "selected":bb_canvas.get_attribute(
                                          "data-lab-breadboard-hole-selected"),
                                      "chosen":actual_hole_pixel},ensure_ascii=False))
                    selected_3d_hole=actual_hole_pixel["id"]
                    selected_3d_column=int(selected_3d_hole[1:])
                    check("post-57d8b90-3d-pointer-selection-syncs-native-grid-and-keeps-router-empty",
                          bb_scene_page.locator("#bbPlaceHole").input_value()==selected_3d_hole
                          and bb_scene_page.locator("#bbHoleGrid").get_attribute(
                              "data-page")==str((selected_3d_column-1)//8+1)
                          and bb_scene_page.locator(
                              f'#bbHoleGrid [data-bb-grid-hole="{selected_3d_hole}"]'
                          ).get_attribute("aria-pressed")=="true"
                          and bb_scene_page.locator(
                              "#bbGridStatus").get_attribute(
                                  "data-result")=="scene-selected"
                          and bb_scene_page.locator(
                              "#bbPlacedList [data-bb-placement-empty]").count()==1
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0"
                          and bb_scene_page.locator("#progressText").inner_text()==bb_initial_progress)
                    assert bb_scene_page.locator("#bbTerminal").input_value()=="D13"
                    bb_scene_page.locator("#bbAssignHole").click()
                    check("post-57d8b90-explicit-assign-writes-study-placement-not-learner-wire",
                          bb_scene_page.locator(
                              '#bbPlacedList [data-bb-placement-item="D13"]').count()==1
                          and selected_3d_hole in bb_scene_page.locator(
                              '#bbPlacedList [data-bb-placement-item="D13"]').inner_text()
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0"
                          and bb_scene_page.locator("#progressText").inner_text()==bb_initial_progress)
                    # Native assignment scrolls to the study panel. Bring the
                    # actual canvas back into view before TOUCH input and
                    # recompute screen projection (never reuse stale pixels).
                    bb_scene_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    bb_scene_page.wait_for_timeout(60)
                    bb_touch_pixels=lab_scene_breadboard_hole_points(
                        bb_scene_page,2,candidate_holes)
                    bb_touch_pixel=next((
                        point for point in bb_touch_pixels
                        if point["id"]!=selected_3d_hole and
                           point["visible"] and point["uncovered"]
                    ),None)
                    if bb_touch_pixel is not None:
                        bb_scene_page.touchscreen.tap(
                            bb_touch_pixel["x"],bb_touch_pixel["y"])
                    check("post-57d8b90-real-touch-tap-selects-hole-without-reassigning",
                          bb_touch_pixel is not None
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-selected")==bb_touch_pixel["id"]
                          and bb_scene_page.locator(
                              "#bbPlaceHole").input_value()==bb_touch_pixel["id"]
                          and selected_3d_hole in bb_scene_page.locator(
                              '#bbPlacedList [data-bb-placement-item="D13"]').inner_text()
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_selected_before_drag=bb_canvas.get_attribute(
                        "data-lab-breadboard-hole-selected")
                    bb_scene_page.mouse.move(bb_touch_pixel["x"],bb_touch_pixel["y"])
                    bb_scene_page.mouse.down()
                    bb_scene_page.mouse.move(
                        bb_touch_pixel["x"]+65,bb_touch_pixel["y"]+35,steps=5)
                    bb_scene_page.mouse.up()
                    check("post-57d8b90-drag-does-not-misinterpret-hole-as-connection",
                          bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-selected")==bb_selected_before_drag
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0"
                          and bb_scene_page.locator("#progressText").inner_text()==bb_initial_progress)

                    bb_scene_page.locator("#bb3dHolePickToggle").click()
                    check("post-57d8b90-hole-pick-exit-restores-normal-3d-edit-mode",
                          bb_toggle.get_attribute("aria-pressed")=="false"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-study-mode")=="none"
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#labComponent").select_option("breadboard")
                    baseline_x=bb_scene_page.locator("#labPositionX").input_value()
                    history_undo=bb_scene_page.locator(
                        "#labEditor [data-lab-layout-undo]")
                    history_redo=bb_scene_page.locator(
                        "#labEditor [data-lab-layout-redo]")
                    undo_box=history_undo.bounding_box()
                    redo_box=history_redo.bounding_box()
                    check("post-57d8b90-conceptual-layout-history-native-buttons-44px",
                          baseline_x=="-1"
                          and history_undo.is_disabled()
                          and history_redo.is_disabled()
                          and undo_box is not None and redo_box is not None
                          and min(undo_box["width"],undo_box["height"],
                                  redo_box["width"],redo_box["height"])>=44)
                    bb_scene_page.locator("#labPositionX").fill("0")
                    bb_scene_page.locator("#labPlace").click()
                    check("post-57d8b90-layout-placement-enables-separate-history",
                          bb_scene_page.locator("#labPositionX").input_value()=="0"
                          and not history_undo.is_disabled()
                          and history_redo.is_disabled()
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#labRotateRight").click()
                    history_undo.focus()
                    history_undo.press("Enter")
                    check("post-57d8b90-layout-undo-rotation-preserves-position-and-router",
                          bb_scene_page.locator("#labPositionX").input_value()=="0"
                          and not history_undo.is_disabled()
                          and not history_redo.is_disabled()
                          and bb_scene_page.evaluate(
                              "document.activeElement === document.querySelector('#labEditor [data-lab-layout-undo]')")
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    history_undo.click()
                    check("post-57d8b90-layout-undo-position-restores-canonical-prior-state",
                          bb_scene_page.locator("#labPositionX").input_value()==baseline_x
                          and history_undo.is_disabled()
                          and not history_redo.is_disabled()
                          and bb_scene_page.evaluate(
                              "document.activeElement === document.querySelector('#labEditor [data-lab-layout-redo]')")
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#stageTabWiring").click()
                    bb_scene_page.locator("#stageTab3d").click()
                    history_redo.click()
                    check("post-57d8b90-layout-redo-survives-stage-change-without-learner-wires",
                          bb_scene_page.locator("#labPositionX").input_value()=="0"
                          and not history_undo.is_disabled()
                          and not history_redo.is_disabled()
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#labPositionX").fill("0.5")
                    bb_scene_page.locator("#labPlace").click()
                    check("post-57d8b90-divergent-layout-edit-clears-redo-only",
                          bb_scene_page.locator("#labPositionX").input_value()=="0.5"
                          and history_redo.is_disabled()
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0"
                          and bb_scene_page.locator("#progressText").inner_text()==bb_initial_progress)
                    bb_scene_page.set_viewport_size({"width":375,"height":812})
                    mobile_bb_button=bb_toggle.bounding_box()
                    mobile_history_button=history_undo.bounding_box()
                    check("post-57d8b90-breadboard-scene-and-layout-375px-a11y-no-overflow",
                          mobile_bb_button is not None and mobile_history_button is not None
                          and mobile_bb_button["width"]>=44
                          and mobile_bb_button["height"]>=44
                          and mobile_history_button["width"]>=44
                          and mobile_history_button["height"]>=44
                          and bb_scene_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                    bb_scene_page.set_viewport_size({"width":1280,"height":820})
                    bb_scene_page.locator("#bbProfile").select_option("busboard-bb830-rev7")
                    check("post-57d8b90-profile-switch-revokes-old-scene-hole-projection",
                          bb_toggle.get_attribute("aria-pressed")=="false"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-study-mode")=="none"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-selected")==""
                          and bb_scene_page.locator(
                              "#bbPlacedList [data-bb-placement-empty]").count()==1
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0")
                    bb_scene_page.locator("#bb3dHolePickToggle").click()
                    bb_scene_page.locator('#bbHoleGrid [data-bb-grid-hole="A1"]').click()
                    # Real native invalid numeric input triggers the controller's
                    # rollback path. It must restore the active opt-in visual
                    # hole study without falsely accepting a layout mutation.
                    bb_prior_position=bb_scene_page.locator("#labPositionX").input_value()
                    bb_scene_page.locator("#labPositionX").fill("999")
                    bb_scene_page.locator("#labPlace").click()
                    rejected_layout=bb_scene_page.evaluate("""()=>{
                        const status=document.getElementById('labStatus');
                        return {kind:status.dataset.kind,text:status.textContent||''};
                    }""")
                    bb_scene_page.locator("#labPositionX").fill(bb_prior_position)
                    check("post-57d8b90-rejected-layout-rollback-reconciles-opted-in-hole-overlay",
                          rejected_layout["kind"]=="error"
                          and "tọa độ" in rejected_layout["text"].lower()
                          and bb_toggle.get_attribute("aria-pressed")=="true"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-study-mode")=="conceptual-strip-study"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-count")=="630"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-selected")=="A1"
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0"
                          and bb_scene_page.locator("#progressText").inner_text()==bb_initial_progress)
                    bb_context_loss=bb_scene_page.evaluate("""async()=>{
                        const canvas=document.querySelector('#sceneMount canvas');
                        const gl=canvas?.getContext('webgl2');
                        const ext=gl?.getExtension('WEBGL_lose_context');
                        if(!ext)throw Error('WEBGL_lose_context unavailable for 3D hole study');
                        const wait=name=>new Promise((resolve,reject)=>{
                            const timeout=setTimeout(()=>reject(Error('Timeout '+name)),10000);
                            canvas.addEventListener(name,event=>{
                                clearTimeout(timeout);resolve(event);
                            },{once:true});
                        });
                        const before={mode:canvas.dataset.labBreadboardHoleStudyMode,
                            selected:canvas.dataset.labBreadboardHoleSelected};
                        const lost=wait('webglcontextlost');
                        ext.loseContext();
                        const event=await lost;
                        const during={mode:canvas.dataset.labBreadboardHoleStudyMode,
                            selected:canvas.dataset.labBreadboardHoleSelected,
                            pressed:document.querySelector('#bb3dHolePickToggle')?.getAttribute('aria-pressed')};
                        await new Promise(resolve=>setTimeout(resolve,0));
                        const restored=wait('webglcontextrestored');
                        ext.restoreContext();await restored;
                        return {before,during,after:{
                            mode:canvas.dataset.labBreadboardHoleStudyMode,
                            selected:canvas.dataset.labBreadboardHoleSelected,
                            pressed:document.querySelector('#bb3dHolePickToggle')?.getAttribute('aria-pressed')},
                            defaultPrevented:event.defaultPrevented};
                    }""")
                    check("post-57d8b90-real-webgl-loss-clears-opted-in-hole-mode-no-replay",
                          bb_context_loss["before"]["mode"]=="conceptual-strip-study"
                          and bb_context_loss["before"]["selected"]=="A1"
                          and bb_context_loss["defaultPrevented"]
                          and bb_context_loss["during"]=={
                              "mode":"none","selected":"","pressed":"false"}
                          and bb_context_loss["after"]=={
                              "mode":"none","selected":"","pressed":"false"}
                          and bb_canvas.get_attribute("data-lab-wire-count")=="0",
                          json.dumps(bb_context_loss,ensure_ascii=False))
                    bb_scene_page.locator('.lesson-link[data-lesson="1"]').click()
                    check("post-57d8b90-lesson1-never-enables-external-breadboard-scene-picker",
                          bb_toggle.is_disabled()
                          and bb_toggle.get_attribute("aria-pressed")=="false"
                          and bb_canvas.get_attribute(
                              "data-lab-breadboard-hole-study-mode")=="none"
                          and bb_scene_page.locator("#progressText").inner_text()==bb_initial_progress)
                finally:
                    bb_scene_context.close()

                # Post-c745aa5 product phase: A-J×63 conceptual 3D hole
                # coordinates become an EXPLICIT learner authoring route only
                # when two canonical terminals have already been assigned to
                # two exact holes. Neither two taps nor a ghost create an edge;
                # a separate keyboard-accessible Confirm button must delegate
                # the exact terminals to the existing circuit-router.
                hole_link_context=browser.new_context(
                    viewport={"width":1280,"height":820},
                    service_workers="allow",has_touch=True)
                try:
                    hole_link_page=hole_link_context.new_page()
                    capture_console(hole_link_page)
                    hole_link_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(hole_link_page)
                    hole_link_page.locator('.lesson-link[data-lesson="2"]').click()
                    hole_link_page.locator("#infoTabPractice").click()
                    hole_initial_progress=hole_link_page.locator("#progressText").inner_text()
                    hole_canvas=hole_link_page.locator("#sceneMount canvas")
                    hole_enable=hole_link_page.locator("#bbHoleLinkEnable")
                    hole_confirm=hole_link_page.locator("#bbHoleLinkConfirm")
                    hole_cancel=hole_link_page.locator("#bbHoleLinkCancel")
                    check("post-c745-hole-link-inactive-until-explicit-edit-and-assignments",
                          hole_enable.is_disabled() and hole_confirm.is_disabled()
                          and hole_cancel.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="0")
                    hole_link_page.locator("#labEditToggle").click()
                    hole_link_page.locator("#bb3dHolePickToggle").click()
                    check("post-c745-hole-link-no-phantom-start-before-two-assignments",
                          hole_enable.is_disabled()
                          and hole_confirm.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="0")
                    for terminal,hole in [("D13","C32"),("R1:A","H32")]:
                        hole_link_page.locator("#bbTerminal").select_option(terminal)
                        hole_link_page.locator("#bbPlaceHole").fill(hole)
                        hole_link_page.locator("#bbAssignHole").click()
                        check("post-c745-explicit-hole-assign-"+terminal.replace(":","-"),
                              hole_link_page.locator(
                                  f'#bbPlacedList [data-bb-placement-item="{terminal}"]').count()==1
                              and hole in hole_link_page.locator(
                                  f'#bbPlacedList [data-bb-placement-item="{terminal}"]').inner_text()
                              and hole_canvas.get_attribute("data-lab-wire-count")=="0")
                    enable_rect=hole_enable.bounding_box()
                    confirm_rect=hole_confirm.bounding_box()
                    cancel_rect=hole_cancel.bounding_box()
                    check("post-c745-hole-link-native-controls-44px-and-confirm-disabled",
                          not hole_enable.is_disabled() and hole_confirm.is_disabled()
                          and enable_rect is not None and confirm_rect is not None
                          and cancel_rect is not None
                          and min(enable_rect["width"],enable_rect["height"],
                                  confirm_rect["width"],confirm_rect["height"],
                                  cancel_rect["width"],cancel_rect["height"])>=44)
                    hole_enable.focus()
                    hole_enable.press("Enter")
                    check("post-c745-hole-link-keyboard-opt-in-never-autoconnects",
                          hole_enable.get_attribute("aria-pressed")=="true"
                          and hole_confirm.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="0"
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress)

                    # Use a page-bounded native A-J button for the first hole;
                    # the same exact canonical ID is then the starting point
                    # of a real Three.js pointer-drag to the second hole.
                    for _ in range(3):
                        hole_link_page.locator("#bbGridNext").click()
                    check("post-c745-hole-link-native-grid-page-4-before-first-point",
                          hole_link_page.locator("#bbHoleGrid").get_attribute("data-page")=="4"
                          and hole_link_page.locator(
                              '#bbHoleGrid [data-bb-grid-hole="C32"]').count()==1)
                    hole_link_page.locator('#bbHoleGrid [data-bb-grid-hole="C32"]').focus()
                    hole_link_page.locator('#bbHoleGrid [data-bb-grid-hole="C32"]').press("Enter")
                    check("post-c745-hole-link-first-assigned-hole-is-only-preview",
                          hole_confirm.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="0"
                          and "C32" in hole_link_page.locator("#bbHoleLinkStatus").inner_text()
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress)

                    hole_link_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    hole_link_page.wait_for_timeout(60)
                    points=lab_scene_breadboard_hole_points(
                        hole_link_page,2,["C32","H32"])
                    start,end=points
                    check("post-c745-hole-link-live-scene-projection-is-visible",
                          all(p["visible"] and p["uncovered"] for p in points),
                          json.dumps(points,ensure_ascii=False))
                    hole_link_page.mouse.move(start["x"],start["y"])
                    hole_link_page.mouse.down()
                    hole_link_page.mouse.move(end["x"],end["y"],steps=8)
                    hole_link_page.mouse.up()
                    check("post-c745-hole-link-direct-3d-drag-ends-only-in-ready-intent",
                          not hole_confirm.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="0"
                          and "D13" in hole_link_page.locator("#bbHoleLinkStatus").inner_text()
                          and "R1:A" in hole_link_page.locator("#bbHoleLinkStatus").inner_text()
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress,
                          json.dumps({"start":start,"end":end,
                                      "status":hole_link_page.locator(
                                          "#bbHoleLinkStatus").inner_text()},ensure_ascii=False))
                    hole_confirm.focus()
                    hole_confirm.press("Enter")
                    check("post-c745-hole-link-explicit-confirm-commits-one-canonical-learner-wire",
                          hole_canvas.get_attribute("data-lab-wire-count")=="1"
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress
                          and "D13" in hole_link_page.locator("#bbHoleLinkStatus").inner_text()
                          and "R1:A" in hole_link_page.locator("#bbHoleLinkStatus").inner_text()
                          and hole_link_page.evaluate("document.activeElement?.id")=="bbHoleLinkEnable")
                    hole_link_page.locator("#stageTabWiring").click()
                    check("post-c745-hole-link-committed-wire-reuses-2d-and-explorer-learner-graph",
                          hole_link_page.locator('.wiring-view .wire-connected').count()==1
                          and hole_link_page.locator(
                              '#labExplorer [data-explorer-wire="w1"]').count()>=1
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress)
                    hole_link_page.locator("#stageTab3d").click()
                    check("post-c745-hole-link-stage-switch-revokes-ghost-preserves-wire",
                          hole_canvas.get_attribute("data-lab-wire-count")=="1"
                          and hole_enable.get_attribute("aria-pressed")=="false")
                    hole_link_page.locator("#labUndoWire").click()
                    check("post-c745-hole-link-undo-uses-existing-canonical-learner-history",
                          hole_canvas.get_attribute("data-lab-wire-count")=="0"
                          and hole_link_page.locator(
                              '#labExplorer [data-explorer-wire="w1"]').count()==0
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress)
                    hole_link_page.locator("#labRedoWire").click()
                    check("post-c745-hole-link-redo-restores-existing-canonical-wire",
                          hole_canvas.get_attribute("data-lab-wire-count")=="1"
                          and hole_link_page.locator(
                              '#labExplorer [data-explorer-wire="w1"]').count()==2
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress)
                    hole_link_page.locator("#bb3dHolePickToggle").click()
                    check("post-c745-hole-link-rearm-after-stage-and-history-refreshes-native-availability",
                          hole_link_page.locator("#bb3dHolePickToggle").get_attribute("aria-pressed")=="true"
                          and not hole_enable.is_disabled()
                          and hole_confirm.is_disabled()
                          and hole_link_page.locator(
                              '#bbPlacedList [data-bb-placement-item="D13"]').count()==1
                          and hole_link_page.locator(
                              '#bbPlacedList [data-bb-placement-item="R1:A"]').count()==1
                          and hole_canvas.get_attribute("data-lab-wire-count")=="1")
                    hole_enable.click()
                    current_page=int(hole_link_page.locator("#bbHoleGrid").get_attribute(
                        "data-page"))
                    while current_page<4:
                        hole_link_page.locator("#bbGridNext").click()
                        current_page+=1
                    while current_page>4:
                        hole_link_page.locator("#bbGridPrev").click()
                        current_page-=1
                    hole_link_page.locator('#bbHoleGrid [data-bb-grid-hole="C32"]').click()
                    hole_cancel.focus()
                    hole_cancel.press("Enter")
                    check("post-c745-hole-link-explicit-cancel-revokes-ghost-not-learner-wire",
                          hole_confirm.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="1"
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress
                          and hole_link_page.evaluate("document.activeElement?.id")=="bbHoleLinkEnable")
                    hole_link_page.set_viewport_size({"width":375,"height":812})
                    mobile_enable=hole_enable.bounding_box()
                    mobile_confirm=hole_confirm.bounding_box()
                    mobile_cancel=hole_cancel.bounding_box()
                    check("post-c745-hole-link-mobile-375px-44px-buttons-no-overflow",
                          mobile_enable is not None and mobile_confirm is not None
                          and mobile_cancel is not None
                          and min(mobile_enable["width"],mobile_enable["height"],
                                  mobile_confirm["width"],mobile_confirm["height"],
                                  mobile_cancel["width"],mobile_cancel["height"])>=44
                          and hole_link_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                    hole_link_page.set_viewport_size({"width":1280,"height":820})
                    hole_link_page.locator('.lesson-link[data-lesson="1"]').click()
                    check("post-c745-hole-link-lesson1-blocks-external-circuit-intent",
                          hole_enable.is_disabled() and hole_confirm.is_disabled()
                          and hole_canvas.get_attribute("data-lab-wire-count")=="0"
                          and hole_link_page.locator("#progressText").inner_text()==hole_initial_progress)
                finally:
                    hole_link_context.close()

                # Post-85ff136 product growth: a human-authored 48-step TRY→
                # CHECK loop must attribute in-app interaction ONLY after an
                # explicit Start and ONLY in the exact active lesson/step.
                # Old lesson-level observations may coexist but cannot make a
                # later step's new attempt inherit earlier control activity.
                attempt_context=browser.new_context(
                    viewport={"width":1280,"height":820},service_workers="allow")
                try:
                    attempt_page=attempt_context.new_page()
                    capture_console(attempt_page)
                    attempt_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(attempt_page)
                    attempt_page.locator('.lesson-link[data-lesson="2"]').click()
                    attempt_page.locator("#infoTabPractice").click()
                    attempt_progress=attempt_page.locator("#progressText").inner_text()
                    attempt=attempt_page.locator(
                        "#learningCoach [data-practice-step-attempt]")
                    check("post-85ff-step-attempt-opt-in-48-checkpoint-native-ui-idle",
                          attempt.get_attribute("data-attempt-checkpoint")=="lesson-02-step-01"
                          and attempt.get_attribute("data-attempt-state")=="idle"
                          and not attempt.locator("[data-attempt-start]").is_disabled()
                          and attempt.locator("[data-attempt-check]").is_disabled()
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt_page.locator(
                        '#learningCoach [data-practice-trail-navigate-step="1"]').click()
                    check("post-85ff-step-attempt-manual-step-selection-does-not-auto-start",
                          attempt.get_attribute("data-attempt-checkpoint")=="lesson-02-step-02"
                          and attempt.get_attribute("data-attempt-state")=="idle"
                          and attempt.locator("[data-attempt-observed-events] li").count()==0)
                    attempt.locator("[data-attempt-start]").focus()
                    attempt.locator("[data-attempt-start]").press("Enter")
                    check("post-85ff-step-attempt-keyboard-start-keeps-graph-and-progress",
                          attempt.get_attribute("data-attempt-state")=="active"
                          and attempt.get_attribute("data-attempt-step")=="1"
                          and attempt.locator("[data-attempt-check]").is_enabled()
                          and attempt_page.evaluate(
                              "document.activeElement?.hasAttribute('data-attempt-check')") is True
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress
                          and attempt_page.locator("#sceneMount canvas").get_attribute(
                              "data-lab-wire-count")=="0")
                    attempt_page.locator("#control-interval").focus()
                    attempt_page.locator("#control-interval").press("ArrowRight")
                    check("post-85ff-step-attempt-captures-real-control-action-after-start",
                          attempt.get_attribute("data-attempt-state")=="active"
                          and attempt.get_attribute("data-attempt-step")=="1"
                          and "change-control" in attempt.locator(
                              "[data-attempt-observed-events]").inner_text()
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt.locator("[data-attempt-check]").focus()
                    attempt.locator("[data-attempt-check]").press("Enter")
                    check("post-85ff-step-attempt-explicit-check-is-informational-not-mastery",
                          attempt.get_attribute("data-attempt-state")=="checked"
                          and attempt.locator('[data-attempt-review-status="expected-current-attempt-events-observed"]').count()==1
                          and "không phải" in attempt.inner_text().lower()
                          and attempt_page.locator("#completeButton").is_hidden()
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt_page.locator("#control-interval").focus()
                    attempt_page.locator("#control-interval").press("ArrowRight")
                    check("post-85ff-step-attempt-repeated-action-invalidates-stale-check-review",
                          attempt.get_attribute("data-attempt-state")=="active"
                          and attempt.locator("[data-practice-step-attempt-review]").count()==0
                          and "2 event" in attempt.locator(
                              "[data-practice-step-attempt-status]").inner_text()
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt_page.locator(
                        '#learningCoach [data-practice-trail-navigate-step="2"]').click()
                    check("post-85ff-step-attempt-switch-step-revokes-old-token-and-overlap",
                          attempt.get_attribute("data-attempt-checkpoint")=="lesson-02-step-03"
                          and attempt.get_attribute("data-attempt-state")=="idle"
                          and attempt.locator("[data-attempt-observed-events] li").count()==0)
                    attempt.locator("[data-attempt-start]").click()
                    attempt.locator("[data-attempt-check]").click()
                    check("post-85ff-step-attempt-second-step-rejects-previous-step-event-proof",
                          attempt.get_attribute("data-attempt-state")=="checked"
                          and attempt.locator('[data-attempt-review-status="no-current-attempt-events"]').count()==1
                          and attempt.locator("[data-attempt-observed-events] li").count()==0
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt_page.locator("#runButton").click()
                    attempt_page.locator("#control-interval").focus()
                    attempt_page.locator("#control-interval").press("ArrowLeft")
                    attempt.locator("[data-attempt-check]").click()
                    check("post-85ff-step-attempt-fresh-step-observes-both-real-in-app-events-only",
                          attempt.locator('[data-attempt-review-status="expected-current-attempt-events-observed"]').count()==1
                          and "start-simulation" in attempt.locator(
                              "[data-attempt-observed-events]").inner_text()
                          and "change-control" in attempt.locator(
                              "[data-attempt-observed-events]").inner_text()
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt.locator("[data-attempt-retry]").focus()
                    attempt.locator("[data-attempt-retry]").press("Enter")
                    check("post-85ff-step-attempt-retry-resets-only-step-attempt-evidence",
                          attempt.get_attribute("data-attempt-state")=="active"
                          and attempt.locator("[data-attempt-observed-events] li").count()==0
                          and attempt_page.locator("#progressText").inner_text()==attempt_progress)
                    attempt.locator("[data-attempt-cancel]").focus()
                    attempt.locator("[data-attempt-cancel]").press("Enter")
                    check("post-85ff-step-attempt-cancel-recovers-actionable-keyboard-focus",
                          attempt.get_attribute("data-attempt-state")=="idle"
                          and attempt_page.evaluate(
                              "document.activeElement?.hasAttribute('data-attempt-start')") is True)
                    attempt_page.set_viewport_size({"width":375,"height":812})
                    attempt_buttons=attempt.locator(".practice-step-attempt-actions button")
                    rects=[node.bounding_box() for node in attempt_buttons.all()]
                    check("post-85ff-step-attempt-mobile-375px-native-controls-44px-no-overflow",
                          len(rects)==4 and all(r is not None and
                              r["width"]>=44 and r["height"]>=44 for r in rects)
                          and attempt_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                    attempt_page.set_viewport_size({"width":1280,"height":820})
                    for signal_lesson in (10,14):
                        attempt_page.locator(
                            f'.lesson-link[data-lesson="{signal_lesson}"]').click()
                        attempt_page.locator("#infoTabPractice").click()
                        attempt=attempt_page.locator(
                            "#learningCoach [data-practice-step-attempt]")
                        attempt.locator("[data-attempt-start]").click()
                        attempt.locator("[data-attempt-check]").click()
                        check(f"post-85ff-step-attempt-{signal_lesson}-signal-only-without-autocompletion",
                              attempt.get_attribute("data-attempt-lesson")==str(signal_lesson)
                              and "signal-only" in attempt.inner_text().lower()
                              and attempt_page.locator("#progressText").inner_text()==attempt_progress
                              and attempt_page.locator("#completeButton").is_hidden())
                finally:
                    attempt_context.close()

                # Post-85ff practical repair path: a missing authored pair
                # enters the current 3D editor with an exact native Connect
                # proposal but ZERO auto-wires. A current extra-review learner
                # edge navigates to exact per-ID actions, never auto-removes.
                # Separately, 3D endpoint drag is visual-only until Confirm
                # atomically disconnects/reconnects through circuit-router.
                repair_context=browser.new_context(
                    viewport={"width":1280,"height":820},
                    service_workers="allow",has_touch=True)
                try:
                    repair_page=repair_context.new_page()
                    capture_console(repair_page)
                    repair_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(repair_page)
                    repair_page.locator('.lesson-link[data-lesson="2"]').click()
                    repair_page.locator("#infoTabPractice").click()
                    repair_progress=repair_page.locator("#progressText").inner_text()
                    repair_canvas=repair_page.locator("#sceneMount canvas")
                    missing_actions=repair_page.locator(
                        "#learningCoach [data-practice-start-repair-missing-pair]")
                    check("post-85ff-practice-missing-authored-pairs-have-real-edit-entry",
                          missing_actions.count()==3
                          and repair_canvas.get_attribute("data-lab-wire-count")=="0"
                          and repair_page.locator(
                              "#learningCoach [data-practice-start-review-extra-pair]").count()==0)
                    missing_actions.first.focus()
                    missing_actions.first.press("Enter")
                    check("post-85ff-practice-missing-pair-opens-native-3d-connect-uncommitted",
                          repair_page.locator("#labEditor").is_visible()
                          and repair_page.locator("#labFromPin").input_value()=="D13"
                          and repair_page.locator("#labToPin").input_value()=="R1:A"
                          and repair_page.evaluate("document.activeElement?.id")=="labConnect"
                          and repair_canvas.get_attribute("data-lab-wire-count")=="0"
                          and repair_page.locator("#progressText").inner_text()==repair_progress)
                    repair_page.locator("#labConnect").press("Enter")
                    check("post-85ff-practice-missing-pair-commits-only-after-explicit-connect",
                          repair_canvas.get_attribute("data-lab-wire-count")=="1"
                          and repair_page.locator(
                              '#labEditor [data-lab-wire-row="w1"]').count()==1
                          and repair_page.locator("#progressText").inner_text()==repair_progress)
                    repair_page.locator("#labFromPin").select_option("D13")
                    repair_page.locator("#labToPin").select_option("GND")
                    repair_page.locator("#labConnect").click()
                    check("post-85ff-practice-extra-review-is-real-current-learner-wire",
                          repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_page.locator(
                              '#labEditor [data-lab-wire-row="w2"]').count()==1
                          and repair_page.locator(
                              "#learningCoach [data-practice-start-review-extra-pair]").count()>=1)
                    repair_page.locator(
                        "#learningCoach [data-practice-start-review-extra-pair]").first.click()
                    check("post-85ff-practice-extra-review-focuses-exact-wire-without-removal",
                          repair_page.evaluate(
                              "document.activeElement?.dataset.labInspectWireId")=="w2"
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_page.locator("#progressText").inner_text()==repair_progress)
                    repair_page.locator(
                        '#labEditor [data-lab-inspect-wire-id="w2"]').click()
                    check("post-85ff-extra-review-exposes-native-3d-jumper-repair-only-on-selection",
                          repair_canvas.get_attribute("data-lab-highlighted-wire")=="w2"
                          and repair_page.locator(
                              "#sceneInspectionStatus [data-wire-repair-start]").count()==1)
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-start]").click()
                    check("post-85ff-reroute-native-opt-in-is-preview-not-graph-edge",
                          repair_canvas.get_attribute("data-lab-committed-wire-repair-mode")==
                              "endpoint-reroute-preview"
                          and repair_canvas.get_attribute("data-lab-committed-wire-repair-electrical-authority")=="false"
                          and repair_page.locator("#sceneWireRepairAnchor").input_value()=="D13"
                          and repair_page.locator(
                              "#sceneInspectionStatus [data-wire-repair-confirm]").is_disabled()
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2")
                    repair_page.locator("#sceneWireRepairTarget").select_option("R1:B")
                    check("post-85ff-reroute-keyboard-target-selection-needs-distinct-confirm",
                          not repair_page.locator(
                              "#sceneInspectionStatus [data-wire-repair-confirm]").is_disabled()
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2")
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-cancel]").focus()
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-cancel]").press("Enter")
                    check("post-85ff-reroute-cancel-leaves-exact-learner-graph-and-focus",
                          repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_canvas.get_attribute("data-lab-committed-wire-repair-mode")=="off"
                          and repair_page.evaluate(
                              "document.activeElement?.hasAttribute('data-wire-repair-start')") is True)
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-start]").click()
                    repair_page.locator("#sceneWireRepairTarget").select_option("R1:B")
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-confirm]").focus()
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-confirm]").press("Enter")
                    check("post-85ff-reroute-explicit-confirm-atomically-replaces-canonical-wire",
                          repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_page.locator(
                              '#labEditor [data-lab-wire-row="w2"]').count()==0
                          and repair_page.locator(
                              '#labEditor [data-lab-wire-row="w3"]').count()==1
                          and repair_canvas.get_attribute("data-lab-committed-wire-repair-mode")=="off"
                          and repair_page.locator("#progressText").inner_text()==repair_progress)
                    repair_page.locator("#stageTabWiring").click()
                    check("post-85ff-reroute-2d-and-explorer-project-same-new-router-edge",
                          repair_page.locator(".wiring-view .wire-connected").count()==2
                          and repair_page.locator(
                              '#labExplorer [data-explorer-wire="w3"]').count()>=1
                          and repair_page.locator(
                              '#labExplorer [data-explorer-wire="w2"]').count()==0)
                    repair_page.locator("#stageTab3d").click()
                    repair_page.locator("#labUndoWire").click()
                    check("post-85ff-reroute-one-history-undo-restores-original-exact-wire",
                          repair_page.locator(
                              '#labEditor [data-lab-wire-row="w2"]').count()==1
                          and repair_page.locator(
                              '#labEditor [data-lab-wire-row="w3"]').count()==0
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2")
                    repair_page.locator("#labRedoWire").click()
                    check("post-85ff-reroute-one-history-redo-restores-new-edge",
                          repair_page.locator(
                              '#labEditor [data-lab-wire-row="w2"]').count()==0
                          and repair_page.locator(
                              '#labEditor [data-lab-wire-row="w3"]').count()==1
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_page.locator("#progressText").inner_text()==repair_progress)
                    repair_page.locator(
                        '#labEditor [data-lab-inspect-wire-id="w3"]').click()
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-start]").click()
                    # Re-activating the current 3D tab rebuilds wiring lines.
                    # The host intent and scene gesture MUST remain in sync;
                    # no stale dock may claim an active repair when the scene
                    # silently fell back to ordinary committed-wire picking.
                    repair_page.locator("#stageTab3d").click()
                    check("post-85ff-reroute-same-stage-3d-rerender-rearms-exact-wire",
                          repair_canvas.get_attribute(
                              "data-lab-committed-wire-repair-mode")==
                              "endpoint-reroute-preview"
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_page.locator("#sceneWireRepairTarget").is_visible()
                          and repair_page.locator(
                              "#sceneInspectionStatus [data-wire-repair-confirm]").is_disabled()
                          and repair_page.locator("#progressText").inner_text()==repair_progress)
                    repair_page.locator(
                        '#cameraToolbar [data-camera="reset"]').click()
                    repair_page.wait_for_timeout(60)
                    # Demand a real 3D picked committed route and terminal
                    # release; never call private scene callbacks or set state
                    # through a Playwright evaluate shortcut.
                    wire_pixels=lab_scene_committed_wire_points(
                        repair_page,2,"D13","R1:B",wire_index=1)
                    pointer_reroute=None
                    for candidate_index in range(len(wire_pixels)):
                        # A miss is a genuine canvas camera gesture. It
                        # rotates the view, invalidating all precomputed
                        # pointer coordinates; reset/reproject EVERY attempt
                        # instead of accidentally testing stale screen pixels.
                        repair_page.locator(
                            '#cameraToolbar [data-camera="reset"]').click()
                        repair_page.wait_for_timeout(40)
                        fresh=lab_scene_committed_wire_points(
                            repair_page,2,"D13","R1:B",wire_index=1)
                        if candidate_index>=len(fresh):
                            continue
                        pixel=fresh[candidate_index]
                        target_pixel=lab_scene_point(
                            repair_page,2,terminal_id="GND")
                        repair_page.mouse.move(pixel["x"],pixel["y"])
                        repair_page.mouse.down()
                        repair_page.mouse.move(
                            target_pixel["x"],target_pixel["y"],steps=8)
                        repair_page.mouse.up()
                        if repair_page.locator(
                                "#sceneWireRepairTarget").input_value()=="GND":
                            pointer_reroute=pixel
                            break
                    check("post-85ff-real-3d-committed-wire-drag-arms-exact-target-only",
                          pointer_reroute is not None
                          and repair_canvas.get_attribute("data-lab-wire-count")=="2"
                          and repair_page.locator(
                              "#sceneInspectionStatus [data-wire-repair-confirm]").is_enabled()
                          and repair_page.locator("#progressText").inner_text()==repair_progress,
                          json.dumps({"target":lab_scene_point(
                                          repair_page,2,terminal_id="GND"),
                                      "picked":pointer_reroute,
                                      "candidateCount":len(wire_pixels),
                                      "mode":repair_canvas.get_attribute(
                                          "data-lab-committed-wire-repair-mode"),
                                      "preview":repair_canvas.get_attribute(
                                          "data-lab-committed-wire-repair-preview")},ensure_ascii=False))
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-cancel]").click()
                    repair_page.set_viewport_size({"width":375,"height":812})
                    repair_page.locator(
                        '#labEditor [data-lab-inspect-wire-id="w3"]').click()
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-start]").click()
                    repair_controls=repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-start], "
                        "#sceneInspectionStatus [data-wire-repair-confirm], "
                        "#sceneInspectionStatus [data-wire-repair-cancel], "
                        "#sceneWireRepairAnchor,#sceneWireRepairTarget")
                    control_rects=[control.bounding_box()
                                   for control in repair_controls.all()]
                    check("post-85ff-reroute-mobile-375px-controls-44px-no-overflow",
                          len(control_rects)==4
                          and all(rect is not None and
                              rect["width"]>=44 and rect["height"]>=44
                              for rect in control_rects)
                          and repair_page.evaluate(
                              "document.documentElement.scrollWidth <= innerWidth"))
                    repair_page.locator(
                        "#sceneInspectionStatus [data-wire-repair-cancel]").click()
                    repair_page.set_viewport_size({"width":1280,"height":820})
                finally:
                    repair_context.close()

                # Post-f71413e learner-control UX: real rendered push-cap
                # pointer press/release drives ONLY the existing HTML lesson
                # control simulation (lesson03/16). The scene does not create
                # graph edges, bypass input provenance or require WebGL-only
                # keyboard access; exact hit points are independently projected.
                button_context=browser.new_context(
                    viewport={"width":1280,"height":820},
                    service_workers="allow",has_touch=True)
                try:
                    button_page=button_context.new_page()
                    capture_console(button_page)
                    button_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(button_page)
                    button_canvas=button_page.locator("#sceneMount canvas")
                    button_progress=button_page.locator("#progressText").inner_text()
                    for button_lesson in (3,16):
                        button_page.locator(
                            f'.lesson-link[data-lesson="{button_lesson}"]').click()
                        button_page.locator(
                            '#cameraToolbar [data-camera="reset"]').click()
                        control=button_page.locator(
                            '#experimentControls [data-press="pressed"]')
                        pixel=legacy_scene_button_pixel(button_page,button_lesson)
                        check(f"post-f714-3d-button-{button_lesson}-has-active-explicit-cap-and-html-equivalent",
                              pixel["inViewport"] and pixel["insideCanvas"]
                              and pixel["onScreen"] and pixel["canvasUncovered"]
                              and button_canvas.get_attribute(
                                  "data-lesson-button-actuation")=="enabled"
                              and button_canvas.get_attribute(
                                  "data-lesson-button-actuation-lesson")==str(button_lesson)
                              and button_canvas.get_attribute(
                                  "data-lesson-button-pressed")=="false"
                              and control.count()==1
                              and control.get_attribute("aria-pressed")=="false",
                              json.dumps(pixel,ensure_ascii=False))
                        button_page.mouse.move(pixel["x"],pixel["y"])
                        button_page.mouse.down()
                        check(f"post-f714-3d-button-{button_lesson}-real-mouse-press-routes-through-lesson-control",
                              control.get_attribute("aria-pressed")=="true"
                              and button_canvas.get_attribute(
                                  "data-lesson-button-pressed")=="true"
                              and abs(float(button_canvas.get_attribute(
                                  "data-lesson-button-cap-y"))-0.46)<.001
                              and button_page.locator("#progressText").inner_text()==button_progress)
                        button_page.mouse.move(pixel["x"]+9,pixel["y"]+12,steps=4)
                        check(f"post-f714-3d-button-{button_lesson}-hold-does-not-orbit-or-auto-complete",
                              control.get_attribute("aria-pressed")=="true"
                              and button_canvas.get_attribute(
                                  "data-lesson-button-pressed")=="true"
                              and button_page.locator("#progressText").inner_text()==button_progress)
                        button_page.mouse.up()
                        check(f"post-f714-3d-button-{button_lesson}-pointerup-releases-canonical-and-visible-cap",
                              control.get_attribute("aria-pressed")=="false"
                              and button_canvas.get_attribute(
                                  "data-lesson-button-pressed")=="false"
                              and abs(float(button_canvas.get_attribute(
                                  "data-lesson-button-cap-y"))-0.57)<.001)
                    # HTML native button is still a complete keyboard input
                    # surface without an accidental canvas-only requirement.
                    control=button_page.locator(
                        '#experimentControls [data-press="pressed"]')
                    control.focus()
                    button_page.keyboard.down("Space")
                    check("post-f714-3d-button-html-keyboard-press-equivalent",
                          control.get_attribute("aria-pressed")=="true"
                          and button_canvas.get_attribute(
                              "data-lesson-button-cap-y")=="0.46")
                    button_page.keyboard.up("Space")
                    check("post-f714-3d-button-html-keyboard-release-equivalent",
                          control.get_attribute("aria-pressed")=="false"
                          and abs(float(button_canvas.get_attribute(
                              "data-lesson-button-cap-y"))-0.57)<.001)
                    # Use the real WebGL_lose_context extension rather than
                    # dispatching fake DOM events. Synthetic "restored" without
                    # restoring the GPU led Three.js to issue INVALID_OPERATION
                    # texture warnings, which the strict final console gate
                    # correctly rejected. Real GPU loss/restoration is the
                    # meaningful integration contract.
                    button_page.evaluate("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        const gl=canvas?.getContext('webgl2');
                        const ext=gl?.getExtension('WEBGL_lose_context');
                        if(!ext)throw new Error('Real WEBGL_lose_context extension unavailable');
                        window.__arduinoE2EGL=gl;
                        window.__arduinoE2ELoseExtension=ext;
                        ext.loseContext();
                    }""")
                    button_page.wait_for_function("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        return window.__arduinoE2EGL?.isContextLost()===true
                          &&canvas?.dataset.sceneContext==='lost';
                    }""",timeout=10000)
                    check("post-f714-3d-button-context-loss-fails-closed",
                          button_canvas.get_attribute("data-scene-context")=="lost"
                          and button_canvas.get_attribute(
                              "data-lesson-button-actuation")=="off"
                          and control.get_attribute("aria-pressed")=="false")
                    # The context-loss event has fired; allow the GPU to finish
                    # its lost-context frame before requesting the real restore.
                    button_page.wait_for_timeout(500)
                    button_page.evaluate("window.__arduinoE2ELoseExtension.restoreContext()")
                    button_page.wait_for_function("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        return window.__arduinoE2EGL?.isContextLost()===false
                          &&canvas?.dataset.sceneContext==='ready'
                          &&canvas.dataset.lessonButtonActuation==='enabled';
                    }""",timeout=10000)
                    check("post-f714-3d-button-restored-scene-rearms-current-lesson-only",
                          button_page.evaluate("window.__arduinoE2EGL?.isContextLost()") is False
                          and button_canvas.get_attribute("data-scene-context")=="ready"
                          and button_canvas.get_attribute(
                              "data-lesson-button-actuation-lesson")=="16"
                          and button_canvas.get_attribute(
                              "data-lesson-button-pressed")=="false")
                    button_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    after_restore=legacy_scene_button_pixel(button_page,16)
                    check("post-f714-3d-button-pointer-target-visible-after-html-focus-scroll",
                          after_restore["inViewport"] and after_restore["insideCanvas"]
                          and after_restore["onScreen"] and after_restore["canvasUncovered"],
                          json.dumps(after_restore,ensure_ascii=False))
                    button_page.mouse.move(after_restore["x"],after_restore["y"])
                    button_page.mouse.down()
                    check("post-f714-3d-button-real-press-after-webgl-restore",
                          control.get_attribute("aria-pressed")=="true"
                          and button_canvas.get_attribute(
                              "data-lesson-button-pressed")=="true"
                          and button_page.locator("#progressText").inner_text()==button_progress)
                    button_page.mouse.up()
                    check("post-f714-3d-button-release-after-restore-no-stuck-state",
                          control.get_attribute("aria-pressed")=="false"
                          and button_canvas.get_attribute(
                              "data-lesson-button-pressed")=="false")
                    for guide_lesson in (3,16):
                        button_page.locator(
                            f'.lesson-link[data-lesson="{guide_lesson}"]').click()
                        button_page.locator("#infoTabPractice").click()
                        previews=button_page.locator(
                            '#learningCoach [data-practice-preview-pair-3d]')
                        check(f"post-f714-button-{guide_lesson}-has-authored-guide-preview",
                              previews.count()>=1
                              and button_canvas.get_attribute(
                                  "data-lesson-button-actuation")=="enabled")
                        previews.first.click()
                        check(f"post-f714-button-{guide_lesson}-guide-mount-revokes-cap-actuation",
                              button_canvas.get_attribute(
                                  "data-lesson-button-actuation")=="off"
                              and button_page.locator(
                                  '#sceneInspectionStatus [data-authored-guide-dismiss]').is_visible())
                        button_page.locator(
                            '#sceneInspectionStatus [data-authored-guide-dismiss]').click()
                        check(f"post-f714-button-{guide_lesson}-guide-dismiss-rearms-current-cap",
                              button_canvas.get_attribute(
                                  "data-lesson-button-actuation")=="enabled"
                              and button_canvas.get_attribute(
                                  "data-lesson-button-pressed")=="false")
                        button_page.locator(
                            '#cameraToolbar [data-camera="reset"]').click()
                        post_guide=legacy_scene_button_pixel(button_page,guide_lesson)
                        check(f"post-f714-button-{guide_lesson}-3d-target-visible-after-guide-dismiss",
                              post_guide["inViewport"] and post_guide["insideCanvas"]
                              and post_guide["onScreen"] and post_guide["canvasUncovered"],
                              json.dumps(post_guide,ensure_ascii=False))
                        button_page.mouse.move(post_guide["x"],post_guide["y"])
                        button_page.mouse.down()
                        check(f"post-f714-button-{guide_lesson}-real-cap-press-after-guide-dismiss",
                              button_page.locator(
                                  '#experimentControls [data-press="pressed"]').get_attribute(
                                      "aria-pressed")=="true"
                              and button_canvas.get_attribute(
                                  "data-lesson-button-pressed")=="true"
                              and button_page.locator("#progressText").inner_text()==button_progress)
                        button_page.mouse.up()
                        check(f"post-f714-button-{guide_lesson}-release-after-guide-dismiss",
                              button_canvas.get_attribute("data-lesson-button-pressed")=="false")
                    button_page.locator('.lesson-link[data-lesson="2"]').click()
                    check("post-f714-3d-button-not-enabled-in-unrelated-lesson",
                          button_canvas.get_attribute(
                              "data-lesson-button-actuation")=="off"
                          and button_page.locator(
                              '#experimentControls [data-press]').count()==0)
                finally:
                    button_context.close()

                # Lesson04 real 3D potentiometer acceptance. The rendered knob
                # is a second pointer surface for the existing host-owned A0
                # range only. Keep the browser evidence on the public DOM and
                # scene diagnostics: pointer intent -> canonical range ->
                # simulator output/snapshot -> scene rotor visual.
                pot_context=browser.new_context(
                    viewport={"width":1280,"height":820},
                    service_workers="allow",has_touch=True)
                try:
                    pot_page=pot_context.new_page()
                    capture_console(pot_page)
                    pot_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(pot_page)
                    pot_page.locator('.lesson-link[data-lesson="4"]').click()
                    pot_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    pot_canvas=pot_page.locator("#sceneMount canvas")
                    pot_control=pot_page.locator("#control-analog")
                    pot_progress=pot_page.locator("#progressText").inner_text()
                    pot_progress_storage=pot_page.evaluate(
                        "localStorage.getItem('arduino-3d-viet-progress-v1')")
                    pot_complete_visible=pot_page.locator("#completeButton").is_visible()
                    pot_initial=lesson04_analog_acceptance_state(pot_page)
                    pot_pixel=lesson04_scene_knob_pixel(pot_page)
                    check("post-v16-lesson04-pot-target-and-canonical-html-control-ready",
                          pot_pixel["insideFrustum"] and pot_pixel["insideCanvas"]
                          and pot_pixel["onScreen"] and pot_pixel["canvasUncovered"]
                          and pot_control.count()==1
                          and pot_control.get_attribute("min")=="0"
                          and pot_control.get_attribute("max")=="1023"
                          and pot_control.get_attribute("step")=="1"
                          and lesson04_analog_state_agrees(pot_initial)
                          and pot_initial["gesture"]=="none",
                          json.dumps({"pixel":pot_pixel,"state":pot_initial},ensure_ascii=False))

                    pot_nonknob=pot_pixel["nonKnob"]
                    pot_page.mouse.move(pot_nonknob["x"],pot_nonknob["y"])
                    pot_page.mouse.down()
                    pot_page.mouse.move(
                        pot_nonknob["x"]+18,pot_nonknob["y"]+14,steps=3)
                    pot_page.mouse.up()
                    pot_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    pot_negative=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-mouse-nearby-body-drag-is-not-knob-input",
                          pot_nonknob["insideFrustum"] and pot_nonknob["insideCanvas"]
                          and pot_nonknob["onScreen"] and pot_nonknob["canvasUncovered"]
                          and pot_negative["gesture"]=="none"
                          and pot_negative["value"]==pot_initial["value"]
                          and lesson04_analog_state_agrees(pot_negative),
                          json.dumps({"pixel":pot_nonknob,"state":pot_negative},ensure_ascii=False))

                    # A real center tap owns/release the knob pointer but emits
                    # no value because the drag threshold was never crossed.
                    pot_page.mouse.move(pot_pixel["x"],pot_pixel["y"])
                    pot_page.mouse.down()
                    pot_grab=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-mouse-down-grabs-without-value-change",
                          pot_grab["gesture"]=="grabbed"
                          and pot_grab["value"]==pot_initial["value"]
                          and pot_grab["simOutput"]==pot_initial["simOutput"]
                          and pot_grab["visualRotation"]==pot_initial["visualRotation"])
                    pot_page.mouse.up()
                    pot_tap=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-mouse-tap-is-no-change",
                          pot_tap["gesture"]=="none"
                          and pot_tap["value"]==pot_initial["value"]
                          and lesson04_analog_state_agrees(pot_tap))

                    # Re-grab the exact knob center. The center path deliberately
                    # uses the bounded horizontal fallback, so choose a direction
                    # with enough canvas room and issue only real Playwright mouse
                    # input; no evaluate-dispatched PointerEvent is accepted here.
                    pot_pixel=lesson04_scene_knob_pixel(pot_page)
                    pot_box=pot_canvas.bounding_box()
                    if pot_box is None:
                        raise AssertionError("Lesson04 3D canvas has no browser box")
                    pot_right=pot_box["x"]+pot_box["width"]-12
                    pot_left=pot_box["x"]+12
                    drag_delta=72 if pot_pixel["x"]+72<=pot_right else -72
                    if not (pot_left<=pot_pixel["x"]+drag_delta<=pot_right):
                        raise AssertionError("Lesson04 knob has no bounded horizontal drag room")
                    pot_page.mouse.move(pot_pixel["x"],pot_pixel["y"])
                    pot_page.mouse.down()
                    pot_page.mouse.move(
                        pot_pixel["x"]+drag_delta,pot_pixel["y"],steps=8)
                    pot_drag=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-mouse-drag-host-scene-output-snapshot-agree",
                          pot_drag["gesture"]=="dragging"
                          and pot_drag["value"]!=pot_initial["value"]
                          and lesson04_analog_state_agrees(pot_drag)
                          and pot_page.locator("#progressText").inner_text()==pot_progress,
                          json.dumps(pot_drag,ensure_ascii=False))
                    pot_page.mouse.up()
                    pot_release=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-pointerup-keeps-canonical-value-and-releases-gesture",
                          pot_release["gesture"]=="none"
                          and pot_release["value"]==pot_drag["value"]
                          and lesson04_analog_state_agrees(pot_release))

                    # Drive pen/touch through Chrome's input domain. These are
                    # browser-generated PointerEvents, not DOM dispatchEvent
                    # fixtures. Pen release deliberately has an end coordinate
                    # with no preceding drag move, covering the final-endpoint
                    # path separately from the zero-displacement mouse tap.
                    pot_input=pot_context.new_cdp_session(pot_page)
                    pot_pixel=lesson04_scene_knob_pixel(pot_page)
                    pot_pen_before=lesson04_analog_acceptance_state(pot_page)
                    pot_input.send("Input.dispatchMouseEvent",{
                        "type":"mouseMoved","x":pot_pixel["x"],"y":pot_pixel["y"],
                        "button":"none","buttons":0,"pointerType":"pen",
                    })
                    pot_input.send("Input.dispatchMouseEvent",{
                        "type":"mousePressed","x":pot_pixel["x"],"y":pot_pixel["y"],
                        "button":"left","buttons":1,"clickCount":1,"pointerType":"pen",
                    })
                    pot_pen_grab=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-pen-down-grabs-without-value-change",
                          pot_pen_grab["gesture"]=="grabbed"
                          and pot_pen_grab["value"]==pot_pen_before["value"])
                    pot_input.send("Input.dispatchMouseEvent",{
                        "type":"mouseReleased",
                        "x":pot_pixel["x"]+drag_delta,"y":pot_pixel["y"],
                        "button":"left","buttons":0,"clickCount":1,"pointerType":"pen",
                    })
                    pot_pen_release=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-pen-end-only-displacement-uses-release-endpoint",
                          pot_pen_release["gesture"]=="none"
                          and pot_pen_release["value"]!=pot_pen_before["value"]
                          and lesson04_analog_state_agrees(pot_pen_release),
                          json.dumps(pot_pen_release,ensure_ascii=False))

                    # Touch must remain owned by the knob even with a meaningful
                    # diagonal movement; a pan-y browser gesture would surface
                    # here as a pointercancel/unchanged host value and fail.
                    pot_pixel=lesson04_scene_knob_pixel(pot_page)
                    pot_box=pot_canvas.bounding_box()
                    if pot_box is None:
                        raise AssertionError("Lesson04 canvas lost browser box before touch")
                    touch_dx=-48 if pot_pen_release["value"]>512 else 48
                    if not (pot_box["x"]+12<=pot_pixel["x"]+touch_dx<=
                            pot_box["x"]+pot_box["width"]-12):
                        touch_dx=-touch_dx
                    touch_dy=52 if pot_pixel["y"]+52<=pot_box["y"]+pot_box["height"]-12 else -52
                    touch_start={
                        "x":pot_pixel["x"],"y":pot_pixel["y"],"id":41,
                        "radiusX":1,"radiusY":1,"force":1,
                    }
                    touch_move={**touch_start,
                        "x":pot_pixel["x"]+touch_dx,"y":pot_pixel["y"]+touch_dy}
                    pot_touch_before=lesson04_analog_acceptance_state(pot_page)
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchStart","touchPoints":[touch_start],
                    })
                    pot_touch_grab=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-touch-start-grabs-without-value-change",
                          pot_touch_grab["gesture"]=="grabbed"
                          and pot_touch_grab["value"]==pot_touch_before["value"])
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchMove","touchPoints":[touch_move],
                    })
                    pot_touch_drag=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-touch-diagonal-drag-converges-on-canonical-value",
                          pot_touch_drag["gesture"]=="dragging"
                          and pot_touch_drag["value"]!=pot_touch_before["value"]
                          and lesson04_analog_state_agrees(pot_touch_drag),
                          json.dumps(pot_touch_drag,ensure_ascii=False))
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchEnd","touchPoints":[],
                    })
                    pot_touch_end=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-touch-end-releases-with-last-canonical-value",
                          pot_touch_end["gesture"]=="none"
                          and pot_touch_end["value"]==pot_touch_drag["value"]
                          and lesson04_analog_state_agrees(pot_touch_end))

                    # A second real touch drag ends through Chrome touchCancel.
                    # Last accepted host state remains; cancel cannot fabricate a
                    # rollback or stale final change.
                    pot_pixel=lesson04_scene_knob_pixel(pot_page)
                    cancel_dx=-36 if pot_touch_end["value"]>512 else 36
                    cancel_dy=44 if pot_pixel["y"]+44<=pot_box["y"]+pot_box["height"]-12 else -44
                    cancel_start={
                        "x":pot_pixel["x"],"y":pot_pixel["y"],"id":42,
                        "radiusX":1,"radiusY":1,"force":1,
                    }
                    cancel_move={**cancel_start,
                        "x":pot_pixel["x"]+cancel_dx,"y":pot_pixel["y"]+cancel_dy}
                    pot_touch_cancel_before=lesson04_analog_acceptance_state(pot_page)
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchStart","touchPoints":[cancel_start],
                    })
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchMove","touchPoints":[cancel_move],
                    })
                    pot_touch_cancel_drag=lesson04_analog_acceptance_state(pot_page)
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchCancel","touchPoints":[],
                    })
                    pot_touch_cancel=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-touchcancel-clears-gesture-without-replay",
                          pot_touch_cancel_drag["gesture"]=="dragging"
                          and pot_touch_cancel_drag["value"]!=pot_touch_cancel_before["value"]
                          and pot_touch_cancel["gesture"]=="none"
                          and pot_touch_cancel["value"]==pot_touch_cancel_drag["value"]
                          and lesson04_analog_state_agrees(pot_touch_cancel))

                    # Lose the actual WebGL context while the knob owns a real
                    # mouse pointer. Host value must survive, the gesture must be
                    # revoked, and a real restore may re-arm only current lesson4.
                    pot_pixel=lesson04_scene_knob_pixel(pot_page)
                    pot_page.mouse.move(pot_pixel["x"],pot_pixel["y"])
                    pot_page.mouse.down()
                    pot_pre_loss=lesson04_analog_acceptance_state(pot_page)
                    pot_page.evaluate("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        const gl=canvas?.getContext('webgl2');
                        const ext=gl?.getExtension('WEBGL_lose_context');
                        if(!ext)throw new Error('Real WEBGL_lose_context extension unavailable');
                        window.__arduinoE2EPotGL=gl;
                        window.__arduinoE2EPotLoseExtension=ext;
                        ext.loseContext();
                    }""")
                    pot_page.wait_for_function("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        return window.__arduinoE2EPotGL?.isContextLost()===true
                          &&canvas?.dataset.sceneContext==='lost';
                    }""",timeout=10000)
                    check("post-v16-lesson04-pot-real-context-loss-revokes-active-grab-without-host-write",
                          pot_pre_loss["gesture"]=="grabbed"
                          and pot_canvas.get_attribute("data-lesson-pot-mode")=="off"
                          and pot_canvas.get_attribute("data-lesson-pot-gesture")=="none"
                          and int(pot_control.input_value())==pot_pre_loss["value"]
                          and pot_page.locator("#progressText").inner_text()==pot_progress)
                    pot_page.mouse.up()
                    pot_page.wait_for_timeout(500)
                    pot_page.evaluate("window.__arduinoE2EPotLoseExtension.restoreContext()")
                    pot_page.wait_for_function("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        return window.__arduinoE2EPotGL?.isContextLost()===false
                          &&canvas?.dataset.sceneContext==='ready'
                          &&canvas.dataset.lessonPotMode==='enabled';
                    }""",timeout=10000)
                    pot_after_restore=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-real-context-restore-rearms-current-value-only",
                          pot_after_restore["value"]==pot_pre_loss["value"]
                          and pot_after_restore["gesture"]=="none"
                          and lesson04_analog_state_agrees(pot_after_restore))

                    # Keyboard remains entirely native on the HTML range. Each
                    # key must converge through the same host/snapshot/scene path.
                    pot_control.focus()
                    pot_control.press("Home")
                    pot_home=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-keyboard-home-converges-on-zero",
                          pot_home["value"]==0
                          and pot_home["gesture"]=="none"
                          and lesson04_analog_state_agrees(pot_home))
                    pot_control.press("ArrowRight")
                    pot_arrow=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-keyboard-arrowright-converges-on-one",
                          pot_arrow["value"]==1
                          and pot_arrow["gesture"]=="none"
                          and lesson04_analog_state_agrees(pot_arrow))
                    pot_control.press("End")
                    pot_end=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-keyboard-end-converges-on-1023",
                          pot_end["value"]==1023
                          and pot_end["gesture"]=="none"
                          and lesson04_analog_state_agrees(pot_end))

                    pot_page.set_viewport_size({"width":375,"height":812})
                    pot_page.wait_for_function("""() => {
                        const canvas=document.querySelector('#sceneMount canvas');
                        if(!canvas||canvas.clientWidth<=0||canvas.clientHeight<=0)return false;
                        const ratioX=canvas.width/canvas.clientWidth;
                        const ratioY=canvas.height/canvas.clientHeight;
                        return ratioX>=.9&&ratioX<=1.75&&Math.abs(ratioX-ratioY)<.05;
                    }""",timeout=5000)
                    pot_page.locator('#cameraToolbar [data-camera="reset"]').click()
                    pot_mobile_pixel=lesson04_scene_knob_pixel(pot_page)
                    pot_mobile_bounds=pot_mobile_pixel["projectedBounds"]
                    pot_mobile_canvas_box=pot_canvas.bounding_box()
                    if pot_mobile_canvas_box is None:
                        raise AssertionError("Lesson04 mobile canvas has no browser box")
                    mobile_touch_before=lesson04_analog_acceptance_state(pot_page)
                    mobile_dx=-32 if mobile_touch_before["value"]>512 else 32
                    if not (pot_mobile_canvas_box["x"]+10<=
                            pot_mobile_pixel["x"]+mobile_dx<=
                            pot_mobile_canvas_box["x"]+pot_mobile_canvas_box["width"]-10):
                        mobile_dx=-mobile_dx
                    mobile_dy=(36 if pot_mobile_pixel["y"]+36<=
                               pot_mobile_canvas_box["y"]+pot_mobile_canvas_box["height"]-10
                               else -36)
                    mobile_start={
                        "x":pot_mobile_pixel["x"],"y":pot_mobile_pixel["y"],"id":43,
                        "radiusX":1,"radiusY":1,"force":1,
                    }
                    mobile_move={**mobile_start,
                        "x":pot_mobile_pixel["x"]+mobile_dx,
                        "y":pot_mobile_pixel["y"]+mobile_dy}
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchStart","touchPoints":[mobile_start],
                    })
                    mobile_touch_grab=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-mobile-375-real-touch-hits-actual-small-knob",
                          pot_mobile_pixel["insideFrustum"]
                          and pot_mobile_pixel["insideCanvas"]
                          and pot_mobile_pixel["onScreen"]
                          and pot_mobile_pixel["canvasUncovered"]
                          and 0<pot_mobile_bounds["width"]<44
                          and 0<pot_mobile_bounds["height"]<44
                          and mobile_touch_grab["gesture"]=="grabbed"
                          and mobile_touch_grab["value"]==mobile_touch_before["value"],
                          json.dumps({"pixel":pot_mobile_pixel,
                                      "projectedBounds":pot_mobile_bounds},ensure_ascii=False))
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchMove","touchPoints":[mobile_move],
                    })
                    mobile_touch_drag=lesson04_analog_acceptance_state(pot_page)
                    pot_input.send("Input.dispatchTouchEvent",{
                        "type":"touchEnd","touchPoints":[],
                    })
                    mobile_touch_end=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-mobile-375-real-touch-drag-remains-operable",
                          mobile_touch_drag["gesture"]=="dragging"
                          and mobile_touch_drag["value"]!=mobile_touch_before["value"]
                          and mobile_touch_end["gesture"]=="none"
                          and mobile_touch_end["value"]==mobile_touch_drag["value"]
                          and lesson04_analog_state_agrees(mobile_touch_end)
                          and pot_page.locator("#progressText").inner_text()==pot_progress,
                          json.dumps({"drag":mobile_touch_drag,"end":mobile_touch_end},
                                     ensure_ascii=False))
                    pot_control.scroll_into_view_if_needed()
                    pot_control.focus()
                    pot_mobile_rect=pot_control.bounding_box()
                    check("post-v16-lesson04-pot-mobile-375px-native-slider-44px-focus-no-overflow",
                          pot_mobile_rect is not None
                          and pot_mobile_rect["width"]>=44
                          and pot_mobile_rect["height"]>=44
                          and pot_page.evaluate(
                              "document.activeElement?.id==='control-analog'") is True
                          and pot_page.evaluate(
                              "document.documentElement.scrollWidth<=innerWidth") is True
                          and lesson04_analog_state_agrees(
                              lesson04_analog_acceptance_state(pot_page)))

                    # Lab Edit mounts the conceptual layout and therefore must
                    # revoke the legacy lesson knob. Closing Edit restores the
                    # exact host value through the normal scene binding path.
                    pot_page.set_viewport_size({"width":1280,"height":820})
                    pot_edit_value=int(pot_control.input_value())
                    pot_page.locator("#labEditToggle").click()
                    check("post-v16-lesson04-pot-lab-edit-revokes-legacy-knob-without-graph-progress",
                          pot_page.locator("#labEditToggle").get_attribute("aria-pressed")=="true"
                          and pot_canvas.get_attribute("data-lab-edit")=="on"
                          and pot_canvas.get_attribute("data-lesson-pot-mode")=="off"
                          and pot_canvas.get_attribute("data-lab-wire-count")=="0"
                          and int(pot_control.input_value())==pot_edit_value
                          and pot_page.locator("#progressText").inner_text()==pot_progress)
                    pot_page.locator("#labEditToggle").click()
                    pot_after_edit=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-lab-edit-close-rearms-same-canonical-value",
                          pot_page.locator("#labEditToggle").get_attribute("aria-pressed")=="false"
                          and pot_canvas.get_attribute("data-lab-edit")=="off"
                          and pot_after_edit["value"]==pot_edit_value
                          and lesson04_analog_state_agrees(pot_after_edit))

                    # Open the canonical wiring surface only after the input
                    # journey. A fresh isolated context must still have zero
                    # learner edges, while both visible and persisted progress
                    # remain exactly unchanged by pointer/keyboard interaction.
                    pot_page.locator("#stageTabWiring").click()
                    pot_undo=pot_page.locator(
                        '.wire-actions [aria-label="Hoàn tác trạng thái đấu dây trước đó trong ứng dụng"]')
                    pot_redo=pot_page.locator(
                        '.wire-actions [aria-label="Làm lại trạng thái đấu dây tiếp theo trong ứng dụng"]')
                    check("post-v16-lesson04-pot-no-electrical-graph-or-progress-write",
                          pot_page.locator("#viewport .wiring-view.is-interactive").count()==1
                          and pot_page.locator(".wiring-view .wire-connected").count()==0
                          and pot_page.locator(".wire-activate").get_attribute("aria-pressed")=="false"
                          and pot_undo.count()==1 and pot_undo.is_disabled()
                          and pot_redo.count()==1 and pot_redo.is_disabled()
                          and pot_canvas.get_attribute("data-lesson-pot-mode")=="off"
                          and pot_page.locator("#progressText").inner_text()==pot_progress
                          and pot_page.locator("#completeButton").is_visible()==pot_complete_visible
                          and pot_page.evaluate(
                              "localStorage.getItem('arduino-3d-viet-progress-v1')")==pot_progress_storage)
                    pot_page.locator("#stageTab3d").click()
                    pot_after_stage=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-return-to-3d-rearms-same-host-value",
                          pot_after_stage["value"]==pot_edit_value
                          and pot_after_stage["gesture"]=="none"
                          and lesson04_analog_state_agrees(pot_after_stage))

                    pot_page.locator('.lesson-link[data-lesson="5"]').click()
                    check("post-v16-lesson04-pot-lesson-switch-revokes-old-knob-authority",
                          pot_canvas.get_attribute("data-lesson-pot-mode")=="off"
                          and pot_page.locator("#control-analog").count()==0
                          and pot_page.locator("#progressText").inner_text()==pot_progress)
                    pot_page.locator('.lesson-link[data-lesson="4"]').click()
                    pot_return_lesson=lesson04_analog_acceptance_state(pot_page)
                    check("post-v16-lesson04-pot-return-current-lesson-rearms-default-canonical-path",
                          pot_return_lesson["gesture"]=="none"
                          and lesson04_analog_state_agrees(pot_return_lesson)
                          and pot_page.locator("#progressText").inner_text()==pot_progress)
                finally:
                    pot_context.close()

                # Post-f714 guided ACTION -> DO -> CHECK: one current authored
                # checkpoint CTA composes the already-owned attempt/evidence
                # modules. Focus intents must not synthesize activity or credit;
                # only the learner's subsequent native action is recorded.
                guided_context=browser.new_context(
                    viewport={"width":1280,"height":820},service_workers="allow")
                try:
                    guided_page=guided_context.new_page()
                    capture_console(guided_page)
                    guided_page.goto(base,wait_until="domcontentloaded",timeout=20000)
                    ready(guided_page)
                    guided_page.locator('.lesson-link[data-lesson="2"]').click()
                    guided_page.locator("#infoTabPractice").click()
                    guided_progress=guided_page.locator("#progressText").inner_text()
                    guided_card=guided_page.locator(
                        "#learningCoach [data-practice-guided-task]")
                    guided_cta=guided_card.locator("[data-guided-task-action]")
                    guided_attempt=guided_page.locator(
                        "#learningCoach [data-practice-step-attempt]")
                    check("post-f714-guided-lesson2-first-checkpoint-has-explicit-start-action",
                          guided_card.count()==1 and guided_cta.count()==1
                          and guided_cta.get_attribute("data-guided-task-action")=="start"
                          and guided_attempt.get_attribute("data-attempt-state")=="idle")
                    guided_cta.focus()
                    guided_cta.press("Enter")
                    check("post-f714-guided-start-opt-in-only-does-not-claim-step-evidence",
                          guided_attempt.get_attribute("data-attempt-state")=="active"
                          and guided_cta.get_attribute("data-guided-task-action")=="view-wiring"
                          and guided_attempt.locator(
                              "[data-attempt-observed-events] li").count()==0
                          and guided_page.locator("#progressText").inner_text()==guided_progress)
                    guided_cta.click()
                    check("post-f714-guided-real-view-wiring-captures-current-step-only",
                          guided_page.locator("#stageTabWiring").get_attribute("aria-selected")=="true"
                          and guided_cta.get_attribute("data-guided-task-action")=="focus-check"
                          and guided_attempt.locator(
                              "[data-attempt-observed-events] li").count()==1
                          and guided_page.locator("#progressText").inner_text()==guided_progress)
                    guided_cta.click()
                    check("post-f714-guided-focus-check-does-not-check-implicitly",
                          guided_attempt.get_attribute("data-attempt-state")=="active"
                          and guided_page.evaluate(
                              "document.activeElement?.hasAttribute('data-attempt-check')") is True)
                    guided_attempt.locator("[data-attempt-check]").press("Enter")
                    check("post-f714-guided-explicit-check-is-informational-and-next-is-not-mastered",
                          guided_attempt.get_attribute("data-attempt-state")=="checked"
                          and guided_cta.get_attribute("data-guided-task-action")=="focus-next"
                          and guided_page.locator("#progressText").inner_text()==guided_progress)
                    guided_cta.click()
                    check("post-f714-guided-category-complete-only-focuses-next-without-advancing",
                          guided_attempt.get_attribute("data-attempt-step")=="0"
                          and guided_page.evaluate("document.activeElement?.id")=="coachNext"
                          and guided_page.locator("#progressText").inner_text()==guided_progress)
                    guided_page.locator("#coachNext").press("Enter")
                    check("post-f714-guided-next-revokes-prior-step-attempt-context",
                          guided_attempt.get_attribute("data-attempt-step")=="1"
                          and guided_attempt.get_attribute("data-attempt-state")=="idle"
                          and guided_cta.get_attribute("data-guided-task-action")=="start")
                    guided_cta.click()
                    check("post-f714-guided-control-step-requests-focus-not-control-change",
                          guided_cta.get_attribute("data-guided-task-action")=="focus-control"
                          and guided_attempt.locator(
                              "[data-attempt-observed-events] li").count()==0)
                    guided_cta.click()
                    check("post-f714-guided-focus-control-is-actual-native-slider-no-synthetic-event",
                          guided_page.evaluate(
                              "document.activeElement?.dataset.control")=="interval"
                          and guided_attempt.locator(
                              "[data-attempt-observed-events] li").count()==0)
                    guided_page.locator('#experimentControls [data-control="interval"]').press("ArrowRight")
                    check("post-f714-guided-actual-slider-input-updates-step-action",
                          guided_cta.get_attribute("data-guided-task-action")=="focus-check"
                          and guided_attempt.locator(
                              "[data-attempt-observed-events] li").count()==1
                          and guided_page.locator("#progressText").inner_text()==guided_progress)
                    guided_page.set_viewport_size({"width":375,"height":812})
                    guided_rect=guided_cta.bounding_box()
                    check("post-f714-guided-mobile-375px-native-cta-44px-no-overflow",
                          guided_rect is not None and guided_rect["width"]>=44
                          and guided_rect["height"]>=44
                          and guided_page.evaluate(
                              "document.documentElement.scrollWidth<=innerWidth"))
                    guided_page.set_viewport_size({"width":1280,"height":820})
                    guided_page.locator('.lesson-link[data-lesson="4"]').click()
                    guided_page.locator("#infoTabPractice").click()
                    guided_page.locator("#coachNext").click()
                    guided_page.locator("#coachNext").click()
                    guided_cta.click()
                    check("post-f714-guided-no-expectation-step-remains-explicit-self-review",
                          guided_attempt.get_attribute("data-attempt-step")=="2"
                          and guided_cta.get_attribute("data-guided-task-action")=="self-review"
                          and guided_page.locator("#progressText").inner_text()==guided_progress)
                    guided_cta.click()
                    check("post-f714-guided-self-review-only-focuses-check-without-auto-grading",
                          guided_attempt.get_attribute("data-attempt-state")=="active"
                          and guided_page.evaluate(
                              "document.activeElement?.hasAttribute('data-attempt-check')") is True)
                finally:
                    guided_context.close()

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
                guided_inspection_offline = app.evaluate("""async () => {
                    const baseUrl = document.baseURI;
                    const [groups, branch, mechanical] = await Promise.all([
                        import(new URL('./src/breadboard-authored-groups.js',baseUrl).href),
                        import(new URL('./src/resistive-branch-study.js',baseUrl).href),
                        import(new URL('./src/uno-mechanical-reference.js',baseUrl).href),
                    ]);
                    const docs=[
                        './docs/BREADBOARD_AUTHORED_GROUPS_NEXT.md',
                        './docs/SCENE_WIRE_INSPECTION_NEXT.md',
                        './docs/RESISTIVE_BRANCH_STUDY_NEXT.md',
                        './docs/UNO_MECHANICAL_REFERENCE_NEXT.md',
                        './docs/PRACTICE_PAIR_PREVIEW_NEXT.md',
                    ];
                    const fetched=await Promise.all(docs.map(async name=>{
                        const response=await fetch(new URL(name,baseUrl));
                        return {name,ok:response.ok,length:response.ok?(await response.text()).length:0};
                    }));
                    return {
                        groups:typeof groups.groupBreadboardAuthoredPlacement==='function' &&
                            groups.BREADBOARD_AUTHORED_GROUPS_SCHEMA_VERSION===1,
                        branch:typeof branch.solveResistiveBranchStudy==='function' &&
                            branch.RESISTIVE_BRANCH_LIMITS.voltageMaxVolts===5,
                        mechanical:typeof mechanical.getUnoMechanicalOutline==='function' &&
                            mechanical.UNO_MECHANICAL_OUTLINE.claims.sceneCoordinatesVerified===false,
                        docs:fetched,
                    };
                }""")
                check("vnext-guided-inspection-three-runtime-modules-and-five-docs-offline",
                      guided_inspection_offline["groups"]
                      and guided_inspection_offline["branch"]
                      and guided_inspection_offline["mechanical"]
                      and len(guided_inspection_offline["docs"]) == 5
                      and all(x["ok"] and x["length"] > 150 for x in guided_inspection_offline["docs"]),
                      json.dumps(guided_inspection_offline, ensure_ascii=False))
                rich_interaction_offline = app.evaluate("""async () => {
                    const baseUrl=document.baseURI;
                    const [model,ui,timer] = await Promise.all([
                      import(new URL('./src/practice-checkpoint-trail.js',baseUrl).href),
                      import(new URL('./src/practice-checkpoint-trail-ui.js',baseUrl).href),
                      import(new URL('./src/avr-timer2.js',baseUrl).href),
                    ]);
                    const paths=[
                      './docs/POST_V16_TERMINAL_DRAG.md',
                      './docs/LAB_EDITOR_PRECISION_WIRES_NEXT.md',
                      './docs/PRACTICE_48_STEP_TRAIL_NEXT.md',
                      './docs/SKETCH_TO_INSPECTOR_NEXT.md',
                      './docs/AVR_TIMER2_CTC_STUDY_NEXT.md',
                      './docs/POST_V16_RICH_INTERACTION_QA.md',
                      './assets/vendor/avr/avr8js-0.21.1-source/timer.ts',
                      './assets/vendor/avr/avr8js-0.21.1-source/timer.spec.ts',
                    ];
                    const docs=await Promise.all(paths.map(async path=>{
                      const response=await fetch(new URL(path,baseUrl),{cache:'no-store'});
                      return {path,ok:response.ok,size:response.ok?(await response.text()).length:0};
                    }));
                    return {
                      model:typeof model.buildPracticeCheckpointTrail==='function' &&
                        model.PRACTICE_CHECKPOINT_TRAIL_LIMITS.totalCheckpoints===48,
                      ui:typeof ui.renderPracticeCheckpointTrail==='function',
                      timer2:timer.AVR_TIMER2_CAPABILITIES.ctc===true &&
                        timer.AVR_TIMER2_CAPABILITIES.pwm===false &&
                        timer.AVR_TIMER2_CAPABILITIES.outputComparePins===false,
                      docs,
                    };
                }""")
                check("post-v16-rich-checkpoint-ctc-and-eight-evidence-assets-cached-offline",
                      rich_interaction_offline["model"] and rich_interaction_offline["ui"]
                      and rich_interaction_offline["timer2"]
                      and len(rich_interaction_offline["docs"])==8
                      and all(x["ok"] and x["size"]>150 for x in rich_interaction_offline["docs"]),
                      json.dumps(rich_interaction_offline,ensure_ascii=False))
                attempt_repair_offline=app.evaluate("""async()=>{
                    const baseUrl=document.baseURI;
                    const [model,ui,css,docs]=await Promise.all([
                        import(new URL('./src/practice-step-attempt.js',baseUrl).href),
                        import(new URL('./src/practice-step-attempt-ui.js',baseUrl).href),
                        fetch(new URL('./styles/practice-step-attempt.css',baseUrl)),
                        Promise.all([
                            './docs/PRACTICE_STEP_ATTEMPTS.md',
                            './docs/PRACTICE_REPAIR_ACTIONS.md',
                            './docs/PRACTICE_REPAIR_EDITOR_HANDOFF.md',
                            './docs/THREE_D_COMMITTED_WIRE_REPAIR.md',
                        ].map(async path=>{
                            const response=await fetch(new URL(path,baseUrl));
                            return {path,ok:response.ok,
                              size:response.ok?(await response.text()).length:0};
                        })),
                    ]);
                    return {
                        model:typeof model.createPracticeStepAttemptSession==='function'
                          &&model.PRACTICE_STEP_ATTEMPT_LIMITS.totalCheckpoints===48
                          &&model.PRACTICE_STEP_ATTEMPT_LIMITS.maxRecords===64,
                        ui:typeof ui.renderPracticeStepAttempt==='function',
                        css:css.ok&&(await css.text()).includes('.practice-step-attempt'),
                        docs,
                    };
                }""")
                check("post-85ff-step-attempt-and-wire-repair-resources-available-offline",
                      attempt_repair_offline["model"] and attempt_repair_offline["ui"]
                      and attempt_repair_offline["css"]
                      and len(attempt_repair_offline["docs"])==4
                      and all(row["ok"] and row["size"]>150
                              for row in attempt_repair_offline["docs"]),
                      json.dumps(attempt_repair_offline,ensure_ascii=False))
                guided_button_offline=app.evaluate("""async()=>{
                    const baseUrl=document.baseURI;
                    const [model,ui,css,docs]=await Promise.all([
                        import(new URL('./src/practice-guided-task.js',baseUrl).href),
                        import(new URL('./src/practice-guided-task-ui.js',baseUrl).href),
                        fetch(new URL('./styles/practice-guided-task.css',baseUrl)),
                        Promise.all([
                          './docs/PRACTICE_GUIDED_TASK_WORKSPACE.md',
                          './docs/THREE_D_LESSON_BUTTON_ACTUATION.md',
                        ].map(async path=>{
                            const response=await fetch(new URL(path,baseUrl));
                            return {path,ok:response.ok,size:response.ok?
                              (await response.text()).length:0};
                        })),
                    ]);
                    return {
                        model:typeof model.buildPracticeGuidedTaskPlan==='function',
                        ui:typeof ui.renderPracticeGuidedTask==='function',
                        css:css.ok&&(await css.text()).includes('.practice-guided-task'),
                        docs,
                    };
                }""")
                check("post-f714-guided-task-and-3d-button-resources-cached-offline",
                      guided_button_offline["model"] and guided_button_offline["ui"]
                      and guided_button_offline["css"]
                      and len(guided_button_offline["docs"])==2
                      and all(row["ok"] and row["size"]>150
                              for row in guided_button_offline["docs"]),
                      json.dumps(guided_button_offline,ensure_ascii=False))
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
