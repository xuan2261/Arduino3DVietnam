# Post-v1.6 scene component fidelity

This change improves the readability of the Three.js lab scene while keeping the scene strictly conceptual. The scene renders component identity and interaction state; it does not establish CAD dimensions, verified socket coordinates, breadboard-hole mapping, electrical continuity, measured voltage/current, or hardware execution.

`circuit-router.js` remains the learner wiring authority. `scene3d.js` consumes the canonical layout and wiring model and only renders them.

## Component-specific visual cues

The conceptual lab now gives common parts stronger silhouettes and markings:

- Arduino Uno R3: board profile, controller package, USB-B silhouette, DC barrel silhouette, grouped header visuals, board/MCU labels, and an explicit non-authoritative header notice.
- Breadboard: body profile, center trench, red/blue rail cues, repeated visual holes/contact strips, and explicit “no hole map” wording.
- Resistor: axial body, end caps, leads, and neutral identification bands that do not encode a resistance value.
- LED/RGB LED: domed lens, lens base, flat-side cue, two/four visual leads, and type marking.
- Push button: square base, raised push cap, four visual legs, and PUSH marking.
- Potentiometer: round body, knob with a centered slot cue, three visual legs, and POT marking. The slot is not a simulated wiper value.
- LDR, force sensor, ultrasonic sensor, buzzer, and the remaining lesson components keep distinct conceptual silhouettes and type labels.

Every feature registered through `conceptualVisualFeature()` carries:

```text
conceptualFeature: true
physicalLocation: false
physicalVerified: false
electricalAuthority: false
```

These fields describe provenance of the rendering. They are not evidence that the geometry matches a real part.

## High-contrast terminal and wire feedback

Terminal interaction uses a dark contrast backdrop below the existing state ring so hover, pending, inspection, and committed-wire endpoints remain readable against bright and dark component surfaces. The state layers are visual-only and use `depthTest: false` with explicit render order.

Committed-wire highlighting keeps the canonical wire geometry unchanged. It adds a dark backdrop line under the gold highlight and a gold ring around the two canonical endpoints. Pending-wire preview remains a separate uncommitted three-point ghost. No feedback layer creates, removes, or validates a connection.

The committed route still uses exactly 8 points. Wire highlight membership still requires the canonical wire ID and the same unordered endpoint pair. Layout transforms and LOD refreshes recompute the route and increase the existing geometry revision. Context loss clears pending/highlight interaction state before restore.

## Canvas diagnostics

No public scene method was added or changed. The following canvas datasets expose render diagnostics for integration and contracts:

| Dataset | Value / meaning |
| --- | --- |
| `data-scene-component-visual-profile` | `conceptual-components-v1` |
| `data-scene-component-visual-feature-count` | Number of registered conceptual silhouette/marking features currently mounted |
| `data-scene-component-visual-kind-count` | Number of distinct component `visualKind` values represented by registered features |
| `data-scene-component-marking-count` | Number of registered features whose role is `marking` |
| `data-scene-terminal-feedback-profile` | `contrast-rings-v1` |
| `data-scene-terminal-contrast-affordance-count` | Number of mounted terminal contrast backdrops |
| `data-lab-terminal-contrast-feedback` | `none` or an ordered composite of active `pending`, `inspection`, `hover`, `committed` states |
| `data-lab-committed-wire-endpoint-feedback-count` | Number of committed-highlight endpoint rings currently active; normally 0 or 2 |
| `data-lab-wire-highlight-feedback` | `none` or `contrast-line+endpoints` |

Existing diagnostics remain authoritative for their previous scope, including `data-scene-visual-profile="conceptual-r3-fidelity-v2"`, `data-scene-cad-mapping="none"`, `data-scene-electrical-authority="none"`, the committed wire route mode/count, and geometry revision.

## Lifecycle contracts

`tests/scene3d-visual-fidelity-contracts.js` checks the component provenance, mounted visual inventory, terminal contrast inventory, committed endpoint feedback, pending/inspection layering, transactional invalid input, and cleanup back to the legacy inventory.

`tests/scene3d-contracts.js` keeps the existing route/identity/revision contracts and adds the new feedback lifecycle to canonical highlight, pending state, context loss, and disposal.

The browser contracts are intended for the project browser harness. This worker scope validates syntax/imports and pure model assumptions without launching the full Chromium suite.
