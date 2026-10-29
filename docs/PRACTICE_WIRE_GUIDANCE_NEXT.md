# Practice Wire Guidance — canonical missing-pair guidance

## Mục tiêu

`src/practice-wire-guidance.js` bổ sung hướng dẫn nối dây **thuần, immutable, bounded và topology-only** cho các authored practice checkpoints.

Module chỉ trả lời các câu hỏi hẹp:

- authored checkpoint hiện tại còn thiếu reference pair nào trong learner graph;
- pair nào là pair thiếu **kế tiếp theo authored checkpoint order**;
- terminal ID nào có thể được dùng làm điểm focus trong 3D/Inspector;
- learner graph có edge nào nằm ngoài toàn bộ canonical reference sample và cần đối chiếu topology lại.

Module không:

- tự tạo hoặc sửa dây;
- suy ra vị trí cắm breadboard/3D thật;
- đo hoặc suy ra dòng, điện áp, công suất;
- tuyên bố an toàn điện;
- tuyên bố phần cứng hoạt động;
- chứng minh người học đã thao tác;
- đánh dấu mastery/completion;
- cho phép/chặn chuyển bước;
- tuyên bố teacher validation.

## Pure API

```js
import { inspectPracticeWireGuidance } from "./src/practice-wire-guidance.js";

const wireGuidance = inspectPracticeWireGuidance({
  lesson,
  stepIndex,
  circuit,
});
```

Input chỉ gồm ba field trên. Unknown field fail-closed.

`lesson` + `stepIndex` được kiểm tra qua `getPracticeCheckpoint()`, vì vậy lesson text drift/tamper và step ngoài phạm vi đều fail-closed.

Với lesson 02..16, `circuit` phải là canonical learner graph của đúng lesson:

- version `1`;
- lesson ID đúng;
- `supported:true`;
- engine marker đúng với `createSampleCircuit()`;
- tối đa 64 wires;
- canonical wire ID `wN`;
- terminal thuộc `listTerminals(lessonId)`;
- không self-edge;
- không duplicate wire ID;
- không duplicate unordered edge;
- không field lạ trong circuit/wire;
- `nextWireId` hợp lệ.

Bài 01 không có external wiring và chỉ chấp nhận `circuit:null`.

## Result

```js
{
  lessonId,
  stepIndex,
  checkpointId,
  status,
  nextMissingPair,      // [terminalA, terminalB] hoặc null
  inspectTerminalId,    // terminalA của authored pair hoặc null
  missingPairs,         // authored required pairs còn thiếu, đúng authored order
  reviewExtraPairs,     // learner edges không thuộc toàn canonical sample
  explanation,
  reviewExplanation,
  claims
}
```

Result được deep-freeze.

## Pair semantics

Điện/topology comparison coi endpoint là unordered:

```text
D13 ↔ R1:A
R1:A ↔ D13
```

là cùng một edge.

Tuy nhiên `nextMissingPair` giữ **authored orientation** từ `checkpoint.requiredPairs`. Điều này chỉ nhằm chọn một terminal focus ổn định:

```js
inspectTerminalId === nextMissingPair[0]
```

Không được diễn giải `nextMissingPair[0]` là đầu dây “sai”, “chưa cắm thật”, cực nguồn, hay endpoint phải thao tác trước.

## Status

### `not-applicable-manual-checkpoint`

Checkpoint manual không dùng wiring topology để chấm/hướng dẫn. Không có missing pair hay Inspector target.

### `missing-canonical-pair`

Ít nhất một `checkpoint.requiredPairs` chưa xuất hiện trong learner graph.

`nextMissingPair` là pair thiếu đầu tiên theo authored order.

Ví dụ lesson 02 step 1 với graph rỗng:

```js
nextMissingPair: ["D13", "R1:A"]
inspectTerminalId: "D13"
```

Nó chỉ có nghĩa canonical learner graph chưa chứa unordered edge này.

### `review-extra-pairs`

Không còn authored missing pair, nhưng learner graph có edge ngoài **toàn bộ** `sampleWires(lessonId)`.

Không tạo missing Inspector target giả.

### `checkpoint-reference-covered`

Các authored required pairs đã xuất hiện và không có extra edge ngoài canonical sample.

Đây không phải physical/electrical success, mastery hay completion.

## Extra/wrong pair review

`reviewExtraPairs` chỉ chứa learner edge không thuộc **toàn bộ canonical reference sample**.

Một edge thuộc sample nhưng nằm ngoài checkpoint hiện tại không bị gọi là extra. Điều này quan trọng với các lesson có full sample lớn hơn authored step checkpoint.

Review wording cố ý chỉ nói:

> edge không thuộc canonical reference sample, cần đối chiếu topology.

Nó không tự gọi edge đó là chập, nguy hiểm, sai điện áp hay sai vị trí vật lý.

## Authored wiring coverage

Các checkpoint có wire guidance thực chất hiện tại:

