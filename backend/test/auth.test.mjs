// Account (email + password), sessioni, limite ai tentativi, Accedi con Apple (dietro flag), token legacy,
// migrazione 0003 e CLI admin/account.mjs. D1 simulato su node:sqlite; mai il backend di produzione.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createD1 } from "./d1-sqlite.mjs";
import worker, { resolveOwner } from "../src/worker.mjs";
import {
  PBKDF2_ITERATIONS, SESSION_TTL_MS, hashPassword, verifyPassword, createAccount, setAppleFetch,
} from "../src/auth.mjs";
import { main as cli } from "../admin/account.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const m0003 = readFileSync(new URL("../migrations/0003_accounts.sql", import.meta.url), "utf8");
const CLI = fileURLToPath(new URL("../admin/account.mjs", import.meta.url));
const SERVER = fileURLToPath(new URL("../dev/local-server.mjs", import.meta.url));
const OWNER = "7e8c37a9-0000-4f25-8be3-1c209840db09";
const EMAIL = "Lorenzo@Example.test";
const PASSWORD = "una-password-lunga";
const LEGACY = "L".repeat(64);
const BUNDLE = "it.faraoni.fitnesshub";
const PWA = "https://fara2106.github.io";
const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

async function newEnv(extra = {}) {
  const DB = createD1();
  await DB.exec(schema);
  await createAccount(DB, { id: OWNER, email: EMAIL, password: PASSWORD, now: Date.now() });
  return { DB, SYNC_TOKEN: LEGACY, PRIMARY_OWNER: OWNER, REGISTRATION_OPEN: "false", APPLE_SIGNIN_ENABLED: "false", APPLE_BUNDLE_ID: BUNDLE, ...extra };
}
function req(path, { method = "POST", token, body, ip = "203.0.113.1", origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (ip) headers["CF-Connecting-IP"] = ip;
  if (origin) headers.Origin = origin;
  return new Request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const call = async (env, path, opts) => {
  const res = await worker.fetch(req(path, opts), env);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};
const login = (env, email = EMAIL, password = PASSWORD, ip, deviceName = "iPhone") =>
  call(env, "/v1/auth/login", { body: { email, password, deviceName }, ip });
const me = (env, token) => call(env, "/v1/me", { method: "GET", token });
const sync = (env, token, changes = []) => call(env, "/v1/sync", { token, body: { deviceId: "d", cursor: 0, changes } });

// --- password ---------------------------------------------------------------------------------

test("password: PBKDF2-SHA256 a 100.000 iterazioni, salt da 16 byte, iterazioni salvate per riga", async () => {
  assert.equal(PBKDF2_ITERATIONS, 100000);
  const h = await hashPassword(PASSWORD);
  assert.equal(h.iter, 100000);
  assert.match(h.salt, /^[0-9a-f]{32}$/);
  assert.match(h.hash, /^[0-9a-f]{64}$/);
  assert.notEqual((await hashPassword(PASSWORD)).salt, h.salt, "salt casuale");
  const row = { pw_hash: h.hash, pw_salt: h.salt, pw_iter: h.iter };
  assert.equal(await verifyPassword(PASSWORD, row), true);
  assert.equal(await verifyPassword(PASSWORD + "x", row), false);
  // una riga con un altro numero di iterazioni (alzato in futuro) si verifica col suo pw_iter
  const h2 = await hashPassword(PASSWORD, { iter: 1000 });
  assert.equal(await verifyPassword(PASSWORD, { pw_hash: h2.hash, pw_salt: h2.salt, pw_iter: 1000 }), true);
  assert.equal(await verifyPassword(PASSWORD, { pw_hash: null, pw_salt: null, pw_iter: null }), false);
  await assert.rejects(createAccount(createD1(), { id: "x", email: "a@b.c", password: "corta", now: 1 }), /10 caratteri/);
});

// --- login e sessioni -------------------------------------------------------------------------

test("login ok → la sessione funziona su /v1/sync e /v1/me per l'owner giusto (email senza maiuscole)", async () => {
  const env = await newEnv();
  const r = await login(env, "  lorenzo@example.TEST ");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["email", "expiresAt", "ownerId", "session"]);
  assert.equal(r.body.ownerId, OWNER);
  assert.equal(r.body.email, EMAIL.toLowerCase());
  assert.match(r.body.session, /^[A-Za-z0-9_-]{43}$/, "32 byte base64url");
  assert.ok(Math.abs(r.body.expiresAt - (Date.now() + SESSION_TTL_MS)) < 5000);
  const m = await me(env, r.body.session);
  assert.equal(m.status, 200);
  assert.equal(m.body.ownerId, OWNER);
  assert.equal(m.body.email, EMAIL.toLowerCase());
  assert.ok(Number.isSafeInteger(m.body.epoch));
  const s = await sync(env, r.body.session, [{ collection: "settings", id: "lang", data: { value: "it" }, updatedAt: Date.now() }]);
  assert.equal(s.status, 200);
  assert.equal(s.body.applied, 1);
  assert.equal(await env.DB.prepare("SELECT owner FROM records WHERE id = 'lang'").first("owner"), OWNER);
  const sess = await env.DB.prepare("SELECT * FROM sessions").first();
  assert.equal(sess.device_name, "iPhone");
  assert.equal(sess.account_id, OWNER);
});

test("password sbagliata ed email inesistente → stesso 401; input non valido → 400", async () => {
  const env = await newEnv();
  const a = await login(env, EMAIL, "password-sbagliata", "198.51.100.1");
  const b = await login(env, "nessuno@example.test", PASSWORD, "198.51.100.2");
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, { error: "credenziali non valide" });
  assert.deepEqual(b.body, a.body);
  assert.equal((await call(env, "/v1/auth/login", { body: { email: EMAIL } })).status, 400);
  assert.equal((await call(env, "/v1/auth/login", { body: { email: 1, password: PASSWORD } })).status, 400);
  const raw = await worker.fetch(new Request("https://api.test/v1/auth/login", { method: "POST", body: "{" }), env);
  assert.equal(raw.status, 400);
  assert.equal((await call(env, "/v1/auth/login", { method: "GET" })).status, 405);
  // account disattivato: stesso 401
  await env.DB.prepare("UPDATE accounts SET disabled = 1").run();
  assert.deepEqual((await login(env, EMAIL, PASSWORD, "198.51.100.3")).body, { error: "credenziali non valide" });
});

