// Service worker - app shell offline.
const CACHE = "vision-coach-v43";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./vendor/supabase.min.js",
  "./vendor/tus.min.js",
  "./js/db.js",
  "./js/head_coach_memory.js",
  "./js/head_coach_media.js",
  "./js/workspace.js",
  "./js/calendar.js",
  "./js/remote_workspace.js",
  "./js/agent_contract.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" }).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
