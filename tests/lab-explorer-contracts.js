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
      selectedWireId: options.selectedWireId ?? null,
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
    selectedWireId: options.selectedWireId ?? null,
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

  check("selected-learner-wire-projects-exact-id-and-endpoints-across-pure-surfaces", () => {
    const lessonId = 2;
    const pair = sampleWires(lessonId)[0];
    const circuit = connectCircuit(createCircuit(lessonId), pair[0], pair[1]);
    const model = createLabExplorerModel(snapshotFor(lessonId, {
      circuit,
      analysis: analyzeCircuit(lessonId, circuit),
      hasLearnerDraft: true,
      source: "learner-draft",
      selectedWireId: "w1",
      editing: false,
    }));
    assert(model.selectedWireId === "w1", "top-level selected wire id mismatch");
    assert(model.selectedWire?.id === "w1" && model.selectedWire.from === pair[0] && model.selectedWire.to === pair[1],
      "selected wire must come from exact current learner graph endpoints");
    assert(Object.isFrozen(model.selectedWire), "selected learner wire projection must be frozen");
    assert(model.inspector.selectedWire === model.selectedWire && model.inspector.selectedWireId === "w1",
      "inspector selected wire projection mismatch");
    assert(model.schematic.selectedWireId === "w1" &&
      model.schematic.wires.filter(wire => wire.selected).length === 1 &&
      model.schematic.wires.find(wire => wire.id === "w1")?.selected === true,
      "schematic must select exactly current learner wire");
    assert(model.schematic.referenceWires.every(wire => wire.selected === false),
      "reference/sample wire must never become selected learner wire");
    assert(model.minimap.selectedWireId === "w1" &&
      model.minimap.wires.filter(wire => wire.selected).length === 1 &&
      model.minimap.wires[0]?.from === pair[0] && model.minimap.wires[0]?.to === pair[1],
      "minimap selected wire projection/endpoints mismatch");
    assert(model.editing === false, "selected wire projection must survive read-only editing=false state");
  });

  check("selected-wire-stale-or-reference-only-id-clears-without-selecting-sample", () => {
    const referenceOnly = createLabExplorerModel(snapshotFor(2, { selectedWireId: "w1" }));
    assert(referenceOnly.schematic.wires.length === 0 && referenceOnly.schematic.referenceWires.some(wire => wire.id === "w1"),
      "fixture must contain reference w1 but no learner wires");
    assert(referenceOnly.selectedWireId === null && referenceOnly.selectedWire === null,
      "reference-only ID must clear instead of selecting sample wire");
    assert(referenceOnly.inspector.selectedWireId === null && referenceOnly.minimap.selectedWireId === null,
      "stale/reference-only selection must clear on all pure surfaces");

    const lessonOne = createLabExplorerModel(snapshotFor(1, { selectedWireId: "w1" }));
    assert(lessonOne.selectedWireId === null && lessonOne.selectedWire === null,
      "lesson change to no-netlist lesson must clear selected wire");
  });

  check("selected-wire-and-snapshot-injection-fail-closed", () => {
    const snapshotWithUncheckedCircuit = circuit => {
      const snapshot = snapshotFor(2);
      snapshot.circuit = circuit;
      return snapshot;
    };
    for (const bad of ["", " w1", "w1 ", "W1", "w0", "__proto__", "w1<script>", 1, {}, []]) {
      expectThrow(
        () => createLabExplorerModel(snapshotFor(2, { selectedWireId: bad })),
        /selectedWireId|wire ID/i,
        `invalid selectedWireId ${String(bad)}`,
      );
    }

    const extra = snapshotFor(2);
    extra.selectedWire = { id: "w1", from: "D13", to: "R1:A" };
    expectThrow(() => createLabExplorerModel(extra), /field không được hỗ trợ/i,
      "caller cannot inject selected wire object/endpoints");

    const symbol = snapshotFor(2);
    symbol[Symbol("selectedWireId")] = "w1";
    expectThrow(() => createLabExplorerModel(symbol), /field không được hỗ trợ/i,
      "symbol snapshot field must fail closed");

    const inherited = Object.create({ selectedWireId: "w1" });
    Object.assign(inherited, snapshotFor(2));
    expectThrow(() => createLabExplorerModel(inherited), /plain object/i,
      "custom-prototype snapshot must fail closed");

    const accessorSnapshot = snapshotFor(2);
    Object.defineProperty(accessorSnapshot, "selectedWireId", {
      enumerable: true,
      get() { throw new Error("getter must never execute"); },
    });
    expectThrow(() => createLabExplorerModel(accessorSnapshot), /accessor field/i,
      "snapshot accessor injection must fail before getter execution");

    const pair = sampleWires(2)[0];
    const forgedCircuit = createCircuit(2);
    forgedCircuit.wires = [{ id: "__proto__", from: pair[0], to: pair[1] }];
    forgedCircuit.nextWireId = 2;
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(forgedCircuit)), /wire|ID/i,
      "prototype-like learner wire id must fail closed");

    const inheritedCircuit = Object.create({
      get lessonId() { throw new Error("inherited lessonId getter must never execute"); },
      get wires() { throw new Error("inherited wires getter must never execute"); },
    });
    inheritedCircuit.version = 1;
    inheritedCircuit.supported = true;
    inheritedCircuit.nextWireId = 1;
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(inheritedCircuit)), /plain object/i,
      "inherited circuit state must fail before inherited getter execution");

    const getterCircuit = createCircuit(2);
    Object.defineProperty(getterCircuit, "wires", {
      enumerable: true,
      get() { throw new Error("circuit wires getter must never execute"); },
    });
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(getterCircuit)), /own data field|accessor/i,
      "circuit getter field must fail before getter execution");

    const missingOwnWireField = createCircuit(2);
    missingOwnWireField.wires = [{ from: pair[0], to: pair[1] }];
    missingOwnWireField.nextWireId = 2;
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(missingOwnWireField)), /\.id.*own data field/i,
      "wire missing own id must fail closed");

    const inheritedWire = Object.create({ id: "w1" });
    inheritedWire.from = pair[0];
    inheritedWire.to = pair[1];
    const inheritedWireCircuit = createCircuit(2);
    inheritedWireCircuit.wires = [inheritedWire];
    inheritedWireCircuit.nextWireId = 2;
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(inheritedWireCircuit)), /plain object/i,
      "wire inherited id/prototype must fail closed");

    const getterWire = { id: "w1", from: pair[0], to: pair[1] };
    Object.defineProperty(getterWire, "id", {
      enumerable: true,
      get() { throw new Error("wire id getter must never execute"); },
    });
    const getterWireCircuit = createCircuit(2);
    getterWireCircuit.wires = [getterWire];
    getterWireCircuit.nextWireId = 2;
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(getterWireCircuit)), /own data field|accessor/i,
      "wire getter field must fail before getter execution");

    const arrayGetterCircuit = createCircuit(2);
    const maliciousWires = [];
    Object.defineProperty(maliciousWires, "0", {
      enumerable: true,
      configurable: true,
      get() { throw new Error("wire array getter must never execute"); },
    });
    arrayGetterCircuit.wires = maliciousWires;
    arrayGetterCircuit.nextWireId = 2;
    expectThrow(() => createLabExplorerModel(snapshotWithUncheckedCircuit(arrayGetterCircuit)), /own data element/i,
      "wire array accessor element must fail before getter execution");
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

    check("dom-selected-wire-projects-all-surfaces-focus-continuity-and-clears-stale", () => {
      const lessonId = 2;
      const pair = sampleWires(lessonId)[0];
      const circuit = connectCircuit(createCircuit(lessonId), pair[0], pair[1]);
      let current = snapshotFor(lessonId, {
        circuit,
        analysis: analyzeCircuit(lessonId, circuit),
        hasLearnerDraft: true,
        source: "learner-draft",
        editing: true,
        selectedWireId: "w1",
      });
      const host = document.createElement("div");
      document.body.append(host);
      const explorer = mountLabExplorer(host, { getSnapshot: () => current });
      const root = host.querySelector("[data-lab-explorer]");
      const selected = [
        host.querySelector("[data-explorer-panel='inspector'] [data-explorer-selected-wire='w1']"),
        host.querySelector("[data-explorer-panel='schematic'] svg [data-explorer-selected-wire='w1']"),
        host.querySelector("[data-explorer-panel='minimap'] svg [data-explorer-selected-wire='w1']"),
        host.querySelector("li[data-explorer-wire='w1'][data-explorer-selected-wire='w1']"),
      ];
      assert(selected.every(Boolean),
        "selected wire must project to inspector, schematic, minimap and HTML row");
      assert(selected.every(node => node.getAttribute("aria-current") === "true"),
        "four semantic selected-wire projections need aria-current=true");
      assert(root?.dataset.explorerSelectedWire === "w1",
        "root selected-wire state mirror missing");
      assert(root?.getAttribute("aria-current") === null,
        "explorer root is a container state mirror, not an aria-current wire item");
      const row = host.querySelector("li[data-explorer-wire='w1']");
      assert(row?.getAttribute("aria-current") === "true", "accessible learner wire row selection missing");
      const highlight = host.querySelector("[data-explorer-highlight-wire='w1']");
      assert(highlight?.getAttribute("aria-pressed") === "true", "highlight control must reflect selected wire");
      assert(highlight?.style.minWidth === "44px" && highlight?.style.minHeight === "44px",
        "wire control must retain 44px target");
      assert(host.querySelector("[data-explorer-connect-from]")?.style.minHeight === "44px",
        "connector select must retain 44px mobile height");
      highlight.focus();
      explorer.update();
      assert(document.activeElement?.getAttribute("data-explorer-highlight-wire") === "w1",
        "highlight wire focus must survive same-wire rerender");

      current = { ...current, stage: "2d", editing: false };
      explorer.update();
      assert(host.querySelector("[data-explorer-panel='inspector'] [data-explorer-selected-wire='w1']") &&
        host.querySelector("[data-explorer-panel='schematic'] svg [data-explorer-selected-wire='w1']") &&
        host.querySelector("[data-explorer-panel='minimap'] svg [data-explorer-selected-wire='w1']") &&
        host.querySelector("li[data-explorer-wire='w1'][data-explorer-selected-wire='w1']"),
      "all four semantic wire projections must survive 3D to 2D/read-only stage");
      assert(host.querySelector("[data-explorer-highlight-wire='w1']")?.disabled === true,
        "3D highlight action must remain gated while selection projection stays visible");

      const empty = createCircuit(lessonId);
      current = snapshotFor(lessonId, {
        circuit: empty,
        analysis: analyzeCircuit(lessonId, empty),
        hasLearnerDraft: true,
        source: "learner-draft",
        selectedWireId: "w1",
      });
      explorer.update();
      assert(!host.querySelector("[data-explorer-selected-wire='w1']"),
        "stale selected wire marker must clear after learner wire disappears");
      assert(host.querySelector("[data-lab-explorer]")?.dataset.explorerSelectedWire === "",
        "root selected wire state must clear when stale");

      const invalid = { ...current, selectedWireId: "__proto__" };
      const result = explorer.update(invalid);
      assert(result.ok === false, "invalid selected wire update must fail closed");
      const invalidRoot = host.querySelector("[data-lab-explorer]");
      assert(invalidRoot?.dataset.explorerSelectedWire === "",
        "invalid update must not retain stale selected wire dataset");
      assert(invalidRoot?.getAttribute("aria-current") === null,
        "invalid root remains a container state mirror, never an aria-current wire item");
      const invalidSemanticSelections = [
        host.querySelector("[data-explorer-panel='inspector'] [data-explorer-selected-wire]"),
        host.querySelector("[data-explorer-panel='schematic'] svg [data-explorer-selected-wire]"),
        host.querySelector("[data-explorer-panel='minimap'] svg [data-explorer-selected-wire]"),
        host.querySelector("li[data-explorer-wire][data-explorer-selected-wire]"),
      ];
      assert(invalidSemanticSelections.every(node => node === null),
        "invalid update must clear all four semantic selected-wire projections");
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
    api: "snapshot.selectedWireId:string|null -> read-only selected learner wire projection; mount callbacks unchanged",
  });
}
