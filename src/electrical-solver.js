/**
 * Bounded educational LED current calculator for the validated course circuits.
 *
 * This module deliberately is not a SPICE solver. It only calculates the
 * forward current of known LED + series-resistor paths after circuit-router has
 * accepted the lesson topology.
 */
import { analyzeCircuit, listTerminals } from "./circuit-router.js";

export const SUPPORTED_ELECTRICAL_LESSONS = Object.freeze([2, 3, 5]);

export const ELECTRICAL_LIMITS = Object.freeze({
  supplyVolts: 5,
  minResistorOhms: 100,
  maxResistorOhms: 10000,
  minForwardVoltageVolts: 1.5,
  maxForwardVoltageVolts: 4.0,
  minMaxCurrentMilliAmps: 1,
  maxMaxCurrentMilliAmps: 40,
});

const channel = ({
  id,
  label,
  sourceTerminal,
  resistorComponent,
  resistorTerminals,
  ledTerminal,
  cathodeTerminal,
  resistorOhms,
  forwardVoltageVolts,
}) => Object.freeze({
  id,
  label,
  sourceTerminal,
  resistorComponent,
  resistorTerminals: Object.freeze([...resistorTerminals]),
  ledTerminal,
  cathodeTerminal,
  resistorOhms,
  forwardVoltageVolts,
});

const LESSONS = Object.freeze({
  2: Object.freeze({
    channels: Object.freeze([
      channel({
        id: "led",
        label: "LED đỏ",
        sourceTerminal: "D13",
        resistorComponent: "R1",
        resistorTerminals: ["R1:A", "R1:B"],
        ledTerminal: "LED:A",
        cathodeTerminal: "LED:K",
        resistorOhms: 220,
        forwardVoltageVolts: 2.0,
      }),
    ]),
  }),
  3: Object.freeze({
    channels: Object.freeze([
      channel({
        id: "output-led",
        label: "LED đầu ra",
        sourceTerminal: "D13",
        resistorComponent: "R_LED",
        resistorTerminals: ["R_LED:A", "R_LED:B"],
        ledTerminal: "LED:A",
        cathodeTerminal: "LED:K",
        resistorOhms: 220,
        forwardVoltageVolts: 2.0,
      }),
    ]),
  }),
  5: Object.freeze({
    channels: Object.freeze([
      channel({
        id: "red",
        label: "RGB đỏ",
        sourceTerminal: "D9",
        resistorComponent: "R_R",
        resistorTerminals: ["R_R:A", "R_R:B"],
        ledTerminal: "RGB:R",
        cathodeTerminal: "RGB:K",
        resistorOhms: 220,
        forwardVoltageVolts: 2.0,
      }),
      channel({
        id: "green",
        label: "RGB xanh lá",
        sourceTerminal: "D10",
        resistorComponent: "R_G",
        resistorTerminals: ["R_G:A", "R_G:B"],
        ledTerminal: "RGB:G",
        cathodeTerminal: "RGB:K",
        resistorOhms: 220,
        forwardVoltageVolts: 2.2,
      }),
      channel({
        id: "blue",
        label: "RGB xanh dương",
        sourceTerminal: "D11",
        resistorComponent: "R_B",
        resistorTerminals: ["R_B:A", "R_B:B"],
        ledTerminal: "RGB:B",
        cathodeTerminal: "RGB:K",
        resistorOhms: 220,
        forwardVoltageVolts: 3.0,
      }),
    ]),
  }),
});

const TOP_LEVEL_OPTIONS = new Set(["supplyVolts", "maxCurrentMilliAmps", "channels"]);
const CHANNEL_OPTIONS = new Set(["resistorOhms", "forwardVoltageVolts"]);

function numericLessonId(lessonId) {
  const id = Number(lessonId);
  if (!Number.isInteger(id) || id < 1) throw new RangeError("lessonId phải là số nguyên dương");
  return id;
}

function plainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} phải là object`);
  }
  return value;
}

function boundedNumber(value, label, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} phải là số hữu hạn`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${label} phải nằm trong khoảng ${min}–${max}`);
  }
  return value;
}

function normalizeOptions(config, options) {
  const source = options === undefined ? {} : plainRecord(options, "options");
  for (const key of Object.keys(source)) {
    if (!TOP_LEVEL_OPTIONS.has(key)) throw new RangeError(`Tùy chọn điện không được hỗ trợ: ${key}`);
  }

  const supplyVolts = source.supplyVolts === undefined ? ELECTRICAL_LIMITS.supplyVolts : source.supplyVolts;
  if (typeof supplyVolts !== "number" || !Number.isFinite(supplyVolts)) {
    throw new TypeError("supplyVolts phải là số hữu hạn");
  }
  if (supplyVolts !== ELECTRICAL_LIMITS.supplyVolts) {
    throw new RangeError("Solver giáo dục này chỉ hỗ trợ nguồn 5 V cố định");
  }

  let maxCurrentMilliAmps = null;
  if (source.maxCurrentMilliAmps !== undefined && source.maxCurrentMilliAmps !== null) {
    maxCurrentMilliAmps = boundedNumber(
      source.maxCurrentMilliAmps,
      "maxCurrentMilliAmps",
      ELECTRICAL_LIMITS.minMaxCurrentMilliAmps,
      ELECTRICAL_LIMITS.maxMaxCurrentMilliAmps,
    );
  }

  const channelOverrides = source.channels === undefined ? {} : plainRecord(source.channels, "options.channels");
  const allowedChannels = new Set(config.channels.map(item => item.id));
  for (const key of Object.keys(channelOverrides)) {
    if (!allowedChannels.has(key)) throw new RangeError(`Kênh điện không thuộc bài học: ${key}`);
    const override = plainRecord(channelOverrides[key], `options.channels.${key}`);
    for (const optionKey of Object.keys(override)) {
      if (!CHANNEL_OPTIONS.has(optionKey)) {
        throw new RangeError(`Tùy chọn kênh không được hỗ trợ: ${key}.${optionKey}`);
      }
    }
  }

  const channels = config.channels.map(item => {
    const override = channelOverrides[item.id] ?? {};
    const resistorOhms = override.resistorOhms === undefined
      ? item.resistorOhms
      : boundedNumber(
        override.resistorOhms,
        `channels.${item.id}.resistorOhms`,
        ELECTRICAL_LIMITS.minResistorOhms,
        ELECTRICAL_LIMITS.maxResistorOhms,
      );
    const forwardVoltageVolts = override.forwardVoltageVolts === undefined
      ? item.forwardVoltageVolts
      : boundedNumber(
        override.forwardVoltageVolts,
        `channels.${item.id}.forwardVoltageVolts`,
        ELECTRICAL_LIMITS.minForwardVoltageVolts,
        ELECTRICAL_LIMITS.maxForwardVoltageVolts,
      );
    return { ...item, resistorOhms, forwardVoltageVolts };
  });

  return { supplyVolts, maxCurrentMilliAmps, channels };
}

function cloneIssue(item) {
  return {
    ...item,
    ...(Array.isArray(item.terminals) ? { terminals: [...item.terminals] } : {}),
  };
}

function assumptions(options) {
  return {
    educationalOnly: true,
    model: "constant-forward-voltage-series-resistor",
    supplyVolts: options.supplyVolts,
    sourceAssumption: "Chân digital/PWM ở mức HIGH được lý tưởng hóa là 5 V; duty cycle PWM không được tính vào dòng tức thời.",
    currentEquation: "I = (Vs - Vf) / R",
    maxCurrentMilliAmps: options.maxCurrentMilliAmps,
    units: {
      voltage: "V",
      resistance: "ohm",
      current: "mA",
    },
  };
}

function missingTerminalContract(config, terminals) {
  const available = new Set(terminals.map(item => item.id));
  const required = new Set();
  for (const item of config.channels) {
    required.add(item.sourceTerminal);
    required.add(item.ledTerminal);
    required.add(item.cathodeTerminal);
    item.resistorTerminals.forEach(id => required.add(id));
  }
  return [...required].filter(id => !available.has(id));
}

function rounded(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function calculateChannel(item, options) {
  const resistorVoltageVolts = options.supplyVolts - item.forwardVoltageVolts;
  const currentMilliAmpsRaw = resistorVoltageVolts / item.resistorOhms * 1000;
  const withinMaxCurrent = options.maxCurrentMilliAmps === null
    ? null
    : currentMilliAmpsRaw <= options.maxCurrentMilliAmps;
  return {
    id: item.id,
    label: item.label,
    sourceTerminal: item.sourceTerminal,
    resistorComponent: item.resistorComponent,
    ledTerminal: item.ledTerminal,
    cathodeTerminal: item.cathodeTerminal,
    supplyVolts: options.supplyVolts,
    forwardVoltageVolts: item.forwardVoltageVolts,
    resistorOhms: item.resistorOhms,
    resistorVoltageVolts: rounded(resistorVoltageVolts),
    currentMilliAmps: rounded(currentMilliAmpsRaw),
    maxCurrentMilliAmps: options.maxCurrentMilliAmps,
    withinMaxCurrent,
  };
}

function unsupportedElectricalResult(id, topology) {
  return {
    lessonId: id,
    supported: false,
    ok: false,
    blocked: true,
    calculated: false,
    assumptions: null,
    channels: [],
    issues: [{
      code: "UNSUPPORTED_ELECTRICAL_LESSON",
      severity: "info",
      message: `Bài ${id} chưa có mô hình tính dòng LED hữu hạn.`,
      terminals: [],
    }],
    topology,
  };
}

/**
 * Analyze validated LED/resistor paths for a fixed 5 V teaching model.
 *
 * options:
 * - supplyVolts: only 5 is accepted.
 * - maxCurrentMilliAmps: optional 1..40 mA warning threshold; null disables it.
 * - channels[channelId].resistorOhms: 100..10000 ohm.
 * - channels[channelId].forwardVoltageVolts: 1.5..4.0 V.
 */
export function analyzeElectrical(lessonId, circuit, options = undefined) {
  const id = numericLessonId(lessonId);
  const topology = analyzeCircuit(id, circuit);
  const config = LESSONS[id];
  if (!config) return unsupportedElectricalResult(id, topology);

  const normalized = normalizeOptions(config, options);
  const modelAssumptions = assumptions(normalized);
  const terminals = listTerminals(id);
  const missingTerminals = missingTerminalContract(config, terminals);
  if (missingTerminals.length) {
    return {
      lessonId: id,
      supported: true,
      ok: false,
      blocked: true,
      calculated: false,
      assumptions: modelAssumptions,
      channels: [],
      issues: [{
        code: "TERMINAL_CONTRACT_MISMATCH",
        severity: "error",
        message: "Danh sách terminal của circuit-router không còn khớp mô hình điện hữu hạn.",
        terminals: missingTerminals,
      }],
      topology,
    };
  }

  if (!topology.supported || !topology.ok || !topology.functional) {
    return {
      lessonId: id,
      supported: true,
      ok: false,
      blocked: true,
      calculated: false,
      assumptions: modelAssumptions,
      channels: [],
      issues: topology.issues.map(cloneIssue),
      topology,
    };
  }

  const channels = normalized.channels.map(item => calculateChannel(item, normalized));
  const issues = topology.issues.map(cloneIssue);
  if (normalized.maxCurrentMilliAmps !== null) {
    for (const item of channels) {
      if (!item.withinMaxCurrent) {
        issues.push({
          code: "CURRENT_ABOVE_MAX_WARNING",
          severity: "warning",
          message: `${item.label}: dòng tính được ${item.currentMilliAmps} mA vượt ngưỡng cảnh báo ${normalized.maxCurrentMilliAmps} mA.`,
          terminals: [item.sourceTerminal, item.ledTerminal, item.cathodeTerminal],
          channelId: item.id,
          currentMilliAmps: item.currentMilliAmps,
          maxCurrentMilliAmps: normalized.maxCurrentMilliAmps,
        });
      }
    }
  }

  return {
    lessonId: id,
    supported: true,
    ok: !issues.some(item => item.severity === "error"),
    blocked: false,
    calculated: true,
    assumptions: modelAssumptions,
    channels,
    issues,
    topology,
  };
}
