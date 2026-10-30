/**
 * Pure primary next-action planning for the authored 48-step Practice flow.
 *
 * The builder validates exact checkpoint, attempt and evidence context, then
 * returns one bounded intent. It performs no navigation, focus, circuit,
 * progress, storage, simulation, Sketch, firmware or attempt mutation.
 */
import {
  createPracticeObservationJournal,
  inspectPracticeObservation,
} from "./practice-observation.js";
import { getPracticeCheckpoint } from "./practice-checkpoints.js";
import {
  PRACTICE_STEP_ATTEMPT_EVENT_TYPES,requirePracticeStepAttemptSnapshot,
} from "./practice-step-attempt.js";
import { requirePracticeEvidenceSnapshot } from "./practice-evidence.js";

const PLAN_BRAND = new WeakSet();
const EMPTY_OBSERVATION_JOURNAL = createPracticeObservationJournal();
const EVENT_TYPES = new Set(PRACTICE_STEP_ATTEMPT_EVENT_TYPES);
const STATES = new Set(["idle", "active", "checked"]);
const LESSON_SCOPES = new Set(["manual-only", "topology", "signal-only"]);
const REVIEW_STATES = new Set([
  "self-review-only-no-observable-expectation",
  "no-current-attempt-events",
  "partial-current-attempt-evidence",
  "expected-current-attempt-events-observed",
]);
const EVIDENCE_SCOPES = new Set(["manual", "topology", "signal-only"]);
const EVIDENCE_STATUSES = new Set([
  "manual-checkpoint",
  "not-attempted",
  "needs-correction",
  "incomplete",
  "topology-match",
  "signal-topology-match",
  "step-sample-match",
  "signal-step-match",
]);
const INPUT_KEYS = new Set(["lesson", "stepIndex", "attemptSnapshot", "evidence"]);
const ATTEMPT_KEYS = new Set([
  "sessionId", "state", "lessonId", "stepIndex", "checkpointId",
  "checkpointKind", "sourceStep", "guidance", "lessonScope",
  "expectedEventTypes", "observedEventTypes", "missingEventTypes",
  "unexpectedEventTypes", "eventCount", "attemptToken", "review",
  "canStart", "canCheck", "canRetry", "canCancel", "claims",
]);
const TOKEN_KEYS = new Set([
  "sessionId", "revision", "lessonId", "stepIndex", "checkpointId",
]);
const REVIEW_KEYS = new Set([
  "sessionId", "revision", "lessonId", "stepIndex", "checkpointId",
  "checkpointKind", "lessonScope", "status", "eventCount",
  "expectedEventTypes", "observedEventTypes", "matchingEventTypes",
  "missingEventTypes", "unexpectedEventTypes", "summary", "provenance", "claims",
]);

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

function action(id, label, kind, eventType = null) {
  return Object.freeze({ id, label, kind, eventType });
}

export const PRACTICE_GUIDED_TASK_EVENT_ACTIONS = deepFreeze({
  "view-3d": action("view-3d", "Mở mô hình 3D", "navigation", "view-3d"),
  "view-wiring": action("view-wiring", "Mở sơ đồ nối dây", "navigation", "view-wiring"),
  "view-pinout": action("view-pinout", "Mở sơ đồ chân", "navigation", "view-pinout"),
  "change-control": action("focus-control", "Tới điều khiển cần thao tác", "focus", "change-control"),
  "start-simulation": action("focus-run", "Tới nút Chạy mô phỏng", "focus", "start-simulation"),
  "edit-sketch": action("focus-sketch", "Tới vùng Sketch", "focus", "edit-sketch"),
  "connect-wire": action("focus-repair", "Tới công cụ sửa hoặc nối dây", "focus", "connect-wire"),
});

const START_ACTION = action("start", "Bắt đầu lượt thực hành", "attempt-start");
const CHECK_ACTION = action("focus-check", "Tới kiểm tra lượt hiện tại", "focus");
const RETRY_ACTION = action("focus-retry", "Tới Thử lại", "focus");
// Event-category coverage is not evidence that the complete authored
// instruction was performed. Navigation still requires a SECOND explicit
// activation of the existing coach Next control after learner self-review.
const NEXT_ACTION = action("focus-next", "Tới nút Bước tiếp (tự đối chiếu trước)", "focus");
const SELF_REVIEW_ACTION = action("self-review", "Tự đối chiếu bước này", "self-review");


function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}



function requirePlainRecord(value, label, frozen = false) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(label + " phải là plain object.");
  }
  if (frozen && !Object.isFrozen(value)) {
    throw new TypeError(label + " phải là frozen plain object.");
  }
  return value;
}

