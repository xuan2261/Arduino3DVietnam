# Scene 3D visual fidelity next

## Mục tiêu

Phase này tăng độ nhận diện thị giác và phản hồi tương tác của Three.js scene mà không thay authority của sản phẩm. `circuit-router` vẫn là nguồn graph/topology; `lab-layout` vẫn chỉ cung cấp logical display geometry. Scene không suy điện, không tạo CAD mapping và không biến khoảng cách hình học thành kết nối.

Public API của `mountScene()` **không đổi** so với phase pending-wire trước. Các method `setInspectedTerminal()` và `setPendingWireTerminal()` giữ nguyên contract/lifecycle; prime không cần thêm integration mới cho visual fidelity.

## Provenance dùng cho nhãn Uno

Repo đã có nguồn chính thức tại `docs/UNO_REFERENCE_NEXT.md`:

- Arduino *UNO R3 Full Pinout (Top View)* A000066;
- trang phần cứng Arduino UNO R3;
- schematic A000066.

Các nguồn đó hỗ trợ tên logic D0..D13, A0..A5, nhóm nguồn/GND, PWM D3/D5/D6/D9/D10/D11, RESET, LED L, USB và các nhãn chức năng đã có. `docs/SCENE3D_V16.md` cũng ghi rõ kích thước công bố chỉ được dùng làm reference cho tỉ lệ/nhãn. Phase này **không thêm millimetre, không thêm thứ tự socket vật lý mới và không claim 1:1 footprint**.

`docs/LAB_LAYOUT.md` tiếp tục là ranh giới bắt buộc: width/depth, X/Z và terminal perimeter slot là logical display geometry, không phải tọa độ header/hole package.

## Arduino Uno R3 visual

Legacy Uno và Uno trong conceptual lab giữ board/connector/silk hiện có nhưng header được làm dễ đọc hơn:

- header rail có phần thân và rãnh tối riêng để nhìn giống socket rail thay vì một khối nhựa đặc;
- socket/collar lặp lại dùng `THREE.InstancedMesh`, giảm nhiều mesh nhỏ thành một số instanced drawables;
- userData của rail/socket luôn giữ `physicalLocation:false`/`physicalVerified:false`;
- label DIGITAL/ANALOG/POWER/PWM/RESET/USB-B/DC IN vẫn là label chức năng/visual, không phải pin-position map.

Canvas diagnostic `data-scene-uno-header-socket-visual-count` đếm số socket visual instance đang có trong scene. Đây là QA inventory, không phải số chân vật lý được scene chứng nhận.

## Breadboard visual

Breadboard legacy và lab visual được tách rõ thành:

- body;
- hai contact-bank surface;
- central trench với hai mép rãnh;
- rail line minh họa;
- hole pattern dạng visual inventory;
- các strip kim loại mờ dưới từng hàng chỉ để tạo cảm giác contact strip.

Các contact strip mang:

- `kind:"breadboard-contact-strip-visual"`;
- `breadboardConnectivity:false`;
- `electricalAuthority:false`;
- `physicalVerified:false`.

Vì vậy strip/hole **không** tạo net, không map A-J/rail ID, không chứng minh 5-hole grouping thực, không thay `breadboard-topology`/placement profile và không được circuit analyzer đọc.

Hole arrays dùng `THREE.InstancedMesh` ở full LOD. Canvas QA datasets:

- `data-scene-breadboard-hole-visual-count`;
- `data-scene-breadboard-contact-strip-visual-count`;
- `data-scene-instanced-visual-count`.

Tất cả chỉ là render inventory.

## Component geometry

Một số component nhỏ được bổ sung detail để dễ nhận ra ở góc camera hiện tại:

- resistor giữ body/band/leads;
- LED/RGB LED có translucent-looking body/base và hai lead visual khác chiều dài;
- push button có body/cap và bốn lead visual;
- potentiometer có knob và ba lead visual;
- các module/sensor hiện có giữ geometry bounded cũ.

Không lead nào được dùng để xác định terminal anchor hoặc wire routing. Terminal canonical vẫn đến từ `labTerminalAnchor()` trên logical layout.

