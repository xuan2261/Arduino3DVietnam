import {
  createLabExplorerModel,
  explorerTerminalPosition,
} from "../src/lab-explorer.js";
import { mountLabExplorer } from "../src/lab-explorer-ui.js";
import {
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  createSampleCircuit,
  listTerminals,
  sampleWires,
} from "../src/circuit-router.js";
import { createLabLayout } from "../src/lab-layout.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, message) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert(caught, `${message}: expected exception`);
  assert(pattern.test(String(caught.message)), `${message}: ${caught.message}`);
}

function snapshotFor(lessonId, options = {}) {
  if (lessonId === 1) {
    return {
      lessonId: 1,
      lesson: { id: 1, title: "Làm quen với Arduino Uno R3" },
      stage: "3d",
      editing: false,
      selectedComponentId: null,
      layout: null,
      circuit: null,
      referenceCircuit: null,
      hasLearnerDraft: false,
      analysis: null,
      referenceAnalysis: null,
      source: "learner-empty",
      evidence: { origin: "learner-empty", reference: "reference-sample", physicalVerified: false },
      sceneView: null,
      claims: { physicalVerified: false },
      ...options,
    };
  }
  const terminals = listTerminals(lessonId);
  const circuit = options.circuit ?? createCircuit(lessonId);
  const referenceCircuit = options.referenceCircuit ?? createSampleCircuit(lessonId);
  const layout = options.layout ?? createLabLayout(lessonId, terminals);
  return {
    lessonId,
    lesson: { id: lessonId, title: `Bài ${lessonId}` },
    stage: "3d",
    editing: Boolean(options.editing),
    selectedComponentId: options.selectedComponentId ?? null,
    selectedTerminalId: options.selectedTerminalId ?? null,
    layout,
    circuit,
    referenceCircuit,
    hasLearnerDraft: options.hasLearnerDraft ?? false,
    analysis: options.analysis ?? analyzeCircuit(lessonId, circuit),
    referenceAnalysis: options.referenceAnalysis ?? analyzeCircuit(lessonId, referenceCircuit),
    source: options.source ?? (options.hasLearnerDraft ? "learner-draft" : "learner-empty"),
    evidence: {
      origin: options.source ?? (options.hasLearnerDraft ? "learner-draft" : "learner-empty"),
      reference: "reference-sample",
      physicalVerified: false,
    },
    sceneView: options.sceneView ?? null,
    claims: { physicalVerified: false },
  };
}

