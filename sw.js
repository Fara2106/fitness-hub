/**
 * Lorenzo Fitness Hub — Service Worker
 * Mette in cache i file statici → l'app si avvia anche senza connessione
 * (le chiamate API richiedono sempre internet)
 */

const CACHE_NAME = "fitness-hub-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/api.jsx",
  "/app.jsx",
  "/storage.jsx",
  "/parser.jsx",
  "/i18n.jsx",
  "/icons.jsx",
  "/anatomy.jsx",
  "/nav.jsx",
  "/screens/dashboard.jsx",
  "/screens/scheda.jsx",
  "/screens/dieta.jsx",
  "/screens/spesa.jsx",
  "/screens/coach.jsx",
  "/screens/storico.jsx",
  "/screens/impostazioni.jsx",
  "/screens/onboarding.jsx",
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

  // File statici locali → cache-first, aggiorna in background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
      // Restituisce subito la cache se disponibile, altrimenti aspetta la rete
      return cached || networkFetch;
    })
  );
});
