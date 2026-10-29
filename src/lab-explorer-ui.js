/**
 * Accessible DOM controller for the v1.6 three-surface lab explorer.
 *
 * This controller renders read-only projections from lab-explorer.js. It never
 * mutates circuit/layout state directly; every interaction delegates to the
 * callbacks supplied by the application/lab editor/scene controller.
 */
import { createLabExplorerModel } from "./lab-explorer.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function requireCallback(value, name, required = false) {
  if (value == null && !required) return () => undefined;
  if (typeof value !== "function") throw new TypeError(`${name} phải là function.`);
  return value;
}

function textNode(doc, tag, text, className = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(text ?? "");
  return node;
}

function button(doc, label, attributes = {}) {
  const node = textNode(doc, "button", label);
  node.type = "button";
  for (const [name, value] of Object.entries(attributes)) {
    if (value != null) node.setAttribute(name, String(value));
  }
  return node;
}

function svgNode(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(name, String(value));
  }
  return node;
}

function severityLabel(severity) {
  if (severity === "error") return "Lỗi";
  if (severity === "warning") return "Cảnh báo";
  return "Thông tin";
}

function rotationLabel(quarterTurns) {
  return `${((Number(quarterTurns) || 0) % 4 + 4) % 4 * 90}°`;
}

// A previously opened editor may remain armed while the learner views the
// 2D wiring tab. Its conceptual 3D layout is then unmounted, so focus is
// available only when both explicit editing AND the 3D stage are active.
function canFocus(model) {
  return model?.editing === true && model.stage === "3d";
}

function buildPanel(doc, name, title) {
  const section = doc.createElement("section");
  section.className = `lab-explorer-panel lab-explorer-${name}`;
  section.dataset.explorerPanel = name;
  const heading = textNode(doc, "h3", title);
  heading.className = "lab-explorer-panel-title";
  section.append(heading);
  return section;
}

function renderInspector(doc, model) {
  const panel = buildPanel(doc, "inspector", "01 · Inspector linh kiện");
  const source = textNode(doc, "p", model.source.label, "lab-explorer-source");
  source.dataset.explorerSource = model.source.kind;
  panel.append(source);
  if (!model.supported) {
    panel.append(textNode(doc, "p", "Bài 01 dùng LED L tích hợp trên bo; không có linh kiện netlist ngoài để inspect.", "lab-explorer-empty-copy"));
    return panel;
  }

  const inspector = model.inspector;
  if (!inspector.component) {
    panel.append(textNode(doc, "p", "Chọn một component ở minimap, sơ đồ hoặc bàn 3D để xem terminal và thuộc tính canonical.", "lab-explorer-empty-copy"));
  } else {
    const c = inspector.component;
    const title = textNode(doc, "h4", `${c.label} · ${c.id}`);
    title.className = "lab-explorer-component-title";
    panel.append(title);
    const dl = doc.createElement("dl");
    dl.className = "lab-explorer-attributes";
    const rows = [
      ["Loại hiển thị", c.visualKind],
      ["Vị trí logic", `X ${c.x} · Z ${c.z}`],
      ["Xoay", rotationLabel(c.quarterTurns)],
      ["Footprint logic", `${c.width} × ${c.depth}`],
      ["Trạng thái", c.fixed ? "Cố định" : "Có thể bố trí"],
      ["Anchor", c.anchorModel],
    ];
    for (const [term, description] of rows) {
      dl.append(textNode(doc, "dt", term), textNode(doc, "dd", description));
    }
    panel.append(dl);

    const terminalHeading = textNode(doc, "h4", `Terminal canonical (${inspector.terminals.length})`);
    terminalHeading.className = "lab-explorer-subheading";
    panel.append(terminalHeading);
    const terminalList = doc.createElement("ul");
    terminalList.className = "lab-explorer-terminal-list";
    for (const terminal of inspector.terminals) {
      const li = doc.createElement("li");
      const terminalButton = button(doc, `${terminal.id} · ${terminal.label}`, {
        "data-explorer-terminal": terminal.id,
        "aria-label": `Chọn terminal ${terminal.id}: ${terminal.label}`,
        "aria-pressed": terminal.selected ? "true" : "false",
      });
      terminalButton.className = "lab-explorer-terminal-button";
      if (terminal.selected) terminalButton.dataset.selected = "true";
      if (terminal.issueSeverity) terminalButton.dataset.severity = terminal.issueSeverity;
      li.append(terminalButton);
      if (terminal.kind || terminal.polarity) {
        li.append(textNode(doc, "small", [terminal.kind, terminal.polarity].filter(Boolean).join(" · ")));
      }
      terminalList.append(li);
    }
    panel.append(terminalList);

    const focus = button(doc, "Tập trung component trong 3D", {
      "data-explorer-focus": c.id,
      "aria-label": `Tập trung camera 3D vào ${c.label}`,
      "aria-disabled": canFocus(model) ? "false" : "true",
    });
    focus.className = "lab-explorer-focus-button";
    focus.disabled = !canFocus(model);
    panel.append(focus);
    if (!canFocus(model)) {
      const focusGate = textNode(
        doc,
        "p",
        "Tập trung camera chỉ khả dụng khi đang xem tab 3D và bật chỉnh sửa; thao tác này chỉ đổi góc nhìn và không sửa netlist.",
        "lab-explorer-focus-gate"
      );
      focusGate.dataset.explorerFocusStatus = "disabled";
      panel.append(focusGate);
    }
  }

  if (inspector.issues.length) {
    const issueHeading = textNode(doc, "h4", "Issue liên quan đến selection");
    issueHeading.className = "lab-explorer-subheading";
    const list = doc.createElement("ul");
    list.className = "lab-explorer-issue-list";
    for (const issue of inspector.issues) {
      const li = doc.createElement("li");
      li.dataset.severity = issue.severity;
      li.append(textNode(doc, "strong", `${severityLabel(issue.severity)} · ${issue.code}`));
      li.append(textNode(doc, "span", issue.message));
      if (issue.terminals.length) li.append(textNode(doc, "small", `Terminal: ${issue.terminals.join(", ")}`));
      list.append(li);
    }
    panel.append(issueHeading, list);
  }
  return panel;
}

