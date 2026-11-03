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
  const _listeners = [];    // onChange: fn(key, value, { silent })

  // Notifica i listener (mai lancia: un listener rotto non blocca la scrittura).
  function _notify(key, value, opts) {
    const info = { silent: !!(opts && opts.silent) };
    _listeners.slice().forEach(fn => { try { fn(key, value, info); } catch (_) {} });
  }

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
    // opts.silent = true: scrittura "di sistema" (sweep, ricostruzione da sync) →
    // i listener la ricevono con silent:true e il ponte di sync NON la rimanda al server.
    set(key, value, opts) {
      _m[key] = value;
      if (_db) _persist(key, value);
      else     _pending[key] = value;   // verrà scritto al drain quando _db è pronto
      _notify(key, value, opts);
    },

    remove(key, opts) {
      delete _m[key];
      delete _pending[key];
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite")
             .objectStore(STORE)
             .delete(key);
        } catch (_) {}
      }
      _notify(key, null, opts);
    },

    // Registra fn(key, value, { silent }) per ogni set/remove (remove → value null).
    // Restituisce la funzione per annullare la registrazione.
    onChange(fn) {
      _listeners.push(fn);
      return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1); };
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
