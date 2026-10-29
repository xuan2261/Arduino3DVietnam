/**
 * Accessible, presentation-only UI for per-step practice evidence.
 *
 * The renderer only describes model output. It never mutates a circuit, advances
 * a lesson, executes firmware, or upgrades a topology/reference match into a
 * physical-wiring or learner-mastery claim.
 */

const STATUS_PRESENTATION = Object.freeze({
  "manual-checkpoint": Object.freeze({
    label: "Checkpoint thủ công",
    tone: "manual",
    detail: "Bước này dùng quan sát, mô phỏng hoặc tự đối chiếu; topology dây không được dùng để chấm tự động cho bước hiện tại.",
  }),
  "not-attempted": Object.freeze({
    label: "Chưa có bản tự đấu",
    tone: "neutral",
    detail: "Ứng dụng chưa ghi nhận bản tự đấu trong phiên này để so sánh với checkpoint wiring đã biên tập; không suy ra học viên đã hay chưa thao tác ở nơi khác.",
  }),
  "needs-correction": Object.freeze({
    label: "Cần sửa topology",
    tone: "warning",
    detail: "Bản tự đấu có cạnh khác mẫu hoặc issue topology cần xem lại khi so với mạch mẫu tham chiếu.",
  }),
  "incomplete": Object.freeze({
    label: "Chưa khớp hết checkpoint wiring",
    tone: "neutral",
    detail: "Đã có bản tự đấu, nhưng checkpoint wiring đã biên tập vẫn có cạnh chưa xuất hiện trong topology hiện tại.",
  }),
  "step-sample-match": Object.freeze({
    label: "Khớp checkpoint wiring của bước",
    tone: "match",
    detail: "Các cạnh reference được biên tập cho bước hiện tại đang khớp trong topology của bản tự đấu.",
  }),
  "signal-step-match": Object.freeze({
    label: "Khớp checkpoint tín hiệu của bước",
    tone: "signal",
    detail: "Các cạnh tín hiệu/GND được biên tập cho bước hiện tại đang khớp; nguồn, tải và chức năng thiết bị vẫn ngoài phạm vi bằng chứng này.",
  }),
  "topology-match": Object.freeze({
    label: "Khớp sample topology tham chiếu",
    tone: "match",
    detail: "Bản tự đấu khớp sample topology tham chiếu mà model đang đối chiếu.",
  }),
  "signal-topology-match": Object.freeze({
    label: "Khớp topology tín hiệu/GND",
    tone: "signal",
    detail: "Các cạnh tín hiệu/GND thuộc checkpoint khớp mẫu; nguồn, tải và chức năng thiết bị vẫn ngoài phạm vi bằng chứng này.",
  }),
});

const MAX_PAIR_ROWS = 24;
const MAX_ISSUE_ROWS = 12;

function requireDocument(doc) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new TypeError("renderPracticeEvidence cần document có createElement().");
  }
}

function requireEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("practice evidence phải là object.");
  }
}

function requireCallback(callback, name) {
  if (callback !== undefined && callback !== null && typeof callback !== "function") {
    throw new TypeError(name + " phải là function khi được cung cấp.");
  }
}

function make(doc, tag, className = "", text = undefined) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
}

function endpoint(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    return safeText(value.id, safeText(value.label, "?"));
  }
  return "?";
}

function pairText(pair) {
  if (Array.isArray(pair) && pair.length >= 2) {
    return endpoint(pair[0]) + " ↔ " + endpoint(pair[1]);
  }
  if (pair && typeof pair === "object") {
    const terminals = Array.isArray(pair.terminals) ? pair.terminals : null;
    if (terminals && terminals.length >= 2) {
      return endpoint(terminals[0]) + " ↔ " + endpoint(terminals[1]);
    }
    const from = pair.from ?? pair.a ?? pair.left;
    const to = pair.to ?? pair.b ?? pair.right;
    if (from !== undefined && to !== undefined) {
      return endpoint(from) + " ↔ " + endpoint(to);
    }
    return safeText(pair.label, safeText(pair.id, "Cạnh chưa có nhãn"));
  }
  return endpoint(pair);
}

