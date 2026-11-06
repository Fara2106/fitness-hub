import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1 } from "./d1-sqlite.mjs";
import worker, { checkToken } from "../src/worker.mjs";
import { validateSyncBody, MAX_CHANGES, MAX_DATA_BYTES, MAX_ID_LEN } from "../src/validate.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const TOKEN = "t".repeat(64);
const OWNER = "owner-test";
async function newEnv(extra = {}) {
  const DB = createD1();
  await DB.exec(schema);
  return { DB, SYNC_TOKEN: TOKEN, PRIMARY_OWNER: OWNER, LEGACY_TOKEN_ENABLED: "true", ...extra };
}
const NOW = Date.now();
const ch = (id, over = {}) => ({ collection: "settings", id, data: { v: id }, updatedAt: NOW, ...over });
function req(path, { method = "GET", token = TOKEN, origin, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  if (body !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`https://api.test${path}`, {
    method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const sync = (env, body, opts = {}) => worker.fetch(req("/v1/sync", { method: "POST", body, ...opts }), env);
const all = async (env) => (await (await sync(env, { deviceId: "probe", cursor: 0, changes: [] })).json()).changes;

test("health senza token", async () => {
  const res = await worker.fetch(req("/v1/health", { token: null }), await newEnv());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, version: "1" });
});

test("sync: 401 senza token, con token sbagliato, senza SYNC_TOKEN, senza Bearer", async () => {
  const env = await newEnv();
  const body = { deviceId: "a", cursor: 0, changes: [] };
  assert.equal((await sync(env, body, { token: null })).status, 401);
  assert.equal((await sync(env, body, { token: "x".repeat(64) })).status, 401);
  assert.equal((await sync(env, body, { token: "t".repeat(63) })).status, 401);
  assert.equal((await sync(await newEnv({ SYNC_TOKEN: undefined }), body)).status, 401);
  assert.equal((await sync(await newEnv({ SYNC_TOKEN: "" }), body, { token: "" })).status, 401);
  const basic = new Request("https://api.test/v1/sync", {
    method: "POST", headers: { Authorization: `Basic ${TOKEN}` }, body: JSON.stringify(body),
  });
  assert.equal((await worker.fetch(basic, env)).status, 401);
});

test("checkToken: header mancante o non Bearer", async () => {
  const env = { SYNC_TOKEN: TOKEN };
  assert.equal(await checkToken(new Request("https://x/"), env), false);
  assert.equal(await checkToken(req("/", { token: TOKEN }), env), true);
  assert.equal(await checkToken(req("/", { token: TOKEN }), {}), false);
});

test("sync valido: push 2 e pull da 0", async () => {
  const env = await newEnv();
  const res = await sync(env, { deviceId: "a", cursor: 0, changes: [ch("x"), ch("y")] });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.applied, 2);
  assert.equal(j.stale, 0);
  assert.equal(j.changes.length, 2);
  assert.equal(j.more, false);
  assert.equal(j.cursor, Math.max(...j.changes.map((c) => c.seq)));
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("due device: le spunte si sommano", async () => {
  const env = await newEnv();
  const mc = (id) => ({ collection: "mealCheck", id, data: { done: true }, updatedAt: NOW });
  await sync(env, { deviceId: "A", cursor: 0, changes: [mc("2026-11-03:m1")] });
  await sync(env, { deviceId: "B", cursor: 0, changes: [mc("2026-11-03:m2")] });
  const j = await (await sync(env, { deviceId: "B", cursor: 0, changes: [] })).json();
  assert.deepEqual(j.changes.map((c) => c.id).sort(), ["2026-11-03:m1", "2026-11-03:m2"]);
});

test("customExercise: push e pull di un esercizio personalizzato, poi tombstone", async () => {
  const env = await newEnv();
  const data = { name: "Curl al cavo", muscles: ["Bicipiti"], levels: { Bicipiti: "principale" }, equipment: null, notes: "", hasImage: false };
  const r1 = await (await sync(env, { deviceId: "app", cursor: 0, changes: [{ collection: "customExercise", id: "c1", data, updatedAt: NOW }] })).json();
  assert.equal(r1.applied, 1);
  const j = await (await sync(env, { deviceId: "other", cursor: 0, changes: [] })).json();
  const rec = j.changes.find((c) => c.collection === "customExercise" && c.id === "c1");
  assert.deepEqual(rec.data, data);
  const r2 = await (await sync(env, { deviceId: "app", cursor: j.cursor, changes: [{ collection: "customExercise", id: "c1", data: null, deleted: true, updatedAt: NOW + 1 }] })).json();
  assert.equal(r2.applied, 1);
  const j2 = await (await sync(env, { deviceId: "other", cursor: j.cursor, changes: [] })).json();
  assert.equal(j2.changes.find((c) => c.id === "c1").deleted, true);
});

test("input non valido: 400 e nessun record scritto (tutto o niente)", async () => {
  const env = await newEnv();
  const bad = (change, re) => async () => {
    const res = await sync(env, { deviceId: "a", cursor: 0, changes: [ch("ok"), change] });
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.match(j.error, re);
    assert.match(j.error, /changes\[1\]/);
  };
  const res = await worker.fetch(req("/v1/sync", { method: "POST", raw: "{non json" }), env);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
  await bad(ch("z", { collection: "foo" }), /collezione sconosciuta 'foo'/)();
  await bad(ch(""), /id/)();
  await bad(ch("i".repeat(MAX_ID_LEN + 1)), /id/)();
  await bad(ch("big", { data: { s: "x".repeat(MAX_DATA_BYTES) } }), /troppo grande/)();
  await bad(ch("n", { updatedAt: NaN }), /updatedAt/)();
  await bad(ch("n", { updatedAt: "5" }), /updatedAt/)();
  await bad(ch("n", { updatedAt: 0 }), /updatedAt/)();
  await bad(ch("n", { updatedAt: 1.5 }), /updatedAt deve essere un intero/)();
  await bad(ch("n", { updatedAt: 2 ** 53 }), /updatedAt deve essere un intero/)();
  await bad(ch("n", { updatedAt: -5 }), /updatedAt/)();
  await bad(ch("n", { data: [1] }), /data/)();
  await bad(ch("n", { data: null }), /data/)();
  const many = Array.from({ length: MAX_CHANGES + 1 }, (_, i) => ch(`c${i}`));
  assert.equal((await sync(env, { deviceId: "a", cursor: 0, changes: many })).status, 400);
  assert.deepEqual(await all(env), []);
});

test("validateSyncBody: casi limite", () => {
  const ok = (b) => validateSyncBody(b).ok;
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: [] }), true);
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: Array.from({ length: MAX_CHANGES }, (_, i) => ch(`c${i}`)) }), true);
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: [ch("t", { deleted: true, data: null })] }), true);
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: [ch("t", { deleted: true })] }), true);
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: [ch("t", { deleted: "yes" })] }), false);
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: [ch("i".repeat(MAX_ID_LEN))] }), true);
  assert.equal(ok(null), false);
  assert.equal(ok([]), false);
  assert.equal(ok({ deviceId: "", cursor: 0, changes: [] }), false);
  assert.equal(ok({ deviceId: "a".repeat(129), cursor: 0, changes: [] }), false);
  assert.equal(ok({ deviceId: "a", cursor: -1, changes: [] }), false);
  assert.equal(ok({ deviceId: "a", cursor: 1.5, changes: [] }), false);
  assert.equal(ok({ deviceId: "a", cursor: "0", changes: [] }), false);
  assert.equal(ok({ deviceId: "a", cursor: 0 }), false);
  // limite in byte UTF-8, non in caratteri: "é" pesa 2 byte
  const utf = { s: "é".repeat(MAX_DATA_BYTES / 2) };
  assert.equal(ok({ deviceId: "a", cursor: 0, changes: [ch("u", { data: utf })] }), false);
});

