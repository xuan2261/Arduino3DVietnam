/**
 * Read-only authored-checkpoint trail for one lesson (3 steps).
 *
 * The trail binds the 48 existing practice-checkpoints to a caller-supplied
 * canonical learner circuit. It never creates learner wires, copies a sample
 * circuit into learner state, records progress, advances a step, or upgrades
 * topology evidence into mastery/teacher/physical claims.
 */
import {
  analyzeCircuit,
  createCircuit,
  supportedWiringLessons,
} from "./circuit-router.js";
import { listPracticeCheckpoints } from "./practice-checkpoints.js";

export const PRACTICE_CHECKPOINT_TRAIL_LIMITS = Object.freeze({
  lessonCount: 16,
  stepsPerLesson: 3,
  totalCheckpoints: 48,
  maxWires: 48,
  maxRequiredPairsPerStep: 16,
});

const INPUT_KEYS = Object.freeze(["circuit", "currentStepIndex", "lesson"]);
const WIRE_KEYS = Object.freeze(["from", "id", "to"]);
const ROUTER_LESSONS = Object.freeze(supportedWiringLessons());
const EXPECTED_ROUTER_LESSONS = Object.freeze(
  Array.from({ length: 15 }, (_unused, index) => index + 2),
);

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

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

function dataProperty(record, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(label + "." + key + " phải là own data property.");
  }
  return descriptor.value;
}

function ownNames(record) {
  return Object.getOwnPropertyNames(record).sort();
}

function requireExactOwnKeys(record, expected, label) {
  const actual = ownNames(record);
  const wanted = [...expected].sort();
  if (actual.join("\u0001") !== wanted.join("\u0001")) {
    throw new RangeError(label + " có field không đúng canonical shape.");
  }
}

function assertRouterCoverage() {
  if (
    ROUTER_LESSONS.length !== EXPECTED_ROUTER_LESSONS.length ||
    ROUTER_LESSONS.some((value, index) => value !== EXPECTED_ROUTER_LESSONS[index])
  ) {
    throw new Error("practice checkpoint trail yêu cầu circuit-router hỗ trợ lessons 2..16.");
  }
}

assertRouterCoverage();

function requireInput(input) {
  const source = requirePlainRecord(input, "practice checkpoint trail input");
  requireExactOwnKeys(source, INPUT_KEYS, "practice checkpoint trail input");
  return source;
}

function requireLesson(lesson) {
  const source = requirePlainRecord(lesson, "lesson");
  const lessonId = dataProperty(source, "id", "lesson");
  const steps = dataProperty(source, "steps", "lesson");
  if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > PRACTICE_CHECKPOINT_TRAIL_LIMITS.lessonCount) {
    throw new RangeError("lesson.id phải là số nguyên 1..16.");
  }
  requirePlainArray(steps, "lesson.steps");
  if (steps.length !== PRACTICE_CHECKPOINT_TRAIL_LIMITS.stepsPerLesson) {
    throw new RangeError("lesson.steps phải có đúng 3 bước authored.");
  }
  for (let index = 0; index < steps.length; index += 1) {
    if (typeof steps[index] !== "string" || !steps[index].trim()) {
      throw new TypeError("lesson.steps[" + index + "] phải là chuỗi nguồn không rỗng.");
    }
  }
  const checkpoints = listPracticeCheckpoints(source);
  if (checkpoints.length !== PRACTICE_CHECKPOINT_TRAIL_LIMITS.stepsPerLesson) {
    throw new RangeError("authored checkpoint registry phải có đúng 3 bước cho lesson.");
  }
  return Object.freeze({ lessonId, checkpoints });
}

function requireStepIndex(value) {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value >= PRACTICE_CHECKPOINT_TRAIL_LIMITS.stepsPerLesson
  ) {
    throw new RangeError("currentStepIndex phải là số nguyên 0..2.");
  }
  return value;
}

function pairKey(from, to) {
  return from < to ? from + "\u0000" + to : to + "\u0000" + from;
}