test("limite tentativi: 5 errori in 15 minuti per email o per IP → il 6° è 429 (anche con la password giusta)", async () => {
  const env = await newEnv();
  // per email, da IP diversi
  for (let i = 0; i < 5; i++) assert.equal((await login(env, EMAIL, "sbagliata-" + i, `10.0.0.${i}`)).status, 401);
  const blocked = await login(env, EMAIL, PASSWORD, "10.0.1.1");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  // dopo 15 minuti si riprova: si invecchiano i tentativi
  await env.DB.prepare("UPDATE login_attempts SET at = at - ?").bind(15 * 60 * 1000 + 1).run();
  assert.equal((await login(env, EMAIL, PASSWORD, "10.0.1.1")).status, 200);
  // il successo azzera il contatore dell'email: 4 + successo + 4 errori → ancora ammesso
  const env2 = await newEnv();
  for (let i = 0; i < 4; i++) await login(env2, EMAIL, "x".repeat(12), `10.1.0.${i}`);
  assert.equal((await login(env2, EMAIL, PASSWORD, "10.1.1.1")).status, 200);
  for (let i = 0; i < 4; i++) await login(env2, EMAIL, "x".repeat(12), `10.2.0.${i}`);
  assert.equal((await login(env2, EMAIL, PASSWORD, "10.1.1.2")).status, 200);
  // per IP, con email diverse
  const env3 = await newEnv();
  for (let i = 0; i < 5; i++) assert.equal((await login(env3, `u${i}@example.test`, PASSWORD, "192.0.2.9")).status, 401);
  assert.equal((await login(env3, EMAIL, PASSWORD, "192.0.2.9")).status, 429);
  assert.equal((await login(env3, EMAIL, PASSWORD, "192.0.2.10")).status, 200);
  // le righe vecchie vengono potate a ogni errore
  await env3.DB.prepare("UPDATE login_attempts SET at = 1").run();
  await login(env3, "altro@example.test", PASSWORD, "192.0.2.11");
  assert.equal(await env3.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE at = 1").first("n"), 0);
});

test("logout → la sessione dà 401; le altre sessioni restano valide", async () => {
  const env = await newEnv();
  const a = (await login(env)).body.session;
  const b = (await login(env)).body.session;
  assert.equal((await call(env, "/v1/auth/logout", { token: a })).status, 200);
  assert.equal((await me(env, a)).status, 401);
  assert.equal((await sync(env, a)).status, 401);
  assert.equal((await me(env, b)).status, 200);
  assert.equal((await call(env, "/v1/auth/logout", { token: a })).status, 401);
  assert.equal((await call(env, "/v1/auth/logout", {})).status, 401);
});

test("cambio password: revoca le altre sessioni, quella corrente resta; vecchia password rifiutata", async () => {
  const env = await newEnv();
  const a = (await login(env)).body.session;
  const b = (await login(env)).body.session;
  const NEXT = "nuova-password-ok";
  assert.equal((await call(env, "/v1/auth/password", { token: a, body: { current: "sbagliata-123", next: NEXT } })).status, 401);
  assert.equal((await call(env, "/v1/auth/password", { token: a, body: { current: PASSWORD, next: "corta" } })).status, 400);
  assert.equal((await call(env, "/v1/auth/password", { body: { current: PASSWORD, next: NEXT } })).status, 401);
  const ok = await call(env, "/v1/auth/password", { token: a, body: { current: PASSWORD, next: NEXT } });
  assert.equal(ok.status, 200);
  assert.equal((await me(env, a)).status, 200);
  assert.equal((await me(env, b)).status, 401);
  assert.equal((await login(env, EMAIL, PASSWORD, "10.9.9.1")).status, 401);
  assert.equal((await login(env, EMAIL, NEXT, "10.9.9.2")).status, 200);
  // il token legacy non è una sessione: niente cambio password
  const legacyEnv = { ...env, LEGACY_TOKEN_ENABLED: "true" };
  assert.equal((await call(legacyEnv, "/v1/auth/password", { token: LEGACY, body: { current: NEXT, next: PASSWORD } })).status, 401);
});

test("sessione scaduta → 401; scadenza scorrevole aggiornata al massimo una volta all'ora", async () => {
  const env = await newEnv();
  const tok = (await login(env)).body.session;
  const id = sha256Hex(tok);
  const row = () => env.DB.prepare("SELECT last_used_at, expires_at FROM sessions WHERE id = ?").bind(id).first();
  const first = await row();
  await me(env, tok);
  assert.deepEqual(await row(), first, "entro l'ora nessuna scrittura");
  const twoHours = 2 * 3600 * 1000;
  await env.DB.prepare("UPDATE sessions SET last_used_at = last_used_at - ?, expires_at = expires_at - ?").bind(twoHours, twoHours).run();
  await me(env, tok);
  const after = await row();
  assert.ok(after.last_used_at >= first.last_used_at && after.expires_at >= first.expires_at, "scadenza estesa");
  await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(Date.now() - 1).run();
  assert.equal((await me(env, tok)).status, 401);
  assert.equal((await sync(env, tok)).status, 401);
  // revocata
  const t2 = (await login(env)).body.session;
  await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").bind(sha256Hex(t2)).run();
  assert.equal((await me(env, t2)).status, 401);
  // account disattivato: anche le sessioni valide smettono di funzionare
  const t3 = (await login(env)).body.session;
  await env.DB.prepare("UPDATE accounts SET disabled = 1").run();
  assert.equal((await me(env, t3)).status, 401);
});

test("la tabella sessions non contiene mai il token in chiaro", async () => {
  const env = await newEnv();
  const toks = [];
  for (let i = 0; i < 3; i++) toks.push((await login(env, EMAIL, PASSWORD, "10.3.0.1", `dev-${i}`)).body.session);
  const rows = (await env.DB.prepare("SELECT * FROM sessions").all()).results;
  assert.equal(rows.length, 3);
  const dump = JSON.stringify(rows);
  for (const t of toks) assert.ok(!dump.includes(t), "token in chiaro nel DB");
  assert.deepEqual(rows.map((r) => r.id).sort(), toks.map(sha256Hex).sort());
  const acc = JSON.stringify(await env.DB.prepare("SELECT * FROM accounts").all());
  assert.ok(!acc.includes(PASSWORD));
});

test("SYNC_TOKEN vale solo con LEGACY_TOKEN_ENABLED = \"true\"", async () => {
  for (const flag of [undefined, "false", "1", "TRUE", ""]) {
    const env = await newEnv({ LEGACY_TOKEN_ENABLED: flag });
    assert.equal((await me(env, LEGACY)).status, 401, `flag ${flag}`);
    assert.equal((await sync(env, LEGACY)).status, 401);
    assert.equal(await resolveOwner(req("/v1/me", { token: LEGACY }), env), null);
  }
  const env = await newEnv({ LEGACY_TOKEN_ENABLED: "true" });
  const m = await me(env, LEGACY);
  assert.equal(m.status, 200);
  assert.deepEqual({ ownerId: m.body.ownerId, email: m.body.email }, { ownerId: OWNER, email: EMAIL.toLowerCase() });
  assert.equal((await sync(env, LEGACY)).status, 200);
  assert.equal(await resolveOwner(req("/v1/me", { token: LEGACY }), env), OWNER);
  // una sessione funziona anche con il token legacy acceso
  assert.equal((await me(env, (await login(env)).body.session)).status, 200);
  assert.equal((await me(env, "x".repeat(43))).status, 401);
});

test("register: 403 con la registrazione chiusa; aperta → account nuovo con sessione", async () => {
  const env = await newEnv();
  const r = await call(env, "/v1/auth/register", { body: { email: "nuovo@example.test", password: PASSWORD } });
  assert.equal(r.status, 403);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n"), 1);
  const open = await newEnv({ REGISTRATION_OPEN: "true" });
  const ok = await call(open, "/v1/auth/register", { body: { email: "nuovo@example.test", password: PASSWORD, deviceName: "x" } });
  assert.equal(ok.status, 200);
  assert.notEqual(ok.body.ownerId, OWNER);
  assert.equal((await me(open, ok.body.session)).body.ownerId, ok.body.ownerId);
  assert.equal((await call(open, "/v1/auth/register", { body: { email: "NUOVO@example.test", password: PASSWORD } })).status, 409);
  assert.equal((await call(open, "/v1/auth/register", { body: { email: "altro@example.test", password: "corta" } })).status, 400);
});

test("CORS: la PWA può chiamare /v1/auth/* (preflight e risposta)", async () => {
  const env = await newEnv();
  const pre = await worker.fetch(req("/v1/auth/login", { method: "OPTIONS", origin: PWA }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), PWA);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  const r = await call(env, "/v1/auth/login", { body: { email: EMAIL, password: PASSWORD }, origin: PWA });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), PWA);
  assert.equal((await call(env, "/v1/auth/login", { body: { email: EMAIL, password: PASSWORD }, origin: "https://evil.example" })).status, 403);
});

