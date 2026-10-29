/**
 * Pure, deterministic, bounded learner-practice evidence for lesson wiring.
 *
 * This module compares the canonical learner graph against the explicit
 * circuit-router reference sample. It never infers physical placement,
 * current/voltage, actual learner actions, mastery, or lesson completion.
 */
import {
  analyzeCircuit,
  createSampleCircuit,
  listTerminals,
  supportedWiringLessons,
} from "./circuit-router.js";
import { getPracticeCheckpoint } from "./practice-checkpoints.js";
import { inspectPracticeWireGuidance } from "./practice-wire-guidance.js";

const MAX_WIRES = 64;
const MAX_ISSUES = 32;
const MAX_PATHS = 32;
const MAX_STEPS = 16;
const INPUT_KEYS = new Set([
  "lesson",
  "stepIndex",
  "circuit",
  "referenceCircuit",
  "analysis",
  "hasLearnerDraft",
]);
const CIRCUIT_KEYS = new Set([
  "version",
  "engine",
  "lessonId",
  "supported",
  "wires",
  "nextWireId",
]);
const WIRE_KEYS = new Set(["id", "from", "to"]);
const WIRE_ID_RE = /^w[1-9][0-9]*$/;

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

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extras(record, allowed) {
  return Object.keys(record).filter(key => !allowed.has(key)).sort();
}

function requireInput(input) {
  if (!isRecord(input)) throw new TypeError("practice evidence input phải là object.");
  const unknown = extras(input, INPUT_KEYS);
  if (unknown.length) {
    throw new RangeError("Practice evidence có field không được hỗ trợ: " + unknown.join(", ") + ".");
  }
  return input;
}

function requireLesson(lesson) {
  if (!isRecord(lesson)) throw new TypeError("lesson phải là object dữ liệu bài học.");
  if (!Number.isInteger(lesson.id) || lesson.id < 1 || lesson.id > 16) {
    throw new RangeError("lesson.id phải là số nguyên 1..16.");
  }
  if (
    !Array.isArray(lesson.steps) ||
    lesson.steps.length < 1 ||
    lesson.steps.length > MAX_STEPS ||
    lesson.steps.some(step => typeof step !== "string" || !step.trim())
  ) {
    throw new TypeError("lesson.steps phải là mảng bước học không rỗng và có giới hạn.");
  }
  return lesson;
}

function requireStepIndex(stepIndex, lesson) {
  if (
    !Number.isInteger(stepIndex) ||
    stepIndex < 0 ||
    stepIndex >= lesson.steps.length
  ) {
    throw new RangeError("stepIndex phải thuộc lesson.steps.");
  }
  return stepIndex;
}

function pairKey(a, b) {
  return a < b ? a + "\u0000" + b : b + "\u0000" + a;
}

function pairValue(a, b) {
  return Object.freeze(a < b ? [a, b] : [b, a]);
}

