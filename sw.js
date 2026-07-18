// Service worker — cache do "app shell" para funcionar offline.
// Sobe a versão sempre que mudares ficheiros estáticos.
const CACHE = "treinador-v18";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/db.js",
  "./js/exercicios_base.js",
  "./js/ia_treino.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: com net, serve sempre a versão fresca (e atualiza a cache);
// offline, cai na cache. Assim as atualizações aparecem sem "dança de recarregar",
// e no campo (sem net) a app continua a funcionar a partir da cache.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copia = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia));
      return resp;
    }).catch(() => caches.match(e.request).then((cached) => cached || caches.match("./index.html")))
  );
});
