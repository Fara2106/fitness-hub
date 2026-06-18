/**
 * Lorenzo Fitness Hub — Service Worker
 * Mette in cache i file statici → l'app si avvia anche senza connessione
 * (le chiamate API richiedono sempre internet)
 */

const CACHE_NAME = "fitness-hub-v3-20260618105236";
const BASE = "/fitness-hub";

const STATIC_ASSETS = [
  BASE + "/",
  BASE + "/index.html",
  BASE + "/styles.css",
  BASE + "/manifest.json",
  BASE + "/icon-192.png",
  BASE + "/icon-512.png",
  BASE + "/api.jsx",
  BASE + "/app.jsx",
  BASE + "/storage.jsx",
  BASE + "/parser.jsx",
  BASE + "/i18n.jsx",
  BASE + "/icons.jsx",
  BASE + "/anatomy.jsx",
  BASE + "/nav.jsx",
  BASE + "/screens/dashboard.jsx",
  BASE + "/screens/scheda.jsx",
  BASE + "/screens/dieta.jsx",
  BASE + "/screens/spesa.jsx",
  BASE + "/screens/coach.jsx",
  BASE + "/screens/storico.jsx",
  BASE + "/screens/impostazioni.jsx",
  BASE + "/screens/onboarding.jsx",
];

// ── Install: pre-cacha tutti i file statici ──────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: elimina vecchie cache ─────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: strategia per tipo di richiesta ───────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls (Cloudflare Worker, Groq, CDN) → sempre rete, mai cache
  if (url.hostname !== self.location.hostname) {
    return;
  }

  // Navigazione (HTML) → network-first: serve sempre la versione più fresca
  // Questo assicura che index.html con il codice di auto-reload venga scaricato
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)) // fallback offline
    );
    return;
  }

  // File statici (JS, CSS, immagini) → network-first con fallback cache.
  // Prima si tentava stale-while-revalidate, che però serviva SEMPRE la versione
  // vecchia al primo avvio: su iOS il nuovo codice (incluso questo SW) arrivava
  // solo alla seconda apertura. Con network-first, appena online si prende
  // l'ultima versione; la cache resta solo per l'uso offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
