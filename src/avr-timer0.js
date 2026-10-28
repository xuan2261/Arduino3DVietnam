// Bounded ATmega328P Timer0 core peripheral for the vendored avr8js CPU.
// Semantics are grounded in wokwi/avr8js v0.21.1 timer0Config/AVRTimer:
// commit bee6f0a94e0e27786f6bc21aee3c775849fb50fd.

export const AVR_TIMER0_CPU_HZ = 16_000_000;

export const AVR_TIMER0_REGISTERS = Object.freeze({
  TIFR0: 0x35,
  TCCR0A: 0x44,
  TCCR0B: 0x45,
  TCNT0: 0x46,
  TIMSK0: 0x6e,
});

export const AVR_TIMER0_BITS = Object.freeze({
  TOV0: 0x01,
  TOIE0: 0x01,
});

export const AVR_TIMER0_CAPABILITIES = Object.freeze({
  mcu: "atmega328p",
  cpuClockHz: AVR_TIMER0_CPU_HZ,
  counterBits: 8,
  normalMode: true,
  fastPwmFixedTopCounter: true,
  overflowFlag: true,
  overflowInterrupt: true,
  internalPrescalers: Object.freeze([1, 8, 64, 256, 1024]),
  compareMatch: false,
  outputComparePins: false,
  pwmDutyOutput: false,
  phaseCorrectPwm: false,
  ctc: false,
  externalClock: false,
  millisParity: false,
  microsParity: false,
  delayParity: false,
});

const DIVIDERS = Object.freeze([0, 1, 8, 64, 256, 1024, 0, 0]);
const SUPPORTED_WGM = new Set([0, 3]);
const OVERFLOW_VECTOR = 0x20;
const FOC_MASK = 0xc0;

function requireCpu(cpu) {
  const requiredMethods = [
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
    cpu.data.length <= AVR_TIMER0_REGISTERS.TIMSK0 ||
    requiredMethods.some((name) => typeof cpu[name] !== "function")
  ) {
    throw new TypeError("createAvrTimer0 cần một avr8js CPU tương thích.");
  }
}

function wgmValue(tccr0a, tccr0b) {
  return ((tccr0b & 0x08) >> 1) | (tccr0a & 0x03);
}

function modeName(wgm) {
  if (wgm === 0) return "normal";
  if (wgm === 3) return "fast-pwm-fixed-top";
  return "unsupported";
}

function requireSupportedMode(tccr0a, tccr0b) {
  const wgm = wgmValue(tccr0a, tccr0b);
  if (!SUPPORTED_WGM.has(wgm)) {
    throw new RangeError(
      `Timer0 WGM=${wgm} chưa được hỗ trợ; chỉ WGM 0 (Normal) và 3 (Fast PWM TOP=0xFF).`,
    );
  }
  return wgm;
}

