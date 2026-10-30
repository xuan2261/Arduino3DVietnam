import { listTerminals } from "../src/circuit-router.js";
import { mountBreadboardStudy } from "../src/breadboard-topology-ui.js";

const GENERIC = "generic-63x10-terminal-strips";
const BB830 = "busboard-bb830-rev7";

function assert(condition, message) {
  if (!condition) throw new Error("breadboard-scene-pick contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

class FakeNode {
  constructor(tagName, ownerDocument, namespaceURI = null) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.value = "";
    this.disabled = false;
    this.type = "";
    this._text = "";
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }

  set innerHTML(_) {
    throw new Error("scene-pick bridge must not use innerHTML");
  }

  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeNode, "append expects FakeNode");
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
    const event = {
      target: this,
      key: extra.key,
      preventDefault() {},
      ...extra,
    };
    for (const callback of this.listeners.get(type) ?? []) callback(event);
    return event;
  }

  click() { return this.dispatch("click"); }
  change() { return this.dispatch("change"); }
  input() { return this.dispatch("input"); }
}

class FakeDocument {
  constructor() { this.byId = new Map(); }
  createElement(tagName) { return new FakeNode(tagName, this); }
  createElementNS(namespaceURI, tagName) {
    return new FakeNode(tagName, this, namespaceURI);
  }
  getElementById(id) { return this.byId.get(id) ?? null; }
  register(id, tagName = "div") {
    const node = new FakeNode(tagName, this);
    this.byId.set(id, node);
    return node;
  }
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

function holeButtons(document) {
  return descendants(
    document.getElementById("bbHoleGrid"),
    node => typeof node.dataset.bbGridHole === "string",
  );
}

function holeButton(document, holeId) {
  return holeButtons(document).find(button => button.dataset.bbGridHole === holeId) ?? null;
}

function lessonContext(lessonId) {
  return { lessonId, terminals: lessonId === 1 ? [] : listTerminals(lessonId) };
}

function registerControls(document, profileId = GENERIC) {
  const profile = document.register("bbProfile", "select");
  profile.value = profileId;
  const holeA = document.register("bbHoleA", "input");
  holeA.value = "A1";
  const holeB = document.register("bbHoleB", "input");
  holeB.value = "E1";
  document.register("bbCompare", "button");
  document.register("bbResult", "p");
  document.register("bbMappingWarning", "p");
  document.register("bbTopologyDiagram", "div");
  document.register("bbTerminal", "select");
  const placeHole = document.register("bbPlaceHole", "input");
  placeHole.value = "A12";
  document.register("bbAssignHole", "button");
  document.register("bbRemoveHole", "button");
  document.register("bbPlacedList", "div");
  document.register("bbPlacementStatus", "p");
  document.register("bbAuthoredBoundary", "p").textContent =
    "Vị trí do người dùng khai báo trong phiên; không phải vị trí 3D hay kết nối điện tự sinh.";
  document.register("bbHoleGrid", "div");
  document.register("bbGridPrev", "button");
  document.register("bbGridNext", "button");
  document.register("bbGridPage", "span");
  document.register("bbGridRail", "select");
  const railHole = document.register("bbGridRailHole", "input");
  railHole.value = "1";
  document.register("bbPickRail", "button");
  document.register("bbGridStatus", "p");
  return document;
}

function pointerMeta() {
  return Object.freeze({ source: "pointer", physicalVerified: false });
}

function fixture({ lessonId = 2, profileId = GENERIC, editActive = true, observer = null } = {}) {
  const document = registerControls(new FakeDocument(), profileId);
  const lessonRef = { current: lessonContext(lessonId) };
  const editRef = { current: editActive };
  const events = [];
  const ui = mountBreadboardStudy({
    doc: document,
    getLayout: () => ({ claims: { breadboardHoleMapping: false } }),
    getLessonTerminals: () => lessonRef.current,
    getSceneEditActive: () => editRef.current,
    onHoleSelectionChange: selection => {
      events.push(selection);
      observer?.(selection);
    },
  });
  return { document, lessonRef, editRef, events, ui };
}

function sideEffectSnapshot(fixtureValue) {
  const { document, events, ui } = fixtureValue;
  return JSON.stringify({
    placeHole: document.getElementById("bbPlaceHole").value,
    page: document.getElementById("bbGridPage").dataset.page ?? null,
    gridStatus: document.getElementById("bbGridStatus").textContent,
    gridResult: document.getElementById("bbGridStatus").dataset.result ?? null,
    selection: ui.getHoleSelection(),
    placement: ui.getAuthoredPlacement(),
    events: events.length,
  });
}

export function runBreadboardScenePickContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("api-options-and-controller-methods-are-explicit", () => {
    const document = registerControls(new FakeDocument());
    expectThrow(
      () => mountBreadboardStudy({ doc: document, getSceneEditActive: true }),
      /getSceneEditActive.*function/i,
      "bad scene callback",
    );
    expectThrow(
      () => mountBreadboardStudy({ doc: document, onHoleSelectionChange: "bad" }),
      /onHoleSelectionChange.*function/i,
      "bad observer",
    );
    const f = fixture();
    try {
      assert(typeof f.ui.pickHoleFromScene === "function", "pickHoleFromScene missing");
      assert(typeof f.ui.getHoleSelection === "function", "getHoleSelection missing");
      assert(f.ui.getHoleSelection() === null, "initial hole selection must be null");
    } finally { f.ui.dispose(); }
  });

