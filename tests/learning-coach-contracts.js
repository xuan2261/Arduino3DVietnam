import { lessons } from "../src/lessons.js";
import {
  getLessonGuidance,
  getWiringFeedback,
  LEARNING_COACH_BOUNDARIES,
} from "../src/learning-coach.js";
import {
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  createSampleCircuit,
} from "../src/circuit-router.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, label) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  assert(error, label + ": expected throw");
  assert(pattern.test(String(error.message)), label + ": unexpected message " + error.message);
}

export function runLearningCoachContracts() {
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };

  check("capability-boundary-is-local-and-nonphysical", () => {
    assert(LEARNING_COACH_BOUNDARIES.topologyOnly === true, "topology boundary missing");
    for (const key of [
      "executesFirmware",
      "synthesizesSensorValues",
      "physicalValidation",
      "storesProgress",
      "usesAccountData",
      "usesNetwork",
    ]) {
      assert(LEARNING_COACH_BOUNDARIES[key] === false, key + " must stay false");
    }
  });

  check("all-16-lessons-derive-guidance-from-current-data", () => {
    assert(lessons.length === 16, "expected 16 lessons, got " + lessons.length);
    for (const lesson of lessons) {
      const guidance = getLessonGuidance(lesson);
      assert(guidance.lessonId === lesson.id && guidance.title === lesson.title, "lesson " + lesson.id + " identity drift");
      assert(guidance.microsteps.length === lesson.steps.length, "lesson " + lesson.id + " step count drift");
      guidance.microsteps.forEach((step, index) => {
        assert(step.instruction === lesson.steps[index], "lesson " + lesson.id + " instruction must come from lesson.steps");
        assert(step.checkpoint.length > 10 && step.hint.length > 10, "lesson " + lesson.id + " microstep must be guided");
      });
      assert(
        guidance.boundaries.storesProgress === false && guidance.boundaries.usesAccountData === false,
        "lesson " + lesson.id + " must not persist learner data",
      );
    }
  });

  check("lesson-10-and-14-are-signal-only-before-analysis", () => {
    for (const id of [10, 14]) {
      const guidance = getLessonGuidance(lessons[id - 1]);
      assert(guidance.boundaries.signalOnly === true, "lesson " + id + " signal-only boundary missing");
      assert(/tín hiệu\/GND/.test(guidance.hint), "lesson " + id + " hint must disclose signal-only scope");
    }
  });

  check("unsupported-lesson-wiring-does-not-invent-a-check", () => {
    const feedback = getWiringFeedback(analyzeCircuit(1, createCircuit(1)));
    assert(feedback.status === "unsupported", "expected unsupported, got " + feedback.status);
    assert(feedback.topologyOnly && feedback.confidenceClaim === false, "unsupported result must not claim confidence");
  });

  check("incomplete-topology-points-to-existing-path-or-issue", () => {
    const analysis = analyzeCircuit(2, createCircuit(2));
    const feedback = getWiringFeedback(analysis);
    assert(feedback.status === "incomplete", "expected incomplete, got " + feedback.status);
    assert(feedback.issues.length > 0, "empty circuit must expose real checker issues");
    assert(/topology|đường|bảng Chân nối/i.test(feedback.nextAction), "incomplete action should stay topology-based");
  });

  check("unsafe-topology-has-priority-over-completeness", () => {
    let state = createCircuit(2);
    state = connectCircuit(state, "D13", "GND");
    const analysis = analyzeCircuit(2, state);
    const feedback = getWiringFeedback(analysis);
    assert(feedback.status === "unsafe", "expected unsafe, got " + feedback.status);
    assert(feedback.issues.some(item => item.code === "SHORT_D13_GND"), "real short issue must be preserved");
    assert(feedback.confidenceClaim === false, "unsafe feedback must not claim confidence");
  });

  check("valid-topology-remains-topology-only", () => {
    const state = createSampleCircuit(2);
    const feedback = getWiringFeedback(analyzeCircuit(2, state));
    assert(feedback.status === "topology-complete", "expected topology-complete, got " + feedback.status);
    assert(/không xác nhận phần cứng vật lý/.test(feedback.nextAction), "completion must retain physical disclaimer");
  });

  check("signal-only-lessons-never-become-functional", () => {
    for (const id of [10, 14]) {
      const state = createSampleCircuit(id);
      const analysis = analyzeCircuit(id, state);
      const feedback = getWiringFeedback(analysis);
      assert(
        analysis.signalPathsComplete === true && analysis.functional === false && analysis.ok === false,
        "lesson " + id + " real circuit boundary drifted",
      );
      assert(feedback.status === "signal-only-complete", "lesson " + id + " feedback must remain signal-only");
      assert(
        feedback.scope === "signal-only" && /không coi.*functional|không.*functional/i.test(feedback.nextAction),
        "lesson " + id + " must not imply full motor/pump circuit",
      );
      const guidance = getLessonGuidance(lessons[id - 1], analysis);
      assert(
        guidance.wiring.status === "signal-only-complete" && guidance.boundaries.physicalValidation === false,
        "lesson " + id + " guidance boundary mismatch",
      );
    }
  });

  check("issue-feedback-is-per-code-and-defensive", () => {
    const analysis = {
      lessonId: 5,
      supported: true,
      ok: false,
      functional: false,
      paths: [],
      issues: [
        {
          code: "RGB_R_RESISTOR_MISSING",
          severity: "error",
          message: "Thiếu điện trở",
          terminals: ["D9", "RGB:R"],
        },
        {
          code: "RGB_G_PATH_WRONG",
          severity: "warning",
          message: "Sai đường",
          terminals: ["D10", "RGB:G"],
        },
      ],
    };
    const feedback = getWiringFeedback(analysis);
    assert(feedback.status === "unsafe", "missing resistor error must be unsafe");
    assert(/điện trở/.test(feedback.issues[0].feedback), "resistor feedback must be specific");
    assert(/So khớp/.test(feedback.issues[1].feedback), "wrong-path feedback must be specific");
    analysis.issues[0].terminals.push("MUTATED");
    assert(!feedback.issues[0].terminals.includes("MUTATED"), "returned terminals must be defensive copies");
  });

  check("deterministic-no-progress-or-account-payload", () => {
    const lesson = lessons[15];
    const analysis = analyzeCircuit(16, createCircuit(16));
    const a = getLessonGuidance(lesson, analysis);
    const b = getLessonGuidance(lesson, analysis);
    assert(JSON.stringify(a) === JSON.stringify(b), "same input must yield identical guidance");
    const payload = JSON.stringify(a);
    for (const forbidden of [
      "userId",
      "account",
      "email",
      "localStorage",
      "sessionStorage",
      "sensorValue",
      "measurement",
    ]) {
      assert(!payload.includes('"' + forbidden + '"'), "forbidden learner data/output field " + forbidden);
    }
  });

  check("invalid-input-and-cross-lesson-analysis-fail-closed", () => {
    expectThrow(() => getLessonGuidance(null), /lesson/, "null lesson");
    expectThrow(() => getWiringFeedback({}), /analysis/, "bad analysis");
    const analysis = analyzeCircuit(2, createCircuit(2));
    expectThrow(() => getLessonGuidance(lessons[2], analysis), /bài học khác/, "cross lesson analysis");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
