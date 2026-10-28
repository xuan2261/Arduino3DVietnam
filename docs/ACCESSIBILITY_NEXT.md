# Accessibility QA trước khi Public

Phạm vi này là một **QA độc lập, có giới hạn** cho giao diện Arduino 3D Việt Nam hiện tại. Mục tiêu là tìm blocker có thể sửa trước khi Public, không phải tuyên bố chứng nhận WCAG đầy đủ.

## Final v1.4 bounded audit — current shared workspace

Lượt xác minh cuối chạy đúng **một Chrome process** với server localhost ephemeral riêng, hai context tuần tự và đóng sạch sau khi hoàn tất:

- desktop `1440×900`, motion mặc định;
- mobile `375×812`, `prefers-reduced-motion: reduce`.

Contract được mở rộng trước lượt chạy để bao gồm peripheral-mode controls thực tế, production path bật peripheral + verified firmware load, các contrast selector mới và horizontal overflow ở mobile.

### Kết quả quan sát trực tiếp

| Context | PASS | FAIL | SKIP | P1 blockers | Page errors | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | **20** | **0** | 2 | **0** | 0 | 0 |
| Mobile + reduced motion | **24** | **0** | 0 | **0** | 0 | 0 |

**P0 = 0. P1 = 0** trong phạm vi bounded accessibility contract hiện tại.

Hai SKIP desktop là nhánh chỉ có ý nghĩa trong context khác: live reduced-motion computed check và mobile drawer branch. Cả hai được thực thi và PASS trong context mobile-reduced tương ứng.

### Peripheral-mode accessibility + mobile layout

- `#avrPeripheralMode` có accessible name qua wrapping label.
- `#avrD2Input`, `#avrA0Input`, `#avrApplyA0` đều có accessible name.
- `#avrPeripheralState` là `role="status" aria-live="polite"`.
- Peripheral caveat vẫn nói rõ không tái tạo toàn bộ Arduino Uno và liệt kê giới hạn PWM/timer1-2/USART RX/cảm biến/động cơ/delay-millis/đo điện.
- Production path thực tế PASS: bật peripheral mode → nhấn nạp firmware → SHA-256 verification thành công → D2/A0 controls và peripheral state đều hiện.
- Mobile `375px`: `documentElement.clientWidth=375`, `scrollWidth=375`; AVR panel right edge `361px`, peripheral controls right edge `348px`. Không có horizontal overflow.

### Contrast computed cuối cùng

Tất cả sample đều vượt ngưỡng `4.5:1` cho normal text:

| Selector | Ratio |
| --- | ---: |
| `.lesson-metadata` | **5.76:1** |
| `.stage-tabs button[aria-selected="false"]` | **6.17:1** |
| `.panel-index` | **6.24:1** |
| `.avr-intro` | **6.24:1** |
| `.avr-draft-note` | **6.94:1** |
| `.code-disclaimer` | **6.07:1** |
| `.app-footer` | **5.49:1** |
| `.avr-metric small` | **6.12:1** |
| `.live-pill` | **6.22:1** |
| `.visual-legend` | **6.29:1** |
| `.info-footer p` | **6.26:1** |
| `.code-edit-status` | **6.20:1** |
| `.avr-experiment-choice` | **7.75:1** |
| `.avr-experiment-caveat` | **6.26:1** |
| `.avr-input-field` | **7.08:1** |
| `.avr-peripheral-state small` | **5.89:1** |

Minimum observed ratio trong tập này là **5.49:1** (`.app-footer`).

### Các contract quan trọng khác vẫn PASS

