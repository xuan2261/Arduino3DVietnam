# Conceptual lab layout undo/redo history

This history is intentionally separate from learner-wire history. It tracks
only accepted conceptual component placement/rotation changes in the current
in-session Lab Editor. It does not change the circuit-router learner graph,
wire IDs, undo/redo for wiring, lesson progress, mastery state, simulation
execution, firmware, or Sketch compilation.

## Public controller surface

`mountLabEditor(...)` now returns these additional controller methods:

```js
controller.undoLayout()
controller.redoLayout()
```

Both return `true` only when an actual conceptual layout state was restored.
They return `false` when the editor is not currently active in supported 3D,
when no matching history entry exists, or when the controller is disposed.

The read-only controller snapshot additionally exposes:

```js
{
  canUndoLayout,
  canRedoLayout,
  layoutUndoDepth,
  layoutRedoDepth,
}
```

`canUndoLayout` / `canRedoLayout` describe whether a stored transition exists.
The native controls may still be disabled while the user is outside active 3D
edit mode. This distinction preserves history while switching stage or closing
and reopening the editor without allowing a hidden layout mutation.

## Native controls

The Lab Editor dynamically places two native buttons beside the existing layout
controls:

```text
[data-lab-layout-undo]  ↶ Hoàn tác bố trí
[data-lab-layout-redo]  ↷ Làm lại bố trí
```

Both are `<button type="button">`, have explicit Vietnamese accessible names,
mirror availability through `disabled` and `aria-disabled`, and enforce a
minimum 44 × 44 CSS-pixel target. Native button semantics provide keyboard
Enter/Space activation without adding a second custom keyboard event path.

## What becomes a history transition

The existing immutable layout functions remain the only layout transformation
authority:

```js
moveLabComponent(currentLayout, componentId, x, z)
rotateLabComponent(currentLayout, componentId, deltaQuarterTurns)
createLabLayout(lessonId, listTerminals(lessonId)) // explicit reset-to-default
```

An accepted transition records the prior immutable layout snapshot before the
new layout replaces it. The history entry also carries the current component
selection metadata so undo/redo can restore the same accepted editing context.

No history entry is created for:

- a move whose collision/grid resolution produces the same component x/z and
  rotation as the current layout;
- a zero-turn rotation;
- an invalid/non-finite move;
- an invalid fractional rotation;
- an operation rejected by the existing fixed-component, bounds, collision, or
  layout validator rules.

The explicit reset-position action also participates as a conceptual layout
transition when it actually changes placement. A reset that is already at the
default placement does not consume history capacity.

## Bounded in-session storage

History is bounded to at most **32 previous transitions**. The controller keeps
two internal stacks:

```text
past   <= 32
future <= 32
```

Each entry points at an already-frozen immutable lab-layout snapshot; no mutable
copy is introduced. When a 33rd accepted transition is recorded, the oldest
undo state is discarded. Undo moves the current state to the bounded future
stack; redo moves it back to the bounded past stack.

A new accepted move, rotate, or reset after undo is a divergent edit and clears
the redo stack.

## Restore semantics

Undo and redo require:

- a supported current lesson;
- Lab Editor edit mode ON;
- current stage exactly `3d`;
- an attached scene;
- a non-disposed controller;
- an available matching history entry.

Before restoring, the stored layout is validated again against the current
canonical `listTerminals(lessonId)` context. The exact stored immutable layout is
then restored; it is not reconstructed from guessed positions.

After a successful restore:

1. the stored selected component is restored when it still belongs to the
   restored layout;
2. any pending first-terminal/two-tap connection intent is cleared and its scene
   preview is revoked;
3. Lab Editor rerenders against the restored layout;
4. `onLayoutChange(restoredLayout, lessonId)` is called so the scene, schematic,
   Explorer, or other host-owned conceptual projections can refresh.

The restore path never calls `onCircuitChange`, `connectCircuit`,
`disconnectCircuit`, learner-wire undo/redo, progress/mastery callbacks, or any
execution/compile path.

## Rejected placement rollback reconciliation

A rejected component placement is not an accepted layout transition and must
not enter layout history. The editor still restores the current accepted
conceptual layout into the scene because a scene-origin drag may have displayed
a transient preview before the model rejected the move.

Hosts that maintain a separate opt-in visual study state (for example, the
scene-owned 3D breadboard-hole study overlay) can subscribe to the optional
rollback observer:

```js
mountLabEditor({
  ...,
  onSceneReconciled(layout, meta, lessonId) {
    // Re-apply host-owned visual-only opt-in state if still requested.
  },
})
```

The callback is invoked only **after** the rejected-move rollback has called
`scene.setLabLayout(layout)` successfully. It is deliberately separate from
`onLayoutChange`, because the accepted conceptual layout did not change.

