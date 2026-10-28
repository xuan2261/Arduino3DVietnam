# Engine mạch điện tương tác

`src/circuit.js` cung cấp một netlist nhỏ, xác định trước cho các bài thực hành đấu dây trên breadboard. Engine chỉ kiểm tra topology học tập của từng bài; nó không tính điện áp/dòng điện, không chạy Arduino C++ và không thay thế SPICE.

## Phạm vi hiện tại

| Bài | Mạch được kiểm tra | Terminal chính |
| --- | --- | --- |
| 02 — LED nhấp nháy | D13 → điện trở 220 Ω → LED đúng cực → GND | `D13`, `GND`, `R1:A/B`, `LED:A/K` |
| 03 — Nút nhấn | 5V → nút → D2, kéo xuống 10 kΩ, LED đầu ra D13 | `5V`, `GND`, `D2`, `D13`, `BTN:1/2`, `R_PULL:A/B`, `R_LED:A/B`, `LED:A/K` |
| 05 — LED RGB | Ba chân PWM qua ba điện trở tới R/G/B, cathode chung về GND | `D9`, `D10`, `D11`, `GND`, `R_R:A/B`, `R_G:A/B`, `R_B:A/B`, `RGB:R/G/B/K` |

Các bài khác là fallback có chủ đích: `listTerminals()` trả `[]`, `createCircuit()` vẫn tạo state `supported: false`, còn `analyzeCircuit()` trả issue `UNSUPPORTED_LESSON`. Giao diện có thể dùng cờ này để ẩn editor đấu dây và tiếp tục hiển thị sơ đồ bài học hiện có.

## API ổn định

```js
import {
  createCircuit,
  connectCircuit,
  disconnectCircuit,
  analyzeCircuit,
  listTerminals,
} from "./src/circuit.js";

let circuit = createCircuit(2);
circuit = connectCircuit(circuit, "D13", "R1:A");
circuit = connectCircuit(circuit, "R1:B", "LED:A");
circuit = connectCircuit(circuit, "LED:K", "GND");

console.log(analyzeCircuit(2, circuit));
```

`connectCircuit()` và `disconnectCircuit()` trả state mới, không sửa state đầu vào. `disconnectCircuit(state, indexOrId)` chấp nhận chỉ số mảng zero-based hoặc ID dạng `w1`, `w2`, ... . Kết nối terminal không tồn tại, tự nối một terminal, dây trùng hoặc vượt giới hạn đều bị từ chối bằng exception rõ ràng.

State có dạng:

```js
{
  version: 1,
  lessonId: 2,
  supported: true,
  wires: [{ id: "w1", from: "D13", to: "R1:A" }],
  nextWireId: 2
}
```

`analyzeCircuit()` trả:

- `supported`: bài có engine hay không.
- `ok`: mạch hoàn chỉnh và không có lỗi mức `error`.
- `functional`: tất cả đường chức năng định nghĩa cho bài đã đủ.
- `issues[]`: `{code, severity, message, terminals}` để UI hiển thị phản hồi cụ thể.
- `paths[]`: các đường chức năng của bài và cờ `complete`.
- `nets[]`: các nhóm terminal đang được nối trực tiếp bằng dây.
- `stats`: số dây, terminal, path và các giới hạn tương ứng.

## Các lỗi được phát hiện

Engine cho phép người học tạo dây sai giữa các terminal hợp lệ để có thể phân tích lỗi sau đó. Các nhóm lỗi chính gồm:

- nối tắt `5V` với `GND`, hoặc chân output nối trực tiếp với `GND`/nguồn trong topology liên quan;
- LED nối trực tiếp mà thiếu điện trở hạn dòng, điện trở bị dây nối tắt qua, LED đảo anode/cathode;
- bài nút nhấn thiếu `D2`, `5V`, `GND`, thiếu đường 5V → nút → D2, thiếu điện trở kéo xuống, kéo D2 lên 5V thay vì xuống GND, hoặc tạo chập 5V–GND khi nhấn;
- bài RGB thiếu điện trở riêng cho từng kênh, nối sai đường kênh, cathode chung chưa về GND, hoặc hai chân PWM bị nối chung trực tiếp.

## Giới hạn cố định

Engine cố ý nhỏ và xác định trước:

- tối đa `24` dây trong một state;
- tối đa `16` terminal cho một bài được hỗ trợ;
- tối đa `4` đường chức năng được đánh giá cho một bài;
- terminal phải nằm trong whitelist của đúng bài; engine không nhận netlist linh kiện tùy ý từ người dùng;
- phân tích dựa trên kết nối dây và topology linh kiện đã khai báo, không thực hiện tìm nghiệm điện, không mô phỏng timing của nút/LED và không thực thi Sketch.

Nhờ các giới hạn này, kết quả là deterministic và phù hợp với mục tiêu phản hồi tức thời trong bài học cơ bản.

## Kiểm tra hợp đồng

Sau khi chạy server local, mở DevTools trên trang ứng dụng và chạy:

```js
import("/tests/circuit-contracts.js").then(m => console.log(m.runCircuitContracts()))
```

Suite kiểm tra ba mạch đúng, dây sai/short, thiếu điện trở, đảo cực LED, sai pull-down, terminal bị ngắt, fallback bài chưa hỗ trợ và giới hạn số dây.
