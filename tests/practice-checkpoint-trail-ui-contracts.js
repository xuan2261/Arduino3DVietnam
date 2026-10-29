import { lessonById } from "../src/lessons.js";
import { buildPracticeCheckpointTrail } from "../src/practice-checkpoint-trail.js";
import { renderPracticeCheckpointTrail } from "../src/practice-checkpoint-trail-ui.js";
import { listPracticeCheckpoints } from "../src/practice-checkpoints.js";
import { connectCircuit, createCircuit } from "../src/circuit-router.js";

function assert(condition, message) {
  if (!condition) throw new Error("practice-checkpoint-trail-ui contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function attrSelector(selector) {
  const match = /^\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/.exec(selector);
  return match ? { name: match[1], value: match[2] } : null;
}

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.type = "";
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

  set innerHTML(_value) {
    throw new Error("trail renderer must never use innerHTML");
  }

  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeNode, "append expects FakeNode");
      node.parentNode = this;
      this.children.push(node);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, callback) {
    const values = this.listeners.get(type) ?? [];
    values.push(callback);
    this.listeners.set(type, values);
  }

  click() {
    if (this.disabled) return;
    for (const callback of this.listeners.get("click") ?? []) callback({ target: this });
  }

  matches(selector) {
    const attr = attrSelector(selector);
    if (attr) {
      if (!this.attributes.has(attr.name)) return false;
      return attr.value === undefined || this.attributes.get(attr.name) === attr.value;
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
}

class FakeDocument {
  createElement(tagName) {
    return new FakeNode(tagName);
  }
}

function graphFor(lessonId, pairs = []) {
  let circuit = createCircuit(lessonId);
  for (const pair of pairs) circuit = connectCircuit(circuit, pair[0], pair[1]);
  return circuit;
}

function modelFor(lessonId = 2, currentStepIndex = 0, pairs = []) {
  const lesson = lessonById(lessonId);
  return buildPracticeCheckpointTrail({
    lesson,
    currentStepIndex,
    circuit: lessonId === 1 ? null : graphFor(lessonId, pairs),
  });
}

function render(model, options = {}) {
  return renderPracticeCheckpointTrail(new FakeDocument(), model, options);
}

export function runPracticeCheckpointTrailUiContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("semantic-native-root-list-status-and-three-step-buttons", () => {
    const section = render(modelFor(2, 1));
    assert(section.tagName === "SECTION", "root must be section");
    assert(section.getAttribute("data-practice-checkpoint-trail") === "", "root selector");
    assert(section.getAttribute("data-practice-trail-lesson") === "2", "lesson attr");
    assert(section.getAttribute("data-practice-trail-current-step") === "1", "current attr");
    assert(section.getAttribute("data-practice-trail-scope") === "topology", "scope attr");
    assert(Boolean(section.getAttribute("aria-label")), "root accessible name");

    const status = section.querySelector("[data-practice-trail-current-status]");
    assert(status?.tagName === "P" && status.getAttribute("role") === "status", "native live status");
    assert(status.getAttribute("aria-live") === "polite", "polite status");

    const list = section.querySelector("[data-practice-trail-list]");
    assert(list?.tagName === "OL", "native ordered list");
    const rows = section.querySelectorAll("[data-practice-trail-step]");
    const buttons = section.querySelectorAll("[data-practice-trail-navigate-step]");
    assert(rows.length === 3 && rows.every(row => row.tagName === "LI"), "exactly three native list rows");
    assert(buttons.length === 3 && buttons.every(button => button.tagName === "BUTTON" && button.type === "button"), "three native step buttons");
    assert(buttons[1].getAttribute("aria-current") === "step" && !buttons[1].disabled, "current step focusable semantics");
    assert(buttons.every(button => Boolean(button.getAttribute("aria-label"))), "all step buttons named");
  });

  check("all-three-source-goals-and-hints-render-from-model-without-rewriting", () => {
    const model = modelFor(16, 0);
    const section = render(model);
    const goals = section.querySelectorAll("[data-practice-trail-source-goal]");
    const hints = section.querySelectorAll("[data-practice-trail-source-hint]");
    assert(goals.length === 3 && hints.length === 3, "three source goals/hints");
    for (let index = 0; index < 3; index += 1) {
      assert(goals[index].textContent === model.steps[index].sourceGoal, "source goal exact " + index);
      assert(hints[index].textContent === model.steps[index].sourceHint, "source hint exact " + index);
    }
  });

  check("explicit-navigation-callback-fires-only-after-click-with-lesson-local-index", () => {
    const calls = [];
    const section = render(modelFor(2, 1), { onNavigateStep: index => calls.push(index) });
    assert(calls.length === 0, "render must not navigate");

    const previous = section.querySelector("[data-practice-trail-previous]");
    const next = section.querySelector("[data-practice-trail-next]");
    const steps = section.querySelectorAll("[data-practice-trail-navigate-step]");
    assert(!previous.disabled && !next.disabled, "middle prev/next enabled");
    previous.click();
    next.click();
    steps[0].click();
    steps[1].click();
    steps[2].click();
    assert(JSON.stringify(calls) === JSON.stringify([0, 2, 0, 2]), "exact callback indexes and current disabled");
    assert(calls.every(index => Number.isInteger(index) && index >= 0 && index <= 2), "callback bounded 0..2");
  });

  check("prev-next-boundaries-disable-native-controls", () => {
    const first = render(modelFor(2, 0), { onNavigateStep: () => {} });
    assert(first.querySelector("[data-practice-trail-previous]").disabled, "first previous disabled");
    assert(!first.querySelector("[data-practice-trail-next]").disabled, "first next enabled");
    const last = render(modelFor(2, 2), { onNavigateStep: () => {} });
    assert(!last.querySelector("[data-practice-trail-previous]").disabled, "last previous enabled");
    assert(last.querySelector("[data-practice-trail-next]").disabled, "last next disabled");
  });

  check("without-callback-only-current-step-remains-focusable-and-all-navigation-targets-disable", () => {
    const section = render(modelFor(2, 1));
    const steps = section.querySelectorAll("[data-practice-trail-navigate-step]");
    const navigationTargets = [
      steps[0],
      steps[2],
      section.querySelector("[data-practice-trail-previous]"),
      section.querySelector("[data-practice-trail-next]"),
    ];
    assert(steps[1].getAttribute("aria-current") === "step" && !steps[1].disabled,
      "current step stays focusable without callback");
    assert(navigationTargets.every(button => button.disabled && button.getAttribute("aria-disabled") === "true"),
      "noncurrent navigation disabled without host callback");
    steps[1].click();
  });

  check("only-onNavigateStep-option-is-accepted-and-prototypes-accessors-fail-closed", () => {
    const model = modelFor(2, 0);
    expectThrow(
      () => renderPracticeCheckpointTrail(new FakeDocument(), model, { onComplete: () => {} }),
      /chỉ hỗ trợ onNavigateStep/i,
      "unknown mutation callback rejected",
    );
    expectThrow(
      () => renderPracticeCheckpointTrail(new FakeDocument(), model, { onNavigateStep: "bad" }),
      /onNavigateStep.*function/i,
      "bad navigation callback rejected",
    );
    expectThrow(
      () => renderPracticeCheckpointTrail(new FakeDocument(), model, Object.create({ onNavigateStep() {} })),
      /prototype tùy biến/i,
      "option prototype rejected",
    );
    const accessor = {};
    Object.defineProperty(accessor, "onNavigateStep", {
      enumerable: true,
      get() { throw new Error("callback getter executed"); },
    });
    expectThrow(
      () => renderPracticeCheckpointTrail(new FakeDocument(), model, accessor),
      /own data property/i,
      "callback accessor rejected without execution",
    );
  });

  check("manual-rows-state-no-automatic-assessment-and-no-mastery-teacher-hardware-proof", () => {
    const section = render(modelFor(1, 0));
    const rows = section.querySelectorAll("[data-practice-trail-step]");
    assert(rows.every(row => row.getAttribute("data-practice-trail-step-kind") === "manual"), "lesson1 all manual rows");
    assert(rows.every(row => row.getAttribute("data-practice-trail-step-status") === "manual-not-automatically-assessed"), "manual status attr");
    assert(/không được tự động đánh giá/i.test(section.textContent), "manual automatic-assessment boundary");
    assert(/không xác nhận mastery, giáo viên hay phần cứng/i.test(section.textContent), "manual proof boundary");
    assert(section.querySelectorAll("[data-practice-trail-pair]").length === 0, "manual rows have no pair evidence");
  });

  check("wiring-pair-rows-render-exact-committed-and-missing-status-without-completion-wording", () => {
    const lesson = lessonById(2);
    const checkpoint = listPracticeCheckpoints(lesson)[0];
    const model = modelFor(2, 0, [checkpoint.requiredPairs[0]]);
    const section = render(model);
    const rows = section.querySelectorAll("[data-practice-trail-pair]");
    assert(rows.length === 3, "lesson2 three authored pair rows");
    assert(rows[0].getAttribute("data-practice-trail-pair-status") === "committed", "first committed row");
    assert(rows[1].getAttribute("data-practice-trail-pair-status") === "missing", "second missing row");
    assert(rows[2].getAttribute("data-practice-trail-pair-status") === "missing", "third missing row");
    assert(/đang có trong canonical learner graph/i.test(rows[0].textContent), "committed text remains graph evidence");
    assert(/còn thiếu trong canonical learner graph/i.test(rows[1].textContent), "missing text remains graph evidence");
    assert(!/đã hoàn thành|đã thành thạo|giáo viên xác nhận|mạch vật lý đúng/i.test(section.textContent), "no positive completion/mastery/physical claim");
  });

  check("signal-only-lessons-render-explicit-source-load-functional-boundary", () => {
    for (const lessonId of [10, 14]) {
      const section = render(modelFor(lessonId, 0));
      assert(section.getAttribute("data-practice-trail-scope") === "signal-only", "signal scope attr lesson " + lessonId);
      const note = section.querySelector("[data-practice-trail-signal-boundary]");
      assert(note && /tín hiệu\/GND/i.test(note.textContent), "signal/GND note lesson " + lessonId);
      assert(/nguồn, tải và chức năng phần cứng.*ngoài phạm vi/i.test(note.textContent), "functional boundary lesson " + lessonId);
    }
  });

  check("boundary-note-explicitly-denies-progress-auto-completion-mastery-teacher-and-hardware", () => {
    const section = render(modelFor(3, 2));
    const note = section.querySelector("[data-practice-trail-boundary]");
    assert(note?.getAttribute("role") === "note", "boundary semantic note");
    assert(/không ghi progress/i.test(note.textContent), "no progress");
    assert(/không tự hoàn thành bài/i.test(note.textContent), "no auto completion");
    assert(/không xác nhận mastery, giáo viên hay phần cứng/i.test(note.textContent), "no mastery/teacher/physical proof");
  });

  check("untrusted-model-text-is-rendered-only-through-textContent", () => {
    const payload = '<img src=x onerror="globalThis.pwned=1">';
    const base = modelFor(2, 0);
    const forged = {
      ...base,
      steps: base.steps.map((step, index) => index === 0 ? { ...step, sourceHint: payload } : step),
    };
    const section = render(forged);
    assert(section.textContent.includes(payload), "payload preserved as literal text");
    assert(section.querySelectorAll("img").length === 0, "payload cannot create DOM nodes");
  });

  check("bounded-model-shape-prevents-unbounded-step-or-pair-DOM", () => {
    const base = modelFor(16, 0);
    expectThrow(
      () => render({ ...base, steps: [...base.steps, base.steps[2]] }),
      /steps không khớp stepCount|đúng 3 bước/i,
      "fourth step rejected",
    );
    const oversizedStep = {
      ...base.steps[0],
      pairs: Array.from({ length: 17 }, (_unused, index) => ({
        order: index + 1,
        pair: ["D13", "GND"],
        status: "missing",
      })),
      requiredPairCount: 17,
      committedPairCount: 0,
      missingPairCount: 17,
    };
    expectThrow(
      () => render({ ...base, steps: [oversizedStep, base.steps[1], base.steps[2]] }),
      /vượt giới hạn DOM/i,
      "pair DOM bound",
    );
  });

  check("untrusted-trail-prototype-and-invalid-document-fail-fast", () => {
    const model = modelFor(2, 0);
    expectThrow(
      () => renderPracticeCheckpointTrail(null, model),
      /document/i,
      "missing document",
    );
    expectThrow(
      () => renderPracticeCheckpointTrail(new FakeDocument(), Object.create(model)),
      /prototype tùy biến/i,
      "trail prototype rejected",
    );
  });

  check("explicit-click-does-not-mutate-frozen-model", () => {
    const model = modelFor(16, 1);
    const before = JSON.stringify(model);
    const calls = [];
    const section = render(model, { onNavigateStep: index => calls.push(index) });
    section.querySelector("[data-practice-trail-next]").click();
    assert(JSON.stringify(model) === before, "model unchanged after callback");
    assert(Object.isFrozen(model) && Object.isFrozen(model.steps) && model.steps.every(Object.isFrozen), "model stays frozen");
    assert(JSON.stringify(calls) === "[2]", "only explicit click forwarded");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
