const CACHE = "jh-v9";
const PRECACHE = ["/", "/index.html", "/share.html", "/scoring.html", "/chat.html", "/systeme.html", "/manifest.json", "/icon.png"];

self.addEventListener("install", e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
);

self.addEventListener("activate", e =>
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
);

self.addEventListener("fetch", e => {
  if (e.request.url.includes("/api/")) return;
  // Pages (navigations) : toujours le réseau frais, jamais le cache HTTP. Cache = secours hors-ligne uniquement.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "reload" }).catch(() => caches.match(e.request).then(r => r || caches.match("/")))
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
