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

  // Integratori letti dal blocco "INTEGRATORI:" del file (dal 2026-11-03).
  const real = readFileSync(join(ROOT, "dieta.txt"), "utf8");
  const pr = W.parseDieta(real), D = W._INTEGRATORI_DEFAULT;
  ok("integratori dal file: riposo/mattina/ore17/ore21 identici alla lista curata",
    ["riposo", "mattina", "ore17", "ore21"].every(k => JSON.stringify(pr[k].integratori) === JSON.stringify(D[k])));
  ok("integratori dal file: ore22 include PS+ dopo merenda (scritto nel piano, mancava nella lista fissa)",
    pr.ore22.integratori.some(x => x.type === "ps" && x.sortTime === "18:30") &&
    pr.ore22.integratori.filter(x => x.type !== "ps").length === D.ore22.length);
  const mod = real.replace("- Dopo merenda: PS+\n", "").replace("- Dopocena: Extra Omega+ Concentrated (2ª assunzione)\n",
    "- Dopocena: Extra Omega+ Concentrated (2ª assunzione), Magnesio 300mg\n");
  const pm = W.parseDieta(mod).riposo.integratori;
  ok("integratori dal file: tolto dal file → sparisce dall'app", !pm.some(x => x.type === "ps"));
  const mg = pm.find(x => /Magnesio/.test(x.name));
  ok("integratori dal file: prodotto nuovo letto con orario dal momento (dopocena)", !!mg && mg.sortTime === "21:00" && mg.time === "Dopocena");
  const two = W.parseDieta(mod.replace("Magnesio 300mg", "Magnesio 300mg, Zinco 15mg")).riposo.integratori.filter(x => /^custom-/.test(x.type));
  ok("integratori nuovi: chiave di spunta distinta per prodotto", two.length === 2 && two[0].type !== two[1].type);
  ok("integratori dal file: lista ordinata per orario", pm.every((x, i) => i === 0 || pm[i - 1].sortTime <= x.sortTime));
  const noBlock = W.parseDieta("# GIORNO SENZA ALLENAMENTO\n\nCOLAZIONE:\n- 2 uova\n");
  ok("senza blocco INTEGRATORI → lista fissa (come prima)", JSON.stringify(noBlock.riposo.integratori) === JSON.stringify(D.riposo));
  const after = W.parseDieta("# GIORNO SENZA ALLENAMENTO\n\nCOLAZIONE:\n- 2 uova\nINTEGRATORI:\n- Pre-allenamento ore 06:45: Creatina 5g\n");
  ok("blocco INTEGRATORI dopo un pasto: righe NON finiscono nel pasto",
    after.riposo.meals[0].primary.length === 1 && after.riposo.integratori.some(x => /Creatina/.test(x.name) && x.sortTime === "06:45"));
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

  // Cambio scheda in giornata: il progresso non deve passare a un altro esercizio.
  const mk = (names) => [{ key: "Giorno 1", exercises: names.map(([n, k]) => ({ name: n, sets: new Array(k).fill({}) })) }];
  const vecchio = mk([["Push-up", 3], ["Chest press", 3]]);
  const nuovo   = mk([["Panca piana", 4], ["Chest press", 4]]);
  const sigV = W.schedaPlanSig(vecchio), sigN = W.schedaPlanSig(nuovo);
  ok("schedaPlanSig cambia se cambiano esercizi/serie", sigV !== sigN);
  const fk = { _d: {}, get(k, d) { return k in this._d ? this._d[k] : d; }, set(k, v) { this._d[k] = v; } };
  W.writeSchedaProg(fk, "d", { completion: { "Giorno 1#0": [true, true, false], "Giorno 1#1": [true, false, false] },
    pesos: { "Giorno 1#1": ["10", "", ""] } }, { names: { "Giorno 1#0": "push-up", "Giorno 1#1": "chest press" }, sig: sigV });
  const r1 = W.sanitizeSchedaProg(W.readSchedaProg(fk, "d"), nuovo, sigN);
  ok("sanitize: esercizio cambiato alla stessa posizione → progresso scartato", !("Giorno 1#0" in r1.prog.completion) && r1.changed);
  ok("sanitize: stesso esercizio → progresso tenuto e adattato a 4 serie",
    JSON.stringify(r1.prog.completion["Giorno 1#1"]) === JSON.stringify([true, false, false, false]) &&
    r1.prog.pesos["Giorno 1#1"].length === 4 && r1.prog.pesos["Giorno 1#1"][0] === "10");
  const r2 = W.sanitizeSchedaProg(W.readSchedaProg(fk, "d"), vecchio, sigV);
  ok("sanitize: piano invariato → nulla cambia", !r2.changed && r2.prog.completion["Giorno 1#0"][1] === true);
  const legacy = { completion: { "Giorno 1#0": [true, false, false] }, substitutions: {}, pesos: {}, names: {}, sig: sigV };
  ok("sanitize: voce senza nome + piano cambiato → scartata", !("Giorno 1#0" in W.sanitizeSchedaProg(legacy, nuovo, sigN).prog.completion));
  ok("sanitize: giorno sparito dal piano → scartato",
    !("Giorno 9#0" in W.sanitizeSchedaProg({ completion: { "Giorno 9#0": [true] }, substitutions: {}, pesos: {}, names: {}, sig: null }, nuovo, sigN).prog.completion));
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

    // movingAverage (finestra calendario)
    const wlog = [
      { date: "2026-07-10", weight: 101 }, { date: "2026-07-12", weight: 100 },
      { date: "2026-07-20", weight: 99 },
    ];
    const ma = I.movingAverage(wlog, 7);
    ok("movingAverage: primo punto = peso stesso", ma[0].ma === 101);
    ok("movingAverage: 12/07 media di 10+12 = 100.5", ma[1].ma === 100.5);
    ok("movingAverage: 20/07 fuori finestra dai precedenti → 99", ma[2].ma === 99);

    // weightProjection
    const wl2 = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date("2026-07-01T12:00:00"); d.setDate(d.getDate() + i);
      wl2.push({ date: d.toISOString().slice(0, 10), weight: 101 - i * 0.1 }); // −0.7 kg/sett
    }
    const proj = I.weightProjection(wl2, 98);
    ok("weightProjection: ritmo ≈ −0.7 kg/sett", proj && Math.abs(proj.ratePerWeek + 0.7) < 0.05);
    ok("weightProjection: eta presente verso il target (98 da 99.6)", proj && proj.etaDays > 0 && !!proj.etaDate);
    const projWrong = I.weightProjection(wl2, 110); // trend scende, target sopra
    ok("weightProjection: direzione sbagliata → niente eta", projWrong && !projWrong.etaDate && !projWrong.reached);
    ok("weightProjection: target ≈ attuale → reached", (I.weightProjection(wl2, wl2[wl2.length - 1].weight) || {}).reached === true);
    ok("weightProjection: <2 punti → null", I.weightProjection([{ date: "2026-07-01", weight: 100 }], 95) === null);
  }
}

