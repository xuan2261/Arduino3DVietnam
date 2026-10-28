// Browser:
// import("/tests/avr-gpio-contracts.js").then(m => m.runAvrGpioContracts())
import { CPU } from "../assets/vendor/avr/cpu.js";
import { avrInstruction } from "../assets/vendor/avr/instruction.js";
import {
  ARDUINO_UNO_GPIO_PINS,
  ATMEGA328P_GPIO_REGISTERS,
  createAvrGpio,
} from "../src/avr-gpio.js";

function newCpu(program = new Uint16Array(16)) {
  return new CPU(program, 2 * 1024);
}

export function runAvrGpioContracts() {
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  check("register-addresses", (
    ATMEGA328P_GPIO_REGISTERS.B.pin === 0x23 &&
    ATMEGA328P_GPIO_REGISTERS.B.ddr === 0x24 &&
    ATMEGA328P_GPIO_REGISTERS.B.port === 0x25 &&
    ATMEGA328P_GPIO_REGISTERS.C.pin === 0x26 &&
    ATMEGA328P_GPIO_REGISTERS.C.ddr === 0x27 &&
    ATMEGA328P_GPIO_REGISTERS.C.port === 0x28 &&
    ATMEGA328P_GPIO_REGISTERS.D.pin === 0x29 &&
    ATMEGA328P_GPIO_REGISTERS.D.ddr === 0x2a &&
    ATMEGA328P_GPIO_REGISTERS.D.port === 0x2b
  ));
  check("uno-pin-map-count", ARDUINO_UNO_GPIO_PINS.length === 20);
  check("d13-pb5-map", ARDUINO_UNO_GPIO_PINS.some(pin =>
    pin.arduinoPin === "D13" && pin.avrPin === "PB5" && pin.bit === 5
  ));

  const changes = [];
  const cpu = newCpu();
  const gpio = createAvrGpio(cpu, { onChange: event => changes.push(event) });
  const B = ATMEGA328P_GPIO_REGISTERS.B;
  const C = ATMEGA328P_GPIO_REGISTERS.C;
  const D = ATMEGA328P_GPIO_REGISTERS.D;

  check("initial-d13-input", gpio.readBoardD13().mode === "input");
  check("initial-d13-floating", gpio.readBoardD13().floating && gpio.readBoardD13().level === null);

  cpu.writeData(B.ddr, 0x20);
  cpu.writeData(B.port, 0x20);
  const d13High = gpio.readBoardD13();
  check("d13-output-high", d13High.mode === "output" && d13High.level === true && d13High.outputLatch === true);
  check("pinb-reflects-d13-output", Boolean(cpu.readData(B.pin) & 0x20));
  check("d13-change-callback", changes.some(event =>
    event.arduinoPin === "D13" && event.source === "port-write" && event.current.level === true
  ));

  cpu.writeData(B.port, 0x00, 0x20);
  check("masked-port-write-d13-low", gpio.readBoardD13().level === false);
  cpu.writeData(B.pin, 0x20);
  check("pinb-write-one-toggles-portb", gpio.readBoardD13().level === true && Boolean(cpu.data[B.port] & 0x20));
  cpu.writeData(B.pin, 0xff, 0x20);
  check("pinb-toggle-honors-mask", gpio.readBoardD13().level === false && (cpu.data[B.port] & ~0x20) === 0);

  gpio.setExternalPin("D2", true);
  check("external-d2-high", Boolean(cpu.readData(D.pin) & 0x04) && gpio.readPin("PD2").level === true);
  gpio.setExternalPin("PD2", false);
  check("external-d2-low", !(cpu.readData(D.pin) & 0x04) && gpio.readPin("D2").level === false);

  gpio.setExternalPin("D2", null);
  cpu.writeData(D.port, 0x04, 0x04);
  const d2Pullup = gpio.readPin("D2");
  check("input-pullup-high", d2Pullup.mode === "input" && d2Pullup.pullup && d2Pullup.level === true);
  gpio.setExternalPin("D2", false);
  check("external-low-overrides-pullup", gpio.readPin("D2").level === false);

  gpio.setExternalPin("D2", null);
  cpu.writeData(D.port, 0x00, 0x04);
  const d2Floating = gpio.readPin("D2");
  check("floating-is-explicit", d2Floating.floating && d2Floating.level === null && d2Floating.registerLevel === false);
  check("floating-pin-register-deterministic-low", !(cpu.readData(D.pin) & 0x04));

  gpio.setExternalPin("D13", false);
  cpu.writeData(B.ddr, 0x20, 0x20);
  cpu.writeData(B.port, 0x20, 0x20);
  const contention = gpio.readBoardD13();
  check("output-contention-reported", contention.level === true && contention.externalLevel === false && contention.contention === true);

  gpio.setExternalPin("A0", true);
  check("a0-pc0-digital-input", Boolean(cpu.readData(C.pin) & 0x01) && gpio.readPin("PC0").arduinoPin === "A0");

  cpu.writeData(B.ddr, 0xa5);
  cpu.writeData(B.ddr, 0x20, 0x20);
  check("ddr-masked-write-preserves-other-bits", cpu.data[B.ddr] === 0xa5);

  const resetCpu = newCpu();
  const resetGpio = createAvrGpio(resetCpu, { initialExternalPins: { D2: true } });
  resetCpu.writeData(D.ddr, 0xff);
  resetCpu.writeData(D.port, 0xff);
  const resetState = resetGpio.reset();
  check("reset-clears-ddr-port", resetState.registers.D.ddr === 0 && resetState.registers.D.port === 0);
  check("reset-preserves-external-environment", resetGpio.readPin("D2").externalLevel === true && resetGpio.readPin("D2").level === true);
  resetGpio.dispose();

  let invalidPin = false;
  try { gpio.setExternalPin("D99", true); } catch (error) { invalidPin = error instanceof RangeError; }
  check("invalid-pin-rejected", invalidPin);
  let invalidLevel = false;
  try { gpio.setExternalPin("D2", 1); } catch (error) { invalidLevel = error instanceof TypeError; }
  check("invalid-level-rejected", invalidLevel);
  let invalidCallback = false;
  try { createAvrGpio(newCpu(), { onChange: "no" }); } catch (error) { invalidCallback = error instanceof TypeError; }
  check("invalid-callback-rejected", invalidCallback);

  const conflictCpu = newCpu();
  const existingHook = () => 0;
  conflictCpu.readHooks[B.pin] = existingHook;
  let conflictRejected = false;
  try { createAvrGpio(conflictCpu); } catch (error) { conflictRejected = /hooks/.test(error.message); }
  check("hook-conflict-rejected", conflictRejected && conflictCpu.readHooks[B.pin] === existingHook && !conflictCpu.writeHooks[B.ddr]);

  const instructionProgram = new Uint16Array([
    0xe200, // LDI r16, 0x20
    0xb904, // OUT DDRB (I/O 0x04), r16
    0xb905, // OUT PORTB (I/O 0x05), r16
    0xb113, // IN r17, PINB (I/O 0x03)
  ]);
  const instructionCpu = newCpu(instructionProgram);
  const instructionGpio = createAvrGpio(instructionCpu);
  for (let index = 0; index < 4; index += 1) avrInstruction(instructionCpu);
  check("actual-avr-out-in-hooks", (
    instructionCpu.data[B.ddr] === 0x20 &&
    instructionCpu.data[B.port] === 0x20 &&
    instructionCpu.data[17] === 0x20 &&
    instructionGpio.readBoardD13().level === true
  ));
  instructionGpio.dispose();

  const disposedCpu = newCpu();
  const disposedGpio = createAvrGpio(disposedCpu);
  disposedGpio.dispose();
  check("dispose-removes-hooks", !disposedCpu.readHooks[B.pin] && !disposedCpu.writeHooks[B.ddr] && !disposedCpu.writeHooks[B.port]);
  let useAfterDispose = false;
  try { disposedGpio.readBoardD13(); } catch (error) { useAfterDispose = /dispose/.test(error.message); }
  check("use-after-dispose-rejected", useAfterDispose);

  gpio.dispose();
  return { total: results.length, passed: results.length, failed: 0, results };
}
