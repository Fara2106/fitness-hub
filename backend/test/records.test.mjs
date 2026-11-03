import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../migrate/load-parser.mjs";
import { workoutPlanFromText, dietPlanFromText } from "../migrate/plans.mjs";
import { recordsFromSheet, recordsFromBackup, mergeChanges, sanitizeChanges } from "../migrate/records.mjs";
import { validateSyncBody } from "../src/validate.mjs";

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

test("foglio: settings.bodyWeight → settings bodyWeight { value }, mai una pesata datata oggi (M1)", () => {
  assert.equal(get(fromSheet(), "bodyWeight", "2026-10-30").data.kg, 77.6);
  const now = new Date("2026-11-02T10:00:00").getTime();
  const r = recordsFromSheet(sheet, plans, { now });
  assert.equal(get(r, "bodyWeight", "2026-11-02"), undefined);
  assert.equal(all(r, "bodyWeight").length, 3); // solo le righe del foglio
  assert.deepEqual(get(r, "settings", "bodyWeight"), { collection: "settings", id: "bodyWeight", data: { value: 77.2 }, updatedAt: now });
  // non numerico o <= 0 → nessuna impostazione
  for (const bad of ["abc", "0", -3, ""]) {
    assert.equal(get(recordsFromSheet({ settings: { bodyWeight: bad } }, plans, { now }), "settings", "bodyWeight"), undefined, String(bad));
  }
});

test("foglio: serie → setLog con exerciseId del piano se il nome coincide, altrimenti name:<minuscolo>", () => {
  const r = fromSheet();
  const chest = plans.workout.data.days[0].exercises.find((e) => e.name === "Band chest press");
  const s0 = get(r, "setLog", `2026-10-26:${chest.id}:0`);
  assert.deepEqual(s0.data, {
    date: "2026-10-26", exerciseId: chest.id, exerciseName: "band chest press", planId: "wp1",
    setIndex: 0, weight: "20", reps: null, done: true, substitutedWith: null,
  });
  assert.equal(get(r, "setLog", `2026-10-26:${chest.id}:1`).data.weight, "22.5");
  const curl = get(r, "setLog", "2026-10-28:name:dumbbell curl:0");
  assert.equal(curl.data.exerciseId, "name:dumbbell curl");
  assert.equal(curl.data.planId, null);
  assert.equal(curl.data.done, true);
  assert.equal(all(r, "setLog").length, 4);
  // M2: peso 0 nel foglio = peso mancante → ""; reps sempre null (il foglio ha le ripetizioni del piano)
  const pushup = plans.workout.data.days[0].exercises[0];
  assert.equal(get(r, "setLog", `2026-10-26:${pushup.id}:0`).data.weight, "");
  assert.ok(all(r, "setLog").every((c) => c.data.reps === null));
});

test("foglio: peso \"0\"/0/\"0,0\" → weight \"\"; altri pesi come stringa (M2)", () => {
  const sh = { pesi: { "band squat": [
    { date: "2026-10-26", setN: 1, peso: "0", rip: 5 },
    { date: "2026-10-26", setN: 2, peso: 0, rip: 5 },
    { date: "2026-10-26", setN: 3, peso: "0,0", rip: 5 },
    { date: "2026-10-26", setN: 4, peso: 0.5, rip: 5 },
  ] } };
  const r = all(recordsFromSheet(sh, plans, { now: NOW }), "setLog");
  assert.deepEqual(r.map((c) => c.data.weight), ["", "", "", "0.5"]);
  assert.deepEqual(r.map((c) => c.data.reps), [null, null, null, null]);
});