| Bài | Authored wiring step | Required pairs |
| --- | --- | --- |
| 01 | — | manual-only |
| 02 | Step 1 | `D13↔R1:A`, `R1:B↔LED:A`, `LED:K↔GND` |
| 03 | Step 1 | `5V↔BTN:1`, `BTN:2↔D2`, `D2↔R_PULL:A`, `R_PULL:B↔GND` |
| 04 | Step 1 | `A0↔POT:WIPER` |
| 05 | Step 1 | `R_R:B↔RGB:R`, `R_G:B↔RGB:G`, `R_B:B↔RGB:B`, `RGB:K↔GND` |
| 06 | Step 1 | `5V↔LDR:A`, `LDR:B↔A0`, `A0↔R_DIV:A`, `R_DIV:B↔GND` |
| 07 | Step 1 | `D7↔SONAR:TRIG`, `D8↔SONAR:ECHO` |
| 08 | Step 1 | `D8↔BUZZ:+`, `GND↔BUZZ:-` |
| 09 | — | manual-only |
| 10 | — | manual-only; signal-side sample không tự biến thành authored wiring action |
| 11 | — | manual-only |
| 12 | Step 1 | `D9↔SERVO:SIG`, nguồn servo `+↔VCC`, `−↔GND`, Arduino GND↔nguồn servo − |
| 13 | Step 1 | `D2↔DRV:STEP`, `D3↔DRV:DIR` |
| 14 | Step 1 | `A0↔SOIL:SIG`, `D8↔PUMP:IN` — signal-only, không xác nhận tải/công suất |
| 15 | Step 1 | `5V↔FSR:A`, `FSR:B↔A0`, `A0↔R_DIV:A`, `R_DIV:B↔GND` |
| 16 | Step 1 | 14 authored reference pairs của pin table tổng hợp |

Các step manual còn lại trả `not-applicable-manual-checkpoint`; không invent wiring requirement.

## Integration với `inspectPracticeEvidence`

Signature cũ không đổi:

```js
inspectPracticeEvidence({
  lesson,
  stepIndex,
  circuit,
  referenceCircuit,
  analysis,
  hasLearnerDraft,
})
```

Result chỉ thêm field:

```js
wireGuidance
```

Các status historical vẫn giữ nguyên:

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

Wire guidance không nâng/hạ status và không thay negative semantics.

Nếu canonical evidence đang `needs-correction` vì extra edge nhưng đồng thời còn missing authored pair, `wireGuidance` có thể cùng lúc:

- cung cấp `nextMissingPair`; và
- cung cấp `reviewExtraPairs`.

Điều này chỉ giúp đối chiếu topology, không phải một thứ tự sửa bắt buộc.

## UI API

`renderPracticeEvidence` giữ signature tương thích và thêm callback optional:

```js
renderPracticeEvidence(document, evidence, {
  onOpenWiring,
  onOpen3D,
  onInspectMissingTerminal,
  onRecheck,
});
```

### Missing terminal Inspector button

Selector:

```text
[data-practice-inspect-missing-terminal]
```

Text:

```text
Xem chân cần nối trong 3D / Inspector
```

Data binding:

```text
data-practice-inspect-terminal="<exact canonical terminal ID>"
```

Button chỉ được render khi UI xác nhận đồng thời:

1. `wireGuidance.status === "missing-canonical-pair"`;
2. authored checkpoint là `kind:"wiring"` và provenance đúng;
3. wire guidance claims `topologyAuthority:"circuit-router"`, `authoredCheckpoint:true`, `wireCreated:false`, `inspectorNavigationOnly:true`;
4. `nextMissingPair` là pair hợp lệ;
5. `inspectTerminalId === nextMissingPair[0]`;
6. pair đó khớp **missing pair đầu tiên** của evidence theo unordered key;
7. pair đó cũng là authored `checkpoint.requiredPairs`;
8. pair đó là missing pair đầu tiên trong `wireGuidance.missingPairs`.

Nếu callback không được cung cấp, button có thể render disabled để thể hiện guidance nhưng không có action.

Không có button cho:

- manual checkpoint;
- full/reference-covered checkpoint;
- extra-only review không còn missing pair;
- forged/inconsistent guidance metadata.

### Click boundary

Renderer không tự gọi callback khi render.

Chỉ khi người dùng click native `<button type="button">`:

```js
onInspectMissingTerminal(exactTerminalId);
```

Renderer không:

- tạo wire;
- thay circuit;
- mở/đóng editor trực tiếp;
- mutate lesson progress;
- gọi completion;
- ghi practice observation journal;
- suy ra learner action từ click.

Prime app có thể dùng callback này để đổi sang 3D và focus terminal trong Inspector. Việc đó vẫn chỉ là navigation/inspection.

## Claims boundary

```js
claims: {
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

## Contract coverage

`tests/practice-wire-guidance-contracts.js` kiểm tra:

- đủ 48 authored steps / 16 lessons;
- manual vs wiring guidance;
- exact first/next missing pair theo authored order;
- unordered endpoint matching;
- full sample không tạo missing target;
- canonical sample edge ngoài checkpoint không bị gọi extra;
- exact extra-pair topology review;
- extra-only không invent missing terminal;
- terminal IDs đều thuộc router terminal set;
- tampered lesson/out-of-range fail-closed;
- foreign/forged circuit fail-closed;
- lesson 01 external circuit fail-closed;
- deep-freeze và toàn bộ negative claims.

`tests/practice-evidence-contracts.js` kiểm tra wire guidance được data-bind vào canonical evidence mà không đổi historical status semantics.

`tests/practice-evidence-ui-contracts.js` kiểm tra:

- callback không chạy khi render;
- click truyền exact canonical terminal ID;
- button gating trên đủ 48 authored steps;
- covered/manual/extra-only/forged guidance không tạo button sai;
- extra review giữ topology-only caveat;
- callback type fail-fast;
- historical assertion IDs và negative semantics cũ vẫn được giữ.
