# Bài 06 — Kéo nguồn sáng LDR trực tiếp trên mô hình 3D

## Phạm vi và ranh giới bằng chứng

Bài 06 có một **nguồn sáng 3D khái niệm** để người học kéo ngang bằng chuột, cảm ứng hoặc bút. Thao tác này chỉ đề nghị thay đổi cùng tham số `light` đã có trong thanh trượt HTML của bài học. Nó không đo độ rọi thật, điện áp thật ở A0, điện trở quang thật hay cường độ quang học của một nguồn sáng vật lý.

Đầu vào có thẩm quyền vẫn là `state.controls.light` qua `#control-light` (`input[type=range]`) do host sở hữu:

| Thuộc tính | Giá trị |
| --- | --- |
| Bài học | 06 — Đọc cảm biến ánh sáng |
| Khóa | `light` |
| Miền | Số nguyên `0..1023` |
| Bước | `1` |
| Khởi tạo authored | `650 ADC` |
| Kéo 3D | sang phải làm đèn xa hơn/tối hơn và giảm `5 ADC` cho mỗi CSS pixel; sang trái tăng |
| Tương đương bàn phím | Thanh trượt HTML, phím mũi tên, Home/End |
| Kích thước mục tiêu HTML | Tối thiểu 44 px chiều cao, có `:focus-visible` |

`light` là **tham số ADC giả lập**. Các chữ mô tả sáng/tối, giá trị A0 và trạng thái LED trong bài là kết quả của simulator JavaScript dựa trên tham số đó. Chúng không phải lux, volt, ohm hoặc phép đo quang trở thật. Scene công khai `measuredIlluminance:false` để giữ ranh giới này rõ ràng.

## Định danh chính xác trong scene

Lesson 06 tạo đúng một mesh điều khiển cho nguồn sáng khái niệm. LDR, thân module, LED, nhãn, nền và các đối tượng Lab không nhận quyền thay đổi `light`.

```text
kind: "ldr-light-source-target"
lessonId: 6
sourceId: "lesson-6-ldr-light-source"
physicalVerified: false
electricalAuthority: false
measuredIlluminance: false
```

Raycast phải chọn đúng mesh đã gắn tag này theo non-recursive hit test. Một mesh lân cận hoặc phần thân cảm biến không được trở thành nguồn nhập chỉ vì nằm gần con trỏ.

## API và quyền sở hữu

Host cấp quyền bằng:

```js
scene.setLessonLdrActuation({
  enabled: true,
  lessonId: 6,
  light: state.controls.light,
  onLightChange,
});
```

Chế độ bật nhận đúng bốn trường dữ liệu. `light` phải là số nguyên `0..1023` và callback phải là hàm. API phải fail closed khi sai lesson, Lab Edit/layout đang hoạt động, WebGL context bị mất, module bị ẩn hoặc mesh không còn đúng định danh. Chế độ tắt chỉ xóa binding/gesture tạm thời; nó không tự sửa `state.controls.light`.

Receipt được `Object.freeze()` và công khai `targetCount:1`, `physicalVerified:false`, `electricalAuthority:false`, `measuredIlluminance:false` khi actuator hợp lệ.

## Hành trình giữ → xem trước → thả

1. `pointerdown` thật trên đúng nguồn sáng giữ pointer, source, callback và `light` host ban đầu. Không có host write tại thời điểm này.
2. Khi vượt ngưỡng kéo, `pointermove` tính preview khái niệm bằng `clamp(round(startLight - deltaX*5), 0, 1023)`. Vì vậy kéo sang phải làm nguồn sáng xa hơn/tối hơn và **giảm** ADC; kéo sang trái **tăng** ADC.
3. Preview chỉ đổi phản hồi hình ảnh của scene. Nó không cập nhật native slider, simulator, learner graph, history, progress hay local storage trong lúc kéo.
4. `pointerup` ghép cả tọa độ release cuối cùng rồi kiểm lại đúng lesson, mesh, source, callback và `light` host gốc. Scene chỉ phát một đề nghị khi gesture thực sự đã kéo, preview là số nguyên hợp lệ và khác host.
5. Host kiểm metadata, gán giá trị cho đúng `#control-light`, rồi gọi `onControlsInput({target:native,type:"change",source:"scene"})`. Simulator và mọi quan sát `change-control` tiếp tục đi qua đường native hiện hữu.

Metadata callback đúng năm trường dữ liệu đóng băng:

```js
Object.freeze({
  lessonId: 6,
  source: "pointer",
  pointerType: "mouse", // hoặc "touch", "pen"
  phase: "change",
  physicalVerified: false,
});
```

