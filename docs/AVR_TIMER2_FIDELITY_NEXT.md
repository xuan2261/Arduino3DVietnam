# AVR Timer2 fidelity next

## Scope

`src/avr-timer2.js` remains a standalone, opt-in Timer/Counter2 peripheral for the already-vendored avr8js CPU. This iteration extends only the verified synchronous **Normal mode (WGM=0)** subset. It does not attach Timer2 to the default board runner and does not compile, load, or execute Arduino Sketch source.

## Verified improvement: Normal-mode compare match

The pinned upstream reference is `wokwi/avr8js` v0.21.1, commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd`, `src/peripherals/timer.ts` and `timer.spec.ts`. Its `timer2Config` maps compare A/B interrupts to vectors `0x0E` and `0x10`, uses `OCF2A/OCIE2A = 0x02` and `OCF2B/OCIE2B = 0x04`, and treats OCR values as immediate in Normal mode.

The local bounded peripheral now supports that same Normal-mode compare surface:

- `OCR2A` and `OCR2B` accept immediate 8-bit register values; compare evaluation occurs only while the supported WGM0 counter is running;
- counter progression sets `OCF2A`/`OCF2B` when a compare value is reached, including a compare crossed during one multi-cycle catch-up and a compare reached after 8-bit wrap;
- `TIFR2` uses write-one-to-clear independently for `TOV2`, `OCF2A`, and `OCF2B`;
- `TIMSK2` accepts `TOIE2`, `OCIE2A`, and `OCIE2B`; compare interrupts use the avr8js CPU queue/service path at vectors `0x0E`/`0x10`;
- `snapshot()` reports OCR bytes plus compare flags and interrupt-enable state.

The catch-up check is bounded arithmetically rather than looping once per timer tick. Any jump of at least 256 Timer2 ticks necessarily crosses every 8-bit compare value once or more, so both compare flags are set. Shorter jumps use the forward modular distance from the previous counter value.

## Fail-closed boundary retained

CTC and every PWM mode remain unsupported. `COM2A/COM2B`, force-output-compare bits, OC2A/OC2B pin waveforms, asynchronous Timer2, and external oscillator timing are still rejected before state mutation. Reserved `TIMSK2` and `TIFR2` bits are also rejected.

`AVR_TIMER2_CAPABILITIES.compareMatch` and `compareInterrupts` are true only for the supported Normal-mode peripheral behavior. `ctc`, `pwm`, `outputComparePins`, `asynchronousClock`, `externalClock`, `toneParity`, `millisParity`, `delayParity`, and `wallClock` remain false.

The returned controller exposes peripheral lifecycle/state methods only. The contracts explicitly reject any assumption that it provides `compile`, `loadHex`, `runCycles`, `runSketch`, or `executeSketch`. Arduino source edits remain source text until some separate verified compiler/runtime path is used.

## Contract coverage

`tests/avr-timer2-contracts.js` now verifies the original counter/prescaler/overflow behavior plus:

- immediate OCR2A/B register writes in WGM0;
- compare flags for ordinary and multi-cycle crossings;
- compare after counter wrap;
- independent OCF2A/B write-one-to-clear behavior;
- OCIE2A/OCIE2B vectors `0x0E`/`0x10` through the vendored CPU interrupt path;
- late interrupt-enable behavior: enabling OCIE2A while OCF2A is already set queues the pending compare interrupt through avr8js CPU semantics;
- reserved TIMSK2/TIFR2 bit rejection without mutation;
- absence of any Sketch compile/load/run API on the Timer2 controller.

## Remaining fidelity gaps

A future Timer2 expansion should treat CTC and PWM as separate work because they change TOP, OCR update timing, overflow timing, compare pin behavior, and stock ArduinoCore compatibility. Those modes should not be enabled from the current compare implementation alone. Asynchronous Timer2 also needs ASSR update-busy and external clock semantics and remains outside this subset.
