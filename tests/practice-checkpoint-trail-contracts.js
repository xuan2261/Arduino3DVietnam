import { lessons, lessonById } from "../src/lessons.js";
import {
  buildPracticeCheckpointTrail,
  PRACTICE_CHECKPOINT_TRAIL_LIMITS,
} from "../src/practice-checkpoint-trail.js";
import { listPracticeCheckpoints } from "../src/practice-checkpoints.js";
import {
  connectCircuit,
  createCircuit,
} from "../src/circuit-router.js";

function assert(condition, message) {
  if (!condition) throw new Error("practice-checkpoint-trail contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function graphFor(lessonId, pairs = []) {
  let graph = createCircuit(lessonId);
  for (const pair of pairs) graph = connectCircuit(graph, pair[0], pair[1]);
  return graph;
}

function inputFor(lessonId, currentStepIndex = 0, pairs = []) {
  const lesson = lessonById(lessonId);
  return {
    lesson,
    currentStepIndex,
    circuit: lessonId === 1 ? null : graphFor(lessonId, pairs),
  };
}

function claimsAreBounded(claims) {
  return claims.autoCompletion === false &&
    claims.mastery === false &&
    claims.mutationPerformed === false &&
    claims.physicalVerified === false &&
    claims.progressTracked === false &&
    claims.teacherValidated === false;
}

export function runPracticeCheckpointTrailContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("limits-lock-16-lessons-3-steps-48-checkpoints", () => {
    assert(Object.isFrozen(PRACTICE_CHECKPOINT_TRAIL_LIMITS), "limits must be frozen");
    assert(PRACTICE_CHECKPOINT_TRAIL_LIMITS.lessonCount === 16, "lesson count");
    assert(PRACTICE_CHECKPOINT_TRAIL_LIMITS.stepsPerLesson === 3, "steps per lesson");
    assert(PRACTICE_CHECKPOINT_TRAIL_LIMITS.totalCheckpoints === 48, "checkpoint total");
    assert(PRACTICE_CHECKPOINT_TRAIL_LIMITS.maxWires === 48, "wire bound");
    assert(PRACTICE_CHECKPOINT_TRAIL_LIMITS.maxRequiredPairsPerStep === 16, "pair bound");
  });

  check("all-16-lessons-produce-exactly-48-authored-trail-steps", () => {
    assert(lessons.length === 16, "expected 16 lessons");
    let total = 0;
    for (const lesson of lessons) {
      const trail = buildPracticeCheckpointTrail({
        lesson,
        currentStepIndex: 0,
        circuit: lesson.id === 1 ? null : createCircuit(lesson.id),
      });
      assert(trail.lessonId === lesson.id, "lesson id " + lesson.id);
      assert(trail.stepCount === 3 && trail.steps.length === 3, "three steps lesson " + lesson.id);
      assert(trail.steps.filter(step => step.current).length === 1, "one current step lesson " + lesson.id);
      total += trail.steps.length;
    }
    assert(total === 48, "exact 48 trail steps");
  });

  check("source-goals-and-hints-come-exactly-from-authored-checkpoints", () => {
    for (const lesson of lessons) {
      const checkpoints = listPracticeCheckpoints(lesson);
      const trail = buildPracticeCheckpointTrail({
        lesson,
        currentStepIndex: 1,
        circuit: lesson.id === 1 ? null : createCircuit(lesson.id),
      });
      for (let index = 0; index < 3; index += 1) {
        const step = trail.steps[index];
        const checkpoint = checkpoints[index];
        assert(step.id === checkpoint.id, "checkpoint id " + checkpoint.id);
        assert(step.sourceGoal === checkpoint.sourceStep, "source goal " + checkpoint.id);
        assert(step.sourceHint === checkpoint.guidance, "source hint " + checkpoint.id);
        assert(step.sourceScheme === checkpoint.provenance.scheme, "source scheme " + checkpoint.id);
        assert(step.sourceName === checkpoint.provenance.source, "source name " + checkpoint.id);
      }
    }
  });

  check("empty-learner-graphs-mark-every-authored-wiring-pair-missing", () => {
    for (const lesson of lessons) {
      const trail = buildPracticeCheckpointTrail({
        lesson,
        currentStepIndex: 0,
        circuit: lesson.id === 1 ? null : createCircuit(lesson.id),
      });
      for (const step of trail.steps) {
        if (step.kind === "manual") continue;
        assert(step.requiredPairCount > 0, step.id + " wiring pair count");
        assert(step.committedPairCount === 0, step.id + " no committed pair");
        assert(step.missingPairCount === step.requiredPairCount, step.id + " all missing");
        assert(step.evidenceStatus === "authored-pairs-missing", step.id + " missing status");
        assert(step.pairs.every(pair => pair.status === "missing"), step.id + " pair rows missing");
      }
    }
  });

  check("each-wiring-checkpoint-reads-exact-committed-authored-edge-from-supplied-graph", () => {
    for (const lesson of lessons) {
      const checkpoints = listPracticeCheckpoints(lesson);
      for (const checkpoint of checkpoints) {
        if (checkpoint.kind !== "wiring") continue;
        const firstPair = checkpoint.requiredPairs[0];
        const trail = buildPracticeCheckpointTrail({
          lesson,
          currentStepIndex: checkpoint.stepIndex,
          circuit: graphFor(lesson.id, [firstPair]),
        });
        const step = trail.steps[checkpoint.stepIndex];
        assert(step.pairs[0].status === "committed", checkpoint.id + " first exact edge committed");
        assert(step.committedPairCount === 1, checkpoint.id + " exactly one committed");
        assert(step.missingPairCount === checkpoint.requiredPairs.length - 1, checkpoint.id + " exact missing remainder");
        assert(step.evidenceStatus === (checkpoint.requiredPairs.length === 1
          ? "authored-pairs-present" : "authored-pairs-missing"), checkpoint.id + " status from exact rows");
      }
    }
  });

  check("authored-required-pairs-can-all-be-present-without-creating-sample-learner-state", () => {
    for (const lesson of lessons) {
      const checkpoint = listPracticeCheckpoints(lesson).find(item => item.kind === "wiring");
      if (!checkpoint) continue;
      const learner = graphFor(lesson.id, checkpoint.requiredPairs);
      const before = JSON.stringify(learner);
      const trail = buildPracticeCheckpointTrail({
        lesson,
        currentStepIndex: checkpoint.stepIndex,
        circuit: learner,
      });
      const step = trail.steps[checkpoint.stepIndex];
      assert(step.evidenceStatus === "authored-pairs-present", checkpoint.id + " present status");
      assert(step.committedPairCount === checkpoint.requiredPairs.length, checkpoint.id + " committed count");
      assert(step.missingPairCount === 0, checkpoint.id + " no missing pairs");
      assert(step.pairs.every(row => row.status === "committed"), checkpoint.id + " all committed rows");
      assert(JSON.stringify(learner) === before, checkpoint.id + " learner graph not mutated");
      assert(trail.claims.sampleInjectedIntoLearner === false, checkpoint.id + " no sample injection claim");
    }
  });

  check("non-authored-canonical-edge-does-not-count-as-authored-commitment", () => {
    const lesson = lessonById(3);
    const trail = buildPracticeCheckpointTrail({
      lesson,
      currentStepIndex: 0,
      circuit: graphFor(3, [["D13", "R_LED:A"]]),
    });
    const step = trail.steps[0];
    assert(step.kind === "wiring" && step.committedPairCount === 0, "extra canonical edge cannot satisfy authored pair");
    assert(step.pairs.every(row => row.status === "missing"), "authored rows stay missing");
  });

  check("manual-checkpoints-are-explicitly-not-automatically-assessed", () => {
    let manuals = 0;
    for (const lesson of lessons) {
      const trail = buildPracticeCheckpointTrail({
        lesson,
        currentStepIndex: 2,
        circuit: lesson.id === 1 ? null : createCircuit(lesson.id),
      });
      for (const step of trail.steps) {
        if (step.kind !== "manual") continue;
        manuals += 1;
        assert(step.evidenceStatus === "manual-not-automatically-assessed", step.id + " manual status");
        assert(step.requiredPairCount === 0 && step.pairs.length === 0, step.id + " no hidden wiring");
        assert(step.claims.automaticallyAssessed === false, step.id + " no auto assessment");
        assert(/không được tự động đánh giá/i.test(step.evidenceNote), step.id + " manual disclosure");
        assert(/mastery.*giáo viên.*phần cứng/i.test(step.evidenceNote), step.id + " manual claim boundary");
      }
    }
    assert(manuals > 30, "manual checkpoints are the majority and all were checked");
  });

  check("no-step-or-trail-ever-claims-progress-mastery-teacher-physical-or-auto-complete", () => {
    for (const lesson of lessons) {
      const trail = buildPracticeCheckpointTrail({
        lesson,
        currentStepIndex: 0,
        circuit: lesson.id === 1 ? null : createCircuit(lesson.id),
      });
      assert(claimsAreBounded(trail.claims), "trail claims lesson " + lesson.id);
      for (const step of trail.steps) {
        assert(claimsAreBounded(step.claims), "step claims " + step.id);
        assert(step.claims.learnerActionProven === false, step.id + " no learner-action proof");
        assert(step.claims.prerequisiteForAdvance === false, step.id + " no advance prerequisite");
      }
    }
  });

  check("lesson10-and-14-remain-signal-only-even-when-authored-pairs-are-present", () => {
    const lesson10 = lessonById(10);
    const trail10 = buildPracticeCheckpointTrail({ lesson: lesson10, currentStepIndex: 0, circuit: createCircuit(10) });
    assert(trail10.lessonScope === "signal-only" && trail10.claims.signalOnly === true, "lesson10 signal-only");
    assert(trail10.steps.every(step => step.kind === "manual" && step.claims.signalOnly === true), "lesson10 manual signal boundary");

    const lesson14 = lessonById(14);
    const checkpoint14 = listPracticeCheckpoints(lesson14)[0];
    const trail14 = buildPracticeCheckpointTrail({
      lesson: lesson14,
      currentStepIndex: 0,
      circuit: graphFor(14, checkpoint14.requiredPairs),
    });
    assert(trail14.lessonScope === "signal-only" && trail14.claims.signalOnly === true, "lesson14 signal-only");
    assert(trail14.steps[0].evidenceStatus === "authored-pairs-present", "lesson14 authored pairs present");
    assert(trail14.steps[0].claims.signalOnly === true, "lesson14 wiring step signal-only");
    assert(/nguồn\/tải\/chức năng phần cứng/i.test(trail14.steps[0].evidenceNote), "lesson14 functional boundary");
  });

  check("navigation-indexes-are-bounded-and-derived-only-from-current-index", () => {
    const first = buildPracticeCheckpointTrail(inputFor(2, 0));
    const middle = buildPracticeCheckpointTrail(inputFor(2, 1));
    const last = buildPracticeCheckpointTrail(inputFor(2, 2));
    assert(first.previousStepIndex === null && first.nextStepIndex === 1, "first navigation");
    assert(middle.previousStepIndex === 0 && middle.nextStepIndex === 2, "middle navigation");
    assert(last.previousStepIndex === 1 && last.nextStepIndex === null, "last navigation");
    expectThrow(() => buildPracticeCheckpointTrail(inputFor(2, -1)), /currentStepIndex/i, "negative current index");
    expectThrow(() => buildPracticeCheckpointTrail(inputFor(2, 3)), /currentStepIndex/i, "high current index");
  });

  check("lesson1-rejects-external-circuit-and-remains-manual-only", () => {
    const trail = buildPracticeCheckpointTrail(inputFor(1, 0));
    assert(trail.lessonScope === "manual-only", "lesson1 manual-only scope");
    assert(trail.steps.every(step => step.kind === "manual" && step.pairs.length === 0), "lesson1 all manual");
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lessonById(1), currentStepIndex: 0, circuit: createCircuit(2) }),
      /Lesson 1.*circuit.*null/i,
      "lesson1 external graph rejected",
    );
  });

  check("router-validation-rejects-wrong-lesson-invalid-terminal-and-duplicate-edge", () => {
    const lesson2 = lessonById(2);
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lesson2, currentStepIndex: 0, circuit: createCircuit(3) }),
      /canonical learner graph|canonical shape/i,
      "wrong lesson circuit",
    );

    const invalidTerminal = createCircuit(2);
    invalidTerminal.wires = [{ id: "w1", from: "constructor", to: "GND" }];
    invalidTerminal.nextWireId = 2;
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lesson2, currentStepIndex: 0, circuit: invalidTerminal }),
      /terminal ngoài bài học/i,
      "invalid terminal rejected by router",
    );

    const duplicate = createCircuit(2);
    duplicate.wires = [
      { id: "w1", from: "D13", to: "R1:A" },
      { id: "w2", from: "R1:A", to: "D13" },
    ];
    duplicate.nextWireId = 3;
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lesson2, currentStepIndex: 0, circuit: duplicate }),
      /trùng/i,
      "duplicate unordered edge rejected by router",
    );
  });

  check("untrusted-prototypes-and-accessors-fail-before-model-interpretation", () => {
    const lesson2 = lessonById(2);
    const inheritedLesson = Object.create(lesson2);
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: inheritedLesson, currentStepIndex: 0, circuit: createCircuit(2) }),
      /prototype tùy biến/i,
      "inherited lesson rejected",
    );

    const getterLesson = { ...lesson2 };
    Object.defineProperty(getterLesson, "id", { enumerable: true, get() { throw new Error("getter executed"); } });
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: getterLesson, currentStepIndex: 0, circuit: createCircuit(2) }),
      /own data property/i,
      "lesson accessor rejected without execution",
    );

    const inheritedCircuit = Object.create(createCircuit(2));
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lesson2, currentStepIndex: 0, circuit: inheritedCircuit }),
      /prototype tùy biến/i,
      "inherited circuit rejected",
    );

    const getterCircuit = { ...createCircuit(2) };
    Object.defineProperty(getterCircuit, "wires", { enumerable: true, get() { throw new Error("getter executed"); } });
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lesson2, currentStepIndex: 0, circuit: getterCircuit }),
      /own data property/i,
      "circuit accessor rejected without execution",
    );

    const wirePrototype = createCircuit(2);
    wirePrototype.wires = [Object.create({ id: "w1", from: "D13", to: "R1:A" })];
    wirePrototype.nextWireId = 2;
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lesson2, currentStepIndex: 0, circuit: wirePrototype }),
      /prototype tùy biến/i,
      "wire prototype rejected",
    );
  });

  check("unknown-input-or-circuit-fields-and-oversized-graphs-fail-closed", () => {
    expectThrow(
      () => buildPracticeCheckpointTrail({ ...inputFor(2, 0), progress: 1 }),
      /field.*canonical shape|field không đúng canonical shape/i,
      "unknown top-level field",
    );
    const unknownCircuit = { ...createCircuit(2), physicalVerified: true };
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lessonById(2), currentStepIndex: 0, circuit: unknownCircuit }),
      /canonical shape/i,
      "unknown circuit field",
    );
    const huge = createCircuit(2);
    huge.wires = Array.from({ length: 49 }, (_unused, index) => ({
      id: "w" + (index + 1),
      from: "D13",
      to: "R1:A",
    }));
    huge.nextWireId = 50;
    expectThrow(
      () => buildPracticeCheckpointTrail({ lesson: lessonById(2), currentStepIndex: 0, circuit: huge }),
      /giới hạn 48 learner wires/i,
      "wire bound before edge interpretation",
    );
  });

  check("result-is-deeply-frozen-and-does-not-expose-mutable-progress", () => {
    const trail = buildPracticeCheckpointTrail(inputFor(16, 1));
    assert(Object.isFrozen(trail), "trail frozen");
    assert(Object.isFrozen(trail.steps) && trail.steps.every(Object.isFrozen), "steps frozen");
    assert(Object.isFrozen(trail.claims), "trail claims frozen");
    assert(trail.steps.every(step => Object.isFrozen(step.claims) && Object.isFrozen(step.pairs)), "step nested structures frozen");
    assert(trail.steps.every(step => step.pairs.every(row => Object.isFrozen(row) && Object.isFrozen(row.pair))), "pair rows frozen");
    assert(!Object.prototype.hasOwnProperty.call(trail, "progress"), "no progress field");
    assert(!Object.prototype.hasOwnProperty.call(trail, "completed"), "no completion field");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
