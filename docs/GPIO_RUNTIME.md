# AVR GPIO runtime giới hạn

src/avr-gpio.js bổ sung GPIO digital có giới hạn cho CPU avr8js đã được vendored trong dự án. Module làm việc trực tiếp với cpu.data, cpu.readHooks và cpu.writeHooks; nó không thay đổi avr8js, không truy cập phần cứng thật và không tạo LED/cảm biến vật lý giả.

## Nguồn và phạm vi

Backend CPU hiện có là avr8js 0.21.1, commit bee6f0a94e0e27786f6bc21aee3c775849fb50fd, MIT. src/avr-runtime.js là nơi giữ provenance này; module GPIO dùng đúng API hook của bản vendored đó.

Thanh ghi dùng địa chỉ data-space ATmega328P:

| Port | PINx | DDRx | PORTx | GPIO Arduino Uno được mô hình |
| --- | ---: | ---: | ---: | --- |
| B | 0x23 | 0x24 | 0x25 | PB0..PB5 = D8..D13 |
| C | 0x26 | 0x27 | 0x28 | PC0..PC5 = A0..A5 ở chế độ digital |
| D | 0x29 | 0x2A | 0x2B | PD0..PD7 = D0..D7 |

PB6/PB7 và PC6/PC7 không được công bố là pin Arduino Uno GPIO trong API này. Module không mô phỏng fuse, oscillator, RESET hoặc chức năng analog.

## API

~~~js
import { createAvrGpio } from "./src/avr-gpio.js";

const gpio = createAvrGpio(cpu, {
  onChange(event) {
    console.log(event.arduinoPin, event.current);
  },
  initialExternalPins: {
    D2: false,
  },
});

gpio.setExternalPin("D2", true);
console.log(gpio.readBoardD13());
console.log(gpio.snapshot());
~~~

Controller trả về:

- setExternalPin(pin, level): level chỉ nhận true, false hoặc null; null nghĩa là không có external driver.
- readPin(pin): nhận alias Arduino như D13, A0 hoặc tên MCU tương ứng như PB5, PC0.
- readBoardD13(): đọc trạng thái PB5/D13.
- snapshot(): snapshot PIN/DDR/PORT của B/C/D và 20 pin Arduino được hỗ trợ.
- reset(): đưa DDRx/PORTx về reset value 0, giữ external input vì đó là môi trường bên ngoài MCU.
- dispose(): tháo đúng các hook do controller cài; gọi nhiều lần an toàn.

Nếu một hook tại PINx/DDRx/PORTx đã bị peripheral khác chiếm, createAvrGpio() từ chối gắn để tránh silently thay thế semantics của peripheral đó.

reset() chỉ reset phần GPIO do module này quản lý; nó không gọi cpu.reset(). Integration muốn reset toàn MCU phải gọi reset CPU và GPIO theo lifecycle của mình.

## Semantics được mô hình

### DDRx và PORTx

Ghi DDRx/PORTx qua cpu.writeData() tôn trọng mask mà avr8js dùng cho các lệnh bit như SBI/CBI. Đọc DDRx/PORTx dùng byte trong cpu.data.

Khi bit DDR = 1, pin ở mode output và mức bounded model bằng PORT latch. Khi bit DDR = 0, PORT bit = 1 bật pull-up digital trong model.

### PINx

Đọc PINx qua cpu.readData() được tính từ mode, pull-up và external input:

- output: bit đọc theo output latch của model;
- input có external true/false: external level được dùng;
- input không external nhưng pull-up bật: đọc HIGH;
- input floating, không pull-up: readPin().level là null để nói rõ trạng thái vật lý không xác định.

CPU vẫn cần một bit xác định để tiếp tục thực thi. Với floating input, bounded model trả 0 trong PINx và ghi registerLevel: false; đây là quy ước deterministic của emulator, không phải tuyên bố chân floating ngoài đời luôn LOW.

Ghi bit 1 vào PINx toggle bit PORTx tương ứng. Ghi 0 không toggle. mask được tôn trọng.

## External pins và contention

External input chỉ là mức logic digital được người dùng/test cấp vào:

~~~js
gpio.setExternalPin("D2", true);   // external HIGH
gpio.setExternalPin("D2", false);  // external LOW
gpio.setExternalPin("D2", null);   // không external driver
~~~

Nếu external level trái với output latch của một pin output, readPin() trả contention: true. Module vẫn dùng output latch làm level/registerLevel trong bounded register model.

contention: true chỉ nói hai nguồn logic được khai báo trái nhau. Module không tính dòng, trở kháng, nhiệt, hư hỏng hoặc kết luận phần cứng an toàn.

## Callback

options.onChange là tùy chọn. Callback chạy đồng bộ khi trạng thái pin được mô hình thay đổi do:

- ddr-write;
- port-write;
- pin-toggle;
- external;
- reset.

Event có dạng:

~~~js
{
  source: "port-write",
  pin: "PB5",
  arduinoPin: "D13",
  previous: { ... },
  current: { ... }
}
~~~

Module không phát callback cho một write không làm thay đổi trạng thái pin quan sát được.

## D13 / PB5

PB5 là D13 trên Arduino Uno. readBoardD13() cho biết mode và mức GPIO của PB5:

~~~js
const d13 = gpio.readBoardD13();
// d13.mode: "input" | "output"
// d13.level: true | false | null
~~~

Đây là mức GPIO PB5 trong máy ảo. Nó không tự động đồng nghĩa với độ sáng LED vật lý, điện áp đo được, dòng LED hoặc trạng thái mô hình 3D.

## Giới hạn

Module chỉ mô hình GPIO digital bounded cho các pin Arduino Uno nêu trên:

- không ADC/PWM timer/UART/SPI/TWI/EEPROM;
- không interrupt pin-change/external interrupt;
- chưa mô hình bit PUD (global Pull-up Disable); pull-up ở đây giả định trạng thái mặc định PUD = 0;
- không debounce, switch, LED, motor hoặc sensor physics;
- không open-drain/open-collector, impedance, current hoặc analog voltage;
- không khẳng định firmware bất kỳ tương đương phần cứng thật;
- không thay thế datasheet ATmega328P hay kiểm thử trên bo thật.

## Browser contract

Sau khi chạy local server:

~~~js
import("/tests/avr-gpio-contracts.js")
  .then(m => console.log(m.runAvrGpioContracts()));
~~~

Contract kiểm tra địa chỉ register, DDR/PORT/PIN semantics, masked writes, pull-up, external input, floating input, D13/PB5, PIN toggle, callback, reset/dispose, hook conflict và một chuỗi lệnh AVR thật LDI/OUT/IN đi qua hook.