test("richiesta troppo grande: 413 senza toccare il db", async () => {
  const env = await newEnv();
  const res = await worker.fetch(req("/v1/sync", { method: "POST", raw: " ".repeat(2 * 1024 * 1024 + 1) }), env);
  assert.equal(res.status, 413);
  assert.ok((await res.json()).error);
});

test("CORS", async () => {
  const env = await newEnv();
  const pre = await worker.fetch(req("/v1/sync", { method: "OPTIONS", token: null, origin: "https://fara2106.github.io" }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "https://fara2106.github.io");
  assert.equal(pre.headers.get("Vary"), "Origin");
  assert.match(pre.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  const evil = await worker.fetch(req("/v1/sync", { method: "OPTIONS", token: null, origin: "https://evil.example" }), env);
  assert.equal(evil.status, 403);
  // anche una POST con token valido da origine non consentita viene respinta
  assert.equal((await sync(env, { deviceId: "a", cursor: 0, changes: [] }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await worker.fetch(req("/v1/health", { origin: "https://evil.example" }), env)).status, 403);
  // origini sosia
  for (const o of ["http://localhost.evil.com", "http://localhost", "http://localhost:80.evil.com", "https://fara2106.github.io.evil.com", "http://fara2106.github.io", "null"]) {
    assert.equal((await worker.fetch(req("/v1/health", { origin: o }), env)).status, 403, o);
  }
  for (const o of ["http://localhost:5173", "http://127.0.0.1:8787"]) {
    const r = await sync(env, { deviceId: "a", cursor: 0, changes: [] }, { origin: o });
    assert.equal(r.status, 200, o);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), o);
  }
  // senza Origin con token valido: ok, senza header CORS
  const native = await sync(env, { deviceId: "a", cursor: 0, changes: [] });
  assert.equal(native.status, 200);
  assert.equal(native.headers.get("Access-Control-Allow-Origin"), null);
  // 401 dall'origine giusta porta comunque gli header CORS
  const unauth = await sync(env, { deviceId: "a", cursor: 0, changes: [] }, { token: null, origin: "https://fara2106.github.io" });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get("Access-Control-Allow-Origin"), "https://fara2106.github.io");
});

