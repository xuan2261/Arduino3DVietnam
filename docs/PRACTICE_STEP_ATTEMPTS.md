# Practice step attempts: bounded TRY → CHECK

## Purpose

Arduino3DVietnam already has 16 lessons, 48 authored checkpoints, canonical
learner graphs, 2D/3D/Inspector projections, explicit authored-hole Confirm and
learner undo/redo. The remaining product gap is a step-scoped attempt loop for
the majority manual checkpoints: **36 manual / 12 wiring**.

The new model adds an opt-in:

    idle → Start → record current-step in-app events → Check → Retry or Cancel

It does not create a new teaching authority. It never proves physical action,
electrical correctness, firmware execution, mastery, teacher validation,
progress, completion, or permission to advance.

## Existing sources, not a third checkpoint mapping

The exact lesson/step/checkpoint identity still comes from
src/practice-checkpoints.js through getPracticeCheckpoint().

The event-category expectations also remain owned by the existing
src/practice-observation.js metadata. practice-step-attempt.js reads that
metadata with a **new empty module-branded observation journal**. It uses only
the checkpoint identity, source step, expected event categories and their
existing informational provenance.

The learner's old lesson-level observation journal is never accepted as step
attempt evidence.

That distinction is required because the old journal intentionally stores only:

    lessonId + eventType

It has no stepIndex or timestamp. A lesson-level change-control event can
therefore overlap more than one authored step, which is useful as an observation
but cannot establish that an event happened in the current step.

## Authority boundary

Every attempt snapshot/review keeps these claims false:

    physicalVerified
    electricalAuthority
    electricalSafetyVerified
    firmwareExecuted
    hardwareValidated
    mastery
    teacherValidated
    autoCompletion
    lessonCompleted
    prerequisiteForAdvance
    progressTracked

The model does not accept a circuit graph and exposes no graph mutation API. It
does not call circuit connection, scene, AVR, simulation, storage or completion
functions.

## Public model API

src/practice-step-attempt.js exports exactly:

    PRACTICE_STEP_ATTEMPT_LIMITS
    PRACTICE_STEP_ATTEMPT_EVENT_TYPES
    createPracticeStepAttemptSession()
    startPracticeStepAttempt(session, { lesson, stepIndex })
    recordPracticeStepAttemptEvent(session, {
      lesson, stepIndex, attemptToken, eventType
    })
    checkPracticeStepAttempt(session, {
      lesson, stepIndex, attemptToken
    })
    retryPracticeStepAttempt(session, {
      lesson, stepIndex, attemptToken
    })
    cancelPracticeStepAttempt(session, { attemptToken })
    inspectPracticeStepAttempt(session, { lesson, stepIndex })

Every transition returns a **new immutable WeakSet-branded session**. The caller
replaces its session reference; old sessions are not mutated.

### Session and token

Each session has a unique module-local sessionId and monotonic revision.

Start and Retry mint an opaque frozen WeakSet-branded token containing:

    sessionId
    revision
    lessonId
    stepIndex
    checkpointId

The visible fields are diagnostic identity only. A copied token, JSON clone,
stale token, wrong lesson, wrong step, modified source step, getter, symbol key
or custom-prototype input fails closed.

## Lifecycle

### Start

Start is allowed only while the session is idle. It binds the exact current
authored checkpoint and mints revision N. Starting itself records no event.

Only one attempt can be active in a session. Navigation must not silently
retarget it.

### Record

recordPracticeStepAttemptEvent() accepts only the current observation vocabulary:

    view-pinout
    view-3d
    view-wiring
    change-control
    start-simulation
    edit-sketch
    connect-wire

It requires an active branded token plus the exact current lesson and step.
Actual host reports are retained up to **64** records. Repeated real events may
therefore be counted, while the UI projection lists unique categories so
repetition never becomes a stronger learning claim.

Recording a new event after Check clears the old review so the learner can
explicitly Check again.

### Check

Check creates an informational review and leaves the attempt active. The review
contains:

- expected categories;
- categories observed during this exact attempt;
- matching categories;
- expected categories not yet observed;
- other allowlisted categories observed during the attempt;
- event count;
- exact lesson/step/checkpoint identity;
- provenance and bounded claims.

The statuses are descriptions, not grades:

    self-review-only-no-observable-expectation
    no-current-attempt-events
    partial-current-attempt-evidence
    expected-current-attempt-events-observed

There is no passed field, score, mastery result, completion result or teacher
result.

### Steps with no observable expectation

Five current authored steps intentionally have no event category that the
existing vocabulary can ground safely. Check returns
self-review-only-no-observable-expectation for these steps.

This status must never render as pass/success. It means only that the app has no
automatic event criterion for that step; the source guidance remains the
self-review basis.

### Retry

Retry changes only attempt state:

    revision N → revision N+1

