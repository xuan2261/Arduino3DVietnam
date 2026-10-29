// Strict bounded ATmega328P Timer/Counter2 peripheral for the vendored avr8js CPU.
// Grounded in avr8js v0.21.1 timer2Config and ATmega328P register semantics.

export const AVR_TIMER2_CPU_HZ = 16_000_000;

export const AVR_TIMER2_REGISTERS = Object.freeze({
  TIFR2: 0x37,
  TIMSK2: 0x70,
  TCCR2A: 0xb0,
  TCCR2B: 0xb1,
  TCNT2: 0xb2,
  OCR2A: 0xb3,
  OCR2B: 0xb4,
  ASSR: 0xb6,
});

export const AVR_TIMER2_BITS = Object.freeze({
  TOV2: 0x01,
  TOIE2: 0x01,
  OCF2A: 0x02,
  OCF2B: 0x04,
  OCIE2A: 0x02,
  OCIE2B: 0x04,
  AS2: 0x20,
  EXCLK: 0x40,
});

export const AVR_TIMER2_CAPABILITIES = Object.freeze({
  mcu: "atmega328p",
  cpuClockHz: AVR_TIMER2_CPU_HZ,
  counterBits: 8,
  normalMode: true,
  overflowFlag: true,
  overflowInterrupt: true,
  internalPrescalers: Object.freeze([1, 8, 32, 64, 128, 256, 1024]),
  ctc: true,
  ctcOcr2aTop: true,
  ctcRunningTopUpdate: false,
  pwm: false,
  compareMatch: true,
  compareInterrupts: true,
  outputComparePins: false,
  asynchronousClock: false,
  externalClock: false,
  millisParity: false,
  delayParity: false,
  toneParity: false,
  wallClock: false,
});

const DIVIDERS = Object.freeze([0, 1, 8, 32, 64, 128, 256, 1024]);
const COMPARE_A_VECTOR = 0x0e;
const COMPARE_B_VECTOR = 0x10;
const OVERFLOW_VECTOR = 0x12;
const TCCR2A_WGM_MASK = 0x03;
const TCCR2B_WGM_MASK = 0x08;
const TCCR2A_ALLOWED_MASK = TCCR2A_WGM_MASK;
const TCCR2B_ALLOWED_MASK = TCCR2B_WGM_MASK | 0x07;

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
    cpu.data.length <= AVR_TIMER2_REGISTERS.ASSR ||
    methods.some(name => typeof cpu[name] !== "function")
  ) {
    throw new TypeError("createAvrTimer2 cần một avr8js CPU tương thích.");
  }
}

function wgmValue(tccr2a, tccr2b) {
  return ((tccr2b & TCCR2B_WGM_MASK) >> 1) | (tccr2a & TCCR2A_WGM_MASK);
}

function requireSupportedMode(tccr2a, tccr2b) {
  const wgm = wgmValue(tccr2a, tccr2b);
  if (wgm !== 0 && wgm !== 2) {
    throw new RangeError(`Timer2 WGM=${wgm} chưa được hỗ trợ; chỉ WGM=0 Normal và WGM=2 CTC OCR2A TOP.`);
  }
  return wgm;
}

function modeName(wgm) {
  if (wgm === 0) return "normal";
  if (wgm === 2) return "ctc-ocr2a-top";
  return "unsupported-stopped";
}

function assertCtcStart(top, counter, compareB) {
  if (top === 0) {
    throw new RangeError("Timer2 CTC OCR2A=0 chưa nằm trong subset đã kiểm chứng.");
  }
  if (counter > top) {
    throw new RangeError("Timer2 CTC yêu cầu TCNT2 <= OCR2A khi bắt đầu đếm.");
  }
  if (compareB > top) {
    throw new RangeError("Timer2 CTC subset yêu cầu OCR2B <= OCR2A TOP.");
  }
}

function assertSupportedControlBits(tccr2a, tccr2b) {
  if (tccr2a & ~TCCR2A_ALLOWED_MASK) {
    throw new RangeError("Timer2 COM2A/COM2B/reserved bits chưa được hỗ trợ.");
  }
  if (tccr2b & ~TCCR2B_ALLOWED_MASK) {
    throw new RangeError("Timer2 force-output-compare/reserved bits chưa được hỗ trợ.");
  }
}

