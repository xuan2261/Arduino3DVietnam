# Three.js authored breadboard hole-link ghost

## Purpose

`src/scene3d.js` projects the controller-owned authored hole-link intent onto the
existing conceptual 630-hole breadboard study. The scene is a view/input adapter:
it does not own terminal-to-hole placement, breadboard contact authority, learner
netlist mutation, or confirmation.

The public scene API is:

```js
scene.setBreadboardHoleLinkIntent({
  mode,          // "off" | "await-start" | "await-end" | "ready"
  profileId,
  firstHoleId,
  secondHoleId,
  onHoleLinkDrop,
});
```

The controller remains the source of truth for lesson/profile/placement revision,
explicit hole ownership, terminal ownership, and the `await-*`/`ready` transition.

## State projection

The scene exposes these diagnostics on its canvas:

```text
data-lab-hole-link-mode
data-lab-hole-link-first
data-lab-hole-link-second
data-lab-hole-link-hover
data-lab-hole-link-preview
data-lab-hole-link-electrical-authority="false"
```

The JS dataset properties are `labHoleLinkMode`, `labHoleLinkFirst`,
`labHoleLinkSecond`, `labHoleLinkHover`, `labHoleLinkPreview`, and
`labHoleLinkElectricalAuthority`.

`off` is idempotent and may be sent before any lab layout exists. Non-off states
require the currently mounted 630-hole study and its exact profile. Only canonical
terminal-strip IDs `A1..J63` are accepted for endpoints.

`await-start` renders no route. `await-end` requires one exact first hole. `ready`
requires two distinct exact holes and keeps one dashed source-to-target route
visible until the controller changes or revokes the intent.

Repeated calls with the same mode/profile/endpoints are semantic no-ops for the
visual. A new callback function may replace the previous callback without
recreating the 630-hole mesh or clearing an active hover preview. This matters
because product integration reprojects the controller state after native or scene
selection changes.

## Geometry and raycast model

The feature reuses the existing single `InstancedMesh` containing the 630
conceptual A-J × 1-63 hole markers. It never creates another 630-instance field.

For a route endpoint, the scene resolves the canonical hole to its row-major
instance index and reads that instance's current local transform with
`InstancedMesh.getMatrixAt()`. The ghost is one three-point `T.Line` attached to
the same conceptual breadboard layer. Pointer movement updates only that line and
its datasets; there is no animation-loop scan over all 630 instances.

In `await-end`, exact raycast hover over the first hole uses invalid contrast;
hover over another canonical current instance uses valid contrast. `ready` uses a
dashed material. These colors/lines are interaction feedback only.

## Pointer ownership and priority

The existing pick order remains:

```text
terminal > committed learner wire > conceptual hole > component > camera
```

A normal tap on a conceptual hole continues through the existing `onHoleSelect`
path. In `await-end`, only pointer-down on the exact currently armed first hole can
start a hole-link drag, and only when `onHoleLinkDrop` is callable.

Mouse, touch, and pen use the existing pointer-specific drag threshold. Before the
threshold, the gesture remains a tap. Once the threshold is crossed, the
hole-link gesture owns that pointer until up/cancel/lost-capture. Camera motion is
suppressed even if the pointer is currently over background or an invalid target;
this avoids accidental orbit while the learner is attempting an authored-hole
link. Invalid/background release emits no callback.

On pointer-up the scene raycasts again and requires the exact current instance,
current layout, current lesson, current profile, same first hole, and a distinct
second hole. Only then it delegates:

```js
onHoleLinkDrop(
  secondHoleId,
  Object.freeze({
    source: "pointer-drag",
    physicalVerified: false,
  }),
);
```

The scene does not consume that receipt as authority and does not transition the
controller itself. A synchronous controller update may immediately call
`setBreadboardHoleLinkIntent()` again; the pointer cleanup is completed before the
callback so that re-entry cannot resurrect stale drag state.

## Lifecycle and stale-state rules

The scene resets the link intent to `off`, clears hover datasets, disposes the
single route geometry, and emits no delayed callback when any owning visual
context is revoked:

- 630-hole study disabled or profile replaced;
- lab layout cleared/replaced;
- lesson change;
- WebGL context loss;
- scene disposal.

WebGL restore does not replay the intent. Product/controller code may project a
new current intent only after its own authority checks.

Pointer cancel and lost pointer capture clear the transient preview without a
drop callback. A pointer-up from a stale lesson/layout/profile/first-hole state is
rejected.

## Authority boundary

The ghost never calls `connectCircuit`, `disconnectCircuit`, `setWiring`, authored
placement mutation, or the explicit confirmation callback. Its objects and
datasets keep `electricalAuthority:false`, `physicalVerified:false`, and
`breadboardHoleMapping:false`.

The 630 points remain conceptual study coordinates. A visually routed line does
not establish CAD coordinates, real breadboard insertion, electrical continuity,
same-node contact, voltage/current, hardware correctness, mastery, or lesson
completion.

The later native **Confirm** action remains the only path that may ask the
LabEditor/circuit-router authority to commit a learner edge after controller-side
revalidation.

## Verification owned by this phase

`tests/scene3d-contracts.js` contains two bounded non-browser suites usable with
Bun:

- source/lifecycle contracts for API modes, datasets, visual-only authority,
  idempotency, pointer ownership, drop metadata and resets;
- native Three.js `InstancedMesh` raycast checks proving exact `instanceId`
  selection and a negative miss.

The same test file also adds browser contracts for the real scene API and
mouse/touch/pen gesture path. Browser execution is intentionally left to the
prime integration pass for this phase.
