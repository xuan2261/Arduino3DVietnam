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
  "./styles/practice-evidence.css", "./docs/PRACTICE_EVIDENCE_NEXT.md",
  "./src/uno-reference.js", "./src/practice-checkpoints.js",
  "./src/breadboard-placement.js", "./src/sketch-review.js",
  "./src/sketch-review-ui.js", "./docs/UNO_REFERENCE_NEXT.md",
  "./docs/AUTHORED_PRACTICE_CHECKPOINTS.md",
  "./docs/BREADBOARD_PHYSICAL_MAPPING_NEXT.md",
  "./docs/SCENE_NEXT_3D_QA.md", "./docs/SKETCH_REVIEW_NEXT.md",
  "./src/practice-observation.js", "./src/practice-observation-ui.js",
  "./src/breadboard-placement-session.js",
  "./docs/PRACTICE_OBSERVATION_NEXT.md",
  "./docs/RESISTIVE_VISUAL_STUDY_NEXT.md",
  "./src/breadboard-hole-grid.js", "./src/practice-wire-guidance.js",
  "./docs/BREADBOARD_HOLE_PICKER_NEXT.md",
  "./docs/PRACTICE_WIRE_GUIDANCE_NEXT.md",
  "./docs/SCENE_WIRE_PREVIEW_NEXT.md",
  "./docs/SCENE_VISUAL_FIDELITY_NEXT.md",
  "./docs/PRACTICE_CHECKLIST_NEXT.md",
  "./docs/SKETCH_LEXICAL_FEEDBACK_NEXT.md",
  "./src/breadboard-authored-groups.js",
  "./src/resistive-branch-study.js",
  "./src/uno-mechanical-reference.js",
  "./docs/BREADBOARD_AUTHORED_GROUPS_NEXT.md",
  "./docs/SCENE_WIRE_INSPECTION_NEXT.md",
  "./docs/RESISTIVE_BRANCH_STUDY_NEXT.md",
  "./docs/UNO_MECHANICAL_REFERENCE_NEXT.md",
  "./docs/PRACTICE_PAIR_PREVIEW_NEXT.md",
  "./src/learner-circuit-history.js",
  "./src/sketch-pin-evidence.js",
  "./src/uno-mounting-evidence.js",
  "./docs/LEARNER_CIRCUIT_HISTORY_NEXT.md",
  "./docs/SKETCH_PIN_EVIDENCE_NEXT.md",
  "./docs/UNO_MOUNTING_EVIDENCE_NEXT.md",
  "./docs/POST_V16_SCENE_COMPONENT_FIDELITY.md",
  "./docs/AVR_TIMER2_FIDELITY_NEXT.md",
  "./src/practice-checkpoint-trail.js",
  "./src/practice-checkpoint-trail-ui.js",
  "./docs/POST_V16_TERMINAL_DRAG.md",
  "./docs/LAB_EDITOR_PRECISION_WIRES_NEXT.md",
  "./docs/PRACTICE_48_STEP_TRAIL_NEXT.md",
  "./docs/SKETCH_TO_INSPECTOR_NEXT.md",
  "./docs/AVR_TIMER2_CTC_STUDY_NEXT.md",
  "./docs/POST_V16_RICH_INTERACTION_QA.md",
  "./assets/vendor/avr/avr8js-0.21.1-source/timer.ts",
  "./assets/vendor/avr/avr8js-0.21.1-source/timer.spec.ts",
  "./src/practice-step-attempt.js",
  "./src/practice-step-attempt-ui.js",
  "./styles/practice-step-attempt.css",
  "./docs/PRACTICE_STEP_ATTEMPTS.md",
  "./docs/PRACTICE_REPAIR_ACTIONS.md",
  "./docs/PRACTICE_REPAIR_EDITOR_HANDOFF.md",
  "./docs/THREE_D_COMMITTED_WIRE_REPAIR.md"
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
