import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../migrate/load-parser.mjs";
import { workoutPlanFromText, dietPlanFromText } from "../migrate/plans.mjs";
import { recordsFromSheet, recordsFromBackup, mergeChanges } from "../migrate/records.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));
const sheet = fixture("sheet-sample.json");
const backup = fixture("pwa-backup-sample.json");

const OPTS = { name: "Piano", validFrom: "2026-01-01" };
const plans = {
  workout: workoutPlanFromText(readFileSync(join(REPO_ROOT, "scheda.txt"), "utf8"), { ...OPTS, id: "wp1" }),
  diet: dietPlanFromText(readFileSync(join(REPO_ROOT, "dieta.txt"), "utf8"), { ...OPTS, id: "dp1" }),
};
const NOW = new Date("2026-10-30T15:00:00").getTime();
const noon = (d) => new Date(`${d}T12:00:00`).getTime();

const fromSheet = () => recordsFromSheet(sheet, plans, { now: NOW });
const fromBackup = (stats) => recordsFromBackup(backup, plans, stats, { now: NOW });
const get = (list, collection, id) => list.find((c) => c.collection === collection && c.id === id);
const all = (list, collection) => list.filter((c) => c.collection === collection);

// ── foglio ──────────────────────────────────────────────────────────────────
test("foglio: check-in → dayState, stessa data vince l'ultima riga, riga vuota saltata", () => {
  const r = fromSheet();
  assert.deepEqual(get(r, "dayState", "2026-10-26").data, { date: "2026-10-26", checkIn: { sleep: 4, energy: 3, ailments: "" } });
  assert.deepEqual(get(r, "dayState", "2026-10-28").data.checkIn, { sleep: 5, energy: 4, ailments: "" });
  assert.equal(get(r, "dayState", "2026-10-29"), undefined);
  assert.equal(get(r, "dayState", "2026-10-28").updatedAt, noon("2026-10-28"));
});

test("foglio: peso → bodyWeight (id = data, kg numero)", () => {
  const r = fromSheet();
  assert.deepEqual(get(r, "bodyWeight", "2026-10-26").data, { date: "2026-10-26", kg: 78.4 });
  assert.equal(typeof get(r, "bodyWeight", "2026-10-30").data.kg, "number");
  assert.equal(get(r, "bodyWeight", "2026-10-26").updatedAt, noon("2026-10-26"));
});

test("foglio: settings.bodyWeight vale per oggi solo se manca la riga di oggi", () => {
  // oggi (2026-10-30) ha già una riga nel foglio → la setting non la sovrascrive
  assert.equal(get(fromSheet(), "bodyWeight", "2026-10-30").data.kg, 77.6);
  // un altro "oggi" senza riga → la setting crea il giorno
  const r = recordsFromSheet(sheet, plans, { now: new Date("2026-11-02T10:00:00").getTime() });
  const bw = get(r, "bodyWeight", "2026-11-02");
  assert.equal(bw.data.kg, 77.2);
  assert.equal(bw.updatedAt, new Date("2026-11-02T10:00:00").getTime());
});

test("foglio: serie → setLog con exerciseId del piano se il nome coincide, altrimenti name:<minuscolo>", () => {
  const r = fromSheet();
  const chest = plans.workout.data.days[0].exercises.find((e) => e.name === "Band chest press");
  const s0 = get(r, "setLog", `2026-10-26:${chest.id}:0`);
  assert.deepEqual(s0.data, {
    date: "2026-10-26", exerciseId: chest.id, exerciseName: "band chest press", planId: "wp1",
    setIndex: 0, weight: "20", reps: 12, done: true, substitutedWith: null,
  });
  assert.equal(get(r, "setLog", `2026-10-26:${chest.id}:1`).data.weight, "22.5");
  const curl = get(r, "setLog", "2026-10-28:name:dumbbell curl:0");
  assert.equal(curl.data.exerciseId, "name:dumbbell curl");
  assert.equal(curl.data.planId, null);
  assert.equal(curl.data.done, true);
  assert.equal(all(r, "setLog").length, 4);
});

