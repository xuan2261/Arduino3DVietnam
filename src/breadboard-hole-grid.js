/**
 * Accessible authored-hole picker model for breadboard study UI.
 *
 * This module exposes only canonical profile/hole identities. It does not
 * contain CAD coordinates, scene transforms, circuit-router state, or any
 * operation that creates a placement. A UI may use a returned hole ID to fill
 * an input; the existing authored-placement validator remains the commit gate.
 */
import {
  breadboardNode,
  createBreadboardTopology,
} from "./breadboard-topology.js";

export const BREADBOARD_HOLE_GRID_PAGE_SIZE = 8;
export const BB830_RAIL_IDS = Object.freeze(["P1+", "P1-", "P2+", "P2-"]);

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

function normalizeProfileId(profileId) {
  if (typeof profileId !== "string" || !profileId.trim()) {
    throw new TypeError("profileId hole picker phải là chuỗi không rỗng.");
  }
  const topology = createBreadboardTopology(profileId.trim());
  return topology;
}

function normalizePage(page, pageCount) {
  if (!Number.isInteger(page)) {
    throw new TypeError("Trang hole picker phải là số nguyên.");
  }
  if (page < 1 || page > pageCount) {
    throw new RangeError("Trang hole picker nằm ngoài phạm vi 1.." + pageCount + ".");
  }
  return page;
}

function canonicalTerminalHoleId(holeId) {
  if (typeof holeId !== "string" || !holeId.trim()) {
    throw new TypeError("Hole picker cần holeId chuỗi không rỗng.");
  }
  const canonical = holeId.trim().toUpperCase();
  if (!/^([A-J])([1-9]|[1-5][0-9]|6[0-3])$/.test(canonical)) {
    throw new RangeError("Hole picker chỉ nhận terminal-strip hole A1..J63.");
  }
  return canonical;
}

function canonicalRailId(railId) {
  if (typeof railId !== "string" || !railId.trim()) {
    throw new TypeError("Rail picker cần railId chuỗi không rỗng.");
  }
  const canonical = railId.trim().toUpperCase();
  if (!BB830_RAIL_IDS.includes(canonical)) {
    throw new RangeError("Rail picker chỉ nhận P1+, P1-, P2+, P2-.");
  }
  return canonical;
}

function canonicalRailIndex(index) {
  if (typeof index === "string") {
    const trimmed = index.trim();
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(trimmed)) {
      throw new RangeError("Chỉ số rail phải là số nguyên 1..50.");
    }
    return Number(trimmed);
  }
  if (!Number.isInteger(index) || index < 1 || index > 50) {
    throw new RangeError("Chỉ số rail phải là số nguyên 1..50.");
  }
  return index;
}

export function listBreadboardRailChoices(profileId) {
  const topology = normalizeProfileId(profileId);
  const railSection = topology.sections.find(section => section.id === "power-rails");
  const enabled = topology.profileId === "busboard-bb830-rev7" &&
    railSection?.model === "four-independent-50-tie-point-rails";

  if (!enabled) {
    return freezeDeep({
      profileId: topology.profileId,
      enabled: false,
      reason: "profile-rails-unverified",
      rails: [],
      claims: {
        genericRailContinuityAssumed: false,
        physicalContactSimulated: false,
        circuitRouterMutated: false,
      },
    });
  }

  const rails = railSection.rails.map(rail => {
    if (!BB830_RAIL_IDS.includes(rail.id) || rail.holes !== 50) {
      throw new RangeError("Profile BB830 không khớp hợp đồng rail 4 × 50.");
    }
    const first = breadboardNode(rail.id + "1", topology);
    const last = breadboardNode(rail.id + "50", topology);
    if (!first || !last || first.id !== last.id || first.kind !== "power-rail") {
      throw new RangeError("Rail BB830 không tạo được node liên tục đã xác minh.");
    }
    return {
      id: rail.id,
      signedLabel: rail.id,
      holes: 50,
      nodeId: first.id,
      continuityScope: "profile-internal-node-only",
    };
  });
  if (rails.length !== 4) {
    throw new RangeError("Profile BB830 phải có đúng bốn rail đã xác minh.");
  }

  return freezeDeep({
    profileId: topology.profileId,
    enabled: true,
    reason: null,
    rails,
    claims: {
      eachRailContinuousAcross50Holes: true,
      railsMutuallyConnected: false,
      legendPolarityPowersCircuit: false,
      physicalContactSimulated: false,
      circuitRouterMutated: false,
    },
  });
}

