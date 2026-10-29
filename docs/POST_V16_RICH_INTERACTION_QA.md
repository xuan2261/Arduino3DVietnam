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
