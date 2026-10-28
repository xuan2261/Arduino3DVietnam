# AVR Runtime — baseline v1.3 và peripheral lab v1.4.0 tùy chọn

## Trạng thái

Baseline đã phát hành trong **v1.3** chạy **machine code AVR thật** trong trình duyệt bằng CPU core của `avr8js`; nó không diễn lại hành vi bài học bằng JavaScript. API nhận Intel HEX đã được biên dịch riêng, nạp byte vào flash ATmega328P và gọi instruction decoder của avr8js từng lệnh.

Source **v1.4.0** giữ baseline đó và thêm một nhánh *peripheral lab* opt-in tại `src/avr-board-runner.js`. Nhánh này dùng cùng machine code đã xác minh và gắn một tập peripheral register hooks có giới hạn. `AVR_BOARD_LAB_CAPABILITIES` là nguồn có thể kiểm tra bằng code cho phạm vi được/không được hỗ trợ; nó cố ý tuyên bố `completeArduinoUno=false` và `physicalHardware=false`.

Không có compiler Arduino C++ trong browser. Pipeline đúng là:

```text
Sketch C++ được kiểm soát
  -> Arduino CLI / AVR core ở pipeline compile riêng
  -> assets/firmware/lesson_XX.hex + manifest SHA-256
  -> browser xác minh file firmware
  -> v1.3 baseline: createAvrRunner(hexText)
       -> avr8js CPU core thực thi instruction AVR
     hoặc v1.4.0 opt-in: createAvrBoardRunner(hexText)
       -> avr8js CPU + GPIO / Timer0 / ADC-fixed-input / USART0-TX hooks
```

Runtime không dùng Node.js, npm hoặc API Node khi chạy trong website. Các module dưới `assets/vendor/avr/*.js` là ESM thuần browser.

`src/avr-panel.js` giữ hai chế độ tách biệt. Nếu người dùng không bật lựa chọn peripheral thử nghiệm, UI dùng `createAvrRunner()` như baseline. Khi opt-in, UI mới import `createAvrBoardRunner()` và kiểm tra capability boundary trước khi chạy.

## API cho UI

```js
import {
  createAvrRunner,
  AVR_RUNTIME_CAPABILITIES,
  AVR8JS_PROVENANCE,
} from "./src/avr-runtime.js";

const runner = createAvrRunner(hexText, {
  onWatchdogReset(event) {
    console.log(event);
  },
});

runner.step();
runner.runCycles(100_000);
runner.snapshot();
runner.readData(0x25); // raw PORTB data register
runner.reset();
```

`snapshot()` trả về `pcWords`, `pcBytes`, `cycles`, `sp`, `sreg`, 32 register CPU và số lần gặp lệnh WDR. `runCycles()` là đồng bộ và bị giới hạn tối đa **100.000 cycle mỗi lần gọi** để giảm nguy cơ khóa UI; vòng lặp nội bộ gọi trực tiếp `avrInstruction()` + `cpu.tick()` và chỉ tạo snapshot một lần ở cuối. Khối lượng lớn hơn phải được chia nhỏ giữa các frame/task, hoặc chuyển sang Web Worker trước khi tăng budget. `reset()` dùng đúng semantics `CPU.reset()` của avr8js: PC/stack/interrupt state được reset nhưng SRAM không bị xóa; muốn một lần chạy sạch hoàn toàn thì tạo runner mới từ cùng HEX.

## Intel HEX gate

`parseIntelHex()` kiểm tra trước khi cho CPU chạy:

- văn bản ASCII, tối đa 1 MiB;
- checksum từng record;
- byte count và cấu trúc record;
- bắt buộc EOF;
- hỗ trợ record data `00`, EOF `01`, extended segment `02`, extended linear `04`;
- từ chối record type khác thay vì bỏ qua âm thầm;
- từ chối byte nằm ngoài flash 32 KiB của ATmega328P;
- từ chối hai record ghi giá trị mâu thuẫn lên cùng địa chỉ.

Flash chưa được ghi được đặt `0xFF`, tương ứng trạng thái erased của AVR flash.

## Provenance avr8js

