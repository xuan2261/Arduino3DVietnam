# Authored Practice Checkpoints — post-v1.6

## Mục tiêu

`src/practice-checkpoints.js` thay cơ chế chia đều sample edges theo số bước bằng **checkpoint được biên tập thủ công từ nội dung thật của `lesson.steps`**.

Nguyên tắc chính:

- chỉ tạo `wiring` checkpoint khi nội dung bước có quan hệ chân/kết nối đủ cụ thể để ánh xạ sang `circuit-router` sample mà không bịa thêm yêu cầu;
- bước điều chỉnh slider, nhấn nút, chạy mô phỏng, quan sát kết quả hoặc học khái niệm giữ `manual`;
- bài 01 luôn `manual` vì dùng LED L tích hợp, không có external wiring graph;
- mọi `requiredPairs` của wiring checkpoint phải là edge có thật trong `sampleWires(lessonId)` và dùng terminal canonical từ `listTerminals(lessonId)`;
- checkpoint editorial **không phải xác nhận của giáo viên**, không chứng minh người học đã thực hiện thao tác, không phải điều kiện để chuyển bước, không phải mastery và không tự hoàn thành bài;
- không mô tả vị trí breadboard/3D vật lý, không đo dòng/điện áp và không xác nhận phần cứng thật.

## API checkpoint

```js
import {
  getPracticeCheckpoint,
  listPracticeCheckpoints,
  PRACTICE_CHECKPOINT_PROVENANCE,
} from "./src/practice-checkpoints.js";
```

Mỗi checkpoint có shape frozen:

```js
{
  id: "lesson-02-step-01",
  lessonId: 2,
  stepIndex: 0,
  kind: "wiring" | "manual",
  sourceStep: "... nguyên văn lesson.steps[stepIndex] ...",
  guidance: "... hướng dẫn ngắn, có thể hành động ...",
  requiredPairs: [["D13", "R1:A"], ...],
  provenance: {
    scheme: "human-authored-from-lesson-text",
    source: "lessons.steps",
    editorial: true,
    rationale: "...",
    teacherValidated: false,
    hardwareValidated: false,
    prerequisiteForAdvance: false
  }
}
```

`getPracticeCheckpoint(lesson, stepIndex)` fail-closed nếu:

- `lesson.id` ngoài 1..16;
- số bước không khớp authored registry;
- bất kỳ text nào trong `lesson.steps` khác nội dung đã dùng để biên tập registry;
- `stepIndex` ngoài phạm vi.

Khi module được import, registry tự kiểm tra mọi wiring edge với `circuit-router`: terminal phải canonical, edge phải thuộc sample, không được lặp.

## Mapping hiện tại cho 16 bài

Ký hiệu: `W(n)` = wiring checkpoint có `n` required sample edges; `M` = manual checkpoint, không có hidden wiring requirement.

| Bài | Step 1 | Step 2 | Step 3 | Lý do chính |
| --- | --- | --- | --- | --- |
| 01 | M | M | M | Quan sát bo, LED L tích hợp, 3D/pinout; không có dây ngoài. |
| 02 | W(3) | M | M | Step 1 nêu D13 và cực LED; step 2/3 là timing + mô phỏng. |
| 03 | W(4) | M | M | Step 1 nêu rõ 5V → nút → D2 và D2 → pull-down → GND; nhánh LED không được gán thêm. |
| 04 | W(1) | M | M | Chỉ ánh xạ quan hệ wiper biến trở ↔ A0 được nêu trực tiếp. |
| 05 | W(4) | M | M | Chỉ các cạnh chạm trực tiếp R/G/B và cathode chung; không tự gán các chân PWM chưa được step nêu. |
| 06 | W(4) | M | M | Step 1 đọc cầu chia áp LDR; nhánh LED cảnh báo nằm ngoài checkpoint này. |
| 07 | W(2) | M | M | Chỉ D7→Trig và D8→Echo theo vai trò được step nêu. |
| 08 | W(2) | M | M | Hai cực buzzer ánh xạ trực tiếp D8/GND. |
| 09 | M | M | M | Cả ba step nói về tần số/nốt và tương tác piano, không nêu wiring action cụ thể. |
| 10 | M | M | M | Step 1 chỉ quan sát vị trí driver; sample cũng chỉ là signal-side, không phải đường công suất hoàn chỉnh. |
| 11 | M | M | M | Các step là nguyên tắc LM35, input nhiệt độ và ngưỡng mô phỏng. |
| 12 | W(4) | M | M | Step 1 nêu nguồn, GND và signal servo; sample thể hiện đầy đủ các quan hệ này. |
| 13 | W(2) | M | M | Chỉ D2→STEP và D3→DIR; không tự thêm nguồn motor vào step. |
| 14 | W(2) | M | M | Chỉ A0→SOIL SIG và D8→PUMP IN; đây là `signal-only`, không xác nhận công suất/tải. |
| 15 | W(4) | M | M | Step 1 xem cầu chia áp FSR; nhánh LED cảnh báo không được gán vào checkpoint. |
| 16 | W(14) | M | M | Step 1 liệt kê rõ toàn bộ pin table: LDR, LM35, nút, LED và buzzer; vì vậy ánh xạ full sample. |

