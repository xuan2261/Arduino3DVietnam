import { lessons } from "../src/lessons.js";
import { inspectSketchDraft } from "../src/sketch-review.js";
import { renderSketchReview } from "../src/sketch-review-ui.js";

function assert(condition, message) {
  if (!condition) throw new Error("sketch-review-ui contract: " + message);
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

function referenceInspection(lessonId = 2) {
  const lesson = lessons[lessonId - 1];
  return inspectSketchDraft({
    lessonId,
    reference: lesson.sketch,
    draft: lesson.sketch,
  });
}

function changedInspection(lessonId = 2) {
  const lesson = lessons[lessonId - 1];
  return inspectSketchDraft({
    lessonId,
    reference: lesson.sketch,
    draft: lesson.sketch.replace("1000", "250"),
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function render(inspection) {
  return renderSketchReview(new FakeDocument(), inspection);
}

export function runSketchReviewUiContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("exports-stable-root-selectors-and-live-status", () => {
    const section = render(changedInspection());
    assert(section.tagName === "SECTION", "renderer must return section");
    assert(section.getAttribute("data-sketch-review") === "", "root selector");
    assert(section.getAttribute("data-sketch-review-status") === "changed", "status attr");
    assert(section.getAttribute("data-sketch-review-lesson") === "2", "lesson attr");
    assert(section.getAttribute("data-sketch-review-changed-lines") === "1", "changed-lines attr");
    assert(section.querySelector("[data-sketch-review-counts]"), "counts selector");
    assert(section.querySelector("[data-sketch-review-guidance]"), "guidance selector");
    assert(section.querySelector("[data-sketch-review-warnings]"), "warnings selector");
    assert(section.querySelector("[data-sketch-review-boundary]"), "boundary selector");
    const status = section.querySelector("[data-sketch-review-status-label]");
    assert(status?.getAttribute("role") === "status", "status role");
    assert(status?.getAttribute("aria-live") === "polite", "aria-live");
    assert(status?.getAttribute("aria-atomic") === "true", "aria atomic");
  });

  check("reference-and-changed-copy-stay-source-comparison-only", () => {
    const reference = render(referenceInspection());
    assert(/trùng mã tham khảo/i.test(reference.textContent), "reference status copy");
    assert(reference.getAttribute("data-sketch-review-tone") === "reference", "reference tone");

    const changed = render(changedInspection());
    assert(/khác mã tham khảo/i.test(changed.textContent), "changed status copy");
    assert(/sửa 1.*thêm 0.*xóa 0/i.test(changed.textContent), "change counts copy");
  });

  check("heuristic-warning-is-accessible-with-code-and-line", () => {
    const lesson = lessons[1];
    const inspection = inspectSketchDraft({
      lessonId: 2,
      reference: lesson.sketch,
      draft: "void setup() {}\nvoid loop() {\n",
    });
    const section = render(inspection);
    assert(section.getAttribute("data-sketch-review-tone") === "warning", "warning tone");
    assert(Number(section.getAttribute("data-sketch-review-warning-count")) > 0, "warning count");
    const row = section.querySelector("[data-sketch-review-warning='BRACE_UNCLOSED_OPEN']");
    assert(row && /Dòng 2/.test(row.textContent), "warning line and code");
  });

  check("no-warning-copy-does-not-upgrade-to-compile-or-semantic-validation", () => {
    const section = render(referenceInspection());
    assert(/Không thấy cảnh báo setup\(\)\/loop\(\)\/ngoặc nhọn/i.test(section.textContent),
      "heuristic no-warning copy");
    const boundary = section.querySelector("[data-sketch-review-boundary]");
    assert(/không biên dịch Arduino C\+\+/i.test(boundary.textContent), "compile boundary");
    assert(/không kiểm tra ngữ nghĩa C\+\+/i.test(boundary.textContent), "semantic boundary");
    assert(/không chạy firmware/i.test(boundary.textContent), "firmware boundary");
    assert(/không xác nhận.*ảnh hưởng mô phỏng/i.test(boundary.textContent), "simulation boundary");
    assert(/không đánh giá.*hoàn thành.*hiểu bài/i.test(boundary.textContent), "completion boundary");
    assert(!/biên dịch thành công|firmware đã chạy|đã hoàn thành bài|đã hiểu bài/i.test(section.textContent),
      "forbidden positive claim");
  });

  check("renderer-is-presentation-only-with-no-buttons-or-callback-contract", () => {
    const inspection = changedInspection();
    const before = JSON.stringify(inspection);
    const section = render(inspection);
    assert(section.querySelector("button") === null, "renderer must expose no action buttons");
    assert(JSON.stringify(inspection) === before, "renderer must not mutate inspection");
  });

  check("dynamic-text-uses-textcontent-and-cannot-create-dom", () => {
    const forged = clone(changedInspection());
    const payload = "<img src=x onerror=globalThis.pwned=1>";
    forged.guidance = [payload];
    forged.warnings = [{
      code: "TEST_WARNING",
      severity: "warning",
      message: payload,
      line: 4,
    }];
    const section = render(forged);
    assert(section.textContent.includes(payload), "dynamic text should remain literal");
    assert(section.querySelector("img") === null, "dynamic text must not create img nodes");
  });

  check("large-forged-arrays-are-bounded-at-render-time", () => {
    const forged = clone(changedInspection());
    forged.guidance = Array.from({ length: 30 }, (_, index) => "Gợi ý " + index);
    forged.warnings = Array.from({ length: 30 }, (_, index) => ({
      code: "W" + index,
      severity: "warning",
      message: "Cảnh báo " + index,
      line: index + 1,
    }));
    const section = render(forged);
    assert(section.querySelectorAll("[data-sketch-review-warning]").length === 12,
      "warning render bound");
    assert(section.querySelector("[data-sketch-review-guidance]").querySelectorAll("li").length === 8,
      "guidance render bound");
    assert(/Còn 18 cảnh báo khác/.test(section.textContent), "warning truncation disclosure");
  });

  check("very-long-dynamic-guidance-is-clipped", () => {
    const forged = clone(changedInspection());
    forged.guidance = ["X".repeat(3000)];
    const section = render(forged);
    const text = section.querySelector("[data-sketch-review-guidance]").textContent;
    assert(text.length < 1200 && text.includes("…"), "dynamic guidance clipping");
  });

  check("invalid-document-or-inspection-fails-fast", () => {
    expectThrow(() => renderSketchReview(null, referenceInspection()), /document/i, "missing document");
    expectThrow(() => renderSketchReview(new FakeDocument(), null), /inspection/i, "missing inspection");
    const badVersion = clone(referenceInspection());
    badVersion.schemaVersion = 99;
    expectThrow(() => render(badVersion), /schemaVersion/i, "bad schema");
    const badStatus = clone(referenceInspection());
    badStatus.status = "compiled";
    expectThrow(() => render(badStatus), /status/i, "bad status");
  });

  check("forged-positive-claims-or-provenance-fail-closed", () => {
    const compiled = clone(referenceInspection());
    compiled.claims.compiled = true;
    expectThrow(() => render(compiled), /claim/i, "compiled claim");

    const completed = clone(referenceInspection());
    completed.claims.learnerCompletion = true;
    expectThrow(() => render(completed), /claim/i, "completion claim");

    const provenance = clone(referenceInspection());
    provenance.provenance.reference = "compiled-binary";
    expectThrow(() => render(provenance), /provenance/i, "foreign provenance");
  });

  check("all-16-canonical-inspections-render-with-exact-lesson-and-status", () => {
    for (const lesson of lessons) {
      const inspection = inspectSketchDraft({
        lessonId: lesson.id,
        reference: lesson.sketch,
        draft: lesson.sketch,
      });
      const section = render(inspection);
      assert(section.getAttribute("data-sketch-review-lesson") === String(lesson.id),
        "lesson " + lesson.id + " attr");
      assert(section.getAttribute("data-sketch-review-status") === "reference",
        "lesson " + lesson.id + " status");
      assert(section.getAttribute("data-sketch-review-warning-count") === "0",
        "lesson " + lesson.id + " warning count");
      assert(/không biên dịch Arduino C\+\+/i.test(section.textContent),
        "lesson " + lesson.id + " boundary");
    }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
