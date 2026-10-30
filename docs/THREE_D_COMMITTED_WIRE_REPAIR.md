# Three.js committed-wire endpoint repair intent

## Scope

The 3D scene exposes a visual-only endpoint reroute intent for an already committed canonical wire. The scene never edits the canonical circuit graph, never connects or disconnects a terminal, and never treats the preview as confirmation.

The host owns the learner workflow around this scene API: choose the wire and anchor endpoint, expose native keyboard-accessible controls, receive a proposed target, and perform any later Confirm action through the canonical editor/router path.

## Public scene API

```js
scene.setCommittedWireRepairIntent({
  enabled,
  wireId,
  from,
  to,
  anchorTerminalId,
  onRerouteTarget,
});
```

When `enabled !== true`, the call is an idempotent safe-off operation. Other fields are ignored on that path so cleanup can run during stage, lesson, WebGL, and disposal transitions.

When enabled, the object must contain exactly these six own fields. The scene validates:

- `wireId` is an exact current canonical committed-wire ID.
- `{from, to}` matches that wire's current endpoints as an unordered pair.
- `anchorTerminalId` is exactly one old endpoint. This endpoint stays fixed; the other endpoint is the moved endpoint.
- both old endpoints still belong to the current mounted lab layout.
- the current lesson, edit mode, layout, wiring model, and rendered committed route are all current.
- `onRerouteTarget` is a function.

The callback contract is positional and intentionally small:

```js
onRerouteTarget(
  wireId,
  from,
  to,
  anchorTerminalId,
  targetTerminalId,
  Object.freeze({ source: "pointer-drag", physicalVerified: false }),
);
```

The callback is a proposal only. It does not imply that the wire was changed.

## Pointer interaction

Pointer priority remains terminal, committed wire, breadboard-hole study, then component for repair mode. A terminal hit therefore continues to use the existing terminal interaction path.

Dragging the selected repair wire beyond the existing pointer threshold suppresses camera rotation for that pointer. The scene renders one reusable four-point `THREE.Line` ghost from the fixed anchor toward the pointer. A canonical terminal other than both old endpoints is shown as a valid target; either old endpoint is invalid. Background motion uses a point clamped to the current conceptual lab bounds and remains invalid.

Mouse, touch, and pen use the same pointer path. Pointer release performs a fresh terminal raycast and revalidates the current layout, lesson, wire ID, unordered endpoint identity, anchor, moved endpoint, and rendered route before emitting the callback.

A tap without drag keeps the existing committed-wire inspection behavior when its inspection callback is present. With repair mode off, committed-wire dragging keeps the pre-existing camera behavior.

## Fail-closed lifecycle

The intent and transient ghost are cleared without callback when edit mode changes, the lab layout changes or clears, wiring is replaced, the lesson changes, WebGL context is lost, or the scene is disposed. Context restoration does not resurrect the repair intent. Replacing a canonical wire with the same ID but different endpoints also clears the intent before a stale pointer release can act.

`pointercancel` and `lostpointercapture` clear the transient target/ghost without producing a proposal. Releasing over the background, either old endpoint, a missing terminal, or a stale layout/wire similarly emits no callback.

## Rendering and authority

The repair preview adds no terminal or breadboard meshes and does not expand the existing 630-instance breadboard-hole picker. It uses a single demand-rendered line while the pointer is active. Scene datasets expose preview state for diagnostics and accessibility, with both `labCommittedWireRepairElectricalAuthority=false` and `labCommittedWireRepairPhysicalVerified=false`.

The feature makes no CAD, millimeter, breadboard-hole, or physical-wiring accuracy claim. Canonical electrical authority remains outside `scene3d.js`.

## Contracts

`tests/scene3d-contracts.js` exports `runScene3DCommittedWireRepairSourceContracts(sceneSource)` for Bun-accessible source verification. Browser scene contracts additionally cover mouse/touch/pen proposals, exact frozen metadata, valid/invalid target feedback, unchanged wire/camera state, background rejection, old-endpoint rejection, cancel/lost-capture behavior, safe-off cleanup, and same-ID wiring replacement.

The browser contracts are part of the normal scene suite; this worker did not run Chromium under the assigned scope.

### Real-pointer QA coordinates

Screen coordinates for committed-wire routes are valid only for the camera/layout state from which they were projected. If a pointer-down misses the selected repair wire, the existing scene intentionally falls through to normal component/camera interaction; dragging that missed pointer can therefore move a component or rotate the camera. Any later screen points computed before that miss are stale and must not be reused. A real-pointer retry should reset the camera and recompute its candidate point immediately before each attempt.

The native repair controls are DOM UI layered around the Three.js canvas. Real-pointer QA must also reject coordinates covered by interactive DOM (`elementFromPoint(...) !== canvas`) rather than treating an occluded wire projection as a scene raycast failure.