function renderSchematicSvg(doc, model, showReference) {
  const schematic = model.schematic;
  const svg = svgNode(doc, "svg", {
    viewBox: `${schematic.viewBox.x} ${schematic.viewBox.y} ${schematic.viewBox.width} ${schematic.viewBox.height}`,
    role: "group",
    "aria-label": `Sơ đồ net khái niệm của ${model.source.label}; ${schematic.wires.length} dây bản tự đấu. Không thể hiện dòng điện vật lý.`,
  });
  svg.classList.add("lab-explorer-schematic-svg");
  svg.dataset.explorerSchematic = "conceptual";

  if (showReference) {
    for (const wire of schematic.referenceWires) {
      const line = svgNode(doc, "line", {
        x1: wire.x1,
        y1: wire.y1,
        x2: wire.x2,
        y2: wire.y2,
        "data-explorer-reference-wire": wire.id,
      });
      line.classList.add("lab-explorer-reference-wire-line");
      svg.append(line);
    }
  }

  for (const wire of schematic.wires) {
    const line = svgNode(doc, "line", {
      x1: wire.x1,
      y1: wire.y1,
      x2: wire.x2,
      y2: wire.y2,
      "data-explorer-wire": wire.id,
    });
    line.classList.add("lab-explorer-wire-line");
    if (wire.issueSeverity) line.dataset.severity = wire.issueSeverity;
    svg.append(line);
  }

  for (const component of schematic.components) {
    const group = svgNode(doc, "g", {
      "data-explorer-component": component.id,
      role: "button",
      tabindex: "0",
      "aria-label": `Chọn component ${component.label} (${component.id})`,
    });
    group.classList.add("lab-explorer-schematic-component");
    const rect = svgNode(doc, "rect", {
      x: component.x,
      y: component.y,
      width: component.width,
      height: component.height,
      rx: 8,
    });
    const label = svgNode(doc, "text", {
      x: component.x + component.width / 2,
      y: component.y + 20,
      "text-anchor": "middle",
    });
    label.textContent = `${component.label} · ${component.id}`;
    group.append(rect, label);
    svg.append(group);
  }

  for (const terminal of schematic.terminals) {
    const group = svgNode(doc, "g", {
      "data-explorer-terminal": terminal.id,
      role: "button",
      tabindex: "0",
      "aria-label": `Chọn terminal ${terminal.id}: ${terminal.label}`,
      "aria-pressed": terminal.selected ? "true" : "false",
    });
    group.classList.add("lab-explorer-schematic-terminal");
    if (terminal.selected) group.dataset.selected = "true";
    if (terminal.issueSeverity) group.dataset.severity = terminal.issueSeverity;
    const circle = svgNode(doc, "circle", { cx: terminal.x, cy: terminal.y, r: 5.5 });
    const label = svgNode(doc, "text", {
      x: terminal.side === "right" ? terminal.x - 8 : terminal.x + 8,
      y: terminal.y + 4,
      "text-anchor": terminal.side === "right" ? "end" : "start",
    });
    label.textContent = terminal.id;
    group.append(circle, label);
    svg.append(group);
  }
  return svg;
}

