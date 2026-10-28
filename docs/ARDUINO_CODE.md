# Arduino C++: mô phỏng, biên dịch và phần cứng

Website hiện có ba lớp khác nhau. Cần hiển thị đúng lớp để người học không nhầm một mô phỏng với việc chạy mã thật.

| Lớp | Trạng thái | Ý nghĩa |
| --- | --- | --- |
| Mô phỏng trong trình duyệt | Có | `src/simulator.js` tính các trạng thái LED, ADC, PWM, servo... bằng quy tắc JavaScript. Sketch C++ không được thực thi. |
| Biên dịch Arduino C++ | Tùy máy | `scripts/verify_sketches.py --compile` chỉ gọi `arduino-cli` và Arduino AVR core đã tồn tại trên máy. |
| Arduino vật lý | Không hỗ trợ | Không mở cổng serial/USB, không chạy `upload`, không nạp firmware và không điều khiển bo thật. |

## Kiểm tra compiler hiện có

Không cần và cũng không được cài thêm gì để chạy kiểm tra trạng thái:

```powershell
cd C:\Work\Arduino3DVietnam
python scripts/verify_sketches.py
python scripts/verify_sketches.py --json
```

Script chỉ tìm `arduino-cli` trên `PATH` và các vị trí cài Arduino IDE phổ biến. Nó không quét toàn bộ ổ đĩa, không tải package index, không chạy `core update-index`, `core install` hay `lib install`.

Khi `arduino-cli` và core `arduino:avr` đã có sẵn, có thể biên dịch thật 16 Sketch:

```powershell
python scripts/verify_sketches.py --compile
python scripts/verify_sketches.py --compile --lesson 2 --lesson 12
python scripts/verify_sketches.py --compile --json
```

Board được cố định ở `arduino:avr:uno`. Đầu vào chỉ là 16 Sketch được đóng gói trong `src/lessons.js`; CLI không nhận đường dẫn Sketch tùy ý. Mỗi Sketch được chép vào thư mục tạm riêng và chỉ chạy lệnh `arduino-cli compile` với timeout 45 giây. Thư mục tạm bị xóa sau mỗi lần kiểm tra.

Mã thoát:

- `0`: chế độ trạng thái chạy được, hoặc mọi Sketch được yêu cầu đã compile thành công.
- `1`: nguồn bài học không hợp lệ hoặc có ít nhất một compile thất bại.
- `2`: người dùng yêu cầu `--compile` nhưng `arduino-cli`/Arduino AVR core chưa sẵn sàng.

JSON có `schema_version: 1`, `capabilities.simulation`, `capabilities.compile`, `capabilities.hardware`, thông tin compiler và kết quả từng bài. UI có thể dùng trực tiếp các trường này; không nên suy luận “compile thành công” từ việc mô phỏng đang chạy.

## Tình trạng compiler trên máy kiểm tra ngày 28/10/2026

Trong lần kiểm tra này không tìm thấy `arduino-cli`, `avr-gcc` hay `avr-g++` trên `PATH`. Các vị trí cài Arduino IDE phổ biến dưới `Program Files\Arduino IDE` và `%LOCALAPPDATA%\Programs\Arduino IDE` cũng không có. Vì vậy chưa có bằng chứng compile AVR thật trên máy này, và script phải báo `compile: unavailable`.

Nếu sau này Arduino CLI đã được cài hợp lệ từ trước, chạy lại lệnh trạng thái ở trên sẽ tự phát hiện. Script không tự cài compiler hoặc core.

## Kiểm thử biên dịch trên GitHub Actions khi chủ repository chủ động chạy

Tệp `.github/workflows/arduino-compile-manual.yml` là **workflow thủ công duy nhất** (chỉ có `workflow_dispatch`).
Nó không tự động tải/cài compiler vào máy Windows và không chạy khi đẩy code. Chỉ khi người quản trị vào GitHub Actions và chọn **Run workflow**, runner GitHub tạm thời mới dùng action chính thức `arduino/setup-arduino-cli@v2.0.0`, Arduino CLI **1.5.1**, core `arduino:avr@1.8.6` để thử compile tất cả 16 Sketch cho `arduino:avr:uno`; không upload/flash phần cứng. Kết quả được lưu dưới dạng artifact JSON. Chưa có run và chưa thể tuyên bố đạt compile ở thời điểm tạo workflow.

## Review 16 Sketch hiện tại

Review này kiểm tra logic mẫu, mối quan hệ với sơ đồ dây và các rủi ro điện học dễ thấy. Nó không thay thế datasheet, tính toán dòng nguồn hay thử nghiệm trên mạch thật.

