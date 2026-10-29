# Post-v1.6 Lab QA — authored lab + interaction candidate

## Mục tiêu

Tài liệu này là cổng QA cho nhánh `feature/post-v16-authored-lab-checkpoints`.
Ngoài checkpoint học tập, review Sketch và placement breadboard có bằng chứng, candidate
hiện còn có journal quan sát thực hành trong phiên, UI gán terminal → lỗ breadboard do
người dùng khai báo, Inspector terminal read-only đi sang 3D, alias chân UNO Rev3 chính
thức và trình bày divider từ bounded DC solver. Tất cả các lớp này phải tích hợp với ứng
dụng hiện có mà không đổi nguồn sự thật của netlist: `circuit-router` vẫn là authority
duy nhất cho dây của người học.

Các kiểm thử cũ của v1.6 và post-v1.6 practice evidence tiếp tục là regression
gate. Không được giảm số assertion, nới điều kiện pass hoặc biến một cảnh báo
không xác định thành pass để làm candidate xanh.

## Ranh giới sự thật bắt buộc

1. **Checkpoint được biên soạn là nội dung tham khảo.** Việc ứng dụng có một
   checkpoint, reference graph, expected Sketch pattern hoặc lời giải không phải
   là bằng chứng người học đã thao tác, đã hiểu bài hay đã hoàn thành bài.
2. **Learner state và reference state phải tách biệt.** Mở overlay mẫu, xem
   checkpoint, review Sketch hoặc chạy lại phép so sánh không được tự tạo dây,
   thay learner circuit, đổi trạng thái hoàn thành quiz hay kích hoạt mạch.
3. **`circuit-router` giữ topology authority.** Mọi dây được hiển thị đồng bộ ở
   Wiring/Explorer/3D phải xuất phát từ cùng canonical learner circuit. API mới
   không được duy trì một netlist song song có thể lệch trạng thái.
4. **Breadboard placement phải explicit và được kiểm tra lại.** Tọa độ 3D,
   khoảng cách hình học, conceptual anchor, component selection hoặc reference
   overlay không được suy ra lỗ breadboard vật lý. Chỉ schema/profile/hole mapping
   được validator chấp nhận mới có thể báo mapped.
5. **Physical placement không phải electrical verification.** Một terminal đã
   map vào lỗ breadboard không chứng minh điện áp, dòng điện, firmware, an toàn
   phần cứng hoặc mạch ngoài đời đúng.
6. **Signal-only lessons tiếp tục fail closed.** Bài 10 và 14 có thể xác nhận
   topology tín hiệu trong phạm vi đã mô hình nhưng không được nâng thành functional
   circuit hoặc physical success.
7. **Lesson 01 vẫn là bài onboard.** Không được bịa yêu cầu dây ngoài hoặc
   breadboard placement chỉ để làm schema 16 bài đồng nhất.
8. **Practice observation chỉ là journal event cấp lesson.** Journal không lưu
   `stepIndex`/timestamp, không gán event cho bước hiện tại, không đo mastery và không
   tự hoàn thành bài. Overlap giữa event của lesson và expectation biên soạn chỉ là
   quan sát UI, không phải learner evidence.
9. **Authored hole session là bản nháp trong phiên.** Terminal và lỗ do người dùng
   khai báo phải qua profile validator; đổi lesson/profile/terminal vocabulary đặt lại
   bản nháp. Session không được import hoặc mutate `circuit-router`, và không được suy
   lỗ từ scene 3D.
10. **Read-only 3D inspection và resistive visualization giữ provenance riêng.**
    Terminal inspection chỉ thêm label/halo đọc-only và không arm wiring/camera. Divider
    chỉ render số khi chính `dc-resistor-network` trả result hợp lệ, hữu hạn, đúng
    provenance; SVG/table không được biến kết quả toán học thành phép đo phần cứng.

## Ma trận regression

