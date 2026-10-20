// Uygulama dosyalarını önbelleğe alır: önce ağdan dener, internet yoksa önbellekten açar.
// Veriler Firestore'un kendi çevrimdışı önbelleğinde tutulur, burada değil.
const CACHE = "ev-giderleri-v1";
const SHELL = [
  "./", "index.html", "css/styles.css", "js/app.js", "js/store.js", "js/config.js",
  "js/categories.js", "js/receipt.js", "js/vendor/anthropic-sdk.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const cacheable = req.method === "GET" &&
    (url.origin === location.origin || url.hostname === "www.gstatic.com");
  if (!cacheable) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
