/**
 * Step-scoped, in-session practice attempts for the authored 48-step trail.
 *
 * This module records only host-reported in-app event categories while one
 * explicit attempt is active for one exact lesson/step/checkpoint. It does not
 * infer physical action, electrical correctness, mastery, teacher validation,
 * firmware execution, progress, completion, or permission to advance.
 *
 * The authored event expectations come from practice-observation.js using a
 * fresh empty module-branded journal. The old lesson-level observation journal
 * is never accepted as evidence by this module.
 */
import {
  PRACTICE_OBSERVATION_EVENT_TYPES,
  createPracticeObservationJournal,
  inspectPracticeObservation,
} from "./practice-observation.js";
import { getPracticeCheckpoint } from "./practice-checkpoints.js";
import {
  analyzeCircuit,
  createCircuit,
  supportedWiringLessons,
} from "./circuit-router.js";

const VERSION = 1;
const MAX_RECORDS = 64;
const SESSION_BRAND = new WeakSet();
const TOKEN_BRAND = new WeakSet();
const ATTEMPT_SNAPSHOT_BRAND = new WeakSet();
const EVENT_TYPES = Object.freeze([...PRACTICE_OBSERVATION_EVENT_TYPES]);
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const EMPTY_OBSERVATION_JOURNAL = createPracticeObservationJournal();
const SUPPORTED_WIRING_LESSONS = new Set(supportedWiringLessons());
let sessionSerial = 0;

const START_KEYS = new Set(["lesson", "stepIndex"]);
const CONTEXT_OPERATION_KEYS = new Set(["lesson", "stepIndex", "attemptToken"]);
const RECORD_KEYS = new Set(["lesson", "stepIndex", "attemptToken", "eventType"]);
const CANCEL_KEYS = new Set(["attemptToken"]);
const TOKEN_KEYS = new Set([
  "sessionId",
  "revision",
  "lessonId",
  "stepIndex",
  "checkpointId",
]);

export const PRACTICE_STEP_ATTEMPT_LIMITS = Object.freeze({
  version: VERSION,
  maxRecords: MAX_RECORDS,
  lessonCount: 16,
  stepsPerLesson: 3,
  totalCheckpoints: 48,
});

export const PRACTICE_STEP_ATTEMPT_EVENT_TYPES = EVENT_TYPES;

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(label + " phải là plain object.");
  }
  return value;
}

function requireExactDataRecord(value, allowed, label) {
  requirePlainObject(value, label);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string")) {
    throw new TypeError(label + " không nhận symbol key.");
  }
  const unknown = keys.filter(key => !allowed.has(key)).sort();
  if (unknown.length) {
    throw new RangeError(label + " có field không được hỗ trợ: " + unknown.join(", ") + ".");
  }
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError(label + " thiếu own data field: " + key + ".");
    }
  }
  return value;
}

function ownData(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
    throw new TypeError(label + " thiếu own data field: " + key + ".");
  }
  return descriptor.value;
}

function requireLessonSource(lesson) {
  requirePlainObject(lesson, "lesson");
  const lessonId = ownData(lesson, "id", "lesson");
  const steps = ownData(lesson, "steps", "lesson");
  if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > 16) {
    throw new RangeError("lesson.id phải là số nguyên 1..16.");
  }
  if (!Array.isArray(steps) || Object.getPrototypeOf(steps) !== Array.prototype || steps.length !== 3) {
    throw new TypeError("lesson.steps phải là plain Array gồm đúng 3 bước.");
  }
  for (let index = 0; index < steps.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(steps, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set ||
        typeof descriptor.value !== "string" || !descriptor.value.trim()) {
      throw new TypeError("lesson.steps[" + index + "] phải là own data string không rỗng.");
    }
  }
  return { lessonId, steps };
}

function requireStepIndex(stepIndex) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= 3) {
    throw new RangeError("stepIndex phải là số nguyên 0..2.");
  }
  return stepIndex;
}

function lessonScope(lessonId) {
  if (!SUPPORTED_WIRING_LESSONS.has(lessonId)) return "manual-only";
  const analysis = analyzeCircuit(lessonId, createCircuit(lessonId));
  return analysis?.scope === "signal-only" ? "signal-only" : "topology";
}

