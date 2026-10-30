# Arduino 3D Việt Nam — post-v1.6 interactive learning phase

**Workspace:** `C:\Work\Arduino3DVietnam` (CoS: `/arduino3dvietnam`).

**Starting feature SHA:** `09d8635b3dd76ab18d971ccd4bcd2285c021ac3f`.
**Protected production:** `main` and peeled `v1.6.0` at
`341449b12d50c681be3f04d6e291965bf6015d99`. No Pages, tag,
Draft Release, firmware, toolchain or backup writes are authorized.

## Product acceptance scope

1. **Pointer-to-pointer 3D wiring:** a terminal press/drag/drop gesture
   sends only validated terminal-pair intent to the canonical Lab Editor
   controller. `src/circuit-router.js` alone owns accepted learner wires.
   Invalid drops and cancel/lost-capture/lesson changes must leave the learner
   graph unchanged. Existing two-tap and keyboard/HTML paths remain.
2. **Precision wire editing:** the 3D Lab Editor exposes every committed
   learner edge and permits removing its exact wire ID, with focus-visible
   native controls and unchanged learner/reference isolation. Undo/redo and
   2D/3D projections read the same canonical graph.
3. **48-step learning trail:** lesson-authored checkpoint text and canonical
   learner-pair overlap are visualized for all 16 Vietnamese lessons. A
   manual step stays explicitly unassessed; sample/reference edges are never
   mistaken for learner actions. Navigation is not lesson completion.
4. **Sketch→Inspector:** direct literal pin evidence links to an exact
   lesson terminal as a view-only action after lesson/draft revalidation.
   Neither source scanning nor inspecting a terminal compiles Sketch, writes
   a wire, executes firmware, verifies hardware or grants progress.
5. **Timer2 bounded conformance:** mode expansion is permitted only after
   matching exact pinned avr8js sources and passing explicit positive/negative
   register and interrupt model tests. CTC/PWM/physical/stock-core parity must
   never be inferred from Normal-mode compare support.

## Four reference families and decisions

- `sources/codex-howto/assets/atelier/guided` at pinned reference SHA:
  source-derived step framing/evidence and accessible fallback, **not** native
  code execution or permission to copy unrelated assets.
- `https://learn-arduino-red.vercel.app` is a 16-lesson UX reference;
  published content does not prove a real compiler or authorize reuse.
- `sources/learn-arduino-button-kr` informs tap/socket affordances only;
  its hard-coded game validator is not a circuit engine.
- `sources/learn-microcontroller` represents the same Learn Arduino family
  as the live site, not an independent proof of electrical accuracy.

## Boundaries that remain mandatory

- The complete 16-lesson/48-checkpoint content and pinned source firmware
  remain unchanged. `circuit-router` is the only electrical authority.
- Pending/ghost wiring, authored missing pairs, sketches, history and
  observation journal cannot create or validate a physical connection.
- Logical-grid scene placement is **not** a mounting/CAD/breadboard-hole
  coordinate transform. In A000066 evidence, one lower-left X dimension
  remains unknown; no inferred value or mechanical fit claim is permitted.
- Timer2 and resistor/DC models are explicit supported subsets only.
- Learner/ref graph separation, real-HEX SHA checks, module-private observation
  branding and explicit quiz completion are preserved.
- Any source assets with unverified redistribution rights stay under
  `sources/`, outside public allowlists, Service Worker and `dist/`.

## Verification ledger (fill only from observed evidence)

