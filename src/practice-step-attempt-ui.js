/**
 * Native, presentation-only UI for a step-scoped practice attempt snapshot.
 *
 * The renderer never records an event, evaluates electrical correctness,
 * advances a lesson, writes progress, or upgrades an in-app observation into
 * physical action/mastery. All mutations remain host callbacks.
 */
import { PRACTICE_STEP_ATTEMPT_EVENT_TYPES } from "./practice-step-attempt.js";

const EVENT_TYPES = new Set(PRACTICE_STEP_ATTEMPT_EVENT_TYPES);
const STATES = new Set(["idle", "active", "checked"]);
const REVIEW_STATES = new Set([
  "self-review-only-no-observable-expectation",
  "no-current-attempt-events",
  "partial-current-attempt-evidence",
  "expected-current-attempt-events-observed",
]);
const OPTION_KEYS = new Set(["onStart", "onCheck", "onRetry", "onCancel"]);
const EVENT_LABELS = Object.freeze({
  "view-pinout": "Mở sơ đồ chân",
  "view-3d": "Mở hoặc quan sát 3D",
  "view-wiring": "Mở sơ đồ nối dây",
  "change-control": "Thay đổi điều khiển",
  "start-simulation": "Chạy mô phỏng",
  "edit-sketch": "Chỉnh sửa Sketch",
  "connect-wire": "Nối dây trong ứng dụng",
});

function requireDocument(doc) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new TypeError("renderPracticeStepAttempt cần document có createElement().");
  }
}

function requirePlainOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("practice step attempt UI options phải là plain object.");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.some(key => typeof key !== "string")) {
    throw new TypeError("practice step attempt UI options không nhận symbol key.");
  }
  const unknown = keys.filter(key => !OPTION_KEYS.has(key)).sort();
  if (unknown.length) {
    throw new RangeError("practice step attempt UI options có field không hỗ trợ: " + unknown.join(", ") + ".");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError("practice step attempt UI option phải là own data field: " + key + ".");
    }
    if (descriptor.value != null && typeof descriptor.value !== "function") {
      throw new TypeError("practice step attempt UI callback " + key + " phải là function/null.");
    }
  }
  return options;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || !Object.isFrozen(value) || value.length > EVENT_TYPES.size) {
    throw new TypeError(label + " phải là frozen Array.");
  }
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set ||
        typeof descriptor.value !== "string" || !EVENT_TYPES.has(descriptor.value) ||
        seen.has(descriptor.value)) {
      throw new TypeError(label + "[" + index + "] không thuộc event allowlist.");
    }
    seen.add(descriptor.value);
  }
  return value;
}

function requireSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      Object.getPrototypeOf(snapshot) !== Object.prototype || !Object.isFrozen(snapshot)) {
    throw new TypeError("practice step attempt snapshot phải là frozen plain object.");
  }
  if (!STATES.has(snapshot.state) ||
      !Number.isInteger(snapshot.lessonId) || snapshot.lessonId < 1 || snapshot.lessonId > 16 ||
      !Number.isInteger(snapshot.stepIndex) || snapshot.stepIndex < 0 || snapshot.stepIndex > 2 ||
      typeof snapshot.checkpointId !== "string" ||
      snapshot.checkpointId !== "lesson-" + String(snapshot.lessonId).padStart(2, "0") +
        "-step-" + String(snapshot.stepIndex + 1).padStart(2, "0") ||
      !["manual", "wiring"].includes(snapshot.checkpointKind) ||
      typeof snapshot.sourceStep !== "string" || !snapshot.sourceStep.trim() ||
      typeof snapshot.guidance !== "string" || !snapshot.guidance.trim() ||
      !["manual-only", "topology", "signal-only"].includes(snapshot.lessonScope) ||
      !Number.isInteger(snapshot.eventCount) || snapshot.eventCount < 0 || snapshot.eventCount > 64) {
    throw new RangeError("practice step attempt snapshot có identity/state không hợp lệ.");
  }
  const expected = requireStringArray(snapshot.expectedEventTypes, "snapshot.expectedEventTypes");
  const observed = requireStringArray(snapshot.observedEventTypes, "snapshot.observedEventTypes");
  const missing = requireStringArray(snapshot.missingEventTypes, "snapshot.missingEventTypes");
  const unexpected = requireStringArray(snapshot.unexpectedEventTypes, "snapshot.unexpectedEventTypes");
  const observedSet = new Set(observed);
  const claims = snapshot.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims) || !Object.isFrozen(claims) ||
      claims.origin !== "step-scoped-module-attempt" ||
      claims.stepScoped !== true || claims.eventsRequireHostReport !== true ||
      claims.physicalVerified !== false || claims.electricalAuthority !== false ||
      claims.firmwareExecuted !== false || claims.hardwareValidated !== false ||
      claims.mastery !== false || claims.teacherValidated !== false ||
      claims.autoCompletion !== false || claims.lessonCompleted !== false ||
      claims.prerequisiteForAdvance !== false || claims.progressTracked !== false) {
    throw new RangeError("practice step attempt snapshot claims vượt ranh giới UI.");
  }
  if (snapshot.state === "idle") {
    if (snapshot.attemptToken !== null || snapshot.review !== null ||
        snapshot.canStart !== true || snapshot.canCheck !== false ||
        snapshot.canRetry !== false || snapshot.canCancel !== false ||
        snapshot.eventCount !== 0 || observed.length || unexpected.length) {
      throw new RangeError("idle practice step attempt snapshot không nhất quán.");
    }
  } else {
    if (!snapshot.attemptToken || typeof snapshot.attemptToken !== "object" ||
        !Object.isFrozen(snapshot.attemptToken) || snapshot.canStart !== false ||
        snapshot.canCheck !== true || snapshot.canRetry !== true || snapshot.canCancel !== true) {
      throw new RangeError("active practice step attempt snapshot thiếu token/action state.");
    }
    if (snapshot.state === "checked" && (!snapshot.review || !Object.isFrozen(snapshot.review))) {
      throw new RangeError("checked practice step attempt snapshot thiếu frozen review.");
    }
    if (snapshot.state === "active" && snapshot.review !== null) {
      throw new RangeError("active practice step attempt snapshot không được mang review cũ.");
    }
  }
  if (snapshot.review) {
    const review = snapshot.review;
    const reviewExpected = requireStringArray(review.expectedEventTypes, "review.expectedEventTypes");
    const reviewObserved = requireStringArray(review.observedEventTypes, "review.observedEventTypes");
    const reviewMatching = requireStringArray(review.matchingEventTypes, "review.matchingEventTypes");
    const reviewMissing = requireStringArray(review.missingEventTypes, "review.missingEventTypes");
    const reviewUnexpected = requireStringArray(review.unexpectedEventTypes, "review.unexpectedEventTypes");
    if (Object.getPrototypeOf(review) !== Object.prototype ||
        !REVIEW_STATES.has(review.status) ||
        review.sessionId !== snapshot.sessionId ||
        review.lessonId !== snapshot.lessonId ||
        review.stepIndex !== snapshot.stepIndex ||
        review.checkpointId !== snapshot.checkpointId ||
        review.checkpointKind !== snapshot.checkpointKind ||
        review.lessonScope !== snapshot.lessonScope ||
        review.eventCount !== snapshot.eventCount ||
        !Object.isFrozen(review.provenance) ||
        review.provenance.checkpointSource !== "practice-checkpoints.js" ||
        review.provenance.expectationSource !== "practice-observation.js:editorial-expectation-only" ||
        review.provenance.eventSource !== "host-reported-during-active-step-attempt" ||
        review.provenance.oldLessonJournalUsedAsStepProof !== false ||
        !Object.isFrozen(review.claims) ||
        review.claims.origin !== "step-scoped-module-attempt" ||
        review.claims.mastery !== false ||
        review.claims.teacherValidated !== false ||
        review.claims.physicalVerified !== false ||
        review.claims.firmwareExecuted !== false ||
        review.claims.lessonCompleted !== false) {
      throw new RangeError("practice step attempt review provenance/identity không hợp lệ.");
    }
    const expectedMatching = expected.filter(eventType => observedSet.has(eventType));
    if (JSON.stringify(reviewExpected) !== JSON.stringify(expected) ||
        JSON.stringify(reviewObserved) !== JSON.stringify(observed) ||
        JSON.stringify(reviewMatching) !== JSON.stringify(expectedMatching) ||
        JSON.stringify(reviewMissing) !== JSON.stringify(missing) ||
        JSON.stringify(reviewUnexpected) !== JSON.stringify(unexpected)) {
      throw new RangeError("practice step attempt review event projection không hợp lệ.");
    }
  }
  if (missing.some(eventType => !expected.includes(eventType) || observedSet.has(eventType)) ||
      unexpected.some(eventType => expected.includes(eventType) || !observedSet.has(eventType))) {
    throw new RangeError("practice step attempt event projection không nhất quán.");
  }
  return snapshot;
}

