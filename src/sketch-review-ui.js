/**
 * Presentation-only renderer for inspectSketchDraft().
 *
 * The renderer owns no editor state. The host app decides when to recompute or
 * replace this section and may opt into a read-only terminal-inspection callback.
 * All dynamic strings are written with textContent; no inspected text is
 * interpreted as markup.
 */

const MAX_WARNING_ROWS = 12;
const MAX_GUIDANCE_ROWS = 8;
const MAX_LEXICAL_ROWS = 24;
const MAX_PIN_EVIDENCE_ROWS = 32;
const MAX_TEXT_CHARS = 900;
const STATUSES = new Set(["reference", "changed"]);
const LEXICAL_STATUSES = new Set(["present", "absent", "fewer-than-reference"]);
const PIN_EVIDENCE_STATUSES = new Set(["lesson-terminal", "not-in-lesson", "unknown"]);
const PIN_EVIDENCE_APIS = new Set([
  "pinMode",
  "digitalRead",
  "digitalWrite",
  "analogRead",
  "analogWrite",
  "tone",
]);
const PIN_LITERAL_KINDS = new Set(["digital-number", "analog-token", "analog-channel-number"]);
const CANONICAL_PIN_ID = /^(?:D(?:[0-9]|1[0-3])|A[0-5])$/;
const PIN_UNSAFE_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const SKETCH_REVIEW_OPTION_FIELDS = new Set(["pinEvidence", "onInspectTerminal"]);
const FALSE_CLAIMS = [
  "compiled",
  "semanticValidated",
  "firmwareExecuted",
  "simulationBehaviorValidated",
  "hardwareValidated",
  "learnerCompletion",
  "learnerMastery",
];
const PIN_FALSE_CLAIMS = [
  "compilesCpp",
  "validatesArduinoSemantics",
  "executesFirmware",
  "provesCallExecuted",
  "validatesPinConnection",
  "validatesCircuit",
  "provesLearnerCompletion",
  "provesLearnerMastery",
];

function requireDocument(doc) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new TypeError("renderSketchReview cần document có createElement().");
  }
}

