/**
 * Pure, immutable, bounded in-session practice activity observations.
 *
 * The journal records only event types explicitly reported to this module by its
 * caller. The host app owns the policy that decides which real interactions are
 * reported. The journal contains no clock, timestamp, persistence marker, step
 * attribution, physical-action proof, mastery, completion, prerequisite or
 * teacher-validation claim.
 */
import { getPracticeCheckpoint } from "./practice-checkpoints.js";

const JOURNAL_VERSION = 1;
const MAX_ENTRIES = 128;
const EVENT_TYPES = Object.freeze([
  "view-pinout",
  "view-3d",
  "view-wiring",
  "change-control",
  "start-simulation",
  "edit-sketch",
  "connect-wire",
]);
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const JOURNAL_BRAND = new WeakSet();
const JOURNAL_KEYS = new Set(["version", "entries"]);
const ENTRY_KEYS = new Set(["lessonId", "eventType"]);
const RECORD_KEYS = new Set(["lessonId", "eventType"]);
const INSPECT_KEYS = new Set(["lesson", "stepIndex", "journal"]);

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

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extras(record, allowed) {
  return Object.keys(record).filter(key => !allowed.has(key)).sort();
}

function requireExactRecord(value, allowed, label) {
  if (!isRecord(value)) throw new TypeError(label + " phải là object.");
  const unknown = extras(value, allowed);
  if (unknown.length) {
    throw new RangeError(label + " có field không được hỗ trợ: " + unknown.join(", ") + ".");
  }
  return value;
}

function requireLessonId(value, label = "lessonId") {
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    throw new RangeError(label + " phải là số nguyên 1..16.");
  }
  return value;
}

function requireEventType(value, label = "eventType") {
  if (typeof value !== "string" || !EVENT_TYPE_SET.has(value)) {
    throw new RangeError(label + " không thuộc practice observation allowlist.");
  }
  return value;
}

function normalizeJournal(journal) {
  const source = requireExactRecord(journal, JOURNAL_KEYS, "practice observation journal");
  if (!JOURNAL_BRAND.has(source)) {
    throw new RangeError("practice observation journal không được tạo bởi module observation hiện tại.");
  }
  if (source.version !== JOURNAL_VERSION) {
    throw new RangeError("practice observation journal.version không được hỗ trợ.");
  }
  if (!Array.isArray(source.entries)) {
    throw new TypeError("practice observation journal.entries phải là mảng.");
  }
  if (source.entries.length > MAX_ENTRIES) {
    throw new RangeError("practice observation journal vượt giới hạn " + MAX_ENTRIES + " events.");
  }
  return source.entries.map((entry, index) => {
    const item = requireExactRecord(entry, ENTRY_KEYS, "journal.entries[" + index + "]");
    return Object.freeze({
      lessonId: requireLessonId(item.lessonId, "journal.entries[" + index + "].lessonId"),
      eventType: requireEventType(item.eventType, "journal.entries[" + index + "].eventType"),
    });
  });
}

function expectation(eventTypes, rationale) {
  return Object.freeze({
    eventTypes: Object.freeze([...eventTypes]),
    rationale,
  });
}

const NONE = Object.freeze([]);

