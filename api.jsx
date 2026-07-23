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

  async post(body) {
    const res = await fetch(_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && json.success === false) throw new Error(json.error || "Sheets error");
    return json;
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

  // Test connessione
  async testConnection() {
    const data = await this.get({ action: "getPesoCorporeo" });
    return { ok: true, rows: Array.isArray(data) ? data.length : "?" };
  },
};

// ── Groq API ───────────────────────────────────────────────────────────────
// Due strade, in ordine di preferenza:
//   1. chiave locale sul device (Impostazioni → AI Coach) → chiamata diretta;
//   2. NESSUNA chiave locale → POST al proxy Worker (route /groq), che inietta
//      la chiave dal secret GROQ_API_KEY di Cloudflare. Così i device nuovi
//      funzionano senza configurare nulla e nessuna chiave vive nel client.
// Finché il Worker non ha il secret, la route risponde con un errore chiaro.
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

  async complete({ messages, systemPrompt, model = "llama-3.3-70b-versatile", maxTokens = 512 }) {
    const apiKey = (window.storage.get("groqApiKey", "") || "").trim();

    const msgs = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;
    const payload = { model, messages: msgs, max_tokens: maxTokens, temperature: 0.75 };

    const res = apiKey
      ? await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        })
      : await fetch(_PROXY + "/groq", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const e = await res.json();
        errMsg = (typeof e.error === "string" ? e.error : e.error?.message) || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
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