function boundedInteger(value, max = 10000) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function requireInspection(inspection) {
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
    throw new TypeError("inspection phải là kết quả inspectSketchDraft().");
  }
  if (inspection.schemaVersion !== 1) {
    throw new TypeError("inspection.schemaVersion không được hỗ trợ.");
  }
  if (!Number.isInteger(inspection.lessonId) || inspection.lessonId < 1 || inspection.lessonId > 16) {
    throw new RangeError("inspection.lessonId phải nằm trong 1..16.");
  }
  if (!STATUSES.has(inspection.status)) {
    throw new TypeError("inspection.status không được hỗ trợ.");
  }
  if (!inspection.changes || typeof inspection.changes !== "object" ||
      !inspection.structure || typeof inspection.structure !== "object") {
    throw new TypeError("inspection thiếu changes/structure.");
  }
  for (const key of [
    "referenceLines",
    "draftLines",
    "changedLines",
    "modifiedLines",
    "addedLines",
    "removedLines",
  ]) {
    if (boundedInteger(inspection.changes[key], 1200) === null) {
      throw new TypeError("inspection.changes." + key + " không hợp lệ.");
    }
  }
  if (!Array.isArray(inspection.warnings) || !Array.isArray(inspection.guidance)) {
    throw new TypeError("inspection warnings/guidance phải là mảng.");
  }
  if (!inspection.lexical || inspection.lexical.mode !== "masked-reference-pattern-scan" ||
      inspection.lexical.commentsAndStringsIgnored !== true ||
      !Array.isArray(inspection.lexical.findings)) {
    throw new TypeError("inspection thiếu lexical feedback đã mask comment/string.");
  }
  for (const key of ["expectedFeatureCount", "presentFeatureCount", "differenceCount"]) {
    if (boundedInteger(inspection.lexical[key], 24) === null) {
      throw new TypeError("inspection.lexical." + key + " không hợp lệ.");
    }
  }
  if (inspection.lexical.expectedFeatureCount !== inspection.lexical.findings.length ||
      inspection.lexical.presentFeatureCount + inspection.lexical.differenceCount !==
        inspection.lexical.expectedFeatureCount) {
    throw new TypeError("inspection.lexical counts không nhất quán.");
  }
  let actualDifferenceCount = 0;
  for (const finding of inspection.lexical.findings) {
    if (!finding || typeof finding !== "object" ||
        typeof finding.id !== "string" || !finding.id ||
        typeof finding.label !== "string" || !finding.label ||
        !LEXICAL_STATUSES.has(finding.status) ||
        boundedInteger(finding.referenceCount, 600) === null || finding.referenceCount < 1 ||
        boundedInteger(finding.draftCount, 600) === null ||
        boundedInteger(finding.referenceLine, 600) === null || finding.referenceLine < 1 ||
        (finding.draftLine !== null && boundedInteger(finding.draftLine, 600) === null) ||
        typeof finding.hint !== "string") {
      throw new TypeError("inspection.lexical.findings có item không hợp lệ.");
    }
    const presentShape = finding.status === "present" &&
      finding.draftCount >= finding.referenceCount &&
      Number.isInteger(finding.draftLine) && finding.draftLine >= 1;
    const absentShape = finding.status === "absent" &&
      finding.draftCount === 0 && finding.draftLine === null;
    const fewerShape = finding.status === "fewer-than-reference" &&
      finding.draftCount > 0 && finding.draftCount < finding.referenceCount &&
      Number.isInteger(finding.draftLine) && finding.draftLine >= 1;
    if (!presentShape && !absentShape && !fewerShape) {
      throw new TypeError("inspection.lexical.findings có status/count/line không nhất quán.");
    }
    if (finding.status !== "present") actualDifferenceCount += 1;
  }
  if (actualDifferenceCount !== inspection.lexical.differenceCount ||
      inspection.lexical.presentFeatureCount !==
        inspection.lexical.expectedFeatureCount - actualDifferenceCount) {
    throw new TypeError("inspection.lexical aggregate counts không khớp findings.");
  }
  if (!inspection.claims || FALSE_CLAIMS.some(key => inspection.claims[key] !== false)) {
    throw new TypeError("inspection phải giữ mọi claim biên dịch/thực thi/hoàn thành ở false.");
  }
  if (inspection.provenance?.reference !== "lesson-reference" ||
      inspection.provenance?.draft !== "editor-draft" ||
      inspection.provenance?.lexical !== "masked-reference-pattern-scan") {
    throw new TypeError("inspection thiếu provenance lesson-reference/editor-draft.");
  }
}

function pinCallKey(call) {
  const target = call.lessonTerminalId ?? call.literalPin ?? call.argument;
  return call.api + "\u0000" + call.status + "\u0000" + target;
}

function literalShapeFor(api, argument) {
  const analogToken = /^A([0-5])$/.exec(argument);
  if (analogToken) {
    return { literalKind: "analog-token", literalPin: "A" + analogToken[1] };
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(argument)) return null;
  const number = Number(argument);
  if (!Number.isSafeInteger(number)) return null;
  if (api === "analogRead") {
    return number >= 0 && number <= 5
      ? { literalKind: "analog-channel-number", literalPin: "A" + number }
      : null;
  }
  return number >= 0 && number <= 13
    ? { literalKind: "digital-number", literalPin: "D" + number }
    : null;
}

