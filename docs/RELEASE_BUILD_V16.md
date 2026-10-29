# Release build v1.6

`scripts/build_site.py` is the release packager for the static GitHub Pages site. The v1.6 manifest is intentionally fail-closed: it preserves the 70-file v1.5 release baseline and appends exactly 13 v1.6 assets, for a total of 83 release files before the generated marker.

## v1.6 additions

The appended files are, in release order:

1. `src/lab-explorer.js`
2. `src/lab-explorer-ui.js`
3. `src/breadboard-topology.js`
4. `src/breadboard-topology-ui.js`
5. `src/avr-timer2.js`
6. `styles/lab-explorer.css`
7. `docs/LAB_EXPLORER_V16.md`
8. `docs/BREADBOARD_TOPOLOGY_V16.md`
9. `docs/TIMER2_V16.md`
10. `docs/SCENE3D_V16.md`
11. `src/dc-resistor-network.js`
12. `src/resistive-study-ui.js`
13. `docs/DC_RESISTOR_NETWORK_V16.md`

The source `sw.js` precache list must match `build_site.FILES` exactly and in the same order, excluding only `sw.js` itself and adding the `./` navigation root. This makes missing, duplicated, reordered, or accidentally published assets a release-contract failure.

The user-facing resistive study UI imports `./dc-resistor-network.js`, so both UI and solver are public release dependencies and both must be available offline through the service-worker precache. The companion `docs/DC_RESISTOR_NETWORK_V16.md` is packaged with the same release.

## Integrity boundaries

The v1.6 expansion does not weaken the existing firmware or avr8js integrity gates. Firmware still uses the strict source/sketch/HEX/flash verifier. Vendored avr8js still requires its pinned repository/tag/commit metadata, exact provenance file sets, independent SHA-256 anchors for the shipped source/runtime/license bytes, and the MIT license text.

Three.js is also fail-closed at packaging time. The builder pins exact SHA-256 values for the shipped `assets/vendor/three.module.min.js`, `assets/vendor/three.core.min.js`, and `assets/vendor/THREE-LICENSE.txt`; changing any of those bytes causes the release build to fail.

Read-only provenance verification against the official `mrdoob/three.js` repository on 2026-10-29 established that tag `r180` is annotated tag object `9e8635e2031c25859dc47ba07e72230dccb2682a`, which resolves to commit `0af9729d0c143a86a1d725d6e2c3ad83301f3f34`. GitHub reports that tag object as unsigned, so this document does not claim a verified tag signature. The official r180 Git blob IDs are `20d3c112761a519c7780a5ccc9f72a40937fa83b` for `build/three.module.min.js`, `70c40977daa0f6e1e312c6b58e9bfe49cb5a87a4` for `build/three.core.min.js`, and `cf781430404b0ae0ba7d8dea3457a3515dd7c9b9` for `LICENSE`; the local vendored files have those same Git blob IDs. This proves byte identity with those three files at official tag r180 without requiring network access during a release build.

The independent build-time SHA-256 anchors for the exact canonical **Git blob / LF** bytes are:

- `assets/vendor/three.module.min.js`: `e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6`
- `assets/vendor/three.core.min.js`: `61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de`
- `assets/vendor/THREE-LICENSE.txt`: `bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601`

**Cross-platform failure reproduced and fixed on 2026-10-29:** Windows had retained six CRLF endings in each Three.js module and 21 CRLF endings in the MIT license despite the repository's canonical Git blobs being LF. Pinning hashes to the Windows working-tree bytes led GitHub Linux CI to reject the *unchanged official r180 Git blobs*. Release hashes now pin those original upstream LF blobs, not an OS-specific working-tree conversion. `.gitattributes` explicitly specifies `eol=lf` for the MIT license as well as the already-covered `*.min.js`; developer working trees must restore the exact indexed LF bytes rather than weaken the verifier or rewrite the vendored upstream code.

Reference histories under `sources/` are not release assets and remain excluded. Every allowlisted path must resolve to a real non-symlink file under the repository root and outside `dist`.

## Verification

`tests/test_release.py` locks the v1.6 manifest to exactly 83 release files, checks the exact 13-file append order, requires every new file to exist and be non-empty, verifies the resistive study UI imports the packaged DC solver, rejects `sources/` histories, and verifies exact service-worker parity. It also positively verifies all three pinned Three.js SHA-256 values and negatively tampers each runtime/license file to prove the builder fails closed. Existing tests continue covering firmware tampering, synchronized avr8js/provenance tampering, content-addressed cache behavior, project-subpath safety, and the manual release/deploy gate.

The generated `dist/` additionally contains `.arduino-3d-viet-generated`, which identifies output owned by the packager. Therefore a complete v1.6 build contains 84 files total: 83 allowlisted release files plus this generated marker. CI artifact upload must keep hidden files so downstream backup/provenance validation receives that marker.
