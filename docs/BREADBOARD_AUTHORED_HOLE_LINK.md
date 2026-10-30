# Authored breadboard hole → learner terminal link intent

## Scope

This phase adds an explicit learner workflow on top of the existing in-session
`terminal → breadboard hole` assignments. The feature does not infer electrical
connections from a breadboard contact group, scene geometry, proximity, or rail
continuity.

Only a hole that is already owned by exactly one current explicit authored
placement record may participate in a hole-link intent.

The flow is:

```text
explicit Gán terminal→hole records
  → enable hole-link preview mode
  → select exact authored hole #1
  → select/drag exact authored hole #2
  → READY preview only
  → explicit Confirm
  → prime/LabEditor callback
  → canonical learner graph may commit
```

Selection, preview, and drag never create a graph edge by themselves.

## Optional native controls

The UI recognizes these four IDs as one all-or-none group:

- `bbHoleLinkEnable`
- `bbHoleLinkConfirm`
- `bbHoleLinkCancel`
- `bbHoleLinkStatus`

If all four are absent, historical fixtures and behavior remain valid and link
mode simply stays unavailable through native controls. A partial group fails
closed at mount.

The three buttons are native `type="button"` controls with minimum
`44 × 44 px` targets. `bbHoleLinkStatus` is forced to `role="status"`,
`aria-live="polite"`, and `aria-atomic="true"`.

The Enable control is a true pressed toggle. While link mode is active it stays
enabled, preserving keyboard focus; pressing it again cancels the preview. It is
disabled only while mode is off and the current context cannot start a link.

## Mount callback API

`mountBreadboardStudy()` keeps all previous options and adds:

```js
mountBreadboardStudy({
  getSceneEditActive,
  onHoleSelectionChange,

  onConnectTerminalPair(fromTerminalId, toTerminalId, frozenMeta, expectedLessonId) {
    // Prime routes this to the existing LabEditor canonical learner-graph path.
    // Expected receipt: { accepted, committed, wireId, ... }
  },

  onHoleLinkChange(snapshot) {
    // Read-only observer for scene/native projection.
  },
});
```

Both new callbacks are optional functions. A non-function value fails mount.
The default connect callback denies commit; the default observer is a no-op.

Prime supplies `getSceneEditActive()` as the current authority for all required
3D/edit conditions. The product integration additionally includes the explicit
3D breadboard-hole-pick toggle in that callback, so native link mode is disabled
unless that current authority returns exactly `true`.

## Returned controller API

The controller adds:

```js
study.getHoleLinkSnapshot();
study.cancelHoleLink();
study.pickHoleLinkTargetFromDrag(
  holeId,
  frozenMeta,
  expectedLessonId,
  expectedProfileId,
);
```

The existing `pickHoleFromScene()` and `getHoleSelection()` APIs are preserved.

The ES module still exports only `mountBreadboardStudy`; the link functions are
methods of the returned frozen controller.

## Frozen link snapshot

`getHoleLinkSnapshot()` returns exactly this frozen status model:

```js
{
  mode: "off" | "await-start" | "await-end" | "ready",
  lessonId,
  profileId,
  firstHoleId,
  secondHoleId,
  firstTerminalId,
  secondTerminalId,
  revision,
  physicalVerified: false,
  claim: "visual-only-before-confirm",
}
```

`revision` is the current `breadboard-placement-session` revision. A pair is
valid only while the same lesson, profile, canonical terminal vocabulary, exact
hole ownership, and placement revision still match.

`onHoleLinkChange(snapshot)` is called only after this state changes. Observer
exceptions are contained and do not gain graph or placement authority.

## Availability

Starting link mode requires all of the following at call time:

1. the native hole picker is present;
2. current lesson context exactly matches the placement-session lesson and
   terminal `id/component` vocabulary;
3. the lesson is enabled and has canonical terminals;
4. current profile control exactly matches the placement-session profile;
5. `getSceneEditActive() === true`;
6. at least two current explicit authored placements are terminal-strip holes
   `A1..J63`.

Rail placements do not satisfy the terminal-strip count and never become link
targets.

Lesson 01 remains disabled because its external breadboard placement session is
disabled.

## Exact explicit ownership only

When link mode is active, native grid selection or ordinary 3D scene hole
selection may arm an endpoint only when the selected exact `A1..J63` hole is
found in exactly one current explicit authored placement record.

The bridge does not use:

- the contact node ID;
- same-node membership;
- row/column proximity;
- scene distance;
- power-rail continuity;
- a visually adjacent terminal;
- a sample/reference circuit.

An unassigned hole still behaves as the existing native input selection, but it
does not change the hole-link intent.

## Intent state transitions

### Enable

With availability satisfied:

```text
off → await-start
```

No graph callback runs.

### First exact authored hole

```text
await-start → await-end
```

The snapshot records exact `firstHoleId`, exact explicit owner
`firstTerminalId`, lesson, profile, and placement revision.

### Second exact authored hole

The second hole must be distinct and owned by a different explicit terminal.

