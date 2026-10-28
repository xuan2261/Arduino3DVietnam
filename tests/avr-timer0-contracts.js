import { CPU } from "../assets/vendor/avr/cpu.js";
import {
  AVR_TIMER0_BITS,
  AVR_TIMER0_CAPABILITIES,
  AVR_TIMER0_CPU_HZ,
  AVR_TIMER0_REGISTERS,
  createAvrTimer0,
} from "../src/avr-timer0.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `${message}: expected exception`);
  assert(pattern.test(String(thrown.message)), `${message}: ${thrown.message}`);
}

function cpuFixture() {
  return new CPU(new Uint16Array(0x4000), 2048);
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

export function runAvrTimer0Contracts() {
  const checks = [];
  const check = (name, fn) => {
    fn();
    checks.push(name);
  };
  const R = AVR_TIMER0_REGISTERS;
  const B = AVR_TIMER0_BITS;

  check("capability-boundary-and-16mhz-clock", () => {
    assert(AVR_TIMER0_CPU_HZ === 16_000_000, "Uno CPU clock metadata must be 16 MHz");
    assert(AVR_TIMER0_CAPABILITIES.counterBits === 8, "Timer0 must be 8-bit");
    assert(AVR_TIMER0_CAPABILITIES.normalMode, "normal mode missing");
    assert(AVR_TIMER0_CAPABILITIES.fastPwmFixedTopCounter, "Fast PWM fixed-top counter missing");
    for (const key of [
      "compareMatch",
      "outputComparePins",
      "pwmDutyOutput",
      "phaseCorrectPwm",
      "ctc",
      "externalClock",
      "millisParity",
      "microsParity",
      "delayParity",
    ]) {
      assert(AVR_TIMER0_CAPABILITIES[key] === false, `${key} must remain unsupported`);
    }
  });

  check("clock-stop-and-internal-prescalers", () => {
    const cases = [
      [1, 1],
      [2, 8],
      [3, 64],
      [4, 256],
      [5, 1024],
    ];
    for (const [cs, divider] of cases) {
      const cpu = cpuFixture();
      const timer = createAvrTimer0(cpu);
      advance(cpu, divider * 2);
      assert(cpu.readData(R.TCNT0) === 0, `CS=0 must stay stopped before CS=${cs}`);
      cpu.writeData(R.TCCR0B, cs);
      advance(cpu, 1); // avr8js defers updateDivider to the next CPU clock event
      advance(cpu, divider - 1);
      assert(cpu.readData(R.TCNT0) === 0, `CS=${cs} counted too early`);
      advance(cpu, 1);
      assert(cpu.readData(R.TCNT0) === 1, `CS=${cs} did not count at divider ${divider}`);
      advance(cpu, divider, false);
      assert(cpu.readData(R.TCNT0) === 2, `CS=${cs} must catch up across multi-cycle CPU delta`);
      timer.dispose();
    }
  });

  check("fast-pwm-fixed-top-counts-and-prescaler-phase-survives-tcnt-write", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer0(cpu);
    cpu.writeData(R.TCCR0A, 0x03); // WGM00|WGM01: Fast PWM, TOP=0xff
    cpu.writeData(R.TCCR0B, 0x03); // /64
    advance(cpu, 1); // latch deferred divider update
    advance(cpu, 32);
    cpu.writeData(R.TCNT0, 0x80);
    advance(cpu, 31);
    assert(cpu.readData(R.TCNT0) === 0x80, "TCNT write must not reset prescaler phase");
    advance(cpu, 1);
    assert(cpu.readData(R.TCNT0) === 0x81, "prescaler phase must complete at original /64 boundary");
    const snapshot = timer.snapshot();
    assert(snapshot.mode === "fast-pwm-fixed-top", "WGM3 mode label mismatch");
    assert(snapshot.tickMicroseconds === 4, "/64 at 16 MHz must tick every 4 us");
    assert(snapshot.overflowPeriodMicroseconds === 1024, "/64 overflow must be 1.024 ms");
  });

  check("overflow-flag-and-write-one-to-clear", () => {
    const cpu = cpuFixture();
    createAvrTimer0(cpu);
    cpu.writeData(R.TCNT0, 0xfe);
    cpu.writeData(R.TCCR0B, 0x01); // /1
    advance(cpu, 1); // latch deferred divider update
    advance(cpu, 1);
    assert(cpu.readData(R.TCNT0) === 0xff, "TCNT0 must reach 0xff before overflow");
    assert((cpu.data[R.TIFR0] & B.TOV0) === 0, "TOV0 must not set before wrap");
    advance(cpu, 1);
    assert(cpu.readData(R.TCNT0) === 0x00, "TCNT0 must wrap to zero");
    assert((cpu.data[R.TIFR0] & B.TOV0) !== 0, "TOV0 must set on wrap");
    cpu.writeData(R.TIFR0, B.TOV0);
    assert((cpu.data[R.TIFR0] & B.TOV0) === 0, "writing one to TOV0 must clear it");

    cpu.writeData(R.TCNT0, 0xfe);
    advance(cpu, 4, false);
    assert(cpu.readData(R.TCNT0) === 0x02, "multi-cycle catch-up must wrap past TOP to 0x02");
    assert((cpu.data[R.TIFR0] & B.TOV0) !== 0, "jumping past TOP must still set TOV0");
  });

  check("overflow-mask-queues-and-services-avr-interrupt", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer0(cpu);
    cpu.writeData(R.TIMSK0, B.TOIE0);
    cpu.writeData(R.TCNT0, 0xff);
    cpu.writeData(R.TCCR0B, 0x01);
    cpu.data[95] = 0x80; // SREG I bit
    advance(cpu, 1); // latch deferred divider update
    advance(cpu, 1);
    assert(cpu.pc === 0x20, "enabled Timer0 overflow must vector to 0x20");
    assert((cpu.data[R.TIFR0] & B.TOV0) === 0, "serviced non-constant interrupt clears TOV0");
    assert(cpu.interruptsEnabled === false, "interrupt entry must clear global I flag");
    assert(cpu.readData(R.TCNT0) === 0x02, "interrupt entry cycles must be reflected in Timer0 catch-up");
    timer.dispose();
  });

  check("enabling-mask-after-pending-overflow-and-clearing-before-service", () => {
    const cpu = cpuFixture();
    createAvrTimer0(cpu);
    cpu.writeData(R.TCNT0, 0xff);
    cpu.writeData(R.TCCR0B, 0x01);
    advance(cpu, 1); // latch deferred divider update
    advance(cpu, 1);
    assert((cpu.data[R.TIFR0] & B.TOV0) !== 0, "overflow flag fixture missing");
    cpu.writeData(R.TIMSK0, B.TOIE0);
    assert(cpu.nextInterrupt === 0x20, "enabling TOIE0 with TOV0 set must queue overflow vector");
    cpu.writeData(R.TIFR0, B.TOV0);
    assert(cpu.nextInterrupt === -1, "W1C TOV0 must unqueue pending overflow vector");
    cpu.data[95] = 0x80;
    advance(cpu, 1);
    assert(cpu.pc === 0, "W1C must unqueue pending overflow before global interrupts enable");
  });

  check("stopped-transient-wgm-can-resolve-before-internal-clock-start", () => {
    const cpu = cpuFixture();
    createAvrTimer0(cpu);
    cpu.writeData(R.TCCR0A, 0x02); // transient WGM2 while CS=0
    assert(cpu.data[R.TCCR0A] === 0x02, "stopped timer must preserve transient WGM2 config");
    cpu.writeData(R.TCCR0A, 0x03); // resolve to supported WGM3
    cpu.writeData(R.TCCR0B, 0x03); // start /64
    advance(cpu, 1); // latch divider
    advance(cpu, 64);
    assert(cpu.readData(R.TCNT0) === 1, "resolved WGM3 must run at /64 after transient WGM2");
  });

  check("unsupported-mode-cannot-transition-to-active-clock", () => {
    const cpu = cpuFixture();
    createAvrTimer0(cpu);
    cpu.writeData(R.TCCR0A, 0x02); // WGM2 is allowed only while stopped
    expectThrow(() => cpu.writeData(R.TCCR0B, 0x03), /WGM=2/, "stopped WGM2 starting /64");
    assert(cpu.data[R.TCCR0B] === 0, "rejected clock start must leave Timer0 stopped");
    assert(cpu.data[R.TCCR0A] === 0x02, "rejected clock start must preserve staged WGM bits");
  });

  check("running-timer-rejects-unsupported-wgm-and-external-clock", () => {
    const cpu = cpuFixture();
    createAvrTimer0(cpu);
    cpu.writeData(R.TCCR0A, 0x03); // WGM3
    cpu.writeData(R.TCCR0B, 0x03); // /64
    advance(cpu, 1);
    expectThrow(() => cpu.writeData(R.TCCR0A, 0x02), /WGM=2/, "running WGM3 to WGM2");
    assert(cpu.data[R.TCCR0A] === 0x03, "rejected running mode change must preserve WGM3");
    expectThrow(() => cpu.writeData(R.TCCR0B, 0x06), /external clock/, "external clock falling");
    expectThrow(() => cpu.writeData(R.TCCR0B, 0x07), /external clock/, "external clock rising");
    assert(cpu.data[R.TCCR0B] === 0x03, "rejected external clock must preserve running /64 config");
  });

  check("reset-dispose-and-double-attach-lifecycle", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer0(cpu);
    expectThrow(() => createAvrTimer0(cpu), /hooks/, "double attach");
    cpu.writeData(R.TIMSK0, B.TOIE0);
    cpu.writeData(R.TCNT0, 0xff);
    cpu.writeData(R.TCCR0B, 0x01);
    cpu.data[95] = 0; // keep queued interrupt from being serviced
    advance(cpu, 1); // latch deferred divider update
    advance(cpu, 1);
    const reset = timer.reset();
    assert(reset.tcnt0 === 0 && reset.divider === 0, "reset must zero counter and stop clock");
    assert(cpu.data[R.TCCR0A] === 0 && cpu.data[R.TCCR0B] === 0, "reset control registers");
    assert(cpu.data[R.TIMSK0] === 0 && (cpu.data[R.TIFR0] & B.TOV0) === 0, "reset interrupt state");
    advance(cpu, 100);
    assert(cpu.readData(R.TCNT0) === 0, "reset timer must remain stopped");
    timer.dispose();
    timer.dispose();
    assert(cpu.readHooks[R.TCNT0] == null, "dispose must restore TCNT0 read hook");
    assert(cpu.writeHooks[R.TCCR0B] == null, "dispose must restore control write hook");
    cpu.writeData(R.TCCR0B, 0x01);
    advance(cpu, 100);
    assert(cpu.data[R.TCNT0] === 0, "disposed timer must not count");
    expectThrow(() => timer.reset(), /dispose/, "reset after dispose");
  });

  return Object.freeze({
    passed: checks.length,
    checks: Object.freeze([...checks]),
  });
}
