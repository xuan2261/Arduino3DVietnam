import {
  BREADBOARD_AUTHORED_GROUPS_MODEL,
  BREADBOARD_AUTHORED_GROUPS_SCHEMA_VERSION,
  groupBreadboardAuthoredPlacement,
} from "../src/breadboard-authored-groups.js";
import { createBreadboardPlacement } from "../src/breadboard-placement.js";

const GENERIC = "generic-63x10-terminal-strips";
const BB830 = "busboard-bb830-rev7";

const TERMINALS = Object.freeze([
  Object.freeze({ id: "D13", component: "arduino" }),
  Object.freeze({ id: "R1:A", component: "resistor" }),
  Object.freeze({ id: "R1:B", component: "resistor" }),
  Object.freeze({ id: "LED:A", component: "led" }),
  Object.freeze({ id: "LED:K", component: "led" }),
  Object.freeze({ id: "GND", component: "arduino" }),
]);

function assert(condition, message) {
  if (!condition) throw new Error("breadboard-authored-groups contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function placement(profileId, terminalToHole) {
  return createBreadboardPlacement({
    profileId,
    terminals: TERMINALS,
    terminalToHole,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function runBreadboardAuthoredGroupsContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("stable-schema-and-model", () => {
    assert(BREADBOARD_AUTHORED_GROUPS_SCHEMA_VERSION === 1, "schema version");
    assert(BREADBOARD_AUTHORED_GROUPS_MODEL === "explicit-session-authored-contact-groups-v1", "model id");
  });

  check("generic-left-strip-groups-explicit-terminals", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(GENERIC, {
      D13: "A12",
      "R1:A": "E12",
    }), TERMINALS);
    assert(grouped.groupCount === 1 && grouped.knownGroupCount === 1 && grouped.unknownGroupCount === 0,
      "one known group");
    const group = grouped.groups[0];
    assert(group.status === "known" && group.nodeId === "strip:12:left" && group.nodeKind === "terminal-strip",
      "left node identity");
    assert(group.label === "Cột 12 · dải A–E" && group.region === "A-E", "left group label");
    assert(group.terminalIds.join(",") === "D13,R1:A" && group.holeIds.join(",") === "A12,E12",
      "explicit terminal/hole order");
    assert(group.members.join(",") === "A12,B12,C12,D12,E12", "profile contact members");
  });

  check("generic-right-strip-groups-explicit-terminals", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(GENERIC, {
      "R1:B": "F9",
      "LED:A": "J9",
    }));
    const group = grouped.groups[0];
    assert(group.nodeId === "strip:9:right" && group.label === "Cột 9 · dải F–J" && group.region === "F-J",
      "right group identity/label");
    assert(group.members.join(",") === "F9,G9,H9,I9,J9", "right contact members");
  });

  check("center-gap-never-merges-left-and-right", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(GENERIC, {
      D13: "E3",
      "R1:A": "F3",
    }));
    assert(grouped.groupCount === 2, "E/F same column must be separate groups");
    assert(grouped.groups[0].nodeId === "strip:3:left" && grouped.groups[1].nodeId === "strip:3:right",
      "center gap node IDs");
  });

  check("different-columns-never-merge", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(GENERIC, {
      D13: "A3",
      "R1:A": "B4",
    }));
    assert(grouped.groupCount === 2 && grouped.groups[0].nodeId !== grouped.groups[1].nodeId,
      "different columns separate");
  });

  check("bb830-same-signed-rail-groups-endpoints", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(BB830, {
      D13: "P1+1",
      "R1:A": "P1+50",
    }));
    const group = grouped.groups[0];
    assert(group.nodeId === "rail:P1+" && group.nodeKind === "power-rail" && group.region === "P1+",
      "P1+ group identity");
    assert(group.label === "Rail P1+ · 50 lỗ độc lập trong profile", "BB830 rail label");
    assert(group.members.length === 50 && group.members[0] === "P1+1" && group.members.at(-1) === "P1+50",
      "P1+ exact 50-hole scope");
  });

  check("bb830-four-signed-rails-remain-independent", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(BB830, {
      D13: "P1+1",
      "R1:A": "P1-1",
      "R1:B": "P2+1",
      "LED:A": "P2-1",
    }));
    assert(grouped.groupCount === 4 && grouped.knownGroupCount === 4, "four independent groups");
    assert(grouped.groups.map(group => group.nodeId).join(",") === "rail:P1+,rail:P1-,rail:P2+,rail:P2-",
      "signed rail node order");
    assert(grouped.groups.every(group => group.members.length === 50), "each signed rail is exactly50 holes");
  });

  check("generic-rail-remains-unverified-and-cannot-enter-grouping", () => {
    expectThrow(
      () => placement(GENERIC, { D13: "P1+1" }),
      /profile chứng minh|chưa được profile/i,
      "generic rail placement rejected before grouping",
    );
  });

  check("projection-claims-stay-read-only-and-nonphysical", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(GENERIC, { D13: "A1" }));
    const claims = grouped.claims;
    assert(
      claims.explicitSessionPlacementOnly === true &&
      claims.profileInternalGroupingOnly === true &&
      claims.automaticHoleMapping === false &&
      claims.automaticWireCreation === false &&
      claims.circuitRouterMutated === false &&
      claims.sceneCoordinateMapped === false &&
      claims.physicalPlacementVerified === false &&
      claims.mechanicalFitVerified === false &&
      claims.voltageInferred === false &&
      claims.currentInferred === false &&
      claims.electricalSafetyVerified === false,
      "read-only claims",
    );
  });

  check("projection-and-nested-groups-are-deep-frozen", () => {
    const grouped = groupBreadboardAuthoredPlacement(placement(GENERIC, { D13: "A1", "R1:A": "E1" }));
    assert(Object.isFrozen(grouped) && Object.isFrozen(grouped.groups) && Object.isFrozen(grouped.groups[0]),
      "root/groups frozen");
    assert(Object.isFrozen(grouped.groups[0].placements) && grouped.groups[0].placements.every(Object.isFrozen),
      "placement rows frozen");
    assert(Object.isFrozen(grouped.groups[0].members) && Object.isFrozen(grouped.claims), "members/claims frozen");
  });

  check("negative-null-or-forged-placement-rejected", () => {
    expectThrow(() => groupBreadboardAuthoredPlacement(null), /placement|không hợp lệ/i, "null placement");
    expectThrow(() => groupBreadboardAuthoredPlacement({}), /placement|không hợp lệ/i, "empty object placement");
  });

  check("negative-prototype-terminal-ids-rejected", () => {
    for (const terminalId of ["constructor", "toString", "__proto__"]) {
      const terminals = [{ id: terminalId, component: "sensor" }];
      const mapping = Object.create(null);
      mapping[terminalId] = "A1";
      const forgedButPlacementValid = createBreadboardPlacement({
        profileId: GENERIC,
        terminals,
        terminalToHole: mapping,
      });
      expectThrow(
        () => groupBreadboardAuthoredPlacement(forgedButPlacementValid, terminals),
        /prototype/i,
        "prototype terminal " + terminalId,
      );
    }
  });

  check("negative-custom-mapping-prototype-rejected", () => {
    const valid = placement(GENERIC, { D13: "A1" });
    const forged = clone(valid);
    forged.terminalToHole = Object.assign(Object.create({ inheritedTerminal: "B1" }), forged.terminalToHole);
    expectThrow(
      () => groupBreadboardAuthoredPlacement(forged, TERMINALS),
      /prototype tùy biến/i,
      "custom mapping prototype",
    );
  });

  check("negative-symbol-mapping-key-rejected", () => {
    const valid = placement(GENERIC, { D13: "A1" });
    const forged = clone(valid);
    forged.terminalToHole[Symbol("forged")] = "B1";
    expectThrow(
      () => groupBreadboardAuthoredPlacement(forged, TERMINALS),
      /symbol key/i,
      "symbol mapping key",
    );
  });

  check("negative-duplicate-hole-mapping-rejected", () => {
    const forged = clone(placement(GENERIC, { D13: "A1", "R1:A": "B1" }));
    forged.terminalToHole["R1:A"] = "A1";
    forged.placements[1].holeId = "A1";
    forged.placements[1].nodeId = "strip:1:left";
    expectThrow(
      () => groupBreadboardAuthoredPlacement(forged, TERMINALS),
      /hai terminal|không hợp lệ|record/i,
      "duplicate hole",
    );
  });

  check("negative-forged-node-id-rejected", () => {
    const forged = clone(placement(GENERIC, { D13: "A1" }));
    forged.placements[0].nodeId = "strip:1:right";
    expectThrow(
      () => groupBreadboardAuthoredPlacement(forged, TERMINALS),
      /record không nhất quán|nodeId/i,
      "forged node id",
    );
  });

  check("negative-foreign-terminal-mapping-rejected", () => {
    const forged = clone(placement(GENERIC, { D13: "A1" }));
    forged.terminalToHole.FOREIGN = "B1";
    expectThrow(
      () => groupBreadboardAuthoredPlacement(forged, TERMINALS),
      /terminal lạ|không hợp lệ/i,
      "foreign mapping terminal",
    );
  });

  check("negative-expected-terminal-set-mismatch-rejected", () => {
    const valid = placement(GENERIC, { D13: "A1" });
    expectThrow(
      () => groupBreadboardAuthoredPlacement(valid, TERMINALS.slice(0, -1)),
      /terminal set|không khớp|không hợp lệ/i,
      "expected terminal mismatch",
    );
  });

  check("group-provenance-is-selected-profile-provenance", () => {
    const generic = groupBreadboardAuthoredPlacement(placement(GENERIC, { D13: "A1" }));
    const bb830 = groupBreadboardAuthoredPlacement(placement(BB830, { D13: "P1+1" }));
    assert(generic.groups[0].provenance.scope === "generic-terminal-field-only", "generic provenance scope");
    assert(bb830.groups[0].provenance.scope === "bb830-rev7-profile", "BB830 provenance scope");
    assert(bb830.groups[0].provenance.sources.some(source => /busboard\.com\/BB830/i.test(source.url)),
      "BB830 manufacturer source retained");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
