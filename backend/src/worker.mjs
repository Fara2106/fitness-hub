// Worker HTTP: accesso (sessioni degli account, token legacy durante il passaggio), CORS, validazione,
// /v1/sync, /v1/me, /v1/auth/* e /v1/health.
import { applyChanges, pullSince, currentRecords, readMeta } from "./store.mjs";
import { validateSyncBody, PULL_LIMIT } from "./validate.mjs";
import {
  lookupSession, createSession, revokeSession, findAccountByEmail, verifyPassword, hashPassword, passwordProblem,
  normalizeEmail, isValidEmail, attemptKeys, isRateLimited, recordFailure, clearFailures, verifyAppleToken,
  LOGIN_WINDOW_MS,
} from "./auth.mjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_AUTH_BODY_BYTES = 16 * 1024;
const ORIGIN_RE = /^(https:\/\/fara2106\.github\.io|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;
const encoder = new TextEncoder();

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

const bearer = (request) => {
  const header = request.headers.get("Authorization");
  return header && header.startsWith("Bearer ") ? header.slice(7) : null;
};

// Confronto a tempo costante col token legacy SYNC_TOKEN: si confrontano gli hash (stessa lunghezza)
// con un XOR senza uscita anticipata.
export async function checkToken(request, env) {
  const expected = env && env.SYNC_TOKEN;
  if (typeof expected !== "string" || !expected) return false;
  const token = bearer(request);
  if (token === null) return false;
  const [a, b] = await Promise.all([sha256(token), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Chi fa la richiesta. Bearer = sessione di un account (tabella sessions) → l'id dell'account, che È
// l'ownerId dei record. SYNC_TOKEN → PRIMARY_OWNER solo se LEGACY_TOKEN_ENABLED === "true" (passaggio
// dal token incollato agli account; poi si spegne). → { owner, sessionId|null } oppure null.
// Token legacy valido ma PRIMARY_OWNER assente: configurazione rotta → eccezione (500), mai record senza owner.
export async function authenticate(request, env, now = Date.now()) {
  const token = bearer(request);
  if (!token) return null;
  if (env.LEGACY_TOKEN_ENABLED === "true" && (await checkToken(request, env))) {
    const owner = env.PRIMARY_OWNER;
    if (typeof owner !== "string" || !owner) throw new ConfigError("configurazione mancante");
    return { owner, sessionId: null };
  }
  if (!env.DB) return null;
  const s = await lookupSession(env.DB, token, now);
  return s ? { owner: s.accountId, sessionId: s.sessionId, email: s.email } : null;
}

// L'unico punto che decide di chi è la richiesta (null = non autorizzato).
export async function resolveOwner(request, env) {
  const a = await authenticate(request, env);
  return a ? a.owner : null;
}

class ConfigError extends Error {}

const tooLarge = (cors) => json({ error: "richiesta troppo grande (massimo 2 MB)" }, 413, cors);

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

async function handleSync(request, env, cors, owner) {
  // Content-Length dichiarato oltre il limite → 413 senza leggere il corpo.
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge(cors);
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) return tooLarge(cors);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "JSON non valido" }, 400, cors);
  }
  const v = validateSyncBody(body);
  if (!v.ok) return json({ error: v.error }, 400, cors);
  const { deviceId, changes } = v.value;
  // seq letto PRIMA del push: un cursore oltre il seq del server vuol dire database
  // azzerato o ripristinato → reset:true e pull da 0 (il client sostituisce il cursore).
  const meta = await readMeta(env.DB);
  const reset = v.value.cursor > meta.seq;
  const cursor = reset ? 0 : v.value.cursor;
  const { applied, stale, staleKeys } = await applyChanges(env.DB, owner, deviceId, changes, Date.now());
  // conflicts = versione corrente del server per ogni change stale (il client la adotta).
  const conflicts = await currentRecords(env.DB, owner, staleKeys);
  const pulled = await pullSince(env.DB, owner, cursor, PULL_LIMIT);
  return json({
    cursor: pulled.cursor, more: pulled.more, changes: pulled.changes, applied, stale,
    conflicts, epoch: meta.epoch, reset,
  }, 200, cors);
}

// --- /v1/auth/* -------------------------------------------------------------------------------------

// Corpo JSON delle rotte di accesso (piccolo): oggetto oppure una Response d'errore.
async function readAuthBody(request, cors) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_AUTH_BODY_BYTES) return json({ error: "richiesta troppo grande" }, 413, cors);
  const text = await request.text();
  if (encoder.encode(text).length > MAX_AUTH_BODY_BYTES) return json({ error: "richiesta troppo grande" }, 413, cors);
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  return json({ error: "JSON non valido" }, 400, cors);
}

const BAD_CREDENTIALS = { error: "credenziali non valide" };
const clientIp = (request) => request.headers.get("CF-Connecting-IP");
const deviceNameOf = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
const tooMany = (cors) => new Response(JSON.stringify({ error: "troppi tentativi, riprova più tardi" }), {
  status: 429,
  headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Retry-After": String(Math.ceil(LOGIN_WINDOW_MS / 1000)), ...cors,
  },
});