  check("scene-pick-pages-selects-contact-and-stays-input-only", () => {
    const f = fixture();
    try {
      const receipt = f.ui.pickHoleFromScene("H57", pointerMeta(), 2, GENERIC);
      assert(receipt.accepted === true && Object.isFrozen(receipt), "scene receipt accepted/frozen");
      assert(receipt.selection === f.ui.getHoleSelection(), "receipt selection must be current projection");
      assert(Object.isFrozen(receipt.selection) && Object.isFrozen(receipt.selection.claims), "selection deep frozen enough for callback boundary");
      assert(receipt.selection.origin === "scene" && receipt.selection.lessonId === 2, "scene origin/lesson");
      assert(receipt.selection.profileId === GENERIC && receipt.selection.holeId === "H57", "scene profile/hole");
      assert(receipt.selection.page === 8 && receipt.selection.column === 57, "deterministic containing page/column");
      assert(receipt.selection.claims.inputValueOnly === true &&
        receipt.selection.claims.placementCreated === false &&
        receipt.selection.claims.circuitRouterMutated === false,
      "scene selection must remain input-only");
      assert(f.document.getElementById("bbGridPage").dataset.page === "8", "grid moved to page 8");
      assert(f.document.getElementById("bbPlaceHole").value === "H57", "place input updated");
      const selected = holeButton(f.document, "H57");
      assert(selected?.getAttribute("aria-pressed") === "true", "native grid aria-pressed updated");
      assert(selected?.dataset.bbContactSelected === "true", "contact-group selected marker updated");
      assert(selected?.style.minWidth === "44px" && selected?.style.minHeight === "44px", "44px native action preserved");
      assert(f.ui.getContactInspection()?.holeId === "H57", "contact group inspection updated");
      assert(/chỉ là lựa chọn input read-only/i.test(f.document.getElementById("bbGridStatus").textContent), "read-only selection announcement");
      assert(/Gán lỗ/i.test(f.document.getElementById("bbGridStatus").textContent), "separate Assign gate announcement");
      assert(f.document.getElementById("bbGridStatus").dataset.selectionSource === "scene",
        "scene selection source marker");
      assert(f.ui.getAuthoredPlacement() === null, "scene selection must not create placement");
      assert(f.events.length === 1 && f.events[0] === receipt.selection, "scene selection observer exactly once");
    } finally { f.ui.dispose(); }
  });

  check("native-strip-picker-notifies-same-read-only-selection-channel", () => {
    const f = fixture();
    try {
      holeButton(f.document, "C3").click();
      const selection = f.ui.getHoleSelection();
      assert(selection?.origin === "native-grid" && selection.holeId === "C3" && selection.lessonId === 2,
        "native strip observer projection");
      assert(f.document.getElementById("bbGridStatus").dataset.selectionSource === "native-grid",
        "native grid source replaces any prior source marker");
      assert(f.events.length === 1 && f.events[0] === selection, "native strip observer once");
      assert(f.ui.getAuthoredPlacement() === null, "native strip pick does not assign placement");
    } finally { f.ui.dispose(); }
  });

