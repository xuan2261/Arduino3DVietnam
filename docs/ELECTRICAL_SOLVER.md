# Bộ tính điện LED 5 V có giới hạn

`src/electrical-solver.js` bổ sung một phép tính điện đơn giản cho các đường LED + điện trở đã được `circuit-router` xác nhận đúng topology. Mục tiêu là minh họa công thức dòng thuận của LED trong các bài cơ bản; đây không phải SPICE, không giải netlist tùy ý và không thay thế việc kiểm tra linh kiện thật theo datasheet.

## API

```js
import { analyzeElectrical } from "./src/electrical-solver.js";

const result = analyzeElectrical(lessonId, circuit, options);
```

`circuit` phải là state mạch tương thích với `src/circuit-router.js`. Solver gọi `analyzeCircuit(lessonId, circuit)` trước, đồng thời đối chiếu các terminal qua `listTerminals(lessonId)`. Nếu topology chưa hoàn chỉnh hoặc có lỗi như thiếu điện trở, LED đảo cực hay short, phép tính bị chặn và `channels` là mảng rỗng.

Các export công khai:

- `analyzeElectrical(lessonId, circuit, options?)`
- `SUPPORTED_ELECTRICAL_LESSONS` = `[2, 3, 5]`
- `ELECTRICAL_LIMITS`

## Mô hình vật lý dùng trong bài học

Solver dùng mô hình điện trở nối tiếp và điện áp thuận LED hằng số:

`I = (Vs - Vf) / R`

Đơn vị trong kết quả được ghi rõ:

- điện áp: `V`
- điện trở: `ohm`
- dòng điện: `mA`

Nguồn luôn là `Vs = 5 V`. Khi nguồn là chân digital/PWM, phép tính giả định chân đó đang ở mức `HIGH` lý tưởng 5 V. Dòng trả về là dòng tức thời khi kênh ở HIGH; solver không biến duty cycle PWM thành dòng trung bình và không mô hình hóa sụt áp của chân I/O, nhiệt độ, sai số điện trở, đường cong I-V hay giới hạn dòng thực của vi điều khiển.

Giá trị mặc định cố ý là các giá trị điển hình để học công thức:

| Bài/kênh | Nguồn | R mặc định | Vf mặc định | Dòng tính ở HIGH |
| --- | --- | ---: | ---: | ---: |
| 02 LED đỏ | D13 | 220 ohm | 2.0 V | 13.636 mA |
| 03 LED đầu ra | D13 | 220 ohm | 2.0 V | 13.636 mA |
| 05 RGB đỏ | D9 | 220 ohm | 2.0 V | 13.636 mA |
| 05 RGB xanh lá | D10 | 220 ohm | 2.2 V | 12.727 mA |
| 05 RGB xanh dương | D11 | 220 ohm | 3.0 V | 9.091 mA |

Bài 02 và 03 ghi rõ điện trở LED 220 ohm trong nội dung khóa học. Bài 05 chỉ yêu cầu một điện trở hạn dòng riêng cho từng kênh, nên 220 ohm ở đây là giả định điển hình của solver và luôn được trả lại trong kết quả để UI không trình bày nó như một giá trị đã đo.

## Tùy chọn hữu hạn

```js
analyzeElectrical(2, circuit, {
  supplyVolts: 5,
  maxCurrentMilliAmps: 15,
  channels: {
    led: {
      resistorOhms: 330,
      forwardVoltageVolts: 2.1,
    },
  },
});
```

Giới hạn được cố định để API không trở thành bộ giải điện tổng quát:

| Tham số | Phạm vi |
| --- | --- |
| `supplyVolts` | chỉ `5` |
| `resistorOhms` | 100–10000 ohm |
| `forwardVoltageVolts` | 1.5–4.0 V |
| `maxCurrentMilliAmps` | `null`/bỏ qua, hoặc 1–40 mA |

`maxCurrentMilliAmps` chỉ là ngưỡng cảnh báo do caller cung cấp. Solver không tự gán 20 mA hay một con số khác làm dòng tối đa của mọi LED. Khi dòng tính toán vượt ngưỡng, kết quả có issue `CURRENT_ABOVE_MAX_WARNING`; phép tính vẫn được trả về để người học thấy vì sao ngưỡng bị vượt.

`channels` chỉ nhận ID của đúng bài:

- bài 02: `led`
- bài 03: `output-led`
- bài 05: `red`, `green`, `blue`

Nguồn khác 5 V, channel ngoài bài, điện trở/Vf ngoài giới hạn hoặc option không biết sẽ bị từ chối bằng exception rõ ràng.

## Kết quả

Ví dụ topology đúng của bài 02 trả cấu trúc dạng:

```js
{
  lessonId: 2,
  supported: true,
  ok: true,
  blocked: false,
  calculated: true,
  assumptions: {
    educationalOnly: true,
    model: "constant-forward-voltage-series-resistor",
    supplyVolts: 5,
    currentEquation: "I = (Vs - Vf) / R",
    maxCurrentMilliAmps: null,
    units: { voltage: "V", resistance: "ohm", current: "mA" }
  },
  channels: [{
    id: "led",
    sourceTerminal: "D13",
    resistorComponent: "R1",
    resistorOhms: 220,
    forwardVoltageVolts: 2,
    resistorVoltageVolts: 3,
    currentMilliAmps: 13.636,
    withinMaxCurrent: null
  }],
  issues: [],
  topology: { /* kết quả đầy đủ từ circuit-router */ }
}
```

Ý nghĩa các cờ:

- `supported`: bài có mô hình tính dòng hữu hạn trong module này.
- `blocked`: topology hoặc contract terminal chưa cho phép tính.
- `calculated`: đã tạo các giá trị dòng cho `channels`.
- `ok`: không có issue mức `error`; warning không làm mất kết quả tính.
- `topology`: giữ nguyên kết quả `circuit-router` để UI có thể giải thích lỗi đấu dây gốc.

## Bài 03

Bài 03 được hỗ trợ vì topology hiện tại định nghĩa rõ một nhánh LED độc lập `D13 -> R_LED 220 ohm -> LED -> GND`. Solver chỉ tính nhánh LED đó sau khi cả mạch bài 03 đã đạt `analyzeCircuit()`, bao gồm đường nút 5 V -> nút -> D2 và điện trở kéo xuống 10 kohm. Nó không tính dòng qua nút hoặc nhánh kéo xuống.

## Contract tests

Trong browser đã phục vụ dự án qua HTTP:

```js
import("/tests/electrical-solver-contracts.js")
  .then(m => console.log(m.runElectricalSolverContracts()));
```

Suite kiểm tra phép tính thật cho bài 02/03/05, override hữu hạn, cảnh báo dòng tùy chọn, nguồn 5 V cố định, giới hạn Vf/R, và việc chặn tính khi thiếu điện trở, LED đảo cực hoặc short.
