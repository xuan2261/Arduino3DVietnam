/**
 * Bounded lexical evidence for pin arguments in a learner-edited Arduino sketch.
 *
 * This module deliberately does not compile C++, expand aliases/macros, execute
 * firmware, or infer electrical connectivity. It only recognizes a small set of
 * direct pin-call spellings after comments and string/character literals are
 * masked, then checks any direct pin token against circuit-router terminals for
 * the active lesson.
 */
import { listTerminals } from "./circuit-router.js";

export const SKETCH_PIN_EVIDENCE_LIMITS = Object.freeze({
  maxSourceChars: 12000,
  maxSourceLines: 600,
  maxLineChars: 2000,
  maxCalls: 96,
  maxArgumentChars: 160,
  maxTerminalIdChars: 80,
});

export const SKETCH_PIN_EVIDENCE_BOUNDARIES = Object.freeze({
  lexicalOnly: true,
  commentsAndStringsIgnored: true,
  directPinTokensOnly: true,
  expandsAliasesOrMacros: false,
  compilesCpp: false,
  validatesArduinoSemantics: false,
  executesFirmware: false,
  provesCallExecuted: false,
  validatesPinConnection: false,
  validatesCircuit: false,
  provesLearnerCompletion: false,
  provesLearnerMastery: false,
});

const ALLOWED_INPUT_FIELDS = new Set(["lessonId", "source"]);
const TARGET_APIS = Object.freeze([
  "pinMode",
  "digitalRead",
  "digitalWrite",
  "analogRead",
  "analogWrite",
  "tone",
]);
const TARGET_API_SET = new Set(TARGET_APIS);
const CALL_PATTERN = /(pinMode|digitalRead|digitalWrite|analogRead|analogWrite|tone)\s*\(/gu;
const CANONICAL_PIN_ID = /^(?:D(?:[0-9]|1[0-3])|A[0-5])$/;
const ANALOG_TOKEN = /^A([0-5])$/;
const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const IDENTIFIER_CONTINUE = /[\p{ID_Continue}$_\u200C\u200D]/u;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BIDI_CONTROL = /[\u202A-\u202E\u2066-\u2069]/;
const RAW_PREFIX = /^(?:u8|u|U|L)?R\"([^ ()\\\t\r\n]{0,16})\(/;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function requireInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("inspectSketchPinEvidence cần object { lessonId, source }.");
  }
  const unknown = Reflect.ownKeys(input).filter(key =>
    typeof key !== "string" || !ALLOWED_INPUT_FIELDS.has(key));
  if (unknown.length) {
    throw new TypeError(
      "inspectSketchPinEvidence có field không được hỗ trợ: " + String(unknown[0]),
    );
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

function normalizeSource(value) {
  if (typeof value !== "string") throw new TypeError("source phải là chuỗi.");
  if (value.length > SKETCH_PIN_EVIDENCE_LIMITS.maxSourceChars) {
    throw new RangeError(
      "source vượt giới hạn " + SKETCH_PIN_EVIDENCE_LIMITS.maxSourceChars + " ký tự.",
    );
  }
  validateUnicode(value, "source");
  if (DISALLOWED_CONTROL.test(value) || BIDI_CONTROL.test(value)) {
    throw new RangeError("source chứa ký tự điều khiển không được hỗ trợ.");
  }

  const text = value.replace(/\r\n?/g, "\n");
  const lines = text === "" ? [] : text.split("\n");
  if (lines.length > SKETCH_PIN_EVIDENCE_LIMITS.maxSourceLines) {
    throw new RangeError(
      "source vượt giới hạn " + SKETCH_PIN_EVIDENCE_LIMITS.maxSourceLines + " dòng.",
    );
  }
  const tooLong = lines.findIndex(line => line.length > SKETCH_PIN_EVIDENCE_LIMITS.maxLineChars);
  if (tooLong >= 0) {
    throw new RangeError(
      "source có dòng " + (tooLong + 1) + " vượt giới hạn " +
      SKETCH_PIN_EVIDENCE_LIMITS.maxLineChars + " ký tự.",
    );
  }
  return Object.freeze({ text, lineCount: lines.length });
}

function maskRange(output, text, start, endExclusive) {
  for (let index = start; index < endExclusive; index += 1) {
    if (text[index] !== "\n") output[index] = " ";
  }
}

function splicePhase2Lines(text) {
  const chars = [];
  const physicalIndexBySplicedIndex = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\" && text[index + 1] === "\n") {
      index += 1;
      continue;
    }
    chars.push(text[index]);
    physicalIndexBySplicedIndex.push(index);
  }
  return Object.freeze({
    text: chars.join(""),
    physicalIndexBySplicedIndex: Object.freeze(physicalIndexBySplicedIndex),
  });
}

