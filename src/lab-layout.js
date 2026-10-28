/**
 * Deterministic conceptual layout model for the Arduino3DVietnam 3D lab.
 *
 * This module owns only logical scene placement. Coordinates are display-space
 * units, never millimetres, breadboard-hole coordinates or electrical claims.
 */

export const LAB_LAYOUT_LIMITS = Object.freeze({
  minLessonId: 2,
  maxLessonId: 16,
  maxTerminals: 48,
  maxNetlistComponents: 16,
  grid: 0.5,
  bounds: Object.freeze({ minX: -10, maxX: 10, minZ: -7, maxZ: 7 }),
  componentGap: 0.25,
});

const VERSION = 1;
const MODE = "conceptual-layout";
const ANCHOR_MODEL = "conceptual-perimeter";
const EPSILON = 1e-9;

const BOARD = Object.freeze({
  id: "arduino",
  visualKind: "arduino-uno",
  label: "Arduino Uno R3",
  fixed: true,
  x: -7,
  z: 0,
  quarterTurns: 0,
  width: 3.5,
  depth: 4.5,
});

const BREADBOARD = Object.freeze({
  id: "breadboard",
  visualKind: "breadboard",
  label: "Breadboard · vùng bố trí khái niệm",
  fixed: false,
  x: -1,
  z: 0,
  quarterTurns: 0,
  width: 5,
  depth: 4,
});

const PREFERRED_COMPONENT_SLOTS = Object.freeze([
  Object.freeze({ x: 4, z: -4.75 }),
  Object.freeze({ x: 7.5, z: -4.75 }),
  Object.freeze({ x: 4, z: -1.6 }),
  Object.freeze({ x: 7.5, z: -1.6 }),
  Object.freeze({ x: 4, z: 1.6 }),
  Object.freeze({ x: 7.5, z: 1.6 }),
  Object.freeze({ x: 4, z: 4.75 }),
  Object.freeze({ x: 7.5, z: 4.75 }),
]);

const VISUAL_SIZES = Object.freeze({
  "resistor": Object.freeze([1.8, 0.8]),
  "led": Object.freeze([1.2, 1.2]),
  "rgb-led": Object.freeze([1.5, 1.5]),
  "button": Object.freeze([1.5, 1.5]),
  "potentiometer": Object.freeze([1.8, 1.8]),
  "photoresistor": Object.freeze([1.8, 1.4]),
  "force-sensor": Object.freeze([1.8, 1.4]),
  "temperature-sensor": Object.freeze([1.6, 1.3]),
  "soil-sensor": Object.freeze([2.2, 1.5]),
  "ultrasonic-sensor": Object.freeze([2.6, 1.6]),
  "buzzer": Object.freeze([1.5, 1.5]),
  "driver": Object.freeze([2.6, 2.0]),
  "servo": Object.freeze([2.4, 1.8]),
  "power-source": Object.freeze([2.5, 1.7]),
  "generic-component": Object.freeze([2.0, 1.5]),
});

function freezeArray(items) {
  return Object.freeze(items.map(item => Object.freeze(item)));
}

function assertLessonId(lessonId) {
  const id = Number(lessonId);
  if (!Number.isInteger(id) || id < LAB_LAYOUT_LIMITS.minLessonId || id > LAB_LAYOUT_LIMITS.maxLessonId) {
    throw new RangeError("lessonId phải là số nguyên trong khoảng 2..16.");
  }
  return id;
}

function normalizeTerminal(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError(`terminal[${index}] phải là object.`);
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const kind = typeof raw.kind === "string" ? raw.kind.trim() : "";
  const component = typeof raw.component === "string" ? raw.component.trim() : "";
  if (!id || !label || !kind || !component) {
    throw new TypeError(`terminal[${index}] thiếu id/label/kind/component hợp lệ.`);
  }
  if (id.length > 80 || label.length > 180 || kind.length > 48 || component.length > 80) {
    throw new RangeError(`terminal[${index}] vượt giới hạn độ dài metadata.`);
  }
  const polarity = raw.polarity == null ? null : String(raw.polarity);
  return Object.freeze({ id, label, kind, component, polarity });
}