### Required pairs cụ thể

- Bài 02 step 1: `D13↔R1:A`, `R1:B↔LED:A`, `LED:K↔GND`.
- Bài 03 step 1: `5V↔BTN:1`, `BTN:2↔D2`, `D2↔R_PULL:A`, `R_PULL:B↔GND`.
- Bài 04 step 1: `A0↔POT:WIPER`.
- Bài 05 step 1: `R_R:B↔RGB:R`, `R_G:B↔RGB:G`, `R_B:B↔RGB:B`, `RGB:K↔GND`.
- Bài 06 step 1: `5V↔LDR:A`, `LDR:B↔A0`, `A0↔R_DIV:A`, `R_DIV:B↔GND`.
- Bài 07 step 1: `D7↔SONAR:TRIG`, `D8↔SONAR:ECHO`.
- Bài 08 step 1: `D8↔BUZZ:+`, `GND↔BUZZ:-`.
- Bài 12 step 1: `D9↔SERVO:SIG`, `SERVO_SUPPLY:+↔SERVO:VCC`, `SERVO_SUPPLY:-↔SERVO:GND`, `GND↔SERVO_SUPPLY:-`.
- Bài 13 step 1: `D2↔DRV:STEP`, `D3↔DRV:DIR`.
- Bài 14 step 1: `A0↔SOIL:SIG`, `D8↔PUMP:IN`.
- Bài 15 step 1: `5V↔FSR:A`, `FSR:B↔A0`, `A0↔R_DIV:A`, `R_DIV:B↔GND`.
- Bài 16 step 1: toàn bộ 14 sample edges của pin table được nêu trực tiếp trong step.

## `inspectPracticeEvidence` — compatibility + semantics mới

Signature giữ nguyên:

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

Các field cũ vẫn còn:

```js
{
  lessonId,
  stepIndex,
  scope,
  status,
  matched,
  required,
  missingPairs,
  extraPairs,
  issues,
  summary,
  nextAction,
  claims
}
```

Field additive:

```js
{
  guidance,   // guidance authored ngắn cho checkpoint hiện tại
  checkpoint  // metadata frozen ở trên
}
```

### Manual step

Với `checkpoint.kind === "manual"`:

- `scope === "manual"`;
- `status === "manual-checkpoint"`;
- `matched === 0`, `required === 0`;
- `missingPairs`, `extraPairs`, `issues` rỗng trong practice evidence;
- circuit/reference/analysis của lesson 02..16 vẫn phải canonical và vẫn được validate trước khi trả result;
- không dùng wiring state làm pass/fail cho bước quan sát/mô phỏng.

Bài 01 vẫn là ngoại lệ không có external circuit: caller phải truyền `null` cho circuit/reference/analysis và `hasLearnerDraft:false`.

### Wiring step

`required` chỉ là số edge trong authored `checkpoint.requiredPairs`, không còn cumulative balanced split.

- `not-attempted`: app chưa ghi nhận learner draft trong phiên; không suy ra learner chưa thao tác ở nơi khác.
- `needs-correction`: learner graph có edge ngoài **toàn bộ** canonical reference hoặc canonical analysis có issue mức `error`.
- `incomplete`: còn thiếu authored required edge.
- `step-sample-match` / `signal-step-match`: authored required edges đã khớp nhưng learner graph chưa bằng toàn bộ reference sample.
- `topology-match` / `signal-topology-match`: learner graph bằng toàn bộ canonical reference sample; status này không phụ thuộc final lesson step và vẫn không có nghĩa mastery/completion.

