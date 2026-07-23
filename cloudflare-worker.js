/**
 * Lorenzo Fitness Hub — Cloudflare Worker (proxy per Google Apps Script)
 *
 * SICUREZZA (2026-07-20):
 *  - Inietta un token segreto (env.APP_TOKEN, NON nel repo) nella richiesta verso
 *    Apps Script → l'URL Apps Script committato nel repo da solo NON basta più:
 *    un attacco diretto a script.google.com senza token viene rifiutato dal .gs.
 *  - Allowlist Origin: solo l'app (https://fara2106.github.io) può usare il Worker
 *    da browser (blocca l'uso da altri siti). Nota onesta: un client non-browser
 *    (curl) può falsificare l'header Origin → questo NON è ermetico; la protezione
 *    reale è il token, che chiude la porta "URL pubblico nel repo".
 *
 * DEPLOY:
 *  1. Incolla questo file nel Worker "fitness-hub-proxy" → Deploy.
 *  2. Worker → Settings → Variables and Secrets → aggiungi un SECRET:
 *       Nome: APP_TOKEN   Valore: <stringa lunga casuale, es. 40+ char>
 *  3. Nello stesso valore imposta la Script Property APP_TOKEN in Apps Script
 *     (Progetto → Impostazioni → Proprietà script) e ri-deploya il .gs.
 *  Finché APP_TOKEN NON è impostato su ENTRAMBI, tutto resta funzionante (legacy).
 *
 * PROXY GROQ (2026-07-23) — route /groq:
 *  - POST /groq: inoltra la chat a api.groq.com iniettando la chiave dal SECRET
 *    GROQ_API_KEY del Worker → i device SENZA chiave locale usano il Coach senza
 *    configurare nulla, e nessuna chiave vive più nel client.
 *  - GET /groq: probe → { success:true, groq:true/false } (l'app la usa per
 *    capire se il proxy è pronto).
 *  Setup: Worker → Settings → Variables and Secrets → SECRET GROQ_API_KEY =
 *  <chiave gsk_… da console.groq.com>. Finché NON è impostata, POST /groq
 *  risponde 501 con errore chiaro e l'app mostra il messaggio "configura".
 *
 * FREE TIER: 100.000 richieste/giorno.
 */

const SHEETS_URL =
  "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";

const ALLOWED_ORIGINS = ["https://fara2106.github.io"];

