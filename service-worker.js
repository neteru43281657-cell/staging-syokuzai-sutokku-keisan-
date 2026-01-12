const CACHE_NAME = "stockcalc-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./images/アイコン.png"
];

// インストール時にファイルをキャッシュ
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// キャッシュがあればそれを返し、なければネットワークから取得
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