## Terminal interaction feedback

Terminal canonical trong mounted edit lab có bốn lớp feedback tách nhau:

1. **component selected**: teal component-terminal halo cũ;
2. **Explorer inspection**: blue-violet inspection halo;
3. **pointer hover**: yellow hover halo;
4. **pending first terminal**: coral pending-wire halo.

Mỗi terminal có collar visual và một high-contrast `canvasTag` text plane. Tag mặc định hidden, chỉ hiện khi terminal đang hover, inspection hoặc pending. Priority của feedback text là `pending > inspection > hover`.

Canvas datasets:

- `data-lab-hovered-terminal` — canonical ID đang hover hoặc rỗng;
- `data-lab-terminal-label-feedback` — `none|hover|inspection|pending`.

Hover không gọi `onTerminalSelect`, không đổi selected component, không focus camera và không tạo wire. Pointer down/cancel/leave/context loss dọn hover để không để tag/halo stale. Lab Editor HTML tiếp tục sở hữu keyboard action; scene không thêm wiring shortcut mới.

## LOD và performance

Repeated header socket và breadboard hole geometry được gom bằng `InstancedMesh`. `sceneDetail:"fine"` vẫn điều khiển LOD và **không đổi nghĩa contract cũ**: `data-scene-fine-detail-count`/`getLabViewState().renderer.fineDetailCount` tiếp tục là số Object3D detail. Metric mới `data-scene-fine-detail-instance-count` phản ánh số visual instances tương đương, còn `data-scene-fine-detail-object-count` là alias diagnostic của object count. QA có thể xác nhận instance inventory lớn hơn số Object3D thực tế mà không làm lệch API lịch sử.

Reduced LOD tiếp tục ẩn fine detail ở viewport nhỏ và giữ hit proxies/terminal interaction không phụ thuộc detail mesh. Camera math, world bounds, pointer tap threshold và terminal hit radius không đổi trong phase này để không làm lệch các regression drag/touch đã có.

## Explicit no-claim datasets

Canvas thêm:

- `data-scene-visual-profile="conceptual-r3-fidelity-v2"`;
- `data-scene-cad-mapping="none"`;
- `data-scene-electrical-authority="none"`.

Các dataset này là guard/diagnostic, không thay các claim hiện có như `scenePhysicalMap="none"`, `physicalVerified:false`, `breadboardHoleMapping:false`, `electricalPower:false`.

## Regression contracts

`tests/scene3d-contracts.js` giữ toàn bộ historical pending/inspection/context/touch checks và bổ sung additive checks cho:

- conceptual visual profile + no-CAD/no-electrical datasets;
- header/breadboard/contact-strip visual inventory;
- instanced detail inventory lớn hơn fine-detail Object3D count;
- conceptual lab làm tăng visual inventory nhưng không đổi authority;
- pending/inspection hiển thị high-contrast terminal-label feedback với priority ổn định.

`tests/scene3d-visual-fidelity-contracts.js` là focused suite mới, kiểm tra:

- source dùng `InstancedMesh` cho repeated socket/hole detail;
- contact strips luôn non-authoritative;
- source không chứa positive physical/electrical claims;
- DOM geometry diagnostics trên legacy + mounted lab;
- full/reduced/full LOD inventory không đổi;
- inspection/pending label feedback và negative whitespace terminal ID;
- clear lab quay lại legacy inventory;
- read-only inspection không dựng lại terminal 3D geometry.

Worker-14 không chạy Chromium theo ownership của prime. Suite mới cần được prime/CI chạy cùng historical scene contracts; không được dùng static PASS thay cho browser rendering evidence.

## Native skill note

Yêu cầu phase nêu `ak-cook` + `ak-threejs`. Trong worker runtime này, native skill resolver không expose hai skill đó qua installed `skills__list`, nên worker không tuyên bố đã kích hoạt native workflow. Implementation vẫn bám contract/handoff của Hub đã dùng ở các phase trước và Three.js r180 hiện có; không cài thêm tool/package.
