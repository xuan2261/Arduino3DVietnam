/**
 * Presentation-only renderer for inspectSketchDraft().
 *
 * The renderer owns no editor state and exposes no action callbacks. The host app
 * decides when to recompute/replace this section. All dynamic strings are written
 * with textContent; no inspected text is interpreted as markup.
 */

const MAX_WARNING_ROWS = 12;
const MAX_GUIDANCE_ROWS = 8;
const MAX_TEXT_CHARS = 900;
const STATUSES = new Set(["reference", "changed"]);
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
  if (!inspection.claims || FALSE_CLAIMS.some(key => inspection.claims[key] !== false)) {
    throw new TypeError("inspection phải giữ mọi claim biên dịch/thực thi/hoàn thành ở false.");
  }
  if (inspection.provenance?.reference !== "lesson-reference" ||
      inspection.provenance?.draft !== "editor-draft") {
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
      "Không thấy cảnh báo setup()/loop()/ngoặc nhọn trong phép quét văn bản hiện tại.",
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
  const tone = warningCount > 0 ? "warning" : inspection.status;
  const section = make(doc, "section", "sketch-review");
  section.setAttribute("data-sketch-review", "");
  section.setAttribute("data-sketch-review-status", inspection.status);
  section.setAttribute("data-sketch-review-tone", tone);
  section.setAttribute("data-sketch-review-lesson", String(inspection.lessonId));
  section.setAttribute("data-sketch-review-warning-count", String(warningCount));
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
  ].join(" · ");
  const structureNode = make(doc, "p", "sketch-review-structure", structureText + ".");
  structureNode.setAttribute("data-sketch-review-structure", "");
  section.append(structureNode);

  appendGuidance(doc, section, inspection);
  appendWarnings(doc, section, inspection);

  const boundary = make(
    doc,
    "p",
    "sketch-review-boundary",
    "Review này chỉ so sánh văn bản giữa mã tham khảo của bài và bản nháp trong editor. " +
      "Nó không biên dịch Arduino C++, không kiểm tra ngữ nghĩa C++, không chạy firmware, " +
      "không xác nhận thay đổi mã đã ảnh hưởng mô phỏng và không đánh giá mức độ hoàn thành hay hiểu bài.",
  );
  boundary.setAttribute("data-sketch-review-boundary", "");
  boundary.setAttribute("role", "note");
  section.append(boundary);

  return section;
}
