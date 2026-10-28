# Arduino 3D Việt Nam

**Phòng thực hành Arduino Uno R3 bằng tiếng Việt**, với 16 bài học, mô hình 3D, sơ đồ chân, điều khiển tương tác, mã Arduino tham khảo và câu hỏi kiểm tra.

> **Trạng thái:** Bản phát hành kiểm chứng gần nhất **v1.2.0**, đang tích hợp **ứng viên v1.3.0** trong repository [Private](https://github.com/xuan2261/Arduino3DVietnam). Cả 16 Sketch mẫu đã được biên dịch thật cho Uno R3 bằng Arduino CLI 1.5.1, AVR core 1.8.6 và Servo 1.3.0. Website có chế độ **thực thi chỉ lệnh CPU AVR từ HEX mẫu đã biên dịch**, hoàn toàn tách biệt mô phỏng JS. Không biên dịch Sketch chỉnh sửa trong trình duyệt, không mô phỏng đầy đủ ngoại vi Arduino hay xác minh an toàn mạch thật.

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
| Mô hình Arduino Uno | Có, dựng bằng Three.js; lớp dây 3D phản ánh netlist đang hiển thị với nhãn **kết nối khái niệm**, không giả vị trí lỗ breadboard vật lý |
| Mô-đun LED, button, RGB, LDR, sonar, buzzer, motor, servo, cây... | Có, biểu diễn 3D mang tính minh họa |
| Điều khiển bằng trượt, công tắc, phím đàn, nhấn giữ | Có |
| Tự nối dây và kiểm tra mạch | **15/16 bài**, từ 02 đến 16; bài 01 dùng LED L sẵn trên bo. Kiểm tra netlist hữu hạn theo từng bài, có negative tests cho chập/chéo chân/thiếu điện trở/đảo cực |
| Tính dòng LED | **Bài 02, 03, 05**: tính dòng dựa trên topology đã xác minh, nguồn HIGH 5 V lý tưởng, Vf và điện trở giả định; không phải số đo, SPICE hay chứng nhận an toàn |
| Serial Monitor | Giả lập giá trị I/O của bài học |
| Arduino Sketch | Có trình xem/sửa mã, tải tệp .ino, khôi phục mẫu; **mã sửa không được chạy trong mô phỏng** |
| Kiểm tra kiến thức | Mỗi bài có câu hỏi và giải thích đáp án |
| Tiến độ | LocalStorage có kiểm tra dữ liệu, xuất/nhập JSON |
| Dự phòng không có WebGL | Có bảng thông tin và chế độ sơ đồ |
| Offline | Chạy cục bộ không cần Internet; Service Worker trong bản phát hành đã được kiểm thử reload khi mạng tắt trên localhost |
| Arduino C++ compiler | GitHub Actions kiểm chứng **16/16** Sketch với toolchain thật. Máy Windows vẫn không có CLI, có thể chạy workflow GitHub thủ công hoặc cài môi trường hợp lệ riêng |
| Firmware AVR mẫu | **16/16 tệp Intel HEX thực** từ workflow GitHub `40648560140` (source SHA `8a3b672…`), có manifest SHA-256, flash hash và verifier ngoại tuyến |
| Thực thi firmware trong browser | **CPU AVR8 thật** qua lõi avr8js 0.21.1; chỉ hỗ trợ bộ nhớ/lệnh CPU. Không gắn GPIO, timers, ADC, PWM, Servo, USART/Serial hoặc linh kiện ngoài; chưa cho đầu ra của scene 3D chạy theo CPU này |
| Bằng chứng phần cứng | Có validator JSON ngoại tuyến để phát hiện dữ liệu đo thiếu/sai định dạng; **chưa có phép đo trên bo thật** |
| Kết nối, nạp chương trình vào Arduino vật lý | Chưa có |
| Thiết kế mạch điện tổng quát / SPICE | Chưa có. 15 bài kiểm tra *topology* giới hạn; chỉ 3 bài LED có phép tính lý tưởng, chưa xác minh nguồn, công suất, driver, motor và phần cứng vật lý |

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
- `src/electrical-solver.js`: phép tính dòng LED có giới hạn cho bài 02/03/05 khi mạch đúng topology.
- `src/scene3d.js`: hình học, lớp dây khái niệm từ netlist, camera và vòng đời Three.js.
- `src/firmware-integrity.js`: đọc HEX cùng nguồn/manifest từ đúng origin, so SHA-256 và từ chối bản lệch.
- `src/avr-runtime.js`: CPU AVR thật từ avr8js được pin/provenance, nhận HEX đã biên dịch, **chưa có mô phỏng ngoại vi**.
- `src/avr-panel.js`: giao diện riêng để nạp firmware mẫu, chạy **một opcode** hoặc đợt 25.000 chu kỳ, xem thanh ghi thô và khởi tạo CPU mới; không dùng kết quả mô phỏng JS.
- `src/storage.js`: định dạng, kiểm tra và xuất/nhập tiến độ.
- `src/app.js`: giao diện, thao tác và kết nối các module.
- `styles/app.css`, `styles/wiring.css`, `styles/avr-panel.css`: design system, responsive, bàn đấu dây và CPU panel.
- `scripts/serve.py`: máy chủ sửa MIME JavaScript trên Windows.
- `scripts/build_site.py`: đóng gói website tĩnh vào `dist/`.
- `scripts/verify_sketches.py`: báo trạng thái compiler, có thể compile Sketch cho Uno nếu đã cài CLI/core.
- `scripts/export_firmware.py`: xuất/kiểm tra gói 16 Intel HEX thật, SHA source/sketch/flash với toolchain được pin.
- `.gitattributes`: ghim tệp Intel HEX dạng **binary** trong Git để giữ nguyên ký tự xuống dòng CRLF từ công cụ compile, bảo đảm SHA-256 không thay đổi khi checkout trên Windows/Linux.
- `scripts/validate_hardware_evidence.py`: xác minh **cấu trúc và tính nhất quán** của báo cáo đo nhập thủ công; không tương tác USB/bo mạch.
- `scripts/verify_release_gates.py`: cổng chỉ đọc cho compile/Chromium cùng commit phát hành, bổ sung provenance firmware trước khi cho phép deploy.
- `tests/`: unittest, hợp đồng browser và Chrome E2E (nếu Playwright/Chrome có sẵn).

## Kiểm thử

```powershell
python -m unittest discover -s tests -v
python scripts/build_site.py
python tests/e2e_browser.py
python scripts/verify_sketches.py
python scripts/export_firmware.py --verify assets/firmware --sha 8a3b6727638be13d674ed37d5ca2853fc6e7dcf6
```

Để chạy test logic trong trình duyệt khi máy chủ đang hoạt động:

```javascript
import("/tests/browser-contracts.js").then(m => console.log(m.runContracts()))
import("/tests/circuit-contracts.js").then(m => console.log(m.runCircuitContracts()))
import("/tests/extended-circuit-contracts.js").then(m => console.log(m.runExtendedCircuitContracts()))
import("/tests/scene3d-contracts.js").then(m => console.log(m.runScene3DContracts()))
import("/tests/firmware-integrity-contracts.js").then(m => m.runFirmwareIntegrityContracts())
import("/tests/avr-runtime-contracts.js").then(m => m.runAvrRuntimeContracts())
import("/tests/electrical-solver-contracts.js").then(m => m.runElectricalSolverContracts())
import("/tests/scene-wiring-contracts.js").then(m => m.runSceneWiringContracts())
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

Các workflow chính:

- `.github/workflows/arduino-compile-manual.yml`: cài toolchain đã chốt và biên dịch thật 16 Sketch trên runner độc lập; đã có run 16/16 PASS.
- `.github/workflows/browser-e2e-manual.yml`: Chrome/Chromium thực, WebGL, đấu dây, keyboard, tiến độ và offline; bản v1.2.0 có 108/108 trên Chromium remote, còn ứng viên v1.3.0 đạt **146/146 Chrome local** (gồm cập nhật Service Worker và kiểm chứng nguồn cảnh báo GPU bằng Chrome DevTools Protocol, có negative tests). Chromium remote phải PASS trên đúng commit phát hành mới.
- `.github/workflows/pages.yml`: job `deploy` chỉ chạy thủ công, sau khi `release-gates` xác minh **cả hai run phía trên đã PASS cho đúng SHA**. Không chấp nhận thành công của commit cũ.
- `.github/workflows/release-gates-manual.yml`: cho phép xác minh **chỉ đọc** hai điều kiện đó, không deploy hay thay đổi visibility website.
- `.github/workflows/firmware-hex-manual.yml`: biên dịch thủ công 16 tệp `.hex` kèm checksum/manifest, không nạp Arduino.

**Chưa xuất bản website công khai**. Không thay đổi visibility của repository. Các bản sao lưu v1.0/v1.1/v1.2 được giữ nguyên; chỉ tạo v1.3.0 sau khi gate mới và kiểm thử trên commit phát hành hoàn tất.

## Các nguồn tham chiếu

Ba repository GitHub được lưu ở `sources/` với Git riêng, để đối chiếu và phục hồi. Thư mục này bị loại khỏi bản phát hành và repo mới để tránh đưa bundle nguồn gốc vào website. Website Learn Arduino gốc được ghi liên kết trong `docs/NGUON_GOC.md`.

Xem [hướng dẫn](docs/HUONG_DAN.md), [kiến trúc](docs/KIEN_TRUC.md), [nguồn gốc](docs/NGUON_GOC.md), [netlist](docs/CIRCUIT_ENGINE.md), [engine mở rộng](docs/CIRCUIT_EXTENDED.md), [AVR CPU](docs/AVR_RUNTIME.md), [tính dòng LED](docs/ELECTRICAL_SOLVER.md), [lớp dây 3D](docs/SCENE_WIRING.md), [bằng chứng phần cứng](docs/HARDWARE_EVIDENCE.md), [biên dịch Arduino](docs/ARDUINO_CODE.md), [QA Three.js](docs/SCENE3D_QA.md), [lộ trình](docs/LO_TRINH.md), [QA](docs/QA.md) và [QA phát hành](docs/QA_NEXT.md).

## Giấy phép

Three.js và avr8js được phân phối theo MIT, giữ văn bản giấy phép tương ứng tại `assets/vendor/THREE-LICENSE.txt` và `assets/vendor/avr/AVR8JS-LICENSE.txt`, kèm `assets/vendor/avr/PROVENANCE.json`. Mã sản phẩm mới và nguồn tham chiếu chưa được người dùng chọn giấy phép phát hành chung; trước khi công bố mã nguồn cần quyết định rõ quyền và attribution. Xem `THIRD-PARTY-NOTICES.md`.