| Gate | Evidence |
| --- | --- |
| Source baseline | `09d8635` was clean; Bun 854/854, Python 97/97, Windows/Ubuntu Chromium 416/416, three same-SHA GitHub Actions success |
| New source and feature contracts | **Bun 896/896 PASS** over 36 model/UI suites, including 16/16 trail, 14/14 trail UI, 6/6 precision wire, 23/23 Sketch review UI and 16/16 Timer2 subset; Python full discovery **100/100 PASS** |
| Release tests + build | **29/29 PASS** after new exact upstream Timer2 blobs and tamper checks, 136 allowlisted public/SW assets and **137** dist files including generated marker; first-party literal local import-graph check positive+missing-module negative; verified 75 static/literal source import references |
| New canonical 3D/2D/Sketch/48-step browser interactions | **Windows Chromium 439/439 PASS, 0 FAIL**, no console errors/warnings/GPU diagnostics after source/test freeze; `screenshots/post-v16-rich-interaction-frozen-full-20261029.json`, generated 2026-10-29 16:26:24 +07. All source/test paths were older than the report. Earlier aborted candidate attempts were not counted |
| 375px, native 44px targets, keyboard/ARIA, WebGL lifecycle | **PASS** in complete Windows Chromium. Separate real-pointer smoke confirmed 5V→LDR:A ghost-before-release, one committed edge, cancel/drop-outside no edge; separate 375px probe confirmed all native checkpoint/Sketch/precise-wire controls >=44×44 with no horizontal overflow |
| Historical E2E checks | **289/289** calls from `f682fce` preserved; **303/303** calls from `09d8635` preserved; current candidate has no duplicate static IDs, and old dynamic check expressions are unchanged; independently parsed by Python AST |
| Packaging / Service Worker | Protected original 126-path order SHA256 `5751e23a18571c69d942d8c4979adf70e9d29e2acdaf935d074ababcfb6463ad`; **136 public/SW and 137 dist**. Two newly appended MIT upstream Timer2 TS source-reference assets are byte-pinned SHA-256 + exact Git blob at commit `bee6f0a…`, without changing executable avr8js or HEX |
| Independent P0/P1 | Auditor31 found 2 P1 (canceled drag leaves two-tap armed; native Remove loses keyboard focus). Workers24/25 repaired with negative tests; independent worker22 re-reviewed exact fixes and issued scoped **GO/no P0/P1**. Auditor30 found 2 P1 (Timer2 docs drift; upstream timer provenance not reproducible). Prime verified and pinned exact MIT timer source blobs, added manifest/SW/build tamper checks, updated docs; auditor30 independently recomputed local bytes and issued scoped **GO/no P0/P1**. Neither GO authorizes production |
| New commit, push and same-SHA manual CI | Not yet done for this phase |

No test `PASS` on a previous commit proves the candidate after changed source.
This QA ledger was updated **after** the successful local full Chromium
run; the changed bytes are documentation only, not application/test code.
Rebuild and rerun release contracts for this ledger, then require the new
same-full-SHA manual Chromium CI to validate the exact committed package.
Feature-branch compiler, Chromium and read-only preflight are the only
pre-publication CI workflows authorized here. **Passing them will not
automatically authorize merging `main`, publishing a release or Pages.**

## Post-`9719fcb` product extension — authored 3D missing-pair guidance

This appendix documents the **next phase after** the 34-file commit
`9719fcbdc24f0608417bc259ab9f517e64b0973a`. The old ledger above
remains a dated receipt of the previous phase; its "Not yet done" commit/CI
row must not be read as the status of that already-pushed commit.

**User-visible feature:** Practice Evidence now exposes native, accessible
"Xem gợi ý trực quan 3D (chỉ đọc)" buttons only on canonical, human-authored
missing terminal-pair rows. Host integration revalidates the active lesson,
current learning step, exact authored checkpoint, the circuit-router terminal
IDs, and the **current learner draft's absence** of the pair before showing
anything. The Three.js guide is a separate dashed conceptual line over the
existing component/terminal layout, not a committed jumper or a physical
breadboard-hole mapping. A named 44 px dismiss control revokes the guide;
lesson/step/stage/editor changes, actual graph mutation and WebGL context
loss also clear its stale intent. No student progress, observation, mastery,
teacher validation or firmware state changes occur on preview.

This preserves the 16-lesson/48-checkpoint source, including **lesson 10 as
manual-only** and **lesson 14 as signal-only authored wiring**. No sample edge
is copied to the learner graph; only `src/circuit-router.js` remains the
electrical authority. The 3D layout's X/Z is logical, not measured mm/CAD,
and the A000066 lower-left X remains unknown.

### Verified development candidate gates

| Gate | Observed result |
| --- | --- |
| Native module/UI contracts | Bun **902/902 PASS**, 36 model/UI suites, including new Practice Evidence UI 36/36; Lab Editor precision 6/6 |
| Three.js browser-native contract | **175/175 scene runtime checks PASS**, expanded from 149; source checks also cover canonical guide membership, visual-only route, lifecycle and setWiring coexistence |
| Python/release | Python full discovery **100/100 PASS**; release **29/29 PASS** after source CSS update |
| Source packaging | **136** public allowlist/Service Worker assets, **137** generated `dist/` files; no new dependency, firmware, license or upstream-vendor modification |
| Chromium real browser | **454/454 PASS**, 0 failures, 0 console errors, 0 unexpected warnings, 0 GPU diagnostics; `screenshots/post-9719-authored-3d-guide-final-full-20261029.json`, SHA-256 `8888ad130e36af31ce6542fcdf67d8c0216794b98ea20516aaaac4b9a2063321` |
| Mobile/touch targets | Real viewport width **375 px**: native preview and dismiss targets at least **44×44 px**, no document horizontal overflow, real click/dismiss and zero learner wires |
| Historical E2E checks | Python AST compared `f682fce` **269 static +20 dynamic**, `09d8635` **283+20** and `9719fcb` **309+20** against the new source; all previous check expressions preserved, no repeated current static IDs |
| Independent P0/P1 | Auditor30 reviewed current live diff read-only after fixing an intercepted dismiss click and reported **no remaining scoped P0/P1**, static GO only |