function normalizeTerminals(terminals) {
  if (!Array.isArray(terminals) || terminals.length === 0) {
    throw new TypeError("terminals phải là mảng listTerminals() không rỗng.");
  }
  if (terminals.length > LAB_LAYOUT_LIMITS.maxTerminals) {
    throw new RangeError(`terminals vượt giới hạn ${LAB_LAYOUT_LIMITS.maxTerminals}.`);
  }
  const result = terminals.map(normalizeTerminal);
  const ids = new Set();
  for (const terminal of result) {
    if (ids.has(terminal.id)) throw new RangeError(`terminal id bị trùng: ${terminal.id}.`);
    ids.add(terminal.id);
  }
  if (!result.some(terminal => terminal.component === "arduino")) {
    throw new RangeError("terminals phải chứa terminal thuộc component 'arduino'.");
  }
  return Object.freeze(result);
}

function inferVisualKind(componentId, terminals) {
  const id = componentId.toUpperCase();
  if (id === "RGB") return "rgb-led";
  if (id === "LED") return "led";
  if (/^R(?:_|\d|$)/.test(id)) return "resistor";
  if (id === "POT") return "potentiometer";
  if (id === "LDR") return "photoresistor";
  if (id === "FSR") return "force-sensor";
  if (id === "LM35") return "temperature-sensor";
  if (id === "SOIL") return "soil-sensor";
  if (id === "SONAR") return "ultrasonic-sensor";
  if (id === "BUZZ") return "buzzer";
  if (id === "SERVO") return "servo";
  if (id === "DRV" || id === "PUMP") return "driver";
  if (id === "SUPPLY" || id.endsWith("_SUPPLY")) return "power-source";
  if (id === "BTN" || id.startsWith("KEY")) return "button";
  const kinds = new Set(terminals.map(terminal => terminal.kind));
  if (kinds.has("button")) return "button";
  if (kinds.has("buzzer")) return "buzzer";
  if (kinds.has("led")) return "led";
  if (kinds.has("rgb")) return "rgb-led";
  return "generic-component";
}

function componentLabel(componentId, terminals) {
  const first = terminals[0]?.label || componentId;
  const beforeSeparator = first.split(" · ")[0].trim();
  return beforeSeparator.replace(/\s*\([+−-]\)\s*$/, "").trim() || componentId;
}

function visualSize(kind) {
  const size = VISUAL_SIZES[kind] || VISUAL_SIZES["generic-component"];
  return { width: size[0], depth: size[1] };
}

function effectiveSize(component, quarterTurns = component.quarterTurns) {
  return quarterTurns % 2 === 0
    ? { width: component.width, depth: component.depth }
    : { width: component.depth, depth: component.width };
}

function overlapsAt(a, ax, az, aq, b) {
  const as = effectiveSize(a, aq);
  const bs = effectiveSize(b);
  const xLimit = (as.width + bs.width) / 2 + LAB_LAYOUT_LIMITS.componentGap;
  const zLimit = (as.depth + bs.depth) / 2 + LAB_LAYOUT_LIMITS.componentGap;
  return Math.abs(ax - b.x) < xLimit - EPSILON && Math.abs(az - b.z) < zLimit - EPSILON;
}

function insideBounds(component, x, z, quarterTurns = component.quarterTurns) {
  const size = effectiveSize(component, quarterTurns);
  const { minX, maxX, minZ, maxZ } = LAB_LAYOUT_LIMITS.bounds;
  return x - size.width / 2 >= minX - EPSILON &&
    x + size.width / 2 <= maxX + EPSILON &&
    z - size.depth / 2 >= minZ - EPSILON &&
    z + size.depth / 2 <= maxZ + EPSILON;
}

function isSnapped(value) {
  const grid = LAB_LAYOUT_LIMITS.grid;
  return Math.abs(value / grid - Math.round(value / grid)) <= EPSILON;
}

