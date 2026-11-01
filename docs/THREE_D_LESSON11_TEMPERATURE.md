# Bài 11 — Tay kéo mức nhiệt LM35 khái niệm trên mô hình 3D

## Mục tiêu và ranh giới bằng chứng

Bài 11 dùng một **tay kéo mức nhiệt 3D khái niệm** như một cách nhập thay thế cho thanh trượt HTML `#control-temp`. Đây là UI sư phạm cho tham số `temp` của simulator, không phải heater, nguồn nhiệt vật lý, mô hình truyền nhiệt, cảm biến khoảng cách, hoặc phép đo nhiệt độ thực từ LM35.

Đường nhập có thẩm quyền vẫn thuộc host và native range:

| Thuộc tính | Giá trị |
| --- | --- |
| Bài học | 11 — Đo và cảnh báo nhiệt độ |
| Cảm biến first-party của bài | LM35 |
| Khóa native | `temp` |
| Miền | Số nguyên `0..60` |
| Bước | `1 °C` |
| Giá trị authored ban đầu | `25 °C` |
| Kéo 3D | sang phải tăng `1 °C` cho mỗi 5 CSS px; sang trái giảm |
| Tương đương bàn phím | Thanh trượt HTML `#control-temp` |
| Commit | Chỉ khi thả pointer và qua bridge native host |

Giá trị `temp` là **nhiệt độ mô phỏng do người học chọn**. Scene không đọc nhiệt độ phòng, không nhận ADC thật, không đo điện áp LM35, không tính từ CAD/hình học và không chứng minh firmware/AVR đang chạy.

## Target 3D chính xác

Lesson 11 có đúng một mesh nhập nhiệt khái niệm độc lập với thân cảm biến:

```text
kind: "temperature-heat-source-target"
lessonId: 11
sourceId: "lesson-11-temperature-heat-source"
physicalVerified: false
electricalAuthority: false
measuredTemperature: false
```

Target không đại diện một heater thật. Vị trí authored chỉ là ánh xạ trực quan:

```text
x = 1.45 + (temp / 60) * 2.4
y = 0.86
z = 0.10
```

Các đơn vị trong công thức là display units của Three.js, không phải centimet, khoảng cách nhiệt, gradient nhiệt hay quy luật vật lý. Raycast chỉ được phép chọn đúng mesh đã gắn metadata trên; thân LM35 và các mesh lân cận không được tự trở thành input surface.

## API scene và quyền sở hữu

Host bật mode bằng đúng bốn trường:

```js
scene.setLessonTemperatureActuation({
  enabled: true,
  lessonId: 11,
  temp: state.controls.temp,
  onTempChange,
});
```

`temp` phải là số nguyên `0..60`; callback phải là function. Scene phải fail closed khi sai lesson, WebGL context bị mất, Lab Edit/layout đang bật, module bị ẩn hoặc target không còn đúng semantic identity. Disable/reset chỉ thu hồi binding/gesture; không tự sửa `state.controls.temp`.

Receipt trạng thái đóng băng công khai một target và luôn giữ:

```text
physicalVerified: false
electricalAuthority: false
measuredTemperature: false
```

## Giữ → preview → thả

1. `pointerdown` trên đúng heat target giữ pointer, source object/source ID, callback và `temp` host ban đầu. Không ghi vào native range tại đây.
2. Sau khi vượt tap threshold, `pointermove` chỉ tạo preview bằng ánh xạ ngang khái niệm: `round(startTemp + deltaX / 5)`, clamp `0..60`. Kéo phải tăng, kéo trái giảm.
3. Preview chỉ thay đổi phản hồi scene và diagnostic dataset; không đổi learner graph, progress, quiz, local storage, ADC thật hay kết quả firmware.
4. `pointerup` phải gộp displacement cuối, xác minh lại target/source/callback/host value và chỉ emit khi gesture thực sự thay đổi một giá trị hợp lệ khác host.
5. Host nhận callback, xác minh metadata, ghi đúng `#control-temp`, rồi tái sử dụng đường native `onControlsInput({target:native,type:"change",source:"scene"})`.

Metadata callback có đúng năm trường và được `Object.freeze()`:

```js
Object.freeze({
  lessonId: 11,
  source: "pointer",
  pointerType: "mouse", // hoặc touch / pen
  phase: "change",
  physicalVerified: false,
});
```

Scene không được gọi `connectCircuit`, `disconnectCircuit`, thay đổi `src/circuit-router.js`, tự đánh dấu checkpoint/lesson, sửa mastery hoặc tạo quyền electrical mới.