async function issueSession(env, cors, account, deviceName, now) {
  const { token, expiresAt } = await createSession(env.DB, account.id, deviceName, now);
  return json({ session: token, ownerId: account.id, email: account.email, expiresAt }, 200, cors);
}

// POST /v1/auth/login {email, password, deviceName}. Stesso 401 per email inesistente, password sbagliata,
// account disattivato o senza password (sempre un PBKDF2: tempi uguali). 429 dopo 5 errori in 15 minuti
// per email o per IP; il successo azzera il contatore dell'email.
async function handleLogin(request, env, cors) {
  const body = await readAuthBody(request, cors);
  if (body instanceof Response) return body;
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 1024) {
    return json({ error: "email e password obbligatorie" }, 400, cors);
  }
  const now = Date.now();
  const keys = attemptKeys(email, clientIp(request));
  if (await isRateLimited(env.DB, keys, now)) return tooMany(cors);
  const account = await findAccountByEmail(env.DB, email);
  const ok = await verifyPassword(password, account);
  if (!ok || !account || account.disabled) {
    await recordFailure(env.DB, keys, now);
    return json(BAD_CREDENTIALS, 401, cors);
  }
  await clearFailures(env.DB, keys[0]);
  return issueSession(env, cors, account, deviceNameOf(body.deviceName), now);
}

// POST /v1/auth/register: solo con REGISTRATION_OPEN === "true" (oggi chiusa: l'unico account è di Lorenzo).
async function handleRegister(request, env, cors) {
  if (env.REGISTRATION_OPEN !== "true") return json({ error: "registrazione chiusa" }, 403, cors);
  const body = await readAuthBody(request, cors);
  if (body instanceof Response) return body;
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return json({ error: "email non valida" }, 400, cors);
  const problem = passwordProblem(body.password);
  if (problem) return json({ error: problem }, 400, cors);
  const now = Date.now();
  const keys = [attemptKeys(email, clientIp(request))[1]];
  if (await isRateLimited(env.DB, keys, now)) return tooMany(cors);
  if (await findAccountByEmail(env.DB, email)) {
    await recordFailure(env.DB, keys, now);
    return json({ error: "email già registrata" }, 409, cors);
  }
  const h = await hashPassword(body.password);
  const account = { id: crypto.randomUUID(), email };
  await env.DB.prepare(
    "INSERT INTO accounts (id, email, pw_hash, pw_salt, pw_iter, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, 0)"
  ).bind(account.id, email, h.hash, h.salt, h.iter, now).run();
  return issueSession(env, cors, account, deviceNameOf(body.deviceName), now);
}

// Rotte che richiedono una SESSIONE (il token legacy non è una sessione: 401).
async function requireSession(request, env, cors) {
  const a = await authenticate(request, env);
  if (!a || !a.sessionId) return json({ error: "non autorizzato" }, 401, cors);
  return a;
}

async function handleLogout(request, env, cors) {
  const a = await requireSession(request, env, cors);
  if (a instanceof Response) return a;
  await revokeSession(env.DB, a.sessionId);
  return json({ ok: true }, 200, cors);
}

// POST /v1/auth/password {current, next}: cambia password e revoca tutte le ALTRE sessioni dell'account.
// Gli errori sulla password attuale contano nel limite dei tentativi (sessione rubata ≠ password).
async function handlePassword(request, env, cors) {
  const a = await requireSession(request, env, cors);
  if (a instanceof Response) return a;
  const body = await readAuthBody(request, cors);
  if (body instanceof Response) return body;
  if (typeof body.current !== "string") return json({ error: "password attuale obbligatoria" }, 400, cors);
  const problem = passwordProblem(body.next);
  if (problem) return json({ error: problem }, 400, cors);
  const now = Date.now();
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(a.owner).first();
  const keys = attemptKeys(account ? account.email || account.id : a.owner, clientIp(request));
  if (await isRateLimited(env.DB, keys, now)) return tooMany(cors);
  if (!(await verifyPassword(body.current, account))) {
    await recordFailure(env.DB, keys, now);
    return json(BAD_CREDENTIALS, 401, cors);
  }
  const h = await hashPassword(body.next);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?").bind(h.hash, h.salt, h.iter, a.owner),
    env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE account_id = ? AND id != ?").bind(a.owner, a.sessionId),
  ]);
  await clearFailures(env.DB, keys[0]);
  return json({ ok: true }, 200, cors);
}

// Token di Apple dal corpo → claims, oppure una Response d'errore (400 input, 401 token non valido).
async function appleClaims(request, env, cors, body, keys, now) {
  if (typeof body.identityToken !== "string" || typeof body.nonce !== "string" || !body.nonce) {
    return json({ error: "identityToken e nonce obbligatori" }, 400, cors);
  }
  if (await isRateLimited(env.DB, keys, now)) return tooMany(cors);
  const claims = await verifyAppleToken(body.identityToken, { bundleId: env.APPLE_BUNDLE_ID, nonce: body.nonce, now });
  if (!claims) {
    await recordFailure(env.DB, keys, now);
    return json({ error: "token Apple non valido" }, 401, cors);
  }
  return claims;
}

