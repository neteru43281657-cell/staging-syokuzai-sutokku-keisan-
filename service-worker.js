const CACHE_NAME = "stockcalc-v1.0.2"; // バージョンを上げる

self.addEventListener("install", (e) => {
  // 新しい SW がインストールされたら、待機せずに即座に有効化する
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // 古いキャッシュを削除
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
});

self.addEventListener("fetch", (e) => {
  // ネットワークを優先し、取得できればキャッシュを更新する
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, resClone);
        });
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
