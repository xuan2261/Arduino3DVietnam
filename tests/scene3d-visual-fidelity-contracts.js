// Chạy trong browser:
// import("/tests/scene3d-visual-fidelity-contracts.js").then(m => m.runScene3DVisualFidelityContracts())

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));

export async function runScene3DVisualFidelityContracts() {
  const [{ mountScene }, { createLabLayout }, { listTerminals }] = await Promise.all([
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
  check("source-terminal-feedback-is-visual-only",
    /kind:"lab-terminal-hover-affordance"/.test(source) &&
    /kind:"lab-terminal-feedback-label"/.test(source) &&
    /labTerminalLabelFeedback/.test(source));
  check("source-never-upgrades-visuals-to-physical-proof",
    !/physicalVerified:true|breadboardHoleMapping:true|electricalPower:true|electricalAuthority:true/.test(source));

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
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none" &&
      canvas.dataset.scenePhysicalMap === "none");

    const legacySockets = Number(canvas.dataset.sceneUnoHeaderSocketVisualCount);
    const legacyHoles = Number(canvas.dataset.sceneBreadboardHoleVisualCount);
    const legacyStrips = Number(canvas.dataset.sceneBreadboardContactStripVisualCount);
    const instanced = Number(canvas.dataset.sceneInstancedVisualCount);
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
      canvas.dataset.sceneCadMapping === "none" &&
      canvas.dataset.sceneElectricalAuthority === "none");
    check("terminal-label-feedback-starts-quiet",
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none");

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
      canvas.dataset.labWireCount === "0");

    let invalidPendingRejected = false;
    try { scene.setPendingWireTerminal("D13 "); }
    catch (error) { invalidPendingRejected = error instanceof TypeError; }
    check("pending-terminal-whitespace-id-rejected-transactionally",
      invalidPendingRejected &&
      canvas.dataset.labPendingWireTerminal === "D13" &&
      canvas.dataset.labTerminalLabelFeedback === "pending");

    scene.setPendingWireTerminal(null);
    check("clearing-pending-restores-inspection-feedback",
      canvas.dataset.labPendingWireTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "inspection");

    scene.setLabEdit({ enabled: false });
    scene.setLabLayout(null);
    check("clearing-lab-removes-added-geometry-diagnostics",
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) === legacySockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) === legacyHoles &&
      Number(canvas.dataset.sceneBreadboardContactStripVisualCount) === legacyStrips &&
      canvas.dataset.labHoveredTerminal === "" &&
      canvas.dataset.labTerminalLabelFeedback === "none");

    const readOnly = scene.setInspectedTerminal("D13", layout);
    check("read-only-inspection-does-not-recreate-3d-terminal-geometry",
      readOnly.mode === "read-only-label" &&
      Number(canvas.dataset.sceneUnoHeaderSocketVisualCount) === legacySockets &&
      Number(canvas.dataset.sceneBreadboardHoleVisualCount) === legacyHoles &&
      canvas.dataset.sceneCadMapping === "none");
  } finally {
    scene.dispose();
    host.remove();
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
