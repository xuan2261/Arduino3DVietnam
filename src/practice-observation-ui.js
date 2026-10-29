/**
 * Accessible presentation-only UI for in-session practice observations.
 *
 * This renderer never records events, mutates lesson state, advances a lesson,
 * or upgrades an in-app event into physical action, mastery or completion.
 */

const STATUS_PRESENTATION = Object.freeze({
  "lesson-event-overlap": Object.freeze({
    label: "Có event cùng lesson trùng loại",
    detail: "Journal module-branded có ít nhất một event cùng lesson đã được caller báo cho module và có loại trùng với expectation biên tập của bước.",
  }),
  "no-lesson-event-overlap": Object.freeze({
    label: "Chưa có event cùng lesson trùng loại",
    detail: "Journal module-branded trong phiên hiện tại chưa có event cùng lesson trùng loại với expectation biên tập của bước.",
  }),
  "no-editorial-expectation": Object.freeze({
    label: "Không gán event kỳ vọng cho bước này",
    detail: "Nội dung bước chưa hỗ trợ một category trong allowlist đủ rõ để gán expectation biên tập.",
  }),
});

const EVENT_LABELS = Object.freeze({
  "view-pinout": "Mở sơ đồ chân",
  "view-3d": "Mở hoặc quan sát 3D",
  "view-wiring": "Mở sơ đồ nối dây",
  "change-control": "Thay đổi điều khiển",
  "start-simulation": "Chạy mô phỏng",
  "edit-sketch": "Chỉnh sửa sketch",
  "connect-wire": "Nối dây trong ứng dụng",
});

const MAX_EVENT_ROWS = 16;

function requireDocument(doc) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new TypeError("renderPracticeObservation cần document có createElement().");
  }
}

function requireObservation(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw new TypeError("practice observation phải là object.");
  }
}

function make(doc, tag, className = "", text = undefined) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function safeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : null;
}

function boundedEvents(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string").slice(0, MAX_EVENT_ROWS)
    : [];
}

function eventText(eventType) {
  const key = safeText(eventType, "unknown");
  const label = EVENT_LABELS[key];
  return label ? label + " (" + key + ")" : "Event chưa nhận diện (" + key + ")";
}

function appendEventList(doc, section, attribute, heading, events, emptyText) {
  const block = make(doc, "div", "practice-observation-events");
  block.setAttribute(attribute, "");
  block.append(make(doc, "h6", "practice-observation-subheading", heading));
  if (!events.length) {
    block.append(make(doc, "p", "practice-observation-empty", emptyText));
  } else {
    const list = make(doc, "ul", "practice-observation-list");
    for (const eventType of events) list.append(make(doc, "li", "", eventText(eventType)));
    block.append(list);
  }
  section.append(block);
}

export function renderPracticeObservation(doc, observation) {
  requireDocument(doc);
  requireObservation(observation);

  const lessonId = Number.isInteger(observation.lessonId) && observation.lessonId >= 1 && observation.lessonId <= 16
    ? observation.lessonId
    : null;
  const stepIndex = Number.isInteger(observation.stepIndex) && observation.stepIndex >= 0
    ? observation.stepIndex
    : 0;
  const status = safeText(observation.status, "unknown");
  const presentation = STATUS_PRESENTATION[status] ?? Object.freeze({
    label: "Trạng thái observation chưa được nhận diện",
    detail: "UI không nâng trạng thái chưa nhận diện thành bằng chứng hoạt động hay hoàn thành.",
  });
  const expectedEvents = boundedEvents(observation.expectedEventTypes);
  const observedEvents = boundedEvents(observation.observedLessonEventTypes);
  const matchingEvents = boundedEvents(observation.matchingEventTypes);
  const lessonEventCount = safeCount(observation.lessonEventCount);
  const matchingEventCount = safeCount(observation.matchingEventCount);

  const section = make(doc, "section", "practice-observation");
  section.setAttribute("data-practice-observation", "");
  section.setAttribute("data-observation-status", status);
  section.setAttribute("data-observation-step", String(stepIndex));
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");
  section.setAttribute("aria-atomic", "false");
  section.setAttribute("aria-label", "Hoạt động ghi nhận trong ứng dụng cho bước " + (stepIndex + 1));
  if (lessonId !== null) section.setAttribute("data-observation-lesson", String(lessonId));
  if (typeof observation.checkpointId === "string") {
    section.setAttribute("data-observation-checkpoint", observation.checkpointId);
  }
  if (lessonEventCount !== null) section.setAttribute("data-observation-lesson-events", String(lessonEventCount));
  if (matchingEventCount !== null) section.setAttribute("data-observation-matching-events", String(matchingEventCount));

  section.append(
    make(doc, "h5", "practice-observation-heading", "Hoạt động ghi nhận trong ứng dụng"),
    make(doc, "p", "practice-observation-status", presentation.label),
    make(doc, "p", "practice-observation-detail", presentation.detail),
  );

  const sourceStep = safeText(observation.sourceStep, "Chưa có nội dung bước nguồn.");
  section.append(make(doc, "p", "practice-observation-source", "Bước đang đối chiếu: " + sourceStep));

  appendEventList(
    doc,
    section,
    "data-observation-expected",
    "Event category kỳ vọng theo biên tập (không bắt buộc)",
    expectedEvents,
    "Bước này chưa được gán event category trong allowlist hiện tại.",
  );

  appendEventList(
    doc,
    section,
    "data-observation-recorded",
    "Event đã được báo cho module ở cấp lesson trong phiên này",
    observedEvents,
    "Journal module-branded chưa có event nào cho lesson này trong phiên hiện tại.",
  );

  appendEventList(
    doc,
    section,
    "data-observation-overlap",
    "Loại event trùng với expectation",
    matchingEvents,
    "Không có loại event trùng để hiển thị.",
  );

  section.append(make(
    doc,
    "p",
    "practice-observation-summary",
    "Tóm tắt: " + safeText(observation.summary, "Chưa có tóm tắt observation."),
  ));

  const attribution = make(
    doc,
    "p",
    "practice-observation-attribution",
    "Journal chỉ lưu lessonId và eventType, không lưu stepIndex hay timestamp. Vì vậy event trùng loại chỉ là overlap ở cấp lesson, không chứng minh event đã xảy ra tại bước hiện tại.",
  );
  attribution.setAttribute("data-observation-attribution-note", "");
  section.append(attribution);

  const boundary = make(
    doc,
    "p",
    "practice-observation-boundary",
    "Khối này không suy ra hoạt động ngoài ứng dụng, không chứng minh thao tác vật lý, không xác nhận của giáo viên, không đo mastery, không tự hoàn thành bài và không phải điều kiện để chuyển bước.",
  );
  boundary.setAttribute("data-observation-boundary", "");
  section.append(boundary);

  return section;
}

export const renderObservation = renderPracticeObservation;
