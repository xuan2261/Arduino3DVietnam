# Sketch evidence → Inspector read-only action

## Scope

`renderSketchReview()` can optionally expose a native button beside a validated
`lesson-terminal` call from the existing static Sketch pin evidence. The action
is a host-owned navigation hook into the existing terminal Inspector. It does
not change the static evidence model and does not create learner circuit state.

The integration API is additive:

```js
renderSketchReview(document, inspection, {
  pinEvidence,
  onInspectTerminal(terminalId, lessonId) {
    // Host decides whether the current lesson/context is still active, then may
    // delegate to its existing read-only Inspector navigation.
  },
});
```

The callback receives exactly two values from already validated evidence:

1. the canonical lesson terminal ID such as `D13` or `A0`;
2. the current integer lesson ID `1..16` from the matching Sketch inspection.

The renderer never accepts a caller-supplied terminal ID for an action.

## Opt-in behavior

The historical two-argument call remains read-only:

```js
renderSketchReview(document, inspection);
```

Passing only `{ pinEvidence }` also remains read-only. No button is rendered
unless `onInspectTerminal` is a function.

When the callback is supplied, an action is rendered only for a displayed call
whose validated status is exactly `lesson-terminal`. `unknown` and
`not-in-lesson` calls never receive an action. The existing 32-row evidence cap
also caps the number of possible actions.

Each action is a native `button` with `type="button"`, a minimum 44 × 44 px target,
and these stable attributes:

- `data-sketch-pin-inspect-terminal="D13"`
- `data-sketch-pin-inspect-lesson="2"`
- `data-sketch-pin-inspect-call="1"`

The accessible name identifies the terminal and lesson and explicitly describes
the action as read-only Inspector navigation. Dynamic evidence text continues to
use `textContent` only.

## Safety and authority boundary

The action depends on the same fail-closed evidence validation that already
requires:

- `pinEvidence.lessonId === inspection.lessonId`;
- canonical Uno pin IDs from the lesson terminal set;
- a `lesson-terminal` call whose literal/API mapping is internally consistent;
- `circuit-router:listTerminals` provenance;
- every compile, execution, circuit, connection, completion and mastery claim to
  remain false.

The renderer additionally validates `onInspectTerminal`: if present and non-null,
it must be a function. Unknown option properties, including symbol or
prototype-like own properties, are rejected.

Clicking the button only invokes `onInspectTerminal(terminalId, lessonId)`. The
renderer has no circuit mutation, wire creation, compiler, firmware execution,
simulation run, completion, or mastery path. The prime integration owner can
route the callback to the existing `inspectTerminalReadOnly` flow after checking
that the app still shows the same lesson.

## Focused contracts

`tests/sketch-review-ui-contracts.js` verifies:

- two-argument and pin-evidence-without-callback modes expose no buttons;
- one native 44 px action is created per displayed direct lesson-terminal call;
- callback arguments are exactly canonical terminal ID + current lesson ID;
- unknown and not-in-lesson calls never receive actions;
- forged lesson/context, claims, counts, statuses, literal mapping and provenance
  fail before an action can run;
- all 16 lesson contexts reject foreign-lesson pin evidence;
- prototype-like options and invalid callback types fail closed;
- Unicode/XSS-like unknown argument text stays literal text and cannot create an
  action or DOM node;
- 40 valid calls render at most 32 rows and 32 actions.

Focused validation is intentionally Bun/fake-DOM only in this worker scope; the
prime owns app hookup and integrated browser evidence.