Một canonical sample edge không thuộc checkpoint hiện tại **không phải extra**. Điều này cho phép learner nối thêm phần hợp lệ của reference mà không bị practice checker gọi sai.

## Canonical validation giữ nguyên

`src/practice-evidence.js` vẫn fail-closed với:

- lesson mismatch;
- foreign terminal;
- self-edge;
- duplicate wire ID;
- duplicate unordered edge;
- field lạ/forged trong wire hoặc circuit;
- engine marker sai;
- hơn 64 wires;
- reference khác `createSampleCircuit(lessonId)`;
- forged/mismatched analysis;
- `hasLearnerDraft:false` nhưng learner graph có wire;
- step out of range;
- authored lesson text bị sửa nhưng registry chưa được cập nhật.

## Claims boundary

Mỗi result giữ các non-claims cũ và bổ sung provenance:

```js
claims: {
  origin: "learner-circuit-vs-reference-sample",
  electricalAuthority: "circuit-router",
  sampleEdgeGrouping: "human-authored-step-checkpoint",
  checkpointEditorialProvenance: "human-authored-from-lesson-text",
  checkpointKind: "wiring" | "manual",
  sampleGroupingPedagogyVerified: false,
  teacherValidated: false,
  checkpointPrerequisiteForAdvance: false,
  sampleCopiedDoesNotProveAction: true,
  learnerActionProven: false,
  physicalVerified: false,
  measured: false,
  mastery: false,
  autoCompletion: false,
  lessonCompleted: false,
  functionalHardware: false,
  signalOnly
}
```

`teacherValidated:false` rất quan trọng: “human-authored” ở đây chỉ có nghĩa mapping được viết rõ trong source thay vì sinh bằng thuật toán chia đều. Nó **không** nói rằng giáo viên hoặc tác giả giáo trình đã kiểm chứng checkpoint như một yêu cầu sư phạm.

## UI contract

`renderPracticeEvidence(doc, evidence, { onOpenWiring, onOpen3D, onRecheck } = {})` vẫn chỉ là presentation layer.

Root bổ sung:

- `data-practice-checkpoint-kind`;
- `data-practice-checkpoint-id` khi có;
- `data-practice-provenance="human-authored-from-lesson-text"`.

Nội dung bổ sung:

- `[data-practice-guidance]` cho hướng dẫn authored;
- `[data-practice-provenance-note]` cho boundary editorial;
- wiring checkpoint vẫn có `[data-practice-grouping-note]` như selector compatibility, nhưng nội dung nay nói **authored editorial mapping**, không còn “deterministic balanced grouping”.

Navigation buttons:

- `[data-practice-open-wiring]`: chỉ đổi sang reference 2D qua callback của app; bài 01 disabled vì không có dây ngoài. Manual step của bài 02..16 vẫn có thể mở reference 2D nếu callback tồn tại.
- `[data-practice-open-3d]`: callback navigation-only sang 3D; bài 01 vẫn hỗ trợ quan sát 3D.
- `[data-practice-recheck]`: callback yêu cầu app recompute/re-render; module UI không tự đọc hoặc sửa canonical learner state.

Các button là native `<button type="button">`; renderer không dùng `innerHTML`, không trực tiếp mutate circuit, scene hay lesson progress.

## Contract tests

- `tests/practice-checkpoints-contracts.js`: coverage registry đủ 16 bài/48 steps, exact authored kinds/counts, mọi wiring edge thuộc canonical sample/terminal set, manual không có hidden wire requirement, lesson 02 step 2/3 manual, tampered lesson text cho cả 16 bài fail-closed, out-of-range cho cả 16 bài fail-closed, metadata deep-frozen.
- `tests/practice-evidence-contracts.js`: giữ canonical graph/reference/analysis/tamper/bounds coverage cũ, đổi các assertion mechanical grouping không còn hợp semantics, kiểm tra authored step integration và non-claim boundary.
- `tests/practice-evidence-ui-contracts.js`: kiểm tra provenance/guidance, 2D/3D/recheck callbacks, lesson 01 3D inspection, manual step của wiring lesson vẫn mở được reference, signal-only warning và safe text rendering.

Không contract nào được dùng để tuyên bố wiring thật đúng, điện áp/dòng thật, phần cứng hoạt động, hành động của người học, teacher approval, mastery hoặc lesson completion.
