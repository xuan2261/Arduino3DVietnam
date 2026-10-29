/**
 * Presentation-only renderer for inspectSketchDraft().
 *
 * The renderer owns no editor state and exposes no action callbacks. The host app
 * decides when to recompute/replace this section. All dynamic strings are written
 * with textContent; no inspected text is interpreted as markup.
 */

const MAX_WARNING_ROWS = 12;
const MAX_GUIDANCE_ROWS = 8;
const MAX_LEXICAL_ROWS = 24;
const MAX_TEXT_CHARS = 900;
const STATUSES = new Set(["reference", "changed"]);
const LEXICAL_STATUSES = new Set(["present", "absent", "fewer-than-reference"]);
const FALSE_CLAIMS = [
  "compiled",
  "semanticValidated",
  "firmwareExecuted",
  "simulationBehaviorValidated",
  "hardwareValidated",
  "learnerCompletion",
  "learnerMastery",
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

/**
 * Render one immutable view of a sketch inspection. The host can replace the
 * returned section whenever the editor draft or lesson changes.
 */
export function renderSketchReview(doc, inspection) {
  requireDocument(doc);
  requireInspection(inspection);

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
