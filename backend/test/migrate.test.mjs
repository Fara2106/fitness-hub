import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createD1 } from "./d1-sqlite.mjs";
import worker from "../src/worker.mjs";
import { REPO_ROOT } from "../migrate/load-parser.mjs";
import { runMigration, noonOf } from "../migrate/migrate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(HERE, "..", "schema.sql"), "utf8");
const fixture = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));
const TOKEN = "s3cr3t-".repeat(9);
const API = "https://api.test";
const SHEET = "https://legacy.test/exec";
const NOW = new Date("2026-11-03T12:00:00").getTime();

// Il fixture ha uno schedaData finto: nei test "normali" lo togliamo, così i piani vengono dai .txt del repo.
function sheetData(settingsOver = {}) {
  const s = fixture("sheet-sample.json");
  delete s.settings.schedaData;
  Object.assign(s.settings, settingsOver);
  return s;
}

// fetch finto: foglio legacy (solo GET, registra ogni richiesta) + API nuova su worker.mjs + D1 in memoria.
async function setup(sheet = sheetData()) {
  const DB = createD1();
  await DB.exec(schema);
  const env = { DB, SYNC_TOKEN: TOKEN };
  const sheetCalls = [];
  const apiCalls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.origin === "https://legacy.test") {
      sheetCalls.push({ method: init.method || "GET", url: u, headers: init.headers });
      const action = u.searchParams.get("action");
      const body = {
        getCheckIn: sheet.checkIn, getPesoCorporeo: sheet.pesoCorporeo, getPesi: sheet.pesi, getSettings: sheet.settings,
      }[action];
      if (body === undefined) return new Response(JSON.stringify({ success: false, error: "azione sconosciuta" }), { status: 200 });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    apiCalls.push({ method: init.method, url: u });
    return worker.fetch(new Request(url, init), env);
  };
  const logs = [];
  const run = (over = {}) => runMigration({
    fetch, api: API, token: TOKEN, sheetUrl: SHEET, now: NOW, repoRoot: REPO_ROOT, log: (s) => logs.push(s), ...over,
  });
  const rows = async () => (await DB.prepare("SELECT collection, id, data, updated_at, device_id FROM records ORDER BY collection, id").all()).results;
  return { DB, env, fetch, sheetCalls, apiCalls, logs, run, rows };
}

test("noonOf: mezzogiorno locale dello stesso giorno", () => {
  const ms = noonOf(new Date("2026-11-03T23:59:00").getTime());
  assert.equal(ms, new Date("2026-11-03T12:00:00").getTime());
});

test("dry-run: nessuna richiesta a /v1/sync, DB vuoto, conteggi coerenti", async () => {
  const t = await setup();
  const r = await t.run();
  assert.equal(t.apiCalls.length, 0);
  assert.equal((await t.rows()).length, 0);
  assert.equal(r.push, null);
  assert.equal(r.verify, null);
  assert.ok(r.total > 0);
  const live = Object.values(r.counts).reduce((n, c) => n + c.live, 0);
  const tomb = Object.values(r.counts).reduce((n, c) => n + c.tombstones, 0);
  assert.equal(live + tomb, r.total);
  assert.equal(r.counts.workoutPlan.live, 1);
  assert.equal(r.counts.dietPlan.live, 1);
  assert.equal(r.counts.bodyWeight.live, 4); // 3 righe + peso di oggi dalle settings
  assert.equal(r.counts.dayState.live, 2);
  assert.deepEqual(r.planSource, { workout: "scheda.txt del repo", diet: "dieta.txt del repo" });
  assert.ok(r.plans.workout.days > 0 && r.plans.workout.exercises > 0);
  assert.ok(r.plans.diet.variants > 0 && r.plans.diet.meals > 0);
  const text = t.logs.join("\n");
  assert.match(text, /Scartati:/);
  assert.match(text, /workoutPlan: 1 vivi/);
});