function rawStringAt(text, index) {
  const previous = index > 0 ? text[index - 1] : "";
  if (previous && /[A-Za-z0-9_]/.test(previous)) return null;
  const match = RAW_PREFIX.exec(text.slice(index));
  if (!match) return null;
  return Object.freeze({ opener: match[0], delimiter: match[1] });
}

function maskCommentsAndStrings(text) {
  const output = text.split("");
  let state = "code";
  let quote = "";
  let escaped = false;
  let unterminatedRawStringLiteral = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (state === "code") {
      const raw = rawStringAt(text, index);
      if (raw) {
        const contentStart = index + raw.opener.length;
        const closer = ")" + raw.delimiter + "\"";
        const closeIndex = text.indexOf(closer, contentStart);
        if (closeIndex < 0) {
          maskRange(output, text, index, text.length);
          unterminatedRawStringLiteral = true;
          break;
        }
        const endExclusive = closeIndex + closer.length;
        maskRange(output, text, index, endExclusive);
        index = endExclusive - 1;
        continue;
      }

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
        state = "quoted";
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

    if (char !== "\n") output[index] = " ";
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
    unterminatedStringLiteral: state === "quoted",
    unterminatedRawStringLiteral,
  });
}

function lineColumnAt(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return Object.freeze({ line, column: index - lineStart + 1 });
}

function previousCodePoint(text, index) {
  if (index <= 0) return null;
  let start = index - 1;
  const current = text.charCodeAt(start);
  if (current >= 0xDC00 && current <= 0xDFFF && start > 0) {
    const previous = text.charCodeAt(start - 1);
    if (previous >= 0xD800 && previous <= 0xDBFF) start -= 1;
  }
  return text.slice(start, index);
}

function hasIdentifierPrefix(masked, index) {
  const previous = previousCodePoint(masked, index);
  return previous !== null && IDENTIFIER_CONTINUE.test(previous);
}

function previousSignificantToken(masked, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(masked[cursor])) cursor -= 1;
  if (cursor < 0) return null;
  if (masked[cursor] === ".") return ".";
  if (masked[cursor] === ">" && cursor > 0 && masked[cursor - 1] === "-") return "->";
  if (masked[cursor] === ":" && cursor > 0 && masked[cursor - 1] === ":") return "::";
  return masked[cursor];
}

function isQualifiedCall(masked, index) {
  const previous = previousSignificantToken(masked, index);
  return previous === "." || previous === "->" || previous === "::";
}

function firstArgument(masked, openIndex) {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  const start = openIndex + 1;

  for (let index = start; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "(") parentheses += 1;
    else if (char === "[") brackets += 1;
    else if (char === "{") braces += 1;
    else if (char === ")") {
      if (parentheses === 0 && brackets === 0 && braces === 0) {
        return Object.freeze({ start, end: index, terminated: true });
      }
      if (parentheses > 0) parentheses -= 1;
    } else if (char === "]") {
      if (brackets > 0) brackets -= 1;
    } else if (char === "}") {
      if (braces > 0) braces -= 1;
    } else if (char === "," && parentheses === 0 && brackets === 0 && braces === 0) {
      return Object.freeze({ start, end: index, terminated: true });
    }
  }
  return Object.freeze({ start, end: masked.length, terminated: false });
}