function checkpointContext(lesson, stepIndex) {
  const { lessonId } = requireLessonSource(lesson);
  requireStepIndex(stepIndex);
  const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
  const observation = inspectPracticeObservation({
    lesson,
    stepIndex,
    journal: EMPTY_OBSERVATION_JOURNAL,
  });
  if (observation.lessonId !== lessonId ||
      observation.stepIndex !== stepIndex ||
      observation.checkpointId !== checkpoint.id ||
      observation.sourceStep !== checkpoint.sourceStep) {
    throw new RangeError("Practice step source/observation metadata không cùng checkpoint hiện tại.");
  }
  if (observation.expectation?.required !== false ||
      observation.expectation?.teacherValidated !== false ||
      observation.expectation?.prerequisiteForAdvance !== false) {
    throw new RangeError("Practice observation expectation đã vượt ranh giới informational.");
  }
  const expectedEventTypes = observation.expectedEventTypes.map((eventType, index) => {
    if (typeof eventType !== "string" || !EVENT_TYPE_SET.has(eventType)) {
      throw new RangeError("expectedEventTypes[" + index + "] không thuộc allowlist hiện tại.");
    }
    return eventType;
  });
  return deepFreeze({
    lessonId,
    stepIndex,
    checkpointId: checkpoint.id,
    checkpointKind: checkpoint.kind,
    sourceStep: checkpoint.sourceStep,
    guidance: checkpoint.guidance,
    expectedEventTypes,
    expectationRationale: observation.expectation.rationale,
    lessonScope: lessonScope(lessonId),
  });
}

function claims() {
  return Object.freeze({
    origin: "step-scoped-module-attempt",
    sessionOnly: true,
    stepScoped: true,
    eventsRequireHostReport: true,
    outsideAppActionKnown: false,
    learnerActionProven: false,
    physicalActionProven: false,
    physicalVerified: false,
    electricalAuthority: false,
    electricalSafetyVerified: false,
    firmwareExecuted: false,
    hardwareValidated: false,
    mastery: false,
    teacherValidated: false,
    autoCompletion: false,
    lessonCompleted: false,
    prerequisiteForAdvance: false,
    progressTracked: false,
  });
}

function brandSession(value) {
  const frozen = deepFreeze(value);
  SESSION_BRAND.add(frozen);
  return frozen;
}

function requireSession(session) {
  if (!session || typeof session !== "object" || !SESSION_BRAND.has(session)) {
    throw new RangeError("practice step attempt session không được tạo bởi module hiện tại.");
  }
  if (!Object.isFrozen(session) || session.version !== VERSION ||
      typeof session.sessionId !== "string" || !/^practice-step-session-[1-9]\d*$/.test(session.sessionId) ||
      !Number.isSafeInteger(session.revision) || session.revision < 0) {
    throw new RangeError("practice step attempt session không còn hợp lệ.");
  }
  return session;
}

function brandToken(value) {
  const frozen = Object.freeze(value);
  TOKEN_BRAND.add(frozen);
  return frozen;
}

function requireToken(token) {
  if (!token || typeof token !== "object" || !TOKEN_BRAND.has(token) ||
      Object.getPrototypeOf(token) !== Object.prototype || !Object.isFrozen(token)) {
    throw new RangeError("attemptToken không được tạo bởi module hiện tại.");
  }
  const keys = Reflect.ownKeys(token);
  if (keys.length !== TOKEN_KEYS.size || keys.some(key => typeof key !== "string" || !TOKEN_KEYS.has(key))) {
    throw new RangeError("attemptToken có shape không hợp lệ.");
  }
  for (const key of TOKEN_KEYS) ownData(token, key, "attemptToken");
  if (typeof token.sessionId !== "string" ||
      !Number.isSafeInteger(token.revision) || token.revision < 1 ||
      !Number.isInteger(token.lessonId) || token.lessonId < 1 || token.lessonId > 16 ||
      !Number.isInteger(token.stepIndex) || token.stepIndex < 0 || token.stepIndex > 2 ||
      typeof token.checkpointId !== "string" || !/^lesson-\d{2}-step-0[1-3]$/.test(token.checkpointId)) {
    throw new RangeError("attemptToken có dữ liệu không hợp lệ.");
  }
  return token;
}

