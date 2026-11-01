# Bài 07 — Trượt vật cản siêu âm trực tiếp trên mô hình 3D

## Phạm vi và ranh giới bằng chứng

Bài 07 có một **vật cản 3D khái niệm** để người học kéo ngang bằng chuột, cảm ứng hoặc bút. Thao tác này chỉ đề nghị thay đổi cùng tham số `distance` đã có trong thanh trượt HTML của bài học. Nó không đo HC-SR04 thật, không đọc Echo từ phần cứng và không xác nhận khoảng cách hình học của mesh theo centimet.

Đầu vào có thẩm quyền vẫn là `state.controls.distance` qua `#control-distance` (`input[type=range]`) do host sở hữu:

| Thuộc tính | Giá trị |
| --- | --- |
| Bài học | 07 — Đo khoảng cách bằng siêu âm |
| Khóa | `distance` |
| Miền | Số nguyên `2..400` |
| Bước | `1` |
| Khởi tạo authored | `70 cm` |
| Kéo 3D | sang phải tăng, sang trái giảm `2` đơn vị khoảng cách giả lập cho mỗi CSS pixel |
| Tương đương bàn phím | Thanh trượt HTML, phím mũi tên, Home/End |
| Kích thước mục tiêu HTML | Tối thiểu 44 px chiều cao, có `:focus-visible` |

Các chữ `cm` và `Echo ≈ ... µs` trong mô phỏng là **nhãn của tham số/giá trị suy ra trong JavaScript**, không phải kết quả sonar được cảm biến thật đo. Scene công khai `measuredEcho:false` để giữ ranh giới này rõ ràng.

## Định danh chính xác trong scene

`createModule(..., "ultrasonic", ...)` tạo đúng một mesh điều khiển là hộp vật cản. Cặp transducer, thân module, LED, nhãn, nền và các đối tượng Lab không nhận quyền thay đổi `distance`.

```text
kind: "ultrasonic-obstacle-target"
lessonId: 7
sourceId: "lesson-7-ultrasonic-obstacle"
physicalVerified: false
electricalAuthority: false
measuredEcho: false
```

Raycast dùng `raycaster.intersectObject(current.obstacle, false)` trên đúng mesh hiện hành và không đệ quy sang đối tượng con.

## API và quyền sở hữu

Host cấp quyền bằng:

```js
scene.setLessonUltrasonicActuation({
  enabled: true,
  lessonId: 7,
  distance: state.controls.distance,
  onDistanceChange,
});
```

Chế độ bật nhận đúng bốn trường dữ liệu. `distance` phải là số nguyên `2..400` và callback phải là hàm. API từ chối sai lesson, Lab Edit/layout đang hoạt động, WebGL context bị mất, module bị ẩn hoặc mesh không còn đúng định danh. Chế độ tắt chỉ xóa binding và gesture tạm thời; nó không tự sửa giá trị host.

Receipt được `Object.freeze()` và công khai `targetCount:1`, `physicalVerified:false`, `electricalAuthority:false`, `measuredEcho:false` khi actuator hợp lệ.

## Hành trình giữ → xem trước → thả

1. `pointerdown` thật trên đúng mesh giữ pointer, nguồn, callback và `distance` host ban đầu. Không có host write tại thời điểm này.
2. Khi vượt ngưỡng kéo, `pointermove` tính preview bằng `clamp(round(startDistance + deltaX*2), 2, 400)`. `deltaX > 0` nghĩa là kéo sang phải và tăng khoảng cách giả lập.
3. Preview chỉ di chuyển vật cản trong scene. Vị trí hiển thị dùng `x = 1.65 + ((distance-2)/398)*2.4` trong tọa độ local của module. `2.4` là **display span khái niệm**, không phải 2.4 cm hay thang đo vật lý.
4. `pointerup` ghép cả tọa độ release cuối cùng, rồi kiểm lại đúng lesson, mesh, source, callback và `distance` host gốc. Scene chỉ phát một đề nghị khi preview là số nguyên hợp lệ, gesture thực sự đã kéo và giá trị khác host.
5. Host kiểm metadata, gán giá trị cho đúng `#control-distance`, rồi gọi `onControlsInput({target:native,type:"change",source:"scene"})`. Vì vậy simulator và mọi quan sát `change-control` tiếp tục đi qua đường native hiện hữu.

Metadata callback đúng năm trường dữ liệu đóng băng:

```js
Object.freeze({
  lessonId: 7,
  source: "pointer",
  pointerType: "mouse", // hoặc "touch", "pen"
  phase: "change",
  physicalVerified: false,
});
```

Scene không gọi `connectCircuit`, `disconnectCircuit`, router điện, completion, quiz hay mastery. Learner graph vẫn chỉ thuộc `src/circuit-router.js`; preview 3D không tạo edge và không chứng minh thao tác phần cứng.

