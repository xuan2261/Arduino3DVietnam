/**
 * Pure, immutable, bounded actionable wire guidance.
 *
 * Guidance is derived only from the authored practice checkpoint and canonical
 * circuit-router terminals/sample edges. It compares topology IDs only. It does
 * not infer physical placement, electrical measurements, hardware function,
 * learner action, mastery, completion, or permission to advance.
 */
import {
  createSampleCircuit,
  listTerminals,
  sampleWires,
  supportedWiringLessons,
} from "./circuit-router.js";
import { getPracticeCheckpoint } from "./practice-checkpoints.js";

const MAX_WIRES = 64;
const INPUT_KEYS = new Set(["lesson", "stepIndex", "circuit"]);
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

function requireExactRecord(value, allowed, label) {
  if (!isRecord(value)) throw new TypeError(label + " phải là object.");
  const unknown = extras(value, allowed);
  if (unknown.length) {
    throw new RangeError(label + " có field không được hỗ trợ: " + unknown.join(", ") + ".");
  }
  return value;
}

function pairKey(a, b) {
  return a < b ? a + "\u0000" + b : b + "\u0000" + a;
}

function pairValue(a, b) {
  return Object.freeze([String(a), String(b)]);
}

function normalizeCircuit(circuit, lessonId, terminalIds, expectedEngine) {
  const source = requireExactRecord(circuit, CIRCUIT_KEYS, "circuit");
  if (
    source.version !== 1 ||
    Number(source.lessonId) !== lessonId ||
    source.supported !== true ||
    !Array.isArray(source.wires)
  ) {
    throw new RangeError("circuit không phải canonical circuit của lesson hiện tại.");
  }
  if ((source.engine ?? null) !== expectedEngine) {
    throw new RangeError("circuit có engine marker không khớp canonical router.");
  }
  if (source.wires.length > MAX_WIRES) {
    throw new RangeError("circuit vượt giới hạn " + MAX_WIRES + " dây.");
  }
  if (!Number.isInteger(source.nextWireId) || source.nextWireId < 1) {
    throw new RangeError("circuit.nextWireId không hợp lệ.");
  }

  const ids = new Set();
  const keys = new Set();
  let maxWireNumber = 0;
  const wires = [];
  for (let index = 0; index < source.wires.length; index += 1) {
    const wire = requireExactRecord(source.wires[index], WIRE_KEYS, "circuit.wires[" + index + "]");
    if (
      typeof wire.id !== "string" || !WIRE_ID_RE.test(wire.id) ||
      typeof wire.from !== "string" || typeof wire.to !== "string"
    ) {
      throw new TypeError("circuit.wires[" + index + "] có id/from/to không hợp lệ.");
    }
    if (!terminalIds.has(wire.from) || !terminalIds.has(wire.to)) {
      throw new RangeError("circuit chứa terminal ngoài lesson: " + wire.from + " / " + wire.to + ".");
    }
    if (wire.from === wire.to) {
      throw new RangeError("circuit chứa self-edge không canonical: " + wire.id + ".");
    }
    if (ids.has(wire.id)) throw new RangeError("circuit chứa wire id trùng: " + wire.id + ".");
    ids.add(wire.id);
    const key = pairKey(wire.from, wire.to);
    if (keys.has(key)) {
      throw new RangeError("circuit chứa duplicate unordered edge: " + wire.from + " / " + wire.to + ".");
    }
    keys.add(key);
    maxWireNumber = Math.max(maxWireNumber, Number(wire.id.slice(1)));
    wires.push(Object.freeze({
      from: wire.from,
      to: wire.to,
      key,
    }));
  }
  if (source.nextWireId <= maxWireNumber) {
    throw new RangeError("circuit.nextWireId không thể thấp hơn wire id hiện có.");
  }
  return Object.freeze({
    pairKeys: Object.freeze(new Set(keys)),
    wires: Object.freeze(wires),
  });
}

function claims() {
  return Object.freeze({
    origin: "canonical-learner-graph-vs-authored-checkpoint",
    topologyAuthority: "circuit-router",
    authoredCheckpoint: true,
    topologyOnly: true,
    physicalVerified: false,
    measured: false,
    electricalSafetyVerified: false,
    functionalHardware: false,
    learnerActionProven: false,
    mastery: false,
    autoCompletion: false,
    lessonCompleted: false,
    prerequisiteForAdvance: false,
    teacherValidated: false,
    wireCreated: false,
    inspectorNavigationOnly: true,
  });
}

function result(value) {
  return deepFreeze({ ...value, claims: claims() });
}

