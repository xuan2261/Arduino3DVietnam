# Practice Checklist — authored per-pair wiring checklist

## Mục tiêu

Phase này mở rộng `practice-wire-guidance` thành checklist theo từng cặp dây của authored checkpoint.

Nguồn sự thật vẫn giữ nguyên:

1. `getPracticeCheckpoint(lesson, stepIndex)` xác nhận đúng lesson text và authored required pairs;
2. `listTerminals(lessonId)` xác nhận terminal IDs canonical;
3. `createSampleCircuit(lessonId)` và `sampleWires(lessonId)` xác nhận canonical reference sample;
4. canonical learner circuit hiện tại là nguồn duy nhất để quyết định một required pair đang `matched` hay `missing`.

Checklist không tạo hoặc chỉnh wire, không ghi journal, không thay progress, không đánh dấu mastery/completion, không xác nhận teacher validation và không suy ra wiring vật lý.

## Pure model API

API cũ không đổi:

```js
inspectPracticeWireGuidance({ lesson, stepIndex, circuit })
```

Các field cũ vẫn được giữ nguyên:

```js
{
  lessonId,
  stepIndex,
  checkpointId,
  status,
  nextMissingPair,
  inspectTerminalId,
  missingPairs,
  reviewExtraPairs,
  explanation,
  reviewExplanation,
  claims
}
```

Field additive:

```js
{
  pairChecklist,
  extraReviewChecklist,
  matchedPairCount,
  requiredPairCount
}
```

Tất cả result và nested rows được deep-freeze.

## `pairChecklist`

Mỗi `checkpoint.requiredPairs` sinh đúng một row theo **authored order**:

```js
{
  order: 1,
  pair: ["D13", "R1:A"],
  status: "matched" | "missing",
  inspectTerminalId: "D13",
  explanation: "..."
}
```

Semantics:

- `pair` giữ authored orientation để UI có một source terminal ổn định;
- electrical/topology comparison vẫn unordered;
- `status:"matched"` chỉ có nghĩa unordered edge đã xuất hiện trong canonical learner graph;
- `status:"missing"` chỉ có nghĩa unordered edge chưa xuất hiện trong canonical learner graph;
- `inspectTerminalId === pair[0]` chỉ là terminal focus ổn định cho read-only Inspector;
- row không chứng minh người học đã tự nối dây, không xác nhận vị trí breadboard/3D, điện áp, dòng điện, phần cứng hay mastery.

Ví dụ lesson 02 step 1 sau khi learner graph có `D13 ↔ R1:A`:

```text
1. D13 ↔ R1:A      matched
2. R1:B ↔ LED:A    missing
3. LED:K ↔ GND     missing
```

`matchedPairCount` và `requiredPairCount` phản ánh đúng các row trên.

## Canonical revalidation mỗi model call

`inspectPracticeWireGuidance()` không tin metadata từ caller ngoài canonical circuit.

Mỗi call:

- xác nhận authored checkpoint bằng `getPracticeCheckpoint()`;
- xác nhận learner circuit shape/lesson/engine/wire IDs/terminal IDs/duplicates/bounds;
- gọi `createSampleCircuit()`;
- normalize canonical reference;
- gọi `sampleWires()`;
- yêu cầu unordered pair set từ `sampleWires()` phải bằng pair set trong `createSampleCircuit()`;
- yêu cầu mọi authored required pair thuộc cả canonical terminal set lẫn canonical reference set.

Nếu source drift/tamper/malformed/foreign input xuất hiện, model fail-closed.

## `extraReviewChecklist`

Learner edges ngoài **toàn bộ canonical reference sample** được tách riêng khỏi required checklist:

```js
{
  order: 1,
  pair: ["D13", "GND"],
  status: "review-extra",
  inspectTerminalId: "D13",
  explanation: "... không thuộc canonical reference sample ..."
}
```

Một edge canonical sample nằm ngoài authored checkpoint hiện tại không bị gọi là extra.

Review row chỉ nói topology mismatch với reference sample. Nó không tự gọi edge là:

- short/chập;
- nguy hiểm;
- sai điện áp/dòng;
- sai vị trí vật lý;
- wiring thật bị lỗi.

`inspectTerminalId` của extra row chỉ dùng để focus Inspector read-only.

## Manual checkpoints

Manual checkpoint vẫn có một `wireGuidance` result rõ ràng nhưng không có rows:

```js
status: "not-applicable-manual-checkpoint"
pairChecklist: []
extraReviewChecklist: []
matchedPairCount: 0
requiredPairCount: 0
```

UI có thể hiện một checklist block trung tính nói rằng step không có authored required pair để chấm topology.

## Signal-only lessons

Lesson 14 step 1 vẫn có checklist cho:

```text
A0 ↔ SOIL:SIG
D8 ↔ PUMP:IN
```

Nhưng checklist không nâng scope:

- không xác nhận nguồn công suất;
- không xác nhận tải/bơm hoạt động;
- không xác nhận phần cứng thật.

Các negative claims cũ vẫn giữ nguyên.

## Evidence integration

`inspectPracticeEvidence(...)` giữ nguyên signature và historical statuses.

`wireGuidance` chứa checklist mới, nhưng không thay đổi:

```text
manual-checkpoint
not-attempted
needs-correction
incomplete
step-sample-match
signal-step-match
topology-match
signal-topology-match
```

Learner/reference isolation vẫn giữ:

