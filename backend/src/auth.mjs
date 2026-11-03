// Account e sessioni: hash delle password (PBKDF2-SHA256), sessioni opache salvate solo come hash,
// limite ai tentativi di accesso, verifica del JWT di "Accedi con Apple" (RS256).
// Solo WebCrypto (crypto.subtle): gira identico nel Worker e in Node (test, CLI admin).
const encoder = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

// Il runtime dei Worker rifiuta PBKDF2 oltre 100.000 iterazioni: si usa esattamente il massimo.
// Ogni riga salva le sue iterazioni (pw_iter), così il valore si può alzare in futuro senza rompere gli hash vecchi.
export const PBKDF2_ITERATIONS = 100000;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 1024;
export const SESSION_TTL_MS = 180 * 24 * 3600 * 1000;       // scadenza scorrevole: 180 giorni
export const SESSION_REFRESH_MS = 3600 * 1000;               // al massimo una scrittura all'ora per sessione
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
export const APPLE_ISSUER = "https://appleid.apple.com";
export const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_KEYS_TTL_MS = 3600 * 1000;
const APPLE_REFETCH_MIN_MS = 60 * 1000;                      // kid sconosciuto: al massimo un nuovo download al minuto

// --- codifiche -------------------------------------------------------------------------------------

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function sha256Hex(text) {
  return toHex(new Uint8Array(await subtle().digest("SHA-256", encoder.encode(text))));
}

// Confronto a tempo costante tra due sequenze di byte: nessuna uscita anticipata sul contenuto.
// Lunghezze diverse → false (le lunghezze qui sono pubbliche: hash e digest di dimensione fissa).
export function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
const timingSafeEqualText = (a, b) => timingSafeEqual(encoder.encode(String(a)), encoder.encode(String(b)));

// --- password --------------------------------------------------------------------------------------

async function pbkdf2(password, salt, iterations) {
  const key = await subtle().importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

// → { hash, salt, iter } (hex). `iter` diverso dal default solo nei test o per alzarlo in futuro.
export async function hashPassword(password, { iter = PBKDF2_ITERATIONS, salt } = {}) {
  const s = salt || randomBytes(16);
  return { hash: toHex(await pbkdf2(password, s, iter)), salt: toHex(s), iter };
}

// Verifica contro una riga di `accounts`. Una riga senza password (account solo Apple) o malformata
// costa comunque un PBKDF2 (salt fittizio): stesso tempo di una password sbagliata.
export async function verifyPassword(password, row) {
  const salt = row && fromHex(row.pw_salt);
  const expected = row && fromHex(row.pw_hash);
  const iter = row && Number.isInteger(row.pw_iter) && row.pw_iter > 0 && row.pw_iter <= PBKDF2_ITERATIONS ? row.pw_iter : null;
  const usable = !!(salt && salt.length === 16 && expected && expected.length === 32 && iter);
  const got = await pbkdf2(typeof password === "string" ? password : "", usable ? salt : new Uint8Array(16), usable ? iter : PBKDF2_ITERATIONS);
  return timingSafeEqual(got, usable ? expected : new Uint8Array(32)) && usable;
}

export const normalizeEmail = (e) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const isValidEmail = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(e);
export function passwordProblem(p) {
  if (typeof p !== "string") return "password mancante";
  if (p.length < MIN_PASSWORD) return `la password deve avere almeno ${MIN_PASSWORD} caratteri`;
  if (p.length > MAX_PASSWORD) return "password troppo lunga";
  return null;
}

// Crea un account (test, local-server, CLI --local). L'id È l'ownerId dei record.
export async function createAccount(db, { id, email, password, now, appleSub = null }) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error("email non valida");
  const h = await hashPassword(password);
  await db.prepare(
    "INSERT INTO accounts (id, email, pw_hash, pw_salt, pw_iter, apple_sub, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
  ).bind(id, e, h.hash, h.salt, h.iter, appleSub, now).run();
  return { id, email: e };
}

export const findAccountByEmail = (db, email) =>
  db.prepare("SELECT * FROM accounts WHERE email = ? COLLATE NOCASE").bind(normalizeEmail(email)).first();

// --- sessioni ---------------------------------------------------------------------------------------

// Token opaco: 32 byte casuali in base64url, restituito UNA volta al client. Nel DB solo SHA-256 hex.
// La ricerca per hash non dà informazioni utili sui tempi: chi attacca non controlla la preimmagine dell'hash.
export async function createSession(db, accountId, deviceName, now) {
  const token = toBase64Url(randomBytes(32));
  const expiresAt = now + SESSION_TTL_MS;
  await db.prepare(
    "INSERT INTO sessions (id, account_id, device_name, created_at, last_used_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)"
  ).bind(await sha256Hex(token), accountId, deviceName, now, now, expiresAt).run();
  return { token, expiresAt };
}