function validateLearnerCircuit(circuit, lessonId) {
  if (lessonId === 1) {
    if (circuit !== null) {
      throw new RangeError("Lesson 1 không có learner circuit ngoài bo; circuit phải là null.");
    }
    return Object.freeze({ pairKeys: new Set(), scope: "manual-only" });
  }

  const source = requirePlainRecord(circuit, "circuit");
  const canonicalEmpty = createCircuit(lessonId);
  requireExactOwnKeys(source, ownNames(canonicalEmpty), "circuit");

  const version = dataProperty(source, "version", "circuit");
  const stateLessonId = dataProperty(source, "lessonId", "circuit");
  const supported = dataProperty(source, "supported", "circuit");
  const wires = dataProperty(source, "wires", "circuit");
  const nextWireId = dataProperty(source, "nextWireId", "circuit");
  if (version !== 1 || stateLessonId !== lessonId || supported !== true) {
    throw new RangeError("circuit không phải canonical learner graph của lesson hiện tại.");
  }
  if (Object.prototype.hasOwnProperty.call(canonicalEmpty, "engine")) {
    if (dataProperty(source, "engine", "circuit") !== canonicalEmpty.engine) {
      throw new RangeError("circuit.engine không khớp canonical circuit-router.");
    }
  }
  requirePlainArray(wires, "circuit.wires");
  if (wires.length > PRACTICE_CHECKPOINT_TRAIL_LIMITS.maxWires) {
    throw new RangeError("circuit vượt giới hạn 48 learner wires.");
  }
  if (!Number.isInteger(nextWireId) || nextWireId < 1) {
    throw new TypeError("circuit.nextWireId không hợp lệ.");
  }

  for (let index = 0; index < wires.length; index += 1) {
    const wire = requirePlainRecord(wires[index], "circuit.wires[" + index + "]");
    requireExactOwnKeys(wire, WIRE_KEYS, "circuit.wires[" + index + "]");
    const id = dataProperty(wire, "id", "circuit.wires[" + index + "]");
    const from = dataProperty(wire, "from", "circuit.wires[" + index + "]");
    const to = dataProperty(wire, "to", "circuit.wires[" + index + "]");
    if (
      typeof id !== "string" || !/^w[1-9][0-9]*$/.test(id) ||
      typeof from !== "string" || !from ||
      typeof to !== "string" || !to
    ) {
      throw new TypeError("circuit.wires[" + index + "] có id/from/to không hợp lệ.");
    }
  }

  // analyzeCircuit is the canonical router validator. No sample circuit is
  // created here: only the caller-supplied learner graph is validated/read.
  const analysis = analyzeCircuit(lessonId, source);
  if (
    analysis.lessonId !== lessonId ||
    analysis.supported !== true ||
    Number(analysis?.stats?.wireCount) !== wires.length
  ) {
    throw new RangeError("circuit-router analysis không khớp learner graph đã cung cấp.");
  }
  const signalOnly = analysis.scope === "signal-only";
  if (signalOnly !== (lessonId === 10 || lessonId === 14)) {
    throw new RangeError("signal-only scope không khớp lesson contract 10/14.");
  }
  if (signalOnly && (analysis.functional !== false || analysis.ok !== false)) {
    throw new RangeError("signal-only lesson không được nâng thành functional/ok.");
  }

  return Object.freeze({
    pairKeys: new Set(wires.map(wire => pairKey(wire.from, wire.to))),
    scope: signalOnly ? "signal-only" : "topology",
  });
}

function stepClaims(signalOnly, manual) {
  return Object.freeze({
    automaticallyAssessed: false,
    autoCompletion: false,
    learnerActionProven: false,
    mastery: false,
    mutationPerformed: false,
    physicalVerified: false,
    prerequisiteForAdvance: false,
    progressTracked: false,
    signalOnly,
    teacherValidated: false,
    authoredPairEvidence: !manual,
  });
}

