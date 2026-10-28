// Strict bounded ATmega328P Timer1 core peripheral for the vendored avr8js CPU.
// Grounded in avr8js v0.21.1 timer1Config/AVRTimer and ATmega328P Timer1 docs.

export const AVR_TIMER1_CPU_HZ = 16_000_000;

export const AVR_TIMER1_REGISTERS = Object.freeze({
  TIFR1: 0x36,
  TCCR1A: 0x80,
  TCCR1B: 0x81,
  TCCR1C: 0x82,
  TCNT1L: 0x84,
  TCNT1H: 0x85,
  ICR1L: 0x86,
  ICR1H: 0x87,
  OCR1AL: 0x88,
  OCR1AH: 0x89,
  OCR1BL: 0x8a,
  OCR1BH: 0x8b,
  TIMSK1: 0x6f,
});

export const AVR_TIMER1_BITS = Object.freeze({
  TOV1: 0x01,
  TOIE1: 0x01,
  OCF1A: 0x02,
  OCF1B: 0x04,
  ICF1: 0x20,
});

export const AVR_TIMER1_CAPABILITIES = Object.freeze({
  mcu: "atmega328p",
  cpuClockHz: AVR_TIMER1_CPU_HZ,
  counterBits: 16,
  normalMode: true,
  overflowFlag: true,
  overflowInterrupt: true,
  internalPrescalers: Object.freeze([1, 8, 64, 256, 1024]),
  sharedHighByteTempLatch: true,
  ctc: false,
  pwm: false,
  compareMatch: false,
  outputComparePins: false,
  inputCapture: false,
  externalClock: false,
  servoParity: false,
  millisParity: false,
  delayParity: false,
  wallClock: false,
});

const DIVIDERS = Object.freeze([0, 1, 8, 64, 256, 1024, 0, 0]);
const OVERFLOW_VECTOR = 0x1a;
const TCCR1A_WGM_MASK = 0x03;
const TCCR1B_WGM_MASK = 0x18;
const TCCR1A_ALLOWED_MASK = TCCR1A_WGM_MASK;
const TCCR1B_ALLOWED_MASK = TCCR1B_WGM_MASK | 0x07;
const TIMER1_UNSUPPORTED_WRITE_REGISTERS = Object.freeze([
  [AVR_TIMER1_REGISTERS.ICR1L, "ICR1L/input capture"],
  [AVR_TIMER1_REGISTERS.ICR1H, "ICR1H/input capture"],
  [AVR_TIMER1_REGISTERS.OCR1AL, "OCR1AL/compare A"],
  [AVR_TIMER1_REGISTERS.OCR1AH, "OCR1AH/compare A"],
  [AVR_TIMER1_REGISTERS.OCR1BL, "OCR1BL/compare B"],
  [AVR_TIMER1_REGISTERS.OCR1BH, "OCR1BH/compare B"],
]);

function requireCpu(cpu) {
  const methods = [
    "addClockEvent",
    "clearClockEvent",
    "setInterruptFlag",
    "clearInterrupt",
    "clearInterruptByFlag",
    "updateInterruptEnable",
  ];
  if (
    !cpu ||
    !(cpu.data instanceof Uint8Array) ||
    !Array.isArray(cpu.readHooks) ||
    !Array.isArray(cpu.writeHooks) ||
    !Number.isFinite(cpu.cycles) ||
    cpu.data.length <= AVR_TIMER1_REGISTERS.OCR1BH ||
    methods.some(name => typeof cpu[name] !== "function")
  ) {
    throw new TypeError("createAvrTimer1 cần một avr8js CPU tương thích.");
  }
}

function wgmValue(tccr1a, tccr1b) {
  return ((tccr1b & TCCR1B_WGM_MASK) >> 1) | (tccr1a & TCCR1A_WGM_MASK);
}

function requireNormalMode(tccr1a, tccr1b) {
  const wgm = wgmValue(tccr1a, tccr1b);
  if (wgm !== 0) {
    throw new RangeError(`Timer1 WGM=${wgm} chưa được hỗ trợ; chỉ Normal mode WGM=0.`);
  }
  return wgm;
}