| Khu vực | Positive path | Negative / fail-closed path | Bằng chứng cần có |
| --- | --- | --- | --- |
| 16 lessons | Mỗi bài render được checkpoint đúng lesson và giữ quiz/Sketch/scene | Unknown/mismatched lesson không dùng checkpoint của bài khác | E2E đi qua 01..16, lesson id/provenance khớp |
| Authored checkpoint | Nội dung bước hiển thị có accessible name/status | Chỉ xem checkpoint không tạo learner attempt/completion | DOM state trước/sau giữ learner wires và progress |
| Practice observation | 48 bước/16 lesson render journal status từ event thật của app | Overlap cấp lesson không được gán cho step, mastery hoặc completion | Pure/UI direct contracts + real `view-wiring` handler, learner graph giữ nguyên |
| Learner/reference isolation | Reference có thể xem/so sánh độc lập | Copy/reference match không tự hoàn thành quiz hoặc mastery | Canonical wire count và completion state không đổi ngoài thao tác người học |
| Sketch review | Review chạy trên Sketch hiện tại và trả kết quả có phạm vi rõ | Reference Sketch, parser error hoặc unsupported pattern không được báo learner success giả | Review result + source/provenance + không mutation circuit/progress |
| 2D ↔ 3D sync | Tạo/xóa dây qua một surface xuất hiện ở surface còn lại | Half gesture/stale terminal bị hủy khi đổi stage/lesson | Wire count + terminal selection + router analysis đồng bộ |
| Breadboard mapping | Explicit validated placement hiển thị mapping tương ứng | Proximity/conceptual coordinate/unknown profile/hole/duplicate hole bị từ chối | Mapping validator + UI disclosure + canonical circuit không đổi |
| Authored hole session | D13/A12 canonical, BB830 rail đã biết có thể lưu trong phiên | Generic rail, duplicate hole, lesson/profile đổi phải fail/reset atomic | Session contract + UI status/list + scene/2D wire count không đổi |
| Scene 3D | Inspector terminal hợp lệ render label/halo đọc-only mà không đổi electrical authority | Unknown/no-proof terminal bị từ chối transactional; edit transition xóa inspection | Canvas dataset, `#sceneInspectionStatus`, camera/selection/wire state không đổi |
| Resistive visual | VCC—R1—MID—R2—GND SVG + table chỉ từ solver result verified | Nonnumeric/floating/singular/forged provenance không để lại numeric presentation | Direct renderer contracts + integrated UI + mobile accessible label |
| Error boundary | Scene 3D load thành công trên path thường | Chặn `src/scene3d.js` vẫn giữ lessons, quiz và Wiring dùng được | `data-ready=fallback`, `.scene-fallback`, không uncaught `pageerror` |
| Mobile 375 | Controls nhìn thấy, thao tác được | Không overflow ngang; touch target mới không quá nhỏ | DOM geometry tại 375×812 |
| Accessibility | Native buttons/labels/status/live region/focus state đầy đủ | Không dựa vào màu hoặc claim vật lý bằng accessible name | `tests/accessibility-contracts.js` không P1 fail |
| Offline/PWA | Module/CSS mới import được khi context offline sau SW activation | Thiếu asset bắt buộc làm release build fail | `test_release.py` + offline dynamic import |
| Console/GPU | Không `pageerror`/`console.error` ứng dụng | Chỉ diagnostic GPU Chromium đã có positive CDP provenance mới được phân loại nonfatal | E2E report giữ diagnostic nguyên văn và provenance |

## Error-boundary contract

`tests/e2e_browser.py` ép request `src/scene3d.js` thất bại trong một browser
context riêng. Candidate chỉ đạt khi:

- `document.documentElement.dataset.ready` chuyển sang `fallback`;
- `#sceneMount` không còn canvas và có `.scene-fallback` với thông báo 3D lỗi;
- đủ 16 lesson links và quiz hiện tại vẫn render;
- chuyển sang tab Wiring của bài hỗ trợ tạo được `.wiring-view.is-interactive`;
- đổi lesson tiếp tục cập nhật `aria-current`, Sketch và quiz;
- không có uncaught `pageerror` từ ứng dụng.

