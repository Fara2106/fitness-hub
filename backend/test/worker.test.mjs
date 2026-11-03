import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1 } from "./d1-sqlite.mjs";
import worker, { checkToken } from "../src/worker.mjs";
import { validateSyncBody, MAX_CHANGES, MAX_DATA_BYTES, MAX_ID_LEN } from "../src/validate.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const TOKEN = "t".repeat(64);
async function newEnv(extra = {}) {
  const DB = createD1();
  await DB.exec(schema);
  return { DB, SYNC_TOKEN: TOKEN, ...extra };
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

test("rotte: 404, 405, errore interno senza dettagli", async () => {
  const env = await newEnv();
  assert.equal((await worker.fetch(req("/v1/nope"), env)).status, 404);
  assert.equal((await worker.fetch(req("/"), env)).status, 404);
  assert.equal((await worker.fetch(req("/v1/sync"), env)).status, 405);
  const broken = { SYNC_TOKEN: TOKEN, DB: { prepare() { throw new Error("segreto interno"); }, batch() { throw new Error("segreto interno"); } } };
  const res = await sync(broken, { deviceId: "a", cursor: 0, changes: [ch("x")] }, { origin: "https://fara2106.github.io" });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://fara2106.github.io");
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: "errore interno" });
  assert.ok(!text.includes("segreto"));
});
