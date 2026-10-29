# Practice 48-step checkpoint trail — model/UI contract

Date: 2026-10-29 (Asia/Bangkok). Scope: source-only trail over the existing
human-authored practice checkpoints plus the post-9719 read-only 3D missing-pair
suggestion surface documented below. The trail phase itself added no app hook;
the post-9719 follow-up adds renderer/CSS contracts only. App callback wiring,
scene behavior, browser E2E, SW/build integration and learner state remain owned
by the prime integration phase.

## Product boundary

The trail presents the three authored checkpoints of the current lesson and is
usable across all 16 lessons (48 total steps). Step goals are copied exactly
from `checkpoint.sourceStep`; per-step hints are copied exactly from
`checkpoint.guidance`. Both come from `src/practice-checkpoints.js`, whose
provenance remains `human-authored-from-lesson-text` / `lessons.steps`.

For a wiring checkpoint, the model checks only whether each authored unordered
pair is currently present in the **caller-supplied canonical learner graph**.
The graph is structurally guarded and then validated by `circuit-router` through
`analyzeCircuit()`. The trail does not call `createSampleCircuit()` and never
copies a reference sample into learner state. A pair row is exactly one of:

- `committed`: that authored edge exists in the supplied learner graph;
- `missing`: that authored edge does not exist in the supplied learner graph.

These are topology-evidence labels, not progress or assessment outcomes. Extra
canonical learner edges do not satisfy unrelated authored pairs.

Manual checkpoints expose no hidden wiring requirement and use
`manual-not-automatically-assessed`. Their visible note says that the step is
not automatically assessed and does not prove mastery, teacher validation, or
physical hardware correctness. Every model level also keeps auto-completion,
progress, mutation, mastery, teacher validation, and physical verification
false.

Lessons 10 and 14 remain `signal-only` according to `circuit-router`. Even when
all authored signal pairs are present, the trail explicitly keeps power, load,
functional-hardware and physical claims outside scope. Lesson 10 currently has
three manual authored checkpoints; the lesson-level signal-only boundary still
renders. Lesson 14 step 1 can report authored signal pairs present while the
same functional boundary remains visible.

## Public exports

`src/practice-checkpoint-trail.js`

```js
export const PRACTICE_CHECKPOINT_TRAIL_LIMITS
export function buildPracticeCheckpointTrail({ lesson, currentStepIndex, circuit })
```

`PRACTICE_CHECKPOINT_TRAIL_LIMITS` freezes these product bounds:

```text
lessonCount = 16
stepsPerLesson = 3
totalCheckpoints = 48
maxWires = 48
maxRequiredPairsPerStep = 16
```

Input rules:

- `lesson` must be a plain object with own data properties for `id` and
  `steps`; the authored registry must match all three source-step strings.
- `currentStepIndex` is lesson-local `0..2`.
- lesson 1 requires `circuit: null` because it has no external learner wiring.
- lessons 2..16 require the caller's canonical learner circuit state. The
  module rejects custom prototypes, accessors, unknown circuit fields,
  non-canonical wire shapes, oversized graphs, wrong lessons/engines,
  duplicate/self/unknown-terminal edges through its guards plus router
  validation.

`src/practice-checkpoint-trail-ui.js`

```js
export function renderPracticeCheckpointTrail(
  document,
  trail,
  { onNavigateStep } = {},
)
```

`onNavigateStep(index)` is the only host callback. It receives a validated
lesson-local index `0..2` only after an explicit click on a non-current step or
enabled previous/next native button. Rendering never invokes the callback,
changes focus, mutates the model, records progress, creates a wire, or completes
a lesson. The current-step button stays focusable with `aria-current="step"`
but has no click listener; this lets the host restore focus after rerender while
making a current-step click a no-op. With no callback, non-current step buttons
and previous/next navigation are disabled.

## DOM integration surface

The renderer uses only `createElement`, `textContent`, `setAttribute`, `append`
and click listeners; it never uses `innerHTML`. The structure is native and
bounded so CSS can stack or grid it responsively without changing semantics.

| Selector | Contract |
| --- | --- |
| `[data-practice-checkpoint-trail]` | Root `section`; carries lesson/current/scope data |
| `[data-practice-trail-list]` | Native `ol` with exactly three authored steps |
| `[data-practice-trail-step]` | Native `li`; has index/kind/evidence status |
| `[data-practice-trail-navigate-step="0..2"]` | Native `button`; current step has `aria-current="step"` |
| `[data-practice-trail-source-goal]` | Exact authored `sourceStep` text |
| `[data-practice-trail-source-hint]` | Exact authored `guidance` text |
| `[data-practice-trail-pairs]` | Bounded pair list for wiring checkpoints only |
| `[data-practice-trail-pair]` | Pair row with `data-practice-trail-pair-status="committed|missing"` |
| `[data-practice-trail-previous]` | Previous native button, disabled at step 0 |
| `[data-practice-trail-next]` | Next native button, disabled at step 2 |
| `[data-practice-trail-signal-boundary]` | Lesson 10/14 signal-only scope note |
| `[data-practice-trail-boundary]` | No-progress/no-completion/no-mastery/teacher/hardware note |

CSS classes use the `.practice-checkpoint-trail*` prefix. CSS itself is owned by
the host integration phase.

## Post-9719: read-only 3D visual suggestion for authored missing pairs

`renderPracticeEvidence()` keeps its existing callbacks and adds one optional
host hook alongside `onPreviewMissingPairIn2D`:

```js
renderPracticeEvidence(document, evidence, {
  // existing hooks ...
  onPreviewMissingPairIn2D,
  onPreviewMissingPairIn3D,
  // existing hooks ...
})
```

For each authored checklist row whose validated status is exactly `missing`, the
renderer can expose a native button `[data-practice-preview-pair-3d]`. It also
carries `data-practice-preview-from`, `data-practice-preview-to` and
`data-practice-checklist-order`. The visible/accessible wording identifies the
action as a **read-only 3D visual suggestion** and explicitly says it does not
create a wire or confirm physical hardware / teacher validation.

The 3D action deliberately has a stricter trust gate than ordinary presentation:

- the existing `validatedWireChecklist()` must accept the authored checklist;
- the evidence, claims, checkpoint, checkpoint provenance, missing/extra pair
  arrays, wire guidance, checklist rows/pairs and guidance claims must be the
  deeply frozen model output shape;
- lesson/step/checkpoint IDs and provenance must match the authored contract;
- the checkpoint object must be the exact current registry checkpoint resolved
  from `lessonById()` + `getPracticeCheckpoint()`, so a deep-frozen clone with
  forged pairs cannot acquire a 3D action;
- evidence authority must remain `learner-circuit-vs-reference-sample` /
  `circuit-router`, with teacher/physical/mastery/auto-completion claims false.

Consequently there is no 3D missing-pair button for a matched row, manual
checkpoint, extra-review row, forged checklist/checkpoint, or evidence whose
reference authority is unknown. Valid missing rows can still coexist with an
extra-review block; only the authored required missing rows receive actions.

If `onPreviewMissingPairIn3D` is omitted, each otherwise-valid 3D suggestion
button stays visible but disabled with `aria-disabled="true"`. If supplied, it
fires only after an explicit native-button click and receives a newly created
frozen `[from, to]` pair. Render never calls it automatically, mutates evidence,
creates/commits a wire, advances progress, or changes physical/teacher claims.

`styles/app.css` owns the post-9719 presentation for
`.practice-evidence-pair-preview-3d-button`: full-row grid placement, full width,
explicit `min-width:44px` / `min-height:44px`, dashed read-only suggestion
styling, and a mobile `max-width:580px` rule that preserves the 44px target.
The renderer continues to use `createElement`/`textContent`; no untrusted model
string is inserted with `innerHTML`.

## Suggested host wiring

The app already owns lesson selection and the lesson-local learning-step index.
The integration can build and render on each Practice refresh without giving
the trail any write authority:

```js
const lesson = currentLesson();
const currentStepIndex = state.learningSteps.get(lesson.id) ?? 0;
const circuit = lesson.id === 1 ? null : learnerCircuit(lesson.id);
const trail = buildPracticeCheckpointTrail({ lesson, currentStepIndex, circuit });

const trailNode = renderPracticeCheckpointTrail(document, trail, {
  onNavigateStep(index) {
    // Host revalidates lesson/current context, then updates its own navigation
    // state and rerenders. The trail callback itself carries no completion or
    // progress semantics.
  },
});
```

An untouched empty canonical circuit is valid input for a wiring-capable lesson
and simply leaves authored wiring pairs `missing`; the trail does not need a
separate "attempted" flag and makes no claim about whether the learner acted
elsewhere.

## Contract verification

New source-only suites run without a browser:

- `tests/practice-checkpoint-trail-contracts.js`: **16/16 PASS**. Covers all
  16 lessons / 48 checkpoints, exact source binding, missing/committed pair
  evidence, no sample injection, manual semantics, signal-only 10/14,
  canonical router rejection, prototype/accessor/unknown-field attacks,
  graph bounds, navigation indexes and deep freeze.
- `tests/practice-checkpoint-trail-ui-contracts.js`: **14/14 PASS**. Covers
  native accessible list/buttons/status, exact source text, callback-only
  navigation, boundary disabling, manual/signal disclosures, pair statuses,
  `textContent` XSS safety, DOM bounds, prototype/accessor rejection and
  no model mutation after click.

Nearby upstream contracts were also rerun after the new modules were in place:

- `tests/practice-checkpoints-contracts.js`: **37/37 PASS**;
- `tests/practice-evidence-contracts.js`: **55/55 PASS**;
- `tests/practice-evidence-ui-contracts.js`: **36/36 PASS**. The six post-9719
  additions cover explicit-click + frozen-pair 3D callback behavior, disabled
  no-hook behavior and bad callback rejection, independent 2D/3D callbacks,
  matched/manual/extra/reference-unknown/deep-frozen forged checkpoint
  fail-closed behavior, poisoned text/XSS safety, and a complete 48-step sweep
  proving 3D actions appear only for strict real authored missing rows.

No browser is required for these module contracts. The prime integration owns
real-app layout/accessibility E2E, CSS, SW/build inclusion and app event wiring.

## Source freeze

Before this worker created the five owned files, SHA-256 was captured without
Git mutation:

```text
src/practice-checkpoints.js  AA1B4E364AF0E90AA19BBDF49AB03008ECBABFC0DAA77F7598602209B8E2F901
src/circuit-router.js        9058EAA5F9EB2191624A8D6164499EC5364ED176F0F2BBDD8B689355CCB48DDE
src/lessons.js               F20B8008E951C5FF337E939227CCD59FA9C984EC2C9BF59F91880B8E2E9551E7
```

Finalization rechecked the same three files and the hashes were byte-for-byte
identical to the values above. Upstream authored checkpoints/router/lessons
therefore remained untouched by this worker.
