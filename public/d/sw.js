// Driver app service worker (scope /d/). Caches only the static shell; personal data is never cached.
const VERSION = "driver-v1";
const SHELL = ["/d/offline", "/d/manifest.webmanifest"];
const DATA = /^\/d\/[^/]+\/(trips|history|event|ping|pod)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (DATA.test(url.pathname)) return; // network only, never stored

  if (req.mode === "navigate") {
    // Pages carry the token: network first, never stored; offline shows the static page.
    event.respondWith(fetch(req).catch(() => caches.match("/d/offline")));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
