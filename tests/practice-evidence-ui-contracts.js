import { renderPracticeEvidence } from "../src/practice-evidence-ui.js";
import { lessons } from "../src/lessons.js";
import { inspectPracticeEvidence } from "../src/practice-evidence.js";
import {
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  createSampleCircuit,
} from "../src/circuit-router.js";

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
    this.focused = false;
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

  focus() {
    this.focused = true;
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

function checkpoint(kind = "wiring", overrides = {}) {
  return {
    id: kind === "manual" ? "lesson-01-step-01" : "lesson-02-step-01",
    lessonId: kind === "manual" ? 1 : 2,
    stepIndex: 0,
    kind,
    sourceStep: kind === "manual" ? "Quan sát mô hình." : "Xác định chân và cạnh nối.",
    guidance: kind === "manual" ? "Quan sát theo nội dung bước." : "Đối chiếu các cạnh reference đã biên tập.",
    requiredPairs: kind === "manual" ? [] : [["D13", "R1:A"], ["R1:B", "LED:A"]],
    provenance: {
      scheme: "human-authored-from-lesson-text",
      source: "lessons.steps",
      editorial: true,
      rationale: "Fixture UI authored checkpoint.",
      teacherValidated: false,
      hardwareValidated: false,
      prerequisiteForAdvance: false,
    },
    ...overrides,
  };
}

function evidence(overrides = {}) {
  const value = {
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
    guidance: "Đối chiếu các cạnh reference đã biên tập.",
    claims: {
      topologyOnly: true,
      physicalValidation: false,
      learnerMastery: false,
      signalOnly: false,
      teacherValidated: false,
    },
    ...overrides,
  };
  if (!("checkpoint" in overrides)) {
    const manual = value.status === "manual-checkpoint" || value.scope === "manual";
    value.checkpoint = checkpoint(manual ? "manual" : "wiring", {
      id: "lesson-" + String(value.lessonId).padStart(2, "0") + "-step-" + String(value.stepIndex + 1).padStart(2, "0"),
      lessonId: value.lessonId,
      stepIndex: value.stepIndex,
    });
  }
  if (!("guidance" in overrides)) value.guidance = value.checkpoint?.guidance ?? value.guidance;
  return value;
}

function render(value, callbacks = {}) {
  return renderPracticeEvidence(new FakeDocument(), value, callbacks);
}

function deepFreezeFixture(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreezeFixture);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreezeFixture);
    return Object.freeze(value);
  }
  return value;
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
    assert(section.getAttribute("data-practice-checkpoint-kind") === "wiring", "root checkpoint kind missing");
    assert(section.getAttribute("data-practice-provenance") === "human-authored-from-lesson-text", "root provenance missing");
    const status = section.querySelector("[data-practice-status-label]");
    assert(status?.getAttribute("role") === "status", "status role missing");
    assert(status?.getAttribute("aria-live") === "polite", "status live region missing");
    assert(section.querySelector("[data-practice-missing]"), "missing-pair selector absent");
    assert(section.querySelector("[data-practice-open-wiring]")?.tagName === "BUTTON", "wiring control must be native button");
    assert(section.querySelector("[data-practice-open-3d]")?.tagName === "BUTTON", "3D control must be native button");
    assert(section.querySelector("[data-practice-recheck]")?.tagName === "BUTTON", "recheck control must be native button");
    assert(section.querySelector("[data-practice-guidance]"), "authored guidance missing");
    assert(section.querySelector("[data-practice-provenance-note]"), "authored provenance note missing");
  });

  check("untouched-in-app-draft-must-not-disprove-learner-action-elsewhere", () => {
    const section = render(evidence({status:"not-attempted"}));
    const copy = section.textContent;
    assert(/ứng dụng chưa ghi nhận bản tự đấu/i.test(copy),
      "not-attempted describes only the draft recorded in this app");
    assert(!/chưa có thao tác đấu dây của người học|chưa có dây do người học tạo/i.test(copy),
      "renderer may never infer learner did not act outside the app");
    assert(section.querySelector("[data-practice-grouping-note]"),
      "fresh evidence must disclose authored sample-edge checkpoint provenance");
  });

  check("callbacks-are-navigation-3d-and-recheck-hooks-only", () => {
    let opened2d = 0;
    let opened3d = 0;
    let rechecked = 0;
    const input = evidence({ status: "needs-correction" });
    const before = JSON.stringify(input);
    const section = render(input, {
      onOpenWiring: () => { opened2d += 1; },
      onOpen3D: () => { opened3d += 1; },
      onRecheck: () => { rechecked += 1; },
    });
    section.querySelector("[data-practice-open-wiring]").click();
    section.querySelector("[data-practice-open-3d]").click();
    section.querySelector("[data-practice-recheck]").click();
    assert(opened2d === 1 && opened3d === 1 && rechecked === 1,
      "callbacks should fire once from native buttons");
    assert(JSON.stringify(input) === before, "renderer must not mutate evidence/circuit-facing input");
  });

  check("missing-terminal-inspector-callback-fires-only-on-explicit-click", () => {
    const lesson = lessons.find(item => item.id === 2);
    const circuit = createCircuit(2);
    const value = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const before = JSON.stringify(value);
    const inspected = [];
    const section = render(value, {
      onInspectMissingTerminal: terminalId => inspected.push(terminalId),
    });
    const button = section.querySelector("[data-practice-inspect-missing-terminal]");
    assert(button?.tagName === "BUTTON", "missing pair should expose native inspector button");
    assert(button.type === "button", "inspector control must not submit forms");
    assert(button.getAttribute("data-practice-inspect-terminal") === "D13",
      "button must bind exact canonical terminal ID");
    assert(/Xem chân cần nối trong 3D \/ Inspector/.test(button.textContent), "inspector label drift");
    assert(inspected.length === 0, "render must never auto-inspect missing terminal");
    assert(/D13 ↔ R1:A/.test(section.textContent), "exact next missing pair should be visible");
    assert(section.querySelector("[data-practice-wire-guidance]"), "wire guidance block missing");
    button.click();
    assert(JSON.stringify(inspected) === JSON.stringify(["D13"]),
      "explicit click must invoke callback once with exact canonical terminal");
    assert(JSON.stringify(value) === before, "inspector navigation must not mutate evidence");
  });

  check("inspector-button-appears-only-for-proven-authored-missing-canonical-pair-across-48-steps", () => {
    let rendered = 0;
    let clicked = 0;
    for (const lesson of lessons) {
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const circuit = lesson.id === 1 ? null : createCircuit(lesson.id);
        const value = inspectPracticeEvidence({
          lesson,
          stepIndex,
          circuit,
          referenceCircuit: lesson.id === 1 ? null : createSampleCircuit(lesson.id),
          analysis: lesson.id === 1 ? null : analyzeCircuit(lesson.id, circuit),
          hasLearnerDraft: lesson.id !== 1,
        });
        const inspected = [];
        const section = render(value, {
          onInspectMissingTerminal: terminalId => inspected.push(terminalId),
        });
        rendered += 1;
        const checklist = section.querySelector("[data-practice-wire-checklist]");
        assert(checklist, "checklist block missing " + lesson.id + "/" + stepIndex);
        const checklistRows = section.querySelectorAll("[data-practice-checklist-row]");
        if (value.checkpoint.kind === "manual") {
          assert(checklistRows.length === 0, "manual checkpoint must not render pair rows " + lesson.id + "/" + stepIndex);
        } else {
          assert(checklistRows.length === value.checkpoint.requiredPairs.length,
            "authored checklist row count drift " + lesson.id + "/" + stepIndex);
          assert(checklistRows.filter(row => row.getAttribute("data-practice-pair-status") === "missing").length === value.missingPairs.length,
            "authored checklist missing-state count drift " + lesson.id + "/" + stepIndex);
        }
        const button = section.querySelector("[data-practice-inspect-missing-terminal]");
        const shouldExist = value.checkpoint.kind === "wiring" &&
          value.wireGuidance.status === "missing-canonical-pair" && value.missingPairs.length > 0;
        assert(Boolean(button) === shouldExist,
          "button gating drift " + lesson.id + "/" + stepIndex);
        assert(inspected.length === 0, "no implicit inspect callback " + lesson.id + "/" + stepIndex);
        if (button) {
          assert(button.getAttribute("data-practice-inspect-terminal") === value.wireGuidance.inspectTerminalId,
            "terminal binding drift " + lesson.id + "/" + stepIndex);
          button.click();
          clicked += 1;
          assert(JSON.stringify(inspected) === JSON.stringify([value.wireGuidance.inspectTerminalId]),
            "explicit inspect callback drift " + lesson.id + "/" + stepIndex);
        }
      }
    }
    assert(rendered === 48, "expected all 48 authored steps rendered");
    assert(clicked > 0, "expected authored wiring checkpoints to expose inspector controls");
  });

  check("covered-extra-only-and-forged-guidance-never-expose-missing-inspector-button", () => {
    const lesson = lessons.find(item => item.id === 2);
    const full = createSampleCircuit(2);
    const covered = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit: full,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, full),
      hasLearnerDraft: true,
    });
    assert(!render(covered, { onInspectMissingTerminal: () => {} })
      .querySelector("[data-practice-inspect-missing-terminal]"),
    "covered checkpoint must not expose missing-terminal button");

    const extraOnlyCircuit = connectCircuit(full, "D13", "GND");
    const extraOnly = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit: extraOnlyCircuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, extraOnlyCircuit),
      hasLearnerDraft: true,
    });
    const extraOnlySection = render(extraOnly, { onInspectMissingTerminal: () => {} });
    assert(extraOnly.wireGuidance.status === "review-extra-pairs", "fixture must be extra-only review");
    assert(!extraOnlySection.querySelector("[data-practice-inspect-missing-terminal]"),
      "extra-only review must not invent missing-terminal button");
    assert(extraOnlySection.querySelector("[data-practice-wire-review]"), "extra topology review should be visible");
    assert(/không suy ra lỗi điện/i.test(extraOnlySection.textContent), "extra review electrical caveat missing");

    const missingCircuit = createCircuit(2);
    const genuineMissing = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit: missingCircuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, missingCircuit),
      hasLearnerDraft: true,
    });
    const forgedPair = {
      ...genuineMissing,
      wireGuidance: {
        ...genuineMissing.wireGuidance,
        nextMissingPair: ["GND", "LED:K"],
        inspectTerminalId: "GND",
      },
    };
    assert(!render(forgedPair, { onInspectMissingTerminal: () => {} })
      .querySelector("[data-practice-inspect-missing-terminal]"),
    "guidance pair inconsistent with first evidence missing pair must not expose button");
  });

  check("per-pair-checklist-renders-authored-order-states-and-explicit-read-only-inspect-actions", () => {
    const lesson = lessons.find(item => item.id === 2);
    let circuit = createCircuit(2);
    circuit = connectCircuit(circuit, "D13", "R1:A");
    const value = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const inspected = [];
    const section = render(value, {
      onInspectChecklistTerminal: terminalId => inspected.push(terminalId),
    });
    const checklist = section.querySelector("[data-practice-wire-checklist]");
    assert(checklist?.getAttribute("role") === "group", "checklist accessible group missing");
    assert(/Checklist cạnh dây của checkpoint/.test(checklist.textContent), "checklist heading missing");
    const rows = section.querySelectorAll("[data-practice-checklist-row]");
    assert(rows.length === 3, "lesson02 step1 should render three authored pair rows");
    assert(rows[0].getAttribute("data-practice-pair-status") === "matched", "first row matched state missing");
    assert(rows[1].getAttribute("data-practice-pair-status") === "missing" &&
      rows[2].getAttribute("data-practice-pair-status") === "missing",
    "later rows missing state drift");
    assert(/Cặp 1: D13 ↔ R1:A.*Đã có trong learner graph/.test(rows[0].textContent),
      "matched row exact IDs/copy missing");
    assert(/Cặp 2: R1:B ↔ LED:A.*Còn thiếu trong learner graph/.test(rows[1].textContent),
      "missing row exact IDs/copy missing");
    const buttons = section.querySelectorAll("[data-practice-checklist-inspect-terminal]");
    assert(buttons.length === 3, "one optional inspect action per authored pair expected");
    for (const button of buttons) {
      assert(button.tagName === "BUTTON" && button.type === "button", "checklist action must be native button");
      assert(button.disabled === false, "callback-backed checklist button should be enabled");
      assert(button.getAttribute("tabindex") === null, "native checklist button must keep default keyboard focusability");
      assert(button.getAttribute("style") === null && button.getAttribute("width") === null,
        "checklist button must not add fixed-width/inline layout hostile to 375px");
      assert(button.focused === false, "render must not steal focus to checklist action");
    }
    assert(inspected.length === 0, "render must never invoke checklist inspector callback");
    buttons[0].click();
    buttons[1].click();
    assert(JSON.stringify(inspected) === JSON.stringify(["D13", "R1:B"]),
      "matched/missing row actions pass exact authored source terminal only after click");
    assert(value.claims.autoCompletion === false && value.claims.lessonCompleted === false,
      "checklist clicks cannot alter completion claims");
  });

  check("extra-review-checklist-renders-separate-source-inspect-without-electrical-diagnosis", () => {
    const lesson = lessons.find(item => item.id === 2);
    let circuit = createSampleCircuit(2);
    circuit = connectCircuit(circuit, "D13", "GND");
    const value = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const inspected = [];
    const section = render(value, {
      onInspectChecklistTerminal: terminalId => inspected.push(terminalId),
    });
    const review = section.querySelector("[data-practice-extra-review-checklist]");
    assert(review?.getAttribute("role") === "group", "extra review accessible group missing");
    const rows = section.querySelectorAll("[data-practice-extra-review-row]");
    assert(rows.length === 1 && rows[0].getAttribute("data-practice-pair-status") === "review-extra",
      "extra review row missing");
    assert(/D13 ↔ GND.*không thuộc canonical reference sample/i.test(rows[0].textContent),
      "extra review exact topology copy missing");
    assert(!/chập|short|nguy hiểm|quá dòng|điện áp sai|đã cắm sai/i.test(rows[0].textContent),
      "extra review must not fabricate physical/electrical diagnosis");
    const button = section.querySelector("[data-practice-extra-inspect-terminal]");
    assert(button?.getAttribute("data-practice-inspect-terminal") === "D13",
      "extra review inspect source terminal binding missing");
    assert(inspected.length === 0, "extra review must not auto inspect");
    button.click();
    assert(JSON.stringify(inspected) === JSON.stringify(["D13"]),
      "extra review click passes exact source terminal once");
  });

  check("manual-and-signal-only-checklists-preserve-authored-boundaries", () => {
    const manualLesson = lessons.find(item => item.id === 1);
    const manualValue = inspectPracticeEvidence({
      lesson: manualLesson,
      stepIndex: 0,
      circuit: null,
      referenceCircuit: null,
      analysis: null,
      hasLearnerDraft: false,
    });
    const manual = render(manualValue, { onInspectChecklistTerminal: () => {} });
    assert(manual.querySelector("[data-practice-wire-checklist]"), "manual checkpoint should expose neutral checklist block");
    assert(/Checkpoint manual không có authored required pair/i.test(manual.textContent),
      "manual checklist neutral copy missing");
    assert(manual.querySelectorAll("[data-practice-checklist-row]").length === 0 &&
      manual.querySelectorAll("[data-practice-checklist-inspect-terminal]").length === 0,
    "manual checkpoint must not invent wire rows/actions");

    const signalLesson = lessons.find(item => item.id === 14);
    const signalCircuit = createCircuit(14);
    const signalValue = inspectPracticeEvidence({
      lesson: signalLesson,
      stepIndex: 0,
      circuit: signalCircuit,
      referenceCircuit: createSampleCircuit(14),
      analysis: analyzeCircuit(14, signalCircuit),
      hasLearnerDraft: true,
    });
    const signal = render(signalValue, { onInspectChecklistTerminal: () => {} });
    assert(signal.querySelectorAll("[data-practice-checklist-row]").length === 2,
      "lesson14 authored signal pairs should render checklist rows");
    assert(/tín hiệu\/GND/.test(signal.textContent) && /nguồn công suất.*tải.*không được xác nhận/i.test(signal.textContent),
      "signal-only boundary must coexist with checklist");
    assert(!/bơm đã hoạt động|phần cứng đúng|đã hoàn thành/i.test(signal.textContent),
      "signal-only checklist must not upgrade hardware/completion claims");
  });

  check("forged-or-malformed-checklist-fails-closed-without-row-actions", () => {
    const lesson = lessons.find(item => item.id === 2);
    const circuit = createCircuit(2);
    const genuine = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const forgedStatus = {
      ...genuine,
      wireGuidance: {
        ...genuine.wireGuidance,
        pairChecklist: genuine.wireGuidance.pairChecklist.map((row, index) =>
          index === 0 ? { ...row, status: "matched" } : { ...row }),
      },
    };
    const forgedTeacher = {
      ...genuine,
      wireGuidance: {
        ...genuine.wireGuidance,
        claims: { ...genuine.wireGuidance.claims, teacherValidated: true },
      },
    };
    const malformed = {
      ...genuine,
      wireGuidance: {
        ...genuine.wireGuidance,
        pairChecklist: [{ order: 1, pair: ["D13"], status: "missing", inspectTerminalId: "D13", explanation: "bad" }],
      },
    };
    const forgedEvidenceTeacher = {
      ...genuine,
      claims: { ...genuine.claims, teacherValidated: true },
    };
    for (const [label, value] of [
      ["forged status", forgedStatus],
      ["forged guidance teacher", forgedTeacher],
      ["forged evidence teacher", forgedEvidenceTeacher],
      ["malformed", malformed],
    ]) {
      const section = render(value, { onInspectChecklistTerminal: () => {} });
      assert(!section.querySelector("[data-practice-wire-checklist]"), label + " must suppress checklist block");
      assert(!section.querySelector("[data-practice-checklist-inspect-terminal]"),
        label + " must suppress row inspect actions");
    }
  });

  check("checklist-explanations-use-text-content-and-mobile-neutral-structure", () => {
    const lesson = lessons.find(item => item.id === 2);
    const circuit = createCircuit(2);
    const genuine = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const payload = '<img src=x onerror="globalThis.pwned=1">';
    const poisoned = {
      ...genuine,
      wireGuidance: {
        ...genuine.wireGuidance,
        pairChecklist: genuine.wireGuidance.pairChecklist.map((row, index) => ({
          ...row,
          explanation: index === 0 ? payload : row.explanation,
        })),
      },
    };
    const section = render(poisoned, { onInspectChecklistTerminal: () => {} });
    assert(section.textContent.includes(payload), "checklist payload should remain literal text");
    assert(!section.querySelector("img"), "checklist text must not create injected DOM nodes");
    assert(!section.querySelector("table"), "checklist should avoid fixed table structure on 375px layouts");
    const checklist = section.querySelector("[data-practice-wire-checklist]");
    assert(checklist?.getAttribute("style") === null && checklist?.getAttribute("width") === null,
      "checklist root must not set inline/fixed width");
    for (const button of section.querySelectorAll("[data-practice-checklist-inspect-terminal]")) {
      assert(button.tagName === "BUTTON" && button.getAttribute("tabindex") === null,
        "checklist controls remain native keyboard-focusable controls");
      assert(button.getAttribute("style") === null && button.getAttribute("width") === null,
        "checklist controls remain structurally 375px-neutral");
    }
  });

  // legacy expectation retired by requested authored checkpoint behavior, check absence
  check("callbacks-are-navigation-and-recheck-hooks-only", () => {
    let opened2d = 0;
    let opened3d = 0;
    let rechecked = 0;
    const input = evidence({ status: "step-sample-match" });
    const before = JSON.stringify(input);
    const section = render(input, {
      onOpenWiring: () => { opened2d += 1; },
      onOpen3D: () => { opened3d += 1; },
      onRecheck: () => { rechecked += 1; },
    });
    assert(opened2d === 0 && opened3d === 0 && rechecked === 0,
      "render must never invoke navigation/recheck callbacks implicitly");
    assert(section.getAttribute("data-practice-provenance") === "human-authored-from-lesson-text",
      "legacy callback check requires authored provenance");
    assert(/không phải xác nhận của giáo viên/i.test(section.textContent),
      "legacy callback check requires no-teacher boundary");
    assert(/không phải yêu cầu bắt buộc để chuyển bước/i.test(section.textContent),
      "legacy callback check requires no-advance prerequisite boundary");
    assert(!/đã hoàn thành|hoàn thành tự động|tự động hoàn thành/i.test(section.textContent),
      "legacy callback check must not fabricate completion");
    assert(JSON.stringify(input) === before,
      "legacy callback check must preserve evidence input before any click");
  });

  check("lesson-01-is-manual-wiring-disabled-and-3d-inspection-supported", () => {
    let opened2d = 0;
    let opened3d = 0;
    const section = render(evidence({
      lessonId: 1,
      scope: "manual",
      status: "manual-checkpoint",
      matched: 0,
      required: 0,
      missingPairs: [],
      summary: "Bài dùng LED L tích hợp.",
      nextAction: "Tự đối chiếu bước hiện tại.",
      checkpoint: checkpoint("manual", { lessonId: 1, id: "lesson-01-step-01" }),
    }), {
      onOpenWiring: () => { opened2d += 1; },
      onOpen3D: () => { opened3d += 1; },
      onRecheck: () => {},
    });
    const open = section.querySelector("[data-practice-open-wiring]");
    assert(open.disabled === true && open.getAttribute("aria-disabled") === "true", "lesson01 wiring button must be disabled");
    open.click();
    assert(opened2d === 0, "lesson01 must never invoke wiring navigation");
    const open3d = section.querySelector("[data-practice-open-3d]");
    assert(open3d.disabled === false, "lesson01 3D inspection button should be enabled with callback");
    open3d.click();
    assert(opened3d === 1, "lesson01 3D inspection callback should fire");
    assert(/LED L tích hợp|không yêu cầu dây ngoài/.test(section.textContent), "lesson01 manual guidance missing");
    assert(/không.*hoàn thành bài học/i.test(section.textContent), "lesson01 must retain no-mastery boundary");
  });

  // legacy expectation retired by requested authored checkpoint behavior, check absence
  check("lesson-01-is-manual-and-wiring-navigation-is-disabled", () => {
    let opened2d = 0;
    let opened3d = 0;
    let rechecked = 0;
    const section = render(evidence({
      lessonId: 1,
      scope: "manual",
      status: "manual-checkpoint",
      matched: 0,
      required: 0,
      missingPairs: [],
      checkpoint: checkpoint("manual", { lessonId: 1, id: "lesson-01-step-01" }),
    }), {
      onOpenWiring: () => { opened2d += 1; },
      onOpen3D: () => { opened3d += 1; },
      onRecheck: () => { rechecked += 1; },
    });
    const open2d = section.querySelector("[data-practice-open-wiring]");
    assert(open2d.disabled === true && open2d.getAttribute("aria-disabled") === "true",
      "legacy lesson01 check keeps 2D wiring navigation disabled");
    assert(opened2d === 0 && opened3d === 0 && rechecked === 0,
      "legacy lesson01 check forbids implicit callback execution");
    assert(section.getAttribute("data-practice-checkpoint-kind") === "manual" &&
      section.getAttribute("data-practice-provenance") === "human-authored-from-lesson-text",
    "legacy lesson01 check requires authored manual provenance");
    assert(/không phải xác nhận của giáo viên/i.test(section.textContent),
      "legacy lesson01 check requires no-teacher boundary");
    assert(/không phải điều kiện để chuyển bước/i.test(section.textContent),
      "legacy lesson01 check requires no-advance prerequisite boundary");
    assert(/không.*hoàn thành bài học/i.test(section.textContent),
      "legacy lesson01 check retains no implicit completion boundary");
  });

  check("manual-step-in-wiring-lesson-keeps-reference-navigation-available", () => {
    let opened2d = 0;
    let opened3d = 0;
    const section = render(evidence({
      lessonId: 2,
      stepIndex: 1,
      scope: "manual",
      status: "manual-checkpoint",
      matched: 0,
      required: 0,
      missingPairs: [],
      checkpoint: checkpoint("manual", { lessonId: 2, stepIndex: 1, id: "lesson-02-step-02" }),
    }), {
      onOpenWiring: () => { opened2d += 1; },
      onOpen3D: () => { opened3d += 1; },
    });
    const open2d = section.querySelector("[data-practice-open-wiring]");
    const open3d = section.querySelector("[data-practice-open-3d]");
    assert(open2d.disabled === false && open3d.disabled === false,
      "manual lesson step must not hide available 2D/3D references");
    open2d.click();
    open3d.click();
    assert(opened2d === 1 && opened3d === 1, "manual reference navigation hooks should fire");
    assert(/quan sát\/mô phỏng/i.test(section.textContent), "manual authored-step explanation missing");
    assert(!/không có bằng chứng dây ngoài/i.test(section.textContent),
      "manual step in wiring lesson must not claim external wiring is absent");
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

  check("step-sample-match-discloses-authored-editorial-provenance", () => {
    for (const status of ["step-sample-match", "signal-step-match"]) {
      const section = render(evidence({
        lessonId: status === "signal-step-match" ? 10 : 2,
        scope: status === "signal-step-match" ? "signal-only" : "topology",
        status,
        missingPairs: [],
      }));
      assert(/biên tập thủ công.*nội dung bước học/i.test(section.textContent), status + " authored provenance missing");
      assert(/không phải xác nhận của giáo viên/i.test(section.textContent), status + " teacher-validation caveat missing");
    }
  });

  // legacy expectation retired by requested authored checkpoint behavior, check absence
  check("step-sample-match-discloses-deterministic-grouping-boundary", () => {
    const section = render(evidence({
      status: "step-sample-match",
      matched: 2,
      required: 2,
      missingPairs: [],
    }));
    const provenance = section.querySelector("[data-practice-grouping-note]");
    assert(provenance, "legacy grouping selector remains available for compatibility");
    assert(/biên tập thủ công.*nội dung bước học/i.test(provenance.textContent),
      "legacy grouping check now requires authored provenance");
    assert(/không phải xác nhận của giáo viên/i.test(provenance.textContent),
      "legacy grouping check requires no-teacher boundary");
    assert(/không phải yêu cầu bắt buộc để chuyển bước/i.test(provenance.textContent),
      "legacy grouping check requires no-advance prerequisite boundary");
    assert(!/deterministic-balanced|balanced-contiguous|chia đều|phân nhóm xác định/i.test(provenance.textContent),
      "superseded deterministic balanced grouping wording must remain absent");
    assert(!/đã hiểu bài|đã thành thạo|tự động hoàn thành/i.test(section.textContent),
      "legacy grouping check must not fabricate mastery/completion");
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
      assert(/biên tập thủ công.*nội dung bước học/i.test(caveat.textContent), status + " authored provenance missing");
      assert(/không phải xác nhận của giáo viên/i.test(caveat.textContent), status + " teacher-validation caveat missing");
      assert(/không phải yêu cầu bắt buộc để chuyển bước/i.test(caveat.textContent), status + " advancement caveat missing");
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
    expectThrow(
      () => renderPracticeEvidence(new FakeDocument(), evidence(), { onOpen3D: "bad" }),
      /onOpen3D.*function/i,
      "bad 3D callback",
    );
    expectThrow(
      () => renderPracticeEvidence(new FakeDocument(), evidence(), { onInspectMissingTerminal: "bad" }),
      /onInspectMissingTerminal.*function/i,
      "bad missing-terminal inspector callback",
    );
    expectThrow(
      () => renderPracticeEvidence(new FakeDocument(), evidence(), { onInspectChecklistTerminal: "bad" }),
      /onInspectChecklistTerminal.*function/i,
      "bad checklist inspector callback",
    );
    expectThrow(
      () => renderPracticeEvidence(new FakeDocument(), evidence(), { onStartRepairMissingPair: "bad" }),
      /onStartRepairMissingPair.*function/i,
      "bad missing-pair repair callback",
    );
    expectThrow(
      () => renderPracticeEvidence(new FakeDocument(), evidence(), { onStartReviewExtraPair: "bad" }),
      /onStartReviewExtraPair.*function/i,
      "bad extra-review callback",
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
      assert(section.getAttribute("data-practice-provenance") === "human-authored-from-lesson-text",
        "lesson " + lesson.id + " authored provenance drift");
      assert(section.querySelector("[data-practice-provenance-note]"), "lesson " + lesson.id + " provenance note missing");
      assert(/không.*hoàn thành bài học|không tự xác nhận.*hoàn thành bài học/i.test(section.textContent), "lesson " + lesson.id + " no-completion boundary missing");
      if (lesson.id === 1) {
        assert(section.querySelector("[data-practice-open-wiring]")?.disabled === true, "lesson01 wiring control must remain disabled");
      }
      if (lesson.id === 10 || lesson.id === 14) {
        assert(/tín hiệu\/GND/.test(section.textContent), "lesson " + lesson.id + " signal-only note missing");
      }
    }
  });

  check("authored-missing-pair-2d-preview-only-after-native-click", () => {
    const lesson = lessons.find(item => item.id === 2);
    let circuit = createCircuit(2);
    circuit = connectCircuit(circuit,"D13","R1:A");
    const inspection=inspectPracticeEvidence({
      lesson,stepIndex:0,circuit,referenceCircuit:createSampleCircuit(2),
      analysis:analyzeCircuit(2,circuit),hasLearnerDraft:true,
    });
    const triggered=[];
    const before=JSON.stringify(inspection);
    const section=render(inspection,{onPreviewMissingPairIn2D:pair=>triggered.push(pair)});
    const rows=section.querySelectorAll("[data-practice-checklist-row]");
    const buttons=section.querySelectorAll("[data-practice-preview-pair-2d]");
    assert(rows.length===3 && buttons.length===2,"only two still-missing authored pairs can expose preview");
    assert(!rows[0].querySelector("[data-practice-preview-pair-2d]"),"matched pair cannot offer missing-wire preview");
    assert(buttons[0].type==="button" && buttons[0].tagName==="BUTTON", "must be a real button, not form submit");
    assert(buttons[0].getAttribute("data-practice-preview-from")==="R1:B" &&
      buttons[0].getAttribute("data-practice-preview-to")==="LED:A", "preview first missing pair exact authored order");
    assert(buttons[1].getAttribute("data-practice-preview-from")==="LED:K" &&
      buttons[1].getAttribute("data-practice-preview-to")==="GND", "preview second missing pair exact authored order");
    assert(triggered.length===0 && buttons.every(button=>!button.focused),"render must never auto-preview or steal focus");
    buttons[0].click();
    assert(triggered.length===1 && JSON.stringify(triggered[0])===JSON.stringify(["R1:B","LED:A"]),
      "exact canonical missing pair forwards only after explicit click");
    assert(Object.isFrozen(triggered[0]),"host callback receives immutable pair to prevent mutation");
    assert(JSON.stringify(inspection)===before && inspection.claims.lessonCompleted===false &&
      inspection.claims.mastery===false,"click may not mutate evidence or claim mastery");
  });

  check("missing-pair-2d-preview-disabled-without-callback-and-fail-fast-bad-hook", () => {
    const lesson=lessons.find(item=>item.id===2);
    const circuit=createCircuit(2);
    const inspection=inspectPracticeEvidence({lesson,stepIndex:0,circuit,
      referenceCircuit:createSampleCircuit(2),analysis:analyzeCircuit(2,circuit),hasLearnerDraft:true});
    const section=render(inspection);
    const actions=section.querySelectorAll("[data-practice-preview-pair-2d]");
    assert(actions.length===3 && actions.every(button=>button.disabled &&
      button.getAttribute("aria-disabled")==="true"),"optional callback absent must disable all preview buttons");
    expectThrow(()=>render(inspection,{onPreviewMissingPairIn2D:4}),
      /onPreviewMissingPairIn2D.*function/i,"bad preview callback must fail fast");
  });

  check("authored-missing-pair-3d-preview-only-after-native-click-with-readonly-boundary", () => {
    const lesson=lessons.find(item=>item.id===2);
    let circuit=createCircuit(2);
    circuit=connectCircuit(circuit,"D13","R1:A");
    const inspection=inspectPracticeEvidence({lesson,stepIndex:0,circuit,
      referenceCircuit:createSampleCircuit(2),analysis:analyzeCircuit(2,circuit),hasLearnerDraft:true});
    const triggered=[];
    const before=JSON.stringify(inspection);
    const section=render(inspection,{onPreviewMissingPairIn3D:pair=>triggered.push(pair)});
    const rows=section.querySelectorAll("[data-practice-checklist-row]");
    const buttons=section.querySelectorAll("[data-practice-preview-pair-3d]");
    assert(rows.length===3 && buttons.length===2,
      "only strictly validated still-missing authored pairs expose 3D preview");
    assert(!rows[0].querySelector("[data-practice-preview-pair-3d]"),
      "matched authored pair cannot expose 3D missing suggestion");
    assert(buttons.every(button=>button.tagName==="BUTTON" && button.type==="button"),
      "3D suggestion must use native non-submit buttons");
    assert(buttons[0].getAttribute("data-practice-preview-from")==="R1:B" &&
      buttons[0].getAttribute("data-practice-preview-to")==="LED:A",
      "first 3D preview binds exact authored missing pair");
    assert(buttons[1].getAttribute("data-practice-preview-from")==="LED:K" &&
      buttons[1].getAttribute("data-practice-preview-to")==="GND",
      "second 3D preview binds exact authored missing pair");
    for(const button of buttons){
      const name=button.getAttribute("aria-label")||"";
      assert(/gợi ý trực quan 3D.*chỉ đọc/i.test(name),"3D suggestion accessible name must say read-only");
      assert(/không tạo dây/i.test(name),"3D suggestion accessible name must deny wire commit");
      assert(/không xác nhận phần cứng/i.test(name),"3D suggestion accessible name must deny physical proof");
      assert(/giáo viên/i.test(name),"3D suggestion accessible name must deny teacher validation");
    }
    assert(triggered.length===0 && buttons.every(button=>!button.focused),
      "render must never auto-preview 3D or steal focus");
    buttons[0].click();
    assert(triggered.length===1 && JSON.stringify(triggered[0])===JSON.stringify(["R1:B","LED:A"]),
      "explicit 3D click forwards exact authored pair once");
    assert(Object.isFrozen(triggered[0]),"3D host callback receives frozen pair");
    assert(JSON.stringify(inspection)===before && inspection.claims.lessonCompleted===false &&
      inspection.claims.mastery===false && inspection.claims.physicalVerified===false &&
      inspection.claims.teacherValidated===false,
      "3D suggestion click cannot mutate evidence or upgrade claims");
  });

  check("missing-pair-3d-preview-disabled-without-callback-and-fail-fast-bad-hook", () => {
    const lesson=lessons.find(item=>item.id===2);
    const circuit=createCircuit(2);
    const inspection=inspectPracticeEvidence({lesson,stepIndex:0,circuit,
      referenceCircuit:createSampleCircuit(2),analysis:analyzeCircuit(2,circuit),hasLearnerDraft:true});
    const section=render(inspection);
    const actions=section.querySelectorAll("[data-practice-preview-pair-3d]");
    assert(actions.length===3 && actions.every(button=>button.disabled &&
      button.getAttribute("aria-disabled")==="true"),
      "valid authored missing 3D actions remain visible but disabled without callback");
    expectThrow(()=>render(inspection,{onPreviewMissingPairIn3D:4}),
      /onPreviewMissingPairIn3D.*function/i,"bad 3D preview callback must fail fast");
  });

  check("missing-pair-2d-and-3d-previews-are-independent-explicit-readonly-actions", () => {
    const lesson=lessons.find(item=>item.id===2);
    const circuit=createCircuit(2);
    const inspection=inspectPracticeEvidence({lesson,stepIndex:0,circuit,
      referenceCircuit:createSampleCircuit(2),analysis:analyzeCircuit(2,circuit),hasLearnerDraft:true});
    const preview2D=[];
    const preview3D=[];
    const section=render(inspection,{
      onPreviewMissingPairIn2D:pair=>preview2D.push(pair),
      onPreviewMissingPairIn3D:pair=>preview3D.push(pair),
    });
    const twoD=section.querySelectorAll("[data-practice-preview-pair-2d]");
    const threeD=section.querySelectorAll("[data-practice-preview-pair-3d]");
    assert(twoD.length===3 && threeD.length===3,"same three validated missing pairs expose independent 2D/3D actions");
    assert(preview2D.length===0 && preview3D.length===0,"neither callback fires during render");
    threeD[0].click();
    assert(preview3D.length===1 && preview2D.length===0,"3D click cannot trigger 2D callback");
    twoD[1].click();
    assert(preview2D.length===1 && preview3D.length===1,"2D click cannot trigger extra 3D callback");
    assert(JSON.stringify(preview3D[0])===JSON.stringify(["D13","R1:A"]) && Object.isFrozen(preview3D[0]),
      "3D callback pair exact and frozen");
    assert(JSON.stringify(preview2D[0])===JSON.stringify(["R1:B","LED:A"]) && Object.isFrozen(preview2D[0]),
      "2D callback remains exact and frozen");
  });

  check("matched-manual-extra-reference-unknown-and-forged-rows-never-gain-3d-missing-action", () => {
    const lesson=lessons.find(item=>item.id===2);
    const reference=createSampleCircuit(2);
    const complete=inspectPracticeEvidence({lesson,stepIndex:0,circuit:reference,
      referenceCircuit:reference,analysis:analyzeCircuit(2,reference),hasLearnerDraft:true});
    assert(render(complete,{onPreviewMissingPairIn3D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-3d]").length===0,
      "matched authored checklist has no 3D missing suggestion");

    const manualCircuit=createCircuit(2);
    const manual=inspectPracticeEvidence({lesson,stepIndex:1,circuit:manualCircuit,
      referenceCircuit:reference,analysis:analyzeCircuit(2,manualCircuit),hasLearnerDraft:true});
    assert(render(manual,{onPreviewMissingPairIn3D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-3d]").length===0,
      "manual checkpoint has no 3D pair suggestion");

    let extraCircuit=createCircuit(2);
    extraCircuit=connectCircuit(extraCircuit,"D13","GND");
    const withExtra=inspectPracticeEvidence({lesson,stepIndex:0,circuit:extraCircuit,
      referenceCircuit:reference,analysis:analyzeCircuit(2,extraCircuit),hasLearnerDraft:true});
    const extraSection=render(withExtra,{onPreviewMissingPairIn3D:()=>{}});
    const missingRows=extraSection.querySelectorAll("[data-practice-checklist-row]")
      .filter(row=>row.getAttribute("data-practice-pair-status")==="missing");
    assert(extraSection.querySelectorAll("[data-practice-preview-pair-3d]").length===missingRows.length,
      "valid required missing rows retain 3D actions even when extras need review");
    for(const row of extraSection.querySelectorAll("[data-practice-extra-review-row]")){
      assert(!row.querySelector("[data-practice-preview-pair-3d]"),"extra review row can never expose 3D missing action");
    }

    const incomplete=inspectPracticeEvidence({lesson,stepIndex:0,circuit:createCircuit(2),
      referenceCircuit:reference,analysis:analyzeCircuit(2,createCircuit(2)),hasLearnerDraft:true});
    const referenceUnknown=deepFreezeFixture({
      ...incomplete,
      claims:{...incomplete.claims,origin:"reference-unknown"},
    });
    assert(render(referenceUnknown,{onPreviewMissingPairIn3D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-3d]").length===0,
      "unknown reference authority suppresses every 3D preview");

    const forgedCheckpoint=deepFreezeFixture({
      ...incomplete,
      checkpoint:{
        ...incomplete.checkpoint,
        requiredPairs:incomplete.checkpoint.requiredPairs.map((pair,index)=>
          index===0?["constructor","GND"]:[...pair]),
      },
      missingPairs:incomplete.missingPairs.map((pair,index)=>index===0?["constructor","GND"]:[...pair]),
      wireGuidance:{
        ...incomplete.wireGuidance,
        missingPairs:incomplete.wireGuidance.missingPairs.map((pair,index)=>
          index===0?["constructor","GND"]:[...pair]),
        pairChecklist:incomplete.wireGuidance.pairChecklist.map((row,index)=>index===0?{
          ...row,pair:["constructor","GND"],inspectTerminalId:"constructor",
        }:{...row,pair:[...row.pair]}),
      },
    });
    assert(render(forgedCheckpoint,{onPreviewMissingPairIn3D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-3d]").length===0,
      "deep-frozen canonical-looking forged checkpoint cannot replace registry checkpoint identity");
  });

  check("3d-preview-adversarial-model-text-never-creates-dom-or-action", () => {
    const lesson=lessons.find(item=>item.id===2);
    const circuit=createCircuit(2);
    const genuine=inspectPracticeEvidence({lesson,stepIndex:0,circuit,
      referenceCircuit:createSampleCircuit(2),analysis:analyzeCircuit(2,circuit),hasLearnerDraft:true});
    const payload='<img src=x onerror="globalThis.pwned=1">';
    const poisoned=deepFreezeFixture({
      ...genuine,
      checkpoint:{...genuine.checkpoint,guidance:payload},
      guidance:payload,
      wireGuidance:{...genuine.wireGuidance,
        pairChecklist:genuine.wireGuidance.pairChecklist.map((row,index)=>
          index===0?{...row,explanation:payload}:{...row,pair:[...row.pair]})},
    });
    const section=render(poisoned,{onPreviewMissingPairIn3D:()=>{}});
    assert(section.textContent.includes(payload),"poisoned model text stays literal textContent");
    assert(!section.querySelector("img"),"poisoned model text cannot create injected node");
    assert(section.querySelectorAll("[data-practice-preview-pair-3d]").length===0,
      "cloned/poisoned checkpoint cannot obtain strict 3D action");
  });

  check("manual-complete-extra-and-forged-wire-checklists-never-preview-missing", () => {
    const lesson=lessons.find(item=>item.id===2);
    const reference=createSampleCircuit(2);
    const all=inspectPracticeEvidence({lesson,stepIndex:0,circuit:reference,
      referenceCircuit:reference,analysis:analyzeCircuit(2,reference),hasLearnerDraft:true});
    assert(render(all,{onPreviewMissingPairIn2D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-2d]").length===0,
      "complete authored pair checklist has no preview-missing button");
    const manual=inspectPracticeEvidence({lesson,stepIndex:1,circuit:createCircuit(2),
      referenceCircuit:reference,analysis:analyzeCircuit(2,createCircuit(2)),hasLearnerDraft:true});
    assert(render(manual,{onPreviewMissingPairIn2D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-2d]").length===0,
      "manual checkpoint cannot expose missing pair preview");
    let extraCircuit=createSampleCircuit(2);
    extraCircuit=connectCircuit(extraCircuit,"D13","GND");
    const extra=inspectPracticeEvidence({lesson,stepIndex:0,circuit:extraCircuit,
      referenceCircuit:reference,analysis:analyzeCircuit(2,extraCircuit),hasLearnerDraft:true});
    assert(render(extra,{onPreviewMissingPairIn2D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-2d]").length===0,
      "extra-only review cannot fabricate missing action");
    const incomplete=inspectPracticeEvidence({lesson,stepIndex:0,circuit:createCircuit(2),
      referenceCircuit:reference,analysis:analyzeCircuit(2,createCircuit(2)),hasLearnerDraft:true});
    const forged={...incomplete,wireGuidance:{...incomplete.wireGuidance,
      pairChecklist:incomplete.wireGuidance.pairChecklist.map((row,i)=>
        i===0?{...row,pair:["constructor","GND"]}:row)}};
    assert(render(forged,{onPreviewMissingPairIn2D:()=>{}})
      .querySelectorAll("[data-practice-preview-pair-2d]").length===0,
      "forged canonical source pair suppresses all preview buttons");
  });

  check("authored-48-steps-preview-available-only-for-real-missing-wiring-pairs", () => {
    let steps=0,missingPairs=0;
    for(const lesson of lessons){
      const circuit=lesson.id===1?null:createCircuit(lesson.id);
      for(let index=0;index<lesson.steps.length;index++){
        const inspection=inspectPracticeEvidence({lesson,stepIndex:index,circuit,
          referenceCircuit:lesson.id===1?null:createSampleCircuit(lesson.id),
          analysis:lesson.id===1?null:analyzeCircuit(lesson.id,circuit),hasLearnerDraft:lesson.id!==1});
        const rendered=render(inspection,{onPreviewMissingPairIn2D:()=>{}});
        const actions=rendered.querySelectorAll("[data-practice-preview-pair-2d]");
        const rows=rendered.querySelectorAll("[data-practice-checklist-row]");
        const expected=rows.filter(row=>row.getAttribute("data-practice-pair-status")==="missing").length;
        assert(actions.length===expected,"lesson "+lesson.id+" step "+index+" missing authored action count drifted");
        missingPairs+=expected;
        steps++;
      }
    }
    assert(steps===48 && missingPairs>20,"all 48 authored checkpoints must be covered");
  });

  check("authored-48-steps-3d-preview-available-only-for-strict-real-missing-wiring-pairs", () => {
    let steps=0,missingPairs=0;
    for(const lesson of lessons){
      const circuit=lesson.id===1?null:createCircuit(lesson.id);
      for(let index=0;index<lesson.steps.length;index++){
        const inspection=inspectPracticeEvidence({lesson,stepIndex:index,circuit,
          referenceCircuit:lesson.id===1?null:createSampleCircuit(lesson.id),
          analysis:lesson.id===1?null:analyzeCircuit(lesson.id,circuit),hasLearnerDraft:lesson.id!==1});
        const rendered=render(inspection,{onPreviewMissingPairIn3D:()=>{}});
        const actions=rendered.querySelectorAll("[data-practice-preview-pair-3d]");
        const rows=rendered.querySelectorAll("[data-practice-checklist-row]");
        const expected=rows.filter(row=>row.getAttribute("data-practice-pair-status")==="missing").length;
        assert(actions.length===expected,
          "lesson "+lesson.id+" step "+index+" strict 3D missing authored action count drifted");
        assert(rendered.querySelectorAll("[data-practice-extra-review-row]")
          .every(row=>!row.querySelector("[data-practice-preview-pair-3d]")),
          "extra review row must never receive 3D action "+lesson.id+"/"+index);
        missingPairs+=expected;
        steps++;
      }
    }
    assert(steps===48 && missingPairs>20,"strict 3D preview covers all 48 authored checkpoints");
  });

  check("canonical-missing-pairs-expose-native-3d-repair-intents-only-after-click", () => {
    const lesson = lessons.find(item => item.id === 2);
    let circuit = createCircuit(2);
    circuit = connectCircuit(circuit, "D13", "R1:A");
    const inspection = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const beforeEvidence = JSON.stringify(inspection);
    const beforeCircuit = JSON.stringify(circuit);
    const intents = [];
    const section = render(inspection, {
      onStartRepairMissingPair: pair => intents.push(pair),
    });
    const rows = section.querySelectorAll("[data-practice-checklist-row]");
    const missingRows = rows.filter(row => row.getAttribute("data-practice-pair-status") === "missing");
    const buttons = section.querySelectorAll("[data-practice-start-repair-missing-pair]");
    assert(buttons.length === missingRows.length && buttons.length === 2,
      "one 3D repair intent must exist per strict canonical missing row");
    assert(!rows[0].querySelector("[data-practice-start-repair-missing-pair]"),
      "matched authored row must never receive repair intent");
    for (const button of buttons) {
      assert(button.tagName === "BUTTON" && button.type === "button",
        "repair entrypoint must be native non-submit button");
      assert(button.disabled === false && button.getAttribute("tabindex") === null && !button.focused,
        "repair entrypoint must keep native keyboard focus and never steal focus on render");
      assert(button.className.split(/\s+/).includes("practice-evidence-repair-action") &&
        button.getAttribute("data-practice-min-target") === "44",
      "repair entrypoint must bind the 44px repair-action style contract");
      assert(button.getAttribute("data-practice-intent-only") === "",
        "repair entrypoint must identify itself as intent-only");
      const name = button.getAttribute("aria-label") || "";
      assert(/authored/i.test(name) && /kiểm tra lại bài, bước và learner graph/i.test(name),
        "repair accessible name must state provenance and host revalidation");
      assert(/không tự tạo dây/i.test(name) && /không tự động xác nhận checkpoint/i.test(name),
        "repair accessible name must deny automatic commit/validation");
    }
    assert(intents.length === 0, "render must never emit repair intent");
    buttons[0].click();
    assert(intents.length === 1 &&
      JSON.stringify(intents[0]) === JSON.stringify(["R1:B", "LED:A"]) &&
      Object.isFrozen(intents[0]),
    "explicit repair click must forward exact frozen canonical pair once");
    assert(JSON.stringify(inspection) === beforeEvidence && JSON.stringify(circuit) === beforeCircuit,
      "repair intent must not mutate evidence or canonical circuit");
  });

  check("canonical-extra-review-pairs-expose-existing-jumper-review-intent-only", () => {
    const lesson = lessons.find(item => item.id === 2);
    const reference = createSampleCircuit(2);
    const circuit = connectCircuit(reference, "D13", "GND");
    const inspection = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: reference,
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const beforeEvidence = JSON.stringify(inspection);
    const beforeCircuit = JSON.stringify(circuit);
    const intents = [];
    const section = render(inspection, {
      onStartReviewExtraPair: pair => intents.push(pair),
    });
    const extraRows = section.querySelectorAll("[data-practice-extra-review-row]");
    const buttons = section.querySelectorAll("[data-practice-start-review-extra-pair]");
    assert(extraRows.length === inspection.extraPairs.length && buttons.length === extraRows.length &&
      buttons.length > 0, "one review intent must exist per strict canonical extra-review row");
    assert(section.querySelectorAll("[data-practice-start-repair-missing-pair]").length === 0,
      "extra-only topology must not fabricate missing-pair repair entrypoints");
    for (const button of buttons) {
      assert(button.tagName === "BUTTON" && button.type === "button" &&
        button.getAttribute("tabindex") === null && !button.focused,
      "extra review entrypoint must be native, focusable, and not auto-focused");
      assert(button.className.split(/\s+/).includes("practice-evidence-repair-action") &&
        button.getAttribute("data-practice-min-target") === "44",
      "extra review entrypoint must bind the 44px repair-action style contract");
      const name = button.getAttribute("aria-label") || "";
      assert(/review-extra/i.test(name) && /canonical reference/i.test(name),
        "extra review accessible name must state review provenance");
      assert(/host phải kiểm tra lại bài, bước và learner graph/i.test(name) &&
        /không tự gỡ dây/i.test(name) && /không tự động xác nhận checkpoint/i.test(name),
      "extra review accessible name must require revalidation and deny automatic removal/validation");
    }
    assert(intents.length === 0, "render must never emit extra-review intent");
    buttons[0].click();
    assert(intents.length === 1 && Object.isFrozen(intents[0]) &&
      JSON.stringify(intents[0]) === JSON.stringify(inspection.extraPairs[0]),
    "explicit review click must forward exact frozen current learner extra pair");
    assert(JSON.stringify(inspection) === beforeEvidence && JSON.stringify(circuit) === beforeCircuit,
      "extra-review intent must not mutate evidence or canonical circuit");
  });

  check("repair-review-hooks-are-optional-visible-disabled-on-valid-rows", () => {
    const lesson = lessons.find(item => item.id === 2);
    const missingCircuit = createCircuit(2);
    const missing = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit: missingCircuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, missingCircuit),
      hasLearnerDraft: true,
    });
    const missingButtons = render(missing).querySelectorAll("[data-practice-start-repair-missing-pair]");
    assert(missingButtons.length === missing.missingPairs.length && missingButtons.every(button =>
      button.disabled && button.getAttribute("aria-disabled") === "true"),
    "valid missing entrypoints remain visible but disabled until host provides callback");

    const reference = createSampleCircuit(2);
    const extraCircuit = connectCircuit(reference, "D13", "GND");
    const extra = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit: extraCircuit,
      referenceCircuit: reference,
      analysis: analyzeCircuit(2, extraCircuit),
      hasLearnerDraft: true,
    });
    const extraButtons = render(extra).querySelectorAll("[data-practice-start-review-extra-pair]");
    assert(extraButtons.length === extra.extraPairs.length && extraButtons.every(button =>
      button.disabled && button.getAttribute("aria-disabled") === "true"),
    "valid extra-review entrypoints remain visible but disabled until host provides callback");
  });

  check("manual-lesson01-matched-and-forged-evidence-never-gain-repair-review-entrypoints", () => {
    const lesson2 = lessons.find(item => item.id === 2);
    const reference2 = createSampleCircuit(2);
    const complete = inspectPracticeEvidence({
      lesson: lesson2,
      stepIndex: 0,
      circuit: reference2,
      referenceCircuit: reference2,
      analysis: analyzeCircuit(2, reference2),
      hasLearnerDraft: true,
    });
    const completeSection = render(complete, {
      onStartRepairMissingPair: () => {},
      onStartReviewExtraPair: () => {},
    });
    assert(completeSection.querySelectorAll("[data-practice-start-repair-missing-pair]").length === 0 &&
      completeSection.querySelectorAll("[data-practice-start-review-extra-pair]").length === 0,
    "matched authored checkpoint must not expose repair/review actions");

    const manualCircuit = createCircuit(2);
    const manual = inspectPracticeEvidence({
      lesson: lesson2,
      stepIndex: 1,
      circuit: manualCircuit,
      referenceCircuit: reference2,
      analysis: analyzeCircuit(2, manualCircuit),
      hasLearnerDraft: true,
    });
    const manualSection = render(manual, {
      onStartRepairMissingPair: () => {},
      onStartReviewExtraPair: () => {},
    });
    assert(manualSection.querySelectorAll("[data-practice-start-repair-missing-pair]").length === 0 &&
      manualSection.querySelectorAll("[data-practice-start-review-extra-pair]").length === 0,
    "manual checkpoint must never expose repair/review actions");

    const lesson1 = lessons.find(item => item.id === 1);
    const lesson1Evidence = inspectPracticeEvidence({
      lesson: lesson1,
      stepIndex: 0,
      circuit: null,
      referenceCircuit: null,
      analysis: null,
      hasLearnerDraft: false,
    });
    const lesson1Section = render(lesson1Evidence, {
      onStartRepairMissingPair: () => {},
      onStartReviewExtraPair: () => {},
    });
    assert(lesson1Section.querySelectorAll("[data-practice-start-repair-missing-pair]").length === 0 &&
      lesson1Section.querySelectorAll("[data-practice-start-review-extra-pair]").length === 0,
    "lesson 1 has no external wiring repair/review entrypoints");

    const missingCircuit = createCircuit(2);
    const genuineMissing = inspectPracticeEvidence({
      lesson: lesson2,
      stepIndex: 0,
      circuit: missingCircuit,
      referenceCircuit: reference2,
      analysis: analyzeCircuit(2, missingCircuit),
      hasLearnerDraft: true,
    });
    const forged = deepFreezeFixture({
      ...genuineMissing,
      checkpoint: {
        ...genuineMissing.checkpoint,
        requiredPairs: genuineMissing.checkpoint.requiredPairs.map(pair => [...pair]),
      },
    });
    const forgedSection = render(forged, {
      onStartRepairMissingPair: () => {},
      onStartReviewExtraPair: () => {},
    });
    assert(forgedSection.querySelectorAll("[data-practice-start-repair-missing-pair]").length === 0 &&
      forgedSection.querySelectorAll("[data-practice-start-review-extra-pair]").length === 0,
    "deep-frozen cloned checkpoint identity must fail closed");
  });

  check("lesson10-and-14-signal-boundary-keeps-only-strict-missing-repair-intents", () => {
    for (const lessonId of [10, 14]) {
      const lesson = lessons.find(item => item.id === lessonId);
      const circuit = createCircuit(lessonId);
      const inspection = inspectPracticeEvidence({
        lesson,
        stepIndex: 0,
        circuit,
        referenceCircuit: createSampleCircuit(lessonId),
        analysis: analyzeCircuit(lessonId, circuit),
        hasLearnerDraft: true,
      });
      const section = render(inspection, { onStartRepairMissingPair: () => {} });
      const missingRows = section.querySelectorAll("[data-practice-checklist-row]")
        .filter(row => row.getAttribute("data-practice-pair-status") === "missing");
      const actions = section.querySelectorAll("[data-practice-start-repair-missing-pair]");
      assert(actions.length === missingRows.length,
        "lesson " + lessonId + " missing repair count must follow strict authored checklist");
      assert(section.querySelectorAll("[data-practice-start-review-extra-pair]").length === 0,
        "lesson " + lessonId + " empty learner graph has no extra-review intent");
      assert(/tín hiệu\/GND/.test(section.textContent),
        "lesson " + lessonId + " must retain signal-only hardware boundary");
      assert(actions.every(button => /không tự động xác nhận checkpoint/i.test(button.getAttribute("aria-label") || "")),
        "lesson " + lessonId + " repair intents must not upgrade validation claims");
    }
  });

  check("repair-intent-model-text-injection-remains-literal-and-cannot-change-pair-binding", () => {
    const lesson = lessons.find(item => item.id === 2);
    const circuit = createCircuit(2);
    const genuine = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const payload = '<img src=x onerror="globalThis.practiceRepairPwned=1">';
    const poisoned = deepFreezeFixture({
      ...genuine,
      checkpoint: genuine.checkpoint,
      wireGuidance: {
        ...genuine.wireGuidance,
        pairChecklist: genuine.wireGuidance.pairChecklist.map((row, index) =>
          index === 0 ? { ...row, explanation: payload } : row),
      },
    });
    const intents = [];
    const section = render(poisoned, { onStartRepairMissingPair: pair => intents.push(pair) });
    const actions = section.querySelectorAll("[data-practice-start-repair-missing-pair]");
    assert(section.textContent.includes(payload) && !section.querySelector("img"),
      "adversarial checklist explanation must remain literal textContent");
    assert(actions.length === poisoned.missingPairs.length,
      "safe text mutation cannot alter canonical pair-action count");
    actions[0].click();
    assert(intents.length === 1 && Object.isFrozen(intents[0]) &&
      JSON.stringify(intents[0]) === JSON.stringify(poisoned.missingPairs[0]),
    "injected text cannot alter exact frozen canonical pair binding");
  });

  check("stale-repair-click-can-be-rejected-by-host-revalidation-without-mutation", () => {
    const lesson = lessons.find(item => item.id === 2);
    const circuit = createCircuit(2);
    const inspection = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const beforeCircuit = JSON.stringify(circuit);
    const beforeEvidence = JSON.stringify(inspection);
    const expectedLessonId = inspection.lessonId;
    const expectedStepIndex = inspection.stepIndex;
    let currentLessonId = expectedLessonId;
    let currentStepIndex = expectedStepIndex;
    const currentGraphPairs = new Set();
    const accepted = [];
    const host = pair => {
      if (currentLessonId !== expectedLessonId || currentStepIndex !== expectedStepIndex) return;
      const key = [...pair].sort().join("\u0000");
      if (currentGraphPairs.has(key)) return;
      accepted.push(pair);
    };
    const section = render(inspection, { onStartRepairMissingPair: host });
    const button = section.querySelector("[data-practice-start-repair-missing-pair]");
    assert(button, "stale-host fixture requires a canonical repair entrypoint");
    currentStepIndex += 1;
    button.click();
    assert(accepted.length === 0,
      "host revalidation must be able to reject stale lesson/step before navigation");
    assert(JSON.stringify(circuit) === beforeCircuit && JSON.stringify(inspection) === beforeEvidence,
      "stale repair click must leave graph/evidence unchanged");
    currentLessonId += 1;
    currentStepIndex = expectedStepIndex;
    button.click();
    assert(accepted.length === 0,
      "host revalidation must also reject stale lesson identity");
    currentLessonId = expectedLessonId;
    currentGraphPairs.add(
      [button.getAttribute("data-practice-repair-from"), button.getAttribute("data-practice-repair-to")]
        .sort().join("\u0000"),
    );
    button.click();
    assert(accepted.length === 0,
      "host revalidation must reject stale missing intent after current graph already contains the pair");
    assert(JSON.stringify(circuit) === beforeCircuit && JSON.stringify(inspection) === beforeEvidence,
      "stale graph rejection must not mutate source circuit/evidence");
  });

  check("all-48-authored-checkpoints-expose-repair-only-for-strict-current-missing-rows", () => {
    let steps = 0;
    let repairActions = 0;
    for (const lesson of lessons) {
      const circuit = lesson.id === 1 ? null : createCircuit(lesson.id);
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const inspection = inspectPracticeEvidence({
          lesson,
          stepIndex,
          circuit,
          referenceCircuit: lesson.id === 1 ? null : createSampleCircuit(lesson.id),
          analysis: lesson.id === 1 ? null : analyzeCircuit(lesson.id, circuit),
          hasLearnerDraft: lesson.id !== 1,
        });
        const section = render(inspection, { onStartRepairMissingPair: () => {} });
        const expected = section.querySelectorAll("[data-practice-checklist-row]")
          .filter(row => row.getAttribute("data-practice-pair-status") === "missing").length;
        const actions = section.querySelectorAll("[data-practice-start-repair-missing-pair]");
        assert(actions.length === expected,
          "repair action count drift " + lesson.id + "/" + stepIndex);
        assert(section.querySelectorAll("[data-practice-extra-review-row]")
          .every(row => !row.querySelector("[data-practice-start-repair-missing-pair]")),
        "extra-review row must never receive missing repair action " + lesson.id + "/" + stepIndex);
        repairActions += actions.length;
        steps += 1;
      }
    }
    assert(steps === 48 && repairActions > 20,
      "all 48 authored checkpoints must preserve strict repair-action coverage");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
