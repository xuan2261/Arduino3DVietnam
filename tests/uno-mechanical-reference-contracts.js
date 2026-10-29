import {getUnoMechanicalOutline,UNO_MECHANICAL_OUTLINE} from "../src/uno-mechanical-reference.js";

export function runUnoMechanicalReferenceContracts(){
  const rows=[];
  const check=(name,ok)=>rows.push(Object.freeze({name,passed:Boolean(ok)}));
  const outline=getUnoMechanicalOutline();
  check("manufacturer-arduino-a000066-exact-sku",outline.sku==="A000066"&&outline.board==="Arduino UNO R3");
  check("overall-outline-dimensions-from-uno-rev3-official-tech-specs",outline.widthMm===68.6&&outline.heightMm===53.4);
  check("datasheet-callouts-are-not-overall-board-envelope",outline.datasheetCalloutsMm?.horizontal===66.04&&
    outline.datasheetCalloutsMm?.vertical===50.8&&
    outline.claims.datasheetCalloutsAreOverallBoardDimensions===false&&
    Object.isFrozen(outline.datasheetCalloutsMm));
  check("board-ratio-numeric-finite",Number.isFinite(outline.widthMm/outline.heightMm)&&
    Math.abs(outline.widthMm/outline.heightMm-(68.6/53.4))<1e-12);
  check("four-mounting-holes-source-verified-count",outline.mountingHoleCount===4);
  check("hole-diameter-source-verified",outline.mountingHoleDiameterMm===3.2);
  check("manufacturer-url-not-copied-asset",outline.sourceUrl===
    "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf"&&
    outline.overallDimensionsSourceUrl===
      "https://store.arduino.cc/products/arduino-uno-rev3"&&
    outline.claims.cadFilesCopied===false);
  check("mechanical-scope-is-outline-only",outline.scope==="outline-and-hole-diameter-only");
  check("source-section-explicit",/5\.4 Board Outline/.test(outline.section));
  check("model-and-claims-frozen",Object.isFrozen(outline)&&Object.isFrozen(outline.claims)&&
    outline===UNO_MECHANICAL_OUTLINE);
  for(const key of [
    "mountingHoleCoordinateModelProvided", "headerFootprintVerified", "individualSocketCoordinatesVerified",
    "sceneCoordinatesVerified", "breadboardHoleMappingVerified", "electricalAuthority",
    "physicalConnectionVerified", "cadFilesCopied",
  ])check("never-upgrade-"+key,outline.claims[key]===false);
  return Object.freeze({total:rows.length,passed:rows.filter(row=>row.passed).length,
    failed:Object.freeze(rows.filter(row=>!row.passed)),checks:Object.freeze(rows)});
}
