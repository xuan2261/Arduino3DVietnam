# AVR Timer2 v1.6 baseline + post-v1.6 bounded Normal compare / CTC WGM2 studies

## Scope

`src/avr-timer2.js` is a **standalone** ATmega328P Timer/Counter2 subset for the vendored avr8js CPU. It is intentionally not attached to `src/avr-board-runner.js` and must not be presented as complete Arduino Timer2 behavior.

```js
import { createAvrTimer2 } from "./src/avr-timer2.js";

const timer2 = createAvrTimer2(cpu);
timer2.snapshot();
timer2.reset();
timer2.dispose();
```

Exports: `AVR_TIMER2_CPU_HZ`, `AVR_TIMER2_REGISTERS`, `AVR_TIMER2_BITS`, `AVR_TIMER2_CAPABILITIES`, `createAvrTimer2(cpu)`.

The controller is frozen and exposes `{ capabilities, registers, bits, overflowVector, snapshot, reset, dispose }`.

## Verified register and interrupt map

The core Timer2 mapping matches avr8js v0.21.1 commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd` `timer2Config` and the ATmega328P device header layout. Its exact MIT-licensed `timer.ts` and `timer.spec.ts` bytes are now included under `assets/vendor/avr/avr8js-0.21.1-source/` with Git blob SHA-1 and independently pinned SHA-256. These are **reference source only**, not executable browser dependencies:

| Register | Data-space address |
| --- | ---: |
| `TIFR2` | `0x37` |
| `TIMSK2` | `0x70` |
| `TCCR2A` | `0xB0` |
| `TCCR2B` | `0xB1` |
| `TCNT2` | `0xB2` |
| `OCR2A` | `0xB3` |
| `OCR2B` | `0xB4` |
| `ASSR` | `0xB6` |

`TOV2` and `TOIE2` are bit 0. Timer2 overflow interrupt vector is `0x12`. In the **post-v1.6 feature-branch extension**, compare A uses `OCF2A/OCIE2A` bit 1, vector `0x0E`; compare B uses `OCF2B/OCIE2B` bit 2, vector `0x10`. avr8js maps Timer2 `CS=1..7` to `/1,/8,/32,/64,/128,/256,/1024` respectively.

## Supported behavior

**Normal mode WGM=0** is executable. Timer2 counts `0x00..0xFF` from CPU cycles using the 16 MHz metadata clock and selected synchronous internal divider. Divider changes are applied through a deferred CPU clock event, matching the avr8js `updateDivider` scheduling pattern; changing `CS` starts a fresh modeled prescaler phase.

Writing `TCNT2` updates the counter without resetting the current prescaler phase. Multi-cycle CPU jumps catch up by `floor(deltaCycles/divider)`. Passing `0xFF` sets `TIFR2.TOV2`; writing one to `TOV2` clears the flag and any queued Timer2 overflow interrupt. With `TIMSK2.TOIE2=1` and global interrupts enabled, avr8js `cpu.tick()` services vector `0x12`.

**Post-v1.6 candidate, not the published v1.6.0 baseline:** `OCR2A` and `OCR2B` are writable immediate 8-bit comparison values in **Normal WGM0**. Crossing either value sets `TIFR2.OCF2A/B`; `TIMSK2.OCIE2A/B` can queue compare interrupts at `0x0E`/`0x10` subject to CPU global state, with independent W1C. Multi-tick catch-up and wrap are included. This first Normal-only phase is documented historically in `docs/AVR_TIMER2_FIDELITY_NEXT.md`.

**Additional post-v1.6 CTC subset (WGM2):** A separate, opt-in synchronous OCR2A-TOP mode is supported. Configure WGM2 while stopped (`CS=0`), choose `OCR2A=1..255`, `TCNT2<=OCR2A` and `OCR2B<=OCR2A`, then start an internal divider. The modeled counter period is `OCR2A+1` ticks; compare A/B flags and interrupts are supported. `TOV2` remains clear when TOP is below `0xFF`, and sets on wrap for TOP `0xFF`. Running TOP/WGM changes, zero TOP, TCNT2/OCR2B above TOP, PWM, output pins and ASSR are rejected. See `docs/AVR_TIMER2_CTC_STUDY_NEXT.md` for exact source fingerprints and tests. **Neither extension has been deployed to public v1.6.0 production.**

`reset()` clears owned Timer2 register state and scheduled events to chip-reset-like synchronous stopped state. If the host separately calls `cpu.reset()`, it must also call `timer2.reset()` or recreate the Timer2 peripheral; avr8js CPU reset has no generic peripheral-reset callback. `dispose()` cancels the Timer2 event/interrupt and restores hooks, after which `createAvrTimer2(cpu)` may attach again.

## Strict fail-closed boundary

This module does **not** emulate PWM, physical OC2A/OC2B output-pin waveforms, asynchronous Timer2, or external TOSC clocking. Compare flags and interrupts are supported only in WGM0 and the guarded WGM2 CTC subset **on the feature branch**:

- WGM0 and WGM2 may be configured while `CS=0`. Only these two modes may start a `CS=1..7` divider, with WGM2 strict TOP/TCNT2/OCR2B guards.
- While running, changing WGM0↔WGM2 or selecting WGM1/3 PWM is rejected before register mutation. Updating OCR2A TOP during active WGM2 is also rejected.
- `COM2A/COM2B` and `FOC2A/FOC2B` writes are rejected; `OCR2A/OCR2B` accept immediate 8-bit values for Normal compare and bounded WGM2 TOP/compare, **not** physical OC2x output pins.
- `TIMSK2` accepts `TOIE2`, `OCIE2A`, `OCIE2B`; reserved/unsupported bits are rejected.
- `TIFR2` accepts W1C `TOV2`, `OCF2A`, `OCF2B`; reserved/unsupported bits are rejected.
- `ASSR` must remain zero. `AS2`, `EXCLK`, asynchronous update-busy semantics and external oscillator timing are not modeled; nonzero ASSR writes are rejected.

Timer2 differs from Timer0/1 in an important way: all seven nonzero `CS` values are internal divider selections. `CS=6/7` are `/256` and `/1024`, **not** external-clock selections. External/asynchronous Timer2 clocking is controlled through `ASSR`, which this subset rejects.

## Stock ArduinoCore-avr compatibility warning

ArduinoCore-avr **1.8.6** `cores/arduino/wiring.c` initializes Timer2 for hardware PWM: it sets `TCCR2B.CS22` (Timer2 `/64`) and then sets `TCCR2A.WGM20`, selecting 8-bit phase-correct PWM (WGM1). Therefore a stock Arduino Uno HEX will normally leave the supported Normal subset during core initialization.

This is expected to **fail closed** if `createAvrTimer2()` is attached. It must not be enabled by default in the existing board runner, and the module does not claim compatibility with arbitrary Arduino-compiled sketches. Prime integration should remain opt-in/known-Normal-mode unless WGM1/PWM is later implemented faithfully.

A read-only browser probe with the genuine verified bundled `lesson_01.hex` (SHA-256 `1923c082b7dae924bfa0a8e4bb1766af68b96798aedec570b75abc65ca705d42`) confirmed the same compiled behavior: after 82 AVR instructions / 118 CPU cycles, the core had `TCCR2B=4` (`CS=4`, synchronous `/64`) in WGM0 and then attempted WGM1. The Timer2 subset rejected that write before commit; `TCCR2A` remained `0`, `TCCR2B` remained `4`, `ASSR=0`. This is evidence of the intended compatibility boundary, not a parity claim.

## Explicit non-claims

Capabilities are **true** for `compareMatch` and `compareInterrupts` in this candidate's standalone Normal/CTC compare subset; `ctc=true` / `ctcOcr2aTop=true` apply **only to the guarded synchronous WGM2 mode described above**. They remain **false** for running TOP-update parity, PWM, physical output compare pins, asynchronous/external clock, `tone()` parity, `millis()`/`delay()` parity, and wall-clock timing. These modeled flags and vectors do not establish stock ArduinoCore, edited Sketch, motor timing or physical pin behavior.

## Contract evidence

`tests/avr-timer2-contracts.js` covers:

- exact register/capability boundary;
- all Timer2 internal prescalers `/1,/8,/32,/64,/128,/256,/1024`;
- real `avrInstruction()` NOP cycle drive and multi-cycle catch-up;
- TCNT2 write without prescaler-phase reset;
- `TOV2`, W1C, `TOIE2`, vector `0x12`;
- stopped unsupported WGM staging but rejected active transition;
- running PWM/output-pin/ASSR rejection and forbidden dynamic CTC TOP/mode transitions;
- immediate `OCR2A/B`, compare flags and interrupt vectors `0x0E`/`0x10` in WGM0;
- independent W1C `TOV2/OCF2A/OCF2B`, late compare interrupt-enable behavior;
- reserved mask/flag rejection without mutation;
- divider reschedule, reset, dispose and reattach/reinitialize lifecycle.
- WGM2 CTC OCR2A TOP 1..255, compare A/B, bounded multi-period catch-up;
- CTC compare interrupts, TOV2 MAX-vs-below-MAX and zero/above-TOP negative cases.

`tests/avr-timer2-contracts.js` now has **16 direct checks**: the original 12 Normal/overflow/compare checks plus four WGM2 CTC checks. They prove only the standalone synchronous **Normal and guarded CTC** subset, not stock ArduinoCore parity or any compiler/HEX integration.
