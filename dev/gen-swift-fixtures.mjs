// Genera le fixture di parità per FitnessCore (app Swift, fase 3 / Task 4 e 7).
//   node dev/gen-swift-fixtures.mjs <outDir>
// Carica in node:vm i sorgenti della PWA (come test/run.mjs e backend/migrate/load-parser.mjs) e scrive:
//   plans.json            record workoutPlan/dietPlan da scheda.txt / dieta.txt via PlanConv
//   records-sample.json   record di tutte le collezioni da backend/test/fixtures/pwa-backup-sample.json via RecordMap
//   insights-cases.json   [{ fn, args, result }] per le funzioni di insights.jsx
//   progress-cases.json   [{ fn, args, result }] per progress.jsx
//   shopping-fallback.json  la lista della spesa di riserva (window.SPESA_CATEGORIES di spesa.jsx) nella forma
//                         che la PWA mostra quando il piano non ha `shopping` (SpesaLogic.shoppingFromCategories)
// Solo sviluppo: non fa parte del bundle dell'app e non viene letto a runtime.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2];
if (!outDir) { console.error("uso: node dev/gen-swift-fixtures.mjs <outDir>"); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const babel = createRequire(join(ROOT, "package.json"))("@babel/core");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
for (const f of ["parser.jsx", "planconv.jsx", "schedaState.jsx", "recordmap.jsx", "insights.jsx", "progress.jsx", "screens/spesa.jsx"]) {
  const code = babel.transformFileSync(join(ROOT, f), { presets: [["@babel/preset-react", { runtime: "classic", development: false }]], cwd: ROOT, configFile: false, babelrc: false }).code;
  vm.runInContext(code, sandbox, { filename: f });
}
const W = sandbox.window;
const plain = (x) => JSON.parse(JSON.stringify(x)); // via i prototipi del contesto vm; undefined sparisce
const write = (name, value) => {
  const file = join(outDir, name);
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  console.log(`${name}: ${readFileSync(file).length} byte`);
};

// Timestamp fissi: le fixture devono essere deterministiche (nessun Date.now()).
const UPDATED_AT = 1793000000000;
const asRecord = (r, i = 0) => ({ collection: r.collection, id: r.id, data: r.data, updatedAt: UPDATED_AT + i, deleted: false });

// ── plans.json ───────────────────────────────────────────────────────────────
const PLAN_OPTS = { name: "Piano 2026-11", validFrom: "2026-11-01" };
const workout = plain(W.PlanConv.workoutPlanFromText(readFileSync(join(ROOT, "scheda.txt"), "utf8"), { ...PLAN_OPTS, id: "workout-2026-11" }));
const diet = plain(W.PlanConv.dietPlanFromText(readFileSync(join(ROOT, "dieta.txt"), "utf8"), { ...PLAN_OPTS, id: "diet-2026-11" }));
write("plans.json", [asRecord(workout, 0), asRecord(diet, 1)]);

// ── records-sample.json ──────────────────────────────────────────────────────
const backup = JSON.parse(readFileSync(join(ROOT, "backend/test/fixtures/pwa-backup-sample.json"), "utf8"));
const RM = W.RecordMap;
const ctx = {
  workout: { id: workout.id, data: workout.data },
  diet: { id: diet.id, data: diet.data },
  today: "2026-10-30",
};
const get = (k, def) => (Object.prototype.hasOwnProperty.call(backup.data, k) ? backup.data[k] : def);
const groups = new Set();
for (const k of Object.keys(backup.data)) for (const g of RM.groupsForKey(k, backup.data[k], ctx)) groups.add(g);
const records = [];
for (const g of [...groups].sort()) records.push(...plain(RM.buildGroup(g, get, ctx)).records);
// Costante lato PWA (non viene da una chiave locale): lista alimenti esclusi del Coach.
records.push({ collection: "settings", id: "excludedFoods", data: { value: ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"] } });
const sample = records.map((r, i) => asRecord(r, i));
// Un tombstone vero (eliminazione): data null, deleted true.
sample.push({ collection: "mealCheck", id: "2026-10-27:tombstone", data: null, updatedAt: UPDATED_AT + sample.length, deleted: true });
write("records-sample.json", sample);

// ── insights-cases.json ──────────────────────────────────────────────────────
// Ogni caso: { fn, args, result } (+ "name" descrittivo, ignorabile dal consumatore).
const exId = (d, i) => `${d}#${i}`; // = window.exId(dayKey, pos) di schedaState.jsx
const cases = [];
function run(ns, fn, args, name, argsOverride) {
  let result = ns[fn](...args);
  result = plain(result);
  cases.push({ fn, name, args: plain(argsOverride || args), result: result === undefined ? null : result });
}
const I = (fn, args, name, ov) => run(W.Insights, fn, args, name, ov);

// e1rm
I("e1rm", [80, 8], "kg numerico, 8 rip");
I("e1rm", ["82,5", 5], "kg con virgola");
I("e1rm", ["100", 1], "1 rip = peso");
I("e1rm", [60, 0], "0 rip");
I("e1rm", [60, null], "rip null");
I("e1rm", ["rosso", 10], "elastico: testo");
I("e1rm", [null, 10], "peso null");
I("e1rm", ["", 10], "peso vuoto");
I("e1rm", [0, 10], "peso 0");
I("e1rm", ["20.5", "12"], "stringhe");
// setLabel (esposta da Insights)
I("setLabel", [{ peso: "80", rip: 8 }], "peso e rip");
I("setLabel", [{ peso: "rosso", rip: null }], "elastico, rip null");
I("setLabel", [{ peso: "", rip: 8 }], "peso vuoto");
I("setLabel", [{ peso: null, rip: 0 }], "peso null, rip 0");
I("setLabel", [null], "serie null");
// exerciseSessions
const pesi = {
  "band chest press": [
    { date: "2026-10-20", setN: 1, peso: "20", rip: 10 }, { date: "2026-10-20", setN: 2, peso: "20", rip: 9 },
    { date: "2026-10-27", setN: 1, peso: "22,5", rip: 8 }, { date: "2026-10-27", setN: 2, peso: "22,5", rip: null },
    { date: "2026-11-01", setN: 1, peso: "rosso", rip: 12 }, { date: "2026-11-01", setN: 2, peso: "", rip: 12 },
    { date: "2026-10-13", setN: 1, peso: "17.5", rip: 10 },
  ],
  plank: [{ date: "2026-10-27", setN: 1, peso: "", rip: 0 }],
};
I("exerciseSessions", [pesi, "Band chest press", 3], "tre sessioni, maiuscole, virgola, elastico, rip null");
I("exerciseSessions", [pesi, "band chest press", 1], "limite 1");
I("exerciseSessions", [pesi, "  BAND CHEST PRESS  "], "limite di default (3), spazi");
I("exerciseSessions", [pesi, "plank", 3], "solo peso vuoto");
I("exerciseSessions", [pesi, "sconosciuto", 3], "esercizio senza storico");
I("exerciseSessions", [{}, "x", 3], "mappa vuota");
I("exerciseSessions", [null, null, 3], "tutto null");
I("exerciseSessions", [{ a: [null, { date: null, peso: "5", rip: 5 }, { date: "2026-10-01", peso: "5", rip: 5 }] }, "a", 3], "righe invalide ignorate");
// sessionSummary
const ex2 = [
  { name: "Band chest press", sets: [{ peso: "20", rip: 10 }, { peso: "20", rip: 10 }, { peso: "20", rip: 10 }] },
  { name: "Plank", sets: [{ peso: "", rip: 0 }, { peso: "", rip: 0 }] },
  { name: "Band squat", sets: [{ peso: "elastico rosso", rip: 12 }, { peso: "25,5", rip: 12 }] },
];
const sumArgs = {
  exercises: ex2, dayKey: "Giorno 1",
  completion: { "Giorno 1#0": [true, true, false], "Giorno 1#1": [false, false], "Giorno 1#2": [true, true] },
  substitutions: { "Giorno 1#2": "Goblet squat" },
  pesos: { "Giorno 1#0": ["22,5", "", "22.5"], "Giorno 1#2": ["", "30"] },
  startTs: 1793093400000, endTs: 1793093400000 + 47 * 60000 + 20000,
  pesiMap: { ...pesi, "goblet squat": [{ date: "2026-10-27", setN: 1, peso: "24", rip: 10 }] },
};
const noFn = (a) => { const { exIdFn, ...rest } = a; return rest; };
I("sessionSummary", [{ ...sumArgs, exIdFn: exId }], "sessione completa; exIdFn = `${dayKey}#${pos}` omesso dagli args", [noFn(sumArgs)]);
const sum2 = { ...sumArgs, startTs: null, endTs: null, pesiMap: {} };
I("sessionSummary", [{ ...sum2, exIdFn: exId }], "senza durata e senza storico", [noFn(sum2)]);
const sum3 = { exercises: [], dayKey: "Giorno 1", completion: {}, substitutions: {}, pesos: {}, startTs: 5, endTs: 4, pesiMap: null };
I("sessionSummary", [{ ...sum3, exIdFn: exId }], "nessun esercizio, fine prima dell'inizio", [noFn(sum3)]);
const sum4 = { ...sumArgs, startTs: 1000, endTs: 1000 + 20000, completion: { "Giorno 1#0": [true] }, substitutions: null, pesos: null };
I("sessionSummary", [{ ...sum4, exIdFn: exId }], "durata < 1 min (arrotondata a 1), pesos null", [noFn(sum4)]);
// weeklyReport
const wrArgs = {
  today: "2026-11-03",
  weightLog: [{ date: "2026-10-22", weight: 78.6 }, { date: "2026-10-25", weight: 78.4 }, { date: "2026-10-29", weight: 77.9 }, { date: "2026-11-02", weight: 77.5 }, { date: "2026-11-03", weight: 77.7 }],
  gymFlags: { "2026-10-28": true, "2026-10-30": true, "2026-11-02": true, "2026-10-20": true },
  muscleHist: [{ date: "2026-10-28", muscleSets: { Petto: 6, Schiena: 5 } }, { date: "2026-11-02", muscleSets: { Petto: 4, Gambe: 9 } }, { date: "2026-10-01", muscleSets: { Petto: 30 } }],
  prMap: { "Band squat": { peso: 30, date: "2026-11-02" }, "Band chest press": { peso: 25, date: "2026-10-27" }, "Plank": { peso: 5, date: "2026-10-30" } },
  checkinDates: ["2026-10-28", "2026-10-29", "2026-11-03", "2026-10-01"], plannedSessions: 3,
};
I("weeklyReport", [wrArgs], "settimana piena");
I("weeklyReport", [{ today: "2026-11-03" }], "tutti i campi mancanti");
I("weeklyReport", [{ today: "2026-03-30", weightLog: [{ date: "2026-03-29", weight: 70 }], gymFlags: {}, muscleHist: [], prMap: {}, checkinDates: [] }], "attraversa il cambio ora legale (29 marzo)");
I("weeklyReport", [{ today: "2026-11-03", weightLog: [{ date: "2026-11-01", weight: 80 }], gymFlags: null, muscleHist: [null, { date: "2026-11-01" }], prMap: { x: null, y: { peso: 10, date: "2026-11-01" } }, plannedSessions: 0 }], "voci nulle; planned 0 → 3");
// deload
I("deloadAdvice", [[{ sleep: 4, energy: 4, ailments: "" }]], "tutto bene");
I("deloadAdvice", [[{ sleep: 4, energy: 4, ailments: " schiena " }]], "fastidi oggi");
I("deloadAdvice", [[{ sleep: 2, energy: 3, ailments: "" }]], "media 2.5");
I("deloadAdvice", [[{ sleep: 3, energy: 3, ailments: "" }, { sleep: 3, energy: 2, ailments: "" }]], "oggi e ieri ≤ 3");
I("deloadAdvice", [[{ sleep: 3, energy: 3, ailments: "" }, { sleep: 5, energy: 5, ailments: "" }]], "ieri bene");
I("deloadAdvice", [[{ sleep: 0, energy: 0, ailments: "" }]], "check-in vuoto (zeri)");
I("deloadAdvice", [[null, { sleep: 1, energy: 1 }]], "oggi null: filtrato, ieri diventa oggi");
I("deloadAdvice", [[]], "lista vuota");
I("deloadAdvice", [null], "null");
I("deloadWeight", ["80"], "80 → 72.5");
I("deloadWeight", ["82,5"], "virgola");
I("deloadWeight", ["15"], "sotto i 20 kg: passo 1");
I("deloadWeight", ["2"], "2 kg: arrotondamento = peso → null");
I("deloadWeight", ["rosso"], "elastico");
I("deloadWeight", [null], "null");
I("deloadWeight", [100], "numero");
// movingAverage
const wl = [{ date: "2026-10-25", weight: 78.6 }, { date: "2026-10-27", weight: 78.2 }, { date: "2026-10-29", weight: 77.9 }, { date: "2026-11-03", weight: 77.5 }, { date: "2026-11-04", weight: 0 }, { date: null, weight: 80 }];
I("movingAverage", [wl, 7], "finestra 7, voci invalide scartate");
I("movingAverage", [wl], "finestra di default");
I("movingAverage", [wl, 2], "finestra 2");
I("movingAverage", [[], 7], "vuoto");
I("movingAverage", [null, 7], "null");
// weightProjection
const trend = [{ date: "2026-10-13", weight: 80 }, { date: "2026-10-20", weight: 79.3 }, { date: "2026-10-27", weight: 78.6 }, { date: "2026-11-03", weight: 77.9 }];
I("weightProjection", [trend, 75, 21], "in calo verso 75");
I("weightProjection", [trend, "75,5", 21], "target con virgola (stringa)");
I("weightProjection", [trend, 85, 21], "target nella direzione sbagliata");
I("weightProjection", [trend, 78, 21], "target raggiunto (±0.3)");
I("weightProjection", [trend, null, 21], "senza target");
I("weightProjection", [trend, 60, 21], "oltre 730 giorni: niente eta");
I("weightProjection", [trend, 75], "days di default");
I("weightProjection", [[{ date: "2026-11-03", weight: 77.9 }], 75, 21], "un solo punto → null");
I("weightProjection", [[{ date: "2026-10-01", weight: 80 }, { date: "2026-11-03", weight: 77 }], 75, 21], "un solo punto nella finestra → null");
I("weightProjection", [[{ date: "2026-11-02", weight: 77 }, { date: "2026-11-03", weight: 77 }], 75, 21], "pendenza zero");
I("weightProjection", [[], 75, 21], "vuoto");
// mealAdherence
I("mealAdherence", [{ a: true, b: true, c: false }, 5], "2 di 5");
I("mealAdherence", [{ a: true, b: true, c: true }, 2], "più spunte che pasti: limitato al totale");
I("mealAdherence", [{}, 0], "totale 0");
I("mealAdherence", [null, null], "null");
I("mealAdherence", [{ a: true }, "4"], "totale stringa");
// foodSwaps
I("foodSwaps", ["Riso basmati", "80g"], "qty separata: riso");
I("foodSwaps", ["Pollo", "100–150g"], "qty con intervallo: primo numero");
I("foodSwaps", ["Pollo", "100-150 g"], "trattino ASCII e spazio");
I("foodSwaps", ["Carboidrato (scegli 1): 80g pasta farro | 80g riso rosso | 200g patate", ""], "grammi nel testo, primo segmento riconosciuto");
I("foodSwaps", ["1 cucchiaio olio EVO", "10g"], "grassi");
I("foodSwaps", ["Yogurt greco", "150g"], "alimento non riconosciuto");
I("foodSwaps", ["Riso", "q.b."], "senza grammi");
I("foodSwaps", ["Uova", "2 pz"], "pezzi, non grammi");
I("foodSwaps", [null, null], "null");
I("foodSwaps", ["Olio", "1g"], "porzione minuscola: scambi < 5 g scartati");
I("foodSwaps", ["30g noci + 20g mandorle", ""], "due segmenti, vince il primo");
write("insights-cases.json", cases);

// ── progress-cases.json ──────────────────────────────────────────────────────
cases.length = 0;
const P = (fn, args, name) => run(W.WorkoutProgress, fn, args, name);
for (const [v, n] of [["80", "intero"], ["82,5", "virgola"], [" 12.5 ", "spazi"], ["0", "zero"], ["-5", "negativo"], ["rosso", "colore elastico"], ["elastico rosso", "elastico con testo"],
  ["", "vuoto"], [null, "null"], [undefined, "undefined"], [20, "numero"], ["1e3", "notazione scientifica"], ["12,5kg", "unità"], ["1,5,5", "due virgole"], [".5", "senza intero"]]) {
  P("parseWeight", [v], n);
}
for (const [v, n] of [["8", "< 10 → step 1"], ["10", "10 → step 2.5"], ["39,9", "< 40"], ["40", "≥ 40 → step 5"], ["82,5", "virgola"], ["verde", "colore"], [null, "null"], ["", "vuoto"], ["0", "zero"], ["9.99", "9.99"]]) {
  P("suggestNext", [v], n);
}
for (const [v, n] of [[5, "5"], [10, "10"], [39, "39"], [40, "40"], [null, "null"]]) P("suggestStep", [v], n);
const prMap = { "Band chest press": { peso: 25, date: "2026-10-27" }, "Band squat": { peso: 30, date: "2026-10-27" } };
P("applySession", [prMap, [{ esercizio: "Band chest press", peso: "27,5", date: "2026-11-03" }, { esercizio: "Band squat", peso: "30", date: "2026-11-03" }, { esercizio: "Plank", peso: "5", date: "2026-11-03" }]],
  "un PR su esercizio esistente, uno pari (non PR), uno nuovo");
P("applySession", [prMap, [{ esercizio: "Band squat", peso: "32", date: "2026-11-03" }, { esercizio: "Band squat", peso: "35", date: "2026-11-03" }, { esercizio: "Band squat", peso: "33", date: "2026-11-03" }]], "stesso esercizio più volte: tiene il massimo, prev = vecchio PR");
P("applySession", [prMap, [{ esercizio: "Band squat", peso: "rosso", date: "2026-11-03" }, { esercizio: "", peso: "50", date: "2026-11-03" }, { peso: "50" }, null, { esercizio: "Row", peso: null }]], "elastico, nome vuoto, righe invalide");
P("applySession", [{}, [{ esercizio: "Row", peso: "40" }]], "mappa vuota, data mancante → null");
P("applySession", [null, null], "tutto null");
P("applySession", [prMap, []], "nessuna serie");
P("bestFor", [prMap, "Band squat"], "presente");
P("bestFor", [prMap, "band squat"], "maiuscole diverse: assente (chiave esatta)");
P("bestFor", [prMap, "Row"], "assente");
P("bestFor", [null, "Row"], "mappa null");
write("progress-cases.json", cases);

// ── shopping-fallback.json ───────────────────────────────────────────────────
// spesa.jsx definisce solo funzioni e costanti: caricato qui non esegue nulla di React. Gli id degli articoli sono
// `${categoria}-${indice}`, le chiavi di spunta di sempre.
write("shopping-fallback.json", plain(W.SpesaLogic.shoppingFromCategories(W.SPESA_CATEGORIES)));
