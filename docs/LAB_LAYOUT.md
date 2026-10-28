# Lab Layout — mô hình bố trí 3D logic v1.5

`src/lab-layout.js` là mô hình bố trí **thuần dữ liệu** cho 15 bài netlist 02..16. Nó không phụ thuộc Three.js, DOM, Node.js hay network. Scene/UI nhận object layout rồi tự render.

Mục tiêu của module là cho phép đặt, kéo và xoay các nhóm linh kiện theo một mặt phẳng X/Z ổn định mà vẫn giữ quan hệ terminal chính xác với `listTerminals()`. Đây là **conceptual layout**, không phải bản vẽ cơ khí, breadboard-hole map hay mô phỏng điện.

## API

```js
import {
  createLabLayout,
  moveLabComponent,
  rotateLabComponent,
  labTerminalAnchor,
  validateLabLayout,
} from "./src/lab-layout.js";

const terminals = listTerminals(lesson.id);
let layout = createLabLayout(lesson.id, terminals);

layout = moveLabComponent(layout, "LED", 4.5, 2.0);
layout = rotateLabComponent(layout, "LED");

const anchor = labTerminalAnchor(layout, "LED:A");
const report = validateLabLayout(layout, terminals);
```

Các mutator là **pure**: chúng không sửa object đầu vào mà trả về layout frozen mới.

## Shape chuẩn

```js
{
  version: 1,
  mode: "conceptual-layout",
  lessonId: 16,
  units: "logical-grid",
  grid: 0.5,
  bounds: { minX: -10, maxX: 10, minZ: -7, maxZ: 7 },
  claims: {
    physicalVerified: false,
    breadboardHoleMapping: false,
    electricalPower: false,
  },
  components: [
    {
      id: "arduino",
      visualKind: "arduino-uno",
      label: "Arduino Uno R3",
      fixed: true,
      x: -7,
      z: 0,
      quarterTurns: 0,
      width: 3.5,
      depth: 4.5,
      terminalIds: ["5V", "GND", "A0", "A1", "D2", "D8", "D13"],
      anchorModel: "conceptual-perimeter"
    },
    {
      id: "breadboard",
      visualKind: "breadboard",
      fixed: false,
      terminalIds: []
    }
  ],
  terminals: [ /* snapshot của listTerminals() */ ],
  terminalMap: { /* terminal id -> component/slot metadata */ }
}
```

`layout.components` là field tích hợp chính thức cho scene/editor.

### Component identity

- `arduino`: luôn tồn tại, fixed position và không cho move/rotate.
- `breadboard`: luôn tồn tại như một **vùng bố trí khái niệm**, có thể move/rotate nhưng `terminalIds` luôn rỗng. Module không tạo row/column/hole index.
- Mỗi giá trị `terminal.component` khác `arduino` tạo đúng **một** visual component group. ID renderer dùng chính xác chuỗi component của netlist, ví dụ `R1`, `LED`, `RGB`, `POT`, `SONAR`, `KEY1`, `DRV`, `SERVO`, `MOTOR_SUPPLY`, `LM35`.

Thứ tự các component netlist theo lần xuất hiện đầu tiên trong `listTerminals()`, vì vậy deterministic và không cần alias table riêng.

`visualKind` chỉ là render hint, ví dụ `resistor`, `led`, `rgb-led`, `button`, `potentiometer`, `photoresistor`, `force-sensor`, `temperature-sensor`, `soil-sensor`, `ultrasonic-sensor`, `buzzer`, `driver`, `servo`, `power-source`. Nó không thay đổi topology hoặc terminal identity.

## Terminal anchor

```js
labTerminalAnchor(layout, "LM35:VOUT")
```

trả về dạng:

```js
{
  terminalId: "LM35:VOUT",
  componentId: "LM35",
  label: "LM35 Vout",
  kind: "signal",
  polarity: null,
  x: 4.95,
  y: 0,
  z: -0.7,
  anchorModel: "conceptual-perimeter",
  physicalVerified: false
}
```

`terminalId` luôn là **exact ID từ `listTerminals()`**. Contract cũng chạy mọi endpoint trong `sampleWires()` của 15 lesson và yêu cầu resolve trực tiếp qua `labTerminalAnchor()`.

