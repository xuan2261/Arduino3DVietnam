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
    assert(AVR_TIMER2_CAPABILITIES.counterBits === 8 && AVR_TIMER2_CAPABILITIES.normalMode, "Normal-mode boundary");
    assert(AVR_TIMER2_CAPABILITIES.ctc === true && AVR_TIMER2_CAPABILITIES.ctcOcr2aTop === true, "bounded CTC OCR2A TOP capability");
    assert(AVR_TIMER2_CAPABILITIES.ctcRunningTopUpdate === false, "running CTC TOP updates must stay unsupported");
    assert(AVR_TIMER2_CAPABILITIES.compareMatch === true, "Normal-mode compare match must be supported");
    assert(AVR_TIMER2_CAPABILITIES.compareInterrupts === true, "Normal-mode compare interrupts must be supported");
    for (const key of [
      "pwm", "outputComparePins", "asynchronousClock",
      "externalClock", "millisParity", "delayParity", "toneParity", "wallClock",
    ]) {
      assert(AVR_TIMER2_CAPABILITIES[key] === false, `${key} must stay unsupported`);
    }
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    for (const method of ["compile", "loadHex", "runCycles", "runSketch", "executeSketch"]) {
      assert(!(method in timer), `Timer2 must not expose fake Sketch execution API: ${method}`);
    }
    timer.dispose();
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

  check("normal-compare-flags-w1c-and-multi-cycle-crossing", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.OCR2A, 0x11);
    cpu.writeData(R.OCR2B, 0x13);
    cpu.writeData(R.TCNT2, 0x10);
    cpu.writeData(R.TCCR2B, 0x01); // /1, Normal
    advance(cpu, 1); // latch divider
    advance(cpu, 3, false); // cross 0x11 and 0x13 in one catch-up
    let state = timer.snapshot();
    assert(state.tcnt2 === 0x13, "multi-cycle catch-up must land on 0x13");
    assert(state.ocf2a && state.ocf2b, "multi-cycle catch-up must set both compare flags");
    cpu.writeData(R.TIFR2, B.OCF2A);
    assert(!(cpu.data[R.TIFR2] & B.OCF2A) && (cpu.data[R.TIFR2] & B.OCF2B), "OCF2A W1C must preserve OCF2B");
    cpu.writeData(R.TIFR2, B.OCF2B);
    assert((cpu.data[R.TIFR2] & (B.OCF2A | B.OCF2B)) === 0, "OCF2B W1C must clear remaining compare flag");

    cpu.writeData(R.OCR2A, 0x00);
    cpu.writeData(R.OCR2B, 0x7f);
    cpu.writeData(R.TCNT2, 0xfe);
    advance(cpu, 2, false);
    state = timer.snapshot();
    assert(state.tcnt2 === 0x00 && state.ocf2a, "wrapped catch-up must detect OCR2A=0 compare");
    assert(state.tov2, "wrapped catch-up must still set overflow flag");
  });

  check("ocie2a-ocie2b-compare-interrupt-vectors", () => {
    for (const [mask, ocrRegister, flagMask, vector] of [
      [B.OCIE2A, R.OCR2A, B.OCF2A, 0x0e],
      [B.OCIE2B, R.OCR2B, B.OCF2B, 0x10],
    ]) {
      const cpu = cpuFixture();
      createAvrTimer2(cpu);
      cpu.writeData(R.OCR2A, 0x80);
      cpu.writeData(R.OCR2B, 0x80);
      cpu.writeData(ocrRegister, 0x21);
      cpu.writeData(R.TCNT2, 0x20);
      cpu.writeData(R.TIMSK2, mask);
      cpu.writeData(R.TCCR2B, 0x01);
      cpu.data[95] = 0x80;
      advance(cpu, 1); // latch divider
      advance(cpu, 1); // compare + interrupt entry
      assert(cpu.pc === vector, `Timer2 compare vector must be 0x${vector.toString(16)}`);
      assert((cpu.data[R.TIFR2] & flagMask) === 0, "serviced compare interrupt clears its flag");
      assert(cpu.interruptsEnabled === false, "compare interrupt entry clears global I bit");
    }

    const lateCpu = cpuFixture();
    createAvrTimer2(lateCpu);
    lateCpu.writeData(R.OCR2A, 0x21);
    lateCpu.writeData(R.OCR2B, 0x80);
    lateCpu.writeData(R.TCNT2, 0x20);
    lateCpu.writeData(R.TCCR2B, 0x01);
    advance(lateCpu, 1);
    advance(lateCpu, 1);
    assert((lateCpu.data[R.TIFR2] & B.OCF2A) !== 0 && lateCpu.pc === 0, "disabled compare interrupt must leave OCF2A pending");
    lateCpu.data[95] = 0x80;
    lateCpu.writeData(R.TIMSK2, B.OCIE2A);
    lateCpu.tick();
    assert(lateCpu.pc === 0x0e, "enabling OCIE2A with OCF2A already set must queue compare A");
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

  check("ctc-ocr2a-top-count-and-compare-flags", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.OCR2A, 0x11);
    cpu.writeData(R.OCR2B, 0x0f);
    cpu.writeData(R.TCNT2, 0x0e);
    cpu.writeData(R.TCCR2A, 0x02); // WGM2 CTC while stopped
    cpu.writeData(R.TCCR2B, 0x01); // /1
    advance(cpu, 1); // latch divider
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0x0f && (cpu.data[R.TIFR2] & B.OCF2B), "CTC must set OCF2B before TOP");
    cpu.writeData(R.TIFR2, B.OCF2B);
    advance(cpu, 2, false);
    let state = timer.snapshot();
    assert(state.tcnt2 === 0x11 && state.ocf2a, "CTC must reach OCR2A TOP and set OCF2A");
    assert(!state.tov2, "CTC TOP below 0xff must not set TOV2 at TOP");
    assert(state.mode === "ctc-ocr2a-top" && state.top === 0x11, "CTC snapshot mode/TOP metadata");
    assert(state.counterPeriodMicroseconds === 1.125 && state.overflowPeriodMicroseconds === null,
      "CTC TOP=0x11 at /1 must report 1.125us counter period and no TOV2 period");
    cpu.writeData(R.TIFR2, B.OCF2A);
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0x00, "CTC tick after OCR2A TOP must clear counter to zero");

    cpu.writeData(R.TCCR2B, 0);
    advance(cpu, 1); // apply stop before changing TOP
    cpu.writeData(R.OCR2A, 0x03);
    cpu.writeData(R.OCR2B, 0x01);
    cpu.writeData(R.TCNT2, 0x00);
    cpu.writeData(R.TCCR2B, 0x01);
    advance(cpu, 1);
    advance(cpu, 10, false); // more than two complete 4-tick CTC periods
    state = timer.snapshot();
    assert(state.tcnt2 === 0x02, "CTC multi-period catch-up must use OCR2A+1 period");
    assert(state.ocf2a && state.ocf2b, "CTC multi-period catch-up must retain compare A/B flags");
    assert(!state.tov2, "CTC multi-period catch-up below MAX must keep TOV2 clear");

    for (const [cs, divider] of [[1,1],[2,8],[3,32],[4,64],[5,128],[6,256],[7,1024]]) {
      const prescaledCpu = cpuFixture();
      const prescaledTimer = createAvrTimer2(prescaledCpu);
      prescaledCpu.writeData(R.OCR2A, 0x03);
      prescaledCpu.writeData(R.OCR2B, 0x01);
      prescaledCpu.writeData(R.TCCR2A, 0x02);
      prescaledCpu.writeData(R.TCCR2B, cs);
      advance(prescaledCpu, 1);
      advance(prescaledCpu, divider - 1);
      assert(prescaledTimer.snapshot().tcnt2 === 0, `CTC CS=${cs} counted before /${divider} boundary`);
      advance(prescaledCpu, 1);
      assert(prescaledTimer.snapshot().tcnt2 === 1, `CTC CS=${cs} must count at /${divider}`);
      prescaledTimer.dispose();
    }
  });

  check("ctc-compare-a-b-interrupt-vectors", () => {
    for (const [mask, top, compareB, start, vector, flagMask] of [
      [B.OCIE2A, 0x21, 0x10, 0x20, 0x0e, B.OCF2A],
      [B.OCIE2B, 0x30, 0x21, 0x20, 0x10, B.OCF2B],
    ]) {
      const cpu = cpuFixture();
      createAvrTimer2(cpu);
      cpu.writeData(R.OCR2A, top);
      cpu.writeData(R.OCR2B, compareB);
      cpu.writeData(R.TCNT2, start);
      cpu.writeData(R.TCCR2A, 0x02);
      cpu.writeData(R.TIMSK2, mask);
      cpu.writeData(R.TCCR2B, 0x01);
      cpu.data[95] = 0x80;
      advance(cpu, 1);
      advance(cpu, 1);
      assert(cpu.pc === vector, `CTC compare interrupt must vector to 0x${vector.toString(16)}`);
      assert((cpu.data[R.TIFR2] & flagMask) === 0, "serviced CTC compare interrupt must clear its flag");
      assert(cpu.interruptsEnabled === false, "CTC compare interrupt entry clears global I bit");
    }
  });

  check("ctc-tov2-only-when-ocr2a-top-is-max", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.OCR2A, 0x1f);
    cpu.writeData(R.TCNT2, 0x1e);
    cpu.writeData(R.TCCR2A, 0x02);
    cpu.writeData(R.TCCR2B, 0x01);
    advance(cpu, 1);
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0x1f && !(cpu.data[R.TIFR2] & B.TOV2), "CTC reaches TOP below MAX without TOV2");
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0x00 && !(cpu.data[R.TIFR2] & B.TOV2), "CTC clears below-MAX TOP without TOV2");

    timer.reset();
    cpu.writeData(R.OCR2A, 0xff);
    cpu.writeData(R.TCNT2, 0xfe);
    cpu.writeData(R.TCCR2A, 0x02);
    cpu.writeData(R.TCCR2B, 0x01);
    advance(cpu, 1);
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0xff && !(cpu.data[R.TIFR2] & B.TOV2), "CTC MAX TOP must not set TOV2 before wrap");
    advance(cpu, 1);
    assert(timer.snapshot().tcnt2 === 0x00 && (cpu.data[R.TIFR2] & B.TOV2), "CTC MAX TOP wrap must set TOV2");
  });

  check("ctc-strict-start-and-running-top-boundaries", () => {
    const cpu = cpuFixture();
    const timer = createAvrTimer2(cpu);
    cpu.writeData(R.TCCR2A, 0x02);
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x01), /OCR2A=0/, "zero-TOP CTC start");
    assert(cpu.data[R.TCCR2B] === 0, "rejected zero-TOP CTC start must remain stopped");

    cpu.writeData(R.OCR2A, 0x10);
    cpu.writeData(R.TCNT2, 0x11);
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x01), /TCNT2 <= OCR2A/, "CTC start above TOP");
    assert(cpu.data[R.TCCR2B] === 0, "rejected counter-above-TOP start must remain stopped");

    cpu.writeData(R.TCNT2, 0x00);
    cpu.writeData(R.OCR2B, 0x20);
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x01), /OCR2B <= OCR2A/, "CTC start with compare B above TOP");
    assert(cpu.data[R.TCCR2B] === 0, "rejected OCR2B-above-TOP start must remain stopped");
    cpu.writeData(R.OCR2B, 0x08);
    cpu.writeData(R.TCCR2B, 0x01);
    advance(cpu, 1);
    expectThrow(() => cpu.writeData(R.OCR2A, 0x09), /dừng clock/, "running CTC TOP update");
    expectThrow(() => cpu.writeData(R.OCR2B, 0x20), /OCR2B <= OCR2A/, "running CTC compare B above TOP");
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x00), /WGM=2->WGM=0/, "running CTC to Normal transition");
    expectThrow(() => cpu.writeData(R.TCNT2, 0x11), /TCNT2 <= OCR2A/, "running CTC counter write above TOP");
    const state = timer.snapshot();
    assert(state.ocr2a === 0x10 && state.mode === "ctc-ocr2a-top" && state.top === 0x10,
      "rejected running CTC writes must preserve bounded TOP/mode");

    cpu.writeData(R.TCCR2B, 0);
    advance(cpu, 1);
    cpu.writeData(R.TCCR2A, 0x03); // WGM3 Fast PWM staged while stopped
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x01), /WGM=3/, "Fast PWM WGM3 remains unsupported");
    assert(cpu.data[R.TCCR2B] === 0, "rejected WGM3 start must remain stopped");
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

  check("running-normal-rejects-pwm-ctc-output-compare-and-assr", () => {
    const cpu = cpuFixture();
    createAvrTimer2(cpu);
    cpu.writeData(R.TCCR2B, 0x04); // Normal /64
    advance(cpu, 1);
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x01), /WGM=1/, "phase-correct PWM WGM1");
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x02), /WGM=2/, "CTC WGM2");
    expectThrow(() => cpu.writeData(R.TCCR2A, 0x40), /COM2A/, "COM2A compare output");
    expectThrow(() => cpu.writeData(R.TCCR2B, 0x44), /force-output-compare/, "FOC2B");
    cpu.writeData(R.OCR2A, 0x22);
    cpu.writeData(R.OCR2B, 0x33);
    assert(cpu.data[R.OCR2A] === 0x22 && cpu.data[R.OCR2B] === 0x33, "Normal-mode OCR2A/B writes must commit immediately");
    expectThrow(() => cpu.writeData(R.ASSR, B.AS2), /ASSR/, "asynchronous clock AS2");
    expectThrow(() => cpu.writeData(R.ASSR, B.EXCLK), /ASSR/, "external oscillator EXCLK");
    assert(cpu.data[R.TCCR2A] === 0 && cpu.data[R.TCCR2B] === 0x04 && cpu.data[R.ASSR] === 0,
      "rejected writes preserve running Normal /64 synchronous state");
  });

  check("reserved-mask-and-flag-bits-fail-closed", () => {
    const cpu = cpuFixture();
    createAvrTimer2(cpu);
    expectThrow(() => cpu.writeData(R.TIMSK2, 0x08), /reserved\/unsupported/, "reserved TIMSK2 bit");
    expectThrow(() => cpu.writeData(R.TIFR2, 0x08), /reserved\/unsupported/, "reserved TIFR2 bit");
    assert(cpu.data[R.TIMSK2] === 0 && cpu.data[R.TIFR2] === 0, "reserved mask/flag writes must not mutate state");
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
