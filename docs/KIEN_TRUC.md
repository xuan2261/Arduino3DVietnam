# Kiến trúc Arduino 3D Việt Nam — 28/10/2026

## Mục tiêu

Làm mới sản phẩm với nội dung tiếng Việt là nguồn chính; không phụ thuộc bundle JavaScript minified của trang tham chiếu. Chạy trên máy Windows không cần Node và có thể triển khai lên hosting tĩnh.

## Sơ đồ mô-đun

```text
index.html + styles/app.css + styles/wiring.css
                       |
                       v
                   src/app.js
                 /   |    |    \
                v    v    v     v
        lessons.js  circuit-router.js  storage.js
               |          |                |
          simulator.js     +-- circuit.js  Tiến độ
               |          +-- circuit-extended.js
               |          |
               |   wiring-workbench.js
               v
           snapshot ────> scene3d.js ────> Three.js r180
```

**Phân tách quan trọng:**

- Nội dung bài học và danh sách linh kiện thuộc `lessons.js`.
- Quy tắc HIGH/LOW, ADC, PWM, số bước, ngưỡng và điều kiện thuộc `simulator.js` (không phụ thuộc WebGL).
- `circuit.js` kiểm tra bài 02/03/05; `circuit-extended.js` xử lý 12 bài 04,06–16; `circuit-router.js` định tuyến hai engine theo lesson ID và xác minh mạch mẫu. UI SVG, chọn/kéo/tháo dây thuộc `wiring-workbench.js`. Toàn bộ là topology theo **15 sơ đồ có terminal cố định**, không phải bộ giải điện học/SPICE.
- Màu LED, vị trí servo, hình học mô-đun chỉ là biểu diễn của snapshot ở `scene3d.js`.
- Giao diện, tương tác, quiz và serial log thuộc `app.js`.
- Tiến độ thuộc `storage.js`, không được suy ra từ việc người dùng xem bài hay bấm Chạy.

## Hợp đồng mô phỏng

`simulate(lessonId, controls, elapsedMs, running, memory)` là hàm thuần trả về:
`led`, `brightness`, `rgb`, `angle`, `toneHz`, `motorSpeed`, `pump`, `value`, `status`, `serial`, `pins`, `kind`.

Những đầu ra này **không phải kết quả thực thi Sketch Arduino C++**. Chúng do mã JavaScript định nghĩa từ kiến thức điện tử; thay đổi Sketch văn bản sẽ không làm thay đổi mô phỏng. Đồng hồ chỉ tiến khi đang chạy; mỗi kết quả được xác định từ đầu vào và thời gian ảo. Chế độ nút nhấn kiểu toggle dùng nhớ cạnh nhấn và chống dội 30 ms.

Trong 15 bài có netlist, nhấn **Thử mạch vừa đấu** chỉ được cho phép khi `analysis.ok && analysis.functional`. Các guard chặn những dây tắt giữa các chân Arduino, đường tín hiệu bị kéo cố định về rail, bypass LED/điện trở, và nối chung hai phần mạch không nằm trên cùng net tham chiếu. Đầu vào mô phỏng tiếp tục đến từ các điều khiển bài mẫu, **không** phải kết quả giải dòng điện theo netlist; nếu netlist trở nên sai, mô phỏng dừng/chặn. Bài 01 dùng LED L tích hợp.

Trình chỉnh sửa Sketch giữ draft trong bộ nhớ của tab, cung cấp bản tải .ino; **không eval/biên dịch** mã vừa nhập. Công cụ máy tính `scripts/verify_sketches.py` chỉ biên dịch source Sketch cho Arduino Uno khi Arduino CLI/core thực sự tồn tại và khi người dùng gọi `--compile`.

## Thiết kế giao diện

Register: Product. Scene: học sinh/sinh viên và người mới bắt đầu trên laptop lớp học hoặc điện thoại. Direction: giao diện phòng thí nghiệm trực quan, ít yếu tố trang trí để nhường chỗ cho mô hình và kiến thức. Color: nền sáng ngả xanh, sidebar xanh đậm, điểm nhấn xanh ngọc, màu cam cho chân/đầu ra. Type: system UI và Consolas cho mã. Signature: bo Arduino 3D cạnh bảng hướng dẫn và các điều khiển được đặt ngay dưới mô hình. Motion: có chủ đích, không auto loop khi cảnh 3D đứng yên.

## Trợ năng

- Toàn bộ thông tin bài học có nội dung văn bản.
- Điều khiển HTML rõ label, hỗ trợ bàn phím; radio quiz có phản hồi trạng thái bằng văn bản.
- Canvas 3D có fallback và hướng dẫn; `prefers-reduced-motion` được tôn trọng trong CSS.
- Màn hình nhỏ sử dụng drawer danh sách bài học, các cột chuyển thành thẻ dọc.
- Không yêu cầu mật khẩu hoặc nhận dạng trẻ em.

## Chất lượng và giới hạn

- Renderer Three.js được tạo trễ, xử lý mất/khôi phục WebGL context, giải phóng geometry/material, ngắt observers/listeners sau dispose; chỉ yêu cầu frame khi cần vẽ. Bộ contract scene3d kiểm tra lifecycle bằng `WEBGL_lose_context`.
- Mô phỏng giới hạn trong các quy tắc bài; netlist hữu hạn cho 15 bài, không có bộ giải điện tổng quát (SPICE) hoặc kết nối USB. Arduino CLI chỉ là lựa chọn compile trên máy đã cài sẵn và không nằm trong runtime website; GitHub CI đã compile 16 Sketch cùng phiên bản được chốt.
- Các Sketch là tham khảo cho bo thực; trước khi đưa vào môi trường học thực tế, cần đối chiếu sơ đồ điện và thông số từng thiết bị.
- Không dùng mật khẩu lưu localStorage. Tiến độ JSON phải qua kiểm tra phiên bản, danh sách ID, giới hạn số lượng.

## Hướng mở rộng

1. Chuyển qua TypeScript + Vite khi Node được cài và có nhu cầu quản lý package.
2. Tách data lessons thành các tệp `vi/*.json` có schema và kiểm tra ngữ nghĩa.
3. Thay mô hình linh kiện hình học bằng mô hình chi tiết có provenance, LOD và asset budget.
4. Bổ sung runtime AVR/WASM và toolchain C++ thực nếu được cấp quyền triển khai; không thay thế mô phỏng bằng phản hồi giả.
5. Nếu cần mô phỏng mạch bất kỳ, xây solver điện học với netlist, định luật điện, SPICE-like validation, dữ liệu thực và bảo vệ an toàn; không mở rộng giả định từ 15 topology hiện tại rồi gọi đó là solver.
