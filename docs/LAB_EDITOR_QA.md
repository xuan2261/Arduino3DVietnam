# QA tích hợp v1.5 · Bố trí 3D, netlist và Learning Coach

Tài liệu này ghi lại các browser contract dành cho UI v1.5. Đây là QA có giới hạn cho mô hình học tập khái niệm; không phải xác nhận vị trí breadboard vật lý, điện áp/dòng, phần cứng thật hoặc tương thích mọi firmware Arduino.

## Phạm vi contract

`tests/e2e_browser.py` giữ nguyên toàn bộ regression v1.4 và bổ sung các gate v1.5 sau:

- Pure/browser module contracts:
  - Lab Layout deterministic model (`tests/lab-layout-contracts.js`), tối thiểu 27/27.
  - Learning Coach (`tests/learning-coach-contracts.js`), tất cả checks phải PASS và bao phủ đủ 16 bài.
  - Timer1 strict direct model (`tests/avr-timer1-contracts.js`) **đúng 11/11**.
- Timer1 chỉ được kiểm tra như peripheral model độc lập. Không gắn Timer1 vào bundled stock Arduino-core firmware và không tuyên bố Servo/PWM/delay/millis parity.
- Mỗi bài 01–16 được chuyển thật trên UI:
  - bài 01 không hiện editor đấu dây ngoài;
  - bài 02–16 có entry cho conceptual lab editor khi đang ở stage 3D;
  - tab `Thực hành` dựng Learning Coach tương ứng và giữ disclosure không đo/xác nhận phần cứng;
  - bài 01 nói rõ LED L tích hợp không cần dây ngoài.
- Lesson 02 editor integration:
  - mở/đóng editor qua `#labEditToggle`;
  - chọn component, nhập X/Z, nudge trên grid 0.5 và xoay 90°;
  - dùng endpoint từ `createSampleCircuit(2)` để nối qua `#labFromPin/#labToPin`;
  - sau khi chuyển sang stage 2D, `.wire-connected` phải chứa cùng endpoint, chứng minh editor dùng netlist/circuit-router hiện có thay vì một graph giả riêng.
- Lesson 10 và 14:
  - sample wires được áp từ **lab editor**;
  - status phải giữ scope signal-only;
  - chuyển sang 2D vẫn không được phép kích hoạt mạch motor/pump vì nguồn/tải chưa được mô hình.
- Mobile `375×812`:
  - mở editor không gây horizontal overflow;
  - visible lab-editor + coach interactive targets phải đạt kích thước tối thiểu contract;
  - drawer/focus regressions cũ vẫn giữ nguyên.
- Accessibility contract bổ sung:
  - names/labels cho toggle, X/Z, nudge, rotate, wire controls;
  - `#labStatus` / `#labAvrStatus` semantics;
  - boundary text “khái niệm / không vật lý” phải đọc được;
  - Learning Coach có accessible name, buttons có tên và boundary không xác nhận phần cứng;
  - contrast sampling thêm lab-editor/coach text.
- Offline dist sau Service Worker:
  - import thật `src/lab-layout.js`, `src/lab-editor-ui.js`, `src/learning-coach.js`, `src/avr-timer1.js` khi browser đang offline;
  - fetch cached `styles/lab-editor.css`;
  - Timer1 offline check chỉ xác nhận module/capability strict model, không chạy bundled firmware qua Timer1.

## Scene 3D picking/drag

Phần này chỉ được bật trong E2E sau khi `src/scene3d.js` v1.5 ổn định. Acceptance bar:

- renderer nhận `setLabLayout()` và `setLabEdit()` từ lab editor;
- lesson 16 dựng toàn bộ conceptual component groups từ layout hiện tại;
- component selection qua scene gọi đúng callback và đồng bộ `#labComponent`;
- drag component qua scene phải đi qua `onMoveComponent`/layout validation, không ghi tọa độ vật lý giả;
- terminal selection trên scene phải gọi `onTerminalSelect`; hai terminal hợp lệ tạo wire qua circuit-router và dây đó nhìn thấy trong 2D;
- không có claim breadboard-hole mapping hay electrical safety.

Nếu scene API cuối không cung cấp một cách ổn định/quan sát được để xác minh pointer picking/drag, contract phải ghi rõ SKIP/blocker thay vì mô phỏng giả hoặc dựa vào private Three.js internals không ổn định.

## Không được suy diễn từ các PASS này

- Không chứng minh vị trí 3D tương ứng với chân package/lỗ breadboard vật lý.
- Không chứng minh dây 3D có điện áp/dòng hay an toàn phần cứng.
- Learning Coach không đánh giá thao tác ngoài đời, không lưu profile học tập/account và không chạy firmware.
- Timer1 11/11 không chứng minh bundled Arduino firmware tương thích; model hiện fail-closed ngoài Normal WGM0 và không có PWM/compare/Servo parity.
- Touch-target contract là browser geometry smoke ở viewport 375px, không thay thế kiểm thử thiết bị cảm ứng vật lý.

