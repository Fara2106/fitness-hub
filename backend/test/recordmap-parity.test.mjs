// Parità fra il ponte live della PWA (recordmap.jsx, window.RecordMap) e la migrazione
// (migrate/records.mjs → recordsFromBackup) sullo stesso backup: stessi id, stessi `data`.
// Ruling 1: si confrontano solo i record che la migrazione produce; il ponte può produrre in più
// spunte tolte (done:false / checked:false) e settings bodyWeight dallo storage.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { REPO_ROOT } from "../migrate/load-parser.mjs";
import { workoutPlanFromText, dietPlanFromText } from "../migrate/plans.mjs";
import { recordsFromBackup } from "../migrate/records.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const backup = JSON.parse(readFileSync(join(HERE, "fixtures", "pwa-backup-sample.json"), "utf8"));

function loadRecordMap() {
  const babel = createRequire(join(REPO_ROOT, "package.json"))("@babel/core");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  for (const f of ["parser.jsx", "planconv.jsx", "schedaState.jsx", "recordmap.jsx"]) {
    const code = babel.transformFileSync(join(REPO_ROOT, f), { presets: ["@babel/preset-react"] }).code;
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.window.RecordMap;
}

const OPTS = { name: "Piano", validFrom: "2026-01-01" };
const plans = {
  workout: workoutPlanFromText(readFileSync(join(REPO_ROOT, "scheda.txt"), "utf8"), { ...OPTS, id: "wp1" }),
  diet: dietPlanFromText(readFileSync(join(REPO_ROOT, "dieta.txt"), "utf8"), { ...OPTS, id: "dp1" }),
};
const ctx = {
  workout: { id: plans.workout.id, data: plans.workout.data },
  diet: { id: plans.diet.id, data: plans.diet.data },
  today: "2026-10-30",
};
const plain = (x) => JSON.parse(JSON.stringify(x)); // via i prototipi del contesto vm
const keyOf = (r) => `${r.collection}/${r.id}`;

// Tutti i gruppi toccati dalle chiavi del backup, costruiti come farebbe il motore.
function liveRecords(RM, data) {
  const get = (k, def) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : def);
  const groups = new Set();
  for (const k of Object.keys(data)) for (const g of RM.groupsForKey(k, data[k], ctx)) groups.add(g);
  const out = [];
  for (const g of groups) out.push(...plain(RM.buildGroup(g, get, ctx)).records);
  return out;
}

test("parità: ogni record della migrazione è prodotto dal ponte live con id e data identici", () => {
  const RM = loadRecordMap();
  const migrated = recordsFromBackup(backup, plans, {}, { now: 1 })
    .filter((c) => !(c.collection === "settings" && c.id === "excludedFoods")); // costante, non da una chiave locale
  const live = liveRecords(RM, backup.data);
  const byKey = new Map(live.map((r) => [keyOf(r), r]));
  assert.equal(byKey.size, live.length, "nessun record doppio fra gruppi");
  assert.ok(migrated.length >= 25, "il fixture copre tutte le famiglie");
  for (const c of migrated) {
    const r = byKey.get(keyOf(c));
    assert.ok(r, `manca ${keyOf(c)}`);
    assert.deepStrictEqual(r.data, c.data, keyOf(c));
  }
  // Famiglie coperte dal confronto (una per gruppo del ponte).
  const cols = new Set(migrated.map((c) => c.collection));
  for (const col of ["dayState", "mealCheck", "supplementCheck", "setLog", "workoutSession", "bodyWeight", "bodyMeasure",
    "exerciseNote", "personalRecord", "shoppingCheck", "shoppingExtra", "coachMessage", "settings"]) {
    assert.ok(cols.has(col), `il fixture produce ${col}`);
  }
});

test("parità: i record in più del ponte sono solo spunte tolte e settings bodyWeight (Ruling 1)", () => {
  const RM = loadRecordMap();
  const migrated = new Set(recordsFromBackup(backup, plans, {}, { now: 1 }).map(keyOf));
  const extra = liveRecords(RM, backup.data).filter((r) => !migrated.has(keyOf(r)));
  assert.ok(extra.length > 0);
  for (const r of extra) {
    const ok = (["mealCheck", "supplementCheck", "setLog"].includes(r.collection) && r.data.done === false)
      || (r.collection === "shoppingCheck" && r.data.checked === false)
      || (r.collection === "settings" && r.id === "bodyWeight" && r.data.value === backup.data.bodyWeight);
    assert.ok(ok, `record in più inatteso: ${keyOf(r)} ${JSON.stringify(r.data)}`);
  }
});
