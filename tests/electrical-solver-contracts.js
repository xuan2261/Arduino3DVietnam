// Browser: import("/tests/electrical-solver-contracts.js").then(m => m.runElectricalSolverContracts())
import {
  SUPPORTED_ELECTRICAL_LESSONS,
  ELECTRICAL_LIMITS,
  analyzeElectrical,
} from "../src/electrical-solver.js";
import { connectCircuit, createCircuit } from "../src/circuit-router.js";

const wireMany = (lessonId, pairs) =>
  pairs.reduce((state, pair) => connectCircuit(state, pair[0], pair[1]), createCircuit(lessonId));

const issueCodes = result => new Set(result.issues.map(item => item.code));
const closeTo = (actual, expected, tolerance = 0.001) => Math.abs(actual - expected) <= tolerance;

const LESSON_2_GOOD = [
  ["D13", "R1:A"], ["R1:B", "LED:A"], ["LED:K", "GND"],
];

const LESSON_3_GOOD = [
  ["5V", "BTN:1"], ["BTN:2", "D2"],
  ["D2", "R_PULL:A"], ["R_PULL:B", "GND"],
  ["D13", "R_LED:A"], ["R_LED:B", "LED:A"], ["LED:K", "GND"],
];

const LESSON_5_GOOD = [
  ["D9", "R_R:A"], ["R_R:B", "RGB:R"],
  ["D10", "R_G:A"], ["R_G:B", "RGB:G"],
  ["D11", "R_B:A"], ["R_B:B", "RGB:B"],
  ["RGB:K", "GND"],
];

export function runElectricalSolverContracts() {
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  check("supported-lessons", JSON.stringify(SUPPORTED_ELECTRICAL_LESSONS) === "[2,3,5]");
  check("fixed-5v-limit", ELECTRICAL_LIMITS.supplyVolts === 5);

  const lesson2 = analyzeElectrical(2, wireMany(2, LESSON_2_GOOD));
  check("lesson2-calculated", lesson2.ok && !lesson2.blocked && lesson2.calculated && lesson2.channels.length === 1);
  check("lesson2-explicit-units", lesson2.assumptions.units.voltage === "V" && lesson2.assumptions.units.resistance === "ohm" && lesson2.assumptions.units.current === "mA");
  check("lesson2-default-current", closeTo(lesson2.channels[0].currentMilliAmps, 13.636));
  check("lesson2-default-model", lesson2.channels[0].resistorOhms === 220 && lesson2.channels[0].forwardVoltageVolts === 2 && lesson2.channels[0].supplyVolts === 5);
  check("no-invented-max-current", lesson2.channels[0].maxCurrentMilliAmps === null && lesson2.channels[0].withinMaxCurrent === null);

  const lesson3 = analyzeElectrical(3, wireMany(3, LESSON_3_GOOD));
  check("lesson3-output-led-current", lesson3.ok && lesson3.channels.length === 1 && lesson3.channels[0].id === "output-led" && closeTo(lesson3.channels[0].currentMilliAmps, 13.636));

  const lesson5 = analyzeElectrical(5, wireMany(5, LESSON_5_GOOD));
  const rgb = Object.fromEntries(lesson5.channels.map(item => [item.id, item]));
  check("lesson5-three-channels", lesson5.ok && lesson5.channels.length === 3);
  check("lesson5-red-current", closeTo(rgb.red.currentMilliAmps, 13.636) && rgb.red.forwardVoltageVolts === 2);
  check("lesson5-green-current", closeTo(rgb.green.currentMilliAmps, 12.727) && rgb.green.forwardVoltageVolts === 2.2);
  check("lesson5-blue-current", closeTo(rgb.blue.currentMilliAmps, 9.091) && rgb.blue.forwardVoltageVolts === 3);

  const overridden = analyzeElectrical(2, wireMany(2, LESSON_2_GOOD), {
    channels: { led: { resistorOhms: 330, forwardVoltageVolts: 2.1 } },
  });
  check("bounded-channel-overrides", overridden.channels[0].resistorOhms === 330 && overridden.channels[0].forwardVoltageVolts === 2.1 && closeTo(overridden.channels[0].currentMilliAmps, 8.788));

  const warned = analyzeElectrical(2, wireMany(2, LESSON_2_GOOD), { maxCurrentMilliAmps: 10 });
  check("optional-current-warning", warned.ok && warned.calculated && warned.channels[0].withinMaxCurrent === false && issueCodes(warned).has("CURRENT_ABOVE_MAX_WARNING"));

  const missingResistor = analyzeElectrical(2, wireMany(2, [["D13", "LED:A"], ["LED:K", "GND"]]));
  check("missing-resistor-blocks-calculation", missingResistor.blocked && !missingResistor.calculated && missingResistor.channels.length === 0 && issueCodes(missingResistor).has("LED_RESISTOR_MISSING"));

  const reversed = analyzeElectrical(2, wireMany(2, [["D13", "R1:A"], ["R1:B", "LED:K"], ["LED:A", "GND"]]));
  check("reversed-led-blocks-calculation", reversed.blocked && !reversed.calculated && reversed.channels.length === 0 && issueCodes(reversed).has("LED_REVERSED"));

  const shorted = analyzeElectrical(2, wireMany(2, [["D13", "GND"]]));
  check("short-blocks-calculation", shorted.blocked && issueCodes(shorted).has("SHORT_D13_GND"));

  const unsupported = analyzeElectrical(4, createCircuit(4));
  check("unsupported-electrical-lesson", !unsupported.supported && unsupported.blocked && !unsupported.calculated && issueCodes(unsupported).has("UNSUPPORTED_ELECTRICAL_LESSON"));

  let nonFiveVoltRejected = false;
  try { analyzeElectrical(2, wireMany(2, LESSON_2_GOOD), { supplyVolts: 3.3 }); } catch (error) { nonFiveVoltRejected = error instanceof RangeError; }
  check("non-5v-supply-rejected", nonFiveVoltRejected);

  let lowResistanceRejected = false;
  try { analyzeElectrical(2, wireMany(2, LESSON_2_GOOD), { channels: { led: { resistorOhms: 99 } } }); } catch (error) { lowResistanceRejected = error instanceof RangeError; }
  check("resistance-bound", lowResistanceRejected);

  let vfRejected = false;
  try { analyzeElectrical(2, wireMany(2, LESSON_2_GOOD), { channels: { led: { forwardVoltageVolts: 4.1 } } }); } catch (error) { vfRejected = error instanceof RangeError; }
  check("forward-voltage-bound", vfRejected);

  let unknownChannelRejected = false;
  try { analyzeElectrical(2, wireMany(2, LESSON_2_GOOD), { channels: { blue: { resistorOhms: 220 } } }); } catch (error) { unknownChannelRejected = error instanceof RangeError; }
  check("unknown-channel-rejected", unknownChannelRejected);

  return { total: results.length, passed: results.length, failed: 0, results };
}
