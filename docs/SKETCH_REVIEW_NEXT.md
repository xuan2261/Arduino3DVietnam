# Sketch Review — hậu v1.6 (module ứng viên)

## Phạm vi

Nhánh `feature/post-v16-authored-lab-checkpoints` có hai module độc lập để giúp người học
đối chiếu **bản nháp trong editor** với **Sketch tham khảo của bài hiện tại**:

- `src/sketch-review.js`: pure model, so sánh nguồn và đưa cảnh báo heuristic.
- `src/sketch-review-ui.js`: renderer thuần trình bày, trả về một `<section>`.

Tích hợp source của Sketch Review **đã hoàn thành trong ứng viên hiện tại**: `index.html` có mount `#sketchReviewMount`; `src/app.js` import và gọi `inspectSketchDraft`/`renderSketchReview` qua `updateSketchReview()`; `styles/app.css` có style cho vùng review; `scripts/build_site.py` và `sw.js` đã đưa hai module cùng tài liệu này vào gói static/offline của candidate. Các thao tác sửa/tải/khôi phục Sketch vẫn thuộc app, không do renderer tự điều khiển.

Trạng thái trên chỉ xác nhận **source integration trong working tree/candidate**. Nó chưa chứng minh GitHub Pages/website production đã nhận thay đổi này; production v1.6.0 vẫn là mốc phát hành trước feature này cho tới khi prime chọn final SHA, chạy release gates tương ứng và phát hành riêng.

Review này **không biên dịch Arduino C++**, không parse/kiểm tra đầy đủ ngữ nghĩa C++,
không chạy firmware, không xác nhận mã đã thay đổi hành vi mô phỏng, không đo phần cứng
và không suy ra người học đã hoàn thành hay hiểu bài.

## API đã khóa

```js
import { inspectSketchDraft } from "./sketch-review.js";
import { renderSketchReview } from "./sketch-review-ui.js";

const inspection = inspectSketchDraft({
  lessonId: lesson.id,
  reference: lesson.sketch,
  draft: state.code,
});

const section = renderSketchReview(document, inspection);
```

`inspectSketchDraft()` nhận đúng ba field:

| Field | Yêu cầu |
| --- | --- |
| `lessonId` | Số nguyên `1..16` |
| `reference` | Chuỗi không rỗng, là Sketch tham khảo của bài do app truyền vào |
| `draft` | Chuỗi bản nháp editor, được phép rỗng |

Giới hạn model:

- tối đa **12.000 ký tự** cho mỗi nguồn, khớp `maxlength` hiện tại của `#codeEditor`;
- tối đa **600 dòng**;
- tối đa **2.000 ký tự mỗi dòng**;
- lưu metadata của tối đa **32 diff hunks**;
- từ chối C0 control không an toàn, DEL, Unicode bidi override/isolate và surrogate hỏng.

CRLF/CR được chuẩn hóa thành LF trước khi so sánh để không tạo thay đổi giả do kiểu xuống dòng.

## Kết quả model

Kết quả là object deep-frozen, không chứa lại toàn bộ nội dung draft:

```text
schemaVersion: 1
lessonId: 1..16
status: "reference" | "changed"
changes:
  referenceLines, draftLines, unchangedLines
  modifiedLines, addedLines, removedLines, changedLines
  totalHunks, hunks[], hunksTruncated
structure:
  setupPresent, loopPresent
  setupChanged, loopChanged
  bracesBalanced, unclosedOpeningBraces, extraClosingBraces
warnings[]
guidance[]
provenance:
  reference = "lesson-reference"
  draft = "editor-draft"
  comparison = "local-line-diff-and-source-heuristics"
claims:
  compiled = false
  semanticValidated = false
  firmwareExecuted = false
  simulationBehaviorValidated = false
  hardwareValidated = false
  learnerCompletion = false
  learnerMastery = false
```

Diff là so sánh theo dòng có giới hạn. Một block bỏ dòng + thêm dòng được trình bày thành
số dòng sửa tương ứng, phần dư mới tính là thêm hoặc xóa. Đây là công cụ giải thích thay đổi,
không phải patch/merge engine.

Heuristic nguồn bỏ qua nội dung comment và string/char literal khi quét ngoặc. Nó nhận dạng
dạng phổ biến `void setup() { ... }` và `void loop() { ... }`, cảnh báo khi thiếu/không nhận
ra hai hàm này, ngoặc `{}` lệch, comment khối chưa đóng hoặc string có vẻ chưa đóng.
Cảnh báo không thay thế compiler/parser C++.

