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
  focus() { this.ownerDocument.activeElement = this; }
}

class FakeDocument {
  constructor() { this.byId = new Map(); this.activeElement = null; }
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

function registerControls(document, profileId = GENERIC, { linkControls = false } = {}) {
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
  if (linkControls) {
    document.register("bbHoleLinkEnable", "button");
    document.register("bbHoleLinkConfirm", "button");
    document.register("bbHoleLinkCancel", "button");
    document.register("bbHoleLinkStatus", "p");
  }
  return document;
}

function pointerMeta() {
  return Object.freeze({ source: "pointer", physicalVerified: false });
}

function fixture({
  lessonId = 2,
  profileId = GENERIC,
  editActive = true,
  observer = null,
  linkControls = false,
  connect = null,
  linkObserver = null,
} = {}) {
  const document = registerControls(new FakeDocument(), profileId, { linkControls });
  const lessonRef = { current: lessonContext(lessonId) };
  const editRef = { current: editActive };
  const events = [];
  const linkEvents = [];
  const connectCalls = [];
  const ui = mountBreadboardStudy({
    doc: document,
    getLayout: () => ({ claims: { breadboardHoleMapping: false } }),
    getLessonTerminals: () => lessonRef.current,
    getSceneEditActive: () => editRef.current,
    onHoleSelectionChange: selection => {
      events.push(selection);
      observer?.(selection);
    },
    onHoleLinkChange: snapshot => {
      linkEvents.push(snapshot);
      linkObserver?.(snapshot);
    },
    onConnectTerminalPair: (...args) => {
      connectCalls.push(args);
      return connect?.(...args) ?? Object.freeze({accepted:false,committed:false,wireId:null});
    },
  });
  return { document, lessonRef, editRef, events, linkEvents, connectCalls, ui };
}

function assignTerminalHole(fixtureValue, terminalId, holeId) {
  const terminal = fixtureValue.document.getElementById("bbTerminal");
  const input = fixtureValue.document.getElementById("bbPlaceHole");
  terminal.value = terminalId;
  terminal.change();
  input.value = holeId;
  input.input();
  fixtureValue.document.getElementById("bbAssignHole").click();
  return fixtureValue.ui.getAuthoredPlacement();
}

function dragMeta() {
  return Object.freeze({ source: "pointer-drag", physicalVerified: false });
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
    expectThrow(
      () => mountBreadboardStudy({ doc: document, onConnectTerminalPair: "bad" }),
      /onConnectTerminalPair.*function/i,
      "bad connect callback",
    );
    expectThrow(
      () => mountBreadboardStudy({ doc: document, onHoleLinkChange: "bad" }),
      /onHoleLinkChange.*function/i,
      "bad link observer",
    );
    const f = fixture();
    try {
      assert(typeof f.ui.pickHoleFromScene === "function", "pickHoleFromScene missing");
      assert(typeof f.ui.getHoleSelection === "function", "getHoleSelection missing");
      assert(typeof f.ui.getHoleLinkSnapshot === "function", "getHoleLinkSnapshot missing");
      assert(typeof f.ui.cancelHoleLink === "function", "cancelHoleLink missing");
      assert(typeof f.ui.pickHoleLinkTargetFromDrag === "function", "pickHoleLinkTargetFromDrag missing");
      assert(f.ui.getHoleSelection() === null, "initial hole selection must be null");
      assert(f.ui.getHoleLinkSnapshot().mode === "off", "initial hole-link must be off");
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

  check("hole-link-controls-are-all-or-none-accessible-44px-and-toggle-keeps-focus", () => {
    const partial = registerControls(new FakeDocument());
    partial.register("bbHoleLinkEnable", "button");
    expectThrow(
      () => mountBreadboardStudy({
        doc: partial,
        getLayout: () => ({ claims: { breadboardHoleMapping: false } }),
        getLessonTerminals: () => lessonContext(2),
      }),
      /hole link|hole-link|điều khiển HTML/i,
      "partial link controls",
    );

    const f = fixture({ linkControls: true });
    try {
      const enable = f.document.getElementById("bbHoleLinkEnable");
      const confirm = f.document.getElementById("bbHoleLinkConfirm");
      const cancel = f.document.getElementById("bbHoleLinkCancel");
      const status = f.document.getElementById("bbHoleLinkStatus");
      assert(status.getAttribute("role") === "status" && status.getAttribute("aria-live") === "polite",
        "link status live region");
      assert([enable, confirm, cancel].every(button =>
        button.type === "button" && button.style.minWidth === "44px" && button.style.minHeight === "44px"),
      "native link buttons keep 44px target");
      assert(enable.disabled === true && confirm.disabled === true && cancel.disabled === true,
        "no placements keeps link controls disabled");

      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      assert(enable.disabled === false, "two explicit terminal-strip placements enable link mode");
      enable.focus();
      enable.click();
      assert(f.ui.getHoleLinkSnapshot().mode === "await-start", "toggle enters await-start");
      assert(enable.disabled === false && enable.getAttribute("aria-pressed") === "true",
        "active toggle remains enabled and pressed");
      assert(f.document.activeElement === enable, "active toggle keeps native focus");
      enable.click();
      assert(f.ui.getHoleLinkSnapshot().mode === "off" && enable.getAttribute("aria-pressed") === "false",
        "second toggle click cancels mode");
      assert(f.document.activeElement === enable, "toggle-off keeps focus on enabled control");
    } finally { f.ui.dispose(); }
  });

  check("authored-hole-link-scene-first-direct-drag-confirm-is-explicit-and-canonical", () => {
    const f = fixture({
      linkControls: true,
      connect: () => Object.freeze({accepted:true, committed:true, wireId:"w1"}),
    });
    try {
      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      const placementBefore = f.ui.getAuthoredPlacement();
      f.linkEvents.length = 0;

      f.document.getElementById("bbHoleLinkEnable").click();
      const start = f.ui.getHoleLinkSnapshot();
      const expectedKeys = [
        "claim", "firstHoleId", "firstTerminalId", "lessonId", "mode",
        "physicalVerified", "profileId", "revision", "secondHoleId", "secondTerminalId",
      ];
      assert(Object.isFrozen(start) && Reflect.ownKeys(start).sort().join(",") === expectedKeys.sort().join(","),
        "link snapshot exact frozen shape");
      assert(start.mode === "await-start" && start.lessonId === 2 && start.profileId === GENERIC &&
        start.physicalVerified === false && start.claim === "visual-only-before-confirm",
      "link start boundary");

      const first = f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      assert(first.accepted === true && f.ui.getHoleLinkSnapshot().mode === "await-end",
        "scene hole selection arms first authored endpoint");
      assert(f.ui.getHoleLinkSnapshot().firstHoleId === "C32" &&
        f.ui.getHoleLinkSnapshot().firstTerminalId === "D13",
      "first hole resolves only explicit D13 placement");
      assert(f.connectCalls.length === 0, "first selection never calls graph callback");

      const drag = f.ui.pickHoleLinkTargetFromDrag("H32", dragMeta(), 2, GENERIC);
      const ready = f.ui.getHoleLinkSnapshot();
      assert(drag.accepted === true && ready.mode === "ready" && ready.secondHoleId === "H32" &&
        ready.secondTerminalId === "R1:A", "direct 3D drag arms exact second authored endpoint");
      assert(ready.revision === start.revision, "pair remains bound to same placement revision");
      assert(f.connectCalls.length === 0, "drag preview never auto-commits graph edge");
      assert(f.ui.getAuthoredPlacement() === placementBefore, "preview never mutates authored placement");
      assert(f.ui.getHoleSelection()?.holeId === "C32",
        "direct drag target does not fabricate a second native picker selection");
      assert(f.document.getElementById("bbHoleLinkConfirm").disabled === false,
        "ready pair enables explicit Confirm only");

      const confirm=f.document.getElementById("bbHoleLinkConfirm");
      const enable=f.document.getElementById("bbHoleLinkEnable");
      confirm.focus();
      assert(f.document.activeElement===confirm,"ready Confirm receives focus before native activation");
      confirm.click();
      assert(f.connectCalls.length === 1, "Confirm invokes canonical callback exactly once");
      const [from, to, meta, expectedLessonId] = f.connectCalls[0];
      assert(from === "D13" && to === "R1:A" && expectedLessonId === 2,
        "Confirm delegates exact terminal pair/current lesson");
      assert(Object.isFrozen(meta) && Object.getPrototypeOf(meta) === Object.prototype,
        "Confirm meta frozen plain object");
      assert(Reflect.ownKeys(meta).sort().join(",") === [
        "fromHoleId", "physicalVerified", "placementRevision", "profileId", "source", "toHoleId",
      ].sort().join(","), "Confirm meta exact six keys");
      assert(meta.source === "authored-hole-confirm" && meta.physicalVerified === false &&
        meta.profileId === GENERIC && meta.fromHoleId === "C32" && meta.toHoleId === "H32" &&
        meta.placementRevision === ready.revision,
      "Confirm meta exact values");
      assert(f.ui.getHoleLinkSnapshot().mode === "off", "committed true closes preview intent");
      assert(confirm.disabled===true && enable.disabled===false && f.document.activeElement===enable,
        "accepted focused Confirm disables itself then transfers focus to actionable Enable");
      const status = f.document.getElementById("bbHoleLinkStatus").textContent;
      assert(/w1/.test(status) && /D13/.test(status) && /R1:A/.test(status) && /C32/.test(status) && /H32/.test(status),
        "commit status preserves wire/terminal/hole learner feedback");
      assert(/không xác nhận.*vật lý/i.test(status), "commit status keeps physical-continuity boundary");
      assert(f.ui.getAuthoredPlacement() === placementBefore, "Confirm callback does not mutate placement session");
      assert(f.linkEvents.map(item => item.mode).join(",") === "await-start,await-end,ready,off",
        "link observer sees every changed intent state after update");
    } finally { f.ui.dispose(); }
  });

  check("denied-or-accessor-connect-receipt-keeps-ready-preview-and-no-auto-graph", () => {
    const runDenied = connect => {
      const f = fixture({ linkControls: true, connect });
      try {
        assignTerminalHole(f, "D13", "C32");
        assignTerminalHole(f, "R1:A", "H32");
        const placement = f.ui.getAuthoredPlacement();
        f.document.getElementById("bbHoleLinkEnable").click();
        f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
        f.ui.pickHoleLinkTargetFromDrag("H32", dragMeta(), 2, GENERIC);
        assert(f.connectCalls.length === 0, "ready preview makes no callback before Confirm");
        const confirm=f.document.getElementById("bbHoleLinkConfirm");
        confirm.focus();
        confirm.click();
        assert(f.connectCalls.length === 1, "explicit Confirm is sole callback path");
        assert(f.ui.getHoleLinkSnapshot().mode === "ready", "noncommitted receipt keeps ready preview");
        assert(confirm.disabled === false && f.document.activeElement===confirm,
          "denied commit keeps Confirm available and preserves its focus for review/retry");
        assert(f.ui.getAuthoredPlacement() === placement, "denied callback cannot mutate placement session");
      } finally { f.ui.dispose(); }
    };
    runDenied(() => Object.freeze({accepted:false, committed:false, wireId:null}));
    runDenied(() => {
      const receipt = { accepted: true, wireId: "w9" };
      Object.defineProperty(receipt, "committed", {
        enumerable: true,
        get() { throw new Error("receipt getter must never execute"); },
      });
      return receipt;
    });
  });

  check("drag-target-rejects-foreign-meta-profile-unassigned-and-same-hole-without-intent-change", () => {
    const f = fixture({ linkControls: true });
    try {
      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      f.document.getElementById("bbHoleLinkEnable").click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      const baseline = f.ui.getHoleLinkSnapshot();
      const variants = [
        { hole: "H32", meta: { source: "pointer-drag", physicalVerified: false }, lesson: 2, profile: GENERIC },
        { hole: "H32", meta: Object.freeze({ source: "pointer", physicalVerified: false }), lesson: 2, profile: GENERIC },
        { hole: "H32", meta: Object.freeze({ source: "pointer-drag", physicalVerified: false, extra: 1 }), lesson: 2, profile: GENERIC },
        { hole: "H32", meta: dragMeta(), lesson: 2, profile: BB830 },
        { hole: "A1", meta: dragMeta(), lesson: 2, profile: GENERIC },
        { hole: "C32", meta: dragMeta(), lesson: 2, profile: GENERIC },
        { hole: "P1+1", meta: dragMeta(), lesson: 2, profile: GENERIC },
      ];
      const symbolMeta = { source: "pointer-drag", physicalVerified: false };
      symbolMeta[Symbol("extra")] = true;
      variants.push({ hole: "H32", meta: Object.freeze(symbolMeta), lesson: 2, profile: GENERIC });
      const accessorMeta = { source: "pointer-drag" };
      Object.defineProperty(accessorMeta, "physicalVerified", {
        enumerable: true,
        get() { throw new Error("drag meta getter must never execute"); },
      });
      variants.push({ hole: "H32", meta: Object.freeze(accessorMeta), lesson: 2, profile: GENERIC });

      for (const item of variants) {
        const before = f.ui.getHoleLinkSnapshot();
        const receipt = f.ui.pickHoleLinkTargetFromDrag(item.hole, item.meta, item.lesson, item.profile);
        assert(receipt.accepted === false, "foreign/stale/unassigned/same drag target rejected");
        assert(f.ui.getHoleLinkSnapshot() === before, "rejected drag does not mutate link intent");
        assert(f.connectCalls.length === 0, "rejected drag never calls graph callback");
      }
      assert(f.ui.getHoleLinkSnapshot() === baseline, "all drag negatives preserve first-arm snapshot identity");
    } finally { f.ui.dispose(); }
  });

  check("cancel-escape-and-public-cancel-revoke-preview-without-graph-callback", () => {
    const f = fixture({ linkControls: true });
    try {
      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      const enable = f.document.getElementById("bbHoleLinkEnable");
      enable.click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      f.document.getElementById("bbHoleGrid").dispatch("keydown", { key: "Escape" });
      assert(f.ui.getHoleLinkSnapshot().mode === "off", "Escape revokes active intent");
      assert(f.connectCalls.length === 0, "Escape never commits graph");

      enable.click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      const cancel=f.document.getElementById("bbHoleLinkCancel");
      cancel.focus();
      assert(f.document.activeElement===cancel,"active Cancel receives focus before native activation");
      cancel.click();
      assert(f.ui.getHoleLinkSnapshot().mode === "off", "Cancel button revokes active intent");
      assert(cancel.disabled===true && enable.disabled===false && f.document.activeElement===enable,
        "focused Cancel disables itself then transfers focus to actionable Enable");

      enable.click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      const unrelated=f.document.getElementById("bbHoleA");
      unrelated.focus();
      const canceled = f.ui.cancelHoleLink();
      assert(canceled.mode === "off" && Object.isFrozen(canceled), "public cancel returns frozen off snapshot");
      assert(f.document.activeElement===unrelated,
        "mode-off transition does not steal focus from an unrelated control");
      assert(f.connectCalls.length === 0, "all cancellation paths remain graph no-op");
    } finally { f.ui.dispose(); }
  });

  check("terminal-profile-and-lesson-changes-revoke-active-intent", () => {
    const f = fixture({ linkControls: true });
    try {
      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      const enable = f.document.getElementById("bbHoleLinkEnable");
      enable.click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      const terminal = f.document.getElementById("bbTerminal");
      terminal.value = "GND";
      terminal.change();
      assert(f.ui.getHoleLinkSnapshot().mode === "off", "terminal change revokes intent");

      enable.click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      const profile = f.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      assert(f.ui.getHoleLinkSnapshot().mode === "off", "profile change revokes intent");
      assert(f.document.getElementById("bbHoleLinkEnable").disabled === true,
        "profile reset clears placements and disables mode");
    } finally { f.ui.dispose(); }

    const g = fixture({ linkControls: true });
    try {
      assignTerminalHole(g, "D13", "C32");
      assignTerminalHole(g, "R1:A", "H32");
      g.document.getElementById("bbHoleLinkEnable").click();
      g.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      g.lessonRef.current = lessonContext(3);
      g.ui.update();
      assert(g.ui.getHoleLinkSnapshot().mode === "off", "lesson change revokes intent");
      assert(g.ui.getAuthoredPlacement() === null, "lesson reset clears explicit placement session");
    } finally { g.ui.dispose(); }
  });

  check("successful-placement-mutation-revokes-revision-bound-intent-and-prevents-id-reuse", () => {
    const f = fixture({ linkControls: true });
    try {
      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      f.document.getElementById("bbHoleLinkEnable").click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      const armed = f.ui.getHoleLinkSnapshot();
      assert(armed.mode === "await-end", "pre-mutation first arm");
      assignTerminalHole(f, "GND", "B2");
      const afterMutation = f.ui.getHoleLinkSnapshot();
      assert(afterMutation.mode === "off" && afterMutation.revision > armed.revision,
        "placement revision mutation revokes old intent");
      const staleDrag = f.ui.pickHoleLinkTargetFromDrag("H32", dragMeta(), 2, GENERIC);
      assert(staleDrag.accepted === false && f.connectCalls.length === 0,
        "old first endpoint cannot be reused after revision change");
    } finally { f.ui.dispose(); }
  });

  check("edit-off-revokes-active-intent-and-disables-reenable", () => {
    const f = fixture({ linkControls: true });
    try {
      assignTerminalHole(f, "D13", "C32");
      assignTerminalHole(f, "R1:A", "H32");
      f.document.getElementById("bbHoleLinkEnable").click();
      f.ui.pickHoleFromScene("C32", pointerMeta(), 2, GENERIC);
      f.editRef.current = false;
      const current = f.ui.getHoleLinkSnapshot();
      assert(current.mode === "off", "get snapshot fail-closes active intent when edit turns off");
      assert(f.document.getElementById("bbHoleLinkEnable").disabled === true,
        "edit-off disables re-enable until authority callback returns true");
      assert(f.connectCalls.length === 0, "edit-off revocation never commits");
    } finally { f.ui.dispose(); }
  });

  check("lesson01-and-rail-only-explicit-placements-cannot-enable-terminal-strip-link", () => {
    const lessonOne = fixture({ lessonId: 1, linkControls: true });
    try {
      assert(lessonOne.document.getElementById("bbHoleLinkEnable").disabled === true,
        "lesson1 link mode disabled");
      assert(lessonOne.ui.getHoleLinkSnapshot().mode === "off", "lesson1 snapshot off");
    } finally { lessonOne.ui.dispose(); }

    const rails = fixture({ profileId: BB830, linkControls: true });
    try {
      assignTerminalHole(rails, "D13", "P1+1");
      assignTerminalHole(rails, "R1:A", "P2-1");
      assert(rails.document.getElementById("bbHoleLinkEnable").disabled === true,
        "rail placements do not count as terminal-strip link targets");
      assert(rails.ui.getHoleLinkSnapshot().mode === "off", "rail grouping/proximity never arms link");
    } finally { rails.ui.dispose(); }
  });

  check("lesson10-and-14-remain-visual-only-before-confirm", () => {
    for (const lessonId of [10, 14]) {
      const terminals = listTerminals(lessonId);
      const f = fixture({ lessonId, linkControls: true });
      try {
        assignTerminalHole(f, terminals[0].id, "C32");
        assignTerminalHole(f, terminals[1].id, "H32");
        const enable = f.document.getElementById("bbHoleLinkEnable");
        assert(enable.disabled === false, `lesson ${lessonId} explicit placements may preview`);
        enable.click();
        f.ui.pickHoleFromScene("C32", pointerMeta(), lessonId, GENERIC);
        const drag = f.ui.pickHoleLinkTargetFromDrag("H32", dragMeta(), lessonId, GENERIC);
        const ready = f.ui.getHoleLinkSnapshot();
        assert(drag.accepted === true && ready.mode === "ready" && ready.physicalVerified === false &&
          ready.claim === "visual-only-before-confirm", `lesson ${lessonId} preview boundary`);
        assert(f.connectCalls.length === 0, `lesson ${lessonId} signal-only preview never auto-commits`);
        assert(f.ui.getAuthoredPlacement()?.claims?.circuitRouterMutated === false,
          `lesson ${lessonId} authored placement remains graph read-only`);
      } finally { f.ui.dispose(); }
    }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
    api: "mountBreadboardStudy({getSceneEditActive,onHoleSelectionChange,onConnectTerminalPair,onHoleLinkChange}) => {pickHoleFromScene,getHoleSelection,getHoleLinkSnapshot,cancelHoleLink,pickHoleLinkTargetFromDrag}",
  });
}
