// Offline support: the app and its catalogues are cached; forecasts and imagery always come from the network.
const CACHE = "astrometric-v1";
const SHELL = ["./", "index.html", "style.css", "manifest.webmanifest", "favicon.png", "icon-192.png", "apple-touch-icon.png",
  "js/app.js", "js/astro.js", "js/data.js", "js/catalog.js", "js/skymap.js", "js/charts.js", "js/satellite.js", "js/theme.js",
  "data/NGCIC.json", "data/Messier.json", "data/Constellations.json", "data/Borders.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  // Network first, so updates show up straight away; the cache covers offline use.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