function renderConnector(doc, model) {
  const wrapper = doc.createElement("div");
  wrapper.className = "lab-explorer-connect";
  const fromLabel = textNode(doc, "label", "Từ terminal");
  const from = doc.createElement("select");
  from.dataset.explorerConnectFrom = "";
  fromLabel.append(from);
  const toLabel = textNode(doc, "label", "Đến terminal");
  const to = doc.createElement("select");
  to.dataset.explorerConnectTo = "";
  toLabel.append(to);
  for (const terminal of model.schematic.terminals) {
    const optionFrom = textNode(doc, "option", `${terminal.id} · ${terminal.label}`);
    optionFrom.value = terminal.id;
    const optionTo = optionFrom.cloneNode(true);
    to.append(optionTo);
    from.append(optionFrom);
  }
  if (to.options.length > 1) to.selectedIndex = 1;
  const connect = button(doc, "Nối qua netlist canonical", { "data-explorer-connect": "" });
  connect.className = "lab-explorer-connect-button";
  connect.disabled = !model.schematic.editableConnections || model.schematic.terminals.length < 2;
  wrapper.append(fromLabel, toLabel, connect);
  return wrapper;
}

function renderSchematicEquivalent(doc, model, showReference) {
  const equivalent = doc.createElement("div");
  equivalent.className = "lab-explorer-equivalent";
  equivalent.setAttribute("aria-label", "Danh sách HTML tương đương sơ đồ khái niệm");
  equivalent.append(textNode(doc, "h4", "Tương đương HTML: dây bản tự đấu"));
  const terminalHeading = textNode(doc, "h4", "Terminal exact ID");
  const terminalActions = doc.createElement("div");
  terminalActions.className = "lab-explorer-terminal-actions";
  terminalActions.dataset.explorerTerminalActions = "";
  for (const terminal of model.schematic.terminals) {
    const action = button(doc, `${terminal.id} · ${terminal.label}`, {
      "data-explorer-terminal": terminal.id,
      "aria-label": `Chọn terminal ${terminal.id}: ${terminal.label}`,
      "aria-pressed": terminal.selected ? "true" : "false",
    });
    action.className = "lab-explorer-terminal-button";
    if (terminal.selected) action.dataset.selected = "true";
    terminalActions.append(action);
  }
  equivalent.append(terminalHeading, terminalActions);
  if (!model.schematic.wires.length) {
    equivalent.append(textNode(doc, "p", "Bản tự đấu hiện chưa có dây. Mạch mẫu tham khảo không được tính là dây của người học."));
  } else {
    const list = doc.createElement("ol");
    list.className = "lab-explorer-wire-list";
    for (const wire of model.schematic.wires) {
      const li = doc.createElement("li");
      li.dataset.explorerWire = wire.id;
      const copy = textNode(doc, "span", `${wire.id}: ${wire.from} ↔ ${wire.to}`);
      if (wire.issueSeverity) li.dataset.severity = wire.issueSeverity;
      li.append(copy);
      // An explicit visual inspection of an existing learner wire is not a
      // connect/disconnect command. It becomes available only when that same
      // learner graph has a mounted editable 3D layout.
      const inspectWire = button(doc, `Xem ${wire.id} trên 3D`, {
        "data-explorer-highlight-wire": wire.id,
        "aria-label": `Làm nổi bật dây ${wire.id} từ ${wire.from} đến ${wire.to} trong mô hình 3D khái niệm`,
        "aria-disabled": canFocus(model) ? "false" : "true",
      });
      inspectWire.className = "lab-explorer-highlight-wire-button";
      inspectWire.disabled = !canFocus(model);
      li.append(inspectWire);
      if (model.schematic.editableWireDeletion) {
        const remove = button(doc, `Gỡ ${wire.id}`, {
          "data-explorer-disconnect": wire.id,
          "aria-label": `Gỡ dây ${wire.id} từ ${wire.from} đến ${wire.to}`,
        });
        li.append(remove);
      }
      list.append(li);
    }
    equivalent.append(list);
  }
  if (showReference && model.schematic.referenceWires.length) {
    equivalent.append(textNode(doc, "h4", "Mạch mẫu tham khảo (không phải bản tự đấu)"));
    const referenceList = doc.createElement("ol");
    referenceList.className = "lab-explorer-wire-list lab-explorer-reference-list";
    for (const wire of model.schematic.referenceWires) {
      const li = doc.createElement("li");
      li.dataset.explorerReferenceWire = wire.id;
      li.textContent = `${wire.from} ↔ ${wire.to}`;
      referenceList.append(li);
    }
    equivalent.append(referenceList);
  }
  return equivalent;
}