// ---- Suite PlanConv (planconv.jsx: piani strutturati ⇄ forme del parser) + storage.onChange ----
console.log("\nSuite PlanConv — piani strutturati ⇄ parseScheda/parseDieta, activePlan, planToText, storage.onChange");
{
  const pc = { window: {}, console };
  vm.createContext(pc);
  let loaded = true;
  try {
    vm.runInContext(transform(join(ROOT, "parser.jsx")), pc, { filename: "parser.jsx" });
    vm.runInContext(transform(join(ROOT, "planconv.jsx")), pc, { filename: "planconv.jsx" });
  } catch (e) { loaded = false; ok("parser.jsx + planconv.jsx si caricano sotto vm — " + e.message.split("\n")[0], false); }
  const PC = pc.window.PlanConv;
  if (loaded && PC) {
    ok("planconv.jsx espone window.PlanConv", ["workoutPlanFromText", "dietPlanFromText", "toLegacyScheda", "toLegacyDieta", "planToText", "activePlan"].every(k => typeof PC[k] === "function"));
    const J = (x) => JSON.parse(JSON.stringify(x));          // via i prototipi del contesto vm
    const schedaTxt = readFileSync(join(ROOT, "scheda.txt"), "utf8");
    const dietaTxt = readFileSync(join(ROOT, "dieta.txt"), "utf8");
    const OPT = { name: "Piano fixture", validFrom: "2026-01-01" };
    const wp = PC.workoutPlanFromText(schedaTxt, { ...OPT, id: "workout-fixture" });
    const dp = PC.dietPlanFromText(dietaTxt, { ...OPT, id: "diet-fixture" });

    // Id/forma identici a quelli prodotti da backend/migrate/plans.mjs prima del refactor.
    const before = readFileSync(join(ROOT, "backend", "test", "fixtures", "plans-before.json"), "utf8");
    ok("piani da testo: byte-identici al fixture generato prima del refactor (id deterministici)",
      JSON.stringify({ workout: wp, diet: dp }, null, 2) + "\n" === before);
    ok("piani da testo: id deterministici (stessa chiamata → stesso risultato)",
      JSON.stringify(PC.workoutPlanFromText(schedaTxt, { ...OPT, id: "workout-fixture" })) === JSON.stringify(wp));

    // toLegacyScheda ≡ parseScheda sui campi usati dalle schermate
    const ps = J(pc.window.parseScheda(schedaTxt)), ls = J(PC.toLegacyScheda(wp.data));
    ok("toLegacyScheda: stesso numero di giorni", ls.days.length === ps.days.length && ls.days.length > 0);
    ok("toLegacyScheda: num/key/name/focus dei giorni", ps.days.every((d, i) =>
      ls.days[i].num === d.num && ls.days[i].key === d.key && ls.days[i].name === d.name &&
      JSON.stringify(ls.days[i].focus) === JSON.stringify(d.focus)));
    ok("toLegacyScheda: esercizi name/muscles/rest/notes/ripRange/alternatives", ps.days.every((d, i) =>
      d.exercises.length === ls.days[i].exercises.length && d.exercises.every((e, j) => {
        const x = ls.days[i].exercises[j];
        return x.name === e.name && x.rest === e.rest && x.notes === e.notes && x.ripRange === e.ripRange &&
          JSON.stringify(x.muscles) === JSON.stringify(e.muscles) && JSON.stringify(x.alternatives) === JSON.stringify(e.alternatives);
      })));
    ok("toLegacyScheda: sets = [{peso:0, rip}] con la stessa lunghezza e rip del parser", ps.days.every((d, i) =>
      d.exercises.every((e, j) => JSON.stringify(ls.days[i].exercises[j].sets) === JSON.stringify(e.sets))));
    ok("toLegacyScheda: history [] come il parser", ls.days.every(d => d.exercises.every(e => Array.isArray(e.history) && e.history.length === 0)));
    ok("toLegacyScheda: deep-equal completo a parseScheda (altMap escluso)", JSON.stringify(ls.days.map(d => ({ ...d, altMap: 0 }))) === JSON.stringify(ps.days.map(d => ({ ...d, altMap: 0 }))));
    ok("toLegacyScheda: piano vuoto/null → {days:[]}", JSON.stringify(PC.toLegacyScheda(null)) === '{"days":[]}');

    // toLegacyDieta ≡ parseDieta per ogni variante
    const pd = J(pc.window.parseDieta(dietaTxt)), ld = J(PC.toLegacyDieta(dp.data));
    const KEYS = ["riposo", "mattina", "ore17", "ore21", "ore22"];
    ok("toLegacyDieta: le cinque sezioni", KEYS.every(k => ld[k]));
    ok("toLegacyDieta: pasti time/title/emoji", KEYS.every(k => pd[k].meals.length === ld[k].meals.length && pd[k].meals.every((m, i) =>
      ld[k].meals[i].time === m.time && ld[k].meals[i].title === m.title && ld[k].meals[i].emoji === m.emoji)));
    const texts = (m) => m.primary.concat(m.others).map(f => f.food + "|" + f.qty);
    ok("toLegacyDieta: testi primary+others nello stesso ordine", KEYS.every(k => pd[k].meals.every((m, i) =>
      JSON.stringify(texts(ld[k].meals[i])) === JSON.stringify(texts(m)))));
    ok("toLegacyDieta: integratori name/time/sortTime/type/color", KEYS.every(k =>
      JSON.stringify(ld[k].integratori) === JSON.stringify(pd[k].integratori)));
    ok("toLegacyDieta: ore22 ha PS+ (dal blocco del file)", ld.ore22.integratori.some(x => x.type === "ps" && x.sortTime === "18:30"));
    const dMin = { name: "x", status: "active", variants: [{ id: "v", key: "riposo", name: "R", training: null,
      meals: [{ id: "m", name: "Colazione", time: "08:00", options: [{ id: "o", text: "a" }, { id: "o2", text: "b" }, { id: "o3", text: "c" }],
        lines: [{ id: "l", label: "Verdure", choices: ["1", "2", "3", "4", "5", "6"] }, { id: "l2", label: null, choices: ["Nessun pasto"] }] }],
      supplements: [{ id: "s", key: "custom-zinco", name: "Zinco", moment: "Dopocena", time: "21:00" }] }] };
    const lm = J(PC.toLegacyDieta(dMin));
    ok("toLegacyDieta: prima opzione in primary, le altre in others", lm.riposo.meals[0].primary[0].food === "a" && lm.riposo.meals[0].others[0].food === "b" && lm.riposo.meals[0].others[1].food === "c");
    ok("toLegacyDieta: riga con >4 scelte → prime 4 + 'Altre opzioni: …'", lm.riposo.meals[0].primary[1].food === "Verdure: 1 | 2 | 3 | 4" && lm.riposo.meals[0].others[2].food === "Altre opzioni: 5 | 6");
    ok("toLegacyDieta: riga senza label → testo nudo in primary", lm.riposo.meals[0].primary[2].food === "Nessun pasto");
    ok("toLegacyDieta: integratore nuovo con colore neutro, type = key", lm.riposo.integratori.length === 1 && lm.riposo.integratori[0].color === "#8E8E93" && lm.riposo.integratori[0].type === "custom-zinco");
    ok("toLegacyDieta: sezioni assenti → vuote, nessuna lista fissa di integratori", lm.ore17.meals.length === 0 && lm.ore17.integratori.length === 0);
    const noSupp = J(PC.toLegacyDieta({ variants: [{ key: "riposo", meals: [], supplements: [] }] }));
    ok("toLegacyDieta: piano senza integratori → [] (niente lista fissa)", noSupp.riposo.integratori.length === 0);
    ok("toLegacyDieta: piano non valido → null", PC.toLegacyDieta(null) === null);

    // activePlan
    const rec = (id, status, validFrom, extra) => ({ collection: "workoutPlan", id, updatedAt: 1, deleted: false, data: { status, validFrom, days: [] }, ...(extra || {}) });
    const two = [rec("a", "active", "2026-01-01"), rec("b", "active", "2026-03-01"), rec("c", "archived", "2026-09-01")];
    ok("activePlan: due attivi → vince validFrom più recente", PC.activePlan(two, "workoutPlan").id === "b");
    ok("activePlan: archived ignorati", PC.activePlan([rec("c", "archived", "2026-09-01")], "workoutPlan") === null);
    ok("activePlan: tombstone ignorati", PC.activePlan([rec("a", "active", "2026-01-01"), rec("t", "active", "2026-12-01", { deleted: true, data: null })], "workoutPlan").id === "a");
    ok("activePlan: tombstone con data residua ignorato", PC.activePlan([rec("t", "active", "2026-12-01", { deleted: true })], "workoutPlan") === null);
    ok("activePlan: filtra per collezione", PC.activePlan(two, "dietPlan") === null);
    ok("activePlan: restituisce {id,data}", (() => { const r = PC.activePlan(two, "workoutPlan"); return r && r.data.validFrom === "2026-03-01" && Object.keys(r).join() === "id,data"; })());
    ok("activePlan: lista vuota/null → null", PC.activePlan([], "workoutPlan") === null && PC.activePlan(null, "workoutPlan") === null);

    // planToText
    const txt = PC.planToText(wp.data, dp.data);
    const [wt, dt] = txt.split("\n\nPIANO ALIMENTARE");
    ok("planToText: scheda con giorni ed esercizi", /^SCHEDA ALLENAMENTO/.test(wt) && /Giorno 1 PUSH/.test(wt) && /Push-up \(bodyweight\) 3x8-12 rec 60s/.test(wt));
    ok("planToText: dieta con varianti, pasti e integratori", /\[Giorno senza allenamento\]/.test(dt) && /Colazione 08:00/.test(dt) && /Integratori: /.test(dt));
    ok("planToText: ogni piano ≤ 3000 caratteri", wt.length <= 3000 && ("PIANO ALIMENTARE" + dt).length <= 3000);
    ok("planToText: dieta reale troncata con marcatore […troncato]", /\[…troncato\]$/.test(txt));
    ok("planToText: piano corto (solo scheda) non troncato", !/troncato/.test(PC.planToText(wp.data, null)));
    ok("planToText: solo scheda / senza piani", PC.planToText(null, null) === "" && !/PIANO ALIMENTARE/.test(PC.planToText(wp.data, null)));
  }

  // storage.onChange (storage.jsx sotto vm, senza indexedDB: il db non si apre, le scritture restano in memoria)
  const sx = { window: {}, console };
  vm.createContext(sx);
  try {
    vm.runInContext(transform(join(ROOT, "storage.jsx")), sx, { filename: "storage.jsx" });
    const S = sx.window.storage, calls = [];
    const off = S.onChange((k, v, info) => calls.push([k, v, info.silent]));
    S.set("a", 1);
    S.set("b", 2, { silent: true });
    S.remove("a");
    S.remove("b", { silent: true });
    ok("storage.onChange: set notifica silent:false", JSON.stringify(calls[0]) === '["a",1,false]');
    ok("storage.onChange: set(…,{silent:true}) notifica silent:true", JSON.stringify(calls[1]) === '["b",2,true]');
    ok("storage.onChange: remove notifica (value null) con/senza silent", JSON.stringify(calls[2]) === '["a",null,false]' && JSON.stringify(calls[3]) === '["b",null,true]');
    ok("storage.onChange: il valore è già letto da get() nel callback", (() => { let seen; const o = S.onChange((k) => { seen = S.get(k); }); S.set("z", 9); o(); S.remove("z"); return seen === 9; })());
    off(); const n = calls.length; S.set("c", 3);
    ok("storage.onChange: unsubscribe funziona", calls.length === n);
    const off2 = S.onChange(() => { throw new Error("boom"); });
    let thrown = false; try { S.set("d", 4); } catch (_) { thrown = true; } off2();
    ok("storage.onChange: un listener che lancia non rompe set()", !thrown && S.get("d") === 4);
  } catch (e) { ok("storage.jsx sotto vm — " + e.message.split("\n")[0], false); }
}

