// Chạy trong browser: import("/tests/circuit-contracts.js").then(m => m.runCircuitContracts())
import {
  CIRCUIT_LIMITS,
  SUPPORTED_CIRCUIT_LESSONS,
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  disconnectCircuit,
  listTerminals,
} from "../src/circuit.js";

const wireMany = (lessonId, pairs) => pairs.reduce((state, pair) => connectCircuit(state, pair[0], pair[1]), createCircuit(lessonId));
const issueCodes = result => new Set(result.issues.map(item => item.code));

export function runCircuitContracts() {
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  check("supported-lessons", JSON.stringify(SUPPORTED_CIRCUIT_LESSONS) === "[2,3,5]");
  check("terminal-whitelist", [2,3,5].every(id => listTerminals(id).length > 0) && listTerminals(4).length === 0);
  check("terminal-ids-led", ["D13","GND","R1:A","R1:B","LED:A","LED:K"].every(id => listTerminals(2).some(item => item.id === id)));

  const empty = createCircuit(2);
  const one = connectCircuit(empty, "D13", "R1:A");
  check("connect-is-immutable", empty.wires.length === 0 && one.wires.length === 1 && one.wires[0].id === "w1");
  const two = connectCircuit(one, "R1:B", "LED:A");
  const removedById = disconnectCircuit(two, "w1");
  const removedByIndex = disconnectCircuit(two, 1);
  check("disconnect-id", removedById.wires.length === 1 && removedById.wires[0].id === "w2");
  check("disconnect-index", removedByIndex.wires.length === 1 && removedByIndex.wires[0].id === "w1");

  let duplicateRejected = false;
  try { connectCircuit(one, "R1:A", "D13"); } catch (error) { duplicateRejected = error instanceof RangeError; }
  check("duplicate-wire-rejected", duplicateRejected);
  let unknownRejected = false;
  try { connectCircuit(empty, "D13", "D99"); } catch (error) { unknownRejected = error instanceof RangeError; }
  check("unknown-terminal-rejected", unknownRejected);
  let selfRejected = false;
  try { connectCircuit(empty, "D13", "D13"); } catch (error) { selfRejected = error instanceof RangeError; }
  check("self-wire-rejected", selfRejected);

  const rgbIds = listTerminals(5).map(item => item.id);
  const pairs = [];
  for (let i = 0; i < rgbIds.length && pairs.length <= CIRCUIT_LIMITS.maxWires; i += 1) {
    for (let j = i + 1; j < rgbIds.length && pairs.length <= CIRCUIT_LIMITS.maxWires; j += 1) pairs.push([rgbIds[i], rgbIds[j]]);
  }
  const atLimit = wireMany(5, pairs.slice(0, CIRCUIT_LIMITS.maxWires));
  let limitRejected = false;
  try { connectCircuit(atLimit, pairs[CIRCUIT_LIMITS.maxWires][0], pairs[CIRCUIT_LIMITS.maxWires][1]); } catch (error) { limitRejected = error instanceof RangeError; }
  check("wire-limit", atLimit.wires.length === CIRCUIT_LIMITS.maxWires && limitRejected);

  const ledGood = wireMany(2, [["D13","R1:A"],["R1:B","LED:A"],["LED:K","GND"]]);
  const ledGoodResult = analyzeCircuit(2, ledGood);
  check("led-functional", ledGoodResult.ok && ledGoodResult.functional && ledGoodResult.paths[0].complete);
  const ledNoResistor = analyzeCircuit(2, wireMany(2, [["D13","LED:A"],["LED:K","GND"]]));
  check("led-missing-resistor", issueCodes(ledNoResistor).has("LED_RESISTOR_MISSING") && !ledNoResistor.functional);
  const ledReversed = analyzeCircuit(2, wireMany(2, [["D13","R1:A"],["R1:B","LED:K"],["LED:A","GND"]]));
  check("led-reversed", issueCodes(ledReversed).has("LED_REVERSED") && !ledReversed.functional);
  const ledShort = analyzeCircuit(2, wireMany(2, [["D13","GND"]]));
  check("led-output-short", issueCodes(ledShort).has("SHORT_D13_GND"));

  const buttonGood = wireMany(3, [
    ["5V","BTN:1"],["BTN:2","D2"],["D2","R_PULL:A"],["R_PULL:B","GND"],
    ["D13","R_LED:A"],["R_LED:B","LED:A"],["LED:K","GND"],
  ]);
  const buttonGoodResult = analyzeCircuit(3, buttonGood);
  check("button-functional", buttonGoodResult.ok && buttonGoodResult.paths.every(item => item.complete));
  const buttonOutputInputTied = analyzeCircuit(3, connectCircuit(buttonGood, "D13", "D2"));
  check("button-extra-output-to-input-blocks",
    !buttonOutputInputTied.ok && issueCodes(buttonOutputInputTied).has("BOARD_PINS_DIRECTLY_TIED"));
  const buttonLoadSenseMerged = analyzeCircuit(3, connectCircuit(buttonGood, "BTN:2", "LED:A"));
  check("button-sensor-node-to-led-load-blocks",
    !buttonLoadSenseMerged.ok && issueCodes(buttonLoadSenseMerged).has("UNEXPECTED_NET_MERGE"));
  // A fully connected example must not remain usable when D2 is additionally
  // tied directly to 5V: its button cannot signal a LOW release any more.
  const buttonStuckHigh = analyzeCircuit(3, connectCircuit(buttonGood, "D2", "5V"));
  check("button-extra-wire-stuck-high-blocks",
    !buttonStuckHigh.ok && issueCodes(buttonStuckHigh).has("D2_STUCK_HIGH"));
  const noButton = analyzeCircuit(3, createCircuit(3));
  const noButtonCodes = issueCodes(noButton);
  check("button-disconnected-core", ["D2_DISCONNECTED","5V_DISCONNECTED","GND_DISCONNECTED"].every(code => noButtonCodes.has(code)));
  const wrongPull = analyzeCircuit(3, wireMany(3, [["D2","R_PULL:A"],["R_PULL:B","5V"]]));
  check("button-wrong-pulldown", issueCodes(wrongPull).has("PULLDOWN_TO_5V"));
  const powerShort = analyzeCircuit(3, wireMany(3, [["5V","GND"]]));
  check("button-power-short", issueCodes(powerShort).has("SHORT_5V_GND"));
  const pressedShort = analyzeCircuit(3, wireMany(3, [["5V","BTN:1"],["BTN:2","GND"]]));
  check("button-pressed-short", issueCodes(pressedShort).has("SHORT_5V_GND_WHEN_PRESSED"));

  const rgbGood = wireMany(5, [
    ["D9","R_R:A"],["R_R:B","RGB:R"],
    ["D10","R_G:A"],["R_G:B","RGB:G"],
    ["D11","R_B:A"],["R_B:B","RGB:B"],
    ["RGB:K","GND"],
  ]);
  const rgbGoodResult = analyzeCircuit(5, rgbGood);
  check("rgb-functional", rgbGoodResult.ok && rgbGoodResult.paths.length === 3 && rgbGoodResult.paths.every(item => item.complete));
  const rgbRedBypassed = analyzeCircuit(5, connectCircuit(rgbGood, "RGB:R", "GND"));
  check("rgb-red-to-cathode-blocks",
    !rgbRedBypassed.ok && issueCodes(rgbRedBypassed).has("RGB_RED_LED_BYPASSED"));
  const rgbAnodesTied = analyzeCircuit(5, connectCircuit(rgbGood, "RGB:R", "RGB:G"));
  check("rgb-independent-channels-blocked",
    !rgbAnodesTied.ok && issueCodes(rgbAnodesTied).has("RGB_CHANNELS_TIED"));
  const rgbNoRedResistor = analyzeCircuit(5, wireMany(5, [
    ["D9","RGB:R"],
    ["D10","R_G:A"],["R_G:B","RGB:G"],
    ["D11","R_B:A"],["R_B:B","RGB:B"],
    ["RGB:K","GND"],
  ]));
  check("rgb-missing-red-resistor", issueCodes(rgbNoRedResistor).has("RGB_RED_RESISTOR_MISSING"));
  const rgbWrongRed = analyzeCircuit(5, wireMany(5, [["D9","R_R:A"],["R_R:B","RGB:G"],["RGB:R","GND"],["RGB:K","GND"]]));
  check("rgb-wrong-red-path", issueCodes(rgbWrongRed).has("RGB_RED_PATH_WRONG"));
  const rgbShort = analyzeCircuit(5, wireMany(5, [["D9","D10"]]));
  check("rgb-output-short", issueCodes(rgbShort).has("OUTPUT_PINS_SHORTED"));

  const unsupported = analyzeCircuit(4, createCircuit(4));
  check("unsupported-fallback", !unsupported.supported && issueCodes(unsupported).has("UNSUPPORTED_LESSON") && unsupported.paths.length === 0);

  return { total: results.length, passed: results.length, failed: 0, results };
}
