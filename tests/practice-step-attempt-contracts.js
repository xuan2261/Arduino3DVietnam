import { lessonById, lessons } from "../src/lessons.js";
import { createCircuit } from "../src/circuit-router.js";
import {
  createPracticeObservationJournal,
  inspectPracticeObservation,
} from "../src/practice-observation.js";
import { listPracticeCheckpoints } from "../src/practice-checkpoints.js";
import * as attemptModel from "../src/practice-step-attempt.js";
import * as attemptUi from "../src/practice-step-attempt-ui.js";

const {
  PRACTICE_STEP_ATTEMPT_EVENT_TYPES,
  PRACTICE_STEP_ATTEMPT_LIMITS,
  cancelPracticeStepAttempt,
  checkPracticeStepAttempt,
  createPracticeStepAttemptSession,
  inspectPracticeStepAttempt,
  recordPracticeStepAttemptEvent,
  retryPracticeStepAttempt,
  startPracticeStepAttempt,
} = attemptModel;
const { renderPracticeStepAttempt } = attemptUi;

function assert(condition, message) {
  if (!condition) throw new Error("practice-step-attempt contract: " + message);
}

function expectThrow(run, pattern, label) {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert(error && pattern.test(String(error.message || error)), label);
}

function frozenClaimsAreBounded(claims) {
  return Object.isFrozen(claims) &&
    claims.origin === "step-scoped-module-attempt" &&
    claims.sessionOnly === true &&
    claims.stepScoped === true &&
    claims.eventsRequireHostReport === true &&
    claims.outsideAppActionKnown === false &&
    claims.learnerActionProven === false &&
    claims.physicalActionProven === false &&
    claims.physicalVerified === false &&
    claims.electricalAuthority === false &&
    claims.electricalSafetyVerified === false &&
    claims.firmwareExecuted === false &&
    claims.hardwareValidated === false &&
    claims.mastery === false &&
    claims.teacherValidated === false &&
    claims.autoCompletion === false &&
    claims.lessonCompleted === false &&
    claims.prerequisiteForAdvance === false &&
    claims.progressTracked === false;
}

function startFor(lessonId, stepIndex) {
  const lesson = lessonById(lessonId);
  const idle = createPracticeStepAttemptSession();
  const started = startPracticeStepAttempt(idle, { lesson, stepIndex });
  const snapshot = inspectPracticeStepAttempt(started, { lesson, stepIndex });
  return { lesson, idle, session: started, snapshot, token: snapshot.attemptToken };
}

function recordFor(fixture, eventType) {
  fixture.session = recordPracticeStepAttemptEvent(fixture.session, {
    lesson: fixture.lesson,
    stepIndex: fixture.snapshot.stepIndex,
    attemptToken: fixture.token,
    eventType,
  });
  fixture.snapshot = inspectPracticeStepAttempt(fixture.session, {
    lesson: fixture.lesson,
    stepIndex: fixture.snapshot.stepIndex,
  });
  return fixture.snapshot;
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.className = "";
    this.type = "";
    this.disabled = false;
    this._text = "";
  }
  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }
  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }
  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeNode, "fake DOM append requires FakeNode");
      this.children.push(node);
    }
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  click() {
    if (this.disabled) return;
    for (const listener of this.listeners.get("click") ?? []) {
      listener({ target: this, currentTarget: this, type: "click" });
    }
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeNode(tagName, this);
  }
}

function descendants(node) {
  const all = [];
  const visit = current => {
    for (const child of current.children) {
      all.push(child);
      visit(child);
    }
  };
  visit(node);
  return all;
}

function byAttribute(root, attribute) {
  return descendants(root).find(node => node.attributes.has(attribute)) ?? null;
}

function allByTag(root, tagName) {
  return descendants(root).filter(node => node.tagName === String(tagName).toUpperCase());
}

function hasSuccessPresentation(root) {
  return [root, ...descendants(root)].some(node =>
    /(?:^|[-_])(?:success|passed|complete)(?:$|[-_])/i.test(node.className || "") ||
    [...node.attributes.entries()].some(([name, value]) =>
      /result|status|state/i.test(name) && /^(?:success|pass|passed|complete|completed)$/i.test(value)
    )
  );
}

