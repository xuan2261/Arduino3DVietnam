import {
  supportedWiringLessons,
  listTerminals,
} from "../src/circuit-router.js";
import {
  ARDUINO_UNO_R3_PINOUT_PROVENANCE,
  BREADBOARD_PLACEMENT_MODEL,
  createBreadboardPlacement,
  describeArduinoUnoR3Pin,
  diagnosePlacedTerminalPair,
  mapBreadboardPlacementTerminalToHole,
  validateBreadboardPlacement,
} from "../src/breadboard-placement.js";

function assert(ok, label) {
  if (!ok) throw new Error("breadboard-placement contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  assert(error && pattern.test(String(error?.message || error)), label);
}

const HOLE_ROWS = Object.freeze(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);

function uniqueTerminalHole(index) {
  const column = Math.floor(index / HOLE_ROWS.length) + 1;
  if (column > 63) throw new RangeError("Test fixture vượt 630 terminal holes.");
  return HOLE_ROWS[index % HOLE_ROWS.length] + column;
}

function completeMapping(terminals) {
  return Object.fromEntries(
    terminals.map((terminal, index) => [terminal.id, uniqueTerminalHole(index)]),
  );
}

function lesson2Fixture(profileId = "generic-63x10-terminal-strips") {
  const terminals = listTerminals(2);
  return createBreadboardPlacement({
    profileId,
    terminals,
    terminalToHole: {
      D13: "A12",
      "R1:A": "B12",
      "R1:B": "F12",
    },
  });
}

function mutableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function runBreadboardPlacementContracts() {
  const checks = [];
  const check = (name, run) => {
    run();
    checks.push(name);
  };

  check("official-uno-pinout-provenance", () => {
    assert(
      ARDUINO_UNO_R3_PINOUT_PROVENANCE.source ===
        "https://content.arduino.cc/assets/A000066-full-pinout.pdf" &&
      ARDUINO_UNO_R3_PINOUT_PROVENANCE.sku === "A000066" &&
      ARDUINO_UNO_R3_PINOUT_PROVENANCE.confidence === "official-manufacturer",
      "Arduino Uno R3 pin vocabulary must cite the official A000066 pinout",
    );
  });

  check("official-d13-description", () => {
    const pin = describeArduinoUnoR3Pin("D13");
    assert(
      pin?.id === "D13" &&
      pin.role === "digital-gpio" &&
      pin.connectable === true &&
      /A000066-full-pinout\.pdf$/.test(pin.provenance.source),
      "D13 should be a provenance-bound official logical pin",
    );
  });

  check("gnd-contact-ambiguity-is-explicit", () => {
    const pin = describeArduinoUnoR3Pin("GND");
    assert(
      pin?.physicalHeaderContact === "multiple-official-gnd-contacts-not-disambiguated",
      "logical GND must not pretend to identify one physical header contact",
    );
  });

  check("unknown-uno-pin-is-not-invented", () => {
    assert(describeArduinoUnoR3Pin("D99") === null, "unknown Arduino pin rejected");
  });

  check("prototype-method-name-is-not-a-pin", () => {
    assert(
      describeArduinoUnoR3Pin("toString") === null,
      "Object prototype method name must not resolve as an Arduino pin",
    );
  });

  check("prototype-constructor-name-is-not-a-pin", () => {
    assert(
      describeArduinoUnoR3Pin("constructor") === null,
      "Object prototype constructor must not resolve as an Arduino pin",
    );
  });

  check("placement-v2-created", () => {
    const placement = lesson2Fixture();
    assert(
      placement.schemaVersion === 2 &&
      placement.model === BREADBOARD_PLACEMENT_MODEL &&
      placement.validatedBy === "breadboard-placement-v2",
      "v2 authored placement schema",
    );
  });

  check("placement-fail-closed-claims", () => {
    const claims = lesson2Fixture().claims;
    assert(
      claims.explicitAuthoredHoleAssociation === true &&
      claims.breadboardInternalNodeFromProfile === true &&
      claims.mechanicalFitVerified === false &&
      claims.sceneCoordinateMapped === false &&
      claims.circuitRouterMutated === false &&
      claims.externalJumperContinuityVerified === false &&
      claims.physicalCircuitSafetyVerified === false &&
      claims.electricalPowerInferred === false,
      "authored placement must not overclaim physical/electrical proof",
    );
  });

  check("arduino-endpoint-is-jumper-end-association", () => {
    const placement = lesson2Fixture();
    const record = placement.placements.find(item => item.terminalId === "D13");
    assert(
      record?.endpointKind === "arduino-uno-r3-header-jumper-end" &&
      record.sourceEndpoint.logicalPin === "D13" &&
      record.sourceEndpoint.headerContactVerified === false &&
      record.sourceEndpoint.externalJumperContinuityVerified === false,
      "Arduino terminal mapping is an authored jumper-end association",
    );
  });

  check("component-endpoint-mechanical-fit-unverified", () => {
    const placement = lesson2Fixture();
    const record = placement.placements.find(item => item.terminalId === "R1:A");
    assert(
      record?.endpointKind === "authored-circuit-terminal-contact" &&
      record.sourceEndpoint.mechanicalFitVerified === false,
      "component terminal hole association does not prove physical lead fit",
    );
  });

  check("placement-deep-frozen", () => {
    const placement = lesson2Fixture();
    assert(
      Object.isFrozen(placement) &&
      Object.isFrozen(placement.claims) &&
      Object.isFrozen(placement.placements) &&
      placement.placements.every(Object.isFrozen),
      "placement records immutable",
    );
  });

  check("placement-validation-pass", () => {
    const placement = lesson2Fixture();
    const validation = validateBreadboardPlacement(placement, listTerminals(2));
    assert(
      validation.ok === true &&
      validation.stats.terminals === listTerminals(2).length &&
      validation.stats.mapped === 3,
      "canonical placement validation",
    );
  });

  check("mapped-terminal-resolves-exact-hole", () => {
    const placement = lesson2Fixture();
    assert(
      mapBreadboardPlacementTerminalToHole(placement, "D13", listTerminals(2)) === "A12",
      "authored mapping returns exact canonical hole",
    );
  });

  check("unmapped-terminal-remains-null", () => {
    const placement = lesson2Fixture();
    assert(
      mapBreadboardPlacementTerminalToHole(placement, "LED:A", listTerminals(2)) === null,
      "missing authored mapping must remain null",
    );
  });

  check("unknown-terminal-rejected", () => {
    expectThrow(
      () => mapBreadboardPlacementTerminalToHole(
        lesson2Fixture(),
        "NOT:A:TERMINAL",
        listTerminals(2),
      ),
      /terminal/i,
      "terminal outside lesson terminal set rejected",
    );
  });

  check("generic-power-rail-placement-rejected", () => {
    expectThrow(
      () => createBreadboardPlacement({
        terminals: listTerminals(2),
        terminalToHole: { D13: "P1+1" },
      }),
      /profile chứng minh/i,
      "generic power rails remain unknown for placement",
    );
  });

  check("bb830-profile-rail-placement-accepted", () => {
    const placement = createBreadboardPlacement({
      profileId: "busboard-bb830-rev7",
      terminals: listTerminals(2),
      terminalToHole: { D13: "P1+1", "R1:A": "P1+2" },
    });
    assert(
      placement.profileId === "busboard-bb830-rev7" &&
      placement.placements.every(item => item.nodeId === "rail:P1+"),
      "BB830 rail placement uses only the selected profile node",
    );
  });

  check("same-hole-collision-rejected", () => {
    expectThrow(
      () => createBreadboardPlacement({
        terminals: listTerminals(2),
        terminalToHole: { D13: "A1", "R1:A": "A1" },
      }),
      /hai terminal/i,
      "one physical hole cannot host two terminal records",
    );
  });

  check("unknown-arduino-pin-placement-rejected", () => {
    expectThrow(
      () => createBreadboardPlacement({
        terminals: [{ id: "D99", component: "arduino" }],
        terminalToHole: { D99: "A1" },
      }),
      /official pinout/i,
      "unknown Arduino logical pin cannot be authored",
    );
  });

  check("arduino-nc-placement-rejected", () => {
    expectThrow(
      () => createBreadboardPlacement({
        terminals: [{ id: "NC", component: "arduino" }],
        terminalToHole: { NC: "A1" },
      }),
      /không phải endpoint/i,
      "official NC header position is not a connectable endpoint",
    );
  });

  check("forged-positive-physical-claim-rejected", () => {
    const forged = mutableClone(lesson2Fixture());
    forged.claims.mechanicalFitVerified = true;
    const validation = validateBreadboardPlacement(forged, listTerminals(2));
    assert(
      validation.ok === false &&
      validation.errors.some(error => /claims/i.test(error)),
      "validator rejects physical-proof escalation",
    );
  });

  check("forged-router-mutation-claim-rejected", () => {
    const forged = mutableClone(lesson2Fixture());
    forged.claims.circuitRouterMutated = true;
    assert(
      validateBreadboardPlacement(forged, listTerminals(2)).ok === false,
      "validator rejects circuit-router mutation claim",
    );
  });

  check("forged-placement-node-rejected", () => {
    const forged = mutableClone(lesson2Fixture());
    forged.placements[0].nodeId = "rail:invented";
    assert(
      validateBreadboardPlacement(forged, listTerminals(2)).ok === false,
      "validator reconstructs node identity from the selected topology profile",
    );
  });

  check("forged-endpoint-proof-rejected", () => {
    const forged = mutableClone(lesson2Fixture());
    forged.placements[0].sourceEndpoint.headerContactVerified = true;
    assert(
      validateBreadboardPlacement(forged, listTerminals(2)).ok === false,
      "validator rejects endpoint proof escalation",
    );
  });

  check("forged-provenance-rejected", () => {
    const forged = mutableClone(lesson2Fixture());
    forged.provenance.arduinoUnoR3Pinout.source = "https://example.invalid/forged";
    assert(
      validateBreadboardPlacement(forged, listTerminals(2)).ok === false,
      "validator binds placement to canonical provenance",
    );
  });

  check("forged-terminal-set-rejected", () => {
    const forged = mutableClone(lesson2Fixture());
    forged.terminals[0].component = "other";
    assert(
      validateBreadboardPlacement(forged, listTerminals(2)).ok === false,
      "validator binds embedded terminal set to the caller-confirmed lesson terminals",
    );
  });

  check("same-profile-node-diagnostic", () => {
    const diagnostic = diagnosePlacedTerminalPair(
      lesson2Fixture(),
      "D13",
      "R1:A",
      listTerminals(2),
    );
    assert(
      diagnostic.status === "same-profile-node" &&
      diagnostic.breadboardInternalConnected === true &&
      diagnostic.circuitRouterConnectionInferred === false,
      "same node diagnostic never substitutes for circuit-router state",
    );
  });

  check("different-profile-node-diagnostic", () => {
    const diagnostic = diagnosePlacedTerminalPair(
      lesson2Fixture(),
      "D13",
      "R1:B",
      listTerminals(2),
    );
    assert(
      diagnostic.status === "different-profile-nodes" &&
      diagnostic.breadboardInternalConnected === false &&
      diagnostic.circuitRouterConnectionInferred === false,
      "different internal nodes do not claim anything about external wiring",
    );
  });

  check("unmapped-pair-diagnostic", () => {
    const diagnostic = diagnosePlacedTerminalPair(
      lesson2Fixture(),
      "D13",
      "LED:A",
      listTerminals(2),
    );
    assert(
      diagnostic.status === "unmapped" &&
      diagnostic.breadboardInternalConnected === null &&
      diagnostic.circuitRouterConnectionInferred === false,
      "unmapped terminal pair stays unknown",
    );
  });

  check("all-supported-wiring-lessons-terminal-vocabulary-compatible", () => {
    const lessonIds = supportedWiringLessons();
    assert(
      lessonIds.length === 15 &&
      lessonIds[0] === 2 &&
      lessonIds[lessonIds.length - 1] === 16,
      "expected lessons 02..16 wiring range",
    );
    for (const lessonId of lessonIds) {
      const terminals = listTerminals(lessonId);
      const placement = createBreadboardPlacement({
        terminals,
        terminalToHole: completeMapping(terminals),
      });
      const validation = validateBreadboardPlacement(placement, terminals);
      assert(
        validation.ok === true &&
        validation.stats.mapped === terminals.length,
        "lesson " + lessonId + " terminal vocabulary",
      );
    }
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
