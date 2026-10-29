import {
  getUnoMountingEvidence,
  UNO_MOUNTING_EVIDENCE,
} from "../src/uno-mounting-evidence.js";

export function runUnoMountingEvidenceContracts() {
  const checks = [];
  const check = (name, ok) => checks.push(Object.freeze({name, passed:Boolean(ok)}));
  const data = getUnoMountingEvidence();

  check("same-frozen-manufacturer-record", data === UNO_MOUNTING_EVIDENCE &&
    Object.isFrozen(data) && Object.isFrozen(data.holes) && Object.isFrozen(data.claims) &&
    data.holes.every(row => Object.isFrozen(row) && Object.isFrozen(row.knownAxes)));
  check("exact-a000066-dimension-diagram-provenance", data.schemaVersion === 1 &&
    data.sku === "A000066" && data.page === 12 &&
    data.section === "5.4 Board Outline & Mounting Holes" &&
    data.sourceUrl === "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf");
  check("store-overall-68-point-6-by-53-point-4-not-drawing-spacing", data.overallBoardLengthMm === 68.6 &&
    data.overallBoardWidthMm === 53.4 &&
    data.outerDimensionsSourceUrl === "https://store.arduino.cc/products/arduino-uno-rev3");
  check("drawing-axis-frames-explicit-not-scene-coordinates", data.origin ===
    "drawing-top-left-board-edge-intersection" && data.units === "mm" &&
    data.xDirection === "right" && data.yDirection === "down");
  check("diameter-and-actual-four-holes", data.diameterMm === 3.2 &&
    data.holes.length === data.totalMountingHoleCount && data.totalMountingHoleCount === 4);
  check("upper-left-manufacturer-callouts", data.holes[0].id === "upper-left" &&
    data.holes[0].xMm === 15.24 && data.holes[0].yMm === 2.54);
  check("upper-right-manufacturer-callouts", data.holes[1].id === "upper-right" &&
    data.holes[1].xMm === 66.04 && data.holes[1].yMm === 17.78);
  check("lower-right-manufacturer-callouts", data.holes[2].id === "lower-right" &&
    data.holes[2].xMm === 66.04 && data.holes[2].yMm === 45.72);
  check("lower-left-x-unknown-never-interpolated", data.holes[3].id === "lower-left" &&
    data.holes[3].xMm === null && data.holes[3].yMm === 50.8 &&
    data.holes[3].knownAxes.join(",") === "y" && data.claims.fourthHoleXKnown === false);
  check("exactly-three-full-and-one-partial-coordinate-pairs",data.completeXYCount === 3 &&
    data.partialXYCount === 1 && data.holes.filter(h => h.xMm!==null && h.yMm!==null).length === 3);
  check("known-values-finite-and-within-sourced-board-outer-bounds",
    data.holes.every(h => h.xMm === null || (Number.isFinite(h.xMm) && h.xMm >= 0 &&
      h.xMm <= data.overallBoardLengthMm)) &&
    data.holes.every(h => Number.isFinite(h.yMm) && h.yMm >= 0 &&
      h.yMm <= data.overallBoardWidthMm));
  check("no-fabricated-fourth-center-or-header-or-scene-cad",[
    "allFourHoleXYDimensionsAvailable", "preciseBoardSilhouetteAvailable",
    "electricalTerminalCoordinatesAvailable", "headerSocketCoordinatesAvailable",
    "sceneWorldTransformAvailable", "breadboardHoleSnapAvailable", "physicalFitVerified",
    "electricalAuthority", "vendorCadCopied",
  ].every(key => data.claims[key] === false));
  check("described-dimensions-only-not-cad-source-import",data.claims.manufacturerDimensionCalloutsTranscribed === true &&
    data.claims.threeHoleXYDimensionsAvailable === true &&
    data.holes.every(h=>h.source === "A000066-datasheet-section-5.4-dimension-callout" &&
      typeof h.description === "string" && h.description.length > 0));
  return Object.freeze({
    total:checks.length,
    passed:checks.filter(c => c.passed).length,
    failed:Object.freeze(checks.filter(c => !c.passed)),
    checks:Object.freeze(checks),
  });
}