function requirePinEvidence(pinEvidence, lessonId) {
  if (!pinEvidence || typeof pinEvidence !== "object" || Array.isArray(pinEvidence)) {
    throw new TypeError("pinEvidence phải là kết quả inspectSketchPinEvidence().");
  }
  if (pinEvidence.schemaVersion !== 1 || pinEvidence.mode !== "masked-direct-pin-call-scan") {
    throw new TypeError("pinEvidence schema/mode không được hỗ trợ.");
  }
  if (pinEvidence.lessonId !== lessonId) {
    throw new RangeError("pinEvidence thuộc bài học khác inspection.");
  }
  if (!Array.isArray(pinEvidence.lessonTerminalIds) ||
      !Array.isArray(pinEvidence.calls) ||
      !Array.isArray(pinEvidence.matchedTerminalIds) ||
      !pinEvidence.summary || typeof pinEvidence.summary !== "object") {
    throw new TypeError("pinEvidence thiếu terminal/call/summary arrays.");
  }
  if (pinEvidence.calls.length > 96 || pinEvidence.lessonTerminalIds.length > 32 ||
      pinEvidence.matchedTerminalIds.length > 32) {
    throw new RangeError("pinEvidence vượt giới hạn render an toàn.");
  }

  const lessonTerminalSet = new Set();
  for (const id of pinEvidence.lessonTerminalIds) {
    if (typeof id !== "string" || !CANONICAL_PIN_ID.test(id) || lessonTerminalSet.has(id)) {
      throw new TypeError("pinEvidence.lessonTerminalIds không hợp lệ hoặc bị trùng.");
    }
    lessonTerminalSet.add(id);
  }

  const actualMatched = new Set();
  const duplicateKeys = new Set();
  let duplicateCallCount = 0;
  let lessonTerminalCallCount = 0;
  let notInLessonCallCount = 0;
  let unknownCallCount = 0;

  for (let index = 0; index < pinEvidence.calls.length; index += 1) {
    const call = pinEvidence.calls[index];
    if (!call || typeof call !== "object" || Array.isArray(call) ||
        call.sequence !== index + 1 || !PIN_EVIDENCE_APIS.has(call.api) ||
        !PIN_EVIDENCE_STATUSES.has(call.status) ||
        !Number.isInteger(call.line) || call.line < 1 || call.line > 600 ||
        !Number.isInteger(call.column) || call.column < 1 || call.column > 2001 ||
        typeof call.argument !== "string" || call.argument.length > 160 || PIN_UNSAFE_TEXT.test(call.argument) ||
        (call.literalKind !== null && !PIN_LITERAL_KINDS.has(call.literalKind)) ||
        (call.literalPin !== null &&
          (typeof call.literalPin !== "string" || !CANONICAL_PIN_ID.test(call.literalPin))) ||
        (call.lessonTerminalId !== null &&
          (typeof call.lessonTerminalId !== "string" || !CANONICAL_PIN_ID.test(call.lessonTerminalId))) ||
        (call.reason !== null && (typeof call.reason !== "string" || call.reason.length > 120))) {
      throw new TypeError("pinEvidence.calls có item không hợp lệ.");
    }

    if (call.status === "lesson-terminal") {
      const expectedLiteral = literalShapeFor(call.api, call.argument);
      if (!expectedLiteral || expectedLiteral.literalKind !== call.literalKind ||
          expectedLiteral.literalPin !== call.literalPin ||
          !call.literalPin || call.lessonTerminalId !== call.literalPin ||
          !lessonTerminalSet.has(call.lessonTerminalId) || call.reason !== null) {
        throw new TypeError("pinEvidence lesson-terminal shape không hợp lệ.");
      }
      lessonTerminalCallCount += 1;
      actualMatched.add(call.lessonTerminalId);
    } else if (call.status === "not-in-lesson") {
      const expectedLiteral = literalShapeFor(call.api, call.argument);
      if (!expectedLiteral || expectedLiteral.literalKind !== call.literalKind ||
          expectedLiteral.literalPin !== call.literalPin ||
          !call.literalPin || call.lessonTerminalId !== null || lessonTerminalSet.has(call.literalPin) ||
          typeof call.reason !== "string" || !call.reason) {
        throw new TypeError("pinEvidence not-in-lesson shape không hợp lệ.");
      }
      notInLessonCallCount += 1;
    } else {
      if (call.literalKind !== null || call.literalPin !== null || call.lessonTerminalId !== null ||
          typeof call.reason !== "string" || !call.reason) {
        throw new TypeError("pinEvidence unknown shape không hợp lệ.");
      }
      unknownCallCount += 1;
    }

    const key = pinCallKey(call);
    if (duplicateKeys.has(key)) duplicateCallCount += 1;
    else duplicateKeys.add(key);
  }

  const summary = pinEvidence.summary;
  const actualCounts = {
    callCount: pinEvidence.calls.length,
    lessonTerminalCallCount,
    notInLessonCallCount,
    unknownCallCount,
    uniqueLessonTerminalCount: actualMatched.size,
    duplicateCallCount,
  };
  for (const [key, expected] of Object.entries(actualCounts)) {
    if (summary[key] !== expected) {
      throw new TypeError("pinEvidence.summary." + key + " không nhất quán.");
    }
  }

  const matchedSet = new Set();
  for (const id of pinEvidence.matchedTerminalIds) {
    if (typeof id !== "string" || !CANONICAL_PIN_ID.test(id) ||
        matchedSet.has(id) || !lessonTerminalSet.has(id)) {
      throw new TypeError("pinEvidence.matchedTerminalIds không hợp lệ.");
    }
    matchedSet.add(id);
  }
  if (matchedSet.size !== actualMatched.size ||
      [...actualMatched].some(id => !matchedSet.has(id))) {
    throw new TypeError("pinEvidence.matchedTerminalIds không khớp calls.");
  }

  if (!pinEvidence.boundaries || pinEvidence.boundaries.lexicalOnly !== true ||
      pinEvidence.boundaries.commentsAndStringsIgnored !== true ||
      pinEvidence.boundaries.directPinTokensOnly !== true ||
      PIN_FALSE_CLAIMS.some(key => pinEvidence.boundaries[key] !== false)) {
    throw new TypeError("pinEvidence phải giữ boundary lexical/non-execution ở trạng thái an toàn.");
  }
  if (!pinEvidence.claims || PIN_FALSE_CLAIMS.some(key => pinEvidence.claims[key] !== false)) {
    throw new TypeError("pinEvidence phải giữ mọi claim biên dịch/thực thi/kết nối ở false.");
  }
  if (pinEvidence.provenance?.source !== "learner-editor-draft" ||
      pinEvidence.provenance?.terminalIds !== "circuit-router:listTerminals" ||
      pinEvidence.provenance?.scan !== "masked-direct-pin-call-scan") {
    throw new TypeError("pinEvidence thiếu provenance editor/circuit-router/lexical scan.");
  }
}

