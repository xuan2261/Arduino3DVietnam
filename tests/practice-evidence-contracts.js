import { lessons } from "../src/lessons.js";
import {
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  createSampleCircuit,
} from "../src/circuit-router.js";
import { inspectPracticeEvidence } from "../src/practice-evidence.js";

function assert(ok, label) {
  if (!ok) throw new Error("practice-evidence contract: " + label);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  assert(error && pattern.test(String(error.message || error)), label);
}

function lessonById(id) {
  const lesson = lessons.find(item => item.id === id);
  if (!lesson) throw new Error("missing lesson " + id);
  return lesson;
}

function finalInput(id, overrides = {}) {
  const lesson = lessonById(id);
  if (id === 1) {
    return {
      lesson,
      stepIndex: lesson.steps.length - 1,
      circuit: null,
      referenceCircuit: null,
      analysis: null,
      hasLearnerDraft: false,
      ...overrides,
    };
  }
  const circuit = overrides.circuit ?? createSampleCircuit(id);
  const referenceCircuit = overrides.referenceCircuit ?? createSampleCircuit(id);
  const analysis = overrides.analysis ?? analyzeCircuit(id, circuit);
  return {
    lesson,
    stepIndex: lesson.steps.length - 1,
    circuit,
    referenceCircuit,
    analysis,
    hasLearnerDraft: overrides.hasLearnerDraft ?? true,
    ...overrides,
  };
}