function requireExactDataRecord(value, allowed, label, frozen = false) {
  const source = requirePlainRecord(value, label, frozen);
  const keys = Reflect.ownKeys(source);
  if (keys.some(key => typeof key !== "string")) {
    throw new TypeError(label + " không nhận symbol key.");
  }
  const unknown = keys.filter(key => !allowed.has(key)).sort();
  if (unknown.length) {
    throw new RangeError(label + " có field không được hỗ trợ: " + unknown.join(", ") + ".");
  }
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
      throw new TypeError(label + " thiếu own data field: " + key + ".");
    }
  }
  return source;
}

function ownData(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
    throw new TypeError(label + " thiếu own data field: " + key + ".");
  }
  return descriptor.value;
}

function requireLessonSource(lesson) {
  const source = requirePlainRecord(lesson, "lesson");
  const lessonId = ownData(source, "id", "lesson");
  const steps = ownData(source, "steps", "lesson");
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
  return lessonId;
}

function requireStepIndex(stepIndex) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > 2) {
    throw new RangeError("stepIndex phải là số nguyên 0..2.");
  }
  return stepIndex;
}

function requireEventArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value) || value.length > EVENT_TYPES.size) {
    throw new TypeError(label + " phải là frozen Array event có giới hạn.");
  }
  const seen = new Set();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set ||
        typeof descriptor.value !== "string" || !EVENT_TYPES.has(descriptor.value) ||
        seen.has(descriptor.value)) {
      throw new TypeError(label + "[" + index + "] không thuộc event allowlist duy nhất.");
    }
    seen.add(descriptor.value);
    result.push(descriptor.value);
  }
  return result;
}

function requireBoundedAttemptClaims(claims, label = "attemptSnapshot.claims") {
  const source = requirePlainRecord(claims, label, true);
  const expected = {
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
  };
  for (const [key, value] of Object.entries(expected)) {
    if (ownData(source, key, label) !== value) {
      throw new RangeError(label + " vượt ranh giới: " + key + ".");
    }
  }
  return source;
}

function requireAttemptToken(token, snapshot) {
  const source = requireExactDataRecord(token, TOKEN_KEYS, "attemptSnapshot.attemptToken", true);
  if (source.sessionId !== snapshot.sessionId ||
      !Number.isSafeInteger(source.revision) || source.revision < 1 ||
      source.lessonId !== snapshot.lessonId ||
      source.stepIndex !== snapshot.stepIndex ||
      source.checkpointId !== snapshot.checkpointId) {
    throw new RangeError("attemptSnapshot.attemptToken không khớp current step identity.");
  }
  return source;
}

function expectedReviewStatus(expected, observed) {
  if (!expected.length) return "self-review-only-no-observable-expectation";
  if (!observed.length) return "no-current-attempt-events";
  const observedSet = new Set(observed);
  return expected.some(eventType => !observedSet.has(eventType))
    ? "partial-current-attempt-evidence"
    : "expected-current-attempt-events-observed";
}



function requireReview(review, snapshot, expected, observed, missing, unexpected) {
  const source = requireExactDataRecord(review, REVIEW_KEYS, "attemptSnapshot.review", true);
  const matching = requireEventArray(source.matchingEventTypes, "attemptSnapshot.review.matchingEventTypes");
  const reviewExpected = requireEventArray(source.expectedEventTypes, "attemptSnapshot.review.expectedEventTypes");
  const reviewObserved = requireEventArray(source.observedEventTypes, "attemptSnapshot.review.observedEventTypes");
  const reviewMissing = requireEventArray(source.missingEventTypes, "attemptSnapshot.review.missingEventTypes");
  const reviewUnexpected = requireEventArray(source.unexpectedEventTypes, "attemptSnapshot.review.unexpectedEventTypes");
  const observedSet = new Set(observed);
  const expectedMatching = expected.filter(eventType => observedSet.has(eventType));
  if (!REVIEW_STATES.has(source.status) ||
      source.status !== expectedReviewStatus(expected, observed) ||
      source.sessionId !== snapshot.sessionId ||
      source.lessonId !== snapshot.lessonId ||
      source.stepIndex !== snapshot.stepIndex ||
      source.checkpointId !== snapshot.checkpointId ||
      source.checkpointKind !== snapshot.checkpointKind ||
      source.lessonScope !== snapshot.lessonScope ||
      source.eventCount !== snapshot.eventCount ||
      !sameArray(reviewExpected, expected) ||
      !sameArray(reviewObserved, observed) ||
      !sameArray(reviewMissing, missing) ||
      !sameArray(reviewUnexpected, unexpected) ||
      !sameArray(matching, expectedMatching)) {
    throw new RangeError("attemptSnapshot.review không khớp current exact attempt projection.");
  }
  const provenance = requirePlainRecord(source.provenance, "attemptSnapshot.review.provenance", true);
  if (ownData(provenance, "checkpointSource", "attemptSnapshot.review.provenance") !== "practice-checkpoints.js" ||
      ownData(provenance, "expectationSource", "attemptSnapshot.review.provenance") !== "practice-observation.js:editorial-expectation-only" ||
      ownData(provenance, "eventSource", "attemptSnapshot.review.provenance") !== "host-reported-during-active-step-attempt" ||
      ownData(provenance, "oldLessonJournalUsedAsStepProof", "attemptSnapshot.review.provenance") !== false) {
    throw new RangeError("attemptSnapshot.review provenance không hợp lệ.");
  }
  requireBoundedAttemptClaims(source.claims, "attemptSnapshot.review.claims");
  return source;
}



