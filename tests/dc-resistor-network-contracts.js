import { solveResistiveDC } from "../src/dc-resistor-network.js";

function assert(ok, label) {
  if (!ok) throw new Error("dc-resistor-network contract: " + label);
}

function closeTo(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance;
}

function issueCodes(result) {
  return new Set(result.issues.map(item => item.code));
}

function resistor(result, id) {
  return result.resistorResults.find(item => item.id === id);
}

function basicDivider() {
  return {
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [
      { id: "R1", a: "VCC", b: "MID", ohms: 1000 },
      { id: "R2", a: "MID", b: "GND", ohms: 1000 },
    ],
  };
}

export function runDcResistorNetworkContracts() {
  const checks = [];
  const check = (name, run) => {
    run();
    checks.push(name);
  };

  const divider = solveResistiveDC(basicDivider());

  check("divider-supported-calculated", () => {
    assert(divider.supported && divider.calculated, "basic divider must calculate");
  });
  check("divider-midpoint-2v5", () => {
    assert(closeTo(divider.nodeVoltages.MID, 2.5), "equal divider midpoint");
  });
  check("divider-fixed-node-values", () => {
    assert(divider.nodeVoltages.GND === 0 && divider.nodeVoltages.VCC === 5,
      "ground/source voltages retained");
  });
  check("divider-current-2v5ma", () => {
    assert(closeTo(resistor(divider, "R1").currentMilliAmps, 2.5) &&
      closeTo(resistor(divider, "R2").currentMilliAmps, 2.5),
    "equal divider current");
  });
  check("divider-power-6v25mw", () => {
    assert(closeTo(resistor(divider, "R1").powerMilliWatts, 6.25) &&
      closeTo(resistor(divider, "R2").powerMilliWatts, 6.25),
    "equal divider power");
  });
  check("result-origin-and-physical-boundary", () => {
    const item = resistor(divider, "R1");
    assert(
      divider.boundaries.origin === "ideal-dc-resistor-model" &&
      divider.boundaries.physicalVerified === false &&
      divider.boundaries.measured === false &&
      item.origin === "ideal-dc-resistor-model" &&
      item.physicalVerified === false &&
      item.measured === false,
      "model provenance boundary",
    );
  });
  check("result-deep-frozen", () => {
    assert(
      Object.isFrozen(divider) &&
      Object.isFrozen(divider.nodeVoltages) &&
      Object.isFrozen(divider.resistorResults) &&
      divider.resistorResults.every(Object.isFrozen) &&
      Object.isFrozen(divider.boundaries),
      "result must be immutable",
    );
  });

  const unequal = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [
      { id: "R_TOP", a: "VCC", b: "MID", ohms: 1000 },
      { id: "R_BOTTOM", a: "MID", b: "GND", ohms: 2000 },
    ],
  });
  check("unequal-divider-voltage", () => {
    assert(closeTo(unequal.nodeVoltages.MID, 10 / 3), "1k/2k divider");
  });
  check("unequal-divider-current", () => {
    assert(closeTo(resistor(unequal, "R_TOP").absoluteCurrentMilliAmps, 5 / 3),
      "1k/2k current");
  });

  const series3 = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [
      { id: "R3", a: "N2", b: "GND", ohms: 1000 },
      { id: "R1", a: "VCC", b: "N1", ohms: 1000 },
      { id: "R2", a: "N1", b: "N2", ohms: 1000 },
    ],
  });
  check("three-series-node-n1", () => {
    assert(closeTo(series3.nodeVoltages.N1, 10 / 3), "N1 voltage");
  });
  check("three-series-node-n2", () => {
    assert(closeTo(series3.nodeVoltages.N2, 5 / 3), "N2 voltage");
  });
  check("resistor-results-canonical-id-order", () => {
    assert(series3.resistorResults.map(item => item.id).join(",") === "R1,R2,R3",
      "resistor output sorted by ID");
  });

  const parallel = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [
      { id: "R_B", a: "VCC", b: "GND", ohms: 2000 },
      { id: "R_A", a: "VCC", b: "GND", ohms: 1000 },
    ],
  });
  check("parallel-branch-one-current", () => {
    assert(closeTo(resistor(parallel, "R_A").currentMilliAmps, 5), "1k parallel current");
  });
  check("parallel-branch-two-current", () => {
    assert(closeTo(resistor(parallel, "R_B").currentMilliAmps, 2.5), "2k parallel current");
  });
  check("parallel-branches-allowed", () => {
    assert(parallel.calculated && parallel.resistorResults.length === 2,
      "distinct resistor IDs may share endpoint pair");
  });

  const railMerge = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "RAIL5", voltageVolts: 5 }],
    resistors: [
      { id: "LOAD1", a: "RAIL5", b: "N1", ohms: 1000 },
      { id: "RETURN1", a: "N1", b: "GND", ohms: 1000 },
      { id: "LOAD2", a: "RAIL5", b: "N2", ohms: 2000 },
      { id: "RETURN2", a: "N2", b: "GND", ohms: 2000 },
    ],
  });
  check("shared-node-rail-merge", () => {
    assert(closeTo(railMerge.nodeVoltages.N1, 2.5) && closeTo(railMerge.nodeVoltages.N2, 2.5),
      "same node ID is one ideal electrical node");
  });

  const symmetricBridge = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [
      { id: "R1", a: "VCC", b: "A", ohms: 1000 },
      { id: "R2", a: "A", b: "GND", ohms: 1000 },
      { id: "R3", a: "VCC", b: "B", ohms: 1000 },
      { id: "R4", a: "B", b: "GND", ohms: 1000 },
      { id: "R5", a: "A", b: "B", ohms: 1000 },
    ],
  });
  check("symmetric-bridge-node-voltages", () => {
    assert(closeTo(symmetricBridge.nodeVoltages.A, 2.5) &&
      closeTo(symmetricBridge.nodeVoltages.B, 2.5),
    "coupled two-node bridge solution");
  });
  check("symmetric-bridge-zero-cross-current", () => {
    assert(closeTo(resistor(symmetricBridge, "R5").absoluteCurrentMilliAmps, 0),
      "balanced bridge branch has zero current");
  });

  const twoSources = solveResistiveDC({
    ground: "GND",
    voltageNodes: [
      { node: "HI", voltageVolts: 5 },
      { node: "LO", voltageVolts: 2 },
    ],
    resistors: [{ id: "R", a: "HI", b: "LO", ohms: 1000 }],
  });
  check("fixed-to-fixed-resistor", () => {
    assert(twoSources.calculated && closeTo(resistor(twoSources, "R").currentMilliAmps, 3),
      "fixed source differential");
  });

  const signed = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [{ id: "R", a: "GND", b: "VCC", ohms: 1000 }],
  });
  check("signed-current-follows-a-to-b", () => {
    assert(closeTo(resistor(signed, "R").currentMilliAmps, -5) &&
      closeTo(resistor(signed, "R").absoluteCurrentMilliAmps, 5),
    "signed current orientation");
  });

  const zeroFixed = solveResistiveDC({
    ground: "GND",
    voltageNodes: [
      { node: "VCC", voltageVolts: 5 },
      { node: "ZERO", voltageVolts: 0 },
    ],
    resistors: [{ id: "R", a: "VCC", b: "ZERO", ohms: 1000 }],
  });
  check("additional-zero-volt-fixed-node", () => {
    assert(zeroFixed.calculated && zeroFixed.nodeVoltages.ZERO === 0,
      "distinct ideal 0V fixed node allowed");
  });

  const orderA = solveResistiveDC(basicDivider());
  const orderB = solveResistiveDC({
    ground: "GND",
    voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
    resistors: [
      { id: "R2", a: "MID", b: "GND", ohms: 1000 },
      { id: "R1", a: "VCC", b: "MID", ohms: 1000 },
    ],
  });
  check("input-resistor-order-does-not-change-result", () => {
    assert(JSON.stringify(orderA) === JSON.stringify(orderB), "canonical output independent of resistor order");
  });

  const immutableInput = basicDivider();
  const before = JSON.stringify(immutableInput);
  solveResistiveDC(immutableInput);
  check("solver-does-not-mutate-input", () => {
    assert(JSON.stringify(immutableInput) === before, "input object unchanged");
  });

  const unsupportedLed = solveResistiveDC({
    ...basicDivider(),
    leds: [{ id: "LED1" }],
  });
  check("unsupported-nonlinear-element-fails-closed", () => {
    assert(!unsupportedLed.supported && !unsupportedLed.calculated &&
      issueCodes(unsupportedLed).has("UNSUPPORTED_NONLINEAR_ELEMENT"),
    "LED/nonlinear field rejected");
  });

  const unknownField = solveResistiveDC({
    ...basicDivider(),
    mystery: true,
  });
  check("unknown-model-field-fails-closed", () => {
    assert(!unknownField.supported && issueCodes(unknownField).has("UNSUPPORTED_MODEL_FIELD"),
      "unknown top-level field rejected");
  });

  check("null-network-fails-closed", () => {
    const value = solveResistiveDC(null);
    assert(!value.supported && !value.calculated && issueCodes(value).has("INVALID_NETWORK"),
      "null network rejected");
  });
  check("invalid-ground-id-rejected", () => {
    const value = solveResistiveDC({ ...basicDivider(), ground: "../GND" });
    assert(!value.calculated && issueCodes(value).has("INVALID_IDENTIFIER"), "unsafe ground ID");
  });
  check("voltage-nodes-must-be-array", () => {
    const value = solveResistiveDC({ ground: "GND", voltageNodes: {}, resistors: basicDivider().resistors });
    assert(!value.calculated && issueCodes(value).has("INVALID_VOLTAGE_NODES"),
      "voltageNodes array required");
  });
  check("resistor-array-cannot-be-empty", () => {
    const value = solveResistiveDC({ ground: "GND", voltageNodes: [], resistors: [] });
    assert(!value.calculated && issueCodes(value).has("RESISTOR_COUNT_OUT_OF_RANGE"),
      "empty resistor network rejected");
  });

  check("duplicate-fixed-node-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [
        { node: "VCC", voltageVolts: 5 },
        { node: "VCC", voltageVolts: 5 },
      ],
      resistors: [{ id: "R", a: "VCC", b: "GND", ohms: 1000 }],
    });
    assert(issueCodes(value).has("DUPLICATE_VOLTAGE_NODE"), "duplicate fixed node");
  });
  check("contradictory-fixed-node-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [
        { node: "VCC", voltageVolts: 5 },
        { node: "VCC", voltageVolts: 4 },
      ],
      resistors: [{ id: "R", a: "VCC", b: "GND", ohms: 1000 }],
    });
    assert(issueCodes(value).has("CONTRADICTORY_FIXED_VOLTAGE"), "contradictory source");
  });
  check("ground-duplicate-zero-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "GND", voltageVolts: 0 }],
      resistors: [{ id: "R", a: "GND", b: "N", ohms: 1000 }],
    });
    assert(issueCodes(value).has("DUPLICATE_GROUND_NODE"), "ground duplication");
  });
  check("ground-nonzero-contradiction-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "GND", voltageVolts: 1 }],
      resistors: [{ id: "R", a: "GND", b: "N", ohms: 1000 }],
    });
    assert(issueCodes(value).has("CONTRADICTORY_GROUND_VOLTAGE"), "ground must be 0V");
  });
  check("source-above-5v-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5.001 }],
      resistors: [{ id: "R", a: "VCC", b: "GND", ohms: 1000 }],
    });
    assert(issueCodes(value).has("FIXED_VOLTAGE_OUT_OF_RANGE"), "source upper bound");
  });
  check("negative-source-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "NEG", voltageVolts: -0.1 }],
      resistors: [{ id: "R", a: "NEG", b: "GND", ohms: 1000 }],
    });
    assert(issueCodes(value).has("FIXED_VOLTAGE_OUT_OF_RANGE"), "source lower bound");
  });

  check("duplicate-resistor-id-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors: [
        { id: "R", a: "VCC", b: "N", ohms: 1000 },
        { id: "R", a: "N", b: "GND", ohms: 1000 },
      ],
    });
    assert(issueCodes(value).has("DUPLICATE_RESISTOR_ID"), "duplicate resistor ID");
  });
  check("self-loop-resistor-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [],
      resistors: [{ id: "R", a: "GND", b: "GND", ohms: 1000 }],
    });
    assert(issueCodes(value).has("SELF_LOOP_RESISTOR"), "same-node resistor rejected");
  });
  check("zero-ohm-short-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors: [{ id: "SHORT", a: "VCC", b: "GND", ohms: 0 }],
    });
    assert(issueCodes(value).has("INVALID_RESISTANCE"), "zero-ohm branch rejected");
  });
  check("negative-resistance-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [],
      resistors: [{ id: "R", a: "N", b: "GND", ohms: -1 }],
    });
    assert(issueCodes(value).has("INVALID_RESISTANCE"), "negative resistor rejected");
  });
  check("infinite-resistance-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [],
      resistors: [{ id: "R", a: "N", b: "GND", ohms: Infinity }],
    });
    assert(issueCodes(value).has("INVALID_RESISTANCE"), "infinite resistor rejected");
  });
  check("resistor-extra-field-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [],
      resistors: [{ id: "R", a: "N", b: "GND", ohms: 1000, type: "led" }],
    });
    assert(!value.supported && issueCodes(value).has("UNSUPPORTED_RESISTOR_FIELD"),
      "resistor schema cannot hide LED");
  });

  check("floating-component-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [],
      resistors: [{ id: "R", a: "A", b: "B", ohms: 1000 }],
    });
    assert(!value.calculated && issueCodes(value).has("FLOATING_COMPONENT"), "floating pair");
  });
  check("mixed-anchored-and-floating-component-rejected", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors: [
        { id: "RA", a: "VCC", b: "GND", ohms: 1000 },
        { id: "RF", a: "X", b: "Y", ohms: 1000 },
      ],
    });
    assert(issueCodes(value).has("FLOATING_COMPONENT"), "any floating component blocks network");
  });
  check("ill-conditioned-network-fails-closed", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [],
      resistors: [
        { id: "R_WEAK", a: "GND", b: "N1", ohms: 1e13 },
        { id: "R_STRONG", a: "N1", b: "N2", ohms: 1 },
      ],
    });
    assert(!value.calculated && issueCodes(value).has("SINGULAR_OR_ILL_CONDITIONED"),
      "relative pivot guard");
  });

  check("configured-current-bound-blocks-output", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors: [{ id: "R", a: "VCC", b: "GND", ohms: 1000 }],
    }, { maxCurrentMilliAmps: 4 });
    assert(
      value.supported &&
      !value.calculated &&
      Object.keys(value.nodeVoltages).length === 0 &&
      value.resistorResults.length === 0 &&
      issueCodes(value).has("CURRENT_BOUND_EXCEEDED"),
      "current guard refuses numeric output",
    );
  });
  check("configured-power-bound-blocks-output", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors: [{ id: "R", a: "VCC", b: "GND", ohms: 1000 }],
    }, { maxPowerMilliWatts: 20 });
    assert(!value.calculated && issueCodes(value).has("POWER_BOUND_EXCEEDED"),
      "power guard refuses output");
  });
  check("configured-bounds-pass-when-within", () => {
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors: [{ id: "R", a: "VCC", b: "GND", ohms: 1000 }],
    }, { maxCurrentMilliAmps: 6, maxPowerMilliWatts: 30 });
    assert(value.calculated && value.issues.length === 0, "safe configured guards");
  });
  check("invalid-zero-bound-rejected", () => {
    const value = solveResistiveDC(basicDivider(), { maxCurrentMilliAmps: 0 });
    assert(!value.supported && issueCodes(value).has("INVALID_BOUND"), "zero current bound invalid");
  });
  check("unknown-option-rejected", () => {
    const value = solveResistiveDC(basicDivider(), { maxVoltage: 5 });
    assert(!value.supported && issueCodes(value).has("UNSUPPORTED_OPTION"), "unknown option rejected");
  });

  check("too-many-resistors-rejected", () => {
    const resistors = Array.from({ length: 65 }, (_unused, index) => ({
      id: "R" + index,
      a: "VCC",
      b: "GND",
      ohms: 1000,
    }));
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors,
    });
    assert(issueCodes(value).has("RESISTOR_COUNT_OUT_OF_RANGE"), "branch bound");
  });
  check("too-many-nodes-rejected", () => {
    const resistors = [];
    for (let index = 1; index <= 31; index += 1) {
      resistors.push({
        id: "R" + index,
        a: index === 1 ? "VCC" : "N" + (index - 1),
        b: "N" + index,
        ohms: 1000,
      });
    }
    resistors.push({ id: "R_RETURN", a: "N31", b: "GND", ohms: 1000 });
    const value = solveResistiveDC({
      ground: "GND",
      voltageNodes: [{ node: "VCC", voltageVolts: 5 }],
      resistors,
    });
    assert(issueCodes(value).has("TOO_MANY_NODES"), "node bound");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
