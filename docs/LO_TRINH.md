# Lộ trình nâng cấp sau bản 1.0

Các mục bên dưới **chưa được triển khai**; không được đánh dấu hoàn tất chỉ vì UI có nút cùng tên.

| Ưu tiên | Hạng mục | Tiêu chí nghiệm thu |
| --- | --- | --- |
| P0 | Rà soát nguồn và giấy phép phát hành | Danh mục license, chủ sở hữu, attribution đúng; có lựa chọn license gốc của sản phẩm |
| P1 | Phân tích mạch theo netlist | Đấu dây tự do, kiểm tra kết nối sai, phân biệt nguồn/chập điện; có test âm |
| P1 | Mô phỏng Arduino C++ thực | Có compiler/runtime xác thực, kiểm tra các Sketch, không dùng log giả |
| P1 | Kiểm tra đầy đủ từng Sketch bằng Arduino CLI | Biên dịch với phiên bản core được chốt, đối chiếu chân/nguồn và driver |
| P1 | UX mobile + kiểm tra trợ năng | Kiểm tra thực ở 375/768/1440px, người dùng bàn phím, reduced motion |
| P2 | Học liệu chuyên sâu | Sơ đồ điện chuẩn, bài thực hành nâng cao, giáo án tải xuống |
| P2 | Đồ họa linh kiện chi tiết | Pin label, 3D LOD, ảnh hưởng hiệu năng và cleanup đo được |
| P2 | Thao tác với bo vật lý | Web Serial/Arduino CLI theo cơ chế cấp phép rõ ràng, cảnh báo phần cứng |
| P2 | Tài khoản nếu cần đa thiết bị | Quyền riêng tư, tuổi học sinh, dữ liệu tối thiểu; mặc định vẫn local |
| P3 | Chuyển TypeScript/Vite | Node runtime được xác nhận, CI build, unit/E2E parity |

Đề xuất trước mắt: kiểm tra giao diện và luồng học trên nhiều thiết bị, sau đó xây dựng mạch netlist có kiểm tra đúng/sai trước khi cân nhắc biên dịch C++.
