# Authored missing-pair guided preview: strict view-only contract

This step builds on 48 editorial checkpoints across the 16 Vietnamese
Arduino lessons. It is a **navigation affordance**, not circuit-authority,
automatic repair, learner activity proof, or a grading system.

## Interaction

1. The practice model recomputes required authored pairs from
   `getPracticeCheckpoint()` and compares an independent learner draft against
   its reference. UI refuses malformed provenance, rows or positive claims.
2. Only a row in status `missing` gets the native button
   `[data-practice-preview-pair-2d]`. The button displays exact canonical
   `data-practice-preview-from/to` terminal IDs and is disabled if the app
   does not supply a real callback. Matched/manual/extra-only rows don't
   offer missing-pair preview actions.
3. On explicit click, `src/app.js` rechecks the current lesson, current step,
   authored required pair and that the learner has not already added it.
   It closes 3D editor (revoking the pending first terminal), opens the 2D
   wiring view and calls `previewSuggestedPair([from,to])`.
4. `src/wiring-workbench.js` renders a dashed pair and two emphasized
   terminal buttons with text equivalent. The graph is **not** changed, and
   no terminal is armed automatically. User must separately choose and
   connect both endpoints to modify the canonical `circuit-router` graph.
5. Mutating a wire/lesson/stage tears down or clears the suggestion. A
   stale checklist click cannot redirect to another step/lesson.

## Evidence and limits

The dashed wire is **not** a committed wire or preview of physical copper;
it is authored guidance. Callbacks never call `recordPracticeAction`, alter
progress/quiz, declare teacher validation, claim hardware insertion/voltage,
or upgrade a topology match to mastery/completion. Signal-only steps never
claim real motor/pump/source behavior. This stage is intentionally separate
from accurate CAD-to-hole placement and an Arduino compiler for learner edits.

Quality gates: `tests/practice-evidence-ui-contracts.js` additive pure/DOM
negative tests (real missing/matched/manual/extra/forged and 48 steps),
exclusive Chromium E2E for actual interaction and 2D/3D graph preservation,
mobile375 native touch targets, release/SW package parity and independent audit.
