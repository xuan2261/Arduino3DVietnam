# Sketch Lexical Feedback — post-c7f candidate

## Mục tiêu

`src/sketch-review.js` tiếp tục là bộ review source cục bộ cho editor Sketch. API không đổi:

```js
inspectSketchDraft({ lessonId, reference, draft })
```

`src/sketch-review-ui.js` tiếp tục render qua:

```js
renderSketchReview(document, inspection)
```

Phần cải tiến này thêm **lexical feedback** để người học thấy những dấu hiệu source nào
trong Sketch tham khảo đã biến mất hoặc xuất hiện ít hơn trong bản nháp. Đây vẫn là
phép quét văn bản có giới hạn, không phải Arduino/C++ compiler, parser đầy đủ, firmware
runtime, AVR parity check hoặc bằng chứng waveform/phần cứng.

## Boundary chính

Lexical scan chạy trên source sau bước mask:

1. comment một dòng `// ...`;
2. comment khối `/* ... */`;
3. string literal `"..."`;
4. char literal `'...'`.

Ký tự newline được giữ lại trong bản masked để line number không dịch. Nội dung comment
và string/char được thay bằng khoảng trắng trước khi tìm pattern.

Hệ quả quan trọng:

- `// digitalWrite(LED, HIGH);` không được tính là lời gọi `digitalWrite(...)`;
- chuỗi `"analogRead(A0)"` không được tính là `analogRead(...)`;
- comment chứa `INPUT_PULLUP`, `for (...)`, `Serial.println(...)` không thể làm
  lexical feedback báo pattern đó hiện diện;
- tên gần giống như `digitalWriteX(...)` hoặc `delayish(...)` không khớp pattern
  chuẩn vì pattern dùng word boundary.

Kết quả `present` chỉ có nghĩa **pattern lexical xuất hiện trong phần source không bị
mask**. Nó không chứng minh câu lệnh compile, chạy đúng, đạt mục tiêu bài học hay do
người học thực hiện đúng.

## Pattern reference được theo dõi

Danh sách pattern là tập nhỏ, minh bạch và cố định trong module:

- `#include <Servo.h>`;
- `pinMode(...)`;
- `digitalWrite(...)`;
- `digitalRead(...)`;
- `analogRead(...)`;
- `analogWrite(...)`;
- `tone(...)`;
- `noTone(...)`;
- `delay(...)`;
- `delayMicroseconds(...)`;
- `pulseIn(...)`;
- `map(...)`;
- `Serial.begin(...)`;
- `Serial.println(...)`;
- member call `*.attach(...)`;
- member call `*.write(...)`;
- `for (...)`;
- `if (...)`;
- token `INPUT_PULLUP`.

Không có bảng hard-code “bài 01 phải làm X, bài 02 phải làm Y”. Với mỗi lesson, module
quét **Sketch tham khảo đang được caller truyền vào** và chỉ theo dõi những pattern thực
sự xuất hiện ở reference đó. Vì vậy cả 16 bài dùng cùng một cơ chế provenance:
`lesson-reference → masked pattern baseline → editor-draft comparison`.

## Result contract bổ sung

Các field cũ vẫn giữ nguyên. Result thêm:

```text
lexical: {
  mode: "masked-reference-pattern-scan",
  commentsAndStringsIgnored: true,
  expectedFeatureCount,
  presentFeatureCount,
  differenceCount,
  findings: [
    {
      id,
      label,
      status: "present" | "absent" | "fewer-than-reference",
      referenceCount,
      draftCount,
      referenceLine,
      draftLine,
      hint
    }
  ]
}
```

Giới hạn tối đa là `SKETCH_REVIEW_LIMITS.maxLexicalFeatures = 24`.

Ý nghĩa status:

| Status | Ý nghĩa source-only |
| --- | --- |
| `present` | Bản nháp có số lần match bằng hoặc nhiều hơn reference |
| `absent` | Reference có pattern nhưng bản nháp không có match ngoài comment/string |
| `fewer-than-reference` | Bản nháp vẫn có pattern nhưng số lần ít hơn reference |

`referenceLine` là dòng match đầu tiên trong Sketch mẫu. `draftLine` là dòng match
đầu tiên trong bản nháp khi còn match; `absent` dùng `draftLine: null`.

Mỗi finding có hint tĩnh gắn với pattern, ví dụ đối chiếu chân digital, kênh analog,
PWM, thời gian delay, Serial hoặc vòng lặp. Hint là điểm bắt đầu để người học kiểm tra
source; nó không ra phán quyết đúng/sai về ngữ nghĩa C++.