// --- Accedi con Apple ---------------------------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString("base64url");
async function appleKit() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const other = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const calls = [];
  setAppleFetch(async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ keys: [{ kty: "RSA", kid: "test-kid", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e }] }), { headers: { "Content-Type": "application/json" } });
  });
  const sign = async (claims, { kid = "test-kid", alg = "RS256", key = kp.privateKey } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: "https://appleid.apple.com", aud: BUNDLE, iat: now, exp: now + 600, sub: "apple-sub-1", ...claims };
    const head = b64url(JSON.stringify({ alg, kid }));
    const body = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
  };
  return { sign, calls, otherKey: other.privateKey };
}
const NONCE = "nonce-grezzo-del-client";

test("/v1/auth/apple e /apple/link → 404 con il flag spento", async () => {
  const env = await newEnv();
  assert.equal((await call(env, "/v1/auth/apple", { body: { identityToken: "a.b.c", nonce: NONCE } })).status, 404);
  const tok = (await login(env)).body.session;
  assert.equal((await call(env, "/v1/auth/apple/link", { token: tok, body: { identityToken: "a.b.c", nonce: NONCE } })).status, 404);
});

test("Apple con flag acceso: JWT valido entra; aud/iss/exp/nonce/firma/alg sbagliati → 401; JWKS in cache", async () => {
  const kit = await appleKit();
  const env = await newEnv({ APPLE_SIGNIN_ENABLED: "true" });
  await env.DB.prepare("UPDATE accounts SET apple_sub = 'apple-sub-1' WHERE id = ?").bind(OWNER).run();
  const nonceHash = sha256Hex(NONCE);
  const apple = (identityToken, nonce = NONCE, ip) => call(env, "/v1/auth/apple", { body: { identityToken, nonce, deviceName: "iPhone" }, ip });
  const ok = await apple(await kit.sign({ nonce: nonceHash }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.ownerId, OWNER);
  assert.equal((await me(env, ok.body.session)).body.ownerId, OWNER);
  const bad = [
    await kit.sign({ nonce: nonceHash, aud: "it.altro.app" }),
    await kit.sign({ nonce: nonceHash, iss: "https://evil.example" }),
    await kit.sign({ nonce: nonceHash, exp: Math.floor(Date.now() / 1000) - 10 }),
    await kit.sign({ nonce: sha256Hex("altro-nonce") }),
    await kit.sign({}),
    await kit.sign({ nonce: nonceHash }, { key: kit.otherKey }),
    await kit.sign({ nonce: nonceHash }, { alg: "HS256" }),
    await kit.sign({ nonce: nonceHash }, { kid: "kid-sconosciuto" }),
    "non.un.jwt", "abc",
  ];
  let i = 0;
  for (const t of bad) {
    const r = await apple(t, NONCE, `10.7.0.${i++}`);
    assert.equal(r.status, 401, `token ${i} doveva essere rifiutato`);
  }
  // nonce mancante nella richiesta
  assert.equal((await call(env, "/v1/auth/apple", { body: { identityToken: await kit.sign({ nonce: nonceHash }) }, ip: "10.7.1.1" })).status, 400);
  // JWKS: una fetch per il token valido + al massimo una per il kid sconosciuto (poi in cache)
  assert.ok(kit.calls.length <= 2, `JWKS scaricato ${kit.calls.length} volte`);
  assert.ok(kit.calls.every((u) => u === "https://appleid.apple.com/auth/keys"));
  // sub sconosciuto con registrazione chiusa: nessun account creato
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n");
  const unk = await apple(await kit.sign({ nonce: nonceHash, sub: "apple-sub-ignoto" }), NONCE, "10.7.2.1");
  assert.equal(unk.status, 401);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n"), n);
});

test("Apple: /apple/link collega l'Apple ID all'account della sessione; già collegato altrove → 409", async () => {
  const kit = await appleKit();
  const env = await newEnv({ APPLE_SIGNIN_ENABLED: "true" });
  const nonceHash = sha256Hex(NONCE);
  const tok = (await login(env)).body.session;
  assert.equal((await call(env, "/v1/auth/apple/link", { body: { identityToken: await kit.sign({ nonce: nonceHash }), nonce: NONCE } })).status, 401);
  const l = await call(env, "/v1/auth/apple/link", { token: tok, body: { identityToken: await kit.sign({ nonce: nonceHash, sub: "sub-x" }), nonce: NONCE } });
  assert.equal(l.status, 200);
  assert.equal(await env.DB.prepare("SELECT apple_sub FROM accounts WHERE id = ?").bind(OWNER).first("apple_sub"), "sub-x");
  const viaApple = await call(env, "/v1/auth/apple", { body: { identityToken: await kit.sign({ nonce: nonceHash, sub: "sub-x" }), nonce: NONCE } });
  assert.equal(viaApple.body.ownerId, OWNER);
  await createAccount(env.DB, { id: "altro-owner", email: "b@example.test", password: PASSWORD, now: Date.now() });
  const tb = (await login(env, "b@example.test")).body.session;
  const dup = await call(env, "/v1/auth/apple/link", { token: tb, body: { identityToken: await kit.sign({ nonce: nonceHash, sub: "sub-x" }), nonce: NONCE } });
  assert.equal(dup.status, 409);
  const badTok = await call(env, "/v1/auth/apple/link", { token: tb, body: { identityToken: await kit.sign({ nonce: nonceHash, aud: "x" }), nonce: NONCE } });
  assert.equal(badTok.status, 401);
});

// --- migrazione 0003 ------------------------------------------------------------------------------

test("migrazione 0003_accounts.sql: idempotente, non tocca records né meta", async () => {
  const OLD = `
    CREATE TABLE records (owner TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT, updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (owner, collection, id));
    CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO meta VALUES ('seq', 3), ('epoch', 42);
    INSERT INTO records VALUES ('${OWNER}', 'settings', 'lang', '{"value":"it"}', 1, 0, 'd', 3);`;
  const db = createD1();
  await db.exec(OLD);
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b/i.test(m0003.replace(/--.*$/gm, "")));
  assert.ok(schema.includes(m0003.slice(m0003.indexOf("CREATE TABLE IF NOT EXISTS accounts"))), "schema.sql deve contenere le tabelle di 0003");
  await db.exec(m0003);
  await db.exec(m0003);
  const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).results.map((r) => r.name);
  assert.deepEqual(names, ["accounts", "login_attempts", "meta", "records", "sessions"]);
  assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM records").first("n"), 1);
  assert.equal(await db.prepare("SELECT value FROM meta WHERE key = 'epoch'").first("value"), 42);
  // l'account di Lorenzo nasce col suo ownerId di oggi: i record restano suoi
  await createAccount(db, { id: OWNER, email: EMAIL, password: PASSWORD, now: Date.now() });
  const env = { DB: db, REGISTRATION_OPEN: "false", APPLE_SIGNIN_ENABLED: "false" };
  const tok = (await login(env)).body.session;
  const s = await sync(env, tok);
  assert.deepEqual(s.body.changes.map((r) => r.id), ["lang"]);
  // email unica senza distinzione di maiuscole
  await assert.rejects(createAccount(db, { id: "x2", email: "LORENZO@example.test", password: PASSWORD, now: 1 }));
});