test("foglio: settings → weightGoal/spesaFreq/excludedFoods, spesa, note esercizio", () => {
  const r = fromSheet();
  assert.deepEqual(get(r, "settings", "weightGoal").data, { value: 75 });
  assert.deepEqual(get(r, "settings", "spesaFreq").data, { value: 2 });
  assert.deepEqual(get(r, "settings", "excludedFoods").data.value,
    ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"]);
  assert.equal(get(r, "settings", "weightGoal").updatedAt, NOW);
  assert.deepEqual(all(r, "settings").map((c) => c.id).sort(), ["bodyWeight", "excludedFoods", "spesaFreq", "weightGoal"]);
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
    dietVariant: "riposo",
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
  assert.equal(stats.ignoredKeys["gym_"], undefined); // gym_/gymStart_/restDay_/activities ora migrati
  assert.equal(stats.ignoredKeys["gymStart_"], undefined);
  assert.equal(stats.ignoredKeys["restDay_"], undefined);
  assert.equal(stats.ignoredKeys["activities"], undefined);
  assert.equal(stats.ignoredKeys["gymSaved_"], 1); // usato solo come fonte dei nomi
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

// ── record non validi (fix round 1) ─────────────────────────────────────────
const passesValidate = (changes) => validateSyncBody({ deviceId: "d", cursor: 0, changes }).ok;

test("date non di calendario (mese 13, 02-30, prima del 1970): saltate e contate, output valido", () => {
  const sh = {
    checkIn: [{ date: "2026-13-45", sleep: 3, energy: 3 }, { date: "2026-02-30", sleep: 3, energy: 3 }],
    pesoCorporeo: [{ date: "1969-12-31", weight: 70 }, { date: "2026-99-99", weight: 70 }],
    pesi: { "band squat": [{ date: "2026-02-30", setN: 1, peso: 5, rip: 5 }] },
    settings: {},
  };
  const stats = {};
  const r = recordsFromSheet(sh, plans, { now: NOW, stats });
  assert.equal(stats.discarded.invalid, 5);
  assert.deepEqual(r.map((c) => c.collection), ["settings"]); // solo excludedFoods
  assert.ok(passesValidate(r));

  const b = { _lfhBackup: 1, data: {
    "checkIn_2026-13-45": { sleep: 1, energy: 1 },
    "dietaCheck_2026-02-30": { "13:00|Pranzo": true },
    weightLog: [{ date: "2026-02-30", weight: 70 }],
    bodyMeasures: [{ date: "1969-12-31", vita: 80 }],
  } };
  const bs = {};
  const br = recordsFromBackup(b, plans, bs, { now: NOW });
  assert.equal(bs.discarded.invalid, 4);
  assert.deepEqual(br.map((c) => c.collection), ["settings"]);
  assert.ok(passesValidate(br));
});

test("id troppo lunghi o chiave vuota: il converter non li emette e li conta", () => {
  const long = "x".repeat(200);
  const b = { _lfhBackup: 1, data: {
    spesaChecked: { "": true, [long]: true, ok: true },
    exNotes: { [long]: "nota" },
    prMap: { [long]: { peso: 10 } },
    spesaExtra: [{ id: long, name: "x" }],
    "schedaProg_2026-10-27": { completion: { "Giorno 9#9": [true] }, names: { "Giorno 9#9": long }, pesos: {}, substitutions: {} },
  } };
  const stats = {};
  const r = recordsFromBackup(b, plans, stats, { now: NOW });
  assert.ok(!get(r, "shoppingCheck", ""));
  assert.deepEqual(all(r, "shoppingCheck").map((c) => c.id), ["ok"]);
  assert.equal(all(r, "exerciseNote").length + all(r, "personalRecord").length + all(r, "shoppingExtra").length + all(r, "setLog").length, 0);
  assert.equal(stats.discarded.invalid, 5);
  assert.equal(stats.invalidSamples.length, 5);
  assert.ok(stats.invalidSamples.every((x) => x.length <= 80));
  assert.ok(passesValidate(r));

  // foglio: nome esercizio lunghissimo nel setLog
  const ss = {};
  const sr = recordsFromSheet({ pesi: { [long]: [{ date: "2026-10-26", setN: 1, peso: 5, rip: 5 }] } }, plans, { now: NOW, stats: ss });
  assert.equal(all(sr, "setLog").length, 0);
  assert.equal(ss.discarded.invalid, 1);
});

test("sanitizeChanges: data troppo grande, collezione/updatedAt/id errati scartati; output passa validateSyncBody", () => {
  const good = { collection: "settings", id: "lang", data: { value: "it" }, updatedAt: 5 };
  const bad = [
    { collection: "settings", id: "big", data: { value: "x".repeat(70000) }, updatedAt: 5 },
    { collection: "boh", id: "a", data: {}, updatedAt: 5 },
    { collection: "settings", id: "nan", data: {}, updatedAt: NaN },
    { collection: "settings", id: "neg", data: {}, updatedAt: -1 },
    { collection: "settings", id: "", data: {}, updatedAt: 5 },
    { collection: "settings", id: "nodata", data: null, updatedAt: 5 },
  ];
  const stats = {};
  const out = sanitizeChanges([good, ...bad, ...bad, ...bad], stats);
  assert.deepEqual(out, [good]);
  assert.equal(stats.discarded.invalid, 18);
  assert.equal(stats.invalidSamples.length, 10);
  assert.equal(stats.invalidSamples[0], "settings/big");
  assert.ok(passesValidate(out));
  assert.deepEqual(sanitizeChanges([good]), [good]); // senza stats
});

test("foglio: peso mancante nella riga serie → weight stringa vuota, non 'null'/'undefined'", () => {
  const sh = { pesi: { "band squat": [
    { date: "2026-10-26", setN: 1, peso: null, rip: 5 },
    { date: "2026-10-26", setN: 2, rip: 5 },
  ] } };
  const r = all(recordsFromSheet(sh, plans, { now: NOW }), "setLog");
  assert.deepEqual(r.map((c) => c.data.weight), ["", ""]);
});

test("fixture: backup e foglio completi passano validateSyncBody", () => {
  assert.ok(passesValidate(mergeChanges(fromSheet(), fromBackup())));
});

// ── fix wave finale ─────────────────────────────────────────────────────────
const variant = (key) => plans.diet.data.variants.find((v) => v.key === key);
const mealOf = (key, name) => variant(key).meals.find((m) => m.name === name);
const suppOf = (key, k) => variant(key).supplements.find((s) => s.key === k);
const bk = (data) => ({ _lfhBackup: 1, data });

test("I1: un giorno ore21 → tutte le spunte sotto la variante ore21, dietVariant nel dayState", () => {
  const stats = {};
  const r = recordsFromBackup(bk({
    "dietaCheck_2026-10-28": { "08:00|Colazione": true, "13:00|Pranzo": true, "16:30|Merenda": true, "19:30|Post-workout": true, "10:30|Spuntino": false },
    "integ_2026-10-28": { vitac: true, mgk: true, ps: false },
  }), plans, stats, { now: NOW });
  const ids = [...all(r, "mealCheck"), ...all(r, "supplementCheck")].map((c) => c.id);
  assert.equal(ids.length, 6);
  assert.ok(ids.every((id) => id.startsWith(`2026-10-28:${variant("ore21").id}/`)), ids.join());
  assert.ok(get(r, "mealCheck", `2026-10-28:${mealOf("ore21", "Post-workout").id}`));
  assert.ok(get(r, "supplementCheck", `2026-10-28:${suppOf("ore21", "mgk").id}`));
  assert.deepEqual(get(r, "dayState", "2026-10-28").data, { date: "2026-10-28", dietVariant: "ore21" });
  assert.equal(stats.discarded.mealCheck, 0);
  assert.equal(stats.discarded.supplementCheck, 0);
});

test("I1: Colazione+Pranzo+Post-workout+vitac+mgk sono anche in ore17/ore22 → spareggio per ordine del piano", () => {
  const r = recordsFromBackup(bk({
    "dietaCheck_2026-10-28": { "08:00|Colazione": true, "13:00|Pranzo": true, "19:30|Post-workout": true },
    "integ_2026-10-28": { vitac: true, mgk: true },
  }), plans, {}, { now: NOW });
  assert.equal(get(r, "dayState", "2026-10-28").data.dietVariant, "ore17"); // prima delle tre a pari merito
  const ids = [...all(r, "mealCheck"), ...all(r, "supplementCheck")].map((c) => c.id);
  assert.equal(ids.length, 5);
  assert.ok(ids.every((id) => id.startsWith(`2026-10-28:${variant("ore17").id}/`)));
});

test("I1: spunte che la variante scelta non ha → scartate e contate; nessuna variante utile → niente dietVariant", () => {
  const stats = {};
  const r = recordsFromBackup(bk({
    // riposo (Spuntino + Merenda 16:30 + Cena + vitac = 4) pari con ore21 (Spuntino + Merenda + Post-workout + vitac = 4)
    // → riposo per ordine; Post-workout (non in riposo) e boh (in nessuna) scartati
    "dietaCheck_2026-10-28": { "10:30|Spuntino": true, "16:30|Merenda": true, "20:00|Cena": true, "19:30|Post-workout": true },
    "integ_2026-10-28": { vitac: true, boh: true },
    // solo spunte inesistenti in tutte le varianti
    "dietaCheck_2026-10-29": { "04:00|Fantasma": true },
    "integ_2026-10-29": { boh: true },
    // solo spunte false: nessun record
    "dietaCheck_2026-10-30": { "08:00|Colazione": false },
  }), plans, stats, { now: NOW });
  assert.equal(get(r, "dayState", "2026-10-28").data.dietVariant, "riposo");
  assert.equal(all(r, "mealCheck").length, 3);
  assert.equal(all(r, "supplementCheck").length, 1);
  assert.equal(get(r, "dayState", "2026-10-29"), undefined);
  assert.equal(get(r, "dayState", "2026-10-30"), undefined);
  assert.equal(stats.discarded.mealCheck, 2); // Post-workout (28) + Fantasma (29)
  assert.equal(stats.discarded.supplementCheck, 2); // boh (28) + boh (29)
});

test("I1: la variante si sceglie per giorno; il dayState si fonde con check-in del backup e del foglio", () => {
  const b = bk({
    "checkIn_2026-10-28": { sleep: 2, energy: 2, ailments: "" },
    "dietaCheck_2026-10-28": { "16:30|Merenda": true, "19:30|Post-workout": true },
    "dietaCheck_2026-10-27": { "18:00|Merenda": true },
  });
  const r = mergeChanges(fromSheet(), recordsFromBackup(b, plans, {}, { now: NOW }));
  assert.equal(all(r, "dayState").filter((c) => c.id === "2026-10-28").length, 1);
  assert.equal(get(r, "dayState", "2026-10-28").data.dietVariant, "ore21");
  assert.deepEqual(get(r, "dayState", "2026-10-28").data.checkIn, { sleep: 2, energy: 2, ailments: "" });
  assert.equal(get(r, "dayState", "2026-10-27").data.dietVariant, "ore22");
});

const prog = (completion, extra = {}) => ({ completion, substitutions: {}, pesos: {}, ...extra });

test("I2: schedaProg_ senza names → nome da gymSaved_ della stessa data", () => {
  const [pushup, chest] = plans.workout.data.days[0].exercises;
  const stats = {};
  const r = recordsFromBackup(bk({
    "schedaProg_2026-10-20": prog({ "Giorno 1#0": [true], "Giorno 1#1": [true, true], "Giorno 1#2": [true] }),
    "gymSaved_2026-10-20": {
      "Giorno 1#0#0": "PUSH-UP (bodyweight) |0",          // stesso esercizio del piano (case/trim) → id del piano
      "Giorno 1#1#1": "Panca piana|60",                    // un altro esercizio → name:
      "Giorno 1#10#0": "Non c'entra|1",                    // prefisso simile ma exId diverso: ignorato
    },
    // gymSaved di un altro giorno non conta
    "gymSaved_2026-10-21": { "Giorno 1#2#0": "Altro|1" },
  }), plans, stats, { now: NOW });
  assert.equal(get(r, "setLog", `2026-10-20:${pushup.id}:0`).data.planId, "wp1");
  assert.deepEqual(all(r, "setLog").filter((c) => c.data.exerciseId === "name:panca piana").map((c) => c.data.setIndex), [0, 1]);
  assert.equal(get(r, "setLog", `2026-10-20:${chest.id}:0`), undefined);
  // Giorno 1#2 senza nome in nessuna fonte → mappato per posizione (nessun schedaData_at)
  const third = plans.workout.data.days[0].exercises[2];
  assert.equal(get(r, "setLog", `2026-10-20:${third.id}:0`).data.planId, "wp1");
  assert.deepEqual(stats.positional, { count: 1, from: "2026-10-20", to: "2026-10-20" });
  assert.equal(stats.discarded.setLogPositional, 0);
});

test("I2: names ha la precedenza su gymSaved_; il nome del sostituto in gymSaved_ non identifica l'esercizio", () => {
  const chest = plans.workout.data.days[0].exercises[1];
  const stats = {};
  const r = recordsFromBackup(bk({
    "schedaProg_2026-10-20": prog({ "Giorno 1#0": [true], "Giorno 1#1": [true] }, {
      names: { "Giorno 1#0": "band squat" },
      substitutions: { "Giorno 1#1": "Chest press con manubri" },
    }),
    "gymSaved_2026-10-20": { "Giorno 1#0#0": "Push-up (bodyweight)|0", "Giorno 1#1#0": "chest press con manubri|20" },
  }), plans, stats, { now: NOW });
  assert.ok(get(r, "setLog", "2026-10-20:name:band squat:0"));
  const s = get(r, "setLog", `2026-10-20:${chest.id}:0`); // sostituto → senza nome → per posizione
  assert.equal(s.data.substitutedWith, "Chest press con manubri");
  assert.equal(stats.positional.count, 1);
});

test("I2: senza nome e scheda reimportata dopo quel giorno → scartato (setLogPositional); prima → per posizione con intervallo", () => {
  const stats = {};
  const r = recordsFromBackup(bk({
    schedaData_at: "2026-10-15T18:00:00.000Z",
    "schedaProg_2026-10-01": prog({ "Giorno 1#0": [true, true, false] }),
    "schedaProg_2026-10-10": prog({ "Giorno 2#0": [true] }),
    "schedaProg_2026-10-20": prog({ "Giorno 1#0": [true] }),
    "schedaProg_2026-10-25": prog({ "Giorno 3#1": [true, true] }),
  }), plans, stats, { now: NOW });
  assert.equal(stats.discarded.setLogPositional, 3);
  assert.deepEqual(stats.positional, { count: 3, from: "2026-10-20", to: "2026-10-25" });
  assert.deepEqual(all(r, "setLog").map((c) => c.data.date).sort(), ["2026-10-20", "2026-10-25", "2026-10-25"]);
  assert.equal(stats.ignoredKeys.schedaData_at, 1); // letto, ma mai migrato

  // schedaData_at in ms, e illeggibile (= nessuna informazione → per posizione)
  const ms = {};
  recordsFromBackup(bk({ schedaData_at: new Date("2026-10-15T10:00:00").getTime(), "schedaProg_2026-10-10": prog({ "Giorno 1#0": [true] }) }), plans, ms, { now: NOW });
  assert.equal(ms.discarded.setLogPositional, 1);
  const junk = {};
  recordsFromBackup(bk({ schedaData_at: "boh", "schedaProg_2026-10-10": prog({ "Giorno 1#0": [true] }) }), plans, junk, { now: NOW });
  assert.equal(junk.positional.count, 1);
});

test("I3: activities → dayState.cardio per data locale dell'id (senza `when`); id non numerico scartato", () => {
  const t1 = new Date("2026-10-28T07:15:00").getTime(), t2 = new Date("2026-10-28T19:00:00").getTime();
  const t3 = new Date("2026-10-30T23:30:00").getTime();
  const stats = {};
  const r = recordsFromBackup(bk({
    "checkIn_2026-10-28": { sleep: 4, energy: 4, ailments: "" },
    activities: [
      { id: t3, type: "elliptical", min: 20, km: 0, note: "", when: "Oggi" },
      { id: t2, type: "walk", min: 40, km: 3.2, note: "sera", when: "Oggi" },
      { id: t1, type: "walk", min: 15, km: 1, note: "", when: "Ieri" },
      { id: "1761000000000", type: "walk", min: 5 },
      { id: 1.5, type: "walk", min: 5 },
      { type: "walk", min: 5 },
      null,
    ],
  }), plans, stats, { now: NOW });
  assert.deepEqual(get(r, "dayState", "2026-10-28").data, {
    date: "2026-10-28", checkIn: { sleep: 4, energy: 4, ailments: "" },
    cardio: [
      { id: t2, type: "walk", min: 40, km: 3.2, note: "sera" },
      { id: t1, type: "walk", min: 15, km: 1, note: "" },
    ],
  });
  assert.deepEqual(get(r, "dayState", "2026-10-30").data.cardio, [{ id: t3, type: "elliptical", min: 20, km: 0, note: "" }]);
  assert.equal(stats.discarded.cardio, 4);
  assert.equal(all(r, "dayState").length, 2);
});

test("I3: restDay_ vero → dayState.rest; falso → niente", () => {
  const stats = {};
  const r = recordsFromBackup(bk({ "restDay_2026-10-28": true, "restDay_2026-10-29": false, "restDay_2026-10-30": "true" }), plans, stats, { now: NOW });
  assert.deepEqual(get(r, "dayState", "2026-10-28").data, { date: "2026-10-28", rest: true });
  assert.equal(get(r, "dayState", "2026-10-29"), undefined);
  assert.equal(get(r, "dayState", "2026-10-30").data.rest, true); // stringa JSON "true" letta come true
  assert.equal(stats.ignoredKeys.restDay_, undefined);
});

test("I3: gym_ vero → workoutSession del giorno con più serie spuntate, startedAt da gymStart_", () => {
  const [d0, d1] = plans.workout.data.days;
  const start = new Date("2026-10-28T18:05:00").getTime();
  const stats = {};
  const r = recordsFromBackup(bk({
    "gym_2026-10-28": true,
    "gymStart_2026-10-28": start,
    "schedaProg_2026-10-28": prog({ "Giorno 1#0": [true, false], "Giorno 2#0": [true, true], "Giorno 2#1": [true] }),
    // pari merito (1 e 1) → giorno più basso; senza gymStart_ → startedAt null
    "gym_2026-10-29": true,
    "schedaProg_2026-10-29": prog({ "Giorno 2#0": [true], "Giorno 1#0": [true] }),
    // non deducibile: nessuna serie spuntata / giorno fuori dal piano / nessun schedaProg_
    "gym_2026-10-30": true, "schedaProg_2026-10-30": prog({ "Giorno 1#0": [false] }),
    "gym_2026-10-31": true, "schedaProg_2026-10-31": prog({ "Giorno 9#0": [true] }),
    "gym_2026-11-01": true,
    // gym_ falso → nessuna sessione; gymStart_ rimasto senza sessione chiusa → ignorato
    "gym_2026-11-02": false, "gymStart_2026-11-02": start,
  }), plans, stats, { now: NOW });
  assert.deepEqual(get(r, "workoutSession", `2026-10-28:${d1.id}`).data,
    { date: "2026-10-28", dayId: d1.id, dayName: d1.name, startedAt: start, done: true });
  assert.equal(get(r, "workoutSession", `2026-10-28:${d1.id}`).updatedAt, noon("2026-10-28"));
  assert.deepEqual(get(r, "workoutSession", `2026-10-29:${d0.id}`).data,
    { date: "2026-10-29", dayId: d0.id, dayName: d0.name, startedAt: null, done: true });
  assert.equal(all(r, "workoutSession").length, 2);
  assert.equal(stats.discarded.workoutSession, 3);
  assert.equal(stats.ignoredKeys.gymStart_, 1);
  assert.equal(stats.ignoredKeys.gym_, undefined);
  assert.ok(passesValidate(r));
});

test("fixture: sessione, riposo e cardio del backup di esempio", () => {
  const r = fromBackup();
  const d0 = plans.workout.data.days[0];
  assert.deepEqual(get(r, "workoutSession", `2026-10-27:${d0.id}`).data,
    { date: "2026-10-27", dayId: d0.id, dayName: d0.name, startedAt: 1793093400000, done: true });
  const d29 = get(r, "dayState", "2026-10-29").data;
  assert.equal(d29.rest, true);
  assert.deepEqual(d29.cardio, [{ id: 1793275200000, type: "walk", min: 30, km: 2.5, note: "parco" }]);
});