test("dry-run: id e nomi dei piani dal mese di now", async () => {
  const t = await setup();
  const r = await t.run();
  const w = r.changes.find((c) => c.collection === "workoutPlan");
  const d = r.changes.find((c) => c.collection === "dietPlan");
  assert.equal(w.id, "workout-2026-11");
  assert.equal(d.id, "diet-2026-11");
  assert.equal(w.data.name, "Scheda novembre 2026");
  assert.equal(d.data.name, "Dieta novembre 2026");
  assert.equal(w.data.validFrom, "2026-11-03");
  assert.equal(w.updatedAt, NOW);
});

test("--push scrive N record (N = dry-run), anche oltre un lotto da 500", async () => {
  const t = await setup();
  const dry = await t.run();
  const r = await t.run({ push: true });
  assert.equal(r.push.sent, dry.total);
  assert.equal(r.push.applied, dry.total);
  assert.equal(r.push.stale, 0);
  assert.equal((await t.rows()).length, dry.total);
  assert.ok(t.apiCalls.every((c) => c.method === "POST" && c.url.pathname === "/v1/sync"));
});

// 900 giorni distinti di peso (date reali, una per giorno) → oltre un lotto da 500.
const manyWeights = (n) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), weight: 70,
}));

test("--push in più lotti da 500", async () => {
  const sheet = sheetData();
  sheet.pesoCorporeo = manyWeights(1200);
  const t = await setup(sheet);
  const r = await t.run({ push: true });
  assert.ok(r.total > 1000, `serve più di un lotto (${r.total})`);
  assert.equal(r.push.applied, r.total);
  assert.equal(t.apiCalls.length, Math.ceil(r.total / 500));
  assert.equal((await t.rows()).length, r.total);
});

test("secondo --push (stesso now): record e data invariati, applied 0", async () => {
  const t = await setup();
  const first = await t.run({ push: true });
  const before = await t.rows();
  const second = await t.run({ push: true });
  const after = await t.rows();
  assert.equal(second.push.applied, 0);
  assert.equal(second.push.stale, first.total);
  assert.equal(after.length, before.length);
  assert.deepEqual(after, before);
});

test("il foglio con schedaData diverso da scheda.txt → il piano migrato riflette il foglio", async () => {
  const text = readFileSync(join(REPO_ROOT, "scheda.txt"), "utf8");
  const firstDay = (await setup().then((t) => t.run())).changes.find((c) => c.collection === "workoutPlan").data.days[0].name;
  const edited = text.split(firstDay).join("GIORNO MODIFICATO");
  assert.notEqual(edited, text);
  const t = await setup(sheetData({ schedaData: edited }));
  const r = await t.run();
  assert.equal(r.planSource.workout, "foglio");
  assert.equal(r.planSource.diet, "dieta.txt del repo");
  const w = r.changes.find((c) => c.collection === "workoutPlan");
  assert.ok(w.data.days.some((d) => d.name.includes("GIORNO MODIFICATO")));
  assert.ok(!w.data.days.some((d) => d.name === firstDay));
});

test("schedaData del foglio non leggibile → ripiega sul repo e lo dice", async () => {
  const t = await setup(sheetData({ schedaData: "# PUSH - Giorno 1 ..." }));
  const r = await t.run();
  assert.equal(r.planSource.workout, "scheda.txt del repo");
  assert.match(t.logs.join("\n"), /scheda del foglio/);
});

