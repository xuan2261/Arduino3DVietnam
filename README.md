# Arduino 3D Việt Nam

**Phòng thực hành Arduino Uno R3 bằng tiếng Việt**, với 16 bài học, mô hình 3D, sơ đồ chân, điều khiển tương tác, mã Arduino tham khảo và câu hỏi kiểm tra.

> **Trạng thái:** Bản học tập tương tác **v1.2.0**, mã nguồn trong repository **Private** của người dùng: https://github.com/xuan2261/Arduino3DVietnam. 16 Sketch đi kèm đã **biên dịch thật cho Uno R3** bằng GitHub Actions (Arduino CLI 1.5.1, AVR core 1.8.6, Servo 1.3.0). Trang web **không thực thi C++**, không nạp code xuống bo hoặc chứng nhận mạch thật an toàn.

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
| Tự nối dây và kiểm tra mạch | **15/16 bài**, từ 02 đến 16; bài 01 dùng LED L sẵn trên bo. Kiểm tra netlist hữu hạn theo từng bài, có negative tests cho chập/chéo chân/thiếu điện trở/đảo cực |
| Serial Monitor | Giả lập giá trị I/O của bài học |
| Arduino Sketch | Có trình xem/sửa mã, tải tệp .ino, khôi phục mẫu; **mã sửa không được chạy trong mô phỏng** |
| Kiểm tra kiến thức | Mỗi bài có câu hỏi và giải thích đáp án |
| Tiến độ | LocalStorage có kiểm tra dữ liệu, xuất/nhập JSON |
| Dự phòng không có WebGL | Có bảng thông tin và chế độ sơ đồ |
| Offline | Chạy cục bộ không cần Internet; Service Worker trong bản phát hành đã được kiểm thử reload khi mạng tắt trên localhost |
| Arduino C++ compiler | GitHub Actions kiểm chứng **16/16** Sketch với toolchain thật. Máy Windows vẫn không có CLI, có thể chạy workflow GitHub thủ công hoặc cài môi trường hợp lệ riêng |
| Kết nối, nạp chương trình vào Arduino vật lý | Chưa có |
| Thiết kế mạch điện tổng quát / SPICE | Chưa có. 15 bài chỉ kiểm tra *topology* đã định nghĩa; chưa tính điện áp/dòng tải và chưa xác minh an toàn nguồn/driver/motor vật lý |

## Công nghệ

HTML5 + CSS tùy biến + **JavaScript ES Modules** + Three.js r180 tự lưu + máy chủ Python tiêu chuẩn.
Không cần Node, npm, khóa API, tài khoản hoặc backend.

Kiến trúc tách riêng:

