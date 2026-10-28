# Arduino 3D Việt Nam

**Phòng thực hành Arduino Uno R3 bằng tiếng Việt**, với 16 bài học, mô hình 3D, sơ đồ chân, điều khiển tương tác, mã Arduino tham khảo và câu hỏi kiểm tra.

> **Trạng thái:** Bản học tập tương tác v1.0. Hệ thống mô phỏng các quy tắc bài học; **không biên dịch Arduino C++**, không giả mạo việc nạp chương trình và không thay thế kiểm tra mạch điện thực.

## Chạy trên Windows (không cần Node.js)

1. Mở thư mục `C:\Work\Arduino3DVietnam`.
2. Nhấp đúp **`CHAY-ARDUINO.bat`**. Yêu cầu Python 3 có sẵn.
3. Truy cập **http://127.0.0.1:8091/** bằng Chrome, Edge hoặc trình duyệt hỗ trợ WebGL.
4. Giữ cửa sổ máy chủ đang chạy. Nhấn `Ctrl+C` để kết thúc.

Có thể chạy thủ công:

```powershell
cd C:\Work\Arduino3DVietnam
python scripts/serve.py --port 8091
```

Trên macOS/Linux: `python3 scripts/serve.py --port 8091`.
Không nhấp mở trực tiếp `index.html` với `file://` vì ES Modules thường yêu cầu HTTP.

## Có những gì?

| Thành phần | Hiện trạng |
| --- | --- |
| 16 bài tiếng Việt | Có, gồm mục tiêu, lý thuyết, linh kiện, sơ đồ chân, bài tập, câu hỏi |
| Mô hình Arduino Uno | Có, dựng bằng Three.js và mô hình hình học mới |
| Mô-đun LED, button, RGB, LDR, sonar, buzzer, motor, servo, cây... | Có, biểu diễn 3D mang tính minh họa |
| Điều khiển bằng trượt, công tắc, phím đàn, nhấn giữ | Có |
| Serial Monitor | Giả lập giá trị I/O của bài học |
| Mã Arduino Sketch | Mã tham khảo; **không được thực thi bởi mô phỏng** |
| Kiểm tra kiến thức | Mỗi bài có câu hỏi và giải thích đáp án |
| Tiến độ | LocalStorage có kiểm tra dữ liệu, xuất/nhập JSON |
| Dự phòng không có WebGL | Có bảng thông tin và chế độ sơ đồ |
| Offline | Chạy từ máy cục bộ không cần Internet; bản triển khai HTTPS có Service Worker |
| Arduino C++ compiler / AVR simulator thực | Chưa có |
| Kết nối, nạp chương trình vào Arduino vật lý | Chưa có |
| Tự thiết kế mạch tự do / SPICE | Chưa có |

## Công nghệ

HTML5 + CSS tùy biến + **JavaScript ES Modules** + Three.js r180 tự lưu + máy chủ Python tiêu chuẩn.
Không cần Node, npm, khóa API, tài khoản hoặc backend.

Kiến trúc tách riêng:

- `src/lessons.js`: dữ liệu, giáo trình và bộ điều khiển cho 16 bài học.
- `src/simulator.js`: quy tắc mô phỏng thuần và xác định theo từng bài.
- `src/scene3d.js`: hình học, camera, ánh sáng và vòng đời Three.js.
- `src/storage.js`: định dạng, kiểm tra và xuất/nhập tiến độ.
- `src/app.js`: giao diện, thao tác và kết nối các module.
- `styles/app.css`: design system và responsive.
- `scripts/serve.py`: máy chủ sửa MIME JavaScript trên Windows.
- `scripts/build_site.py`: đóng gói website tĩnh vào `dist/`.
- `tests/`: kiểm tra cấu trúc và hợp đồng mô phỏng trình duyệt.

## Kiểm thử

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
```

Để chạy test logic trong trình duyệt khi máy chủ đang hoạt động:

```javascript
import("/tests/browser-contracts.js").then(m => console.log(m.runContracts()))
```

Test trong browser sử dụng module thật đã tải qua HTTP; nếu không có WebGL, phần dữ liệu và logic vẫn chạy được.

## Phát hành

Workflow `.github/workflows/pages.yml` xuất bản thư mục `dist/` lên GitHub Pages sau khi CI và bản dựng thành công.
Để triển khai Vercel/Netlify, đặt `dist` làm output directory sau khi chạy `python scripts/build_site.py`.

**Chưa push lên tài khoản GitHub của người dùng trong lần dựng này.**

## Các nguồn tham chiếu

Ba repository GitHub được lưu ở `sources/` với Git riêng, để đối chiếu và phục hồi. Thư mục này bị loại khỏi bản phát hành và repo mới để tránh đưa bundle nguồn gốc vào website. Website Learn Arduino gốc được ghi liên kết trong `docs/NGUON_GOC.md`.

Xem [hướng dẫn](docs/HUONG_DAN.md), [kiến trúc](docs/KIEN_TRUC.md), [nguồn gốc](docs/NGUON_GOC.md), [kế hoạch nâng cấp](docs/LO_TRINH.md), [QA](docs/QA.md).

## Giấy phép

Three.js được phân phối theo MIT cùng tệp `assets/vendor/THREE-LICENSE.txt`. Mã mới do người dùng yêu cầu dựng trong workspace và các nguồn tham chiếu chưa có giấy phép phát hành riêng được người dùng lựa chọn; trước khi công bố mã nguồn tái sử dụng, hãy xác lập giấy phép phát hành mong muốn. Xem `THIRD-PARTY-NOTICES.md`.