function snapped(value) {
  if (!Number.isFinite(value)) throw new TypeError("Tọa độ layout phải là số hữu hạn.");
  return Math.round(value / LAB_LAYOUT_LIMITS.grid) * LAB_LAYOUT_LIMITS.grid;
}

function candidateGrid(component, targetX, targetZ, quarterTurns, others) {
  const candidates = [];
  const { minX, maxX, minZ, maxZ } = LAB_LAYOUT_LIMITS.bounds;
  const grid = LAB_LAYOUT_LIMITS.grid;
  const tx = snapped(targetX);
  const tz = snapped(targetZ);
  for (let x = minX; x <= maxX + EPSILON; x += grid) {
    for (let z = minZ; z <= maxZ + EPSILON; z += grid) {
      if (!insideBounds(component, x, z, quarterTurns)) continue;
      if (others.some(other => overlapsAt(component, x, z, quarterTurns, other))) continue;
      const dx = x - tx;
      const dz = z - tz;
      candidates.push({ x, z, distance2: dx * dx + dz * dz });
    }
  }
  candidates.sort((a, b) => a.distance2 - b.distance2 || a.x - b.x || a.z - b.z);
  if (!candidates.length) throw new RangeError(`Không còn vị trí không chồng lấn cho component ${component.id}.`);
  return candidates[0];
}

function freezeComponent(component) {
  return Object.freeze({
    ...component,
    terminalIds: Object.freeze([...component.terminalIds]),
  });
}

function freezeLayout(layout) {
  const terminalMap = {};
  for (const [id, value] of Object.entries(layout.terminalMap)) terminalMap[id] = Object.freeze({ ...value });
  return Object.freeze({
    ...layout,
    bounds: Object.freeze({ ...layout.bounds }),
    claims: Object.freeze({ ...layout.claims }),
    components: Object.freeze(layout.components.map(freezeComponent)),
    terminals: Object.freeze(layout.terminals.map(terminal => Object.freeze({ ...terminal }))),
    terminalMap: Object.freeze(terminalMap),
  });
}

function makeComponent(base, terminalIds) {
  return {
    ...base,
    terminalIds: [...terminalIds],
    anchorModel: ANCHOR_MODEL,
  };
}

function componentGroups(terminals) {
  const groups = new Map();
  for (const terminal of terminals) {
    if (terminal.component === "arduino") continue;
    if (!groups.has(terminal.component)) groups.set(terminal.component, []);
    groups.get(terminal.component).push(terminal);
  }
  if (groups.size > LAB_LAYOUT_LIMITS.maxNetlistComponents) {
    throw new RangeError(`Số component netlist vượt giới hạn ${LAB_LAYOUT_LIMITS.maxNetlistComponents}.`);
  }
  return groups;
}

function makeTerminalMap(terminals, components) {
  const byComponent = new Map(components.map(component => [component.id, component]));
  const result = {};
  for (const terminal of terminals) {
    const component = byComponent.get(terminal.component);
    if (!component) throw new Error(`Không có component cho terminal ${terminal.id}.`);
    const slotIndex = component.terminalIds.indexOf(terminal.id);
    result[terminal.id] = {
      terminalId: terminal.id,
      componentId: terminal.component,
      label: terminal.label,
      kind: terminal.kind,
      polarity: terminal.polarity,
      slotIndex,
      slotCount: component.terminalIds.length,
      anchorModel: ANCHOR_MODEL,
      physicalVerified: false,
    };
  }
  return result;
}

