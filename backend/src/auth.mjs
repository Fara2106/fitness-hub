// Account e sessioni: hash delle password (PBKDF2-SHA256), sessioni opache salvate solo come hash,
// limite ai tentativi di accesso, verifica del JWT di "Accedi con Apple" (RS256).
// Solo WebCrypto (crypto.subtle): gira identico nel Worker e in Node (test, CLI admin).
const encoder = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

// Schema delle password (pw_ver = 1): pw_hash = HMAC-SHA256(PEPPER, PBKDF2-SHA256(password, salt, 25.000)).
// 25.000 iterazioni stanno nel budget CPU dei Worker gratuiti (10 ms/richiesta); il pepper (secret del Worker
// PASSWORD_PEPPER, mai nel DB) fa sì che un DB rubato da solo non basti per provare le password offline.
// Ogni riga salva pw_ver e pw_iter: un login riuscito con valori diversi da quelli attuali rifà l'hash (rehashIfNeeded).
// Per uno schema futuro (pw_ver = 2): aggiungerlo in derive(), alzare PW_VER; i login riusciti migrano le righe da soli.
export const PW_VER = 1;
export const PBKDF2_ITERATIONS = 25000;
export const PBKDF2_MAX_ITERATIONS = 100000;                 // limite del runtime dei Worker
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 1024;
export const SESSION_TTL_MS = 180 * 24 * 3600 * 1000;       // scadenza scorrevole: 180 giorni
export const SESSION_REFRESH_MS = 3600 * 1000;               // al massimo una scrittura all'ora per sessione
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_EMAIL = 20;                           // errori per email in 15 minuti (l'email è pubblica: lockout più largo)
export const LOGIN_MAX_IP = 5;                               // errori per IP in 15 minuti
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

export class ConfigError extends Error {}

// Pepper: almeno 32 byte in hex (secret PASSWORD_PEPPER). Mancante o malformato → ConfigError: mai un hash senza.
export function pepperBytes(pepper) {
  const hex = typeof pepper === "string" ? pepper.trim() : "";
  const bytes = hex.length >= 64 ? fromHex(hex) : null;
  if (!bytes) throw new ConfigError("configurazione mancante");
  return bytes;
}

async function pbkdf2(password, salt, iterations) {
  const key = await subtle().importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
async function hmac(keyBytes, data) {
  const key = await subtle().importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle().sign("HMAC", key, data));
}
// pw_ver 1: HMAC(pepper, PBKDF2(password, salt, iter)).
async function derive(password, salt, iter, pepper) {
  return hmac(pepper, await pbkdf2(password, salt, iter));
}

// → { hash, salt, iter, ver } (hex). `iter` diverso dal default solo nei test o per cambiarlo in futuro.
export async function hashPassword(password, pepper, { iter = PBKDF2_ITERATIONS, salt } = {}) {
  const key = pepperBytes(pepper);
  const s = salt || randomBytes(16);
  return { hash: toHex(await derive(password, s, iter, key)), salt: toHex(s), iter, ver: PW_VER };
}

// Verifica contro una riga di `accounts`. Una riga senza password (account solo Apple), assente o malformata
// costa comunque lo stesso lavoro (PBKDF2 alle iterazioni attuali + HMAC, salt fittizio): tempi uguali.
export async function verifyPassword(password, row, pepper) {
  const key = pepperBytes(pepper);
  const salt = row && fromHex(row.pw_salt);
  const expected = row && fromHex(row.pw_hash);
  const iter = row && Number.isInteger(row.pw_iter) && row.pw_iter > 0 && row.pw_iter <= PBKDF2_MAX_ITERATIONS ? row.pw_iter : null;
  const usable = !!(row && row.pw_ver === PW_VER && salt && salt.length === 16 && expected && expected.length === 32 && iter);
  const got = await derive(typeof password === "string" ? password : "", usable ? salt : new Uint8Array(16), usable ? iter : PBKDF2_ITERATIONS, key);
  return timingSafeEqual(got, usable ? expected : new Uint8Array(32)) && usable;
}

