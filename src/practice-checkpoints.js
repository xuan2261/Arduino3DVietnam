/**
 * Human-authored practice checkpoints derived from the Vietnamese lesson steps.
 *
 * A wiring checkpoint is editorially associated with a lesson step only when
 * that step names a concrete connection/pin relationship that can be mapped
 * without inventing a physical breadboard placement. All other steps remain
 * manual observation/simulation checkpoints.
 *
 * The mappings below are project editorial metadata, not teacher validation,
 * not proof of learner action, and never a prerequisite for advancing a lesson.
 */
import {
  listTerminals,
  sampleWires,
  supportedWiringLessons,
} from "./circuit-router.js";

const SCHEME = "human-authored-from-lesson-text";
const SOURCE = "lessons.steps";

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function rawManual(sourceStep, guidance, rationale) {
  return { kind: "manual", sourceStep, guidance, rationale, requiredPairs: [] };
}

function rawWiring(sourceStep, guidance, rationale, requiredPairs) {
  return { kind: "wiring", sourceStep, guidance, rationale, requiredPairs };
}

const RAW = {
  1: [
    rawManual(
      "Quan sát cổng USB-B, IC ATmega328P và các hàng chân D0–D13, A0–A5.",
      "Quan sát các khối chính và hàng chân trên mô hình; bước này không có dây ngoài để đối chiếu.",
      "Bước yêu cầu quan sát bo mạch, không yêu cầu tạo kết nối ngoài.",
    ),
    rawManual(
      "Bật công tắc LED L giả lập rồi nhấn Chạy mô phỏng.",
      "Bật LED L giả lập và chạy mô phỏng để quan sát phản hồi của đèn tích hợp.",
      "Bước là thao tác điều khiển/mô phỏng với LED tích hợp.",
    ),
    rawManual(
      "Thử xoay mô hình, mở sơ đồ chân và quan sát đèn L.",
      "Xoay mô hình, mở sơ đồ chân và quan sát LED L; không có checkpoint dây ngoài.",
      "Bước là quan sát 3D/pinout, không phải thao tác đấu dây.",
    ),
  ],
  2: [
    rawWiring(
      "Xác định chân D13 và cực LED trong sơ đồ.",
      "Đối chiếu nhánh mẫu D13 → điện trở → anode LED và cathode LED → GND trong bản tự đấu.",
      "Bước nêu D13 và cực LED; nhánh LED mẫu là quan hệ nối trực tiếp tương ứng, không gán yêu cầu cho các bước timing/mô phỏng sau.",
      [["D13", "R1:A"], ["R1:B", "LED:A"], ["LED:K", "GND"]],
    ),
    rawManual(
      "Chọn thời gian giữ LED sáng/tắt ở thanh trượt.",
      "Điều chỉnh thời gian sáng/tắt bằng thanh trượt; bước này kiểm tra timing, không kiểm tra wiring.",
      "Bước nói về tham số thời gian, không nêu thao tác nối dây.",
    ),
    rawManual(
      "Chạy mô phỏng rồi thay đổi thời gian và quan sát nhịp nhấp nháy.",
      "Chạy mô phỏng, đổi khoảng thời gian và quan sát nhịp LED; không dùng topology làm điều kiện cho bước này.",
      "Bước là chạy/quan sát mô phỏng, không phải checkpoint đấu dây.",
    ),
  ],
  3: [
    rawWiring(
      "Quan sát đường 5V → nút → D2 và điện trở kéo xuống D2 → GND.",
      "Đối chiếu đúng hai nhánh được nêu: 5V → nút → D2 và D2 → điện trở kéo xuống → GND.",
      "Bước mô tả rõ hai đường nối của nút và pull-down; nhánh LED không được đưa vào checkpoint này vì không được nêu trong bước.",
      [["5V", "BTN:1"], ["BTN:2", "D2"], ["D2", "R_PULL:A"], ["R_PULL:B", "GND"]],
    ),
    rawManual(
      "Chọn chế độ Giữ nút, chạy mô phỏng và ấn giữ nút đỏ.",
      "Chọn chế độ Giữ, chạy mô phỏng và thử giữ nút đỏ; đây là checkpoint hành vi mô phỏng.",
      "Bước mô tả chế độ và thao tác nút, không thêm quan hệ nối dây mới.",
    ),
    rawManual(
      "Đổi sang chế độ Bật/tắt; nhấn và thả nhiều lần để quan sát LED đổi trạng thái.",
      "Đổi sang Bật/tắt rồi nhấn/thả để quan sát LED; không dùng wiring sample để chấm bước này.",
      "Bước kiểm tra hành vi cạnh nhấn trong mô phỏng.",
    ),
  ],
  4: [
    rawWiring(
      "Xem chân giữa biến trở nối với A0.",
      "Đối chiếu kết nối trực tiếp giữa chân giữa (wiper) của biến trở và A0.",
      "Bước chỉ nêu quan hệ wiper ↔ A0, nên checkpoint không tự thêm nguồn biến trở hay nhánh LED.",
      [["A0", "POT:WIPER"]],
    ),
    rawManual(
      "Kéo thanh trượt từ 0 đến 1023 rồi bấm Chạy.",
      "Kéo giá trị A0 trên thanh trượt rồi chạy mô phỏng; đây là thao tác dữ liệu giả lập.",
      "Bước thay đổi control ADC, không yêu cầu nối dây.",
    ),
    rawManual(
      "Quan sát giá trị ADC và độ sáng LED thay đổi.",
      "Quan sát ADC và độ sáng LED trong mô phỏng; không suy ra trạng thái phần cứng thật.",
      "Bước là quan sát kết quả mô phỏng.",
    ),
  ],
  5: [
    rawWiring(
      "Nhận biết từng chân R, G, B và cathode chung.",
      "Đối chiếu phía LED của ba kênh R/G/B qua điện trở và cathode chung về GND theo sample.",
      "Bước tập trung nhận biết các cực màu và cathode chung; checkpoint chỉ lấy các cạnh chạm trực tiếp các cực RGB, không tự gán chân PWM chưa nêu trong bước.",
      [["R_R:B", "RGB:R"], ["R_G:B", "RGB:G"], ["R_B:B", "RGB:B"], ["RGB:K", "GND"]],
    ),
    rawManual(
      "Thay đổi từng thanh trượt từ 0 đến 255.",
      "Thay đổi ba giá trị PWM giả lập từ 0 đến 255; bước này không chấm wiring.",
      "Bước là thao tác control màu.",
    ),
    rawManual(
      "Chạy mô phỏng và kết hợp nhiều kênh để tạo màu mới.",
      "Chạy mô phỏng và thử phối các kênh màu; quan sát kết quả thay vì dùng topology làm điều kiện.",
      "Bước là mô phỏng phối màu.",
    ),
  ],
  6: [
    rawWiring(
      "Đọc sơ đồ LDR và điện trở tạo cầu chia áp.",
      "Đối chiếu bốn cạnh của cầu chia áp LDR mẫu: 5V → LDR → A0 và A0 → điện trở → GND.",
      "Bước trực tiếp yêu cầu đọc cấu trúc cầu chia áp; nhánh LED cảnh báo không thuộc nội dung bước này.",
      [["5V", "LDR:A"], ["LDR:B", "A0"], ["A0", "R_DIV:A"], ["R_DIV:B", "GND"]],
    ),
    rawManual(
      "Chỉnh mức ánh sáng giả lập ở A0.",
      "Chỉnh mức ánh sáng giả lập ở A0; đây là input mô phỏng, không phải phép đo thật.",
      "Bước thay đổi tham số mô phỏng.",
    ),
    rawManual(
      "Chạy mô phỏng, thử giá trị nhỏ hơn và lớn hơn 400.",
      "Chạy mô phỏng với giá trị hai phía ngưỡng 400 và quan sát kết quả.",
      "Bước kiểm tra logic ngưỡng mô phỏng.",
    ),
  ],
  7: [
    rawWiring(
      "Nhận biết Trig phát xung và Echo nhận thời gian phản hồi.",
      "Đối chiếu hai đường tín hiệu mẫu D7 → Trig và D8 → Echo; nguồn cảm biến và nhánh LED không được gán vào checkpoint này.",
      "Bước nêu vai trò Trig/Echo; hai cạnh tín hiệu là ánh xạ trực tiếp, còn các cạnh nguồn/LED không được bước này đề cập.",
      [["D7", "SONAR:TRIG"], ["D8", "SONAR:ECHO"]],
    ),
    rawManual(
      "Thay đổi khoảng cách từ 2 đến 400 cm.",
      "Thay đổi khoảng cách giả lập trong dải 2–400 cm; không coi đây là phép đo vật lý.",
      "Bước điều chỉnh tham số mô phỏng.",
    ),
    rawManual(
      "Kiểm tra thời điểm LED cảnh báo sáng khi dưới 20 cm.",
      "Quan sát điều kiện cảnh báo dưới 20 cm trong mô phỏng; bước này không thêm wiring requirement.",
      "Bước kiểm tra hành vi ngưỡng.",
    ),
  ],
  8: [
    rawWiring(
      "Xem cực (+) và (−) của buzzer.",
      "Đối chiếu cực (+) buzzer với D8 và cực (−) với GND theo sample.",
      "Bước nêu trực tiếp hai cực buzzer; sample có đúng hai cạnh tương ứng.",
      [["D8", "BUZZ:+"], ["GND", "BUZZ:-"]],
    ),
    rawManual(
      "Chỉnh tần số rồi bật công tắc âm.",
      "Chỉnh tần số và công tắc âm trong mô phỏng; không chấm wiring ở bước này.",
      "Bước là thao tác control âm thanh.",
    ),
    rawManual(
      "Chạy mô phỏng, quan sát tần số và thay đổi qua ba mức.",
      "Chạy mô phỏng và so sánh ba mức tần số hiển thị.",
      "Bước là quan sát mô phỏng.",
    ),
  ],
  9: [
    rawManual(
      "Xem bảng tần số các nốt.",
      "Đọc bảng tần số nốt; bước này không nêu quan hệ nối dây cụ thể để chấm topology.",
      "Bước học về tần số, không phải wiring.",
    ),
    rawManual(
      "Nhấn Chạy mô phỏng, chọn Đô/Rê/Mi...",
      "Chạy mô phỏng rồi chọn các nốt để quan sát tần số tương ứng.",
      "Bước là tương tác piano mô phỏng.",
    ),
    rawManual(
      "So sánh nốt thấp và nốt cao bằng giá trị Hz.",
      "So sánh giá trị Hz giữa nốt thấp và cao; không dùng netlist làm điều kiện cho bước này.",
      "Bước là so sánh khái niệm tần số.",
    ),
  ],
  10: [
    rawManual(
      "Quan sát vị trí driver giữa Arduino và động cơ.",
      "Quan sát vai trò driver giữa Arduino và động cơ; bước không nêu một cặp chân cụ thể đủ để tạo wiring checkpoint.",
      "Bước chỉ mô tả kiến trúc/vị trí driver; sample của bài cũng chỉ là phía tín hiệu/GND, không phải đường công suất hoàn chỉnh.",
    ),
    rawManual(
      "Chỉnh tốc độ và chiều quay.",
      "Điều chỉnh tốc độ và chiều quay trong mô phỏng.",
      "Bước là thao tác control động cơ.",
    ),
    rawManual(
      "Chạy mô phỏng và thử đảo chiều khi tốc độ khác 0.",
      "Chạy mô phỏng và thử đảo chiều khi tốc độ khác 0; không suy ra chức năng phần cứng thật.",
      "Bước kiểm tra hành vi mô phỏng.",
    ),
  ],
  11: [
    rawManual(
      "Xem nguyên tắc 10 mV tương ứng 1 °C của LM35.",
      "Đọc nguyên tắc quy đổi LM35; bước này không nêu thao tác nối dây cụ thể.",
      "Bước là kiến thức cảm biến.",
    ),
    rawManual(
      "Điều chỉnh nhiệt độ giả lập từ 0 đến 60 °C.",
      "Điều chỉnh nhiệt độ giả lập 0–60 °C; không coi đây là phép đo thật.",
      "Bước thay đổi input mô phỏng.",
    ),
    rawManual(
      "Chạy mô phỏng và quan sát trạng thái vượt ngưỡng 30 °C.",
      "Chạy mô phỏng và quan sát trạng thái hai phía ngưỡng 30 °C.",
      "Bước kiểm tra logic ngưỡng mô phỏng.",
    ),
  ],
  12: [
    rawWiring(
      "Nhận biết chân nguồn, GND và tín hiệu servo.",
      "Đối chiếu tín hiệu D9 → servo SIG, nguồn servo riêng → VCC/GND và mass Arduino nối chung với cực âm nguồn servo.",
      "Bước nêu đủ ba vai trò tín hiệu/nguồn/GND; sample thể hiện bốn cạnh cần để biểu diễn các vai trò đó.",
      [["D9", "SERVO:SIG"], ["SERVO_SUPPLY:+", "SERVO:VCC"], ["SERVO_SUPPLY:-", "SERVO:GND"], ["GND", "SERVO_SUPPLY:-"]],
    ),
    rawManual(
      "Điều chỉnh góc ở thanh trượt.",
      "Điều chỉnh góc servo trên thanh trượt; đây là input mô phỏng.",
      "Bước là thao tác control.",
    ),
    rawManual(
      "Chạy mô phỏng và quan sát trục servo quay.",
      "Chạy mô phỏng và quan sát trục servo; không coi chuyển động mô phỏng là xác nhận phần cứng.",
      "Bước là quan sát mô phỏng.",
    ),
  ],
  13: [
    rawWiring(
      "Tìm chân STEP và DIR của driver.",
      "Đối chiếu hai cạnh điều khiển mẫu D2 → STEP và D3 → DIR; các cạnh nguồn động cơ không được gán vào checkpoint này.",
      "Bước chỉ nêu STEP và DIR, nên checkpoint chỉ chứa hai cạnh điều khiển tương ứng.",
      [["D2", "DRV:STEP"], ["D3", "DRV:DIR"]],
    ),
    rawManual(
      "Chỉnh số bước từ 0 đến 200.",
      "Chỉnh số bước trong mô phỏng từ 0 đến 200.",
      "Bước là thao tác control.",
    ),
    rawManual(
      "Chạy mô phỏng và so sánh góc quay với 200 bước/vòng.",
      "Chạy mô phỏng và so sánh góc quay với quy ước 200 bước/vòng.",
      "Bước là quan sát/so sánh mô phỏng.",
    ),
  ],
  14: [
    rawWiring(
      "Xác định tín hiệu cảm biến và chân điều khiển bơm.",
      "Đối chiếu hai cạnh tín hiệu mẫu A0 → SOIL SIG và D8 → PUMP IN; đây chỉ là phía tín hiệu, không xác nhận đường công suất bơm.",
      "Bước nêu tín hiệu cảm biến và chân điều khiển bơm; sample của lesson 14 cố ý chỉ bao phủ phía tín hiệu/GND.",
      [["A0", "SOIL:SIG"], ["D8", "PUMP:IN"]],
    ),
    rawManual(
      "Chỉnh độ ẩm giả lập xuống dưới 35%.",
      "Chỉnh độ ẩm giả lập xuống dưới 35%; bước này không chấm topology.",
      "Bước thay đổi input mô phỏng.",
    ),
    rawManual(
      "Chạy mô phỏng và theo dõi bơm bật/tắt.",
      "Theo dõi trạng thái bơm trong mô phỏng; không coi đó là xác nhận tải hay phần cứng thật.",
      "Bước là quan sát hành vi mô phỏng.",
    ),
  ],
  15: [
    rawWiring(
      "Xem mạch chia áp của FSR.",
      "Đối chiếu bốn cạnh của mạch chia áp FSR mẫu: 5V → FSR → A0 và A0 → điện trở → GND.",
      "Bước trực tiếp nêu mạch chia áp; nhánh LED cảnh báo không được đưa vào checkpoint này.",
      [["5V", "FSR:A"], ["FSR:B", "A0"], ["A0", "R_DIV:A"], ["R_DIV:B", "GND"]],
    ),
    rawManual(
      "Điều chỉnh chỉ số ADC theo lực nhấn giả lập.",
      "Điều chỉnh ADC giả lập theo lực nhấn; đây không phải phép đo lực thật.",
      "Bước thay đổi input mô phỏng.",
    ),
    rawManual(
      "Chạy mô phỏng và thử vượt ngưỡng 650.",
      "Chạy mô phỏng và thử giá trị hai phía ngưỡng 650.",
      "Bước kiểm tra logic ngưỡng mô phỏng.",
    ),
  ],
  16: [
    rawWiring(
      "Đối chiếu bảng chân: LDR chia áp A0, LM35 A1, nút D2–GND với INPUT_PULLUP, LED D13 qua điện trở, buzzer D8.",
      "Đối chiếu toàn bộ sample pin table của bước: LDR/A0, LM35/A1, nút D2–GND, LED D13 qua điện trở và buzzer D8–GND.",
      "Bước liệt kê rõ toàn bộ năm nhánh và chân tương ứng, nên checkpoint ánh xạ toàn bộ reference sample topology của bài.",
      [
        ["5V", "LDR:A"], ["LDR:B", "A0"], ["A0", "R_LDR:A"], ["R_LDR:B", "GND"],
        ["5V", "LM35:VS"], ["A1", "LM35:VOUT"], ["GND", "LM35:GND"],
        ["D2", "BTN:1"], ["BTN:2", "GND"],
        ["D13", "R_LED:A"], ["R_LED:B", "LED:A"], ["LED:K", "GND"],
        ["D8", "BUZZ:+"], ["BUZZ:-", "GND"],
      ],
    ),
    rawManual(
      "Đặt ánh sáng dưới 400 để kiểm tra LED và tăng nhiệt độ trên 30 °C để xem cảnh báo.",
      "Đặt ánh sáng và nhiệt độ giả lập qua hai ngưỡng rồi quan sát LED/cảnh báo.",
      "Bước kiểm tra logic mô phỏng, không thêm yêu cầu wiring.",
    ),
    rawManual(
      "Nhấn và giữ nút điều khiển để tạm tắt đèn; cảnh báo nhiệt vẫn hoạt động độc lập.",
      "Nhấn giữ nút trong mô phỏng và quan sát đèn/cảnh báo nhiệt hoạt động độc lập.",
      "Bước kiểm tra tương tác mô phỏng, không thêm yêu cầu wiring.",
    ),
  ],
};

