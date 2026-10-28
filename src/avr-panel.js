/**
 * Standalone optional educational AVR CPU panel.
 *
 * The main "Chạy mô phỏng" button remains a bounded JS lesson demonstration.
 * This panel alone can execute genuine compiled AVR instructions after checking
 * the prebuilt Intel HEX against its source/manifest SHA-256. No C++ compilation,
 * no external device operations and no peripheral/LED/ADC simulation are implied.
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
    "Tải tệp HEX thật từ gói đã kiểm chứng SHA-256. Công cụ chạy lệnh CPU, không chạy trực tiếp Sketch đã sửa và chưa mô phỏng Timer, GPIO, ADC, Serial hay các linh kiện ngoài.");

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
    "Giới hạn: đây là lõi CPU AVR, không phải mô phỏng hoàn chỉnh Arduino Uno. DDRB/PORTB chỉ là thanh ghi máy ảo; trạng thái đèn 3D và Serial phía trên không được suy từ CPU này.");
  const draftNote = element("p", "avr-draft-note", "");
  draftNote.id = "avrDraftNote";
  container.append(heading, explanation, actions, status, metrics, provenance, draftNote, caveat);
  host.replaceChildren(container);

  let lessonId = 1;
  let changedDraft = false;
  let runner = null;
  let verified = null;
  let nonce = 0;
  let disposed = false;
  let requiresReload = false;

  function renderSnapshot() {
    if (!runner) return;
    const current = runner.snapshot();
    metrics.hidden = false;
    pcMetric.querySelector("strong").textContent = hexadecimal(current.pcBytes);
    cyclesMetric.querySelector("strong").textContent = current.cycles.toLocaleString("vi-VN");
    ddrbMetric.querySelector("strong").textContent = hexadecimal(runner.readData(0x24));
    portbMetric.querySelector("strong").textContent = hexadecimal(runner.readData(0x25));
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
    runner = null;
    verified = null;
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
    runner = null;
    verified = null;
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
    runner = null;
    verified = null;
    metrics.hidden = true;
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
      const { createAvrRunner, AVR_RUNTIME_CAPABILITIES } = await import("./avr-runtime.js");
      if (disposed || requested !== nonce) return;
      if (AVR_RUNTIME_CAPABILITIES.gpio || AVR_RUNTIME_CAPABILITIES.timers ||
          AVR_RUNTIME_CAPABILITIES.usart || !AVR_RUNTIME_CAPABILITIES.cpuInstructions) {
        throw new Error("Không chấp nhận tuyên bố peripheral không khớp backend CPU-only.");
      }
      runner = createAvrRunner(firmware.hexText);
      verified = firmware;
      status.dataset.kind = "success";
      status.textContent = "Đã xác minh SHA-256 và nạp firmware vào bộ nhớ ảo. Có thể thực thi lệnh CPU AVR thật.";
      provenance.textContent = "Nguồn Git " + firmware.sourceCommit.slice(0, 12)
        + " · SHA-256 HEX " + firmware.firmwareSha256.slice(0, 16)
        + "… · Arduino CLI " + firmware.toolchain.arduino_cli;
      stepButton.disabled = false;
      cycleButton.disabled = false;
      resetButton.disabled = false;
      renderSnapshot();
    } catch (error) {
      if (disposed || requested !== nonce) return;
      runner = null;
      verified = null;
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
      runner = null;
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
        + " chu kỳ). Không có giả lập timer/đèn ngoài.";
    } catch (error) {
      status.dataset.kind = "error";
      status.textContent = "CPU dừng do giới hạn/lỗi: " + String(error?.message || "không rõ");
      runner = null;
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
    // A new runner clears SRAM as well as CPU state (CPU.reset alone does not).
    import("./avr-runtime.js").then(({ createAvrRunner }) => {
      if (disposed || requiresReload || nonce !== requested || verified !== sourceFirmware) return;
      runner = createAvrRunner(sourceFirmware.hexText);
      stepButton.disabled = false;
      cycleButton.disabled = false;
      resetButton.disabled = false;
      status.dataset.kind = "success";
      status.textContent = "Đã khởi tạo CPU/flash/SRAM ảo mới từ firmware đã kiểm chứng.";
      renderSnapshot();
    }).catch(error => {
      if (disposed || requiresReload || nonce !== requested || verified !== sourceFirmware) return;
      status.dataset.kind = "error";
      status.textContent = "Không thể khởi tạo CPU: " + String(error?.message || "không rõ");
    });
  }

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
      runner = null;
      verified = null;
      loadButton.removeEventListener("click", load);
      stepButton.removeEventListener("click", step);
      cycleButton.removeEventListener("click", run);
      resetButton.removeEventListener("click", reset);
      host.replaceChildren();
    },
  };
}
