# Bài 14 — Tay kéo độ ẩm đất khái niệm trong mô hình 3D

## Phạm vi

Bài 14 giữ nguyên curriculum **Chậu cây thông minh** đã biên soạn. Người học điều chỉnh một giá trị độ ẩm đất mô phỏng và quan sát bơm mô phỏng bật khi giá trị thấp hơn ngưỡng bài học. Tương tác 3D mới chỉ thêm một tay kéo đầu vào khái niệm cho chính giá trị `moisture` hiện có; nó không thay đổi lesson data, Sketch tham khảo, simulator, graph mạch, checkpoint hay logic hoàn thành bài học.

Native HTML vẫn là nguồn input có thẩm quyền:

| Thuộc tính | Giá trị |
| --- | --- |
| Lesson | 14 — Chậu cây thông minh |
| Control key | `moisture` |
| Element | `#control-moisture`, `input[type=range]` |
| Miền | số nguyên `0..100` |
| Bước | `1` |
| Mặc định authored | `48%` |
| Bàn phím | Arrow keys, Home, End trên native range |

Scene chỉ đề nghị một giá trị mới. Host phải kiểm tra lại lesson, native range và binding hiện hành rồi đi qua đường `onControlsInput(...)` có sẵn.

## Geometry first-party và semantic target

Scene dựng **một** target nhập liệu riêng bên cạnh chậu cây. Chậu, lá, rail và đèn chỉ báo bơm là passive/output surfaces; chúng không có input authority.

Geometry hiện hành:

```text
module position:              (5.15, 0.55, 0.10)
passive rail size:            (1.62, 0.08, 0.18)
passive rail local center:    (-1.95, 0.60, 1.40)
moisture thumb size:          (0.78, 0.74, 0.68)
thumb local x:                -2.56 + (moisture / 100) * 1.20
thumb local y/z:              0.92 / 1.40
default 48 local x:           -1.984
default 48 world center:      (3.166, 1.47, 1.50)
```

Các số trên là **đơn vị hiển thị scene**, không phải độ sâu que đo, khoảng cách vật lý, lượng nước hay calibration của cảm biến đất.

Chỉ thumb có semantic identity:

```text
kind: "soil-moisture-target"
lessonId: 14
sourceId: "lesson-14-soil-moisture"
physicalVerified: false
electricalAuthority: false
measuredMoisture: false
pumpPowerModeled: false
```

Raycast input chỉ xét đúng mesh này bằng non-recursive hit test. Chậu cây, rail, lá và đèn bơm không được suy thành input.

## Scene API và receipt

Scene chỉ bật với đúng bốn trường dữ liệu:

```js
scene.setLessonMoistureActuation({
  enabled: true,
  lessonId: 14,
  moisture,
  onMoistureChange,
});
```

`moisture` phải là số nguyên `0..100`, callback phải là function, object enabled phải là plain object với đúng bốn own data fields. Binding fail-closed khi document ẩn, WebGL context loss, sai lesson, Lab Edit/layout đang sở hữu scene, module ẩn hoặc target identity/provenance không còn canonical.

`enabled:false` là safe-off idempotent: hủy gesture/binding và preview, không tự sửa native value.

Receipt được `Object.freeze(...)` và công khai trạng thái `active`, `moisture`, `previewMoisture`, `targetCount:1`, `mode:"pointer-slide"` cùng các cờ:

```text
physicalVerified: false
electricalAuthority: false
measuredMoisture: false
pumpPowerModeled: false
```

## Pointer preview → release commit

1. `pointerdown` mouse/touch/pen trên đúng `soil-moisture-target` giữ lại exact mesh, source ID, giá trị host và callback. Không thay native slider và không bật/tắt bơm.
2. Sau drag threshold, kéo sang phải tăng và kéo sang trái giảm theo mapping first-party **1 điểm phần trăm / CSS pixel**, làm tròn và clamp `0..100`.
3. `pointermove` chỉ thay `previewMoisture` và vị trí thumb. Không có host callback trong move.
4. `pointerup` ghép displacement cuối cùng trước khi kết thúc gesture. Chỉ khi target/source/host value/callback vẫn current, preview là integer hợp lệ và khác giá trị ban đầu mới phát một đề nghị.
5. Tap/no-drag, `pointercancel`, `lostpointercapture`, hidden document, stale host value/callback, lesson/layout/edit/context change đều không commit preview.

Metadata callback chính xác năm data fields và được đóng băng:

```js
Object.freeze({
  lessonId: 14,
  source: "pointer",
  pointerType: "mouse", // hoặc touch / pen
  phase: "change",
  physicalVerified: false,
});
```

## Host/native authority và accessibility