function assertSupportedControlBits(tccr1a, tccr1b) {
  if (tccr1a & ~TCCR1A_ALLOWED_MASK) {
    throw new RangeError("Timer1 COM1A/COM1B/reserved bits chưa được hỗ trợ.");
  }
  if (tccr1b & ~TCCR1B_ALLOWED_MASK) {
    throw new RangeError("Timer1 input-capture control/reserved bits chưa được hỗ trợ.");
  }
}

export function createAvrTimer1(cpu) {
  requireCpu(cpu);
  const R = AVR_TIMER1_REGISTERS;
  const B = AVR_TIMER1_BITS;

  const readAddresses = [R.TCNT1L, R.TCNT1H];
  const writeAddresses = [
    R.TCNT1L,
    R.TCNT1H,
    R.TCCR1A,
    R.TCCR1B,
    R.TCCR1C,
    R.TIFR1,
    R.TIMSK1,
    ...TIMER1_UNSUPPORTED_WRITE_REGISTERS.map(([address]) => address),
  ];
  const previousReadHooks = new Map(readAddresses.map(address => [address, cpu.readHooks[address]]));
  const previousWriteHooks = new Map(writeAddresses.map(address => [address, cpu.writeHooks[address]]));
  if (
    [...previousReadHooks.values(), ...previousWriteHooks.values()].some(hook => hook != null)
  ) {
    throw new Error("Timer1 register hooks đã được peripheral khác chiếm dụng.");
  }

  assertSupportedControlBits(cpu.data[R.TCCR1A], cpu.data[R.TCCR1B]);
  const initialCs = cpu.data[R.TCCR1B] & 0x07;
  if (initialCs >= 6) {
    throw new RangeError("Timer1 external clock CS=6/7 chưa được hỗ trợ.");
  }
  if (initialCs !== 0) {
    requireNormalMode(cpu.data[R.TCCR1A], cpu.data[R.TCCR1B]);
  }

  const overflowInterrupt = Object.freeze({
    address: OVERFLOW_VECTOR,
    flagRegister: R.TIFR1,
    flagMask: B.TOV1,
    enableRegister: R.TIMSK1,
    enableMask: B.TOIE1,
  });

  let disposed = false;
  let counter = ((cpu.data[R.TCNT1H] << 8) | cpu.data[R.TCNT1L]) & 0xffff;
  let highByteTemp = cpu.data[R.TCNT1H] & 0xff;
  let divider = DIVIDERS[initialCs];
  let pendingDivider = divider;
  let dividerUpdatePending = false;
  let lastCycle = cpu.cycles;

  function ensureActive() {
    if (disposed) throw new Error("Timer1 đã dispose.");
  }

  function updateCounter() {
    if (!divider) return;
    const delta = cpu.cycles - lastCycle;
    if (delta < divider) return;
    const ticks = Math.floor(delta / divider);
    lastCycle += ticks * divider;
    const previous = counter;
    counter = (counter + ticks) & 0xffff;
    cpu.data[R.TCNT1L] = counter & 0xff;
    if (previous + ticks > 0xffff) {
      cpu.setInterruptFlag(overflowInterrupt);
    }
  }

  function cyclesUntilNextTick() {
    if (!divider) return 0;
    const elapsed = Math.max(0, cpu.cycles - lastCycle);
    return Math.max(1, divider - (elapsed % divider));
  }

  function scheduleNextTick() {
    if (!disposed && divider) {
      cpu.addClockEvent(onClockEvent, cyclesUntilNextTick());
    }
  }

  function scheduleCurrentState() {
    cpu.clearClockEvent(onClockEvent);
    if (dividerUpdatePending) cpu.addClockEvent(onClockEvent, 1);
    else scheduleNextTick();
  }

  function applyPendingDivider() {
    divider = pendingDivider;
    dividerUpdatePending = false;
    lastCycle = divider ? cpu.cycles : 0;
    scheduleNextTick();
  }

  function synchronizeCounter() {
    updateCounter();
    if (dividerUpdatePending) {
      cpu.clearClockEvent(onClockEvent);
      applyPendingDivider();
    }
  }

  function onClockEvent() {
    if (disposed) return;
    if (dividerUpdatePending) {
      applyPendingDivider();
      return;
    }
    updateCounter();
    scheduleNextTick();
  }

  const readCounterLow = () => {
    ensureActive();
    synchronizeCounter();
    highByteTemp = (counter >> 8) & 0xff;
    cpu.data[R.TCNT1H] = highByteTemp;
    cpu.data[R.TCNT1L] = counter & 0xff;
    return cpu.data[R.TCNT1L];
  };

  const readCounterHigh = () => {
    ensureActive();
    return highByteTemp;
  };

  const writeCounterHigh = value => {
    ensureActive();
    highByteTemp = value & 0xff;
    cpu.data[R.TCNT1H] = highByteTemp;
    return true;
  };

  const writeCounterLow = value => {
    ensureActive();
    updateCounter();
    counter = ((highByteTemp << 8) | (value & 0xff)) & 0xffff;
    cpu.data[R.TCNT1L] = counter & 0xff;
    // The high I/O location represents TEMP, not an independently committed
    // TCNT1 high byte. Keep the current TEMP value visible there.
    cpu.data[R.TCNT1H] = highByteTemp;
    scheduleCurrentState();
    return true;
  };

  const writeTccr1a = value => {
    ensureActive();
    const next = value & 0xff;
    assertSupportedControlBits(next, cpu.data[R.TCCR1B]);
    const cs = cpu.data[R.TCCR1B] & 0x07;
    if (cs !== 0) requireNormalMode(next, cpu.data[R.TCCR1B]);
    cpu.data[R.TCCR1A] = next;
    return true;
  };

  const writeTccr1b = value => {
    ensureActive();
    const next = value & 0xff;
    assertSupportedControlBits(cpu.data[R.TCCR1A], next);
    const cs = next & 0x07;
    if (cs >= 6) {
      throw new RangeError("Timer1 external clock CS=6/7 chưa được hỗ trợ.");
    }
    // Unsupported WGM may be staged only while stopped. Starting an internal
    // clock makes the mode observable and therefore requires WGM0.
    if (cs !== 0) requireNormalMode(cpu.data[R.TCCR1A], next);
    cpu.clearClockEvent(onClockEvent);
    cpu.data[R.TCCR1B] = next;
    pendingDivider = DIVIDERS[cs];
    dividerUpdatePending = true;
    cpu.addClockEvent(onClockEvent, 1);
    return true;
  };

  const writeTccr1c = value => {
    ensureActive();
    if ((value & 0xff) !== 0) {
      throw new RangeError("Timer1 force-output-compare chưa được hỗ trợ.");
    }
    cpu.data[R.TCCR1C] = 0;
    return true;
  };

  const writeTifr1 = value => {
    ensureActive();
    const next = value & 0xff;
    if (next & ~B.TOV1) {
      throw new RangeError("Timer1 compare/input-capture flags chưa được hỗ trợ.");
    }
    if (next & B.TOV1) cpu.clearInterruptByFlag(overflowInterrupt, B.TOV1);
    return true;
  };

  const writeTimsk1 = value => {
    ensureActive();
    const next = value & 0xff;
    if (next & ~B.TOIE1) {
      throw new RangeError("Timer1 compare/input-capture interrupts chưa được hỗ trợ.");
    }
    cpu.updateInterruptEnable(overflowInterrupt, next);
    // Return undefined so CPU.writeData stores the mask register value.
  };

  const unsupportedHooks = new Map();
  for (const [address, label] of TIMER1_UNSUPPORTED_WRITE_REGISTERS) {
    const hook = () => {
      ensureActive();
      throw new RangeError(`Timer1 ${label} chưa được hỗ trợ.`);
    };
    unsupportedHooks.set(address, hook);
    cpu.writeHooks[address] = hook;
  }

  cpu.readHooks[R.TCNT1L] = readCounterLow;
  cpu.readHooks[R.TCNT1H] = readCounterHigh;
  cpu.writeHooks[R.TCNT1L] = writeCounterLow;
  cpu.writeHooks[R.TCNT1H] = writeCounterHigh;
  cpu.writeHooks[R.TCCR1A] = writeTccr1a;
  cpu.writeHooks[R.TCCR1B] = writeTccr1b;
  cpu.writeHooks[R.TCCR1C] = writeTccr1c;
  cpu.writeHooks[R.TIFR1] = writeTifr1;
  cpu.writeHooks[R.TIMSK1] = writeTimsk1;
  scheduleNextTick();

  function snapshot() {
    ensureActive();
    synchronizeCounter();
    const wgm = wgmValue(cpu.data[R.TCCR1A], cpu.data[R.TCCR1B]);
    return Object.freeze({
      cpuCycles: cpu.cycles,
      cpuClockHz: AVR_TIMER1_CPU_HZ,
      wgm,
      mode: wgm === 0 ? "normal" : "unsupported-stopped",
      clockSelect: cpu.data[R.TCCR1B] & 0x07,
      divider,
      tcnt1: counter,
      tempHighByte: highByteTemp,
      tov1: Boolean(cpu.data[R.TIFR1] & B.TOV1),
      toie1: Boolean(cpu.data[R.TIMSK1] & B.TOIE1),
      tickMicroseconds: divider ? (divider / AVR_TIMER1_CPU_HZ) * 1_000_000 : null,
      overflowPeriodMicroseconds: divider
        ? (65536 * divider * 1_000_000) / AVR_TIMER1_CPU_HZ
        : null,
    });
  }

  function reset() {
    ensureActive();
    cpu.clearClockEvent(onClockEvent);
    cpu.clearInterrupt(overflowInterrupt, false);
    for (const address of [
      R.TCCR1A,
      R.TCCR1B,
      R.TCCR1C,
      R.TCNT1L,
      R.TCNT1H,
      R.ICR1L,
      R.ICR1H,
      R.OCR1AL,
      R.OCR1AH,
      R.OCR1BL,
      R.OCR1BH,
      R.TIMSK1,
    ]) {
      cpu.data[address] = 0;
    }
    cpu.data[R.TIFR1] &= ~B.TOV1;
    counter = 0;
    highByteTemp = 0;
    divider = 0;
    pendingDivider = 0;
    dividerUpdatePending = false;
    lastCycle = cpu.cycles;
    return snapshot();
  }

  function dispose() {
    if (disposed) return;
    cpu.clearClockEvent(onClockEvent);
    cpu.clearInterrupt(overflowInterrupt, false);
    for (const [address, previous] of previousReadHooks) {
      const current = cpu.readHooks[address];
      if (
        (address === R.TCNT1L && current === readCounterLow) ||
        (address === R.TCNT1H && current === readCounterHigh)
      ) {
        cpu.readHooks[address] = previous;
      }
    }
    for (const [address, previous] of previousWriteHooks) {
      const current = cpu.writeHooks[address];
      const owned =
        (address === R.TCNT1L && current === writeCounterLow) ||
        (address === R.TCNT1H && current === writeCounterHigh) ||
        (address === R.TCCR1A && current === writeTccr1a) ||
        (address === R.TCCR1B && current === writeTccr1b) ||
        (address === R.TCCR1C && current === writeTccr1c) ||
        (address === R.TIFR1 && current === writeTifr1) ||
        (address === R.TIMSK1 && current === writeTimsk1) ||
        unsupportedHooks.get(address) === current;
      if (owned) cpu.writeHooks[address] = previous;
    }
    disposed = true;
  }

  return Object.freeze({
    capabilities: AVR_TIMER1_CAPABILITIES,
    registers: AVR_TIMER1_REGISTERS,
    bits: AVR_TIMER1_BITS,
    overflowVector: OVERFLOW_VECTOR,
    snapshot,
    reset,
    dispose,
  });
}