function normalizeOptions(options, lessonId) {
  if (options === undefined || options === null) {
    return Object.freeze({ pinEvidence: null, onInspectTerminal: null });
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("renderSketchReview options phải là object nếu được truyền.");
  }
  const unknown = Reflect.ownKeys(options).filter(key =>
    typeof key !== "string" || !SKETCH_REVIEW_OPTION_FIELDS.has(key));
  if (unknown.length) {
    throw new TypeError("renderSketchReview options có prop không được hỗ trợ: " + String(unknown[0]));
  }
  const onInspectTerminal = Object.hasOwn(options, "onInspectTerminal")
    ? options.onInspectTerminal
    : null;
  if (onInspectTerminal !== undefined && onInspectTerminal !== null &&
      typeof onInspectTerminal !== "function") {
    throw new TypeError("onInspectTerminal phải là function khi được cung cấp.");
  }
  const pinEvidence = Object.hasOwn(options, "pinEvidence") ? options.pinEvidence : null;
  if (pinEvidence !== undefined && pinEvidence !== null) requirePinEvidence(pinEvidence, lessonId);
  return Object.freeze({
    pinEvidence: pinEvidence ?? null,
    onInspectTerminal: onInspectTerminal ?? null,
  });
}

function make(doc, tag, className = "", text = undefined) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function safeText(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const text = value.trim();
  return text.length <= MAX_TEXT_CHARS ? text : text.slice(0, MAX_TEXT_CHARS) + "…";
}

function bool(value) {
  return value === true;
}

function appendGuidance(doc, section, inspection) {
  const block = make(doc, "div", "sketch-review-guidance");
  block.setAttribute("data-sketch-review-guidance", "");
  block.append(make(doc, "h6", "sketch-review-subheading", "Gợi ý đối chiếu"));
  const rows = inspection.guidance.slice(0, MAX_GUIDANCE_ROWS);
  const list = make(doc, "ul", "sketch-review-list");
  for (const item of rows) {
    list.append(make(doc, "li", "", safeText(item, "Xem lại thay đổi so với mã tham khảo.")));
  }
  if (!rows.length) {
    list.append(make(doc, "li", "", "Xem lại thay đổi so với mã tham khảo trước khi dùng mã ở công cụ khác."));
  }
  block.append(list);
  section.append(block);
}

