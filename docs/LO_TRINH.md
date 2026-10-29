# Lộ trình nâng cấp — v1.6.0 đã công bố, ứng viên hậu v1.6 và các giai đoạn tiếp theo

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
| Đã công bố v1.5, QA cùng SHA | Bố trí 3D và cùng netlist 2D | Linh kiện theo layout logic, chọn/kéo/đặt/xoay, nối terminal 3D với circuit-router, phản hồi topology và negative E2E; **không** mô phỏng lỗ breadboard vật lý |
| Đã công bố v1.5 | Hướng dẫn 16 bài theo từng bước | Checkpoint/hint từ lesson data + wiring issues, không giả số đo hoặc tự đánh dấu hoàn thành |
| Đã có standalone v1.5 | Timer1 WGM0 Normal giới hạn | Test TCNT1/overflow/internal prescaler/interrupt, **không** gắn vào Arduino-core firmware stock vì khởi tạo WGM1 không được hỗ trợ |
| Đã công bố v1.6, CI/Pages cùng SHA | Lab Explorer và thao tác chung 3D/2D | Inspector terminal/issue metadata, schematic đọc từ learner netlist + reference overlay có nhãn read-only, minimap/focus camera logic, đồng bộ lựa chọn và điều khiển HTML/keyboard; không tạo authority mạch thứ hai |
| Đã công bố v1.6, CI/Pages cùng SHA | Hình học Uno/breadboard và mobile LOD | Nâng hình học, nhãn nhóm pin, nhận biết linh kiện, tài nguyên Three.js dùng lại, LOD nhỏ/phục hồi WebGL; mọi hole-like mesh vẫn conceptual |
| Đã công bố v1.6, CI/Pages cùng SHA | Breadboard profiled topology | Dải 5 lỗ, khe cách điện, rail BB830 riêng; mặc định unknown rail; **không** khẳng định chân linh kiện đã được map vào lỗ từ scene |
| Đã công bố v1.6, standalone | Timer2 WGM0 Normal | TCNT2/prescaler/overflow/interrupt, browser contract + real HEX fails closed khi Arduino core chuyển WGM1; không gắn runner mặc định/PWM/Servo parity |
| Đã công bố v1.6, mô hình toán học độc lập | Solver DC điện trở tuyến tính với nguồn/nút khai báo rõ | Kiểm tra floating/singular/node caps/giới hạn dòng-công suất cấu hình, đơn vị V/Ω/mA/mW; giao diện chia áp 2 điện trở; không nối mô phỏng 16 bài/không nhận là số đo |
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

**Mốc v1.5 công khai đã xác minh:** SHA `7828efaa267007f189b0d2f891fff1d323637940`, compiler 16/16, GitHub Chromium 230/230, Pages run `40771559128` (check/gate/package/deploy PASS), HTTPS 70/70 SHA byte parity, backup `releases/v1.5.0-20261029`.

**Mốc v1.6 công khai đã xác minh 29/10/2026:** SHA `341449b12d50c681be3f04d6e291965bf6015d99`, GitHub compiler run `40797254441`, Chromium 289/289 run `40797258542`, preflight run `40797462604`, Pages run `40797526796` đều PASS trên cùng SHA. Artifact package/Pages/local có 84/84 byte parity, HTTPS production có 83/83 asset parity; live Chrome xác nhận đủ 16 bài, WebGL, offline reload và mobile375. Annotated tag v1.6.0 và backup `releases/v1.6.0-20261029` đã tạo; GitHub Release giữ Draft do chưa chọn root LICENSE. **Những cải tiến sau tag v1.6 phải triển khai ở nhánh riêng, không viết lại lịch sử tag/backup/production.**

**Ứng viên hậu v1.6 chưa phát hành:** `feature/post-v16-practice-evidence` bổ sung đối chiếu cạnh mạch bản thảo theo từng bước cho 16 bài, trình bày thiếu/sai topology và hỗ trợ điều hướng tới bàn 2D; chỉ là so sánh sample-edge deterministic với dữ liệu `circuit-router`. Đây không phải bằng chứng học viên tự lắp, hoàn thành quiz, số đo hay sơ đồ vật lý. Yêu cầu QA/CI/release gate SHA riêng nếu quyết định phát hành sau này.

**Bước ưu tiên sau v1.6:** xác minh vị trí chân và lỗ breadboard vật lý bằng datasheet/configured board-specific placement và bằng chứng phần cứng trước khi gọi là true breadboard mapping; thực hiện bài thực hành có nguồn/tải motor-bơm riêng; mở rộng Timer1/2 WGM/PWM và USART RX chỉ khi có real-HEX parity tests; kiểm thử screen reader/zoom 200% và hardware evidence bằng phép đo độc lập. Không gọi 15 topology hiện có là SPICE hay bộ giải mạch bất kỳ.