function pairKey(a, b) {
  return a < b ? a + "\u0000" + b : b + "\u0000" + a;
}

function buildRegistry() {
  const registry = {};
  for (const [lessonIdText, definitions] of Object.entries(RAW)) {
    const lessonId = Number(lessonIdText);
    registry[lessonId] = definitions.map((definition, stepIndex) => deepFreeze({
      id: "lesson-" + String(lessonId).padStart(2, "0") + "-step-" + String(stepIndex + 1).padStart(2, "0"),
      lessonId,
      stepIndex,
      kind: definition.kind,
      sourceStep: definition.sourceStep,
      guidance: definition.guidance,
      requiredPairs: definition.requiredPairs.map(pair => [...pair]),
      provenance: {
        scheme: SCHEME,
        source: SOURCE,
        editorial: true,
        rationale: definition.rationale,
        teacherValidated: false,
        hardwareValidated: false,
        prerequisiteForAdvance: false,
      },
    }));
    Object.freeze(registry[lessonId]);
  }
  return Object.freeze(registry);
}

const CHECKPOINTS = buildRegistry();

function validateRegistryAgainstRouter() {
  const supported = new Set(supportedWiringLessons());
  for (let lessonId = 1; lessonId <= 16; lessonId += 1) {
    const checkpoints = CHECKPOINTS[lessonId];
    if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
      throw new Error("Thiếu authored practice checkpoints cho lesson " + lessonId + ".");
    }
    const wiring = checkpoints.filter(item => item.kind === "wiring");
    if (!wiring.length) continue;
    if (!supported.has(lessonId)) {
      throw new Error("Lesson " + lessonId + " có wiring checkpoint nhưng circuit-router không hỗ trợ.");
    }
    const terminals = new Set(listTerminals(lessonId).map(item => item.id));
    const sample = new Set(sampleWires(lessonId).map(pair => pairKey(pair[0], pair[1])));
    for (const checkpoint of wiring) {
      if (!checkpoint.requiredPairs.length) {
        throw new Error(checkpoint.id + " là wiring checkpoint nhưng không có requiredPairs.");
      }
      const seen = new Set();
      for (const pair of checkpoint.requiredPairs) {
        if (!Array.isArray(pair) || pair.length !== 2 || !terminals.has(pair[0]) || !terminals.has(pair[1])) {
          throw new Error(checkpoint.id + " chứa terminal không canonical.");
        }
        const key = pairKey(pair[0], pair[1]);
        if (seen.has(key)) throw new Error(checkpoint.id + " chứa edge lặp.");
        if (!sample.has(key)) throw new Error(checkpoint.id + " chứa edge ngoài circuit-router sample.");
        seen.add(key);
      }
    }
  }
}