function appendWarnings(doc, section, inspection) {
  const block = make(doc, "div", "sketch-review-warnings");
  block.setAttribute("data-sketch-review-warnings", "");
  block.append(make(doc, "h6", "sketch-review-subheading", "Cảnh báo heuristic"));
  const rows = inspection.warnings.slice(0, MAX_WARNING_ROWS);
  if (!rows.length) {
    block.append(make(
      doc,
      "p",
      "sketch-review-no-warning",
      "Không thấy cảnh báo setup()/loop()/ngoặc nhọn trong phép quét văn bản hiện tại; lexical scan cũng chưa thấy ngoặc tròn/vuông lệch.",
    ));
    section.append(block);
    return;
  }

  const list = make(doc, "ul", "sketch-review-list");
  for (const item of rows) {
    const code = safeText(item?.code, "SOURCE_WARNING");
    const line = boundedInteger(item?.line, 600);
    const message = safeText(item?.message, "Có cấu trúc nguồn cần xem lại.");
    const prefix = line === null ? "" : "Dòng " + line + " · ";
    const row = make(doc, "li", "", prefix + message);
    row.setAttribute("data-sketch-review-warning", code);
    list.append(row);
  }
  block.append(list);
  if (inspection.warnings.length > rows.length) {
    block.append(make(
      doc,
      "p",
      "sketch-review-truncated",
      "Còn " + (inspection.warnings.length - rows.length) + " cảnh báo khác không hiển thị.",
    ));
  }
  section.append(block);
}

function appendLexical(doc, section, inspection) {
  const lexical = inspection.lexical;
  const block = make(doc, "div", "sketch-review-lexical");
  block.setAttribute("data-sketch-review-lexical", "");
  block.append(make(doc, "h6", "sketch-review-subheading", "Dấu hiệu nguồn so với mã tham khảo"));

  const summary = make(
    doc,
    "p",
    "sketch-review-lexical-status",
    lexical.differenceCount === 0
      ? "Quét lexical sau khi bỏ qua comment/string: " + lexical.expectedFeatureCount +
        "/" + lexical.expectedFeatureCount + " loại dấu hiệu tham khảo vẫn xuất hiện trong source."
      : "Quét lexical sau khi bỏ qua comment/string: " + lexical.differenceCount +
        " loại dấu hiệu tham khảo đang thiếu hoặc xuất hiện ít hơn trong source.",
  );
  summary.setAttribute("data-sketch-review-lexical-summary", "");
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  summary.setAttribute("aria-atomic", "true");
  block.append(summary);

  const differences = lexical.findings
    .filter(item => item.status !== "present")
    .slice(0, MAX_LEXICAL_ROWS);
  if (differences.length) {
    const list = make(doc, "ul", "sketch-review-list");
    for (const finding of differences) {
      const draftWhere = finding.draftLine === null
        ? "bản nháp chưa thấy ngoài comment/string"
        : "bản nháp thấy từ dòng " + finding.draftLine + " (" +
          finding.draftCount + "/" + finding.referenceCount + " lần so với mẫu)";
      const row = make(
        doc,
        "li",
        "",
        "Mẫu dòng " + finding.referenceLine + " · " + safeText(finding.label, "pattern") +
          " · " + draftWhere + ". " +
          safeText(finding.hint, "Đối chiếu lại với mã tham khảo nếu thay đổi này không có chủ ý."),
      );
      row.setAttribute("data-sketch-review-lexical-finding", safeText(finding.id, "pattern"));
      row.setAttribute("data-sketch-review-lexical-status", finding.status);
      list.append(row);
    }
    block.append(list);
  } else {
    block.append(make(
      doc,
      "p",
      "sketch-review-lexical-note",
      "Không có khác biệt lexical ở nhóm pattern tham khảo đang theo dõi. Kết quả này không phải kiểm tra cú pháp hay ngữ nghĩa C++.",
    ));
  }
  section.append(block);
}

