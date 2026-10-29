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
   ARIA names, stable selectors and 44 px target hooks, plus native keyboard
   focus restoration after list rerender without stealing focus from
   programmatic removal;
2. exact-ID removal through `onCircuitChange`, router wire-ID preservation,
   stale wire/lesson rejection and injection-like ID rejection;
3. empty learner graph behavior with no reference fallback and read-only
   inspection/snapshot behavior;
4. valid pointer-drag start/commit, pointercancel/background-drop behavior,
   forged-link pending-UI purity, plus same/foreign/invalid-meta/canceled
   negatives;
5. old-lesson drag-start/link callback rejection without clearing the new
   lesson's pending two-tap state;
6. truthful scene callback failures and preservation of two-tap cancel/connect.

Chromium remains owned by prime for integrated pointer/mobile evidence.
