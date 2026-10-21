// The app shell works offline and the app can be installed. The API is never cached: a case is
// live data, and an old copy of it would be worse than an honest "no connection".
const CACHE = "eptz-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    // the page: the newest when online, the cached one offline
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  // built assets have content hashes in their names – once cached, they never change
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
        fetch(event.request).then((response) => {
          if (response.ok && url.pathname.startsWith("/assets/")) {
            const copy = response.clone();
            void caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