// ── Rate limit best-effort (in-memory, per-isolate) ─────────────────────────
// Senza KV/Durable Objects il contatore vive nella memoria dell'isolate: non è
// ermetico (isolate diversi = contatori diversi, reset al riciclo), ma taglia
// abusi e scan da una singola sorgente a costo zero. Finestre per-IP:
//  - "groq": 20 POST /5 min  (uso legittimo del Coach: pochi messaggi/minuto)
//  - "all":  150 req /5 min  (la sync fa ~13 GET/5min; la chiusura sessione
//    può sparare ~30-40 POST in burst → 150 lascia margine abbondante)
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL = new Map(); // "ip|bucket" → { start, n }
function rateLimited(ip, bucket, limit) {
  const now = Date.now();
  const key = (ip || "?") + "|" + bucket;
  let e = RL.get(key);
  if (!e || now - e.start > RL_WINDOW_MS) { e = { start: now, n: 0 }; RL.set(key, e); }
  e.n++;
  if (RL.size > 5000) {                       // pruning grossolano anti-crescita
    for (const [k, v] of RL) {
      if (now - v.start > RL_WINDOW_MS) RL.delete(k);
      if (RL.size <= 2500) break;
    }
  }
  return e.n > limit;
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin":  allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

export default {
  async fetch(request, env) {
    const origin  = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers });
    }

    // Gate: da browser, solo l'origine dell'app. (Origin assente = client non
    // browser: lo lasciamo passare perché la protezione vera è il token sotto;
    // se vuoi essere più stretto, rifiuta anche origin === "".)
    if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) {
      return new Response(
        JSON.stringify({ success: false, error: "forbidden origin" }),
        { status: 403, headers }
      );
    }

    // Rate limit globale per IP (best-effort, vedi sopra).
    const clientIp = request.headers.get("CF-Connecting-IP") || "";
    if (rateLimited(clientIp, "all", 150)) {
      return new Response(
        JSON.stringify({ success: false, error: "troppe richieste, riprova tra qualche minuto" }),
        { status: 429, headers }
      );
    }

    // ── Route /groq: ponte verso l'API Groq con chiave server-side ──────────
    if (new URL(request.url).pathname === "/groq") {
      const groqKey = env && env.GROQ_API_KEY;   // SECRET del Worker, NON nel repo
      if (request.method === "GET") {
        return new Response(JSON.stringify({ success: true, groq: !!groqKey }), { headers });
      }
      // Qui l'Origin è OBBLIGATORIA e deve essere in allowlist (a differenza
      // della rotta Sheets, dove il gate vero è il token): la chiave Groq
      // server-side non va prestata a client anonimi. Un non-browser può
      // falsificare l'header, ma il costo di abuso si alza e gli scan
      // automatici vengono tagliati fuori.
      if (ALLOWED_ORIGINS.indexOf(origin) === -1) {
        return new Response(
          JSON.stringify({ success: false, error: "forbidden origin" }),
          { status: 403, headers }
        );
      }
      if (!groqKey) {
        return new Response(
          JSON.stringify({ success: false, error: "Groq non configurato sul proxy (secret GROQ_API_KEY mancante)" }),
          { status: 501, headers }
        );
      }
      // Rate limit dedicato (più stretto del globale): la chiave server-side
      // non deve diventare un proxy LLM gratuito per nessuno.
      if (rateLimited(clientIp, "groq", 20)) {
        return new Response(
          JSON.stringify({ success: false, error: "troppe richieste al Coach, riprova tra qualche minuto" }),
          { status: 429, headers }
        );
      }
      try {
        const p = await request.json().catch(() => null);
        if (!p || !Array.isArray(p.messages) || p.messages.length > 24) {
          return new Response(JSON.stringify({ success: false, error: "payload non valido" }), { status: 400, headers });
        }
        // Cap sul volume: il prompt legittimo dell'app (system con scheda+dieta
        // troncate a 3000 char l'una + 10 messaggi di storia) sta largamente
        // sotto — payload enormi = abuso, non Coach.
        let totalChars = 0;
        for (const m of p.messages) totalChars += String((m && m.content) || "").length;
        if (totalChars > 24000) {
          return new Response(JSON.stringify({ success: false, error: "payload troppo grande" }), { status: 400, headers });
        }
        // Solo i campi attesi, con tetto sui token: il Worker non è un proxy
        // generico verso Groq, fa esattamente quello che serve al Coach.
        const body = {
          model:       typeof p.model === "string" ? p.model : "llama-3.3-70b-versatile",
          messages:    p.messages,
          max_tokens:  Math.min(Number(p.max_tokens) || 512, 1024),
          temperature: typeof p.temperature === "number" ? p.temperature : 0.75,
          stream:      p.stream === true,   // SSE: la risposta viene inoltrata in streaming
        };
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + groqKey },
          body: JSON.stringify(body),
        });
        // Pass-through del body così com'è: se il client ha chiesto stream:true
        // la risposta è SSE (text/event-stream) e va inoltrata in streaming,
        // non bufferizzata — l'app mostra la risposta parola per parola.
        const outHeaders = Object.assign({}, headers, {
          "Content-Type": r.headers.get("content-type") || "application/json",
        });
        return new Response(r.body, { status: r.status, headers: outHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers });
      }
    }

    const token = env && env.APP_TOKEN;   // segreto del Worker, NON nel repo

    try {
      let url  = SHEETS_URL;
      let opts = { redirect: "follow" };

      if (request.method === "GET") {
        const incoming = new URL(request.url);
        const params = incoming.searchParams;
        if (token) params.set("_token", token);      // → e.parameter._token nel .gs
        const qs = params.toString();
        if (qs) url += "?" + qs;
      } else {
        // Corpo JSON: aggiunge il token nel body (→ body._token nel .gs)
        const bodyObj = await request.json().catch(() => ({}));
        if (token) bodyObj._token = token;
        opts.method  = "POST";
        opts.headers = { "Content-Type": "application/json" };
        opts.body    = JSON.stringify(bodyObj);
      }

      const res  = await fetch(url, opts);
      const text = await res.text();
      return new Response(text, { status: 200, headers });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers }
      );
    }
  },
};
