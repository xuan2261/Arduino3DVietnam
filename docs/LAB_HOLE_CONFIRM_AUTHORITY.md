# Lab authored-hole confirmation authority

## Purpose

`mountLabEditor()` exposes a second, stricter public wiring entrypoint:

```js
ui.connectAuthoredHoleTerminals(from, to, meta, expectedLessonId)
```

It exists for an explicit current-lesson 3D edit confirmation after a separate breadboard-hole picker/mapping layer has already decided which two canonical lesson terminals the learner intends to connect. The LabEditor does not perform terminal-to-hole placement validation here.

The electrical authority remains unchanged. A valid request delegates to the existing `connectTerminals(from, to)` path, which calls the existing `circuit-router` learner graph and `onCircuitChange` flow. There is no second graph, no direct wire insertion, and no new activation path.

## Required active context

The request is accepted only when all of these are true:

- `expectedLessonId` is the exact current lesson;
- the lesson is one of the existing `circuit-router` wiring lessons (`2..16` except unsupported lesson 1);
- `from` and `to` are distinct canonical terminal IDs returned by the current lesson;
- a scene is attached;
- the LabEditor is open in the `3d` stage;
- the controller has not been disposed;
- metadata passes the exact contract below.

Stale lesson IDs, unsupported lesson 1, foreign terminal IDs, same-terminal requests, missing scene, inactive editor/stage, and invalid metadata return the existing frozen learner-link receipt with `accepted:false` and `committed:false`. These pre-delegation rejections do not call `onCircuitChange`, do not clear a pending first terminal, do not mutate scene pending state, and do not announce a new UI status.

## Exact metadata contract

`meta` must be a frozen ordinary object with `Object.prototype` and exactly these six own string data properties:

```js
{
  source: "authored-hole-confirm",
  physicalVerified: false,
  profileId,
  fromHoleId,
  toHoleId,
  placementRevision
}
```

No extra keys, symbols, getters/accessors, arrays, null/custom prototypes, or unfrozen objects are accepted.

`profileId` is limited to:

- `generic-63x10-terminal-strips`
- `busboard-bb830-rev7`

Each hole ID must match the canonical syntax `A1..J63`: row `A` through `J`, column `1` through `63`, with no leading zero. `fromHoleId` and `toHoleId` must be different. `placementRevision` is a nonnegative safe integer.

These checks validate only metadata shape, profile identity, and hole-ID syntax. They do **not** claim that a terminal is physically located at a given hole, that two hole coordinates are electrically equivalent, or that a real breadboard has been measured or verified. The receipt therefore continues to report `learnerGraphOnly:true` and `physicalVerified:false`.

## Delegation and receipts

After every guard succeeds, `connectAuthoredHoleTerminals()` calls the existing `connectTerminals()` implementation. Its existing frozen receipt is returned unchanged:

```js
{
  accepted,
  committed,
  reason,
  lessonId,
  fromId,
  toId,
  wireId,
  learnerGraphOnly: true,
  physicalVerified: false
}
```

A valid new pair commits exactly through `connectCircuit()`/`circuit-router`. A duplicate pair remains a router rejection/no-op; this API does not bypass duplicate-wire validation. Existing pending-terminal cancellation occurs only after the delegated canonical connection succeeds through the same path already used by tap/drag wiring.

The API does not create placement-history entries, does not validate or mutate conceptual layout placement, and does not alter layout undo/redo semantics.

## Lesson boundaries retained

Lesson 1 remains outside the LabEditor learner-circuit engine and is rejected as `unsupported-lesson`; this entrypoint cannot turn its manual-only learning flow into an automatically assessed graph.

Lessons 10 and 14 retain the existing `circuit-router` `signal-only` boundary. The LabEditor does not decide which authored practice step is eligible for a hole-confirm action. That availability remains owned by the separate authored placement/practice layer. In particular, lesson 10's three authored practice steps remain manual-only and opening the editor does not create any wire automatically. Lesson 14's first wiring step remains signal-only while its remaining steps remain manual. A wire explicitly committed through this entrypoint is still analyzed by the same router, so signal-only lessons remain `functional:false` and `ok:false`; no motor, pump, power/load, or physical-function claim is created.

## Direct contract coverage

`tests/lab-editor-precision-wires-contracts.js` keeps the existing exact **6 top-level checks**. The authored-hole cases are embedded in the existing sixth direct LabEditor check so the browser/Bun runner contract count does not change.

The direct fixture covers:

- fake DOM under Bun and the same path against native DOM when the runner supplies a browser document;
- a real learner graph commit with an exact frozen receipt and canonical `wireId`;
- stale lesson, foreign terminal, same-terminal, inactive stage, and missing-scene rejection before graph/callback effects;
- unfrozen, extra-key, accessor, symbol, custom/null-prototype, wrong-source, physical-claim, unknown-profile, malformed/same-hole, and invalid revision metadata;
- duplicate pair as a canonical router no-op;
- unchanged layout undo depth on graph commit;
- lesson 10 remaining signal-only with all authored practice steps manual-only and no automatic graph mutation;
- lesson 14 remaining signal-only with its existing wiring/manual step split;
- unsupported lesson 1 remaining manual-only and unable to acquire a learner graph.

No Chrome run, deployment, alternate graph engine, physical placement validator, or hardware claim is required by this API.
