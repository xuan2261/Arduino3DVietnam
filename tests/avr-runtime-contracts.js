import {
  AVR8JS_PROVENANCE,
  AVR_RUNTIME_CAPABILITIES,
  createAvrRunner,
  parseIntelHex,
} from "../src/avr-runtime.js";

const PROGRAM_HEX = [
  ":0A0000000AE2039500930001FFCF10",
  ":00000001FF",
].join("\n");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, message) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown, `${message}: expected an exception`);
  assert(pattern.test(String(thrown.message)), `${message}: ${thrown.message}`);
}

function makeDataRecord(address, data) {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, 0x00, ...data];
  const checksum = (-bytes.reduce((sum, value) => sum + value, 0)) & 0xff;
  return `:${[...bytes, checksum].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function runAvrRuntimeContracts() {
  const checks = [];
  const check = (name, fn) => {
    fn();
    checks.push(name);
  };

  check("provenance-pinned", () => {
    assert(AVR8JS_PROVENANCE.version === "0.21.1", "unexpected avr8js version");
    assert(
      AVR8JS_PROVENANCE.commit === "bee6f0a94e0e27786f6bc21aee3c775849fb50fd",
      "unexpected avr8js commit",
    );
    assert(AVR8JS_PROVENANCE.license === "MIT", "unexpected license");
  });

  check("capability-boundary", () => {
    assert(AVR_RUNTIME_CAPABILITIES.cpuInstructions === true, "CPU execution must be enabled");
    assert(AVR_RUNTIME_CAPABILITIES.intelHex === true, "Intel HEX must be enabled");
    for (const key of ["gpio", "timers", "adc", "eeprom", "spi", "twi", "usart", "serial", "externalHardware"]) {
      assert(AVR_RUNTIME_CAPABILITIES[key] === false, `${key} must stay explicitly unsupported`);
    }
  });

  check("strict-intel-hex", () => {
    const parsed = parseIntelHex(PROGRAM_HEX);
    assert(parsed.bytesLoaded === 10, "expected 10 program bytes");
    assert(parsed.minAddress === 0 && parsed.maxAddress === 9, "unexpected loaded range");
    expectThrow(
      () => parseIntelHex(PROGRAM_HEX.replace("FFCF10", "FFCF11")),
      /checksum/i,
      "bad checksum",
    );
    expectThrow(
      () => parseIntelHex(PROGRAM_HEX.split("\n")[0]),
      /EOF/i,
      "missing EOF",
    );
    const outsideFlash = `${makeDataRecord(0x8000, [0x00])}\n:00000001FF`;
    expectThrow(() => parseIntelHex(outsideFlash), /ngoài flash/i, "flash bounds");
  });

  check("genuine-avr-instruction-execution", () => {
    const runner = createAvrRunner(PROGRAM_HEX);
    assert(runner.snapshot().pcWords === 0, "runner must start at reset vector");
    const ldi = runner.step();
    assert(ldi.afterPcWords === 1, "LDI must advance PC by one word");
    assert(ldi.snapshot.registers[16] === 0x2a, "LDI must load R16 = 0x2A");
    const inc = runner.step();
    assert(inc.snapshot.registers[16] === 0x2b, "INC must increment R16");
    const sts = runner.step();
    assert(sts.afterPcWords === 4, "STS must consume its two-word encoding");
    assert(runner.readData(0x100) === 0x2b, "STS must write real AVR data memory");
    assert(sts.cycles === 2, "STS cycle accounting must come from the AVR engine");
    const loop = runner.runCycles(12);
    assert(loop.instructions > 0, "runCycles must execute instructions");
    assert(loop.snapshot.pcWords === 4, "RJMP -1 must remain on its own instruction");
  });

  check("bounded-execution-and-reset-semantics", () => {
    const runner = createAvrRunner(PROGRAM_HEX);
    runner.step();
    runner.step();
    runner.step();
    assert(runner.readData(0x100) === 0x2b, "fixture SRAM write missing");
    const reset = runner.reset();
    assert(reset.pcWords === 0, "CPU reset must restore reset vector");
    assert(runner.readData(0x100) === 0x2b, "avr8js reset intentionally preserves SRAM");
    expectThrow(() => runner.runCycles(100_001), /cycleBudget/i, "cycle guard");
  });

  return Object.freeze({
    passed: checks.length,
    checks: Object.freeze([...checks]),
    engine: `${AVR8JS_PROVENANCE.engine}@${AVR8JS_PROVENANCE.version}`,
  });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function runBundledFirmwareContract(basePath = "/assets/firmware") {
  const manifestResponse = await fetch(`${basePath}/manifest.json`, { cache: "no-store" });
  assert(manifestResponse.ok, `firmware manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  const lesson = manifest.lessons?.find((item) => item.id === 1);
  assert(lesson?.file, "manifest must contain lesson 01 firmware");
  assert(/^[0-9a-f]{64}$/.test(lesson.hex_sha256), "manifest lesson 01 must pin hex_sha256");

  const firmwareResponse = await fetch(`${basePath}/${lesson.file}`, { cache: "no-store" });
  assert(firmwareResponse.ok, `firmware HTTP ${firmwareResponse.status}`);
  const firmwareBytes = await firmwareResponse.arrayBuffer();
  const actualSha256 = await sha256Hex(firmwareBytes);
  assert(actualSha256 === lesson.hex_sha256, "lesson 01 firmware SHA-256 does not match manifest");

  const hexText = new TextDecoder("utf-8", { fatal: true }).decode(firmwareBytes);
  const runner = createAvrRunner(hexText);
  const result = runner.runCycles(100_000);
  const ddrb = runner.readData(0x24);
  const portb = runner.readData(0x25);
  assert((ddrb & 0x20) !== 0, "compiled lesson 01 must configure Arduino pin 13 / PB5 as output");
  assert((portb & 0x20) !== 0, "compiled lesson 01 must drive Arduino pin 13 / PB5 high");

  return Object.freeze({
    passed: 2,
    file: lesson.file,
    sha256: actualSha256,
    cycles: result.snapshot.cycles,
    ddrb,
    portb,
  });
}
