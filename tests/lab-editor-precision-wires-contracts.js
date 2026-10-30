import {
  connectCircuit,
  createCircuit,
  createSampleCircuit,
} from "../src/circuit-router.js";
import { mountLabEditor } from "../src/lab-editor-ui.js";
import { lessonById } from "../src/lessons.js";
import { buildPracticeCheckpointTrail } from "../src/practice-checkpoint-trail.js";

function assert(condition, label) {
  if (!condition) throw new Error("lab-editor-precision-wires contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function dataKey(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.value = "";
    this.type = "";
    this.hidden = false;
    this.disabled = false;
    this.min = "";
    this.max = "";
    this._text = "";
  }

  set textContent(value) {
    this._text = String(value ?? "");
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }

  set innerHTML(_) {
    throw new Error("lab precision wire UI must not use innerHTML");
  }

  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeNode, "fake append expects node");
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type, callback) {
    const callbacks = this.listeners.get(type) ?? [];
    this.listeners.set(type, callbacks.filter(item => item !== callback));
  }

  matches(selector) {
    if (selector.startsWith("[data-") && selector.endsWith("]")) {
      const body = selector.slice(1, -1);
      const equals = body.indexOf("=");
      const attribute = equals === -1 ? body : body.slice(0, equals);
      const expected = equals === -1 ? null : body.slice(equals + 1).replace(/^['"]|['"]$/g, "");
      const key = dataKey(attribute);
      if (!Object.hasOwn(this.dataset, key)) return false;
      return expected === null || String(this.dataset[key]) === expected;
    }
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).filter(Boolean).includes(selector.slice(1));
    }
    return this.tagName === selector.toUpperCase();
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  dispatch(type, extra = {}) {
    if (this.disabled && (type === "click" || type === "change")) return false;
    let stopped = false;
    const event = {
      target: this,
      currentTarget: this,
      key: extra.key,
      preventDefault() {},
      stopPropagation() { stopped = true; },
      ...extra,
    };
    let node = this;
    while (node && !stopped) {
      event.currentTarget = node;
      for (const callback of node.listeners.get(type) ?? []) callback(event);
      node = node.parentNode;
    }
    return true;
  }

  click() { return this.dispatch("click"); }
  change() { return this.dispatch("change"); }
  pressEnter() {
    if (this.disabled || this.tagName !== "BUTTON") return false;
    this.dispatch("keydown", { key: "Enter" });
    return this.click();
  }
  focus() { this.ownerDocument.activeElement = this; }
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
    this.activeElement = null;
  }
  createElement(tagName) { return new FakeNode(tagName, this); }
  getElementById(id) { return this.byId.get(id) ?? null; }
  register(id, tagName = "div") {
    const node = this.createElement(tagName);
    node.id = id;
    this.byId.set(id, node);
    return node;
  }
}

function isNativeBrowserDocument(document) {
  return typeof globalThis.Window === "function" &&
    globalThis.window instanceof globalThis.Window &&
    globalThis.window.document === document &&
    globalThis.document === document;
}

function makeDom(document = new FakeDocument()) {
  const nativeBrowserDom = isNativeBrowserDocument(document);
  const displacedIds = [];
  const root = document.createElement("div");
  const register = (id, tagName = "div") => {
    if (!nativeBrowserDom) return document.register(id, tagName);
    const existing = document.getElementById(id);
    if (existing) {
      displacedIds.push({ node: existing, id });
      existing.id = id + "--precision-contract-saved";
    }
    const node = document.createElement(tagName);
    node.id = id;
    return node;
  };

  const entry = register("labEditEntry", "div");
  const panel = register("labEditor", "section");
  const toggle = register("labEditToggle", "button");
  const componentSelect = register("labComponent", "select");
  const posX = register("labPositionX", "input");
  const posZ = register("labPositionZ", "input");
  const fromSelect = register("labFromPin", "select");
  const toSelect = register("labToPin", "select");
  const message = register("labStatus", "div");
  const terminalNote = register("labSelectedTerminal", "p");
  const avrNote = register("labAvrStatus", "div");
  const cancelPending = register("labCancelPendingWire", "button");

  const placement = document.createElement("fieldset");
  placement.append(componentSelect, posX, posZ);
  const wiring = document.createElement("fieldset");
  wiring.append(fromSelect, toSelect, terminalNote, cancelPending);
  // FakeDocument.register() can resolve detached nodes from its ID map, while
  // a real browser document only resolves controls that are connected to the
  // document tree. Keep every DOM dependency required by mountLabEditor inside
  // the native fixture, including the two status nodes.
  panel.append(placement, wiring, message, avrNote);
  entry.append(toggle);

  for (const [id, tag] of [
    ["labPlace", "button"],
    ["labRotateLeft", "button"],
    ["labRotateRight", "button"],
    ["labResetPositions", "button"],
    ["labConnect", "button"],
    ["labSampleWires", "button"],
    ["labClearWires", "button"],
    ["labRemoveLastWire", "button"],
  ]) {
    panel.append(register(id, tag));
  }

  if (nativeBrowserDom) {
    root.setAttribute("data-lab-precision-contract-fixture", "");
    root.style.position = "absolute";
    root.style.left = "-10000px";
    root.style.top = "0";
    root.style.width = "900px";
    root.append(entry, panel);
    document.body.append(root);
  }

  return {
    document, panel, wiring, message, nativeBrowserDom,
    cleanup() {
      if (!nativeBrowserDom) return;
      root.remove();
      for (const { node, id } of displacedIds.reverse()) node.id = id;
    },
  };
}

function makeScene() {
  return {
    labEdit: null,
    layout: null,
    pending: null,
    authoredPairGuide: null,
    wiring: null,
    labEditCalls: 0,
    layoutCalls: 0,
    pendingCalls: 0,
    highlightedWire: null,
    highlightCalls: 0,
    setLabEdit(value) { this.labEditCalls += 1; this.labEdit = value; return true; },
    setLabLayout(value) { this.layoutCalls += 1; this.layout = value; return true; },
    setPendingWireTerminal(value) { this.pendingCalls += 1; this.pending = value; return true; },
    setHighlightedLabWire(value) {
      this.highlightCalls += 1;
      this.highlightedWire = value;
      return Object.freeze({
        wireId: value,
        active: value !== null,
        mode: value === null ? "none" : "committed-wire-highlight",
        physicalVerified: false,
      });
    },
    setAuthoredPairGuide(value) { this.authoredPairGuide = value; return { active: value !== null, mode: "view-only" }; },
    setWiring(value) { this.wiring = value; return { mode: "conceptual-netlist" }; },
  };
}

