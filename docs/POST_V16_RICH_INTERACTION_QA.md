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
