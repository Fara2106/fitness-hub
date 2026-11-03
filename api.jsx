// api.jsx — Google Sheets REST API  +  Groq API

// ── Default credentials (sovrascritti dalle Impostazioni se cambiati) ───────
(function _setDefaults() {
  // sheetsUrl: inserisci qui l'URL del tuo Google Apps Script deployato
  // (es. https://script.google.com/macros/s/XXXX/exec)
  // NB: l'URL del foglio non funziona come endpoint — serve quello dello script
  const DEFAULT_SHEETS_URL = "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";
  const DEFAULT_GROQ_KEY   = ""; // Inserisci la chiave in Impostazioni → AI Coach

  // IMPORTANTE: eseguire DOPO che IndexedDB ha caricato i valori salvati.
  // Se girasse subito (db non ancora pronto) get() tornerebbe sempre vuoto e
  // sovrascriverebbe la chiave Groq / l'URL già salvati dall'utente con i default.
  const apply = () => {
    if (!window.storage.get("sheetsUrl",  "")) window.storage.set("sheetsUrl",  DEFAULT_SHEETS_URL);
    if (!window.storage.get("groqApiKey", "")) window.storage.set("groqApiKey", DEFAULT_GROQ_KEY);
  };
  if (window.storage.onReady) window.storage.onReady(apply);
  else apply();
})();

// ── Google Sheets — chiamate tramite Cloudflare Worker proxy ─────────────
// Il Worker chiama Apps Script server-to-server evitando i blocchi CORS.
// Sostituisci con il tuo URL Cloudflare Worker dopo il deploy.
const _PROXY = "https://fitness-hub-proxy.lorefara97.workers.dev";

// ── Coda offline ────────────────────────────────────────────────────────────
// Le scritture DATI (righe: serie, sessioni, peso, check-in, movimenti, misure)
// fallite per RETE finiscono in una coda persistita ("sheetsQueue") e vengono
// ritentate in ordine al ritorno online / in foreground. Senza, una sessione
// chiusa in palestra senza segnale non arrivava MAI su Sheets → storico
// esercizio, e1RM e riepiloghi restavano bucati per sempre.
// NB: gli errori LOGICI del backend ("Non autorizzato", azione sconosciuta)
// NON vanno in coda: ritentarli è inutile. Le settings restano fuori (le
// ri-pusha già la sync con _saveSettingRetry/_cloudPushMissing).
const _QUEUEABLE = { savePeso: 1, savePesoCorporeo: 1, saveSessione: 1, saveMovimento: 1, saveCheckIn: 1, saveMisure: 1 };
let _draining = false;

