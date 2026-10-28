/** Browser contract for opt-in bounded peripheral execution, not hardware QA. */
import { loadVerifiedFirmware } from "../src/firmware-integrity.js";
import {
  createAvrBoardRunner,
  AVR_BOARD_LAB_CAPABILITIES,
} from "../src/avr-board-runner.js";

function assert(ok, label) {
  if (!ok) throw new Error(`AVR peripheral lab contract: ${label}`);
}

function rejects(fn, fragment) {
  try { fn(); } catch (error) {
    return String(error?.message ?? error).includes(fragment);
  }
  return false;
}

function runLesson15Sample(hexText, millivolts) {
  const runner = createAvrBoardRunner(hexText);
  try {
    runner.setAnalogInputMillivolts(0, millivolts);
    for (let chunk = 1; chunk <= 12; chunk++) {
      const result = runner.runCycles(100_000);
      const snap = result.snapshot;
      const txBytes = runner.getTxBytes();
      if (snap.analogSerial.adc.conversionsCompleted > 0 && txBytes.includes(10)) {
        return Object.freeze({
          chunk,
          cycles: snap.cycles,
          snapshot: snap,
          txText: new TextDecoder().decode(txBytes),
        });
      }
    }
    throw new Error("lesson15 không hoàn thành ADC + một dòng USART trong 1.200.000 cycles");
  } finally {
    runner.dispose();
  }
}