Result vẫn deep-frozen, bao gồm `lexical`, mảng `findings` và từng finding.
`provenance.lexical` là `masked-reference-pattern-scan`.

## Heuristic syntax bổ sung

Ngoài brace scan hiện hữu, source masked còn được quét cặp:

- ngoặc tròn `(` / `)`;
- ngoặc vuông `[` / `]`.

Warning mới:

- `PAREN_EXTRA_CLOSE`;
- `PAREN_UNCLOSED_OPEN`;
- `BRACKET_EXTRA_CLOSE`;
- `BRACKET_UNCLOSED_OPEN`.

Warning giữ line number của ký tự mở/đóng liên quan. Comment/string đã mask nên các
dấu ngoặc bên trong chúng không tạo false warning.

Đây chỉ là delimiter scan. Nó không hiểu template, macro, overload, type checking,
scope, declaration-vs-call hoặc grammar C++ đầy đủ.

## UI accessible feedback

Renderer giữ nguyên root và selectors cũ, đồng thời thêm:

| Selector / attribute | Ý nghĩa |
| --- | --- |
| `[data-sketch-review-lexical]` | block lexical feedback |
| `[data-sketch-review-lexical-summary]` | summary có `role="status"`, `aria-live="polite"`, `aria-atomic="true"` |
| `data-sketch-review-lexical-difference-count` | số loại pattern khác reference |
| `[data-sketch-review-lexical-finding="<id>"]` | một finding khác reference |
| `data-sketch-review-lexical-status` | `absent` hoặc `fewer-than-reference` trên row |

Row khác biệt hiển thị line reference, line draft nếu có, count so với mẫu và hint.
Renderer không tạo button/callback/state. Dữ liệu động tiếp tục đi qua `textContent`,
không dùng `innerHTML`.

Nếu lexical result bị forge với mode sai, aggregate counts không khớp, hoặc một finding
khai `present` nhưng `draftCount=0`/`draftLine=null`, renderer fail closed thay vì
trình bày object không nhất quán.

## Negative cases đã khóa

`tests/sketch-review-contracts.js` bổ sung:

- cả 16 reference Sketch có baseline lexical hợp lệ, line-aware và `differenceCount=0`;
- commented-out và quoted reference calls không tính là presence;
- giảm số lần `digitalWrite(...)` tạo `fewer-than-reference`;
- `digitalWriteX` / `delayish` không giả pattern chuẩn;
- ngoặc tròn/vuông lệch tạo warning có line;
- comment/string chứa delimiter không tạo warning;
- lexical result tiếp tục deep-frozen và có provenance rõ.

`tests/sketch-review-ui-contracts.js` bổ sung:

- lexical summary là accessible live status;
- commented-out call render finding line-aware và nói rõ đã bỏ qua comment/string;
- parenthesis warning render đúng line và lexical boundary;
- lexical label/hint giả HTML vẫn chỉ là text;
- forged lexical mode/count/status/line shape bị từ chối;
- cả 16 canonical reference render lexical difference count bằng 0.

## Claims vẫn bắt buộc false

Không thay đổi các boundary:

```text
compiled = false
semanticValidated = false
firmwareExecuted = false
simulationBehaviorValidated = false
hardwareValidated = false
learnerCompletion = false
learnerMastery = false
```

Lexical presence, kể cả khi mọi tracked pattern giống reference, không được nâng thành
compiler success, Arduino firmware parity, AVR behavior, physical waveform hoặc learner
completion/mastery.

## Validation và release

Worker này chỉ chạy narrow Bun contracts cho model/UI. Không chạy E2E/Chrome, không sửa
`app.js`, `index.html`, CSS, build, Service Worker, circuit-router, lesson data,
firmware hoặc release state.

Validation cuối trên source đã freeze:

- `runSketchReviewContracts()`: **19/19 PASS**; toàn bộ **15 checks cũ vẫn giữ và pass**,
  cộng 4 checks lexical/syntax mới;
- `runSketchReviewUiContracts()`: **14/14 PASS**; toàn bộ **11 checks cũ vẫn giữ và pass**,
  cộng 3 checks accessible lexical/tampering mới;
- Bun whitespace scan trên 5 file owned: **clean**.

Tài liệu này là candidate source documentation. Việc public qua Pages/build allowlist
thuộc prime và cần final-SHA evidence riêng.
