// Chạy trong browser:
// import("/tests/scene3d-visual-fidelity-contracts.js").then(m => m.runScene3DVisualFidelityContracts())

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));

export async function runScene3DVisualFidelityContracts() {
  const [{ mountScene }, { createLabLayout, moveLabComponent, rotateLabComponent }, {
    listTerminals, createCircuit, connectCircuit, createSampleCircuit,
  }] = await Promise.all([
    import(`../src/scene3d.js?scene3d-visual-fidelity=${Date.now()}`),
    import("../src/lab-layout.js"),
    import("../src/circuit-router.js"),
  ]);
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const source = await fetch(new URL("../src/scene3d.js", import.meta.url)).then(response => response.text());
  check("source-uses-instancing-for-repeated-visual-detail",
    /new T\.InstancedMesh\(/.test(source) &&
    /uno-header-socket-instances/.test(source) &&
    /breadboard-hole-instances/.test(source) &&
    /breadboard-rail-hole-instances/.test(source));
  check("source-contact-strips-remain-nonauthoritative",
    /kind:"breadboard-contact-strip-visual",breadboardConnectivity:false,electricalAuthority:false,physicalVerified:false/.test(source));
  check("source-component-fidelity-has-conceptual-provenance",
    /function conceptualVisualFeature/.test(source) &&
    /conceptualFeature: true/.test(source) &&
    /visualFeature: feature/.test(source) &&
    /electricalAuthority: false/.test(source) &&
    /new T\.SphereGeometry\(globeRadius/.test(source) &&
    /"knob-slot","marking"/.test(source) &&
    /"push-cap"/.test(source) &&
    /"neutral-identification-band","marking"/.test(source));
  check("source-terminal-feedback-is-visual-only",
    /kind:"lab-terminal-hover-affordance"/.test(source) &&
    /kind:"lab-terminal-contrast-backdrop"/.test(source) &&
    /kind:"lab-terminal-committed-wire-affordance"/.test(source) &&
    /kind:"lab-conceptual-wire-highlight-backdrop"/.test(source) &&
    /kind:"lab-terminal-feedback-label"/.test(source) &&
    /labTerminalLabelFeedback/.test(source) &&
    /labTerminalContrastFeedback/.test(source));
  check("source-never-upgrades-visuals-to-physical-proof",
    !/physicalVerified:true|breadboardHoleMapping:true|electricalPower:true|electricalAuthority:true/.test(source));
  check("source-committed-wire-route-is-distinct-from-pending-ghost",
    /LAB_COMMITTED_WIRE_ROUTE_POINTS = 8/.test(source) &&
    /routeModel:"elevated-multisegment"/.test(source) &&
    /new T\.Float32BufferAttribute\(9,3\)/.test(source) &&
    /kind:"lab-pending-wire-preview",committed:false/.test(source));

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:720px;height:420px";
  document.body.append(host);
  const scene = mountScene(host);
  try {
    scene.setLesson({ id: 2 });
    await waitTask();
    scene.resize(true);
    const canvas = host.querySelector("canvas");
    check("visual-profile-is-explicitly-conceptual",
      canvas instanceof HTMLCanvasElement &&
      canvas.dataset.sceneVisualProfile === "conceptual-r3-fidelity-v2" &&
      canvas.dataset.sceneComponentVisualProfile === "conceptual-components-v1" &&
      canvas.dataset.sceneTerminalFeedbackProfile === "contrast-rings-v1" &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      canvas.dataset.scenePhysicalMap === "none");

    const legacySockets = Number(canvas.dataset.sceneUnoHeaderSocketVisualCount);
    const legacyHoles = Number(canvas.dataset.sceneBreadboardHoleVisualCount);
    const legacyStrips = Number(canvas.dataset.sceneBreadboardContactStripVisualCount);
    const instanced = Number(canvas.dataset.sceneInstancedVisualCount);
    const baselineComponentFeatures = Number(canvas.dataset.sceneComponentVisualFeatureCount);
    const baselineComponentKinds = Number(canvas.dataset.sceneComponentVisualKindCount);
    const baselineComponentMarkings = Number(canvas.dataset.sceneComponentMarkingCount);
    const baselineTerminalContrast = Number(canvas.dataset.sceneTerminalContrastAffordanceCount);
    check("legacy-scene-has-recognizable-header-and-breadboard-detail",
      legacySockets >= 20 && legacyHoles >= 100 && legacyStrips >= 10);
    check("instanced-detail-count-covers-repeated-geometry",
      instanced >= legacySockets + legacyHoles &&
      Number(canvas.dataset.sceneFineDetailInstanceCount) > Number(canvas.dataset.sceneFineDetailObjectCount) &&
      Number(canvas.dataset.sceneFineDetailCount) === Number(canvas.dataset.sceneFineDetailObjectCount));

    check("desktop-starts-full-lod", canvas.dataset.sceneLod === "full");
    const fullDetailCount = canvas.dataset.sceneFineDetailCount;
    const fullDetailInstances = canvas.dataset.sceneFineDetailInstanceCount;
    host.style.width = "420px";
    host.style.height = "300px";
    scene.resize(true);
    check("compact-viewport-reduces-lod-without-changing-detail-inventory",
      canvas.dataset.sceneLod === "reduced" &&
      canvas.dataset.sceneFineDetailCount === fullDetailCount &&
      canvas.dataset.sceneFineDetailInstanceCount === fullDetailInstances);
    host.style.width = "720px";
    host.style.height = "420px";
    scene.resize(true);
    check("desktop-lod-restores", canvas.dataset.sceneLod === "full");

    const layout = createLabLayout(2, listTerminals(2));
    scene.setLabLayout(layout);
    scene.setLabEdit({ enabled: true, selectedComponentId: "arduino" });
    check("lab-layout-adds-visual-detail-not-cad-mapping",
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) > legacySockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) > legacyHoles &&
      Number(canvas.dataset.sceneBreadboardContactStripVisualCount) > legacyStrips &&
      Number(canvas.dataset.sceneComponentVisualFeatureCount) > baselineComponentFeatures &&
      Number(canvas.dataset.sceneComponentVisualKindCount) > baselineComponentKinds &&
      Number(canvas.dataset.sceneComponentMarkingCount) > baselineComponentMarkings &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) === layout.terminals.length &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) > baselineTerminalContrast &&
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none");
    check("terminal-label-feedback-starts-quiet",
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none" &&
      canvas.dataset.labTerminalContrastFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none");

    const sampleCircuit = createSampleCircuit(2);
    const committedWireId = sampleCircuit.wires[0].id;
    scene.setWiring(sampleCircuit, listTerminals(2));
    check("committed-wire-uses-elevated-route-inventory",
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      Number(canvas.dataset.labWireGeometryRevision) > 0 &&
      Number(canvas.dataset.labWireCount) === sampleCircuit.wires.length);
    const highlighted = scene.setHighlightedLabWire(committedWireId);
    check("committed-wire-highlight-does-not-become-pending-ghost",
      highlighted.mode === "committed-wire-highlight" &&
      highlighted.physicalVerified === false &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labPendingWirePreview === "none" &&
      Number(canvas.dataset.labWireCount) === sampleCircuit.wires.length &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback));

    const r1Before = layout.components.find(component => component.id === "R1");
    const movedLayout = moveLabComponent(layout, "R1", layout.bounds.maxX, layout.bounds.maxZ);
    const r1Moved = movedLayout.components.find(component => component.id === "R1");
    const revisionBeforeLayoutMove = Number(canvas.dataset.labWireGeometryRevision);
    scene.setLabLayout(movedLayout);
    const revisionAfterLayoutMove = Number(canvas.dataset.labWireGeometryRevision);
    check("committed-wire-highlight-survives-set-layout-move-route-rebuild",
      r1Before && r1Moved &&
      (r1Moved.x !== r1Before.x || r1Moved.z !== r1Before.z) &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      canvas.dataset.labWireRouteMode === "elevated-multisegment" &&
      revisionAfterLayoutMove > revisionBeforeLayoutMove);
    const rotatedLayout = rotateLabComponent(movedLayout, "R1", 1);
    scene.setLabLayout(rotatedLayout);
    const revisionAfterLayoutRotate = Number(canvas.dataset.labWireGeometryRevision);
    check("committed-wire-highlight-survives-set-layout-rotate-route-rebuild",
      rotatedLayout.components.find(component => component.id === "R1")?.quarterTurns !== r1Moved.quarterTurns &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      revisionAfterLayoutRotate > revisionAfterLayoutMove);
    check("committed-wire-revision-strictly-increases-across-layout-move-rotate",
      revisionBeforeLayoutMove < revisionAfterLayoutMove &&
      revisionAfterLayoutMove < revisionAfterLayoutRotate);
    scene.setLabLayout(layout);

    const sameIdDifferentEndpoints = connectCircuit(createCircuit(2), "D13", "GND");
    scene.setWiring(sameIdDifferentEndpoints, listTerminals(2));
    check("committed-wire-highlight-clears-on-same-id-endpoint-replacement",
      sameIdDifferentEndpoints.wires[0].id === committedWireId &&
      canvas.dataset.labHighlightedWire === "" &&
      Number(canvas.dataset.labWireCount) === 1);
    scene.setWiring(sampleCircuit, listTerminals(2));
    scene.setHighlightedLabWire(committedWireId);

    const movable = layout.components.find(component =>
      component.fixed === false &&
      component.terminalIds.some(id => id === sampleCircuit.wires[0].from || id === sampleCircuit.wires[0].to)
    ) || layout.components.find(component => component.fixed === false && component.id !== "breadboard");
    check("wire-route-fixture-has-movable-terminal-component", !!movable);
    scene.setLabEdit({ enabled: true, selectedComponentId: movable.id });
    canvas.focus();
    const revisionBeforeMove = Number(canvas.dataset.labWireGeometryRevision);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true }));
    const revisionAfterMove = Number(canvas.dataset.labWireGeometryRevision);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true, cancelable: true }));
    const revisionAfterRotate = Number(canvas.dataset.labWireGeometryRevision);
    check("wire-route-recomputes-on-component-move-and-rotate",
      revisionAfterMove > revisionBeforeMove &&
      revisionAfterRotate > revisionAfterMove &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      Number(canvas.dataset.labWireCount) === sampleCircuit.wires.length);

    const revisionBeforeWireLod = Number(canvas.dataset.labWireGeometryRevision);
    host.style.width = "420px";
    host.style.height = "300px";
    scene.resize(true);
    const revisionAfterWireLod = Number(canvas.dataset.labWireGeometryRevision);
    check("wire-route-recomputes-across-lod-refresh",
      canvas.dataset.sceneLod === "reduced" &&
      revisionAfterWireLod > revisionBeforeWireLod &&
      canvas.dataset.labWireRoutePointCount === "8" &&
      canvas.dataset.labHighlightedWire === committedWireId &&
      canvas.dataset.labWireHighlightFeedback === "contrast-line+endpoints" &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2);
    host.style.width = "720px";
    host.style.height = "420px";
    scene.resize(true);

    const inspected = scene.setInspectedTerminal("D13");
    check("inspection-shows-readable-terminal-feedback",
      inspected.mode === "lab-halo" &&
      canvas.dataset.labTerminalLabelFeedback === "inspection" &&
      canvas.dataset.labInspectedTerminal === "D13");
    const pending = scene.setPendingWireTerminal("D13");
    check("pending-selection-has-priority-label-feedback",
      pending.mode === "first-terminal-preview" &&
      canvas.dataset.labTerminalLabelFeedback === "pending" &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback) &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2 &&
      Number(canvas.dataset.labWireCount) === sampleCircuit.wires.length &&
      canvas.dataset.labHighlightedWire === committedWireId);

    let invalidPendingRejected = false;
    try { scene.setPendingWireTerminal("D13 "); }
    catch (error) { invalidPendingRejected = error instanceof TypeError; }
    check("pending-terminal-whitespace-id-rejected-transactionally",
      invalidPendingRejected &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labTerminalLabelFeedback === "pending" &&
      /pending/.test(canvas.dataset.labTerminalContrastFeedback) &&
      Number(canvas.dataset.labCommittedWireEndpointFeedbackCount) === 2);

    scene.setPendingWireTerminal(null);
    check("clearing-pending-restores-inspection-feedback",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "inspection" &&
      /inspection/.test(canvas.dataset.labTerminalContrastFeedback) &&
      /committed/.test(canvas.dataset.labTerminalContrastFeedback));
    scene.setHighlightedLabWire(null);
    check("clearing-committed-highlight-removes-endpoint-feedback-only",
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labTerminalContrastFeedback === "inspection");

    scene.setLabEdit({ enabled: false });
    scene.setLabLayout(null);
    check("clearing-lab-removes-added-geometry-diagnostics",
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) === legacySockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) === legacyHoles &&
      Number(canvas.dataset.sceneBreadboardContactStripVisualCount) === legacyStrips &&
      Number(canvas.dataset.sceneComponentVisualFeatureCount) === baselineComponentFeatures &&
      Number(canvas.dataset.sceneComponentVisualKindCount) === baselineComponentKinds &&
      Number(canvas.dataset.sceneComponentMarkingCount) === baselineComponentMarkings &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) === baselineTerminalContrast &&
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none" &&
      canvas.dataset.labTerminalContrastFeedback === "none" &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.labHighlightedWire === "" &&
      canvas.dataset.labWireRouteMode === "none" &&
      canvas.dataset.labWireGeometryRevision === "0");

    const readOnly = scene.setInspectedTerminal("D13", layout);
    check("read-only-inspection-does-not-recreate-3d-terminal-geometry",
      readOnly.mode === "read-only-label" &&
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) === legacySockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) === legacyHoles &&
      Number(canvas.dataset.sceneTerminalContrastAffordanceCount) === baselineTerminalContrast &&
      canvas.dataset.labCommittedWireEndpointFeedbackCount === "0" &&
      canvas.dataset.labWireHighlightFeedback === "none" &&
      canvas.dataset.sceneCadMapping === "none");
  } finally {
    scene.dispose();
    host.remove();
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
