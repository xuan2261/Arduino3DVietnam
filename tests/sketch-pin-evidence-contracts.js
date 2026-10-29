import {
  SKETCH_PIN_EVIDENCE_BOUNDARIES,
  SKETCH_PIN_EVIDENCE_LIMITS,
  inspectSketchPinEvidence,
} from "../src/sketch-pin-evidence.js";

function assert(condition, message) {
  if (!condition) throw new Error("sketch-pin-evidence contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function inspect(lessonId, source) {
  return inspectSketchPinEvidence({ lessonId, source });
}

export function runSketchPinEvidenceContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("bounded-static-contract-does-not-claim-compile-execution-or-electrical-proof", () => {
    assert(SKETCH_PIN_EVIDENCE_LIMITS.maxSourceChars === 12000, "source char bound");
    assert(SKETCH_PIN_EVIDENCE_LIMITS.maxCalls === 96, "call bound");
    assert(SKETCH_PIN_EVIDENCE_BOUNDARIES.lexicalOnly === true, "lexical boundary");
    for (const key of [
      "expandsAliasesOrMacros",
      "compilesCpp",
      "validatesArduinoSemantics",
      "executesFirmware",
      "provesCallExecuted",
      "validatesPinConnection",
      "validatesCircuit",
      "provesLearnerCompletion",
      "provesLearnerMastery",
    ]) {
      assert(SKETCH_PIN_EVIDENCE_BOUNDARIES[key] === false, key + " must remain false");
    }
  });

  check("direct-digital-literal-maps-only-through-active-lesson-terminal", () => {
    const result = inspect(2, [
      "void setup() { pinMode(13, OUTPUT); }",
      "void loop() { digitalWrite(13, HIGH); tone(12, 440); }",
    ].join("\n"));
    assert(result.calls.length === 3, "three lexical calls");
    assert(result.calls[0].lessonTerminalId === "D13", "pinMode D13");
    assert(result.calls[1].lessonTerminalId === "D13", "digitalWrite D13");
    assert(result.calls[2].literalPin === "D12" && result.calls[2].status === "not-in-lesson",
      "D12 must not be promoted into lesson 2");
    assert(result.summary.lessonTerminalCallCount === 2, "two routed calls");
    assert(result.summary.notInLessonCallCount === 1, "one outside lesson");
  });

  check("analog-token-and-channel-number-use-canonical-router-ids", () => {
    const result = inspect(16, [
      "int a = analogRead(A0);",
      "int b = analogRead(1);",
      "bool c = digitalRead(2);",
      "digitalWrite(13, HIGH);",
      "tone(8, 880);",
    ].join("\n"));
    assert(result.calls.map(call => call.lessonTerminalId).join(",") === "A0,A1,D2,D13,D8",
      "canonical A0/A1/D2/D13/D8 mapping");
    assert(result.calls[0].literalKind === "analog-token", "A0 token kind");
    assert(result.calls[1].literalKind === "analog-channel-number", "analogRead channel kind");
    assert(result.summary.uniqueLessonTerminalCount === 5, "five unique routed terminals");
  });

  check("aliases-macros-and-function-results-remain-unknown", () => {
    const result = inspect(16, [
      "pinMode(LED_BUILTIN, OUTPUT);",
      "digitalRead(BUTTON);",
      "digitalWrite(LED, HIGH);",
      "analogRead(POT);",
      "analogWrite(PWM_PIN, 128);",
      "tone(pinForBuzz(), 440);",
    ].join("\n"));
    assert(result.calls.length === 6, "six lexical calls");
    assert(result.calls.every(call => call.status === "unknown"), "all aliases unresolved");
    assert(result.calls.every(call => call.lessonTerminalId === null), "no fabricated router ID");
    assert(result.summary.unknownCallCount === 6, "unknown count");
  });

  check("comments-strings-and-phase2-splice-created-comments-are-masked", () => {
    const result = inspect(2, [
      "// digitalWrite(13, HIGH);",
      "/* pinMode(13, OUTPUT); tone(13, 440); */",
      "const char *a = \"digitalRead(13)\";",
      "const char c = 'x'; // analogWrite(13, 20)",
      "const char *r = R\"TAG(digitalWrite(13, LOW); analogRead(0);)TAG\";",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(result.calls.length === 1, "spoofed source tokens must be ignored");
    assert(result.calls[0].api === "digitalWrite" && result.calls[0].line === 6,
      "real call line retained");

    const splitLineComment = inspect(2, [
      "/" + "\\",
      "/ digitalWrite(13, HIGH); // tiếng Việt Ω 🔌",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(splitLineComment.calls.length === 1,
      "phase2 splice creating // must hide the apparent call");
    assert(splitLineComment.calls[0].line === 3 &&
      splitLineComment.calls[0].lessonTerminalId === "D13",
      "post-comment call keeps its physical source line");

    const splitBlockComment = inspect(2, [
      "/" + "\\",
      "* digitalWrite(13, HIGH); */",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(splitBlockComment.calls.length === 1,
      "phase2 splice creating /* must hide the apparent call");
    assert(splitBlockComment.calls[0].line === 3 &&
      splitBlockComment.calls[0].lessonTerminalId === "D13",
      "post-block-comment call keeps physical line mapping");
  });

  check("backslash-continued-line-comment-cannot-spoof-a-pin-call", () => {
    const result = inspect(2, [
      "// comment continues " + "\\",
      "digitalWrite(12, HIGH);",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(result.calls.length === 1, "continued comment must hide following physical line");
    assert(result.calls[0].line === 3 && result.calls[0].lessonTerminalId === "D13",
      "only post-comment call remains");
  });

  check("multiline-direct-arguments-and-comments-inside-call-are-recognized", () => {
    const result = inspect(16, [
      "digitalWrite(",
      "  /* direct literal */ 13,",
      "  HIGH",
      ");",
      "int x = analogRead(",
      "  A0",
      ");",
    ].join("\n"));
    assert(result.calls.length === 2, "two multiline calls");
    assert(result.calls[0].line === 1 && result.calls[0].column === 1, "first call position");
    assert(result.calls[0].lessonTerminalId === "D13", "multiline D13");
    assert(result.calls[1].line === 5 && result.calls[1].lessonTerminalId === "A0", "multiline A0");
  });

  check("qualified-member-or-namespace-spellings-are-not-treated-as-direct-calls", () => {
    const result = inspect(2, [
      "obj.digitalWrite(13, HIGH);",
      "ptr->digitalWrite(13, HIGH);",
      "ns::digitalWrite(13, HIGH);",
      "ΩdigitalWrite(13, HIGH);",
      "漢digitalWrite(13, HIGH);",
      "𐐀digitalWrite(13, HIGH);",
      "$digitalWrite(13, HIGH);",
      "_digitalWrite(13, HIGH);",
      "Ω" + "\\",
      "digitalWrite(13, HIGH);",
      "obj" + "\\",
      ".digitalWrite(13, HIGH);",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(result.calls.length === 1, "only bare direct call tracked");
    assert(result.calls[0].line === 13, "bare call line");
  });

  check("qualified-call-detection-covers-long-gaps-and-phase2-splices", () => {
    const longGap = " ".repeat(96);
    const longComment = "/*" + "masked qualifier gap ".repeat(8) + "*/";
    const result = inspect(2, [
      "obj." + longGap + "digitalWrite(13, HIGH);",
      "ptr->" + longComment,
      "  digitalWrite(13, HIGH);",
      "ns::",
      longComment,
      longGap + "digitalWrite(13, HIGH);",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(result.calls.length === 1,
      "qualified calls must stay excluded even when qualifier is more than 32 chars away");
    assert(result.calls[0].line === 7 && result.calls[0].lessonTerminalId === "D13",
      "only genuinely bare direct call may produce pin evidence");

    const spliced = inspect(2, [
      "obj." + "\\",
      "digitalWrite(13, HIGH);",
      "ptr-" + "\\",
      "> digitalWrite(13, HIGH);",
      "ns:" + "\\",
      ": digitalWrite(13, HIGH);",
      "digital" + "\\",
      "Write(13, HIGH); // chân trực tiếp sau phase2",
      "digitalWrite(13, HIGH);",
    ].join("\n"));
    assert(spliced.calls.length === 2,
      "spliced member/namespace qualifiers must not become fake bare calls");
    assert(spliced.calls.every(call => call.lessonTerminalId === "D13"),
      "only direct D13 calls remain after phase2 splicing");
    assert(spliced.calls[0].line === 7 && spliced.calls[1].line === 9,
      "split API and ordinary API report their exact physical start lines");
  });

  check("duplicate-occurrences-are-preserved-and-counted-without-object-key-lookups", () => {
    const result = inspect(2, [
      "digitalWrite(13, HIGH);",
      "digitalWrite(13, LOW);",
      "digitalWrite(13, HIGH);",
      "digitalRead(constructor);",
      "digitalRead(constructor);",
    ].join("\n"));
    assert(result.calls.length === 5, "duplicates must remain observable");
    assert(result.summary.duplicateCallCount === 3, "two D13 repeats plus one constructor repeat");
    assert(result.calls[3].status === "unknown" && result.calls[4].status === "unknown",
      "prototype name remains unknown");
  });

  check("prototype-like-identifiers-never-become-terminal-ids", () => {
    const result = inspect(16, [
      "digitalRead(constructor);",
      "digitalRead(toString);",
      "digitalRead(__proto__);",
    ].join("\n"));
    assert(result.calls.every(call => call.status === "unknown"), "prototype identifiers unresolved");
    assert(result.calls.every(call => call.literalPin === null), "no prototype-derived pin");
  });

  check("router-terminal-list-exposes-only-canonical-arduino-pin-ids", () => {
    const result = inspect(16, "digitalWrite(13, HIGH);");
    assert(result.lessonTerminalIds.includes("D13"), "D13 included");
    assert(result.lessonTerminalIds.includes("A0"), "A0 included");
    assert(result.lessonTerminalIds.includes("A1"), "A1 included");
    assert(!result.lessonTerminalIds.some(id => id.includes(":")), "component terminals excluded");
    assert(result.provenance.terminalIds === "circuit-router:listTerminals", "router provenance");
  });

  check("unsupported-lesson-router-does-not-invent-a-terminal-set", () => {
    const result = inspect(1, "digitalWrite(13, HIGH);");
    assert(result.lessonTerminalIds.length === 0, "lesson 1 has no circuit-router terminal set");
    assert(result.calls[0].literalPin === "D13", "literal can still be identified");
    assert(result.calls[0].status === "not-in-lesson" && result.calls[0].lessonTerminalId === null,
      "literal is not promoted into unsupported lesson");
  });

  check("empty-source-is-a-valid-zero-evidence-result", () => {
    const result = inspect(2, "");
    assert(result.calls.length === 0 && result.summary.callCount === 0, "zero calls");
    assert(result.source.lineCount === 0 && result.source.charCount === 0, "zero source size");
  });

  check("unsupported-or-noncanonical-numeric-literals-remain-unknown", () => {
    const result = inspect(16, [
      "analogRead(6);",
      "digitalWrite(14, HIGH);",
      "digitalWrite(013, HIGH);",
      "tone(999, 440);",
    ].join("\n"));
    assert(result.calls.every(call => call.status === "unknown"), "unsupported literals unresolved");
    assert(result.calls.every(call => call.reason === "literal-outside-supported-uno-range" ||
      call.reason === "non-literal-pin-expression"), "bounded literal reasons");
  });

  check("unterminated-call-never-upgrades-a-literal-to-terminal-evidence", () => {
    const result = inspect(2, "digitalWrite(13");
    assert(result.calls.length === 1, "lexical call token retained");
    assert(result.calls[0].status === "unknown", "unterminated call unknown");
    assert(result.calls[0].reason === "unterminated-call", "unterminated reason");
  });

  check("unterminated-comment-string-and-raw-string-mask-the-rest-of-source", () => {
    const block = inspect(2, "/* digitalWrite(13, HIGH);");
    assert(block.calls.length === 0 && block.source.unterminatedBlockComment === true,
      "unterminated block comment");

    const string = inspect(2, "const char *s = \"digitalWrite(13, HIGH);");
    assert(string.calls.length === 0 && string.source.unterminatedStringLiteral === true,
      "unterminated string");

    const raw = inspect(2, "const char *s = R\"X(digitalWrite(13, HIGH);");
    assert(raw.calls.length === 0 && raw.source.unterminatedRawStringLiteral === true,
      "unterminated raw string");
  });

  check("valid-unicode-is-accepted-but-bidi-controls-and-unpaired-surrogates-fail", () => {
    const valid = inspect(2, "int chân = 13; digitalWrite(chân, HIGH);");
    assert(valid.calls[0].status === "unknown", "valid Unicode alias remains unknown");
    expectThrow(() => inspect(2, "digitalWrite(13, HIGH);\u202E"), /điều khiển/i, "bidi control");
    expectThrow(() => inspect(2, "digitalWrite(13, HIGH);\uD800"), /surrogate/i, "unpaired surrogate");
  });

  check("source-size-line-count-and-line-length-limits-fail-closed", () => {
    expectThrow(
      () => inspect(2, "x".repeat(SKETCH_PIN_EVIDENCE_LIMITS.maxSourceChars + 1)),
      /giới hạn.*ký tự/i,
      "source char bound",
    );
    expectThrow(
      () => inspect(2, Array.from({ length: SKETCH_PIN_EVIDENCE_LIMITS.maxSourceLines + 1 }, () => "x").join("\n")),
      /giới hạn.*dòng/i,
      "source line bound",
    );
    expectThrow(
      () => inspect(2, "x".repeat(SKETCH_PIN_EVIDENCE_LIMITS.maxLineChars + 1)),
      /dòng 1.*giới hạn/i,
      "line char bound",
    );
  });

  check("call-count-limit-fails-closed-instead-of-returning-partial-evidence", () => {
    const source = Array.from(
      { length: SKETCH_PIN_EVIDENCE_LIMITS.maxCalls + 1 },
      () => "digitalWrite(13,HIGH);",
    ).join("\n");
    expectThrow(() => inspect(2, source), /giới hạn.*lời gọi pin lexical/i, "call count bound");
  });

  check("input-shape-lesson-range-and-extra-fields-fail-closed", () => {
    expectThrow(() => inspectSketchPinEvidence(null), /object/i, "null input");
    expectThrow(() => inspectSketchPinEvidence({ lessonId: 0, source: "" }), /1\.\.16/i, "lesson low");
    expectThrow(() => inspectSketchPinEvidence({ lessonId: 17, source: "" }), /1\.\.16/i, "lesson high");
    expectThrow(() => inspectSketchPinEvidence({ lessonId: 2, source: 13 }), /source.*chuỗi/i, "source type");
    expectThrow(
      () => inspectSketchPinEvidence({ lessonId: 2, source: "", terminalIds: ["D13"] }),
      /field không được hỗ trợ/i,
      "caller cannot inject terminal IDs",
    );
    const withSymbol = { lessonId: 2, source: "" };
    withSymbol[Symbol("hidden")] = true;
    expectThrow(() => inspectSketchPinEvidence(withSymbol), /field không được hỗ trợ/i, "symbol field");
  });

  check("own-prototype-named-input-fields-are-rejected", () => {
    const withConstructor = { lessonId: 2, source: "", constructor: "D13" };
    expectThrow(() => inspectSketchPinEvidence(withConstructor), /field không được hỗ trợ/i, "constructor field");

    const withProto = { lessonId: 2, source: "" };
    Object.defineProperty(withProto, "__proto__", { value: "D13", enumerable: true });
    expectThrow(() => inspectSketchPinEvidence(withProto), /field không được hỗ trợ/i, "__proto__ field");
  });

  check("returned-evidence-is-deep-frozen", () => {
    const result = inspect(16, "digitalWrite(13, HIGH); analogRead(A0);");
    assert(Object.isFrozen(result), "root frozen");
    assert(Object.isFrozen(result.calls), "calls frozen");
    assert(Object.isFrozen(result.calls[0]), "call frozen");
    assert(Object.isFrozen(result.summary), "summary frozen");
    assert(Object.isFrozen(result.lessonTerminalIds), "terminal IDs frozen");
    assert(Object.isFrozen(result.matchedTerminalIds), "matched terminal IDs frozen");
    assert(Object.isFrozen(result.claims), "claims frozen");
    assert(Object.isFrozen(result.provenance), "provenance frozen");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
  });
}