// Editorial mapping from exact authored checkpoint IDs to in-app event categories.
// Empty means the lesson step does not explicitly ground one of this module's
// allowlisted event categories. It must not be interpreted as "no activity".
const RAW_EXPECTATIONS = Object.freeze({
  "lesson-01-step-01": expectation(["view-3d"], "Bước yêu cầu quan sát trực tiếp các khối và hàng chân trên bo."),
  "lesson-01-step-02": expectation(["change-control", "start-simulation"], "Bước yêu cầu bật công tắc LED L rồi chạy mô phỏng."),
  "lesson-01-step-03": expectation(["view-3d", "view-pinout"], "Bước yêu cầu xoay mô hình và mở sơ đồ chân."),

  "lesson-02-step-01": expectation(["view-wiring"], "Bước yêu cầu xác định D13 và cực LED trong sơ đồ."),
  "lesson-02-step-02": expectation(["change-control"], "Bước yêu cầu thay đổi thanh trượt thời gian."),
  "lesson-02-step-03": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và thay đổi thời gian."),

  "lesson-03-step-01": expectation(["view-wiring"], "Bước yêu cầu quan sát hai đường nối trong sơ đồ nút nhấn."),
  "lesson-03-step-02": expectation(["change-control", "start-simulation"], "Bước yêu cầu chọn chế độ, chạy mô phỏng và thao tác nút."),
  "lesson-03-step-03": expectation(["change-control"], "Bước yêu cầu đổi chế độ và thao tác nút nhiều lần."),

  "lesson-04-step-01": expectation(["view-wiring"], "Bước yêu cầu xem quan hệ chân giữa biến trở với A0."),
  "lesson-04-step-02": expectation(["change-control", "start-simulation"], "Bước yêu cầu kéo thanh trượt rồi bấm Chạy."),
  "lesson-04-step-03": expectation(NONE, "Bước chỉ yêu cầu quan sát kết quả; không nêu một event trong allowlist hiện tại."),

  "lesson-05-step-01": expectation(["view-wiring"], "Bước yêu cầu nhận biết các chân RGB và cathode chung."),
  "lesson-05-step-02": expectation(["change-control"], "Bước yêu cầu thay đổi các thanh trượt RGB."),
  "lesson-05-step-03": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và kết hợp nhiều kênh."),

  "lesson-06-step-01": expectation(["view-wiring"], "Bước yêu cầu đọc sơ đồ cầu chia áp LDR."),
  "lesson-06-step-02": expectation(["change-control"], "Bước yêu cầu chỉnh mức ánh sáng giả lập."),
  "lesson-06-step-03": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và thử nhiều giá trị."),

  "lesson-07-step-01": expectation(["view-wiring"], "Bước yêu cầu nhận biết Trig và Echo trong mạch."),
  "lesson-07-step-02": expectation(["change-control"], "Bước yêu cầu thay đổi khoảng cách giả lập."),
  "lesson-07-step-03": expectation(NONE, "Bước yêu cầu kiểm tra/quan sát ngưỡng nhưng không nêu một event allowlist cụ thể."),

  "lesson-08-step-01": expectation(["view-wiring"], "Bước yêu cầu xem hai cực buzzer."),
  "lesson-08-step-02": expectation(["change-control"], "Bước yêu cầu chỉnh tần số và công tắc âm."),
  "lesson-08-step-03": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và thay đổi qua ba mức."),

  "lesson-09-step-01": expectation(NONE, "Bước yêu cầu xem bảng kiến thức tần số; allowlist hiện tại không có event đọc lý thuyết."),
  "lesson-09-step-02": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và chọn nốt."),
  "lesson-09-step-03": expectation(NONE, "Bước yêu cầu so sánh giá trị Hz nhưng không nêu một event allowlist cụ thể."),

  "lesson-10-step-01": expectation(["view-3d"], "Bước yêu cầu quan sát vị trí tương đối của driver và động cơ."),
  "lesson-10-step-02": expectation(["change-control"], "Bước yêu cầu chỉnh tốc độ và chiều quay."),
  "lesson-10-step-03": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và thử đảo chiều."),

  "lesson-11-step-01": expectation(NONE, "Bước yêu cầu xem nguyên tắc LM35; allowlist hiện tại không có event đọc lý thuyết."),
  "lesson-11-step-02": expectation(["change-control"], "Bước yêu cầu điều chỉnh nhiệt độ giả lập."),
  "lesson-11-step-03": expectation(["start-simulation"], "Bước yêu cầu chạy mô phỏng và quan sát ngưỡng."),

  "lesson-12-step-01": expectation(["view-wiring"], "Bước yêu cầu nhận biết nguồn, GND và tín hiệu servo."),
  "lesson-12-step-02": expectation(["change-control"], "Bước yêu cầu điều chỉnh góc trên thanh trượt."),
  "lesson-12-step-03": expectation(["start-simulation"], "Bước yêu cầu chạy mô phỏng và quan sát servo."),

  "lesson-13-step-01": expectation(["view-wiring"], "Bước yêu cầu tìm STEP và DIR của driver."),
  "lesson-13-step-02": expectation(["change-control"], "Bước yêu cầu chỉnh số bước."),
  "lesson-13-step-03": expectation(["start-simulation"], "Bước yêu cầu chạy mô phỏng và so sánh góc quay."),

  "lesson-14-step-01": expectation(["view-wiring"], "Bước yêu cầu xác định tín hiệu cảm biến và chân điều khiển bơm."),
  "lesson-14-step-02": expectation(["change-control"], "Bước yêu cầu chỉnh độ ẩm giả lập."),
  "lesson-14-step-03": expectation(["start-simulation"], "Bước yêu cầu chạy mô phỏng và theo dõi bơm."),

  "lesson-15-step-01": expectation(["view-wiring"], "Bước yêu cầu xem mạch chia áp FSR."),
  "lesson-15-step-02": expectation(["change-control"], "Bước yêu cầu điều chỉnh chỉ số ADC giả lập."),
  "lesson-15-step-03": expectation(["start-simulation", "change-control"], "Bước yêu cầu chạy mô phỏng và thử vượt ngưỡng."),

  "lesson-16-step-01": expectation(["view-wiring"], "Bước yêu cầu đối chiếu bảng chân của toàn bộ mạch."),
  "lesson-16-step-02": expectation(["change-control"], "Bước yêu cầu đặt hai input giả lập qua các ngưỡng."),
  "lesson-16-step-03": expectation(["change-control"], "Bước yêu cầu nhấn và giữ nút điều khiển."),
});

