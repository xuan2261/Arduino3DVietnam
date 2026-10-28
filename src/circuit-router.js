/**
 * A stable facade for the two explicitly bounded teaching netlist engines.
 *
 * The original engine remains the tested owner of LED/Button/RGB lessons,
 * while extended lessons use their own versioned state. This does NOT merge
 * separate nets into a universal circuit solver; unsupported lessons fall
 * back to the explanatory wiring table.
 */
import {
  SUPPORTED_CIRCUIT_LESSONS,
  createCircuit as createBase,
  connectCircuit as connectBase,
  disconnectCircuit as disconnectBase,
  analyzeCircuit as analyzeBase,
  listTerminals as terminalsBase
} from "./circuit.js";
import {
  SUPPORTED_EXTENDED_LESSONS,
  createExtendedCircuit,
  connectExtendedCircuit,
  disconnectExtendedCircuit,
  analyzeExtendedCircuit,
  listExtendedTerminals,
  getExtendedSampleWires
} from "./circuit-extended.js";

const BASE = new Set(SUPPORTED_CIRCUIT_LESSONS);
const EXTENDED = new Set(SUPPORTED_EXTENDED_LESSONS);
for (const id of BASE) {
  if (EXTENDED.has(id)) throw new Error("Mạch học bị định nghĩa trùng ở hai engine");
}

export const SUPPORTED_WIRING_LESSONS = Object.freeze(
  [...BASE, ...EXTENDED].sort((a, b) => a - b)
);

// Explicit good examples; each still must be validated by its own engine.
const BASE_SAMPLES = Object.freeze({
  2: [["D13", "R1:A"], ["R1:B", "LED:A"], ["LED:K", "GND"]],
  3: [
    ["5V", "BTN:1"], ["BTN:2", "D2"],
    ["D2", "R_PULL:A"], ["R_PULL:B", "GND"],
    ["D13", "R_LED:A"], ["R_LED:B", "LED:A"], ["LED:K", "GND"]
  ],
  5: [
    ["D9", "R_R:A"], ["R_R:B", "RGB:R"],
    ["D10", "R_G:A"], ["R_G:B", "RGB:G"],
    ["D11", "R_B:A"], ["R_B:B", "RGB:B"], ["RGB:K", "GND"]
  ]
});

const numericId = id => {
  const number = Number(id);
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError("ID bài mạch phải là số nguyên dương");
  }
  return number;
};

const extendedFor = id => EXTENDED.has(numericId(id));

export function supportedWiringLessons() {
  return [...SUPPORTED_WIRING_LESSONS];
}

export function createCircuit(lessonId) {
  const id = numericId(lessonId);
  return extendedFor(id) ? createExtendedCircuit(id) : createBase(id);
}

export function connectCircuit(state, from, to) {
  if (!state || typeof state !== "object") throw new TypeError("state mạch không hợp lệ");
  return extendedFor(state.lessonId)
    ? connectExtendedCircuit(state, from, to)
    : connectBase(state, from, to);
}

export function disconnectCircuit(state, indexOrId) {
  if (!state || typeof state !== "object") throw new TypeError("state mạch không hợp lệ");
  return extendedFor(state.lessonId)
    ? disconnectExtendedCircuit(state, indexOrId)
    : disconnectBase(state, indexOrId);
}

export function analyzeCircuit(lessonId, state) {
  const id = numericId(lessonId);
  return extendedFor(id)
    ? analyzeExtendedCircuit(id, state)
    : analyzeBase(id, state);
}

export function listTerminals(lessonId) {
  const id = numericId(lessonId);
  return extendedFor(id)
    ? listExtendedTerminals(id)
    : terminalsBase(id);
}

export function sampleWires(lessonId) {
  const id = numericId(lessonId);
  if (BASE.has(id)) return BASE_SAMPLES[id].map(pair => [...pair]);
  if (EXTENDED.has(id)) return getExtendedSampleWires(id);
  return [];
}

export function createSampleCircuit(lessonId) {
  const id = numericId(lessonId);
  const pairs = sampleWires(id);
  if (!pairs.length) return createCircuit(id);
  const sample = pairs.reduce((state, pair) => connectCircuit(state, pair[0], pair[1]), createCircuit(id));
  const analysis = analyzeCircuit(id, sample);
  // Lessons 10/14 deliberately contain logic-side reference wiring only.
  // Their presets may be shown for learning, but must NEVER be eligible for
  // activating a custom motor/pump circuit without a modeled power/load path.
  const signalReference = analysis.scope === "signal-only" &&
    analysis.signalPathsComplete === true &&
    analysis.functional === false && analysis.ok === false &&
    !analysis.issues.some(item => item.severity === "error");
  if (!analysis.supported || !(analysis.ok && analysis.functional) && !signalReference) {
    throw new Error(`Mạch mẫu bài ${id} không đạt bộ kiểm tra topology`);
  }
  return sample;
}
