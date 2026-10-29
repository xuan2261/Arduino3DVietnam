# Post-v1.6 Fidelity + Authored Checklist — Integration QA

## Phạm vi và source truth

Đợt này kế thừa branch `feature/post-v16-interactive-breadboard-wiring` tại
`c7f0a76bc47b568f85708f5ffe185e291af0fe99`; commit nền đã có compiler,
Chromium và release-preflight exact-SHA success. Kết quả của SHA nền **không phải**
bằng chứng cho source thay đổi trong đợt này.

`circuit-router` là authority duy nhất đối với dây học viên. Three.js chỉ vẽ
minh họa; breadboard contact groups áp dụng riêng theo profile; 48 authored
checkpoints là nội dung biên tập, không phải chứng nhận giáo viên hay mức độ
thành thạo. Sketch review là lexical/text heuristic, không phải trình biên dịch
C++ hay bộ mô phỏng Sketch đã chỉnh sửa. Không thao tác thiết bị vật lý.

## Các tính năng đã tích hợp

- Uno 3D header/socket/collar, breadboard trench/contact visuals, LED/nút nhấn/
  biến trở chi tiết hơn; dùng instancing cho chi tiết lặp, có LOD, hover label
  và trạng thái pending/inspection tách biệt. Không có CAD mm-to-hole mapping.
- Lab editor có nút native **Hủy chọn chân đầu tiên**, phím Escape và live status;
  cả hai chỉ hủy pending gesture, không sửa learner graph.
- Lưới breadboard 8 cột x A–J có nhóm năm lỗ theo node profile, khe E–F,
  trạng thái known/unknown, đối chiếu hai lỗ nhập tay, BB830 bốn rail riêng;
  chọn lỗ chỉ điền input và vẫn cần `#bbAssignHole` để gán bản nháp phiên.
- Checklist từng authored required pair và extra-reference pair cho 48 bước,
  kèm nút inspect terminal **read-only**; không tạo dây, completion hay journal.
- Sketch feedback bỏ qua comment/string trước khi đối chiếu pattern source,
  có dòng tham khảo và số lần, giữ claims về compiler/AVR/firmware ở false.

## Bằng chứng local sau source freeze

| Cổng | Kết quả |
| --- | --- |
| Bun direct JS model/UI | 642/642 PASS |
| Python `unittest discover -s tests -q` | 94/94 PASS |
| `python -m unittest tests.test_release -q` | 23/23 PASS |
| Chromium full E2E Windows | **384/384 PASS**, 0 fail |
| Unexpected console warnings / errors | **0 / 0** |
| GPU diagnostics Windows | **0** |
| Site build allowlist | 110 public paths, 110 SW entries, 111 dist files including marker |
| Old public path prefix | first 107 entries unchanged; SHA-256 `c99ef11e4b8e53f4a5ca58ab897da6c509053ebb5495582d63f75ec8e33fb7ec` |

Full local browser report:
`screenshots/post-v16-fidelity-checklist-chromium.json` (không phải file được
deploy). Phải kiểm tra lại actual JSON và exact commit SHA trước mọi claim CI.

Các kiểm tra mới giữ các ID lịch sử, bao gồm hai regression learner graph qua
chuyển bài; bổ sung scene instancing/LOD/hover/physical boundary, nút hủy
pending bằng Enter/Escape, A1..E1 group không sang F1, 48 checklist manual/wiring,
read-only inspect không có journal credit, Sketch comment/string spoof, tài liệu
và lazy runtime offline. Chromium Ubuntu có thể có GPU diagnostics khác Windows;
phải giữ nguyên provenance classifier và số lượng thực, không báo GPU=0 nếu không đúng.

## Kiểm toán và quyền phát hành

Hai worker độc lập chỉ đọc trên diff ngoài ownership riêng, không tìm thấy P0/P1
trong phạm vi đã rà soát; chỉ kiến nghị branch commit + exact-SHA manual CI.
Không cấp quyền merge main, đổi tag, tạo/publish release hoặc deploy Pages.

Protected production: `main` và peeled tag `v1.6.0` vẫn cần xác nhận tại
`341449b12d50c681be3f04d6e291965bf6015d99`; Draft Release tám assets,
backup SHA256SUMS và Pages production phải được đối chiếu lại sau CI.

## Khoảng thiếu còn lại

Không có CAD/hole-to-terminal transform chính xác 1:1, snap-to-physical-breadboard
được chứng minh, breadboard generic rail continuity, đo mạch thật hay full AVR
peripheral parity. Sketch học viên chưa được biên dịch/thực thi trong browser.
Không lựa chọn root LICENSE hoặc cấp quyền tái sử dụng code/assets từ bốn repo
tham khảo ở đây. Ưu tiên đợt kế tiếp: CAD/provenance và 3D terminal routing có
bằng chứng, kiểm tra tương tác với screen-reader/thiết bị mobile thực, solver
điện cho mô hình được chứng minh, pipeline compiler sketch do người học chỉnh sửa.