function requireAttemptSnapshot(snapshot, checkpoint, canonicalExpected) {
  // Exact current-step identity is checked before selecting any action.
  requirePracticeStepAttemptSnapshot(snapshot);
  const source = requireExactDataRecord(snapshot, ATTEMPT_KEYS, "attemptSnapshot", true);
  if (!STATES.has(source.state) ||
      source.lessonId !== checkpoint.lessonId ||
      source.stepIndex !== checkpoint.stepIndex ||
      source.checkpointId !== checkpoint.id ||
      source.checkpointKind !== checkpoint.kind ||
      source.sourceStep !== checkpoint.sourceStep ||
      source.guidance !== checkpoint.guidance ||
      !LESSON_SCOPES.has(source.lessonScope) ||
      typeof source.sessionId !== "string" || !source.sessionId.trim() ||
      !Number.isInteger(source.eventCount) || source.eventCount < 0 || source.eventCount > 64) {
    throw new RangeError("attemptSnapshot không khớp current authored checkpoint.");
  }
  const expected = requireEventArray(source.expectedEventTypes, "attemptSnapshot.expectedEventTypes");
  const observed = requireEventArray(source.observedEventTypes, "attemptSnapshot.observedEventTypes");
  const missing = requireEventArray(source.missingEventTypes, "attemptSnapshot.missingEventTypes");
  const unexpected = requireEventArray(source.unexpectedEventTypes, "attemptSnapshot.unexpectedEventTypes");
  if (!sameArray(expected, canonicalExpected)) {
    throw new RangeError("attemptSnapshot.expectedEventTypes không khớp editorial expectation hiện hành.");
  }
  const observedSet = new Set(observed);
  const expectedMissing = expected.filter(eventType => !observedSet.has(eventType));
  const expectedUnexpected = observed.filter(eventType => !expected.includes(eventType));
  if (!sameArray(missing, expectedMissing) ||
      !sameArray(unexpected, expectedUnexpected) ||
      source.eventCount < observed.length) {
    throw new RangeError("attemptSnapshot event projection không nhất quán.");
  }


  requireBoundedAttemptClaims(source.claims);
  if (source.state === "idle") {
    if (source.attemptToken !== null || source.review !== null ||
        source.canStart !== true || source.canCheck !== false ||
        source.canRetry !== false || source.canCancel !== false ||
        source.eventCount !== 0 || observed.length !== 0) {
      throw new RangeError("Idle step attempt không được chứa bằng chứng hoặc quyền Check.");
    }
  } else {
    requireAttemptToken(source.attemptToken, source);
    if (source.canStart !== false || source.canCheck !== true ||
        source.canRetry !== true || source.canCancel !== true) {
      throw new RangeError("Active step attempt có action flags không hợp lệ.");
    }
    if (source.state === "checked") {
      requireReview(source.review, source, expected, observed, missing, unexpected);
    } else if (source.review !== null) {
      throw new RangeError("Active attempt chưa Check không thể có review.");
    }
  }
  return Object.freeze({
    state:source.state,lessonScope:source.lessonScope,
    expected:Object.freeze(expected),observed:Object.freeze(observed),
    missing:Object.freeze(missing),unexpected:Object.freeze(unexpected),
    eventCount:source.eventCount,reviewStatus:source.review?.status??null,
  });
}

