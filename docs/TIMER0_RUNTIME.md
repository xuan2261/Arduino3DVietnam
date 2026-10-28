# Bounded AVR Timer0 runtime

## Mục tiêu và phạm vi

`src/avr-timer0.js` là một peripheral **Timer0 core có giới hạn** cho CPU avr8js đang được vendor trong dự án. Nó không phải mô phỏng Arduino Uno hoàn chỉnh và không sửa `src/avr-runtime.js`; prime có thể lựa chọn gắn peripheral này vào một CPU runner riêng bằng:

```js
import { createAvrTimer0 } from "./src/avr-timer0.js";

const timer0 = createAvrTimer0(cpu);
// ... CPU instructions + cpu.tick()
timer0.snapshot();
timer0.reset();
timer0.dispose();
```

Model làm việc theo **CPU cycle**, không theo wall-clock. Metadata Arduino Uno được chốt ở `16_000_000 Hz`; Arduino UNO R3 documentation chính thức mô tả board ATmega328P với 16 MHz ceramic resonator, và upstream avr8js demo (`demo/src/execute.ts`) cũng đặt runner speed `16e6`. Vì vậy prescaler `/64` tạo một Timer0 tick mỗi `64 / 16 MHz = 4 µs`, và với TOP `0xFF` một vòng 256 tick là `1024 µs`.

## Nguồn semantics

Semantics được lấy từ `wokwi/avr8js v0.21.1`, release commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd`, file upstream `src/peripherals/timer.ts`. Upstream ghi reference ATmega48A/PA/88A/PA/168A/PA/328/P datasheet và khai báo `timer0Config`:

- `TIFR0 = 0x35`, `TOV0 = 0x01`;
- `TCCR0A = 0x44`, `TCCR0B = 0x45`, `TCNT0 = 0x46`;
- `TIMSK0 = 0x6e`, `TOIE0 = 0x01`;
- overflow interrupt vector `0x20`;
- clock select nội bộ: `CS=1 → /1`, `2 → /8`, `3 → /64`, `4 → /256`, `5 → /1024`; `CS=0` dừng timer;
- upstream `AVRTimer.count()` tính `floor((cpu.cycles - lastCycle) / divider)`, cập nhật `TCNT`, và gọi `cpu.setInterruptFlag(OVF)` khi counter vượt TOP;
- `TIMSK` write gọi `cpu.updateInterruptEnable()`, `TIFR` write dùng write-one-to-clear qua `cpu.clearInterruptByFlag()`.

Cross-check với Microchip ATmega328/P datasheet cũng xác nhận `TIMSK0` offset `0x6E`, bit 0 là `TOIE0`, `TIFR0` offset `0x35`, bit 0 là `TOV0`, và TOV0 được clear khi ISR tương ứng chạy hoặc khi software ghi logic 1 vào flag. Nguồn tham chiếu: `https://ww1.microchip.com/downloads/en/DeviceDoc/Atmel-7810-Automotive-Microcontrollers-ATmega328P_Datasheet.pdf`; Arduino UNO R3 clock reference: `https://docs.arduino.cc/hardware/uno-rev3/`.

Runtime này dùng trực tiếp các hook đã có trong vendored `CPU`: `readHooks`, `writeHooks`, `addClockEvent`, `clearClockEvent`, `setInterruptFlag`, `updateInterruptEnable`, `clearInterruptByFlag` và interrupt queue được xử lý trong `cpu.tick()`.

## Behavior được hỗ trợ

Timer0 hiện hỗ trợ phần counter/overflow cho hai WGM có TOP cố định `0xFF` và counter tăng lên:

| WGM | Mode | Phần được hỗ trợ |
| ---: | --- | --- |
| 0 | Normal | `TCNT0`, internal prescaler, wrap `0xFF→0x00`, `TOV0`, `TOIE0`, overflow vector |
| 3 | Fast PWM, TOP=0xFF | cùng counter/overflow semantics; **không** có compare/PWM output |