- 16 lesson controls có accessible name; đúng một `aria-current="page"`.
- 82 DOM IDs duy nhất; toàn bộ `aria-labelledby`/`aria-controls` đang dùng đều resolve.
- Không có positive tabindex.
- Canvas 3D role/focus/keyboard shortcuts PASS.
- Main status/live-region policy PASS, gồm cả AVR peripheral live state.
- AVR heading/buttons/status/truthful non-physical boundary PASS.
- Stage/info tabpanel association PASS; roving tabindex + ArrowRight PASS.
- Help dialog author-provided accessible name PASS.
- Focus-visible CSS PASS.
- Reduced-motion CSS PASS; live computed transition `0.001ms`, `scroll-behavior=auto`.
- Mobile drawer inert/aria-hidden/expanded semantics PASS; focus close/Escape/focus restore PASS.
- Visual legend có text label song song với màu.

Đây vẫn là bounded automated QA, **không** thay thế screen-reader manual test, zoom/reflow 200–400%, axe/Lighthouse/pa11y hoặc chứng nhận WCAG toàn trang.

## Xác minh sau các fix accessibility của prime

Một lượt Chrome duy nhất được chạy trên source hiện tại sau khi prime tích hợp tab/tabpanel association, roving keyboard, help dialog label và màu chữ mới. Cùng một browser process chạy hai context tuần tự:

- desktop `1440×900`, motion mặc định;
- mobile `375×812`, `prefers-reduced-motion: reduce`.

Không có uncaught page error ở cả hai context.

### Kết quả browser thô

| Context | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Desktop | 17 | 1 | 2 |
| Mobile + reduced motion | 20 | 1 | 0 |

FAIL duy nhất ở cả hai context là `avr-panel-name-status-boundary`. Đây được xác minh là **false-negative của QA contract**, không phải production blocker: heading, bốn nút và `#avrStatus` đều PASS; production đã đổi caveat từ wording CPU-only cũ “không phải mô phỏng hoàn chỉnh Arduino Uno” sang wording mới phù hợp peripheral lab: “không phải Arduino Uno đầy đủ” và “Không suy trạng thái đèn 3D, cảm biến, dòng điện… từ các thanh ghi CPU”. Contract sở hữu đã được cập nhật để chấp nhận cả boundary cũ và boundary mới, vẫn yêu cầu giới hạn không suy ra thiết bị/điện vật lý.

Do phase yêu cầu đúng **một** Chrome audit, contract sau correction không được chạy Chrome lần hai. Adjudication dựa trên DOM/source chính xác đã được browser vừa chạy quan sát, nên trạng thái production hiện tại là **0 P1 accessibility blocker trong phạm vi contract này**. Nếu chạy lại contract đã sửa, tổng logic tương ứng sẽ là desktop `18 PASS / 0 FAIL / 2 SKIP` và mobile-reduced `21 PASS / 0 FAIL / 0 SKIP`; đây là kết quả suy ra từ correction duy nhất nói trên, không phải một browser rerun thứ hai.

### Năm P1 v1.3 đã đóng

1. **Tab → tabpanel association: PASS.** Stage tabs cùng điều khiển `#viewport` có `role="tabpanel"`; info tabs cùng điều khiển `#infoContent` có `role="tabpanel"`; `aria-labelledby` cập nhật theo tab active.
2. **Stage keyboard pattern: PASS.** ArrowRight chuyển focus/selection và roving tabindex hoạt động; browser thấy trạng thái đầu `[0,-1,-1]`.
3. **Info keyboard pattern: PASS.** Cùng behavior roving/ArrowRight như stage tabs.
4. **Help dialog accessible name: PASS.** `#helpDialog aria-labelledby="helpDialogHeading"`, resolved name “Bắt đầu thực hành”.
5. **Muted/small text contrast: PASS.** Tất cả sample mục tiêu hiện vượt `4.5:1`.

Contrast computed mới trong Chrome:

| Selector | Ratio sau fix |
| --- | ---: |
| `.lesson-metadata` | **5.76:1** |
| `.stage-tabs button[aria-selected="false"]` | **6.17:1** |
| `.panel-index` | **6.24:1** |
| `.avr-intro` | **6.24:1** |
| `.avr-draft-note` | **6.94:1** |
| `.code-disclaimer` | **6.07:1** |
| `.app-footer` | **5.49:1** |

