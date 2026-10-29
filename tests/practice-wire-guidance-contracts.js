import { lessons } from "../src/lessons.js";
import { getPracticeCheckpoint } from "../src/practice-checkpoints.js";
import {
  connectCircuit,
  createCircuit,
  createSampleCircuit,
  listTerminals,
  sampleWires,
} from "../src/circuit-router.js";
import { inspectPracticeWireGuidance } from "../src/practice-wire-guidance.js";

function assert(ok, label) {
  if (!ok) throw new Error("practice-wire-guidance contract: " + label);
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

function connectPairs(lessonId, pairs) {
  let circuit = createCircuit(lessonId);
  for (const pair of pairs) circuit = connectCircuit(circuit, pair[0], pair[1]);
  return circuit;
}

function key(pair) {
  return pair[0] < pair[1]
    ? pair[0] + "\u0000" + pair[1]
    : pair[1] + "\u0000" + pair[0];
}

export function runPracticeWireGuidanceContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("all-48-authored-checkpoints-have-bounded-source-truthful-guidance", () => {
    let count = 0;
    const seenLessons = new Set();
    for (const lesson of lessons) {
      seenLessons.add(lesson.id);
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        count += 1;
        const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
        const circuit = lesson.id === 1 ? null : createCircuit(lesson.id);
        const guidance = inspectPracticeWireGuidance({ lesson, stepIndex, circuit });
        assert(guidance.lessonId === lesson.id && guidance.stepIndex === stepIndex,
          "identity " + lesson.id + "/" + stepIndex);
        assert(guidance.checkpointId === checkpoint.id, "checkpoint id " + checkpoint.id);
        assert(guidance.claims.topologyAuthority === "circuit-router" &&
          guidance.claims.authoredCheckpoint === true &&
          guidance.claims.topologyOnly === true &&
          guidance.claims.physicalVerified === false &&
          guidance.claims.measured === false &&
          guidance.claims.electricalSafetyVerified === false &&
          guidance.claims.functionalHardware === false &&
          guidance.claims.learnerActionProven === false &&
          guidance.claims.mastery === false &&
          guidance.claims.autoCompletion === false &&
          guidance.claims.lessonCompleted === false &&
          guidance.claims.prerequisiteForAdvance === false &&
          guidance.claims.teacherValidated === false &&
          guidance.claims.wireCreated === false &&
          guidance.claims.inspectorNavigationOnly === true,
        "bounded claims " + checkpoint.id);

        if (checkpoint.kind === "manual") {
          assert(guidance.status === "not-applicable-manual-checkpoint" &&
            guidance.nextMissingPair === null &&
            guidance.inspectTerminalId === null &&
            guidance.missingPairs.length === 0 &&
            guidance.reviewExtraPairs.length === 0 &&
            guidance.pairChecklist.length === 0 &&
            guidance.extraReviewChecklist.length === 0 &&
            guidance.matchedPairCount === 0 && guidance.requiredPairCount === 0,
          "manual guidance remains non-wiring " + checkpoint.id);
        } else {
          assert(guidance.status === "missing-canonical-pair", "empty wiring circuit missing status " + checkpoint.id);
          assert(JSON.stringify(guidance.nextMissingPair) === JSON.stringify(checkpoint.requiredPairs[0]),
            "first authored missing pair " + checkpoint.id);
          assert(guidance.inspectTerminalId === checkpoint.requiredPairs[0][0],
            "inspect target is deterministic authored endpoint " + checkpoint.id);
          assert(guidance.missingPairs.length === checkpoint.requiredPairs.length,
            "all authored pairs missing from empty circuit " + checkpoint.id);
          assert(guidance.pairChecklist.length === checkpoint.requiredPairs.length &&
            guidance.matchedPairCount === 0 && guidance.requiredPairCount === checkpoint.requiredPairs.length,
          "empty circuit checklist counts " + checkpoint.id);
          for (let pairIndex = 0; pairIndex < checkpoint.requiredPairs.length; pairIndex += 1) {
            const row = guidance.pairChecklist[pairIndex];
            const authoredPair = checkpoint.requiredPairs[pairIndex];
            assert(row.order === pairIndex + 1 && row.status === "missing",
              "empty checklist state/order " + checkpoint.id + "/" + pairIndex);
            assert(JSON.stringify(row.pair) === JSON.stringify(authoredPair),
              "checklist authored orientation " + checkpoint.id + "/" + pairIndex);
            assert(row.inspectTerminalId === authoredPair[0],
              "checklist inspect terminal " + checkpoint.id + "/" + pairIndex);
            assert(row.explanation.includes(authoredPair[0]) && row.explanation.includes(authoredPair[1]),
              "checklist explanation exact IDs " + checkpoint.id + "/" + pairIndex);
            assert(!/điện áp|dòng điện|an toàn điện|đã cắm|đã nối vật lý|mastery|hoàn thành/i.test(row.explanation),
              "checklist row does not invent physical/electrical/mastery claims " + checkpoint.id + "/" + pairIndex);
          }
          assert(guidance.explanation.includes(checkpoint.requiredPairs[0][0]) &&
            guidance.explanation.includes(checkpoint.requiredPairs[0][1]),
          "explanation contains exact terminal IDs " + checkpoint.id);
          assert(!/điện áp|dòng điện|đo được|an toàn điện|đã cắm|đã nối vật lý/i.test(guidance.explanation),
            "explanation must not invent physical/electrical proof " + checkpoint.id);
        }
      }
    }
    assert(count === 48, "expected 48 authored steps");
    assert(seenLessons.size === 16, "expected all 16 lessons");
  });

  check("per-pair-checklist-transitions-matched-missing-in-authored-order", () => {
    for (const lesson of lessons) {
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
        if (checkpoint.kind !== "wiring") continue;
        const firstPair = checkpoint.requiredPairs[0];
        const circuit = connectPairs(lesson.id, [firstPair]);
        const guidance = inspectPracticeWireGuidance({ lesson, stepIndex, circuit });
        assert(guidance.pairChecklist.length === checkpoint.requiredPairs.length,
          "partial checklist row count " + checkpoint.id);
        assert(guidance.pairChecklist[0].status === "matched" &&
          guidance.pairChecklist[0].order === 1 &&
          JSON.stringify(guidance.pairChecklist[0].pair) === JSON.stringify(firstPair),
        "first authored pair becomes matched " + checkpoint.id);
        assert(guidance.matchedPairCount === 1 && guidance.requiredPairCount === checkpoint.requiredPairs.length,
          "partial checklist counts " + checkpoint.id);
        for (let index = 1; index < guidance.pairChecklist.length; index += 1) {
          assert(guidance.pairChecklist[index].status === "missing",
            "later authored pair remains missing " + checkpoint.id + "/" + index);
        }
        assert(/topology match trong ứng dụng/i.test(guidance.pairChecklist[0].explanation),
          "matched row remains topology-only " + checkpoint.id);
      }
    }
  });

  check("next-missing-pair-advances-in-authored-order", () => {
    for (const lesson of lessons) {
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
        if (checkpoint.kind !== "wiring") continue;
        const first = checkpoint.requiredPairs[0];
        const circuit = connectPairs(lesson.id, [first]);
        const guidance = inspectPracticeWireGuidance({ lesson, stepIndex, circuit });
        if (checkpoint.requiredPairs.length === 1) {
          assert(guidance.status === "checkpoint-reference-covered" && guidance.nextMissingPair === null,
            "single-pair checkpoint covered " + checkpoint.id);
        } else {
          assert(JSON.stringify(guidance.nextMissingPair) === JSON.stringify(checkpoint.requiredPairs[1]),
            "second authored pair follows first " + checkpoint.id);
          assert(guidance.inspectTerminalId === checkpoint.requiredPairs[1][0],
            "second pair inspector terminal " + checkpoint.id);
        }
      }
    }
  });

  check("full-reference-sample-never-offers-missing-terminal", () => {
    for (const lesson of lessons) {
      if (lesson.id === 1) continue;
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
        const guidance = inspectPracticeWireGuidance({
          lesson,
          stepIndex,
          circuit: createSampleCircuit(lesson.id),
        });
        if (checkpoint.kind === "manual") {
          assert(guidance.status === "not-applicable-manual-checkpoint", "manual full sample " + checkpoint.id);
        } else {
          assert(guidance.status === "checkpoint-reference-covered" &&
            guidance.nextMissingPair === null && guidance.inspectTerminalId === null &&
            guidance.missingPairs.length === 0 && guidance.reviewExtraPairs.length === 0,
          "full sample has no missing guidance " + checkpoint.id);
          assert(guidance.pairChecklist.every(row => row.status === "matched") &&
            guidance.matchedPairCount === guidance.requiredPairCount &&
            guidance.requiredPairCount === checkpoint.requiredPairs.length,
          "full sample checklist is fully matched without completion claim " + checkpoint.id);
        }
      }
    }
  });

  check("learner-reference-isolation-does-not-credit-internal-reference-to-empty-learner", () => {
    for (const lessonId of [2, 3, 5, 14, 16]) {
      const lesson = lessonById(lessonId);
      const checkpoint = getPracticeCheckpoint(lesson, 0);
      if (checkpoint.kind !== "wiring") continue;
      const emptyLearner = createCircuit(lessonId);
      const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: emptyLearner });
      assert(guidance.pairChecklist.every(row => row.status === "missing"),
        "reference sample must not be credited into learner checklist lesson " + lessonId);
      assert(guidance.matchedPairCount === 0,
        "empty learner matched count stays zero lesson " + lessonId);
    }
  });

  check("unordered-endpoint-match-advances-guidance", () => {
    const lesson = lessonById(2);
    const checkpoint = getPracticeCheckpoint(lesson, 0);
    const first = checkpoint.requiredPairs[0];
    const circuit = connectCircuit(createCircuit(2), first[1], first[0]);
    const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit });
    assert(JSON.stringify(guidance.nextMissingPair) === JSON.stringify(checkpoint.requiredPairs[1]),
      "reversed endpoint still satisfies first unordered pair");
  });

  check("valid-reference-edge-outside-checkpoint-is-not-extra", () => {
    const lesson = lessonById(3);
    const checkpoint = getPracticeCheckpoint(lesson, 0);
    const fullSample = sampleWires(3);
    const checkpointKeys = new Set(checkpoint.requiredPairs.map(key));
    const future = fullSample.find(pair => !checkpointKeys.has(key(pair)));
    assert(future, "lesson03 must have sample edge outside step checkpoint");
    const circuit = connectPairs(3, [future]);
    const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit });
    assert(guidance.reviewExtraPairs.length === 0,
      "canonical sample edge outside checkpoint must not be labeled extra");
    assert(guidance.status === "missing-canonical-pair", "checkpoint still has authored missing pair");
  });

  check("extra-pair-review-is-topology-only-and-keeps-missing-guidance", () => {
    const lesson = lessonById(2);
    const circuit = connectCircuit(createCircuit(2), "D13", "GND");
    const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit });
    assert(guidance.status === "missing-canonical-pair", "missing authored pair remains primary guidance");
    assert(JSON.stringify(guidance.reviewExtraPairs) === JSON.stringify([["D13", "GND"]]),
      "extra pair review exact IDs");
    assert(guidance.extraReviewChecklist.length === 1 &&
      guidance.extraReviewChecklist[0].order === 1 &&
      guidance.extraReviewChecklist[0].status === "review-extra" &&
      JSON.stringify(guidance.extraReviewChecklist[0].pair) === JSON.stringify(["D13", "GND"]) &&
      guidance.extraReviewChecklist[0].inspectTerminalId === "D13",
    "extra review checklist exact source terminal");
    assert(/D13.*GND.*không thuộc canonical reference sample/i.test(guidance.extraReviewChecklist[0].explanation),
      "extra review checklist human-readable exact IDs");
    assert(/không thuộc canonical reference sample/i.test(guidance.reviewExplanation),
      "review states sample mismatch only");
    assert(/không suy ra lỗi điện.*vị trí cắm.*an toàn phần cứng/i.test(guidance.reviewExplanation),
      "review explicitly rejects electrical/physical inference");
    assert(!/chập|short|nguy hiểm|quá dòng|điện áp/i.test(guidance.reviewExplanation),
      "review must not invent electrical diagnosis");
  });

  check("extra-only-review-never-fabricates-missing-terminal", () => {
    const lesson = lessonById(2);
    let circuit = createSampleCircuit(2);
    circuit = connectCircuit(circuit, "D13", "GND");
    const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit });
    assert(guidance.status === "review-extra-pairs", "full checkpoint plus extra needs review");
    assert(guidance.nextMissingPair === null && guidance.inspectTerminalId === null,
      "extra-only review must not invent missing terminal");
    assert(guidance.reviewExtraPairs.length === 1, "one extra pair reported");
    assert(guidance.pairChecklist.every(row => row.status === "matched"),
      "extra-only review keeps authored checklist matched");
    assert(guidance.extraReviewChecklist.length === 1,
      "extra-only review exposes separate review checklist");
  });

  check("signal-only-checklist-never-upgrades-to-functional-hardware", () => {
    const lesson = lessonById(14);
    const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: createCircuit(14) });
    assert(guidance.status === "missing-canonical-pair" && guidance.pairChecklist.length === 2,
      "lesson14 authored signal checklist available");
    assert(guidance.claims.functionalHardware === false && guidance.claims.physicalVerified === false,
      "lesson14 checklist does not prove pump/hardware function");
    assert(!/bơm.*hoạt động|tải.*hoạt động|nguồn công suất.*đúng/i.test(
      guidance.pairChecklist.map(row => row.explanation).join(" "),
    ), "lesson14 checklist does not invent signal-only hardware function");
  });

  check("exact-terminal-ids-come-from-router-terminal-set", () => {
    for (const lesson of lessons) {
      if (lesson.id === 1) continue;
      const terminalIds = new Set(listTerminals(lesson.id).map(item => item.id));
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const checkpoint = getPracticeCheckpoint(lesson, stepIndex);
        if (checkpoint.kind !== "wiring") continue;
        const guidance = inspectPracticeWireGuidance({ lesson, stepIndex, circuit: createCircuit(lesson.id) });
        assert(terminalIds.has(guidance.inspectTerminalId), "inspect terminal canonical " + checkpoint.id);
        assert(guidance.nextMissingPair.every(id => terminalIds.has(id)),
          "missing pair terminals canonical " + checkpoint.id);
      }
    }
  });

  check("tampered-authored-step-and-out-of-range-fail-closed", () => {
    const lesson = lessonById(2);
    const tampered = { ...lesson, steps: [...lesson.steps] };
    tampered.steps[0] += " [tampered]";
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson: tampered, stepIndex: 0, circuit: createCircuit(2) }),
      /không khớp nội dung.*biên tập checkpoint/i,
      "tampered authored text",
    );
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson, stepIndex: 3, circuit: createCircuit(2) }),
      /stepIndex/i,
      "out-of-range step",
    );
  });

  check("foreign-or-forged-circuit-inputs-fail-closed", () => {
    const lesson = lessonById(2);
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: createCircuit(3) }),
      /canonical circuit|lesson hiện tại/i,
      "foreign lesson circuit",
    );
    const foreignTerminal = clone(createCircuit(2));
    foreignTerminal.wires.push({ id: "w1", from: "NOPE", to: "GND" });
    foreignTerminal.nextWireId = 2;
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: foreignTerminal }),
      /terminal ngoài lesson/i,
      "foreign terminal",
    );
    const forgedField = clone(createCircuit(2));
    forgedField.origin = "physical";
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: forgedField }),
      /field không được hỗ trợ/i,
      "forged circuit field",
    );
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: createCircuit(2), completed: true }),
      /field không được hỗ trợ/i,
      "forged input completion",
    );
  });

  check("lesson01-rejects-external-circuit-and-remains-manual", () => {
    const lesson = lessonById(1);
    const guidance = inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: null });
    assert(guidance.status === "not-applicable-manual-checkpoint" && guidance.inspectTerminalId === null,
      "lesson01 manual guidance");
    expectThrow(
      () => inspectPracticeWireGuidance({ lesson, stepIndex: 0, circuit: createCircuit(2) }),
      /Bài 01.*external circuit/i,
      "lesson01 external circuit",
    );
  });

  check("guidance-result-is-deeply-frozen", () => {
    const guidance = inspectPracticeWireGuidance({
      lesson: lessonById(16),
      stepIndex: 0,
      circuit: createCircuit(16),
    });
    assert(Object.isFrozen(guidance) &&
      Object.isFrozen(guidance.nextMissingPair) &&
      Object.isFrozen(guidance.missingPairs) &&
      guidance.missingPairs.every(Object.isFrozen) &&
      Object.isFrozen(guidance.reviewExtraPairs) &&
      Object.isFrozen(guidance.pairChecklist) &&
      guidance.pairChecklist.every(row => Object.isFrozen(row) && Object.isFrozen(row.pair)) &&
      Object.isFrozen(guidance.extraReviewChecklist) &&
      guidance.extraReviewChecklist.every(row => Object.isFrozen(row) && Object.isFrozen(row.pair)) &&
      Object.isFrozen(guidance.claims),
    "guidance deep frozen");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