test("rotte: 404, 405, errore interno senza dettagli (console.error col solo messaggio)", async (t) => {
  const logged = [];
  t.mock.method(console, "error", (...a) => { logged.push(a.join(" ")); });
  const env = await newEnv();
  assert.equal((await worker.fetch(req("/v1/nope"), env)).status, 404);
  assert.equal((await worker.fetch(req("/"), env)).status, 404);
  assert.equal((await worker.fetch(req("/v1/sync"), env)).status, 405);
  const broken = { SYNC_TOKEN: TOKEN, PRIMARY_OWNER: OWNER, LEGACY_TOKEN_ENABLED: "true", DB: { prepare() { throw new Error("segreto interno"); }, batch() { throw new Error("segreto interno"); } } };
  const res = await sync(broken, { deviceId: "a", cursor: 0, changes: [ch("x")] }, { origin: "https://fara2106.github.io" });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://fara2106.github.io");
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: "errore interno" });
  assert.ok(!text.includes("segreto"));
  assert.deepEqual(logged, ["errore interno: segreto interno"]);
  assert.ok(!logged.join().includes(TOKEN) && !logged.join().includes("deviceId"));
});

test("Content-Length oltre il limite: 413 prima di leggere il corpo", async () => {
  const env = await newEnv();
  let read = false;
  const fake = {
    method: "POST", url: "https://api.test/v1/sync",
    headers: new Headers({ Authorization: `Bearer ${TOKEN}`, "Content-Length": String(2 * 1024 * 1024 + 1) }),
    text: async () => { read = true; return "{}"; },
  };
  const res = await worker.fetch(fake, env);
  assert.equal(res.status, 413);
  assert.equal(read, false);
  // Content-Length nel limite: il corpo viene letto normalmente
  const ok = { ...fake, headers: new Headers({ Authorization: `Bearer ${TOKEN}`, "Content-Length": "60" }),
    text: async () => { read = true; return JSON.stringify({ deviceId: "a", cursor: 0, changes: [] }); } };
  assert.equal((await worker.fetch(ok, env)).status, 200);
  assert.equal(read, true);
});

