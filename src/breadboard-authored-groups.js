/**
 * Read-only grouping for explicit session-authored breadboard placements.
 *
 * The input must already satisfy breadboard-placement's proof gate. This module
 * only projects those explicit terminal -> hole records into the internal
 * contact nodes of the selected profile. It never infers a hole, creates a
 * wire, reads scene coordinates, evaluates voltage/current, or validates a
 * physical build.
 */
import { validateBreadboardPlacement } from "./breadboard-placement.js";
import { inspectBreadboardContactGroup } from "./breadboard-hole-grid.js";

export const BREADBOARD_AUTHORED_GROUPS_SCHEMA_VERSION = 1;
export const BREADBOARD_AUTHORED_GROUPS_MODEL =
  "explicit-session-authored-contact-groups-v1";

const UNSAFE_TERMINAL_IDS = new Set(["__proto__", "prototype"]);

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

function expectedTerminals(placement, terminals) {
  return terminals === undefined ? placement?.terminals : terminals;
}

function assertSafeTerminalId(id, label) {
  if (typeof id !== "string" || !id) {
    throw new TypeError(label + " phải là terminal ID chuỗi không rỗng.");
  }
  if (
    UNSAFE_TERMINAL_IDS.has(id) ||
    Object.hasOwn(Object.prototype, id)
  ) {
    throw new RangeError(label + " dùng tên prototype không được hỗ trợ: " + id);
  }
  return id;
}

function assertSafeMappingObject(mapping) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new TypeError("placement.terminalToHole phải là object.");
  }
  const prototype = Object.getPrototypeOf(mapping);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new RangeError("placement.terminalToHole có prototype tùy biến không được hỗ trợ.");
  }
  for (const key of Reflect.ownKeys(mapping)) {
    if (typeof key !== "string") {
      throw new RangeError("placement.terminalToHole không được có symbol key.");
    }
    assertSafeTerminalId(key, "terminalToHole key");
    const descriptor = Object.getOwnPropertyDescriptor(mapping, key);
    if (!descriptor?.enumerable) {
      throw new RangeError("terminalToHole key phải enumerable: " + key);
    }
  }
}

function terminalStripLabel(inspection) {
  const match = /^strip:(\d+):(left|right)$/.exec(inspection.nodeId || "");
  if (!match) {
    throw new RangeError("Terminal-strip node ID không canonical: " + inspection.nodeId);
  }
  const side = match[2];
  return {
    label: "Cột " + match[1] + " · dải " + (side === "left" ? "A–E" : "F–J"),
    region: side === "left" ? "A-E" : "F-J",
  };
}

function powerRailLabel(inspection) {
  const match = /^rail:(P[12][+-])$/.exec(inspection.nodeId || "");
  if (!match || inspection.members.length !== 50) {
    throw new RangeError("BB830 rail node không khớp hợp đồng signed 50-hole rail.");
  }
  return {
    label: "Rail " + match[1] + " · 50 lỗ độc lập trong profile",
    region: match[1],
  };
}

function groupDescriptor(inspection) {
  if (inspection.status !== "known") {
    return {
      label: "Nhóm chưa xác minh trong profile",
      region: "unknown",
    };
  }
  if (inspection.nodeKind === "terminal-strip") return terminalStripLabel(inspection);
  if (inspection.nodeKind === "power-rail") return powerRailLabel(inspection);
  throw new RangeError("nodeKind authored group không được hỗ trợ: " + inspection.nodeKind);
}

function copyPlacementRecord(record) {
  return {
    terminalId: record.terminalId,
    component: record.component,
    holeId: record.holeId,
  };
}

/**
 * Group an already validated explicit placement by selected-profile contact node.
 *
 * Generic power rails remain unmodeled. A forged generic-rail placement cannot
 * reach an "unknown" group because breadboard-placement rejects it before this
 * projection is constructed. `unknown` remains an explicit fail-closed display
 * status for future validated profile schemas rather than an inference path.
 */
