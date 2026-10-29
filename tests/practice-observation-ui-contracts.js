import { lessons } from "../src/lessons.js";
import {
  createPracticeObservationJournal,
  inspectPracticeObservation,
  recordPracticeObservation,
} from "../src/practice-observation.js";
import {
  renderObservation,
  renderPracticeObservation,
} from "../src/practice-observation-ui.js";

function assert(condition, message) {
  if (!condition) throw new Error("practice-observation-ui contract: " + message);
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
    this.className = "";
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
    throw new Error("observation renderer must not use innerHTML");
  }

  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeNode, "fake DOM append expects node");
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

function lessonById(id) {
  const lesson = lessons.find(item => item.id === id);
  if (!lesson) throw new Error("missing lesson " + id);
  return lesson;
}

function observe(lessonId, stepIndex, journal = createPracticeObservationJournal()) {
  return inspectPracticeObservation({ lesson: lessonById(lessonId), stepIndex, journal });
}

function render(value) {
  return renderPracticeObservation(new FakeDocument(), value);
}

export function runPracticeObservationUiContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("exports-renderObservation-alias", () => {
    assert(renderObservation === renderPracticeObservation, "renderObservation alias must stay stable");
  });

  check("renders-accessible-separate-observation-status-block", () => {
    const section = render(observe(2, 0));
    assert(section.tagName === "SECTION", "renderer returns section");
    assert(section.getAttribute("data-practice-observation") === "", "root observation selector missing");
    assert(section.getAttribute("role") === "status", "observation block must expose status role");
    assert(section.getAttribute("aria-live") === "polite", "observation block must be polite live region");
    assert(section.getAttribute("data-observation-status") === "no-lesson-event-overlap", "status selector drift");
    assert(section.getAttribute("data-observation-lesson") === "2", "lesson selector missing");
    assert(section.getAttribute("data-observation-step") === "0", "step selector missing");
    assert(section.getAttribute("data-observation-checkpoint") === "lesson-02-step-01", "checkpoint selector missing");
    assert(/Hoạt động ghi nhận trong ứng dụng/.test(section.textContent), "required heading missing");
    assert(section.querySelector("[data-observation-expected]"), "expected event block missing");
    assert(section.querySelector("[data-observation-recorded]"), "recorded event block missing");
    assert(section.querySelector("[data-observation-overlap]"), "overlap block missing");
    assert(section.querySelector("[data-observation-attribution-note]"), "attribution boundary missing");
    assert(section.querySelector("[data-observation-boundary]"), "non-claim boundary missing");
  });

  check("lesson-event-overlap-is-never-rendered-as-step-pass-or-completion", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 2, eventType: "change-control" });
    const section = render(observe(2, 1, journal));
    const text = section.textContent;
    assert(section.getAttribute("data-observation-status") === "lesson-event-overlap", "overlap status missing");
    assert(/event cùng lesson.*trùng/i.test(text), "overlap wording must stay lesson-scoped");
    assert(/caller báo cho module/i.test(text), "overlap wording must not claim host-only provenance");
    assert(/không lưu stepIndex hay timestamp/i.test(text), "no-step-attribution note missing");
    assert(/không chứng minh event đã xảy ra tại bước hiện tại/i.test(text), "step attribution caveat missing");
    assert(/không xác nhận của giáo viên/i.test(text), "teacher validation boundary missing");
    assert(/không đo mastery/i.test(text), "mastery boundary missing");
    assert(/không tự hoàn thành bài/i.test(text), "completion boundary missing");
    assert(/không phải điều kiện để chuyển bước/i.test(text), "advance prerequisite boundary missing");
    assert(!/đạt checkpoint|đã hoàn thành|pass|thành thạo/i.test(text), "overlap must not be presented as pass/mastery");
  });

  check("no-overlap-only-describes-current-app-journal", () => {
    const section = render(observe(12, 1));
    const text = section.textContent;
    assert(/journal module-branded trong phiên hiện tại chưa có event/i.test(text),
      "absence wording must be scoped to current module-branded journal");
    assert(/không suy ra hoạt động ngoài ứng dụng/i.test(text), "outside-app inference boundary missing");
    assert(!/người học chưa làm|học viên chưa thực hiện|chưa thao tác/i.test(text),
      "UI must not infer learner inactivity outside journal");
  });

  check("ui-never-claims-host-only-event-provenance", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 2, eventType: "view-wiring" });
    const text = render(observe(2, 0, journal)).textContent;
    assert(/được caller báo cho module/i.test(text), "UI should state caller-to-module provenance");
    assert(!/chỉ host|host-only|host app đã ghi nhận|người dùng đã thực hiện/i.test(text),
      "UI must not promote module report into host/user provenance");
  });

  check("no-editorial-expectation-is-neutral-and-explicit", () => {
    const section = render(observe(9, 0));
    assert(section.getAttribute("data-observation-status") === "no-editorial-expectation",
      "neutral no-expectation status missing");
    assert(/chưa được gán event category/i.test(section.textContent), "no-expectation explanation missing");
    assert(/không bắt buộc/i.test(section.textContent), "editorial expectation must be non-required");
    assert(!/thiếu hoạt động|chưa hoàn thành|không đạt/i.test(section.textContent),
      "no expectation must not become failure");
  });

  check("renders-known-event-labels-with-machine-event-types", () => {
    let journal = createPracticeObservationJournal();
    for (const eventType of [
      "view-pinout", "view-3d", "view-wiring", "change-control",
      "start-simulation", "edit-sketch", "connect-wire",
    ]) {
      journal = recordPracticeObservation(journal, { lessonId: 1, eventType });
    }
    const section = render(observe(1, 2, journal));
    const text = section.textContent;
    for (const eventType of [
      "view-pinout", "view-3d", "view-wiring", "change-control",
      "start-simulation", "edit-sketch", "connect-wire",
    ]) {
      assert(text.includes("(" + eventType + ")"), "event type should remain inspectable: " + eventType);
    }
    assert(/Mở sơ đồ chân/.test(text), "pinout label missing");
    assert(/Nối dây trong ứng dụng/.test(text), "connect-wire label missing");
  });

  check("recorded-event-counts-remain-lesson-scoped", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 3, eventType: "view-wiring" });
    journal = recordPracticeObservation(journal, { lessonId: 3, eventType: "view-wiring" });
    journal = recordPracticeObservation(journal, { lessonId: 4, eventType: "view-wiring" });
    const section = render(observe(3, 0, journal));
    assert(section.getAttribute("data-observation-lesson-events") === "2", "lesson event count drift");
    assert(section.getAttribute("data-observation-matching-events") === "2", "matching event count drift");
    assert(!section.textContent.includes("3 lần"), "foreign lesson event must not leak into count copy");
  });

  check("untrusted-model-text-is-written-as-text-content", () => {
    const payload = '<img src=x onerror="globalThis.pwned=1">';
    const value = {
      ...observe(2, 0),
      sourceStep: payload,
      summary: payload,
    };
    const section = render(value);
    assert(section.textContent.includes(payload), "literal payload should remain text");
    assert(!section.querySelector("img"), "renderer must never create injected DOM node");
  });

  check("unknown-status-fails-neutral", () => {
    const section = render({ ...observe(2, 0), status: "future-status" });
    assert(/Trạng thái observation chưa được nhận diện/.test(section.textContent), "unknown status neutral label missing");
    assert(/không nâng trạng thái chưa nhận diện/i.test(section.textContent), "unknown status safety copy missing");
    assert(!/đã hoàn thành|đã thành thạo/i.test(section.textContent), "unknown status must not become positive claim");
  });

  check("invalid-host-inputs-fail-fast", () => {
    expectThrow(() => renderPracticeObservation(null, observe(2, 0)), /document/i, "missing document");
    expectThrow(() => renderPracticeObservation(new FakeDocument(), null), /observation/i, "missing observation");
  });

  check("canonical-model-output-renders-all-48-checkpoints", () => {
    let rendered = 0;
    for (const lesson of lessons) {
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const value = inspectPracticeObservation({
          lesson,
          stepIndex,
          journal: createPracticeObservationJournal(),
        });
        const section = render(value);
        rendered += 1;
        assert(section.getAttribute("data-observation-lesson") === String(lesson.id),
          "lesson attr drift " + lesson.id + "/" + stepIndex);
        assert(section.getAttribute("data-observation-step") === String(stepIndex),
          "step attr drift " + lesson.id + "/" + stepIndex);
        assert(section.getAttribute("data-observation-status") === value.status,
          "status attr drift " + lesson.id + "/" + stepIndex);
        assert(section.textContent.includes(lesson.steps[stepIndex]),
          "source step missing " + lesson.id + "/" + stepIndex);
        assert(/không tự hoàn thành bài/i.test(section.textContent),
          "no-completion boundary missing " + lesson.id + "/" + stepIndex);
        assert(/không xác nhận của giáo viên/i.test(section.textContent),
          "no-teacher boundary missing " + lesson.id + "/" + stepIndex);
      }
    }
    assert(rendered === 48, "expected all 48 checkpoints rendered");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
