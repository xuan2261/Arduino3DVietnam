/**
 * Explicit authored breadboard placement records.
 *
 * This module records an author's terminal-to-hole association and validates it
 * against a selected breadboard topology profile. It does not infer placements
 * from scene coordinates, mutate circuit-router, prove mechanical fit, or prove
 * the continuity of an external jumper.
 */
import {
  createBreadboardTopology,
  breadboardNode,
  diagnoseBreadboardHolePair,
} from "./breadboard-topology.js";

export const BREADBOARD_PLACEMENT_SCHEMA_VERSION = 2;
export const BREADBOARD_PLACEMENT_MODEL = "explicit-authored-breadboard-placement-v2";
export const BREADBOARD_PLACEMENT_VALIDATOR = "breadboard-placement-v2";

export const ARDUINO_UNO_R3_PINOUT_PROVENANCE = Object.freeze({
  board: "arduino-uno-r3",
  sku: "A000066",
  source:
    "https://content.arduino.cc/assets/A000066-full-pinout.pdf",
  sourceType: "official-manufacturer-pinout",
  evidenceScope:
    "logical header labels and signal roles only; no Arduino-to-breadboard geometry is derived",
  confidence: "official-manufacturer",
});

const DEFAULT_PROFILE_ID = "generic-63x10-terminal-strips";
const ARDUINO_COMPONENT_ID = "arduino";

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

const DIGITAL_PINS = Object.fromEntries(
  Array.from({ length: 14 }, (_unused, index) => {
    const id = "D" + index;
    return [id, {
      id,
      role: "digital-gpio",
      officialLabel: index === 0 ? "D0/RX" : index === 1 ? "D1/TX" : id,
      connectable: true,
    }];
  }),
);

const ANALOG_PINS = Object.fromEntries(
  Array.from({ length: 6 }, (_unused, index) => {
    const id = "A" + index;
    return [id, {
      id,
      role: "analog-gpio",
      officialLabel: id,
      connectable: true,
    }];
  }),
);

const UNO_PIN_DEFINITIONS = freezeDeep({
  ...DIGITAL_PINS,
  ...ANALOG_PINS,
  "5V": {
    id: "5V",
    role: "power-output",
    officialLabel: "+5V OUT",
    connectable: true,
  },
  "3V3": {
    id: "3V3",
    role: "power-output",
    officialLabel: "+3V3 OUT",
    connectable: true,
  },
  GND: {
    id: "GND",
    role: "ground",
    officialLabel: "GND",
    connectable: true,
    physicalHeaderContact: "multiple-official-gnd-contacts-not-disambiguated",
  },
  VIN: {
    id: "VIN",
    role: "power-input",
    officialLabel: "VIN IN",
    connectable: true,
  },
  AREF: {
    id: "AREF",
    role: "analog-reference",
    officialLabel: "AREF",
    connectable: true,
  },
  RESET: {
    id: "RESET",
    role: "reset",
    officialLabel: "RESET",
    connectable: true,
  },
  IOREF: {
    id: "IOREF",
    role: "logic-reference",
    officialLabel: "IOREF",
    connectable: true,
  },
  SDA: {
    id: "SDA",
    role: "i2c-data",
    officialLabel: "D18/SDA",
    connectable: true,
    logicalAlias: "A4",
  },
  SCL: {
    id: "SCL",
    role: "i2c-clock",
    officialLabel: "D19/SCL",
    connectable: true,
    logicalAlias: "A5",
  },
  NC: {
    id: "NC",
    role: "not-connected",
    officialLabel: "NC",
    connectable: false,
  },
});

function canonicalArduinoPinId(pinId) {
  if (typeof pinId !== "string" || !pinId.trim()) {
    throw new TypeError("Arduino pin ID phải là chuỗi không rỗng.");
  }
  const value = pinId.trim().toUpperCase()
    .replace(/^\+5V$/, "5V")
    .replace(/^\+3V3$/, "3V3")
    .replace(/^3\.3V$/, "3V3");
  return value;
}

export function describeArduinoUnoR3Pin(pinId) {
  const canonical = canonicalArduinoPinId(pinId);
  const found = Object.hasOwn(UNO_PIN_DEFINITIONS, canonical)
    ? UNO_PIN_DEFINITIONS[canonical]
    : null;
  return found ? freezeDeep({ ...found, provenance: ARDUINO_UNO_R3_PINOUT_PROVENANCE }) : null;
}

function normalizeTerminals(terminals) {
  if (!Array.isArray(terminals)) {
    throw new TypeError("terminals phải là array.");
  }
  const seen = new Set();
  return terminals.map((terminal, index) => {
    if (!terminal || typeof terminal !== "object" || Array.isArray(terminal)) {
      throw new TypeError("terminal #" + index + " phải là object.");
    }
    if (typeof terminal.id !== "string" || !terminal.id.trim()) {
      throw new TypeError("terminal #" + index + " thiếu id.");
    }
    if (typeof terminal.component !== "string" || !terminal.component.trim()) {
      throw new TypeError("terminal " + terminal.id + " thiếu component.");
    }
    const id = terminal.id.trim();
    if (seen.has(id)) throw new RangeError("terminal id bị trùng: " + id);
    seen.add(id);
    return Object.freeze({
      id,
      component: terminal.component.trim(),
    });
  });
}