export async function runAvrBoardContracts() {
  const checks = [];
  const check = (name, run) => {
    run();
    checks.push(name);
  };
  const firmware = await loadVerifiedFirmware(1);
  const lesson15Firmware = await loadVerifiedFirmware(15);
  check("bundled-hex-sha-verified", () => {
    assert(firmware.verification === "sha256-match" && firmware.lessonId === 1,
      "compiled example must be SHA-verified before CPU execution");
  });
  check("explicit-support-boundaries", () => {
    assert(AVR_BOARD_LAB_CAPABILITIES.gpioRegisterPinStates, "GPIO should be advertised");
    assert(AVR_BOARD_LAB_CAPABILITIES.timer0CounterOverflow, "Timer0 counter should be advertised");
    assert(AVR_BOARD_LAB_CAPABILITIES.adcExplicitFixedInputs, "ADC requires a fixed input");
    assert(AVR_BOARD_LAB_CAPABILITIES.usart0Async8BitTx, "USART TX should be advertised");
    for (const key of ["completeArduinoUno", "physicalHardware", "pwmWaveforms", "externalSensors", "usartRx", "delayMillisMicrosParity"]) {
      assert(AVR_BOARD_LAB_CAPABILITIES[key] === false, `${key} must be explicitly unsupported`);
    }
  });
  const runner = createAvrBoardRunner(firmware.hexText);
  try {
    check("start-unfabricated-inputs", () => {
      const snap = runner.snapshot();
      assert(snap.pcWords === 0 && snap.cycles === 0, "CPU starts at real reset vector");
      assert(snap.gpio.pins.D2.level === null, "external digital pin D2 starts floating");
      assert(snap.analogSerial.analogInputsMillivolts.every(value => value === null),
        "ADC values cannot be invented by lesson code");
      assert(runner.getTxBytes().length === 0, "no preconstructed Serial data");
    });
    check("explicit-digital-input-simulation", () => {
      runner.setExternalPin("D2", true);
      const pin = runner.snapshot().gpio.pins.D2;
      assert(pin.externalLevel === true, "only user-provided D2 input should be HIGH");
      runner.setExternalPin("D2", null);
      assert(runner.snapshot().gpio.pins.D2.level === null,
        "clearing the input restores the floating/unknown state");
    });
    check("bounded-input-validation", () => {
      assert(rejects(() => runner.setExternalPin("D40", true), "Pin"), "unknown Arduino pin must be rejected");
      assert(rejects(() => runner.setExternalPin("D2", "high"), "true"), "untyped external level must be rejected");
      assert(rejects(() => runner.setAnalogInputMillivolts(9, 500), "ADC channel"), "ADC channel range");
      assert(rejects(() => runner.setAnalogInputMillivolts(0, 5501), "analog"), "ADC mV bounds");
      assert(rejects(() => runner.runCycles(100001), "cycleBudget"), "synchronous max cycle guard");
    });
    check("explicit-fixed-adc-input-only", () => {
      runner.setAnalogInputMillivolts(0, 2500);
      assert(runner.snapshot().analogSerial.analogInputsMillivolts[0] === 2500,
        "only configured A0 fixed input should be recorded");
      assert(runner.snapshot().analogSerial.analogInputsMillivolts[1] === null,
        "unconfigured A1 input stays unknown");
      runner.clearAnalogInput(0);
      assert(runner.snapshot().analogSerial.analogInputsMillivolts[0] === null,
        "clearing fixed input removes it rather than setting 0V");
    });
    check("step-executes-real-opcode", () => {
      const result = runner.step();
      assert(result.cycles > 0 && result.snapshot.cycles > 0, "CPU instruction must advance cycles");
    });
    check("compiled-lesson-one-drives-register-and-d13", () => {
      runner.runCycles(100_000);
      const pin = runner.readBoardD13();
      const snap = runner.snapshot();
      assert((runner.readData(0x24) & 0x20) !== 0, "DDRB PB5 output bit must come from real firmware");
      assert((runner.readData(0x25) & 0x20) !== 0, "PORTB PB5 HIGH must come from real firmware");
      assert(pin.mode === "output" && pin.level === true,
        "D13 pin-level reflects actual register hooks, not a rendered LED");
      assert(snap.timer0.cpuCycles > 0 && snap.analogSerial.usart.capturedBytes === 0,
        "Timer0 clock is based on instructions and no Serial data is synthesized");
    });
    check("snapshot-independent-and-invalid-after-dispose", () => {
      const first = runner.snapshot();
      const second = runner.snapshot();
      assert(first !== second, "snapshot object references are independent");
    });
  } finally {
    runner.dispose();
  }
  check("lifecycle-dispose-denies-reuse", () => {
    assert(rejects(() => runner.snapshot(), "đã đóng"), "disposed snapshot must reject");
    assert(rejects(() => runner.setExternalPin("D2", true), "đã đóng"), "disposed input must reject");
    runner.dispose(); // idempotent
  });
  check("compiled-lesson-fifteen-high-adc-drives-d13-and-usart", () => {
    assert(lesson15Firmware.verification === "sha256-match" && lesson15Firmware.lessonId === 15,
      "lesson15 HEX must be SHA-verified before peripheral execution");
    const inputMillivolts = 4000;
    const expectedRaw = Math.floor((inputMillivolts / 5000) * 1024);
    const sample = runLesson15Sample(lesson15Firmware.hexText, inputMillivolts);
    const snap = sample.snapshot;
    assert(sample.chunk <= 12 && sample.cycles <= 1_200_000,
      "lesson15 high sample must remain within the bounded execution budget");
    assert(snap.analogSerial.adc.lastConversionRaw === expectedRaw && expectedRaw > 650,
      "real lesson15 firmware must convert A0=4000mV above its raw threshold");
    assert(snap.boardD13.mode === "output" && snap.boardD13.level === true,
      "real lesson15 firmware must drive D13 HIGH for an ADC result above 650");
    assert(sample.txText === `${expectedRaw}\r\n`,
      "USART capture must be the firmware Serial.println(raw) result");
  });
  check("compiled-lesson-fifteen-low-adc-keeps-d13-low-and-usart", () => {
    assert(lesson15Firmware.verification === "sha256-match" && lesson15Firmware.lessonId === 15,
      "lesson15 HEX must remain SHA-verified for the negative threshold branch");
    const inputMillivolts = 3000;
    const expectedRaw = Math.floor((inputMillivolts / 5000) * 1024);
    const sample = runLesson15Sample(lesson15Firmware.hexText, inputMillivolts);
    const snap = sample.snapshot;
    assert(sample.chunk <= 12 && sample.cycles <= 1_200_000,
      "lesson15 low sample must remain within the bounded execution budget");
    assert(snap.analogSerial.adc.lastConversionRaw === expectedRaw && expectedRaw <= 650,
      "real lesson15 firmware must convert A0=3000mV below its raw threshold");
    assert(snap.boardD13.mode === "output" && snap.boardD13.level === false,
      "real lesson15 firmware must keep D13 LOW for an ADC result at/below 650");
    assert(sample.txText === `${expectedRaw}\r\n`,
      "USART capture must report the low ADC result emitted by firmware");
  });
  return Object.freeze({ total: checks.length, passed: checks.length, checks: Object.freeze(checks) });
}