// Sessione valida (hash trovato, non revocata, non scaduta, account attivo) → { sessionId, accountId, email }.
// Estende la scadenza scorrevole al massimo una volta all'ora.
export async function lookupSession(db, token, now) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const id = await sha256Hex(token);
  const row = await db.prepare(
    `SELECT s.id, s.account_id, s.last_used_at, s.expires_at, s.revoked, a.email, a.disabled
       FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id = ?`
  ).bind(id).first();
  if (!row || row.revoked || row.disabled || !(row.expires_at > now)) return null;
  if (now - row.last_used_at >= SESSION_REFRESH_MS) {
    await db.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ? AND revoked = 0")
      .bind(now, now + SESSION_TTL_MS, id).run();
  }
  return { sessionId: id, accountId: row.account_id, email: row.email };
}

export const revokeSession = (db, sessionId) =>
  db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").bind(sessionId).run();

// --- limite ai tentativi ------------------------------------------------------------------------------

export const attemptKeys = (email, ip) => [`email:${normalizeEmail(email)}`, `ip:${ip || "unknown"}`];

// true se una delle chiavi ha già LOGIN_MAX_FAILURES errori negli ultimi 15 minuti.
export async function isRateLimited(db, keys, now) {
  const since = now - LOGIN_WINDOW_MS;
  for (const key of keys) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?").bind(key, since).first("n");
    if (n >= LOGIN_MAX_FAILURES) return true;
  }
  return false;
}

// Registra un errore per ogni chiave e pota le righe fuori finestra (in un unico lotto).
export async function recordFailure(db, keys, now) {
  const ins = db.prepare("INSERT INTO login_attempts (key, at) VALUES (?, ?)");
  await db.batch([
    db.prepare("DELETE FROM login_attempts WHERE at <= ?").bind(now - LOGIN_WINDOW_MS),
    ...keys.map((k) => ins.bind(k, now)),
  ]);
}

export const clearFailures = (db, key) => db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();

// --- Accedi con Apple ---------------------------------------------------------------------------------

let appleFetch = (url) => globalThis.fetch(url);
let appleKeys = { at: 0, keys: [] };
let appleLastFetch = 0;

// Solo per i test: fetch finto (JWKS generato in locale). Svuota la cache.
export function setAppleFetch(fn) {
  appleFetch = fn || ((url) => globalThis.fetch(url));
  appleKeys = { at: 0, keys: [] };
  appleLastFetch = 0;
}

async function loadAppleKeys(now, force) {
  const fresh = now - appleKeys.at < APPLE_KEYS_TTL_MS;
  if (fresh && !force) return appleKeys.keys;
  if (force && now - appleLastFetch < APPLE_REFETCH_MIN_MS) return appleKeys.keys;
  appleLastFetch = now;
  const res = await appleFetch(APPLE_KEYS_URL);
  if (!res || !res.ok) throw new Error("chiavi Apple non disponibili");
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys.filter((k) => k && k.kty === "RSA" && typeof k.kid === "string") : [];
  appleKeys = { at: now, keys };
  return keys;
}

const decodeJson = (part) => {
  const bytes = fromBase64Url(part);
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

// Verifica l'identityToken di Apple → claims, oppure null (mai eccezioni per un token cattivo).
// Controlli: struttura JWS, alg = RS256, kid nel JWKS di Apple, firma RSASSA-PKCS1-v1_5/SHA-256,
// iss, aud = bundle id, exp nel futuro, iat non nel futuro (5 min di tolleranza), sub,
// nonce = SHA-256 hex del nonce inviato dal client (confronto a tempo costante).
export async function verifyAppleToken(identityToken, { bundleId, nonce, now }) {
  if (typeof identityToken !== "string" || identityToken.length > 8192 || !bundleId) return null;
  const parts = identityToken.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  const sig = fromBase64Url(parts[2]);
  if (!header || !claims || !sig || header.alg !== "RS256" || typeof header.kid !== "string") return null;
  let keys = await loadAppleKeys(now, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadAppleKeys(now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;
  let valid = false;
  try {
    const key = await subtle().importKey(
      "jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await subtle().verify("RSASSA-PKCS1-v1_5", key, sig, encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return null;
  }
  if (!valid) return null;
  const nowSec = now / 1000;
  const audOk = claims.aud === bundleId || (Array.isArray(claims.aud) && claims.aud.includes(bundleId));
  if (claims.iss !== APPLE_ISSUER || !audOk) return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) return null;
  if (claims.iat !== undefined && (typeof claims.iat !== "number" || claims.iat > nowSec + 300)) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  if (typeof claims.nonce !== "string" || typeof nonce !== "string" || !nonce) return null;
  if (!timingSafeEqualText(claims.nonce, await sha256Hex(nonce))) return null;
  return claims;
}