function canonicalHoleId(holeId) {
  if (typeof holeId !== "string" || !holeId.trim()) {
    throw new TypeError("holeId phải là chuỗi không rỗng.");
  }
  return holeId.trim().toUpperCase();
}

function terminalMapObject(terminalToHole) {
  if (terminalToHole === undefined || terminalToHole === null) return {};
  if (
    typeof terminalToHole !== "object" ||
    Array.isArray(terminalToHole)
  ) {
    throw new TypeError("terminalToHole phải là object.");
  }
  return terminalToHole;
}

function endpointForTerminal(terminal) {
  if (terminal.component === ARDUINO_COMPONENT_ID) {
    const pin = describeArduinoUnoR3Pin(terminal.id);
    if (!pin) {
      throw new RangeError(
        "Arduino UNO R3 pin không có trong official pinout allowlist: " + terminal.id,
      );
    }
    if (!pin.connectable) {
      throw new RangeError("Arduino pin không phải endpoint kết nối: " + terminal.id);
    }
    return {
      endpointKind: "arduino-uno-r3-header-jumper-end",
      sourceEndpoint: {
        board: "arduino-uno-r3",
        logicalPin: pin.id,
        officialLabel: pin.officialLabel,
        role: pin.role,
        headerContactVerified: false,
        externalJumperContinuityVerified: false,
      },
    };
  }
  return {
    endpointKind: "authored-circuit-terminal-contact",
    sourceEndpoint: {
      component: terminal.component,
      terminalId: terminal.id,
      mechanicalFitVerified: false,
    },
  };
}

function normalizedExpectedTerminals(placement, terminals) {
  if (terminals !== undefined) return normalizeTerminals(terminals);
  return normalizeTerminals(placement?.terminals);
}

export function createBreadboardPlacement(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options placement phải là object.");
  }
  const profileId = options.profileId ?? DEFAULT_PROFILE_ID;
  const topology = createBreadboardTopology(profileId);
  const terminals = normalizeTerminals(options.terminals);
  const byId = new Map(terminals.map(terminal => [terminal.id, terminal]));
  const requested = terminalMapObject(options.terminalToHole);
  const terminalToHole = Object.create(null);
  const usedHoles = new Set();
  const placements = [];

  for (const [terminalId, rawHole] of Object.entries(requested)) {
    const terminal = byId.get(terminalId);
    if (!terminal) {
      throw new RangeError("placement chứa terminal lạ: " + terminalId);
    }
    const holeId = canonicalHoleId(rawHole);
    const node = breadboardNode(holeId, topology);
    if (!node) {
      throw new RangeError(
        "placement map vào hole chưa được profile chứng minh: " + holeId,
      );
    }
    if (usedHoles.has(holeId)) {
      throw new RangeError("Một breadboard hole không thể chứa hai terminal: " + holeId);
    }
    usedHoles.add(holeId);
    const endpoint = endpointForTerminal(terminal);
    terminalToHole[terminalId] = holeId;
    placements.push({
      terminalId,
      component: terminal.component,
      holeId,
      nodeId: node.id,
      nodeKind: node.kind,
      ...endpoint,
    });
  }

  return freezeDeep({
    schemaVersion: BREADBOARD_PLACEMENT_SCHEMA_VERSION,
    model: BREADBOARD_PLACEMENT_MODEL,
    validatedBy: BREADBOARD_PLACEMENT_VALIDATOR,
    profileId: topology.profileId,
    claims: {
      explicitAuthoredHoleAssociation: true,
      breadboardInternalNodeFromProfile: true,
      mechanicalFitVerified: false,
      sceneCoordinateMapped: false,
      circuitRouterMutated: false,
      externalJumperContinuityVerified: false,
      physicalCircuitSafetyVerified: false,
      electricalPowerInferred: false,
    },
    provenance: {
      breadboardProfile: topology.provenance,
      arduinoUnoR3Pinout: ARDUINO_UNO_R3_PINOUT_PROVENANCE,
    },
    terminals: terminals.map(terminal => ({ ...terminal })),
    terminalToHole,
    placements,
  });
}

