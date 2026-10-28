# QA — Bản Arduino 3D Việt Nam

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
