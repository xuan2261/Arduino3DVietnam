// Browser:
// import("/tests/scene3d-lab-contracts.js").then(m => m.runScene3DLabContracts())
import * as T from "../assets/vendor/three.module.min.js";
import { createLabLayout, labTerminalAnchor } from "../src/lab-layout.js";
import { analyzeCircuit, createSampleCircuit, listTerminals } from "../src/circuit-router.js";

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timeout waiting for " + type)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

function makeHost() {
  const host = document.createElement("div");
  host.className = "scene-mount scene-lab-contract-host";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:760px;height:460px";
  document.body.append(host);
  return host;
}

function cameraForLayout(rect, layout, worldScale) {
  const camera = new T.PerspectiveCamera(38, rect.width / rect.height, .1, 100);
  const theta = .45, phi = .88, zoom = 1;
  const fitted = Math.max(
    16.7,
    18.5 / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.45, camera.aspect)),
  );
  const radius = Math.min(48, Math.max(8, fitted * zoom));
  camera.position.set(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi) + 5,
    radius * Math.sin(phi) * Math.cos(theta),
  );
  const targetX = ((layout.bounds.minX + layout.bounds.maxX) / 2) * worldScale;
  const targetZ = ((layout.bounds.minZ + layout.bounds.maxZ) / 2) * worldScale;
  camera.lookAt(targetX, .35, targetZ);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function projectClient(rect, camera, x, y, z) {
  const point = new T.Vector3(x, y, z).project(camera);
  return {
    x: rect.left + (point.x + 1) * .5 * rect.width,
    y: rect.top + (1 - point.y) * .5 * rect.height,
  };
}

function pointer(canvas, type, point, pointerId, pointerType = "mouse") {
  canvas.dispatchEvent(new PointerEvent(type, {
    button: 0,
    pointerId,
    pointerType,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  }));
}

