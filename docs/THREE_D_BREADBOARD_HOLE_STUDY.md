# 3D breadboard terminal-strip hole study

## Scope

This feature is an opt-in **conceptual learning overlay** on the existing lab breadboard visual. It gives the 3D scene a deterministic study vocabulary for terminal-strip hole IDs `A1..J63` without changing the learner circuit, reference circuit, topology analysis, or wiring authority.

It is not a CAD or physical-placement model. It does not claim dimensions, pitch, measured spacing, mounting-hole geometry, rail membership, hidden strip continuity, or real breadboard electrical connectivity. Every result and callback remains `physicalVerified:false`.

## Scene API

```js
scene.setBreadboardHoleStudy({
  enabled,
  profileId,
  selectedHoleId,
  onHoleSelect,
})
```

The returned status object is frozen:

```js
{
  ok,
  enabled,
  active,
  profileId,
  selectedHoleId,
  holeCount: 630,
  mode: "conceptual-strip-study" | "none",
  physicalVerified: false,
}
```

Calling the API with `enabled:false` is a harmless idempotent reset. The scene ignores the other supplied fields on that disabled path, so a host can safely clear the mode before a lab layout exists or after WebGL context loss.

When enabled, `profileId` must be an exact bounded non-empty string. `selectedHoleId` is either `null` or an exact canonical ID from `A1..J63`. If the profile changes and a new selected hole is not supplied, the previous selection is reset instead of leaking across profile context.

The mode is active only when all of these are true:

- the request is explicitly enabled;
- lab edit is on;
- a current conceptual lab layout is mounted;
- that layout has a visible component whose `visualKind` is `breadboard`;
- the WebGL context is not lost.

If the configuration is valid but those runtime prerequisites are absent, the call is fail-closed: it returns `ok:false`, `active:false`, and `mode:"none"` without modifying any electrical state.

## Deterministic canonical identity

There are 10 row symbols and 63 column numbers:

- rows: `A B C D E F G H I J`
- columns: `1..63`
- total: `10 * 63 = 630`

Instance identity is row-major and exact:

```text
instanceId = rowIndex * 63 + (column - 1)
holeId     = rows[rowIndex] + column
```

Thus instance `0` is `A1`, instance `62` is `A63`, instance `63` is `B1`, and instance `629` is `J63`.

The overlay uses a deterministic **normalized conceptual display grid** inside the existing breadboard component root. The grid is only a repeatable 3D study anchor for pointer testing and visualization. Its local coordinates are not physical breadboard coordinates and must not be converted into a hardware spacing claim.

No IDs are created for power rails. The study layer makes no rail inference.

## Rendering and LOD

The 630 study holes are rendered with one `THREE.InstancedMesh` and one bounded selection halo. The mesh is attached to the existing lab breadboard component root, so it follows the current conceptual component transform without creating an independent board model.

The study mesh carries explicit non-authority provenance:

- `conceptualStudy:true`
- `railInference:false`
- `breadboardHoleMapping:false`
- `electricalAuthority:false`
- `physicalLocation:false`
- `physicalVerified:false`

The 630 instances are not expanded into 630 separate scene objects and are not registered as fine-detail objects. This keeps the overlay bounded across the existing full/reduced LOD profiles.

## Pointer selection

The pointer callback is:

```js
onHoleSelect(
  holeId,
  Object.freeze({ source: "pointer", physicalVerified: false })
)
```

The metadata object contains exactly those two own fields. The canonical hole ID is the first callback argument.

The scene uses a two-phase pointer contract:

1. pointerdown resolves the current canonical instance and captures the current layout, lesson, profile, component, hole ID, and instance ID;
2. pointerup re-raycasts and revalidates the same layout/profile/component/hole/instance before emitting one callback.

The scene applies the selected visual halo only after the controller returns an accepted selection for the same lesson/profile/hole context. A rejected or mismatched result leaves the previous visual selection unchanged.

Selection is visual only. It never calls `setWiring`, never creates/removes a learner jumper, never changes reference wiring, and never writes topology authority.

### Pointer priority

When study mode is active, priority is deliberately specific-first:

1. existing terminal hit;
2. existing committed learner wire inspection hit;
3. breadboard study-hole instance;
4. generic component hit;
5. camera/background behavior.

This allows an explicit hole-study tap to work on the breadboard surface without stealing terminal or committed-wire interactions. When study mode is disabled, the pre-existing pointer path is unchanged.

A study-hole pointer candidate is tap-only. Crossing the existing pointer-type tap threshold turns it into camera rotation instead of hole selection. `pointercancel` and `lostpointercapture` emit no hole callback.

Keyboard equivalence is owned by the native UI. The UI can drive the same selection visually by calling `setBreadboardHoleStudy` with a canonical `selectedHoleId`; the scene does not add a second keyboard command vocabulary.

## Canvas diagnostics

The scene exposes:

- `data-lab-breadboard-hole-study-mode="none|conceptual-strip-study"`
- `data-lab-breadboard-hole-study-profile`
- `data-lab-breadboard-hole-selected`
- `data-lab-breadboard-hole-count="0|630"`
- `data-lab-breadboard-hole-physical-verified="false"`

The selected dataset identifies the currently accepted visual selection only. It does not assert an electrical connection.

## Fail-closed lifecycle

The study mode cancels any armed study pointer and resets its overlay/configuration on:

- lab layout clear or replacement;
- lesson change;
- WebGL context loss;
- scene disposal.

Context restoration does not resurrect the study mode. The host/controller must intentionally enable it again with the current profile.

Leaving lab edit removes the active overlay and prevents pointer-hole selection. Re-entering edit can reactivate a still-requested configuration only while its current layout context remains valid; layout/context resets clear that request entirely.

## Contract coverage

`tests/scene3d-contracts.js` defines browser-native contracts for:

- disabled-path harmless reset before active layout and during context loss;
- valid-but-inactive fail-closed status;
- 630 row-major instance identity and endpoint IDs;
- invalid hole/profile/callback rejection without partial mutation;
- API-driven selection halo without callback;
- profile-change stale-selection reset;
- accepted pointer selection with exact frozen metadata;
- controller rejection and context mismatch;
- mouse/touch/pen selection;
- drag-to-camera behavior;
- cancel/lost-capture no-callback behavior;
- terminal, committed-wire, and non-breadboard component priority;
- mode-off preservation of existing component behavior;
- zero learner/reference/electrical mutation;
- layout/lesson/context/dispose cleanup;
- no context-restore resurrection;
- bounded instancing/LOD and render invalidation behavior.

Worker validation for this phase is intentionally limited to Bun/static checks and browser-contract definitions. Real Chromium execution remains owned by the prime agent.
