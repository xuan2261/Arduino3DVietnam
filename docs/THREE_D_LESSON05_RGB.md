# Bài 05 — Ba fader RGB khái niệm trên mô hình 3D

## Mục tiêu và ranh giới bằng chứng

Bài 05 dùng ba **fader 3D khái niệm** cho các kênh `red`, `green`, `blue` như một cách nhập thay thế cho ba thanh trượt HTML hiện hữu. Chúng chỉ đề nghị thay đổi các giá trị lệnh PWM mô phỏng `0..255`; chúng không đo duty cycle thực, dòng LED, công suất quang, phổ phát xạ hoặc màu vật lý của LED.

Đường nhập có thẩm quyền vẫn thuộc host và ba native ranges:

| Kênh | Native control | Miền | Bước | Authored default |
| --- | --- | ---: | ---: | ---: |
| Đỏ | `#control-red` | `0..255` | `1` | `220` |
| Xanh lá | `#control-green` | `0..255` | `1` | `100` |
| Lam | `#control-blue` | `0..255` | `1` | `50` |

Kéo sang phải tăng **2 đơn vị lệnh PWM cho mỗi CSS pixel**; kéo sang trái giảm. Đây là ánh xạ UI cục bộ, không phải phép đo chu kỳ nhiệm vụ của waveform thật.

## Ba target 3D first-party

Scene tạo đúng ba mesh nhập, cùng semantic source nhưng mỗi mesh có channel riêng:

```text
kind: "rgb-fader-handle"
lessonId: 5
sourceId: "lesson-5-rgb-faders"
channel: "red" | "green" | "blue"
physicalVerified: false
electricalAuthority: false
measuredDutyCycle: false
```

Ba handle là input surfaces riêng biệt; **LED RGB không phải input target**. LED hiện hữu vẫn là output visualization của simulator sau khi host đã commit giá trị.

Geometry authored:

```text
handle size = [0.66, 0.67, 0.62]
y = 0.91
z(red)   = -1.25
z(green) =  0.00
z(blue)  = +1.25
x = -2.55 + (value / 255) * 1.25
module world offset = (5.15, 0.55, 0.10)
```

Vị trí trên chỉ là display geometry, không phải khoảng cách điện, cường độ sáng hay đặc tính quang học. Rail/label R-G-B chỉ là affordance trực quan.

## API scene

Host bật mode bằng đúng sáu trường:

```js
scene.setLessonRgbActuation({
  enabled: true,
  lessonId: 5,
  red: state.controls.red,
  green: state.controls.green,
  blue: state.controls.blue,
  onChannelChange,
});
```

`red`, `green`, `blue` phải là số nguyên `0..255`, callback phải là function và lesson phải đúng 5. Khi disable/reset, scene chỉ thu hồi binding/gesture và preview; nó không tự sửa native controls.

Receipt trạng thái phải được đóng băng và giữ `handleCount:3`, `physicalVerified:false`, `electricalAuthority:false`, `measuredDutyCycle:false`. Kích thước tay gạt được chọn để dễ nhắm hơn trên canvas; native ranges mới là đường bàn phím và mục tiêu HTML tối thiểu 44px. Geometry không xác nhận kích thước cơ khí thật.

## Giữ → preview → thả

1. `pointerdown` chỉ bắt đầu khi raycast trúng đúng một `rgb-fader-handle`. Gesture giữ channel, exact mesh object, shared `sourceId`, host value ban đầu và callback. Không ghi native value lúc này.
2. Sau tap threshold, `pointermove` tính `previewValue = clamp(round(startHostValue + deltaX * 2), 0, 255)` và chỉ di chuyển handle của channel đang giữ.
3. Trong preview, **không đổi màu/emissive của LED RGB**. Điều này giữ output simulator đã commit tách biệt với đề nghị chưa commit.
4. `pointerup` ghép displacement cuối cùng, rồi kiểm lại channel, exact handle object, shared source ID, host start value và callback. Chỉ khi gesture thực sự thay đổi một giá trị hợp lệ mới emit.
5. Host chọn đúng native range theo channel, gán `native.value`, rồi tái sử dụng `onControlsInput({target:native,type:"change",source:"scene"})`.

Callback nhận channel riêng và metadata đóng băng đúng năm trường:

```js
onChannelChange("red", 224, Object.freeze({
  lessonId: 5,
  source: "pointer",
  pointerType: "mouse", // hoặc touch / pen
  phase: "change",
  physicalVerified: false,
}));
```

`channel` không được suy ra từ màu material hoặc từ RGB hex đã render.

## Quyền sở hữu native host và stale state

