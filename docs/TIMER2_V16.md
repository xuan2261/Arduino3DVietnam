# AVR Timer2 v1.6 — strict Normal-mode subset

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

The core Timer2 mapping matches avr8js v0.21.1 commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd` `timer2Config` and the ATmega328P device header layout:

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

`TOV2` and `TOIE2` are bit 0. Timer2 overflow interrupt vector is `0x12`. avr8js maps Timer2 `CS=1..7` to `/1,/8,/32,/64,/128,/256,/1024` respectively.

## Supported behavior

Only **Normal mode WGM=0** is executable. Timer2 counts `0x00..0xFF` from CPU cycles using the 16 MHz metadata clock and selected synchronous internal divider. Divider changes are applied through a deferred CPU clock event, matching the avr8js `updateDivider` scheduling pattern; changing `CS` starts a fresh modeled prescaler phase.

Writing `TCNT2` updates the counter without resetting the current prescaler phase. Multi-cycle CPU jumps catch up by `floor(deltaCycles/divider)`. Passing `0xFF` sets `TIFR2.TOV2`; writing one to `TOV2` clears the flag and any queued Timer2 overflow interrupt. With `TIMSK2.TOIE2=1` and global interrupts enabled, avr8js `cpu.tick()` services vector `0x12`.

`reset()` clears owned Timer2 register state and scheduled events to chip-reset-like synchronous stopped state. If the host separately calls `cpu.reset()`, it must also call `timer2.reset()` or recreate the Timer2 peripheral; avr8js CPU reset has no generic peripheral-reset callback. `dispose()` cancels the Timer2 event/interrupt and restores hooks, after which `createAvrTimer2(cpu)` may attach again.

## Strict fail-closed boundary

This module does **not** emulate CTC, PWM, compare matches, OC2A/OC2B waveforms, asynchronous Timer2, or external TOSC clocking:

- WGM values other than 0 may be staged only while `CS=0`; starting any `CS=1..7` divider requires WGM0.
- While running, any `TCCR2A/B` write that would select unsupported WGM is rejected before register mutation.
- `COM2A/COM2B`, `FOC2A/FOC2B`, and writes to `OCR2A/OCR2B` are rejected.
- `TIMSK2` accepts only `TOIE2`; compare interrupt masks are rejected.
- `TIFR2` accepts only W1C `TOV2`; compare flag writes are rejected.
- `ASSR` must remain zero. `AS2`, `EXCLK`, asynchronous update-busy semantics and external oscillator timing are not modeled; nonzero ASSR writes are rejected.

Timer2 differs from Timer0/1 in an important way: all seven nonzero `CS` values are internal divider selections. `CS=6/7` are `/256` and `/1024`, **not** external-clock selections. External/asynchronous Timer2 clocking is controlled through `ASSR`, which this subset rejects.

## Stock ArduinoCore-avr compatibility warning

ArduinoCore-avr **1.8.6** `cores/arduino/wiring.c` initializes Timer2 for hardware PWM: it sets `TCCR2B.CS22` (Timer2 `/64`) and then sets `TCCR2A.WGM20`, selecting 8-bit phase-correct PWM (WGM1). Therefore a stock Arduino Uno HEX will normally leave the supported Normal subset during core initialization.

This is expected to **fail closed** if `createAvrTimer2()` is attached. It must not be enabled by default in the existing board runner, and the module does not claim compatibility with arbitrary Arduino-compiled sketches. Prime integration should remain opt-in/known-Normal-mode unless WGM1/PWM is later implemented faithfully.

A read-only browser probe with the genuine verified bundled `lesson_01.hex` (SHA-256 `1923c082b7dae924bfa0a8e4bb1766af68b96798aedec570b75abc65ca705d42`) confirmed the same compiled behavior: after 82 AVR instructions / 118 CPU cycles, the core had `TCCR2B=4` (`CS=4`, synchronous `/64`) in WGM0 and then attempted WGM1. The Timer2 subset rejected that write before commit; `TCCR2A` remained `0`, `TCCR2B` remained `4`, `ASSR=0`. This is evidence of the intended compatibility boundary, not a parity claim.

## Explicit non-claims

Capabilities are false for CTC, PWM, compare match/output pins, asynchronous/external clock, `tone()` parity, `millis()`/`delay()` parity, and wall-clock timing. A correct Normal-mode overflow counter is not evidence of Arduino PWM, `tone()`, motor timing, or physical pin behavior.

## Contract evidence

`tests/avr-timer2-contracts.js` covers:

- exact register/capability boundary;
- all Timer2 internal prescalers `/1,/8,/32,/64,/128,/256,/1024`;
- real `avrInstruction()` NOP cycle drive and multi-cycle catch-up;
- TCNT2 write without prescaler-phase reset;
- `TOV2`, W1C, `TOIE2`, vector `0x12`;
- stopped unsupported WGM staging but rejected active transition;
- running PWM/CTC/compare/ASSR rejection;
- unsupported mask/flag rejection without mutation;
- divider reschedule, reset, dispose and reattach/reinitialize lifecycle.

These contracts prove only this standalone synchronous Normal-mode subset.
