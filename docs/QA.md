# QA — Bản Arduino 3D Việt Nam

## Kết quả kiểm tra thực tế (28/10/2026)

| Gate | Quan sát | Trạng thái |
| --- | --- | --- |
| Python unittest | `python -m unittest discover -s tests -v`: 8/8 pass, exit 0 | PASS |
| Browser contracts | `runContracts()` qua browser trên localhost: 74/74 pass | PASS |
| Browser WebGL | Browser Chrome/Edge, chính URL `http://127.0.0.1:8091/`: `data-ready="3d"`, có đúng một canvas | PASS |
| Chuyển bài | Click điều hướng 1→16: 16/16 có 1 canvas, 4 câu trả lời, Sketch, tiêu đề và không fallback | PASS |
| Quiz/tiến độ | Bấm Chạy→Tạm dừng; trả lời D13 đúng, tiến độ chỉ tăng sau nút Xác nhận; JSON lưu schemaVersion=1 | PASS |
| Sơ đồ chân | Mở sơ đồ bài 01 thấy hai kết nối, trở về có canvas | PASS |
| Responsive DOM | Iframe ở 375, 768, 1024px; không scroll ngang (scrollWidth = innerWidth) | PASS dạng kiểm tra bố cục |
| Bản build | `python scripts/build_site.py` trả về exit 0 và có `dist/` | PASS |
| Bản build trên HTTP subpath | Mở `http://127.0.0.1:8091/dist/`, 16 bài, `data-ready="3d"`, đủ cả 2 tệp Three.js | PASS |
| Offline HTTPS/PWA | Code service worker được thêm, chưa kiểm thử HTTPS offline end-to-end | CHƯA XÁC MINH |
| Arduino CLI / AVR | Không có môi trường Arduino CLI và không chạy trên bo thật | CHƯA XÁC MINH |
| Đồ họa mobile thực | Chưa có ảnh/chụp DOM trực tiếp ở viewport mobile của ứng dụng chính; iframe CSS check không thay thế hoàn toàn | CHƯA XÁC MINH |

Các lỗi đã phát hiện và sửa ngay trong quá trình này: máy chủ Python mặc định trên Windows trả JavaScript với MIME `text/plain`; thiếu tệp import phụ `three.core.min.js` trong vendor; nút menu desktop cần ẩn; căn chỉnh camera 3D. Hai lỗi tải module đầu tiên đã được khắc phục trước lần kiểm thử cuối.

## Phạm vi

- Python unittest: cấu trúc tệp, import tương đối, ngôn ngữ, manifest, Three.js và MIME.
- Trình duyệt: 16 bài học, các trạng thái của 16 mô phỏng, ngưỡng, kiểm tra tiến độ.
- Giao diện: danh sách bài, 3D, nút chạy/dừng, dữ liệu hiển thị, quiz, xuất/nhập.

## Cách kiểm thử

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
```

Sau đó mở `http://127.0.0.1:8091/` trên máy chủ local và chạy trong Console:

```js
import('/tests/browser-contracts.js').then(x => x.runContracts())
```

## Giới hạn QA

Các test trên không đánh giá chính xác điện học tổng quát. Dùng Arduino Uno thật và các linh kiện phù hợp để thử các Sketch nếu mở rộng phạm vi sang điều khiển phần cứng.
Không thay thế kiểm tra bằng trình biên dịch AVR chỉ bằng syntax JavaScript/HTML.

Trạng thái cuối cùng phải dựa trên lệnh chạy/test và thời điểm kiểm tra thực tế; không dùng các nhãn PASS có sẵn để suy ra chất lượng.