Mobile/reduced-motion vẫn PASS sau fix: drawer đóng `inert=true`, `aria-hidden=true`, opener `aria-expanded=false`; mở drawer focus `#closeSidebar`, Escape đóng và trả focus `#openSidebar`; computed transition của sidebar/lesson/button là `0.001ms`, `scroll-behavior=auto`.

## Browser contract

File mới: `tests/accessibility-contracts.js`

Chạy sau khi app đã khởi tạo:

```js
import('./tests/accessibility-contracts.js')
  .then(m => m.runAccessibilityContracts())
```

API trả về:

```js
{
  total,
  passed,
  failed,
  skipped,
  results: [
    {
      name,
      status: "PASS" | "FAIL" | "SKIP",
      severity: "P1" | "P2" | null,
      details,
      recommendation
    }
  ],
  blockers: [/* tên các check P1 đang FAIL */]
}
```

Contract **không dừng ở lỗi đầu tiên** để QA có thể thấy toàn bộ nhóm blocker trong cùng một lượt.

## Những gì được kiểm tra tự động

- `lang="vi"`, `dir="ltr"`, landmark chính và một `h1`.
- ID DOM không trùng; `aria-labelledby` / `aria-controls` hiện có đều trỏ tới ID tồn tại.
- Danh sách đủ 16 bài, mỗi lesson control có accessible name và đúng một bài dùng `aria-current="page"`.
- Control đang hiển thị (`button`, `input`, `select`, `textarea`, link) có accessible name cơ bản từ label/ARIA/text.
- Không có `tabindex > 0` làm đảo thứ tự focus.
- Canvas 3D có role, focus, `aria-keyshortcuts` và mô tả bàn phím khớp các phím đã hỗ trợ.
- Các vùng trạng thái chính (`simOutput`, quiz, electrical result, code edit, AVR status, Serial log) có `role`/`aria-live` đúng policy dự kiến.
- AVR panel có heading association, nút có tên, status live và caveat CPU-only đọc được bằng text.
- Hai nhóm `role="tab"` (stage tabs và info tabs):
  - liên kết tab → tabpanel qua `aria-controls` / `role="tabpanel"`;
  - roving `tabindex`;
  - ArrowRight đổi focus + selection.
- Help dialog có accessible name.
- CSS có focus indicator `:focus-visible` rõ ràng.
- CSS có `prefers-reduced-motion: reduce` và triệt animation/transition/smooth scrolling.
- Một tập mẫu text nhỏ/muted được đo contrast từ **computed foreground/background**; ngưỡng tự động là `4.5:1` cho text bình thường.
- Visual color legend vẫn có text label, không chỉ có chấm màu.
- Nếu contract được chạy ở viewport `<=1010px`, kiểm tra thêm trạng thái drawer đóng (`inert`, `aria-hidden`, `aria-expanded`). Ở viewport desktop check này được ghi rõ `SKIP`.

## Browser evidence ngày 28/10/2026

Một Chrome headless process duy nhất được chạy với hai context tuần tự, server localhost ephemeral riêng và được đóng sạch sau lượt QA:

- desktop `1440×900`, motion preference mặc định;
- mobile `375×812`, `prefers-reduced-motion: reduce`.

Không có uncaught page error trong cả hai context.

Kết quả sau khi hiệu chỉnh hai lỗi **trong chính QA harness** (xem ghi chú bên dưới):

| Context | PASS | FAIL | SKIP | P1 blockers |
| --- | ---: | ---: | ---: | --- |
| Desktop | 13 | 5 | 2 | tab association; stage keyboard; info keyboard; dialog name; contrast |
| Mobile + reduced motion | 16 | 5 | 0 | cùng 5 blocker |