// ---- Suite RecordMap (recordmap.jsx: chiavi locali ⇄ record del backend v2) ----
// Parità con backend/migrate/records.mjs: backend/test/recordmap-parity.test.mjs.
console.log("\nSuite RecordMap — gruppi, round-trip chiavi ⇄ record, spunte tolte, finestre, variante dieta, muscleSets");
{
  const rm = { window: {}, console };
  vm.createContext(rm);
  let loaded = true;
  try {
    for (const f of ["parser.jsx", "planconv.jsx", "schedaState.jsx", "recordmap.jsx"]) {
      vm.runInContext(transform(join(ROOT, f)), rm, { filename: f });
    }
  } catch (e) { loaded = false; ok("parser/planconv/schedaState/recordmap si caricano sotto vm — " + e.message.split("\n")[0], false); }
  const RM = rm.window.RecordMap, PC = rm.window.PlanConv;
  ok("recordmap.jsx espone window.RecordMap", !!RM && ["groupsForKey", "buildGroup", "keysForRecord", "rebuildKeys"].every(k => typeof RM[k] === "function"));
  if (loaded && RM) {
    const J = (x) => JSON.parse(JSON.stringify(x));
    // JSON con chiavi ordinate: confronto indipendente dall'ordine delle proprietà
    const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v)) ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {}) : v);
    const same = (a, b) => canon(a) === canon(b);
    const OPT = { name: "Piano", validFrom: "2026-01-01" };
    const wp = J(PC.workoutPlanFromText(readFileSync(join(ROOT, "scheda.txt"), "utf8"), { ...OPT, id: "wp" }));
    const dp = J(PC.dietPlanFromText(readFileSync(join(ROOT, "dieta.txt"), "utf8"), { ...OPT, id: "dp" }));
    const TODAY = "2026-10-30", D = "2026-10-27";
    const ctx = { workout: { id: wp.id, data: wp.data }, diet: { id: dp.id, data: dp.data }, today: TODAY };
    const getter = (store) => (k, def) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : def);
    const groupsOf = (store) => [...new Set(Object.keys(store).flatMap(k => J(RM.groupsForKey(k, store[k], ctx))))];
    const buildAll = (store) => groupsOf(store).flatMap(g => J(RM.buildGroup(g, getter(store), ctx)).records);
    const cacheOf = (records) => {
      const m = new Map(records.map(r => [r.collection + "/" + r.id, { ...r, deleted: false, updatedAt: 1 }]));
      return {
        getRecord: (c, id) => m.get(c + "/" + id) || null,
        listRecords: (c) => [...m.values()].filter(r => r.collection === c),
      };
    };
    const rebuildFrom = (records, keys) => { const c = cacheOf(records); return J(RM.rebuildKeys(keys, c.getRecord, c.listRecords, ctx)); };
    const find = (list, c, id) => list.find(r => r.collection === c && r.id === id);

    const ore17 = dp.data.variants.find(v => v.key === "ore17"), riposo = dp.data.variants.find(v => v.key === "riposo");
    const mk = (m) => `${m.time}|${m.name}`;
    const day0 = wp.data.days[0];
    const sig = rm.window.schedaPlanSig(J(PC.toLegacyScheda(wp.data)).days);
    const actId = new Date(`${D}T18:30:00`).getTime();

    // Storage "canonico" (come lo scrive la PWA) per il round-trip.
    const store = {
      [`checkIn_${D}`]: { sleep: 4, energy: 5, ailments: "spalla" },
      [`hydration_${D}`]: 6,
      [`notes_${D}`]: "Buona sessione",
      [`restDay_${D}`]: true,
      [`dietaVariant_${D}`]: "ore17",
      [`dietaCheck_${D}`]: { [mk(ore17.meals[0])]: true, [mk(ore17.meals[1])]: false },
      [`integ_${D}`]: { [ore17.supplements[0].key]: true, [ore17.supplements[1].key]: false },
      [`schedaProg_${D}`]: {
        completion: { "Giorno 1#0": [true, true, false], "Giorno 1#1": [false, true, false] },
        substitutions: { "Giorno 1#1": "Chest press con manubri" },
        pesos: { "Giorno 1#0": ["20", "22.5", ""], "Giorno 1#3": ["5", "5"] },
        names: { "Giorno 1#0": day0.exercises[0].name.toLowerCase(), "Giorno 1#1": day0.exercises[1].name.toLowerCase(), "Giorno 1#3": day0.exercises[3].name.toLowerCase() },
        sig,
      },
      [`gym_${D}`]: true,
      [`gymStart_${D}`]: 1793093400000,
      [`coachChat_${D}`]: [{ role: "assistant", text: "Ciao!" }, { role: "user", text: "Cosa mangio?" }, { role: "error", text: "⚠️ rete" }],
      weightLog: [{ date: "2026-10-20", weight: 78.4 }, { date: "2026-10-27", weight: 78.2 }],
      bodyMeasures: [{ date: "2026-10-20", vita: 84 }, { date: "2026-10-27", vita: 83.5, braccio: 35 }],
      activities: [{ type: "walk", min: 30, km: 2.5, note: "parco", id: actId, when: "Oggi" }],
      exNotes: { "band squat": "Piedi larghi" },
      prMap: { "Band chest press": { peso: 25, date: D } },
      spesaChecked: { "proteine-0": true, "verdura-2": false },
      spesaExtra: [{ id: 1761000000000, name: "Caffè" }, { id: 1761000000500, name: "Tè" }],
      spesaFreq: 2, weightGoal: 75, bodyWeight: 78, lang: "en", theme: "dark",
    };
    const built = buildAll(store);
    const keys = [...new Set(built.flatMap(r => J(RM.keysForRecord(r, ctx))))];
    const back = rebuildFrom(built, keys);
    const ROUND = [`checkIn_${D}`, `hydration_${D}`, `notes_${D}`, `restDay_${D}`, `dietaVariant_${D}`, `dietaCheck_${D}`, `integ_${D}`,
      `schedaProg_${D}`, `gym_${D}`, `gymStart_${D}`, `coachChat_${D}`, "weightLog", "bodyMeasures", "activities", "exNotes", "prMap",
      "spesaChecked", "spesaExtra", "spesaFreq", "weightGoal", "bodyWeight", "lang", "theme"];
    const bad = ROUND.filter(k => !same(back[k], store[k]));
    ok("round-trip: buildGroup → keysForRecord → rebuildKeys ricostruisce tutte le chiavi" + (bad.length ? " (diverse: " + bad.join(", ") + ")" : ""), bad.length === 0);
    ok("round-trip: nessun record doppio fra gruppi", new Set(built.map(r => r.collection + "/" + r.id)).size === built.length);

    // muscleSets_ dai setLog + muscoli del piano (forma di handleSaveSession in scheda.jsx)
    const GROUP = { petto: "Petto", schiena: "Schiena", spalle: "Spalle", trapezi: "Spalle", quadricipiti: "Gambe", femorali: "Gambe", glutei: "Gambe", polpacci: "Gambe", bicipiti: "Braccia", tricipiti: "Braccia", addome: "Core" };
    const expMs = {};
    J(PC.toLegacyScheda(wp.data)).days[0].exercises.forEach((ex, i) => {
      const n = (store[`schedaProg_${D}`].completion[`Giorno 1#${i}`] || []).filter(Boolean).length;
      if (!n) return;
      const g = GROUP[ex.muscles[0] || ""] || "Altro";
      expMs[g] = (expMs[g] || 0) + n;
    });
    ok("muscleSets_: ricostruito dai setLog + muscoli del piano come scheda.jsx", keys.includes(`muscleSets_${D}`) && JSON.stringify(back[`muscleSets_${D}`]) === JSON.stringify(expMs) && expMs.Petto === 3);
    ok("muscleSets_: senza sessione chiusa la chiave resta com'è (assente dal risultato)", !(`muscleSets_${D}` in rebuildFrom(built.filter(r => r.collection !== "workoutSession"), [`muscleSets_${D}`])));

    // id e forme
    const ex0 = day0.exercises[0];
    ok("setLog: id `${date}:${exerciseId}:${setIndex}` e data come records.mjs", same(find(built, "setLog", `${D}:${ex0.id}:1`).data,
      { date: D, exerciseId: ex0.id, exerciseName: ex0.name, planId: "wp", setIndex: 1, weight: "22.5", reps: null, done: true, substitutedWith: null }));
    ok("setLog: serie non spuntata registrata → done:false (non assente)", find(built, "setLog", `${D}:${ex0.id}:2`).data.done === false);
    ok("setLog: solo peso digitato → setLog done:false col peso", find(built, "setLog", `${D}:${day0.exercises[3].id}:0`).data.weight === "5");
    ok("setLog: sostituzione su ogni serie dell'esercizio", find(built, "setLog", `${D}:${day0.exercises[1].id}:0`).data.substitutedWith === "Chest press con manubri");
    ok("workoutSession: id `${date}:${dayId}`, startedAt da gymStart_", same(find(built, "workoutSession", `${D}:${day0.id}`).data,
      { date: D, dayId: day0.id, dayName: day0.name, startedAt: 1793093400000, done: true }));
    ok("dayState: un record per campo `${date}:${field}` con { date, field, value } (Ruling 7)", same(built.filter(r => r.collection === "dayState").map(r => r.id).sort(),
      [`${D}:cardio:${actId}`, `${D}:checkIn`, `${D}:dietVariant`, `${D}:hydration`, `${D}:notes`, `${D}:rest`]) &&
      same(find(built, "dayState", `${D}:checkIn`).data, { date: D, field: "checkIn", value: store[`checkIn_${D}`] }) &&
      same(find(built, "dayState", `${D}:notes`).data, { date: D, field: "notes", value: "Buona sessione" }) &&
      same(find(built, "dayState", `${D}:rest`).data, { date: D, field: "rest", value: true }) &&
      same(find(built, "dayState", `${D}:dietVariant`).data, { date: D, field: "dietVariant", value: "ore17" }));
    ok("dayState cardio: un record per attività `${date}:cardio:<id>`, value senza `when`", same(find(built, "dayState", `${D}:cardio:${actId}`).data,
      { date: D, field: "cardio", value: { type: "walk", min: 30, km: 2.5, note: "parco", id: actId } }));
    const dayIds = (st) => J(RM.buildGroup(`day:${D}`, getter(st), ctx)).records.map(r => r.id);
    ok("dayState: campo tolto in locale (note cancellate) → il suo record sparisce dal gruppo, gli altri restano", (() => {
      const st = { ...store, [`notes_${D}`]: "" }; const ids = dayIds(st);
      return !ids.includes(`${D}:notes`) && ids.includes(`${D}:checkIn`) && ids.includes(`${D}:hydration`);
    })());
    ok("dayState: campo mai impostato → nessun record", same(dayIds({ [`checkIn_${D}`]: { sleep: 3, energy: 3, ailments: "" } }), [`${D}:checkIn`]));
    ok("dayState: attività cancellata (dentro la finestra) → sparisce solo il suo record cardio", (() => {
      const a2 = { type: "run", min: 5, km: 1, note: "", id: actId + 60000, when: "Oggi" };
      const both = J(RM.buildGroup(`cardio:${D}`, getter({ activities: [a2, store.activities[0]] }), ctx)).records.map(r => r.id);
      const one = J(RM.buildGroup(`cardio:${D}`, getter({ activities: [a2] }), ctx));
      return both.length === 2 && one.records.length === 1 && one.records[0].id === `${D}:cardio:${a2.id}` && !one.window;
    })());
    ok("settings: le cinque chiavi incluso bodyWeight → { value }", ["spesaFreq", "weightGoal", "bodyWeight", "lang", "theme"].every(k => same(find(built, "settings", k).data, { value: store[k] })));

    // spunte tolte → update done:false / checked:false, mai assenti
    const ore17meal1 = find(built, "mealCheck", `${D}:${ore17.meals[1].id}`);
    ok("spunta tolta: dietaCheck_ false → mealCheck done:false", !!ore17meal1 && ore17meal1.data.done === false);
    ok("spunta tolta: integ_ false → supplementCheck done:false", find(built, "supplementCheck", `${D}:${ore17.supplements[1].id}`).data.done === false);
    ok("spunta tolta: spesaChecked false → shoppingCheck checked:false", find(built, "shoppingCheck", "verdura-2").data.checked === false);
    const allOff = J(RM.buildGroup(`meals:${D}`, getter({ [`dietaCheck_${D}`]: { [mk(riposo.meals[0])]: false } }), ctx));
    ok("spunta tolta senza dietaVariant_ né altre spunte → resta mappata (done:false)", allOff.records.length === 1 && allOff.records[0].data.done === false && !allOff.window);

    // variante dieta del giorno
    const ticks = { [mk(riposo.meals[0])]: true };
    const withV = J(RM.buildGroup(`meals:${D}`, getter({ [`dietaCheck_${D}`]: ticks, [`dietaVariant_${D}`]: "ore17" }), ctx)).records;
    const ore17Same = ore17.meals.find(m => mk(m) === mk(riposo.meals[0]));
    ok("dietaVariant_ presente → spunte sulla variante indicata", !!ore17Same && withV.length === 1 && withV[0].data.mealId === ore17Same.id);
    const noV = J(RM.buildGroup(`meals:${D}`, getter({ [`dietaCheck_${D}`]: ticks }), ctx)).records;
    ok("dietaVariant_ assente → scelta della migrazione (più spunte, poi ordine del piano)", noV.length === 1 && noV[0].data.mealId === riposo.meals[0].id);
    ok("dietaVariant_ assente → dayState dietVariant = variante scelta", same(J(RM.buildGroup(`variant:${D}`, getter({ [`dietaCheck_${D}`]: ticks }), ctx)).records,
      [{ collection: "dayState", id: `${D}:dietVariant`, data: { date: D, field: "dietVariant", value: "riposo" } }]));
    const badV = { [`dietaCheck_${D}`]: ticks, [`dietaVariant_${D}`]: "vecchia" };
    ok("dietaVariant_ non nel piano → dayState e spunte usano la stessa variante risolta", J(RM.buildGroup(`variant:${D}`, getter(badV), ctx)).records[0].data.value === "riposo" &&
      J(RM.buildGroup(`meals:${D}`, getter(badV), ctx)).records[0].data.mealId === riposo.meals[0].id);
    ok("dietaVariant_ senza piano dieta → variant non tocca nulla", J(RM.buildGroup(`variant:${D}`, getter(badV), { ...ctx, diet: null })).window.collection === "dayState");
    ok("dietaVariant_ → ricalcola variant/meals/supps", JSON.stringify(J(RM.groupsForKey(`dietaVariant_${D}`))) === JSON.stringify([`variant:${D}`, `meals:${D}`, `supps:${D}`]));

    // finestre locali
    const wl = [];
    for (let i = 0; i < 90; i++) { const d = new Date(2026, 7, 5 + i, 12); wl.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, weight: 80 - i / 10 }); }
    const wg = J(RM.buildGroup("weights", getter({ weightLog: wl }), ctx));
    ok("finestra: weightLog 90 voci dal 2026-08-05 → window { bodyWeight, minId 2026-08-05 }", wg.records.length === 90 && same(wg.window, { collection: "bodyWeight", minId: "2026-08-05" }));
    ok("finestra: bodyMeasures → window bodyMeasure dalla data più vecchia", same(J(RM.buildGroup("measures", getter(store), ctx)).window, { collection: "bodyMeasure", minId: "2026-10-20" }));
    const longWl = rebuildFrom(wl.concat([{ date: "2026-11-03", weight: 70 }]).map(e => ({ collection: "bodyWeight", id: e.date, data: { date: e.date, kg: e.weight } })), ["weightLog"]).weightLog;
    ok("rebuild weightLog: ultime 90 in ordine di data", longWl.length === 90 && longWl[0].date === "2026-08-06" && longWl[89].date === "2026-11-03");
    const oldDay = J(RM.buildGroup("day:2026-07-31", getter({ "checkIn_2026-07-31": { sleep: 1, energy: 1 } }), ctx));
    ok("orizzonte sweep: gruppo di un giorno < oggi−90 → nessun record e nessun tombstone", oldDay.records.length === 0 && oldDay.window.collection === "dayState" && oldDay.window.minId > "2026-07-31");
    ok("orizzonte sweep: oggi−90 è ancora dentro", J(RM.buildGroup("day:2026-08-01", getter({ "checkIn_2026-08-01": { sleep: 1, energy: 1 } }), ctx)).records.length === 1);

    // activities: 60 giorni (Ruling 5) e lista piena
    const ag = J(RM.groupsForKey("activities", [], ctx));
    ok("activities → cardio:<data> degli ultimi 60 giorni fino a ctx.today", ag.length === 60 && ag[0] === `cardio:${TODAY}` && ag[59] === "cardio:2026-09-01");
    const full = [];
    for (let i = 0; i < 50; i++) full.push({ type: "walk", min: 10, km: 1, note: "", id: new Date(2026, 9, 29 - Math.floor(i / 2), 9).getTime() - i, when: "Oggi" });
    const oldest = J(RM.buildGroup("cardio:2026-10-05", getter({ activities: full }), ctx));
    ok("activities piena (50): il cardio del giorno più vecchio in lista non viene riscritto né tombstonato", oldest.records.length === 0 && oldest.window.collection === "dayState" && oldest.window.minId > "2026-10-05:cardio:~");
    ok("activities piena (50): gli altri campi di quel giorno si sincronizzano lo stesso", J(RM.buildGroup("day:2026-10-05", getter({ activities: full, "checkIn_2026-10-05": { sleep: 3, energy: 3 } }), ctx)).records.length === 1);
    ok("activities piena (50): i giorni più recenti sì", J(RM.buildGroup("cardio:2026-10-29", getter({ activities: full }), ctx)).records.length === 2);
    const cardioRec = (a) => ({ collection: "dayState", id: `x:cardio:${a.id}`, data: { date: "x", field: "cardio", value: { type: a.type, min: a.min, km: a.km, note: a.note, id: a.id } } });
    const acts = rebuildFrom(full.map(cardioRec).concat([cardioRec({ type: "run", min: 5, km: 1, note: "", id: new Date(2026, 9, 30, 9).getTime() }),
      { collection: "dayState", id: "2026-10-30:notes", data: { date: "2026-10-30", field: "notes", value: "n" } }]), ["activities"]).activities;
    ok("rebuild activities: 50 più recenti, più recente prima, con when", acts.length === 50 && acts[0].type === "run" && acts.every((a, i) => i === 0 || acts[i - 1].id >= a.id) && acts.every(a => a.when === "Oggi"));

    // piani mancanti / record di altri piani
    const noPlan = { ...ctx, workout: null, diet: null };
    const np = J(RM.buildGroup(`sets:${D}`, getter(store), noPlan));
    ok("senza piano scheda: sets → nessun record e nessun tombstone", np.records.length === 0 && np.window.collection === "setLog" && np.window.minId > `${D}:~`);
    ok("senza piano dieta: meals → nessun tombstone", J(RM.buildGroup(`meals:${D}`, getter(store), noPlan)).window.collection === "mealCheck");
    const cNo = cacheOf(built);
    ok("senza piano: rebuild lascia schedaProg_/dietaCheck_ com'erano (chiavi assenti)", (() => { const o = J(RM.rebuildKeys([`schedaProg_${D}`, `dietaCheck_${D}`], cNo.getRecord, cNo.listRecords, noPlan)); return !(`schedaProg_${D}` in o) && !(`dietaCheck_${D}` in o); })());
    const foreign = built.concat([{ collection: "setLog", id: `${D}:name:curl:0`, data: { date: D, exerciseId: "name:curl", exerciseName: "curl", planId: null, setIndex: 0, weight: "8", reps: null, done: true, substitutedWith: null } }]);
    ok("rebuild schedaProg_: setLog fuori dal piano attivo (name:) saltati", same(rebuildFrom(foreign, [`schedaProg_${D}`])[`schedaProg_${D}`], store[`schedaProg_${D}`]));
    const renamed = J(RM.buildGroup(`sets:${D}`, getter({ [`schedaProg_${D}`]: { completion: { "Giorno 1#0": [true] }, names: { "Giorno 1#0": "dips" } } }), ctx)).records;
    ok("sets: nome registrato ≠ piano → exerciseId name:<nome>, planId null", renamed.length === 1 && renamed[0].id === `${D}:name:dips:0` && renamed[0].data.planId === null);
    const later = { ...ctx, workout: { id: "wp", data: { ...wp.data, validFrom: "2026-10-28" } } };
    ok("sets: senza nome e piano valido da dopo quella data → scartato", J(RM.buildGroup(`sets:${D}`, getter({ [`schedaProg_${D}`]: { completion: { "Giorno 1#0": [true] } } }), later)).records.length === 0);

    // keysForRecord / rebuild di tombstone
    ok("keysForRecord: tombstone (data null) → data dall'id", JSON.stringify(J(RM.keysForRecord({ collection: "mealCheck", id: `${D}:dp/v0/m0`, data: null, deleted: true }, ctx))) === JSON.stringify([`dietaCheck_${D}`]));
    ok("keysForRecord: dayState per campo → solo la sua chiave (anche da tombstone)", JSON.stringify(J(RM.keysForRecord({ collection: "dayState", id: `${D}:notes`, data: null, deleted: true }, ctx))) === JSON.stringify([`notes_${D}`]) &&
      JSON.stringify(J(RM.keysForRecord(find(built, "dayState", `${D}:checkIn`), ctx))) === JSON.stringify([`checkIn_${D}`]) &&
      JSON.stringify(J(RM.keysForRecord({ collection: "dayState", id: `${D}:cardio:1`, data: null, deleted: true }, ctx))) === JSON.stringify(["activities"]));
    ok("rebuild: tombstone di un campo dayState → rimuove solo quella chiave", (() => {
      const recs = built.filter(r => r.id !== `${D}:notes`);
      const c = cacheOf(recs); const o = RM.rebuildKeys([`notes_${D}`, `checkIn_${D}`], c.getRecord, c.listRecords, ctx); // senza J: undefined resta
      return `notes_${D}` in o && o[`notes_${D}`] === undefined && same(o[`checkIn_${D}`], store[`checkIn_${D}`]);
    })());
    const prDup = J(RM.buildGroup("prs", getter({ prMap: { "Band Squat": { peso: 30, date: "2026-10-01" }, "band squat": { peso: 25, date: "2026-10-20" }, "Plank": { peso: 0, date: "2026-10-01" }, "plank": { peso: 0, date: "2026-10-02" } } }), ctx)).records;
    ok("prMap: nomi uguali a meno delle maiuscole → un record, vince il peso più alto (a pari peso l'ultimo)", prDup.length === 2 &&
      same(find(prDup, "personalRecord", "band squat").data, { exerciseName: "Band Squat", peso: 30, date: "2026-10-01" }) &&
      find(prDup, "personalRecord", "plank").data.date === "2026-10-02");
    ok("keysForRecord: piani e settings non locali → nessuna chiave", J(RM.keysForRecord({ collection: "workoutPlan", id: "wp", data: wp.data }, ctx)).length === 0 &&
      J(RM.keysForRecord({ collection: "settings", id: "excludedFoods", data: { value: [] } }, ctx)).length === 0);
    ok("DIRECT = workoutPlan, dietPlan", RM.DIRECT.has("workoutPlan") && RM.DIRECT.has("dietPlan") && RM.DIRECT.size === 2);
    const gone = built.filter(r => r.collection !== "dayState" && r.collection !== "coachMessage").concat([{ collection: "settings", id: "theme", data: null, deleted: true }]);
    const goneOut = rebuildFrom(gone, [`checkIn_${D}`, `coachChat_${D}`]);
    ok("rebuild: record assente → chiave da rimuovere (undefined)", `checkIn_${D}` in RM.rebuildKeys([`checkIn_${D}`], cacheOf(gone).getRecord, cacheOf(gone).listRecords, ctx) && goneOut[`checkIn_${D}`] === undefined && goneOut[`coachChat_${D}`] === undefined);
    ok("rebuild: setting tombstone → undefined", (() => { const c = cacheOf([]); const o = RM.rebuildKeys(["theme"], (cc, id) => (cc === "settings" && id === "theme" ? { collection: "settings", id: "theme", data: null, deleted: true } : null), c.listRecords, ctx); return "theme" in o && o.theme === undefined; })());
    ok("groupsForKey: chiavi non sincronizzate → []", ["groqApiKey", "syncToken", `muscleSets_${D}`, `nudgeDismissed_${D}`, "schedaData"].every(k => J(RM.groupsForKey(k)).length === 0));
    ok("buildGroup: gruppo sconosciuto → errore", (() => { try { RM.buildGroup("boh", getter({}), ctx); return false; } catch (_) { return true; } })());
    ok("dayState vuoto (restDay_ false e nient'altro) → nessun record", J(RM.buildGroup(`day:${D}`, getter({ [`restDay_${D}`]: false }), ctx)).records.length === 0);
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