function renderSchematic(doc, model, showReference) {
  const panel = buildPanel(doc, "schematic", "02 · Schematic khái niệm");
  panel.dataset.explorerScope = model.supported ? model.schematic.scope : "none";
  const sourceRow = doc.createElement("div");
  sourceRow.className = "lab-explorer-schematic-meta";
  const source = textNode(doc, "span", model.source.label);
  source.dataset.explorerSource = model.source.kind;
  const reference = textNode(doc, "span", model.reference.label, "lab-explorer-reference-label");
  sourceRow.append(source, reference);
  panel.append(sourceRow);
  const terminalStatus = textNode(
    doc,
    "p",
    model.selectedTerminalId
      ? `Terminal đang chọn: ${model.selectedTerminalId}. Selection này là exact terminal ID của lesson.`
      : "Chưa có terminal được chọn. Chọn terminal trên SVG hoặc HTML equivalent để đồng bộ schematic/minimap.",
    "lab-explorer-terminal-status"
  );
  terminalStatus.dataset.explorerSelectedTerminalStatus = model.selectedTerminalId || "none";
  panel.append(terminalStatus);

  if (!model.supported) {
    const empty = textNode(doc, "p", "Bài 01 không có netlist ngoài; sơ đồ dây ngoài không áp dụng.", "lab-explorer-empty-copy");
    empty.dataset.explorerEmpty = "lesson-01";
    panel.append(empty);
    return panel;
  }

  if (model.schematic.signalOnly) {
    const warning = textNode(doc, "p", "Bài này chỉ kiểm tra đường tín hiệu/GND đã mô hình. Nguồn công suất và tải không được xác nhận.", "lab-explorer-signal-boundary");
    warning.dataset.explorerScope = "signal-only";
    panel.append(warning);
  }
  if (model.reference.available) {
    const toggle = button(doc,
      showReference ? "Ẩn mạch mẫu tham khảo" : "Xem mạch mẫu tham khảo",
      {
        "data-explorer-reference-toggle": "",
        "aria-pressed": showReference ? "true" : "false",
      });
    toggle.className = "lab-explorer-reference-toggle";
    const view = textNode(doc, "span",
      showReference ? "Đang phủ mạch mẫu tham khảo (read-only, không phải bản tự đấu)." : "Mạch mẫu đang ẩn.",
      "lab-explorer-reference-view");
    view.dataset.explorerReferenceView = showReference ? "on" : "off";
    panel.append(toggle, view);
  }
  panel.append(renderSchematicSvg(doc, model, showReference));
  panel.append(renderConnector(doc, model));
  panel.append(renderSchematicEquivalent(doc, model, showReference));

  if (model.schematic.issues.length) {
    const heading = textNode(doc, "h4", "Checker topology của bản tự đấu");
    heading.className = "lab-explorer-subheading";
    const issues = doc.createElement("ul");
    issues.className = "lab-explorer-issue-list";
    for (const issue of model.schematic.issues) {
      const li = doc.createElement("li");
      li.dataset.severity = issue.severity;
      li.textContent = `${severityLabel(issue.severity)} · ${issue.message}`;
      issues.append(li);
    }
    panel.append(heading, issues);
  }
  return panel;
}

