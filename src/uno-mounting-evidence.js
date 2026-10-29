/**
 * Original transcription of DIMENSIONED mounting-hole annotations only.
 * Manufacturer: Arduino UNO Rev3 SKU A000066, datasheet §5.4, page 12.
 * https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf
 *
 * The origin is the intersection of the drawing's top and left board-edge
 * dimension lines. X increases to the right, Y downwards in millimetres.
 * This is deliberately NOT a four-hole CAD coordinate model: the lower-left
 * centre's X position has no explicit manufacturer dimension in §5.4.
 */

const anchor = (id, xMm, yMm, description) => Object.freeze({
  id, xMm, yMm, description,
  knownAxes: Object.freeze(xMm === null ? ["y"] : ["x", "y"]),
  source: "A000066-datasheet-section-5.4-dimension-callout",
});

export const UNO_MOUNTING_EVIDENCE = Object.freeze({
  schemaVersion: 1,
  sku: "A000066",
  board: "Arduino UNO R3",
  diagram: "Mounting Holes - View from Top side",
  section: "5.4 Board Outline & Mounting Holes",
  page: 12,
  sourceUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
  outerDimensionsSourceUrl: "https://store.arduino.cc/products/arduino-uno-rev3",
  origin: "drawing-top-left-board-edge-intersection",
  units: "mm",
  xDirection: "right",
  yDirection: "down",
  overallBoardLengthMm: 68.6,
  overallBoardWidthMm: 53.4,
  diameterMm: 3.2,
  totalMountingHoleCount: 4,
  completeXYCount: 3,
  partialXYCount: 1,
  holes: Object.freeze([
    anchor("upper-left", 15.24, 2.54, "15.24 mm từ mép trái; 2.54 mm từ mép trên"),
    anchor("upper-right", 66.04, 17.78, "66.04 mm từ mép trái; 17.78 mm từ mép trên"),
    anchor("lower-right", 66.04, 45.72, "66.04 mm từ mép trái; 45.72 mm từ mép trên"),
    anchor("lower-left", null, 50.8, "50.80 mm từ mép trên; trục X chưa định lượng"),
  ]),
  claims: Object.freeze({
    manufacturerDimensionCalloutsTranscribed: true,
    threeHoleXYDimensionsAvailable: true,
    fourthHoleXKnown: false,
    allFourHoleXYDimensionsAvailable: false,
    preciseBoardSilhouetteAvailable: false,
    electricalTerminalCoordinatesAvailable: false,
    headerSocketCoordinatesAvailable: false,
    sceneWorldTransformAvailable: false,
    breadboardHoleSnapAvailable: false,
    physicalFitVerified: false,
    electricalAuthority: false,
    vendorCadCopied: false,
  }),
});

export function getUnoMountingEvidence() {
  return UNO_MOUNTING_EVIDENCE;
}
