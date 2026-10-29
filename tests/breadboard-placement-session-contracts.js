import { listTerminals } from "../src/circuit-router.js";
import {
  createBreadboardPlacementSession,
} from "../src/breadboard-placement-session.js";
import { validateBreadboardPlacement } from "../src/breadboard-placement.js";
import { mountBreadboardStudy } from "../src/breadboard-topology-ui.js";

function assert(condition, message) {
  if (!condition) throw new Error("breadboard-placement-session contract: " + message);
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
    throw new Error("breadboard placement UI must not use innerHTML");
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
    let prevented = false;
    const event = {
      target: this,
      key: extra.key,
      preventDefault() { prevented = true; },
      ...extra,
    };
    for (const callback of this.listeners.get(type) ?? []) callback(event);
    return { prevented };
  }

  click() {
    return this.dispatch("click");
  }

  change() {
    return this.dispatch("change");
  }
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  createElementNS(namespaceURI, tagName) {
    return new FakeNode(tagName, this, namespaceURI);
  }

  getElementById(id) {
    return this.byId.get(id) ?? null;
  }

  register(id, tagName = "div") {
    const node = new FakeNode(tagName, this);
    this.byId.set(id, node);
    return node;
  }
}

function domFixture(lessonRef) {
  const document = new FakeDocument();
  const profile = document.register("bbProfile", "select");
  profile.value = "generic-63x10-terminal-strips";
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
  const ui = mountBreadboardStudy({
    doc: document,
    getLayout: () => ({ claims: { breadboardHoleMapping: false } }),
    getLessonTerminals: () => lessonRef.current,
  });
  return {
    document,
    ui,
    restore() { /* DOM fixture injected; Window.document never modified. */ },
  };
}

function lessonContext(lessonId) {
  return { lessonId, terminals: lessonId === 1 ? [] : listTerminals(lessonId) };
}

export function runBreadboardPlacementSessionContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("lesson01-session-disabled", () => {
    const session = createBreadboardPlacementSession(lessonContext(1));
    assert(session.snapshot().enabled === false, "lesson01 must be disabled");
    assert(session.getPlacement() === null, "lesson01 must start without placement");
    expectThrow(() => session.assign("D13", "A1"), /Bài 01|vô hiệu/i, "lesson01 assign rejected");
  });

  check("valid-assignment-is-canonical-and-validated", () => {
    const terminals = listTerminals(2);
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals });
    const placement = session.assign("D13", " a12 ");
    const validation = validateBreadboardPlacement(placement, terminals);
    assert(validation.ok && placement.terminalToHole.D13 === "A12", "hole canonicalization/validation");
    assert(
      placement.claims.mechanicalFitVerified === false &&
      placement.claims.sceneCoordinateMapped === false &&
      placement.claims.circuitRouterMutated === false &&
      placement.claims.externalJumperContinuityVerified === false &&
      placement.claims.physicalCircuitSafetyVerified === false &&
      placement.claims.electricalPowerInferred === false,
      "session placement must preserve fail-closed physical/electrical claims",
    );
  });

  check("identical-context-preserves-authored-state", () => {
    const terminals = listTerminals(2);
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals });
    const before = session.assign("D13", "A12");
    const sync = session.sync({
      lessonId: 2,
      terminals: terminals.map(terminal => ({ ...terminal })),
      profileId: "generic-63x10-terminal-strips",
    });
    assert(sync.reset === false && session.getPlacement() === before, "same context must preserve placement");
  });

  check("lesson-change-resets-authored-state", () => {
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals: listTerminals(2) });
    session.assign("D13", "A12");
    const sync = session.sync({ lessonId: 3, terminals: listTerminals(3), profileId: "generic-63x10-terminal-strips" });
    assert(sync.reset && sync.reason === "lesson", "lesson change reset reason");
    assert(session.snapshot().mapped === 0 && session.getPlacement() === null, "lesson change clears mapping");
  });

  check("profile-change-resets-and-bb830-rail-is-continuous", () => {
    const terminals = listTerminals(2);
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals });
    session.assign("D13", "A12");
    const sync = session.sync({ lessonId: 2, terminals, profileId: "busboard-bb830-rev7" });
    assert(sync.reset && sync.reason === "profile" && session.getPlacement() === null, "profile reset");
    session.assign("D13", "P1+1");
    const placement = session.assign("R1:A", "P1+50");
    const endpoints = placement.placements.filter(item => item.terminalId === "D13" || item.terminalId === "R1:A");
    assert(endpoints.length === 2 && endpoints.every(item => item.nodeId === "rail:P1+"), "BB830 full 50-hole rail node");
  });

  check("generic-rail-rejection-is-atomic", () => {
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals: listTerminals(2) });
    session.assign("D13", "A12");
    expectThrow(() => session.assign("R1:A", "P1+1"), /profile chứng minh/i, "generic rail rejected");
    assert(session.getPlacement().terminalToHole.D13 === "A12" && session.snapshot().mapped === 1,
      "failed rail assign must preserve prior mapping");
  });

  check("duplicate-hole-rejection-is-atomic", () => {
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals: listTerminals(2) });
    session.assign("D13", "A12");
    expectThrow(() => session.assign("R1:A", "A12"), /hai terminal/i, "duplicate occupancy rejected");
    assert(session.snapshot().mapped === 1 && session.getPlacement().terminalToHole.D13 === "A12",
      "duplicate failure must not commit");
  });

  check("terminal-vocabulary-change-resets", () => {
    const terminals = listTerminals(2);
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals });
    session.assign("D13", "A12");
    const sync = session.sync({ lessonId: 2, terminals: terminals.slice(0, -1), profileId: "generic-63x10-terminal-strips" });
    assert(sync.reset && sync.reason === "terminals" && session.getPlacement() === null, "terminal-set change reset");
  });

  check("invalid-context-and-foreign-terminal-rejected", () => {
    expectThrow(() => createBreadboardPlacementSession({ lessonId: 17, terminals: [] }), /1\.\.16/i, "lesson range");
    expectThrow(() => createBreadboardPlacementSession({ lessonId: 2, terminals: listTerminals(2), profileId: "invented" }), /profile/i, "profile allowlist");
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals: listTerminals(2) });
    expectThrow(() => session.assign("NOT:A:TERMINAL", "A1"), /bài học hiện tại/i, "foreign terminal");
  });

  check("remove-is-bounded-and-idempotent", () => {
    const session = createBreadboardPlacementSession({ lessonId: 2, terminals: listTerminals(2) });
    session.assign("D13", "A12");
    assert(session.remove("D13").removed === true && session.getPlacement() === null, "remove mapped terminal");
    assert(session.remove("D13").removed === false && session.snapshot().mapped === 0, "second remove is no-op");
  });

  check("dom-renders-current-canonical-terminals", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      const terminal = fixture.document.getElementById("bbTerminal");
      assert(terminal.children.length === listTerminals(2).length, "terminal option count");
      assert(terminal.children.every((option, index) => option.value === listTerminals(2)[index].id), "terminal IDs must be canonical");
      assert(terminal.disabled === false, "lesson02 terminal selector enabled");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-assignment-renders-text-and-exposes-placement", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      const terminal = fixture.document.getElementById("bbTerminal");
      terminal.value = "D13";
      const input = fixture.document.getElementById("bbPlaceHole");
      input.value = "a12";
      fixture.document.getElementById("bbAssignHole").click();
      const placement = fixture.ui.getAuthoredPlacement();
      const status = fixture.document.getElementById("bbPlacementStatus");
      const list = fixture.document.getElementById("bbPlacedList");
      assert(placement?.terminalToHole.D13 === "A12", "DOM assignment placement");
      assert(input.getAttribute("aria-invalid") === "false", "valid hole aria state");
      assert(status.dataset.result === "assigned" && /không tạo dây circuit-router/i.test(status.textContent), "assigned status boundary");
      assert(list.textContent.includes("D13 → A12") && /nhóm profile/.test(list.textContent), "authored list text");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-duplicate-occupancy-fails-without-state-corruption", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      const terminal = fixture.document.getElementById("bbTerminal");
      const input = fixture.document.getElementById("bbPlaceHole");
      terminal.value = "D13"; input.value = "A12";
      fixture.document.getElementById("bbAssignHole").click();
      terminal.value = "R1:A"; input.value = "A12";
      fixture.document.getElementById("bbAssignHole").click();
      assert(input.getAttribute("aria-invalid") === "true", "duplicate hole marked invalid");
      assert(fixture.document.getElementById("bbPlacementStatus").dataset.result === "error", "duplicate status error");
      assert(fixture.ui.getAuthoredPlacement().placements.length === 1, "prior placement survives duplicate failure");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-untrusted-hole-text-stays-text-and-is-rejected", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      const payload = "<img src=x onerror=alert(1)>";
      fixture.document.getElementById("bbTerminal").value = "D13";
      fixture.document.getElementById("bbPlaceHole").value = payload;
      fixture.document.getElementById("bbAssignHole").click();
      const status = fixture.document.getElementById("bbPlacementStatus");
      assert(status.dataset.result === "error" && /Không thể gán lỗ/.test(status.textContent), "invalid payload status");
      assert(fixture.document.getElementById("bbPlaceHole").getAttribute("aria-invalid") === "true", "invalid payload aria state");
      assert(fixture.ui.getAuthoredPlacement() === null, "invalid payload creates no mapping");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-generic-rail-fails-closed-then-bb830-accepts", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      const terminal = fixture.document.getElementById("bbTerminal");
      const input = fixture.document.getElementById("bbPlaceHole");
      terminal.value = "D13"; input.value = "P1+1";
      fixture.document.getElementById("bbAssignHole").click();
      assert(fixture.ui.getAuthoredPlacement() === null && input.getAttribute("aria-invalid") === "true", "generic rail unknown");
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = "busboard-bb830-rev7";
      profile.change();
      terminal.value = "D13"; input.value = "P1+1";
      fixture.document.getElementById("bbAssignHole").click();
      assert(fixture.ui.getAuthoredPlacement()?.terminalToHole.D13 === "P1+1", "BB830 rail accepted after explicit profile selection");
      assert(/liên tục 50 lỗ/.test(fixture.document.getElementById("bbTopologyDiagram").textContent), "BB830 diagram states bounded rail continuity");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-profile-change-clears-existing-draft", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      fixture.document.getElementById("bbTerminal").value = "D13";
      fixture.document.getElementById("bbPlaceHole").value = "A12";
      fixture.document.getElementById("bbAssignHole").click();
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = "busboard-bb830-rev7";
      profile.change();
      assert(fixture.ui.getAuthoredPlacement() === null, "profile change clears placement");
      assert(fixture.document.getElementById("bbPlaceHole").value === "A12", "profile reset clears transient hole draft");
      assert(fixture.document.getElementById("bbPlacementStatus").dataset.result === "reset", "profile reset status");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-lesson-change-clears-draft-and-refreshes-terminals", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      fixture.document.getElementById("bbTerminal").value = "D13";
      fixture.document.getElementById("bbPlaceHole").value = "A12";
      fixture.document.getElementById("bbAssignHole").click();
      ref.current = lessonContext(3);
      fixture.ui.update();
      const terminal = fixture.document.getElementById("bbTerminal");
      assert(fixture.ui.getAuthoredPlacement() === null, "lesson change clears placement");
      assert(terminal.children.length === listTerminals(3).length, "new lesson terminal options");
      assert(terminal.value === listTerminals(3)[0].id, "lesson reset selects first canonical terminal");
      assert(fixture.document.getElementById("bbPlaceHole").value === "A12", "lesson reset clears transient hole draft");
      assert(fixture.document.getElementById("bbPlacementStatus").dataset.result === "reset", "lesson reset status");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-lesson01-is-disabled-after-update", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      ref.current = lessonContext(1);
      fixture.ui.update();
      assert(fixture.document.getElementById("bbTerminal").disabled, "lesson01 terminal disabled");
      assert(fixture.document.getElementById("bbPlaceHole").disabled, "lesson01 hole disabled");
      assert(fixture.document.getElementById("bbAssignHole").disabled, "lesson01 assign disabled");
      assert(/LED L tích hợp/.test(fixture.document.getElementById("bbPlacementStatus").textContent), "lesson01 explanation");
      assert(fixture.ui.getAuthoredPlacement() === null, "lesson01 no placement");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dom-bad-callback-fails-closed-and-clears-stale-placement", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      fixture.document.getElementById("bbTerminal").value = "D13";
      fixture.document.getElementById("bbPlaceHole").value = "A12";
      fixture.document.getElementById("bbAssignHole").click();
      ref.current = { lessonId: 2, terminals: "forged" };
      fixture.ui.update();
      assert(fixture.ui.getAuthoredPlacement() === null, "bad callback must clear stale placement");
      assert(fixture.document.getElementById("bbTerminal").disabled, "bad context locks controls");
      assert(fixture.document.getElementById("bbTerminal").getAttribute("aria-invalid") === "true", "bad context aria-invalid");
      assert(fixture.document.getElementById("bbPlacementStatus").dataset.result === "error", "bad context status");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("existing-hole-compare-contract-remains-connected-separate-unknown", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      const a = fixture.document.getElementById("bbHoleA");
      const b = fixture.document.getElementById("bbHoleB");
      assert(fixture.ui.compare()?.status === "connected", "A1/E1 connected");
      b.value = "F1";
      assert(fixture.ui.compare()?.status === "separate", "A1/F1 separate");
      a.value = "P1+1"; b.value = "P1+2";
      assert(fixture.ui.compare()?.status === "unknown", "generic rail remains unknown");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("enter-assigns-and-remove-does-not-touch-compare-state", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      fixture.document.getElementById("bbTerminal").value = "D13";
      const input = fixture.document.getElementById("bbPlaceHole");
      input.value = "A12";
      const event = input.dispatch("keydown", { key: "Enter" });
      assert(event.prevented && fixture.ui.getAuthoredPlacement()?.terminalToHole.D13 === "A12", "Enter assignment");
      fixture.document.getElementById("bbRemoveHole").click();
      assert(fixture.ui.getAuthoredPlacement() === null, "remove button clears terminal mapping");
      assert(fixture.document.getElementById("bbPlacementStatus").dataset.result === "removed", "remove status");
    } finally { fixture.ui.dispose(); fixture.restore(); }
  });

  check("dispose-removes-authored-listeners", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      fixture.document.getElementById("bbTerminal").value = "D13";
      fixture.document.getElementById("bbPlaceHole").value = "A12";
      fixture.ui.dispose();
      fixture.document.getElementById("bbAssignHole").click();
      assert(fixture.ui.getAuthoredPlacement() === null, "disposed assign listener removed");
    } finally { fixture.restore(); }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