export async function runScene3DLabContracts() {
  const { mountScene } = await import("../src/scene3d.js?scene3d-lab=" + Date.now());
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const realRaf = window.requestAnimationFrame;
  const realCancelRaf = window.cancelAnimationFrame;
  let nextFrameId = 1;
  const queuedFrames = new Map();
  window.requestAnimationFrame = callback => {
    const id = nextFrameId++;
    queuedFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => queuedFrames.delete(id);
  const flushFrames = () => {
    let rounds = 0;
    while (queuedFrames.size && rounds++ < 12) {
      const batch = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of batch) callback(performance.now());
    }
  };

  let host;
  let mounted;
  try {
    host = makeHost();
    mounted = mountScene(host);
    mounted.setLesson({ id: 2 });
    const terminals = listTerminals(2);
    const layout = createLabLayout(2, terminals);
    const summary = mounted.setLabLayout(layout);
    await waitTask();
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("layout-mode", summary.mode === "conceptual-layout" && summary.lessonId === 2);
    check("layout-schema-counts", summary.componentCount === layout.components.length && summary.terminalCount === terminals.length);
    check("layout-world-bounds", Number.isFinite(summary.worldBounds.minX) && summary.worldBounds.minX < summary.worldBounds.maxX);
    check("layout-claims-fail-closed", summary.physicalVerified === false && summary.breadboardHoleMapping === false && summary.electricalPower === false);
    check("layout-dataset-claims", canvas.dataset.labPhysicalVerified === "false" && canvas.dataset.labBreadboardHoleMapping === "false" && canvas.dataset.labElectricalPower === "false");
    check("layout-accessibility-caveat", /khái niệm/i.test(canvas.getAttribute("aria-label") || "") && /breadboard/i.test(canvas.getAttribute("aria-label") || ""));

    const circuit = createSampleCircuit(2);
    const analysis = analyzeCircuit(2, circuit);
    const wiring = mounted.setWiring(circuit, terminals, analysis);
    flushFrames();
    check("lab-wiring-keeps-conceptual-contract", wiring.physicalMapping === "none" && canvas.dataset.wiringPhysicalMap === "none");
    check("lab-wires-use-layout-anchors", Number(canvas.dataset.labWireCount) === circuit.wires.length && Number(canvas.dataset.labWireCount) > 0);

    const selected = [];
    const moved = [];
    const terminalClicks = [];
    const callbacks = {
      onSelectComponent: (id, meta) => selected.push({ id, meta }),
      onMoveComponent: (id, x, z, meta) => moved.push({ id, x, z, meta }),
      onTerminalSelect: (id, meta) => terminalClicks.push({ id, meta }),
    };
    const disabled = mounted.setLabEdit({ enabled: false, ...callbacks });
    check("edit-disabled-stable", disabled.enabled === false && canvas.dataset.labEdit === "off");
    check("edit-disabled-page-scroll", getComputedStyle(canvas).touchAction === "pan-y");

    canvas.focus();
    const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    canvas.dispatchEvent(arrow);
    check("camera-arrow-preserved-when-edit-disabled", arrow.defaultPrevented && moved.length === 0);
    flushFrames();

    const enabled = mounted.setLabEdit({ enabled: true, ...callbacks, selectedComponentId: "breadboard" });
    check("edit-enabled-selected", enabled.enabled && enabled.selectedComponentId === "breadboard" && canvas.dataset.labSelectedComponent === "breadboard");
    check("edit-touch-drag-enabled", canvas.style.touchAction === "none");
    check("edit-keyboard-help", /W A S D/.test(canvas.getAttribute("aria-keyshortcuts") || "") && /Q E/.test(canvas.getAttribute("aria-keyshortcuts") || ""));

    const rect = canvas.getBoundingClientRect();
    const camera = cameraForLayout(rect, layout, summary.worldScale);

    const d13Anchor = labTerminalAnchor(layout, "D13");
    const terminalPoint = projectClient(
      rect,
      camera,
      d13Anchor.x * summary.worldScale,
      .56,
      d13Anchor.z * summary.worldScale,
    );
    let terminalHit = false;
    let terminalTapPoint = null;
    let terminalPointer = 100;
    for (let dy = -16; dy <= 16 && !terminalHit; dy += 4) {
      for (let dx = -16; dx <= 16 && !terminalHit; dx += 4) {
        const before = terminalClicks.length;
        const point = { x: terminalPoint.x + dx, y: terminalPoint.y + dy };
        pointer(canvas, "pointerdown", point, terminalPointer);
        pointer(canvas, "pointerup", point, terminalPointer++);
        const last = terminalClicks[terminalClicks.length - 1];
        terminalHit = terminalClicks.length > before && last && last.id === "D13";
        if (terminalHit) terminalTapPoint = point;
      }
    }
    const lastTerminal = terminalClicks[terminalClicks.length - 1];
    check("raycaster-terminal-click", terminalHit && lastTerminal.meta?.physicalVerified === false);

    const jitterBefore = terminalClicks.length;
    const jitterMove = { x: terminalTapPoint.x + 4, y: terminalTapPoint.y + 3 };
    pointer(canvas, "pointerdown", terminalTapPoint, 250, "touch");
    pointer(canvas, "pointermove", jitterMove, 250, "touch");
    pointer(canvas, "pointerup", jitterMove, 250, "touch");
    check("touch-terminal-jitter-4px-still-taps",
      terminalClicks.length === jitterBefore + 1 &&
      terminalClicks[terminalClicks.length - 1].id === "D13");

    const terminalDragBefore = terminalClicks.length;
    const terminalDragPoint = { x: terminalTapPoint.x + 18, y: terminalTapPoint.y + 4 };
    pointer(canvas, "pointerdown", terminalTapPoint, 251, "touch");
    pointer(canvas, "pointermove", terminalDragPoint, 251, "touch");
    pointer(canvas, "pointerup", terminalDragPoint, 251, "touch");
    check("touch-terminal-true-drag-does-not-tap",
      terminalClicks.length === terminalDragBefore);

    const terminalCancelBefore = terminalClicks.length;
    pointer(canvas, "pointerdown", terminalTapPoint, 252, "touch");
    pointer(canvas, "pointermove", { x: terminalTapPoint.x + 3, y: terminalTapPoint.y + 2 }, 252, "touch");
    pointer(canvas, "pointercancel", terminalTapPoint, 252, "touch");
    check("touch-terminal-pointercancel-does-not-tap",
      terminalClicks.length === terminalCancelBefore);

    const terminalLostCaptureBefore = terminalClicks.length;
    pointer(canvas, "pointerdown", terminalTapPoint, 253, "touch");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", {
      pointerId: 253,
      pointerType: "touch",
      clientX: terminalTapPoint.x + 2,
      clientY: terminalTapPoint.y + 1,
      bubbles: true,
      cancelable: false,
    }));
    check("touch-terminal-lostcapture-does-not-tap",
      terminalClicks.length === terminalLostCaptureBefore);

    const breadboard = layout.components.find(item => item.id === "breadboard");
    const breadboardPoint = projectClient(
      rect,
      camera,
      breadboard.x * summary.worldScale,
      .22,
      breadboard.z * summary.worldScale,
    );
    const selectedBefore = selected.length;
    pointer(canvas, "pointerdown", breadboardPoint, 300, "touch");
    pointer(canvas, "pointerup", breadboardPoint, 300, "touch");
    const lastSelected = selected[selected.length - 1];
    check("raycaster-component-touch-select", selected.length > selectedBefore && lastSelected.id === "breadboard");

    const backgroundPoint = projectClient(
      rect,
      camera,
      0,
      .12,
      6 * summary.worldScale,
    );
    const selectedBeforeBackground = selected.length;
    pointer(canvas, "pointerdown", backgroundPoint, 302, "touch");
    pointer(canvas, "pointerup", backgroundPoint, 302, "touch");
    const backgroundSelection = selected[selected.length - 1];
    check("background-tap-emits-null-selection",
      selected.length === selectedBeforeBackground + 1 &&
      backgroundSelection.id === null &&
      backgroundSelection.meta?.action === "deselect" &&
      backgroundSelection.meta?.source === "background");

    const arduino = layout.components.find(item => item.id === "arduino");
    const arduinoPoint = projectClient(
      rect,
      camera,
      arduino.x * summary.worldScale,
      .25,
      arduino.z * summary.worldScale,
    );
    const selectedBeforeArduino = selected.length;
    pointer(canvas, "pointerdown", arduinoPoint, 303, "touch");
    pointer(canvas, "pointerup", arduinoPoint, 303, "touch");
    const arduinoSelection = selected[selected.length - 1];
    check("fixed-arduino-tap-emits-selection",
      selected.length === selectedBeforeArduino + 1 &&
      arduinoSelection.id === "arduino" &&
      arduinoSelection.meta?.component?.fixed === true &&
      arduinoSelection.meta?.action === "select");

    const movedBeforeDrag = moved.length;
    pointer(canvas, "pointerdown", breadboardPoint, 301, "touch");
    const dragPoint = { x: breadboardPoint.x + 54, y: breadboardPoint.y + 20 };
    pointer(canvas, "pointermove", dragPoint, 301, "touch");
    pointer(canvas, "pointerup", dragPoint, 301, "touch");
    const dragMove = moved[moved.length - 1];
    check("touch-ground-drag-callback", moved.length > movedBeforeDrag && dragMove.id === "breadboard" && dragMove.meta?.source === "drag" && dragMove.meta?.kind === "move");
    check("touch-ground-drag-bounded", dragMove.x >= layout.bounds.minX && dragMove.x <= layout.bounds.maxX && dragMove.z >= layout.bounds.minZ && dragMove.z <= layout.bounds.maxZ);

    mounted.setLabLayout(layout);
    mounted.setLabEdit({ enabled: true, selectedComponentId: "breadboard" });
    moved.length = 0;
    canvas.focus();
    const moveKey = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
    canvas.dispatchEvent(moveKey);
    check("keyboard-move-callback", moveKey.defaultPrevented && moved.length === 1 && moved[0].id === "breadboard" && moved[0].meta?.kind === "move" && moved[0].meta?.source === "keyboard");

    const rotateKey = new KeyboardEvent("keydown", { key: "e", bubbles: true, cancelable: true });
    canvas.dispatchEvent(rotateKey);
    const rotateMove = moved[moved.length - 1];
    check("keyboard-rotate-callback", rotateKey.defaultPrevented && rotateMove.meta?.kind === "rotate" && rotateMove.meta?.deltaQuarterTurns === 1);

    for (let index = 0; index < 40; index++) {
      canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true }));
    }
    const boundedMove = moved[moved.length - 1];
    const minBreadboardZ = layout.bounds.minZ + breadboard.depth / 2;
    check("keyboard-move-clamped-to-layout-bounds", boundedMove.z >= minBreadboardZ && boundedMove.z <= layout.bounds.maxZ - breadboard.depth / 2);

    const selectionBeforeEnter = selected.length;
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    canvas.dispatchEvent(enter);
    const selectedAfterEnter = selected[selected.length - 1];
    check("keyboard-selected-component-activation", enter.defaultPrevented && selected.length === selectionBeforeEnter + 1 && selectedAfterEnter.id === "breadboard");
    const selectionBeforeEscape = selected.length;
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    canvas.dispatchEvent(escape);
    check("keyboard-escape-clears-selection", escape.defaultPrevented && canvas.dataset.labSelectedComponent === "");
    const selectionAfterEscape = selected[selected.length - 1];
    check("keyboard-escape-emits-null-selection",
      selected.length === selectionBeforeEscape + 1 &&
      selectionAfterEscape.id === null &&
      selectionAfterEscape.meta?.action === "deselect" &&
      selectionAfterEscape.meta?.source === "keyboard");

    const fixedMoveCount = moved.length;
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    const fixedMove = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
    canvas.dispatchEvent(fixedMove);
    check("fixed-arduino-cannot-keyboard-move", !fixedMove.defaultPrevented && moved.length === fixedMoveCount);

    let callbackRejected = false;
    try { mounted.setLabEdit({ enabled: true, onMoveComponent: "bad" }); }
    catch (error) { callbackRejected = error instanceof TypeError; }
    check("edit-callback-validation", callbackRejected);

    const invalidLayout = {
      ...layout,
      claims: { ...layout.claims, physicalVerified: true },
    };
    let invalidRejected = false;
    try { mounted.setLabLayout(invalidLayout); }
    catch (error) { invalidRejected = error instanceof RangeError && /physicalVerified/.test(error.message); }
    check("layout-physical-claim-rejected", invalidRejected);

    const layout3 = createLabLayout(3, listTerminals(3));
    let wrongLessonRejected = false;
    try { mounted.setLabLayout(layout3); }
    catch (error) { wrongLessonRejected = error instanceof RangeError && /bài học/.test(error.message); }
    check("layout-lesson-mismatch-rejected", wrongLessonRejected);

    mounted.setLabLayout(layout);
    mounted.setWiring(circuit, terminals, analysis);
    flushFrames();
    const gl = canvas.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (extension) extension.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const lost = await lostPromise;
    check("lab-context-loss-cancelled", lost.defaultPrevented);
    mounted.control("left");
    check("lab-context-loss-pauses-render", queuedFrames.size === 0);
    await waitTask();
    const restorePromise = waitEvent(canvas, "webglcontextrestored");
    if (extension) extension.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restorePromise;
    check("lab-context-restore-invalidates", queuedFrames.size === 1);
    flushFrames();

    const cleared = mounted.setLabLayout(null);
    mounted.setLabEdit({ enabled: false });
    check("layout-clear-restores-legacy-mode", cleared.mode === "none" && canvas.dataset.labLayoutMode === "none" && canvas.dataset.labWireCount === "0");
    check("edit-disable-restores-page-scroll", getComputedStyle(canvas).touchAction === "pan-y");

    mounted.dispose();
    mounted = null;
    check("lab-dispose-removes-canvas", !canvas.isConnected && !host.querySelector("canvas"));
    check("lab-dispose-cancels-render", queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host?.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