// POST /v1/auth/apple {identityToken, nonce, deviceName}: accede all'account con quell'apple_sub.
// Account inesistente: lo crea solo con la registrazione aperta.
async function handleApple(request, env, cors) {
  const body = await readAuthBody(request, cors);
  if (body instanceof Response) return body;
  const now = Date.now();
  const keys = [attemptKeys("", clientIp(request))[1]];
  const claims = await appleClaims(request, env, cors, body, keys, now);
  if (claims instanceof Response) return claims;
  let account = await env.DB.prepare("SELECT * FROM accounts WHERE apple_sub = ?").bind(claims.sub).first();
  if (account && account.disabled) return json(BAD_CREDENTIALS, 401, cors);
  if (!account) {
    if (env.REGISTRATION_OPEN !== "true") return json({ error: "nessun account collegato a questo Apple ID" }, 401, cors);
    // l'email di Apple non collega account esistenti: solo se libera diventa l'email del nuovo account
    const email = isValidEmail(normalizeEmail(claims.email)) && !(await findAccountByEmail(env.DB, claims.email)) ? normalizeEmail(claims.email) : null;
    account = { id: crypto.randomUUID(), email };
    await env.DB.prepare("INSERT INTO accounts (id, email, apple_sub, created_at, disabled) VALUES (?, ?, ?, ?, 0)")
      .bind(account.id, email, claims.sub, now).run();
  }
  return issueSession(env, cors, account, deviceNameOf(body.deviceName), now);
}

// POST /v1/auth/apple/link (sessione) {identityToken, nonce}: collega l'Apple ID all'account corrente.
async function handleAppleLink(request, env, cors) {
  const a = await requireSession(request, env, cors);
  if (a instanceof Response) return a;
  const body = await readAuthBody(request, cors);
  if (body instanceof Response) return body;
  const now = Date.now();
  const keys = [attemptKeys("", clientIp(request))[1]];
  const claims = await appleClaims(request, env, cors, body, keys, now);
  if (claims instanceof Response) return claims;
  const other = await env.DB.prepare("SELECT id FROM accounts WHERE apple_sub = ?").bind(claims.sub).first();
  if (other && other.id !== a.owner) return json({ error: "Apple ID già collegato a un altro account" }, 409, cors);
  await env.DB.prepare("UPDATE accounts SET apple_sub = ? WHERE id = ?").bind(claims.sub, a.owner).run();
  return json({ ok: true }, 200, cors);
}

const AUTH_ROUTES = {
  "/v1/auth/login": handleLogin,
  "/v1/auth/register": handleRegister,
  "/v1/auth/logout": handleLogout,
  "/v1/auth/password": handlePassword,
  "/v1/auth/apple": handleApple,
  "/v1/auth/apple/link": handleAppleLink,
};
const APPLE_ROUTES = new Set(["/v1/auth/apple", "/v1/auth/apple/link"]);

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
        const owner = await resolveOwner(request, env);
        if (owner === null) return json({ error: "non autorizzato" }, 401, cors);
        return await handleSync(request, env, cors, owner);
      }
      if (pathname === "/v1/me") {
        if (request.method !== "GET") return json({ error: "metodo non consentito" }, 405, cors);
        const a = await authenticate(request, env);
        if (a === null) return json({ error: "non autorizzato" }, 401, cors);
        let email = a.email;
        if (email === undefined) {
          // token legacy: l'email dell'account di PRIMARY_OWNER, se esiste già
          const row = await env.DB.prepare("SELECT email FROM accounts WHERE id = ?").bind(a.owner).first().catch(() => null);
          email = row ? row.email : null;
        }
        const { epoch } = await readMeta(env.DB);
        return json({ ownerId: a.owner, email: email ?? null, epoch }, 200, cors);
      }
      if (Object.hasOwn(AUTH_ROUTES, pathname)) {
        // Accedi con Apple è spento finché APPLE_SIGNIN_ENABLED !== "true": le rotte non esistono.
        if (APPLE_ROUTES.has(pathname) && env.APPLE_SIGNIN_ENABLED !== "true") return json({ error: "non trovato" }, 404, cors);
        if (request.method !== "POST") return json({ error: "metodo non consentito" }, 405, cors);
        return await AUTH_ROUTES[pathname](request, env, cors);
      }
      return json({ error: "non trovato" }, 404, cors);
    } catch (e) {
      // Solo il messaggio dell'errore: mai corpo, header o token della richiesta.
      console.error(`errore interno: ${e && e.message ? e.message : String(e)}`);
      if (e instanceof ConfigError) return json({ error: e.message }, 500, cors);
      return json({ error: "errore interno" }, 500, cors);
    }
  },
};
