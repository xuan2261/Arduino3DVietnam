import {
  listUnoPinReferences, getUnoPinReference, UNO_REFERENCE_CLAIMS,
} from "../src/uno-reference.js";

export function runUnoReferenceContracts() {
  const checks = [];
  const check = (name, pass) => checks.push({ name, passed: Boolean(pass) });
  const pins = listUnoPinReferences();
  const digitals = pins.filter(pin => pin.group === "digital");
  const analogs = pins.filter(pin => pin.group === "analog");
  check("manufacturer-pinout-14-digital", digitals.length === 14 &&
    digitals.every((pin, n) => pin.id === "D" + n));
  check("manufacturer-pinout-six-analog", analogs.length === 6 &&
    analogs.every((pin, n) => pin.id === "A" + n));
  check("pwm-pins-exact-uno-r3", digitals.filter(pin => pin.pwm)
    .map(pin => pin.id).join(",") === "D3,D5,D6,D9,D10,D11");
  check("pin-roles-uart-spi-i2c-documented", getUnoPinReference("D0").functionLabel.includes("RX") &&
    getUnoPinReference("D1").functionLabel.includes("TX") &&
    getUnoPinReference("D13").functionLabel.includes("LED L") &&
    getUnoPinReference("A4").functionLabel.includes("SDA") &&
    getUnoPinReference("A5").functionLabel.includes("SCL") &&
    getUnoPinReference("D10").functionLabel.includes("SS"));
  check("source-has-no-physical-overclaim", UNO_REFERENCE_CLAIMS.sku === "A000066" &&
    UNO_REFERENCE_CLAIMS.breadboardHoleMappingVerified === false &&
    UNO_REFERENCE_CLAIMS.sceneCoordinatesVerified === false &&
    UNO_REFERENCE_CLAIMS.headerFootprintVerified === false &&
    UNO_REFERENCE_CLAIMS.firmwareOutputsProvenByThisMap === false);
  check("fixed-list-and-records", Object.isFrozen(pins) &&
    pins.every(pin => Object.isFrozen(pin) && pin.physicalHoleVerified === false));
  check("no-fabricated-pin", getUnoPinReference("D14") === null &&
    getUnoPinReference("A6") === null && getUnoPinReference("P1+1") === null);
  check("rev3-dedicated-i2c-header-aliases-not-new-mcu-pins",
    getUnoPinReference("SDA")?.group === "i2c" &&
    getUnoPinReference("SDA")?.functionLabel.includes("A4") &&
    getUnoPinReference("SCL")?.functionLabel.includes("A5") &&
    UNO_REFERENCE_CLAIMS.i2cHeaderCreatesIndependentMicrocontrollerPins === false);
  check("aref-not-power-output-and-gnd-physical-contact-unspecified",
    getUnoPinReference("AREF")?.functionLabel.includes("không phải ngõ cấp nguồn") &&
    UNO_REFERENCE_CLAIMS.gndPhysicalContactDisambiguated === false);
  for (const value of [" D13", "D13 ", "", 13, null, {}]) {
    let rejected = false;
    try { getUnoPinReference(value); } catch { rejected = true; }
    check("reject-noncanonical-" + String(value), rejected);
  }
  return { total: checks.length, passed: checks.filter(c => c.passed).length,
    failed: checks.filter(c => !c.passed), checks };
}