  check("native-bb830-rail-picker-notifies-without-creating-placement", () => {
    const f = fixture({ profileId: BB830 });
    try {
      f.document.getElementById("bbGridRail").value = "P2-";
      f.document.getElementById("bbGridRailHole").value = "7";
      f.document.getElementById("bbPickRail").click();
      const selection = f.ui.getHoleSelection();
      assert(selection?.origin === "native-rail" && selection.holeId === "P2-7" && selection.profileId === BB830,
        "native rail observer projection");
      assert(f.events.length === 1 && f.events[0] === selection, "native rail observer once");
      assert(f.ui.getAuthoredPlacement() === null, "rail pick does not assign placement");
    } finally { f.ui.dispose(); }
  });

  check("lesson-reset-clears-observer-selection-and-picker-state", () => {
    const f = fixture();
    try {
      assert(f.ui.pickHoleFromScene("J63", pointerMeta(), 2, GENERIC).accepted, "pre-reset scene pick");
      f.lessonRef.current = lessonContext(3);
      f.ui.update();
      assert(f.ui.getHoleSelection() === null, "lesson reset clears stored selection");
      assert(f.events.length === 2 && f.events[1] === null, "lesson reset observer null");
      assert(!Object.hasOwn(f.document.getElementById("bbGridStatus").dataset, "selectionSource"),
        "lesson reset clears selection source marker");
      assert(f.document.getElementById("bbGridPage").dataset.page === "1", "lesson reset page1");
      assert(f.document.getElementById("bbPlaceHole").value === "A12", "lesson reset input invariant");
      assert(f.ui.getAuthoredPlacement() === null, "lesson reset remains no placement");
    } finally { f.ui.dispose(); }
  });

  check("profile-reset-clears-observer-selection", () => {
    const f = fixture();
    try {
      holeButton(f.document, "A1").click();
      const profile = f.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      assert(f.ui.getHoleSelection() === null, "profile reset clears stored selection");
      assert(f.events.length === 2 && f.events[1] === null, "profile reset observer null");
      assert(f.ui.getAuthoredPlacement() === null, "profile reset no hidden placement");
    } finally { f.ui.dispose(); }
  });

  check("scene-pick-rejects-when-3d-edit-is-not-active-with-no-side-effects", () => {
    const f = fixture({ editActive: false });
    try {
      const before = sideEffectSnapshot(f);
      const receipt = f.ui.pickHoleFromScene("A1", pointerMeta(), 2, GENERIC);
      assert(receipt.accepted === false && Object.isFrozen(receipt), "edit-off rejection frozen");
      assert(/3D edit/i.test(receipt.reason), "edit-off reason");
      assert(sideEffectSnapshot(f) === before, "edit-off rejection has no UI/session/observer side effects");
    } finally { f.ui.dispose(); }
  });

  check("scene-pick-rejects-stale-lesson-and-profile-with-no-side-effects", () => {
    const f = fixture();
    try {
      for (const args of [
        ["A1", pointerMeta(), 3, GENERIC],
        ["A1", pointerMeta(), 2, BB830],
      ]) {
        const before = sideEffectSnapshot(f);
        const receipt = f.ui.pickHoleFromScene(...args);
        assert(receipt.accepted === false, "stale context rejected");
        assert(/stale|profile|lesson/i.test(receipt.reason), "stale context reason");
        assert(sideEffectSnapshot(f) === before, "stale context has no side effects");
      }
    } finally { f.ui.dispose(); }
  });

  check("scene-meta-must-be-exact-frozen-plain-own-data-pointer-boundary", () => {
    const f = fixture();
    try {
      const variants = [];
      variants.push({ source: "pointer", physicalVerified: false });
      variants.push(Object.freeze({ source: "pointer" }));
      variants.push(Object.freeze({ source: "pointer", physicalVerified: true }));
      variants.push(Object.freeze({ source: "foreign", physicalVerified: false }));
      variants.push(Object.freeze({ source: "pointer", physicalVerified: false, extra: 1 }));
      const symbol = { source: "pointer", physicalVerified: false };
      symbol[Symbol("extra")] = true;
      variants.push(Object.freeze(symbol));
      variants.push(Object.freeze(Object.assign(Object.create({ inherited: true }), {
        source: "pointer", physicalVerified: false,
      })));
      const accessor = { source: "pointer" };
      Object.defineProperty(accessor, "physicalVerified", {
        enumerable: true,
        get() { throw new Error("meta getter must never execute"); },
      });
      variants.push(Object.freeze(accessor));
      for (const meta of variants) {
        const before = sideEffectSnapshot(f);
        const receipt = f.ui.pickHoleFromScene("A1", meta, 2, GENERIC);
        assert(receipt.accepted === false, "forged meta rejected");
        assert(sideEffectSnapshot(f) === before, "forged meta rejection is atomic");
      }
    } finally { f.ui.dispose(); }
  });

