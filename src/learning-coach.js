/**
 * Pure, deterministic learning guidance derived from existing lesson/circuit data.
 * No storage, account, network, sensor synthesis, firmware execution or hardware claim.
 */

export const LEARNING_COACH_BOUNDARIES = Object.freeze({
  topologyOnly: true,
  executesFirmware: false,
  synthesizesSensorValues: false,
  physicalValidation: false,
  storesProgress: false,
  usesAccountData: false,
  usesNetwork: false,
});

const SIGNAL_ONLY_LESSONS = new Set([10, 14]);
const UNSAFE_CODE = /(SHORT|BYPASS|POLARITY_REVERSED|STUCK_(?:HIGH|LOW)|OUTPUT_TO|SIGNAL_TO_SUPPLY|POWER_REVERSED|UNEXPECTED_NET_MERGE|BOARD_PINS_DIRECTLY_TIED|OUTPUT_PINS_SHORTED|POWER_PINS_SHORTED|TERMINALS_SHORTED|RAIL_TIE)/;

function copyBoundaries(extra = undefined) {
  return Object.freeze({
    ...LEARNING_COACH_BOUNDARIES,
    ...(extra ?? {}),
  });
}

function requireLesson(lesson) {
  if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) {
    throw new TypeError("lesson phải là object dữ liệu bài học.");
  }
  if (!Number.isInteger(lesson.id) || lesson.id < 1 || lesson.id > 16) {
    throw new RangeError("lesson.id phải là số nguyên trong phạm vi 1..16.");
  }
  for (const key of ["title", "goal", "insight", "caution"]) {
    if (typeof lesson[key] !== "string" || !lesson[key].trim()) {
      throw new TypeError("lesson." + key + " phải là chuỗi không rỗng.");
    }
  }
  if (!Array.isArray(lesson.steps) || lesson.steps.length === 0 ||
      lesson.steps.some(step => typeof step !== "string" || !step.trim())) {
    throw new TypeError("lesson.steps phải là mảng bước học không rỗng.");
  }
  if (!Array.isArray(lesson.wiring)) {
    throw new TypeError("lesson.wiring phải là mảng.");
  }
}

function requireAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    throw new TypeError("analysis phải là kết quả phân tích mạch.");
  }
  if (typeof analysis.supported !== "boolean" || typeof analysis.ok !== "boolean" ||
      typeof analysis.functional !== "boolean" || !Array.isArray(analysis.issues) ||
      !Array.isArray(analysis.paths)) {
    throw new TypeError("analysis thiếu shape supported/ok/functional/issues/paths.");
  }
}

function safeTerminals(issue) {
  return Array.isArray(issue?.terminals)
    ? issue.terminals.filter(value => typeof value === "string").slice(0, 16)
    : [];
}

function issueFeedback(issue) {
  const code = typeof issue?.code === "string" && issue.code ? issue.code : "UNKNOWN_ISSUE";
  const severity = ["error", "warning", "info"].includes(issue?.severity) ? issue.severity : "warning";
  const message = typeof issue?.message === "string" && issue.message.trim()
    ? issue.message.trim()
    : "Bộ kiểm tra topology báo một điểm cần xem lại.";
  const terminals = safeTerminals(issue);
  let feedback;

  if (code === "SIGNAL_ONLY_POWER_LOAD_UNMODELED") {
    feedback = "Chỉ đối chiếu các đường tín hiệu/GND đã mô hình. Phần nguồn công suất và tải chưa nằm trong topology nên không được nâng kết quả thành mạch hoàn chỉnh.";
  } else if (/RESISTOR_(?:MISSING|BYPASSED)/.test(code)) {
    feedback = "Đối chiếu lại đường đi qua điện trở trong sơ đồ bài; dây nối tắt hoặc bỏ qua điện trở không đạt checkpoint topology.";
  } else if (/POLARITY_REVERSED/.test(code)) {
    feedback = "Đối chiếu ký hiệu cực (+)/(−), anode/cathode trong bảng Chân nối rồi sửa topology trước khi tiếp tục.";
  } else if (/SHORT|TIED|MERGE|RAIL_TIE|OUTPUT_TO|SIGNAL_TO_SUPPLY/.test(code)) {
    feedback = "Gỡ kết nối đang ghép các terminal không thuộc cùng net tham chiếu, rồi phân tích lại mạch.";
  } else if (/STUCK_(?:HIGH|LOW)/.test(code)) {
    feedback = "Bỏ đường nối cứng giữ chân tín hiệu ở một mức; đối chiếu đường qua nút/cảm biến trong bài học.";
  } else if (/SWAPPED|MISMATCH|WRONG/.test(code)) {
    feedback = "So khớp từng chân Arduino với đúng terminal đích trong bảng Chân nối; không hoán đổi các đường tín hiệu.";
  } else if (/MISSING|INCOMPLETE/.test(code)) {
    feedback = "Bổ sung đường còn thiếu theo bảng Chân nối của bài, sau đó chạy lại bộ kiểm tra topology.";
  } else {
    feedback = "Đọc thông báo của bộ kiểm tra và đối chiếu các terminal được nêu với bảng Chân nối của bài.";
  }

  return Object.freeze({
    code,
    severity,
    message,
    terminals: Object.freeze(terminals),
    feedback,
  });
}

function isUnsafeIssue(issue) {
  const code = typeof issue?.code === "string" ? issue.code : "";
  return issue?.severity === "error" || UNSAFE_CODE.test(code);
}

function firstIncompletePath(analysis) {
  return analysis.paths.find(path => path && path.complete === false && typeof path.label === "string") ?? null;
}

