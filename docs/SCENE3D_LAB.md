# Three.js v1.5 — lab layout khái niệm

src/scene3d.js nhận bố trí từ src/lab-layout.js và hiển thị chúng bằng Three.js r180. Lớp này là bố trí trực quan khái niệm cho việc học và chỉnh vị trí linh kiện; nó không xác nhận tọa độ lỗ breadboard, dây vật lý, dòng/áp hay trạng thái phần cứng thật.

## Nguồn dữ liệu

Scene không tự tạo schema bố trí. setLabLayout(layout) nhận đúng object do createLabLayout(), moveLabComponent() và rotateLabComponent() của src/lab-layout.js quản lý:

~~~text
layout = {
  version: 1,
  mode: "conceptual-layout",
  lessonId,
  units: "logical-grid",
  grid: 0.5,
  bounds: { minX, maxX, minZ, maxZ },
  claims: {
    physicalVerified: false,
    breadboardHoleMapping: false,
    electricalPower: false
  },
  components: [...],
  terminals: [...],
  terminalMap: {...}
}
~~~

Scene gọi validateLabLayout(layout, layout.terminals) trước khi render và dùng labTerminalAnchor(layout, terminalId) làm nguồn anchor terminal. Layout sai schema, claim physical mapping hoặc lessonId không khớp lesson đang hiển thị đều bị từ chối.

## API mới

Controller trả về từ mountScene() giữ toàn bộ API cũ và bổ sung:

~~~js
scene.setLabLayout(layout);

scene.setLabEdit({
  enabled: true,
  selectedComponentId: "LED",
  onSelectComponent(componentId, detail) {},
  onMoveComponent(componentId, x, z, detail) {},
  onTerminalSelect(terminalId, detail) {},
});
~~~

selectedComponentId là tùy chọn. setLabLayout(null) dọn lab layout và quay lại scene legacy của lesson.

### Kết quả setLabLayout

~~~js
{
  mode: "conceptual-layout",
  lessonId: 2,
  units: "logical-grid",
  componentCount: 4,
  terminalCount: 6,
  worldScale: 0.72,
  worldBounds: { minX, maxX, minZ, maxZ },
  anchorModel: "conceptual-perimeter",
  physicalVerified: false,
  breadboardHoleMapping: false,
  electricalPower: false
}
~~~

worldScale chỉ là phép biến đổi hiển thị từ logical-grid sang world scene. Callback move luôn trả x/z ở logical-grid, không trả world units.

## Callback edit

Callbacks dùng positional arguments để tương thích lab-editor-ui.js:

- onSelectComponent(componentId, detail)
- onMoveComponent(componentId, x, z, detail)
- onTerminalSelect(terminalId, detail)

componentId của onSelectComponent có thể là null. Scene phát null khi người học chủ động bỏ chọn bằng Escape hoặc tap vào nền trống; detail.action khi đó là "deselect". Khi chọn component, kể cả Arduino fixed, detail.action là "select". detail.physicalVerified luôn là false.

Move metadata:

~~~js
{
  kind: "move" | "rotate",
  source: "drag" | "keyboard",
  x,
  z,
  quarterTurns,
  deltaQuarterTurns,
  physicalVerified: false
}
~~~

Scene chỉ phát intent. Canonical layout vẫn thuộc lab-layout.js; caller phải dùng moveLabComponent() hoặc rotateLabComponent() rồi gọi lại setLabLayout(nextLayout). Scene không tự ghi layout canonical.

## Interaction

Khi edit tắt:

- ArrowLeft/ArrowRight/ArrowUp/ArrowDown vẫn điều khiển camera như trước.
- +/−, Home, Enter/Space giữ contract scene cũ.
- touch action inline được gỡ để CSS pan-y hiện có tiếp tục cho phép cuộn trang.
- layout vẫn có thể hiển thị; chỉ interaction chỉnh sửa bị tắt.

Khi edit bật:

- click/tap component chọn component;
- kéo component không fixed trên ground plane tạo vị trí preview và phát một move intent khi thả;
- terminal có hit target riêng lớn hơn marker để thao tác touch dễ hơn;
- W/A/S/D dịch component đã chọn theo layout.grid;
- Q/E preview xoay ±90 độ và phát rotate intent qua onMoveComponent với detail.kind = "rotate";
- Escape bỏ chọn;
- Arrow keys vẫn chỉ điều khiển camera, không bị đổi nghĩa.

Trong edit mode, canvas tạm dùng touch-action: none để drag component. Khi tắt edit, inline value được gỡ và CSS pan-y hoạt động lại.

Tap và drag dùng khoảng cách tích lũy từ pointerdown, không dùng jitter của từng pointermove:

- mouse: vượt 4 CSS px mới được coi là drag;
- pen: vượt 6 CSS px;
- touch: vượt 10 CSS px.