function renderMinimapSvg(doc, model) {
  const minimap = model.minimap;
  const svg = svgNode(doc, "svg", {
    viewBox: `0 0 ${minimap.width} ${minimap.height}`,
    role: "group",
    "aria-label": "Plan view logic của lab. Tọa độ chỉ thuộc layout khái niệm, không phải kích thước hay lỗ breadboard vật lý.",
  });
  svg.classList.add("lab-explorer-minimap-svg");
  svg.dataset.explorerMinimap = "logical-plan";
  svg.append(svgNode(doc, "rect", { x: 0, y: 0, width: minimap.width, height: minimap.height, class: "lab-explorer-minimap-ground" }));
  for (const component of minimap.components) {
    const group = svgNode(doc, "g", {
      "data-explorer-component": component.id,
      "data-explorer-focus": canFocus(model) ? component.id : null,
      role: "button",
      tabindex: "0",
      "aria-label": canFocus(model)
        ? `Chọn và tập trung 3D vào ${component.label} (${component.id})`
        : `Chọn component ${component.label} (${component.id}); mở tab 3D và bật chỉnh sửa để dùng focus camera`,
    });
    group.classList.add("lab-explorer-minimap-component");
    if (component.id === minimap.selectedComponentId) group.dataset.selected = "true";
    if (component.id === minimap.focusedComponentId) group.dataset.focused = "true";
    const rect = svgNode(doc, "rect", {
      x: component.x - component.width / 2,
      y: component.y - component.height / 2,
      width: component.width,
      height: component.height,
      rx: 1.2,
    });
    const label = svgNode(doc, "text", { x: component.x, y: component.y + 1.5, "text-anchor": "middle" });
    label.textContent = component.id;
    group.append(rect, label);
    svg.append(group);
  }
  for (const terminal of minimap.terminals) {
    const node = svgNode(doc, "circle", {
      cx: terminal.x,
      cy: terminal.y,
      r: 1.1,
      "data-explorer-terminal": terminal.terminalId,
      role: "button",
      tabindex: "0",
      "aria-label": `Chọn terminal ${terminal.terminalId}: ${terminal.label}`,
      "aria-pressed": terminal.selected ? "true" : "false",
    });
    node.classList.add("lab-explorer-minimap-terminal");
    if (terminal.selected) node.dataset.selected = "true";
    svg.append(node);
  }
  return svg;
}

function renderMinimapEquivalent(doc, model) {
  const wrapper = doc.createElement("div");
  wrapper.className = "lab-explorer-equivalent lab-explorer-minimap-equivalent";
  wrapper.setAttribute("aria-label", "Danh sách HTML tương đương plan view");
  wrapper.append(textNode(doc, "h4", "Tương đương HTML: component và tọa độ logic"));
  const list = doc.createElement("ul");
  for (const component of model.minimap.components) {
    const li = doc.createElement("li");
    const select = button(doc, `${component.label} · ${component.id} · X ${component.logicalX}, Z ${component.logicalZ}`, {
      "data-explorer-component": component.id,
      "aria-pressed": component.id === model.minimap.selectedComponentId ? "true" : "false",
    });
    const focus = button(doc, "Tập trung 3D", {
      "data-explorer-focus": component.id,
      "aria-label": `Tập trung 3D vào ${component.label}`,
      "aria-disabled": canFocus(model) ? "false" : "true",
    });
    focus.disabled = !canFocus(model);
    li.append(select, focus);
    list.append(li);
  }
  wrapper.append(list);
  return wrapper;
}

function renderMinimap(doc, model) {
  const panel = buildPanel(doc, "minimap", "03 · Plan view minimap");
  if (!model.minimap.available) {
    panel.append(textNode(doc, "p", "Bài này chưa có conceptual lab-layout để hiển thị minimap.", "lab-explorer-empty-copy"));
    return panel;
  }
  panel.append(renderMinimapSvg(doc, model));
  panel.append(renderMinimapEquivalent(doc, model));
  if (!canFocus(model)) {
    const gate = textNode(
      doc,
      "p",
      "Focus camera cần tab 3D và chế độ chỉnh sửa. Bạn vẫn có thể chọn component/terminal để inspect mà không thay đổi netlist.",
      "lab-explorer-focus-gate"
    );
    gate.dataset.explorerFocusStatus = "disabled";
    panel.append(gate);
  }
  const boundary = textNode(doc, "p", "Plan view dùng logical X/Z và terminal perimeter của lab-layout; không thể hiện rail, lỗ breadboard, dòng điện hoặc kích thước thật.", "lab-explorer-boundary-copy");
  panel.append(boundary);
  return panel;
}

