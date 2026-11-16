// Cache aplikasi agar tetap bisa dibuka saat sinyal lemah/offline.
const APP = "geotag-app-v4", TILES = "geotag-tiles-v1", MAX_TILES = 3000;
const SHELL = ["./","index.html","monitor.html","config.js","js/monitor.js","css/style.css","js/app.js","js/zip.js","data/grid.js","vendor/leaflet/leaflet.js","vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/marker-icon.png","vendor/leaflet/images/layers.png","manifest.webmanifest","icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(
  ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isTile = /arcgisonline\.com|tile\.openstreetmap\.org/.test(url.hostname);
  if (isTile) { // tile peta: pakai cache dulu, simpan tile yang pernah dilihat
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === "opaque") { c.put(req, res.clone()); trim(c); } return res; }
      catch (err) { return hit || Response.error(); }
    })); return;
  }
  if (url.origin === location.origin) { // file aplikasi: jaringan dulu, cache jika offline
    e.respondWith(fetch(req).then(res => { const cp = res.clone(); caches.open(APP).then(c => c.put(req, cp)); return res; })
      .catch(() => caches.match(req, {ignoreSearch: true})));
  }
});
async function trim(c) { const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); }
