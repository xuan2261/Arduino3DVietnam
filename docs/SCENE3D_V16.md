# Three.js scene quality v1.6

Phiên bản v1.6 nâng chất lượng trực quan của src/scene3d.js nhưng giữ nguyên ranh giới mô hình v1.5:

- 3D chỉ là lớp hiển thị/interaction;
- netlist/electrical state vẫn thuộc circuit engine;
- bố trí component vẫn thuộc src/lab-layout.js;
- terminal/hole/pin trong scene không phải tọa độ vật lý đã xác minh;
- không suy ra điện áp, dòng, công suất hay trạng thái phần cứng thật.

Tất cả API v1.5 của mountScene() vẫn được giữ nguyên. v1.6 chỉ bổ sung hai API đọc/focus không xâm lấn:

~~~js
scene.focusLabComponent(componentId);
scene.getLabViewState();
~~~

## 1. Focus API cho inspector/minimap

focusLabComponent(componentId) nhận exact component ID của layout hiện tại.

Ví dụ:

~~~js
scene.focusLabComponent("LED");
scene.focusLabComponent("arduino");
scene.focusLabComponent(null);
~~~

Đặc tính:

- không gọi moveLabComponent() hoặc rotateLabComponent();
- không sửa layout object;
- không sửa circuit/netlist;
- không phát onSelectComponent, onMoveComponent hoặc onTerminalSelect;
- không đổi selectedComponentId;
- chỉ đổi camera target/zoom và data-lab-focused-component;
- component fixed như arduino vẫn có thể focus để inspector quan sát;
- ID không tồn tại bị từ chối bằng RangeError;
- giá trị khác string/null bị từ chối bằng TypeError.

Focus được giữ khi caller cập nhật lại cùng lab layout và component ID vẫn còn tồn tại. Focus bị xóa khi:

- gọi focusLabComponent(null);
- Home / control("reset");
- setLabLayout(null);
- đổi lesson;
- dispose scene.

## 2. View-state API

getLabViewState() trả object frozen:

~~~js
{
  viewVersion: 1,
  qualityProfile: "v16",
  mode: "legacy" | "conceptual-layout",
  disposed: false,
  lessonId: 2,
  focusedComponentId: "LED" | null,
  selectedComponentId: "LED" | null,
  editEnabled: false,
  lod: "full" | "reduced",
  camera: {
    theta,
    phi,
    zoom,
    targetX,
    targetY,
    targetZ
  },
  worldScale: 0.72,
  worldBounds: { minX, maxX, minZ, maxZ } | null,
  renderer: {
    pixelRatio,
    shadows,
    fineDetailCount
  },
  claims: {
    physicalVerified: false,
    breadboardHoleMapping: false,
    electricalPower: false
  }
}
~~~

camera.targetX/Y/Z và worldBounds là Three.js display-space state, không phải millimetre hay physical pin coordinates.

## 3. Uno visual quality

Legacy Uno và lab-layout Uno được làm rõ hơn bằng:

- board silhouette/proportion gần với tỉ lệ công bố của Uno Rev3;
- header rows được chia thành nhóm dễ đọc;
- silk labels cho DIGITAL, ANALOG, POWER, PWM, RESET;
- ATmega328P, USB, barrel connector, reset button, crystal, LED L và header sockets được phân cấp rõ hơn;
- các detail phụ được đánh dấu sceneDetail: "fine" để mobile LOD có thể ẩn mà không ảnh hưởng interaction.

Thông số công bố như 68.6 mm × 53.4 mm, 14 digital I/O, 6 analog input và 6 PWM chỉ được dùng làm reference cho tỉ lệ/nhãn. Scene unit không phải millimetre và không claim pin/header coordinate là physical truth.

## 4. Breadboard visual quality

Breadboard legacy và lab visual có:

- body/channel rõ hơn;
- rail màu dễ nhận biết;
- visual hole pattern để người học nhận ra breadboard;
- labels VISUAL GRID, RAIL VISUAL, NO VERIFIED HOLE MAP.

Mỗi hole-like visual được đánh dấu:

~~~text
physicalVerified: false
breadboardHoleMapping: false
~~~

Không row/column nào được xuất ra như electrical coordinate. Không có logic suy ra continuity giữa các hole.

## 5. Component recognizability

v1.6 tăng visual cues cho các visualKind đã tồn tại:

- resistor: thân + color bands;
- LED/RGB LED: globe/base riêng;
- button: cap + PUSH mark;
- photoresistor: disk + track;
- force sensor: sensing disk;
- temperature sensor: body + conceptual legs;
- soil sensor: body + dual probe visual;
- ultrasonic sensor: dual transducer;
- buzzer: body + center opening;
- driver: board + dual power-stage blocks;
- servo: body + horn;
- power source: red/black terminal visual.

Các chi tiết này chỉ giúp nhận dạng component; không đại diện package pin order hoặc physical wiring.

## 6. Camera/readability

Mặc định camera vẫn giữ:

- ArrowLeft/Right/Up/Down;
- + / -;
- Home;
- touch camera drag khi edit tắt;
- toàn bộ gesture edit v1.5.

Khi focus một component:

- target chuyển tới component visual;
- zoom được chọn trong khoảng bounded 0.42–0.58 dựa trên footprint logical, ưu tiên khả năng đọc nhãn khi inspector focus;
- selection vẫn độc lập;
- wire/terminal position vẫn lấy từ canonical lab layout.

Home và control("reset") trả camera về full-layout view và xóa focus.

## 7. Mobile LOD/resource allocation

LOD được quyết định trong resize().

Các geometry lặp dày như header sockets, pin collars, trace accents và breadboard visual holes dùng shared materials theo từng scene mount. Các material này được giữ qua việc thay lab layer và chỉ dispose một lần ở lifecycle cuối, thay vì tạo một material mới cho mỗi hole/socket.

### Full

Khi viewport đủ lớn:

- lod = "full";
- DPR tối đa 1.7;
- shadow map bật;
- fine visual details hiển thị.

### Reduced

Khi width < 560 CSS px hoặc height < 340 CSS px:

- lod = "reduced";
- DPR tối đa 1.25;
- shadow map tắt;
- chỉ sceneDetail: "fine" bị ẩn.

Core geometry, component selection proxy, terminal marker/hit target, conceptual wire và accessibility labels/semantics không bị đổi.

Dataset hỗ trợ inspection:

~~~text
data-scene-quality="v16"
data-scene-lod="full|reduced"
data-scene-pixel-ratio
data-scene-fine-detail-count
data-scene-physical-map="none"
data-lab-focused-component
~~~

LOD được áp lại sau resize và WebGL context restoration.

## 8. WebGL lifecycle

v1.6 không thay đổi lifecycle v1.5:

- webglcontextlost vẫn preventDefault();
- pending RAF bị hủy;
- pointer gesture đang chạy bị kết thúc;
- webglcontextrestored gọi resize() và invalidate;
- focus/LOD logical state được giữ qua context restore;
- dispose vẫn dọn lab layer, wiring layer, board/breadboard, materials, geometry, texture, listeners và canvas.

## 9. Public compatibility

Phải tiếp tục pass:

- 25 scene3d-contracts;
- 41 scene3d-lab-contracts.

v1.6 không đổi:

- mountScene(host, onSelect);
- setLesson;
- setWiring;
- setLabLayout;
- setLabEdit;
- update;
- control;
- resize;
- dispose.

## 10. v1.6 browser contracts

tests/scene3d-v16-contracts.js kiểm tra:

- hai public API mới;
- frozen view-state và nonphysical claims;
- focus không thay selection/callback/layout;
- invalid/no-layout/unknown component guards;
- fixed Arduino focus;
- Home/control reset focus;
- desktop full LOD và mobile reduced LOD;
- DPR/shadow resource caps;
- fine-detail population;
- WebGL context loss/restore giữ focus + LOD;
- layout refresh giữ valid focus;
- layout clear/lesson change xóa focus;
- dispose cleanup.

Không contract nào được phép suy ra physical pin position, breadboard continuity hoặc electrical output từ visual state.
