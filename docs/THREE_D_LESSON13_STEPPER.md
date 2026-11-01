# Bài 13 — Điều chỉnh số bước trực tiếp trong mô hình 3D

## Phạm vi

Bài 13 giữ nguyên nội dung đã biên soạn: động cơ bước tham chiếu dùng **200 bước/vòng**, điều khiển native `steps` trong miền **0..200**, giá trị khởi tạo **50 bước**. Tương tác mới chỉ thêm một tay gạt 3D khái niệm để nhập cùng giá trị đó. Nó không thay đổi lesson data, Sketch tham khảo, simulator, graph mạch, checkpoint hay logic hoàn thành bài học.

`#control-steps` (`input[type=range]`) do host sở hữu vẫn là nguồn dữ liệu đầu vào duy nhất:

| Thuộc tính | Giá trị |
| --- | --- |
| Lesson | 13 — Điều khiển động cơ bước |
| Khóa | `steps` |
| Miền | số nguyên `0..200` |
| Bước | `1` |
| Mặc định authored | `50 bước` |
| Tương đương bàn phím | Arrow keys, Home, End trên native range |

## Input 3D tách biệt hoàn toàn khỏi rotor output

Scene tạo **một tay gạt nhập số bước riêng**, không gắn quyền input lên rotor/trục động cơ. Geometry first-party hiện tại:

```text
module world position: (5.15, 0.55, 0.10)
passive rail box:      [1.60, 0.08, 0.18], local center (-2.05, 0.60, +1.42)
input thumb box:       [0.78, 0.82, 0.70]
thumb x:               -2.65 + (steps / 200) * 1.20
thumb y/z:             0.94 / +1.42
```

Các kích thước trên là **đơn vị hiển thị khái niệm**, không phải mm, hành trình cơ khí, pitch vít, vị trí rotor hay vị trí thật của driver.

Chỉ thumb có định danh input:

```text
kind: "stepper-step-count-target"
lessonId: 13
sourceId: "lesson-13-step-count"
physicalVerified: false
electricalAuthority: false
measuredMotion: false
```

Rail, nhãn, thân motor, trục và rotor không phải target nhập liệu. Raycast của interaction chỉ xét đúng thumb hiện hành bằng non-recursive hit test.

## API và authority

Scene nhận đúng bốn trường khi bật:

```js
scene.setLessonStepperActuation({
  enabled: true,
  lessonId: 13,
  steps,
  onStepsChange,
});
```

`steps` phải là số nguyên 0..200 và callback phải là function. Scene fail-closed nếu sai lesson, sai target identity, WebGL context đã mất, module bị ẩn hoặc Lab Edit/layout đang sở hữu canvas. Chế độ `enabled:false` chỉ hủy binding/preview tạm thời; nó không sửa native value.

Receipt được đóng băng và công khai `targetCount:1`, `physicalVerified:false`, `electricalAuthority:false`, `measuredMotion:false`.

## Pointer preview → commit

1. `pointerdown` bằng mouse/touch/pen trên đúng thumb giữ `steps` hiện hành và callback, không thay đổi native range và không quay rotor.
2. Sau tap/drag threshold, kéo **sang phải tăng**, **sang trái giảm** theo mapping first-party `1 bước mô phỏng / CSS pixel`, làm tròn và clamp 0..200.
3. Trong drag chỉ `previewSteps` và vị trí thumb thay đổi. Không có `onControlsInput`, graph/history/progress write, STEP/DIR pulse, driver state hoặc rotor write.
4. `pointerup` hợp lệ ghép displacement cuối cùng, kiểm lại đúng target/source/host value/callback, rồi phát tối đa một đề nghị nếu preview khác giá trị ban đầu.
5. Host kiểm tra lại native `#control-steps` đúng min/max/step, đặt `native.value`, và dùng đường hiện hữu `onControlsInput({target:native,type:"change",source:"scene"})`.

Metadata callback chính xác năm trường dữ liệu:

```js
Object.freeze({
  lessonId: 13,
  source: "pointer",
  pointerType: "mouse", // hoặc touch / pen
  phase: "change",
  physicalVerified: false,
});
```

No-drag click, `pointercancel`, `lostpointercapture`, stale host value/callback/target hoặc native range thay đổi trong lúc kéo đều không commit preview cũ.

## Rotor và simulator

`src/simulator.js` tiếp tục là nơi duy nhất diễn giải `steps` thành output lesson. Simulator hiện dùng 200 bước/vòng để tạo giá trị góc minh họa; khi dừng, snapshot xuất `angle:0`, và chỉ khi Run thì rotor 3D đọc `snapshot.angle` để hiển thị.

Tay gạt input **không** quay rotor trực tiếp và không chứng minh:

- góc cơ khí đo được hoặc vị trí tuyệt đối;
- số xung STEP thực sự đã phát hay trạng thái chân DIR;
- driver/cuộn dây đang được cấp điện;
- mô-men, tốc độ, dòng, điện áp hoặc tải;
- Sketch do người học sửa đã được biên dịch/chạy trên AVR hay phần cứng thật.

Chuỗi serial `STEP=...` trong simulator chỉ là output của mô phỏng JavaScript cho lesson, không phải trace điện hoặc firmware hardware.

## Lifecycle, accessibility và diagnostics

Gesture phải fail-closed khi đổi lesson/stage, reset, tab ẩn, blur/focus transition, Lab Edit/layout/reconcile, WebGL loss/restore hoặc dispose. Run/Pause thu hồi preview trước thay đổi snapshot và chỉ re-arm binding hợp lệ sau đó, tránh stale preview sống qua thay đổi rotor output.

Native `#control-steps` giữ mục tiêu tương tác tối thiểu 44 px và focus-visible. 3D là progressive enhancement; người học luôn có thể dùng bàn phím trên native range mà không cần WebGL.

Canvas diagnostics chỉ phục vụ QA/hiển thị:

```text
lessonStepperMode
lessonStepperSteps
lessonStepperPreviewSteps
lessonStepperGesture
lessonStepperTargetCount
lessonStepperPhysicalVerified=false
lessonStepperElectricalAuthority=false
lessonStepperMeasuredMotion=false
```

## Ranh giới curriculum và authority

Giữ nguyên **16 bài học / 48 authored checkpoints**. `src/circuit-router.js` tiếp tục là authority duy nhất cho connectivity/electrical topology; Stepper 3D chỉ đề nghị thay đổi một lesson input đã tồn tại. Scene không tự xác nhận mạch đúng, không tạo edge và không tự đánh dấu mastery/completion.

## Provenance / reference boundary

- **R1 — Guided Atelier**: used only for the interaction/evidence pattern that a WebGL action needs an accessible text/native equivalent. No R1 code, artwork or lesson content is copied.
- **R2 — Learn Arduino live**: public UX observation only. Public availability does not grant redistribution rights.
- **R3 — Learn Arduino Button KR**: a narrow button-focused reference useful for pointer ownership/tap-vs-drag thinking; it does not define Stepper semantics for this project.
- **R4 — Learn Microcontroller / Learn Arduino source family**: same family as R2, not an independent vote. Its Stepper curriculum uses a different **2048-step** model and a different interaction concept. Arduino 3D Việt Nam keeps its authored **200-step** curriculum and does not import R4 formulas, code, models, icons, fonts or assets. The pinned snapshot has no blanket root license.

The Stepper thumb, rail geometry, 0..200 mapping and 1-step-per-pixel input behavior are first-party design choices for Arduino 3D Việt Nam. They are not claims about real motor mechanics or hardware.
