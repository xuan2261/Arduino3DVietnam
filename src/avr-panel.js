/**
 * Standalone optional educational AVR CPU panel.
 *
 * The main "Chạy mô phỏng" button remains a bounded JS lesson demonstration.
 * This panel alone can execute genuine compiled AVR instructions after checking
 * the prebuilt Intel HEX against its source/manifest SHA-256. No C++ compilation,
 * no external device operations are implied. An explicit opt-in peripheral
 * experiment models only bounded MCU registers, never complete Uno hardware.
 */
import { loadVerifiedFirmware } from "./firmware-integrity.js";

const element = (tag, className, message) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (message !== undefined) node.textContent = String(message);
  return node;
};

const hexadecimal = value => "0x" + Number(value).toString(16).toUpperCase().padStart(4, "0");
const CYCLE_STEP = 25000;

export function mountAvrPanel(host) {
  if (!host?.isConnected) throw new Error("Vùng trình diễn AVR chưa được gắn vào trang.");
  const container = element("div", "avr-panel-inner");
  const heading = element("div", "avr-panel-heading");
  const title = element("h3", "", "Thực thi mã AVR đã biên dịch");
  title.id = "avrHeading";
  const subtitle = element("span", "avr-cpu-label", "CPU AVR8 · GIỚI HẠN");
  heading.append(title, subtitle);
  const explanation = element("p", "avr-intro",
    "Tải tệp HEX thật từ gói đã kiểm chứng SHA-256. Mặc định chỉ chạy lệnh CPU AVR; có thể chọn thí nghiệm ngoại vi có giới hạn. Không chạy Sketch đã sửa, không nạp bo hoặc điều khiển thiết bị vật lý.");

  const experimentChoice = element("label", "avr-experiment-choice");
  const peripheralCheckbox = element("input");
  peripheralCheckbox.type = "checkbox";
  peripheralCheckbox.id = "avrPeripheralMode";
  const experimentLabel = element("span", "",
    "Bật mô hình ngoại vi AVR thử nghiệm (GPIO, Timer0, ADC cố định, USART TX)");
  experimentChoice.append(peripheralCheckbox, experimentLabel);
  const experimentCaveat = element("p", "avr-experiment-caveat",
    "Tùy chọn này dùng thanh ghi từ firmware thật nhưng KHÔNG tái tạo toàn bộ Arduino Uno: chưa hỗ trợ PWM waveform, timer1/2, USART RX, cảm biến, động cơ, delay/millis parity hoặc phép đo điện. Thao tác Chạy mô phỏng ở trên vẫn độc lập.");

  const peripheralInputs = element("div", "avr-experiment-inputs");
  peripheralInputs.id = "avrPeripheralInputs";
  peripheralInputs.hidden = true;
  const digitalLabel = element("label", "avr-input-field");
  const digitalText = element("span", "", "D2 · tín hiệu ngoài do người học đặt");
  const digitalSelect = element("select");
  digitalSelect.id = "avrD2Input";
  for (const [value, name] of [["floating", "Không xác định / thả nổi"], ["low", "LOW do người học đặt"], ["high", "HIGH do người học đặt"]]) {
    const option = element("option", "", name);
    option.value = value;
    digitalSelect.append(option);
  }
  digitalLabel.append(digitalText, digitalSelect);
  const analogLabel = element("label", "avr-input-field");
  const analogText = element("span", "", "ADC0 / A0 · điện áp cố định giả định (mV)");
  const analogInput = element("input");
  analogInput.id = "avrA0Input";
  analogInput.type = "number";
  analogInput.min = "0";
  analogInput.max = "5500";
  analogInput.step = "1";
  analogInput.placeholder = "Không khai báo";
  const applyAnalogButton = element("button", "button avr-button-secondary", "Áp dụng A0");
  applyAnalogButton.type = "button";
  applyAnalogButton.id = "avrApplyA0";
  analogLabel.append(analogText, analogInput);
  peripheralInputs.append(digitalLabel, analogLabel, applyAnalogButton);
  const peripheralState = element("div", "avr-peripheral-state");
  peripheralState.id = "avrPeripheralState";
  peripheralState.setAttribute("role", "status");
  peripheralState.setAttribute("aria-live", "polite");
  peripheralState.hidden = true;

  const actions = element("div", "avr-actions");
  const loadButton = element("button", "button avr-button-primary", "Nạp firmware mẫu (.hex)");
  loadButton.id = "avrLoad";
  loadButton.type = "button";
  const stepButton = element("button", "button avr-button-secondary", "Thực thi 1 lệnh");
  stepButton.id = "avrStep";
  stepButton.type = "button";
  stepButton.disabled = true;
  const cycleButton = element("button", "button avr-button-secondary", "Thực thi 25.000 chu kỳ");
  cycleButton.id = "avrCycle";
  cycleButton.type = "button";
  cycleButton.disabled = true;
  const resetButton = element("button", "button avr-button-secondary", "Khởi tạo CPU mới");
  resetButton.id = "avrReset";
  resetButton.type = "button";
  resetButton.disabled = true;
  actions.append(loadButton, stepButton, cycleButton, resetButton);

  const status = element("p", "avr-status", "Chưa nạp firmware. Mô phỏng bài học phía trên hoạt động độc lập.");
  status.id = "avrStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const metrics = element("div", "avr-metrics");
  metrics.id = "avrMetrics";
  metrics.hidden = true;
  const pcMetric = element("div", "avr-metric");
  const cyclesMetric = element("div", "avr-metric");
  const ddrbMetric = element("div", "avr-metric");
  const portbMetric = element("div", "avr-metric");
  const metric = (parent, label, value) => {
    parent.append(element("small", "", label), element("strong", "", value));
  };
  metric(pcMetric, "PC (địa chỉ CPU)", "—");
  metric(cyclesMetric, "Chu kỳ AVR", "0");
  metric(ddrbMetric, "DDRB (thanh ghi thô)", "—");
  metric(portbMetric, "PORTB (thanh ghi thô)", "—");
  metrics.append(pcMetric, cyclesMetric, ddrbMetric, portbMetric);
  const provenance = element("p", "avr-provenance", "");
  provenance.id = "avrProvenance";
  const caveat = element("p", "avr-caveat",
    "Giới hạn: đây là máy ảo AVR và ngoại vi thử nghiệm tùy chọn, không phải Arduino Uno đầy đủ. Không suy trạng thái đèn 3D, cảm biến, dòng điện, hay Serial giả lập phía trên từ các thanh ghi CPU này.");
  const draftNote = element("p", "avr-draft-note", "");
  draftNote.id = "avrDraftNote";
  container.append(heading, explanation, experimentChoice, experimentCaveat,
    actions, status, metrics, peripheralInputs, peripheralState, provenance, draftNote, caveat);
  host.replaceChildren(container);

  let lessonId = 1;
  let changedDraft = false;
  let runner = null;
  let verified = null;
  let nonce = 0;
  let disposed = false;
  let requiresReload = false;
  let loadedMode = "cpu";

  function disposeRunner() {
    runner?.dispose?.();
    runner = null;
  }

  function updatePeripheralState() {
    if (loadedMode !== "peripheral" || !runner) {
      peripheralState.hidden = true;
      peripheralState.replaceChildren();
      return;
    }
    const snap = runner.snapshot();
    const d13 = snap.boardD13;
    const level = d13.level === null ? "chưa xác định" : d13.level ? "HIGH" : "LOW";
    const timer = snap.timer0;
    const adc = snap.analogSerial;
    const configuredA0 = adc.analogInputsMillivolts[0];
    const txBytes = runner.getTxBytes();
    const lastBytes = [...txBytes.slice(-32)].map(value =>
      value >= 32 && value <= 126 ? String.fromCharCode(value) : "\\x" + value.toString(16).padStart(2, "0").toUpperCase(),
    ).join("");
    peripheralState.hidden = false;
    peripheralState.replaceChildren(
      element("p", "", `GPIO PB5 / Arduino D13: ${d13.mode} · ${level}${d13.contention ? " · mức ngoài xung đột (không tính dòng)" : ""}`),
      element("p", "", `Timer0: TCNT0=${timer.tcnt0} · TOV0=${timer.tov0 ? "1" : "0"} · prescaler ${timer.divider || "dừng"} · ${timer.mode}`),
      element("p", "", `ADC0/A0: ${configuredA0 === null ? "chưa nhập điện áp" : configuredA0 + " mV do người học đặt"} · ${adc.adc.conversionsCompleted} lần chuyển đổi CPU`),
      element("p", "", `USART0 TX: ${txBytes.length} byte thực do firmware ghi${txBytes.length ? " · cuối dòng: " + lastBytes : " · chưa phát byte"}`),
      element("small", "", "Các trạng thái do register hook/clock AVR tạo ra trong bộ nhớ ảo; không phải điện áp đo, LED/motor vật lý hay Serial Monitor giả lập phía trên."),
    );
  }

  function renderSnapshot() {
    if (!runner) return;
    const current = runner.snapshot();
    metrics.hidden = false;
    pcMetric.querySelector("strong").textContent = hexadecimal(current.pcBytes);
    cyclesMetric.querySelector("strong").textContent = current.cycles.toLocaleString("vi-VN");
    ddrbMetric.querySelector("strong").textContent = hexadecimal(runner.readData(0x24));
    portbMetric.querySelector("strong").textContent = hexadecimal(runner.readData(0x25));
    updatePeripheralState();
  }

  function setDraftChanged(hasDraft) {
    changedDraft = Boolean(hasDraft);
    draftNote.textContent = changedDraft
      ? "Mã đã sửa trong tab này chưa được biên dịch. Firmware đang dùng luôn là bản mẫu đi kèm dự án."
      : "Firmware chỉ được tạo từ mã mẫu đã biên dịch trên GitHub Actions, không phải từ thao tác Chạy mô phỏng.";
  }

  function setLesson(value, hasDraft = false) {
    if (disposed) return;
    if (!Number.isInteger(value) || value < 1 || value > 16) throw new RangeError("Bài học AVR không hợp lệ");
    nonce++;
    lessonId = value;
    disposeRunner();
    verified = null;
    loadedMode = "cpu";
    digitalSelect.value = "floating";
    analogInput.value = "";
    peripheralInputs.hidden = true;
    peripheralState.hidden = true;
    peripheralState.replaceChildren();
    stepButton.disabled = true;
    cycleButton.disabled = true;
    resetButton.disabled = true;
    loadButton.disabled = false;
    loadButton.textContent = "Nạp firmware mẫu bài " + String(value).padStart(2, "0");
    metrics.hidden = true;
    status.dataset.kind = "";
    status.textContent = "Chưa nạp HEX bài " + String(value).padStart(2, "0") + ".";
    provenance.textContent = "";
    setDraftChanged(hasDraft);
    if (requiresReload) invalidateForAssetUpdate();
  }

  function invalidateForAssetUpdate() {
    if (disposed) return;
    // Once a new Service Worker takes control, fetching new firmware under
    // an already-loaded old lesson module could mix two code revisions.
    requiresReload = true;
    nonce++;
    disposeRunner();
    verified = null;
    peripheralInputs.hidden = true;
    peripheralState.hidden = true;
    loadButton.disabled = true;
    stepButton.disabled = true;
    cycleButton.disabled = true;
    resetButton.disabled = true;
    metrics.hidden = true;
    provenance.textContent = "";
    status.dataset.kind = "error";
    status.textContent = "Website đã cập nhật tài nguyên. Hãy lưu Sketch đang sửa rồi tải lại trang trước khi nạp firmware để tránh trộn phiên bản.";
  }

  async function load() {
    if (disposed || requiresReload) return;
    const targetLesson = lessonId;
    const requested = ++nonce;
    const requestedMode = peripheralCheckbox.checked ? "peripheral" : "cpu";
    disposeRunner();
    verified = null;
    metrics.hidden = true;
    peripheralInputs.hidden = true;
    peripheralState.hidden = true;
    loadButton.disabled = true;
    stepButton.disabled = true;
    cycleButton.disabled = true;
    resetButton.disabled = true;
    status.dataset.kind = "loading";
    status.textContent = "Đang kiểm tra nguồn bài học và SHA-256 của firmware...";
    try {
      const firmware = await loadVerifiedFirmware(targetLesson);
      if (disposed || requested !== nonce) return;
      // Import the vendored AVR core only AFTER the artifact has passed
      // integrity checks. The runtime itself never makes network requests.
      if (requestedMode === "peripheral") {
        const { createAvrBoardRunner, AVR_BOARD_LAB_CAPABILITIES } = await import("./avr-board-runner.js");
        if (disposed || requested !== nonce) return;
        if (AVR_BOARD_LAB_CAPABILITIES.completeArduinoUno !== false ||
            AVR_BOARD_LAB_CAPABILITIES.physicalHardware !== false ||
            !AVR_BOARD_LAB_CAPABILITIES.gpioRegisterPinStates) {
          throw new Error("Ngoại vi thử nghiệm không công bố ranh giới hỗ trợ hợp lệ.");
        }
        runner = createAvrBoardRunner(firmware.hexText);
      } else {
        const { createAvrRunner, AVR_RUNTIME_CAPABILITIES } = await import("./avr-runtime.js");
        if (disposed || requested !== nonce) return;
        if (AVR_RUNTIME_CAPABILITIES.gpio || AVR_RUNTIME_CAPABILITIES.timers ||
            AVR_RUNTIME_CAPABILITIES.usart || !AVR_RUNTIME_CAPABILITIES.cpuInstructions) {
          throw new Error("Không chấp nhận tuyên bố peripheral không khớp backend CPU-only.");
        }
        runner = createAvrRunner(firmware.hexText);
      }
      loadedMode = requestedMode;
      verified = firmware;
      status.dataset.kind = "success";
      status.textContent = requestedMode === "peripheral"
        ? "Đã xác minh SHA-256 và nạp CPU AVR kèm ngoại vi có giới hạn. Các trạng thái chỉ từ thanh ghi/tín hiệu được khai báo, không phải mô phỏng Uno đầy đủ."
        : "Đã xác minh SHA-256 và nạp firmware vào bộ nhớ ảo. Có thể thực thi lệnh CPU AVR thật.";
      provenance.textContent = "Nguồn Git " + firmware.sourceCommit.slice(0, 12)
        + " · SHA-256 HEX " + firmware.firmwareSha256.slice(0, 16)
        + "… · Arduino CLI " + firmware.toolchain.arduino_cli;
      stepButton.disabled = false;
      cycleButton.disabled = false;
      resetButton.disabled = false;
      peripheralInputs.hidden = requestedMode !== "peripheral";
      renderSnapshot();
    } catch (error) {
      if (disposed || requested !== nonce) return;
      disposeRunner();
      verified = null;
      peripheralState.hidden = true;
      peripheralInputs.hidden = true;
      status.dataset.kind = "error";
      status.textContent = "Không thể nạp firmware: " + String(error?.message || "lỗi chưa xác định");
      provenance.textContent = "";
    } finally {
      if (!disposed && requested === nonce) loadButton.disabled = false;
    }
  }

  function step() {
    if (!runner || !verified || disposed || requiresReload) return;
    try {
      const execution = runner.step();
      renderSnapshot();
      status.dataset.kind = "success";
      status.textContent = "Đã thực thi 1 lệnh AVR (" + execution.cycles
        + " chu kỳ). Đây là lệnh CPU, không phải cập nhật linh kiện ngoài.";
    } catch (error) {
      status.dataset.kind = "error";
      status.textContent = "CPU dừng do giới hạn/lỗi: " + String(error?.message || "không rõ");
      disposeRunner();
      peripheralState.hidden = true;
      stepButton.disabled = true;
      cycleButton.disabled = true;
      resetButton.disabled = true;
    }
  }

  function run() {
    if (!runner || !verified || disposed || requiresReload) return;
    cycleButton.disabled = true;
    try {
      const execution = runner.runCycles(CYCLE_STEP);
      renderSnapshot();
      status.dataset.kind = "success";
      status.textContent = "Đã thực thi " + execution.instructions.toLocaleString("vi-VN")
        + " lệnh AVR (" + execution.executedCycles.toLocaleString("vi-VN")
        + (loadedMode === "peripheral"
          ? " chu kỳ). Ngoại vi chỉ tính các thanh ghi trong phạm vi có hỗ trợ; không có cảm biến/đèn vật lý."
          : " chu kỳ). Không có giả lập timer/đèn ngoài.");
    } catch (error) {
      status.dataset.kind = "error";
      status.textContent = "CPU dừng do giới hạn/lỗi: " + String(error?.message || "không rõ");
      disposeRunner();
      peripheralState.hidden = true;
      stepButton.disabled = true;
      resetButton.disabled = true;
    } finally {
      cycleButton.disabled = !runner;
    }
  }

  function reset() {
    if (!verified || disposed || requiresReload) return;
    const requested = nonce;
    const sourceFirmware = verified;
    const sourceMode = loadedMode;
    // A new runner clears SRAM as well as CPU state (CPU.reset alone does not).
    import(sourceMode === "peripheral" ? "./avr-board-runner.js" : "./avr-runtime.js").then(module => {
      if (disposed || requiresReload || nonce !== requested || verified !== sourceFirmware) return;
      const next = sourceMode === "peripheral"
        ? module.createAvrBoardRunner(sourceFirmware.hexText)
        : module.createAvrRunner(sourceFirmware.hexText);
      disposeRunner();
      runner = next;
      loadedMode = sourceMode;
      digitalSelect.value = "floating";
      analogInput.value = "";
      stepButton.disabled = false;
      cycleButton.disabled = false;
      resetButton.disabled = false;
      status.dataset.kind = "success";
      status.textContent = "Đã khởi tạo CPU/flash/SRAM ảo mới từ firmware đã kiểm chứng. Các giá trị đầu vào ngoài đã trở về chưa xác định.";
      renderSnapshot();
    }).catch(error => {
      if (disposed || requiresReload || nonce !== requested || verified !== sourceFirmware) return;
      // The requested clean restart failed: do not leave an old CPU runner
      // executable while the UI claims it has just been reset.
      disposeRunner();
      verified = null;
      metrics.hidden = true;
      peripheralInputs.hidden = true;
      peripheralState.hidden = true;
      peripheralState.replaceChildren();
      stepButton.disabled = true;
      cycleButton.disabled = true;
      resetButton.disabled = true;
      provenance.textContent = "";
      status.dataset.kind = "error";
      status.textContent = "Không thể khởi tạo CPU: " + String(error?.message || "không rõ") + ". Cần nạp lại firmware để tiếp tục.";
    });
  }

  function onPeripheralModeChange() {
    if (disposed) return;
    setLesson(lessonId, changedDraft);
    if (!requiresReload) {
      status.textContent = peripheralCheckbox.checked
        ? "Đã chọn thí nghiệm ngoại vi AVR có giới hạn. Hãy nạp lại firmware mẫu để dùng các thanh ghi được hỗ trợ."
        : "Đã trở lại chế độ CPU-only. Hãy nạp lại firmware mẫu.";
    }
  }

  function onDigitalInputChange() {
    if (!runner || loadedMode !== "peripheral" || disposed || requiresReload) return;
    const requested = digitalSelect.value;
    const level = requested === "high" ? true : requested === "low" ? false : null;
    try {
      runner.setExternalPin("D2", level);
      updatePeripheralState();
      status.dataset.kind = "success";
      status.textContent = "Đã khai báo D2: " + requested + ". Đây là đầu vào giả định do bạn đặt, không phải tín hiệu đo từ phần cứng.";
    } catch (error) {
      status.dataset.kind = "error";
      status.textContent = "Không thể khai báo D2: " + String(error?.message || "không rõ");
    }
  }

  function onAnalogInputApply() {
    if (!runner || loadedMode !== "peripheral" || disposed || requiresReload) return;
    try {
      const raw = analogInput.value.trim();
      if (raw === "") {
        runner.clearAnalogInput(0);
      } else {
        const voltage = Number(raw);
        if (!Number.isInteger(voltage) || voltage < 0 || voltage > 5500) {
          throw new RangeError("A0 phải là số nguyên từ 0 đến 5500 mV, hoặc bỏ trống để giữ chưa xác định.");
        }
        runner.setAnalogInputMillivolts(0, voltage);
      }
      updatePeripheralState();
      status.dataset.kind = "success";
      status.textContent = raw === ""
        ? "A0 đã trở về chưa xác định; chưa có giá trị cảm biến thật."
        : "A0 được đặt ở " + raw + " mV theo giả định thủ công; chỉ ảnh hưởng chuyển đổi ADC thực từ firmware.";
    } catch (error) {
      status.dataset.kind = "error";
      status.textContent = "Không thể khai báo A0: " + String(error?.message || "không rõ");
    }
  }

  peripheralCheckbox.addEventListener("change", onPeripheralModeChange);
  digitalSelect.addEventListener("change", onDigitalInputChange);
  applyAnalogButton.addEventListener("click", onAnalogInputApply);
  loadButton.addEventListener("click", load);
  stepButton.addEventListener("click", step);
  cycleButton.addEventListener("click", run);
  resetButton.addEventListener("click", reset);
  setLesson(1, false);

  return {
    setLesson,
    setDraftChanged,
    invalidateForAssetUpdate,
    dispose() {
      if (disposed) return;
      disposed = true;
      nonce++;
      disposeRunner();
      verified = null;
      peripheralCheckbox.removeEventListener("change", onPeripheralModeChange);
      digitalSelect.removeEventListener("change", onDigitalInputChange);
      applyAnalogButton.removeEventListener("click", onAnalogInputApply);
      loadButton.removeEventListener("click", load);
      stepButton.removeEventListener("click", step);
      cycleButton.removeEventListener("click", run);
      resetButton.removeEventListener("click", reset);
      host.replaceChildren();
    },
  };
}
