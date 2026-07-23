// storage.jsx — window.storage: IndexedDB-backed in-memory key-value store
// MAI localStorage/sessionStorage — usa IndexedDB per vera persistenza
(function () {
  const DB_NAME = "lfh_v1";
  const STORE   = "kv";

  let _db  = null;
  const _m = {};           // memory cache — accesso sincrono
  let _rdy = false;
  const _q = [];           // callback queue
  const _pending = {};      // scritture in attesa che _db sia pronto (key→value)

  function _open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) =>
        e.target.result.createObjectStore(STORE, { keyPath: "k" });
      req.onsuccess  = (e) => res(e.target.result);
      req.onerror    = (e) => rej(e.target.error);
    });
  }

  // Persiste una coppia su IndexedDB (se il db è pronto). Non lancia mai.
  function _persist(key, value) {
    try {
      _db.transaction(STORE, "readwrite")
         .objectStore(STORE)
         .put({ k: key, v: value });
    } catch (_) {}
  }

  // Svuota le scritture accumulate prima dell'apertura del db.
  function _drainPending() {
    if (!_db) return;
    Object.keys(_pending).forEach(k => {
      _persist(k, _pending[k]);
      delete _pending[k];
    });
  }

  function _flush() {
    _rdy = true;
    _q.forEach(cb => { try { cb(); } catch (_) {} });
    _q.length = 0;
  }

  window.storage = {
    // sync reads
    get(key, def = null) { return key in _m ? _m[key] : def; },

    // sync write + async persist
    set(key, value) {
      _m[key] = value;
      if (_db) _persist(key, value);
      else     _pending[key] = value;   // verrà scritto al drain quando _db è pronto
    },

    remove(key) {
      delete _m[key];
      delete _pending[key];
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite")
             .objectStore(STORE)
             .delete(key);
        } catch (_) {}
      }
    },

    clear() {
      Object.keys(_m).forEach(k => delete _m[k]);
      Object.keys(_pending).forEach(k => delete _pending[k]);
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite")
             .objectStore(STORE)
             .clear();
        } catch (_) {}
      }
    },

    // Elenco chiavi presenti (per pulizia dei dati giornalieri vecchi)
    keys() { return Object.keys(_m); },

    onReady(cb) { _rdy ? cb() : _q.push(cb); },
    isReady()   { return _rdy; },
  };

  // Storage persistente: chiede a iOS/Safari di NON evictare IndexedDB quando
  // la PWA resta inutilizzata a lungo (i dati per-giorno vivono SOLO qui finché
  // la sessione non è chiusa su Sheets). Best-effort: se negato, nulla cambia.
  try {
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(granted => {
        if (!granted) console.log("[storage] persist() negato dal browser (best-effort)");
      }).catch(() => {});
    }
  } catch (_) {}

  // Bootstrap: open DB → load all rows → signal ready
  _open()
    .then(d => {
      _db = d;
      const req = _db.transaction(STORE, "readonly")
                     .objectStore(STORE)
                     .getAll();
      req.onsuccess = (e) => {
        // Carica i valori persistiti, ma NON sovrascrive scritture recenti in attesa
        (e.target.result || []).forEach(({ k, v }) => {
          if (!(k in _pending)) _m[k] = v;
        });
        // Le scritture avvenute prima dell'apertura del db ora vengono persistite
        _drainPending();
        _flush();
      };
      req.onerror = (e) => { _drainPending(); _flush(); };
    })
    .catch(_flush);
})();