export function createAvrTimer0(cpu) {
  requireCpu(cpu);
  const R = AVR_TIMER0_REGISTERS;
  const B = AVR_TIMER0_BITS;
  const previousReadTcnt = cpu.readHooks[R.TCNT0];
  const previousWriteHooks = new Map([
    [R.TCNT0, cpu.writeHooks[R.TCNT0]],
    [R.TCCR0A, cpu.writeHooks[R.TCCR0A]],
    [R.TCCR0B, cpu.writeHooks[R.TCCR0B]],
    [R.TIFR0, cpu.writeHooks[R.TIFR0]],
    [R.TIMSK0, cpu.writeHooks[R.TIMSK0]],
  ]);
  if (previousReadTcnt != null || [...previousWriteHooks.values()].some((hook) => hook != null)) {
    throw new Error("Timer0 register hooks đã được peripheral khác chiếm dụng.");
  }

  requireSupportedMode(cpu.data[R.TCCR0A], cpu.data[R.TCCR0B]);
  const initialCs = cpu.data[R.TCCR0B] & 0x07;
  if (initialCs >= 6) {
    throw new RangeError("Timer0 external clock CS=6/7 chưa được hỗ trợ.");
  }

  const overflowInterrupt = Object.freeze({
    address: OVERFLOW_VECTOR,
    flagRegister: R.TIFR0,
    flagMask: B.TOV0,
    enableRegister: R.TIMSK0,
    enableMask: B.TOIE0,
  });

  let disposed = false;
  let tcnt = cpu.data[R.TCNT0] & 0xff;
  let divider = DIVIDERS[initialCs];
  let pendingDivider = divider;
  let dividerUpdatePending = false;
  let lastCycle = cpu.cycles;

  function assertActive() {
    if (disposed) throw new Error("Timer0 đã dispose.");
  }

  function updateCounter() {
    if (!divider) return;
    const delta = cpu.cycles - lastCycle;
    if (delta < divider) return;
    const timerTicks = Math.floor(delta / divider);
    lastCycle += timerTicks * divider;
    const previous = tcnt;
    tcnt = (tcnt + timerTicks) & 0xff;
    cpu.data[R.TCNT0] = tcnt;
    if (previous + timerTicks > 0xff) {
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
    if (dividerUpdatePending) {
      cpu.addClockEvent(onClockEvent, 1);
    } else {
      scheduleNextTick();
    }
  }

  function applyPendingDivider() {
    divider = pendingDivider;
    dividerUpdatePending = false;
    lastCycle = divider ? cpu.cycles : 0;
    scheduleNextTick();
  }

  function synchronizeRead() {
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

  const readTcnt = () => {
    assertActive();
    synchronizeRead();
    return (cpu.data[R.TCNT0] = tcnt);
  };

  const writeTcnt = (value) => {
    assertActive();
    updateCounter();
    tcnt = value & 0xff;
    cpu.data[R.TCNT0] = tcnt;
    // Preserve the prescaler phase. Upstream AVRTimer does not reset lastCycle
    // on TCNT writes; it only rechecks/reschedules the existing clock event.
    scheduleCurrentState();
    return true;
  };

  const writeTccr0a = (value) => {
    assertActive();
    const next = value & 0xff;
    const clockSelect = cpu.data[R.TCCR0B] & 0x07;
    // Arduino core configures Timer0 through multiple register writes. While
    // CS=0 the timer is stopped, so an unsupported WGM may exist transiently
    // without being executed by this model. Once the clock is active, every
    // mode change must remain inside the supported subset.
    if (clockSelect !== 0) {
      requireSupportedMode(next, cpu.data[R.TCCR0B]);
    }
    cpu.data[R.TCCR0A] = next;
    return true;
  };

  const writeTccr0b = (value) => {
    assertActive();
    const next = value & ~FOC_MASK & 0xff;
    const cs = next & 0x07;
    if (cs >= 6) {
      throw new RangeError("Timer0 external clock CS=6/7 chưa được hỗ trợ.");
    }
    // CS=0 is configuration-only and may hold an intermediate unsupported WGM.
    // Starting any internal clock makes that mode observable, so fail closed.
    if (cs !== 0) {
      requireSupportedMode(cpu.data[R.TCCR0A], next);
    }
    cpu.clearClockEvent(onClockEvent);
    cpu.data[R.TCCR0B] = next;
    pendingDivider = DIVIDERS[cs];
    dividerUpdatePending = true;
    // avr8js AVRTimer defers updateDivider through a clock event; addClockEvent
    // clamps zero-delay requests to one CPU cycle. Mirror that startup latency.
    cpu.addClockEvent(onClockEvent, 1);
    return true;
  };

  const writeTifr0 = (value) => {
    assertActive();
    if (value & B.TOV0) {
      cpu.clearInterruptByFlag(overflowInterrupt, B.TOV0);
    }
    return true;
  };

  const writeTimsk0 = (value) => {
    assertActive();
    cpu.updateInterruptEnable(overflowInterrupt, value & 0xff);
    // Returning undefined lets CPU.writeData store the complete register value.
  };

  cpu.readHooks[R.TCNT0] = readTcnt;
  cpu.writeHooks[R.TCNT0] = writeTcnt;
  cpu.writeHooks[R.TCCR0A] = writeTccr0a;
  cpu.writeHooks[R.TCCR0B] = writeTccr0b;
  cpu.writeHooks[R.TIFR0] = writeTifr0;
  cpu.writeHooks[R.TIMSK0] = writeTimsk0;
  scheduleNextTick();

  function snapshot() {
    assertActive();
    synchronizeRead();
    const wgm = wgmValue(cpu.data[R.TCCR0A], cpu.data[R.TCCR0B]);
    return Object.freeze({
      cpuCycles: cpu.cycles,
      cpuClockHz: AVR_TIMER0_CPU_HZ,
      wgm,
      mode: modeName(wgm),
      clockSelect: cpu.data[R.TCCR0B] & 0x07,
      divider,
      tcnt0: tcnt,
      tov0: Boolean(cpu.data[R.TIFR0] & B.TOV0),
      toie0: Boolean(cpu.data[R.TIMSK0] & B.TOIE0),
      tickMicroseconds: divider ? (divider / AVR_TIMER0_CPU_HZ) * 1_000_000 : null,
      overflowPeriodMicroseconds: divider
        ? (256 * divider * 1_000_000) / AVR_TIMER0_CPU_HZ
        : null,
    });
  }

  function reset() {
    assertActive();
    cpu.clearClockEvent(onClockEvent);
    cpu.clearInterrupt(overflowInterrupt, false);
    cpu.data[R.TCCR0A] = 0;
    cpu.data[R.TCCR0B] = 0;
    cpu.data[R.TCNT0] = 0;
    cpu.data[R.TIFR0] &= ~B.TOV0;
    cpu.data[R.TIMSK0] = 0;
    tcnt = 0;
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
    if (cpu.readHooks[R.TCNT0] === readTcnt) cpu.readHooks[R.TCNT0] = previousReadTcnt;
    for (const [address, previous] of previousWriteHooks) {
      const current = cpu.writeHooks[address];
      const owned =
        (address === R.TCNT0 && current === writeTcnt) ||
        (address === R.TCCR0A && current === writeTccr0a) ||
        (address === R.TCCR0B && current === writeTccr0b) ||
        (address === R.TIFR0 && current === writeTifr0) ||
        (address === R.TIMSK0 && current === writeTimsk0);
      if (owned) cpu.writeHooks[address] = previous;
    }
    disposed = true;
  }

  return Object.freeze({
    capabilities: AVR_TIMER0_CAPABILITIES,
    registers: AVR_TIMER0_REGISTERS,
    bits: AVR_TIMER0_BITS,
    overflowVector: OVERFLOW_VECTOR,
    snapshot,
    reset,
    dispose,
  });
}