export function createAvrTimer2(cpu) {
  requireCpu(cpu);
  const R = AVR_TIMER2_REGISTERS;
  const B = AVR_TIMER2_BITS;

  const readAddresses = [R.TCNT2];
  const writeAddresses = [
    R.TCNT2,
    R.TCCR2A,
    R.TCCR2B,
    R.TIFR2,
    R.TIMSK2,
    R.OCR2A,
    R.OCR2B,
    R.ASSR,
  ];
  const previousReadHooks = new Map(readAddresses.map(address => [address, cpu.readHooks[address]]));
  const previousWriteHooks = new Map(writeAddresses.map(address => [address, cpu.writeHooks[address]]));
  if ([...previousReadHooks.values(), ...previousWriteHooks.values()].some(hook => hook != null)) {
    throw new Error("Timer2 register hooks đã được peripheral khác chiếm dụng.");
  }

  assertSupportedControlBits(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
  if (cpu.data[R.ASSR] !== 0) {
    throw new RangeError("Timer2 ASSR asynchronous/external clock chưa được hỗ trợ.");
  }
  const initialCs = cpu.data[R.TCCR2B] & 0x07;
  if (initialCs !== 0) {
    const initialWgm = requireSupportedMode(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
    if (initialWgm === 2) assertCtcStart(cpu.data[R.OCR2A], cpu.data[R.TCNT2], cpu.data[R.OCR2B]);
  }

  const overflowInterrupt = Object.freeze({
    address: OVERFLOW_VECTOR,
    flagRegister: R.TIFR2,
    flagMask: B.TOV2,
    enableRegister: R.TIMSK2,
    enableMask: B.TOIE2,
  });
  const compareAInterrupt = Object.freeze({
    address: COMPARE_A_VECTOR,
    flagRegister: R.TIFR2,
    flagMask: B.OCF2A,
    enableRegister: R.TIMSK2,
    enableMask: B.OCIE2A,
  });
  const compareBInterrupt = Object.freeze({
    address: COMPARE_B_VECTOR,
    flagRegister: R.TIFR2,
    flagMask: B.OCF2B,
    enableRegister: R.TIMSK2,
    enableMask: B.OCIE2B,
  });

  let disposed = false;
  let counter = cpu.data[R.TCNT2] & 0xff;
  let divider = DIVIDERS[initialCs];
  let pendingDivider = divider;
  let dividerUpdatePending = false;
  let lastCycle = cpu.cycles;

  function compareReached(previous, ticks, compareValue, period) {
    if (ticks <= 0 || compareValue >= period) return false;
    if (ticks >= period) return true;
    const wrappedDistance = (compareValue - previous + period) % period;
    const nextDistance = wrappedDistance === 0 ? period : wrappedDistance;
    return nextDistance <= ticks;
  }

  function ensureActive() {
    if (disposed) throw new Error("Timer2 đã dispose.");
  }

  function updateCounter() {
    if (!divider) return;
    const delta = cpu.cycles - lastCycle;
    if (delta < divider) return;
    const ticks = Math.floor(delta / divider);
    lastCycle += ticks * divider;
    const previous = counter;
    const wgm = wgmValue(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
    const top = wgm === 2 ? cpu.data[R.OCR2A] : 0xff;
    const period = top + 1;
    counter = (counter + ticks) % period;
    cpu.data[R.TCNT2] = counter;
    if (compareReached(previous, ticks, cpu.data[R.OCR2A], period)) cpu.setInterruptFlag(compareAInterrupt);
    if (compareReached(previous, ticks, cpu.data[R.OCR2B], period)) cpu.setInterruptFlag(compareBInterrupt);
    if (previous + ticks > top && (wgm === 0 || top === 0xff)) cpu.setInterruptFlag(overflowInterrupt);
  }

  function cyclesUntilNextTick() {
    if (!divider) return 0;
    const elapsed = Math.max(0, cpu.cycles - lastCycle);
    return Math.max(1, divider - (elapsed % divider));
  }

  function scheduleNextTick() {
    if (!disposed && divider) cpu.addClockEvent(onClockEvent, cyclesUntilNextTick());
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

  const readTcnt2 = () => {
    ensureActive();
    synchronizeCounter();
    return (cpu.data[R.TCNT2] = counter);
  };

  const writeTcnt2 = value => {
    ensureActive();
    const next = value & 0xff;
    const wgm = wgmValue(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
    const cs = cpu.data[R.TCCR2B] & 0x07;
    if (cs !== 0 && wgm === 2 && next > cpu.data[R.OCR2A]) {
      throw new RangeError("Timer2 CTC đang chạy yêu cầu TCNT2 <= OCR2A.");
    }
    updateCounter();
    counter = next;
    cpu.data[R.TCNT2] = counter;
    // Match avr8js AVRTimer: TCNT write does not reset the prescaler phase.
    scheduleCurrentState();
    return true;
  };

  const writeTccr2a = value => {
    ensureActive();
    const next = value & 0xff;
    assertSupportedControlBits(next, cpu.data[R.TCCR2B]);
    const cs = cpu.data[R.TCCR2B] & 0x07;
    if (cs !== 0) {
      const currentWgm = wgmValue(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
      const nextWgm = requireSupportedMode(next, cpu.data[R.TCCR2B]);
      if (nextWgm !== currentWgm) {
        throw new RangeError(`Timer2 đang chạy không hỗ trợ chuyển mode WGM=${currentWgm}->WGM=${nextWgm}; hãy dừng clock trước.`);
      }
    }
    cpu.data[R.TCCR2A] = next;
    return true;
  };

  const writeTccr2b = value => {
    ensureActive();
    const next = value & 0xff;
    assertSupportedControlBits(cpu.data[R.TCCR2A], next);
    const cs = next & 0x07;
    // All CS=1..7 values are internal prescalers for Timer2. Async/external
    // clock selection is controlled by ASSR and is rejected separately.
    if (cs !== 0) {
      const wgm = requireSupportedMode(cpu.data[R.TCCR2A], next);
      if (wgm === 2) assertCtcStart(cpu.data[R.OCR2A], counter, cpu.data[R.OCR2B]);
    }
    cpu.clearClockEvent(onClockEvent);
    cpu.data[R.TCCR2B] = next;
    pendingDivider = DIVIDERS[cs];
    dividerUpdatePending = true;
    cpu.addClockEvent(onClockEvent, 1);
    return true;
  };

  const writeTifr2 = value => {
    ensureActive();
    const next = value & 0xff;
    const supportedMask = B.TOV2 | B.OCF2A | B.OCF2B;
    if (next & ~supportedMask) {
      throw new RangeError("Timer2 TIFR2 reserved/unsupported bits chưa được hỗ trợ.");
    }
    if (next & B.TOV2) cpu.clearInterruptByFlag(overflowInterrupt, B.TOV2);
    if (next & B.OCF2A) cpu.clearInterruptByFlag(compareAInterrupt, B.OCF2A);
    if (next & B.OCF2B) cpu.clearInterruptByFlag(compareBInterrupt, B.OCF2B);
    return true;
  };

  const writeTimsk2 = value => {
    ensureActive();
    const next = value & 0xff;
    const supportedMask = B.TOIE2 | B.OCIE2A | B.OCIE2B;
    if (next & ~supportedMask) {
      throw new RangeError("Timer2 TIMSK2 reserved/unsupported bits chưa được hỗ trợ.");
    }
    cpu.updateInterruptEnable(overflowInterrupt, next);
    cpu.updateInterruptEnable(compareAInterrupt, next);
    cpu.updateInterruptEnable(compareBInterrupt, next);
    // Return undefined so CPU.writeData commits TIMSK2.
  };

  const writeOcr2a = value => {
    ensureActive();
    const wgm = wgmValue(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
    const cs = cpu.data[R.TCCR2B] & 0x07;
    if (wgm === 2 && cs !== 0 && (value & 0xff) !== cpu.data[R.OCR2A]) {
      throw new RangeError("Timer2 CTC chưa hỗ trợ đổi OCR2A TOP khi đang chạy; hãy dừng clock trước.");
    }
    // Immediate register update in Normal/CTC. CPU.writeData commits after this hook.
  };
  const writeOcr2b = value => {
    ensureActive();
    const wgm = wgmValue(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
    const cs = cpu.data[R.TCCR2B] & 0x07;
    if (wgm === 2 && cs !== 0 && (value & 0xff) > cpu.data[R.OCR2A]) {
      throw new RangeError("Timer2 CTC subset yêu cầu OCR2B <= OCR2A TOP.");
    }
    // Immediate register update in Normal/CTC. CPU.writeData commits after this hook.
  };
  const writeAssr = value => {
    ensureActive();
    if ((value & 0xff) !== 0) {
      throw new RangeError("Timer2 ASSR asynchronous/external clock chưa được hỗ trợ.");
    }
    cpu.data[R.ASSR] = 0;
    return true;
  };

  cpu.readHooks[R.TCNT2] = readTcnt2;
  cpu.writeHooks[R.TCNT2] = writeTcnt2;
  cpu.writeHooks[R.TCCR2A] = writeTccr2a;
  cpu.writeHooks[R.TCCR2B] = writeTccr2b;
  cpu.writeHooks[R.TIFR2] = writeTifr2;
  cpu.writeHooks[R.TIMSK2] = writeTimsk2;
  cpu.writeHooks[R.OCR2A] = writeOcr2a;
  cpu.writeHooks[R.OCR2B] = writeOcr2b;
  cpu.writeHooks[R.ASSR] = writeAssr;
  scheduleNextTick();

  function snapshot() {
    ensureActive();
    synchronizeCounter();
    const wgm = wgmValue(cpu.data[R.TCCR2A], cpu.data[R.TCCR2B]);
    const top = wgm === 2 ? cpu.data[R.OCR2A] : wgm === 0 ? 0xff : null;
    return Object.freeze({
      cpuCycles: cpu.cycles,
      cpuClockHz: AVR_TIMER2_CPU_HZ,
      wgm,
      mode: modeName(wgm),
      top,
      clockSelect: cpu.data[R.TCCR2B] & 0x07,
      divider,
      tcnt2: counter,
      ocr2a: cpu.data[R.OCR2A],
      ocr2b: cpu.data[R.OCR2B],
      tov2: Boolean(cpu.data[R.TIFR2] & B.TOV2),
      toie2: Boolean(cpu.data[R.TIMSK2] & B.TOIE2),
      ocf2a: Boolean(cpu.data[R.TIFR2] & B.OCF2A),
      ocf2b: Boolean(cpu.data[R.TIFR2] & B.OCF2B),
      ocie2a: Boolean(cpu.data[R.TIMSK2] & B.OCIE2A),
      ocie2b: Boolean(cpu.data[R.TIMSK2] & B.OCIE2B),
      assr: cpu.data[R.ASSR],
      tickMicroseconds: divider ? (divider / AVR_TIMER2_CPU_HZ) * 1_000_000 : null,
      counterPeriodMicroseconds: divider && top != null
        ? ((top + 1) * divider * 1_000_000) / AVR_TIMER2_CPU_HZ
        : null,
      overflowPeriodMicroseconds: divider && (wgm === 0 || (wgm === 2 && top === 0xff))
        ? (256 * divider * 1_000_000) / AVR_TIMER2_CPU_HZ
        : null,
    });
  }

  function reset() {
    ensureActive();
    cpu.clearClockEvent(onClockEvent);
    cpu.clearInterrupt(overflowInterrupt, false);
    cpu.clearInterrupt(compareAInterrupt, false);
    cpu.clearInterrupt(compareBInterrupt, false);
    cpu.data[R.TCCR2A] = 0;
    cpu.data[R.TCCR2B] = 0;
    cpu.data[R.TCNT2] = 0;
    cpu.data[R.OCR2A] = 0;
    cpu.data[R.OCR2B] = 0;
    cpu.data[R.ASSR] = 0;
    cpu.data[R.TIMSK2] = 0;
    cpu.data[R.TIFR2] = 0;
    counter = 0;
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
    cpu.clearInterrupt(compareAInterrupt, false);
    cpu.clearInterrupt(compareBInterrupt, false);
    if (cpu.readHooks[R.TCNT2] === readTcnt2) cpu.readHooks[R.TCNT2] = previousReadHooks.get(R.TCNT2);
    for (const [address, previous] of previousWriteHooks) {
      const current = cpu.writeHooks[address];
      const owned =
        (address === R.TCNT2 && current === writeTcnt2) ||
        (address === R.TCCR2A && current === writeTccr2a) ||
        (address === R.TCCR2B && current === writeTccr2b) ||
        (address === R.TIFR2 && current === writeTifr2) ||
        (address === R.TIMSK2 && current === writeTimsk2) ||
        (address === R.OCR2A && current === writeOcr2a) ||
        (address === R.OCR2B && current === writeOcr2b) ||
        (address === R.ASSR && current === writeAssr);
      if (owned) cpu.writeHooks[address] = previous;
    }
    disposed = true;
  }

  return Object.freeze({
    capabilities: AVR_TIMER2_CAPABILITIES,
    registers: AVR_TIMER2_REGISTERS,
    bits: AVR_TIMER2_BITS,
    overflowVector: OVERFLOW_VECTOR,
    snapshot,
    reset,
    dispose,
  });
}
