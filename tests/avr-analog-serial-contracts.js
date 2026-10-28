import { CPU } from "../assets/vendor/avr/cpu.js";
import { avrInstruction } from "../assets/vendor/avr/instruction.js";
import {
  AVR_ANALOG_SERIAL_CAPABILITIES,
  AVR_ANALOG_SERIAL_LIMITS,
  AVR_ANALOG_SERIAL_REGISTERS,
  createAvrAnalogSerial,
} from "../src/avr-analog-serial.js";

const R = AVR_ANALOG_SERIAL_REGISTERS;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, message) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown, `${message}: expected an exception`);
  assert(pattern.test(String(thrown.message)), `${message}: ${thrown.message}`);
}

function makeCpu(words = [0xffff]) {
  return new CPU(new Uint16Array(words), 2 * 1024);
}

function advance(cpu, cycles) {
  cpu.cycles += cycles;
  cpu.tick();
}

function startAdc(cpu, adcsra = 0x87) {
  cpu.writeData(R.ADCSRA, adcsra | 0x40);
}

function ldi(register, value) {
  const d = register - 16;
  return 0xe000 | ((value & 0xf0) << 4) | (d << 4) | (value & 0x0f);
}

function sts(register) {
  return 0x9200 | (register << 4);
}

export function runAvrAnalogSerialContracts() {
  const checks = [];
  const check = (name, fn) => {
    fn();
    checks.push(name);
  };

  check("capability-boundary", () => {
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.mcu === "atmega328p", "MCU boundary missing");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.adcSingleConversion === true, "ADC single conversion must be supported");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.adcAutoTrigger === false, "ADC auto trigger must stay unsupported");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.usartTx === true, "USART TX must be supported");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.usartRx === false, "USART RX must stay unsupported");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.synchronousClock === false, "synchronous clock must stay unsupported");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.wallClock === false, "wall-clock timing must stay unsupported");
    assert(AVR_ANALOG_SERIAL_LIMITS.maxTxCaptureBytes === 4096, "TX capture must be bounded");
  });

  check("register-map-atmega328p", () => {
    assert(R.ADCL === 0x78 && R.ADCH === 0x79 && R.ADCSRA === 0x7a && R.ADMUX === 0x7c, "ADC register map mismatch");
    assert(R.UCSR0A === 0xc0 && R.UCSR0B === 0xc1 && R.UCSR0C === 0xc2, "USART control register map mismatch");
    assert(R.UBRR0L === 0xc4 && R.UBRR0H === 0xc5 && R.UDR0 === 0xc6, "USART data register map mismatch");
  });

  check("hook-conflict-is-atomic", () => {
    const cpu = makeCpu();
    const existing = () => false;
    cpu.writeHooks[R.ADCSRA] = existing;
    expectThrow(() => createAvrAnalogSerial(cpu), /hook|đã.*dùng/i, "hook conflict");
    assert(cpu.writeHooks[R.ADCSRA] === existing, "existing hook must stay untouched");
    assert(cpu.writeHooks[R.UCSR0A] === undefined, "adapter must not install partial hooks after conflict");
  });

  check("adc-first-and-subsequent-conversion-timing", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setAnalogInputMillivolts(0, 2500);
    cpu.writeData(R.ADMUX, 0x40); // AVCC reference, ADC0, right adjusted
    cpu.writeData(R.ADCSRA, 0x87); // ADEN + prescaler /128
    startAdc(cpu);
    assert(cpu.data[R.ADCSRA] & 0x40, "ADSC must stay set during conversion");
    advance(cpu, 3199);
    assert(cpu.data[R.ADCSRA] & 0x40, "first conversion must require 25 ADC clocks");
    advance(cpu, 1);
    assert((cpu.data[R.ADCSRA] & 0x40) === 0, "ADSC must clear on completion");
    assert(cpu.data[R.ADCSRA] & 0x10, "ADIF must set on completion");
    assert(cpu.data[R.ADCL] === 0x00 && cpu.data[R.ADCH] === 0x02, "2500 mV / 5000 mV must produce raw 512");

    cpu.writeData(R.ADCSRA, 0x97); // preserve ADEN/prescaler; W1C ADIF
    assert((cpu.data[R.ADCSRA] & 0x10) === 0, "writing one to ADIF must clear it");
    startAdc(cpu);
    advance(cpu, 1663);
    assert(cpu.data[R.ADCSRA] & 0x40, "subsequent conversion must require 13 ADC clocks");
    advance(cpu, 1);
    assert((cpu.data[R.ADCSRA] & 0x40) === 0, "second conversion must complete after 13 ADC clocks");

    cpu.writeData(R.ADCSRA, 0x00); // disable ADC
    cpu.writeData(R.ADCSRA, 0xc7); // enable + start in the same register write
    advance(cpu, 3199);
    assert(cpu.data[R.ADCSRA] & 0x40, "first conversion after re-enable must again require 25 ADC clocks");
    advance(cpu, 1);
    assert((cpu.data[R.ADCSRA] & 0x40) === 0, "re-enabled first conversion must complete at 25 ADC clocks");
    peripheral.dispose();
  });

  check("adc-result-lock-and-left-adjust", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setAnalogInputMillivolts(0, 2500);
    cpu.writeData(R.ADMUX, 0x40);
    cpu.writeData(R.ADCSRA, 0x87);
    startAdc(cpu); advance(cpu, 3200);
    assert(cpu.readData(R.ADCL) === 0x00, "ADCL read mismatch");

    peripheral.setAnalogInputMillivolts(0, 3750);
    startAdc(cpu); advance(cpu, 1664);
    assert(cpu.data[R.ADCL] === 0x00 && cpu.data[R.ADCH] === 0x02, "locked ADC result registers must not update");
    assert(peripheral.snapshot().adc.lostResults === 1, "conversion completing while data locked must be counted as lost");
    assert(cpu.readData(R.ADCH) === 0x02, "ADCH read must return old locked high byte");

    startAdc(cpu); advance(cpu, 1664);
    assert(cpu.data[R.ADCL] === 0x00 && cpu.data[R.ADCH] === 0x03, "unlocked conversion must write raw 768");
    cpu.writeData(R.ADMUX, 0x60); // AVCC + ADLAR + ADC0
    peripheral.setAnalogInputMillivolts(0, 5000);
    startAdc(cpu); advance(cpu, 1664);
    assert(cpu.data[R.ADCH] === 0xff && cpu.data[R.ADCL] === 0xc0, "left-adjusted raw 1023 layout mismatch");
    peripheral.dispose();
  });

  check("adc-fixed-input-and-mode-negative-contracts", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.ADMUX, 0x41); // AVCC / ADC1, no fixed value yet
    cpu.writeData(R.ADCSRA, 0x87);
    expectThrow(() => startAdc(cpu), /fixed|cố định|ADC1/i, "missing fixed ADC input");
    peripheral.setAnalogInputMillivolts(1, 1000);
    expectThrow(() => cpu.writeData(R.ADCSRA, 0xe7), /auto|trigger|free-running/i, "ADC auto trigger");
    cpu.writeData(R.ADMUX, 0x81); // reserved REFS=10
    expectThrow(() => startAdc(cpu), /reference|tham chiếu|reserved/i, "reserved ADC reference");
    cpu.writeData(R.ADMUX, 0x48); // temperature mux
    expectThrow(() => startAdc(cpu), /temperature|nhiệt/i, "temperature sensor unsupported");
    expectThrow(() => peripheral.setAnalogInputMillivolts(8, 1000), /channel/i, "ADC channel bound");
    expectThrow(() => peripheral.setAnalogInputMillivolts(0, 6000), /millivolt|mV/i, "ADC millivolt bound");
    peripheral.dispose();
  });

  check("adc-interrupt-flag-queue-and-w1c", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setAnalogInputMillivolts(0, 1000);
    cpu.writeData(R.ADMUX, 0x40);
    cpu.writeData(R.ADCSRA, 0x8f); // ADEN + ADIE + /128
    startAdc(cpu, 0x8f);
    advance(cpu, 3200);
    assert(cpu.data[R.ADCSRA] & 0x10, "ADC completion must set ADIF");
    assert(cpu.nextInterrupt === 0x2a, `ADC interrupt vector must be queued at 0x2A, got ${cpu.nextInterrupt}`);
    cpu.writeData(R.ADCSRA, cpu.data[R.ADCSRA] | 0x10);
    assert((cpu.data[R.ADCSRA] & 0x10) === 0, "ADIF W1C must clear the flag");
    assert(cpu.nextInterrupt === -1, "ADIF W1C must clear pending ADC interrupt");
    peripheral.dispose();
  });

  check("adc-explicit-reference-millivolts", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setReferenceMillivolts("avcc", 3300);
    peripheral.setAnalogInputMillivolts(0, 1650);
    cpu.writeData(R.ADMUX, 0x40);
    cpu.writeData(R.ADCSRA, 0x87);
    startAdc(cpu); advance(cpu, 3200);
    assert(cpu.data[R.ADCL] === 0x00 && cpu.data[R.ADCH] === 0x02,
      "1650 mV / 3300 mV AVCC reference must produce raw 512");
    expectThrow(() => peripheral.setReferenceMillivolts("internal", 1100), /avcc|aref/i, "internal reference is fixed, not caller-settable");
    expectThrow(() => peripheral.setReferenceMillivolts("aref", 999), /reference.*mV|millivolt/i, "reference lower bound");
    peripheral.dispose();
  });

  check("real-avr-sts-starts-adc-hook", () => {
    const program = [
      ldi(16, 0x40),
      sts(16), R.ADMUX,
      ldi(16, 0xc7),
      sts(16), R.ADCSRA,
      0xcfff,
    ];
    const cpu = makeCpu(program);
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setAnalogInputMillivolts(0, 2500);
    for (let index = 0; index < 4; index += 1) {
      avrInstruction(cpu);
      cpu.tick();
    }
    assert(peripheral.snapshot().adc.converting === true, "real AVR STS to ADCSRA must start ADC conversion through hook");
    advance(cpu, peripheral.snapshot().adc.cyclesRemaining);
    assert(cpu.data[R.ADCL] === 0x00 && cpu.data[R.ADCH] === 0x02, "real AVR STS-started conversion must produce raw 512");
    peripheral.dispose();
  });

  check("usart-reset-and-9600-8n1-configuration", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    assert(cpu.data[R.UCSR0A] === 0x20, "USART reset must start with UDRE set");
    assert(cpu.data[R.UCSR0C] === 0x06, "USART reset must default to 8-bit async frame");
    cpu.writeData(R.UBRR0H, 0);
    cpu.writeData(R.UBRR0L, 103);
    cpu.writeData(R.UCSR0C, 0x06);
    cpu.writeData(R.UCSR0B, 0x18); // RXEN + TXEN; RX remains explicitly unsupported
    const state = peripheral.snapshot().usart;
    assert(state.baudRate === 9615, `expected 9615 baud from UBRR=103, got ${state.baudRate}`);
    assert(state.cyclesPerFrame === 16640, `expected 16640 cycles per 8N1 frame, got ${state.cyclesPerFrame}`);
    assert(state.txEnabled === true && state.rxEnabled === true, "TX/RX enable register bits must be observable");
    assert(AVR_ANALOG_SERIAL_CAPABILITIES.usartRx === false, "RX enable bit must not imply RX support");
    peripheral.dispose();
  });

  check("usart-two-stage-tx-buffer-and-capture", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.UBRR0L, 103);
    cpu.writeData(R.UCSR0B, 0x08); // TXEN
    cpu.writeData(R.UDR0, 0x41);
    assert(peripheral.getTxBytes().length === 0, "byte must not be captured before frame completes");
    assert(cpu.data[R.UCSR0A] & 0x20, "UDRE must set once first byte moves to shift register");
    assert((cpu.data[R.UCSR0A] & 0x40) === 0, "TXC must clear while transmission is pending");
    cpu.writeData(R.UDR0, 0x42);
    assert((cpu.data[R.UCSR0A] & 0x20) === 0, "UDRE must clear while transmit buffer is full");
    cpu.writeData(R.UDR0, 0x43); // ignored: UDRE=0
    assert(peripheral.snapshot().usart.ignoredWrites === 1, "write while UDRE=0 must be ignored");

    advance(cpu, 16639);
    assert(peripheral.getTxBytes().length === 0, "first frame must not complete early");
    advance(cpu, 1);
    assert(Array.from(peripheral.getTxBytes()).join(",") === "65", "first completed frame must capture A");
    assert(cpu.data[R.UCSR0A] & 0x20, "UDRE must set after buffered byte moves to shift register");
    assert((cpu.data[R.UCSR0A] & 0x40) === 0, "TXC must remain clear while second frame is pending");
    advance(cpu, 16640);
    assert(Array.from(peripheral.getTxBytes()).join(",") === "65,66", "only accepted completed bytes A,B may be captured");
    assert(cpu.data[R.UCSR0A] & 0x40, "TXC must set after final frame completes");

    const copy = peripheral.getTxBytes();
    copy[0] = 0;
    assert(peripheral.getTxBytes()[0] === 65, "TX capture getter must return a defensive copy");
    cpu.writeData(R.UCSR0A, 0x40); // W1C TXC
    assert((cpu.data[R.UCSR0A] & 0x40) === 0, "TXC must clear when one is written");
    assert(cpu.data[R.UCSR0A] & 0x20, "TXC clear must not clear UDRE");
    peripheral.dispose();
  });

  check("usart-disabled-buffer-waits-for-tx-enable", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.UDR0, 0x5a);
    assert((cpu.data[R.UCSR0A] & 0x20) === 0, "UDRE must clear when disabled transmitter buffer receives a byte");
    advance(cpu, 1000);
    assert(peripheral.getTxBytes().length === 0, "disabled transmitter must not emit bytes");
    cpu.writeData(R.UCSR0B, 0x08);
    const frameCycles = peripheral.snapshot().usart.cyclesPerFrame;
    advance(cpu, frameCycles);
    assert(Array.from(peripheral.getTxBytes()).join(",") === "90", "buffered Z must transmit only after TX enable");
    peripheral.dispose();
  });

  check("usart-udre-and-txc-interrupt-flags", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.UBRR0L, 0);
    cpu.writeData(R.UCSR0B, 0x28); // UDRIE + TXEN
    assert(cpu.nextInterrupt === 0x26, `UDRE interrupt must queue at 0x26, got ${cpu.nextInterrupt}`);
    cpu.writeData(R.UDR0, 0x51);
    assert(cpu.nextInterrupt === 0x26, "UDRE may become pending again once UDR moves to the empty shift register");
    cpu.writeData(R.UCSR0B, 0x48); // TXCIE + TXEN; disables UDRIE
    assert(cpu.nextInterrupt === -1, "disabling UDRIE must clear pending UDRE interrupt");
    advance(cpu, peripheral.snapshot().usart.cyclesPerFrame);
    assert(cpu.data[R.UCSR0A] & 0x40, "completed frame must set TXC");
    assert(cpu.nextInterrupt === 0x28, `TXC interrupt must queue at 0x28, got ${cpu.nextInterrupt}`);
    cpu.writeData(R.UCSR0A, 0x40);
    assert(cpu.nextInterrupt === -1 && !(cpu.data[R.UCSR0A] & 0x40), "TXC W1C must clear flag and pending interrupt");
    peripheral.dispose();
  });

  check("usart-unsupported-rx-sync-and-9bit-fail-closed", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.UCSR0B, 0x18); // Serial.begin-style RXEN + TXEN is allowed
    expectThrow(() => cpu.readData(R.UDR0), /RX|receive|nhận/i, "USART RX read");
    expectThrow(() => cpu.writeData(R.UCSR0C, 0x46), /sync|MSPI|đồng bộ/i, "synchronous USART mode");
    expectThrow(() => cpu.writeData(R.UCSR0B, 0x0c), /9-bit|character|ký tự/i, "9-bit USART mode");
    expectThrow(() => cpu.writeData(R.UCSR0C, 0x04), /8-bit|character|ký tự/i, "7-bit USART mode");
    peripheral.dispose();
  });

  check("real-avr-sts-writes-drive-usart-hook", () => {
    const program = [
      ldi(16, 0x08),
      sts(16), R.UCSR0B,
      ldi(16, 0x41),
      sts(16), R.UDR0,
      0xcfff,
    ];
    const cpu = makeCpu(program);
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.UBRR0L, 103);
    for (let index = 0; index < 4; index += 1) {
      avrInstruction(cpu);
      cpu.tick();
    }
    assert(peripheral.snapshot().usart.txShiftBusy === true, "STS to UDR0 must reach the installed CPU hook");
    advance(cpu, peripheral.snapshot().usart.cyclesPerFrame + 4);
    assert(Array.from(peripheral.getTxBytes()).join(",") === "65", "real AVR STS must produce completed UART byte A");
    peripheral.dispose();
  });

  check("tx-capture-hard-bound", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    cpu.writeData(R.UCSR0B, 0x08);
    const frameCycles = peripheral.snapshot().usart.cyclesPerFrame;
    for (let index = 0; index < AVR_ANALOG_SERIAL_LIMITS.maxTxCaptureBytes + 1; index += 1) {
      cpu.writeData(R.UDR0, index & 0xff);
      advance(cpu, frameCycles);
    }
    assert(peripheral.getTxBytes().length === AVR_ANALOG_SERIAL_LIMITS.maxTxCaptureBytes, "TX capture must stop at hard bound");
    assert(peripheral.snapshot().usart.droppedCaptureBytes === 1, "overflow byte must be counted, not stored unboundedly");
    peripheral.clearTx();
    assert(peripheral.getTxBytes().length === 0 && peripheral.snapshot().usart.droppedCaptureBytes === 0,
      "clearTx must clear bounded host capture and dropped count");
    peripheral.dispose();
  });

  check("dispose-cancels-pending-peripheral-events", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setAnalogInputMillivolts(0, 2000);
    cpu.writeData(R.ADMUX, 0x40);
    cpu.writeData(R.ADCSRA, 0x87);
    startAdc(cpu);
    cpu.writeData(R.UCSR0B, 0x08);
    cpu.writeData(R.UDR0, 0x58);
    assert(cpu.nextClockEvent !== null, "fixture must have pending peripheral clock events");
    peripheral.dispose();
    assert(cpu.nextClockEvent === null, "dispose must cancel adapter-owned ADC/TX events");
    advance(cpu, 100000);
    assert(peripheral.getTxBytes().length === 0, "disposed pending TX must never become captured output");
    assert((cpu.data[R.ADCSRA] & 0x10) === 0, "disposed pending ADC must never set ADIF later");
  });

  check("reset-dispose-and-bounds", () => {
    const cpu = makeCpu();
    const peripheral = createAvrAnalogSerial(cpu);
    peripheral.setAnalogInputMillivolts(0, 1234);
    cpu.writeData(R.UBRR0L, 103);
    cpu.writeData(R.UCSR0B, 0x08);
    cpu.writeData(R.UDR0, 0x41);
    peripheral.reset();
    assert(cpu.data[R.UCSR0A] === 0x20 && cpu.data[R.UCSR0C] === 0x06, "peripheral reset register values mismatch");
    assert(peripheral.snapshot().analogInputsMillivolts[0] === 1234, "external fixed analog input must survive MCU peripheral reset");
    assert(peripheral.getTxBytes().length === 0, "unfinished TX must not become captured output on reset");
    peripheral.clearTx();
    assert(peripheral.snapshot().usart.droppedCaptureBytes === 0, "clearTx must reset host capture counters");

    peripheral.dispose();
    assert(cpu.writeHooks[R.ADCSRA] === undefined && cpu.readHooks[R.ADCL] === undefined, "dispose must restore ADC hooks");
    assert(cpu.writeHooks[R.UDR0] === undefined && cpu.readHooks[R.UDR0] === undefined, "dispose must restore USART hooks");
    cpu.writeData(R.UDR0, 0x55);
    assert(cpu.data[R.UDR0] === 0x55, "CPU must return to raw register writes after dispose");
    expectThrow(() => peripheral.setAnalogInputMillivolts(0, 1), /disposed|đã.*hủy|detached/i, "method after dispose");
    peripheral.dispose(); // idempotent
  });

  return Object.freeze({
    passed: checks.length,
    checks: Object.freeze([...checks]),
    api: "createAvrAnalogSerial(cpu)",
  });
}
