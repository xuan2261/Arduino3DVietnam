# AVR Peripheral Lab — thí nghiệm thanh ghi AVR có giới hạn

Đây là lựa chọn **tự bật** trong bảng **Thực thi mã AVR đã biên dịch**. Mặc định trang vẫn chạy chế độ **CPU-only** của v1.3.0; hai chế độ đều chỉ nạp Intel HEX mẫu sau khi `src/firmware-integrity.js` kiểm tra manifest, byte HEX và SHA-256 của giáo trình.

## Dòng dữ liệu thực

```text
Sketch mẫu được compile trên GitHub Actions
    ↓ Arduino Uno Intel HEX + manifest SHA-256 đã đối chiếu
browser: loadVerifiedFirmware()
    ↓ parseIntelHex + CPU/avrInstruction của avr8js 0.21.1
    ├── src/avr-gpio.js       GPIO PIN/DDR/PORT B,C,D; D13=PB5
    ├── src/avr-timer0.js     Timer0 đếm / overflow + prescaler giới hạn
    └── src/avr-analog-serial.js   ADC single conversion + USART0 TX
    ↓
src/avr-board-runner.js → bản ghi trạng thái thanh ghi/CPU trong bộ nhớ ảo
```

Giao diện **không dùng kết quả của `src/simulator.js`** để giả mạo ngoại vi AVR. Mọi giá trị ngoại vi được tạo từ lệnh máy AVR đã decode, thanh ghi CPU và dữ liệu input giả định **được người học đặt thủ công**.

## Cách sử dụng

1. Mở bài học. Trong bảng AVR, chọn **Bật mô hình ngoại vi AVR thử nghiệm** rồi bấm **Nạp firmware mẫu bài XX**.
2. Bấm **Thực thi 1 lệnh** hoặc **Thực thi 25.000 chu kỳ** để xem PC, chu kỳ, thanh ghi DDRB/PORTB và kết quả ngoại vi có hỗ trợ.
3. Xem **GPIO D13** để biết mức logic do chương trình trong AVR ảo tạo ra. Giá trị này **không phải** dòng, độ sáng hay đo điện trên chân thật.
4. Tùy chọn đặt tín hiệu số **D2** ở `HIGH`, `LOW` hoặc `không xác định`; chỉ giá trị người học chọn mới được truyền vào GPIO input.
5. Tùy chọn khai báo điện áp cố định **A0** bằng đơn vị **mV** (`0..5500`), bấm **Áp dụng A0**; xóa ô rồi áp dụng để trở lại **chưa xác định**. Giá trị này không được lấy từ cảm biến thực. Không có ADC input mặc định dựng sẵn.
6. **USART0 TX** chỉ hiển thị byte khi firmware thực sự ghi vào thanh ghi TX và hoàn thành truyền trong miền chu kỳ CPU. Bảng Serial giả lập của bài học ở phía trên không lấy từ ngoại vi này.

Đổi bài, đổi chế độ hoặc nhận cập nhật Service Worker sẽ hủy runner cũ; cập nhật website yêu cầu tải lại để không trộn firmware/bài học từ các phiên bản khác nhau. Nút đặt lại tạo CPU/flash/SRAM và ngoại vi mới, không tự nạp lên Arduino thật.

## API và phạm vi đúng

```js
import { createAvrBoardRunner, AVR_BOARD_LAB_CAPABILITIES } from './src/avr-board-runner.js';
const runner = createAvrBoardRunner(verifiedHexText);
runner.step();
runner.runCycles(25_000); // mỗi lần tối đa 100.000 cycles
runner.setExternalPin('D2', true); // hoặc false, null
runner.setAnalogInputMillivolts(0, 2500); // A0, do người học khai báo
runner.snapshot(); // PC, cycles, boardD13, GPIO, Timer0, ADC/USART
runner.getTxBytes(); // Uint8Array, dữ liệu TX thực của firmware
runner.dispose();
```

- **GPIO:** dữ liệu PIN/DDR/PORT của B, C, D; pullup và input gắn mức HIGH/LOW giả định; `floating` không mặc định là một mức điện thật; không tính điện áp, dòng, driver hay tải ngoài. Xem [GPIO_RUNTIME.md](GPIO_RUNTIME.md).
- **Timer0:** counter/overflow thật trong miền cycle 16MHz, normal mode và Fast PWM TOP=0xFF, divider nội 1/8/64/256/1024, cờ TOV và overflow interrupt. Không mô phỏng compare pins/waveform PWM, Timer1/2, external clock, hoặc chứng minh `delay()`, `millis()`, `micros()` đúng. Xem [TIMER0_RUNTIME.md](TIMER0_RUNTIME.md).
- **ADC:** single conversion ADC0–7 chỉ khi khai báo mV; MUX14 bandgap/MUX15 GND; ADMUX/ADCSRA, conversion clock/flag và kết quả 10 bit giới hạn. Không mô hình hóa thực tế mạch analog, sai số ADC, mạch sample-and-hold, auto-trigger hoặc cảm biến vật lý. Xem [ANALOG_SERIAL_RUNTIME.md](ANALOG_SERIAL_RUNTIME.md).
- **USART0:** async 8-bit **TX only**, UDR/baud/flags/interrupt và byte capture thật từ firmware; **không hỗ trợ RX**, đồng bộ, waveform/điện/độ trễ thời gian thực, không xuất nhật ký dựng sẵn.

Các chế độ ngoại vi AVR không kết nối trực tiếp với animation 3D hay bộ kiểm tra netlist. **Không** gọi đây là Arduino Uno simulator đầy đủ, chương trình C++ tuỳ ý được biên dịch trong trình duyệt, hay bằng chứng hoạt động của mạch vật lý.

## Kiểm thử

- `tests/avr-runtime-contracts.js`: opcode + Intel HEX CPU-only.
- `tests/avr-gpio-contracts.js`: thanh ghi GPIO và decode AVR thật.
- `tests/avr-timer0-contracts.js`: prescaler, TCNT/overflow/interrupt + unsupported modes.
- `tests/avr-analog-serial-contracts.js`: ADC/USART TX, negative checks.
- `tests/avr-board-contracts.js`: tích hợp firmware HEX SHA-256, D13 GPIO từ opcode, đầu vào giả định, dispose, giới hạn ngoại vi. Hai positive/negative contracts bổ sung dùng **firmware thật bài 15** đã xác minh SHA: A0 do người học giả định 4000/3000 mV được CPU đọc thành ADC 819/614, D13 ở mức HIGH/LOW và USART TX thực sự truyền lần lượt `819\r\n` / `614\r\n` trong mô hình thanh ghi, không phải văn bản mô phỏng dựng sẵn.
- `tests/e2e_browser.py`: đã tích hợp kiểm thử production UI bật/tắt opt-in, mặc định CPU-only, tải HEX sau SHA, D2/A0, D13 từ register, reset/cleanup, hợp đồng ngoại vi và kiểm thử PWA/offline; kết quả phát hành vẫn phải căn cứ **bản chạy trên SHA cuối**.

Kiểm thử browser không thay thế kiểm tra bo Arduino thật, đo dòng bằng thiết bị, trợ năng screen reader thực hoặc chứng minh parity firmware cho toàn bộ 16 Sketch. Toàn bộ mã và nguồn thư viện đã ghim trong repository Public; bản quyền avr8js MIT ghi tại `assets/vendor/avr/AVR8JS-LICENSE.txt`.
