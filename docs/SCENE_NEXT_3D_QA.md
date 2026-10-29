# Scene 3D next QA

Phạm vi này nâng chất lượng hiển thị và tương tác của `src/scene3d.js` sau v1.6, nhưng vẫn giữ ranh giới sản phẩm hiện có: scene chỉ minh họa bố trí và terminal theo mô hình khái niệm. Tọa độ không phải CAD, terminal không phải vị trí header/lỗ breadboard đã đo, và lớp 3D không tự suy diễn điện áp, dòng điện hay tính đúng của mạch. `circuit-router` và `lab-layout` tiếp tục là nguồn dữ liệu canonical.

## Hợp đồng tích hợp giữ nguyên

`mountScene(host, onSelect)` vẫn là export công khai duy nhất của module. Object trả về giữ các API hiện có và thêm đúng một API read-only cho đồng bộ Explorer → 3D: `setInspectedTerminal(id|null, layout?)`. Danh sách đầy đủ là `setLesson`, `setWiring`, `setLabLayout`, `setLabEdit`, `focusLabComponent`, `setInspectedTerminal`, `getLabViewState`, `update`, `control`, `resize`, `dispose`.

Các ID component/terminal tiếp tục đi thẳng từ `lab-layout`/`circuit-router`; scene không đổi tên hoặc tạo pin/hole ID mới. Các callback `onSelectComponent`, `onMoveComponent`, `onTerminalSelect` giữ payload và `physicalVerified:false` như trước.

`setInspectedTerminal(id|null, layout?)` nhận exact canonical terminal ID. `null` luôn xóa inspection. Khi conceptual lab scene đang mount, scene dùng terminal map đã được `setLabLayout()` validate; terminal hợp lệ nhận halo và hàm trả `mode:"lab-halo"`. Khi lab scene **không** mount (trạng thái read-only bình thường của Explorer), caller phải truyền `labEditorUI.snapshot().layout` làm tham số thứ hai. Scene gọi `validateLabLayout(layout, layout.terminals)`, kiểm tra `layout.lessonId` khớp lesson hiện tại và kiểm tra ID có thật trong `layout.terminals`; hợp lệ trả `mode:"read-only-label"`.

Trong `read-only-label`, scene tuyệt đối không mount layout, không gọi `labTerminalAnchor()` và không suy diễn tọa độ terminal. Thay vào đó scene hiện một badge chữ `Đang xem terminal: <ID> · nhãn read-only` trên viewport và bổ sung mô tả tương đương vào `aria-label` của canvas. Đây là cross-view feedback, không phải bằng chứng vị trí vật lý. Nếu không có active lab scene **và** không có layout canonical truyền vào thì API fail-closed bằng `RangeError` thay vì tự dựng layout. ID không thuộc list, layout sai lesson/invalid hoặc ID dài hơn giới hạn canonical 80 ký tự cũng bị reject trước khi cập nhật state.

API này không gọi callback edit, không thay selected component/first terminal, không tạo dây, không đổi netlist, không đổi camera/focus và không thêm claim điện hay vật lý. Prime nên gọi `scene.setInspectedTerminal(id, labEditorUI.snapshot().layout)` từ `explorerSelectTerminal`; khi deselect/stage/lesson đổi có thể gọi `setInspectedTerminal(null)` trước hoặc sau cập nhật Explorer. Scene cũng tự clear inspection trong lifecycle lesson/layout hiện có.

## Nâng chất lượng hình ảnh và affordance

- Arduino Uno R3 có nhãn bo rõ hơn, nhãn nhóm DIGITAL/ANALOG/POWER và chú thích PWM; USB-B/DC IN chỉ là nhãn hình ảnh. Cảnh báo `KHÔNG PHẢI PIN MAP` vẫn hiện trên mô hình.
- Breadboard được vẽ thành hai bank 5 hàng, có rãnh giữa và rail minh họa. `breadboardHoleMapping:false` vẫn là bắt buộc; các lỗ chỉ tạo cảm giác hình học chứ không mang ID điện.
- Terminal lab có marker lớn hơn một chút, vùng hit khái niệm rộng hơn và halo màu teal khi component đang được chọn trong Edit mode. Halo không thay đổi anchor hoặc netlist.
- Terminal đang được Inspector chọn có vòng halo xanh tím lớn hơn **chỉ khi** conceptual lab scene thực sự đang mount. Khi lab scene chưa mount, không có terminal 3D nào được giả lập; badge chữ read-only thay thế halo. Hai feedback halo Inspector/Edit có thể cùng tồn tại nếu Inspector chọn một terminal trong lúc Edit mode đang bật, nhưng không dùng chung state.
- Selection dùng outline amber; focus camera dùng outline teal riêng. Vì vậy `focusLabComponent()` không còn chỉ thay camera mà còn có tín hiệu thị giác, trong khi vẫn không phát callback chọn component.
- Text texture tắt mipmap và dùng linear filtering để nhãn nhỏ ổn định hơn và giảm tài nguyên GPU không cần thiết.