Khi viết `TCCR0B.CS`, model mirror đường `updateDivider` của avr8js: thay đổi divider được chuyển qua clock-event kế tiếp (zero-delay upstream bị `CPU.addClockEvent()` clamp thành tối thiểu một CPU cycle), rồi phase prescaler mới bắt đầu tại cycle đó. Khi viết `TCNT0`, model giữ phase prescaler thay vì reset nó. Nếu CPU tiến nhiều cycle trước một `tick()`, callback sẽ catch-up số timer tick bằng phép chia nguyên như upstream.

`TIFR0.TOV0` dùng semantics write-one-to-clear. Khi overflow xảy ra và `TIMSK0.TOIE0=1`, `cpu.setInterruptFlag()` queue vector `0x20`; nếu SREG I được bật, chính `cpu.tick()`/`avrInterrupt` của avr8js thực hiện interrupt entry và clear flag cho interrupt không-constant.

## Fail-closed behavior

Model cố ý từ chối các trường hợp chưa được triển khai chính xác:

- WGM 1/5 Phase Correct PWM;
- WGM 2 CTC và WGM 7 Fast PWM với TOP=`OCR0A`;
- WGM reserved;
- external clock `CS=6/7` trên chân T0;
- attach lần hai khi Timer0 register hooks đã bị peripheral khác chiếm.

Một ngoại lệ cấu hình có chủ ý: khi `TCCR0B.CS=0`, timer đang dừng nên firmware được phép ghi **WGM trung gian chưa hỗ trợ** vào `TCCR0A`. Arduino core thật dùng chuỗi write kiểu `WGM0 → WGM2 tạm thời → WGM3` trước khi bật prescaler. Model giữ nguyên các bit trung gian đó nhưng không mô phỏng behavior của WGM unsupported. Trước khi chuyển sang `CS=1..5`, `TCCR0B` bắt buộc WGM hiện tại phải thuộc tập hỗ trợ `{0, 3}`; nếu không, write bật clock bị từ chối và timer vẫn dừng. Khi timer đang chạy, mọi write `TCCR0A` dẫn tới WGM unsupported cũng bị từ chối trước khi thay đổi register.

Vì vậy các write bị từ chối không silently đổi mode thành Normal hoặc tiếp tục đếm với semantics sai, trong khi chuỗi cấu hình nhiều instruction của firmware Arduino vẫn có thể đi qua trạng thái trung gian an toàn khi clock chưa chạy.

## Không được suy diễn thành Arduino timing parity

Các phần sau **chưa có**:

- `OCR0A/OCR0B` compare-match flags/interrupts;
- OC0A/OC0B pin override và PWM duty waveform;
- Phase Correct PWM, CTC, external T0 clock;
- global Arduino core integration trong `src/avr-runtime.js`;
- kiểm chứng ISR `TIMER0_OVF_vect` của Arduino core trên toàn bộ firmware;
- parity end-to-end của `millis()`, `micros()`, `delay()`, `delayMicroseconds()` hoặc scheduler theo wall-clock.

Do đó việc `/64` có overflow period toán học `1.024 ms` **không** đồng nghĩa `millis()` hoặc `delay()` đã đúng. Arduino timekeeping còn phụ thuộc code ISR, global interrupt state, instruction timing và cách runtime host phân lát CPU execution.

## Contract test

`tests/avr-timer0-contracts.js` chạy trực tiếp với vendored `CPU` và kiểm tra:

- clock dừng khi `CS=0`;
- `/1`, `/8`, `/64`, `/256`, `/1024` theo CPU cycle, kể cả multi-cycle catch-up;
- WGM3 fixed-top counter và preservation của prescaler phase khi write `TCNT0`;
- wrap `0xFF→0x00`, `TOV0`, write-one-to-clear;
- `TOIE0` queue/service vector `0x20` qua chính avr8js CPU interrupt path;
- clear pending flag trước service;
- fail-closed unsupported WGM/external clock;
- transient `WGM2` khi `CS=0` có thể resolve sang `WGM3` rồi bật `/64`, nhưng `WGM2 → /64` và `WGM3 đang chạy → WGM2` đều bị từ chối;
- `reset()`, `dispose()` và double-attach safety.

Test này chứng minh peripheral core ở phạm vi trên; nó không chứng minh đầy đủ Timer0 hoặc Arduino timing API parity.