The callback metadata is a frozen, non-authoritative object:

```js
Object.freeze({
  reason: "layout-rollback",
  operation: "move",
  componentId,
  physicalVerified: false,
})
```

`layout` is the exact already-accepted immutable conceptual layout and
`lessonId` is the current lesson. The observer does not grant breadboard-hole,
physical-position, or electrical authority. It is only a notification that the
scene visual tree was rebuilt from the accepted conceptual layout, so a host may
reconcile its own independent visual-only mode afterward.

Observer exceptions are contained and cannot replace the original placement
error feedback. Rejected placement still displays the source
`"Không thể đặt linh kiện: ..."` error, returns `false`, creates no layout
history entry, calls no `onLayoutChange`, and performs no learner graph/history,
progress, mastery, execution, or compile mutation.

The native coordinate action also rejects values outside the rendered
conceptual `min/max` bounds before asking `moveLabComponent` to clamp them. Thus
an input such as `#labPositionX = 999` followed by `#labPlace` follows the same
explicit rollback/reconciliation path rather than silently snapping to a distant
valid slot. This input-boundary guard does not change the immutable layout
model's own move semantics for valid callers.

## Context and persistence boundary

The layout history is scoped to the current lesson plus its canonical terminal
ID signature. It resets when `setLesson(...)` establishes a new lesson context.
If the terminal ID signature for the same lesson changes, history resets and the
cached conceptual layout is recreated from the new terminal context rather than
restoring a stale snapshot.

History deliberately **persists** across these existing non-destructive layout
boundaries:

- switching from 3D to another stage and back;
- closing and reopening Lab Editor;
- replacing/recreating the scene object, including a WebGL-owned scene
  lifecycle, because the existing controller already preserves the accepted
  conceptual layout across that boundary.

While those contexts are inactive, native undo/redo buttons are disabled and
programmatic `undoLayout()` / `redoLayout()` return `false`. Re-entering active
3D edit mode exposes the same stored layout history again.

This policy matches existing layout persistence instead of silently discarding
an accepted learner placement because the rendering surface temporarily changed.

## Learner graph isolation

Layout history and learner-wire history are independent domains:

```text
layout history  -> component x/z/quarterTurns + selection
wire history    -> circuit-router learner graph edges / wire IDs
```

Moving, rotating, undoing, or redoing a component does not add, remove, reorder,
or recreate a learner wire. Existing learner circuit object identity can remain
unchanged throughout a layout-history sequence. Conversely, learner-wire
undo/redo does not create a conceptual-layout history entry.

This is a conceptual display/edit affordance only. It makes no new claim about
physical breadboard holes, measured current/voltage, hardware correctness,
electrical authority, or whether a real component was physically moved.

## Narrow contract coverage

`tests/lab-editor-precision-wires-contracts.js` keeps its existing six top-level
contract groups and now additionally verifies layout history within them:

- native Undo/Redo buttons, >=44 px target hooks and `aria-disabled` state;
- accepted move creates one undo transition and clears pending terminal intent;
- no-op and invalid moves/rotations create no transition;
- undo/redo restore the exact frozen layouts and component selection while
  preserving keyboard focus on the native control;
- every successful restore calls `onLayoutChange` and performs zero learner
  circuit writes;
- a divergent accepted edit clears redo;
- history persists across stage switch, edit close/open, and scene replacement
  while mutation stays disabled outside active 3D edit mode;
- lesson change resets history;
- 35 accepted rotations retain only the latest 32 undo states; exactly 32
  restores are then available;
- learner circuit identity and wire contents remain unchanged throughout layout
  history operations.
- rejected native placement (including `labPositionX=999`) restores the scene
  first, emits exactly one `onSceneReconciled` callback with frozen rollback
  metadata, emits zero `onLayoutChange`, preserves layout-history depths and
  learner graph identity, and leaves the source error feedback visible.

The fake-DOM suite also mirrors the current prime E2E sequence exactly for the
canonical lesson-02 breadboard:

```text
breadboard x: -1 -> 0
rotate: 0° -> 90°
Undo
Undo
switch stage away from 3D and back
Redo
divergent move x: 0 -> 0.5
```

The two Undo activations and the Redo activation use the native history buttons.
In Fake DOM, `pressEnter()` emulates the browser default action of an enabled
`<button>` after dispatching Enter; the test also proves there is no custom
`keydown` listener on the history button itself. Real browser Enter behavior is
left to the prime-owned Chromium E2E. The sequence verifies exact breadboard
coordinates/quarter-turns after each restore, focus retention, truthful
`aria-disabled` state across the stage switch, redo invalidation after the
divergent move, exactly six `onLayoutChange` notifications, and zero learner
circuit writes.

Chromium/E2E integration remains prime-owned; this worker phase runs only the
narrow Bun/static contracts requested by the task.
