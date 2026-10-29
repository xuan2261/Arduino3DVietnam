# Breadboard physical mapping — authored placement có provenance

Tài liệu này mô tả ranh giới mới giữa ba lớp dữ liệu:

1. **Topology nội bộ của breadboard** — nhóm tiếp điểm mà profile đã có bằng chứng.
2. **Authored placement** — tác giả chủ động gán một terminal của bài học vào một hole ID.
3. **Netlist bài học** — vẫn do <code>circuit-router</code> làm nguồn sự thật về dây nối của bài học.

Không lớp nào trong thay đổi này suy hole từ khoảng cách/tọa độ 3D, tự tạo dây, đo continuity thật, cấp nguồn, hoặc xác nhận an toàn phần cứng.

## Bằng chứng và phạm vi claim

| Nguồn | Dữ kiện dùng trong code | Độ tin cậy / giới hạn |
| --- | --- | --- |
| BusBoard Prototype Systems, BB830 — https://www.busboard.com/BB830 | BB830 có 830 tie points; vùng IC 630 tie points; bốn power rails 50 tie points; kích thước tổng thể 165.1 × 54.6 × 8.5 mm | **Manufacturer product page.** Chỉ dùng cho profile BB830 và kích thước tổng thể. Không dùng để suy vị trí hole trong scene. |
| BusBoard Prototype Systems, BB830 Rev 7 datasheet — https://www.busboard.com/documents/datasheets/BPS-DAT-%28BB830%29-Datasheet.pdf | Nhận dạng Rev 7; vùng IC 630 tie points; hai distribution strips 100 tie points tạo bốn rail; kích thước tổng thể | **Manufacturer datasheet.** Hỗ trợ profile riêng. Dấu +/− là legend; model không gán điện áp/polarity thật cho rail. |
| BusBoard Prototype Systems, FAQ “Why aren’t the power rails split…” — https://www.busboard.com/faq/power-rail-split | Breadboard BusBoard dùng power strip liên tục thay vì chia đôi ở giữa | **Manufacturer FAQ.** Kết hợp với product page/datasheet để mô hình hóa mỗi rail 50 lỗ của BB830 như một node liên tục. Không suy rằng các rail khác nhau nối với nhau, và không áp dụng claim này cho profile generic. |
| BusBoard Prototype Systems, SB830 — https://www.busboard.com/SB830 | Nhà sản xuất nói SB830 có cùng pattern và spacing với BB830; standard 5-hole strip; hole centers 0.1" (2.54 mm) | **Manufacturer matching-pattern documentation.** Dùng để củng cố 5-hole strip và pitch 2.54 mm của BB830. Không đủ để suy origin, offset từng vùng hoặc transform scene 3D. |
| Digilent, Solderless Breadboard Kit — https://digilent.com/shop/solderless-breadboard-kit-small-solderless-breadboard-with-two-power-rails/ | Vùng prototyping 630 tie points được cấu hình thành các node 5 điểm | **Manufacturer product documentation.** Dùng làm bằng chứng cho cấu trúc terminal field phổ biến, không dùng để khẳng định power-rail topology của một breadboard generic không rõ model. |
| SparkFun Learn, How to Use a Breadboard — https://learn.sparkfun.com/tutorials/how-to-use-a-breadboard/anatomy-of-a-breadboard | Mô tả 5 clips trên mỗi strip và center ravine cách ly hai nhóm 5 lỗ | **Technical education reference.** Chỉ bổ trợ cho topology terminal strip; không thay thế datasheet của model cụ thể. |
| Arduino Uno R3 A000066 full pinout — https://content.arduino.cc/assets/A000066-full-pinout.pdf | Từ vựng pin logic/header như D0–D13, A0–A5, 5V, 3V3, GND, VIN, AREF, IOREF, RESET, SDA, SCL | **Official manufacturer pinout.** Chỉ xác nhận tên/role logic. Không cung cấp transform từ Arduino header sang breadboard hole. |

### Điều cố ý không claim

