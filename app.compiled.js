/* app.compiled.js — GENERATO da dev/build.mjs, NON modificare a mano.
 * Sorgente: i .jsx del repo (vedi BUNDLE_FILES in dev/build.mjs).
 * Rigenera con `npm run build`; drift-test in `npm test` (Suite bundle). */

// ══ storage.jsx ══
;(function () {
(function () {
  const DB_NAME = "lfh_v1";
  const STORE = "kv";
  let _db = null;
  const _m = {};
  let _rdy = false;
  const _q = [];
  const _pending = {};
  function _open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, {
        keyPath: "k"
      });
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
  }
  function _persist(key, value) {
    try {
      _db.transaction(STORE, "readwrite").objectStore(STORE).put({
        k: key,
        v: value
      });
    } catch (_) {}
  }
  function _drainPending() {
    if (!_db) return;
    Object.keys(_pending).forEach(k => {
      _persist(k, _pending[k]);
      delete _pending[k];
    });
  }
  function _flush() {
    _rdy = true;
    _q.forEach(cb => {
      try {
        cb();
      } catch (_) {}
    });
    _q.length = 0;
  }
  window.storage = {
    get(key, def = null) {
      return key in _m ? _m[key] : def;
    },
    set(key, value) {
      _m[key] = value;
      if (_db) _persist(key, value);else _pending[key] = value;
    },
    remove(key) {
      delete _m[key];
      delete _pending[key];
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
        } catch (_) {}
      }
    },
    clear() {
      Object.keys(_m).forEach(k => delete _m[k]);
      Object.keys(_pending).forEach(k => delete _pending[k]);
      if (_db) {
        try {
          _db.transaction(STORE, "readwrite").objectStore(STORE).clear();
        } catch (_) {}
      }
    },
    keys() {
      return Object.keys(_m);
    },
    onReady(cb) {
      _rdy ? cb() : _q.push(cb);
    },
    isReady() {
      return _rdy;
    }
  };
  try {
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(granted => {
        if (!granted) console.log("[storage] persist() negato dal browser (best-effort)");
      }).catch(() => {});
    }
  } catch (_) {}
  _open().then(d => {
    _db = d;
    const req = _db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = e => {
      (e.target.result || []).forEach(({
        k,
        v
      }) => {
        if (!(k in _pending)) _m[k] = v;
      });
      _drainPending();
      _flush();
    };
    req.onerror = e => {
      _drainPending();
      _flush();
    };
  }).catch(_flush);
})();
})();

// ══ api.jsx ══
;(function () {
(function _setDefaults() {
  const DEFAULT_SHEETS_URL = "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";
  const DEFAULT_GROQ_KEY = "";
  const apply = () => {
    if (!window.storage.get("sheetsUrl", "")) window.storage.set("sheetsUrl", DEFAULT_SHEETS_URL);
    if (!window.storage.get("groqApiKey", "")) window.storage.set("groqApiKey", DEFAULT_GROQ_KEY);
  };
  if (window.storage.onReady) window.storage.onReady(apply);else apply();
})();
const _PROXY = "https://fitness-hub-proxy.lorefara97.workers.dev";
const _QUEUEABLE = {
  savePeso: 1,
  savePesoCorporeo: 1,
  saveSessione: 1,
  saveMovimento: 1,
  saveCheckIn: 1,
  saveMisure: 1
};
let _draining = false;
window.sheetsAPI = {
  async get(params) {
    const url = new URL(_PROXY, location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("_cb", Date.now());
    const res = await fetch(url.toString(), {
      cache: "no-store"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && json.success === false) throw new Error(json.error || "Sheets error");
    return json;
  },
  async _send(body) {
    let res;
    try {
      res = await fetch(_PROXY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      const err = new Error(e.message || "rete non disponibile");
      err._net = true;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err._net = true;
      throw err;
    }
    const json = await res.json();
    if (json && json.success === false) throw new Error(json.error || "Sheets error");
    return json;
  },
  async post(body) {
    try {
      return await this._send(body);
    } catch (e) {
      if (e._net && _QUEUEABLE[body.action] && window.storage) {
        const q = window.storage.get("sheetsQueue", []) || [];
        q.push({
          body,
          ts: Date.now()
        });
        window.storage.set("sheetsQueue", q.slice(-300));
        console.warn("[queue] rete giù → accodata", body.action, `(${q.length} in coda)`);
        return {
          success: true,
          queued: true
        };
      }
      throw e;
    }
  },
  async drainQueue() {
    if (_draining || !window.storage) return;
    let q = window.storage.get("sheetsQueue", []) || [];
    if (!q.length) return;
    _draining = true;
    console.log("[queue] drain:", q.length, "operazioni in coda");
    try {
      while (q.length) {
        try {
          await this._send(q[0].body);
        } catch (e) {
          if (e._net) return;
          console.warn("[queue] scartata (errore backend):", q[0].body.action, e.message);
        }
        q = q.slice(1);
        window.storage.set("sheetsQueue", q);
      }
      console.log("[queue] coda svuotata ✓");
    } finally {
      _draining = false;
    }
  },
  async getPesi() {
    return this.get({
      action: "getPesi"
    });
  },
  async getPesoCorporeo() {
    return this.get({
      action: "getPesoCorporeo"
    });
  },
  async getUltimiPesi() {
    return this.get({
      action: "getUltimiPesi"
    });
  },
  async getCheckIn(date) {
    return this.get(date ? {
      action: "getCheckIn",
      date
    } : {
      action: "getCheckIn"
    });
  },
  async getMisure() {
    return this.get({
      action: "getMisure"
    });
  },
  async saveMisure(d) {
    return this.post({
      action: "saveMisure",
      ...d
    });
  },
  async savePeso(d) {
    return this.post({
      action: "savePeso",
      ...d
    });
  },
  async savePesoCorporeo(d) {
    return this.post({
      action: "savePesoCorporeo",
      ...d
    });
  },
  async saveSessione(d) {
    return this.post({
      action: "saveSessione",
      ...d
    });
  },
  async saveMovimento(d) {
    return this.post({
      action: "saveMovimento",
      ...d
    });
  },
  async saveCheckIn(d) {
    return this.post({
      action: "saveCheckIn",
      ...d
    });
  },
  async getSettings() {
    return this.get({
      action: "getSettings"
    });
  },
  async saveSettings(d) {
    return this.post({
      action: "saveSettings",
      ...d
    });
  },
  async getAll() {
    return this.get({
      action: "getAll"
    });
  },
  async getSessioni() {
    return this.get({
      action: "getSessioni"
    });
  },
  async testConnection() {
    const data = await this.get({
      action: "getPesoCorporeo"
    });
    return {
      ok: true,
      rows: Array.isArray(data) ? data.length : "?"
    };
  }
};
window.addEventListener("online", () => {
  window.sheetsAPI.drainQueue();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.sheetsAPI.drainQueue();
});
if (window.storage && window.storage.onReady) {
  window.storage.onReady(() => setTimeout(() => window.sheetsAPI.drainQueue(), 4000));
}
window.groqAPI = {
  hasLocalKey() {
    return !!(window.storage && (window.storage.get("groqApiKey", "") || "").trim());
  },
  async proxyAvailable() {
    try {
      const res = await fetch(_PROXY + "/groq?_cb=" + Date.now(), {
        cache: "no-store"
      });
      if (!res.ok) return false;
      const j = await res.json();
      return !!(j && j.groq === true);
    } catch (_) {
      return false;
    }
  },
  async complete({
    messages,
    systemPrompt,
    model = "llama-3.3-70b-versatile",
    maxTokens = 512,
    onDelta
  }) {
    const apiKey = (window.storage.get("groqApiKey", "") || "").trim();
    const msgs = systemPrompt ? [{
      role: "system",
      content: systemPrompt
    }, ...messages] : messages;
    const payload = {
      model,
      messages: msgs,
      max_tokens: maxTokens,
      temperature: 0.75
    };
    if (onDelta) payload.stream = true;
    const res = apiKey ? await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    }) : await fetch(_PROXY + "/groq", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const e = await res.json();
        errMsg = (typeof e.error === "string" ? e.error : e.error?.message) || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }
    const ctype = res.headers.get("content-type") || "";
    if (onDelta && res.body && ctype.indexOf("text/event-stream") !== -1) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "",
        full = "";
      while (true) {
        const {
          done,
          value
        } = await reader.read();
        if (done) break;
        buf += dec.decode(value, {
          stream: true
        });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const d = JSON.parse(data).choices?.[0]?.delta?.content;
            if (d) {
              full += d;
              onDelta(full);
            }
          } catch (_) {}
        }
      }
      if (full.trim()) return full.trim();
      throw new Error("Risposta vuota dal modello");
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      if (data && data.success === false) throw new Error("API key Groq non configurata (né sul device né sul proxy). Vai in Impostazioni ⚙️");
      throw new Error("Risposta vuota dal modello");
    }
    return content;
  },
  async testConnection() {
    const reply = await this.complete({
      messages: [{
        role: "user",
        content: "Rispondi solo con 'OK'."
      }],
      maxTokens: 10
    });
    return {
      ok: true,
      reply
    };
  }
};
window.playBeep = function (freq = 880, duration = 0.18, gain = 0.3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
};
window.todayKey = function () {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
window.getTodaySession = function () {
  const day = window.getSelectedSession ? window.getSelectedSession() : null;
  if (!day) return null;
  const muscles = day.focus && day.focus.length ? day.focus : window._musclesFromExercises ? window._musclesFromExercises(day.exercises) : [];
  return {
    id: day.key,
    key: day.key,
    label: (day.name || day.key || "").toUpperCase(),
    name: day.name || day.key,
    focus: day.focus || [],
    muscles: muscles,
    muscleKeys: muscles.map(m => String(m).toLowerCase())
  };
};
})();

// ══ push.jsx ══
;(function () {
(function () {
  const VAPID_PUBLIC = "BKTHaGRHHKNrswS50MRvDIR4QJIhnpd9bqEsm2efrDU4R7BoIYQ7OBzoBpVCv2Fq-7AlOPojdGrhboKLgQWKtxQ";
  const _PUSH_BASE = "https://fitness-hub-push.lorefara97.workers.dev";
  function urlB64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function _reg() {
    if (!("serviceWorker" in navigator)) return null;
    return navigator.serviceWorker.ready;
  }
  const pushAPI = {
    isConfigured() {
      return !!VAPID_PUBLIC && !!_PUSH_BASE;
    },
    isSupported() {
      return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    },
    isInstalled() {
      return window.navigator.standalone === true || window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    },
    permission() {
      return "Notification" in window ? Notification.permission : "denied";
    },
    getLocalSub() {
      return window.storage ? window.storage.get("notifSub", null) : null;
    },
    async enable(config) {
      if (!this.isSupported()) return {
        ok: false,
        error: "unsupported"
      };
      if (!this.isInstalled()) return {
        ok: false,
        error: "not-installed"
      };
      if (!this.isConfigured()) return {
        ok: false,
        error: "not-configured"
      };
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return {
          ok: false,
          error: "denied"
        };
        const reg = await _reg();
        if (!reg) return {
          ok: false,
          error: "no-sw"
        };
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC)
          });
        }
        const subJson = sub.toJSON();
        if (window.storage) {
          window.storage.set("notifSub", subJson);
          window.storage.set("notifEnabled", true);
        }
        const res = await this._post("/save", {
          subscription: subJson,
          config
        });
        return res.ok ? {
          ok: true
        } : {
          ok: false,
          error: "save-failed"
        };
      } catch (e) {
        return {
          ok: false,
          error: "subscribe-failed"
        };
      }
    },
    async disable() {
      try {
        const reg = await _reg();
        let endpoint = null;
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            endpoint = sub.endpoint;
            try {
              await sub.unsubscribe();
            } catch (_) {}
          }
        }
        if (window.storage) {
          window.storage.set("notifEnabled", false);
          window.storage.remove("notifSub");
        }
        if (endpoint) await this._post("/unsubscribe", {
          endpoint
        });
        return {
          ok: true
        };
      } catch (e) {
        if (window.storage) {
          window.storage.set("notifEnabled", false);
          window.storage.remove("notifSub");
        }
        return {
          ok: true
        };
      }
    },
    async syncConfig(config) {
      if (!window.storage || !window.storage.get("notifEnabled", false)) return {
        ok: false,
        error: "disabled"
      };
      const sub = window.storage.get("notifSub", null);
      if (!sub) return {
        ok: false,
        error: "no-sub"
      };
      return this._post("/save", {
        subscription: sub,
        config
      });
    },
    async _post(path, body) {
      if (!_PUSH_BASE) return {
        ok: false,
        error: "not-configured"
      };
      try {
        const r = await fetch(_PUSH_BASE + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
        return await r.json();
      } catch (e) {
        return {
          ok: false,
          error: String(e)
        };
      }
    }
  };
  window.pushAPI = pushAPI;
})();
})();

// ══ defaults.jsx ══
;(function () {
window.SCHEDA_TXT_FALLBACK = "# PUSH - Giorno 1\n# Focus: Petto · Spalle · Tricipiti\n# Riscaldamento: Rotazioni spalle 2x15 | Band pull-apart leggero 2x15 | Arm circles 1x20\n# Elastici: Fokky = compound (chest press, shoulder press) | Gritin = isolamento (lateral raise, tricep kickback)\n\nEsercizio | Serie | Rip | Recupero | Note tecniche\nPush-up (bodyweight) | 3 | 8-12 | 60 | Corpo in linea, gomiti a 45°. Petto sfiora terra. Espira in spinta. Ultime 2-3 rip vicine a cedimento. Muscoli: petto, tricipiti, deltoide ant.\nBand chest press | 3 | 12-15 | 60 | Fokky viola/nero. Banda dietro la schiena, sotto le ascelle. Spingi in avanti mani unite. No slancio del busto. Muscoli: petto, tricipiti.\nBand shoulder press | 2 | 10-12 | 60 | Fokky nero/rosso. In piedi su banda, maniglie alle spalle. Spingi sopra la testa senza inarcare la lombare. Muscoli: deltoide, trapezio.\nBand lateral raise | 2 | 12-15 | 45 | Gritin light/medium. In piedi su banda. Solleva fino a spalle, gomiti morbidi. No slancio. Muscoli: deltoide mediale.\nBand tricep kickback | 2 | 12-15 | 45 | Gritin medium. Busto inclinato ~45°, banda sotto un piede. Estendi il gomito indietro, fermo ai fianchi. Muscoli: tricipite.\n\n# Stretching finale (4 min)\n# PETTO: Chest opener a terra 45\"\n# BRACCIA: Stretch tricipite overhead 25\"/lato\n# CERVICALE: Rotazione cervicale 30\"/lato\n\n---\n\n# PULL - Giorno 2\n# Focus: Schiena · Bicipiti\n# Riscaldamento: Cat-cow 2x8 | Face pull leggero 2x15 | Shoulder rolls 2x15\n# Elastici: Fokky = compound (bent-over row) | Gritin = isolamento (face pull, curl)\n\nEsercizio | Serie | Rip | Recupero | Note tecniche\nBand bent-over row | 3 | 10-12 | 60 | Fokky viola/nero. Piedi sulla banda, busto inclinato 45°, schiena neutra. Tira verso l'ombelico, gomiti vicini. Ultime rip vicine a cedimento. Muscoli: dorsale, romboidi, bicipite.\nSuperman | 2 | 12-15 | 45 | Bodyweight. Prono, solleva braccia e gambe insieme. Contrai i glutei. No slancio. Muscoli: erettori spinali, lombare, glutei.\nBand face pull | 2 | 15 | 45 | Gritin light/medium. Banda tesa davanti al petto, tira verso il viso aprendo i gomiti. Muscoli: deltoide post., cervicale/salute spalla.\nBand bicep curl | 2 | 10-12 | 45 | Gritin medium. In piedi su banda, gomiti fissi ai fianchi. Curla espirando, scendi in 3s. No momentum. Muscoli: bicipite.\nBand hammer curl | 2 | 10-12 | 45 | Gritin medium. Presa neutra, stesso movimento del curl. Muscoli: bicipite, brachioradiale.\n\n# Stretching finale (4 min)\n# SCHIENA: Child's pose 45\"\n# BRACCIA: Stretch bicipite supino 30\"\n# CERVICALE: Inclinazione laterale collo 30\"/lato\n\n---\n\n# LEGS + CORE (mantenimento) - Giorno 3\n# Focus: Gambe · Glutei · Core\n# Riscaldamento: Air squat leggeri 1x15 | Mobilità anche/caviglie 1-2 min\n# Elastici: Fokky = compound (squat, RDL) | Gritin = isolamento (glute bridge)\n\nEsercizio | Serie | Rip | Recupero | Note tecniche\nBand squat | 3 | 12-15 | 45 | Fokky verde/viola. Banda sopra ginocchia o sotto piedi fino alle spalle. Scendi a parallelo, ginocchia in linea con le dita. Muscoli: quadricipiti, glutei.\nBand RDL (hip hinge) | 2 | 12-15 | 45 | Fokky viola/nero. Banda sotto i piedi, in mano. Spingi i fianchi indietro, schiena neutra. Muscoli: ischiocrurali, glutei.\nBand glute bridge | 2 | 15 | 45 | Gritin medium/heavy. Banda sopra le ginocchia, supino. Spingi i fianchi in alto, contrai in cima. Muscoli: glutei.\nPlank | 2 | 45-60 sec | 45 | Bodyweight. Avambracci a terra, corpo in linea. Addome contratto. Muscoli: core, trasverso addominale.\nBicycle crunch | 2 | 15 (per lato) | 45 | Bodyweight. Supino, alterna gomito-ginocchio opposto. Controlla, non tirare il collo. Muscoli: retto addominale, obliqui.\n\n# Stretching finale (4-6 min)\n# GAMBE: Hamstring supino 30\"/lato · Hip flexor affondo 30\"/lato\n# PETTO: Chest opener 30\"\n# SCHIENA: Cobra passivo 30\"\n\n---\n\n# NOTE GENERALI\n# Split settimanale: Push (1) - Pull (2) - Legs + Core mantenimento (3) - stesso schema dell'Upper A / Lower / Upper B originale\n# Obiettivo: tonificazione - volume ridotto rispetto a un piano da ipertrofia, 2-3 serie per esercizio\n# Attrezzatura: set di 5 elastici a resistenza variabile (Fokky + Gritin) + corpo libero\n# Criterio chiave: ogni serie va portata vicino a cedimento nelle ultime 2-3 rip - qualita' dell'esecuzione, non numero di giorni, garantisce il risultato\n# Se una serie a fine range (es. 15 rip) risulta troppo facile, sali di resistenza - altrimenti il lavoro diventa mantenimento, non tonificazione\n# Progressione: aumenta le rip fino al limite alto del range, poi passa a un elastico piu' resistente o combina 2 elastici insieme\n# Cervicale/spalle: mobilita' pre-Push e pre-Pull. Mai forzare il range se c'e' tensione\n";
window.DIETA_TXT_FALLBACK = "# PIANO NUTRIZIONALE - LORENZO FARAONI\n# Dr.ssa Mazzotta Manuela\n# IMPORTANTE: Escludere sempre pasta di ceci, pasta di lenticchie, pasta di piselli, bevanda di mandorla\n\n---\n\n# GIORNO SENZA ALLENAMENTO\n\nINTEGRATORI:\n- Mattina (colazione): Vita C+ Slow Release, Vita B+\n- Dopo pranzo: Extra Omega+ Concentrated (1ª assunzione)\n- Dopo merenda: PS+\n- Dopocena: Extra Omega+ Concentrated (2ª assunzione)\n- Prima di dormire: Gluta+ 1 misurino in 250ml acqua\n\nCOLAZIONE (scegli 1 opzione):\n- Opzione 1: 40g gallette grano saraceno (4) + 50g marmellata ridotto zucchero + 10g burro chiarificato\n- Opzione 2: 80g pane di segale (4 fette per 2 toast) + 100g prosciutto crudo oppure 100g bresaola\n- Opzione 3: 150g yogurt greco Fage Total 0% + 20g miele + 50g muesli linea viviverde coop\n- Opzione 4: 160g uova di gallina (2 uova) + 100g pane di segale\nNote: caffè sempre ok\n\nSPUNTINO:\n- 200g frutta fresca (no macedonie)\n- 30g noci oppure 30g mandorle\n\nPRANZO:\nCarboidrato (scegli 1): 80g pasta farro integrale | 80g riso rosso integrale | 80g riso venere | 80g riso basmati | 100g pane integrale | 120g pane di segale\nVerdure: 300g verdure o ortaggi a scelta\nCondimento: 20g olio extravergine di oliva\nProteina (scegli 1): 150g tonno | 110g primo sale | 160g ricotta vacca e pecora | 60g parmigiano reggiano | 100g feta | 250g orata surgelata | 280g filetto platessa findus (non panato) | 380g rana pescatrice | 200g filetto di manzo | 230g petto di tacchino | 130g salmone | 340g merluzzo | 190g uova (2 uova + 1-2 albumi) | 240g petto di pollo | 180g bistecca di manzo | 110g hamburger di chianina\n\nMERENDA:\n- 200g yogurt greco Fage Total 0% (o yoeggs)\n- 100g frutta fresca\n\nCENA:\nVerdure: 200g verdure o ortaggi oppure 90g verdure e legumi surgelati oppure 20g misto legumi secchi\nCondimento: 10g olio extravergine di oliva\nProteina (scegli 1): 250g merluzzo | 120g ricotta vacca e pecora | 70g feta | 110g orata fresca | 220g spigola o branzino | 100g salmone | 140g uova (2 uova) | 180g petto di pollo | 80g hamburger di chianina | 130g bistecca di manzo | 190g filetto di vitello | 110g tonno\n\n---\n\n# ALLENAMENTO MATTINA\n\nINTEGRATORI:\n- Mattina (colazione): Vita C+ Slow Release, Vita B+\n- Pre-allenamento: MGK+ Liquid, Fuel+, 45g Barretta Endurance 4Plus\n- Preparare: borraccia OMNIA+ (2 misurini in 500ml acqua) + borraccia solo acqua\n- Durante allenamento: bere OMNIA+ già preparato + acqua secondo necessità\n- Dopo pranzo: Extra Omega+ Concentrated (1ª assunzione)\n- Dopo merenda: PS+\n- Dopocena: Extra Omega+ Concentrated (2ª assunzione)\n- Prima di dormire: Gluta+ 1 misurino in 250ml acqua\n\nCOLAZIONE (prima dell'allenamento, scegli 1):\n- 40g gallette grano saraceno (4) + 50g marmellata ridotto zucchero o miele\n- 50g pane tipo 1 + 50g marmellata o miele\nNote: caffè ok\n\nPRANZO (post-allenamento, porzioni aumentate):\nCarboidrato (scegli 1): 80g pasta farro integrale | 70g pasta semola | 80g riso rosso integrale | 80g riso venere | 80g riso basmati | 100g pane grano duro | 100g pane integrale | 120g pane di segale\nVerdure: 300g verdure o ortaggi a scelta\nCondimento: 20g olio extravergine di oliva\nProteina aumentata (scegli 1): 180g tonno | 310g orata surgelata | 340g filetto platessa findus (non panato) | 460g rana pescatrice | 240g filetto di manzo | 280g petto di tacchino | 150g salmone | 410g merluzzo | 220g uova (2 uova + 1-2 albumi) | 290g petto di pollo | 210g bistecca di manzo | 140g hamburger di chianina\n\nMERENDA:\n- 200g yogurt greco Fage Total 0% (o yoeggs)\n- 100g frutta fresca\n- 30g noci\n\nCENA:\nVerdure: 100g verdure o ortaggi\nCondimento: 10g olio extravergine di oliva\nProteina (scegli 1): 220g merluzzo | 100g orata fresca | 190g spigola o branzino | 80g salmone | 120g uova (2 uova) | 150g petto di pollo | 70g hamburger di chianina | 110g bistecca di manzo | 170g filetto di vitello | 100g tonno\nExtra: 50g pane di segale\n\n---\n\n# ALLENAMENTO ORE 17\n\nINTEGRATORI:\n- Mattina (colazione): Vita C+ Slow Release, Vita B+\n- Dopo pranzo: Extra Omega+ Concentrated (1ª assunzione)\n- Dopo merenda: PS+\n- Pre-allenamento (45min prima, ore 16:15): MGK+ Liquid, Fuel+, 45g Barretta Endurance 4Plus\n- Preparare: borraccia OMNIA+ (2 misurini in 500ml acqua) + borraccia solo acqua\n- Durante allenamento: bere OMNIA+ già preparato + acqua secondo necessità\n- Dopocena: Extra Omega+ Concentrated (2ª assunzione)\n- Prima di dormire: Gluta+ 1 misurino in 250ml acqua\n\nCOLAZIONE (scegli 1):\n- Opzione 1: 40g gallette grano saraceno (4) + 50g marmellata ridotto zucchero + 10g burro chiarificato\n- Opzione 2: 80g pane di segale + 70g pane integrale + 100g prosciutto crudo oppure 100g bresaola\n- Opzione 3: 150g yogurt greco Fage Total 0% + 20g miele + 50g muesli linea viviverde coop\n- Opzione 4: 160g uova (2 uova) + 100g pane di segale oppure 90g pane integrale\nNote: caffè ok\n\nSPUNTINO:\n- 200g frutta fresca (no macedonie)\n- 30g noci oppure mandorle\n- 150g yogurt greco Fage Total 0%\n\nPRANZO:\nCarboidrato (scegli 1): 70g pasta farro integrale | 70g riso rosso integrale | 70g riso venere | 70g riso basmati | 100g pane di segale\nVerdure: 300g verdure o ortaggi a scelta\nCondimento: 20g olio extravergine di oliva\nProteina (scegli 1): 150g tonno | 110g primo sale | 60g parmigiano reggiano | 160g ricotta vacca e pecora | 100g feta | 250g orata surgelata | 280g filetto platessa findus (non panato) | 380g rana pescatrice | 200g filetto di manzo | 230g petto di tacchino | 130g salmone | 340g merluzzo | 190g uova (2 uova + 1-2 albumi) | 240g petto di pollo | 180g bistecca di manzo | 110g hamburger di chianina\n\nPOST ALLENAMENTO (cena):\nVerdure: 200g verdure o ortaggi oppure 90g verdure e legumi surgelati\nCondimento: 10g olio extravergine di oliva\nProteina (scegli 1): 250g merluzzo | 110g orata fresca | 220g spigola o branzino | 100g salmone | 140g uova (2 uova) | 180g petto di pollo | 80g hamburger di chianina | 130g bistecca di manzo | 190g filetto di vitello | 110g tonno\nCarboidrato: 80g riso basmati oppure 80g riso parboiled oppure 80g riso arborio\n\n---\n\n# ALLENAMENTO ORE 21\n\nINTEGRATORI:\n- Mattina (colazione): Vita C+ Slow Release, Vita B+\n- Dopo pranzo: Extra Omega+ Concentrated (1ª assunzione)\n- Dopo merenda: PS+\n- Pre-allenamento (45min prima, ore 20:15): MGK+ Liquid, Fuel+, 45g Barretta Endurance 4Plus\n- Preparare: borraccia OMNIA+ (2 misurini in 500ml acqua) + borraccia solo acqua\n- Durante allenamento: bere OMNIA+ già preparato + acqua secondo necessità\n- Dopocena: Extra Omega+ Concentrated (2ª assunzione)\n- Prima di dormire: Gluta+ 1 misurino in 250ml acqua\n\nCOLAZIONE (scegli 1):\n- Opzione 1: 40g gallette grano saraceno (4) + 50g marmellata ridotto zucchero + 10g burro chiarificato\n- Opzione 2: 80g pane di segale + 70g pane integrale + 100g prosciutto crudo oppure 100g bresaola\n- Opzione 3: 150g yogurt greco Fage Total 0% + 20g miele + 50g muesli linea viviverde coop\n- Opzione 4: 160g uova (2 uova) + 100g pane di segale oppure 90g pane integrale\nNote: caffè ok\n\nSPUNTINO:\n- 200g frutta fresca (no macedonie)\n- 30g noci oppure mandorle\n\nPRANZO:\nCarboidrato (scegli 1): 70g pasta farro integrale | 70g riso rosso integrale | 70g riso venere | 70g riso basmati | 100g pane di segale\nVerdure: 300g verdure o ortaggi a scelta\nCondimento: 20g olio extravergine di oliva\nProteina (scegli 1): 150g tonno | 250g orata surgelata | 280g filetto platessa findus (non panato) | 380g rana pescatrice | 200g filetto di manzo | 230g petto di tacchino | 130g salmone | 340g merluzzo | 190g uova (2 uova + 1-2 albumi) | 240g petto di pollo | 180g bistecca di manzo | 110g hamburger di chianina\n\nMERENDA (entro le 17:00):\n- 200g yogurt greco Fage Total 0% (o yoeggs)\n- 100g frutta fresca\n\nPOST ALLENAMENTO (cena leggera):\nVerdure: 100g verdure o ortaggi\nCondimento: 10g olio extravergine di oliva\nProteina leggera (scegli 1): 150g merluzzo | 70g orata fresca | 130g spigola o branzino | 60g salmone | 80g uova (2 uova) | 110g petto di pollo | 50g hamburger di chianina | 80g bistecca di manzo | 120g filetto di vitello | 70g tonno\nCarboidrato: 50g riso basmati oppure 50g riso parboiled oppure 50g riso arborio\n\n---\n\n# ALLENAMENTO ORE 22\n\nINTEGRATORI:\n- Mattina (colazione): Vita C+ Slow Release, Vita B+\n- Dopo pranzo: Extra Omega+ Concentrated (1ª assunzione)\n- Dopo merenda: PS+\n- Pre-allenamento (45min prima, ore 21:15): MGK+ Liquid, Fuel+, 45g Barretta Endurance 4Plus\n- Preparare: borraccia OMNIA+ (2 misurini in 500ml acqua) + borraccia solo acqua\n- Durante allenamento: bere OMNIA+ già preparato + acqua secondo necessità\n- Dopocena: Extra Omega+ Concentrated (2ª assunzione)\n- Prima di dormire: Gluta+ 1 misurino in 250ml acqua\n\nCOLAZIONE (scegli 1):\n- Opzione 1: 40g gallette grano saraceno (4) + 50g marmellata ridotto zucchero + 10g burro chiarificato\n- Opzione 2: 80g pane di segale + 70g pane integrale + 100g prosciutto crudo oppure 100g bresaola\n- Opzione 3: 150g yogurt greco Fage Total 0% + 20g miele + 50g muesli linea viviverde coop\n- Opzione 4: 160g uova (2 uova) + 100g pane di segale oppure 90g pane integrale\nNote: caffè ok\n\nSPUNTINO:\n- 200g frutta fresca (no macedonie)\n- 30g noci oppure mandorle\n\nPRANZO:\nCarboidrato (scegli 1): 80g pasta farro integrale | 80g riso rosso integrale | 80g riso venere | 80g riso basmati | 100g pane integrale | 120g pane di segale\nVerdure: 300g verdure o ortaggi a scelta\nCondimento: 20g olio extravergine di oliva\nProteina (scegli 1): 150g tonno | 250g orata surgelata | 280g filetto platessa findus (non panato) | 380g rana pescatrice | 200g filetto di manzo | 230g petto di tacchino | 130g salmone | 340g merluzzo | 190g uova (2 uova + 1-2 albumi) | 240g petto di pollo | 180g bistecca di manzo | 110g hamburger di chianina\n\nMERENDA ALLE 18:00:\nVerdure: 100g verdure o ortaggi\nCondimento: 10g olio extravergine di oliva\nProteina (scegli 1): 250g merluzzo | 110g orata fresca | 220g spigola o branzino | 100g salmone | 140g uova (2 uova) | 180g petto di pollo | 80g hamburger di chianina | 130g bistecca di manzo | 190g filetto di vitello | 110g tonno\nCarboidrato: 50g riso basmati | 60g pane grano duro | 50g riso parboiled | 50g riso arborio\n\nPOST ALLENAMENTO:\nNessun pasto aggiuntivo - l'allenamento è a fine giornata\n\n---\n\n# NOTE GENERALI\n# Acqua: almeno 2.5-3L al giorno (obiettivo 3L con peso ~100kg)\n# Caffè: sempre ok in aggiunta ai pasti\n# Frutta: no macedonie, solo frutta intera\n# Integratori fissi ogni giorno: Vita C+ Slow Release + Vita B+ (mattina) | Extra Omega+ Concentrated x2 (dopo pranzo e dopocena) | PS+ (dopo merenda) | Gluta+ (prima di dormire)\n# Integratori solo allenamento: MGK+ Liquid + Fuel+ + Barretta 4Plus 45g (pre-WO) | OMNIA+ 2 misurini 500ml + borraccia acqua (intra-WO)\n# Alimenti da ESCLUDERE sempre: pasta di ceci, pasta di lenticchie, pasta di piselli, bevanda di mandorla\n";
})();

// ══ parser.jsx ══
;(function () {
const _MUSCLE_MAP = [[["pettorale", "gran pettorale", "petto", "pettorale superiore", "pettorale basso", "pettorale medio"], "petto"], [["dorsale", "gran dorsale", "romboidi", "teres", "latissimus"], "schiena"], [["deltoide", "spalle", "deltoide anteriore", "deltoide posteriore", "deltoide mediale"], "spalle"], [["bicipite", "bicipiti"], "bicipiti"], [["tricipite", "tricipiti"], "tricipiti"], [["addome", "retto addominale", "core", "obliqui", "trasverso"], "addome"], [["quadricipiti", "quadricipite"], "quadricipiti"], [["femorali", "ischiocrurali", "ischiocrural"], "femorali"], [["polpacci", "gastrocnemio", "soleo"], "polpacci"], [["glutei", "gluteo", "gluteo grande"], "glutei"], [["trapezio", "trapezi"], "trapezi"], [["erettori", "lombare"], "schiena"], [["serrante"], "petto"]];
function _detectMuscles(notes) {
  const found = [];
  const lower = notes.toLowerCase();
  const muscMatch = lower.match(/muscoli:\s*([^.]+)/);
  const str = muscMatch ? muscMatch[1].toLowerCase() : lower;
  _MUSCLE_MAP.forEach(([keys, val]) => {
    if (!found.includes(val) && keys.some(k => str.includes(k))) found.push(val);
  });
  return found.length ? found : ["schiena"];
}
window.parseScheda = function (text) {
  if (!text || typeof text !== "string") return {
    days: []
  };
  const lines = text.split("\n");
  const days = [];
  let cur = null;
  let inTable = false;
  const DAY_RE = /-\s*giorno\s+(\d+)\s*$/i;
  const hasNumbered = lines.some(l => DAY_RE.test(l.trim().replace(/^#\s*/, "")));
  const startDay = (num, key, name) => {
    cur = {
      num,
      key,
      name,
      focus: [],
      exercises: [],
      altMap: {}
    };
    days.push(cur);
    inTable = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === "---") {
      cur = null;
      inTable = false;
      continue;
    }
    if (line.startsWith("# ")) {
      const body = line.slice(2).trim();
      if (hasNumbered) {
        const m = body.match(DAY_RE);
        if (m) {
          const num = parseInt(m[1], 10);
          const name = body.replace(DAY_RE, "").replace(/[-–·|]+\s*$/, "").trim() || "Giorno " + num;
          startDay(num, "Giorno " + num, name);
          continue;
        }
      } else {
        const up = body.toUpperCase();
        if (up.includes("UPPER A")) {
          startDay(days.length + 1, "Upper A", "Upper A");
          continue;
        }
        if (up.includes("UPPER B")) {
          startDay(days.length + 1, "Upper B", "Upper B");
          continue;
        }
        if (up.includes("LOWER")) {
          startDay(days.length + 1, "Lower", "Lower");
          continue;
        }
      }
      const fm = body.match(/^focus:\s*(.+)$/i);
      if (fm && cur) {
        if (!cur.focus.length) cur.focus = fm[1].split(/[·,|]/).map(s => s.trim()).filter(Boolean);
        continue;
      }
      if (body.includes("→") && cur) {
        const [exPart, altPart] = body.split("→").map(s => s.trim());
        if (exPart && altPart) {
          cur.altMap[exPart.toLowerCase()] = altPart.split("/").map(s => s.trim()).filter(Boolean);
        }
        continue;
      }
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("Esercizio |")) {
      inTable = true;
      continue;
    }
    if (inTable && line.includes("|")) {
      const parts = line.split("|").map(s => s.trim());
      if (parts.length < 4) continue;
      const [name, setsStr, ripStr, restStr, notes = ""] = parts;
      if (!name || name.toLowerCase().includes("esercizio")) continue;
      const setsCount = parseInt(setsStr) || 3;
      const rest = parseInt(restStr) || 90;
      const muscles = _detectMuscles(notes);
      const ripMatch = ripStr.match(/(\d+)[-–](\d+)/);
      const ripVal = ripMatch ? parseInt(ripMatch[1]) : parseInt(ripStr) || 10;
      const ripRange = ripStr;
      const sets = Array.from({
        length: setsCount
      }, () => ({
        peso: 0,
        rip: ripVal
      }));
      cur.exercises.push({
        name,
        muscles,
        sets,
        rest,
        notes,
        ripRange,
        history: [],
        alternatives: []
      });
    }
  }
  days.forEach(d => {
    d.exercises.forEach(ex => {
      const k = Object.keys(d.altMap).find(key => ex.name.toLowerCase().includes(key) || key.includes(ex.name.toLowerCase().slice(0, 8)));
      if (k) ex.alternatives = d.altMap[k];
    });
  });
  return {
    days
  };
};
function _musclesFromExercises(exercises) {
  const seen = [];
  (exercises || []).forEach(ex => (ex.muscles || []).forEach(m => {
    const c = m.charAt(0).toUpperCase() + m.slice(1);
    if (!seen.includes(c)) seen.push(c);
  }));
  return seen.slice(0, 6);
}
window._musclesFromExercises = _musclesFromExercises;
window.getSchedule = function () {
  const st = window.storage;
  const text = (st ? st.get("schedaData", null) : null) || window.SCHEDA_TXT_FALLBACK || null;
  if (!text) return {
    days: []
  };
  try {
    return window.parseScheda(text);
  } catch (_) {
    return {
      days: []
    };
  }
};
window.getSelectedSession = function () {
  const st = window.storage;
  const todayK = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  if (st && st.get("restDay_" + todayK, false)) return null;
  const days = window.getSchedule().days || [];
  if (!days.length) return null;
  const selKey = st ? st.get("schedaSelectedDay", null) : null;
  return days.find(d => d.key === selKey) || days[0];
};
const _SECTION_KEYS = {
  "GIORNO SENZA ALLENAMENTO": "riposo",
  "ALLENAMENTO MATTINA": "mattina",
  "ALLENAMENTO ORE 17": "ore17",
  "ALLENAMENTO ORE 21": "ore21",
  "ALLENAMENTO ORE 22": "ore22"
};
const _MEAL_META = {
  "COLAZIONE": {
    time: "08:00",
    emoji: "🌅",
    title: "Colazione"
  },
  "SPUNTINO": {
    time: "10:30",
    emoji: "🍎",
    title: "Spuntino"
  },
  "PRANZO": {
    time: "13:00",
    emoji: "🍝",
    title: "Pranzo"
  },
  "MERENDA ALLE 18:00": {
    time: "18:00",
    emoji: "🍎",
    title: "Merenda"
  },
  "MERENDA": {
    time: "16:30",
    emoji: "🍎",
    title: "Merenda"
  },
  "PRE-WORKOUT": {
    time: "07:30",
    emoji: "💪",
    title: "Pre-workout"
  },
  "POST-WORKOUT": {
    time: "10:30",
    emoji: "🥤",
    title: "Post-workout"
  },
  "PRE WO": {
    time: "07:30",
    emoji: "💪",
    title: "Pre-WO"
  },
  "POST WO": {
    time: "18:30",
    emoji: "🥤",
    title: "Post-WO"
  },
  "PRE-WO": {
    time: "07:30",
    emoji: "💪",
    title: "Pre-WO"
  },
  "POST-WO": {
    time: "18:30",
    emoji: "🥤",
    title: "Post-WO"
  },
  "POST ALLENAMENTO": {
    time: "19:30",
    emoji: "🥤",
    title: "Post-workout"
  },
  "CENA": {
    time: "20:00",
    emoji: "🌙",
    title: "Cena"
  }
};
const _EXCLUDED = ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"];
function _isExcluded(text) {
  return _EXCLUDED.some(e => text.toLowerCase().includes(e));
}
const _INTEGRATORI = {
  riposo: [{
    name: "Vita C+ Slow Release",
    time: "Colazione (mattina)",
    sortTime: "08:00",
    color: "#FF9F0A",
    type: "vitac"
  }, {
    name: "Vita B+",
    time: "Colazione (mattina)",
    sortTime: "08:00",
    color: "#FFD60A",
    type: "vitab"
  }, {
    name: "Extra Omega+ (1ª)",
    time: "Dopo pranzo",
    sortTime: "14:00",
    color: "#5AC8FA",
    type: "omega1"
  }, {
    name: "PS+",
    time: "Dopo merenda",
    sortTime: "17:00",
    color: "#BF5AF2",
    type: "ps"
  }, {
    name: "Extra Omega+ (2ª)",
    time: "Dopocena",
    sortTime: "21:00",
    color: "#5AC8FA",
    type: "omega2"
  }, {
    name: "Gluta+ · 1 mis. 250ml",
    time: "Prima di dormire",
    sortTime: "23:00",
    color: "#30D158",
    type: "gluta"
  }],
  mattina: [{
    name: "Vita C+ Slow Release",
    time: "Colazione",
    sortTime: "06:30",
    color: "#FF9F0A",
    type: "vitac"
  }, {
    name: "Vita B+",
    time: "Colazione",
    sortTime: "06:30",
    color: "#FFD60A",
    type: "vitab"
  }, {
    name: "MGK+ Liquid",
    time: "Pre-WO (45min prima)",
    sortTime: "07:15",
    color: "#0A84FF",
    type: "mgk"
  }, {
    name: "Fuel+",
    time: "Pre-WO (45min prima)",
    sortTime: "07:15",
    color: "#0A84FF",
    type: "fuel"
  }, {
    name: "Barretta 4plus 45g",
    time: "Pre-WO (45min prima)",
    sortTime: "07:15",
    color: "#FF9F0A",
    type: "barretta"
  }, {
    name: "OMNIA+ 500ml",
    time: "Intra-WO (borraccia)",
    sortTime: "08:00",
    color: "#5AC8FA",
    type: "omnia"
  }, {
    name: "Extra Omega+ (1ª)",
    time: "Dopo pranzo",
    sortTime: "11:30",
    color: "#5AC8FA",
    type: "omega1"
  }, {
    name: "PS+",
    time: "Dopo merenda",
    sortTime: "16:30",
    color: "#BF5AF2",
    type: "ps"
  }, {
    name: "Extra Omega+ (2ª)",
    time: "Dopocena",
    sortTime: "21:00",
    color: "#5AC8FA",
    type: "omega2"
  }, {
    name: "Gluta+ · 1 mis. 250ml",
    time: "Prima di dormire",
    sortTime: "23:00",
    color: "#30D158",
    type: "gluta"
  }],
  ore17: [{
    name: "Vita C+ Slow Release",
    time: "Colazione",
    sortTime: "08:00",
    color: "#FF9F0A",
    type: "vitac"
  }, {
    name: "Vita B+",
    time: "Colazione",
    sortTime: "08:00",
    color: "#FFD60A",
    type: "vitab"
  }, {
    name: "Extra Omega+ (1ª)",
    time: "Dopo pranzo",
    sortTime: "14:00",
    color: "#5AC8FA",
    type: "omega1"
  }, {
    name: "MGK+ Liquid",
    time: "Pre-WO ore 16:15",
    sortTime: "16:15",
    color: "#0A84FF",
    type: "mgk"
  }, {
    name: "Fuel+",
    time: "Pre-WO ore 16:15",
    sortTime: "16:15",
    color: "#0A84FF",
    type: "fuel"
  }, {
    name: "Barretta 4plus 45g",
    time: "Pre-WO ore 16:15",
    sortTime: "16:15",
    color: "#FF9F0A",
    type: "barretta"
  }, {
    name: "PS+",
    time: "Dopo merenda",
    sortTime: "16:30",
    color: "#BF5AF2",
    type: "ps"
  }, {
    name: "OMNIA+ 500ml",
    time: "Intra-WO (borraccia)",
    sortTime: "17:00",
    color: "#5AC8FA",
    type: "omnia"
  }, {
    name: "Extra Omega+ (2ª)",
    time: "Dopocena",
    sortTime: "21:00",
    color: "#5AC8FA",
    type: "omega2"
  }, {
    name: "Gluta+ · 1 mis. 250ml",
    time: "Prima di dormire",
    sortTime: "23:00",
    color: "#30D158",
    type: "gluta"
  }],
  ore21: [{
    name: "Vita C+ Slow Release",
    time: "Colazione",
    sortTime: "08:00",
    color: "#FF9F0A",
    type: "vitac"
  }, {
    name: "Vita B+",
    time: "Colazione",
    sortTime: "08:00",
    color: "#FFD60A",
    type: "vitab"
  }, {
    name: "Extra Omega+ (1ª)",
    time: "Dopo pranzo",
    sortTime: "14:00",
    color: "#5AC8FA",
    type: "omega1"
  }, {
    name: "PS+",
    time: "Dopo merenda · entro 17:00",
    sortTime: "16:30",
    color: "#BF5AF2",
    type: "ps"
  }, {
    name: "MGK+ Liquid",
    time: "Pre-WO ore 20:15",
    sortTime: "20:15",
    color: "#0A84FF",
    type: "mgk"
  }, {
    name: "Fuel+",
    time: "Pre-WO ore 20:15",
    sortTime: "20:15",
    color: "#0A84FF",
    type: "fuel"
  }, {
    name: "Barretta 4plus 45g",
    time: "Pre-WO ore 20:15",
    sortTime: "20:15",
    color: "#FF9F0A",
    type: "barretta"
  }, {
    name: "OMNIA+ 500ml",
    time: "Intra-WO (borraccia)",
    sortTime: "21:00",
    color: "#5AC8FA",
    type: "omnia"
  }, {
    name: "Extra Omega+ (2ª)",
    time: "Dopocena",
    sortTime: "22:30",
    color: "#5AC8FA",
    type: "omega2"
  }, {
    name: "Gluta+ · 1 mis. 250ml",
    time: "Prima di dormire",
    sortTime: "23:30",
    color: "#30D158",
    type: "gluta"
  }],
  ore22: [{
    name: "Vita C+ Slow Release",
    time: "Colazione",
    sortTime: "08:00",
    color: "#FF9F0A",
    type: "vitac"
  }, {
    name: "Vita B+",
    time: "Colazione",
    sortTime: "08:00",
    color: "#FFD60A",
    type: "vitab"
  }, {
    name: "Extra Omega+ (1ª)",
    time: "Dopo pranzo",
    sortTime: "14:00",
    color: "#5AC8FA",
    type: "omega1"
  }, {
    name: "MGK+ Liquid",
    time: "Pre-WO ore 21:15",
    sortTime: "21:15",
    color: "#0A84FF",
    type: "mgk"
  }, {
    name: "Fuel+",
    time: "Pre-WO ore 21:15",
    sortTime: "21:15",
    color: "#0A84FF",
    type: "fuel"
  }, {
    name: "Barretta 4plus 45g",
    time: "Pre-WO ore 21:15",
    sortTime: "21:15",
    color: "#FF9F0A",
    type: "barretta"
  }, {
    name: "OMNIA+ 500ml",
    time: "Intra-WO (borraccia)",
    sortTime: "22:00",
    color: "#5AC8FA",
    type: "omnia"
  }, {
    name: "Extra Omega+ (2ª)",
    time: "Dopocena",
    sortTime: "23:30",
    color: "#5AC8FA",
    type: "omega2"
  }, {
    name: "Gluta+ · 1 mis. 250ml",
    time: "Prima di dormire",
    sortTime: "23:55",
    color: "#30D158",
    type: "gluta"
  }]
};
const _FOOD_EMOJI = [[["proteina"], "🍗"], [["carboidrato"], "🍚"], [["verdure", "ortaggi", "insalata", "spinaci"], "🥦"], [["olio", "evo"], "🫒"], [["burro"], "🧈"], [["yogurt", "skyr", "yoeggs"], "🥛"], [["ricotta", "primo sale", "parmigiano", "feta", "mozzarella", "formaggio"], "🧀"], [["uova", "uovo"], "🥚"], [["tonno", "salmone", "orata", "merluzzo", "platessa", "branzino", "spigola", "pesce", "gamber"], "🐟"], [["pollo", "tacchino", "manzo", "vitello", "bresaola", "prosciutto", "hamburger", "chianina", "bistecca", "carne"], "🍗"], [["gallette", "cracker"], "🍘"], [["pane", "segale"], "🍞"], [["pasta", "gnocchi"], "🍝"], [["riso", "basmati", "parboiled", "arborio", "farro", "orzo", "couscous", "cereali", "avena"], "🍚"], [["patate"], "🥔"], [["muesli"], "🥣"], [["marmellata", "miele", "confettura"], "🍯"], [["frutta", "mela", "banana", "frutti", "macedonia"], "🍎"], [["noci", "mandorle", "nocciole", "semi"], "🥜"], [["barretta", "4plus", "endurance"], "🍫"], [["legumi", "ceci", "lenticchie", "fagioli"], "🫘"], [["caffè", "caffe"], "☕"], [["acqua"], "💧"], [["nessun"], "🚫"]];
window.foodEmoji = function (text) {
  if (!text || typeof text !== "string") return "🍽️";
  const s = text.toLowerCase();
  for (const [keys, emoji] of _FOOD_EMOJI) {
    if (keys.some(k => s.includes(k))) return emoji;
  }
  return "🍽️";
};
window.parseDieta = function (text) {
  if (!text || typeof text !== "string") return null;
  const lines = text.split("\n");
  const result = {};
  let currentSection = null;
  let currentMeal = null;
  function _findMealKey(line) {
    const up = line.toUpperCase();
    const keys = Object.keys(_MEAL_META).sort((a, b) => b.length - a.length);
    return keys.find(k => up.startsWith(k)) || null;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === "---") {
      currentSection = null;
      currentMeal = null;
      continue;
    }
    if (line.toUpperCase().startsWith("INTEGRATORI")) continue;
    if (line.startsWith("# NOTE") || /^# (Acqua|Caff|Frutta|Integr|Alimenti|PIANO|Dr\.|IMPORT)/i.test(line)) continue;
    const secKey = Object.keys(_SECTION_KEYS).find(k => line === `# ${k}`);
    if (secKey) {
      currentSection = _SECTION_KEYS[secKey];
      result[currentSection] = {
        meals: [],
        integratori: JSON.parse(JSON.stringify(_INTEGRATORI[currentSection] || []))
      };
      currentMeal = null;
      continue;
    }
    if (!currentSection) continue;
    const mealKey = _findMealKey(line);
    if (mealKey) {
      const meta = _MEAL_META[mealKey];
      currentMeal = {
        time: meta.time,
        emoji: meta.emoji,
        title: meta.title,
        primary: [],
        others: []
      };
      result[currentSection].meals.push(currentMeal);
      continue;
    }
    if (!currentMeal) continue;
    if (/^- Opzione \d+:/.test(line)) {
      const content = line.replace(/^- Opzione \d+:\s*/, "").trim();
      if (_isExcluded(content)) continue;
      if (currentMeal.primary.length === 0) {
        currentMeal.primary.push({
          food: content,
          qty: ""
        });
      } else {
        currentMeal.others.push({
          food: content,
          qty: ""
        });
      }
      continue;
    }
    if (line.startsWith("- ")) {
      const content = line.slice(2).trim();
      if (!content || content.toLowerCase().startsWith("note:")) continue;
      if (_isExcluded(content)) continue;
      currentMeal.primary.push({
        food: content,
        qty: ""
      });
      continue;
    }
    if (/^Note:/i.test(line)) continue;
    if (/^Nessun/i.test(line)) {
      currentMeal.primary.push({
        food: line,
        qty: ""
      });
      continue;
    }
    if (line.includes(":") && line.includes("|")) {
      const colonIdx = line.indexOf(":");
      const label = line.slice(0, colonIdx).trim();
      const options = line.slice(colonIdx + 1).split("|").map(s => s.trim()).filter(Boolean).filter(s => !_isExcluded(s));
      if (!options.length) continue;
      const top = options.slice(0, 4);
      const rest = options.slice(4);
      currentMeal.primary.push({
        food: `${label}: ${top.join(" | ")}`,
        qty: ""
      });
      if (rest.length > 0) {
        currentMeal.others.push({
          food: `Altre opzioni: ${rest.join(" | ")}`,
          qty: ""
        });
      }
      continue;
    }
    if (line.includes(":") && !line.startsWith("#")) {
      const colonIdx = line.indexOf(":");
      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value && !_isExcluded(value)) {
        currentMeal.primary.push({
          food: `${label}: ${value}`,
          qty: ""
        });
      }
    }
  }
  ["riposo", "mattina", "ore17", "ore21", "ore22"].forEach(k => {
    if (!result[k]) result[k] = {
      meals: [],
      integratori: JSON.parse(JSON.stringify(_INTEGRATORI[k] || []))
    };
  });
  return result;
};
window.buildDefaultNotifConfig = function () {
  const mealsFor = keys => keys.map(k => {
    const m = _MEAL_META[k];
    return {
      id: "pasto_" + k.toLowerCase().replace(/\s+/g, "_"),
      cat: "pasto",
      label: m.title,
      time: m.time,
      on: true
    };
  });
  const suppsFor = dt => (_INTEGRATORI[dt] || []).map((s, i) => ({
    id: "int_" + dt + "_" + i,
    cat: "integratore",
    label: s.name,
    time: s.sortTime,
    on: true
  }));
  const workout = (label, time) => ({
    id: "allenamento",
    cat: "allenamento",
    label,
    time,
    on: true
  });
  const daytypes = {
    riposo: [...mealsFor(["COLAZIONE", "SPUNTINO", "PRANZO", "MERENDA", "CENA"]), ...suppsFor("riposo")],
    mattina: [workout("Allenamento", "07:00"), ...mealsFor(["PRE WO", "POST WO", "MERENDA", "CENA"]), ...suppsFor("mattina")],
    ore17: [...mealsFor(["COLAZIONE", "SPUNTINO", "PRANZO"]), workout("Allenamento ore 17", "16:30"), ...suppsFor("ore17")],
    ore21: [...mealsFor(["COLAZIONE", "SPUNTINO", "PRANZO", "MERENDA"]), workout("Allenamento ore 21", "20:00"), ...suppsFor("ore21")],
    ore22: [...mealsFor(["COLAZIONE", "SPUNTINO", "PRANZO"]), workout("Allenamento ore 22", "21:00"), ...suppsFor("ore22")]
  };
  const weekly = {
    mon: "ore17",
    tue: "riposo",
    wed: "ore17",
    thu: "riposo",
    fri: "ore17",
    sat: "riposo",
    sun: "riposo"
  };
  return {
    weekly,
    daytypes,
    overrides: {}
  };
};
})();

// ══ i18n.jsx ══
;(function () {
const I18N_DICT = {
  "Home": {
    en: "Home"
  },
  "Scheda": {
    en: "Workout"
  },
  "Dieta": {
    en: "Diet"
  },
  "Spesa": {
    en: "Shop"
  },
  "Coach": {
    en: "Coach"
  },
  "Setup": {
    en: "Setup"
  },
  "Dashboard": {
    en: "Dashboard"
  },
  "Allenamento": {
    en: "Workout"
  },
  "Lista spesa": {
    en: "Shopping list"
  },
  "Ingredienti della settimana": {
    en: "This week's ingredients"
  },
  "Genera lista spesa": {
    en: "Generate shopping list"
  },
  "kg o elastico": {
    en: "kg or band"
  },
  "AI Coach": {
    en: "AI Coach"
  },
  "Impostazioni": {
    en: "Settings"
  },
  "Fitness Hub": {
    en: "Fitness Hub"
  },
  "Storico": {
    en: "History"
  },
  "Progressi": {
    en: "Progress"
  },
  "Buongiorno Lorenzo": {
    en: "Good morning Lorenzo"
  },
  "Buon pomeriggio Lorenzo": {
    en: "Good afternoon Lorenzo"
  },
  "Buonasera Lorenzo": {
    en: "Good evening Lorenzo"
  },
  "Sessione di oggi": {
    en: "Today's session"
  },
  "Inizia allenamento": {
    en: "Start workout"
  },
  "Prossimo pasto": {
    en: "Next meal"
  },
  "Adesso": {
    en: "Now"
  },
  "Inizia": {
    en: "Start"
  },
  "Ignora": {
    en: "Dismiss"
  },
  "Oggi tocca allenarti — inizia quando vuoi.": {
    en: "Training day — start whenever you're ready."
  },
  "Registra il check-in serale (sonno/energia).": {
    en: "Log your evening check-in (sleep/energy)."
  },
  "Sei indietro con l'acqua — bevi un bicchiere.": {
    en: "You're behind on water — drink a glass."
  },
  "negli ultimi 14 giorni": {
    en: "in the last 14 days"
  },
  "esercizi": {
    en: "exercises"
  },
  "serie": {
    en: "sets"
  },
  "stimati": {
    en: "estimated"
  },
  "Programma": {
    en: "Program"
  },
  "Settimana": {
    en: "Week"
  },
  "di": {
    en: "of"
  },
  "Peso corporeo": {
    en: "Body weight"
  },
  "Integratori": {
    en: "Supplements"
  },
  "oggi": {
    en: "today"
  },
  "Movimento": {
    en: "Movement"
  },
  "questa sett": {
    en: "this wk"
  },
  "percorsi": {
    en: "covered"
  },
  "sessioni": {
    en: "sessions"
  },
  "Log": {
    en: "Log"
  },
  "Nessuna attività ancora — tocca Log per aggiungere.": {
    en: "No activity yet — tap Log to add."
  },
  "Oggi": {
    en: "Today"
  },
  "3 obiettivi": {
    en: "3 goals"
  },
  "Pesi": {
    en: "Weights"
  },
  "Cardio": {
    en: "Cardio"
  },
  "Proteine": {
    en: "Protein"
  },
  "Come stai oggi?": {
    en: "How are you today?"
  },
  "il coach lo legge": {
    en: "the coach reads this"
  },
  "Sonno": {
    en: "Sleep"
  },
  "Energia": {
    en: "Energy"
  },
  "Fastidi": {
    en: "Pain points"
  },
  "opzionale": {
    en: "optional"
  },
  "es. spalla destra, ginocchio sinistro…": {
    en: "e.g. right shoulder, left knee…"
  },
  "Idratazione": {
    en: "Hydration"
  },
  "2/3 sessioni": {
    en: "2/3 sessions"
  },
  "Vai alla scheda": {
    en: "Go to workout"
  },
  "Giorno di riposo": {
    en: "Rest day"
  },
  "Giorno": {
    en: "Day"
  },
  "Oggi riposo": {
    en: "Rest today"
  },
  "Recupero attivo, mobilità e idratazione.": {
    en: "Active recovery, mobility and hydration."
  },
  "Cambia scheda": {
    en: "Change program"
  },
  "Aggiorna…": {
    en: "Update…"
  },
  "Registra il peso per almeno 2 giorni per vedere il trend.": {
    en: "Log your weight for at least 2 days to see the trend."
  },
  "Nessuna serie registrata questa settimana": {
    en: "No sets logged this week"
  },
  "Oggi sei andato in palestra": {
    en: "You hit the gym today"
  },
  "Sei andato in palestra oggi?": {
    en: "Did you hit the gym today?"
  },
  "volta": {
    en: "time"
  },
  "volte": {
    en: "times"
  },
  "questa settimana": {
    en: "this week"
  },
  "Nessuna sessione ancora questa settimana": {
    en: "No sessions yet this week"
  },
  "Logga attività": {
    en: "Log activity"
  },
  "Tipo": {
    en: "Type"
  },
  "Durata": {
    en: "Duration"
  },
  "Distanza": {
    en: "Distance"
  },
  "opz.": {
    en: "opt."
  },
  "Note": {
    en: "Notes"
  },
  "Z2, BPM 145, sensazione…": {
    en: "Z2, HR 145, feeling…"
  },
  "Annulla": {
    en: "Cancel"
  },
  "Salva sessione": {
    en: "Save session"
  },
  "Corsa": {
    en: "Running"
  },
  "Camminata": {
    en: "Walking"
  },
  "Ellittica": {
    en: "Elliptical"
  },
  "Bike": {
    en: "Bike"
  },
  "Hiit": {
    en: "HIIT"
  },
  "Attività": {
    en: "Activity"
  },
  "Sessione": {
    en: "Session"
  },
  "Recupero": {
    en: "Rest"
  },
  "min · sec": {
    en: "min · sec"
  },
  "Salta": {
    en: "Skip"
  },
  "Riprendi": {
    en: "Resume"
  },
  "Casa": {
    en: "Home"
  },
  "Storico · ultime 3": {
    en: "History · last 3"
  },
  "Quando": {
    en: "When"
  },
  "Peso": {
    en: "Weight"
  },
  "Rip": {
    en: "Rep"
  },
  "Set": {
    en: "Set"
  },
  "Sostituisci con": {
    en: "Swap with"
  },
  "Ripristina originale": {
    en: "Restore original"
  },
  "Sostituisci": {
    en: "Swap"
  },
  "Macchina occupata": {
    en: "Machine busy"
  },
  "Occupata": {
    en: "Busy"
  },
  "Macchina": {
    en: "Machine"
  },
  "Note di oggi": {
    en: "Today's notes"
  },
  "Sensazioni, fastidi, dettagli da ricordare… il coach AI le leggerà.": {
    en: "Feelings, pains, details to remember… the AI coach will read them."
  },
  "caratteri": {
    en: "characters"
  },
  "serie completate": {
    en: "sets completed"
  },
  "Sessione completata!": {
    en: "Session complete!"
  },
  "Tocca ovunque per chiudere": {
    en: "Tap anywhere to close"
  },
  "Nessuno storico disponibile": {
    en: "No history available"
  },
  "Nessuna alternativa disponibile": {
    en: "No alternative available"
  },
  "Sonno scarso — riduci l'intensità oggi": {
    en: "Poor sleep — dial back intensity today"
  },
  "Energia bassa — ascolta il corpo oggi": {
    en: "Low energy — listen to your body today"
  },
  "Macchina occupata — attendi o sostituisci con ↻": {
    en: "Machine busy — wait or swap with ↻"
  },
  "Macchina libera — clicca per sbloccare": {
    en: "Machine free — tap to unlock"
  },
  "Macchina occupata — clicca per segnalare": {
    en: "Machine busy — tap to flag"
  },
  "Sessione completa — Salva su Sheets": {
    en: "Session complete — Save to Sheets"
  },
  "Chiudi sessione": {
    en: "Close session"
  },
  "Sessione salvata": {
    en: "Session saved"
  },
  "Errore salvataggio": {
    en: "Save error"
  },
  "Rate of Perceived Exertion: quanto hai lavorato duramente su scala 1-10. 7 = moderato · 8 = faticoso · 9 = quasi al limite · 10 = massimale": {
    en: "Rate of Perceived Exertion: how hard the set felt on a 1-10 scale. 7 = moderate · 8 = hard · 9 = near limit · 10 = max effort"
  },
  "Lun scorso": {
    en: "Last Mon"
  },
  "Gio scorso": {
    en: "Last Thu"
  },
  "Ven scorso": {
    en: "Last Fri"
  },
  "Lun -2": {
    en: "Mon -2"
  },
  "Lun -3": {
    en: "Mon -3"
  },
  "Gio -2": {
    en: "Thu -2"
  },
  "Gio -3": {
    en: "Thu -3"
  },
  "Ven -2": {
    en: "Fri -2"
  },
  "Ven -3": {
    en: "Fri -3"
  },
  "Serie {n} di {m}": {
    en: "Set {n} of {m}"
  },
  "Serie fatta": {
    en: "Set done"
  },
  "L'ultima volta": {
    en: "Last time"
  },
  "Dopo": {
    en: "Next"
  },
  "Auto-recupero": {
    en: "Auto-rest"
  },
  "Esci dal player": {
    en: "Exit player"
  },
  "Nessuno storico": {
    en: "No history"
  },
  "record": {
    en: "best"
  },
  "prova": {
    en: "try"
  },
  "Progressione: tocca per applicare": {
    en: "Progression: tap to apply"
  },
  "Nuovo record!": {
    en: "New PR!"
  },
  "nuovi record!": {
    en: "new PRs!"
  },
  "Nuova versione disponibile": {
    en: "New version available"
  },
  "Aggiorna": {
    en: "Update"
  },
  "Aggiornamento…": {
    en: "Refreshing…"
  },
  "Panca piana con bilanciere": {
    en: "Barbell bench press"
  },
  "Panca inclinata con manubri (30°)": {
    en: "Incline dumbbell press (30°)"
  },
  "Croci ai cavi bassi (chest fly)": {
    en: "Low cable chest fly"
  },
  "Dips alle parallele": {
    en: "Parallel bar dips"
  },
  "Lat machine presa larga (pull-down)": {
    en: "Wide-grip lat pulldown"
  },
  "Rematore con manubrio su panca (1 braccio)": {
    en: "One-arm dumbbell row on bench"
  },
  "Alzate laterali con manubri": {
    en: "Dumbbell lateral raises"
  },
  "Curl con bilanciere EZ": {
    en: "EZ-bar curl"
  },
  "Curl con manubri alternati (martello)": {
    en: "Alternating hammer curl"
  },
  "Squat con bilanciere (back squat)": {
    en: "Barbell back squat"
  },
  "Leg press 45°": {
    en: "45° leg press"
  },
  "Romanian Deadlift (RDL) con bilanciere": {
    en: "Barbell Romanian deadlift (RDL)"
  },
  "Affondi con manubri (camminata)": {
    en: "Walking dumbbell lunges"
  },
  "Leg curl sdraiato (macchina)": {
    en: "Lying leg curl (machine)"
  },
  "Calf raise in piedi (macchina o scalino)": {
    en: "Standing calf raise (machine or step)"
  },
  "Crunch inverso a terra": {
    en: "Reverse crunch"
  },
  "Plank isometrico": {
    en: "Isometric plank"
  },
  "Back extension (macchina o panca lombare)": {
    en: "Back extension (machine or bench)"
  },
  "Military press (bilanciere)": {
    en: "Barbell military press"
  },
  "Trazioni o Lat machine presa stretta": {
    en: "Pull-ups or close-grip pulldown"
  },
  "Rematore con bilanciere (pendlay row)": {
    en: "Barbell Pendlay row"
  },
  "Panca stretta (tricipiti)": {
    en: "Close-grip bench press"
  },
  "Face pull (cavo alto)": {
    en: "Face pull (high cable)"
  },
  "Skull crusher (EZ barra)": {
    en: "Skull crusher (EZ bar)"
  },
  "Curl con manubri alternati": {
    en: "Alternating dumbbell curl"
  },
  "Shrug con manubri o bilanciere": {
    en: "Dumbbell or barbell shrug"
  },
  "Panca piana bilanciere": {
    en: "Barbell bench press"
  },
  "Rematore manubrio": {
    en: "Dumbbell row"
  },
  "Lat machine presa larga": {
    en: "Wide lat pulldown"
  },
  "Curl bilanciere EZ": {
    en: "EZ-bar curl"
  },
  "Squat bilanciere": {
    en: "Barbell squat"
  },
  "Stacco rumeno": {
    en: "Romanian deadlift"
  },
  "Calf in piedi": {
    en: "Standing calf raise"
  },
  "Military press": {
    en: "Military press"
  },
  "Trazioni assistite": {
    en: "Assisted pull-ups"
  },
  "Panca manubri": {
    en: "Dumbbell bench"
  },
  "Dip zavorrati": {
    en: "Weighted dips"
  },
  "Push-up zavorrati": {
    en: "Weighted push-ups"
  },
  "Push-up con piedi rialzati": {
    en: "Feet-elevated push-ups"
  },
  "Push-up con piedi su sedia": {
    en: "Push-ups with feet on a chair"
  },
  "Push-up presa stretta": {
    en: "Close-grip push-ups"
  },
  "Croci con elastico": {
    en: "Band chest fly"
  },
  "Dips su sedia": {
    en: "Chair dips"
  },
  "Dips verticali": {
    en: "Upright dips"
  },
  "Pulley basso": {
    en: "Low pulley row"
  },
  "Chest-supported row": {
    en: "Chest-supported row"
  },
  "Rematore T-bar": {
    en: "T-bar row"
  },
  "Trazioni": {
    en: "Pull-ups"
  },
  "Inverted row su tavolo": {
    en: "Inverted row under a table"
  },
  "Row con zaino zavorrato": {
    en: "Weighted-backpack row"
  },
  "Elastico": {
    en: "Resistance band"
  },
  "Lat machine presa stretta": {
    en: "Close-grip pulldown"
  },
  "Pullover cavi": {
    en: "Cable pullover"
  },
  "Curl manubri alternato": {
    en: "Alternating DB curl"
  },
  "Hammer curl": {
    en: "Hammer curl"
  },
  "Curl cavo": {
    en: "Cable curl"
  },
  "Curl EZ": {
    en: "EZ curl"
  },
  "Curl con bottiglie": {
    en: "Curls with bottles"
  },
  "Curl neutrale con bottiglie": {
    en: "Neutral-grip curls with bottles"
  },
  "Hack squat": {
    en: "Hack squat"
  },
  "Front squat": {
    en: "Front squat"
  },
  "Leg press": {
    en: "Leg press"
  },
  "Good morning": {
    en: "Good morning"
  },
  "Leg curl": {
    en: "Leg curl"
  },
  "Leg curl con elastico": {
    en: "Band leg curl"
  },
  "Leg raise sdraiato": {
    en: "Lying leg raise"
  },
  "Stacco gambe tese manubri": {
    en: "DB stiff-leg deadlift"
  },
  "Stacco a una gamba corpo libero": {
    en: "Single-leg bodyweight deadlift"
  },
  "Squat con zaino zavorrato": {
    en: "Weighted-backpack squat"
  },
  "Bulgarian split squat": {
    en: "Bulgarian split squat"
  },
  "Squat sumo": {
    en: "Sumo squat"
  },
  "Wall sit": {
    en: "Wall sit"
  },
  "Affondi statici": {
    en: "Static lunges"
  },
  "Reverse lunge": {
    en: "Reverse lunge"
  },
  "Nordic curl": {
    en: "Nordic curl"
  },
  "Calf raise su scalino": {
    en: "Calf raise on a step"
  },
  "Calf seduto": {
    en: "Seated calf"
  },
  "Calf leg press": {
    en: "Leg-press calf"
  },
  "Lento manubri": {
    en: "DB shoulder press"
  },
  "Arnold press": {
    en: "Arnold press"
  },
  "Push press": {
    en: "Push press"
  },
  "Lat machine": {
    en: "Lat pulldown"
  },
  "Rematore": {
    en: "Row"
  },
  "Pulley alto": {
    en: "High pulley"
  },
  "Alzate laterali cavo": {
    en: "Cable lateral raises"
  },
  "Alzate posteriori manubri": {
    en: "Rear-delt dumbbell raises"
  },
  "Alzate con bottiglie d'acqua": {
    en: "Lateral raises with water bottles"
  },
  "Alzate con bottiglie": {
    en: "Raises with bottles"
  },
  "Push-down cavo": {
    en: "Cable push-down"
  },
  "petto": {
    en: "chest"
  },
  "schiena": {
    en: "back"
  },
  "spalle": {
    en: "shoulders"
  },
  "bicipiti": {
    en: "biceps"
  },
  "tricipiti": {
    en: "triceps"
  },
  "addome": {
    en: "abs"
  },
  "quadricipiti": {
    en: "quads"
  },
  "femorali": {
    en: "hams"
  },
  "polpacci": {
    en: "calves"
  },
  "glutei": {
    en: "glutes"
  },
  "trapezi": {
    en: "traps"
  },
  "Petto": {
    en: "Chest"
  },
  "Schiena": {
    en: "Back"
  },
  "Spalle": {
    en: "Shoulders"
  },
  "Gambe": {
    en: "Legs"
  },
  "Glutei": {
    en: "Glutes"
  },
  "Core": {
    en: "Core"
  },
  "Braccia": {
    en: "Arms"
  },
  "Bicipiti": {
    en: "Biceps"
  },
  "Tricipiti": {
    en: "Triceps"
  },
  "Piano alimentare": {
    en: "Meal plan"
  },
  "Attività di oggi": {
    en: "Today's activity"
  },
  "Allenamento:": {
    en: "Workout:"
  },
  "Allenamento pesi": {
    en: "Weight training"
  },
  "pesi": {
    en: "weights"
  },
  "Solo pesi": {
    en: "Weights only"
  },
  "Solo cardio": {
    en: "Cardio only"
  },
  "Pesi + cardio": {
    en: "Weights + cardio"
  },
  "Riposo": {
    en: "Rest"
  },
  "UPPER A · petto, schiena, bicipiti": {
    en: "UPPER A · chest, back, biceps"
  },
  "Orario sessione": {
    en: "Session time"
  },
  "Seleziona orario": {
    en: "Pick a time"
  },
  "Aggiungi corsa, bike, HIIT…": {
    en: "Add running, bike, HIIT…"
  },
  "Corsa, bike, ellittica, camminata…": {
    en: "Running, bike, elliptical, walking…"
  },
  "Mattina": {
    en: "Morning"
  },
  "Ore 17": {
    en: "5 PM"
  },
  "Ore 21": {
    en: "9 PM"
  },
  "Ore 22": {
    en: "10 PM"
  },
  "Integratori da assumere oggi": {
    en: "Supplements to take today"
  },
  "Integratori oggi": {
    en: "Supplements today"
  },
  "Tutti gli integratori assunti": {
    en: "All supplements taken"
  },
  "proteine": {
    en: "protein"
  },
  "carbo": {
    en: "carbs"
  },
  "grassi": {
    en: "fats"
  },
  "Colazione": {
    en: "Breakfast"
  },
  "Pranzo": {
    en: "Lunch"
  },
  "Cena": {
    en: "Dinner"
  },
  "Spuntino": {
    en: "Snack"
  },
  "Spuntino mattina": {
    en: "Morning snack"
  },
  "Merenda": {
    en: "Afternoon snack"
  },
  "Merenda ore 18": {
    en: "6 PM snack"
  },
  "Pre-allenamento": {
    en: "Pre-workout"
  },
  "Pranzo post-WO": {
    en: "Post-WO lunch"
  },
  "Post-WO (cena)": {
    en: "Post-WO (dinner)"
  },
  "Post-WO (cena leggera)": {
    en: "Post-WO (light dinner)"
  },
  "Pre-WO · spuntino": {
    en: "Pre-WO · snack"
  },
  "Pre-workout": {
    en: "Pre-workout"
  },
  "Post-workout": {
    en: "Post-workout"
  },
  "Pre-WO": {
    en: "Pre-WO"
  },
  "Post-WO": {
    en: "Post-WO"
  },
  "Nascondi": {
    en: "Hide"
  },
  "Altre opzioni": {
    en: "More options"
  },
  "Escludere sempre": {
    en: "Always exclude"
  },
  "Nessun pasto in questa configurazione": {
    en: "No meals in this configuration"
  },
  "Nessun pasto": {
    en: "No meals"
  },
  "Spesa completata": {
    en: "Shopping done"
  },
  "Hai preso tutto — ottimo!": {
    en: "You got everything — nice!"
  },
  "Orario della giornata": {
    en: "Time of day"
  },
  "Giornata completata": {
    en: "Day complete"
  },
  "Tutti i pasti completati per oggi!": {
    en: "All meals done for today!"
  },
  "Prima di": {
    en: "Before"
  },
  "Dopo": {
    en: "After"
  },
  "tra": {
    en: "in"
  },
  "Colazione (mattina)": {
    en: "Breakfast (morning)"
  },
  "Dopo pranzo": {
    en: "After lunch"
  },
  "Dopo merenda": {
    en: "After snack"
  },
  "Dopo merenda · entro 17:00": {
    en: "After snack · by 17:00"
  },
  "Dopocena": {
    en: "After dinner"
  },
  "Prima di dormire": {
    en: "Before bed"
  },
  "Pre-WO (45min prima)": {
    en: "Pre-WO (45min before)"
  },
  "Intra-WO (borraccia)": {
    en: "Intra-WO (bottle)"
  },
  "Pre-WO ore 16:15": {
    en: "Pre-WO at 16:15"
  },
  "Pre-WO ore 20:15": {
    en: "Pre-WO at 20:15"
  },
  "Pre-WO ore 21:15": {
    en: "Pre-WO at 21:15"
  },
  "Settimanale": {
    en: "Weekly"
  },
  "Reset": {
    en: "Reset"
  },
  "articoli": {
    en: "items"
  },
  "Carboidrati": {
    en: "Carbs"
  },
  "Verdura & Frutta": {
    en: "Veg & Fruit"
  },
  "Latticini": {
    en: "Dairy"
  },
  "Dispensa": {
    en: "Pantry"
  },
  "Altro": {
    en: "Other"
  },
  "Quante volte fai la spesa a settimana?": {
    en: "How many times do you shop per week?"
  },
  "1 volta": {
    en: "Once"
  },
  "2 volte": {
    en: "Twice"
  },
  "tutto in una botta": {
    en: "all in one trip"
  },
  "metà + metà settimana": {
    en: "half + half week"
  },
  "se esaurito": {
    en: "if out of stock"
  },
  "Le quantità mostrate sono per": {
    en: "Quantities shown are for"
  },
  "una singola uscita": {
    en: "a single trip"
  },
  "(metà settimana). Ripeti all'altra metà.": {
    en: "(half a week). Repeat for the other half."
  },
  "Online · Claude Haiku 4.5": {
    en: "Online · Claude Haiku 4.5"
  },
  "Groq · llama-3.3-70b-versatile": {
    en: "Groq · llama-3.3-70b-versatile"
  },
  "Connesso": {
    en: "Connected"
  },
  "messaggi": {
    en: "messages"
  },
  "Chiedi al coach…": {
    en: "Ask the coach…"
  },
  "Nuova chat": {
    en: "New chat"
  },
  "Sta scrivendo…": {
    en: "Typing…"
  },
  "Ciao Lorenzo! Oggi tocca": {
    en: "Hi Lorenzo! Today is"
  },
  "Sono pronto — chiedimi su scheda, dieta o recupero.": {
    en: "I'm ready — ask me about training, diet or recovery."
  },
  "Ciao Lorenzo! Oggi è un giorno di riposo. Parliamo di recupero, nutrizione o programmazione?": {
    en: "Hi Lorenzo! Today is a rest day. Shall we talk recovery, nutrition or programming?"
  },
  "Buongiorno Lorenzo. Oggi tocca UPPER A. Pronto? Chiedimi qualsiasi cosa su scheda, dieta o recupero.": {
    en: "Good morning Lorenzo. UPPER A today. Ready? Ask me anything about workout, diet or recovery."
  },
  "Connessione al modello non disponibile. Riprova tra poco.": {
    en: "Model connection unavailable. Try again shortly."
  },
  "API key Groq non configurata. Vai in Impostazioni → Coach per inserirla. È gratuita su console.groq.com": {
    en: "Groq API key not set. Go to Settings → Coach to add it. It's free at console.groq.com"
  },
  "Errore sconosciuto": {
    en: "Unknown error"
  },
  "Cosa mangio oggi?": {
    en: "What do I eat today?"
  },
  "Sostituisci esercizio": {
    en: "Swap exercise"
  },
  "Allenamento 45 min": {
    en: "45-min workout"
  },
  "Posso aumentare peso?": {
    en: "Can I add weight?"
  },
  "Posso aumentare il peso?": {
    en: "Can I add weight?"
  },
  "Riposo o cardio?": {
    en: "Rest or cardio?"
  },
  "Recupero ottimale": {
    en: "Optimal recovery"
  },
  "Pronto ad aiutarti": {
    en: "Ready to help"
  },
  "Non configurato": {
    en: "Not set up"
  },
  "Check-in ok": {
    en: "Check-in ok"
  },
  "Coach non configurato": {
    en: "Coach not set up"
  },
  "Serve una API key per parlare con l'allenatore AI. Configurala nel profilo per iniziare.": {
    en: "You need an API key to chat with the AI coach. Set it up in your profile to get started."
  },
  "Configura in Profilo": {
    en: "Set up in Profile"
  },
  "Volume": {
    en: "Volume"
  },
  "Serie per gruppo": {
    en: "Sets per muscle"
  },
  "ultimi 7 giorni": {
    en: "last 7 days"
  },
  "Nessun allenamento negli ultimi 7 giorni": {
    en: "No workouts in the last 7 days"
  },
  "Caricamento grafico…": {
    en: "Loading chart…"
  },
  "Nessun dato peso — aggiorna il peso dalla Dashboard": {
    en: "No weight data — log your weight from the Dashboard"
  },
  "Ancora nessun peso": {
    en: "No weight yet"
  },
  "misurazioni": {
    en: "measurements"
  },
  "da": {
    en: "since"
  },
  "Media sonno": {
    en: "Avg sleep"
  },
  "Media energia": {
    en: "Avg energy"
  },
  "Giorni log": {
    en: "Logged days"
  },
  "no data": {
    en: "no data"
  },
  "Nessun check-in disponibile": {
    en: "No check-ins available"
  },
  "Nessun check-in": {
    en: "No check-ins"
  },
  "Minuti": {
    en: "Minutes"
  },
  "km totali": {
    en: "total km"
  },
  "Check-in": {
    en: "Check-in"
  },
  "Trend peso corporeo": {
    en: "Body weight trend"
  },
  "Ultime misurazioni": {
    en: "Latest measurements"
  },
  "Attività recenti": {
    en: "Recent activities"
  },
  "Nessuna attività registrata": {
    en: "No activities logged"
  },
  "Nessuna attività": {
    en: "No activity"
  },
  "Vai alla Dashboard": {
    en: "Go to Dashboard"
  },
  "Ultimi 14 giorni": {
    en: "Last 14 days"
  },
  "Configurazione": {
    en: "Configuration"
  },
  "Modifica": {
    en: "Edit"
  },
  "Modifica profilo": {
    en: "Edit profile"
  },
  "Salva modifiche": {
    en: "Save changes"
  },
  "Salva": {
    en: "Save"
  },
  "Nome": {
    en: "Name"
  },
  "Altezza": {
    en: "Height"
  },
  "Altezza (cm)": {
    en: "Height (cm)"
  },
  "Età": {
    en: "Age"
  },
  "anni": {
    en: "years"
  },
  "Profilo": {
    en: "Profile"
  },
  "Piani": {
    en: "Plans"
  },
  "Sincronizzazione": {
    en: "Sync"
  },
  "Aspetto": {
    en: "Appearance"
  },
  "Tema": {
    en: "Theme"
  },
  "Lingua": {
    en: "Language"
  },
  "Italiano": {
    en: "Italian"
  },
  "English": {
    en: "English"
  },
  "Unità peso": {
    en: "Weight unit"
  },
  "Connessioni": {
    en: "Connections"
  },
  "API key e fonti dati": {
    en: "API keys & data sources"
  },
  "API key e sorgenti dati": {
    en: "API keys & data sources"
  },
  "API key Groq": {
    en: "Groq API key"
  },
  "Per AI Coach": {
    en: "For AI Coach"
  },
  "Coach AI · llama-3.3-70b-versatile": {
    en: "AI Coach · llama-3.3-70b-versatile"
  },
  "Sheets: pesi, sessioni, movimenti": {
    en: "Sheets: weights, sessions, activities"
  },
  "Sorgente scheda + dieta": {
    en: "Workout + diet source"
  },
  "Mostra": {
    en: "Show"
  },
  "Importa file": {
    en: "Import file"
  },
  "Importa": {
    en: "Import"
  },
  "Aggiorna": {
    en: "Update"
  },
  "Caricato": {
    en: "Loaded"
  },
  "Nessun file importato": {
    en: "No file imported"
  },
  "Importa scheda (.txt)": {
    en: "Import workout plan (.txt)"
  },
  "Importa dieta (.txt)": {
    en: "Import diet (.txt)"
  },
  "Esporta scheda (.txt)": {
    en: "Export workout plan (.txt)"
  },
  "Esporta dieta (.txt)": {
    en: "Export diet (.txt)"
  },
  "Il testo attuale — modificalo e reimportalo qui sopra": {
    en: "The current text — edit it and re-import it above"
  },
  "Esportato": {
    en: "Exported"
  },
  "Nessun testo da esportare": {
    en: "No text to export"
  },
  "Importato": {
    en: "Imported"
  },
  "Ultimo import": {
    en: "Last import"
  },
  "Formato non valido — dati attuali conservati": {
    en: "Invalid format — current data kept"
  },
  "Errore di lettura del file": {
    en: "Could not read the file"
  },
  "Ultime sessioni": {
    en: "Recent sessions"
  },
  "Aggiungi nota setup": {
    en: "Add setup note"
  },
  "Nota setup (macchina, sedile, presa…)": {
    en: "Setup note (machine, seat, grip…)"
  },
  "es. sedile 4, presa media…": {
    en: "e.g. seat 4, medium grip…"
  },
  "Scarico": {
    en: "Deload"
  },
  "Seduta scarica consigliata": {
    en: "Deload session recommended"
  },
  "Recupero incompleto — oggi meglio scaricare": {
    en: "Incomplete recovery — better to go lighter today"
  },
  "Sessione completata": {
    en: "Session complete"
  },
  "Tonnellaggio": {
    en: "Tonnage"
  },
  "vs precedente": {
    en: "vs previous"
  },
  "prima": {
    en: "before"
  },
  "Fatto": {
    en: "Done"
  },
  "La tua settimana": {
    en: "Your week"
  },
  "kg vs prec.": {
    en: "kg vs prev."
  },
  "record battuto": {
    en: "record beaten"
  },
  "record battuti": {
    en: "records beaten"
  },
  "Pasto fatto": {
    en: "Meal done"
  },
  "Equivalenti": {
    en: "Equivalents"
  },
  "Forza": {
    en: "Strength"
  },
  "Misure": {
    en: "Measures"
  },
  "Massimale stimato per esercizio": {
    en: "Estimated 1RM per exercise"
  },
  "e1RM = massimale stimato (formula di Epley). Tocca un esercizio per il trend.": {
    en: "e1RM = estimated one-rep max (Epley formula). Tap an exercise for its trend."
  },
  "Ancora nessun dato forza": {
    en: "No strength data yet"
  },
  "Chiudi qualche sessione con i pesi segnati per vedere l'e1RM stimato": {
    en: "Close a few sessions with logged weights to see your estimated e1RM"
  },
  "Serve più di una sessione per il trend": {
    en: "More than one session is needed for a trend"
  },
  "Grafico non disponibile": {
    en: "Chart unavailable"
  },
  "Misure corporee": {
    en: "Body measurements"
  },
  "Vita": {
    en: "Waist"
  },
  "Fianchi": {
    en: "Hips"
  },
  "Torace": {
    en: "Chest"
  },
  "Braccio": {
    en: "Arm"
  },
  "Coscia": {
    en: "Thigh"
  },
  "Misure salvate": {
    en: "Measurements saved"
  },
  "Aggiorna misure": {
    en: "Update measurements"
  },
  "Registra le prime misure": {
    en: "Log your first measurements"
  },
  "Salva misure": {
    en: "Save measurements"
  },
  "Ultime rilevazioni": {
    en: "Latest entries"
  },
  "Registro": {
    en: "Log"
  },
  "Registro sessioni": {
    en: "Session log"
  },
  "Nessuna sessione registrata": {
    en: "No sessions logged"
  },
  "Chiudi una sessione dalla Scheda per vederla qui": {
    en: "Close a session from the Workout tab to see it here"
  },
  "Solo dati locali — aggiorna il backend per lo storico completo": {
    en: "Local data only — update the backend for the full history"
  },
  "Media 7 giorni": {
    en: "7-day average"
  },
  "Obiettivo": {
    en: "Goal"
  },
  "Ritmo attuale": {
    en: "Current pace"
  },
  "kg/sett": {
    en: "kg/wk"
  },
  "a questo ritmo arrivi a": {
    en: "at this pace you'll reach"
  },
  "Obiettivo raggiunto 🎉": {
    en: "Goal reached 🎉"
  },
  "il trend attuale si allontana dall'obiettivo": {
    en: "the current trend is moving away from the goal"
  },
  "Sessione salvata — sync quando torni online": {
    en: "Session saved — will sync when you're back online"
  },
  "Condividi": {
    en: "Share"
  },
  "Extra": {
    en: "Extra"
  },
  "Aggiungi articolo…": {
    en: "Add item…"
  },
  "Aggiungi": {
    en: "Add"
  },
  "Rimuovi": {
    en: "Remove"
  },
  "Backup": {
    en: "Backup"
  },
  "I dati per-giorno vivono solo su questo device": {
    en: "Per-day data lives only on this device"
  },
  "Esporta backup (.json)": {
    en: "Export backup (.json)"
  },
  "Tutto lo storage locale, chiave Groq inclusa": {
    en: "All local storage, Groq key included"
  },
  "Ripristina backup": {
    en: "Restore backup"
  },
  "Sovrascrive i dati locali col file": {
    en: "Overwrites local data with the file"
  },
  "Backup esportato": {
    en: "Backup exported"
  },
  "Export fallito": {
    en: "Export failed"
  },
  "chiavi": {
    en: "keys"
  },
  "File non valido — dati attuali conservati": {
    en: "Invalid file — current data kept"
  },
  "Ripristinare il backup? I dati locali attuali verranno sovrascritti.": {
    en: "Restore this backup? Current local data will be overwritten."
  },
  "Backup ripristinato": {
    en: "Backup restored"
  },
  "Diagnostica": {
    en: "Diagnostics"
  },
  "Log errori": {
    en: "Error log"
  },
  "errore registrato": {
    en: "logged error"
  },
  "errori registrati": {
    en: "logged errors"
  },
  "Nessun errore registrato 🎉": {
    en: "No errors logged 🎉"
  },
  "Copia tutto": {
    en: "Copy all"
  },
  "Copiato": {
    en: "Copied"
  },
  "Svuota": {
    en: "Clear"
  },
  "giorni": {
    en: "days"
  },
  "sezioni": {
    en: "sections"
  },
  "pasti": {
    en: "meals"
  },
  "File di testo": {
    en: "Text files"
  },
  "Importa scheda.txt e dieta.txt": {
    en: "Import scheda.txt and dieta.txt"
  },
  "Cibi esclusi": {
    en: "Excluded foods"
  },
  "Sempre": {
    en: "Always"
  },
  "Configurato": {
    en: "Set"
  },
  "Mancante": {
    en: "Missing"
  },
  "Testa connessione": {
    en: "Test connection"
  },
  "righe": {
    en: "rows"
  },
  "Errore": {
    en: "Error"
  },
  "Inserisci…": {
    en: "Enter…"
  },
  "Dati personali": {
    en: "Personal data"
  },
  "Aggiorna peso": {
    en: "Log weight"
  },
  "Aggiorna peso odierno": {
    en: "Update today's weight"
  },
  "Ultimo: oggi alle 08:12": {
    en: "Last: today at 08:12"
  },
  "Notifiche": {
    en: "Notifications"
  },
  "Promemoria allenamento": {
    en: "Workout reminder"
  },
  "30 minuti prima": {
    en: "30 minutes before"
  },
  "Orari pasti": {
    en: "Meal times"
  },
  "Powerbuilding": {
    en: "Powerbuilding"
  },
  "Hypertrophy": {
    en: "Hypertrophy"
  },
  "Strength": {
    en: "Strength"
  },
  "Cut": {
    en: "Cut"
  },
  "Lean bulk": {
    en: "Lean bulk"
  },
  "Peso, cardio e check-in": {
    en: "Weight, cardio and check-ins"
  },
  "Sincronizzazione & Dati": {
    en: "Sync & Data"
  },
  "Sincronizza ora": {
    en: "Sync now"
  },
  "Sincronizzato": {
    en: "Synced"
  },
  "Sincronizzazione…": {
    en: "Syncing…"
  },
  "Sync": {
    en: "Sync"
  },
  "Sync non riuscito": {
    en: "Sync failed"
  },
  "Offline": {
    en: "Offline"
  },
  "Stato sincronizzazione": {
    en: "Sync status"
  },
  "Ultimo sync": {
    en: "Last sync"
  },
  "In attesa del primo sync": {
    en: "Waiting for first sync"
  },
  "Cloud: Google Sheets via proxy": {
    en: "Cloud: Google Sheets via proxy"
  },
  "Pusha tutti i dati locali al cloud": {
    en: "Push all local data to the cloud"
  },
  "Dati locali": {
    en: "Local data"
  },
  "Tutti i dati sono sul dispositivo": {
    en: "All data stays on this device"
  },
  "Solo locale": {
    en: "Local only"
  },
  "Reset completo": {
    en: "Full reset"
  },
  "Elimina tutti i dati e ricomincia": {
    en: "Delete all data and start over"
  },
  "Resetta tutto": {
    en: "Reset everything"
  },
  "Tutti i dati verranno eliminati: check-in, storico pesi, attività, impostazioni e file importati. Questa operazione non è reversibile.": {
    en: "All data will be deleted: check-ins, weight history, activities, settings and imported files. This cannot be undone."
  },
  "Sorgente": {
    en: "Source"
  },
  "Collega il tuo Sheets": {
    en: "Connect your Sheets"
  },
  "Collega Google Sheets": {
    en: "Connect Google Sheets"
  },
  "L'URL del foglio Google con scheda e dieta.": {
    en: "Google Sheet URL with workout & diet."
  },
  "Incolla l'URL del tuo Google Apps Script (doGet/doPost). Configuri il foglio in Impostazioni.": {
    en: "Paste your Google Apps Script URL (doGet/doPost). You can configure the sheet in Settings."
  },
  "Per attivare il coach AI in chat.": {
    en: "To enable the AI coach in chat."
  },
  "Per attivare l'AI Coach. Ottienila su console.groq.com — gratuita.": {
    en: "To enable the AI Coach. Get it at console.groq.com — it's free."
  },
  "Profilo": {
    en: "Profile"
  },
  "Il tuo peso attuale": {
    en: "Your current weight"
  },
  "Inizia a tracciare il trend da oggi.": {
    en: "Start tracking the trend from today."
  },
  "Step": {
    en: "Step"
  },
  "Indietro": {
    en: "Back"
  },
  "Continua": {
    en: "Continue"
  },
  "Iniziamo": {
    en: "Let's go"
  },
  "Le credenziali sono cifrate e salvate solo sul tuo dispositivo.": {
    en: "Credentials are encrypted and stored only on your device."
  },
  "Ieri": {
    en: "Yesterday"
  },
  "Sab": {
    en: "Sat"
  },
  "Mer scorso": {
    en: "Last Wed"
  },
  "Z2 facile": {
    en: "Easy Z2"
  },
  "Con Luna": {
    en: "With Luna"
  },
  "lunedì": {
    en: "monday"
  },
  "Lunedì": {
    en: "Monday"
  },
  "Promemoria": {
    en: "Reminders"
  },
  "Attiva notifiche": {
    en: "Enable notifications"
  },
  "Notifiche attive": {
    en: "Notifications on"
  },
  "Allenamento spostato al": {
    en: "Workout moved to"
  },
  "Quel giorno non ha allenamento da spostare": {
    en: "That day has no workout to move"
  },
  "Le notifiche richiedono l'app installata sulla Home": {
    en: "Notifications require the app installed to the Home Screen"
  },
  "Notifiche non supportate su questo dispositivo": {
    en: "Notifications not supported on this device"
  },
  "Permesso negato — riattiva da Impostazioni iOS": {
    en: "Permission denied — re-enable in iOS Settings"
  },
  "Configurazione push mancante": {
    en: "Push configuration missing"
  },
  "Errore attivazione notifiche": {
    en: "Failed to enable notifications"
  },
  "Orari per giorno": {
    en: "Times by day"
  },
  "Sposta allenamento": {
    en: "Move workout"
  },
  "Giorno prima": {
    en: "Day before"
  },
  "Giorno dopo": {
    en: "Day after"
  },
  "Rigenera orari dal piano": {
    en: "Regenerate times from plan"
  },
  "Pasti": {
    en: "Meals"
  }
};
const LangContext = React.createContext({
  lang: "it",
  setLang: () => {}
});
function useT() {
  const {
    lang
  } = React.useContext(LangContext);
  return React.useCallback(key => {
    if (lang === "it") return key;
    const entry = I18N_DICT[key];
    return entry && entry[lang] || key;
  }, [lang]);
}
function useLang() {
  return React.useContext(LangContext);
}
window.LangContext = LangContext;
window.useT = useT;
window.useLang = useLang;
window.I18N_DICT = I18N_DICT;
})();

// ══ icons.jsx ══
;(function () {
const Icon = ({
  name,
  size = 20,
  color = "currentColor",
  strokeWidth = 1.6,
  style
}) => {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style
  };
  switch (name) {
    case "home":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"
      }));
    case "dumbbell":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M3 9v6M6 7v10M9 9.5h6M15 7v10M18 9v6"
      }));
    case "fork":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M8 3v8a2 2 0 0 0 2 2v8M6 3v6M10 3v6M16 3c-1.5 0-3 1.7-3 5s1.5 5 3 5v8"
      }));
    case "cart":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M3 5h2l2.4 10.4a1.5 1.5 0 0 0 1.5 1.1H18a1.5 1.5 0 0 0 1.5-1.2L21 8H6"
      }), React.createElement("circle", {
        cx: "9",
        cy: "20",
        r: "1.3"
      }), React.createElement("circle", {
        cx: "17",
        cy: "20",
        r: "1.3"
      }));
    case "spark":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
      }), React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "2.5"
      }));
    case "gear":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "3"
      }), React.createElement("path", {
        d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      }));
    case "clock":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), React.createElement("path", {
        d: "M12 7v5l3 2"
      }));
    case "refresh":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M3 21v-5h5M21 3v5h-5"
      }));
    case "chevron":
      return React.createElement("svg", common, React.createElement("path", {
        d: "m9 6 6 6-6 6"
      }));
    case "chevron-down":
      return React.createElement("svg", common, React.createElement("path", {
        d: "m6 9 6 6 6-6"
      }));
    case "check":
      return React.createElement("svg", {
        ...common,
        strokeWidth: "2.5"
      }, React.createElement("path", {
        d: "M5 12.5 10 17 19 7.5"
      }));
    case "plus":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M12 5v14M5 12h14"
      }));
    case "minus":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M5 12h14"
      }));
    case "upload":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M12 16V4M7 9l5-5 5 5M4 20h16"
      }));
    case "lock":
      return React.createElement("svg", common, React.createElement("rect", {
        x: "5",
        y: "11",
        width: "14",
        height: "10",
        rx: "2"
      }), React.createElement("path", {
        d: "M8 11V8a4 4 0 1 1 8 0v3"
      }));
    case "eye":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
      }), React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "3"
      }));
    case "eye-off":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M10.6 6.1A9 9 0 0 1 12 6c6.5 0 10 6 10 6a13 13 0 0 1-2.2 2.7M6.6 6.6A13 13 0 0 0 2 12s3.5 7 10 7a9 9 0 0 0 3.5-.7M3 3l18 18"
      }), React.createElement("path", {
        d: "M9.9 9.9a3 3 0 0 0 4.2 4.2"
      }));
    case "bolt":
      return React.createElement("svg", {
        ...common,
        fill: "currentColor",
        stroke: "none"
      }, React.createElement("path", {
        d: "M13 2 4 14h6l-1 8 9-12h-6z"
      }));
    case "scale":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M4 6h16l-2 14H6L4 6Z"
      }), React.createElement("path", {
        d: "M8 6V4a4 4 0 0 1 8 0v2"
      }));
    case "flame":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M12 21c-3.9 0-7-2.7-7-6.4 0-2 .9-3.5 2-4.6 1.2-1.2 1.7-2 1.7-3.3V4c2 .5 3.3 2 3.8 3.7.7 2.2 2.5 1.6 3.7 3.6.9 1.4 1.8 3.4 1.8 5 0 3-2.6 4.7-6 4.7Z"
      }));
    case "leaf":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M4 20c0-8 6-14 17-14-1 11-7 17-14 17 0-3 2-5 5-7"
      }));
    case "pill":
      return React.createElement("svg", common, React.createElement("rect", {
        x: "3",
        y: "9",
        width: "18",
        height: "6",
        rx: "3",
        transform: "rotate(-30 12 12)"
      }), React.createElement("path", {
        d: "m8.5 6.5 6 6",
        transform: "rotate(-30 12 12)"
      }));
    case "send":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
      }));
    case "robot":
      return React.createElement("svg", common, React.createElement("rect", {
        x: "4",
        y: "8",
        width: "16",
        height: "11",
        rx: "3"
      }), React.createElement("path", {
        d: "M12 8V4M9 4h6"
      }), React.createElement("circle", {
        cx: "9",
        cy: "13",
        r: "1",
        fill: "currentColor"
      }), React.createElement("circle", {
        cx: "15",
        cy: "13",
        r: "1",
        fill: "currentColor"
      }), React.createElement("path", {
        d: "M9 17h6"
      }));
    case "online":
      return React.createElement("svg", {
        viewBox: "0 0 24 24",
        width: size,
        height: size
      }, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "5",
        fill: "#30D158"
      }));
    case "x":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M6 6l12 12M18 6 6 18"
      }));
    case "wave":
      return React.createElement("svg", {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        fill: "none"
      }, React.createElement("path", {
        d: "M5 12c2-3 4-3 6 0s4 3 6 0M5 17c2-3 4-3 6 0s4 3 6 0M5 7c2-3 4-3 6 0s4 3 6 0",
        stroke: "currentColor",
        strokeWidth: "1.6",
        strokeLinecap: "round"
      }));
    case "calendar":
      return React.createElement("svg", common, React.createElement("rect", {
        x: "3",
        y: "5",
        width: "18",
        height: "16",
        rx: "2"
      }), React.createElement("path", {
        d: "M3 9h18M8 3v4M16 3v4"
      }));
    case "key":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "8",
        cy: "15",
        r: "4"
      }), React.createElement("path", {
        d: "m11 12 9-9M16 7l3 3"
      }));
    case "moon":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"
      }));
    case "sun":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "4"
      }), React.createElement("path", {
        d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      }));
    case "globe":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), React.createElement("path", {
        d: "M3 12h18M12 3c3 3.5 3 14.5 0 18-3-3.5-3-14.5 0-18Z"
      }));
    case "user":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "12",
        cy: "9",
        r: "4"
      }), React.createElement("path", {
        d: "M4 20a8 8 0 0 1 16 0"
      }));
    case "info":
      return React.createElement("svg", common, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "9"
      }), React.createElement("path", {
        d: "M12 8h.01M11 12h1v5h1"
      }));
    case "trend-up":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M3 17 9 11l4 4 8-9M14 6h7v7"
      }));
    case "cloud":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"
      }));
    case "cloud-off":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3M1 1l22 22"
      }));
    case "doc":
      return React.createElement("svg", common, React.createElement("path", {
        d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"
      }), React.createElement("path", {
        d: "M14 3v6h6M9 14h6M9 17h4"
      }));
    default:
      return null;
  }
};
window.Icon = Icon;
})();

// ══ ui.jsx ══
;(function () {
const UIAvatarLF = ({
  size = 34,
  onClick
}) => React.createElement("button", {
  onClick: onClick,
  "aria-label": "Profilo",
  style: {
    width: size,
    height: size,
    minWidth: 44,
    minHeight: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: 0,
    padding: 0,
    cursor: "pointer"
  }
}, React.createElement("span", {
  style: {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.29),
    background: "var(--brand-grad)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: Math.round(size * 0.44),
    letterSpacing: "-0.03em",
    color: "#fff"
  }
}, "LF"));
const UIHeader = ({
  eyebrow,
  title,
  right,
  onProfile
}) => React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 10,
    padding: "4px 4px 0"
  }
}, React.createElement("div", {
  style: {
    minWidth: 0
  }
}, eyebrow ? React.createElement("div", {
  className: "ui-cap",
  style: {
    marginBottom: 2
  }
}, eyebrow) : null, React.createElement("div", {
  style: {
    fontFamily: "var(--display)",
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  }
}, title)), right != null ? right : onProfile ? React.createElement(UIAvatarLF, {
  onClick: onProfile
}) : null);
const UICard = ({
  hero,
  style,
  onClick,
  children
}) => React.createElement("div", {
  className: "ui-card" + (hero ? " ui-card--hero" : "") + (onClick ? " pressable" : ""),
  onClick: onClick,
  style: onClick ? Object.assign({
    cursor: "pointer"
  }, style) : style
}, children);
const UIRow = ({
  icon,
  title,
  sub,
  value,
  chevron,
  onClick,
  children
}) => React.createElement("div", {
  onClick: onClick,
  className: onClick ? "pressable" : undefined,
  style: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    padding: "4px 0",
    cursor: onClick ? "pointer" : "default"
  }
}, icon ? React.createElement("span", {
  style: {
    width: 30,
    height: 30,
    borderRadius: 9,
    flexShrink: 0,
    background: "var(--card-2)",
    border: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-2)"
  }
}, React.createElement(Icon, {
  name: icon,
  size: 15,
  strokeWidth: 1.8
})) : null, React.createElement("span", {
  style: {
    flex: 1,
    minWidth: 0
  }
}, React.createElement("span", {
  style: {
    display: "block",
    fontSize: 14,
    fontWeight: 600
  }
}, title), sub ? React.createElement("span", {
  style: {
    display: "block",
    fontSize: 12,
    color: "var(--text-2)"
  }
}, sub) : null), children, value != null ? React.createElement("span", {
  className: "tnum",
  style: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-2)"
  }
}, value) : null, chevron ? React.createElement("span", {
  style: {
    color: "var(--text-3)",
    fontSize: 16,
    fontWeight: 600
  }
}, "›") : null);
const UISegmented = ({
  options,
  value,
  onChange,
  mini
}) => React.createElement("div", {
  style: {
    display: "flex",
    gap: 3,
    padding: 3,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 11,
    flex: mini ? "0 0 auto" : 1
  }
}, options.map(op => {
  const on = op.id === value;
  return React.createElement("button", {
    key: op.id,
    onClick: () => onChange(op.id),
    style: {
      flex: mini ? "0 0 auto" : 1,
      minHeight: mini ? 30 : 38,
      padding: mini ? "4px 10px" : "7px 8px",
      textAlign: "center",
      fontSize: mini ? 11.5 : 12.5,
      fontWeight: 600,
      color: on ? "#fff" : "var(--text-2)",
      background: on ? "var(--brand-grad)" : "transparent",
      border: 0,
      borderRadius: 8,
      cursor: "pointer",
      transition: "color 0.15s"
    }
  }, op.label);
}));
const UIChip = ({
  active,
  onClick,
  children
}) => React.createElement("span", {
  onClick: onClick,
  style: {
    fontSize: 11,
    fontWeight: 500,
    color: active ? "#fff" : "var(--text-2)",
    background: active ? "var(--brand-grad)" : "var(--card-2)",
    border: "1px solid " + (active ? "transparent" : "var(--border)"),
    borderRadius: 999,
    padding: "3px 9px",
    cursor: onClick ? "pointer" : "default",
    whiteSpace: "nowrap"
  }
}, children);
const UIProgress = ({
  value,
  height = 4
}) => React.createElement("div", {
  style: {
    height,
    borderRadius: 999,
    background: "var(--track)",
    overflow: "hidden"
  }
}, React.createElement("div", {
  style: {
    height: "100%",
    borderRadius: 999,
    width: Math.max(0, Math.min(1, value || 0)) * 100 + "%",
    background: "var(--brand-grad)",
    transition: "width 0.25s"
  }
}));
const UIButton = ({
  variant = "primary",
  disabled,
  onClick,
  style,
  children
}) => React.createElement("button", {
  onClick: disabled ? undefined : onClick,
  disabled: disabled,
  className: "pressable",
  style: Object.assign({
    minHeight: 44,
    borderRadius: 12,
    border: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: "0 16px",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: variant === "primary" ? "var(--brand-grad)" : "var(--card-2)",
    color: variant === "primary" ? "#fff" : "var(--text)",
    ...(variant === "quiet" ? {
      border: "1px solid var(--border)"
    } : {})
  }, style)
}, children);
const UIStatTile = ({
  cap,
  value,
  unit,
  onClick,
  children
}) => React.createElement(UICard, {
  onClick: onClick,
  style: {
    flex: 1,
    minWidth: 0
  }
}, React.createElement("div", {
  className: "ui-cap",
  style: {
    marginBottom: 4
  }
}, cap), React.createElement("div", {
  className: "tnum",
  style: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em"
  }
}, value, unit ? React.createElement("span", {
  style: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-2)",
    marginLeft: 3
  }
}, unit) : null), children);
const UISheet = ({
  open,
  onClose,
  title,
  children
}) => {
  if (!open) return null;
  return React.createElement("div", {
    className: "ui-sheet-backdrop",
    onClick: onClose
  }, React.createElement("div", {
    className: "ui-sheet",
    onClick: e => e.stopPropagation()
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12
    }
  }, React.createElement("span", {
    style: {
      fontSize: 17,
      fontWeight: 650,
      letterSpacing: "-0.01em"
    }
  }, title), React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      minWidth: 44,
      minHeight: 44,
      border: 0,
      background: "transparent",
      color: "var(--text-2)",
      fontSize: 17,
      cursor: "pointer"
    }
  }, "✕")), children));
};
const UIEmpty = ({
  icon = "spark",
  title,
  sub,
  action,
  style
}) => React.createElement("div", {
  style: Object.assign({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "36px 28px",
    textAlign: "center"
  }, style)
}, React.createElement("span", {
  style: {
    width: 58,
    height: 58,
    borderRadius: 18,
    background: "var(--card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-1), inset 0 1px 0 var(--hair-top)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-2)"
  }
}, React.createElement(Icon, {
  name: icon,
  size: 26,
  strokeWidth: 1.7
})), React.createElement("span", {
  style: {
    fontSize: 16,
    fontWeight: 650,
    letterSpacing: "-0.01em"
  }
}, title), sub ? React.createElement("span", {
  className: "muted",
  style: {
    fontSize: 13,
    maxWidth: 260,
    lineHeight: 1.5
  }
}, sub) : null, action || null);
const UISkeleton = ({
  h = 14,
  w = "100%",
  r = 8,
  style
}) => React.createElement("span", {
  className: "skeleton",
  style: Object.assign({
    display: "block",
    height: h,
    width: w,
    borderRadius: r
  }, style)
});
const UIAnimatedNumber = ({
  value,
  decimals = 1
}) => {
  const ref = React.useRef(null);
  const prev = React.useRef(value);
  React.useEffect(() => {
    if (prev.current !== value && ref.current && window.Motion) {
      window.Motion.countTo(ref.current, prev.current, value, {
        decimals
      });
    }
    prev.current = value;
  }, [value, decimals]);
  return React.createElement("span", {
    ref: ref,
    className: "tnum"
  }, Number(value).toFixed(decimals));
};
window.UIAvatarLF = UIAvatarLF;
window.UIHeader = UIHeader;
window.UICard = UICard;
window.UIRow = UIRow;
window.UISegmented = UISegmented;
window.UIChip = UIChip;
window.UIProgress = UIProgress;
window.UIButton = UIButton;
window.UIStatTile = UIStatTile;
window.UISheet = UISheet;
window.UIEmpty = UIEmpty;
window.UISkeleton = UISkeleton;
window.UIAnimatedNumber = UIAnimatedNumber;
window.ensureRecharts = (() => {
  let promise = null;
  const inject = src => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script non raggiungibile: " + src));
    document.head.appendChild(s);
  });
  return function ensureRecharts() {
    if (window.Recharts) return Promise.resolve(window.Recharts);
    if (promise) return promise;
    promise = inject("vendor/prop-types.min.js").then(() => inject("vendor/Recharts.js")).then(() => window.Recharts).catch(e => {
      promise = null;
      throw e;
    });
    return promise;
  };
})();
})();

// ══ motion.jsx ══
;(function () {
const Motion = (() => {
  const reduced = () => {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  };
  const g = () => typeof window.gsap !== "undefined" && window.gsap ? window.gsap : null;
  return {
    enabled() {
      return !!g() && !reduced();
    },
    screenEnter(container) {
      const gsap = g();
      if (!gsap || reduced() || !container) return;
      let items = Array.prototype.slice.call(container.querySelectorAll("[data-reveal]"));
      if (!items.length && container.firstElementChild) {
        items = Array.prototype.slice.call(container.firstElementChild.children);
      }
      items = items.slice(0, 12);
      if (!items.length) return;
      gsap.fromTo(items, {
        y: 12,
        opacity: 0
      }, {
        y: 0,
        opacity: 1,
        duration: 0.4,
        ease: "power3.out",
        stagger: 0.04,
        overwrite: "auto",
        clearProps: "transform,opacity"
      });
    },
    pop(el) {
      const gsap = g();
      if (!gsap || reduced() || !el) return;
      gsap.fromTo(el, {
        scale: 0.6
      }, {
        scale: 1,
        duration: 0.45,
        ease: "back.out(2.5)",
        overwrite: "auto",
        clearProps: "transform"
      });
    },
    countTo(el, from, to, opts) {
      if (!el) return;
      opts = opts || {};
      const dec = opts.decimals != null ? opts.decimals : 0;
      const fmt = opts.format || (v => Number(v).toFixed(dec));
      const gsap = g();
      if (!gsap || reduced()) {
        el.textContent = fmt(to);
        return;
      }
      const state = {
        v: from
      };
      gsap.to(state, {
        v: to,
        duration: opts.duration || 0.6,
        ease: "power2.out",
        overwrite: "auto",
        onUpdate: () => {
          el.textContent = fmt(state.v);
        }
      });
    }
  };
})();
window.Motion = Motion;
})();

// ══ anatomy.jsx ══
;(function () {
const MUSCLES = {
  petto: {
    label: "Petto",
    kind: "front"
  },
  spalle: {
    label: "Spalle",
    kind: "front"
  },
  bicipiti: {
    label: "Bicipiti",
    kind: "front"
  },
  addome: {
    label: "Addome",
    kind: "front"
  },
  quadricipiti: {
    label: "Quadricipiti",
    kind: "front"
  },
  schiena: {
    label: "Schiena",
    kind: "back"
  },
  tricipiti: {
    label: "Tricipiti",
    kind: "back"
  },
  femorali: {
    label: "Femorali",
    kind: "back"
  },
  polpacci: {
    label: "Polpacci",
    kind: "back"
  },
  glutei: {
    label: "Glutei",
    kind: "back"
  },
  trapezi: {
    label: "Trapezi",
    kind: "back"
  }
};
const FRONT_PATHS = {
  petto: "M50 50 C 56 50 62 52 64 58 C 66 64 64 70 60 73 C 56 74 52 74 50 73 C 48 74 44 74 40 73 C 36 70 34 64 36 58 C 38 52 44 50 50 50 Z",
  spalle: "M32 47 C 28 47 24 51 24 56 C 24 61 28 63 32 62 C 36 60 38 56 38 52 Z M68 47 C 72 47 76 51 76 56 C 76 61 72 63 68 62 C 64 60 62 56 62 52 Z",
  bicipiti: "M24 58 C 21 58 19 62 19 70 C 18 78 19 84 22 84 C 25 84 27 80 27 74 C 27 68 26 62 24 58 Z M76 58 C 79 58 81 62 81 70 C 82 78 81 84 78 84 C 75 84 73 80 73 74 C 73 68 74 62 76 58 Z",
  addome: "M42 74 L 58 74 L 58 110 C 58 113 55 115 50 115 C 45 115 42 113 42 110 Z",
  quadricipiti: "M40 118 C 36 118 33 122 33 130 L 35 165 C 36 170 40 172 44 170 L 47 130 C 47 122 44 118 40 118 Z M60 118 C 64 118 67 122 67 130 L 65 165 C 64 170 60 172 56 170 L 53 130 C 53 122 56 118 60 118 Z"
};
const BACK_PATHS = {
  trapezi: "M50 42 C 44 44 38 48 36 54 C 40 56 46 57 50 57 C 54 57 60 56 64 54 C 62 48 56 44 50 42 Z",
  schiena: "M38 58 C 36 64 36 76 38 92 C 42 100 50 102 50 102 C 50 102 58 100 62 92 C 64 76 64 64 62 58 C 58 60 54 60 50 60 C 46 60 42 60 38 58 Z",
  tricipiti: "M24 58 C 21 58 19 62 19 70 C 18 78 19 84 22 84 C 25 84 27 80 27 74 C 27 68 26 62 24 58 Z M76 58 C 79 58 81 62 81 70 C 82 78 81 84 78 84 C 75 84 73 80 73 74 C 73 68 74 62 76 58 Z",
  glutei: "M38 104 C 36 110 36 116 42 120 C 46 121 50 121 50 121 C 50 121 54 121 58 120 C 64 116 64 110 62 104 C 58 106 54 106 50 106 C 46 106 42 106 38 104 Z",
  femorali: "M40 124 C 36 124 33 128 33 136 L 35 165 C 36 170 40 172 44 170 L 47 136 C 47 128 44 124 40 124 Z M60 124 C 64 124 67 128 67 136 L 65 165 C 64 170 60 172 56 170 L 53 136 C 53 128 56 124 60 124 Z",
  polpacci: "M40 175 C 37 175 35 180 36 190 L 38 205 C 40 207 43 207 44 205 L 45 188 C 45 180 43 175 40 175 Z M60 175 C 63 175 65 180 64 190 L 62 205 C 60 207 57 207 56 205 L 55 188 C 55 180 57 175 60 175 Z"
};
const BodyOutline = ({
  view = "front"
}) => React.createElement("g", null, React.createElement("ellipse", {
  cx: "50",
  cy: "20",
  rx: "11",
  ry: "13"
}), React.createElement("path", {
  d: "M44 31 L44 38 C 44 40 56 40 56 38 L 56 31 Z"
}), view === "front" ? React.createElement("path", {
  d: "M30 44 C 32 42 38 40 50 40 C 62 40 68 42 70 44 L 78 56 C 82 68 82 80 80 86 C 78 88 76 86 75 82 L 68 74 L 68 110 C 68 116 66 122 67 130 L 70 170 C 71 180 70 188 68 195 L 62 210 C 60 212 56 212 55 208 L 54 175 L 52 130 L 50 128 L 48 130 L 46 175 L 45 208 C 44 212 40 212 38 210 L 32 195 C 30 188 29 180 30 170 L 33 130 C 34 122 32 116 32 110 L 32 74 L 25 82 C 24 86 22 88 20 86 C 18 80 18 68 22 56 Z"
}) : React.createElement("path", {
  d: "M30 44 C 32 42 38 40 50 40 C 62 40 68 42 70 44 L 78 56 C 82 68 82 80 80 86 C 78 88 76 86 75 82 L 68 74 L 68 110 C 68 116 66 122 67 130 L 70 170 C 71 180 70 188 68 195 L 62 210 C 60 212 56 212 55 208 L 54 175 L 52 130 L 50 128 L 48 130 L 46 175 L 45 208 C 44 212 40 212 38 210 L 32 195 C 30 188 29 180 30 170 L 33 130 C 34 122 32 116 32 110 L 32 74 L 25 82 C 24 86 22 88 20 86 C 18 80 18 68 22 56 Z"
}));
const MusclePaths = ({
  view,
  active,
  color
}) => {
  const paths = view === "front" ? FRONT_PATHS : BACK_PATHS;
  return React.createElement("g", null, Object.entries(paths).map(([key, d]) => {
    const isActive = active.includes(key);
    return React.createElement("path", {
      key: key,
      d: d,
      fill: isActive ? color : "transparent",
      stroke: isActive ? color : "none",
      strokeOpacity: isActive ? 0.6 : 0,
      strokeWidth: "0.6",
      style: {
        transition: "fill 0.3s, stroke-opacity 0.3s"
      }
    });
  }));
};
const Anatomy = ({
  active = [],
  view = "both",
  height = 260,
  color = "var(--accent)"
}) => {
  const showBoth = view === "both";
  const w = showBoth ? 220 : 110;
  return React.createElement("svg", {
    viewBox: `0 0 ${w} 220`,
    width: Math.round(height * w / 220),
    height: height,
    style: {
      display: "block"
    }
  }, React.createElement("g", {
    stroke: "rgba(255,255,255,0.16)",
    strokeWidth: "0.6",
    fill: "rgba(255,255,255,0.04)"
  }, (view === "front" || showBoth) && React.createElement("g", null, React.createElement(BodyOutline, {
    view: "front"
  }), React.createElement(MusclePaths, {
    view: "front",
    active: active,
    color: color
  })), (view === "back" || showBoth) && React.createElement("g", {
    transform: showBoth ? "translate(110 0)" : ""
  }, React.createElement(BodyOutline, {
    view: "back"
  }), React.createElement(MusclePaths, {
    view: "back",
    active: active,
    color: color
  }))), showBoth && React.createElement("g", {
    fill: "rgba(142,142,147,0.65)",
    fontFamily: "var(--display)",
    fontSize: "7",
    fontWeight: "500",
    textAnchor: "middle"
  }, React.createElement("text", {
    x: "50",
    y: "218"
  }, "FRONT"), React.createElement("text", {
    x: "160",
    y: "218"
  }, "BACK")));
};
window.Anatomy = Anatomy;
window.MUSCLES = MUSCLES;
})();

// ══ nav.jsx ══
;(function () {
const NAV_ITEMS = [{
  id: "dashboard",
  icon: "home",
  label: "Home"
}, {
  id: "scheda",
  icon: "dumbbell",
  label: "Scheda"
}, {
  id: "dieta",
  icon: "fork",
  label: "Dieta"
}, {
  id: "spesa",
  icon: "cart",
  label: "Spesa"
}, {
  id: "coach",
  icon: "spark",
  label: "Coach"
}, {
  id: "storico",
  icon: "trend-up",
  label: "Storico"
}, {
  id: "impostazioni",
  icon: "gear",
  label: "Setup"
}];
const TabBar = ({
  screen,
  onNav
}) => {
  const t = useT();
  const mobileItems = NAV_ITEMS.filter(it => it.id !== "storico");
  return React.createElement("nav", {
    style: {
      flexShrink: 0,
      display: "flex",
      gap: 2,
      margin: "0 10px",
      marginBottom: "calc(6px + env(safe-area-inset-bottom))",
      padding: "7px 6px",
      borderRadius: 26,
      backgroundColor: "var(--glass)",
      backgroundImage: "var(--glass-sheen)",
      backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
      WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
      border: "1px solid var(--glass-border)",
      boxShadow: "var(--shadow-2), inset 0 1px 0 var(--glass-edge), inset 0 -1px 0 var(--glass-edge-b)",
      position: "relative",
      zIndex: 5
    }
  }, mobileItems.map(it => {
    const on = screen === it.id;
    return React.createElement("button", {
      key: it.id,
      onClick: () => onNav(it.id),
      className: "pressable",
      style: {
        flex: 1,
        border: 0,
        background: on ? "rgba(10,132,255,0.16)" : "transparent",
        color: on ? "var(--accent)" : "var(--text-2)",
        padding: "7px 0 6px",
        borderRadius: 17,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        cursor: "pointer",
        transition: "color 0.16s, background 0.16s"
      }
    }, React.createElement(Icon, {
      name: it.icon,
      size: 23,
      strokeWidth: on ? 2.1 : 1.9
    }), React.createElement("span", {
      style: {
        fontSize: 9.5,
        fontWeight: on ? 600 : 500,
        letterSpacing: -0.005
      }
    }, t(it.label)));
  }));
};
const Sidebar = ({
  screen,
  onNav
}) => {
  const t = useT();
  const todaySess = window.getTodaySession ? window.getTodaySession() : null;
  const labels = {
    dashboard: t("Dashboard"),
    scheda: t("Allenamento"),
    dieta: t("Dieta"),
    spesa: t("Lista spesa"),
    coach: t("AI Coach"),
    storico: t("Storico"),
    impostazioni: t("Impostazioni")
  };
  return React.createElement("aside", {
    style: {
      width: 240,
      flexShrink: 0,
      height: "100%",
      backgroundColor: "var(--glass)",
      backgroundImage: "var(--glass-sheen)",
      backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
      WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
      borderRight: "1px solid var(--glass-border)",
      boxShadow: "inset -1px 0 0 var(--glass-edge-b)",
      display: "flex",
      flexDirection: "column",
      padding: "22px 14px"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 8px 22px"
    }
  }, React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 9,
      background: "var(--brand-grad)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--display)",
      fontWeight: 700,
      fontSize: 16,
      letterSpacing: -0.04
    }
  }, "LF"), React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: -0.01
    }
  }, "Lorenzo"), React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-2)"
    }
  }, t("Fitness Hub")))), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, NAV_ITEMS.map(it => {
    const on = screen === it.id;
    return React.createElement("button", {
      key: it.id,
      onClick: () => onNav(it.id),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        background: on ? "rgba(10,132,255,0.14)" : "transparent",
        color: on ? "var(--accent)" : "var(--text-2)",
        border: 0,
        padding: "10px 12px",
        borderRadius: 10,
        fontSize: 13.5,
        fontWeight: on ? 600 : 500,
        cursor: "pointer",
        letterSpacing: -0.005,
        textAlign: "left",
        transition: "background 0.14s, color 0.14s"
      }
    }, React.createElement(Icon, {
      name: it.icon,
      size: 18,
      strokeWidth: on ? 2 : 1.6
    }), labels[it.id]);
  })), React.createElement("div", {
    style: {
      marginTop: "auto",
      padding: "12px"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px",
      background: "var(--card)",
      borderRadius: 12,
      border: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 9,
      background: "var(--brand-grad)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      fontSize: 13,
      color: "#fff",
      letterSpacing: "-0.03em"
    }
  }, "LF"), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, "Lorenzo"), React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--text-2)"
    }
  }, todaySess ? todaySess.label : t("Riposo"))))));
};
const SyncBadge = ({
  compact
}) => {
  const t = useT();
  const [s, setS] = React.useState(() => window._syncState || {
    status: "idle",
    last: null
  });
  React.useEffect(() => {
    const on = () => setS(Object.assign({}, window._syncState || {
      status: "idle",
      last: null
    }));
    window.addEventListener("lfh-sync", on);
    return () => window.removeEventListener("lfh-sync", on);
  }, []);
  const status = s.status || "idle";
  if (status === "idle") return null;
  const time = s.last ? new Date(s.last).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  }) : null;
  const CFG = {
    syncing: {
      color: "var(--text-2)",
      bg: "rgba(120,120,128,0.14)",
      icon: "cloud",
      label: t("Sincronizzazione…")
    },
    ok: {
      color: "var(--success)",
      bg: "rgba(48,209,88,0.12)",
      icon: "cloud",
      label: time ? `${t("Sync")} ${time}` : t("Sincronizzato")
    },
    error: {
      color: "var(--warning)",
      bg: "rgba(255,159,10,0.14)",
      icon: "cloud-off",
      label: t("Sync non riuscito")
    },
    offline: {
      color: "var(--text-3)",
      bg: "rgba(120,120,128,0.14)",
      icon: "cloud-off",
      label: t("Offline")
    }
  };
  const cfg = CFG[status] || CFG.ok;
  return React.createElement("span", {
    className: "pill",
    title: cfg.label,
    style: {
      fontSize: 10.5,
      padding: "3px 8px",
      gap: 5,
      background: cfg.bg,
      color: cfg.color
    }
  }, status === "syncing" ? React.createElement("span", {
    className: "spinner",
    style: {
      width: 10,
      height: 10,
      borderWidth: 1.5
    }
  }) : React.createElement(Icon, {
    name: cfg.icon,
    size: 11,
    strokeWidth: 2
  }), !compact && cfg.label);
};
window.TabBar = TabBar;
window.Sidebar = Sidebar;
window.SyncBadge = SyncBadge;
window.NAV_ITEMS = NAV_ITEMS;
})();

// ══ schedaState.jsx ══
;(function () {
function exId(dayKey, pos) {
  return `${dayKey}#${pos}`;
}
function getDayState(map, dayKey, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((map || {})[exId(dayKey, i)]);
  return out;
}
function schedaProgKey(dateKey) {
  return `schedaProg_${dateKey}`;
}
function readSchedaProg(storage, dateKey) {
  const all = storage ? storage.get(schedaProgKey(dateKey), null) : null;
  return {
    completion: all && all.completion || {},
    substitutions: all && all.substitutions || {},
    pesos: all && all.pesos || {}
  };
}
function writeSchedaProg(storage, dateKey, patch) {
  if (!storage) return;
  const cur = readSchedaProg(storage, dateKey);
  const next = {
    completion: Object.assign({}, cur.completion, patch.completion),
    substitutions: Object.assign({}, cur.substitutions, patch.substitutions),
    pesos: Object.assign({}, cur.pesos, patch.pesos)
  };
  storage.set(schedaProgKey(dateKey), next);
}
window.exId = exId;
window.getDayState = getDayState;
window.schedaProgKey = schedaProgKey;
window.readSchedaProg = readSchedaProg;
window.writeSchedaProg = writeSchedaProg;
})();

// ══ progress.jsx ══
;(function () {
(function () {
  function parseWeight(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(",", ".");
    if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : null;
  }
  function suggestStep(weight) {
    if (weight == null) return null;
    if (weight < 10) return 1;
    if (weight < 40) return 2.5;
    return 5;
  }
  function suggestNext(lastRaw) {
    const w = parseWeight(lastRaw);
    if (w == null) return null;
    const step = suggestStep(w);
    return {
      last: w,
      step: step,
      next: Math.round((w + step) * 100) / 100
    };
  }
  function applySession(prMap, sets) {
    const next = Object.assign({}, prMap || {});
    const newPRs = [];
    for (const s of sets || []) {
      const w = parseWeight(s && s.peso);
      const name = s && s.esercizio;
      if (w == null || !name) continue;
      const cur = next[name];
      if (!cur || w > cur.peso) {
        const dup = newPRs.find(p => p.esercizio === name);
        if (dup) {
          if (w > dup.peso) {
            dup.peso = w;
            dup.prev = cur ? cur.peso : null;
          }
        } else newPRs.push({
          esercizio: name,
          peso: w,
          prev: cur ? cur.peso : null
        });
        next[name] = {
          peso: w,
          date: s && s.date || null
        };
      }
    }
    return {
      prMap: next,
      newPRs: newPRs
    };
  }
  function bestFor(prMap, esercizio) {
    const r = prMap && prMap[esercizio];
    return r ? r.peso : null;
  }
  function aggregateVolume(history) {
    const byGroup = {};
    let total = 0;
    for (const h of history || []) {
      const ms = h && h.muscleSets || {};
      for (const g in ms) {
        const v = ms[g] || 0;
        byGroup[g] = (byGroup[g] || 0) + v;
        total += v;
      }
    }
    const order = Object.keys(byGroup).sort((a, b) => byGroup[b] - byGroup[a]);
    return {
      byGroup: byGroup,
      total: total,
      order: order
    };
  }
  function lastNDates(todayStr, n) {
    const out = [];
    const d = new Date(todayStr + "T00:00:00");
    if (isNaN(d)) return out;
    for (let i = 0; i < n; i++) {
      const dd = new Date(d);
      dd.setDate(d.getDate() - i);
      out.push(dd.getFullYear() + "-" + String(dd.getMonth() + 1).padStart(2, "0") + "-" + String(dd.getDate()).padStart(2, "0"));
    }
    return out;
  }
  function nextNudge(ctx) {
    ctx = ctx || {};
    const dismissed = ctx.dismissed || [];
    const has = id => dismissed.indexOf(id) === -1;
    const h = typeof ctx.hour === "number" ? ctx.hour : 12;
    if (ctx.isWorkoutDay && !ctx.gymDone && h >= 9 && h < 22 && has("workout")) {
      return {
        id: "workout",
        kind: "workout",
        text: "Oggi tocca allenarti — inizia quando vuoi."
      };
    }
    if (!ctx.checkInDone && h >= 20 && has("checkin")) {
      return {
        id: "checkin",
        kind: "checkin",
        text: "Registra il check-in serale (sonno/energia)."
      };
    }
    const target = ctx.hydrationTarget || 8;
    if (typeof ctx.hydration === "number" && ctx.hydration < target && h >= 12 && has("hydration")) {
      return {
        id: "hydration",
        kind: "hydration",
        text: "Sei indietro con l'acqua — bevi un bicchiere."
      };
    }
    return null;
  }
  function mergeWeightLog(local, cloud, prefer) {
    prefer = prefer === "local" ? "local" : "cloud";
    const map = {};
    const put = list => {
      for (const e of list || []) {
        if (!e || !e.date) continue;
        map[e.date] = {
          date: e.date,
          weight: e.weight
        };
      }
    };
    if (prefer === "cloud") {
      put(local);
      put(cloud);
    } else {
      put(cloud);
      put(local);
    }
    return Object.values(map).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  window.WorkoutProgress = {
    parseWeight: parseWeight,
    suggestStep: suggestStep,
    suggestNext: suggestNext,
    applySession: applySession,
    bestFor: bestFor,
    aggregateVolume: aggregateVolume,
    lastNDates: lastNDates,
    nextNudge: nextNudge,
    mergeWeightLog: mergeWeightLog
  };
})();
})();

// ══ insights.jsx ══
;(function () {
(function () {
  function _num(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(",", ".");
    if (!s || !/^[0-9]+(\.[0-9]+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return n > 0 ? n : null;
  }
  function e1rm(peso, rip) {
    const p = _num(peso),
      r = Number(rip);
    if (p == null || !r || r < 1) return null;
    if (r === 1) return p;
    return Math.round(p * (1 + r / 30) * 10) / 10;
  }
  function exerciseSessions(pesiMap, name, limit) {
    limit = limit || 3;
    const rows = pesiMap && pesiMap[String(name || "").toLowerCase().trim()] || [];
    const byDate = {};
    rows.forEach(r => {
      if (!r || !r.date) return;
      (byDate[r.date] = byDate[r.date] || []).push({
        peso: r.peso,
        rip: r.rip
      });
    });
    return Object.keys(byDate).sort().reverse().slice(0, limit).map(date => {
      const sets = byDate[date];
      let top = 0,
        tonnage = 0;
      sets.forEach(s => {
        const p = _num(s.peso);
        if (p != null) {
          if (p > top) top = p;
          tonnage += p * (Number(s.rip) || 0);
        }
      });
      return {
        date,
        sets,
        top: top || null,
        tonnage: Math.round(tonnage)
      };
    });
  }
  function sessionSummary(args) {
    const {
      exercises,
      dayKey,
      completion,
      substitutions,
      pesos,
      exIdFn,
      startTs,
      endTs,
      pesiMap
    } = args;
    let setsDone = 0,
      tonnage = 0,
      prevTonnage = 0,
      hasPrev = false;
    const perExercise = [];
    (exercises || []).forEach((ex, i) => {
      const id = exIdFn(dayKey, i);
      const comp = completion && completion[id] || [];
      const done = comp.filter(Boolean).length;
      if (!done) return;
      const name = substitutions && substitutions[id] || ex.name;
      const exPesos = pesos && pesos[id] || ex.sets.map(s => String(s.peso == null ? "" : s.peso));
      let top = null;
      ex.sets.forEach((s, j) => {
        if (!comp[j]) return;
        setsDone++;
        const p = _num(exPesos[j] != null && String(exPesos[j]).trim() !== "" ? exPesos[j] : s.peso);
        if (p != null) {
          tonnage += p * (Number(s.rip) || 0);
          if (top == null || p > top) top = p;
        }
      });
      const prevSessions = exerciseSessions(pesiMap, name, 1);
      const prev = prevSessions[0] || null;
      if (prev) {
        hasPrev = true;
        prevTonnage += prev.tonnage;
      }
      perExercise.push({
        name,
        top,
        prevTop: prev ? prev.top : null,
        delta: top != null && prev && prev.top != null ? Math.round((top - prev.top) * 10) / 10 : null
      });
    });
    const durationMin = startTs && endTs && endTs > startTs ? Math.max(1, Math.round((endTs - startTs) / 60000)) : null;
    return {
      setsDone,
      exCount: perExercise.length,
      durationMin,
      tonnage: Math.round(tonnage),
      prevTonnage: hasPrev ? Math.round(prevTonnage) : null,
      perExercise
    };
  }
  function weeklyReport(args) {
    const {
      today,
      weightLog,
      gymFlags,
      muscleHist,
      prMap,
      checkinDates,
      plannedSessions
    } = args;
    const days = [];
    const prevDays = [];
    const base = new Date(today + "T12:00:00");
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      (i < 7 ? days : prevDays).push(k);
    }
    const inWeek = date => days.indexOf(date) !== -1;
    const sessions = days.filter(d => gymFlags && gymFlags[d]).length;
    const byGroup = {};
    let totalSets = 0;
    (muscleHist || []).forEach(h => {
      if (!h || !inWeek(h.date) || !h.muscleSets) return;
      Object.keys(h.muscleSets).forEach(g => {
        const n = Number(h.muscleSets[g]) || 0;
        byGroup[g] = (byGroup[g] || 0) + n;
        totalSets += n;
      });
    });
    const order = Object.keys(byGroup).sort((a, b) => byGroup[b] - byGroup[a]);
    const avg = dates => {
      const w = (weightLog || []).filter(e => e && dates.indexOf(e.date) !== -1).map(e => e.weight);
      if (!w.length) return null;
      return Math.round(w.reduce((s, x) => s + x, 0) / w.length * 10) / 10;
    };
    const avgWeight = avg(days);
    const prevAvgWeight = avg(prevDays);
    const weightDelta = avgWeight != null && prevAvgWeight != null ? Math.round((avgWeight - prevAvgWeight) * 10) / 10 : null;
    const prs = [];
    Object.keys(prMap || {}).forEach(nome => {
      const pr = prMap[nome];
      if (pr && inWeek(pr.date)) prs.push({
        esercizio: nome,
        peso: pr.peso,
        date: pr.date
      });
    });
    prs.sort((a, b) => (b.peso || 0) - (a.peso || 0));
    const checkins = (checkinDates || []).filter(inWeek).length;
    return {
      sessions,
      planned: plannedSessions || 3,
      totalSets,
      byGroup,
      order,
      avgWeight,
      prevAvgWeight,
      weightDelta,
      prs,
      checkins
    };
  }
  function deloadAdvice(checkIns) {
    const list = (checkIns || []).filter(Boolean);
    const today = list[0];
    if (!today) return {
      deload: false,
      reason: null
    };
    if (String(today.ailments || "").trim()) return {
      deload: true,
      reason: "fastidi"
    };
    const score = c => ((Number(c.sleep) || 0) + (Number(c.energy) || 0)) / 2;
    if (score(today) > 0 && score(today) <= 2.5) return {
      deload: true,
      reason: "energia"
    };
    const y = list[1];
    if (y && score(today) > 0 && score(today) <= 3 && score(y) > 0 && score(y) <= 3) {
      return {
        deload: true,
        reason: "recupero"
      };
    }
    return {
      deload: false,
      reason: null
    };
  }
  function deloadWeight(raw) {
    const p = _num(raw);
    if (p == null) return null;
    const step = p < 20 ? 1 : 2.5;
    const target = p * 0.9;
    const v = Math.round(target / step) * step;
    return v > 0 && v < p ? v : null;
  }
  function movingAverage(weightLog, win) {
    win = win || 7;
    const log = (weightLog || []).filter(e => e && e.date && e.weight > 0);
    return log.map(e => {
      const from = new Date(e.date + "T12:00:00");
      from.setDate(from.getDate() - (win - 1));
      const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
      const slice = log.filter(x => x.date >= fromKey && x.date <= e.date);
      const avg = slice.reduce((s, x) => s + x.weight, 0) / slice.length;
      return {
        date: e.date,
        ma: Math.round(avg * 100) / 100
      };
    });
  }
  function weightProjection(weightLog, targetKg, days) {
    days = days || 21;
    const log = (weightLog || []).filter(e => e && e.date && e.weight > 0);
    if (log.length < 2) return null;
    const lastDate = log[log.length - 1].date;
    const cut = new Date(lastDate + "T12:00:00");
    cut.setDate(cut.getDate() - days);
    const cutKey = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
    const pts = log.filter(e => e.date >= cutKey);
    if (pts.length < 2) return null;
    const t0 = new Date(pts[0].date + "T12:00:00").getTime();
    const xs = pts.map(e => (new Date(e.date + "T12:00:00").getTime() - t0) / 86400000);
    const ys = pts.map(e => e.weight);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    if (!den) return null;
    const slopePerDay = num / den;
    const current = ys[ys.length - 1];
    const out = {
      ratePerWeek: Math.round(slopePerDay * 7 * 100) / 100,
      current
    };
    const target = _num(targetKg);
    if (target != null) {
      out.target = target;
      const diff = target - current;
      if (Math.abs(diff) <= 0.3) {
        out.reached = true;
      } else if (slopePerDay !== 0 && diff > 0 === slopePerDay > 0) {
        const daysTo = diff / slopePerDay;
        if (daysTo > 0 && daysTo < 730) {
          const eta = new Date(lastDate + "T12:00:00");
          eta.setDate(eta.getDate() + Math.round(daysTo));
          out.etaDays = Math.round(daysTo);
          out.etaDate = `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, "0")}-${String(eta.getDate()).padStart(2, "0")}`;
        }
      }
    }
    return out;
  }
  function mealAdherence(checkedMap, totalMeals) {
    const done = Object.keys(checkedMap || {}).filter(k => checkedMap[k]).length;
    const total = Number(totalMeals) || 0;
    return {
      done: Math.min(done, total),
      total,
      pct: total ? Math.round(Math.min(done, total) / total * 100) : 0
    };
  }
  const FOOD_GROUPS = [{
    id: "carbo",
    items: [{
      match: /\briso\b/,
      name: "Riso (secco)",
      kcal: 360
    }, {
      match: /\bpasta\b/,
      name: "Pasta (secca)",
      kcal: 360
    }, {
      match: /\bpane\b/,
      name: "Pane",
      kcal: 250
    }, {
      match: /\bpatat/,
      name: "Patate",
      kcal: 77
    }, {
      match: /\bgallette\b/,
      name: "Gallette",
      kcal: 380
    }]
  }, {
    id: "proteine",
    items: [{
      match: /\bpollo\b/,
      name: "Pollo (petto)",
      kcal: 110
    }, {
      match: /\btacchino\b/,
      name: "Tacchino",
      kcal: 105
    }, {
      match: /\bmanzo\b|\bbisteccc?a\b|\bvitello\b/,
      name: "Manzo magro",
      kcal: 130
    }, {
      match: /\bmerluzzo\b/,
      name: "Merluzzo",
      kcal: 82
    }, {
      match: /\borata\b/,
      name: "Orata",
      kcal: 100
    }, {
      match: /\bsalmone\b/,
      name: "Salmone",
      kcal: 185
    }, {
      match: /\btonno\b/,
      name: "Tonno al naturale",
      kcal: 105
    }, {
      match: /\buova\b|\buovo\b/,
      name: "Uova",
      kcal: 143
    }]
  }, {
    id: "grassi",
    items: [{
      match: /\bolio\b/,
      name: "Olio EVO",
      kcal: 900
    }, {
      match: /\bnoci\b/,
      name: "Noci",
      kcal: 650
    }, {
      match: /\bmandorl/,
      name: "Mandorle",
      kcal: 600
    }]
  }];
  function _swapsFrom(group, base, grams) {
    const kcal = base.kcal * grams / 100;
    return group.items.filter(it => it !== base).map(it => ({
      name: it.name,
      grams: Math.round(kcal / it.kcal * 100 / 5) * 5
    })).filter(s => s.grams >= 5);
  }
  function _findBase(text) {
    for (const group of FOOD_GROUPS) {
      const base = group.items.find(it => it.match.test(text));
      if (base) return {
        group,
        base
      };
    }
    return null;
  }
  function foodSwaps(foodText, qtyText) {
    const text = String(foodText || "").toLowerCase();
    const mQty = String(qtyText || "").match(/(\d+)\s*[–\-e]?\s*\d*\s*g/);
    if (mQty) {
      const hit = _findBase(text);
      if (hit) return _swapsFrom(hit.group, hit.base, parseInt(mQty[1], 10));
    }
    for (const seg of text.split(/[|+]/)) {
      const m = seg.match(/(\d+)\s*g\s+(.+)/);
      if (!m) continue;
      const hit = _findBase(m[2]);
      if (hit) return _swapsFrom(hit.group, hit.base, parseInt(m[1], 10));
    }
    return [];
  }
  window.Insights = {
    e1rm,
    exerciseSessions,
    sessionSummary,
    weeklyReport,
    deloadAdvice,
    deloadWeight,
    mealAdherence,
    foodSwaps,
    movingAverage,
    weightProjection
  };
})();
})();

// ══ screens/onboarding.jsx ══
;(function () {
const STEPS = [{
  label: "Sorgente",
  title: "Collega Google Sheets",
  sub: "Incolla l'URL del tuo Google Apps Script (doGet/doPost). Configuri il foglio in Impostazioni.",
  icon: "doc",
  iconColor: "#0A84FF",
  field: "sheets",
  placeholder: "https://script.google.com/macros/s/…/exec",
  mono: false,
  storageKey: "sheetsUrl"
}, {
  label: "Coach",
  title: "API key Groq",
  sub: "Per attivare l'AI Coach. Ottienila su console.groq.com — gratuita.",
  icon: "key",
  iconColor: "#BF5AF2",
  field: "api",
  placeholder: "gsk_…",
  mono: true,
  storageKey: "groqApiKey"
}, {
  label: "Profilo",
  title: "Il tuo peso attuale",
  sub: "Inizia a tracciare il trend da oggi.",
  icon: "scale",
  iconColor: "#30D158",
  field: "weight",
  placeholder: "100",
  mono: true,
  suffix: "kg",
  inputWidth: 180,
  storageKey: "bodyWeight"
}];
function _stepAlreadyDone(s) {
  if (!window.storage) return false;
  const val = window.storage.get(s.storageKey, "");
  if (s.storageKey === "bodyWeight") {
    return !!val && parseFloat(val) > 0;
  }
  return !!(val && String(val).trim().length > 0);
}
const Onboarding = ({
  device,
  onDone
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const activeSteps = React.useMemo(() => STEPS.filter(s => !_stepAlreadyDone(s)), []);
  React.useEffect(() => {
    if (activeSteps.length === 0) {
      if (window.storage) window.storage.set("onboardingDone", true);
      onDone();
    }
  }, []);
  const [step, setStep] = React.useState(0);
  const [values, setValues] = React.useState(() => {
    const init = {
      sheets: "",
      api: "",
      weight: ""
    };
    STEPS.forEach(s => {
      if (window.storage) {
        const val = window.storage.get(s.storageKey, "");
        if (val) init[s.field] = String(val);
      }
    });
    return init;
  });
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const el = document.querySelector(".onb-step");
    if (el && window.Motion && window.Motion.enabled() && window.gsap) {
      window.gsap.fromTo(el, {
        x: 14,
        opacity: 0
      }, {
        x: 0,
        opacity: 1,
        duration: 0.3,
        ease: "power2.out",
        clearProps: "transform,opacity"
      });
    }
  }, [step]);
  if (activeSteps.length === 0) return null;
  const current = activeSteps[step];
  const isLast = step === activeSteps.length - 1;
  const canNext = values[current.field].trim().length > 0;
  const handleDone = () => {
    setSaving(true);
    STEPS.forEach(s => {
      const val = values[s.field].trim();
      if (val && window.storage) {
        if (s.storageKey === "bodyWeight") {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            window.storage.set("bodyWeight", num);
            const log = window.storage.get("weightLog", []);
            const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
            if (!log.find(e => e.date === today)) {
              log.push({
                date: today,
                weight: num
              });
              window.storage.set("weightLog", log);
            }
          }
        } else {
          window.storage.set(s.storageKey, val);
        }
      }
    });
    if (window.storage) window.storage.set("onboardingDone", true);
    setTimeout(() => {
      setSaving(false);
      onDone();
    }, 300);
  };
  const handleNext = () => {
    if (isLast) handleDone();else setStep(step + 1);
  };
  return React.createElement("div", {
    style: {
      height: "100%",
      display: "flex",
      flexDirection: "column",
      padding: isDesktop ? "48px 64px" : "16px 20px 28px",
      background: "var(--bg)",
      position: "relative",
      overflow: "hidden"
    }
  }, React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      background: `radial-gradient(60% 50% at 50% 0%, ${current.iconColor}1f 0%, transparent 70%)`,
      transition: "background 0.6s"
    }
  }), React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      position: "relative",
      zIndex: 1
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, React.createElement("div", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: "var(--brand-grad)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--display)",
      fontWeight: 700,
      fontSize: 13,
      color: "#fff"
    }
  }, "LF"), React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: -0.005
    }
  }, t("Fitness Hub"))), React.createElement("button", {
    onClick: () => {
      if (window.storage) window.storage.set("onboardingDone", true);
      onDone();
    },
    style: {
      background: "transparent",
      border: 0,
      color: "var(--text-2)",
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer"
    }
  }, t("Salta"))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: isDesktop ? 28 : 22,
      position: "relative",
      zIndex: 1
    }
  }, activeSteps.map((_, i) => React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      background: i <= step ? "var(--accent)" : "var(--track)",
      transition: "background 0.3s"
    }
  }))), React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      maxWidth: 480,
      margin: "0 auto",
      width: "100%",
      position: "relative",
      zIndex: 1,
      gap: isDesktop ? 24 : 18
    }
  }, React.createElement("div", {
    className: "onb-step"
  }, React.createElement("div", {
    className: "fade-up",
    key: step,
    style: {
      textAlign: "center"
    }
  }, React.createElement("div", {
    style: {
      width: 72,
      height: 72,
      borderRadius: 22,
      background: `${current.iconColor}22`,
      border: `1px solid ${current.iconColor}44`,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      margin: "0 auto 22px"
    }
  }, React.createElement(Icon, {
    name: current.icon,
    size: 32,
    color: current.iconColor,
    strokeWidth: 1.6
  })), React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: current.iconColor,
      marginBottom: 8
    }
  }, t("Step"), " ", step + 1, " ", t("di"), " ", activeSteps.length, " · ", t(current.label)), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 34 : 26,
      fontWeight: 600,
      letterSpacing: -0.025,
      marginBottom: 10
    }
  }, t(current.title)), React.createElement("p", {
    className: "muted",
    style: {
      fontSize: isDesktop ? 16 : 14,
      lineHeight: 1.5
    }
  }, t(current.sub))), React.createElement("div", {
    className: "fade-up",
    key: `f${step}`,
    style: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: 8
    }
  }, React.createElement("input", {
    autoFocus: true,
    className: "input " + (current.mono ? "input-mono" : ""),
    type: current.field === "api" ? "password" : "text",
    placeholder: current.placeholder,
    value: values[current.field],
    onChange: e => setValues(v => ({
      ...v,
      [current.field]: e.target.value
    })),
    style: {
      maxWidth: current.inputWidth || 420,
      fontSize: isDesktop ? 17 : 15.5,
      padding: "14px 18px",
      textAlign: current.suffix ? "center" : "left",
      fontWeight: current.mono ? 600 : 500
    },
    onKeyDown: e => {
      if (e.key === "Enter" && canNext) handleNext();
    }
  }), current.suffix && React.createElement("span", {
    className: "muted",
    style: {
      fontSize: 18,
      fontWeight: 500
    }
  }, current.suffix))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      justifyContent: "center",
      marginTop: 8
    }
  }, step > 0 && React.createElement("button", {
    className: "btn",
    onClick: () => setStep(step - 1),
    style: {
      minWidth: 120
    }
  }, t("Indietro")), React.createElement("button", {
    className: "btn primary",
    disabled: !canNext || saving,
    onClick: handleNext,
    style: {
      minWidth: 180,
      opacity: canNext && !saving ? 1 : 0.4,
      cursor: canNext ? "pointer" : "default"
    }
  }, saving ? React.createElement("span", {
    className: "spinner",
    style: {
      width: 16,
      height: 16
    }
  }) : React.createElement(React.Fragment, null, isLast ? t("Iniziamo") : t("Continua"), React.createElement(Icon, {
    name: "chevron",
    size: 15,
    strokeWidth: 2.4
  }))))), React.createElement("div", {
    className: "muted",
    style: {
      textAlign: "center",
      fontSize: 11.5,
      padding: "12px 0 0",
      position: "relative",
      zIndex: 1
    }
  }, "🔒 ", t("Le credenziali sono cifrate e salvate solo sul tuo dispositivo.")));
};
window.Onboarding = Onboarding;
})();

// ══ screens/dashboard.jsx ══
;(function () {
const _dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ACTIVITY_META = {
  corsa: {
    label: "Corsa",
    emoji: "🏃",
    c: "#FF453A"
  },
  bike: {
    label: "Bike",
    emoji: "🚴",
    c: "#FF9F0A"
  },
  hiit: {
    label: "HIIT",
    emoji: "⚡",
    c: "#BF5AF2"
  },
  camminata: {
    label: "Camminata",
    emoji: "🚶",
    c: "#30D158"
  },
  ellittica: {
    label: "Ellittica",
    emoji: "🔄",
    c: "#5AC8FA"
  }
};
function _homeDieta() {
  if (!window.parseDieta || !window.storage) return null;
  const text = window.storage.get("dietaData", null);
  if (!text) return null;
  try {
    return window.parseDieta(text);
  } catch (_) {
    return null;
  }
}
function _nextMealHome() {
  const dieta = _homeDieta();
  if (!dieta) return null;
  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const section = (sess ? dieta.ore17 : dieta.riposo) || dieta.riposo;
  if (!section || !section.meals || !section.meals.length) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const toMins = hhmm => {
    const [h, m] = (hhmm || "00:00").split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const meals = section.meals.slice().sort((a, b) => toMins(a.time) - toMins(b.time));
  const upcoming = meals.find(ml => toMins(ml.time) >= nowMins);
  let current = null;
  for (const ml of meals) {
    if (toMins(ml.time) <= nowMins && nowMins - toMins(ml.time) <= 90) current = ml;
  }
  const pick = current || upcoming || meals[0];
  const first = pick.primary && pick.primary[0] ? pick.primary[0].food : "";
  return {
    title: pick.title,
    time: pick.time,
    food: first,
    upcoming: !current
  };
}
const Sparkline = ({
  data,
  width = 160,
  height = 56,
  color = "var(--accent)"
}) => {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.weight);
  const min = Math.min(...vals) - 0.2;
  const max = Math.max(...vals) + 0.2;
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = i / (data.length - 1) * width;
    const y = height - (d.weight - min) / range * (height - 6) - 3;
    return [x, y];
  });
  const path = points.map((p, i) => i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return React.createElement("svg", {
    width: width,
    height: height,
    style: {
      display: "block",
      width: "100%"
    },
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none"
  }, React.createElement("defs", null, React.createElement("linearGradient", {
    id: "spark-grad2",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: "0.30"
  }), React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: "0"
  }))), React.createElement("path", {
    d: area,
    fill: "url(#spark-grad2)"
  }), React.createElement("path", {
    d: path,
    fill: "none",
    stroke: color,
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke"
  }));
};
const CheckScale = ({
  label,
  value,
  onChange
}) => React.createElement("div", null, React.createElement("div", {
  style: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  }
}, React.createElement("span", {
  style: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-2)"
  }
}, label), React.createElement("span", {
  className: "tnum",
  style: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-3)"
  }
}, value || "—", "/5")), React.createElement("div", {
  style: {
    display: "flex",
    gap: 6
  }
}, [1, 2, 3, 4, 5].map(n => {
  const on = value >= n;
  return React.createElement("button", {
    key: n,
    onClick: () => onChange(n),
    "aria-label": `${label} ${n}`,
    style: {
      flex: 1,
      minHeight: 44,
      border: 0,
      borderRadius: 10,
      cursor: "pointer",
      background: on ? "var(--brand-grad)" : "var(--card-2)",
      color: on ? "#fff" : "var(--text-3)",
      fontSize: 13,
      fontWeight: 600,
      transition: "background 0.15s"
    }
  }, n);
})));
const MovimentoCard = ({
  activities,
  addActivity,
  isDesktop
}) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const totalMin = activities.reduce((s, a) => s + (a.min || 0), 0);
  const totalKm = activities.reduce((s, a) => s + (a.km || 0), 0);
  const recent = activities.slice(0, 3);
  return React.createElement("div", {
    className: "ui-card"
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12
    }
  }, React.createElement("span", {
    className: "ui-cap"
  }, t("Movimento")), React.createElement("button", {
    onClick: () => setOpen(true),
    style: {
      background: "var(--card-2)",
      border: "1px solid var(--border)",
      cursor: "pointer",
      color: "var(--text)",
      fontSize: 12,
      fontWeight: 600,
      padding: "0 12px",
      minHeight: 44,
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }
  }, React.createElement(Icon, {
    name: "plus",
    size: 12,
    strokeWidth: 2.4
  }), " ", t("Log"))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      marginBottom: recent.length ? 12 : 0
    }
  }, React.createElement("div", null, React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: "-0.02em"
    }
  }, totalMin, React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-2)",
      fontWeight: 500
    }
  }, " min")), React.createElement("div", {
    className: "ui-cap"
  }, t("questa sett"))), React.createElement("div", {
    style: {
      width: 1,
      background: "var(--border)"
    }
  }), React.createElement("div", null, React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: "-0.02em"
    }
  }, totalKm.toFixed(1), React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-2)",
      fontWeight: 500
    }
  }, " km")), React.createElement("div", {
    className: "ui-cap"
  }, t("percorsi"))), React.createElement("div", {
    style: {
      width: 1,
      background: "var(--border)"
    }
  }), React.createElement("div", null, React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: "-0.02em"
    }
  }, activities.length), React.createElement("div", {
    className: "ui-cap"
  }, t("sessioni")))), recent.length > 0 && React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, recent.map(a => {
    const meta = ACTIVITY_META[a.type] || ACTIVITY_META.corsa;
    return React.createElement("div", {
      key: a.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 0",
        borderTop: "1px solid var(--border)"
      }
    }, React.createElement("div", {
      style: {
        width: 30,
        height: 30,
        borderRadius: 9,
        background: "var(--card-2)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14
      }
    }, meta.emoji), React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, React.createElement("div", {
      style: {
        fontSize: 13.5,
        fontWeight: 600
      }
    }, t(meta.label), a.note ? React.createElement("span", {
      style: {
        color: "var(--text-2)",
        fontWeight: 500,
        fontSize: 11.5
      }
    }, " · ", a.note) : null), React.createElement("div", {
      style: {
        color: "var(--text-2)",
        fontSize: 11,
        marginTop: 1
      }
    }, t(a.when))), React.createElement("div", {
      style: {
        textAlign: "right"
      }
    }, React.createElement("div", {
      className: "tnum",
      style: {
        fontSize: 13,
        fontWeight: 700
      }
    }, a.min, React.createElement("span", {
      style: {
        fontSize: 10,
        color: "var(--text-3)",
        fontWeight: 500
      }
    }, "min")), a.km > 0 && React.createElement("div", {
      className: "tnum",
      style: {
        fontSize: 11,
        color: "var(--text-2)",
        marginTop: 1
      }
    }, a.km.toFixed(1), " km")));
  })), open && React.createElement(ActivityLogger, {
    isDesktop: isDesktop,
    onClose: () => setOpen(false),
    onSave: a => {
      addActivity && addActivity(a);
      if (window.sheetsAPI) {
        const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
        window.sheetsAPI.saveMovimento({
          date: today,
          type: a.type,
          min: a.min,
          km: a.km || 0,
          note: a.note || ""
        }).catch(() => {});
      }
      setOpen(false);
    }
  }));
};
const ActivityLogger = ({
  onClose,
  onSave,
  isDesktop
}) => {
  const t = useT();
  const [type, setType] = React.useState("corsa");
  const [min, setMin] = React.useState(30);
  const [km, setKm] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return React.createElement("div", {
    onClick: onClose,
    className: "ui-sheet-backdrop"
  }, React.createElement("div", {
    onClick: e => e.stopPropagation(),
    className: "ui-sheet",
    style: {
      maxWidth: isDesktop ? 440 : 560
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12
    }
  }, React.createElement("span", {
    style: {
      fontSize: 17,
      fontWeight: 650,
      letterSpacing: "-0.01em"
    }
  }, t("Logga attività")), React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      minWidth: 44,
      minHeight: 44,
      borderRadius: 999,
      background: "transparent",
      border: 0,
      color: "var(--text-2)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 16,
    strokeWidth: 2.2
  }))), React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, React.createElement("div", {
    className: "ui-cap",
    style: {
      marginBottom: 8
    }
  }, t("Tipo")), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8
    }
  }, Object.entries(ACTIVITY_META).map(([k, m]) => {
    const on = type === k;
    return React.createElement("button", {
      key: k,
      onClick: () => setType(k),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 48,
        padding: "0 14px",
        border: on ? 0 : "1px solid var(--border)",
        background: on ? "var(--brand-grad)" : "var(--card-2)",
        borderRadius: 12,
        cursor: "pointer"
      }
    }, React.createElement("span", {
      style: {
        fontSize: 18
      }
    }, m.emoji), React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        color: on ? "#fff" : "var(--text)"
      }
    }, t(m.label)));
  }))), React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 8
    }
  }, React.createElement("div", {
    className: "ui-cap"
  }, t("Durata")), React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 14,
      fontWeight: 700
    }
  }, min, React.createElement("span", {
    style: {
      color: "var(--text-2)",
      fontWeight: 500
    }
  }, " min"))), React.createElement("input", {
    type: "range",
    min: "5",
    max: "120",
    step: "5",
    value: min,
    onChange: e => setMin(parseInt(e.target.value)),
    style: {
      width: "100%"
    }
  })), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1.5fr",
      gap: 10,
      marginBottom: 16
    }
  }, React.createElement("div", null, React.createElement("div", {
    className: "ui-cap",
    style: {
      marginBottom: 8
    }
  }, t("Distanza")), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      background: "var(--card-2)",
      borderRadius: 11,
      padding: "10px 12px",
      border: "1px solid var(--border)"
    }
  }, React.createElement("input", {
    inputMode: "decimal",
    placeholder: t("opz."),
    value: km,
    onChange: e => setKm(e.target.value.replace(/[^0-9.,]/g, "").replace(",", ".")),
    style: {
      flex: 1,
      background: "transparent",
      border: 0,
      outline: "none",
      color: "var(--text)",
      fontSize: 14,
      fontWeight: 600,
      minWidth: 0,
      width: "100%"
    }
  }), React.createElement("span", {
    style: {
      color: "var(--text-2)",
      fontSize: 12
    }
  }, "km"))), React.createElement("div", null, React.createElement("div", {
    className: "ui-cap",
    style: {
      marginBottom: 8
    }
  }, t("Note")), React.createElement("input", {
    placeholder: t("Z2, BPM 145, sensazione…"),
    value: note,
    onChange: e => setNote(e.target.value),
    className: "input",
    style: {
      background: "var(--card-2)",
      padding: "10px 12px",
      fontSize: 13
    }
  }))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, React.createElement(UIButton, {
    variant: "quiet",
    style: {
      flex: 1
    },
    onClick: onClose
  }, t("Annulla")), React.createElement(UIButton, {
    style: {
      flex: 2
    },
    onClick: () => onSave({
      type,
      min,
      km: parseFloat(km) || 0,
      note
    })
  }, t("Salva sessione")))));
};
const WeeklyReportCard = ({
  onNav
}) => {
  const t = useT();
  const today = window.todayKey ? window.todayKey() : _dayKey(new Date());
  const dow = new Date().getDay();
  const show = dow === 0 || dow === 1;
  const weekKey = (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return _dayKey(d);
  })();
  const [dismissed, setDismissed] = React.useState(() => window.storage ? window.storage.get("weeklyReportDismissed", "") : "");
  const rep = React.useMemo(() => {
    if (!show || !window.Insights || !window.storage) return null;
    const st = window.storage;
    const gymFlags = {},
      muscleHist = [],
      checkinDates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = _dayKey(d);
      if (st.get(`gym_${k}`, false)) gymFlags[k] = true;
      const ms = st.get(`muscleSets_${k}`, null);
      if (ms && Object.keys(ms).length) muscleHist.push({
        date: k,
        muscleSets: ms
      });
      if (st.get(`checkIn_${k}`, null)) checkinDates.push(k);
    }
    return window.Insights.weeklyReport({
      today,
      weightLog: st.get("weightLog", []),
      gymFlags,
      muscleHist,
      prMap: st.get("prMap", {}),
      checkinDates,
      plannedSessions: (window.getSchedule ? (window.getSchedule().days || []).length : 3) || 3
    });
  }, [show, today]);
  if (!show || !rep || dismissed === weekKey) return null;
  if (!rep.sessions && !rep.totalSets && rep.avgWeight == null) return null;
  const dismiss = () => {
    setDismissed(weekKey);
    if (window.storage) window.storage.set("weeklyReportDismissed", weekKey);
  };
  return React.createElement(UICard, null, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      marginBottom: 10
    }
  }, React.createElement("span", {
    className: "ui-cap"
  }, "📅 ", t("La tua settimana")), React.createElement("button", {
    onClick: dismiss,
    "aria-label": t("Ignora"),
    style: {
      marginLeft: "auto",
      width: 26,
      height: 26,
      borderRadius: 999,
      background: "transparent",
      border: 0,
      color: "var(--text-3)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 13,
    strokeWidth: 2.4
  }))), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 8,
      marginBottom: rep.prs.length || rep.order.length ? 12 : 0
    }
  }, React.createElement("div", null, React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 20,
      fontWeight: 700
    }
  }, rep.sessions, React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-2)",
      fontWeight: 500
    }
  }, "/", rep.planned)), React.createElement("div", {
    className: "ui-cap"
  }, t("sessioni"))), React.createElement("div", null, React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 20,
      fontWeight: 700
    }
  }, rep.totalSets), React.createElement("div", {
    className: "ui-cap"
  }, t("serie"))), React.createElement("div", null, React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 20,
      fontWeight: 700,
      color: rep.weightDelta == null ? "var(--text)" : rep.weightDelta <= 0 ? "var(--success)" : "#FF9F0A"
    }
  }, rep.weightDelta == null ? "—" : `${rep.weightDelta > 0 ? "+" : ""}${rep.weightDelta}`), React.createElement("div", {
    className: "ui-cap"
  }, t("kg vs prec.")))), rep.prs.length > 0 && React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 12.5,
      color: "var(--success)",
      fontWeight: 600,
      marginBottom: rep.order.length ? 8 : 0
    }
  }, "🏆 ", rep.prs.length, " ", rep.prs.length === 1 ? t("record battuto") : t("record battuti"), ": ", rep.prs.slice(0, 2).map(p => `${p.esercizio} ${p.peso}kg`).join(" · ")), rep.order.length > 0 && React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--text-2)"
    }
  }, t("Volume"), ": ", rep.order.slice(0, 3).map(g => `${t(g)} ${rep.byGroup[g]}`).join(" · ")));
};
const Dashboard = ({
  device,
  onNav,
  activities,
  addActivity,
  checkIn,
  setCheckIn,
  bodyWeight,
  setBodyWeight
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const {
    lang
  } = useLang();
  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === "en" ? "en-US" : "it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
  const _h = now.getHours();
  const greetKey = _h < 13 ? "Buongiorno Lorenzo" : _h < 18 ? "Buon pomeriggio Lorenzo" : "Buonasera Lorenzo";
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const [restDay, setRestDay] = React.useState(() => window.storage ? window.storage.get("restDay_" + today, false) : false);
  const toggleRest = () => {
    const next = !restDay;
    if (window.storage) window.storage.set("restDay_" + today, next);
    setRestDay(next);
  };
  const daysCount = (window.getSchedule ? (window.getSchedule().days || []).length : 0) || 3;
  const _rawSession = window.getTodaySession ? window.getTodaySession() : null;
  const todaySession = restDay ? null : _rawSession;
  const [weightLog, setWeightLog] = React.useState(() => window.storage ? window.storage.get("weightLog", []) : []);
  const sparkData = weightLog.slice(-14);
  const latestWeight = sparkData[sparkData.length - 1]?.weight || bodyWeight;
  const weightDelta = sparkData.length >= 2 ? sparkData[sparkData.length - 1].weight - sparkData[0].weight : 0;
  const [newWeight, setNewWeight] = React.useState("");
  const saveWeight = () => {
    const val = parseFloat(newWeight);
    if (isNaN(val) || val <= 0) return;
    setBodyWeight(val);
    const log = window.storage ? window.storage.get("weightLog", []) : [];
    const idx = log.findIndex(e => e.date === today);
    if (idx >= 0) log[idx] = {
      date: today,
      weight: val
    };else log.push({
      date: today,
      weight: val
    });
    const trimmed = log.slice(-90);
    if (window.storage) window.storage.set("weightLog", trimmed);
    setWeightLog(trimmed);
    if (window.sheetsAPI) window.sheetsAPI.savePesoCorporeo({
      date: today,
      weight: val
    }).catch(() => {});
    setNewWeight("");
  };
  const weekGymDays = React.useMemo(() => {
    if (!window.storage) return 0;
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (window.storage.get(`gym_${_dayKey(d)}`, false)) count++;
    }
    return count;
  }, [today]);
  const weekMuscles = React.useMemo(() => {
    if (!window.storage) return {};
    const agg = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = window.storage.get(`muscleSets_${_dayKey(d)}`, null);
      if (day) Object.keys(day).forEach(g => {
        agg[g] = (agg[g] || 0) + (day[g] || 0);
      });
    }
    return agg;
  }, [today]);
  const hasWeekMuscles = Object.keys(weekMuscles).length > 0;
  const nextMeal = React.useMemo(() => _nextMealHome(), [today, restDay]);
  const [ailOpen, setAilOpen] = React.useState(!!(checkIn && checkIn.ailments));
  const [pesoOpen, setPesoOpen] = React.useState(false);
  const startWorkout = () => {
    window._schedaIntent = "player";
    onNav("scheda");
  };
  const [nudgeDismissed, setNudgeDismissed] = React.useState(() => window.storage ? window.storage.get(`nudgeDismissed_${today}`, []) : []);
  const nudge = window.WorkoutProgress ? window.WorkoutProgress.nextNudge({
    isWorkoutDay: !!todaySession,
    gymDone: window.storage ? !!window.storage.get(`gym_${today}`, false) : false,
    checkInDone: window.storage ? window.storage.get(`checkIn_${today}`, null) != null : false,
    hydration: window.storage ? Number(window.storage.get(`hydration_${today}`, 0)) : 0,
    hydrationTarget: 8,
    hour: new Date().getHours(),
    dismissed: nudgeDismissed
  }) : null;
  const dismissNudge = id => {
    const nextD = nudgeDismissed.concat([id]);
    setNudgeDismissed(nextD);
    if (window.storage) window.storage.set(`nudgeDismissed_${today}`, nextD);
  };
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: isDesktop ? "28px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      maxWidth: 640,
      margin: "0 auto",
      width: "100%"
    }
  }, React.createElement(UIHeader, {
    eyebrow: dateStr,
    title: t(greetKey),
    right: React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, window.SyncBadge ? React.createElement(SyncBadge, null) : null, React.createElement(UIAvatarLF, {
      onClick: () => onNav("impostazioni")
    }))
  }), nudge && React.createElement("div", {
    className: "fade-up",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      background: "rgba(10,132,255,0.12)",
      border: "1px solid rgba(10,132,255,0.25)",
      borderRadius: 14,
      padding: "11px 12px 11px 14px"
    }
  }, React.createElement("span", {
    style: {
      fontSize: 17
    }
  }, nudge.kind === "workout" ? "🏋️" : nudge.kind === "checkin" ? "🌙" : "💧"), React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 13,
      lineHeight: 1.35
    }
  }, t(nudge.text)), nudge.kind === "workout" && React.createElement("button", {
    onClick: startWorkout,
    style: {
      flexShrink: 0,
      background: "var(--accent)",
      color: "#fff",
      border: 0,
      borderRadius: 999,
      padding: "6px 12px",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, t("Inizia")), React.createElement("button", {
    onClick: () => dismissNudge(nudge.id),
    "aria-label": t("Ignora"),
    style: {
      flexShrink: 0,
      width: 26,
      height: 26,
      borderRadius: 999,
      background: "transparent",
      border: 0,
      color: "var(--text-3)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 13,
    strokeWidth: 2.4
  }))), React.createElement(UICard, {
    hero: true
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, React.createElement("div", {
    className: "ui-cap"
  }, t("Oggi")), React.createElement("button", {
    onClick: toggleRest,
    style: {
      background: restDay ? "var(--accent)" : "transparent",
      color: restDay ? "#fff" : "var(--text-2)",
      border: "1px solid var(--border)",
      borderRadius: 999,
      padding: "5px 12px",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      minHeight: 32
    }
  }, t("Oggi riposo"))), React.createElement("div", {
    style: {
      fontFamily: "var(--display)",
      fontSize: 28,
      fontWeight: 700,
      letterSpacing: "-0.02em",
      lineHeight: 1.05,
      margin: "3px 0 12px"
    }
  }, todaySession ? todaySession.label : t("Giorno di riposo")), todaySession ? React.createElement(React.Fragment, null, React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 14
    }
  }, todaySession.muscles.map(m => React.createElement(UIChip, {
    key: m
  }, t(m)))), React.createElement(UIButton, {
    onClick: startWorkout
  }, React.createElement(Icon, {
    name: "dumbbell",
    size: 17,
    strokeWidth: 1.9
  }), " ", t("Inizia allenamento"))) : React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--text-2)",
      lineHeight: 1.45
    }
  }, t("Recupero attivo, mobilità e idratazione."))), React.createElement(WeeklyReportCard, {
    onNav: onNav
  }), nextMeal ? React.createElement(UICard, {
    onClick: () => onNav("dieta")
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 11,
      flexShrink: 0,
      background: "var(--card-2)",
      border: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--text-2)"
    }
  }, React.createElement(Icon, {
    name: "fork",
    size: 17,
    strokeWidth: 1.8
  })), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    className: "ui-cap",
    style: {
      marginBottom: 2
    }
  }, nextMeal.upcoming ? t("Prossimo pasto") : t("Adesso")), React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, nextMeal.title), nextMeal.food ? React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--text-2)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, nextMeal.food) : null), React.createElement("span", {
    className: "tnum",
    style: {
      fontSize: 14,
      fontWeight: 700
    }
  }, nextMeal.time), React.createElement("span", {
    style: {
      color: "var(--text-3)",
      fontSize: 16,
      fontWeight: 600,
      marginLeft: 4
    }
  }, "›"))) : null, React.createElement(UICard, null, React.createElement("div", {
    className: "ui-cap",
    style: {
      marginBottom: 12
    }
  }, t("Check-in")), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, React.createElement(CheckScale, {
    label: t("Sonno"),
    value: checkIn.sleep,
    onChange: v => setCheckIn({
      ...checkIn,
      sleep: v
    })
  }), React.createElement(CheckScale, {
    label: t("Energia"),
    value: checkIn.energy,
    onChange: v => setCheckIn({
      ...checkIn,
      energy: v
    })
  })), React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, ailOpen ? React.createElement("input", {
    placeholder: t("es. spalla destra, ginocchio sinistro…"),
    value: checkIn.ailments,
    onChange: e => setCheckIn({
      ...checkIn,
      ailments: e.target.value
    }),
    className: "input",
    style: {
      background: "var(--card-2)",
      padding: "10px 12px",
      fontSize: 13,
      width: "100%"
    }
  }) : React.createElement("button", {
    onClick: () => setAilOpen(true),
    style: {
      background: "transparent",
      border: 0,
      color: "var(--text-2)",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      minHeight: 44,
      padding: 0
    }
  }, React.createElement(Icon, {
    name: "plus",
    size: 13,
    strokeWidth: 2.2
  }), " ", t("Fastidi")))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 12
    }
  }, React.createElement(UIStatTile, {
    cap: t("Peso"),
    value: React.createElement(UIAnimatedNumber, {
      value: latestWeight,
      decimals: 1
    }),
    unit: "kg",
    onClick: () => setPesoOpen(true)
  }, sparkData.length >= 2 ? React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, React.createElement(Sparkline, {
    data: sparkData,
    width: 140,
    height: 40,
    color: "var(--accent)"
  })) : React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 11,
      color: "var(--text-3)"
    }
  }, t("Registra il peso per almeno 2 giorni per vedere il trend.")))), React.createElement(MovimentoCard, {
    activities: activities,
    addActivity: addActivity,
    isDesktop: isDesktop
  }), React.createElement("div", {
    className: "ui-card"
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    }
  }, React.createElement("span", {
    className: "ui-cap"
  }, t("Settimana")), React.createElement("span", {
    className: "tnum",
    style: {
      fontSize: 12,
      color: "var(--text-2)"
    }
  }, React.createElement("span", {
    style: {
      color: "var(--text)",
      fontWeight: 700
    }
  }, weekGymDays), " / ", daysCount, " ", t("sessioni"))), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16
    }
  }, React.createElement(Anatomy, {
    active: ["petto", "spalle", "bicipiti", "quadricipiti", "schiena", "femorali"],
    height: isDesktop ? 200 : 160,
    color: "var(--accent)"
  }), React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, hasWeekMuscles ? [{
    k: "Petto"
  }, {
    k: "Schiena"
  }, {
    k: "Gambe"
  }, {
    k: "Spalle"
  }, {
    k: "Braccia"
  }, {
    k: "Core"
  }].filter(m => weekMuscles[m.k] > 0).map(m => React.createElement("div", {
    key: m.k
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 11.5,
      marginBottom: 3
    }
  }, React.createElement("span", {
    style: {
      color: "var(--text-2)"
    }
  }, t(m.k)), React.createElement("span", {
    className: "tnum",
    style: {
      fontWeight: 700
    }
  }, weekMuscles[m.k])), React.createElement(UIProgress, {
    value: Math.min(1, weekMuscles[m.k] / 16)
  }))) : React.createElement("div", {
    style: {
      color: "var(--text-2)",
      fontSize: 12,
      lineHeight: 1.45
    }
  }, t("Nessuna serie registrata questa settimana"))))), React.createElement(UISheet, {
    open: pesoOpen,
    onClose: () => setPesoOpen(false),
    title: t("Aggiorna peso")
  }, React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, React.createElement("input", {
    type: "number",
    inputMode: "decimal",
    placeholder: t("Aggiorna…"),
    value: newWeight,
    onChange: e => setNewWeight(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") {
        saveWeight();
        setPesoOpen(false);
      }
    },
    className: "input input-mono",
    style: {
      flex: 1,
      padding: "12px 14px",
      fontSize: 16
    }
  }), React.createElement(UIButton, {
    style: {
      width: "auto",
      padding: "0 22px"
    },
    onClick: () => {
      saveWeight();
      setPesoOpen(false);
    }
  }, t("Salva"))), weightDelta !== 0 ? React.createElement("div", {
    className: "tnum",
    style: {
      marginTop: 10,
      fontSize: 12,
      color: "var(--text-2)"
    }
  }, weightDelta > 0 ? "+" : "", weightDelta.toFixed(1), " kg ", t("negli ultimi 14 giorni")) : null));
};
window.Dashboard = Dashboard;
})();

// ══ screens/scheda.jsx ══
;(function () {
function _buildSchedule() {
  const sched = window.getSchedule ? window.getSchedule() : {
    days: []
  };
  const days = sched && sched.days || [];
  return days.map(d => ({
    ...d,
    exercises: (d.exercises || []).map(ex => ({
      ...ex,
      history: ex.history || []
    }))
  }));
}
function _todayK() {
  return window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
}
const TimerOverlay = ({
  seconds,
  onClose
}) => {
  const t = useT();
  const endRef = React.useRef(Date.now() + seconds * 1000);
  const [remaining, setRemaining] = React.useState(seconds);
  const beeped = React.useRef(false);
  React.useEffect(() => {
    const tick = () => {
      const r = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0 && !beeped.current) {
        beeped.current = true;
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        if (window.playBeep) {
          window.playBeep(880, 0.18);
          setTimeout(() => window.playBeep(880, 0.18), 220);
          setTimeout(() => window.playBeep(1100, 0.28), 440);
        }
      }
    };
    const tid = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(tid);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  React.useEffect(() => {
    let lock = null;
    let released = false;
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request("screen").then(l => {
        if (released) l.release().catch(() => {});else lock = l;
      }).catch(() => {});
    }
    return () => {
      released = true;
      if (lock) lock.release().catch(() => {});
    };
  }, []);
  const adjust = d => {
    endRef.current = Math.max(Date.now(), endRef.current + d * 1000);
    if (d > 0) beeped.current = false;
    setRemaining(Math.max(0, Math.round((endRef.current - Date.now()) / 1000)));
  };
  const total = seconds;
  const R = 86;
  const C = 2 * Math.PI * R;
  const dashOffset = C - C * Math.min(1, Math.max(0, remaining) / total);
  const done = remaining === 0;
  return React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(10,10,10,0.88)",
      backdropFilter: "blur(22px)",
      WebkitBackdropFilter: "blur(22px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      animation: "fadeUp 0.18s ease"
    },
    onClick: onClose
  }, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: "uppercase",
      marginBottom: 24,
      color: "#8e8e9a"
    }
  }, t("Recupero")), React.createElement("div", {
    style: {
      position: "relative",
      width: 220,
      height: 220
    }
  }, React.createElement("div", {
    className: "timer-pulse",
    style: {
      position: "absolute",
      inset: 0,
      borderRadius: "50%",
      background: done ? "radial-gradient(circle, rgba(48,209,88,0.4), transparent 70%)" : "radial-gradient(circle, rgba(10,132,255,0.4), transparent 70%)"
    }
  }), React.createElement("svg", {
    viewBox: "0 0 200 200",
    width: "220",
    height: "220",
    style: {
      position: "relative",
      transform: "rotate(-90deg)"
    }
  }, React.createElement("defs", null, React.createElement("linearGradient", {
    id: "timerGrad",
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1"
  }, React.createElement("stop", {
    offset: "0",
    stopColor: "#0A84FF"
  }), React.createElement("stop", {
    offset: "1",
    stopColor: "#5E5CE6"
  }))), React.createElement("circle", {
    cx: "100",
    cy: "100",
    r: R,
    stroke: "rgba(255,255,255,0.08)",
    strokeWidth: "8",
    fill: "none"
  }), React.createElement("circle", {
    cx: "100",
    cy: "100",
    r: R,
    stroke: done ? "var(--success)" : "url(#timerGrad)",
    strokeWidth: "8",
    fill: "none",
    strokeDasharray: C,
    strokeDashoffset: dashOffset,
    strokeLinecap: "round",
    style: {
      transition: "stroke-dashoffset 1s linear"
    }
  })), React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement("div", {
    className: "num",
    style: {
      fontSize: 56,
      fontWeight: 600,
      letterSpacing: -0.04,
      color: "#f2f2f7"
    }
  }, Math.floor(remaining / 60), ":", String(remaining % 60).padStart(2, "0")), React.createElement("div", {
    className: "muted tnum",
    style: {
      fontSize: 12,
      fontWeight: 500,
      color: "#8e8e9a"
    }
  }, t("di"), " ", Math.floor(total / 60), ":", String(total % 60).padStart(2, "0")))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: 28
    }
  }, React.createElement("button", {
    className: "btn",
    onClick: e => {
      e.stopPropagation();
      adjust(-15);
    }
  }, "−15s"), React.createElement("button", {
    className: "btn",
    onClick: e => {
      e.stopPropagation();
      adjust(15);
    }
  }, "+15s"), React.createElement("button", {
    className: "btn primary",
    onClick: e => {
      e.stopPropagation();
      onClose();
    }
  }, done ? t("Riprendi") : t("Salta"))), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 11.5,
      marginTop: 16,
      color: "#8e8e9a"
    }
  }, t("Tocca ovunque per chiudere")));
};
const SetRow = ({
  s,
  idx,
  completed,
  onToggle,
  peso,
  onPesoChange,
  isPR
}) => {
  const t = useT();
  return React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "26px 1.4fr 0.8fr 36px",
      gap: 10,
      alignItems: "center",
      padding: "8px 4px",
      borderTop: "1px solid var(--border)",
      transition: "background 0.16s",
      background: completed ? "rgba(48,209,88,0.04)" : "transparent"
    }
  }, React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 13,
      textAlign: "center",
      fontWeight: 600
    }
  }, idx + 1), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      position: "relative"
    }
  }, React.createElement("input", {
    type: "text",
    value: peso,
    onChange: e => onPesoChange(e.target.value),
    placeholder: t("kg o elastico"),
    className: "input",
    style: {
      padding: "6px 8px",
      fontSize: 14,
      fontWeight: 600,
      textAlign: "left",
      borderRadius: 7,
      width: "100%",
      borderColor: isPR ? "#FF9F0A" : "var(--border)",
      boxShadow: isPR ? "0 0 0 1px #FF9F0A" : "none",
      color: isPR ? "#FF9F0A" : "var(--text)"
    }
  }), isPR && React.createElement("span", {
    className: "pop-in",
    style: {
      position: "absolute",
      top: -6,
      right: 22,
      fontSize: 9,
      fontWeight: 700,
      color: "#FF9F0A",
      background: "rgba(255,159,10,0.15)",
      padding: "1px 5px",
      borderRadius: 4,
      letterSpacing: 0.5,
      pointerEvents: "none"
    }
  }, "⚡ PR")), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 14,
      fontWeight: 600,
      textAlign: "center"
    }
  }, s.rip), React.createElement("button", {
    onClick: ev => {
      if (!completed && window.Motion) window.Motion.pop(ev.currentTarget);
      onToggle();
    },
    className: `check ${completed ? "on" : ""}`,
    style: {
      width: 26,
      height: 26,
      justifySelf: "center"
    }
  }, React.createElement(Icon, {
    name: "check",
    size: 13,
    color: "#062810"
  })));
};
const HistoryPopover = ({
  history,
  onClose
}) => {
  const t = useT();
  if (!history || !history.length) return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: 12,
      marginBottom: 10,
      background: "var(--card-2)",
      borderRadius: 12,
      border: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      marginBottom: 4
    }
  }, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12
    }
  }, t("Nessuno storico disponibile")), React.createElement("button", {
    onClick: onClose,
    style: {
      background: "transparent",
      border: 0,
      color: "var(--text-2)",
      cursor: "pointer",
      padding: 0,
      display: "flex"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 13
  }))));
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: 10,
      marginBottom: 10,
      background: "var(--card-2)",
      borderRadius: 12,
      border: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Storico · ultime 3")), React.createElement("button", {
    onClick: onClose,
    style: {
      background: "transparent",
      border: 0,
      color: "var(--text-2)",
      cursor: "pointer",
      padding: 0,
      display: "flex"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 13
  }))), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 0.7fr",
      gap: 8,
      alignItems: "center",
      fontSize: 10.5,
      color: "var(--text-3)",
      textTransform: "uppercase",
      fontWeight: 600,
      letterSpacing: 0.4,
      padding: "0 2px 6px",
      borderBottom: "1px solid var(--border)"
    }
  }, React.createElement("div", null, t("Quando")), React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, t("Peso")), React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, t("Rip"))), history.slice(0, 3).map((h, i) => React.createElement("div", {
    key: i,
    style: {
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 0.7fr",
      gap: 8,
      alignItems: "center",
      padding: "7px 2px",
      borderTop: i > 0 ? "1px solid var(--border)" : 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 12,
      color: i === 0 ? "var(--text)" : "var(--text-2)",
      fontWeight: i === 0 ? 600 : 500
    }
  }, h.when || h.date), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 13,
      fontWeight: 600,
      textAlign: "right"
    }
  }, h.peso, " ", React.createElement("span", {
    style: {
      color: "var(--text-3)",
      fontSize: 10,
      fontWeight: 500
    }
  }, "kg")), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 12,
      textAlign: "center",
      color: "var(--text-2)"
    }
  }, h.rip))));
};
const SubstitutePopover = ({
  alternatives,
  current,
  original,
  onPick,
  onClose
}) => {
  const t = useT();
  const allAlts = alternatives || [];
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: 10,
      marginBottom: 10,
      background: "var(--card-2)",
      borderRadius: 12,
      border: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Sostituisci con")), React.createElement("button", {
    onClick: onClose,
    style: {
      background: "transparent",
      border: 0,
      color: "var(--text-2)",
      cursor: "pointer",
      padding: 0,
      display: "flex"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 13
  }))), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, current && React.createElement("button", {
    onClick: () => onPick(null),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 10px",
      border: 0,
      background: "transparent",
      borderRadius: 8,
      fontSize: 13,
      color: "var(--text-2)",
      cursor: "pointer",
      textAlign: "left"
    }
  }, React.createElement(Icon, {
    name: "refresh",
    size: 12
  }), " ", t("Ripristina originale")), allAlts.length === 0 && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13,
      padding: "6px 10px"
    }
  }, t("Nessuna alternativa disponibile")), allAlts.map(alt => {
    const on = current === alt;
    return React.createElement("button", {
      key: alt,
      onClick: () => onPick(alt),
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        border: 0,
        background: on ? "rgba(10,132,255,0.18)" : "transparent",
        borderRadius: 8,
        fontSize: 13,
        color: on ? "var(--accent)" : "var(--text)",
        fontWeight: on ? 600 : 500,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.14s"
      }
    }, React.createElement("span", null, t(alt)), on && React.createElement(Icon, {
      name: "check",
      size: 12,
      color: "var(--accent)"
    }));
  })));
};
const Confetti = () => {
  const colors = ["#0A84FF", "#5E5CE6", "#5AC8FA", "#30D158"];
  return React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
      overflow: "hidden",
      zIndex: 50
    }
  }, Array.from({
    length: 32
  }).map((_, i) => React.createElement("span", {
    key: i,
    className: "confetti",
    style: {
      background: colors[i % colors.length],
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 0.3}s`,
      animationDuration: `${1.4 + Math.random() * 0.6}s`,
      ["--cx"]: `${(Math.random() - 0.5) * 360}px`,
      borderRadius: Math.random() > 0.5 ? "50%" : "2px"
    }
  })));
};
const ExerciseCard = ({
  ex,
  completed,
  onToggleSet,
  onRest,
  occupied,
  onOccupied,
  isDesktop,
  substituted,
  onSubstitute,
  sheetsWeights,
  savedPesos,
  onPesosChange,
  exNote
}) => {
  const t = useT();
  const [pesos, setPesos] = React.useState(() => {
    if (savedPesos && savedPesos.length === ex.sets.length) return savedPesos.slice();
    return ex.sets.map((s, i) => {
      const key = ex.name.toLowerCase();
      if (sheetsWeights && sheetsWeights[key] && sheetsWeights[key][i] != null) {
        return String(sheetsWeights[key][i]);
      }
      return String(s.peso || "");
    });
  });
  const [showHistory, setShowHistory] = React.useState(false);
  const [showSubs, setShowSubs] = React.useState(false);
  React.useEffect(() => {
    if (savedPesos && savedPesos.length === ex.sets.length) return;
    const key = ex.name.toLowerCase();
    if (sheetsWeights && sheetsWeights[key]) {
      const updated = ex.sets.map((s, i) => {
        const w = sheetsWeights[key][i];
        return w != null ? String(w) : String(s.peso || "");
      });
      setPesos(updated);
      if (onPesosChange) onPesosChange(updated);
    }
  }, [sheetsWeights]);
  const handlePesoChange = (i, v) => {
    setPesos(p => {
      const n = [...p];
      n[i] = v;
      if (onPesosChange) onPesosChange(n);
      return n;
    });
  };
  const bestEver = React.useMemo(() => {
    if (!ex.history || !ex.history.length) return 0;
    return Math.max(...ex.history.map(h => Number(h.peso) || 0));
  }, [ex.history]);
  const doneCount = completed.filter(Boolean).length;
  const edge = doneCount > 0 && doneCount === ex.sets.length ? "var(--success)" : doneCount > 0 ? "var(--accent)" : "var(--border)";
  return React.createElement("div", {
    className: "card lift",
    style: {
      padding: isDesktop ? 22 : 16,
      opacity: occupied ? 0.55 : 1,
      transition: "opacity 0.2s",
      position: "relative",
      borderLeft: `3px solid ${edge}`
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 8
    }
  }, React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("button", {
    onClick: () => setShowHistory(s => !s),
    style: {
      background: "transparent",
      border: 0,
      padding: 0,
      cursor: "pointer",
      textAlign: "left",
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginBottom: 6,
      color: "var(--text)"
    }
  }, React.createElement("h3", {
    style: {
      fontSize: isDesktop ? 17 : 15.5,
      fontWeight: 600,
      letterSpacing: -0.015,
      lineHeight: 1.25
    }
  }, substituted ? t(substituted) : t(ex.name)), React.createElement(Icon, {
    name: "clock",
    size: 12,
    color: "var(--text-3)"
  })), substituted && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10.5,
      marginBottom: 4,
      textDecoration: "line-through"
    }
  }, t(ex.name)), React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      flexWrap: "wrap"
    }
  }, ex.muscles.map(m => React.createElement("span", {
    key: m,
    className: "pill",
    style: {
      fontSize: 11,
      padding: "3px 8px"
    }
  }, t(m))), ex.ripRange && React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10.5,
      padding: "3px 8px",
      color: "var(--text-3)"
    }
  }, ex.ripRange, " rip")), exNote && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 11.5,
      marginTop: 5,
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, React.createElement("span", null, "📝"), React.createElement("span", {
    style: {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, exNote))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      flexShrink: 0
    }
  }, React.createElement("button", {
    className: "btn ghost",
    title: t("Sostituisci"),
    style: {
      padding: "6px 8px",
      background: showSubs ? "rgba(10,132,255,0.18)" : "var(--card-2)",
      color: showSubs ? "var(--accent)" : "var(--text-2)"
    },
    onClick: () => setShowSubs(s => !s)
  }, React.createElement(Icon, {
    name: "refresh",
    size: 13
  })), React.createElement("button", {
    className: "btn ghost",
    title: occupied ? t("Macchina libera — clicca per sbloccare") : t("Macchina occupata — clicca per segnalare"),
    style: {
      padding: "6px 8px",
      background: occupied ? "rgba(255,159,10,0.22)" : "var(--card-2)",
      color: occupied ? "#FF9F0A" : "var(--text-2)",
      boxShadow: occupied ? "inset 0 0 0 1.5px #FF9F0A" : "none",
      fontSize: 12,
      fontWeight: 600
    },
    onClick: onOccupied
  }, occupied ? "🔴 Occ." : "🟢"))), showHistory && React.createElement(HistoryPopover, {
    history: ex.history,
    onClose: () => setShowHistory(false)
  }), showSubs && React.createElement(SubstitutePopover, {
    alternatives: ex.alternatives,
    current: substituted,
    original: ex.name,
    onPick: name => {
      onSubstitute(name);
      setShowSubs(false);
    },
    onClose: () => setShowSubs(false)
  }), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "26px 1.4fr 0.8fr 36px",
      gap: 10,
      alignItems: "center",
      padding: "8px 4px 4px",
      fontSize: 10,
      letterSpacing: 0.6,
      fontWeight: 600,
      color: "var(--text-3)",
      textTransform: "uppercase"
    }
  }, React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, t("Set")), React.createElement("div", {
    style: {
      textAlign: "right",
      paddingRight: 18
    }
  }, t("Peso")), React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, t("Rip")), React.createElement("div", null)), ex.sets.map((s, i) => {
    const cur = parseFloat(pesos[i]);
    const isPR = !!cur && bestEver > 0 && cur > bestEver;
    return React.createElement(SetRow, {
      key: i,
      s: s,
      idx: i,
      completed: completed[i],
      onToggle: () => onToggleSet(i),
      peso: pesos[i],
      onPesoChange: v => handlePesoChange(i, v),
      isPR: isPR
    });
  }), React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 14,
      paddingTop: 12,
      borderTop: "1px solid var(--border)"
    }
  }, React.createElement("button", {
    className: "btn tnum",
    style: {
      padding: "7px 14px",
      fontSize: 13,
      background: "rgba(10,132,255,0.14)",
      borderColor: "transparent",
      color: "var(--accent)"
    },
    onClick: () => onRest(ex.rest)
  }, React.createElement(Icon, {
    name: "clock",
    size: 13
  }), " ", ex.rest, "s"), React.createElement("span", {
    className: "muted tnum",
    style: {
      fontSize: 12
    }
  }, React.createElement("span", {
    className: "num",
    style: {
      color: "var(--text)",
      fontWeight: 600
    }
  }, completed.filter(Boolean).length), " ", "/", ex.sets.length, " ", t("serie"))), occupied && React.createElement("div", {
    style: {
      marginTop: 10,
      padding: "8px 12px",
      borderRadius: 10,
      background: "rgba(255,159,10,0.12)",
      border: "1px solid rgba(255,159,10,0.3)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 13,
      fontWeight: 500,
      color: "#FF9F0A"
    }
  }, React.createElement("span", null, "🔴"), React.createElement("span", null, t("Macchina occupata — attendi o sostituisci con ↻"))));
};
const ExNoteRow = ({
  name,
  note,
  onSave
}) => {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(note || "");
  React.useEffect(() => {
    setVal(note || "");
    setEditing(false);
  }, [name]);
  const commit = () => {
    onSave(name, val.trim());
    setEditing(false);
  };
  if (editing) {
    return React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        width: "100%",
        maxWidth: 340
      }
    }, React.createElement("input", {
      autoFocus: true,
      value: val,
      onChange: e => setVal(e.target.value),
      onKeyDown: e => {
        if (e.key === "Enter") commit();
      },
      onBlur: commit,
      placeholder: t("es. sedile 4, presa media…"),
      className: "input",
      style: {
        flex: 1,
        fontSize: 13,
        padding: "8px 10px"
      }
    }));
  }
  return React.createElement("button", {
    onClick: () => setEditing(true),
    style: {
      background: "transparent",
      border: 0,
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12.5,
      color: note ? "var(--text-2)" : "var(--text-3)",
      padding: "4px 8px",
      maxWidth: 340
    },
    title: t("Nota setup (macchina, sedile, presa…)")
  }, React.createElement("span", {
    style: {
      flexShrink: 0
    }
  }, "📝"), React.createElement("span", {
    style: {
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, note || t("Aggiungi nota setup")));
};
const SessionSummaryOverlay = ({
  data,
  onClose
}) => {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  if (!data) return null;
  const deltaTon = data.prevTonnage != null && data.prevTonnage > 0 ? Math.round((data.tonnage - data.prevTonnage) / data.prevTonnage * 100) : null;
  const share = async () => {
    const lines = [`💪 ${t("Sessione completata")} — ${new Date().toLocaleDateString()}`, `${data.exCount} ${t("esercizi")} · ${data.setsDone} ${t("serie")}` + (data.durationMin != null ? ` · ${data.durationMin}′` : "") + (data.tonnage ? ` · ${data.tonnage} kg ${t("Tonnellaggio").toLowerCase()}` : "")];
    if (deltaTon != null) lines.push(`${t("vs precedente")}: ${deltaTon > 0 ? "+" : ""}${deltaTon}%`);
    if (data.prs && data.prs.length) {
      lines.push(`🏆 ${data.prs.map(p => `${p.esercizio} ${p.peso} kg`).join(" · ")}`);
    }
    const text = lines.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({
          text
        });
        return;
      }
      throw new Error("no-share");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (_) {}
    }
  };
  const stat = (label, value, sub) => React.createElement("div", {
    className: "card",
    style: {
      padding: "14px 12px",
      textAlign: "center"
    }
  }, React.createElement("div", {
    className: "num",
    style: {
      fontSize: 22,
      fontWeight: 700
    }
  }, value), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10.5,
      marginTop: 3,
      textTransform: "uppercase",
      letterSpacing: 0.4
    }
  }, label), sub && React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 11,
      marginTop: 2,
      color: "var(--text-2)"
    }
  }, sub));
  return React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9992,
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      padding: "max(env(safe-area-inset-top), 20px) 20px calc(env(safe-area-inset-bottom) + 20px)",
      overflowY: "auto"
    }
  }, React.createElement("div", {
    style: {
      textAlign: "center",
      margin: "18px 0 6px",
      fontSize: 40
    }
  }, "💪"), React.createElement("h2", {
    style: {
      textAlign: "center",
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: -0.02
    }
  }, t("Sessione completata")), React.createElement("div", {
    className: "muted",
    style: {
      textAlign: "center",
      fontSize: 13,
      marginTop: 4,
      marginBottom: 18
    }
  }, data.exCount, " ", t("esercizi"), " · ", data.setsDone, " ", t("serie")), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 10,
      marginBottom: 14
    }
  }, stat(t("Durata"), data.durationMin != null ? `${data.durationMin}′` : "—"), stat(t("Tonnellaggio"), data.tonnage ? `${data.tonnage}` : "—", data.tonnage ? "kg" : null), stat(t("Serie"), data.setsDone), stat(t("vs precedente"), deltaTon != null ? `${deltaTon > 0 ? "+" : ""}${deltaTon}%` : "—", data.prevTonnage != null ? `${t("prima")}: ${data.prevTonnage} kg` : null)), data.prs && data.prs.length > 0 && React.createElement("div", {
    className: "card",
    style: {
      padding: 14,
      marginBottom: 14,
      border: "1px solid rgba(48,209,88,0.4)"
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: "var(--success)",
      marginBottom: 6
    }
  }, "🏆 ", data.prs.length === 1 ? t("Nuovo record!") : `${data.prs.length} ${t("nuovi record!")}`), React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 12.5,
      color: "var(--text-2)"
    }
  }, data.prs.map(p => `${t(p.esercizio)} ${p.peso} kg`).join(" · "))), data.perExercise && data.perExercise.length > 0 && React.createElement("div", {
    className: "card",
    style: {
      padding: "6px 14px",
      marginBottom: 16
    }
  }, data.perExercise.map((e, i) => React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 0",
      borderTop: i > 0 ? "1px solid var(--border)" : 0
    }
  }, React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 13.5,
      fontWeight: 500,
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, t(e.name)), e.top != null && React.createElement("div", {
    className: "num",
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, e.top, " kg"), e.delta != null && React.createElement("span", {
    className: "tnum",
    style: {
      fontSize: 11.5,
      fontWeight: 700,
      borderRadius: 999,
      padding: "2px 8px",
      background: e.delta > 0 ? "rgba(48,209,88,0.15)" : e.delta < 0 ? "rgba(255,159,10,0.15)" : "var(--card-2)",
      color: e.delta > 0 ? "var(--success)" : e.delta < 0 ? "#FF9F0A" : "var(--text-3)"
    }
  }, e.delta > 0 ? `↑ +${e.delta}` : e.delta < 0 ? `↓ ${e.delta}` : "=")))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: "auto"
    }
  }, React.createElement("button", {
    className: "btn",
    style: {
      flex: 1,
      padding: 15,
      fontSize: 15,
      fontWeight: 600
    },
    onClick: share
  }, copied ? "✓ " + t("Copiato") : t("Condividi")), React.createElement("button", {
    className: "btn primary",
    style: {
      flex: 2,
      padding: 15,
      fontSize: 16,
      fontWeight: 600
    },
    onClick: onClose
  }, t("Fatto"))));
};
const WorkoutPlayer = ({
  dayKey,
  dayName,
  exercises,
  cursor,
  setCursor,
  completion,
  substitutions,
  pesosRef,
  sheetsWeights,
  prMap,
  pesiHistory,
  deload,
  exNotes,
  onSaveNote,
  autoRest,
  setAutoRest,
  onPatch,
  onClose,
  onFinish
}) => {
  const t = useT();
  const [showSubs, setShowSubs] = React.useState(false);
  const [restSecs, setRestSecs] = React.useState(null);
  const ex = exercises[cursor];
  if (!ex || !ex.sets || !ex.sets.length) return null;
  const id = window.exId(dayKey, cursor);
  const done = completion[id] || new Array(ex.sets.length).fill(false);
  const rawIdx = done.findIndex(x => !x);
  const curSet = rawIdx === -1 ? Math.max(0, ex.sets.length - 1) : rawIdx;
  const allSetsDone = done.length > 0 && done.every(Boolean);
  const savedP = pesosRef.current[id];
  const pesoVal = savedP && savedP[curSet] != null ? savedP[curSet] : (() => {
    const k = ex ? ex.name.toLowerCase() : "";
    if (sheetsWeights && sheetsWeights[k] && sheetsWeights[k][curSet] != null) return String(sheetsWeights[k][curSet]);
    return String(ex && ex.sets[curSet] ? ex.sets[curSet].peso || "" : "");
  })();
  const setPeso = v => {
    const arr = (pesosRef.current[id] || ex.sets.map(s => String(s.peso || ""))).slice();
    arr[curSet] = v;
    pesosRef.current[id] = arr;
    onPatch({
      pesos: {
        [id]: arr
      }
    });
  };
  const advance = () => {
    if (cursor < exercises.length - 1) setCursor(cursor + 1);else onFinish();
  };
  const serieFatta = () => {
    if (navigator.vibrate) navigator.vibrate([100]);
    const arr = [...done];
    arr[curSet] = true;
    onPatch({
      completion: {
        [id]: arr
      }
    });
    const nowAllDone = arr.every(Boolean);
    if (autoRest && !nowAllDone) setRestSecs(ex.rest || 90);else if (nowAllDone) setTimeout(advance, 250);
  };
  const label = substitutions[id] ? t(substitutions[id]) : t(ex.name);
  const next = exercises[cursor + 1];
  const exName = substitutions[id] || ex.name;
  const WP = window.WorkoutProgress;
  const lastRaw = (() => {
    const k = (exName || "").toLowerCase(),
      ko = (ex.name || "").toLowerCase();
    const row = sheetsWeights && (sheetsWeights[k] || sheetsWeights[ko]);
    if (row && row[curSet] != null) return String(row[curSet]);
    if (ex.history && ex.history.length) return String(ex.history[0].peso);
    return null;
  })();
  const sug = WP ? WP.suggestNext(lastRaw) : null;
  const prBest = WP ? WP.bestFor(prMap || {}, exName) : null;
  const curNum = WP ? WP.parseWeight(pesoVal) : null;
  const isPR = prBest != null && curNum != null && curNum > prBest;
  const isDeload = !!(deload && deload.deload);
  const deloadW = isDeload && window.Insights ? window.Insights.deloadWeight(lastRaw) : null;
  const exHistory = React.useMemo(() => {
    if (!window.Insights || !pesiHistory) return [];
    return window.Insights.exerciseSessions(pesiHistory, exName, 3);
  }, [pesiHistory, exName]);
  const exNote = (exNotes || {})[(exName || "").toLowerCase()];
  return React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 9990,
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      padding: "max(env(safe-area-inset-top), 20px) 20px calc(env(safe-area-inset-bottom) + 20px)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8
    }
  }, React.createElement("button", {
    className: "btn ghost",
    style: {
      padding: "8px 10px"
    },
    title: t("Esci dal player"),
    onClick: onClose
  }, React.createElement(Icon, {
    name: "x",
    size: 16
  })), React.createElement("div", {
    className: "muted tnum",
    style: {
      fontSize: 12,
      fontWeight: 600
    }
  }, dayName, " · ", cursor + 1, "/", exercises.length), React.createElement("button", {
    className: "btn ghost",
    style: {
      padding: "8px 10px",
      background: showSubs ? "rgba(10,132,255,0.18)" : "var(--card-2)"
    },
    onClick: () => setShowSubs(s => !s)
  }, React.createElement(Icon, {
    name: "refresh",
    size: 16
  }))), showSubs && React.createElement(SubstitutePopover, {
    alternatives: ex.alternatives,
    current: substitutions[id],
    original: ex.name,
    onPick: name => {
      onPatch({
        substitutions: {
          [id]: name
        }
      });
      setShowSubs(false);
    },
    onClose: () => setShowSubs(false)
  }), React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      textAlign: "center",
      gap: 10
    }
  }, React.createElement("div", {
    className: "muted tnum",
    style: {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: "uppercase"
    }
  }, t("Serie {n} di {m}").replace("{n}", curSet + 1).replace("{m}", ex.sets.length)), React.createElement("h2", {
    style: {
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: -0.02,
      maxWidth: 340
    }
  }, label), substitutions[id] && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12,
      textDecoration: "line-through",
      marginTop: -4
    }
  }, t(ex.name)), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 10,
      marginTop: 8
    }
  }, React.createElement("input", {
    type: "text",
    value: pesoVal,
    onChange: e => setPeso(e.target.value),
    placeholder: t("kg o elastico"),
    className: "input num",
    style: {
      width: 150,
      textAlign: "center",
      fontSize: 40,
      fontWeight: 700,
      padding: "8px 10px",
      borderRadius: 14
    }
  }), React.createElement("span", {
    className: "num",
    style: {
      fontSize: 22,
      fontWeight: 600,
      color: "var(--text-2)"
    }
  }, "× ", ex.sets[curSet].rip)), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 7,
      marginTop: 4
    }
  }, React.createElement("div", {
    className: "muted tnum",
    style: {
      fontSize: 12.5
    }
  }, lastRaw != null ? `${t("L'ultima volta")}: ${lastRaw} kg` : t("Nessuno storico"), prBest != null ? ` · ${t("record")} ${prBest} kg` : ""), isPR ? React.createElement("span", {
    className: "tnum",
    style: {
      fontSize: 12.5,
      fontWeight: 700,
      color: "var(--success)",
      background: "rgba(48,209,88,0.15)",
      borderRadius: 999,
      padding: "5px 12px"
    }
  }, "🏆 ", t("Nuovo record!")) : isDeload ? deloadW != null ? React.createElement("button", {
    onClick: () => setPeso(String(deloadW)),
    className: "pressable tnum",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 12.5,
      fontWeight: 600,
      color: "#FF9F0A",
      background: "rgba(255,159,10,0.14)",
      border: "1px solid rgba(255,159,10,0.3)",
      borderRadius: 999,
      padding: "6px 12px",
      cursor: "pointer"
    },
    title: t("Recupero incompleto — oggi meglio scaricare")
  }, "🪫 ", t("Scarico"), ": ", t("prova"), " ", deloadW, " kg") : React.createElement("span", {
    className: "tnum",
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      color: "#FF9F0A",
      background: "rgba(255,159,10,0.14)",
      borderRadius: 999,
      padding: "5px 12px"
    }
  }, "🪫 ", t("Seduta scarica consigliata")) : sug ? React.createElement("button", {
    onClick: () => setPeso(String(sug.next)),
    className: "pressable tnum",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--accent)",
      background: "rgba(10,132,255,0.14)",
      border: "1px solid var(--border)",
      borderRadius: 999,
      padding: "6px 12px",
      cursor: "pointer"
    },
    title: t("Progressione: tocca per applicare")
  }, "↑ ", t("prova"), " ", sug.next, " kg") : null), React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 10
    }
  }, done.map((d, i) => React.createElement("span", {
    key: i,
    style: {
      width: 9,
      height: 9,
      borderRadius: "50%",
      background: d ? "var(--success)" : i === curSet ? "var(--accent)" : "var(--track)"
    }
  }))), exHistory.length > 0 && React.createElement("div", {
    className: "card",
    style: {
      width: "100%",
      maxWidth: 340,
      padding: "10px 14px",
      marginTop: 10,
      textAlign: "left"
    }
  }, React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 6
    }
  }, t("Ultime sessioni")), exHistory.map((h, i) => React.createElement("div", {
    key: h.date,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "5px 0",
      borderTop: i > 0 ? "1px solid var(--border)" : 0
    }
  }, React.createElement("span", {
    className: "num muted",
    style: {
      fontSize: 11.5,
      width: 40,
      flexShrink: 0
    }
  }, h.date.slice(5).replace("-", "/")), React.createElement("span", {
    className: "tnum",
    style: {
      flex: 1,
      fontSize: 12,
      color: "var(--text-2)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, h.sets.map(s => `${s.peso}×${s.rip}`).join(" · ")), h.top != null && React.createElement("span", {
    className: "num",
    style: {
      fontSize: 12,
      fontWeight: 700,
      flexShrink: 0
    }
  }, h.top)))), React.createElement(ExNoteRow, {
    name: exName,
    note: exNote,
    onSave: onSaveNote
  })), next && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12.5,
      textAlign: "center",
      marginBottom: 10
    }
  }, t("Dopo"), ": ", substitutions[window.exId(dayKey, cursor + 1)] ? t(substitutions[window.exId(dayKey, cursor + 1)]) : t(next.name)), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, React.createElement("button", {
    className: "btn primary",
    style: {
      width: "100%",
      padding: 16,
      fontSize: 16,
      fontWeight: 600
    },
    onClick: ev => {
      if (window.Motion) window.Motion.pop(ev.currentTarget);
      serieFatta();
    }
  }, React.createElement(Icon, {
    name: "check",
    size: 17,
    color: "#fff"
  }), " ", allSetsDone ? t("Dopo") : t("Serie fatta")), React.createElement("label", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      fontSize: 12.5,
      color: "var(--text-2)"
    }
  }, React.createElement("input", {
    type: "checkbox",
    checked: autoRest,
    onChange: e => setAutoRest(e.target.checked)
  }), t("Auto-recupero"), " (", ex.rest || 90, "s)")), restSecs != null && React.createElement(TimerOverlay, {
    seconds: restSecs,
    onClose: () => setRestSecs(null)
  }));
};
const Scheda = ({
  device,
  scheda,
  setScheda,
  checkIn
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [days] = React.useState(() => _buildSchedule());
  const current = days.find(d => d.key === scheda) || days[0] || {
    key: "",
    num: 0,
    name: "",
    focus: [],
    exercises: []
  };
  const [prog, setProg] = React.useState(() => window.readSchedaProg(window.storage, _todayK()));
  const completion = prog.completion;
  const substitutions = prog.substitutions;
  const [timer, setTimer] = React.useState(null);
  const [occupied, setOccupied] = React.useState({});
  const [showConfetti, setShowConfetti] = React.useState(false);
  const [notes, setNotes] = React.useState(() => window.storage ? window.storage.get(`notes_${_todayK()}`, "") : "");
  const [sheetsWeights, setSheetsWeights] = React.useState(null);
  const [pesiHistory, setPesiHistory] = React.useState(null);
  const [exNotes, setExNotes] = React.useState(() => window.storage ? window.storage.get("exNotes", {}) : {});
  const exNotesPushTid = React.useRef(null);
  const [summary, setSummary] = React.useState(null);
  const [prMap, setPrMap] = React.useState(() => window.storage ? window.storage.get("prMap", {}) : {});
  const [newPRs, setNewPRs] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const prevDoneRef = React.useRef(null);
  const pesosRef = React.useRef(null);
  if (pesosRef.current === null) pesosRef.current = Object.assign({}, prog.pesos);
  const [mode, setMode] = React.useState("list");
  const [cursor, setCursor] = React.useState(0);
  const [autoRest, setAutoRest] = React.useState(true);
  React.useEffect(() => {
    if (window._schedaIntent === "player") {
      window._schedaIntent = null;
      setCursor(0);
      setMode("player");
    }
  }, []);
  const patchProg = patch => {
    if (patch.completion && window.storage) {
      const k = `gymStart_${_todayK()}`;
      if (!window.storage.get(k, null) && Object.values(patch.completion).some(arr => (arr || []).some(Boolean))) {
        window.storage.set(k, Date.now());
      }
    }
    window.writeSchedaProg(window.storage, _todayK(), patch);
    setProg(p => ({
      completion: Object.assign({}, p.completion, patch.completion),
      substitutions: Object.assign({}, p.substitutions, patch.substitutions),
      pesos: Object.assign({}, p.pesos, patch.pesos)
    }));
  };
  const saveExNote = (name, text) => {
    const key = (name || "").toLowerCase();
    if (!key) return;
    setExNotes(prev => {
      const next = Object.assign({}, prev);
      if (text) next[key] = text;else delete next[key];
      if (window.storage) window.storage.set("exNotes", next);
      clearTimeout(exNotesPushTid.current);
      exNotesPushTid.current = setTimeout(() => {
        if (window._saveSettingRetry) window._saveSettingRetry("exNotes", JSON.stringify(next));
      }, 1500);
      return next;
    });
  };
  const deload = React.useMemo(() => {
    if (!window.Insights) return {
      deload: false,
      reason: null
    };
    const list = [checkIn];
    if (window.storage) {
      for (let i = 1; i <= 2; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        list.push(window.storage.get(`checkIn_${k}`, null));
      }
    }
    return window.Insights.deloadAdvice(list);
  }, [checkIn]);
  const switchTo = k => {
    setScheda(k);
    if (window.storage) window.storage.set("schedaSelectedDay", k);
    const exs = (days.find(d => d.key === k) || {}).exercises || [];
    const tot = exs.reduce((n, ex) => n + ex.sets.length, 0);
    const done = exs.reduce((n, ex, i) => n + (completion[window.exId(k, i)] || []).filter(Boolean).length, 0);
    setOccupied({});
    prevDoneRef.current = tot > 0 && done === tot;
  };
  React.useEffect(() => {
    if (!window.sheetsAPI) return;
    window.sheetsAPI.getUltimiPesi().then(data => {
      if (!data || typeof data !== "object") return;
      setSheetsWeights(data);
    }).catch(() => {});
    window.sheetsAPI.getPesi().then(data => {
      if (!data || typeof data !== "object") return;
      setPesiHistory(data);
    }).catch(() => {});
  }, []);
  React.useEffect(() => {
    const saved = window.storage ? window.storage.get("schedaSelectedDay", null) : null;
    const target = days.find(d => d.key === saved) || days[0];
    if (target && target.key !== scheda) switchTo(target.key);else if (target && window.storage) window.storage.set("schedaSelectedDay", target.key);
  }, []);
  const exercises = current.exercises || [];
  const totalSets = exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const completedSets = exercises.reduce((n, ex, i) => n + (completion[window.exId(scheda, i)] || []).filter(Boolean).length, 0);
  const pct = totalSets ? completedSets / totalSets * 100 : 0;
  const allDone = completedSets > 0 && completedSets === totalSets;
  if (prevDoneRef.current === null) prevDoneRef.current = allDone;
  React.useEffect(() => {
    if (allDone && !prevDoneRef.current) {
      prevDoneRef.current = true;
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      setShowConfetti(true);
      const tid = setTimeout(() => setShowConfetti(false), 2200);
      return () => clearTimeout(tid);
    }
    if (!allDone) prevDoneRef.current = false;
  }, [allDone]);
  const toggleSet = (exIdx, setIdx) => {
    if (navigator.vibrate) navigator.vibrate([100]);
    const id = window.exId(scheda, exIdx);
    const arr = [...(completion[id] || new Array(exercises[exIdx].sets.length).fill(false))];
    const wasCompleted = arr[setIdx];
    arr[setIdx] = !arr[setIdx];
    patchProg({
      completion: {
        [id]: arr
      }
    });
    if (!wasCompleted) {
      const restSecs = exercises[exIdx]?.rest || 90;
      setTimeout(() => setTimer(restSecs), 50);
    }
  };
  const handleSaveSession = async () => {
    if (saving) return;
    setSaving(true);
    let sessionPRs = [];
    try {
      const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
      if (window.storage) window.storage.set(`notes_${today}`, notes);
      if (window.storage) {
        window.storage.set(`gym_${today}`, true);
        const GROUP = {
          petto: "Petto",
          schiena: "Schiena",
          spalle: "Spalle",
          trapezi: "Spalle",
          quadricipiti: "Gambe",
          femorali: "Gambe",
          glutei: "Gambe",
          polpacci: "Gambe",
          bicipiti: "Braccia",
          tricipiti: "Braccia",
          addome: "Core"
        };
        const daily = {};
        exercises.forEach((ex, exIdx) => {
          const done = (completion[window.exId(scheda, exIdx)] || []).filter(Boolean).length;
          if (!done) return;
          const g = GROUP[ex.muscles && ex.muscles[0] || ""] || "Altro";
          daily[g] = (daily[g] || 0) + done;
        });
        window.storage.set(`muscleSets_${today}`, daily);
        if (window.WorkoutProgress) {
          const doneSets = [];
          exercises.forEach((ex, exIdx) => {
            const id = window.exId(scheda, exIdx);
            const exComp = completion[id] || [];
            const exName = substitutions[id] || ex.name;
            const exPesos = pesosRef.current[id] || ex.sets.map(s => String(s.peso));
            ex.sets.forEach((s, setIdx) => {
              if (!exComp[setIdx]) return;
              const raw = exPesos[setIdx];
              doneSets.push({
                esercizio: exName,
                peso: raw != null && String(raw).trim() !== "" ? raw : s.peso,
                date: today
              });
            });
          });
          const res = window.WorkoutProgress.applySession(prMap, doneSets);
          if (res.newPRs.length) {
            window.storage.set("prMap", res.prMap);
            setPrMap(res.prMap);
            sessionPRs = res.newPRs;
            setNewPRs(res.newPRs);
            if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 80]);
            setTimeout(() => setNewPRs([]), 5000);
          }
        }
      }
      if (window.Insights) {
        const startTs = window.storage ? window.storage.get(`gymStart_${today}`, null) : null;
        const s = window.Insights.sessionSummary({
          exercises,
          dayKey: scheda,
          completion,
          substitutions,
          pesos: pesosRef.current,
          exIdFn: window.exId,
          startTs,
          endTs: Date.now(),
          pesiMap: pesiHistory || {}
        });
        setSummary(Object.assign({}, s, {
          prs: sessionPRs
        }));
      }
      let queuedOffline = false;
      if (window.sheetsAPI) {
        const sessRes = await window.sheetsAPI.saveSessione({
          date: today,
          type: scheda,
          setsCompleted: completedSets,
          totalSets,
          notes
        });
        queuedOffline = !!(sessRes && sessRes.queued);
        const savePromises = [];
        exercises.forEach((ex, exIdx) => {
          const id = window.exId(scheda, exIdx);
          const exCompletion = completion[id] || [];
          const exName = substitutions[id] || ex.name;
          const exPesos = pesosRef.current[id] || ex.sets.map(s => String(s.peso));
          ex.sets.forEach((s, setIdx) => {
            if (!exCompletion[setIdx]) return;
            const raw = exPesos[setIdx];
            const peso = raw != null && String(raw).trim() !== "" ? raw : s.peso;
            savePromises.push(window.sheetsAPI.savePeso({
              date: today,
              esercizio: exName,
              setN: setIdx + 1,
              peso,
              rip: s.rip,
              sessione: current.name || scheda
            }));
          });
        });
        await Promise.allSettled(savePromises);
      }
      setSaveMsg("✓ " + (queuedOffline ? t("Sessione salvata — sync quando torni online") : t("Sessione salvata")));
    } catch (err) {
      setSaveMsg("⚠️ " + (err.message || t("Errore salvataggio")));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };
  return React.createElement("div", {
    style: {
      padding: isDesktop ? "32px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? 18 : 14,
      position: "relative"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start"
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Allenamento")), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 28 : 24,
      fontWeight: 600
    }
  }, t("Scheda")))), checkIn && (checkIn.sleep <= 2 || checkIn.energy <= 2) && React.createElement("div", {
    className: "fade-up",
    style: {
      padding: "10px 14px",
      borderRadius: 12,
      background: "rgba(255,159,10,0.12)",
      border: "1px solid rgba(255,159,10,0.25)",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13
    }
  }, React.createElement("span", {
    style: {
      fontSize: 16
    }
  }, "⚠️"), React.createElement("span", null, checkIn.sleep <= 2 ? t("Sonno scarso — riduci l'intensità oggi") : t("Energia bassa — ascolta il corpo oggi"))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      background: "var(--card-2)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 4,
      overflowX: "auto"
    }
  }, days.map(d => {
    const on = d.key === scheda;
    return React.createElement("button", {
      key: d.key,
      onClick: () => switchTo(d.key),
      style: {
        flex: 1,
        minWidth: 54,
        border: "none",
        cursor: "pointer",
        borderRadius: 9,
        padding: "9px 4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        background: on ? "var(--card)" : "transparent",
        color: on ? "var(--text)" : "var(--text-2)",
        boxShadow: on ? "0 1px 4px rgba(0,0,0,.25)" : "none",
        transition: "background .16s, color .16s"
      }
    }, React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 600
      }
    }, "G" + d.num), React.createElement("span", {
      style: {
        fontSize: 9,
        lineHeight: 1,
        opacity: 0.7,
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, d.name));
  })), React.createElement("button", {
    className: "btn primary",
    style: {
      width: "100%",
      padding: 13,
      fontSize: 15,
      fontWeight: 600
    },
    onClick: () => {
      setCursor(0);
      setMode("player");
    }
  }, React.createElement(Icon, {
    name: "check",
    size: 16,
    color: "#fff"
  }), " ", t("Inizia allenamento")), React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "baseline",
      gap: 8,
      padding: "0 2px"
    }
  }, React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 15
    }
  }, t("Giorno"), " ", current.num, " · ", current.name), (current.focus || []).map(f => React.createElement(UIChip, {
    key: f
  }, f))), React.createElement("div", {
    className: "card",
    style: {
      padding: "12px 16px"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 8
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500
    }
  }, React.createElement("span", {
    className: "num",
    style: {
      fontWeight: 600,
      fontSize: 16
    }
  }, completedSets), React.createElement("span", {
    className: "muted tnum"
  }, "/", totalSets, " ", t("serie completate"))), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: allDone ? "var(--success)" : "var(--accent)"
    }
  }, Math.round(pct), "%")), React.createElement("div", {
    className: "bar"
  }, React.createElement("i", {
    style: {
      width: `${pct}%`,
      background: allDone ? "var(--success)" : "var(--accent)"
    }
  }))), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr",
      gap: isDesktop ? 18 : 12
    }
  }, exercises.map((ex, i) => {
    const id = window.exId(scheda, i);
    return React.createElement(ExerciseCard, {
      key: id,
      ex: ex,
      isDesktop: isDesktop,
      completed: completion[id] || new Array(ex.sets.length).fill(false),
      onToggleSet: j => toggleSet(i, j),
      onRest: s => setTimer(s),
      occupied: occupied[id],
      onOccupied: () => setOccupied(o => ({
        ...o,
        [id]: !o[id]
      })),
      substituted: substitutions[id],
      onSubstitute: name => patchProg({
        substitutions: {
          [id]: name
        }
      }),
      sheetsWeights: sheetsWeights,
      exNote: exNotes[(substitutions[id] || ex.name || "").toLowerCase()],
      savedPesos: pesosRef.current[id],
      onPesosChange: pesos => {
        pesosRef.current[id] = pesos;
        patchProg({
          pesos: {
            [id]: pesos
          }
        });
      }
    });
  })), React.createElement("div", {
    className: "card lift",
    style: {
      padding: isDesktop ? 18 : 14
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 10
    }
  }, React.createElement(Icon, {
    name: "doc",
    size: 14,
    color: "var(--text-2)"
  }), React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600
    }
  }, t("Note di oggi")), notes.length > 0 && React.createElement("span", {
    className: "num muted",
    style: {
      fontSize: 11,
      marginLeft: "auto"
    }
  }, notes.length)), React.createElement("textarea", {
    value: notes,
    onChange: e => setNotes(e.target.value),
    placeholder: t("Sensazioni, fastidi, dettagli da ricordare… il coach AI le leggerà."),
    rows: 3,
    style: {
      width: "100%",
      background: "var(--card-2)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      borderRadius: 11,
      padding: "10px 12px",
      fontSize: 13.5,
      lineHeight: 1.45,
      fontFamily: "inherit",
      outline: "none",
      resize: "vertical",
      minHeight: 60
    }
  })), React.createElement("button", {
    className: `btn ${allDone ? "success" : "primary"}`,
    disabled: saving || completedSets === 0,
    onClick: handleSaveSession,
    style: {
      width: "100%",
      padding: "14px",
      fontSize: 15,
      fontWeight: 600,
      opacity: completedSets > 0 ? 1 : 0.45,
      position: "relative"
    }
  }, saving ? React.createElement("span", {
    className: "spinner",
    style: {
      width: 18,
      height: 18
    }
  }) : React.createElement(React.Fragment, null, React.createElement(Icon, {
    name: "check",
    size: 16,
    color: allDone ? "#062810" : "#fff"
  }), allDone ? t("Sessione completa — Salva su Sheets") : `${t("Chiudi sessione")} (${completedSets}/${totalSets})`)), saveMsg && React.createElement("div", {
    className: "fade-up",
    style: {
      textAlign: "center",
      fontSize: 13,
      fontWeight: 500,
      color: saveMsg.startsWith("✓") ? "var(--success)" : "#FF9F0A",
      padding: "4px 0"
    }
  }, saveMsg), timer != null && React.createElement(TimerOverlay, {
    seconds: timer,
    onClose: () => setTimer(null)
  }), showConfetti && React.createElement(Confetti, null), mode === "player" && React.createElement(WorkoutPlayer, {
    dayKey: scheda,
    dayName: current.name,
    exercises: exercises,
    cursor: cursor,
    setCursor: setCursor,
    completion: completion,
    substitutions: substitutions,
    pesosRef: pesosRef,
    sheetsWeights: sheetsWeights,
    prMap: prMap,
    pesiHistory: pesiHistory,
    deload: deload,
    exNotes: exNotes,
    onSaveNote: saveExNote,
    autoRest: autoRest,
    setAutoRest: setAutoRest,
    onPatch: patchProg,
    onClose: () => setMode("list"),
    onFinish: () => {
      setMode("list");
      if (completedSets > 0) handleSaveSession();
    }
  }), summary && React.createElement(SessionSummaryOverlay, {
    data: summary,
    onClose: () => setSummary(null)
  }), newPRs.length > 0 && React.createElement("div", {
    className: "pop-in",
    style: {
      position: "fixed",
      left: 16,
      right: 16,
      bottom: "calc(env(safe-area-inset-bottom) + 90px)",
      zIndex: 9995,
      background: "var(--card)",
      border: "1px solid rgba(48,209,88,0.4)",
      borderRadius: 16,
      padding: "14px 16px",
      boxShadow: "0 16px 40px -12px rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, React.createElement("div", {
    style: {
      fontSize: 26
    }
  }, "🏆"), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: "var(--success)"
    }
  }, newPRs.length === 1 ? t("Nuovo record!") : `${newPRs.length} ${t("nuovi record!")}`), React.createElement("div", {
    className: "muted tnum",
    style: {
      fontSize: 12,
      marginTop: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, newPRs.slice(0, 3).map(p => `${t(p.esercizio)} ${p.peso}kg`).join(" · ")))));
};
window.Scheda = Scheda;
})();

// ══ screens/dieta.jsx ══
;(function () {
const _DAY_TYPES = [{
  id: "mattina",
  label: "Mattina",
  emoji: "🌅",
  hint: "07–10"
}, {
  id: "ore17",
  label: "Ore 17",
  emoji: "🌇",
  hint: "pomeriggio"
}, {
  id: "ore21",
  label: "Ore 21",
  emoji: "🌙",
  hint: "sera"
}, {
  id: "ore22",
  label: "Ore 22",
  emoji: "🌃",
  hint: "tardi"
}];
const _CARDIO_TYPES = [{
  id: "corsa",
  label: "Corsa",
  emoji: "🏃"
}, {
  id: "bike",
  label: "Bike",
  emoji: "🚴"
}, {
  id: "hiit",
  label: "HIIT",
  emoji: "⚡"
}, {
  id: "camminata",
  label: "Camminata",
  emoji: "🚶"
}, {
  id: "ellittica",
  label: "Ellittica",
  emoji: "🔄"
}];
const _SUPPS_RIPOSO = [{
  name: "Vita C+ Slow Release",
  time: "Colazione (mattina)",
  sortTime: "08:00",
  color: "#FF9F0A",
  type: "vitac"
}, {
  name: "Vita B+",
  time: "Colazione (mattina)",
  sortTime: "08:00",
  color: "#FFD60A",
  type: "vitab"
}, {
  name: "Extra Omega+ (1ª)",
  time: "Dopo pranzo",
  sortTime: "14:00",
  color: "#5AC8FA",
  type: "omega1"
}, {
  name: "PS+",
  time: "Dopo merenda",
  sortTime: "17:00",
  color: "#BF5AF2",
  type: "ps"
}, {
  name: "Extra Omega+ (2ª)",
  time: "Dopocena",
  sortTime: "21:00",
  color: "#5AC8FA",
  type: "omega2"
}, {
  name: "Gluta+ · 1 mis. 250ml",
  time: "Prima di dormire",
  sortTime: "23:00",
  color: "#30D158",
  type: "gluta"
}];
const _SUPPS_MATTINA = [{
  name: "Vita C+ Slow Release",
  time: "Colazione",
  sortTime: "06:30",
  color: "#FF9F0A",
  type: "vitac"
}, {
  name: "Vita B+",
  time: "Colazione",
  sortTime: "06:30",
  color: "#FFD60A",
  type: "vitab"
}, {
  name: "MGK+ Liquid",
  time: "Pre-WO (45min prima)",
  sortTime: "07:15",
  color: "#0A84FF",
  type: "mgk"
}, {
  name: "Fuel+",
  time: "Pre-WO (45min prima)",
  sortTime: "07:15",
  color: "#0A84FF",
  type: "fuel"
}, {
  name: "Barretta 4plus 45g",
  time: "Pre-WO (45min prima)",
  sortTime: "07:15",
  color: "#FF9F0A",
  type: "barretta"
}, {
  name: "OMNIA+ 500ml",
  time: "Intra-WO (borraccia)",
  sortTime: "08:00",
  color: "#5AC8FA",
  type: "omnia"
}, {
  name: "Extra Omega+ (1ª)",
  time: "Dopo pranzo",
  sortTime: "11:30",
  color: "#5AC8FA",
  type: "omega1"
}, {
  name: "PS+",
  time: "Dopo merenda",
  sortTime: "16:30",
  color: "#BF5AF2",
  type: "ps"
}, {
  name: "Extra Omega+ (2ª)",
  time: "Dopocena",
  sortTime: "21:00",
  color: "#5AC8FA",
  type: "omega2"
}, {
  name: "Gluta+ · 1 mis. 250ml",
  time: "Prima di dormire",
  sortTime: "23:00",
  color: "#30D158",
  type: "gluta"
}];
const _SUPPS_ORE17 = [{
  name: "Vita C+ Slow Release",
  time: "Colazione",
  sortTime: "08:00",
  color: "#FF9F0A",
  type: "vitac"
}, {
  name: "Vita B+",
  time: "Colazione",
  sortTime: "08:00",
  color: "#FFD60A",
  type: "vitab"
}, {
  name: "Extra Omega+ (1ª)",
  time: "Dopo pranzo",
  sortTime: "14:00",
  color: "#5AC8FA",
  type: "omega1"
}, {
  name: "MGK+ Liquid",
  time: "Pre-WO ore 16:15",
  sortTime: "16:15",
  color: "#0A84FF",
  type: "mgk"
}, {
  name: "Fuel+",
  time: "Pre-WO ore 16:15",
  sortTime: "16:15",
  color: "#0A84FF",
  type: "fuel"
}, {
  name: "Barretta 4plus 45g",
  time: "Pre-WO ore 16:15",
  sortTime: "16:15",
  color: "#FF9F0A",
  type: "barretta"
}, {
  name: "PS+",
  time: "Dopo merenda",
  sortTime: "16:30",
  color: "#BF5AF2",
  type: "ps"
}, {
  name: "OMNIA+ 500ml",
  time: "Intra-WO (borraccia)",
  sortTime: "17:00",
  color: "#5AC8FA",
  type: "omnia"
}, {
  name: "Extra Omega+ (2ª)",
  time: "Dopocena",
  sortTime: "21:00",
  color: "#5AC8FA",
  type: "omega2"
}, {
  name: "Gluta+ · 1 mis. 250ml",
  time: "Prima di dormire",
  sortTime: "23:00",
  color: "#30D158",
  type: "gluta"
}];
const _SUPPS_ORE21 = [{
  name: "Vita C+ Slow Release",
  time: "Colazione",
  sortTime: "08:00",
  color: "#FF9F0A",
  type: "vitac"
}, {
  name: "Vita B+",
  time: "Colazione",
  sortTime: "08:00",
  color: "#FFD60A",
  type: "vitab"
}, {
  name: "Extra Omega+ (1ª)",
  time: "Dopo pranzo",
  sortTime: "14:00",
  color: "#5AC8FA",
  type: "omega1"
}, {
  name: "PS+",
  time: "Dopo merenda · entro 17:00",
  sortTime: "16:30",
  color: "#BF5AF2",
  type: "ps"
}, {
  name: "MGK+ Liquid",
  time: "Pre-WO ore 20:15",
  sortTime: "20:15",
  color: "#0A84FF",
  type: "mgk"
}, {
  name: "Fuel+",
  time: "Pre-WO ore 20:15",
  sortTime: "20:15",
  color: "#0A84FF",
  type: "fuel"
}, {
  name: "Barretta 4plus 45g",
  time: "Pre-WO ore 20:15",
  sortTime: "20:15",
  color: "#FF9F0A",
  type: "barretta"
}, {
  name: "OMNIA+ 500ml",
  time: "Intra-WO (borraccia)",
  sortTime: "21:00",
  color: "#5AC8FA",
  type: "omnia"
}, {
  name: "Extra Omega+ (2ª)",
  time: "Dopocena",
  sortTime: "22:30",
  color: "#5AC8FA",
  type: "omega2"
}, {
  name: "Gluta+ · 1 mis. 250ml",
  time: "Prima di dormire",
  sortTime: "23:30",
  color: "#30D158",
  type: "gluta"
}];
const _SUPPS_ORE22 = [{
  name: "Vita C+ Slow Release",
  time: "Colazione",
  sortTime: "08:00",
  color: "#FF9F0A",
  type: "vitac"
}, {
  name: "Vita B+",
  time: "Colazione",
  sortTime: "08:00",
  color: "#FFD60A",
  type: "vitab"
}, {
  name: "Extra Omega+ (1ª)",
  time: "Dopo pranzo",
  sortTime: "14:00",
  color: "#5AC8FA",
  type: "omega1"
}, {
  name: "MGK+ Liquid",
  time: "Pre-WO ore 21:15",
  sortTime: "21:15",
  color: "#0A84FF",
  type: "mgk"
}, {
  name: "Fuel+",
  time: "Pre-WO ore 21:15",
  sortTime: "21:15",
  color: "#0A84FF",
  type: "fuel"
}, {
  name: "Barretta 4plus 45g",
  time: "Pre-WO ore 21:15",
  sortTime: "21:15",
  color: "#FF9F0A",
  type: "barretta"
}, {
  name: "OMNIA+ 500ml",
  time: "Intra-WO (borraccia)",
  sortTime: "22:00",
  color: "#5AC8FA",
  type: "omnia"
}, {
  name: "Extra Omega+ (2ª)",
  time: "Dopocena",
  sortTime: "23:30",
  color: "#5AC8FA",
  type: "omega2"
}, {
  name: "Gluta+ · 1 mis. 250ml",
  time: "Prima di dormire",
  sortTime: "23:55",
  color: "#30D158",
  type: "gluta"
}];
const _SUPPS_MAP = {
  riposo: _SUPPS_RIPOSO,
  mattina: _SUPPS_MATTINA,
  ore17: _SUPPS_ORE17,
  ore21: _SUPPS_ORE21,
  ore22: _SUPPS_ORE22
};
const _FALLBACK = {
  riposo: {
    integratori: _SUPPS_RIPOSO,
    meals: [{
      time: "08:00",
      sortTime: "08:00",
      emoji: "🌅",
      title: "Colazione",
      primary: [{
        food: "Gallette grano saraceno (4) + marmellata ridotto zucchero + burro chiarificato",
        qty: "40g + 50g + 10g"
      }, {
        food: "Pane di segale + prosciutto crudo o bresaola",
        qty: "80g + 100g"
      }],
      others: [{
        food: "Yogurt greco Fage 0% + miele + muesli viviverde",
        qty: "150g+20g+50g"
      }, {
        food: "Uova (2) + pane di segale",
        qty: "160g+100g"
      }]
    }, {
      time: "10:30",
      sortTime: "10:30",
      emoji: "🍎",
      title: "Spuntino",
      primary: [{
        food: "Frutta fresca (no macedonie)",
        qty: "200g"
      }, {
        food: "Noci o mandorle",
        qty: "30g"
      }],
      others: []
    }, {
      time: "13:00",
      sortTime: "13:00",
      emoji: "🍝",
      title: "Pranzo",
      primary: [{
        food: "Carboidrato: pasta farro integrale | riso rosso | riso basmati | pane integrale",
        qty: "80–100g"
      }, {
        food: "Verdure o ortaggi",
        qty: "300g"
      }, {
        food: "Olio EVO",
        qty: "20g"
      }, {
        food: "Proteina: tonno | orata | pollo | salmone | manzo | tacchino | merluzzo",
        qty: "a scelta"
      }],
      others: [{
        food: "Primo sale 110g | Ricotta 160g | Parmigiano 60g | Feta 100g",
        qty: ""
      }]
    }, {
      time: "16:30",
      sortTime: "16:30",
      emoji: "🥛",
      title: "Merenda",
      primary: [{
        food: "Yogurt greco Fage 0% (o yoeggs)",
        qty: "200g"
      }, {
        food: "Frutta fresca",
        qty: "100g"
      }],
      others: []
    }, {
      time: "20:00",
      sortTime: "20:00",
      emoji: "🌙",
      title: "Cena",
      primary: [{
        food: "Verdure o ortaggi",
        qty: "200g"
      }, {
        food: "Olio EVO",
        qty: "10g"
      }, {
        food: "Proteina: merluzzo | pollo | salmone | uova | bistecca | vitello",
        qty: "a scelta"
      }],
      others: [{
        food: "Con legumi: 90g verdure + 20g legumi secchi misto",
        qty: ""
      }]
    }]
  },
  mattina: {
    integratori: _SUPPS_MATTINA,
    meals: [{
      time: "06:30",
      sortTime: "06:30",
      emoji: "💪",
      title: "Pre-allenamento",
      primary: [{
        food: "Gallette grano saraceno (4) + marmellata o miele",
        qty: "40g+50g"
      }, {
        food: "Pane tipo 1 + marmellata o miele",
        qty: "50g+50g"
      }],
      others: [{
        food: "Caffè ok, acqua abbondante",
        qty: ""
      }]
    }, {
      time: "10:30",
      sortTime: "10:30",
      emoji: "🥤",
      title: "Pranzo post-WO",
      primary: [{
        food: "Carboidrato: pasta farro integrale | riso rosso | riso basmati | pane di segale",
        qty: "80–100g"
      }, {
        food: "Verdure o ortaggi",
        qty: "300g"
      }, {
        food: "Olio EVO",
        qty: "20g"
      }, {
        food: "Proteina aumentata: pollo | tacchino | manzo | salmone | orata | merluzzo",
        qty: "a scelta"
      }],
      others: [{
        food: "Tonno 180g | Platessa 340g | Uova 220g | Hamburger chianina 140g",
        qty: ""
      }]
    }, {
      time: "16:30",
      sortTime: "16:30",
      emoji: "🥛",
      title: "Merenda",
      primary: [{
        food: "Yogurt greco Fage 0% (o yoeggs)",
        qty: "200g"
      }, {
        food: "Frutta fresca",
        qty: "100g"
      }, {
        food: "Noci",
        qty: "30g"
      }],
      others: []
    }, {
      time: "20:00",
      sortTime: "20:00",
      emoji: "🌙",
      title: "Cena",
      primary: [{
        food: "Verdure o ortaggi",
        qty: "100g"
      }, {
        food: "Olio EVO",
        qty: "10g"
      }, {
        food: "Proteina: pollo | salmone | uova | merluzzo | bistecca | vitello",
        qty: "a scelta"
      }, {
        food: "Pane di segale",
        qty: "50g"
      }],
      others: []
    }]
  },
  ore17: {
    integratori: _SUPPS_ORE17,
    meals: [{
      time: "08:00",
      sortTime: "08:00",
      emoji: "🌅",
      title: "Colazione",
      primary: [{
        food: "Gallette grano saraceno (4) + marmellata + burro chiarificato",
        qty: "40g+50g+10g"
      }, {
        food: "Pane di segale + pane integrale + prosciutto/bresaola",
        qty: "80g+70g+100g"
      }],
      others: [{
        food: "Yogurt greco 0% + miele + muesli",
        qty: "150g+20g+50g"
      }, {
        food: "Uova (2) + pane",
        qty: "160g+100g"
      }]
    }, {
      time: "10:30",
      sortTime: "10:30",
      emoji: "🍎",
      title: "Spuntino mattina",
      primary: [{
        food: "Frutta fresca (no macedonie)",
        qty: "200g"
      }, {
        food: "Noci o mandorle",
        qty: "30g"
      }, {
        food: "Yogurt greco Fage 0% (o yoeggs)",
        qty: "150g"
      }],
      others: []
    }, {
      time: "13:00",
      sortTime: "13:00",
      emoji: "🍝",
      title: "Pranzo",
      primary: [{
        food: "Carboidrato: pasta farro | riso rosso | riso basmati | pane integrale",
        qty: "70–80g"
      }, {
        food: "Verdure",
        qty: "300g"
      }, {
        food: "Olio EVO",
        qty: "20g"
      }, {
        food: "Proteina: pollo | salmone | orata | manzo | merluzzo | tacchino",
        qty: "a scelta"
      }],
      others: [{
        food: "Tonno 150g | Ricotta 160g | Feta 100g | Uova 190g",
        qty: ""
      }]
    }, {
      time: "16:00",
      sortTime: "16:00",
      emoji: "⚡",
      title: "Pre-WO · spuntino",
      primary: [{
        food: "Barretta Endurance 4Plus",
        qty: "45g"
      }, {
        food: "(+ MGK+ Liquid + Fuel+ — vedi integratori)",
        qty: ""
      }],
      others: []
    }, {
      time: "18:30",
      sortTime: "18:30",
      emoji: "🥤",
      title: "Post-WO (cena)",
      primary: [{
        food: "Carboidrato: riso basmati | riso parboiled | riso arborio",
        qty: "80g"
      }, {
        food: "Proteina: pollo | manzo | salmone | uova | merluzzo",
        qty: "a scelta"
      }, {
        food: "Verdure",
        qty: "200g"
      }],
      others: []
    }]
  }
};
_FALLBACK.ore21 = {
  integratori: _SUPPS_ORE21,
  meals: [_FALLBACK.ore17.meals[0], _FALLBACK.ore17.meals[1], _FALLBACK.ore17.meals[2], {
    time: "16:30",
    sortTime: "16:30",
    emoji: "🥛",
    title: "Merenda",
    primary: [{
      food: "Yogurt greco Fage 0% (o yoeggs)",
      qty: "200g"
    }, {
      food: "Frutta fresca",
      qty: "100g"
    }],
    others: []
  }, {
    time: "20:00",
    sortTime: "20:00",
    emoji: "⚡",
    title: "Pre-WO · spuntino",
    primary: [{
      food: "Barretta Endurance 4Plus",
      qty: "45g"
    }, {
      food: "(+ MGK+ Liquid + Fuel+ — vedi integratori)",
      qty: ""
    }],
    others: []
  }, {
    time: "22:00",
    sortTime: "22:00",
    emoji: "🌙",
    title: "Post-WO (cena leggera)",
    primary: [{
      food: "Carboidrato: riso basmati | parboiled | arborio",
      qty: "80g"
    }, {
      food: "Proteina: pollo | salmone | uova | merluzzo",
      qty: "a scelta"
    }, {
      food: "Verdure",
      qty: "100g"
    }],
    others: []
  }]
};
_FALLBACK.ore22 = {
  integratori: _SUPPS_ORE22,
  meals: [_FALLBACK.ore17.meals[0], _FALLBACK.ore17.meals[1], _FALLBACK.ore17.meals[2], {
    time: "18:00",
    sortTime: "18:00",
    emoji: "🍽️",
    title: "Merenda ore 18",
    primary: [{
      food: "Verdure",
      qty: "100g"
    }, {
      food: "Olio EVO",
      qty: "10g"
    }, {
      food: "Proteina: pollo | salmone | manzo | merluzzo",
      qty: "a scelta"
    }, {
      food: "Carboidrato: riso basmati | pane grano duro",
      qty: "50–60g"
    }],
    others: []
  }, {
    time: "21:00",
    sortTime: "21:00",
    emoji: "⚡",
    title: "Pre-WO · spuntino",
    primary: [{
      food: "Barretta Endurance 4Plus",
      qty: "45g"
    }, {
      food: "(+ MGK+ Liquid + Fuel+ — vedi integratori)",
      qty: ""
    }],
    others: []
  }]
};
function _getDieta() {
  if (!window.parseDieta || !window.storage) return _FALLBACK;
  const text = window.storage.get("dietaData", null);
  if (!text) return _FALLBACK;
  try {
    const parsed = window.parseDieta(text);
    if (!parsed) return _FALLBACK;
    ["riposo", "mattina", "ore17", "ore21", "ore22"].forEach(k => {
      if (!parsed[k] || !parsed[k].meals || !parsed[k].meals.length) {
        parsed[k] = _FALLBACK[k];
      } else {
        parsed[k].integratori = _SUPPS_MAP[k];
        parsed[k].meals.forEach(m => {
          if (!m.sortTime) m.sortTime = m.time;
        });
      }
    });
    return parsed;
  } catch (_) {
    return _FALLBACK;
  }
}
function _buildTimeline(meals, integratori) {
  const parseMinutes = t => {
    if (!t) return 9999;
    const [h, m] = String(t).split(":").map(Number);
    return isNaN(h) ? 9999 : h * 60 + (isNaN(m) ? 0 : m);
  };
  const mealItems = (meals || []).map(m => ({
    ...m,
    kind: "meal",
    _mins: parseMinutes(m.sortTime || m.time)
  }));
  const suppItems = (integratori || []).map(s => ({
    ...s,
    kind: "supplement",
    _mins: parseMinutes(s.sortTime)
  }));
  return [...mealItems, ...suppItems].sort((a, b) => a._mins - b._mins);
}
const DayTimeSlider = ({
  timeline
}) => {
  const t = useT();
  const [nowMins, setNowMins] = React.useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  React.useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMins(d.getHours() * 60 + d.getMinutes());
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const START = 6 * 60;
  const END = 24 * 60;
  const RANGE = END - START;
  const toP = m => Math.max(0, Math.min(100, (m - START) / RANGE * 100));
  const nowP = toP(Math.min(nowMins, END));
  const fmt = m => {
    if (m >= 24 * 60) return "00:00";
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}:${String(min).padStart(2, "0")}`;
  };
  const dots = (timeline || []).filter(item => item._mins < 9999 && item._mins >= START - 30);
  const lastMins = dots.length ? Math.max(...dots.map(d => d._mins)) : END;
  const isAllDone = nowMins > lastMins;
  return React.createElement("div", {
    style: {
      background: "var(--card-2)",
      borderRadius: 14,
      padding: "16px 14px 12px",
      border: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10
    }
  }, React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: "var(--text-2)"
    }
  }, t("Orario della giornata")), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 12,
      fontWeight: 700,
      color: isAllDone ? "var(--success)" : "var(--accent)",
      background: isAllDone ? "rgba(48,209,88,0.12)" : "rgba(10,132,255,0.12)",
      padding: "3px 9px",
      borderRadius: 999
    }
  }, isAllDone ? "✓ " + t("Giornata completata") : fmt(nowMins))), React.createElement("div", {
    style: {
      position: "relative",
      height: 32,
      userSelect: "none"
    }
  }, React.createElement("div", {
    style: {
      position: "absolute",
      top: "50%",
      left: 0,
      right: 0,
      height: 6,
      background: "var(--card-3)",
      borderRadius: 3,
      transform: "translateY(-50%)"
    }
  }), React.createElement("div", {
    style: {
      position: "absolute",
      top: "50%",
      left: 0,
      width: `${nowP}%`,
      height: 6,
      background: "linear-gradient(90deg, var(--accent) 0%, #5e5ce6 100%)",
      borderRadius: 3,
      transform: "translateY(-50%)",
      transition: "width 0.5s ease"
    }
  }), dots.map((item, i) => {
    const p = toP(item._mins);
    const isMeal = item.kind === "meal";
    const isPast = item._mins <= nowMins;
    return React.createElement("div", {
      key: i,
      title: `${fmt(item._mins)} · ${item.name || item.title}`,
      style: {
        position: "absolute",
        left: `${p}%`,
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: isMeal ? 12 : 8,
        height: isMeal ? 12 : 8,
        borderRadius: 999,
        background: isPast ? isMeal ? "var(--accent)" : item.color || "#FF9F0A" : "var(--card-3)",
        border: `2px solid ${isMeal ? "var(--accent)" : item.color || "#FF9F0A"}`,
        zIndex: 2,
        boxShadow: isPast && isMeal ? `0 0 6px ${item.color || "var(--accent)"}55` : "none",
        transition: "background 0.3s"
      }
    });
  }), React.createElement("div", {
    style: {
      position: "absolute",
      left: `${nowP}%`,
      top: 0,
      bottom: 0,
      width: 2,
      background: "var(--text)",
      transform: "translateX(-50%)",
      borderRadius: 1,
      zIndex: 4,
      boxShadow: "0 0 5px rgba(127,127,127,0.6)"
    }
  })), React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      marginTop: 6
    }
  }, ["06", "10", "14", "18", "22", "24"].map(h => React.createElement("span", {
    key: h,
    style: {
      fontSize: 9.5,
      color: "var(--text-3)",
      fontWeight: 500
    }
  }, h, ":00"))), (() => {
    const prev = [...dots].reverse().find(d => d._mins <= nowMins);
    const next = dots.find(d => d._mins > nowMins);
    const prevLabel = prev ? prev.kind === "meal" ? (prev.emoji || "🍽️") + " " + t(prev.title) : "💊 " + prev.name : null;
    const nextLabel = next ? next.kind === "meal" ? (next.emoji || "🍽️") + " " + t(next.title) : "💊 " + next.name : null;
    if (isAllDone) {
      return React.createElement("div", {
        style: {
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: "rgba(48,209,88,0.08)",
          borderRadius: 10,
          fontSize: 12
        }
      }, React.createElement("span", null, "✅"), React.createElement("span", {
        style: {
          color: "var(--success)",
          fontWeight: 600
        }
      }, t("Tutti i pasti completati per oggi!")));
    }
    return React.createElement("div", {
      style: {
        marginTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 10px",
        background: "var(--card-3)",
        borderRadius: 9,
        fontSize: 12
      }
    }, React.createElement("span", {
      style: {
        fontSize: 13
      }
    }, "📍"), React.createElement("span", {
      style: {
        color: "var(--text-2)"
      }
    }, !prevLabel && nextLabel && React.createElement(React.Fragment, null, t("Prima di"), " ", React.createElement("strong", {
      style: {
        color: "var(--text)"
      }
    }, nextLabel)), prevLabel && nextLabel && React.createElement(React.Fragment, null, React.createElement("strong", {
      style: {
        color: "var(--text-2)"
      }
    }, prevLabel), React.createElement("span", {
      style: {
        color: "var(--text-3)",
        margin: "0 5px"
      }
    }, "→"), React.createElement("strong", {
      style: {
        color: "var(--accent)"
      }
    }, nextLabel)), prevLabel && !nextLabel && React.createElement(React.Fragment, null, t("Dopo"), " ", React.createElement("strong", {
      style: {
        color: "var(--text)"
      }
    }, prevLabel)))), next && (() => {
      const diffMins = next._mins - nowMins;
      const diffStr = diffMins < 60 ? `${diffMins} min` : `${Math.floor(diffMins / 60)}h${diffMins % 60 > 0 ? " " + diffMins % 60 + "m" : ""}`;
      return React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: "rgba(10,132,255,0.08)",
          borderRadius: 10,
          fontSize: 12
        }
      }, React.createElement("span", {
        style: {
          fontSize: 14
        }
      }, "⏱"), React.createElement("span", {
        style: {
          flex: 1,
          color: "var(--text-2)"
        }
      }, React.createElement("strong", {
        style: {
          color: "var(--text)"
        }
      }, nextLabel)), React.createElement("span", {
        className: "num",
        style: {
          fontSize: 11.5,
          color: "var(--accent)",
          fontWeight: 600
        }
      }, fmt(next._mins), " · ", t("tra"), " ", diffStr));
    })());
  })());
};
const SupplementRow = ({
  supp,
  checked,
  onToggle
}) => {
  const t = useT();
  const done = !!checked[supp.type];
  return React.createElement("button", {
    onClick: ev => {
      if (!done && window.Motion) window.Motion.pop(ev.currentTarget);
      onToggle(supp.type);
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 14px",
      borderRadius: 12,
      border: 0,
      background: done ? "rgba(48,209,88,0.08)" : "var(--card)",
      boxShadow: done ? "none" : "inset 0 0 0 1px var(--border)",
      cursor: "pointer",
      textAlign: "left",
      width: "100%",
      transition: "all 0.15s"
    }
  }, React.createElement("div", {
    style: {
      width: 4,
      height: 28,
      borderRadius: 2,
      background: supp.color,
      opacity: done ? 0.4 : 1,
      flexShrink: 0
    }
  }), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      lineHeight: 1.2,
      color: done ? "var(--text-2)" : "var(--text)",
      textDecoration: done ? "line-through" : "none"
    }
  }, "💊 ", supp.name), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 11,
      color: "var(--text-3)",
      marginTop: 2
    }
  }, t(supp.time))), React.createElement("div", {
    style: {
      width: 22,
      height: 22,
      borderRadius: 999,
      flexShrink: 0,
      background: done ? "var(--success)" : "var(--card-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background 0.15s"
    }
  }, done && React.createElement(Icon, {
    name: "check",
    size: 12,
    color: "#062810"
  })));
};
const MealCard = ({
  meal,
  isDesktop,
  checked,
  onToggle
}) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [swapOpen, setSwapOpen] = React.useState(null);
  return React.createElement("div", {
    className: "card lift",
    style: {
      padding: isDesktop ? 20 : 16,
      opacity: checked ? 0.82 : 1
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 12
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, React.createElement("span", {
    style: {
      fontSize: 22
    }
  }, meal.emoji), React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 15.5,
      fontWeight: 600,
      letterSpacing: -0.015,
      textDecoration: checked ? "line-through" : "none"
    }
  }, t(meal.title)), React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 12
    }
  }, meal.time))), onToggle && React.createElement("button", {
    onClick: ev => {
      if (!checked && window.Motion) window.Motion.pop(ev.currentTarget);
      onToggle();
    },
    className: `check ${checked ? "on" : ""}`,
    "aria-label": t("Pasto fatto"),
    style: {
      width: 28,
      height: 28,
      flexShrink: 0
    }
  }, React.createElement(Icon, {
    name: "check",
    size: 14,
    color: "#062810"
  }))), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, meal.primary.map((f, i) => {
    const swaps = window.Insights ? window.Insights.foodSwaps(f.food, f.qty) : [];
    const hasSwaps = swaps.length > 0;
    return React.createElement("div", {
      key: i,
      style: {
        borderTop: i > 0 ? "1px solid var(--border)" : "0"
      }
    }, React.createElement("div", {
      onClick: hasSwaps ? () => setSwapOpen(s => s === i ? null : i) : undefined,
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "7px 0",
        gap: 8,
        cursor: hasSwaps ? "pointer" : "default"
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 7,
        fontSize: 13.5,
        fontWeight: 500,
        lineHeight: 1.35,
        minWidth: 0
      }
    }, React.createElement("span", {
      style: {
        fontSize: 15,
        flexShrink: 0,
        lineHeight: 1.2
      }
    }, window.foodEmoji(f.food)), React.createElement("span", null, f.food, hasSwaps && React.createElement("span", {
      style: {
        color: "var(--accent)",
        fontSize: 11,
        marginLeft: 5
      }
    }, "⇄"))), f.qty && React.createElement("div", {
      className: "num",
      style: {
        fontSize: 12.5,
        color: "var(--text-2)",
        fontWeight: 600,
        whiteSpace: "nowrap",
        flexShrink: 0
      }
    }, f.qty)), swapOpen === i && hasSwaps && React.createElement("div", {
      className: "fade-up",
      style: {
        margin: "0 0 8px",
        padding: "8px 10px",
        background: "var(--card-2)",
        borderRadius: 9,
        fontSize: 12,
        color: "var(--text-2)",
        lineHeight: 1.5
      }
    }, React.createElement("span", {
      style: {
        fontWeight: 600,
        color: "var(--text-3)",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: 0.4
      }
    }, t("Equivalenti"), " · "), swaps.map(s => `${s.name} ${s.grams}g`).join(" · ")));
  })), meal.others && meal.others.length > 0 && React.createElement(React.Fragment, null, React.createElement("button", {
    onClick: () => setOpen(o => !o),
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      width: "100%",
      padding: "10px 0 0",
      border: 0,
      background: "transparent",
      color: "var(--accent)",
      fontSize: 12.5,
      fontWeight: 600,
      cursor: "pointer",
      borderTop: "1px solid var(--border)",
      marginTop: 8
    }
  }, React.createElement("span", null, open ? t("Nascondi") : t("Altre opzioni"), " (", meal.others.length, ")"), React.createElement("span", {
    style: {
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform 0.2s",
      display: "flex"
    }
  }, React.createElement(Icon, {
    name: "chevron-down",
    size: 14
  }))), open && React.createElement("div", {
    className: "fade-up",
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      marginTop: 8
    }
  }, meal.others.map((f, i) => React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "8px 10px",
      background: "var(--card-2)",
      borderRadius: 9
    }
  }, React.createElement("span", {
    style: {
      fontSize: 14,
      flexShrink: 0,
      lineHeight: 1.2
    }
  }, window.foodEmoji(f.food)), React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, f.food))))));
};
const Dieta = ({
  device,
  onNav
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [dieta] = React.useState(() => _getDieta());
  const [training, setTraining] = React.useState(() => {
    const sess = window.getTodaySession ? window.getTodaySession() : null;
    return !!sess;
  });
  const [trainTime, setTrainTime] = React.useState("ore17");
  const [cardio, setCardio] = React.useState(false);
  const [cardioType, setCardioType] = React.useState("camminata");
  const [cardioMin, setCardioMin] = React.useState(30);
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const [checked, setChecked] = React.useState(() => window.storage ? window.storage.get(`integ_${today}`, {}) : {});
  const toggleSupp = type => {
    setChecked(c => {
      const next = {
        ...c,
        [type]: !c[type]
      };
      if (window.storage) window.storage.set(`integ_${today}`, next);
      if (navigator.vibrate) navigator.vibrate([40]);
      return next;
    });
  };
  const [mealChecked, setMealChecked] = React.useState(() => window.storage ? window.storage.get(`dietaCheck_${today}`, {}) : {});
  const toggleMeal = key => {
    setMealChecked(c => {
      const next = {
        ...c,
        [key]: !c[key]
      };
      if (window.storage) window.storage.set(`dietaCheck_${today}`, next);
      if (navigator.vibrate) navigator.vibrate([40]);
      return next;
    });
  };
  const _mealKey = ml => `${ml.time}|${ml.title}`;
  const dayType = training ? trainTime : "riposo";
  const section = dieta[dayType] || dieta.riposo;
  const meals = section.meals || [];
  const supps = _SUPPS_MAP[dayType] || _SUPPS_RIPOSO;
  const ct = _CARDIO_TYPES.find(c => c.id === cardioType) || _CARDIO_TYPES[0];
  const timeline = _buildTimeline(meals, supps);
  const doneCount = supps.filter(s => checked[s.type]).length;
  const allSuppsDone = doneCount === supps.length;
  const mealAdh = window.Insights ? window.Insights.mealAdherence(meals.reduce((m, ml) => {
    m[_mealKey(ml)] = !!mealChecked[_mealKey(ml)];
    return m;
  }, {}), meals.length) : null;
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: isDesktop ? "32px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? 18 : 14
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 10
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Piano alimentare")), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 28 : 24,
      fontWeight: 600
    }
  }, t("Dieta"))), mealAdh && mealAdh.total > 0 && React.createElement("span", {
    className: "pill tnum",
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      padding: "5px 11px",
      marginBottom: 4,
      background: mealAdh.pct === 100 ? "rgba(48,209,88,0.15)" : "var(--card-2)",
      color: mealAdh.pct === 100 ? "var(--success)" : "var(--text-2)"
    }
  }, "🍽 ", mealAdh.done, "/", mealAdh.total, " ", mealAdh.pct === 100 ? "✓" : `· ${mealAdh.pct}%`)), React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 18 : 14
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 12
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Attività di oggi")), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12
    }
  }, !training && !cardio && "💤 " + t("Riposo"), training && !cardio && "💪 " + t("Solo pesi"), !training && cardio && "🔥 " + t("Solo cardio"), training && cardio && "🔥 " + t("Pesi + cardio"))), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "4px 0"
    }
  }, React.createElement("div", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 9,
      background: training ? "rgba(10,132,255,0.2)" : "var(--card-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      transition: "background 0.18s"
    }
  }, React.createElement(Icon, {
    name: "dumbbell",
    size: 17,
    color: training ? "var(--accent)" : "var(--text-2)",
    strokeWidth: 1.8
  })), React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, t("Allenamento pesi")), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12,
      marginTop: 1
    }
  }, window.getTodaySession ? window.getTodaySession()?.label || t("Giorno di riposo") : t("Seleziona orario"))), React.createElement("div", {
    className: `ios-toggle blue ${training ? "on" : ""}`,
    onClick: () => setTraining(v => !v)
  })), training && React.createElement("div", {
    className: "fade-up",
    style: {
      paddingLeft: 46,
      paddingTop: 8
    }
  }, React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 6
    }
  }, t("Orario sessione")), React.createElement("div", {
    className: "hscroll",
    style: {
      marginLeft: 0,
      marginRight: 0,
      paddingLeft: 0,
      paddingRight: 0
    }
  }, _DAY_TYPES.map(d => {
    const on = trainTime === d.id;
    return React.createElement("button", {
      key: d.id,
      onClick: () => setTrainTime(d.id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 12px",
        border: 0,
        background: on ? "var(--accent)" : "var(--card-2)",
        color: on ? "#fff" : "var(--text)",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: on ? 600 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "all 0.16s",
        marginRight: 4
      }
    }, React.createElement("span", null, d.emoji), t(d.label));
  }))), React.createElement("div", {
    style: {
      height: 1,
      background: "var(--border)",
      margin: "10px 0"
    }
  }), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "4px 0"
    }
  }, React.createElement("div", {
    style: {
      width: 34,
      height: 34,
      borderRadius: 9,
      background: cardio ? "rgba(255,69,58,0.2)" : "var(--card-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      transition: "background 0.18s"
    }
  }, React.createElement(Icon, {
    name: "flame",
    size: 17,
    color: cardio ? "#FF453A" : "var(--text-2)",
    strokeWidth: 1.8
  })), React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, t("Cardio")), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12,
      marginTop: 1
    }
  }, cardio ? React.createElement(React.Fragment, null, ct.emoji, " ", t(ct.label), " · ", React.createElement("span", {
    className: "num"
  }, cardioMin), "′") : t("Corsa, bike, ellittica, camminata…"))), React.createElement("div", {
    className: `ios-toggle ${cardio ? "on" : ""}`,
    style: {
      background: cardio ? "#FF453A" : undefined
    },
    onClick: () => setCardio(v => !v)
  })), cardio && React.createElement("div", {
    className: "fade-up",
    style: {
      paddingLeft: 46,
      paddingTop: 8,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 6
    }
  }, t("Tipo")), React.createElement("div", {
    className: "hscroll",
    style: {
      marginLeft: 0,
      marginRight: 0,
      paddingLeft: 0,
      paddingRight: 0
    }
  }, _CARDIO_TYPES.map(ct2 => {
    const on = cardioType === ct2.id;
    return React.createElement("button", {
      key: ct2.id,
      onClick: () => setCardioType(ct2.id),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 12px",
        border: 0,
        background: on ? "#FF453A" : "var(--card-2)",
        color: on ? "#fff" : "var(--text)",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: on ? 600 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "all 0.16s",
        marginRight: 4
      }
    }, React.createElement("span", null, ct2.emoji), t(ct2.label));
  }))), React.createElement("div", null, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 6
    }
  }, React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Durata")), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 12,
      fontWeight: 600
    }
  }, cardioMin, " min")), React.createElement("input", {
    type: "range",
    min: "10",
    max: "120",
    step: "5",
    value: cardioMin,
    onChange: e => setCardioMin(parseInt(e.target.value)),
    style: {
      width: "100%"
    }
  }), React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      marginTop: 2,
      fontSize: 10,
      color: "var(--text-3)"
    }
  }, React.createElement("span", null, "10"), React.createElement("span", null, "30"), React.createElement("span", null, "60"), React.createElement("span", null, "90"), React.createElement("span", null, "120"))))), React.createElement("div", {
    style: {
      position: "relative"
    }
  }, React.createElement("div", {
    style: {
      marginBottom: isDesktop ? 14 : 10,
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, React.createElement(DayTimeSlider, {
    timeline: timeline
  }), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 14px",
      borderRadius: 12,
      background: allSuppsDone ? "rgba(48,209,88,0.1)" : "rgba(255,159,10,0.08)",
      border: `1px solid ${allSuppsDone ? "rgba(48,209,88,0.25)" : "rgba(255,159,10,0.2)"}`
    }
  }, React.createElement(Icon, {
    name: "pill",
    size: 16,
    color: allSuppsDone ? "var(--success)" : "#FF9F0A"
  }), React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 13,
      fontWeight: 600
    }
  }, allSuppsDone ? "✓ " + t("Tutti gli integratori assunti") : t("Integratori oggi")), React.createElement("span", {
    className: "num",
    style: {
      fontSize: 12.5,
      fontWeight: 700,
      color: allSuppsDone ? "var(--success)" : "#FF9F0A"
    }
  }, doneCount, "/", supps.length))), React.createElement("div", {
    style: {
      position: "absolute",
      top: 16,
      bottom: 16,
      left: isDesktop ? 22 : 18,
      width: 2,
      background: "linear-gradient(to bottom, var(--accent) 0%, transparent 100%)",
      opacity: 0.25
    }
  }), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? 10 : 8,
      paddingLeft: isDesktop ? 52 : 42
    }
  }, timeline.map((item, i) => {
    const isPast = item._mins <= (() => {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    })();
    return React.createElement("div", {
      key: `${item.kind}-${i}`,
      style: {
        position: "relative"
      }
    }, React.createElement("div", {
      style: {
        position: "absolute",
        left: isDesktop ? -38 : -30,
        top: item.kind === "meal" ? 20 : 14,
        width: item.kind === "meal" ? 14 : 10,
        height: item.kind === "meal" ? 14 : 10,
        borderRadius: 999,
        background: isPast ? item.kind === "meal" ? "var(--accent)" : item.color || "#FF9F0A" : "var(--card-2)",
        border: `2px solid ${item.kind === "meal" ? "var(--accent)" : item.color || "#FF9F0A"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, isPast && item.kind === "meal" && React.createElement("div", {
      style: {
        width: 5,
        height: 5,
        borderRadius: 999,
        background: "#fff",
        opacity: 0.9
      }
    })), React.createElement("div", {
      style: {
        position: "absolute",
        left: isDesktop ? -94 : -40,
        top: item.kind === "meal" ? 18 : 12,
        fontSize: 10,
        fontWeight: 600,
        color: isPast ? "var(--text-2)" : "var(--text-3)",
        whiteSpace: "nowrap",
        display: isDesktop ? "block" : "none"
      }
    }, item.kind === "meal" ? item.time : item.sortTime), item.kind === "meal" ? React.createElement(MealCard, {
      meal: item,
      isDesktop: isDesktop,
      checked: !!mealChecked[_mealKey(item)],
      onToggle: () => toggleMeal(_mealKey(item))
    }) : React.createElement(SupplementRow, {
      supp: item,
      checked: checked,
      onToggle: toggleSupp
    }));
  }))), timeline.length === 0 && React.createElement(UIEmpty, {
    icon: "fork",
    title: t("Nessun pasto"),
    sub: t("Nessun pasto in questa configurazione"),
    style: {
      padding: "24px 16px"
    }
  }), onNav && React.createElement("button", {
    onClick: () => onNav("spesa"),
    style: {
      width: "100%",
      border: "1px solid var(--border)",
      background: "var(--card)",
      color: "var(--text)",
      borderRadius: 16,
      padding: 15,
      fontSize: 15,
      fontWeight: 600,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 9
    }
  }, React.createElement(Icon, {
    name: "cart",
    size: 18,
    color: "var(--accent)",
    strokeWidth: 1.9
  }), t("Genera lista spesa")), React.createElement("div", {
    className: "card",
    style: {
      padding: 12,
      border: "1px solid rgba(255,69,58,0.2)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "🚫"), React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: "var(--danger)"
    }
  }, t("Escludere sempre")), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 11.5
    }
  }, "Pasta di ceci · Pasta di lenticchie · Pasta di piselli · Bevanda di mandorla")))));
};
window.Dieta = Dieta;
})();

// ══ screens/spesa.jsx ══
;(function () {
const CATEGORIES = [{
  id: "proteine",
  title: "Proteine",
  color: "#FF453A",
  icon: "flame",
  items: [{
    name: "Petto di pollo",
    qty1: "900 g",
    qty2: "500 g"
  }, {
    name: "Salmone fresco",
    qty1: "400 g",
    qty2: "300 g",
    note: "🧊 compra fresco"
  }, {
    name: "Uova di gallina",
    qty1: "18",
    qty2: "10"
  }, {
    name: "Bresaola",
    qty1: "200 g",
    qty2: "150 g"
  }, {
    name: "Tonno al naturale",
    qty1: "4 sc.",
    qty2: "2 sc."
  }, {
    name: "Merluzzo surgelato",
    qty1: "800 g",
    qty2: "500 g"
  }, {
    name: "Orata surgelata",
    qty1: "600 g",
    qty2: "400 g"
  }, {
    name: "Hamburger di chianina",
    qty1: "280 g",
    qty2: "150 g"
  }, {
    name: "Petto di tacchino",
    qty1: "400 g",
    qty2: "250 g"
  }]
}, {
  id: "carbo",
  title: "Carboidrati",
  color: "#FF9F0A",
  icon: "bolt",
  items: [{
    name: "Riso basmati",
    qty1: "1 kg",
    qty2: "500 g"
  }, {
    name: "Riso rosso integrale",
    qty1: "500 g",
    qty2: "250 g"
  }, {
    name: "Pasta di farro integrale",
    qty1: "500 g",
    qty2: "250 g"
  }, {
    name: "Gallette grano saraceno",
    qty1: "2 conf.",
    qty2: "1 conf."
  }, {
    name: "Pane di segale",
    qty1: "2 pani",
    qty2: "1 pane",
    note: "🧊 congela il 2°"
  }, {
    name: "Pane integrale",
    qty1: "1 filone",
    qty2: "1 filone"
  }, {
    name: "Muesli viviverde coop",
    qty1: "500 g",
    qty2: "250 g"
  }]
}, {
  id: "verdura",
  title: "Verdura & Frutta",
  color: "#30D158",
  icon: "leaf",
  items: [{
    name: "Spinaci freschi",
    qty1: "300 g",
    qty2: "200 g",
    note: "🥗 durano 3-4 gg"
  }, {
    name: "Zucchine",
    qty1: "600 g",
    qty2: "400 g"
  }, {
    name: "Verdure di stagione",
    qty1: "500 g",
    qty2: "300 g"
  }, {
    name: "Insalata mista",
    qty1: "1 busta",
    qty2: "1 busta"
  }, {
    name: "Mele",
    qty1: "6",
    qty2: "4"
  }, {
    name: "Banane",
    qty1: "5",
    qty2: "3"
  }, {
    name: "Frutti di bosco",
    qty1: "300 g",
    qty2: "200 g"
  }]
}, {
  id: "latticini",
  title: "Latticini",
  color: "#0A84FF",
  icon: "scale",
  items: [{
    name: "Yogurt greco Fage 0%",
    qty1: "700 g",
    qty2: "400 g"
  }, {
    name: "Ricotta",
    qty1: "250 g",
    qty2: "150 g",
    note: "🥛 deperibile"
  }, {
    name: "Parmigiano reggiano",
    qty1: "150 g",
    qty2: "100 g"
  }, {
    name: "Feta",
    qty1: "150 g",
    qty2: "100 g"
  }, {
    name: "Burro chiarificato",
    qty1: "1 vasetto",
    qty2: "—",
    note: "⏳ se esaurito"
  }]
}, {
  id: "integratori",
  title: "Integratori",
  color: "#BF5AF2",
  icon: "pill",
  items: [{
    name: "Vita C+ Slow Release",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "Vita B+",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "Extra Omega+ Concentrated",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "PS+",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "Gluta+",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "MGK+ Liquid",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "Fuel+",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "OMNIA+",
    qty1: "se esaurito",
    qty2: "se esaurito"
  }, {
    name: "Barretta 4Plus 45g",
    qty1: "3 pz.",
    qty2: "2 pz."
  }]
}, {
  id: "dispensa",
  title: "Dispensa",
  color: "#5AC8FA",
  icon: "spark",
  items: [{
    name: "Olio extravergine di oliva",
    qty1: "1 bott.",
    qty2: "—",
    note: "⏳ se esaurito"
  }, {
    name: "Marmellata ridotto zucchero",
    qty1: "1 vasetto",
    qty2: "1 vasetto"
  }, {
    name: "Miele",
    qty1: "1 vasetto",
    qty2: "—",
    note: "⏳ se esaurito"
  }, {
    name: "Noci",
    qty1: "200 g",
    qty2: "150 g"
  }, {
    name: "Mandorle",
    qty1: "200 g",
    qty2: "150 g"
  }, {
    name: "Caffè",
    qty1: "1 conf.",
    qty2: "—",
    note: "⏳ se esaurito"
  }]
}];
const SpesaItem = ({
  item,
  checked,
  onToggle,
  freq
}) => {
  const t = useT();
  const qty = freq === 2 ? item.qty2 : item.qty1;
  return React.createElement("div", {
    onClick: ev => {
      if (!checked && window.Motion) window.Motion.pop(ev.currentTarget);
      onToggle();
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 16px",
      borderTop: "1px solid var(--border)",
      cursor: "pointer",
      transition: "background 0.16s, opacity 0.18s",
      opacity: checked ? 0.5 : 1
    }
  }, React.createElement("div", {
    className: `check ${checked ? "on" : ""}`,
    style: {
      width: 22,
      height: 22
    }
  }, React.createElement(Icon, {
    name: "check",
    size: 12,
    color: "#062810"
  })), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 14.5,
      fontWeight: 500,
      textDecoration: checked ? "line-through" : "none",
      color: checked ? "var(--text-2)" : "var(--text)",
      transition: "color 0.16s"
    }
  }, item.name), item.note && !checked && React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: "var(--text-3)",
      marginTop: 1
    }
  }, item.note)), qty && qty !== "—" && React.createElement("span", {
    className: "num pill",
    style: {
      fontSize: 11.5,
      padding: "3px 9px",
      background: qty === "se esaurito" ? "rgba(191,90,242,0.12)" : "var(--card-2)",
      color: qty === "se esaurito" ? "#BF5AF2" : "var(--text-2)",
      fontWeight: 600,
      whiteSpace: "nowrap"
    }
  }, qty === "se esaurito" ? t("se esaurito") : qty), qty === "—" && React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--text-3)",
      fontStyle: "italic"
    }
  }, "—"));
};
const CategorySection = ({
  cat,
  checked,
  onToggle,
  isDesktop,
  freq
}) => {
  const t = useT();
  const total = cat.items.length;
  const done = cat.items.filter((_, i) => checked[`${cat.id}-${i}`]).length;
  return React.createElement("div", {
    className: "card lift",
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 16px",
      background: `linear-gradient(90deg, ${cat.color}22 0%, transparent 100%)`,
      borderLeft: `3px solid ${cat.color}`
    }
  }, React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 9,
      background: `${cat.color}22`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement(Icon, {
    name: cat.icon,
    size: 16,
    color: cat.color
  })), React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: -0.01
    }
  }, t(cat.title)), React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 11.5
    }
  }, done, " / ", total)), React.createElement("div", {
    style: {
      width: 60,
      height: 4,
      borderRadius: 2,
      background: "var(--track)",
      overflow: "hidden"
    }
  }, React.createElement("div", {
    style: {
      width: `${done / total * 100}%`,
      height: "100%",
      background: cat.color,
      transition: "width 0.3s"
    }
  }))), cat.items.map((it, i) => React.createElement(SpesaItem, {
    key: i,
    item: it,
    freq: freq,
    checked: !!checked[`${cat.id}-${i}`],
    onToggle: () => onToggle(`${cat.id}-${i}`)
  })));
};
const Spesa = ({
  device,
  spesaChecked,
  setSpesaChecked,
  spesaFreq,
  setSpesaFreq
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [_localChecked, _setLocalChecked] = React.useState(() => window.storage ? window.storage.get("spesaChecked", {}) : {});
  const [_localFreq, _setLocalFreq] = React.useState(() => window.storage ? window.storage.get("spesaFreq", 1) : 1);
  const checked = spesaChecked !== undefined ? spesaChecked : _localChecked;
  const freq = spesaFreq !== undefined ? spesaFreq : _localFreq;
  const setChecked = next => {
    if (setSpesaChecked) {
      setSpesaChecked(next);
    } else {
      _setLocalChecked(next);
      if (window.storage) window.storage.set("spesaChecked", next);
      if (window.sheetsAPI) window.sheetsAPI.saveSettings({
        key: "spesaChecked2",
        value: JSON.stringify(next)
      }).catch(() => {});
    }
  };
  const setFreq = f => {
    if (setSpesaFreq) {
      setSpesaFreq(f);
    } else {
      _setLocalFreq(f);
      if (window.storage) window.storage.set("spesaFreq", f);
      if (window.sheetsAPI) window.sheetsAPI.saveSettings({
        key: "spesaFreq",
        value: String(f)
      }).catch(() => {});
    }
  };
  const toggle = k => {
    if (navigator.vibrate) navigator.vibrate([50]);
    setChecked({
      ...checked,
      [k]: !checked[k]
    });
  };
  const [extra, setExtra] = React.useState(() => window.storage ? window.storage.get("spesaExtra", []) : []);
  const [newItem, setNewItem] = React.useState("");
  const saveExtra = next => {
    setExtra(next);
    if (window.storage) window.storage.set("spesaExtra", next);
    if (window._saveSettingRetry) window._saveSettingRetry("spesaExtra", JSON.stringify(next));
  };
  const addExtra = () => {
    const name = newItem.trim();
    if (!name) return;
    saveExtra([...extra, {
      id: Date.now(),
      name
    }]);
    setNewItem("");
  };
  const removeExtra = id => {
    saveExtra(extra.filter(e => e.id !== id));
    const k = `extra-${id}`;
    if (checked[k]) {
      const c = {
        ...checked
      };
      delete c[k];
      setChecked(c);
    }
  };
  const changeFreq = f => {
    setFreq(f);
    setChecked({});
  };
  const reset = () => {
    setChecked({});
  };
  const totalItems = CATEGORIES.reduce((n, c) => n + c.items.length, 0) + extra.length;
  const totalDone = Object.values(checked).filter(Boolean).length;
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: isDesktop ? "32px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? 18 : 14
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end"
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Settimanale")), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 28 : 24,
      fontWeight: 600
    }
  }, t("Lista spesa"))), React.createElement("button", {
    className: "btn ghost",
    style: {
      padding: "8px 12px",
      fontSize: 13,
      color: "var(--accent)"
    },
    onClick: reset
  }, React.createElement(Icon, {
    name: "refresh",
    size: 14
  }), " ", t("Reset"))), React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 16 : 14
    }
  }, React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: "var(--text-2)",
      marginBottom: 10
    }
  }, "🛒 ", t("Quante volte fai la spesa a settimana?")), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, [{
    v: 1,
    label: "1 volta",
    sub: "tutto in una botta"
  }, {
    v: 2,
    label: "2 volte",
    sub: "metà + metà settimana"
  }].map(opt => {
    const on = freq === opt.v;
    return React.createElement("button", {
      key: opt.v,
      onClick: () => changeFreq(opt.v),
      style: {
        flex: 1,
        padding: "12px 10px",
        border: 0,
        borderRadius: 12,
        cursor: "pointer",
        background: on ? "var(--accent)" : "var(--card-2)",
        boxShadow: on ? "none" : "inset 0 0 0 1px var(--border)",
        transition: "all 0.16s",
        textAlign: "left"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: on ? "#fff" : "var(--text)",
        marginBottom: 2
      }
    }, t(opt.label)), React.createElement("div", {
      style: {
        fontSize: 11,
        color: on ? "rgba(255,255,255,0.75)" : "var(--text-3)"
      }
    }, t(opt.sub)));
  })), freq === 2 && React.createElement("div", {
    className: "fade-up",
    style: {
      marginTop: 10,
      fontSize: 12,
      color: "var(--text-3)",
      padding: "7px 10px",
      background: "rgba(10,132,255,0.06)",
      borderRadius: 9
    }
  }, "💡 ", t("Le quantità mostrate sono per"), " ", React.createElement("strong", {
    style: {
      color: "var(--text-2)"
    }
  }, t("una singola uscita")), " ", t("(metà settimana). Ripeti all'altra metà."))), React.createElement("div", {
    className: "card",
    style: {
      padding: 14
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 8
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13.5
    }
  }, React.createElement("span", {
    className: "num",
    style: {
      fontSize: 18,
      fontWeight: 600
    }
  }, totalDone), React.createElement("span", {
    className: "muted"
  }, " / ", totalItems, " ", t("articoli"))), React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 12
    }
  }, Math.round(totalDone / totalItems * 100), "%")), React.createElement("div", {
    className: "bar",
    style: {
      height: 6
    }
  }, React.createElement("i", {
    style: {
      width: `${totalDone / totalItems * 100}%`,
      background: "linear-gradient(90deg, #30D158 0%, #5AC8FA 100%)"
    }
  }))), totalDone > 0 && totalDone === totalItems && React.createElement(UIEmpty, {
    icon: "check",
    title: t("Spesa completata"),
    sub: t("Hai preso tutto — ottimo!"),
    style: {
      padding: "18px 16px 6px"
    }
  }), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr",
      gap: isDesktop ? 16 : 12
    }
  }, CATEGORIES.map(cat => React.createElement(CategorySection, {
    key: cat.id,
    cat: cat,
    checked: checked,
    onToggle: toggle,
    isDesktop: isDesktop,
    freq: freq
  }))), React.createElement("div", {
    className: "card lift",
    style: {
      padding: 0,
      overflow: "hidden"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 16px",
      background: "linear-gradient(90deg, rgba(191,90,242,0.13) 0%, transparent 100%)",
      borderLeft: "3px solid #BF5AF2"
    }
  }, React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: 9,
      background: "rgba(191,90,242,0.13)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement(Icon, {
    name: "plus",
    size: 16,
    color: "#BF5AF2"
  })), React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      letterSpacing: -0.01
    }
  }, t("Extra")), React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 11.5
    }
  }, extra.filter(e => checked[`extra-${e.id}`]).length, " / ", extra.length))), extra.map(e => React.createElement("div", {
    key: e.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 16px",
      borderTop: "1px solid var(--border)",
      opacity: checked[`extra-${e.id}`] ? 0.5 : 1
    }
  }, React.createElement("div", {
    onClick: ev => {
      if (!checked[`extra-${e.id}`] && window.Motion) window.Motion.pop(ev.currentTarget);
      toggle(`extra-${e.id}`);
    },
    className: `check ${checked[`extra-${e.id}`] ? "on" : ""}`,
    style: {
      width: 22,
      height: 22,
      cursor: "pointer",
      flexShrink: 0
    }
  }, React.createElement(Icon, {
    name: "check",
    size: 12,
    color: "#062810"
  })), React.createElement("div", {
    onClick: () => toggle(`extra-${e.id}`),
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 14.5,
      fontWeight: 500,
      cursor: "pointer",
      textDecoration: checked[`extra-${e.id}`] ? "line-through" : "none",
      color: checked[`extra-${e.id}`] ? "var(--text-2)" : "var(--text)"
    }
  }, e.name), React.createElement("button", {
    onClick: () => removeExtra(e.id),
    "aria-label": t("Rimuovi"),
    style: {
      width: 28,
      height: 28,
      borderRadius: 999,
      background: "transparent",
      border: 0,
      color: "var(--text-3)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 13,
    strokeWidth: 2.2
  })))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      padding: "12px 16px",
      borderTop: extra.length ? "1px solid var(--border)" : 0
    }
  }, React.createElement("input", {
    value: newItem,
    onChange: e => setNewItem(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") addExtra();
    },
    placeholder: t("Aggiungi articolo…"),
    className: "input",
    style: {
      flex: 1,
      fontSize: 14,
      padding: "10px 12px"
    }
  }), React.createElement("button", {
    className: "btn",
    style: {
      padding: "0 16px",
      fontSize: 13,
      fontWeight: 600
    },
    onClick: addExtra,
    disabled: !newItem.trim()
  }, React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", t("Aggiungi")))));
};
window.Spesa = Spesa;
})();

// ══ screens/coach.jsx ══
;(function () {
const _ACT_LABEL = {
  corsa: "corsa",
  bike: "bike",
  hiit: "HIIT",
  camminata: "camminata",
  ellittica: "ellittica"
};
const _QUICK_PROMPTS = ["Cosa mangio oggi?", "Posso aumentare il peso?", "Sostituisci esercizio", "Allenamento 45 min", "Riposo o cardio?", "Recupero ottimale"];
function _buildSystemPrompt({
  activities,
  checkIn,
  bodyWeight,
  lang
}) {
  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const sessLabel = sess ? `${sess.label} (${sess.muscles.join(", ")})` : "Riposo";
  const _days = window.getSchedule ? window.getSchedule().days || [] : [];
  const _dayCount = _days.length || 3;
  const _dayNames = _days.map(d => d.name).filter(Boolean).join(", ");
  const now = new Date();
  const h = now.getHours();
  const timeOfDay = h < 6 ? "notte" : h < 12 ? "mattina" : h < 15 ? "pranzo" : h < 18 ? "pomeriggio" : h < 21 ? "sera" : "sera tardi";
  const timeStr = now.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  });
  const dateStr = now.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
  const st = window.storage;
  const schedaData = (st ? st.get("schedaData", null) : null) || window.SCHEDA_TXT_FALLBACK || null;
  const dietaData = (st ? st.get("dietaData", null) : null) || window.DIETA_TXT_FALLBACK || null;
  const today = window.todayKey ? window.todayKey() : now.toISOString().slice(0, 10);
  const sessionNotes = st ? st.get(`notes_${today}`, "") : "";
  const replyLang = lang === "en" ? "inglese" : "italiano";
  let prompt = `Sei il personal coach di Lorenzo Faraoni: preciso, motivante, esperto di powerbuilding (periodizzazione, progressione) e nutrizione (bulk lento, timing proteine, manipolazione carbo). Rispondi in ${replyLang}, conciso (2-5 frasi), tono diretto da coach che lo conosce bene da anni.

Lorenzo: ${bodyWeight || 77.5}kg, 178cm.
Oggi: ${dateStr} — ${sessLabel}.
Ora: ${timeStr} (${timeOfDay}).
Piano (${_dayCount} giorni, selezione manuale): ${_dayNames || "n/d"}. Cardio: camminata + ellittica nei giorni di riposo.
ESCLUDERE SEMPRE dalla dieta: pasta di ceci, lenticchie, piselli, bevanda di mandorla.`;
  if (checkIn) {
    const lvl = v => ["", "pessimo", "basso", "medio", "buono", "ottimo"][Math.max(1, Math.min(5, v || 3))];
    prompt += `\n\nCheck-in oggi: sonno ${lvl(checkIn.sleep)} (${checkIn.sleep}/5), energia ${lvl(checkIn.energy)} (${checkIn.energy}/5)${checkIn.ailments ? `, fastidi: "${checkIn.ailments}"` : ""}.`;
    if (checkIn.sleep <= 2 || checkIn.energy <= 2) {
      prompt += ` ⚠️ Recupero scarso — suggerisci di ridurre l'intensità o tagliare l'ultima serie se rilevante.`;
    }
  }
  if (activities && activities.length > 0) {
    const recent = activities.slice(0, 5).map(a => `• ${a.when}: ${_ACT_LABEL[a.type] || a.type} ${a.min}min${a.km ? " " + a.km + "km" : ""}${a.note ? " (" + a.note + ")" : ""}`).join("\n");
    prompt += `\n\nCardio recente:\n${recent}`;
  }
  if (sessionNotes) {
    prompt += `\n\nNote scheda di oggi: "${sessionNotes}"`;
  }
  const prMap = st ? st.get("prMap", {}) : {};
  const prKeys = Object.keys(prMap || {});
  if (prKeys.length) {
    const prList = prKeys.slice(0, 15).map(k => `${k} ${prMap[k].peso}kg`).join(", ");
    prompt += `\n\nRecord personali (massimale caricato per esercizio): ${prList}.`;
  }
  if (window.WorkoutProgress && st) {
    const dates = window.WorkoutProgress.lastNDates(today, 7);
    const hist = dates.map(d => ({
      date: d,
      muscleSets: st.get(`muscleSets_${d}`, null)
    })).filter(h => h.muscleSets);
    const vol = window.WorkoutProgress.aggregateVolume(hist);
    if (vol.total > 0) {
      const parts = vol.order.map(g => `${g} ${vol.byGroup[g]}`).join(", ");
      prompt += `\nVolume ultimi 7 giorni (serie per gruppo): ${parts} (totale ${vol.total} serie).`;
    }
  }
  if (st) {
    const mealChecked = st.get(`dietaCheck_${today}`, {});
    const done = Object.keys(mealChecked).filter(k => mealChecked[k]).length;
    if (done > 0) prompt += `\nPasti già consumati oggi (spuntati): ${done}.`;
  }
  if (st) {
    const measures = st.get("bodyMeasures", []);
    const lastM = measures.length ? measures[measures.length - 1] : null;
    if (lastM) {
      const parts = ["vita", "fianchi", "torace", "braccio", "coscia"].filter(k => lastM[k] > 0).map(k => `${k} ${lastM[k]}cm`).join(", ");
      if (parts) prompt += `\nMisure corporee (${lastM.date}): ${parts}.`;
    }
  }
  if (schedaData) {
    const txt = schedaData.length > 3000 ? schedaData.slice(0, 3000) + "\n[…troncato]" : schedaData;
    prompt += `\n\n=== SCHEDA ALLENAMENTO (file caricato) ===\n${txt}`;
  } else {
    prompt += `\n\nScheda: nessun file caricato. Chiedi a Lorenzo di importare la sua scheda .txt dalle Impostazioni.`;
  }
  if (dietaData) {
    const txt = dietaData.length > 3000 ? dietaData.slice(0, 3000) + "\n[…troncato]" : dietaData;
    prompt += `\n\n=== PIANO ALIMENTARE (file caricato — usa questi dati come riferimento primario) ===\n${txt}`;
  } else {
    prompt += `\n\nDieta: bulk lento. Proteine: ~180g/die.`;
    prompt += `\nIntegratori: MGK pre-WO, Omnia intra/post, Barretta 4Plus 45g (snack ore 17/21/22).`;
  }
  return prompt;
}
const CoachAvatar = ({
  small
}) => React.createElement("div", {
  style: {
    width: small ? 26 : 32,
    height: small ? 26 : 32,
    borderRadius: 999,
    flexShrink: 0,
    background: "linear-gradient(135deg, #0A84FF 0%, #5e5ce6 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  }
}, React.createElement(Icon, {
  name: "spark",
  size: small ? 13 : 16,
  color: "#fff",
  strokeWidth: 2.2
}));
const TypingDots = () => React.createElement("span", {
  style: {
    display: "inline-flex",
    gap: 3,
    alignItems: "center",
    padding: "4px 2px"
  }
}, [0, 1, 2].map(i => React.createElement("span", {
  key: i,
  style: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "var(--text-2)",
    animation: `coachBounce 1.2s infinite ${i * 0.15}s`
  }
})), React.createElement("style", null, `@keyframes coachBounce { 0%,60%,100% { opacity:0.3; transform:translateY(0); } 30% { opacity:1; transform:translateY(-3px); } }`));
const Bubble = ({
  m
}) => {
  if (m.role === "user") {
    return React.createElement("div", {
      className: "fade-up",
      style: {
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: 4
      }
    }, React.createElement("div", {
      style: {
        maxWidth: "78%",
        padding: "10px 14px",
        background: "var(--brand-grad)",
        color: "#fff",
        borderRadius: 18,
        borderBottomRightRadius: 4,
        fontSize: 14,
        lineHeight: 1.45,
        fontWeight: 500,
        letterSpacing: -0.005
      }
    }, m.text));
  }
  if (m.role === "error") {
    return React.createElement("div", {
      className: "fade-up",
      style: {
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        marginBottom: 4
      }
    }, React.createElement(CoachAvatar, {
      small: true
    }), React.createElement("div", {
      style: {
        maxWidth: "78%",
        padding: "10px 14px",
        background: "rgba(255,69,58,0.12)",
        color: "var(--danger)",
        borderRadius: 18,
        borderBottomLeftRadius: 4,
        border: "1px solid rgba(255,69,58,0.2)",
        fontSize: 13.5,
        lineHeight: 1.45
      }
    }, m.text));
  }
  return React.createElement("div", {
    className: "fade-up",
    style: {
      display: "flex",
      gap: 8,
      alignItems: "flex-end",
      marginBottom: 4
    }
  }, React.createElement(CoachAvatar, {
    small: true
  }), React.createElement("div", {
    style: {
      maxWidth: "78%",
      padding: "10px 14px",
      background: "var(--card)",
      color: "var(--text)",
      borderRadius: 18,
      borderBottomLeftRadius: 4,
      border: "1px solid var(--border)",
      fontSize: 14,
      lineHeight: 1.5,
      letterSpacing: -0.003,
      whiteSpace: "pre-wrap"
    }
  }, m.text));
};
const Coach = ({
  device,
  onNav,
  activities = [],
  checkIn,
  bodyWeight
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const {
    lang
  } = useLang();
  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const greeting = sess ? `${t("Ciao Lorenzo! Oggi tocca")} ${sess.label}. ${t("Sono pronto — chiedimi su scheda, dieta o recupero.")}` : t("Ciao Lorenzo! Oggi è un giorno di riposo. Parliamo di recupero, nutrizione o programmazione?");
  const chatKey = `coachChat_${window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10)}`;
  const [messages, setMessages] = React.useState(() => {
    const saved = window.storage ? window.storage.get(chatKey, null) : null;
    return Array.isArray(saved) && saved.length ? saved : [{
      role: "assistant",
      text: greeting
    }];
  });
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (window.storage && messages.length > 1) window.storage.set(chatKey, messages.slice(-40));
  }, [messages]);
  const resetChat = () => {
    if (window.storage) window.storage.remove(chatKey);
    setMessages([{
      role: "assistant",
      text: greeting
    }]);
  };
  const [partial, setPartial] = React.useState(null);
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy, partial]);
  const send = async text => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, {
      role: "user",
      text: q
    }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const history = next.filter(m => m.role === "user" || m.role === "assistant").slice(-10).map(m => ({
        role: m.role,
        content: m.text
      }));
      const reply = await window.groqAPI.complete({
        messages: history,
        systemPrompt: _buildSystemPrompt({
          activities,
          checkIn,
          bodyWeight,
          lang
        }),
        model: "llama-3.3-70b-versatile",
        maxTokens: 512,
        onDelta: txt => setPartial(txt)
      });
      setMessages(ms => [...ms, {
        role: "assistant",
        text: reply
      }]);
    } catch (err) {
      const errText = err.message || t("Errore sconosciuto");
      const isNoKey = errText.toLowerCase().includes("api key") || errText.toLowerCase().includes("configurata");
      setMessages(ms => [...ms, {
        role: "error",
        text: isNoKey ? "⚙️ " + t("API key Groq non configurata. Vai in Impostazioni → Coach per inserirla. È gratuita su console.groq.com") : `⚠️ ${errText}`
      }]);
    } finally {
      setPartial(null);
      setBusy(false);
    }
  };
  const handleKeyDown = e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  const [hasKey, setHasKey] = React.useState(() => !!(window.storage && (window.storage.get("groqApiKey", "") || "").trim()));
  React.useEffect(() => {
    if (hasKey || !window.groqAPI || !window.groqAPI.proxyAvailable) return;
    let alive = true;
    window.groqAPI.proxyAvailable().then(ok => {
      if (alive && ok) setHasKey(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const ctxChips = [{
    emoji: sess ? "🏋️" : "🛌",
    label: sess ? `${t("Oggi")} · ${sess.label}` : t("Riposo")
  }];
  if (bodyWeight) ctxChips.push({
    emoji: "⚖️",
    label: `${bodyWeight} kg`
  });
  if (checkIn) ctxChips.push({
    emoji: "✅",
    label: t("Check-in ok")
  });
  return React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden"
    }
  }, React.createElement("div", {
    style: {
      padding: isDesktop ? "20px 40px 12px" : "12px 16px 10px",
      borderBottom: "1px solid var(--border)",
      background: "var(--bg-2)",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, React.createElement(CoachAvatar, null), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: isDesktop ? 19 : 17,
      fontWeight: 600,
      letterSpacing: -0.015
    }
  }, t("AI Coach")), React.createElement("div", {
    style: {
      fontSize: 11.5,
      minHeight: 14,
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: busy ? "var(--accent)" : "var(--text-2)"
    }
  }, busy ? React.createElement(React.Fragment, null, React.createElement(TypingDots, null), " ", t("Sta scrivendo…")) : hasKey ? t("Pronto ad aiutarti") : t("Non configurato"))), messages.length > 1 && React.createElement("button", {
    onClick: resetChat,
    title: t("Nuova chat"),
    disabled: busy,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      flexShrink: 0,
      background: "var(--card)",
      border: "1px solid var(--border)",
      color: "var(--text)",
      borderRadius: 999,
      padding: "7px 12px",
      fontSize: 12,
      fontWeight: 600,
      cursor: busy ? "default" : "pointer"
    }
  }, React.createElement(Icon, {
    name: "plus",
    size: 13,
    strokeWidth: 2.2
  }), t("Nuova chat"))), React.createElement("div", {
    className: "hscroll",
    style: {
      display: "flex",
      gap: 7
    }
  }, ctxChips.map((c, i) => React.createElement("span", {
    key: i,
    style: {
      flex: "none",
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      background: "var(--card-2)",
      border: "1px solid var(--border)",
      borderRadius: 999,
      padding: "6px 11px",
      fontSize: 11.5,
      fontWeight: 500,
      color: "var(--text-2)",
      whiteSpace: "nowrap"
    }
  }, React.createElement("span", null, c.emoji), c.label)))), hasKey ? React.createElement(React.Fragment, null, React.createElement("div", {
    ref: scrollRef,
    style: {
      flex: 1,
      overflowY: "auto",
      padding: isDesktop ? "18px 40px" : "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 2,
      scrollbarWidth: "none"
    }
  }, React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      margin: "2px 0 8px"
    }
  }, t("Oggi")), messages.map((m, i) => React.createElement(Bubble, {
    key: i,
    m: m
  })), busy && partial != null && React.createElement(Bubble, {
    m: {
      role: "assistant",
      text: partial
    }
  }), busy && partial == null && React.createElement("div", {
    className: "fade-up",
    style: {
      display: "flex",
      gap: 8,
      alignItems: "flex-end",
      marginBottom: 4
    }
  }, React.createElement(CoachAvatar, {
    small: true
  }), React.createElement("div", {
    style: {
      maxWidth: "78%",
      padding: "10px 14px",
      background: "var(--card)",
      borderRadius: 18,
      borderBottomLeftRadius: 4,
      border: "1px solid var(--border)"
    }
  }, React.createElement(UISkeleton, {
    h: 11,
    w: 180,
    style: {
      marginBottom: 7
    }
  }), React.createElement(UISkeleton, {
    h: 11,
    w: 120
  })))), React.createElement("div", {
    style: {
      padding: isDesktop ? "10px 40px 24px" : "8px 16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 9,
      borderTop: "1px solid var(--glass-border)",
      backgroundColor: "var(--glass)",
      backgroundImage: "var(--glass-sheen)",
      backdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
      WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(var(--glass-sat))",
      boxShadow: "inset 0 1px 0 var(--glass-edge)",
      flexShrink: 0
    }
  }, React.createElement("div", {
    className: "hscroll",
    style: {
      display: "flex",
      gap: 7
    }
  }, _QUICK_PROMPTS.map(p => React.createElement("button", {
    key: p,
    onClick: () => send(p),
    disabled: busy,
    style: {
      flex: "none",
      background: "rgba(10,132,255,0.14)",
      border: "1px solid var(--border)",
      borderRadius: 999,
      padding: "7px 12px",
      fontSize: 12,
      fontWeight: 500,
      color: "var(--accent)",
      whiteSpace: "nowrap",
      cursor: busy ? "default" : "pointer",
      opacity: busy ? 0.5 : 1
    }
  }, t(p)))), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "var(--card)",
      borderRadius: 999,
      padding: "4px 6px 4px 18px",
      border: "1px solid var(--border)"
    }
  }, React.createElement("input", {
    value: input,
    onChange: e => setInput(e.target.value),
    onKeyDown: handleKeyDown,
    placeholder: t("Chiedi al coach…"),
    disabled: busy,
    style: {
      flex: 1,
      background: "transparent",
      border: 0,
      outline: "none",
      color: "var(--text)",
      fontSize: 14,
      padding: "10px 0",
      fontFamily: "inherit"
    }
  }), React.createElement("button", {
    disabled: busy || !input.trim(),
    onClick: () => send(),
    style: {
      width: 38,
      height: 38,
      borderRadius: 999,
      background: input.trim() && !busy ? "var(--brand-grad)" : "var(--card-2)",
      color: "#fff",
      border: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: input.trim() && !busy ? "pointer" : "default",
      transition: "background 0.16s"
    }
  }, React.createElement(Icon, {
    name: "send",
    size: 16,
    strokeWidth: 2.2
  }))))) : React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: "40px 34px",
      textAlign: "center"
    }
  }, React.createElement("div", {
    style: {
      width: 66,
      height: 66,
      borderRadius: 20,
      background: "var(--card)",
      border: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--warning)"
    }
  }, React.createElement(Icon, {
    name: "key",
    size: 28,
    strokeWidth: 1.8
  })), React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 600
    }
  }, t("Coach non configurato")), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13.5,
      maxWidth: 250,
      lineHeight: 1.5
    }
  }, t("Serve una API key per parlare con l'allenatore AI. Configurala nel profilo per iniziare.")), React.createElement("button", {
    onClick: () => onNav && onNav("impostazioni"),
    style: {
      border: "none",
      borderRadius: "var(--r)",
      background: "var(--brand-grad)",
      color: "#fff",
      fontSize: 16,
      fontWeight: 600,
      padding: "14px 22px",
      cursor: "pointer",
      boxShadow: "0 12px 28px -12px rgba(10,132,255,0.7)"
    }
  }, t("Configura in Profilo"))));
};
window.Coach = Coach;
})();

// ══ screens/storico.jsx ══
;(function () {
const _ACTIVITY_ICONS = {
  corsa: "🏃",
  bike: "🚴",
  hiit: "⚡",
  camminata: "🚶",
  ellittica: "🔄"
};
const _ACTIVITY_COLORS = {
  corsa: "#FF453A",
  bike: "#FF9F0A",
  hiit: "#BF5AF2",
  camminata: "#30D158",
  ellittica: "#5AC8FA"
};
const WeightChart = ({
  data,
  isDesktop
}) => {
  const t = useT();
  const [rechartsReady, setRechartsReady] = React.useState(!!window.Recharts);
  React.useEffect(() => {
    if (window.Recharts) {
      setRechartsReady(true);
      return;
    }
    const id = setInterval(() => {
      if (window.Recharts) {
        setRechartsReady(true);
        clearInterval(id);
      }
    }, 300);
    return () => clearInterval(id);
  }, []);
  if (!rechartsReady) {
    return React.createElement("div", {
      style: {
        padding: "8px 0"
      }
    }, React.createElement(UISkeleton, {
      h: 180,
      r: 14
    }));
  }
  const {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine
  } = window.Recharts;
  if (!data || data.length === 0) {
    return React.createElement(UIEmpty, {
      icon: "trend-up",
      title: t("Ancora nessun peso"),
      sub: t("Nessun dato peso — aggiorna il peso dalla Dashboard")
    });
  }
  const vals = data.map(d => d.weight);
  const minW = Math.floor(Math.min(...vals) - 1);
  const maxW = Math.ceil(Math.max(...vals) + 1);
  const last = data[data.length - 1]?.weight;
  const first = data[0]?.weight;
  const trend = last - first;
  const maMap = window.Insights ? window.Insights.movingAverage(data, 7).reduce((m, p) => {
    m[p.date] = p.ma;
    return m;
  }, {}) : {};
  const formatted = data.map(d => ({
    ...d,
    ma: maMap[d.date],
    label: d.date ? d.date.slice(5) : d.date
  }));
  const CustomTooltip = ({
    active,
    payload
  }) => {
    if (!active || !payload?.length) return null;
    return React.createElement("div", {
      style: {
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 12.5
      }
    }, React.createElement("div", {
      className: "num",
      style: {
        fontWeight: 700,
        fontSize: 15
      }
    }, payload[0].value, " kg"), React.createElement("div", {
      className: "muted"
    }, payload[0].payload.date));
  };
  return React.createElement("div", null, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 16
    }
  }, React.createElement("div", null, React.createElement("div", {
    className: "num",
    style: {
      fontSize: isDesktop ? 32 : 28,
      fontWeight: 600,
      letterSpacing: -0.03
    }
  }, last, " kg"), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12.5,
      marginTop: 2
    }
  }, data.length, " ", t("misurazioni"), " · ", t("da"), " ", data[0]?.date)), React.createElement("div", {
    style: {
      padding: "6px 12px",
      borderRadius: 10,
      fontSize: 13,
      fontWeight: 600,
      background: trend <= 0 ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.12)",
      color: trend <= 0 ? "var(--success)" : "var(--danger)"
    }
  }, React.createElement("span", {
    className: "tnum"
  }, trend > 0 ? "+" : "", trend.toFixed(1), " kg"))), React.createElement(ResponsiveContainer, {
    width: "100%",
    height: isDesktop ? 200 : 160
  }, React.createElement(LineChart, {
    data: formatted,
    margin: {
      top: 4,
      right: 4,
      bottom: 0,
      left: -20
    }
  }, React.createElement(CartesianGrid, {
    strokeDasharray: "3 3",
    stroke: "var(--border)"
  }), React.createElement(XAxis, {
    dataKey: "label",
    tick: {
      fill: "var(--text-3)",
      fontSize: 10
    },
    tickLine: false,
    axisLine: false
  }), React.createElement(YAxis, {
    domain: [minW, maxW],
    tick: {
      fill: "var(--text-3)",
      fontSize: 10
    },
    tickLine: false,
    axisLine: false
  }), React.createElement(Tooltip, {
    content: React.createElement(CustomTooltip, null)
  }), React.createElement(Line, {
    type: "monotone",
    dataKey: "weight",
    stroke: "var(--accent)",
    strokeWidth: 2,
    dot: {
      fill: "var(--accent)",
      strokeWidth: 0,
      r: 3
    },
    activeDot: {
      r: 5
    }
  }), React.createElement(Line, {
    type: "monotone",
    dataKey: "ma",
    stroke: "#FF9F0A",
    strokeWidth: 1.6,
    strokeDasharray: "5 3",
    dot: false,
    activeDot: false,
    isAnimationActive: false
  }))), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10.5,
      marginTop: 4,
      display: "flex",
      alignItems: "center",
      gap: 5,
      justifyContent: "flex-end"
    }
  }, React.createElement("span", {
    style: {
      display: "inline-block",
      width: 16,
      borderTop: "2px dashed #FF9F0A"
    }
  }), t("Media 7 giorni")));
};
const GoalRow = ({
  weightLog
}) => {
  const t = useT();
  const [goal, setGoal] = React.useState(() => {
    const g = window.storage ? window.storage.get("weightGoal", "") : "";
    return g ? String(g) : "";
  });
  const save = v => {
    setGoal(v);
    const n = parseFloat(String(v).replace(",", "."));
    if (window.storage) window.storage.set("weightGoal", n > 0 ? n : "");
    if (window._saveSettingRetry && n > 0) window._saveSettingRetry("weightGoal", n);
  };
  const proj = window.Insights && weightLog && weightLog.length >= 2 ? window.Insights.weightProjection(weightLog, goal || null) : null;
  const fmtEta = iso => {
    try {
      return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
        day: "numeric",
        month: "short"
      });
    } catch (_) {
      return iso;
    }
  };
  return React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 14,
      borderTop: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--text-2)",
      flex: 1
    }
  }, "🎯 ", t("Obiettivo")), React.createElement("input", {
    inputMode: "decimal",
    value: goal,
    onChange: e => save(e.target.value.replace(/[^0-9.,]/g, "")),
    placeholder: "kg",
    className: "input input-mono",
    style: {
      width: 76,
      padding: "8px 10px",
      fontSize: 14,
      textAlign: "center"
    }
  }), React.createElement("span", {
    className: "muted",
    style: {
      fontSize: 12
    }
  }, "kg")), proj && React.createElement("div", {
    className: "tnum",
    style: {
      fontSize: 12,
      color: "var(--text-2)",
      marginTop: 8,
      lineHeight: 1.5
    }
  }, t("Ritmo attuale"), ": ", React.createElement("strong", {
    style: {
      color: proj.ratePerWeek <= 0 ? "var(--success)" : "#FF9F0A"
    }
  }, proj.ratePerWeek > 0 ? "+" : "", proj.ratePerWeek, " ", t("kg/sett")), proj.reached ? React.createElement(React.Fragment, null, " · ", t("Obiettivo raggiunto 🎉")) : proj.etaDate ? React.createElement(React.Fragment, null, " · ", t("a questo ritmo arrivi a"), " ", React.createElement("strong", {
    style: {
      color: "var(--text)"
    }
  }, proj.target, " kg"), " ~", fmtEta(proj.etaDate)) : proj.target ? React.createElement(React.Fragment, null, " · ", t("il trend attuale si allontana dall'obiettivo")) : null));
};
const RegistroView = ({
  isDesktop
}) => {
  const t = useT();
  const [rows, setRows] = React.useState(null);
  const localFallback = () => {
    if (!window.storage || !window.storage.keys) return [];
    return window.storage.keys().filter(k => /^gym_\d{4}-\d{2}-\d{2}$/.test(k) && window.storage.get(k, false)).map(k => k.slice(4)).sort().reverse().slice(0, 30).map(date => {
      const ms = window.storage.get(`muscleSets_${date}`, null) || {};
      const sets = Object.values(ms).reduce((s, n) => s + (Number(n) || 0), 0);
      return {
        date,
        type: "",
        setsCompleted: sets,
        totalSets: 0,
        notes: window.storage.get(`notes_${date}`, ""),
        local: true,
        groups: Object.keys(ms).join(" · ")
      };
    });
  };
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.sheetsAPI.getSessioni) {
      setRows(localFallback());
      return;
    }
    window.sheetsAPI.getSessioni().then(r => setRows(Array.isArray(r) && r.length ? r.slice().reverse() : localFallback())).catch(() => setRows(localFallback()));
  }, []);
  if (rows === null) return React.createElement(UISkeleton, {
    h: 140,
    r: 14
  });
  if (!rows.length) {
    return React.createElement(UIEmpty, {
      icon: "calendar",
      title: t("Nessuna sessione registrata"),
      sub: t("Chiudi una sessione dalla Scheda per vederla qui"),
      style: {
        padding: "20px 16px"
      }
    });
  }
  const fmtDay = iso => {
    try {
      return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
        weekday: "short",
        day: "2-digit",
        month: "2-digit"
      });
    } catch (_) {
      return iso;
    }
  };
  return React.createElement("div", null, rows.map((r, i) => React.createElement("div", {
    key: r.date + "-" + i,
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      padding: "10px 0",
      borderTop: i > 0 ? "1px solid var(--border)" : 0
    }
  }, React.createElement("div", {
    style: {
      width: 86,
      flexShrink: 0
    }
  }, React.createElement("div", {
    className: "num",
    style: {
      fontSize: 12.5,
      fontWeight: 600
    }
  }, fmtDay(r.date)), r.ora && React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 10.5,
      marginTop: 1
    }
  }, r.ora)), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      flexWrap: "wrap"
    }
  }, r.type ? React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10.5,
      padding: "2px 8px",
      fontWeight: 600
    }
  }, r.type) : null, React.createElement("span", {
    className: "tnum",
    style: {
      fontSize: 12.5,
      color: "var(--text-2)"
    }
  }, r.setsCompleted, r.totalSets ? `/${r.totalSets}` : "", " ", t("serie"))), (r.groups || r.notes) && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 11.5,
      marginTop: 3,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, r.groups || r.notes)))), rows[0] && rows[0].local && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10.5,
      marginTop: 8,
      textAlign: "center"
    }
  }, t("Solo dati locali — aggiorna il backend per lo storico completo")));
};
const CheckInTrend = ({
  isDesktop
}) => {
  const t = useT();
  const [refreshKey, setRefreshKey] = React.useState(0);
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.storage) return;
    window.sheetsAPI.getCheckIn().then(rows => {
      if (!Array.isArray(rows) || !rows.length) return;
      rows.forEach(r => {
        if (r.date && (r.sleep || r.energy)) {
          window.storage.set(`checkIn_${r.date}`, {
            sleep: r.sleep || 0,
            energy: r.energy || 0,
            ailments: r.ailments || ""
          });
        }
      });
      setRefreshKey(k => k + 1);
    }).catch(() => {});
  }, []);
  const data = React.useMemo(() => {
    if (!window.storage) return [];
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const ci = window.storage.get(`checkIn_${key}`, null);
      days.push({
        date: key,
        label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        sleep: ci?.sleep || null,
        energy: ci?.energy || null
      });
    }
    return days;
  }, [refreshKey]);
  const filled = data.filter(d => d.sleep !== null);
  if (!filled.length) return React.createElement(UIEmpty, {
    icon: "spark",
    title: t("Nessun check-in"),
    sub: t("Nessun check-in disponibile"),
    style: {
      padding: "20px 16px"
    }
  });
  const avgSleep = (filled.reduce((s, d) => s + d.sleep, 0) / filled.length).toFixed(1);
  const avgEnergy = (filled.reduce((s, d) => s + d.energy, 0) / filled.length).toFixed(1);
  const lvlColor = v => v >= 4 ? "var(--success)" : v >= 3 ? "#FF9F0A" : "var(--danger)";
  return React.createElement("div", null, React.createElement("div", {
    style: {
      display: "flex",
      gap: isDesktop ? 24 : 16,
      marginBottom: 14
    }
  }, [{
    label: t("Media sonno"),
    value: avgSleep,
    icon: "🌙",
    color: lvlColor(parseFloat(avgSleep))
  }, {
    label: t("Media energia"),
    value: avgEnergy,
    icon: "⚡",
    color: lvlColor(parseFloat(avgEnergy))
  }, {
    label: t("Giorni log"),
    value: `${filled.length}/14`,
    icon: "📋",
    color: "var(--text)"
  }].map(stat => React.createElement("div", {
    key: stat.label,
    style: {
      flex: 1,
      textAlign: "center"
    }
  }, React.createElement("div", {
    style: {
      fontSize: 20,
      marginBottom: 4
    }
  }, stat.icon), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 20,
      fontWeight: 600,
      color: stat.color
    }
  }, stat.value), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10.5,
      marginTop: 1
    }
  }, stat.label)))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      alignItems: "flex-end"
    }
  }, data.map((d, i) => {
    const hasData = d.sleep !== null;
    const score = hasData ? (d.sleep + d.energy) / 2 : 0;
    const bg = !hasData ? "var(--card-2)" : score >= 4 ? "rgba(48,209,88,0.8)" : score >= 3 ? "rgba(255,159,10,0.7)" : "rgba(255,69,58,0.6)";
    return React.createElement("div", {
      key: d.date,
      title: `${d.date}${hasData ? ` · Sonno ${d.sleep}/5 · Energia ${d.energy}/5` : ""}`,
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4
      }
    }, React.createElement("div", {
      style: {
        height: 28,
        width: "100%",
        borderRadius: 5,
        background: bg,
        transition: "background 0.2s"
      }
    }), i % 4 === 0 && React.createElement("div", {
      className: "num",
      style: {
        fontSize: 8.5,
        color: "var(--text-3)",
        textAlign: "center"
      }
    }, d.label));
  })), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: 8,
      justifyContent: "flex-end"
    }
  }, [{
    color: "rgba(48,209,88,0.8)",
    label: "4-5"
  }, {
    color: "rgba(255,159,10,0.7)",
    label: "3"
  }, {
    color: "rgba(255,69,58,0.6)",
    label: "1-2"
  }, {
    color: "var(--card-2)",
    label: t("no data")
  }].map(l => React.createElement("div", {
    key: l.label,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4,
      fontSize: 10
    }
  }, React.createElement("div", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 2,
      background: l.color
    }
  }), React.createElement("span", {
    className: "muted"
  }, l.label)))));
};
const ActivityRow = ({
  act,
  isDesktop
}) => {
  const t = useT();
  const icon = _ACTIVITY_ICONS[act.type] || "🏃";
  const color = _ACTIVITY_COLORS[act.type] || "var(--accent)";
  return React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 0",
      borderTop: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 10,
      background: `${color}22`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      fontSize: 18
    }
  }, icon), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: -0.01
    }
  }, act.type ? t(act.type.charAt(0).toUpperCase() + act.type.slice(1)) : t("Attività")), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12,
      marginTop: 1
    }
  }, React.createElement("span", {
    className: "num"
  }, act.min), " min", act.km ? React.createElement(React.Fragment, null, " · ", React.createElement("span", {
    className: "num"
  }, act.km), " km") : "", act.note ? ` · ${act.note}` : "")), React.createElement("div", {
    style: {
      textAlign: "right"
    }
  }, React.createElement("div", {
    className: "num muted",
    style: {
      fontSize: 12
    }
  }, t(act.when)), act.km > 0 && act.min > 0 && React.createElement("div", {
    className: "num",
    style: {
      fontSize: 11,
      color,
      fontWeight: 600,
      marginTop: 2
    }
  }, (act.km / act.min * 60).toFixed(1), " km/h")));
};
const _GROUP_COLORS = {
  Petto: "var(--accent)",
  Schiena: "#5AC8FA",
  Gambe: "#30D158",
  Spalle: "#FF9F0A",
  Braccia: "#BF5AF2",
  Core: "#FF453A",
  Altro: "var(--text-3)"
};
const VolumeView = ({
  isDesktop
}) => {
  const t = useT();
  const data = React.useMemo(() => {
    if (!window.storage || !window.WorkoutProgress) return {
      byGroup: {},
      total: 0,
      order: [],
      days: 0
    };
    const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
    const dates = window.WorkoutProgress.lastNDates(today, 7);
    const hist = dates.map(d => ({
      date: d,
      muscleSets: window.storage.get(`muscleSets_${d}`, null)
    })).filter(h => h.muscleSets && Object.keys(h.muscleSets).length);
    const agg = window.WorkoutProgress.aggregateVolume(hist);
    return Object.assign({}, agg, {
      days: hist.length
    });
  }, []);
  if (!data.total) {
    return React.createElement("div", {
      style: {
        padding: "24px 0",
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 28,
        marginBottom: 8
      }
    }, "💪"), React.createElement("div", {
      className: "muted",
      style: {
        fontSize: 13
      }
    }, t("Nessun allenamento negli ultimi 7 giorni")));
  }
  const max = Math.max.apply(null, data.order.map(g => data.byGroup[g]));
  return React.createElement("div", null, data.order.map(g => {
    const v = data.byGroup[g];
    const col = _GROUP_COLORS[g] || "var(--text-3)";
    return React.createElement("div", {
      key: g,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0"
      }
    }, React.createElement("div", {
      style: {
        width: 62,
        fontSize: 13,
        color: "var(--text-2)",
        flexShrink: 0
      }
    }, t(g)), React.createElement("div", {
      style: {
        flex: 1,
        height: 10,
        borderRadius: 999,
        background: "var(--track)",
        overflow: "hidden"
      }
    }, React.createElement("div", {
      style: {
        width: `${max ? v / max * 100 : 0}%`,
        height: "100%",
        borderRadius: 999,
        background: col,
        transition: "width 0.4s"
      }
    })), React.createElement("div", {
      className: "num",
      style: {
        width: 26,
        textAlign: "right",
        fontSize: 14,
        fontWeight: 600
      }
    }, v));
  }), React.createElement("div", {
    className: "muted tnum",
    style: {
      fontSize: 11.5,
      marginTop: 10,
      paddingTop: 10,
      borderTop: "1px solid var(--border)",
      textAlign: "center"
    }
  }, data.total, " ", t("serie"), " · ", data.days, " ", t("sessioni")));
};
const ForzaView = ({
  isDesktop
}) => {
  const t = useT();
  const [pesiMap, setPesiMap] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => {
    if (!window.sheetsAPI) {
      setPesiMap({});
      return;
    }
    window.sheetsAPI.getPesi().then(d => setPesiMap(d && typeof d === "object" ? d : {})).catch(() => setPesiMap({}));
  }, []);
  const [chartReady, setChartReady] = React.useState(!!window.Recharts);
  React.useEffect(() => {
    if (chartReady) return;
    const id = setInterval(() => {
      if (window.Recharts) {
        setChartReady(true);
        clearInterval(id);
      }
    }, 300);
    return () => clearInterval(id);
  }, []);
  const list = React.useMemo(() => {
    if (!pesiMap || !window.Insights) return [];
    return Object.keys(pesiMap).map(name => {
      const sessions = window.Insights.exerciseSessions(pesiMap, name, 12).slice().reverse();
      const points = sessions.map(s => {
        let best = null;
        s.sets.forEach(x => {
          const v = window.Insights.e1rm(x.peso, x.rip);
          if (v != null && (best == null || v > best)) best = v;
        });
        return {
          date: s.date,
          label: s.date.slice(5),
          e1rm: best
        };
      }).filter(p => p.e1rm != null);
      if (!points.length) return null;
      const latest = points[points.length - 1].e1rm;
      const delta = Math.round((latest - points[0].e1rm) * 10) / 10;
      return {
        name,
        points,
        latest,
        delta
      };
    }).filter(Boolean).sort((a, b) => b.latest - a.latest).slice(0, 10);
  }, [pesiMap]);
  if (pesiMap === null) return React.createElement(UISkeleton, {
    h: 160,
    r: 14
  });
  if (!list.length) {
    return React.createElement(UIEmpty, {
      icon: "dumbbell",
      title: t("Ancora nessun dato forza"),
      sub: t("Chiudi qualche sessione con i pesi segnati per vedere l'e1RM stimato"),
      style: {
        padding: "20px 16px"
      }
    });
  }
  const sel = list.find(e => e.name === selected) || null;
  const R = chartReady ? window.Recharts : null;
  return React.createElement("div", null, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 11.5,
      marginBottom: 8
    }
  }, t("e1RM = massimale stimato (formula di Epley). Tocca un esercizio per il trend.")), list.map(e => {
    const on = selected === e.name;
    return React.createElement("div", {
      key: e.name
    }, React.createElement("div", {
      className: "pressable",
      onClick: () => setSelected(on ? null : e.name),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 2px",
        borderTop: "1px solid var(--border)",
        cursor: "pointer"
      }
    }, React.createElement("div", {
      style: {
        flex: 1,
        fontSize: 13.5,
        fontWeight: on ? 700 : 500,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: on ? "var(--accent)" : "var(--text)"
      }
    }, e.name), React.createElement("div", {
      className: "num",
      style: {
        fontSize: 14,
        fontWeight: 700
      }
    }, e.latest, " ", React.createElement("span", {
      style: {
        fontSize: 10,
        color: "var(--text-3)",
        fontWeight: 500
      }
    }, "kg")), e.points.length > 1 && React.createElement("span", {
      className: "tnum",
      style: {
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "2px 8px",
        flexShrink: 0,
        background: e.delta > 0 ? "rgba(48,209,88,0.15)" : e.delta < 0 ? "rgba(255,159,10,0.15)" : "var(--card-2)",
        color: e.delta > 0 ? "var(--success)" : e.delta < 0 ? "#FF9F0A" : "var(--text-3)"
      }
    }, e.delta > 0 ? `+${e.delta}` : e.delta)), on && sel && sel.points.length > 1 && R && React.createElement("div", {
      className: "fade-up",
      style: {
        padding: "6px 0 12px"
      }
    }, React.createElement(R.ResponsiveContainer, {
      width: "100%",
      height: 140
    }, React.createElement(R.LineChart, {
      data: sel.points,
      margin: {
        top: 4,
        right: 4,
        bottom: 0,
        left: -24
      }
    }, React.createElement(R.CartesianGrid, {
      strokeDasharray: "3 3",
      stroke: "var(--border)"
    }), React.createElement(R.XAxis, {
      dataKey: "label",
      tick: {
        fill: "var(--text-3)",
        fontSize: 9.5
      },
      tickLine: false,
      axisLine: false
    }), React.createElement(R.YAxis, {
      domain: ["dataMin - 2", "dataMax + 2"],
      tick: {
        fill: "var(--text-3)",
        fontSize: 9.5
      },
      tickLine: false,
      axisLine: false
    }), React.createElement(R.Line, {
      type: "monotone",
      dataKey: "e1rm",
      stroke: "var(--accent)",
      strokeWidth: 2,
      dot: {
        fill: "var(--accent)",
        strokeWidth: 0,
        r: 3
      }
    })))), on && sel && (sel.points.length <= 1 || !R) && React.createElement("div", {
      className: "muted fade-up",
      style: {
        fontSize: 12,
        padding: "2px 2px 10px"
      }
    }, sel.points.length <= 1 ? t("Serve più di una sessione per il trend") : t("Grafico non disponibile")));
  }));
};
const _MEASURE_FIELDS = [{
  id: "vita",
  label: "Vita"
}, {
  id: "fianchi",
  label: "Fianchi"
}, {
  id: "torace",
  label: "Torace"
}, {
  id: "braccio",
  label: "Braccio"
}, {
  id: "coscia",
  label: "Coscia"
}];
const MisureView = ({
  isDesktop
}) => {
  const t = useT();
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const [log, setLog] = React.useState(() => window.storage ? window.storage.get("bodyMeasures", []) : []);
  const [editing, setEditing] = React.useState(false);
  const [vals, setVals] = React.useState({});
  const [savedMsg, setSavedMsg] = React.useState("");
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.sheetsAPI.getMisure || !window.storage) return;
    window.sheetsAPI.getMisure().then(rows => {
      if (!Array.isArray(rows) || !rows.length) return;
      const map = {};
      window.storage.get("bodyMeasures", []).forEach(e => {
        if (e && e.date) map[e.date] = e;
      });
      rows.forEach(e => {
        if (e && e.date) map[e.date] = Object.assign({}, map[e.date], e);
      });
      const merged = Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
      window.storage.set("bodyMeasures", merged);
      setLog(merged);
    }).catch(() => {});
  }, []);
  const latest = log.length ? log[log.length - 1] : {};
  const firstVal = id => {
    for (const e of log) {
      if (e[id] > 0) return e[id];
    }
    return null;
  };
  const openEdit = () => {
    const v = {};
    _MEASURE_FIELDS.forEach(f => {
      v[f.id] = latest[f.id] ? String(latest[f.id]) : "";
    });
    setVals(v);
    setEditing(true);
  };
  const save = () => {
    const entry = {
      date: today
    };
    let any = false;
    _MEASURE_FIELDS.forEach(f => {
      const n = parseFloat(String(vals[f.id] || "").replace(",", "."));
      if (n > 0) {
        entry[f.id] = Math.round(n * 10) / 10;
        any = true;
      }
    });
    if (!any) {
      setEditing(false);
      return;
    }
    const next = log.filter(e => e.date !== today).concat([Object.assign({}, log.find(e => e.date === today), entry)]);
    next.sort((a, b) => a.date.localeCompare(b.date));
    if (window.storage) window.storage.set("bodyMeasures", next.slice(-120));
    setLog(next.slice(-120));
    setEditing(false);
    setSavedMsg("✓ " + t("Misure salvate"));
    setTimeout(() => setSavedMsg(""), 2500);
    if (window.sheetsAPI && window.sheetsAPI.saveMisure) window.sheetsAPI.saveMisure(entry).catch(() => {});
  };
  return React.createElement("div", null, React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isDesktop ? "repeat(5, 1fr)" : "repeat(3, 1fr)",
      gap: 8,
      marginBottom: 12
    }
  }, _MEASURE_FIELDS.map(f => {
    const cur = latest[f.id];
    const first = firstVal(f.id);
    const delta = cur > 0 && first > 0 && cur !== first ? Math.round((cur - first) * 10) / 10 : null;
    return React.createElement("div", {
      key: f.id,
      className: "card",
      style: {
        padding: "10px 8px",
        textAlign: "center"
      }
    }, React.createElement("div", {
      className: "num",
      style: {
        fontSize: 17,
        fontWeight: 700
      }
    }, cur > 0 ? cur : "—"), React.createElement("div", {
      className: "muted",
      style: {
        fontSize: 9.5,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        marginTop: 2
      }
    }, t(f.label)), delta != null && React.createElement("div", {
      className: "tnum",
      style: {
        fontSize: 10,
        fontWeight: 600,
        marginTop: 2,
        color: delta < 0 ? "var(--success)" : "#FF9F0A"
      }
    }, delta > 0 ? "+" : "", delta));
  })), editing ? React.createElement("div", {
    className: "fade-up",
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: isDesktop ? "repeat(5, 1fr)" : "repeat(3, 1fr)",
      gap: 8
    }
  }, _MEASURE_FIELDS.map(f => React.createElement("div", {
    key: f.id
  }, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginBottom: 4
    }
  }, t(f.label)), React.createElement("input", {
    inputMode: "decimal",
    value: vals[f.id] || "",
    onChange: e => setVals(v => Object.assign({}, v, {
      [f.id]: e.target.value.replace(/[^0-9.,]/g, "")
    })),
    placeholder: "cm",
    className: "input input-mono",
    style: {
      width: "100%",
      padding: "9px 8px",
      fontSize: 14,
      textAlign: "center"
    }
  })))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, React.createElement("button", {
    className: "btn",
    style: {
      flex: 1
    },
    onClick: () => setEditing(false)
  }, t("Annulla")), React.createElement("button", {
    className: "btn primary",
    style: {
      flex: 2
    },
    onClick: save
  }, t("Salva misure")))) : React.createElement("button", {
    className: "btn",
    style: {
      width: "100%",
      padding: 12,
      fontSize: 14
    },
    onClick: openEdit
  }, React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " ", log.length ? t("Aggiorna misure") : t("Registra le prime misure")), savedMsg && React.createElement("div", {
    className: "fade-up",
    style: {
      textAlign: "center",
      fontSize: 12.5,
      color: "var(--success)",
      marginTop: 8
    }
  }, savedMsg), log.length > 1 && React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 10,
      borderTop: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      fontSize: 10.5,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 6
    }
  }, t("Ultime rilevazioni")), log.slice(-5).reverse().map((e, i) => React.createElement("div", {
    key: e.date,
    style: {
      display: "flex",
      gap: 10,
      padding: "6px 0",
      borderTop: i > 0 ? "1px solid var(--border)" : 0,
      fontSize: 12
    }
  }, React.createElement("span", {
    className: "num muted",
    style: {
      width: 76,
      flexShrink: 0
    }
  }, e.date), React.createElement("span", {
    className: "tnum",
    style: {
      color: "var(--text-2)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, _MEASURE_FIELDS.filter(f => e[f.id] > 0).map(f => `${t(f.label)} ${e[f.id]}`).join(" · "))))));
};
const Storico = ({
  device,
  onNav
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [tab, setTab] = React.useState("peso");
  React.useEffect(() => {
    if (window.ensureRecharts) window.ensureRecharts().catch(() => {});
  }, []);
  const [weightLog, setWeightLog] = React.useState(() => {
    if (!window.storage) return [];
    return window.storage.get("weightLog", []).slice(-60);
  });
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.storage) return;
    window.sheetsAPI.getPesoCorporeo().then(rows => {
      if (!Array.isArray(rows) || !rows.length) return;
      const local = window.storage.get("weightLog", []);
      const merged = window.WorkoutProgress ? window.WorkoutProgress.mergeWeightLog(local, rows, "cloud") : (() => {
        const map = {};
        local.forEach(e => {
          if (e.date) map[e.date] = e;
        });
        rows.forEach(e => {
          if (e.date) map[e.date] = e;
        });
        return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
      })();
      window.storage.set("weightLog", merged);
      setWeightLog(merged.slice(-60));
    }).catch(() => {});
  }, []);
  const activities = React.useMemo(() => {
    if (!window.storage) return [];
    return window.storage.get("activities", []).slice(0, 30);
  }, []);
  const weekSummary = React.useMemo(() => {
    if (!window.storage || !activities.length) return null;
    const totalMin = activities.reduce((s, a) => s + (a.min || 0), 0);
    const totalKm = activities.reduce((s, a) => s + (a.km || 0), 0);
    const byType = {};
    activities.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + 1;
    });
    return {
      totalMin,
      totalKm,
      byType,
      count: activities.length
    };
  }, [activities]);
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: isDesktop ? "32px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? 18 : 14
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Progressi")), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 28 : 24,
      fontWeight: 600
    }
  }, t("Storico"))), weekSummary && React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 10
    }
  }, [{
    label: t("Attività"),
    value: weekSummary.count,
    unit: "",
    color: "var(--accent)"
  }, {
    label: t("Minuti"),
    value: weekSummary.totalMin,
    unit: "'",
    color: "#FF9F0A"
  }, {
    label: t("km totali"),
    value: weekSummary.totalKm.toFixed(1),
    unit: "",
    color: "var(--success)"
  }].map(s => React.createElement("div", {
    key: s.label,
    className: "card",
    style: {
      padding: "12px 14px",
      textAlign: "center"
    }
  }, React.createElement("div", {
    className: "num",
    style: {
      fontSize: 22,
      fontWeight: 600,
      color: s.color
    }
  }, s.value, s.unit), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 10.5,
      marginTop: 2,
      textTransform: "uppercase",
      letterSpacing: 0.4
    }
  }, s.label)))), React.createElement("div", {
    className: "segmented",
    style: {
      overflowX: "auto",
      WebkitOverflowScrolling: "touch"
    }
  }, [{
    id: "peso",
    label: `⚖️ ${t("Peso")}`
  }, {
    id: "forza",
    label: `🏆 ${t("Forza")}`
  }, {
    id: "volume",
    label: `💪 ${t("Volume")}`
  }, {
    id: "misure",
    label: `📏 ${t("Misure")}`
  }, {
    id: "registro",
    label: `📖 ${t("Registro")}`
  }, {
    id: "cardio",
    label: `🏃 ${t("Cardio")}`
  }, {
    id: "checkin",
    label: `📋 ${t("Check-in")}`
  }].map(tb => React.createElement("button", {
    key: tb.id,
    className: tab === tb.id ? "on" : "",
    onClick: () => setTab(tb.id),
    style: {
      whiteSpace: "nowrap",
      flex: "1 0 auto",
      minWidth: 76
    }
  }, tb.label))), tab === "peso" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 12
    }
  }, t("Trend peso corporeo")), React.createElement(WeightChart, {
    data: weightLog,
    isDesktop: isDesktop
  }), weightLog.length >= 2 && React.createElement(GoalRow, {
    weightLog: weightLog
  }), weightLog.length > 0 && React.createElement("div", {
    style: {
      marginTop: 16,
      paddingTop: 16,
      borderTop: "1px solid var(--border)"
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 10
    }
  }, t("Ultime misurazioni")), weightLog.slice(-7).reverse().map((entry, i) => React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "7px 0",
      borderTop: i > 0 ? "1px solid var(--border)" : "none"
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-2)"
    }
  }, entry.date), React.createElement("div", {
    className: "num",
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, entry.weight, " kg"))))), tab === "forza" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 12
    }
  }, t("Massimale stimato per esercizio")), React.createElement(ForzaView, {
    isDesktop: isDesktop
  })), tab === "misure" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 12
    }
  }, t("Misure corporee"), " (cm)"), React.createElement(MisureView, {
    isDesktop: isDesktop
  })), tab === "registro" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 8
    }
  }, t("Registro sessioni")), React.createElement(RegistroView, {
    isDesktop: isDesktop
  })), tab === "volume" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 12
    }
  }, t("Serie per gruppo"), " · ", t("ultimi 7 giorni")), React.createElement(VolumeView, {
    isDesktop: isDesktop
  })), tab === "cardio" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 4
    }
  }, t("Attività recenti"), " (", activities.length, ")"), activities.length === 0 ? React.createElement(UIEmpty, {
    icon: "wave",
    title: t("Nessuna attività"),
    sub: t("Nessuna attività registrata"),
    style: {
      padding: "20px 16px"
    },
    action: React.createElement("button", {
      className: "btn primary",
      style: {
        marginTop: 4
      },
      onClick: () => onNav && onNav("dashboard")
    }, t("Vai alla Dashboard"))
  }) : React.createElement("div", null, activities.map((act, i) => React.createElement(ActivityRow, {
    key: act.id || i,
    act: act,
    isDesktop: isDesktop
  })))), tab === "checkin" && React.createElement("div", {
    className: "card",
    style: {
      padding: isDesktop ? 22 : 16
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: 12
    }
  }, t("Ultimi 14 giorni")), React.createElement(CheckInTrend, {
    isDesktop: isDesktop
  })), React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      justifyContent: "center",
      paddingTop: 4
    }
  }, React.createElement("button", {
    className: "btn",
    style: {
      flex: 1,
      padding: "11px",
      fontSize: 13
    },
    onClick: () => onNav && onNav("dashboard")
  }, React.createElement(Icon, {
    name: "home",
    size: 14
  }), " ", t("Dashboard")), React.createElement("button", {
    className: "btn",
    style: {
      flex: 1,
      padding: "11px",
      fontSize: 13
    },
    onClick: () => onNav && onNav("scheda")
  }, React.createElement(Icon, {
    name: "dumbbell",
    size: 14
  }), " ", t("Allenamento"))));
};
window.Storico = Storico;
})();

// ══ screens/impostazioni.jsx ══
;(function () {
const ISection = ({
  title,
  subtitle,
  children
}) => React.createElement("div", null, React.createElement("div", {
  style: {
    padding: "0 4px 8px"
  }
}, React.createElement("div", {
  style: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-3)",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  }
}, title), subtitle && React.createElement("div", {
  className: "muted",
  style: {
    fontSize: 11.5,
    marginTop: 2
  }
}, subtitle)), React.createElement("div", {
  className: "ios-list"
}, children));
const IRow = ({
  icon,
  iconBg,
  title,
  sub,
  trailing,
  children,
  onClick
}) => React.createElement("div", {
  className: onClick ? "row pressable" : "row",
  onClick: onClick,
  style: {
    cursor: onClick ? "pointer" : "default"
  }
}, React.createElement("div", {
  className: "icon-wrap",
  style: {
    background: iconBg || "var(--card-3)",
    color: "#fff"
  }
}, React.createElement(Icon, {
  name: icon,
  size: 15,
  strokeWidth: 2
})), React.createElement("div", {
  className: "row-main"
}, React.createElement("div", {
  className: "row-title"
}, title), sub && React.createElement("div", {
  className: "row-sub"
}, sub)), React.createElement("div", {
  className: "row-trailing"
}, children || trailing));
const IField = ({
  label,
  children
}) => React.createElement("div", null, React.createElement("div", {
  style: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-3)",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
    paddingLeft: 2
  }
}, label), children);
const ApiKeyRow = ({
  icon,
  iconBg,
  title,
  sub,
  storageKey,
  testFn,
  placeholder
}) => {
  const t = useT();
  const [val, setVal] = React.useState(() => window.storage ? window.storage.get(storageKey, "") : "");
  const [show, setShow] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);
  const save = v => {
    setVal(v);
    const trimmed = v.trim();
    if (window.storage) window.storage.set(storageKey, trimmed);
  };
  const test = async () => {
    if (!testFn || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testFn();
      setTestResult({
        ok: true,
        msg: r.reply ? `✓ OK — "${r.reply}"` : `✓ ${t("Connesso")} (${r.rows} ${t("righe")})`
      });
    } catch (e) {
      setTestResult({
        ok: false,
        msg: "✗ " + (e.message || t("Errore"))
      });
    } finally {
      setTesting(false);
    }
  };
  const masked = val ? val.slice(0, 6) + "••••••••" + val.slice(-4) : "";
  return React.createElement("div", null, React.createElement("div", {
    className: "row pressable",
    onClick: () => setExpanded(e => !e),
    style: {
      cursor: "pointer"
    }
  }, React.createElement("div", {
    className: "icon-wrap",
    style: {
      background: iconBg,
      color: "#fff"
    }
  }, React.createElement(Icon, {
    name: icon,
    size: 15,
    strokeWidth: 2
  })), React.createElement("div", {
    className: "row-main"
  }, React.createElement("div", {
    className: "row-title"
  }, title), sub && React.createElement("div", {
    className: "row-sub"
  }, sub)), React.createElement("div", {
    className: "row-trailing",
    style: {
      gap: 6
    }
  }, val ? React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10,
      background: "rgba(48,209,88,0.18)",
      color: "var(--success)"
    }
  }, t("Configurato")) : React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10,
      background: "rgba(255,69,58,0.14)",
      color: "var(--danger)"
    }
  }, t("Mancante")), React.createElement("span", {
    style: {
      transform: expanded ? "rotate(90deg)" : "none",
      transition: "transform 0.2s",
      display: "flex"
    }
  }, React.createElement(Icon, {
    name: "chevron",
    size: 13,
    color: "var(--text-3)"
  })))), expanded && React.createElement("div", {
    className: "fade-up",
    style: {
      padding: "12px 16px 14px",
      borderTop: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, React.createElement("input", {
    type: show ? "text" : "password",
    value: val,
    onChange: e => save(e.target.value),
    placeholder: placeholder || t("Inserisci…"),
    className: "input input-mono",
    style: {
      flex: 1,
      fontSize: 13,
      padding: "10px 12px"
    }
  }), React.createElement("button", {
    className: "btn ghost",
    style: {
      padding: "8px 10px",
      flexShrink: 0
    },
    onClick: () => setShow(s => !s)
  }, React.createElement(Icon, {
    name: show ? "eye-off" : "eye",
    size: 14
  }), React.createElement("span", {
    style: {
      fontSize: 12,
      marginLeft: 4
    }
  }, show ? t("Nascondi") : t("Mostra")))), val && React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, React.createElement("button", {
    className: "btn",
    disabled: testing,
    onClick: test,
    style: {
      padding: "8px 14px",
      fontSize: 13
    }
  }, testing ? React.createElement("span", {
    className: "spinner",
    style: {
      width: 14,
      height: 14
    }
  }) : t("Testa connessione")), testResult && React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 500,
      color: testResult.ok ? "var(--success)" : "var(--danger)"
    }
  }, testResult.msg))));
};
function _validateSchedaText(text, t) {
  try {
    if (!window.parseScheda) return {
      ok: true,
      detail: ""
    };
    const p = window.parseScheda(text);
    const days = p && p.days || [];
    if (!days.length) return {
      ok: false
    };
    const nEx = days.reduce((n, d) => n + (d.exercises && d.exercises.length || 0), 0);
    return {
      ok: true,
      detail: `${days.length} ${t("giorni")} · ${nEx} ${t("esercizi")}`
    };
  } catch (_) {
    return {
      ok: false
    };
  }
}
function _validateDietaText(text, t) {
  try {
    if (!window.parseDieta) return {
      ok: true,
      detail: ""
    };
    const p = window.parseDieta(text);
    const secs = p ? Object.keys(p).filter(k => p[k] && Array.isArray(p[k].meals) && p[k].meals.length > 0) : [];
    if (!secs.length) return {
      ok: false
    };
    const nMeals = secs.reduce((n, k) => n + p[k].meals.length, 0);
    return {
      ok: true,
      detail: `${secs.length} ${t("sezioni")} · ${nMeals} ${t("pasti")}`
    };
  } catch (_) {
    return {
      ok: false
    };
  }
}
function _fmtImportDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }) + " " + d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return "";
  }
}
const FileImporter = ({
  label,
  icon,
  storageKey,
  accept = "",
  validate
}) => {
  const t = useT();
  const [loaded, setLoaded] = React.useState(() => !!(window.storage && window.storage.get(storageKey, null)));
  const [fileName, setFileName] = React.useState(() => window.storage ? window.storage.get(storageKey + "_name", "") : "");
  const [importedAt, setImportedAt] = React.useState(() => window.storage ? window.storage.get(storageKey + "_at", "") : "");
  const [status, setStatus] = React.useState(null);
  const inputRef = React.useRef(null);
  const handleFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus({
      type: "err",
      msg: t("Errore di lettura del file")
    });
    reader.onload = ev => {
      const text = ev.target.result;
      const v = validate ? validate(text, t) : {
        ok: true,
        detail: ""
      };
      if (!v.ok) {
        setStatus({
          type: "err",
          msg: t("Formato non valido — dati attuali conservati")
        });
        return;
      }
      const now = new Date().toISOString();
      if (window.storage) {
        window.storage.set(storageKey, text);
        window.storage.set(storageKey + "_name", file.name);
        window.storage.set(storageKey + "_at", now);
      }
      setLoaded(true);
      setFileName(file.name);
      setImportedAt(now);
      setStatus({
        type: "ok",
        msg: `${t("Importato")}${v.detail ? " · " + v.detail : ""}`
      });
      if (window._saveSettingRetry) {
        window._saveSettingRetry(storageKey, text);
      } else if (window.sheetsAPI) {
        window.sheetsAPI.saveSettings({
          key: storageKey,
          value: text
        }).catch(() => {});
      }
    };
    reader.readAsText(file, "UTF-8");
  };
  const subText = status ? status.msg : loaded ? `${fileName || t("Caricato")}${importedAt ? " · " + t("Ultimo import") + " " + _fmtImportDate(importedAt) : ""}` : t("Nessun file importato");
  return React.createElement("div", {
    className: "row"
  }, React.createElement("div", {
    className: "icon-wrap",
    style: {
      background: "#FF9F0A",
      color: "#fff"
    }
  }, React.createElement(Icon, {
    name: icon,
    size: 15,
    strokeWidth: 2
  })), React.createElement("div", {
    className: "row-main"
  }, React.createElement("div", {
    className: "row-title"
  }, label), React.createElement("div", {
    className: "row-sub",
    style: status ? {
      color: status.type === "err" ? "var(--danger)" : "var(--success)"
    } : undefined
  }, subText)), React.createElement("div", {
    className: "row-trailing"
  }, loaded && !status && React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10,
      background: "rgba(48,209,88,0.18)",
      color: "var(--success)",
      marginRight: 6
    }
  }, "✓"), React.createElement("button", {
    className: "btn",
    style: {
      padding: "6px 12px",
      fontSize: 12
    },
    onClick: () => inputRef.current?.click()
  }, loaded ? t("Aggiorna") : t("Importa")), React.createElement("input", {
    ref: inputRef,
    type: "file",
    accept: accept || undefined,
    style: {
      display: "none"
    },
    onChange: handleFile,
    onClick: e => {
      e.target.value = "";
    }
  })));
};
const PlanExportRow = ({
  label,
  icon,
  storageKey,
  fallbackKey,
  fileName
}) => {
  const t = useT();
  const [status, setStatus] = React.useState(null);
  const doExport = async () => {
    try {
      const text = window.storage && window.storage.get(storageKey, null) || window[fallbackKey] || "";
      if (!text) {
        setStatus({
          type: "err",
          msg: t("Nessun testo da esportare")
        });
        return;
      }
      const file = new File([text], fileName, {
        type: "text/plain"
      });
      if (navigator.canShare && navigator.canShare({
        files: [file]
      }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: fileName
        });
      } else {
        const url = URL.createObjectURL(new Blob([text], {
          type: "text/plain"
        }));
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      setStatus({
        type: "ok",
        msg: "✓ " + t("Esportato")
      });
      setTimeout(() => setStatus(null), 2500);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setStatus({
        type: "err",
        msg: `${t("Export fallito")}: ${e.message || e}`
      });
    }
  };
  return React.createElement(IRow, {
    icon: icon,
    iconBg: "#5AC8FA",
    title: label,
    sub: status ? status.msg : t("Il testo attuale — modificalo e reimportalo qui sopra"),
    onClick: doExport,
    trailing: React.createElement(Icon, {
      name: "chevron",
      size: 13,
      color: "var(--accent)"
    })
  });
};
const SyncNowRow = () => {
  const t = useT();
  const [syncing, setSyncing] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState(null);
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      await window._cloudPushAll();
      setSyncResult({
        ok: true
      });
    } catch (e) {
      setSyncResult({
        ok: false,
        msg: e.message
      });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 4000);
    }
  };
  return React.createElement(IRow, {
    icon: "refresh",
    iconBg: "#0A84FF",
    title: t("Sincronizza ora"),
    sub: t("Pusha tutti i dati locali al cloud"),
    onClick: !syncing ? handleSync : undefined
  }, syncing ? React.createElement("span", {
    className: "spinner",
    style: {
      width: 18,
      height: 18
    }
  }) : syncResult ? React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10,
      background: syncResult.ok ? "rgba(48,209,88,0.18)" : "rgba(255,69,58,0.14)",
      color: syncResult.ok ? "var(--success)" : "var(--danger)"
    }
  }, syncResult.ok ? "✓ " + t("Sincronizzato") : "✗ " + t("Errore")) : React.createElement(Icon, {
    name: "chevron",
    size: 13,
    color: "var(--accent)"
  }));
};
const SyncStatusRow = () => {
  const t = useT();
  const [s, setS] = React.useState(() => window._syncState || {
    status: "idle",
    last: null
  });
  React.useEffect(() => {
    const on = () => setS(Object.assign({}, window._syncState || {
      status: "idle",
      last: null
    }));
    window.addEventListener("lfh-sync", on);
    return () => window.removeEventListener("lfh-sync", on);
  }, []);
  const time = s.last ? new Date(s.last).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  }) : null;
  return React.createElement(IRow, {
    icon: "cloud",
    iconBg: "#30D158",
    title: t("Stato sincronizzazione"),
    sub: time ? `${t("Ultimo sync")}: ${time} · ${t("Cloud: Google Sheets via proxy")}` : t("In attesa del primo sync")
  }, window.SyncBadge ? React.createElement(SyncBadge, null) : null);
};
const BackupRows = () => {
  const t = useT();
  const [status, setStatus] = React.useState(null);
  const inputRef = React.useRef(null);
  const doExport = async () => {
    try {
      const st = window.storage;
      if (!st || !st.keys) throw new Error("storage non pronto");
      const data = {};
      st.keys().sort().forEach(k => {
        data[k] = st.get(k, null);
      });
      const json = JSON.stringify({
        _lfhBackup: 1,
        exportedAt: new Date().toISOString(),
        data
      });
      const name = "fitness-hub-backup-" + (window.todayKey ? window.todayKey() : "export") + ".json";
      const file = new File([json], name, {
        type: "application/json"
      });
      if (navigator.canShare && navigator.canShare({
        files: [file]
      }) && navigator.share) {
        await navigator.share({
          files: [file],
          title: name
        });
      } else {
        const url = URL.createObjectURL(new Blob([json], {
          type: "application/json"
        }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      setStatus({
        type: "ok",
        msg: `${t("Backup esportato")} · ${Object.keys(data).length} ${t("chiavi")}`
      });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setStatus({
        type: "err",
        msg: `${t("Export fallito")}: ${e.message || e}`
      });
    }
  };
  const handleFile = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus({
      type: "err",
      msg: t("Errore di lettura del file")
    });
    reader.onload = ev => {
      let p = null;
      try {
        p = JSON.parse(ev.target.result);
      } catch (_) {}
      if (!p || p._lfhBackup !== 1 || !p.data || typeof p.data !== "object") {
        setStatus({
          type: "err",
          msg: t("File non valido — dati attuali conservati")
        });
        return;
      }
      const keys = Object.keys(p.data);
      if (!window.confirm(t("Ripristinare il backup? I dati locali attuali verranno sovrascritti."))) return;
      keys.forEach(k => window.storage.set(k, p.data[k]));
      setStatus({
        type: "ok",
        msg: `${t("Backup ripristinato")} · ${keys.length} ${t("chiavi")}`
      });
      setTimeout(() => window.location.reload(), 900);
    };
    reader.readAsText(f, "UTF-8");
  };
  return React.createElement(React.Fragment, null, React.createElement(IRow, {
    icon: "cloud",
    iconBg: "#30D158",
    title: t("Esporta backup (.json)"),
    sub: status && status.type === "ok" ? status.msg : t("Tutto lo storage locale, chiave Groq inclusa"),
    onClick: doExport,
    trailing: React.createElement(Icon, {
      name: "chevron",
      size: 13,
      color: "var(--accent)"
    })
  }), React.createElement("div", {
    className: "row"
  }, React.createElement("div", {
    className: "icon-wrap",
    style: {
      background: "#FF9F0A",
      color: "#fff"
    }
  }, React.createElement(Icon, {
    name: "upload",
    size: 15,
    strokeWidth: 2
  })), React.createElement("div", {
    className: "row-main"
  }, React.createElement("div", {
    className: "row-title"
  }, t("Ripristina backup")), React.createElement("div", {
    className: "row-sub",
    style: status && status.type === "err" ? {
      color: "var(--danger)"
    } : undefined
  }, status && status.type === "err" ? status.msg : t("Sovrascrive i dati locali col file"))), React.createElement("div", {
    className: "row-trailing"
  }, React.createElement("button", {
    className: "btn",
    style: {
      padding: "6px 12px",
      fontSize: 12
    },
    onClick: () => inputRef.current?.click()
  }, t("Importa")), React.createElement("input", {
    ref: inputRef,
    type: "file",
    style: {
      display: "none"
    },
    onChange: handleFile,
    onClick: e => {
      e.target.value = "";
    }
  }))));
};
const DiagnosticaRow = () => {
  const t = useT();
  const read = () => window.storage && window.storage.get("errorLog", []) || [];
  const [errors, setErrors] = React.useState(read);
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    const on = () => setErrors(read());
    window.addEventListener("lfh-err", on);
    return () => window.removeEventListener("lfh-err", on);
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(errors, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };
  const clear = () => {
    if (window.storage) window.storage.set("errorLog", []);
    setErrors([]);
  };
  const fmtT = iso => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_) {
      return "";
    }
  };
  return React.createElement("div", null, React.createElement(IRow, {
    icon: "info",
    iconBg: errors.length ? "#FF453A" : "#8E8E93",
    title: t("Log errori"),
    sub: errors.length ? `${errors.length} ${errors.length === 1 ? t("errore registrato") : t("errori registrati")}` : t("Nessun errore registrato 🎉"),
    onClick: () => setExpanded(x => !x),
    trailing: React.createElement("span", {
      style: {
        transform: expanded ? "rotate(90deg)" : "none",
        transition: "transform 0.2s",
        display: "flex"
      }
    }, React.createElement(Icon, {
      name: "chevron",
      size: 13,
      color: "var(--text-3)"
    }))
  }), expanded && React.createElement("div", {
    className: "fade-up",
    style: {
      padding: "10px 16px 14px",
      borderTop: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, errors.length > 0 && React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      maxHeight: 240,
      overflowY: "auto"
    }
  }, errors.slice(-10).reverse().map((e, i) => React.createElement("div", {
    key: i,
    style: {
      fontSize: 11.5,
      lineHeight: 1.45
    }
  }, React.createElement("span", {
    className: "num",
    style: {
      color: "var(--text-3)"
    }
  }, fmtT(e.t)), React.createElement("span", {
    style: {
      color: "var(--danger)",
      marginLeft: 6
    }
  }, e.type), React.createElement("div", {
    style: {
      color: "var(--text-2)",
      wordBreak: "break-word"
    }
  }, e.msg)))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, React.createElement("button", {
    className: "btn ghost",
    style: {
      padding: "7px 12px",
      fontSize: 12
    },
    onClick: copy,
    disabled: !errors.length
  }, copied ? "✓ " + t("Copiato") : t("Copia tutto")), React.createElement("button", {
    className: "btn ghost",
    style: {
      padding: "7px 12px",
      fontSize: 12
    },
    onClick: clear,
    disabled: !errors.length
  }, t("Svuota")))));
};
const ResetModal = ({
  onConfirm,
  onCancel
}) => {
  const t = useT();
  return React.createElement("div", {
    onClick: onCancel,
    style: {
      position: "fixed",
      inset: 0,
      zIndex: 300,
      background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(2px)",
      WebkitBackdropFilter: "blur(2px)",
      display: "flex",
      alignItems: "flex-end"
    }
  }, React.createElement("div", {
    onClick: e => e.stopPropagation(),
    className: "pop-in",
    style: {
      width: "100%",
      background: "var(--bg-2)",
      borderTopLeftRadius: "var(--r-xl)",
      borderTopRightRadius: "var(--r-xl)",
      borderTop: "1px solid var(--border)",
      padding: "10px 22px 30px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
      boxShadow: "0 -20px 60px rgba(0,0,0,0.5)"
    }
  }, React.createElement("div", {
    style: {
      width: 40,
      height: 5,
      borderRadius: 3,
      background: "var(--border-2)",
      alignSelf: "center",
      marginBottom: 4
    }
  }), React.createElement("div", {
    style: {
      width: 52,
      height: 52,
      borderRadius: 999,
      background: "rgba(255,69,58,0.14)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 26,
      alignSelf: "center"
    }
  }, "⚠️"), React.createElement("div", {
    style: {
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, React.createElement("h2", {
    style: {
      fontSize: 20,
      fontWeight: 600
    }
  }, t("Reset completo"), "?"), React.createElement("p", {
    className: "muted",
    style: {
      fontSize: 13.5,
      lineHeight: 1.5
    }
  }, t("Tutti i dati verranno eliminati: check-in, storico pesi, attività, impostazioni e file importati. Questa operazione non è reversibile."))), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9,
      marginTop: 4
    }
  }, React.createElement("button", {
    className: "btn danger",
    style: {
      padding: 15,
      fontSize: 16
    },
    onClick: onConfirm
  }, t("Resetta tutto")), React.createElement("button", {
    className: "btn",
    style: {
      padding: 15,
      fontSize: 16
    },
    onClick: onCancel
  }, t("Annulla")))));
};
const ProfileEditor = ({
  profile,
  onSave,
  onClose,
  isDesktop
}) => {
  const t = useT();
  const [p, setP] = React.useState(profile);
  const set = (k, v) => setP(prev => ({
    ...prev,
    [k]: v
  }));
  React.useEffect(() => {
    const onKey = e => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const PROGRAMS = ["Powerbuilding", "Hypertrophy", "Strength", "Cut", "Lean bulk"];
  return React.createElement("div", {
    onClick: onClose,
    style: {
      position: "absolute",
      inset: 0,
      zIndex: 200,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: isDesktop ? "center" : "flex-end",
      justifyContent: "center",
      animation: "fadeUp 0.18s ease"
    }
  }, React.createElement("div", {
    onClick: e => e.stopPropagation(),
    className: "pop-in",
    style: {
      width: isDesktop ? 480 : "100%",
      background: "var(--card)",
      borderRadius: isDesktop ? 18 : "22px 22px 0 0",
      border: "1px solid var(--border)",
      padding: 22,
      display: "flex",
      flexDirection: "column",
      gap: 18,
      overflow: "auto",
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)"
    }
  }, !isDesktop && React.createElement("div", {
    style: {
      width: 40,
      height: 4,
      borderRadius: 2,
      background: "var(--card-3)",
      margin: "-8px auto 0"
    }
  }), React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, React.createElement("h2", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: -0.02
    }
  }, t("Modifica profilo")), React.createElement("button", {
    onClick: onClose,
    style: {
      width: 30,
      height: 30,
      borderRadius: 999,
      background: "var(--card-2)",
      border: 0,
      color: "var(--text-2)",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, React.createElement(Icon, {
    name: "x",
    size: 14,
    strokeWidth: 2.4
  }))), React.createElement("div", {
    style: {
      alignSelf: "center",
      width: 80,
      height: 80,
      borderRadius: 999,
      background: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--display)",
      fontWeight: 700,
      fontSize: 34,
      color: "#1a0a04"
    }
  }, p.name.slice(0, 1).toUpperCase() || "?"), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, React.createElement(IField, {
    label: t("Nome")
  }, React.createElement("input", {
    className: "input",
    value: p.name,
    onChange: e => set("name", e.target.value),
    autoFocus: true,
    style: {
      background: "var(--card-2)"
    }
  })), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, React.createElement(IField, {
    label: t("Altezza (cm)")
  }, React.createElement("input", {
    className: "input input-mono",
    value: p.height,
    onChange: e => set("height", e.target.value.replace(/\D/g, "")),
    style: {
      background: "var(--card-2)"
    }
  })), React.createElement(IField, {
    label: t("Età")
  }, React.createElement("input", {
    className: "input input-mono",
    value: p.age,
    onChange: e => set("age", e.target.value.replace(/\D/g, "")),
    style: {
      background: "var(--card-2)"
    }
  }))), React.createElement(IField, {
    label: t("Programma")
  }, React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6
    }
  }, PROGRAMS.map(pr => {
    const on = p.program === pr;
    return React.createElement("button", {
      key: pr,
      onClick: () => set("program", pr),
      style: {
        padding: "8px 14px",
        border: 0,
        background: on ? "var(--accent)" : "var(--card-2)",
        color: on ? "#fff" : "var(--text)",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: on ? 600 : 500,
        cursor: "pointer",
        transition: "all 0.16s"
      }
    }, t(pr));
  })))), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 4
    }
  }, React.createElement("button", {
    className: "btn",
    style: {
      flex: 1
    },
    onClick: onClose
  }, t("Annulla")), React.createElement("button", {
    className: "btn primary",
    style: {
      flex: 2
    },
    onClick: () => onSave(p),
    disabled: !p.name.trim()
  }, t("Salva")))));
};
const Impostazioni = ({
  device,
  onNav,
  theme,
  setTheme,
  bodyWeight,
  setBodyWeight,
  onResetAll
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const {
    lang,
    setLang
  } = useLang();
  const [profile, setProfile] = React.useState(() => window.storage ? window.storage.get("profile", {
    name: "Lorenzo",
    height: "178",
    age: "28",
    program: "Powerbuilding"
  }) : {
    name: "Lorenzo",
    height: "178",
    age: "28",
    program: "Powerbuilding"
  });
  const [editing, setEditing] = React.useState(false);
  const [showReset, setShowReset] = React.useState(false);
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto";
  const handleTheme = label => {
    const val = label === "Dark" ? "dark" : label === "Light" ? "light" : "system";
    setTheme(val);
  };
  const handleProfileSave = p => {
    setProfile(p);
    setEditing(false);
    if (window.storage) window.storage.set("profile", p);
  };
  const handleReset = () => {
    setShowReset(false);
    if (onResetAll) onResetAll();
  };
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: isDesktop ? "32px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: isDesktop ? 22 : 18,
      maxWidth: 760,
      margin: isDesktop ? "0 auto" : 0
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Profilo")), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 28 : 24,
      fontWeight: 600
    }
  }, t("Impostazioni"))), React.createElement("div", {
    style: {
      position: "relative",
      borderRadius: "var(--r-lg)",
      padding: 20,
      overflow: "hidden",
      background: "var(--brand-grad)",
      boxShadow: "0 16px 34px -16px rgba(10,132,255,0.6)",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, React.createElement("div", {
    style: {
      width: 54,
      height: 54,
      borderRadius: 999,
      flexShrink: 0,
      background: "rgba(255,255,255,0.2)",
      border: "1.5px solid rgba(255,255,255,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      fontSize: 20,
      color: "#fff"
    }
  }, profile.name.slice(0, 1).toUpperCase() || "?"), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 700,
      color: "#fff"
    }
  }, profile.name), React.createElement("div", {
    style: {
      fontSize: 13,
      color: "rgba(255,255,255,0.85)",
      marginTop: 2
    }
  }, React.createElement("span", {
    className: "num"
  }, profile.height), " cm · ", React.createElement("span", {
    className: "num"
  }, profile.age), " ", t("anni"), " · ", t(profile.program))), React.createElement("button", {
    onClick: () => setEditing(true),
    style: {
      flexShrink: 0,
      background: "rgba(255,255,255,0.2)",
      border: "1px solid rgba(255,255,255,0.35)",
      color: "#fff",
      borderRadius: 999,
      padding: "7px 14px",
      fontSize: 12.5,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, t("Modifica"))), editing && React.createElement(ProfileEditor, {
    isDesktop: isDesktop,
    profile: profile,
    onSave: handleProfileSave,
    onClose: () => setEditing(false)
  }), onNav && React.createElement(ISection, {
    title: t("Progressi")
  }, React.createElement(IRow, {
    icon: "trend-up",
    iconBg: "#30D158",
    title: t("Storico"),
    sub: t("Peso, cardio e check-in"),
    onClick: () => onNav("storico"),
    trailing: React.createElement(Icon, {
      name: "chevron",
      size: 13,
      color: "var(--text-3)"
    })
  }), React.createElement(IRow, {
    icon: "pill",
    iconBg: "#FF453A",
    title: t("Promemoria"),
    onClick: () => onNav("promemoria"),
    trailing: React.createElement(Icon, {
      name: "chevron",
      size: 13,
      color: "var(--text-3)"
    })
  })), React.createElement(ISection, {
    title: t("Aspetto")
  }, React.createElement(IRow, {
    icon: "sun",
    iconBg: "#FF9F0A",
    title: t("Tema")
  }, React.createElement("div", {
    className: "segmented",
    style: {
      width: 200
    }
  }, ["Dark", "Light", "Auto"].map(th => React.createElement("button", {
    key: th,
    className: themeLabel === th ? "on" : "",
    onClick: () => handleTheme(th)
  }, th)))), React.createElement(IRow, {
    icon: "globe",
    iconBg: "#0A84FF",
    title: t("Lingua")
  }, React.createElement("div", {
    className: "segmented",
    style: {
      width: 130
    }
  }, React.createElement("button", {
    className: lang === "it" ? "on" : "",
    onClick: () => setLang("it")
  }, "IT"), React.createElement("button", {
    className: lang === "en" ? "on" : "",
    onClick: () => setLang("en")
  }, "EN")))), React.createElement(ISection, {
    title: t("Connessioni"),
    subtitle: t("API key e sorgenti dati")
  }, React.createElement(ApiKeyRow, {
    icon: "spark",
    iconBg: "#BF5AF2",
    title: t("API key Groq"),
    sub: t("Coach AI · llama-3.3-70b-versatile"),
    storageKey: "groqApiKey",
    placeholder: "gsk_…",
    testFn: () => window.groqAPI.testConnection()
  }), React.createElement(ApiKeyRow, {
    icon: "doc",
    iconBg: "#0A84FF",
    title: "Google Apps Script URL",
    sub: t("Sheets: pesi, sessioni, movimenti"),
    storageKey: "sheetsUrl",
    placeholder: "https://script.google.com/macros/s/…/exec",
    testFn: () => window.sheetsAPI.testConnection()
  })), React.createElement(ISection, {
    title: t("Piani"),
    subtitle: t("Importa scheda.txt e dieta.txt")
  }, React.createElement(FileImporter, {
    label: t("Importa scheda (.txt)"),
    icon: "dumbbell",
    storageKey: "schedaData",
    validate: _validateSchedaText
  }), React.createElement(FileImporter, {
    label: t("Importa dieta (.txt)"),
    icon: "fork",
    storageKey: "dietaData",
    validate: _validateDietaText
  }), React.createElement(PlanExportRow, {
    label: t("Esporta scheda (.txt)"),
    icon: "send",
    storageKey: "schedaData",
    fallbackKey: "SCHEDA_TXT_FALLBACK",
    fileName: "scheda.txt"
  }), React.createElement(PlanExportRow, {
    label: t("Esporta dieta (.txt)"),
    icon: "send",
    storageKey: "dietaData",
    fallbackKey: "DIETA_TXT_FALLBACK",
    fileName: "dieta.txt"
  }), React.createElement(IRow, {
    icon: "info",
    iconBg: "#8E8E93",
    title: t("Cibi esclusi"),
    sub: "Pasta di ceci · lenticchie · piselli · bevanda di mandorla"
  }, React.createElement("span", {
    className: "pill",
    style: {
      fontSize: 10,
      background: "rgba(255,69,58,0.14)",
      color: "var(--danger)"
    }
  }, "🚫 ", t("Sempre")))), React.createElement(ISection, {
    title: t("Sincronizzazione")
  }, React.createElement(SyncStatusRow, null), React.createElement(SyncNowRow, null)), React.createElement(ISection, {
    title: t("Backup"),
    subtitle: t("I dati per-giorno vivono solo su questo device")
  }, React.createElement(BackupRows, null)), React.createElement(ISection, {
    title: t("Diagnostica")
  }, React.createElement(DiagnosticaRow, null)), React.createElement("button", {
    onClick: () => setShowReset(true),
    style: {
      background: "none",
      border: "1px solid rgba(255,69,58,0.35)",
      color: "var(--danger)",
      borderRadius: "var(--r)",
      padding: 14,
      fontSize: 15,
      fontWeight: 600,
      cursor: "pointer",
      marginTop: 4
    }
  }, t("Reset completo")), React.createElement("div", {
    style: {
      textAlign: "center",
      color: "var(--text-3)",
      fontSize: 11.5,
      padding: "8px 0 24px"
    }
  }, "Lorenzo Fitness Hub · v2.8.0 · build 2026.07"), showReset && React.createElement(ResetModal, {
    onConfirm: handleReset,
    onCancel: () => setShowReset(false)
  }));
};
window.Impostazioni = Impostazioni;
})();

// ══ screens/promemoria.jsx ══
;(function () {
const _DT_LABELS = {
  riposo: "Riposo",
  mattina: "Mattina",
  ore17: "Ore 17",
  ore21: "Ore 21",
  ore22: "Ore 22"
};
const _WD_ORDER = [["mon", "Lun"], ["tue", "Mar"], ["wed", "Mer"], ["thu", "Gio"], ["fri", "Ven"], ["sat", "Sab"], ["sun", "Dom"]];
const PromemoriaEditor = ({
  config,
  persist,
  selDay,
  setSelDay,
  t
}) => {
  const setWeekly = (wd, dt) => persist({
    ...config,
    weekly: {
      ...config.weekly,
      [wd]: dt
    }
  });
  const setReminder = (idx, patch) => {
    const list = (config.daytypes[selDay] || []).map((r, i) => i === idx ? {
      ...r,
      ...patch
    } : r);
    persist({
      ...config,
      daytypes: {
        ...config.daytypes,
        [selDay]: list
      }
    });
  };
  const list = config.daytypes[selDay] || [];
  const catLabel = {
    pasto: t("Pasti"),
    integratore: t("Integratori"),
    allenamento: t("Allenamento")
  };
  const todayDt = _todayDaytype(config);
  return React.createElement("div", {
    className: "card",
    style: {
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      textTransform: "uppercase",
      marginBottom: 8
    }
  }, t("Orari per giorno")), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, _WD_ORDER.map(([wd, lbl]) => React.createElement("div", {
    key: wd,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, React.createElement("div", {
    style: {
      width: 44,
      fontSize: 13,
      fontWeight: 600
    }
  }, lbl), React.createElement("select", {
    value: config.weekly[wd] || "riposo",
    onChange: e => setWeekly(wd, e.target.value),
    style: {
      flex: 1,
      padding: "7px 10px",
      borderRadius: 9,
      background: "var(--card-2)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      fontSize: 13
    }
  }, Object.keys(_DT_LABELS).map(dt => React.createElement("option", {
    key: dt,
    value: dt
  }, t(_DT_LABELS[dt])))))))), React.createElement("div", {
    className: "hscroll",
    style: {
      marginLeft: 0,
      marginRight: 0
    }
  }, Object.keys(_DT_LABELS).map(dt => {
    const on = selDay === dt;
    const isToday = dt === todayDt;
    return React.createElement("button", {
      key: dt,
      onClick: () => setSelDay(dt),
      style: {
        padding: "7px 12px",
        border: 0,
        borderRadius: 999,
        marginRight: 4,
        whiteSpace: "nowrap",
        background: on ? "var(--accent)" : "var(--card-2)",
        color: on ? "#fff" : "var(--text)",
        boxShadow: isToday && !on ? "inset 0 0 0 1.5px var(--accent)" : "none",
        fontSize: 12.5,
        fontWeight: on ? 600 : 500,
        cursor: "pointer"
      }
    }, t(_DT_LABELS[dt]), isToday ? " · " + t("Oggi") : "");
  })), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, list.map((r, i) => React.createElement("div", {
    key: r.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 0",
      borderTop: i > 0 ? "1px solid var(--border)" : "0"
    }
  }, React.createElement("span", {
    style: {
      fontSize: 15
    }
  }, r.cat === "pasto" ? "🍽️" : r.cat === "integratore" ? "💊" : "🏋️"), React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 500,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap"
    }
  }, r.label), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 11
    }
  }, catLabel[r.cat])), React.createElement("input", {
    type: "time",
    value: r.time,
    onChange: e => setReminder(i, {
      time: e.target.value
    }),
    style: {
      padding: "5px 8px",
      borderRadius: 8,
      background: "var(--card-2)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      fontSize: 13
    }
  }), React.createElement("div", {
    className: `ios-toggle blue ${r.on ? "on" : ""}`,
    onClick: () => setReminder(i, {
      on: !r.on
    })
  }))), !list.length && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12
    }
  }, "—")));
};
function _ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const _WD_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const _TRAINING = ["mattina", "ore17", "ore21", "ore22"];
function _todayDaytype(config) {
  const ymd = _ymd(new Date());
  if (config && config.overrides && config.overrides[ymd]) return config.overrides[ymd];
  const wd = _WD_KEYS[new Date().getDay()];
  return config && config.weekly && config.weekly[wd] || "riposo";
}
const PromemoriaOverrides = ({
  config,
  persist,
  t
}) => {
  const [pick, setPick] = React.useState(() => _ymd(new Date()));
  const [msg, setMsg] = React.useState("");
  const daytypeOf = ymd => {
    if (config.overrides && config.overrides[ymd]) return config.overrides[ymd];
    const wd = _WD_KEYS[new Date(ymd + "T12:00:00").getDay()];
    return config.weekly && config.weekly[wd] || "riposo";
  };
  const move = dir => {
    const src = pick;
    const srcType = daytypeOf(src);
    if (!_TRAINING.includes(srcType)) {
      setMsg(t("Quel giorno non ha allenamento da spostare"));
      return;
    }
    const d = new Date(src + "T12:00:00");
    d.setDate(d.getDate() + (dir === "after" ? 1 : -1));
    const dst = _ymd(d);
    persist({
      ...config,
      overrides: {
        ...config.overrides,
        [src]: "riposo",
        [dst]: srcType
      }
    });
    setMsg(t("Allenamento spostato al") + " " + dst);
  };
  const clearOverride = ymd => {
    const next = {
      ...config.overrides
    };
    delete next[ymd];
    persist({
      ...config,
      overrides: next
    });
  };
  const todayYmd = _ymd(new Date());
  const active = Object.keys(config.overrides || {}).filter(k => k >= todayYmd).sort();
  return React.createElement("div", {
    className: "card",
    style: {
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      textTransform: "uppercase"
    }
  }, t("Sposta allenamento")), React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, React.createElement("input", {
    type: "date",
    value: pick,
    min: todayYmd,
    onChange: e => setPick(e.target.value),
    style: {
      flex: 1,
      padding: "7px 10px",
      borderRadius: 9,
      background: "var(--card-2)",
      color: "var(--text)",
      border: "1px solid var(--border)",
      fontSize: 13
    }
  })), React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, React.createElement("button", {
    onClick: () => move("before"),
    style: {
      flex: 1,
      border: 0,
      borderRadius: 10,
      padding: "10px",
      background: "var(--card-2)",
      color: "var(--text)",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, "← ", t("Giorno prima")), React.createElement("button", {
    onClick: () => move("after"),
    style: {
      flex: 1,
      border: 0,
      borderRadius: 10,
      padding: "10px",
      background: "var(--card-2)",
      color: "var(--text)",
      fontSize: 13,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, t("Giorno dopo"), " →")), msg && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12
    }
  }, msg), active.length > 0 && React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, active.map(k => React.createElement("div", {
    key: k,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12.5
    }
  }, React.createElement("span", {
    className: "num",
    style: {
      flex: 1
    }
  }, k, " → ", t(_DT_LABELS[config.overrides[k]] || config.overrides[k])), React.createElement("button", {
    onClick: () => clearOverride(k),
    style: {
      border: 0,
      background: "transparent",
      color: "var(--danger)",
      fontSize: 12,
      cursor: "pointer"
    }
  }, "✕")))));
};
const Promemoria = ({
  device,
  onNav
}) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [config, setConfig] = React.useState(() => {
    const saved = window.storage ? window.storage.get("notifConfig", null) : null;
    return saved || (window.buildDefaultNotifConfig ? window.buildDefaultNotifConfig() : {
      weekly: {},
      daytypes: {},
      overrides: {}
    });
  });
  const [enabled, setEnabled] = React.useState(() => window.storage ? window.storage.get("notifEnabled", false) : false);
  const [status, setStatus] = React.useState("");
  const [selDay, setSelDay] = React.useState(() => _todayDaytype(config));
  const persist = next => {
    setConfig(next);
    if (window.storage) window.storage.set("notifConfig", next);
    if (window.pushAPI) window.pushAPI.syncConfig(next);
  };
  const onToggleMaster = async () => {
    if (!window.pushAPI) return;
    if (enabled) {
      try {
        await window.pushAPI.disable();
      } catch (e) {
        setStatus(t("Errore attivazione notifiche"));
        return;
      }
      setEnabled(false);
      setStatus("");
      return;
    }
    let res;
    try {
      res = await window.pushAPI.enable(config);
    } catch (e) {
      setStatus(t("Errore attivazione notifiche"));
      return;
    }
    if (res.ok) {
      setEnabled(true);
      setStatus(t("Notifiche attive"));
    } else {
      const map = {
        "unsupported": t("Notifiche non supportate su questo dispositivo"),
        "not-installed": t("Le notifiche richiedono l'app installata sulla Home"),
        "not-configured": t("Configurazione push mancante"),
        "denied": t("Permesso negato — riattiva da Impostazioni iOS"),
        "subscribe-failed": t("Errore attivazione notifiche"),
        "save-failed": t("Errore attivazione notifiche")
      };
      setStatus(map[res.error] || "Errore: " + res.error);
    }
  };
  const regen = () => {
    if (window.buildDefaultNotifConfig) persist(window.buildDefaultNotifConfig());
  };
  return React.createElement("div", {
    className: "fade-up",
    style: {
      padding: isDesktop ? "32px 40px" : "10px 16px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, React.createElement("div", null, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-3)",
      letterSpacing: 0.5,
      textTransform: "uppercase"
    }
  }, t("Impostazioni")), React.createElement("h1", {
    style: {
      fontSize: isDesktop ? 28 : 24,
      fontWeight: 600
    }
  }, t("Promemoria"))), React.createElement("div", {
    className: "card",
    style: {
      padding: 16,
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, React.createElement(Icon, {
    name: "pill",
    size: 20,
    color: "var(--accent)"
  }), React.createElement("div", {
    style: {
      flex: 1
    }
  }, React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, t("Attiva notifiche")), status && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12,
      marginTop: 2
    }
  }, status)), React.createElement("div", {
    className: `ios-toggle blue ${enabled ? "on" : ""}`,
    onClick: onToggleMaster
  })), React.createElement(PromemoriaEditor, {
    config: config,
    persist: persist,
    selDay: selDay,
    setSelDay: setSelDay,
    t: t
  }), React.createElement(PromemoriaOverrides, {
    config: config,
    persist: persist,
    t: t
  }), React.createElement("button", {
    onClick: regen,
    style: {
      border: "1px solid var(--border)",
      background: "var(--card)",
      color: "var(--text)",
      borderRadius: 14,
      padding: 13,
      fontSize: 14,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, t("Rigenera orari dal piano")));
};
window.Promemoria = Promemoria;
})();

// ══ app.jsx ══
;(function () {
const StatusBar = () => React.createElement("div", {
  style: {
    height: "env(safe-area-inset-top)",
    flexShrink: 0,
    background: "var(--statusbar-bg, var(--bg))"
  }
});
const Screen = ({
  which,
  device,
  state,
  set,
  globalCtx
}) => {
  const onNav = s => set(st => ({
    ...st,
    screen: s
  }));
  const pass = {
    device,
    onNav,
    globalCtx
  };
  switch (which) {
    case "dashboard":
      return React.createElement(Dashboard, {
        ...pass,
        activities: state.activities,
        addActivity: a => set(st => ({
          ...st,
          activities: [{
            ...a,
            id: Date.now(),
            when: "Oggi"
          }, ...st.activities]
        })),
        checkIn: state.checkIn,
        setCheckIn: v => set(st => ({
          ...st,
          checkIn: v
        })),
        bodyWeight: state.bodyWeight,
        setBodyWeight: v => set(st => ({
          ...st,
          bodyWeight: v
        }))
      });
    case "scheda":
      return React.createElement(Scheda, {
        ...pass,
        scheda: state.scheda,
        setScheda: s => set(st => ({
          ...st,
          scheda: s
        })),
        checkIn: state.checkIn
      });
    case "dieta":
      return React.createElement(Dieta, pass);
    case "spesa":
      return React.createElement(Spesa, {
        ...pass,
        spesaChecked: state.spesaChecked,
        setSpesaChecked: v => set(st => ({
          ...st,
          spesaChecked: v
        })),
        spesaFreq: state.spesaFreq,
        setSpesaFreq: v => set(st => ({
          ...st,
          spesaFreq: v
        }))
      });
    case "coach":
      return React.createElement(Coach, {
        ...pass,
        activities: state.activities,
        checkIn: state.checkIn,
        bodyWeight: state.bodyWeight
      });
    case "storico":
      return React.createElement(Storico, pass);
    case "impostazioni":
      return React.createElement(Impostazioni, {
        ...pass,
        theme: state.theme,
        setTheme: v => set(st => ({
          ...st,
          theme: v
        })),
        bodyWeight: state.bodyWeight,
        setBodyWeight: v => set(st => ({
          ...st,
          bodyWeight: v
        })),
        onResetAll: () => {
          window.storage.clear();
          window.location.reload();
        }
      });
    case "promemoria":
      return React.createElement(Promemoria, pass);
    case "onboarding":
      return React.createElement(Onboarding, {
        ...pass,
        onDone: () => set(st => ({
          ...st,
          screen: "dashboard"
        }))
      });
    default:
      return null;
  }
};
function _applyTheme(theme) {
  const root = document.documentElement;
  let light;
  if (theme === "light") light = true;else if (theme === "dark") light = false;else {
    light = !(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  root.classList.toggle("theme-light", light);
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach(m => m.setAttribute("content", light ? "#f7f7fa" : "#0b0b0f"));
}
window._syncState = {
  status: "idle",
  last: null
};
function _setSyncState(status) {
  const prev = window._syncState || {};
  window._syncState = {
    status,
    last: status === "ok" ? Date.now() : prev.last || null
  };
  try {
    window.dispatchEvent(new Event("lfh-sync"));
  } catch (_) {}
}
function _safe(p, ms) {
  return Promise.race([p.then(v => ({
    ok: true,
    value: v
  })).catch(e => ({
    ok: false,
    err: String(e)
  })), new Promise(resolve => setTimeout(() => resolve({
    ok: false,
    err: "timeout"
  }), ms))]);
}
function _saveSettingRetry(key, value, tries = 2) {
  if (!window.sheetsAPI) return Promise.resolve(false);
  const attempt = n => window.sheetsAPI.saveSettings({
    key,
    value: String(value)
  }).then(() => {
    console.log("[sync push]", key, "✓");
    return true;
  }).catch(e => {
    if (n > 0) return new Promise(r => setTimeout(r, 800)).then(() => attempt(n - 1));
    console.warn("[sync push err]", key, e);
    return false;
  });
  return attempt(tries);
}
window._saveSettingRetry = _saveSettingRetry;
const _repoOverride = {};
async function _reconcileRepoFiles() {
  if (!window.storage) return;
  const st = window.storage;
  const files = [{
    file: "scheda.txt",
    key: "schedaData",
    parse: window.parseScheda,
    valid: p => !!p && Array.isArray(p.days) && p.days.some(d => d && Array.isArray(d.exercises) && d.exercises.length)
  }, {
    file: "dieta.txt",
    key: "dietaData",
    parse: window.parseDieta,
    valid: p => !!p && Object.keys(p || {}).some(k => p[k] && Array.isArray(p[k].meals) && p[k].meals.length)
  }];
  await Promise.all(files.map(async ({
    file,
    key,
    parse,
    valid
  }) => {
    try {
      const url = new URL(file, document.baseURI).href + "?_cb=" + Date.now();
      const res = await fetch(url, {
        cache: "no-store"
      });
      if (!res.ok) return;
      const text = await res.text();
      if (!text || !text.trim()) return;
      if (parse) {
        try {
          if (!valid(parse(text))) return;
        } catch (_) {
          return;
        }
      }
      if (text === st.get(key + "_src", null)) return;
      st.set(key, text);
      st.set(key + "_src", text);
      st.set(key + "_name", file);
      st.set(key + "_at", new Date().toISOString());
      _repoOverride[key] = true;
      _saveSettingRetry(key, text);
      console.log("[repo-file] " + key + " aggiornato da " + file + " → storage + cloud");
    } catch (e) {
      console.warn("[repo-file]", file, e);
    }
  }));
}
window._reconcileRepoFiles = _reconcileRepoFiles;
let _getAllUnsupported = false;
async function _cloudSync(opts) {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  const {
    pesiMs = 8000,
    settingsMs = 15000
  } = opts || {};
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    _setSyncState("offline");
    return;
  }
  _setSyncState("syncing");
  try {
    let pesiRes = null,
      settingsRes = null;
    if (_getAllUnsupported === false && window.sheetsAPI.getAll) {
      const allRes = await _safe(window.sheetsAPI.getAll(), Math.max(pesiMs, settingsMs));
      const v = allRes.ok ? allRes.value : null;
      if (v && Array.isArray(v.pesoCorporeo) && v.settings && typeof v.settings === "object") {
        pesiRes = {
          ok: true,
          value: v.pesoCorporeo
        };
        settingsRes = {
          ok: true,
          value: v.settings
        };
      } else if (allRes.ok) {
        _getAllUnsupported = true;
        console.log("[sync] getAll non supportato dal backend → fallback 2 chiamate");
      } else {
        pesiRes = settingsRes = {
          ok: false,
          err: allRes.err
        };
      }
    }
    if (!settingsRes) {
      [pesiRes, settingsRes] = await Promise.all([_safe(window.sheetsAPI.getPesoCorporeo(), pesiMs), _safe(window.sheetsAPI.getSettings(), settingsMs)]);
    }
    if (pesiRes.ok) {
      const pesi = pesiRes.value;
      if (Array.isArray(pesi) && pesi.length > 0) {
        if (window.WorkoutProgress) {
          const merged = window.WorkoutProgress.mergeWeightLog(st.get("weightLog", []), pesi, "cloud");
          st.set("weightLog", merged);
          if (merged.length) st.set("bodyWeight", merged[merged.length - 1].weight);
        } else {
          st.set("bodyWeight", pesi[pesi.length - 1].weight);
        }
        console.log("[sync] weightLog merge ←", pesi.length, "cloud rows");
      }
    } else {
      console.warn("[sync] getPesoCorporeo:", pesiRes.err);
    }
    let cloudKeys = null;
    if (settingsRes.ok && settingsRes.value && typeof settingsRes.value === "object") {
      const s = settingsRes.value;
      cloudKeys = s;
      ["schedaData", "dietaData"].forEach(k => {
        if (_repoOverride[k]) return;
        if (s[k]) {
          st.set(k, s[k]);
          console.log("[sync pull]", k, "✓");
        }
      });
      const spesaCloud = s.spesaChecked2 || s.spesaChecked;
      if (spesaCloud) {
        try {
          st.set("spesaChecked", JSON.parse(spesaCloud));
          console.log("[sync pull] spesaChecked ✓");
        } catch (_) {}
      }
      if (s.spesaFreq) st.set("spesaFreq", Number(s.spesaFreq) || 1);
      if (s.spesaExtra) {
        try {
          st.set("spesaExtra", JSON.parse(s.spesaExtra));
        } catch (_) {}
      }
      if (s.weightGoal && parseFloat(s.weightGoal) > 0) st.set("weightGoal", parseFloat(s.weightGoal));
      if (s.exNotes) {
        try {
          st.set("exNotes", JSON.parse(s.exNotes));
        } catch (_) {}
      }
      if (s.bodyWeight && parseFloat(s.bodyWeight) > 0) {
        st.set("bodyWeight", parseFloat(s.bodyWeight));
        console.log("[sync pull] bodyWeight (settings) →", s.bodyWeight);
      }
      if (s.onboardingDone === "true") st.set("onboardingDone", true);
    } else {
      console.warn("[sync] getSettings:", settingsRes.err);
    }
    const hasBW = parseFloat(st.get("bodyWeight", 0)) > 0;
    const hasGroq = !!st.get("groqApiKey", "");
    if (hasGroq || hasBW) {
      st.set("onboardingDone", true);
      if (cloudKeys && cloudKeys.onboardingDone !== "true") {
        window.sheetsAPI.saveSettings({
          key: "onboardingDone",
          value: "true"
        }).catch(() => {});
      }
      console.log("[sync] onboardingDone → true");
    }
    if (cloudKeys) _cloudPushMissing(cloudKeys);else console.warn("[sync] pull settings fallito → push saltato (anti-clobber)");
    _setSyncState(settingsRes.ok || pesiRes.ok ? "ok" : "error");
    if (settingsRes.ok) _maybeAutoBackup();
  } catch (e) {
    console.warn("[sync] error:", e);
    _setSyncState("error");
  }
}
let _backupTriedThisSession = false;
function _maybeAutoBackup() {
  if (_backupTriedThisSession || !window.storage || !window.sheetsAPI) return;
  const st = window.storage;
  const last = st.get("lastAutoBackup", null);
  if (last && Date.now() - last < 6.5 * 86400000) return;
  _backupTriedThisSession = true;
  try {
    const data = {};
    st.keys().sort().forEach(k => {
      if (k === "groqApiKey" || k === "errorLog" || k === "sheetsQueue") return;
      data[k] = st.get(k, null);
    });
    const json = JSON.stringify({
      _lfhBackup: 1,
      exportedAt: new Date().toISOString(),
      auto: true,
      data
    });
    if (json.length > 900000) {
      console.warn("[backup] snapshot troppo grande, salto");
      return;
    }
    window.sheetsAPI.post({
      action: "saveBackup",
      json
    }).then(r => {
      if (r && r.success && !r.queued) {
        st.set("lastAutoBackup", Date.now());
        console.log("[backup] auto-backup su Sheets ✓ (" + (r.chunks || "?") + " chunk)");
      }
    }).catch(e => console.warn("[backup] non riuscito (backend senza saveBackup?):", e.message));
  } catch (_) {}
}
function _cloudPushMissing(cloudKeys) {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  const save = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      _saveSettingRetry(key, value);
    }
  };
  const KEYS = ["bodyWeight", "onboardingDone", "spesaFreq", "weightGoal"];
  KEYS.forEach(k => {
    const local = st.get(k, "");
    if (local && !cloudKeys[k]) {
      save(k, k === "onboardingDone" ? "true" : local);
    }
  });
  ["schedaData", "dietaData"].forEach(k => {
    const local = st.get(k, null);
    if (local && !cloudKeys[k]) {
      save(k, local);
    }
  });
  const sc = st.get("spesaChecked", null);
  if (sc && Object.keys(sc).length > 0 && !cloudKeys.spesaChecked2) {
    save("spesaChecked2", JSON.stringify(sc));
  }
  [["spesaExtra", []], ["exNotes", {}]].forEach(([k, empty]) => {
    const local = st.get(k, empty);
    if (local && Object.keys(local).length > 0 && !cloudKeys[k]) {
      save(k, JSON.stringify(local));
    }
  });
}
window._cloudPushAll = function () {
  if (!window.sheetsAPI || !window.storage) return Promise.resolve();
  const st = window.storage;
  const saves = [];
  const push = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      saves.push(_saveSettingRetry(key, value));
    }
  };
  push("bodyWeight", st.get("bodyWeight", ""));
  push("spesaFreq", st.get("spesaFreq", ""));
  push("weightGoal", st.get("weightGoal", ""));
  push("onboardingDone", st.get("onboardingDone", false) ? "true" : "");
  const sc = st.get("spesaChecked", null);
  if (sc && Object.keys(sc).length > 0) push("spesaChecked2", JSON.stringify(sc));
  const se = st.get("spesaExtra", []);
  if (se && se.length > 0) push("spesaExtra", JSON.stringify(se));
  const en = st.get("exNotes", {});
  if (en && Object.keys(en).length > 0) push("exNotes", JSON.stringify(en));
  const scheda = st.get("schedaData", null);
  if (scheda) push("schedaData", scheda);
  const dieta = st.get("dietaData", null);
  if (dieta) push("dietaData", dieta);
  return Promise.all(saves);
};
function _cleanupOldDailyKeys() {
  if (!window.storage || !window.storage.keys) return;
  try {
    const cut = new Date();
    cut.setDate(cut.getDate() - 90);
    const cutKey = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
    const re = /^(checkIn_|hydration_|notes_|gym_|integ_|coachChat_|schedaProg_|muscleSets_|dietaCheck_|gymStart_|restDay_|nudgeDismissed_)(\d{4}-\d{2}-\d{2})$/;
    window.storage.keys().forEach(k => {
      const m = k.match(re);
      if (m && m[2] < cutKey) window.storage.remove(k);
    });
  } catch (_) {}
}
const UpdateBanner = ({
  onApply
}) => {
  const t = useT();
  return React.createElement("div", {
    style: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9995,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: "calc(env(safe-area-inset-top) + 9px) 16px 9px",
      background: "var(--accent)",
      color: "#fff",
      fontSize: 13.5,
      fontWeight: 600,
      boxShadow: "0 2px 12px rgba(0,0,0,0.28)"
    }
  }, React.createElement("span", null, "🔄 ", t("Nuova versione disponibile")), React.createElement("button", {
    onClick: onApply,
    style: {
      background: "rgba(255,255,255,0.22)",
      color: "#fff",
      border: 0,
      borderRadius: 8,
      padding: "6px 14px",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer"
    }
  }, t("Aggiorna")));
};
const PullToRefresh = ({
  scrollEl,
  onRefresh
}) => {
  const t = useT();
  const [phase, setPhase] = React.useState("idle");
  const armedRef = React.useRef(false);
  const iconRef = React.useRef(null);
  const THRESHOLD = 70;
  React.useEffect(() => {
    const el = scrollEl && scrollEl.current;
    if (!el || !(window.Motion && window.Motion.enabled())) return;
    const onScroll = () => {
      const y = -el.scrollTop;
      if (iconRef.current) {
        const p = Math.max(0, Math.min(1, y / THRESHOLD));
        iconRef.current.style.opacity = String(p);
        iconRef.current.style.transform = `rotate(${p * 270}deg) scale(${0.6 + p * 0.4})`;
      }
      if (y >= THRESHOLD) armedRef.current = true;
    };
    const onTouchEnd = () => {
      if (!armedRef.current) return;
      armedRef.current = false;
      setPhase("sync");
      Promise.resolve(onRefresh && onRefresh()).finally(() => setPhase("idle"));
    };
    el.addEventListener("scroll", onScroll, {
      passive: true
    });
    el.addEventListener("touchend", onTouchEnd, {
      passive: true
    });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [scrollEl, onRefresh]);
  return React.createElement(React.Fragment, null, React.createElement("div", {
    style: {
      position: "absolute",
      top: -48,
      left: 0,
      right: 0,
      height: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none"
    }
  }, React.createElement("span", {
    ref: iconRef,
    style: {
      opacity: 0,
      color: "var(--text-2)",
      display: "flex"
    }
  }, React.createElement(Icon, {
    name: "refresh",
    size: 20,
    strokeWidth: 2
  }))), phase === "sync" && React.createElement("div", {
    className: "pill",
    style: {
      position: "fixed",
      top: "calc(env(safe-area-inset-top) + 10px)",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 40,
      background: "var(--glass)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      boxShadow: "var(--shadow-2)"
    }
  }, React.createElement("span", {
    className: "spinner",
    style: {
      width: 12,
      height: 12,
      borderWidth: 1.5
    }
  }), t("Aggiornamento…")));
};
const AppFrame = ({
  device: _deviceProp,
  initialScreen,
  chromeless
}) => {
  const _computeDevice = () => {
    const w = window.innerWidth,
      h = window.innerHeight;
    const short = Math.min(w, h),
      long = Math.max(w, h);
    return short >= 600 && long >= 820 ? "desktop" : "mobile";
  };
  const [device, setDevice] = React.useState(_computeDevice);
  React.useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setDevice(_computeDevice()));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);
  const [storageReady, setStorageReady] = React.useState(window.storage ? window.storage.isReady() : false);
  React.useEffect(() => {
    if (!window.storage) {
      setStorageReady(true);
      return;
    }
    window.storage.onReady(() => setStorageReady(true));
  }, []);
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  function initState() {
    const st = window.storage || {
      get: (k, d) => d
    };
    return {
      screen: initialScreen || (st.get("onboardingDone", false) ? "dashboard" : "onboarding"),
      scheda: "Upper A",
      isHome: false,
      activities: st.get("activities", []),
      checkIn: st.get(`checkIn_${today}`, {
        sleep: 4,
        energy: 4,
        ailments: ""
      }),
      bodyWeight: st.get("bodyWeight", 100),
      theme: st.get("theme", "system"),
      spesaChecked: st.get("spesaChecked", {}),
      spesaFreq: st.get("spesaFreq", 1)
    };
  }
  const [state, setStateRaw] = React.useState({
    screen: initialScreen,
    scheda: "Upper A",
    isHome: false,
    activities: [],
    checkIn: {
      sleep: 4,
      energy: 4,
      ailments: ""
    },
    bodyWeight: 100,
    theme: "system",
    spesaChecked: {},
    spesaFreq: 1
  });
  const [lang, setLang] = React.useState(window.storage ? window.storage.get("lang", "it") : "it");
  const [initialized, setInitialized] = React.useState(false);
  const [updateReady, setUpdateReady] = React.useState(() => !!window._swUpdateReady);
  React.useEffect(() => {
    const onUpd = () => setUpdateReady(true);
    window.addEventListener("lfh-sw-update", onUpd);
    return () => window.removeEventListener("lfh-sw-update", onUpd);
  }, []);
  const syncNowRef = React.useRef(null);
  React.useEffect(() => {
    if (!storageReady || initialized) return;
    _cleanupOldDailyKeys();
    _reconcileRepoFiles().finally(() => _cloudSync()).finally(() => {
      const s = initState();
      setStateRaw(s);
      setLang(window.storage ? window.storage.get("lang", "it") : "it");
      setInitialized(true);
    });
  }, [storageReady]);
  const setState = React.useCallback(updater => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!window.storage) return next;
      const t = window.todayKey ? window.todayKey() : today;
      if (next.activities !== prev.activities) window.storage.set("activities", next.activities.slice(0, 50));
      if (next.checkIn !== prev.checkIn) {
        window.storage.set(`checkIn_${t}`, next.checkIn);
        if (window.sheetsAPI) window.sheetsAPI.saveCheckIn({
          date: t,
          sleep: next.checkIn.sleep,
          energy: next.checkIn.energy,
          ailments: next.checkIn.ailments || ""
        }).catch(() => {});
      }
      if (next.bodyWeight !== prev.bodyWeight) {
        window.storage.set("bodyWeight", next.bodyWeight);
        _saveSettingRetry("bodyWeight", next.bodyWeight);
        if (window.sheetsAPI) window.sheetsAPI.savePesoCorporeo({
          date: t,
          weight: next.bodyWeight
        }).catch(() => {});
      }
      if (next.spesaChecked !== prev.spesaChecked) {
        window.storage.set("spesaChecked", next.spesaChecked);
        _saveSettingRetry("spesaChecked2", JSON.stringify(next.spesaChecked));
      }
      if (next.spesaFreq !== prev.spesaFreq) {
        window.storage.set("spesaFreq", next.spesaFreq);
        _saveSettingRetry("spesaFreq", next.spesaFreq);
      }
      if (next.theme !== prev.theme) {
        window.storage.set("theme", next.theme);
        _applyTheme(next.theme);
      }
      return next;
    });
  }, [today]);
  React.useEffect(() => {
    _applyTheme(state.theme);
    if (state.theme === "light" || state.theme === "dark") return;
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => _applyTheme("system");
    if (mq.addEventListener) mq.addEventListener("change", onChange);else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, [state.theme]);
  React.useEffect(() => {
    if (!initialized) return;
    const el = document.querySelector(".lfh-scroll");
    if (el && window.Motion) window.Motion.screenEnter(el);
  }, [state.screen, initialized]);
  React.useEffect(() => {
    if (!initialized) return;
    const pullAndApply = () => {
      if (document.visibilityState !== "visible") return Promise.resolve();
      return _cloudSync({
        pesiMs: 6000,
        settingsMs: 8000
      }).finally(() => {
        const s = initState();
        setStateRaw(prev => ({
          ...prev,
          bodyWeight: s.bodyWeight,
          checkIn: s.checkIn,
          spesaChecked: s.spesaChecked,
          spesaFreq: s.spesaFreq
        }));
      });
    };
    syncNowRef.current = pullAndApply;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") pullAndApply();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const POLL_MS = 45000;
    const interval = setInterval(pullAndApply, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
      syncNowRef.current = null;
    };
  }, [initialized]);
  const scrollRef = React.useRef(null);
  const globalCtx = {
    lang,
    setLang: l => {
      setLang(l);
      window.storage && window.storage.set("lang", l);
    }
  };
  const isDesktop = device === "desktop";
  const isOnboarding = state.screen === "onboarding";
  const wrap = content => React.createElement(LangContext.Provider, {
    value: {
      lang,
      setLang: globalCtx.setLang
    }
  }, updateReady && React.createElement(UpdateBanner, {
    onApply: () => window._swApplyUpdate && window._swApplyUpdate()
  }), content);
  if (!storageReady || !initialized) {
    return wrap(React.createElement("div", {
      className: `lfh ${isDesktop ? "desktop" : "mobile"}`,
      style: {
        alignItems: "center",
        justifyContent: "center"
      }
    }, React.createElement("div", {
      className: "spinner"
    })));
  }
  if (isOnboarding || chromeless) {
    return wrap(React.createElement("div", {
      className: `lfh ${isDesktop ? "desktop" : "mobile"}`
    }, !isDesktop && React.createElement(StatusBar, null), React.createElement("div", {
      className: "lfh-scroll",
      style: {
        flex: 1
      }
    }, React.createElement(Screen, {
      which: state.screen,
      device: device,
      state: state,
      set: setState,
      globalCtx: globalCtx
    }))));
  }
  if (isDesktop) {
    return wrap(React.createElement("div", {
      className: "lfh desktop",
      style: {
        flexDirection: "row"
      }
    }, React.createElement(Sidebar, {
      screen: state.screen,
      onNav: s => setState(st => ({
        ...st,
        screen: s
      }))
    }), React.createElement("div", {
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      }
    }, React.createElement("div", {
      className: "lfh-scroll",
      style: {
        flex: 1
      }
    }, React.createElement("div", {
      style: {
        maxWidth: 960,
        width: "100%",
        margin: "0 auto",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column"
      }
    }, React.createElement(Screen, {
      which: state.screen,
      device: device,
      state: state,
      set: setState,
      globalCtx: globalCtx
    }))))));
  }
  return wrap(React.createElement("div", {
    className: "lfh mobile"
  }, React.createElement(StatusBar, null), state.screen === "coach" ? React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }
  }, React.createElement(Screen, {
    which: state.screen,
    device: device,
    state: state,
    set: setState,
    globalCtx: globalCtx
  })) : React.createElement("div", {
    className: "lfh-scroll",
    ref: scrollRef,
    style: {
      flex: 1,
      position: "relative"
    }
  }, React.createElement(Screen, {
    which: state.screen,
    device: device,
    state: state,
    set: setState,
    globalCtx: globalCtx
  }), state.screen === "dashboard" && React.createElement(PullToRefresh, {
    scrollEl: scrollRef,
    onRefresh: () => syncNowRef.current ? syncNowRef.current() : Promise.resolve()
  })), React.createElement(TabBar, {
    screen: state.screen,
    onNav: s => setState(st => ({
      ...st,
      screen: s
    }))
  })));
};
window.AppFrame = AppFrame;
})();

// ══ mount.jsx ══
;(function () {
const _isMobile = window.innerWidth < 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement("div", {
  style: {
    width: "100%",
    height: "100%"
  }
}, React.createElement(AppFrame, {
  device: _isMobile ? "mobile" : "desktop"
})));
})();