function issueText(issue) {
  if (typeof issue === "string") return issue.trim() || "Issue topology chưa có mô tả.";
  if (!issue || typeof issue !== "object") return "Issue topology chưa có mô tả.";
  const message = safeText(issue.message, safeText(issue.summary, ""));
  const code = safeText(issue.code, "");
  if (message && code && !message.includes(code)) return message + " (" + code + ")";
  return message || code || "Issue topology chưa có mô tả.";
}

function boundedArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function appendPairBlock(doc, section, {
  attribute,
  className,
  title,
  emptyText,
  pairs,
  originalCount,
}) {
  const block = make(doc, "div", className);
  block.setAttribute(attribute, "");
  block.append(make(doc, "h6", "practice-evidence-subheading", title));
  if (!pairs.length) {
    block.append(make(doc, "p", "practice-evidence-empty", emptyText));
  } else {
    const list = make(doc, "ul", "practice-evidence-list");
    for (const pair of pairs) list.append(make(doc, "li", "", pairText(pair)));
    block.append(list);
    if (originalCount > pairs.length) {
      block.append(make(
        doc,
        "p",
        "practice-evidence-truncated",
        "Còn " + (originalCount - pairs.length) + " cạnh khác trong kết quả model.",
      ));
    }
  }
  section.append(block);
}

/**
 * Render one immutable view of the current per-step evidence.
 * Callbacks are navigation/re-read hooks owned by the app; this module does not
 * know or mutate canonical learner state.
 */
