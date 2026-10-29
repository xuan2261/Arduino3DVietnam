# Arduino UNO R3 A000066 — bounded mechanical outline reference

## Why this exists

This module distinguishes **manufacturer-documented board-outline measurements**
from invented scene geometry and physical pin locations. The learning UI provides
an original aspect-ratio rectangle in the Pinout tab, with an explicit source
link and clear warnings. No manufacturer's technical artwork is copied into
the application.

## Source and exact grounded data

- Manufacturer: Arduino, model UNO Rev3, part number **A000066**.
- Manufacturer's **overall length × width**: **68.6 mm × 53.4 mm**, listed
  under Tech Specs at <https://store.arduino.cc/products/arduino-uno-rev3>.
- Mechanical drawing: <https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf>,
  Section **5.4 Board Outline & Mounting Holes**, printed page 12 (page index 11).
  The **66.04 mm horizontal** and **50.80 mm vertical** callouts terminate
  before the far board edge. They are **not** the overall board envelope. The
  drawing must not be read as 66.04 × 50.80 mm overall size.
- Mounting holes: **4**, nominal diameter **Ø3.20 mm**.

`src/uno-mechanical-reference.js` owns this frozen outline-only record; the
source image is **not** bundled in `dist` or Service Worker assets. The
Pinout panel creates its own SVG rectangle at the published overall aspect ratio. This
is a visualization of the bounding dimensions, not a CAD rendering of the
non-rectangular PCB edges.

## Explicit negative constraints

- Does not supply hole center positions, exact shape cutouts, header footprints,
  socket row offsets or orientation-specific physical pin coordinates.
- Does not supply a board-to-breadboard coordinate transform or authorize
  physical snap-to-hole from a logical `lab-layout` position.
- Does not prove any actual voltage, current, electrical power, safety of a
  wiring configuration, or that an external jumper has been inserted.
- Does not grant redistribution rights for the Arduino PDF, CAD assets or any
  third-party reference project's geometry.

The existing `scene3d.js`, `lab-layout.js`, breadboard profiles and
`circuit-router.js` remain independent. Arduino pinout label provenance is
in `src/uno-reference.js`; it is intentionally not a CAD/socket geometry map.
Run `tests/uno-mechanical-reference-contracts.js` and browser Pinout checks
for exact source, bounded measurements, accessible text and false claims.