function createInitialComponents(terminals) {
  const arduinoTerminals = terminals.filter(terminal => terminal.component === "arduino").map(terminal => terminal.id);
  const components = [
    makeComponent(BOARD, arduinoTerminals),
    makeComponent(BREADBOARD, []),
  ];
  const groups = componentGroups(terminals);
  let index = 0;
  for (const [componentId, group] of groups) {
    const visualKind = inferVisualKind(componentId, group);
    const { width, depth } = visualSize(visualKind);
    const terminalIds = group.map(terminal => terminal.id);
    const preferred = PREFERRED_COMPONENT_SLOTS[index] || { x: 5.5, z: 0 };
    const draft = makeComponent({
      id: componentId,
      visualKind,
      label: componentLabel(componentId, group),
      fixed: false,
      x: preferred.x,
      z: preferred.z,
      quarterTurns: 0,
      width,
      depth,
    }, terminalIds);
    const position = candidateGrid(draft, preferred.x, preferred.z, 0, components);
    draft.x = position.x;
    draft.z = position.z;
    components.push(draft);
    index += 1;
  }
  return components;
}

export function createLabLayout(lessonId, terminals) {
  const id = assertLessonId(lessonId);
  const normalized = normalizeTerminals(terminals);
  const components = createInitialComponents(normalized);
  const layout = freezeLayout({
    version: VERSION,
    mode: MODE,
    lessonId: id,
    units: "logical-grid",
    grid: LAB_LAYOUT_LIMITS.grid,
    bounds: LAB_LAYOUT_LIMITS.bounds,
    claims: {
      physicalVerified: false,
      breadboardHoleMapping: false,
      electricalPower: false,
    },
    components,
    terminals: normalized,
    terminalMap: makeTerminalMap(normalized, components),
  });
  const validation = validateLabLayout(layout, normalized);
  if (!validation.ok) throw new Error(`Không thể tạo lab layout hợp lệ: ${validation.errors.join("; ")}`);
  return layout;
}

function componentById(layout, componentId) {
  if (typeof componentId !== "string" || !componentId) throw new TypeError("componentId phải là chuỗi không rỗng.");
  const component = layout.components.find(item => item.id === componentId);
  if (!component) throw new RangeError(`Không có component ${componentId} trong layout.`);
  return component;
}

function assertUsableLayout(layout) {
  const validation = validateLabLayout(layout, layout?.terminals);
  if (!validation.ok) throw new RangeError(`layout không hợp lệ: ${validation.errors.join("; ")}`);
}

function replaceComponent(layout, componentId, quarterTurns, x, z) {
  const components = layout.components.map(component => component.id === componentId
    ? { ...component, quarterTurns, x, z, terminalIds: [...component.terminalIds] }
    : { ...component, terminalIds: [...component.terminalIds] });
  return freezeLayout({ ...layout, components, terminals: layout.terminals, terminalMap: layout.terminalMap });
}

export function moveLabComponent(layout, componentId, x, z) {
  assertUsableLayout(layout);
  const component = componentById(layout, componentId);
  if (component.fixed) throw new RangeError(`Component ${componentId} là fixed và không thể di chuyển.`);
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError("x/z phải là số hữu hạn.");
  const others = layout.components.filter(item => item.id !== componentId);
  const position = candidateGrid(component, x, z, component.quarterTurns, others);
  return replaceComponent(layout, componentId, component.quarterTurns, position.x, position.z);
}

export function rotateLabComponent(layout, componentId, quarterTurns = 1) {
  assertUsableLayout(layout);
  const component = componentById(layout, componentId);
  if (component.fixed) throw new RangeError(`Component ${componentId} là fixed và không thể xoay.`);
  if (!Number.isInteger(quarterTurns)) throw new TypeError("quarterTurns phải là số nguyên.");
  const rotation = ((component.quarterTurns + quarterTurns) % 4 + 4) % 4;
  const others = layout.components.filter(item => item.id !== componentId);
  const position = candidateGrid(component, component.x, component.z, rotation, others);
  return replaceComponent(layout, componentId, rotation, position.x, position.z);
}

