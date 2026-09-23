// Service worker - app shell offline.
const CACHE = "vision-coach-v103";
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
  "./js/match_analysis.js",
  "./js/match_analysis_store.js",
  "./js/match_evidence.js",
  "./js/team_development.js",
  "./js/seasons.js",
  "./js/player_goals.js",
  "./js/report_export.js",
  "./js/match_visual.js",
  "./js/match_visual_ui.js",
  "./js/match_events.js",
  "./js/match_events_ui.js",
  "./js/player_status.js",
  "./js/training_planner.js",
  "./js/remote_workspace.js",
  "./js/mcp_connectors.js",
  "./js/exercise_visuals.js",
  "./js/exercise_image_storage.js",
  "./js/training_ui.js",
  "./js/training_continuity.js",
  "./js/training_continuity_store.js",
  "./js/training_continuity_ui.js",
  "./js/training_session.js",
  "./js/training_session_ui.js",
  "./js/agent_contract.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./assets/exercises/approved-20260922/01_ativacao_conduzir_passar_dar_opcao.png",
  "./assets/exercises/approved-20260922/02_passar_apoiar_terceiro_homem.png",
  "./assets/exercises/approved-20260922/03_saida_curta_gr_3_vs_3.png",
  "./assets/exercises/approved-20260922/04_jogo_condicionado_sair_acelerar.png",
  "./assets/exercises/approved-20260922/05_jogo_livre_observar_saida.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== "vision-coach-private-images-v1").map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url=new URL(event.request.url);
  if(url.origin===self.location.origin&&url.pathname.includes("/assets/exercises/approved-20260922/")){
    event.respondWith(caches.open(CACHE).then(async(cache)=>{
      const saved=await cache.match(event.request);if(saved) return saved;
      const response=await fetch(event.request);
      if(response.ok) await cache.put(event.request,response.clone());
      return response;
    }));
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: "no-store" }).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