Network error được chủ động tạo để đi vào nhánh fallback không được đưa vào danh
sách console lỗi chung của positive-path browser run. Positive path vẫn giữ cổng
console/CDP hiện có và fail nếu có warning/error ứng dụng ngoài allowlist hẹp của
Chromium GPU diagnostics.

## Release và offline

Các module/doc mới **đã được đưa vào** `scripts/build_site.py` và `sw.js`.
`tests/test_release.py` khóa allowlist thực tế, không chỉ kiểm tra file tồn
tại trong source tree. Bộ kiểm thử xác nhận:

- mọi module/CSS/doc bắt buộc nằm trong release allowlist theo đúng thứ tự do build
  script sở hữu;
- service worker precache bằng chính xác release allowlist (trừ `sw.js`, cộng root);
- build fixture thiếu từng module runtime bắt buộc phải fail closed;
- dist chỉ chứa allowlisted files và release marker;
- sau khi service worker active, dynamic import/fetch của các module/CSS mới vẫn
  thành công trong context thật sự offline.

Prefix public 97 path trước interaction suffix được khóa SHA-256
`48db3b0923e6c4fd178e865fa8954976e152256e324345a504345cacdaa9626f`.
Interaction suffix chính xác gồm, theo thứ tự:

1. `src/practice-observation.js`
2. `src/practice-observation-ui.js`
3. `src/breadboard-placement-session.js`
4. `docs/PRACTICE_OBSERVATION_NEXT.md`
5. `docs/RESISTIVE_VISUAL_STUDY_NEXT.md`

Candidate vì vậy có **102 public files**; dist có 103 file khi tính release marker.
Service Worker phải precache đúng thứ tự allowlist này (bỏ `sw.js`, thêm root `./`).

Không đưa `sources/`, source-history tham khảo hoặc tài liệu private vào public
release chỉ vì chúng được dùng để biên soạn checkpoint/provenance.

## Mobile và accessibility

Viewport chuẩn regression là 375×812. Các control mới phải có accessible name,
focus keyboard rõ, status thay đổi dùng semantics phù hợp, và không làm document
tràn ngang. Nút thao tác chính trong practice/checkpoint UI hướng tới hit target
44×44 CSS px; các control editor hiện hữu vẫn giữ ngưỡng regression lịch sử.

Nếu UI breadboard chuyển từ trạng thái conceptual-unmapped sang explicit mapped,
accessible text phải nói rõ terminal/hole nào được map và vẫn giữ boundary rằng
đó không phải xác nhận điện hay an toàn phần cứng. Không được chỉ đổi màu/biểu
tượng mà thiếu text state.

## Trình tự chạy

Sau khi source freeze, chạy trước các gate không cần browser:

```text
python -m unittest tests.test_release -v
python -c "compile(open('tests/e2e_browser.py', encoding='utf-8').read(), 'tests/e2e_browser.py', 'exec')"
```

`accessibility-contracts.js` cần DOM/layout browser thật để kiểm geometry, focus,
computed style và live-region integration. Các direct contract có fake DOM/pure model
riêng có thể chạy bằng Bun để bắt lỗi model/renderer sớm; chúng không thay thế E2E
Chromium cho accessibility, mobile hoặc integration state.

Full `python tests/e2e_browser.py` chỉ chạy sau source freeze và khi prime bàn giao
quyền Chromium độc quyền. Không chạy hai Chrome/Chromium QA suites song song trong
workspace này. Sau mọi sửa chữa phát sinh từ E2E, chỉ lặp phần bị ảnh hưởng trước;
chạy lại full gate khi thay đổi đó có thể tác động cross-surface hoặc release state.

## Trạng thái QA local đã thực thi trước commit mới