function tokenFor(sessionId, revision, context) {
  return brandToken({
    sessionId,
    revision,
    lessonId: context.lessonId,
    stepIndex: context.stepIndex,
    checkpointId: context.checkpointId,
  });
}

function activeFor(context, token, records = [], review = null) {
  return deepFreeze({
    lessonId: context.lessonId,
    stepIndex: context.stepIndex,
    checkpointId: context.checkpointId,
    checkpointKind: context.checkpointKind,
    sourceStep: context.sourceStep,
    guidance: context.guidance,
    lessonScope: context.lessonScope,
    expectedEventTypes: [...context.expectedEventTypes],
    expectationRationale: context.expectationRationale,
    revision: token.revision,
    token,
    records,
    review,
  });
}

function nextSession(session, { revision = session.revision, active = session.active } = {}) {
  return brandSession({
    version: VERSION,
    sessionId: session.sessionId,
    revision,
    active,
  });
}

function requireActiveToken(session, token) {
  requireSession(session);
  requireToken(token);
  const active = session.active;
  if (!active) throw new RangeError("Chưa có practice step attempt đang active.");
  if (token.sessionId !== session.sessionId ||
      token.revision !== session.revision ||
      active.revision !== token.revision ||
      active.token !== token ||
      active.lessonId !== token.lessonId ||
      active.stepIndex !== token.stepIndex ||
      active.checkpointId !== token.checkpointId) {
    throw new RangeError("attemptToken stale hoặc không thuộc practice step attempt hiện tại.");
  }
  return active;
}

function requireCurrentContext(active, lesson, stepIndex) {
  const context = checkpointContext(lesson, stepIndex);
  if (context.lessonId !== active.lessonId ||
      context.stepIndex !== active.stepIndex ||
      context.checkpointId !== active.checkpointId ||
      context.checkpointKind !== active.checkpointKind ||
      context.sourceStep !== active.sourceStep ||
      context.guidance !== active.guidance ||
      context.expectationRationale !== active.expectationRationale ||
      context.lessonScope !== active.lessonScope ||
      JSON.stringify(context.expectedEventTypes) !== JSON.stringify(active.expectedEventTypes)) {
    throw new RangeError("Practice step attempt stale: lesson/step/checkpoint source đã thay đổi.");
  }
  return context;
}

function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function reviewFor(session, active) {
  const observedEventTypes = uniqueInOrder(active.records.map(record => record.eventType));
  const observed = new Set(observedEventTypes);
  const expectedEventTypes = [...active.expectedEventTypes];
  const matchingEventTypes = expectedEventTypes.filter(eventType => observed.has(eventType));
  const missingEventTypes = expectedEventTypes.filter(eventType => !observed.has(eventType));
  const unexpectedEventTypes = observedEventTypes.filter(eventType => !expectedEventTypes.includes(eventType));
  let status;
  let summary;
  if (!expectedEventTypes.length) {
    status = "self-review-only-no-observable-expectation";
    summary = "Bước này không có event category được biên tập đủ rõ để kiểm bằng ứng dụng. Check chỉ ghi nhận rằng không có tiêu chí event tự động; không tạo kết quả đạt/rớt.";
  } else if (!observedEventTypes.length) {
    status = "no-current-attempt-events";
    summary = "Lượt hiện tại chưa ghi nhận event trong ứng dụng. Đây chỉ là trạng thái của lượt đang mở, không chứng minh người học chưa thực hành ở nơi khác.";
  } else if (missingEventTypes.length) {
    status = "partial-current-attempt-evidence";
    summary = "Lượt hiện tại đã ghi nhận một phần category kỳ vọng. Có thể tiếp tục thao tác rồi kiểm lại; đây không phải điểm số hay điều kiện chuyển bước.";
  } else {
    status = "expected-current-attempt-events-observed";
    summary = "Các category kỳ vọng đã được host báo trong đúng lượt/step hiện tại. Đây chỉ là bằng chứng tương tác trong ứng dụng, không phải mastery, giáo viên, phần cứng hay completion.";
  }
  return deepFreeze({
    sessionId: session.sessionId,
    revision: active.revision,
    lessonId: active.lessonId,
    stepIndex: active.stepIndex,
    checkpointId: active.checkpointId,
    checkpointKind: active.checkpointKind,
    lessonScope: active.lessonScope,
    status,
    eventCount: active.records.length,
    expectedEventTypes,
    observedEventTypes,
    matchingEventTypes,
    missingEventTypes,
    unexpectedEventTypes,
    summary,
    provenance: {
      checkpointSource: "practice-checkpoints.js",
      expectationSource: "practice-observation.js:editorial-expectation-only",
      eventSource: "host-reported-during-active-step-attempt",
      oldLessonJournalUsedAsStepProof: false,
    },
    claims: claims(),
  });
}

