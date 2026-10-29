# Sketch pin evidence — lexical bridge to lesson terminals

## Scope

`src/sketch-pin-evidence.js` adds a bounded static scan for the learner-edited
Arduino Sketch. Its purpose is narrow: show which **direct pin arguments written
in the editor source** can be associated with canonical Arduino terminal IDs
owned by `circuit-router` for the active lesson.

This is lexical evidence only. It does not compile C++, expand aliases/macros,
execute firmware, prove that a call runs, validate Arduino API semantics, or
prove an electrical connection.

The implementation keeps `circuit-router` as the only learner electrical
authority. Callers provide only the lesson ID and editor source; they do not
provide a terminal allowlist.

## Integration API

The additive model API is:

```js
import { inspectSketchPinEvidence } from "./sketch-pin-evidence.js";

const pinEvidence = inspectSketchPinEvidence({
  lessonId: lesson.id,
  source: state.code,
});
```

`renderSketchReview()` keeps its historical two-argument form. Pin evidence is
opt-in through a third argument:

```js
const reviewNode = renderSketchReview(document, inspection, { pinEvidence });
```

If the third argument is omitted, the pin-evidence section is not rendered and
the existing Sketch review behavior stays unchanged.

The host should recompute both `inspection` and `pinEvidence` from the current
lesson/current editor draft whenever the existing source review is refreshed.
It should not pass terminal IDs from DOM state, 2D/3D state, a reference circuit,
or lesson prose.

## Recognized lexical forms

Only these bare API names are scanned:

- `pinMode(pin, ...)`
- `digitalRead(pin)`
- `digitalWrite(pin, ...)`
- `analogRead(pin)`
- `analogWrite(pin, ...)`
- `tone(pin, ...)`

Before comment/string scanning, the lexer applies the C/C++ translation-phase-2
backslash-newline splice to a private lexical view. Every retained code unit in
that view keeps an index back to the original physical source. Comments created
by a splice such as `/\\` + newline + `/` or `/\\` + newline + `*` are therefore
masked before API scanning, and `line`/`column` values still come from the real
physical source position where the recognized API starts. The scanner then masks
comments, normal string/character literals, and C++ raw string literals.

Direct supported pin forms are deliberately small:

- For `pinMode`, `digitalRead`, `digitalWrite`, `analogWrite`, and `tone`, a
  canonical decimal integer `0..13` is normalized to `D0..D13`.
- `A0..A5` is accepted as a direct board pin token.
- For `analogRead`, a canonical decimal channel `0..5` is normalized to
  `A0..A5`; it is never normalized to `D0..D5`.

Everything else stays unresolved. Examples include `LED`, `BUTTON`,
`LED_BUILTIN`, user macros, variables, arithmetic expressions, array lookups,
casts, and function results such as `pinForBuzz()`.

Qualified spellings such as `obj.digitalWrite(...)`, `ptr->digitalWrite(...)`,
and `ns::digitalWrite(...)` are not treated as the direct Arduino API calls
tracked by this feature. Qualification detection scans backward from the API
name to the previous significant lexical token across the full bounded source
prefix, skipping whitespace and comment-masked characters. It therefore still
recognizes `.`, `->`, or `::` when the API name is separated from that qualifier
by long spaces, newlines, comments, or a translation-phase-2 splice; there is no
fixed lookback window. A bare API name itself may span a backslash-newline splice;
when recognized, its reported location maps to the physical line/column of the
first character of that API token.

Bare-API detection does not rely on JavaScript's ASCII-oriented `\b` word
boundary. On the phase2-spliced lexical stream, the scanner inspects the full
Unicode code point immediately before a candidate API name and rejects the
candidate when that code point can continue an identifier (`Unicode
ID_Continue`, `$`, `_`, ZWNJ or ZWJ). Thus BMP and non-BMP Unicode identifier
prefixes such as `ΩdigitalWrite(...)`, `漢digitalWrite(...)`,
`𐐀digitalWrite(...)`, plus `$digitalWrite(...)`, `_digitalWrite(...)`, and the
same prefixes assembled across a backslash-newline splice never become direct
pin evidence.

## Router authority and statuses

For each lesson, the scanner calls `listTerminals(lessonId)` from
`src/circuit-router.js`. It retains only terminals that:

1. are owned by the `arduino` component, and
2. have canonical Uno pin IDs `D0..D13` or `A0..A5`.

The scanner does not read reference wires and does not infer connectivity from
lesson text.