function normalizeCircuit(circuit, lessonId, terminalIds, label, expectedEngine) {
  if (!isRecord(circuit)) throw new TypeError(label + " phải là circuit object.");
  const unknown = extras(circuit, CIRCUIT_KEYS);
  if (unknown.length) {
    throw new RangeError(label + " có field không thuộc canonical circuit: " + unknown.join(", ") + ".");
  }
  if (
    circuit.version !== 1 ||
    Number(circuit.lessonId) !== lessonId ||
    circuit.supported !== true ||
    !Array.isArray(circuit.wires)
  ) {
    throw new RangeError(label + " không phải canonical circuit của lesson hiện tại.");
  }
  if ((circuit.engine ?? null) !== expectedEngine) {
    throw new RangeError(label + " có engine marker không khớp canonical router.");
  }
  if (circuit.wires.length > MAX_WIRES) {
    throw new RangeError(label + " vượt giới hạn " + MAX_WIRES + " dây.");
  }
  if (!Number.isInteger(circuit.nextWireId) || circuit.nextWireId < 1) {
    throw new RangeError(label + ".nextWireId không hợp lệ.");
  }

  const ids = new Set();
  const pairs = new Set();
  let maxWireNumber = 0;
  const normalized = [];
  for (let index = 0; index < circuit.wires.length; index += 1) {
    const wire = circuit.wires[index];
    if (!isRecord(wire)) throw new TypeError(label + ".wires[" + index + "] phải là object.");
    const wireExtras = extras(wire, WIRE_KEYS);
    if (wireExtras.length) {
      throw new RangeError(
        label + ".wires[" + index + "] có field không canonical: " + wireExtras.join(", ") + ".",
      );
    }
    if (
      typeof wire.id !== "string" ||
      !WIRE_ID_RE.test(wire.id) ||
      typeof wire.from !== "string" ||
      typeof wire.to !== "string"
    ) {
      throw new TypeError(label + ".wires[" + index + "] có id/from/to không hợp lệ.");
    }
    if (!terminalIds.has(wire.from) || !terminalIds.has(wire.to)) {
      throw new RangeError(label + " chứa terminal ngoài lesson: " + wire.from + " / " + wire.to + ".");
    }
    if (wire.from === wire.to) {
      throw new RangeError(label + " chứa self-edge không canonical: " + wire.id + ".");
    }
    if (ids.has(wire.id)) throw new RangeError(label + " chứa wire id trùng: " + wire.id + ".");
    ids.add(wire.id);
    const key = pairKey(wire.from, wire.to);
    if (pairs.has(key)) {
      throw new RangeError(label + " chứa duplicate unordered edge: " + wire.from + " / " + wire.to + ".");
    }
    pairs.add(key);
    maxWireNumber = Math.max(maxWireNumber, Number(wire.id.slice(1)));
    normalized.push(Object.freeze({
      id: wire.id,
      from: wire.from,
      to: wire.to,
      key,
      pair: pairValue(wire.from, wire.to),
    }));
  }
  if (circuit.nextWireId <= maxWireNumber) {
    throw new RangeError(label + ".nextWireId không thể thấp hơn wire id hiện có.");
  }
  return Object.freeze({
    wires: Object.freeze(normalized),
    pairKeys: Object.freeze(new Set(pairs)),
  });
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function issueFingerprint(issues) {
  if (!Array.isArray(issues) || issues.length > MAX_ISSUES) {
    throw new RangeError("analysis.issues không hợp lệ hoặc vượt giới hạn.");
  }
  return issues.map((item, index) => {
    if (!isRecord(item) || typeof item.code !== "string" || typeof item.severity !== "string") {
      throw new TypeError("analysis.issues[" + index + "] không hợp lệ.");
    }
    const terminals = Array.isArray(item.terminals)
      ? item.terminals.filter(value => typeof value === "string").sort()
      : [];
    return item.code + "|" + item.severity + "|" + terminals.join(",");
  }).sort();
}

function pathFingerprint(paths) {
  if (!Array.isArray(paths) || paths.length > MAX_PATHS) {
    throw new RangeError("analysis.paths không hợp lệ hoặc vượt giới hạn.");
  }
  return paths.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.complete !== "boolean") {
      throw new TypeError("analysis.paths[" + index + "] không hợp lệ.");
    }
    return item.id + "|" + String(item.complete);
  }).sort();
}

function requireAnalysis(analysis, lessonId, circuit) {
  if (!isRecord(analysis)) throw new TypeError("analysis phải là circuit-router analysis object.");
  if (Number(analysis.lessonId) !== lessonId) {
    throw new RangeError("analysis thuộc lesson khác.");
  }
  const actual = analyzeCircuit(lessonId, circuit);
  const scalarKeys = ["supported", "ok", "functional"];
  for (const key of scalarKeys) {
    if (analysis[key] !== actual[key]) throw new RangeError("analysis không khớp canonical " + key + ".");
  }
  const optionalKeys = ["scope", "signalPathsComplete"];
  for (const key of optionalKeys) {
    if ((analysis[key] ?? null) !== (actual[key] ?? null)) {
      throw new RangeError("analysis không khớp canonical " + key + ".");
    }
  }
  if (
    Number(analysis?.stats?.wireCount) !== Number(actual?.stats?.wireCount) ||
    issueFingerprint(analysis.issues).join("\u0001") !== issueFingerprint(actual.issues).join("\u0001") ||
    pathFingerprint(analysis.paths).join("\u0001") !== pathFingerprint(actual.paths).join("\u0001")
  ) {
    throw new RangeError("analysis không khớp canonical circuit-router result.");
  }
  return actual;
}

function normalizeIssues(analysis) {
  return Object.freeze(analysis.issues.slice(0, MAX_ISSUES).map(item => Object.freeze({
    code: String(item.code || "UNKNOWN"),
    severity: ["error", "warning", "info"].includes(item.severity) ? item.severity : "warning",
    message: typeof item.message === "string" ? item.message : "",
    terminals: Object.freeze(
      Array.isArray(item.terminals)
        ? item.terminals.filter(value => typeof value === "string").slice(0, 16)
        : [],
    ),
  })));
}