function withFixture({ circuits = new Map(), onWireInspection = null, onSceneReconciled = null } = {}, run) {
  const nativeBrowserDom = isNativeBrowserDocument(globalThis.document);
  const previousDocument = nativeBrowserDom ? null : globalThis.document;
  const dom = makeDom(nativeBrowserDom ? globalThis.document : new FakeDocument());
  const scene = makeScene();
  const changes = [];
  const layoutChanges = [];
  const reconciliations = [];
  if (!nativeBrowserDom) globalThis.document = dom.document;
  let ui = null;
  try {
    ui = mountLabEditor({
      getCircuit: lessonId => circuits.get(lessonId) ?? null,
      onCircuitChange: (lessonId, circuit, analysis) => {
        circuits.set(lessonId, circuit);
        changes.push({ lessonId, circuit, analysis });
      },
      onLayoutChange: (layout, lessonId) => layoutChanges.push({ layout, lessonId }),
      onWireInspection,
      onSceneReconciled: (layout, meta, reconciledLessonId) => {
        reconciliations.push({ layout, meta, lessonId: reconciledLessonId });
        onSceneReconciled?.(layout, meta, reconciledLessonId);
      },
    });
    ui.setScene(scene);
    return run({ ...dom, scene, changes, layoutChanges, reconciliations, circuits, ui });
  } finally {
    ui?.dispose();
    dom.cleanup();
    if (!nativeBrowserDom) {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  }
}

const pointerMeta = () => Object.freeze({ source: "pointer-drag", physicalVerified: false });
const wirePointerMeta = () => Object.freeze({ source: "pointer", physicalVerified: false });
const authoredHoleMeta = (overrides = {}) => Object.freeze({
  source: "authored-hole-confirm",
  physicalVerified: false,
  profileId: "generic-63x10-terminal-strips",
  fromHoleId: "A1",
  toHoleId: "J63",
  placementRevision: 0,
  ...overrides,
});

export function runLabEditorPrecisionWiresContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("per-wire-list-is-native-accessible-and-learner-graph-only", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const two = connectCircuit(one, "R1:B", "LED:A");
    expectThrow(
      () => withFixture({ circuits: new Map([[2, two]]), onWireInspection: {} }, () => {}),
      /observers must be functions/i,
      "wire inspection observer must be an opt-in function",
    );
    withFixture({ circuits: new Map([[2, two]]) }, ({ ui, scene, panel, document, nativeBrowserDom }) => {
      ui.setLesson(2);
      assert(ui.openEditor(), "lesson 2 editor opens");
      assert(scene.labEdit?.enabled === true, "scene edit bridge enabled");
      assert(typeof ui.preparePracticeRepairPair === "function" &&
        typeof ui.focusPracticeReviewWire === "function" &&
        typeof ui.reroutePracticeWire === "function",
      "frozen controller exposes explicit Practice prepare/review/reroute helpers");
      const list = panel.querySelector("[data-lab-precision-wire-list]");
      assert(list && list.getAttribute("role") === "group", "precision wire list exposes named group");
      const provenance = list.querySelector("[data-lab-wire-provenance]");
      assert(provenance?.dataset.labWireProvenance === "learner graph only" &&
        /learner graph only/.test(provenance.textContent),
      "visible provenance is learner graph only");
      const rows = [...list.querySelectorAll("[data-lab-wire-row]")];
      const removeButtons = [...list.querySelectorAll("[data-lab-remove-wire-id]")];
      const inspectButtons = [...list.querySelectorAll("[data-lab-inspect-wire-id]")];
      const undoLayout = panel.querySelector("[data-lab-layout-undo]");
      const redoLayout = panel.querySelector("[data-lab-layout-redo]");
      assert(rows.length === 2 && removeButtons.length === 2 && inspectButtons.length === 2,
        "one native inspect/remove action pair per canonical learner wire");
      assert(undoLayout?.tagName === "BUTTON" && redoLayout?.tagName === "BUTTON" &&
        undoLayout.type === "button" && redoLayout.type === "button",
      "layout history actions are native buttons");
      assert(undoLayout.style.minHeight === "44px" && undoLayout.style.minWidth === "44px" &&
        redoLayout.style.minHeight === "44px" && redoLayout.style.minWidth === "44px",
      "layout history actions enforce >=44px target hooks");
      assert(undoLayout.disabled && redoLayout.disabled &&
        undoLayout.getAttribute("aria-disabled") === "true" && redoLayout.getAttribute("aria-disabled") === "true",
      "empty layout history exposes truthful disabled and aria-disabled state");
      assert(rows.every(row => row.tagName === "LI") &&
        list.querySelector("[data-lab-precision-wire-rows]")?.tagName === "UL",
      "precision wire inventory uses native ul/li list semantics");
      assert(rows[0].textContent.includes("w1 · D13 → R1:A · learner graph only") &&
        rows[1].textContent.includes("w2 · R1:B → LED:A · learner graph only"),
      "rows expose exact wire IDs/endpoints and provenance via textContent");
      assert(rows[0].dataset.labWireFrom === "D13" && rows[0].dataset.labWireTo === "R1:A" &&
        rows[1].dataset.labWireFrom === "R1:B" && rows[1].dataset.labWireTo === "LED:A",
      "wire rows capture exact canonical endpoints for stale same-ID focus revalidation");
      for (const button of inspectButtons) {
        assert(button.tagName === "BUTTON" && button.type === "button", "inspect action is native button");
        assert(button.textContent === "Xem dây" && button.style.minHeight === "44px" && button.style.minWidth === "44px",
          "inspect action exposes exact label and >=44px target hooks");
        assert(/Xem dây w\d+ từ .+ đến .+ trên learner graph/.test(button.getAttribute("aria-label") || ""),
          "inspect action has exact accessible wire/endpoints name");
        assert(button.dataset.labWireLesson === "2", "inspect action captures current lesson for stale revalidation");
      }
      for (const button of removeButtons) {
        assert(button.tagName === "BUTTON" && button.type === "button", "remove action is native button");
        assert(button.style.minHeight === "44px" && button.style.minWidth === "44px",
          "remove action enforces >=44px target hooks");
        assert(/Gỡ dây w\d+ từ .+ đến .+ khỏi learner graph/.test(button.getAttribute("aria-label") || ""),
          "remove action has exact accessible wire/endpoints name");
        assert(button.dataset.labWireLesson === "2", "button captures current lesson for stale revalidation");
      }
      if (nativeBrowserDom) {
        const Button = document.defaultView?.HTMLButtonElement;
        const actionButtons = [...inspectButtons, ...removeButtons, undoLayout, redoLayout];
        assert(Button && actionButtons.every(button => button instanceof Button),
          "browser direct path renders actual native HTMLButtonElement inspect/remove controls");
        assert(actionButtons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        }), "browser direct path proves each inspect/remove control is at least 44x44 CSS px");
      }
    });
  });

  check("remove-exact-wire-id-routes-through-canonical-change-and-rejects-stale", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const two = connectCircuit(one, "R1:B", "LED:A");
    const circuits = new Map([[2, two], [3, createCircuit(3)]]);
    const inspections = [];
    withFixture({
      circuits,
      onWireInspection: (wireId, meta, inspectedLessonId) => inspections.push({ wireId, meta, inspectedLessonId }),
    }, ({ ui, scene, panel, changes, document, message }) => {
      ui.setLesson(2);
      ui.openEditor();
      assert(typeof scene.labEdit?.onCommittedWireInspect === "function",
        "scene edit bridge exposes committed-wire inspection callback");
      assert(scene.labEdit.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "wire inspection regression starts with an armed two-tap terminal");
      const pointerInspectionMeta = wirePointerMeta();
      const inspected = scene.labEdit.onCommittedWireInspect("w1", pointerInspectionMeta);
      assert(Object.isFrozen(inspected) && inspected.accepted === true && inspected.reason === "inspected" &&
        inspected.lessonId === 2 && inspected.wireId === "w1" && inspected.from === "D13" && inspected.to === "R1:A" &&
        inspected.source === "pointer" && inspected.mode === "committed-wire-inspection" &&
        inspected.learnerGraphOnly === true && inspected.visualOnly === true &&
        inspected.electricalAuthority === false && inspected.physicalVerified === false,
      "scene pointer inspection returns exact frozen read-only learner-wire result");
      assert(scene.highlightedWire === "w1" && scene.highlightCalls === 1 &&
        ui.snapshot().firstTerminal === null && scene.pending === null && changes.length === 0,
      "accepted pointer inspection highlights only and clears pending connection intent without graph/history write");
      assert(inspections.length === 1 && inspections[0].wireId === "w1" &&
        inspections[0].meta === pointerInspectionMeta && inspections[0].inspectedLessonId === 2,
      "opt-in onWireInspection receives exact wire/meta/current lesson signature");

      const inspectW2 = panel.querySelector('[data-lab-inspect-wire-id="w2"]');
      assert(inspectW2, "w2 native inspect action present");
      inspectW2.focus({ preventScroll: true });
      inspectW2.click();
      assert(document.activeElement === inspectW2 && scene.highlightedWire === "w2" && changes.length === 0,
        "native inspect keeps keyboard focus and remains graph read-only");
      const nativeReport = inspections.at(-1);
      assert(inspections.length === 2 && nativeReport.wireId === "w2" && nativeReport.inspectedLessonId === 2 &&
        Object.isFrozen(nativeReport.meta) && nativeReport.meta.source === "native-button" &&
        nativeReport.meta.physicalVerified === false && Reflect.ownKeys(nativeReport.meta).length === 2,
      "native inspect reports strict frozen native-button metadata through same observer callback");

      assert(scene.labEdit.onTerminalSelect("LED:K") === true && ui.snapshot().firstTerminal === "LED:K",
        "practice review fixture arms a pending terminal before handoff");
      const reviewCircuit = circuits.get(2);
      const reviewLayoutDepth = ui.snapshot().layoutUndoDepth;
      const review = ui.focusPracticeReviewWire("w1", "R1:A", "D13", 2);
      const focusedInspectW1 = panel.querySelector('[data-lab-inspect-wire-id="w1"]');
      assert(Object.isFrozen(review) && review.accepted === true && review.reason === "focused-review" &&
        review.lessonId === 2 && review.wireId === "w1" && review.fromId === "D13" &&
        review.toId === "R1:A" && review.committed === false && review.physicalVerified === false,
      "practice review accepts unordered exact canonical endpoints and returns frozen noncommitting receipt");
      assert(focusedInspectW1 && document.activeElement === focusedInspectW1 &&
        ui.snapshot().firstTerminal === null && scene.pending === null &&
        changes.length === 0 && circuits.get(2) === reviewCircuit &&
        ui.snapshot().layoutUndoDepth === reviewLayoutDepth && inspections.length === 2,
      "practice review focuses existing exact Inspect, clears stale pending intent, and does not inspect/remove/mutate graph or layout");
      assert(/không tự gỡ/i.test(message.textContent) && /không.*hoàn thành Practice/i.test(message.textContent),
        "practice review announcement requires learner action and denies auto-remove/completion");

      const reviewMessage = message.textContent;
      const reviewFocus = document.activeElement;
      const reusedIdWrongEndpoints = ui.focusPracticeReviewWire("w1", "R1:B", "LED:A", 2);
      assert(reusedIdWrongEndpoints.accepted === false &&
        reusedIdWrongEndpoints.reason === "wire-endpoints-mismatch" &&
        document.activeElement === reviewFocus && message.textContent === reviewMessage &&
        changes.length === 0 && circuits.get(2) === reviewCircuit,
      "same canonical wire ID cannot be reused with another endpoint pair or steal focus");
      const staleReview = ui.focusPracticeReviewWire("w1", "D13", "R1:A", 3);
      assert(staleReview.accepted === false && staleReview.reason === "stale-lesson" &&
        document.activeElement === reviewFocus && message.textContent === reviewMessage &&
        changes.length === 0 && circuits.get(2) === reviewCircuit,
      "stale lesson practice review is focus/message/graph side-effect free");

      const w1 = [...panel.querySelectorAll("[data-lab-remove-wire-id]")]
        .find(button => button.dataset.labRemoveWireId === "w1");
      assert(w1, "w1 precise remove action present");
      w1.focus({ preventScroll: true });
      assert(document.activeElement === w1, "keyboard focus can enter exact remove action");
      w1.click();
      const after = circuits.get(2);
      assert(changes.length === 1 && after.wires.length === 1 && after.wires[0].id === "w2" &&
        after.nextWireId === 3,
      "click removes exact w1 through onCircuitChange while preserving router ID semantics");
      const surviving = panel.querySelector("[data-lab-remove-wire-id=\"w2\"]");
      assert(surviving && document.activeElement === surviving,
        "native remove restores focus to the next surviving exact-wire action");
      assert(ui.removeWire("w1", 2) === false && changes.length === 1,
        "already-removed stale wire is rejected without side effect");

      surviving.click();
      const list = panel.querySelector("[data-lab-precision-wire-list]");
      assert(changes.length === 2 && circuits.get(2).wires.length === 0 &&
        document.activeElement === list && list.getAttribute("tabindex") === "-1",
      "native removal of the final wire restores focus to the named focusable wire group");

      ui.setLesson(3);
      ui.openEditor();
      assert(ui.removeWire("w2", 2) === false && changes.length === 2,
        "captured old-lesson remove request is rejected after lesson switch");
      assert(ui.removeWire("<img src=x onerror=1>", 3) === false && changes.length === 2,
        "non-router/injection-like wire ID is rejected before DOM or graph mutation");
    });

    const programmaticCircuits = new Map([[2, one]]);
    withFixture({ circuits: programmaticCircuits }, ({ ui, document }) => {
      ui.setLesson(2);
      ui.openEditor();
      const toggle = document.getElementById("labEditToggle");
      toggle.focus({ preventScroll: true });
      assert(document.activeElement === toggle, "programmatic focus baseline uses stable native toggle");
      assert(ui.removeWire("w1", 2) === true, "programmatic exact removal still succeeds");
      assert(document.activeElement === toggle,
        "programmatic/history-style removal does not steal or restore keyboard focus");
    });

    const negativeReports = [];
    withFixture({
      circuits: new Map([[2, one]]),
      onWireInspection: (...args) => negativeReports.push(args),
    }, ({ ui, scene, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      assert(scene.labEdit.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "negative inspection fixture starts with pending terminal intent");
      const baselineHighlightCalls = scene.highlightCalls;
      const baselinePending = ui.snapshot().firstTerminal;
      let forgedGetterReads = 0;
      const getterMeta = {};
      Object.defineProperties(getterMeta, {
        source: { enumerable: true, get() { forgedGetterReads += 1; return "pointer"; } },
        physicalVerified: { enumerable: true, value: false },
      });
      Object.freeze(getterMeta);
      const negatives = [
        ["w1", wirePointerMeta(), undefined, "stale-lesson"],
        ["w1", wirePointerMeta(), 3, "stale-lesson"],
        ["w1", pointerMeta(), 2, "invalid-meta"],
        ["w1", { source: "pointer", physicalVerified: false }, 2, "invalid-meta"],
        ["w1", Object.freeze({ source: "pointer", physicalVerified: false, extra: true }), 2, "invalid-meta"],
        ["w1", getterMeta, 2, "invalid-meta"],
        ["w1", Object.freeze(Object.assign(Object.create({ inherited: true }), {
          source: "pointer", physicalVerified: false,
        })), 2, "invalid-meta"],
        ["__proto__", wirePointerMeta(), 2, "invalid-wire-id"],
        ["w99", wirePointerMeta(), 2, "stale-wire"],
      ];
      for (const [wireId, meta, expectedLessonId, reason] of negatives) {
        const result = ui.inspectCommittedWire(wireId, meta, expectedLessonId);
        assert(result.accepted === false && result.reason === reason,
          "inspection rejects stale/forged request: " + reason);
        assert(scene.highlightCalls === baselineHighlightCalls && negativeReports.length === 0 &&
          changes.length === 0 && ui.snapshot().firstTerminal === baselinePending,
        "rejected inspection is highlight/callback/graph/pending side-effect free: " + reason);
      }
      assert(forgedGetterReads === 0, "inspection metadata validation never executes forged getters");

      scene.setHighlightedLabWire = () => { throw new RangeError("stale scene wiring"); };
      const highlightRejected = ui.inspectCommittedWire("w1", wirePointerMeta(), 2);
      assert(highlightRejected.accepted === false && highlightRejected.reason === "highlight-rejected" &&
        negativeReports.length === 0 && changes.length === 0 && ui.snapshot().firstTerminal === baselinePending,
      "scene highlight failure cannot clear pending intent, report inspection, or mutate graph");
    });

    const forgedWire = Object.assign(Object.create({ inheritedWire: true }), {
      id: "w1", from: "D13", to: "R1:A",
    });
    const forgedCircuit = { ...one, wires: [forgedWire] };
    const forgedCircuits = new Map([[2, one]]);
    withFixture({ circuits: forgedCircuits }, ({ ui, scene, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      forgedCircuits.set(2, forgedCircuit);
      const result = ui.inspectCommittedWire("w1", wirePointerMeta(), 2);
      assert(result.accepted === false && ["forged-wire", "foreign-learner-graph"].includes(result.reason) &&
        scene.highlightCalls === 0 && changes.length === 0,
      "prototype-forged wire record is rejected before visual inspection or graph write");
    });

    const foreignCircuits = new Map([[2, one]]);
    withFixture({ circuits: foreignCircuits }, ({ ui, scene, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      foreignCircuits.set(2, createCircuit(3));
      const result = ui.inspectCommittedWire("w1", wirePointerMeta(), 2);
      assert(result.accepted === false && result.reason === "foreign-learner-graph" &&
        scene.highlightCalls === 0 && changes.length === 0,
      "foreign-lesson graph cannot be inspected as current learner wiring");
    });

    const reusedIdInitial=connectCircuit(createCircuit(2),"D13","R1:A");
    const reusedIdNext=connectCircuit(createCircuit(2),"R1:B","LED:A");
    const reusedIdCircuits=new Map([[2,reusedIdInitial]]);
    withFixture({circuits:reusedIdCircuits},({ui,panel,changes,document,message})=>{
      ui.setLesson(2);
      ui.openEditor();
      const staleRow=panel.querySelector('[data-lab-wire-row="w1"]');
      assert(staleRow?.dataset.labWireFrom === "D13" && staleRow?.dataset.labWireTo === "R1:A",
        "same-ID reuse fixture begins with exact old w1 row endpoints");
      const toggle=document.getElementById("labEditToggle");
      toggle.focus({preventScroll:true});
      const beforeMessage=message.textContent;
      reusedIdCircuits.set(2,reusedIdNext);
      const staleDom=ui.focusPracticeReviewWire("w1","R1:B","LED:A",2);
      assert(staleDom.accepted === false && staleDom.reason === "wire-action-unavailable" &&
        document.activeElement === toggle && message.textContent === beforeMessage &&
        changes.length === 0 && reusedIdCircuits.get(2) === reusedIdNext,
      "same canonical wire ID reused for new endpoints cannot focus stale old-endpoint DOM row");
      ui.update();
      const currentRow=panel.querySelector('[data-lab-wire-row="w1"]');
      const currentInspect=panel.querySelector('[data-lab-inspect-wire-id="w1"]');
      assert(currentRow?.dataset.labWireFrom === "R1:B" && currentRow?.dataset.labWireTo === "LED:A",
        "explicit update rerenders reused w1 with current canonical endpoints");
      const current=ui.focusPracticeReviewWire("w1","LED:A","R1:B",2);
      assert(current.accepted === true && current.reason === "focused-review" &&
        document.activeElement === currentInspect && changes.length === 0 &&
        reusedIdCircuits.get(2) === reusedIdNext,
      "same-ID reused wire becomes focusable only after exact current endpoint row exists");
    });
  });

  check("empty-learner-graph-never-falls-back-to-reference-and-inspection-is-read-only", () => {
    assert(createSampleCircuit(2).wires.length > 0, "reference fixture must contain sample wires");
    withFixture({}, ({ ui, panel, changes, scene, document, nativeBrowserDom }) => {
      ui.setLesson(2);
      expectThrow(
        () => ui.setReadOnlyGuideMode("true"),
        /boolean/i,
        "guide mode rejects non-boolean enable requests",
      );
      assert(ui.isReadOnlyGuideIn3D() === false, "guide mode starts off");
      assert(ui.setReadOnlyGuideMode(true) === true && ui.isReadOnlyGuideIn3D() === true,
        "eligible 3D lesson explicitly enables read-only guide mode");
      assert(scene.layout?.lessonId === 2 && Object.isFrozen(scene.layout) && scene.labEdit?.enabled === false &&
        scene.labEdit?.selectedComponentId === null && panel.hidden === true,
      "guide keeps canonical layout visible while all scene editing remains disabled");
      assert(ui.setReadOnlyGuideMode(false) === false && ui.isReadOnlyGuideIn3D() === false &&
        scene.layout === null,
      "explicit guide disable returns resulting inactive state and clears guide layout");
      assert(ui.setReadOnlyGuideMode(true) === true,
        "guide requires an explicit enable again after explicit disable");
      const authoredPair = Object.freeze({ from: "D13", to: "GND" });
      scene.setAuthoredPairGuide(authoredPair);
      const previewLayout = scene.layout;
      const previewLabEditCalls = scene.labEditCalls;
      const previewLayoutCalls = scene.layoutCalls;
      const previewPendingCalls = scene.pendingCalls;
      ui.setStage("3d");
      assert(ui.isReadOnlyGuideIn3D() === true && scene.layout === previewLayout &&
        scene.authoredPairGuide === authoredPair && scene.labEdit?.enabled === false &&
        scene.labEditCalls === previewLabEditCalls && scene.layoutCalls === previewLayoutCalls &&
        scene.pendingCalls === previewPendingCalls,
      "redundant same-stage 3D sync is a true no-op while read-only authored preview is active");

      ui.update();
      assert(ui.isReadOnlyGuideIn3D() === true && scene.layout === previewLayout &&
        scene.authoredPairGuide === authoredPair && scene.labEdit?.enabled === false,
      "idle controller refresh preserves read-only guide layout and authored pair overlay");
      const learnerProjection = createCircuit(2);
      scene.setWiring(learnerProjection);
      assert(scene.wiring === learnerProjection && scene.layout === previewLayout &&
        scene.authoredPairGuide === authoredPair && scene.labEdit?.enabled === false,
      "learner setWiring after guide does not unmount layout, clear overlay, or enable editing");
      if (nativeBrowserDom) {
        const HTMLElement = document.defaultView?.HTMLElement;
        assert(HTMLElement && panel instanceof HTMLElement && panel.isConnected && panel.hidden,
          "browser path proves guide uses the connected native DOM while editor panel stays hidden");
      }
      const list = panel.querySelector("[data-lab-precision-wire-list]");
      assert(list.querySelectorAll("[data-lab-wire-row]").length === 0 &&
        /chưa có dây/i.test(list.textContent),
      "missing learner graph renders canonical empty state instead of reference sample");
      const before = changes.length;
      const snapshot = ui.snapshot();
      const guideLayout = scene.layout;
      assert(snapshot.lessonId === 2 && snapshot.readOnlyGuideIn3D === true &&
        snapshot.circuit === null && changes.length === before,
      "guide snapshot/inspection does not create or mutate a learner draft");
      const missingLearnerInspection = ui.inspectCommittedWire("w1", wirePointerMeta(), 2);
      assert(missingLearnerInspection.accepted === false &&
        missingLearnerInspection.reason === "editor-not-active" && scene.highlightCalls === 0,
      "read-only guide cannot inspect a reference/sample wire while edit mode is off");

      const guideCallbacks = scene.labEdit;
      assert(guideCallbacks.onSelectComponent(null) === false &&
        guideCallbacks.onMoveComponent("R1", 1, 1, {}) === false &&
        guideCallbacks.onTerminalSelect("D13") === false &&
        guideCallbacks.onTerminalDragStart("D13", pointerMeta()) === false,
      "guide-disabled scene callbacks cannot select, move or arm terminal wiring");
      const guideLink = guideCallbacks.onTerminalLink("D13", "GND", pointerMeta());
      assert(guideLink.committed === false && guideLink.reason === "editor-not-active" &&
        ui.selectTerminal("D13") === null &&
        ui.connectTerminals("D13", "GND").committed === false &&
        ui.removeWire("w1", 2) === false,
      "guide blocks controller terminal, connect and remove mutation paths");
      for (const id of ["labConnect", "labSampleWires", "labClearWires", "labRemoveLastWire", "labResetPositions"]) {
        document.getElementById(id).click();
      }
      assert(changes.length === before && ui.snapshot().circuit === null && scene.pending === null &&
        scene.layout === guideLayout,
      "hidden edit actions cannot copy reference/sample data, reset layout, or write learner graph in guide mode");

      assert(ui.openEditor() === true && ui.isReadOnlyGuideIn3D() === false &&
        ui.isEditingIn3D() === true && scene.labEdit.enabled === true,
      "entering editor revokes guide before enabling normal edit callbacks");
      const noLearnerGraph = ui.inspectCommittedWire("w1", wirePointerMeta(), 2);
      assert(noLearnerGraph.accepted === false && noLearnerGraph.reason === "no-learner-graph" &&
        scene.highlightCalls === 0 && changes.length === before,
      "edit-mode inspection still refuses reference fallback when no learner graph exists");
      assert(ui.setReadOnlyGuideMode(true) === false && ui.isEditingIn3D() === true,
        "guide cannot be enabled over an active editor");
      assert(ui.closeEditor() === true && scene.layout === null && ui.isReadOnlyGuideIn3D() === false,
        "closing editor does not silently restore a prior guide layout");

      assert(ui.setReadOnlyGuideMode(true) === true && scene.layout?.lessonId === 2,
        "guide can be explicitly enabled again after editor closes");
      ui.setStage("wiring");
      assert(ui.isReadOnlyGuideIn3D() === false && scene.layout === null,
        "stage switch revokes guide and clears conceptual layout");
      assert(ui.setReadOnlyGuideMode(true) === false && scene.layout === null,
        "non-3D stage cannot enable guide mode");
      ui.setStage("3d");
      assert(ui.isReadOnlyGuideIn3D() === false && scene.layout === null,
        "returning to 3D does not auto-restore revoked guide mode");

      assert(ui.setReadOnlyGuideMode(true) === true, "guide re-enables explicitly before lesson switch");
      ui.setLesson(3);
      assert(ui.isReadOnlyGuideIn3D() === false && scene.layout === null,
        "lesson transition revokes guide and clears old canonical layout");
      ui.setLesson(1);
      assert(ui.setReadOnlyGuideMode(true) === false && scene.layout === null && scene.labEdit.enabled === false,
        "unsupported lesson cannot enter guide mode");

      ui.setLesson(2);
      assert(ui.setReadOnlyGuideMode(true) === true, "guide can re-enable for supported lesson");
      const replacementScene = makeScene();
      ui.setScene(replacementScene);
      assert(scene.layout === null && replacementScene.layout === null &&
        replacementScene.labEdit?.enabled === false && ui.isReadOnlyGuideIn3D() === false,
      "scene replacement revokes guide on both old and new scene contexts");
      assert(ui.setReadOnlyGuideMode(true) === true && replacementScene.layout?.lessonId === 2,
        "guide requires explicit re-enable on replacement scene");
      ui.setScene(null);
      assert(replacementScene.layout === null && ui.isReadOnlyGuideIn3D() === false &&
        ui.setReadOnlyGuideMode(true) === false,
      "scene loss revokes guide and a missing scene cannot enable it");
      const finalScene = makeScene();
      ui.setScene(finalScene);
      assert(ui.setReadOnlyGuideMode(true) === true && finalScene.layout?.lessonId === 2,
        "guide can explicitly enable after a fresh scene is attached");
      ui.dispose();
      assert(finalScene.layout === null && ui.isReadOnlyGuideIn3D() === false &&
        ui.setReadOnlyGuideMode(true) === false,
      "dispose revokes guide, clears its layout and prevents re-enable");
    });
  });

  check("pointer-drag-bridge-commits-only-valid-current-canonical-link", () => {
    const circuits = new Map([[2, createCircuit(2)], [3, createCircuit(3)]]);
    withFixture({ circuits }, ({ ui, scene, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      const callbacks2 = scene.labEdit;
      assert(typeof callbacks2.onTerminalLink === "function", "scene bridge exposes onTerminalLink");
      assert(typeof callbacks2.onTerminalDragStart === "function", "scene bridge exposes onTerminalDragStart");
      assert(callbacks2.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "legacy two-tap first terminal remains available");

      const changesBeforeForged = changes.length;
      const forged = callbacks2.onTerminalLink("D13", "GND", Object.freeze({
        source: "forged-pointer-drag", physicalVerified: false,
      }));
      assert(forged.committed === false && forged.reason === "invalid-meta" &&
        ui.snapshot().firstTerminal === "D13" && changes.length === changesBeforeForged,
      "forged link is graph- and pending-UI-side-effect free");

      assert(callbacks2.onTerminalDragStart("R1:B", Object.freeze({
        source: "pointer-drag", physicalVerified: false, forged: true,
      })) === false && ui.snapshot().firstTerminal === "D13" && changes.length === changesBeforeForged,
      "forged drag-start metadata cannot clear pending UI or mutate learner graph");

      assert(callbacks2.onTerminalDragStart("R1:B", pointerMeta()) === true &&
        ui.snapshot().firstTerminal === null && scene.pending === null && changes.length === changesBeforeForged &&
        circuits.get(2).wires.length === 0,
      "canonical drag start revokes stale two-tap pending state without graph mutation");
      // Simulate pointercancel/background drop: scene emits no terminal link.
      assert(callbacks2.onTerminalSelect("LED:A") === true &&
        ui.snapshot().firstTerminal === "LED:A" && changes.length === changesBeforeForged &&
        circuits.get(2).wires.length === 0,
      "after canceled drag, next tap only arms a new first terminal and cannot create a stale wire");
      assert(callbacks2.onTerminalSelect("LED:A") === true && ui.snapshot().firstTerminal === null,
        "same-terminal tap cancels the newly armed state before the next drag case");

      assert(callbacks2.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "legacy pending state can be armed again before a valid drag");
      assert(callbacks2.onTerminalDragStart("R1:B", pointerMeta()) === true &&
        ui.snapshot().firstTerminal === null,
      "valid drag start clears re-armed two-tap state before link completion");

      const committed = callbacks2.onTerminalLink("R1:B", "LED:A", pointerMeta());
      assert(Object.isFrozen(committed) && committed.accepted === true && committed.committed === true &&
        committed.reason === "connected" && committed.lessonId === 2 && committed.fromId === "R1:B" &&
        committed.toId === "LED:A" && committed.wireId === "w1" &&
        committed.learnerGraphOnly === true && committed.physicalVerified === false,
      "valid pointer drag returns truthful learner-only committed result");
      assert(ui.snapshot().firstTerminal === null && circuits.get(2).wires.length === 1 && changes.length === 1,
        "pointer drag revokes stale pending first terminal and commits one router wire");

      for (const [from, to, meta, reason] of [
        ["GND", "GND", pointerMeta(), "same-terminal"],
        ["NOPE", "GND", pointerMeta(), "invalid-terminal"],
        ["D13", "GND", Object.freeze({ source: "tap", physicalVerified: false }), "invalid-meta"],
        ["D13", "GND", Object.freeze({ source: "pointer-drag", physicalVerified: false, canceled: true }), "canceled"],
      ]) {
        const before = changes.length;
        const result = scene.labEdit.onTerminalLink(from, to, meta);
        assert(result.committed === false && result.accepted === false && result.reason === reason,
          "invalid pointer link rejected: " + reason);
        assert(changes.length === before, "invalid pointer link has no canonical side effect: " + reason);
      }
    });
  });

  check("stale-lesson-pointer-callback-cannot-clear-new-two-tap-state-or-commit", () => {
    const circuits = new Map([[2, createCircuit(2)], [3, createCircuit(3)]]);
    withFixture({ circuits }, ({ ui, scene, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      const staleLink = scene.labEdit.onTerminalLink;
      const staleDragStart = scene.labEdit.onTerminalDragStart;
      const staleWireInspect = scene.labEdit.onCommittedWireInspect;

      ui.setLesson(3);
      ui.openEditor();
      assert(scene.labEdit.onTerminalSelect("5V") === true && ui.snapshot().firstTerminal === "5V",
        "new lesson two-tap state armed");
      const before = changes.length;
      assert(staleDragStart("D13", pointerMeta()) === false && changes.length === before &&
        ui.snapshot().firstTerminal === "5V",
      "old-lesson drag-start callback cannot clear current pending state or mutate graph");
      const staleInspection = staleWireInspect("w1", wirePointerMeta());
      assert(staleInspection.accepted === false && staleInspection.reason === "stale-lesson" &&
        scene.highlightCalls === 0 && changes.length === before && ui.snapshot().firstTerminal === "5V",
      "old-lesson committed-wire inspection cannot highlight, clear pending state or mutate graph");
      const stale = staleLink("D13", "GND", pointerMeta());
      assert(stale.committed === false && stale.reason === "stale-lesson" && changes.length === before,
        "old scene callback rejected after lesson change");
      assert(ui.snapshot().firstTerminal === "5V" && circuits.get(3).wires.length === 0,
        "stale callback does not clear or mutate current lesson state");
    });
  });

  check("scene-callbacks-report-failure-truthfully-without-breaking-two-tap-cancel", () => {
    withFixture({ circuits: new Map([[2, createCircuit(2)]]) }, ({ ui, scene, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      const callbacks = scene.labEdit;
      assert(callbacks.onSelectComponent("NO-SUCH-COMPONENT") === false,
        "invalid scene component selection reports false");
      assert(callbacks.onMoveComponent("NO-SUCH-COMPONENT", 1, 1, {}) === false,
        "invalid scene move reports false");
      assert(callbacks.onTerminalSelect("NO-SUCH-TERMINAL") === false,
        "invalid scene terminal selection reports false");

      ui.setStage("wiring");
      assert(callbacks.onSelectComponent(null) === false &&
        callbacks.onMoveComponent("NO-SUCH-COMPONENT", 1, 1, {}) === false &&
        callbacks.onTerminalSelect("D13") === false,
      "stale scene callbacks outside 3D report false and do not act");
      ui.setStage("3d");

      assert(callbacks.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "first tap arms terminal without graph mutation");
      assert(callbacks.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === null && changes.length === 0,
        "second tap on same terminal preserves legacy cancel behavior with no wire");

      assert(callbacks.onTerminalSelect("D13") === true, "re-arm first terminal");
      assert(callbacks.onTerminalSelect("R1:A") === true && changes.length === 1 &&
        circuitsFrom(changes).wires[0].from === "D13" && circuitsFrom(changes).wires[0].to === "R1:A",
      "second distinct tap still commits via existing router path");
    });

    const repairNegativeCircuits=new Map([[2,createCircuit(2)]]);
    withFixture({circuits:repairNegativeCircuits},({ui,scene,changes,document,message})=>{
      ui.setLesson(2);
      const toggle=document.getElementById("labEditToggle");
      toggle.focus({preventScroll:true});
      const initialCircuit=repairNegativeCircuits.get(2);
      const initialMessage=message.textContent;
      const stale=ui.preparePracticeRepairPair("D13","R1:A",3);
      assert(Object.isFrozen(stale) && stale.accepted === false && stale.reason === "stale-lesson" &&
        stale.committed === false && stale.physicalVerified === false &&
        changes.length === 0 && repairNegativeCircuits.get(2) === initialCircuit &&
        ui.snapshot().firstTerminal === null && scene.pending === null &&
        document.activeElement === toggle && message.textContent === initialMessage,
      "stale Practice repair request is graph/focus/status/pending side-effect free");
      const disabled=ui.preparePracticeRepairPair("D13","R1:A",2);
      assert(disabled.accepted === false && disabled.reason === "editor-not-active" &&
        changes.length === 0 && repairNegativeCircuits.get(2) === initialCircuit &&
        ui.snapshot().firstTerminal === null && scene.pending === null &&
        document.activeElement === toggle && message.textContent === initialMessage,
      "disabled editor rejects Practice repair without stale pointer or mutation");

      assert(ui.openEditor() === true,"repair negative fixture opens current 3D editor");
      const activeMessage=message.textContent;
      const activeFocus=document.activeElement;
      const same=ui.preparePracticeRepairPair("D13","D13",2);
      const foreign=ui.preparePracticeRepairPair("NOPE","R1:A",2);
      assert(same.accepted === false && same.reason === "same-terminal" &&
        foreign.accepted === false && foreign.reason === "invalid-terminal" &&
        changes.length === 0 && repairNegativeCircuits.get(2) === initialCircuit &&
        ui.snapshot().firstTerminal === null && scene.pending === null &&
        document.activeElement === activeFocus && message.textContent === activeMessage,
      "same/foreign Practice repair endpoints reject before focus, pending, graph or status mutation");
    });

    const repairCircuits=new Map([[2,createCircuit(2)]]);
    withFixture({circuits:repairCircuits},({ui,scene,changes,document,message})=>{
      ui.setLesson(2);
      ui.openEditor();
      assert(scene.labEdit.onTerminalSelect("LED:K") === true &&
        ui.snapshot().firstTerminal === "LED:K" && scene.pending === "LED:K",
      "accepted Practice repair fixture starts with an unrelated pending terminal");
      const circuitBefore=repairCircuits.get(2);
      const historyBefore=ui.snapshot();
      const prepared=ui.preparePracticeRepairPair("D13","R1:A",2);
      const connect=document.getElementById("labConnect");
      assert(Object.isFrozen(prepared) && Reflect.ownKeys(prepared).length === 7 &&
        prepared.accepted === true && prepared.reason === "prepared" &&
        prepared.lessonId === 2 && prepared.fromId === "D13" && prepared.toId === "R1:A" &&
        prepared.committed === false && prepared.physicalVerified === false,
      "Practice repair returns exact frozen noncommitting prepare receipt");
      assert(document.getElementById("labFromPin").value === "D13" &&
        document.getElementById("labToPin").value === "R1:A" &&
        document.activeElement === connect && connect.disabled !== true &&
        ui.snapshot().firstTerminal === null && scene.pending === null,
      "Practice repair fills existing native selects, clears stale pending pointer, and focuses existing Connect");
      const afterPrepare=ui.snapshot();
      assert(changes.length === 0 && repairCircuits.get(2) === circuitBefore &&
        circuitBefore.wires.length === 0 &&
        afterPrepare.layout === historyBefore.layout &&
        afterPrepare.layoutUndoDepth === historyBefore.layoutUndoDepth &&
        afterPrepare.layoutRedoDepth === historyBefore.layoutRedoDepth,
      "Practice repair preparation creates no learner graph or layout/history mutation");
      assert(/phải bấm Connect/i.test(message.textContent) &&
        /chưa có dây.*tạo|chưa có dây nào được tạo/i.test(message.textContent),
      "Practice repair announcement makes explicit that learner must click Connect and nothing auto-connects");
    });

    const rerouteBase=connectCircuit(createCircuit(2),"D13","R1:A");
    const rerouteCircuits=new Map([[2,rerouteBase]]);
    withFixture({circuits:rerouteCircuits},({ui,scene,changes})=>{
      ui.setLesson(2);
      const inactive=ui.reroutePracticeWire("w1","D13","R1:A","D13","R1:B",2);
      assert(inactive.accepted === false && inactive.committed === false &&
        inactive.reason === "editor-not-active" && changes.length === 0 &&
        rerouteCircuits.get(2) === rerouteBase,
      "inactive editor rejects Practice reroute before any learner graph write");
      ui.openEditor();
      const historyBefore=ui.snapshot();
      const stale=ui.reroutePracticeWire("w1","D13","R1:A","D13","R1:B",3);
      assert(Object.isFrozen(stale) && stale.accepted === false && stale.committed === false &&
        stale.reason === "stale-lesson" && changes.length === 0 && rerouteCircuits.get(2) === rerouteBase,
      "stale Practice reroute rejects atomically before learner graph write");
      const sameRoute=ui.reroutePracticeWire("w1","R1:A","D13","D13","R1:A",2);
      assert(sameRoute.accepted === false && sameRoute.committed === false &&
        sameRoute.reason === "same-route" && changes.length === 0 && rerouteCircuits.get(2) === rerouteBase,
      "reroute to the replaced original endpoint is an atomic no-op");
      const invalidAnchor=ui.reroutePracticeWire("w1","D13","R1:A","LED:A","R1:B",2);
      assert(invalidAnchor.accepted === false && invalidAnchor.committed === false &&
        invalidAnchor.reason === "invalid-anchor" && changes.length === 0 &&
        rerouteCircuits.get(2) === rerouteBase,
      "reroute anchor must be one exact endpoint of the live original wire");
      assert(scene.labEdit.onTerminalSelect("LED:K") === true &&
        ui.snapshot().firstTerminal === "LED:K" && scene.pending === "LED:K",
      "successful reroute fixture arms an unrelated pending terminal");
      const rerouted=ui.reroutePracticeWire("w1","R1:A","D13","D13","R1:B",2);
      const after=rerouteCircuits.get(2);
      assert(Object.isFrozen(rerouted) && Reflect.ownKeys(rerouted).length === 9 &&
        rerouted.accepted === true && rerouted.committed === true && rerouted.reason === "rerouted" &&
        rerouted.lessonId === 2 && rerouted.oldWireId === "w1" && rerouted.newWireId === "w2" &&
        rerouted.anchorTerminalId === "D13" && rerouted.newTargetId === "R1:B" &&
        rerouted.physicalVerified === false,
      "successful Practice reroute returns exact frozen old/new router-wire receipt");
      assert(changes.length === 1 && after !== rerouteBase && after.wires.length === 1 &&
        after.wires[0].id === "w2" && after.wires[0].from === "D13" && after.wires[0].to === "R1:B" &&
        !after.wires.some(wire=>wire.id === "w1") &&
        ui.snapshot().firstTerminal === null && scene.pending === null,
      "successful Practice reroute performs one canonical onCircuitChange, replaces router ID, and clears stale pending intent");
      const historyAfter=ui.snapshot();
      assert(historyAfter.layout === historyBefore.layout &&
        historyAfter.layoutUndoDepth === historyBefore.layoutUndoDepth &&
        historyAfter.layoutRedoDepth === historyBefore.layoutRedoDepth,
      "Practice reroute does not create conceptual layout/history steps");
    });

    const duplicateBase=connectCircuit(
      connectCircuit(createCircuit(2),"D13","R1:A"),
      "D13","R1:B",
    );
    const duplicateCircuits=new Map([[2,duplicateBase]]);
    withFixture({circuits:duplicateCircuits},({ui,changes})=>{
      ui.setLesson(2);
      ui.openEditor();
      const before=ui.snapshot();
      const duplicate=ui.reroutePracticeWire("w1","D13","R1:A","D13","R1:B",2);
      const after=ui.snapshot();
      assert(Object.isFrozen(duplicate) && duplicate.accepted === false && duplicate.committed === false &&
        duplicate.reason === "router-rejected" && changes.length === 0 &&
        duplicateCircuits.get(2) === duplicateBase && duplicateBase.wires.length === 2,
      "duplicate-target Practice reroute fails atomically with original graph object untouched");
      assert(after.layout === before.layout && after.layoutUndoDepth === before.layoutUndoDepth &&
        after.layoutRedoDepth === before.layoutRedoDepth,
      "duplicate reroute rejection leaves conceptual layout/history unchanged");
    });

    const reusedRerouteInitial=connectCircuit(createCircuit(2),"D13","R1:A");
    const reusedRerouteCurrent=connectCircuit(createCircuit(2),"R1:B","LED:A");
    const reusedRerouteCircuits=new Map([[2,reusedRerouteInitial]]);
    withFixture({circuits:reusedRerouteCircuits},({ui,changes})=>{
      ui.setLesson(2);
      ui.openEditor();
      reusedRerouteCircuits.set(2,reusedRerouteCurrent);
      const staleEndpoints=ui.reroutePracticeWire("w1","D13","R1:A","D13","GND",2);
      assert(staleEndpoints.accepted === false && staleEndpoints.committed === false &&
        staleEndpoints.reason === "wire-endpoints-mismatch" && changes.length === 0 &&
        reusedRerouteCircuits.get(2) === reusedRerouteCurrent,
      "reused canonical w1 with different live endpoints rejects stale original endpoint receipt atomically");
      const current=ui.reroutePracticeWire("w1","LED:A","R1:B","R1:B","GND",2);
      assert(current.accepted === true && current.committed === true &&
        current.oldWireId === "w1" && current.newWireId === "w2" &&
        changes.length === 1 && reusedRerouteCircuits.get(2).wires[0].id === "w2",
      "reused wire ID can reroute only after exact current unordered endpoints are supplied");
    });

    const authoredCircuits = new Map([[2, createCircuit(2)], [3, createCircuit(3)]]);
    withFixture({ circuits: authoredCircuits }, ({
      ui, scene, changes, message, nativeBrowserDom,
    }) => {
      ui.setLesson(2);
      ui.openEditor();
      assert(typeof ui.connectAuthoredHoleTerminals === "function",
        "controller exposes authored-hole confirmation entrypoint");
      assert(ui.selectTerminal("D13") === "D13" && ui.snapshot().firstTerminal === "D13" && scene.pending === "D13",
        "authored-hole fixture arms existing two-tap pending terminal");
      const baselineMessage = message.textContent;
      const baselineCircuit = authoredCircuits.get(2);
      const baselineChanges = changes.length;
      const assertNoSideEffect = (result, reason, label) => {
        assert(Object.isFrozen(result) && result.accepted === false && result.committed === false &&
          result.reason === reason && result.learnerGraphOnly === true && result.physicalVerified === false,
        label + " returns frozen learner-only rejection");
        assert(changes.length === baselineChanges && authoredCircuits.get(2) === baselineCircuit &&
          ui.snapshot().firstTerminal === "D13" && scene.pending === "D13" &&
          message.textContent === baselineMessage,
        label + " has no graph/callback/pending/status side effect");
      };

      assertNoSideEffect(
        ui.connectAuthoredHoleTerminals("D13", "R1:A", authoredHoleMeta(), 3),
        "stale-lesson",
        "stale lesson",
      );
      assertNoSideEffect(
        ui.connectAuthoredHoleTerminals("D13", "R1:A", authoredHoleMeta(), "2"),
        "stale-lesson",
        "non-integer expected lesson",
      );
      assertNoSideEffect(
        ui.connectAuthoredHoleTerminals("BTN:1", "R1:A", authoredHoleMeta(), 2),
        "invalid-terminal",
        "foreign lesson terminal",
      );
      assertNoSideEffect(
        ui.connectAuthoredHoleTerminals("D13", "D13", authoredHoleMeta(), 2),
        "same-terminal",
        "same canonical terminal",
      );

      const accessorMeta={};
      Object.defineProperties(accessorMeta,{
        source:{get(){throw new Error("source getter must not execute");},enumerable:true,configurable:true},
        physicalVerified:{value:false,enumerable:true,configurable:true,writable:true},
        profileId:{value:"generic-63x10-terminal-strips",enumerable:true,configurable:true,writable:true},
        fromHoleId:{value:"A1",enumerable:true,configurable:true,writable:true},
        toHoleId:{value:"J63",enumerable:true,configurable:true,writable:true},
        placementRevision:{value:0,enumerable:true,configurable:true,writable:true},
      });
      Object.freeze(accessorMeta);
      const customProtoMeta=Object.freeze(Object.assign(Object.create({ forged:true }),{
        source:"authored-hole-confirm",physicalVerified:false,
        profileId:"generic-63x10-terminal-strips",fromHoleId:"A1",toHoleId:"J63",placementRevision:0,
      }));
      const nullProtoMeta=Object.freeze(Object.assign(Object.create(null),{
        source:"authored-hole-confirm",physicalVerified:false,
        profileId:"generic-63x10-terminal-strips",fromHoleId:"A1",toHoleId:"J63",placementRevision:0,
      }));
      const symbolMeta=Object.freeze({
        source:"authored-hole-confirm",physicalVerified:false,
        profileId:"generic-63x10-terminal-strips",fromHoleId:"A1",toHoleId:"J63",placementRevision:0,
        [Symbol("forged")]:true,
      });
      const invalidMetaCases=[
        [{...authoredHoleMeta()}, "unfrozen"],
        [Object.freeze({...authoredHoleMeta(), extra:true}), "extra key"],
        [accessorMeta, "accessor"],
        [customProtoMeta, "custom prototype"],
        [nullProtoMeta, "null prototype"],
        [symbolMeta, "symbol key"],
        [authoredHoleMeta({source:"pointer-drag"}), "wrong source"],
        [authoredHoleMeta({physicalVerified:true}), "physical verification claim"],
        [authoredHoleMeta({profileId:"unknown-profile"}), "unknown profile"],
        [authoredHoleMeta({fromHoleId:"A0"}), "hole zero"],
        [authoredHoleMeta({fromHoleId:"A01"}), "hole leading zero"],
        [authoredHoleMeta({fromHoleId:"K1"}), "row outside A-J"],
        [authoredHoleMeta({toHoleId:"J64"}), "column above 63"],
        [authoredHoleMeta({toHoleId:"A1"}), "same hole"],
        [authoredHoleMeta({placementRevision:-1}), "negative revision"],
        [authoredHoleMeta({placementRevision:1.5}), "fractional revision"],
        [authoredHoleMeta({placementRevision:Number.MAX_SAFE_INTEGER+1}), "unsafe revision"],
      ];
      for(const [meta,label] of invalidMetaCases){
        assertNoSideEffect(
          ui.connectAuthoredHoleTerminals("D13","R1:A",meta,2),
          "invalid-meta",
          "invalid meta " + label,
        );
      }

      ui.setStage("wiring");
      const offStageCircuit=authoredCircuits.get(2);
      const offStageChanges=changes.length;
      const offStagePending=ui.snapshot().firstTerminal;
      const offStageScenePending=scene.pending;
      const offStageMessage=message.textContent;
      const offStageResult=ui.connectAuthoredHoleTerminals("D13","R1:A",authoredHoleMeta(),2);
      assert(Object.isFrozen(offStageResult) && offStageResult.accepted === false &&
        offStageResult.committed === false && offStageResult.reason === "editor-not-active" &&
        changes.length === offStageChanges && authoredCircuits.get(2) === offStageCircuit &&
        ui.snapshot().firstTerminal === offStagePending && scene.pending === offStageScenePending &&
        message.textContent === offStageMessage,
      "non-3D API rejection adds no graph/callback/pending/status side effect after stage switch");
      ui.setStage("3d");
      ui.setScene(null);
      const noSceneCircuit=authoredCircuits.get(2);
      const noSceneChanges=changes.length;
      const noScenePending=ui.snapshot().firstTerminal;
      const noSceneMessage=message.textContent;
      const noSceneResult=ui.connectAuthoredHoleTerminals("D13","R1:A",authoredHoleMeta(),2);
      assert(Object.isFrozen(noSceneResult) && noSceneResult.accepted === false &&
        noSceneResult.committed === false && noSceneResult.reason === "scene-required" &&
        changes.length === noSceneChanges && authoredCircuits.get(2) === noSceneCircuit &&
        ui.snapshot().firstTerminal === noScenePending && message.textContent === noSceneMessage,
      "missing-scene API rejection adds no graph/callback/pending/status side effect");
      ui.setScene(scene);
      assert(ui.selectTerminal("D13") === "D13" && ui.snapshot().firstTerminal === "D13" &&
        scene.pending === "D13",
      "valid authored-hole commit starts from the existing pending-terminal state");

      const beforeLayoutDepth=ui.snapshot().layoutUndoDepth;
      const accepted=ui.connectAuthoredHoleTerminals(
        "D13","R1:A",
        authoredHoleMeta({
          profileId:"busboard-bb830-rev7",
          fromHoleId:"A1",
          toHoleId:"J63",
          placementRevision:7,
        }),
        2,
      );
      assert(Object.isFrozen(accepted) && accepted.accepted === true && accepted.committed === true &&
        accepted.reason === "connected" && accepted.lessonId === 2 &&
        accepted.fromId === "D13" && accepted.toId === "R1:A" && accepted.wireId === "w1" &&
        accepted.learnerGraphOnly === true && accepted.physicalVerified === false &&
        Reflect.ownKeys(accepted).length === 9 &&
        !Object.hasOwn(accepted,"profileId") && !Object.hasOwn(accepted,"fromHoleId") &&
        !Object.hasOwn(accepted,"toHoleId") && !Object.hasOwn(accepted,"placementRevision"),
      "valid authored-hole confirmation returns existing truthful committed receipt");
      assert(changes.length === baselineChanges+1 && authoredCircuits.get(2).wires.length === 1 &&
        authoredCircuits.get(2).wires[0].from === "D13" && authoredCircuits.get(2).wires[0].to === "R1:A" &&
        ui.snapshot().firstTerminal === null && scene.pending === null &&
        ui.snapshot().layoutUndoDepth === beforeLayoutDepth,
      "valid authored-hole confirmation delegates to canonical learner graph without layout-history write");

      const committedCircuit=authoredCircuits.get(2);
      const duplicate=ui.connectAuthoredHoleTerminals("D13","R1:A",authoredHoleMeta({placementRevision:8}),2);
      assert(Object.isFrozen(duplicate) && duplicate.accepted === false && duplicate.committed === false &&
        duplicate.reason === "router-rejected" && changes.length === baselineChanges+1 &&
        authoredCircuits.get(2) === committedCircuit && authoredCircuits.get(2).wires.length === 1,
      "duplicate authored-hole confirmation remains canonical router no-op");
      if(nativeBrowserDom){
        const HTMLElement=globalThis.window?.HTMLElement;
        assert(HTMLElement && message instanceof HTMLElement,
          "native browser direct contract runs against real DOM status node");
      }else{
        assert(message instanceof FakeNode,
          "Bun direct contract runs against fake DOM status node");
      }
    });

    const lesson10Circuit=createCircuit(10);
    withFixture({circuits:new Map([[10,lesson10Circuit]])},({ui,changes})=>{
      ui.setLesson(10);
      assert(ui.openEditor() === true && changes.length === 0,
        "opening lesson 10 does not auto-create authored-hole learner mutations");
      const trail10=buildPracticeCheckpointTrail({
        lesson:lessonById(10),currentStepIndex:0,circuit:lesson10Circuit,
      });
      assert(trail10.lessonScope === "signal-only" && trail10.claims.signalOnly === true &&
        trail10.steps.every(step=>step.kind === "manual" && step.scope === "manual") &&
        trail10.claims.mutationPerformed === false,
      "lesson 10 remains signal-only with all authored practice steps manual-only");
    });

    const lesson14Circuits=new Map([[14,createCircuit(14)]]);
    withFixture({circuits:lesson14Circuits},({ui,changes})=>{
      ui.setLesson(14);
      ui.openEditor();
      const result=ui.connectAuthoredHoleTerminals(
        "A0","SOIL:SIG",
        authoredHoleMeta({
          profileId:"busboard-bb830-rev7",
          fromHoleId:"C3",
          toHoleId:"H61",
          placementRevision:14,
        }),
        14,
      );
      const analysis=changes.at(-1)?.analysis;
      const trail14=buildPracticeCheckpointTrail({
        lesson:lessonById(14),currentStepIndex:0,circuit:lesson14Circuits.get(14),
      });
      assert(result.accepted === true && result.committed === true && changes.length === 1 &&
        analysis?.scope === "signal-only" && analysis.functional === false && analysis.ok === false &&
        trail14.lessonScope === "signal-only" && trail14.claims.signalOnly === true &&
        trail14.steps[0].kind === "wiring" && trail14.steps[0].scope === "signal-only" &&
        trail14.steps.slice(1).every(step=>step.kind === "manual" && step.scope === "manual"),
      "lesson 14 authored-hole route preserves signal-only and manual-step practice boundaries");
    });

    for(const [lessonId,from,to,anchor,newTarget] of [
      [10,"D9","DRV:ENA","D9","DRV:IN1"],
      [14,"A0","SOIL:SIG","A0","PUMP:IN"],
    ]){
      const initial=connectCircuit(createCircuit(lessonId),from,to);
      const circuits=new Map([[lessonId,initial]]);
      withFixture({circuits},({ui,changes})=>{
        ui.setLesson(lessonId);
        ui.openEditor();
        const rerouted=ui.reroutePracticeWire("w1",to,from,anchor,newTarget,lessonId);
        const analysis=changes.at(-1)?.analysis;
        const trail=buildPracticeCheckpointTrail({
          lesson:lessonById(lessonId),currentStepIndex:0,circuit:circuits.get(lessonId),
        });
        assert(rerouted.accepted === true && rerouted.committed === true &&
          rerouted.oldWireId === "w1" && rerouted.newWireId === "w2" &&
          changes.length === 1 && analysis?.scope === "signal-only" &&
          analysis.functional === false && analysis.ok === false &&
          trail.lessonScope === "signal-only" && trail.claims.autoCompletion === false &&
          trail.claims.mastery === false && trail.claims.physicalVerified === false,
        "lesson " + lessonId + " Practice reroute preserves signal-only and never upgrades completion/mastery/physics");
        if(lessonId===10){
          assert(trail.steps.every(step=>step.kind === "manual" && step.scope === "manual"),
            "lesson 10 Practice reroute cannot change all-manual authored checkpoint restrictions");
        }else{
          assert(trail.steps[0].kind === "wiring" && trail.steps[0].scope === "signal-only" &&
            trail.steps.slice(1).every(step=>step.kind === "manual" && step.scope === "manual"),
          "lesson 14 Practice reroute preserves existing signal-only wiring/manual split");
        }
      });
    }

    withFixture({circuits:new Map()},({ui,changes})=>{
      ui.setLesson(1);
      const result=ui.connectAuthoredHoleTerminals("D13","GND",authoredHoleMeta(),1);
      const reroute=ui.reroutePracticeWire("w1","D13","GND","D13","D2",1);
      const trail1=buildPracticeCheckpointTrail({
        lesson:lessonById(1),currentStepIndex:0,circuit:null,
      });
      assert(Object.isFrozen(result) && result.accepted === false && result.committed === false &&
        result.reason === "unsupported-lesson" && changes.length === 0 && ui.openEditor() === false &&
        Object.isFrozen(reroute) && reroute.accepted === false && reroute.committed === false &&
        reroute.reason === "unsupported-lesson" &&
        trail1.lessonScope === "manual-only" && trail1.steps.every(step=>step.scope === "manual") &&
        trail1.claims.mutationPerformed === false,
      "lesson 1 remains unsupported/manual-only and cannot gain or reroute a learner graph");
    });

    const learnerCircuit = connectCircuit(createCircuit(2), "D13", "R1:A");
    const layoutCircuits = new Map([[2, learnerCircuit], [3, createCircuit(3)]]);
    withFixture({ circuits: layoutCircuits }, ({ ui, scene, changes, layoutChanges, reconciliations, panel, document }) => {
      ui.setLesson(2);
      ui.openEditor();
      const initial = ui.snapshot();
      const initialLayout = initial.layout;
      const movable = initialLayout.components.find(item => !item.fixed && item.id !== "breadboard") ||
        initialLayout.components.find(item => !item.fixed);
      assert(movable, "layout history fixture has a movable conceptual component");
      ui.selectComponent(movable.id);
      assert(ui.snapshot().selectedId === movable.id, "layout history fixture selects movable component");

      assert(scene.labEdit.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "layout mutation fixture arms pending terminal before placement change");
      let moved = false;
      for (const dx of [1.5, -1.5, 3, -3]) {
        if (scene.labEdit.onMoveComponent(movable.id, movable.x + dx, movable.z, {})) {
          moved = true;
          break;
        }
      }
      assert(moved, "accepted conceptual move creates a layout transition");
      const afterMove = ui.snapshot();
      const movedComponent = afterMove.layout.components.find(item => item.id === movable.id);
      assert(afterMove.layout !== initialLayout && afterMove.canUndoLayout === true &&
        afterMove.canRedoLayout === false && afterMove.layoutUndoDepth === 1 && afterMove.layoutRedoDepth === 0,
      "accepted move exposes one bounded undo transition");
      assert(afterMove.selectedId === movable.id && afterMove.firstTerminal === null && scene.pending === null,
        "accepted layout move preserves selected component and clears pending terminal intent");
      assert(layoutChanges.length === 1 && layoutChanges[0].layout === afterMove.layout &&
        layoutChanges[0].lessonId === 2 && reconciliations.length === 0 &&
        changes.length === 0 && layoutCircuits.get(2) === learnerCircuit,
      "layout move notifies onLayoutChange only and leaves learner graph/history input untouched");

      const depthBeforeNoop = afterMove.layoutUndoDepth;
      const layoutChangesBeforeNoop = layoutChanges.length;
      assert(scene.labEdit.onMoveComponent(movable.id, movedComponent.x, movedComponent.z, {}) === false,
        "exact no-op move is rejected");
      assert(scene.labEdit.onMoveComponent(movable.id, Number.NaN, movedComponent.z, {}) === false,
        "invalid non-finite move is rejected");
      assert(scene.labEdit.onMoveComponent(movable.id, 0, 0, {
        kind: "rotate", deltaQuarterTurns: 0,
      }) === false, "zero-turn rotation is rejected as a no-op history transition");
      assert(scene.labEdit.onMoveComponent(movable.id, 0, 0, {
        kind: "rotate", deltaQuarterTurns: 0.5,
      }) === false, "invalid fractional rotation is rejected without history transition");
      const afterRejectedMoves = ui.snapshot();
      assert(afterRejectedMoves.layoutUndoDepth === depthBeforeNoop &&
        layoutChanges.length === layoutChangesBeforeNoop && changes.length === 0,
      "no-op/invalid moves create no history or graph side effects");

      const undoButton = panel.querySelector("[data-lab-layout-undo]");
      const redoButton = panel.querySelector("[data-lab-layout-redo]");
      assert(!undoButton.disabled && redoButton.disabled &&
        undoButton.getAttribute("aria-disabled") === "false" && redoButton.getAttribute("aria-disabled") === "true",
      "layout history native controls mirror move history availability");
      undoButton.focus({ preventScroll: true });
      undoButton.click();
      const afterUndo = ui.snapshot();
      assert(document.activeElement === redoButton && !redoButton.disabled && undoButton.disabled &&
        afterUndo.layout === initialLayout &&
        afterUndo.selectedId === movable.id && afterUndo.canUndoLayout === false && afterUndo.canRedoLayout === true,
      "native last-undo restores exact layout and transfers focus to enabled Redo");
      assert(layoutChanges.length === layoutChangesBeforeNoop + 1 && changes.length === 0 &&
        layoutCircuits.get(2) === learnerCircuit,
      "undo notifies layout observers without learner graph/history write");

      redoButton.focus({ preventScroll: true });
      redoButton.click();
      const afterRedo = ui.snapshot();
      assert(document.activeElement === undoButton && !undoButton.disabled && redoButton.disabled &&
        afterRedo.layout === afterMove.layout &&
        afterRedo.selectedId === movable.id && afterRedo.canUndoLayout === true && afterRedo.canRedoLayout === false,
      "native last-redo restores exact layout and transfers focus to enabled Undo");

      assert(scene.labEdit.onTerminalSelect("D13") === true && ui.snapshot().firstTerminal === "D13",
        "pending terminal can be armed before undo restore");
      assert(ui.undoLayout() === true && ui.snapshot().firstTerminal === null && scene.pending === null,
        "programmatic undo clears pending terminal intent when layout changes");
      assert(ui.snapshot().canRedoLayout === true, "undo exposes redo before divergent edit");
      assert(scene.labEdit.onMoveComponent(movable.id, movable.x, movable.z, {
        kind: "rotate", deltaQuarterTurns: 1,
      }) === true,
      "accepted rotate creates divergent layout transition after undo");
      const divergent = ui.snapshot();
      assert(divergent.canRedoLayout === false && divergent.layoutRedoDepth === 0 &&
        divergent.canUndoLayout === true && ui.redoLayout() === false,
      "divergent accepted edit clears redo branch");

      ui.setStage("wiring");
      const offStage = ui.snapshot();
      assert(offStage.canUndoLayout === true && ui.undoLayout() === false,
        "stage switch preserves layout history but blocks undo outside 3D");
      ui.setStage("3d");
      assert(ui.snapshot().canUndoLayout === true,
        "returning to 3D preserves conceptual layout history");
      ui.closeEditor();
      assert(ui.snapshot().canUndoLayout === true && ui.undoLayout() === false &&
        undoButton.disabled && undoButton.getAttribute("aria-disabled") === "true",
      "editing off preserves history but disables native/programmatic undo");
      ui.openEditor();
      assert(ui.snapshot().canUndoLayout === true && !undoButton.disabled,
        "reopening editor re-enables preserved layout undo history");

      const replacementScene = makeScene();
      ui.setScene(replacementScene);
      assert(ui.snapshot().canUndoLayout === true,
        "scene replacement preserves history with existing conceptual layout semantics");
      ui.setLesson(3);
      const newLesson = ui.snapshot();
      assert(newLesson.canUndoLayout === false && newLesson.canRedoLayout === false &&
        newLesson.layoutUndoDepth === 0 && newLesson.layoutRedoDepth === 0,
      "lesson context switch resets conceptual layout history");
    });

    const rollbackCircuit = connectCircuit(createCircuit(2), "D13", "R1:A");
    const rollbackCircuits = new Map([[2, rollbackCircuit]]);
    let rollbackScene = null;
    let observerSawRestoredScene = false;
    withFixture({
      circuits: rollbackCircuits,
      onSceneReconciled: (layout, meta, reconciledLessonId) => {
        observerSawRestoredScene = rollbackScene?.layout === layout &&
          meta.reason === "layout-rollback" && meta.operation === "move" &&
          meta.componentId === "breadboard" && meta.physicalVerified === false &&
          reconciledLessonId === 2;
      },
    }, ({ ui, scene, changes, layoutChanges, reconciliations, document, message }) => {
      rollbackScene = scene;
      ui.setLesson(2);
      ui.openEditor();
      ui.selectComponent("breadboard");
      const before = ui.snapshot();
      const beforeLayoutCalls = scene.layoutCalls;
      const posX = document.getElementById("labPositionX");
      const posZ = document.getElementById("labPositionZ");
      const place = document.getElementById("labPlace");
      assert(posX.max === "10" && posX.min === "-10" && posZ.value === "0",
        "rollback fixture uses the rendered native conceptual coordinate bounds");
      posX.value = "999";
      posZ.value = "0";
      place.click();
      const after = ui.snapshot();
      assert(reconciliations.length === 1 && observerSawRestoredScene === true &&
        scene.layoutCalls === beforeLayoutCalls + 1 && scene.layout === before.layout,
      "invalid native Place restores scene first, then emits exactly one rollback observer");
      const rollback = reconciliations[0];
      assert(rollback.layout === before.layout && rollback.lessonId === 2 && Object.isFrozen(rollback.meta) &&
        Reflect.ownKeys(rollback.meta).length === 4 && rollback.meta.reason === "layout-rollback" &&
        rollback.meta.operation === "move" && rollback.meta.componentId === "breadboard" &&
        rollback.meta.physicalVerified === false,
      "rollback observer receives exact frozen non-authoritative reconciliation metadata");
      assert(layoutChanges.length === 0 && changes.length === 0 && rollbackCircuits.get(2) === rollbackCircuit &&
        after.layout === before.layout && after.layoutUndoDepth === before.layoutUndoDepth &&
        after.layoutRedoDepth === before.layoutRedoDepth,
      "rejected Place creates no accepted layout history, learner graph, or learner-history mutation");
      assert(message.dataset.kind === "error" &&
        /Không thể đặt linh kiện/.test(message.textContent) && /ngoài giới hạn bố trí/.test(message.textContent),
      "source move error feedback remains visible after scene reconciliation");
    });

    const primeSequenceCircuit = connectCircuit(createCircuit(2), "D13", "R1:A");
    const primeSequenceCircuits = new Map([[2, primeSequenceCircuit]]);
    withFixture({ circuits: primeSequenceCircuits }, ({
      ui, scene, changes, layoutChanges, panel, document, nativeBrowserDom,
    }) => {
      ui.setLesson(2);
      ui.openEditor();
      ui.selectComponent("breadboard");
      const undoButton = panel.querySelector("[data-lab-layout-undo]");
      const redoButton = panel.querySelector("[data-lab-layout-redo]");
      const activateNativeHistoryButton = button => {
        const beforeLayoutChanges = layoutChanges.length;
        button.focus({ preventScroll: true });
        if (!nativeBrowserDom) {
          assert((button.listeners.get("keydown") ?? []).length === 0,
            "layout history button has no custom keydown handler; native Enter semantics own activation");
          button.pressEnter();
        } else {
          // HTMLElement.click() intentionally returns undefined in browsers.
          // Prove activation by the observable layout restore + retained focus,
          // not by a fake-DOM-only click return value.
          button.click();
        }
        const reciprocal = button === undoButton ? redoButton : undoButton;
        const expectedFocus = button.disabled ? reciprocal : button;
        return layoutChanges.length === beforeLayoutChanges + 1 &&
          expectedFocus.disabled === false && document.activeElement === expectedFocus;
      };

      const initial = ui.snapshot();
      const initialBreadboard = initial.layout.components.find(item => item.id === "breadboard");
      assert(initialBreadboard.x === -1 && initialBreadboard.z === 0 && initialBreadboard.quarterTurns === 0,
        "prime sequence starts from canonical breadboard -1/0/0° layout");
      assert(scene.labEdit.onMoveComponent("breadboard", 0, 0, {}) === true,
        "prime sequence accepts breadboard move x -1 -> 0");
      const afterMove = ui.snapshot();
      const movedBreadboard = afterMove.layout.components.find(item => item.id === "breadboard");
      assert(movedBreadboard.x === 0 && movedBreadboard.z === 0 && movedBreadboard.quarterTurns === 0 &&
        afterMove.layoutUndoDepth === 1 && afterMove.layoutRedoDepth === 0,
      "prime sequence move creates first conceptual layout transition");

      assert(scene.labEdit.onMoveComponent("breadboard", 0, 0, {
        kind: "rotate", deltaQuarterTurns: 1,
      }) === true, "prime sequence accepts breadboard rotate +90°");
      const afterRotate = ui.snapshot();
      const rotatedBreadboard = afterRotate.layout.components.find(item => item.id === "breadboard");
      assert(rotatedBreadboard.x === 0 && rotatedBreadboard.z === 0 && rotatedBreadboard.quarterTurns === 1 &&
        afterRotate.layoutUndoDepth === 2 && afterRotate.layoutRedoDepth === 0,
      "prime sequence rotate creates second conceptual layout transition");

      assert(activateNativeHistoryButton(undoButton) === true,
        "prime sequence first native undo activates from keyboard/click path");
      const afterUndoOne = ui.snapshot();
      const breadboardUndoOne = afterUndoOne.layout.components.find(item => item.id === "breadboard");
      assert(breadboardUndoOne.x === 0 && breadboardUndoOne.quarterTurns === 0 &&
        afterUndoOne.layoutUndoDepth === 1 && afterUndoOne.layoutRedoDepth === 1 &&
        document.activeElement === undoButton,
      "first undo restores moved/unrotated breadboard and retains native-control focus");

      assert(activateNativeHistoryButton(undoButton) === true,
        "prime sequence second native undo activates");
      const afterUndoTwo = ui.snapshot();
      const breadboardUndoTwo = afterUndoTwo.layout.components.find(item => item.id === "breadboard");
      assert(breadboardUndoTwo.x === -1 && breadboardUndoTwo.quarterTurns === 0 &&
        afterUndoTwo.layoutUndoDepth === 0 && afterUndoTwo.layoutRedoDepth === 2 &&
        document.activeElement === redoButton && !redoButton.disabled,
      "second undo restores exact initial layout and moves focus to actionable Redo");

      ui.setStage("wiring");
      assert(undoButton.disabled && redoButton.disabled &&
        undoButton.getAttribute("aria-disabled") === "true" && redoButton.getAttribute("aria-disabled") === "true",
      "stage switch preserves history but disables native layout history controls");
      ui.setStage("3d");
      assert(undoButton.disabled && !redoButton.disabled && redoButton.getAttribute("aria-disabled") === "false",
        "return to 3D restores truthful native redo availability");
      assert(activateNativeHistoryButton(redoButton) === true,
        "prime sequence performs one redo after stage switch");
      const afterRedo = ui.snapshot();
      const breadboardRedo = afterRedo.layout.components.find(item => item.id === "breadboard");
      assert(breadboardRedo.x === 0 && breadboardRedo.quarterTurns === 0 &&
        afterRedo.layoutUndoDepth === 1 && afterRedo.layoutRedoDepth === 1 &&
        document.activeElement === redoButton,
      "redo after stage switch restores first accepted move and retains focus");

      assert(scene.labEdit.onMoveComponent("breadboard", 0.5, 0, {}) === true,
        "prime sequence accepts divergent breadboard move x 0 -> 0.5");
      const afterDivergence = ui.snapshot();
      const divergentBreadboard = afterDivergence.layout.components.find(item => item.id === "breadboard");
      assert(divergentBreadboard.x === 0.5 && divergentBreadboard.quarterTurns === 0 &&
        afterDivergence.canRedoLayout === false && afterDivergence.layoutRedoDepth === 0 && redoButton.disabled &&
        redoButton.getAttribute("aria-disabled") === "true" && document.activeElement === undoButton && !undoButton.disabled,
      "divergent move clears redo and recovers focus from disabled Redo to actionable Undo");
      assert(changes.length === 0 && primeSequenceCircuits.get(2) === primeSequenceCircuit &&
        layoutChanges.length === 6,
      "prime E2E layout sequence emits only six layout changes and zero learner graph/history writes");
    });

    const boundedCircuits = new Map([[2, learnerCircuit]]);
    withFixture({ circuits: boundedCircuits }, ({ ui, scene, changes, layoutChanges }) => {
      ui.setLesson(2);
      ui.openEditor();
      const movable = ui.snapshot().layout.components.find(item => !item.fixed && item.id !== "breadboard") ||
        ui.snapshot().layout.components.find(item => !item.fixed);
      ui.selectComponent(movable.id);
      for (let index = 0; index < 35; index += 1) {
        assert(scene.labEdit.onMoveComponent(movable.id, 0, 0, {
          kind: "rotate", deltaQuarterTurns: 1,
        }) === true, "bounded history accepts rotate transition " + index);
      }
      const bounded = ui.snapshot();
      assert(bounded.layoutUndoDepth === 32 && bounded.canUndoLayout === true &&
        bounded.layoutRedoDepth === 0 && changes.length === 0 && boundedCircuits.get(2) === learnerCircuit,
      "layout history retains at most 32 accepted transitions without learner graph writes");
      let undoCount = 0;
      while (ui.undoLayout()) undoCount += 1;
      const exhausted = ui.snapshot();
      assert(undoCount === 32 && exhausted.layoutUndoDepth === 0 && exhausted.layoutRedoDepth === 32 &&
        ui.undoLayout() === false && layoutChanges.length === 35 + 32,
      "bounded history exposes exactly 32 undo restores then fails closed");
      assert(exhausted.selectedId === movable.id,
        "selected component remains stable through bounded undo restoration");
    });
  });

  return { total: checks.length, passed: checks.length, failed: 0, checks };
}

function circuitsFrom(changes) {
  return changes.at(-1).circuit;
}
