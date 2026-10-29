/**
 * Bounded, immutable undo/redo state for the canonical learner circuit graph.
 *
 * This module never invents learner actions and never loads a reference/sample
 * graph on its own. Callers must pass the exact circuit-router graph before and
 * after a real user mutation. Undo/redo only selects an earlier/later in-app
 * graph snapshot; applying that snapshot remains an explicit host action and is
 * not evidence that physical wiring was changed.
 */
import {
  analyzeCircuit,
  createCircuit,
  supportedWiringLessons,
} from "./circuit-router.js";

const HISTORY_VERSION = 1;
const DEFAULT_MAX_STEPS = 32;
const ABSOLUTE_MAX_STEPS = 64;
const SESSION_BRAND = new WeakSet();
const SUPPORTED_LESSONS = new Set(supportedWiringLessons());

const CREATE_KEYS = new Set(["lessonId", "circuit", "maxSteps"]);
const RESET_KEYS = new Set(["lessonId", "circuit", "expectedRevision"]);
const RECORD_KEYS = new Set([
  "lessonId", "currentCircuit", "nextCircuit", "expectedRevision",
]);
const MOVE_KEYS = new Set(["lessonId", "currentCircuit", "expectedRevision"]);
const SESSION_KEYS = new Set([
  "version", "lessonId", "revision", "maxSteps", "past", "present", "future",
]);
const WIRE_KEYS = new Set(["id", "from", "to"]);

export const LEARNER_CIRCUIT_HISTORY_LIMITS = Object.freeze({
  defaultMaxSteps: DEFAULT_MAX_STEPS,
  maxSteps: ABSOLUTE_MAX_STEPS,
});

function requirePlainRecord(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " phải là object thường.");
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(label + " phải dùng Object.prototype chuẩn; prototype tùy biến không được chấp nhận.");
  }
  const keys = Reflect.ownKeys(value);
  const unsupported = keys.filter(key => typeof key !== "string" || !allowedKeys.has(key));
  if (unsupported.length) {
    throw new RangeError(label + " có field không được hỗ trợ: " + unsupported.map(String).join(", ") + ".");
  }
  return value;
}

function requireOwnDataField(record, key, label) {
  if (!Object.hasOwn(record, key)) {
    throw new TypeError(label + "." + key + " phải là field riêng của object.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(label + "." + key + " phải là data field, không phải getter/setter.");
  }
  return descriptor.value;
}

function requireLessonId(value, label = "lessonId") {
  if (!Number.isInteger(value) || !SUPPORTED_LESSONS.has(value)) {
    throw new RangeError(label + " phải là bài có canonical circuit-router hỗ trợ.");
  }
  return value;
}

function requireRevision(value, label = "expectedRevision") {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(label + " phải là số nguyên an toàn không âm.");
  }
  return value;
}

function requireMaxSteps(value) {
  if (!Number.isInteger(value) || value < 1 || value > ABSOLUTE_MAX_STEPS) {
    throw new RangeError("maxSteps phải là số nguyên 1.." + ABSOLUTE_MAX_STEPS + ".");
  }
  return value;
}

function requireExactOwnKeys(record, expectedKeys, label) {
  const keys = Reflect.ownKeys(record);
  const unsupported = keys.filter(key => typeof key !== "string" || !expectedKeys.has(key));
  const missing = [...expectedKeys].filter(key => !Object.hasOwn(record, key));
  if (unsupported.length || missing.length) {
    const detail = [
      unsupported.length ? "field lạ " + unsupported.map(String).join(", ") : "",
      missing.length ? "thiếu " + missing.join(", ") : "",
    ].filter(Boolean).join("; ");
    throw new RangeError(label + " không đúng schema canonical" + (detail ? ": " + detail : "") + ".");
  }
  for (const key of expectedKeys) requireOwnDataField(record, key, label);
}

