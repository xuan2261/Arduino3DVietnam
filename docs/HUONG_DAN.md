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

## 4. Tiến độ

Tiến độ lưu trên chính trình duyệt. Bấm **Xuất tiến độ** để tải một tệp JSON; bấm **Nhập tiến độ** để khôi phục trên trình duyệt khác. Tệp chỉ chứa danh sách ID bài hoàn thành. Nếu trình duyệt chặn lưu trữ, cần xuất dữ liệu trước khi đóng trang.

## 5. Giới hạn và an toàn

Mã mẫu Arduino chỉ để đọc, sao chép và thử nghiệm trên thiết bị thật trong môi trường phù hợp. Nút Chạy mô phỏng **không** biên dịch hay nạp Arduino Sketch. Mô hình linh kiện 3D là bản minh họa giáo dục; kiểm tra sơ đồ và thông số linh kiện thực trước khi cấp nguồn.

Nếu WebGL không hoạt động, chuyển sang tab **Sơ đồ kết nối** để tiếp tục học.
