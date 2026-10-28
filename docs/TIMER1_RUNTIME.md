# Bounded AVR Timer1 runtime

## Phạm vi

`src/avr-timer1.js` là model **Timer/Counter1 16-bit có giới hạn** cho CPU avr8js đã vendor. API công khai:

```js
import { createAvrTimer1 } from "./src/avr-timer1.js";

const timer1 = createAvrTimer1(cpu);
timer1.snapshot();
timer1.reset();
timer1.dispose();
```

Model chỉ hỗ trợ **Normal mode (WGM=0)**, counter `0x0000..0xFFFF`, internal prescaler, overflow flag và overflow interrupt. Nó không phải Timer1 đầy đủ, không phải Servo backend và không phải PWM engine.

## Provenance và register map

Semantics được đối chiếu với `wokwi/avr8js v0.21.1`, commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd`, `src/peripherals/timer.ts`/`timer.spec.ts`, cùng ATmega328P datasheet.

| Register | Data-space address |
| --- | ---: |
| `TIFR1` | `0x36` |
| `TIMSK1` | `0x6F` |
| `TCCR1A/B/C` | `0x80 / 0x81 / 0x82` |
| `TCNT1L/H` | `0x84 / 0x85` |
| `ICR1L/H` | `0x86 / 0x87` |
| `OCR1AL/H` | `0x88 / 0x89` |
| `OCR1BL/H` | `0x8A / 0x8B` |

Upstream `timer1Config` dùng overflow vector `0x1A`, `TOV1=bit0`, `TOIE1=bit0`, và divider giống Timer0: `CS=0` stop; `1=/1`, `2=/8`, `3=/64`, `4=/256`, `5=/1024`; `CS=6/7` là external T1 clock và bị model này từ chối.

## 16-bit TEMP high-byte semantics

ATmega328P dùng một TEMP 8-bit chung cho truy cập register 16-bit của Timer1. Phần được model cho `TCNT1`:

- **Write:** ghi `TCNT1H` trước để nạp TEMP; ghi `TCNT1L` sau sẽ commit đồng thời `(TEMP << 8) | low` vào counter. Ghi high sau low chỉ đổi TEMP, không sửa giá trị TCNT1 vừa commit.
- **Read:** đọc `TCNT1L` sẽ snapshot high byte hiện tại của counter vào TEMP; lần đọc `TCNT1H` kế tiếp trả TEMP đó, ngay cả nếu counter đã tiến thêm trước lần đọc high.

Đây là lý do test không đọc trực tiếp `cpu.dataView.getUint16(TCNT1L)` để suy diễn semantics register CPU: high I/O location biểu diễn TEMP trong đường truy cập byte-wise.

## Counter và overflow

Model chạy theo **CPU cycle**, clock metadata `16 MHz`, không theo wall-clock. Trong Normal mode TOP=`0xFFFF`. Prescaler activation được defer qua clock-event kế tiếp giống avr8js `updateDivider`; mỗi lần đổi `CS` model bắt đầu phase prescaler mới tại cycle áp dụng divider.

Khi counter vượt `0xFFFF`, nó wrap về `0x0000` và gọi `cpu.setInterruptFlag()` cho overflow config. `TIFR1.TOV1` dùng write-one-to-clear. Nếu `TIMSK1.TOIE1=1` và global I bit được bật, chính `cpu.tick()`/avr8js interrupt path service vector `0x1A`.

## Fail-closed boundary

Model cố ý **không** mô phỏng CTC, PWM, compare match, output compare pins, input capture hoặc external T1 clock:

- WGM khác 0 có thể tồn tại tạm thời chỉ khi `CS=0`; bật `CS=1..5` với WGM unsupported bị từ chối trước khi register commit.
- Khi timer đang chạy, write `TCCR1A/B` dẫn tới WGM unsupported bị từ chối.
- `CS=6/7` luôn bị từ chối.
- `COM1A/COM1B`, input-capture control và force-output-compare bị từ chối.
- Writes tới `OCR1A`, `OCR1B` và `ICR1` bị từ chối, vì model không tạo compare/capture flags hoặc pin waveforms.
- `TIMSK1` chỉ cho phép `TOIE1`; `TIFR1` chỉ cho phép W1C `TOV1`.

Điều này có hệ quả tích hợp quan trọng: Arduino AVR core thường cấu hình Timer1 cho PWM. Firmware đó sẽ **fail closed** nếu Timer1 peripheral này được attach, thay vì tiếp tục với timing/PWM giả. Prime chỉ nên tích hợp Timer1 vào opt-in lab hoặc firmware đã được biết là giữ Timer1 ở Normal mode.

Probe browser read-only với firmware thật `lesson_01.hex` đã SHA-256 verify (`1923c082b7dae924bfa0a8e4bb1766af68b96798aedec570b75abc65ca705d42`) xác nhận ranh giới này: Arduino core đặt `TCCR1B` thành `CS=3` (`/64`) trong WGM0, sau đó tại cycle 108 / instruction 76 thử chuyển `TCCR1A` sang WGM1. `createAvrTimer1()` từ chối write đó với `Timer1 WGM=1 chưa được hỗ trợ`, giữ `TCCR1A=0`, `TCCR1B=3`. Đây là expected fail-closed, không phải bằng chứng Timer1 tương thích với firmware Arduino core mặc định.

## Không được suy diễn

Capabilities cố ý đặt false cho CTC/PWM/compare/capture/external clock/Servo parity, và không công bố `millis()`/`delay()` parity. Timer1 overflow đúng trong Normal mode không chứng minh Servo timing, `analogWrite()` PWM, input capture hoặc Arduino timekeeping API.

## Contract tests

`tests/avr-timer1-contracts.js` kiểm tra:

- register map/capability boundary;
- `/1,/8,/64,/256,/1024`, multi-cycle catch-up và NOP instruction cycles;
- high-then-low write commit, low-first behavior, low-read high-byte latch;
- `0xFFFF→0x0000`, `TOV1`, W1C, `TOIE1` và vector `0x1A`;
- stopped transient unsupported WGM nhưng không được start clock;
- running Normal reject CTC/PWM/external clock;
- compare/capture register/interrupt/flag writes fail closed;
- divider reschedule, reset, dispose và double-attach safety.

Các test này chỉ chứng minh subset trên, không chứng minh phần cứng Arduino Uno hoặc Servo/PWM parity.