| Bài | Nhận xét |
| --- | --- |
| 01 | Hợp lý cho bài nhập môn: LED tích hợp D13 được đặt OUTPUT và giữ HIGH. |
| 02 | Blink đúng: D13 OUTPUT, HIGH/LOW và hai khoảng `delay(INTERVAL)`. LED rời đã có nhắc điện trở hạn dòng. |
| 03 | Logic chế độ giữ nút đúng với điện trở kéo xuống 10 kΩ. Sketch không triển khai chế độ toggle; nội dung đã nói toggle thuộc mô phỏng. |
| 04 | ADC 0–1023 ánh xạ PWM 0–255 đúng trên Uno; D9 là chân PWM. |
| 05 | Ba kênh PWM D9/D10/D11 phù hợp LED RGB cathode chung; cần ba điện trở riêng như nội dung đã ghi. |
| 06 | Với sơ đồ 5V → LDR → A0 → 10 kΩ → GND, ánh sáng yếu làm điện áp A0 giảm, nên điều kiện `light < 400` phù hợp. Ngưỡng thực tế vẫn cần hiệu chuẩn. |
| 07 | Trig 10 µs, `pulseIn` có timeout và phép tính `duration * 0.0343 / 2` hợp lý. Điều kiện kiểm tra `duration` tránh coi timeout là vật cản 0 cm. |
| 08 | `tone()/noTone()` đúng cho buzzer thụ động/piezo phù hợp. Với loại cần dòng lớn hơn giới hạn I/O phải dùng mạch driver theo datasheet. |
| 09 | Đã đồng bộ mã mẫu với bàn đàn: bảy nút INPUT_PULLUP D2–D8 về GND, buzzer thụ động ở D9. Sketch đọc từng nút và phát nốt tương ứng; cần thử trên bo thật khi toolchain có sẵn. |
| 10 | Điều khiển cầu H hợp lý: D9 PWM cho ENA, D7/D8 chọn chiều. Mẫu cố định chiều thuận và PWM 160; nguồn động cơ/driver vẫn phải theo phần cứng thật. |
| 11 | Công thức LM35 đúng khi ADC tham chiếu 5 V như tiêu đề Sketch giả định. Nếu thay reference/board thì công thức phải đổi. |
| 12 | Logic Servo hợp lý nhưng compile phụ thuộc thư viện `Servo.h` đã có trong môi trường Arduino. Servo thực cần nguồn đủ dòng và GND chung. |
| 13 | Đã chỉnh phát đúng một lượt 50 xung trong setup(), loop() không phát thêm xung. Đây là lượng quay tương đối 90° với 200 bước/vòng, không phải đặt vị trí tuyệt đối qua phản hồi cảm biến. |
| 14 | Sketch ghi rõ giả định ADC tăng theo độ ẩm. Hướng ADC của cảm biến thực phải được hiệu chuẩn; hệ tưới thật nên có hysteresis/thời gian nghỉ như nội dung đã cảnh báo. |
| 15 | Dùng raw ADC và ngưỡng 650 là hợp lý cho ví dụ; không đổi thẳng sang Newton vì FSR phi tuyến. Với sơ đồ FSR phía 5 V, lực tăng thường làm raw tăng. |
| 16 | Logic cảm biến và cảnh báo tách độc lập hợp lý. Wiring hiện đã ghi rõ `INPUT_PULLUP`: nút đóng D2 xuống GND, LED có điện trở 220 Ω và LDR/LM35 có đường nguồn/mass tương ứng. |

Hai điểm lệch bài 09 và 13 đã được chỉnh trong nguồn v1.1. Những Sketch còn lại là ví dụ mẫu và chưa được compiler AVR thật xác nhận trong môi trường hiện tại. Không được suy luận compile thành công từ việc công cụ trích xuất đủ 16 Sketch.

## Contract gợi ý cho UI

UI chỉ cần ba nhãn trạng thái:

- **Mô phỏng:** “Đang mô phỏng quy tắc bài học — không chạy Sketch C++.”
- **Biên dịch C++:** lấy từ `capabilities.compile.state`. Nếu `unavailable`, hiển thị `compiler.reason`; nếu compile thật, hiển thị kết quả từng bài.
- **Phần cứng:** “Chưa kết nối/nạp Arduino thật.”

Không đổi nhãn “Mô phỏng” thành “Chạy code”, và không dùng một lần compile thành công để khẳng định mạch điện thật sẽ an toàn hoặc hoạt động đúng.
