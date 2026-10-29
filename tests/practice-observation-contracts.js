import { lessons } from "../src/lessons.js";
import {
  PRACTICE_OBSERVATION_EVENT_TYPES,
  PRACTICE_OBSERVATION_MAX_ENTRIES,
  createPracticeObservationJournal,
  inspectPracticeObservation,
  recordPracticeObservation,
} from "../src/practice-observation.js";

function assert(ok, label) {
  if (!ok) throw new Error("practice-observation contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function lessonById(id) {
  const lesson = lessons.find(item => item.id === id);
  if (!lesson) throw new Error("missing lesson " + id);
  return lesson;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const EXPECTED = Object.freeze({
  1: [["view-3d"], ["change-control", "start-simulation"], ["view-3d", "view-pinout"]],
  2: [["view-wiring"], ["change-control"], ["start-simulation", "change-control"]],
  3: [["view-wiring"], ["change-control", "start-simulation"], ["change-control"]],
  4: [["view-wiring"], ["change-control", "start-simulation"], []],
  5: [["view-wiring"], ["change-control"], ["start-simulation", "change-control"]],
  6: [["view-wiring"], ["change-control"], ["start-simulation", "change-control"]],
  7: [["view-wiring"], ["change-control"], []],
  8: [["view-wiring"], ["change-control"], ["start-simulation", "change-control"]],
  9: [[], ["start-simulation", "change-control"], []],
  10: [["view-3d"], ["change-control"], ["start-simulation", "change-control"]],
  11: [[], ["change-control"], ["start-simulation"]],
  12: [["view-wiring"], ["change-control"], ["start-simulation"]],
  13: [["view-wiring"], ["change-control"], ["start-simulation"]],
  14: [["view-wiring"], ["change-control"], ["start-simulation"]],
  15: [["view-wiring"], ["change-control"], ["start-simulation", "change-control"]],
  16: [["view-wiring"], ["change-control"], ["change-control"]],
});

export function runPracticeObservationContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("empty-journal-is-pure-frozen-and-clockless", () => {
    const journal = createPracticeObservationJournal();
    assert(journal.version === 1 && Array.isArray(journal.entries) && journal.entries.length === 0,
      "empty journal shape");
    assert(Object.isFrozen(journal) && Object.isFrozen(journal.entries), "empty journal deep frozen");
    assert(!("timestamp" in journal) && !("createdAt" in journal) && !("updatedAt" in journal),
      "journal must not fabricate clock fields");
  });

  check("record-is-immutable-and-preserves-only-lesson-event-pairs", () => {
    const before = createPracticeObservationJournal();
    const after = recordPracticeObservation(before, { lessonId: 2, eventType: "view-wiring" });
    assert(before.entries.length === 0, "record must not mutate previous journal");
    assert(after !== before && after.entries.length === 1, "record returns new journal");
    assert(JSON.stringify(after.entries[0]) === JSON.stringify({ lessonId: 2, eventType: "view-wiring" }),
      "recorded entry must contain only lessonId/eventType");
    assert(Object.isFrozen(after) && Object.isFrozen(after.entries) && Object.isFrozen(after.entries[0]),
      "recorded journal deep frozen");
    const repeated = recordPracticeObservation(after, { lessonId: 2, eventType: "view-wiring" });
    assert(repeated.entries.length === 2, "real repeated interactions remain observable events");
  });

  check("forged-literal-and-json-clone-journals-fail-private-brand-provenance", () => {
    const journal = recordPracticeObservation(
      createPracticeObservationJournal(),
      { lessonId: 2, eventType: "view-wiring" },
    );
    const literal = {
      version: journal.version,
      entries: journal.entries.map(entry => ({ ...entry })),
    };
    const jsonClone = clone(journal);
    for (const [label, forged] of [["literal", literal], ["json clone", jsonClone]]) {
      expectThrow(
        () => inspectPracticeObservation({ lesson: lessonById(2), stepIndex: 0, journal: forged }),
        /không được tạo bởi module observation/i,
        label + " inspect provenance",
      );
      expectThrow(
        () => recordPracticeObservation(forged, { lessonId: 2, eventType: "view-wiring" }),
        /không được tạo bởi module observation/i,
        label + " record provenance",
      );
    }
    const valid = inspectPracticeObservation({ lesson: lessonById(2), stepIndex: 0, journal });
    assert(valid.claims.origin === "module-observation-journal" &&
      valid.claims.journalModuleBranded === true &&
      valid.claims.eventReportedToModule === true,
    "module-created journal exposes truthful provenance claims");
    assert(!("eventRecordedByHostOnly" in valid.claims),
      "superseded host-only provenance claim must stay absent");
  });

  check("all-allowlisted-event-types-are-recordable", () => {
    assert(JSON.stringify(PRACTICE_OBSERVATION_EVENT_TYPES) === JSON.stringify([
      "view-pinout", "view-3d", "view-wiring", "change-control",
      "start-simulation", "edit-sketch", "connect-wire",
    ]), "event allowlist drift");
    let journal = createPracticeObservationJournal();
    for (const eventType of PRACTICE_OBSERVATION_EVENT_TYPES) {
      journal = recordPracticeObservation(journal, { lessonId: 1, eventType });
    }
    assert(journal.entries.length === PRACTICE_OBSERVATION_EVENT_TYPES.length,
      "every allowlisted event should be recordable");
  });

  check("record-rejects-unknown-foreign-or-clock-fields", () => {
    const journal = createPracticeObservationJournal();
    expectThrow(
      () => recordPracticeObservation(journal, { lessonId: 2, eventType: "fake-event" }),
      /allowlist/i,
      "unknown event type",
    );
    expectThrow(
      () => recordPracticeObservation(journal, { lessonId: 17, eventType: "view-3d" }),
      /1\.\.16/i,
      "foreign lesson id",
    );
    expectThrow(
      () => recordPracticeObservation(journal, { lessonId: 2, eventType: "view-3d", timestamp: 123 }),
      /field không được hỗ trợ/i,
      "timestamp injection",
    );
  });

  check("journal-validation-fails-closed", () => {
    expectThrow(
      () => recordPracticeObservation({ version: 2, entries: [] }, { lessonId: 1, eventType: "view-3d" }),
      /không được tạo bởi module observation/i,
      "unbranded foreign journal version",
    );
    expectThrow(
      () => inspectPracticeObservation({
        lesson: lessonById(1),
        stepIndex: 0,
        journal: { version: 1, entries: [{ lessonId: 1, eventType: "view-3d", timestamp: 1 }] },
      }),
      /không được tạo bởi module observation/i,
      "unbranded forged entry field",
    );
    expectThrow(
      () => inspectPracticeObservation({
        lesson: lessonById(1),
        stepIndex: 0,
        journal: { version: 1, entries: [{ lessonId: 99, eventType: "view-3d" }] },
      }),
      /không được tạo bởi module observation/i,
      "unbranded foreign lesson in journal",
    );
  });

  check("journal-bound-is-enforced-before-append", () => {
    let full = createPracticeObservationJournal();
    for (let index = 0; index < PRACTICE_OBSERVATION_MAX_ENTRIES; index += 1) {
      full = recordPracticeObservation(full, { lessonId: 1, eventType: "view-3d" });
    }
    const inspected = inspectPracticeObservation({ lesson: lessonById(1), stepIndex: 0, journal: full });
    assert(inspected.lessonEventCount === PRACTICE_OBSERVATION_MAX_ENTRIES,
      "module-branded max-size journal remains inspectable");
    expectThrow(
      () => recordPracticeObservation(full, { lessonId: 1, eventType: "view-pinout" }),
      /đạt giới hạn|giới hạn/i,
      "journal append bound",
    );
  });

  check("all-48-authored-checkpoints-have-source-truthful-editorial-expectations", () => {
    assert(lessons.length === 16, "expected 16 lessons");
    let total = 0;
    const journal = createPracticeObservationJournal();
    for (const lesson of lessons) {
      assert(lesson.steps.length === 3, "expected three authored steps lesson " + lesson.id);
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        total += 1;
        const observation = inspectPracticeObservation({ lesson, stepIndex, journal });
        const expected = EXPECTED[lesson.id][stepIndex];
        assert(observation.checkpointId ===
          "lesson-" + String(lesson.id).padStart(2, "0") + "-step-" + String(stepIndex + 1).padStart(2, "0"),
        "checkpoint id " + lesson.id + "/" + stepIndex);
        assert(observation.sourceStep === lesson.steps[stepIndex], "source step " + lesson.id + "/" + stepIndex);
        assert(JSON.stringify(observation.expectedEventTypes) === JSON.stringify(expected),
          "editorial event mapping " + lesson.id + "/" + stepIndex);
        assert(observation.expectation.scheme === "editorial-from-authored-checkpoint" &&
          observation.expectation.required === false &&
          observation.expectation.teacherValidated === false &&
          observation.expectation.prerequisiteForAdvance === false,
        "expectation provenance " + lesson.id + "/" + stepIndex);
        assert(observation.status === (expected.length ? "no-lesson-event-overlap" : "no-editorial-expectation"),
          "empty journal status " + lesson.id + "/" + stepIndex);
        assert(observation.claims.stepAttribution === false &&
          observation.claims.origin === "module-observation-journal" &&
          observation.claims.journalModuleBranded === true &&
          observation.claims.eventReportedToModule === true &&
          observation.claims.outsideAppActionKnown === false &&
          observation.claims.physicalActionProven === false &&
          observation.claims.mastery === false &&
          observation.claims.autoCompletion === false &&
          observation.claims.lessonCompleted === false &&
          observation.claims.prerequisiteForAdvance === false &&
          observation.claims.teacherValidated === false &&
          observation.claims.observationIsPass === false,
        "bounded claims " + lesson.id + "/" + stepIndex);
        assert(!("eventRecordedByHostOnly" in observation.claims),
          "host-only claim must stay retired " + lesson.id + "/" + stepIndex);
        assert(!("timestamp" in observation) && !Array.isArray(observation.timestamps),
          "no fabricated timestamp output " + lesson.id + "/" + stepIndex);
      }
    }
    assert(total === 48, "expected 48 authored checkpoint observations");
  });

  check("lesson-level-overlap-never-proves-current-step", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 2, eventType: "change-control" });
    const lesson = lessonById(2);
    const step2 = inspectPracticeObservation({ lesson, stepIndex: 1, journal });
    const step3 = inspectPracticeObservation({ lesson, stepIndex: 2, journal });
    assert(step2.status === "lesson-event-overlap" && step3.status === "lesson-event-overlap",
      "same lesson event can overlap multiple editorial expectations");
    assert(step2.matchingEventCount === 1 && step3.matchingEventCount === 1,
      "lesson-level event count should be transparent");
    for (const observation of [step2, step3]) {
      assert(observation.claims.stepAttribution === false, "overlap must not become step attribution");
      assert(/không chứng minh event xảy ra ở bước hiện tại/i.test(observation.summary),
        "overlap summary must state no step attribution");
      assert(observation.claims.autoCompletion === false && observation.claims.lessonCompleted === false,
        "overlap must not complete lesson");
    }
  });

  check("cross-lesson-events-are-not-attributed", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 3, eventType: "view-wiring" });
    const observation = inspectPracticeObservation({ lesson: lessonById(2), stepIndex: 0, journal });
    assert(observation.lessonEventCount === 0 && observation.matchingEventCount === 0,
      "foreign lesson event must not count");
    assert(observation.status === "no-lesson-event-overlap", "foreign lesson event must not create overlap");
  });

  check("no-overlap-describes-only-app-journal-not-learner-absence", () => {
    const observation = inspectPracticeObservation({
      lesson: lessonById(12),
      stepIndex: 1,
      journal: createPracticeObservationJournal(),
    });
    assert(/journal phiên hiện tại chưa có event/i.test(observation.summary), "summary should scope absence to journal");
    assert(/không chứng minh người học chưa thực hiện/i.test(observation.summary),
      "summary must not infer absence of learner action");
    assert(observation.claims.outsideAppActionKnown === false, "outside-app action remains unknown");
  });

  check("edit-sketch-and-connect-wire-are-recordable-but-not-invented-as-step-expectations", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 16, eventType: "edit-sketch" });
    journal = recordPracticeObservation(journal, { lessonId: 16, eventType: "connect-wire" });
    for (const lesson of lessons) {
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const observation = inspectPracticeObservation({ lesson, stepIndex, journal });
        assert(!observation.expectedEventTypes.includes("edit-sketch"),
          "lesson text does not explicitly request edit-sketch " + lesson.id + "/" + stepIndex);
        assert(!observation.expectedEventTypes.includes("connect-wire"),
          "lesson text does not explicitly request connect-wire " + lesson.id + "/" + stepIndex);
      }
    }
    const lesson16 = inspectPracticeObservation({ lesson: lessonById(16), stepIndex: 0, journal });
    assert(lesson16.observedLessonEventTypes.includes("edit-sketch") &&
      lesson16.observedLessonEventTypes.includes("connect-wire"),
    "recorded non-expected events remain visible at lesson scope");
    assert(lesson16.matchingEventCount === 0, "non-expected events do not fabricate match");
  });

  check("tampered-lesson-step-and-out-of-range-inspection-fail-closed", () => {
    const lesson = lessonById(2);
    const tampered = { ...lesson, steps: [...lesson.steps] };
    tampered.steps[0] += " [tampered]";
    const journal = createPracticeObservationJournal();
    expectThrow(
      () => inspectPracticeObservation({ lesson: tampered, stepIndex: 0, journal }),
      /không khớp nội dung.*biên tập checkpoint/i,
      "tampered authored step",
    );
    expectThrow(
      () => inspectPracticeObservation({ lesson, stepIndex: 3, journal }),
      /stepIndex/i,
      "out-of-range step",
    );
    expectThrow(
      () => inspectPracticeObservation({ lesson, stepIndex: 0, journal, completed: true }),
      /field không được hỗ trợ/i,
      "unknown completion field",
    );
  });

  check("inspection-result-is-deeply-frozen", () => {
    let journal = createPracticeObservationJournal();
    journal = recordPracticeObservation(journal, { lessonId: 1, eventType: "view-3d" });
    const observation = inspectPracticeObservation({ lesson: lessonById(1), stepIndex: 0, journal });
    assert(Object.isFrozen(observation) &&
      Object.isFrozen(observation.expectedEventTypes) &&
      Object.isFrozen(observation.expectation) &&
      Object.isFrozen(observation.observedLessonEventTypes) &&
      Object.isFrozen(observation.matchingEventTypes) &&
      Object.isFrozen(observation.claims),
    "inspection result deep frozen");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