function normalizeArgument(maskedArgument) {
  const compact = maskedArgument.trim().replace(/\s+/g, " ");
  if (compact.length > SKETCH_PIN_EVIDENCE_LIMITS.maxArgumentChars) {
    return Object.freeze({ text: compact.slice(0, SKETCH_PIN_EVIDENCE_LIMITS.maxArgumentChars), tooLong: true });
  }
  return Object.freeze({ text: compact, tooLong: false });
}

function directPinFor(api, argument) {
  const analog = ANALOG_TOKEN.exec(argument);
  if (analog) {
    return Object.freeze({ literalKind: "analog-token", literalPin: "A" + analog[1] });
  }

  if (!DECIMAL_INTEGER.test(argument)) return null;
  const number = Number(argument);
  if (!Number.isSafeInteger(number)) return null;

  if (api === "analogRead") {
    if (number >= 0 && number <= 5) {
      return Object.freeze({ literalKind: "analog-channel-number", literalPin: "A" + number });
    }
    return null;
  }

  if (number >= 0 && number <= 13) {
    return Object.freeze({ literalKind: "digital-number", literalPin: "D" + number });
  }
  return null;
}

function validateTerminalId(id) {
  if (typeof id !== "string" || !id || id.length > SKETCH_PIN_EVIDENCE_LIMITS.maxTerminalIdChars) {
    throw new TypeError("circuit-router trả terminal ID không hợp lệ.");
  }
  validateUnicode(id, "terminal ID");
  if (DISALLOWED_CONTROL.test(id) || BIDI_CONTROL.test(id)) {
    throw new TypeError("circuit-router trả terminal ID có ký tự điều khiển.");
  }
}

function lessonPinIds(lessonId) {
  const terminals = listTerminals(lessonId);
  if (!Array.isArray(terminals)) throw new TypeError("circuit-router listTerminals() phải trả mảng.");

  const allIds = new Set();
  const pinIds = [];
  for (const terminal of terminals) {
    if (!terminal || typeof terminal !== "object" || Array.isArray(terminal) ||
        !Object.hasOwn(terminal, "id")) {
      throw new TypeError("circuit-router trả terminal không hợp lệ.");
    }
    validateTerminalId(terminal.id);
    if (allIds.has(terminal.id)) {
      throw new RangeError("circuit-router trả terminal ID bị trùng: " + terminal.id);
    }
    allIds.add(terminal.id);
    if (terminal.component === "arduino" && CANONICAL_PIN_ID.test(terminal.id)) {
      pinIds.push(terminal.id);
    }
  }
  return Object.freeze(pinIds);
}

function unknownReason(argument, terminated, tooLong) {
  if (!terminated) return "unterminated-call";
  if (tooLong) return "first-argument-too-long";
  if (!argument) return "missing-first-argument";
  if (DECIMAL_INTEGER.test(argument)) return "literal-outside-supported-uno-range";
  return "non-literal-pin-expression";
}

function callKey(call) {
  const target = call.lessonTerminalId ?? call.literalPin ?? call.argument;
  return call.api + "\u0000" + call.status + "\u0000" + target;
}

/**
 * Inspect direct lexical pin arguments in learner source for one lesson.
 *
 * Recognized pin forms are decimal D0..D13 for digital-style APIs, A0..A5
 * tokens, and decimal channel 0..5 for analogRead(). Any alias, macro,
 * expression, function result, or unsupported literal remains `unknown`.
 */
