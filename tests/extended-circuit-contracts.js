// Browser:
// import("/tests/extended-circuit-contracts.js").then(m => m.runExtendedCircuitContracts())
import {
  EXTENDED_CIRCUIT_LIMITS,
  SUPPORTED_EXTENDED_LESSONS,
  analyzeExtendedCircuit,
  connectExtendedCircuit,
  createExtendedCircuit,
  disconnectExtendedCircuit,
  getExtendedSampleWires,
  listExtendedTerminals,
} from "../src/circuit-extended.js";

const wireMany = (lessonId, pairs) =>
  pairs.reduce((state, pair) => connectExtendedCircuit(state, pair[0], pair[1]), createExtendedCircuit(lessonId));
const sampleCircuit = lessonId => wireMany(lessonId, getExtendedSampleWires(lessonId));
const codes = result => new Set(result.issues.map(item => item.code));

export function runExtendedCircuitContracts() {
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  check("supported-ids", JSON.stringify(SUPPORTED_EXTENDED_LESSONS) === "[4,6,7,8,9,10,11,12,13,14,15,16]");
  check("terminal-lists", SUPPORTED_EXTENDED_LESSONS.every(id => listExtendedTerminals(id).length > 0));
  check("unsupported-terminals", listExtendedTerminals(1).length === 0);
  check("sample-wires-present", SUPPORTED_EXTENDED_LESSONS.every(id => getExtendedSampleWires(id).length >= 2));

  const sampleCopy = getExtendedSampleWires(4);
  sampleCopy[0][0] = "MUTATED";
  check("sample-wires-copy", getExtendedSampleWires(4)[0][0] === "5V");

  const empty = createExtendedCircuit(4);
  const one = connectExtendedCircuit(empty, "5V", "POT:A");
  check("connect-immutable", empty.wires.length === 0 && one.wires.length === 1 && one.wires[0].id === "w1");
  const two = connectExtendedCircuit(one, "GND", "POT:B");
  check("disconnect-id", disconnectExtendedCircuit(two, "w1").wires.length === 1);
  check("disconnect-index", disconnectExtendedCircuit(two, 1).wires.length === 1);

  let duplicateRejected = false;
  try { connectExtendedCircuit(one, "POT:A", "5V"); } catch (error) { duplicateRejected = error instanceof RangeError; }
  check("duplicate-rejected", duplicateRejected);
  let unknownRejected = false;
  try { connectExtendedCircuit(empty, "5V", "NOPE"); } catch (error) { unknownRejected = error instanceof RangeError; }
  check("unknown-terminal-rejected", unknownRejected);
  let wrongEngineRejected = false;
  try { connectExtendedCircuit({ ...empty, engine: "other" }, "5V", "POT:A"); } catch (error) { wrongEngineRejected = error instanceof RangeError; }
  check("wrong-engine-state-rejected", wrongEngineRejected);

  for (const id of SUPPORTED_EXTENDED_LESSONS.filter(id => id !== 10 && id !== 14)) {
    const analysis = analyzeExtendedCircuit(id, sampleCircuit(id));
    check("lesson-" + id + "-sample-functional", analysis.supported && analysis.ok && analysis.functional && analysis.paths.every(item => item.complete));
  }
  for (const id of [10, 14]) {
    const analysis = analyzeExtendedCircuit(id, sampleCircuit(id));
    check("lesson-" + id + "-sample-signal-only",
      analysis.supported &&
      analysis.scope === "signal-only" &&
      analysis.signalPathsComplete === true &&
      analysis.ok === false &&
      analysis.functional === false &&
      analysis.paths.every(item => item.complete) &&
      codes(analysis).has("SIGNAL_ONLY_POWER_LOAD_UNMODELED"));
  }

  const l4NoLedResistor = analyzeExtendedCircuit(4, wireMany(4, [
    ["5V","POT:A"],["GND","POT:B"],["A0","POT:WIPER"],["D9","LED:A"],["LED:K","GND"],
  ]));
  check("lesson-4-missing-led-resistor", codes(l4NoLedResistor).has("LED_RESISTOR_MISSING"));
  const l4WrongTie = connectExtendedCircuit(sampleCircuit(4), "A0", "5V");
  check("lesson-4-wrong-tie-invalidates", !analyzeExtendedCircuit(4, l4WrongTie).ok);

  const l6NoDivider = analyzeExtendedCircuit(6, wireMany(6, [["5V","LDR:A"],["LDR:B","A0"]]));
  check("lesson-6-divider-incomplete", codes(l6NoDivider).has("LDR_DIVIDER_INCOMPLETE"));
  const l6ReversedLed = analyzeExtendedCircuit(6, wireMany(6, [["D13","R_LED:A"],["R_LED:B","LED:K"],["LED:A","GND"]]));
  check("lesson-6-led-polarity", codes(l6ReversedLed).has("LED_POLARITY_REVERSED"));
  check("lesson-6-wrong-tie-invalidates", !analyzeExtendedCircuit(6, connectExtendedCircuit(sampleCircuit(6), "A0", "5V")).ok);
  // Fully wired circuit + LED anode tied to cathode/GND must not be accepted.
  for (const ledLesson of [4, 6, 7, 11, 15, 16]) {
    const bypass = analyzeExtendedCircuit(
      ledLesson, connectExtendedCircuit(sampleCircuit(ledLesson), "LED:A", "GND")
    );
    check("lesson-" + ledLesson + "-led-bypassed-blocks",
      !bypass.ok && codes(bypass).has("LED_LED_BYPASSED"));
  }

  const l7ReversePower = analyzeExtendedCircuit(7, wireMany(7, [["5V","SONAR:GND"],["GND","SONAR:VCC"]]));
  check("lesson-7-sonar-power-reversed", codes(l7ReversePower).has("SONAR_POWER_REVERSED"));
  const l7SwapSignals = analyzeExtendedCircuit(7, wireMany(7, [["D7","SONAR:ECHO"],["D8","SONAR:TRIG"]]));
  check("lesson-7-trig-echo-swapped", codes(l7SwapSignals).has("SONAR_TRIG_ECHO_SWAPPED"));
  const l7NoLedResistor = analyzeExtendedCircuit(7, wireMany(7, [["D13","LED:A"],["LED:K","GND"]]));
  check("lesson-7-led-resistor", codes(l7NoLedResistor).has("LED_RESISTOR_MISSING"));
  const l7EchoFive = analyzeExtendedCircuit(7, connectExtendedCircuit(sampleCircuit(7), "D8", "5V"));
  check("lesson-7-echo-5v-invalidates", !l7EchoFive.ok && codes(l7EchoFive).has("SONAR_ECHO_RAIL_TIE"));
  const l7EchoGround = analyzeExtendedCircuit(7, connectExtendedCircuit(sampleCircuit(7), "D8", "GND"));
  check("lesson-7-echo-gnd-invalidates", !l7EchoGround.ok && codes(l7EchoGround).has("SONAR_ECHO_RAIL_TIE"));

  const l8Reversed = analyzeExtendedCircuit(8, wireMany(8, [["D8","BUZZ:-"],["GND","BUZZ:+"]]));
  check("lesson-8-buzzer-polarity", codes(l8Reversed).has("BUZZER_POLARITY_REVERSED"));
  const l8Short = analyzeExtendedCircuit(8, wireMany(8, [["D8","GND"]]));
  check("lesson-8-output-short", codes(l8Short).has("SHORT_D8_GND"));

  const l9ReversedBuzzer = analyzeExtendedCircuit(9, wireMany(9, [["D9","BUZZ:-"],["GND","BUZZ:+"]]));
  check("lesson-9-buzzer-polarity", codes(l9ReversedBuzzer).has("BUZZER_POLARITY_REVERSED"));
  const l9StuckKey = connectExtendedCircuit(sampleCircuit(9), "D2", "GND");
  const l9StuckAnalysis = analyzeExtendedCircuit(9, l9StuckKey);
  check("lesson-9-key-stuck-low", !l9StuckAnalysis.ok && codes(l9StuckAnalysis).has("PIANO_D2_STUCK_LOW"));
  const l9KeysShorted = analyzeExtendedCircuit(9, wireMany(9, [["D2","D3"]]));
  check("lesson-9-key-inputs-short", codes(l9KeysShorted).has("PIANO_KEYS_SHORTED"));
  const l9ToneToKey = analyzeExtendedCircuit(9, connectExtendedCircuit(sampleCircuit(9), "D9", "D2"));
  check("lesson-9-tone-output-to-key-blocks",
    !l9ToneToKey.ok && codes(l9ToneToKey).has("BOARD_PINS_DIRECTLY_TIED"));

  const l10Mismatch = analyzeExtendedCircuit(10, wireMany(10, [["D9","DRV:IN1"]]));
  check("lesson-10-driver-mismatch", codes(l10Mismatch).has("DRIVER_SIGNAL_MISMATCH"));
  const l10OutputsShort = analyzeExtendedCircuit(10, wireMany(10, [["D7","D8"]]));
  check("lesson-10-output-short", codes(l10OutputsShort).has("OUTPUT_PINS_SHORTED"));
  const l10ExtraWire = analyzeExtendedCircuit(10, connectExtendedCircuit(sampleCircuit(10), "D9", "D7"));
  check("lesson-10-signal-only-boundary-cannot-bypass",
    l10ExtraWire.scope === "signal-only" &&
    l10ExtraWire.signalPathsComplete === true &&
    l10ExtraWire.ok === false &&
    l10ExtraWire.functional === false &&
    codes(l10ExtraWire).has("SIGNAL_ONLY_POWER_LOAD_UNMODELED"));

  const l11ReversePower = analyzeExtendedCircuit(11, wireMany(11, [["5V","LM35:GND"],["GND","LM35:VS"]]));
  check("lesson-11-lm35-polarity", codes(l11ReversePower).has("LM35_POWER_REVERSED"));
  const l11NoLedResistor = analyzeExtendedCircuit(11, wireMany(11, [["D13","LED:A"],["LED:K","GND"]]));
  check("lesson-11-led-resistor", codes(l11NoLedResistor).has("LED_RESISTOR_MISSING"));
  check("lesson-11-wrong-tie-invalidates", !analyzeExtendedCircuit(11, connectExtendedCircuit(sampleCircuit(11), "A0", "5V")).ok);
  const l11LedIntoSensor = analyzeExtendedCircuit(11, connectExtendedCircuit(sampleCircuit(11), "D13", "A0"));
  check("lesson-11-led-output-to-sensor-blocks",
    !l11LedIntoSensor.ok && codes(l11LedIntoSensor).has("BOARD_PINS_DIRECTLY_TIED"));
  const l11CrossPartNet = analyzeExtendedCircuit(11, connectExtendedCircuit(sampleCircuit(11), "LM35:VOUT", "LED:A"));
  check("lesson-11-sensor-to-led-anode-blocks",
    !l11CrossPartNet.ok && codes(l11CrossPartNet).has("UNEXPECTED_NET_MERGE"));
  const l6CrossPartNet = analyzeExtendedCircuit(6, connectExtendedCircuit(sampleCircuit(6), "LDR:B", "LED:A"));
  check("lesson-6-ldr-to-led-anode-blocks",
    !l6CrossPartNet.ok && codes(l6CrossPartNet).has("UNEXPECTED_NET_MERGE"));

  const l12ReversePower = analyzeExtendedCircuit(12, wireMany(12, [
    ["SERVO_SUPPLY:+","SERVO:GND"],["SERVO_SUPPLY:-","SERVO:VCC"],["GND","SERVO_SUPPLY:-"]
  ]));
  check("lesson-12-servo-polarity", codes(l12ReversePower).has("SERVO_POWER_REVERSED"));
  const l12SignalMissing = analyzeExtendedCircuit(12, wireMany(12, [
    ["SERVO_SUPPLY:+","SERVO:VCC"],["SERVO_SUPPLY:-","SERVO:GND"],["GND","SERVO_SUPPLY:-"]
  ]));
  check("lesson-12-servo-signal", codes(l12SignalMissing).has("SERVO_SIGNAL_MISSING"));
  const l12MissingCommon = analyzeExtendedCircuit(12, wireMany(12, [
    ["D9","SERVO:SIG"],["SERVO_SUPPLY:+","SERVO:VCC"],["SERVO_SUPPLY:-","SERVO:GND"]
  ]));
  check("lesson-12-servo-common-ground-required",
    !l12MissingCommon.ok && codes(l12MissingCommon).has("SERVO_COMMON_GND_MISSING"));
  const l12OutputToSupply = analyzeExtendedCircuit(12,
    connectExtendedCircuit(sampleCircuit(12), "D9", "SERVO_SUPPLY:+"));
  check("lesson-12-servo-output-to-supply-blocked",
    !l12OutputToSupply.ok && codes(l12OutputToSupply).has("SERVO_SIGNAL_TO_SUPPLY"));

  const l13Swapped = analyzeExtendedCircuit(13, wireMany(13, [["D2","DRV:DIR"],["D3","DRV:STEP"]]));
  check("lesson-13-step-dir-swapped", codes(l13Swapped).has("STEPPER_STEP_DIR_SWAPPED"));
  const l13PowerReverse = analyzeExtendedCircuit(13, wireMany(13, [["MOTOR:+","DRV:GND"],["MOTOR:-","DRV:VMOT"]]));
  check("lesson-13-power-polarity", codes(l13PowerReverse).has("STEPPER_POWER_REVERSED"));
  const l13WrongTie = connectExtendedCircuit(sampleCircuit(13), "D2", "GND");
  check("lesson-13-output-short-invalidates", !analyzeExtendedCircuit(13, l13WrongTie).ok);
  const l13StepVmot = analyzeExtendedCircuit(13, connectExtendedCircuit(sampleCircuit(13), "D2", "MOTOR:+"));
  check("lesson-13-step-vmot-invalidates", !l13StepVmot.ok && codes(l13StepVmot).has("STEPPER_OUTPUT_TO_VMOT"));
  const l13DirVmot = analyzeExtendedCircuit(13, connectExtendedCircuit(sampleCircuit(13), "D3", "MOTOR:+"));
  check("lesson-13-dir-vmot-invalidates", !l13DirVmot.ok && codes(l13DirVmot).has("STEPPER_OUTPUT_TO_VMOT"));

  const l14MissingGround = analyzeExtendedCircuit(14, wireMany(14, [["A0","SOIL:SIG"],["D8","PUMP:IN"]]));
  check("lesson-14-common-ground", codes(l14MissingGround).has("SOIL_GROUND_MISSING") && codes(l14MissingGround).has("PUMP_DRIVER_GROUND_MISSING"));
  const l14WrongTie = connectExtendedCircuit(sampleCircuit(14), "A0", "D8");
  const l14WrongAnalysis = analyzeExtendedCircuit(14, l14WrongTie);
  check("lesson-14-input-output-short", !l14WrongAnalysis.ok && codes(l14WrongAnalysis).has("SOIL_INPUT_PUMP_OUTPUT_SHORTED"));
  const l14GroundTie = analyzeExtendedCircuit(14, connectExtendedCircuit(sampleCircuit(14), "A0", "GND"));
  check("lesson-14-input-ground-invalidates", !l14GroundTie.ok && codes(l14GroundTie).has("SOIL_INPUT_STUCK_GND"));
  const l14ExtraWire = analyzeExtendedCircuit(14,
    connectExtendedCircuit(sampleCircuit(14), "SOIL:GND", "PUMP:GND"));
  check("lesson-14-signal-only-boundary-cannot-bypass",
    l14ExtraWire.scope === "signal-only" &&
    l14ExtraWire.signalPathsComplete === true &&
    l14ExtraWire.ok === false &&
    l14ExtraWire.functional === false &&
    codes(l14ExtraWire).has("SIGNAL_ONLY_POWER_LOAD_UNMODELED"));

  const l15DividerReverse = analyzeExtendedCircuit(15, wireMany(15, [
    ["5V","R_DIV:A"],["R_DIV:B","A0"],["A0","FSR:A"],["FSR:B","GND"],
  ]));
  check("lesson-15-divider-reversed", codes(l15DividerReverse).has("FSR_DIVIDER_REVERSED"));
  const l15LedReverse = analyzeExtendedCircuit(15, wireMany(15, [["D13","R_LED:A"],["R_LED:B","LED:K"],["LED:A","GND"]]));
  check("lesson-15-led-polarity", codes(l15LedReverse).has("LED_POLARITY_REVERSED"));

  const l16Lm35Reverse = analyzeExtendedCircuit(16, wireMany(16, [["5V","LM35:GND"],["GND","LM35:VS"]]));
  check("lesson-16-lm35-polarity", codes(l16Lm35Reverse).has("LM35_POWER_REVERSED"));
  const l16ButtonWrongTie = connectExtendedCircuit(sampleCircuit(16), "D2", "GND");
  const l16ButtonAnalysis = analyzeExtendedCircuit(16, l16ButtonWrongTie);
  check("lesson-16-button-stuck-low", !l16ButtonAnalysis.ok && codes(l16ButtonAnalysis).has("BUTTON_D2_STUCK_LOW"));
  const l16BuzzerReverse = analyzeExtendedCircuit(16, wireMany(16, [["D8","BUZZ:-"],["GND","BUZZ:+"]]));
  check("lesson-16-buzzer-polarity", codes(l16BuzzerReverse).has("BUZZER_POLARITY_REVERSED"));
  const l16LedToButton = analyzeExtendedCircuit(16, connectExtendedCircuit(sampleCircuit(16), "D13", "D2"));
  check("lesson-16-led-output-to-button-blocks",
    !l16LedToButton.ok && codes(l16LedToButton).has("BOARD_PINS_DIRECTLY_TIED"));
  const l16LedNoResistor = analyzeExtendedCircuit(16, wireMany(16, [["D13","LED:A"],["LED:K","GND"]]));
  check("lesson-16-led-resistor", codes(l16LedNoResistor).has("LED_RESISTOR_MISSING"));
  const l16RailShort = analyzeExtendedCircuit(16, wireMany(16, [["5V","GND"]]));
  check("lesson-16-power-short", codes(l16RailShort).has("SHORT_5V_GND"));

  const ids = listExtendedTerminals(9).map(item => item.id);
  const pairs = [];
  for (let i = 0; i < ids.length && pairs.length <= EXTENDED_CIRCUIT_LIMITS.maxWires; i += 1) {
    for (let j = i + 1; j < ids.length && pairs.length <= EXTENDED_CIRCUIT_LIMITS.maxWires; j += 1) pairs.push([ids[i], ids[j]]);
  }
  const atLimit = wireMany(9, pairs.slice(0, EXTENDED_CIRCUIT_LIMITS.maxWires));
  let limitRejected = false;
  try { connectExtendedCircuit(atLimit, pairs[EXTENDED_CIRCUIT_LIMITS.maxWires][0], pairs[EXTENDED_CIRCUIT_LIMITS.maxWires][1]); } catch (error) { limitRejected = error instanceof RangeError; }
  check("wire-limit", atLimit.wires.length === EXTENDED_CIRCUIT_LIMITS.maxWires && limitRejected);

  const unsupported = analyzeExtendedCircuit(1, createExtendedCircuit(1));
  check("unsupported-fallback", !unsupported.supported && codes(unsupported).has("UNSUPPORTED_EXTENDED_LESSON"));

  return { total: results.length, passed: results.length, failed: 0, results };
}
