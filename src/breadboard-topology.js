/**
 * Deterministic profiled breadboard connectivity.
 *
 * Only internal conductive groups proven by a selected profile are modeled.
 * This module does not infer holes from 3D coordinates, place components,
 * inject connections into circuit-router, or claim physical circuit safety.
 */

const SCHEMA_VERSION = 1;
const TERMINAL_COLUMNS = 63;
const LEFT_ROWS = Object.freeze(["A", "B", "C", "D", "E"]);
const RIGHT_ROWS = Object.freeze(["F", "G", "H", "I", "J"]);
const ALL_ROWS = Object.freeze([...LEFT_ROWS, ...RIGHT_ROWS]);
const DEFAULT_PROFILE_ID = "generic-63x10-terminal-strips";
const BB830_PROFILE_ID = "busboard-bb830-rev7";
const PLACEMENT_MODEL = "explicit-validated-breadboard-placement-v1";
const PLACEMENT_VALIDATOR = "breadboard-topology-v1";
const TERMINAL_HOLE_RE = /^([A-J])([1-9]|[1-5][0-9]|6[0-3])$/;
const RAIL_HOLE_RE = /^(P[12][+-])([1-9]|[1-4][0-9]|50)$/;
const TOPOLOGY_INSTANCES = new WeakSet();

const PROFILE_DEFINITIONS = Object.freeze({
  [DEFAULT_PROFILE_ID]: Object.freeze({
    id: DEFAULT_PROFILE_ID,
    label: "Generic 63x10 terminal strips; rails unmodeled",
    terminalColumns: TERMINAL_COLUMNS,
    railModel: "unknown-unmodeled",
    rails: Object.freeze([]),
    evidence: Object.freeze({
      terminalStrips: "verified-common-five-point-node",
      centerGap: "verified-isolated",
      rails: "not-profile-verified",
    }),
  }),
  [BB830_PROFILE_ID]: Object.freeze({
    id: BB830_PROFILE_ID,
    label: "BusBoard BB830 Rev 7",
    terminalColumns: TERMINAL_COLUMNS,
    railModel: "four-independent-50-tie-point-rails",
    rails: Object.freeze([
      Object.freeze({ id: "P1+", holes: 50 }),
      Object.freeze({ id: "P1-", holes: 50 }),
      Object.freeze({ id: "P2+", holes: 50 }),
      Object.freeze({ id: "P2-", holes: 50 }),
    ]),
    evidence: Object.freeze({
      terminalStrips: "verified-common-five-point-node",
      centerGap: "verified-isolated",
      rails: "busboard-bb830-four-50-tie-point-power-rails",
    }),
  }),
});

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

function profileDefinition(profile) {
  if (profile === undefined || profile === null) {
    return PROFILE_DEFINITIONS[DEFAULT_PROFILE_ID];
  }
  if (typeof profile === "string") {
    const found = PROFILE_DEFINITIONS[profile];
    if (!found) throw new RangeError("Breadboard profile không được hỗ trợ: " + profile);
    return found;
  }
  if (profile && typeof profile === "object" && TOPOLOGY_INSTANCES.has(profile)) {
    const found = PROFILE_DEFINITIONS[profile.profileId];
    if (!found) throw new RangeError("Breadboard topology dùng profile không được hỗ trợ.");
    return found;
  }
  throw new TypeError("profile phải là profile ID allowlist hoặc topology do module tạo.");
}

function terminalStripNode(row, column) {
  const side = LEFT_ROWS.includes(row) ? "left" : "right";
  const rows = side === "left" ? LEFT_ROWS : RIGHT_ROWS;
  return Object.freeze({
    id: "strip:" + column + ":" + side,
    kind: "terminal-strip",
    column,
    side,
    holeCount: 5,
    holes: Object.freeze(rows.map(letter => letter + column)),
    electricallyKnown: true,
  });
}

function railNode(rail) {
  return Object.freeze({
    id: "rail:" + rail.id,
    kind: "power-rail",
    railId: rail.id,
    holeCount: rail.holes,
    holes: Object.freeze(
      Array.from({ length: rail.holes }, (_unused, index) => rail.id + (index + 1)),
    ),
    electricallyKnown: true,
    polarityMeaning: "legend-only",
  });
}

function createNodes(definition) {
  const nodes = [];
  for (let column = 1; column <= definition.terminalColumns; column += 1) {
    nodes.push(terminalStripNode("A", column));
    nodes.push(terminalStripNode("F", column));
  }
  for (const rail of definition.rails) nodes.push(railNode(rail));
  return Object.freeze(nodes);
}

function canonicalHoleId(holeId) {
  if (typeof holeId !== "string" || !holeId.trim()) {
    throw new TypeError("holeId phải là chuỗi không rỗng.");
  }
  const value = holeId.trim().toUpperCase();
  if (TERMINAL_HOLE_RE.test(value) || RAIL_HOLE_RE.test(value)) return value;
  throw new RangeError("Breadboard hole ID không hợp lệ/không được hỗ trợ: " + holeId);
}

