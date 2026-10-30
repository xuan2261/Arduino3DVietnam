# Guided Task Workspace — 48 authored checkpoints

The primary Practice card presents **one next action** for the current authored Vietnamese checkpoint. It composes existing modules; it does **not** create another grading, electrical, firmware, hardware, or progress authority.

## Source and flow

- The source text and checkpoint identity come from `practice-checkpoints.js` and the current lesson's exact three `steps`.
- The expected event categories are re-derived from `practice-observation.js` with an empty journal. Old lesson-level observations never prove the active step.
- The attempt state comes from a current, frozen `inspectPracticeStepAttempt()` snapshot. Start is an explicit learner action. Other actions are only navigation or focus, except that a selected view action is the actual view interaction.
- The evidence summary comes from `inspectPracticeEvidence()` over the current canonical learner draft. The 3D/2D editor and `circuit-router.js` remain the only connection and topology paths; the card never calls `connectCircuit` or `applyCircuit`.
- When a step has no editorial event expectation (five steps), the action is *self-review*, never a synthetic pass or completion event.
- Even when all expected event **categories** were reported, this does not prove that the full authored instruction was performed. The CTA only focuses the existing **Bước tiếp** control; it cannot click it or advance. The learner must separately self-review and activate Next.
- Check and Retry remain distinct native controls owned by the existing step-attempt module. Completing a quiz/lesson also remains separate.

## Public APIs

`buildPracticeGuidedTaskPlan({lesson,stepIndex,attemptSnapshot,evidence})` returns a deeply frozen, WeakSet-branded current-step view with one `action` ID. The UI exports `renderPracticeGuidedTask(doc,plan,{onAction})` and calls the host only after the learner explicitly activates its single native button.

The host receives a frozen `{lessonId,stepIndex,checkpointId,actionId}`. It **must revalidate** current lesson, step, checkpoint, active attempt, evidence, and action at click time. A stale callback cannot navigate or create an event. Focus-control, focus-run, focus-sketch and focus-repair never activate their targets; the learner must perform the actual subsequent action. The native UI is the keyboard and no-WebGL equivalent.

The CTA does not claim educational mastery, teacher validation, measured voltage/current, hardware safety, verified breadboard-hole geometry, AVR parity or learner-edited C++ compilation. Lessons 10 and 14 remain signal-only, and lesson 10's authored manual checkpoints remain manual.

## QA contract

Test all 16×3 authored steps; preserve 36 manual and 12 wiring checkpoints, the five no-event self-review steps, and all historical E2E checks. Verify the current exact identity and refusal of stale or getter-based contexts, UI native keyboard activation, mobile 375px minimum 44px actionable target, focus without unintended simulation/graph/progress change, offline asset parity, 3D context loss/fallback, and a real Start → action → Check sequence in Chromium. Browser test success alone is not firmware or hardware validation.
