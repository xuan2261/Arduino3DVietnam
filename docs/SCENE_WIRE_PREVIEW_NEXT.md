# Scene 3D pending-wire preview QA

## Mục tiêu và ranh giới

Phase này chỉ thêm affordance thị giác cho trạng thái **đã chọn terminal đầu, đang chờ terminal thứ hai** trong Lab Editor 3D. Scene không tạo wire, không sửa netlist, không xác nhận tính đúng điện, không suy diễn dòng/áp và không nâng cấp tọa độ khái niệm thành CAD hay vị trí vật lý đã đo. `circuit-router`/Lab Editor tiếp tục sở hữu graph và quyết định kết nối; scene chỉ phản chiếu `firstTerminal` mà caller đã quản lý.

Các API drag/place/rotate, `setInspectedTerminal()` read-only và các fail-closed physical claims hiện có được giữ nguyên.

## API tích hợp

Object trả về từ `mountScene()` có thêm API additive:

`setPendingWireTerminal(id|null)`

- `null` xóa pending preview và trả `{ terminalId:null, active:false, mode:"none", physicalVerified:false }`.
- ID khác `null` phải là chuỗi canonical không rỗng, không có whitespace thừa, dài tối đa 80 ký tự.
- Pending preview **chỉ** hợp lệ khi `labEdit.enabled === true`, conceptual lab layout đang mount và ID có trong `labTerminals` của layout đó.
- Nếu edit chưa bật, lab layout chưa mount, hoặc ID không thuộc terminal list hiện tại, API fail-closed bằng `RangeError` trước khi đổi state.
- Thành công trả `{ terminalId:id, active:true, mode:"first-terminal-preview", physicalVerified:false }`.

Prime/Lab Editor có thể mirror controller state bằng:

`scene?.setPendingWireTerminal?.(editing && stage === "3d" ? firstTerminal : null)`

Call nên thực hiện sau `setLabLayout()`/`setLabEdit()` của render hiện tại. Khi stage rời 3D, `setLabLayout(null)` cũng tự xóa preview; explicit `null` vẫn là cleanup an toàn và idempotent.

## Affordance 3D

Terminal đầu dùng halo coral riêng (`lab-terminal-pending-wire-affordance`) và marker được nhấn mạnh hơn. Nó khác với halo teal của edit-selection và halo xanh tím của read-only Inspector. Tất cả affordance đều mang `physicalVerified:false`; pending halo còn có `committed:false` và `electricalState:false`.

Khi pointer không kéo component/camera và đang hover một **terminal canonical khác** với terminal đầu, scene có thể hiện một ghost line cong nhẹ giữa hai marker. Ghost line:

- có `kind:"lab-pending-wire-preview"`, `committed:false`, `physicalLocation:false`, `physicalVerified:false`, `electricalState:false`;
- không được thêm vào `labWireObjects`, không tăng `data-lab-wire-count`, không gọi callback kết nối và không đi qua `setWiring()`;
- biến mất ngay khi pointer rời terminal thứ hai, hover lại terminal đầu, rời canvas, bắt đầu pointer drag, pointer cancel hoặc lost capture.

Vì ghost line chỉ nối hai terminal marker của conceptual layout đang mount, nó không phải route dây thực, không phải đường đi trên breadboard và không phải bằng chứng vật lý.

## Canvas DOM/ARIA contract

Canvas phản ánh preview bằng metadata UI-only:

- `data-lab-pending-wire-terminal`: canonical ID terminal đầu hoặc chuỗi rỗng.
- `data-lab-pending-wire-hover-terminal`: canonical ID terminal thứ hai đang hover hoặc chuỗi rỗng.
- `data-lab-pending-wire-preview`: `ghost` khi ghost line đang hiện, ngược lại `none`.

Khi có terminal đầu, `aria-label` của canvas bổ sung thông báo: terminal đang chờ nối **chỉ là xem trước trực quan, chưa tạo dây hoặc kết nối điện**. Không có keyboard binding mới; Lab Editor HTML vẫn sở hữu thao tác chọn/cancel/connect có thể truy cập bằng bàn phím.

## Lifecycle fail-closed

Pending preview tự xóa khi:

- lesson đổi;
- lab layout đổi/clear, bao gồm stage rời 3D thông qua `setLabLayout(null)`;
- edit mode chuyển enabled/disabled;
- WebGL context bị mất/reset;
- scene `dispose()`.

WebGL restore không tự dựng lại pending preview. Nếu controller bên ngoài vẫn giữ `firstTerminal`, caller phải chủ động sync lại sau khi scene/lab render đã hợp lệ; scene không tự hồi sinh state qua context reset.

Pointer cancel/lost capture chỉ dọn hover/ghost transient và khôi phục pointer selection theo contract cũ; nó không tự phát callback kết nối. First-terminal state vẫn do Lab Editor controller quyết định và được mirror lại qua `setPendingWireTerminal()`.

## Regression coverage

`tests/scene3d-contracts.js` kiểm tra tập trung rằng:

- API chỉ nhận canonical ID của mounted edit lab và reject no-edit/unknown ID transactionally;
- first-terminal prompt chỉ đổi visual metadata/ARIA, không đổi camera/focus/selection, không tăng wire count và không thay physical/electrical claims;
- gọi lại `setLabEdit({enabled:true})` khi edit state không đổi không làm mất pending mirror;
- pending halo và Inspector feedback có thể cùng tồn tại mà không trộn state;
- edit exit và layout/stage clear dọn pending datasets;
- source contract của ghost preview chỉ dùng target terminal canonical khác, ghi `committed:false`, không chạm `labWireObjects`/wire callbacks;
- context loss xóa pending preview và ARIA prompt; dispose dọn metadata/listener.

Worker-14 không chạy Chromium trong phase này theo ownership của prime. Browser contract mới cần được prime/CI chạy cùng các scene contracts hiện có sau khi `src/lab-editor-ui.js` mirror `firstTerminal` vào API trên.