- internal canonical reference chỉ để so sánh;
- reference sample không tự tạo `matched` row cho learner graph rỗng;
- chỉ edge có thật trong learner circuit mới tạo checklist state `matched`.

## UI API

`renderPracticeEvidence()` giữ callbacks cũ và bổ sung callback optional:

```js
renderPracticeEvidence(document, evidence, {
  onOpenWiring,
  onOpen3D,
  onInspectMissingTerminal,
  onInspectChecklistTerminal,
  onRecheck,
});
```

`onInspectMissingTerminal` vẫn phục vụ historical single “next missing pair” action.

`onInspectChecklistTerminal(terminalId)` phục vụ từng checklist row:

- matched required pair;
- missing required pair;
- extra review pair.

Prime có thể wire callback mới vào cùng read-only 3D/Inspector terminal-focus flow đang dùng cho `onInspectMissingTerminal`.

Không callback nào được tự gọi khi render.

## Stable DOM selectors

### Checklist root

```text
[data-practice-wire-checklist]
.practice-evidence-wire-checklist
role="group"
```

### Required pair rows

```text
[data-practice-checklist-required-list]
[data-practice-checklist-row]
data-practice-pair-status="matched|missing"
data-practice-checklist-order="N"
.practice-evidence-checklist-copy
.practice-evidence-checklist-explanation
```

Inspect action:

```text
[data-practice-checklist-inspect-terminal]
data-practice-inspect-terminal="<exact canonical terminal ID>"
.practice-evidence-button.practice-evidence-checklist-button
```

### Extra review rows

```text
[data-practice-extra-review-checklist]
[data-practice-extra-review-row]
data-practice-pair-status="review-extra"
[data-practice-extra-inspect-terminal]
```

## UI fail-closed validation

UI không render checklist/action chỉ vì object có shape gần đúng.

Trước khi render checklist, nó kiểm tra:

- checkpoint provenance là `human-authored-from-lesson-text`;
- wire guidance có circuit-router/authored/topology-only claims;
- physical/measured/electrical safety/mastery/completion/teacher/prerequisite/wire-created claims đều false;
- số row bằng authored required pair count;
- mỗi row có exact field set, order, pair orientation và exact canonical terminal IDs như authored checkpoint;
- `matched|missing` counts khớp `evidence.matched`, `evidence.required`, `evidence.missingPairs` và `guidance.missingPairs`;
- extra rows khớp `guidance.reviewExtraPairs` và `evidence.extraPairs`;
- malformed pair hoặc forged `teacherValidated:true` làm checklist bị suppress thay vì tạo action.

Historical next-missing button vẫn có validator riêng và không bị thay đổi.

## Accessibility / focus / viewport-small structure

Checklist dùng semantic list + native `<button type="button">`.

Buttons:

- không có `tabindex=-1`;
- giữ keyboard focusability mặc định của native button;
- có `aria-label` chứa exact terminal/pair và nói rõ action là Inspector navigation;
- disabled + `aria-disabled=true` khi callback không được cung cấp;
- không được focus tự động khi render.

JS không thêm inline `style`, fixed `width` hay table layout cho checklist. Contract unit kiểm tra cấu trúc này để tránh khóa layout 375px. Worker này **không chạy Chrome/viewport 375px** theo phase constraint, nên không tuyên bố browser-layout evidence; prime/E2E có thể xác nhận computed layout riêng.

## XSS / DOM boundary

Checklist copy và explanation đều đi qua `textContent`.

Ngay cả nếu test fixture inject string dạng:

```html
<img src=x onerror="...">
```

nó chỉ xuất hiện như literal text và không tạo DOM node.

## Claims boundary

Checklist tiếp tục dùng wire-guidance claims:

```js
{
  origin: "canonical-learner-graph-vs-authored-checkpoint",
  topologyAuthority: "circuit-router",
  authoredCheckpoint: true,
  topologyOnly: true,
  physicalVerified: false,
  measured: false,
  electricalSafetyVerified: false,
  functionalHardware: false,
  learnerActionProven: false,
  mastery: false,
  autoCompletion: false,
  lessonCompleted: false,
  prerequisiteForAdvance: false,
  teacherValidated: false,
  wireCreated: false,
  inspectorNavigationOnly: true
}
```

“Authored” chỉ có nghĩa pair order được biên tập rõ trong `practice-checkpoints.js`. Nó không có nghĩa teacher-validated curriculum requirement.

## Contract coverage

### `tests/practice-wire-guidance-contracts.js`

Giữ 12 historical checks và bổ sung checklist regressions:

- đủ 48 authored checkpoints / 16 lessons;
- exact authored row order/pair IDs;
- empty learner = all missing;
- partial learner = matched/missing transition đúng learner graph;
- full reference = all matched nhưng không completion;
- learner/reference isolation;
- extra review list riêng;
- signal-only non-functional boundary;
- tampered/foreign/malformed inputs fail-closed;
- deep-freeze nested checklist rows.

### `tests/practice-evidence-contracts.js`

Giữ toàn bộ 54 historical checks và bổ sung checklist binding/partial learner coverage mà không đổi status semantics.

### `tests/practice-evidence-ui-contracts.js`

Giữ toàn bộ 21 historical checks và bổ sung:

- matched/missing checklist row rendering;
- explicit click exact terminal callbacks;
- extra review inspect actions;
- manual + signal-only boundaries;
- forged/malformed checklist suppression;
- no auto callback/focus;
- textContent injection protection;
- native focusable/no-fixed-width mobile-neutral structure.