export function renderPracticeEvidence(doc, evidence, {
  onOpenWiring,
  onOpen3D,
  onRecheck,
} = {}) {
  requireDocument(doc);
  requireEvidence(evidence);
  requireCallback(onOpenWiring, "onOpenWiring");
  requireCallback(onOpen3D, "onOpen3D");
  requireCallback(onRecheck, "onRecheck");

  const lessonId = Number.isInteger(evidence.lessonId) && evidence.lessonId >= 1 && evidence.lessonId <= 16
    ? evidence.lessonId
    : null;
  const stepIndex = Number.isInteger(evidence.stepIndex) && evidence.stepIndex >= 0
    ? evidence.stepIndex
    : 0;
  const scope = safeText(evidence.scope, "unknown");
  const status = safeText(evidence.status, "unknown");
  const presentation = STATUS_PRESENTATION[status] ?? Object.freeze({
    label: "Trạng thái chưa được nhận diện",
    tone: "neutral",
    detail: "UI chưa có diễn giải cho trạng thái evidence này; hãy dùng tóm tắt và hành động tiếp theo từ model để kiểm tra lại.",
  });
  const missingPairs = boundedArray(evidence.missingPairs, MAX_PAIR_ROWS);
  const extraPairs = boundedArray(evidence.extraPairs, MAX_PAIR_ROWS);
  const issues = boundedArray(evidence.issues, MAX_ISSUE_ROWS);
  const matched = safeCount(evidence.matched);
  const required = safeCount(evidence.required);
  const isManual = lessonId === 1 || scope === "manual" || status === "manual-checkpoint";
  const isSignalOnly = status === "signal-step-match" || status === "signal-topology-match" ||
    scope === "signal-only" || evidence?.claims?.signalOnly === true;
  const checkpoint = evidence.checkpoint && typeof evidence.checkpoint === "object" && !Array.isArray(evidence.checkpoint)
    ? evidence.checkpoint
    : null;
  const checkpointKind = checkpoint?.kind === "wiring" || checkpoint?.kind === "manual"
    ? checkpoint.kind
    : (isManual ? "manual" : "unknown");
  const provenanceScheme = safeText(checkpoint?.provenance?.scheme, "unknown");
  const hasExternalWiring = lessonId !== 1;

  const section = make(doc, "section", "practice-evidence");
  section.setAttribute("data-practice-evidence", "");
  section.setAttribute("data-practice-tone", presentation.tone);
  section.setAttribute("data-practice-scope", scope);
  section.setAttribute("data-practice-status", status);
  section.setAttribute("data-practice-checkpoint-kind", checkpointKind);
  section.setAttribute("data-practice-provenance", provenanceScheme);
  if (checkpoint?.id) section.setAttribute("data-practice-checkpoint-id", String(checkpoint.id));
  if (lessonId !== null) section.setAttribute("data-practice-lesson", String(lessonId));
  section.setAttribute("data-practice-step", String(stepIndex));
  if (matched !== null) section.setAttribute("data-practice-matched", String(matched));
  if (required !== null) section.setAttribute("data-practice-required", String(required));
  section.setAttribute("aria-label", "Bằng chứng thực hành cho bước " + (stepIndex + 1));

  section.append(make(doc, "h5", "practice-evidence-heading", "Bằng chứng thực hành bước này"));

  const statusNode = make(doc, "p", "practice-evidence-status", presentation.label);
  statusNode.setAttribute("data-practice-status-label", "");
  statusNode.setAttribute("role", "status");
  statusNode.setAttribute("aria-live", "polite");
  section.append(statusNode, make(doc, "p", "practice-evidence-detail", presentation.detail));

  if (isManual && lessonId === 1) {
    section.append(make(
      doc,
      "p",
      "practice-evidence-manual",
      "Bài 01 dùng LED L tích hợp và không yêu cầu dây ngoài. Checkpoint này chỉ hướng dẫn tự kiểm tra theo nội dung bài.",
    ));
  } else if (isManual) {
    section.append(make(
      doc,
      "p",
      "practice-evidence-manual",
      "Bước này được biên tập là checkpoint quan sát/mô phỏng; topology dây không được dùng làm điều kiện để chấm bước này.",
    ));
  } else if (matched !== null && required !== null) {
    section.append(make(
      doc,
      "p",
      "practice-evidence-count",
      "So sánh với checkpoint wiring đã biên tập: " + matched + "/" + required + " cạnh.",
    ));
  } else {
    section.append(make(
      doc,
      "p",
      "practice-evidence-count",
      "Model chưa cung cấp đủ số đếm cho checkpoint wiring đã biên tập.",
    ));
  }

  section.append(
    make(
      doc,
      "p",
      "practice-evidence-summary",
      "Tóm tắt: " + safeText(evidence.summary, "Chưa có tóm tắt evidence cho bước này."),
    ),
  );

  const guidance = safeText(evidence.guidance, safeText(checkpoint?.guidance, ""));
  if (guidance) {
    const guidanceNode = make(doc, "p", "practice-evidence-guidance", "Gợi ý thực hành: " + guidance);
    guidanceNode.setAttribute("data-practice-guidance", "");
    section.append(guidanceNode);
  }

  if (isSignalOnly) {
    const signalNote = make(
      doc,
      "p",
      "practice-evidence-signal-note",
      lessonId === 10 || lessonId === 14
        ? "Bài " + String(lessonId).padStart(2, "0") + " chỉ đối chiếu topology tín hiệu/GND trong phạm vi model; nguồn công suất, tải và chức năng thiết bị không được xác nhận."
        : "Evidence này chỉ đối chiếu topology tín hiệu/GND; nguồn, tải và chức năng thiết bị không được xác nhận.",
    );
    signalNote.setAttribute("role", "note");
    section.append(signalNote);
  }

  if (checkpoint) {
    const provenanceNote = make(
      doc,
      "p",
      "practice-evidence-group-note",
      checkpointKind === "wiring"
        ? "Checkpoint wiring này được biên tập thủ công từ nội dung bước học và chỉ dùng các cạnh có trong circuit-router sample. Đây không phải xác nhận của giáo viên, không phải yêu cầu bắt buộc để chuyển bước, không chứng minh người học đã thực hiện thao tác hay hiểu bài."
        : "Checkpoint manual này được biên tập thủ công từ nội dung bước học. Nó không phải xác nhận của giáo viên, không phải điều kiện để chuyển bước và không chứng minh người học đã thực hiện thao tác hay hiểu bài.",
    );
    provenanceNote.setAttribute("data-practice-provenance-note", "");
    if (checkpointKind === "wiring") provenanceNote.setAttribute("data-practice-grouping-note", "");
    provenanceNote.setAttribute("role", "note");
    section.append(provenanceNote);
  } else if (!isManual) {
    const provenanceNote = make(
      doc,
      "p",
      "practice-evidence-group-note",
      "Evidence chưa có metadata checkpoint biên tập; chỉ được xem như so sánh reference sample, không phải xác nhận của giáo viên, không phải điều kiện chuyển bước và không chứng minh thao tác hay mastery.",
    );
    provenanceNote.setAttribute("data-practice-provenance-note", "");
    provenanceNote.setAttribute("data-practice-grouping-note", "");
    provenanceNote.setAttribute("role", "note");
    section.append(provenanceNote);
  }

  appendPairBlock(doc, section, {
    attribute: "data-practice-missing",
    className: "practice-evidence-pairs practice-evidence-missing",
    title: "Cạnh checkpoint chưa thấy",
    emptyText: isManual ? "Không áp dụng đối chiếu dây cho checkpoint manual này." : "Không có cạnh chưa khớp trong checkpoint wiring hiện tại.",
    pairs: missingPairs,
    originalCount: Array.isArray(evidence.missingPairs) ? evidence.missingPairs.length : 0,
  });

  appendPairBlock(doc, section, {
    attribute: "data-practice-extra",
    className: "practice-evidence-pairs practice-evidence-extra",
    title: "Cạnh ngoài mẫu cần xem lại",
    emptyText: "Không có cạnh ngoài mẫu được model báo tại checkpoint này.",
    pairs: extraPairs,
    originalCount: Array.isArray(evidence.extraPairs) ? evidence.extraPairs.length : 0,
  });

  if (issues.length) {
    const issueBlock = make(doc, "div", "practice-evidence-issues");
    issueBlock.setAttribute("data-practice-issues", "");
    issueBlock.append(make(doc, "h6", "practice-evidence-subheading", "Điểm cần chú ý"));
    const list = make(doc, "ul", "practice-evidence-list");
    for (const issue of issues) list.append(make(doc, "li", "", issueText(issue)));
    issueBlock.append(list);
    if (Array.isArray(evidence.issues) && evidence.issues.length > issues.length) {
      issueBlock.append(make(
        doc,
        "p",
        "practice-evidence-truncated",
        "Còn " + (evidence.issues.length - issues.length) + " issue khác trong kết quả model.",
      ));
    }
    section.append(issueBlock);
  }

  section.append(make(
    doc,
    "p",
    "practice-evidence-next",
    "Tiếp theo: " + safeText(evidence.nextAction, "Đối chiếu lại bước hiện tại với hướng dẫn của bài."),
  ));

  const boundary = make(
    doc,
    "p",
    "practice-evidence-boundary",
    isManual
      ? "Checkpoint thủ công này không đo phần cứng, không chạy firmware và không tự xác nhận mức độ hiểu hay hoàn thành bài học."
      : "Kết quả chỉ so sánh topology/cạnh mẫu trong mô hình tham chiếu của bước. Nó không đo vị trí cắm thực, dòng/điện áp, không chạy firmware, không xác nhận phần cứng và không tự xác nhận mức độ hiểu hay hoàn thành bài học.",
  );
  boundary.setAttribute("role", "note");
  section.append(boundary);

  const actions = make(doc, "div", "practice-evidence-actions");
  const openWiring = make(doc, "button", "practice-evidence-button", lessonId === 1
    ? "Bài 01 không có dây ngoài"
    : "Mở sơ đồ nối dây 2D");
  openWiring.type = "button";
  openWiring.setAttribute("data-practice-open-wiring", "");
  if (!hasExternalWiring || typeof onOpenWiring !== "function") {
    openWiring.disabled = true;
    openWiring.setAttribute("aria-disabled", "true");
  } else {
    openWiring.addEventListener("click", () => onOpenWiring());
  }

  const open3D = make(
    doc,
    "button",
    "practice-evidence-button",
    lessonId === 1 ? "Mở quan sát 3D" : "Mở mô hình 3D",
  );
  open3D.type = "button";
  open3D.setAttribute("data-practice-open-3d", "");
  if (typeof onOpen3D !== "function") {
    open3D.disabled = true;
    open3D.setAttribute("aria-disabled", "true");
  } else {
    open3D.addEventListener("click", () => onOpen3D());
  }

  const recheck = make(
    doc,
    "button",
    "practice-evidence-button practice-evidence-button-primary",
    isManual ? "Cập nhật checkpoint" : "Kiểm tra lại bản tự đấu",
  );
  recheck.type = "button";
  recheck.setAttribute("data-practice-recheck", "");
  if (typeof onRecheck !== "function") {
    recheck.disabled = true;
    recheck.setAttribute("aria-disabled", "true");
  } else {
    recheck.addEventListener("click", () => onRecheck());
  }

  actions.append(openWiring, open3D, recheck);
  section.append(actions);
  return section;
}
