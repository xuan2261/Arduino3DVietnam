# Three.js Lesson 09 piano note actuation

## Scope

Lesson 09 exposes seven conceptual 3D piano keys as an optional pointer input for
the existing host-owned `note` control. The scene does not own lesson progress,
the learner circuit, Arduino execution, or physical wiring. A 3D key can request
the same note selection already available through the native HTML note buttons.

The seven labels come from the lesson's shared `NOTES` table:
`Đô`, `Rê`, `Mi`, `Fa`, `Sol`, `La`, and `Si`.

## Scene key identity

The Lesson 09 module creates exactly seven separate raycastable meshes. Each mesh
has `userData.kind === "piano-note-key"`, `lessonId === 9`,
`sourceId === "lesson-9-piano-keys"`, its ordered note label and index, and
`physicalVerified:false` / `electricalAuthority:false`.

The visible labels are secondary presentation. Only the seven tagged key meshes
are accepted as the 3D input surface. The nearby buzzer, key-bed body, text labels,
Arduino model, and other scene meshes do not become note inputs.

## Public scene API

```js
scene.setLessonPianoActuation({
  enabled: true,
  lessonId: 9,
  note,
  onNoteSelect,
});
```

When `enabled !== true`, the call is an idempotent safe-off operation. It cancels
an in-flight piano pointer gesture and clears only the scene's actuation binding.
The host's selected note remains host state.

The enabled form accepts exactly four own data fields: `enabled`, `lessonId`,
`note`, and `onNoteSelect`. The lesson must be exactly 9, `note` must be the
empty string or one of the seven shared labels, and `onNoteSelect` must be a
function. The scene also requires the current Lesson 09 module to contain the exact
seven ordered tagged key meshes. Context loss, Lab Editor mode, a mounted lab
layout, or a hidden lesson module rejects activation.

The returned receipt is frozen and includes actuation state, active status,
lesson ID, selected note, key count, mode, and explicit
`physicalVerified:false` / `electricalAuthority:false`.

## Pointer contract

Pointer down performs a non-recursive raycast against only the current seven key
meshes and stores the exact key object, note, callback, pointer type, and host note
that were current at gesture start. Pointer down never chooses a note.

Mouse, touch, and pen share the same tap contract. Pointer move owns the active key
gesture so the same pointer cannot rotate the camera. Selection occurs only on a
normal `pointerup` when all of these remain true:

- the gesture has not crossed the existing tap threshold;
- the Lesson 09 actuation source and callback are still current;
- the host note has not changed since pointer down;
- a fresh release raycast still hits the exact mesh that received pointer down.

Release over another key or outside the key bank emits no note. `pointercancel`
and `lostpointercapture` use the non-select finish path and emit no note.

Successful selection calls:

```js
onNoteSelect(
  note,
  Object.freeze({
    lessonId: 9,
    source: "pointer",
    pointerType,
    physicalVerified: false,
  }),
);
```

The callback is contained by the scene: invalid input and callback errors do not
grant selection authority or mutate the electrical graph.

## Host authority and native fallback

`app.js` keeps the native HTML controls authoritative. It renders seven
`<button type="button" data-note="...">` controls from the same `NOTES` table,
with `aria-pressed` tracking the current host selection. Their click path calls
the same `choosePianoNote()` host function and remains keyboard accessible.

Before a native HTML selection is applied, the host revokes any in-flight scene
gesture. This prevents an older 3D `pointerup` from replaying over a later native
selection, including when both gestures refer to the same label.

The scene callback is accepted only while the same binding, Lesson 09, 3D stage,
visibility state, and non-editing state remain current. Its metadata must be a
frozen plain object with exactly the four expected fields and a supported pointer
type. Only then does the host update `state.controls.note`, practice input
evidence, `aria-pressed`, and the simulator snapshot.

If WebGL or the 3D module cannot load, only the scene mount is replaced by the
fallback message. The native lesson controls, including the seven note buttons,
remain available.

## Fail-closed lifecycle

The scene cancels or resets piano actuation without emitting a note when the
lesson changes, Lab Editor mode is enabled, WebGL context is lost, the document
becomes hidden during a gesture, or the scene is disposed. The app also revokes
the host binding on document hide, window blur, edit/stage invalidation, and WebGL
loss. It may re-arm a fresh binding after visibility/focus or a verified WebGL
restore; no held gesture is replayed.

Changing the native note while a 3D gesture is active invalidates that gesture.
Context restoration likewise creates no synthetic note event.

## Rendering and authority boundary

Pressed and selected key colors/offsets are visual feedback only. Scene datasets
expose note, gesture, key count, and the explicit non-authority flags for
diagnostics. They do not certify real button placement, breadboard wiring, buzzer
operation, Arduino C++ execution, or physical sound generation.

`scene3d.js` never calls the canonical connect/disconnect paths for piano
actuation. Electrical graph authority remains in `circuit-router`; Lesson 09
note selection remains a simulation control.

## Contracts

`tests/scene3d-contracts.js` exports:

- `runScene3DLessonPianoSourceContracts(sceneSource, appSource)`, covering the
  seven tagged meshes, exact scene API, frozen callback metadata, exact release
  semantics, cancel/lost-capture/off-target rejection, lifecycle cleanup, host
  validation, and native HTML fallback;
- `runScene3DLessonPianoRaycastContracts()`, using the pinned Three.js runtime
  to verify all seven known world-space key centers hit their exact meshes while
  rays outside the key bank and through the buzzer region do not select a key.

These checks are wired into the normal `runScene3DContracts()` aggregate. Browser
execution is outside this worker's assigned validation scope.