Actual browser QA caught a real pointer-events problem: the existing
`.viewport-corner` was pass-through, so the new dismiss button's pointer
events initially reached the canvas. The final candidate enables hit-testing
only for `[data-authored-guide="view-only"]` and its native button. Browser
revalidation used ordinary clicks, never forced clicks. A separate test-only
assumption about lesson 10 was corrected against the authored source (lesson
10 has no wiring checkpoint; lesson 14 does). Earlier failed attempts were
not counted as PASS.

The final 454-check local Chromium report predates **this appendix only**;
the application JavaScript, CSS, HTML, Service Worker and E2E script are
unchanged after that run. The committed exact SHA will still require fresh
manual compiler, Ubuntu Chromium and read-only preflight CI receipts.
**No CI readiness statement in this appendix authorizes Pages, main, tag,
Draft Release, release publication, backup replacement or physical upload.**

## Post-`8d6e420` current phase — exact learner-wire read-only 2D highlight

This is a **new, distinct phase after clean commit `8d6e420`**. The dated
receipts above are intentionally left unchanged. This section records only the
current source-only work owned by `src/wiring-workbench.js`,
`tests/scene-wiring-contracts.js`, `styles/wiring.css`, and this appended
documentation section. Prime owns `app.js` hookup and any later browser/E2E or
release verification.

### Public API and product boundary

`mountWiringWorkbench(...)` now exposes:

```js
workbench.highlightCommittedWire(wireIdOrNull)
```

- A primitive canonical learner wire ID must be exact `wN` (`N >= 1`) and must
  exist as an **own canonical `id`** on a plain `{id, from, to}` object inside
  the workbench's **current learner `circuit.wires`**. The method never falls
  back to `sampleCircuit()` / `createSampleCircuit()` / a reference display.
- `null` explicitly clears the visual selection.
- A valid call returns a frozen read-only receipt with the exact current
  `wireId/from/to` and `graphMutated:false`, `historyMutated:false`,
  `progressMutated:false`.
- A foreign/noncanonical/prototype-backed request fails closed and clears any
  stale highlight before throwing. It has no connect/disconnect/notify
  authority.
- The highlight is visual only: it neither creates a new edge nor changes
  learner graph, undo/redo state, progress, authored checkpoint state, or
  electrical validation.

The rendered committed wire keeps its existing two SVG paths; the high-contrast
state changes those existing path styles/attributes instead of creating another
graph edge. Both paths carry exact `data-wiring-wire-id`; when selected they
also carry exact `data-wiring-highlight-wire`. The matching native HTML
`.wire-connected` row carries the same exact highlight attribute,
`aria-current="true"`, `role="group"`, and an accessible label that identifies
the wire as a **read-only** display highlight and states that it does not create
a new wire or change the learner graph.

The authored dashed suggestion (`data-wire-suggestion-preview`) remains a
separate visual layer and can coexist with the committed-wire highlight. The
pointer drag/connect path remains operational. No suggestion becomes a
committed edge through this API.

### Stale-state / ID-reuse rules

- Removing the highlighted wire clears both SVG and HTML highlight state.
- Any learner-graph mutation through this workbench clears the cross-surface
  highlight before the host `onChange` callback; the host may explicitly
  reselect only after validating the fresh learner model.
- `setCircuit()` preserves the highlight only when the fresh graph fingerprint
  is identical and the exact wire ID plus endpoints still match. A changed
  graph, removed wire, or reused ID with different endpoints clears it.
- A fresh model containing a reused ID can be highlighted only by a new
  explicit `highlightCommittedWire(id)` call, which resolves the **current**
  endpoints rather than any stale endpoints.
- `dispose()` clears the visual state and makes subsequent highlight calls
  inert.

### Responsive/accessibility CSS

