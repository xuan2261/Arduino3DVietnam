import { CPU } from "../assets/vendor/avr/cpu.js";
import { avrInstruction } from "../assets/vendor/avr/instruction.js";
import {
  AVR_TIMER2_BITS,
  AVR_TIMER2_CAPABILITIES,
  AVR_TIMER2_CPU_HZ,
  AVR_TIMER2_REGISTERS,
  createAvrTimer2,
} from "../src/avr-timer2.js";

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

export function runAvrTimer2Contracts() {
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };
  const R = AVR_TIMER2_REGISTERS;
  const B = AVR_TIMER2_BITS;

  check("register-map-and-capability-boundary", () => {
    assert(AVR_TIMER2_CPU_HZ === 16_000_000, "Timer2 CPU clock metadata");
    assert(R.TIFR2 === 0x37 && R.TIMSK2 === 0x70, "Timer2 flag/mask registers");
    assert(R.TCCR2A === 0xb0 && R.TCCR2B === 0xb1 && R.TCNT2 === 0xb2, "Timer2 core register map");
    assert(R.OCR2A === 0xb3 && R.OCR2B === 0xb4 && R.ASSR === 0xb6, "Timer2 compare/ASSR map");
    assert(AVR_TIMER2_CAPABILITIES.counterBits === 8 && AVR_TIMER2_CAPABILITIES.normalMode, "Normal-only boundary");
    for (const key of [
      "ctc", "pwm", "compareMatch", "outputComparePins", "asynchronousClock",
      "externalClock", "millisParity", "delayParity", "toneParity", "wallClock",
    ]) {
      assert(AVR_TIMER2_CAPABILITIES[key] === false, `${key} must stay unsupported`);
    }
  });

  check("all-timer2-internal-prescalers", () => {
    for (const [cs, divider] of [[1,1],[2,8],[3,32],[4,64],[5,128],[6,256],[7,1024]]) {
      const cpu = cpuFixture();
      const timer = createAvrTimer2(cpu);
      cpu.writeData(R.TCCR2B, cs);
      advance(cpu, 1); // deferred divider activation
      advance(cpu, divider - 1);
      assert(timer.snapshot().tcnt2 === 0, `CS=${cs} counted too early`);
      advance(cpu, 1);
      assert(timer.snapshot().tcnt2 === 1, `CS=${cs} divider ${divider}`);
      advance(cpu, divider * 2, false);
      assert(timer.snapshot().tcnt2 === 3, `CS=${cs} multi-cycle catch-up`);
      timer.dispose();
    }
  });

  check("real-instruction-cycles-drive-timer2", () => {
    const cpu = cpuFixture(new Uint16Array([0x0000, 0x0000, 0x0000]));
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.TCCR2B, 0x01); // /1
    avrInstruction(cpu); cpu.tick();
    assert(timer.snapshot().tcnt2 === 0, "first CPU cycle latches divider");
    avrInstruction(cpu); cpu.tick();
    assert(timer.snapshot().tcnt2 === 1, "NOP cycle advances Timer2 at /1");
  });

  check("tcnt2-write-preserves-prescaler-phase", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.TCCR2B, 0x04); // /64
    advance(cpu, 1);
    advance(cpu, 32);
    cpu.writeData(R.TCNT2, 0x80);
    advance(cpu, 31);
    assert(cpu.readData(R.TCNT2) === 0x80, "TCNT2 write must not reset prescaler phase");
    advance(cpu, 1);
    assert(cpu.readData(R.TCNT2) === 0x81, "original /64 boundary must be preserved");
    assert(timer.snapshot().tickMicroseconds === 4, "/64 tick at 16MHz is 4us");
  });

  check("overflow-tov2-w1c-and-multi-cycle-wrap", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.TCNT2, 0xfe);
    cpu.writeData(R.TCCR2B, 0x01);
    advance(cpu, 1);
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0xff, "Timer2 reaches MAX before overflow");
    assert((cpu.data[R.TIFR2] & B.TOV2) === 0, "TOV2 clear at MAX");
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0, "Timer2 wraps 0xff→0");
    assert((cpu.data[R.TIFR2] & B.TOV2) !== 0, "TOV2 set on wrap");
    cpu.writeData(R.TIFR2, B.TOV2);
    assert((cpu.data[R.TIFR2] & B.TOV2) === 0, "TOV2 write-one-to-clear");
    cpu.writeData(R.TCNT2, 0xfe);
    advance(cpu, 4, false);
    assert(timer.snapshot().tcnt2 === 0x02 && (cpu.data[R.TIFR2] & B.TOV2), "jump past TOP must still set TOV2");
  });

  check("toie2-overflow-interrupt-vector", () => {
    const cpu = cpuFixture();
    createAvrTimer2(cpu);
    cpu.writeData(R.TIMSK2, B.TOIE2);
    cpu.writeData(R.TCNT2, 0xff);
    cpu.writeData(R.TCCR2B, 0x01);
    cpu.data[95] = 0x80;
    advance(cpu, 1);
    advance(cpu, 1);
    assert(cpu.pc === 0x12, "Timer2 overflow vector must be 0x12");
    assert((cpu.data[R.TIFR2] & B.TOV2) === 0, "serviced Timer2 overflow clears TOV2");
    assert(cpu.interruptsEnabled === false, "interrupt entry clears global I bit");
  });

  check("stopped-unsupported-wgm-can-stage-but-not-run", () => {
    const cpu = cpuFixture();
    createAvrTimer2(cpu);
    cpu.writeData(R.TCCR2A, 0x01); // WGM1 staged while stopped
    assert(cpu.data[R.TCCR2A] === 0x01, "stopped WGM1 staging");
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x04), /WGM=1/, "staged WGM1 then /64");
    assert((cpu.data[R.TCCR2B] & 0x07) === 0, "failed start leaves Timer2 stopped");
    cpu.writeData(R.TCCR2A, 0);
    cpu.writeData(R.TCCR2B, 0x04);
    advance(cpu, 1);
    assert(cpu.data[R.TCCR2B] === 0x04, "Normal mode may start /64");
  });

  check("running-normal-rejects-pwm-ctc-compare-and-assr", () => {
    const cpu = cpuFixture();
    createAvrTimer2(cpu);
    cpu.writeData(R.TCCR2B, 0x04); // Normal /64
    advance(cpu, 1);
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x01), /WGM=1/, "phase-correct PWM WGM1");
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x02), /WGM=2/, "CTC WGM2");
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x40), /COM2A/, "COM2A compare output");
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x44), /force-output-compare/, "FOC2B");
    expectThrow(() => cpu.writeData(R.OCR2A, 0x22), /OCR2A/, "OCR2A compare write");
    expectThrow(() => cpu.writeData(R.OCR2B, 0x33), /OCR2B/, "OCR2B compare write");
    expectThrow(() => cpu.writeData(R.ASSR, B.AS2), /ASSR/, "asynchronous clock AS2");
    expectThrow(() => cpu.writeData(R.ASSR, B.EXCLK), /ASSR/, "external oscillator EXCLK");
    assert(cpu.data[R.TCCR2A] === 0 && cpu.data[R.TCCR2B] === 0x04 && cpu.data[R.ASSR] === 0,
      "rejected writes preserve running Normal /64 synchronous state");
  });

  check("unsupported-mask-and-flag-bits-fail-closed", () => {
    const cpu = cpuFixture();
    createAvrTimer2(cpu);
    expectThrow(() => cpu.writeData(R.TIMSK2, 0x02), /compare interrupts/, "OCIE2A mask");
    expectThrow(() => cpu.writeData(R.TIMSK2, 0x04), /compare interrupts/, "OCIE2B mask");
    expectThrow(() => cpu.writeData(R.TIFR2, 0x02), /compare flags/, "OCF2A W1C");
    expectThrow(() => cpu.writeData(R.TIFR2, 0x04), /compare flags/, "OCF2B W1C");
    assert(cpu.data[R.TIMSK2] === 0 && cpu.data[R.TIFR2] === 0, "unsupported mask/flag writes must not mutate state");
  });

  check("divider-reschedule-reset-dispose-reinitialize", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    expectThrow(() => createAvrTimer2(cpu), /hooks/, "double attach");
    cpu.writeData(R.TCNT2, 0x40);
    cpu.writeData(R.TCCR2B, 0x02); // /8
    advance(cpu, 1);
    advance(cpu, 4);
    cpu.writeData(R.TCCR2B, 0x04); // /64 restarts modeled prescaler phase
    advance(cpu, 1);
    advance(cpu, 63);
    assert(timer.snapshot().tcnt2 === 0x40, "divider transition restarts phase");
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0x41, "new /64 boundary");
    const reset = timer.reset();
    assert(reset.tcnt2 === 0 && reset.divider === 0 && reset.wgm === 0 && reset.assr === 0, "reset state");
    advance(cpu, 100);
    assert(timer.snapshot().tcnt2 === 0, "reset timer remains stopped");
    timer.dispose();
    timer.dispose();
    assert(cpu.readHooks[R.TCNT2] == null && cpu.writeHooks[R.TCCR2B] == null, "dispose restores hooks");
    const reattached = createAvrTimer2(cpu);
    assert(reattached.snapshot().tcnt2 === 0, "dispose allows clean reinitialization on same CPU");
    reattached.dispose();
  });

  return Object.freeze({ passed: checks.length, checks: Object.freeze([...checks]) });
}