function focusToken(node) {
  if (!node?.getAttribute) return null;
  for (const attr of ["data-explorer-disconnect", "data-explorer-terminal", "data-explorer-focus", "data-explorer-component"]) {
    const value = node.getAttribute(attr);
    if (value != null) return { attr, value };
  }
  if (node.matches?.("[data-explorer-connect]")) return { attr: "data-explorer-connect", value: "" };
  return null;
}

function restoreFocus(root, token) {
  if (!token) return;
  const escaped = globalThis.CSS?.escape ? CSS.escape(token.value) : token.value.replace(/["\\]/g, "\\$&");
  const selector = token.value === ""
    ? `[${token.attr}]`
    : `[${token.attr}="${escaped}"]`;
  root.querySelector(selector)?.focus?.({ preventScroll: true });
}

export function mountLabExplorer(host, options = {}) {
  if (!host || typeof host.replaceChildren !== "function" || !host.ownerDocument) {
    throw new TypeError("mountLabExplorer cần một host DOM hợp lệ.");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("mountLabExplorer options phải là object.");
  }
  const getSnapshot = requireCallback(options.getSnapshot, "getSnapshot", true);
  const onSelectComponent = requireCallback(options.onSelectComponent, "onSelectComponent");
  const onSelectTerminal = requireCallback(options.onSelectTerminal, "onSelectTerminal");
  const onConnect = requireCallback(options.onConnect, "onConnect");
  const onDisconnect = requireCallback(options.onDisconnect, "onDisconnect");
  const onFocus = requireCallback(options.onFocus, "onFocus");
  const onHighlightWire = requireCallback(options.onHighlightWire, "onHighlightWire");
  const doc = host.ownerDocument;
  const root = doc.createElement("section");
  root.className = "lab-explorer";
  root.dataset.labExplorer = "v1.6";
  root.setAttribute("aria-label", "Explorer phối hợp inspector, schematic và plan view của lab");
  const heading = doc.createElement("header");
  heading.className = "lab-explorer-heading";
  heading.append(
    textNode(doc, "div", "LAB EXPLORER · V1.6", "lab-explorer-kicker"),
    textNode(doc, "h2", "Inspect · Schematic · Plan view"),
    textNode(doc, "p", "Ba bề mặt cùng đọc một state canonical; mọi chỉnh sửa dây vẫn đi qua controller hiện hữu."),
  );
  const content = doc.createElement("div");
  content.className = "lab-explorer-grid";
  const status = textNode(doc, "div", "Sẵn sàng.", "lab-explorer-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  root.append(heading, content, status);
  host.replaceChildren(root);

  let disposed = false;
  let currentModel = null;
  let showReference = false;

  function renderCurrent(token = null) {
    if (!currentModel) return;
    content.replaceChildren(
      renderInspector(doc, currentModel),
      renderSchematic(doc, currentModel, showReference),
      renderMinimap(doc, currentModel),
    );
    restoreFocus(root, token);
  }

  function renderError(error) {
    currentModel = null;
    content.replaceChildren();
    const alert = textNode(doc, "p", `Không thể hiển thị Lab Explorer: ${error?.message || "snapshot không hợp lệ"}`, "lab-explorer-error");
    alert.setAttribute("role", "alert");
    content.append(alert);
    status.textContent = "Explorer đã fail-closed vì snapshot không hợp lệ.";
  }

  function update(snapshot = undefined) {
    if (disposed) return freezeResult(false, "disposed");
    const active = doc.activeElement;
    const token = root.contains(active) ? focusToken(active) : null;
    try {
      const nextSnapshot = snapshot === undefined ? getSnapshot() : snapshot;
      const model = createLabExplorerModel(nextSnapshot);
      const previousLessonId = currentModel?.lessonId ?? null;
      if (previousLessonId !== null && model.lessonId !== previousLessonId) showReference = false;
      currentModel = model;
      if (!model.reference.available) showReference = false;
      renderCurrent(token);
      root.dataset.lessonId = String(model.lessonId);
      root.dataset.explorerSource = model.source.kind;
      root.dataset.explorerScope = model.supported ? model.scope : "none";
      root.dataset.explorerSelectedTerminal = model.selectedTerminalId || "";
      status.textContent = model.supported
        ? `${model.source.label} · ${model.schematic.wires.length} dây người học · ${model.reference.wireCount} dây mẫu tham khảo.` +
          (model.selectedTerminalId ? ` Terminal đang chọn: ${model.selectedTerminalId}.` : " Chưa chọn terminal.")
        : "Bài 01: không có netlist ngoài; explorer chỉ hiển thị ranh giới áp dụng.";
      restoreFocus(root, token);
      return freezeResult(true, "updated", model);
    } catch (error) {
      renderError(error);
      return freezeResult(false, error?.message || "invalid-snapshot");
    }
  }

  function invoke(action, ...args) {
    try {
      return action(...args);
    } catch (error) {
      status.textContent = `Không thể thực hiện thao tác: ${error?.message || "callback lỗi"}`;
      return false;
    }
  }

  function activate(target) {
    if (!currentModel || !target) return;
    if (target.matches?.("[data-explorer-reference-toggle]")) {
      const token = focusToken(target) ?? { attr: "data-explorer-reference-toggle", value: "" };
      showReference = !showReference && currentModel.reference.available;
      renderCurrent(token);
      status.textContent = showReference
        ? "Đang hiển thị overlay mạch mẫu read-only; checker và dây editable vẫn thuộc bản tự đấu."
        : `${currentModel.source.label} · overlay mạch mẫu đã ẩn.`;
      return;
    }
    const highlightWireId = target.getAttribute?.("data-explorer-highlight-wire");
    if(highlightWireId != null){
      const canonical = currentModel.schematic.wires.find(wire=>wire.id===highlightWireId);
      if(!canFocus(currentModel)||!canonical){
        status.textContent="Chỉ xem nổi bật dây người học trên 3D khi bật chỉnh sửa và có layout đang hiển thị.";
        return;
      }
      const inspection=invoke(onHighlightWire,canonical.id);
      status.textContent=inspection?.active===true
        ? `Đang làm nổi bật dây ${canonical.id} trên 3D. Chỉ là nét hiển thị của bản tự đấu, không thay đổi netlist hoặc chứng minh điện thực.`
        : `Chưa thể làm nổi bật ${canonical.id} trong 3D; không có dây mới và netlist không thay đổi.`;
      return;
    }
    const disconnectId = target.getAttribute?.("data-explorer-disconnect");
    if (disconnectId != null) {
      const wire = currentModel.schematic.wires.find(item => item.id === disconnectId);
      if (wire?.editable) invoke(onDisconnect, disconnectId);
      return;
    }
    if (target.matches?.("[data-explorer-connect]")) {
      const from = root.querySelector("[data-explorer-connect-from]")?.value;
      const to = root.querySelector("[data-explorer-connect-to]")?.value;
      if (from && to && from !== to && currentModel.schematic.editableConnections) invoke(onConnect, from, to);
      else status.textContent = "Chọn hai terminal khác nhau và bật chế độ chỉnh sửa để nối.";
      return;
    }
    const terminalId = target.getAttribute?.("data-explorer-terminal");
    if (terminalId != null) {
      invoke(onSelectTerminal, terminalId);
      return;
    }
    const focusId = target.getAttribute?.("data-explorer-focus");
    const componentId = target.getAttribute?.("data-explorer-component");
    if (componentId != null) invoke(onSelectComponent, componentId);
    if (focusId != null) {
      if (canFocus(currentModel)) invoke(onFocus, focusId);
      else status.textContent = "Focus camera chỉ khả dụng khi chế độ chỉnh sửa 3D đang bật; selection vẫn có thể inspect mà không đổi netlist.";
    }
  }

  const onClick = event => {
    const target = event.target.closest?.("[data-explorer-reference-toggle],[data-explorer-highlight-wire],[data-explorer-disconnect],[data-explorer-connect],[data-explorer-terminal],[data-explorer-focus],[data-explorer-component]");
    if (target && root.contains(target)) activate(target);
  };
  const onKeyDown = event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest?.("[data-explorer-terminal],[data-explorer-focus],[data-explorer-component]");
    if (!target || !root.contains(target)) return;
    event.preventDefault();
    activate(target);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    currentModel = null;
    if (host.contains(root)) host.replaceChildren();
  }

  update();
  return Object.freeze({ update, dispose });
}

function freezeResult(ok, reason, model = null) {
  return Object.freeze({ ok: Boolean(ok), reason: String(reason), model });
}
