// service-worker.js

const CACHE_NAME = "stockcalc-v1.8.9"; // ★更新のたびに必ず上げること

// 事前キャッシュ（最低限）
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./service-worker.js",

  "./js/app.js",
  "./js/pokedex.js",
  "./js/calendar.js",
  "./js/level.js",
  
  "./data/exp_table.txt",
  "./data/shard_table.txt",
  "./data/energy.txt",
  "./data/pokedex_master.txt",
  "./data/skill_data.txt",
  "./data/typeicon.txt",
  
  "./data/ingredients.js",
  "./data/recipes.js",
  "./data/fields.js",
  "./data/calendar_events.js",

  "./data/ワカクサ本島.txt",
  "./data/ワカクサ本島EX.txt",
  "./data/シアンの砂浜.txt",
  "./data/トープ洞窟.txt",
  "./data/ウノハナ雪原.txt",
  "./data/ラピスラズリ湖畔.txt",
  "./data/ゴールド旧発電所.txt",
  "./data/アンバー渓谷.txt",

  // 最低限の画像（PWAアイコンなど）
  "./images/appicon_IOS.png",
  "./images/appicon_Android.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
      )
      .then(() => self.clients.claim())
  );
});

// 基本は「ネットワーク優先」＋「失敗したらキャッシュ」
// ただし成功時は必ずキャッシュ更新（最新が残る）
self.addEventListener("fetch", (e) => {
  const req = e.request;

  // GET以外は触らない
  if (req.method !== "GET") return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // 取れたらキャッシュ更新して返す
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
