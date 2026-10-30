# Practice Evidence repair/review actions

renderPracticeEvidence() exposes two optional row-level intent callbacks for the
existing Practice Evidence checklist:

- onStartRepairMissingPair(pair) for a validated authored pair whose checklist
  status is missing.
- onStartReviewExtraPair(pair) for a validated learner pair whose checklist
  status is review-extra.

Each callback receives a newly frozen exact [fromId, toId] pair. Rendering and
clicking these controls never mutates the circuit, layout, history, lesson
progress, or checkpoint state. The UI does not connect or remove a jumper.

The controls are emitted only when the existing strict
validated3DPreviewChecklist() gate accepts the current evidence. That gate
requires the canonical checkpoint object for the current lesson/step, frozen
evidence/checkpoint/guidance structures, authored checkpoint provenance,
circuit-router authority, and the existing no-hardware/no-mastery boundaries.
Matched rows, manual checkpoints, lesson 1 wiring, cloned/forged checkpoint
evidence, and malformed checklists therefore do not receive repair/review
controls.

The host owns navigation and all mutable state. Before switching stages, entering
3D edit mode, populating editor controls, focusing a learner wire, connecting, or
removing anything, the host must re-read current state and verify that:

1. the current lesson and step still match the evidence that produced the button;
2. the current canonical learner graph still contains the expected review-extra
   pair, or still lacks the expected authored missing pair;
3. the active 3D editor/scene supports the current lesson;
4. any exact learner wire ID needed for review is resolved from the current
   canonical graph rather than cached from Practice Evidence.

A stale callback must be rejected by the host without graph/layout/history/
progress mutation. The Practice Evidence callback is only an intent signal.

Both controls are native button type="button" elements using the shared
.practice-evidence-button contract plus .practice-evidence-repair-action.
The stylesheet keeps the repair/review target at least 44x44 CSS px and full-row
on narrow layouts. Accessible names state the exact pair, authored/review
provenance, host revalidation requirement, and that no wire/checkpoint is
automatically committed or validated.