function requireEvidence(evidence, checkpoint) {
  // Reject forged topology/match and nested accessor objects before even
  // reading their fields. Only the canonical circuit-router inspection module
  // can mint this exact runtime WeakSet-branded evidence object.
  requirePracticeEvidenceSnapshot(evidence);
  const source = requirePlainRecord(evidence, "evidence", true);
  const embedded = ownData(source, "checkpoint", "evidence");
  if (ownData(source, "lessonId", "evidence") !== checkpoint.lessonId ||
      ownData(source, "stepIndex", "evidence") !== checkpoint.stepIndex ||
      !EVIDENCE_SCOPES.has(ownData(source, "scope", "evidence")) ||
      !EVIDENCE_STATUSES.has(ownData(source, "status", "evidence")) ||
      !embedded || typeof embedded !== "object" || !Object.isFrozen(embedded) ||
      embedded.id !== checkpoint.id || embedded.sourceStep !== checkpoint.sourceStep ||
      embedded.kind !== checkpoint.kind || embedded.lessonId !== checkpoint.lessonId ||
      embedded.stepIndex !== checkpoint.stepIndex) {
    throw new RangeError("Evidence không thuộc authored checkpoint hiện tại.");
  }
  const claims = ownData(source, "claims", "evidence");
  if (!claims || !Object.isFrozen(claims) ||
      claims.teacherValidated !== false || claims.physicalVerified !== false ||
      claims.mastery !== false || claims.autoCompletion !== false ||
      claims.lessonCompleted !== false || claims.sampleCopiedDoesNotProveAction !== true) {
    throw new RangeError("Evidence vượt giới hạn xác minh người học/phần cứng.");
  }
  const summary=ownData(source,"summary","evidence");
  if(typeof summary!=="string"||summary.length>2000){
    throw new TypeError("Evidence summary không hợp lệ.");
  }
  return Object.freeze({scope:source.scope,status:source.status,summary});
}

/**
 * Build one current, non-authoritative ACTION -> DO -> CHECK direction.
 * A view CTA counts only if the learner actually navigates there; focus CTAs
 * never stand in for pressing Run, changing a control or connecting a wire.
 */
export function buildPracticeGuidedTaskPlan(input) {
  const source=requireExactDataRecord(input,INPUT_KEYS,"guided task input");
  const lesson=ownData(source,"lesson","guided task input");
  const lessonId=requireLessonSource(lesson);
  const stepIndex=requireStepIndex(ownData(source,"stepIndex","guided task input"));
  const checkpoint=getPracticeCheckpoint(lesson,stepIndex);
  if(checkpoint.sourceStep!==lesson.steps[stepIndex]||
     checkpoint.lessonId!==lessonId||checkpoint.stepIndex!==stepIndex){
    throw new RangeError("Source checkpoint khác lesson.steps hiện tại.");
  }
  const observation=inspectPracticeObservation({
    lesson,stepIndex,journal:EMPTY_OBSERVATION_JOURNAL,
  });
  if(observation.checkpointId!==checkpoint.id||
     observation.sourceStep!==checkpoint.sourceStep){
    throw new RangeError("Editorial observation khác authored checkpoint.");
  }
  const expectation=Object.freeze([...observation.expectedEventTypes]);
  const attempt=requireAttemptSnapshot(
    ownData(source,"attemptSnapshot","guided task input"),checkpoint,expectation,
  );
  const evidence=requireEvidence(
    ownData(source,"evidence","guided task input"),checkpoint,
  );
  let chosen;
  if(attempt.state==="idle")chosen=START_ACTION;
  else if(expectation.length===0)chosen=SELF_REVIEW_ACTION;
  else if(attempt.state==="checked"){
    chosen=attempt.reviewStatus==="expected-current-attempt-events-observed"
      ?(stepIndex<2?NEXT_ACTION:SELF_REVIEW_ACTION)
      :RETRY_ACTION;
  } else if(attempt.missing.length){
    chosen=PRACTICE_GUIDED_TASK_EVENT_ACTIONS[attempt.missing[0]];
  } else chosen=CHECK_ACTION;
  if(!chosen)throw new RangeError("Current editorial event không có UI intent an toàn.");
  const plan=deepFreeze({
    lessonId,stepIndex,checkpointId:checkpoint.id,
    checkpointKind:checkpoint.kind,sourceStep:checkpoint.sourceStep,
    guidance:checkpoint.guidance,lessonScope:attempt.lessonScope,
    attemptState:attempt.state,reviewStatus:attempt.reviewStatus,
    expectedEventTypes:[...expectation],observedEventTypes:[...attempt.observed],
    missingEventTypes:[...attempt.missing],
    evidenceStatus:evidence.status,evidenceScope:evidence.scope,
    evidenceSummary:evidence.summary,
    action:chosen,
    claims:{origin:"authored-checkpoint-guided-navigation",sessionOnly:true,
      learnerActionProven:false,physicalVerified:false,electricalAuthority:false,
      firmwareExecuted:false,mastery:false,teacherValidated:false,
      lessonCompleted:false,autoCompletion:false,prerequisiteForAdvance:false},
  });
  PLAN_BRAND.add(plan);
  return plan;
}

/** Accept only a model produced by this module's current runtime. */
export function inspectPracticeGuidedTaskPlan(plan) {
  if(!plan||typeof plan!=="object"||!PLAN_BRAND.has(plan)||!Object.isFrozen(plan)){
    throw new TypeError("Guided task plan không có provenance module hợp lệ.");
  }
  return plan;
}
