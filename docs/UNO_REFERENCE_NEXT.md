# Arduino UNO R3 — chú giải chân được đối chiếu nguồn

Đợt phát triển trên nhánh hậu v1.6.0 bổ sung danh sách chức năng chân cho
**Arduino UNO Rev3, SKU A000066** ở tab **Chân nối**, bên cạnh bảng kết nối
chuyên biệt từng bài (16 bài). Mô-đun src/uno-reference.js không đọc, sửa
hay phát sinh netlist. circuit-router vẫn là nơi quyết định tính hợp lệ của
dây do học viên nối.

## Tài liệu gốc

- Arduino, *UNO R3 Full Pinout (Top View)*, bản cập nhật 06-10-2022:
  https://content.arduino.cc/assets/A000066-full-pinout.pdf
- Arduino, *UNO R3* (thông số và thiết kế CAD/schematic):
  https://docs.arduino.cc/hardware/uno-rev3
- Arduino, *UNO Rev3 Schematic*:
  https://docs.arduino.cc/resources/schematics/A000066-schematics.pdf

Chú giải kiểm tra gồm D0..D13, A0..A5, vai trò PWM
(D3,D5,D6,D9,D10,D11), UART D0/D1, I²C A4/A5 cùng header
SDA/SCL riêng trên bo Uno Rev3 (cùng tín hiệu logic, **không** tạo MCU pin mới),
SPI D10..D13, AREF là tham chiếu ADC chứ không phải nguồn cấp,
LED L tại D13 và nhãn nhóm nguồn/GND. Một tên GND logic không phân
biệt mọi chân tiếp xúc GND vật lý. Các nhãn thể hiện chức năng được tài
liệu công bố, không đo điện áp, không xác nhận chân cắm trong mô hình
Three.js, không suy quan hệ vật lý với breadboard.

## Ranh giới chứng cứ

Danh sách không tái tạo footprint/hình học CAD, lỗ cắm, thanh cấp nguồn,
thứ tự socket vật lý hay netlist bài học; các khía cạnh đó đòi hỏi nguồn
CAD/đo kiểm riêng. Cũng không chứng minh C++ Sketch đã biên dịch, waveform
PWM hoặc ngõ ra firmware chạy trên mạch thật. Mọi tương tác học viên và
phản hồi mạch vẫn thuộc phạm vi mô hình giáo dục.
