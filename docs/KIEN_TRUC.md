# Kiến trúc Arduino 3D Việt Nam — 28/10/2026

## Mục tiêu

Làm mới sản phẩm với nội dung tiếng Việt là nguồn chính; không phụ thuộc bundle JavaScript minified của trang tham chiếu. Chạy trên máy Windows không cần Node và có thể triển khai lên hosting tĩnh.

## Sơ đồ mô-đun

```text
index.html + styles/app.css
             |
             v
         src/app.js
        /    |      \
       v     v       v
 lessons.js simulator.js storage.js
       |       |
       +--- snapshots ---> scene3d.js ---> Three.js r180 (MIT)
```

**Phân tách quan trọng:**

- Nội dung bài học và danh sách linh kiện thuộc `lessons.js`.
- Quy tắc HIGH/LOW, ADC, PWM, số bước, ngưỡng và điều kiện thuộc `simulator.js` (không phụ thuộc WebGL).
- Màu LED, vị trí servo, hình học mô-đun chỉ là biểu diễn của snapshot ở `scene3d.js`.
- Giao diện, tương tác, quiz và serial log thuộc `app.js`.
- Tiến độ thuộc `storage.js`, không được suy ra từ việc người dùng xem bài hay bấm Chạy.

## Hợp đồng mô phỏng

`simulate(lessonId, controls, elapsedMs, running, memory)` là hàm thuần trả về:
`led`, `brightness`, `rgb`, `angle`, `toneHz`, `motorSpeed`, `pump`, `value`, `status`, `serial`, `pins`, `kind`.

Những đầu ra này **không phải kết quả thực thi Sketch Arduino C++**. Chúng do mã JavaScript định nghĩa từ kiến thức điện tử; thay đổi Sketch văn bản sẽ không làm thay đổi mô phỏng. Đồng hồ chỉ tiến khi đang chạy; mỗi kết quả được xác định từ đầu vào và thời gian ảo. Chế độ nút nhấn kiểu toggle dùng nhớ cạnh nhấn và chống dội 30 ms.

## Thiết kế giao diện

Register: Product. Scene: học sinh/sinh viên và người mới bắt đầu trên laptop lớp học hoặc điện thoại. Direction: giao diện phòng thí nghiệm trực quan, ít yếu tố trang trí để nhường chỗ cho mô hình và kiến thức. Color: nền sáng ngả xanh, sidebar xanh đậm, điểm nhấn xanh ngọc, màu cam cho chân/đầu ra. Type: system UI và Consolas cho mã. Signature: bo Arduino 3D cạnh bảng hướng dẫn và các điều khiển được đặt ngay dưới mô hình. Motion: có chủ đích, không auto loop khi cảnh 3D đứng yên.

## Trợ năng

- Toàn bộ thông tin bài học có nội dung văn bản.
- Điều khiển HTML rõ label, hỗ trợ bàn phím; radio quiz có phản hồi trạng thái bằng văn bản.
- Canvas 3D có fallback và hướng dẫn; `prefers-reduced-motion` được tôn trọng trong CSS.
- Màn hình nhỏ sử dụng drawer danh sách bài học, các cột chuyển thành thẻ dọc.
- Không yêu cầu mật khẩu hoặc nhận dạng trẻ em.

## Chất lượng và giới hạn

- Renderer Three.js được tạo trễ, giải phóng geometry/material, ngắt observers/listeners sau dispose; chỉ yêu cầu frame khi cần vẽ.
- Mô phỏng giới hạn trong các quy tắc bài; không có bộ giải mạch điện tổng quát (SPICE), không kết nối USB hay Arduino CLI.
- Các Sketch là tham khảo cho bo thực; trước khi đưa vào môi trường học thực tế, cần đối chiếu sơ đồ điện và thông số từng thiết bị.
- Không dùng mật khẩu lưu localStorage. Tiến độ JSON phải qua kiểm tra phiên bản, danh sách ID, giới hạn số lượng.

## Hướng mở rộng

1. Chuyển qua TypeScript + Vite khi Node được cài và có nhu cầu quản lý package.
2. Tách data lessons thành các tệp `vi/*.json` có schema và kiểm tra ngữ nghĩa.
3. Thay mô hình linh kiện hình học bằng mô hình chi tiết có provenance, LOD và asset budget.
4. Bổ sung simulator AVR/WASM và toolchain C++ thực, **không** thay thế mô phỏng bằng phản hồi giả.
5. Thêm scene wiring có netlist/định luật điện cơ bản và chống chập điện.
