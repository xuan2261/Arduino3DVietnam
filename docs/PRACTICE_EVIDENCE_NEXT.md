# Practice Evidence — post-v1.6 bounded learner wiring evidence

<code>src/practice-evidence.js</code> cung cấp một lớp kiểm tra **thuần, deterministic, bounded** cho phần thực hành từng bước của 16 bài học. Module chỉ so sánh **canonical learner circuit** với **explicit reference sample** từ <code>circuit-router</code>.

Module không:

- tự đánh dấu hoàn thành bài;
- suy ra người học đã thật sự cắm dây hoặc thực hiện thao tác vật lý;
- suy ra vị trí breadboard/3D;
- tính dòng, điện áp, công suất hoặc an toàn phần cứng;
- biến việc copy mạch mẫu thành bằng chứng mastery;
- đọc hoặc sửa state của <code>app.js</code>;
- import <code>lessons.js</code>, nên không tạo circular dependency từ lesson data về UI logic.

## API

~~~js
import { inspectPracticeEvidence } from "./src/practice-evidence.js";

const evidence = inspectPracticeEvidence({
  lesson,
  stepIndex,
  circuit,
  referenceCircuit,
  analysis,
  hasLearnerDraft,
});
~~~

Kết quả:

~~~js
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
~~~

Toàn bộ result được deep-freeze.

## Input provenance

### lesson

<code>lesson.id</code> phải là số nguyên 1..16. <code>lesson.steps</code> phải là mảng bước học hữu hạn, không rỗng.

Module dùng chính số lượng và nội dung <code>lesson.steps</code> do caller truyền vào, nhưng không tuyên bố rằng việc chia sample wires theo step là mapping sư phạm đã được tác giả lesson xác nhận.

### circuit

Đây phải là canonical learner graph của đúng lesson:

~~~js
{
  version: 1,
  lessonId,
  supported: true,
  wires: [{ id, from, to }, ...],
  nextWireId,
  // engine: "extended-v1" khi lesson dùng extended router
}
~~~

Guard:

- tối đa 64 wires;
- wire ID canonical dạng <code>wN</code>;
- engine marker phải khớp canonical router của lesson (<code>extended-v1</code> ở extended lessons);
- terminal phải thuộc <code>listTerminals(lessonId)</code>;
- không self-edge;
- không duplicate wire ID;
- không duplicate unordered edge, kể cả đảo <code>from/to</code>;
- không chấp nhận field lạ trong circuit hoặc wire.

Sai topology nhưng vẫn là canonical learner graph **không bị reject chỉ vì sai bài**. Ví dụ <code>D13 ↔ GND</code> ở bài LED là một learner error hợp lệ để checker báo <code>needs-correction</code>. Chỉ graph bị forged/malformed/foreign mới fail-closed bằng exception.

### referenceCircuit

Caller phải truyền explicit reference circuit, ví dụ:

~~~js
createSampleCircuit(lesson.id)
~~~

Module tự gọi <code>createSampleCircuit(lesson.id)</code> và yêu cầu <code>referenceCircuit</code> có chính xác cùng unordered edge set. Thứ tự hoặc orientation của edge không được dùng làm bằng chứng điện; thứ tự canonical nội bộ từ <code>createSampleCircuit()</code> chỉ được dùng để chia sample edge groups.

### analysis

Caller truyền <code>analyzeCircuit(lesson.id, circuit)</code>.

Module recompute analysis từ canonical learner graph và so lại:

- lesson ID;
- <code>supported</code>, <code>ok</code>, <code>functional</code>;
- <code>scope</code>, <code>signalPathsComplete</code>;
- wire count;
- issue code/severity/terminal set;
- path ID/complete state.

Một object analysis forged không thể nâng learner evidence.

### hasLearnerDraft

Phải là boolean.

- <code>false</code> + learner graph rỗng: <code>not-attempted</code>.
- <code>false</code> + learner graph có wire: fail-closed, vì reference/sample không được giả làm learner action.
- <code>true</code> + graph rỗng sau khi người học xóa dây: vẫn là learner draft và thường trả <code>incomplete</code>.

## Deterministic sample-edge groups

Các sample wires canonical được chia thành contiguous groups theo số step:

1. <code>base = floor(edgeCount / stepCount)</code>
2. <code>remainder = edgeCount % stepCount</code>
3. các step đầu nhận thêm một edge cho đến khi hết <code>remainder</code>

Evidence ở <code>stepIndex = N</code> dùng **cumulative groups 0..N**.

Ví dụ:

- 3 edges / 3 steps → required counts <code>1, 2, 3</code>
- 2 edges / 3 steps → <code>1, 2, 2</code>
- 16 edges / 3 steps → <code>6, 11, 16</code>

