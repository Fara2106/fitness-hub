// Proprietario dei record: isolamento tra owner, GET /v1/me, migrazione 0002_owner.sql, local-server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createD1 } from "./d1-sqlite.mjs";
import worker, { resolveOwner } from "../src/worker.mjs";
import { applyChanges, pullSince, currentRecords, readMeta } from "../src/store.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0002_owner.sql", import.meta.url), "utf8");
const TOKEN = "t".repeat(64);
const A = "owner-a";
const B = "owner-b";
const NOW = Date.now();
const ch = (id, updatedAt, data = { v: id }) => ({ collection: "settings", id, data, updatedAt });

async function newDb() {
  const db = createD1();
  await db.exec(schema);
  return db;
}
const req = (path, { method = "GET", token = TOKEN, body } = {}) => new Request(`https://api.test${path}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test("due owner nello stesso DB non si vedono: pull, conflicts e LWW separati", async () => {
  const db = await newDb();
  await applyChanges(db, A, "devA", [ch("x", 1000, { v: "di A" }), ch("solo-a", 1000)], NOW);
  // stesso collection/id su un altro owner con un updatedAt più vecchio: NON è stale, è un altro record
  const rB = await applyChanges(db, B, "devB", [ch("x", 500, { v: "di B" })], NOW);
  assert.deepEqual({ applied: rB.applied, stale: rB.stale, staleKeys: rB.staleKeys }, { applied: 1, stale: 0, staleKeys: [] });
  const pa = await pullSince(db, A, 0, 100);
  const pb = await pullSince(db, B, 0, 100);
  assert.deepEqual(pa.changes.map((r) => [r.id, r.data.v]).sort(), [["solo-a", "solo-a"], ["x", "di A"]]);
  assert.deepEqual(pb.changes.map((r) => [r.id, r.data.v]), [["x", "di B"]]);
  // conflicts: la versione corrente è quella dello stesso owner
  const stale = await applyChanges(db, B, "devB2", [ch("x", 400, { v: "vecchio" })], NOW);
  assert.equal(stale.stale, 1);
  const cur = await currentRecords(db, B, stale.staleKeys);
  assert.deepEqual(cur.map((r) => r.data.v), ["di B"]);
  assert.deepEqual(await currentRecords(db, B, [{ collection: "settings", id: "solo-a" }]), []);
  // il seq è globale e monotono tra gli owner
  assert.equal((await readMeta(db)).seq, 4);
});

test("worker: i token degli owner non mischiano i dati (resolveOwner è l'unico punto)", async () => {
  const db = await newDb();
  const env = { DB: db, SYNC_TOKEN: TOKEN, PRIMARY_OWNER: A, LEGACY_TOKEN_ENABLED: "true" };
  const post = (e, changes) => worker.fetch(req("/v1/sync", { method: "POST", body: { deviceId: "d", cursor: 0, changes } }), e);
  await post(env, [ch("a1", NOW)]);
  await post({ ...env, PRIMARY_OWNER: B }, [ch("b1", NOW)]);
  const ja = await (await post(env, [])).json();
  const jb = await (await post({ ...env, PRIMARY_OWNER: B }, [])).json();
  assert.deepEqual(ja.changes.map((r) => r.id), ["a1"]);
  assert.deepEqual(jb.changes.map((r) => r.id), ["b1"]);
});

test("GET /v1/me: ownerId ed epoch; 401 senza token o con token sbagliato; 405 se non GET", async () => {
  const db = await newDb();
  const env = { DB: db, SYNC_TOKEN: TOKEN, PRIMARY_OWNER: A, LEGACY_TOKEN_ENABLED: "true" };
  const res = await worker.fetch(req("/v1/me"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ownerId: A, email: null, epoch: (await readMeta(db)).epoch });
  assert.equal((await worker.fetch(req("/v1/me", { token: null }), env)).status, 401);
  assert.equal((await worker.fetch(req("/v1/me", { token: "x".repeat(64) }), env)).status, 401);
  assert.equal((await worker.fetch(req("/v1/me", { method: "POST", body: {} }), env)).status, 405);
});

test("senza PRIMARY_OWNER gli endpoint autenticati falliscono chiusi (500) e non scrivono", async () => {
  const db = await newDb();
  for (const PRIMARY_OWNER of [undefined, ""]) {
    const env = { DB: db, SYNC_TOKEN: TOKEN, PRIMARY_OWNER, LEGACY_TOKEN_ENABLED: "true" };
    const me = await worker.fetch(req("/v1/me"), env);
    assert.equal(me.status, 500);
    assert.deepEqual(await me.json(), { error: "configurazione mancante" });
    const s = await worker.fetch(req("/v1/sync", { method: "POST", body: { deviceId: "d", cursor: 0, changes: [ch("x", NOW)] } }), env);
    assert.equal(s.status, 500);
    // un token sbagliato resta 401 (non rivela la configurazione)
    assert.equal((await worker.fetch(req("/v1/me", { token: "x".repeat(64) }), env)).status, 401);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM records").first("n")), 0);
  assert.equal(await resolveOwner(req("/v1/me", { token: null }), { SYNC_TOKEN: TOKEN, PRIMARY_OWNER: A, LEGACY_TOKEN_ENABLED: "true" }), null);
  assert.equal(await resolveOwner(req("/v1/me"), { SYNC_TOKEN: TOKEN, PRIMARY_OWNER: A, LEGACY_TOKEN_ENABLED: "true" }), A);
});

test("migrazione 0002_owner.sql: 13 record dello schema vecchio → stessi record, owner, seq ed epoch", async () => {
  const OLD = `
    CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT, updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, device_id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (collection, id));
    CREATE INDEX idx_records_seq ON records (seq);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO meta (key, value) VALUES ('seq', 40), ('epoch', 123456789012345);`;
  const db = createD1();
  await db.exec(OLD);
  for (let i = 0; i < 13; i++) {
    await db.prepare("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(i % 2 ? "settings" : "setLog", `id-${i}`, i === 5 ? null : JSON.stringify({ n: i }), 1000 + i, i === 5 ? 1 : 0, "dev", 10 + i * 2).run();
  }
  const before = (await db.prepare("SELECT * FROM records ORDER BY seq").all()).results;
  const metaBefore = await readMeta(db);
  assert.ok(migration.includes("__PRIMARY_OWNER__"));
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b/i.test(migration.replace(/--.*$/gm, "")), "D1 non ammette BEGIN/COMMIT nel file");
  await db.exec("BEGIN");
  await db.exec(migration.replaceAll("__PRIMARY_OWNER__", A));
  await db.exec("COMMIT");
  const after = (await db.prepare("SELECT * FROM records ORDER BY seq").all()).results;
  assert.equal(after.length, 13);
  assert.ok(after.every((r) => r.owner === A));
  assert.deepEqual(after.map(({ owner, ...r }) => r), before);
  assert.deepEqual(await readMeta(db), metaBefore);
  // niente tabella d'appoggio, indice nuovo, e il vecchio cursore continua a funzionare
  const names = (await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name").all()).results.map((r) => r.name);
  assert.ok(!names.includes("records_new") && names.includes("idx_records_owner_seq") && !names.includes("idx_records_seq"));
  assert.deepEqual((await pullSince(db, A, 20, 100)).changes.map((r) => r.seq), [22, 24, 26, 28, 30, 32, 34]);
  assert.deepEqual((await pullSince(db, B, 0, 100)).changes, []);
  // lo schema nuovo è ancora idempotente sopra il DB migrato
  await db.exec(schema);
  assert.deepEqual(await readMeta(db), metaBefore);
  // l'LWW di un record migrato resta quello di prima
  const r = await applyChanges(db, A, "dev2", [{ collection: "setLog", id: "id-0", data: { n: "nuovo" }, updatedAt: 999 }], NOW);
  assert.equal(r.stale, 1);
});

test("la migrazione su un DB già nuovo fallisce senza modificare nulla", async () => {
  const db = await newDb();
  await applyChanges(db, A, "d", [ch("x", 1000)], NOW);
  await db.exec("BEGIN");
  await assert.rejects(db.exec(migration.replaceAll("__PRIMARY_OWNER__", A)));
  await db.exec("ROLLBACK");
  assert.equal((await pullSince(db, A, 0, 100)).changes.length, 1);
});

// --- server locale ---------------------------------------------------------------------------
function startLocalServer(args) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dev/local-server.mjs", import.meta.url)), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/^ready (http:\/\/127\.0\.0\.1:\d+)$/m);
      if (m) resolve({ child, url: m[1], out: () => out });
    });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", (c) => reject(new Error(`local-server terminato (${c}): ${err}`)));
    setTimeout(() => reject(new Error("local-server non pronto")), 8000);
  });
}

test("local-server: parte su porta libera, /v1/health, /v1/me, seed e pull via /v1/sync", async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/lfh-local-`);
  const seed = `${dir}/seed.json`;
  writeFileSync(seed, JSON.stringify([ch("s1", 1000, { v: 1 }), { collection: "dayState", id: "2026-11-03:rest", data: { rest: true }, updatedAt: 2000 }]));
  const secret = "token-di-prova-" + "z".repeat(40);
  const srv = await startLocalServer(["--port", "0", "--token", secret, "--seed", seed]);
  try {
    assert.ok(!srv.out().includes(secret), "il token non va stampato");
    assert.equal(srv.out().trim(), `ready ${srv.url}`);
    assert.deepEqual(await (await fetch(`${srv.url}/v1/health`)).json(), { ok: true, version: "1" });
    assert.equal((await fetch(`${srv.url}/v1/me`)).status, 401);
    const me = await (await fetch(`${srv.url}/v1/me`, { headers: { Authorization: `Bearer ${secret}` } })).json();
    assert.equal(typeof me.ownerId, "string");
    assert.ok(me.ownerId.length > 0 && Number.isSafeInteger(me.epoch));
    const res = await fetch(`${srv.url}/v1/sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "swift-test", cursor: 0, changes: [] }),
    });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(j.changes.map((r) => [r.collection, r.id, r.deviceId]).sort(), [["dayState", "2026-11-03:rest", "seed"], ["settings", "s1", "seed"]]);
    assert.equal(j.epoch, me.epoch);
  } finally {
    srv.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