function nodeForHole(holeId, definition) {
  const terminal = TERMINAL_HOLE_RE.exec(holeId);
  if (terminal) {
    return terminalStripNode(terminal[1], Number(terminal[2]));
  }
  const railMatch = RAIL_HOLE_RE.exec(holeId);
  if (!railMatch) return null;
  if (definition.railModel === "unknown-unmodeled") return null;
  const rail = definition.rails.find(item => item.id === railMatch[1]);
  if (!rail || Number(railMatch[2]) > rail.holes) return null;
  return railNode(rail);
}

export function createBreadboardTopology(profile) {
  const definition = profileDefinition(profile);
  const topology = freezeDeep({
    schemaVersion: SCHEMA_VERSION,
    profileId: definition.id,
    profileLabel: definition.label,
    geometry: {
      terminalColumns: definition.terminalColumns,
      terminalRows: [...ALL_ROWS],
      leftRows: [...LEFT_ROWS],
      rightRows: [...RIGHT_ROWS],
      centerGapBetween: ["E", "F"],
    },
    claims: {
      fiveHoleTerminalStrips: true,
      centerGapIsolatesSides: true,
      powerRails: definition.railModel,
      automaticCircuitRouterInjection: false,
      conceptualAnchorImpliesHole: false,
      physicalPlacementVerified: false,
    },
    evidence: { ...definition.evidence },
    sections: [
      {
        id: "terminal-left",
        kind: "terminal-strip-field",
        rows: [...LEFT_ROWS],
        columns: definition.terminalColumns,
        nodeSize: 5,
      },
      {
        id: "terminal-right",
        kind: "terminal-strip-field",
        rows: [...RIGHT_ROWS],
        columns: definition.terminalColumns,
        nodeSize: 5,
      },
      {
        id: "power-rails",
        kind: "power-rail-field",
        model: definition.railModel,
        rails: definition.rails.map(item => ({ id: item.id, holes: item.holes })),
      },
    ],
    nodes: createNodes(definition),
  });
  TOPOLOGY_INSTANCES.add(topology);
  return topology;
}

export function breadboardNode(holeId, profile) {
  const definition = profileDefinition(profile);
  return nodeForHole(canonicalHoleId(holeId), definition);
}

export function areBreadboardHolesConnected(a, b, profile) {
  const definition = profileDefinition(profile);
  const first = nodeForHole(canonicalHoleId(a), definition);
  const second = nodeForHole(canonicalHoleId(b), definition);
  return !!first && !!second && first.id === second.id;
}

function layoutTerminalIds(layout) {
  if (!Array.isArray(layout && layout.terminals)) return null;
  const ids = layout.terminals.map(item => item && item.id);
  if (ids.some(id => typeof id !== "string" || !id)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return new Set(ids);
}

function validateExplicitPlacement(layout) {
  const terminalIds = layoutTerminalIds(layout);
  if (!terminalIds) throw new TypeError("layout.terminals không hợp lệ cho breadboard placement.");
  const placement = layout && layout.breadboardPlacement;
  if (!placement) return null;
  if (!layout.claims || layout.claims.breadboardHoleMapping !== true) {
    throw new RangeError("Layout có placement nhưng không bật explicit breadboardHoleMapping claim.");
  }
  if (
    placement.schemaVersion !== 1 ||
    placement.model !== PLACEMENT_MODEL ||
    placement.validatedBy !== PLACEMENT_VALIDATOR ||
    typeof placement.profileId !== "string" ||
    !placement.terminalToHole ||
    typeof placement.terminalToHole !== "object" ||
    Array.isArray(placement.terminalToHole)
  ) {
    throw new TypeError("breadboardPlacement không đúng explicit validated mapping schema.");
  }
  const definition = profileDefinition(placement.profileId);
  const usedHoles = new Set();
  for (const [mappedTerminal, rawHole] of Object.entries(placement.terminalToHole)) {
    if (!terminalIds.has(mappedTerminal)) {
      throw new RangeError("breadboardPlacement chứa terminal lạ: " + mappedTerminal);
    }
    const hole = canonicalHoleId(rawHole);
    const node = nodeForHole(hole, definition);
    if (!node) {
      throw new RangeError(
        "breadboardPlacement map vào hole chưa được profile chứng minh: " + hole,
      );
    }
    if (usedHoles.has(hole)) {
      throw new RangeError("Một breadboard hole không thể chứa hai terminal: " + hole);
    }
    usedHoles.add(hole);
  }
  return { placement, terminalIds, definition };
}

export function mapCircuitTerminalToHole(layout, terminalId) {
  if (typeof terminalId !== "string" || !terminalId) {
    throw new TypeError("terminalId phải là chuỗi không rỗng.");
  }
  const terminalIds = layoutTerminalIds(layout);
  if (!terminalIds) throw new TypeError("layout.terminals không hợp lệ.");
  if (!terminalIds.has(terminalId)) {
    throw new RangeError("Không có terminal " + terminalId + " trong layout.");
  }
  if (!layout || !layout.breadboardPlacement) return null;
  const validated = validateExplicitPlacement(layout);
  const rawHole = validated.placement.terminalToHole[terminalId];
  if (rawHole === undefined) return null;
  return canonicalHoleId(rawHole);
}
