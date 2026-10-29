/**
 * Read-only derivation model for the v1.6 lab explorer.
 *
 * The explorer never owns electrical or placement state. It projects the
 * canonical circuit-router/listTerminals data and the conceptual lab-layout
 * into inspector/schematic/minimap views. All mutation remains outside this
 * module and is delegated by lab-explorer-ui callbacks.
 */
import { listTerminals } from "./circuit-router.js";
import { labTerminalAnchor, validateLabLayout } from "./lab-layout.js";

export const LAB_EXPLORER_LIMITS = Object.freeze({
  minLessonId: 1,
  maxLessonId: 16,
  maxTerminals: 32,
  maxWires: 48,
  maxComponents: 20,
  maxIssues: 96,
  schematicRowsPerColumn: 4,
});

const SOURCE_LABELS = Object.freeze({
  "learner-empty": "Bản tự đấu · chưa có dây",
  "learner-draft": "Bản tự đấu của người học",
  none: "Không có netlist ngoài",
});

const SEVERITY_RANK = Object.freeze({ info: 1, warning: 2, error: 3 });

function freezeObject(value) {
  return Object.freeze(value);
}

function freezeArray(values) {
  return Object.freeze(values.map(value => freezeObject(value)));
}

function requireLessonId(value) {
  const lessonId = Number(value);
  if (!Number.isInteger(lessonId) || lessonId < 1 || lessonId > 16) {
    throw new RangeError("Lab explorer lessonId phải là số nguyên 1..16.");
  }
  return lessonId;
}

