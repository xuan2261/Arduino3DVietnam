# Bài 15 — Nhấn FSR trực tiếp trên mô hình 3D

## Phạm vi và ranh giới bằng chứng

Bài 15 có một **đĩa FSR 3D khái niệm** để người học thử thao tác nhấn/kéo bằng chuột, cảm ứng hoặc bút. Đây chỉ là một cách nhập chỉ số ADC cho mô phỏng JavaScript hiện hữu, **không phải phép đo lực thực tế**. Đĩa FSR không tạo dây, nút điện hay trạng thái hoàn thành bài học. Mọi kết nối của người học tiếp tục thuộc `src/circuit-router.js`, không thuộc Three.js.

Đầu vào có thẩm quyền là `state.controls.force` qua `#control-force` (`input[type=range]`) do host sở hữu:

| Thuộc tính | Giá trị |
| --- | --- |
| Bài học | 15 — Cảm biến lực và lực nhấn |
| Khóa | `force` |
| Miền | Số nguyên `0..1023` |
| Bước | `1` |
| Khởi tạo authored | `300 ADC` |
| Tương đương bàn phím | Thanh trượt HTML, phím mũi tên, Home/End |
| Kích thước mục tiêu HTML | Tối thiểu 44 px chiều cao, có focus-visible |

Giá trị ADC không được đổi sang newton, gam, điện trở hay điện áp đo nếu không có hiệu chuẩn và thiết bị thật. Mô hình không khẳng định đặc tính phi tuyến của cảm biến hoặc độ nén cơ học.

## Định danh chính xác trong scene

`createModule(..., "force", ...)` gắn định danh vào **một mesh duy nhất**: đĩa hình trụ của bài 15. Nhãn FSR, LED, bảng mạch, dây và nền không nhận quyền điều khiển.

```text
kind: "fsr-press-pad"
lessonId: 15
sourceId: "lesson-15-fsr-pad"
physicalVerified: false
electricalAuthority: false
calibratedForce: false
```

Raycast dùng `raycaster.intersectObject(current.pad, false)` với đúng mesh của bài hiện tại. Không suy luận đầu vào từ tọa độ của linh kiện khác, không dùng nhãn hay hiệu ứng 3D để tạo continuity.

## API và quyền sở hữu

Host cấp quyền bằng:

```js
scene.setLessonFsrActuation({
  enabled: true,
  lessonId: 15,
  value: state.controls.force,
  onValueChange,
});
```

Đúng bốn trường dữ liệu cần được cung cấp trong chế độ bật; `value` là số nguyên từ 0 đến 1023, callback là hàm. API từ chối sai lesson, layout/editor đang hoạt động, context WebGL bị mất, đĩa sai định danh hoặc callback không hợp lệ. Chế độ tắt `scene.setLessonFsrActuation({enabled:false})` chỉ xóa binding/gesture tạm thời, không thay đổi ADC được lưu trong host.

Receipt trả về được `Object.freeze()` và công khai `physicalVerified:false`, `electricalAuthority:false`, `calibratedForce:false`.

## Hành trình nhấn → xem trước → thả

1. `pointerdown` thật trên đúng mesh giữ pointer, nguồn, callback và chỉ số ADC gốc. Đĩa **chỉ xem trước** `min(1023, start+96)`.
2. Kéo **xuống** tăng, kéo **lên** giảm `5 ADC` cho mỗi CSS pixel theo công thức khái niệm `clamp(round(start+96+(currentY-startY)*5),0,1023)`. Tốc độ +5 này do dự án biên soạn; **không phải công thức hiệu chuẩn vật lý**.
3. Trong toàn bộ preview, native slider, simulator, learner graph, history, practice/mastery và localStorage không được thay đổi. Đĩa chỉ có biến dạng rất nhẹ để cung cấp phản hồi hình ảnh, không đại diện cho độ lún có đơn vị mm.
4. Khi `pointerup` hợp lệ, scene kiểm lại đúng pointer, mesh, lesson, callback và ADC gốc; ghép cả vị trí release cuối cùng, chỉ phát tối đa một đề nghị nếu giá trị mới hợp lệ và khác giá trị host.
5. Host xác nhận metadata cố định và cập nhật `#control-force.value`, sau đó gọi `onControlsInput({target:native,type:"change",source:"scene"})`. Chỉ luồng host hiện hữu mới tạo `change-control` khi có thay đổi thật; không tự hoàn thành checkpoint.

