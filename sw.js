/**
 * Lorenzo Fitness Hub — Service Worker
 * Mette in cache i file statici → l'app si avvia anche senza connessione
 * (le chiamate API richiedono sempre internet)
 */

const CACHE_NAME = "fitness-hub-v3-20261103104241";
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
  // Bootstrap esternalizzati (CSP senza 'unsafe-inline')
  BASE + "/boot-theme.js",
  BASE + "/boot.js",
  // Librerie vendorizzate (stesso origin dal 2026-07-23): precache completo
  // → l'app si avvia e disegna i grafici anche del tutto offline.
  BASE + "/vendor/react.production.min.js",
  BASE + "/vendor/react-dom.production.min.js",
  BASE + "/vendor/gsap.min.js",
  BASE + "/vendor/prop-types.min.js",
  BASE + "/vendor/Recharts.js",
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

  // Richieste con cache-buster (?_cb=, es. scheda.txt/dieta.txt del repo):
  // vogliono la rete per definizione. Prima finivano in cache con un URL
  // diverso a ogni avvio → la cache cresceva senza limiti fino al deploy dopo.
  if (url.searchParams.has("_cb")) return;

  const fromCache = (req) =>
    caches.match(req).then((r) => r || caches.match(req, { ignoreSearch: true }));
  const fetchAndStore = (req) =>
    fetch(req).then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return response;
    });

  // Navigazione (HTML) → network-first: serve sempre la versione più fresca.
  // Con la rete "lenta ma non assente" della palestra la fetch poteva restare
  // appesa decine di secondi prima del fallback: dopo 4 s si usa la copia in
  // cache (se c'è) e la risposta di rete aggiorna comunque la cache.
  if (event.request.mode === "navigate") {
    const net = fetchAndStore(event.request);
    event.respondWith(new Promise((resolve) => {
      let done = false;
      const fallback = () => fromCache(event.request).then((r) => {
        if (r && !done) { done = true; resolve(r); }
        return r;
      });
      const tid = setTimeout(fallback, 4000);
      net.then((r) => { clearTimeout(tid); if (!done) { done = true; resolve(r); } })
        .catch(() => { clearTimeout(tid); fallback().then((r) => { if (!done) { done = true; resolve(r || Response.error()); } }); });
    }));
    return;
  }

  // Asset versionati (?v=<deploy>) → cache-first: il contenuto di un URL
  // versionato non cambia mai (ogni deploy bumpa ?v= in index.html, che è
  // network-first), quindi la rete serve solo alla prima richiesta.
  if (url.searchParams.has("v")) {
    event.respondWith(
      caches.match(event.request).then((r) => r || fetchAndStore(event.request)
        .catch(() => fromCache(event.request)))
    );
    return;
  }

  // Altri file statici → network-first con fallback cache. ignoreSearch nel
  // fallback: il precache ha gli URL senza query, la pagina li chiede con ?v=
  // → prima il primo avvio offline dopo l'installazione restava senza bundle.
  event.respondWith(
    fetchAndStore(event.request).catch(() => fromCache(event.request))
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