Host chỉ arm RGB scene khi **cả ba** `#control-red`, `#control-green`, `#control-blue` tồn tại, connected, enabled, là `INPUT range`, `min=0`, `max=255`, `step=1`, và cả ba host values đều là số nguyên hợp lệ.

Bất kỳ native input/change thật nào trên một trong ba channel với `source !== "scene"` phải thu hồi toàn bộ RGB binding trước khi host cập nhật, rồi sync lại từ state mới. Cách này ngăn một gesture đỏ cũ sống sót sau khi xanh lá hoặc lam đã được người dùng thay đổi bằng native control.

Run/Pause, reset, đổi lesson/stage, Lab Edit/layout/reconcile, document hidden, blur/focus, WebGL loss/restore, beforeunload và dispose đều phải có cùng fail-closed lifecycle như các actuation trước.

Canvas không chiếm keyboard để điều khiển RGB; ba native ranges là đường bàn phím chính thức và phải có target tối thiểu 44 px cùng `:focus-visible` rõ ràng.

## Renderer và ranh giới “màu thật”

`src/simulator.js` clamp ba kênh và tạo synthetic RGB hex/intensity. `src/scene3d.js` có thể dùng snapshot đã commit để tô LED minh họa. Đây chỉ là **output visualization**.

Không được đọc ngược:

- `activeModule.led.material.color`,
- emissive,
- rendered hex,
- brightness,
- hay vị trí geometry

để suy ra native `red/green/blue`, duty cycle, dòng điện, công suất quang hoặc màu vật lý. `255` là giá trị lệnh PWM mô phỏng, không chứng minh duty cycle đo được 100%.

## Canvas diagnostics

```text
lessonRgbMode
lessonRgbRed
lessonRgbGreen
lessonRgbBlue
lessonRgbPreviewChannel
lessonRgbPreviewValue
lessonRgbGesture
lessonRgbHandleCount
lessonRgbPhysicalVerified
lessonRgbElectricalAuthority
lessonRgbMeasuredDutyCycle
```

Diagnostics chỉ dành cho QA/readback; chúng không phải evidence điện, waveform hay colorimetry.

## Phạm vi sản phẩm được giữ nguyên

- Giữ nguyên 16 bài học và 48 authored checkpoints.
- `src/circuit-router.js` vẫn là nguồn thẩm quyền điện duy nhất.
- Kéo fader không tạo hoặc xóa graph edge.
- Không tự đánh dấu checkpoint, completion, quiz hoặc mastery.
- Không tạo tuyên bố CAD, phần cứng, waveform, current, optical calibration hoặc AVR execution.
- Các invariant Lesson 10/14 signal-only và Undo/Redo hiện hữu không thay đổi.

## Nguồn tham khảo và bản quyền

- **First-party:** Lesson 05 RGB cathode chung, ba native controls 0..255, authored defaults `220/100/50`, D9/D10/D11 simulator output, scene target/raycast, stale guards và native bridge trong milestone này.
- **R1 — Codex How-To Guided Atelier:** chỉ tham khảo phương pháp staged learning, action/evidence và fallback tương đương; không sao chép mã, đồ họa hoặc nội dung bài học.
- **R2 — same-family Arduino learning reference:** chỉ dùng để đối chiếu cách trình bày/tương tác cùng họ sản phẩm; không suy diễn quyền tái phân phối và không sao chép UI, code hoặc asset.
- **R3 — Learn Arduino Button KR:** nguồn hẹp về thao tác nút và pointer ownership, không phải bằng chứng kỹ thuật cho ba kênh RGB, cũng không cấp quyền tái phân phối mã/asset.
- **R4 — fader interaction idea:** chỉ tham khảo ý tưởng UX về các điều khiển kênh độc lập. Không sao chép code, công thức, geometry, mesh, texture, màu authored, CSS hay asset; không tuyên bố quyền tái phân phối từ R4.

---

## English boundary summary

Lesson 05 adds three first-party conceptual 3D faders for the existing native `red`, `green`, and `blue` command ranges (`0..255`, defaults `220/100/50`). Each handle has exact channel identity while sharing `sourceId:"lesson-5-rgb-faders"`. Dragging right adds two command units per CSS pixel; pointer movement previews only, and release may commit solely through the exact channel-specific native range and the existing host input path.

The RGB LED remains simulator output visualization only. Its material color, emissive, brightness, rendered hex, and geometry are never control authority and do not prove measured PWM duty, current, optical power, colorimetry, hardware behavior, CAD fidelity, or AVR execution. Targets remain `physicalVerified:false`, `electricalAuthority:false`, and `measuredDutyCycle:false`.

R2 and R4 are reference-only. R4 contributes only a generic fader UX idea; no R4 formulas, code, meshes, CSS, colors, textures, or assets are copied.
