/**
 * Lorenzo Fitness Hub — Cloudflare Worker (proxy per Google Apps Script)
 *
 * DEPLOY:
 *  1. Vai su https://workers.cloudflare.com → crea account gratuito
 *  2. Dashboard → Workers & Pages → Create → "Hello World" Worker
 *  3. Dai un nome tipo "fitness-hub-proxy"
 *  4. Clicca "Edit code" → incolla tutto questo file → Deploy
 *  5. Copia l'URL del Worker (es. https://fitness-hub-proxy.TUO-ACCOUNT.workers.dev)
 *  6. Aggiornalo in api.jsx nella variabile _PROXY
 *
 * FREE TIER: 100.000 richieste/giorno — praticamente illimitato per uso personale
 */

const SHEETS_URL =
  "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

export default {
  async fetch(request) {
    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response("", { status: 200, headers: CORS_HEADERS });
    }

    try {
      let url  = SHEETS_URL;
      let opts = { redirect: "follow" };

      if (request.method === "GET") {
        const incoming = new URL(request.url);
        const qs = incoming.searchParams.toString();
        if (qs) url += "?" + qs;
      } else {
        const body = await request.text();
        opts.method = "POST";
        opts.body   = body;
      }

      const res  = await fetch(url, opts);
      const text = await res.text();

      return new Response(text, { status: 200, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },
};