function appendPinEvidence(doc, section, pinEvidence, lessonId, onInspectTerminal) {
  const block = make(doc, "section", "sketch-review-lexical sketch-pin-evidence");
  block.setAttribute("data-sketch-pin-evidence", "");
  block.setAttribute("data-sketch-pin-evidence-call-count", String(pinEvidence.summary.callCount));
  block.setAttribute(
    "data-sketch-pin-evidence-terminal-count",
    String(pinEvidence.summary.uniqueLessonTerminalCount),
  );
  block.setAttribute("aria-label", "Bằng chứng lexical về chân Arduino trong Sketch");
  block.append(make(
    doc,
    "h6",
    "sketch-review-subheading",
    "Bằng chứng chân từ source (lexical)",
  ));

  const summary = make(
    doc,
    "p",
    "sketch-review-lexical-status sketch-pin-evidence-summary",
    pinEvidence.summary.callCount === 0
      ? "Chưa thấy lời gọi trực tiếp tới 6 API chân đang theo dõi sau khi bỏ qua comment/string."
      : "Quét lexical thấy " + pinEvidence.summary.callCount + " lời gọi dạng pin: " +
        pinEvidence.summary.lessonTerminalCallCount + " lần khớp terminal của bài, " +
        pinEvidence.summary.notInLessonCallCount + " literal không thuộc terminal bài và " +
        pinEvidence.summary.unknownCallCount + " đối số chưa giải được.",
  );
  summary.setAttribute("data-sketch-pin-evidence-summary", "");
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  summary.setAttribute("aria-atomic", "true");
  block.append(summary);

  const rows = pinEvidence.calls.slice(0, MAX_PIN_EVIDENCE_ROWS);
  if (rows.length) {
    const list = make(doc, "ul", "sketch-review-list sketch-pin-evidence-list");
    for (const call of rows) {
      const argument = safeText(call.argument, "(trống)");
      let detail = "Dòng " + call.line + " · " + call.api + " · đối số chân “" + argument + "”";
      if (call.status === "lesson-terminal") {
        detail += " → terminal " + call.lessonTerminalId + " có trong circuit-router của bài.";
      } else if (call.status === "not-in-lesson") {
        detail += " → nhận diện literal " + call.literalPin +
          ", nhưng circuit-router của bài không có terminal này.";
      } else {
        detail += " · chưa giải lexical thành terminal bài; alias/macro/biểu thức/hàm không được suy đoán.";
      }
      const row = make(doc, "li", "", detail);
      row.setAttribute("data-sketch-pin-evidence-call", String(call.sequence));
      row.setAttribute("data-sketch-pin-evidence-api", call.api);
      row.setAttribute("data-sketch-pin-evidence-status", call.status);
      if (call.lessonTerminalId) {
        row.setAttribute("data-sketch-pin-evidence-terminal", call.lessonTerminalId);
      }
      if (call.status === "lesson-terminal" && typeof onInspectTerminal === "function") {
        const terminalId = call.lessonTerminalId;
        const button = make(
          doc,
          "button",
          "sketch-pin-evidence-inspect-button",
          "Xem " + terminalId + " trong Inspector",
        );
        button.type = "button";
        button.style.minWidth = "44px";
        button.style.minHeight = "44px";
        button.setAttribute("data-sketch-pin-inspect-terminal", terminalId);
        button.setAttribute("data-sketch-pin-inspect-lesson", String(lessonId));
        button.setAttribute("data-sketch-pin-inspect-call", String(call.sequence));
        button.setAttribute(
          "aria-label",
          "Xem terminal " + terminalId + " của bài " + lessonId +
            " trong Inspector; chỉ điều hướng đọc, không tạo dây hoặc chạy mã",
        );
        button.addEventListener("click", () => onInspectTerminal(terminalId, lessonId));
        row.append(button);
      }
      list.append(row);
    }
    block.append(list);
  }
  if (pinEvidence.calls.length > rows.length) {
    block.append(make(
      doc,
      "p",
      "sketch-review-truncated",
      "Còn " + (pinEvidence.calls.length - rows.length) +
        " lời gọi lexical khác không hiển thị trong khối này.",
    ));
  }

  const boundary = make(
    doc,
    "p",
    "sketch-review-boundary sketch-pin-evidence-boundary",
    "Đây chỉ là bằng chứng lexical tĩnh từ source editor sau khi bỏ qua comment/string. " +
      "Terminal chỉ được gắn khi ID đó có trong circuit-router của đúng bài. " +
      "Nút xem terminal, nếu host bật, chỉ gọi hook điều hướng Inspector đọc. " +
      "Kết quả không biên dịch Arduino C++, không chạy firmware, không chứng minh lời gọi đã thực thi, " +
      "không tự tạo dây, không xác nhận chân đã được nối dây hoặc kết nối điện đúng và không đánh giá hoàn thành bài.",
  );
  boundary.setAttribute("data-sketch-pin-evidence-boundary", "");
  boundary.setAttribute("role", "note");
  block.append(boundary);
  section.append(block);
}