export function runLabExplorerContracts() {
  const checks = [];
  const check = (name, fn) => {
    fn();
    checks.push(Object.freeze({ name, status: "PASS" }));
  };

  check("lesson-01-no-external-netlist", () => {
    const model = createLabExplorerModel(snapshotFor(1));
    assert(model.lessonId === 1 && model.supported === false, "lesson 1 must be unsupported external netlist");
    assert(model.source.kind === "none", "lesson 1 source must be none");
    assert(model.schematic.mode === "none" && model.schematic.wires.length === 0, "lesson 1 schematic must be empty");
    assert(model.minimap.available === false, "lesson 1 minimap must be unavailable");
    assert(model.boundaries.physicalVerified === false && model.boundaries.schematicOwnsCircuit === false,
      "lesson 1 must preserve conceptual/read-only boundary");
  });

  for (let lessonId = 2; lessonId <= 16; lessonId += 1) {
    check(`lesson-${String(lessonId).padStart(2, "0")}-learner-empty-reference-separated`, () => {
      const snapshot = snapshotFor(lessonId);
      const model = createLabExplorerModel(snapshot);
      const terminals = listTerminals(lessonId);
      assert(model.supported, `lesson ${lessonId} explorer must be supported`);
      assert(model.source.kind === "learner-empty", `lesson ${lessonId} source must remain learner-empty`);
      assert(model.schematic.wires.length === 0, `lesson ${lessonId} learner schematic must remain empty`);
      assert(model.schematic.referenceWires.length === sampleWires(lessonId).length,
        `lesson ${lessonId} reference overlay must use canonical sample only`);
      assert(model.reference.wireCount === sampleWires(lessonId).length,
        `lesson ${lessonId} reference count mismatch`);
      assert(model.schematic.terminals.length === terminals.length,
        `lesson ${lessonId} schematic terminal count mismatch`);
      assert(model.minimap.terminals.length === terminals.length,
        `lesson ${lessonId} minimap terminal count mismatch`);
      assert(model.boundaries.electricalFlow === false && model.boundaries.breadboardHoleMapping === false,
        `lesson ${lessonId} cannot claim flow/hole mapping`);
      for (const terminal of terminals) {
        const schematic = explorerTerminalPosition(model, terminal.id, "schematic");
        const minimap = explorerTerminalPosition(model, terminal.id, "minimap");
        assert(Number.isFinite(schematic.x) && Number.isFinite(schematic.y), `lesson ${lessonId} schematic terminal invalid`);
        assert(Number.isFinite(minimap.x) && Number.isFinite(minimap.y), `lesson ${lessonId} minimap terminal invalid`);
        assert(schematic.physicalVerified === false && minimap.physicalVerified === false,
          `lesson ${lessonId} terminal cannot claim physical mapping`);
      }
    });
  }

  check("learner-draft-is-only-editable-schematic", () => {
    const lessonId = 2;
    const [pair] = sampleWires(lessonId);
    const circuit = connectCircuit(createCircuit(lessonId), pair[0], pair[1]);
    const snapshot = snapshotFor(lessonId, {
      circuit,
      analysis: analyzeCircuit(lessonId, circuit),
      hasLearnerDraft: true,
      source: "learner-draft",
      editing: true,
    });
    const model = createLabExplorerModel(snapshot);
    assert(model.source.kind === "learner-draft", "draft source mismatch");
    assert(model.schematic.wires.length === 1, "draft wire must be projected");
    assert(model.schematic.wires[0].editable === true, "learner draft wire must be deletable while editing");
    assert(model.schematic.referenceWires.every(wire => wire.editable === false && wire.referenceOnly === true),
      "reference overlay must always remain read-only");
    assert(model.schematic.editableWireDeletion === true, "draft deletion gate must open only for learner draft");
  });

  check("reference-never-becomes-learner-completion", () => {
    const model = createLabExplorerModel(snapshotFor(3, { editing: true }));
    assert(model.source.kind === "learner-empty", "untouched source must remain learner-empty");
    assert(model.schematic.wires.length === 0, "reference wires must never be copied into learner wires");
    assert(model.schematic.referenceWires.length > 0, "reference overlay should remain separately available");
    assert(model.schematic.editableWireDeletion === false, "reference state cannot expose delete");
  });

  for (const lessonId of [10, 14]) {
    check(`lesson-${lessonId}-signal-only-boundary`, () => {
      const model = createLabExplorerModel(snapshotFor(lessonId));
      assert(model.scope === "signal-only" && model.schematic.signalOnly === true,
        `lesson ${lessonId} must retain signal-only scope`);
      assert(model.schematic.issues.some(issue => issue.code === "SIGNAL_ONLY_POWER_LOAD_UNMODELED"),
        `lesson ${lessonId} must surface unmodeled power/load warning`);
      assert(model.boundaries.physicalSafety === false, `lesson ${lessonId} cannot claim physical safety`);
    });
  }

  check("selected-component-inspector-is-canonical", () => {
    const lessonId = 16;
    const layout = createLabLayout(lessonId, listTerminals(lessonId));
    const selected = layout.components.find(component => component.id === "LM35");
    assert(selected, "lesson16 LM35 missing from layout fixture");
    const model = createLabExplorerModel(snapshotFor(lessonId, {
      layout,
      selectedComponentId: "LM35",
      sceneView: { focusedComponentId: "LM35" },
    }));
    assert(model.inspector.component.id === "LM35", "inspector component mismatch");
    assert(model.inspector.terminals.map(terminal => terminal.id).join(",") === "LM35:VS,LM35:VOUT,LM35:GND",
      "inspector must preserve exact canonical terminal IDs/order");
    assert(model.minimap.selectedComponentId === "LM35" && model.minimap.focusedComponentId === "LM35",
      "minimap selection/focus state mismatch");
  });

  check("selected-terminal-propagates-to-pure-surfaces", () => {
    const model = createLabExplorerModel(snapshotFor(2, { selectedTerminalId: "D13" }));
    assert(model.selectedTerminalId === "D13", "top-level selected terminal mismatch");
    assert(model.schematic.selectedTerminalId === "D13", "schematic selected terminal mismatch");
    assert(model.minimap.selectedTerminalId === "D13", "minimap selected terminal mismatch");
    assert(model.schematic.terminals.find(item => item.id === "D13")?.selected === true,
      "schematic terminal selected flag missing");
    assert(model.minimap.terminals.find(item => item.terminalId === "D13")?.selected === true,
      "minimap terminal selected flag missing");
  });

  check("selected-terminal-rejects-foreign-id", () => {
    expectThrow(
      () => createLabExplorerModel(snapshotFor(2, { selectedTerminalId: "NOPE" })),
      /selectedTerminalId|terminal/i,
      "foreign selected terminal",
    );
  });

  check("model-rejects-cross-lesson-or-physical-claims", () => {
    const wrongCircuit = createCircuit(3);
    expectThrow(
      () => createLabExplorerModel(snapshotFor(2, { circuit: wrongCircuit, analysis: analyzeCircuit(3, wrongCircuit) })),
      /lesson|circuit/i,
      "cross-lesson circuit",
    );
    const physical = snapshotFor(2);
    physical.evidence = { origin: "learner-empty", physicalVerified: true };
    expectThrow(() => createLabExplorerModel(physical), /physicalVerified/i, "physical evidence claim");
  });

  check("model-rejects-unknown-terminal-wire", () => {
    const snapshot = snapshotFor(2);
    snapshot.circuit = { ...snapshot.circuit, wires: [{ id: "w1", from: "D13", to: "NOPE" }], nextWireId: 2 };
    expectThrow(() => createLabExplorerModel(snapshot), /terminal|wire/i, "unknown terminal wire");
  });

  if (typeof document !== "undefined" && document?.body) {
    check("dom-three-surfaces-and-stable-selectors", () => {
      const host = document.createElement("div");
      document.body.append(host);
      const calls = [];
      const snapshot = snapshotFor(2, { editing: true });
      const explorer = mountLabExplorer(host, {
        getSnapshot: () => snapshot,
        onSelectComponent: id => calls.push(["component", id]),
        onSelectTerminal: id => calls.push(["terminal", id]),
        onConnect: (from, to) => calls.push(["connect", from, to]),
        onDisconnect: id => calls.push(["disconnect", id]),
        onFocus: id => calls.push(["focus", id]),
      });
      assert(host.querySelector("[data-lab-explorer]"), "explorer root missing");
      for (const name of ["inspector", "schematic", "minimap"]) {
        assert(host.querySelector(`[data-explorer-panel="${name}"]`), `${name} panel missing`);
      }
      assert(host.querySelector("[data-explorer-source='learner-empty']"), "learner-empty source badge missing");
      assert(host.querySelector("[data-explorer-reference-toggle]"), "reference overlay toggle missing");
      assert(!host.querySelector("[data-explorer-reference-wire]"), "reference overlay must be off by default");
      host.querySelector("[data-explorer-reference-toggle]").click();
      assert(host.querySelector("[data-explorer-reference-view='on']"), "reference overlay view marker missing");
      assert(host.querySelector("[data-explorer-reference-wire]"), "reference overlay wire missing after explicit toggle");
      assert(!host.querySelector("[data-explorer-disconnect]"), "reference overlay must never create delete buttons");

      const componentNode = host.querySelector("[data-explorer-panel='minimap'] [data-explorer-component]");
      assert(componentNode, "minimap component action missing");
      componentNode.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      assert(calls.some(call => call[0] === "component"), "minimap keyboard must delegate component selection");
      assert(calls.some(call => call[0] === "focus"), "minimap keyboard must delegate scene focus");

      const terminalNode = host.querySelector("[data-explorer-panel='schematic'] [data-explorer-terminal]");
      terminalNode.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      assert(calls.some(call => call[0] === "terminal"), "schematic keyboard must delegate terminal selection");

      const from = host.querySelector("[data-explorer-connect-from]");
      const to = host.querySelector("[data-explorer-connect-to]");
      assert(from && to && from.value !== to.value, "connector selects missing/different endpoint setup failed");
      host.querySelector("[data-explorer-connect]").click();
      assert(calls.some(call => call[0] === "connect" && call[1] === from.value && call[2] === to.value),
        "connect must delegate canonical endpoints");
      explorer.dispose();
      assert(!host.querySelector("[data-lab-explorer]"), "dispose must remove explorer root");
      host.remove();
    });

    check("dom-selected-terminal-aria-and-html-equivalent", () => {
      const host = document.createElement("div");
      document.body.append(host);
      const snapshot = snapshotFor(2, { editing: true, selectedTerminalId: "D13" });
      const explorer = mountLabExplorer(host, { getSnapshot: () => snapshot });
      const schematicSvg = host.querySelector("[data-explorer-schematic]");
      const minimapSvg = host.querySelector("[data-explorer-minimap]");
      assert(schematicSvg?.getAttribute("role") === "group", "schematic SVG root must be role=group");
      assert(minimapSvg?.getAttribute("role") === "group", "minimap SVG root must be role=group");
      const schematicTerminal = host.querySelector("[data-explorer-panel='schematic'] svg [data-explorer-terminal='D13']");
      const minimapTerminal = host.querySelector("[data-explorer-panel='minimap'] svg [data-explorer-terminal='D13']");
      const htmlTerminal = host.querySelector("[data-explorer-terminal-actions] [data-explorer-terminal='D13']");
      assert(schematicTerminal?.getAttribute("aria-pressed") === "true", "schematic selected terminal aria-pressed missing");
      assert(minimapTerminal?.getAttribute("aria-pressed") === "true", "minimap selected terminal aria-pressed missing");
      assert(htmlTerminal?.getAttribute("aria-pressed") === "true", "HTML equivalent selected terminal aria-pressed missing");
      assert(host.querySelector("[data-explorer-selected-terminal-status='D13']"), "selected terminal visible status missing");
      assert(host.querySelector("[data-lab-explorer]")?.dataset.explorerSelectedTerminal === "D13", "root selected terminal state missing");
      explorer.dispose();
      host.remove();
    });

    check("dom-reference-resets-on-lesson-change", () => {
      const host = document.createElement("div");
      document.body.append(host);
      let current = snapshotFor(2, { editing: true });
      const explorer = mountLabExplorer(host, { getSnapshot: () => current });
      host.querySelector("[data-explorer-reference-toggle]").click();
      assert(host.querySelector("[data-explorer-reference-view='on']"), "reference should be on before lesson switch");
      current = snapshotFor(3, { editing: true });
      explorer.update();
      assert(host.querySelector("[data-explorer-reference-view='off']"), "reference must reset off on lesson switch");
      assert(!host.querySelector("[data-explorer-reference-wire]"), "reference wires must be hidden after lesson switch");
      explorer.dispose();
      host.remove();
    });

    check("dom-focus-controls-gated-by-editing", () => {
      const host = document.createElement("div");
      document.body.append(host);
      const calls = [];
      let current = snapshotFor(2, { editing: false, selectedComponentId: "breadboard" });
      const explorer = mountLabExplorer(host, {
        getSnapshot: () => current,
        onFocus: id => calls.push(id),
      });
      const disabledFocus = host.querySelector("button[data-explorer-focus]");
      assert(disabledFocus?.disabled === true, "focus-only HTML control must be disabled outside edit mode");
      assert(host.querySelector("[data-explorer-focus-status='disabled']"), "focus disabled explanation missing");
      assert(!host.querySelector("[data-explorer-panel='minimap'] svg [data-explorer-focus]"), "minimap SVG must not expose focus action outside edit mode");
      disabledFocus.click();
      assert(calls.length === 0, "disabled focus must not invoke callback");
      current = snapshotFor(2, { editing: true, selectedComponentId: "breadboard" });
      explorer.update();
      const enabledFocus = host.querySelector("button[data-explorer-focus]");
      assert(enabledFocus && enabledFocus.disabled === false, "focus control must enable in edit mode");
      enabledFocus.click();
      assert(calls.length === 1, "enabled focus must invoke callback exactly once");
      explorer.dispose();
      host.remove();
    });

    check("dom-learner-wire-delete-only", () => {
      const lessonId = 2;
      const pair = sampleWires(lessonId)[0];
      const circuit = connectCircuit(createCircuit(lessonId), pair[0], pair[1]);
      const snapshot = snapshotFor(lessonId, {
        circuit,
        analysis: analyzeCircuit(lessonId, circuit),
        hasLearnerDraft: true,
        source: "learner-draft",
        editing: true,
      });
      const host = document.createElement("div");
      document.body.append(host);
      let removed = null;
      const explorer = mountLabExplorer(host, { getSnapshot: () => snapshot, onDisconnect: id => { removed = id; } });
      const button = host.querySelector("[data-explorer-disconnect='w1']");
      assert(button, "learner wire delete control missing");
      button.click();
      assert(removed === "w1", "learner delete must delegate exact wire id");
      explorer.dispose();
      host.remove();
    });

    check("dom-lesson01-empty-surface", () => {
      const host = document.createElement("div");
      document.body.append(host);
      const explorer = mountLabExplorer(host, { getSnapshot: () => snapshotFor(1) });
      assert(host.querySelector("[data-explorer-empty='lesson-01']"), "lesson1 explicit empty marker missing");
      assert(!host.querySelector("[data-explorer-connect]"), "lesson1 must not expose connect action");
      explorer.dispose();
      host.remove();
    });
  }

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    failed: 0,
    checks: Object.freeze(checks),
    api: "mountLabExplorer(host,{getSnapshot,onSelectComponent,onSelectTerminal,onConnect,onDisconnect,onFocus})",
  });
}