Vì vậy touch jitter 2–4 px vẫn là tap terminal hợp lệ. Khi vượt ngưỡng, terminal gesture không phát onTerminalSelect. pointercancel và lostpointercapture cũng kết thúc gesture mà không phát terminal tap; component drag bị hủy sẽ trả preview về canonical layout và khôi phục selection trước gesture.

Tap nền trống chỉ deselect khi gesture vẫn là tap; camera/background drag không tự deselect. Tap Arduino fixed vẫn phát onSelectComponent("arduino", detail) để HTML editor có thể đồng bộ selection, nhưng move/rotate của component fixed vẫn bị chặn.

### Bounds

Preview drag/keyboard bị clamp theo layout.bounds và footprint đã tính đến quarterTurns. Collision/non-overlap canonical không được scene tự quyết định; caller vẫn phải áp dụng moveLabComponent() hoặc rotateLabComponent() của layout engine, vốn là nguồn validation chính.

Arduino component có fixed: true; scene cho phép chọn nhưng không drag hoặc keyboard move/rotate.

## Component và terminal visuals

Scene dựng representation bounded theo visualKind:

- Arduino Uno, breadboard;
- resistor, LED/RGB LED, button, potentiometer;
- photoresistor, force/temperature/soil sensor, HC-SR04;
- buzzer, driver, servo, power source và generic component.

Arduino legacy model cũng được bổ sung silk/header labels dễ đọc hơn như DIGITAL D0–D13, ANALOG A0–A5 và 5V/3V3/GND.

Terminal marker được đặt theo labTerminalAnchor(). Marker và label là conceptual perimeter anchors, không phải pin/package geometry hoặc breadboard-hole mapping đã xác minh.

## Netlist wires trong lab

setWiring() giữ nguyên contract cũ:

~~~text
mode: "conceptual-netlist"
physicalMapping: "none"
~~~

Khi lab layout đang active, scene ẩn panel dây legacy để giảm chồng hình và vẽ thêm các Line khái niệm giữa terminal anchors tương ứng. Màu vẫn dùng topology status hiện có: checked, warning, error hoặc unverified.

Các line này:

- dùng terminal ID từ netlist;
- cập nhật theo preview move/rotate của component;
- có physicalLocation:false và physicalVerified:false;
- không mô phỏng dòng điện, điện áp, chiều dòng hoặc trạng thái linh kiện vật lý.

Dataset phục vụ integration/test:

- data-lab-layout-mode
- data-lab-component-count
- data-lab-terminal-count
- data-lab-wire-count
- data-lab-selected-component
- data-lab-physical-verified="false"
- data-lab-breadboard-hole-mapping="false"
- data-lab-electrical-power="false"

## Lifecycle và WebGL

Lab layer dùng cùng on-demand render loop của scene. Camera/control changes tiếp tục coalesce qua một requestAnimationFrame.

webglcontextlost:

- gọi preventDefault();
- hủy RAF và pointer interaction đang chạy;
- giữ cùng lifecycle khôi phục Three.js r180 của scene hiện có.

webglcontextrestored gọi lại resize/invalidate như scene legacy. Lab geometries, terminal labels, selection frames và conceptual wire lines đi qua cùng dispose/restore lifecycle.

dispose():

- tháo toàn bộ event listener cũ;
- dọn lab layer, line/geometry/material/texture;
- dọn legacy module/wiring/Arduino/breadboard;
- force context loss theo contract hiện có rồi dispose renderer;
- xóa canvas.

## Giới hạn claim

Không được suy ra từ 3D lab:

- breadboard hole nào được nối nội bộ với hole nào;
- vị trí package/pin vật lý chính xác;
- điện áp/dòng/công suất/tải;
- LED, motor, pump, servo hoặc sensor thật đã hoạt động;
- AVR peripheral output là output vật lý của component 3D.

Normal JavaScript lesson demo, AVR peripheral lab, netlist topology và 3D lab là các lớp độc lập. Scene chỉ trực quan hóa layout/netlist đã cung cấp; nó không nâng phạm vi xác minh của bất kỳ lớp nào.

## Contracts

tests/scene3d-lab-contracts.js kiểm tra:

- exact layout schema acceptance và physical-claim rejection;
- world bounds/claims datasets;
- conceptual netlist wire anchoring;
- disabled-edit giữ camera/touch-scroll contract;
- component selection và terminal click bằng Raycaster;
- touch jitter terminal 2–4 px vẫn tap, true drag không tap, pointercancel/lostcapture không tap;
- background/Escape deselect phát selection null và fixed Arduino phát selection ID;
- touch drag trên ground plane và bounds;
- keyboard move/rotate, fixed Arduino và Escape;
- callback validation;
- lesson mismatch;
- WebGL context loss/restore khi lab layer đang active;
- clear/dispose cleanup.

Suite tests/scene3d-contracts.js cũ vẫn là regression gate cho 25 contract scene legacy.
