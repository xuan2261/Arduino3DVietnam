// Browser:
// import("/tests/scene3d-v16-contracts.js").then(m => m.runScene3DV16Contracts())
import { createLabLayout } from "../src/lab-layout.js";
import { listTerminals } from "../src/circuit-router.js";

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timeout waiting for " + type)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

function makeHost(width = 760, height = 460) {
  const host = document.createElement("div");
  host.className = "scene-mount scene-v16-contract-host";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:" + width + "px;height:" + height + "px";
  document.body.append(host);
  return host;
}

function approx(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}

export async function runScene3DV16Contracts() {
  const { mountScene } = await import("../src/scene3d.js?scene3d-v16=" + Date.now());
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
    await waitTask();
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("public-focus-api", typeof mounted.focusLabComponent === "function");
    check("public-view-state-api", typeof mounted.getLabViewState === "function");

    const initial = mounted.getLabViewState();
    check("initial-view-mode-legacy", initial.mode === "legacy" && initial.focusedComponentId === null);
    check("initial-view-quality-profile", initial.qualityProfile === "v16");
    check("initial-view-claims-fail-closed",
      initial.claims.physicalVerified === false &&
      initial.claims.breadboardHoleMapping === false &&
      initial.claims.electricalPower === false);
    check("initial-view-state-frozen",
      Object.isFrozen(initial) &&
      Object.isFrozen(initial.camera) &&
      Object.isFrozen(initial.renderer) &&
      Object.isFrozen(initial.claims));
    check("initial-full-lod",
      initial.lod === "full" &&
      canvas.dataset.sceneLod === "full" &&
      initial.renderer.shadows === true &&
      initial.renderer.pixelRatio <= 1.7);
    check("quality-metadata-nonphysical",
      canvas.dataset.sceneQuality === "v16" &&
      canvas.dataset.scenePhysicalMap === "none");
    check("legacy-fine-detail-present",
      initial.renderer.fineDetailCount > 20 &&
      Number(canvas.dataset.sceneFineDetailCount) === initial.renderer.fineDetailCount);

    let noLayoutFocusRejected = false;
    try { mounted.focusLabComponent("arduino"); }
    catch (error) { noLayoutFocusRejected = error instanceof RangeError; }
    check("focus-requires-layout", noLayoutFocusRejected);

    let invalidFocusRejected = false;
    try { mounted.focusLabComponent(42); }
    catch (error) { invalidFocusRejected = error instanceof TypeError; }
    check("focus-validates-component-id", invalidFocusRejected);

    mounted.setLesson({ id: 2 });
    const terminals = listTerminals(2);
    const layout = createLabLayout(2, terminals);
    const layoutJsonBefore = JSON.stringify(layout);
    mounted.setLabLayout(layout);
    flushFrames();

    const layoutState = mounted.getLabViewState();
    check("layout-view-mode",
      layoutState.mode === "conceptual-layout" &&
      layoutState.lessonId === 2 &&
      layoutState.worldBounds !== null);
    check("layout-world-bounds-frozen", Object.isFrozen(layoutState.worldBounds));
    check("layout-does-not-claim-physical-map",
      layoutState.claims.breadboardHoleMapping === false &&
      canvas.dataset.labBreadboardHoleMapping === "false");

    const movable = layout.components.find(item => !item.fixed && item.id !== "breadboard")
      || layout.components.find(item => !item.fixed);
    const selectionEvents = [];
    mounted.setLabEdit({
      enabled: false,
      onSelectComponent: (id, detail) => selectionEvents.push({ id, detail }),
    });
    const selectedBeforeFocus = mounted.getLabViewState().selectedComponentId;
    const focused = mounted.focusLabComponent(movable.id);
    flushFrames();

    check("focus-component-state",
      focused.focusedComponentId === movable.id &&
      canvas.dataset.labFocusedComponent === movable.id);
    check("focus-target-matches-logical-layout",
      approx(focused.camera.targetX, movable.x * focused.worldScale) &&
      approx(focused.camera.targetZ, movable.z * focused.worldScale));
    check("focus-adjusts-readability-zoom",
      focused.camera.zoom >= .42 && focused.camera.zoom <= .58);
    check("focus-does-not-select",
      focused.selectedComponentId === selectedBeforeFocus &&
      selectionEvents.length === 0);
    check("focus-does-not-mutate-layout", JSON.stringify(layout) === layoutJsonBefore);

    let unknownFocusRejected = false;
    try { mounted.focusLabComponent("NOT_A_COMPONENT"); }
    catch (error) { unknownFocusRejected = error instanceof RangeError; }
    check("focus-rejects-unknown-component", unknownFocusRejected);

    const arduinoFocus = mounted.focusLabComponent("arduino");
    check("focus-allows-fixed-arduino",
      arduinoFocus.focusedComponentId === "arduino" &&
      arduinoFocus.selectedComponentId === selectedBeforeFocus);

    const clearedFocus = mounted.focusLabComponent(null);
    check("focus-null-clears",
      clearedFocus.focusedComponentId === null &&
      clearedFocus.camera.zoom === 1 &&
      canvas.dataset.labFocusedComponent === "");
    check("focus-null-restores-layout-center",
      approx(clearedFocus.camera.targetX,
        ((layout.bounds.minX + layout.bounds.maxX) / 2) * clearedFocus.worldScale) &&
      approx(clearedFocus.camera.targetZ,
        ((layout.bounds.minZ + layout.bounds.maxZ) / 2) * clearedFocus.worldScale));

    mounted.focusLabComponent(movable.id);
    canvas.focus();
    const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    canvas.dispatchEvent(home);
    const homeState = mounted.getLabViewState();
    check("home-clears-focus",
      home.defaultPrevented &&
      homeState.focusedComponentId === null &&
      homeState.camera.zoom === 1);

    mounted.focusLabComponent(movable.id);
    mounted.control("reset");
    const controlResetState = mounted.getLabViewState();
    check("control-reset-clears-focus",
      controlResetState.focusedComponentId === null &&
      controlResetState.camera.zoom === 1);
    flushFrames();

    const detailCountFull = mounted.getLabViewState().renderer.fineDetailCount;
    check("lab-quality-adds-fine-detail", detailCountFull > initial.renderer.fineDetailCount);

    host.style.width = "420px";
    host.style.height = "320px";
    mounted.resize();
    flushFrames();
    const reduced = mounted.getLabViewState();
    check("mobile-reduced-lod",
      reduced.lod === "reduced" &&
      canvas.dataset.sceneLod === "reduced");
    check("mobile-resource-cap",
      reduced.renderer.pixelRatio <= 1.25 &&
      reduced.renderer.shadows === false);
    check("mobile-detail-count-stable",
      reduced.renderer.fineDetailCount === detailCountFull);

    host.style.width = "760px";
    host.style.height = "460px";
    mounted.resize();
    flushFrames();
    const fullAgain = mounted.getLabViewState();
    check("desktop-full-lod-restored",
      fullAgain.lod === "full" &&
      fullAgain.renderer.shadows === true &&
      fullAgain.renderer.pixelRatio <= 1.7);

    mounted.focusLabComponent(movable.id);
    flushFrames();
    const beforeLoss = mounted.getLabViewState();
    const gl = canvas.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (extension) extension.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const lost = await lostPromise;
    check("v16-context-loss-cancelled", lost.defaultPrevented);
    mounted.control("left");
    check("v16-context-loss-pauses-render", queuedFrames.size === 0);

    await waitTask();
    const restoredPromise = waitEvent(canvas, "webglcontextrestored");
    if (extension) extension.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restoredPromise;
    check("v16-context-restore-invalidates", queuedFrames.size === 1);
    flushFrames();
    const afterRestore = mounted.getLabViewState();
    check("v16-context-restore-preserves-focus",
      afterRestore.focusedComponentId === beforeLoss.focusedComponentId &&
      afterRestore.lod === beforeLoss.lod &&
      afterRestore.qualityProfile === "v16");

    mounted.setLabLayout(layout);
    const preservedFocus = mounted.getLabViewState();
    check("layout-refresh-preserves-valid-focus",
      preservedFocus.focusedComponentId === movable.id);

    const clearedLayout = mounted.setLabLayout(null);
    const legacyAgain = mounted.getLabViewState();
    check("layout-clear-clears-focus",
      clearedLayout.mode === "none" &&
      legacyAgain.mode === "legacy" &&
      legacyAgain.focusedComponentId === null &&
      legacyAgain.camera.zoom === 1);

    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    mounted.focusLabComponent(movable.id);
    mounted.setLesson({ id: 3 });
    const nextLessonState = mounted.getLabViewState();
    check("lesson-change-clears-focus",
      nextLessonState.lessonId === 3 &&
      nextLessonState.mode === "legacy" &&
      nextLessonState.focusedComponentId === null);

    mounted.dispose();
    mounted = null;
    check("v16-dispose-removes-canvas", !canvas.isConnected && !host.querySelector("canvas"));
    check("v16-dispose-cancels-render", queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host?.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