function make(doc, tag, className = "", text = undefined) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function contextFor(snapshot) {
  return Object.freeze({
    lessonId: snapshot.lessonId,
    stepIndex: snapshot.stepIndex,
    checkpointId: snapshot.checkpointId,
  });
}

function eventLabel(eventType) {
  return EVENT_LABELS[eventType] + " (" + eventType + ")";
}

function reviewText(status) {
  if (status === "self-review-only-no-observable-expectation") {
    return "Bước này không có category đủ rõ để kiểm tự động. Review chỉ nhắc người học tự đối chiếu với hướng dẫn nguồn; không có kết quả đạt/rớt.";
  }
  if (status === "no-current-attempt-events") {
    return "Lượt hiện tại chưa có event trong ứng dụng. Điều này chỉ mô tả lượt đang mở và không chứng minh người học chưa thực hành ở nơi khác.";
  }
  if (status === "partial-current-attempt-evidence") {
    return "Lượt hiện tại mới ghi nhận một phần category kỳ vọng. Có thể tiếp tục thao tác rồi kiểm lại; đây không phải điểm số hay điều kiện chuyển bước.";
  }
  return "Các category kỳ vọng đã được host báo trong đúng lượt/step hiện tại. Đây chỉ là evidence tương tác trong ứng dụng, không phải mastery, giáo viên, phần cứng hay completion.";
}

function appendEventList(doc, section, attribute, heading, values, emptyText) {
  const block = make(doc, "div", "practice-step-attempt-events");
  block.setAttribute(attribute, "");
  block.append(make(doc, "h6", "practice-step-attempt-subheading", heading));
  if (!values.length) {
    block.append(make(doc, "p", "practice-step-attempt-empty", emptyText));
  } else {
    const list = make(doc, "ul", "practice-step-attempt-event-list");
    for (const eventType of values) list.append(make(doc, "li", "", eventLabel(eventType)));
    block.append(list);
  }
  section.append(block);
}

function nativeAction(doc, label, attribute, enabled, callback) {
  const button = make(doc, "button", "practice-step-attempt-button", label);
  button.type = "button";
  button.setAttribute(attribute, "");
  button.style.minWidth = "44px";
  button.style.minHeight = "44px";
  button.style.maxWidth = "100%";
  if (!enabled || typeof callback !== "function") {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  } else {
    button.setAttribute("aria-disabled", "false");
    button.addEventListener("click", callback);
  }
  return button;
}

/**
 * Render one immutable model snapshot.
 *
 * Callback contract:
 *   onStart(context)
 *   onCheck(attemptToken, context)
 *   onRetry(attemptToken, context)
 *   onCancel(attemptToken, context)
 *
 * `attemptToken` is passed through unchanged. The host must let the model
 * validate it and rerender from a fresh `inspectPracticeStepAttempt()` result.
 */