- `src/lessons.js`: dữ liệu, giáo trình và bộ điều khiển cho 16 bài học.
- `src/simulator.js`: quy tắc mô phỏng thuần và xác định theo từng bài.
- `src/circuit.js`: bộ kiểm tra topology mạch 02/03/05, không phải bộ giải vật lý.
- `src/circuit-extended.js`: netlist có giới hạn cho 12 bài còn lại, gồm cảm biến, servo, driver, đàn piano, dự án tổng hợp.
- `src/circuit-router.js`: lớp điều phối hai engine netlist theo ID bài, không trộn kết quả hoặc nhận vơ SPICE.
- `src/wiring-workbench.js`: giao diện đấu/tháo dây, sơ đồ SVG và phản hồi lỗi.
- `src/scene3d.js`: hình học, camera, ánh sáng và vòng đời Three.js.
- `src/storage.js`: định dạng, kiểm tra và xuất/nhập tiến độ.
- `src/app.js`: giao diện, thao tác và kết nối các module.
- `styles/app.css`, `styles/wiring.css`: design system, responsive và bàn đấu dây.
- `scripts/serve.py`: máy chủ sửa MIME JavaScript trên Windows.
- `scripts/build_site.py`: đóng gói website tĩnh vào `dist/`.
- `scripts/verify_sketches.py`: báo trạng thái compiler, có thể compile Sketch cho Uno nếu đã cài CLI/core.
- `scripts/verify_release_gates.py`: **cổng phát hành chỉ đọc**, kiểm chứng hai workflow Arduino compile và WebGL/Offline E2E cùng SHA trước khi GitHub Pages được phép triển khai.
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
import("/tests/extended-circuit-contracts.js").then(m => console.log(m.runExtendedCircuitContracts()))
import("/tests/scene3d-contracts.js").then(m => console.log(m.runScene3DContracts()))
```

E2E sử dụng **Playwright Python và Google Chrome đã cài sẵn** (không tự cài trình duyệt). Các test trong browser sử dụng module thật qua HTTP; khi không có WebGL, dữ liệu và logic vẫn có thể chạy.

Muốn biên dịch mã Arduino thật khi có công cụ trên máy:

```powershell
python scripts/verify_sketches.py --compile
```

Nếu thiếu Arduino CLI hoặc AVR core, lệnh trả mã 2, báo rõ **chưa biên dịch**. Không có chức năng upload qua USB. Xem [phân biệt ba lớp mã Arduino](docs/ARDUINO_CODE.md).

## GitHub Private và phát hành

Repository: **https://github.com/xuan2261/Arduino3DVietnam** (Private). Đẩy code lên `main` chỉ chạy kiểm tra cấu trúc và build, **không tự công bố website**. GitHub Pages chỉ có thể triển khai khi được chủ repo chủ động chạy workflow thủ công.
Để triển khai Vercel/Netlify, đặt `dist` làm output directory sau khi chạy `python scripts/build_site.py`.

Ba workflow:

- `.github/workflows/arduino-compile-manual.yml`: cài toolchain đã chốt và biên dịch thật 16 Sketch trên runner độc lập; đã có run 16/16 PASS.
- `.github/workflows/browser-e2e-manual.yml`: Chrome/Chromium thực, WebGL, đấu dây, keyboard, tiến độ và offline; đã có run 59/59 PASS ở v1.1.0.
- `.github/workflows/pages.yml`: job `deploy` chỉ chạy thủ công, sau khi `release-gates` xác minh **cả hai run phía trên đã PASS cho đúng SHA**. Không chấp nhận thành công của commit cũ.
- `.github/workflows/release-gates-manual.yml`: cho phép xác minh **chỉ đọc** hai điều kiện đó, không deploy hay thay đổi visibility website.

**Chưa xuất bản website công khai**. Không thay đổi visibility của repository. Các bản sao lưu v1.0/v1.1.0 được giữ nguyên, gói tiếp theo mang nhãn v1.2.0.

## Các nguồn tham chiếu

Ba repository GitHub được lưu ở `sources/` với Git riêng, để đối chiếu và phục hồi. Thư mục này bị loại khỏi bản phát hành và repo mới để tránh đưa bundle nguồn gốc vào website. Website Learn Arduino gốc được ghi liên kết trong `docs/NGUON_GOC.md`.

Xem [hướng dẫn](docs/HUONG_DAN.md), [kiến trúc](docs/KIEN_TRUC.md), [nguồn gốc](docs/NGUON_GOC.md), [engine đấu dây](docs/CIRCUIT_ENGINE.md), [engine mở rộng](docs/CIRCUIT_EXTENDED.md), [biên dịch Arduino](docs/ARDUINO_CODE.md), [QA Three.js](docs/SCENE3D_QA.md), [kế hoạch nâng cấp](docs/LO_TRINH.md), [QA](docs/QA.md) và [QA phát hành](docs/QA_NEXT.md).

## Giấy phép

Three.js được phân phối theo MIT cùng tệp `assets/vendor/THREE-LICENSE.txt`. Mã mới do người dùng yêu cầu dựng trong workspace và các nguồn tham chiếu chưa có giấy phép phát hành riêng được người dùng lựa chọn; trước khi công bố mã nguồn tái sử dụng, hãy xác lập giấy phép phát hành mong muốn. Xem `THIRD-PARTY-NOTICES.md`.
