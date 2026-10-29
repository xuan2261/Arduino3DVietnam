/**
 * Accessible, presentation-only UI for the 3-step authored checkpoint trail.
 *
 * The only optional host action is onNavigateStep(index), fired after an
 * explicit native-button click. Rendering never mutates learner state, records
 * progress, creates wires, advances automatically, or claims mastery.
 */
import { PRACTICE_CHECKPOINT_TRAIL_LIMITS } from "./practice-checkpoint-trail.js";

const OPTION_KEYS = Object.freeze(["onNavigateStep"]);
const LESSON_SCOPES = new Set(["manual-only", "topology", "signal-only"]);
const EVIDENCE_STATUSES = new Set([
  "manual-not-automatically-assessed",
  "authored-pairs-missing",
  "authored-pairs-present",
]);

function requirePlainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " phải là plain object.");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(label + " không được dùng prototype tùy biến.");
  }
  return value;
}

function requirePlainArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(label + " phải là Array chuẩn.");
  }
  return value;
}

function requireDocument(doc) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new TypeError("renderPracticeCheckpointTrail cần document có createElement().");
  }
}

function requireOptions(options) {
  const source = requirePlainRecord(options, "practice checkpoint trail options");
  const keys = Object.getOwnPropertyNames(source).sort();
  if (keys.join("\u0001") !== OPTION_KEYS.join("\u0001") && keys.length !== 0) {
    throw new RangeError("practice checkpoint trail options chỉ hỗ trợ onNavigateStep.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, "onNavigateStep");
  if (descriptor && !("value" in descriptor)) {
    throw new TypeError("onNavigateStep phải là own data property.");
  }
  const callback = descriptor?.value ?? null;
  if (callback !== null && callback !== undefined && typeof callback !== "function") {
    throw new TypeError("onNavigateStep phải là function khi được cung cấp.");
  }
  return callback ?? null;
}

function safeText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(label + " phải là chuỗi không rỗng.");
  }
  return value.trim();
}

