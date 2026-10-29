import {
  connectCircuit,
  createCircuit,
  createSampleCircuit,
  disconnectCircuit,
  supportedWiringLessons,
} from "../src/circuit-router.js";
import {
  LEARNER_CIRCUIT_HISTORY_LIMITS,
  createLearnerCircuitHistory,
  inspectLearnerCircuitHistory,
  recordLearnerCircuitHistory,
  redoLearnerCircuitHistory,
  resetLearnerCircuitHistory,
  undoLearnerCircuitHistory,
} from "../src/learner-circuit-history.js";
import { mountWiringWorkbench } from "../src/wiring-workbench.js";

function assert(ok, label) {
  if (!ok) throw new Error("learner-circuit-history contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function record(session, currentCircuit, nextCircuit, expectedRevision = undefined) {
  const state = inspectLearnerCircuitHistory(session);
  return recordLearnerCircuitHistory(session, {
    lessonId: state.lessonId,
    currentCircuit,
    nextCircuit,
    expectedRevision: expectedRevision ?? state.revision,
  });
}

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.type = "";
    this.title = "";
    this.hidden = false;
    this.disabled = false;
    this._text = "";
    this.classList = {
      add: (...names) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach(name => current.add(name));
        this.className = [...current].join(" ");
      },
      toggle: (name, force) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !current.has(name) : Boolean(force);
        if (enabled) current.add(name); else current.delete(name);
        this.className = [...current].join(" ");
        return enabled;
      },
      contains: name => this.className.split(/\s+/).filter(Boolean).includes(name),
    };
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  matches(selector) {
    if (selector === "[data-terminal]") return typeof this.dataset.terminal === "string";
    if (selector === "[data-remove-wire]") return typeof this.dataset.removeWire === "string";
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
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
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
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

  dispatch(type, extra = {}) {
    const event = { target: this, ...extra };
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }

  click() { this.dispatch("click"); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 44 }; }
  focus() {}
}

class FakeDocument {
  createElement(tagName) { return new FakeNode(tagName); }
  createElementNS(_namespaceURI, tagName) { return new FakeNode(tagName); }
  elementFromPoint() { return null; }
}

