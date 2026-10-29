# Practice Observation — in-session activity journal

## Mục tiêu

`src/practice-observation.js` bổ sung một lớp observation **thuần, immutable, bounded** cho 48 checkpoint thực hành đã được biên tập ở `src/practice-checkpoints.js`.

Observation này chỉ trả lời câu hỏi hẹp:

> Module observation đã được caller báo những **loại event nào** trong journal phiên hiện tại của một lesson, và các loại event đó có trùng với expectation biên tập của checkpoint đang xem hay không?

Nó **không** trả lời:

- người học có thật sự làm hành động ở ngoài ứng dụng hay không;
- event có xảy ra đúng tại step hiện tại hay không;
- người học đã cắm dây vật lý, chạy bo thật hoặc kiểm tra phần cứng hay chưa;
- người học đã hiểu bài/mastery hay chưa;
- checkpoint/bài học đã hoàn thành hay chưa;
- người học có được phép/chặn chuyển bước hay không;
- giáo viên/tác giả đã xác nhận hoạt động hay chưa.

## API

```js
import {
  PRACTICE_OBSERVATION_EVENT_TYPES,
  createPracticeObservationJournal,
  recordPracticeObservation,
  inspectPracticeObservation,
} from "./src/practice-observation.js";
```

### 1. `createPracticeObservationJournal()`

Tạo journal rỗng:

```js
{
  version: 1,
  entries: []
}
```

Result được deep-freeze.

Journal còn có **private provenance brand** bằng module-local `WeakSet`. Brand không nằm trong JSON/object fields và chỉ được gán cho object journal do chính `createPracticeObservationJournal()` hoặc `recordPracticeObservation()` trả về.

Vì vậy shape-valid literal hoặc `JSON.parse(JSON.stringify(journal))` **không** được coi là journal hợp lệ. Cả `recordPracticeObservation()` và `inspectPracticeObservation()` đều fail-closed với journal đã mất/không có brand.

Journal cố ý **không có**:

- clock;
- timestamp;
- `createdAt` / `updatedAt`;
- persistence marker;
- step index;
- completion/progress state.

### 2. `recordPracticeObservation(journal, { lessonId, eventType })`

Trả một journal mới, không sửa journal cũ.

Input chính xác:

```js
{
  lessonId: 1..16,
  eventType
}
```

Không chấp nhận field lạ như `timestamp`, `stepIndex`, `completed`, `source`, `teacherValidated`.

Allowlist:

```text
view-pinout
view-3d
view-wiring
change-control
start-simulation
edit-sketch
connect-wire
```

Journal tối đa 128 entries. Event lặp được giữ lại vì hai tương tác thật cùng loại vẫn là hai event ứng dụng đã nhận.

**Boundary tích hợp quan trọng:** module không thể tự biết một call có đến từ click/thao tác thật hay không. Prime app phải chỉ gọi `recordPracticeObservation(...)` trong handler của **tương tác người dùng thực tế**. Không được pre-seed event, không ghi event khi render, không ghi event vì state mặc định, không ghi event vì sample/reference tự xuất hiện.

### 3. `inspectPracticeObservation({ lesson, stepIndex, journal })`

Inspector gọi `getPracticeCheckpoint(lesson, stepIndex)` trước. Vì vậy:

- lesson text drift/tamper fail-closed;
- step ngoài phạm vi fail-closed;
- source step của observation luôn là authored checkpoint đang tồn tại.

Result dạng:

```js
{
  lessonId,
  stepIndex,
  checkpointId,
  checkpointKind,
  sourceStep,
  status,
  expectedEventTypes,
  expectation: {
    scheme: "editorial-from-authored-checkpoint",
    source: "practice-checkpoint.sourceStep",
    rationale,
    required: false,
    teacherValidated: false,
    prerequisiteForAdvance: false
  },
  observedLessonEventTypes,
  matchingEventTypes,
  lessonEventCount,
  matchingEventCount,
  summary,
  claims
}
```

Result được deep-freeze.

## Vì sao observation chỉ ở cấp lesson