Anchor được phân bố tuần tự quanh perimeter logic của visual component rồi biến đổi theo `quarterTurns`. Nó không biểu diễn chân package thật, header pin thật trên Uno hay lỗ breadboard thật.

## Move, snap và collision

Toàn bộ component di động dùng grid `0.5` logical unit trong bounds `X=-10..10`, `Z=-7..7`.

`moveLabComponent(layout, componentId, x, z)`:

1. snap request về grid 0.5;
2. chỉ xét vị trí mà footprint sau rotation nằm hoàn toàn trong bounds;
3. bỏ các candidate chồng lấn component khác với khoảng cách logic tối thiểu;
4. chọn candidate gần request nhất, tie-break theo X rồi Z để deterministic;
5. ném `RangeError` nếu không còn vị trí hợp lệ.

Do đó request ngoài bounds được đưa về vị trí snapped gần nhất có thể, và request vào giữa Arduino/breadboard/component khác sẽ được dời tới vị trí không overlap gần nhất thay vì tạo geometry xuyên nhau.

## Rotation

`rotateLabComponent(layout, componentId, quarterTurns = 1)` dùng quarter-turn quanh trục Y. Giá trị integer được normalize modulo 4; `-1`, `5`... đều hợp lệ. Footprint width/depth được hoán đổi logic ở rotation lẻ.

Nếu xoay tại chỗ gây overlap hoặc vượt bounds, component được chuyển tới vị trí hợp lệ gần nhất bằng cùng thuật toán deterministic collision resolution. Arduino fixed không được xoay.

## Validation

`validateLabLayout(layout, terminals)` không sửa layout và trả:

```js
{
  ok: true,
  errors: [],
  warnings: [],
  stats: {
    components: 9,
    netlistComponents: 7,
    terminals: 22
  }
}
```

Validator kiểm tra:

- version/mode/units/grid/lesson range;
- claim boundary luôn false cho physical verification, breadboard-hole mapping và electrical power;
- Arduino/breadboard tồn tại đúng vai trò fixed/movable;
- one visual group per real `terminal.component`;
- terminal IDs không thiếu, không thừa, không map sang component khác;
- `terminalIds` của từng component khớp input terminals;
- X/Z finite, snap grid, quarter rotation hợp lệ, footprint trong bounds;
- không overlap component;
- breadboard không có terminal/hole mapping giả.

## Determinism và immutability

Cùng `lessonId` + cùng array `listTerminals()` theo cùng thứ tự tạo cùng JSON layout. Layout, components, terminal metadata, terminal map, bounds và claims đều frozen ở output public.

Pure model không đọc thời gian, random, DOM, viewport, WebGL hay storage. Renderer có thể thêm camera/Y-height/material theo nhu cầu nhưng không nên ghi ngược trạng thái render vào layout.

## Claim boundary

Module này **không** xác minh:

- kích thước hoặc khoảng cách thực của Arduino Uno, breadboard hay linh kiện;
- tọa độ chân package/header/lỗ breadboard;
- component có được “cắm” đúng lỗ hay không;
- dòng điện, điện áp, nguồn, công suất hoặc an toàn phần cứng;
- dây có topology đúng hay không — việc đó thuộc circuit analyzer;
- vật cản 3D chính xác theo mesh thực.

`width/depth`, X/Z và terminal perimeter slots chỉ là logical display geometry để tạo trải nghiệm 3D nhất quán. Scene phải giữ nhãn/UX theo nghĩa **conceptual layout**.

## Browser contract

Chạy server MIME-safe của dự án rồi trong Chrome:

```js
import('/tests/lab-layout-contracts.js')
  .then(m => m.runLabLayoutContracts())
```

Contract hiện có **27 checks**: 15 lesson 02..16, deterministic output, one-group-per-component, exact terminal/sample-wire anchors, move/rotate purity, snap/bounds/collision, movable breadboard, fixed Arduino, input guards, validator tamper detection, frozen public output và explicit no electrical/physical fields.

Kết quả browser cuối ngày 28/10/2026: lab-layout **27/27 PASS**, browser baseline **74/74 PASS**, circuit **29/29 PASS**, extended circuit **77/77 PASS**, console **0 error / 0 warning**. Scoped `git diff --check` PASS. Không chạy release/build pipeline vì phase này cấm build/deploy.
