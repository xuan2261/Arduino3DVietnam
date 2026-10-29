/**
 * Educational connector/function registry for the Arduino UNO Rev3 (A000066).
 * Source: https://content.arduino.cc/assets/A000066-full-pinout.pdf
 * Cross-check: https://docs.arduino.cc/hardware/uno-rev3
 *
 * This labels header functions, not a physical CAD/hole placement, signal
 * waveform, Arduino pin electrical drive model, or the current circuit graph.
 */
const PWM = new Set([3, 5, 6, 9, 10, 11]);
const DIGITAL_FUNCTIONS = Object.freeze({
  0: "UART RX", 1: "UART TX", 2: "Ngắt ngoài INT0",
  3: "PWM · INT1", 5: "PWM", 6: "PWM", 9: "PWM",
  10: "PWM · SPI SS", 11: "PWM · SPI COPI/MOSI",
  12: "SPI CIPO/MISO", 13: "SPI SCK · LED L tích hợp",
});
const ANALOG_FUNCTIONS = Object.freeze({
  4: "ADC · I²C SDA", 5: "ADC · I²C SCL",
});
const make = (id, group, functionLabel, pwm = false) =>
  Object.freeze({ id, group, functionLabel, pwm, physicalHoleVerified: false });
const PINS = Object.freeze([
  ...Array.from({ length: 14 }, (_, i) =>
    make("D" + i, "digital", DIGITAL_FUNCTIONS[i] ||
      "Tín hiệu số GPIO", PWM.has(i))),
  ...Array.from({ length: 6 }, (_, i) =>
    make("A" + i, "analog", ANALOG_FUNCTIONS[i] ||
      "Đầu vào ADC (có thể dùng GPIO)", false)),
  make("5V", "power", "Đường nguồn 5 V của bo (không đo điện áp thực)"),
  make("3V3", "power", "Đường nguồn danh định 3,3 V"),
  make("GND", "power", "Điểm tham chiếu GND"),
  make("VIN", "power", "Đầu vào nguồn VIN"),
  make("IOREF", "power", "Tham chiếu mức logic bo"),
  make("RESET", "power", "Tín hiệu reset"),
  make("AREF", "power", "Đầu vào tham chiếu ADC, không phải ngõ cấp nguồn"),
  make("SDA", "i2c", "Header I²C SDA · cùng tín hiệu logic với A4"),
  make("SCL", "i2c", "Header I²C SCL · cùng tín hiệu logic với A5"),
]);
const BY_ID = new Map(PINS.map(pin => [pin.id, pin]));

export const UNO_REFERENCE_CLAIMS = Object.freeze({
  model: "Arduino UNO Rev3",
  sku: "A000066",
  source: "official-arduino-uno-r3-pinout",
  electricalAuthority: "circuit-router",
  pinFunctionsDocumented: true,
  headerFootprintVerified: false,
  sceneCoordinatesVerified: false,
  breadboardHoleMappingVerified: false,
  runtimeStateMeasured: false,
  firmwareOutputsProvenByThisMap: false,
  i2cHeaderCreatesIndependentMicrocontrollerPins: false,
  gndPhysicalContactDisambiguated: false,
});

export function listUnoPinReferences() { return PINS; }

export function getUnoPinReference(id) {
  if (typeof id !== "string" || !id || id !== id.trim()) {
    throw new TypeError("Pin ID phải là chuỗi chuẩn không chứa khoảng trắng.");
  }
  return BY_ID.get(id) ?? null;
}
