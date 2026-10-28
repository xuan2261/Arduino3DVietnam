# Kiến trúc Arduino 3D Việt Nam — 28/10/2026

## Mục tiêu

Làm mới sản phẩm với nội dung tiếng Việt là nguồn chính; không phụ thuộc bundle JavaScript minified của trang tham chiếu. Chạy trên máy Windows không cần Node và có thể triển khai lên hosting tĩnh.

## Sơ đồ mô-đun

```text
index.html + styles/*.css
          |
          v
      src/app.js  -----------------------> storage.js (tiến độ)
       |    |  \
       |    |   +--> avr-panel.js --> firmware-integrity.js (SHA-256)
       |    |                          |                  |
       |    |                     16 Intel HEX      src/lessons.js
       |    |                          |
       |    |                     avr-runtime.js --> avr8js CPU 0.21.1
       |    |                     (chỉ CPU, không có GPIO/timer/Serial)
       |    |
       |    +--> circuit-router.js --> circuit.js / circuit-extended.js
       |               |       \
       |               |        +--> electrical-solver.js (chỉ bài 02/03/05)
       |               +--> wiring-workbench.js (2D SVG)
       |               +--> scene3d.js (dây netlist 3D khái niệm)
       |
       +--> lessons.js --> simulator.js (logic minh họa JS)
                             |
                             +--> snapshot --> scene3d.js --> Three.js r180

Lõi AVR KHÔNG nối đầu ra điều khiển ngoại vi vào snapshot của JS simulator.
```

**Phân tách quan trọng:**

- Nội dung bài học và danh sách linh kiện thuộc `lessons.js`.
- Quy tắc HIGH/LOW, ADC, PWM, số bước, ngưỡng và điều kiện thuộc `simulator.js` (không phụ thuộc WebGL).
- `circuit.js` kiểm tra bài 02/03/05; `circuit-extended.js` xử lý 12 bài 04,06–16; `circuit-router.js` định tuyến hai engine theo lesson ID và xác minh mạch mẫu. UI SVG, chọn/kéo/tháo dây thuộc `wiring-workbench.js`. Toàn bộ là topology theo **15 sơ đồ có terminal cố định**, không phải bộ giải điện học/SPICE.
- `electrical-solver.js` chỉ tính dòng LED trong 3 bài 02/03/05 sau khi kiểm tra topology đạt; giả định HIGH 5 V, Vf không đổi và điện trở lý tưởng, không tính điện học cho 12 bài còn lại.
- Màu LED, vị trí servo, hình học mô-đun là biểu diễn của snapshot JS ở `scene3d.js`. Dây 3D lấy từ netlist và terminal metadata đã kiểm tra, nhưng được gắn nhãn **khái niệm**: không thể suy ra vị trí lỗ breadboard, dây thực, dòng hoặc áp từ hình minh họa.
- `firmware-integrity.js` tải gói từ cùng origin và so SHA source/HEX; `avr-panel.js` chỉ nạp sau khi xác minh và gọi lõi avr8js đã lưu tại `assets/vendor/avr/`. `src/avr-runtime.js` thực thi opcode và truy xuất SRAM/thanh ghi thô nhưng chưa khởi tạo mô hình ngoại vi ATmega328P.
- `scripts/export_firmware.py` tạo/kiểm tra 16 HEX bằng toolchain Arduino CLI được pin trên GitHub Actions, không có trình biên dịch Arduino C++ trong trang. `scripts/validate_hardware_evidence.py` kiểm tra JSON báo cáo ngoại tuyến, không tự đo thiết bị.
- Giao diện, tương tác, quiz và serial log thuộc `app.js`.
- Tiến độ thuộc `storage.js`, không được suy ra từ việc người dùng xem bài hay bấm Chạy.

## Hợp đồng mô phỏng

`simulate(lessonId, controls, elapsedMs, running, memory)` là hàm thuần trả về:
`led`, `brightness`, `rgb`, `angle`, `toneHz`, `motorSpeed`, `pump`, `value`, `status`, `serial`, `pins`, `kind`.

Những đầu ra này **không phải kết quả thực thi Sketch Arduino C++**. Chúng do mã JavaScript định nghĩa từ kiến thức điện tử; thay đổi Sketch văn bản sẽ không làm thay đổi mô phỏng. Đồng hồ chỉ tiến khi đang chạy; mỗi kết quả được xác định từ đầu vào và thời gian ảo. Chế độ nút nhấn kiểu toggle dùng nhớ cạnh nhấn và chống dội 30 ms.

Trong 15 bài có netlist, nhấn **Thử mạch vừa đấu** chỉ được cho phép khi `analysis.ok && analysis.functional`. Các guard chặn những dây tắt giữa các chân Arduino, đường tín hiệu bị kéo cố định về rail, bypass LED/điện trở, và nối chung hai phần mạch không nằm trên cùng net tham chiếu. Đầu vào mô phỏng tiếp tục đến từ các điều khiển bài mẫu, **không** phải kết quả giải dòng điện theo netlist; nếu netlist trở nên sai, mô phỏng dừng/chặn. Bài 01 dùng LED L tích hợp.

Trình chỉnh sửa Sketch giữ draft trong bộ nhớ của tab, cung cấp bản tải .ino; **không eval/biên dịch** mã vừa nhập. Công cụ máy tính `scripts/verify_sketches.py` chỉ biên dịch source Sketch cho Arduino Uno khi Arduino CLI/core thực sự tồn tại và khi người dùng gọi `--compile`.