function make(doc, tagName, className = "", text = undefined) {
  const node = doc.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function requireClaims(claims, label, signalOnly) {
  const source = requirePlainRecord(claims, label);
  for (const key of [
    "autoCompletion",
    "mastery",
    "mutationPerformed",
    "physicalVerified",
    "progressTracked",
    "teacherValidated",
  ]) {
    if (source[key] !== false) throw new RangeError(label + "." + key + " phải là false.");
  }
  if (Boolean(source.signalOnly) !== signalOnly) {
    throw new RangeError(label + ".signalOnly không khớp lesson scope.");
  }
  return source;
}

function requireTrail(trail) {
  const source = requirePlainRecord(trail, "practice checkpoint trail");
  if (!Number.isInteger(source.lessonId) || source.lessonId < 1 || source.lessonId > 16) {
    throw new RangeError("practice checkpoint trail.lessonId phải là 1..16.");
  }
  if (!LESSON_SCOPES.has(source.lessonScope)) {
    throw new RangeError("practice checkpoint trail.lessonScope không hợp lệ.");
  }
  if (
    !Number.isInteger(source.currentStepIndex) ||
    source.currentStepIndex < 0 ||
    source.currentStepIndex >= PRACTICE_CHECKPOINT_TRAIL_LIMITS.stepsPerLesson
  ) {
    throw new RangeError("practice checkpoint trail.currentStepIndex không hợp lệ.");
  }
  if (source.stepCount !== PRACTICE_CHECKPOINT_TRAIL_LIMITS.stepsPerLesson) {
    throw new RangeError("practice checkpoint trail phải có đúng 3 bước.");
  }
  const steps = requirePlainArray(source.steps, "practice checkpoint trail.steps");
  if (steps.length !== source.stepCount) {
    throw new RangeError("practice checkpoint trail.steps không khớp stepCount.");
  }
  const signalOnly = source.lessonScope === "signal-only";
  if (signalOnly !== (source.lessonId === 10 || source.lessonId === 14)) {
    throw new RangeError("practice checkpoint trail signal-only chỉ hợp lệ cho lesson 10/14.");
  }
  requireClaims(source.claims, "practice checkpoint trail.claims", signalOnly);

  const expectedPrevious = source.currentStepIndex > 0 ? source.currentStepIndex - 1 : null;
  const expectedNext = source.currentStepIndex < steps.length - 1 ? source.currentStepIndex + 1 : null;
  if (source.previousStepIndex !== expectedPrevious || source.nextStepIndex !== expectedNext) {
    throw new RangeError("practice checkpoint trail prev/next index không canonical.");
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = requirePlainRecord(steps[index], "practice checkpoint trail.steps[" + index + "]");
    if (
      step.lessonId !== source.lessonId ||
      step.stepIndex !== index ||
      step.current !== (index === source.currentStepIndex) ||
      !["manual", "wiring"].includes(step.kind) ||
      !EVIDENCE_STATUSES.has(step.evidenceStatus)
    ) {
      throw new RangeError("practice checkpoint trail.steps[" + index + "] không khớp model contract.");
    }
    safeText(step.id, "step.id");
    safeText(step.sourceGoal, "step.sourceGoal");
    safeText(step.sourceHint, "step.sourceHint");
    safeText(step.evidenceNote, "step.evidenceNote");
    if (step.sourceScheme !== "human-authored-from-lesson-text" || step.sourceName !== "lessons.steps") {
      throw new RangeError("practice checkpoint trail step provenance không canonical.");
    }

    const pairs = requirePlainArray(step.pairs, "step.pairs");
    if (pairs.length > PRACTICE_CHECKPOINT_TRAIL_LIMITS.maxRequiredPairsPerStep) {
      throw new RangeError("step.pairs vượt giới hạn DOM.");
    }
    let committed = 0;
    let missing = 0;
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      const row = requirePlainRecord(pairs[pairIndex], "step.pairs[" + pairIndex + "]");
      const pair = requirePlainArray(row.pair, "step.pairs[" + pairIndex + "].pair");
      if (
        row.order !== pairIndex + 1 ||
        pair.length !== 2 ||
        typeof pair[0] !== "string" || !pair[0] ||
        typeof pair[1] !== "string" || !pair[1] ||
        !["committed", "missing"].includes(row.status)
      ) {
        throw new RangeError("step pair row không canonical.");
      }
      if (row.status === "committed") committed += 1;
      else missing += 1;
    }
    if (
      step.requiredPairCount !== pairs.length ||
      step.committedPairCount !== committed ||
      step.missingPairCount !== missing
    ) {
      throw new RangeError("step pair counts không khớp pair rows.");
    }
    if (step.kind === "manual") {
      if (
        pairs.length !== 0 ||
        step.evidenceStatus !== "manual-not-automatically-assessed" ||
        step.claims?.automaticallyAssessed !== false
      ) {
        throw new RangeError("manual step không được có automatic/pair assessment.");
      }
    } else if (
      pairs.length < 1 ||
      (missing > 0) !== (step.evidenceStatus === "authored-pairs-missing")
    ) {
      throw new RangeError("wiring step evidenceStatus không khớp pair rows.");
    }
    requireClaims(step.claims, "step.claims", signalOnly);
  }
  return source;
}

function appendNavigationButton(doc, host, label, attribute, targetIndex, callback) {
  const button = make(doc, "button", "practice-checkpoint-trail-nav-button", label);
  button.type = "button";
  button.setAttribute(attribute, "");
  if (targetIndex === null || callback === null) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  } else {
    button.setAttribute("data-practice-trail-target-step", String(targetIndex));
    button.addEventListener("click", () => callback(targetIndex));
  }
  host.append(button);
}

function appendPairs(doc, item, step) {
  if (!step.pairs.length) return;
  const list = make(doc, "ul", "practice-checkpoint-trail-pairs");
  list.setAttribute("data-practice-trail-pairs", "");
  list.setAttribute("aria-label", "Trạng thái các cặp dây authored của bước " + (step.stepIndex + 1));
  for (const row of step.pairs) {
    const pair = make(doc, "li", "practice-checkpoint-trail-pair");
    pair.setAttribute("data-practice-trail-pair", "");
    pair.setAttribute("data-practice-trail-pair-status", row.status);
    pair.textContent =
      "Cặp " + row.order + ": " + row.pair[0] + " ↔ " + row.pair[1] + " — " +
      (row.status === "committed"
        ? "đang có trong canonical learner graph."
        : "còn thiếu trong canonical learner graph.");
    list.append(pair);
  }
  item.append(list);
}