export function renderPracticeStepAttempt(doc, snapshot, options = {}) {
  requireDocument(doc);
  const model = requireSnapshot(snapshot);
  const callbacks = requirePlainOptions(options);
  const context = contextFor(model);

  const section = make(doc, "section", "practice-step-attempt");
  section.setAttribute("data-practice-step-attempt", "");
  section.setAttribute("data-attempt-state", model.state);
  section.setAttribute("data-attempt-lesson", String(model.lessonId));
  section.setAttribute("data-attempt-step", String(model.stepIndex));
  section.setAttribute("data-attempt-checkpoint", model.checkpointId);
  section.setAttribute(
    "data-attempt-revision",
    model.attemptToken ? String(model.attemptToken.revision) : "idle",
  );
  section.setAttribute("role", "group");
  section.setAttribute(
    "aria-label",
    "Lượt thực hành trong ứng dụng · bài " + model.lessonId + " bước " + (model.stepIndex + 1),
  );

  section.append(
    make(doc, "h5", "practice-step-attempt-heading", "Thử → kiểm tra trong bước hiện tại"),
    make(doc, "p", "practice-step-attempt-source", "Bước nguồn: " + model.sourceStep),
    make(doc, "p", "practice-step-attempt-guidance", "Gợi ý: " + model.guidance),
  );

  const statusText = model.state === "idle"
    ? "Chưa bắt đầu lượt thực hành cho bước này. Chỉ event xảy ra sau khi Bắt đầu mới có thể xuất hiện trong lượt."
    : model.state === "checked"
      ? "Đã kiểm tra phạm vi event của lượt hiện tại. Kết quả chỉ mô tả category trong ứng dụng; không phải điểm số hay xác nhận kỹ năng."
      : "Lượt thực hành đang mở. Có " + model.eventCount + " event được host báo đúng lesson/step của lượt này.";
  const status = make(doc, "p", "practice-step-attempt-status", statusText);
  status.setAttribute("data-practice-step-attempt-status", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  section.append(status);

  appendEventList(
    doc,
    section,
    "data-attempt-expected-events",
    "Category kỳ vọng theo biên tập (không bắt buộc)",
    model.expectedEventTypes,
    "Bước này không có category đủ rõ để kiểm tự động. Check chỉ là tự đối chiếu; không có trạng thái đạt/rớt.",
  );
  appendEventList(
    doc,
    section,
    "data-attempt-observed-events",
    "Category đã ghi nhận trong lượt hiện tại",
    model.observedEventTypes,
    "Chưa có category nào được host báo trong lượt hiện tại.",
  );

  if (model.review) {
    const review = make(doc, "div", "practice-step-attempt-review");
    review.setAttribute("data-practice-step-attempt-review", "");
    review.setAttribute("data-attempt-review-status", String(model.review.status || "unknown"));
    review.append(
      make(doc, "h6", "practice-step-attempt-subheading", "Đối chiếu lượt hiện tại"),
      make(
        doc,
        "p",
        "practice-step-attempt-review-summary",
        reviewText(model.review.status),
      ),
    );
    if (model.missingEventTypes.length) {
      review.append(make(
        doc,
        "p",
        "practice-step-attempt-review-missing",
        "Category kỳ vọng chưa thấy trong lượt: " + model.missingEventTypes.map(eventLabel).join("; "),
      ));
    }
    if (model.unexpectedEventTypes.length) {
      review.append(make(
        doc,
        "p",
        "practice-step-attempt-review-extra",
        "Category khác đã ghi nhận trong lượt: " + model.unexpectedEventTypes.map(eventLabel).join("; "),
      ));
    }
    section.append(review);
  }

  if (model.lessonScope === "signal-only") {
    const signal = make(
      doc,
      "p",
      "practice-step-attempt-signal-boundary",
      "Bài này vẫn là signal-only: lượt thực hành không xác nhận nguồn, tải, motor/bơm hoặc chức năng phần cứng.",
    );
    signal.setAttribute("role", "note");
    section.append(signal);
  }

  const actions = make(doc, "div", "practice-step-attempt-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Điều khiển lượt thực hành");
  const start = nativeAction(
    doc,
    "Bắt đầu lượt thực hành",
    "data-attempt-start",
    model.canStart,
    typeof callbacks.onStart === "function" ? () => callbacks.onStart(context) : null,
  );
  const check = nativeAction(
    doc,
    "Kiểm tra bằng chứng trong lượt này",
    "data-attempt-check",
    model.canCheck,
    typeof callbacks.onCheck === "function"
      ? () => callbacks.onCheck(model.attemptToken, context)
      : null,
  );
  const retry = nativeAction(
    doc,
    "Thử lại",
    "data-attempt-retry",
    model.canRetry,
    typeof callbacks.onRetry === "function"
      ? () => callbacks.onRetry(model.attemptToken, context)
      : null,
  );
  const cancel = nativeAction(
    doc,
    "Hủy lượt",
    "data-attempt-cancel",
    model.canCancel,
    typeof callbacks.onCancel === "function"
      ? () => callbacks.onCancel(model.attemptToken, context)
      : null,
  );
  actions.append(start, check, retry, cancel);
  section.append(actions);

  const boundary = make(
    doc,
    "p",
    "practice-step-attempt-boundary",
    "Lượt này chỉ ghi nhận category tương tác do host báo trong đúng bước đang mở. Không dùng journal lesson-level làm bằng chứng bước; không đo phần cứng, không chạy firmware, không chấm mastery/giáo viên, không tự chuyển bước và không tự hoàn thành bài.",
  );
  boundary.setAttribute("data-practice-step-attempt-boundary", "");
  boundary.setAttribute("role", "note");
  section.append(boundary);
  return section;
}
