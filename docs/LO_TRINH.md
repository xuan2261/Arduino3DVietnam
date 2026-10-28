# Lộ trình nâng cấp sau bản v1.2.0

Chỉ ghi nhận hoàn thành những phần đã có mã nguồn và kiểm thử. Phần chưa có bằng chứng không được đánh dấu hoàn tất chỉ vì giao diện có nút cùng tên.

| Ưu tiên | Hạng mục | Tiêu chí nghiệm thu |
| --- | --- | --- |
| P0 | Rà soát nguồn và giấy phép phát hành | Danh mục license, chủ sở hữu, attribution đúng; có lựa chọn license gốc của sản phẩm |
| Đã làm v1.2 | Netlist cho 15 bài 02–16 | Hai engine có giới hạn, sample/negative test, bảo vệ các net không liên quan, UI nối/kéo/tháo và khóa mạch không hợp lệ |
| Đã làm v1.2 | Biên dịch Arduino Uno thật trên GitHub | Arduino CLI 1.5.1 + AVR 1.8.6 + Servo 1.3.0; run 40628551369 đã compile 16/16 và lưu JSON |
| Đã làm v1.1 | UX mobile/keyboard cơ bản | Chrome headless ở 375/768/1024 px, menu inert/focus, không cuộn ngang; chưa thay kiểm thử screen reader |
| Đã làm v1.2 | Kiểm tra vòng đời WebGL/Three.js | On-demand RAF, keyboard, context lost/restored, dispose/remount với contract Chrome |
| Đã làm v1.2 | Private GitHub, release gate | Repo Private, Pages chỉ triển khai thủ công sau khi cả browser và compile workflow PASS trên cùng Git SHA |
| P1 | Nâng netlist thành bộ tính điện học có giới hạn thực | Có định luật điện/dòng/áp/giới hạn công suất, không chỉ match sơ đồ mẫu; kiểm tra nguy cơ điện học và test với linh kiện mẫu |
| P1 | Kiểm chứng toàn bộ Sketch và mạch với phần cứng tham chiếu | Test trên bo vật lý có môi trường an toàn, đối chiếu mã mẫu và mạch chuẩn |
| P1 | Mô phỏng chương trình Arduino C++ tùy ý | Runtime AVR/WebAssembly thật, test parity với firmware, không dùng phản hồi dựng sẵn |
| P1 | QA thiết bị thật/accessibility | Screen reader, zoom 200%, pinout trên máy thật, kiểm tra WebGL context loss |
| P2 | Học liệu chuyên sâu | Sơ đồ điện chuẩn, bài thực hành nâng cao, giáo án tải xuống |
| P2 | Đồ họa linh kiện chi tiết | Pin label, 3D LOD, ảnh hưởng hiệu năng và cleanup đo được |
| P2 | Thao tác với bo vật lý | Web Serial/Arduino CLI theo cơ chế cấp phép rõ ràng, cảnh báo phần cứng |
| P2 | Tài khoản nếu cần đa thiết bị | Quyền riêng tư, tuổi học sinh, dữ liệu tối thiểu; mặc định vẫn local |
| P3 | Chuyển TypeScript/Vite | Node runtime được xác nhận, CI build, unit/E2E parity |

Đề xuất sau v1.2: chạy lại hai workflow thủ công **trên chính SHA của bản phát hành cuối**, giữ báo cáo/ảnh, sau đó đánh giá trang có nên công khai hay giữ Private. Bước kỹ thuật ưu tiên tiếp là thử nghiệm điện học bằng phần cứng thật và/hoặc một solver chính xác có dữ liệu linh kiện, thay vì coi 15 topology đã có là đủ cho mạch bất kỳ.
