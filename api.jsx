// api.jsx — Google Sheets REST API  +  Groq API

// ── Default credentials (sovrascritti dalle Impostazioni se cambiati) ───────
(function _setDefaults() {
  // sheetsUrl: inserisci qui l'URL del tuo Google Apps Script deployato
  // (es. https://script.google.com/macros/s/XXXX/exec)
  // NB: l'URL del foglio non funziona come endpoint — serve quello dello script
  const DEFAULT_SHEETS_URL = "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";
  const DEFAULT_GROQ_KEY   = ""; // Inserisci la chiave in Impostazioni → AI Coach

  if (!window.storage.get("sheetsUrl",  "")) window.storage.set("sheetsUrl",  DEFAULT_SHEETS_URL);
  if (!window.storage.get("groqApiKey", "")) window.storage.set("groqApiKey", DEFAULT_GROQ_KEY);
})();

// ── Google Sheets — chiamate tramite Cloudflare Worker proxy ─────────────
// Il Worker chiama Apps Script server-to-server evitando i blocchi CORS.
// Sostituisci con il tuo URL Cloudflare Worker dopo il deploy.
const _PROXY = "https://fitness-hub-proxy.lorefara97.workers.dev";

window.sheetsAPI = {
  async get(params) {
    const url = new URL(_PROXY, location.origin);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString());
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

  // ── POST endpoints ──
  async savePeso(d)        { return this.post({ action: "savePeso",        ...d }); },
  async savePesoCorporeo(d){ return this.post({ action: "savePesoCorporeo",...d }); },
  async saveSessione(d)    { return this.post({ action: "saveSessione",    ...d }); },
  async saveMovimento(d)   { return this.post({ action: "saveMovimento",   ...d }); },
  async saveCheckIn(d)     { return this.post({ action: "saveCheckIn",     ...d }); },

  // ── Settings sync (cross-device) ──
  async getSettings()    { return this.get({ action: "getSettings" }); },
  async saveSettings(d)  { return this.post({ action: "saveSettings", ...d }); },

  // Test connessione
  async testConnection() {
    const data = await this.get({ action: "getPesoCorporeo" });
    return { ok: true, rows: Array.isArray(data) ? data.length : "?" };
  },
};

// ── Groq API ───────────────────────────────────────────────────────────────
window.groqAPI = {
  async complete({ messages, systemPrompt, model = "llama-3.3-70b-versatile", maxTokens = 512 }) {
    const apiKey = window.storage.get("groqApiKey", "");
    if (!apiKey) throw new Error("API key Groq non configurata. Vai in Impostazioni ⚙️");

    const msgs = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature: 0.75 }),
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try { const e = await res.json(); errMsg = e.error?.message || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
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
  const day = new Date().getDay(); // 0=Sun,1=Mon,2=Tue,...,6=Sat
  if (day === 1) return { id: "Upper A", label: "UPPER A",  muscles: ["Petto", "Schiena", "Bicipiti"], muscleKeys: ["petto","schiena","bicipiti"] };
  if (day === 3) return { id: "Lower",   label: "LOWER",    muscles: ["Gambe", "Glutei", "Core"],       muscleKeys: ["quadricipiti","femorali","glutei","polpacci"] };
  if (day === 5) return { id: "Upper B", label: "UPPER B",  muscles: ["Schiena", "Spalle", "Tricipiti"],muscleKeys: ["schiena","spalle","tricipiti"] };
  return null; // rest day
};