window.sheetsAPI = {
  async get(params) {
    const url = new URL(_PROXY, location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    // Cache-buster + no-store: senza questo il browser serve risposte GET
    // vecchie dalla cache HTTP (stessa URL ogni volta) → il sync cross-device
    // leggeva dati stale. Fondamentale per far propagare le modifiche tra device.
    url.searchParams.set("_cb", Date.now());
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && json.success === false) throw new Error(json.error || "Sheets error");
    return json;
  },

  // Invio grezzo: distingue gli errori di rete (err._net = true, ritentabili)
  // dagli errori logici del backend (success:false → throw semplice).
  async _send(body) {
    let res;
    try {
      res = await fetch(_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        q.push({ body, ts: Date.now() });
        window.storage.set("sheetsQueue", q.slice(-300));
        console.warn("[queue] rete giù → accodata", body.action, `(${q.length} in coda)`);
        return { success: true, queued: true };
      }
      throw e;
    }
  },

  // Svuota la coda in ordine. Errore di rete → stop (ancora offline, riproverà);
  // errore logico → l'operazione viene scartata (ritentarla non può riuscire).
  async drainQueue() {
    if (_draining || !window.storage) return;
    let q = window.storage.get("sheetsQueue", []) || [];
    if (!q.length) return;
    _draining = true;
    console.log("[queue] drain:", q.length, "operazioni in coda");
    try {
      while (q.length) {
        const head = q[0];
        try {
          await this._send(head.body);
        } catch (e) {
          if (e._net) return; // ancora offline: riprova al prossimo trigger
          console.warn("[queue] scartata (errore backend):", head.body.action, e.message);
        }
        // Rimuovi SOLO l'elemento inviato rileggendo la coda persistita: mentre
        // la send era in volo un'altra scrittura fallita può essere stata
        // accodata — riscrivere la copia locale la cancellava (dato perso).
        q = (window.storage.get("sheetsQueue", []) || []).filter(x => x !== head &&
          !(x.ts === head.ts && JSON.stringify(x.body) === JSON.stringify(head.body)));
        window.storage.set("sheetsQueue", q);
      }
      console.log("[queue] coda svuotata ✓");
    } finally { _draining = false; }
  },

  // ── GET endpoints ──
  async getPesi()          { return this.get({ action: "getPesi" }); },
  async getPesoCorporeo()  { return this.get({ action: "getPesoCorporeo" }); },
  async getUltimiPesi()    { return this.get({ action: "getUltimiPesi" }); },
  async getCheckIn(date)   { return this.get(date ? { action: "getCheckIn", date } : { action: "getCheckIn" }); },

  // ── Misure corporee (cm) — richiede il .gs con getMisure/saveMisure;
  //    col backend vecchio le chiamate falliscono in silenzio (local-only). ──
  async getMisure()        { return this.get({ action: "getMisure" }); },
  async saveMisure(d)      { return this.post({ action: "saveMisure", ...d }); },

  // ── POST endpoints ──
  async savePeso(d)        { return this.post({ action: "savePeso",        ...d }); },
  async savePesoCorporeo(d){ return this.post({ action: "savePesoCorporeo",...d }); },
  async saveSessione(d)    { return this.post({ action: "saveSessione",    ...d }); },
  async saveMovimento(d)   { return this.post({ action: "saveMovimento",   ...d }); },
  async saveCheckIn(d)     { return this.post({ action: "saveCheckIn",     ...d }); },

  // ── Settings sync (cross-device) ──
  async getSettings()    { return this.get({ action: "getSettings" }); },
  async saveSettings(d)  { return this.post({ action: "saveSettings", ...d }); },
  // Peso + settings in UNA chiamata (metà latenza/quota). Backend vecchio senza
  // getAll → risponde col messaggio info di default: _cloudSync lo rileva
  // (manca .settings) e ricade sulle due chiamate separate.
  async getAll()         { return this.get({ action: "getAll" }); },
  // Registro sessioni (foglio Sessioni) — richiede il .gs aggiornato.
  async getSessioni()    { return this.get({ action: "getSessioni" }); },

  // Test connessione
  async testConnection() {
    const data = await this.get({ action: "getPesoCorporeo" });
    return { ok: true, rows: Array.isArray(data) ? data.length : "?" };
  },
};