export function getWiringFeedback(analysis) {
  requireAnalysis(analysis);
  const issues = analysis.issues.map(issueFeedback);
  const unsafe = analysis.issues.some(isUnsafeIssue);
  const signalOnly = analysis.scope === "signal-only";
  const incompletePath = firstIncompletePath(analysis);
  let status;
  let summary;
  let nextAction;

  if (!analysis.supported) {
    status = "unsupported";
    summary = "Bài này không có bộ kiểm tra netlist tương tác; dùng bảng Chân nối và các bước của bài làm hướng dẫn.";
    nextAction = "Tiếp tục theo các bước học; không suy diễn trạng thái điện từ việc thiếu topology checker.";
  } else if (unsafe) {
    status = "unsafe";
    const first = issues.find((_, index) => isUnsafeIssue(analysis.issues[index]));
    summary = "Topology hiện có kết nối xung đột hoặc không an toàn theo guard của bài học.";
    nextAction = first?.feedback ?? "Sửa issue mức lỗi trước khi tiếp tục.";
  } else if (signalOnly && analysis.signalPathsComplete === true) {
    status = "signal-only-complete";
    summary = "Các đường tín hiệu/GND được mô hình đã đủ, nhưng nguồn công suất và tải vẫn ngoài phạm vi checker.";
    nextAction = "Dừng ở checkpoint tín hiệu; không coi kết quả này là mạch functional hay bằng chứng phần cứng.";
  } else if (!analysis.ok || !analysis.functional) {
    status = "incomplete";
    summary = incompletePath
      ? "Topology chưa hoàn tất: " + incompletePath.label
      : "Topology chưa đạt các đường chức năng đã định nghĩa cho bài.";
    const firstAction = issues.find(item => item.code !== "SIGNAL_ONLY_POWER_LOAD_UNMODELED");
    nextAction = firstAction?.feedback ?? "Hoàn tất các đường còn thiếu theo bảng Chân nối rồi phân tích lại.";
  } else {
    status = "topology-complete";
    summary = "Topology đạt các đường chức năng đã định nghĩa cho bài và không có issue mức lỗi.";
    nextAction = "Tiếp tục checkpoint học tập; kết quả chỉ xác nhận topology đã mô hình, không xác nhận phần cứng vật lý.";
  }

  return Object.freeze({
    status,
    scope: signalOnly ? "signal-only" : "topology",
    summary,
    nextAction,
    issues: Object.freeze(issues),
    topologyOnly: true,
    confidenceClaim: false,
  });
}

function wiringCheckpoint(row) {
  if (!Array.isArray(row) || row.length < 2) return null;
  const from = String(row[0] ?? "").trim();
  const to = String(row[1] ?? "").trim();
  const why = String(row[2] ?? "").trim();
  if (!from || !to) return null;
  return why ? "Đối chiếu " + from + " ↔ " + to + ": " + why + "." : "Đối chiếu " + from + " ↔ " + to + ".";
}

function wiringCheckpointsForStep(lesson, index) {
  const totalSteps = lesson.steps.length;
  const totalWires = lesson.wiring.length;
  if (!totalWires) return [];
  const start = Math.floor(index * totalWires / totalSteps);
  const end = Math.max(start + 1, Math.floor((index + 1) * totalWires / totalSteps));
  return lesson.wiring.slice(start, Math.min(end, totalWires))
    .map(wiringCheckpoint)
    .filter(Boolean);
}

function makeMicrosteps(lesson) {
  return lesson.steps.map((instruction, index) => {
    const wiringChecks = wiringCheckpointsForStep(lesson, index);
    const checkpoint = wiringChecks.length
      ? wiringChecks.join(" ")
      : (index === lesson.steps.length - 1
        ? "Checkpoint: giải thích lại mục tiêu — " + lesson.goal
        : "Checkpoint: liên hệ bước này với mục tiêu — " + lesson.goal);
    const hint = index === 0
      ? "Gợi ý: " + lesson.insight
      : index === lesson.steps.length - 1
        ? "Lưu ý phạm vi: " + lesson.caution
        : "Gợi ý: dùng bảng Chân nối để kiểm tra trước khi chuyển bước.";
    return Object.freeze({
      id: "lesson-" + String(lesson.id).padStart(2, "0") + "-step-" + (index + 1),
      instruction,
      checkpoint,
      hint,
    });
  });
}

export function getLessonGuidance(lesson, circuitAnalysis = undefined) {
  requireLesson(lesson);
  if (circuitAnalysis !== undefined && circuitAnalysis !== null &&
      Number.isInteger(circuitAnalysis.lessonId) && circuitAnalysis.lessonId !== lesson.id) {
    throw new RangeError("circuitAnalysis thuộc bài học khác.");
  }
  const wiring = circuitAnalysis == null ? null : getWiringFeedback(circuitAnalysis);
  const microsteps = makeMicrosteps(lesson);
  const signalOnly = SIGNAL_ONLY_LESSONS.has(lesson.id);
  let hint = "Mục tiêu: " + lesson.goal;
  let nextAction = microsteps[0].instruction;

  if (wiring) {
    hint = wiring.issues[0]?.feedback ?? lesson.insight;
    nextAction = wiring.status === "topology-complete"
      ? microsteps[microsteps.length - 1].instruction
      : wiring.nextAction;
  } else if (signalOnly) {
    hint = "Bài này chỉ có checker cho các đường tín hiệu/GND; nguồn công suất và tải không được xác nhận bởi learning coach.";
  }

  return Object.freeze({
    schemaVersion: 1,
    lessonId: lesson.id,
    title: lesson.title,
    microsteps: Object.freeze(microsteps),
    hint,
    nextAction,
    wiring,
    boundaries: copyBoundaries({ signalOnly }),
  });
}
