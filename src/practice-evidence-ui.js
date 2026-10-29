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

function unorderedPairKey(pair) {
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const left = typeof pair[0] === "string" ? pair[0] : null;
  const right = typeof pair[1] === "string" ? pair[1] : null;
  if (!left || !right || left === right) return null;
  return left < right ? left + "\u0000" + right : right + "\u0000" + left;
}

function inspectMissingTarget(evidence, checkpoint) {
  const checklist = validatedWireChecklist(evidence, checkpoint);
  if (!checklist || checklist.manual) return null;
  const guidance = evidence?.wireGuidance;
  if (!guidance || typeof guidance !== "object" || Array.isArray(guidance)) return null;
  if (
    guidance.status !== "missing-canonical-pair" ||
    checkpoint?.kind !== "wiring" ||
    checkpoint?.provenance?.scheme !== "human-authored-from-lesson-text" ||
    guidance?.claims?.topologyAuthority !== "circuit-router" ||
    guidance?.claims?.authoredCheckpoint !== true ||
    guidance?.claims?.physicalVerified !== false ||
    guidance?.claims?.wireCreated !== false ||
    guidance?.claims?.inspectorNavigationOnly !== true
  ) return null;

  const pair = guidance.nextMissingPair;
  const key = unorderedPairKey(pair);
  if (!key || typeof guidance.inspectTerminalId !== "string" || guidance.inspectTerminalId !== pair[0]) return null;
  const evidenceMissing = Array.isArray(evidence.missingPairs) &&
    evidence.missingPairs.length > 0 && unorderedPairKey(evidence.missingPairs[0]) === key;
  const guidanceMissing = Array.isArray(guidance.missingPairs) &&
    guidance.missingPairs.length > 0 && unorderedPairKey(guidance.missingPairs[0]) === key;
  const checkpointRequired = Array.isArray(checkpoint.requiredPairs) &&
    checkpoint.requiredPairs.some(item => unorderedPairKey(item) === key);
  if (!evidenceMissing || !guidanceMissing || !checkpointRequired) return null;
  return Object.freeze({ terminalId: pair[0], pair: Object.freeze([pair[0], pair[1]]) });
}

function checklistRowKeys(row) {
  return row && typeof row === "object" && !Array.isArray(row)
    ? Object.keys(row).sort().join("\u0000")
    : "";
}