## Hủy, stale state và vòng đời

`pointercancel`, `lostpointercapture`, native range input mới, đổi lesson/stage, Run/Pause, reset, Lab Edit/layout, rollback layout, tab ẩn, mất focus, WebGL context loss, `beforeunload` hoặc dispose đều không được phát lại preview cũ. Sau khi điều kiện hợp lệ trở lại, host chỉ re-arm actuator từ `distance` native hiện hành.

Scene giữ `touch-action:none` chỉ trong thời gian một mode tương tác scene sở hữu đang bật. Canvas không chiếm phím để điều khiển vật cản; thanh trượt HTML là đường bàn phím chính thức.

## Đầu ra mô phỏng

`src/simulator.js` clamp `distance` về `2..400`, bật cảnh báo khi `d < 20`, và tính `micros = round(d*2/0.0343)` để minh họa quan hệ thời gian khứ hồi. LED/D13 chỉ sáng khi `running && alert`. Dòng serial và giá trị D8 là đầu ra mô phỏng được suy ra từ tham số đã chọn, không phải pulse Echo đo từ HC-SR04 thật và không chứng minh Sketch sửa của người học đã chạy trên AVR.

Giữ nguyên 16 bài học, 48 authored checkpoints, boundary signal-only của Lessons 10/14 và các workflow Undo/Redo hiện hữu.

## Diagnostic và QA

Canvas công khai `data-lesson-ultrasonic-mode`, `data-lesson-ultrasonic-distance`, `data-lesson-ultrasonic-preview-distance`, `data-lesson-ultrasonic-gesture`, `data-lesson-ultrasonic-target-count`, `data-lesson-ultrasonic-physical-verified`, `data-lesson-ultrasonic-electrical-authority`, `data-lesson-ultrasonic-measured-echo`. Các trường này phục vụ quan sát/QA; chúng không phải phép đo hay nguồn thẩm quyền điện.

QA cho milestone gồm source contracts, Three raycast đúng một target, mouse/touch/pen E2E, clamp biên, native keyboard, cancellation/capture, stale action, Run/Pause, lifecycle WebGL, 375 px, mục tiêu 44 px/focus và offline byte parity. Chỉ những cổng đã chạy trên SHA tương ứng mới được báo PASS.

## Nguồn tham khảo và quyền sử dụng

- **R1 — `sources/codex-howto/assets/atelier/guided`:** chỉ tham khảo cấu trúc **stages** và cách tách hành động khỏi evidence. Không sao chép giao diện, mã hoặc artwork.
- **R2 — `https://learn-arduino-red.vercel.app/`:** dùng bản trải nghiệm công khai đang chạy làm quan sát **live/canonical** cho luồng học Arduino. Việc trang chạy công khai không tạo quyền mặc nhiên để sao chép hoặc tái phân phối mã/asset.
- **R3 — `sources/learn-arduino-button-kr`:** phạm vi tham khảo hẹp ở **button interaction**; không mở rộng snapshot đó thành nguồn cho obstacle/ultrasonic và không suy diễn giấy phép asset tổng quát.
- **R4 — `sources/learn-microcontroller`:** chỉ tham khảo **UX obstacle slide** cho ý tưởng cho người học di chuyển một vật cản. Không nhập mã, mesh, hình ảnh, texture, CSS, công thức hoặc asset từ R4. Snapshot không được dùng như một blanket license; milestone này không tuyên bố có quyền tái phân phối code/asset của R4.

Hộp raycast, metadata, ánh xạ `2 đơn vị/CSS px`, display span `2.4`, stale guards và bridge về native range được biên soạn riêng cho Arduino 3D Việt Nam.

---

## English boundary summary

Lesson 07 exposes one **conceptual 3D obstacle** as an optional pointer input for the existing native `distance` range. Dragging right increases the simulated input by 2 units per CSS pixel; dragging left decreases it; values are clamped to integer `2..400`. The obstacle's display position uses a pedagogical local-X mapping and is not a physical centimeter scale.

The `cm` and derived `Echo ≈ ... µs` labels are simulator values, not sonar measurements. The target is explicitly tagged `physicalVerified:false`, `electricalAuthority:false`, and `measuredEcho:false`. A pointer gesture previews locally and commits only on a valid release through the host-owned `#control-distance` plus `onControlsInput` path. It never creates circuit edges or grants Three.js progress/electrical authority.

Lifecycle changes invalidate stale gestures, while the native HTML range remains the keyboard-accessible fallback. R1 informs staged learning structure, R2 is a live public canonical-experience observation, R3 is intentionally narrow to button interaction, and R4 informs obstacle-slide UX only. No R4 code or assets are incorporated, and no license to redistribute R4 code/assets is claimed by this document.
