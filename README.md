# Arduino 3D Việt Nam

**Phòng thực hành Arduino Uno R3 bằng tiếng Việt**, với 16 bài học, mô hình 3D, sơ đồ chân, điều khiển tương tác, mã Arduino tham khảo và câu hỏi kiểm tra.

> **Trạng thái:** Bản học tập tương tác **v1.1.0**. Mô phỏng theo quy tắc từng bài; **không thực thi Arduino C++ trong browser**. Có thể thử biên dịch Sketch thật **chỉ khi** máy đã có Arduino CLI + AVR core, hoặc chạy workflow GitHub thủ công sau khi xuất bản repo. Không nạp chương trình lên phần cứng.

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
| Tự nối dây và kiểm tra mạch | Có cho bài **02 (LED), 03 (nút), 05 (RGB)**; giới hạn theo terminal/netlist đã khai báo, có kiểm tra chập nguồn/đảo cực/thiếu điện trở |
| Serial Monitor | Giả lập giá trị I/O của bài học |
| Arduino Sketch | Có trình xem/sửa mã, tải tệp .ino, khôi phục mẫu; **mã sửa không được chạy trong mô phỏng** |
| Kiểm tra kiến thức | Mỗi bài có câu hỏi và giải thích đáp án |
| Tiến độ | LocalStorage có kiểm tra dữ liệu, xuất/nhập JSON |
| Dự phòng không có WebGL | Có bảng thông tin và chế độ sơ đồ |
| Offline | Chạy cục bộ không cần Internet; Service Worker trong bản phát hành đã được kiểm thử reload khi mạng tắt trên localhost |
| Arduino C++ compiler | **Tùy máy**: công cụ kiểm chứng chỉ gọi CLI/core thật có sẵn; chưa có compiler trên máy kiểm thử |
| Kết nối, nạp chương trình vào Arduino vật lý | Chưa có |
| Thiết kế mạch điện tổng quát / SPICE | Chưa có. Bàn đấu dây chỉ hỗ trợ ba bài mẫu |

## Công nghệ

HTML5 + CSS tùy biến + **JavaScript ES Modules** + Three.js r180 tự lưu + máy chủ Python tiêu chuẩn.
Không cần Node, npm, khóa API, tài khoản hoặc backend.

Kiến trúc tách riêng:

- `src/lessons.js`: dữ liệu, giáo trình và bộ điều khiển cho 16 bài học.
- `src/simulator.js`: quy tắc mô phỏng thuần và xác định theo từng bài.
- `src/circuit.js`: bộ kiểm tra topology mạch 02/03/05, không phải bộ giải vật lý.
- `src/wiring-workbench.js`: giao diện đấu/tháo dây, sơ đồ SVG và phản hồi lỗi.
- `src/scene3d.js`: hình học, camera, ánh sáng và vòng đời Three.js.
- `src/storage.js`: định dạng, kiểm tra và xuất/nhập tiến độ.
- `src/app.js`: giao diện, thao tác và kết nối các module.
- `styles/app.css`, `styles/wiring.css`: design system, responsive và bàn đấu dây.
- `scripts/serve.py`: máy chủ sửa MIME JavaScript trên Windows.
- `scripts/build_site.py`: đóng gói website tĩnh vào `dist/`.
- `scripts/verify_sketches.py`: báo trạng thái compiler, có thể compile Sketch cho Uno nếu đã cài CLI/core.
- `tests/`: unittest, hợp đồng browser và Chrome E2E (nếu Playwright/Chrome có sẵn).

## Kiểm thử

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
python tests/e2e_browser.py
python scripts/verify_sketches.py
```

Để chạy test logic trong trình duyệt khi máy chủ đang hoạt động:

```javascript
import("/tests/browser-contracts.js").then(m => console.log(m.runContracts()))
import("/tests/circuit-contracts.js").then(m => console.log(m.runCircuitContracts()))
```

E2E sử dụng **Playwright Python và Google Chrome đã cài sẵn** (không tự cài trình duyệt). Các test trong browser sử dụng module thật qua HTTP; khi không có WebGL, dữ liệu và logic vẫn có thể chạy.

Muốn biên dịch mã Arduino thật khi có công cụ trên máy:

```powershell
python scripts/verify_sketches.py --compile
```

Nếu thiếu Arduino CLI hoặc AVR core, lệnh trả mã 2, báo rõ **chưa biên dịch**. Không có chức năng upload qua USB. Xem [phân biệt ba lớp mã Arduino](docs/ARDUINO_CODE.md).

## Phát hành

Workflow `.github/workflows/pages.yml` xuất bản thư mục `dist/` lên GitHub Pages sau khi CI và bản dựng thành công.
Để triển khai Vercel/Netlify, đặt `dist` làm output directory sau khi chạy `python scripts/build_site.py`.

Workflow `.github/workflows/arduino-compile-manual.yml` có thể biên dịch Sketch bằng công cụ thật trên runner GitHub **chỉ khi chủ repo chủ động chạy**. Nó chưa được kích hoạt.

**Chưa push hoặc deploy lên tài khoản GitHub của người dùng trong lần dựng này.** Bản lưu trong `releases/` được đặt tên theo phiên bản và không đè lên các gói v1.0 đã giữ.

## Các nguồn tham chiếu

Ba repository GitHub được lưu ở `sources/` với Git riêng, để đối chiếu và phục hồi. Thư mục này bị loại khỏi bản phát hành và repo mới để tránh đưa bundle nguồn gốc vào website. Website Learn Arduino gốc được ghi liên kết trong `docs/NGUON_GOC.md`.

Xem [hướng dẫn](docs/HUONG_DAN.md), [kiến trúc](docs/KIEN_TRUC.md), [nguồn gốc](docs/NGUON_GOC.md), [engine đấu dây](docs/CIRCUIT_ENGINE.md), [biên dịch Arduino](docs/ARDUINO_CODE.md), [kế hoạch nâng cấp](docs/LO_TRINH.md), [QA](docs/QA.md) và [QA bản phát hành](docs/QA_NEXT.md).

## Giấy phép

Three.js được phân phối theo MIT cùng tệp `assets/vendor/THREE-LICENSE.txt`. Mã mới do người dùng yêu cầu dựng trong workspace và các nguồn tham chiếu chưa có giấy phép phát hành riêng được người dùng lựa chọn; trước khi công bố mã nguồn tái sử dụng, hãy xác lập giấy phép phát hành mong muốn. Xem `THIRD-PARTY-NOTICES.md`.