Scene không gọi `connectCircuit`, `disconnectCircuit`, router điện, completion, quiz hay mastery. Learner graph vẫn chỉ thuộc `src/circuit-router.js`; preview 3D không tạo edge và không chứng minh thao tác phần cứng.

## Hủy, stale state và vòng đời

`pointercancel`, `lostpointercapture`, native range input mới, đổi lesson/stage, Run/Pause, reset, Lab Edit/layout, rollback layout, tab ẩn, mất focus, WebGL context loss, `beforeunload` hoặc dispose đều phải làm gesture cũ mất hiệu lực. Khi điều kiện hợp lệ trở lại, host chỉ re-arm actuator từ `light` native hiện hành.

Canvas chỉ dùng `touch-action:none` khi một mode tương tác scene sở hữu đang bật. Canvas không chiếm phím để điều khiển nguồn sáng; thanh trượt HTML là đường bàn phím chính thức.

## Đầu ra mô phỏng

`src/simulator.js` clamp `light` về `0..1023`, xem `light < 400` là trạng thái tối theo logic bài học, và chỉ bật LED/D13 khi `running && dark`. Chuỗi `A0=...` và nhãn `Ánh sáng: ... ADC` là đầu ra mô phỏng từ tham số đã chọn. Chúng không chứng minh điện áp A0, lux, điện trở LDR hay Sketch sửa của người học đã được đo/chạy trên phần cứng thật.

Giữ nguyên 16 bài học, 48 authored checkpoints, boundary signal-only của Lessons 10/14 và các workflow Undo/Redo hiện hữu.

## Diagnostic và QA

Canvas công khai `data-lesson-ldr-mode`, `data-lesson-ldr-light`, `data-lesson-ldr-preview-light`, `data-lesson-ldr-gesture`, `data-lesson-ldr-target-count`, `data-lesson-ldr-physical-verified`, `data-lesson-ldr-electrical-authority`, `data-lesson-ldr-measured-illuminance`. Các trường này chỉ phục vụ quan sát/QA; chúng không phải phép đo hay nguồn thẩm quyền điện.

QA cho milestone gồm source contracts, native Three raycast đúng một target, clamp biên, stale/cancel/capture, native keyboard path, Run/Pause/lifecycle WebGL, 44 px/focus và offline byte parity. Chỉ những cổng đã chạy trên source tương ứng mới được báo PASS.

## Nguồn tham khảo và quyền sử dụng

- **R1 — `sources/codex-howto/assets/atelier/guided`:** chỉ tham khảo cấu trúc stages và cách tách hành động khỏi evidence; không sao chép giao diện, mã hoặc artwork.
- **R2 — `https://learn-arduino-red.vercel.app/`:** chỉ là quan sát trải nghiệm Arduino công khai; việc trang chạy công khai không tạo quyền mặc nhiên để sao chép hoặc tái phân phối mã/asset.
- **R3 — `sources/learn-arduino-button-kr`:** phạm vi tham khảo hẹp ở button interaction; không mở rộng snapshot đó thành nguồn cho LDR/light-source UX và không suy diễn giấy phép asset tổng quát.
- **R4 — `sources/learn-microcontroller`:** chỉ tham khảo **lamp/light-source UX** ở mức ý tưởng tương tác. Không nhập mã, mesh, hình ảnh, texture, CSS, công thức quang học, công thức điện hay asset từ R4; tài liệu này không tuyên bố có quyền tái phân phối code/asset của R4.

Nguồn sáng raycast, metadata, ánh xạ `-5 ADC/CSS px`, stale guards và bridge về native range được biên soạn riêng cho Arduino 3D Việt Nam.

---

## English boundary summary

Lesson 06 exposes one **conceptual 3D light source** as an optional pointer input for the existing native `light` range. Dragging right represents moving the lamp farther/darker and subtracts 5 ADC units per CSS pixel; dragging left increases the simulated ADC value. Values remain integer-clamped to `0..1023`, with authored default `650`.

The displayed light level, A0 value and dark/bright status are simulator outputs, not measured lux, voltage or real photoresistance. The target is explicitly tagged `physicalVerified:false`, `electricalAuthority:false`, and `measuredIlluminance:false`. A gesture previews locally and may commit only on release through the host-owned `#control-light` plus `onControlsInput` path. It never creates circuit edges or grants Three.js progress/electrical authority.

R4 informs lamp UX only. No R4 code or assets are incorporated or copied. The 3D target, drag mapping, metadata and lifecycle guards are authored for this project.