validateRegistryAgainstRouter();

function requireLessonShape(lesson) {
  if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) {
    throw new TypeError("lesson phải là object dữ liệu bài học.");
  }
  if (!Number.isInteger(lesson.id) || lesson.id < 1 || lesson.id > 16) {
    throw new RangeError("lesson.id phải là số nguyên 1..16.");
  }
  if (!Array.isArray(lesson.steps)) {
    throw new TypeError("lesson.steps phải là mảng.");
  }
  const authored = CHECKPOINTS[lesson.id];
  if (lesson.steps.length !== authored.length) {
    throw new RangeError("lesson.steps không khớp authored checkpoint registry.");
  }
  for (let index = 0; index < authored.length; index += 1) {
    if (lesson.steps[index] !== authored[index].sourceStep) {
      throw new RangeError("lesson.steps[" + index + "] không khớp nội dung đã dùng để biên tập checkpoint.");
    }
  }
  return authored;
}

export const PRACTICE_CHECKPOINT_PROVENANCE = Object.freeze({
  scheme: SCHEME,
  source: SOURCE,
  teacherValidated: false,
  hardwareValidated: false,
  prerequisiteForAdvance: false,
});

export function getPracticeCheckpoint(lesson, stepIndex) {
  const authored = requireLessonShape(lesson);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= authored.length) {
    throw new RangeError("stepIndex phải thuộc authored lesson.steps.");
  }
  return authored[stepIndex];
}

export function listPracticeCheckpoints(lesson) {
  return requireLessonShape(lesson);
}
