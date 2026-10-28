# Lộ trình nâng cấp — v1.3.0 công khai, mã v1.4.0 và các giai đoạn tiếp theo

Chỉ ghi nhận hoàn thành những phần đã có mã nguồn và kiểm thử. Phần chưa có bằng chứng không được đánh dấu hoàn tất chỉ vì giao diện có nút cùng tên.

| Ưu tiên | Hạng mục | Tiêu chí nghiệm thu |
| --- | --- | --- |
| P0 | Rà soát nguồn và giấy phép phát hành | Danh mục license, chủ sở hữu, attribution đúng; có lựa chọn license gốc của sản phẩm |
| Đã làm v1.2, siết ranh giới v1.4 | Netlist cho 15 bài 02–16 | Hai engine có giới hạn, sample/negative test, UI nối/kéo/tháo. Bài 10/14 chỉ có signal reference và không được kích hoạt mạch tự đấu khi chưa mô hình nguồn/tải |
| Đã làm v1.2 | Biên dịch Arduino Uno thật trên GitHub | Arduino CLI 1.5.1 + AVR 1.8.6 + Servo 1.3.0; run 40628551369 đã compile 16/16 và lưu JSON |
| Đã làm v1.1 | UX mobile/keyboard cơ bản | Chrome headless ở 375/768/1024 px, menu inert/focus, không cuộn ngang; chưa thay kiểm thử screen reader |
| Đã làm v1.2 | Kiểm tra vòng đời WebGL/Three.js | On-demand RAF, keyboard, context lost/restored, dispose/remount với contract Chrome |
| Đã làm v1.3 | Public GitHub và GitHub Pages có release gate | Repo Public và site HTTPS công khai; deploy đầu tiên 40701485044 đã PASS; các lần sau vẫn thủ công, browser và compiler cùng SHA |
| Đã triển khai ứng viên v1.3 | 16 firmware HEX thực | Workflow GitHub compile bởi Arduino CLI/core/Servo đã chốt, manifest source + Sketch + HEX + flash SHA; build không chấp nhận dữ liệu lệch |
| Đã triển khai ứng viên v1.3 | AVR CPU-only trong trình duyệt | Lõi avr8js 0.21.1 có provenance và CPU opcode thật; SHA loader; chưa ghép peripheral hoặc LED thực, không biên dịch code đã sửa |
| Đã triển khai ứng viên v1.3 | Tính dòng có giới hạn | Chỉ LED bài 02/03/05: mạch phải đúng topology, áp HIGH lý tưởng 5 V, Vf/R giả định, dòng ước tính; không thay SPICE |
| Đã triển khai ứng viên v1.3 | Dây 3D theo netlist | Lớp dây khái niệm từ terminal, nets và validation thực; không nhận vơ tọa độ lỗ breadboard vật lý |
| Đã triển khai ứng viên v1.3 | Kiểm tra evidence phần cứng offline | JSON schema/provenance/EXPECTED/OBSERVED reviewer; không tự thu thập hay xác thực nguồn gốc phép đo |
| Đã triển khai trong mã v1.4; bằng chứng CI/Pages theo SHA riêng | Ngoại vi AVR tùy chọn có giới hạn | GPIO theo thanh ghi D13, Timer0 counter/overflow WGM0/3, ADC điện áp cố định nhập tay và USART0 TX; không suy đầu ra 3D, mạch điện hay phần cứng thật từ trạng thái CPU |
| Đã triển khai trong mã v1.4; bằng chứng CI/Pages theo SHA riêng | Trợ năng desktop/mobile | ARIA tab/tabpanel, roving keyboard, tên dialog, sửa độ tương phản và hợp đồng Chrome; không thay thế screen-reader/AT và kiểm chứng thiết bị thật |
| P1 | Nâng solver điện tới đúng phạm vi phần cứng cụ thể | Thử nghiệm R/Vf thực, dòng/áp/công suất/nguồn/driver và xác minh với thiết bị tham chiếu; không dùng rating tối đa như mức vận hành an toàn |
| P1 | Kiểm chứng toàn bộ Sketch và mạch với phần cứng tham chiếu | Test trên bo vật lý có môi trường an toàn, đối chiếu mã mẫu và mạch chuẩn |
| P1 | Mở rộng ngoại vi theo parity có bằng chứng | Hoàn thiện Timer1/2, output compare/PWM, USART RX, interrupt và parity `delay/millis/micros`; chỉ nối scene/đầu ra khi kết quả từ firmware thật và từng phần có negative/regression tests |
| P1 | Biên dịch Sketch tùy chỉnh | Toolchain thật có provenance, sandbox nguồn và build artifact; chưa thực hiện trong browser hoặc trên Windows hiện tại |
| P1 | QA thiết bị thật/accessibility | Screen reader, zoom 200%, pinout trên máy thật, kiểm tra WebGL context loss |
| P2 | Học liệu chuyên sâu | Sơ đồ điện chuẩn, bài thực hành nâng cao, giáo án tải xuống |
| P2 | Đồ họa linh kiện chi tiết | Pin label, 3D LOD, ảnh hưởng hiệu năng và cleanup đo được |
| P2 | Thao tác với bo vật lý | Web Serial/Arduino CLI theo cơ chế cấp phép rõ ràng, cảnh báo phần cứng |
| P2 | Tài khoản nếu cần đa thiết bị | Quyền riêng tư, tuổi học sinh, dữ liệu tối thiểu; mặc định vẫn local |
| P3 | Chuyển TypeScript/Vite | Node runtime được xác nhận, CI build, unit/E2E parity |

**Cổng v1.3 đã nghiệm thu:** Python/Chrome/offline và provenance artifact HEX, compile/E2E trên commit cuối `cc95d818…`; đã tạo tag và Draft release, Pages triển khai công khai qua workflow thủ công. **Không đăng công khai bản ZIP snapshot upstream từ Draft release** khi chưa tuyển chọn metadata/Git history và xác minh quyền phân phối.

**Bước kỹ thuật ưu tiên sau v1.4:** tăng độ đầy đủ/đúng của ngoại vi AVR và đồng hồ qua parity tests riêng; bổ sung bằng chứng phần cứng do người hướng dẫn thu thập và kiểm chứng độc lập; hoàn thiện screen reader, zoom 200% và tăng độ chính xác sơ đồ điện. Không gọi 15 topology hiện có là solver cho mạch tùy ý.