function appendStep(doc, list, step, callback) {
  const item = make(doc, "li", "practice-checkpoint-trail-step");
  item.setAttribute("data-practice-trail-step", "");
  item.setAttribute("data-practice-trail-step-index", String(step.stepIndex));
  item.setAttribute("data-practice-trail-step-kind", step.kind);
  item.setAttribute("data-practice-trail-step-status", step.evidenceStatus);

  const button = make(
    doc,
    "button",
    "practice-checkpoint-trail-step-button",
    "Bước " + (step.stepIndex + 1),
  );
  button.type = "button";
  button.setAttribute("data-practice-trail-navigate-step", String(step.stepIndex));
  if (step.current) {
    button.setAttribute("aria-current", "step");
    button.setAttribute("aria-label", "Bước " + (step.stepIndex + 1) + " hiện tại: " + step.sourceGoal);
    // Keep the current native button focusable so the host can restore focus
    // after rerender. It intentionally has no listener: clicking the current
    // step is a no-op and cannot emit navigation/progress.
  } else if (callback === null) {
    button.setAttribute("aria-label", "Đi đến bước " + (step.stepIndex + 1) + ": " + step.sourceGoal);
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  } else {
    button.setAttribute("aria-label", "Đi đến bước " + (step.stepIndex + 1) + ": " + step.sourceGoal);
    button.addEventListener("click", () => callback(step.stepIndex));
  }
  item.append(button);

  const goal = make(doc, "p", "practice-checkpoint-trail-source-goal", step.sourceGoal);
  goal.setAttribute("data-practice-trail-source-goal", "");
  item.append(goal);

  const hint = make(doc, "p", "practice-checkpoint-trail-source-hint", step.sourceHint);
  hint.setAttribute("data-practice-trail-source-hint", "");
  item.append(hint);

  const note = make(doc, "p", "practice-checkpoint-trail-evidence-note", step.evidenceNote);
  note.setAttribute("data-practice-trail-evidence-note", "");
  item.append(note);
  appendPairs(doc, item, step);
  list.append(item);
}

/**
 * Render signature:
 *   renderPracticeCheckpointTrail(document, trail, { onNavigateStep } = {})
 *
 * onNavigateStep receives only a validated lesson-local step index (0..2), and
 * only after an explicit click on a non-current step or prev/next button.
 */
export function renderPracticeCheckpointTrail(doc, trail, options = {}) {
  requireDocument(doc);
  const model = requireTrail(trail);
  const onNavigateStep = requireOptions(options);

  const section = make(doc, "section", "practice-checkpoint-trail");
  section.setAttribute("data-practice-checkpoint-trail", "");
  section.setAttribute("data-practice-trail-lesson", String(model.lessonId));
  section.setAttribute("data-practice-trail-current-step", String(model.currentStepIndex));
  section.setAttribute("data-practice-trail-scope", model.lessonScope);
  section.setAttribute("aria-label", "Lộ trình checkpoint authored · bài " + model.lessonId);

  const status = make(
    doc,
    "p",
    "practice-checkpoint-trail-current-status",
    "Đang xem bước " + (model.currentStepIndex + 1) + "/" + model.stepCount + ".",
  );
  status.setAttribute("data-practice-trail-current-status", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  section.append(status);

  const list = make(doc, "ol", "practice-checkpoint-trail-list");
  list.setAttribute("data-practice-trail-list", "");
  list.setAttribute("aria-label", "Ba bước authored của bài hiện tại");
  for (const step of model.steps) appendStep(doc, list, step, onNavigateStep);
  section.append(list);

  const navigation = make(doc, "nav", "practice-checkpoint-trail-navigation");
  navigation.setAttribute("data-practice-trail-navigation", "");
  navigation.setAttribute("aria-label", "Điều hướng bước thực hành");
  appendNavigationButton(
    doc,
    navigation,
    "Bước trước",
    "data-practice-trail-previous",
    model.previousStepIndex,
    onNavigateStep,
  );
  appendNavigationButton(
    doc,
    navigation,
    "Bước tiếp theo",
    "data-practice-trail-next",
    model.nextStepIndex,
    onNavigateStep,
  );
  section.append(navigation);

  if (model.lessonScope === "signal-only") {
    const signal = make(
      doc,
      "p",
      "practice-checkpoint-trail-signal-boundary",
      "Bài này chỉ đối chiếu topology tín hiệu/GND; nguồn, tải và chức năng phần cứng vẫn ngoài phạm vi.",
    );
    signal.setAttribute("data-practice-trail-signal-boundary", "");
    section.append(signal);
  }

  const boundary = make(
    doc,
    "p",
    "practice-checkpoint-trail-boundary",
    "Lộ trình này chỉ đọc checkpoint authored và canonical learner graph: không ghi progress, không tự hoàn thành bài, không xác nhận mastery, giáo viên hay phần cứng.",
  );
  boundary.setAttribute("data-practice-trail-boundary", "");
  boundary.setAttribute("role", "note");
  section.append(boundary);
  return section;
}