Metadata callback đúng năm trường dữ liệu đóng băng:

```js
Object.freeze({
  lessonId: 15,
  source: "pointer",
  pointerType: "mouse", // hoặc "touch", "pen"
  phase: "change",
  physicalVerified: false,
});
```

Ngay tại `1023`, một lần nhấn có thể xem trước `1023` nhưng khi thả không có sự kiện thay đổi và không ghi nhận bằng chứng thao tác mới. Thanh trượt HTML luôn là phương án không cần WebGL và hỗ trợ bàn phím.

## Hủy, stale state và vòng đời

`pointercancel`, `lostpointercapture`, nhấn không hợp lệ, nguồn/giá trị/callback thay đổi, nhập HTML mới, đổi lesson/stage, Lab Edit/layout, ẩn tab, mất focus, đổi Run/Pause, WebGL context loss hoặc dispose đều không được phát lại preview cũ. Chỉ được cấp quyền lại nếu đúng Lesson 15 và đĩa/ngõ vào hiện hành có thật, còn hiển thị và đã khôi phục context.

Trường hợp phím Home/End ở giới hạn không làm đổi native range có thể **không phát** `input/change`; chỉ một native event thực sự được gửi tới host mới là tín hiệu thay thế thao tác đang kéo. Các kiểm thử stale action dùng một lần thay đổi giá trị thực, không giả lập sự kiện DOM.

## Đầu ra mô phỏng

`src/simulator.js` bài 15 chỉ diễn giải `force` thành chỉ số ADC 0..1023. Ngưỡng hiển thị là `raw > 650`; đầu ra LED/D13 chỉ sáng trong mô phỏng khi `running && raw > 650`. Dòng serial là chuỗi của mô phỏng JavaScript, không chứng minh đoạn Sketch sửa của người học đã được biên dịch, nạp hay chạy trên AVR thật.

Giữ nguyên 16 bài học, 48 authored checkpoints, cùng boundary Lessons 10/14 signal-only và mọi workflow Undo/Redo hiện có.

## Diagnostic và QA

Canvas công khai `data-lesson-fsr-mode`, `data-lesson-fsr-value`, `data-lesson-fsr-preview-value`, `data-lesson-fsr-gesture`, `data-lesson-fsr-pad-count`, `data-lesson-fsr-physical-verified`, `data-lesson-fsr-electrical-authority`, `data-lesson-fsr-calibrated-force`. Những trường này chỉ phục vụ kiểm thử/hiển thị, **không phải** mạch điện hay dữ liệu đo.

QA gồm source contracts, Three raycast xác định đúng đĩa, browser mouse/touch/pen thực, clamp biên, native Home/End, cancellation/capture, Run/Pause khi đang giữ, 375px/44px/focus, lifecycle WebGL và offline byte-parity. Full browser E2E và các cổng Python/Bun cần được chạy trên SHA cuối trước khi ghi PASS.

## Tài liệu tham khảo và quyền sử dụng

- R1 — `sources/codex-howto/assets/atelier/guided` chỉ cho mẫu tương tác học tập và phân tách action/evidence; không sao chép giao diện, mã hoặc artwork.
- R2 — `https://learn-arduino-red.vercel.app/` chỉ là quan sát trải nghiệm công khai; trang công khai không cấp mặc nhiên quyền tái phân phối.
- R3 — `sources/learn-arduino-button-kr` hẹp về button; snapshot không có giấy phép gốc tổng quát để dùng lại asset.
- R4 — `sources/learn-microcontroller` là nguồn họ Learn Arduino liên quan R2, có mô tả press/squeeze của FSR; snapshot không có blanket root LICENSE. Chỉ tham khảo **ý tưởng thao tác kéo xuống**, không nhập mã, asset, công thức lực–điện trở hoặc phương trình hiệu chuẩn.

Thiết kế một đĩa raycast và ánh xạ +96/+5 ADC được biên soạn riêng cho Arduino 3D Việt Nam, không phải kiểm định cơ khí, mạch hay phần cứng.
