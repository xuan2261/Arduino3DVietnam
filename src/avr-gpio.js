/**
 * Bounded ATmega328P / Arduino Uno digital GPIO peripheral for the vendored
 * avr8js CPU core. This models GPIO register behavior only; it does not model
 * electrical current, analog peripherals, timers, external components, or
 * physical hardware safety.
 */

export const ATMEGA328P_GPIO_REGISTERS = Object.freeze({
  B: Object.freeze({ pin: 0x23, ddr: 0x24, port: 0x25, supportedMask: 0x3f }),
  C: Object.freeze({ pin: 0x26, ddr: 0x27, port: 0x28, supportedMask: 0x3f }),
  D: Object.freeze({ pin: 0x29, ddr: 0x2a, port: 0x2b, supportedMask: 0xff }),
});

const PIN_DESCRIPTORS = [];
const PIN_BY_NAME = new Map();

function definePin(port, bit, arduinoPin) {
  const descriptor = Object.freeze({
    port,
    bit,
    avrPin: "P" + port + bit,
    arduinoPin,
  });
  PIN_DESCRIPTORS.push(descriptor);
  PIN_BY_NAME.set(descriptor.avrPin, descriptor);
  PIN_BY_NAME.set(arduinoPin, descriptor);
}

for (let bit = 0; bit <= 7; bit += 1) definePin("D", bit, "D" + bit);
for (let bit = 0; bit <= 5; bit += 1) definePin("B", bit, "D" + (bit + 8));
for (let bit = 0; bit <= 5; bit += 1) definePin("C", bit, "A" + bit);

export const ARDUINO_UNO_GPIO_PINS = Object.freeze(
  PIN_DESCRIPTORS.map(pin => Object.freeze({ ...pin })),
);

const PINS_BY_PORT = Object.freeze({
  B: Object.freeze(PIN_DESCRIPTORS.filter(pin => pin.port === "B")),
  C: Object.freeze(PIN_DESCRIPTORS.filter(pin => pin.port === "C")),
  D: Object.freeze(PIN_DESCRIPTORS.filter(pin => pin.port === "D")),
});

function assertCpu(cpu) {
  if (!cpu || typeof cpu !== "object") {
    throw new TypeError("cpu phải là một instance CPU tương thích avr8js.");
  }
  if (!(cpu.data instanceof Uint8Array) || cpu.data.length <= 0x2b) {
    throw new TypeError("cpu.data không đủ không gian thanh ghi ATmega328P.");
  }
  if (!Array.isArray(cpu.readHooks) || !Array.isArray(cpu.writeHooks) ||
      typeof cpu.readData !== "function" || typeof cpu.writeData !== "function") {
    throw new TypeError("cpu phải cung cấp data/readHooks/writeHooks/readData/writeData của avr8js.");
  }
}

function assertOptions(options) {
  if (options === undefined) return {};
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options phải là object nếu được cung cấp.");
  }
  const onChange = options.onChange;
  if (onChange !== undefined && typeof onChange !== "function") {
    throw new TypeError("options.onChange phải là function.");
  }
  const initial = options.initialExternalPins;
  if (initial !== undefined && (!initial || typeof initial !== "object" || Array.isArray(initial))) {
    throw new TypeError("options.initialExternalPins phải là object.");
  }
  return options;
}

function resolvePin(pin) {
  if (typeof pin !== "string" || !pin.trim()) {
    throw new TypeError("pin phải là chuỗi như D13, PB5 hoặc A0.");
  }
  const descriptor = PIN_BY_NAME.get(pin.trim().toUpperCase());
  if (!descriptor) {
    throw new RangeError("Pin " + pin + " không thuộc GPIO Arduino Uno được module này hỗ trợ.");
  }
  return descriptor;
}

function assertExternalLevel(level) {
  if (level !== null && typeof level !== "boolean") {
    throw new TypeError("Mức external pin phải là true, false hoặc null (floating).");
  }
}

function byte(value) {
  return Number(value) & 0xff;
}

function maskedWrite(previous, value, mask) {
  const normalizedMask = byte(mask);
  return (byte(previous) & (~normalizedMask & 0xff)) | (byte(value) & normalizedMask);
}

function freezePinState(state) {
  return Object.freeze({ ...state });
}