function buildStep(checkpoint, currentStepIndex, pairKeys, lessonScope) {
  const signalOnly = lessonScope === "signal-only";
  const base = {
    id: checkpoint.id,
    lessonId: checkpoint.lessonId,
    stepIndex: checkpoint.stepIndex,
    current: checkpoint.stepIndex === currentStepIndex,
    kind: checkpoint.kind,
    sourceGoal: checkpoint.sourceStep,
    sourceHint: checkpoint.guidance,
    sourceScheme: checkpoint.provenance.scheme,
    sourceName: checkpoint.provenance.source,
  };

  if (checkpoint.kind === "manual") {
    return deepFreeze({
      ...base,
      scope: "manual",
      evidenceStatus: "manual-not-automatically-assessed",
      requiredPairCount: 0,
      committedPairCount: 0,
      missingPairCount: 0,
      pairs: [],
      evidenceNote:
        "Checkpoint thủ công không được tự động đánh giá; chỉ hiển thị mục tiêu/gợi ý từ nguồn bước học, không xác nhận mastery, giáo viên hay phần cứng.",
      claims: stepClaims(signalOnly, true),
    });
  }
  if (checkpoint.kind !== "wiring") {
    throw new RangeError(checkpoint.id + " có checkpoint kind không được hỗ trợ.");
  }
  if (
    !Array.isArray(checkpoint.requiredPairs) ||
    checkpoint.requiredPairs.length < 1 ||
    checkpoint.requiredPairs.length > PRACTICE_CHECKPOINT_TRAIL_LIMITS.maxRequiredPairsPerStep
  ) {
    throw new RangeError(checkpoint.id + " có requiredPairs ngoài giới hạn trail.");
  }

  const pairs = checkpoint.requiredPairs.map((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") {
      throw new TypeError(checkpoint.id + " requiredPairs[" + index + "] không hợp lệ.");
    }
    const status = pairKeys.has(pairKey(pair[0], pair[1])) ? "committed" : "missing";
    return Object.freeze({
      order: index + 1,
      pair: Object.freeze([pair[0], pair[1]]),
      status,
    });
  });
  const committedPairCount = pairs.filter(pair => pair.status === "committed").length;
  const missingPairCount = pairs.length - committedPairCount;
  return deepFreeze({
    ...base,
    scope: lessonScope,
    evidenceStatus: missingPairCount ? "authored-pairs-missing" : "authored-pairs-present",
    requiredPairCount: pairs.length,
    committedPairCount,
    missingPairCount,
    pairs,
    evidenceNote: signalOnly
      ? "Trạng thái chỉ đối chiếu edge tín hiệu/GND authored trong learner graph; nguồn/tải/chức năng phần cứng, mastery và xác nhận giáo viên vẫn ngoài phạm vi."
      : "Trạng thái chỉ cho biết edge authored có hiện diện trong canonical learner graph; không chứng minh thao tác, mastery, xác nhận giáo viên, phần cứng hay hoàn thành bài.",
    claims: stepClaims(signalOnly, false),
  });
}

/**
 * Build a read-only trail for the current lesson.
 *
 * Input signature:
 *   { lesson, currentStepIndex, circuit }
 * Lesson 1 requires circuit === null. Lessons 2..16 require the caller's
 * canonical learner circuit state, which is validated through circuit-router.
 */
export function buildPracticeCheckpointTrail(input) {
  const source = requireInput(input);
  const { lessonId, checkpoints } = requireLesson(dataProperty(source, "lesson", "practice checkpoint trail input"));
  const currentStepIndex = requireStepIndex(
    dataProperty(source, "currentStepIndex", "practice checkpoint trail input"),
  );
  const circuit = dataProperty(source, "circuit", "practice checkpoint trail input");
  const learner = validateLearnerCircuit(circuit, lessonId);
  const steps = checkpoints.map(checkpoint =>
    buildStep(checkpoint, currentStepIndex, learner.pairKeys, learner.scope));

  return deepFreeze({
    lessonId,
    lessonScope: learner.scope,
    currentStepIndex,
    stepCount: steps.length,
    previousStepIndex: currentStepIndex > 0 ? currentStepIndex - 1 : null,
    nextStepIndex: currentStepIndex < steps.length - 1 ? currentStepIndex + 1 : null,
    steps,
    claims: {
      source: "practice-checkpoints.js",
      sourceScheme: "human-authored-from-lesson-text",
      circuitAuthority: lessonId === 1 ? "none-external" : "circuit-router",
      learnerGraphSuppliedByCaller: lessonId !== 1,
      sampleInjectedIntoLearner: false,
      progressTracked: false,
      mutationPerformed: false,
      autoCompletion: false,
      mastery: false,
      teacherValidated: false,
      physicalVerified: false,
      signalOnly: learner.scope === "signal-only",
    },
  });
}
