// storage.jsx — window.storage: IndexedDB-backed in-memory key-value store
// MAI localStorage/sessionStorage — usa IndexedDB per vera persistenza
(function () {
  const DB_NAME = "lfh_v1";
  const STORE   = "kv";

  let _db  = null;
  const _m = {};           // memory cache — accesso sincrono
  let _rdy = false;
  const _q = [];           // callback queue

  function _open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) =>
        e.target.result.createObjectStore(STORE, { keyPath: "k" });
      req.onsuccess  = (e) => res(e.target.result);
      req.onerror    = (e) => rej(e.target.error);
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
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite")
             .objectStore(STORE)
             .put({ k: key, v: value });
        } catch (_) {}
      }
    },

    remove(key) {
      delete _m[key];
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
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite")
             .objectStore(STORE)
             .clear();
        } catch (_) {}
      }
    },

    onReady(cb) { _rdy ? cb() : _q.push(cb); },
    isReady()   { return _rdy; },
  };

  // Bootstrap: open DB → load all rows → signal ready
  _open()
    .then(d => {
      _db = d;
      const req = _db.transaction(STORE, "readonly")
                     .objectStore(STORE)
                     .getAll();
      req.onsuccess = (e) => {
        (e.target.result || []).forEach(({ k, v }) => { _m[k] = v; });
        _flush();
      };
      req.onerror = _flush;
    })
    .catch(_flush);
})();
