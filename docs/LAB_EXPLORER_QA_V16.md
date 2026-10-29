# QA v1.6 — Lab Explorer

Tài liệu này ghi hợp đồng kiểm thử cho Lab Explorer v1.6 trên Arduino 3D Việt Nam. Phạm vi QA này chỉ xác nhận hành vi phần mềm trong trình duyệt và các ranh giới đã công bố; không chứng nhận breadboard vật lý, điện áp, dòng, cảm biến, motor, bơm hay Arduino Uno ngoài đời.

## Baseline phải giữ nguyên

- Baseline Chromium trước v1.6: **230/230 PASS**.
- Không xóa, đổi tên để né lỗi, nới lỏng điều kiện hoặc bỏ bất kỳ check lịch sử nào trong `tests/e2e_browser.py`.
- Không làm yếu các contract accessibility hiện có trong `tests/accessibility-contracts.js`.
- Check version vẫn là exact-match của bản ứng viên; chỉ đổi expected từ 1.5 sang 1.6 khi candidate freeze.
- Browser QA chỉ được chạy khi module/DOM v1.6 đã ổn định và prime cấp một browser slot duy nhất.

### Static preflight của candidate

Trước lượt Chromium cuối:

- `tests/e2e_browser.py` compile Python thành công và scoped `git diff --check` sạch.
- 149/150 tên check literal lịch sử giữ nguyên; check còn lại là gate version được chuyển nguyên độ chặt từ `v15-version-badge-release-candidate` sang `v16-version-badge-release-candidate`, vẫn exact-match badge candidate.
- 29/29 tên `record`/`skip` accessibility lịch sử còn nguyên; v1.6 thêm 7 record mới.
- Với các loop động theo 16 lesson/2 signal-only/2 malformed-hole và closure read-only/focus mới, full candidate thực tế chạy **289/289 PASS**.
- Release allowlist hiện có 83 tệp. Offline gate yêu cầu Lab Explorer, Breadboard Study, Timer2, DC resistor solver, Resistive Study và CSS v1.6 đều import được sau khi network bị tắt.

## Acceptance matrix v1.6

| Nhóm | Điều kiện cần chứng minh |
| --- | --- |
| 16 bài học | Explorer đồng bộ đúng lesson hiện tại, không giữ inspector/minimap/schematic của lesson trước. |
| Inspector ↔ 3D | Chọn component từ Explorer đồng bộ sang scene/lab editor; chọn/bỏ chọn từ 3D đồng bộ ngược về inspector. |
| Learner vs reference | Bản tự đấu và mạch mẫu là hai nguồn riêng. Có learner draft không được làm biến mất hoặc thay đổi reference sample. |
| Schematic SVG | Mọi thao tác nối/gỡ dây phải đi qua canonical `circuit-router`; SVG không được tự tạo một graph điện thứ hai. |
| Signal-only 10/14 | Có thể xem tín hiệu tham khảo nhưng không được nâng thành `functional`, không được kích hoạt motor/bơm hoặc ngụ ý tải công suất đã được mô hình. |
| Arduino cố định | Arduino Uno có thể được inspect/focus nhưng không trở thành component di động hoặc xoay được. |
| Breadboard/profile | Breadboard vẫn là bố trí khái niệm. Nếu profile mode được bật, trạng thái chưa xác minh phải hiện rõ và không tạo hole mapping giả. |
| Timer2 | Nếu `avr-timer2`/contract có mặt trong candidate, chỉ chạy contract standalone và giữ ranh giới không tuyên bố stock-firmware/Arduino parity. |
| DC resistor network | Chỉ chạy contract standalone cho mạng điện trở DC tuyến tính có giới hạn; không tự nối solver này với lesson graph, sensor, breadboard hoặc scene 3D. |
| Keyboard/focus | Tất cả action Explorer có đường keyboard tương đương, focus không mất sau update/selection và không tạo positive tabindex. |
| Screen reader | Region/heading/status/SVG/minimap/inspector có tên/quan hệ ARIA rõ; không dùng màu hoặc hình đơn độc để biểu đạt provenance/trạng thái. |
| Mobile 375 | Không horizontal overflow; control có kích thước chạm hợp lý; Explorer không che viewport/lesson controls. |
| Offline | Module/CSS v1.6 và dependency cần thiết có trong release allowlist/SW cache, import được sau khi context chuyển offline. |
| WebGL recovery | Nếu WebGL recovery path khả dụng trong candidate, Explorer/selection không mất canonical learner state sau context restore. |

