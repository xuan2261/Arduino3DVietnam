/**
 * Manufacturer-sourced outline facts for Arduino UNO Rev3 (SKU A000066).
 * Overall PCB size: https://store.arduino.cc/products/arduino-uno-rev3
 * Mounting holes and separate dimension callouts:
 * https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf
 * Section 5.4: Board Outline & Mounting Holes, English page 12.
 *
 * Only the outside board rectangle and hole count/diameter are represented.
 * This is NOT a physical pin-header footprint, breadboard hole transform,
 * verified 3D mesh coordinate system, CAD redistribution, or current model.
 */
const OUTLINE = Object.freeze({
  sku:"A000066",
  board:"Arduino UNO R3",
  // Published UNO Rev3 TECH SPECS: Length 68.6 mm, Width 53.4 mm.
  // The drawing's 66.04 / 50.80 callouts terminate short of the
  // opposite PCB edges; they are NOT its overall bounding dimensions.
  widthMm:68.6,
  heightMm:53.4,
  datasheetCalloutsMm:Object.freeze({horizontal:66.04,vertical:50.8}),
  mountingHoleCount:4,
  mountingHoleDiameterMm:3.2,
  section:"5.4 Board Outline & Mounting Holes",
  sourceUrl:"https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
  overallDimensionsSourceUrl:"https://store.arduino.cc/products/arduino-uno-rev3",
  sourceType:"arduino-manufacturer-mechanical-outline",
  scope:"outline-and-hole-diameter-only",
  claims:Object.freeze({
    boardOutlineDimensionsVerified:true,
    mountingHoleDiameterVerified:true,
    datasheetCalloutsAreOverallBoardDimensions:false,
    mountingHoleCoordinateModelProvided:false,
    headerFootprintVerified:false,
    individualSocketCoordinatesVerified:false,
    sceneCoordinatesVerified:false,
    breadboardHoleMappingVerified:false,
    electricalAuthority:false,
    physicalConnectionVerified:false,
    cadFilesCopied:false,
  }),
});

export const UNO_MECHANICAL_OUTLINE = OUTLINE;
export function getUnoMechanicalOutline(){return OUTLINE;}