Nguồn upstream: `https://github.com/wokwi/avr8js`, release `v0.21.1`, commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd`, phát hành ngày 31/08/2026. GitHub báo commit release có chữ ký hợp lệ. `package.json` upstream ghi version `0.21.1`, repository này, license MIT và mô tả thư viện chạy trong browser / Node.js. README upstream cũng nói rõ avr8js cần machine code đã biên dịch sẵn và phần cứng ngoài phải do glue/peripheral simulation cung cấp.

Bốn file dưới `assets/vendor/avr/avr8js-0.21.1-source/` và `AVR8JS-LICENSE.txt` là byte nguồn upstream đã được đối chiếu bằng Git blob SHA với tree của commit release. `assets/vendor/avr/PROVENANCE.json` ghi Git blob SHA-1 và SHA-256 của từng file, cùng SHA-256 của ba ESM dẫn xuất dùng lúc runtime.

ESM dẫn xuất chỉ bỏ TypeScript type/interface/type-only import, làm explicit thứ tự khởi tạo field trong constructor CPU và thêm hậu tố `.js` cho import nội bộ. Nhánh opcode và thuật toán trong `avrInstruction` không bị sửa.

## Bằng chứng chạy thật

Contract browser `tests/avr-runtime-contracts.js` đã chạy trực tiếp trong Chrome qua HTTP local, không có Node runtime. Năm contract CPU/HEX đều đạt:

1. provenance/version/license bị pin;
2. capability boundary báo rõ peripheral chưa hỗ trợ;
3. Intel HEX checksum/EOF/flash bounds bị kiểm tra;
4. chương trình AVR hand-encoded chạy `LDI R16,0x2A`, `INC R16`, `STS 0x0100,R16`, `RJMP -1`; register, SRAM, PC và cycle count thay đổi theo instruction decoder;
5. cycle budget và semantics reset được kiểm tra.

Ngoài fixture nhỏ, firmware thật `assets/firmware/lesson_01.hex` từ pipeline Arduino Uno cũng đã chạy 100.000 CPU cycle trong Chrome. Runtime nạp 724 byte chương trình và kết thúc phép đo với `DDRB = 0x20`, `PORTB = 0x20`: bit PB5 (Arduino D13) đã được code đã compile cấu hình output và đặt HIGH. Contract bổ sung `runBundledFirmwareContract()` trước tiên tính SHA-256 file HEX bằng Web Crypto và so với `assets/firmware/manifest.json`, rồi mới chạy firmware.

Đây là **bằng chứng lịch sử của baseline CPU**, không tự mở rộng sang peripheral lab. Source v1.4 có contract riêng cho board runner, GPIO, Timer0 và ADC/USART tại `tests/avr-board-contracts.js`, `tests/avr-gpio-contracts.js`, `tests/avr-timer0-contracts.js` và `tests/avr-analog-serial-contracts.js`. Chrome Windows đã kiểm thử GPIO 29/29, Timer0 10/10, ADC/USART 18/18, board 12/12 vào 28/10/2026. Hai test mới sử dụng **firmware bài 15 thực đã xác minh SHA**: đặt A0 giả định 4000 mV → ADC 819, GPIO D13 HIGH, USART TX `819\r\n`; 3000 mV → ADC 614, D13 LOW, USART TX `614\r\n`. Đó là output CPU/ngoại vi được mô hình hóa, **không** phải số đo phần cứng/FSR thật hoặc bằng chứng `delay()` parity. GitHub CI và Pages vẫn cần kiểm tra đúng SHA trước khi tuyên bố phát hành.

## Ranh giới hai chế độ

### Baseline CPU-only v1.3

`src/avr-runtime.js::AVR_RUNTIME_CAPABILITIES` vẫn là hợp đồng của chế độ mặc định. Đây là **CPU backend**, chưa phải Arduino Uno simulator hoàn chỉnh.

- **GPIO peripheral:** chưa instantiate `AVRIOPort`. Các instruction vẫn ghi đúng raw DDR/PORT data register, nhưng chưa có pin-level state, pull-up/external input, edge callback hoặc kết nối sang mạch 3D.
- **Timer0/1/2:** chưa instantiate `AVRTimer`. Timer counter/compare/overflow và timer interrupt không tự chạy. Vì vậy `delay()`, `millis()`, `micros()`, PWM, `tone()` và Servo timing không được xem là đúng.
- **USART / Serial:** chưa instantiate `AVRUSART`; không có TX/RX timing, flag, interrupt hoặc Serial Monitor. Firmware chờ USART có thể không tiến triển như phần cứng thật.
- **ADC:** chưa có `AVRADC`; `analogRead()` không có conversion engine hay analog input model.
- **EEPROM/SPI/TWI/watchdog peripheral:** chưa được gắn. Callback WDR chỉ quan sát instruction WDR, không mô phỏng watchdog timer/reset source.
- **External hardware:** không có mô hình cảm biến, motor, servo, buzzer hoặc tải điện; phải được thêm bằng peripheral/glue code riêng và test riêng.
- **Instruction caveat upstream:** source avr8js `v0.21.1` đánh dấu `SLEEP`, `SPM` và `SPM(INC)` là chưa implement trong instruction core.
- **Thời gian thực / UI thread:** `runCycles()` chạy nhanh nhất có thể theo cycle budget, không đồng bộ cycle với wall-clock. Mỗi lời gọi synchronous bị chặn ở 100.000 cycle; UI cần chunk nhỏ hoặc Web Worker cho workload dài.

Vì baseline không có Timer0, việc firmware mẫu đạt `DDRB=0x20` và `PORTB=0x20` sau 100.000 CPU cycle chỉ chứng minh code compile đã đi qua phần khởi tạo và bật D13; không chứng minh chu kỳ blink hoặc `delay()` đúng.

### Peripheral lab opt-in v1.4.0

`src/avr-board-runner.js` tạo một CPU mới và gắn ba adapter độc lập. Phạm vi chi tiết nằm trong capability constants và contract test của từng module; tài liệu chỉ nêu ranh giới cần hiểu khi sử dụng:

- `avr-gpio.js`: trạng thái GPIO theo thanh ghi và external digital level có kiểm soát, gồm mapping PB5/D13; không mô hình dòng điện, tải hay an toàn phần cứng.
- `avr-timer0.js`: counter/overflow/interrupt cho các mode/prescaler được module cho phép; không có output compare/PWM waveform đầy đủ, Timer1/2 hoặc parity `delay/millis/micros`.
- `avr-analog-serial.js`: ADC single conversion từ giá trị analog cố định do caller đặt và USART0 async 8-bit TX có capture/interrupt giới hạn; không có ADC free-running/auto-trigger, USART RX, synchronous/MSPI hay wall-clock timing.
- `avr-board-runner.js`: chỉ ghép các adapter trên với firmware thật; không có external sensors, motor/servo physics, solver điện hay kết nối USB. Mỗi lời gọi `runCycles()` vẫn bị chặn ở budget hữu hạn.

Peripheral lab dùng cycle scheduling của CPU để mô hình hóa register-visible events. Điều đó **không** chứng minh timing tương đương bo Arduino vật lý, và chưa cho phép gắn nhãn “Arduino Uno đầy đủ”, “PWM chính xác”, “Serial hai chiều” hoặc “mạch thật hoạt động”.

## Contract tích hợp firmware

UI nên lấy firmware theo `assets/firmware/manifest.json`, kiểm SHA-256 trên raw response bytes bằng Web Crypto, sau đó decode UTF-8 và truyền Intel HEX text vào `createAvrRunner()`. Runtime không tự fetch URL và không dùng credential/network secret.

Baseline chỉ nên hiển thị trạng thái kiểu **“Đang thực thi AVR CPU từ firmware đã compile”**. Peripheral lab cần luôn giữ nhãn **thử nghiệm / có giới hạn** và chỉ mô tả đúng các capability được code công bố. Không gắn nhãn **“Arduino Uno đầy đủ”**, **“Serial hai chiều”**, **“timer/PWM chính xác như phần cứng”** hoặc **“mạch thật an toàn/hoạt động”** cho tới khi có parity evidence độc lập cho từng lớp tương ứng.