## Ba lớp thực thi và bằng chứng (không nhập nhằng)

| Lớp | Nguồn / tính năng | Đầu ra có thể tin cậy trong phạm vi nào? |
| --- | --- | --- |
| Minh họa JS | `simulate()` | Tính đúng các quy tắc sư phạm đã viết; không phải chạy firmware |
| CPU AVR thực | HEX đã biên dịch, xác minh SHA-256, avr8js CPU | Lệnh AVR, PC, chu kỳ và dữ liệu bộ nhớ; **không** suy diễn LED ngoài, millis/delay/PWM/timer/Serial |
| Mạch/bằng chứng | topology + solver 5 V giới hạn + JSON reviewer | Chặn các lỗi topology định nghĩa sẵn, dòng LED *ước tính*, dữ liệu khai báo nhất quán; **không** phải phép đo hay chứng nhận thiết bị |

Mọi kết quả hiển thị phải nhận diện rõ nguồn. Lớp dây 3D nhận trực tiếp netlist hiện đang soạn; khi mạch chưa kích hoạt, nó là bản nháp và không điều khiển mô phỏng JS. Không cho phép phần mềm tự suy luận rằng thanh ghi DDRB/PORTB thô đồng nghĩa mô hình LED 3D đã mô phỏng tín hiệu điện tử thật.

**Nâng cấp PWA giữa phiên:** khi Service Worker lần đầu giành quyền điều khiển tab chưa có controller **hoặc** thay thế controller đã có, `app.js` chủ động khóa AVR panel, hủy thao tác nạp đang chờ và hiển thị yêu cầu tải lại trang (không tự reload vì code draft có thể chưa được lưu). Cả chuyển tiếp `null → controller` lẫn `controller cũ → controller mới` đều được xem là ranh giới phiên bản không an toàn cho nạp HEX. Điều này chặn tình trạng module bài học cũ còn trong bộ nhớ nhưng manifest/HEX mới đã được service worker đưa vào cache.

## Thiết kế giao diện

Register: Product. Scene: học sinh/sinh viên và người mới bắt đầu trên laptop lớp học hoặc điện thoại. Direction: giao diện phòng thí nghiệm trực quan, ít yếu tố trang trí để nhường chỗ cho mô hình và kiến thức. Color: nền sáng ngả xanh, sidebar xanh đậm, điểm nhấn xanh ngọc, màu cam cho chân/đầu ra. Type: system UI và Consolas cho mã. Signature: bo Arduino 3D cạnh bảng hướng dẫn và các điều khiển được đặt ngay dưới mô hình. Motion: có chủ đích, không auto loop khi cảnh 3D đứng yên.

## Trợ năng

- Toàn bộ thông tin bài học có nội dung văn bản.
- Điều khiển HTML rõ label, hỗ trợ bàn phím; radio quiz có phản hồi trạng thái bằng văn bản.
- Canvas 3D có fallback và hướng dẫn; `prefers-reduced-motion` được tôn trọng trong CSS.
- Màn hình nhỏ sử dụng drawer danh sách bài học, các cột chuyển thành thẻ dọc.
- Không yêu cầu mật khẩu hoặc nhận dạng trẻ em.

## Chất lượng và giới hạn

- Renderer Three.js được tạo trễ, xử lý mất/khôi phục WebGL context, giải phóng geometry/material, ngắt observers/listeners sau dispose; chỉ yêu cầu frame khi cần vẽ. Bộ contract scene3d kiểm tra lifecycle bằng `WEBGL_lose_context`.
- Mô phỏng JS giới hạn trong quy tắc bài; netlist hữu hạn cho 15 bài, tính dòng LED lý tưởng cho 3 bài, không có bộ giải SPICE tổng quát hoặc kết nối USB. AVR CPU vận hành opcode thật nhưng chưa có ngoại vi, nên việc nạp HEX 16 bài không đồng nghĩa tái hiện đầy đủ 16 chương trình Arduino.
- Các Sketch là tham khảo cho bo thực; trước khi đưa vào môi trường học thực tế, cần đối chiếu sơ đồ điện và thông số từng thiết bị.
- Không dùng mật khẩu lưu localStorage. Tiến độ JSON phải qua kiểm tra phiên bản, danh sách ID, giới hạn số lượng.

## Hướng mở rộng

1. Chuyển qua TypeScript + Vite khi Node được cài và có nhu cầu quản lý package.
2. Tách data lessons thành các tệp `vi/*.json` có schema và kiểm tra ngữ nghĩa.
3. Thay mô hình linh kiện hình học bằng mô hình chi tiết có provenance, LOD và asset budget.
4. Mở rộng runtime AVR CPU hiện có bằng ngoại vi có kiểm thử độc lập (GPIO, clock/timer, ADC, Serial, sau đó Servo/PWM), ghép trạng thái vật lý vào scene **chỉ sau parity tests**. Việc biên dịch C++ trong browser là phạm vi riêng và chưa được triển khai.
5. Nếu cần mô phỏng mạch bất kỳ, xây solver điện học với netlist, định luật điện, SPICE-like validation, dữ liệu thực và bảo vệ an toàn; không mở rộng giả định từ 15 topology hiện tại rồi gọi đó là solver.
