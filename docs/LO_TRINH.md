# Lộ trình nâng cấp sau bản v1.1.0

Chỉ ghi nhận hoàn thành những phần đã có mã nguồn và kiểm thử. Phần chưa có bằng chứng không được đánh dấu hoàn tất chỉ vì giao diện có nút cùng tên.

| Ưu tiên | Hạng mục | Tiêu chí nghiệm thu |
| --- | --- | --- |
| P0 | Rà soát nguồn và giấy phép phát hành | Danh mục license, chủ sở hữu, attribution đúng; có lựa chọn license gốc của sản phẩm |
| Đã làm v1.1 | Netlist cho bài 02/03/05 | 24 hợp đồng đúng/sai, UI nối/kéo/tháo và cổng khóa mạch không hợp lệ |
| Đã làm v1.1 | Xác minh compile tùy chọn | Script phát hiện Arduino CLI/Core, workflow GitHub thủ công; chưa compile thật do thiếu compiler |
| Đã làm v1.1 | UX mobile/keyboard cơ bản | Chrome headless ở 375/768/1024 px, menu inert/focus, không cuộn ngang; chưa thay kiểm thử screen reader |
| P1 | Mở rộng netlist cho 13 bài còn lại | Mỗi bài có chân kết nối riêng và test âm/dương; không gọi topology chung là SPICE |
| P1 | Biên dịch thật 16 Sketch | Arduino CLI + core đã được xác minh; chạy workflow thủ công và giữ artifact của exit code thực |
| P1 | Mô phỏng chương trình Arduino C++ tùy ý | Runtime AVR/WebAssembly thật, test parity với firmware, không dùng phản hồi dựng sẵn |
| P1 | QA thiết bị thật/accessibility | Screen reader, zoom 200%, pinout trên máy thật, kiểm tra WebGL context loss |
| P2 | Học liệu chuyên sâu | Sơ đồ điện chuẩn, bài thực hành nâng cao, giáo án tải xuống |
| P2 | Đồ họa linh kiện chi tiết | Pin label, 3D LOD, ảnh hưởng hiệu năng và cleanup đo được |
| P2 | Thao tác với bo vật lý | Web Serial/Arduino CLI theo cơ chế cấp phép rõ ràng, cảnh báo phần cứng |
| P2 | Tài khoản nếu cần đa thiết bị | Quyền riêng tư, tuổi học sinh, dữ liệu tối thiểu; mặc định vẫn local |
| P3 | Chuyển TypeScript/Vite | Node runtime được xác nhận, CI build, unit/E2E parity |

Đề xuất ngay sau v1.1: kiểm thử compile thật qua workflow thủ công ở repository thuộc quyền sở hữu người dùng, sau đó xây thêm topology cho bài cảm biến và driver. Không triển khai công khai hoặc nạp chương trình lên phần cứng khi chưa có cấu hình đích rõ ràng.