## Lifecycle và stale gesture

Gesture cũ phải bị thu hồi khi có `pointercancel`, `lostpointercapture`, native `temp` input mới, đổi lesson/stage, Run/Pause, reset, Lab Edit/layout, layout rollback, document hidden, window blur/focus transition, WebGL context loss, `beforeunload` hoặc dispose. Re-arm chỉ được lấy lại giá trị native hiện hành sau khi context hợp lệ.

Canvas có thể sở hữu `touch-action:none` khi temperature actuation đang bật, nhưng không được hijack keyboard. Thanh trượt HTML vẫn là đường bàn phím chính thức và phải có target tối thiểu 44 px cùng `:focus-visible` rõ ràng.

## Simulator và LM35

Bài 11 first-party dùng LM35. Nội dung authored giải thích đặc tính điển hình khoảng 10 mV/°C và mô phỏng quy đổi qua ADC 5 V. `src/simulator.js` clamp tham số `temp` về `0..60`, tạo ADC mô phỏng, đặt trạng thái nóng khi `temp > 30`, và chỉ bật LED/D13 khi simulation đang chạy.

Những phép tính đó là **mô hình giáo dục hiện hữu của project**, không biến heat handle 3D thành phép đo LM35 thực, phép đo điện áp thực, chuẩn hiệu chuẩn hoặc mô hình nhiệt học. Không được suy diễn rằng hình học 3D đo nhiệt, rằng một heater vật lý tồn tại, hoặc rằng Sketch learner-edited đã được biên dịch/chạy trên AVR.

## Diagnostic canvas

Canvas công khai đúng các trường quan sát:

```text
lessonTemperatureMode
lessonTemperatureTemp
lessonTemperaturePreviewTemp
lessonTemperatureGesture
lessonTemperatureTargetCount
lessonTemperaturePhysicalVerified
lessonTemperatureElectricalAuthority
lessonTemperatureMeasuredTemperature
```

Các dataset chỉ phục vụ QA/readback. Chúng không phải dữ liệu cảm biến hay evidence phần cứng.

## Bảo toàn phạm vi sản phẩm

- Giữ nguyên 16 bài học và 48 authored checkpoints.
- `src/circuit-router.js` vẫn là nguồn thẩm quyền điện duy nhất.
- Không tạo edge khi kéo heat handle.
- Không tự đánh dấu completion, quiz hoặc mastery.
- Không đưa ra tuyên bố CAD, phần cứng, thermal calibration hay AVR execution.
- Các invariant Lesson 10/14 signal-only và Undo/Redo hiện hữu không thay đổi.

## Nguồn tham khảo và bản quyền

- **First-party:** LM35, nội dung bài 11, native `temp` slider, simulator threshold/ADC và Three.js target trong milestone này thuộc implementation của Arduino 3D Việt Nam.
- **R2 — same-family Arduino learning reference:** chỉ dùng để đối chiếu mức độ trực quan/tương tác cùng họ sản phẩm; không suy diễn quyền tái phân phối và không sao chép UI, code hoặc asset.
- **R4 — TMP36 UX inspiration:** chỉ tham khảo ý tưởng UX về một nguồn/mức nhiệt có thể điều chỉnh. R4 dùng TMP36 không thay thế LM35 first-party của bài 11. Không sao chép công thức TMP36, mã, mesh, hình, texture, CSS hoặc asset từ R4; không tuyên bố giấy phép tổng quát cho các tài sản đó.

Ánh xạ `1 °C / 5 CSS px`, metadata, stale guards, native bridge và visual mapping của heat handle được biên soạn riêng cho milestone này.

---

## English boundary summary

Lesson 11 adds one **conceptual 3D heat-level handle** for the existing first-party LM35 lesson. The native `temp` range remains authoritative (`0..60`, step `1`, authored default `25`). Dragging right adds one simulated degree per five CSS pixels; dragging left subtracts. Pointer movement previews only, and release may commit solely through the exact native host control path.

The handle is not a heater, thermal model, physical thermometer, ADC/voltage measurement, CAD verification, hardware evidence, or AVR execution evidence. Its static position `x = 1.45 + (temp/60)*2.4`, `y=.86`, `z=.10` is display geometry only. The target remains `physicalVerified:false`, `electricalAuthority:false`, and `measuredTemperature:false`.

R4 TMP36 material is UX inspiration only; no R4 formulas, code or assets are copied. R2 is treated only as a same-family interaction reference. The project keeps LM35 as the first-party Lesson 11 sensor and preserves all 16 lessons, 48 authored checkpoints, and circuit-router authority.