export function groupBreadboardAuthoredPlacement(placement, terminals = undefined) {
  const expected = expectedTerminals(placement, terminals);
  const validation = validateBreadboardPlacement(placement, expected);
  if (!validation.ok) {
    throw new RangeError(
      "Authored placement không hợp lệ để group: " + validation.errors.join("; "),
    );
  }
  assertSafeMappingObject(placement.terminalToHole);

  const terminalIds = new Set();
  for (const terminal of placement.terminals) {
    assertSafeTerminalId(terminal.id, "placement terminal ID");
    if (terminalIds.has(terminal.id)) {
      throw new RangeError("placement terminal ID bị trùng: " + terminal.id);
    }
    terminalIds.add(terminal.id);
  }

  const ownMappingKeys = Object.keys(placement.terminalToHole);
  if (ownMappingKeys.length !== placement.placements.length) {
    throw new RangeError("terminalToHole và placements không có cùng số mapping explicit.");
  }

  const grouped = new Map();
  const seenTerminals = new Set();
  const seenHoles = new Set();
  for (const record of placement.placements) {
    assertSafeTerminalId(record.terminalId, "placement record terminal ID");
    if (!terminalIds.has(record.terminalId) || !Object.hasOwn(placement.terminalToHole, record.terminalId)) {
      throw new RangeError("placement record không có mapping terminal canonical: " + record.terminalId);
    }
    if (seenTerminals.has(record.terminalId)) {
      throw new RangeError("placement record terminal bị trùng: " + record.terminalId);
    }
    if (seenHoles.has(record.holeId)) {
      throw new RangeError("placement record hole bị trùng: " + record.holeId);
    }
    seenTerminals.add(record.terminalId);
    seenHoles.add(record.holeId);

    const inspection = inspectBreadboardContactGroup({
      profileId: placement.profileId,
      holeId: record.holeId,
    });
    if (inspection.status === "known" && inspection.nodeId !== record.nodeId) {
      throw new RangeError(
        "placement nodeId không khớp profile inspection cho " + record.holeId + ".",
      );
    }
    if (inspection.status !== "known" && record.nodeId != null) {
      throw new RangeError(
        "placement khai node đã biết nhưng profile inspection trả unknown cho " + record.holeId + ".",
      );
    }
    const key = inspection.status === "known"
      ? "known\u0000" + inspection.nodeId
      : "unknown\u0000" + inspection.holeId;
    let bucket = grouped.get(key);
    if (!bucket) {
      const descriptor = groupDescriptor(inspection);
      bucket = {
        status: inspection.status,
        nodeId: inspection.nodeId,
        nodeKind: inspection.nodeKind,
        label: descriptor.label,
        region: descriptor.region,
        members: [...inspection.members],
        provenance: inspection.provenance,
        evidence: inspection.evidence,
        placements: [],
      };
      grouped.set(key, bucket);
    }
    bucket.placements.push(copyPlacementRecord(record));
  }

  const groups = [...grouped.values()].map((group, index) => ({
    order: index + 1,
    status: group.status,
    nodeId: group.nodeId,
    nodeKind: group.nodeKind,
    label: group.label,
    region: group.region,
    terminalIds: group.placements.map(item => item.terminalId),
    holeIds: group.placements.map(item => item.holeId),
    members: group.members,
    placements: group.placements,
    provenance: group.provenance,
    evidence: group.evidence,
  }));

  return freezeDeep({
    schemaVersion: BREADBOARD_AUTHORED_GROUPS_SCHEMA_VERSION,
    model: BREADBOARD_AUTHORED_GROUPS_MODEL,
    profileId: placement.profileId,
    placementModel: placement.model,
    mappedTerminalCount: placement.placements.length,
    groupCount: groups.length,
    knownGroupCount: groups.filter(group => group.status === "known").length,
    unknownGroupCount: groups.filter(group => group.status !== "known").length,
    groups,
    claims: {
      explicitSessionPlacementOnly: true,
      profileInternalGroupingOnly: true,
      automaticHoleMapping: false,
      automaticWireCreation: false,
      circuitRouterMutated: false,
      sceneCoordinateMapped: false,
      physicalPlacementVerified: false,
      mechanicalFitVerified: false,
      voltageInferred: false,
      currentInferred: false,
      electricalSafetyVerified: false,
    },
  });
}
