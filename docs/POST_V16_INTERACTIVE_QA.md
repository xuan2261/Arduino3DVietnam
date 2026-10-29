# Post-v1.6 Interactive Wiring QA

## Scope

This document is the QA gate for the `feature/post-v16-interactive-breadboard-wiring`
candidate. It starts from the previously browser-green post-v1.6 baseline and adds
coverage for interactive guidance that is still deliberately bounded by the existing
canonical authorities.

The new surfaces are:

- 3D first-terminal pending-wire preview;
- eight-column breadboard hole picker and BB830 rail picker;
- Practice guidance for the next missing canonical pair;
- read-only 3D inspection from Practice and from the official UNO pinout table;
- the hardened module-branded practice-observation journal;
- release/offline packaging for the two new runtime modules and three new docs.

`circuit-router` remains the only electrical/netlist authority. Hole selection,
Practice guidance, pinout navigation, scene preview and observation UI must not create
or validate a physical/electrical learner action by themselves.

## Preserved baseline

The inherited candidate baseline had **359/359 browser checks passing** before this
phase. This worker does not run Chromium and therefore does not re-claim that number
for the current interactive candidate. Existing historical E2E check IDs are retained;
new checks are additive or strengthen an existing predicate without renaming it.

The post-v1.6 direct-contract baseline is also retained. Relevant current direct
contract totals are:

| Contract | Current total |
| --- | ---: |
| Practice observation model | 14/14 |
| Practice observation UI | 12/12 |
| Practice evidence model | 54/54 |
| Practice evidence UI | 21/21 |
| Practice wire guidance | 12/12 |
| Breadboard hole grid | 47/47 |
| Breadboard placement session | 22/22 |

The observation UI total is 12 after the private `WeakSet` provenance hardening.
The renderer describes events as reported by a caller to the module. It must not claim
that a host-only observer proved a user action.

## Truth boundaries

### Pending 3D wire preview

`scene.setPendingWireTerminal(id|null)` is a visual mirror of Lab Editor
`firstTerminal`. A pending terminal or ghost line:

- is valid only in an active 3D edit layout and for a canonical terminal;
- has `physicalVerified:false` and is not a committed wire;
- never increments `data-lab-wire-count`;
- never enters `labWireObjects` or invokes a connection callback;
- is cleared on edit exit, stage/layout clear, context reset/loss and dispose.

The E2E gate checks the first-terminal metadata and ARIA prompt through the real app.
The scene direct contract additionally locks the ghost-line source contract:
`kind:"lab-pending-wire-preview"`, `committed:false`, canonical hover target only,
and no wire/netlist mutation.

The app also captures non-bubbling `webglcontextlost` from the stable scene host and
revokes the Lab Editor first-terminal gesture. E2E arms D13 and uses the browser's
real `WEBGL_lose_context` extension to lose and restore the canvas WebGL context,
awaiting both events. This avoids fabricating a restoration event while the underlying
GPU context remains alive. After the loss clears pending/ghost metadata, E2E clicks
`R1:A` on restoration. `R1:A` must become a new first terminal and the learner wire
count must remain zero; a stale D13→R1:A connection is a P1 regression.

### Breadboard hole picker

`src/breadboard-hole-grid.js` provides canonical hole identities only. The picker is a
two-step flow:

1. choose a strip/rail hole, which only fills `#bbPlaceHole`;
2. explicitly press `#bbAssignHole`, which is the existing placement commit gate.

The terminal-strip picker pages 63 columns in groups of eight: page 1 is columns 1–8
with 80 native hole buttons; page 8 is columns 57–63 with 70. Hole buttons are native
`button` elements with minimum 44×44 CSS-pixel targets.

Generic breadboard rail topology remains unknown. Generic profile rail controls are
disabled and direct rail selection fails closed. `busboard-bb830-rev7` exposes exactly
four signed rail IDs (`P1+`, `P1-`, `P2+`, `P2-`), each with 50 profile-internal holes.
The `+/-` legend does not assert that a rail is powered.

Picker selection must not create placement, create a circuit-router wire, infer CAD/
scene coordinates, or simulate physical contact.

### Practice next-missing-terminal guidance

`inspectPracticeWireGuidance()` derives the first missing authored pair from the
canonical learner graph and the authored checkpoint order. The result is topology-only.
It does not assert physical wiring, safety, current/voltage, learner action, mastery,
completion or teacher validation.

