# AVR Timer2 CTC study — bounded WGM2 subset

## Evidence boundary

The local `assets/vendor/avr/PROVENANCE.json` pins avr8js **v0.21.1**
to commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd` and tree
`7a1df509b93fbf65635d871195a07ab0c5c486fd`. The candidate now
also includes **the exact MIT-licensed upstream reference bytes** at
`assets/vendor/avr/avr8js-0.21.1-source/timer.ts` and `timer.spec.ts`,
retrieved from that commit and verified against their Git blobs:

- `src/peripherals/timer.ts`: `0c18071f3b7c1c49178011d64f8b940c5f60de95`
- `src/peripherals/timer.spec.ts`: `6af821578db4402564776bc19e3fa77afa4983f1`

Their independently pinned SHA-256 checksums are:

- `timer.ts`: `9d43d54a461a3d9ce469ce91e6cd828ecab0f92148a0ba58bc4263787b61aaa4`
- `timer.spec.ts`: `baf1c0e8029224bf41690773c8eac102ff2f03c8b2f23573ec9bdeffe4144c36`

These two TypeScript files are **reference evidence only**, not a
browser-executed Timer2 implementation. The release build and Python
negative contracts now require their exact SHA-256/Git object content and
the independent provenance rows. The existing vendored CPU ESM/runtime and
all pinned compiled firmware/HEX bytes remain unchanged.

## What the pinned source proves

The 8-bit WGM table maps **WGM2** to CTC with `TOP=OCRA`, immediate OCR updates, and TOV update mode `Max`. The counter path computes non-phase modes modulo `TOP + 1`. Pinned tests explicitly cover CTC counter reset after OCRA TOP, TOV remaining clear when TOP is below `0xFF`, and TOV setting on wrap when CTC TOP is `0xFF`. The same timer core already maps Timer2 compare A/B vectors to `0x0E`/`0x10` and compare flags/masks to `0x02`/`0x04`.

The source also supports compare A/B flag and interrupt behavior independently of output pin overrides. This project already verified those compare vectors through the vendored CPU interrupt queue in Normal mode, so the CTC extension reuses the same CPU interrupt mechanism.

## Implemented CTC subset

`src/avr-timer2.js` now accepts synchronous **WGM2 CTC** in addition to WGM0 Normal under a deliberately narrower configuration contract:

- CTC is configured while `CS=0`, then started with any existing Timer2 internal divider `/1,/8,/32,/64,/128,/256,/1024`.
- `OCR2A` is the CTC TOP and must be `1..255` when the clock starts.
- `TCNT2` must be `<= OCR2A` when CTC starts and while a direct TCNT2 write is made during active CTC.
- The counter period is `OCR2A + 1` timer ticks. Reaching OCR2A sets `OCF2A`; the following tick clears the counter to zero.
- `OCR2B <= OCR2A` can set `OCF2B`. Starting CTC with OCR2B above TOP, or writing OCR2B above TOP while CTC runs, is rejected because that edge is not covered by the pinned CTC tests used here.
- Multi-cycle catch-up uses bounded modular arithmetic over the active CTC period and retains compare A/B flags if one or more matches were crossed.
- `OCIE2A` and `OCIE2B` continue to use the avr8js CPU queue/service path at vectors `0x0E` and `0x10`.
- `TOV2` stays clear when CTC TOP is below `0xFF`; with `OCR2A=0xFF`, wrapping `0xFF -> 0x00` sets TOV2 like the pinned source/tests.

`snapshot()` identifies this mode as `ctc-ocr2a-top`, reports `top`, and exposes `counterPeriodMicroseconds`. `overflowPeriodMicroseconds` is `null` for CTC TOP below `0xFF` because no TOV2 overflow period exists in that bounded mode.

## Deliberate fail-closed limits

The pinned source permits broader dynamic configuration than this study claims. The project keeps a stricter boundary where the available source/tests do not justify a hardware-fidelity claim:

- `OCR2A=0` CTC start is rejected. That edge is not covered by the pinned CTC tests used here.
- Starting CTC with `TCNT2 > OCR2A` is rejected rather than choosing behavior for a counter already above the new TOP.
- CTC also requires `OCR2B <= OCR2A`; above-TOP compare-B configuration is rejected instead of inheriting untested generic compare-wrap behavior.
- Changing OCR2A TOP while CTC is running is rejected; stop the clock before changing TOP.
- Switching between Normal and CTC while the clock is running is rejected; stop first.
- PWM WGMs, `COM2A/COM2B`, `FOC2A/FOC2B`, OC2A/OC2B output waveforms, asynchronous Timer2/ASSR timing, and external oscillator behavior remain unsupported.

These limits are intentional. `AVR_TIMER2_CAPABILITIES.ctc=true` means only this synchronous OCR2A-TOP subset. It does not mean Timer2 PWM, `analogWrite()`, `tone()`, output-pin timing, stock ArduinoCore initialization parity, wall-clock parity, or execution of edited Arduino Sketch source.

## Contract evidence

The original 12 Timer2 checks remain present. Four additional checks cover:

- OCR2A TOP counting, reset-to-zero, OCF2A/B, and multi-period catch-up;
- CTC compare A/B interrupt vectors through the vendored CPU;
- TOV2 behavior for TOP below MAX versus TOP=`0xFF`;
- fail-closed zero TOP, counter-above-TOP, OCR2B-above-TOP, and running TOP/mode changes.

No local Arduino compiler/toolchain is used. The Timer2 controller still exposes no API that compiles, loads, or runs edited Sketch source.
