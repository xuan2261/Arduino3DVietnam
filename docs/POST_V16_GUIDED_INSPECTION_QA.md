# Post-v1.6 guided inspection — candidate QA and release boundary

Date: 2026-10-29 (Asia/Bangkok). Workspace: `C:\Work\Arduino3DVietnam`.

## Candidate identity

Current development base: `32944a68022b4e4ec0da50328c3a7a78b8002800`,
branch `feature/post-v16-interactive-breadboard-wiring`. At local QA capture,
this phase was a staged candidate not yet committed. **Do not reuse any prior
CI result as new-code verification.** Production `main` and annotated tag `v1.6.0` belong
to protected SHA `341449b12d50c681be3f04d6e291965bf6015d99`.

## Substantive feature delta

- Three.js: 8-point raised multi-segment conceptual wire routes; selection of
  an existing learner wire from Lab Explorer highlights only its render, with
  strict ID + unordered endpoint identity. Same-lesson component move/rotate
  preserves that inspection and advances a visual geometry revision; unrelated
  graph replacement or stage/lesson/layout clear/context loss revokes it.
- Practice: independently authored 48-step required-pair checklist now offers
  an explicit button to preview a **still missing** pair in 2D. The host
  revalidates current lesson and step, authored checkpoint and learner draft;
  preview is a dashed annotated line with separate native terminal controls.
  Only a subsequent explicit two-terminal learner gesture may add graph edges.
- Breadboard: explicit session-authored terminal-to-hole mappings grouped by
  profile contact node with readable provenance, not auto-hole mapping or
  physical insertion; generic rails unknown and BB830 Rev7 four independent
  50-hole rails within the known profile.
- Independent ideal DC math: R1 series (R2 parallel R3) via bounded solver and
  independently rechecked Ohm/KCL/voltage/current/power. This is not part of the
  16-lesson electrical netlist, verified firmware, or a physical measurement.
  Verifier rejects inherited/accessor/unknown properties in solver provenance,
  including otherwise finite zero-V and branch reports.
- UNO Rev3 A000066: manufacturer Tech Specs overall length × width **68.6 × 53.4 mm**;
  datasheet §5.4 separately annotates 66.04 / 50.80 mm reference distances
  (not the outer envelope) and four nominal Ø3.20 mm mounting holes. The
  SVG is original, not imported CAD; it supplies no verified socket/header
  center positions, edge cutouts or breadboard transform.
- Mobile/accessibility: native actions and focus for pair suggestion and wire
  inspection, 44px workbench buttons, ARIA status, readable provenance.

## Source truth and boundaries

`circuit-router.js` owns all learner electrical connections; Three.js and 2D
suggestion are **views only**. Authored checkpoints are editorial guidance,
not teacher validation or proof of real learner action/mastery. The existing
session observation WeakSet brand remains unchanged. No source import, device
upload, compiler for user-edited Sketch, hardware operation, or blanket root
license selection is performed in this phase.

## Verification executed on the current local candidate

| Gate | Observed result |
| --- | --- |
| Direct JS (Bun, 24 model/UI suites) | **714/714 PASS** |
| Python unittest discovery | 95/95 PASS |
| Python release-only | 24/24 PASS |
| Windows exclusive Chromium full E2E, after Ubuntu accessibility fix | **402/402 PASS**, 0 failed |
| Unexpected browser warnings/errors/GPU diagnostics | **0 / 0 / 0** on Windows |
| Manifest / SW / dist | 118 public paths, 118 SW assets, 119 dist files including generated marker |
| Prior 110-path allowlist prefix | byte-for-byte ordered path hash preserved: `5a8c277108f4314a4bf7896953a5032aad380f75efa4dda1184135fee51499eb` |
| E2E literal IDs | 271/271 prior literal IDs preserved, 289 current distinct literals, no duplicates; both learner graph lesson-switch regression IDs retained |

Full browser evidence is local at
`screenshots/post-v16-ubuntu-a11y-layout-final.json`. The last full browser
run proves actual 2D preview → separate connect → Explorer/3D highlight,
**real LabEditor move+rotate highlight preservation**, reused w1 identity
revocation after canonical graph replacement, historical transitions, BB830
grouping, corrected source outline, branch math at 375px, invalid-input
handling and offline new runtime/docs imports. The new 375px regression
also measures all three authored-pair **inspect** and all three **preview**
button targets at >=44px while requiring no horizontal document overflow.