export function createPracticeStepAttemptSession() {
  sessionSerial += 1;
  return brandSession({
    version: VERSION,
    sessionId: "practice-step-session-" + sessionSerial,
    revision: 0,
    active: null,
  });
}

export function startPracticeStepAttempt(session, input) {
  requireSession(session);
  const source = requireExactDataRecord(input, START_KEYS, "startPracticeStepAttempt input");
  if (session.active) {
    throw new RangeError("Đã có practice step attempt active; hãy Thử lại hoặc Hủy trước khi bắt đầu lượt mới.");
  }
  const lesson = ownData(source, "lesson", "startPracticeStepAttempt input");
  const stepIndex = requireStepIndex(ownData(source, "stepIndex", "startPracticeStepAttempt input"));
  const context = checkpointContext(lesson, stepIndex);
  const revision = session.revision + 1;
  const token = tokenFor(session.sessionId, revision, context);
  return nextSession(session, {
    revision,
    active: activeFor(context, token),
  });
}

export function recordPracticeStepAttemptEvent(session, input) {
  requireSession(session);
  const source = requireExactDataRecord(input, RECORD_KEYS, "recordPracticeStepAttemptEvent input");
  const token = requireToken(ownData(source, "attemptToken", "recordPracticeStepAttemptEvent input"));
  const active = requireActiveToken(session, token);
  const lesson = ownData(source, "lesson", "recordPracticeStepAttemptEvent input");
  const stepIndex = requireStepIndex(ownData(source, "stepIndex", "recordPracticeStepAttemptEvent input"));
  requireCurrentContext(active, lesson, stepIndex);
  const eventType = ownData(source, "eventType", "recordPracticeStepAttemptEvent input");
  if (typeof eventType !== "string" || !EVENT_TYPE_SET.has(eventType)) {
    throw new RangeError("eventType không thuộc practice-observation allowlist.");
  }
  if (active.records.length >= MAX_RECORDS) {
    throw new RangeError("Practice step attempt đã đạt giới hạn " + MAX_RECORDS + " event records.");
  }
  const record = Object.freeze({
    lessonId: active.lessonId,
    stepIndex: active.stepIndex,
    checkpointId: active.checkpointId,
    revision: active.revision,
    eventType,
  });
  const context = checkpointContext(lesson, stepIndex);
  return nextSession(session, {
    active: activeFor(context, token, [...active.records, record], null),
  });
}

export function checkPracticeStepAttempt(session, input) {
  requireSession(session);
  const source = requireExactDataRecord(input, CONTEXT_OPERATION_KEYS, "checkPracticeStepAttempt input");
  const token = requireToken(ownData(source, "attemptToken", "checkPracticeStepAttempt input"));
  const active = requireActiveToken(session, token);
  const lesson = ownData(source, "lesson", "checkPracticeStepAttempt input");
  const stepIndex = requireStepIndex(ownData(source, "stepIndex", "checkPracticeStepAttempt input"));
  const context = requireCurrentContext(active, lesson, stepIndex);
  const review = reviewFor(session, active);
  return nextSession(session, {
    active: activeFor(context, token, [...active.records], review),
  });
}

