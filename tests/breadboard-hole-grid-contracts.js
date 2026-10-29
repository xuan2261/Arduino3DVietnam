import { listTerminals } from "../src/circuit-router.js";
import {
  BB830_RAIL_IDS,
  BREADBOARD_HOLE_GRID_PAGE_SIZE,
  compareBreadboardContactHoles,
  createBreadboardHoleGridPage,
  inspectBreadboardContactGroup,
  listBreadboardRailChoices,
  pickBreadboardGridHole,
  pickBreadboardRailHole,
} from "../src/breadboard-hole-grid.js";
import { mountBreadboardStudy } from "../src/breadboard-topology-ui.js";

const GENERIC = "generic-63x10-terminal-strips";
const BB830 = "busboard-bb830-rev7";

function assert(condition, message) {
  if (!condition) throw new Error("breadboard-hole-grid contract: " + message);
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
    throw new Error("hole-grid UI must not use innerHTML");
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

function columnHeaders(document) {
  return descendants(
    document.getElementById("bbHoleGrid"),
    node => typeof node.dataset.bbGridColumn === "string",
  );
}

function columnHeaderPlaceholders(document) {
  return descendants(
    document.getElementById("bbHoleGrid"),
    node => Object.hasOwn(node.dataset, "bbGridColumnEmpty"),
  );
}

function contactMemberButtons(document) {
  return holeButtons(document).filter(button => button.dataset.bbContactMember === "true");
}

function selectedContactButtons(document) {
  return holeButtons(document).filter(button => button.dataset.bbContactSelected === "true");
}

function lessonContext(lessonId) {
  return { lessonId, terminals: lessonId === 1 ? [] : listTerminals(lessonId) };
}

function registerBaseControls(document, { picker = true, omitPickerId = null } = {}) {
  const profile = document.register("bbProfile", "select");
  profile.value = GENERIC;
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
  if (picker) {
    const pickerControls = [
      ["bbHoleGrid", "div"],
      ["bbGridPrev", "button"],
      ["bbGridNext", "button"],
      ["bbGridPage", "span"],
      ["bbGridRail", "select"],
      ["bbGridRailHole", "input"],
      ["bbPickRail", "button"],
      ["bbGridStatus", "p"],
    ];
    for (const [id, tag] of pickerControls) {
      if (id !== omitPickerId) document.register(id, tag);
    }
    if (document.getElementById("bbGridRailHole")) {
      document.getElementById("bbGridRailHole").value = "1";
    }
  }
  return document;
}

function domFixture(lessonRef = { current: lessonContext(2) }) {
  const document = registerBaseControls(new FakeDocument());
  const ui = mountBreadboardStudy({
    doc: document,
    getLayout: () => ({ claims: { breadboardHoleMapping: false } }),
    getLessonTerminals: () => lessonRef.current,
  });
  return { document, ui, lessonRef };
}

export function runBreadboardHoleGridContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("page-size-fixed-at-eight", () => {
    assert(BREADBOARD_HOLE_GRID_PAGE_SIZE === 8, "page size drifted");
  });

  check("first-page-canonical-a-j-eight-columns", () => {
    const page = createBreadboardHoleGridPage({ profileId: GENERIC, page: 1 });
    assert(page.columns.join(",") === "1,2,3,4,5,6,7,8", "first-page columns");
    assert(page.holes.length === 80 && page.holes[0].id === "A1" && page.holes.at(-1).id === "J8", "first-page holes");
    assert(page.rows.join("") === "ABCDEFGHIJ", "row vocabulary");
  });

  check("last-page-bounded-to-column63", () => {
    const page = createBreadboardHoleGridPage({ profileId: GENERIC, page: 8 });
    assert(page.columnStart === 57 && page.columnEnd === 63, "last-page range");
    assert(page.columns.length === 7 && page.holes.length === 70, "last-page bounded DOM model");
    assert(page.holes[0].id === "A57" && page.holes.at(-1).id === "J63", "last-page endpoints");
  });

  check("pagination-boundaries-are-explicit", () => {
    const first = createBreadboardHoleGridPage({ profileId: GENERIC, page: 1 });
    const middle = createBreadboardHoleGridPage({ profileId: GENERIC, page: 4 });
    const last = createBreadboardHoleGridPage({ profileId: GENERIC, page: 8 });
    assert(first.previousPage === null && first.nextPage === 2, "first navigation");
    assert(middle.previousPage === 3 && middle.nextPage === 5, "middle navigation");
    assert(last.previousPage === 7 && last.nextPage === null, "last navigation");
  });

  check("grid-model-has-no-cad-or-scene-coordinates", () => {
    const page = createBreadboardHoleGridPage({ profileId: BB830, page: 3 });
    const keys = new Set(page.holes.flatMap(hole => Object.keys(hole)));
    for (const forbidden of ["x", "y", "z", "mm", "left", "top", "sceneX", "sceneZ"]) {
      assert(!keys.has(forbidden), "forbidden coordinate key " + forbidden);
    }
    assert(page.claims.cadCoordinatesProvided === false && page.claims.sceneCoordinatesProvided === false, "coordinate claims fail closed");
  });

  check("grid-selection-is-input-only", () => {
    const selected = pickBreadboardGridHole({ profileId: GENERIC, page: 2, holeId: " c9 " });
    assert(selected.holeId === "C9" && selected.selectionKind === "terminal-strip-input-only", "canonical strip selection");
    assert(selected.claims.inputValueOnly && !selected.claims.placementCreated && !selected.claims.circuitRouterMutated, "input-only claims");
  });

  check("generic-rails-stay-disabled", () => {
    const rails = listBreadboardRailChoices(GENERIC);
    assert(rails.enabled === false && rails.rails.length === 0, "generic rails must remain unknown/unmodeled");
    assert(rails.claims.genericRailContinuityAssumed === false, "generic rail continuity must not be assumed");
  });

  check("bb830-exposes-exact-four-signed-rails", () => {
    const rails = listBreadboardRailChoices(BB830);
    assert(rails.enabled && rails.rails.length === 4, "BB830 rail count");
    assert(rails.rails.map(rail => rail.id).join(",") === BB830_RAIL_IDS.join(","), "signed rail names");
    assert(rails.rails.every(rail => rail.holes === 50 && rail.continuityScope === "profile-internal-node-only"), "50-hole scope");
  });

  check("bb830-rail-endpoints-share-profile-node", () => {
    const first = pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: 1 });
    const last = pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: 50 });
    assert(first.nodeId === last.nodeId && first.nodeId === "rail:P1+", "P1+ continuity");
    assert(!first.claims.placementCreated && !first.claims.physicalContactSimulated, "rail selection is not simulated contact");
  });

  check("negative-invalid-profile-rejected", () => {
    expectThrow(() => createBreadboardHoleGridPage({ profileId: "invented", page: 1 }), /profile/i, "invalid profile");
  });

  check("negative-non-string-profile-rejected", () => {
    expectThrow(() => createBreadboardHoleGridPage({ profileId: { id: GENERIC }, page: 1 }), /profileId/i, "object profile");
  });

  check("negative-page-zero-rejected", () => {
    expectThrow(() => createBreadboardHoleGridPage({ profileId: GENERIC, page: 0 }), /phạm vi/i, "page zero");
  });

  check("negative-page-nine-rejected", () => {
    expectThrow(() => createBreadboardHoleGridPage({ profileId: GENERIC, page: 9 }), /phạm vi/i, "page nine");
  });

  check("negative-fractional-page-rejected", () => {
    expectThrow(() => createBreadboardHoleGridPage({ profileId: GENERIC, page: 1.5 }), /số nguyên/i, "fraction page");
  });

  check("negative-string-page-rejected", () => {
    expectThrow(() => createBreadboardHoleGridPage({ profileId: GENERIC, page: "1" }), /số nguyên/i, "string page");
  });

  check("negative-invalid-strip-hole-rejected", () => {
    expectThrow(() => pickBreadboardGridHole({ profileId: GENERIC, page: 1, holeId: "A0" }), /A1\.\.J63/i, "A0");
  });

  check("negative-rail-cannot-masquerade-as-strip-hole", () => {
    expectThrow(() => pickBreadboardGridHole({ profileId: BB830, page: 1, holeId: "P1+1" }), /A1\.\.J63/i, "rail in strip picker");
  });

  check("negative-strip-hole-must-belong-to-current-page", () => {
    expectThrow(() => pickBreadboardGridHole({ profileId: GENERIC, page: 1, holeId: "A9" }), /không thuộc trang/i, "off-page hole");
  });

  check("negative-generic-rail-pick-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: GENERIC, railId: "P1+", index: 1 }), /bị khóa|chưa xác minh/i, "generic rail pick");
  });

  check("negative-unknown-rail-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P3+", index: 1 }), /P1\+|Rail picker/i, "P3+");
  });

  check("negative-unsigned-rail-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P1", index: 1 }), /P1\+|Rail picker/i, "unsigned rail");
  });

  check("negative-rail-zero-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: 0 }), /1\.\.50/i, "rail zero");
  });

  check("negative-rail-51-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: 51 }), /1\.\.50/i, "rail 51");
  });

  check("negative-fractional-rail-index-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: 2.5 }), /1\.\.50/i, "fraction rail");
  });

  check("negative-scientific-rail-string-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: "1e1" }), /1\.\.50/i, "scientific rail");
  });

  check("negative-leading-zero-rail-string-rejected", () => {
    expectThrow(() => pickBreadboardRailHole({ profileId: BB830, railId: "P1+", index: "01" }), /1\.\.50/i, "leading zero rail");
  });

  check("dom-renders-bounded-native-touch-size-buttons", () => {
    const fixture = domFixture();
    try {
      const buttons = holeButtons(fixture.document);
      const grid = fixture.document.getElementById("bbHoleGrid");
      assert(buttons.length === 80, "page1 button count");
      assert(buttons.every(button => button.type === "button"), "native button type");
      assert(buttons.every(button => button.style.minWidth === "44px" && button.style.minHeight === "44px"), "44px target minimum");
      assert(buttons.every(button => button.getAttribute("tabindex") === null), "native keyboard tab behavior");
      assert(buttons.every(button => button.dataset.bbPickHole === button.dataset.bbGridHole), "CSS picker hook matches canonical hole ID");
      assert(grid.style.maxWidth === "100%" && grid.style.boxSizing === "border-box", "grid remains bounded by owning scroller");
      assert(descendants(grid,node=>Object.hasOwn(node.dataset,"bbGridTrench")).length === 1, "center trench marker rendered once");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-page1-renders-eight-visible-column-headers", () => {
    const fixture = domFixture();
    try {
      const headers = columnHeaders(fixture.document);
      assert(headers.length === 8, "page1 must render exactly eight valid column headers");
      assert(headers.map(header => header.dataset.bbGridColumn).join(",") === "1,2,3,4,5,6,7,8", "page1 header IDs");
      assert(headers.map(header => header.textContent).join(",") === "1,2,3,4,5,6,7,8", "page1 visible header text");
      assert(headers.every(header => header.tagName === "SPAN" && header.type === ""), "headers are noninteractive text spans");
      assert(columnHeaderPlaceholders(fixture.document).length === 0, "full page must not need header placeholder");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-page2-renders-eight-visible-column-headers", () => {
    const fixture = domFixture();
    try {
      fixture.document.getElementById("bbGridNext").click();
      const headers = columnHeaders(fixture.document);
      assert(headers.length === 8, "page2 must render exactly eight valid column headers");
      assert(headers.map(header => header.dataset.bbGridColumn).join(",") === "9,10,11,12,13,14,15,16", "page2 header IDs");
      assert(headers.map(header => header.textContent).join(",") === "9,10,11,12,13,14,15,16", "page2 visible header text");
      assert(columnHeaderPlaceholders(fixture.document).length === 0, "full page2 no header placeholder");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-final-page-column-header-row-is-bounded", () => {
    const fixture = domFixture();
    try {
      for (let index = 0; index < 7; index += 1) fixture.document.getElementById("bbGridNext").click();
      const headers = columnHeaders(fixture.document);
      const placeholders = columnHeaderPlaceholders(fixture.document);
      assert(headers.length === 7, "page8 must expose only seven valid column headers");
      assert(headers.map(header => header.dataset.bbGridColumn).join(",") === "57,58,59,60,61,62,63", "page8 header IDs bounded at63");
      assert(placeholders.length === 1 && placeholders[0].getAttribute("aria-hidden") === "true", "page8 needs one hidden noninteractive header placeholder");
      assert(headers.length + placeholders.length === 8, "page8 header row remains eight grid cells");
      assert(placeholders[0].tagName === "SPAN" && placeholders[0].textContent === "", "placeholder is not a fake hole/button/header value");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-grid-status-is-accessible-live-region", () => {
    const fixture = domFixture();
    try {
      const status = fixture.document.getElementById("bbGridStatus");
      assert(status.getAttribute("role") === "status" && status.getAttribute("aria-live") === "polite", "grid status semantics");
      assert(/chỉ điền ô|nút Gán lỗ/i.test(status.textContent), "input-only status boundary");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-strip-click-only-fills-input", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "C3").click();
      assert(fixture.document.getElementById("bbPlaceHole").value === "C3", "strip pick fills input");
      assert(fixture.ui.getAuthoredPlacement() === null, "strip pick must not create placement");
      assert(fixture.document.getElementById("bbGridStatus").dataset.result === "selected", "strip pick status");
      assert(/Chưa tạo placement|cần bấm/i.test(fixture.document.getElementById("bbGridStatus").textContent), "explicit assign disclosure");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-explicit-assign-remains-only-placement-gate", () => {
    const fixture = domFixture();
    try {
      fixture.document.getElementById("bbTerminal").value = "D13";
      holeButton(fixture.document, "A1").click();
      assert(fixture.ui.getAuthoredPlacement() === null, "picker alone no placement");
      fixture.document.getElementById("bbAssignHole").click();
      assert(fixture.ui.getAuthoredPlacement()?.terminalToHole.D13 === "A1", "explicit assign commits placement");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-next-page-renders-columns9-through16", () => {
    const fixture = domFixture();
    try {
      fixture.document.getElementById("bbGridNext").click();
      const page = fixture.document.getElementById("bbGridPage");
      assert(page.dataset.page === "2" && /9–16/.test(page.textContent), "page2 label");
      assert(holeButtons(fixture.document).length === 80, "page2 bounded count");
      assert(holeButton(fixture.document, "A9") && holeButton(fixture.document, "J16"), "page2 endpoint buttons");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-last-page-is-bounded-and-next-disabled", () => {
    const fixture = domFixture();
    try {
      for (let index = 0; index < 7; index += 1) fixture.document.getElementById("bbGridNext").click();
      assert(fixture.document.getElementById("bbGridPage").dataset.page === "8", "page8 reached");
      assert(holeButtons(fixture.document).length === 70, "page8 only 70 buttons");
      assert(descendants(fixture.document.getElementById("bbHoleGrid"),node=>Object.hasOwn(node.dataset,"bbGridEmpty")).length === 10,
        "page8 keeps ten row-alignment placeholders for missing column64");
      assert(fixture.document.getElementById("bbGridNext").disabled, "next disabled at end");
      fixture.document.getElementById("bbGridNext").click();
      assert(fixture.document.getElementById("bbGridPage").dataset.page === "8", "disabled next cannot overflow page count");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-prev-is-disabled-on-first-page", () => {
    const fixture = domFixture();
    try {
      const prev = fixture.document.getElementById("bbGridPrev");
      assert(prev.disabled, "prev disabled page1");
      prev.click();
      assert(fixture.document.getElementById("bbGridPage").dataset.page === "1", "disabled prev stays page1");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-generic-rail-controls-are-disabled", () => {
    const fixture = domFixture();
    try {
      assert(fixture.document.getElementById("bbGridRail").disabled, "generic rail select disabled");
      assert(fixture.document.getElementById("bbGridRailHole").disabled, "generic rail index disabled");
      assert(fixture.document.getElementById("bbPickRail").disabled, "generic rail pick disabled");
      const before = fixture.document.getElementById("bbPlaceHole").value;
      fixture.document.getElementById("bbPickRail").click();
      assert(fixture.document.getElementById("bbPlaceHole").value === before, "disabled generic rail cannot change input");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-bb830-enables-exact-four-rail-options", () => {
    const fixture = domFixture();
    try {
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      const rail = fixture.document.getElementById("bbGridRail");
      assert(!rail.disabled && rail.children.length === 4, "BB830 rail controls enabled");
      assert(rail.children.map(option => option.value).join(",") === BB830_RAIL_IDS.join(","), "BB830 rail option IDs");
      assert(fixture.document.getElementById("bbGridRailHole").value === "1", "rail index reset");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-bb830-rail-pick-only-fills-input", () => {
    const fixture = domFixture();
    try {
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      fixture.document.getElementById("bbGridRail").value = "P2-";
      fixture.document.getElementById("bbGridRailHole").value = "50";
      fixture.document.getElementById("bbPickRail").click();
      assert(fixture.document.getElementById("bbPlaceHole").value === "P2-50", "rail pick canonical input");
      assert(fixture.ui.getAuthoredPlacement() === null, "rail pick must not create placement");
      assert(/Chưa tạo placement|cần bấm/i.test(fixture.document.getElementById("bbGridStatus").textContent), "rail input-only disclosure");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-dom-invalid-rail-index-does-not-change-input", () => {
    const fixture = domFixture();
    try {
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      const input = fixture.document.getElementById("bbPlaceHole");
      input.value = "A12";
      const railHole = fixture.document.getElementById("bbGridRailHole");
      railHole.value = "51";
      fixture.document.getElementById("bbPickRail").click();
      assert(input.value === "A12" && fixture.ui.getAuthoredPlacement() === null, "invalid rail index no mutation");
      assert(railHole.getAttribute("aria-invalid") === "true", "invalid rail aria state");
      assert(fixture.document.getElementById("bbGridStatus").dataset.result === "error", "invalid rail status");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-dom-forged-rail-name-does-not-change-input", () => {
    const fixture = domFixture();
    try {
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      const input = fixture.document.getElementById("bbPlaceHole");
      input.value = "A12";
      fixture.document.getElementById("bbGridRail").value = "P3+";
      fixture.document.getElementById("bbGridRailHole").value = "1";
      fixture.document.getElementById("bbPickRail").click();
      assert(input.value === "A12" && fixture.ui.getAuthoredPlacement() === null, "forged rail no mutation");
      assert(fixture.document.getElementById("bbGridStatus").dataset.result === "error", "forged rail status");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-lesson-switch-resets-picker-page-and-input", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      fixture.document.getElementById("bbGridNext").click();
      holeButton(fixture.document, "A9").click();
      assert(fixture.document.getElementById("bbPlaceHole").value === "A9", "pre-switch picker state");
      ref.current = lessonContext(3);
      fixture.ui.update();
      assert(fixture.document.getElementById("bbGridPage").dataset.page === "1", "lesson reset page1");
      assert(fixture.document.getElementById("bbPlaceHole").value === "A12", "lesson reset transient input");
      assert(fixture.ui.getAuthoredPlacement() === null, "lesson reset no stale placement");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-profile-switch-resets-picker-page", () => {
    const fixture = domFixture();
    try {
      fixture.document.getElementById("bbGridNext").click();
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      assert(fixture.document.getElementById("bbGridPage").dataset.page === "1", "profile reset page1");
      assert(fixture.document.getElementById("bbGridRail").value === "P1+", "profile reset default rail");
      assert(fixture.document.getElementById("bbGridRailHole").value === "1", "profile reset default rail index");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-dom-invalid-profile-fails-closed", () => {
    const fixture = domFixture();
    try {
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = "invented-profile";
      profile.change();
      assert(fixture.document.getElementById("bbHoleGrid").dataset.state === "error", "invalid profile grid error");
      assert(holeButtons(fixture.document).length === 0, "invalid profile clears buttons");
      assert(fixture.document.getElementById("bbGridPrev").disabled && fixture.document.getElementById("bbGridNext").disabled, "invalid profile navigation disabled");
      assert(fixture.document.getElementById("bbPickRail").disabled, "invalid profile rail disabled");
      assert(fixture.ui.getAuthoredPlacement() === null, "invalid profile no placement");
    } finally { fixture.ui.dispose(); }
  });

  check("dom-lesson01-disables-picker-buttons", () => {
    const ref = { current: lessonContext(1) };
    const fixture = domFixture(ref);
    try {
      assert(holeButtons(fixture.document).length === 80, "lesson01 keeps bounded reference grid visible");
      assert(holeButtons(fixture.document).every(button => button.disabled), "lesson01 hole buttons disabled");
      assert(fixture.document.getElementById("bbGridPrev").disabled && fixture.document.getElementById("bbGridNext").disabled, "lesson01 navigation disabled");
      assert(fixture.document.getElementById("bbPickRail").disabled, "lesson01 rail disabled");
      assert(/Bài 01/.test(fixture.document.getElementById("bbGridStatus").textContent), "lesson01 picker status");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-dom-partial-picker-controls-rejected", () => {
    const document = registerBaseControls(new FakeDocument(), { picker: true, omitPickerId: "bbGridStatus" });
    expectThrow(
      () => mountBreadboardStudy({
        doc: document,
        getLayout: () => ({ claims: { breadboardHoleMapping: false } }),
        getLessonTerminals: () => lessonContext(2),
      }),
      /hole picker thiếu/i,
      "partial picker DOM",
    );
  });

  check("dom-dispose-removes-rendered-hole-listeners", () => {
    const fixture = domFixture();
    const button = holeButton(fixture.document, "A1");
    const input = fixture.document.getElementById("bbPlaceHole");
    fixture.ui.dispose();
    input.value = "A12";
    button.click();
    assert(input.value === "A12" && fixture.ui.getAuthoredPlacement() === null, "disposed picker inert");
  });

  check("contact-model-left-strip-members-and-provenance", () => {
    const inspected = inspectBreadboardContactGroup({ profileId: GENERIC, holeId: " c3 " });
    assert(inspected.status === "known" && inspected.holeId === "C3", "left strip inspection known/canonical");
    assert(inspected.nodeId === "strip:3:left" && inspected.contactRegion === "left-terminal-strip", "left node identity");
    assert(inspected.members.join(",") === "A3,B3,C3,D3,E3", "left five-hole group");
    assert(inspected.neighbors.join(",") === "A3,B3,D3,E3", "left comparable neighbors");
    assert(inspected.provenance.scope === "generic-terminal-field-only" && inspected.provenance.sources.length >= 2, "profile provenance exposed");
    assert(inspected.claims.profileInternalContactKnown === true && inspected.claims.circuitRouterInspected === false,
      "contact model remains profile-only");
  });

  check("contact-model-right-strip-respects-center-gap", () => {
    const inspected = inspectBreadboardContactGroup({ profileId: GENERIC, holeId: "H12" });
    assert(inspected.nodeId === "strip:12:right" && inspected.contactRegion === "right-terminal-strip", "right node identity");
    assert(inspected.members.join(",") === "F12,G12,H12,I12,J12", "right five-hole group");
    const compared = compareBreadboardContactHoles({ profileId: GENERIC, firstHoleId: "E12", secondHoleId: "F12" });
    assert(compared.status === "different-node" && compared.sameContactGroup === false, "center gap stays separate");
  });

  check("contact-model-same-strip-comparison", () => {
    const compared = compareBreadboardContactHoles({ profileId: GENERIC, firstHoleId: "A8", secondHoleId: "E8" });
    assert(compared.status === "same-node" && compared.sameContactGroup === true, "A-E same column same node");
    assert(compared.first.nodeId === "strip:8:left" && compared.second.nodeId === "strip:8:left", "comparison node IDs");
    assert(compared.claims.externalWireInspected === false && compared.claims.physicalContactSimulated === false,
      "comparison has no external/physical inference");
  });

  check("contact-model-generic-rail-is-unknown", () => {
    const inspected = inspectBreadboardContactGroup({ profileId: GENERIC, holeId: "P1+25" });
    assert(inspected.status === "unknown" && inspected.nodeId === null, "generic rail unknown");
    assert(inspected.members.length === 0 && inspected.neighbors.length === 0, "generic rail exposes no invented members");
    assert(inspected.reason === "profile-power-rail-unverified", "generic rail unknown reason");
  });

  check("contact-model-bb830-rail-is-independent-fifty-hole-node", () => {
    const inspected = inspectBreadboardContactGroup({ profileId: BB830, holeId: "P2-17" });
    assert(inspected.status === "known" && inspected.nodeId === "rail:P2-" && inspected.nodeKind === "power-rail", "BB830 rail known");
    assert(inspected.members.length === 50 && inspected.neighbors.length === 49, "BB830 rail 50-hole group");
    assert(inspected.members[0] === "P2-1" && inspected.members.at(-1) === "P2-50", "BB830 rail endpoints");
    const separate = compareBreadboardContactHoles({ profileId: BB830, firstHoleId: "P2-1", secondHoleId: "P1+1" });
    assert(separate.status === "different-node" && separate.sameContactGroup === false, "signed rails stay independent");
    const same = compareBreadboardContactHoles({ profileId: BB830, firstHoleId: "P2-1", secondHoleId: "P2-50" });
    assert(same.status === "same-node" && same.sameContactGroup === true, "same BB830 rail continuous within profile");
  });

  check("negative-contact-model-invalid-hole-rejected", () => {
    expectThrow(() => inspectBreadboardContactGroup({ profileId: GENERIC, holeId: "K1" }), /A1\.\.J63|P1/i, "invalid contact hole");
    expectThrow(() => compareBreadboardContactHoles({ profileId: GENERIC, firstHoleId: "A1", secondHoleId: "P3+1" }), /P1|P2/i,
      "invalid compare hole");
  });

  check("contact-dom-left-group-highlights-five-only", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "C3").click();
      const members = contactMemberButtons(fixture.document);
      const selected = selectedContactButtons(fixture.document);
      const grid = fixture.document.getElementById("bbHoleGrid");
      const trench = descendants(grid, node => node.dataset.bbContactBoundary === "center-gap");
      assert(members.map(button => button.dataset.bbGridHole).join(",") === "A3,B3,C3,D3,E3", "left visual contact members");
      assert(selected.length === 1 && selected[0].dataset.bbGridHole === "C3", "selected contact hole hook");
      assert(members.every(button => button.dataset.bbContactSide === "left"), "left member side hook");
      assert(trench.length === 1, "center trench remains explicit boundary");
      assert(grid.dataset.bbContactNode === "strip:3:left" && grid.dataset.bbContactProfile === GENERIC, "grid node/profile hooks");
      assert(fixture.ui.getAuthoredPlacement() === null, "contact highlight creates no placement");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-right-group-never-crosses-trench", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "H3").click();
      const members = contactMemberButtons(fixture.document);
      assert(members.map(button => button.dataset.bbGridHole).join(",") === "F3,G3,H3,I3,J3", "right visual contact members");
      assert(members.every(button => button.dataset.bbContactSide === "right"), "right member side hook");
      assert(!members.some(button => /^[A-E]/.test(button.dataset.bbGridHole)), "highlight must not cross E/F trench");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-accessible-status-has-node-provenance-neighbors-and-safe-compare", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "A1").click();
      const status = fixture.document.getElementById("bbGridStatus");
      const inspection = fixture.ui.getContactInspection();
      assert(inspection?.nodeId === "strip:1:left" && inspection.neighbors.length === 4, "UI exposes immutable contact inspection");
      assert(/strip:1:left/.test(status.textContent) && /provenance generic-terminal-field-only/.test(status.textContent), "accessible node/provenance text");
      assert(/A1, B1, C1, D1, E1/.test(status.textContent), "accessible contact neighbors/group text");
      assert(status.dataset.bbContactCompareA === "same-node" && status.dataset.bbContactCompareB === "same-node",
        "safe comparisons to current A1/E1 inputs");
      assert(/chưa tạo placement/i.test(status.textContent), "status preserves input-only boundary");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-current-compare-input-refresh-is-read-only", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "A1").click();
      const holeB = fixture.document.getElementById("bbHoleB");
      holeB.value = "F1";
      holeB.input();
      const status = fixture.document.getElementById("bbGridStatus");
      assert(status.dataset.bbContactCompareA === "same-node" && status.dataset.bbContactCompareB === "different-node",
        "comparison status refreshes without compare button");
      assert(fixture.document.getElementById("bbHoleA").value === "A1" && holeB.value === "F1", "contact comparison does not mutate compare inputs");
      assert(fixture.ui.getAuthoredPlacement() === null, "contact comparison creates no placement");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-contact-dom-invalid-compare-input-does-not-break-selection", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "A1").click();
      const holeA = fixture.document.getElementById("bbHoleA");
      holeA.value = "<bad>";
      holeA.input();
      const status = fixture.document.getElementById("bbGridStatus");
      assert(status.dataset.bbContactCompareA === "invalid-input", "invalid compare field fails closed locally");
      assert(contactMemberButtons(fixture.document).length === 5 && selectedContactButtons(fixture.document)[0].dataset.bbGridHole === "A1",
        "valid selected contact remains inspectable");
      assert(fixture.ui.getAuthoredPlacement() === null, "invalid comparison cannot assign");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-manual-place-input-clears-stale-highlight", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "A1").click();
      const input = fixture.document.getElementById("bbPlaceHole");
      input.value = "B2";
      input.input();
      assert(fixture.ui.getContactInspection() === null, "manual input clears contact inspection");
      assert(contactMemberButtons(fixture.document).length === 0 && selectedContactButtons(fixture.document).length === 0, "manual input clears visual group");
      assert(/sửa thủ công/.test(fixture.document.getElementById("bbGridStatus").textContent), "manual input reset status");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-page-navigation-clears-inspection-but-keeps-picked-input", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "C3").click();
      fixture.document.getElementById("bbGridNext").click();
      assert(fixture.ui.getContactInspection() === null, "page navigation clears contact inspection");
      assert(contactMemberButtons(fixture.document).length === 0, "page navigation clears contact highlight");
      assert(fixture.document.getElementById("bbPlaceHole").value === "C3", "historical picked input persists across page navigation");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-all-eight-pages-highlight-exact-five-strip-members", () => {
    for (let page = 1; page <= 8; page += 1) {
      const fixture = domFixture();
      try {
        for (let step = 1; step < page; step += 1) fixture.document.getElementById("bbGridNext").click();
        const column = (page - 1) * 8 + 1;
        holeButton(fixture.document, "A" + column).click();
        const members = contactMemberButtons(fixture.document).map(button => button.dataset.bbGridHole);
        assert(members.join(",") === ["A","B","C","D","E"].map(row => row + column).join(","), "page" + page + " exact five left contacts");
        assert(holeButtons(fixture.document).every(button => button.style.minWidth === "44px" && button.style.minHeight === "44px"),
          "page" + page + " keeps44px buttons");
      } finally { fixture.ui.dispose(); }
    }
  });

  check("contact-dom-lesson-and-profile-reset-clear-inspection", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      holeButton(fixture.document, "A1").click();
      ref.current = lessonContext(3);
      fixture.ui.update();
      assert(fixture.ui.getContactInspection() === null && contactMemberButtons(fixture.document).length === 0, "lesson reset clears contact state");
      holeButton(fixture.document, "A1").click();
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      assert(fixture.ui.getContactInspection() === null && contactMemberButtons(fixture.document).length === 0, "profile reset clears contact state");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-bb830-rail-status-is-known-independent-and-input-only", () => {
    const fixture = domFixture();
    try {
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = BB830;
      profile.change();
      fixture.document.getElementById("bbGridRail").value = "P1+";
      fixture.document.getElementById("bbGridRailHole").value = "25";
      fixture.document.getElementById("bbPickRail").click();
      const inspection = fixture.ui.getContactInspection();
      const status = fixture.document.getElementById("bbGridStatus");
      assert(inspection?.nodeId === "rail:P1+" && inspection.members.length === 50 && inspection.neighbors.length === 49, "BB830 UI rail inspection");
      assert(/node rail:P1\+/.test(status.textContent) && /node 50 lỗ độc lập/.test(status.textContent), "BB830 accessible independent rail status");
      assert(contactMemberButtons(fixture.document).length === 0, "rail inspection does not fake strip highlight");
      assert(fixture.document.getElementById("bbPlaceHole").value === "P1+25" && fixture.ui.getAuthoredPlacement() === null,
        "BB830 rail remains input-only before assign");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-duplicate-session-still-fails-only-at-explicit-assign", () => {
    const fixture = domFixture();
    try {
      const terminal = fixture.document.getElementById("bbTerminal");
      terminal.value = "D13";
      holeButton(fixture.document, "A1").click();
      fixture.document.getElementById("bbAssignHole").click();
      assert(fixture.ui.getAuthoredPlacement()?.terminalToHole.D13 === "A1", "first explicit assignment committed");
      terminal.value = "R1:A";
      terminal.change();
      holeButton(fixture.document, "A1").click();
      assert(fixture.ui.getAuthoredPlacement()?.placements.length === 1, "contact selection alone does not attempt duplicate assignment");
      fixture.document.getElementById("bbAssignHole").click();
      assert(fixture.ui.getAuthoredPlacement()?.placements.length === 1, "duplicate explicit assign rejected atomically");
      assert(fixture.document.getElementById("bbPlacementStatus").dataset.result === "error", "duplicate remains session-validator error");
    } finally { fixture.ui.dispose(); }
  });

  check("contact-dom-highlight-preserves-native-focus-and-touch-contract", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "C3").click();
      const members = contactMemberButtons(fixture.document);
      assert(members.length === 5, "five highlighted members");
      assert(members.every(button => button.type === "button" && button.getAttribute("tabindex") === null),
        "highlight keeps native keyboard focus semantics");
      assert(members.every(button => button.style.minWidth === "44px" && button.style.minHeight === "44px"),
        "highlight keeps44px minimum target");
      assert(members.every(button => button.style.borderWidth === "3px" && /cùng nhóm tiếp xúc strip:3:left/.test(button.getAttribute("aria-label") || "")),
        "highlight is visually and accessibly explicit");
      const selected = selectedContactButtons(fixture.document)[0];
      assert(selected.style.textDecoration === "underline" && selected.getAttribute("aria-pressed") === "true",
        "selected member remains distinct without changing pressed semantics");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-contact-dom-invalid-profile-clears-contact-state", () => {
    const fixture = domFixture();
    try {
      holeButton(fixture.document, "A1").click();
      assert(fixture.ui.getContactInspection()?.nodeId === "strip:1:left", "precondition contact selected");
      const profile = fixture.document.getElementById("bbProfile");
      profile.value = "invented-profile";
      profile.change();
      assert(fixture.ui.getContactInspection() === null, "invalid profile clears contact inspection");
      assert(contactMemberButtons(fixture.document).length === 0, "invalid profile clears contact highlight");
      assert(fixture.document.getElementById("bbHoleGrid").dataset.state === "error", "invalid profile leaves picker fail-closed");
    } finally { fixture.ui.dispose(); }
  });

  check("negative-contact-dom-invalid-lesson-context-clears-contact-state", () => {
    const ref = { current: lessonContext(2) };
    const fixture = domFixture(ref);
    try {
      holeButton(fixture.document, "A1").click();
      assert(fixture.ui.getContactInspection()?.nodeId === "strip:1:left", "precondition contact selected");
      ref.current = { lessonId: 2, terminals: "forged" };
      fixture.ui.update();
      assert(fixture.ui.getContactInspection() === null, "invalid lesson context clears contact inspection");
      assert(contactMemberButtons(fixture.document).length === 0, "invalid lesson context clears contact highlight");
      assert(fixture.document.getElementById("bbHoleGrid").dataset.state === "error", "invalid lesson context leaves picker fail-closed");
    } finally { fixture.ui.dispose(); }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
