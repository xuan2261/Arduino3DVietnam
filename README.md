# Arduino 3D Việt Nam

**Phòng thực hành Arduino Uno R3 bằng tiếng Việt**, với 16 bài học, mô hình 3D, sơ đồ chân, điều khiển tương tác, mã Arduino tham khảo và câu hỏi kiểm tra.

> **Mốc phát hành đã xác minh:** v1.4.0 từng được triển khai lên GitHub Pages tại https://xuan2261.github.io/Arduino3DVietnam/ từ commit `8992c32d270bc9858d9d601dc48b1ae98ec5173b` (Arduino C++ 16/16, Chromium 167/167, release gate và Pages cùng SHA PASS). **Ứng viên v1.5.0** mở rộng bàn bố trí/nối dây 3D, hướng dẫn từng bước và mô hình Timer1 tách biệt; **chỉ coi v1.5 là website công khai sau khi CI cùng SHA và Pages đạt, đối chiếu đúng badge 1.5 trên HTTPS**. Các mốc v1.3.0/v1.4.0 và sao lưu vẫn được giữ. **Chưa mô phỏng đầy đủ Uno, biên dịch Sketch sửa trong browser hay xác minh an toàn mạch thực.**

**Mở website:** [Arduino 3D Việt Nam](https://xuan2261.github.io/Arduino3DVietnam/) · **Mã nguồn:** [GitHub Public](https://github.com/xuan2261/Arduino3DVietnam/). Chế độ ngoại vi AVR là tùy chọn, mặc định tắt; không thay kết quả 3D và Serial Monitor của phần mô phỏng bài học.

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
| Bàn bố trí 3D tương tác (source v1.5) | Chọn/đặt/di chuyển/xoay các nhóm linh kiện theo lưới và nhấp chân để nối trên **cùng netlist của bàn 2D**; có điều khiển HTML/bàn phím/touch. Tọa độ, terminal và dây là **khái niệm**, không đại diện kích thước mm hoặc lỗ breadboard thực |
| Điều khiển bằng trượt, công tắc, phím đàn, nhấn giữ | Có |
| Tự nối dây và kiểm tra topology | **15/16 bài**, từ 02 đến 16; bài 01 dùng LED L sẵn trên bo. Trong đó **bài 10 (motor) và 14 (bơm) chỉ có sơ đồ tín hiệu tham khảo**, không cho kích hoạt mạch tự đấu vì chưa mô hình nguồn/tải; 13 bài còn lại có thể thử mạch trong mô phỏng JS khi topology hợp lệ. Không phải xác nhận hoàn chỉnh hoặc an toàn mạch vật lý |
| Tính dòng LED | **Bài 02, 03, 05**: tính dòng dựa trên topology đã xác minh, nguồn HIGH 5 V lý tưởng, Vf và điện trở giả định; không phải số đo, SPICE hay chứng nhận an toàn |
| Serial Monitor của mô phỏng bài học | Giá trị I/O minh họa từ mô phỏng JavaScript, **không phải byte USART từ firmware** |
| Arduino Sketch | Có trình xem/sửa mã, tải tệp .ino, khôi phục mẫu; **mã sửa không được chạy trong mô phỏng** |
| Kiểm tra kiến thức | Mỗi bài có câu hỏi và giải thích đáp án |
| Học từng bước (source v1.5) | Bước nhỏ/checkpoint/gợi ý dựa trên dữ liệu 16 bài và cảnh báo netlist, không tự ghi tiến độ hoàn thành hoặc suy diễn kết quả cảm biến |
| Tiến độ | LocalStorage có kiểm tra dữ liệu, xuất/nhập JSON |
| Dự phòng không có WebGL | Có bảng thông tin và chế độ sơ đồ |
| Offline | Chạy cục bộ không cần Internet; Service Worker trong bản phát hành đã được kiểm thử reload khi mạng tắt trên localhost |
| Arduino C++ compiler | GitHub Actions kiểm chứng **16/16** Sketch với toolchain thật. Máy Windows vẫn không có CLI, có thể chạy workflow GitHub thủ công hoặc cài môi trường hợp lệ riêng |
| Firmware AVR mẫu | **16/16 tệp Intel HEX thực** từ workflow GitHub `40648560140` (source SHA `8a3b672…`), có manifest SHA-256, flash hash và verifier ngoại tuyến |
| Thực thi firmware trong browser | Mặc định **CPU AVR8 opcode-only** từ avr8js 0.21.1. Chế độ thử nghiệm **bật riêng** hỗ trợ GPIO D0–D13/A0–A5 ở mức thanh ghi, Timer0 counter/overflow ở mode 0/3, ADC đầu vào cố định tự khai báo và USART0 TX 8-bit. Mô hình Timer1 v1.5 hiện chỉ **standalone Normal WGM0**; không được gắn vào Arduino-core HEX mặc định vì firmware dùng mode ngoài phạm vi. Chưa có đầy đủ PWM/Timer2/USART RX, `delay/millis/micros` parity, đầu ra phần cứng hoặc 3D do CPU điều khiển |
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
- `src/circuit-extended.js`: netlist có giới hạn cho 12 bài còn lại, gồm cảm biến, servo, driver, đàn piano, dự án tổng hợp; 10/14 chỉ xác nhận đường tín hiệu và chặn kích hoạt mạch tự đấu khi chưa có nguồn/tải.
- `src/circuit-router.js`: lớp điều phối hai engine netlist theo ID bài, không trộn kết quả hoặc nhận vơ SPICE.
- `src/wiring-workbench.js`: giao diện đấu/tháo dây, sơ đồ SVG và phản hồi lỗi.
- `src/electrical-solver.js`: phép tính dòng LED có giới hạn cho bài 02/03/05 khi mạch đúng topology.
- `src/scene3d.js`: hình học, lớp dây khái niệm từ netlist, camera và vòng đời Three.js.
- `src/lab-layout.js`, `src/lab-editor-ui.js`: source v1.5, bố trí logic tách khỏi dữ liệu điện, chọn/kéo/xoay đối tượng 3D và cập nhật cùng `circuit-router` bằng lệnh xác thực.
- `src/learning-coach.js`: luồng học từng bước/gợi ý sinh từ dữ liệu lesson và phân tích topology, không có backend/dữ liệu đo.
- `src/firmware-integrity.js`: đọc HEX cùng nguồn/manifest từ đúng origin, so SHA-256 và từ chối bản lệch.
- `src/avr-runtime.js`: CPU AVR thật từ avr8js được pin/provenance, nhận HEX đã biên dịch, **chưa có mô phỏng ngoại vi**.
- `src/avr-gpio.js`, `src/avr-timer0.js`, `src/avr-analog-serial.js`: các bộ hook thanh ghi AVR có giới hạn, giá trị input giả định do người học đặt, đồng hồ theo chu kỳ CPU, loại trừ chế độ chưa hỗ trợ.
- `src/avr-board-runner.js`: nối lõi opcode với GPIO/Timer0/ADC/USART TX cho **firmware HEX đã kiểm chứng**; đây không phải máy mô phỏng Uno toàn phần.
- `src/avr-timer1.js`: mô hình timer 16-bit WGM0/overflow riêng cho nghiên cứu; **không tích hợp** vào `avr-board-runner.js` khi Arduino core còn khởi tạo chế độ khác.
- `src/avr-panel.js`: giao diện riêng để nạp firmware mẫu, chạy **một opcode** hoặc đợt 25.000 chu kỳ, xem thanh ghi thô và khởi tạo CPU mới; thử nghiệm ngoại vi chỉ bật sau khi tự chọn, không dùng kết quả mô phỏng JS.
- `src/storage.js`: định dạng, kiểm tra và xuất/nhập tiến độ.
- `src/app.js`: giao diện, thao tác và kết nối các module.
- `styles/app.css`, `styles/wiring.css`, `styles/avr-panel.css`, `styles/lab-editor.css`: design system, responsive, bàn đấu dây, biên tập 3D và CPU panel.
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
import("/tests/avr-gpio-contracts.js").then(m => m.runAvrGpioContracts())
import("/tests/avr-timer0-contracts.js").then(m => m.runAvrTimer0Contracts())
import("/tests/avr-analog-serial-contracts.js").then(m => m.runAvrAnalogSerialContracts())
import("/tests/avr-board-contracts.js").then(m => m.runAvrBoardContracts())
import("/tests/accessibility-contracts.js").then(m => m.runAccessibilityContracts())
import("/tests/lab-layout-contracts.js").then(m => m.runLabLayoutContracts())
import("/tests/learning-coach-contracts.js").then(m => m.runLearningCoachContracts())
import("/tests/avr-timer1-contracts.js").then(m => m.runAvrTimer1Contracts())
```

E2E sử dụng **Playwright Python và Google Chrome đã cài sẵn** (không tự cài trình duyệt). Các test trong browser sử dụng module thật qua HTTP; khi không có WebGL, dữ liệu và logic vẫn có thể chạy.

Muốn biên dịch mã Arduino thật khi có công cụ trên máy:

```powershell
python scripts/verify_sketches.py --compile
```

Nếu thiếu Arduino CLI hoặc AVR core, lệnh trả mã 2, báo rõ **chưa biên dịch**. Không có chức năng upload qua USB. Xem [phân biệt ba lớp mã Arduino](docs/ARDUINO_CODE.md).

## GitHub Public và phát hành

Repository: **https://github.com/xuan2261/Arduino3DVietnam** (**Public**). Website HTTPS: **https://xuan2261.github.io/Arduino3DVietnam/**. Đẩy code lên `main` chỉ chạy kiểm tra cấu trúc và build, **không tự triển khai phiên bản mới**; GitHub Pages chỉ triển khai khi chủ repo chủ động chạy workflow thủ công sau release gate.
Để triển khai Vercel/Netlify, đặt `dist` làm output directory sau khi chạy `python scripts/build_site.py`.

Các workflow chính:

- `.github/workflows/arduino-compile-manual.yml`: cài toolchain đã chốt và biên dịch thật 16 Sketch trên runner độc lập; đã có run 16/16 PASS.
- `.github/workflows/browser-e2e-manual.yml`: Chrome/Chromium thực, WebGL, đấu dây, keyboard, tiến độ, offline, hợp đồng AVR ngoại vi/trợ năng. **v1.4.0 đã đạt 167/167 Chromium GitHub** run `40711025731`; các tính năng v1.5 cần CI riêng cùng SHA mới, không được nhận vơ kết quả v1.4.
- `.github/workflows/pages.yml`: job `deploy` chỉ chạy thủ công, sau khi `release-gates` xác minh **cả hai run phía trên đã PASS cho đúng SHA**. Không chấp nhận thành công của commit cũ.
- `.github/workflows/release-gates-manual.yml`: cho phép xác minh **chỉ đọc** hai điều kiện đó, không deploy hay thay đổi visibility website.
- `.github/workflows/firmware-hex-manual.yml`: biên dịch thủ công 16 tệp `.hex` kèm checksum/manifest, không nạp Arduino.

**Website v1.4 đã công bố** qua [Pages run `40711635913`](https://github.com/xuan2261/Arduino3DVietnam/actions/runs/40711635913): check → release-gates → package → deploy đều PASS. Đã so 61/61 tệp live HTTPS khớp byte artifact Pages. GitHub Public không đồng nghĩa đã lựa chọn giấy phép mở; các GitHub Draft Release v1.2/v1.3 chứa upstream histories không được publish, v1.4 backup được giữ Draft. Dữ liệu `releases/` không đưa vào Git/site.

## Các nguồn tham chiếu

Ba repository GitHub được lưu ở `sources/` với Git riêng, để đối chiếu và phục hồi. Thư mục này bị loại khỏi bản phát hành và repo mới để tránh đưa bundle nguồn gốc vào website. Website Learn Arduino gốc được ghi liên kết trong `docs/NGUON_GOC.md`.

Xem [hướng dẫn](docs/HUONG_DAN.md), [kiến trúc](docs/KIEN_TRUC.md), [ma trận bốn nguồn](docs/REFERENCE_GAP_MATRIX.md), [kiến trúc v1.5](docs/PRODUCT_ARCHITECTURE_V15.md), [mô hình bố trí](docs/LAB_LAYOUT.md), [bàn 3D](docs/SCENE3D_LAB.md), [hướng dẫn học](docs/LEARNING_COACH.md), [nguồn gốc](docs/NGUON_GOC.md), [netlist](docs/CIRCUIT_ENGINE.md), [engine mở rộng](docs/CIRCUIT_EXTENDED.md), [AVR CPU](docs/AVR_RUNTIME.md), [ngoại vi](docs/AVR_BOARD_LAB.md), [GPIO](docs/GPIO_RUNTIME.md), [Timer0](docs/TIMER0_RUNTIME.md), [Timer1 riêng](docs/TIMER1_RUNTIME.md), [ADC/USART TX](docs/ANALOG_SERIAL_RUNTIME.md), [dòng LED](docs/ELECTRICAL_SOLVER.md), [lớp dây 3D](docs/SCENE_WIRING.md), [bằng chứng phần cứng](docs/HARDWARE_EVIDENCE.md), [biên dịch Arduino](docs/ARDUINO_CODE.md), [QA trợ năng](docs/ACCESSIBILITY_NEXT.md), [QA Three.js](docs/SCENE3D_QA.md), [lộ trình](docs/LO_TRINH.md), [QA](docs/QA.md) và [QA phát hành](docs/QA_NEXT.md).

## Giấy phép

Three.js và avr8js được phân phối theo MIT, giữ văn bản giấy phép tương ứng tại `assets/vendor/THREE-LICENSE.txt` và `assets/vendor/avr/AVR8JS-LICENSE.txt`, kèm `assets/vendor/avr/PROVENANCE.json`. **Repository Public không đồng nghĩa toàn bộ mã được cấp giấy phép open-source hoặc quyền tái sử dụng cho bên thứ ba.** Người sở hữu chưa chọn giấy phép phát hành chung cho mã sản phẩm; quyền mặc định vẫn được bảo lưu. Việc xuất bản lại snapshot upstream cần được đánh giá riêng về quyền, provenance và attribution. Xem `THIRD-PARTY-NOTICES.md`.