## DOM contract cho prime

`renderSketchReview(document, inspection)` chỉ tạo node bằng `createElement()` và ghi dữ
liệu động qua `textContent`. Renderer không dùng `innerHTML`, không giữ state, không tự
chạy lại model, không tạo nút và không nhận callback.

Root và selector ổn định:

| Selector / attribute | Ý nghĩa |
| --- | --- |
| `[data-sketch-review]` | Root `<section>` |
| `data-sketch-review-status="reference|changed"` | Trạng thái so với mã mẫu |
| `data-sketch-review-tone="reference|changed|warning"` | Gợi ý tone hiển thị |
| `data-sketch-review-lesson="<1..16>"` | Lesson hiện tại |
| `data-sketch-review-warning-count="<n>"` | Số warning model |
| `data-sketch-review-changed-lines="<n>"` | Tổng dòng thay đổi đã phân loại |
| `[data-sketch-review-status-label]` | `role="status"`, `aria-live="polite"`, `aria-atomic="true"` |
| `[data-sketch-review-counts]` | Số dòng sửa/thêm/xóa |
| `[data-sketch-review-structure]` | setup/loop/brace summary |
| `[data-sketch-review-guidance]` | Gợi ý đối chiếu |
| `[data-sketch-review-warnings]` | Danh sách warning |
| `[data-sketch-review-warning="<code>"]` | Một warning cụ thể |
| `[data-sketch-review-boundary]` | Ranh giới compile/firmware/simulation/learning claim |

Renderer tự giới hạn tối đa 8 guidance rows, 12 warning rows và 900 ký tự cho một chuỗi
động ngay cả khi caller đưa inspection giả/malformed. Inspection có claim positive về
compile/firmware/hardware/learner completion hoặc provenance khác nguồn bài/editor sẽ bị
từ chối.

## Tích hợp source đã hoàn thành trong candidate

`index.html` đã chứa vùng `#sketchReviewMount` sau nút chỉnh sửa/tải/khôi phục mã. App dùng helper `updateSketchReview()` để lấy Sketch mẫu `currentLesson().sketch` đối chiếu với `state.code`, sau đó thay nội dung vùng mount bằng renderer thuần DOM. `updateCodeDraftStatus()` gọi helper này, nên review được làm mới sau render/đổi bài, sau mỗi thay đổi draft và sau khôi phục mã mẫu theo lifecycle hiện tại của editor.

`styles/app.css` đã có presentation cho mount/section, còn `scripts/build_site.py` và `sw.js` đã liệt kê asset tương ứng trong candidate. Trường hợp input bị model từ chối, app chỉ hiển thị thông báo giới hạn và không tự chạy compiler/firmware. Các nút `#editCode`, `#restoreCode`, `#downloadCode` vẫn do app quản lý. Review không can thiệp `circuit-router`, mô phỏng JS, AVR panel, điểm quiz hay trạng thái hoàn thành bài.

Các dòng trên **không phải tuyên bố phát hành**. Candidate cần được kiểm chứng trên final SHA và phát hành theo quy trình riêng trước khi có thể nói GitHub Pages/website production chứa Sketch Review.

## Bằng chứng local đã chạy

Các check dưới đây chạy trên Windows workspace của nhánh ứng viên. Chúng là bằng chứng
module/source integration cục bộ, không phải bằng chứng GitHub Actions/Pages hoặc một release đã phát hành:

| Check | Kết quả quan sát | Phạm vi |
| --- | --- | --- |
| Bun `runSketchReviewContracts()` | **15/15 PASS** | 16 Sketch tham khảo, diff dòng, CRLF, setup/loop, braces/comment/string, bounds/control Unicode, immutable/provenance/claim boundaries |
| Bun `runSketchReviewUiContracts()` | **11/11 PASS** | Stable selectors, aria-live, 16 bài, textContent/XSS resistance, render bounds, no actions/state, fail-closed forged claims/provenance |

Hai contract trực tiếp không thay thế bằng chứng Chromium/CI/final-SHA. Kiểm thử browser/release của toàn nhánh và trạng thái xuất bản được ghi riêng tại `docs/POST_V16_LAB_QA.md` và báo cáo final-SHA; chỉ các bằng chứng đó mới có thể hỗ trợ claim về bản phát hành thực tế.
