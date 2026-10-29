/**
 * Bounded, local review of an editable Arduino sketch against the lesson sample.
 *
 * This module performs text comparison and small source heuristics only. It does
 * not compile C++, validate Arduino semantics, execute firmware, inspect hardware,
 * or infer whether the edited sketch affects any simulator behavior.
 */

export const SKETCH_REVIEW_LIMITS = Object.freeze({
  maxSourceChars: 12000,
  maxSourceLines: 600,
  maxLineChars: 2000,
  maxHunks: 32,
  maxLexicalFeatures: 24,
});

export const SKETCH_REVIEW_BOUNDARIES = Object.freeze({
  localTextComparison: true,
  heuristicOnly: true,
  compilesCpp: false,
  validatesArduinoSemantics: false,
  executesFirmware: false,
  validatesSimulationBehavior: false,
  validatesHardware: false,
  provesLearnerCompletion: false,
  provesLearnerMastery: false,
});

const ALLOWED_INPUT_FIELDS = new Set(["lessonId", "reference", "draft"]);
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/;
const LEXICAL_FEATURES = Object.freeze([
  Object.freeze({ id:"include-servo", label:"#include <Servo.h>", pattern:/#\s*include\s*<\s*Servo\.h\s*>/g, hint:"Nếu vẫn dùng đối tượng Servo, đối chiếu phần include của mã tham khảo." }),
  Object.freeze({ id:"pin-mode", label:"pinMode(...)", pattern:/\bpinMode\s*\(/g, hint:"Đối chiếu cấu hình INPUT/OUTPUT trong setup() với chân mà bản nháp đang dùng." }),
  Object.freeze({ id:"digital-write", label:"digitalWrite(...)", pattern:/\bdigitalWrite\s*\(/g, hint:"Đối chiếu các lần đặt HIGH/LOW với mục tiêu của bài và chân đích." }),
  Object.freeze({ id:"digital-read", label:"digitalRead(...)", pattern:/\bdigitalRead\s*\(/g, hint:"Đối chiếu chân đọc digital và điều kiện HIGH/LOW với mã tham khảo." }),
  Object.freeze({ id:"analog-read", label:"analogRead(...)", pattern:/\banalogRead\s*\(/g, hint:"Đối chiếu kênh analog và cách bản nháp dùng giá trị ADC." }),
  Object.freeze({ id:"analog-write", label:"analogWrite(...)", pattern:/\banalogWrite\s*\(/g, hint:"Đối chiếu chân PWM và giá trị duty/PWM với mã tham khảo." }),
  Object.freeze({ id:"tone", label:"tone(...)", pattern:/\btone\s*\(/g, hint:"Đối chiếu chân buzzer và tần số được truyền vào tone()." }),
  Object.freeze({ id:"no-tone", label:"noTone(...)", pattern:/\bnoTone\s*\(/g, hint:"Đối chiếu nhánh dừng âm với điều kiện của bài." }),
  Object.freeze({ id:"delay", label:"delay(...)", pattern:/\bdelay\s*\(/g, hint:"Đối chiếu thời gian chờ với nhịp hoặc chu kỳ mà bài đang minh họa." }),
  Object.freeze({ id:"delay-microseconds", label:"delayMicroseconds(...)", pattern:/\bdelayMicroseconds\s*\(/g, hint:"Đối chiếu độ rộng xung/thời gian microsecond với mã tham khảo." }),
  Object.freeze({ id:"pulse-in", label:"pulseIn(...)", pattern:/\bpulseIn\s*\(/g, hint:"Đối chiếu chân, mức logic và timeout của phép đo xung trong mã tham khảo." }),
  Object.freeze({ id:"map", label:"map(...)", pattern:/\bmap\s*\(/g, hint:"Đối chiếu miền đầu vào/đầu ra của phép ánh xạ với dữ liệu bài học." }),
  Object.freeze({ id:"serial-begin", label:"Serial.begin(...)", pattern:/\bSerial\s*\.\s*begin\s*\(/g, hint:"Đối chiếu cấu hình Serial trong mã tham khảo nếu bản nháp vẫn in dữ liệu." }),
  Object.freeze({ id:"serial-println", label:"Serial.println(...)", pattern:/\bSerial\s*\.\s*println\s*\(/g, hint:"Đối chiếu giá trị được in với biến hoặc trạng thái mà bài muốn quan sát." }),
  Object.freeze({ id:"object-attach", label:"*.attach(...)", pattern:/\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*attach\s*\(/g, hint:"Đối chiếu đối tượng và chân attach với mã tham khảo." }),
  Object.freeze({ id:"object-write", label:"*.write(...)", pattern:/\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*write\s*\(/g, hint:"Đối chiếu giá trị write() với đối tượng mà bài đang điều khiển." }),
  Object.freeze({ id:"for-loop", label:"for (...)", pattern:/\bfor\s*\(/g, hint:"Đối chiếu biến đếm, điều kiện dừng và bước tăng với vòng lặp trong mã tham khảo." }),
  Object.freeze({ id:"if-condition", label:"if (...)", pattern:/\bif\s*\(/g, hint:"Đối chiếu điều kiện rẽ nhánh với ngưỡng hoặc trạng thái của bài." }),
  Object.freeze({ id:"input-pullup", label:"INPUT_PULLUP", pattern:/\bINPUT_PULLUP\b/g, hint:"Nếu vẫn dùng pull-up nội, đối chiếu lại logic nhấn/thả HIGH/LOW." }),
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("inspectSketchDraft cần object { lessonId, reference, draft }.");
  }
  const unknown = Reflect.ownKeys(input).filter(key =>
    typeof key !== "string" || !ALLOWED_INPUT_FIELDS.has(key));
  if (unknown.length) {
    throw new TypeError("inspectSketchDraft có field không được hỗ trợ: " + String(unknown[0]));
  }
  if (!Number.isInteger(input.lessonId) || input.lessonId < 1 || input.lessonId > 16) {
    throw new RangeError("lessonId phải là số nguyên trong phạm vi 1..16.");
  }
}

function validateUnicode(text, name) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        throw new RangeError(name + " chứa surrogate Unicode không hoàn chỉnh.");
      }
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new RangeError(name + " chứa surrogate Unicode không hoàn chỉnh.");
    }
  }
}

function sourceLines(text) {
  return text === "" ? [] : text.split("\n");
}

function normalizeSource(value, name, { allowEmpty }) {
  if (typeof value !== "string") {
    throw new TypeError(name + " phải là chuỗi.");
  }
  if (value.length > SKETCH_REVIEW_LIMITS.maxSourceChars) {
    throw new RangeError(
      name + " vượt giới hạn " + SKETCH_REVIEW_LIMITS.maxSourceChars + " ký tự.",
    );
  }
  validateUnicode(value, name);
  if (DISALLOWED_CONTROL.test(value) || BIDI_CONTROL.test(value)) {
    throw new RangeError(name + " chứa ký tự điều khiển không được hỗ trợ.");
  }

  const text = value.replace(/\r\n?/g, "\n");
  if (!allowEmpty && !text.trim()) {
    throw new TypeError(name + " không được rỗng.");
  }
  const lines = sourceLines(text);
  if (lines.length > SKETCH_REVIEW_LIMITS.maxSourceLines) {
    throw new RangeError(
      name + " vượt giới hạn " + SKETCH_REVIEW_LIMITS.maxSourceLines + " dòng.",
    );
  }
  const tooLong = lines.findIndex(line => line.length > SKETCH_REVIEW_LIMITS.maxLineChars);
  if (tooLong >= 0) {
    throw new RangeError(
      name + " có dòng " + (tooLong + 1) + " vượt giới hạn " +
      SKETCH_REVIEW_LIMITS.maxLineChars + " ký tự.",
    );
  }
  return { text, lines };
}

function buildLineOperations(referenceLines, draftLines) {
  const n = referenceLines.length;
  const m = draftLines.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = referenceLines[i] === draftLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && referenceLines[i] === draftLines[j]) {
      operations.push("equal");
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      operations.push("remove");
      i += 1;
    } else {
      operations.push("add");
      j += 1;
    }
  }
  return operations;
}

function summarizeLineChanges(referenceLines, draftLines) {
  const operations = buildLineOperations(referenceLines, draftLines);
  let referenceCursor = 1;
  let draftCursor = 1;
  let unchangedLines = 0;
  let modifiedLines = 0;
  let addedLines = 0;
  let removedLines = 0;
  let totalHunks = 0;
  const hunks = [];

  for (let index = 0; index < operations.length;) {
    if (operations[index] === "equal") {
      unchangedLines += 1;
      referenceCursor += 1;
      draftCursor += 1;
      index += 1;
      continue;
    }

    const referenceStart = referenceCursor;
    const draftStart = draftCursor;
    let removed = 0;
    let added = 0;
    while (index < operations.length && operations[index] !== "equal") {
      if (operations[index] === "remove") {
        removed += 1;
        referenceCursor += 1;
      } else {
        added += 1;
        draftCursor += 1;
      }
      index += 1;
    }

    const modified = Math.min(removed, added);
    const pureRemoved = removed - modified;
    const pureAdded = added - modified;
    modifiedLines += modified;
    removedLines += pureRemoved;
    addedLines += pureAdded;
    totalHunks += 1;

    if (hunks.length < SKETCH_REVIEW_LIMITS.maxHunks) {
      hunks.push(Object.freeze({
        referenceStartLine: removed ? referenceStart : null,
        referenceEndLine: removed ? referenceStart + removed - 1 : null,
        draftStartLine: added ? draftStart : null,
        draftEndLine: added ? draftStart + added - 1 : null,
        modifiedLines: modified,
        addedLines: pureAdded,
        removedLines: pureRemoved,
      }));
    }
  }

  return Object.freeze({
    referenceLines: referenceLines.length,
    draftLines: draftLines.length,
    unchangedLines,
    modifiedLines,
    addedLines,
    removedLines,
    changedLines: modifiedLines + addedLines + removedLines,
    totalHunks,
    hunks: Object.freeze(hunks),
    hunksTruncated: Math.max(0, totalHunks - hunks.length),
  });
}

function maskCommentsAndStrings(text) {
  const output = text.split("");
  let state = "code";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === "code") {
      if (char === "/" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        state = "line-comment";
        index += 1;
      } else if (char === "/" && next === "*") {
        output[index] = " ";
        output[index + 1] = " ";
        state = "block-comment";
        index += 1;
      } else if (char === '"' || char === "'") {
        output[index] = " ";
        quote = char;
        escaped = false;
        state = "string";
      }
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") state = "code";
      else output[index] = " ";
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        state = "code";
        index += 1;
      } else if (char !== "\n") {
        output[index] = " ";
      }
      continue;
    }

    if (char === "\n") {
      escaped = false;
      continue;
    }
    output[index] = " ";
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      quote = "";
      state = "code";
    }
  }

  return Object.freeze({
    text: output.join(""),
    unterminatedBlockComment: state === "block-comment",
    unterminatedStringLiteral: state === "string",
  });
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") line += 1;
  }
  return line;
}

function matchesFor(text, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const regex = new RegExp(pattern.source, flags);
  const matches = [];
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    matches.push(Object.freeze({
      line: lineNumberAt(text, match.index),
      index: match.index,
    }));
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return Object.freeze(matches);
}

function scanDelimiter(masked, open, close) {
  const stack = [];
  const extraClosingLines = [];
  let extraClosingCount = 0;
  let line = 1;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "\n") {
      line += 1;
    } else if (char === open) {
      stack.push(line);
    } else if (char === close) {
      if (stack.length) stack.pop();
      else {
        extraClosingCount += 1;
        if (extraClosingLines.length < 8) extraClosingLines.push(line);
      }
    }
  }
  return Object.freeze({
    balanced: stack.length === 0 && extraClosingCount === 0,
    unclosedOpeningLines: Object.freeze(stack.slice(0, 8)),
    extraClosingLines: Object.freeze(extraClosingLines),
    unclosedOpeningCount: stack.length,
    extraClosingCount,
  });
}

function matchingBrace(masked, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < masked.length; index += 1) {
    if (masked[index] === "{") depth += 1;
    else if (masked[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function locateFunction(masked, source, name) {
  const pattern = new RegExp("\\bvoid\\s+" + name + "\\s*\\(\\s*(?:void\\s*)?\\)\\s*\\{", "g");
  const match = pattern.exec(masked);
  if (!match) return null;
  const openIndex = masked.indexOf("{", match.index);
  const closeIndex = matchingBrace(masked, openIndex);
  const endIndex = closeIndex === null ? source.length : closeIndex + 1;
  return Object.freeze({
    name,
    startIndex: match.index,
    openIndex,
    closeIndex,
    startLine: lineNumberAt(masked, match.index),
    endLine: closeIndex === null ? null : lineNumberAt(masked, closeIndex),
    canonical: source
      .slice(match.index, endIndex)
      .replace(/\s+/g, " ")
      .trim(),
  });
}

function scanBraces(masked) {
  return scanDelimiter(masked, "{", "}");
}

function analyzeStructure(text) {
  const masked = maskCommentsAndStrings(text);
  const setup = locateFunction(masked.text, text, "setup");
  const loop = locateFunction(masked.text, text, "loop");
  return Object.freeze({
    masked: masked.text,
    setup,
    loop,
    braces: scanBraces(masked.text),
    parentheses: scanDelimiter(masked.text, "(", ")"),
    brackets: scanDelimiter(masked.text, "[", "]"),
    hasSetupToken: /\bsetup\s*\(/.test(masked.text),
    hasLoopToken: /\bloop\s*\(/.test(masked.text),
    setupTokenLine: matchesFor(masked.text, /\bsetup\s*\(/g)[0]?.line ?? null,
    loopTokenLine: matchesFor(masked.text, /\bloop\s*\(/g)[0]?.line ?? null,
    unterminatedBlockComment: masked.unterminatedBlockComment,
    unterminatedStringLiteral: masked.unterminatedStringLiteral,
  });
}

function warning(code, message, line = null) {
  return Object.freeze({ code, severity: "warning", message, line });
}

function buildWarnings(draftText, structure) {
  const warnings = [];
  if (!draftText.trim()) {
    warnings.push(warning(
      "DRAFT_EMPTY",
      "Bản nháp đang trống; hãy khôi phục mã tham khảo hoặc viết lại setup()/loop() trước khi mang mã sang công cụ Arduino.",
    ));
  }

  if (!structure.setup) {
    warnings.push(warning(
      structure.hasSetupToken ? "SETUP_NOT_RECOGNIZED" : "SETUP_MISSING",
      structure.hasSetupToken
        ? "Có chữ setup(...), nhưng bộ review không nhận ra dạng hàm chuẩn `void setup() { ... }`."
        : "Không thấy hàm `void setup() { ... }` trong bản nháp.",
    ));
  }
  if (!structure.loop) {
    warnings.push(warning(
      structure.hasLoopToken ? "LOOP_NOT_RECOGNIZED" : "LOOP_MISSING",
      structure.hasLoopToken
        ? "Có chữ loop(...), nhưng bộ review không nhận ra dạng hàm chuẩn `void loop() { ... }`."
        : "Không thấy hàm `void loop() { ... }` trong bản nháp.",
    ));
  }

  if (structure.braces.extraClosingCount) {
    warnings.push(warning(
      "BRACE_EXTRA_CLOSE",
      "Có ngoặc `}` không có ngoặc `{` tương ứng theo phép quét văn bản.",
      structure.braces.extraClosingLines[0] ?? null,
    ));
  }
  if (structure.braces.unclosedOpeningCount) {
    warnings.push(warning(
      "BRACE_UNCLOSED_OPEN",
      "Có ngoặc `{` chưa thấy ngoặc `}` đóng tương ứng theo phép quét văn bản.",
      structure.braces.unclosedOpeningLines[0] ?? null,
    ));
  }
  if (structure.parentheses.extraClosingCount) {
    warnings.push(warning(
      "PAREN_EXTRA_CLOSE",
      "Có ngoặc đóng tròn không có ngoặc mở tương ứng theo phép quét lexical.",
      structure.parentheses.extraClosingLines[0] ?? null,
    ));
  }
  if (structure.parentheses.unclosedOpeningCount) {
    warnings.push(warning(
      "PAREN_UNCLOSED_OPEN",
      "Có ngoặc mở tròn chưa thấy ngoặc đóng tương ứng theo phép quét lexical.",
      structure.parentheses.unclosedOpeningLines[0] ?? null,
    ));
  }
  if (structure.brackets.extraClosingCount) {
    warnings.push(warning(
      "BRACKET_EXTRA_CLOSE",
      "Có ngoặc đóng vuông không có ngoặc mở tương ứng theo phép quét lexical.",
      structure.brackets.extraClosingLines[0] ?? null,
    ));
  }
  if (structure.brackets.unclosedOpeningCount) {
    warnings.push(warning(
      "BRACKET_UNCLOSED_OPEN",
      "Có ngoặc mở vuông chưa thấy ngoặc đóng tương ứng theo phép quét lexical.",
      structure.brackets.unclosedOpeningLines[0] ?? null,
    ));
  }
  if (structure.unterminatedBlockComment) {
    warnings.push(warning(
      "BLOCK_COMMENT_UNCLOSED",
      "Comment khối `/* ... */` có vẻ chưa được đóng.",
    ));
  }
  if (structure.unterminatedStringLiteral) {
    warnings.push(warning(
      "STRING_LITERAL_UNCLOSED",
      "Chuỗi hoặc ký tự có vẻ chưa được đóng; đây chỉ là cảnh báo heuristic.",
    ));
  }
  return Object.freeze(warnings);
}

function buildLexicalFeedback(referenceStructure, draftStructure) {
  const findings = [];
  for (const definition of LEXICAL_FEATURES) {
    if (findings.length >= SKETCH_REVIEW_LIMITS.maxLexicalFeatures) break;
    const referenceMatches = matchesFor(referenceStructure.masked, definition.pattern);
    if (!referenceMatches.length) continue;
    const draftMatches = matchesFor(draftStructure.masked, definition.pattern);
    let status = "present";
    if (!draftMatches.length) status = "absent";
    else if (draftMatches.length < referenceMatches.length) status = "fewer-than-reference";
    findings.push(Object.freeze({
      id: definition.id,
      label: definition.label,
      status,
      referenceCount: referenceMatches.length,
      draftCount: draftMatches.length,
      referenceLine: referenceMatches[0]?.line ?? null,
      draftLine: draftMatches[0]?.line ?? null,
      hint: definition.hint,
    }));
  }
  const differenceCount = findings.filter(item => item.status !== "present").length;
  return Object.freeze({
    mode: "masked-reference-pattern-scan",
    commentsAndStringsIgnored: true,
    expectedFeatureCount: findings.length,
    presentFeatureCount: findings.length - differenceCount,
    differenceCount,
    findings: Object.freeze(findings),
  });
}

function functionChanged(referenceFunction, draftFunction) {
  if (!referenceFunction && !draftFunction) return false;
  if (!referenceFunction || !draftFunction) return true;
  return referenceFunction.canonical !== draftFunction.canonical;
}

function buildGuidance(changes, referenceStructure, draftStructure, warnings) {
  const guidance = [];
  if (changes.changedLines === 0) {
    guidance.push("Bản nháp trùng mã tham khảo theo nội dung dòng sau khi chuẩn hóa kiểu xuống dòng.");
  } else {
    guidance.push(
      "Đối chiếu dòng: sửa " + changes.modifiedLines +
      ", thêm " + changes.addedLines +
      ", xóa " + changes.removedLines + ".",
    );
  }

  if (functionChanged(referenceStructure.setup, draftStructure.setup)) {
    guidance.push(
      "Vùng `setup()` khác mã tham khảo; kiểm tra lại các cấu hình chạy một lần như pinMode(), Serial.begin() hoặc attach() nếu bài có dùng.",
    );
  }
  if (functionChanged(referenceStructure.loop, draftStructure.loop)) {
    guidance.push(
      "Vùng `loop()` khác mã tham khảo; kiểm tra lại logic lặp, điều kiện và thời gian chờ mà bạn chủ ý thay đổi.",
    );
  }
  if (warnings.some(item => item.code.startsWith("BRACE_"))) {
    guidance.push("Cân bằng ngoặc nhọn trước khi đưa mã sang một công cụ biên dịch Arduino thật để kiểm tra tiếp.");
  }
  if (warnings.some(item => item.code.startsWith("PAREN_") || item.code.startsWith("BRACKET_"))) {
    guidance.push("Đối chiếu cặp ngoặc tròn/vuông ở dòng được cảnh báo; đây là kiểm tra lexical, không phải parser C++.");
  }
  if (warnings.some(item => /SETUP|LOOP/.test(item.code))) {
    guidance.push("Arduino sketch thông thường cần cả setup() và loop(); review này chỉ nhận dạng mẫu nguồn phổ biến, không phải parser C++.");
  }
  return Object.freeze(guidance.slice(0, 6));
}

/**
 * Compare the current editor draft with the exact lesson reference sketch.
 *
 * The caller owns lesson data and editor state. This function is deterministic
 * and side-effect free; it never reads the DOM, storage, network, simulator, or
 * AVR runtime.
 */
export function inspectSketchDraft(input) {
  requireInput(input);
  const reference = normalizeSource(input.reference, "reference", { allowEmpty: false });
  const draft = normalizeSource(input.draft, "draft", { allowEmpty: true });
  const changes = summarizeLineChanges(reference.lines, draft.lines);
  const referenceStructure = analyzeStructure(reference.text);
  const draftStructure = analyzeStructure(draft.text);
  const warnings = buildWarnings(draft.text, draftStructure);
  const lexical = buildLexicalFeedback(referenceStructure, draftStructure);
  const setupChanged = functionChanged(referenceStructure.setup, draftStructure.setup);
  const loopChanged = functionChanged(referenceStructure.loop, draftStructure.loop);
  const status = changes.changedLines === 0 ? "reference" : "changed";

  const result = {
    schemaVersion: 1,
    lessonId: input.lessonId,
    status,
    summary: status === "reference"
      ? "Bản nháp đang trùng với mã tham khảo của bài."
      : "Bản nháp khác mã tham khảo ở " + changes.changedLines + " dòng thay đổi đã phân loại.",
    changes,
    structure: {
      setupPresent: Boolean(draftStructure.setup),
      loopPresent: Boolean(draftStructure.loop),
      setupChanged,
      loopChanged,
      bracesBalanced: draftStructure.braces.balanced,
      parenthesesBalanced: draftStructure.parentheses.balanced,
      bracketsBalanced: draftStructure.brackets.balanced,
      unclosedOpeningBraces: draftStructure.braces.unclosedOpeningCount,
      extraClosingBraces: draftStructure.braces.extraClosingCount,
      unclosedOpeningParentheses: draftStructure.parentheses.unclosedOpeningCount,
      extraClosingParentheses: draftStructure.parentheses.extraClosingCount,
      unclosedOpeningBrackets: draftStructure.brackets.unclosedOpeningCount,
      extraClosingBrackets: draftStructure.brackets.extraClosingCount,
    },
    warnings,
    lexical,
    guidance: buildGuidance(changes, referenceStructure, draftStructure, warnings),
    provenance: {
      reference: "lesson-reference",
      draft: "editor-draft",
      comparison: "local-line-diff-and-source-heuristics",
      lexical: "masked-reference-pattern-scan",
    },
    claims: {
      compiled: false,
      semanticValidated: false,
      firmwareExecuted: false,
      simulationBehaviorValidated: false,
      hardwareValidated: false,
      learnerCompletion: false,
      learnerMastery: false,
    },
    boundaries: SKETCH_REVIEW_BOUNDARIES,
  };
  return deepFreeze(result);
}
