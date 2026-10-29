# QA — Practice Evidence hậu v1.6 (ứng viên, chưa phát hành)

## Phạm vi

Nhánh `feature/post-v16-practice-evidence` bắt đầu từ commit v1.6.0 đã công bố `341449b12d50c681be3f04d6e291965bf6015d99`. Các thử nghiệm dưới đây xác minh **mã ứng viên trong Windows workspace**, không chứng minh tính năng đã được đưa lên GitHub Pages và không cho phép sửa lại tag v1.6.0.

Nhóm chức năng mới hiển thị ngay trong tab **Thực hành** của cả 16 bài; dữ liệu duy nhất có thể kiểm tra tự động là **graph bản thảo của người học** từ `circuit-router`, đối chiếu với một nhóm cạnh mẫu xác định từ `createSampleCircuit`. Không có phép đo, kiểm tra lỗ breadboard thật, nạp Arduino hay biên dịch Sketch tự sửa. Các nhóm cạnh được chia theo thứ tự deterministic, **không phải mapping từng bước đã được tác giả giáo trình chứng minh**.

## Bằng chứng đã chạy trước commit

| Check | Kết quả quan sát | Ranh giới |
| --- | --- | --- |
| `bun` — `runPracticeEvidenceContracts` | **47/47 PASS** | Pure model; 16 bài, empty/partial/unsafe/malformed/foreign, signal-only, immutable outputs |
| `bun` — `runPracticeEvidenceUiContracts` | **14/14 PASS** | Renderer an toàn, callback navigation-only, aria/status, 16 lesson semantics, cảnh báo nguồn gốc từng nhóm mẫu, không suy luận hành vi bên ngoài ứng dụng |
| `python -m unittest discover -s tests -q` | **90/90 PASS** | Python static/release contracts trong working tree |
| `python scripts/build_site.py` | PASS, **87 release assets + marker = 88 files** | Service Worker/manifest parity; Three/avr8js/firmware guard giữ nguyên |
| `python tests/e2e_browser.py` | **320/320 PASS**, 0 fail, 0 browser GPU diagnostics, 0 console errors, 0 unexpected warnings | Chromium thực trên bản local candidate, WebGL, mobile375, a11y, offline, 16 bài; chạy lại sau khi sửa P1 |
| Historical checks static scan | E2E literal names **174/174 preserved**, a11y record/skip names **34/34 preserved** | Dynamic loop checks vẫn được thực thi trong toàn bộ 318 E2E; không xóa hoặc giảm assertion |
| `git diff --check`, `python -m py_compile tests/e2e_browser.py` | PASS | Định dạng và cú pháp Python |

## Regression mới

- Bài 01: chỉ checkpoint thủ công, không tạo dây ngoài, không có bằng chứng mạch tự đấu.
- Các bài 02–16: graph mới mở hoàn toàn trống được gắn `not-attempted`, không lấy sample làm learner graph.
- Bản thảo cập nhật trong 2D phải cập nhật số cạnh đã khớp ngay trong coach; nút mở sơ đồ dùng bàn phím và không tự nối dây.
- Dây thiếu/sai hoặc short được phản hồi rõ, **không** chuyển thành bằng chứng học sinh làm đúng.
- Copy mẫu vào bản thảo có thể khớp topology; `claims.learnerActionProven=false`, `claims.mastery=false`, `claims.autoCompletion=false` và quiz vẫn chưa hoàn thành.
- Bài 10 và 14: chỉ có thể `signal-topology-match`, luôn chặn custom activation và không nhận là motor/bơm hoạt động.
- Nút kiểm tra lại chỉ đọc/re-render; không sửa netlist, không chạy firmware.
- Mobile 375 px không tràn ngang, action có kích thước chạm tối thiểu, CSS và module mới có trong SW cache và hoạt động offline.
- Kiểm toán P1: rời chế độ 3D khi đang chọn chân đầu tiên phải xóa trạng thái chờ nối; E2E đã **tái hiện đỏ** với D13 còn treo rồi **xác nhận xanh** sau khi sửa `src/lab-editor-ui.js`, kể cả khi trở lại 3D chọn chân khác.
- Trạng thái `not-attempted` chỉ mô tả không có bản thảo được ứng dụng ghi nhận, không kết luận người học chưa thực hành bên ngoài ứng dụng.
- Cả 8 trạng thái mô hình, kể cả fresh/incomplete/unsafe và match, được thông báo rằng nhóm cạnh mẫu chỉ là cách chia deterministic, không phải yêu cầu sư phạm đã xác minh hoặc điều kiện để sang bước học.

## Điều kiện tiếp tục

Kết quả local trên worktree **không phải** CI cùng final SHA. Nếu đưa ứng viên này thành bản phát hành tương lai, cần commit riêng và chạy lại manual Arduino C++/Chromium/release-gates/Pages trên **đúng SHA được lựa chọn**, kiểm chứng artifact vs HTTPS, sao lưu và chọn tag mới. Không tái dùng bằng chứng/tag/backup v1.6.0 để nhận vơ tính năng sau phát hành.

Đang còn gap lớn: đo kiểm phần cứng thật, mapping lỗ breadboard bằng dữ liệu đã chứng thực, Arduino Sketch user-editable compile/execute, chính xác ngoại vi PWM/USART RX/Servo, và kiểm thử screen-reader/thiết bị vật lý.