### Exact-SHA GitHub CI follow-up after first branch push

The first pushed candidate `e8f35be414599a6733cd9cdd303766e2ea94a2db`
had Arduino compiler workflow run **40827995165** completed/success; its
downloaded JSON confirms **16/16** compiled with `arduino:avr:uno`.
Ubuntu Chromium run **40827999649** completed/failure despite local
401/401: 43/44 desktop accessibility checks passed; the sole nested P1 was
`vnext-practice-authored-pair-checklist-named-native-inspect`. Exactly three
authored rows/inspect actions existed, but the existing 44px target predicate
was false on the Linux runner. After adding the second preview action to a
two-column grid, a narrow implicit first column could squeeze the existing
inspect button on different system fonts. The correction makes each inspect
and preview action span the full available grid width with explicit minimum
44px dimensions. The 44px assertion was **not weakened**; the failure
diagnostic now includes measured width/height, names and row statuses.

The corrected layout has local full Chromium **402/402 PASS**, but this
record does **not** claim the corrected candidate has a successful GitHub
browser run or read-only release-preflight. Both compiler and browser must
pass on one NEW final commit SHA before dispatching release-preflight.

Security/provenance preflight also checked no modified `sources/`, `.git`,
vendored files, firmware, license or release backups; packaging allowlist has no
third-party histories or private paths. Runtime source scan found no new
`eval`, dynamic Function, network fetch, localStorage access, or positive
`physicalVerified:true`; older app-controlled `innerHTML` remains escaped.

**Independent P0/P1 audit — scoped GO for feature-branch commit and exact-SHA
manual CI only.** Workers 14 and 16 reviewed disjoint non-owned source areas
and discovered real P1 blockers: visual highlight dropped on same-lesson layout
rebuild; reused `w1` could retarget to different endpoints. Worker 21
independently found inherited solver-report provenance acceptance and
66.04 × 50.80 mm drawing callouts misreported as overall board dimensions.
All four were repaired with negative contracts and browser integration checks.
Worker 21 re-reviewed the **current** resistor/UNO fixes and reported no
remaining P0/P1; worker 22 independently re-reviewed **current** scene/host/
E2E fixes and reported no remaining P0/P1. These are source-review receipts,
not proof of future GitHub CI. Scope does NOT authorize Pages, release, main,
tag changes or physical-hardware claims.

## Four-source gap comparison (reference patterns, not copied assets)

| Source | Relevant mechanisms improved | Remaining gap |
| --- | --- | --- |
| `codex-howto/guided` (R1) | 48 authored step-specific corrective hints, source/evidence separation and explicit learner actions | Editorial checkpoints are not teacher validated or an assessment of mastery |
| `learn-arduino-red` (R2) | Inspector/2D schematic/3D interactions and interactive 16-lesson Vietnamese lab | Browser geometry and behavior not full source-equivalent or real hardware |
| `learn-arduino-button-kr` (R3) | Two-terminal click/drag, visual socket routes, mobile/keyboard fallback and undoable visual suggestions | No verified 1:1 breadboard hole snap-to-physical-CAD |
| `learn-microcontroller` (R4) | Explorer, conceptual schematic, read-only wire emphasis, component visualization | Same product family as R2, not independent feature duplication; AVR/full serial/peripheral parity unproven |

## Next gates

1. Independent P0/P1 audit and affected regression fixes completed; actual
   local final QA is recorded above.
2. `git diff --cached --check`, ownership and private-path scan, commit/push
   nonforce on feature branch only.
3. Dispatch compiler16/16 and browser402-or-more manual workflows on exactly
   that full SHA; download actual JSON artifacts.
4. Run read-only release-preflight exact SHA and verify firmware source ancestor,
   SHA-256 and 16 HEX byte parity; no Pages dispatch.
5. Reverify production main/tag, Pages, Draft Release 8 assets and backup hashes.

Remaining product limitations: exact CAD/socket coordinates, physical latching,
USB/board-level compiler of arbitrary learner Sketch, full AVR GPIO/PWM/
USART RX/Timer parity, realistic nonlinear and motor/servo electrical behavior,
real screen-reader/device QA, and whole-project LICENSE decisions.