- Profile generic giữ <code>geometry.holePitchMm = null</code>. Profile BB830 ghi <code>2.54</code> mm vì tài liệu SB830 của cùng nhà sản xuất xác nhận same pattern/spacing với BB830 và 0.1" hole centers. Dữ kiện pitch này vẫn không đủ để suy origin, offset rail/center-gap hoặc alignment với scene 3D.
- Profile generic giữ <code>powerRails: "unknown-unmodeled"</code>. Hai hole rail generic trả về chẩn đoán **unknown**, không bị biến thành “đã chứng minh disconnected”.
- Profile <code>busboard-bb830-rev7</code> mô hình hóa bốn rail 50 tie-point như bốn node nội bộ riêng. Product page/datasheet xác nhận bốn rail 50 tie-point; FAQ của BusBoard xác nhận power strip của breadboard BusBoard không split ở giữa. Vì vậy mỗi rail của profile này được xem là liên tục từ lỗ 1 đến lỗ 50. Điều đó không chứng minh rail đang mang điện, dấu +/− đúng với nguồn đang cắm, hay có jumper ngoài nối các rail với nhau.
- <code>P1+</code>, <code>P1-</code>, <code>P2+</code>, <code>P2-</code> là ID schema nội bộ để phân biệt bốn rail; chúng không được trình bày như tên in chính thức của nhà sản xuất.
- Một authored placement không xác nhận chân linh kiện vừa cơ khí với hole, không xác nhận dây jumper từ Arduino header tới breadboard, và không thay đổi circuit state.

## API topology

<code>src/breadboard-topology.js</code> giữ nguyên API cũ:

- <code>createBreadboardTopology(profile?)</code>
- <code>breadboardNode(holeId, profile?)</code>
- <code>areBreadboardHolesConnected(a, b, profile?)</code>
- <code>mapCircuitTerminalToHole(layout, terminalId)</code> cho schema legacy v1

Hai API mới trả trạng thái có ý nghĩa rõ hơn:

~~~js
diagnoseBreadboardHole("P1+1");
// { status: "unknown", ... } với generic profile

diagnoseBreadboardHolePair("A12", "E12");
// { status: "connected", connected: true, ... }

diagnoseBreadboardHolePair("E12", "F12");
// { status: "separate", connected: false, ... }
~~~

<code>connected</code> / <code>separate</code> chỉ nói về **internal contact node của selected profile**. Kết quả luôn công bố <code>externalConnectionInspected: false</code> và <code>circuitRouterInspected: false</code>.

## Authored placement v2

<code>src/breadboard-placement.js</code> tách placement khỏi topology:

~~~js
const placement = createBreadboardPlacement({
  profileId: "generic-63x10-terminal-strips",
  terminals,
  terminalToHole: {
    D13: "A12",
    "R1:A": "B12",
    "R1:B": "F12",
  },
});
~~~

Mapping <code>D13 -&gt; A12</code> có nghĩa: **đầu jumper được tác giả khai báo tại A12 có nguồn logic là pin D13 của Arduino Uno R3**. Nó không có nghĩa chân header D13 của board được cắm trực tiếp vào A12.

Schema v2 mang các claim fail-closed:

~~~text
explicitAuthoredHoleAssociation = true
breadboardInternalNodeFromProfile = true
mechanicalFitVerified = false
sceneCoordinateMapped = false
circuitRouterMutated = false
externalJumperContinuityVerified = false
physicalCircuitSafetyVerified = false
electricalPowerInferred = false
~~~

Validator:

- từ chối terminal không thuộc tập terminal được cấp;
- từ chối Arduino pin ngoài allowlist của official Uno R3 pinout;
- từ chối <code>NC</code> như một endpoint;
- từ chối hai terminal chiếm cùng một hole;
- từ chối hole rail generic chưa có topology được chứng minh;
- dựng lại node từ profile thay vì tin <code>nodeId</code> do caller tự khai;
- không đọc <code>x/z</code>, anchor của scene, khoảng cách hình học hoặc wire state từ circuit-router.

<code>diagnosePlacedTerminalPair()</code> có thể cho biết hai authored hole nằm cùng hay khác internal node của breadboard. API này luôn trả <code>circuitRouterConnectionInferred: false</code>.

## UI và khả năng truy cập

<code>breadboard-topology-ui.js</code> tiếp tục là explorer độc lập và nay có thêm bản nháp authored placement trong phiên. Caller có thể truyền:

~~~js
mountBreadboardStudy({
  getLayout,
  getLessonTerminals: () => ({ lessonId, terminals }),
});
~~~

<code>terminals</code> phải là tập terminal canonical của bài hiện tại. UI không tự đọc scene, không suy terminal từ text lesson và không gọi API mutation của <code>circuit-router</code>. <code>src/breadboard-placement-session.js</code> giữ state riêng trong bộ nhớ, chỉ commit một thay đổi sau khi <code>createBreadboardPlacement()</code> và <code>validateBreadboardPlacement()</code> chấp nhận toàn bộ candidate mapping.

Hành vi authored placement:

- bài 01 bị vô hiệu vì dùng LED L tích hợp và không có external breadboard wiring cần khai báo;
- bài 02..16 lấy danh sách terminal từ callback canonical của app;
- đổi bài, đổi profile hoặc thay đổi terminal set sẽ xóa bản nháp placement cũ để không mang mapping sang ngữ cảnh khác;
- một hole không thể bị hai terminal chiếm cùng lúc; lỗi collision không làm mất mapping hợp lệ trước đó;
- rail của profile generic bị từ chối vì topology chưa được chứng minh; BB830 chỉ nhận <code>P1+/P1-/P2+/P2-</code> khi profile BB830 đang được chọn;
- danh sách placement và status được dựng bằng <code>textContent</code>; input hole lỗi đặt <code>aria-invalid="true"</code>, thành công trả về <code>false</code>;
- <code>getAuthoredPlacement()</code> trả placement immutable đã validate hoặc <code>null</code>; object này vẫn có <code>circuitRouterMutated:false</code>, <code>sceneCoordinateMapped:false</code> và các physical/electrical claims fail-closed;
- bản nháp chỉ tồn tại trong phiên của UI; không ghi progress, local storage, netlist hay scene.

### Hole picker tương tác

Phase kế tiếp bổ sung `src/breadboard-hole-grid.js` và UI picker nhưng **không thay đổi commit boundary** của authored placement. Grid A–J được phân trang 8 cột số trên 1..63; click một native hole button chỉ điền hole ID canonical vào `#bbPlaceHole`. Placement chỉ được tạo khi người dùng tiếp tục bấm `#bbAssignHole`.

BB830 có rail picker riêng cho đúng bốn rail `P1+`, `P1-`, `P2+`, `P2-`, index 1..50. Generic profile khóa rail controls vì topology rail chưa được chứng minh. Picker không chứa CAD/scene coordinates và không dùng proximity để suy hole.

Chi tiết contract, pagination, accessibility và fail-closed behavior nằm ở `docs/BREADBOARD_HOLE_PICKER_NEXT.md`.

Phần explorer so sánh hole giữ nguyên các contract trước:

- dùng tri-state diagnostic để phân biệt **unknown** với **known separate**;
- câu trả lời “separate” nói rõ jumper/netlist ngoài breadboard chưa được kiểm tra;
- Enter trên hai input hole thực hiện so sánh như nút;
- input lỗi nhận <code>aria-invalid="true"</code>, input hợp lệ trả về <code>false</code>;
- SVG minh họa dùng <code>width="100%"</code>, <code>max-width: 640px</code> và <code>preserveAspectRatio</code> để không ép chiều ngang trên viewport hẹp;
- BB830 hiển thị rõ bốn rail riêng, mỗi rail liên tục 50 lỗ theo profile; generic vẫn không suy split/continuous rail.

## Regression/acceptance contracts

<code>tests/breadboard-topology-contracts.js</code> giữ toàn bộ contract cũ và thêm provenance, kích thước tổng thể BB830, hole-pitch-unverified và tri-state diagnostics.

<code>tests/breadboard-placement-contracts.js</code> kiểm:

- official Uno R3 pin provenance và ambiguity của logical GND;
- authored placement v2 + deep freeze;
- generic rail fail-closed, BB830 rail profile-gated;
- collision/forgery/overclaim rejection;
- same-node/different-node/unmapped diagnostics không suy circuit-router;
- terminal vocabulary của toàn bộ bài có wiring **02..16** tương thích với validator mới. Bài 01 không có netlist vật lý nên không tạo placement giả.

<code>tests/breadboard-placement-session-contracts.js</code> bổ sung contract cho state và DOM:

- lesson/profile/terminal-set reset, lesson01 disable và callback lỗi fail-closed;
- atomic assign/remove, duplicate occupancy và generic-rail rejection không làm hỏng state cũ;
- BB830 chấp nhận đầu/cuối cùng một rail 50 lỗ chỉ khi profile riêng được chọn;
- terminal options lấy đúng canonical terminal set của bài hiện tại;
- payload hole không hợp lệ không tạo placement, status/ARIA báo lỗi và renderer không dùng <code>innerHTML</code>;
- existing compare A1/E1, A1/F1 và generic rail unknown vẫn giữ semantics cũ;
- dispose tháo listener authored controls.

<code>tests/breadboard-hole-grid-contracts.js</code> kiểm riêng picker model/DOM: bounded 8-column pagination, 44px native buttons, input-only selection, exact BB830 rail allowlist, generic rail disable, invalid page/profile/hole/rail/index fail-closed, lesson/profile reset và cleanup. Các check này không thay thế authored placement validator hoặc circuit-router tests.

Những contract này không thay thế hardware continuity measurement hoặc kiểm chứng kích thước/CAD. Muốn tiến tới physical 3D snapping, bước tiếp theo cần một nguồn cơ khí/CAD có tọa độ hole/header đủ rõ và một transform được kiểm thử độc lập; không được suy transform từ kích thước tổng thể.