Đây chỉ là <code>deterministic-balanced-contiguous-cumulative</code> và luôn có:

~~~js
claims.sampleGroupingPedagogyVerified === false
~~~

Không được diễn giải rằng step 1 thật sự tương ứng với wire 1 nếu lesson chưa có metadata author-verified riêng.

## Edge comparison

Endpoint comparison là unordered:

~~~text
D13 ↔ R1:A
R1:A ↔ D13
~~~

được coi là cùng một edge.

<code>matched</code> và <code>required</code> là số lượng cumulative required sample edges.

<code>missingPairs</code> gồm cumulative required edges chưa có trong learner graph.

<code>extraPairs</code> chỉ gồm learner edges không thuộc toàn bộ reference sample. Vì vậy một learner đã nối sớm một edge thuộc sample của step sau không bị gọi là extra.

## Status

### manual-checkpoint

Chỉ bài 01. Bài này dùng LED L tích hợp và không có external interactive netlist. Result không giả tạo pass/fail từ wiring.

### not-attempted

Không có learner draft. Reference sample tồn tại nhưng không được tính như learner action.

### needs-correction

Learner graph có:

- edge ngoài reference sample; hoặc
- issue mức <code>error</code> từ canonical circuit-router analysis.

Không thể là success.

### incomplete

Learner draft có tồn tại nhưng thiếu ít nhất một cumulative required sample edge.

### step-sample-match

Các required sample edges đến step hiện tại đã có, không có extra/error, nhưng chưa ở final full-reference match.

### signal-step-match

Tương tự <code>step-sample-match</code>, nhưng lesson có <code>scope: "signal-only"</code>.

### topology-match

Chỉ khi:

- đang ở final step;
- learner graph có exact same unordered edge set như canonical reference sample;
- không có extra edge/error.

Nó chỉ có nghĩa topology match với sample, không có nghĩa người học đã tự làm, không phải measurement và không phải mastery.

### signal-topology-match

Final full sample match cho bài 10 và 14.

Hai bài này vẫn giữ:

~~~js
analysis.functional === false
claims.functionalHardware === false
claims.physicalVerified === false
~~~

Nguồn công suất/tải motor hoặc pump vẫn ngoài phạm vi checker.

## Claims boundary

Mọi result có:

~~~js
claims: {
  origin: "learner-circuit-vs-reference-sample",
  electricalAuthority: "circuit-router",
  sampleEdgeGrouping: "deterministic-balanced-contiguous-cumulative",
  sampleGroupingPedagogyVerified: false,
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
~~~

Không consumer nào được nâng các claim này dựa chỉ trên <code>status</code>.

## Bài 01

Caller chuẩn:

~~~js
inspectPracticeEvidence({
  lesson,
  stepIndex,
  circuit: null,
  referenceCircuit: null,
  analysis: null,
  hasLearnerDraft: false,
});
~~~

Nếu caller đưa external circuit/reference/analysis hoặc <code>hasLearnerDraft:true</code> cho bài 01, module fail-closed.

## Example — full lesson 02 sample

~~~js
{
  lessonId: 2,
  stepIndex: 2,
  scope: "topology",
  status: "topology-match",
  matched: 3,
  required: 3,
  missingPairs: [],
  extraPairs: [],
  issues: [],
  ...
}
~~~

Điều này **không** chứng minh LED thật sáng, điện trở đúng 220 Ω ngoài đời, người học tự cắm dây hay đã hoàn thành bài.

## Contract coverage

<code>tests/practice-evidence-contracts.js</code> có 47 checks:

- final evidence cho đủ 16 lessons;
- lesson01 manual-only ở mọi step;
- deterministic cumulative grouping với 2/3/16-edge samples;
- partial draft và missing pairs;
- future-step sample edge không bị gọi extra;
- unordered endpoint matching;
- unsafe/wrong learner edge không success;
- sample copied không phải mastery/action proof;
- untouched reference không được tính learner attempt;
- cleared draft vẫn là attempt;
- signal-only lesson 10/14 không functional;
- foreign terminal, duplicate wire ID/pair, forged fields;
- forged reference/analysis;
- lesson mismatch;
- wire bound;
- deep-freeze result.

## Integration boundary

Module này chỉ export pure evidence inspector. UI rendering thuộc lớp riêng và không được phép biến status thành auto-completion. App/QA integration nên luôn giữ:

- canonical learner circuit là nguồn duy nhất cho learner evidence;
- reference overlay/sample chỉ là đối chiếu;
- action “Mở bàn đấu dây” chỉ đổi UI stage;
- action “Kiểm tra lại” chỉ recompute evidence;
- không mutation lesson progress chỉ vì <code>topology-match</code>.
