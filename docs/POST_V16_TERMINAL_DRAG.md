# Post-v1.6 direct terminal drag

`scene3d.js` now supports a direct pointer drag from one mounted conceptual terminal to another. The scene owns only transient gesture/ghost rendering state. It never creates, deletes, or rewrites learner wiring. The canonical controller remains responsible for deciding whether a requested edge is accepted.

## Controller callbacks

Direct drag exposes two separate lab-edit callbacks:

```js
onTerminalDragStart(sourceId, { source: "pointer-drag", physicalVerified: false })
onTerminalLink(fromId, toId, { source: "pointer-drag", physicalVerified: false })
```

Both metadata objects are frozen and contain exactly those two fields. `onTerminalDragStart` is emitted exactly once when a canonical terminal gesture first crosses its pointer-type drag threshold, even if that drag later ends on the background, is cancelled, or loses pointer capture. `onTerminalLink` remains a separate valid-drop callback and is emitted once only when pointerup re-hits a valid distinct canonical target. There is no fallback that emits two `onTerminalSelect` calls.

Both callbacks are validated as function-or-null options and are preserved when a later `setLabEdit` call updates other fields without supplying them.

`onTerminalSelect` keeps its existing click/tap meaning. A terminal pointer gesture that never exceeds the pointer-type drag threshold is still a tap. Mouse uses the existing 4 px threshold, pen 7 px, and touch keeps the existing 12 px threshold, so an 11 px touch jitter remains a tap.

The scene does not clear the controller's two-tap first-terminal state itself. Instead, `onTerminalDragStart` gives the controller a deterministic boundary at which to clear that pending state without creating or deleting any circuit edge. This prevents an old first terminal from surviving a later direct drag that is eventually cancelled.

## Valid direct-link gesture

A direct link request is eligible only when all of the following remain true at pointerup:

- lab edit is enabled;
- `onTerminalLink` is installed as a function by the controller;
- the source terminal was hit in the currently mounted active layout;
- the layout object is still the same layout captured at pointerdown;
- source and target IDs both resolve through the current layout terminal map and mounted terminal map;
- source and target are distinct;
- the active pointer moved beyond its existing tap threshold;
- pointerup re-hits the canonical target terminal with the same pointer ID.

Pointermove may show a transient three-point ghost only while the target is valid. Pointerup re-runs hit testing and canonical validation; a previously hovered target is not trusted after the pointer leaves it.

## Fail-closed paths

No `onTerminalLink` callback is emitted for background drops, the source terminal dropped onto itself, a different pointer ID, pointer cancellation, lost pointer capture, edit-mode transition, stage/layout clear, lesson change, WebGL context loss, or disposal.

`onTerminalDragStart` is intentionally different: once the active canonical terminal crosses the drag threshold, its one callback remains valid even if the gesture is later cancelled. Pointer jitter that stays below the threshold emits neither drag-start nor link.

The direct-drag state is reset through `data-lab-terminal-drag-source`, `data-lab-terminal-drag-target`, and `data-lab-terminal-drag-preview`. The preview value is `ghost` only for a currently valid target and otherwise `none`.

Stage and lesson changes cancel the terminal pointer before removing the lab objects. WebGL loss clears the transient state before the renderer context is rebuilt. Disposal clears the same metadata and removes the visual layer without delegating a link.

## Rendering and performance boundary

The direct gesture reuses the existing pending-wire preview `Line` and its three position vertices. Pointermove updates that geometry in place; it does not allocate committed wire geometry or append to `labWireObjects`. Only two terminal IDs are kept as direct-drag state.

The direct gesture does not alter `labWireCount`, the committed eight-point route, committed-wire endpoint identity, or `labWireGeometryRevision`. It also does not change the existing terminal hit sphere or any HTML/CSS touch target; the existing 44 px HTML control equivalent remains owned by the surrounding UI.

All terminal coordinates and ghost geometry remain conceptual. The callback metadata continues to state `physicalVerified:false`; the gesture does not establish CAD placement, breadboard-hole mapping, continuity, measured electrical state, or hardware execution.

## Browser contracts

`tests/scene3d-contracts.js` contains substantive pointer contracts for mouse, touch, and pen. It projects known lesson-2 terminal anchors to the real canvas camera, confirms the source/target are actually hit, then verifies:

- valid D13 → R1:A drag shows a ghost and emits exactly one `onTerminalLink`;
- every real terminal drag emits exactly one `onTerminalDragStart` with frozen metadata, including repeated pointermove;
- successful direct drag does not call `onTerminalSelect`, change `labWireCount`, change `labWireGeometryRevision`, or change the prior selection;
- mouse tap and 11 px touch jitter still use `onTerminalSelect` with no drag-start or link callback;
- an armed two-tap first terminal can be cleared by the controller from `onTerminalDragStart` before a different-source drag is cancelled;
- background, same-endpoint, touch-cancel, and lost-capture paths emit drag-start once but no link; a foreign pointer emits neither;
- stage clear, lesson change, WebGL context loss, and dispose clear an armed ghost without a stale callback.

`tests/scene3d-visual-fidelity-contracts.js` keeps the visual-only provenance boundary and confirms direct drag reuses the single transient ghost path.

The worker validation is intentionally narrow: Bun syntax/import/static checks only. The prime agent owns the real Chromium execution of these browser contracts.