Host chỉ arm scene khi current lesson có duy nhất authored `moisture` slider `0..100`, step `1`, native element hiện hành đúng `data-control="moisture"`, connected/enabled và native value trùng host value. Callback từ scene được kiểm lại current binding, bounded integer, exact frozen metadata, exact native element identity và host value trước khi được chấp nhận.

Khi chấp nhận, host chỉ thực hiện:

```text
native.value = proposed
onControlsInput({ target: native, type: "change", source: "scene" })
```

Native `#control-moisture` có hit target cao 44 px và focus-visible ring. Một sự kiện native thật luôn thu hồi gesture 3D đang giữ trước khi host state thay đổi, sau đó binding mới được đồng bộ từ native value. Vì vậy keyboard/native HTML luôn thắng stale 3D preview.

Run/Pause, reset, đổi lesson/stage, document hide/show, blur/focus, Lab Edit/layout/reconcile, WebGL loss/restore, initial mount và unload đều revoke/re-arm theo current native state; không replay một gesture cũ.

Canvas diagnostics chỉ phục vụ QA/hiển thị:

```text
lessonMoistureMode = "pointer-slide" | "off"
lessonMoistureValue
lessonMoisturePreview
lessonMoistureGesture = "none" | "grabbed" | "dragging"
lessonMoistureTargetCount = "1" | "0"
lessonMoisturePhysicalVerified = "false"
lessonMoistureElectricalAuthority = "false"
lessonMoistureMeasuredMoisture = "false"
lessonMoisturePumpPowerModeled = "false"
```

## Simulator output và signal-only boundary

`src/simulator.js` tiếp tục là nơi diễn giải authored setpoint. Nó clamp `moisture` về `0..100` và chỉ đặt output `pump=true` khi **mô phỏng đang chạy** và `moisture < 35`. Scene thumb không điều khiển trực tiếp LED/pump output.

Bài 14 tiếp tục là **signal-only** trong circuit analysis. Checker chỉ bao phủ phía tín hiệu cảm biến, tín hiệu điều khiển bơm và GND logic; nguồn/công suất sensor, relay/driver và tải bơm chưa được mô hình. Vì vậy signal path hoàn chỉnh không được nâng thành `functional:true` hoặc `ok:true`.

Authored practice registry của Bài 14 vẫn có chính xác ba checkpoint:

- **1 wiring checkpoint**: A0 → `SOIL:SIG` và D8 → `PUMP:IN`, chỉ phía tín hiệu;
- **2 manual checkpoints**: chỉnh độ ẩm xuống dưới 35% và quan sát bơm mô phỏng bật/tắt.

Tương tác 3D không tự đánh dấu wiring checkpoint, manual checkpoint, mastery hoặc completion. Giữ nguyên tổng **16 bài học / 48 authored checkpoints**.

## Không phải bằng chứng phần cứng

Tay kéo 3D và simulator không chứng minh:

- độ ẩm đất được đo thực tế hoặc đã hiệu chuẩn;
- điện áp/ADC thực của cảm biến;
- nguồn relay/driver hay công suất bơm;
- dòng, áp, lưu lượng nước, áp suất, lượng tưới hoặc tình trạng cây;
- Sketch do người học sửa đã được compile/chạy trên AVR hay phần cứng thật.

`src/circuit-router.js` tiếp tục là authority duy nhất cho learner graph/connectivity. Scene API không tạo/xóa edge và không tự xác nhận điện học.

## Provenance / reference boundary

- **R1 — Guided Atelier**: chỉ tham khảo pattern tương tác trực quan có native/text equivalent. Không sao chép code, model, artwork hay curriculum.
- **R2 — Learn Arduino live**: chỉ dùng như UX/reference observation; public visibility không cấp quyền tái phân phối asset.
- **R3 — Learn Arduino Button KR**: reference hẹp cho pointer ownership/tap-vs-drag; không định nghĩa soil-moisture semantics của dự án này.
- **R4 — Learn Microcontroller / Learn Arduino source family**: chỉ là reference pattern, không phải nguồn code/mesh/CSS/formula/asset cho milestone này. Không copy hoặc phái sinh asset chưa có license rõ ràng từ R4.

Rail, thumb geometry, `0..100`, default `48`, mapping `1%/CSS pixel`, target metadata và lifecycle ở đây là thiết kế first-party của Arduino 3D Việt Nam.

## Contract coverage

`tests/scene3d-contracts.js` bổ sung source contracts cho exact geometry/identity, API shape, frozen receipt, stale/cancel/WebGL/lifecycle, preview→release commit, native range authority/keyboard fallback, simulator-output separation, signal-only/checkpoint boundary và no-graph/no-mastery authority.

Native Three.js raycast contracts dùng chính geometry first-party ở trên để kiểm center hit của target và negative hit ở chậu cây, đèn bơm cùng vùng off-target. Các gate này được cộng vào `runScene3DContracts()`; browser E2E thuộc lane riêng và không được suy ra từ source/raycast PASS.