function stringOr(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeSource(snapshot, lessonId) {
  if (lessonId === 1) {
    return freezeObject({
      kind: "none",
      label: SOURCE_LABELS.none,
      learnerWireCount: 0,
      referenceWireCount: 0,
      physicalVerified: false,
    });
  }
  const evidenceOrigin = snapshot?.evidence?.origin;
  const requested = snapshot?.source ?? evidenceOrigin;
  const kind = requested === "learner-draft" || requested === "learner-empty"
    ? requested
    : snapshot?.hasLearnerDraft ? "learner-draft" : "learner-empty";
  if (snapshot?.evidence?.physicalVerified === true || snapshot?.claims?.physicalVerified === true) {
    throw new RangeError("Explorer từ chối snapshot tự nhận physicalVerified=true.");
  }
  return freezeObject({
    kind,
    label: SOURCE_LABELS[kind],
    learnerWireCount: Array.isArray(snapshot?.circuit?.wires) ? snapshot.circuit.wires.length : 0,
    referenceWireCount: Array.isArray(snapshot?.referenceCircuit?.wires) ? snapshot.referenceCircuit.wires.length : 0,
    physicalVerified: false,
  });
}

function terminalGroups(terminals) {
  const groups = new Map();
  for (const terminal of terminals) {
    if (!groups.has(terminal.component)) groups.set(terminal.component, []);
    groups.get(terminal.component).push(terminal);
  }
  if (groups.size > LAB_EXPLORER_LIMITS.maxComponents) {
    throw new RangeError("Explorer vượt giới hạn component hiển thị.");
  }
  return groups;
}

function normalizeCircuit(circuit, lessonId, terminalIds, label) {
  if (!circuit || typeof circuit !== "object" || Array.isArray(circuit)) {
    throw new TypeError(`${label} phải là circuit object.`);
  }
  if (Number(circuit.lessonId) !== lessonId || !Array.isArray(circuit.wires)) {
    throw new RangeError(`${label} không thuộc lesson hoặc thiếu wires.`);
  }
  if (circuit.wires.length > LAB_EXPLORER_LIMITS.maxWires) {
    throw new RangeError(`${label} vượt giới hạn wire hiển thị.`);
  }
  const seenIds = new Set();
  const edges = new Set();
  return freezeArray(circuit.wires.map((wire, index) => {
    if (!wire || typeof wire !== "object") throw new TypeError(`${label}.wires[${index}] không hợp lệ.`);
    const id = stringOr(wire.id).trim();
    const from = stringOr(wire.from).trim();
    const to = stringOr(wire.to).trim();
    if (!id || !from || !to || from === to || !terminalIds.has(from) || !terminalIds.has(to)) {
      throw new RangeError(`${label}.wires[${index}] dùng ID/terminal không hợp lệ.`);
    }
    if (seenIds.has(id)) throw new RangeError(`${label} có wire id trùng ${id}.`);
    seenIds.add(id);
    const edge = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    if (edges.has(edge)) throw new RangeError(`${label} có wire endpoint trùng.`);
    edges.add(edge);
    return { id, from, to };
  }));
}

function normalizeIssues(analysis, lessonId, terminalIds) {
  if (!analysis) return freezeArray([]);
  if (Number.isInteger(analysis.lessonId) && analysis.lessonId !== lessonId) {
    throw new RangeError("analysis thuộc lesson khác.");
  }
  const source = Array.isArray(analysis.issues) ? analysis.issues : [];
  if (source.length > LAB_EXPLORER_LIMITS.maxIssues) throw new RangeError("Explorer vượt giới hạn issue hiển thị.");
  return freezeArray(source.map((issue, index) => {
    const severity = ["error", "warning", "info"].includes(issue?.severity) ? issue.severity : "info";
    const ids = Array.isArray(issue?.terminals)
      ? issue.terminals.filter(id => typeof id === "string" && terminalIds.has(id))
      : [];
    return {
      code: stringOr(issue?.code, `ISSUE_${index + 1}`),
      severity,
      message: stringOr(issue?.message, "Có cảnh báo topology trong checker bài học."),
      terminals: Object.freeze([...ids]),
    };
  }));
}

function worstSeverity(issues, terminalId = null) {
  let result = null;
  let rank = 0;
  for (const issue of issues) {
    if (terminalId !== null && !issue.terminals.includes(terminalId)) continue;
    const candidate = SEVERITY_RANK[issue.severity] ?? 0;
    if (candidate > rank) {
      rank = candidate;
      result = issue.severity;
    }
  }
  return result;
}

function schematicGeometry(terminals) {
  const groups = terminalGroups(terminals);
  const rowsPerColumn = LAB_EXPLORER_LIMITS.schematicRowsPerColumn;
  const nodeWidth = 168;
  const columnWidth = 224;
  const rowHeight = 226;
  const startX = 46;
  const startY = 42;
  const components = [];
  const terminalPositions = new Map();
  let index = 0;
  for (const [componentId, group] of groups) {
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    const terminalCount = group.length;
    const height = Math.max(76, 44 + terminalCount * 18);
    const x = startX + column * columnWidth;
    const y = startY + row * rowHeight;
    const component = {
      id: componentId,
      label: group[0]?.label?.split(" · ")[0] || componentId,
      x,
      y,
      width: nodeWidth,
      height,
      terminalIds: Object.freeze(group.map(terminal => terminal.id)),
    };
    components.push(component);
    group.forEach((terminal, terminalIndex) => {
      const sideRight = terminalIndex % 2 === 1;
      const sideIndex = Math.floor(terminalIndex / 2);
      const sideCount = Math.ceil(terminalCount / 2);
      const anchorY = y + 32 + ((sideIndex + 1) * Math.max(24, height - 36)) / (sideCount + 1);
      terminalPositions.set(terminal.id, freezeObject({
        terminalId: terminal.id,
        componentId,
        x: sideRight ? x + nodeWidth : x,
        y: anchorY,
        side: sideRight ? "right" : "left",
      }));
    });
    index += 1;
  }
  const columns = Math.max(1, Math.ceil(components.length / rowsPerColumn));
  const rows = Math.min(rowsPerColumn, Math.max(1, components.length));
  return {
    components: freezeArray(components),
    terminalPositions,
    viewBox: freezeObject({
      x: 0,
      y: 0,
      width: startX * 2 + (columns - 1) * columnWidth + nodeWidth,
      height: startY * 2 + (rows - 1) * rowHeight + 196,
    }),
  };
}

function buildSchematic(terminals, wires, referenceWires, issues, analysis, source, editing, selectedTerminalId) {
  const geometry = schematicGeometry(terminals);
  const terminalById = new Map(terminals.map(terminal => [terminal.id, terminal]));
  const terminalsView = freezeArray(terminals.map(terminal => {
    const position = geometry.terminalPositions.get(terminal.id);
    return {
      ...terminal,
      x: position.x,
      y: position.y,
      side: position.side,
      selected: terminal.id === selectedTerminalId,
      issueSeverity: worstSeverity(issues, terminal.id),
    };
  }));
  const wiresView = freezeArray(wires.map(wire => {
    const from = geometry.terminalPositions.get(wire.from);
    const to = geometry.terminalPositions.get(wire.to);
    const related = issues.filter(issue => issue.terminals.includes(wire.from) || issue.terminals.includes(wire.to));
    return {
      ...wire,
      fromLabel: terminalById.get(wire.from)?.label ?? wire.from,
      toLabel: terminalById.get(wire.to)?.label ?? wire.to,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      issueSeverity: worstSeverity(related),
      editable: source.kind === "learner-draft" && Boolean(editing),
    };
  }));
  const referenceWiresView = freezeArray(referenceWires.map(wire => {
    const from = geometry.terminalPositions.get(wire.from);
    const to = geometry.terminalPositions.get(wire.to);
    return {
      ...wire,
      fromLabel: terminalById.get(wire.from)?.label ?? wire.from,
      toLabel: terminalById.get(wire.to)?.label ?? wire.to,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      editable: false,
      referenceOnly: true,
    };
  }));
  const scope = analysis?.scope === "signal-only" ? "signal-only" : "topology";
  return freezeObject({
    mode: "conceptual-schematic",
    source: source.kind,
    scope,
    signalOnly: scope === "signal-only",
    selectedTerminalId,
    editableConnections: Boolean(editing),
    editableWireDeletion: source.kind === "learner-draft" && Boolean(editing),
    components: geometry.components,
    terminals: terminalsView,
    wires: wiresView,
    referenceWires: referenceWiresView,
    issues,
    viewBox: geometry.viewBox,
    physicalVerified: false,
    electricalFlow: false,
  });
}

function normalizeLayout(layout, lessonId, terminals) {
  if (layout == null) return null;
  if (layout?.lessonId !== lessonId) throw new RangeError("layout explorer thuộc lesson khác.");
  if (layout?.claims?.physicalVerified === true || layout?.claims?.breadboardHoleMapping === true || layout?.claims?.electricalPower === true) {
    throw new RangeError("Explorer từ chối layout có physical/electrical claim.");
  }
  const report = validateLabLayout(layout, terminals);
  if (!report.ok) throw new RangeError("layout explorer không hợp lệ: " + report.errors.join("; "));
  return layout;
}

function mapCoordinate(value, min, max, span) {
  if (max <= min) return span / 2;
  return ((value - min) / (max - min)) * span;
}

function buildMinimap(layout, terminals, selectedComponentId, selectedTerminalId, sceneView) {
  if (!layout) {
    return freezeObject({
      mode: "none",
      available: false,
      components: freezeArray([]),
      terminals: freezeArray([]),
      selectedComponentId: null,
      selectedTerminalId: null,
      focusedComponentId: null,
      physicalVerified: false,
    });
  }
  const width = 100;
  const height = 70;
  const bounds = layout.bounds;
  const components = freezeArray(layout.components.map(component => {
    const rotated = component.quarterTurns % 2 !== 0;
    const logicalWidth = rotated ? component.depth : component.width;
    const logicalDepth = rotated ? component.width : component.depth;
    return {
      id: component.id,
      label: component.label,
      visualKind: component.visualKind,
      fixed: component.fixed,
      x: mapCoordinate(component.x, bounds.minX, bounds.maxX, width),
      y: mapCoordinate(component.z, bounds.minZ, bounds.maxZ, height),
      width: Math.max(2, logicalWidth / (bounds.maxX - bounds.minX) * width),
      height: Math.max(2, logicalDepth / (bounds.maxZ - bounds.minZ) * height),
      logicalX: component.x,
      logicalZ: component.z,
      quarterTurns: component.quarterTurns,
      terminalIds: Object.freeze([...component.terminalIds]),
    };
  }));
  const terminalsView = freezeArray(terminals.map(terminal => {
    const anchor = labTerminalAnchor(layout, terminal.id);
    return {
      terminalId: terminal.id,
      componentId: terminal.component,
      label: terminal.label,
      kind: terminal.kind,
      polarity: terminal.polarity,
      x: mapCoordinate(anchor.x, bounds.minX, bounds.maxX, width),
      y: mapCoordinate(anchor.z, bounds.minZ, bounds.maxZ, height),
      logicalX: anchor.x,
      logicalZ: anchor.z,
      selected: terminal.id === selectedTerminalId,
      physicalVerified: false,
    };
  }));
  const focused = typeof sceneView?.focusedComponentId === "string" ? sceneView.focusedComponentId : null;
  return freezeObject({
    mode: "logical-plan",
    available: true,
    width,
    height,
    bounds: freezeObject({ ...bounds }),
    components,
    terminals: terminalsView,
    selectedComponentId: components.some(component => component.id === selectedComponentId) ? selectedComponentId : null,
    selectedTerminalId: terminalsView.some(terminal => terminal.terminalId === selectedTerminalId) ? selectedTerminalId : null,
    focusedComponentId: components.some(component => component.id === focused) ? focused : null,
    physicalVerified: false,
    breadboardHoleMapping: false,
    electricalFlow: false,
  });
}

function buildInspector(layout, terminals, selectedComponentId, selectedTerminalId, issues, source) {
  if (!layout || typeof selectedComponentId !== "string") {
    return freezeObject({
      selectedComponentId: null,
      component: null,
      terminals: freezeArray([]),
      selectedTerminalId: null,
      issues: freezeArray([]),
      source,
    });
  }
  const component = layout.components.find(item => item.id === selectedComponentId);
  if (!component) {
    return freezeObject({
      selectedComponentId: null,
      component: null,
      terminals: freezeArray([]),
      selectedTerminalId: null,
      issues: freezeArray([]),
      source,
    });
  }
  const selectedTerminals = terminals.filter(terminal => terminal.component === component.id);
  const selectedTerminalIds = new Set(selectedTerminals.map(terminal => terminal.id));
  const selectedIssues = issues.filter(issue => issue.terminals.length === 0 || issue.terminals.some(id => selectedTerminalIds.has(id)));
  return freezeObject({
    selectedComponentId: component.id,
    component: freezeObject({
      id: component.id,
      label: component.label,
      visualKind: component.visualKind,
      fixed: component.fixed,
      x: component.x,
      z: component.z,
      quarterTurns: component.quarterTurns,
      width: component.width,
      depth: component.depth,
      anchorModel: component.anchorModel,
      physicalVerified: false,
    }),
    terminals: freezeArray(selectedTerminals.map(terminal => ({
      ...terminal,
      selected: terminal.id === selectedTerminalId,
      issueSeverity: worstSeverity(issues, terminal.id),
    }))),
    selectedTerminalId: selectedTerminalIds.has(selectedTerminalId) ? selectedTerminalId : null,
    issues: freezeArray(selectedIssues.map(issue => ({ ...issue, terminals: Object.freeze([...issue.terminals]) }))),
    source,
  });
}

export function createLabExplorerModel(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Lab explorer snapshot phải là object.");
  }
  const lessonId = requireLessonId(snapshot.lessonId);
  const lesson = snapshot.lesson && typeof snapshot.lesson === "object" ? snapshot.lesson : null;
  const source = normalizeSource(snapshot, lessonId);

  if (lessonId === 1) {
    return freezeObject({
      schemaVersion: 1,
      lessonId,
      lessonTitle: stringOr(lesson?.title, "Làm quen với Arduino Uno R3"),
      supported: false,
      stage: stringOr(snapshot.stage, "3d"),
      editing: false,
      selectedTerminalId: null,
      source,
      inspector: buildInspector(null, [], null, null, [], source),
      schematic: freezeObject({
        mode: "none",
        source: "none",
        scope: "none",
        signalOnly: false,
        selectedTerminalId: null,
        editableConnections: false,
        editableWireDeletion: false,
        components: freezeArray([]),
        terminals: freezeArray([]),
        wires: freezeArray([]),
        referenceWires: freezeArray([]),
        issues: freezeArray([]),
        viewBox: freezeObject({ x: 0, y: 0, width: 100, height: 60 }),
        physicalVerified: false,
        electricalFlow: false,
      }),
      minimap: buildMinimap(null, [], null, null, snapshot.sceneView),
      reference: freezeObject({ available: false, wireCount: 0, label: "Bài 01 dùng LED L tích hợp, không có netlist ngoài." }),
      boundaries: freezeObject({
        conceptualOnly: true,
        physicalVerified: false,
        breadboardHoleMapping: false,
        electricalFlow: false,
        physicalSafety: false,
        schematicOwnsCircuit: false,
      }),
    });
  }

  const terminals = listTerminals(lessonId);
  if (!Array.isArray(terminals) || terminals.length === 0 || terminals.length > LAB_EXPLORER_LIMITS.maxTerminals) {
    throw new RangeError("Lesson explorer không có terminal canonical hợp lệ.");
  }
  const terminalIds = new Set(terminals.map(terminal => terminal.id));
  if (terminalIds.size !== terminals.length) throw new RangeError("Terminal canonical bị trùng ID.");
  const learnerWires = normalizeCircuit(snapshot.circuit, lessonId, terminalIds, "circuit");
  const referenceWires = snapshot.referenceCircuit
    ? normalizeCircuit(snapshot.referenceCircuit, lessonId, terminalIds, "referenceCircuit")
    : freezeArray([]);
  const issues = normalizeIssues(snapshot.analysis, lessonId, terminalIds);
  const layout = normalizeLayout(snapshot.layout, lessonId, terminals);
  const selectedComponentId = typeof snapshot.selectedComponentId === "string"
    ? snapshot.selectedComponentId
    : null;
  let selectedTerminalId = null;
  if (snapshot.selectedTerminalId != null) {
    if (typeof snapshot.selectedTerminalId !== "string" || !snapshot.selectedTerminalId.trim()) {
      throw new TypeError("selectedTerminalId phải là exact terminal ID hoặc null.");
    }
    selectedTerminalId = snapshot.selectedTerminalId.trim();
    if (!terminalIds.has(selectedTerminalId)) {
      throw new RangeError("selectedTerminalId không thuộc terminal canonical của lesson.");
    }
  }
  const editing = Boolean(snapshot.editing);
  const schematic = buildSchematic(
    terminals, learnerWires, referenceWires, issues,
    snapshot.analysis, source, editing, selectedTerminalId
  );
  const minimap = buildMinimap(layout, terminals, selectedComponentId, selectedTerminalId, snapshot.sceneView);
  const inspector = buildInspector(layout, terminals, selectedComponentId, selectedTerminalId, issues, source);
  const scope = schematic.signalOnly ? "signal-only" : "topology";

  return freezeObject({
    schemaVersion: 1,
    lessonId,
    lessonTitle: stringOr(lesson?.title, `Bài ${String(lessonId).padStart(2, "0")}`),
    supported: true,
    stage: stringOr(snapshot.stage, "3d"),
    editing,
    selectedTerminalId,
    source,
    scope,
    inspector,
    schematic,
    minimap,
    reference: freezeObject({
      available: referenceWires.length > 0,
      wireCount: referenceWires.length,
      label: referenceWires.length
        ? `Mạch mẫu tham khảo có ${referenceWires.length} dây; không được tính là bản tự đấu.`
        : "Không có dây mẫu tham khảo.",
      physicalVerified: false,
    }),
    boundaries: freezeObject({
      conceptualOnly: true,
      physicalVerified: false,
      breadboardHoleMapping: false,
      electricalFlow: false,
      physicalSafety: false,
      schematicOwnsCircuit: false,
    }),
  });
}

export function explorerTerminalPosition(model, terminalId, surface = "minimap") {
  if (!model || typeof model !== "object") throw new TypeError("Explorer model không hợp lệ.");
  if (typeof terminalId !== "string" || !terminalId) throw new TypeError("terminalId phải là chuỗi không rỗng.");
  const collection = surface === "schematic" ? model.schematic?.terminals : model.minimap?.terminals;
  if (!Array.isArray(collection)) throw new RangeError("Explorer surface không có terminal positions.");
  const terminal = collection.find(item => item.terminalId === terminalId || item.id === terminalId);
  if (!terminal) throw new RangeError(`Không có terminal ${terminalId} trên ${surface}.`);
  return freezeObject({
    terminalId,
    x: terminal.x,
    y: terminal.y,
    surface,
    physicalVerified: false,
  });
}
