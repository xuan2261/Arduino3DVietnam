# Lesson 04 · 3D potentiometer actuation

This candidate adds one bounded learner-input workflow to the existing Three.js lesson scene: dragging the **rendered legacy potentiometer knob** in lesson 4 can propose the same canonical `analog` value already owned by the host HTML range control.

## Authority boundary

- Supported lesson: **4 only**.
- Canonical learner value: integer **0..1023**, matching the existing lesson control.
- The scene never writes application controls, `circuit-router`, learner wiring, progress, quiz/completion, AVR state, or any electrical model.
- The existing HTML `<input type="range">` remains the keyboard/no-WebGL equivalent and the host remains the only state authority.
- `physicalVerified` is always `false`. The gesture is conceptual UI input; it does not claim a measured potentiometer sweep, shaft travel, CAD position, ADC voltage, resistance curve, firmware behavior, or physical hardware parity.

The current rotor visual already follows the host simulation snapshot. Pointer handling does **not** rotate the knob directly. This preserves the one-way authority chain:

`3D pointer intent -> host analog control -> lesson simulator snapshot -> scene.update(snapshot) -> rotor visual`

## Public scene API

Enable with exactly these own fields:

```js
scene.setLessonPotentiometerActuation({
  enabled: true,
  lessonId: 4,
  value: 512,
  onValueChange(value, meta) {},
});
```

The enabled form is accepted only when:

- `lessonId === 4`;
- `value` is an integer in `0..1023`;
- `onValueChange` is a function;
- lesson 4 is the current scene lesson;
- WebGL context is ready and the scene is not disposed;
- no conceptual Lab layout is mounted and Lab Edit is off;
- the visible legacy module owns the exact tagged lesson-4 `activeModule.rotor` mesh.

The returned receipt is frozen and reports:

```js
{
  ok,
  enabled,
  active,
  lessonId,
  value,
  mode: "pointer-drag" | "off",
  physicalVerified: false,
  electricalAuthority: false,
}
```

Disable safely and idempotently with:

```js
scene.setLessonPotentiometerActuation({ enabled: false });
```

Disabling cancels any owned pointer gesture without emitting a synthetic value or rollback.

## Host callback contract

The scene emits only when an integer proposal changes during a real drag:

```js
onValueChange(
  value,
  Object.freeze({
    lessonId: 4,
    source: "pointer",
    pointerType: "mouse" | "touch" | "pen",
    phase: "input" | "change",
    physicalVerified: false,
  }),
);
```

The metadata object is a plain frozen object with exactly those five own data fields. Callback exceptions are contained by the scene.

- `phase:"input"` is emitted during pointer movement when the bounded integer proposal changes. On a successful matching `pointerup`, any release-coordinate delta not already seen by `pointermove` is folded through the same threshold/accumulator first and emits one last `input` only if it changes the integer proposal.
- `phase:"change"` is emitted on a matching pointer release only when that gesture actually changed the proposed value.
- `pointercancel`, `lostpointercapture`, document hidden, disable, Lab layout/edit, lesson switch, WebGL loss, or dispose end the gesture with **no** final `change` replay and no fabricated rollback.

The host should route both HTML range events and this callback through the same canonical control mutation path. After accepting any value, the host may re-sync the setter with the newest value. A same-lesson re-sync during an active drag updates the scene's host value without releasing pointer capture, restarting the gesture, or replacing the callback that owns that gesture. When the host re-syncs the same integer that the drag just proposed, the scene keeps the fractional accumulator so repeated acknowledgements do not change gesture sensitivity. A different host value explicitly rebases both the accumulator and last emitted integer.

## Exact visual target

Only the distinct legacy lesson-4 knob mesh is an actuator target.

- legacy module root: `(5.15, 0.55, 0.10)` scene units;
- knob local center: `(0, 0.65, 0)`;
- knob cylinder radius: `0.51`;
- knob cylinder height: `0.38`;
- default world center: `(5.15, 1.20, 0.10)`.

The base/body, LED, background, Lab components, terminals, holes, wires, button caps, motor rotors, servo arms, and other lesson meshes do not gain potentiometer-input authority.

## Pointer gesture

Pointer down on the exact knob:

1. captures the matching pointer conservatively;
2. records the current host-supplied value and stable callback/source identity;
3. records the projected knob center;
4. emits no value on pointer down.

Movement uses the existing mouse/touch/pen tap threshold. Before crossing that threshold no value is emitted. After crossing it:

