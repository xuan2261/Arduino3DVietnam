import {
  createLabLayout,
  labTerminalAnchor,
  moveLabComponent,
  rotateLabComponent,
  validateLabLayout,
} from "../src/lab-layout.js";
import { listTerminals, sampleWires, supportedWiringLessons } from "../src/circuit-router.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, pattern, message) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown, `${message}: expected exception`);
  assert(pattern.test(String(thrown.message)), `${message}: ${thrown.message}`);
}

function componentIdsFromTerminals(terminals) {
  const result = [];
  const seen = new Set();
  for (const terminal of terminals) {
    if (terminal.component === "arduino" || seen.has(terminal.component)) continue;
    seen.add(terminal.component);
    result.push(terminal.component);
  }
  return result;
}

function cloneLayout(layout) {
  return {
    ...layout,
    claims: { ...layout.claims },
    bounds: { ...layout.bounds },
    terminals: layout.terminals.map(item => ({ ...item })),
    components: layout.components.map(item => ({ ...item, terminalIds: [...item.terminalIds] })),
    terminalMap: Object.fromEntries(Object.entries(layout.terminalMap).map(([key, value]) => [key, { ...value }])),
  };
}

export function runLabLayoutContracts() {
  const results = [];
  const check = (name, fn) => {
    fn();
    results.push({ name, status: "PASS" });
  };

  const supported = supportedWiringLessons();
  check("supported-lessons-02-through-16", () => {
    assert(JSON.stringify(supported) === JSON.stringify(Array.from({ length: 15 }, (_, index) => index + 2)),
      `unexpected wiring lessons: ${supported.join(",")}`);
  });

  for (const lessonId of supported) {
    check(`lesson-${String(lessonId).padStart(2, "0")}-deterministic-conceptual-layout`, () => {
      const terminals = listTerminals(lessonId);
      const a = createLabLayout(lessonId, terminals);
      const b = createLabLayout(lessonId, terminals);
      assert(JSON.stringify(a) === JSON.stringify(b), `lesson ${lessonId}: layout must be deterministic`);
      assert(a.mode === "conceptual-layout", `lesson ${lessonId}: wrong mode`);
      assert(a.units === "logical-grid" && a.grid === 0.5, `lesson ${lessonId}: coordinate contract mismatch`);
      assert(a.claims.physicalVerified === false, `lesson ${lessonId}: physical claim forbidden`);
      assert(a.claims.breadboardHoleMapping === false, `lesson ${lessonId}: breadboard hole claim forbidden`);
      assert(a.claims.electricalPower === false, `lesson ${lessonId}: power claim forbidden`);

      const validation = validateLabLayout(a, terminals);
      assert(validation.ok, `lesson ${lessonId}: ${validation.errors.join("; ")}`);
      const expectedComponents = componentIdsFromTerminals(terminals);
      assert(a.components.length === expectedComponents.length + 2,
        `lesson ${lessonId}: expected board+breadboard+one group per netlist component`);
      assert(a.components[0].id === "arduino" && a.components[0].fixed === true,
        `lesson ${lessonId}: Arduino board must be fixed first entity`);
      assert(a.components[1].id === "breadboard" && a.components[1].fixed === false,
        `lesson ${lessonId}: breadboard must be movable conceptual entity`);
      assert(a.components[1].terminalIds.length === 0,
        `lesson ${lessonId}: breadboard must not invent terminal/hole mappings`);
      assert(JSON.stringify(a.components.slice(2).map(item => item.id)) === JSON.stringify(expectedComponents),
        `lesson ${lessonId}: component groups must follow first terminal occurrence`);

      for (const terminal of terminals) {
        const anchor = labTerminalAnchor(a, terminal.id);
        assert(anchor.terminalId === terminal.id, `lesson ${lessonId}: terminal anchor ID mismatch`);
        assert(anchor.componentId === terminal.component, `lesson ${lessonId}: terminal component mismatch for ${terminal.id}`);
        assert(anchor.anchorModel === "conceptual-perimeter", `lesson ${lessonId}: anchor model mismatch`);
        assert(anchor.physicalVerified === false, `lesson ${lessonId}: anchor must not be physically verified`);
        assert(Number.isFinite(anchor.x) && Number.isFinite(anchor.z) && anchor.y === 0,
          `lesson ${lessonId}: anchor coordinates invalid`);
        assert(!("hole" in anchor) && !("row" in anchor) && !("column" in anchor),
          `lesson ${lessonId}: anchor must not invent breadboard hole coordinates`);
      }
      for (const [from, to] of sampleWires(lessonId)) {
        assert(labTerminalAnchor(a, from).terminalId === from,
          `lesson ${lessonId}: sample wire endpoint ${from} must resolve directly`);
        assert(labTerminalAnchor(a, to).terminalId === to,
          `lesson ${lessonId}: sample wire endpoint ${to} must resolve directly`);
      }
    });
  }

  check("move-is-pure-snapped-bounded-and-collision-resolved", () => {
    const terminals = listTerminals(16);
    const original = createLabLayout(16, terminals);
    const targetId = "LDR";
    const before = original.components.find(item => item.id === targetId);
    const moved = moveLabComponent(original, targetId, 999, 999);
    const after = moved.components.find(item => item.id === targetId);
    const originalAgain = original.components.find(item => item.id === targetId);
    assert(moved !== original, "move must return a new layout");
    assert(originalAgain.x === before.x && originalAgain.z === before.z, "move must not mutate input layout");
    assert(after.x % 0.5 === 0 && after.z % 0.5 === 0, "move must snap to 0.5 grid");
    assert(after.x <= moved.bounds.maxX && after.z <= moved.bounds.maxZ, "move must stay bounded");
    assert(validateLabLayout(moved, terminals).ok, "moved layout must remain valid/non-overlapping");

    const board = moved.components.find(item => item.id === "arduino");
    const collisionRequested = moveLabComponent(moved, targetId, board.x, board.z);
    const collisionResolved = collisionRequested.components.find(item => item.id === targetId);
    assert(collisionResolved.x !== board.x || collisionResolved.z !== board.z,
      "move onto fixed board must resolve to nearest free conceptual placement");
    assert(validateLabLayout(collisionRequested, terminals).ok, "collision-resolved layout must validate");
  });

  check("breadboard-movable-and-rotatable-without-hole-mapping", () => {
    const terminals = listTerminals(2);
    const layout = createLabLayout(2, terminals);
    const moved = moveLabComponent(layout, "breadboard", 1.5, 4.5);
    const rotated = rotateLabComponent(moved, "breadboard");
    const breadboard = rotated.components.find(item => item.id === "breadboard");
    assert(breadboard.quarterTurns === 1, "breadboard must rotate by quarter turn");
    assert(breadboard.terminalIds.length === 0, "breadboard must remain without fake hole terminals");
    assert(validateLabLayout(rotated, terminals).ok, "moved/rotated breadboard layout must validate");
  });

  check("rotate-is-pure-and-terminal-anchor-follows-component", () => {
    const terminals = listTerminals(2);
    const layout = createLabLayout(2, terminals);
    const before = labTerminalAnchor(layout, "R1:A");
    const rotated = rotateLabComponent(layout, "R1");
    const after = labTerminalAnchor(rotated, "R1:A");
    assert(layout.components.find(item => item.id === "R1").quarterTurns === 0, "rotate must not mutate source layout");
    assert(rotated.components.find(item => item.id === "R1").quarterTurns === 1, "default rotation must add one quarter turn");
    assert(before.x !== after.x || before.z !== after.z, "terminal anchor must transform with component rotation");
    assert(after.terminalId === "R1:A" && after.componentId === "R1", "rotated anchor identity must stay canonical");
    assert(validateLabLayout(rotated, terminals).ok, "rotated layout must remain valid");
  });

  check("rotation-normalizes-negative-and-large-quarter-turns", () => {
    const terminals = listTerminals(8);
    const layout = createLabLayout(8, terminals);
    const one = rotateLabComponent(layout, "BUZZ", 5);
    const back = rotateLabComponent(one, "BUZZ", -1);
    assert(one.components.find(item => item.id === "BUZZ").quarterTurns === 1, "+5 quarter turns must normalize to +1");
    assert(back.components.find(item => item.id === "BUZZ").quarterTurns === 0, "-1 must normalize back to zero");
  });

  check("fixed-board-and-unknown-identifiers-rejected", () => {
    const terminals = listTerminals(3);
    const layout = createLabLayout(3, terminals);
    expectThrow(() => moveLabComponent(layout, "arduino", 0, 0), /fixed|di chuyển/i, "move fixed Arduino");
    expectThrow(() => rotateLabComponent(layout, "arduino"), /fixed|xoay/i, "rotate fixed Arduino");
    expectThrow(() => moveLabComponent(layout, "NOPE", 0, 0), /component/i, "unknown component");
    expectThrow(() => labTerminalAnchor(layout, "NOPE"), /terminal/i, "unknown terminal");
  });

  check("lesson-and-terminal-input-guards", () => {
    const lesson2 = listTerminals(2);
    expectThrow(() => createLabLayout(1, lesson2), /2\.\.16/i, "lesson below supported range");
    expectThrow(() => createLabLayout(17, lesson2), /2\.\.16/i, "lesson above supported range");
    expectThrow(() => createLabLayout(2.5, lesson2), /2\.\.16/i, "fractional lesson");
    expectThrow(() => createLabLayout(2, []), /không rỗng|terminals/i, "empty terminals");
    const duplicate = [...lesson2, { ...lesson2[0] }];
    expectThrow(() => createLabLayout(2, duplicate), /trùng/i, "duplicate terminal id");
    const noArduino = lesson2.filter(item => item.component !== "arduino");
    expectThrow(() => createLabLayout(2, noArduino), /arduino/i, "missing Arduino terminals");
    const missingComponent = lesson2.map((item, index) => index === 0 ? { ...item, component: "" } : item);
    expectThrow(() => createLabLayout(2, missingComponent), /component/i, "missing component metadata");
  });

  check("move-and-rotate-argument-guards", () => {
    const terminals = listTerminals(5);
    const layout = createLabLayout(5, terminals);
    expectThrow(() => moveLabComponent(layout, "RGB", Number.NaN, 0), /hữu hạn|x\/z/i, "NaN move");
    expectThrow(() => rotateLabComponent(layout, "RGB", 0.5), /số nguyên|quarterTurns/i, "fractional rotation");
  });

  check("validator-detects-overlap-grid-bounds-and-claim-tampering", () => {
    const terminals = listTerminals(6);
    const layout = createLabLayout(6, terminals);
    const board = layout.components.find(item => item.id === "arduino");

    const overlap = cloneLayout(layout);
    overlap.components[2].x = board.x;
    overlap.components[2].z = board.z;
    assert(!validateLabLayout(overlap, terminals).ok, "validator must reject component overlap");

    const unsnapped = cloneLayout(layout);
    unsnapped.components[2].x += 0.1;
    assert(!validateLabLayout(unsnapped, terminals).ok, "validator must reject unsnapped coordinates");

    const outOfBounds = cloneLayout(layout);
    outOfBounds.components[2].x = 100;
    assert(!validateLabLayout(outOfBounds, terminals).ok, "validator must reject out-of-bounds components");

    const falseClaim = cloneLayout(layout);
    falseClaim.claims.physicalVerified = true;
    assert(!validateLabLayout(falseClaim, terminals).ok, "validator must reject physical verification claim");
  });

  check("validator-detects-terminal-map-drift", () => {
    const terminals = listTerminals(12);
    const layout = createLabLayout(12, terminals);
    const tampered = cloneLayout(layout);
    tampered.terminalMap["SERVO:SIG"].componentId = "arduino";
    assert(!validateLabLayout(tampered, terminals).ok, "validator must reject terminal/component mapping drift");
  });

  check("layout-has-no-runtime-or-electrical-state", () => {
    const layout = createLabLayout(13, listTerminals(13));
    const json = JSON.stringify(layout);
    for (const forbidden of ["voltage", "current", "powered", "energized", "holeIndex", "breadboardRow", "breadboardColumn"]) {
      assert(!json.includes(`\"${forbidden}\"`), `layout must not expose fake electrical/physical field ${forbidden}`);
    }
  });

  check("public-layout-is-frozen", () => {
    const layout = createLabLayout(4, listTerminals(4));
    assert(Object.isFrozen(layout), "layout must be frozen");
    assert(Object.isFrozen(layout.components) && layout.components.every(Object.isFrozen), "components must be frozen");
    assert(Object.isFrozen(layout.terminals) && layout.terminals.every(Object.isFrozen), "terminal snapshot must be frozen");
    assert(Object.isFrozen(layout.terminalMap) && Object.values(layout.terminalMap).every(Object.isFrozen), "terminalMap must be frozen");
    assert(Object.isFrozen(layout.bounds) && Object.isFrozen(layout.claims), "bounds/claims must be frozen");
  });

  return Object.freeze({
    total: results.length,
    passed: results.length,
    failed: 0,
    results: Object.freeze(results.map(item => Object.freeze(item))),
  });
}