function circuitFromReferencePrefix(id, count) {
  const reference = createSampleCircuit(id);
  let circuit = createCircuit(id);
  for (const wire of reference.wires.slice(0, count)) {
    circuit = connectCircuit(circuit, wire.from, wire.to);
  }
  return circuit;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function runPracticeEvidenceContracts() {
  const checks = [];
  const check = (name, run) => {
    run();
    checks.push(name);
  };

  for (const lesson of lessons) {
    check("lesson-" + String(lesson.id).padStart(2, "0") + "-final-evidence", () => {
      const evidence = inspectPracticeEvidence(finalInput(lesson.id));
      assert(evidence.lessonId === lesson.id, "lesson id " + lesson.id);
      assert(evidence.stepIndex === lesson.steps.length - 1, "final step " + lesson.id);
      assert(
        evidence.scope === "manual" &&
        evidence.status === "manual-checkpoint" &&
        evidence.required === 0 &&
        evidence.matched === 0 &&
        evidence.checkpoint.kind === "manual",
        "final simulation/observation step remains manual " + lesson.id,
      );
      assert(
        evidence.claims.physicalVerified === false &&
        evidence.claims.measured === false &&
        evidence.claims.mastery === false &&
        evidence.claims.autoCompletion === false &&
        evidence.claims.lessonCompleted === false &&
        evidence.claims.teacherValidated === false &&
        evidence.claims.checkpointPrerequisiteForAdvance === false,
        "non-claim boundary " + lesson.id,
      );
      assert(
        evidence.checkpoint.provenance.scheme === "human-authored-from-lesson-text" &&
        evidence.checkpoint.provenance.teacherValidated === false,
        "authored provenance " + lesson.id,
      );
    });
  }

  check("lesson01-each-step-remains-manual", () => {
    const lesson = lessonById(1);
    for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit: null,
        referenceCircuit: null,
        analysis: null,
        hasLearnerDraft: false,
      });
      assert(
        evidence.status === "manual-checkpoint" &&
        evidence.checkpoint.sourceStep === lesson.steps[stepIndex] &&
        evidence.nextAction === evidence.guidance &&
        evidence.checkpoint.provenance.scheme === "human-authored-from-lesson-text",
        "lesson01 step " + stepIndex,
      );
    }
  });

  check("all-48-authored-checkpoints-integrate-with-inspector", () => {
    for (const lesson of lessons) {
      for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
        const circuit = lesson.id === 1 ? null : createSampleCircuit(lesson.id);
        const referenceCircuit = lesson.id === 1 ? null : createSampleCircuit(lesson.id);
        const analysis = lesson.id === 1 ? null : analyzeCircuit(lesson.id, circuit);
        const evidence = inspectPracticeEvidence({
          lesson,
          stepIndex,
          circuit,
          referenceCircuit,
          analysis,
          hasLearnerDraft: lesson.id !== 1,
        });
        assert(evidence.checkpoint.sourceStep === lesson.steps[stepIndex],
          "source-step integration " + lesson.id + "/" + stepIndex);
        assert(evidence.guidance === evidence.checkpoint.guidance,
          "guidance integration " + lesson.id + "/" + stepIndex);
        if (evidence.checkpoint.kind === "manual") {
          assert(
            evidence.status === "manual-checkpoint" && evidence.required === 0 && evidence.matched === 0,
            "manual integration " + lesson.id + "/" + stepIndex,
          );
        } else {
          assert(
            evidence.required === evidence.checkpoint.requiredPairs.length &&
            evidence.matched === evidence.required &&
            ["topology-match", "signal-topology-match"].includes(evidence.status),
            "wiring integration " + lesson.id + "/" + stepIndex,
          );
        }
        assert(
          evidence.claims.teacherValidated === false &&
          evidence.claims.learnerActionProven === false &&
          evidence.claims.mastery === false &&
          evidence.claims.autoCompletion === false,
          "bounded claims integration " + lesson.id + "/" + stepIndex,
        );
      }
    }
  });

  check("lesson02-authored-wiring-only-on-step-1", () => {
    const lesson = lessonById(2);
    const reference = createSampleCircuit(2);
    const circuit = createSampleCircuit(2);
    const wiring = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: reference,
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    assert(
      wiring.checkpoint.kind === "wiring" && wiring.required === 3 && wiring.matched === 3 &&
      wiring.status === "topology-match",
      "lesson02 step1 authored LED branch",
    );
    for (const stepIndex of [1, 2]) {
      const manual = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit: reference,
        analysis: analyzeCircuit(2, circuit),
        hasLearnerDraft: true,
      });
      assert(
        manual.status === "manual-checkpoint" && manual.required === 0 && manual.matched === 0,
        "lesson02 timing/simulation manual " + stepIndex,
      );
    }
  });

  // legacy expectation retired by requested authored checkpoint behavior, check absence
  check("lesson02-balanced-cumulative-groups-1-2-3", () => {
    const lesson = lessonById(2);
    const circuit = createSampleCircuit(2);
    const referenceCircuit = createSampleCircuit(2);
    const requiredByStep = [];
    const statuses = [];
    for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit,
        analysis: analyzeCircuit(2, circuit),
        hasLearnerDraft: true,
      });
      requiredByStep.push(evidence.required);
      statuses.push(evidence.status);
      assert(evidence.checkpoint.provenance.scheme === "human-authored-from-lesson-text",
        "lesson02 legacy check requires authored provenance step " + stepIndex);
      assert(evidence.claims.teacherValidated === false &&
        evidence.claims.checkpointPrerequisiteForAdvance === false &&
        evidence.claims.autoCompletion === false &&
        evidence.claims.lessonCompleted === false,
      "lesson02 legacy check preserves no-teacher/no-advance/no-completion boundary step " + stepIndex);
    }
    assert(JSON.stringify(requiredByStep) === JSON.stringify([3, 0, 0]),
      "lesson02 authored requirements must be [3,0,0]");
    assert(JSON.stringify(requiredByStep) !== JSON.stringify([1, 2, 3]),
      "lesson02 superseded balanced cumulative [1,2,3] must remain absent");
    assert(statuses[1] === "manual-checkpoint" && statuses[2] === "manual-checkpoint",
      "lesson02 timing/simulation steps remain manual");
  });

  check("lesson08-authored-buzzer-polarity-only-on-step-1", () => {
    const lesson = lessonById(8);
    const reference = createSampleCircuit(8);
    const circuit = createSampleCircuit(8);
    const wiring = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: reference,
      analysis: analyzeCircuit(8, circuit),
      hasLearnerDraft: true,
    });
    assert(wiring.required === 2 && wiring.matched === 2 && wiring.checkpoint.kind === "wiring",
      "lesson08 step1 buzzer polarity");
    for (const stepIndex of [1, 2]) {
      const manual = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit: reference,
        analysis: analyzeCircuit(8, circuit),
        hasLearnerDraft: true,
      });
      assert(manual.status === "manual-checkpoint", "lesson08 control/simulation manual " + stepIndex);
    }
  });

  // legacy expectation retired by requested authored checkpoint behavior, check absence
  check("lesson08-two-edges-front-loaded-across-three-steps", () => {
    const lesson = lessonById(8);
    const circuit = createSampleCircuit(8);
    const referenceCircuit = createSampleCircuit(8);
    const requiredByStep = [];
    const kinds = [];
    for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit,
        analysis: analyzeCircuit(8, circuit),
        hasLearnerDraft: true,
      });
      requiredByStep.push(evidence.required);
      kinds.push(evidence.checkpoint.kind);
      assert(evidence.checkpoint.provenance.scheme === "human-authored-from-lesson-text" &&
        evidence.claims.teacherValidated === false,
      "lesson08 legacy check requires authored no-teacher provenance step " + stepIndex);
      assert(evidence.claims.checkpointPrerequisiteForAdvance === false &&
        evidence.claims.autoCompletion === false &&
        evidence.claims.lessonCompleted === false,
      "lesson08 legacy check preserves no-advance/no-completion boundary step " + stepIndex);
    }
    assert(JSON.stringify(requiredByStep) === JSON.stringify([2, 0, 0]),
      "lesson08 authored requirements must be [2,0,0]");
    assert(JSON.stringify(requiredByStep) !== JSON.stringify([1, 2, 2]),
      "lesson08 superseded front-loaded [1,2,2] must remain absent");
    assert(JSON.stringify(kinds) === JSON.stringify(["wiring", "manual", "manual"]),
      "lesson08 authored/manual kinds must remain explicit");
  });

  check("lesson09-frequency-steps-have-no-invented-wiring-checkpoint", () => {
    const lesson = lessonById(9);
    const reference = createSampleCircuit(9);
    for (let stepIndex = 0; stepIndex < 3; stepIndex += 1) {
      const circuit = createSampleCircuit(9);
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit: reference,
        analysis: analyzeCircuit(9, circuit),
        hasLearnerDraft: true,
      });
      assert(
        evidence.status === "manual-checkpoint" &&
        evidence.required === 0 &&
        evidence.matched === 0,
        "lesson09 manual frequency step " + stepIndex,
      );
    }
  });

  // legacy expectation retired by requested authored checkpoint behavior, check absence
  check("lesson09-six-eleven-sixteen-cumulative-groups", () => {
    const lesson = lessonById(9);
    const circuit = createSampleCircuit(9);
    const referenceCircuit = createSampleCircuit(9);
    const requiredByStep = [];
    for (let stepIndex = 0; stepIndex < lesson.steps.length; stepIndex += 1) {
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit,
        analysis: analyzeCircuit(9, circuit),
        hasLearnerDraft: true,
      });
      requiredByStep.push(evidence.required);
      assert(evidence.status === "manual-checkpoint" && evidence.checkpoint.kind === "manual",
        "lesson09 legacy check requires manual authored semantics step " + stepIndex);
      assert(evidence.checkpoint.provenance.scheme === "human-authored-from-lesson-text" &&
        evidence.claims.teacherValidated === false &&
        evidence.claims.checkpointPrerequisiteForAdvance === false &&
        evidence.claims.autoCompletion === false &&
        evidence.claims.lessonCompleted === false,
      "lesson09 legacy check preserves provenance and no implicit completion step " + stepIndex);
    }
    assert(JSON.stringify(requiredByStep) === JSON.stringify([0, 0, 0]),
      "lesson09 authored requirements must remain all manual");
    assert(JSON.stringify(requiredByStep) !== JSON.stringify([6, 11, 16]),
      "lesson09 superseded cumulative [6,11,16] must remain absent");
  });

  check("future-valid-reference-edge-is-not-extra", () => {
    const lesson = lessonById(3);
    const reference = createSampleCircuit(3);
    const last = reference.wires.at(-1);
    const circuit = connectCircuit(createCircuit(3), last.from, last.to);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: reference,
      analysis: analyzeCircuit(3, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.status === "incomplete" &&
      evidence.extraPairs.length === 0 &&
      evidence.missingPairs.length > 0,
      "future reference edge must not be extra",
    );
  });

  check("unordered-endpoints-match-reference", () => {
    const lesson = lessonById(2);
    const reference = createSampleCircuit(2);
    const first = reference.wires[0];
    const circuit = connectCircuit(createCircuit(2), first.to, first.from);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: reference,
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.matched === 1 &&
      evidence.required === 3 &&
      evidence.missingPairs.length === 2 &&
      evidence.extraPairs.length === 0,
      "unordered edge comparison",
    );
  });

  check("partial-draft-reports-missing-pairs", () => {
    const lesson = lessonById(16);
    const circuit = circuitFromReferencePrefix(16, 2);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(16),
      analysis: analyzeCircuit(16, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.status === "incomplete" &&
      evidence.matched === 2 &&
      evidence.required === 14 &&
      evidence.missingPairs.length === 12,
      "partial authored full-pin-table checkpoint",
    );
  });

  check("unsafe-extra-edge-never-success", () => {
    const lesson = lessonById(2);
    const circuit = connectCircuit(createCircuit(2), "D13", "GND");
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(2),
      analysis: analyzeCircuit(2, circuit),
      hasLearnerDraft: true,
    });
    const codes = new Set(evidence.issues.map(item => item.code));
    assert(
      evidence.status === "needs-correction" &&
      evidence.extraPairs.length === 1 &&
      codes.has("SHORT_D13_GND"),
      "unsafe extra edge",
    );
  });

  check("sample-copied-match-is-not-action-or-mastery-proof", () => {
    const lesson = lessonById(16);
    const circuit = createSampleCircuit(16);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(16),
      analysis: analyzeCircuit(16, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.status === "topology-match" &&
      evidence.claims.sampleCopiedDoesNotProveAction === true &&
      evidence.claims.learnerActionProven === false &&
      evidence.claims.mastery === false &&
      evidence.claims.lessonCompleted === false &&
      evidence.claims.teacherValidated === false &&
      /không chứng minh.*mastery|không phải.*mastery/i.test(evidence.summary),
      "sample copy remains bounded claim",
    );
  });

  check("untouched-reference-does-not-count-as-learner-attempt", () => {
    const lesson = lessonById(6);
    const circuit = createCircuit(6);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(6),
      analysis: analyzeCircuit(6, circuit),
      hasLearnerDraft: false,
    });
    assert(
      evidence.status === "not-attempted" &&
      evidence.matched === 0 &&
      evidence.extraPairs.length === 0 &&
      /ứng dụng chưa ghi nhận bản tự đấu/i.test(evidence.summary) &&
      !/chưa có dây do người học tạo|chưa có thao tác đấu dây của người học/i.test(evidence.summary) &&
      evidence.claims.learnerActionProven === false &&
      /reference sample/i.test(evidence.summary),
      "reference alone cannot count; absent in-app draft cannot disprove learner action elsewhere",
    );
  });

  check("cleared-learner-draft-is-incomplete-not-not-attempted", () => {
    const lesson = lessonById(7);
    const circuit = createCircuit(7);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(7),
      analysis: analyzeCircuit(7, circuit),
      hasLearnerDraft: true,
    });
    assert(evidence.status === "incomplete" && evidence.matched === 0,
      "explicit cleared draft remains attempt");
  });

  check("signal-only-lessons-never-claim-functional-hardware", () => {
    const lesson10 = lessonById(10);
    const circuit10 = createSampleCircuit(10);
    const analysis10 = analyzeCircuit(10, circuit10);
    const evidence10 = inspectPracticeEvidence({
      lesson: lesson10,
      stepIndex: 0,
      circuit: circuit10,
      referenceCircuit: createSampleCircuit(10),
      analysis: analysis10,
      hasLearnerDraft: true,
    });
    assert(
      analysis10.functional === false &&
      evidence10.status === "manual-checkpoint" &&
      evidence10.claims.functionalHardware === false &&
      evidence10.claims.signalOnly === true &&
      evidence10.claims.physicalVerified === false,
      "lesson10 manual signal boundary",
    );

    const lesson14 = lessonById(14);
    const circuit14 = createSampleCircuit(14);
    const analysis14 = analyzeCircuit(14, circuit14);
    const evidence14 = inspectPracticeEvidence({
      lesson: lesson14,
      stepIndex: 0,
      circuit: circuit14,
      referenceCircuit: createSampleCircuit(14),
      analysis: analysis14,
      hasLearnerDraft: true,
    });
    assert(
      analysis14.functional === false &&
      evidence14.status === "signal-topology-match" &&
      evidence14.claims.functionalHardware === false &&
      evidence14.claims.signalOnly === true &&
      evidence14.claims.physicalVerified === false,
      "lesson14 authored signal boundary",
    );
  });

  check("step-match-does-not-auto-complete-lesson", () => {
    const lesson = lessonById(3);
    const circuit = circuitFromReferencePrefix(3, 4);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(3),
      analysis: analyzeCircuit(3, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.status === "step-sample-match" &&
      evidence.matched === 4 && evidence.required === 4 &&
      evidence.claims.autoCompletion === false &&
      evidence.claims.lessonCompleted === false,
      "step match no completion",
    );
  });

  check("lesson-mismatch-circuit-fails-closed", () => {
    expectThrow(
      () => inspectPracticeEvidence({
        ...finalInput(2),
        circuit: createSampleCircuit(3),
        analysis: analyzeCircuit(3, createSampleCircuit(3)),
      }),
      /lesson|canonical circuit/i,
      "foreign lesson circuit",
    );
  });

  check("foreign-terminal-fails-closed", () => {
    const input = finalInput(2);
    const circuit = clone(input.circuit);
    circuit.wires[0].from = "NOPE";
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /terminal ngoài lesson/i,
      "foreign terminal",
    );
  });

  check("duplicate-wire-id-fails-closed", () => {
    const input = finalInput(3);
    const circuit = clone(input.circuit);
    circuit.wires[1].id = circuit.wires[0].id;
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /wire id trùng/i,
      "duplicate id",
    );
  });

  check("duplicate-unordered-edge-fails-closed", () => {
    const input = finalInput(2);
    const circuit = clone(input.circuit);
    const first = circuit.wires[0];
    circuit.wires.push({
      id: "w99",
      from: first.to,
      to: first.from,
    });
    circuit.nextWireId = 100;
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /duplicate unordered edge/i,
      "duplicate pair",
    );
  });

  check("forged-wire-field-fails-closed", () => {
    const input = finalInput(2);
    const circuit = clone(input.circuit);
    circuit.wires[0].physicalVerified = true;
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /field không canonical/i,
      "forged wire field",
    );
  });

  check("forged-circuit-field-fails-closed", () => {
    const input = finalInput(2);
    const circuit = clone(input.circuit);
    circuit.origin = "physical";
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /field không thuộc canonical circuit/i,
      "forged circuit field",
    );
  });

  check("forged-extended-engine-marker-fails-closed", () => {
    const input = finalInput(10);
    const circuit = clone(input.circuit);
    delete circuit.engine;
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /engine marker.*canonical router/i,
      "missing extended engine marker",
    );
  });

  check("reference-must-equal-createSampleCircuit", () => {
    const input = finalInput(4);
    const referenceCircuit = createCircuit(4);
    expectThrow(
      () => inspectPracticeEvidence({ ...input, referenceCircuit }),
      /referenceCircuit không khớp/i,
      "forged reference",
    );
  });

  check("forged-analysis-ok-flag-fails-closed", () => {
    const lesson = lessonById(2);
    const circuit = createCircuit(2);
    const analysis = clone(analyzeCircuit(2, circuit));
    analysis.ok = true;
    expectThrow(
      () => inspectPracticeEvidence({
        lesson,
        stepIndex: 0,
        circuit,
        referenceCircuit: createSampleCircuit(2),
        analysis,
        hasLearnerDraft: false,
      }),
      /analysis không khớp/i,
      "forged analysis",
    );
  });

  check("analysis-lesson-mismatch-fails-closed", () => {
    const input = finalInput(2);
    expectThrow(
      () => inspectPracticeEvidence({
        ...input,
        analysis: analyzeCircuit(3, createSampleCircuit(3)),
      }),
      /analysis thuộc lesson khác/i,
      "analysis lesson mismatch",
    );
  });

  check("false-draft-flag-with-wires-fails-closed", () => {
    expectThrow(
      () => inspectPracticeEvidence(finalInput(2, { hasLearnerDraft: false })),
      /hasLearnerDraft=false/i,
      "sample cannot masquerade as untouched learner",
    );
  });

  check("lesson01-external-circuit-fails-closed", () => {
    const lesson = lessonById(1);
    expectThrow(
      () => inspectPracticeEvidence({
        lesson,
        stepIndex: 0,
        circuit: createCircuit(2),
        referenceCircuit: null,
        analysis: null,
        hasLearnerDraft: false,
      }),
      /Bài 01.*external wiring/i,
      "lesson01 external graph",
    );
  });

  check("step-index-out-of-range-fails-closed", () => {
    expectThrow(
      () => inspectPracticeEvidence({ ...finalInput(2), stepIndex: 3 }),
      /stepIndex/i,
      "step range",
    );
  });

  check("malformed-lesson-steps-fail-closed", () => {
    const input = finalInput(2);
    expectThrow(
      () => inspectPracticeEvidence({
        ...input,
        lesson: { ...input.lesson, steps: [] },
      }),
      /lesson.steps/i,
      "malformed steps",
    );
  });

  check("tampered-authored-lesson-text-fails-closed-through-inspector", () => {
    const input = finalInput(16);
    const lesson = { ...input.lesson, steps: [...input.lesson.steps] };
    lesson.steps[0] += " [tampered]";
    expectThrow(
      () => inspectPracticeEvidence({ ...input, lesson, stepIndex: 0 }),
      /không khớp nội dung.*biên tập checkpoint/i,
      "tampered authored lesson text",
    );
  });

  check("hasLearnerDraft-must-be-boolean", () => {
    expectThrow(
      () => inspectPracticeEvidence({ ...finalInput(2), hasLearnerDraft: "yes" }),
      /hasLearnerDraft.*boolean/i,
      "draft flag type",
    );
  });

  check("unknown-input-field-fails-closed", () => {
    expectThrow(
      () => inspectPracticeEvidence({ ...finalInput(2), physicalVerified: true }),
      /field không được hỗ trợ/i,
      "unknown top-level input",
    );
  });

  check("wire-count-bound-fails-before-edge-interpretation", () => {
    const input = finalInput(2);
    const circuit = clone(input.circuit);
    circuit.wires = Array.from({ length: 65 }, (_unused, index) => ({
      id: "w" + (index + 1),
      from: "D13",
      to: "R1:A",
    }));
    circuit.nextWireId = 66;
    expectThrow(
      () => inspectPracticeEvidence({ ...input, circuit }),
      /giới hạn 64 dây/i,
      "wire bound",
    );
  });

  check("result-is-deeply-frozen", () => {
    const evidence = inspectPracticeEvidence(finalInput(3));
    assert(
      Object.isFrozen(evidence) &&
      Object.isFrozen(evidence.missingPairs) &&
      Object.isFrozen(evidence.extraPairs) &&
      Object.isFrozen(evidence.issues) &&
      Object.isFrozen(evidence.claims) &&
      Object.isFrozen(evidence.checkpoint) &&
      Object.isFrozen(evidence.checkpoint.requiredPairs) &&
      Object.isFrozen(evidence.checkpoint.provenance),
      "deep freeze top-level",
    );
    assert(evidence.issues.every(Object.isFrozen), "issue objects frozen");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
