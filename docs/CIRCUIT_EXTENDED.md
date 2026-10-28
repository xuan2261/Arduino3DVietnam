# Engine netlist mở rộng

src/circuit-extended.js bổ sung topology đấu dây có giới hạn cho các bài Arduino tiếp theo. Engine chỉ xác minh kết nối của đúng lesson; nó không giải mạch điện tổng quát, không tính dòng/áp và không chạy Arduino C++.

## Phạm vi

SUPPORTED_EXTENDED_LESSONS:

~~~text
04, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16
~~~

Kết hợp với engine gốc cho bài 02, 03 và 05, ứng dụng có netlist bounded cho 15/16 bài. Bài 01 dùng LED onboard và không cần breadboard wiring ngoài bo.

| Bài | Topology được kiểm tra |
| --- | --- |
| 04 | Biến trở giữa 5V/GND, wiper → A0; D9 → điện trở → LED → GND |
| 06 | 5V → LDR → A0 → 10 kΩ → GND; D13 → điện trở → LED |
| 07 | HC-SR04 nguồn đúng cực, D7→Trig, Echo→D8; LED cảnh báo có điện trở |
| 08 | D8 → buzzer (+), buzzer (−) → GND |
| 09 | 7 nút INPUT_PULLUP D2–D8, mỗi nút xuống GND; buzzer D9 |
| 10 | Mặt logic driver cầu H: D9→ENA, D7→IN1, D8→IN2, GND chung |
| 11 | LM35: 5V/Vs, A0/Vout, GND; LED D13 có điện trở |
| 12 | Servo: D9→signal; nguồn servo **riêng phù hợp** (+/−)→VCC/GND, mass nguồn nối chung GND Arduino |
| 13 | D2→STEP, D3→DIR, GND chung; nguồn động cơ riêng (+)→VMOT và (−)→GND driver |
| 14 | Tín hiệu cảm biến độ ẩm → A0; D8 → input driver/relay bơm; GND logic chung |
| 15 | 5V → FSR → A0 → điện trở chia áp → GND; LED D13 có điện trở |
| 16 | LDR/A0, LM35/A1, nút INPUT_PULLUP D2, LED D13 có điện trở và buzzer D8 |

## API cho UI

~~~js
import {
  SUPPORTED_EXTENDED_LESSONS,
  EXTENDED_CIRCUIT_LIMITS,
  createExtendedCircuit,
  connectExtendedCircuit,
  disconnectExtendedCircuit,
  analyzeExtendedCircuit,
  listExtendedTerminals,
  getExtendedSampleWires,
} from "./src/circuit-extended.js";
~~~

State:

~~~js
{
  version: 1,
  engine: "extended-v1",
  lessonId: 7,
  supported: true,
  wires: [{ id: "w1", from: "5V", to: "SONAR:VCC" }],
  nextWireId: 2
}
~~~

connectExtendedCircuit và disconnectExtendedCircuit trả state mới, không sửa state đầu vào. Wire ID tăng theo w1, w2, ...

listExtendedTerminals trả:

~~~text
{ id, label, kind, component, polarity }
~~~

analyzeExtendedCircuit giữ shape tương thích với engine gốc:

- supported, ok, functional;
- issues: các phần tử {code,severity,message,terminals};
- paths: các phần tử {id,label,complete};
- nets: các net được nối trực tiếp bằng dây;
- stats: số dây, terminal, functional path và giới hạn.

## Sample wires

getExtendedSampleWires(lessonId) là nguồn mẫu chuẩn cho integration. Getter luôn trả bản sao.

Ví dụ bài 07:

~~~js
[
  ["5V", "SONAR:VCC"],
  ["GND", "SONAR:GND"],
  ["D7", "SONAR:TRIG"],
  ["D8", "SONAR:ECHO"],
  ["D13", "R_LED:A"],
  ["R_LED:B", "LED:A"],
  ["LED:K", "GND"]
]
~~~

Ví dụ bài 13:

~~~js
[
  ["D2", "DRV:STEP"],
  ["D3", "DRV:DIR"],
  ["GND", "DRV:GND"],
  ["MOTOR:+", "DRV:VMOT"],
  ["MOTOR:-", "DRV:GND"]
]
~~~