function manualResult(checkpoint) {
  return result({
    lessonId: checkpoint.lessonId,
    stepIndex: checkpoint.stepIndex,
    checkpointId: checkpoint.id,
    status: "not-applicable-manual-checkpoint",
    nextMissingPair: null,
    inspectTerminalId: null,
    missingPairs: [],
    reviewExtraPairs: [],
    explanation: "Checkpoint này là bước manual; wire guidance không dùng topology để chấm hoặc hướng dẫn nối dây cho bước hiện tại.",
    reviewExplanation: "Không áp dụng review cạnh dây cho checkpoint manual.",
  });
}

/**
 * Derive topology-only actionable wire guidance for one authored checkpoint.
 */
export function inspectPracticeWireGuidance(input) {
  const source = requireExactRecord(input, INPUT_KEYS, "practice wire guidance input");
  const checkpoint = getPracticeCheckpoint(source.lesson, source.stepIndex);

  if (checkpoint.lessonId === 1) {
    if (source.circuit != null) {
      throw new RangeError("Bài 01 không có external circuit cho wire guidance.");
    }
    return manualResult(checkpoint);
  }

  if (!supportedWiringLessons().includes(checkpoint.lessonId)) {
    throw new RangeError("Lesson này chưa có canonical circuit-router guidance.");
  }
  const terminals = listTerminals(checkpoint.lessonId);
  const terminalIds = new Set(terminals.map(item => item.id));
  if (!terminalIds.size || terminalIds.size !== terminals.length) {
    throw new RangeError("Canonical terminal list không hợp lệ.");
  }
  const canonicalReference = createSampleCircuit(checkpoint.lessonId);
  const learner = normalizeCircuit(
    source.circuit,
    checkpoint.lessonId,
    terminalIds,
    canonicalReference.engine ?? null,
  );

  if (checkpoint.kind === "manual") return manualResult(checkpoint);

  const samplePairs = sampleWires(checkpoint.lessonId);
  const sampleKeys = new Set(samplePairs.map(pair => pairKey(pair[0], pair[1])));
  const authoredPairs = checkpoint.requiredPairs.map((pair, index) => {
    if (!Array.isArray(pair) || pair.length !== 2 || !terminalIds.has(pair[0]) || !terminalIds.has(pair[1])) {
      throw new RangeError(checkpoint.id + " requiredPairs[" + index + "] không canonical.");
    }
    const key = pairKey(pair[0], pair[1]);
    if (!sampleKeys.has(key)) {
      throw new RangeError(checkpoint.id + " requiredPairs[" + index + "] không thuộc circuit-router sample.");
    }
    return Object.freeze({ key, pair: pairValue(pair[0], pair[1]) });
  });

  const missingPairs = authoredPairs
    .filter(item => !learner.pairKeys.has(item.key))
    .map(item => item.pair);
  const reviewExtraPairs = learner.wires
    .filter(wire => !sampleKeys.has(wire.key))
    .map(wire => {
      const sorted = wire.from < wire.to ? [wire.from, wire.to] : [wire.to, wire.from];
      return Object.freeze(sorted);
    })
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));

  const nextMissingPair = missingPairs[0] ?? null;
  const inspectTerminalId = nextMissingPair?.[0] ?? null;
  let status;
  let explanation;
  if (nextMissingPair) {
    status = "missing-canonical-pair";
    explanation = "Cặp reference tiếp theo chưa xuất hiện trong learner graph của checkpoint: " +
      nextMissingPair[0] + " ↔ " + nextMissingPair[1] +
      ". Có thể mở Inspector tại " + inspectTerminalId +
      " để định vị terminal trong mô hình; thao tác này không tạo dây và không xác nhận wiring vật lý.";
  } else if (reviewExtraPairs.length) {
    status = "review-extra-pairs";
    explanation = "Các authored reference pair của checkpoint đã xuất hiện, nhưng learner graph còn cạnh ngoài canonical reference sample cần đối chiếu lại.";
  } else {
    status = "checkpoint-reference-covered";
    explanation = "Các authored reference pair của checkpoint đã xuất hiện trong learner graph; wire guidance không nâng kết quả này thành phần cứng đúng, mastery hay completion.";
  }

  const reviewExplanation = reviewExtraPairs.length
    ? "Có " + reviewExtraPairs.length + " cạnh learner graph không thuộc canonical reference sample. Đây chỉ là topology review; không suy ra lỗi điện, vị trí cắm hay an toàn phần cứng."
    : "Không có cạnh learner graph ngoài canonical reference sample trong guidance hiện tại.";

  return result({
    lessonId: checkpoint.lessonId,
    stepIndex: checkpoint.stepIndex,
    checkpointId: checkpoint.id,
    status,
    nextMissingPair,
    inspectTerminalId,
    missingPairs,
    reviewExtraPairs,
    explanation,
    reviewExplanation,
  });
}
