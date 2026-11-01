# 2D committed-wire endpoint reroute

## Scope and authority

The 2D wiring workbench can prepare and confirm a change to **one endpoint of
one already-committed learner wire**. The workbench does not add a second
electrical model. `circuit-router.js` remains the only topology authority:

- the current wire must still be an exact canonical learner-graph member;
- the proposed target must be a canonical terminal for the current lesson;
- preview, hover, focus and SVG geometry do not mutate the learner graph;
- only explicit **Confirm** may publish a replacement graph;
- the feature makes no claim about a physical jumper, breadboard contact,
  measured voltage/current, hardware safety, or millimetre/CAD accuracy.

The host continues to own learner history and cross-view reconciliation through
the existing `onChange(model, analysis)` callback. The workbench publishes one
final router-produced graph; it never publishes an intermediate disconnected
graph.

## Native UI contract

Each committed wire row exposes one exact-ID action:

```text
[data-wire-reroute-start="wN"]
```

Starting an edit opens one native reroute group. Stable hooks are:

```text
[data-wire-reroute-anchor="from"]
[data-wire-reroute-anchor="to"]
[data-wire-reroute-target]
[data-wire-reroute-confirm]
[data-wire-reroute-cancel]
```

The workbench host mirrors only transient proposal diagnostics:

```text
data-wire-reroute-mode="preview" | "off"
data-wire-reroute-wire-id="wN"        # present only while preview is current
data-wire-reroute-target="<terminal>" # empty until a target is selected
```

The reroute editor has `role="group"` and an accessible name. Its status text
uses `role="status"` + `aria-live="polite"`. Anchor buttons expose
`aria-pressed`; Confirm exposes `aria-disabled` and remains disabled until the
proposal is valid. The target is a native `<select>`. Reroute buttons inherit
the existing minimum 44 × 44 CSS-pixel `.wire-action` target; the target select
also has `min-height:44px`. Mobile CSS allows the anchor/action buttons to wrap
rather than forcing horizontal overflow.

Focus behavior is deliberate:

1. **Sửa đầu dây** focuses the default `from` anchor.
2. Choosing an anchor focuses the target select.
3. **Hủy sửa** restores focus to the exact current reroute-start button for the
   same wire when that action still exists.
4. Successful Confirm focuses the existing learner-history Undo button so the
   newly published graph change has an immediate keyboard recovery path.
5. `Escape` while the reroute editor is active cancels the proposal.

## Proposal lifecycle

Starting a reroute snapshots the exact current context:

```text
lessonId
wireId
original from/to endpoints
anchor endpoint
target (initially null)
historyState.revision
exact current circuit object
```

The proposal is considered current only while all of those identities still
match. The controller re-resolves `wireId` against the current graph and rejects
ID reuse with different endpoints.

The default anchor is the wire's `from` endpoint. Selecting the other anchor
clears any previously selected target. Selecting or clicking another canonical
terminal only updates proposal state. It does not call `connectCircuit`,
`disconnectCircuit`, `notify`, history, progress or lesson completion.

A valid target must:

- be a canonical terminal in the same lesson;
- differ from the fixed anchor;
- differ from the old endpoint being replaced, so an unchanged route is not a
  mutation;
- not create a direct edge that already exists elsewhere in the current graph.

Self-target, same-route and duplicate-edge proposals remain visible as
explanatory UI but Confirm stays disabled and the learner graph is unchanged.

## SVG preview and pointer behavior

The visual proposal is a single dashed SVG path:

```text
[data-wire-reroute-preview]
```

Its runtime metadata marks it as
`kind:"committed-wire-reroute-proposal"`, `committed:false`, and
`electricalAuthority:false`. It is not counted as a canonical learner wire.

During reroute mode, pointer drag may begin only from the selected anchor
terminal. Pointer movement updates a transient ghost. Pointer release over a
different canonical terminal proposes that terminal as the target; it still
does not commit. `pointercancel` and `lostpointercapture` clear only the
transient drag ghost and leave the explicit proposal available. The canonical
graph remains unchanged until Confirm.

Normal two-terminal wiring and authored-pair suggestion previews stay separate
from reroute mode. Entering one of those flows clears incompatible transient
reroute state rather than combining multiple pending wiring intents.