It clears attempt records/review and mints a new token. It does not reset
simulation, circuit, controls, layout, Sketch, quiz or lesson progress. Old
callbacks become stale immediately.

### Cancel

Cancel also changes only attempt state. It increments the revision, clears the
active attempt and returns the session to idle. It does not undo learner graph
or layout edits.

## Lesson 10 and lesson 14

The model derives a read-only lessonScope from the existing circuit-router
analysis of an empty canonical graph.

Lessons 10 and 14 therefore remain signal-only. An attempt review cannot claim
that a motor, pump, external supply, load, physical function or safety condition
has been validated. Lesson 10 remains manual in the authored checkpoint layer;
lesson 14 keeps its existing wiring/manual split.

## Native renderer

src/practice-step-attempt-ui.js exports exactly:

    renderPracticeStepAttempt(document, snapshot, {
      onStart,
      onCheck,
      onRetry,
      onCancel
    })

Callbacks are:

    onStart(context)
    onCheck(attemptToken, context)
    onRetry(attemptToken, context)
    onCancel(attemptToken, context)

context is a frozen plain object containing lessonId, stepIndex and
checkpointId. The renderer passes the opaque branded token through unchanged.
It never mutates model state.

The UI exposes four native type=button controls, each at least 44 × 44 px:

- Bắt đầu lượt thực hành
- Kiểm tra bằng chứng trong lượt này
- Thử lại
- Hủy lượt

Its status uses role=status, aria-live=polite and aria-atomic=true. Expected and
observed categories are visible text. There is no success/pass/completion
presentation.

styles/practice-step-attempt.css is the owned presentation layer for this block.
It keeps the action grid min-width-safe, uses one column at widths up to 580 px,
preserves the 44 px target floor, provides a visible focus ring, wraps long
content, and removes button transitions under prefers-reduced-motion. Linking
that stylesheet into index/build/service-worker manifests is host/prime-owned
integration, not performed by this worker.

## Host integration

This worker intentionally does not edit src/app.js.

The host can own one session:

    state.practiceStepAttempts = createPracticeStepAttemptSession()

For the current Practice step:

1. inspect the current session with the exact current lesson and stepIndex;
2. render the returned snapshot;
3. callback → call the matching model transition;
4. replace state.practiceStepAttempts with the returned new session;
5. rerender only the attempt block from a fresh inspect snapshot.

No review status should automatically change state.learningSteps or lesson
progress.

### Important event hook ordering

The current recordPracticeAction(eventType) performs lesson-level dedupe for the
old observation journal. The new step-attempt hook must run **before** that
early return:

    real host interaction
      → if current attempt is active/checked for exact lesson+step:
          recordPracticeStepAttemptEvent(...)
          refresh only current attempt UI
      → existing lesson-level observation journal/dedupe remains unchanged

This ordering is necessary so a change-control event in lesson 02 step 2 does
not suppress a later real change-control event during lesson 02 step 3.

Never feed the old observation journal into the new model.

### Navigation and stale callbacks

Do not auto-start on step navigation.

Recommended host policy:

1. cancel an active attempt with its current token;
2. then change lesson/step;
3. inspect the new step as idle.

Even without that policy, model operations against a different lesson/step fail
closed because the active source/token no longer match.

After replacing the attempt subtree, the host should preserve keyboard
continuity:

    Start  → focus Check
    Check  → focus Check (or an explicitly chosen Retry target)
    Retry  → focus Check
    Cancel → focus Start

The renderer itself does not own application navigation or external focus.

## Relationship to wiring evidence

The attempt model does not replace:

- practice-evidence.js;
- practice-wire-guidance.js;
- canonical learner graph comparison;
- authored 2D/3D missing-pair previews;
- authored-hole Confirm;
- Inspector;
- learner undo/redo.

For wiring checkpoints, topology evidence remains the authority for authored
edge presence. A step attempt can additionally state that in-app interaction
categories were reported during the exact current attempt; those categories do
not become topology truth.

The older learning-coach.js heuristic checkpoint text is also not a source for
this model. The authored practice-checkpoints.js identity remains the checkpoint
source.

## Direct contract scope

tests/practice-step-attempt-contracts.js covers:

- exact exports and frozen limits;
- all 48 checkpoints and the 36 manual / 12 wiring split;
- equality with existing observation expectation metadata;
- event-before-Start, wrong lesson/step/source and unknown event;
- repeated events and the 64-record bound;
- informational Check with no passed/score/completion field;
- the no-observable-expectation state;
- Retry/Cancel stale tokens;
- lesson 10/14 signal-only boundaries;
- no circuit mutation authority;
- forged sessions/tokens, accessors, custom prototypes, symbols and completion injection;
- four native 44 px controls, live status and exact callback token/context;
- neutral no-expectation rendering and forged-success rejection.

This worker runs only the direct Bun contract for these new files. Browser/E2E,
app integration, build/SW allowlists, release gates and deployment remain
prime-owned follow-up work.
