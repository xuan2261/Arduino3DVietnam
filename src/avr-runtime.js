import { CPU } from "../assets/vendor/avr/cpu.js";
import { avrInstruction } from "../assets/vendor/avr/instruction.js";

const ATMEGA328P_FLASH_BYTES = 32 * 1024;
const ATMEGA328P_SRAM_BYTES = 2 * 1024;
const MAX_HEX_TEXT_CHARS = 1024 * 1024;
const MAX_RUN_CYCLES = 100_000;

export const AVR8JS_PROVENANCE = Object.freeze({
  engine: "avr8js",
  version: "0.21.1",
  repository: "https://github.com/wokwi/avr8js",
  commit: "bee6f0a94e0e27786f6bc21aee3c775849fb50fd",
  license: "MIT",
  sourcePath: "assets/vendor/avr/avr8js-0.21.1-source",
});

export const AVR_RUNTIME_CAPABILITIES = Object.freeze({
  architecture: "avr8",
  mcu: "atmega328p",
  clockHz: 16_000_000,
  intelHex: true,
  cpuInstructions: true,
  gpio: false,
  timers: false,
  adc: false,
  eeprom: false,
  spi: false,
  twi: false,
  usart: false,
  serial: false,
  externalHardware: false,
});

function assertIntegerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} phải là số nguyên trong khoảng ${min}..${max}.`);
  }
}

function parseRecord(line, lineNumber) {
  if (!line.startsWith(":")) {
    throw new Error(`Intel HEX dòng ${lineNumber}: thiếu ký tự mở đầu ':'.`);
  }
  const payload = line.slice(1);
  if (!payload.length || payload.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(payload)) {
    throw new Error(`Intel HEX dòng ${lineNumber}: dữ liệu hex không hợp lệ.`);
  }
  const bytes = new Uint8Array(payload.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(payload.slice(index * 2, index * 2 + 2), 16);
  }
  const byteCount = bytes[0];
  if (bytes.length !== byteCount + 5) {
    throw new Error(`Intel HEX dòng ${lineNumber}: byte count không khớp độ dài record.`);
  }
  let checksum = 0;
  for (const value of bytes) checksum = (checksum + value) & 0xff;
  if (checksum !== 0) {
    throw new Error(`Intel HEX dòng ${lineNumber}: checksum sai.`);
  }
  return {
    byteCount,
    address: (bytes[1] << 8) | bytes[2],
    type: bytes[3],
    data: bytes.subarray(4, 4 + byteCount),
  };
}

export function parseIntelHex(hexText) {
  if (typeof hexText !== "string" || !hexText.trim()) {
    throw new TypeError("Firmware phải là Intel HEX text không rỗng.");
  }
  if (hexText.length > MAX_HEX_TEXT_CHARS) {
    throw new RangeError(`Intel HEX vượt giới hạn ${MAX_HEX_TEXT_CHARS} ký tự.`);
  }
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(hexText)) {
    throw new Error("Intel HEX chỉ được chứa văn bản ASCII.");
  }

  const flash = new Uint8Array(ATMEGA328P_FLASH_BYTES);
  flash.fill(0xff);
  const written = new Uint8Array(ATMEGA328P_FLASH_BYTES);
  let baseAddress = 0;
  let eofSeen = false;
  let bytesLoaded = 0;
  let minAddress = ATMEGA328P_FLASH_BYTES;
  let maxAddress = -1;

  const lines = hexText.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;
    if (eofSeen) {
      throw new Error(`Intel HEX dòng ${lineNumber}: có record sau EOF.`);
    }
    const record = parseRecord(line, lineNumber);
    const { byteCount, address, type, data } = record;

    if (type === 0x00) {
      const absoluteAddress = baseAddress + address;
      const endAddress = absoluteAddress + byteCount;
      if (absoluteAddress < 0 || endAddress > flash.length) {
        throw new RangeError(
          `Intel HEX dòng ${lineNumber}: dữ liệu nằm ngoài flash ATmega328P 32 KiB.`,
        );
      }
      for (let offset = 0; offset < byteCount; offset += 1) {
        const target = absoluteAddress + offset;
        const value = data[offset];
        if (written[target] && flash[target] !== value) {
          throw new Error(`Intel HEX dòng ${lineNumber}: record ghi đè mâu thuẫn tại 0x${target.toString(16)}.`);
        }
        if (!written[target]) {
          written[target] = 1;
          bytesLoaded += 1;
        }
        flash[target] = value;
      }
      if (byteCount) {
        minAddress = Math.min(minAddress, absoluteAddress);
        maxAddress = Math.max(maxAddress, endAddress - 1);
      }
      continue;
    }

    if (type === 0x01) {
      if (byteCount !== 0 || address !== 0) {
        throw new Error(`Intel HEX dòng ${lineNumber}: EOF record không hợp lệ.`);
      }
      eofSeen = true;
      continue;
    }

    if (type === 0x02) {
      if (byteCount !== 2 || address !== 0) {
        throw new Error(`Intel HEX dòng ${lineNumber}: extended segment record không hợp lệ.`);
      }
      baseAddress = ((data[0] << 8) | data[1]) * 16;
      continue;
    }

    if (type === 0x04) {
      if (byteCount !== 2 || address !== 0) {
        throw new Error(`Intel HEX dòng ${lineNumber}: extended linear record không hợp lệ.`);
      }
      baseAddress = ((data[0] << 8) | data[1]) * 0x10000;
      continue;
    }

    throw new Error(`Intel HEX dòng ${lineNumber}: record type 0x${type.toString(16).padStart(2, "0")} chưa hỗ trợ.`);
  }

  if (!eofSeen) throw new Error("Intel HEX thiếu EOF record.");
  if (!bytesLoaded) throw new Error("Intel HEX không chứa byte chương trình nào.");

  return Object.freeze({
    flash,
    bytesLoaded,
    minAddress,
    maxAddress,
  });
}

export function createAvrRunner(hexText, callbacks = {}) {
  const firmware = parseIntelHex(hexText);
  const program = new Uint16Array(ATMEGA328P_FLASH_BYTES / 2);
  new Uint8Array(program.buffer).set(firmware.flash);
  const cpu = new CPU(program, ATMEGA328P_SRAM_BYTES);
  let watchdogResets = 0;

  if (callbacks !== null && typeof callbacks !== "object") {
    throw new TypeError("callbacks phải là object nếu được cung cấp.");
  }
  const onWatchdogReset = callbacks?.onWatchdogReset;
  if (onWatchdogReset !== undefined && typeof onWatchdogReset !== "function") {
    throw new TypeError("callbacks.onWatchdogReset phải là function.");
  }
  cpu.onWatchdogReset = () => {
    watchdogResets += 1;
    onWatchdogReset?.({ pcWords: cpu.pc, cycles: cpu.cycles });
  };

  function snapshot() {
    return Object.freeze({
      pcWords: cpu.pc,
      pcBytes: cpu.pc * 2,
      cycles: cpu.cycles,
      sp: cpu.SP,
      sreg: cpu.SREG,
      watchdogResets,
      registers: Object.freeze(Array.from(cpu.data.subarray(0, 32))),
    });
  }

  function ensurePcInFlash() {
    if (!Number.isInteger(cpu.pc) || cpu.pc < 0 || cpu.pc >= program.length) {
      throw new RangeError(`Program counter nằm ngoài flash: ${cpu.pc}.`);
    }
  }

  function step() {
    ensurePcInFlash();
    const beforeCycles = cpu.cycles;
    const beforePcWords = cpu.pc;
    avrInstruction(cpu);
    cpu.tick();
    return Object.freeze({
      beforePcWords,
      afterPcWords: cpu.pc,
      cycles: cpu.cycles - beforeCycles,
      snapshot: snapshot(),
    });
  }

  function runCycles(cycleBudget) {
    assertIntegerInRange(cycleBudget, 1, MAX_RUN_CYCLES, "cycleBudget");
    const startCycles = cpu.cycles;
    let instructions = 0;
    while (cpu.cycles - startCycles < cycleBudget) {
      ensurePcInFlash();
      avrInstruction(cpu);
      cpu.tick();
      instructions += 1;
    }
    return Object.freeze({
      requestedCycles: cycleBudget,
      executedCycles: cpu.cycles - startCycles,
      instructions,
      snapshot: snapshot(),
    });
  }

  function readData(address) {
    assertIntegerInRange(address, 0, cpu.data.length - 1, "address");
    return cpu.readData(address);
  }

  function reset() {
    cpu.reset();
    return snapshot();
  }

  return Object.freeze({
    capabilities: AVR_RUNTIME_CAPABILITIES,
    provenance: AVR8JS_PROVENANCE,
    firmware: Object.freeze({
      bytesLoaded: firmware.bytesLoaded,
      minAddress: firmware.minAddress,
      maxAddress: firmware.maxAddress,
    }),
    step,
    runCycles,
    readData,
    reset,
    snapshot,
  });
}
