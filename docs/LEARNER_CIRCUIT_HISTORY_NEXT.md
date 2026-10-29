# Learner circuit history — integration contract

`src/learner-circuit-history.js` provides bounded in-session undo/redo for the
canonical learner graph produced by `circuit-router`. It stores exact graph
snapshots, including each wire ID and `nextWireId`; it does not rebuild a graph
from a reference sample and does not infer that a learner performed an action.

Undo/redo changes only the learner graph represented by the application. It is
an explicit user request to restore a previous/next in-app netlist. It does not
mean a physical wire was removed, reconnected, measured, or otherwise undone on
real hardware.

## Model API

The module exports:

```js
createLearnerCircuitHistory({ lessonId, circuit, maxSteps? })
resetLearnerCircuitHistory(session, { lessonId, circuit, expectedRevision })
recordLearnerCircuitHistory(session, {
  lessonId,
  currentCircuit,
  nextCircuit,
  expectedRevision,
})
undoLearnerCircuitHistory(session, {
  lessonId,
  currentCircuit,
  expectedRevision,
})
redoLearnerCircuitHistory(session, {
  lessonId,
  currentCircuit,
  expectedRevision,
})
inspectLearnerCircuitHistory(session)
```

`create`, `reset`, and `record` return a new immutable history session. A
no-op `record` returns the same session so a refresh cannot fabricate a history
step. `undo` and `redo` return this exact shape:

```js
{ session, circuit }
```

`session` is the already-moved immutable history state. `circuit` is the exact
canonical target snapshot that the host must explicitly apply. The host must not
record that application a second time.

`inspectLearnerCircuitHistory(session)` returns a frozen read-only snapshot:

```js
{
  lessonId,
  revision,
  maxSteps,
  undoDepth,
  redoDepth,
  canUndo,
  canRedo,
  circuit,
}
```

The default history bound is 32 previous graphs and the hard maximum is 64.
Every state-changing operation advances `revision`; callers must submit the
current `expectedRevision`. A stale callback therefore fails instead of applying
an undo/redo decision calculated for an older graph.

## Canonical graph boundary

Every graph entering history is validated against the exact shape returned by
`createCircuit(lessonId)` and then passed to `analyzeCircuit(lessonId, graph)`.
This keeps `circuit-router` as the electrical/topology authority. History adds
only lifecycle checks: lesson identity, exact own fields, standard object/array
prototypes, bounded stacks, immutable snapshots, revision matching, and an
exact current-graph check before record/undo/redo.

The history module never calls `createSampleCircuit`. A reference graph can
enter learner history only after the learner explicitly presses the existing
"Mạch mẫu" control, where `wiring-workbench` produces that canonical graph as a
real editable learner mutation and the host records it through the same central
mutation path. Normal history creation must start from the existing learner
graph or `createCircuit(lessonId)` when that learner graph is still empty.

## Host ownership and per-lesson lifecycle

The application should keep history sessions in a `Map` keyed by lesson ID,
alongside its existing per-lesson learner graphs. A normal lesson switch should
not erase another lesson's history; returning to that lesson should expose the
history for the same preserved learner graph.

`applyCanonicalCircuit` is the shared host mutation entry for 2D, 3D, and
Explorer edits. Its integration should follow this sequence:

1. Read the current canonical learner graph for the lesson. Use the stored
   learner graph when present, otherwise `createCircuit(lessonId)`. Do not use a
   display/reference fallback.
2. Get or create that lesson's history session from the same current learner
   graph.
3. For an ordinary real learner mutation, call
   `recordLearnerCircuitHistory(...)` before replacing the graph in
   `state.circuitModels`.
4. Apply the canonical graph and run the existing refresh/invalidation path.
5. Send `inspectLearnerCircuitHistory(session)` to the mounted workbench with
   `setHistoryState(...)`.

Explicit undo/redo is slightly different because the history movement happens
first. The callback handler should:

1. Verify the callback lesson and `expectedRevision` through the history API.
2. Call `undoLearnerCircuitHistory` or `redoLearnerCircuitHistory` using the
   current canonical learner graph.
3. Store `result.session` in the per-lesson history map.
4. Apply `result.circuit` through `applyCanonicalCircuit` with an internal
   `already-rewound`/equivalent flag so the central path does not call `record`
   again for that same transition.
5. Refresh `setHistoryState(inspectLearnerCircuitHistory(result.session))`.

`resetLearnerCircuitHistory` is for a deliberate context replacement that must
invalidate the old timeline. It is not needed for an ordinary lesson switch
when the learner graph and its per-lesson history remain stored together.

## Wiring workbench controller contract

`mountWiringWorkbench(host, lessonId, options)` accepts three optional history
integration fields:

```js
{
  historyState: inspectLearnerCircuitHistory(session),
  onUndo({ lessonId, expectedRevision }) { /* host-owned action */ },
  onRedo({ lessonId, expectedRevision }) { /* host-owned action */ },
}
```

The returned controller adds:

```js
controller.setHistoryState(inspectLearnerCircuitHistory(session))
```

The undo/redo buttons are native `<button type="button">` controls with ARIA
labels and an enforced 44 × 44 px minimum target. Native button activation gives
mouse/touch plus Enter/Space keyboard behavior. The controls only issue the
callbacks above after explicit activation; they do not change the local circuit,
call `circuit-router`, synthesize a learner event, or infer electrical validity.
After the host applies a returned graph, the existing `setCircuit(...)` path
remains responsible for reconciling the 2D workbench with the shared canonical
graph.

## Contract coverage

`tests/learner-circuit-history-contracts.js` covers immutable creation,
connect/disconnect/record/undo/redo, exact `wire.id` and `nextWireId`
restoration, round trips for every supported base/extended lesson, sample/clear
snapshots supplied explicitly by the caller, branch invalidation after undo,
bounded history, stale revisions, same-lesson foreign graphs, cross-lesson
graphs, forged/unbranded sessions, custom prototypes, prototype-name terminal
inputs, unsupported lessons, rejection of extra action/provenance fields, and
callback-only/44 px/ARIA workbench history controls in a narrow fake-DOM test.