function descendants(node, predicate) {
  const found = [];
  const visit = current => {
    for (const child of current.children) {
      if (predicate(child)) found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
}

function withWorkbenchDom(run) {
  const browserWindow = globalThis.window;
  const browserDocument = browserWindow?.document;
  const hasNativeBrowserDom = typeof globalThis.Window === "function" &&
    browserWindow instanceof globalThis.Window &&
    browserDocument === globalThis.document &&
    typeof browserDocument?.createElement === "function";

  if (hasNativeBrowserDom) {
    const host = browserDocument.createElement("div");
    host.style.position = "absolute";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "800px";
    browserDocument.body.append(host);
    try {
      return run(browserDocument, host, true);
    } finally {
      host.remove();
    }
  }

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const fakeWindow = {
    addEventListener() {},
    removeEventListener() {},
  };
  class FakeResizeObserver {
    observe() {}
    disconnect() {}
  }
  globalThis.document = new FakeDocument();
  globalThis.window = fakeWindow;
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    return run(globalThis.document, null, false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

export function runLearnerCircuitHistoryContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("create-requires-explicit-canonical-learner-graph-and-freezes-it", () => {
    const empty = createCircuit(2);
    const session = createLearnerCircuitHistory({ lessonId: 2, circuit: empty });
    const state = inspectLearnerCircuitHistory(session);
    assert(state.lessonId === 2 && state.revision === 0 && state.undoDepth === 0 && state.redoDepth === 0,
      "initial history identity/depth");
    assert(state.maxSteps === LEARNER_CIRCUIT_HISTORY_LIMITS.defaultMaxSteps,
      "default maxSteps");
    assert(Object.isFrozen(session) && Object.isFrozen(state) && Object.isFrozen(state.circuit) &&
      Object.isFrozen(state.circuit.wires), "session and canonical snapshot immutable");
    assert(state.circuit !== empty && state.circuit.wires.length === 0 && state.circuit.nextWireId === 1,
      "history clones explicit empty learner graph");
    expectThrow(
      () => createLearnerCircuitHistory({ lessonId: 2 }),
      /circuit.*field riêng|circuit/i,
      "missing explicit circuit rejected",
    );
  });

  check("record-undo-redo-preserves-wire-id-and-nextWireId-semantics", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const created = createLearnerCircuitHistory({ lessonId: 2, circuit: empty });
    const recorded = record(created, empty, one);
    const recordedState = inspectLearnerCircuitHistory(recorded);
    assert(recordedState.revision === 1 && recordedState.canUndo && !recordedState.canRedo,
      "record revision and undo availability");
    assert(recordedState.circuit.wires[0].id === "w1" && recordedState.circuit.nextWireId === 2,
      "record preserves canonical wire ID counter");
    assert(empty.wires.length === 0 && one.wires.length === 1,
      "record does not mutate source graphs");

    const undone = undoLearnerCircuitHistory(recorded, {
      lessonId: 2,
      currentCircuit: one,
      expectedRevision: 1,
    });
    assert(Object.isFrozen(undone) && undone.session !== recorded,
      "undo returns immutable explicit result wrapper");
    assert(undone.circuit.wires.length === 0 && undone.circuit.nextWireId === 1,
      "undo restores exact pre-connect nextWireId");
    const undoState = inspectLearnerCircuitHistory(undone.session);
    assert(undoState.revision === 2 && !undoState.canUndo && undoState.canRedo,
      "undo advances revision and exposes redo");

    const redone = redoLearnerCircuitHistory(undone.session, {
      lessonId: 2,
      currentCircuit: undone.circuit,
      expectedRevision: 2,
    });
    assert(redone.circuit.wires.length === 1 && redone.circuit.wires[0].id === "w1" &&
      redone.circuit.nextWireId === 2,
    "redo restores exact wire ID and nextWireId");
    assert(inspectLearnerCircuitHistory(redone.session).revision === 3,
      "redo advances revision");
  });

  check("disconnect-is-an-explicit-history-step-with-stable-wire-counter", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const two = connectCircuit(one, "R1:B", "LED:A");
    const removed = disconnectCircuit(two, "w1");
    let history = createLearnerCircuitHistory({ lessonId: 2, circuit: two });
    history = record(history, two, removed);
    const removedState = inspectLearnerCircuitHistory(history);
    assert(removedState.circuit.wires.length === 1 && removedState.circuit.wires[0].id === "w2" &&
      removedState.circuit.nextWireId === 3,
    "disconnect preserves surviving wire ID and monotonic nextWireId");

    const undone = undoLearnerCircuitHistory(history, {
      lessonId: 2,
      currentCircuit: removed,
      expectedRevision: 1,
    });
    assert(undone.circuit.wires.map(wire => wire.id).join(",") === "w1,w2" &&
      undone.circuit.nextWireId === 3,
    "undo disconnect restores exact removed wire without rewinding the router counter");
    const redone = redoLearnerCircuitHistory(undone.session, {
      lessonId: 2,
      currentCircuit: undone.circuit,
      expectedRevision: 2,
    });
    assert(redone.circuit.wires.length === 1 && redone.circuit.wires[0].id === "w2" &&
      redone.circuit.nextWireId === 3,
    "redo disconnect restores exact post-disconnect graph");
  });

  check("all-supported-lessons-preserve-base-or-extended-canonical-schema", () => {
    const lessonIds = supportedWiringLessons();
    assert(lessonIds.length === 15 && lessonIds[0] === 2 && lessonIds.at(-1) === 16,
      "expected 15 learner wiring lessons 2..16");
    for (const lessonId of lessonIds) {
      const empty = createCircuit(lessonId);
      const sample = createSampleCircuit(lessonId);
      let history = createLearnerCircuitHistory({ lessonId, circuit: empty });
      history = record(history, empty, sample);
      const recorded = inspectLearnerCircuitHistory(history).circuit;
      assert(JSON.stringify(recorded) === JSON.stringify(sample),
        "record preserves exact canonical sample schema lesson " + lessonId);
      const undone = undoLearnerCircuitHistory(history, {
        lessonId,
        currentCircuit: sample,
        expectedRevision: 1,
      });
      assert(JSON.stringify(undone.circuit) === JSON.stringify(empty),
        "undo preserves exact empty schema lesson " + lessonId);
      const redone = redoLearnerCircuitHistory(undone.session, {
        lessonId,
        currentCircuit: undone.circuit,
        expectedRevision: 2,
      });
      assert(JSON.stringify(redone.circuit) === JSON.stringify(sample),
        "redo preserves exact canonical sample schema lesson " + lessonId);
    }
  });

  check("sample-and-clear-are-recorded-only-when-explicit-graphs-are-supplied", () => {
    const empty = createCircuit(2);
    const sample = createSampleCircuit(2);
    let history = createLearnerCircuitHistory({ lessonId: 2, circuit: empty });
    history = record(history, empty, sample);
    const sampleState = inspectLearnerCircuitHistory(history);
    assert(sampleState.circuit.wires.map(wire => wire.id).join(",") === "w1,w2,w3" &&
      sampleState.circuit.nextWireId === 4,
    "explicit sample mutation keeps router wire IDs");

    const cleared = createCircuit(2);
    history = record(history, sample, cleared);
    assert(inspectLearnerCircuitHistory(history).circuit.nextWireId === 1,
      "explicit clear graph is recorded exactly");

    const undoClear = undoLearnerCircuitHistory(history, {
      lessonId: 2,
      currentCircuit: cleared,
      expectedRevision: 2,
    });
    assert(undoClear.circuit.wires.map(wire => wire.id).join(",") === "w1,w2,w3" &&
      undoClear.circuit.nextWireId === 4,
    "undo clear restores exact sample graph without regenerating it");
    const redoClear = redoLearnerCircuitHistory(undoClear.session, {
      lessonId: 2,
      currentCircuit: undoClear.circuit,
      expectedRevision: 3,
    });
    assert(redoClear.circuit.wires.length === 0 && redoClear.circuit.nextWireId === 1,
      "redo clear restores exact empty graph");
  });

  check("no-op-record-does-not-create-fake-history-or-drop-redo", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    let history = createLearnerCircuitHistory({ lessonId: 2, circuit: empty });
    history = record(history, empty, one);
    const undone = undoLearnerCircuitHistory(history, {
      lessonId: 2,
      currentCircuit: one,
      expectedRevision: 1,
    });
    const before = inspectLearnerCircuitHistory(undone.session);
    const noOp = record(undone.session, undone.circuit, undone.circuit);
    const after = inspectLearnerCircuitHistory(noOp);
    assert(noOp === undone.session && after.revision === before.revision && after.canRedo,
      "same graph is not fabricated into a learner mutation");
  });

  check("new-record-after-undo-clears-redo-branch", () => {
    const empty = createCircuit(3);
    const first = connectCircuit(empty, "5V", "BTN:1");
    const alternate = connectCircuit(empty, "D13", "R_LED:A");
    let history = createLearnerCircuitHistory({ lessonId: 3, circuit: empty });
    history = record(history, empty, first);
    const undone = undoLearnerCircuitHistory(history, {
      lessonId: 3,
      currentCircuit: first,
      expectedRevision: 1,
    });
    history = record(undone.session, undone.circuit, alternate);
    const state = inspectLearnerCircuitHistory(history);
    assert(state.revision === 3 && state.canUndo && !state.canRedo && state.redoDepth === 0,
      "new branch invalidates redo");
  });

  check("bounded-history-keeps-only-maxSteps-previous-graphs", () => {
    const empty = createCircuit(3);
    const one = connectCircuit(empty, "5V", "BTN:1");
    const two = connectCircuit(one, "BTN:2", "D2");
    const three = connectCircuit(two, "D2", "R_PULL:A");
    let history = createLearnerCircuitHistory({ lessonId: 3, circuit: empty, maxSteps: 2 });
    history = record(history, empty, one);
    history = record(history, one, two);
    history = record(history, two, three);
    assert(inspectLearnerCircuitHistory(history).undoDepth === 2,
      "undo stack trimmed to maxSteps");
    const undoOne = undoLearnerCircuitHistory(history, {
      lessonId: 3,
      currentCircuit: three,
      expectedRevision: 3,
    });
    const undoTwo = undoLearnerCircuitHistory(undoOne.session, {
      lessonId: 3,
      currentCircuit: undoOne.circuit,
      expectedRevision: 4,
    });
    assert(undoTwo.circuit.wires.length === 1 && undoTwo.circuit.wires[0].id === "w1",
      "oldest retained graph is the bounded floor");
    expectThrow(
      () => undoLearnerCircuitHistory(undoTwo.session, {
        lessonId: 3,
        currentCircuit: undoTwo.circuit,
        expectedRevision: 5,
      }),
      /không có.*undo/i,
      "third undo beyond bounded history rejected",
    );
  });

  check("stale-revision-and-foreign-current-graph-fail-closed", () => {
    const empty = createCircuit(2);
    const one = connectCircuit(empty, "D13", "R1:A");
    const foreignSameLesson = connectCircuit(empty, "R1:B", "LED:A");
    let history = createLearnerCircuitHistory({ lessonId: 2, circuit: empty });
    history = record(history, empty, one);
    expectThrow(
      () => recordLearnerCircuitHistory(history, {
        lessonId: 2,
        currentCircuit: one,
        nextCircuit: one,
        expectedRevision: 0,
      }),
      /stale/i,
      "stale record revision rejected",
    );
    expectThrow(
      () => undoLearnerCircuitHistory(history, {
        lessonId: 2,
        currentCircuit: one,
        expectedRevision: 0,
      }),
      /stale/i,
      "stale undo revision rejected",
    );
    expectThrow(
      () => undoLearnerCircuitHistory(history, {
        lessonId: 2,
        currentCircuit: foreignSameLesson,
        expectedRevision: 1,
      }),
      /foreign graph|history head/i,
      "same-lesson foreign current graph rejected",
    );
    expectThrow(
      () => recordLearnerCircuitHistory(history, {
        lessonId: 2,
        currentCircuit: one,
        nextCircuit: createCircuit(3),
        expectedRevision: 1,
      }),
      /canonical model|bài hiện tại|lesson/i,
      "foreign next graph rejected",
    );
  });

  check("prototype-and-prototype-name-forgeries-are-rejected", () => {
    const empty = createCircuit(2);
    const inheritedGraph = Object.create(empty);
    expectThrow(
      () => createLearnerCircuitHistory({ lessonId: 2, circuit: inheritedGraph }),
      /prototype/i,
      "graph with inherited canonical fields rejected",
    );

    const inheritedWire = Object.assign(Object.create({ forged: true }), {
      id: "w1", from: "D13", to: "R1:A",
    });
    const graphWithInheritedWire = { ...empty, wires: [inheritedWire], nextWireId: 2 };
    expectThrow(
      () => createLearnerCircuitHistory({ lessonId: 2, circuit: graphWithInheritedWire }),
      /prototype/i,
      "wire with custom prototype rejected",
    );

    for (const prototypeName of ["constructor", "toString", "__proto__"]) {
      const forged = {
        ...empty,
        wires: [{ id: "w1", from: prototypeName, to: "GND" }],
        nextWireId: 2,
      };
      expectThrow(
        () => createLearnerCircuitHistory({ lessonId: 2, circuit: forged }),
        /terminal ngoài bài học|canonical/i,
        "prototype terminal name " + prototypeName + " rejected",
      );
    }

    const customInput = Object.assign(Object.create({ lessonId: 2 }), { circuit: empty });
    expectThrow(
      () => createLearnerCircuitHistory(customInput),
      /prototype/i,
      "operation input with custom prototype rejected",
    );
  });

  check("forged-session-clones-cannot-enter-history-operations", () => {
    const session = createLearnerCircuitHistory({ lessonId: 2, circuit: createCircuit(2) });
    const clone = JSON.parse(JSON.stringify(session));
    expectThrow(
      () => inspectLearnerCircuitHistory(clone),
      /không được tạo bởi module history/i,
      "JSON-cloned session rejected by module provenance",
    );
    expectThrow(
      () => inspectLearnerCircuitHistory(Object.create(session)),
      /prototype/i,
      "prototype-inherited session rejected",
    );
  });

  check("reset-can-change-current-lesson-and-invalidates-old-revision", () => {
    const empty2 = createCircuit(2);
    const one2 = connectCircuit(empty2, "D13", "R1:A");
    let history = createLearnerCircuitHistory({ lessonId: 2, circuit: empty2 });
    history = record(history, empty2, one2);
    const reset = resetLearnerCircuitHistory(history, {
      lessonId: 3,
      circuit: createCircuit(3),
      expectedRevision: 1,
    });
    const state = inspectLearnerCircuitHistory(reset);
    assert(state.lessonId === 3 && state.revision === 2 && state.undoDepth === 0 && state.redoDepth === 0,
      "reset establishes new lesson identity and clears stacks");
    expectThrow(
      () => undoLearnerCircuitHistory(reset, {
        lessonId: 2,
        currentCircuit: one2,
        expectedRevision: 2,
      }),
      /không phải bài|canonical circuit-router/i,
      "stale old-lesson callback rejected after reset",
    );
  });

  check("unsupported-lessons-extra-action-fields-and-invalid-bounds-rejected", () => {
    expectThrow(
      () => createLearnerCircuitHistory({ lessonId: 1, circuit: createCircuit(1) }),
      /canonical circuit-router/i,
      "lesson without learner circuit history rejected",
    );
    expectThrow(
      () => createLearnerCircuitHistory({ lessonId: 2, circuit: createCircuit(2), maxSteps: 0 }),
      /maxSteps.*1/i,
      "zero maxSteps rejected",
    );
    expectThrow(
      () => createLearnerCircuitHistory({
        lessonId: 2,
        circuit: createCircuit(2),
        maxSteps: LEARNER_CIRCUIT_HISTORY_LIMITS.maxSteps + 1,
      }),
      /maxSteps/i,
      "maxSteps absolute bound enforced",
    );
    const session = createLearnerCircuitHistory({ lessonId: 2, circuit: createCircuit(2) });
    expectThrow(
      () => recordLearnerCircuitHistory(session, {
        lessonId: 2,
        currentCircuit: createCircuit(2),
        nextCircuit: createCircuit(2),
        expectedRevision: 0,
        action: "simulated-connect",
      }),
      /field không được hỗ trợ.*action/i,
      "history refuses action labels that could fabricate learner-event provenance",
    );
  });

  check("workbench-history-controls-are-read-only-explicit-accessible-callbacks", () => {
    withWorkbenchDom((document, browserHost, nativeBrowserDom) => {
      const host = browserHost ?? document.createElement("div");
      const initial = createCircuit(2);
      const undoRequests = [];
      const redoRequests = [];
      const ui = mountWiringWorkbench(host, 2, {
        initial,
        historyState: Object.freeze({
          lessonId: 2,
          revision: 7,
          maxSteps: 32,
          undoDepth: 1,
          redoDepth: 0,
          canUndo: true,
          canRedo: false,
          circuit: initial,
        }),
        onUndo: request => undoRequests.push(request),
        onRedo: request => redoRequests.push(request),
      });
      const buttons = descendants(host, node => node.tagName === "BUTTON");
      const undo = buttons.find(node => /Hoàn tác trạng thái đấu dây/i.test(node.getAttribute("aria-label") || ""));
      const redo = buttons.find(node => /Làm lại trạng thái đấu dây/i.test(node.getAttribute("aria-label") || ""));
      assert(undo && redo, "history controls are rendered when callbacks are supplied");
      assert(undo.type === "button" && redo.type === "button", "history controls use native buttons");
      assert(undo.style.minHeight === "44px" && undo.style.minWidth === "44px" &&
        redo.style.minHeight === "44px" && redo.style.minWidth === "44px",
      "history controls keep 44px minimum targets even under responsive CSS");
      if (nativeBrowserDom) {
        const Button = document.defaultView?.HTMLButtonElement;
        const undoRect = undo.getBoundingClientRect();
        const redoRect = redo.getBoundingClientRect();
        assert(Button && undo instanceof Button && redo instanceof Button,
          "browser path renders actual native HTMLButtonElement controls");
        assert(undoRect.width >= 44 && undoRect.height >= 44 &&
          redoRect.width >= 44 && redoRect.height >= 44,
        "browser layout proves both history controls are at least 44x44 CSS px");
      }
      assert(!undo.disabled && redo.disabled && undo.getAttribute("aria-disabled") === "false" &&
        redo.getAttribute("aria-disabled") === "true",
      "initial history state drives read-only enablement");

      const beforeUndo = ui.getCircuit();
      undo.click();
      assert(undoRequests.length === 1 && undoRequests[0].lessonId === 2 &&
        undoRequests[0].expectedRevision === 7,
      "explicit undo activation emits exact lesson/revision request");
      assert(Object.isFrozen(undoRequests[0]), "undo request is immutable");
      assert(ui.getCircuit() === beforeUndo && ui.getCircuit().wires.length === 0,
        "undo callback does not mutate local learner graph");
      redo.click();
      assert(redoRequests.length === 0, "disabled redo emits no request");

      ui.setHistoryState(Object.freeze({
        lessonId: 2,
        revision: 8,
        maxSteps: 32,
        undoDepth: 0,
        redoDepth: 1,
        canUndo: false,
        canRedo: true,
        circuit: initial,
      }));
      assert(undo.disabled && !redo.disabled, "setHistoryState updates controls without applying a circuit");
      redo.click();
      assert(redoRequests.length === 1 && redoRequests[0].lessonId === 2 &&
        redoRequests[0].expectedRevision === 8,
      "explicit redo activation emits current lesson/revision request");
      assert(ui.getCircuit() === beforeUndo, "redo callback remains local-graph read-only");

      expectThrow(
        () => ui.setHistoryState({ lessonId: 3, revision: 9, canUndo: true, canRedo: false }),
        /bài học khác/i,
        "foreign lesson history state rejected by workbench",
      );
      ui.dispose();
    });
  });

  return { total: checks.length, passed: checks.length, failed: 0, checks };
}
