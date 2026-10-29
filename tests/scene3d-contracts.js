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
  const pendingEnd = sceneSource.indexOf("function setHighlightedLabWire", pendingStart);
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
  const highlightedWireStart = sceneSource.indexOf("function setHighlightedLabWire");
  const highlightedWireEnd = sceneSource.indexOf("function setLabLayout", highlightedWireStart);
  const highlightedWireSource = highlightedWireStart >= 0 && highlightedWireEnd > highlightedWireStart
    ? sceneSource.slice(highlightedWireStart, highlightedWireEnd)
    : "";
  check("highlighted-wire-source-is-strict-canonical-membership",
    /setHighlightedLabWire\(wireId\)/.test(highlightedWireSource) &&
    /wireId\.trim\(\)!==wireId/.test(highlightedWireSource) &&
    /wireId\.length>LAB_WIRE_ID_MAX/.test(highlightedWireSource) &&
    /lastWiringModel\.wires\.some/.test(highlightedWireSource) &&
    /labWireObjects\.some/.test(highlightedWireSource));
  check("highlighted-wire-source-is-visual-only",
    /committed-wire-highlight/.test(highlightedWireSource) &&
    /refreshLabWireHighlight\(\)/.test(highlightedWireSource) &&
    !/setWiring\(|onTerminalSelect|onMoveComponent|selectLabComponent|focusLabComponent|theta=|phi=|zoom=/.test(highlightedWireSource));
  check("highlighted-wire-identity-includes-unordered-endpoints",
    /function sameCommittedWireIdentity\(left,right\)/.test(sceneSource) &&
    /left\.id!==right\.id/.test(sceneSource) &&
    /left\.from===right\.from&&left\.to===right\.to/.test(sceneSource) &&
    /left\.from===right\.to&&left\.to===right\.from/.test(sceneSource));
  const setWiringStart = sceneSource.indexOf("function setWiring");
  const updateStart = sceneSource.indexOf("function update(snapshot)", setWiringStart);
  const setWiringSource = sceneSource.slice(setWiringStart, updateStart);
  check("set-wiring-clears-highlight-on-same-id-different-endpoints",
    /previousHighlightedWire/.test(setWiringSource) &&
    /replacement=model\.wires\.find/.test(setWiringSource) &&
    /!sameCommittedWireIdentity\(previousHighlightedWire,replacement\)/.test(setWiringSource));
  const setLabLayoutStart = sceneSource.indexOf("function setLabLayout");
  const setLabEditStart = sceneSource.indexOf("function validateLabEditCallback", setLabLayoutStart);
  const setLabLayoutSource = sceneSource.slice(setLabLayoutStart, setLabEditStart);
  check("same-lesson-layout-rebuild-preserves-wire-highlight-state",
    /clearLabLayout\(false,true,true\)/.test(setLabLayoutSource) &&
    /refreshLabWireLayer\(true\)/.test(setLabLayoutSource));
  check("same-lesson-layout-rebuild-preserves-wire-geometry-revision",
    /function clearLabWireLayer\(clearHighlight=true,preserveRevision=false\)/.test(sceneSource) &&
    /if\(!preserveRevision\)labWireGeometryRevision=0/.test(sceneSource) &&
    /function clearLabLayout\(redraw=true,preserveWireHighlight=false,preserveWireRevision=false\)/.test(sceneSource) &&
    /canvas\.dataset\.labWireGeometryRevision=String\(labWireGeometryRevision\)/.test(sceneSource));
  const committedRouteStart = sceneSource.indexOf("function updateLabWireGeometry");
  const committedRouteEnd = sceneSource.indexOf("function refreshLabWireLayer", committedRouteStart);
  const committedRouteSource = sceneSource.slice(committedRouteStart, committedRouteEnd);
  check("committed-wire-route-is-elevated-multisegment",
    /LAB_COMMITTED_WIRE_ROUTE_POINTS/.test(committedRouteSource) &&
    /from\.getWorldPosition\(start\);to\.getWorldPosition\(end\)/.test(committedRouteSource) &&
    /const points=\[\s*start,[\s\S]*end,\s*\]/.test(committedRouteSource) &&
    /laneY/.test(committedRouteSource) &&
    /midX/.test(committedRouteSource) &&
    /position\.setXYZ\(pointIndex/.test(committedRouteSource));
  const transformStart = sceneSource.indexOf("function setLabVisualTransform");
  const transformEnd = sceneSource.indexOf("function restoreLabComponent", transformStart);
  const transformSource = sceneSource.slice(transformStart, transformEnd);
  const lodStart = sceneSource.indexOf("function applySceneLod");
  const lodEnd = sceneSource.indexOf("function resize", lodStart);
  const lodSource = sceneSource.slice(lodStart, lodEnd);
  check("committed-wire-route-recomputes-on-transform-and-lod",
    /updateLabWireGeometry\(\)/.test(transformSource) &&
    /updateLabWireGeometry\(\)/.test(lodSource));
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
  const editOptionStart = sceneSource.indexOf("function validateLabEditCallback");
  const editOptionEnd = sceneSource.indexOf("function clampLabTarget", editOptionStart);
  const editOptionSource = sceneSource.slice(editOptionStart, editOptionEnd);
  check("terminal-drag-callback-options-are-validated-and-preserved",
    /validateLabEditCallback\(options\.onTerminalDragStart,"onTerminalDragStart"\)/.test(editOptionSource) &&
    /onTerminalDragStart:options\.onTerminalDragStart===undefined/.test(editOptionSource) &&
    /\? labEdit\.onTerminalDragStart : options\.onTerminalDragStart/.test(editOptionSource) &&
    /validateLabEditCallback\(options\.onTerminalLink,"onTerminalLink"\)/.test(editOptionSource) &&
    /onTerminalLink:options\.onTerminalLink===undefined/.test(editOptionSource) &&
    /\? labEdit\.onTerminalLink : options\.onTerminalLink/.test(editOptionSource));
  const directDragStart = sceneSource.indexOf("function isActiveTerminalDragId");
  const directDragEnd = sceneSource.indexOf("function restorePointerSelection", directDragStart);
  const directDragSource = sceneSource.slice(directDragStart, directDragEnd);
  check("terminal-link-drag-validates-current-layout-canonical-distinct-endpoints",
    /typeof labEdit\.onTerminalLink==="function"&&isActiveTerminalDragId/.test(directDragSource) &&
    /layoutRef!==activeLabLayout/.test(directDragSource) &&
    /Object\.prototype\.hasOwnProperty\.call\(terminalMap,terminalId\)/.test(directDragSource) &&
    /canonical\?\.terminalId===terminalId&&labTerminals\.has\(terminalId\)/.test(directDragSource) &&
    /targetId===sourceId/.test(directDragSource) &&
    /isActiveTerminalLinkId\(targetId,layoutRef\)/.test(directDragSource));
  const pointerMoveStart = sceneSource.indexOf("function move(event)");
  const pointerMoveEnd = sceneSource.indexOf("function finishPointer", pointerMoveStart);
  const pointerMoveSource = sceneSource.slice(pointerMoveStart, pointerMoveEnd);
  check("terminal-drag-start-callback-fires-on-threshold-once-with-canonical-frozen-meta",
    /pointerState\.dragStartEmitted/.test(directDragSource) &&
    /pointerState\.dragStartEmitted=true/.test(directDragSource) &&
    /typeof labEdit\.onTerminalDragStart!=="function"/.test(directDragSource) &&
    /isActiveTerminalDragId\(pointerState\.terminalId,pointerState\.layoutRef\)/.test(directDragSource) &&
    /labEdit\.onTerminalDragStart\(/.test(directDragSource) &&
    /Object\.freeze\(\{source:"pointer-drag",physicalVerified:false\}\)/.test(directDragSource) &&
    /const crossedTapThreshold=!moved&&Math\.hypot\(totalDx,totalDy\)>drag\.tapThreshold/.test(pointerMoveSource) &&
    /if\(crossedTapThreshold\)emitTerminalDragStart\(drag\)/.test(pointerMoveSource) &&
    !/setWiring\(|connectCircuit\(|disconnectCircuit\(|labWireObjects\.push/.test(directDragSource));
  check("terminal-link-drag-preview-is-transient-rendering-only",
    /labTerminalDragPreview="ghost"/.test(directDragSource) &&
    /updateWirePreviewGeometry\(sourceId,targetId\)/.test(directDragSource) &&
    !/setWiring\(|connectCircuit\(|labWireObjects\.push|lastWiringModel\s*=/.test(directDragSource));
  const finishPointerStart = sceneSource.indexOf("function finishPointer");
  const finishPointerEnd = sceneSource.indexOf("const up=", finishPointerStart);
  const finishPointerSource = sceneSource.slice(finishPointerStart, finishPointerEnd);
  check("terminal-link-drop-delegates-exact-callback-on-drag-only",
    /drag\.kind==="terminal"&&select&&moved/.test(finishPointerSource) &&
    /labEdit\.onTerminalLink\?\.\(/.test(finishPointerSource) &&
    /Object\.freeze\(\{source:"pointer-drag",physicalVerified:false\}\)/.test(finishPointerSource) &&
    /if\(select&&!moved\)/.test(finishPointerSource) &&
    /labEdit\.onTerminalSelect/.test(finishPointerSource) &&
    !/setWiring\(|connectCircuit\(|disconnectCircuit\(/.test(finishPointerSource));
  const authoredGuideStart = sceneSource.indexOf("function authoredGuideResult");
  const authoredGuideEnd = sceneSource.indexOf("function refreshLabInteractionFeedback", authoredGuideStart);
  const authoredGuideSource = sceneSource.slice(authoredGuideStart, authoredGuideEnd);
  check("authored-pair-guide-source-validates-exact-own-canonical-pair",
    /function setAuthoredPairGuide\(pair\)/.test(authoredGuideSource) &&
    /Reflect\.ownKeys\(pair\)/.test(authoredGuideSource) &&
    /ownKeys\.length!==2/.test(authoredGuideSource) &&
    /hasOwnProperty\.call\(pair,"from"\)/.test(authoredGuideSource) &&
    /hasOwnProperty\.call\(pair,"to"\)/.test(authoredGuideSource) &&
    /hasOwnProperty\.call\(terminalMap,terminalId\)/.test(authoredGuideSource) &&
    /terminalId\.trim\(\)!==terminalId/.test(authoredGuideSource) &&
    /from===to/.test(authoredGuideSource) &&
    /"__proto__","prototype","constructor"/.test(authoredGuideSource) &&
    /if\(contextLost\)/.test(authoredGuideSource) &&
    /if\(!activeLabLayout\)/.test(authoredGuideSource) &&
    /if\(labEdit\.enabled\)/.test(authoredGuideSource) &&
    /drag\?\.kind==="terminal"/.test(authoredGuideSource));
  check("authored-pair-guide-source-is-distinct-dashed-visual-only-route",
    /LAB_AUTHORED_GUIDE_ROUTE_POINTS = 6/.test(sceneSource) &&
    /new T\.LineDashedMaterial\(/.test(sceneSource) &&
    /kind:"lab-authored-pair-guide-contrast"/.test(authoredGuideSource) &&
    /kind:"lab-authored-pair-guide-dash"/.test(authoredGuideSource) &&
    /computeLineDistances\(\)/.test(authoredGuideSource) &&
    /viewOnly:true,committed:false,visualOnly:true/.test(authoredGuideSource) &&
    /electricalAuthority:false/.test(authoredGuideSource) &&
    !/pendingWirePreviewLine|ensurePendingWirePreviewLine|labWireObjects\.push|setWiring\(|lastWiringModel\s*=/.test(authoredGuideSource));
  check("authored-pair-guide-source-clears-and-revalidates-lifecycle",
    /function clearLabLayout[\s\S]*clearAuthoredPairGuide\(false\)/.test(sceneSource) &&
    /previousAuthoredGuideLesson===layout\.lessonId/.test(setLabLayoutSource) &&
    /mountAuthoredPairGuide\(previousAuthoredGuide\)/.test(setLabLayoutSource) &&
    /guideBeforeContextLoss/.test(sceneSource) &&
    /guideBeforeContextLoss[\s\S]*clearAuthoredPairGuide\(false\)/.test(sceneSource) &&
    /guideToRestore/.test(sceneSource) &&
    /mountAuthoredPairGuide\(guideToRestore\)/.test(sceneSource) &&
    /setAuthoredPairGuide/.test(sceneSource.slice(sceneSource.indexOf("return {setLesson"))));
  const contextLostStart = sceneSource.indexOf("const onContextLost=");
  const contextRestoredStart = sceneSource.indexOf("const onContextRestored=", contextLostStart);
  const contextHandlersEnd = sceneSource.indexOf('canvas.addEventListener("pointerdown"', contextRestoredStart);
  const contextLostSource = sceneSource.slice(contextLostStart, contextRestoredStart);
  const contextRestoredSource = sceneSource.slice(contextRestoredStart, contextHandlersEnd);
  check("pending-wire-context-reset-is-fail-closed",
    /clearPendingWireState\(false\)/.test(contextLostSource) &&
    !/setPendingWireTerminal\(|pendingWireTerminalId\s*=/.test(contextRestoredSource));
  check("terminal-link-drag-context-reset-is-fail-closed",
    /drag=null;[\s\S]*clearTerminalLinkDragState\(false\)/.test(contextLostSource) &&
    !/onTerminalLink|terminalLinkDragSourceId\s*=|terminalLinkDragTargetId\s*=/.test(contextRestoredSource));
  check("wire-geometry-revision-resets-on-context-loss",
    /labWireGeometryRevision=0/.test(contextLostSource) &&
    /labWireGeometryRevision="0"/.test(contextLostSource));
  check("component-fidelity-source-remains-conceptual-and-visual-only",
    /function conceptualVisualFeature/.test(sceneSource) &&
    /conceptualFeature: true/.test(sceneSource) &&
    /physicalVerified: false/.test(sceneSource) &&
    /electricalAuthority: false/.test(sceneSource) &&
    /COMPONENT_VISUAL_PROFILE = "conceptual-components-v1"/.test(sceneSource));
  check("terminal-contrast-source-is-separate-from-electrical-authority",
    /TERMINAL_FEEDBACK_PROFILE = "contrast-rings-v1"/.test(sceneSource) &&
    /kind:"lab-terminal-contrast-backdrop"/.test(sceneSource) &&
    /kind:"lab-terminal-committed-wire-affordance"/.test(sceneSource) &&
    /kind:"lab-conceptual-wire-highlight-backdrop"/.test(sceneSource) &&
    /labWireHighlightFeedback/.test(sceneSource));

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
    const legacyComponentFeatures = Number(canvas.dataset.sceneComponentVisualFeatureCount);
    const legacyComponentKinds = Number(canvas.dataset.sceneComponentVisualKindCount);
    const legacyComponentMarkings = Number(canvas.dataset.sceneComponentMarkingCount);
    const legacyTerminalContrast = Number(canvas.dataset.sceneTerminalContrastAffordanceCount);
    check("visual-fidelity-conceptual-profile",
      canvas.dataset.sceneVisualProfile === "conceptual-r3-fidelity-v2" &&
      canvas.dataset.sceneComponentVisualProfile === "conceptual-components-v1" &&
      canvas.dataset.sceneTerminalFeedbackProfile === "contrast-rings-v1" &&
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

    const [{ createLabLayout, moveLabComponent, rotateLabComponent, labTerminalAnchor }, {
      listTerminals, createCircuit, connectCircuit, createSampleCircuit, disconnectCircuit,
    }, T] = await Promise.all([
      import("../src/lab-layout.js"),
      import("../src/circuit-router.js"),
      import("../assets/vendor/three.module.min.js"),
    ]);
    const labVisualHeight = visualKind => {
      if (visualKind === "arduino-uno") return .46;
      if (visualKind === "breadboard") return .34;
      if (visualKind === "ultrasonic-sensor") return .68;
      if (visualKind === "servo" || visualKind === "driver") return .62;
      if (visualKind === "power-source") return .55;
      return .48;
    };
    const resetCameraForTerminalProjection = sceneCanvas => {
      sceneCanvas.focus();
      sceneCanvas.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Home", bubbles: true, cancelable: true,
      }));
    };
    const projectedTerminalPoint = (sceneCanvas, labLayout, terminalId) => {
      const rect = sceneCanvas.getBoundingClientRect();
      const anchor = labTerminalAnchor(labLayout, terminalId);
      const terminal = labLayout.terminalMap[terminalId];
      const component = labLayout.components.find(item => item.id === terminal.componentId);
      if (!component) throw new Error("Missing terminal component: " + terminalId);
      const aspect = rect.width / rect.height;
      const camera = new T.PerspectiveCamera(38, aspect, .1, 100);
      const theta = .48, phi = .94;
      const fitted = Math.max(16.7, 18.5 /
        (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.45, aspect)));
      const radius = Math.min(48, Math.max(8, fitted));
      camera.position.set(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi) + 5,
        radius * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(new T.Vector3(
        ((labLayout.bounds.minX + labLayout.bounds.maxX) / 2) * .72,
        .35,
        ((labLayout.bounds.minZ + labLayout.bounds.maxZ) / 2) * .72,
      ));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const point = new T.Vector3(
        anchor.x * .72,
        labVisualHeight(component.visualKind) + .10,
        anchor.z * .72,
      ).project(camera);
      return {
        clientX: rect.left + (point.x + 1) * rect.width / 2,
        clientY: rect.top + (1 - point.y) * rect.height / 2,
      };
    };
    const dispatchScenePointer = (sceneCanvas, type, point, pointerId, pointerType = "mouse") => {
      const event = new PointerEvent(type, {
        button: 0, pointerId, pointerType,
        clientX: point.clientX, clientY: point.clientY,
        bubbles: true, cancelable: true,
      });
      sceneCanvas.dispatchEvent(event);
      return event;
    };
    const findTerminalPoint = (sceneCanvas, labLayout, terminalId, pointerId = 800) => {
      const projected = projectedTerminalPoint(sceneCanvas, labLayout, terminalId);
      const offsets = [0, -3, 3, -6, 6, -10, 10];
      for (const dx of offsets) {
        for (const dy of offsets) {
          const point = { clientX: projected.clientX + dx, clientY: projected.clientY + dy };
          dispatchScenePointer(sceneCanvas, "pointermove", point, pointerId, "mouse");
          if (sceneCanvas.dataset.labHoveredTerminal === terminalId) return point;
        }
      }
      throw new Error("Could not hit projected terminal " + terminalId);
    };
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
      Number(canvas.dataset.sceneComponentVisualFeatureCount) > legacyComponentFeatures &&
      Number(canvas.dataset.sceneComponentVisualKindCount) > legacyComponentKinds &&
      Number(canvas.dataset.sceneComponentMarkingCount) > legacyComponentMarkings &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) === layout.terminals.length &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) > legacyTerminalContrast &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none" &&
      canvas.dataset.labTerminalContrastFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none");

    check("public-authored-pair-guide-api-starts-clear",
      typeof mounted.setAuthoredPairGuide === "function" &&
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    const guidePair = { from: "D13", to: "R1:A" };
    const guideWireCountBefore = canvas.dataset.labWireCount;
    const guideRevisionBefore = canvas.dataset.labWireGeometryRevision;
    const guideStateBefore = mounted.getLabViewState();
    const guideResult = mounted.setAuthoredPairGuide(guidePair);
    const guideStateAfter = mounted.getLabViewState();
    check("authored-pair-guide-valid-result-is-frozen-view-only",
      Object.isFrozen(guideResult) &&
      guideResult.active === true &&
      guideResult.mode === "view-only" &&
      guideResult.from === "D13" &&
      guideResult.to === "R1:A" &&
      guideResult.physicalVerified === false &&
      guideResult.electricalAuthority === false &&
      Object.keys(guideResult).sort().join(",") ===
        "active,electricalAuthority,from,mode,physicalVerified,to" &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === "D13" &&
      canvas.dataset.labAuthoredGuideTo === "R1:A");
    check("authored-pair-guide-does-not-create-wire-or-scene-state-authority",
      canvas.dataset.labWireCount === guideWireCountBefore &&
      canvas.dataset.labWireGeometryRevision === guideRevisionBefore &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      canvas.dataset.labHighlightedWire === "" &&
      guideStateAfter.selectedComponentId === guideStateBefore.selectedComponentId &&
      guideStateAfter.focusedComponentId === guideStateBefore.focusedComponentId &&
      JSON.stringify(guideStateAfter.camera) === JSON.stringify(guideStateBefore.camera) &&
      guideStateAfter.claims.physicalVerified === false &&
      guideStateAfter.claims.breadboardHoleMapping === false &&
      guideStateAfter.claims.electricalPower === false);

    const lesson3ForeignTerminal = listTerminals(3).find(item =>
      !Object.prototype.hasOwnProperty.call(layout.terminalMap, item.id)
    )?.id || "NOT_A_TERMINAL";
    const inheritedGuidePair = Object.create({ from: "D13", to: "R1:A" });
    const invalidGuidePairs = [
      {},
      { from: "D13" },
      { from: "D13", to: "D13" },
      { from: "D13 ", to: "R1:A" },
      { from: "D13", to: lesson3ForeignTerminal },
      { from: "__proto__", to: "R1:A" },
      { from: "constructor", to: "R1:A" },
      { from: "D13", to: "R1:A", extra: true },
      inheritedGuidePair,
      ["D13", "R1:A"],
      "D13:R1:A",
    ];
    const invalidGuideOutcomes = invalidGuidePairs.map(candidate => {
      try {
        mounted.setAuthoredPairGuide(candidate);
        return false;
      } catch (error) {
        return error instanceof TypeError || error instanceof RangeError;
      }
    });
    check("authored-pair-guide-invalid-foreign-prototype-inputs-are-transactional",
      invalidGuideOutcomes.every(Boolean) &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === "D13" &&
      canvas.dataset.labAuthoredGuideTo === "R1:A" &&
      canvas.dataset.labWireCount === guideWireCountBefore &&
      canvas.dataset.labWireGeometryRevision === guideRevisionBefore);

    const movedGuideLayout = moveLabComponent(layout, "R1", layout.bounds.maxX, layout.bounds.maxZ);
    mounted.setLabLayout(movedGuideLayout);
    check("authored-pair-guide-rebuilds-on-same-lesson-layout-with-canonical-endpoints",
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === "D13" &&
      canvas.dataset.labAuthoredGuideTo === "R1:A" &&
      canvas.dataset.labWireCount === guideWireCountBefore);
    mounted.setLabLayout(layout);
    check("authored-pair-guide-remains-view-only-after-layout-restore",
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labWireCount === guideWireCountBefore &&
      canvas.dataset.labPendingWirePreview === "none");

    const clearedGuide = mounted.setAuthoredPairGuide(null);
    const clearedGuideAgain = mounted.setAuthoredPairGuide(null);
    check("authored-pair-guide-null-clear-is-frozen-idempotent",
      Object.isFrozen(clearedGuide) &&
      Object.isFrozen(clearedGuideAgain) &&
      clearedGuide.active === false &&
      clearedGuide.mode === "none" &&
      clearedGuide.from === null &&
      clearedGuide.to === null &&
      clearedGuide.physicalVerified === false &&
      clearedGuide.electricalAuthority === false &&
      clearedGuideAgain.active === false &&
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");

    mounted.setAuthoredPairGuide(guidePair);
    mounted.setLabLayout(null);
    check("authored-pair-guide-clears-on-layout-null",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    let inactiveGuideRejected = false;
    try { mounted.setAuthoredPairGuide(guidePair); }
    catch (error) { inactiveGuideRejected = error instanceof RangeError; }
    check("authored-pair-guide-rejects-inactive-layout",
      inactiveGuideRejected &&
      canvas.dataset.labAuthoredGuideMode === "none");
    mounted.setLabLayout(layout);
    mounted.setAuthoredPairGuide(guidePair);
    mounted.setLesson({ id: 3 });
    check("authored-pair-guide-clears-on-lesson-change",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    const layout3ForGuide = createLabLayout(3, listTerminals(3));
    mounted.setLabLayout(layout3ForGuide);
    const staleLesson2Terminal = terminals.find(item =>
      !Object.prototype.hasOwnProperty.call(layout3ForGuide.terminalMap, item.id)
    )?.id || "NOT_A_TERMINAL";
    const lesson3CanonicalTerminal = layout3ForGuide.terminals.find(item =>
      item.id !== staleLesson2Terminal
    )?.id;
    let staleGuideRejected = false;
    try {
      mounted.setAuthoredPairGuide({
        from: staleLesson2Terminal,
        to: lesson3CanonicalTerminal || "D2",
      });
    } catch (error) {
      staleGuideRejected = error instanceof RangeError;
    }
    check("authored-pair-guide-rejects-stale-terminal-after-lesson-layout-change",
      staleGuideRejected &&
      canvas.dataset.labAuthoredGuideMode === "none");
    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    mounted.setAuthoredPairGuide(guidePair);
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino", onTerminalLink: null });
    check("authored-pair-guide-edit-entry-clears-view-only-guide",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    let editModeGuideRejected = false;
    try { mounted.setAuthoredPairGuide(guidePair); }
    catch (error) { editModeGuideRejected = error instanceof RangeError; }
    check("authored-pair-guide-rejects-while-edit-mode-active",
      editModeGuideRejected &&
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labPendingWirePreview === "none");

    resetCameraForTerminalProjection(canvas);
    const noHandlerSourcePoint = findTerminalPoint(canvas, layout, "D13", 799);
    const noHandlerTargetPoint = findTerminalPoint(canvas, layout, "R1:A", 800);
    dispatchScenePointer(canvas, "pointerdown", noHandlerSourcePoint, 809, "mouse");
    dispatchScenePointer(canvas, "pointermove", noHandlerTargetPoint, 809, "mouse");
    check("terminal-drag-without-controller-handler-does-not-arm-ghost",
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    dispatchScenePointer(canvas, "pointercancel", noHandlerSourcePoint, 809, "mouse");

    const terminalLinkEvents = [];
    const terminalSelectEvents = [];
    const terminalDragStartEvents = [];
    let clearPendingOnDragStart = false;
    mounted.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalSelect: (terminalId, meta) => terminalSelectEvents.push({ terminalId, meta }),
      onTerminalDragStart: (sourceId, meta) => {
        terminalDragStartEvents.push({ sourceId, meta });
        if (clearPendingOnDragStart) mounted.setPendingWireTerminal(null);
      },
      onTerminalLink: (fromId, toId, meta) => terminalLinkEvents.push({ fromId, toId, meta }),
    });
    mounted.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    resetCameraForTerminalProjection(canvas);
    const dragSourcePoint = findTerminalPoint(canvas, layout, "D13", 801);
    const dragTargetPoint = findTerminalPoint(canvas, layout, "R1:A", 802);
    const selectedBeforeTerminalDrag = canvas.dataset.labSelectedComponent;
    const wireCountBeforeTerminalDrag = canvas.dataset.labWireCount;
    const geometryRevisionBeforeTerminalDrag = canvas.dataset.labWireGeometryRevision;
    for (const [index, pointerType] of ["mouse", "touch", "pen"].entries()) {
      const pointerId = 810 + index;
      const linkCountBefore = terminalLinkEvents.length;
      const selectCountBefore = terminalSelectEvents.length;
      const dragStartCountBefore = terminalDragStartEvents.length;
      dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, pointerId, pointerType);
      const dragMove = dispatchScenePointer(canvas, "pointermove", dragTargetPoint, pointerId, pointerType);
      dispatchScenePointer(canvas, "pointermove", dragTargetPoint, pointerId, pointerType);
      const dragStart = terminalDragStartEvents.at(-1);
      check("terminal-drag-" + pointerType + "-shows-valid-ghost",
        dragMove.defaultPrevented &&
        terminalDragStartEvents.length === dragStartCountBefore + 1 &&
        dragStart?.sourceId === "D13" &&
        dragStart?.meta?.source === "pointer-drag" &&
        dragStart?.meta?.physicalVerified === false &&
        Object.isFrozen(dragStart.meta) &&
        Object.keys(dragStart.meta).sort().join(",") === "physicalVerified,source" &&
        canvas.dataset.labTerminalDragSource === "D13" &&
        canvas.dataset.labTerminalDragTarget === "R1:A" &&
        canvas.dataset.labTerminalDragPreview === "ghost" &&
        canvas.dataset.labPendingWirePreview === "none");
      dispatchScenePointer(canvas, "pointerup", dragTargetPoint, pointerId, pointerType);
      const link = terminalLinkEvents.at(-1);
      check("terminal-drag-" + pointerType + "-emits-once-through-controller-callback",
        terminalLinkEvents.length === linkCountBefore + 1 &&
        terminalDragStartEvents.length === dragStartCountBefore + 1 &&
        terminalSelectEvents.length === selectCountBefore &&
        link?.fromId === "D13" &&
        link?.toId === "R1:A" &&
        link?.meta?.source === "pointer-drag" &&
        link?.meta?.physicalVerified === false &&
        Object.isFrozen(link.meta) &&
        Object.keys(link.meta).sort().join(",") === "physicalVerified,source");
      check("terminal-drag-" + pointerType + "-cleans-transient-state-without-graph-mutation",
        canvas.dataset.labTerminalDragSource === "" &&
        canvas.dataset.labTerminalDragTarget === "" &&
        canvas.dataset.labTerminalDragPreview === "none" &&
        canvas.dataset.labSelectedComponent === selectedBeforeTerminalDrag &&
        canvas.dataset.labWireCount === wireCountBeforeTerminalDrag &&
        canvas.dataset.labWireGeometryRevision === geometryRevisionBeforeTerminalDrag);
    }

    const linkCountBeforeTap = terminalLinkEvents.length;
    const selectCountBeforeTap = terminalSelectEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 820, "mouse");
    dispatchScenePointer(canvas, "pointerup", dragSourcePoint, 820, "mouse");
    check("terminal-tap-keeps-onTerminalSelect-without-link-fallback",
      terminalLinkEvents.length === linkCountBeforeTap &&
      terminalSelectEvents.length === selectCountBeforeTap + 1 &&
      terminalSelectEvents.at(-1)?.terminalId === "D13" &&
      terminalSelectEvents.at(-1)?.meta?.source === "pointer");

    const linkCountBeforeJitter = terminalLinkEvents.length;
    const selectCountBeforeJitter = terminalSelectEvents.length;
    const dragStartCountBeforeJitter = terminalDragStartEvents.length;
    const touchJitterPoint = { clientX: dragSourcePoint.clientX + 11, clientY: dragSourcePoint.clientY };
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 821, "touch");
    dispatchScenePointer(canvas, "pointermove", touchJitterPoint, 821, "touch");
    dispatchScenePointer(canvas, "pointerup", touchJitterPoint, 821, "touch");
    check("terminal-touch-11px-jitter-stays-tap-not-link",
      terminalLinkEvents.length === linkCountBeforeJitter &&
      terminalDragStartEvents.length === dragStartCountBeforeJitter &&
      terminalSelectEvents.length === selectCountBeforeJitter + 1 &&
      canvas.dataset.labTerminalDragPreview === "none");

    const backgroundPoint = (() => {
      const rect = canvas.getBoundingClientRect();
      return { clientX: rect.left + 2, clientY: rect.top + 2 };
    })();
    clearPendingOnDragStart = true;
    mounted.setPendingWireTerminal("D13");
    const linkCountBeforeCanceledArmDrag = terminalLinkEvents.length;
    const dragStartCountBeforeCanceledArmDrag = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragTargetPoint, 829, "touch");
    dispatchScenePointer(canvas, "pointermove", backgroundPoint, 829, "touch");
    const canceledArmDragStart = terminalDragStartEvents.at(-1);
    check("terminal-drag-start-clears-controller-owned-two-tap-arm-before-eventual-cancel",
      terminalDragStartEvents.length === dragStartCountBeforeCanceledArmDrag + 1 &&
      canceledArmDragStart?.sourceId === "R1:A" &&
      canceledArmDragStart?.meta?.source === "pointer-drag" &&
      canceledArmDragStart?.meta?.physicalVerified === false &&
      Object.isFrozen(canceledArmDragStart.meta) &&
      canvas.dataset.labPendingWireTerminal === "" &&
      terminalLinkEvents.length === linkCountBeforeCanceledArmDrag);
    dispatchScenePointer(canvas, "pointercancel", backgroundPoint, 829, "touch");
    check("terminal-drag-start-cancel-remains-exactly-once-without-link",
      terminalDragStartEvents.length === dragStartCountBeforeCanceledArmDrag + 1 &&
      terminalLinkEvents.length === linkCountBeforeCanceledArmDrag &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    clearPendingOnDragStart = false;

    const linkCountBeforeBackground = terminalLinkEvents.length;
    const selectCountBeforeBackground = terminalSelectEvents.length;
    const dragStartCountBeforeBackground = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 822, "mouse");
    dispatchScenePointer(canvas, "pointermove", backgroundPoint, 822, "mouse");
    check("terminal-drag-background-has-no-valid-target-or-ghost",
      terminalDragStartEvents.length === dragStartCountBeforeBackground + 1 &&
      canvas.dataset.labTerminalDragSource === "D13" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    dispatchScenePointer(canvas, "pointerup", backgroundPoint, 822, "mouse");
    check("terminal-drag-background-drop-emits-nothing",
      terminalLinkEvents.length === linkCountBeforeBackground &&
      terminalDragStartEvents.length === dragStartCountBeforeBackground + 1 &&
      terminalSelectEvents.length === selectCountBeforeBackground &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeSameEndpoint = terminalLinkEvents.length;
    const selectCountBeforeSameEndpoint = terminalSelectEvents.length;
    const dragStartCountBeforeSameEndpoint = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 828, "mouse");
    dispatchScenePointer(canvas, "pointermove", backgroundPoint, 828, "mouse");
    dispatchScenePointer(canvas, "pointermove", dragSourcePoint, 828, "mouse");
    check("terminal-drag-same-endpoint-is-not-valid-target",
      terminalDragStartEvents.length === dragStartCountBeforeSameEndpoint + 1 &&
      canvas.dataset.labTerminalDragSource === "D13" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    dispatchScenePointer(canvas, "pointerup", dragSourcePoint, 828, "mouse");
    check("terminal-drag-same-endpoint-emits-nothing",
      terminalLinkEvents.length === linkCountBeforeSameEndpoint &&
      terminalDragStartEvents.length === dragStartCountBeforeSameEndpoint + 1 &&
      terminalSelectEvents.length === selectCountBeforeSameEndpoint &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeForeignPointer = terminalLinkEvents.length;
    const dragStartCountBeforeForeignPointer = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 823, "mouse");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 824, "mouse");
    dispatchScenePointer(canvas, "pointerup", dragTargetPoint, 824, "mouse");
    dispatchScenePointer(canvas, "pointercancel", dragSourcePoint, 823, "mouse");
    check("terminal-drag-foreign-pointer-cannot-complete-link",
      terminalLinkEvents.length === linkCountBeforeForeignPointer &&
      terminalDragStartEvents.length === dragStartCountBeforeForeignPointer &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeTouchCancel = terminalLinkEvents.length;
    const dragStartCountBeforeTouchCancel = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 825, "touch");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 825, "touch");
    check("terminal-touch-drag-arms-ghost-before-cancel",
      terminalDragStartEvents.length === dragStartCountBeforeTouchCancel + 1 &&
      canvas.dataset.labTerminalDragPreview === "ghost" &&
      canvas.dataset.labTerminalDragTarget === "R1:A");
    dispatchScenePointer(canvas, "pointercancel", dragTargetPoint, 825, "touch");
    check("terminal-touch-cancel-clears-ghost-without-link",
      terminalLinkEvents.length === linkCountBeforeTouchCancel &&
      terminalDragStartEvents.length === dragStartCountBeforeTouchCancel + 1 &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeLostCapture = terminalLinkEvents.length;
    const dragStartCountBeforeLostCapture = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 826, "pen");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 826, "pen");
    canvas.dispatchEvent(new PointerEvent("lostpointercapture", {
      pointerId: 826, pointerType: "pen",
      clientX: dragTargetPoint.clientX, clientY: dragTargetPoint.clientY,
      bubbles: true, cancelable: true,
    }));
    check("terminal-pen-lost-capture-clears-ghost-without-link",
      terminalLinkEvents.length === linkCountBeforeLostCapture &&
      terminalDragStartEvents.length === dragStartCountBeforeLostCapture + 1 &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");

    const linkCountBeforeStageClear = terminalLinkEvents.length;
    const dragStartCountBeforeStageClear = terminalDragStartEvents.length;
    dispatchScenePointer(canvas, "pointerdown", dragSourcePoint, 827, "mouse");
    dispatchScenePointer(canvas, "pointermove", dragTargetPoint, 827, "mouse");
    check("terminal-drag-stage-clear-fixture-has-active-ghost",
      terminalDragStartEvents.length === dragStartCountBeforeStageClear + 1 &&
      canvas.dataset.labTerminalDragPreview === "ghost");
    mounted.setLabLayout(null);
    dispatchScenePointer(canvas, "pointerup", dragTargetPoint, 827, "mouse");
    check("terminal-drag-stage-clear-cancels-stale-drop",
      terminalLinkEvents.length === linkCountBeforeStageClear &&
      terminalDragStartEvents.length === dragStartCountBeforeStageClear + 1 &&
      canvas.dataset.labTerminalDragSource === "" &&
      canvas.dataset.labTerminalDragTarget === "" &&
      canvas.dataset.labTerminalDragPreview === "none");
    mounted.setLabLayout(layout);
    // Direct-drag fixture teardown: historical contracts below intentionally
    // start outside edit mode (notably pending-wire-requires-edit-mode).
    mounted.setLabEdit({
      enabled: false,
      onTerminalSelect: null,
      onTerminalDragStart: null,
      onTerminalLink: null,
    });

    let highlightWithoutWiringRejected = false;
    try { mounted.setHighlightedLabWire("w1"); }
    catch (error) { highlightWithoutWiringRejected = error instanceof RangeError; }
    check("highlighted-wire-requires-current-canonical-wiring",
      highlightWithoutWiringRejected && canvas.dataset.labHighlightedWire === "");

    const sampleCircuit = createSampleCircuit(2);
    const committedWireId = sampleCircuit.wires[0].id;
    mounted.setWiring(sampleCircuit, terminals);
    check("committed-wire-route-metadata",
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      Number(canvas.dataset.labWireGeometryRevision) > 0 &&
      Number(canvas.dataset.labWireCount) === sampleCircuit.wires.length &&
      canvas.dataset.labPendingWirePreview === "none");
    const beforeWireHighlight = mounted.getLabViewState();
    const wireCountBeforeHighlight = canvas.dataset.labWireCount;
    const highlightedWire = mounted.setHighlightedLabWire(committedWireId);
    const afterWireHighlight = mounted.getLabViewState();
    check("highlighted-wire-visual-only-state",
      highlightedWire.active === true &&
      highlightedWire.wireId === committedWireId &&
      highlightedWire.mode === "committed-wire-highlight" &&
      highlightedWire.physicalVerified === false &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      canvas.dataset.labWireCount === wireCountBeforeHighlight &&
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none" &&
      afterWireHighlight.selectedComponentId === beforeWireHighlight.selectedComponentId &&
      afterWireHighlight.focusedComponentId === beforeWireHighlight.focusedComponentId &&
      JSON.stringify(afterWireHighlight.camera) === JSON.stringify(beforeWireHighlight.camera));

    const committedGuideWireCount = canvas.dataset.labWireCount;
    const committedGuideRevision = canvas.dataset.labWireGeometryRevision;
    const committedGuide = mounted.setAuthoredPairGuide(guidePair);
    check("authored-pair-guide-coexists-with-committed-wire-without-authority",
      committedGuide.active === true &&
      committedGuide.mode === "view-only" &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      canvas.dataset.labWireCount === committedGuideWireCount &&
      canvas.dataset.labWireGeometryRevision === committedGuideRevision &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2);
    const guideModeBeforeWiringRefresh = canvas.dataset.labAuthoredGuideMode;
    const guideFromBeforeWiringRefresh = canvas.dataset.labAuthoredGuideFrom;
    const guideToBeforeWiringRefresh = canvas.dataset.labAuthoredGuideTo;
    mounted.setWiring(sampleCircuit, terminals);
    check("authored-pair-guide-survives-setWiring-projection-after-guide-mount",
      guideModeBeforeWiringRefresh === "view-only" &&
      canvas.dataset.labAuthoredGuideMode === "view-only" &&
      canvas.dataset.labAuthoredGuideFrom === guideFromBeforeWiringRefresh &&
      canvas.dataset.labAuthoredGuideTo === guideToBeforeWiringRefresh &&
      canvas.dataset.labWireCount === String(sampleCircuit.wires.length) &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labPendingWirePreview === "none");
    mounted.setAuthoredPairGuide(null);
    check("clearing-authored-pair-guide-preserves-committed-wire-state",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireCount === committedGuideWireCount &&
      canvas.dataset.labWireGeometryRevision === committedGuideRevision);

    for (const badWireId of ["w1 ", "X".repeat(81), "w999999"]) {
      let rejected = false;
      try { mounted.setHighlightedLabWire(badWireId); }
      catch (error) { rejected = error instanceof TypeError || error instanceof RangeError; }
      check("highlighted-wire-invalid-id-transactional-" + badWireId.length,
        rejected && canvas.dataset.labHighlightedWire === committedWireId);
    }

    mounted.setWiring(sampleCircuit, terminals);
    check("highlighted-wire-survives-canonical-refresh-when-id-remains",
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment");
    const reversedSameIdentity = connectCircuit(createCircuit(2), "R1:A", "D13");
    mounted.setWiring(reversedSameIdentity, terminals);
    check("highlighted-wire-preserves-unordered-endpoint-identity",
      reversedSameIdentity.wires[0].id === committedWireId &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      Number(canvas.dataset.labWireCount) === 1);
    mounted.setWiring(sampleCircuit, terminals);

    const resistorBeforeLayoutMove = layout.components.find(component => component.id === "R1");
    const movedLayout = moveLabComponent(
      layout,
      "R1",
      layout.bounds.maxX,
      layout.bounds.maxZ,
    );
    const resistorAfterLayoutMove = movedLayout.components.find(component => component.id === "R1");
    const revisionBeforeLayoutMove = Number(canvas.dataset.labWireGeometryRevision);
    mounted.setLabLayout(movedLayout);
    const revisionAfterLayoutMove = Number(canvas.dataset.labWireGeometryRevision);
    check("highlighted-wire-survives-same-lesson-layout-move-rebuild",
      resistorAfterLayoutMove && resistorBeforeLayoutMove &&
      (resistorAfterLayoutMove.x !== resistorBeforeLayoutMove.x ||
        resistorAfterLayoutMove.z !== resistorBeforeLayoutMove.z) &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      revisionAfterLayoutMove > revisionBeforeLayoutMove);
    const rotatedLayout = rotateLabComponent(movedLayout, "R1", 1);
    mounted.setLabLayout(rotatedLayout);
    const revisionAfterLayoutRotate = Number(canvas.dataset.labWireGeometryRevision);
    check("highlighted-wire-survives-same-lesson-layout-rotate-rebuild",
      rotatedLayout.components.find(component => component.id === "R1")?.quarterTurns !==
        resistorAfterLayoutMove.quarterTurns &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      revisionAfterLayoutRotate > revisionAfterLayoutMove);
    check("wire-geometry-revision-strictly-increases-through-layout-move-rotate",
      revisionBeforeLayoutMove < revisionAfterLayoutMove &&
      revisionAfterLayoutMove < revisionAfterLayoutRotate);
    mounted.setLabLayout(layout);
    check("highlighted-wire-survives-same-lesson-layout-restore-rebuild",
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireRoutePointCount === "8");

    const sameIdDifferentEndpoints = connectCircuit(createCircuit(2), "D13", "GND");
    check("highlight-fixture-reuses-id-with-different-endpoints",
      sameIdDifferentEndpoints.wires[0].id === committedWireId &&
      !(
        sameIdDifferentEndpoints.wires[0].from === sampleCircuit.wires[0].from &&
        sameIdDifferentEndpoints.wires[0].to === sampleCircuit.wires[0].to
      ));
    mounted.setWiring(sameIdDifferentEndpoints, terminals);
    check("highlighted-wire-clears-on-same-id-different-endpoints",
      canvas.dataset.labHighlightedWire === "" &&
      Number(canvas.dataset.labWireCount) === 1 &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment");

    mounted.setWiring(sampleCircuit, terminals);
    mounted.setHighlightedLabWire(committedWireId);
    const withoutHighlightedWire = disconnectCircuit(sampleCircuit, committedWireId);
    mounted.setWiring(withoutHighlightedWire, terminals);
    check("highlighted-wire-clears-when-canonical-wire-removed",
      canvas.dataset.labHighlightedWire === "" &&
      Number(canvas.dataset.labWireCount) === withoutHighlightedWire.wires.length);
    const clearedWireHighlight = mounted.setHighlightedLabWire(null);
    check("highlighted-wire-null-clear-idempotent",
      clearedWireHighlight.active === false &&
      clearedWireHighlight.mode === "none" &&
      canvas.dataset.labHighlightedWire === "");
    mounted.setWiring(sampleCircuit, terminals);
    mounted.setHighlightedLabWire(committedWireId);
    check("wiring-clear-fixture-has-committed-endpoint-feedback",
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback));
    mounted.setWiring(null);
    check("clearing-wiring-clears-committed-route-metadata",
      canvas.dataset.labWireCount === "0" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireRoutePointCount === "0" &&
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "none");

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
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      !/committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 0 &&
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
      canvas.dataset.labPendingWirePreview === "none" &&
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 0);

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
      canvas.dataset.labTerminalLabelFeedback === "inspection" &&
      /inspection/.test(canvas.dataset.labTerminalContrastFeedback) &&
      !/committed/.test(canvas.dataset.labTerminalContrastFeedback));
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
    mounted.setWiring(sampleCircuit, terminals);
    mounted.setHighlightedLabWire(committedWireId);
    mounted.setPendingWireTerminal("D13");
    check("pending-and-committed-feedback-compose-before-stage-clear",
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2);
    mounted.setLabLayout(null);
    check("layout-stage-clear-resets-pending-wire-preview",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labPendingWireHoverTerminal === "" &&
      canvas.dataset.labPendingWirePreview === "none");
    check("layout-stage-clear-resets-highlighted-wire",
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireRoutePointCount === "0" &&
      canvas.dataset.labWireGeometryRevision === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "none");
    let highlightAfterStageClearRejected = false;
    try { mounted.setHighlightedLabWire(committedWireId); }
    catch (error) { highlightAfterStageClearRejected = error instanceof RangeError; }
    check("highlighted-wire-rejected-after-stage-layout-clear",
      highlightAfterStageClearRejected && canvas.dataset.labHighlightedWire === "");
    mounted.setWiring(null);
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

    mounted.setLesson({ id: 2 });
    mounted.setLabLayout(layout);
    const guideBeforeDispose = mounted.setAuthoredPairGuide(guidePair);
    check("dispose-authored-guide-fixture-is-active",
      guideBeforeDispose.active === true &&
      canvas.dataset.labAuthoredGuideMode === "view-only");

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
    check("dispose-clears-highlighted-wire-metadata",
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireRoutePointCount === "0" &&
      canvas.dataset.labWireGeometryRevision === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "none");
    check("dispose-clears-authored-pair-guide-metadata",
      canvas.dataset.labAuthoredGuideMode === "none" &&
      canvas.dataset.labAuthoredGuideFrom === "" &&
      canvas.dataset.labAuthoredGuideTo === "");
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    check("dispose-detaches-context-listeners", queuedFrames.size === 0);

    host.remove();
    host = makeHost();
    const remount = mountScene(host);
    await waitTask();
    flushFrames();
    check("remount-after-dispose", host.querySelectorAll("canvas").length === 1);
    const remountCanvas = host.querySelector("canvas");
    const disposeLinkEvents = [];
    remountCanvas.setPointerCapture = () => {};
    remountCanvas.releasePointerCapture = () => {};
    remount.setLesson({ id: 2 });
    remount.setLabLayout(layout);
    remount.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalLink: (fromId, toId, meta) => disposeLinkEvents.push({ fromId, toId, meta }),
    });
    resetCameraForTerminalProjection(remountCanvas);
    const disposeSourcePoint = findTerminalPoint(remountCanvas, layout, "D13", 901);
    const disposeTargetPoint = findTerminalPoint(remountCanvas, layout, "R1:A", 902);
    dispatchScenePointer(remountCanvas, "pointerdown", disposeSourcePoint, 903, "mouse");
    dispatchScenePointer(remountCanvas, "pointermove", disposeTargetPoint, 903, "mouse");
    check("dispose-terminal-drag-fixture-has-active-ghost",
      remountCanvas.dataset.labTerminalDragPreview === "ghost" &&
      remountCanvas.dataset.labTerminalDragTarget === "R1:A");
    remount.dispose();
    check("dispose-clears-terminal-drag-without-callback",
      disposeLinkEvents.length === 0 &&
      remountCanvas.dataset.labTerminalDragSource === "" &&
      remountCanvas.dataset.labTerminalDragTarget === "" &&
      remountCanvas.dataset.labTerminalDragPreview === "none");

    host.remove();
    host = makeHost();
    const guideLoss = mountScene(host);
    await waitTask();
    flushFrames();
    const guideLossCanvas = host.querySelector("canvas");
    guideLoss.setLesson({ id: 2 });
    guideLoss.setLabLayout(layout);
    const guideLossResult = guideLoss.setAuthoredPairGuide(guidePair);
    check("context-loss-authored-guide-fixture-is-active",
      guideLossResult.active === true &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "view-only" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "D13" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "R1:A");
    const guideGl = guideLossCanvas.getContext("webgl2");
    const guideContextExtension = guideGl?.getExtension("WEBGL_lose_context");
    const guideLostPromise = waitEvent(guideLossCanvas, "webglcontextlost");
    if (guideContextExtension) guideContextExtension.loseContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await guideLostPromise;
    check("context-loss-clears-authored-guide-public-state",
      guideLossCanvas.dataset.sceneContext === "lost" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "");
    await waitTask();
    const guideRestoredPromise = waitEvent(guideLossCanvas, "webglcontextrestored");
    if (guideContextExtension) guideContextExtension.restoreContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextrestored"));
    await guideRestoredPromise;
    check("context-restore-revalidates-and-rebuilds-authored-guide",
      guideLossCanvas.dataset.sceneContext === "ready" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "view-only" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "D13" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "R1:A" &&
      guideLossCanvas.dataset.labWireCount === "0" &&
      guideLossCanvas.dataset.labPendingWirePreview === "none");
    flushFrames();
    await waitTask();
    const guideLostAgainPromise = waitEvent(guideLossCanvas, "webglcontextlost");
    if (guideContextExtension) guideContextExtension.loseContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await guideLostAgainPromise;
    const explicitGuideClearWhileLost = guideLoss.setAuthoredPairGuide(null);
    check("context-loss-explicit-null-clears-authored-guide-restore-candidate",
      Object.isFrozen(explicitGuideClearWhileLost) &&
      explicitGuideClearWhileLost.active === false &&
      explicitGuideClearWhileLost.mode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "");
    await waitTask();
    const guideRestoredAfterClearPromise = waitEvent(guideLossCanvas, "webglcontextrestored");
    if (guideContextExtension) guideContextExtension.restoreContext();
    else guideLossCanvas.dispatchEvent(new Event("webglcontextrestored"));
    await guideRestoredAfterClearPromise;
    check("context-restore-does-not-resurrect-explicitly-cleared-authored-guide",
      guideLossCanvas.dataset.sceneContext === "ready" &&
      guideLossCanvas.dataset.labAuthoredGuideMode === "none" &&
      guideLossCanvas.dataset.labAuthoredGuideFrom === "" &&
      guideLossCanvas.dataset.labAuthoredGuideTo === "");
    flushFrames();
    guideLoss.dispose();

    host.remove();
    host = makeHost();
    const lossDispose = mountScene(host);
    await waitTask();
    flushFrames();
    const lossCanvas = host.querySelector("canvas");
    lossCanvas.setPointerCapture = () => {};
    lossCanvas.releasePointerCapture = () => {};
    const lossTerminalLinkEvents = [];
    lossDispose.setLesson({ id: 2 });
    lossDispose.setLabLayout(layout);
    lossDispose.setWiring(sampleCircuit, terminals);
    lossDispose.setHighlightedLabWire(committedWireId);
    lossDispose.setLabEdit({
      enabled: true,
      selectedComponentId: "arduino",
      onTerminalLink: (fromId, toId, meta) => lossTerminalLinkEvents.push({ fromId, toId, meta }),
    });
    resetCameraForTerminalProjection(lossCanvas);
    const lossSourcePoint = findTerminalPoint(lossCanvas, layout, "D13", 904);
    const lossTargetPoint = findTerminalPoint(lossCanvas, layout, "R1:A", 905);
    dispatchScenePointer(lossCanvas, "pointerdown", lossSourcePoint, 906, "mouse");
    dispatchScenePointer(lossCanvas, "pointermove", lossTargetPoint, 906, "mouse");
    check("lesson-change-terminal-drag-fixture-has-active-ghost",
      lossCanvas.dataset.labTerminalDragPreview === "ghost");
    lossDispose.setLesson({ id: 3 });
    check("lesson-change-clears-highlighted-wire",
      lossCanvas.dataset.labHighlightedWire === "" &&
      lossCanvas.dataset.labWireRouteMode === "none" &&
      lossCanvas.dataset.labWireRoutePointCount === "0" &&
      lossCanvas.dataset.labWireGeometryRevision === "0");
    check("lesson-change-cancels-terminal-drag-without-stale-callback",
      lossTerminalLinkEvents.length === 0 &&
      lossCanvas.dataset.labTerminalDragSource === "" &&
      lossCanvas.dataset.labTerminalDragTarget === "" &&
      lossCanvas.dataset.labTerminalDragPreview === "none");
    lossDispose.setLesson({ id: 2 });
    lossDispose.setLabLayout(layout);
    lossDispose.setWiring(sampleCircuit, terminals);
    lossDispose.setHighlightedLabWire(committedWireId);
    lossDispose.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    lossDispose.setPendingWireTerminal("D13");
    resetCameraForTerminalProjection(lossCanvas);
    const contextSourcePoint = findTerminalPoint(lossCanvas, layout, "D13", 907);
    const contextTargetPoint = findTerminalPoint(lossCanvas, layout, "R1:A", 908);
    dispatchScenePointer(lossCanvas, "pointerdown", contextSourcePoint, 909, "touch");
    dispatchScenePointer(lossCanvas, "pointermove", contextTargetPoint, 909, "touch");
    const revisionBeforeContextLoss = Number(lossCanvas.dataset.labWireGeometryRevision);
    check("pending-wire-armed-before-context-reset",
      lossCanvas.dataset.labPendingWireTerminal === "D13" &&
      lossCanvas.dataset.labPendingWirePreview === "none" &&
      lossCanvas.dataset.labHighlightedWire === committedWireId &&
      lossCanvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(lossCanvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /pending/.test(lossCanvas.dataset.labTerminalContrastFeedback) &&
      /committed/.test(lossCanvas.dataset.labTerminalContrastFeedback) &&
      lossCanvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      revisionBeforeContextLoss > 0);
    check("terminal-drag-armed-before-context-reset",
      lossCanvas.dataset.labTerminalDragSource === "D13" &&
      lossCanvas.dataset.labTerminalDragTarget === "R1:A" &&
      lossCanvas.dataset.labTerminalDragPreview === "ghost");
    const linkCountBeforeContextLoss = lossTerminalLinkEvents.length;
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
    check("context-reset-cancels-terminal-drag-without-callback",
      lossTerminalLinkEvents.length === linkCountBeforeContextLoss &&
      lossCanvas.dataset.labTerminalDragSource === "" &&
      lossCanvas.dataset.labTerminalDragTarget === "" &&
      lossCanvas.dataset.labTerminalDragPreview === "none");
    check("context-reset-clears-highlighted-wire",
      lossCanvas.dataset.labHighlightedWire === "" &&
      lossCanvas.dataset.labWireGeometryRevision === "0" &&
      lossCanvas.dataset.labWireHighlightFeedback === "none" &&
      lossCanvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      lossCanvas.dataset.labTerminalContrastFeedback === "none" &&
      !/Dây đang được đánh dấu/.test(lossCanvas.getAttribute("aria-label") || ""));
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
