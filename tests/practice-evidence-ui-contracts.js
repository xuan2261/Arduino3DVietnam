import { renderPracticeEvidence } from "../src/practice-evidence-ui.js";
import { lessons } from "../src/lessons.js";
import { inspectPracticeEvidence } from "../src/practice-evidence.js";
import { analyzeCircuit, createSampleCircuit } from "../src/circuit-router.js";

function assert(condition, message) {
  if (!condition) throw new Error("practice-evidence-ui contract: " + message);
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
    this.hidden = false;
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
    throw new Error("renderer must not use innerHTML");
  }

  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeNode, "fake DOM append expects a node");
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
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
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

function evidence(overrides = {}) {
  return {
    lessonId: 2,
    stepIndex: 0,
    scope: "topology",
    status: "not-attempted",
    matched: 0,
    required: 2,
    missingPairs: [["D13", "R1:A"], ["R1:B", "LED:A"]],
    extraPairs: [],
    issues: [],
    summary: "Chưa có dây trong bản tự đấu.",
    nextAction: "Mở sơ đồ nối dây và tạo cạnh đầu tiên.",
    claims: { topologyOnly: true, physicalValidation: false, learnerMastery: false },
    ...overrides,
  };
}

function render(value, callbacks = {}) {
  return renderPracticeEvidence(new FakeDocument(), value, callbacks);
}

export function runPracticeEvidenceUiContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("exports-required-dom-contract-and-status-semantics", () => {
    const section = render(evidence());
    assert(section.tagName === "SECTION", "renderer must return section");
    assert(section.getAttribute("data-practice-evidence") === "", "root selector missing");
    assert(section.getAttribute("data-practice-status") === "not-attempted", "root status selector/value missing");
    assert(section.getAttribute("data-practice-scope") === "topology", "root scope missing");
    assert(section.getAttribute("data-practice-lesson") === "2", "root lesson missing");
    assert(section.getAttribute("data-practice-step") === "0", "root step missing");
    assert(section.getAttribute("data-practice-matched") === "0", "root matched count missing");
    assert(section.getAttribute("data-practice-required") === "2", "root required count missing");
    const status = section.querySelector("[data-practice-status-label]");
    assert(status?.getAttribute("role") === "status", "status role missing");
    assert(status?.getAttribute("aria-live") === "polite", "status live region missing");
    assert(section.querySelector("[data-practice-missing]"), "missing-pair selector absent");
    assert(section.querySelector("[data-practice-open-wiring]")?.tagName === "BUTTON", "wiring control must be native button");
    assert(section.querySelector("[data-practice-recheck]")?.tagName === "BUTTON", "recheck control must be native button");
  });

  check("untouched-in-app-draft-must-not-disprove-learner-action-elsewhere", () => {
    const section = render(evidence({status:"not-attempted"}));
    const copy = section.textContent;
    assert(/ứng dụng chưa ghi nhận bản tự đấu/i.test(copy),
      "not-attempted describes only the draft recorded in this app");
    assert(!/chưa có thao tác đấu dây của người học|chưa có dây do người học tạo/i.test(copy),
      "renderer may never infer learner did not act outside the app");
    assert(section.querySelector("[data-practice-grouping-note]"),
      "fresh evidence must disclose deterministic, non-pedagogical sample grouping");
  });

  check("callbacks-are-navigation-and-recheck-hooks-only", () => {
    let opened = 0;
    let rechecked = 0;
    const input = evidence({ status: "needs-correction" });
    const before = JSON.stringify(input);
    const section = render(input, {
      onOpenWiring: () => { opened += 1; },
      onRecheck: () => { rechecked += 1; },
    });
    section.querySelector("[data-practice-open-wiring]").click();
    section.querySelector("[data-practice-recheck]").click();
    assert(opened === 1 && rechecked === 1, "callbacks should fire once from native buttons");
    assert(JSON.stringify(input) === before, "renderer must not mutate evidence/circuit-facing input");
  });

  check("lesson-01-is-manual-and-wiring-navigation-is-disabled", () => {
    let opened = 0;
    const section = render(evidence({
      lessonId: 1,
      scope: "manual",
      status: "manual-checkpoint",
      matched: 0,
      required: 0,
      missingPairs: [],
      summary: "Bài dùng LED L tích hợp.",
      nextAction: "Tự đối chiếu bước hiện tại.",
    }), { onOpenWiring: () => { opened += 1; }, onRecheck: () => {} });
    const open = section.querySelector("[data-practice-open-wiring]");
    assert(open.disabled === true && open.getAttribute("aria-disabled") === "true", "lesson01 wiring button must be disabled");
    open.click();
    assert(opened === 0, "lesson01 must never invoke wiring navigation");
    assert(/LED L tích hợp|không yêu cầu dây ngoài/.test(section.textContent), "lesson01 manual guidance missing");
    assert(/không.*hoàn thành bài học/i.test(section.textContent), "lesson01 must retain no-mastery boundary");
  });

  check("signal-lessons-disclose-functional-boundary", () => {
    for (const lessonId of [10, 14]) {
      for (const status of ["signal-step-match", "signal-topology-match"]) {
        const section = render(evidence({
          lessonId,
          scope: "signal-only",
          status,
          matched: 3,
          required: 3,
          missingPairs: [],
          summary: "Các cạnh tín hiệu mẫu đã khớp.",
          nextAction: "Dừng ở checkpoint tín hiệu.",
        }));
        assert(/tín hiệu\/GND/.test(section.textContent), "lesson " + lessonId + " signal scope missing");
        assert(/nguồn.*tải.*chức năng|nguồn.*chức năng/i.test(section.textContent), "lesson " + lessonId + " functional caveat missing");
        assert(/không xác nhận phần cứng/i.test(section.textContent), "lesson " + lessonId + " physical caveat missing");
      }
    }
  });

  check("all-eight-model-statuses-render-with-exact-root-status", () => {
    for (const status of [
      "manual-checkpoint",
      "not-attempted",
      "needs-correction",
      "incomplete",
      "step-sample-match",
      "signal-step-match",
      "topology-match",
      "signal-topology-match",
    ]) {
      const manual = status === "manual-checkpoint";
      const signal = status === "signal-step-match" || status === "signal-topology-match";
      const section = render(evidence({
        lessonId: manual ? 1 : signal ? 10 : 2,
        scope: manual ? "manual" : signal ? "signal-only" : "topology",
        status,
        missingPairs: [],
      }));
      assert(section.getAttribute("data-practice-status") === status, status + " root status drifted");
      assert(section.querySelector("[data-practice-status-label]")?.textContent, status + " accessible status text missing");
      if (manual) {
        assert(!section.querySelector("[data-practice-grouping-note]"), "manual checkpoint must not invent wiring-group provenance");
      } else {
        assert(section.querySelector("[data-practice-grouping-note]"), status + " grouping provenance caveat missing");
      }
    }
  });

  check("step-sample-match-discloses-deterministic-grouping-boundary", () => {
    for (const status of ["step-sample-match", "signal-step-match"]) {
      const section = render(evidence({
        lessonId: status === "signal-step-match" ? 10 : 2,
        scope: status === "signal-step-match" ? "signal-only" : "topology",
        status,
        missingPairs: [],
      }));
      assert(/cách phân nhóm xác định.*mẫu tham chiếu/i.test(section.textContent), status + " grouping provenance missing");
      assert(/không chứng minh.*sư phạm/i.test(section.textContent), status + " pedagogy caveat missing");
    }
  });

  check("all-nonmanual-wiring-statuses-disclose-sample-group-provenance", () => {
    for (const status of [
      "not-attempted",
      "incomplete",
      "needs-correction",
      "topology-match",
    ]) {
      const section = render(evidence({
        status,
        matched: status === "topology-match" ? 2 : 0,
        required: 2,
        missingPairs: status === "topology-match" ? [] : [["D13", "R1:A"]],
      }));
      const caveat = section.querySelector("[data-practice-grouping-note]");
      assert(caveat, status + " must render grouping provenance caveat");
      assert(/cách phân nhóm xác định.*mẫu tham chiếu/i.test(caveat.textContent), status + " deterministic sample provenance missing");
      assert(/không phải yêu cầu đấu dây theo bước.*bài học xác nhận/i.test(caveat.textContent), status + " lesson-validation caveat missing");
      assert(/không phải điều kiện để chuyển bước/i.test(caveat.textContent), status + " advancement caveat missing");
      assert(/không chứng minh.*hiểu bài/i.test(caveat.textContent), status + " mastery caveat missing");
    }
  });

  check("topology-match-never-becomes-mastery-or-physical-proof", () => {
    const section = render(evidence({
      status: "topology-match",
      matched: 2,
      required: 2,
      missingPairs: [],
      summary: "Khớp cạnh mẫu tích lũy của bước.",
      nextAction: "Tiếp tục theo hướng dẫn bài học.",
    }));
    const text = section.textContent;
    assert(/khớp.*mẫu/i.test(text), "positive result should describe reference/topology match");
    assert(/không đo vị trí cắm thực/i.test(text), "physical placement caveat missing");
    assert(/không tự xác nhận mức độ hiểu hay hoàn thành bài học/i.test(text), "learner mastery caveat missing");
    assert(!/đã thành thạo|đã hiểu bài|mạch vật lý đúng/i.test(text), "renderer must not invent mastery/physical claims");
  });

  check("needs-correction-renders-missing-extra-and-issues", () => {
    const section = render(evidence({
      status: "needs-correction",
      matched: 1,
      required: 3,
      missingPairs: [{ from: "D13", to: "R1:A" }],
      extraPairs: [{ terminals: ["5V", "GND"] }],
      issues: [{ code: "EXTRA_EDGE", message: "Có cạnh ngoài mẫu." }],
    }));
    assert(/D13 ↔ R1:A/.test(section.textContent), "missing pair formatting failed");
    assert(/5V ↔ GND/.test(section.textContent), "extra pair formatting failed");
    assert(/Có cạnh ngoài mẫu.*EXTRA_EDGE/.test(section.textContent), "issue message/code missing");
  });

  check("unrecognized-status-fails-neutral", () => {
    const section = render(evidence({ status: "future-status" }));
    assert(/Trạng thái chưa được nhận diện/.test(section.textContent), "unknown status must render neutral fallback");
    assert(section.getAttribute("data-practice-tone") === "neutral", "unknown status tone must stay neutral");
    assert(!/đã hiểu bài|hoàn thành checkpoint/i.test(section.textContent), "unknown status must not become positive claim");
  });

  check("untrusted-model-text-is-written-as-text-content", () => {
    const payload = '<img src=x onerror="globalThis.pwned=1">';
    const section = render(evidence({
      summary: payload,
      nextAction: payload,
      missingPairs: [[payload, "GND"]],
      issues: [{ message: payload }],
    }));
    assert(section.textContent.includes(payload), "literal model text should be preserved as text");
    assert(!section.querySelector("img"), "model text must never create injected DOM nodes");
  });

  check("invalid-host-inputs-fail-fast", () => {
    expectThrow(() => renderPracticeEvidence(null, evidence()), /document/i, "missing document");
    expectThrow(() => renderPracticeEvidence(new FakeDocument(), null), /evidence/i, "missing evidence");
    expectThrow(
      () => renderPracticeEvidence(new FakeDocument(), evidence(), { onOpenWiring: "bad" }),
      /onOpenWiring.*function/i,
      "bad callback",
    );
  });

  check("canonical-pure-model-final-output-renders-all-16-lessons", () => {
    assert(lessons.length === 16, "expected 16 lessons");
    for (const lesson of lessons) {
      const referenceCircuit = lesson.id === 1 ? null : createSampleCircuit(lesson.id);
      const circuit = referenceCircuit;
      const analysis = lesson.id === 1 ? null : analyzeCircuit(lesson.id, circuit);
      const value = inspectPracticeEvidence({
        lesson,
        stepIndex: lesson.steps.length - 1,
        circuit,
        referenceCircuit,
        analysis,
        hasLearnerDraft: lesson.id !== 1,
      });
      const section = render(value);
      assert(section.getAttribute("data-practice-lesson") === String(lesson.id), "lesson " + lesson.id + " id drift");
      assert(section.getAttribute("data-practice-status") === value.status, "lesson " + lesson.id + " status drift");
      assert(section.getAttribute("data-practice-scope") === value.scope, "lesson " + lesson.id + " scope drift");
      assert(section.getAttribute("data-practice-matched") === String(value.matched), "lesson " + lesson.id + " matched drift");
      assert(section.getAttribute("data-practice-required") === String(value.required), "lesson " + lesson.id + " required drift");
      assert(/không.*hoàn thành bài học|không tự xác nhận.*hoàn thành bài học/i.test(section.textContent), "lesson " + lesson.id + " no-completion boundary missing");
      if (lesson.id === 1) {
        assert(section.querySelector("[data-practice-open-wiring]")?.disabled === true, "lesson01 wiring control must remain disabled");
      }
      if (lesson.id === 10 || lesson.id === 14) {
        assert(/tín hiệu\/GND/.test(section.textContent), "lesson " + lesson.id + " signal-only note missing");
      }
    }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