export function inspectSketchPinEvidence(input) {
  requireInput(input);
  const source = normalizeSource(input.source);
  const phase2 = splicePhase2Lines(source.text);
  const masked = maskCommentsAndStrings(phase2.text);
  const lessonTerminalIds = lessonPinIds(input.lessonId);
  const lessonTerminalSet = new Set(lessonTerminalIds);
  const calls = [];
  const duplicateKeys = new Set();
  let duplicateCallCount = 0;

  const regex = new RegExp(CALL_PATTERN.source, CALL_PATTERN.flags);
  for (let match = regex.exec(masked.text); match; match = regex.exec(masked.text)) {
    const api = match[1];
    if (!TARGET_API_SET.has(api) || hasIdentifierPrefix(masked.text, match.index) ||
        isQualifiedCall(masked.text, match.index)) continue;
    if (calls.length >= SKETCH_PIN_EVIDENCE_LIMITS.maxCalls) {
      throw new RangeError(
        "source vượt giới hạn " + SKETCH_PIN_EVIDENCE_LIMITS.maxCalls +
        " lời gọi pin lexical được theo dõi.",
      );
    }

    const openIndex = masked.text.indexOf("(", match.index + api.length);
    if (openIndex < 0) continue;
    const argumentRange = firstArgument(masked.text, openIndex);
    const normalizedArgument = normalizeArgument(
      masked.text.slice(argumentRange.start, argumentRange.end),
    );
    const directPin = argumentRange.terminated && !normalizedArgument.tooLong
      ? directPinFor(api, normalizedArgument.text)
      : null;
    const physicalIndex = phase2.physicalIndexBySplicedIndex[match.index];
    if (!Number.isInteger(physicalIndex)) {
      throw new Error("Không ánh xạ được vị trí lexical về source vật lý.");
    }
    const location = lineColumnAt(source.text, physicalIndex);

    let status = "unknown";
    let lessonTerminalId = null;
    let reason = unknownReason(
      normalizedArgument.text,
      argumentRange.terminated,
      normalizedArgument.tooLong,
    );
    if (directPin) {
      if (lessonTerminalSet.has(directPin.literalPin)) {
        status = "lesson-terminal";
        lessonTerminalId = directPin.literalPin;
        reason = null;
      } else {
        status = "not-in-lesson";
        reason = "literal-pin-not-in-circuit-router-lesson";
      }
    }

    const call = Object.freeze({
      sequence: calls.length + 1,
      api,
      line: location.line,
      column: location.column,
      argument: normalizedArgument.text,
      literalKind: directPin?.literalKind ?? null,
      literalPin: directPin?.literalPin ?? null,
      lessonTerminalId,
      status,
      reason,
    });
    const key = callKey(call);
    if (duplicateKeys.has(key)) duplicateCallCount += 1;
    else duplicateKeys.add(key);
    calls.push(call);
  }

  const matchedTerminalSet = new Set();
  let lessonTerminalCallCount = 0;
  let notInLessonCallCount = 0;
  let unknownCallCount = 0;
  for (const call of calls) {
    if (call.status === "lesson-terminal") {
      lessonTerminalCallCount += 1;
      matchedTerminalSet.add(call.lessonTerminalId);
    } else if (call.status === "not-in-lesson") {
      notInLessonCallCount += 1;
    } else {
      unknownCallCount += 1;
    }
  }

  return deepFreeze({
    schemaVersion: 1,
    lessonId: input.lessonId,
    mode: "masked-direct-pin-call-scan",
    source: {
      charCount: source.text.length,
      lineCount: source.lineCount,
      unterminatedBlockComment: masked.unterminatedBlockComment,
      unterminatedStringLiteral: masked.unterminatedStringLiteral,
      unterminatedRawStringLiteral: masked.unterminatedRawStringLiteral,
    },
    lessonTerminalIds: [...lessonTerminalIds],
    calls,
    summary: {
      callCount: calls.length,
      lessonTerminalCallCount,
      notInLessonCallCount,
      unknownCallCount,
      uniqueLessonTerminalCount: matchedTerminalSet.size,
      duplicateCallCount,
    },
    matchedTerminalIds: [...matchedTerminalSet],
    boundaries: SKETCH_PIN_EVIDENCE_BOUNDARIES,
    claims: {
      compilesCpp: false,
      validatesArduinoSemantics: false,
      executesFirmware: false,
      provesCallExecuted: false,
      validatesPinConnection: false,
      validatesCircuit: false,
      provesLearnerCompletion: false,
      provesLearnerMastery: false,
    },
    provenance: {
      source: "learner-editor-draft",
      terminalIds: "circuit-router:listTerminals",
      scan: "masked-direct-pin-call-scan",
    },
  });
}
