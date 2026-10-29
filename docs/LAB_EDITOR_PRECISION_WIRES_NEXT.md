# Lab editor precision wires — next integration contract

`src/lab-editor-ui.js` now exposes the current canonical learner wires as an
accessible native list inside the existing 3D lab editor. The list is a view of
`getCircuit(currentLesson)` only. It never substitutes `createSampleCircuit()`
or another reference graph when the learner draft is absent.

The list and pointer-drag bridge continue to treat `circuit-router` as the sole
learner electrical/topology authority. They do not claim physical placement,
measured voltage/current, hardware safety, or that a drag happened on real
hardware.

## Stable markup hooks

Prime-owned CSS/E2E integration can target these stable hooks:

```text
.lab-precision-wire-list[data-lab-precision-wire-list]
.lab-precision-wire-rows[data-lab-precision-wire-rows]
.lab-precision-wire-row[data-lab-wire-row="<wire.id>"]
[data-lab-wire-endpoints="<wire.id>"]
[data-lab-wire-provenance="learner graph only"]
.lab-precision-wire-remove[data-lab-remove-wire-id="<wire.id>"][data-lab-wire-lesson="<lessonId>"]
```

Every row is constructed with `createElement` + `textContent`. The row displays
the exact canonical wire ID and its chosen `from → to` endpoints plus the
literal provenance `learner graph only`. No wire ID or endpoint is interpolated
into `innerHTML`. The inventory itself uses native `<ul>/<li>` semantics.

Each precise Remove action is a native `<button type="button">` with an ARIA
label naming the exact wire and endpoints. The source enforces a 44 × 44 CSS px
minimum through inline `minHeight`/`minWidth`; CSS may style the class without
owning that accessibility guarantee.

When a learner activates one of these native Remove buttons, rerendering must
not strand keyboard focus on a detached node. After a successful button-driven
removal, focus moves with `preventScroll:true` to the next surviving exact-wire
Remove action at the same list position, otherwise the previous surviving
action, and when no wires remain to the named precision-wire group itself
(`tabindex="-1"`). Direct/programmatic `controller.removeWire(...)` calls do not
change focus; that path is also used for host/history-style updates.

## Exact wire removal

The precise removal path revalidates at activation time:

1. 3D edit mode is still active and the current lesson is supported.
2. The captured `data-lab-wire-lesson` still equals the current lesson.
3. The requested wire ID has canonical `w<number>` form.
4. `getCircuit(currentLesson)` still returns the canonical graph for that exact
   lesson. A missing learner graph is treated as having no removable wire.
5. The exact wire ID still exists in the current graph.

Only then does the controller call:

```js
disconnectCircuit(currentLearnerGraph, exactWireId)
```

and forward the resulting graph through the existing
`onCircuitChange(lessonId, next, analysis)` callback. This keeps the central app
history path effective without adding a second history/electrical authority to
the 3D editor.

The returned controller also exposes the same guarded primitive for tests or
host-directed actions:

```js
controller.removeWire(wireId, expectedLessonId)
```

It returns `true` only when the exact current learner wire was removed. Stale
lesson IDs, stale/missing wire IDs, foreign graphs, invalid router IDs, inactive
3D editing, and unsupported lessons return `false` without graph mutation.

The legacy "Gỡ dây cuối" control remains for compatibility but now delegates to
the same exact-ID removal path for its current last learner wire.

## Exact committed learner-wire inspection

The controller exposes one read-only inspection command for an **already
committed learner edge**:

```js
controller.inspectCommittedWire(wireId, meta, expectedLessonId)
```

This is not a connect, remove, undo/redo, simulator execution, Sketch compile,
or electrical-analysis authority. It is only an exact learner-graph membership
check followed by a scene visual highlight.

The command accepts exactly two metadata shapes, both frozen plain objects with
no extra string/symbol fields:

```js
// Scene pointer inspection
Object.freeze({ source: "pointer", physicalVerified: false })

// Native per-wire button inspection
Object.freeze({ source: "native-button", physicalVerified: false })
```

`expectedLessonId` is mandatory and must equal the controller's current lesson.
Inspection additionally requires a supported current lesson, stage `3d`, an
attached scene, and edit mode already ON. Guide/view-only mode is therefore not
an inspection authority.

The controller reads only `getCircuit(currentLesson)` with
`requireExisting:true`; there is no `createCircuit()` or
`createSampleCircuit()` fallback for this path. The graph must still belong to
the exact current lesson. The requested wire ID must be canonical `w<number>`
form and still identify an **own** plain wire record with exactly own
`id/from/to` fields whose two endpoints remain canonical terminals for the
lesson. Inherited/prototype wire records, foreign endpoints, stale IDs, foreign
lesson graphs, or missing learner graphs are rejected before visual state is
changed.

Only after those checks does the controller call:

```js
scene.setHighlightedLabWire(wireId)
```

The scene must truthfully return the same wire ID as an active
`committed-wire-highlight` with `physicalVerified:false`; otherwise inspection
is rejected. A successful inspection then revokes any pending two-tap first
terminal/preview so a read-only inspection cannot leave a latent connection
intent. It does **not** leave edit mode, mutate the graph, invoke
`onCircuitChange`, create a history step, or execute/compile code.

