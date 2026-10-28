# QA — Bản Arduino 3D Việt Nam

## Ứng viên v1.3.0 — bằng chứng mới (28/10/2026)

Phần tích hợp được kiểm chứng trên **workspace `C:\Work\Arduino3DVietnam`**, chưa được gắn nhãn phát hành v1.3.0. Không dùng những kết quả riêng lẻ dưới đây để suy luận rằng toàn bộ UI, firmware, phần cứng hoặc release gate đã nghiệm thu.

| Gate | Quan sát trực tiếp / giới hạn |
| --- | --- |
| Python unit | `python -m unittest discover -s tests -q`: **68/68 PASS** sau khi thêm export HEX, bảo toàn byte Intel HEX trên Git, hardware evidence, provenance release gate, pinning GitHub Actions và source tích hợp |
| Firmware HEX | `python scripts/export_firmware.py --verify assets/firmware --sha 8a3b6727638be13d674ed37d5ca2853fc6e7dcf6`: **16/16 Intel HEX PASS**, nguồn `src/lessons.js` và 16 Sketch SHA khớp |
| Tính toàn vẹn qua Git checkout | Bản CI đầu tiên của ứng viên trên SHA `93419da…` phát hiện Git đã chuẩn hóa CRLF trong `.hex`, khiến nguồn trên runner khác SHA dù local PASS. Đã sửa bằng `assets/firmware/*.hex binary` trong `.gitattributes`, kiểm 16 blob ở Git index byte-for-byte so với manifest, thêm regression; **cần CI chạy lại trên SHA sửa lỗi** |
| Firmware export GitHub | Workflow `40648560140` trên source commit `8a3b672…`: success; artifact có 16 HEX, toolchain Arduino CLI 1.5.1 / AVR core 1.8.6 / Servo 1.3.0 |
| AVR CPU-only | Worker đã chạy Chrome 5/5 contract CPU/HEX và firmware thật bài 01 qua 100.000 chu kỳ, thanh ghi DDRB và PORTB mang bit 5; **không** chứng minh ngoại vi GPIO/timer/Serial hoạt động |
| Electrical LED | Worker đã chạy Chrome 22/22 contract tính dòng 5 V giới hạn bài 02/03/05, có thử lỗi chập/đảo cực/thiếu điện trở; không đo mạch vật lý |
| Lớp dây 3D | Worker đã chạy Chrome 39/39 contract netlist/scene, thêm context loss/restore, không giả định vị trí lỗ breadboard |
| Hardware evidence | `tests/test_hardware_evidence.py`: 10/10 unit, chỉ kiểm tra JSON khai báo; **chưa có dữ liệu đo thật** |
| Browser E2E ứng viên v1.3.0 | **146/146 PASS** trong Chrome local, gồm opcode-step UI, 16 HEX integrity, scene 3D conceptual, electrical 02/03/05, offline dist + firmware cache và cả hai trường hợp cập nhật SW. Classifier yêu cầu mẫu GPU khớp chính xác, `argsCount=0` và **CDP `Log.entryAdded` có nguồn rendering/deprecation** tương ứng; cả cảnh báo giả SwiftShader và ReadPixels với hậu tố từ trang được chứng minh vẫn bị chặn qua `Runtime.consoleAPICalled`. `console.error`, mọi warning JS khác và `pageerror` vẫn làm CI đỏ. Chrome local: 0 page errors, 0 warnings, 0 GPU diagnostics; Chromium remote cần xác minh trên SHA cuối mới |
| Ubuntu Chromium GPU diagnostics | Các run `40652458700` (`b313b53…`) và `40653289043` (`73abef9…`) chặn 2 cảnh báo SwiftShader và 2 thông báo ReadPixels; Playwright báo URL trang, dòng/cột 0/0. Run `40654235209` (`bffd347…`) đã xác thực nguồn CDP cho các cảnh báo đó nhưng còn từ chối đúng một biến thể ReadPixels với hậu tố ` (this message will no longer repeat)`. Bộ regex mới cho phép đúng hậu tố này **chỉ khi có chứng cứ CDP**; không bật SwiftShader kém an toàn. Gate chỉ được ghi PASS nếu run mới thành công thật |
| Release provenance | Kiểm tra artifact HEX so với bản build + workflow exact-SHA là điều kiện bắt buộc trước tag/draft/deploy; **chưa tuyên bố gate mới PASS** |

## Bản v1.2.0 — bằng chứng kiểm thử

Các số liệu này không bao gồm kiểm chứng bo mạch vật lý và không cho phép kết luận ứng dụng tương đương SPICE.

| Gate | Bằng chứng |
| --- | --- |
| Python unit/release/Arduino verifier | **34/34 PASS** trên Windows sau khi tích hợp các engine và release-gate |
| Mô phỏng bài học | **74/74** hợp đồng trạng thái |
| Base netlist 02/03/05 | Kiểm tra đúng/sai chặn chập, bypass LED, nối tắt liên vùng và các chân Arduino |
| Extended netlist 04/06–16 | Kiểm tra topology của 12 bài; 15/16 bài có đấu dây tương tác (01 dùng LED tích hợp) |
| Three.js r180 | **25/25** hợp đồng lifecycle, focus/keyboard, context lost/restored, dispose/remount |
| Chrome E2E trong workspace | **108/108 PASS** lần chạy tích hợp trước khi chốt docs; đủ 16 bài, 15 sơ đồ, tải .ino, PWA offline và responsive |
| Arduino Uno C++ thật trên GitHub | **16/16 PASS**, run 40628551369, Arduino CLI 1.5.1 + AVR 1.8.6 + Servo 1.3.0, trên SHA của bước trước |
| Chromium E2E trên GitHub | **59/59 PASS**, run 40628249442, trên SHA v1.1.0 |
| Release gate | Tests xác nhận chặn workflow thiếu, lỗi, stale, khác SHA; Pages chỉ deploy thủ công sau hai run PASS cùng SHA |
| Dòng điện, nguồn, motor, cảm biến thực | **Chưa kiểm chứng**: giới hạn về dòng, điện áp, công suất, driver và phần cứng cụ thể |

