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
5. Chỉ khi bộ kiểm tra báo mạch hợp lệ mới có thể nhấn **Thử mạch vừa đấu**. Lúc này nút **Chạy mô phỏng** kiểm tra cả tính hợp lệ của netlist lẫn quy tắc mô phỏng bài mẫu. Tháo dây khiến mạch sai sẽ tự dừng mô phỏng.

Phạm vi là **15 mô hình netlist hữu hạn**, không phải một bộ giải điện học hoặc SPICE. Đặc biệt các bài động cơ/bơm chỉ xác minh phần đường tín hiệu/nguồn đã định nghĩa, **không xác minh dòng tải, bộ điều khiển công suất hoặc tính an toàn toàn mạch thực**. Bài servo minh họa nguồn riêng phù hợp và GND chung, không mặc định chân Arduino 5V có thể cấp dòng cho servo.

## 5. Sửa, tải mã Arduino C++

Mở khu vực **Arduino Sketch**, nhấn **Sửa mã** để chỉnh văn bản, **Xem mã** để xem bản được tô sáng, **Tải .ino** để lưu mã ra tệp hoặc **Khôi phục mã mẫu** để quay lại bản gốc. Mã sửa chỉ lưu trong tab trình duyệt đang mở, nên hãy tải .ino để giữ lâu dài.

Quan trọng: **sửa mã không thay đổi mô phỏng**. Máy Windows thử nghiệm chưa có Arduino CLI, nhưng GitHub Actions trong repository Private đã **biên dịch thành công cả 16 Sketch mẫu** trên Ubuntu với Arduino CLI 1.5.1, AVR core 1.8.6 và Servo 1.3.0. Bạn có thể dùng lệnh `python scripts/verify_sketches.py --compile` ở máy có toolchain tương ứng, hoặc chạy workflow thủ công cho commit hiện hành. Chức năng nạp firmware qua USB không hỗ trợ.

## 6. Tiến độ

Tiến độ lưu trên chính trình duyệt. Bấm **Xuất tiến độ** để tải một tệp JSON; bấm **Nhập tiến độ** để khôi phục trên trình duyệt khác. Tệp chỉ chứa danh sách ID bài hoàn thành. Nếu trình duyệt chặn lưu trữ, cần xuất dữ liệu trước khi đóng trang.

## 7. Giới hạn và an toàn

Mã mẫu Arduino chỉ để đọc, sao chép và thử nghiệm trên thiết bị thật trong môi trường phù hợp. Nút Chạy mô phỏng **không** biên dịch hay nạp Arduino Sketch. Mô hình linh kiện 3D là bản minh họa giáo dục; kiểm tra sơ đồ và thông số linh kiện thực trước khi cấp nguồn.

Nếu WebGL không hoạt động, chuyển sang tab **Sơ đồ kết nối** để tiếp tục học.
