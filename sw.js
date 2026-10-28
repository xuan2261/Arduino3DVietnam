/* Offline cache for the published HTTPS site. Not enabled on localhost during development. */
const CACHE = "arduino3d-viet-static-v1-20261028";
const ASSETS = [
  "./", "./index.html", "./site.webmanifest", "./styles/app.css",
  "./src/app.js", "./src/lessons.js", "./src/simulator.js",
  "./src/storage.js", "./src/scene3d.js",
  "./assets/favicon.svg", "./assets/vendor/three.module.min.js",
  "./assets/vendor/three.core.min.js", "./assets/vendor/THREE-LICENSE.txt",
  "./docs/HUONG_DAN.md"
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