function perimeterLocalAnchor(component, slotIndex, slotCount) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount || slotCount < 1) {
    throw new RangeError("Terminal slot metadata không hợp lệ.");
  }
  const width = component.width + 0.3;
  const depth = component.depth + 0.3;
  const perimeter = 2 * (width + depth);
  let distance = ((slotIndex + 0.5) / slotCount) * perimeter;
  const halfW = width / 2;
  const halfD = depth / 2;
  if (distance <= width) return { x: -halfW + distance, z: -halfD };
  distance -= width;
  if (distance <= depth) return { x: halfW, z: -halfD + distance };
  distance -= depth;
  if (distance <= width) return { x: halfW - distance, z: halfD };
  distance -= width;
  return { x: -halfW, z: halfD - distance };
}

function rotateLocal(local, quarterTurns) {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1: return { x: -local.z, z: local.x };
    case 2: return { x: -local.x, z: -local.z };
    case 3: return { x: local.z, z: -local.x };
    default: return { x: local.x, z: local.z };
  }
}

function cleanCoordinate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function labTerminalAnchor(layout, terminalId) {
  assertUsableLayout(layout);
  if (typeof terminalId !== "string" || !terminalId) throw new TypeError("terminalId phải là chuỗi không rỗng.");
  const mapping = layout.terminalMap[terminalId];
  if (!mapping) throw new RangeError(`Không có terminal ${terminalId} trong layout.`);
  const component = componentById(layout, mapping.componentId);
  const local = perimeterLocalAnchor(component, mapping.slotIndex, mapping.slotCount);
  const rotated = rotateLocal(local, component.quarterTurns);
  return Object.freeze({
    terminalId: mapping.terminalId,
    componentId: mapping.componentId,
    label: mapping.label,
    kind: mapping.kind,
    polarity: mapping.polarity,
    x: cleanCoordinate(component.x + rotated.x),
    y: 0,
    z: cleanCoordinate(component.z + rotated.z),
    anchorModel: ANCHOR_MODEL,
    physicalVerified: false,
  });
}

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function validateLabLayout(layout, terminals) {
  const errors = [];
  const warnings = [];
  let normalized = null;
  try {
    normalized = normalizeTerminals(terminals);
  } catch (error) {
    errors.push(`terminals: ${error.message}`);
  }

  addError(errors, !!layout && typeof layout === "object" && !Array.isArray(layout), "layout phải là object.");
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors), warnings: Object.freeze(warnings), stats: Object.freeze({ components: 0, netlistComponents: 0, terminals: 0 }) });
  }

  addError(errors, layout.version === VERSION, `layout.version phải là ${VERSION}.`);
  addError(errors, layout.mode === MODE, `layout.mode phải là '${MODE}'.`);
  addError(errors, Number.isInteger(layout.lessonId) && layout.lessonId >= 2 && layout.lessonId <= 16, "layout.lessonId ngoài 2..16.");
  addError(errors, layout.units === "logical-grid", "layout.units phải là 'logical-grid'.");
  addError(errors, layout.grid === LAB_LAYOUT_LIMITS.grid, `layout.grid phải là ${LAB_LAYOUT_LIMITS.grid}.`);
  addError(errors, layout.claims?.physicalVerified === false, "layout không được claim physicalVerified.");
  addError(errors, layout.claims?.breadboardHoleMapping === false, "layout không được claim breadboard-hole mapping.");
  addError(errors, layout.claims?.electricalPower === false, "layout không được claim electrical power.");

  const components = Array.isArray(layout.components) ? layout.components : [];
  addError(errors, Array.isArray(layout.components), "layout.components phải là array.");
  const componentIds = new Set();
  for (const component of components) {
    if (!component || typeof component !== "object") {
      errors.push("component phải là object.");
      continue;
    }
    if (componentIds.has(component.id)) errors.push(`component id bị trùng: ${component.id}.`);
    componentIds.add(component.id);
    addError(errors, typeof component.id === "string" && !!component.id, "component.id không hợp lệ.");
    addError(errors, Number.isFinite(component.x) && Number.isFinite(component.z), `component ${component.id} có tọa độ không hữu hạn.`);
    addError(errors, isSnapped(component.x) && isSnapped(component.z), `component ${component.id} không snap grid.`);
    addError(errors, Number.isInteger(component.quarterTurns) && component.quarterTurns >= 0 && component.quarterTurns <= 3, `component ${component.id} có rotation không hợp lệ.`);
    addError(errors, Number.isFinite(component.width) && component.width > 0 && Number.isFinite(component.depth) && component.depth > 0, `component ${component.id} có footprint không hợp lệ.`);
    addError(errors, Array.isArray(component.terminalIds), `component ${component.id} thiếu terminalIds.`);
    addError(errors, component.anchorModel === ANCHOR_MODEL, `component ${component.id} dùng anchor model không hợp lệ.`);
    if (Number.isFinite(component.x) && Number.isFinite(component.z) && Number.isFinite(component.width) && Number.isFinite(component.depth)) {
      addError(errors, insideBounds(component, component.x, component.z), `component ${component.id} nằm ngoài bounds.`);
    }
  }

  const arduino = components.find(component => component?.id === "arduino");
  const breadboard = components.find(component => component?.id === "breadboard");
  addError(errors, !!arduino, "layout thiếu Arduino Uno component.");
  addError(errors, arduino?.fixed === true, "Arduino Uno phải fixed.");
  addError(errors, !!breadboard, "layout thiếu breadboard component.");
  addError(errors, breadboard?.fixed === false, "breadboard phải movable.");
  addError(errors, Array.isArray(breadboard?.terminalIds) && breadboard.terminalIds.length === 0, "breadboard không được gán terminal/hole giả.");

  for (let i = 0; i < components.length; i += 1) {
    const a = components[i];
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
    for (let j = i + 1; j < components.length; j += 1) {
      const b = components[j];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      if (overlapsAt(a, a.x, a.z, a.quarterTurns, b)) errors.push(`components chồng lấn: ${a.id}/${b.id}.`);
    }
  }

  if (normalized) {
    const terminalIds = new Set(normalized.map(terminal => terminal.id));
    const layoutTerminalIds = new Set(Array.isArray(layout.terminals) ? layout.terminals.map(terminal => terminal?.id) : []);
    addError(errors, layoutTerminalIds.size === normalized.length && normalized.every(terminal => layoutTerminalIds.has(terminal.id)), "layout.terminals không khớp input terminals.");

    const expectedGroups = new Map();
    for (const terminal of normalized) {
      if (!expectedGroups.has(terminal.component)) expectedGroups.set(terminal.component, []);
      expectedGroups.get(terminal.component).push(terminal.id);
      const mapping = layout.terminalMap?.[terminal.id];
      addError(errors, !!mapping, `terminalMap thiếu ${terminal.id}.`);
      if (mapping) {
        addError(errors, mapping.componentId === terminal.component, `terminal ${terminal.id} map sai component.`);
        addError(errors, mapping.terminalId === terminal.id, `terminalMap key/id lệch ở ${terminal.id}.`);
        addError(errors, mapping.physicalVerified === false, `terminal ${terminal.id} không được claim physical mapping.`);
      }
    }
    if (layout.terminalMap && typeof layout.terminalMap === "object") {
      for (const key of Object.keys(layout.terminalMap)) {
        if (!terminalIds.has(key)) errors.push(`terminalMap chứa terminal lạ: ${key}.`);
      }
    }
    for (const [componentId, ids] of expectedGroups) {
      const component = components.find(item => item?.id === componentId);
      addError(errors, !!component, `thiếu component netlist ${componentId}.`);
      if (component) {
        const actual = Array.isArray(component.terminalIds) ? component.terminalIds : [];
        addError(errors, actual.length === ids.length && ids.every(id => actual.includes(id)), `component ${componentId} không map đủ terminal.`);
      }
    }
    const expectedComponentCount = expectedGroups.size + 1; // + conceptual breadboard
    addError(errors, components.length === expectedComponentCount, "layout có thừa/thiếu visual component group.");
  }

  const stats = Object.freeze({
    components: components.length,
    netlistComponents: Math.max(0, components.length - 2),
    terminals: normalized?.length || 0,
  });
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    stats,
  });
}
