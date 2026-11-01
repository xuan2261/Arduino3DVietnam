# Bài 10 — Panel điều khiển động cơ DC khái niệm trong 3D

## Phạm vi

Bài 10 giữ nguyên curriculum đã biên soạn: người học điều chỉnh giá trị PWM mô phỏng **0..255** và chọn chiều **Thuận/Ngược** qua hai điều khiển native hiện có. Tương tác 3D mới chỉ thêm một panel đầu vào khái niệm cho đúng hai giá trị đó. Nó không thay đổi lesson data, Sketch tham khảo, simulator, graph mạch, checkpoint hay logic hoàn thành bài học.

Host vẫn sở hữu hai điều khiển chính thức:

| Điều khiển | Khóa | Miền / lựa chọn | Mặc định |
| --- | --- | --- | --- |
| Thanh trượt PWM | `motor` | số nguyên `0..255`, step `1` | `160` |
| Hộp chọn chiều | `direction` | `forward` / `reverse` | `forward` |

`#control-motor` là native `input[type=range]`; `#control-direction` là native `select`. Người học có thể dùng bàn phím trên hai control này mà không cần WebGL. Scene chỉ đề nghị thay đổi; host kiểm tra lại control hiện hành rồi đi qua đường `onControlsInput(...)` đã có.

## Ba semantic target first-party

Scene dựng đúng ba target input riêng khỏi thân, trục và rotor động cơ:

1. Một `motor-pwm-thumb` để điều chỉnh PWM.
2. Một `motor-direction-target` có `direction:"forward"`.
3. Một `motor-direction-target` có `direction:"reverse"`.

Tất cả dùng:

```text
lessonId: 10
sourceId: "lesson-10-motor-driver-panel"
physicalVerified: false
electricalAuthority: false
measuredSpeed: false
measuredDirection: false
driverPowerModeled: false
```

Geometry hiện tại là thiết kế hiển thị first-party của Arduino 3D Việt Nam:

```text
module world position: (5.15, 0.55, 0.10)
PWM rail local center: (-2.05, 0.54, 1.42)
PWM thumb size:        (0.78, 0.72, 0.70)
PWM thumb x:           -2.65 + (motor / 255) * 1.20
PWM thumb y/z:         0.89 / 1.42
forward target center: (-2.57, 1.64, 1.40)
reverse target center: (-1.41, 1.64, 1.40)
direction target size: (0.79, 0.42, 0.64)
```

Các con số này là đơn vị scene khái niệm, không phải mm, travel cơ khí, vị trí driver thật, shaft angle hay khoảng cách điện.

Rotor vẫn là output-only. Raycast input chỉ xét đúng ba target semantic hiện hành bằng non-recursive hit test; rotor, rail, nhãn và nền không có quyền input.

## API scene và receipt

Scene chỉ bật khi nhận đúng năm trường dữ liệu:

```js
scene.setLessonMotorActuation({
  enabled: true,
  lessonId: 10,
  motor,
  direction,
  onInputChange,
});
```

Điều kiện fail-closed:

- `lessonId` phải chính xác là `10` và lesson hiện hành cũng là 10;
- `motor` phải là số nguyên `0..255`;
- `direction` chỉ có `forward` hoặc `reverse`;
- callback phải là function;
- target phải còn đúng parent, `kind`, `sourceId`, lesson và toàn bộ cờ authority/provenance;
- WebGL context loss, module ẩn, Lab Edit hoặc Lab layout làm binding không còn active;
- object enabled có field thừa, field accessor hoặc prototype khác plain object bị từ chối.

`enabled:false` là safe-off idempotent: hủy gesture/binding và preview nhưng không sửa native PWM/direction.

Receipt được đóng băng và công khai trạng thái hiện hành, bao gồm `active`, `motor`, `direction`, `previewMotor`, `targetCount:3`, `mode:"pwm+direction"` cùng năm cờ `false`: `physicalVerified`, `electricalAuthority`, `measuredSpeed`, `measuredDirection`, `driverPowerModeled`.

## PWM: preview rồi mới commit

1. `pointerdown` mouse/touch/pen trên đúng PWM thumb giữ lại target, source ID, PWM hiện hành, direction hiện hành và callback. Không đổi host control và không quay rotor.
2. Khi kéo, scene chỉ cập nhật preview thumb. Mapping first-party là **+2 PWM cho mỗi CSS pixel kéo sang phải**, kéo trái giảm; kết quả được làm tròn và clamp `0..255`.
3. `pointerup` dùng displacement cuối cùng trước khi kết thúc gesture. Chỉ khi target/source/host PWM/host direction/callback vẫn đúng, preview hợp lệ và khác giá trị đầu mới phát một đề nghị `motor`.
4. `pointercancel`, `lostpointercapture`, hidden document, stale callback/host value, lesson/layout/edit/context change đều hủy preview mà không commit.

Scene không dùng preview PWM để thay đổi rotor. Rotor chỉ đọc `snapshot.motorSpeed` / `snapshot.motorDirection` từ simulator khi `update(snapshot)` chạy.

## Direction: tap-release trên đúng target

Hai target Thuận/Ngược không phải slider. `pointerdown` chỉ giữ lựa chọn dự kiến. `pointerup` chỉ phát đề nghị khi:

- gesture không trở thành drag;
- binding vẫn current;
- lựa chọn khác direction hiện hành;
- raycast tại release vẫn trúng **chính target đã nhấn** với cùng semantic direction.

Thả ngoài target, thả sang target còn lại, drag, `pointercancel` hoặc `lostpointercapture` đều không đổi direction.

## Metadata callback

Mỗi đề nghị hợp lệ dùng metadata frozen, đúng năm data field:

```js
Object.freeze({
  lessonId: 10,
  source: "pointer",
  pointerType: "mouse", // hoặc touch / pen
  phase: "change",
  physicalVerified: false,
});
```

`key` chỉ là `motor` hoặc `direction`. Giá trị được kiểm theo đúng miền của key. Callback exception bị scene giữ fail-closed.

## Native authority và keyboard fallback

Host kiểm tra lại lesson hiện hành, stage 3D, document visibility, Lab Edit, exact native element identity, `data-control`, range bounds/step hoặc select options trước khi nhận đề nghị scene. Khi chấp nhận, host đặt native value và đi qua `onControlsInput({target:native,type:"change",source:"scene"})`; scene không được viết trực tiếp `state.controls`.

Một sự kiện native thật trên `motor` hoặc `direction` thu hồi gesture 3D đang giữ trước khi thay đổi host state, sau đó binding mới được đồng bộ lại. Vì vậy bàn phím và native HTML luôn thắng stale 3D preview.

Run/Pause, reset, đổi lesson/stage, document hide/show, blur/focus, Lab Edit/layout/reconcile, WebGL loss/restore, initial mount và unload đều phải revoke/re-arm theo current native state; không replay một gesture cũ.

## Ranh giới signal-only của Bài 10

Bài 10 vẫn là **signal-only** trong circuit analysis. Hệ thống chỉ có thể kiểm tra phía logic Arduino → driver và GND tham khảo. Nguồn motor, đầu ra công suất và tải động cơ chưa được mô hình, nên analysis không được nâng thành `functional:true` hoặc `ok:true` chỉ vì signal path đủ.

Ba authored practice checkpoint của Bài 10 vẫn là **manual**. Chạm/kéo panel 3D, đổi native control, xem rotor hoặc có đủ signal reference không tự đánh dấu checkpoint, mastery hoặc completion.

Panel 3D không chứng minh hoặc mô hình hóa:

- driver đã cấp công suất cho motor;
- nguồn motor, dòng, điện áp, diode, giới hạn dòng hoặc tải;
- RPM, mô-men, công suất cơ, quán tính hoặc chuyển động thực;
- direction đã được đo ở shaft hay chân công suất;
- Sketch do người học sửa đã được compile/chạy trên AVR hay phần cứng thật.

`src/circuit-router.js` tiếp tục là authority duy nhất cho learner graph/connectivity. Scene API không gọi connect/disconnect, không tạo edge và không tự xác nhận điện học.

## Diagnostics và accessibility

Canvas diagnostics chỉ là trạng thái QA/hiển thị:

```text
lessonMotorMode = "pwm+direction" | "off"
lessonMotorPwm
lessonMotorPreviewPwm
lessonMotorDirection
lessonMotorGesture = "none" | "grabbed" | "dragging"
lessonMotorTargetCount = "3" | "0"
lessonMotorPhysicalVerified = "false"
lessonMotorElectricalAuthority = "false"
lessonMotorMeasuredSpeed = "false"
lessonMotorMeasuredDirection = "false"
lessonMotorDriverPowerModeled = "false"
```

Accessible scene text mô tả rõ 3D là input khái niệm, native range/select là fallback bàn phím, rotor là output simulator và Lesson10 không phải bằng chứng motor/driver vật lý.

## Provenance / reference boundary

- **R1 — Guided Atelier**: chỉ tham khảo pattern học có tương tác trực quan đi kèm native/text equivalent. Không sao chép code, model, artwork hay lesson content.
- **R2 — Learn Arduino live**: chỉ là quan sát UX công khai; việc xem được nội dung không cấp quyền tái phân phối asset.
- **R3 — Learn Arduino Button KR**: reference hẹp cho ownership/tap-vs-drag; không định nghĩa semantics motor của dự án này.
- **R4 — Learn Microcontroller / Learn Arduino source family**: cùng họ với R2, không phải một phiếu độc lập. Chỉ dùng làm reference về pattern tương tác/progression; không nhập code, model, icon, font, ảnh, công thức motor hay asset chưa có license rõ ràng.

Panel, thumb, direction targets, mapping `2 PWM/CSS pixel`, exact geometry và lifecycle ở đây là thiết kế first-party của Arduino 3D Việt Nam. R1–R4 chỉ là nguồn tham khảo, không phải nguồn asset hoặc code được phân phối trong release.

## Contract coverage

`tests/scene3d-contracts.js` có source contracts cho semantic target identity, API shape, frozen receipt, stale/cancel/WebGL/lifecycle, preview→commit, exact direction release, native authority/keyboard fallback, simulator-output boundary, signal-only/manual-checkpoint boundary và no-graph-authority.

Native Three.js raycast contracts kiểm ba center target chính xác trong default view và negative rotor/off-target. Các check này được cộng vào `runScene3DContracts()`; full browser E2E thuộc lane riêng và không được suy ra từ source/raycast PASS.