test("foglio: settings → weightGoal/spesaFreq/excludedFoods, spesa, note esercizio", () => {
  const r = fromSheet();
  assert.deepEqual(get(r, "settings", "weightGoal").data, { value: 75 });
  assert.deepEqual(get(r, "settings", "spesaFreq").data, { value: 2 });
  assert.deepEqual(get(r, "settings", "excludedFoods").data.value,
    ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"]);
  assert.equal(get(r, "settings", "weightGoal").updatedAt, NOW);
  assert.deepEqual(all(r, "settings").map((c) => c.id).sort(), ["excludedFoods", "spesaFreq", "weightGoal"]);
  // spesaChecked2 ha la precedenza sul legacy spesaChecked
  assert.deepEqual(get(r, "shoppingCheck", "proteine-0").data, { checked: true });
  assert.deepEqual(get(r, "shoppingCheck", "carbo-1").data, { checked: false });
  assert.equal(get(r, "shoppingCheck", "legacy-0"), undefined);
  assert.deepEqual(get(r, "shoppingExtra", "1761000000000").data, { id: 1761000000000, name: "Caffè" });
  assert.deepEqual(get(r, "exerciseNote", "band chest press").data, { exerciseName: "band chest press", text: "Ancorare la banda in alto" });
  assert.equal(get(r, "exerciseNote", "band squat"), undefined);
});

test("foglio: ogni change ha collection ammessa, updatedAt numerico e nessun segreto", () => {
  const r = fromSheet();
  assert.ok(r.every((c) => Number.isFinite(c.updatedAt) && c.data && typeof c.id === "string"));
  assert.ok(!JSON.stringify(r).includes("schedaData"));
});

// ── backup PWA ──────────────────────────────────────────────────────────────
test("backup: checkIn_/hydration_/notes_ della stessa data → UN dayState", () => {
  const r = fromBackup();
  assert.deepEqual(get(r, "dayState", "2026-10-27").data, {
    date: "2026-10-27", checkIn: { sleep: 4, energy: 5, ailments: "" }, hydration: 6, notes: "Buona sessione",
  });
  assert.equal(get(r, "dayState", "2026-10-29").data.checkIn.ailments, "schiena");
  assert.equal(get(r, "dayState", "2026-10-27").updatedAt, noon("2026-10-27"));
  assert.equal(all(r, "dayState").length, 2);
});

test("backup: weightLog, bodyMeasures, exNotes, prMap", () => {
  const r = fromBackup();
  assert.deepEqual(get(r, "bodyWeight", "2026-10-29").data, { date: "2026-10-29", kg: 77.9 });
  assert.deepEqual(get(r, "bodyMeasure", "2026-10-27").data, { date: "2026-10-27", vita: 83.5, petto: 101.5, braccio: 35 });
  assert.deepEqual(get(r, "exerciseNote", "band lateral raise").data, { exerciseName: "band lateral raise", text: "Gomiti leggermente flessi" });
  assert.equal(get(r, "exerciseNote", "plank"), undefined);
  assert.deepEqual(get(r, "personalRecord", "band chest press").data, { exerciseName: "Band chest press", peso: 25, date: "2026-10-27" });
});

test("backup: spesa, coach, settings", () => {
  const r = fromBackup();
  assert.deepEqual(get(r, "shoppingCheck", "proteine-0").data, { checked: true });
  assert.deepEqual(get(r, "shoppingCheck", "verdura-2").data, { checked: false });
  assert.deepEqual(get(r, "shoppingExtra", "1761000000000").data, { id: 1761000000000, name: "Caffè" });
  assert.deepEqual(all(r, "coachMessage").map((c) => c.id), ["2026-10-27:0", "2026-10-27:1", "2026-10-27:2"]);
  assert.deepEqual(get(r, "coachMessage", "2026-10-27:1").data, {
    date: "2026-10-27", index: 1, role: "user", text: "Cosa mangio dopo l'allenamento?" });
  assert.deepEqual(all(r, "settings").map((c) => c.id).sort(), ["excludedFoods", "lang", "spesaFreq", "theme", "weightGoal"]);
  assert.deepEqual(get(r, "settings", "lang").data, { value: "it" });
  assert.deepEqual(get(r, "settings", "weightGoal").data, { value: 75 });
  assert.equal(get(r, "settings", "theme").updatedAt, NOW);
  assert.equal(get(r, "settings", "excludedFoods").data.value.length, 4);
});

test("backup: mealCheck ritrovato per nome+orario, gli altri scartati e contati", () => {
  const stats = {};
  const r = fromBackup(stats);
  const colazione = plans.diet.data.variants[0].meals.find((m) => m.name === "Colazione");
  const pranzo = plans.diet.data.variants[0].meals.find((m) => m.name === "Pranzo");
  assert.deepEqual(get(r, "mealCheck", `2026-10-27:${colazione.id}`).data, { date: "2026-10-27", mealId: colazione.id, done: true });
  assert.ok(get(r, "mealCheck", `2026-10-27:${pranzo.id}`));
  assert.equal(all(r, "mealCheck").length, 2); // Spuntino=false e Pasto fantasma non entrano
  assert.equal(stats.discarded.mealCheck, 1);
});

test("backup: supplementCheck via key degli integratori del piano; sconosciuti scartati", () => {
  const stats = {};
  const r = fromBackup(stats);
  const supps = plans.diet.data.variants[0].supplements;
  const vitac = supps.find((s) => s.key === "vitac"), omega1 = supps.find((s) => s.key === "omega1");
  assert.deepEqual(all(r, "supplementCheck").map((c) => c.id).sort(),
    [`2026-10-27:${omega1.id}`, `2026-10-27:${vitac.id}`].sort());
  assert.deepEqual(get(r, "supplementCheck", `2026-10-27:${vitac.id}`).data, { date: "2026-10-27", supplementId: vitac.id, done: true });
  assert.equal(stats.discarded.supplementCheck, 1);
});

test("backup: schedaProg_ → setLog per serie completata (id, nome, peso, sostituzione, scarti)", () => {
  const stats = {};
  const r = fromBackup(stats);
  const [pushup, chest] = plans.workout.data.days[0].exercises;
  assert.deepEqual(all(r, "setLog").map((c) => c.id).sort(), [
    `2026-10-27:${chest.id}:0`,
    `2026-10-27:${pushup.id}:0`,
    `2026-10-27:${pushup.id}:1`,
    "2026-10-27:name:esercizio di una vecchia scheda:0",
  ].sort());
  assert.deepEqual(get(r, "setLog", `2026-10-27:${chest.id}:0`).data, {
    date: "2026-10-27", exerciseId: chest.id, exerciseName: chest.name, planId: "wp1", setIndex: 0,
    weight: "20", reps: null, done: true, substitutedWith: "Chest press con manubri" });
  assert.equal(get(r, "setLog", `2026-10-27:${pushup.id}:1`).data.weight, "");
  const old = get(r, "setLog", "2026-10-27:name:esercizio di una vecchia scheda:0").data;
  assert.equal(old.planId, null);
  assert.equal(old.weight, "15");
  assert.equal(stats.discarded.setLog, 1); // "Giorno 2#9": fuori dal piano e senza names
});

test("backup: chiavi escluse mai migrate; non mappate in stats.ignoredKeys raggruppate per prefisso", () => {
  const stats = {};
  const r = fromBackup(stats);
  const json = JSON.stringify(r);
  for (const bad of ["gsk_FAKE", "groqApiKey", "errorLog", "sheetsQueue", "settingsPending", "settingsEdits", "schedaData", "onboardingDone"]) {
    assert.ok(!json.includes(bad), bad);
  }
  assert.equal(stats.ignoredKeys["gym_"], 1);
  assert.equal(stats.ignoredKeys["gymSaved_"], 1);
  assert.equal(stats.ignoredKeys["muscleSets_"], 1);
  assert.equal(stats.ignoredKeys["bodyWeight"], 1);
  assert.equal(stats.ignoredKeys["groqApiKey"], 1);
  assert.ok(!("checkIn_" in stats.ignoredKeys));
});

test("backup: valori già serializzati come stringa JSON vengono letti lo stesso", () => {
  const b = { _lfhBackup: 1, data: { exNotes: JSON.stringify({ plank: "ok" }), "hydration_2026-10-27": 4 } };
  const r = recordsFromBackup(b, plans, undefined, { now: NOW });
  assert.equal(get(r, "exerciseNote", "plank").data.text, "ok");
  assert.equal(get(r, "dayState", "2026-10-27").data.hydration, 4);
});

test("backup: senza stats né piani non esplode", () => {
  const r = recordsFromBackup(backup, {}, undefined, { now: NOW });
  assert.ok(get(r, "dayState", "2026-10-27"));
  assert.equal(all(r, "mealCheck").length, 0);
});

// ── mergeChanges ────────────────────────────────────────────────────────────
test("mergeChanges: updatedAt maggiore vince, merge superficiale dei campi, ordine stabile", () => {
  const a = [
    { collection: "dayState", id: "d1", data: { date: "d1", checkIn: { sleep: 1 }, hydration: 2 }, updatedAt: 100 },
    { collection: "settings", id: "lang", data: { value: "it" }, updatedAt: 5 },
  ];
  const b = [
    { collection: "dayState", id: "d1", data: { date: "d1", checkIn: { sleep: 9 }, notes: "n" }, updatedAt: 200 },
    { collection: "settings", id: "lang", data: { value: "en" }, updatedAt: 1 },
    { collection: "settings", id: "theme", data: { value: "dark" }, updatedAt: 1 },
  ];
  const m = mergeChanges(a, b);
  assert.deepEqual(m.map((c) => `${c.collection}/${c.id}`), ["dayState/d1", "settings/lang", "settings/theme"]);
  assert.deepEqual(m[0].data, { date: "d1", checkIn: { sleep: 9 }, hydration: 2, notes: "n" });
  assert.equal(m[0].updatedAt, 200);
  assert.deepEqual(m[1].data, { value: "it" });
  assert.equal(m[1].updatedAt, 5);
});

test("mergeChanges: a pari updatedAt vince l'ultimo argomento", () => {
  const x = { collection: "settings", id: "k", data: { value: 1 }, updatedAt: 7 };
  const y = { collection: "settings", id: "k", data: { value: 2 }, updatedAt: 7 };
  assert.deepEqual(mergeChanges([x], [y])[0].data, { value: 2 });
  assert.deepEqual(mergeChanges([y], [x])[0].data, { value: 1 });
});

test("mergeChanges: foglio + backup si fondono senza duplicare collection/id", () => {
  const m = mergeChanges(fromSheet(), fromBackup());
  const ids = m.map((c) => `${c.collection}/${c.id}`);
  assert.equal(new Set(ids).size, ids.length);
  // la PWA e il foglio hanno entrambi l'extra spesa: un solo record
  assert.equal(all(m, "shoppingExtra").length, 1);
});