## Safety checks

Engine có các guard theo topology:

- các direct-wire net được giới hạn theo nhóm chân có thể chia sẻ một node trong sơ đồ mẫu của đúng bài; nối thêm dây trộn tín hiệu cảm biến với tải LED/driver không được coi là “Mạch đúng” dù các đường chức năng cũ vẫn còn. Các điện trở/nút thụ động có thể đảo chiều chân tương đương nhưng không được nối tắt qua;

- chập 5V–GND, output–GND, output–5V và hai output bị nối chung;
- output STEP/DIR của bài 13 bị nối vào VMOT;
- Echo D8 của HC-SR04 bị kéo cứng về 5V/GND hoặc Trig/Echo bị nối chung;
- input analog bị kéo cứng về rail làm mất tín hiệu cảm biến;
- LED thiếu điện trở, điện trở bị bypass, đảo anode/cathode;
- HC-SR04, LM35, servo và nguồn VMOT bị đảo cực;
- buzzer bị đảo cực theo sơ đồ bài;
- divider LDR/FSR thiếu nhánh, bị bypass hoặc đảo sensor/resistor so với chiều ADC của lesson;
- phím piano bị nối cứng GND, hai input phím bị short hoặc nút bị bypass;
- D2 INPUT_PULLUP bài 16 bị nối cứng GND/5V thay vì đi qua nút;
- A0 bài 14 bị short với D8 hoặc GND;
- driver cầu H/driver bước bị nối sai signal mapping.

Một mạch mẫu đúng cộng thêm dây sai nguy hiểm phải trả ok=false. Các browser contracts có regression riêng cho D8 Echo→5V/GND, A0 bài 14→GND và D2/D3 bài 13→VMOT.

## Giới hạn cố định

EXTENDED_CIRCUIT_LIMITS:

- maxWires = 48;
- maxTerminals = 32;
- maxFunctionalPaths = 12.

State sai engine/version, lessonId không khớp, terminal ngoài whitelist, self-wire, duplicate edge, duplicate wire ID hoặc vượt bounds đều bị từ chối trước phân tích.

## Giới hạn vật lý có chủ đích

Engine không được xem là bằng chứng một mạch thật an toàn hoặc hoàn chỉnh:

- không tính dòng LED, giá trị điện trở thực, công suất nguồn, nhiễu, timing hoặc tải;
- bài 10 chỉ kiểm tra tín hiệu logic Arduino→driver cầu H. Nó không chứng minh nguồn motor, OUT1/OUT2, diode, current rating hoặc wiring công suất an toàn;
- bài 13 chỉ kiểm tra STEP/DIR, GND chung và cực nguồn riêng tại VMOT/GND. Nó không mô hình cuộn dây motor, giới hạn dòng, vi bước, điện áp nguồn phù hợp hay chân enable/sleep của từng driver;
- bài 12 minh họa nguồn **riêng phù hợp** cho servo, không mặc định dùng chân 5V Arduino để cấp tải; engine chỉ kiểm tra cực nguồn, đường D9 và GND chung, không chứng minh điện áp, khả năng cấp dòng hoặc tương thích servo cụ thể;
- bài 14 chỉ kiểm tra signal/GND vì model cảm biến độ ẩm và relay/driver cụ thể chưa được chốt. Engine không chứng minh nguồn bơm hoặc relay contact an toàn;
- terminal LM35 dùng vai trò điện VS/VOUT/GND, không xác nhận thứ tự chân vật lý của từng package;
- với phần cứng thật vẫn phải đối chiếu datasheet và giới hạn điện của linh kiện.

## Browser contracts

Chạy local server rồi mở DevTools:

~~~js
import("/tests/extended-circuit-contracts.js")
  .then(m => console.log(m.runExtendedCircuitContracts()))
~~~

Suite có sample hợp lệ cho toàn bộ 12 bài, negative cases cho short/polarity/missing-resistor/signal mapping/common-ground, regression wrong-tie và bounds.
