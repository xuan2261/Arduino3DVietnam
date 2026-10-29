/* Offline cache for the published HTTPS site. Not enabled on localhost during development. */
const CACHE = "arduino3d-viet-static-v2-20261028";
const ASSETS = [
  "./", "./index.html", "./site.webmanifest", "./styles/app.css",
  "./styles/wiring.css", "./styles/avr-panel.css", "./styles/lab-editor.css",
  "./src/app.js", "./src/lab-layout.js", "./src/lab-editor-ui.js", "./src/learning-coach.js",
  "./src/lessons.js", "./src/simulator.js",
  "./src/circuit.js", "./src/circuit-extended.js",
  "./src/circuit-router.js", "./src/electrical-solver.js",
  "./src/wiring-workbench.js", "./src/storage.js", "./src/scene3d.js",
  "./src/firmware-integrity.js", "./src/avr-panel.js", "./src/avr-runtime.js",
  "./src/avr-gpio.js", "./src/avr-timer0.js", "./src/avr-timer1.js",
  "./src/avr-analog-serial.js", "./src/avr-board-runner.js",
  "./assets/favicon.svg", "./assets/vendor/three.module.min.js",
  "./assets/vendor/three.core.min.js", "./assets/vendor/THREE-LICENSE.txt",
  "./assets/vendor/avr/cpu.js", "./assets/vendor/avr/instruction.js",
  "./assets/vendor/avr/interrupt.js",
  "./assets/vendor/avr/avr8js-0.21.1-source/cpu.ts",
  "./assets/vendor/avr/avr8js-0.21.1-source/instruction.ts",
  "./assets/vendor/avr/avr8js-0.21.1-source/interrupt.ts",
  "./assets/vendor/avr/AVR8JS-LICENSE.txt", "./assets/vendor/avr/PROVENANCE.json",
  "./assets/firmware/manifest.json",
  "./assets/firmware/lesson_01.hex", "./assets/firmware/lesson_02.hex",
  "./assets/firmware/lesson_03.hex", "./assets/firmware/lesson_04.hex",
  "./assets/firmware/lesson_05.hex", "./assets/firmware/lesson_06.hex",
  "./assets/firmware/lesson_07.hex", "./assets/firmware/lesson_08.hex",
  "./assets/firmware/lesson_09.hex", "./assets/firmware/lesson_10.hex",
  "./assets/firmware/lesson_11.hex", "./assets/firmware/lesson_12.hex",
  "./assets/firmware/lesson_13.hex", "./assets/firmware/lesson_14.hex",
  "./assets/firmware/lesson_15.hex", "./assets/firmware/lesson_16.hex",
  "./THIRD-PARTY-NOTICES.md",
  "./docs/HUONG_DAN.md", "./docs/CIRCUIT_ENGINE.md",
  "./docs/CIRCUIT_EXTENDED.md", "./docs/ARDUINO_CODE.md",
  "./docs/GPIO_RUNTIME.md", "./docs/TIMER0_RUNTIME.md",
  "./docs/ANALOG_SERIAL_RUNTIME.md", "./docs/AVR_BOARD_LAB.md",
  "./docs/LAB_LAYOUT.md", "./docs/SCENE3D_LAB.md",
  "./docs/LEARNING_COACH.md", "./docs/TIMER1_RUNTIME.md",
  "./src/lab-explorer.js", "./src/lab-explorer-ui.js",
  "./src/breadboard-topology.js", "./src/breadboard-topology-ui.js",
  "./src/avr-timer2.js", "./styles/lab-explorer.css",
  "./docs/LAB_EXPLORER_V16.md", "./docs/BREADBOARD_TOPOLOGY_V16.md",
  "./docs/TIMER2_V16.md", "./docs/SCENE3D_V16.md",
  "./src/dc-resistor-network.js", "./src/resistive-study-ui.js",
  "./docs/DC_RESISTOR_NETWORK_V16.md",
  "./src/practice-evidence.js", "./src/practice-evidence-ui.js",
  "./styles/practice-evidence.css", "./docs/PRACTICE_EVIDENCE_NEXT.md"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("arduino3d-viet-static-") && k !== CACHE)
      .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req)).catch(() =>
      req.mode === "navigate" ? caches.match("./index.html") : Response.error())
  );
});
