# AVR ADC + USART0 TX Runtime — bounded peripheral adapter

`src/avr-analog-serial.js` là adapter ngoại vi tùy chọn cho **CPU avr8js thật** của ATmega328P. Nó gắn trực tiếp vào `cpu.readHooks`, `cpu.writeHooks` và `cpu.addClockEvent()`; không đọc state bài học để dựng sẵn kết quả `analogRead()` hoặc chuỗi Serial.

Module này không thay đổi `src/avr-runtime.js`. `createAvrRunner()` hiện chưa expose `cpu`, vì vậy UI/runtime muốn dùng adapter phải gắn nó tại lớp đang sở hữu CPU trước khi chạy firmware.

## API chính xác

```js
import {
  AVR_ANALOG_SERIAL_CAPABILITIES,
  AVR_ANALOG_SERIAL_LIMITS,
  AVR_ANALOG_SERIAL_REGISTERS,
  createAvrAnalogSerial,
} from "./src/avr-analog-serial.js";

const peripheral = createAvrAnalogSerial(cpu);

// ADC0..ADC7 chỉ có giá trị khi caller khai báo input cố định.
peripheral.setAnalogInputMillivolts(0, 2500);
peripheral.clearAnalogInput(0);

// Mặc định AVCC = AREF = 5000 mV; có thể đặt lại trong bound.
peripheral.setReferenceMillivolts("avcc", 5000);
peripheral.setReferenceMillivolts("aref", 5000);

// Chỉ trả các byte thật đã hoàn tất một frame USART TX.
const bytes = peripheral.getTxBytes(); // Uint8Array defensive copy
peripheral.clearTx();

const state = peripheral.snapshot();
peripheral.reset();   // reset state/register ngoại vi, giữ input analog + host TX log
peripheral.dispose(); // hủy event, interrupt pending và khôi phục CPU hooks
```

Nên tạo adapter ngay sau khi tạo `CPU` và trước khi firmware bắt đầu chạy; constructor của adapter đặt các register ADC/USART về reset values của peripheral.

Controller trả về là frozen object với đúng các field/method:

```text
capabilities
registers
setAnalogInputMillivolts(channel, millivolts)
clearAnalogInput(channel)
setReferenceMillivolts(kind, millivolts)
getTxBytes()
clearTx()
snapshot()
reset()
dispose()
```

`createAvrAnalogSerial(cpu)` fail-closed nếu CPU không có register memory/hook/clock API cần thiết hoặc nếu một register hook mà adapter cần đã được ngoại vi khác chiếm. Việc kiểm tra hook diễn ra trước khi cài bất kỳ hook nào, nên lỗi conflict không để lại trạng thái nửa chừng.

## ADC ATmega328P được hỗ trợ

Register map:

| Register | Data-space address |
| --- | ---: |
| ADCL | `0x78` |
| ADCH | `0x79` |
| ADCSRA | `0x7A` |
| ADCSRB | `0x7B` |
| ADMUX | `0x7C` |
| DIDR0 | `0x7E` |

Phạm vi hỗ trợ:

- ADC0..ADC7 single-ended với giá trị **millivolt cố định do caller cung cấp**. Channel chưa được đặt sẽ ném `RangeError` khi firmware bắt đầu conversion thay vì ngầm trả `0`.
- MUX 14 dùng nguồn bandgap cố định 1.1 V; MUX 15 là GND. Temperature-sensor MUX 8 và các MUX reserved bị từ chối.
- REFS `00` = AREF, `01` = AVCC, `11` = internal 1.1 V. REFS `10` bị từ chối vì reserved.
- AVCC/AREF mặc định 5000 mV và chỉ có thể đặt bằng số nguyên `1000..5500 mV`. Input ADC0..7 là số nguyên `0..5500 mV`.
- Kết quả 10 bit dùng `floor(Vin / Vref × 1024)`, clamp `0..1023`, và ghi đúng layout right-adjust hoặc `ADLAR` left-adjust.
- Prescaler ADPS hỗ trợ `/2, /4, /8, /16, /32, /64, /128`.
- Conversion đầu tiên sau khi bật `ADEN` dùng 25 ADC clock; các conversion kế tiếp dùng 13 ADC clock. `ADSC` giữ `1` trong conversion rồi tự clear; `ADIF` được set khi hoàn tất.
- `ADIF` dùng write-one-to-clear và ADC interrupt vector `0x2A` được nối vào interrupt API thật của CPU avr8js.
- Đọc `ADCL` khóa cập nhật cặp ADC data register cho tới khi đọc `ADCH`. Nếu conversion mới hoàn tất trong khoảng khóa, result mới bị bỏ và `lostResults` tăng; `ADIF` vẫn được set.
- Clear `ADEN` trong conversion hủy event đang chờ. Bật lại ADC làm conversion tiếp theo trở thành first conversion 25-clock.