  check("scene-pick-rejects-noncanonical-or-nonstrip-hole-ids-atomically", () => {
    const f = fixture();
    try {
      for (const holeId of ["a1", " A1", "A01", "A0", "A64", "K1", "P1+1", "__proto__", "A1<script>"]) {
        const before = sideEffectSnapshot(f);
        const receipt = f.ui.pickHoleFromScene(holeId, pointerMeta(), 2, GENERIC);
        assert(receipt.accepted === false && /A1\.\.J63/i.test(receipt.reason), "noncanonical hole rejected");
        assert(sideEffectSnapshot(f) === before, "noncanonical hole rejection is atomic");
      }
    } finally { f.ui.dispose(); }
  });

  check("scene-pick-rejects-unsupported-lesson-with-no-side-effects", () => {
    const f = fixture({ lessonId: 1 });
    try {
      const before = sideEffectSnapshot(f);
      const receipt = f.ui.pickHoleFromScene("A1", pointerMeta(), 1, GENERIC);
      assert(receipt.accepted === false && /khóa|canonical|lesson/i.test(receipt.reason), "lesson1 scene pick rejected");
      assert(sideEffectSnapshot(f) === before, "lesson1 rejection has no side effects");
    } finally { f.ui.dispose(); }
  });

  check("scene-pick-rejects-stale-canonical-terminal-context-atomically", () => {
    const f = fixture();
    try {
      const current = listTerminals(2);
      f.lessonRef.current = { lessonId: 2, terminals: current.slice(1) };
      const before = sideEffectSnapshot(f);
      const receipt = f.ui.pickHoleFromScene("A1", pointerMeta(), 2, GENERIC);
      assert(receipt.accepted === false && /canonical.*context|terminal context/i.test(receipt.reason),
        "terminal context drift rejected");
      assert(sideEffectSnapshot(f) === before, "terminal context drift rejection is atomic");

      const accessorContext = {};
      Object.defineProperty(accessorContext, "lessonId", {
        enumerable: true,
        get() { throw new Error("lesson getter must never execute"); },
      });
      accessorContext.terminals = listTerminals(2);
      f.lessonRef.current = accessorContext;
      const beforeAccessor = sideEffectSnapshot(f);
      const accessorReceipt = f.ui.pickHoleFromScene("A1", pointerMeta(), 2, GENERIC);
      assert(accessorReceipt.accepted === false && /own data|context/i.test(accessorReceipt.reason),
        "accessor context rejected before getter execution");
      assert(sideEffectSnapshot(f) === beforeAccessor, "accessor context rejection atomic");
    } finally { f.ui.dispose(); }
  });

  check("manual-input-invalidates-observed-picker-selection-without-placement", () => {
    const f = fixture();
    try {
      holeButton(f.document, "B2").click();
      const input = f.document.getElementById("bbPlaceHole");
      input.value = "C3";
      input.input();
      assert(f.ui.getHoleSelection() === null, "manual input clears stored picker selection");
      assert(f.events.length === 2 && f.events[1] === null, "manual input observer null");
      assert(f.ui.getAuthoredPlacement() === null, "manual input still not placement");
    } finally { f.ui.dispose(); }
  });

  check("observer-errors-cannot-upgrade-selection-to-placement-authority", () => {
    const f = fixture({ observer() { throw new Error("observer failure"); } });
    try {
      const receipt = f.ui.pickHoleFromScene("D4", pointerMeta(), 2, GENERIC);
      assert(receipt.accepted === true && f.ui.getHoleSelection()?.holeId === "D4", "selection survives observer error");
      assert(f.ui.getAuthoredPlacement() === null, "observer error cannot create placement");
      assert(f.document.getElementById("bbAssignHole").type === "", "fixture does not synthesize hidden assignment click");
    } finally { f.ui.dispose(); }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
    api: "mountBreadboardStudy({getSceneEditActive,onHoleSelectionChange}).pickHoleFromScene(holeId,frozenMeta,expectedLessonId,expectedProfileId)",
  });
}
