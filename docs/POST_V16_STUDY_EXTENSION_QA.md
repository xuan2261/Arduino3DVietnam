# Arduino 3D Việt Nam — post-v1.6 study extension QA

**Workspace:** `C:\Work\Arduino3DVietnam` (Chat On Steroids `/arduino3dvietnam`)

**Base:** feature branch `feature/post-v16-interactive-breadboard-wiring`,
`f682fce198ccd54c0eb776892a9204fcdc288652`.

**Production protected:** `main` and annotated tag `v1.6.0` peel to
`341449b12d50c681be3f04d6e291965bf6015d99`. Production Pages, Draft
Release, backup and firmware are **not** changed by this feature phase.

## Changes with clearly limited claims

1. **Three.js conceptual fidelity:** recognisable Arduino/breadboard/component
   markings and high-contrast terminal/pending/committed-wire feedback with
   deterministic geometry cleanup. Mesh geometry is illustrative, not a
   verified manufacturer CAD/socket footprint or physical connection.
2. **Canonical undo/redo:** per-lesson immutable bounded `circuit-router`
   learner-graph history, accessible native actions in 2D and 3D, explicit
   lesson/revision guards and active-circuit revocation. Undone graph edits are
   not evidence of physical wires being changed, learner mastery, or progress.
3. **Sketch pin evidence:** bounded source-only scan of direct pin-call tokens
   after comment/string and line-splice masking; matches only canonical lesson
   Arduino pin IDs. Unknown aliases/macros/functions stay unknown. The scan
   does **not** compile Sketch, execute firmware, infer electrical connections
   or prove any call executed.
4. **Timer2:** synchronous Normal WGM0 compare A/B flags and interrupt subset,
   independently matched to the pinned avr8js model. No claim of PWM, CTC,
   physical output pins, full stock-core parity, or arbitrary Sketch execution.
5. **Mechanical dimensions:** original transcription of manufacturer A000066
   §5.4 into 3 fully dimensioned hole-centre XY pairs and one Y-only pair;
   one mounting X coordinate remains *unknown*. The read-only Pinout table
   makes this limit explicit; no CAD pin coordinates, snap transform or physical
   fit are inferred.

## Source and security boundaries

- The only learner electrical authority remains `src/circuit-router.js`.
- All pending 2D/3D wire suggestions are separate visual state, never committed
  graph edges. Source review cannot create wires, event-journal entries or
  completion state.
- All 16 Vietnamese lessons and 48 editorial (not teacher-validated)
  checkpoints must remain unchanged.
- No source/vendor/firmware/Arduino toolchain upgrade; no physical device
  operations; no root LICENSE selection; no copied proprietary reference CAD.
- Last known baseline `f682fce`: Windows/Ubuntu Chromium 402/402, JS 714/714,
  Python 95/95, release 24/24. These results **must not be assigned to this
  candidate** after its code changes.

## Current verification — fill only from actual observed commands

| Gate | Evidence / current state |
|---|---|
| New pure learner-history contracts | 14/14 PASS observed locally |
| New manufacturer mounting evidence | 13/13 PASS observed locally |
| New Sketch pin evidence | **23/23 PASS** after phase-2 splice and Unicode / `$` identifier-prefix fixes |
| Timer2 bounded direct contracts | **12/12 PASS**; Normal WGM0 compare subset only |
| JS integrated model/UI suites | **854/854 PASS**, 33 Bun suites with native result-shape checks |
| Python full unit discovery | **97/97 PASS**, current working tree |
| Python release-only | **26/26 PASS**, current working tree |
| Public build / Service Worker / dist | **126 / 126 / 127** files, respectively; build PASS |
| Historical E2E literal IDs | **289/289 preserved** (269 static + 20 dynamic AST expressions); **303 current** (283 static + 20 dynamic), no missing or duplicate static names |
| Full Windows Chromium after source freeze | **416/416 PASS, 0 FAIL**; session `7712` exit 0, `screenshots/post-v16-study-extension-final-chromium.json` saved 2026-10-29 15:01:44 +07; no changed source/test path newer than report |
| Chromium diagnostics | **0** unexpected warnings, **0** console errors, **0** GPU diagnostics; active source includes the native browser history fixture fix |
| Independent final P0/P1 | **Scoped GO**: auditor28 history/Three.js; auditor29 Sketch/Timer2/mechanical provenance/release, after all P1 fixes. Branch commit + same-SHA manual CI only |
| Feature-branch commit/push | **NOT DONE** for this new development phase |
| New exact-SHA GitHub CI | **NOT DONE** for this new development phase |

## Next technical gates

1. **Complete locally:** lexical/native Chromium P1 fixes, 854 Bun/97 Python/26
   release tests, 416 real Chromium E2E, 289 historical check-call expressions,
   126-path release/SW parity and independent scoped P0/P1 review.
2. **Next:** commit/push **feature branch only** without force, then manually
   dispatch compiler and browser, followed by *read-only* release-preflight on
   the **same full new commit SHA**. Do not reuse earlier `f682fce` CI.
3. Reverify production main/tag/Pages/Draft and backup SHA256SUMS read-only.
   No Pages or release deployment without separate user-authorised publication.

## Suggested next product phase

- Obtain revision/redistribution-verified official A000066 CAD and an exact
  header/socket footprint plus an independently validated scene transform
  *before* any real physical hole snapping.
- Design a secure, opt-in compiler service for learner-edited Sketch (actual
  toolchain pinned, source privacy, execution sandbox and accountable output)
  before displaying any compiled/executed claims.
- Expand AVR timer PWM/CTC/USART only under pinned peripheral conformance
  tests; improve assistive-technology testing on physical mobile devices.
- Resolve whole-project licensing and reference-code/asset provenance before
  considering a new public production release.
