import {
  AVR_PANEL_A0_MAX_MILLIVOLTS,
  validateAvrPanelA0Millivolts,
} from "../src/avr-panel.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectRangeError(value, fragment) {
  let error = null;
  try {
    validateAvrPanelA0Millivolts(value);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof RangeError, `${value}: expected RangeError`);
  assert(String(error.message).includes(fragment), `${value}: missing error fragment ${fragment}`);
}

export function runAvrPanelValidationContracts() {
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };

  check("default-avcc-ui-bound-is-5000mv", () => {
    assert(AVR_PANEL_A0_MAX_MILLIVOLTS === 5000, "panel A0 maximum must match default AVCC/VREF");
    assert(validateAvrPanelA0Millivolts("0") === 0, "0mV must be accepted");
    assert(validateAvrPanelA0Millivolts("5000") === 5000, "5000mV must be accepted");
    assert(validateAvrPanelA0Millivolts(" 2500 ") === 2500, "trimmed integer input");
    assert(validateAvrPanelA0Millivolts("") === null, "blank input must mean unknown/clear");
  });

  check("over-vref-values-fail-before-runner-mutation", () => {
    expectRangeError("5001", "5000 mV");
    expectRangeError("5501", "5000 mV");
    expectRangeError("-1", "5000 mV");
    expectRangeError("3.5", "5000 mV");
  });

  check("validation-is-pure-and-does-not-emit-evidence", () => {
    let mutations = 0;
    let evidence = 0;
    const fakeRunner = {
      setAnalogInputMillivolts() { mutations += 1; },
    };
    const onEvidence = () => { evidence += 1; };
    for (const value of ["5001", "5501"]) {
      try {
        const millivolts = validateAvrPanelA0Millivolts(value);
        fakeRunner.setAnalogInputMillivolts(0, millivolts);
        onEvidence();
      } catch {
        // This mirrors the panel ordering: validation occurs before runner mutation
        // and before updatePeripheralState()/onEvidence on the successful path.
      }
    }
    assert(mutations === 0, "invalid values must not reach runner setter");
    assert(evidence === 0, "invalid values must not emit evidence");
  });

  return Object.freeze({ passed: checks.length, checks: Object.freeze([...checks]) });
}