## Trạng thái

### P1 closure — bản ứng viên 29/10/2026

Sau lượt gốc 209/209 bên dưới, đã bổ sung hồi quy thực tế cho tách mạch mẫu khỏi bản học viên, A0 giới hạn VREF 5000mV, chọn/bỏ chọn Arduino cố định trên 3D, ngưỡng cảm ứng và pointercancel, cùng việc thu hồi kích hoạt khi topology bị sửa. Lượt Chromium local mới đạt **230/230 PASS**, 0 console errors và 0 warnings ngoài dự kiến; sau đó còn các thay đổi tài liệu/backup cần QA final-SHA khi đưa lên CI. Đây không phải bằng chứng cho phần cứng thật hoặc Pages production.

### Final integrated Chrome run

Sau khi scene/lab/coach source ổn định và `dist/` byte-match source liên quan, full suite được chạy bằng một Chrome process theo policy hiện có:

- **209/209 PASS, 0 FAIL**.
- Giữ nguyên toàn bộ **167** E2E checks trước v1.5; thêm **42** gate v1.5.
- `browser_gpu_diagnostics.count = 0` trên local Chrome run này.
- `unexpected_console_warnings.count = 0`.
- `console_errors.count = 0`.
- uncaught page errors = 0.
- Browser/context/server do suite tạo đã đóng sau run.

Các direct/nested gate chính:

- `scene-3d-lab-edit-contracts`: **34/34 PASS**.
- `lab-layout-conceptual-contracts`: **27/27 PASS**.
- `learning-coach-16-lesson-contracts`: **11/11 PASS**.
- `avr-timer1-direct-model-contracts`: **11/11 PASS**, chỉ direct model; **không** claim stock-firmware parity.
- accessibility desktop nested result: **22 PASS / 0 FAIL / 2 SKIP**, không P1 blocker.

UI integration:

- `v15-lesson-01-editor-coach-switch` đến `v15-lesson-16-editor-coach-switch`: 16/16 PASS.
- Bài 01: editor dây ngoài ẩn; coach nói rõ LED L tích hợp không cần dây ngoài.
- Lesson 02:
  - toggle/editor controls PASS;
  - nudge 0.5-grid PASS;
  - X/Z direct input PASS;
  - rotate 90° PASS;
  - canonical circuit được clear và xác nhận 2D có 0 wire trước test connect;
  - một edge `D13 → R1:A` được tạo bằng circuit-router thật từ lab editor;
  - 2D nhìn thấy **đúng 1** wire đó;
  - sample được restore và 2D analyzer xác nhận valid trước khi legacy regression tiếp tục.
- Lesson 10/14: sample trong lab editor chỉ cho signal-only; 2D vẫn disable `.wire-activate` và báo nguồn/tải chưa được mô hình — PASS.

Scene pointer/drag thật trên lesson 16:

- conceptual scene: **9 component**, **22 terminal**, physical/breadboard-hole/electrical claims đều false.
- pointer select chọn `LM35`, UI `#labComponent` đồng bộ `LM35`.
- pointer drag cập nhật logical position từ `[4.0, -1.5]` sang `[5.5, -2.0]` trên 0.5-grid; netlist không đổi.
- pointer terminal pair `5V → LDR:A` tạo một wire bằng circuit-router, `data-lab-wire-count="1"`, rồi cùng edge xuất hiện trong 2D workbench.

Mobile `375px`:

- lab editor không gây horizontal overflow — PASS.
- lab editor + coach có **20** interactive target đang hiển thị; minimum width **29.2 px**, minimum height **44 px**, không target nào dưới contract `24×40`.
- drawer/focus regressions cũ vẫn PASS.

Offline dist:

- Service Worker/offline reload cũ vẫn PASS.
- Offline import/cache PASS cho `src/lab-layout.js`, `src/lab-editor-ui.js`, `src/learning-coach.js`, `src/avr-timer1.js` và `styles/lab-editor.css`.
- Offline verified firmware/peripheral regressions cũ vẫn PASS.

### Hai false-red của test harness đã sửa trước final green

1. Accessibility contrast ban đầu lấy `.avr-peripheral-state small` **sau** khi chuyển lesson 1→2 nên node đã được production xóa đúng lifecycle và ratio thành `null`. Contract được sửa để chụp ratio khi verified peripheral readout đang visible; threshold `>=4.5` và yêu cầu non-null vẫn giữ nguyên.
2. Lesson 02 editor test cố ý tạo circuit draft một-wire; nếu để nguyên, legacy electrical gate đúng cách đổi source label sang draft/incomplete. Test được cô lập bằng restore sample + xác minh 2D valid, rồi reload in-memory app state sau toàn bộ v1.5 mutation trước khi 167 legacy checks tiếp tục. Không thay đổi bất kỳ assertion an toàn/numerical cũ nào.

Không có source/index/CSS/build modification từ worker QA này; chỉ các file test/tài liệu thuộc scope được chỉnh.