The UI exposes `[data-practice-inspect-missing-terminal]` only when the target is the
first terminal of a proven authored missing pair and all evidence/guidance identities
agree. The action is explicit. On activation the app:

- closes 3D edit mode and revokes any pending first-terminal gesture;
- selects the exact canonical terminal for read-only Inspector/scene viewing;
- keeps the canonical learner graph unchanged;
- does not complete the lesson or create a wire.

Unsafe/foreign terminal IDs are rejected by the pure guidance validator and are never
promoted into a trusted Inspector action.

### UNO pinout → read-only 3D inspection

The manufacturer pinout table exposes a native `data-uno-pin-inspect` button only when
the exact pin ID is present in the current lesson terminal vocabulary. The action uses
the same read-only inspection path as Practice and therefore closes any pending edit
gesture without mutating the learner graph.

For lesson 02, `D13` is viewable. Official reference aliases such as `AREF`, `SDA` and
`SCL` remain documentation rows and must not gain a 3D action by alias inference when
their exact IDs are absent from the lesson terminal list.

### Practice observation provenance

The observation journal is a private module-branded in-session object. A JSON clone or
literal that merely resembles a journal is rejected. Rendered wording may say an event
was reported by the caller to the module; it must not claim a host-only observer proved
that the user performed an action.

The journal stores lesson/event pairs only. It does not store step attribution or a
timestamp, and lesson-level overlap is not evidence of the current step, mastery,
completion or a physical action.

## Browser regression matrix

| Area | Positive path | Fail-closed/reset path | Observable evidence |
| --- | --- | --- | --- |
| Pending wire | First terminal produces pending metadata/ARIA | stage/edit/canonical mutation clears pending | canvas pending datasets, zero wire-count side effect |
| Ghost preview | Canonical second-terminal hover may show visual line | same/foreign/no hover clears ghost | scene direct contract, `committed:false` |
| WebGL loss | pending D13 is revoked when canvas loses context | next R1:A click must not complete stale pair | context dataset + new pending ID + zero learner wires |
| Hole grid | 8 columns / 80 buttons on page 1 | page outside 1..8 rejected | grid datasets, bounded button count |
| Hole selection | keyboard/click fills `#bbPlaceHole` | no explicit assign means no placement | status `selected`, placement list unchanged |
| Generic rail | rail picker locked | rail pick rejected | disabled controls + pure negative contract |
| BB830 rail | exact four rails × 50 holes | forged rail/index rejected | `P1+1..P2-50`, no placement until assign |
| Practice missing terminal | explicit button opens read-only D13 | forged/covered/manual guidance has no button | edit off, pending cleared, graph unchanged |
| UNO pinout | exact D13 row has inspect action | AREF/SDA/SCL do not alias-map implicitly | pinout action selector + scene inspection status |
| Mobile 375 | picker/practice/pinout actions keyboard-operable | no document horizontal overflow | 44px targets, native Enter activation |
| Unsafe IDs | canonical IDs accepted | markup/prototype/NUL/foreign IDs rejected | pure model rejection, no injected DOM action |
| Offline | new modules/docs import/fetch after SW control | missing runtime module fails release build | offline dynamic imports + release unittest |

## Accessibility gate

`tests/accessibility-contracts.js` checks the integrated production DOM on lesson 02.
New requirements include:

- missing-terminal Practice action is a named native button, at least 44×44, bound to
  exact canonical `D13` for the initial lesson-02 checkpoint;
- practice observation says events were reported to the module and contains no
  `host-only`, `host app đã ghi nhận` or `người dùng đã thực hiện` assertion;
- UNO D13 inspect action is named, described by the physical-boundary note and at least
  44×44; AREF/SDA/SCL have no action unless their exact IDs exist in the lesson;
- hole picker is a named group with eight column groups and 80 named native buttons on
  page 1, each at least 44×44;
- grid status is polite, pagination controls have names and generic rail controls are
  disabled fail-closed.

These checks are bounded DOM/accessibility contracts, not a claim of full WCAG or
screen-reader conformance.

## Mobile 375 gate

At 375×812 the E2E suite additionally checks:

- document width stays within the viewport while the eight-column grid scrolls inside
  its own panel;