`styles/wiring.css` adds a high-contrast HTML-row treatment for
`[data-wiring-highlight-wire]` plus a matching highlighted SVG-path class.
Existing terminal, remove, toolbar and activation controls retain explicit
44 px minimum targets. `.wire-action`, `.wire-activate` and `.wire-remove` now
also declare `min-width:44px`; the responsive `max-width:800px` rule keeps the
same 44 px height floor. These remain source/contract guarantees until the
prime-owned exclusive browser run reaches the current-phase E2E checks.

### Observed source-only verification for this phase

No Git mutation, network, install, package or deploy operation was used in this
worker scope. A requested browser verification was attempted at finalization:
Playwright-managed `chromium` could not launch because the local managed
Chromium headless-shell binary was absent, and no install was performed. The
installed Chrome channel then launched through Playwright's Chromium engine,
but the full suite stopped earlier at the out-of-scope
`scene3d-contracts.js` check
`committed-wire-pointer-tap-inspects-current-canonical-wire`, before the new 2D
highlight E2E block. Therefore this worker records **no fresh browser PASS** for
the current phase; prime owns diagnosis and the exclusive rerun.

| Gate | Observed result |
| --- | --- |
| New workbench highlight behavior contracts | **23/23 PASS** — exact row/SVG binding, frozen read-only receipt, no graph/history callback mutation, no reference fallback, authored suggestion coexistence, identical fresh-model preservation, ID-reuse clearing, foreign/prototype/noncanonical rejection, removal/explicit clear/dispose behavior, exact `w1` vs `w10`, and pointer wiring after highlight |
| Static/source/CSS highlight contracts | **8/8 PASS** — exact public API, no sample fallback or connect/disconnect/notify authority inside the method, exact row/SVG selectors, suggestion contract retained, high-contrast row CSS, and 44 px responsive control minima |
| Existing learner history regression | **14/14 PASS** |
| Base circuit engine regression | **29/29 PASS** |
| Extended circuit engine regression | **77/77 PASS** |

The source-only total observed in this worker phase is therefore **151/151
PASS**. This does not replace the prime-owned real-app integration, 375 px
browser measurement, keyboard/accessibility E2E, same-SHA CI, or release gates.

### Compiler constraint noted during the current phase

GitHub Pages for this project is a static hosting surface. Dispatching the
official GitHub Actions compiler workflow requires an Actions-write-capable
token; the current application does not expose a verified, isolated,
user-editable compiler backend and this phase does not implement one. The 16
compiler jobs used in CI validate the repository's **reference Sketches**; they
must not be described as compiling an arbitrary learner draft typed in the
browser.

Given that boundary, the current product fallback remains the exact committed
learner-wire visual inspector described above: it highlights only a wire that
already exists in the canonical learner graph and provides no compilation,
firmware execution, CAD/breadboard-hole geometry, physical placement, or real
hardware validation claim.

### Prime integrated local gate — 2026-10-30 (pre-commit candidate)

The preceding source-only and failed-browser observations remain historical
worker receipts. After repairing the rendered `wireId` to canonical `id`
adapter, scoping Explorer DOM selected-wire assertions to the **four semantic
projections** (rather than its root state mirror), hardening nested
circuit/wire own-data validation, refreshing the 3D status after stage
transition, and revoking app selection on real WebGL context loss, the prime
ran these gates on the current **uncommitted** 18-file feature candidate:

| Local gate | Observed result |
| --- | --- |
| 36 Bun/JS pure-contract suites | **905/905 PASS** |
| 2D learner-wire highlight behavior and static/CSS | **23/23 + 8/8 PASS** |
| Python unit suite | **100/100 PASS** |
| Site export and release-unit suite | **137 dist files** (136 public/SW assets + marker), **29/29 PASS** |
| Exclusive installed Google Chrome E2E, actual input + WebGL + offline | **469/469 PASS**, 0 failed |
| Browser diagnostics | **0** JavaScript console errors, **0** unexpected warnings, **0** GPU diagnostics |
| AST comparison of historical `check(...)` callsites | HEAD **324**, candidate **339**, all 324 retained; **15** new post-8d6e checks |
| Independent read-only UX and security/provenance reviews | No residual P0/P1 in reviewed candidate; **branch/CI conditional GO only** |

The Chrome report is
`screenshots/post-8d6e420-committed-wire-final-full-20261030.json`,
SHA-256
`fea52da246f30f63b3bfcad98f750b2a5c0812d1026143264015079155e423ed`.
All 469 JSON check records have `passed:true`. New end-to-end checks exercise
real 3D pointer inspection, exact `wN` selection with keyboard and >=44 px
controls, 2D/Inspector/schematic/minimap propagation, remove/undo without
replaying selection, 375 px no-overflow, lesson isolation, and **real**
`WEBGL_lose_context` loss/restore with fail-closed app/scene/Explorer/2D
projection. The existing offline/PWA/dist checks also complete in this run.