- when the grab is sufficiently far from the projected knob center, wrapped screen-angle deltas use `atan2(sin(delta), cos(delta))` to avoid discontinuities at ±π;
- a center grab falls back to bounded horizontal drag so an exact center pointer can still operate the control;
- the value accumulator is clamped to `0..1023` and only changed integers are emitted.

The matching `pointerup` also accounts for any final displacement since the last delivered `pointermove` before it emits the final `change`. If that final `input` callback synchronously revokes the actuator or otherwise invalidates the gesture, the scene stops there and does not emit a stale `change`.

The current visual span is used only as **conceptual gesture sensitivity**. It is not documented or exposed as physical potentiometer degrees.

While lesson-4 potentiometer actuation is enabled, the scene sets the bounded 3D canvas to `touch-action:none` before any pointer can start. This prevents the browser from taking a vertical component of an angular touch gesture for page panning and cancelling the pointer stream. Disabling/resetting the actuator restores the stylesheet behavior (`pan-y`); Lab Edit remains the other scene-owned reason for `touch-action:none`. Page scrolling remains available outside the bounded 3D viewport while the actuator owns the canvas.

While the knob owns the pointer, the camera and Lab layout do not move.

## Cancellation and stale-state rules

The gesture stores its pointer ID, pointer type, lesson ID, exact source object/ID, callback, projected center, and current bounded value accumulator. Foreign pointers are ignored.

All cancellation paths clear the gesture before releasing pointer capture so a `lostpointercapture` event cannot re-enter and replay a stale value. Hiding the document cancels an active gesture directly in the scene as well as through any host-level revocation. The last value already accepted by the host is left untouched; the scene does not attempt to restore the pointer-down value.

Changing to another lesson, mounting a conceptual Lab layout, enabling Lab Edit, losing WebGL context, disabling the actuator, or disposing the scene invalidates the gesture and prevents later pointer events from gaining authority.

## Keyboard equivalent

No new canvas keyboard shortcut is added. The native lesson-4 range input remains the keyboard path, including browser-native Arrow/Home/End range behavior. Existing canvas Enter/Space, camera arrows, and Lab Q/E/W/A/S/D behavior remain unchanged.

On narrow mobile viewports, the native `#control-analog` range remains the primary accessible fallback when the visible 3D knob is too small for comfortable direct manipulation. Browser/OS zoom can make the conceptual 3D view easier to inspect. This milestone keeps the exact tagged Three.js knob mesh as the raycast authority and does not add an invisible enlarged hit target or alter the conceptual component geometry.

## Diagnostics for browser QA

The canvas exposes non-authoritative diagnostics:

- `data-lesson-pot-mode="enabled|off"`
- `data-lesson-pot-value="0..1023"` or empty when disabled
- `data-lesson-pot-gesture="none|grabbed|dragging"`
- `data-lesson-pot-physical-verified="false"`
- `data-lesson-pot-electrical-authority="false"`
- `data-lesson-pot-visual-rotation-y` — the actual current rotor `rotation.y` after `scene.update(snapshot)`

`lessonPotValue` reflects the latest value supplied by the host setter; it is not silently advanced by pointer code. `lessonPotVisualRotationY` is downstream visual evidence only.

## Regression acceptance

Scene contracts cover:

- strict API schema and lesson/value bounds;
- exact knob-only native Three.js raycast;
- mouse/touch/pen gesture ownership;
- no callback on down or sub-threshold movement;
- bounded integer `input` and final `change` phases;
- same-lesson value re-sync without callback/pointer replacement or fractional-accumulator distortion;
- final release-coordinate accounting before `change`, including synchronous callback revocation;
- exact frozen five-field callback metadata for successful mouse/touch/pen input/change;
- actuator/Lab-Edit `touch-action:none` ownership with normal `pan-y` restoration;
- callback-error containment;
- camera immobility during knob drag;
- cancellation, lost capture, document hidden, disable, Lab layout/edit, lesson switch, WebGL loss, and dispose;
- downstream-only rotor animation;
- unchanged lesson-button, breadboard-hole/link, committed-wire repair, pointer lifecycle, and canvas keyboard behavior.

Real Chromium integration remains a separate gate owned by the host/E2E layer. It should prove that 3D pointer changes and native keyboard range changes converge on the same host `analog` value and that learner graph/layout/history, quiz/completion, progress, and AVR state remain unaffected.
