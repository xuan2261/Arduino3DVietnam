# Hướng dẫn sử dụng Arduino 3D Việt Nam

## 1. Mở ứng dụng

Trên Windows: chạy `CHAY-ARDUINO.bat`, sau đó mở `http://127.0.0.1:8091/`. Trên macOS/Linux dùng `python3 scripts/serve.py --port 8091`.

## 2. Học từng bài

1. Chọn bài 01–16 ở danh sách bên trái. Có thể tìm theo tên hoặc chủ đề.
2. Đọc **Tổng quan**, mở **Chân nối** để xem bảng kết nối, chọn **Thực hành** để xem các bước.
3. Trong **Mô hình 3D**, kéo chuột để xoay. Dùng nút **+**, **−**, **⌖** để chỉnh góc nhìn. Có thể dùng các phím mũi tên sau khi chọn khung 3D.
4. Chọn thông số hoặc nhấn nút ở vùng **Thử nghiệm**, rồi bấm **Chạy mô phỏng**.
5. Quan sát kết quả, Serial Monitor giả lập và mã Arduino tham khảo. Trong bài LED nhấp nháy, mô phỏng cần chạy để thời gian tiến triển.
6. Trả lời câu hỏi ở cuối trang. Sau khi đúng, bấm **Xác nhận hoàn thành** để lưu tiến độ.

## 3. Hai chế độ nút nhấn

Bài 03 có **Giữ nút** (LED chỉ sáng khi giữ) và **Bật/tắt** (mỗi lần nhấn hợp lệ đảo trạng thái). Khi dùng màn hình cảm ứng, giữ ngón tay trên nút trong lúc thí nghiệm; dùng bàn phím có thể giữ phím Space sau khi focus vào nút.

## 4. Tự nối dây điện (bài 02–16)

1. Chọn bất kỳ bài nào từ **02 đến 16**, rồi mở tab **Sơ đồ kết nối**. Bài 01 dùng LED L tích hợp, không cần đấu dây ngoài.
2. Nhấp **hai chân** liên tiếp để tạo dây, hoặc kéo chuột từ một chân sang chân khác.
3. Nhấn **Mạch mẫu** để xem một mạch đúng, **Gỡ** để tháo một dây, **Xóa dây** để xóa toàn bộ.
4. Theo dõi cảnh báo: đấu trực tiếp sai chân, nối tắt nguồn, đảo cực LED, thiếu điện trở hoặc sai đường tín hiệu sẽ bị kiểm tra theo topology được định nghĩa cho từng bài.
5. Với **13 bài có mô hình mạch đủ phạm vi topology**, chỉ khi bộ kiểm tra báo hợp lệ mới có thể nhấn **Thử mạch vừa đấu**. Lúc này nút **Chạy mô phỏng** kiểm tra cả tính hợp lệ của netlist lẫn quy tắc mô phỏng bài mẫu. Tháo dây khiến mạch sai sẽ dừng và **thu hồi kích hoạt mạch tự đấu**; sau khi sửa đúng, người học phải nhấn **Thử mạch vừa đấu** lần nữa để dùng lại mạch đó. Hệ thống không coi thao tác cảm ứng bị hủy hoặc từ ngón tay khác là một dây đã nối. **Bài 10 (motor) và 14 (bơm)** chỉ có sơ đồ dây tín hiệu/GND tham khảo: không thể kích hoạt mạch tự đấu vì chưa mô hình nguồn cấp, đường tải và phần công suất. Nút Chạy mô phỏng của bài vẫn là **minh họa JavaScript độc lập**, không phải chứng minh động cơ/bơm chạy qua dây đã nối.

Phạm vi là **15 mô hình netlist hữu hạn**, không phải một bộ giải điện học hoặc SPICE. Đặc biệt các bài động cơ/bơm chỉ xác minh phần đường tín hiệu/nguồn đã định nghĩa, **không xác minh dòng tải, bộ điều khiển công suất hoặc tính an toàn toàn mạch thực**. Bài servo minh họa nguồn riêng phù hợp và GND chung, không mặc định chân Arduino 5V có thể cấp dòng cho servo.

### Kết nối khái niệm trên mô hình 3D

Sau khi nhấn **Mạch mẫu** hoặc tự nối dây trong tab **Sơ đồ kết nối**, quay lại **Mô hình 3D** để xem lớp đường nối dựa trên netlist thực sự của bài. Đây là đồ họa giải thích **những terminal nối với nhau**, không phải vị trí lỗ cắm breadboard, bản vẽ lắp ráp mạch thật hay kết quả dòng/áp. Nếu một số terminal không thể ánh xạ rõ ràng, mô hình bỏ qua thay vì vẽ dây giả và báo số kết nối bị lược bỏ.

