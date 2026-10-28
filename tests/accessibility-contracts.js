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
  ];
  const contrastSamples = contrastSelectors.map(selector => {
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