- all 80 page-1 hole buttons retain minimum 44×44 targets;
- keyboard Enter on `A1` only fills the hole input and creates no placement/wire;
- the Practice missing-terminal button is at least 44×44 and is bound to D13;
- D13 pinout inspect is at least 44×44, works by keyboard, clears a pending edit gesture
  and preserves the learner graph;
- alias rows AREF/SDA/SCL expose no implicit inspect action in lesson 02.

## Release and offline contract

The protected first **102** release paths remain unchanged. Their ordered path-list
SHA-256 is:

`d6eafc58683be16f50559fa5af1bf212537578b16b846b86973777ad8944ce87`

`POST_V16_GUIDED_WIRING_FILES` is exactly, in order:

1. `src/breadboard-hole-grid.js`
2. `src/practice-wire-guidance.js`
3. `docs/BREADBOARD_HOLE_PICKER_NEXT.md`
4. `docs/PRACTICE_WIRE_GUIDANCE_NEXT.md`
5. `docs/SCENE_WIRE_PREVIEW_NEXT.md`

The candidate therefore has **107 public allowlisted files** and **108 dist files** when
the generated marker is included. The service-worker precache must exactly mirror the
release allowlist order, excluding `sw.js` and including `./`.

Release tests also require:

- `breadboard-topology-ui.js` imports `breadboard-hole-grid.js`;
- `practice-evidence.js` imports `practice-wire-guidance.js`;
- the hole-grid model does not import `circuit-router` or scene geometry;
- practice wire guidance imports canonical `circuit-router` and authored checkpoints,
  while remaining DOM/scene independent;
- deleting either new runtime module from a release fixture makes build fail closed;
- offline browser verification imports both new modules and fetches all three new docs.

## Non-browser validation for this worker

This worker may run only selective static/Python/Bun gates. Required pre-handoff checks:

```text
python -c "compile(open('tests/e2e_browser.py', encoding='utf-8').read(), 'tests/e2e_browser.py', 'exec')"
python -m unittest tests.test_release -v
```

Direct Bun contracts should confirm the current observation, Practice guidance/UI and
hole-grid totals. `tests/accessibility-contracts.js` may be parsed/imported with Bun,
but its geometry/focus assertions require the real browser E2E run.

## Current QA status

- Inherited browser baseline: **359/359 PASS** before this interactive phase. It is
  preserved as historical evidence only.
- No Chromium run is performed by worker-19 in this phase.
- `tests/e2e_browser.py` compiles successfully. Static scan finds **262 literal E2E
  check IDs with no duplicate literal names** after this phase; the runtime total is
  intentionally left to the final Chromium run because loop-generated checks are not
  represented by that literal count.
- `tests/accessibility-contracts.js` imports/parses successfully in Bun. Its DOM/layout
  assertions are not claimed as executed until the browser suite runs.
- Current direct-contract totals used by the E2E gate are aligned with the integrated
  source: observation **14/14**, observation UI **12/12**, Practice evidence model
  **54/54**, Practice evidence UI **21/21**, Practice wire guidance **12/12** and
  breadboard hole grid **47/47**. The historical E2E check ID
  `post-v16-practice-evidence-16-lesson-pure-contracts` is unchanged; only its strict
  expected total moved from 52 to the verified additive 54.
- `python -m unittest tests.test_release -v` passes **23/23**, including exact 107-file
  manifest/SW alignment and fail-closed missing-runtime fixtures for the two guided-
  wiring modules.
- Prime's **local exclusive Windows Chromium** run after source/test freeze completed
  **375/375 PASS**, no failed checks, zero unexpected console warnings/errors, and
  zero browser GPU diagnostics. The report is
  `screenshots/post-v16-interactive-breadboard-e2e.json` (local, not public release
  material). The WebGL-loss regression uses real `WEBGL_lose_context` loss/restore
  events with an event-loop boundary, and proves the post-restore next terminal
  cannot silently connect to the pre-loss pending first terminal.
- Final local bounded direct JS contracts: **606/606 PASS**; Python unit discovery:
  **94/94 PASS**. These numbers establish local QA only, not GitHub CI or permission
  to deploy the interactive candidate. Exact-SHA compiler/browser/release-preflight
  workflow evidence is still required after the candidate is committed and pushed.