function canonicalSnapshot(circuit, lessonId, label = "circuit") {
  const id = requireLessonId(lessonId, label + ".lessonId mong đợi");
  if (!circuit || typeof circuit !== "object" || Array.isArray(circuit)) {
    throw new TypeError(label + " phải là canonical circuit-router object.");
  }
  if (Object.getPrototypeOf(circuit) !== Object.prototype) {
    throw new TypeError(label + " dùng prototype không canonical.");
  }

  const template = createCircuit(id);
  const expectedKeys = new Set(Object.keys(template));
  requireExactOwnKeys(circuit, expectedKeys, label);

  if (circuit.version !== template.version || circuit.lessonId !== id || circuit.supported !== true) {
    throw new RangeError(label + " không thuộc canonical model của bài hiện tại.");
  }
  if (Object.hasOwn(template, "engine") && circuit.engine !== template.engine) {
    throw new RangeError(label + ".engine không khớp canonical circuit-router.");
  }
  if (!Array.isArray(circuit.wires) || Object.getPrototypeOf(circuit.wires) !== Array.prototype) {
    throw new TypeError(label + ".wires phải là Array canonical.");
  }
  circuit.wires.forEach((wire, index) => {
    const wireLabel = label + ".wires[" + index + "]";
    if (!wire || typeof wire !== "object" || Array.isArray(wire) ||
        Object.getPrototypeOf(wire) !== Object.prototype) {
      throw new TypeError(wireLabel + " dùng object/prototype không canonical.");
    }
    requireExactOwnKeys(wire, WIRE_KEYS, wireLabel);
  });

  // circuit-router remains the sole electrical/topology authority. Its
  // validator rejects foreign terminals, duplicate edges, bad wire IDs,
  // impossible nextWireId values and engine-specific schema mismatches.
  analyzeCircuit(id, circuit);

  const snapshot = {};
  for (const key of Object.keys(template)) {
    if (key === "wires") {
      snapshot.wires = Object.freeze(circuit.wires.map(wire => Object.freeze({
        id: wire.id,
        from: wire.from,
        to: wire.to,
      })));
    } else {
      snapshot[key] = circuit[key];
    }
  }
  return Object.freeze(snapshot);
}

function sameCircuit(a, b) {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length || aKeys.some(key => !Object.hasOwn(b, key))) return false;
  for (const key of aKeys) {
    if (key === "wires") continue;
    if (a[key] !== b[key]) return false;
  }
  if (a.wires.length !== b.wires.length) return false;
  return a.wires.every((wire, index) => {
    const other = b.wires[index];
    return wire.id === other.id && wire.from === other.from && wire.to === other.to;
  });
}

function freezeStack(items) {
  return Object.freeze([...items]);
}

function makeSession({ lessonId, revision, maxSteps, past, present, future }) {
  const session = Object.freeze({
    version: HISTORY_VERSION,
    lessonId,
    revision,
    maxSteps,
    past: freezeStack(past),
    present,
    future: freezeStack(future),
  });
  SESSION_BRAND.add(session);
  return session;
}

function requireSession(session) {
  requirePlainRecord(session, SESSION_KEYS, "learner circuit history session");
  if (!SESSION_BRAND.has(session)) {
    throw new RangeError("learner circuit history session không được tạo bởi module history hiện tại.");
  }
  if (session.version !== HISTORY_VERSION || !Object.isFrozen(session)) {
    throw new RangeError("learner circuit history session.version/immutability không hợp lệ.");
  }
  requireLessonId(session.lessonId, "history.lessonId");
  requireRevision(session.revision, "history.revision");
  requireMaxSteps(session.maxSteps);
  if (!Array.isArray(session.past) || !Array.isArray(session.future) ||
      !Object.isFrozen(session.past) || !Object.isFrozen(session.future)) {
    throw new TypeError("history past/future phải là mảng immutable do module tạo.");
  }
  if (session.past.length > session.maxSteps || session.future.length > session.maxSteps) {
    throw new RangeError("history vượt giới hạn maxSteps.");
  }
  return session;
}

function requireExpectedRevision(session, expectedRevision) {
  const revision = requireRevision(expectedRevision);
  if (revision !== session.revision) {
    throw new RangeError(
      "History revision đã stale: expected " + revision + ", current " + session.revision + ".",
    );
  }
}

function requireCurrentLesson(session, lessonId) {
  const id = requireLessonId(lessonId);
  if (id !== session.lessonId) {
    throw new RangeError("History thuộc bài " + session.lessonId + ", không phải bài " + id + ".");
  }
  return id;
}

function requireCurrentCircuit(session, currentCircuit, lessonId) {
  const current = canonicalSnapshot(currentCircuit, lessonId, "currentCircuit");
  if (!sameCircuit(current, session.present)) {
    throw new RangeError("currentCircuit là foreign graph hoặc đã lệch khỏi history head hiện tại.");
  }
  return current;
}

function incrementRevision(revision) {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("History revision đã đạt giới hạn số nguyên an toàn.");
  }
  return revision + 1;
}

function boundedPush(stack, item, maxSteps) {
  const next = [...stack, item];
  return next.length > maxSteps ? next.slice(next.length - maxSteps) : next;
}

export function createLearnerCircuitHistory(input) {
  const source = requirePlainRecord(input, CREATE_KEYS, "createLearnerCircuitHistory input");
  const lessonId = requireLessonId(requireOwnDataField(source, "lessonId", "create input"));
  const circuit = canonicalSnapshot(
    requireOwnDataField(source, "circuit", "create input"),
    lessonId,
    "circuit",
  );
  const maxSteps = Object.hasOwn(source, "maxSteps")
    ? requireMaxSteps(requireOwnDataField(source, "maxSteps", "create input"))
    : DEFAULT_MAX_STEPS;
  return makeSession({
    lessonId,
    revision: 0,
    maxSteps,
    past: [],
    present: circuit,
    future: [],
  });
}

