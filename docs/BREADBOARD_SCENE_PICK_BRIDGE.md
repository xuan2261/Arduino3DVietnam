# Breadboard 3D scene pick → native hole picker bridge

## Purpose and authority boundary

This bridge lets a verified **3D edit-mode pointer pick** select an existing
terminal-strip hole in the native Breadboard Study picker. It is deliberately
selection-only.

It does **not**:

- call `placementSession.assign()`;
- create a circuit-router edge;
- connect or disconnect any learner wire;
- infer a hole from 3D proximity;
- accept breadboard rail IDs from the scene;
- claim physical contact, CAD accuracy, fit, voltage, current, or placement.

The existing **Gán lỗ** button remains the separate explicit placement gate.

## Mount API

`mountBreadboardStudy()` keeps its existing options and adds two optional hooks:

```js
const study = mountBreadboardStudy({
  getLayout,
  getLessonTerminals,
  getSceneEditActive: () => true, // prime-owned stage/edit authority
  onHoleSelectionChange(selectionOrNull) {
    // observer only; no placement authority
  },
  doc,
});
```

If `getSceneEditActive` is omitted it defaults to `false`, so scene picking is
disabled. If `onHoleSelectionChange` is omitted it is a no-op. If either supplied
value is not a function, mount fails closed.

The returned controller adds:

```js
study.pickHoleFromScene(
  holeId,
  frozenMeta,
  expectedLessonId,
  expectedProfileId,
);

study.getHoleSelection();
```

Existing methods and native placement behavior remain unchanged.

## Final scene handshake

The scene metadata contract coordinated with the 3D worker is exact:

```js
Object.freeze({
  source: "pointer",
  physicalVerified: false,
});
```

The bridge requires exactly those two **own data fields**. It rejects:

- non-frozen metadata;
- arrays or custom/inherited prototypes;
- getters/setters/accessors;
- symbol keys;
- missing or extra fields;
- `source !== "pointer"`;
- `physicalVerified !== false`.

The bridge reads property descriptors before values, so a forged accessor is
rejected without executing its getter.

Lesson, profile, and hole identity are intentionally **not duplicated in meta**.
They are checked independently through `holeId`, `expectedLessonId`,
`expectedProfileId`, the current native lesson context, the placement-session
context, and the current profile control.

## Acceptance checks for a scene pick

`pickHoleFromScene()` accepts a pick only when all of these remain true at call
time:

1. the Breadboard Study controller is not disposed;
2. the full native hole picker is mounted;
3. `holeId` is an exact uppercase terminal-strip ID `A1..J63` — no trimming,
   case folding, rail IDs, leading zeroes, or foreign text;
4. `expectedLessonId` is integer `1..16` and matches both the latest
   `getLessonTerminals()` lesson and the normalized placement-session lesson;
5. the lesson is enabled and still has the same canonical terminal
   `id/component` vocabulary as the placement session;
6. `expectedProfileId` is one of the two supported profiles and matches both the
   current profile control and normalized placement-session profile;
7. `getSceneEditActive() === true` exactly;
8. `createBreadboardHoleGridPage()` can identify the page containing the hole;
9. `pickBreadboardGridHole()` accepts the exact hole on that page.

Every rejection returns a frozen receipt:

```js
{
  accepted: false,
  reason: "...",
  selection: null,
}
```

Validation is completed before native selection state is changed. Stale lesson,
profile, edit-off, forged meta, unsupported lesson, foreign hole, or canonical
terminal-context mismatch therefore leaves the input, page, contact selection,
authored placement, and observer unchanged.

## Accepted scene selection

For an accepted hole the bridge:

1. deterministically finds the containing native grid page through
   `createBreadboardHoleGridPage()`;
2. obtains the canonical selection through `pickBreadboardGridHole()`;
3. moves the native grid to that page;
4. writes the hole to `#bbPlaceHole`;
5. refreshes native `aria-pressed` state;
6. refreshes the existing profile contact-group visualization;
7. announces that this is a read-only/input-only selection and that **Gán lỗ**
   is still required to create a placement;
8. notifies `onHoleSelectionChange(selection)`.

The accepted receipt is frozen:

```js
{
  accepted: true,
  reason: "selected-input-only",
  selection,
}
```

`selection` is a frozen projection containing at least:

```js
{
  origin: "scene" | "native-grid" | "native-rail",
  lessonId,
  profileId,
  holeId,
  page,
  row,
  column,
  railId,
  index,
  nodeId,
  selectionKind,
  claims: {
    inputValueOnly: true,
    placementCreated: false,
    circuitRouterMutated: false,
    physicalContactSimulated: false,
  },
}
```

`getHoleSelection()` returns this projection or `null`.

## Native picker observer and reset lifecycle

Accepted native strip and BB830 rail picker actions use the same observer channel:

- strip button → `origin: "native-grid"`;
- BB830 rail picker → `origin: "native-rail"`;
- 3D pointer bridge → `origin: "scene"`.

The observer is notified with `null` when an existing selection is invalidated by
lesson/profile/terminal-context reset, terminal/input changes, or another reset
path. Lesson/profile reset still retains the historical page/input reset
invariants. Dispose clears internal selection silently after listeners are
removed.

Observer exceptions are contained; they cannot gain placement authority or roll
the native picker into an automatic assignment path.

## Accessibility and mobile behavior

The bridge reuses the native grid. Existing hole buttons remain native
`type="button"` controls with minimum `44 × 44 px` hit targets. The chosen hole
gets `aria-pressed="true"`, and contact-group semantics continue through the
existing status/live-region and contact markers.

No hidden scene control, synthetic graph edge, or automatic Assign click is
introduced.

## Focused validation

`tests/breadboard-scene-pick-contracts.js` is a fake-DOM/Bun suite covering:

- exact public API and option validation;
- scene selection to a far page (`H57`) with native aria/contact updates;
- native strip and native BB830 rail observer notifications;
- lesson/profile selection clears;
- edit-off and stale lesson/profile rejection with no side effects;
- exact frozen pointer meta negatives including prototype/symbol/accessor cases;
- noncanonical/foreign/rail hole negatives;
- lesson 01 rejection;
- current terminal-context drift/accessor rejection;
- manual input invalidation;
- observer failure containment and no automatic placement.

This worker runs Bun/source checks only. Prime owns app hookup and exclusive
browser/E2E validation.
