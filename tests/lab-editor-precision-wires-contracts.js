import {
  connectCircuit,
  createCircuit,
  createSampleCircuit,
} from "../src/circuit-router.js";
import { mountLabEditor } from "../src/lab-editor-ui.js";

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
    setLabEdit(value) { this.labEdit = value; return true; },
    setLabLayout(value) { this.layout = value; return true; },
    setPendingWireTerminal(value) { this.pending = value; return true; },
  };
}

function withFixture({ circuits = new Map() } = {}, run) {
  const nativeBrowserDom = isNativeBrowserDocument(globalThis.document);
  const previousDocument = nativeBrowserDom ? null : globalThis.document;
  const dom = makeDom(nativeBrowserDom ? globalThis.document : new FakeDocument());
  const scene = makeScene();
  const changes = [];
  if (!nativeBrowserDom) globalThis.document = dom.document;
  let ui = null;
  try {
    ui = mountLabEditor({
      getCircuit: lessonId => circuits.get(lessonId) ?? null,
      onCircuitChange: (lessonId, circuit, analysis) => {
        circuits.set(lessonId, circuit);
        changes.push({ lessonId, circuit, analysis });
      },
    });
    ui.setScene(scene);
    return run({ ...dom, scene, changes, circuits, ui });
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

export function runLabEditorPrecisionWiresContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("per-wire-list-is-native-accessible-and-learner-graph-only", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const two = connectCircuit(one, "R1:B", "LED:A");
    withFixture({ circuits: new Map([[2, two]]) }, ({ ui, scene, panel, document, nativeBrowserDom }) => {
      ui.setLesson(2);
      assert(ui.openEditor(), "lesson 2 editor opens");
      assert(scene.labEdit?.enabled === true, "scene edit bridge enabled");
      const list = panel.querySelector("[data-lab-precision-wire-list]");
      assert(list && list.getAttribute("role") === "group", "precision wire list exposes named group");
      const provenance = list.querySelector("[data-lab-wire-provenance]");
      assert(provenance?.dataset.labWireProvenance === "learner graph only" &&
        /learner graph only/.test(provenance.textContent),
      "visible provenance is learner graph only");
      const rows = [...list.querySelectorAll("[data-lab-wire-row]")];
      const buttons = [...list.querySelectorAll("[data-lab-remove-wire-id]")];
      assert(rows.length === 2 && buttons.length === 2, "one native removal row per canonical learner wire");
      assert(rows.every(row => row.tagName === "LI") &&
        list.querySelector("[data-lab-precision-wire-rows]")?.tagName === "UL",
      "precision wire inventory uses native ul/li list semantics");
      assert(rows[0].textContent.includes("w1 · D13 → R1:A · learner graph only") &&
        rows[1].textContent.includes("w2 · R1:B → LED:A · learner graph only"),
      "rows expose exact wire IDs/endpoints and provenance via textContent");
      for (const button of buttons) {
        assert(button.tagName === "BUTTON" && button.type === "button", "remove action is native button");
        assert(button.style.minHeight === "44px" && button.style.minWidth === "44px",
          "remove action enforces >=44px target hooks");
        assert(/Gỡ dây w\d+ từ .+ đến .+ khỏi learner graph/.test(button.getAttribute("aria-label") || ""),
          "remove action has exact accessible wire/endpoints name");
        assert(button.dataset.labWireLesson === "2", "button captures current lesson for stale revalidation");
      }
      if (nativeBrowserDom) {
        const Button = document.defaultView?.HTMLButtonElement;
        assert(Button && buttons.every(button => button instanceof Button),
          "browser direct path renders actual native HTMLButtonElement remove controls");
        assert(buttons.every(button => {
          const rect = button.getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        }), "browser direct path proves each remove control is at least 44x44 CSS px");
      }
    });
  });

  check("remove-exact-wire-id-routes-through-canonical-change-and-rejects-stale", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const two = connectCircuit(one, "R1:B", "LED:A");
    const circuits = new Map([[2, two], [3, createCircuit(3)]]);
    withFixture({ circuits }, ({ ui, panel, changes, document }) => {
      ui.setLesson(2);
      ui.openEditor();
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
  });

  check("empty-learner-graph-never-falls-back-to-reference-and-inspection-is-read-only", () => {
    assert(createSampleCircuit(2).wires.length > 0, "reference fixture must contain sample wires");
    withFixture({}, ({ ui, panel, changes }) => {
      ui.setLesson(2);
      ui.openEditor();
      const list = panel.querySelector("[data-lab-precision-wire-list]");
      assert(list.querySelectorAll("[data-lab-wire-row]").length === 0 &&
        /chưa có dây/i.test(list.textContent),
      "missing learner graph renders canonical empty state instead of reference sample");
      const before = changes.length;
      const snapshot = ui.snapshot();
      assert(snapshot.lessonId === 2 && snapshot.circuit === null && changes.length === before,
        "snapshot/inspection does not create or mutate a learner draft");
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

      ui.setLesson(3);
      ui.openEditor();
      assert(scene.labEdit.onTerminalSelect("5V") === true && ui.snapshot().firstTerminal === "5V",
        "new lesson two-tap state armed");
      const before = changes.length;
      assert(staleDragStart("D13", pointerMeta()) === false && changes.length === before &&
        ui.snapshot().firstTerminal === "5V",
      "old-lesson drag-start callback cannot clear current pending state or mutate graph");
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
  });

  return { total: checks.length, passed: checks.length, failed: 0, checks };
}

function circuitsFrom(changes) {
  return changes.at(-1).circuit;
}