export function runPracticeStepAttemptContracts() {
  const checks = [];
  const check = (name, run) => { run(); checks.push(name); };

  check("exact-public-exports-and-frozen-bounds", () => {
    assert(Object.keys(attemptModel).sort().join(",") === [
      "PRACTICE_STEP_ATTEMPT_EVENT_TYPES",
      "PRACTICE_STEP_ATTEMPT_LIMITS",
      "cancelPracticeStepAttempt",
      "checkPracticeStepAttempt",
      "createPracticeStepAttemptSession",
      "inspectPracticeStepAttempt",
      "requirePracticeStepAttemptSnapshot",
      "recordPracticeStepAttemptEvent",
      "retryPracticeStepAttempt",
      "startPracticeStepAttempt",
    ].sort().join(","), "model export surface");
    assert(typeof attemptModel.requirePracticeStepAttemptSnapshot === "function",
      "new snapshot provenance verifier remains a documented, fail-closed export");
    assert(Object.keys(attemptUi).join(",") === "renderPracticeStepAttempt", "UI export surface");
    assert(Object.isFrozen(PRACTICE_STEP_ATTEMPT_LIMITS) &&
      PRACTICE_STEP_ATTEMPT_LIMITS.version === 1 &&
      PRACTICE_STEP_ATTEMPT_LIMITS.maxRecords === 64 &&
      PRACTICE_STEP_ATTEMPT_LIMITS.totalCheckpoints === 48, "model limits");
    assert(Object.isFrozen(PRACTICE_STEP_ATTEMPT_EVENT_TYPES) &&
      JSON.stringify(PRACTICE_STEP_ATTEMPT_EVENT_TYPES) === JSON.stringify([
        "view-pinout", "view-3d", "view-wiring", "change-control",
        "start-simulation", "edit-sketch", "connect-wire",
      ]), "event allowlist comes from observation vocabulary");
  });

  check("session-and-token-are-module-branded-immutable-and-forgery-resistant", () => {
    const base = createPracticeStepAttemptSession();
    const next = createPracticeStepAttemptSession();
    assert(Object.isFrozen(base) && Object.isFrozen(next) && base !== next &&
      base.sessionId !== next.sessionId && base.revision === 0 && base.active === null,
    "unique immutable sessions");
    const lesson = lessonById(2);
    const started = startPracticeStepAttempt(base, { lesson, stepIndex: 1 });
    const snapshot = inspectPracticeStepAttempt(started, { lesson, stepIndex: 1 });
    assert(Object.isFrozen(started) && started !== base && Object.isFrozen(snapshot) &&
      Object.isFrozen(snapshot.attemptToken) && snapshot.attemptToken.revision === 1,
    "start returns immutable session and opaque token");
    expectThrow(
      () => inspectPracticeStepAttempt({ ...started }, { lesson, stepIndex: 1 }),
      /không được tạo bởi module/i,
      "literal session clone rejected",
    );
    expectThrow(
      () => recordPracticeStepAttemptEvent(started, {
        lesson, stepIndex: 1, attemptToken: Object.freeze({ ...snapshot.attemptToken }),
        eventType: "change-control",
      }),
      /attemptToken.*không được tạo bởi module/i,
      "token clone rejected",
    );
  });

  check("all-48-authored-steps-bind-exact-source-with-36-manual-12-wiring", () => {
    assert(lessons.length === 16, "expected 16 lessons");
    let total = 0, manual = 0, wiring = 0, noExpectation = 0;
    const emptyJournal = createPracticeObservationJournal();
    for (const lesson of lessons) {
      const authored = listPracticeCheckpoints(lesson);
      assert(authored.length === 3, "three authored checkpoints lesson " + lesson.id);
      for (let stepIndex = 0; stepIndex < 3; stepIndex += 1) {
        total += 1;
        const snapshot = inspectPracticeStepAttempt(
          createPracticeStepAttemptSession(),
          { lesson, stepIndex },
        );
        const checkpoint = authored[stepIndex];
        const observation = inspectPracticeObservation({ lesson, stepIndex, journal: emptyJournal });
        if (checkpoint.kind === "manual") manual += 1; else wiring += 1;
        if (!snapshot.expectedEventTypes.length) noExpectation += 1;
        assert(snapshot.state === "idle" &&
          snapshot.checkpointId === checkpoint.id &&
          snapshot.checkpointKind === checkpoint.kind &&
          snapshot.sourceStep === checkpoint.sourceStep &&
          snapshot.guidance === checkpoint.guidance &&
          JSON.stringify(snapshot.expectedEventTypes) === JSON.stringify(observation.expectedEventTypes),
        "exact checkpoint/expectation " + checkpoint.id);
        assert(frozenClaimsAreBounded(snapshot.claims), "bounded idle claims " + checkpoint.id);
      }
    }
    assert(total === 48 && manual === 36 && wiring === 12, "48 total = 36 manual + 12 wiring");
    assert(noExpectation === 5, "five authored steps intentionally have no observable event expectation");
  });

  check("events-require-active-exact-step-and-current-source", () => {
    const donor = startFor(2, 1);
    const idle = createPracticeStepAttemptSession();
    expectThrow(
      () => recordPracticeStepAttemptEvent(idle, {
        lesson: donor.lesson, stepIndex: 1, attemptToken: donor.token, eventType: "change-control",
      }),
      /chưa có.*active/i,
      "event before local start rejected",
    );
    expectThrow(
      () => recordPracticeStepAttemptEvent(donor.session, {
        lesson: donor.lesson, stepIndex: 2, attemptToken: donor.token, eventType: "change-control",
      }),
      /stale|lesson\/step\/checkpoint/i,
      "wrong step rejected",
    );
    expectThrow(
      () => recordPracticeStepAttemptEvent(donor.session, {
        lesson: lessonById(3), stepIndex: 1, attemptToken: donor.token, eventType: "change-control",
      }),
      /stale|lesson\/step\/checkpoint/i,
      "wrong lesson rejected",
    );
    expectThrow(
      () => recordPracticeStepAttemptEvent(donor.session, {
        lesson: donor.lesson, stepIndex: 1, attemptToken: donor.token, eventType: "fake-event",
      }),
      /allowlist/i,
      "unknown event rejected",
    );
    const tampered = { ...donor.lesson, steps: [...donor.lesson.steps] };
    tampered.steps[1] += " [tampered]";
    expectThrow(
      () => recordPracticeStepAttemptEvent(donor.session, {
        lesson: tampered, stepIndex: 1, attemptToken: donor.token, eventType: "change-control",
      }),
      /không khớp nội dung.*checkpoint/i,
      "tampered authored source rejected",
    );
  });

  check("repeated-real-events-remain-bounded-but-category-projection-is-unique", () => {
    const fixture = startFor(2, 1);
    recordFor(fixture, "change-control");
    recordFor(fixture, "change-control");
    assert(fixture.snapshot.eventCount === 2 &&
      JSON.stringify(fixture.snapshot.observedEventTypes) === JSON.stringify(["change-control"]),
    "two actual reports retained while category projection dedupes");
    fixture.session = checkPracticeStepAttempt(fixture.session, {
      lesson: fixture.lesson, stepIndex: 1, attemptToken: fixture.token,
    });
    fixture.snapshot = inspectPracticeStepAttempt(fixture.session, { lesson: fixture.lesson, stepIndex: 1 });
    assert(fixture.snapshot.state === "checked" &&
      fixture.snapshot.review.status === "expected-current-attempt-events-observed" &&
      fixture.snapshot.review.eventCount === 2 &&
      !Object.hasOwn(fixture.snapshot.review, "passed") &&
      !Object.hasOwn(fixture.snapshot.review, "score") &&
      frozenClaimsAreBounded(fixture.snapshot.review.claims),
    "coverage is informational, not pass/score");
    recordFor(fixture, "change-control");
    assert(fixture.snapshot.state === "active" && fixture.snapshot.review === null,
      "new real event clears stale check result for recheck");
  });

  check("record-budget-is-64-and-overflow-fails-without-mutating-session", () => {
    const fixture = startFor(2, 1);
    for (let index = 0; index < PRACTICE_STEP_ATTEMPT_LIMITS.maxRecords; index += 1) {
      recordFor(fixture, "change-control");
    }
    assert(fixture.snapshot.eventCount === 64, "64 records accepted");
    const before = fixture.session;
    expectThrow(
      () => recordPracticeStepAttemptEvent(fixture.session, {
        lesson: fixture.lesson, stepIndex: 1, attemptToken: fixture.token, eventType: "change-control",
      }),
      /giới hạn 64/i,
      "65th event rejected",
    );
    assert(fixture.session === before, "failed append cannot mutate prior immutable session");
  });

  check("check-with-no-editorial-expectation-never-claims-pass", () => {
    const fixture = startFor(4, 2);
    assert(fixture.snapshot.checkpointKind === "manual" && fixture.snapshot.expectedEventTypes.length === 0,
      "lesson4 step3 is manual with no event expectation");
    fixture.session = checkPracticeStepAttempt(fixture.session, {
      lesson: fixture.lesson, stepIndex: 2, attemptToken: fixture.token,
    });
    fixture.snapshot = inspectPracticeStepAttempt(fixture.session, { lesson: fixture.lesson, stepIndex: 2 });
    const review = fixture.snapshot.review;
    assert(review.status === "self-review-only-no-observable-expectation" &&
      review.expectedEventTypes.length === 0 &&
      review.matchingEventTypes.length === 0 &&
      !Object.hasOwn(review, "passed") && !Object.hasOwn(review, "success") &&
      !Object.hasOwn(review, "complete") &&
      review.provenance.oldLessonJournalUsedAsStepProof === false &&
      frozenClaimsAreBounded(review.claims),
    "NONE expectation stays informational and non-passing");
  });

  check("retry-and-cancel-invalidate-stale-callback-tokens", () => {
    const fixture = startFor(3, 1);
    const oldToken = fixture.token;
    fixture.session = retryPracticeStepAttempt(fixture.session, {
      lesson: fixture.lesson, stepIndex: 1, attemptToken: oldToken,
    });
    fixture.snapshot = inspectPracticeStepAttempt(fixture.session, { lesson: fixture.lesson, stepIndex: 1 });
    fixture.token = fixture.snapshot.attemptToken;
    assert(fixture.token !== oldToken && fixture.token.revision === oldToken.revision + 1 &&
      fixture.snapshot.eventCount === 0 && fixture.snapshot.review === null,
    "retry mints next revision and clears attempt-only evidence");
    expectThrow(
      () => checkPracticeStepAttempt(fixture.session, {
        lesson: fixture.lesson, stepIndex: 1, attemptToken: oldToken,
      }),
      /stale/i,
      "old callback token rejected after retry",
    );
    const cancelToken = fixture.token;
    fixture.session = cancelPracticeStepAttempt(fixture.session, { attemptToken: cancelToken });
    const idle = inspectPracticeStepAttempt(fixture.session, { lesson: fixture.lesson, stepIndex: 1 });
    assert(idle.state === "idle" && idle.attemptToken === null && idle.eventCount === 0,
      "cancel clears only attempt state");
    expectThrow(
      () => recordPracticeStepAttemptEvent(fixture.session, {
        lesson: fixture.lesson, stepIndex: 1, attemptToken: cancelToken, eventType: "change-control",
      }),
      /chưa có.*active|stale/i,
      "canceled callback token cannot record later event",
    );
  });

  check("lesson10-and-14-remain-signal-only-with-no-functional-upgrade", () => {
    for (const lessonId of [10, 14]) {
      const fixture = startFor(lessonId, lessonId === 10 ? 1 : 0);
      assert(fixture.snapshot.lessonScope === "signal-only", "signal-only scope lesson " + lessonId);
      const eventType = fixture.snapshot.expectedEventTypes[0] ?? "view-3d";
      recordFor(fixture, eventType);
      fixture.session = checkPracticeStepAttempt(fixture.session, {
        lesson: fixture.lesson,
        stepIndex: fixture.snapshot.stepIndex,
        attemptToken: fixture.token,
      });
      fixture.snapshot = inspectPracticeStepAttempt(
        fixture.session,
        { lesson: fixture.lesson, stepIndex: fixture.snapshot.stepIndex },
      );
      assert(fixture.snapshot.review.lessonScope === "signal-only" &&
        frozenClaimsAreBounded(fixture.snapshot.review.claims) &&
        !Object.hasOwn(fixture.snapshot.review, "functional") &&
        !Object.hasOwn(fixture.snapshot.review, "hardwareFunctional"),
      "attempt does not upgrade signal-only lesson " + lessonId);
    }
  });

  check("attempt-model-has-no-circuit-graph-mutation-authority", () => {
    const graph = createCircuit(14);
    const before = JSON.stringify(graph);
    const fixture = startFor(14, 1);
    const eventType = fixture.snapshot.expectedEventTypes[0] ?? "change-control";
    recordFor(fixture, eventType);
    fixture.session = checkPracticeStepAttempt(fixture.session, {
      lesson: fixture.lesson, stepIndex: 1, attemptToken: fixture.token,
    });
    assert(JSON.stringify(graph) === before, "unrelated canonical graph remains byte-equal");
    assert(!Object.keys(attemptModel).some(key => /connect|disconnect|circuit|wire/i.test(key)),
      "attempt API exposes no circuit mutation method");
    assert(frozenClaimsAreBounded(
      inspectPracticeStepAttempt(fixture.session, { lesson: fixture.lesson, stepIndex: 1 }).claims,
    ), "attempt snapshot keeps no electrical authority");
  });

  check("custom-prototype-accessor-symbol-and-extra-inputs-fail-closed", () => {
    const lesson = lessonById(2);
    const session = createPracticeStepAttemptSession();
    expectThrow(
      () => startPracticeStepAttempt(session, Object.create({ lesson, stepIndex: 1 })),
      /plain object/i,
      "custom prototype start input",
    );
    const accessor = { lesson };
    Object.defineProperty(accessor, "stepIndex", {
      enumerable: true,
      get() { throw new Error("getter must not execute"); },
    });
    expectThrow(
      () => startPracticeStepAttempt(session, accessor),
      /own data field/i,
      "accessor start field",
    );
    const symbolInput = { lesson, stepIndex: 1 };
    symbolInput[Symbol("extra")] = true;
    expectThrow(
      () => startPracticeStepAttempt(session, symbolInput),
      /symbol/i,
      "symbol injection",
    );
    expectThrow(
      () => startPracticeStepAttempt(session, { lesson, stepIndex: 1, completed: true }),
      /field không được hỗ trợ/i,
      "completion injection",
    );
    const lessonAccessor = { ...lesson };
    Object.defineProperty(lessonAccessor, "steps", {
      enumerable: true,
      get() { throw new Error("lesson getter must not execute"); },
    });
    expectThrow(
      () => startPracticeStepAttempt(session, { lesson: lessonAccessor, stepIndex: 1 }),
      /own data field/i,
      "lesson accessor rejected before reading",
    );
  });

  check("native-ui-idle-actions-status-and-callback-context-are-accessible", () => {
    const doc = new FakeDocument();
    const lesson = lessonById(2);
    const session = createPracticeStepAttemptSession();
    const snapshot = inspectPracticeStepAttempt(session, { lesson, stepIndex: 1 });
    const calls = [];
    const root = renderPracticeStepAttempt(doc, snapshot, {
      onStart: context => calls.push(["start", context]),
      onCheck: () => calls.push(["check"]),
      onRetry: () => calls.push(["retry"]),
      onCancel: () => calls.push(["cancel"]),
    });
    assert(root.tagName === "SECTION" && root.getAttribute("role") === "group" &&
      root.getAttribute("data-attempt-state") === "idle", "named idle group");
    const status = byAttribute(root, "data-practice-step-attempt-status");
    assert(status?.getAttribute("role") === "status" &&
      status.getAttribute("aria-live") === "polite" &&
      status.getAttribute("aria-atomic") === "true", "polite atomic status");
    const buttons = allByTag(root, "button");
    assert(buttons.length === 4 && buttons.every(button =>
      button.type === "button" &&
      button.style.minWidth === "44px" && button.style.minHeight === "44px"
    ), "four native 44px controls");
    const start = byAttribute(root, "data-attempt-start");
    assert(start && !start.disabled &&
      byAttribute(root, "data-attempt-check")?.disabled &&
      byAttribute(root, "data-attempt-retry")?.disabled &&
      byAttribute(root, "data-attempt-cancel")?.disabled,
    "idle exposes only Start");
    start.click();
    assert(calls.length === 1 && calls[0][0] === "start" &&
      Object.isFrozen(calls[0][1]) &&
      JSON.stringify(calls[0][1]) === JSON.stringify({
        lessonId: 2, stepIndex: 1, checkpointId: "lesson-02-step-02",
      }), "Start callback receives frozen exact current-step context");
    assert(/không tự chuyển bước|không tự hoàn thành/i.test(root.textContent),
      "UI boundary keeps navigation/completion separate");
  });

  check("native-ui-active-callbacks-pass-exact-token-without-mutating-model", () => {
    const fixture = startFor(2, 1);
    const doc = new FakeDocument();
    const calls = [];
    const root = renderPracticeStepAttempt(doc, fixture.snapshot, {
      onStart: () => calls.push(["start"]),
      onCheck: (token, context) => calls.push(["check", token, context]),
      onRetry: (token, context) => calls.push(["retry", token, context]),
      onCancel: (token, context) => calls.push(["cancel", token, context]),
    });
    const checkButton = byAttribute(root, "data-attempt-check");
    const retryButton = byAttribute(root, "data-attempt-retry");
    const cancelButton = byAttribute(root, "data-attempt-cancel");
    assert(byAttribute(root, "data-attempt-start")?.disabled &&
      !checkButton.disabled && !retryButton.disabled && !cancelButton.disabled,
    "active exposes Check/Retry/Cancel only");
    checkButton.click();
    retryButton.click();
    cancelButton.click();
    assert(calls.length === 3 && calls.every(call => call[1] === fixture.token),
      "active callbacks receive exact opaque token identity");
    assert(calls.every(call => Object.isFrozen(call[2]) &&
      call[2].lessonId === 2 && call[2].stepIndex === 1 &&
      call[2].checkpointId === "lesson-02-step-02"),
    "active callbacks receive exact frozen context");
    assert(fixture.snapshot.state === "active" && fixture.snapshot.eventCount === 0,
      "renderer callbacks do not mutate immutable model snapshot themselves");
  });

  check("native-ui-no-expectation-review-is-neutral-and-forged-success-is-rejected", () => {
    const fixture = startFor(4, 2);
    fixture.session = checkPracticeStepAttempt(fixture.session, {
      lesson: fixture.lesson, stepIndex: 2, attemptToken: fixture.token,
    });
    fixture.snapshot = inspectPracticeStepAttempt(fixture.session, { lesson: fixture.lesson, stepIndex: 2 });
    const root = renderPracticeStepAttempt(new FakeDocument(), fixture.snapshot, {});
    assert(root.getAttribute("data-attempt-state") === "checked" &&
      root.textContent.includes("không có trạng thái đạt/rớt") &&
      /không phải điểm số|không chấm mastery/i.test(root.textContent) &&
      !hasSuccessPresentation(root),
    "NONE expectation UI remains neutral without success presentation");
    const forgedSummaryReview = Object.freeze({
      ...fixture.snapshot.review,
      summary: "SUCCESS: forged review copy must never be rendered",
    });
    const forgedSummarySnapshot = Object.freeze({
      ...fixture.snapshot,
      review: forgedSummaryReview,
    });
    const neutralized = renderPracticeStepAttempt(new FakeDocument(), forgedSummarySnapshot, {});
    assert(!/SUCCESS: forged review/i.test(neutralized.textContent) &&
      /không có category đủ rõ/i.test(neutralized.textContent),
    "renderer derives neutral review copy instead of trusting supplied review.summary");
    const forgedReview = Object.freeze({
      ...fixture.snapshot.review,
      status: "success",
      summary: "SUCCESS",
    });
    const forged = Object.freeze({ ...fixture.snapshot, review: forgedReview });
    expectThrow(
      () => renderPracticeStepAttempt(new FakeDocument(), forged, {}),
      /review provenance\/identity/i,
      "forged success review rejected",
    );
  });

  check("native-ui-rejects-forged-claims-and-callback-accessors", () => {
    const fixture = startFor(10, 1);
    const forgedClaims = Object.freeze({ ...fixture.snapshot.claims, mastery: true });
    const forged = Object.freeze({ ...fixture.snapshot, claims: forgedClaims });
    expectThrow(
      () => renderPracticeStepAttempt(new FakeDocument(), forged, {}),
      /claims vượt ranh giới/i,
      "mastery claim injection rejected",
    );
    const options = {};
    Object.defineProperty(options, "onCheck", {
      enumerable: true,
      get() { throw new Error("UI callback getter must not execute"); },
    });
    expectThrow(
      () => renderPracticeStepAttempt(new FakeDocument(), fixture.snapshot, options),
      /own data field/i,
      "callback accessor rejected",
    );
    const root = renderPracticeStepAttempt(new FakeDocument(), fixture.snapshot, {});
    assert(allByTag(root, "button").every(button => button.disabled),
      "missing callbacks fail closed as disabled native actions");
  });

  return Object.freeze({
    total: checks.length,
    passed: checks.length,
    checks: Object.freeze(checks),
    scope: "step-scoped informational practice attempts only; no progress/electrical/physical authority",
  });
}
