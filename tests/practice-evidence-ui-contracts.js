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

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