## Những điều QA không được suy diễn

- `reference-sample` không phải learner completion.
- `topology-complete` chỉ nói về topology đã mô hình; không phải xác nhận điện thực.
- `signal-only-complete` của bài 10/14 không phải một mạch motor/bơm hoàn chỉnh.
- Minimap, profile breadboard và vị trí 3D là biểu diễn khái niệm, không phải tọa độ lỗ breadboard đã xác minh.
- Focus camera không thay đổi netlist.
- Timer2 standalone, nếu có, không chứng minh Arduino core dùng Timer2 theo cách giống phần cứng thật.
- DC resistor network standalone không phải SPICE tổng quát và không phải bằng chứng về LED, sensor, motor hay mạch vật lý.

## Regression P1 phải khóa ở v1.6

- Chọn component hoặc terminal khi Explorer đang read-only không được tự bật editor, đổi stage hoặc arm gesture nối dây; hai terminal click liên tiếp vẫn phải giữ learner graph rỗng.
- `focus` từ Explorer chỉ thay đổi camera focus; không ngầm đổi component selection, edit state hoặc netlist.
- Focus camera phải bị vô hiệu ngoài stage 3D, kể cả khi cờ editor vẫn đang bật.
- Fresh lesson dùng provenance `learner-empty`; reference sample/evidence vẫn là nguồn tham khảo riêng, không được trở thành learner completion.
- Pending terminal selection phải bị xóa khi canonical circuit mutation hoặc lesson switch làm gesture cũ không còn hợp lệ.
- `Home` trên canvas và nút reset camera phải cập nhật lại minimap focus, không để Explorer hiển thị focus cũ.
- Terminal được chọn phải có state ARIA đọc được; selected state không chỉ tồn tại bằng màu.
- Các action group trong schematic/minimap SVG phải có role/name/keyboard semantics; SVG không được là đường tương tác không tên.
- Reference overlay phải trở về `off` khi đổi lesson, không mang sample của lesson trước sang lesson mới.

## Bằng chứng browser cuối

Candidate freeze sau khi sửa race thu hồi mạch tự đấu đã chạy đầy đủ bằng đúng một Chromium session:

- **289/289 PASS, 0 FAIL**. Baseline 230 check lịch sử được giữ; chỉ gate version được đổi exact-match từ 1.5 sang 1.6.
- Accessibility desktop nested: **29 PASS / 0 FAIL / 2 SKIP**, **0 P1 blocker**.
- Lab Explorer model/DOM: **31/31 PASS**.
- Scene v1.6 focus/view/LOD/WebGL recovery: **39/39 PASS**; scene lab edit hiện hữu: **41/41 PASS**.
- Breadboard topology standalone: **46/46 PASS**; generic profile giữ rail unknown và physical placement unverified, BB830 profile vẫn không có physical-placement claim.
- Timer2 standalone: **10/10 PASS**, không có stock-firmware/tone/PWM parity claim.
- DC resistor network standalone: **51/51 PASS**, không nối ngầm vào lesson/3D/sensor.
- Mobile 375 PASS: Explorer, Breadboard Study và Resistive Study không tạo document horizontal overflow; các control được kiểm có chiều cao tối thiểu 40 px.
- Offline/SW PASS: Explorer model/UI, Breadboard model/UI, Timer2, DC resistor solver, Resistive Study và CSS v1.6 import được khi offline; verified AVR peripheral firmware vẫn tải/chạy từ cache.
- `browser_gpu_diagnostics.count = 0`, `unexpected_console_warnings.count = 0`, `console_errors.count = 0`; check `no-uncaught-pageerrors` PASS.

Trong quá trình freeze, historical `invalid-wire-blocks-restart` phát hiện một race thật giữa `onDeactivate("invalid")` và `onChange`: refresh reentrant có thể khôi phục graph valid cũ trước khi canonical invalid graph được commit. Prime sửa source bằng cách snapshot graph/analysis đã thay đổi, gửi `onChange` trước rồi mới `onDeactivate`; historical gate được giữ nguyên và **PASS** trong full run cuối.

Các false-red trước full PASS đều thuộc QA harness (SVGElement `.click()`, outer-host landmark assumption, SVG group click geometry, và setup connector thiếu explicit edit opt-in); chúng được sửa trong test mà không nới acceptance criteria hay đổi product source.
