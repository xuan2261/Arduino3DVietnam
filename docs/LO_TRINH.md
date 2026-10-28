# Lộ trình nâng cấp — ứng viên v1.3.0 và các giai đoạn tiếp theo

Chỉ ghi nhận hoàn thành những phần đã có mã nguồn và kiểm thử. Phần chưa có bằng chứng không được đánh dấu hoàn tất chỉ vì giao diện có nút cùng tên.

| Ưu tiên | Hạng mục | Tiêu chí nghiệm thu |
| --- | --- | --- |
| P0 | Rà soát nguồn và giấy phép phát hành | Danh mục license, chủ sở hữu, attribution đúng; có lựa chọn license gốc của sản phẩm |
| Đã làm v1.2 | Netlist cho 15 bài 02–16 | Hai engine có giới hạn, sample/negative test, bảo vệ các net không liên quan, UI nối/kéo/tháo và khóa mạch không hợp lệ |
| Đã làm v1.2 | Biên dịch Arduino Uno thật trên GitHub | Arduino CLI 1.5.1 + AVR 1.8.6 + Servo 1.3.0; run 40628551369 đã compile 16/16 và lưu JSON |
| Đã làm v1.1 | UX mobile/keyboard cơ bản | Chrome headless ở 375/768/1024 px, menu inert/focus, không cuộn ngang; chưa thay kiểm thử screen reader |
| Đã làm v1.2 | Kiểm tra vòng đời WebGL/Three.js | On-demand RAF, keyboard, context lost/restored, dispose/remount với contract Chrome |
| Đã làm v1.2 | Private GitHub, release gate | Repo Private, Pages chỉ triển khai thủ công sau khi cả browser và compile workflow PASS trên cùng Git SHA |
| Đã triển khai ứng viên v1.3 | 16 firmware HEX thực | Workflow GitHub compile bởi Arduino CLI/core/Servo đã chốt, manifest source + Sketch + HEX + flash SHA; build không chấp nhận dữ liệu lệch |
| Đã triển khai ứng viên v1.3 | AVR CPU-only trong trình duyệt | Lõi avr8js 0.21.1 có provenance và CPU opcode thật; SHA loader; chưa ghép peripheral hoặc LED thực, không biên dịch code đã sửa |
| Đã triển khai ứng viên v1.3 | Tính dòng có giới hạn | Chỉ LED bài 02/03/05: mạch phải đúng topology, áp HIGH lý tưởng 5 V, Vf/R giả định, dòng ước tính; không thay SPICE |
| Đã triển khai ứng viên v1.3 | Dây 3D theo netlist | Lớp dây khái niệm từ terminal, nets và validation thực; không nhận vơ tọa độ lỗ breadboard vật lý |
| Đã triển khai ứng viên v1.3 | Kiểm tra evidence phần cứng offline | JSON schema/provenance/EXPECTED/OBSERVED reviewer; không tự thu thập hay xác thực nguồn gốc phép đo |
| P1 | Nâng solver điện tới đúng phạm vi phần cứng cụ thể | Thử nghiệm R/Vf thực, dòng/áp/công suất/nguồn/driver và xác minh với thiết bị tham chiếu; không dùng rating tối đa như mức vận hành an toàn |
| P1 | Kiểm chứng toàn bộ Sketch và mạch với phần cứng tham chiếu | Test trên bo vật lý có môi trường an toàn, đối chiếu mã mẫu và mạch chuẩn |
| P1 | Bổ sung peripheral vào CPU AVR thật | Từng bước GPIO/Timer/ADC/USART, clock/delay/PWM/Serial, parity test và liên kết scene output từ peripheral; không sử dụng phản hồi dựng sẵn |
| P1 | Biên dịch Sketch tùy chỉnh | Toolchain thật có provenance, sandbox nguồn và build artifact; chưa thực hiện trong browser hoặc trên Windows hiện tại |
| P1 | QA thiết bị thật/accessibility | Screen reader, zoom 200%, pinout trên máy thật, kiểm tra WebGL context loss |
| P2 | Học liệu chuyên sâu | Sơ đồ điện chuẩn, bài thực hành nâng cao, giáo án tải xuống |
| P2 | Đồ họa linh kiện chi tiết | Pin label, 3D LOD, ảnh hưởng hiệu năng và cleanup đo được |
| P2 | Thao tác với bo vật lý | Web Serial/Arduino CLI theo cơ chế cấp phép rõ ràng, cảnh báo phần cứng |
| P2 | Tài khoản nếu cần đa thiết bị | Quyền riêng tư, tuổi học sinh, dữ liệu tối thiểu; mặc định vẫn local |
| P3 | Chuyển TypeScript/Vite | Node runtime được xác nhận, CI build, unit/E2E parity |

**Cổng trước v1.3:** chạy Python/Chrome/offline và xác minh đóng gói/nguồn gốc artifact HEX; biên dịch Arduino và Chromium E2E phải PASS trên cùng SHA cuối; chỉ tag/draft private release khi bằng chứng đạt. GitHub Pages vẫn không tự được công bố.

**Bước kỹ thuật ưu tiên sau v1.3:** ghép mô hình GPIO/timer thực với CPU AVR theo hợp đồng kiểm thử, bổ sung số đo phần cứng do người hướng dẫn thu thập và kiểm chứng độc lập, hoàn thiện mobile/screen reader và tăng độ chính xác vật lý của sơ đồ. Không gọi 15 topology hiện có là solver cho mạch tùy ý.
