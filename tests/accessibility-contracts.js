/**
 * Browser-only accessibility contracts for the integrated Arduino3DVietnam UI.
 *
 * Run after the app reaches its ready state:
 *   import('./tests/accessibility-contracts.js')
 *     .then(m => m.runAccessibilityContracts())
 *
 * This is deliberately dependency-free. It checks observable DOM/CSS/keyboard
 * contracts but is not a replacement for axe, a screen reader, zoom/reflow
 * testing on physical devices, or a full WCAG conformance audit.
 */

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitUntil = async (predicate, timeoutMs = 12000) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
};

const visible = node => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");

function accessibleName(node) {
  if (!node) return "";
  const aria = node.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const labelledBy = node.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || "").join(" ").trim();
    if (text) return text;
  }
  if (node.id) {
    const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrappingLabel = node.closest?.("label");
  if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
  return node.textContent?.trim() || node.getAttribute("title")?.trim() || "";
}

function parseColor(value) {
  const match = String(value).match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!match) return null;
  return {
    r: Number(match[1]), g: Number(match[2]), b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function over(foreground, background) {
  const a = foreground.a + background.a * (1 - foreground.a);
  if (a <= 0) return { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
    a,
  };
}

function effectiveBackground(node) {
  const layers = [];
  for (let current = node; current instanceof Element; current = current.parentElement) {
    const parsed = parseColor(getComputedStyle(current).backgroundColor);
    if (parsed) layers.push(parsed);
  }
  let result = { r: 255, g: 255, b: 255, a: 1 };
  for (let index = layers.length - 1; index >= 0; index--) result = over(layers[index], result);
  return result;
}

function relativeLuminance(color) {
  const channel = value => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(node) {
  const background = effectiveBackground(node);
  const foregroundRaw = parseColor(getComputedStyle(node).color);
  if (!foregroundRaw) return null;
  const foreground = foregroundRaw.a < 1 ? over(foregroundRaw, background) : foregroundRaw;
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function allCssText() {
  const chunks = [];
  const visit = rules => {
    for (const rule of rules || []) {
      chunks.push(rule.cssText || "");
      try { if (rule.cssRules) visit(rule.cssRules); } catch {}
    }
  };
  for (const sheet of document.styleSheets) {
    try { visit(sheet.cssRules); } catch {}
  }
  return chunks.join("\n");
}

function maxTransitionMs(value) {
  return Math.max(0, ...String(value).split(",").map(part => {
    const text = part.trim();
    if (text.endsWith("ms")) return Number(text.slice(0, -2)) || 0;
    if (text.endsWith("s")) return (Number(text.slice(0, -1)) || 0) * 1000;
    return 0;
  }));
}

async function tabKeyboardProbe(containerSelector, dataAttribute) {
  const container = document.querySelector(containerSelector);
  const tabs = [...(container?.querySelectorAll('[role="tab"]') || [])];
  const selected = tabs.find(tab => tab.getAttribute("aria-selected") === "true") || null;
  if (!container || tabs.length < 2 || !selected) return { supported: false, details: "tablist/tabs/selected tab missing" };
  const selectedIndex = tabs.indexOf(selected);
  const expected = tabs[(selectedIndex + 1) % tabs.length];
  const originalValue = selected.dataset[dataAttribute];
  selected.focus();
  selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  await nextTask();
  const afterSelected = tabs.find(tab => tab.getAttribute("aria-selected") === "true") || null;
  const moved = afterSelected === expected && document.activeElement === expected;
  const rovingTarget = afterSelected || selected;
  const roving = tabs.filter(tab => tab.tabIndex === 0).length === 1 &&
    tabs.every(tab => tab === rovingTarget ? tab.tabIndex === 0 : tab.tabIndex === -1);
  if (afterSelected !== selected && originalValue) selected.click();
  return {
    supported: true,
    moved,
    roving,
    selected: selected.textContent.trim(),
    expected: expected.textContent.trim(),
    activeAfter: document.activeElement?.textContent?.trim() || document.activeElement?.id || "",
    tabIndexes: tabs.map(tab => tab.tabIndex),
  };
}

function tabPanelAssociation(containerSelector) {
  const tabs = [...document.querySelectorAll(`${containerSelector} [role="tab"]`)];
  return tabs.map(tab => {
    const controls = tab.getAttribute("aria-controls") || "";
    const panel = controls ? document.getElementById(controls) : null;
    return {
      label: tab.textContent.trim(),
      controls,
      panelExists: Boolean(panel),
      panelRole: panel?.getAttribute("role") || "",
    };
  });
}

export async function runAccessibilityContracts() {
  const results = [];
  const record = (name, condition, details = "", recommendation = "", severity = "P2") => {
    results.push(Object.freeze({
      name,
      status: condition ? "PASS" : "FAIL",
      severity: condition ? null : severity,
      details,
      recommendation: condition ? "" : recommendation,
    }));
  };
  const skip = (name, details) => results.push(Object.freeze({ name, status: "SKIP", severity: null, details, recommendation: "" }));

  record("document-language-direction",
    document.documentElement.lang === "vi" && document.documentElement.dir === "ltr",
    `lang=${document.documentElement.lang || "(missing)"}; dir=${document.documentElement.dir || "(missing)"}`,
    "Giữ lang=vi và dir=ltr trên <html> để công nghệ hỗ trợ đọc đúng ngôn ngữ/hướng văn bản.");

  const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  record("unique-dom-ids", duplicateIds.length === 0,
    duplicateIds.length ? `Trùng id: ${duplicateIds.join(", ")}` : `${ids.length} id duy nhất`,
    "Đổi các id trùng nhau; aria-labelledby/aria-controls cần đích duy nhất.", "P1");

  const brokenReferences = [];
  for (const node of document.querySelectorAll("[aria-labelledby],[aria-controls]")) {
    for (const attr of ["aria-labelledby", "aria-controls"]) {
      const value = node.getAttribute(attr)?.trim();
      if (!value) continue;
      for (const id of value.split(/\s+/)) if (!document.getElementById(id)) brokenReferences.push(`${node.id || node.tagName}.${attr}->${id}`);
    }
  }
  record("aria-id-references-resolve", brokenReferences.length === 0,
    brokenReferences.length ? brokenReferences.join("; ") : "Tất cả aria-labelledby/aria-controls hiện có đều có đích.",
    "Bổ sung/sửa id đích trước khi Public; reference ARIA hỏng làm mất tên hoặc quan hệ điều khiển.", "P1");

  record("landmarks-and-primary-heading",
    document.querySelectorAll("main").length === 1 && document.querySelectorAll("h1").length === 1 &&
    document.querySelector("nav[aria-label]") && document.querySelector("header") && document.querySelector("footer"),
    `main=${document.querySelectorAll("main").length}, h1=${document.querySelectorAll("h1").length}`,
    "Giữ một main và một h1 cho bài đang hiển thị; đặt tên cho navigation landmark.");

  const lessonLinks = [...document.querySelectorAll(".lesson-link")];
  const lessonNamesMissing = lessonLinks.filter(item => !accessibleName(item));
  const currentLessons = lessonLinks.filter(item => item.getAttribute("aria-current") === "page");
  record("lesson-navigation-16-named-current",
    lessonLinks.length === 16 && lessonNamesMissing.length === 0 && currentLessons.length === 1,
    `lessons=${lessonLinks.length}, unnamed=${lessonNamesMissing.length}, aria-current=page=${currentLessons.length}`,
    "Mỗi bài phải là một control có tên và chỉ bài hiện hành dùng aria-current=page.", "P1");

  const visibleControls = [...document.querySelectorAll("button,input,select,textarea,a[href]")].filter(node => visible(node) && !node.disabled);
  const unnamedControls = visibleControls.filter(node => !accessibleName(node)).map(node => node.id || node.outerHTML.slice(0, 80));
  record("visible-interactive-controls-have-names", unnamedControls.length === 0,
    unnamedControls.length ? `Thiếu tên: ${unnamedControls.join(" | ")}` : `${visibleControls.length} control đang hiển thị có tên`,
    "Bổ sung label/aria-label/aria-labelledby cho control không có accessible name.", "P1");

  const positiveTabIndex = [...document.querySelectorAll("[tabindex]")].filter(node => node.tabIndex > 0).map(node => node.id || node.tagName);
  record("no-positive-tabindex", positiveTabIndex.length === 0,
    positiveTabIndex.length ? positiveTabIndex.join(", ") : "Không có tabindex > 0.",
    "Tránh tabindex dương; giữ thứ tự focus theo DOM và roving tabindex cho composite widgets.");

  const sceneCanvas = document.querySelector("#sceneMount canvas");
  const sceneKeys = new Set((sceneCanvas?.getAttribute("aria-keyshortcuts") || "").split(/\s+/).filter(Boolean));
  record("scene-keyboard-semantics",
    Boolean(sceneCanvas) && sceneCanvas.getAttribute("role") === "application" && sceneCanvas.tabIndex === 0 &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "Enter", "Space"].every(key => sceneKeys.has(key)) &&
    /phím|mũi tên/i.test(sceneCanvas.getAttribute("aria-label") || ""),
    sceneCanvas ? `role=${sceneCanvas.getAttribute("role")}; tabindex=${sceneCanvas.tabIndex}; keys=${[...sceneKeys].join(" ")}` : "canvas 3D không có",
    "Giữ canvas focusable, mô tả thao tác bàn phím trong aria-label và đồng bộ aria-keyshortcuts với handler.", "P1");

  const liveExpectations = [
    ["#simOutput", "status", "polite"],
    ["#quizFeedback", "status", "polite"],
    ["#electricalResult", "status", "polite"],
    ["#codeEditStatus", "status", null],
    ["#avrStatus", "status", "polite"],
    ["#avrPeripheralState", "status", "polite"],
    ["#labStatus", "status", "polite"],
    ["#labAvrStatus", "status", null],
    [".lab-explorer-status", "status", "polite"],
    ["#bbResult", "status", "polite"],
    ["#resistiveResult", "status", "polite"],
    ["#serialConsole", "log", "off"],
  ];
  const liveProblems = liveExpectations.flatMap(([selector, role, live]) => {
    const node = document.querySelector(selector);
    if (!node) return [`${selector}: missing`];
    const problems = [];
    if (node.getAttribute("role") !== role) problems.push(`${selector}: role=${node.getAttribute("role")}`);
    if (live !== null && node.getAttribute("aria-live") !== live) problems.push(`${selector}: aria-live=${node.getAttribute("aria-live")}`);
    return problems;
  });
  record("status-and-log-live-regions", liveProblems.length === 0,
    liveProblems.length ? liveProblems.join("; ") : "Các status/log chính có role/live policy rõ ràng.",
    "Dùng role=status aria-live=polite cho cập nhật cần thông báo; giữ Serial log aria-live=off để tránh đọc dồn dập.", "P1");

  const avrSection = document.querySelector("#avrPanelMount");
  const avrHeading = document.querySelector("#avrHeading");
  const avrButtons = [...document.querySelectorAll("#avrLoad,#avrStep,#avrCycle,#avrReset")];
  const avrCaveat = document.querySelector(".avr-caveat")?.textContent || "";
  const avrBoundaryTruthful =
    /(không phải mô phỏng hoàn chỉnh Arduino Uno|không phải Arduino Uno đầy đủ)/i.test(avrCaveat) &&
    /(không suy|không.*vật lý|không.*điện)/i.test(avrCaveat);
  record("avr-panel-name-status-boundary",
    Boolean(avrSection && avrHeading) && avrSection.getAttribute("aria-labelledby") === "avrHeading" &&
    avrButtons.length === 4 && avrButtons.every(button => accessibleName(button)) &&
    document.querySelector("#avrStatus")?.getAttribute("role") === "status" &&
    avrBoundaryTruthful,
    `heading=${Boolean(avrHeading)}, buttons=${avrButtons.length}, status=${document.querySelector("#avrStatus")?.getAttribute("role") || "missing"}, caveat=${avrCaveat}`,
    "Giữ panel được aria-labelledby, nút có tên, status live và caveat CPU-only ở dạng text đọc được.", "P1");

  const peripheralCheckbox = document.querySelector("#avrPeripheralMode");
  const peripheralInputs = document.querySelector("#avrPeripheralInputs");
  const peripheralState = document.querySelector("#avrPeripheralState");
  const peripheralControls = [
    peripheralCheckbox,
    document.querySelector("#avrD2Input"),
    document.querySelector("#avrA0Input"),
    document.querySelector("#avrApplyA0"),
  ];
  const peripheralCaveat = document.querySelector(".avr-experiment-caveat")?.textContent || "";
  record("avr-peripheral-controls-semantics",
    peripheralControls.every(control => control && accessibleName(control)) &&
    peripheralState?.getAttribute("role") === "status" && peripheralState?.getAttribute("aria-live") === "polite" &&
    /không tái tạo toàn bộ Arduino Uno/i.test(peripheralCaveat) &&
    /USART RX|PWM|cảm biến|động cơ/i.test(peripheralCaveat),
    JSON.stringify({
      names: peripheralControls.map(control => accessibleName(control)),
      stateRole: peripheralState?.getAttribute("role") || "",
      stateLive: peripheralState?.getAttribute("aria-live") || "",
      caveat: peripheralCaveat,
    }),
    "Giữ checkbox/D2/A0/apply control có accessible name, peripheral state là polite status và caveat giới hạn không bị ẩn khỏi accessibility tree.", "P1");

  let peripheralModeVisible = false;
  if (peripheralCheckbox && !peripheralCheckbox.checked && document.querySelector("#avrLoad")) {
    peripheralCheckbox.click();
    await nextTask();
    document.querySelector("#avrLoad").click();
    const loadSettled = await waitUntil(() => ["success", "error"].includes(document.querySelector("#avrStatus")?.dataset.kind || ""));
    peripheralModeVisible = loadSettled && document.querySelector("#avrStatus")?.dataset.kind === "success" &&
      !peripheralInputs?.hidden && !peripheralState?.hidden;
    record("avr-peripheral-controls-production-path",
      peripheralModeVisible,
      JSON.stringify({
        settled: loadSettled,
        statusKind: document.querySelector("#avrStatus")?.dataset.kind || "",
        status: document.querySelector("#avrStatus")?.textContent?.trim() || "",
        inputsHidden: peripheralInputs?.hidden,
        stateHidden: peripheralState?.hidden,
      }),
      "Bật peripheral mode rồi nạp firmware phải làm D2/A0 controls và peripheral live state hiện ra qua production path; nếu firmware load thất bại, kiểm tra release bundle/integration trước Public.", "P1");
  } else {
    peripheralModeVisible = Boolean(peripheralCheckbox?.checked && !peripheralInputs?.hidden && !peripheralState?.hidden);
    record("avr-peripheral-controls-production-path", peripheralModeVisible,
      `checked=${Boolean(peripheralCheckbox?.checked)}, inputsHidden=${peripheralInputs?.hidden}, stateHidden=${peripheralState?.hidden}`,
      "Peripheral mode cần có production path làm controls/state hiển thị sau verified firmware load.", "P1");
  }
  // Capture the readout contrast while the production peripheral state is
  // actually rendered. The v1.5 lab/coach probe below switches to lesson 02,
  // whose AVR setLesson() intentionally clears this lesson-01 readout.
  const peripheralStateSmall = [...document.querySelectorAll(".avr-peripheral-state small")].find(visible) || null;
  const peripheralStateContrastSample = {
    selector: ".avr-peripheral-state small",
    ratio: peripheralStateSmall ? contrastRatio(peripheralStateSmall) : null,
    text: peripheralStateSmall?.textContent?.trim().slice(0, 80) || "",
  };

  const stageAssociations = tabPanelAssociation(".stage-tabs");
  const infoAssociations = tabPanelAssociation(".info-tabs");
  const associationsOk = [...stageAssociations, ...infoAssociations].every(item => item.controls && item.panelExists && item.panelRole === "tabpanel");
  record("tab-to-tabpanel-association", associationsOk,
    JSON.stringify({ stage: stageAssociations, info: infoAssociations }),
    "Mỗi role=tab nên có aria-controls trỏ tới một role=tabpanel tương ứng; panel được chọn nên liên hệ lại tab bằng aria-labelledby.", "P1");

  const stageProbe = await tabKeyboardProbe(".stage-tabs", "stage");
  record("stage-tabs-keyboard-pattern",
    stageProbe.supported && stageProbe.moved && stageProbe.roving,
    JSON.stringify(stageProbe),
    "Áp dụng roving tabindex (một tab tabindex=0, còn lại -1) và ArrowLeft/ArrowRight/Home/End để đổi focus + selection cho stage tabs.", "P1");

  const infoProbe = await tabKeyboardProbe(".info-tabs", "info");
  record("info-tabs-keyboard-pattern",
    infoProbe.supported && infoProbe.moved && infoProbe.roving,
    JSON.stringify(infoProbe),
    "Áp dụng cùng keyboard pattern cho info tabs; đừng buộc người dùng Tab qua cả ba role=tab.", "P1");

  const help = document.querySelector("#helpDialog");
  const helpAriaLabel = help?.getAttribute("aria-label")?.trim() || "";
  const helpLabelledBy = help?.getAttribute("aria-labelledby")?.trim() || "";
  const helpLabelledText = helpLabelledBy
    ? helpLabelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim() || "").join(" ").trim()
    : "";
  const helpName = helpAriaLabel || helpLabelledText;
  record("help-dialog-accessible-name",
    Boolean(help && helpName),
    `aria-label=${helpAriaLabel || "(missing)"}; aria-labelledby=${helpLabelledBy || "(missing)"}; resolved=${helpName || "(missing)"}`,
    "Đặt id cho tiêu đề dialog và thêm aria-labelledby (hoặc aria-label) trên #helpDialog.", "P1");

  // v1.5 conceptual lab editor and learning coach controls are hidden on
  // lesson 01, so exercise their real production rendering in this isolated
  // accessibility page rather than treating hidden markup as sufficient.
  document.querySelector('.lesson-link[data-lesson="2"]')?.click();
  await nextTask();
  const labToggle = document.querySelector("#labEditToggle");
  labToggle?.click();
  await nextTask();
  const labPanel = document.querySelector("#labEditor");
  const labCanvas = document.querySelector("#sceneMount canvas");
  const labControls = [
    "#labEditToggle", "#labComponent", "#labPositionX", "#labPositionZ", "#labPlace",
    '[data-lab-nudge="-0.5,0"]', '[data-lab-nudge="0,-0.5"]',
    '[data-lab-nudge="0,0.5"]', '[data-lab-nudge="0.5,0"]',
    "#labRotateLeft", "#labRotateRight", "#labResetPositions",
    "#labFromPin", "#labToPin", "#labConnect", "#labRemoveLastWire",
    "#labSampleWires", "#labClearWires",
  ].map(selector => document.querySelector(selector));
  const labUnnamed = labControls.filter(control => !control || !accessibleName(control))
    .map(control => control?.id || "missing-control");
  record("lab-editor-controls-accessible",
    Boolean(labPanel && !labPanel.hidden) && labToggle?.getAttribute("aria-controls") === "labEditor" &&
    labToggle?.getAttribute("aria-expanded") === "true" && labUnnamed.length === 0 &&
    document.querySelector("#labStatus")?.getAttribute("role") === "status" &&
    document.querySelector("#labStatus")?.getAttribute("aria-live") === "polite" &&
    document.querySelector("#labAvrStatus")?.getAttribute("role") === "status" &&
    labCanvas?.dataset.labEdit === "on" &&
    /Chế độ chỉnh bố trí 3D/i.test(labCanvas?.getAttribute("aria-label") || "") &&
    /khái niệm/i.test(document.querySelector(".lab-editor-boundary")?.textContent || "") &&
    /không xác định.*điện áp|không.*dòng|không.*an toàn/i.test(document.querySelector(".lab-editor-boundary")?.textContent || ""),
    JSON.stringify({
      editorVisible: Boolean(labPanel && !labPanel.hidden),
      expanded: labToggle?.getAttribute("aria-expanded") || "",
      unnamed: labUnnamed,
      labStatusRole: document.querySelector("#labStatus")?.getAttribute("role") || "",
      labAvrStatusRole: document.querySelector("#labAvrStatus")?.getAttribute("role") || "",
      canvasLabEdit: labCanvas?.dataset.labEdit || "",
      canvasAria: labCanvas?.getAttribute("aria-label") || "",
    }),
    "Bàn chỉnh 3D cần control có tên, toggle aria-controls/expanded, live status và boundary khái niệm/không vật lý đọc được.", "P1");

  const cancelPendingWire = document.querySelector("#labCancelPendingWire");
  const cancelPendingRect = cancelPendingWire?.getBoundingClientRect();
  record("vnext-lab-pending-wire-native-keyboard-cancel-accessible",
    cancelPendingWire?.tagName === "BUTTON" && cancelPendingWire.type === "button" &&
    cancelPendingWire.getAttribute("aria-describedby") === "labSelectedTerminal" &&
    Boolean(accessibleName(cancelPendingWire)) && cancelPendingWire.disabled === true &&
    document.querySelector("#labSelectedTerminal")?.getAttribute("role") === "status" &&
    document.querySelector("#labSelectedTerminal")?.getAttribute("aria-live") === "polite" &&
    cancelPendingRect?.width >= 44 && cancelPendingRect?.height >= 44,
    JSON.stringify({name:accessibleName(cancelPendingWire),disabled:cancelPendingWire?.disabled,
      width:cancelPendingRect?.width,height:cancelPendingRect?.height}),
    "Nút Hủy chọn chân đầu tiên phải native >=44px, có tên và liên kết live status, không tạo dây.", "P1");

  document.querySelector("#infoTabPractice")?.click();
  await nextTask();
  const coach = document.querySelector("#learningCoach");
  const coachControls = ["#coachPrevious", "#coachHint", "#coachNext"].map(selector => document.querySelector(selector));
  record("learning-coach-controls-accessible",
    Boolean(coach && accessibleName(coach)) && coachControls.every(control => control && accessibleName(control)) &&
    /không đo|không xác nhận phần cứng/i.test(document.querySelector(".coach-boundary")?.textContent || ""),
    JSON.stringify({
      coachName: accessibleName(coach),
      controlNames: coachControls.map(control => accessibleName(control)),
      boundary: document.querySelector(".coach-boundary")?.textContent?.trim() || "",
    }),
    "Learning coach cần accessible name/buttons và disclosure rằng tiến độ/hướng dẫn không đo hay xác nhận phần cứng.", "P1");

  // Post-v1.6 step-specific evidence belongs to the same practice panel.
  // It compares canonical learner edges against human-authored checkpoints and
  // must keep provenance explicit without a mastery/physical-success claim.
  const practiceEvidence = coach?.querySelector("[data-practice-evidence]");
  const practiceStatus = practiceEvidence?.querySelector("[data-practice-status-label]");
  const practiceButtons = [
    practiceEvidence?.querySelector("[data-practice-open-wiring]"),
    practiceEvidence?.querySelector("[data-practice-open-3d]"),
    practiceEvidence?.querySelector("[data-practice-inspect-missing-terminal]"),
    practiceEvidence?.querySelector("[data-practice-recheck]"),
  ];
  const practiceMissingInspect = practiceEvidence?.querySelector(
    "[data-practice-inspect-missing-terminal]",
  );
  const practiceProvenance = practiceEvidence?.querySelector("[data-practice-provenance-note]");
  const practiceBoundary = practiceEvidence?.querySelector(".practice-evidence-boundary")?.textContent || "";
  record("post-v16-practice-evidence-named-accessible-physical-boundary",
    Boolean(practiceEvidence && accessibleName(practiceEvidence)) &&
    practiceEvidence.tagName === "SECTION" &&
    practiceEvidence.getAttribute("data-practice-lesson") === "2" &&
    practiceEvidence.getAttribute("data-practice-status") === "not-attempted" &&
    practiceEvidence.getAttribute("data-practice-checkpoint-kind") === "wiring" &&
    practiceEvidence.getAttribute("data-practice-checkpoint-id") === "lesson-02-step-01" &&
    practiceEvidence.getAttribute("data-practice-provenance") === "human-authored-from-lesson-text" &&
    practiceStatus?.getAttribute("role") === "status" &&
    practiceStatus?.getAttribute("aria-live") === "polite" &&
    practiceProvenance?.getAttribute("role") === "note" &&
    /không phải xác nhận của giáo viên|không chứng minh người học/i.test(practiceProvenance?.textContent || "") &&
    practiceMissingInspect?.getAttribute("data-practice-inspect-terminal") === "D13" &&
    /D13.*3D.*Inspector/i.test(accessibleName(practiceMissingInspect)) &&
    practiceButtons.every(button =>
      button && button.tagName === "BUTTON" && Boolean(accessibleName(button)) &&
      button.getBoundingClientRect().height >= 44) &&
    /không đo|không xác nhận phần cứng/i.test(practiceBoundary) &&
    /không tự xác nhận mức độ hiểu|không.*hoàn thành bài/i.test(practiceBoundary),
    JSON.stringify({
      status: practiceEvidence?.getAttribute("data-practice-status"),
      checkpointKind: practiceEvidence?.getAttribute("data-practice-checkpoint-kind"),
      checkpointId: practiceEvidence?.getAttribute("data-practice-checkpoint-id"),
      provenance: practiceEvidence?.getAttribute("data-practice-provenance"),
      name: accessibleName(practiceEvidence),
      statusRole: practiceStatus?.getAttribute("role"),
      buttons: practiceButtons.map(button => ({
        name: accessibleName(button),
        height: button?.getBoundingClientRect().height,
      })),
      boundary: practiceBoundary,
    }),
    "Bằng chứng thực hành từng bước cần region/status có tên, nút native >=44px và tuyên bố rõ không đo/không tự xác nhận hoàn thành.", "P1");

  record("post-v16-practice-missing-terminal-inspector-accessible-explicit-only",
    practiceMissingInspect?.tagName === "BUTTON" &&
    practiceMissingInspect.type === "button" &&
    practiceMissingInspect.getAttribute("data-practice-inspect-terminal") === "D13" &&
    /Xem terminal D13.*cặp còn thiếu.*3D Inspector/i.test(
      practiceMissingInspect.getAttribute("aria-label") || "") &&
    practiceMissingInspect.getBoundingClientRect().height >= 44 &&
    practiceMissingInspect.getBoundingClientRect().width >= 44 &&
    /D13 ↔ R1:A/.test(practiceEvidence?.textContent || "") &&
    /không.*phần cứng|không.*hoàn thành/i.test(practiceBoundary),
    JSON.stringify({
      name: accessibleName(practiceMissingInspect),
      target: practiceMissingInspect?.getAttribute("data-practice-inspect-terminal"),
      height: practiceMissingInspect?.getBoundingClientRect().height,
      width: practiceMissingInspect?.getBoundingClientRect().width,
    }),
    "Action xem terminal còn thiếu phải là nút explicit >=44px, gắn đúng ID canonical và không mang ngữ nghĩa tự nối/hoàn thành.", "P1");

  const authoredChecklist = practiceEvidence?.querySelector("[data-practice-wire-checklist]");
  const checklistRows = [...(authoredChecklist?.querySelectorAll("[data-practice-checklist-row]")||[])];
  const checklistButtons = [...(authoredChecklist?.querySelectorAll("[data-practice-checklist-inspect-terminal]")||[])];
  record("vnext-practice-authored-pair-checklist-named-native-inspect",
    authoredChecklist?.getAttribute("role") === "group" && Boolean(accessibleName(authoredChecklist)) &&
    checklistRows.length > 0 && checklistRows.length === checklistButtons.length &&
    checklistRows.every(row => row.getAttribute("data-practice-pair-status") === "missing") &&
    checklistButtons.every(button => button.tagName === "BUTTON" && button.type === "button" &&
      Boolean(accessibleName(button)) && button.getBoundingClientRect().height >= 44 &&
      button.getBoundingClientRect().width >= 44),
    JSON.stringify({name:accessibleName(authoredChecklist),rows:checklistRows.length,
      buttons:checklistButtons.length,targets:checklistButtons.map(x=>x.dataset.practiceInspectTerminal)}),
    "Checklist authored ở bài 02 phải có tên, hàng thiếu canonical và inspect native >=44px; không tự chứng nhận thực hành.", "P1");

  const missingPairPreviews = [...(authoredChecklist?.querySelectorAll('[data-practice-preview-pair-2d]')||[])];
  record("vnext-practice-missing-pair-2d-native-keyboard-view-only-action",
    missingPairPreviews.length === checklistRows.length && checklistRows.length === 3 &&
    missingPairPreviews.every(button => button.tagName === "BUTTON" && button.type === "button" &&
      !button.disabled && Boolean(accessibleName(button)) &&
      /chưa tạo dây/i.test(accessibleName(button)) &&
      button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44 &&
      Boolean(button.dataset.practicePreviewFrom) && Boolean(button.dataset.practicePreviewTo)) &&
    missingPairPreviews[0]?.dataset.practicePreviewFrom === "D13" &&
    missingPairPreviews[0]?.dataset.practicePreviewTo === "R1:A",
    JSON.stringify({targets:missingPairPreviews.map(button=>[
      button.dataset.practicePreviewFrom,button.dataset.practicePreviewTo]),
      minHeight:Math.min(...missingPairPreviews.map(button=>button.getBoundingClientRect().height))}),
    "Nút xem cặp thiếu là native keyboard target >=44px, phân biệt với nối dây có thật.","P1");

  const practiceObservation = coach?.querySelector("[data-practice-observation]");
  const observationBoundary = practiceObservation?.querySelector("[data-observation-boundary]")?.textContent || "";
  const observationAttribution = practiceObservation?.querySelector(
    "[data-observation-attribution-note]",
  )?.textContent || "";
  const observationRecorded = practiceObservation?.querySelector(
    "[data-observation-recorded]",
  )?.textContent || "";
  record("post-v16-practice-observation-accessible-no-attribution-or-mastery",
    Boolean(practiceObservation && accessibleName(practiceObservation)) &&
    practiceObservation.tagName === "SECTION" &&
    practiceObservation.getAttribute("role") === "status" &&
    practiceObservation.getAttribute("aria-live") === "polite" &&
    practiceObservation.getAttribute("aria-atomic") === "false" &&
    practiceObservation.getAttribute("data-observation-lesson") === "2" &&
    practiceObservation.getAttribute("data-observation-step") === "0" &&
    practiceObservation.getAttribute("data-observation-checkpoint") === "lesson-02-step-01" &&
    Boolean(practiceObservation.querySelector("[data-observation-expected]")) &&
    Boolean(practiceObservation.querySelector("[data-observation-recorded]")) &&
    Boolean(practiceObservation.querySelector("[data-observation-overlap]")) &&
    /không lưu stepIndex hay timestamp/i.test(observationAttribution) &&
    /không chứng minh event.*bước hiện tại/i.test(observationAttribution) &&
    /caller báo cho module|báo cho module/i.test(observationRecorded) &&
    !/host-only|host app đã ghi nhận|người dùng đã thực hiện/i.test(
      observationRecorded + " " + observationAttribution) &&
    /không đo mastery/i.test(observationBoundary) &&
    /không tự hoàn thành bài/i.test(observationBoundary) &&
    /không phải điều kiện để chuyển bước/i.test(observationBoundary),
    JSON.stringify({
      name: accessibleName(practiceObservation),
      role: practiceObservation?.getAttribute("role") || "",
      live: practiceObservation?.getAttribute("aria-live") || "",
      lesson: practiceObservation?.getAttribute("data-observation-lesson") || "",
      step: practiceObservation?.getAttribute("data-observation-step") || "",
      checkpoint: practiceObservation?.getAttribute("data-observation-checkpoint") || "",
      recorded: observationRecorded,
      attribution: observationAttribution,
      boundary: observationBoundary,
    }),
    "Practice observation phải là live status có tên, giữ phạm vi lesson-event và nói rõ không step attribution/mastery/completion.", "P1");

  document.querySelector("#infoTabPinout")?.click();
  await nextTask();
  const unoPinRegion = document.querySelector("[data-uno-pin-reference]");
  const unoD13Inspect = document.querySelector('[data-uno-pin-inspect="D13"]');
  const unoAliasInspect = document.querySelectorAll(
    '[data-uno-pin-inspect="AREF"], [data-uno-pin-inspect="SDA"], [data-uno-pin-inspect="SCL"]',
  );
  const unoBoundary = document.querySelector("#unoPinReferenceBoundary");
  record("post-v16-uno-pinout-canonical-3d-inspect-button-accessible",
    unoPinRegion?.getAttribute("role") === "region" &&
    Boolean(accessibleName(unoPinRegion)) &&
    unoD13Inspect?.tagName === "BUTTON" &&
    unoD13Inspect.type === "button" &&
    /D13.*3D.*Inspector/i.test(accessibleName(unoD13Inspect)) &&
    unoD13Inspect.getAttribute("aria-describedby") === "unoPinReferenceBoundary" &&
    unoD13Inspect.getBoundingClientRect().height >= 44 &&
    unoD13Inspect.getBoundingClientRect().width >= 44 &&
    unoAliasInspect.length === 0 &&
    /không chứng minh.*3D|không.*liên thông lỗ breadboard/i.test(unoBoundary?.textContent || ""),
    JSON.stringify({
      regionName: accessibleName(unoPinRegion),
      d13Name: accessibleName(unoD13Inspect),
      d13Height: unoD13Inspect?.getBoundingClientRect().height,
      d13Width: unoD13Inspect?.getBoundingClientRect().width,
      aliasActions: unoAliasInspect.length,
      boundary: unoBoundary?.textContent?.trim() || "",
    }),
    "Pinout chỉ được đưa nút 3D cho terminal ID tồn tại chính xác trong lesson; alias AREF/SDA/SCL không được tự suy map sang chân khác.", "P1");

  const mechanical = document.querySelector("[data-uno-mechanical-reference='outline-only']");
  const outlineSvg = mechanical?.querySelector("svg[role='img']");
  const outlineNotes = mechanical?.querySelector(".uno-mechanical-boundary");
  record("vnext-uno-mechanical-official-outline-sourced-not-cad-or-snap",
    mechanical?.getAttribute("role") === "group" && Boolean(accessibleName(mechanical)) &&
    mechanical.getAttribute("data-uno-scene-snap") === "unverified" &&
    outlineSvg?.getAttribute("viewBox") === "0 0 620 465" &&
    /68,6.*53,4/i.test(mechanical.textContent) &&
    /66,04.*50,80.*không phải chiều bao ngoài/i.test(outlineNotes?.textContent||"") &&
    /không thể hiện tọa độ lỗ/i.test(outlineSvg.getAttribute("aria-label")||"") &&
    outlineNotes?.getAttribute("role") === "note" &&
    /không thể dùng.*snap|không.*tọa độ CAD/i.test(outlineNotes?.textContent||"") &&
    mechanical.querySelector("a")?.getAttribute("href") ===
      "https://store.arduino.cc/products/arduino-uno-rev3" &&
    mechanical.querySelectorAll("a")[1]?.getAttribute("href") ===
      "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf" &&
    Array.from(mechanical.querySelectorAll("a")).every(link=>
      link.getBoundingClientRect().height>=44),
    JSON.stringify({name:accessibleName(mechanical),source:mechanical?.querySelector("a")?.href}),
    "Cơ khí Uno có nguồn A000066, mô tả kích thước nhưng không giả tọa độ header hoặc breadboard.","P1");

  const sketchReview = document.querySelector("#sketchReviewMount [data-sketch-review]");
  const sketchReviewStatus = sketchReview?.querySelector("[data-sketch-review-status-label]");
  const sketchReviewBoundary = sketchReview?.querySelector("[data-sketch-review-boundary]");
  record("post-v16-sketch-review-accessible-source-only-boundary",
    Boolean(sketchReview && accessibleName(sketchReview)) &&
    sketchReview.tagName === "SECTION" &&
    sketchReview.getAttribute("data-sketch-review-lesson") === "2" &&
    sketchReview.getAttribute("data-sketch-review-status") === "reference" &&
    sketchReviewStatus?.getAttribute("role") === "status" &&
    sketchReviewStatus?.getAttribute("aria-live") === "polite" &&
    sketchReviewStatus?.getAttribute("aria-atomic") === "true" &&
    sketchReviewBoundary?.getAttribute("role") === "note" &&
    /không biên dịch Arduino C\+\+|không chạy firmware/i.test(sketchReviewBoundary?.textContent || "") &&
    /không đánh giá mức độ hoàn thành|không.*hiểu bài/i.test(sketchReviewBoundary?.textContent || "") &&
    sketchReview.querySelectorAll("button,input,textarea,select").length === 0,
    JSON.stringify({
      name: accessibleName(sketchReview),
      lesson: sketchReview?.getAttribute("data-sketch-review-lesson"),
      status: sketchReview?.getAttribute("data-sketch-review-status"),
      statusRole: sketchReviewStatus?.getAttribute("role"),
      statusLive: sketchReviewStatus?.getAttribute("aria-live"),
      boundary: sketchReviewBoundary?.textContent?.trim() || "",
    }),
    "Sketch review cần named region/status polite và disclosure rõ đây chỉ là so sánh source, không phải compile/firmware/completion.", "P1");

  const lexicalSummary = sketchReview?.querySelector("[data-sketch-review-lexical-summary]");
  record("vnext-sketch-lexical-feedback-accessible-without-compiler-claim",
    lexicalSummary?.getAttribute("role") === "status" &&
    lexicalSummary?.getAttribute("aria-live") === "polite" &&
    /comment\/string/i.test(lexicalSummary?.textContent||"") &&
    sketchReview?.getAttribute("data-sketch-review-lexical-difference-count") === "0" &&
    /không biên dịch Arduino C\+\+/i.test(sketchReviewBoundary?.textContent||""),
    JSON.stringify({summary:lexicalSummary?.textContent,differences:sketchReview?.dataset.sketchReviewLexicalDifferenceCount}),
    "Review lexical phải là live status source-only, không nhầm comment/string với compiler hay mastery.", "P1");

  // v1.6 Lab Explorer exposes the same canonical lesson state through three
  // equivalent surfaces. SVG surfaces need explicit names/roles AND HTML
  // equivalents so a screen reader is not forced to interpret geometry.
  const explorerHost = document.querySelector("#labExplorer");
  const explorerRoot = explorerHost?.querySelector(".lab-explorer");
  const explorerPanels = [...(explorerRoot?.querySelectorAll("[data-explorer-panel]") || [])];
  const explorerStatus = explorerRoot?.querySelector(".lab-explorer-status");
  record("v16-explorer-region-three-surface-semantics",
    Boolean(explorerHost && explorerRoot) &&
    explorerRoot.tagName === "SECTION" &&
    accessibleName(explorerRoot) &&
    explorerPanels.length === 3 &&
    ["inspector", "schematic", "minimap"].every(
      name => explorerPanels.some(panel => panel.dataset.explorerPanel === name && panel.querySelector("h3")),
    ) &&
    explorerStatus?.getAttribute("role") === "status" &&
    explorerStatus?.getAttribute("aria-live") === "polite",
    JSON.stringify({
      hostName: accessibleName(explorerHost),
      rootName: accessibleName(explorerRoot),
      rootTag: explorerRoot?.tagName || "",
      panels: explorerPanels.map(panel => panel.dataset.explorerPanel),
      statusRole: explorerStatus?.getAttribute("role") || "",
      statusLive: explorerStatus?.getAttribute("aria-live") || "",
    }),
    "Explorer section có tên phải chứa ba surface có heading và status polite để cập nhật selection/provenance được đọc.", "P1");

  const schematicSvg = explorerRoot?.querySelector(".lab-explorer-schematic-svg");
  const minimapSvg = explorerRoot?.querySelector(".lab-explorer-minimap-svg");
  const explorerEquivalents = [...(explorerRoot?.querySelectorAll(".lab-explorer-equivalent") || [])];
  record("v16-explorer-svg-screen-reader-equivalents",
    schematicSvg?.getAttribute("role") === "group" && Boolean(accessibleName(schematicSvg)) &&
    minimapSvg?.getAttribute("role") === "group" && Boolean(accessibleName(minimapSvg)) &&
    /khái niệm|không.*vật lý|không.*dòng/i.test(accessibleName(schematicSvg)) &&
    /logic|không.*breadboard|không.*vật lý/i.test(accessibleName(minimapSvg)) &&
    explorerEquivalents.length >= 2 &&
    explorerEquivalents.every(node => Boolean(node.getAttribute("aria-label")?.trim())),
    JSON.stringify({
      schematicName: accessibleName(schematicSvg),
      minimapName: accessibleName(minimapSvg),
      equivalents: explorerEquivalents.map(node => node.getAttribute("aria-label")),
    }),
    "Schematic/minimap SVG tương tác phải là named group (không phải role=img chứa button) và có HTML equivalent đọc được.", "P1");

  const explorerCompositeActions = [...(explorerRoot?.querySelectorAll(
    '[role="button"][tabindex],[data-explorer-reference-toggle],[data-explorer-connect]',
  ) || [])];
  const explorerUnnamed = explorerCompositeActions.filter(node => !accessibleName(node));
  const explorerPositiveTab = explorerCompositeActions.filter(node => node.tabIndex > 0);
  record("v16-explorer-keyboard-actions-named-no-positive-tabindex",
    explorerCompositeActions.length > 0 && explorerUnnamed.length === 0 && explorerPositiveTab.length === 0,
    JSON.stringify({
      actions: explorerCompositeActions.length,
      unnamed: explorerUnnamed.map(node => node.outerHTML.slice(0, 90)),
      positiveTab: explorerPositiveTab.map(node => node.outerHTML.slice(0, 90)),
    }),
    "Mọi SVG/button action của Explorer cần accessible name và tabindex tự nhiên/0, không dùng tabindex dương.", "P1");

  const terminalProbe = explorerRoot?.querySelector(
    ".lab-explorer-schematic-svg [data-explorer-terminal][role='button']",
  );
  let terminalSelectionAria = false;
  let terminalSelectionDetails = {};
  if (terminalProbe) {
    const terminalId = terminalProbe.getAttribute("data-explorer-terminal");
    terminalProbe.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTask();
    const selector = '#labExplorer [data-explorer-terminal="' + CSS.escape(terminalId) + '"]';
    const representations = [...document.querySelectorAll(selector)];
    terminalSelectionDetails = {
      terminalId,
      rootSelected: explorerRoot?.dataset.explorerSelectedTerminal || "",
      representations: representations.length,
      pressed: representations.map(node => node.getAttribute("aria-pressed")),
      status: document.querySelector("[data-explorer-selected-terminal-status]")?.textContent?.trim() || "",
    };
    terminalSelectionAria =
      terminalSelectionDetails.rootSelected === terminalId &&
      representations.length >= 2 &&
      representations.every(node => node.getAttribute("aria-pressed") === "true") &&
      document.querySelector("[data-explorer-selected-terminal-status]")?.dataset
        .explorerSelectedTerminalStatus === terminalId;
    document.querySelector(
      '#labExplorer .lab-explorer-schematic-svg [data-explorer-terminal="' + CSS.escape(terminalId) + '"]',
    )?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTask();
  }
  record("v16-explorer-selected-terminal-aria-state",
    Boolean(terminalProbe && terminalSelectionAria),
    JSON.stringify(terminalSelectionDetails),
    "Terminal canonical được chọn phải có aria-pressed=true trên mọi representation và status text; bỏ chọn phải trở lại false.", "P1");

  const referenceToggle = explorerRoot?.querySelector("[data-explorer-reference-toggle]");
  let referenceFocusPreserved = false;
  if (referenceToggle) {
    referenceToggle.focus();
    referenceToggle.click();
    await nextTask();
    referenceFocusPreserved =
      document.activeElement?.hasAttribute?.("data-explorer-reference-toggle") === true &&
      document.activeElement?.getAttribute?.("aria-pressed") === "true" &&
      explorerRoot?.querySelector("[data-explorer-reference-view='on']");
  }
  record("v16-explorer-reference-toggle-focus-provenance",
    Boolean(referenceToggle && referenceFocusPreserved) &&
    /mẫu|reference|tham khảo/i.test(accessibleName(referenceToggle)) &&
    explorerRoot?.dataset.explorerSource === "learner-empty",
    JSON.stringify({
      toggleName: accessibleName(referenceToggle),
      focusPreserved: referenceFocusPreserved,
      source: explorerRoot?.dataset.explorerSource || "",
      activeTag: document.activeElement?.tagName || "",
    }),
    "Reference overlay phải có tên/trạng thái aria-pressed, giữ focus sau rerender và không đổi learner source.", "P1");

  const breadboardStudy = document.querySelector("#breadboardStudy");
  const breadboardControls = ["#bbProfile", "#bbHoleA", "#bbHoleB", "#bbCompare"]
    .map(selector => document.querySelector(selector));
  const breadboardResult = document.querySelector("#bbResult");
  const breadboardDiagram = document.querySelector("#bbTopologyDiagram");
  const breadboardWarning = document.querySelector("#bbMappingWarning");
  record("v16-breadboard-study-accessible-nonphysical-boundary",
    Boolean(breadboardStudy && accessibleName(breadboardStudy)) &&
    breadboardControls.every(control => control && accessibleName(control)) &&
    breadboardResult?.getAttribute("role") === "status" &&
    breadboardResult?.getAttribute("aria-live") === "polite" &&
    breadboardDiagram?.getAttribute("role") === "img" &&
    /khái niệm|không phải.*vật lý|không.*vật lý/i.test(accessibleName(breadboardDiagram)) &&
    /chưa.*ánh xạ|không.*dây|không.*3D/i.test(breadboardWarning?.textContent || "") &&
    breadboardWarning?.dataset.mapped === "false",
    JSON.stringify({
      sectionName: accessibleName(breadboardStudy),
      controlNames: breadboardControls.map(accessibleName),
      resultRole: breadboardResult?.getAttribute("role") || "",
      diagramName: accessibleName(breadboardDiagram),
      mapped: breadboardWarning?.dataset.mapped || "",
      warning: breadboardWarning?.textContent?.trim() || "",
    }),
    "Breadboard Study phải có tên/label/status, diagram có text alternative và disclosure chưa map lỗ vật lý/netlist.", "P1");

  const authoredBreadboard = document.querySelector("#bbAuthoredStudy");
  const authoredBreadboardControls = ["#bbTerminal", "#bbPlaceHole", "#bbAssignHole", "#bbRemoveHole"]
    .map(selector => document.querySelector(selector));
  const authoredBreadboardStatus = document.querySelector("#bbPlacementStatus");
  const authoredBreadboardList = document.querySelector("#bbPlacedList");
  const authoredBreadboardBoundary = document.querySelector("#bbAuthoredBoundary")?.textContent || "";
  record("post-v16-breadboard-authored-hole-controls-accessible-explicit-boundary",
    Boolean(authoredBreadboard && accessibleName(authoredBreadboard)) &&
    authoredBreadboardControls.every(control => control && accessibleName(control)) &&
    authoredBreadboardStatus?.getAttribute("role") === "status" &&
    authoredBreadboardStatus?.getAttribute("aria-live") === "polite" &&
    Boolean(accessibleName(authoredBreadboardList)) &&
    /do người dùng khai báo trong phiên/i.test(authoredBreadboardBoundary) &&
    /không phải.*đo|không phải kết quả đo/i.test(authoredBreadboardBoundary) &&
    /không.*kết nối điện|không.*tự sinh/i.test(authoredBreadboardBoundary) &&
    /không.*3D.*xác minh|3D.*chưa.*xác minh/i.test(authoredBreadboardBoundary),
    JSON.stringify({
      fieldsetName: accessibleName(authoredBreadboard),
      controlNames: authoredBreadboardControls.map(accessibleName),
      statusRole: authoredBreadboardStatus?.getAttribute("role") || "",
      statusLive: authoredBreadboardStatus?.getAttribute("aria-live") || "",
      listName: accessibleName(authoredBreadboardList),
      boundary: authoredBreadboardBoundary,
    }),
    "UI gán lỗ phải có legend/label/live status và nói rõ đây là khai báo trong phiên, không phải đo/kết nối điện/vị trí 3D đã xác minh.", "P1");

  const holePicker = document.querySelector("#bbHolePicker");
  const holeGrid = document.querySelector("#bbHoleGrid");
  const holeGridButtons = [...document.querySelectorAll(
    "#bbHoleGrid .breadboard-hole-grid-button",
  )];
  const holeGridColumns = [...document.querySelectorAll(
    "#bbHoleGrid [data-bb-grid-column]",
  )];
  const holeGridStatus = document.querySelector("#bbGridStatus");
  const holeGridPage = document.querySelector("#bbGridPage");
  const holePickerNav = ["#bbGridPrev", "#bbGridNext"].map(selector =>
    document.querySelector(selector));
  const genericRailControls = ["#bbGridRail", "#bbGridRailHole", "#bbPickRail"].map(
    selector => document.querySelector(selector));
  record("post-v16-breadboard-hole-picker-accessible-eight-column-input-only",
    holePicker?.getAttribute("role") === "group" && Boolean(accessibleName(holePicker)) &&
    holeGrid?.getAttribute("role") === "group" && Boolean(accessibleName(holeGrid)) &&
    holeGridColumns.length === 8 && holeGridButtons.length === 80 &&
    holeGridButtons.every(button => button.tagName === "BUTTON" &&
      Boolean(accessibleName(button)) && button.getAttribute("aria-pressed") !== null &&
      button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44) &&
    holePickerNav.every(button => button?.tagName === "BUTTON" && Boolean(accessibleName(button))) &&
    holeGridPage?.getAttribute("aria-live") === "polite" &&
    holeGridStatus?.getAttribute("role") === "status" &&
    holeGridStatus?.getAttribute("aria-live") === "polite" &&
    genericRailControls.every(control => control?.disabled === true) &&
    /chỉ điền ô|không tự gán|chưa tạo placement/i.test(holeGridStatus?.textContent || ""),
    JSON.stringify({
      pickerName: accessibleName(holePicker),
      gridName: accessibleName(holeGrid),
      columns: holeGridColumns.length,
      buttons: holeGridButtons.length,
      minWidth: Math.min(...holeGridButtons.map(button => button.getBoundingClientRect().width)),
      minHeight: Math.min(...holeGridButtons.map(button => button.getBoundingClientRect().height)),
      railDisabled: genericRailControls.map(control => control?.disabled),
      status: holeGridStatus?.textContent?.trim() || "",
    }),
    "Hole picker phải là group có tên, 8 cột/80 nút native >=44px, live status và rail generic bị khóa fail-closed.", "P1");

  const a1Picker = document.querySelector('#bbHoleGrid [data-bb-grid-hole="A1"]');
  a1Picker?.click();
  await nextTask();
  const contactMembers = [...document.querySelectorAll('#bbHoleGrid [data-bb-contact-member="true"]')];
  record("vnext-breadboard-profile-contact-group-explained-and-keyboard-accessible",
    contactMembers.length === 5 &&
    contactMembers.map(node=>node.dataset.bbGridHole).join(",") === "A1,B1,C1,D1,E1" &&
    document.querySelector("#bbHoleGrid")?.dataset.bbContactState === "known" &&
    document.querySelector('#bbHoleGrid [data-bb-contact-boundary="center-gap"]') !== null &&
    document.querySelector("#bbGridStatus")?.getAttribute("aria-live") === "polite" &&
    /profile|provenance/i.test(document.querySelector("#bbGridStatus")?.textContent||"") &&
    document.querySelectorAll("#bbPlacedList [data-bb-placement-item]").length === 0,
    JSON.stringify({members:contactMembers.map(x=>x.dataset.bbGridHole),
      state:document.querySelector("#bbHoleGrid")?.dataset.bbContactState}),
    "Lỗ A1 phải giải thích 5 tiếp điểm profile và rãnh giữa bằng nhãn, không tự gán placement.", "P1");

  const resistiveStudy = document.querySelector("#resistiveStudy");
  const resistiveControls = ["#resistiveV", "#resistiveR1", "#resistiveR2", "#resistiveSolve"]
    .map(selector => document.querySelector(selector));
  const resistiveResult = document.querySelector("#resistiveResult");
  const resistiveDetails = document.querySelector("#resistiveDetails");
  const resistiveBoundary = document.querySelector(".resistive-study-boundary")?.textContent || "";
  record("v16-resistive-study-accessible-standalone-boundary",
    Boolean(resistiveStudy && accessibleName(resistiveStudy)) &&
    resistiveControls.every(control => control && accessibleName(control)) &&
    resistiveResult?.getAttribute("role") === "status" &&
    resistiveResult?.getAttribute("aria-live") === "polite" &&
    Boolean(resistiveDetails?.getAttribute("aria-label")?.trim()) &&
    /không.*3D|không.*cảm biến|không.*firmware/i.test(
      document.querySelector(".resistive-study-body > p")?.textContent || "") &&
    /không hỗ trợ LED|không phải.*an toàn|không phải phần cứng|không phải.*Arduino/i.test(resistiveBoundary),
    JSON.stringify({
      sectionName: accessibleName(resistiveStudy),
      controlNames: resistiveControls.map(accessibleName),
      resultRole: resistiveResult?.getAttribute("role") || "",
      resultLive: resistiveResult?.getAttribute("aria-live") || "",
      detailsName: resistiveDetails?.getAttribute("aria-label") || "",
      boundary: resistiveBoundary,
    }),
    "Resistive Study cần label/status đọc được và disclosure rõ đây là mô hình toán học độc lập, không phải lesson/3D/firmware/phần cứng.", "P1");

  const topologySelect=document.querySelector("#resistiveTopology");
  const resistor3=document.querySelector("#resistiveR3");
  const branchModelBoundary=document.querySelector("#resistiveModelBoundary");
  record("vnext-resistive-branch-model-controls-native-accessible-ideal-only",
    topologySelect?.tagName==="SELECT" && Boolean(accessibleName(topologySelect)) &&
    topologySelect.value==="divider" &&
    [...topologySelect.options].map(option=>option.value).join(",")==="divider,branch" &&
    resistor3?.tagName==="INPUT" && Boolean(accessibleName(resistor3)) &&
    resistor3.getAttribute("min")==="1" && resistor3.getAttribute("max")==="1000000" &&
    resistor3.getBoundingClientRect().height>=44 &&
    topologySelect.getBoundingClientRect().height>=44 &&
    branchModelBoundary?.textContent?.includes("mạch của 16 bài học"),
    JSON.stringify({name:accessibleName(topologySelect),r3Name:accessibleName(resistor3),
      default:topologySelect?.value}),
    "Mode divider/branch và R3 phải có nhãn, target44px và mô hình toán học độc lập.","P1");

  document.querySelector("#resistiveSolve")?.click();
  await nextTask();
  const resistiveVisual = document.querySelector("[data-resistive-divider-visual]");
  const resistiveSvg = resistiveVisual?.querySelector("svg");
  const resistiveAssumptions = document.querySelector("[data-resistive-assumptions]")?.textContent || "";
  record("post-v16-resistive-divider-visual-accessible-source-verified",
    Boolean(resistiveVisual && resistiveSvg) &&
    resistiveSvg.getAttribute("role") === "img" &&
    /VCC.*R1.*MID.*R2.*GND/i.test(accessibleName(resistiveSvg)) &&
    /2[,.]5 V/i.test(accessibleName(resistiveSvg)) &&
    Boolean(document.querySelector("[data-resistive-divider-table]")) &&
    /nguồn DC lý tưởng do người học khai báo/i.test(resistiveAssumptions) &&
    /kết quả toán học của solver/i.test(resistiveAssumptions) &&
    /không phải phần cứng Arduino hoặc phép đo/i.test(resistiveAssumptions),
    JSON.stringify({
      visual: Boolean(resistiveVisual),
      svgRole: resistiveSvg?.getAttribute("role") || "",
      svgName: accessibleName(resistiveSvg),
      assumptions: resistiveAssumptions,
    }),
    "Divider visual phải có SVG text alternative và table equivalent, đồng thời tách rõ giá trị khai báo khỏi kết quả solver/phần cứng.", "P1");

  const cssText = allCssText();
  record("visible-focus-indicator-css",
    /:focus-visible/i.test(cssText) && /outline\s*:\s*[^;]*[2-9]px/i.test(cssText),
    /:focus-visible/i.test(cssText) ? "Có rule :focus-visible với outline." : "Không tìm thấy rule :focus-visible.",
    "Giữ focus indicator >=2px cho keyboard focus; kiểm tra thêm contrast 3:1 trên nền sáng/tối.", "P1");

  record("prefers-reduced-motion-css",
    /prefers-reduced-motion\s*:\s*reduce/i.test(cssText) &&
    /animation-duration\s*:\s*0?\.001ms\s*!important/i.test(cssText) &&
    /transition-duration\s*:\s*0?\.001ms\s*!important/i.test(cssText) &&
    /scroll-behavior\s*:\s*auto\s*!important/i.test(cssText),
    "Yêu cầu CSS: reduced-motion phải triệt animation/transition và smooth scrolling.",
    "Giữ media query prefers-reduced-motion: reduce; không thêm animation JS bỏ qua preference.", "P1");

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const reducedSamples = [".sidebar", ".lesson-link", ".button"].map(selector => {
      const node = [...document.querySelectorAll(selector)].find(visible) || document.querySelector(selector);
      return {
        selector,
        transitionMs: node ? maxTransitionMs(getComputedStyle(node).transitionDuration) : null,
      };
    });
    record("reduced-motion-live-computed",
      reducedSamples.every(item => item.transitionMs !== null && item.transitionMs <= 0.01) &&
      getComputedStyle(document.documentElement).scrollBehavior === "auto",
      JSON.stringify({ samples: reducedSamples, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior }),
      "Khi prefers-reduced-motion=reduce, giữ transition/animation thực tế gần 0 và smooth scrolling tắt.", "P1");
  } else {
    skip("reduced-motion-live-computed", "Browser context hiện tại không bật prefers-reduced-motion: reduce; static CSS contract vẫn chạy.");
  }

  // The UNO pinout accessibility contract above intentionally navigates away
  // from Practice and replaces #infoContent. Restore Practice before sampling
  // contrast so .learning-coach p is a real rendered text node rather than a
  // stale/missing selector. Keep the contrast gate strict: every sample must
  // still resolve to a non-null ratio and meet >=4.5:1.
  document.querySelector("#infoTabPractice")?.click();
  await nextTask();

  const contrastSelectors = [
    ".lesson-metadata",
    '.stage-tabs button[aria-selected="false"]',
    ".panel-index",
    ".avr-intro",
    ".avr-draft-note",
    ".code-disclaimer",
    ".app-footer",
    ".avr-metric small",
    ".live-pill",
    ".visual-legend",
    ".info-footer p",
    ".code-edit-status",
    ".avr-experiment-choice",
    ".avr-experiment-caveat",
    ".avr-input-field",
    ".avr-peripheral-state small",
    ".lab-editor-boundary",
    ".lab-status",
    ".lab-avr-status",
    ".learning-coach p",
    ".lab-explorer-heading p",
    ".lab-explorer-panel-title",
    ".lab-explorer-reference-label",
    ".lab-explorer-boundary-copy",
    ".lab-explorer-status",
    ".breadboard-study-hint",
    ".breadboard-study-result",
    ".breadboard-study-warning",
    ".resistive-study-body > p",
    ".resistive-study-status",
    ".resistive-study-boundary",
  ];
  const contrastSamples = contrastSelectors.map(selector => {
    if (selector === ".avr-peripheral-state small") {
      return {
        ...peripheralStateContrastSample,
        ratio: peripheralStateContrastSample.ratio === null
          ? null : Number(peripheralStateContrastSample.ratio.toFixed(2)),
      };
    }
    // Include temporarily hidden readouts (e.g., AVR metrics before firmware
    // load) so low-contrast text is caught before the user makes it visible.
    const node = [...document.querySelectorAll(selector)].find(visible)
      || document.querySelector(selector) || null;
    const ratio = node ? contrastRatio(node) : null;
    return { selector, ratio: ratio === null ? null : Number(ratio.toFixed(2)), text: node?.textContent?.trim().slice(0, 80) || "" };
  });
  const contrastFailures = contrastSamples.filter(sample => sample.ratio !== null && sample.ratio < 4.5);
  record("normal-text-contrast-samples",
    contrastSamples.every(sample => sample.ratio !== null) && contrastFailures.length === 0,
    JSON.stringify({ minimum: 4.5, samples: contrastSamples, failures: contrastFailures.map(item => item.selector) }),
    "Tăng độ tương phản các token chữ muted nhỏ; mục tiêu >=4.5:1 cho text bình thường. Ưu tiên lesson metadata, tab chưa chọn, panel labels, AVR explanatory text và disclaimer/footer.", "P1");

  const colorLegend = [...document.querySelectorAll(".visual-legend > span")];
  record("visual-color-legend-has-text",
    colorLegend.length >= 3 && colorLegend.every(item => item.textContent.trim().length > 2),
    `legend labels=${colorLegend.map(item => item.textContent.trim()).join(" | ")}`,
    "Không dùng màu đơn độc để truyền đạt trạng thái; giữ text/shape/state song song với màu.");

  if (matchMedia("(max-width: 1010px)").matches) {
    const sidebar = document.querySelector("#sidebar");
    const opener = document.querySelector("#openSidebar");
    record("mobile-drawer-closed-semantics",
      Boolean(sidebar?.inert) && sidebar?.getAttribute("aria-hidden") === "true" && opener?.getAttribute("aria-expanded") === "false",
      `inert=${Boolean(sidebar?.inert)}, aria-hidden=${sidebar?.getAttribute("aria-hidden")}, expanded=${opener?.getAttribute("aria-expanded")}`,
      "Khi drawer đóng trên mobile, giữ inert + aria-hidden=true và aria-expanded=false.", "P1");
    opener?.click();
    await nextTask();
    const openedCorrectly = sidebar?.classList.contains("is-open") && !sidebar?.inert &&
      sidebar?.getAttribute("aria-hidden") === "false" && opener?.getAttribute("aria-expanded") === "true" &&
      document.activeElement?.id === "closeSidebar";
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await nextTask();
    const closedCorrectly = !sidebar?.classList.contains("is-open") && Boolean(sidebar?.inert) &&
      sidebar?.getAttribute("aria-hidden") === "true" && opener?.getAttribute("aria-expanded") === "false" &&
      document.activeElement?.id === "openSidebar";
    record("mobile-drawer-focus-escape",
      Boolean(openedCorrectly && closedCorrectly),
      JSON.stringify({ openedCorrectly, closedCorrectly, activeElement: document.activeElement?.id || "" }),
      "Drawer mobile cần chuyển focus vào nút đóng khi mở; Escape phải đóng, inert lại sidebar và trả focus về nút mở.", "P1");
    const overflowDetails = {
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      peripheralModeVisible,
      avrRight: document.querySelector("#avrPanelMount")?.getBoundingClientRect().right ?? null,
      peripheralRight: peripheralInputs?.getBoundingClientRect().right ?? null,
    };
    record("mobile-peripheral-no-horizontal-overflow",
      peripheralModeVisible && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 &&
      (overflowDetails.avrRight === null || overflowDetails.avrRight <= document.documentElement.clientWidth + 1) &&
      (overflowDetails.peripheralRight === null || overflowDetails.peripheralRight <= document.documentElement.clientWidth + 1),
      JSON.stringify(overflowDetails),
      "Peripheral mode ở 375px phải hiển thị D2/A0 controls mà không làm document hoặc AVR panel tràn ngang viewport.", "P1");
  } else {
    skip("mobile-drawer-live-branch", "Viewport hiện tại >1010px; contract chỉ kiểm tra reduced-motion CSS tĩnh. Chạy lại ở mobile viewport để kiểm tra inert/focus drawer trực tiếp.");
  }

  const failed = results.filter(item => item.status === "FAIL");
  const passed = results.filter(item => item.status === "PASS");
  const skipped = results.filter(item => item.status === "SKIP");
  return Object.freeze({
    total: results.length,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    results: Object.freeze(results),
    blockers: Object.freeze(failed.filter(item => item.severity === "P1").map(item => item.name)),
  });
}
