const CACHE_NAME = "stockcalc-v1.1.1"; // ★必ず上げること

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/pokedex.js",
  "./js/calendar.js",
  "./data/ingredients.js",
  "./data/recipes.js",
  "./data/fields.js",

  "./data/energy.txt",
  "./data/pokedex_master.txt",

  "./data/ワカクサ本島.txt",
  "./data/ワカクサ本島EX.txt",
  "./data/シアンの砂浜.txt",
  "./data/トープ洞窟.txt",
  "./data/ウノハナ雪原.txt",
  "./data/ラピスラズリ湖畔.txt",
  "./data/ゴールド旧発電所.txt",
  "./data/アンバー渓谷.txt",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