Không được lấy 16/16 compile hoặc 59/59 remote E2E ở SHA cũ để tuyên bố bản v1.2.0 đã phát hành an toàn. Trước khi xuất bản website phải chạy lại cả hai workflow **trên cùng SHA cuối**.

## Kết quả kiểm tra thực tế (28/10/2026) — v1.0 và v1.1

| Gate | Quan sát | Trạng thái |
| --- | --- | --- |
| Python unittest v1.0 | `python -m unittest discover -s tests -v`: 8/8 pass, exit 0 | PASS lịch sử |
| Python unittest v1.1 | Cấu trúc + compiler verifier + release/PWA: 22/22 pass | PASS |
| Browser contracts | `runContracts()` qua browser trên localhost: 74/74 pass | PASS |
| Circuit contracts | `runCircuitContracts()` trong Chrome: 24/24 pass, hỗ trợ bài 02/03/05 | PASS |
| Browser WebGL | Browser Chrome/Edge, chính URL `http://127.0.0.1:8091/`: `data-ready="3d"`, có đúng một canvas | PASS |
| Chuyển bài | Click điều hướng 1→16: 16/16 có 1 canvas, 4 câu trả lời, Sketch, tiêu đề và không fallback | PASS |
| Quiz/tiến độ | Bấm Chạy→Tạm dừng; trả lời D13 đúng, tiến độ chỉ tăng sau nút Xác nhận; JSON lưu schemaVersion=1 | PASS |
| Sơ đồ chân | Mở sơ đồ bài 01 thấy hai kết nối, trở về có canvas | PASS |
| Responsive DOM | Iframe ở 375, 768, 1024px; không scroll ngang (scrollWidth = innerWidth) | PASS dạng kiểm tra bố cục |
| Bản build | `python scripts/build_site.py` trả về exit 0 và có `dist/` | PASS |
| Bản build trên HTTP subpath | Mở `http://127.0.0.1:8091/dist/`, 16 bài, `data-ready="3d"`, đủ cả 2 tệp Three.js | PASS |
| Offline/PWA localhost | Chrome được SW điều khiển, tắt mạng, tải lại bản dist thành công | PASS (localhost) |
| Offline HTTPS sản phẩm công khai | Chưa có hostname phát hành, cần xác minh thực tế | CHƯA XÁC MINH |
| Arduino CLI / AVR | Không có môi trường Arduino CLI và không chạy trên bo thật | CHƯA XÁC MINH |
| Chrome E2E v1.1 | **59/59 pass**: 16/16 bài, mô phỏng, code editor/download, wiring click/drag/preset/short, quiz, menu/focus, offline, 375/768/1024 | PASS tại localhost |
| Screen reader và thiết bị mobile thật | Chưa kiểm tra bằng thiết bị và AT thực | CHƯA XÁC MINH |

Các lỗi đã phát hiện và sửa ngay trong quá trình này: máy chủ Python mặc định trên Windows trả JavaScript với MIME `text/plain`; thiếu tệp import phụ `three.core.min.js` trong vendor; nút menu desktop cần ẩn; căn chỉnh camera 3D. Hai lỗi tải module đầu tiên đã được khắc phục trước lần kiểm thử cuối.

## Phạm vi

- Python unittest: cấu trúc tệp, import tương đối, ngôn ngữ, manifest, Three.js và MIME.
- Trình duyệt: 16 bài học, các trạng thái của 16 mô phỏng, ngưỡng, kiểm tra tiến độ.
- Giao diện: danh sách bài, 3D, nút chạy/dừng, dữ liệu hiển thị, quiz, xuất/nhập.

## Cách kiểm thử

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
python tests/e2e_browser.py
python scripts/verify_sketches.py
```

Sau đó mở `http://127.0.0.1:8091/` trên máy chủ local và chạy trong Console:

```js
import('/tests/browser-contracts.js').then(x => x.runContracts())
import('/tests/circuit-contracts.js').then(x => x.runCircuitContracts())
```

## Giới hạn QA

Các test trên không đánh giá chính xác điện học tổng quát. Dùng Arduino Uno thật và các linh kiện phù hợp để thử các Sketch nếu mở rộng phạm vi sang điều khiển phần cứng.
Không thay thế kiểm tra bằng trình biên dịch AVR chỉ bằng syntax JavaScript/HTML.

Trạng thái cuối cùng phải dựa trên lệnh chạy/test và thời điểm kiểm tra thực tế; không dùng các nhãn PASS có sẵn để suy ra chất lượng.

Xem thêm `docs/QA_NEXT.md` về content-addressed PWA, Pages project-subpath và các gate phát hành trực tuyến. E2E v1.1 có thêm kiểm thử hành vi kết nối chân thủ công, kéo/thả và mạch đã đầy đủ nhưng có nối tắt nguồn; `analysis.ok` được dùng để chặn việc chọn mạch nguy hiểm.

Ảnh QA thật được tạo dưới thư mục `screenshots/` (bị loại khỏi Git/bundle website): `qa-v1.1-desktop.png`, `qa-v1.1-wiring.png` và `qa-v1.1-mobile-375.png`. Ở 375 px đã chỉnh camera để bo Arduino và breadboard nằm trọn trong khung thay vì bị cắt ở cạnh trái. Các ảnh này là bằng chứng hình thức giao diện, không thay thế kiểm tra điện học hay screen reader.
