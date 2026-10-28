import { CPU } from "../assets/vendor/avr/cpu.js";
import { avrInstruction } from "../assets/vendor/avr/instruction.js";
import {
  AVR_TIMER1_BITS,
  AVR_TIMER1_CAPABILITIES,
  AVR_TIMER1_CPU_HZ,
  AVR_TIMER1_REGISTERS,
  createAvrTimer1,
} from "../src/avr-timer1.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, label) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert(error, `${label}: expected exception`);
  assert(pattern.test(String(error.message)), `${label}: ${error.message}`);
}

function cpuFixture(program = new Uint16Array(0x4000)) {
  return new CPU(program, 2048);
}

function advance(cpu, cycles, tickEachCycle = true) {
  if (tickEachCycle) {
    for (let index = 0; index < cycles; index += 1) {
      cpu.cycles += 1;
      cpu.tick();
    }
  } else {
    cpu.cycles += cycles;
    cpu.tick();
  }
}

export function runAvrTimer1Contracts() {
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };
  const R = AVR_TIMER1_REGISTERS;
  const B = AVR_TIMER1_BITS;

  check("register-map-capability-boundary", () => {
    assert(AVR_TIMER1_CPU_HZ === 16_000_000, "Timer1 CPU clock metadata");
    assert(R.TIFR1 === 0x36 && R.TCNT1L === 0x84 && R.TCNT1H === 0x85, "Timer1 register map");
    assert(R.TCCR1A === 0x80 && R.TCCR1B === 0x81 && R.TIMSK1 === 0x6f, "Timer1 control map");
    assert(AVR_TIMER1_CAPABILITIES.counterBits === 16 && AVR_TIMER1_CAPABILITIES.normalMode, "Timer1 core boundary");
    for (const key of [
      "ctc", "pwm", "compareMatch", "outputComparePins", "inputCapture",
      "externalClock", "servoParity", "millisParity", "delayParity", "wallClock",
    ]) {
      assert(AVR_TIMER1_CAPABILITIES[key] === false, `${key} must remain unsupported`);
    }
  });

  check("normal-counter-internal-prescalers", () => {
    for (const [cs, divider] of [[1, 1], [2, 8], [3, 64], [4, 256], [5, 1024]]) {
      const cpu = cpuFixture();
      const timer = createAvrTimer1(cpu);
      cpu.writeData(R.TCCR1B, cs);
      advance(cpu, 1); // avr8js-style deferred divider activation
      advance(cpu, divider - 1);
      assert(timer.snapshot().tcnt1 === 0, `CS=${cs} counted before divider boundary`);
      advance(cpu, 1);
      assert(timer.snapshot().tcnt1 === 1, `CS=${cs} divider ${divider}`);
      advance(cpu, divider * 3, false);
      assert(timer.snapshot().tcnt1 === 4, `CS=${cs} multi-cycle catch-up`);
      timer.dispose();
    }
  });

  check("instruction-cycles-drive-counter", () => {
    const cpu = cpuFixture(new Uint16Array([0x0000, 0x0000, 0x0000, 0x0000]));
    const timer = createAvrTimer1(cpu);
    cpu.writeData(R.TCCR1B, 0x01); // /1, Normal
    avrInstruction(cpu); cpu.tick(); // cycle 1: latch divider
    assert(timer.snapshot().tcnt1 === 0, "divider startup must not count configuration cycle");
    avrInstruction(cpu); cpu.tick(); // cycle 2: one timer tick
    assert(timer.snapshot().tcnt1 === 1, "NOP CPU cycle must advance Timer1 at /1");
    timer.dispose();
  });

  check("sixteen-bit-write-high-then-low-and-low-first-semantics", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer1(cpu);
    cpu.writeData(R.TCNT1H, 0x22);
    cpu.writeData(R.TCNT1L, 0x33);
    assert(timer.snapshot().tcnt1 === 0x2233, "high then low must commit 0x2233");
    timer.reset();
    cpu.writeData(R.TCNT1L, 0x22); // TEMP reset is zero: commits 0x0022
    cpu.writeData(R.TCNT1H, 0x55); // changes TEMP only, not committed counter
    assert(timer.snapshot().tcnt1 === 0x0022, "high write after low must not alter committed TCNT1");
    const low = cpu.readData(R.TCNT1L); // latches committed high (0)
    const high = cpu.readData(R.TCNT1H);
    assert(((high << 8) | low) === 0x0022, "low read must latch current high byte");
  });

  check("low-read-latches-high-across-later-counter-change", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer1(cpu);
    cpu.writeData(R.TCNT1H, 0x12);
    cpu.writeData(R.TCNT1L, 0xff);
    cpu.writeData(R.TCCR1B, 0x01);
    advance(cpu, 1); // latch /1
    advance(cpu, 1); // 0x1300
    const low = cpu.readData(R.TCNT1L);
    assert(low === 0x00, "fixture must reach 0x1300");
    advance(cpu, 256); // internal counter is now 0x1400
    const latchedHigh = cpu.readData(R.TCNT1H);
    assert(latchedHigh === 0x13, "high read must return value latched by preceding low read");
    const freshLow = cpu.readData(R.TCNT1L);
    const freshHigh = cpu.readData(R.TCNT1H);
    assert(((freshHigh << 8) | freshLow) === 0x1400, "next low/high pair must refresh the high latch");
  });

  check("overflow-flag-and-write-one-to-clear", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer1(cpu);
    cpu.writeData(R.TCNT1H, 0xff);
    cpu.writeData(R.TCNT1L, 0xfe);
    cpu.writeData(R.TCCR1B, 0x01);
    advance(cpu, 1);
    advance(cpu, 1);
    assert(timer.snapshot().tcnt1 === 0xffff, "Timer1 must reach MAX before overflow");
    assert((cpu.data[R.TIFR1] & B.TOV1) === 0, "TOV1 must stay clear at MAX");
    advance(cpu, 1);
    assert(timer.snapshot().tcnt1 === 0, "Timer1 must wrap 0xffff→0");
    assert((cpu.data[R.TIFR1] & B.TOV1) !== 0, "TOV1 must set on wrap");
    cpu.writeData(R.TIFR1, B.TOV1);
    assert((cpu.data[R.TIFR1] & B.TOV1) === 0, "TOV1 write-one-to-clear");
  });

  check("overflow-mask-queues-and-services-vector", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer1(cpu);
    cpu.writeData(R.TIMSK1, B.TOIE1);
    cpu.writeData(R.TCNT1H, 0xff);
    cpu.writeData(R.TCNT1L, 0xff);
    cpu.writeData(R.TCCR1B, 0x01);
    cpu.data[95] = 0x80;
    advance(cpu, 1); // latch divider
    advance(cpu, 1); // overflow + interrupt entry
    assert(cpu.pc === 0x1a, "Timer1 overflow vector must be 0x1a");
    assert((cpu.data[R.TIFR1] & B.TOV1) === 0, "serviced overflow interrupt clears TOV1");
    assert(cpu.interruptsEnabled === false, "interrupt entry clears global I bit");
    timer.dispose();
  });

  check("stopped-unsupported-wgm-may-stage-but-cannot-start", () => {
    const cpu = cpuFixture();
    createAvrTimer1(cpu);
    cpu.writeData(R.TCCR1A, 0x01); // WGM1 staged while stopped
    assert(cpu.data[R.TCCR1A] === 0x01, "stopped WGM1 staging");
    expectThrow(() => cpu.writeData(R.TCCR1B, 0x03), /WGM=1/, "staged PWM then /64");
    assert((cpu.data[R.TCCR1B] & 0x07) === 0, "failed start must leave Timer1 stopped");
    cpu.writeData(R.TCCR1A, 0x00);
    cpu.writeData(R.TCCR1B, 0x03);
    advance(cpu, 1);
    assert(cpu.data[R.TCCR1B] === 0x03, "Normal mode may start /64 after staged mode is cleared");
  });

  check("running-normal-rejects-ctc-pwm-and-external-clock", () => {
    const cpu = cpuFixture();
    createAvrTimer1(cpu);
    cpu.writeData(R.TCCR1B, 0x03); // Normal /64
    advance(cpu, 1);
    expectThrow(() => cpu.writeData(R.TCCR1A, 0x01), /WGM=1/, "running PWM WGM1");
    expectThrow(() => cpu.writeData(R.TCCR1B, 0x0b), /WGM=4/, "running CTC WGM4");
    expectThrow(() => cpu.writeData(R.TCCR1B, 0x06), /external clock/, "external falling clock");
    expectThrow(() => cpu.writeData(R.TCCR1B, 0x07), /external clock/, "external rising clock");
    assert(cpu.data[R.TCCR1A] === 0 && cpu.data[R.TCCR1B] === 0x03,
      "rejected mode/clock writes must preserve running Normal /64");
  });

  check("unsupported-compare-capture-fails-closed", () => {
    const cpu = cpuFixture();
    createAvrTimer1(cpu);
    expectThrow(() => cpu.writeData(R.TCCR1A, 0x40), /COM1A/, "COM1A output compare");
    expectThrow(() => cpu.writeData(R.TCCR1B, 0x40), /input-capture/, "input capture edge control");
    expectThrow(() => cpu.writeData(R.TCCR1C, 0x80), /force-output-compare/, "FOC1A");
    expectThrow(() => cpu.writeData(R.OCR1AH, 0x12), /compare A/, "OCR1A write");
    expectThrow(() => cpu.writeData(R.ICR1L, 0x34), /input capture/, "ICR1 write");
    expectThrow(() => cpu.writeData(R.TIMSK1, 0x02), /compare\/input-capture interrupts/, "OCIE1A");
    expectThrow(() => cpu.writeData(R.TIFR1, 0x02), /compare\/input-capture flags/, "OCF1A W1C");
  });

  check("reset-dispose-scheduling-and-double-attach", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer1(cpu);
    expectThrow(() => createAvrTimer1(cpu), /hooks/, "double attach");
    cpu.writeData(R.TCNT1H, 0xab);
    cpu.writeData(R.TCNT1L, 0xcd);
    cpu.writeData(R.TCCR1B, 0x02); // /8
    advance(cpu, 1);
    advance(cpu, 4);
    cpu.writeData(R.TCCR1B, 0x03); // /64 restarts modeled prescaler phase
    advance(cpu, 1);
    advance(cpu, 63);
    assert(timer.snapshot().tcnt1 === 0xabcd, "divider change must restart modeled prescaler phase");
    advance(cpu, 1);
    assert(timer.snapshot().tcnt1 === 0xabce, "new /64 divider boundary");
    const reset = timer.reset();
    assert(reset.tcnt1 === 0 && reset.divider === 0 && reset.wgm === 0, "reset state");
    advance(cpu, 100);
    assert(timer.snapshot().tcnt1 === 0, "reset Timer1 remains stopped");
    timer.dispose();
    timer.dispose();
    assert(cpu.readHooks[R.TCNT1L] == null && cpu.writeHooks[R.TCCR1B] == null, "dispose restores hooks");
    cpu.writeData(R.TCCR1B, 0x01);
    advance(cpu, 100);
    assert(cpu.data[R.TCNT1L] === 0, "disposed Timer1 must not count");
    expectThrow(() => timer.reset(), /dispose/, "reset after dispose");
  });

  return Object.freeze({ passed: checks.length, checks: Object.freeze([...checks]) });
}