function validatedWireChecklist(evidence, checkpoint) {
  const guidance = evidence?.wireGuidance;
  if (!guidance || typeof guidance !== "object" || Array.isArray(guidance)) return null;
  if (
    checkpoint?.provenance?.scheme !== "human-authored-from-lesson-text" ||
    checkpoint?.provenance?.teacherValidated !== false ||
    checkpoint?.provenance?.prerequisiteForAdvance !== false ||
    guidance.checkpointId !== checkpoint.id ||
    guidance.lessonId !== evidence.lessonId ||
    guidance.stepIndex !== evidence.stepIndex ||
    guidance?.claims?.topologyAuthority !== "circuit-router" ||
    guidance?.claims?.authoredCheckpoint !== true ||
    guidance?.claims?.topologyOnly !== true ||
    guidance?.claims?.physicalVerified !== false ||
    guidance?.claims?.measured !== false ||
    guidance?.claims?.electricalSafetyVerified !== false ||
    guidance?.claims?.learnerActionProven !== false ||
    guidance?.claims?.mastery !== false ||
    guidance?.claims?.autoCompletion !== false ||
    guidance?.claims?.lessonCompleted !== false ||
    guidance?.claims?.prerequisiteForAdvance !== false ||
    guidance?.claims?.teacherValidated !== false ||
    guidance?.claims?.wireCreated !== false ||
    guidance?.claims?.inspectorNavigationOnly !== true ||
    evidence?.claims?.physicalVerified !== false ||
    evidence?.claims?.mastery !== false ||
    evidence?.claims?.autoCompletion !== false ||
    evidence?.claims?.lessonCompleted !== false ||
    evidence?.claims?.teacherValidated !== false ||
    evidence?.claims?.checkpointPrerequisiteForAdvance !== false ||
    !Array.isArray(guidance.pairChecklist) ||
    !Array.isArray(guidance.extraReviewChecklist)
  ) return null;

  if (checkpoint.kind === "manual") {
    if (
      guidance.status !== "not-applicable-manual-checkpoint" ||
      guidance.pairChecklist.length !== 0 ||
      guidance.extraReviewChecklist.length !== 0 ||
      guidance.matchedPairCount !== 0 ||
      guidance.requiredPairCount !== 0 ||
      safeCount(evidence.matched) !== 0 ||
      safeCount(evidence.required) !== 0 ||
      !Array.isArray(evidence.missingPairs) || evidence.missingPairs.length !== 0 ||
      !Array.isArray(evidence.extraPairs) || evidence.extraPairs.length !== 0
    ) return null;
    return Object.freeze({ manual: true, pairRows: Object.freeze([]), extraRows: Object.freeze([]) });
  }
  if (checkpoint.kind !== "wiring" || !Array.isArray(checkpoint.requiredPairs)) return null;
  if (
    guidance.pairChecklist.length !== checkpoint.requiredPairs.length ||
    guidance.requiredPairCount !== checkpoint.requiredPairs.length
  ) return null;

  const expectedRowKeys = "explanation\u0000inspectTerminalId\u0000order\u0000pair\u0000status";
  const pairRows = [];
  const missingKeys = [];
  let matchedCount = 0;
  for (let index = 0; index < guidance.pairChecklist.length; index += 1) {
    const row = guidance.pairChecklist[index];
    const authoredPair = checkpoint.requiredPairs[index];
    if (
      checklistRowKeys(row) !== expectedRowKeys ||
      row.order !== index + 1 ||
      !Array.isArray(row.pair) || row.pair.length !== 2 ||
      row.pair[0] !== authoredPair?.[0] || row.pair[1] !== authoredPair?.[1] ||
      !["matched", "missing"].includes(row.status) ||
      row.inspectTerminalId !== row.pair[0] ||
      typeof row.explanation !== "string" || !row.explanation.trim()
    ) return null;
    const key = unorderedPairKey(row.pair);
    if (!key) return null;
    if (row.status === "missing") missingKeys.push(key);
    else matchedCount += 1;
    pairRows.push(Object.freeze({
      order: row.order,
      pair: Object.freeze([row.pair[0], row.pair[1]]),
      status: row.status,
      inspectTerminalId: row.inspectTerminalId,
      explanation: row.explanation,
    }));
  }
  if (guidance.matchedPairCount !== matchedCount || safeCount(evidence.matched) !== matchedCount) return null;
  if (safeCount(evidence.required) !== pairRows.length) return null;
  const evidenceMissingKeys = Array.isArray(evidence.missingPairs)
    ? evidence.missingPairs.map(unorderedPairKey)
    : [];
  const guidanceMissingKeys = Array.isArray(guidance.missingPairs)
    ? guidance.missingPairs.map(unorderedPairKey)
    : [];
  if (
    evidenceMissingKeys.some(key => !key) || guidanceMissingKeys.some(key => !key) ||
    evidenceMissingKeys.join("\u0001") !== missingKeys.join("\u0001") ||
    guidanceMissingKeys.join("\u0001") !== missingKeys.join("\u0001")
  ) return null;

  const expectedExtraRowKeys = "explanation\u0000inspectTerminalId\u0000order\u0000pair\u0000status";
  const extraRows = [];
  if (guidance.extraReviewChecklist.length !== guidance.reviewExtraPairs?.length) return null;
  for (let index = 0; index < guidance.extraReviewChecklist.length; index += 1) {
    const row = guidance.extraReviewChecklist[index];
    const sourcePair = guidance.reviewExtraPairs[index];
    if (
      checklistRowKeys(row) !== expectedExtraRowKeys ||
      row.order !== index + 1 || row.status !== "review-extra" ||
      !Array.isArray(row.pair) || row.pair.length !== 2 ||
      row.pair[0] !== sourcePair?.[0] || row.pair[1] !== sourcePair?.[1] ||
      row.inspectTerminalId !== row.pair[0] ||
      typeof row.explanation !== "string" || !row.explanation.trim() ||
      !unorderedPairKey(row.pair)
    ) return null;
    extraRows.push(Object.freeze({
      order: row.order,
      pair: Object.freeze([row.pair[0], row.pair[1]]),
      status: row.status,
      inspectTerminalId: row.inspectTerminalId,
      explanation: row.explanation,
    }));
  }
  const evidenceExtraKeys = Array.isArray(evidence.extraPairs)
    ? evidence.extraPairs.map(unorderedPairKey)
    : [];
  if (evidenceExtraKeys.some(key => !key)) return null;
  evidenceExtraKeys.sort();
  const checklistExtraKeys = extraRows.map(row => unorderedPairKey(row.pair)).sort();
  if (evidenceExtraKeys.join("\u0001") !== checklistExtraKeys.join("\u0001")) return null;

  return Object.freeze({
    manual: false,
    pairRows: Object.freeze(pairRows),
    extraRows: Object.freeze(extraRows),
  });
}

