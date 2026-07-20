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
 * FREE TIER: 100.000 richieste/giorno.
 */

const SHEETS_URL =
  "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";

const ALLOWED_ORIGINS = ["https://fara2106.github.io"];

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