### P1-1 — `role=tab` chưa có quan hệ tabpanel

Browser quan sát cả stage tabs và info tabs đều có ba `role="tab"`, nhưng cả sáu tab không có `aria-controls`; không có panel đích `role="tabpanel"` được liên kết. Đây là lỗi semantic/relationship thực, không phải suy luận từ CSS.

**Đề xuất:** đặt ID ổn định cho panel, `aria-controls` trên từng tab, `role="tabpanel"` + `aria-labelledby` trên panel. Khi panel không hoạt động, ẩn bằng `hidden` hoặc một cơ chế tương đương mà accessibility tree hiểu được.

### P1-2 — Stage tabs không theo keyboard tab pattern

Browser probe trên tab đang chọn:

- ArrowRight không chuyển focus/selection sang tab kế;
- cả ba tab có `tabIndex = [0, 0, 0]` thay vì roving tabindex.

**Đề xuất:** một tab `tabindex=0`, hai tab còn lại `-1`; ArrowLeft/ArrowRight chuyển focus và selection; Home/End đi đầu/cuối.

### P1-3 — Info tabs có cùng lỗi keyboard

Browser probe cho `Tổng quan / Chân nối / Thực hành` cho kết quả giống stage tabs: ArrowRight không đổi tab và `tabIndex = [0, 0, 0]`.

**Đề xuất:** dùng cùng helper/tab controller cho cả hai tablist để tránh hai implementation lệch nhau.

### P1-4 — Help dialog chưa có author-provided accessible name

`#helpDialog` không có `aria-label` và cũng không có `aria-labelledby`. Text bên trong dialog không được contract dùng làm tên thay thế, vì dialog cần tên do author cung cấp rõ ràng.

**Đề xuất:** biến dòng “Bắt đầu thực hành” thành heading có ID, ví dụ `id="helpHeading"`, rồi đặt `aria-labelledby="helpHeading"` trên `<dialog>`.

### P1-5 — Contrast của text nhỏ/muted dưới 4.5:1

Contract đo **computed foreground/background trong Chrome**, không chỉ đọc mã màu source. Các sample hiện tại:

| Selector | Ratio |
| --- | ---: |
| `.lesson-metadata` | **3.61:1** |
| `.stage-tabs button[aria-selected="false"]` | **3.23:1** |
| `.panel-index` | **2.87:1** |
| `.avr-intro` | **3.82:1** |
| `.avr-draft-note` | **4.17:1** |
| `.code-disclaimer` | **3.27:1** |
| `.app-footer` | **2.41:1** |

Tất cả sample trên là text nhỏ, nên contract dùng ngưỡng `4.5:1`.

**Đề xuất:** làm tối các token muted tương ứng; ưu tiên nội dung chức năng/hướng dẫn trước (`lesson metadata`, tab chưa chọn, AVR explanation, code disclaimer), sau đó labels/footer. Không coi tăng font-weight đơn thuần là cách thay thế cho contrast.

### Các điểm đã PASS đáng giữ

- 16/16 lesson controls có accessible name; đúng một bài có `aria-current="page"`.
- Không có duplicate DOM ID và không có `tabindex > 0`.
- Canvas 3D có `role="application"`, `tabindex=0`, mô tả phím và `aria-keyshortcuts` cho Arrow keys/Home/Enter/Space.
- `simOutput`, quiz feedback, electrical result, code edit status, AVR status và Serial log có role/live policy theo contract.
- AVR panel có heading association, bốn nút có tên, status live và caveat CPU-only dạng text.
- Visual legend có text song song với màu.
- Mobile drawer đóng: `inert=true`, `aria-hidden=true`, opener `aria-expanded=false`.
- Mobile drawer mở chuyển focus tới `#closeSidebar`; Escape đóng drawer và trả focus về `#openSidebar`.
- Với `prefers-reduced-motion: reduce`, computed transition duration của sidebar/lesson/button là `0.001ms` và `scroll-behavior` là `auto`.