### Bố trí, xoay và đấu dây 3D (source v1.5)

1. Chọn bài 02–16, mở **Mô hình 3D** và bấm **Bố trí và nối dây 3D**. Bài 01 chỉ có LED onboard nên không hiển thị bàn đấu dây ngoài. Chế độ chỉnh được bật riêng để không nhầm thao tác xoay camera với kéo linh kiện.
2. Chọn linh kiện trên mô hình hoặc ở danh sách **Linh kiện đang chọn**. Có thể kéo linh kiện bằng chuột/chạm, dùng tọa độ **X/Z**, bốn nút mũi tên hoặc phím `W/A/S/D` khi canvas có focus. Dùng **↶/↷ 90°** hoặc `Q/E` trên canvas để xoay. Arduino Uno cố định; các vị trí nằm trong lưới logic và được giới hạn để tránh chồng lấn.
3. Chọn hai chân trên mô hình hoặc dùng danh sách **Chân thứ nhất/Chân thứ hai** và **Nối hai chân**. Dây sẽ đi qua cùng bộ phân tích topology của **Sơ đồ kết nối**: nối sai/chập/thiếu đường chức năng được thông báo, không được “vẽ cho đúng” bất chấp bộ phân tích. **Mạch mẫu**, **Gỡ dây cuối**, **Xóa dây** hoạt động trên cùng bản mạch đang chỉnh.
4. Chuyển sang **Sơ đồ kết nối** để xem các dây đã chỉnh trong 3D, rồi quay lại 3D. Chọn tab **Thực hành** để xem các checkpoint/hint nhỏ dựa trên dữ liệu bài học và nhận phản hồi topology hiện tại. Bước hướng dẫn không thay việc làm quiz và **Xác nhận hoàn thành**.

Mô hình hiển thị chân trên **chu vi khái niệm của nhóm linh kiện**, không có tương quan chính xác tới vị trí chân IC hay lỗ breadboard. Không dùng trạng thái 3D làm hướng dẫn lắp mạch thật nếu chưa đối chiếu pinout/datasheet. Bài 10 motor và 14 bơm vẫn chỉ có đường tín hiệu tham khảo, không thể coi nguồn/tải đã được kiểm chứng. Đây là chức năng bổ sung của v1.5; phiên bản công khai chỉ được xác nhận sau các cổng CI và kiểm tra thực tế trên GitHub Pages.

### Lab Explorer v1.6: Inspector · Schematic · Minimap

Trong source v1.6, mỗi bài có phần **Khám phá linh kiện và kết nối** với ba bề mặt đọc cùng dữ liệu bài học:

1. **Inspector:** chọn một component từ minimap hoặc mô hình 3D để xem ID, nhãn, các chân và cảnh báo topology. Vị trí X/Z là lưới khái niệm. Arduino Uno cố định; component nào chưa có vị trí mapping vật lý vẫn được ghi rõ.
2. **Schematic:** SVG và danh sách dây tương đương bằng HTML được xây dựng từ **netlist bản tự đấu**. Bài chưa có dây vẫn là 0 dây, dù có mạch mẫu. Bấm **Xem mạch mẫu tham khảo** để bật lớp dây đứt nét riêng biệt, chỉ để đọc và không được dùng tính điểm, kích hoạt hoặc gỡ dây của học viên. Khi bật chỉnh sửa 3D, lệnh nối/gỡ trong schematic đều đi qua `circuit-router` và cập nhật cùng bàn đấu dây 2D và cảnh 3D.
3. **Minimap / plan view:** hiển thị vị trí tương đối của các component/terminal từ lab-layout. Chọn component và gọi focus để hướng camera vào vùng khái niệm; các phím Enter/Space và danh sách HTML cho phép thao tác khi không dùng được chuột chính xác. Focus chỉ đổi góc nhìn, không tự tạo dây hay quyết định tính đúng của mạch.

Ở bài 01 không có netlist ngoài. Bài 10/14 có thể xem schematic đường tín hiệu nhưng tiếp tục **không kích hoạt** nguồn/tải motor/bơm. Bản tự đấu, mạch mẫu, mô phỏng giáo dục JavaScript và bằng chứng thanh ghi AVR là những nguồn khác nhau.

### Học nhóm lỗ breadboard theo profile (source v1.6)

Phần **Khám phá nhóm lỗ breadboard** cho phép chọn profile và so hai lỗ (ví dụ A1, E1 hoặc F1). Ở vùng terminal chung, năm lỗ A–E cùng cột tạo một node; năm lỗ F–J cùng cột tạo node khác, ngăn bởi khe giữa. Profile phổ thông **không suy luận rail** khi chưa biết cấu hình thật. Profile riêng BB830 Rev 7 có mô hình bốn rail 50 lỗ tách biệt; dấu +/− chỉ là ký hiệu, không tự mang điện.