`recordPracticeObservation()` cố ý chỉ nhận:

```text
lessonId + eventType
```

Nó không nhận `stepIndex` và không có timestamp. Do đó một event `change-control` ở bài 02 có thể trùng expectation của nhiều step trong cùng bài.

Inspector **không được** nói:

> Người học đã thay đổi control ở step 2.

Nó chỉ có thể nói:

> Trong journal của lesson 02 có event `change-control`, và loại event này trùng expectation biên tập của step đang xem.

Claims luôn giữ:

```js
claims.stepAttribution === false
claims.timestamped === false
claims.persisted === false
```

## Status

### `lesson-event-overlap`

Ít nhất một event trong journal **cùng lesson** có event type nằm trong `expectedEventTypes` của checkpoint.

Đây không phải “đã làm step”, không phải pass và không phải completion.

### `no-lesson-event-overlap`

Checkpoint có editorial expectation nhưng journal phiên hiện tại chưa có event cùng lesson trùng loại.

Điều này **không** được diễn giải thành:

- người học chưa làm;
- người học không xem/chỉnh/chạy ở nơi khác;
- thao tác không xảy ra trước khi journal được tạo;
- lesson chưa hoàn thành.

### `no-editorial-expectation`

Source step không nêu một event category trong allowlist đủ rõ để biên tập expectation.

Status này trung tính. Nó không phải thiếu hoạt động và không phải failure.

## Editorial event expectations cho 48 checkpoint

Các expectation dưới đây được biên tập từ **literal `sourceStep`**. Đây chỉ là category hữu ích để so observation; chúng `required:false`.

| Bài | Step 1 | Step 2 | Step 3 |
| --- | --- | --- | --- |
| 01 | `view-3d` | `change-control`, `start-simulation` | `view-3d`, `view-pinout` |
| 02 | `view-wiring` | `change-control` | `start-simulation`, `change-control` |
| 03 | `view-wiring` | `change-control`, `start-simulation` | `change-control` |
| 04 | `view-wiring` | `change-control`, `start-simulation` | — |
| 05 | `view-wiring` | `change-control` | `start-simulation`, `change-control` |
| 06 | `view-wiring` | `change-control` | `start-simulation`, `change-control` |
| 07 | `view-wiring` | `change-control` | — |
| 08 | `view-wiring` | `change-control` | `start-simulation`, `change-control` |
| 09 | — | `start-simulation`, `change-control` | — |
| 10 | `view-3d` | `change-control` | `start-simulation`, `change-control` |
| 11 | — | `change-control` | `start-simulation` |
| 12 | `view-wiring` | `change-control` | `start-simulation` |
| 13 | `view-wiring` | `change-control` | `start-simulation` |
| 14 | `view-wiring` | `change-control` | `start-simulation` |
| 15 | `view-wiring` | `change-control` | `start-simulation`, `change-control` |
| 16 | `view-wiring` | `change-control` | `change-control` |

`—` nghĩa là **không gán expectation**, không phải “không có hoạt động”.

### Vì sao `edit-sketch` và `connect-wire` không nằm trong bảng expectation

Hai event type này vẫn nằm trong allowlist và có thể được app ghi nhận nếu người dùng thực sự chỉnh sketch hoặc nối dây.

Tuy nhiên 48 `sourceStep` hiện tại không có step nào literal yêu cầu:

- chỉnh sửa sketch; hoặc
- thực hiện thao tác nối dây như một action bắt buộc.

Các wiring checkpoint hiện tại chủ yếu nói “xem”, “xác định”, “nhận biết”, “đối chiếu” quan hệ nối. Vì vậy module không được tự nâng authored topology checkpoint thành expectation `connect-wire`.

## Claims boundary

Mọi observation result có:

```js
claims: {
  origin: "module-observation-journal",
  journalModuleBranded: true,
  eventReportedToModule: true,
  timestamped: false,
  persisted: false,
  stepAttribution: false,
  outsideAppActionKnown: false,
  physicalActionProven: false,
  mastery: false,
  autoCompletion: false,
  lessonCompleted: false,
  prerequisiteForAdvance: false,
  teacherValidated: false,
  observationIsPass: false
}
```

