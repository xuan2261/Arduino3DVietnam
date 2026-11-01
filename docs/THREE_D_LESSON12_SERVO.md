# Three.js Lesson 12 servo horn actuation

## Scope

Lesson 12 exposes the conceptual 3D servo horn as an optional pointer input for
the existing host-owned `angle` control. The scene does not own lesson progress,
the learner circuit, Arduino execution, or physical wiring. A 3D drag may preview
an angle, then request the same bounded setpoint already available through the
native HTML range input.

The Lesson 12 native control remains the canonical input surface:

- control key: `angle`;
- element: `#control-angle`;
- HTML input type: `range`;
- minimum: `0`;
- maximum: `180`;
- step: `1`;
- authored default: `90` degrees.

Keyboard access therefore remains available through the browser's native range
behavior, including Arrow/Home/End handling.

## Scene target identity

The Lesson 12 module creates one conceptual horn arm and three deliberately tagged
raycast targets: the central horn bar and the two round horn ends. Each accepted
target uses:

```text
kind: "servo-horn-grip"
lessonId: 12
sourceId: "lesson-12-servo-horn"
physicalVerified: false
electricalAuthority: false
```

Only those exact current meshes are servo input surfaces. The servo body, shaft,
labels, Arduino model, wires, terminals, and other scene objects do not gain angle
input authority.

The geometry is a conceptual interaction aid. It is not a measured SG90 CAD model
and is not physical evidence of horn dimensions, travel, torque, alignment, or
mechanical limits.

## Public scene API

The host enables the scene input with:

```js
scene.setLessonServoActuation({
  enabled: true,
  lessonId: 12,
  angle,
  onAngleChange,
});
```

The enabled form accepts exactly those four data fields. `lessonId` must be 12,
`angle` must be an integer from 0 through 180, and `onAngleChange` must be a
function. Activation also requires the visible current Lesson 12 module, the exact
tagged horn targets, a live WebGL context, and no active Lab layout/editor mode.

When `enabled !== true`, the call is an idempotent safe-off operation. It cancels
an in-flight horn drag and clears only the scene binding. It does not alter the
host's `angle` setpoint.

The returned status is frozen and explicitly reports
`physicalVerified:false` and `electricalAuthority:false`.

## Pointer and preview contract

Pointer down performs a native Three.js raycast against only the current three
tagged horn targets. A successful hit captures a stable pointer, source identity,
callback, host angle, projected horn center, and the simulator-driven angle that
was visible when the drag started. Pointer down does not change host state.

During pointer movement:

- only the owning pointer may move the gesture;
- the 3D camera and Lab layout stay fixed;
- the candidate angle is clamped to integer `0..180`;
- the scene may rotate the horn locally as a preview;
- no electrical edge, practice completion, quiz state, AVR state, or host control
  is mutated;
- no host callback is emitted during the preview.

The preview is transient. It is not a new simulator snapshot and is not evidence
that a physical servo reached the requested angle.

On a normal matching `pointerup`, the scene may issue exactly one host request:

```js
onAngleChange(
  angle,
  Object.freeze({
    lessonId: 12,
    source: "pointer",
    pointerType,
    phase: "change",
    physicalVerified: false,
  }),
);
```

The callback is allowed only when the original Lesson 12 binding, exact horn
source, pointer identity, and host angle are still current. A cancelled, stale, or
superseded gesture emits no host change.

## Host authority and native range parity

`app.js` keeps the native `#control-angle` range authoritative. A valid scene
callback is accepted only while the same Lesson 12 binding and native range remain
current, visible, connected, enabled, and in the 3D stage outside Lab Editor mode.
The callback metadata must be a frozen plain object with exactly the five expected
fields and `physicalVerified:false`.

When accepted, the host writes the proposed integer to the native range and sends
it through the same `onControlsInput` path as a real HTML `change`. This preserves
the existing lesson guard, practice-input observation, output label update, and
simulator snapshot path.

A native HTML range interaction revokes an in-flight 3D drag before applying the
new value. An older `pointerup` therefore cannot overwrite a newer native input.

## Snapshot authority while paused and running

The visible servo angle remains downstream of `simulator.js` snapshots.

- While the simulation is paused, the simulator publishes `snapshot.angle = 90`.
  A 3D drag may show a temporary preview, but after the host accepts `pointerup`
  and produces the next snapshot, the horn settles back to 90 degrees.
- While the simulation is running, the simulator publishes the current bounded
  Lesson 12 setpoint, so after host acceptance the horn settles to that snapshot
  angle.

The scene's ordinary `update(snapshot)` path is the lasting visual authority. The
pointer preview never changes simulator state directly.

## Cancellation and recovery

`pointercancel` and `lostpointercapture` clear a servo drag without emitting a
host change. Hiding the document also cancels the scene gesture.

The scene resets servo actuation when the lesson changes, a Lab layout/editor is
enabled, WebGL context is lost, or the scene is disposed. The host revokes its
binding when the 3D stage is no longer current, the document is hidden, the window
loses focus, Lab Editor becomes active, or WebGL is lost.

After visibility/focus or a verified WebGL restore, the host may arm a fresh
Lesson 12 binding from the current native setpoint. Recovery never replays the
cancelled drag or fabricates a `change`.

## Diagnostics and non-authority flags

The canvas exposes servo diagnostics for browser QA:

- `data-lesson-servo-mode`;
- `data-lesson-servo-angle`;
- `data-lesson-servo-preview-angle`;
- `data-lesson-servo-gesture`;
- `data-lesson-servo-visual-angle`;
- `data-lesson-servo-physical-verified="false"`;
- `data-lesson-servo-electrical-authority="false"`.

The setpoint, preview, and visual values have different roles. `lessonServoAngle`
is the latest host value supplied to the scene binding. `lessonServoPreviewAngle`
exists only during a valid drag preview. `lessonServoVisualAngle` records the
currently displayed horn angle after snapshot or preview rendering. None of them
certifies a real servo position.

## Electrical boundary

Servo actuation in `scene3d.js` never calls the canonical connect/disconnect paths
and never creates or removes a learner wire. `circuit-router` remains the sole
electrical authority. Lesson 12 angle input is a simulation control and carries
`electricalAuthority:false` throughout the scene contract.

The visual interaction also does not claim that D9, VCC, GND, a separate servo
power source, or a common ground are physically correct. Those remain separate
learner wiring and validation concerns.

## Contracts

`tests/scene3d-contracts.js` exports dedicated Lesson 12 source and native raycast
contracts. They cover the tagged horn targets, strict scene API, frozen callback
metadata, preview-only pointer movement, single `change` on valid release, native
range parity, lifecycle cancellation/recovery, snapshot-only lasting animation,
and explicit non-authority flags.

The raycast contract uses the pinned Three.js runtime and the known conceptual
horn geometry to prove that the intended horn bar/end targets are selectable and
that nearby servo-body regions do not become angle inputs.

These checks are wired into the normal `runScene3DContracts()` aggregate. Real
Chromium integration remains a separate gate owned by the browser/E2E lane.