Ví dụ mô hình A1/E1 cùng node, A1/F1 khác node; nếu profile chưa xác minh rail thì màn hình trả **chưa đủ bằng chứng**, không khẳng định chắc chắn hở hoặc nối trên thiết bị thực. Kết quả không thay đổi mạch học viên, không tự cắm chân linh kiện vào bất kỳ lỗ nào trên scene 3D và không chứng minh nguồn, điện áp, dòng hoặc độ an toàn thực.

### Ước tính dòng LED với mô hình có giới hạn

Ở **bài 02, 03 và 05**, mục **Ước tính dòng LED** hiển thị kết quả sau khi netlist đạt điều kiện topology; bản đấu chưa đạt sẽ bị từ chối tính. Công thức `I = (5 V − Vf) / R` dùng HIGH 5 V lý tưởng, điện trở và điện áp thuận LED giả định (bài RGB 05 không tính dòng PWM trung bình). Đây **không phải phép đo mạch thật** hay bằng chứng mọi linh kiện đang hoạt động an toàn.

### Mạng điện trở DC lý tưởng độc lập (source v1.6)

Trong mục **Mạng điện trở DC tuyến tính**, bạn tự nhập điện áp nguồn lý tưởng (0–5 V), R1 từ VCC đến MID và R2 từ MID đến GND (mỗi điện trở > 0 Ω). Bấm **Tính theo mô hình** để xem điện áp nút giữa, dòng và công suất tính toán của từng điện trở; nguồn và điện trở là thông số **do người học khai báo**, không lấy từ mạch hoặc cảm biến thật. Một ví dụ rõ ràng là 5 V, R1 = R2 = 1000 Ω: V(MID) = 2,5 V theo mô hình lý tưởng.

Hệ thống dùng bộ giải mạng điện trở tuyến tính có giới hạn `src/dc-resistor-network.js`, loại bỏ đầu vào không hợp lệ/nhánh floating/phần tử ngoài khả năng. Không nối tự động vào netlist 16 bài, không tự suy nguồn GPIO, LED, motor, servo, chất lượng tiếp xúc hoặc giá trị đo. Không dùng những kết quả này làm chứng cứ điện áp/dòng an toàn trên mạch vật lý. Xem [phạm vi solver](DC_RESISTOR_NETWORK_V16.md).

## 5. Sửa, tải mã Arduino C++

Mở khu vực **Arduino Sketch**, nhấn **Sửa mã** để chỉnh văn bản, **Xem mã** để xem bản được tô sáng, **Tải .ino** để lưu mã ra tệp hoặc **Khôi phục mã mẫu** để quay lại bản gốc. Mã sửa chỉ lưu trong tab trình duyệt đang mở, nên hãy tải .ino để giữ lâu dài.

Quan trọng: **sửa mã không thay đổi mô phỏng**. Máy Windows thử nghiệm chưa có Arduino CLI, nhưng GitHub Actions trong repository Public đã **biên dịch thành công cả 16 Sketch mẫu** trên Ubuntu với Arduino CLI 1.5.1, AVR core 1.8.6 và Servo 1.3.0. Bạn có thể dùng lệnh `python scripts/verify_sketches.py --compile` ở máy có toolchain tương ứng, hoặc chạy workflow thủ công cho commit hiện hành. Chức năng nạp firmware qua USB không hỗ trợ.

### Xem firmware AVR đã biên dịch: baseline v1.3 và peripheral lab v1.4.0

1. Mở mục **Thực thi mã AVR đã biên dịch** phía dưới phần bài tập và nhấn **Nạp firmware mẫu**. Trình duyệt đối chiếu mã `src/lessons.js`, manifest và SHA-256 của HEX bài học trước khi khởi tạo bộ nhớ ảo.
2. Nhấn **Thực thi 1 lệnh** để quan sát một opcode AVR (PC và chu kỳ thay đổi), hoặc nhấn **Thực thi 25.000 chu kỳ** để chạy một đợt có giới hạn; xem PC, tổng chu kỳ và các thanh ghi thô DDRB/PORTB. Nhấn **Khởi tạo CPU mới** để khởi tạo lại chương trình và SRAM.
3. Khi chuyển sang bài khác, CPU cũ bị bỏ và phải nạp lại HEX đúng bài. Nếu đã sửa Sketch trong tab, thông báo nhắc rằng HEX mẫu **không được biên dịch lại từ văn bản đã sửa**.

Baseline **v1.3** dùng CPU-only: `src/avr-runtime.js` thực thi opcode của HEX thật nhưng không gắn peripheral. DDRB/PORTB ở chế độ này vẫn chỉ là dữ liệu thanh ghi; không suy ra LED, nút, cảm biến, servo hoặc Serial ngoài bo đã hoạt động.