test("--verify dopo il push: tutto ✔; con un record in meno nel DB → ✘ e ok=false", async () => {
  const t = await setup();
  const r = await t.run({ push: true, verify: true });
  assert.equal(r.verify.ok, true);
  assert.equal(r.ok, true);
  assert.ok(r.verify.rows.every((x) => x.ok));
  assert.match(t.logs.join("\n"), /✔ workoutPlan/);

  await t.DB.prepare("DELETE FROM records WHERE collection = 'bodyWeight' AND id = '2026-10-26'").run();
  const bad = await t.run({ verify: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.verify.rows.find((x) => x.collection === "bodyWeight").ok, false);
  assert.equal(bad.push, null);
  assert.match(t.logs.join("\n"), /✘ bodyWeight/);
});

test("--verify pagina il pull (più di 500 record)", async () => {
  const sheet = sheetData();
  sheet.pesoCorporeo = manyWeights(900);
  const t = await setup(sheet);
  const r = await t.run({ push: true, verify: true });
  assert.ok(r.total > 900);
  assert.equal(r.verify.ok, true);
});

test("il token non compare in nessun log, nemmeno in caso d'errore", async () => {
  const t = await setup();
  await t.run({ push: true, verify: true });
  assert.ok(!t.logs.join("\n").includes(TOKEN));
  assert.ok(!JSON.stringify(t.sheetCalls).includes(TOKEN)); // il foglio non vede mai il token

  const t2 = await setup();
  await assert.rejects(t2.run({ push: true, token: "token-sbagliato".repeat(5) }), (e) => {
    assert.match(e.message, /HTTP 401/);
    assert.ok(!e.message.includes("token-sbagliato"));
    return true;
  });
  assert.ok(!t2.logs.join("\n").includes("token-sbagliato"));
  assert.equal((await t2.rows()).length, 0);

  // se il server rimandasse indietro il token nel messaggio, viene oscurato
  const leaky = async () => new Response(JSON.stringify({ error: `boom ${TOKEN}` }), { status: 500 });
  const t3 = await setup();
  await assert.rejects(
    t3.run({ push: true, fetch: async (u, i) => (String(u).startsWith(SHEET) ? t3.fetch(u, i) : leaky()) }),
    (e) => { assert.ok(!e.message.includes(TOKEN)); assert.match(e.message, /HTTP 500/); return true; },
  );
});

test("nessuna richiesta non-GET verso il foglio, con Origin e _cb", async () => {
  const t = await setup();
  await t.run({ push: true });
  assert.deepEqual([...new Set(t.sheetCalls.map((c) => c.method))], ["GET"]);
  assert.deepEqual(t.sheetCalls.map((c) => c.url.searchParams.get("action")).sort(), ["getCheckIn", "getPesi", "getPesoCorporeo", "getSettings"]);
  for (const c of t.sheetCalls) {
    assert.ok(c.url.searchParams.get("_cb"));
    assert.equal(c.headers.Origin, "https://fara2106.github.io");
  }
});

test("foglio con success:false → errore, niente scritto", async () => {
  const t = await setup();
  const fetch = async (u, i) => (String(u).includes("action=getPesi")
    ? new Response(JSON.stringify({ success: false, error: "Non autorizzato" }), { status: 200 })
    : t.fetch(u, i));
  await assert.rejects(t.run({ fetch, push: true }), /getPesi.*Non autorizzato/);
  assert.equal((await t.rows()).length, 0);
});

test("backup non valido → errore, nessuna richiesta, niente scritto", async () => {
  const t = await setup();
  for (const bad of ["non json {", JSON.stringify({ data: {} }), JSON.stringify({ _lfhBackup: 2, data: {} }), JSON.stringify({ _lfhBackup: 1, data: [] }), "[]"]) {
    await assert.rejects(t.run({ backupJson: bad, push: true }), /backup non valido/);
  }
  assert.equal(t.sheetCalls.length, 0);
  assert.equal(t.apiCalls.length, 0);
  assert.equal((await t.rows()).length, 0);
});

test("backup valido: i suoi record entrano nel conteggio", async () => {
  const t = await setup();
  const without = await t.run();
  const withBackup = await t.run({ backupJson: JSON.stringify(fixture("pwa-backup-sample.json")) });
  assert.ok(withBackup.total > without.total);
    const pushed = await t.run({ backupJson: fixture("pwa-backup-sample.json"), push: true, verify: true });
  assert.equal(pushed.verify.ok, true);
});

test("--push/--verify senza api o token → errore chiaro", async () => {
  const t = await setup();
  await assert.rejects(t.run({ push: true, api: undefined }), /--api e --token-file/);
  await assert.rejects(t.run({ verify: true, token: undefined }), /--api e --token-file/);
  assert.equal(t.sheetCalls.length, 0);
});