Successful inspection returns a frozen result:

```js
{
  accepted: true,
  reason: "inspected",
  lessonId,
  wireId,
  from,
  to,
  source, // "pointer" | "native-button"
  mode: "committed-wire-inspection",
  learnerGraphOnly: true,
  visualOnly: true,
  electricalAuthority: false,
  physicalVerified: false,
}
```

Rejected calls return `accepted:false` with a fail-closed reason and do not
clear pending UI, highlight a wire, report an inspection, or write the graph.

Hosts may opt in to successful inspection reporting when mounting the editor:

```js
mountLabEditor({
  ...,
  onWireInspection(wireId, meta, lessonId) {
    // observer only; the controller remains the validator
  },
})
```

The callback fires only after the exact learner wire has been accepted and the
scene highlight has succeeded. The exact frozen source metadata object is
forwarded unchanged. The scene-side bridge installed through `setLabEdit(...)`
is:

```js
onCommittedWireInspect: (wireId, meta) =>
  inspectCommittedWire(wireId, meta, capturedLessonId)
```

Prime/scene integration owns emitting the pointer metadata above. The controller
captures lesson identity so stale callbacks from a previous lesson cannot
highlight a same-named wire in the current lesson.

Each precision-wire row also includes a native `<button type="button">Xem
dây</button>` with `data-lab-inspect-wire-id`, the captured lesson ID, exact
wire/endpoints in its accessible name, and a minimum 44 × 44 CSS px target.
Native activation uses the same controller command with the strict
`native-button` metadata. Because inspection does not rerender the list, keyboard
focus remains on the activated inspection button. Existing Remove focus
restoration remains independent and unchanged.

## Explicit read-only conceptual guide layout

The lab controller now exposes an explicit host API for keeping only the
canonical conceptual component layout visible while normal 3D editing remains
off:

```js
controller.setReadOnlyGuideMode(enabled)
controller.isReadOnlyGuideIn3D()
```

`setReadOnlyGuideMode` accepts only a boolean. Its return value is the resulting
**active guide state**, not a generic operation-success flag:

- `true` means guide mode is now active;
- `false` means guide mode is off, including an explicit disable or an enable
  request rejected because the current context is ineligible.

An enable request is eligible only when the controller is not disposed, the
current lesson is one of the canonical wiring lessons, the current stage is
exactly `3d`, a scene is attached, and edit mode is off.
`isReadOnlyGuideIn3D()` evaluates the same active-state predicate. The frozen
controller snapshot also exposes `readOnlyGuideIn3D` for read-only inspection.

When active, `render()` may pass only `layoutFor()` to
`scene.setLabLayout(layout)`. That layout is generated and validated from the
current lesson's canonical terminal inventory. Guide mode **does not** enable
scene editing:

```js
scene.setLabEdit({
  // callbacks may remain installed for later edit mode,
  enabled: false,
  selectedComponentId: null,
})
```

This lets the host/scene render an authored conceptual pair overlay against the
current canonical layout without opening the editor. Guide mode does not enable
component moves, layout reset, terminal selection/two-tap state, pointer-drag
wiring, connect/disconnect actions, sample/clear actions, history mutation, or
any other learner-graph write. In particular, `createSampleCircuit()` remains reachable
only from the existing explicit edit-only sample action; guide mode never copies
a reference/sample graph into learner state. A missing learner circuit remains
missing during guide inspection.

Guide mode is intentionally ephemeral. It is revoked when the lesson context is
reset, when the stage actually switches, when the scene object is replaced or
removed, when edit mode is entered through either the toggle or `openEditor()`,
and on `dispose()`. Revocation clears a guide-owned mounted layout from the
affected scene. Returning to 3D, closing the editor, or attaching a replacement
scene does **not** silently restore guide mode; the host must explicitly call
`setReadOnlyGuideMode(true)` again after the new context is ready.

A redundant `setStage("3d")` call while guide mode is already active is a true
controller no-op. This matters because the host may re-run an idle `renderStage`
while an authored pair preview is visible: the controller must not re-send
layout/edit/pending state that could disturb scene-owned overlay state. Ordinary
`controller.update()` may refresh read-only status/UI, but because the same
canonical layout object remains mounted and `setLabEdit` remains disabled, the
authored overlay stays intact.

Prime integration currently follows this order for a valid authored 3D pair:

```text
renderStage()
setReadOnlyGuideMode(true)
scene.setAuthoredPairGuide(...)
refresh3DWiring() -> scene.setWiring(learnerCircuit, ...)
```

The scene's `setWiring()` rebuilds the conceptual wiring layer but does not clear
`activeLabLayout` or the authored pair guide. When a lab layout is active it
keeps the ordinary conceptual wiring layer hidden and refreshes the committed
lab-wire projection on that existing layout. Therefore the learner-only wiring
projection can refresh **after** the authored pair overlay without unmounting the
read-only guide layout or enabling edit mode.