// --- CLI admin/account.mjs --------------------------------------------------------------------------

function sink() {
  let text = "";
  const s = new Writable({ write(c, _e, cb) { text += c; cb(); } });
  s.text = () => text;
  return s;
}
// stdin finto del test harness: le righe arrivano come se le scrivesse l'utente (mai argv o env).
function fakeStdin(lines) {
  const s = new PassThrough();
  s.end(lines.map((l) => l + "\n").join(""));
  return s;
}
async function runCli(args, lines = [], extra = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await cli(args, { stdin: fakeStdin(lines), stdout, stderr, allowNonTty: true, ...extra });
  return { code, out: stdout.text(), err: stderr.text() };
}

test("CLI: rifiuta --password come argomento e lo stdin che non è un terminale", () => {
  const r = spawnSync(process.execPath, [CLI, "create", "--email", "a@b.test", "--owner", OWNER, "--local", ":memory:", "--password", "segreta-123456"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /password/i);
  assert.ok(!r.stdout.includes("segreta-123456") && !r.stderr.includes("segreta-123456"));
  const r2 = spawnSync(process.execPath, [CLI, "create", "--email", "a@b.test", "--owner", OWNER, "--local", ":memory:", "--password=segreta-123456"], { encoding: "utf8" });
  assert.notEqual(r2.status, 0);
  // stdin da pipe (non TTY): la CLI non legge password da lì
  const r3 = spawnSync(process.execPath, [CLI, "create", "--email", "a@b.test", "--owner", OWNER, "--local", ":memory:"], { encoding: "utf8", input: `${PASSWORD}\n${PASSWORD}\n`, env: { ...process.env, FITNESS_HUB_PASSWORD: PASSWORD, PASSWORD } });
  assert.notEqual(r3.status, 0);
  assert.match(r3.stderr, /terminale/);
});

test("CLI --local: create (due volte, ≥10), login funzionante, reset-password, sessions, revoke; mai password né hash a video", async () => {
  const dir = mkdtempSync(`${tmpdir()}/lfh-acc-`);
  const file = `${dir}/db.sqlite`;
  try {
    const base = ["--email", EMAIL, "--local", file];
    let r = await runCli(["create", ...base, "--owner", OWNER], [PASSWORD, PASSWORD + "x"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /non coincidono/);
    r = await runCli(["create", ...base, "--owner", OWNER], ["corta", "corta"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /10 caratteri/);
    r = await runCli(["create", ...base, "--owner", "non valido!"], [PASSWORD, PASSWORD]);
    assert.notEqual(r.code, 0);
    r = await runCli(["create", ...base, "--owner", OWNER], [PASSWORD, PASSWORD]);
    assert.equal(r.code, 0, r.err);
    const sqlite = new DatabaseSync(file);
    const acc = sqlite.prepare("SELECT * FROM accounts").get();
    sqlite.close();
    assert.equal(acc.id, OWNER);
    assert.equal(acc.pw_iter, 100000);
    for (const t of [r.out, r.err]) {
      assert.ok(!t.includes(PASSWORD) && !t.includes(acc.pw_hash) && !t.includes(acc.pw_salt), "password o hash stampati");
    }
    // stesso account due volte → errore
    assert.notEqual((await runCli(["create", ...base, "--owner", "altro-owner"], [PASSWORD, PASSWORD])).code, 0);
    // il DB creato dalla CLI funziona col Worker
    const env = { DB: createD1(file), REGISTRATION_OPEN: "false" };
    const tok = (await login(env)).body.session;
    assert.equal((await me(env, tok)).body.ownerId, OWNER);
    r = await runCli(["sessions", ...base]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /iPhone/);
    assert.ok(!r.out.includes(tok) && !r.out.includes(sha256Hex(tok)), "sessions non stampa token né hash interi");
    // reset-password: nuova password, sessioni revocate
    const NEXT = "password-resettata";
    r = await runCli(["reset-password", ...base], [NEXT, NEXT]);
    assert.equal(r.code, 0, r.err);
    assert.ok(!r.out.includes(NEXT) && !r.err.includes(NEXT));
    assert.equal((await me(env, tok)).status, 401);
    assert.equal((await login(env, EMAIL, PASSWORD, "10.5.0.1")).status, 401);
    const tok2 = (await login(env, EMAIL, NEXT, "10.5.0.2")).body.session;
    assert.equal((await me(env, tok2)).status, 200);
    r = await runCli(["revoke", ...base]);
    assert.equal(r.code, 0, r.err);
    assert.equal((await me(env, tok2)).status, 401);
    assert.notEqual((await runCli(["reset-password", "--email", "nessuno@example.test", "--local", file], [NEXT, NEXT])).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --remote: SQL con valori già hashati verso wrangler d1 execute --remote, mai stampato", async () => {
  const seen = [];
  const runRemote = async (sql) => { seen.push(sql); return { ok: true, results: [], changes: 1 }; };
  const r = await runCli(["create", "--email", EMAIL, "--owner", OWNER, "--remote"], [PASSWORD, PASSWORD], { runRemote });
  assert.equal(r.code, 0, r.err);
  const inserts = seen.filter((q) => /^INSERT INTO accounts/.test(q));
  assert.equal(inserts.length, 1);
  assert.ok(seen.every((q) => !q.includes(PASSWORD)), "password in chiaro nell'SQL");
  for (const t of [r.out, r.err]) assert.ok(!t.includes(inserts[0]) && !/INSERT|pw_hash/i.test(t), "SQL stampato");
  // lo stesso SQL applicato a un DB locale dà un account che accede
  const db = createD1();
  await db.exec(schema);
  await db.exec(inserts[0]);
  assert.equal((await login({ DB: db })).status, 200);
  // il runner vero chiama wrangler con l'argomento --command (nessuna shell)
  const { remoteArgs } = await import("../admin/account.mjs");
  assert.deepEqual(remoteArgs("SELECT 1").slice(0, 6), ["wrangler", "d1", "execute", "fitness-hub-db", "--remote", "--json"]);
  assert.deepEqual(remoteArgs("SELECT 1").slice(-2), ["--command", "SELECT 1"]);
  // né --local né --remote → errore
  assert.notEqual((await runCli(["create", "--email", EMAIL, "--owner", OWNER], [PASSWORD, PASSWORD])).code, 0);
});

// --- local-server --account e CLI login ---------------------------------------------------------

function startServer(args) {
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/^ready (http:\/\/127\.0\.0\.1:\d+)$/m);
      if (m) resolve({ child, url: m[1], out: () => out });
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", (c) => reject(new Error(`local-server terminato (${c}): ${err}`)));
    setTimeout(() => reject(new Error("local-server non pronto")), 8000);
  });
}

test("local-server --account + CLI login: sessione in un file 600, mai a video", async () => {
  const srv = await startServer(["--port", "0", "--account", `${EMAIL}:${PASSWORD}`, "--owner", OWNER]);
  const dir = mkdtempSync(`${tmpdir()}/lfh-login-`);
  try {
    assert.ok(!srv.out().includes(PASSWORD));
    const out = `${dir}/sub/session`;
    let r = await runCli(["login", "--email", EMAIL, "--api", srv.url, "--out", out], ["sbagliata-1234"]);
    assert.notEqual(r.code, 0);
    assert.ok(!existsSync(out));
    r = await runCli(["login", "--email", EMAIL, "--api", srv.url, "--out", out, "--device-name", "Mac (CLI)"], [PASSWORD]);
    assert.equal(r.code, 0, r.err);
    assert.equal(statSync(out).mode & 0o777, 0o600);
    const tok = readFileSync(out, "utf8").trim();
    assert.ok(!r.out.includes(tok) && !r.err.includes(tok) && !r.out.includes(PASSWORD));
    const m = await (await fetch(`${srv.url}/v1/me`, { headers: { Authorization: `Bearer ${tok}` } })).json();
    assert.equal(m.ownerId, OWNER);
    // senza --token il token legacy non esiste
    assert.equal((await fetch(`${srv.url}/v1/me`, { headers: { Authorization: "Bearer undefined" } })).status, 401);
  } finally {
    srv.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