Trong source **v1.4.0**, panel có lựa chọn **“Bật mô hình ngoại vi AVR thử nghiệm”**. Đây là opt-in; bỏ chọn thì vẫn dùng baseline CPU-only. Nhánh thử nghiệm được giới hạn bởi `src/avr-board-runner.js::AVR_BOARD_LAB_CAPABILITIES`: nó cho firmware thật tác động lên trạng thái GPIO theo thanh ghi (gồm D13/PB5), bộ đếm/overflow Timer0, ADC single-conversion từ điện áp cố định do người học nhập và USART0 async 8-bit TX capture. Các module chi tiết và negative contract nằm tại `src/avr-gpio.js`, `src/avr-timer0.js`, `src/avr-analog-serial.js` cùng các test `tests/avr-*-contracts.js` tương ứng.

Peripheral lab **không phải Arduino Uno hoàn chỉnh**: chưa có Timer1/2, waveform PWM/output compare đầy đủ, USART RX, cảm biến ngoài, mô hình điện, motor/servo physics hoặc parity `delay()/millis()/micros()`. ADC nhận đầu vào giả định cố định, không phải số đo. USART chỉ capture byte TX mà firmware thực sự hoàn tất, không phải Serial Monitor của simulator. Nút **Chạy mô phỏng** và phần mô phỏng JS vẫn là hệ thống độc lập; scene 3D không được coi là đầu ra phần cứng của peripheral lab.

Source v1.5 có thêm **mô hình Timer1 độc lập WGM0 Normal** để học tập và chạy fixture đã được kiểm thử. Nó **không được gắn vào runner chung** vì Arduino core thật có thể khởi tạo WGM1 (ngoài khả năng đã kiểm chứng). Không gọi đây là Servo PWM hoặc `delay/millis` parity. Xem [Timer1](TIMER1_RUNTIME.md).

Source v1.6 bổ sung **Timer2 độc lập WGM0 Normal** với TCNT2, prescaler, overflow và interrupt trong tập con được kiểm chứng, không gắn vào runner mặc định. Từ HEX Arduino thật, core chuyển sang chế độ Timer2 ngoài WGM0 nên adapter phải từ chối, không suy luận PWM/tone/Servo. Xem [Timer2](TIMER2_V16.md).

Không dùng CPU baseline hoặc peripheral lab làm chứng cứ bo Arduino vật lý, tải điện hay độ chính xác thời gian thực. Nguồn máy là cycle count mô phỏng 16 MHz, không phải đồng hồ tường và không thay thế phép đo trên thiết bị.

Nếu trang đang mở lần đầu được Service Worker điều khiển hoặc nhận phiên bản Service Worker mới, ứng dụng hiện thông báo và khóa điều khiển AVR cho tới khi tải lại. Hãy tải `.ino` đang sửa về máy trước khi bấm **Tải lại phiên bản mới**; thao tác này ngăn mã bài học cũ dùng lẫn tệp firmware/manifest mới trong một tab còn mở.

### Kiểm tra hồ sơ đo phần cứng ngoại tuyến

Người có phép đo được thu thập độc lập có thể chuẩn bị tệp JSON theo [mẫu schema và hướng dẫn](HARDWARE_EVIDENCE.md), rồi gọi `python scripts/validate_hardware_evidence.py --verify <duong-dan-json>` trên máy tính. Công cụ chỉ kiểm tra cấu trúc và tính nhất quán của dữ liệu khai báo; không kết nối cổng USB, không thực hiện phép đo và không xác nhận nguồn gốc thiết bị. Không tự tạo số liệu đo để làm báo cáo PASS.

## 6. Tiến độ

Tiến độ lưu trên chính trình duyệt. Bấm **Xuất tiến độ** để tải một tệp JSON; bấm **Nhập tiến độ** để khôi phục trên trình duyệt khác. Tệp chỉ chứa danh sách ID bài hoàn thành. Nếu trình duyệt chặn lưu trữ, cần xuất dữ liệu trước khi đóng trang.

## 7. Giới hạn và an toàn

Mã mẫu Arduino chỉ để đọc, sao chép và thử nghiệm trên thiết bị thật trong môi trường phù hợp có hướng dẫn. Nút Chạy mô phỏng **không** biên dịch hay nạp Arduino Sketch. Mô hình linh kiện 3D là bản minh họa giáo dục; kiểm tra sơ đồ, nguồn và thông số linh kiện thực trước khi cấp nguồn.

Nếu WebGL không hoạt động, chuyển sang tab **Sơ đồ kết nối** để tiếp tục học.
