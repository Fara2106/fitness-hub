import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1 } from "./d1-sqlite.mjs";
import { applyChanges, pullSince, MAX_FUTURE_MS } from "../src/store.mjs";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
async function newDb() {
  const db = createD1();
  await db.exec(schema);
  return db;
}
const NOW = 1_000_000;
const ch = (id, updatedAt, data = { v: id }, extra = {}) => ({ collection: "settings", id, data, updatedAt, ...extra });
const one = async (db, id) => (await pullSince(db, 0, 100)).changes.find((r) => r.id === id);

test("applica e rilegge", async () => {
  const db = await newDb();
  const r = await applyChanges(db, "dev1", [ch("a", 100), ch("b", 100)], NOW);
  assert.deepEqual(r, { applied: 2, stale: 0 });
  const p = await pullSince(db, 0, 100);
  assert.equal(p.changes.length, 2);
  assert.equal(p.cursor, Math.max(...p.changes.map((c) => c.seq)));
  assert.equal(p.more, false);
  assert.deepEqual(p.changes[0].data, { v: "a" });
  assert.equal(p.changes[0].deviceId, "dev1");
  assert.equal(p.changes[0].deleted, false);
});

test("LWW: vince updatedAt più recente", async () => {
  const db = await newDb();
  await applyChanges(db, "dev1", [ch("a", 1000, { v: "nuovo" })], NOW);
  const r = await applyChanges(db, "dev1", [ch("a", 900, { v: "vecchio" })], NOW);
  assert.equal(r.stale, 1);
  assert.equal(r.applied, 0);
  assert.deepEqual((await one(db, "a")).data, { v: "nuovo" });
});

test("pari merito: vince deviceId lessicograficamente maggiore", async () => {
  for (const order of [["devA", "devB"], ["devB", "devA"]]) {
    const db = await newDb();
    for (const d of order) await applyChanges(db, d, [ch("a", 500, { v: d })], NOW);
    const rec = await one(db, "a");
    assert.deepEqual(rec.data, { v: "devB" });
    assert.equal(rec.deviceId, "devB");
  }
});

test("retry idempotente", async () => {
  const db = await newDb();
  const c = ch("a", 500, { v: 1 });
  await applyChanges(db, "dev1", [c], NOW);
  const r = await applyChanges(db, "dev1", [c], NOW);
  assert.deepEqual(r, { applied: 0, stale: 1 });
  const p = await pullSince(db, 0, 100);
  assert.equal(p.changes.length, 1);
  assert.deepEqual(p.changes[0].data, { v: 1 });
});

test("futuro limitato", async () => {
  const db = await newDb();
  await applyChanges(db, "dev1", [ch("a", NOW + 3_600_000, { v: "futuro" })], NOW);
  assert.equal((await one(db, "a")).updatedAt, NOW + MAX_FUTURE_MS);
  const now2 = NOW + 120000;
  const r = await applyChanges(db, "dev1", [ch("a", NOW + 400000, { v: "dopo" })], now2);
  assert.equal(r.applied, 1);
  const rec = await one(db, "a");
  assert.deepEqual(rec.data, { v: "dopo" });
  assert.equal(rec.updatedAt, NOW + 400000);
});

test("tombstone vince su update più vecchio", async () => {
  const db = await newDb();
  await applyChanges(db, "dev1", [ch("a", 2000, null, { deleted: true })], NOW);
  const r = await applyChanges(db, "dev2", [ch("a", 1500, { v: "x" })], NOW);
  assert.equal(r.stale, 1);
  const rec = await one(db, "a");
  assert.equal(rec.deleted, true);
  assert.equal(rec.data, null);
});

test("stesso id due volte nello stesso batch", async () => {
  const db = await newDb();
  const r = await applyChanges(db, "dev1", [ch("a", 100, { v: 1 }), ch("a", 200, { v: 2 }), ch("a", 150, { v: 3 })], NOW);
  assert.deepEqual(r, { applied: 2, stale: 1 });
  assert.deepEqual((await one(db, "a")).data, { v: 2 });
});

test("pull paginato", async () => {
  const db = await newDb();
  const changes = Array.from({ length: 1250 }, (_, i) => ch(`id${i}`, 100));
  await applyChanges(db, "dev1", changes, NOW);
  const ids = new Set();
  const mores = [];
  let cursor = 0;
  for (let guard = 0; guard < 10; guard++) {
    const p = await pullSince(db, cursor, 500);
    p.changes.forEach((c) => ids.add(c.id));
    mores.push(p.more);
    cursor = p.cursor;
    if (!p.more) break;
  }
  assert.deepEqual(mores, [true, true, false]);
  assert.equal(ids.size, 1250);
});

test("pull incrementale", async () => {
  const db = await newDb();
  await applyChanges(db, "dev1", [ch("a", 100), ch("b", 100)], NOW);
  const p1 = await pullSince(db, 0, 100);
  assert.equal((await pullSince(db, p1.cursor, 100)).changes.length, 0);
  assert.equal((await pullSince(db, p1.cursor, 100)).cursor, p1.cursor);
  await applyChanges(db, "dev2", [ch("a", 200, { v: "nuovo" })], NOW);
  const p2 = await pullSince(db, p1.cursor, 100);
  assert.equal(p2.changes.length, 1);
  assert.equal(p2.changes[0].id, "a");
  assert.ok(p2.cursor > p1.cursor);
});
