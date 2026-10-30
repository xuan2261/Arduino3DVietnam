# Practice repair → canonical 3D editor handoff

## Scope

The Lab Editor exposes three explicit controller helpers for Practice repair/review UI. `preparePracticeRepairPair()` and `focusPracticeReviewWire()` are navigation/preparation helpers only. `reroutePracticeWire()` is a separate explicit atomic mutation intended only for a later native learner Confirm action.

The canonical electrical authority remains the existing `circuit-router` path owned by the Lab Editor:

- a learner connection still requires the existing native `#labConnect` action, which calls `connectTerminals()` and then `connectCircuit()`;
- a learner removal still requires the existing exact wire remove action, which calls `removeWireById()` and then `disconnectCircuit()`;
- prepare/review never call either mutation path;
- reroute reuses `disconnectCircuit()` and `connectCircuit()` only to build a candidate state in memory, then calls the existing `applyCircuit()` exactly once after both operations and all postconditions succeed.

None of these helpers writes Practice progress, mastery, completion, authored placement, conceptual layout, or layout undo/redo history.

## `preparePracticeRepairPair(from, to, expectedLessonId)`

This public method prepares the existing native 3D Lab Editor controls for a missing/incorrect canonical pair. It is accepted only when:

- `expectedLessonId` is an integer equal to the current lesson;
- the current lesson is already supported by `circuit-router`;
- the editor is currently open in the `3d` stage with a scene attached;
- `from` and `to` are exact, distinct terminal IDs returned by `listTerminals(currentLesson)`;
- the existing `#labConnect` button is visible/actionable and can actually receive focus.

Before any accepted handoff, all validation and focusability checks complete. Rejected/stale requests therefore do not change the learner graph, layout/history, native terminal selects, status text, keyboard focus, or pending terminal intent.

On an accepted handoff the helper:

1. focuses the existing `#labConnect` control;
2. clears an existing `firstTerminal` gesture and its scene pending preview so the old pointer/two-tap intent cannot survive the handoff;
3. sets the existing `#labFromPin` and `#labToPin` values to the exact canonical pair;
4. announces that the learner **must click Connect** and that no wire has been created automatically.

It returns this frozen shape:

```js
{
  accepted,
  reason,
  lessonId,
  fromId,
  toId,
  committed: false,
  physicalVerified: false
}
```

Successful preparation uses `reason: "prepared"`. The helper never returns `committed:true`.

## `focusPracticeReviewWire(wireId, from, to, expectedLessonId)`

This public method moves keyboard focus to the existing exact learner-wire review action. It is accepted only when:

- the current supported lesson is open in active 3D edit with a scene attached;
- `expectedLessonId` exactly matches the current lesson;
- `wireId` is a canonical `w1`, `w2`, ... ID;
- `from` and `to` are exact, distinct current lesson terminal IDs;
- the current canonical learner graph contains that exact `wireId`;
- the current wire endpoints match the supplied pair in either order;
- the rendered wire row still carries that same wire ID **and** the same canonical endpoints;
- an existing row Inspect button is visible/actionable, or an existing exact Remove button is available as fallback.

The rendered row stores its current canonical `from`/`to` values as data attributes. This matters because a fresh learner graph can reuse an ID such as `w1`. A stale DOM row for an older `w1` cannot receive focus for a newer `w1` with different endpoints. An explicit Lab Editor update must first render the new canonical row.

On acceptance the helper focuses the exact row action, clears an old pending terminal gesture, and announces that the learner is reviewing the wire and that the system **does not automatically remove it or complete Practice**.

The helper deliberately does not invoke `inspectCommittedWire()` automatically. Inspection remains available through the focused native Inspect button, but avoiding an automatic call also avoids an observer callback or any mistaken interpretation that review itself proves learner action.

The frozen receipt is:

```js
{
  accepted,
  reason,
  lessonId,
  wireId,
  fromId,
  toId,
  committed: false,
  physicalVerified: false
}
```

Successful focus uses `reason: "focused-review"`. It never removes or commits a wire.

## `reroutePracticeWire(wireId, originalFrom, originalTo, anchorTerminalId, newTargetId, expectedLessonId)`

This method is the only mutation helper in this handoff set. It is not called by a preview. The intended caller is an explicit native learner Confirm action.

The request is accepted only when:

- the current supported lesson is open in active `3d` edit with a scene attached;
- `expectedLessonId` is the exact current lesson;
- `wireId` is an exact live canonical learner wire ID;
- `originalFrom` and `originalTo` match the live wire endpoints in either order;
- `anchorTerminalId` is exactly one endpoint of that live wire;
- `newTargetId` is a distinct canonical terminal in the current lesson;
- `newTargetId` is not simply the replaced original endpoint, so an unchanged route is rejected.

After validation, the method computes this transaction without publishing intermediate state:

```js
without = disconnectCircuit(base, wireId)
next = connectCircuit(without, anchorTerminalId, newTargetId)
```

The candidate must contain a new router-generated wire ID, must no longer contain the old ID, and the new wire endpoints must match `anchorTerminalId ↔ newTargetId`. Only then does the method call `applyCircuit(next, ...)` once.

After that single published graph change succeeds, any older pending two-tap terminal intent is cleared from the Lab Editor/scene preview so the reroute cannot leave a stale pointer gesture armed for the next learner action.

If disconnect/connect rejects—for example because the requested target would duplicate an existing canonical direct wire—the helper returns a frozen rejection and the original learner graph object remains untouched. Stale IDs, endpoint mismatch, invalid anchor/target, inactive editor, unsupported lesson, and same-route requests likewise perform no `onCircuitChange`.

Successful frozen receipt:

```js
{
  accepted: true,
  committed: true,
  reason: "rerouted",
  lessonId,
  oldWireId,
  newWireId,
  anchorTerminalId,
  newTargetId,
  physicalVerified: false
}
```

Rejected receipts use the same shape with `accepted:false`, `committed:false`, and `newWireId:null`.

The helper does not claim a physical reroute. It changes only the canonical learner graph through the existing router authority.

## Focus/actionability boundary

The two focus/preparation helpers use the existing controls only. A target is considered actionable only when the Lab Editor panel is visible, the control is not disabled/hidden/`aria-hidden`, it is connected when the DOM exposes `isConnected`, it has client rectangles when the DOM exposes `getClientRects()`, and `focus()` succeeds with the control becoming `document.activeElement`.

This prevents a handoff receipt from claiming success while keyboard focus remained on a hidden or disabled target.

## Lesson 10 / 14 and manual boundaries

These helpers do not decide whether a Practice checkpoint is authored as wiring or manual. That eligibility remains owned by the existing Practice/checkpoint layer.

- Lesson 10 remains a `signal-only` learner-circuit lesson while its current authored Practice checkpoints remain manual-only.
- Lesson 14 remains `signal-only`; its authored wiring/manual split is unchanged.
- A prepared pair or focused wire is only an editor handoff. It does not change `analysis.ok`, `analysis.functional`, Practice evidence, progress, mastery, or physical validation.
- An explicit reroute may change the learner graph, but lessons 10/14 are still analyzed by the same router and remain `signal-only`, `functional:false`, and `ok:false`; it does not upgrade Practice completion/mastery or physical validation.

In particular, these APIs do not turn a manual Practice step into an automatically assessed wiring step and do not turn a signal-only motor/pump lesson into a functional hardware claim.

## Direct contract coverage

`tests/lab-editor-precision-wires-contracts.js` keeps the existing exact six top-level direct checks. New assertions are embedded in those checks and cover:

- frozen accepted/rejected receipts;
- stale lesson, inactive editor, same-terminal and foreign-terminal rejection;
- no graph/layout/history/status/focus mutation on rejected repair requests;
- accepted repair preparation filling the native selects, clearing pending terminal intent, focusing `#labConnect`, and leaving the learner graph unchanged;
- accepted review with unordered endpoint matching and exact native Inspect focus;
- no automatic Inspect callback, remove callback, graph mutation, or layout history change;
- stale lesson and mismatched endpoint rejection without stealing focus;
- same `wireId` reused for different endpoints: stale old DOM row rejected, exact newly rendered row accepted;
- successful atomic reroute producing one `onCircuitChange`, a new router wire ID, and no conceptual layout/history step;
- duplicate target, same-route, inactive editor, invalid anchor, stale lesson, and reused-ID stale endpoints rejected with zero graph writes;
- lesson 10/14 reroutes retaining `signal-only`, non-functional, non-completion/non-mastery boundaries;
- lesson 1 remaining unsupported/manual-only for reroute.

Validation for this phase is the narrow Bun contract only. No browser, E2E, deployment, CI, Git mutation, CSS, scene, app, Practice UI, or circuit-router change is part of this scope.