`recordPracticeObservation()` là API export công khai trong app module graph, nên module **không thể chứng minh caller là host UI handler hay event đến từ thao tác thật**. Vì vậy claims chỉ nói điều module biết chắc: journal có brand nội bộ và event đã được caller báo cho module.

Không còn claim `eventRecordedByHostOnly`. Caller-side integration policy vẫn phải đảm bảo chỉ gọi `recordPracticeObservation()` từ interaction handler thật nếu sản phẩm muốn diễn giải event như hoạt động trong UI.

## UI

```js
import { renderObservation } from "./src/practice-observation-ui.js";
```

`renderPracticeObservation` cũng được export; `renderObservation` là alias dành cho integration ngắn gọn của app.

Renderer tạo một `<section>` riêng với heading:

> Hoạt động ghi nhận trong ứng dụng

Root contract:

- `[data-practice-observation]`;
- `role="status"`;
- `aria-live="polite"`;
- `data-observation-status`;
- `data-observation-lesson`;
- `data-observation-step`;
- `data-observation-checkpoint`;
- event counts ở cấp lesson.

Child blocks:

- `[data-observation-expected]`;
- `[data-observation-recorded]`;
- `[data-observation-overlap]`;
- `[data-observation-attribution-note]`;
- `[data-observation-boundary]`.

Renderer dùng `textContent`, không dùng `innerHTML`, không record event, không callback, không sửa journal và không sửa progress state.

## Prime app integration contract

Gợi ý state tối thiểu:

```js
state.practiceObservationJournal = createPracticeObservationJournal();
```

Chỉ trong interaction handler thật:

```js
state.practiceObservationJournal = recordPracticeObservation(
  state.practiceObservationJournal,
  { lessonId: state.lessonId, eventType: "view-3d" },
);
```

Khi render practice tab:

```js
const observation = inspectPracticeObservation({
  lesson,
  stepIndex,
  journal: state.practiceObservationJournal,
});

practiceContainer.append(renderObservation(document, observation));
```

Ứng dụng thực tế lưu journal immutable trong `state.practiceObservations` và
chỉ gọi `recordPracticeAction()` từ sự kiện tab, điều khiển, chạy mô phỏng,
chỉnh sửa Sketch hoặc kết nối dây trong UI. Riêng `connect-wire` ở Lab
Explorer chỉ được ghi sau khi thao tác từ người dùng thực sự tăng số cạnh
trên **canonical learner graph** đúng một cạnh. Mở/paste reference mẫu
hoặc kết nối sai không được gắn nhãn như user connect; journal cũng không
chứng minh người dùng đã cắm dây thật hay đã hoàn thành checkpoint.

Không gọi `recordPracticeObservation()` chỉ vì:

- tab/component vừa render;
- sample/reference được khởi tạo;
- default control có sẵn;
- simulation state mặc định là running/stopped;
- lesson/step vừa được chọn;
- topology đã match.

## Test coverage

`tests/practice-observation-contracts.js` kiểm tra:

- journal immutable, clockless, bounded;
- exact allowlist;
- reject unknown event/lesson/field/timestamp;
- forged journal fail-closed;
- đủ 48 checkpoint và exact editorial expectation mapping;
- lesson-level overlap không biến thành step attribution;
- cross-lesson isolation;
- no-overlap không suy ra learner inactivity;
- `edit-sketch` / `connect-wire` recordable nhưng không bị invent thành expected event;
- tampered lesson text, out-of-range và unknown completion field fail-closed;
- deep-freeze output.

`tests/practice-observation-ui-contracts.js` kiểm tra:

- `renderObservation` alias;
- accessible independent `role=status` block;
- overlap không pass/mastery/completion;
- no-overlap chỉ mô tả journal trong app;
- neutral no-expectation;
- labels cho cả seven event types;
- lesson-scoped counts;
- safe text rendering, không DOM injection;
- unknown status fail-neutral;
- render được đủ 48 canonical observation outputs.