Each lexical occurrence receives one status:

| Status | Meaning |
| --- | --- |
| `lesson-terminal` | The first argument is a supported direct pin token and the exact canonical ID exists in `circuit-router` for this lesson. |
| `not-in-lesson` | A supported direct pin token was recognized, but that canonical ID is absent from the lesson terminal set. |
| `unknown` | The first argument is an alias, macro/expression/function result, unsupported literal, missing argument, too long, or belongs to an unterminated call. |

`lessonTerminalId` is non-null only for `lesson-terminal`. A recognizable
literal outside the lesson may still appear in `literalPin`, but it is not
promoted to a lesson terminal.

Lesson 1 currently has no circuit-router terminal set. A source literal such as
`digitalWrite(13, HIGH)` can therefore be recognized as lexical `D13`, but its
status remains `not-in-lesson` and `lessonTerminalId` stays `null`.

## Evidence object

`inspectSketchPinEvidence()` returns a deeply frozen object with:

- `schemaVersion: 1`
- `lessonId`
- `mode: "masked-direct-pin-call-scan"`
- bounded source metadata and unterminated comment/string flags
- canonical `lessonTerminalIds` sourced from `circuit-router`
- one ordered `calls[]` item per tracked lexical occurrence
- aggregate counts in `summary`
- unique `matchedTerminalIds`
- explicit non-claim `boundaries` and `claims`
- provenance identifying the learner editor source, circuit-router terminal
  authority, and masked lexical scan

Duplicate calls are preserved in `calls[]`. `summary.duplicateCallCount` counts
repeated equivalent API/status/target occurrences with `Set` keys; untrusted
source identifiers are never used as object property names.

## Bounded input and fail-closed behavior

The scanner accepts exactly `{ lessonId, source }`. Extra own properties,
including symbol or prototype-like property names, are rejected. This prevents a
caller from injecting its own `terminalIds` field.

Current limits are:

- 12,000 source characters
- 600 source lines
- 2,000 characters per line
- 96 tracked lexical pin calls
- 160 characters retained for a first-argument display string
- 80 characters maximum for a router terminal ID before validation fails

The scanner also rejects unsupported control characters, Unicode bidi controls,
and unpaired surrogate code units. Valid Unicode identifiers are accepted but
remain `unknown` unless they are one of the direct pin forms above.

Backslash-newline processing operates on JavaScript UTF-16 code units without
rewriting any retained source text, so valid Unicode copied into comments or
identifiers remains intact for masking/display boundaries and physical-position
mapping.

If more than 96 tracked calls are present, the scan throws instead of returning
partial evidence.

## UI boundary

`src/sketch-review-ui.js` renders the opt-in evidence in a separate semantic
section with its own heading, live status summary, call rows, and boundary note.
Dynamic argument text is written only through `textContent`.

The UI validates the evidence shape again before rendering. In particular, it
rejects:

- a lesson ID that differs from the source review inspection
- unsupported call statuses/APIs or inconsistent aggregate counts
- a `lesson-terminal` ID absent from the supplied router-derived terminal list
- positive compiler, firmware, execution, circuit, connection, completion, or
  mastery claims
- foreign provenance that replaces `circuit-router:listTerminals`

The displayed boundary says that the result is static lexical evidence and does
not prove compilation, firmware execution, call execution, a wired/electrically
correct pin, or lesson completion.

## Focused contracts

`tests/sketch-pin-evidence-contracts.js` covers direct D/A mapping, router-only
lesson membership, comment/string/raw-string spoofing, multiline calls,
qualified-call exclusion, alias/macro/function unknowns, duplicates, prototype
names, Unicode/control/length bounds, unterminated source forms, injected fields,
call-count overflow, and deep freezing.

`tests/sketch-review-ui-contracts.js` preserves the 14 historical Sketch review
checks unchanged and adds opt-in pin-evidence checks for accessibility, the three
statuses, non-claim copy, text-content injection safety, forged evidence,
render-row bounds, and unsupported option properties.

Focused Bun commands:

```powershell
bun -e "import('./tests/sketch-pin-evidence-contracts.js').then(m=>console.log(m.runSketchPinEvidenceContracts()))"
bun -e "import('./tests/sketch-review-ui-contracts.js').then(m=>console.log(m.runSketchReviewUiContracts()))"
```

These contracts test the static model and fake-DOM renderer. They are not a
browser/firmware execution result.
