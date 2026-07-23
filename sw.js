/**
 * Lorenzo Fitness Hub — Service Worker
 * Mette in cache i file statici → l'app si avvia anche senza connessione
 * (le chiamate API richiedono sempre internet)
 */

const CACHE_NAME = "fitness-hub-v3-20260723191625";
const BASE = "/fitness-hub";

const STATIC_ASSETS = [
  BASE + "/",
  BASE + "/index.html",
  BASE + "/styles.css",
  BASE + "/manifest.json",
  BASE + "/icon-192.png",
  BASE + "/icon-512.png",
  // Bundle unico precompilato (dev/build.mjs) al posto dei singoli .jsx:
  // i sorgenti non vengono più caricati dal browser.
  BASE + "/app.compiled.js",
];

// ── Install: pre-cacha tutti i file statici ──────────────────────────────────
// NB: NIENTE self.skipWaiting() → il nuovo SW resta "waiting" finché l'utente
// non tocca "Aggiorna" nel banner (vedi index.html + app.jsx). Così l'update
// non si applica in modo silenzioso/imprevedibile.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
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

// ── Message: il banner "Aggiorna" chiede di attivare subito questo SW ─────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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

// ── Push: mostra la notifica ────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || "Lorenzo Fitness Hub";
  const body  = data.body  || "Promemoria";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: BASE + "/icon-192.png",
    badge: BASE + "/icon-192.png",
    tag: data.tag || "reminder",
    data: { url: BASE + "/" },
  }));
});

// ── Tap sulla notifica: focalizza o apre l'app ──────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || (BASE + "/");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if (w.url.includes(BASE) && "focus" in w) return w.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
