// Worker HTTP: auth a token, CORS, validazione, /v1/sync e /v1/health.
import { applyChanges, pullSince } from "./store.mjs";
import { validateSyncBody, PULL_LIMIT } from "./validate.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ORIGIN_RE = /^(https:\/\/fara2106\.github\.io|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;
const encoder = new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Confronto a tempo costante: si confrontano gli hash (stessa lunghezza) con un XOR senza uscita anticipata.
export async function checkToken(request, env) {
  const expected = env && env.SYNC_TOKEN;
  if (typeof expected !== "string" || !expected) return false;
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const [a, b] = await Promise.all([sha256(header.slice(7)), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

async function handleSync(request, env, cors) {
  const declared = Number(request.headers.get("Content-Length"));
  const text = await request.text();
  if ((Number.isFinite(declared) && declared > MAX_BODY_BYTES) || encoder.encode(text).length > MAX_BODY_BYTES) {
    return json({ error: "richiesta troppo grande (massimo 2 MB)" }, 413, cors);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "JSON non valido" }, 400, cors);
  }
  const v = validateSyncBody(body);
  if (!v.ok) return json({ error: v.error }, 400, cors);
  const { deviceId, cursor, changes } = v.value;
  const { applied, stale } = await applyChanges(env.DB, deviceId, changes, Date.now());
  const pulled = await pullSince(env.DB, cursor, PULL_LIMIT);
  return json({ cursor: pulled.cursor, more: pulled.more, changes: pulled.changes, applied, stale }, 200, cors);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    let cors = {};
    if (origin !== null) {
      if (!ORIGIN_RE.test(origin)) return json({ error: "origine non consentita" }, 403, {});
      cors = { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    }
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "86400",
          },
        });
      }
      const { pathname } = new URL(request.url);
      if (pathname === "/v1/health" && request.method === "GET") return json({ ok: true, version: "1" }, 200, cors);
      if (pathname === "/v1/sync") {
        if (request.method !== "POST") return json({ error: "metodo non consentito" }, 405, cors);
        if (!(await checkToken(request, env))) return json({ error: "non autorizzato" }, 401, cors);
        return await handleSync(request, env, cors);
      }
      return json({ error: "non trovato" }, 404, cors);
    } catch {
      return json({ error: "errore interno" }, 500, cors);
    }
  },
};
