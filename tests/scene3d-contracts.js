// Chạy trong browser: import("/tests/scene3d-contracts.js").then(m => m.runScene3DContracts())

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

export async function runScene3DContracts() {
  const { mountScene } = await import(`../src/scene3d.js?scene3d-contracts=${Date.now()}`);
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const sceneSource = await fetch(new URL("../src/scene3d.js", import.meta.url)).then(response => response.text());
  const inspectionStart = sceneSource.indexOf("function setInspectedTerminal");
  const inspectionEnd = sceneSource.indexOf("function setLabLayout", inspectionStart);
  const inspectionSource = inspectionStart >= 0 && inspectionEnd > inspectionStart
    ? sceneSource.slice(inspectionStart, inspectionEnd)
    : "";
  check("inspection-source-validates-read-only-layout",
    /setInspectedTerminal\(terminalId,layout=null\)/.test(inspectionSource) &&
    /validateLabLayout\(layout,layout\?\.terminals\)/.test(inspectionSource) &&
    /layout\.terminals\.some/.test(inspectionSource));
  check("inspection-source-does-not-mount-or-position-read-only-layout",
    !/setLabLayout\(/.test(inspectionSource) &&
    !/labTerminalAnchor\(/.test(inspectionSource) &&
    /read-only-label/.test(inspectionSource) &&
    /lab-halo/.test(inspectionSource));

  const pendingStart = sceneSource.indexOf("function setPendingWireTerminal");
  const pendingEnd = sceneSource.indexOf("function setLabLayout", pendingStart);
  const pendingSource = pendingStart >= 0 && pendingEnd > pendingStart
    ? sceneSource.slice(pendingStart, pendingEnd)
    : "";
  check("pending-wire-source-requires-mounted-edit-layout",
    /setPendingWireTerminal\(terminalId\)/.test(pendingSource) &&
    /!labEdit\.enabled\|\|!activeLabLayout/.test(pendingSource) &&
    /labTerminals\.has\(terminalId\)/.test(pendingSource) &&
    /terminalId\.length>80/.test(pendingSource));
  check("pending-wire-source-is-visual-only",
    /first-terminal-preview/.test(pendingSource) &&
    !/onTerminalSelect|onMoveComponent|refreshLabWireLayer|labWireObjects\.push|setWiring\(/.test(pendingSource));
  const ghostStart = sceneSource.indexOf("function ensurePendingWirePreviewLine");
  const ghostEnd = sceneSource.indexOf("function refreshLabInteractionFeedback", ghostStart);
  const ghostSource = ghostStart >= 0 && ghostEnd > ghostStart
    ? sceneSource.slice(ghostStart, ghostEnd)
    : "";
  check("pending-wire-ghost-is-uncommitted-canonical-hover-only",
    /kind:"lab-pending-wire-preview",committed:false/.test(ghostSource) &&
    !/labWireObjects\.push|onTerminalSelect|setWiring\(/.test(ghostSource) &&
    /targetId===pendingWireTerminalId/.test(sceneSource) &&
    /!labTerminals\.has\(targetId\)/.test(sceneSource) &&
    /labPendingWirePreview="ghost"/.test(sceneSource) &&
    /clearPendingWireHover\(true\);finishPointer\(event,false\)/.test(sceneSource));
  const contextLostStart = sceneSource.indexOf("const onContextLost=");
  const contextRestoredStart = sceneSource.indexOf("const onContextRestored=", contextLostStart);
  const contextHandlersEnd = sceneSource.indexOf('canvas.addEventListener("pointerdown"', contextRestoredStart);
  const contextLostSource = sceneSource.slice(contextLostStart, contextRestoredStart);
  const contextRestoredSource = sceneSource.slice(contextRestoredStart, contextHandlersEnd);
  check("pending-wire-context-reset-is-fail-closed",
    /clearPendingWireState\(false\)/.test(contextLostSource) &&
    !/setPendingWireTerminal\(|pendingWireTerminalId\s*=/.test(contextRestoredSource));

  const detached = document.createElement("div");
  let detachedRejected = false;
  try { mountScene(detached); } catch (error) { detachedRejected = /3D/.test(error.message); }
  check("detached-host-rejected", detachedRejected);

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
    while (queuedFrames.size && rounds++ < 10) {
      const batch = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of batch) callback(performance.now());
    }
  };
  const makeHost = () => {
    const host = document.createElement("div");
    host.className = "scene-mount";
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:360px";
    document.body.append(host);
    return host;
  };

  let host;
  let mounted;
  try {
    host = makeHost();
    let selected = 0;
    mounted = mountScene(host, () => { selected += 1; });
    mounted.setLesson({ id: 5, wiring: ["D11 → RGB", "D10 → RGB", "GND → RGB"] });
    await waitTask();
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("mount-one-canvas", canvas instanceof HTMLCanvasElement && host.querySelectorAll("canvas").length === 1);
    check("canvas-focusable", canvas.tabIndex === 0);
    check("canvas-accessible-role", canvas.getAttribute("role") === "application");
    check("canvas-keyboard-help", /mũi tên/i.test(canvas.getAttribute("aria-label") || "") && /Enter/i.test(canvas.getAttribute("aria-label") || ""));
    check("canvas-keyshortcuts", /ArrowLeft/.test(canvas.getAttribute("aria-keyshortcuts") || "") && /Home/.test(canvas.getAttribute("aria-keyshortcuts") || ""));
    check("touch-preserves-page-scroll", getComputedStyle(canvas).touchAction === "pan-y");
    check("context-ready-metadata", canvas.dataset.sceneContext === "ready" && !canvas.hasAttribute("aria-busy"));
    const legacyHeaderSockets = Number(canvas.dataset.sceneUnoHeaderSocketVisualCount);
    const legacyBreadboardHoles = Number(canvas.dataset.sceneBreadboardHoleVisualCount);
    const legacyContactStrips = Number(canvas.dataset.sceneBreadboardContactStripVisualCount);
    check("visual-fidelity-conceptual-profile",
      canvas.dataset.sceneVisualProfile === "conceptual-r3-fidelity-v2" &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      legacyHeaderSockets >= 20 &&
      legacyBreadboardHoles >= 100 &&
      legacyContactStrips >= 10);
    check("visual-fidelity-instanced-detail-budget",
      Number(canvas.dataset.sceneInstancedVisualCount) >= legacyHeaderSockets + legacyBreadboardHoles &&
      Number(canvas.dataset.sceneFineDetailInstanceCount) > Number(canvas.dataset.sceneFineDetailObjectCount) &&
      Number(canvas.dataset.sceneFineDetailCount) === Number(canvas.dataset.sceneFineDetailObjectCount));

    canvas.focus();
    const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    check("keyboard-arrow-handled", !canvas.dispatchEvent(arrow) && arrow.defaultPrevented);
    const zoom = new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true });
    check("keyboard-zoom-handled", !canvas.dispatchEvent(zoom) && zoom.defaultPrevented);
    const reset = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    check("keyboard-reset-handled", !canvas.dispatchEvent(reset) && reset.defaultPrevented);
    const activate = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    canvas.dispatchEvent(activate);
    check("keyboard-select", activate.defaultPrevented && selected === 1);

    flushFrames();
    mounted.control("left");
    mounted.control("right");
    check("render-invalidations-coalesce", queuedFrames.size === 1);
    flushFrames();
    check("render-stays-on-demand", queuedFrames.size === 0);

    const otherFocus = document.createElement("button");
    host.append(otherFocus);
    otherFocus.focus();
    const inactiveKey = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    canvas.dispatchEvent(inactiveKey);
    check("keyboard-requires-canvas-focus", !inactiveKey.defaultPrevented && queuedFrames.size === 0);
    otherFocus.remove();

    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const beforeCancel = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 41, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 41, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    check("pointer-cancel-does-not-select", selected === beforeCancel);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 42, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 42, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    check("touch-tap-selects", selected === beforeCancel + 1);

    const beforeJitter = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 43, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 43, pointerType: "touch", clientX: 21, clientY: 10, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 43, pointerType: "touch", clientX: 21, clientY: 10, bubbles: true }));
    check("touch-11px-jitter-still-selects", selected === beforeJitter + 1);

    const beforeTrueDrag = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 44, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 44, pointerType: "touch", clientX: 24, clientY: 10, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 44, pointerType: "touch", clientX: 24, clientY: 10, bubbles: true }));
    check("touch-14px-drag-does-not-select", selected === beforeTrueDrag);

    const [{ createLabLayout }, { listTerminals }] = await Promise.all([
      import("../src/lab-layout.js"),
      import("../src/circuit-router.js"),
    ]);
    mounted.setLesson({ id: 2 });
    const terminals = listTerminals(2);
    const layout = createLabLayout(2, terminals);
    check("public-inspected-terminal-api", typeof mounted.setInspectedTerminal === "function");

    let noLayoutProofRejected = false;
    try { mounted.setInspectedTerminal("D13"); }
    catch (error) { noLayoutProofRejected = error instanceof RangeError; }
    check("inspection-no-layout-no-proof-rejected",
      noLayoutProofRejected &&
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");

    const beforeReadOnlyInspection = mounted.getLabViewState();
    const readOnlyInspection = mounted.setInspectedTerminal("D13", layout);
    const afterReadOnlyInspection = mounted.getLabViewState();
    const readOnlyBadge = host.querySelector('[data-scene-inspection-badge="read-only"]');
    check("inspection-read-only-label-mode",
      readOnlyInspection.active === true &&
      readOnlyInspection.terminalId === "D13" &&
      readOnlyInspection.mode === "read-only-label" &&
      readOnlyInspection.physicalVerified === false &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge instanceof HTMLElement &&
      readOnlyBadge.hidden === false &&
      /D13/.test(readOnlyBadge.textContent || "") &&
      /D13/.test(canvas.getAttribute("aria-label") || ""));
    check("inspection-read-only-label-does-not-mount-or-move-scene",
      beforeReadOnlyInspection.mode === "legacy" &&
      afterReadOnlyInspection.mode === "legacy" &&
      afterReadOnlyInspection.focusedComponentId === beforeReadOnlyInspection.focusedComponentId &&
      afterReadOnlyInspection.selectedComponentId === beforeReadOnlyInspection.selectedComponentId &&
      JSON.stringify(afterReadOnlyInspection.camera) === JSON.stringify(beforeReadOnlyInspection.camera) &&
      canvas.dataset.labWireCount === "0" &&
      afterReadOnlyInspection.claims.physicalVerified === false &&
      afterReadOnlyInspection.claims.breadboardHoleMapping === false &&
      afterReadOnlyInspection.claims.electricalPower === false);

    let readOnlyUnknownRejected = false;
    try { mounted.setInspectedTerminal("NOT_A_TERMINAL", layout); }
    catch (error) { readOnlyUnknownRejected = error instanceof RangeError; }
    check("inspection-read-only-unknown-id-is-transactional",
      readOnlyUnknownRejected &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label");

    mounted.setLabLayout(layout);
    check("layout-mount-clears-read-only-label",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none" &&
      readOnlyBadge.hidden === true);
    check("lab-layout-adds-conceptual-geometry-without-cad-claim",
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) > legacyHeaderSockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) > legacyBreadboardHoles &&
      Number(canvas.dataset.sceneBreadboardContactStripVisualCount) > legacyContactStrips &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none");

    let pendingOutsideEditRejected = false;
    try { mounted.setPendingWireTerminal("D13"); }
    catch (error) { pendingOutsideEditRejected = error instanceof RangeError; }
    check("pending-wire-requires-edit-mode",
      pendingOutsideEditRejected &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    const clearedOutsideEdit = mounted.setPendingWireTerminal(null);
    check("pending-wire-null-clear-is-idempotent-outside-edit",
      clearedOutsideEdit.active === false &&
      clearedOutsideEdit.mode === "none" &&
      canvas.dataset.labPendingWireTerminal === "");

    const beforeInspectionState = mounted.getLabViewState();
    const wireCountBeforeInspection = canvas.dataset.labWireCount;
    const inspected = mounted.setInspectedTerminal("D13");
    const afterInspectionState = mounted.getLabViewState();
    check("inspection-read-only-dataset",
      inspected.active === true &&
      inspected.terminalId === "D13" &&
      inspected.mode === "lab-halo" &&
      inspected.physicalVerified === false &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "highlight");
    check("inspection-does-not-focus-or-select",
      afterInspectionState.focusedComponentId === beforeInspectionState.focusedComponentId &&
      afterInspectionState.selectedComponentId === beforeInspectionState.selectedComponentId &&
      JSON.stringify(afterInspectionState.camera) === JSON.stringify(beforeInspectionState.camera));
    check("inspection-does-not-create-wire-or-electrical-claim",
      canvas.dataset.labWireCount === wireCountBeforeInspection &&
      afterInspectionState.claims.physicalVerified === false &&
      afterInspectionState.claims.breadboardHoleMapping === false &&
      afterInspectionState.claims.electricalPower === false);

    let unknownInspectionRejected = false;
    try { mounted.setInspectedTerminal("NOT_A_TERMINAL"); }
    catch (error) { unknownInspectionRejected = error instanceof RangeError; }
    check("inspection-unknown-id-is-transactional",
      unknownInspectionRejected &&
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "highlight");

    let oversizedInspectionRejected = false;
    try { mounted.setInspectedTerminal("X".repeat(81)); }
    catch (error) { oversizedInspectionRejected = error instanceof RangeError; }
    check("inspection-id-is-bounded",
      oversizedInspectionRejected && canvas.dataset.labInspectedTerminal === "D13");

    const clearedInspection = mounted.setInspectedTerminal(null);
    check("inspection-null-clears",
      clearedInspection.active === false &&
      clearedInspection.terminalId === null &&
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");

    mounted.setInspectedTerminal("D13");
    mounted.setLabLayout(layout);
    check("layout-refresh-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");

    const editTerminalEvents = [];
    mounted.setInspectedTerminal("D13");
    mounted.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalSelect: id => editTerminalEvents.push(id),
    });
    check("edit-transition-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    check("lab-selection-feedback-metadata",
      canvas.dataset.labSelectionFeedback === "outline" &&
      canvas.dataset.labTerminalFeedback === "selected-component" &&
      Number(canvas.dataset.labTerminalHighlightCount) > 0);
    const beforePendingState = mounted.getLabViewState();
    const wireCountBeforePending = canvas.dataset.labWireCount;
    const pending = mounted.setPendingWireTerminal("D13");
    const afterPendingState = mounted.getLabViewState();
    check("pending-wire-first-terminal-visual-prompt",
      pending.active === true &&
      pending.terminalId === "D13" &&
      pending.mode === "first-terminal-preview" &&
      pending.physicalVerified === false &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      canvas.dataset.labTerminalLabelFeedback === "pending" &&
      /D13/.test(canvas.getAttribute("aria-label") || "") &&
      /chưa tạo dây/i.test(canvas.getAttribute("aria-label") || ""));
    check("pending-wire-prompt-is-visual-only",
      editTerminalEvents.length === 0 &&
      canvas.dataset.labWireCount === wireCountBeforePending &&
      afterPendingState.selectedComponentId === beforePendingState.selectedComponentId &&
      afterPendingState.focusedComponentId === beforePendingState.focusedComponentId &&
      JSON.stringify(afterPendingState.camera) === JSON.stringify(beforePendingState.camera) &&
      afterPendingState.claims.physicalVerified === false &&
      afterPendingState.claims.breadboardHoleMapping === false &&
      afterPendingState.claims.electricalPower === false);

    let invalidPendingRejected = false;
    try { mounted.setPendingWireTerminal("NOT_A_TERMINAL"); }
    catch (error) { invalidPendingRejected = error instanceof RangeError; }
    check("pending-wire-invalid-id-is-transactional",
      invalidPendingRejected &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labPendingWirePreview === "none");

    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    check("pending-wire-survives-same-edit-state-refresh",
      canvas.dataset.labPendingWireTerminal === "D13");
    mounted.setInspectedTerminal("D13");
    check("inspection-feedback-distinct-from-edit-feedback",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "highlight" &&
      canvas.dataset.labTerminalFeedback === "selected-component" &&
      canvas.dataset.labSelectedComponent === "arduino" &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labTerminalLabelFeedback === "pending" &&
      editTerminalEvents.length === 0);
    mounted.setPendingWireTerminal(null);
    check("inspection-terminal-label-feedback-after-pending-clears",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labTerminalLabelFeedback === "inspection");
    mounted.setPendingWireTerminal("D13");
    mounted.focusLabComponent("arduino");
    check("lab-focus-feedback-metadata", canvas.dataset.labFocusFeedback === "outline");

    let invalidSelectionRejected = false;
    try { mounted.setLabEdit({ enabled: false, selectedComponentId: "missing-component" }); }
    catch (error) { invalidSelectionRejected = error instanceof RangeError; }
    check("invalid-selection-is-transactional",
      invalidSelectionRejected &&
      canvas.dataset.labEdit === "on" &&
      canvas.dataset.labSelectedComponent === "arduino");
    mounted.focusLabComponent(null);
    check("lab-focus-feedback-clears", canvas.dataset.labFocusFeedback === "none");
    mounted.setLabEdit({ enabled: false });
    check("edit-exit-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    check("edit-exit-clears-pending-wire-preview",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    mounted.setPendingWireTerminal("D13");
    mounted.setLabLayout(null);
    check("layout-stage-clear-resets-pending-wire-preview",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    mounted.setLabEdit({ enabled: false });
    const readOnlyBeforeContext = mounted.setInspectedTerminal("D13", layout);
    check("read-only-label-before-context-loss",
      readOnlyBeforeContext.mode === "read-only-label" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge.hidden === false);

    flushFrames();
    const gl = canvas.getContext("webgl2");
    const contextExtension = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (contextExtension) contextExtension.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const lost = await lostPromise;
    check("context-loss-cancelled", lost.defaultPrevented);
    check("context-loss-accessibility-state",
      canvas.dataset.sceneContext === "lost" && canvas.getAttribute("aria-busy") === "true");
    check("context-loss-preserves-read-only-inspection",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge.hidden === false);
    mounted.control("left");
    check("context-loss-pauses-render", queuedFrames.size === 0);
    // Restoration is only allowed after the cancelable context-lost event has
    // fully returned to the browser event loop.
    await waitTask();
    const restoredPromise = waitEvent(canvas, "webglcontextrestored");
    if (contextExtension) contextExtension.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restoredPromise;
    check("context-restore-invalidates", queuedFrames.size === 1);
    check("context-restore-accessibility-state",
      canvas.dataset.sceneContext === "ready" && !canvas.hasAttribute("aria-busy"));
    check("context-restore-preserves-read-only-inspection",
      canvas.dataset.labInspectedTerminal === "D13" &&
      canvas.dataset.labInspectionFeedback === "label" &&
      readOnlyBadge.hidden === false);
    flushFrames();

    mounted.setLesson({ id: 3 });
    check("lesson-change-clears-inspection",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    const layout3 = createLabLayout(3, listTerminals(3));
    let staleInspectionRejected = false;
    try { mounted.setInspectedTerminal("D13", layout); }
    catch (error) { staleInspectionRejected = error instanceof RangeError; }
    check("stale-terminal-rejected-after-lesson-layout-change",
      staleInspectionRejected &&
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none");
    const lesson3ReadOnly = mounted.setInspectedTerminal("D2", layout3);
    check("new-lesson-read-only-layout-accepted",
      lesson3ReadOnly.mode === "read-only-label" &&
      canvas.dataset.labInspectedTerminal === "D2" &&
      canvas.dataset.labInspectionFeedback === "label");

    mounted.dispose();
    mounted = null;
    check("dispose-removes-canvas", !canvas.isConnected && !host.querySelector("canvas"));
    check("dispose-cancels-render", queuedFrames.size === 0);
    check("dispose-clears-inspection-metadata",
      canvas.dataset.labInspectedTerminal === "" &&
      canvas.dataset.labInspectionFeedback === "none" &&
      !readOnlyBadge.isConnected);
    check("dispose-clears-pending-wire-metadata",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    check("dispose-detaches-context-listeners", queuedFrames.size === 0);

    host.remove();
    host = makeHost();
    const remount = mountScene(host);
    await waitTask();
    flushFrames();
    check("remount-after-dispose", host.querySelectorAll("canvas").length === 1);
    remount.dispose();

    host.remove();
    host = makeHost();
    const lossDispose = mountScene(host);
    await waitTask();
    flushFrames();
    const lossCanvas = host.querySelector("canvas");
    lossDispose.setLesson({ id: 2 });
    lossDispose.setLabLayout(layout);
    lossDispose.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    lossDispose.setPendingWireTerminal("D13");
    check("pending-wire-armed-before-context-reset",
      lossCanvas.dataset.labPendingWireTerminal === "D13" &&
      lossCanvas.dataset.labPendingWirePreview === "none");
    const lossGl = lossCanvas.getContext("webgl2");
    const lossExtension = lossGl?.getExtension("WEBGL_lose_context");
    const lossPromise = waitEvent(lossCanvas, "webglcontextlost");
    if (lossExtension) lossExtension.loseContext();
    else lossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await lossPromise;
    check("context-reset-clears-pending-wire-preview",
      lossCanvas.dataset.labPendingWireTerminal === "" &&
      lossCanvas.dataset.labPendingWireHoverTerminal === "" &&
      lossCanvas.dataset.labPendingWirePreview === "none" &&
      !/Terminal đầu đang chờ nối/.test(lossCanvas.getAttribute("aria-label") || ""));
    lossDispose.dispose();
    check("dispose-while-context-lost-removes-canvas", !lossCanvas.isConnected && !host.querySelector("canvas"));
    check("dispose-while-context-lost-no-render", queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host?.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