function claims(scope, checkpoint, signalOnly = false) {
  return Object.freeze({
    origin: "learner-circuit-vs-reference-sample",
    electricalAuthority: "circuit-router",
    sampleEdgeGrouping: "human-authored-step-checkpoint",
    checkpointEditorialProvenance: checkpoint.provenance.scheme,
    checkpointKind: checkpoint.kind,
    sampleGroupingPedagogyVerified: false,
    teacherValidated: false,
    checkpointPrerequisiteForAdvance: false,
    sampleCopiedDoesNotProveAction: true,
    learnerActionProven: false,
    physicalVerified: false,
    measured: false,
    mastery: false,
    autoCompletion: false,
    lessonCompleted: false,
    functionalHardware: false,
    signalOnly: signalOnly || scope === "signal-only",
  });
}

function result(value) {
  return deepFreeze(value);
}

function manualEvidence(lesson, stepIndex, checkpoint, wireGuidance, signalOnly = false) {
  return result({
    lessonId: lesson.id,
    stepIndex,
    scope: "manual",
    status: "manual-checkpoint",
    matched: 0,
    required: 0,
    missingPairs: [],
    extraPairs: [],
    issues: [],
    summary: "Checkpoint này được biên tập là bước quan sát/mô phỏng; không gán yêu cầu netlist cho bước hiện tại.",
    nextAction: checkpoint.guidance,
    guidance: checkpoint.guidance,
    checkpoint,
    wireGuidance,
    claims: claims("manual", checkpoint, signalOnly),
  });
}

/**
 * Inspect step-specific learner wiring evidence.
 *
 * The result is evidence of agreement with human-authored step checkpoints
 * bounded to edges in the circuit-router sample. Editorial mapping is not
 * teacher validation and is never evidence that the learner physically
 * performed the action, mastered the lesson, or built a real circuit.
 */
