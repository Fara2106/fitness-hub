// test/run.mjs — test harness a zero dipendenze esterne (usa solo @babel/core).
// Due suite: A) smoke "tutti i .jsx compilano", B) unit del parser in sandbox vm.
// Lancio: `npm test`. Exit 0 = tutto verde; exit 1 = almeno un FAIL.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.error("  FAIL " + name); }
}
function transform(absPath) {
  return babel.transformFileSync(absPath, { presets: ["@babel/preset-react"] }).code;
}

// ---- Suite A: smoke "tutti i .jsx compilano" ----
console.log("\nSuite A — smoke: ogni .jsx passa @babel/preset-react");
const SCAN_DIRS = [".", "screens", "dev"];
for (const d of SCAN_DIRS) {
  let entries;
  try { entries = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const f of entries.filter(x => x.endsWith(".jsx")).sort()) {
    const rel = (d === "." ? "" : d + "/") + f;
    try { transform(join(ROOT, d, f)); ok("transform " + rel, true); }
    catch (e) { ok("transform " + rel + " — " + e.message.split("\n")[0], false); }
  }
}

// ---- Suite B: unit del parser ----
console.log("\nSuite B — parser (sandbox vm + shim window)");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
try {
  vm.runInContext(transform(join(ROOT, "parser.jsx")), sandbox, { filename: "parser.jsx" });
  ok("parser.jsx si carica sotto vm", true);
} catch (e) {
  ok("parser.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
}
const W = sandbox.window;

// ---- Suite dati: defaults.jsx (fallback embedded) ----
console.log("\nSuite dati — defaults.jsx allineato + fallback validi");
try {
  vm.runInContext(transform(join(ROOT, "defaults.jsx")), sandbox, { filename: "defaults.jsx" });
  ok("defaults.jsx si carica sotto vm", true);
} catch (e) {
  ok("defaults.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
}
ok("SCHEDA_TXT_FALLBACK === scheda.txt (no drift)",
  W.SCHEDA_TXT_FALLBACK === readFileSync(join(ROOT, "scheda.txt"), "utf8"));
ok("DIETA_TXT_FALLBACK === dieta.txt (no drift)",
  W.DIETA_TXT_FALLBACK === readFileSync(join(ROOT, "dieta.txt"), "utf8"));
if (typeof W.parseScheda === "function") {
  const sf = W.parseScheda(W.SCHEDA_TXT_FALLBACK);
  ok("fallback scheda: ≥1 giorno con esercizi",
    sf.days.length >= 1 && sf.days.every(d => d.exercises.length > 0));
  ok("getSchedule() senza storage → fallback non vuoto",
    W.getSchedule().days.length >= 1);
}
if (typeof W.parseDieta === "function") {
  const df = W.parseDieta(W.DIETA_TXT_FALLBACK);
  ok("fallback dieta: sezione riposo presente", !!(df && df.riposo));
}

if (typeof W.parseScheda === "function") {
  const s = W.parseScheda(readFileSync(join(DIR, "fixtures", "scheda-ppl.txt"), "utf8"));
  ok("parseScheda: 3 giorni", s.days.length === 3);
  ok("parseScheda: ogni giorno ha esercizi", s.days.every(d => d.exercises.length > 0));
  ok("parseScheda: focus del G1 parsato", s.days[0].focus.length === 3);
  ok("parseScheda: spazzatura -> {days:[]}", JSON.stringify(W.parseScheda("boh\nnon valida")) === '{"days":[]}');
  ok("parseScheda: input non stringa -> {days:[]}", JSON.stringify(W.parseScheda(null)) === '{"days":[]}');
} else ok("parseScheda esiste", false);

if (typeof W.parseDieta === "function") {
  const d = W.parseDieta(readFileSync(join(DIR, "fixtures", "dieta.txt"), "utf8"));
  ok("parseDieta: sezione riposo presente", !!(d && d.riposo));
  ok("parseDieta: riposo ha 3 pasti", !!(d && d.riposo && d.riposo.meals.length === 3));
  ok("parseDieta: ore17 ha 2 pasti", !!(d && d.ore17 && d.ore17.meals.length === 2));
  ok("parseDieta: input vuoto -> null", W.parseDieta("") === null);
} else ok("parseDieta esiste", false);

if (typeof W.foodEmoji === "function") {
  ok("foodEmoji('pollo') non vuoto", typeof W.foodEmoji("pollo") === "string" && W.foodEmoji("pollo").length > 0);
} else ok("foodEmoji esiste", false);

// ---- Suite schedaState (modulo puro, sandbox vm) ----
console.log("\nSuite schedaState — id + persistenza keyed-by-id");
try {
  vm.runInContext(transform(join(ROOT, "schedaState.jsx")), sandbox, { filename: "schedaState.jsx" });
  ok("schedaState.jsx si carica sotto vm", true);
} catch (e) {
  ok("schedaState.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
}
if (typeof W.exId === "function") {
  ok("exId compone dayKey#pos", W.exId("Upper A", 3) === "Upper A#3");
  ok("exId distingue giorni alla stessa posizione", W.exId("Upper A", 0) !== W.exId("Lower", 0));

  // Bleed simulation: la mappa piatta isola i giorni per costruzione.
  const completion = {};
  completion[W.exId("Upper A", 0)] = [true, true, false];
  completion[W.exId("Lower", 0)]   = [false];
  const upA = W.getDayState(completion, "Upper A", 1);
  const low = W.getDayState(completion, "Lower", 1);
  ok("getDayState: Upper A legge solo i suoi id", JSON.stringify(upA[0]) === JSON.stringify([true, true, false]));
  ok("getDayState: scrivere Lower non tocca Upper A", JSON.stringify(low[0]) === JSON.stringify([false]));
  ok("getDayState: posizione assente → undefined", W.getDayState(completion, "Upper A", 2)[1] === undefined);
}
if (typeof W.readSchedaProg === "function") {
  // Fake storage sincrono in stile window.storage.
  const fake = { _d: {}, get(k, d) { return k in this._d ? this._d[k] : d; }, set(k, v) { this._d[k] = v; } };
  const empty = W.readSchedaProg(fake, "2026-07-15");
  ok("readSchedaProg: blocco vuoto ha completion/substitutions/pesos",
    empty && empty.completion && empty.substitutions && empty.pesos);
  W.writeSchedaProg(fake, "2026-07-15", { completion: { "Upper A#0": [true] } });
  W.writeSchedaProg(fake, "2026-07-15", { pesos: { "Upper A#0": ["80"] } });
  const merged = W.readSchedaProg(fake, "2026-07-15");
  ok("writeSchedaProg: merge preserva chiavi precedenti",
    merged.completion["Upper A#0"][0] === true && merged.pesos["Upper A#0"][0] === "80");
  ok("schedaProgKey usa la data", W.schedaProgKey("2026-07-15") === "schedaProg_2026-07-15");
}

// ---- Suite Motion: motion.jsx (guard gsap/reduced-motion) ----
console.log("\nSuite Motion — motion.jsx (no-op senza gsap, tween con gsap fake)");
{
  const sb = { window: {}, console };
  vm.createContext(sb);
  try {
    vm.runInContext(transform(join(ROOT, "motion.jsx")), sb, { filename: "motion.jsx" });
    ok("motion.jsx si carica sotto vm", true);
  } catch (e) {
    ok("motion.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
  }
  const M = sb.window.Motion;
  ok("Motion esposto su window", !!M);
  if (M) {
    ok("enabled() === false senza gsap", M.enabled() === false);
    let threw = false;
    try { M.screenEnter(null); M.pop(null); M.countTo(null, 0, 10); } catch (_) { threw = true; }
    ok("API no-op senza gsap/elemento (nessuna eccezione)", !threw);
    const el = { textContent: "" };
    M.countTo(el, 0, 82.5, { decimals: 1 });
    ok("countTo senza gsap scrive subito il valore finale", el.textContent === "82.5");
    // gsap fake: registra le chiamate e salta subito alla fine dei tween
    const calls = [];
    sb.window.gsap = {
      fromTo: (t, a, b) => calls.push("fromTo"),
      to: (t, cfg) => { calls.push("to"); if ("v" in cfg) { t.v = cfg.v; cfg.onUpdate && cfg.onUpdate(); } },
    };
    ok("enabled() === true con gsap fake", M.enabled() === true);
    M.pop({});
    ok("pop() con gsap chiama fromTo", calls.includes("fromTo"));
    const el2 = { textContent: "" };
    M.countTo(el2, 80, 82.5, { decimals: 1 });
    ok("countTo con gsap arriva al valore finale", el2.textContent === "82.5" && calls.includes("to"));
    const fakeItems = [{}, {}];
    const container = { querySelectorAll: () => fakeItems, firstElementChild: null };
    const before = calls.length;
    M.screenEnter(container);
    ok("screenEnter con gsap anima i [data-reveal]", calls.length > before);
    const empty = { querySelectorAll: () => [], firstElementChild: null };
    let threw2 = false;
    try { M.screenEnter(empty); } catch (_) { threw2 = true; }
    ok("screenEnter senza elementi è no-op", !threw2);
    // fallback: nessun [data-reveal] → figli del primo figlio (max 12)
    const kids = Array.from({ length: 15 }, () => ({}));
    const fb = { querySelectorAll: () => [], firstElementChild: { children: kids } };
    const before2 = calls.length;
    M.screenEnter(fb);
    ok("screenEnter fallback usa firstElementChild.children", calls.length > before2);
  }
}

// ---- Suite WorkoutProgress (modulo puro: progressione, PR, volume, nudge, merge) ----
console.log("\nSuite WorkoutProgress — progressione carichi, PR, volume, nudge, merge weightLog");
{
  const sb = { window: {}, console };
  vm.createContext(sb);
  try {
    vm.runInContext(transform(join(ROOT, "progress.jsx")), sb, { filename: "progress.jsx" });
    ok("progress.jsx si carica sotto vm", true);
  } catch (e) {
    ok("progress.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
  }
  const P = sb.window.WorkoutProgress;
  ok("WorkoutProgress esposto su window", !!P);
  if (P) {
    // parseWeight
    ok("parseWeight('80') === 80", P.parseWeight("80") === 80);
    ok("parseWeight('82,5') === 82.5 (virgola)", P.parseWeight("82,5") === 82.5);
    ok("parseWeight('elastico rosso') === null", P.parseWeight("elastico rosso") === null);
    ok("parseWeight('') === null", P.parseWeight("") === null);
    ok("parseWeight('0') === null (non positivo)", P.parseWeight("0") === null);

    // suggestNext (micro-step per fascia)
    ok("suggestNext('8') → +1 = 9", (P.suggestNext("8") || {}).next === 9);
    ok("suggestNext('30') → +2.5 = 32.5", (P.suggestNext("30") || {}).next === 32.5);
    ok("suggestNext('100') → +5 = 105", (P.suggestNext("100") || {}).next === 105);
    ok("suggestNext('elastico') === null", P.suggestNext("elastico") === null);

    // applySession / PR
    const s1 = P.applySession({}, [
      { esercizio: "Panca", peso: "60", date: "2026-07-01" },
      { esercizio: "Panca", peso: "62.5", date: "2026-07-01" },   // stesso esercizio, tiene il max
      { esercizio: "Squat", peso: "elastico", date: "2026-07-01" }, // scartato
    ]);
    ok("applySession: primo PR Panca = 62.5", s1.prMap["Panca"].peso === 62.5);
    ok("applySession: un solo newPR per esercizio", s1.newPRs.filter(p => p.esercizio === "Panca").length === 1);
    ok("applySession: peso non numerico non crea PR", !s1.prMap["Squat"]);
    const s2 = P.applySession(s1.prMap, [{ esercizio: "Panca", peso: "60", date: "2026-07-08" }]);
    ok("applySession: peso inferiore NON è PR", s2.newPRs.length === 0 && s2.prMap["Panca"].peso === 62.5);
    const s3 = P.applySession(s1.prMap, [{ esercizio: "Panca", peso: "65", date: "2026-07-08" }]);
    ok("applySession: nuovo massimo è PR con prev", s3.newPRs.length === 1 && s3.newPRs[0].prev === 62.5);
    ok("bestFor legge il PR", P.bestFor(s1.prMap, "Panca") === 62.5);

    // aggregateVolume
    const vol = P.aggregateVolume([
      { date: "2026-07-01", muscleSets: { Petto: 4, Gambe: 6 } },
      { date: "2026-07-03", muscleSets: { Petto: 3, Braccia: 2 } },
    ]);
    ok("aggregateVolume: Petto sommato = 7", vol.byGroup.Petto === 7);
    ok("aggregateVolume: total = 15", vol.total === 15);
    ok("aggregateVolume: order per volume desc (Petto=7 primo)", vol.order[0] === "Petto");
    ok("aggregateVolume: history vuota → total 0", P.aggregateVolume([]).total === 0);

    // lastNDates
    const dts = P.lastNDates("2026-07-15", 3);
    ok("lastNDates: 3 date, oggi incluso e desc", dts.length === 3 && dts[0] === "2026-07-15" && dts[2] === "2026-07-13");

    // nextNudge (priorità: workout → checkin → hydration; rispetta dismissed)
    ok("nextNudge: giorno workout non fatto → nudge workout",
      (P.nextNudge({ isWorkoutDay: true, gymDone: false, hour: 10 }) || {}).id === "workout");
    ok("nextNudge: workout fatto, sera senza check-in → nudge checkin",
      (P.nextNudge({ isWorkoutDay: true, gymDone: true, checkInDone: false, hour: 21 }) || {}).id === "checkin");
    ok("nextNudge: dismissed 'workout' → salta al successivo o null",
      P.nextNudge({ isWorkoutDay: true, gymDone: false, hour: 10, dismissed: ["workout"] }) === null);
    ok("nextNudge: nulla di pertinente → null",
      P.nextNudge({ isWorkoutDay: false, checkInDone: true, hydration: 8, hour: 15 }) === null);

    // mergeWeightLog
    const merged = P.mergeWeightLog(
      [{ date: "2026-07-01", weight: 77 }, { date: "2026-07-02", weight: 77.5 }],
      [{ date: "2026-07-02", weight: 78 }, { date: "2026-07-03", weight: 78.2 }]
    );
    ok("mergeWeightLog: dedup per data, 3 entry", merged.length === 3);
    ok("mergeWeightLog: conflitto 07-02 → cloud vince (78)", merged.find(e => e.date === "2026-07-02").weight === 78);
    ok("mergeWeightLog: ordinata ascendente", merged[0].date === "2026-07-01" && merged[2].date === "2026-07-03");
    ok("mergeWeightLog prefer local: 07-02 → 77.5",
      P.mergeWeightLog([{ date: "2026-07-02", weight: 77.5 }], [{ date: "2026-07-02", weight: 78 }], "local")[0].weight === 77.5);
  }
}

// ---- Suite Insights (modulo puro: e1RM, sessioni, report, deload, swap) ----
console.log("\nSuite Insights — e1RM, storico esercizio, riepilogo, report, deload, pasti");
{
  const sb = { window: {}, console };
  vm.createContext(sb);
  try {
    vm.runInContext(transform(join(ROOT, "insights.jsx")), sb, { filename: "insights.jsx" });
    ok("insights.jsx si carica sotto vm", true);
  } catch (e) {
    ok("insights.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
  }
  const I = sb.window.Insights;
  ok("Insights esposto su window", !!I);
  if (I) {
    // e1RM (Epley)
    ok("e1rm(100,5) = 116.7", I.e1rm(100, 5) === 116.7);
    ok("e1rm(100,1) = 100", I.e1rm(100, 1) === 100);
    ok("e1rm('82,5',8) usa la virgola", I.e1rm("82,5", 8) === 104.5);
    ok("e1rm('elastico',5) = null", I.e1rm("elastico", 5) === null);

    // exerciseSessions
    const pesiMap = { "panca piana": [
      { date: "2026-07-10", setN: 1, peso: 80, rip: 8 },
      { date: "2026-07-10", setN: 2, peso: 82.5, rip: 6 },
      { date: "2026-07-17", setN: 1, peso: 82.5, rip: 8 },
      { date: "2026-07-17", setN: 2, peso: 85, rip: 5 },
      { date: "2026-07-03", setN: 1, peso: 77.5, rip: 8 },
    ]};
    const sess = I.exerciseSessions(pesiMap, "Panca Piana", 2);
    ok("exerciseSessions: 2 sessioni, più recente prima", sess.length === 2 && sess[0].date === "2026-07-17");
    ok("exerciseSessions: top della più recente = 85", sess[0].top === 85);
    ok("exerciseSessions: tonnage 17/07 = 82.5*8+85*5 = 1085", sess[0].tonnage === 1085);
    ok("exerciseSessions: nome sconosciuto → []", I.exerciseSessions(pesiMap, "Squat").length === 0);

    // sessionSummary
    const exIdFn = (d, i) => d + "#" + i;
    const sum = I.sessionSummary({
      exercises: [
        { name: "Panca piana", sets: [{ rip: 8, peso: 80 }, { rip: 8, peso: 80 }] },
        { name: "Croci", sets: [{ rip: 12, peso: 14 }] },
      ],
      dayKey: "Upper A",
      completion: { "Upper A#0": [true, true], "Upper A#1": [false] },
      substitutions: {},
      pesos: { "Upper A#0": ["85", "85"] },
      exIdFn,
      startTs: 1000, endTs: 1000 + 50 * 60000,
      pesiMap,
    });
    ok("sessionSummary: 2 serie fatte, 1 esercizio", sum.setsDone === 2 && sum.exCount === 1);
    ok("sessionSummary: tonnage = 85*8*2 = 1360", sum.tonnage === 1360);
    ok("sessionSummary: durata 50 min", sum.durationMin === 50);
    ok("sessionSummary: delta vs top precedente (85→85) = 0", sum.perExercise[0].delta === 0);
    ok("sessionSummary: prevTonnage dalla sessione più recente", sum.prevTonnage === 1085);
    ok("sessionSummary: senza start → durationMin null",
      I.sessionSummary({ exercises: [], dayKey: "X", completion: {}, substitutions: {}, pesos: {}, exIdFn, pesiMap: {} }).durationMin === null);

    // weeklyReport
    const rep = I.weeklyReport({
      today: "2026-07-23",
      weightLog: [
        { date: "2026-07-12", weight: 101 }, { date: "2026-07-14", weight: 100.6 },
        { date: "2026-07-20", weight: 100.2 }, { date: "2026-07-22", weight: 100 },
      ],
      gymFlags: { "2026-07-20": true, "2026-07-22": true, "2026-07-10": true },
      muscleHist: [
        { date: "2026-07-20", muscleSets: { Petto: 6, Braccia: 4 } },
        { date: "2026-07-22", muscleSets: { Gambe: 8 } },
        { date: "2026-07-10", muscleSets: { Petto: 99 } },   // fuori settimana
      ],
      prMap: { "Panca piana": { peso: 85, date: "2026-07-22" }, "Squat": { peso: 120, date: "2026-07-01" } },
      checkinDates: ["2026-07-21", "2026-07-22", "2026-07-01"],
      plannedSessions: 3,
    });
    ok("weeklyReport: 2 sessioni in settimana", rep.sessions === 2);
    ok("weeklyReport: 18 serie, Gambe primo gruppo", rep.totalSets === 18 && rep.order[0] === "Gambe");
    ok("weeklyReport: media peso 100.1 vs 100.8 → delta -0.7",
      rep.avgWeight === 100.1 && rep.prevAvgWeight === 100.8 && rep.weightDelta === -0.7);
    ok("weeklyReport: 1 PR in settimana (Panca)", rep.prs.length === 1 && rep.prs[0].esercizio === "Panca piana");
    ok("weeklyReport: 2 check-in in settimana", rep.checkins === 2);

    // deload
    ok("deload: fastidi oggi → true/fastidi",
      I.deloadAdvice([{ sleep: 4, energy: 4, ailments: "spalla dx" }]).reason === "fastidi");
    ok("deload: oggi 2/5 e 3/5 (media 2.5) → true",
      I.deloadAdvice([{ sleep: 2, energy: 3, ailments: "" }]).deload === true);
    ok("deload: due giorni mediocri (3/3) → true/recupero",
      I.deloadAdvice([{ sleep: 3, energy: 3 }, { sleep: 3, energy: 3 }]).reason === "recupero");
    ok("deload: tutto ok → false",
      I.deloadAdvice([{ sleep: 4, energy: 4, ailments: "" }, { sleep: 5, energy: 4 }]).deload === false);
    ok("deload: nessun check-in → false", I.deloadAdvice([]).deload === false);
    ok("deloadWeight(100) = 90", I.deloadWeight("100") === 90);
    ok("deloadWeight(10) = 9 (step 1 sotto i 20)", I.deloadWeight(10) === 9);
    ok("deloadWeight('elastico') = null", I.deloadWeight("elastico") === null);

    // mealAdherence
    const adh = I.mealAdherence({ a: true, b: true, c: false }, 5);
    ok("mealAdherence: 2/5 = 40%", adh.done === 2 && adh.pct === 40);

    // foodSwaps
    const swaps = I.foodSwaps("Carboidrato: riso basmati | pane integrale", "80–100g");
    ok("foodSwaps riso 80g: contiene pasta 80g", swaps.some(s => s.name.indexOf("Pasta") === 0 && s.grams === 80));
    ok("foodSwaps riso 80g: patate ~375g", swaps.some(s => s.name === "Patate" && s.grams === 375));
    ok("foodSwaps: alimento sconosciuto → []", I.foodSwaps("Verdure o ortaggi", "300g").length === 0);
    ok("foodSwaps: senza grammi → []", I.foodSwaps("Riso basmati", "a scelta").length === 0);
    // Formato dieta.txt parsato: grammi NEL testo, segmenti con |
    const swaps2 = I.foodSwaps("Carboidrato (scegli 1): 80g pasta farro integrale | 80g riso rosso integrale", "");
    ok("foodSwaps testo '80g pasta | …': base pasta → patate 375g", swaps2.some(s => s.name === "Patate" && s.grams === 375));
    const swaps3 = I.foodSwaps("Proteina (scegli 1): 150g tonno | 110g primo sale", "");
    ok("foodSwaps testo '150g tonno': equivalenti proteici presenti", swaps3.some(s => s.name.indexOf("Pollo") === 0));
  }
}

// ---- Suite bundle: app.compiled.js allineato ai sorgenti (no drift) ----
// Il browser carica SOLO app.compiled.js: se un .jsx viene modificato senza
// rigenerare il bundle (`npm run build`), l'app servirebbe codice vecchio.
console.log("\nSuite bundle — app.compiled.js rigenerato e identico al committato");
try {
  const { buildBundle, BUNDLE_PATH, BUNDLE_FILES } = await import("../dev/build.mjs");
  const committed = readFileSync(BUNDLE_PATH, "utf8");
  const fresh = buildBundle();
  ok("app.compiled.js === buildBundle() — altrimenti: npm run build", committed === fresh);
  ok("bundle non vuoto e con tutti i file", BUNDLE_FILES.every(f => fresh.includes("══ " + f + " ══")));
  ok("bundle senza import/export ESM (script classico)", !/^\s*(import|export)\s/m.test(fresh));
} catch (e) {
  ok("Suite bundle eseguibile — " + e.message.split("\n")[0], false);
}

// ---- Esito ----
console.log("\n" + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
