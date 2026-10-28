/**
 * Opt-in, bounded AVR peripheral experiment. Does not replace the CPU-only
 * educational mode or the rule-based lesson simulator. Every observable output
 * below comes from actual compiled AVR instructions and attached register hooks.
 * There is no physical Uno, electrical solver, sensor or motor in this backend.
 */
import { CPU } from "../assets/vendor/avr/cpu.js";
import { avrInstruction } from "../assets/vendor/avr/instruction.js";
import { parseIntelHex } from "./avr-runtime.js";
import { createAvrGpio } from "./avr-gpio.js";
import { createAvrTimer0 } from "./avr-timer0.js";
import { createAvrAnalogSerial } from "./avr-analog-serial.js";

const MAX_CYCLES_PER_CALL = 100_000;

export const AVR_BOARD_LAB_CAPABILITIES = Object.freeze({
  mode: "bounded-peripheral-experiment",
  mcu: "atmega328p",
  clockHz: 16_000_000,
  genuineCompiledMachineCode: true,
  gpioRegisterPinStates: true,
  timer0CounterOverflow: true,
  adcExplicitFixedInputs: true,
  usart0Async8BitTx: true,
  usartRx: false,
  timer1Timer2: false,
  pwmWaveforms: false,
  externalSensors: false,
  motorServoPhysics: false,
  delayMillisMicrosParity: false,
  completeArduinoUno: false,
  physicalHardware: false,
});

function assertCycles(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_CYCLES_PER_CALL) {
    throw new RangeError(`cycleBudget phải là số nguyên 1..${MAX_CYCLES_PER_CALL}.`);
  }
}

export function createAvrBoardRunner(hexText) {
  const firmware = parseIntelHex(hexText);
  const program = new Uint16Array(firmware.flash.length / 2);
  new Uint8Array(program.buffer).set(firmware.flash);
  const cpu = new CPU(program, 2 * 1024);
  let gpio = null;
  let timer0 = null;
  let analogSerial = null;
  let disposed = false;

  try {
    gpio = createAvrGpio(cpu);
    timer0 = createAvrTimer0(cpu);
    analogSerial = createAvrAnalogSerial(cpu);
  } catch (error) {
    // Partial peripheral installation must not leave hooks attached to a CPU.
    try { analogSerial?.dispose(); } catch {}
    try { timer0?.dispose(); } catch {}
    try { gpio?.dispose(); } catch {}
    throw error;
  }

  const active = () => {
    if (disposed) throw new Error("AVR peripheral lab đã đóng; hãy nạp lại HEX để chạy.");
  };
  const pcGuard = () => {
    if (!Number.isInteger(cpu.pc) || cpu.pc < 0 || cpu.pc >= program.length) {
      throw new RangeError("PC nằm ngoài giới hạn flash ATmega328P.");
    }
  };

  function snapshot() {
    active();
    return Object.freeze({
      pcWords: cpu.pc,
      pcBytes: cpu.pc * 2,
      cycles: cpu.cycles,
      sp: cpu.SP,
      sreg: cpu.SREG,
      boardD13: gpio.readBoardD13(),
      gpio: gpio.snapshot(),
      timer0: timer0.snapshot(),
      analogSerial: analogSerial.snapshot(),
    });
  }

  function step() {
    active();
    pcGuard();
    const beforeCycles = cpu.cycles;
    const beforePcWords = cpu.pc;
    avrInstruction(cpu);
    cpu.tick();
    return Object.freeze({
      beforePcWords,
      afterPcWords: cpu.pc,
      cycles: cpu.cycles - beforeCycles,
      snapshot: snapshot(),
    });
  }

  function runCycles(cycleBudget) {
    active();
    assertCycles(cycleBudget);
    const firstCycles = cpu.cycles;
    let instructions = 0;
    while (cpu.cycles - firstCycles < cycleBudget) {
      pcGuard();
      avrInstruction(cpu);
      cpu.tick();
      instructions++;
    }
    return Object.freeze({
      requestedCycles: cycleBudget,
      executedCycles: cpu.cycles - firstCycles,
      instructions,
      snapshot: snapshot(),
    });
  }

  function readData(address) {
    active();
    if (!Number.isInteger(address) || address < 0 || address >= cpu.data.length) {
      throw new RangeError("Địa chỉ data-space AVR phải nằm trong SRAM/IO ATmega328P.");
    }
    return cpu.readData(address);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    analogSerial.dispose();
    timer0.dispose();
    gpio.dispose();
  }

  return Object.freeze({
    capabilities: AVR_BOARD_LAB_CAPABILITIES,
    firmware: Object.freeze({
      bytesLoaded: firmware.bytesLoaded,
      minAddress: firmware.minAddress,
      maxAddress: firmware.maxAddress,
    }),
    step,
    runCycles,
    snapshot,
    readData,
    readBoardD13: () => { active(); return gpio.readBoardD13(); },
    setExternalPin: (pin, level) => { active(); return gpio.setExternalPin(pin, level); },
    setAnalogInputMillivolts: (channel, millivolts) => {
      active(); return analogSerial.setAnalogInputMillivolts(channel, millivolts);
    },
    clearAnalogInput: channel => { active(); return analogSerial.clearAnalogInput(channel); },
    getTxBytes: () => { active(); return analogSerial.getTxBytes(); },
    clearTx: () => { active(); return analogSerial.clearTx(); },
    dispose,
  });
}