```text
await-end → ready
```

Selecting the same hole or same terminal is rejected without replacing the
first endpoint. A different valid second selection while already `ready` may
replace the preview destination, but still does not commit a wire.

### Confirm

Confirm revalidates from scratch:

- exact lesson;
- exact profile;
- exact placement revision;
- current 3D/edit/hole-pick authority;
- first hole still owned by the same terminal;
- second hole still owned by the same terminal;
- distinct holes and distinct terminals;
- at least two current explicit terminal-strip placements.

Only after those checks does it call `onConnectTerminalPair()`.

## Exact confirm metadata

The callback receives a frozen plain object with exactly six own data fields:

```js
Object.freeze({
  source: "authored-hole-confirm",
  physicalVerified: false,
  profileId,
  fromHoleId,
  toHoleId,
  placementRevision,
});
```

This metadata is generated from the revalidated current placement state, not
from arbitrary scene input.

The UI inspects the LabEditor receipt only through own data descriptors for:

```js
accepted
committed
wireId
```

The preview closes only when the receipt is internally consistent with:

```text
accepted === true
committed === true
wireId === canonical wN
```

If the controller denies or does not commit, the `ready` preview remains visible
for review/retry/cancel. No graph state is fabricated locally.

After a successful commit, status copy retains the exact wire ID, terminal IDs,
and authored hole IDs for learner feedback while explicitly stating that the
result does not verify physical continuity or assembly.

## Direct 3D drag target

The scene bridge may call:

```js
study.pickHoleLinkTargetFromDrag(
  holeId,
  Object.freeze({
    source: "pointer-drag",
    physicalVerified: false,
  }),
  expectedLessonId,
  expectedProfileId,
);
```

The drag metadata is required to be an exact frozen plain object with exactly
those two own data fields. Accessors, symbol keys, inherited/custom prototypes,
missing/extra fields, another source, or `physicalVerified !== false` are
rejected.

Direct drag is accepted only from `await-end`: the first endpoint must already
be armed and still current. A valid destination only changes the intent to
`ready`. It does not call `onConnectTerminalPair()`, does not press Assign, and
does not create a learner edge.

The ordinary hole-selection projection remains the first selected hole; direct
drag does not fabricate a second native picker selection.

## Revocation rules

An active intent is revoked to `off` by:

- Cancel button;
- Enable-toggle off;
- public `cancelHoleLink()`;
- Escape within the native link/picker controls;
- lesson change;
- profile change;
- canonical terminal-context change;
- `#bbTerminal` change;
- a successful authored placement assign/remove mutation;
- placement revision drift;
- loss of current 3D/edit/hole-pick authority.

`getHoleLinkSnapshot()` also fail-closes an active intent if current authority or
revision has become stale before the host has explicitly called `update()`.

This prevents terminal ID or hole ID reuse after a placement reset from silently
retargeting an old intent.

## Existing hole-selection behavior remains

Native grid and ordinary scene hole selection still update:

- `#bbPlaceHole`;
- native grid page;
- `aria-pressed`;
- current contact-group inspection;
- existing `onHoleSelectionChange()` observer.

The link intent is additional state only. It never changes the historical rule
that the separate **Gán lỗ** action is the only way to mutate the authored
terminal→hole placement session.

Changing `#bbTerminal` intentionally clears the current hole selection/input
projection before a later scene pick. Product E2E therefore selects the desired
terminal first, then performs the scene hole pick.

## Lessons 10 and 14

Lessons 10 and 14 retain their signal-only circuit boundary. Explicit authored
terminal-strip placements may be used to create a visual link preview, but the
snapshot remains:

```text
physicalVerified = false
claim = visual-only-before-confirm
```

No preview is treated as functional completion or a power/load model. Canonical
LabEditor/circuit-router authority remains responsible for any explicit Confirm
result.

## Focused contracts

`tests/breadboard-scene-pick-contracts.js` preserves the original 14 scene-pick
contracts and adds 10 authored-hole-link contracts, for **24/24** Bun checks in
this phase.

New coverage includes:

- all-or-none controls, native status/live region, 44 px targets;
- focused Enable toggle remaining enabled while pressed;
- exact frozen snapshot shape;
- scene first-hole + direct-drag second-hole + explicit Confirm;
- exact six-field confirm metadata;
- denied/accessor callback receipts retaining `ready` state;
- foreign/cross-profile/accessor/symbol drag negatives;
- same-hole and unassigned-hole negatives;
- Cancel/Escape/public cancel;
- lesson/profile/terminal changes;
- placement revision mutation and stale intent prevention;
- edit-off revocation;
- lesson 01 disabled and rail-only placements ignored;
- lessons 10/14 visual-only-before-confirm boundary;
- no graph callback before explicit Confirm.

Existing narrow regressions remain separate:

- `tests/breadboard-hole-grid-contracts.js`;
- `tests/breadboard-placement-session-contracts.js`.

This worker does not run Chromium, CI, deployment, network, or Git mutation.
Prime owns integrated browser/E2E validation.