export function createBreadboardHoleGridPage({ profileId, page = 1 } = {}) {
  const topology = normalizeProfileId(profileId);
  const terminalColumns = topology.geometry.terminalColumns;
  const rows = topology.geometry.terminalRows;
  if (terminalColumns !== 63 || !Array.isArray(rows) || rows.join("") !== "ABCDEFGHIJ") {
    throw new RangeError("Profile không khớp hợp đồng terminal-strip A-J × 63.");
  }
  const pageCount = Math.ceil(terminalColumns / BREADBOARD_HOLE_GRID_PAGE_SIZE);
  const currentPage = normalizePage(page, pageCount);
  const columnStart = (currentPage - 1) * BREADBOARD_HOLE_GRID_PAGE_SIZE + 1;
  const columnEnd = Math.min(
    terminalColumns,
    columnStart + BREADBOARD_HOLE_GRID_PAGE_SIZE - 1,
  );
  const columns = Array.from(
    { length: columnEnd - columnStart + 1 },
    (_unused, offset) => columnStart + offset,
  );
  const holes = [];
  for (const column of columns) {
    for (const row of rows) {
      const id = row + column;
      const node = breadboardNode(id, topology);
      if (!node || node.kind !== "terminal-strip") {
        throw new RangeError("Profile không tạo được terminal-strip hole canonical: " + id);
      }
      holes.push({
        id,
        row,
        column,
        nodeId: node.id,
        nodeKind: node.kind,
      });
    }
  }

  const rails = listBreadboardRailChoices(topology.profileId);
  return freezeDeep({
    profileId: topology.profileId,
    page: currentPage,
    pageCount,
    pageSize: BREADBOARD_HOLE_GRID_PAGE_SIZE,
    terminalColumns,
    columnStart,
    columnEnd,
    columns,
    rows: [...rows],
    holes,
    previousPage: currentPage > 1 ? currentPage - 1 : null,
    nextPage: currentPage < pageCount ? currentPage + 1 : null,
    railPickerEnabled: rails.enabled,
    claims: {
      canonicalHoleIdsOnly: true,
      cadCoordinatesProvided: false,
      sceneCoordinatesProvided: false,
      placementCreated: false,
      circuitRouterMutated: false,
      physicalContactSimulated: false,
    },
  });
}

export function pickBreadboardGridHole({ profileId, page, holeId } = {}) {
  const grid = createBreadboardHoleGridPage({ profileId, page });
  const canonical = canonicalTerminalHoleId(holeId);
  const record = grid.holes.find(hole => hole.id === canonical);
  if (!record) {
    throw new RangeError(
      "Hole " + canonical + " không thuộc trang picker hiện tại " + grid.page + ".",
    );
  }
  return freezeDeep({
    profileId: grid.profileId,
    page: grid.page,
    holeId: record.id,
    row: record.row,
    column: record.column,
    nodeId: record.nodeId,
    selectionKind: "terminal-strip-input-only",
    claims: {
      inputValueOnly: true,
      placementCreated: false,
      circuitRouterMutated: false,
      physicalContactSimulated: false,
    },
  });
}

export function pickBreadboardRailHole({ profileId, railId, index } = {}) {
  const railState = listBreadboardRailChoices(profileId);
  if (!railState.enabled) {
    throw new RangeError("Rail picker bị khóa vì profile hiện tại chưa xác minh topology rail.");
  }
  const canonicalRail = canonicalRailId(railId);
  const canonicalIndex = canonicalRailIndex(index);
  const rail = railState.rails.find(item => item.id === canonicalRail);
  if (!rail) {
    throw new RangeError("Rail không thuộc profile BB830 hiện tại: " + canonicalRail);
  }
  const holeId = canonicalRail + canonicalIndex;
  const node = breadboardNode(holeId, railState.profileId);
  if (!node || node.kind !== "power-rail" || node.id !== rail.nodeId) {
    throw new RangeError("Rail hole không khớp node BB830 đã xác minh: " + holeId);
  }
  return freezeDeep({
    profileId: railState.profileId,
    railId: canonicalRail,
    index: canonicalIndex,
    holeId,
    nodeId: node.id,
    selectionKind: "bb830-rail-input-only",
    claims: {
      selectedRailContinuousAcross50Holes: true,
      inputValueOnly: true,
      placementCreated: false,
      circuitRouterMutated: false,
      physicalContactSimulated: false,
    },
  });
}
