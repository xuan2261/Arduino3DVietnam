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
      if (lesson.id === 1) {
        assert(
          evidence.scope === "manual" &&
          evidence.status === "manual-checkpoint" &&
          evidence.required === 0 &&
          evidence.matched === 0,
          "lesson01 manual checkpoint",
        );
      } else if (lesson.id === 10 || lesson.id === 14) {
        assert(
          evidence.scope === "signal-only" &&
          evidence.status === "signal-topology-match" &&
          evidence.matched === evidence.required,
          "signal-only final " + lesson.id,
        );
      } else {
        assert(
          evidence.scope === "topology" &&
          evidence.status === "topology-match" &&
          evidence.matched === evidence.required,
          "topology final " + lesson.id,
        );
      }
      assert(
        evidence.claims.physicalVerified === false &&
        evidence.claims.measured === false &&
        evidence.claims.mastery === false &&
        evidence.claims.autoCompletion === false &&
        evidence.claims.lessonCompleted === false,
        "non-claim boundary " + lesson.id,
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
        evidence.nextAction === lesson.steps[stepIndex],
        "lesson01 step " + stepIndex,
      );
    }
  });

  check("lesson02-balanced-cumulative-groups-1-2-3", () => {
    const lesson = lessonById(2);
    const reference = createSampleCircuit(2);
    for (const [stepIndex, expected] of [[0, 1], [1, 2], [2, 3]]) {
      const circuit = circuitFromReferencePrefix(2, expected);
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit: reference,
        analysis: analyzeCircuit(2, circuit),
        hasLearnerDraft: true,
      });
      assert(evidence.required === expected && evidence.matched === expected,
        "lesson02 cumulative group " + stepIndex);
    }
  });

  check("lesson08-two-edges-front-loaded-across-three-steps", () => {
    const lesson = lessonById(8);
    const reference = createSampleCircuit(8);
    const expected = [1, 2, 2];
    for (let stepIndex = 0; stepIndex < 3; stepIndex += 1) {
      const circuit = circuitFromReferencePrefix(8, expected[stepIndex]);
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit: reference,
        analysis: analyzeCircuit(8, circuit),
        hasLearnerDraft: true,
      });
      assert(evidence.required === expected[stepIndex], "lesson08 required " + stepIndex);
    }
  });

  check("lesson09-six-eleven-sixteen-cumulative-groups", () => {
    const lesson = lessonById(9);
    const reference = createSampleCircuit(9);
    const expected = [6, 11, 16];
    for (let stepIndex = 0; stepIndex < 3; stepIndex += 1) {
      const circuit = circuitFromReferencePrefix(9, expected[stepIndex]);
      const evidence = inspectPracticeEvidence({
        lesson,
        stepIndex,
        circuit,
        referenceCircuit: reference,
        analysis: analyzeCircuit(9, circuit),
        hasLearnerDraft: true,
      });
      assert(
        evidence.required === expected[stepIndex] &&
        evidence.matched === expected[stepIndex],
        "lesson09 group " + stepIndex,
      );
    }
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
      evidence.required === 1 &&
      evidence.extraPairs.length === 0,
      "unordered edge comparison",
    );
  });

  check("partial-draft-reports-missing-pairs", () => {
    const lesson = lessonById(5);
    const circuit = circuitFromReferencePrefix(5, 2);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 2,
      circuit,
      referenceCircuit: createSampleCircuit(5),
      analysis: analyzeCircuit(5, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.status === "incomplete" &&
      evidence.matched === 2 &&
      evidence.required === 7 &&
      evidence.missingPairs.length === 5,
      "partial final draft",
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
    const evidence = inspectPracticeEvidence(finalInput(16));
    assert(
      evidence.status === "topology-match" &&
      evidence.claims.sampleCopiedDoesNotProveAction === true &&
      evidence.claims.learnerActionProven === false &&
      evidence.claims.mastery === false &&
      evidence.claims.lessonCompleted === false &&
      /không phải.*mastery|không.*mastery/i.test(evidence.summary),
      "sample copy remains bounded claim",
    );
  });

  check("untouched-reference-does-not-count-as-learner-attempt", () => {
    const lesson = lessonById(6);
    const circuit = createCircuit(6);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 2,
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
      /mạch mẫu.*không được tính/i.test(evidence.summary),
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
    for (const id of [10, 14]) {
      const circuit = createSampleCircuit(id);
      const analysis = analyzeCircuit(id, circuit);
      const evidence = inspectPracticeEvidence(finalInput(id));
      assert(
        analysis.functional === false &&
        evidence.status === "signal-topology-match" &&
        evidence.claims.functionalHardware === false &&
        evidence.claims.signalOnly === true &&
        evidence.claims.physicalVerified === false,
        "signal boundary " + id,
      );
    }
  });

  check("step-match-does-not-auto-complete-lesson", () => {
    const lesson = lessonById(11);
    const circuit = circuitFromReferencePrefix(11, 2);
    const evidence = inspectPracticeEvidence({
      lesson,
      stepIndex: 0,
      circuit,
      referenceCircuit: createSampleCircuit(11),
      analysis: analyzeCircuit(11, circuit),
      hasLearnerDraft: true,
    });
    assert(
      evidence.status === "step-sample-match" &&
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
      Object.isFrozen(evidence.claims),
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
