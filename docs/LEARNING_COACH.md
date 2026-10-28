# Learning Coach — tiến trình học thuần dữ liệu

`src/learning-coach.js` là lớp hướng dẫn học tập thuần và xác định cho 16 bài hiện có. Module không tự tạo giáo trình mới: instruction lấy trực tiếp từ `lesson.steps`; checkpoint/hint chỉ kết hợp `goal`, `insight`, `caution`, bảng `wiring` và kết quả circuit analyzer đã có.

## API

```js
import { getLessonGuidance, getWiringFeedback } from "./src/learning-coach.js";

const guidance = getLessonGuidance(lesson, circuitAnalysis);
const wiring = getWiringFeedback(circuitAnalysis);
```

`getLessonGuidance(lesson, circuitAnalysis?)` trả:

```text
{
  schemaVersion, lessonId, title,
  microsteps: [{ id, instruction, checkpoint, hint }],
  hint, nextAction,
  wiring: null | getWiringFeedback(...),
  boundaries
}
```

`getWiringFeedback(analysis)` giữ nguyên code/message/terminal của issue từ circuit analyzer và thêm phản hồi xử lý theo nhóm issue. Trạng thái có thứ tự fail-closed: `unsupported`, `unsafe`, `signal-only-complete`, `incomplete`, `topology-complete`.

## Ranh giới topology

Learning Coach không phải bộ giải điện và không sinh output cảm biến/phần cứng. `topology-complete` chỉ có nghĩa các đường chức năng mà circuit engine định nghĩa đã đạt và không có issue mức lỗi. Không suy ra dòng, điện áp, timing, tải, độ an toàn hay hành vi của bo vật lý từ nhãn này.

Bài 10 và 14 giữ đúng ranh giới `signal-only` của `circuit-extended.js`: ngay cả preset có đủ signal path, feedback chỉ trả `signal-only-complete`; không bao giờ đổi thành `topology-complete` hay `functional`. Phần nguồn công suất/tải motor hoặc bơm nằm ngoài checker.

Phản hồi issue dùng chính `analysis.issues`: short/net merge/bypass/polarity/stuck signal được ưu tiên thành `unsafe`; missing/incomplete path thành `incomplete`. Learning Coach không thêm “confidence score” và luôn trả `confidenceClaim: false`.

## Tiến trình và riêng tư

Module không đọc/ghi `localStorage`, `sessionStorage`, cookie, tài khoản, mạng hoặc API. Nó không biết người học là ai và không lưu trạng thái hoàn thành. Nếu UI sau này muốn lưu tiến độ học chi tiết, đó phải là lựa chọn **opt-in** riêng của người học và không thuộc API hiện tại.

Sketch C++/HEX cũng không được thực thi bởi Learning Coach. Phản hồi chỉ dựa trên dữ liệu lesson và circuit analysis do caller truyền vào; ranh giới firmware/phần cứng tiếp tục thuộc các module AVR và tài liệu tương ứng.

## Browser contract

Khi website local đang chạy, mở một tab Chrome và gọi:

```js
import("/tests/learning-coach-contracts.js")
  .then(m => console.log(m.runLearningCoachContracts()));
```

Contract trực tiếp phủ đủ 16 bài, derivation từ lesson data, topology incomplete/unsafe/complete, hai lesson signal-only 10/14, issue feedback theo code, tính xác định, defensive copy và fail-closed input. Không cần Node hoặc dependency mới.
