/**
 * Bounded ATmega328P ADC + USART0 TX adapter for the vendored avr8js CPU.
 *
 * This module intentionally models only register-visible behavior that can be
 * driven through the CPU's public data hooks and clock-event queue. It does not
 * synthesize sensor/Serial output from lesson state.
 */

export const AVR_ANALOG_SERIAL_REGISTERS = Object.freeze({
  ADCL: 0x78,
  ADCH: 0x79,
  ADCSRA: 0x7a,
  ADCSRB: 0x7b,
  ADMUX: 0x7c,
  DIDR0: 0x7e,
  UCSR0A: 0xc0,
  UCSR0B: 0xc1,
  UCSR0C: 0xc2,
  UBRR0L: 0xc4,
  UBRR0H: 0xc5,
  UDR0: 0xc6,
});

export const AVR_ANALOG_SERIAL_LIMITS = Object.freeze({
  cpuClockHz: 16_000_000,
  adcChannels: 8,
  minReferenceMillivolts: 1000,
  maxReferenceMillivolts: 5500,
  maxAnalogMillivolts: 5500,
  maxTxCaptureBytes: 4096,
});

export const AVR_ANALOG_SERIAL_CAPABILITIES = Object.freeze({
  mcu: "atmega328p",
  cpuClockHz: AVR_ANALOG_SERIAL_LIMITS.cpuClockHz,
  adcSingleConversion: true,
  adcAutoTrigger: false,
  adcFreeRunning: false,
  adcTemperatureSensor: false,
  adcInterrupt: true,
  usartTx: true,
  usartTxInterrupts: true,
  usartRx: false,
  usartAsync8Bit: true,
  usartSync: false,
  usartMspi: false,
  synchronousClock: false,
  wallClock: false,
});

const R = AVR_ANALOG_SERIAL_REGISTERS;

// ADCSRA
const ADPS_MASK = 0x07;
const ADIE = 0x08;
const ADIF = 0x10;
const ADATE = 0x20;
const ADSC = 0x40;
const ADEN = 0x80;

// ADMUX
const ADLAR = 0x20;
const REFS_MASK = 0xc0;
const MUX_MASK = 0x0f;

// UCSR0A
const MPCM = 0x01;
const U2X = 0x02;
const TXC = 0x40;
const UDRE = 0x20;

// UCSR0B
const UCSZ2 = 0x04;
const TXEN = 0x08;
const RXEN = 0x10;
const UDRIE = 0x20;
const TXCIE = 0x40;

// UCSR0C
const UCSZ0 = 0x02;
const UCSZ1 = 0x04;
const USBS = 0x08;
const UPM0 = 0x10;
const UPM1 = 0x20;
const UMSEL0 = 0x40;
const UMSEL1 = 0x80;

const ADC_INTERRUPT = Object.freeze({
  address: 0x2a,
  flagRegister: R.ADCSRA,
  flagMask: ADIF,
  enableRegister: R.ADCSRA,
  enableMask: ADIE,
});

const USART_UDRE_INTERRUPT = Object.freeze({
  address: 0x26,
  flagRegister: R.UCSR0A,
  flagMask: UDRE,
  enableRegister: R.UCSR0B,
  enableMask: UDRIE,
  // UDRE is a level-like condition: it remains pending until UDR0 is written
  // or UDRIE is disabled.
  constant: true,
});

const USART_TXC_INTERRUPT = Object.freeze({
  address: 0x28,
  flagRegister: R.UCSR0A,
  flagMask: TXC,
  enableRegister: R.UCSR0B,
  enableMask: TXCIE,
});