function appendChecklistInspectButton(doc, row, attribute, callback) {
  const button = make(
    doc,
    "button",
    "practice-evidence-button practice-evidence-checklist-button",
    "Xem " + row.inspectTerminalId + " trong 3D / Inspector",
  );
  button.type = "button";
  button.setAttribute(attribute, "");
  button.setAttribute("data-practice-inspect-terminal", row.inspectTerminalId);
  button.setAttribute("data-practice-checklist-order", String(row.order));
  button.setAttribute(
    "aria-label",
    "Xem terminal " + row.inspectTerminalId + " của cặp " + row.pair[0] + " và " + row.pair[1] +
      " trong 3D Inspector; chỉ điều hướng đọc",
  );
  if (typeof callback !== "function") {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  } else {
    button.addEventListener("click", () => callback(row.inspectTerminalId));
  }
  return button;
}

function appendWireChecklist(doc, section, checklist, onInspectChecklistTerminal) {
  if (!checklist) return;
  const block = make(doc, "div", "practice-evidence-wire-checklist");
  block.setAttribute("data-practice-wire-checklist", "");
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", "Checklist cạnh dây authored của checkpoint");
  block.append(make(doc, "h6", "practice-evidence-subheading", "Checklist cạnh dây của checkpoint"));
  if (checklist.manual) {
    block.append(make(
      doc,
      "p",
      "practice-evidence-empty",
      "Checkpoint manual không có authored required pair để chấm bằng topology.",
    ));
    section.append(block);
    return;
  }

  const matched = checklist.pairRows.filter(row => row.status === "matched").length;
  block.append(make(
    doc,
    "p",
    "practice-evidence-checklist-summary",
    "Đối chiếu authored pairs: " + matched + "/" + checklist.pairRows.length + " cặp đã xuất hiện trong learner graph.",
  ));
  const list = make(doc, "ul", "practice-evidence-list practice-evidence-checklist-list");
  list.setAttribute("data-practice-checklist-required-list", "");
  for (const row of checklist.pairRows) {
    const item = make(doc, "li", "practice-evidence-checklist-row");
    item.setAttribute("data-practice-checklist-row", "");
    item.setAttribute("data-practice-pair-status", row.status);
    item.setAttribute("data-practice-checklist-order", String(row.order));
    item.append(make(
      doc,
      "span",
      "practice-evidence-checklist-copy",
      "Cặp " + row.order + ": " + row.pair[0] + " ↔ " + row.pair[1] + " — " +
        (row.status === "matched" ? "Đã có trong learner graph." : "Còn thiếu trong learner graph."),
    ));
    item.append(make(doc, "p", "practice-evidence-checklist-explanation", row.explanation));
    item.append(appendChecklistInspectButton(
      doc,
      row,
      "data-practice-checklist-inspect-terminal",
      onInspectChecklistTerminal,
    ));
    list.append(item);
  }
  block.append(list);

  if (checklist.extraRows.length) {
    const extraBlock = make(doc, "div", "practice-evidence-extra-review-checklist");
    extraBlock.setAttribute("data-practice-extra-review-checklist", "");
    extraBlock.setAttribute("role", "group");
    extraBlock.setAttribute("aria-label", "Cạnh ngoài canonical reference cần review");
    extraBlock.append(make(
      doc,
      "h6",
      "practice-evidence-subheading",
      "Cạnh ngoài canonical reference cần review",
    ));
    const extraList = make(doc, "ul", "practice-evidence-list practice-evidence-checklist-list");
    for (const row of checklist.extraRows) {
      const item = make(doc, "li", "practice-evidence-checklist-row");
      item.setAttribute("data-practice-extra-review-row", "");
      item.setAttribute("data-practice-pair-status", "review-extra");
      item.setAttribute("data-practice-checklist-order", String(row.order));
      item.append(make(
        doc,
        "span",
        "practice-evidence-checklist-copy",
        "Review " + row.order + ": " + row.pair[0] + " ↔ " + row.pair[1] +
          " — không thuộc canonical reference sample.",
      ));
      item.append(make(doc, "p", "practice-evidence-checklist-explanation", row.explanation));
      item.append(appendChecklistInspectButton(
        doc,
        row,
        "data-practice-extra-inspect-terminal",
        onInspectChecklistTerminal,
      ));
      extraList.append(item);
    }
    extraBlock.append(extraList);
    block.append(extraBlock);
  }
  section.append(block);
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
  onInspectMissingTerminal,
  onInspectChecklistTerminal,
  onRecheck,
} = {}) {
  requireDocument(doc);
  requireEvidence(evidence);
  requireCallback(onOpenWiring, "onOpenWiring");
  requireCallback(onOpen3D, "onOpen3D");
  requireCallback(onInspectMissingTerminal, "onInspectMissingTerminal");
  requireCallback(onInspectChecklistTerminal, "onInspectChecklistTerminal");
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
  const missingInspectTarget = inspectMissingTarget(evidence, checkpoint);
  const wireChecklist = validatedWireChecklist(evidence, checkpoint);

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

  const wireGuidance = evidence.wireGuidance && typeof evidence.wireGuidance === "object" &&
    !Array.isArray(evidence.wireGuidance) ? evidence.wireGuidance : null;
  if (wireGuidance && wireChecklist && wireGuidance.status !== "not-applicable-manual-checkpoint") {
    const wireNode = make(
      doc,
      "p",
      "practice-evidence-wire-guidance",
      "Hướng dẫn cạnh dây: " + safeText(
        wireGuidance.explanation,
        "Chưa có hướng dẫn cạnh dây cho checkpoint này.",
      ),
    );
    wireNode.setAttribute("data-practice-wire-guidance", "");
    section.append(wireNode);
    if (Array.isArray(wireGuidance.reviewExtraPairs) && wireGuidance.reviewExtraPairs.length) {
      const reviewNode = make(
        doc,
        "p",
        "practice-evidence-wire-review",
        "Review topology: " + safeText(
          wireGuidance.reviewExplanation,
          "Có cạnh ngoài canonical reference sample cần đối chiếu lại.",
        ),
      );
      reviewNode.setAttribute("data-practice-wire-review", "");
      reviewNode.setAttribute("role", "note");
      section.append(reviewNode);
    }
  }
  appendWireChecklist(doc, section, wireChecklist, onInspectChecklistTerminal);

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

  let inspectMissing = null;
  if (missingInspectTarget) {
    inspectMissing = make(
      doc,
      "button",
      "practice-evidence-button",
      "Xem chân cần nối trong 3D / Inspector",
    );
    inspectMissing.type = "button";
    inspectMissing.setAttribute("data-practice-inspect-missing-terminal", "");
    inspectMissing.setAttribute("data-practice-inspect-terminal", missingInspectTarget.terminalId);
    inspectMissing.setAttribute(
      "aria-label",
      "Xem terminal " + missingInspectTarget.terminalId +
      " của cặp còn thiếu " + missingInspectTarget.pair[0] + " và " + missingInspectTarget.pair[1] +
      " trong 3D Inspector",
    );
    if (typeof onInspectMissingTerminal !== "function") {
      inspectMissing.disabled = true;
      inspectMissing.setAttribute("aria-disabled", "true");
    } else {
      inspectMissing.addEventListener("click", () => {
        onInspectMissingTerminal(missingInspectTarget.terminalId);
      });
    }
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

  actions.append(...[openWiring, open3D, inspectMissing, recheck].filter(Boolean));
  section.append(actions);
  return section;
}