Calling `setReadOnlyGuideMode(true)` while editing, on an unsupported lesson,
outside the 3D stage, without a scene, or after disposal returns `false` and
does not mutate learner graph or interaction state. Non-boolean input throws a
`TypeError` rather than coercing truthy/falsy values.

## Scene pointer-drag bridge

Worker24's scene owns pointer hit-testing and drag/cancel thresholds. Once a
terminal gesture crosses the drag threshold it emits exactly one guarded start
callback, then emits the link callback only if the drag finishes over another
canonical terminal:

```js
onTerminalDragStart(sourceId, meta)
onTerminalLink(fromId, toId, meta)
```

The agreed scene metadata for a completed pointer drag is exactly:

```js
Object.freeze({
  source: "pointer-drag",
  physicalVerified: false,
})
```

The lab controller captures the lesson ID when it installs each scene callback.
That generation guard prevents an old scene callback from committing into a
later lesson even when both lessons happen to share IDs such as `GND` or `D13`.

`onTerminalDragStart` accepts only the exact frozen plain-object metadata shown
above, an active supported 3D edit context, and a canonical source terminal in
the captured current lesson. A valid drag start clears any older two-tap
`firstTerminal` plus its pending scene preview and returns `true`, but never
changes the learner graph. Therefore a pointercancel/background drop after drag
start leaves no stale first terminal that a later click could accidentally
complete. Stale-lesson, inactive, forged-meta, or foreign-terminal drag-start
callbacks return `false` without changing either graph or pending UI state.

For a current callback, the lab controller requires active edit mode, stage
`3d`, an active scene, a supported current lesson, the expected pointer-drag
metadata, and two distinct canonical terminal IDs from `listTerminals()`.
`meta.canceled === true` is additionally fail-closed if a caller ever forwards
a canceled gesture.

As a second fail-closed boundary, `onTerminalLink` does not clear pending UI
until after current-lesson, active editor/stage, metadata, canonical endpoint,
and current learner-graph checks have all passed. Thus a forged, stale, foreign,
same-terminal, or otherwise invalid link callback cannot alter the current
two-tap selection. A valid current link may then revoke any remaining pending
terminal before entering the existing router-backed connect path.

Valid pointer links call the existing `connectTerminals(fromId, toId)` path,
which uses `connectCircuit()` on the current learner graph and then the existing
`onCircuitChange` host callback. The scene callback receives a frozen truthful
result:

```js
{
  accepted,          // true only for a router-accepted link
  committed,         // true only after a new learner graph edge is produced
  reason,            // connected / stale-lesson / invalid-meta / ...
  lessonId,
  fromId,
  toId,
  wireId,            // exact newly-created router ID, or null
  learnerGraphOnly: true,
  physicalVerified: false,
}
```

Invalid metadata, foreign IDs, same-terminal drops, stale lessons, canceled
gestures, duplicate/router-rejected edges, or inactive edit state return
`committed:false` and do not call the host graph mutation callback.

## Existing click flow remains

`onTerminalSelect(id)` still implements the prior two-tap flow:

- first tap arms `firstTerminal` and only shows the pending preview;
- tapping the same terminal again cancels without creating a wire;
- tapping a different canonical terminal calls the same router-backed
  `connectTerminals` path.

Scene selection/movement/terminal callbacks now return booleans that reflect
whether the requested interaction was actually accepted. In particular, the
rotate callback no longer reports unconditional success when selection/rotation
fails, and stale scene callbacks invoked outside active 3D edit mode return
`false` without changing controller state.

## Narrow contract coverage

`tests/lab-editor-precision-wires-contracts.js` currently contains six direct
Bun contracts covering:

1. native per-wire rows, exact endpoints, `learner graph only` provenance,
   ARIA names, stable selectors and 44 px inspect/remove target hooks, plus
   native keyboard inspection focus and Remove focus restoration without
   stealing focus from programmatic removal;
2. exact-ID removal through `onCircuitChange`, router wire-ID preservation,
   exact committed-wire inspection through the scene highlight + opt-in
   `onWireInspection(wireId,meta,lessonId)` callback, pending-intent revocation
   only after success, stale/forged/prototype/foreign/reference negatives, then
   exact-ID removal through `onCircuitChange` with router wire-ID preservation;
3. empty learner graph behavior with no reference fallback and read-only
   inspection/snapshot behavior; this same contract now exercises guide mode on
   fake DOM and native browser DOM, proving canonical layout visibility with
   `setLabEdit.enabled === false`, zero graph writes/reference copying, guarded
   controller/scene actions, explicit API return semantics, and revocation on
   editor/stage/lesson/scene/dispose transitions;
4. valid pointer-drag start/commit, pointercancel/background-drop behavior,
   forged-link pending-UI purity, plus same/foreign/invalid-meta/canceled
   negatives;
5. old-lesson drag-start/link callback rejection without clearing the new
   lesson's pending two-tap state;
6. truthful scene callback failures and preservation of two-tap cancel/connect.

Chromium remains owned by prime for integrated pointer/mobile evidence.