// Trigger del drain: ritorno online, rientro in foreground, avvio (post-init).
window.addEventListener("online", () => { window.sheetsAPI.drainQueue(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.sheetsAPI.drainQueue();
});
if (window.storage && window.storage.onReady) {
  window.storage.onReady(() => setTimeout(() => window.sheetsAPI.drainQueue(), 4000));
}

// ── Groq API ───────────────────────────────────────────────────────────────
// Due strade, in ordine di preferenza:
//   1. chiave locale sul device (Impostazioni → AI Coach) → chiamata diretta;
//   2. NESSUNA chiave locale → POST al proxy Worker (route /groq), che inietta
//      la chiave dal secret GROQ_API_KEY di Cloudflare. Così i device nuovi
//      funzionano senza configurare nulla e nessuna chiave vive nel client.
// Finché il Worker non ha il secret, la route risponde con un errore chiaro.
// Modelli chat Groq in ordine di preferenza (verificati 2026-11-03 con
// GET /openai/v1/models). Il primo che risponde viene ricordato in storage.
const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

window.groqAPI = {
  hasLocalKey() {
    return !!(window.storage && (window.storage.get("groqApiKey", "") || "").trim());
  },

  // Probe: il proxy sa fare da ponte Groq? (GET /groq → { groq: true/false }).
  // Col Worker legacy (senza route) la risposta non ha `groq` → false.
  async proxyAvailable() {
    try {
      const res = await fetch(_PROXY + "/groq?_cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return false;
      const j = await res.json();
      return !!(j && j.groq === true);
    } catch (_) { return false; }
  },

  // onDelta (opzionale): callback col testo parziale accumulato → risposta in
  // streaming (SSE). Se il server risponde JSON (proxy legacy, errori) si
  // ricade in automatico sul percorso non-stream.
  // model (opzionale): se assente si usa l'ultimo modello che ha funzionato
  // (storage "groqModel") e poi la lista GROQ_MODELS. Se Groq risponde che il
  // modello non esiste più (ritirato) si passa al successivo: a nov 2026
  // llama-3.3-70b-versatile è sparito e il Coach era rotto per tutti.
  async complete({ messages, systemPrompt, model, maxTokens = 900, onDelta }) {
    const apiKey = (window.storage.get("groqApiKey", "") || "").trim();

    const msgs = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    const saved = window.storage.get("groqModel", "");
    const candidates = model ? [model]
      : [saved, ...GROQ_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);

    const send = (m) => {
      const payload = { model: m, messages: msgs, max_tokens: maxTokens, temperature: 0.75 };
      // gpt-oss è un modello "reasoning": sforzo basso = risposta più rapida e
      // meno token di ragionamento a consumare il tetto max_tokens.
      if (/^openai\/gpt-oss/.test(m)) payload.reasoning_effort = "low";
      if (onDelta) payload.stream = true;
      return apiKey
        ? fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          })
        : fetch(_PROXY + "/groq", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
    };

    let res = null, rateLimited = false;
    for (let i = 0; i < candidates.length; i++) {
      res = await send(candidates[i]);
      if (res.ok) {
        // Ricorda solo un cambio "strutturale" (modello ritirato), non il
        // ripiego momentaneo per rate limit.
        if (!model && !rateLimited && candidates[i] !== saved) window.storage.set("groqModel", candidates[i]);
        break;
      }
      let errMsg = `HTTP ${res.status}`;
      try {
        const e = await res.json();
        errMsg = (typeof e.error === "string" ? e.error : e.error?.message) || errMsg;
      } catch (_) {}
      const gone = /does not exist|decommission|model_not_found|not supported|no access/i.test(errMsg);
      // Piano gratuito Groq: tetto di token/minuto PER MODELLO → un altro
      // modello di solito risponde subito.
      const limited = res.status === 429 || /rate limit/i.test(errMsg);
      if (limited) rateLimited = true;
      if ((gone || limited) && i < candidates.length - 1) {
        console.warn("[groq]", limited ? "rate limit" : "modello non disponibile", "→ provo il successivo:", candidates[i]);
        continue;
      }
      if (limited) throw new Error("Troppe richieste al Coach in questo minuto — riprova tra qualche secondo.");
      throw new Error(errMsg);
    }

    // Streaming SSE: accumula i delta e notifica onDelta col testo parziale.
    const ctype = res.headers.get("content-type") || "";
    if (onDelta && res.body && ctype.indexOf("text/event-stream") !== -1) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const d = JSON.parse(data).choices?.[0]?.delta?.content;
            if (d) { full += d; onDelta(full); }
          } catch (_) {}
        }
      }
      if (full.trim()) return full.trim();
      throw new Error("Risposta vuota dal modello");
    }

    const data = await res.json();
    // Worker legacy (inoltra ad Apps Script) o route /groq senza secret:
    // risposta JSON senza choices → messaggio azionabile invece di testo vuoto.
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      if (data && data.success === false) throw new Error("API key Groq non configurata (né sul device né sul proxy). Vai in Impostazioni ⚙️");
      throw new Error("Risposta vuota dal modello");
    }
    return content;
  },

  async testConnection() {
    const reply = await this.complete({
      messages: [{ role: "user", content: "Rispondi solo con 'OK'." }],
      maxTokens: 10,
    });
    return { ok: true, reply };
  },
};

// ── Timer beep (Web Audio) ─────────────────────────────────────────────────
window.playBeep = function (freq = 880, duration = 0.18, gain = 0.3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
};

// ── Today key (YYYY-MM-DD) ─────────────────────────────────────────────────
window.todayKey = function () {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── Detect today's session ─────────────────────────────────────────────────
window.getTodaySession = function () {
  const day = window.getSelectedSession ? window.getSelectedSession() : null;
  if (!day) return null; // riposo o nessun giorno
  const muscles = (day.focus && day.focus.length)
    ? day.focus
    : (window._musclesFromExercises ? window._musclesFromExercises(day.exercises) : []);
  return {
    id: day.key,
    key: day.key,
    label: (day.name || day.key || "").toUpperCase(),
    name: day.name || day.key,
    focus: day.focus || [],
    muscles: muscles,
    muscleKeys: muscles.map(m => String(m).toLowerCase()),
  };
};
