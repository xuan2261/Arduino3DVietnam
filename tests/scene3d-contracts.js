// Chạy trong browser: import("/tests/scene3d-contracts.js").then(m => m.runScene3DContracts())

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

export async function runScene3DContracts() {
  const { mountScene } = await import(`../src/scene3d.js?scene3d-contracts=${Date.now()}`);
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const detached = document.createElement("div");
  let detachedRejected = false;
  try { mountScene(detached); } catch (error) { detachedRejected = /3D/.test(error.message); }
  check("detached-host-rejected", detachedRejected);

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
    let rounds = 0;
    while (queuedFrames.size && rounds++ < 10) {
      const batch = [...queuedFrames.values()];
      queuedFrames.clear();
      for (const callback of batch) callback(performance.now());
    }
  };
  const makeHost = () => {
    const host = document.createElement("div");
    host.className = "scene-mount";
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:640px;height:360px";
    document.body.append(host);
    return host;
  };

  let host;
  let mounted;
  try {
    host = makeHost();
    let selected = 0;
    mounted = mountScene(host, () => { selected += 1; });
    mounted.setLesson({ id: 5, wiring: ["D11 → RGB", "D10 → RGB", "GND → RGB"] });
    await waitTask();
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("mount-one-canvas", canvas instanceof HTMLCanvasElement && host.querySelectorAll("canvas").length === 1);
    check("canvas-focusable", canvas.tabIndex === 0);
    check("canvas-accessible-role", canvas.getAttribute("role") === "application");
    check("canvas-keyboard-help", /mũi tên/i.test(canvas.getAttribute("aria-label") || "") && /Enter/i.test(canvas.getAttribute("aria-label") || ""));
    check("canvas-keyshortcuts", /ArrowLeft/.test(canvas.getAttribute("aria-keyshortcuts") || "") && /Home/.test(canvas.getAttribute("aria-keyshortcuts") || ""));
    check("touch-preserves-page-scroll", getComputedStyle(canvas).touchAction === "pan-y");

    canvas.focus();
    const arrow = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
    check("keyboard-arrow-handled", !canvas.dispatchEvent(arrow) && arrow.defaultPrevented);
    const zoom = new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true });
    check("keyboard-zoom-handled", !canvas.dispatchEvent(zoom) && zoom.defaultPrevented);
    const reset = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    check("keyboard-reset-handled", !canvas.dispatchEvent(reset) && reset.defaultPrevented);
    const activate = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    canvas.dispatchEvent(activate);
    check("keyboard-select", activate.defaultPrevented && selected === 1);

    flushFrames();
    mounted.control("left");
    mounted.control("right");
    check("render-invalidations-coalesce", queuedFrames.size === 1);
    flushFrames();
    check("render-stays-on-demand", queuedFrames.size === 0);

    const otherFocus = document.createElement("button");
    host.append(otherFocus);
    otherFocus.focus();
    const inactiveKey = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    canvas.dispatchEvent(inactiveKey);
    check("keyboard-requires-canvas-focus", !inactiveKey.defaultPrevented && queuedFrames.size === 0);
    otherFocus.remove();

    canvas.setPointerCapture = () => {};
    canvas.releasePointerCapture = () => {};
    const beforeCancel = selected;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 41, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 41, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    check("pointer-cancel-does-not-select", selected === beforeCancel);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 42, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: 0, pointerId: 42, pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
    check("touch-tap-selects", selected === beforeCancel + 1);

    flushFrames();
    const gl = canvas.getContext("webgl2");
    const contextExtension = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (contextExtension) contextExtension.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const lost = await lostPromise;
    check("context-loss-cancelled", lost.defaultPrevented);
    mounted.control("left");
    check("context-loss-pauses-render", queuedFrames.size === 0);
    // Restoration is only allowed after the cancelable context-lost event has
    // fully returned to the browser event loop.
    await waitTask();
    const restoredPromise = waitEvent(canvas, "webglcontextrestored");
    if (contextExtension) contextExtension.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restoredPromise;
    check("context-restore-invalidates", queuedFrames.size === 1);
    flushFrames();

    mounted.dispose();
    mounted = null;
    check("dispose-removes-canvas", !canvas.isConnected && !host.querySelector("canvas"));
    check("dispose-cancels-render", queuedFrames.size === 0);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    check("dispose-detaches-context-listeners", queuedFrames.size === 0);

    host.remove();
    host = makeHost();
    const remount = mountScene(host);
    await waitTask();
    flushFrames();
    check("remount-after-dispose", host.querySelectorAll("canvas").length === 1);
    remount.dispose();

    host.remove();
    host = makeHost();
    const lossDispose = mountScene(host);
    await waitTask();
    flushFrames();
    const lossCanvas = host.querySelector("canvas");
    const lossGl = lossCanvas.getContext("webgl2");
    const lossExtension = lossGl?.getExtension("WEBGL_lose_context");
    const lossPromise = waitEvent(lossCanvas, "webglcontextlost");
    if (lossExtension) lossExtension.loseContext();
    else lossCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await lossPromise;
    lossDispose.dispose();
    check("dispose-while-context-lost-removes-canvas", !lossCanvas.isConnected && !host.querySelector("canvas"));
    check("dispose-while-context-lost-no-render", queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host?.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
