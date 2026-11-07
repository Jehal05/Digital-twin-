/* HealthTwin service worker: caches the app shell and the public model files only. It never touches /api/ (health data) or any non-GET request. */
const CACHE = "healthtwin-shell-v2";
const SHELL = ["/", "/favicon.svg", "/icon-192.png", "/manifest.webmanifest", "/models/diabetes.json", "/models/heart_disease.json", "/models/diabetes_survey.json"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname === "/healthz") return; // network only
  if (req.mode === "navigate") {                      // pages: network first, offline falls back to the cached shell
    e.respondWith(fetch(req).then((r) => { caches.open(CACHE).then((c) => c.put("/", r.clone())); return r; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {   // static assets: cache first
    if (r.ok && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/models/"))) caches.open(CACHE).then((c) => c.put(req, r.clone()));
    return r;
  })));
});