function placementShapeErrors(placement) {
  const errors = [];
  if (!placement || typeof placement !== "object" || Array.isArray(placement)) {
    return ["placement phải là object."];
  }
  if (placement.schemaVersion !== BREADBOARD_PLACEMENT_SCHEMA_VERSION) {
    errors.push("placement.schemaVersion không được hỗ trợ.");
  }
  if (placement.model !== BREADBOARD_PLACEMENT_MODEL) {
    errors.push("placement.model không được hỗ trợ.");
  }
  if (placement.validatedBy !== BREADBOARD_PLACEMENT_VALIDATOR) {
    errors.push("placement.validatedBy không đúng.");
  }
  const claims = placement.claims;
  if (
    claims?.explicitAuthoredHoleAssociation !== true ||
    claims?.breadboardInternalNodeFromProfile !== true ||
    claims?.mechanicalFitVerified !== false ||
    claims?.sceneCoordinateMapped !== false ||
    claims?.circuitRouterMutated !== false ||
    claims?.externalJumperContinuityVerified !== false ||
    claims?.physicalCircuitSafetyVerified !== false ||
    claims?.electricalPowerInferred !== false
  ) {
    errors.push("placement claims vượt quá phạm vi đã kiểm chứng.");
  }
  if (!Array.isArray(placement.placements)) {
    errors.push("placement.placements phải là array.");
  }
  if (!Array.isArray(placement.terminals)) {
    errors.push("placement.terminals phải là array.");
  }
  if (
    !placement.terminalToHole ||
    typeof placement.terminalToHole !== "object" ||
    Array.isArray(placement.terminalToHole)
  ) {
    errors.push("placement.terminalToHole phải là object.");
  }
  return errors;
}

export function validateBreadboardPlacement(placement, terminals) {
  const errors = placementShapeErrors(placement);
  let embedded = [];
  try {
    embedded = normalizeTerminals(placement?.terminals);
  } catch (error) {
    errors.push("placement.terminals: " + error.message);
  }
  let expected = [];
  try {
    expected = normalizedExpectedTerminals(placement, terminals);
  } catch (error) {
    errors.push("terminals: " + error.message);
  }

  if (embedded.length && expected.length) {
    const expectedById = new Map(expected.map(terminal => [terminal.id, terminal.component]));
    if (
      embedded.length !== expected.length ||
      embedded.some(terminal => expectedById.get(terminal.id) !== terminal.component)
    ) {
      errors.push("placement.terminals không khớp terminal set được xác nhận.");
    }
  }

  let rebuilt = null;
  if (errors.length === 0) {
    try {
      rebuilt = createBreadboardPlacement({
        profileId: placement.profileId,
        terminals: expected,
        terminalToHole: placement.terminalToHole,
      });
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (rebuilt) {
    if (JSON.stringify(placement.provenance) !== JSON.stringify(rebuilt.provenance)) {
      errors.push("placement.provenance không khớp nguồn canonical.");
    }
    if (placement.placements.length !== rebuilt.placements.length) {
      errors.push("placement.placements không khớp terminalToHole.");
    } else {
      for (let index = 0; index < rebuilt.placements.length; index += 1) {
        const actual = placement.placements[index];
        const canonical = rebuilt.placements[index];
        if (!actual || JSON.stringify(actual) !== JSON.stringify(canonical)) {
          errors.push("placement.placements chứa record không nhất quán.");
          break;
        }
      }
    }
  }

  return freezeDeep({
    ok: errors.length === 0,
    errors,
    stats: {
      terminals: expected.length,
      mapped: rebuilt?.placements.length || 0,
    },
  });
}

function assertValidPlacement(placement, terminals) {
  const validation = validateBreadboardPlacement(placement, terminals);
  if (!validation.ok) {
    throw new RangeError("breadboard placement không hợp lệ: " + validation.errors.join("; "));
  }
  return validation;
}

export function mapBreadboardPlacementTerminalToHole(placement, terminalId, terminals) {
  if (typeof terminalId !== "string" || !terminalId) {
    throw new TypeError("terminalId phải là chuỗi không rỗng.");
  }
  const expected = normalizedExpectedTerminals(placement, terminals);
  const terminalIds = new Set(expected.map(terminal => terminal.id));
  if (!terminalIds.has(terminalId)) {
    throw new RangeError("Không có terminal " + terminalId + " trong placement.");
  }
  assertValidPlacement(placement, expected);
  return placement.terminalToHole[terminalId] ?? null;
}

export function diagnosePlacedTerminalPair(
  placement,
  firstTerminalId,
  secondTerminalId,
  terminals,
) {
  const expected = normalizedExpectedTerminals(placement, terminals);
  assertValidPlacement(placement, expected);
  const firstHole = mapBreadboardPlacementTerminalToHole(
    placement,
    firstTerminalId,
    expected,
  );
  const secondHole = mapBreadboardPlacementTerminalToHole(
    placement,
    secondTerminalId,
    expected,
  );
  if (!firstHole || !secondHole) {
    return freezeDeep({
      status: "unmapped",
      profileId: placement.profileId,
      firstTerminalId,
      secondTerminalId,
      firstHole,
      secondHole,
      breadboardInternalConnected: null,
      circuitRouterConnectionInferred: false,
    });
  }
  const pair = diagnoseBreadboardHolePair(
    firstHole,
    secondHole,
    placement.profileId,
  );
  return freezeDeep({
    status:
      pair.status === "connected"
        ? "same-profile-node"
        : pair.status === "separate"
          ? "different-profile-nodes"
          : "unknown-profile",
    profileId: placement.profileId,
    firstTerminalId,
    secondTerminalId,
    firstHole,
    secondHole,
    breadboardInternalConnected: pair.connected,
    breadboardPair: pair,
    circuitRouterConnectionInferred: false,
  });
}