export function retryPracticeStepAttempt(session, input) {
  requireSession(session);
  const source = requireExactDataRecord(input, CONTEXT_OPERATION_KEYS, "retryPracticeStepAttempt input");
  const token = requireToken(ownData(source, "attemptToken", "retryPracticeStepAttempt input"));
  const active = requireActiveToken(session, token);
  const lesson = ownData(source, "lesson", "retryPracticeStepAttempt input");
  const stepIndex = requireStepIndex(ownData(source, "stepIndex", "retryPracticeStepAttempt input"));
  const context = requireCurrentContext(active, lesson, stepIndex);
  const revision = session.revision + 1;
  const nextToken = tokenFor(session.sessionId, revision, context);
  return nextSession(session, {
    revision,
    active: activeFor(context, nextToken),
  });
}

export function cancelPracticeStepAttempt(session, input) {
  requireSession(session);
  const source = requireExactDataRecord(input, CANCEL_KEYS, "cancelPracticeStepAttempt input");
  const token = requireToken(ownData(source, "attemptToken", "cancelPracticeStepAttempt input"));
  requireActiveToken(session, token);
  return nextSession(session, {
    revision: session.revision + 1,
    active: null,
  });
}

export function inspectPracticeStepAttempt(session, input) {
  requireSession(session);
  const source = requireExactDataRecord(input, START_KEYS, "inspectPracticeStepAttempt input");
  const lesson = ownData(source, "lesson", "inspectPracticeStepAttempt input");
  const stepIndex = requireStepIndex(ownData(source, "stepIndex", "inspectPracticeStepAttempt input"));
  const context = checkpointContext(lesson, stepIndex);
  const active = session.active;
  if (!active) {
    return brandPracticeStepAttemptSnapshot({
      sessionId: session.sessionId,
      state: "idle",
      lessonId: context.lessonId,
      stepIndex: context.stepIndex,
      checkpointId: context.checkpointId,
      checkpointKind: context.checkpointKind,
      sourceStep: context.sourceStep,
      guidance: context.guidance,
      lessonScope: context.lessonScope,
      expectedEventTypes: [...context.expectedEventTypes],
      observedEventTypes: [],
      missingEventTypes: [...context.expectedEventTypes],
      unexpectedEventTypes: [],
      eventCount: 0,
      attemptToken: null,
      review: null,
      canStart: true,
      canCheck: false,
      canRetry: false,
      canCancel: false,
      claims: claims(),
    });
  }
  requireCurrentContext(active, lesson, stepIndex);
  const observedEventTypes = uniqueInOrder(active.records.map(record => record.eventType));
  const observed = new Set(observedEventTypes);
  return brandPracticeStepAttemptSnapshot({
    sessionId: session.sessionId,
    state: active.review ? "checked" : "active",
    lessonId: active.lessonId,
    stepIndex: active.stepIndex,
    checkpointId: active.checkpointId,
    checkpointKind: active.checkpointKind,
    sourceStep: active.sourceStep,
    guidance: active.guidance,
    lessonScope: active.lessonScope,
    expectedEventTypes: [...active.expectedEventTypes],
    observedEventTypes,
    missingEventTypes: active.expectedEventTypes.filter(eventType => !observed.has(eventType)),
    unexpectedEventTypes: observedEventTypes.filter(eventType => !active.expectedEventTypes.includes(eventType)),
    eventCount: active.records.length,
    attemptToken: active.token,
    review: active.review,
    canStart: false,
    canCheck: true,
    canRetry: true,
    canCancel: true,
    claims: claims(),
  });
}

function brandPracticeStepAttemptSnapshot(value){
  const snapshot=deepFreeze(value);
  ATTEMPT_SNAPSHOT_BRAND.add(snapshot);
  return snapshot;
}

export function requirePracticeStepAttemptSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=="object"||
     !Object.isFrozen(snapshot)||!ATTEMPT_SNAPSHOT_BRAND.has(snapshot)){
    throw new TypeError("Step attempt snapshot không có module/session provenance hợp lệ.");
  }
  return snapshot;
}