### Giới hạn ADC

`ADATE` auto-trigger/free-running không được mô hình hóa và fail-closed khi firmware cố bắt đầu conversion với bit này. Adapter cũng không mô phỏng analog noise, source impedance, sample-and-hold dynamics, temperature sensor hoặc điện áp nguồn biến thiên.

Giá trị input được coi là **ổn định trong một conversion** và được snapshot khi conversion bắt đầu. Datasheet nói conversion thực bắt đầu ở rising edge kế tiếp của ADC clock và sample-and-hold có phase riêng; adapter dùng discrete avr8js clock event `25 × prescaler` hoặc `13 × prescaler` CPU cycle tính từ lần ghi ADSC. Vì vậy register result/timing-class được mô hình hóa, nhưng phase chính xác bên trong prescaler/analog sample không được tuyên bố cycle-exact.

## USART0 TX được hỗ trợ

Register map:

| Register | Data-space address |
| --- | ---: |
| UCSR0A | `0xC0` |
| UCSR0B | `0xC1` |
| UCSR0C | `0xC2` |
| UBRR0L | `0xC4` |
| UBRR0H | `0xC5` |
| UDR0 | `0xC6` |

Phạm vi hỗ trợ:

- asynchronous USART0, character size **8 bit**;
- UBRR0 và `U2X` quyết định cycle/frame và baud report;
- no/even/odd parity và 1/2 stop-bit được tính vào frame-cycle count;
- reset state `UDRE=1`, `UCSR0C=8-bit`;
- write UDR0 chỉ được nhận khi `UDRE=1`; write khi `UDRE=0` bị transmitter bỏ qua và tăng diagnostic `ignoredWrites`;
- mô hình riêng transmit shift register + một-byte UDR buffer. Khi shift register rỗng, byte UDR có thể chuyển vào shift register và UDRE lại set; byte thứ hai có thể chờ trong buffer trong lúc frame đầu đang shift;
- `TXC` chỉ set khi frame cuối hoàn tất và không còn byte chờ; write-one-to-clear được hỗ trợ;
- UDR-empty interrupt `0x26` và TX-complete interrupt `0x28` đi qua CPU interrupt API. UDRE được giữ như level condition cho tới khi firmware ghi UDR0 hoặc tắt UDRIE;
- host capture chỉ thêm byte sau khi frame TX tương ứng hoàn tất, không phải ngay lúc firmware ghi UDR0.

Capture bị hard-cap **4096 byte**. Byte TX tiếp theo vẫn hoàn tất về mặt peripheral nhưng không được append vô hạn; `snapshot().usart.droppedCaptureBytes` đếm số byte host không lưu. `getTxBytes()` trả defensive `Uint8Array`, không tự đoán UTF-8/ASCII và không tạo line/string giả từ bài học.

Với project clock cố định 16 MHz, `UBRR0=103`, normal-speed async 8N1 cho `snapshot().usart.baudRate === 9615` và 16640 CPU cycle mỗi frame. Đây là cycle-domain model; adapter không sleep theo wall clock và không phát waveform thật trên chân TXD.

### RX và mode không hỗ trợ