// Dopo un login riuscito: se la riga usa uno schema o un numero di iterazioni diverso da quello attuale, rifà l'hash.
export async function rehashIfNeeded(db, row, password, pepper) {
  if (row.pw_ver === PW_VER && row.pw_iter === PBKDF2_ITERATIONS) return false;
  const h = await hashPassword(password, pepper);
  await db.prepare("UPDATE accounts SET pw_hash = ?, pw_salt = ?, pw_iter = ?, pw_ver = ? WHERE id = ?")
    .bind(h.hash, h.salt, h.iter, h.ver, row.id).run();
  return true;
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
export async function createAccount(db, { id, email, password, pepper, now, appleSub = null }) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error("email non valida");
  const h = await hashPassword(password, pepper);
  await db.prepare(
    "INSERT INTO accounts (id, email, pw_hash, pw_salt, pw_iter, pw_ver, apple_sub, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
  ).bind(id, e, h.hash, h.salt, h.iter, h.ver, appleSub, now).run();
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

// --- codici di attivazione (Task 18B) -----------------------------------------------------------------

// Codice monouso con cui l'app nativa (che non ha il token legacy) crea l'account del proprietario.
// 10 caratteri da un alfabeto senza simboli ambigui (niente 0/O/1/I/L): 31^10 ≈ 8·10^14 combinazioni,
// valido 30 minuti, una volta sola, con il limite ai tentativi per IP e per codice. Nel DB solo SHA-256 hex
// del codice normalizzato (maiuscole, senza trattino né spazi): il codice in chiaro si stampa una volta e basta.
export const ACTIVATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ACTIVATION_LENGTH = 10;
export const ACTIVATION_TTL_MS = 30 * 60 * 1000;

// CSPRNG con rifiuto dei byte oltre il multiplo più grande di 31 (nessuna distorsione). → "XXXXX-XXXXX".
export function generateActivationCode() {
  const n = ACTIVATION_ALPHABET.length;
  const max = 256 - (256 % n);
  let out = "";
  while (out.length < ACTIVATION_LENGTH) {
    for (const b of randomBytes(16)) {
      if (b < max && out.length < ACTIVATION_LENGTH) out += ACTIVATION_ALPHABET[b % n];
    }
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// Accettato con o senza trattino, in minuscolo o maiuscolo, con spazi: si confronta la forma normalizzata.
export const normalizeActivationCode = (code) => (typeof code === "string" ? code.replace(/[-\s]/g, "").toUpperCase() : "");
export const activationCodeId = (code) => sha256Hex(normalizeActivationCode(code));
// Chiave del limite tentativi per codice: solo un prefisso dell'hash (mai il codice).
export const codeKey = (id) => `code:${id.slice(0, 8)}`;

// Statement che salvano un nuovo codice per `owner` (gli eventuali codici non usati di quell'owner si cancellano:
// vale solo l'ultimo). Restituiti come [sql, params] perché la CLI --remote li scrive in un file SQL.
export async function activationCodeStatements(owner, now) {
  const code = generateActivationCode();
  const id = await activationCodeId(code);
  const expiresAt = now + ACTIVATION_TTL_MS;
  return {
    code, expiresAt,
    statements: [
      ["DELETE FROM activation_codes WHERE owner = ? AND used_at IS NULL", [owner]],
      ["INSERT INTO activation_codes (id, owner, expires_at, used_at) VALUES (?, ?, ?, NULL)", [id, owner, expiresAt]],
    ],
  };
}

// Crea un codice per `owner` (test, local-server, CLI --local) → { code, expiresAt }.
export async function createActivationCode(db, { owner, now }) {
  const { code, expiresAt, statements } = await activationCodeStatements(owner, now);
  await db.batch(statements.map(([sql, params]) => db.prepare(sql).bind(...params)));
  return { code, expiresAt };
}

// Codice valido (esiste, non usato, non scaduto) → owner, altrimenti null.
export const activationOwner = (db, id, now) =>
  db.prepare("SELECT owner FROM activation_codes WHERE id = ? AND used_at IS NULL AND expires_at > ?").bind(id, now).first("owner");

// Crea l'account e consuma il codice in UN lotto atomico. L'INSERT prende l'id dal codice e inserisce solo se il
// codice è ancora valido; l'UPDATE lo segna usato con le stesse condizioni. Nello stesso lotto le due condizioni
// vedono lo stesso stato: codice valido → account + codice usato; codice nel frattempo usato/scaduto → nessuna riga
// (→ { consumed: false }, 401). Se l'INSERT viola la PRIMARY KEY (account già esistente) o l'email UNIQUE, il lotto
// fallisce tutto: eccezione e codice NON consumato (→ 409).
export async function activateAccount(db, { id, email, password, pepper, now }) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) throw new Error("email non valida");
  const h = await hashPassword(password, pepper);
  const out = await db.batch([
    db.prepare(
      `INSERT INTO accounts (id, email, pw_hash, pw_salt, pw_iter, pw_ver, apple_sub, created_at, disabled)
       SELECT owner, ?, ?, ?, ?, ?, NULL, ?, 0 FROM activation_codes WHERE id = ? AND used_at IS NULL AND expires_at > ?`
    ).bind(e, h.hash, h.salt, h.iter, h.ver, now, id, now),
    db.prepare("UPDATE activation_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?").bind(now, id, now),
    db.prepare("SELECT owner FROM activation_codes WHERE id = ?").bind(id),
  ]);
  const consumed = out[1].meta.changes === 1;
  return consumed ? { consumed, account: { id: out[2].results[0].owner, email: e } } : { consumed };
}

// --- limite ai tentativi ------------------------------------------------------------------------------

export const emailKey = (email) => `email:${normalizeEmail(email)}`;
export const ipKey = (ip) => `ip:${ip || "unknown"}`;
// `email:` → 20; `ip:` e `code:` (codici di attivazione) → 5.
const limitOf = (key) => (key.startsWith("email:") ? LOGIN_MAX_EMAIL : LOGIN_MAX_IP);

// Addebita il tentativo PRIMA di verificare, in un unico lotto atomico: pota le righe vecchie, inserisce una riga
// per chiave e conta le righe nella finestra (inclusa questa). Le richieste concorrenti sono serializzate dal lotto,
// quindi al massimo `limite` tentativi per chiave arrivano alla verifica. Oltre il limite → { limited: true }:
// le righe di QUESTA richiesta si tolgono (martellare a vuoto non allunga il blocco) e non si verifica nulla.
// → { limited, rowids } (rowids = righe di questa richiesta).
export async function chargeAttempt(db, keys, now) {
  const since = now - LOGIN_WINDOW_MS;
  const out = await db.batch([
    db.prepare("DELETE FROM login_attempts WHERE at <= ?").bind(since),
    ...keys.map((k) => db.prepare("INSERT INTO login_attempts (key, at) VALUES (?, ?) RETURNING rowid AS rid").bind(k, now)),
    ...keys.map((k) => db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?").bind(k, since)),
  ]);
  const rowids = out.slice(1, 1 + keys.length).map((r) => r.results[0].rid);
  const counts = out.slice(1 + keys.length).map((r) => r.results[0].n);
  const limited = counts.some((n, i) => n > limitOf(keys[i]));
  if (limited) await dropRows(db, rowids);
  return { limited, rowids };
}

const dropRows = (db, rowids) => db.batch(rowids.map((id) => db.prepare("DELETE FROM login_attempts WHERE rowid = ?").bind(id)));

// Successo: si cancellano tutte le righe delle chiavi della richiesta (email e IP).
export const clearAttempts = (db, keys) =>
  db.batch(keys.map((k) => db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(k)));

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
