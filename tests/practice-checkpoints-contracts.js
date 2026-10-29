import { lessons } from "../src/lessons.js";
import {
  getPracticeCheckpoint,
  listPracticeCheckpoints,
  PRACTICE_CHECKPOINT_PROVENANCE,
} from "../src/practice-checkpoints.js";
import {
  listTerminals,
  sampleWires,
  supportedWiringLessons,
} from "../src/circuit-router.js";

function assert(ok, label) {
  if (!ok) throw new Error("practice-checkpoints contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function pairKey(a, b) {
  return a < b ? a + "\u0000" + b : b + "\u0000" + a;
}

const EXPECTED_STEP_KINDS = Object.freeze({
  1: "MMM",
  2: "WMM",
  3: "WMM",
  4: "WMM",
  5: "WMM",
  6: "WMM",
  7: "WMM",
  8: "WMM",
  9: "MMM",
  10: "MMM",
  11: "MMM",
  12: "WMM",
  13: "WMM",
  14: "WMM",
  15: "WMM",
  16: "WMM",
});

const EXPECTED_FIRST_STEP_PAIR_COUNT = Object.freeze({
  1: 0,
  2: 3,
  3: 4,
  4: 1,
  5: 4,
  6: 4,
  7: 2,
  8: 2,
  9: 0,
  10: 0,
  11: 0,
  12: 4,
  13: 2,
  14: 2,
  15: 4,
  16: 14,
});

export function runPracticeCheckpointContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("registry-covers-all-16-lessons-and-every-step", () => {
    assert(lessons.length === 16, "expected 16 lessons");
    for (const lesson of lessons) {
      const checkpoints = listPracticeCheckpoints(lesson);
      assert(checkpoints.length === lesson.steps.length, "checkpoint count lesson " + lesson.id);
      const kinds = checkpoints.map(item => item.kind === "wiring" ? "W" : "M").join("");
      assert(kinds === EXPECTED_STEP_KINDS[lesson.id], "authored step kinds lesson " + lesson.id);
      assert(checkpoints[0].requiredPairs.length === EXPECTED_FIRST_STEP_PAIR_COUNT[lesson.id],
        "authored pair count lesson " + lesson.id);
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
        assert(checkpoint.sourceStep === lesson.steps[stepIndex], "source step lesson " + lesson.id + "/" + stepIndex);
        assert(typeof checkpoint.guidance === "string" && checkpoint.guidance.length > 0,
          "guidance lesson " + lesson.id + "/" + stepIndex);
        assert(checkpoint.provenance.scheme === "human-authored-from-lesson-text",
          "provenance scheme lesson " + lesson.id + "/" + stepIndex);
        assert(checkpoint.provenance.source === "lessons.steps", "provenance source lesson " + lesson.id);
        assert(checkpoint.provenance.teacherValidated === false, "no teacher-validation claim lesson " + lesson.id);
        assert(checkpoint.provenance.hardwareValidated === false, "no hardware-validation claim lesson " + lesson.id);
        assert(checkpoint.provenance.prerequisiteForAdvance === false, "no advance prerequisite lesson " + lesson.id);
      }
    }
  });

  check("every-authored-wiring-edge-is-canonical-sample-edge", () => {
    const supported = new Set(supportedWiringLessons());
    for (const lesson of lessons) {
      const checkpoints = listPracticeCheckpoints(lesson);
      const wiring = checkpoints.filter(item => item.kind === "wiring");
      if (!wiring.length) continue;
      assert(supported.has(lesson.id), "wiring lesson must be router-supported " + lesson.id);
      const terminals = new Set(listTerminals(lesson.id).map(item => item.id));
      const sample = new Set(sampleWires(lesson.id).map(pair => pairKey(pair[0], pair[1])));
      for (const checkpoint of wiring) {
        const seen = new Set();
        assert(checkpoint.requiredPairs.length > 0, checkpoint.id + " wiring pairs nonempty");
        for (const pair of checkpoint.requiredPairs) {
          assert(terminals.has(pair[0]) && terminals.has(pair[1]), checkpoint.id + " terminal canonical");
          const key = pairKey(pair[0], pair[1]);
          assert(sample.has(key), checkpoint.id + " pair belongs to sample");
          assert(!seen.has(key), checkpoint.id + " pair unique");
          seen.add(key);
        }
      }
    }
  });

  check("manual-checkpoints-never-carry-hidden-wiring-requirements", () => {
    for (const lesson of lessons) {
      for (const checkpoint of listPracticeCheckpoints(lesson)) {
        if (checkpoint.kind === "manual") {
          assert(checkpoint.requiredPairs.length === 0, checkpoint.id + " manual requiredPairs must be empty");
        }
      }
    }
  });

  check("lesson02-timing-and-simulation-steps-are-explicitly-manual", () => {
    const lesson = lessons.find(item => item.id === 2);
    assert(getPracticeCheckpoint(lesson, 0).kind === "wiring", "lesson02 step1 wiring");
    assert(getPracticeCheckpoint(lesson, 1).kind === "manual", "lesson02 step2 timing manual");
    assert(getPracticeCheckpoint(lesson, 2).kind === "manual", "lesson02 step3 simulation manual");
  });

  for (const lesson of lessons) {
    check("lesson-" + String(lesson.id).padStart(2, "0") + "-tampered-step-text-fails-closed", () => {
      const tampered = { ...lesson, steps: [...lesson.steps] };
      tampered.steps[0] += " [tampered]";
      expectThrow(
        () => getPracticeCheckpoint(tampered, 0),
        /không khớp nội dung.*biên tập checkpoint/i,
        "tampered lesson text " + lesson.id,
      );
    });
  }

  for (const lesson of lessons) {
    check("lesson-" + String(lesson.id).padStart(2, "0") + "-step-range-fails-closed", () => {
      expectThrow(() => getPracticeCheckpoint(lesson, -1), /stepIndex/i, "negative step " + lesson.id);
      expectThrow(() => getPracticeCheckpoint(lesson, lesson.steps.length), /stepIndex/i, "high step " + lesson.id);
    });
  }

  check("checkpoint-metadata-is-deeply-frozen", () => {
    const lesson = lessons.find(item => item.id === 16);
    const checkpoint = getPracticeCheckpoint(lesson, 0);
    assert(Object.isFrozen(PRACTICE_CHECKPOINT_PROVENANCE), "global provenance frozen");
    assert(Object.isFrozen(checkpoint), "checkpoint frozen");
    assert(Object.isFrozen(checkpoint.requiredPairs), "requiredPairs frozen");
    assert(checkpoint.requiredPairs.every(Object.isFrozen), "required pair rows frozen");
    assert(Object.isFrozen(checkpoint.provenance), "checkpoint provenance frozen");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
