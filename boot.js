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
  // Usato anche dall'error boundary React (ui.jsx): gli errori di render NON
  // arrivano a window.onerror in produzione, li segnala lui.
  window._logError = push;
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
// Aggiornamenti SILENZIOSI (dal 2026-11-03, al posto del banner "Aggiorna",
// che su iOS risultava inaffidabile): il nuovo SW si attiva appena installato
// e la versione nuova parte alla prossima apertura. Nessun reload a sorpresa:
// si ricarica da soli solo tornando all'app dopo ≥10 min in background
// (mai a metà di un'azione, es. allenamento in corso).
if ('serviceWorker' in navigator) {
  // Alla PRIMA installazione il SW fa clients.claim() → controllerchange anche
  // senza alcun update: lì non c'è nulla da ricaricare.
  const _hadController = !!navigator.serviceWorker.controller;
  let _updated = false, _refreshing = false, _hiddenAt = 0;
  const RELOAD_AFTER_MS = 10 * 60 * 1000;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_hadController) { _updated = true; console.log('[SW] Nuova versione attiva (al prossimo avvio).'); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { _hiddenAt = Date.now(); return; }
    if (_updated && !_refreshing && _hiddenAt && Date.now() - _hiddenAt >= RELOAD_AFTER_MS) {
      _refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        // reg può essere undefined se l'ambiente blocca i SW (es. automazione/test):
        // senza guard, reg.scope lancerebbe un TypeError confuso dentro il catch
        if (!reg) { console.warn('[SW] Registrazione bloccata dall\'ambiente (nessun registration object) — ok in test/automazione'); return; }
        console.log('[SW] Registrato:', reg.scope);
        // Worker in attesa (es. installato da una versione di sw.js che non
        // faceva ancora skipWaiting da sola) → attivalo subito.
        const activate = (w) => { try { w && w.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {} };
        const track = (nw) => {
          if (!nw) return;
          if (nw.state === 'installed') { activate(nw); return; }
          nw.addEventListener('statechange', () => { if (nw.state === 'installed') activate(nw); });
        };
        if (reg.waiting) activate(reg.waiting);
        track(reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));

        // Controlla aggiornamenti subito, ogni 60s e — soprattutto su iOS, dove
        // la PWA resta sospesa e i timer non girano — al ritorno in foreground.
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 60000);
        let _lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - _lastCheck < 15000) return;
          _lastCheck = Date.now();
          reg.update().catch(() => {});
        });
      })
      .catch(err => console.warn('[SW] Registrazione non riuscita (normale se l\'ambiente blocca i service worker):', err && err.message ? err.message : err));
  });
}
