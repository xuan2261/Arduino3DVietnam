# A000066 mounting-hole evidence — only dimensioned drawing axes

**Source checked 2026-10-29:** [Arduino UNO R3 A000066 datasheet, §5.4, page 12](https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf), “Mounting Holes — View from Top side”. Dimensions below are a transcription of the diagram's **explicit arrows**; the manufacturer's overall envelope 68.6 × 53.4 mm is published independently in the [Arduino UNO Rev3 Tech Specs](https://store.arduino.cc/products/arduino-uno-rev3).

## Evidence table

The source diagram's left and top board-edge datum lines define **X right / Y down** (millimetres). The coordinate evidence is partial, unlike a machine-readable CAD footprint.

| Hole | X from left (mm) | Y from top (mm) | Evidence |
|---|---:|---:|---|
| Upper-left | 15.24 | 2.54 | `[600 mil]`, `[100 mil]` |
| Upper-right | 66.04 | 17.78 | `[2600 mil]`, `[700 mil]` |
| Lower-right | 66.04 | 45.72 | `[2600 mil]`, `[1800 mil]` |
| Lower-left | **unknown** | 50.80 | `[2000 mil]`; X is **not dimensioned** |

The manufacturer labels four holes as diameter Ø3.20 mm. The 66.04 mm and 50.80 mm arrow endpoints are not the outer PCB length/width. Three hole centres have both dimensioned axes; the fourth has only Y dimension. **Do not interpolate the last X coordinate from an image** or silently assign the top-left X to it.

`src/uno-mounting-evidence.js` is an original immutable source-reference record, **not** copied CAD. It does not authorize a 3D world transform, snap-to-breadboard, header/socket pin coordinates, exact PCB cutouts, electrical netlist, or proof of mechanical fit. `circuit-router` remains the sole learner electrical authority.

## Acceptance and next provenance gate

- Display the three known XY points and one explicitly incomplete point as a readable table, with a source link and explicit physical limitations.
- Pass `tests/uno-mounting-evidence-contracts.js`, real Pinout DOM/mobile/ARIA, static import/Service Worker parity and historical regression checks.
- To use all four holes or any terminal for *physical* snap, obtain and verify **the exact A000066 CAD source and license**, establish coordinate frame/revision, independently test four mounting centres and header footprints against source and a second authoritative reference, then build a validated scene transform. This partial record alone never authorizes that operation.
