// Chạy trong browser: import("/tests/scene-wiring-contracts.js").then(m => m.runSceneWiringContracts())
import {
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  createSampleCircuit,
  listTerminals,
  supportedWiringLessons,
} from "../src/circuit-router.js";

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

const makeHost = () => {
  const host = document.createElement("div");
  host.className = "scene-mount";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:760px;height:430px";
  document.body.append(host);
  return host;
};

export async function runSceneWiringContracts() {
  const { mountScene } = await import(`../src/scene3d.js?scene-wiring-contracts=${Date.now()}`);
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const realRaf = window.requestAnimationFrame;
  const realCancelRaf = window.cancelAnimationFrame;
  let nextFrameId = 1;
  const queuedFrames = new Map();
  window.requestAnimationFrame = callback => {
    const id = nextFrameId++;
    queuedFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => queuedFrames.delete(id);
  const flushFrames = () => {
    const frames = [...queuedFrames.values()];
    queuedFrames.clear();
    frames.forEach(callback => callback(performance.now()));
  };

  const host = makeHost();
  let mounted;
  try {
    mounted = mountScene(host);
    mounted.setLesson({ id: 2, wiring: ["D13 → R → LED → GND"] });
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("optional-setWiring-api", typeof mounted.setWiring === "function");
    check("lesson-starts-without-invented-net-layer",
      canvas.dataset.wiringMode === "none" && canvas.dataset.wiringWireCount === "0");

    const sample = createSampleCircuit(2);
    const terminals = listTerminals(2);
    const analysis = analyzeCircuit(2, sample);
    const summary = mounted.setWiring(sample, terminals, analysis);
    check("sample-wire-count", summary.shownWires === sample.wires.length && summary.omittedWires === 0);
    check("sample-net-count", summary.netCount === analysis.nets.length);
    check("sample-topology-checked", summary.status === "checked" && summary.analysisSupported === true);
    check("no-physical-hole-claim", summary.physicalMapping === "none" && canvas.dataset.wiringPhysicalMap === "none");
    check("conceptual-mode-exposed", canvas.dataset.wiringMode === "conceptual-netlist");
    check("conceptual-disclaimer-accessible",
      /khái niệm/i.test(canvas.getAttribute("aria-label") || "") &&
      /không phải vị trí lỗ/i.test(canvas.getAttribute("aria-label") || ""));
    check("wiring-invalidation-on-demand", queuedFrames.size === 1);
    flushFrames();
    check("wiring-no-animation-loop", queuedFrames.size === 0);

    const bad = connectCircuit(createCircuit(2), "D13", "GND");
    const badAnalysis = analyzeCircuit(2, bad);
    const badSummary = mounted.setWiring(bad, terminals, badAnalysis);
    check("error-net-highlight-state", badSummary.status === "error" && canvas.dataset.wiringStatus === "error");
    check("error-wire-still-shown-conceptually", badSummary.shownWires === 1 && badSummary.netCount === 1);
    flushFrames();

    const incompleteTerminals = terminals.filter(item => item.id !== "GND");
    const incomplete = mounted.setWiring(bad, incompleteTerminals, badAnalysis);
    check("unmapped-terminal-omitted", incomplete.shownWires === 0 && incomplete.omittedWires === 1);
    check("unmapped-does-not-invent-physical-location", incomplete.physicalMapping === "none");
    flushFrames();

    const unverified = mounted.setWiring(sample, terminals, null);
    check("missing-analysis-is-unverified", unverified.status === "unverified" && unverified.netCount === 0);
    check("raw-wires-remain-explicitly-conceptual", unverified.shownWires === sample.wires.length);
    flushFrames();

    const gl = canvas.getContext("webgl2");
    const loseContext = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (loseContext) loseContext.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await lostPromise;
    check("context-loss-pauses-wiring-render", queuedFrames.size === 0);
    await waitTask();
    const restoredPromise = waitEvent(canvas, "webglcontextrestored");
    if (loseContext) loseContext.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restoredPromise;
    check("context-restore-invalidates-wiring", queuedFrames.size === 1);
    flushFrames();
    const afterRestore = mounted.setWiring(sample, terminals, analysis);
    check("wiring-replace-after-restore", afterRestore.status === "checked" && afterRestore.shownWires === sample.wires.length);
    flushFrames();

    for (const lessonId of supportedWiringLessons()) {
      mounted.setLesson({ id: lessonId, wiring: [] });
      const state = createSampleCircuit(lessonId);
      const lessonTerminals = listTerminals(lessonId);
      const lessonAnalysis = analyzeCircuit(lessonId, state);
      const lessonSummary = mounted.setWiring(state, lessonTerminals, lessonAnalysis);
      check(`lesson-${lessonId}-sample-wiring`,
        lessonSummary.status === "checked" &&
        lessonSummary.shownWires === state.wires.length &&
        lessonSummary.omittedWires === 0 &&
        lessonSummary.physicalMapping === "none");
      flushFrames();
    }

    mounted.setLesson({ id: 3, wiring: ["5V → nút → D2"] });
    check("lesson-change-clears-old-net-layer", canvas.dataset.wiringMode === "none" && canvas.dataset.wiringWireCount === "0");
    let mismatchRejected = false;
    try { mounted.setWiring(sample, terminals, analysis); }
    catch (error) { mismatchRejected = error instanceof RangeError; }
    check("cross-lesson-netlist-rejected", mismatchRejected && canvas.dataset.wiringMode === "none");

    const cleared = mounted.setWiring(null);
    check("explicit-clear", cleared.mode === "none" && canvas.dataset.wiringMode === "none");
    check("clear-restores-base-accessible-label", !/khái niệm/i.test(canvas.getAttribute("aria-label") || ""));

    mounted.dispose();
    mounted = null;
    check("dispose-removes-wiring-canvas", !canvas.isConnected && queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