export function inspectPracticeEvidence(input) {
  const source = requireInput(input);
  const lesson = requireLesson(source.lesson);
  const stepIndex = requireStepIndex(source.stepIndex, lesson);
  const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
  if (typeof source.hasLearnerDraft !== "boolean") {
    throw new TypeError("hasLearnerDraft phải là boolean.");
  }

  if (lesson.id === 1) {
    if (
      source.circuit != null ||
      source.referenceCircuit != null ||
      source.analysis != null ||
      source.hasLearnerDraft
    ) {
      throw new RangeError("Bài 01 không có external wiring evidence.");
    }
    return manualEvidence(
      lesson,
      stepIndex,
      checkpoint,
      inspectPracticeWireGuidance({ lesson, stepIndex, circuit: null }),
    );
  }

  if (!supportedWiringLessons().includes(lesson.id)) {
    throw new RangeError("Lesson này chưa có canonical circuit-router evidence.");
  }
  const terminals = listTerminals(lesson.id);
  const terminalIds = new Set(terminals.map(item => item.id));
  if (!terminalIds.size || terminalIds.size !== terminals.length) {
    throw new RangeError("Canonical terminal list không hợp lệ.");
  }

  const canonicalReferenceCircuit = createSampleCircuit(lesson.id);
  const expectedEngine = canonicalReferenceCircuit.engine ?? null;
  const learner = normalizeCircuit(
    source.circuit,
    lesson.id,
    terminalIds,
    "circuit",
    expectedEngine,
  );
  const suppliedReference = normalizeCircuit(
    source.referenceCircuit,
    lesson.id,
    terminalIds,
    "referenceCircuit",
    expectedEngine,
  );
  const canonicalReference = normalizeCircuit(
    canonicalReferenceCircuit,
    lesson.id,
    terminalIds,
    "canonicalReference",
    expectedEngine,
  );
  if (!sameSet(suppliedReference.pairKeys, canonicalReference.pairKeys)) {
    throw new RangeError("referenceCircuit không khớp createSampleCircuit() của lesson.");
  }
  if (!source.hasLearnerDraft && learner.wires.length !== 0) {
    throw new RangeError("hasLearnerDraft=false nhưng circuit chứa learner wires.");
  }

  const canonicalAnalysis = requireAnalysis(source.analysis, lesson.id, source.circuit);
  const circuitScope = canonicalAnalysis.scope === "signal-only" ? "signal-only" : "topology";
  if (checkpoint.kind === "manual") {
    return manualEvidence(
      lesson,
      stepIndex,
      checkpoint,
      inspectPracticeWireGuidance({ lesson, stepIndex, circuit: source.circuit }),
      circuitScope === "signal-only",
    );
  }

  const referenceByKey = new Map(canonicalReference.wires.map(wire => [wire.key, wire]));
  const requiredWires = checkpoint.requiredPairs.map(pair => {
    const wire = referenceByKey.get(pairKey(pair[0], pair[1]));
    if (!wire) {
      throw new RangeError("Authored checkpoint chứa edge không thuộc canonical reference sample.");
    }
    return wire;
  });
  const requiredKeys = new Set(requiredWires.map(wire => wire.key));
  const matched = requiredWires.filter(wire => learner.pairKeys.has(wire.key)).length;
  const missingPairs = requiredWires
    .filter(wire => !learner.pairKeys.has(wire.key))
    .map(wire => wire.pair);
  const extraPairs = learner.wires
    .filter(wire => !canonicalReference.pairKeys.has(wire.key))
    .map(wire => wire.pair)
    .sort((left, right) => {
      const a = left.join("\u0000");
      const b = right.join("\u0000");
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const analysisIssues = normalizeIssues(canonicalAnalysis);
  const hasError = analysisIssues.some(item => item.severity === "error");
  const fullReferenceMatch =
    learner.pairKeys.size === canonicalReference.pairKeys.size &&
    sameSet(learner.pairKeys, canonicalReference.pairKeys);

  let status;
  let summary;
  let nextAction;
  if (!source.hasLearnerDraft) {
    status = "not-attempted";
    summary = "Ứng dụng chưa ghi nhận bản tự đấu trong phiên hiện tại; checkpoint chỉ là ánh xạ biên tập từ nội dung bước sang reference sample và không chứng minh người học chưa thao tác ở nơi khác.";
    nextAction = checkpoint.guidance;
  } else if (extraPairs.length || hasError) {
    status = "needs-correction";
    summary = "Bản tự đấu có edge ngoài sample hoặc issue mức lỗi khi đối chiếu với canonical circuit-router; đây không phải đánh giá mastery hay xác nhận của giáo viên.";
    nextAction = extraPairs.length
      ? "Gỡ/đối chiếu các edge không thuộc sample trước khi kiểm tra lại."
      : (analysisIssues.find(item => item.severity === "error")?.message || checkpoint.guidance);
  } else if (missingPairs.length) {
    status = "incomplete";
    summary = "Bản tự đấu chưa khớp đủ các reference edge được biên tập cho bước này; checkpoint không phải điều kiện để chuyển bước.";
    nextAction = checkpoint.guidance;
  } else if (fullReferenceMatch) {
    status = circuitScope === "signal-only" ? "signal-topology-match" : "topology-match";
    summary = circuitScope === "signal-only"
      ? "Bản tự đấu khớp toàn bộ sample tín hiệu/GND; nguồn công suất/tải, xác nhận giáo viên và phần cứng thật vẫn ngoài phạm vi."
      : "Bản tự đấu khớp toàn bộ reference sample topology; checkpoint biên tập không chứng minh thao tác vật lý, xác nhận giáo viên hay mastery.";
    nextAction = "Tiếp tục nội dung bài theo hướng dẫn; kết quả này không tự động đánh dấu hoàn thành hay cho phép/chặn chuyển bước.";
  } else {
    status = circuitScope === "signal-only" ? "signal-step-match" : "step-sample-match";
    summary = "Bản tự đấu khớp các reference edge được biên tập cho bước này; mapping đến từ nội dung lesson, không phải xác nhận giáo viên và không phải điều kiện chuyển bước.";
    nextAction = "Tiếp tục nội dung bước theo hướng dẫn; checkpoint chỉ là evidence tham chiếu.";
  }

  return result({
    lessonId: lesson.id,
    stepIndex,
    scope: circuitScope,
    status,
    matched,
    required: requiredKeys.size,
    missingPairs,
    extraPairs,
    issues: analysisIssues,
    summary,
    nextAction,
    guidance: checkpoint.guidance,
    checkpoint,
    wireGuidance: inspectPracticeWireGuidance({ lesson, stepIndex, circuit: source.circuit }),
    claims: claims(circuitScope, checkpoint, circuitScope === "signal-only"),
  });
}
