# Practice Evidence — checkpoint theo nội dung bài (nhánh hậu v1.6)

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
  guidance,
  checkpoint,
  claims
}
~~~

Toàn bộ result được deep-freeze.

## Input provenance

### lesson

<code>lesson.id</code> phải là số nguyên 1..16. <code>lesson.steps</code> phải là mảng bước học hữu hạn, không rỗng.

Module so chính xác <code>lesson.steps</code> với registry biên tập trong <code>src/practice-checkpoints.js</code>; sai nguồn text hoặc số bước thì fail-closed. Checkpoint được biên tập từ nội dung bài, **không phải nội dung đã được giáo viên xác nhận**.

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

Module tự gọi <code>createSampleCircuit(lesson.id)</code> và yêu cầu <code>referenceCircuit</code> có chính xác cùng unordered edge set. Thứ tự hoặc orientation của edge không được dùng làm bằng chứng điện; mỗi nhóm edge của checkpoint được biên tập từ nội dung <code>lesson.steps</code> và kiểm chứng là tập con của canonical sample; thứ tự sample không sinh yêu cầu tự động.

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

## Checkpoint biên tập từ nội dung 16 bài

Registry <code>src/practice-checkpoints.js</code> ghi rõ **48 checkpoint**, mỗi bài 3 bước. Ở bước thực sự nêu rõ kết nối, mỗi <code>wiring</code> checkpoint đưa ra tập edge tham chiếu được biên tập và giới hạn bằng canonical <code>sampleWires(lessonId)</code>. Các bước chỉ quan sát bo, thay giá trị slider, thử nút, chạy mô phỏng hoặc so sánh hành vi được gắn <code>manual</code> — không có yêu cầu dây ẩn. **Không tích lũy nhóm dây bằng phép chia đều tự động.**

Mỗi kết quả trả <code>checkpoint</code> deep-frozen gồm ID, nội dung bước gốc, loại <code>manual/wiring</code>, hướng dẫn và <code>provenance</code>. Nguồn là <code>lessons.steps</code>, schema <code>human-authored-from-lesson-text</code>; trường <code>teacherValidated</code>, <code>hardwareValidated</code>, <code>prerequisiteForAdvance</code> đều là false. Bước manual không được chấm topology dù bản tự đấu đã có dây.

Xem bảng mapping và từng cặp chân trong <code>docs/AUTHORED_PRACTICE_CHECKPOINTS.md</code>. Không coi nội dung biên tập này là chương trình học được chuyên gia xác nhận, thao tác thực tế của người học hoặc bằng chứng mastery.

## Edge comparison

Endpoint comparison là unordered:

~~~text
D13 ↔ R1:A
R1:A ↔ D13
~~~

được coi là cùng một edge.

<code>matched</code> và <code>required</code> là số lượng edge bắt buộc của checkpoint wiring đang chọn.

<code>missingPairs</code> gồm edge thuộc checkpoint wiring chưa có trong learner graph.

<code>extraPairs</code> chỉ gồm learner edges không thuộc toàn bộ reference sample. Vì vậy một learner đã nối sớm một edge thuộc sample của step sau không bị gọi là extra.

## Status

### manual-checkpoint

Bài 01 và các bước thao tác/quan sát của bài 02–16. Bước manual không gán pass/fail từ wiring, nhưng vẫn kiểm tra input canonical của bài có netlist.

### not-attempted

Không có learner draft. Reference sample tồn tại nhưng không được tính như learner action.

### needs-correction

Learner graph có:

- edge ngoài reference sample; hoặc
- issue mức <code>error</code> từ canonical circuit-router analysis.

Không thể là success.

### incomplete

Learner draft có tồn tại nhưng thiếu ít nhất một reference edge đã biên tập cho bước wiring.

### step-sample-match

Các required sample edges của checkpoint wiring đang chọn đã có, không có extra/error, nhưng chưa exact full-reference match.

### signal-step-match

Tương tự <code>step-sample-match</code>, nhưng lesson có <code>scope: "signal-only"</code>.

### topology-match

Chỉ khi:

- checkpoint hiện tại là <code>wiring</code>;
- learner graph có exact same unordered edge set như canonical reference sample;
- không có extra edge/error.

Nó chỉ có nghĩa topology match với sample, không có nghĩa người học đã tự làm, không phải measurement và không phải mastery.

### signal-topology-match

Full sample match trên checkpoint wiring thuộc phạm vi signal-only (bài 14); bài 10 các bước hiện tại đều được biên tập là manual nên không tự có status này.

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
  sampleEdgeGrouping: "human-authored-step-checkpoint",
  checkpointEditorialProvenance: "human-authored-from-lesson-text",
  teacherValidated: false,
  checkpointPrerequisiteForAdvance: false,
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

## Example — full lesson 02 sample, wiring checkpoint step 1

~~~js
{
  lessonId: 2,
  stepIndex: 0,
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

<code>tests/practice-evidence-contracts.js</code> hiện có 49 checks, cộng 37 checkpoint contracts:

- final evidence cho đủ 16 lessons;
- lesson01 manual-only ở mọi step;
- authored per-step groups và trạng thái manual ở các bước timing/mô phỏng;
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
- actions “Mở sơ đồ 2D” và “Mở 3D” chỉ đổi UI stage;
- action “Kiểm tra lại” chỉ recompute evidence;
- không mutation lesson progress chỉ vì <code>topology-match</code>.
