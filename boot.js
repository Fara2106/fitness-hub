/* boot.js — bootstrap non-React (ex script inline di index.html, esternalizzati
   per togliere 'unsafe-inline' dalla CSP): fix ResizeObserver, logger errori
   locale, registrazione Service Worker + ponte banner "Aggiorna".
   Caricato per PRIMO nel body, prima delle CDN e del bundle. */

/* ── ResizeObserver loop fix ─────────────────────────────────────────────── */
(function () {
  const RO = window.ResizeObserver;
  if (!RO) return;
  window.ResizeObserver = class extends RO {
    constructor(cb) {
      super((entries, obs) => { requestAnimationFrame(() => { try { cb(entries, obs); } catch (_) {} }); });
    }
  };
  const swallow = (e) => {
    const msg = (e && (e.message || (e.reason && e.reason.message))) || '';
    if (msg.indexOf('ResizeObserver loop') !== -1) { e.stopImmediatePropagation(); e.preventDefault && e.preventDefault(); }
  };
  window.addEventListener('error', swallow, true);
  window.addEventListener('unhandledrejection', swallow, true);
})();

/* ── Log errori locale (Impostazioni → Diagnostica) ──────────────────────────
   Registrato DOPO lo swallow ResizeObserver (che ferma la propagazione dei
   suoi falsi positivi). Tiene gli ultimi 50 errori JS in window._errLog e li
   persiste in storage ("errorLog") appena IndexedDB è pronto: i bug solo-iOS
   diventano leggibili dal device invece di restare invisibili. */
(function () {
  var MAX = 50;
  var LOG = window._errLog = [];
  var toFlush = [];
  function flush() {
    var st = window.storage;
    if (!st || !toFlush.length) return;
    if (!st.isReady()) { st.onReady(flush); return; }
    try {
      var prev = st.get("errorLog", []) || [];
      st.set("errorLog", prev.concat(toFlush).slice(-MAX));
      toFlush = [];
      window.dispatchEvent(new Event("lfh-err"));
    } catch (_) {}
  }
  function push(type, msg, stack) {
    try {
      var entry = {
        t: new Date().toISOString(),
        type: type,
        msg: String(msg || "").slice(0, 300),
        stack: String(stack || "").slice(0, 600),
      };
      LOG.push(entry);
      if (LOG.length > MAX) LOG.shift();
      toFlush.push(entry);
      flush();
    } catch (_) {}
  }
  window.addEventListener("error", function (e) {
    if (!e || !e.message) return; // gli errori di caricamento risorse non arrivano qui (no bubble)
    var where = e.filename ? " @ " + String(e.filename).split("/").pop() + ":" + e.lineno : "";
    push("error", e.message + where, e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    push("promise", (r && (r.message || r)) || "unhandledrejection", r && r.stack);
  });
})();

/* ── Service Worker (PWA offline support) ──────────────────────────────── */
if ('serviceWorker' in navigator) {
  // Ricarica quando un nuovo SW prende il controllo (scatta DOPO che l'utente
  // tocca "Aggiorna" → SKIP_WAITING → il nuovo SW si attiva). Guard anti-loop.
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_refreshing) return;
    _refreshing = true;
    console.log('[SW] Nuovo SW attivo, ricarico...');
    window.location.reload();
  });

  // Ponte verso React: segnala che c'è un update pronto e come applicarlo.
  // Stesso schema del ponte sync ("lfh-sync"). _swUpdateReady copre il caso in
  // cui React monti DOPO l'evento (lo stato iniziale lo rilegge).
  function _promptUpdate(worker) {
    if (!worker) return;
    window._swApplyUpdate = () => worker.postMessage({ type: 'SKIP_WAITING' });
    window._swUpdateReady = true;
    try { window.dispatchEvent(new Event('lfh-sw-update')); } catch (_) {}
    console.log('[SW] Update disponibile, banner mostrato.');
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        // reg può essere undefined se l'ambiente blocca i SW (es. automazione/test):
        // senza guard, reg.scope lancerebbe un TypeError confuso dentro il catch
        if (!reg) { console.warn('[SW] Registrazione bloccata dall\'ambiente (nessun registration object) — ok in test/automazione'); return; }
        console.log('[SW] Registrato:', reg.scope);
        // Controlla aggiornamenti subito e poi ogni 60s
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 60000);

        // Se un worker è già in attesa al load → update pronto.
        if (reg.waiting && navigator.serviceWorker.controller) _promptUpdate(reg.waiting);

        // Nuovo worker trovato: quando è "installed" E c'è già un controller
        // (= aggiornamento, non prima installazione) → mostra il banner.
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) _promptUpdate(nw);
          });
        });
      })
      .catch(err => console.warn('[SW] Registrazione non riuscita (normale se l\'ambiente blocca i service worker):', err && err.message ? err.message : err));
  });
}