`Serial.begin()` kiểu Arduino thường set cả `RXEN` và `TXEN`; adapter cho phép bit `RXEN` tồn tại để không chặn TX-only firmware, nhưng **không có receive peripheral**:

- `capabilities.usartRx === false`;
- đọc UDR0 ném `RangeError` thay vì trả byte nhận giả;
- không có RXC/RX FIFO, frame-error, overrun, parity-error hay RX interrupt;
- synchronous USART, MSPI và character size 5/6/7/9-bit fail-closed;
- không có external serial peer, TXD/RXD pin waveform hoặc clock pin.

Do đó module này chứng minh/register-model **USART TX**, không chứng minh toàn bộ Arduino `Serial` API hay giao tiếp serial hai chiều với thiết bị thật.

## Reset và lifecycle

`cpu.reset()` của CPU core không có callback ngoại vi và tự xóa clock-event queue. Khi runtime reset CPU đã gắn adapter, caller phải gọi cả `peripheral.reset()` để đồng bộ register/state ngoại vi. `peripheral.reset()`:

- hủy conversion/TX chưa hoàn tất;
- reset ADC/USART register và interrupt state;
- giữ fixed analog inputs/reference environment;
- giữ các byte TX đã hoàn tất trong host capture. Dùng `clearTx()` nếu UI muốn xóa log.

`dispose()` hủy ADC/TX clock event còn lại, clear pending interrupt do adapter tạo và khôi phục toàn bộ hook cũ. `dispose()` idempotent. Byte chưa hoàn tất tại thời điểm reset/dispose không bao giờ được đưa vào capture.

## Nguồn hành vi và provenance

CPU đang vendored trong dự án là avr8js `v0.21.1`, commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd`. Khi triển khai adapter, register config/behavior được đối chiếu với source upstream **cùng commit**:

- `src/peripherals/adc.ts`, Git blob `22633a0c5ff3f86d529c79792e87d5cb2c17fd62`;
- `src/peripherals/usart.ts`, Git blob `c64ec6f27189b7a648ecb59ac9544553a78e8253`.

Nguồn phần cứng: Microchip/Atmel ATmega328P datasheet `7810D–AVR–01/15`, phần ADC conversion/timing/data registers và USART transmitter/data/status registers. Những nguồn này chỉ dùng để xác minh lúc phát triển; module runtime không fetch mạng.

## Contract browser

Khởi động server MIME-safe của dự án:

```powershell
python scripts/serve.py --port 8091
```

Trong Chrome/Edge:

```js
import('/tests/avr-analog-serial-contracts.js')
  .then(m => m.runAvrAnalogSerialContracts())
```

Contract bao phủ register map/capability boundary, hook conflict atomic, ADC 25/13-clock timing, re-enable first conversion, ADCL/ADCH lock/lost result, ADLAR, ADIF interrupt/W1C, reference/input bounds, unsupported ADC modes, USART 9600-class config, two-stage TX buffer, UDRE/TXC flags/interrupts, TX-disabled buffer, unsupported RX/sync/9-bit, bounded capture, pending-event disposal và hai chương trình opcode AVR thật dùng `STS` để kích hoạt ADC/UDR hooks.

Kết quả trực tiếp trong Chrome ngày 28/10/2026: **18/18 PASS** trên bản source cuối. Diagnostic buffer sau lượt cuối có **0 error / 0 warning**. Regression cùng phiên: AVR CPU contracts **5/5**, GPIO contracts **29/29**, Timer0 contracts **8/8**, Python unittest **68/68**, scoped `git diff --check` PASS.

## Claim boundary

Module này không được dùng để tuyên bố “Arduino Uno simulator đầy đủ”. Timer/PWM/delay, GPIO pin electrical state, EEPROM, SPI/TWI, analog source physics và external hardware vẫn thuộc peripheral khác. Đặc biệt, không biến nội dung `simulator.js` hoặc lesson text thành UART output: chỉ byte mà firmware thực sự ghi thành công vào UDR0 và hoàn tất frame mới xuất hiện trong capture.