function requireExpectation(checkpointId) {
  const value = RAW_EXPECTATIONS[checkpointId];
  if (!value) throw new RangeError("Thiếu editorial practice observation expectation cho " + checkpointId + ".");
  for (const eventType of value.eventTypes) requireEventType(eventType, checkpointId + ".expectedEventTypes");
  return value;
}

function claims() {
  return Object.freeze({
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
    observationIsPass: false,
  });
}

export const PRACTICE_OBSERVATION_EVENT_TYPES = EVENT_TYPES;
export const PRACTICE_OBSERVATION_MAX_ENTRIES = MAX_ENTRIES;

function brandJournal(journal) {
  JOURNAL_BRAND.add(journal);
  return journal;
}

export function createPracticeObservationJournal() {
  return brandJournal(deepFreeze({ version: JOURNAL_VERSION, entries: [] }));
}

export function recordPracticeObservation(journal, input) {
  const entries = normalizeJournal(journal);
  if (entries.length >= MAX_ENTRIES) {
    throw new RangeError("practice observation journal đã đạt giới hạn " + MAX_ENTRIES + " events.");
  }
  const source = requireExactRecord(input, RECORD_KEYS, "practice observation event");
  const entry = Object.freeze({
    lessonId: requireLessonId(source.lessonId),
    eventType: requireEventType(source.eventType),
  });
  return brandJournal(deepFreeze({
    version: JOURNAL_VERSION,
    entries: [...entries, entry],
  }));
}

export function inspectPracticeObservation(input) {
  const source = requireExactRecord(input, INSPECT_KEYS, "practice observation inspect input");
  const checkpoint = getPracticeCheckpoint(source.lesson, source.stepIndex);
  const entries = normalizeJournal(source.journal);
  const expected = requireExpectation(checkpoint.id);
  const lessonEntries = entries.filter(entry => entry.lessonId === checkpoint.lessonId);
  const observedSet = new Set(lessonEntries.map(entry => entry.eventType));
  const observedLessonEventTypes = EVENT_TYPES.filter(eventType => observedSet.has(eventType));
  const matchingEventTypes = expected.eventTypes.filter(eventType => observedSet.has(eventType));
  const matchingCount = lessonEntries.filter(entry => expected.eventTypes.includes(entry.eventType)).length;

  let status;
  let summary;
  if (!expected.eventTypes.length) {
    status = "no-editorial-expectation";
    summary = "Bước này chưa được gán event category trong allowlist hiện tại; journal không được dùng để suy ra người học đã hay chưa thực hiện hoạt động.";
  } else if (matchingCount > 0) {
    status = "lesson-event-overlap";
    summary = "Journal đã ghi nhận event cùng lesson có loại trùng với expectation biên tập của bước. Vì journal không chứa stepIndex hoặc timestamp, kết quả không chứng minh event xảy ra ở bước hiện tại.";
  } else {
    status = "no-lesson-event-overlap";
    summary = "Journal phiên hiện tại chưa có event cùng lesson trùng loại với expectation biên tập của bước; điều này không chứng minh người học chưa thực hiện hoạt động ở nơi khác hoặc ngoài phần được ứng dụng ghi nhận.";
  }

  return deepFreeze({
    lessonId: checkpoint.lessonId,
    stepIndex: checkpoint.stepIndex,
    checkpointId: checkpoint.id,
    checkpointKind: checkpoint.kind,
    sourceStep: checkpoint.sourceStep,
    status,
    expectedEventTypes: [...expected.eventTypes],
    expectation: {
      scheme: "editorial-from-authored-checkpoint",
      source: "practice-checkpoint.sourceStep",
      rationale: expected.rationale,
      required: false,
      teacherValidated: false,
      prerequisiteForAdvance: false,
    },
    observedLessonEventTypes,
    matchingEventTypes,
    lessonEventCount: lessonEntries.length,
    matchingEventCount: matchingCount,
    summary,
    claims: claims(),
  });
}
