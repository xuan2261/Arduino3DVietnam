# Nguồn tham chiếu và phục hồi

Ngày chốt: 28/10/2026. Người dùng xác nhận có quyền tái sử dụng các nguồn tham khảo.
Việc phát hành công khai sản phẩm mới vẫn cần xác định giấy phép chính thức và các thông báo tài sản bên thứ ba.

| Nguồn | SHA được lưu | Thư mục tham chiếu | Giá trị |
| --- | --- | --- | --- |
| https://github.com/builtbyhuy/codex-howto/tree/8e2f1003d5b9f0d4ee0b29ed6d421089e9392f3a/assets/atelier/guided | `8e2f1003d5b9f0d4ee0b29ed6d421089e9392f3a` | `sources/codex-howto` (sparse checkout) | Bốn bước học, Three.js r180, vòng đời scene, tests |
| https://github.com/parkain707/learn-arduino-button-kr | `c5d84455666493f4abef623c809cbf7e0300c812` | `sources/learn-arduino-button-kr` | 3D dây nối, breadboard, lesson button; mã thực khác README |
| https://github.com/aradazr/learn-microcontroller | `9e6ff7a72fe2fa70eea6763e2c334745d6fc6891` | `sources/learn-microcontroller` | 906 chuỗi i18n Ba Tư, 16 bài, bản build JS, Pages workflow |
| https://learn-arduino-red.vercel.app | Website công khai | Không được lưu snapshot website vào đây | Chuẩn tham chiếu nội dung 16 bài và UX |

Các nguồn `sources/` giữ Git riêng để có thể kiểm tra commit và lịch sử. Chúng bị loại khỏi Git repository mới theo `.gitignore` và khỏi bản phát hành `dist/`.

Thư viện Three.js v r180 từ Guided Atelier:

- `assets/vendor/three.module.min.js` SHA256: `852c06b9fe936cf8ebc2870c86370d1015c310b04de98cdfc07f4efaf6afd2af`
- `assets/vendor/three.core.min.js` (cùng nguồn r180, có trong thư mục vendor)
- Giấy phép MIT: `assets/vendor/THREE-LICENSE.txt`

**Chưa sử dụng trực tiếp** minified app bundle của website và bản Ba Tư trong ứng dụng mới; mô hình và nội dung tiếng Việt được dựng lại. Việc tài nguyên nguồn được người dùng cho phép dùng không có nghĩa mọi tệp nguồn công khai đều có giấy phép tái phân phối riêng.