function assertCpu(cpu) {
  if (!cpu || typeof cpu !== "object" || !(cpu.data instanceof Uint8Array)) {
    throw new TypeError("cpu phải là instance CPU avr8js có data Uint8Array.");
  }
  if (cpu.data.length <= R.UDR0 || !Array.isArray(cpu.readHooks) || !Array.isArray(cpu.writeHooks)) {
    throw new TypeError("cpu không có register space/readHooks/writeHooks cần thiết.");
  }
  for (const method of [
    "addClockEvent", "clearClockEvent", "setInterruptFlag", "updateInterruptEnable",
    "clearInterrupt", "clearInterruptByFlag",
  ]) {
    if (typeof cpu[method] !== "function") throw new TypeError(`cpu thiếu hook ${method}().`);
  }
}

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} phải là số nguyên trong khoảng ${min}..${max}.`);
  }
}

function mergeMasked(value, oldValue, mask) {
  const actualMask = mask === undefined ? 0xff : mask & 0xff;
  return ((oldValue & ~actualMask) | (value & actualMask)) & 0xff;
}

function adcPrescaler(adcsra) {
  switch (adcsra & ADPS_MASK) {
    case 0:
    case 1: return 2;
    case 2: return 4;
    case 3: return 8;
    case 4: return 16;
    case 5: return 32;
    case 6: return 64;
    default: return 128;
  }
}

function freezeSnapshot(value) {
  return Object.freeze(value);
}

export function createAvrAnalogSerial(cpu) {
  assertCpu(cpu);

  const readHookAddresses = [R.ADCL, R.ADCH, R.UDR0];
  const writeHookAddresses = [
    R.ADCL, R.ADCH, R.ADCSRA,
    R.UCSR0A, R.UCSR0B, R.UCSR0C, R.UBRR0L, R.UBRR0H, R.UDR0,
  ];
  for (const address of readHookAddresses) {
    if (cpu.readHooks[address] !== undefined && cpu.readHooks[address] !== null) {
      throw new Error(`CPU read hook 0x${address.toString(16)} đã được dùng.`);
    }
  }
  for (const address of writeHookAddresses) {
    if (cpu.writeHooks[address] !== undefined && cpu.writeHooks[address] !== null) {
      throw new Error(`CPU write hook 0x${address.toString(16)} đã được dùng.`);
    }
  }

  const previousReadHooks = new Map(readHookAddresses.map(address => [address, cpu.readHooks[address]]));
  const previousWriteHooks = new Map(writeHookAddresses.map(address => [address, cpu.writeHooks[address]]));

  const analogInputs = new Array(AVR_ANALOG_SERIAL_LIMITS.adcChannels).fill(null);
  const references = { avcc: 5000, aref: 5000 };
  const txCapture = [];
  let disposed = false;

  let adcConverting = false;
  let adcFirstConversion = true;
  let adcDataLocked = false;
  let adcEvent = null;
  let adcDueCycle = null;
  let adcLastConversionRaw = null;
  let adcCompleted = 0;
  let adcLostResults = 0;

  let txShiftBusy = false;
  let txShiftByte = 0;
  let txBufferFull = false;
  let txBufferByte = 0;
  let txEvent = null;
  let txDueCycle = null;
  let txCurrentFrameCycles = 0;
  let txIgnoredWrites = 0;
  let txDroppedCaptureBytes = 0;

  const ensureActive = () => {
    if (disposed) throw new Error("AVR analog/serial peripheral đã disposed/detached.");
  };

  function clearScheduledAdc() {
    if (adcEvent) cpu.clearClockEvent(adcEvent);
    adcEvent = null;
    adcDueCycle = null;
    adcConverting = false;
  }

  function clearScheduledTx() {
    if (txEvent) cpu.clearClockEvent(txEvent);
    txEvent = null;
    txDueCycle = null;
    txShiftBusy = false;
    txBufferFull = false;
  }

  function referenceMillivolts(admux) {
    switch ((admux & REFS_MASK) >> 6) {
      case 0: return references.aref;
      case 1: return references.avcc;
      case 3: return 1100;
      default: throw new RangeError("ADC reference REFS=10 là reserved trên ATmega328P.");
    }
  }

  function fixedInputMillivolts(admux) {
    const mux = admux & MUX_MASK;
    if (mux <= 7) {
      const value = analogInputs[mux];
      if (value === null) throw new RangeError(`ADC${mux} chưa có fixed analog input cố định.`);
      return value;
    }
    if (mux === 14) return 1100; // Internal 1.1 V bandgap channel.
    if (mux === 15) return 0; // GND.
    if (mux === 8) throw new RangeError("ADC temperature sensor chưa được mô hình hóa trong adapter này.");
    throw new RangeError(`ADC MUX ${mux} là reserved/unsupported trong adapter này.`);
  }

  function computeAdcRaw(admux) {
    const reference = referenceMillivolts(admux);
    const input = fixedInputMillivolts(admux);
    return Math.min(1023, Math.max(0, Math.floor((input / reference) * 1024)));
  }

  function completeAdc(raw) {
    if (disposed || !adcConverting) return;
    adcEvent = null;
    adcDueCycle = null;
    adcConverting = false;
    adcLastConversionRaw = raw;
    adcCompleted += 1;
    if (adcDataLocked) {
      // Datasheet: a result completing after ADCL was read and before ADCH is
      // read is lost; neither data register is updated.
      adcLostResults += 1;
    } else if (cpu.data[R.ADMUX] & ADLAR) {
      cpu.data[R.ADCL] = (raw << 6) & 0xff;
      cpu.data[R.ADCH] = (raw >> 2) & 0xff;
    } else {
      cpu.data[R.ADCL] = raw & 0xff;
      cpu.data[R.ADCH] = (raw >> 8) & 0x03;
    }
    cpu.data[R.ADCSRA] &= ~ADSC;
    cpu.setInterruptFlag(ADC_INTERRUPT);
  }

  function startAdcConversion(raw, cycles) {
    adcConverting = true;
    adcFirstConversion = false;
    const callback = () => completeAdc(raw);
    adcEvent = callback;
    adcDueCycle = cpu.cycles + Math.max(1, cycles);
    cpu.addClockEvent(callback, cycles);
  }

  function validateUsartFormat(ucsrb, ucsrc) {
    if (ucsrc & (UMSEL1 | UMSEL0)) {
      throw new RangeError("USART synchronous/MSPI clock mode chưa được hỗ trợ; chỉ async USART0 được mô hình hóa.");
    }
    const charSize = ((ucsrc & (UCSZ1 | UCSZ0)) >> 1) | (ucsrb & UCSZ2);
    if (charSize !== 3) {
      throw new RangeError("USART character size phải là 8-bit; 5/6/7/9-bit chưa được hỗ trợ.");
    }
    // UPM=01 is reserved on ATmega328P. Even/odd parity and 1/2 stop bits are
    // otherwise timing-equivalent for the byte capture implemented here.
    if (((ucsrc & (UPM1 | UPM0)) >> 4) === 1) {
      throw new RangeError("USART parity mode UPM=01 là reserved trên ATmega328P.");
    }
  }

  function usartMultiplier() {
    return cpu.data[R.UCSR0A] & U2X ? 8 : 16;
  }

  function usartUbrr() {
    return ((cpu.data[R.UBRR0H] & 0x0f) << 8) | cpu.data[R.UBRR0L];
  }

  function currentCyclesPerFrame() {
    validateUsartFormat(cpu.data[R.UCSR0B], cpu.data[R.UCSR0C]);
    const parityBits = cpu.data[R.UCSR0C] & UPM1 ? 1 : 0;
    const stopBits = cpu.data[R.UCSR0C] & USBS ? 2 : 1;
    const symbols = 1 + 8 + parityBits + stopBits;
    return (usartUbrr() + 1) * usartMultiplier() * symbols;
  }

  function currentBaudRate() {
    return Math.floor(AVR_ANALOG_SERIAL_LIMITS.cpuClockHz / ((usartUbrr() + 1) * usartMultiplier()));
  }

  function captureTxByte(value) {
    if (txCapture.length < AVR_ANALOG_SERIAL_LIMITS.maxTxCaptureBytes) {
      txCapture.push(value & 0xff);
    } else {
      txDroppedCaptureBytes += 1;
    }
  }

  function setUdre() {
    cpu.setInterruptFlag(USART_UDRE_INTERRUPT);
  }

  function clearUdre() {
    cpu.clearInterrupt(USART_UDRE_INTERRUPT);
  }

  function clearTxc() {
    cpu.clearInterrupt(USART_TXC_INTERRUPT);
  }

  function startTxShift(value) {
    txShiftBusy = true;
    txShiftByte = value & 0xff;
    txCurrentFrameCycles = currentCyclesPerFrame();
    if (!txBufferFull) setUdre();
    const callback = () => completeTxShift();
    txEvent = callback;
    txDueCycle = cpu.cycles + Math.max(1, txCurrentFrameCycles);
    cpu.addClockEvent(callback, txCurrentFrameCycles);
  }

  function completeTxShift() {
    if (disposed || !txShiftBusy) return;
    txEvent = null;
    txDueCycle = null;
    captureTxByte(txShiftByte);
    txShiftBusy = false;
    if (txBufferFull) {
      const next = txBufferByte;
      txBufferFull = false;
      setUdre();
      startTxShift(next);
      return;
    }
    setUdre();
    cpu.setInterruptFlag(USART_TXC_INTERRUPT);
  }

  function resetPeripheralRegisters() {
    clearScheduledAdc();
    clearScheduledTx();
    cpu.clearInterrupt(ADC_INTERRUPT);
    cpu.clearInterrupt(USART_UDRE_INTERRUPT);
    cpu.clearInterrupt(USART_TXC_INTERRUPT);

    cpu.data[R.ADCL] = 0;
    cpu.data[R.ADCH] = 0;
    cpu.data[R.ADCSRA] = 0;
    cpu.data[R.ADCSRB] = 0;
    cpu.data[R.ADMUX] = 0;
    cpu.data[R.DIDR0] = 0;
    adcFirstConversion = true;
    adcDataLocked = false;
    adcLastConversionRaw = null;
    adcCompleted = 0;
    adcLostResults = 0;

    cpu.data[R.UCSR0A] = UDRE;
    cpu.data[R.UCSR0B] = 0;
    cpu.data[R.UCSR0C] = UCSZ1 | UCSZ0;
    cpu.data[R.UBRR0L] = 0;
    cpu.data[R.UBRR0H] = 0;
    cpu.data[R.UDR0] = 0;
    txIgnoredWrites = 0;
    txCurrentFrameCycles = currentCyclesPerFrame();
  }

  cpu.readHooks[R.ADCL] = () => {
    adcDataLocked = true;
    return cpu.data[R.ADCL];
  };
  cpu.readHooks[R.ADCH] = () => {
    const value = cpu.data[R.ADCH];
    adcDataLocked = false;
    return value;
  };
  cpu.writeHooks[R.ADCL] = () => true; // ADC data registers are read-only for software writes.
  cpu.writeHooks[R.ADCH] = () => true;
  cpu.writeHooks[R.ADCSRA] = (value, oldValue, _address, mask = 0xff) => {
    const merged = mergeMasked(value, oldValue, mask);
    const wasEnabled = !!(oldValue & ADEN);
    const willBeEnabled = !!(merged & ADEN);
    const startRequested = !adcConverting && !!(merged & ADSC) && !!(merged & ADEN);
    let raw = null;
    let conversionCycles = null;
    if (startRequested) {
      if (merged & ADATE) {
        throw new RangeError("ADC auto-trigger/free-running (ADATE) chưa được hỗ trợ.");
      }
      raw = computeAdcRaw(cpu.data[R.ADMUX]);
      const firstAfterEnable = adcFirstConversion || (!wasEnabled && willBeEnabled);
      conversionCycles = (firstAfterEnable ? 25 : 13) * adcPrescaler(merged);
    }

    let next = (merged & ~ADIF) | (oldValue & ADIF);
    if ((mask & ADIF) && (value & ADIF)) {
      cpu.clearInterruptByFlag(ADC_INTERRUPT, ADIF);
      next &= ~ADIF;
    }

    const enabled = !!(next & ADEN);
    if (enabled && !wasEnabled) adcFirstConversion = true;
    if (!enabled && adcConverting) {
      clearScheduledAdc();
      next &= ~ADSC;
    } else if (adcConverting) {
      // ADSC reads one for the whole conversion; writing zero does not abort it.
      next |= ADSC;
    } else if (!enabled) {
      next &= ~ADSC;
    }

    cpu.data[R.ADCSRA] = next;
    cpu.updateInterruptEnable(ADC_INTERRUPT, next);
    if (startRequested) {
      cpu.data[R.ADCSRA] |= ADSC;
      startAdcConversion(raw, conversionCycles);
    }
    return true;
  };

  cpu.writeHooks[R.UCSR0A] = (value, oldValue, _address, mask = 0xff) => {
    const merged = mergeMasked(value, oldValue, mask);
    let flags = oldValue & (TXC | UDRE);
    if ((mask & TXC) && (value & TXC)) {
      cpu.clearInterruptByFlag(USART_TXC_INTERRUPT, TXC);
      flags &= ~TXC;
    }
    cpu.data[R.UCSR0A] = flags | (merged & (U2X | MPCM));
    return true;
  };

  cpu.writeHooks[R.UCSR0B] = (value, oldValue, _address, mask = 0xff) => {
    const next = mergeMasked(value, oldValue, mask);
    validateUsartFormat(next, cpu.data[R.UCSR0C]);
    const txWasEnabled = !!(oldValue & TXEN);
    const txEnabled = !!(next & TXEN);
    cpu.data[R.UCSR0B] = next;
    cpu.updateInterruptEnable(USART_UDRE_INTERRUPT, next);
    cpu.updateInterruptEnable(USART_TXC_INTERRUPT, next);
    if (txEnabled && !txWasEnabled) {
      if (txBufferFull && !txShiftBusy) {
        const pending = txBufferByte;
        txBufferFull = false;
        setUdre();
        startTxShift(pending);
      } else if (!txBufferFull) {
        setUdre();
      }
    }
    return true;
  };

  cpu.writeHooks[R.UCSR0C] = (value, oldValue, _address, mask = 0xff) => {
    const next = mergeMasked(value, oldValue, mask);
    validateUsartFormat(cpu.data[R.UCSR0B], next);
    cpu.data[R.UCSR0C] = next;
    return true;
  };

  cpu.writeHooks[R.UBRR0L] = (value, oldValue, _address, mask = 0xff) => {
    cpu.data[R.UBRR0L] = mergeMasked(value, oldValue, mask);
    return true;
  };
  cpu.writeHooks[R.UBRR0H] = (value, oldValue, _address, mask = 0xff) => {
    cpu.data[R.UBRR0H] = mergeMasked(value, oldValue, mask) & 0x0f;
    return true;
  };

  cpu.readHooks[R.UDR0] = () => {
    throw new RangeError("USART0 RX/receive path chưa được hỗ trợ; không có byte nhận giả lập.");
  };
  cpu.writeHooks[R.UDR0] = (value, oldValue, _address, mask = 0xff) => {
    const byte = mergeMasked(value, oldValue, mask);
    if (!(cpu.data[R.UCSR0A] & UDRE)) {
      txIgnoredWrites += 1;
      return true;
    }
    validateUsartFormat(cpu.data[R.UCSR0B], cpu.data[R.UCSR0C]);
    cpu.data[R.UDR0] = byte;
    clearUdre();
    clearTxc();
    if (txShiftBusy || !(cpu.data[R.UCSR0B] & TXEN)) {
      txBufferFull = true;
      txBufferByte = byte;
    } else {
      startTxShift(byte);
    }
    return true;
  };

  function setAnalogInputMillivolts(channel, millivolts) {
    ensureActive();
    assertInteger(channel, 0, AVR_ANALOG_SERIAL_LIMITS.adcChannels - 1, "ADC channel");
    assertInteger(millivolts, 0, AVR_ANALOG_SERIAL_LIMITS.maxAnalogMillivolts, "analog millivolt/mV");
    analogInputs[channel] = millivolts;
    return millivolts;
  }

  function clearAnalogInput(channel) {
    ensureActive();
    assertInteger(channel, 0, AVR_ANALOG_SERIAL_LIMITS.adcChannels - 1, "ADC channel");
    analogInputs[channel] = null;
  }

  function setReferenceMillivolts(kind, millivolts) {
    ensureActive();
    if (kind !== "avcc" && kind !== "aref") throw new RangeError("reference kind phải là 'avcc' hoặc 'aref'.");
    assertInteger(
      millivolts,
      AVR_ANALOG_SERIAL_LIMITS.minReferenceMillivolts,
      AVR_ANALOG_SERIAL_LIMITS.maxReferenceMillivolts,
      "reference millivolt/mV",
    );
    references[kind] = millivolts;
    return millivolts;
  }

  function getTxBytes() {
    return Uint8Array.from(txCapture);
  }

  function clearTx() {
    ensureActive();
    txCapture.length = 0;
    txDroppedCaptureBytes = 0;
  }

  function snapshot() {
    const now = cpu.cycles;
    return freezeSnapshot({
      disposed,
      analogInputsMillivolts: Object.freeze([...analogInputs]),
      referencesMillivolts: freezeSnapshot({ avcc: references.avcc, aref: references.aref, internal1v1: 1100 }),
      adc: freezeSnapshot({
        converting: adcConverting,
        firstConversion: adcFirstConversion,
        dataLocked: adcDataLocked,
        lastConversionRaw: adcLastConversionRaw,
        conversionsCompleted: adcCompleted,
        lostResults: adcLostResults,
        cyclesRemaining: adcDueCycle === null ? 0 : Math.max(0, adcDueCycle - now),
      }),
      usart: freezeSnapshot({
        txEnabled: !!(cpu.data[R.UCSR0B] & TXEN),
        rxEnabled: !!(cpu.data[R.UCSR0B] & RXEN),
        txShiftBusy,
        txBufferFull,
        baudRate: currentBaudRate(),
        cyclesPerFrame: txShiftBusy ? txCurrentFrameCycles : currentCyclesPerFrame(),
        txCyclesRemaining: txDueCycle === null ? 0 : Math.max(0, txDueCycle - now),
        capturedBytes: txCapture.length,
        droppedCaptureBytes: txDroppedCaptureBytes,
        ignoredWrites: txIgnoredWrites,
      }),
    });
  }

  function reset() {
    ensureActive();
    resetPeripheralRegisters();
    return snapshot();
  }

  function dispose() {
    if (disposed) return;
    clearScheduledAdc();
    clearScheduledTx();
    cpu.clearInterrupt(ADC_INTERRUPT);
    cpu.clearInterrupt(USART_UDRE_INTERRUPT);
    cpu.clearInterrupt(USART_TXC_INTERRUPT);
    for (const [address, hook] of previousReadHooks) cpu.readHooks[address] = hook;
    for (const [address, hook] of previousWriteHooks) cpu.writeHooks[address] = hook;
    disposed = true;
  }

  resetPeripheralRegisters();

  return Object.freeze({
    capabilities: AVR_ANALOG_SERIAL_CAPABILITIES,
    registers: AVR_ANALOG_SERIAL_REGISTERS,
    setAnalogInputMillivolts,
    clearAnalogInput,
    setReferenceMillivolts,
    getTxBytes,
    clearTx,
    snapshot,
    reset,
    dispose,
  });
}