function sameState(a, b) {
  return a.mode === b.mode &&
    a.outputLatch === b.outputLatch &&
    a.pullup === b.pullup &&
    a.externalLevel === b.externalLevel &&
    a.floating === b.floating &&
    a.level === b.level &&
    a.registerLevel === b.registerLevel &&
    a.contention === b.contention;
}

export function createAvrGpio(cpu, options = undefined) {
  assertCpu(cpu);
  const config = assertOptions(options);
  let onChange = config.onChange ?? null;
  let disposed = false;
  const externalLevels = new Map();

  if (config.initialExternalPins) {
    for (const [name, level] of Object.entries(config.initialExternalPins)) {
      const pin = resolvePin(name);
      assertExternalLevel(level);
      externalLevels.set(pin.avrPin, level);
    }
  }

  const occupied = [];
  for (const registers of Object.values(ATMEGA328P_GPIO_REGISTERS)) {
    if (cpu.readHooks[registers.pin]) {
      occupied.push("read PIN@0x" + registers.pin.toString(16));
    }
    for (const address of [registers.pin, registers.ddr, registers.port]) {
      if (cpu.writeHooks[address]) occupied.push("write@0x" + address.toString(16));
    }
  }
  if (occupied.length) {
    throw new Error("GPIO hooks đã được sử dụng: " + occupied.join(", ") + ".");
  }

  function ensureActive() {
    if (disposed) throw new Error("AVR GPIO controller đã dispose.");
  }

  function pinState(descriptor) {
    const registers = ATMEGA328P_GPIO_REGISTERS[descriptor.port];
    const mask = 1 << descriptor.bit;
    const output = Boolean(cpu.data[registers.ddr] & mask);
    const outputLatch = Boolean(cpu.data[registers.port] & mask);
    const externalLevel = externalLevels.has(descriptor.avrPin)
      ? externalLevels.get(descriptor.avrPin)
      : null;

    if (output) {
      return freezePinState({
        pin: descriptor.avrPin,
        arduinoPin: descriptor.arduinoPin,
        port: descriptor.port,
        bit: descriptor.bit,
        mode: "output",
        outputLatch,
        pullup: false,
        externalLevel,
        floating: false,
        level: outputLatch,
        registerLevel: outputLatch,
        contention: externalLevel !== null && externalLevel !== outputLatch,
      });
    }

    const pullup = outputLatch;
    const floating = externalLevel === null && !pullup;
    const level = externalLevel !== null ? externalLevel : (pullup ? true : null);
    return freezePinState({
      pin: descriptor.avrPin,
      arduinoPin: descriptor.arduinoPin,
      port: descriptor.port,
      bit: descriptor.bit,
      mode: "input",
      outputLatch: false,
      pullup,
      externalLevel,
      floating,
      level,
      // Hardware floating input is undefined. The bounded CPU model returns
      // zero for that register bit so firmware execution remains deterministic.
      registerLevel: level === true,
      contention: false,
    });
  }

  function pinRegisterValue(port) {
    const registers = ATMEGA328P_GPIO_REGISTERS[port];
    let value = cpu.data[registers.pin] & (~registers.supportedMask & 0xff);
    for (const descriptor of PINS_BY_PORT[port]) {
      if (pinState(descriptor).registerLevel) value |= 1 << descriptor.bit;
    }
    return value & 0xff;
  }

  function refreshPinRegister(port) {
    const registers = ATMEGA328P_GPIO_REGISTERS[port];
    cpu.data[registers.pin] = pinRegisterValue(port);
  }

  function refreshAllPinRegisters() {
    refreshPinRegister("B");
    refreshPinRegister("C");
    refreshPinRegister("D");
  }

  function capturePort(port) {
    return new Map(PINS_BY_PORT[port].map(pin => [pin.avrPin, pinState(pin)]));
  }

  function emitChanges(port, before, source) {
    if (!onChange) return;
    for (const descriptor of PINS_BY_PORT[port]) {
      const previous = before.get(descriptor.avrPin);
      const current = pinState(descriptor);
      if (!sameState(previous, current)) {
        onChange(Object.freeze({
          source,
          pin: current.pin,
          arduinoPin: current.arduinoPin,
          previous,
          current,
        }));
      }
    }
  }

  const installedReadHooks = new Map();
  const installedWriteHooks = new Map();

  for (const [port, registers] of Object.entries(ATMEGA328P_GPIO_REGISTERS)) {
    const readPin = () => {
      const value = pinRegisterValue(port);
      cpu.data[registers.pin] = value;
      return value;
    };
    const writeDdr = (value, oldValue, _address, mask) => {
      const before = capturePort(port);
      cpu.data[registers.ddr] = maskedWrite(oldValue, value, mask);
      refreshPinRegister(port);
      emitChanges(port, before, "ddr-write");
      return true;
    };
    const writePort = (value, oldValue, _address, mask) => {
      const before = capturePort(port);
      cpu.data[registers.port] = maskedWrite(oldValue, value, mask);
      refreshPinRegister(port);
      emitChanges(port, before, "port-write");
      return true;
    };
    const writePin = (value, _oldValue, _address, mask) => {
      const before = capturePort(port);
      // ATmega328P PINx write semantics: writing one toggles PORTx latch.
      cpu.data[registers.port] ^= byte(value) & byte(mask);
      refreshPinRegister(port);
      emitChanges(port, before, "pin-toggle");
      return true;
    };

    cpu.readHooks[registers.pin] = readPin;
    cpu.writeHooks[registers.pin] = writePin;
    cpu.writeHooks[registers.ddr] = writeDdr;
    cpu.writeHooks[registers.port] = writePort;
    installedReadHooks.set(registers.pin, readPin);
    installedWriteHooks.set(registers.pin, writePin);
    installedWriteHooks.set(registers.ddr, writeDdr);
    installedWriteHooks.set(registers.port, writePort);
  }

  refreshAllPinRegisters();

  function setExternalPin(pinName, level) {
    ensureActive();
    const descriptor = resolvePin(pinName);
    assertExternalLevel(level);
    const before = capturePort(descriptor.port);
    externalLevels.set(descriptor.avrPin, level);
    refreshPinRegister(descriptor.port);
    emitChanges(descriptor.port, before, "external");
    return pinState(descriptor);
  }

  function readPin(pinName) {
    ensureActive();
    return pinState(resolvePin(pinName));
  }

  function readBoardD13() {
    return readPin("D13");
  }

  function snapshot() {
    ensureActive();
    const registers = {};
    for (const [port, map] of Object.entries(ATMEGA328P_GPIO_REGISTERS)) {
      registers[port] = Object.freeze({
        pin: cpu.readData(map.pin),
        ddr: cpu.data[map.ddr],
        port: cpu.data[map.port],
      });
    }
    const pins = {};
    for (const descriptor of PIN_DESCRIPTORS) {
      pins[descriptor.arduinoPin] = pinState(descriptor);
    }
    return Object.freeze({
      registers: Object.freeze(registers),
      pins: Object.freeze(pins),
      boardD13: pins.D13,
    });
  }

  function reset() {
    ensureActive();
    const before = new Map(PIN_DESCRIPTORS.map(pin => [pin.avrPin, pinState(pin)]));
    for (const registers of Object.values(ATMEGA328P_GPIO_REGISTERS)) {
      cpu.data[registers.ddr] = 0;
      cpu.data[registers.port] = 0;
      cpu.data[registers.pin] = 0;
    }
    refreshAllPinRegisters();
    if (onChange) {
      for (const descriptor of PIN_DESCRIPTORS) {
        const previous = before.get(descriptor.avrPin);
        const current = pinState(descriptor);
        if (!sameState(previous, current)) {
          onChange(Object.freeze({
            source: "reset",
            pin: current.pin,
            arduinoPin: current.arduinoPin,
            previous,
            current,
          }));
        }
      }
    }
    return snapshot();
  }

  function dispose() {
    if (disposed) return;
    for (const [address, hook] of installedReadHooks) {
      if (cpu.readHooks[address] === hook) cpu.readHooks[address] = undefined;
    }
    for (const [address, hook] of installedWriteHooks) {
      if (cpu.writeHooks[address] === hook) cpu.writeHooks[address] = undefined;
    }
    disposed = true;
    onChange = null;
    externalLevels.clear();
  }

  return Object.freeze({
    setExternalPin,
    readPin,
    readBoardD13,
    snapshot,
    reset,
    dispose,
  });
}