Đây là bằng chứng **trong Windows workspace tại working tree của nhánh
`feature/post-v16-authored-lab-checkpoints`**, không phải GitHub Actions hay
phát hành Pages cho SHA mới. Đợt trước tại SHA `7e1276c...` có Chromium
320/320; lần tích hợp đầu của nhánh authored-lab đạt 340/340, là bằng chứng
lịch sử kế thừa chứ **không** được gọi là kiểm thử source interaction mới.

- **Chromium E2E local cuối: 359/359 PASS**, failed=0, unexpected console
  warnings=0, console errors=0, GPU diagnostics=0. Bằng chứng JSON ignored
  `screenshots/post-v16-authored-interaction-chrome-final.json` đã được đọc,
  đủ 16 lesson, WebGL/context restore, layout/terminal 3D, 2D/schematic,
  inspector/minimap, keyboard, touch/mobile375, offline SW, Sketch review,
  practice evidence, journal, breadboard và DC solver.
- **Python unittest: 93/93 PASS** (có `tests.test_release` 22 checks), syntax
  E2E Python PASS; **Bun direct JS: 351/351 PASS** trên 13 contract suites gồm
  Uno pinout15, authored checkpoints37, practice evidence52/UI18,
  breadboard topology56, placement30, authored placement session22,
  Sketch model15/UI11, observation14/UI12, resistive visual18,
  DC resistor-network51.
- **Release build exact allowlist/SW parity:** 102 public assets, 102 SW
  precache entries (root + all public files trừ `sw.js`), 103 dist files
  gồm generated marker LF exact. Các prefix 83/87/97 đã ghim SHA256 lần lượt:
  `53c935e8002dd780adc7abe2a40b8e121b754f43b0c9f91418c779082374bf88`,
  `b457c70d5f8c78654870a21797f59f97dfd5fcec1feab132d3e138aecc40b7d5`,
  `48db3b0923e6c4fd178e865fa8954976e152256e324345a504345cacdaa9626f`.
- **Historical assertions:** 187/187 literal E2E `check` IDs và toàn bộ
  các ID cũ trong accessibility/scene/practice/breadboard vẫn hiện diện.
  Lần chạy đầy đủ sinh tổng 359 checks gồm các loop 16 bài; không xóa hay
  giảm điều kiện để tạo số PASS. Khi new authored-hole E2E chuyển bài rồi
  quay lại, trạng thái 3D edit được bật lại *tường minh* trước regression
  lịch sử: learner graph vẫn 1 dây trong Explorer/2D và hiển thị 1 dây
  khi vào chế độ 3D edit; view-only không bị nhận vơ là 3D editor.
- **Provenance/safety:** journal `WeakSet` module-private từ chối literal/JSON
  clone, không claim host-only/step/mastery/completion; event `connect-wire`
  chỉ được báo khi hành động user Explorer thực sự thêm canonical edge mới,
  không tính reference/preset hay thao tác lỗi. Generic rail unknown,
  BB830 profile bốn rail 50-hole liên tục theo hãng, mapping session
  không cấp điện hoặc thêm dây; resistor visual kiểm tra divider/Ohm/KCL,
  từ chối forged MID/drop/current/abs current/power hữu hạn.
- **Kiểm toán độc lập read-only:** đã nhận GO cho commit/push nhánh và
  manual CI, P0/P1 none sau khi xử lý forgery journal và kiểm tra
  source/scope. Không phải quyền phát hành/tag/Pages. Các chỉnh sửa nhỏ
  cuối liên quan injectable DOM test và ghi event sau kết nối canonical
  đã được browser regression và direct contracts kiểm tra; không có
  thay đổi firmware/lesson/vendor/third-party license.

**Chưa có final candidate commit SHA hoặc CI receipt tại thời điểm ghi
local QA này.** Sau commit/push nhánh phải xác minh compiler 16/16,
Ubuntu Chromium và release-preflight thành `completed/success` trên
cùng full SHA. Không dispatch `pages.yml` (workflow này có deploy),
không sửa `main`, tag v1.6.0, backup, Draft Release hay LICENSE.