export function resetLearnerCircuitHistory(session, input) {
  const currentSession = requireSession(session);
  const source = requirePlainRecord(input, RESET_KEYS, "resetLearnerCircuitHistory input");
  requireExpectedRevision(
    currentSession,
    requireOwnDataField(source, "expectedRevision", "reset input"),
  );
  const lessonId = requireLessonId(requireOwnDataField(source, "lessonId", "reset input"));
  const circuit = canonicalSnapshot(
    requireOwnDataField(source, "circuit", "reset input"),
    lessonId,
    "circuit",
  );
  return makeSession({
    lessonId,
    revision: incrementRevision(currentSession.revision),
    maxSteps: currentSession.maxSteps,
    past: [],
    present: circuit,
    future: [],
  });
}

export function recordLearnerCircuitHistory(session, input) {
  const currentSession = requireSession(session);
  const source = requirePlainRecord(input, RECORD_KEYS, "recordLearnerCircuitHistory input");
  const lessonId = requireCurrentLesson(
    currentSession,
    requireOwnDataField(source, "lessonId", "record input"),
  );
  requireExpectedRevision(
    currentSession,
    requireOwnDataField(source, "expectedRevision", "record input"),
  );
  requireCurrentCircuit(
    currentSession,
    requireOwnDataField(source, "currentCircuit", "record input"),
    lessonId,
  );
  const next = canonicalSnapshot(
    requireOwnDataField(source, "nextCircuit", "record input"),
    lessonId,
    "nextCircuit",
  );
  if (sameCircuit(next, currentSession.present)) return currentSession;

  return makeSession({
    lessonId,
    revision: incrementRevision(currentSession.revision),
    maxSteps: currentSession.maxSteps,
    past: boundedPush(currentSession.past, currentSession.present, currentSession.maxSteps),
    present: next,
    future: [],
  });
}

export function undoLearnerCircuitHistory(session, input) {
  const currentSession = requireSession(session);
  const source = requirePlainRecord(input, MOVE_KEYS, "undoLearnerCircuitHistory input");
  const lessonId = requireCurrentLesson(
    currentSession,
    requireOwnDataField(source, "lessonId", "undo input"),
  );
  requireExpectedRevision(
    currentSession,
    requireOwnDataField(source, "expectedRevision", "undo input"),
  );
  requireCurrentCircuit(
    currentSession,
    requireOwnDataField(source, "currentCircuit", "undo input"),
    lessonId,
  );
  if (!currentSession.past.length) {
    throw new RangeError("Không có learner circuit graph trước đó để undo.");
  }

  const target = currentSession.past[currentSession.past.length - 1];
  const nextSession = makeSession({
    lessonId,
    revision: incrementRevision(currentSession.revision),
    maxSteps: currentSession.maxSteps,
    past: currentSession.past.slice(0, -1),
    present: target,
    future: boundedPush(currentSession.future, currentSession.present, currentSession.maxSteps),
  });
  return Object.freeze({ session: nextSession, circuit: target });
}

export function redoLearnerCircuitHistory(session, input) {
  const currentSession = requireSession(session);
  const source = requirePlainRecord(input, MOVE_KEYS, "redoLearnerCircuitHistory input");
  const lessonId = requireCurrentLesson(
    currentSession,
    requireOwnDataField(source, "lessonId", "redo input"),
  );
  requireExpectedRevision(
    currentSession,
    requireOwnDataField(source, "expectedRevision", "redo input"),
  );
  requireCurrentCircuit(
    currentSession,
    requireOwnDataField(source, "currentCircuit", "redo input"),
    lessonId,
  );
  if (!currentSession.future.length) {
    throw new RangeError("Không có learner circuit graph tiếp theo để redo.");
  }

  const target = currentSession.future[currentSession.future.length - 1];
  const nextSession = makeSession({
    lessonId,
    revision: incrementRevision(currentSession.revision),
    maxSteps: currentSession.maxSteps,
    past: boundedPush(currentSession.past, currentSession.present, currentSession.maxSteps),
    present: target,
    future: currentSession.future.slice(0, -1),
  });
  return Object.freeze({ session: nextSession, circuit: target });
}

export function inspectLearnerCircuitHistory(session) {
  const currentSession = requireSession(session);
  return Object.freeze({
    lessonId: currentSession.lessonId,
    revision: currentSession.revision,
    maxSteps: currentSession.maxSteps,
    undoDepth: currentSession.past.length,
    redoDepth: currentSession.future.length,
    canUndo: currentSession.past.length > 0,
    canRedo: currentSession.future.length > 0,
    circuit: currentSession.present,
  });
}