## Touch, picking và trạng thái chỉnh sửa

Touch tap cho phép jitter tối đa 12 CSS px trước khi chuyển thành drag; mouse và pen vẫn dùng ngưỡng nhỏ hơn. Pointer cancel/lost capture tiếp tục khôi phục selection trước đó và không phát thao tác học viên giả.

Danh sách đối tượng raycast được cache cho vòng đời của lab layout thay vì dựng lại mỗi lần pointer hit-test. `setLabEdit()` kiểm tra `selectedComponentId` trước khi thay trạng thái, nên input component không tồn tại bị reject theo kiểu transactional: edit mode/selection hiện tại không bị thay nửa chừng.

Các dataset chẩn đoán bổ sung trên canvas chỉ phản ánh UI, không phải state điện:

- `data-lab-selection-feedback`: `outline` hoặc `none`.
- `data-lab-focus-feedback`: `outline` hoặc `none`.
- `data-lab-terminal-feedback`: `selected-component` hoặc `base`.
- `data-lab-terminal-highlight-count`: số terminal đang có halo.
- `data-lab-inspected-terminal`: exact canonical terminal ID đang được Inspector chọn, hoặc chuỗi rỗng. Giá trị chỉ đến từ terminal map đã validate nên bị chặn ở giới hạn 80 ký tự.
- `data-lab-inspection-feedback`: `highlight` khi có lab halo, `label` khi chỉ có read-only badge, hoặc `none`.
- `data-scene-context`: `ready` hoặc `lost`.

Inspection được xóa khi đổi lesson, thay/clear lab layout, hoặc khi `setLabEdit()` thực sự chuyển giữa enabled/disabled. Việc gọi `setLabEdit()` mà không đổi trạng thái enabled không tự xóa inspection. WebGL context loss/restore giữ cả `lab-halo` lẫn `read-only-label`; ở read-only mode, DOM badge vẫn là feedback không phụ thuộc WebGL. `dispose()` xóa inspection metadata và badge trước khi bỏ canvas.

Không có keyboard binding mới trong canvas cho inspection. Explorer HTML tiếp tục là bề mặt keyboard-accessible sở hữu thao tác chọn terminal; scene chỉ phản chiếu read-only selection bằng hình ảnh.

## Resize, LOD và WebGL recovery

Scene vẫn render theo nhu cầu. Resize chỉ gọi `renderer.setSize()` khi kích thước CSS thực sự đổi; thay đổi DPR vẫn được kiểm tra ở mỗi lần resize. Việc traverse toàn scene để bật/tắt fine detail chỉ chạy khi LOD đổi hoặc khi scene graph thay đổi có chủ đích (`setLesson`, `setLabLayout`, clear layout, context restore).

Khi `webglcontextlost`, canvas đặt `data-scene-context="lost"` và `aria-busy="true"`, dừng RAF/drag như trước. Sau `webglcontextrestored`, scene đặt lại `ready`, gỡ `aria-busy` và force resize/LOD để CPU-side geometry/material hiện có được upload lại nhất quán. `dispose()` vẫn gỡ listener, hủy RAF, giải phóng geometry/material/texture và xóa canvas.

## Regression coverage

`tests/scene3d-contracts.js` bổ sung kiểm tra cho:

- metadata context `ready/lost/ready` và `aria-busy`;
- jitter touch 11 px vẫn là tap, 14 px là drag;
- selection/focus/terminal feedback dataset trong conceptual lab;
- invalid `selectedComponentId` không làm đổi edit state đang hoạt động;
- source contract xác nhận read-only path gọi `validateLabLayout`, kiểm tra `layout.terminals`, nhưng không gọi `setLabLayout()` hay `labTerminalAnchor()`;
- DOM contract xác nhận Explorer-style `setInspectedTerminal("D13", layout)` hoạt động khi lab scene chưa mount, giữ scene ở mode legacy, không đổi camera/selection và hiện badge + ARIA state;
- no-layout/no-proof, unknown/oversized/stale inspected terminal bị reject mà không làm mất inspection hợp lệ trước đó;
- edit transition và lesson/layout change xóa inspection;
- WebGL lost/restored giữ inspection, còn `dispose()` dọn metadata.

Các contract lịch sử trong `scene3d-lab-contracts.js`, `scene3d-v16-contracts.js` và `scene-wiring-contracts.js` vẫn là acceptance gate cho mapping, fail-closed claims, move/rotate, focus, LOD, wiring và context recovery. Worker này không chạy Chromium vì prime giữ quyền độc quyền browser; kiểm tra browser cần được prime/CI chạy cùng bộ contract hiện có sau tích hợp.
