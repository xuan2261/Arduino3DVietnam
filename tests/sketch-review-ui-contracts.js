import { lessons } from "../src/lessons.js";
import { inspectSketchPinEvidence } from "../src/sketch-pin-evidence.js";
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
    this.style = {};
    this.listeners = new Map();
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

function renderWithPinEvidence(inspection, source) {
  const pinEvidence = inspectSketchPinEvidence({ lessonId: inspection.lessonId, source });
  return renderSketchReview(new FakeDocument(), inspection, { pinEvidence });
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
    assert(section.querySelector("[data-sketch-review-lexical]"), "lexical selector");
    assert(section.querySelector("[data-sketch-review-boundary]"), "boundary selector");
    const status = section.querySelector("[data-sketch-review-status-label]");
    assert(status?.getAttribute("role") === "status", "status role");
    assert(status?.getAttribute("aria-live") === "polite", "aria-live");
    assert(status?.getAttribute("aria-atomic") === "true", "aria atomic");
    const lexicalStatus = section.querySelector("[data-sketch-review-lexical-summary]");
    assert(lexicalStatus?.getAttribute("role") === "status", "lexical status role");
    assert(lexicalStatus?.getAttribute("aria-live") === "polite", "lexical status live");
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

  check("commented-reference-call-renders-line-aware-lexical-difference", () => {
    const lesson = lessons[1];
    const draft = lesson.sketch
      .replace("  digitalWrite(LED, HIGH);", "  // digitalWrite(LED, HIGH);")
      .replace("  digitalWrite(LED, LOW);", "  // digitalWrite(LED, LOW);");
    const inspection = inspectSketchDraft({
      lessonId: 2,
      reference: lesson.sketch,
      draft,
    });
    const section = render(inspection);
    assert(section.getAttribute("data-sketch-review-tone") === "warning",
      "lexical difference should surface warning tone");
    assert(section.getAttribute("data-sketch-review-lexical-difference-count") !== "0",
      "lexical difference count");
    const row = section.querySelector("[data-sketch-review-lexical-finding='digital-write']");
    assert(row?.getAttribute("data-sketch-review-lexical-status") === "absent",
      "commented calls must render absent");
    assert(/Mẫu dòng \d+/.test(row?.textContent || ""), "reference line must be visible");
    assert(/chưa thấy ngoài comment\/string/i.test(row?.textContent || ""),
      "masked-source explanation missing");
  });

  check("parenthesis-syntax-warning-renders-line-with-lexical-boundary", () => {
    const lesson = lessons[1];
    const inspection = inspectSketchDraft({
      lessonId: 2,
      reference: lesson.sketch,
      draft: "void setup() { pinMode(13, OUTPUT; }\nvoid loop() {}",
    });
    const section = render(inspection);
    const row = section.querySelector("[data-sketch-review-warning='PAREN_UNCLOSED_OPEN']");
    assert(row && /Dòng 1/.test(row.textContent), "parenthesis warning line");
    assert(/heuristic lexical/i.test(section.querySelector("[data-sketch-review-boundary]")?.textContent || ""),
      "lexical boundary disclosure");
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
    const payload = "Ω漢<img src=x onerror=globalThis.pwned=1>";
    forged.guidance = [payload];
    forged.warnings = [{
      code: "TEST_WARNING",
      severity: "warning",
      message: payload,
      line: 4,
    }];
    forged.lexical.findings[0].label = payload;
    forged.lexical.findings[0].hint = payload;
    forged.lexical.findings[0].status = "absent";
    forged.lexical.findings[0].draftCount = 0;
    forged.lexical.findings[0].draftLine = null;
    forged.lexical.differenceCount = 1;
    forged.lexical.presentFeatureCount = forged.lexical.expectedFeatureCount - 1;
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

  check("forged-lexical-mode-counts-or-status-fail-closed", () => {
    const badMode = clone(referenceInspection());
    badMode.lexical.mode = "raw-source-scan";
    expectThrow(() => render(badMode), /lexical/i, "bad lexical mode");

    const badCounts = clone(referenceInspection());
    badCounts.lexical.differenceCount = 1;
    expectThrow(() => render(badCounts), /counts/i, "inconsistent lexical counts");

    const badStatus = clone(referenceInspection());
    badStatus.lexical.findings[0].status = "compiled";
    expectThrow(() => render(badStatus), /findings/i, "bad lexical finding status");

    const impossiblePresent = clone(referenceInspection());
    impossiblePresent.lexical.findings[0].draftCount = 0;
    impossiblePresent.lexical.findings[0].draftLine = null;
    expectThrow(() => render(impossiblePresent), /status\/count\/line/i,
      "present feature with zero draft count");

    const forgedAggregate = clone(referenceInspection());
    forgedAggregate.lexical.findings[0].status = "absent";
    forgedAggregate.lexical.findings[0].draftCount = 0;
    forgedAggregate.lexical.findings[0].draftLine = null;
    expectThrow(() => render(forgedAggregate), /aggregate counts/i,
      "finding status disagrees with aggregate counts");
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
      assert(section.getAttribute("data-sketch-review-lexical-difference-count") === "0",
        "lesson " + lesson.id + " lexical difference count");
      const lexicalStatus = section.querySelector("[data-sketch-review-lexical-summary]");
      assert(/bỏ qua comment\/string/i.test(lexicalStatus?.textContent || ""),
        "lesson " + lesson.id + " masked lexical disclosure");
      assert(/không biên dịch Arduino C\+\+/i.test(section.textContent),
        "lesson " + lesson.id + " boundary");
    }
  });

  check("pin-evidence-is-explicit-opt-in-with-separate-accessible-region", () => {
    const inspection = referenceInspection(2);
    assert(render(inspection).querySelector("[data-sketch-pin-evidence]") === null,
      "legacy two-arg render must not add pin evidence");

    const section = renderWithPinEvidence(
      inspection,
      "void loop() { digitalWrite(13, HIGH); }",
    );
    assert(section.getAttribute("data-sketch-review-pin-evidence") === "true", "root opt-in marker");
    const block = section.querySelector("[data-sketch-pin-evidence]");
    assert(block?.tagName === "SECTION", "separate semantic section");
    assert(/Bằng chứng lexical về chân Arduino/i.test(block?.getAttribute("aria-label") || ""),
      "pin evidence aria label");
    const status = block.querySelector("[data-sketch-pin-evidence-summary]");
    assert(status?.getAttribute("role") === "status", "pin summary status role");
    assert(status?.getAttribute("aria-live") === "polite", "pin summary live region");
    assert(status?.getAttribute("aria-atomic") === "true", "pin summary atomic");
    assert(block.querySelector("button") === null,
      "pin evidence without callback must remain read-only");
  });

  check("pin-evidence-terminal-inspection-action-is-opt-in-native-and-canonical", () => {
    const inspection = referenceInspection(2);
    const pinEvidence = inspectSketchPinEvidence({
      lessonId: 2,
      source: "digitalWrite(13, HIGH);\ndigitalWrite(13, LOW);",
    });
    const callbackArgs = [];
    const section = renderSketchReview(new FakeDocument(), inspection, {
      pinEvidence,
      onInspectTerminal(...args) { callbackArgs.push(args); },
    });
    const buttons = section.querySelectorAll("[data-sketch-pin-inspect-terminal]");
    assert(buttons.length === 2, "one inspect action per displayed direct lesson-terminal call");
    assert(callbackArgs.length === 0, "render must not auto-inspect a terminal");
    for (const [index, button] of buttons.entries()) {
      assert(button.tagName === "BUTTON" && button.type === "button", "native type=button action");
      assert(button.getAttribute("data-sketch-pin-inspect-terminal") === "D13", "canonical terminal attr");
      assert(button.getAttribute("data-sketch-pin-inspect-lesson") === "2", "current lesson attr");
      assert(button.getAttribute("data-sketch-pin-inspect-call") === String(index + 1), "call sequence attr");
      assert(button.style.minWidth === "44px" && button.style.minHeight === "44px", "44px target");
      assert(/D13.*bài 2.*chỉ điều hướng đọc.*không tạo dây.*chạy mã/i.test(
        button.getAttribute("aria-label") || ""), "accessible read-only action label");
    }
    buttons[0].click();
    assert(callbackArgs.length === 1 && callbackArgs[0].length === 2,
      "callback must receive exactly terminal and lesson");
    assert(callbackArgs[0][0] === "D13" && callbackArgs[0][1] === 2,
      "callback canonical terminal + current lesson");
    assert(pinEvidence.claims.executesFirmware === false &&
      pinEvidence.claims.validatesPinConnection === false &&
      pinEvidence.claims.provesLearnerCompletion === false,
      "action must not upgrade static evidence claims");
  });

  check("pin-evidence-renders-routed-outside-and-unknown-statuses-without-upgrading-them", () => {
    const inspection = referenceInspection(2);
    const pinEvidence = inspectSketchPinEvidence({ lessonId: 2, source: [
      "digitalWrite(13, HIGH);",
      "tone(12, 440);",
      "digitalRead(BUTTON);",
    ].join("\n") });
    const section = renderSketchReview(new FakeDocument(), inspection, {
      pinEvidence,
      onInspectTerminal() {},
    });
    const routed = section.querySelector("[data-sketch-pin-evidence-status='lesson-terminal']");
    const outside = section.querySelector("[data-sketch-pin-evidence-status='not-in-lesson']");
    const unknown = section.querySelector("[data-sketch-pin-evidence-status='unknown']");
    assert(routed?.getAttribute("data-sketch-pin-evidence-terminal") === "D13", "router D13 attr");
    assert(/circuit-router của bài/i.test(routed?.textContent || ""), "router authority copy");
    assert(/literal D12.*không có terminal/i.test(outside?.textContent || ""),
      "outside lesson remains outside");
    assert(/alias\/macro\/biểu thức\/hàm không được suy đoán/i.test(unknown?.textContent || ""),
      "unknown source form disclosure");
    assert(routed?.querySelectorAll("[data-sketch-pin-inspect-terminal]").length === 1,
      "lesson-terminal gets exactly one action");
    assert(outside?.querySelector("[data-sketch-pin-inspect-terminal]") === null,
      "not-in-lesson must never get inspect action");
    assert(unknown?.querySelector("[data-sketch-pin-inspect-terminal]") === null,
      "unknown must never get inspect action");
  });

  check("pin-evidence-boundary-denies-compile-execution-connection-and-completion-claims", () => {
    const section = renderWithPinEvidence(
      referenceInspection(2),
      "digitalWrite(13, HIGH);",
    );
    const boundary = section.querySelector("[data-sketch-pin-evidence-boundary]");
    assert(boundary?.getAttribute("role") === "note", "pin boundary note role");
    assert(/bằng chứng lexical tĩnh/i.test(boundary?.textContent || ""), "lexical wording");
    assert(/không biên dịch Arduino C\+\+/i.test(boundary?.textContent || ""), "compile denial");
    assert(/không chạy firmware/i.test(boundary?.textContent || ""), "firmware denial");
    assert(/không chứng minh lời gọi đã thực thi/i.test(boundary?.textContent || ""), "execution denial");
    assert(/không xác nhận chân đã được nối dây hoặc kết nối điện đúng/i.test(boundary?.textContent || ""),
      "pin connection denial");
    assert(/không đánh giá hoàn thành bài/i.test(boundary?.textContent || ""), "completion denial");
  });

  check("pin-evidence-dynamic-argument-text-cannot-create-dom", () => {
    const inspection = referenceInspection(2);
    const forged = clone(inspectSketchPinEvidence({
      lessonId: 2,
      source: "digitalRead(BUTTON);",
    }));
    const payload = "Ω漢<img src=x onerror=globalThis.pwned=1>";
    forged.calls[0].argument = payload;
    const section = renderSketchReview(new FakeDocument(), inspection, {
      pinEvidence: forged,
      onInspectTerminal() { throw new Error("unknown call must not expose action"); },
    });
    const block = section.querySelector("[data-sketch-pin-evidence]");
    assert(block.textContent.includes(payload), "payload remains literal text");
    assert(block.querySelector("img") === null, "payload must not create img node");
    assert(block.querySelector("[data-sketch-pin-inspect-terminal]") === null,
      "XSS/unknown argument must not expose inspect action");
  });

  check("forged-pin-evidence-lesson-claims-counts-status-or-provenance-fail-closed", () => {
    const inspection = referenceInspection(2);
    const base = () => clone(inspectSketchPinEvidence({
      lessonId: 2,
      source: "digitalWrite(13, HIGH);",
    }));
    const renderForged = evidence =>
      renderSketchReview(new FakeDocument(), inspection, {
        pinEvidence: evidence,
        onInspectTerminal() { throw new Error("forged evidence callback must never run"); },
      });

    const wrongLesson = base();
    wrongLesson.lessonId = 3;
    expectThrow(() => renderForged(wrongLesson), /bài học khác/i, "pin evidence lesson mismatch");

    const positiveClaim = base();
    positiveClaim.claims.executesFirmware = true;
    expectThrow(() => renderForged(positiveClaim), /claim/i, "firmware claim");

    const badCounts = base();
    badCounts.summary.callCount = 2;
    expectThrow(() => renderForged(badCounts), /callCount.*nhất quán/i, "summary mismatch");

    const badStatus = base();
    badStatus.calls[0].status = "compiled";
    expectThrow(() => renderForged(badStatus), /calls.*không hợp lệ/i, "bad call status");

    const bidiArgument = base();
    bidiArgument.calls[0].status = "unknown";
    bidiArgument.calls[0].argument = "LED\u202E";
    bidiArgument.calls[0].literalKind = null;
    bidiArgument.calls[0].literalPin = null;
    bidiArgument.calls[0].lessonTerminalId = null;
    bidiArgument.calls[0].reason = "non-literal-pin-expression";
    bidiArgument.summary.lessonTerminalCallCount = 0;
    bidiArgument.summary.unknownCallCount = 1;
    bidiArgument.summary.uniqueLessonTerminalCount = 0;
    bidiArgument.matchedTerminalIds = [];
    expectThrow(() => renderForged(bidiArgument), /calls.*không hợp lệ/i, "bidi argument");

    const badLiteralMapping = base();
    badLiteralMapping.calls[0].literalPin = "D12";
    badLiteralMapping.calls[0].lessonTerminalId = "D12";
    badLiteralMapping.lessonTerminalIds = ["D12"];
    badLiteralMapping.matchedTerminalIds = ["D12"];
    expectThrow(() => renderForged(badLiteralMapping), /lesson-terminal shape/i,
      "literal mapping must agree with api/argument");

    const unicodeTerminal = base();
    unicodeTerminal.calls[0].literalPin = "D13Ω";
    unicodeTerminal.calls[0].lessonTerminalId = "D13Ω";
    unicodeTerminal.lessonTerminalIds = ["D13Ω"];
    unicodeTerminal.matchedTerminalIds = ["D13Ω"];
    expectThrow(() => renderForged(unicodeTerminal), /lessonTerminalIds|calls/i,
      "Unicode-forged terminal ID must fail before action render");

    const badProvenance = base();
    badProvenance.provenance.terminalIds = "caller-supplied";
    expectThrow(() => renderForged(badProvenance), /provenance/i, "foreign terminal provenance");
  });

  check("pin-evidence-render-row-count-is-bounded-with-truncation-disclosure", () => {
    const inspection = referenceInspection(2);
    const source = Array.from({ length: 40 }, () => "digitalWrite(13, HIGH);").join("\n");
    const pinEvidence = inspectSketchPinEvidence({ lessonId: 2, source });
    const inspected = [];
    const section = renderSketchReview(new FakeDocument(), inspection, {
      pinEvidence,
      onInspectTerminal: (terminalId, lessonId) => inspected.push([terminalId, lessonId]),
    });
    const block = section.querySelector("[data-sketch-pin-evidence]");
    assert(block.querySelectorAll("[data-sketch-pin-evidence-call]").length === 32,
      "pin evidence render bound");
    assert(/Còn 8 lời gọi lexical khác/i.test(block.textContent), "pin evidence truncation copy");
    const actions = block.querySelectorAll("[data-sketch-pin-inspect-terminal]");
    assert(actions.length === 32, "inspect actions obey the same 32-row cap");
    actions[31].click();
    assert(JSON.stringify(inspected) === JSON.stringify([["D13", 2]]),
      "capped action callback remains canonical/current lesson");
  });

  check("pin-evidence-options-reject-unrelated-or-prototype-named-props", () => {
    const inspection = referenceInspection(2);
    expectThrow(
      () => renderSketchReview(new FakeDocument(), inspection, { terminalIds: ["D13"] }),
      /prop không được hỗ trợ/i,
      "terminal injection prop",
    );
    const options = {};
    Object.defineProperty(options, "__proto__", { value: "D13", enumerable: true });
    expectThrow(
      () => renderSketchReview(new FakeDocument(), inspection, options),
      /prop không được hỗ trợ/i,
      "prototype-named prop",
    );
    expectThrow(
      () => renderSketchReview(new FakeDocument(), inspection, { onInspectTerminal: "D13" }),
      /onInspectTerminal.*function/i,
      "callback type",
    );
  });

  check("pin-evidence-inspection-action-rejects-foreign-lesson-context-for-all-16-lessons", () => {
    for (const lesson of lessons) {
      const foreignLessonId = lesson.id === 16 ? 15 : lesson.id + 1;
      const foreignEvidence = inspectSketchPinEvidence({
        lessonId: foreignLessonId,
        source: "digitalWrite(13, HIGH); analogRead(A0);",
      });
      expectThrow(
        () => renderSketchReview(new FakeDocument(), referenceInspection(lesson.id), {
          pinEvidence: foreignEvidence,
          onInspectTerminal() {},
        }),
        /bài học khác/i,
        "foreign evidence lesson " + foreignLessonId + " into lesson " + lesson.id,
      );
    }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
