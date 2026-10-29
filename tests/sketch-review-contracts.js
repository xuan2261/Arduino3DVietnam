import { lessons } from "../src/lessons.js";
import {
  inspectSketchDraft,
  SKETCH_REVIEW_BOUNDARIES,
  SKETCH_REVIEW_LIMITS,
} from "../src/sketch-review.js";

function assert(condition, message) {
  if (!condition) throw new Error("sketch-review contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function sampleReference() {
  return [
    "const int LED = 13;",
    "void setup() {",
    "  pinMode(LED, OUTPUT);",
    "}",
    "void loop() {",
    "  digitalWrite(LED, HIGH);",
    "  delay(1000);",
    "}",
  ].join("\n");
}

export function runSketchReviewContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("boundaries-are-text-only-and-noncompletion", () => {
    assert(SKETCH_REVIEW_BOUNDARIES.localTextComparison === true, "text boundary missing");
    assert(SKETCH_REVIEW_BOUNDARIES.heuristicOnly === true, "heuristic boundary missing");
    for (const key of [
      "compilesCpp",
      "validatesArduinoSemantics",
      "executesFirmware",
      "validatesSimulationBehavior",
      "validatesHardware",
      "provesLearnerCompletion",
      "provesLearnerMastery",
    ]) {
      assert(SKETCH_REVIEW_BOUNDARIES[key] === false, key + " must stay false");
    }
    assert(SKETCH_REVIEW_LIMITS.maxSourceChars === 12000, "must match editor maxlength");
  });

  check("all-16-reference-sketches-are-unchanged", () => {
    assert(lessons.length === 16, "expected 16 lessons");
    for (const lesson of lessons) {
      const result = inspectSketchDraft({
        lessonId: lesson.id,
        reference: lesson.sketch,
        draft: lesson.sketch,
      });
      assert(result.lessonId === lesson.id, "lesson identity " + lesson.id);
      assert(result.status === "reference", "lesson " + lesson.id + " should be reference");
      assert(result.changes.changedLines === 0, "lesson " + lesson.id + " changed count");
      assert(result.changes.modifiedLines === 0, "lesson " + lesson.id + " modified count");
      assert(result.structure.setupPresent && result.structure.loopPresent,
        "lesson " + lesson.id + " setup/loop detection");
      assert(result.structure.bracesBalanced === true, "lesson " + lesson.id + " braces");
      assert(result.warnings.length === 0, "lesson " + lesson.id + " unexpected warning");
      assert(
        result.lexical.mode === "masked-reference-pattern-scan" &&
        result.lexical.commentsAndStringsIgnored === true &&
        result.lexical.expectedFeatureCount > 0 &&
        result.lexical.differenceCount === 0 &&
        result.lexical.findings.every(item =>
          item.status === "present" &&
          Number.isInteger(item.referenceLine) &&
          Number.isInteger(item.draftLine)),
        "lesson " + lesson.id + " lexical baseline",
      );
      assert(result.claims.compiled === false && result.claims.firmwareExecuted === false,
        "lesson " + lesson.id + " forbidden claim");
    }
  });

  check("single-line-replacement-is-one-modified-line", () => {
    const reference = sampleReference();
    const result = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: reference.replace("delay(1000);", "delay(250);"),
    });
    assert(result.status === "changed", "replacement status");
    assert(
      result.changes.changedLines === 1 &&
      result.changes.modifiedLines === 1 &&
      result.changes.addedLines === 0 &&
      result.changes.removedLines === 0,
      "replacement classification",
    );
    assert(result.changes.totalHunks === 1 && result.changes.hunks.length === 1,
      "replacement hunk");
    assert(result.structure.loopChanged === true && result.structure.setupChanged === false,
      "loop-only change detection");
  });

  check("insertions-and-deletions-are-classified-with-line-ranges", () => {
    const reference = sampleReference();
    const added = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: reference.replace("  pinMode(LED, OUTPUT);", "  pinMode(LED, OUTPUT);\n  Serial.begin(9600);"),
    });
    assert(added.changes.addedLines === 1 && added.changes.modifiedLines === 0,
      "pure addition");
    assert(added.changes.hunks[0].draftStartLine !== null, "addition draft range");

    const removed = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: reference.replace("  pinMode(LED, OUTPUT);\n", ""),
    });
    assert(removed.changes.removedLines === 1 && removed.changes.modifiedLines === 0,
      "pure deletion");
    assert(removed.changes.hunks[0].referenceStartLine !== null, "deletion reference range");
  });

  check("crlf-normalization-does-not-create-fake-changes", () => {
    const reference = sampleReference();
    const result = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: reference.replace(/\n/g, "\r\n"),
    });
    assert(result.status === "reference" && result.changes.changedLines === 0,
      "CRLF should normalize");
  });

  check("setup-and-loop-regions-are-source-aware", () => {
    const reference = sampleReference();
    const setupEdit = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: reference.replace("pinMode(LED, OUTPUT);", "pinMode(LED, INPUT);"),
    });
    assert(setupEdit.structure.setupChanged === true, "setup body change not detected");
    assert(setupEdit.guidance.some(text => /setup\(\).*khác mã tham khảo/i.test(text)),
      "setup practical guidance");

    const loopEdit = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: reference.replace("digitalWrite(LED, HIGH);", "digitalWrite(LED, LOW);"),
    });
    assert(loopEdit.structure.loopChanged === true, "loop body change not detected");
    assert(loopEdit.guidance.some(text => /loop\(\).*khác mã tham khảo/i.test(text)),
      "loop practical guidance");

    const stringReference = lessons[2].sketch;
    const stringEdit = inspectSketchDraft({
      lessonId: 3,
      reference: stringReference,
      draft: stringReference.replace('"DA NHAN"', '"PRESSED"'),
    });
    assert(stringEdit.structure.loopChanged === true,
      "literal edit inside loop must remain a source-region change");
  });

  check("missing-or-unrecognized-setup-loop-produce-heuristic-warnings", () => {
    const reference = sampleReference();
    const missing = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "int value = 1;\nvoid helper() { value++; }",
    });
    const missingCodes = missing.warnings.map(item => item.code);
    assert(missingCodes.includes("SETUP_MISSING"), "missing setup warning");
    assert(missingCodes.includes("LOOP_MISSING"), "missing loop warning");

    const unusual = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "int setup() { return 0; }\nint loop() { return 0; }",
    });
    const unusualCodes = unusual.warnings.map(item => item.code);
    assert(unusualCodes.includes("SETUP_NOT_RECOGNIZED"), "unusual setup warning");
    assert(unusualCodes.includes("LOOP_NOT_RECOGNIZED"), "unusual loop warning");
  });

  check("braces-inside-comments-and-strings-are-ignored", () => {
    const reference = sampleReference();
    const draft = [
      "void setup() {",
      "  const char *label = \"([{}]) literal\";",
      "  // } ) ] comment must not close syntax",
      "  /* { block } ( [ ) ] */",
      "}",
      "void loop() {",
      "  const char marker = '}';",
      "}",
    ].join("\n");
    const result = inspectSketchDraft({ lessonId: 2, reference, draft });
    assert(result.structure.bracesBalanced === true, "masked braces should balance");
    assert(result.structure.parenthesesBalanced === true, "masked parentheses should balance");
    assert(result.structure.bracketsBalanced === true, "masked brackets should balance");
    assert(!result.warnings.some(item => item.code.startsWith("BRACE_")),
      "masked braces must not warn");
    assert(!result.warnings.some(item => item.code.startsWith("PAREN_") || item.code.startsWith("BRACKET_")),
      "masked parentheses/brackets must not warn");
  });

  check("mismatched-braces-report-direction-and-line", () => {
    const reference = sampleReference();
    const open = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {\n}\nvoid loop() {\n  if (true) {\n}\n",
    });
    const openWarning = open.warnings.find(item => item.code === "BRACE_UNCLOSED_OPEN");
    assert(openWarning && openWarning.line === 3, "unclosed opening line");
    assert(open.structure.bracesBalanced === false, "unclosed braces must fail balance");

    const close = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {}\nvoid loop() {}\n}",
    });
    const closeWarning = close.warnings.find(item => item.code === "BRACE_EXTRA_CLOSE");
    assert(closeWarning && closeWarning.line === 3, "extra closing line");
    assert(close.structure.extraClosingBraces === 1, "extra closing count");
  });

  check("unterminated-comment-and-string-have-explicit-heuristic-warnings", () => {
    const reference = sampleReference();
    const block = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {}\nvoid loop() { /* unfinished",
    });
    assert(block.warnings.some(item => item.code === "BLOCK_COMMENT_UNCLOSED"),
      "block comment warning");

    const string = inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {}\nvoid loop() {\n  const char *s = \"unfinished\n}",
    });
    assert(string.warnings.some(item => item.code === "STRING_LITERAL_UNCLOSED"),
      "string warning");
  });

  check("commented-and-quoted-reference-calls-do-not-count-as-lexical-presence", () => {
    const reference = sampleReference();
    const draft = [
      "void setup() {",
      "  // pinMode(LED, OUTPUT);",
      "  const char *fake = \"digitalWrite(LED, HIGH); delay(1000);\";",
      "}",
      "void loop() {",
      "  /* digitalWrite(LED, HIGH); */",
      "  // delay(1000);",
      "}",
    ].join("\n");
    const result = inspectSketchDraft({ lessonId: 2, reference, draft });
    const byId = new Map(result.lexical.findings.map(item => [item.id, item]));
    for (const id of ["pin-mode", "digital-write", "delay"]) {
      assert(byId.get(id)?.status === "absent", id + " must ignore comment/string text");
      assert(byId.get(id)?.draftCount === 0, id + " draft count must be zero");
      assert(Number.isInteger(byId.get(id)?.referenceLine), id + " reference line missing");
      assert(byId.get(id)?.draftLine === null, id + " absent draft line must be null");
    }
    assert(result.lexical.differenceCount === 3, "three tracked features should differ");
  });

  check("reduced-call-count-is-line-aware-and-does-not-claim-equivalence", () => {
    const reference = lessons[1].sketch;
    const draft = reference.replace(
      "  digitalWrite(LED, HIGH);",
      "  // digitalWrite(LED, HIGH);",
    );
    const result = inspectSketchDraft({ lessonId: 2, reference, draft });
    const finding = result.lexical.findings.find(item => item.id === "digital-write");
    assert(finding?.status === "fewer-than-reference", "reduced digitalWrite count status");
    assert(finding?.referenceCount === 2 && finding?.draftCount === 1, "digitalWrite counts");
    assert(Number.isInteger(finding.referenceLine) && Number.isInteger(finding.draftLine),
      "reduced feature must retain reference/draft lines");
    assert(typeof finding.hint === "string" && finding.hint.length > 20, "actionable hint missing");
  });

  check("near-name-tampering-does-not-satisfy-reference-pattern", () => {
    const reference = sampleReference();
    const draft = [
      "const int LED = 13;",
      "void setup() { pinMode(LED, OUTPUT); }",
      "void loop() {",
      "  digitalWriteX(LED, HIGH);",
      "  delayish(1000);",
      "}",
    ].join("\n");
    const result = inspectSketchDraft({ lessonId: 2, reference, draft });
    const byId = new Map(result.lexical.findings.map(item => [item.id, item]));
    assert(byId.get("digital-write")?.status === "absent", "digitalWriteX must not match digitalWrite");
    assert(byId.get("delay")?.status === "absent", "delayish must not match delay");
  });

  check("unbalanced-parentheses-and-brackets-are-line-aware-lexical-warnings", () => {
    const reference = sampleReference();
    const draft = [
      "void setup() { pinMode(LED, OUTPUT; }",
      "void loop() { int samples[2; }",
    ].join("\n");
    const result = inspectSketchDraft({ lessonId: 2, reference, draft });
    const paren = result.warnings.find(item => item.code === "PAREN_UNCLOSED_OPEN");
    const bracket = result.warnings.find(item => item.code === "BRACKET_UNCLOSED_OPEN");
    assert(paren?.line === 1, "unclosed parenthesis line");
    assert(bracket?.line === 2, "unclosed bracket line");
    assert(result.structure.parenthesesBalanced === false, "parentheses balance flag");
    assert(result.structure.bracketsBalanced === false, "brackets balance flag");
    assert(result.guidance.some(text => /lexical.*không phải parser C\+\+/i.test(text)),
      "delimiter lexical boundary guidance");
  });

  check("empty-draft-is-reviewable-but-never-positive", () => {
    const result = inspectSketchDraft({
      lessonId: 2,
      reference: sampleReference(),
      draft: "",
    });
    const codes = result.warnings.map(item => item.code);
    assert(result.status === "changed", "empty draft status");
    assert(result.changes.draftLines === 0, "empty draft line count");
    assert(codes.includes("DRAFT_EMPTY") && codes.includes("SETUP_MISSING") && codes.includes("LOOP_MISSING"),
      "empty draft warnings");
    assert(result.claims.semanticValidated === false && result.claims.learnerCompletion === false,
      "empty draft forbidden claims");
  });

  check("input-shape-types-and-bounds-fail-closed", () => {
    const reference = sampleReference();
    expectThrow(() => inspectSketchDraft(null), /object/i, "null input");
    expectThrow(() => inspectSketchDraft({ lessonId: 0, reference, draft: reference }),
      /lessonId.*1\.\.16/i, "lesson lower bound");
    expectThrow(() => inspectSketchDraft({ lessonId: 2, reference: 12, draft: reference }),
      /reference.*chuỗi/i, "reference type");
    expectThrow(() => inspectSketchDraft({ lessonId: 2, reference: " ", draft: reference }),
      /reference.*rỗng/i, "empty reference");
    expectThrow(() => inspectSketchDraft({ lessonId: 2, reference, draft: reference, compiled: true }),
      /field không được hỗ trợ/i, "unknown field");
    expectThrow(() => inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "x".repeat(SKETCH_REVIEW_LIMITS.maxSourceChars + 1),
    }), /12000 ký tự/i, "char bound");
    expectThrow(() => inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: Array.from({ length: SKETCH_REVIEW_LIMITS.maxSourceLines + 1 }, () => "x").join("\n"),
    }), /600 dòng/i, "line bound");
    expectThrow(() => inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "x".repeat(SKETCH_REVIEW_LIMITS.maxLineChars + 1),
    }), /dòng 1.*2000 ký tự/i, "line length bound");
  });

  check("unsafe-control-bidi-and-broken-unicode-fail-closed", () => {
    const reference = sampleReference();
    expectThrow(() => inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {}\u0000\nvoid loop() {}",
    }), /ký tự điều khiển/i, "NUL");
    expectThrow(() => inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {}\u202E\nvoid loop() {}",
    }), /ký tự điều khiển/i, "bidi override");
    expectThrow(() => inspectSketchDraft({
      lessonId: 2,
      reference,
      draft: "void setup() {}" + String.fromCharCode(0xD800),
    }), /surrogate Unicode/i, "unpaired surrogate");
  });

  check("result-is-deterministic-deeply-frozen-and-source-bounded", () => {
    const reference = sampleReference();
    const draft = reference.replace("HIGH", "LOW");
    const a = inspectSketchDraft({ lessonId: 2, reference, draft });
    const b = inspectSketchDraft({ lessonId: 2, reference, draft });
    assert(JSON.stringify(a) === JSON.stringify(b), "same input must be deterministic");
    assert(Object.isFrozen(a) && Object.isFrozen(a.changes) && Object.isFrozen(a.changes.hunks),
      "change tree must be frozen");
    assert(Object.isFrozen(a.structure) && Object.isFrozen(a.warnings) && Object.isFrozen(a.claims),
      "result tree must be frozen");
    assert(Object.isFrozen(a.lexical) && Object.isFrozen(a.lexical.findings) &&
      a.lexical.findings.every(Object.isFrozen), "lexical tree must be frozen");
    assert(!JSON.stringify(a).includes(draft), "result must not echo full draft source");
  });

  check("provenance-never-infers-simulation-or-firmware-effects", () => {
    const result = inspectSketchDraft({
      lessonId: 16,
      reference: lessons[15].sketch,
      draft: lessons[15].sketch.replace("delay(100);", "delay(200);"),
    });
    assert(result.provenance.reference === "lesson-reference", "reference provenance");
    assert(result.provenance.draft === "editor-draft", "draft provenance");
    assert(result.provenance.comparison === "local-line-diff-and-source-heuristics",
      "comparison provenance");
    assert(result.provenance.lexical === "masked-reference-pattern-scan", "lexical provenance");
    assert(
      result.claims.compiled === false &&
      result.claims.semanticValidated === false &&
      result.claims.firmwareExecuted === false &&
      result.claims.simulationBehaviorValidated === false &&
      result.claims.learnerCompletion === false,
      "forbidden inference boundary",
    );
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