/**
 * Render one immutable view of a sketch inspection. The host can replace the
 * returned section whenever the editor draft or lesson changes.
 */
export function renderSketchReview(doc, inspection, options = undefined) {
  requireDocument(doc);
  requireInspection(inspection);
  const normalizedOptions = normalizeOptions(options, inspection.lessonId);
  const pinEvidence = normalizedOptions.pinEvidence;

  const changes = inspection.changes;
  const structure = inspection.structure;
  const warningCount = Math.min(inspection.warnings.length, 999);
  const lexicalDifferenceCount = inspection.lexical.differenceCount;
  const tone = warningCount > 0 || lexicalDifferenceCount > 0 ? "warning" : inspection.status;
  const section = make(doc, "section", "sketch-review");
  section.setAttribute("data-sketch-review", "");
  section.setAttribute("data-sketch-review-status", inspection.status);
  section.setAttribute("data-sketch-review-tone", tone);
  section.setAttribute("data-sketch-review-lesson", String(inspection.lessonId));
  section.setAttribute("data-sketch-review-warning-count", String(warningCount));
  section.setAttribute("data-sketch-review-lexical-difference-count", String(lexicalDifferenceCount));
  section.setAttribute("data-sketch-review-changed-lines", String(changes.changedLines));
  if (pinEvidence) {
    section.setAttribute("data-sketch-review-pin-evidence", "true");
  }
  section.setAttribute("aria-label", "Đối chiếu Sketch bài " + inspection.lessonId);

  section.append(make(doc, "h5", "sketch-review-heading", "Đối chiếu bản nháp Sketch"));

  const status = make(
    doc,
    "p",
    "sketch-review-status",
    inspection.status === "reference"
      ? "Bản nháp đang trùng mã tham khảo của bài."
      : "Bản nháp đang khác mã tham khảo của bài.",
  );
  status.setAttribute("data-sketch-review-status-label", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  section.append(status);

  const counts = make(
    doc,
    "p",
    "sketch-review-counts",
    "Dòng: " + changes.referenceLines + " mẫu → " + changes.draftLines +
      " bản nháp · sửa " + changes.modifiedLines +
      " · thêm " + changes.addedLines +
      " · xóa " + changes.removedLines + ".",
  );
  counts.setAttribute("data-sketch-review-counts", "");
  section.append(counts);

  const structureText = [
    "setup(): " + (bool(structure.setupPresent) ? "có" : "chưa nhận ra"),
    "loop(): " + (bool(structure.loopPresent) ? "có" : "chưa nhận ra"),
    "ngoặc nhọn: " + (bool(structure.bracesBalanced) ? "cân bằng theo heuristic" : "cần xem lại"),
    "ngoặc tròn/vuông: " +
      (bool(structure.parenthesesBalanced) && bool(structure.bracketsBalanced)
        ? "cân bằng theo lexical scan"
        : "cần xem lại"),
  ].join(" · ");
  const structureNode = make(doc, "p", "sketch-review-structure", structureText + ".");
  structureNode.setAttribute("data-sketch-review-structure", "");
  section.append(structureNode);

  appendLexical(doc, section, inspection);
  if (pinEvidence) {
    appendPinEvidence(
      doc,
      section,
      pinEvidence,
      inspection.lessonId,
      normalizedOptions.onInspectTerminal,
    );
  }
  appendGuidance(doc, section, inspection);
  appendWarnings(doc, section, inspection);

  const boundary = make(
    doc,
    "p",
    "sketch-review-boundary",
    "Review này chỉ so sánh văn bản giữa mã tham khảo của bài và bản nháp trong editor. " +
      "Quét pattern bỏ qua comment/string nhưng vẫn chỉ là heuristic lexical. " +
      "Nó không biên dịch Arduino C++, không kiểm tra ngữ nghĩa C++, không chạy firmware, " +
      "không xác nhận thay đổi mã đã ảnh hưởng mô phỏng và không đánh giá mức độ hoàn thành hay hiểu bài.",
  );
  boundary.setAttribute("data-sketch-review-boundary", "");
  boundary.setAttribute("role", "note");
  section.append(boundary);

  return section;
}