### Hai correction của QA harness

Lượt browser đầu cho report đầy đủ nhưng phát hiện hai lỗi trong **test mới**, không phải production:

1. Static reduced-motion check chỉ nhận `.001ms`; CSSOM của Chrome serialize thành `0.001ms`. Live computed check đã PASS. Regex contract đã được sửa để nhận cả hai dạng tương đương.
2. Helper accessible-name ban đầu fallback sang toàn bộ `textContent`, khiến `<dialog>` false-PASS. Check dialog đã được siết lại để chỉ nhận `aria-label` hoặc `aria-labelledby` có đích.

Hai correction này đổi một reduced-motion FAIL thành PASS và một dialog PASS thành FAIL, nên **không đổi tổng PASS/FAIL** của hai context; các blocker phía trên phản ánh contract đã sửa.

## Những gì **không** được khẳng định bởi contract này

- Không chạy axe-core, Lighthouse, pa11y hoặc validator HTML vì phase này không cài dependency mới.
- Không chạy NVDA, JAWS, VoiceOver, TalkBack; không thể khẳng định cách từng screen reader phát âm hoặc virtual cursor hoạt động.
- Không chứng nhận WCAG 2.1/2.2 AA toàn trang. Chỉ một tập contract mục tiêu được kiểm tra.
- Không kiểm tra tất cả cặp màu trong toàn bộ app; contrast sampling có chủ đích, tập trung vào text nhỏ/muted dễ rủi ro.
- Không kiểm tra 200%/400% zoom, text spacing override hoặc reflow trên thiết bị vật lý.
- Không kiểm tra bàn phím trên mọi browser/OS. Contract phát sự kiện keyboard trong browser hiện hành và dựa trên DOM state quan sát được.
- Reduced-motion check hiện xác minh CSS policy; nó không chứng minh mọi animation tương lai do JavaScript tạo ra đều tôn trọng preference.
- Mobile drawer focus được kiểm tra trực tiếp **chỉ** khi contract chạy ở viewport mobile; chạy desktop sẽ ghi `SKIP` thay vì giả vờ đã kiểm tra.
- Canvas WebGL có semantics/keyboard contract nhưng nội dung 3D không tự trở thành một mô hình semantic chi tiết cho mọi linh kiện. Hiện aria-label mô tả cách tương tác và giới hạn ở mức scene tổng thể.

## Hướng sửa đề xuất cho prime

Giữ thay đổi production tách khỏi file QA này. Nếu browser run xác nhận các blocker dự kiến:

- P1: thêm ID ổn định cho từng tabpanel; `aria-controls` trên tab, `role="tabpanel"` + `aria-labelledby` trên panel; roving tabindex và ArrowLeft/ArrowRight/Home/End cho cả stage/info tabs.
- P1: đặt `id` cho tiêu đề help dialog và `aria-labelledby` cho `<dialog>`.
- P1: làm tối các token chữ nhỏ/muted cho tới khi sample computed đạt `>=4.5:1`; không chỉ tăng font-weight để né threshold.
- P2: dùng focus ring có contrast >=3:1 trên cả nền sáng và tối, hoặc dual-ring để không phụ thuộc một nền duy nhất.
- P2: chạy thêm một lượt viewport mobile và một lượt với `prefers-reduced-motion: reduce` sau khi production fixes được tích hợp.
- Trước Public: bổ sung một lượt screen-reader manual smoke và zoom/reflow manual. Ghi lại browser/OS/screen-reader version thay vì ghi “WCAG compliant” chung chung.

## Trạng thái evidence

- Static source review: hoàn tất.
- Browser desktop: hoàn tất.
- Browser mobile + reduced-motion: hoàn tất.
- Uncaught page errors trong hai context: 0.
- Screen reader / zoom / physical mobile: **chưa chạy**, không được suy diễn là PASS.
