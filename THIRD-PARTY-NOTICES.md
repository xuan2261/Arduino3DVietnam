# Thông báo nguồn và giấy phép

- **Three.js r180:** MIT License, các module JavaScript được lưu ở `assets/vendor/`. Bản văn giấy phép đầy đủ: `assets/vendor/THREE-LICENSE.txt`. Đường dẫn gốc: https://github.com/mrdoob/three.js
- **avr8js v0.21.1:** MIT License, upstream `https://github.com/wokwi/avr8js`, release commit `bee6f0a94e0e27786f6bc21aee3c775849fb50fd`. Ba ESM browser dùng lúc chạy (`assets/vendor/avr/cpu.js`, `instruction.js`, `interrupt.js`) được dẫn xuất từ các snapshot TypeScript upstream đã lưu dưới `assets/vendor/avr/avr8js-0.21.1-source/`: bỏ type/interface/import chỉ dùng cho TypeScript, làm rõ thứ tự khởi tạo field của `CPU`, và thêm hậu tố `.js` cho import nội bộ; provenance ghi rằng nhánh opcode/thuật toán `avrInstruction` không bị thay đổi. Bản MIT đầy đủ ở `assets/vendor/avr/AVR8JS-LICENSE.txt`; commit/tree, Git blob và SHA-256 của nguồn/ESM được ghi trong `assets/vendor/avr/PROVENANCE.json`.
- **Codex Howto Guided Atelier:** tham khảo cấu trúc bài học, không sao chép mã Guided Atelier vào ứng dụng mới. Source commit được ghi trong `docs/NGUON_GOC.md`.
- **Learn Arduino:** website tham khảo bài học và trải nghiệm 3D: https://learn-arduino-red.vercel.app/
- **learn-arduino-button-kr:** repository Hàn, dùng để đối chiếu tương tác 3D và cách dựng linh kiện.
- **learn-microcontroller:** repository Ba Tư, dùng để đối chiếu phạm vi i18n và quy trình GitHub Pages.

Không có font tải qua CDN. Biểu tượng SVG favicon mới được tạo riêng cho bản Việt.

Giấy phép đối với mã ứng dụng mới và lựa chọn phát hành lại tài sản từ các nguồn chưa được người dùng quy định tại thời điểm tạo mã. Không tự nhận toàn bộ source của người khác thuộc MIT chỉ vì thư viện Three.js là MIT.