## Confirm is one atomic router mutation

Confirm first revalidates the current proposal, then computes candidate graphs
without publishing the intermediate state:

```js
without = disconnectCircuit(circuit, wireId)
next = connectCircuit(without, anchor, target)
```

The workbench accepts the result only when:

- the router produced a new wire record;
- the new ID differs from the old committed wire ID;
- the new wire endpoints are exactly `anchor -> target`;
- the total committed-wire count is unchanged.

Only after those checks does the workbench replace its local `circuit`, clear
all reroute/pointer transient state, and call `notify()` **once**. `notify()`
then invokes the existing host `onChange(changedCircuit, changedAnalysis)` once.

The router owns the new ID. For example, replacing `w1` does not preserve the
string `w1`; a later router ID such as `w3` may be produced depending on
`nextWireId`. No UI layer may manufacture or recycle an ID merely to keep a
visual row stable.

In the current application host, that one `onChange` enters
`applyCanonicalCircuit()`. Consequently the confirmed 2D reroute becomes one
ordinary learner-graph history step. Existing Undo/Redo restores exact graph
snapshots, including wire IDs and `nextWireId`; reroute itself owns no second
history stack.

## Fail-closed stale-state boundaries

The proposal is revoked without a graph write when its host context becomes
stale:

- `setHistoryState(...)` receives a different history revision;
- `setCircuit(...)` reconciles any canonical graph, including a same-lesson
  replacement from another view;
- the stored circuit identity, lesson, exact wire endpoints or anchor no longer
  match;
- the exact wire ID no longer exists;
- sample/clear/undo/redo or another graph mutation supersedes the proposal;
- the workbench is disposed.

Cross-lesson `setCircuit(...)` is rejected before the current workbench graph is
replaced. Exact IDs are required: `w1` and `w10` are different wires and are
never prefix-matched.

Disposal clears reroute state, detaches reroute/pointer listeners and removes
the workbench DOM. Detached stale controls cannot publish a later mutation.

## Cross-view behavior

The reroute feature deliberately reuses the existing host mutation pipeline
instead of creating a new callback. After Confirm, `applyCanonicalCircuit()`
records the learner-history transition and `refreshCircuitViews()` reconciles
the other projections from the new canonical graph. This includes the Lab
Editor, 3D wiring projection, Explorer/Breadboard views, history controls and
the currently mounted 2D workbench.

Pre-confirmation proposal state is local to the 2D workbench. It is not a 3D
wire selection, Practice completion signal, electrical validation result or
hardware action.

## Signal-only and educational boundaries

Lessons that are intentionally `signal-only` remain `signal-only` after a 2D
reroute because analysis still comes from the same `circuit-router`. A visually
complete signal path does not become proof of motor/pump power, external
hardware behavior, learner mastery or teacher validation.

## Offline/release consequence

The runtime feature modifies existing `src/wiring-workbench.js` and
`styles/wiring.css`, which are already part of the release allowlist and Service
Worker cache. No new runtime module is required. The build's content-addressed
cache changes when those packaged bytes change.

This new documentation file is a separate artifact. It is not automatically a
public/offline asset merely because it exists under `docs/`; release ownership
must explicitly add it to both the build allowlist and Service Worker asset list
if publication/offline access is desired.

## Deterministic non-browser contracts

`tests/scene-wiring-contracts.js` exercises the 2D controller with a fake DOM
and no browser. The reroute coverage preserves all historical wire-highlight
checks and additionally verifies:

- native selectors, ARIA/live-region and focus behavior;
- preview/ghost nonmutation and explicit non-authority metadata;
- Cancel with graph preservation and focus recovery;
- one successful router-generated replacement and exactly one host change;
- self-target, duplicate edge and stale wire rejection;
- history-revision invalidation;
- same-lesson `setCircuit` invalidation and cross-lesson rejection;
- pointer-cancel cleanup without graph publication;
- exact `w1` versus `w10` identity;
- disposal cleanup and detached-control inertness;
- source-level guards that preview code has no router/notify authority and
  Confirm performs one disconnect -> connect -> notify transaction.

These contracts verify model/controller behavior only. They are not evidence of
real pointer geometry, browser rendering, physical wiring, or hardware safety.
