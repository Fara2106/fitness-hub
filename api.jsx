// api.jsx — Groq API (Coach) + helper condivisi (beep, giorno, sessione di oggi)
// Dati e sync NON passano più di qui: vivono in syncv2.jsx (backend D1) e localdata.jsx.

// ── Default credentials (sovrascritti dalle Impostazioni se cambiati) ───────
(function _setDefaults() {
  const DEFAULT_GROQ_KEY = ""; // Inserisci la chiave in Impostazioni → AI Coach

  // IMPORTANTE: eseguire DOPO che IndexedDB ha caricato i valori salvati.
  // Se girasse subito (db non ancora pronto) get() tornerebbe sempre vuoto e
  // sovrascriverebbe la chiave Groq già salvata dall'utente con il default.
  const apply = () => {
    if (!window.storage.get("groqApiKey", "")) window.storage.set("groqApiKey", DEFAULT_GROQ_KEY);
    // Residui del vecchio motore Google Sheets (URL, coda offline, pending/edits
    // delle settings): ormai inutili → via, in silenzio (nessun push).
    ["sheetsUrl", "sheetsQueue", "settingsPending", "settingsEdits"].forEach(k => {
      if (window.storage.get(k, null) !== null) window.storage.remove(k, { silent: true });
    });
  };
  if (window.storage.onReady) window.storage.onReady(apply);
  else apply();
})();

// Proxy legacy: serve SOLO la route /groq (ponte verso Groq col secret del Worker).
const _PROXY = "https://fitness-hub-proxy.lorefara97.workers.dev";

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
      // gpt-oss/qwen3 "ragionano" prima di rispondere e quei token contano nel
      // tetto: con tetti piccoli (es. 10 del test connessione) la risposta
      // arrivava VUOTA ("Risposta vuota dal modello") → minimo 256.
      const reasoning = /^openai\/gpt-oss|^qwen\//.test(m);
      const payload = { model: m, messages: msgs, max_tokens: reasoning ? Math.max(maxTokens, 256) : maxTokens, temperature: 0.75 };
      // Sforzo basso = risposta più rapida e meno token di ragionamento.
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
      maxTokens: 256,   // vedi complete(): i modelli che ragionano non stanno in 10 token
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