This is **local pre-commit evidence**, not proof of any new GitHub Actions run,
compiled learner-edited Sketch, firmware running on a physical Uno, precise
CAD/breadboard mapping, release readiness or production deployment. Final
feature commit SHA, same-SHA manual compiler/Chromium/read-only preflight CI
and protected production-ref verification must be recorded separately.

### Next 3D product block — exact conceptual breadboard hole selection and layout undo/redo

**2026-10-30 local pre-commit candidate, based on accepted feature HEAD
`57d8b9092dffd710e72f5286431536a88b0563c2`.** This phase is distinct
from the preceding accepted committed-wire inspection and does not alter
production `main`, `v1.6.0`, draft release or backup.

- `src/scene3d.js` offers an opt-in, visually selectable A1..J63 hole study
  built with **one 630-instance Three.js InstancedMesh**, deterministic row-major
  IDs and a selected-instance halo. Mouse/touch/pen pointer down/up is
  revalidated across lesson, layout, component, profile, hole identity and
  instance index; dragging, cancel/lost capture, stage/lesson/context loss and
  disposal must not create a selection or connection. Existing terminal and
  committed learner-wire picking take priority.
- `src/breadboard-topology-ui.js` only accepts the exact frozen pointer
  metadata shape `{source:'pointer',physicalVerified:false}` plus the current
  exact lesson/profile. It projects the selected A1..J63 ID into the existing
  page-8 native HTML hole grid, input and contact-group inspector. **Selecting a
  hole only fills input; explicit Assign separately records an authored
  in-session placement**, never a `circuit-router` edge or evidence of
  physical insertion or measured contact.
- `src/lab-editor-ui.js` adds separate bounded **32-step conceptual layout**
  undo/redo for accepted component placement/rotation, not a replacement for
  learner graph history. No-op, invalid, wrong-stage and stale-lesson commands
  do not write layout history, graph, progress or mastery. Native buttons have
  keyboard focus and >=44 px targets. A rejected native `X=999` placement now
  restores the accepted scene layout, then emits a distinct, frozen
  `onSceneReconciled` observer so `app.js` can restore an **already opted-in**
  read-only hole overlay without manufacturing an accepted layout change.

| Final local gate | Observed result |
| --- | --- |
| 37 Bun/JS pure-contract suites (including new scene-hole bridge) | **919/919 PASS** |
| Scene browser contract expansion | **237 runtime contracts**, vs prior 200 |
| Python unit and release tests | **100/100 + 29/29 PASS** |
| Site export | **137 dist files** (136 allowlisted public/SW assets + marker) |
| Exclusive installed Google Chrome real E2E, incl. offline/PWA | **492/492 PASS**, 0 failed |
| Browser diagnostics | **0** JS console errors, **0** unexpected warnings, **0** GPU diagnostics |
| AST historical E2E callsites | Baseline HEAD **339**, current **362**, **all 339 retained**, 23 added |
| Independent P0/P1 audits | UX auditor on pre-hardening candidate and security auditor on **exact post-rollback diff**: **no P0/P1**, conditional feature-branch CI GO only |

The final Chrome JSON contains 492 `passed:true` check records and is:
`screenshots/post-57d8b90-breadboard-3d-rollback-final-20261030.json`
SHA-256
`5a3a1d06790dea1d37a6ee380ab5ea9a1c9b57621d1b88793f2dec4407be2d49`.
This is **local** proof, not a new GitHub Actions artifact or learner-edited
Sketch compilation. The previous 491/491 candidate run preceded rollback
hardening; its PASS does not replace the final 492/492 receipt. The earlier
Chromium fixture failure on `HTMLButtonElement.click()` returning
`undefined` was fixed by verifying an actual layout-change callback and
focus retention instead of the fake DOM return value; no regression assertion
was deleted or relaxed.

The visually positioned 630 holes are **conceptual** and not manufacturer CAD,
millimeters, real contact mapping or physical snap. BB830 profile contact
grouping is separate from actual 3D hole geometry; four external rails are not
automatically inferred or energized. Existing 16 Vietnamese lessons, 48
authored checkpoints, teacher validation/mastery boundaries, lesson 10/14
signal-only limitations, verified firmware and bounded AVR remain unchanged.
An isolated learner-edited C++ compile backend still does not exist on the
static GitHub Pages surface: CI compiler covers **16 checked-in reference
Sketches** only. Commit/CI/release evidence must be verified separately after
this local gate.