test("epoch e reset: epoch del DB in ogni risposta; cursore oltre seq → reset e pull da 0", async () => {
  const env = await newEnv();
  const epoch = (await env.DB.prepare("SELECT value FROM meta WHERE key = 'epoch'").first("value"));
  const j1 = await (await sync(env, { deviceId: "a", cursor: 0, changes: [ch("x"), ch("y")] })).json();
  assert.equal(j1.epoch, epoch);
  assert.equal(j1.reset, false);
  assert.equal(j1.cursor, 2);
  // cursore uguale a seq: nessun reset, niente da scaricare
  const j2 = await (await sync(env, { deviceId: "a", cursor: 2, changes: [] })).json();
  assert.equal(j2.reset, false);
  assert.deepEqual(j2.changes, []);
  // DB azzerato (come dopo il cutover): il client col vecchio cursore 50 riceve reset e tutto da 0,
  // anche se il suo push fa salire seq oltre il cursore vecchio
  await env.DB.exec("DELETE FROM records; UPDATE meta SET value = 0 WHERE key = 'seq'; UPDATE meta SET value = 777 WHERE key = 'epoch'");
  await sync(env, { deviceId: "b", cursor: 0, changes: [ch("z")] });
  const many = Array.from({ length: 60 }, (_, i) => ch(`n${i}`));
  const j3 = await (await sync(env, { deviceId: "a", cursor: 50, changes: many })).json();
  assert.equal(j3.reset, true);
  assert.equal(j3.epoch, 777);
  assert.equal(j3.applied, 60);
  assert.equal(j3.changes.length, 61); // z + i 60 appena scritti, dal cursore 0
  assert.ok(j3.changes.some((c) => c.id === "z"));
  // DB senza la riga epoch (schema vecchio): epoch null
  await env.DB.exec("DELETE FROM meta WHERE key = 'epoch'");
  assert.equal((await (await sync(env, { deviceId: "a", cursor: 0, changes: [] })).json()).epoch, null);
});

test("conflicts: la versione del server per ogni change stale, senza doppioni", async () => {
  const env = await newEnv();
  await sync(env, { deviceId: "B", cursor: 0, changes: [ch("k", { data: { v: "server" }, updatedAt: NOW })] });
  const res = await sync(env, { deviceId: "A", cursor: 0, changes: [
    ch("k", { data: { v: "vecchio" }, updatedAt: NOW - 1000 }),
    ch("k", { data: { v: "ancora più vecchio" }, updatedAt: NOW - 2000 }),
    ch("nuovo"),
  ] });
  const j = await res.json();
  assert.equal(j.applied, 1);
  assert.equal(j.stale, 2);
  assert.equal(j.conflicts.length, 1);
  const c = j.conflicts[0];
  assert.deepEqual({ collection: c.collection, id: c.id, data: c.data, updatedAt: c.updatedAt, deviceId: c.deviceId, deleted: c.deleted },
    { collection: "settings", id: "k", data: { v: "server" }, updatedAt: NOW, deviceId: "B", deleted: false });
  assert.ok(Number.isSafeInteger(c.seq));
  // tombstone del server: il conflict lo riporta come deleted con data null
  await sync(env, { deviceId: "B", cursor: 0, changes: [ch("t", { deleted: true, data: null, updatedAt: NOW })] });
  const j2 = await (await sync(env, { deviceId: "A", cursor: 0, changes: [ch("t", { updatedAt: NOW - 5 })] })).json();
  assert.equal(j2.conflicts[0].deleted, true);
  assert.equal(j2.conflicts[0].data, null);
  // nessuno stale → conflicts vuoto
  assert.deepEqual((await (await sync(env, { deviceId: "A", cursor: 0, changes: [ch("altro")] })).json()).conflicts, []);
});
