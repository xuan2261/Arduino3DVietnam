# 3D lesson button actuation

This candidate adds one bounded input workflow to the existing Three.js lesson scene: pressing and holding the rendered pushbutton cap can emit the same **simulation-input intent** already represented by the native HTML lesson control.

## Scope

- Supported lessons are exactly **3** and **16**.
- The scene never mutates lesson controls, `circuit-router`, learner wires, layout history, quiz state, progress, AVR state, or any electrical model directly.
- The 3D gesture is an enhancement only. The existing HTML press control remains the keyboard/accessibility equivalent.
- The rendered cap is conceptual. `physicalVerified` is always `false`; the interaction does not claim a measured switch travel, PCB footprint, CAD position, breadboard-hole snap, or physical hardware behavior.

## Public scene API

```js
scene.setLessonButtonActuation({
  enabled: true,
  lessonId: 3, // or 16 only
  onPressChange(pressed, meta) {},
});
```

The enabled form requires exactly the three own fields `enabled`, `lessonId`, and `onPressChange`. It is accepted only when:

- the requested lesson is exactly 3 or 16 and is the current scene lesson;
- WebGL context is ready and the scene is not disposed;
- Lab Edit is off;
- the current legacy `activeModule.pointer` is the exact tagged `button-cap` for that lesson;
- `onPressChange` is a function.

The returned receipt is frozen and reports `active`, `lessonId`, `pressed`, `physicalVerified:false`, and `electricalAuthority:false`. A disabled call can be simply:

```js
scene.setLessonButtonActuation({ enabled: false });
```

Disabling is safe and idempotent. If a pointer currently owns the press, the scene releases that held input once before clearing the intent.

## Host callback contract

The scene calls:

```js
onPressChange(
  pressed,
  Object.freeze({
    lessonId,
    source: "pointer",
    pointerType: "mouse" | "touch" | "pen",
    physicalVerified: false,
  }),
);
```

The metadata is a plain frozen object with exactly those four own fields. Callback exceptions are contained inside the scene so an application callback cannot strand the scene pointer lifecycle.

The host remains the only owner of lesson-control state. In the application integration this callback should delegate to the existing `setButtonPress()` path rather than implementing a second control model.

## Pointer ownership

Only the exact tagged cap mesh is raycast for actuation. The button body, background, other lesson parts, conceptual Lab components, terminals, holes, and committed wires do not actuate the lesson input.

On a valid cap press:

1. matching `pointerdown` emits `pressed=true` and captures that pointer conservatively;
2. move events remain owned by the actuator gesture and do not rotate the camera or move the lab layout;
3. matching `pointerup` emits `pressed=false` once;
4. `pointercancel` and `lostpointercapture` emit the same one-time false release;
5. disabling the API, entering Lab Edit, changing lesson, WebGL context loss, or scene disposal also release a held input once and clear the intent.

The pointer state stores the lesson, tagged source ID, source object, pointer ID, and pointer type. Release handling checks that identity before allowing any future gesture authority. A stale source cannot become a new press target.

Canvas Enter/Space behavior is intentionally unchanged. The new actuator does not add a canvas keyboard shortcut because the existing HTML lesson button already supplies the accessible keyboard path and the canvas keys are used by existing scene/layout controls.

## Lesson 16 cap

Lesson 3 already had a tagged legacy button cap. Lesson 16's `project` module previously rendered a cylinder at local `[-0.85, 0.65, 0.25]` without exposing it as an actuator. That cylinder is now retained as `activeModule.pointer` and tagged as the lesson-16 `button-cap`.

The existing `scene.update(snapshot)` path drives both lesson caps from `snapshot.button`. This keeps the visual depression downstream of the host-owned control state instead of mutating the mesh as electrical/input authority inside pointer handlers.

For browser QA, the canvas exposes non-authoritative diagnostics:

- `data-lesson-button-actuation="enabled|off"`
- `data-lesson-button-pressed="true|false"`
- `data-lesson-button-actuation-lesson`
- `data-lesson-button-cap-y` (actual current cap local Y after snapshot update)
- `data-lesson-button-physical-verified="false"`
- `data-lesson-button-electrical-authority="false"`

## Regression boundaries

The implementation must not change the accepted behavior of:

- conceptual component move/rotate;
- terminal tap/drag wiring;
- breadboard 630-hole study and authored-hole link ghost/Confirm workflow;
- committed-wire inspect and endpoint reroute;
- camera navigation, pointer cancel/lost-capture handling, or WebGL restore;
- canonical graph, layout/history, quiz/completion, or physical/electrical claims.

Source contracts validate the exact cap tags, API schema, non-authority boundary, exact callback metadata, cap-only raycast, pointer priority, false-release lifecycle, context/lesson/edit/dispose resets, and unchanged canvas keyboard path. Browser-runner contracts exercise mouse/touch/pen press/release, cancel/lost capture, Lab Edit disable, lesson switch, callback-error containment, lesson 16 cap, and the snapshot-driven depression diagnostic. This worker does not run Chromium; final real-pointer browser evidence remains a separate integration gate.
