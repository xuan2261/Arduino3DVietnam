import {
  createBreadboardTopology,
  breadboardNode,
  areBreadboardHolesConnected,
  mapCircuitTerminalToHole,
} from "../src/breadboard-topology.js";

function assert(ok, label) {
  if (!ok) throw new Error("breadboard-topology contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  assert(error && pattern.test(String((error && error.message) || error)), label);
}

function conceptualLayout() {
  return {
    claims: { breadboardHoleMapping: false },
    terminals: [
      { id: "arduino:D13", component: "arduino" },
      { id: "R1:A", component: "R1" },
      { id: "R1:B", component: "R1" },
    ],
    terminalMap: {
      "arduino:D13": { anchorModel: "conceptual-perimeter", x: 1, z: 2 },
      "R1:A": { anchorModel: "conceptual-perimeter", x: 3, z: 4 },
      "R1:B": { anchorModel: "conceptual-perimeter", x: 5, z: 6 },
    },
  };
}

function mappedLayout() {
  return {
    claims: { breadboardHoleMapping: true },
    terminals: conceptualLayout().terminals,
    breadboardPlacement: {
      schemaVersion: 1,
      model: "explicit-validated-breadboard-placement-v1",
      validatedBy: "breadboard-topology-v1",
      profileId: "busboard-bb830-rev7",
      terminalToHole: {
        "arduino:D13": "A12",
        "R1:A": "B12",
        "R1:B": "F12",
      },
    },
  };
}

export function runBreadboardTopologyContracts() {
  const checks = [];
  const check = (name, run) => {
    run();
    checks.push(name);
  };

  const generic = createBreadboardTopology();
  const bb830 = createBreadboardTopology("busboard-bb830-rev7");

  check("default-profile-id", () => {
    assert(generic.profileId === "generic-63x10-terminal-strips", "default profile ID");
  });
  check("generic-terminal-columns", () => {
    assert(generic.geometry.terminalColumns === 63, "63 terminal columns");
  });
  check("generic-five-hole-claim", () => {
    assert(generic.claims.fiveHoleTerminalStrips === true, "five-hole strip claim");
  });
  check("generic-center-gap-claim", () => {
    assert(generic.claims.centerGapIsolatesSides === true, "center gap isolation claim");
  });
  check("generic-rails-unknown", () => {
    assert(generic.claims.powerRails === "unknown-unmodeled", "default rails unknown");
  });
  check("no-router-injection-claim", () => {
    assert(generic.claims.automaticCircuitRouterInjection === false, "no router injection");
  });
  check("conceptual-anchor-no-hole-claim", () => {
    assert(generic.claims.conceptualAnchorImpliesHole === false, "conceptual anchors imply no hole");
  });
  check("topology-deep-frozen", () => {
    assert(
      Object.isFrozen(generic) &&
      Object.isFrozen(generic.nodes) &&
      generic.nodes.every(Object.isFrozen),
      "topology graph frozen",
    );
  });
  check("generic-has-126-terminal-nodes", () => {
    assert(generic.nodes.length === 126, "63 columns x two terminal nodes");
  });
  check("left-strip-a-e-connected", () => {
    assert(areBreadboardHolesConnected("A1", "E1"), "A1..E1 connected");
  });
  check("right-strip-f-j-connected", () => {
    assert(areBreadboardHolesConnected("F63", "J63"), "F63..J63 connected");
  });
  check("split-row-adjacent-columns-disconnected", () => {
    assert(!areBreadboardHolesConnected("A1", "A2"), "adjacent columns separate");
  });
  check("center-trench-disconnected", () => {
    assert(!areBreadboardHolesConnected("E12", "F12"), "center gap isolates sides");
  });
  check("left-node-identity", () => {
    assert(breadboardNode("c7").id === "strip:7:left", "case-normalized left node");
  });
  check("right-node-identity", () => {
    assert(breadboardNode("H7").id === "strip:7:right", "right node identity");
  });
  check("node-has-exact-five-holes", () => {
    const node = breadboardNode("D20");
    assert(
      node.holeCount === 5 &&
      node.holes.join(",") === "A20,B20,C20,D20,E20",
      "five-hole strip enumeration",
    );
  });
  check("generic-valid-rail-hole-unmodeled", () => {
    assert(breadboardNode("P1+25") === null, "generic rail node unknown");
  });
  check("generic-unknown-rail-never-connects", () => {
    assert(!areBreadboardHolesConnected("P1+1", "P1+2"), "unknown rail cannot imply connectivity");
  });
  check("bb830-profile-id", () => {
    assert(bb830.profileId === "busboard-bb830-rev7", "BB830 profile ID");
  });
  check("bb830-four-independent-rails", () => {
    const rails = bb830.sections.find(section => section.id === "power-rails");
    assert(
      rails.model === "four-independent-50-tie-point-rails" &&
      rails.rails.length === 4,
      "BB830 four-rail model",
    );
  });
  check("bb830-each-rail-has-50-holes", () => {
    const rails = bb830.sections.find(section => section.id === "power-rails").rails;
    assert(rails.every(rail => rail.holes === 50), "all rails 50 tie points");
  });
  check("bb830-same-power-rail-connected", () => {
    assert(
      areBreadboardHolesConnected("P1+1", "P1+50", bb830),
      "same BB830 50-hole rail connected",
    );
  });
  check("bb830-plus-minus-rails-separated", () => {
    assert(
      !areBreadboardHolesConnected("P1+10", "P1-10", bb830),
      "parallel rail strips separate",
    );
  });
  check("bb830-rail-seam-between-distribution-strips", () => {
    assert(
      !areBreadboardHolesConnected("P1+50", "P2+1", bb830),
      "separate power rails must not bridge",
    );
  });
  check("bb830-rail-polarity-is-legend-only", () => {
    assert(
      breadboardNode("P2-33", bb830).polarityMeaning === "legend-only",
      "rail markings do not prove polarity",
    );
  });
  check("bb830-terminal-strip-behavior", () => {
    assert(
      areBreadboardHolesConnected("B31", "E31", bb830),
      "terminal strip behavior preserved",
    );
  });
  check("forged-profile-object-rejected", () => {
    expectThrow(
      () => createBreadboardTopology({ profileId: "busboard-bb830-rev7" }),
      /profile/i,
      "forged profile object rejected",
    );
  });
  check("forged-branded-profile-object-rejected", () => {
    expectThrow(
      () => createBreadboardTopology({
        schemaVersion: 1,
        profileId: "busboard-bb830-rev7",
      }),
      /profile/i,
      "lookalike topology rejected",
    );
  });
  check("unknown-profile-id-rejected", () => {
    expectThrow(
      () => createBreadboardTopology("mystery-board"),
      /profile/i,
      "unknown profile rejected",
    );
  });
  check("malformed-hole-rejected", () => {
    expectThrow(() => breadboardNode("../A1"), /hole/i, "path-like hole rejected");
  });
  check("out-of-range-terminal-hole-rejected", () => {
    expectThrow(() => breadboardNode("A64"), /hole/i, "terminal column >63 rejected");
  });
  check("out-of-range-rail-hole-rejected", () => {
    expectThrow(() => breadboardNode("P1+51", bb830), /hole/i, "rail index >50 rejected");
  });
  check("center-gap-is-not-a-hole", () => {
    expectThrow(() => breadboardNode("GAP12"), /hole/i, "center trench cannot be addressed as a hole");
  });
  check("conceptual-layout-unmapped", () => {
    assert(
      mapCircuitTerminalToHole(conceptualLayout(), "R1:A") === null,
      "conceptual layout remains unmapped",
    );
  });
  check("forged-nonphysical-anchor-ignored", () => {
    const layout = conceptualLayout();
    layout.terminalMap["R1:A"].holeId = "A1";
    layout.terminalMap["R1:A"].physicalVerified = true;
    assert(
      mapCircuitTerminalToHole(layout, "R1:A") === null,
      "terminalMap anchor cannot forge placement",
    );
  });
  check("explicit-mapping-resolves-hole", () => {
    assert(
      mapCircuitTerminalToHole(mappedLayout(), "R1:A") === "B12",
      "explicit validated mapping returns hole",
    );
  });
  check("explicit-mapping-can-share-node-with-distinct-holes", () => {
    const layout = mappedLayout();
    const first = mapCircuitTerminalToHole(layout, "arduino:D13");
    const second = mapCircuitTerminalToHole(layout, "R1:A");
    assert(
      first !== second &&
      areBreadboardHolesConnected(first, second, "busboard-bb830-rev7"),
      "two different holes in same node may be mapped",
    );
  });
  check("unmapped-terminal-remains-null", () => {
    const layout = mappedLayout();
    delete layout.breadboardPlacement.terminalToHole["R1:B"];
    assert(
      mapCircuitTerminalToHole(layout, "R1:B") === null,
      "missing explicit placement stays unmapped",
    );
  });
  check("unknown-terminal-rejected", () => {
    expectThrow(
      () => mapCircuitTerminalToHole(mappedLayout(), "NOPE"),
      /terminal/i,
      "unknown terminal rejected",
    );
  });
  check("placement-needs-explicit-claim", () => {
    const layout = mappedLayout();
    layout.claims.breadboardHoleMapping = false;
    expectThrow(
      () => mapCircuitTerminalToHole(layout, "R1:A"),
      /claim/i,
      "mapping without explicit claim rejected",
    );
  });
  check("placement-schema-forgery-rejected", () => {
    const layout = mappedLayout();
    layout.breadboardPlacement.validatedBy = "self-asserted";
    expectThrow(
      () => mapCircuitTerminalToHole(layout, "R1:A"),
      /schema|mapping/i,
      "self-asserted placement marker rejected",
    );
  });
  check("placement-unknown-profile-rejected", () => {
    const layout = mappedLayout();
    layout.breadboardPlacement.profileId = "unknown";
    expectThrow(
      () => mapCircuitTerminalToHole(layout, "R1:A"),
      /profile/i,
      "placement unknown profile rejected",
    );
  });
  check("placement-unmodeled-rail-rejected", () => {
    const layout = mappedLayout();
    layout.breadboardPlacement.profileId = "generic-63x10-terminal-strips";
    layout.breadboardPlacement.terminalToHole["R1:A"] = "P1+1";
    expectThrow(
      () => mapCircuitTerminalToHole(layout, "R1:A"),
      /profile chứng minh/i,
      "generic unknown rail mapping rejected",
    );
  });
  check("placement-foreign-terminal-rejected", () => {
    const layout = mappedLayout();
    layout.breadboardPlacement.terminalToHole.EXTRA = "C1";
    expectThrow(
      () => mapCircuitTerminalToHole(layout, "R1:A"),
      /terminal lạ/i,
      "foreign placement terminal rejected",
    );
  });
  check("placement-exact-hole-collision-rejected", () => {
    const layout = mappedLayout();
    layout.breadboardPlacement.terminalToHole["R1:A"] = "A12";
    expectThrow(
      () => mapCircuitTerminalToHole(layout, "R1:A"),
      /hai terminal/i,
      "same physical hole cannot host two terminals",
    );
  });
  check("topology-object-can-be-used-as-profile", () => {
    assert(
      areBreadboardHolesConnected("P2-1", "P2-50", bb830),
      "real topology handle accepted",
    );
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
