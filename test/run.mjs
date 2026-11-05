// test/run.mjs — test harness a zero dipendenze esterne (usa solo @babel/core).
// Due suite: A) smoke "tutti i .jsx compilano", B) unit del parser in sandbox vm.
// Lancio: `npm test`. Exit 0 = tutto verde; exit 1 = almeno un FAIL.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createHash } from "node:crypto";

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

  // Ruling 62: nel blocco solo le serie toccate, le proposte restano a video.
  const exP = { name: "Panca", sets: [{ peso: "20" }, { peso: "20" }, { peso: "" }] };
  ok("schedaPesoAt: scrive solo la serie indicata", JSON.stringify(W.schedaPesoAt(undefined, 3, 1, "55")) === JSON.stringify(["", "55", ""]));
  ok("schedaPesoAt: tiene le serie già toccate", JSON.stringify(W.schedaPesoAt(["50", "", ""], 3, 1, "55")) === JSON.stringify(["50", "55", ""]));
  ok("schedaShownPesos: toccato → ultime sessioni → default", JSON.stringify(W.schedaShownPesos(["50", "", ""], exP, { panca: [30, 31] })) === JSON.stringify(["50", "31", ""]));
  ok("schedaShownPesos: senza storia il default della scheda", JSON.stringify(W.schedaShownPesos(undefined, exP, null)) === JSON.stringify(["20", "20", ""]));
  ok("schedaShownAll: tutti gli esercizi di tutti i giorni", JSON.stringify(W.schedaShownAll({}, [{ key: "G1", exercises: [exP] }], null)) === JSON.stringify({ "G1#0": ["20", "20", ""] }));
  const curP = { completion: { "G1#0": [true, false, false] }, pesos: { "G1#0": ["50", "", ""] } };
  ok("schedaTickPesos: la serie appena spuntata registra il peso a video",
    JSON.stringify(W.schedaTickPesos(curP, { "G1#0": [true, true, false] }, { "G1#0": ["50", "30", "30"] })) === JSON.stringify({ "G1#0": ["50", "30", ""] }));
  ok("schedaTickPesos: togliere una spunta non scrive pesi", Object.keys(W.schedaTickPesos(curP, { "G1#0": [false, false, false] }, { "G1#0": ["50", "30", "30"] })).length === 0);
  ok("schedaTickPesos: niente a video, niente peso", Object.keys(W.schedaTickPesos(curP, { "G1#0": [true, true, false] }, { "G1#0": ["50", "", ""] })).length === 0);
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

    // setLabel (card "Ultime sessioni" del Player): mai "null×8" / "80×null"
    ok("setLabel: peso e rip → 80×8", I.setLabel({ peso: 80, rip: 8 }) === "80×8");
    ok("setLabel: peso null o vuoto → –×8", I.setLabel({ peso: null, rip: 8 }) === "–×8" && I.setLabel({ peso: "", rip: 8 }) === "–×8" && I.setLabel({ rip: 8 }) === "–×8");
    ok("setLabel: rip null/0 → solo il peso", I.setLabel({ peso: 80, rip: null }) === "80" && I.setLabel({ peso: 80, rip: 0 }) === "80");
    ok("setLabel: tutto vuoto → –; testo (elastico) tenuto", I.setLabel({ peso: null, rip: null }) === "–" && I.setLabel(null) === "–" && I.setLabel({ peso: "rosso", rip: 12 }) === "rosso×12");

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

// Il peso è testo libero: gli stessi valori che nell'app nativa erano un crash (M2 della review finale).
{
  const HUGE = ["1e30", "inf", "Infinity", "nan", "-1", "9".repeat(25), "9".repeat(400), "1" + "0".repeat(30)];
  const sb = { window: {}, console };
  vm.createContext(sb);
  let threw = null;
  try {
    for (const f of ["progress.jsx", "insights.jsx"]) vm.runInContext(transform(join(ROOT, f)), sb, { filename: f });
    const P = sb.window.WorkoutProgress, I = sb.window.Insights;
    for (const peso of HUGE) {
      P.suggestNext(peso);
      P.applySession({}, [{ esercizio: "Panca", peso, date: "2026-10-01" }]);
      I.e1rm(peso, 8);
      const pesiMap = { Panca: [{ date: "2026-10-01", peso, rip: 8 }] };
      I.exerciseSessions(pesiMap, "Panca", 3);
      I.sessionSummary({ exercises: [{ name: "Panca", sets: [{ peso, rip: 8 }] }], dayKey: "G", completion: { "G#0": [true] },
        substitutions: {}, pesos: { "G#0": [peso] }, exIdFn: (d, i) => `${d}#${i}`, startTs: 1, endTs: 2, pesiMap });
    }
  } catch (e) { threw = e; }
  ok("pesi enormi: progressione, PR e riepilogo non lanciano" + (threw ? " — " + threw.message : ""), threw === null);
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
    const backCmp = { ...back, [`coachChat_${D}`]: (back[`coachChat_${D}`] || []).map(({ role, text }) => ({ role, text })) }; // `index` è il segnaposto stabile del Coach
    const bad = ROUND.filter(k => !same(backCmp[k], store[k]));
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
    ok("setLog: serie mai toccata (non spuntata, senza peso, ignota) → nessun record (Ruling 62)", !find(built, "setLog", `${D}:${ex0.id}:2`));
    {
      const known = RM.buildGroup(`sets:${D}`, getter(store), { ...ctx, records: () => [{ id: `${D}:${ex0.id}:2`, data: { date: D, exerciseId: ex0.id, exerciseName: ex0.name, setIndex: 2, done: true } }] }).records;
      ok("setLog: serie già nota al sync, spunta tolta → done:false (non assente)", find(known, "setLog", `${D}:${ex0.id}:2`).data.done === false);
    }
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
    ok("finestra (Ruling 15): weightLog sotto il limite (89) → nessuna window (la più vecchia cancellata è un tombstone)",
      (() => { const g = J(RM.buildGroup("weights", getter({ weightLog: wl.slice(1) }), ctx)); return g.records.length === 89 && g.window === undefined; })());
    ok("finestra (Ruling 15): bodyMeasures sotto il limite (2 voci) → nessuna window", J(RM.buildGroup("measures", getter(store), ctx)).window === undefined);
    const ms = [];
    for (let i = 0; i < 120; i++) { const d = new Date(2026, 0, 1 + i, 12); ms.push({ date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, vita: 84 }); }
    ok("finestra: bodyMeasures al limite (120) → window bodyMeasure dalla data più vecchia", same(J(RM.buildGroup("measures", getter({ bodyMeasures: ms }), ctx)).window, { collection: "bodyMeasure", minId: "2026-01-01" }));
    ok("finestra: limite contato sulle voci della lista (anche ripetute per data), come il taglio della PWA",
      (() => { const g = J(RM.buildGroup("weights", getter({ weightLog: wl.slice(1).concat([wl[89]]) }), ctx)); return g.records.length === 89 && same(g.window, { collection: "bodyWeight", minId: wl[1].date }); })());
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

// ---- Suite SyncV2 (syncv2.jsx: motore offline-first sul backend v2) ----
// Due "device" = due sandbox vm con storage.jsx (in memoria) + parser/planconv/schedaState/recordmap/syncv2;
// fetch instradato in-process sul default export di backend/src/worker.mjs con D1 simulato (node:sqlite).
// Mai la rete vera. Timer iniettati (debounce verificabile senza attese), orologio per device iniettato.
console.log("\nSuite SyncV2 — due device sullo stesso backend in-process: coda, primo sync, conflitti, reset, finestre, lotti");
await (async () => {
  let worker, createD1;
  try {
    worker = (await import("../backend/src/worker.mjs")).default;
    ({ createD1 } = await import("../backend/test/d1-sqlite.mjs"));
  } catch (e) { ok("backend in-process importabile — " + e.message.split("\n")[0], false); return; }
  const SCHEMA = readFileSync(join(ROOT, "backend", "schema.sql"), "utf8");
  const TOKEN = "ab".repeat(32);
  const API = "https://fitness-hub-api.lorefara97.workers.dev";
  const FILES = ["storage.jsx", "parser.jsx", "planconv.jsx", "schedaState.jsx", "recordmap.jsx", "syncv2.jsx"];
  let sources;
  try { sources = FILES.map(f => [f, transform(join(ROOT, f))]); }
  catch (e) { ok("syncv2.jsx e dipendenze compilano — " + e.message.split("\n")[0], false); return; }

  const J = (x) => JSON.parse(JSON.stringify(x));
  const pad = (n) => String(n).padStart(2, "0");
  const dateOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const T0 = Date.now();
  const TODAY = dateOf(T0);
  const daysAgo = (n) => { const d = new Date(T0); return dateOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, 12).getTime()); };
  const tick = () => new Promise(r => setImmediate(r));
  const MB15 = 1.5 * 1024 * 1024;

  // Piani attivi dal .txt del repo (stesso convertitore della migrazione).
  const pcSb = { window: {}, console };
  vm.createContext(pcSb);
  for (const [f, code] of sources) if (f === "parser.jsx" || f === "planconv.jsx") vm.runInContext(code, pcSb, { filename: f });
  const PC = pcSb.window.PlanConv;
  const wp = J(PC.workoutPlanFromText(readFileSync(join(ROOT, "scheda.txt"), "utf8"), { id: "workout-test", name: "Scheda", validFrom: "2026-01-01" }));
  const dp = J(PC.dietPlanFromText(readFileSync(join(ROOT, "dieta.txt"), "utf8"), { id: "diet-test", name: "Dieta", validFrom: "2026-01-01" }));

  const call = (env, body, token = TOKEN) => worker.fetch(new Request(API + "/v1/sync", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), env);
  async function backend({ plans = true } = {}) {
    const env = { DB: createD1(), SYNC_TOKEN: TOKEN, PRIMARY_OWNER: "owner-test", LEGACY_TOKEN_ENABLED: "true" };
    await env.DB.exec(SCHEMA);
    if (plans) await call(env, { deviceId: "migrate", cursor: 0, changes: [wp, dp].map(p => ({ ...p, updatedAt: T0 - 86400000 })) });
    return env;
  }
  async function serverRecords(env) {
    const out = []; let cursor = 0;
    for (;;) {
      const j = await (await call(env, { deviceId: "probe", cursor, changes: [] })).json();
      out.push(...j.changes); cursor = j.cursor;
      if (!j.more) return out;
    }
  }
  const find = (list, c, id) => list.find(r => r.collection === c && r.id === id);
  const count = (list, c) => list.filter(r => r.collection === c).length;

  function device(env, { t = T0 } = {}) {
    const events = [];
    const sb = { window: {}, console };
    sb.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init ? init.detail : undefined; } };
    sb.Event = class { constructor(type) { this.type = type; } };
    sb.window.dispatchEvent = (ev) => { events.push(ev); return true; };
    const logs = [];
    sb.window._logError = (e) => { logs.push(String(e && e.message)); };
    vm.createContext(sb);
    for (const [f, code] of sources) vm.runInContext(code, sb, { filename: f });
    const net = { offline: false, requests: [], responses: [], hook: null, transform: null, fake: null };
    const fetchFn = async (url, init) => {
      if (net.offline) throw new TypeError("Failed to fetch");
      net.requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, bytes: init.body ? Buffer.byteLength(init.body) : 0 });
      if (net.fake) { // risposta finta (es. 400 di validazione), il server non vede la richiesta
        const f = net.fake; net.fake = null;
        if (net.hook) { const h = net.hook; net.hook = null; await h(); }
        net.responses.push(f.json);
        return { ok: f.status < 300, status: f.status, json: async () => f.json };
      }
      const res = await worker.fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }), env);
      const json = await res.json();
      if (net.hook) { const h = net.hook; net.hook = null; await h(); }
      const out = net.transform ? net.transform(json) : json;
      net.transform = null;
      net.responses.push(out);
      return { ok: res.ok, status: res.status, json: async () => out };
    };
    const clock = { t };
    const timers = [];
    const SV = sb.window.SyncV2;
    const opts = {
      storage: sb.window.storage, fetch: fetchFn, now: () => clock.t,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    };
    if (SV) SV.init(opts);
    const S = sb.window.storage;
    return {
      sb, S, SV, net, events, timers, clock, logs, reinit: () => SV.init(opts),
      sync: () => SV.syncNow(),
      outbox: () => Object.keys(S.get("v2outbox", {}) || {}),
      sent: (from = 0) => net.requests.slice(from).flatMap(r => (r.body && Array.isArray(r.body.changes) ? r.body.changes : [])),
    };
  }

  const probe = device(await backend({ plans: false }));
  const SV0 = probe.SV;
  ok("syncv2.jsx espone window.SyncV2 con l'interfaccia del piano", !!SV0 && SV0.API === API &&
    ["init", "setToken", "hasToken", "syncNow", "putRecords", "getRecord", "listRecords", "activePlans", "status"].every(k => typeof SV0[k] === "function"));
  if (!SV0) return;

  try {
    // ── A spunta un pasto, B spunta la spesa ──────────────────────────────────
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      const la = await A.SV.setToken(TOKEN), lb = await B.SV.setToken(TOKEN);
      ok("setToken: collega e fa il primo sync (ok)", la.ok && lb.ok && A.SV.hasToken() && B.SV.hasToken());
      ok("primo sync: piani attivi in plan_workout / plan_diet", (A.S.get("plan_workout") || {}).id === wp.id && (B.S.get("plan_diet") || {}).id === dp.id);
      ok("activePlans() = piani attivi locali", A.SV.activePlans().workout.id === wp.id && A.SV.activePlans().diet.id === dp.id);
      const riposo = dp.data.variants.find(v => v.key === "riposo");
      const mealKey = `${riposo.meals[0].time}|${riposo.meals[0].name}`;
      A.S.set(`dietaVariant_${TODAY}`, "riposo");
      A.S.set(`dietaCheck_${TODAY}`, { [mealKey]: true });
      B.S.set("spesaChecked", { "proteine-0": true });
      await tick();
      for (let i = 0; i < 2; i++) { await A.sync(); await B.sync(); }
      ok("due device: A vede la spesa di B", (A.S.get("spesaChecked") || {})["proteine-0"] === true);
      ok("due device: B vede il pasto di A (e la variante)", (B.S.get(`dietaCheck_${TODAY}`) || {})[mealKey] === true && B.S.get(`dietaVariant_${TODAY}`) === "riposo");
      const srv = await serverRecords(env);
      ok("due device: nessun record doppio (1 mealCheck, 1 shoppingCheck, 1 dietVariant)",
        count(srv, "mealCheck") === 1 && count(srv, "shoppingCheck") === 1 && srv.filter(r => r.id === `${TODAY}:dietVariant`).length === 1);
      ok("due device: code vuote e cache uguali al server",
        A.outbox().length === 0 && B.outbox().length === 0 &&
        ["mealCheck", "shoppingCheck", "dayState"].every(c => A.SV.listRecords(c).length === count(srv, c) && B.SV.listRecords(c).length === count(srv, c)));
      ok("getRecord legge la cache", A.SV.getRecord("shoppingCheck", "proteine-0").data.checked === true && A.SV.getRecord("shoppingCheck", "nope") === null);
      ok("evento lfh-data con le chiavi ricostruite", B.events.some(e => e.type === "lfh-data" && e.detail.keys.includes(`dietaCheck_${TODAY}`)));
      ok("_syncState ok + last + evento lfh-sync", A.sb.window._syncState.status === "ok" && A.sb.window._syncState.last === A.clock.t &&
        A.events.some(e => e.type === "lfh-sync") && A.SV.status().status === "ok");
      ok("i device non pushano i record ricevuti (B non rimanda il pasto di A)", !B.sent().some(c => c.collection === "mealCheck"));

      // L'echo dei propri record non riscrive le chiavi locali (round-trip lossy: voce fuori piano).
      A.S.set(`dietaCheck_${TODAY}`, { [mealKey]: false, "99:99|Pasto fuori piano": true });
      await tick(); await A.sync();
      ok("echo dei propri record: la chiave locale resta com'è (niente rebuild)", A.sent().some(c => c.collection === "mealCheck" && c.data.done === false) &&
        A.S.get(`dietaCheck_${TODAY}`)["99:99|Pasto fuori piano"] === true);
      A.S.set(`dietaCheck_${TODAY}`, { [mealKey]: true });
      await tick(); await A.sync(); await B.sync();

      // Dopo una ricostruzione v2grp segue lo stato locale: cancellare una voce arrivata da B la tombstona.
      B.S.set("weightLog", [{ date: daysAgo(1), weight: 80 }, { date: TODAY, weight: 79.5 }]);
      await tick(); await B.sync(); await A.sync();
      ok("ricevuto da B: weightLog ricostruito su A", (A.S.get("weightLog") || []).length === 2);
      A.S.set("weightLog", A.S.get("weightLog").filter(e => e.date !== TODAY));
      await tick();
      ok("voce ricevuta e poi cancellata in locale → tombstone", A.outbox().join() === `bodyWeight/${TODAY}` && A.S.get("v2outbox")[`bodyWeight/${TODAY}`].deleted === true);
      await A.sync(); await B.sync();
      ok("… e sparisce anche sull'altro device", B.S.get("weightLog").map(e => e.date).join() === daysAgo(1));

      // Push debounced 1,5 s dopo una modifica non silenziosa; nessun timer per le scritture silenziose.
      const nT = A.timers.length;
      A.S.set("spesaChecked", { ...A.S.get("spesaChecked"), "verdura-1": true }, { silent: true });
      await tick();
      ok("scrittura silenziosa: niente coda, niente timer", A.outbox().length === 0 && A.timers.length === nT);
      A.S.set("spesaChecked", { ...A.S.get("spesaChecked"), "verdura-1": true });
      A.S.set("spesaChecked", { ...A.S.get("spesaChecked"), "verdura-2": true });
      await tick();
      const live = A.timers.slice(nT).filter(x => x.fn);
      ok("push debounced: un solo timer attivo da 1500 ms", live.length === 1 && live[0].ms === 1500 && A.outbox().length === 2);
      const n0 = A.net.requests.length;
      live[0].fn(); await A.sync();
      ok("timer scaduto → syncNow invia la coda", A.net.requests[n0].body.changes.length === 2 && A.outbox().length === 0);

      // putRecords (piani): nuovo piano attivo + vecchio archiviato → plan_workout subito, e sull'altro device dopo il sync.
      const nwp = { collection: "workoutPlan", id: "workout-new", data: { ...wp.data, name: "Nuova", validFrom: TODAY } };
      const old = { collection: "workoutPlan", id: wp.id, data: { ...wp.data, status: "archived", validTo: TODAY } };
      A.SV.putRecords([nwp, old]);
      ok("putRecords: plan_workout aggiornato subito + lfh-data", A.S.get("plan_workout").id === "workout-new" &&
        A.events.some(e => e.type === "lfh-data" && e.detail.keys.includes("plan_workout")));
      await A.sync(); await B.sync();
      ok("putRecords: l'altro device riceve il nuovo piano attivo", B.S.get("plan_workout").id === "workout-new" && B.SV.activePlans().workout.data.name === "Nuova" &&
        B.SV.getRecord("workoutPlan", wp.id).data.status === "archived");
    }

    // ── offline: coda persistita, poi un solo invio ─────────────────────────────
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      A.net.offline = true;
      A.S.set(`checkIn_${TODAY}`, { sleep: 3, energy: 4, ailments: "" });
      await tick();
      let threw = false, r;
      try { r = await A.sync(); } catch (_) { threw = true; }
      ok("offline: syncNow non lancia, ok:false + stato offline", !threw && !r.ok && r.error === "offline" && A.SV.status().status === "offline");
      ok("offline: coda persistita in v2outbox", A.outbox().join() === `dayState/${TODAY}:checkIn` && A.S.get("v2outbox")[`dayState/${TODAY}:checkIn`].data.value.sleep === 3);
      A.net.offline = false;
      const n0 = A.net.requests.length;
      const r2 = await A.sync();
      const reqs = A.net.requests.slice(n0);
      ok("rete di nuovo ok: un solo invio", r2.ok && r2.pushed === 1 && reqs.length === 1 && reqs[0].body.changes.length === 1);
      ok("rete di nuovo ok: v2outbox vuota", A.outbox().length === 0);
      await A.sync();
      ok("sync successivo: niente da rimandare", A.net.requests[A.net.requests.length - 1].body.changes.length === 0);
      const srv = await serverRecords(env);
      ok("server: check-in presente, una volta", srv.filter(x => x.id === `${TODAY}:checkIn`).length === 1 && find(srv, "dayState", `${TODAY}:checkIn`).data.value.sleep === 3);
    }

    // ── primo sync di un device con dati vecchi ─────────────────────────────────
    {
      const env = await backend();
      const D = daysAgo(2);
      await call(env, { deviceId: "phone", cursor: 0, changes: [
        { collection: "dayState", id: `${D}:checkIn`, data: { date: D, field: "checkIn", value: { sleep: 5, energy: 5, ailments: "" } }, updatedAt: T0 - 1000 },
      ] });
      const B = device(env, { t: T0 + 3600000 });
      B.S.set(`checkIn_${D}`, { sleep: 1, energy: 1, ailments: "vecchio" });
      B.S.set(`hydration_${D}`, 4);
      B.S.set("spesaChecked", { "solo-locale": true });
      await tick();
      ok("non collegato: le modifiche non finiscono in coda (le valuta il primo sync)", B.outbox().length === 0);
      const r = await B.SV.setToken(TOKEN);
      const srv = await serverRecords(env);
      const ci = find(srv, "dayState", `${D}:checkIn`);
      ok("primo sync: B adotta il check-in più recente del server", r.ok && B.S.get(`checkIn_${D}`).sleep === 5 && B.S.get(`checkIn_${D}`).ailments === "");
      ok("primo sync: … e non lo ripusha", ci.deviceId === "phone" && ci.updatedAt === T0 - 1000 && !B.sent().some(c => c.id === `${D}:checkIn`));
      ok("primo sync: i dati solo locali vanno sul server", find(srv, "dayState", `${D}:hydration`).data.value === 4 && find(srv, "shoppingCheck", "solo-locale").data.checked === true);
      ok("primo sync: cursore + indice gruppi salvati", B.S.get("v2cursor") > 0 && JSON.stringify(B.S.get(`v2grp:day:${D}`)) === JSON.stringify([`dayState/${D}:checkIn`, `dayState/${D}:hydration`]));
      B.S.set(`hydration_${D}`, 5);
      await tick();
      ok("dopo il primo sync: una modifica mette in coda solo il record cambiato", B.outbox().join() === `dayState/${D}:hydration`);
    }

    // ── primo sync con una modifica fatta MENTRE il pull è in corso ─────────────
    {
      const env = await backend();
      await call(env, { deviceId: "phone", cursor: 0, changes: [
        { collection: "shoppingCheck", id: "x", data: { checked: false }, updatedAt: T0 - 1000 },
        { collection: "shoppingCheck", id: "y", data: { checked: true }, updatedAt: T0 - 1000 },
      ] });
      const B = device(env, { t: T0 + 3600000 });
      B.S.set("spesaChecked", { x: true, y: true }); // x vecchio di un mese
      await tick();
      // Durante il pull l'utente spunta z (nuovo) e toglie y (che il server ha già).
      B.net.hook = async () => { B.S.set("spesaChecked", { ...B.S.get("spesaChecked"), y: false, z: true }); await tick(); };
      const r = await B.SV.setToken(TOKEN);
      const srv = await serverRecords(env);
      ok("primo sync + modifica in corso: il server tiene x:false (il vecchio x non parte)", r.ok && find(srv, "shoppingCheck", "x").data.checked === false &&
        find(srv, "shoppingCheck", "x").deviceId === "phone" && !B.sent().some(c => c.id === "x"));
      ok("primo sync + modifica in corso: le modifiche vere arrivano (z nuova, y tolta)", find(srv, "shoppingCheck", "z").data.checked === true && find(srv, "shoppingCheck", "y").data.checked === false);
      ok("primo sync + modifica in corso: in locale {x:false, y:false, z:true}", JSON.stringify(B.S.get("spesaChecked")) === JSON.stringify({ x: false, y: false, z: true }) && B.outbox().length === 0);
    }

    // ── modifica locale in coda + record in arrivo più vecchio ──────────────────
    {
      const env = await backend();
      const A = device(env, { t: T0 + 60000 }), B = device(env, { t: T0 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      B.S.set("spesaChecked", { x: true });
      await tick(); await B.sync();
      const seen = [];
      A.S.onChange((k, v) => { if (k === "spesaChecked") seen.push(v && v.x); });
      // La spunta di A arriva mentre la richiesta è in volo: la risposta porta x:true (più vecchia).
      A.net.hook = async () => { A.S.set("spesaChecked", { x: false }); await tick(); };
      const n0 = A.net.requests.length;
      await A.sync();
      ok("pull con modifica in coda: la chiave locale non cambia (mai x:true)", A.S.get("spesaChecked").x === false && !seen.includes(true));
      ok("pull con modifica in coda: il primo giro ha ricevuto il record più vecchio", A.net.responses[A.net.responses.length - 2].changes.some(r => r.id === "x" && r.data.checked === true) &&
        A.net.requests[n0].body.changes.length === 0);
      await B.sync();
      const srv = await serverRecords(env);
      ok("dopo il push vince la locale (server e altro device)", find(srv, "shoppingCheck", "x").data.checked === false && B.S.get("spesaChecked").x === false && A.outbox().length === 0);
    }

    // ── stale + conflicts ───────────────────────────────────────────────────────
    {
      const env = await backend();
      const A = device(env, { t: T0 }), B = device(env, { t: T0 + 60000 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      A.net.offline = true;
      A.S.set("spesaChecked", { y: true });
      await tick(); await A.sync();
      B.S.set("spesaChecked", { y: false });
      await tick(); await B.sync();
      A.net.offline = false;
      A.net.transform = (j) => ({ ...j, changes: [] }); // solo `conflicts` può riallineare
      await A.sync();
      const resp = A.net.responses[A.net.responses.length - 1];
      ok("stale: il server rifiuta la modifica più vecchia e la manda in conflicts", resp.stale === 1 && resp.conflicts.length === 1);
      ok("stale + conflicts: la chiave locale si riallinea al server", A.S.get("spesaChecked").y === false && A.outbox().length === 0);
      ok("stale + conflicts: cache = versione del server", A.SV.getRecord("shoppingCheck", "y").data.checked === false && A.SV.getRecord("shoppingCheck", "y").updatedAt === T0 + 60000);
    }

    // ── modifica dello stesso record mentre il suo change è in volo ─────────────
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      A.S.set("spesaChecked", { q: true });
      await tick();
      A.net.hook = async () => { A.clock.t += 10; A.S.set("spesaChecked", { q: false }); await tick(); };
      const n0 = A.net.requests.length;
      const r = await A.sync();
      const q1 = A.net.requests[n0].body.changes.find(c => c.id === "q"), q2 = (A.net.requests[n0 + 1] || { body: { changes: [] } }).body.changes.find(c => c.id === "q");
      ok("in volo: dopo l'ack la modifica più nuova resta in coda e parte al giro dopo", r.ok && q1 && q1.data.checked === true && q2 && q2.data.checked === false && q2.updatedAt > q1.updatedAt);
      ok("in volo: server = modifica più nuova, coda vuota", find(await serverRecords(env), "shoppingCheck", "q").data.checked === false && A.outbox().length === 0);
    }

    // ── 400 di validazione su changes[i] ───────────────────────────────────────
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      A.SV.putRecords(["a", "b", "c"].map(id => ({ collection: "shoppingCheck", id, data: { checked: true } })));
      A.net.fake = { status: 400, json: { error: "changes[1]: data troppo grande (massimo 65536 byte)" } };
      const r = await A.sync();
      let srv = await serverRecords(env);
      ok("400 changes[1]: solo quella modifica esce dalla coda, le altre arrivano", r.ok && A.outbox().length === 0 &&
        !!find(srv, "shoppingCheck", "a") && !find(srv, "shoppingCheck", "b") && !!find(srv, "shoppingCheck", "c"));
      ok("400 changes[1]: modifica scartata registrata nel log", A.logs.some(m => /rifiutata dal server/.test(m)));
      A.SV.putRecords(["d", "e"].map(id => ({ collection: "shoppingCheck", id, data: { checked: true } })));
      A.net.fake = { status: 400, json: { error: "changes[0]: data non valida" } };
      A.net.hook = async () => { A.SV.putRecords([{ collection: "shoppingCheck", id: "d", data: { checked: false } }]); };
      await A.sync();
      srv = await serverRecords(env);
      ok("400 su una modifica già superata: la versione più nuova sopravvive e arriva", find(srv, "shoppingCheck", "d").data.checked === false &&
        !!find(srv, "shoppingCheck", "e") && A.outbox().length === 0);
      A.S.set("v2outbox", { "boh/1": { collection: "boh", id: "1", data: {}, updatedAt: 1 }, "shoppingCheck/f": { collection: "shoppingCheck", id: "f", data: { checked: true }, updatedAt: T0, deleted: false } }, { silent: true });
      A.reinit();
      ok("loadOutbox: voce non valida scartata con log, le valide restano", A.outbox().join() === "shoppingCheck/f" && A.logs.some(m => /boh\/1 scartata/.test(m)));
    }

    // ── epoch cambiato = primo sync (Ruling 9): cache svuotata, record dopo il backup rimandati ──
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      const OLD = daysAgo(100);
      await call(env, { deviceId: "phone", cursor: 0, changes: [
        { collection: "dayState", id: `${OLD}:checkIn`, data: { date: OLD, field: "checkIn", value: { sleep: 2, energy: 2, ailments: "" } }, updatedAt: T0 - 5000 },
      ] });
      A.S.set("weightLog", [{ date: daysAgo(1), weight: 81 }]);
      await tick(); await A.sync();
      ok("prima del ripristino: fantasma in cache, pesata sul server", !!A.SV.getRecord("dayState", `${OLD}:checkIn`) && !!find(await serverRecords(env), "bodyWeight", daysAgo(1)));
      // Ripristino a prima della pesata e del record del telefono + nuovo epoch.
      await env.DB.prepare("DELETE FROM records WHERE collection IN ('bodyWeight', 'dayState')").run();
      await env.DB.prepare("UPDATE meta SET value = value + 1 WHERE key = 'epoch'").run();
      const r = await A.sync();
      const srv = await serverRecords(env);
      ok("epoch cambiato: il record fantasma sparisce da cache e listRecords", r.ok && A.SV.getRecord("dayState", `${OLD}:checkIn`) === null &&
        !A.SV.listRecords("dayState").some(x => x.id === `${OLD}:checkIn`) && A.S.get(`r:dayState:${OLD}:checkIn`, null) === null);
      ok("epoch cambiato: la pesata fatta dopo il backup viene rimandata", find(srv, "bodyWeight", daysAgo(1)).data.kg === 81 && A.outbox().length === 0);
      ok("epoch cambiato: nuovo epoch, cursore e indice gruppi ricostruiti", A.S.get("v2epoch") === A.net.responses[A.net.responses.length - 1].epoch &&
        A.S.get("v2cursor") > 0 && Array.isArray(A.S.get("v2grp:weights")));
    }

    // ── reset:true ed epoch cambiato ────────────────────────────────────────────
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      A.net.offline = true;
      A.S.set(`notes_${TODAY}`, "nota");
      await tick(); await A.sync();
      A.net.offline = false;
      A.S.set("v2cursor", 999999, { silent: true });
      const total = (await serverRecords(env)).length;
      const n0 = A.net.responses.length;
      const r = await A.sync();
      ok("reset:true (cursore oltre meta.seq) → ripull da 0", A.net.responses[n0].reset === true && r.ok && r.pulled >= total && A.S.get("v2cursor") < 999999);
      let srv = await serverRecords(env);
      ok("reset: la coda non si perde", find(srv, "dayState", `${TODAY}:notes`).data.value === "nota" && A.outbox().length === 0);

      A.net.offline = true;
      A.S.set(`notes_${TODAY}`, "nota 2");
      await tick(); await A.sync();
      A.net.offline = false;
      const ep = A.S.get("v2epoch");
      await env.DB.prepare("UPDATE meta SET value = ? WHERE key = 'epoch'").bind(ep === 4242 ? 4243 : 4242).run();
      const n1 = A.net.requests.length;
      const r2 = await A.sync();
      const reqs = A.net.requests.slice(n1);
      srv = await serverRecords(env);
      ok("epoch cambiato → nuovo epoch salvato e ripull da cursore 0", r2.ok && A.S.get("v2epoch") !== ep && reqs.length >= 2 && reqs[1].body.cursor === 0 && r2.pulled >= srv.length);
      ok("epoch cambiato: la coda è stata inviata, non persa", find(srv, "dayState", `${TODAY}:notes`).data.value === "nota 2" && A.outbox().length === 0);
    }

    // ── Ruling 12: piano cambiato in giornata su B → le serie fatte su A restano sul server ──
    // Scenario riprodotto in review: A spunta 2 serie di Giorno 1#0 e sincronizza; B importa un
    // piano che sostituisce quell'esercizio (vecchio archiviato); A riceve il piano, la Scheda
    // pulisce i progressi (sanitizeSchedaProg, scrittura NON silenziosa come scheda.jsx) e sincronizza.
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      const W = A.sb.window;
      const days = W.getSchedule().days;
      const exK = W.exId("Giorno 1", 0);
      W.writeSchedaProg(A.S, TODAY, { completion: { [exK]: [true, true, false] }, pesos: { [exK]: ["", "", ""] } },
        { names: { [exK]: W.schedaNameAt(days, exK).name }, sig: W.schedaPlanSig(days) });
      await tick(); A.clock.t += 1000; await A.sync();
      const oldEx = wp.data.days[0].exercises[0].id;
      const doneIds = [0, 1].map(i => `${TODAY}:${oldEx}:${i}`);
      let srv = await serverRecords(env);
      ok("piano cambiato: prima, le 2 serie fatte di A sono sul server", doneIds.every(id => { const r = find(srv, "setLog", id); return r && !r.deleted && r.data.done === true; }));

      const txt2 = readFileSync(join(ROOT, "scheda.txt"), "utf8").replace("Push-up (bodyweight)", "Panca piana manubri");
      const np = J(PC.workoutPlanFromText(txt2, { id: "workout-new", name: "Nuova", validFrom: TODAY }));
      const prevPlan = B.S.get("plan_workout");
      B.SV.putRecords([{ collection: "workoutPlan", id: np.id, data: np.data },
        { collection: "workoutPlan", id: prevPlan.id, data: { ...prevPlan.data, status: "archived", validTo: TODAY } }]);
      B.clock.t += 2000; await B.sync();
      A.clock.t += 5000; await A.sync();
      ok("piano cambiato: A riceve il nuovo piano", A.S.get("plan_workout").id === "workout-new");

      const n0 = A.net.requests.length;
      const curDays = W.getSchedule().days;
      const res = W.sanitizeSchedaProg(W.readSchedaProg(A.S, TODAY), curDays, W.schedaPlanSig(curDays));
      ok("piano cambiato: la Scheda scarta le spunte dell'esercizio sostituito", res.changed && !(res.prog.completion || {})[exK]);
      A.S.set(W.schedaProgKey(TODAY), res.prog);
      await tick(); A.clock.t += 1000; await A.sync();
      ok("piano cambiato: nessun tombstone setLog inviato da A", !A.sent(n0).some(c => c.collection === "setLog" && c.deleted));
      srv = await serverRecords(env);
      ok("piano cambiato: le serie fatte restano sul server (done, non cancellate)",
        doneIds.every(id => { const r = find(srv, "setLog", id); return r && !r.deleted && r.data.done === true; }));
      ok("piano cambiato: restano anche in listRecords (storico locale) su A e B",
        [A, B].every(d => doneIds.every(id => d.SV.listRecords("setLog").some(r => r.id === id && !r.deleted && r.data.done === true))));
      ok("piano cambiato: v2grp sets non contiene più gli id del vecchio esercizio",
        !(A.S.get(`v2grp:sets:${TODAY}`) || []).some(k => k.includes(oldEx)));
      // Un giro successivo (altra modifica del giorno) non li considera nemmeno.
      const ex2 = W.exId("Giorno 1", 1);
      W.writeSchedaProg(A.S, TODAY, { completion: { [ex2]: [true, false] } }, { names: { [ex2]: W.schedaNameAt(curDays, ex2).name }, sig: W.schedaPlanSig(curDays) });
      await tick(); A.clock.t += 1000; const n1 = A.net.requests.length; await A.sync();
      ok("piano cambiato: modifiche successive → ancora nessun tombstone", !A.sent(n1).some(c => c.deleted) &&
        doneIds.every(id => !find(B.SV.listRecords("setLog"), "setLog", id).deleted));
      // Ruling 64: nemmeno una serie di un esercizio DEL piano attivo tolta dai progressi va in tombstone.
      const p3 = W.readSchedaProg(A.S, TODAY);
      const comp3 = { ...p3.completion }; delete comp3[ex2];
      A.S.set(W.schedaProgKey(TODAY), { ...p3, completion: comp3, pesos: {}, substitutions: {} });
      await tick();
      ok("esercizio del piano attivo tolto dai progressi → nessun tombstone (Ruling 64)",
        !Object.entries(A.S.get("v2outbox") || {}).some(([k, c]) => k.startsWith("setLog/") && c.deleted));
      await A.sync();
    }

    // ── Ruling 37 (fase 3): piano attivato dall'app durante il giorno → storico di oggi senza doppioni ──
    // B simula l'app: logga 2 serie di un esercizio sul piano P1, poi attiva P2 (stessi esercizi, id nuovi).
    // A (PWA) ha il progresso di oggi (ricostruito da P1), riceve P2 e alla prima apertura della Scheda
    // sanifica e sincronizza: ogni serie di oggi deve comparire UNA volta sola per nome esercizio.
    for (const variant of ["stessa posizione", "posizione diversa", "serie non fatta nell'app"]) {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      await A.sync(); await B.sync();
      const W = A.sb.window;
      const p1 = A.S.get("plan_workout");
      const ex0 = p1.data.days[0].exercises[0];
      B.SV.putRecords([0, 1].map(i => ({ collection: "setLog", id: `${TODAY}:${ex0.id}:${i}`, data: { date: TODAY, exerciseId: ex0.id, exerciseName: ex0.name, planId: p1.id, setIndex: i, weight: "20", reps: 8, done: !(variant === "serie non fatta nell'app" && i === 1), substitutedWith: null } })));
      B.clock.t += 1000; await B.sync(); A.clock.t += 2000; await A.sync();
      ok(`ruling 37 (${variant}): A ricostruisce il progresso di oggi da P1`, ((W.readSchedaProg(A.S, TODAY).completion || {})[W.exId("Giorno 1", 0)] || [])[0] === true);
      // P2: stessi esercizi con id nuovi; nel caso "posizione diversa" i primi due esercizi si scambiano.
      const np = J(PC.workoutPlanFromText(readFileSync(join(ROOT, "scheda.txt"), "utf8"), { id: "workout-p2", name: "P2", validFrom: TODAY }));
      if (variant === "posizione diversa") { const e = np.data.days[0].exercises; [e[0], e[1]] = [e[1], e[0]]; }
      B.SV.putRecords([{ collection: "workoutPlan", id: np.id, data: np.data }, { collection: "workoutPlan", id: p1.id, data: { ...p1.data, status: "archived", validTo: TODAY } }]);
      B.clock.t += 2000; await B.sync(); A.clock.t += 5000; await A.sync();
      const curDays = W.getSchedule().days;
      const res = W.sanitizeSchedaProg(W.readSchedaProg(A.S, TODAY), curDays, W.schedaPlanSig(curDays));
      A.S.set(W.schedaProgKey(TODAY), res.prog); // come scheda.jsx al mount
      if (variant === "serie non fatta nell'app") { // la PWA spunta la serie 1 sotto l'id nuovo: deve arrivare (l'off-plan è done:false)
        const k0 = W.exId("Giorno 1", 0), pr = W.readSchedaProg(A.S, TODAY), comp = { ...(pr.completion || {}) };
        comp[k0] = [...(comp[k0] || [])]; comp[k0][1] = true;
        W.writeSchedaProg(A.S, TODAY, { ...pr, completion: comp }, { names: { [k0]: W.schedaNameAt(curDays, k0).name }, sig: W.schedaPlanSig(curDays) });
      }
      await tick(); A.clock.t += 1000; await A.sync(); B.clock.t += 2000; await B.sync();
      const srv = await serverRecords(env);
      const doneToday = srv.filter(r => r.collection === "setLog" && !r.deleted && r.data.date === TODAY && r.data.done === true && r.data.exerciseName === ex0.name);
      ok(`ruling 37 (${variant}): lo storico di oggi conta ogni serie una volta (2, trovate ${doneToday.length})`, doneToday.length === 2);
    }

    // ── Ruling 31 (fase 3): ripetizioni registrate dall'app nativa → la PWA non le azzera ──
    // L'app (qui B via putRecords) salva setLog con reps; A riceve, poi spunta un'altra serie dello
    // stesso esercizio: il gruppo sets si ricalcola (reps null lato PWA) ma il record resta con reps.
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      await A.sync(); await B.sync();
      const W = A.sb.window;
      const days = W.getSchedule().days;
      const ex0 = wp.data.days[0].exercises[0];
      const id0 = `${TODAY}:${ex0.id}:0`;
      B.SV.putRecords([{ collection: "setLog", id: id0, data: { date: TODAY, exerciseId: ex0.id, exerciseName: ex0.name,
        planId: wp.id, setIndex: 0, weight: "60", reps: 8, done: true, substitutedWith: null } }]);
      B.clock.t += 1000; await B.sync();
      A.clock.t += 2000; await A.sync();
      const exK = W.exId("Giorno 1", 0);
      const p0 = W.readSchedaProg(A.S, TODAY);
      ok("reps dall'app: A ricostruisce la serie spuntata", (p0.completion || {})[exK] && p0.completion[exK][0] === true);
      const comp = { ...(p0.completion || {}) }; comp[exK] = [true, true];
      const pes = { ...(p0.pesos || {}) }; pes[exK] = ["60", "60"];
      W.writeSchedaProg(A.S, TODAY, { completion: comp, pesos: pes }, { names: { [exK]: W.schedaNameAt(days, exK).name }, sig: W.schedaPlanSig(days) });
      await tick(); A.clock.t += 1000; await A.sync();
      const srv = await serverRecords(env);
      const r0 = find(srv, "setLog", id0), r1 = find(srv, "setLog", `${TODAY}:${ex0.id}:1`);
      ok("reps dall'app: dopo una modifica della PWA nello stesso giorno le ripetizioni restano (8)", r0 && r0.data.reps === 8 && r0.data.done === true);
      ok("reps dall'app: la serie nuova della PWA arriva con reps null", r1 && r1.data.done === true && r1.data.reps === null);
      ok("carryOver: solo setLog con reps null, il resto invariato",
        A.sb.window.RecordMap.carryOver("setLog", { reps: 5 }, { reps: null, done: true }).reps === 5 &&
        A.sb.window.RecordMap.carryOver("setLog", { reps: 5 }, { reps: 7 }).reps === 7 &&
        A.sb.window.RecordMap.carryOver("mealCheck", { reps: 5 }, { done: true }).reps === undefined);
    }

    // ── Ruling 62: la spunta su una serie non riscrive le altre del gruppo ──
    // B non ha visto le serie di A e spunta la terza dello stesso esercizio; poi un peso digitato senza spunta.
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      await A.sync(); await B.sync();
      const WA = A.sb.window, WB = B.sb.window;
      const days = WA.getSchedule().days, exK = WA.exId("Giorno 1", 0), ex0 = wp.data.days[0].exercises[0];
      const meta = { names: { [exK]: WA.schedaNameAt(days, exK).name }, sig: WA.schedaPlanSig(days) };
      const id = (i) => `${TODAY}:${ex0.id}:${i}`;
      WA.writeSchedaProg(A.S, TODAY, { completion: { [exK]: [true, true, false] }, pesos: { [exK]: ["55", "56", ""] } }, meta);
      await tick(); A.clock.t += 1000; await A.sync();
      ok("Ruling 62: A manda solo le due serie fatte", A.sent().filter(c => c.collection === "setLog").length === 2);

      WB.writeSchedaProg(B.S, TODAY, { completion: { [exK]: [false, false, true] }, pesos: { [exK]: ["", "", "30"] } }, meta);
      await tick(); B.clock.t += 2000; await B.sync();
      A.clock.t += 3000; await A.sync();
      const srv = await serverRecords(env);
      ok("Ruling 62: la spunta di B non annulla le serie di A", [0, 1].every(i => { const r = find(srv, "setLog", id(i)); return r && r.data.done === true; }), JSON.stringify(srv.filter(r => r.collection === "setLog").map(r => r.data)));
      ok("Ruling 62: i pesi di A restano", find(srv, "setLog", id(0)).data.weight === "55" && find(srv, "setLog", id(1)).data.weight === "56");
      ok("Ruling 62: arriva anche la serie di B, col suo peso", find(srv, "setLog", id(2)).data.done === true && find(srv, "setLog", id(2)).data.weight === "30");
      const pa = WA.readSchedaProg(A.S, TODAY), pb = WB.readSchedaProg(B.S, TODAY);
      ok("Ruling 62: le tre serie sono fatte su entrambi i device", [pa, pb].every(p => p.completion[exK].every(Boolean)), JSON.stringify([pa.completion, pb.completion]));

      // sanitize riempie le serie mancanti: nessun record nuovo, nemmeno al primo gesto dopo.
      const n0 = B.net.requests.length;
      const exK2 = WB.exId("Giorno 1", 1);
      WB.writeSchedaProg(B.S, TODAY, { pesos: { [exK2]: ["70", "", ""] } }, { names: { [exK2]: WB.schedaNameAt(days, exK2).name }, sig: WB.schedaPlanSig(days) });
      await tick(); B.clock.t += 1000; await B.sync();
      const typed = B.sent(n0).filter(c => c.collection === "setLog");
      ok("Ruling 62: peso digitato senza spunta si sincronizza, una serie sola", typed.length === 1 && typed[0].data.weight === "70" && typed[0].data.done === false, JSON.stringify(typed.map(c => c.data)));
      const fill = WB.sanitizeSchedaProg({ completion: { [exK2]: [true] }, substitutions: {}, pesos: {}, names: { [exK2]: WB.schedaNameAt(days, exK2).name }, sig: null }, days, WB.schedaPlanSig(days));
      ok("Ruling 62: sanitize riempie con false, senza segnare serie toccate", fill.prog.completion[exK2].length === days[0].exercises[1].sets.length && fill.prog.completion[exK2].filter(Boolean).length === 1);
      const src = readFileSync(join(ROOT, "screens", "scheda.jsx"), "utf8");
      ok("Ruling 62: le pulizie di sanitize in Scheda sono silenziose", (src.match(/schedaProgKey\(dayK\), res\.prog, \{ silent: true \}/g) || []).length === 2 && !/schedaProgKey\(dayK\), res\.prog\)/.test(src));
    }

    // ── Ruling 64: il gruppo sets: non tombstona mai un setLog ──
    // A fa le serie, C (l'app) cambia la struttura del piano attivo con gli stessi id, B riceve il piano, apre la
    // Scheda e fa un gesto. Gli id esercizio restano, le posizioni no: il blocco di B va rifatto dai record.
    for (const variant of ["scambio", "inserito in alto", "una serie in meno"]) {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 }), C = device(env, { t: T0 + 7 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN); await C.SV.setToken(TOKEN);
      await A.sync(); await B.sync(); await C.sync();
      const WA = A.sb.window, WB = B.sb.window;
      const days = WA.getSchedule().days, k0 = WA.exId("Giorno 1", 0), k1 = WA.exId("Giorno 1", 1);
      const plan0 = C.S.get("plan_workout"), [e0, e1, e2] = plan0.data.days[0].exercises;
      const names = { [k0]: e0.name.toLowerCase(), [k1]: e1.name.toLowerCase() };
      const all = (n, v) => new Array(n).fill(v);
      WA.writeSchedaProg(A.S, TODAY, { completion: { [k0]: all(e0.sets, true), [k1]: all(e1.sets, true) }, pesos: { [k0]: all(e0.sets, "55"), [k1]: all(e1.sets, "66") } },
        { names, sig: WA.schedaPlanSig(days) });
      await tick(); A.clock.t += 1000; await A.sync();
      B.clock.t += 2000; await B.sync();
      const doneIds = [...all(e0.sets, 0).map((_, i) => `${TODAY}:${e0.id}:${i}`), ...all(e1.sets, 0).map((_, i) => `${TODAY}:${e1.id}:${i}`)];
      const alive = async () => { const srv = await serverRecords(env); return doneIds.every(id => { const r = find(srv, "setLog", id); return r && !r.deleted && r.data.done === true; }); };
      ok(`Ruling 64 (${variant}): prima le serie sono sul server`, await alive());

      const p1 = J(plan0), ex = p1.data.days[0].exercises;
      if (variant === "scambio") [ex[0], ex[1]] = [ex[1], ex[0]];
      else if (variant === "inserito in alto") ex.unshift({ ...J(ex[2]), id: `${ex[0].id}-nuovo`, name: "Esercizio nuovo" });
      else ex[0].sets = e0.sets - 1;
      C.SV.putRecords([{ collection: "workoutPlan", id: p1.id, data: p1.data }]);
      C.clock.t += 3000; await C.sync();
      B.clock.t += 5000; await B.sync();
      ok(`Ruling 64 (${variant}): B riceve il piano`, JSON.stringify(B.S.get("plan_workout").data) === JSON.stringify(p1.data));

      // B apre la Scheda: stessa pulizia del mount, silenziosa.
      const cur = WB.getSchedule().days, sig = WB.schedaPlanSig(cur);
      const opened = WB.sanitizeSchedaProg(WB.readSchedaProg(B.S, TODAY), cur, sig);
      if (opened.changed) B.S.set(WB.schedaProgKey(TODAY), opened.prog, { silent: true });
      const pos = (id) => p1.data.days[0].exercises.findIndex(e => e.id === id);
      const kOf = (id) => WB.exId("Giorno 1", pos(id));
      const shown = (id) => (opened.prog.completion[kOf(id)] || []);
      ok(`Ruling 64 (${variant}): la Scheda di B mostra le serie fatte al posto giusto`,
        shown(e0.id).length === ex[pos(e0.id)].sets && shown(e0.id).every(Boolean) && shown(e1.id).length === e1.sets && shown(e1.id).every(Boolean) &&
        (opened.prog.pesos[kOf(e0.id)] || [])[0] === "55" && (opened.prog.pesos[kOf(e1.id)] || [])[0] === "66", JSON.stringify(opened.prog));

      // Gesto su un altro esercizio.
      const kOther = WB.exId("Giorno 1", pos(e2.id));
      const meta = (k) => ({ names: { [k]: WB.schedaNameAt(cur, k).name }, sig });
      const n0 = B.net.requests.length;
      WB.writeSchedaProg(B.S, TODAY, { pesos: { [kOther]: WB.schedaPesoAt(undefined, e2.sets, 0, "70") } }, meta(kOther));
      await tick(); B.clock.t += 1000; await B.sync();
      ok(`Ruling 64 (${variant}): il gesto su un altro esercizio manda una serie sola, nessun tombstone`,
        B.sent(n0).filter(c => c.collection === "setLog").length === 1 && !B.sent(n0).some(c => c.deleted), JSON.stringify(B.sent(n0).map(c => [c.id, c.deleted])));
      ok(`Ruling 64 (${variant}): dopo il gesto le serie sono vive e fatte sul server`, await alive());

      // Gesto sullo stesso esercizio: un peso corretto sulla prima serie non annulla le altre.
      const n1 = B.net.requests.length, kE = kOf(e0.id);
      WB.writeSchedaProg(B.S, TODAY, { pesos: { [kE]: WB.schedaPesoAt(WB.readSchedaProg(B.S, TODAY).pesos[kE], ex[pos(e0.id)].sets, 0, "56") } }, meta(kE));
      await tick(); B.clock.t += 1000; await B.sync();
      const srv = await serverRecords(env);
      ok(`Ruling 64 (${variant}): il gesto sullo stesso esercizio cambia solo quella serie`,
        B.sent(n1).filter(c => c.collection === "setLog").map(c => c.id).join() === `${TODAY}:${e0.id}:0` && find(srv, "setLog", `${TODAY}:${e0.id}:0`).data.done === true && find(srv, "setLog", `${TODAY}:${e0.id}:0`).data.weight === "56" && await alive(),
        JSON.stringify(B.sent(n1).map(c => [c.id, c.deleted, c.data && c.data.done])));
      ok(`Ruling 64 (${variant}): nessun doppione sotto id name:`, !srv.some(r => r.collection === "setLog" && r.id.includes(":name:")));
      const hist = B.SV.listRecords("setLog").filter(r => !r.deleted && r.data.done === true && doneIds.includes(r.id)).length;
      ok(`Ruling 64 (${variant}): lo storico conta tutte le serie fatte`, hist === doneIds.length, `${hist} su ${doneIds.length}`);

      // Spunta tolta: resta done:false, mai tombstone.
      const n2 = B.net.requests.length;
      const comp = (WB.readSchedaProg(B.S, TODAY).completion[kE] || []).slice(); comp[1] = false;
      WB.writeSchedaProg(B.S, TODAY, { completion: { [kE]: comp } }, meta(kE));
      await tick(); B.clock.t += 1000; await B.sync();
      const off = find(await serverRecords(env), "setLog", `${TODAY}:${e0.id}:1`);
      ok(`Ruling 64 (${variant}): spunta tolta = done:false, vivo, col suo peso`, off && !off.deleted && off.data.done === false && off.data.weight === "55" && !B.sent(n2).some(c => c.deleted), JSON.stringify(off));
    }

    // Blocco tolto del tutto: i setLog restano vivi lo stesso.
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN); await A.sync();
      const W = A.sb.window, days = W.getSchedule().days, k0 = W.exId("Giorno 1", 0);
      W.writeSchedaProg(A.S, TODAY, { completion: { [k0]: [true, true] }, pesos: { [k0]: ["55", "55"] } }, { names: { [k0]: W.schedaNameAt(days, k0).name }, sig: W.schedaPlanSig(days) });
      await tick(); A.clock.t += 1000; await A.sync();
      const n0 = A.net.requests.length;
      A.S.remove(W.schedaProgKey(TODAY));
      await tick(); A.clock.t += 1000; await A.sync();
      ok("Ruling 64: nemmeno togliere tutto il blocco tombstona i setLog", !A.sent(n0).some(c => c.collection === "setLog" && c.deleted) && A.SV.listRecords("setLog").filter(r => !r.deleted && r.data.date === TODAY).length === 2);
    }

    // ── Task 17 (fase 3): cardio importato da Salute dall'app nativa (`value.id` = "hk-<uuid>") ──
    // La PWA lo mostra in `activities`, ma il suo gruppo cardio prende solo id numerici: aggiungere un'attività
    // non lo duplica (nessun `${date}:cardio:<ms>` nuovo per lui) e non lo tombstona.
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      await A.sync(); await B.sync();
      const hkId = `${TODAY}:cardio:hk-6f1c7b3a-0000-4000-8000-00000000abcd`;
      const value = { id: "hk-6f1c7b3a-0000-4000-8000-00000000abcd", type: "camminata", min: 35, km: 3.1, note: "", startedAt: T0 - 3600000 };
      B.SV.putRecords([{ collection: "dayState", id: hkId, data: { date: TODAY, field: "cardio", value } }]);
      B.clock.t += 1000; await B.sync();
      A.clock.t += 2000; await A.sync();
      const acts = A.S.get("activities", []);
      ok("cardio da Salute: la PWA lo mostra fra le attività", acts.some(a => a.id === value.id && a.type === "camminata" && a.min === 35));
      A.S.set("activities", [{ type: "walk", min: 20, km: 1.5, note: "", id: T0 + 10, when: "Oggi" }, ...acts]);
      await tick();
      ok("cardio da Salute: una nuova attività della PWA mette in coda solo la sua", A.outbox().join() === `dayState/${TODAY}:cardio:${T0 + 10}`);
      A.clock.t += 1000; await A.sync();
      const srv = await serverRecords(env);
      ok("cardio da Salute: sul server resta vivo e senza doppioni", !find(srv, "dayState", hkId).deleted &&
        srv.filter(r => r.collection === "dayState" && r.id.startsWith(`${TODAY}:cardio:`) && !r.deleted).length === 2);
    }

    // ── cardio da Salute: ordinamento per startedAt / data del record (id non numerico) ──
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      await A.sync(); await B.sync();
      const hk = (u, extra) => ({ collection: "dayState", id: `${TODAY}:cardio:hk-${u}`, data: { date: TODAY, field: "cardio", value: { id: `hk-${u}`, type: "camminata", min: 20, km: 1, note: "", ...extra } } });
      B.SV.putRecords([hk("a", { startedAt: T0 - 86400000 * 2 }), hk("b", {})]);
      B.clock.t += 1000; await B.sync(); A.clock.t += 2000; await A.sync();
      const acts = A.S.get("activities", []);
      ok("cardio da Salute: ordinato per startedAt, senza startedAt per data del record (mai NaN/in fondo)", acts.length === 2 && acts[0].id === "hk-b" && acts[1].id === "hk-a");
      const old = []; for (let i = 0; i < 49; i++) { const id = T0 - 86400000 * 3 - i * 1000; old.push({ collection: "dayState", id: `${dateOf(id)}:cardio:${id}`, data: { date: dateOf(id), field: "cardio", value: { type: "walk", min: 10, km: 1, note: "", id } } }); }
      B.SV.putRecords(old); B.clock.t += 3000; await B.sync();
      const C = device(env, { t: T0 + 9 });
      await C.SV.setToken(TOKEN); C.clock.t += 5000; await C.sync();
      const cacts = C.S.get("activities", []);
      ok("cardio da Salute: restano nella finestra delle 50 (le più recenti) anche con molte attività vecchie", cacts.length === 50 && cacts.slice(0, 2).every(a => String(a.id).startsWith("hk-")));
    }

    // ── Coach: indici stabili (>40 messaggi, indici non contigui da un altro device) ──
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      await A.sync(); await B.sync();
      const key = `coachChat_${TODAY}`;
      const chat = []; for (let i = 0; i < 45; i++) chat.push({ role: i % 2 ? "assistant" : "user", text: `m${i}` });
      A.S.set(key, chat); await tick(); await A.sync();
      B.clock.t += 1000; await B.sync();
      const got = B.S.get(key, []);
      ok("coach: oltre 40 messaggi, tutti sincronizzati con indice stabile", got.length === 45 && got[44].index === 44 && got[0].index === 0);
      // B aggiunge un messaggio: indice 45, nessun record riscritto e nessun tombstone
      B.S.set(key, [...got, { role: "user", text: "nuovo" }]); await tick();
      ok("coach: un messaggio nuovo mette in coda solo il suo record", B.outbox().join() === `coachMessage/${TODAY}:45`);
      B.clock.t += 1000; await B.sync();
      // indici non contigui (app nativa): 0,1,5 sopravvivono a una modifica della PWA
      const env2 = await backend();
      const C = device(env2), D2 = device(env2, { t: T0 + 5 });
      await C.SV.setToken(TOKEN); await D2.SV.setToken(TOKEN);
      await C.sync(); await D2.sync();
      C.SV.putRecords([0, 1, 5].map(i => ({ collection: "coachMessage", id: `${TODAY}:${i}`, data: { date: TODAY, index: i, role: "user", text: `n${i}` } })));
      C.clock.t += 1000; await C.sync(); D2.clock.t += 2000; await D2.sync();
      const g2 = D2.S.get(key, []);
      D2.S.set(key, [...g2, { role: "assistant", text: "risposta" }]); await tick();
      ok("coach: indici non contigui preservati, nuovo = max+1", D2.outbox().join() === `coachMessage/${TODAY}:6`);
      D2.clock.t += 1000; await D2.sync();
      const srv2 = await serverRecords(env2);
      ok("coach: nessun tombstone né rinumerazione sul server", [0, 1, 5, 6].every(i => !find(srv2, "coachMessage", `${TODAY}:${i}`).deleted && find(srv2, "coachMessage", `${TODAY}:${i}`).data) &&
        find(srv2, "coachMessage", `${TODAY}:5`).data.text === "n5");
    }

    // ── finestre locali: weightLog oltre 90 voci, sweep silenzioso, cardio, noTouch ──
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      const log = [];
      for (let i = 90; i >= 1; i--) log.push({ date: daysAgo(i), weight: 80 + i / 10 });
      A.S.set("weightLog", log);
      A.S.set(`checkIn_${daysAgo(3)}`, { sleep: 3, energy: 3, ailments: "" });
      await tick(); await A.sync();
      ok("finestre: 90 pesate sul server", count(await serverRecords(env), "bodyWeight") === 90);
      const n0 = A.net.requests.length;
      A.S.set("weightLog", log.slice(1).concat([{ date: TODAY, weight: 79 }]));
      await tick();
      ok("weightLog oltre 90 voci: in coda solo la nuova pesata", A.outbox().join() === `bodyWeight/${TODAY}`);
      await A.sync();
      A.S.remove(`checkIn_${daysAgo(3)}`, { silent: true }); // come lo sweep
      await tick(); await A.sync();
      ok("finestra + sweep silenzioso: nessun tombstone inviato", !A.sent(n0).some(c => c.deleted));
      let srv = await serverRecords(env);
      ok("la pesata uscita dalla finestra e il check-in spazzato restano sul server",
        !find(srv, "bodyWeight", daysAgo(90)).deleted && !find(srv, "dayState", `${daysAgo(3)}:checkIn`).deleted);

      A.S.set("weightLog", A.S.get("weightLog").filter(e => e.date !== daysAgo(5)));
      await tick();
      const ob = A.S.get("v2outbox");
      ok("pesata cancellata dentro la finestra → tombstone (deleted, data null)", A.outbox().join() === `bodyWeight/${daysAgo(5)}` && ob[`bodyWeight/${daysAgo(5)}`].deleted === true && ob[`bodyWeight/${daysAgo(5)}`].data === null);
      await A.sync();
      // Ruling 15: sotto il limite (89 voci) anche la pesata più vecchia cancellata è un tombstone;
      // quella uscita prima dalla finestra (daysAgo(90)) resta sul server.
      A.S.set("weightLog", A.S.get("weightLog").filter(e => e.date !== daysAgo(89)));
      await tick();
      ok("sotto il limite: cancellare la pesata più vecchia → tombstone (solo quella)", A.outbox().join() === `bodyWeight/${daysAgo(89)}` && A.S.get("v2outbox")[`bodyWeight/${daysAgo(89)}`].deleted === true);
      await A.sync();
      srv = await serverRecords(env);
      ok("… cancellata sul server, la pesata uscita dalla finestra resta", find(srv, "bodyWeight", daysAgo(89)).deleted && !find(srv, "bodyWeight", daysAgo(90)).deleted);
      A.S.set("bodyMeasures", [{ date: daysAgo(20), vita: 85 }, { date: daysAgo(10), vita: 84 }]);
      await tick(); await A.sync();
      A.S.set("bodyMeasures", [{ date: daysAgo(10), vita: 84 }]);
      await tick();
      ok("misure sotto il limite: cancellare la più vecchia → tombstone", A.outbox().join() === `bodyMeasure/${daysAgo(20)}` && A.S.get("v2outbox")[`bodyMeasure/${daysAgo(20)}`].deleted === true);
      await A.sync();

      const act = { type: "walk", min: 30, km: 2.5, note: "", id: T0, when: "Oggi" };
      A.S.set("activities", [act]);
      await tick();
      ok("nuova attività: 60 gruppi cardio ricalcolati, in coda solo il record nuovo", A.outbox().join() === `dayState/${TODAY}:cardio:${T0}`);
      await A.sync();
      A.S.set("activities", [{ ...act, id: T0 + 1 }, act]);
      await tick();
      ok("seconda attività: i gruppi invariati non producono change", A.outbox().join() === `dayState/${TODAY}:cardio:${T0 + 1}`);
      await A.sync();

      const riposo = dp.data.variants.find(v => v.key === "riposo");
      const mealKey = `${riposo.meals[0].time}|${riposo.meals[0].name}`;
      A.S.set(`dietaCheck_${TODAY}`, { [mealKey]: true });
      await tick(); await A.sync();
      const grp = JSON.stringify(A.S.get(`v2grp:meals:${TODAY}`));
      const plan = A.S.get("plan_diet");
      A.S.remove("plan_diet", { silent: true });
      A.S.set(`dietaCheck_${TODAY}`, {});
      await tick();
      ok("noTouch (gruppo senza piano): niente tombstone e v2grp intatto", A.outbox().length === 0 && JSON.stringify(A.S.get(`v2grp:meals:${TODAY}`)) === grp && grp.includes("mealCheck/"));
      A.S.set("plan_diet", plan, { silent: true });
      srv = await serverRecords(env);
      ok("finestre: nessun tombstone oltre quelli voluti", srv.filter(r => r.deleted).map(r => `${r.collection}/${r.id}`).sort().join() ===
        [`bodyMeasure/${daysAgo(20)}`, `bodyWeight/${daysAgo(5)}`, `bodyWeight/${daysAgo(89)}`].sort().join());
    }

    // ── token assente o 401 ─────────────────────────────────────────────────────
    {
      const env = await backend();
      const A = device(env);
      const r0 = await A.sync();
      ok("senza token: status unlinked, nessuna richiesta", !r0.ok && r0.error === "unlinked" && A.SV.status().status === "unlinked" && A.net.requests.length === 0);
      await A.SV.setToken(TOKEN);
      A.net.offline = true;
      A.S.set(`notes_${TODAY}`, "x");
      await tick(); await A.sync();
      A.net.offline = false;
      env.SYNC_TOKEN = "ff".repeat(32);
      let threw = false, r;
      try { r = await A.sync(); } catch (_) { threw = true; }
      ok("401: status expired, nessuna eccezione, coda intatta, token tenuto", !threw && !r.ok && r.error === "unauthorized" && A.SV.status().status === "expired" && A.outbox().length === 1 && A.SV.hasToken());
      A.S.remove("syncToken");
      const r2 = await A.sync();
      ok("token rimosso: status unlinked, coda intatta", !r2.ok && r2.error === "unlinked" && A.SV.status().status === "unlinked" && A.outbox().length === 1);
      const bad = await A.SV.setToken("00".repeat(32));
      ok("setToken con token rifiutato (401): ok:false e token non salvato", !bad.ok && bad.error === "unauthorized" && !A.SV.hasToken());
      env.SYNC_TOKEN = TOKEN;
      const good = await A.SV.setToken(TOKEN);
      ok("setToken giusto: la coda parte", good.ok && A.outbox().length === 0 && find(await serverRecords(env), "dayState", `${TODAY}:notes`).data.value === "x");
    }

    // ── account (Task 9C): claim col token legacy, accesso su un altro device, uscita, sessione revocata ──
    {
      const env = await backend();
      env.PASSWORD_PEPPER = "7e57".repeat(16);   // pepper di test (pubblico), mai quello vero
      env.PRIMARY_OWNER = "owner-test";
      const PW = "password-di-prova-1", PW2 = "password-nuova-22", EMAIL = "lorenzo@example.test";
      const A = device(env), B = device(env, { t: T0 + 5 }), C = device(env, { t: T0 + 9 });
      ok("SyncV2 espone login/claim/logout/changePassword/accountInfo/account", ["login", "claim", "logout", "changePassword", "accountInfo", "account"].every(k => typeof A.SV[k] === "function"));
      ok("#sync=: linkTokenFromHash/consumeLinkHash non esistono più", A.SV.linkTokenFromHash === undefined && A.SV.consumeLinkHash === undefined);
      ok("account(): device mai collegato → non collegato, nessuna email", (() => { const a = A.SV.account(); return !a.linked && !a.legacy && a.email === null && !a.expired; })());
      ok("claim senza token legacy → claimUnavailable, nessuna richiesta", (await A.SV.claim(EMAIL, PW)).error === "claimUnavailable" && A.net.requests.length === 0);
      await A.SV.setToken(TOKEN);
      await C.SV.setToken(TOKEN);
      ok("account(): collegato col token legacy → legacy", (() => { const a = A.SV.account(); return a.linked && a.legacy && a.email === null; })());
      const me0 = await A.SV.accountInfo();
      ok("accountInfo() col token legacy prima del claim: email null (claim possibile)", me0.ok && me0.email === null && me0.ownerId === "owner-test");
      ok("accountInfo(): GET /v1/me senza corpo", A.net.requests.some(r => r.method === "GET" && r.url.endsWith("/v1/me") && r.body === null));
      A.S.set(`notes_${TODAY}`, "coda prima del claim");
      await tick();
      A.net.offline = true; await A.sync(); A.net.offline = false;
      ok("prima del claim: una modifica in coda", A.outbox().length === 1);
      const c0 = await A.SV.claim(EMAIL, "corta");
      ok("claim con password corta → invalid (400), token legacy invariato", !c0.ok && c0.error === "invalid" && A.S.get("syncToken") === TOKEN);
      A.net.offline = true;
      const cOff = await A.SV.claim(EMAIL, PW);
      A.net.offline = false;
      ok("claim senza rete → retry (mai «password sbagliata»), token legacy invariato", !cOff.ok && cOff.error === "retry" && A.S.get("syncToken") === TOKEN);
      const c1 = await A.SV.claim("  Lorenzo@Example.TEST ", PW, "PWA test");
      const sessA = A.S.get("syncToken");
      ok("claim ok: syncToken = sessione (43 caratteri), accountEmail salvata", c1.ok && c1.email === EMAIL && sessA !== TOKEN && /^[A-Za-z0-9_-]{43}$/.test(sessA) && A.S.get("accountEmail") === EMAIL);
      ok("claim ok: account() = con email, non più legacy; sync riuscito e coda partita",
        A.SV.account().email === EMAIL && !A.SV.account().legacy && A.SV.status().status === "ok" && A.outbox().length === 0 &&
        find(await serverRecords(env), "dayState", `${TODAY}:notes`).data.value === "coda prima del claim");
      ok("claim ok: account creato per PRIMARY_OWNER con la sessione salvata col deviceName",
        (await env.DB.prepare("SELECT id FROM accounts").first("id")) === "owner-test" && (await env.DB.prepare("SELECT device_name FROM sessions").first("device_name")) === "PWA test");
      const c2 = await C.SV.claim(EMAIL, PW);
      ok("secondo claim (altro device col token legacy) → exists (409), token legacy invariato", !c2.ok && c2.error === "exists" && C.S.get("syncToken") === TOKEN && C.S.get("accountEmail", null) === null);
      ok("accountInfo() col token legacy dopo il claim: email dell'account (niente più claim)", (await C.SV.accountInfo()).email === EMAIL);
      ok("claim da un device già con account → claimUnavailable", (await A.SV.claim(EMAIL, PW)).error === "claimUnavailable");

      // B: accesso con lo stesso account
      const b0 = await B.SV.login(EMAIL, "sbagliata-123");
      ok("login con password sbagliata → credentials, niente token", !b0.ok && b0.error === "credentials" && !B.SV.hasToken() && B.S.get("accountEmail", null) === null);
      B.net.fake = { status: 503, json: { error: "errore interno" } };
      const b5 = await B.SV.login(EMAIL, PW);
      ok("login con 5xx → retry (mai «password sbagliata»)", !b5.ok && b5.error === "retry" && !B.SV.hasToken());
      A.S.set("spesaChecked", { "proteine-0": true });
      await tick(); await A.sync();
      const b1 = await B.SV.login("LORENZO@example.test", PW);
      ok("login ok su B: sessione propria, email salvata, primo sync fatto", b1.ok && B.S.get("syncToken") !== sessA && B.S.get("accountEmail") === EMAIL && B.SV.status().status === "ok");
      ok("B vede le spunte di A", (B.S.get("spesaChecked") || {})["proteine-0"] === true && B.S.get(`notes_${TODAY}`) === "coda prima del claim");
      B.S.set("spesaChecked", { "proteine-0": true, "proteine-1": true });
      await tick(); await B.sync(); await A.sync();
      ok("A vede le spunte di B", (A.S.get("spesaChecked") || {})["proteine-1"] === true);

      // Sessione revocata sul server → expired, coda intatta, niente martellamento, nuovo accesso → la coda parte
      await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").bind(createHash("sha256").update(sessA).digest("hex")).run();
      A.S.set(`notes_${TODAY}`, "scritta con la sessione revocata");
      await tick();
      const ex = await A.sync();
      ok("sessione revocata: 401 → status expired, coda intatta, token e email restano", !ex.ok && ex.error === "unauthorized" && A.SV.status().status === "expired" &&
        A.sb.window._syncState.status === "expired" && A.outbox().length === 1 && A.S.get("syncToken") === sessA && A.SV.account().expired && A.SV.account().email === EMAIL);
      const nReq = A.net.requests.length;
      const ex2 = await A.sync();
      ok("expired: i sync successivi non chiamano il server (nessun martellamento)", !ex2.ok && A.net.requests.length === nReq && A.SV.status().status === "expired");
      const a2 = await A.SV.login(EMAIL, PW);
      ok("accedi di nuovo: nuova sessione, la coda arriva al server", a2.ok && A.S.get("syncToken") !== sessA && A.outbox().length === 0 && A.SV.status().status === "ok" &&
        find(await serverRecords(env), "dayState", `${TODAY}:notes`).data.value === "scritta con la sessione revocata");

      // Cambio password: attuale sbagliata → credentials; ok → le ALTRE sessioni (B) scadono
      ok("cambio password con quella attuale sbagliata → credentials", (await A.SV.changePassword("sbagliata-123", PW2)).error === "credentials");
      ok("cambio password con la nuova troppo corta → invalid", (await A.SV.changePassword(PW, "corta")).error === "invalid");
      const cp = await A.SV.changePassword(PW, PW2);
      ok("cambio password ok, A resta collegato", cp.ok && A.SV.account().email === EMAIL && (await A.sync()).ok);
      const bx = await B.sync();
      ok("…B (altra sessione) → expired", !bx.ok && B.SV.status().status === "expired");
      ok("…vecchia password rifiutata, nuova accettata", (await B.SV.login(EMAIL, PW)).error === "credentials" && (await B.SV.login(EMAIL, PW2)).ok);

      // Esci: sessione revocata sul server, device scollegato, dati locali e coda restano
      B.net.offline = true;
      B.S.set(`notes_${TODAY}`, "offline prima di uscire");
      await tick(); await B.sync();
      B.net.offline = false;
      const sessB = B.S.get("syncToken");
      const lo = await B.SV.logout();
      ok("logout: token ed email via, status unlinked, dati locali e coda restano", lo.ok && lo.remote && !B.SV.hasToken() && B.S.get("accountEmail", null) === null &&
        B.SV.status().status === "unlinked" && B.outbox().length === 1 && (B.S.get("spesaChecked") || {})["proteine-1"] === true);
      const meOld = await worker.fetch(new Request(API + "/v1/me", { headers: { Authorization: "Bearer " + sessB } }), env);
      ok("logout: la sessione è revocata sul server", meOld.status === 401);
      ok("logout: account() = non collegato", !B.SV.account().linked && B.SV.account().email === null);

      // Limite tentativi: 429 → rate (niente token)
      const lim = await backend();
      lim.PASSWORD_PEPPER = env.PASSWORD_PEPPER;
      const D = device(lim);
      for (let i = 0; i < 5; i++) await D.SV.login(EMAIL, "sbagliata-" + i);
      const d6 = await D.SV.login(EMAIL, "sbagliata-x");
      ok("login oltre il limite → rate (429)", !d6.ok && d6.error === "rate" && !D.SV.hasToken());

      // Mai la password: né in storage, né nei log, né negli URL delle richieste
      const all = [A, B, C, D];
      const dump = (X) => JSON.stringify(X.S.keys().map(k => [k, X.S.get(k, null)]));
      ok("nessuna password in storage (tutte le chiavi, anche errorLog)", all.every(X => ![PW, PW2, "sbagliata-123"].some(p => dump(X).includes(p))));
      ok("nessuna password nei log degli errori", all.every(X => !X.logs.some(l => [PW, PW2].some(p => l.includes(p)))));
      ok("nessuna password negli URL (solo nel corpo delle POST /v1/auth/*)", all.every(X => X.net.requests.every(r => ![PW, PW2].some(p => r.url.includes(p)))) &&
        A.net.requests.filter(r => r.body && JSON.stringify(r.body).includes(PW)).every(r => r.method === "POST" && /\/v1\/auth\/(claim|login|password)$/.test(r.url)));
      ok("accountEmail e syncToken non generano modifiche da sincronizzare", !all.some(X => X.sent().some(c => /accountEmail|syncToken/.test(JSON.stringify(c)))));
    }

    // ── ripristino di un backup vecchio su device collegato (Ruling 14: rebaseline) ──
    {
      const env = await backend();
      const A = device(env), B = device(env, { t: T0 + 5 });
      await A.SV.setToken(TOKEN); await B.SV.setToken(TOKEN);
      ok("SyncV2 espone rebaseline()", typeof A.SV.rebaseline === "function");
      A.S.set("weightLog", [{ date: daysAgo(3), weight: 80 }]);
      A.S.set("exNotes", { panca: "vecchia" });
      A.S.set("spesaExtra", [{ id: 1, name: "Caffè" }]);
      await tick(); await A.sync();
      // backup preso adesso (+ una pesata solo nel file, mai arrivata al server)
      const backup = { weightLog: [{ date: daysAgo(10), weight: 81 }, { date: daysAgo(3), weight: 80 }], exNotes: { panca: "vecchia" }, spesaExtra: [{ id: 1, name: "Caffè" }] };
      // dati più nuovi del backup, sul server (anche da un altro device)
      A.clock.t += 1000;
      A.S.set("weightLog", [{ date: daysAgo(3), weight: 80 }, { date: daysAgo(1), weight: 79 }]);
      A.S.set("exNotes", { panca: "nuova", squat: "piedi larghi" });
      A.S.set("spesaExtra", [{ id: 1, name: "Caffè" }, { id: 2, name: "Tè" }]);
      await tick(); await A.sync();
      B.S.set("prMap", { "Panca": { peso: 30, date: TODAY } });
      await tick(); await B.sync(); await A.sync();
      ok("rebaseline: premessa — dati più nuovi sul server", count(await serverRecords(env), "bodyWeight") === 2 && A.outbox().length === 0);
      // ripristino come Impostazioni: chiavi scritte in silenzio, poi rebaseline
      const n0 = A.net.requests.length;
      Object.keys(backup).forEach(k => A.S.set(k, backup[k], { silent: true }));
      A.S.remove("prMap", { silent: true }); // come un backup più vecchio dei PR (chiave assente)
      const r = await A.SV.rebaseline();
      ok("rebaseline: sync riuscito", !!r && r.ok === true);
      ok("rebaseline: nessun tombstone inviato", !A.sent(n0).some(c => c.deleted));
      const srv = await serverRecords(env);
      const live = (c, id) => { const x = find(srv, c, id); return !!x && !x.deleted; };
      ok("rebaseline: i dati più nuovi restano sul server (pesata, note, extra, PR)",
        live("bodyWeight", daysAgo(1)) && live("exerciseNote", "squat") && live("shoppingExtra", "2") && live("personalRecord", "panca") &&
        find(srv, "exerciseNote", "panca").data.text === "nuova");
      ok("rebaseline: il record solo nel backup viene pushato (una volta sola)", live("bodyWeight", daysAgo(10)) &&
        A.sent(n0).filter(c => c.collection === "bodyWeight").map(c => c.id).join() === daysAgo(10));
      ok("rebaseline: i dati più nuovi tornano in locale (server vince sugli id che ha)",
        A.S.get("weightLog").map(e => e.date).join() === [daysAgo(10), daysAgo(3), daysAgo(1)].join() &&
        A.S.get("exNotes").panca === "nuova" && A.S.get("exNotes").squat === "piedi larghi" &&
        A.S.get("spesaExtra").map(e => e.id).sort().join() === "1,2" && A.S.get("prMap").Panca.peso === 30);
      ok("rebaseline: cursore e indice gruppi ricostruiti, coda vuota", A.S.get("v2cursor") > 0 && Array.isArray(A.S.get("v2grp:weights")) && A.outbox().length === 0);
      await B.sync();
      ok("rebaseline: l'altro device non perde niente e riceve la pesata del backup", B.S.get("weightLog").map(e => e.date).join() === [daysAgo(10), daysAgo(3), daysAgo(1)].join() && B.S.get("exNotes").squat === "piedi larghi");
      // dopo il rebaseline il motore torna normale: una cancellazione vera è un tombstone
      A.S.set("weightLog", A.S.get("weightLog").filter(e => e.date !== daysAgo(1)));
      await tick();
      ok("dopo il rebaseline: cancellazione vera → tombstone", A.outbox().join() === `bodyWeight/${daysAgo(1)}` && A.S.get("v2outbox")[`bodyWeight/${daysAgo(1)}`].deleted === true);
      await A.sync();

      // rebaseline mentre un sync è in volo: il giro in volo non salva cursore né chiavi, poi primo sync
      B.S.set("exNotes", { ...B.S.get("exNotes"), stacco: "presa mista" });
      await tick(); await B.sync();
      const n1 = A.net.requests.length;
      let inFlight = null;
      A.net.hook = async () => {
        A.S.set("exNotes", { panca: "vecchia" }, { silent: true });
        inFlight = A.SV.rebaseline();
      };
      const r1 = await A.sync();
      await inFlight;
      ok("rebaseline durante un sync: il giro in volo si ferma senza errore visibile", r1.ok === false && r1.error === "rebaseline" && A.SV.status().status === "ok");
      ok("rebaseline durante un sync: nessun tombstone, note dal server (anche quella nuova di B)",
        !A.sent(n1).some(c => c.deleted) && A.S.get("exNotes").panca === "nuova" && A.S.get("exNotes").stacco === "presa mista");

      // senza token: solo ripristino locale, niente rete, niente errori
      const C = device(env);
      C.S.set("weightLog", [{ date: daysAgo(2), weight: 82 }]);
      await tick();
      C.S.set("weightLog", [{ date: daysAgo(4), weight: 83 }], { silent: true });
      const rc = await C.SV.rebaseline();
      ok("rebaseline senza token: ok locale, nessuna richiesta, dati ripristinati intatti",
        rc && rc.ok === true && C.net.requests.length === 0 && C.S.get("weightLog")[0].date === daysAgo(4) && C.SV.status().linked === false);
      await C.SV.setToken(TOKEN);
      ok("rebaseline senza token: al collegamento primo sync (pesata del backup pushata, dati del server ricevuti)",
        live("bodyWeight", daysAgo(10)) && !!find(await serverRecords(env), "bodyWeight", daysAgo(4)) && C.S.get("weightLog").some(e => e.date === daysAgo(3)));
    }

    // ── lotti: ≤ 500 change e ≤ 1,5 MB per richiesta ───────────────────────────
    {
      const env = await backend();
      const A = device(env);
      await A.SV.setToken(TOKEN);
      const many = [];
      for (let i = 0; i < 1200; i++) many.push({ collection: "shoppingCheck", id: `item-${i}`, data: { checked: i % 2 === 0 } });
      A.SV.putRecords(many);
      ok("putRecords: 1.200 change in coda, chiave locale ricostruita", A.outbox().length === 1200 && Object.keys(A.S.get("spesaChecked")).length === 1200);
      const n0 = A.net.requests.length;
      const r = await A.sync();
      const reqs = A.net.requests.slice(n0);
      ok("lotti: 1.200 change → 3 richieste", r.ok && r.pushed === 1200 && reqs.length === 3);
      ok("lotti: ogni richiesta ≤ 500 change e ≤ 1,5 MB", reqs.every(q => q.body.changes.length <= 500 && q.bytes <= MB15));
      ok("lotti: 1.200 record sul server, coda vuota", count(await serverRecords(env), "shoppingCheck") === 1200 && A.outbox().length === 0);

      const fat = [];
      for (let i = 0; i < 60; i++) fat.push({ collection: "shoppingExtra", id: `fat-${i}`, data: { id: `fat-${i}`, name: "x".repeat(60000) } });
      A.SV.putRecords(fat);
      const n1 = A.net.requests.length;
      const r2 = await A.sync();
      const reqs2 = A.net.requests.slice(n1);
      ok("lotti per dimensione: 60 × 60 KB → 3 richieste da ≤ 1,5 MB", r2.ok && r2.pushed === 60 && reqs2.length === 3 && reqs2.every(q => q.bytes <= MB15));
    }
  } catch (e) {
    ok("Suite SyncV2 eseguibile — " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e), false);
  }
})();

// ---- Suite LocalData (localdata.jsx: storico e progressione dai record locali) ----
// Cache finta di SyncV2 (listRecords/activePlans) con record da fixture; stesse forme e ordinamenti
// che le schermate ricevevano da sheetsAPI.
console.log("\nSuite LocalData — getPesi/getUltimiPesi/getSessioni/getCheckIn/getPesoCorporeo/getMisure dai record");
{
  const J = (x) => JSON.parse(JSON.stringify(x));
  const rec = (collection, id, data, extra) => Object.assign({ collection, id, data, updatedAt: 1, deleted: false, deviceId: "d", seq: 1 }, extra || {});
  const sl = (date, exerciseId, exerciseName, setIndex, weight, over) =>
    rec("setLog", `${date}:${exerciseId}:${setIndex}`, Object.assign({ date, exerciseId, exerciseName, planId: exerciseId.startsWith("name:") ? null : "workout-2026-11", setIndex, weight, reps: null, done: true, substitutedWith: null }, over || {}));
  const planData = { name: "P", status: "active", validFrom: "2026-11-01", validTo: null, days: [
    { id: "w/d0", name: "Upper A", focus: [], exercises: [
      { id: "w/d0/e0", name: "Panca Piana", sets: 3, reps: "8-10", restSec: 90, notes: "", muscles: [], alternatives: [] },
      { id: "w/d0/e1", name: "Rematore", sets: 3, reps: "12", restSec: 90, notes: "", muscles: [], alternatives: [] },
    ] },
  ] };
  const oldPlan = { name: "Vecchio", status: "archived", validFrom: "2026-09-01", validTo: "2026-10-31", days: [
    { id: "old/d0", name: "Giorno A", focus: [], exercises: [{ id: "old/d0/e0", name: "Stacco", sets: 3, reps: "5", restSec: 120, notes: "", muscles: [], alternatives: [] }] },
  ] };
  const records = [
    rec("workoutPlan", "w", planData),
    rec("workoutPlan", "old", oldPlan),
    // Panca Piana: 2 sessioni (inserite in disordine); peso con virgola e a testo
    sl("2026-11-03", "w/d0/e0", "Panca Piana", 1, "82,5"),
    sl("2026-11-03", "w/d0/e0", "Panca Piana", 0, "80"),
    sl("2026-10-27", "w/d0/e0", "Panca Piana", 0, "77.5"),
    sl("2026-10-27", "w/d0/e0", "Panca Piana", 1, "rosso"),
    sl("2026-10-27", "w/d0/e0", "Panca Piana", 2, "75", { done: false }),           // non fatta: esclusa
    sl("2026-11-03", "w/d0/e0", "Panca Piana", 2, "70", { deleted: false }),
    // sostituzione: fatto "Croci" al posto di Rematore
    sl("2026-11-03", "w/d0/e1", "Rematore", 0, "20", { substitutedWith: "Croci" }),
    // piano archiviato e id name:
    sl("2026-10-10", "old/d0/e0", "Stacco", 0, "120"),
    sl("2026-10-20", "name:military press", "military press", 0, "40"),
    // tombstone: escluso
    rec("setLog", "2026-11-03:w/d0/e0:9", null, { deleted: true }),
    // sessioni, note, check-in
    rec("workoutSession", "2026-11-03:w/d0", { date: "2026-11-03", dayId: "w/d0", dayName: "Upper A", startedAt: new Date(2026, 10, 3, 18, 5).getTime(), done: true }),
    rec("workoutSession", "2026-10-27:w/d0", { date: "2026-10-27", dayId: "w/d0", dayName: "Upper A", startedAt: null, done: true }),
    rec("workoutSession", "2026-10-10:old/d0", { date: "2026-10-10", dayId: "old/d0", dayName: "Giorno A", startedAt: null, done: true }),
    rec("workoutSession", "2026-10-30:w/d0", { date: "2026-10-30", dayId: "w/d0", dayName: "Upper A", startedAt: null, done: false }), // non chiusa
    rec("dayState", "2026-11-03:notes", { date: "2026-11-03", field: "notes", value: "buona sessione" }),
    rec("dayState", "2026-11-03:checkIn", { date: "2026-11-03", field: "checkIn", value: { sleep: 4, energy: 3, ailments: "spalla" } }),
    rec("dayState", "2026-11-01:checkIn", { date: "2026-11-01", field: "checkIn", value: { sleep: 2, energy: 2, ailments: "" } }),
    rec("dayState", "2026-11-02:checkIn", null, { deleted: true }),
    rec("dayState", "2026-11-03:hydration", { date: "2026-11-03", field: "hydration", value: 5 }),
    rec("bodyWeight", "2026-11-03", { date: "2026-11-03", kg: 90.4 }),
    rec("bodyWeight", "2026-11-01", { date: "2026-11-01", kg: 91 }),
    rec("bodyWeight", "2026-10-30", { date: "2026-10-30", kg: 0 }),
    rec("bodyMeasure", "2026-11-03", { date: "2026-11-03", vita: 92.5, fianchi: 0, braccio: 38 }),
    rec("bodyMeasure", "2026-10-01", { date: "2026-10-01", vita: 95 }),
  ];
  const sb = { window: {}, console };
  vm.createContext(sb);
  sb.window.SyncV2 = {
    listRecords: (c) => records.filter((r) => r.collection === c),
    activePlans: () => ({ workout: { id: "w", data: planData }, diet: null }),
  };
  let loaded = true;
  try { vm.runInContext(transform(join(ROOT, "localdata.jsx")), sb, { filename: "localdata.jsx" }); }
  catch (e) { loaded = false; ok("localdata.jsx si carica sotto vm — " + e.message.split("\n")[0], false); }
  const L = sb.window.LocalData;
  ok("window.LocalData espone le 6 letture", !!L && ["getPesi", "getUltimiPesi", "getSessioni", "getCheckIn", "getPesoCorporeo", "getMisure"].every((f) => typeof L[f] === "function"));
  if (loaded && L) {
    // getPesi
    const p = J(L.getPesi());
    ok("getPesi: chiavi = nome esercizio minuscolo (piano, archiviato, name:, sostituto)",
      ["panca piana", "stacco", "military press", "croci"].every((k) => Array.isArray(p[k])) && !p["rematore"]);
    ok("getPesi: ordine cronologico, poi per serie; setN = setIndex + 1",
      JSON.stringify(p["panca piana"].map((r) => [r.date, r.setN])) === JSON.stringify([["2026-10-27", 1], ["2026-10-27", 2], ["2026-11-03", 1], ["2026-11-03", 2], ["2026-11-03", 3]]));
    ok("getPesi: solo serie fatte (la non spuntata e il tombstone non ci sono)", p["panca piana"].length === 5);
    ok("getPesi: peso numerico → numero (virgola ok), testo (elastico) → testo",
      p["panca piana"][0].peso === 77.5 && p["panca piana"][1].peso === "rosso" && p["panca piana"][3].peso === 82.5);
    ok("getPesi: rip dalle ripetizioni previste dal piano (limite inferiore), anche per un piano archiviato",
      p["panca piana"][0].rip === 8 && p["stacco"][0].rip === 5);
    ok("getPesi: esercizio senza piano (name:) → rip null", p["military press"][0].rip === null);
    ok("getPesi: id non trovato (name: o esercizio sparito) → rip dal NOME in tutti i piani noti (e1RM/Forza restano)", (() => {
      const recs = [
        sl("2026-11-04", "name:stacco", "Stacco", 0, "125"),                  // fuori piano, nome nel piano archiviato
        sl("2026-11-04", "gone/d0/e9", "Rematore", 0, "60"),                  // id di un piano sconosciuto, nome nel piano attivo
        sl("2026-11-04", "name:panca piana", "panca piana", 0, "80", { reps: 6 }), // reps registrate: vincono
        sl("2026-11-04", "name:curl", "Curl", 0, "12"),                       // nome in nessun piano → null
      ];
      const sb3 = { window: { SyncV2: {
        listRecords: (c) => (c === "setLog" ? recs : c === "workoutPlan" ? [rec("workoutPlan", "old", oldPlan)] : []),
        activePlans: () => ({ workout: { id: "workout-2026-11", data: planData }, diet: null }),
      } }, console };
      vm.createContext(sb3);
      vm.runInContext(transform(join(ROOT, "localdata.jsx")), sb3, { filename: "localdata.jsx" });
      const r = J(sb3.window.LocalData.getPesi());
      return r["stacco"][0].rip === 5 && r["rematore"][0].rip === 12 && r["panca piana"][0].rip === 6 && r["curl"][0].rip === null;
    })());
    ok("getPesi: forma {date,setN,peso,rip,sessione}", Object.keys(p["stacco"][0]).sort().join() === "date,peso,rip,sessione,setN");
    ok("getPesi: esercizio sostituito sotto il nome del sostituto", p["croci"].length === 1 && p["croci"][0].peso === 20);
    const pb = J(L.getPesi({ before: "2026-11-03" }));
    ok("getPesi({before}): esclude oggi e dopo", pb["panca piana"].length === 2 && !pb["croci"] && pb["stacco"].length === 1);
    ok("getPesi: ultime 12 per esercizio", (() => {
      const many = [];
      for (let i = 0; i < 20; i++) many.push(sl(`2026-09-${String(i + 1).padStart(2, "0")}`, "w/d0/e1", "Rematore", 0, String(50 + i)));
      const sb2 = { window: { SyncV2: { listRecords: (c) => (c === "setLog" ? many : []), activePlans: () => ({ workout: null, diet: null }) } }, console };
      vm.createContext(sb2);
      vm.runInContext(transform(join(ROOT, "localdata.jsx")), sb2, { filename: "localdata.jsx" });
      const r = J(sb2.window.LocalData.getPesi())["rematore"];
      return r.length === 12 && r[0].peso === 58 && r[11].peso === 69;
    })());

    // getUltimiPesi
    const u = J(L.getUltimiPesi());
    ok("getUltimiPesi(): { nome: [peso per serie] } con l'ultimo peso noto",
      JSON.stringify(u["panca piana"]) === JSON.stringify([80, 82.5, 70]) && JSON.stringify(u["stacco"]) === JSON.stringify([120]));
    ok("getUltimiPesi(): peso a testo conservato", JSON.stringify(J(L.getUltimiPesi({ before: "2026-11-03" }))["panca piana"]) === JSON.stringify([77.5, "rosso"]));
    const un = J(L.getUltimiPesi("Panca Piana"));
    ok("getUltimiPesi(nome) → [{setN,peso,rip}] dell'ultima sessione",
      JSON.stringify(un) === JSON.stringify([{ setN: 1, peso: 80, rip: 8 }, { setN: 2, peso: 82.5, rip: 8 }, { setN: 3, peso: 70, rip: 8 }]));
    ok("getUltimiPesi(nome sconosciuto) → []", J(L.getUltimiPesi("zzz")).length === 0);

    // getSessioni
    const s = J(L.getSessioni());
    ok("getSessioni: solo sessioni chiuse, cronologiche", s.length === 3 && s[0].date === "2026-10-10" && s[1].date === "2026-10-27" && s[2].date === "2026-11-03");
    ok("getSessioni: forma {date,type,setsCompleted,totalSets,notes,ora}",
      Object.keys(s[2]).sort().join() === "date,notes,ora,setsCompleted,totalSets,type");
    ok("getSessioni: type = nome del giorno, serie fatte del giorno, totale dal piano, note, ora di inizio",
      s[2].type === "Upper A" && s[2].setsCompleted === 4 && s[2].totalSets === 6 && s[2].notes === "buona sessione" && s[2].ora === "18:05");
    ok("getSessioni: senza note/inizio → '' ; giorno non nel piano attivo → totale 0",
      s[1].notes === "" && s[1].ora === "" && s[1].setsCompleted === 2 && s[0].setsCompleted === 1 && s[0].totalSets === 0);

    // getCheckIn
    const c = J(L.getCheckIn());
    ok("getCheckIn: [{date,sleep,energy,ailments}] cronologico, tombstone e altri campi esclusi",
      JSON.stringify(c) === JSON.stringify([{ date: "2026-11-01", sleep: 2, energy: 2, ailments: "" }, { date: "2026-11-03", sleep: 4, energy: 3, ailments: "spalla" }]));
    ok("getCheckIn(date) → solo quella data", J(L.getCheckIn("2026-11-03")).length === 1 && J(L.getCheckIn("2026-11-02")).length === 0);

    // getPesoCorporeo
    ok("getPesoCorporeo: [{date,weight}] cronologico, peso 0 escluso",
      JSON.stringify(J(L.getPesoCorporeo())) === JSON.stringify([{ date: "2026-11-01", weight: 91 }, { date: "2026-11-03", weight: 90.4 }]));

    // getMisure
    ok("getMisure: [{date, misure > 0}] cronologico",
      JSON.stringify(J(L.getMisure())) === JSON.stringify([{ date: "2026-10-01", vita: 95 }, { date: "2026-11-03", vita: 92.5, braccio: 38 }]));

    // Senza SyncV2 pronto: vuoto, nessun crash
    const sb3 = { window: {}, console };
    vm.createContext(sb3);
    vm.runInContext(transform(join(ROOT, "localdata.jsx")), sb3, { filename: "localdata.jsx" });
    const L3 = sb3.window.LocalData;
    ok("senza SyncV2: tutte le letture tornano vuote", Object.keys(J(L3.getPesi())).length === 0 && L3.getSessioni().length === 0 &&
      L3.getCheckIn().length === 0 && L3.getPesoCorporeo().length === 0 && L3.getMisure().length === 0);
  }

  // Sorgente: nessun residuo del client Sheets
  const SRC = [".", "screens"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".jsx")).map((f) => [d + "/" + f, readFileSync(join(ROOT, d, f), "utf8")]));
  const code = (src) => src.replace(/\/\/.*$/gm, "");
  ok("nessun sorgente usa sheetsAPI / drainQueue", SRC.every(([, src]) => !/sheetsAPI|drainQueue/.test(code(src))));
  ok("sheetsQueue compare solo nella pulizia silenziosa di api.jsx", SRC.every(([f, src]) => f === "./api.jsx" ? /remove\(k,\s*\{\s*silent:\s*true\s*\}\)/.test(src) : !/sheetsQueue/.test(code(src))));
  ok("localdata.jsx in BUNDLE_FILES dopo syncv2.jsx", (() => { const b = readFileSync(join(ROOT, "dev", "build.mjs"), "utf8"); return b.indexOf('"syncv2.jsx"') > 0 && b.indexOf('"localdata.jsx"') > b.indexOf('"syncv2.jsx"'); })());
}

// ---- Suite App v2: piani dal modello strutturato + vecchio motore Sheets rimosso ----
// getSchedule()/getDieta() leggono plan_workout/plan_diet (copie locali di SyncV2) via PlanConv;
// senza piano → testo embedded (defaults.jsx). Più controlli sul sorgente: app.jsx non parla più
// con Sheets e nessuna schermata usa gli helper del vecchio motore.
console.log("\nSuite App v2 — piani dal piano attivo, fallback embedded, vecchio motore rimosso");
{
  const sb = { window: {}, console };
  vm.createContext(sb);
  let loaded = true;
  try {
    for (const f of ["defaults.jsx", "parser.jsx", "planconv.jsx"]) vm.runInContext(transform(join(ROOT, f)), sb, { filename: f });
  } catch (e) { loaded = false; ok("defaults + parser + planconv si caricano sotto vm — " + e.message.split("\n")[0], false); }
  const w = sb.window;
  if (loaded) {
    const J = (x) => JSON.parse(JSON.stringify(x));
    const mem = {};
    w.storage = { get: (k, d = null) => (k in mem ? mem[k] : d) };
    ok("getDieta esposto da parser.jsx", typeof w.getDieta === "function");

    // Senza piani e senza testo legacy: testo embedded.
    const fbS = J(w.getSchedule()), refS = J(w.parseScheda(w.SCHEDA_TXT_FALLBACK));
    ok("getSchedule senza plan_workout né schedaData → fallback embedded",
      fbS.days.length === refS.days.length && fbS.days.every((d, i) => d.name === refS.days[i].name));
    const fbD = typeof w.getDieta === "function" ? J(w.getDieta()) : null;
    const refD = J(w.parseDieta(w.DIETA_TXT_FALLBACK));
    ok("getDieta senza plan_diet né dietaData → fallback embedded",
      !!fbD && ["riposo", "ore17"].every(k => fbD[k].meals.length === refD[k].meals.length));
    // Ruling 16: senza piano strutturato, prima il testo legacy del device (ciò che mostrava prima del deploy).
    mem.schedaData = "# VECCHIO - Giorno 1\n\nEsercizio | Serie | Rip | Recupero | Note tecniche\nPanca vecchia | 3 | 8 | 60 | Muscoli: petto\n";
    const lgS = J(w.getSchedule());
    ok("getSchedule senza plan_workout → testo legacy del device (schedaData), parsato come prima",
      JSON.stringify(lgS) === JSON.stringify(J(w.parseScheda(mem.schedaData))) && lgS.days[0].name === "VECCHIO" && lgS.days[0].exercises[0].name === "Panca vecchia");
    const legacyDieta = readFileSync(join(ROOT, "dieta.txt"), "utf8").replace("- Opzione 1: 40g gallette grano saraceno (4)", "- Opzione 1: 77g pane di segale");
    mem.dietaData = legacyDieta;
    const lgD = typeof w.getDieta === "function" ? w.getDieta() : null;
    ok("getDieta senza plan_diet → testo legacy del device (dietaData), non segnato come piano",
      !!lgD && JSON.stringify(lgD.riposo.meals[0].primary).includes("77g pane di segale") && !lgD._fromPlan);
    mem.schedaData = "ciao, non sono una scheda"; mem.dietaData = "nemmeno una dieta";
    ok("testo legacy illeggibile → fallback embedded (scheda e dieta)",
      J(w.getSchedule()).days.length === refS.days.length && J(w.getDieta()).riposo.meals.length === refD.riposo.meals.length);
    mem.schedaData = "# VECCHIO - Giorno 1\n\nEsercizio | Serie | Rip | Recupero | Note tecniche\nPanca vecchia | 3 | 8 | 60 | Muscoli: petto\n";
    mem.dietaData = legacyDieta;

    // Con piano attivo: giorni ed esercizi del piano (giorno rinominato, esercizio cambiato).
    const txt = readFileSync(join(ROOT, "scheda.txt"), "utf8")
      .replace("# PUSH - Giorno 1", "# SPINTA NUOVA - Giorno 1")
      .replace("Push-up (bodyweight)", "Panca piana manubri");
    mem.plan_workout = J(w.PlanConv.workoutPlanFromText(txt, { id: "workout-20261103-0900", name: "Nuova", validFrom: "2026-11-03" }));
    const ps = J(w.getSchedule());
    ok("getSchedule con plan_workout → nomi dei giorni del piano", ps.days.length === refS.days.length && ps.days[0].name === "SPINTA NUOVA");
    ok("getSchedule con plan_workout → esercizi del piano", ps.days[0].exercises[0].name === "Panca piana manubri");
    ok("getSchedule con plan_workout → forma di parseScheda (key Giorno N, sets, rest, ripRange)",
      ps.days[0].key === "Giorno 1" && Array.isArray(ps.days[0].exercises[0].sets) && ps.days[0].exercises[0].sets.length === 3 &&
      ps.days[0].exercises[0].rest === 60 && ps.days[0].exercises[0].ripRange === "8-12");
    ok("getSelectedSession usa il piano attivo", (() => { mem.schedaSelectedDay = "Giorno 1"; const s = w.getSelectedSession(); return !!s && s.name === "SPINTA NUOVA"; })());
    mem.plan_workout = { id: "workout-vuoto", data: { name: "x", status: "active", days: [] } };
    ok("getSchedule con piano senza giorni → testo legacy, poi embedded", J(w.getSchedule()).days[0].name === "VECCHIO" &&
      (() => { delete mem.schedaData; return J(w.getSchedule()).days.length === refS.days.length; })());

    const dtxt = readFileSync(join(ROOT, "dieta.txt"), "utf8").replace("- Opzione 1: 40g gallette grano saraceno (4)", "- Opzione 1: 99g fiocchi d'avena");
    mem.plan_diet = J(w.PlanConv.dietPlanFromText(dtxt, { id: "diet-20261103-0900", name: "Nuova", validFrom: "2026-11-03" }));
    const pd = typeof w.getDieta === "function" ? w.getDieta() : null;
    ok("getDieta con plan_diet → pasti del piano (toLegacyDieta)", !!pd && JSON.stringify(pd.riposo.meals[0].primary).includes("99g fiocchi d'avena"));
    ok("getDieta con plan_diet → segnato come piano (_fromPlan, non enumerabile)", !!pd && pd._fromPlan === true && !Object.keys(pd).includes("_fromPlan"));
    ok("getDieta senza piano → non segnato", (() => { delete mem.plan_diet; const d = typeof w.getDieta === "function" ? w.getDieta() : null; return !!d && !d._fromPlan; })());
  }

  // Sorgente: nessun residuo del vecchio motore.
  const appSrc = readFileSync(join(ROOT, "app.jsx"), "utf8");
  ok("app.jsx: nessuna chiamata a sheetsAPI.", !/sheetsAPI\./.test(appSrc));
  ok("app.jsx: niente _cloudSync / _saveSettingRetry / _markEdits / _cloudPushAll / _reconcileRepoFiles",
    !/_cloudSync|_saveSettingRetry|_markEdits|_cloudPushAll|_reconcileRepoFiles|_maybeAutoBackup/.test(appSrc));
  ok("app.jsx: SyncV2.init dentro storage.onReady", /storage\.onReady\([\s\S]{0,400}SyncV2\.init\(/.test(appSrc));
  const sweep = (appSrc.match(/function _cleanupOldDailyKeys[\s\S]*?\n}\n/) || [""])[0];
  ok("sweep 90 gg: dietaVariant_ incluso e rimozioni silenziose", /dietaVariant_/.test(sweep) && /remove\(k,\s*\{\s*silent:\s*true\s*\}\)/.test(sweep));
  const screenSrc = readdirSync(join(ROOT, "screens")).filter(f => f.endsWith(".jsx")).map(f => readFileSync(join(ROOT, "screens", f), "utf8")).join("\n");
  ok("schermate: nessun uso di _markEdits / _saveSettingRetry / _cloudPushAll", !/_markEdits|_saveSettingRetry|_cloudPushAll/.test(screenSrc));
  ok("schermate: i piani non si leggono più da schedaData/dietaData",
    !/get\(\s*"(schedaData|dietaData)"/.test(readFileSync(join(ROOT, "screens", "dieta.jsx"), "utf8") +
      readFileSync(join(ROOT, "screens", "dashboard.jsx"), "utf8") + readFileSync(join(ROOT, "screens", "coach.jsx"), "utf8")));
}

// ---- Suite Impostazioni v2: link #sync=, import .txt temporaneo, backup senza dati del device, export completo, CSP ----
// Sandbox vm con storage.jsx reale (in memoria) + parser/planconv/recordmap/syncv2/impostazioni.jsx; fetch finto
// offline (mai la rete). Le funzioni pure stanno in window.ImpostazioniLogic e window.SyncV2.
console.log("\nSuite Impostazioni v2 — account (claim/accedi/esci), import .txt (id senza collisioni), backup/ripristino, export completo, CSP");
await (async () => {
  const TOKEN = "ab12".repeat(16);
  const FILES = ["storage.jsx", "parser.jsx", "planconv.jsx", "schedaState.jsx", "recordmap.jsx", "syncv2.jsx", "screens/impostazioni.jsx"];
  const logs = [];
  const sb = { window: {}, console: { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) } };
  sb.window.todayKey = () => "2026-11-03";
  sb.window._logError = (e) => logs.push(String(e && e.message));
  vm.createContext(sb);
  // impostazioni.jsx contiene JSX: serve il runtime classico (stesso del bundle), il default di Babel 8 emette `import`.
  const transformClassic = (f) => babel.transformFileSync(join(ROOT, f), { presets: [["@babel/preset-react", { runtime: "classic", development: false }]] }).code;
  try { for (const f of FILES) vm.runInContext(transformClassic(f), sb, { filename: f }); }
  catch (e) { ok("impostazioni.jsx e dipendenze si caricano sotto vm — " + e.message.split("\n")[0], false); return; }
  const w = sb.window, S = w.storage, SV = w.SyncV2, L = w.ImpostazioniLogic, PC = w.PlanConv;
  ok("impostazioni.jsx espone window.ImpostazioniLogic", !!L && ["importPlanChanges", "isDeviceLocalKey", "backupData", "restoreBackupData", "validateSchedaText", "validateDietaText"].every(k => typeof L[k] === "function"));
  if (!L) return;
  let offline = true;
  const fetchFn = async () => { throw new TypeError("Failed to fetch"); };
  SV.init({ storage: S, fetch: fetchFn, now: () => Date.now(), setTimeout: () => 1, clearTimeout: () => {} });

  // ── #sync= tolto (Task 9C): il link non collega più nulla ──
  ok("SyncV2: niente più linkTokenFromHash/consumeLinkHash (link #sync= ignorato)", SV.linkTokenFromHash === undefined && SV.consumeLinkHash === undefined && L.tokenFromInput === undefined);
  ok("il token non finisce mai nei log", !logs.some(l => l.includes(TOKEN)));

  // ── Account: quale riquadro mostrare (logica pura) ──
  {
    ok("ImpostazioniLogic espone accountMode e authMessage", typeof L.accountMode === "function" && typeof L.authMessage === "function");
    const M = (acc, claimable, preferSignin) => L.accountMode(acc, claimable, preferSignin);
    const off = { linked: false, legacy: false, email: null, expired: false };
    const legacy = { linked: true, legacy: true, email: null, expired: false };
    const signed = { linked: true, legacy: false, email: "a@b.it", expired: false };
    ok("accountMode: non collegato → signin", M(off, null) === "signin");
    ok("accountMode: token legacy, account da creare (o non noto) → claim", M(legacy, true) === "claim" && M(legacy, null) === "claim");
    ok("accountMode: token legacy ma l'account esiste già → signin", M(legacy, false) === "signin");
    ok("accountMode: token legacy, l'utente sceglie «ho già un account» → signin", M(legacy, true, true) === "signin");
    ok("accountMode: sessione → signedIn", M(signed, null) === "signedIn");
    ok("accountMode: 401 (sessione o token legacy spento) → expired", M({ ...signed, expired: true }, null) === "expired" && M({ ...legacy, expired: true }, true) === "expired");
    const tt = (k) => k;
    ok("authMessage: 401 → «Email o password non corretti»", L.authMessage("credentials", tt) === "Email o password non corretti");
    ok("authMessage: 429 → «Troppi tentativi, riprova tra qualche minuto»", L.authMessage("rate", tt) === "Troppi tentativi, riprova tra qualche minuto");
    ok("authMessage: 409 → «L'account esiste già: accedi»", L.authMessage("exists", tt) === "L'account esiste già: accedi");
    ok("authMessage: rete/5xx → «Riprova…», mai «password sbagliata»", /^Riprova/.test(L.authMessage("retry", tt)) && !/password/i.test(L.authMessage("retry", tt)) &&
      !/password/i.test(L.authMessage("qualcosa-di-ignoto", tt)));
    // Senza rete login/claim tornano "retry" e non toccano lo storage
    const before = JSON.stringify(S.keys().sort());
    const r1 = await SV.login("a@b.it", "password-lunga-1");
    ok("login offline → retry, nessuna chiave scritta", !r1.ok && r1.error === "retry" && JSON.stringify(S.keys().sort()) === before && !SV.hasToken());
    ok("la password non finisce mai nei log", !logs.some(l => l.includes("password-lunga-1")));
  }

  // ── Import .txt → piano strutturato ──
  const scheda = readFileSync(join(ROOT, "scheda.txt"), "utf8");
  const dieta = readFileSync(join(ROOT, "dieta.txt"), "utf8");
  const NOW = new Date(2026, 10, 3, 10, 5, 0);
  const IDDAY = "20261103", IDMIN = "1005";
  {
    const base = JSON.parse(JSON.stringify(PC.workoutPlanFromText(scheda, { id: "workout-old", name: "Vecchia", validFrom: "2026-09-01" })));
    S.set("plan_workout", { id: base.id, data: base.data });
    const txt1 = scheda.replace("Push-up (bodyweight)", "Panca piana manubri");
    const r1 = L.importPlanChanges("scheda", txt1, "Nuova scheda.txt", NOW);
    ok("import scheda: 2 change (nuovo attivo + vecchio archiviato)", !r1.identical && r1.changes.length === 2);
    const [nw, old] = r1.changes;
    ok("import scheda: id workout-YYYYMMDD-HHMM, nome dal file, attivo, validFrom oggi",
      nw.id === `workout-${IDDAY}-${IDMIN}` && nw.collection === "workoutPlan" && nw.data.name === "Nuova scheda" && nw.data.status === "active" && nw.data.validFrom === "2026-11-03" && nw.data.validTo === null);
    ok("import scheda: id interni derivati dall'id del piano", nw.data.days[0].id === `${nw.id}/d0` && nw.data.days[0].exercises[0].id === `${nw.id}/d0/e0`);
    ok("import scheda: vecchio piano archived con validTo = oggi, resto intatto",
      old.id === "workout-old" && old.data.status === "archived" && old.data.validTo === "2026-11-03" && old.data.name === "Vecchia" && old.data.days.length === base.data.days.length);
    SV.putRecords(r1.changes);
    ok("putRecords: plan_workout = nuovo piano; archiviati leggibili", S.get("plan_workout").id === nw.id && SV.listRecords("workoutPlan").filter(r => r.data.status === "archived").length === 1);
    ok("import scheda: stesso file di nuovo → identico, nessun change", (() => { const r = L.importPlanChanges("scheda", txt1, "Nuova scheda.txt", NOW); return r.identical === true && r.changes.length === 0; })());
    // Due import nello stesso minuto: l'id esiste già → suffisso
    const r2 = L.importPlanChanges("scheda", scheda.replace("Push-up (bodyweight)", "Croci ai cavi"), "Seconda.txt", NOW);
    ok("import nello stesso minuto: id con suffisso -2 (nessuna collisione)", r2.changes[0].id === `workout-${IDDAY}-${IDMIN}-2` && r2.changes[0].data.days[0].id === `${r2.changes[0].id}/d0`);
    ok("import nello stesso minuto: il primo piano viene archiviato (non sovrascritto)", r2.changes[1].id === nw.id && r2.changes[1].data.status === "archived" && r2.changes[1].data.name === "Nuova scheda");
    SV.putRecords(r2.changes);
    const r3 = L.importPlanChanges("scheda", scheda.replace("Push-up (bodyweight)", "Dip alle parallele"), "Terza.txt", NOW);
    ok("terzo import nello stesso minuto: suffisso -3", r3.changes[0].id === `workout-${IDDAY}-${IDMIN}-3`);
    SV.putRecords(r3.changes);
    const ids = SV.listRecords("workoutPlan").map(r => r.id).sort();
    ok("tre import: 4 piani distinti, uno solo attivo", ids.length === 4 && new Set(ids).size === 4 && SV.listRecords("workoutPlan").filter(r => r.data.status === "active").length === 1);
    // Dieta: stesso schema
    const d1 = L.importPlanChanges("dieta", dieta, "Dieta nuova.txt", NOW);
    ok("import dieta senza piano precedente: 1 change dietPlan attivo diet-YYYYMMDD-HHMM", d1.changes.length === 1 && d1.changes[0].collection === "dietPlan" && d1.changes[0].id === `diet-${IDDAY}-${IDMIN}` && d1.changes[0].data.status === "active");
    SV.putRecords(d1.changes);
    const d2 = L.importPlanChanges("dieta", dieta.replace("- Opzione 1: 40g gallette grano saraceno (4)", "- Opzione 1: 99g fiocchi d'avena"), "Dieta 2.txt", NOW);
    ok("import dieta nello stesso minuto: -2 e il precedente archiviato", d2.changes[0].id === `diet-${IDDAY}-${IDMIN}-2` && d2.changes[1].data.status === "archived" && d2.changes[1].data.validTo === "2026-11-03");
    // La lista della spesa viaggia con il piano: un import .txt della dieta la eredita dal piano attivo (stessi id).
    const SHOP = [{ id: "proteine", title: "Proteine", color: "#FF453A", icon: "flame", items: [{ id: "proteine-0", name: "Petto di pollo", qty1: "900 g", qty2: "500 g", note: null }] }];
    SV.putRecords([{ collection: "dietPlan", id: d1.changes[0].id, data: { ...d1.changes[0].data, shopping: SHOP } }]);
    const d3 = L.importPlanChanges("dieta", dieta.replace("- Opzione 1: 40g gallette grano saraceno (4)", "- Opzione 1: 11g avena"), "Dieta 3.txt", NOW);
    ok("import dieta: il nuovo piano eredita `shopping` dal piano attivo (copia, stessi id)",
      d3.changes[0].data.shopping && JSON.stringify(d3.changes[0].data.shopping) === JSON.stringify(SHOP) && d3.changes[0].data.shopping !== SHOP);
    ok("import dieta: il piano archiviato conserva la sua `shopping`", d3.changes[1].data.status === "archived" && JSON.stringify(d3.changes[1].data.shopping) === JSON.stringify(SHOP));
    ok("import scheda: nessuna `shopping` sul piano allenamento", !("shopping" in r1.changes[0].data));
    // Cache plan_workout vuota (device mai collegato / cache persa): il piano attivo noto dai record viene archiviato lo stesso
    S.remove("plan_workout", { silent: true });
    const r4 = L.importPlanChanges("scheda", scheda.replace("Push-up (bodyweight)", "Floor press"), "Quarta.txt", new Date(2026, 10, 3, 11, 30, 0));
    ok("import con cache piani vuota: il piano attivo dei record viene archiviato (nessun doppio attivo)",
      r4.changes.length === 2 && r4.changes[0].id === `workout-${IDDAY}-1130` && r4.changes[1].id === `workout-${IDDAY}-${IDMIN}-3` && r4.changes[1].data.status === "archived" && r4.changes[1].data.validTo === "2026-11-03");
    // refreshPlans (dopo un ripristino backup): la cache dei piani si ricalcola dai record
    S.set("plan_workout", { id: "vecchio-backup", data: { name: "x", status: "active", days: [] } }, { silent: true });
    const ch = SV.refreshPlans();
    ok("SyncV2.refreshPlans: ricalcola plan_workout dai record (mai un piano stantio)", ch.includes("plan_workout") && S.get("plan_workout").id === `workout-${IDDAY}-${IDMIN}-3`);
    // Validazione (stessa dell'UI): file non valido → nessun cambiamento
    ok("file scheda non valido → validate ko (l'UI non produce change)", L.validateSchedaText("ciao\nnon sono una scheda", (x) => x).ok === false && L.validateSchedaText(scheda, (x) => x).ok === true);
    ok("file dieta non valido → validate ko", L.validateDietaText("ciao\nnon sono una dieta", (x) => x).ok === false && L.validateDietaText(dieta, (x) => x).ok === true);
  }

  // ── Backup: niente dati del device ──
  {
    const LOCAL = ["syncToken", "accountEmail", "v2deviceId", "v2cursor", "v2epoch", "v2outbox", "v2grp:day:2026-11-03", "v2grp:weights", "r:setLog:abc", "r:workoutPlan:workout-1", "groqApiKey", "errorLog", "plan_workout", "plan_diet"];
    const KEEP = ["bodyWeight", "weightLog", "spesaChecked", "theme", "lang", "checkIn_2026-11-03", "exNotes"];
    S.clear && S.clear();
    LOCAL.forEach(k => S.set(k, "x-" + k, { silent: true }));
    KEEP.forEach(k => S.set(k, { v: k }, { silent: true }));
    const data = L.backupData(S);
    ok("export backup: nessuna chiave del device (token, deviceId, cursore, epoch, coda, v2grp:*, r:*, Groq, errorLog, cache plan_*)", LOCAL.every(k => !(k in data)) && !JSON.stringify(data).includes("x-"));
    ok("export backup: tutte le altre chiavi presenti", KEEP.every(k => k in data));
    ok("isDeviceLocalKey: solo le chiavi elencate (plan_workout/plan_diet incluse, non v2foo)", LOCAL.every(k => L.isDeviceLocalKey(k)) && !L.isDeviceLocalKey("v2foo") && !L.isDeviceLocalKey("plan_other") && !L.isDeviceLocalKey("bodyWeight") && !L.isDeviceLocalKey("rest"));
    // Ripristino di un file vecchio che contiene ancora chiavi del device
    S.set("syncToken", "TOKEN-DI-QUESTO-DEVICE", { silent: true });
    S.set("groqApiKey", "gsk_questa", { silent: true });
    S.set("plan_workout", { id: "piano-attuale" }, { silent: true });
    const old = { plan_workout: { id: "piano-vecchio" }, plan_diet: { id: "x" }, bodyWeight: 81.5, syncToken: "TOKEN-VECCHIO", v2cursor: 999, "v2grp:weights": ["x"], "r:setLog:zz": {}, groqApiKey: "gsk_vecchia", errorLog: [1], v2outbox: { a: 1 }, spesaChecked: { "a-0": true } };
    const seen = [];
    const unsub = S.onChange((k, v, info) => seen.push([k, info && info.silent]));
    const n = L.restoreBackupData(S, old);
    unsub();
    ok("ripristino: chiavi scritte in silenzio (il motore di sync non le legge come modifiche)", seen.length === 2 && seen.every(([, sil]) => sil === true));
    ok("ripristino: scrive solo le chiavi non del device (n corretto)", n === 2 && S.get("bodyWeight") === 81.5 && S.get("spesaChecked")["a-0"] === true);
    ok("ripristino: token, Groq, cursore, coda, v2grp, r:* del file vecchio ignorati",
      S.get("syncToken") === "TOKEN-DI-QUESTO-DEVICE" && S.get("groqApiKey") === "gsk_questa" && S.get("v2cursor", null) !== 999 && S.get("v2grp:weights", null) === "x-v2grp:weights" && S.get("r:setLog:zz", null) === null && S.get("v2outbox") === "x-v2outbox");
    ok("ripristino: la cache plan_* del file vecchio non viene scritta", S.get("plan_workout").id === "piano-attuale" && S.get("plan_diet") === "x-plan_diet");
  }

  // ── Export: piano attivo completo, senza troncamenti ──
  {
    const wp = PC.workoutPlanFromText(scheda, { id: "w", name: "Scheda X", validFrom: "2026-11-03" }).data;
    const dp = PC.dietPlanFromText(dieta, { id: "d", name: "Dieta X", validFrom: "2026-11-03" }).data;
    const wt = PC.planToText(wp, null, { full: true }), dt = PC.planToText(null, dp, { full: true });
    ok("export completo: scheda con tutti i giorni e tutti gli esercizi, nome del piano",
      /SCHEDA ALLENAMENTO – Scheda X/.test(wt) && wp.days.every(d => wt.includes(d.name)) && wp.days.every(d => d.exercises.every(e => wt.includes(e.name))));
    ok("export completo: dieta con tutte le sezioni e tutti i pasti, oltre i 3000 caratteri del Coach",
      /PIANO ALIMENTARE – Dieta X/.test(dt) && dp.variants.every(v => dt.includes(`[${v.name}]`) && v.meals.every(m => dt.includes(m.name))) && dt.length > 3000 && !/troncato/.test(dt));
    ok("export completo: ogni opzione/scelta del piano presente (nessun limite a 2)", dp.variants.every(v => v.meals.every(m => (m.options || []).every(o => dt.includes(o.text)) && (m.lines || []).every(l => l.choices.every(c => dt.includes(c))))));
    ok("planToText senza opzioni: invariato per il Coach (compatto e troncato a 3000)", PC.planToText(null, dp).length <= 3000 + 20 && PC.planToText(wp, dp).split("\n\n").every(x => x.length <= 3000));
  }

  // ── CSP e orfani i18n ──
  {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [, ""])[1];
    const conn = (csp.match(/connect-src ([^;]+)/) || [, ""])[1].split(/\s+/);
    ok("CSP connect-src: API v2 + proxy legacy (Groq) + worker push + api.groq.com + self",
      ["'self'", "https://fitness-hub-api.lorefara97.workers.dev", "https://fitness-hub-proxy.lorefara97.workers.dev", "https://fitness-hub-push.lorefara97.workers.dev", "https://api.groq.com"].every(h => conn.includes(h)));
    const i18n = readFileSync(join(ROOT, "i18n.jsx"), "utf8");
    ok("i18n: stringhe Sheets orfane rimosse", !/Collega il tuo Sheets|L'URL del foglio Google/.test(i18n));
    const src = readFileSync(join(ROOT, "screens", "impostazioni.jsx"), "utf8");
    const used = [...src.matchAll(/\bt\("((?:[^"\\]|\\.)*)"\)/g)].map(m => m[1].replace(/\\"/g, '"'));
    const newKeys = ["modifiche in coda", "Sola lettura · l'import .txt è temporaneo", "Scheda attiva", "Dieta attiva",
      "Piani archiviati", "Importa scheda .txt (temporaneo)", "Importa dieta .txt (temporaneo)", "Crea un nuovo piano attivo e archivia quello precedente", "Il piano attivo in testo leggibile",
      "Tutto lo storage locale, tranne token e chiave Groq", "Nessun piano: si usa il testo predefinito dell'app",
      // Account (Task 9C)
      "Account", "Crea il tuo account", "Accedi", "Accedi di nuovo", "Esci", "Cambia password", "Email", "Password", "Conferma password", "Almeno 10 caratteri",
      "Password attuale", "Nuova password", "Crea account", "Ho già un account: accedi", "Le password non coincidono", "Password cambiata: gli altri device dovranno accedere di nuovo",
      "Uscire da questo device? I dati restano qui e tornano a sincronizzarsi quando accedi di nuovo.", "Sessione scaduta: i dati restano sul device e partono dopo l'accesso",
      "Questo device usa ancora il vecchio token. Crea l'account con cui accederai da tutti i device.", "Accedi per sincronizzare i dati fra i tuoi device",
      "Email o password non corretti", "Troppi tentativi, riprova tra qualche minuto", "L'account esiste già: accedi", "Riprova: server non raggiungibile",
      "Password attuale non corretta", "Controlla email e password (almeno 10 caratteri)", "Il vecchio token non vale più: accedi con email e password", "Accesso eseguito", "Annulla"];
    // usata = t("…") statico oppure messaggio della tabella _AUTH_MSG (tradotto con t() in _authMessage)
    const authMsgs = [...((src.match(/const _AUTH_MSG = \{([\s\S]*?)\n\};/) || [, ""])[1]).matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
    const isUsed = (k) => used.includes(k) || authMsgs.includes(k);
    const missing = newKeys.filter(k => !(isUsed(k) && i18n.includes(JSON.stringify(k) + ": { en:")));
    ok("i18n: ogni nuova stringa dell'UI Impostazioni è usata e ha la traduzione EN" + (missing.length ? " — mancano: " + missing.join(" | ") : ""), missing.length === 0);
    ok("i18n: ogni messaggio d'errore dell'account ha la traduzione EN", authMsgs.length >= 6 && authMsgs.every(k => i18n.includes(JSON.stringify(k) + ": { en:")));
    const goneKeys = ["Collega questo device", "Scollega", "Incolla il token o il link", "Token non valido: servono 64 caratteri esadecimali", "Token rifiutato dal server",
      "Token salvato, ma il server non è raggiungibile: riprova più tardi", "Il link con #sync=<token> funziona nel browser. Nell'app installata sulla Home incolla qui il token (il browser ha uno storage separato).",
      "Questo device è già collegato con un altro token. Sostituirlo?", "Token di sincronizzazione"];
    ok("i18n: le stringhe del token incollato non sono più usate né nel dizionario", goneKeys.every(k => !used.includes(k) && !i18n.includes(JSON.stringify(k) + ":")));
    const navSrc = readFileSync(join(ROOT, "nav.jsx"), "utf8");
    ok("SyncBadge: stato expired con etichetta tradotta", /expired:\s*\{[^}]*t\("Accedi di nuovo"\)/.test(navSrc) && i18n.includes('"Accedi di nuovo": { en:'));
    const onb = readFileSync(join(ROOT, "screens", "onboarding.jsx"), "utf8");
    ok("onboarding: passo Account (AccountPanel), saltabile", /window\.AccountPanel/.test(onb) && /storageKey:\s*"accountEmail"/.test(onb) && i18n.includes('"Più tardi": { en:') && /t\("Più tardi"\)/.test(onb));
    ok("campi password con autocomplete per il portachiavi (username / current-password / new-password)",
      /type="email"[^>]*autoComplete="username"|autoComplete="username"[^>]*type="email"/.test(src) && /autoComplete="current-password"/.test(src) && /autoComplete="new-password"/.test(src) && /type="password"/.test(src));
    ok("nessun <form> nell'UI account", !/<form[\s>]/.test(src) && !/<form[\s>]/.test(onb));
    ok("i18n: le stringhe tolte (import/export vecchi) non sono più usate", !used.some(k => /^Importa (scheda|dieta) \(\.txt\)$|^Il testo attuale|^Importa scheda\.txt e dieta\.txt$/.test(k)));
    const mount = readFileSync(join(ROOT, "app.jsx"), "utf8");
    ok("app.jsx: il link #sync= non è più gestito (niente consumeLinkHash)", !/consumeLinkHash|#sync=/.test(mount));
    ok("impostazioni.jsx: dopo il ripristino si ricalcola la cache piani e si fa il rebaseline",
      /_restoreBackupData\(window\.storage[\s\S]{0,300}SyncV2\.refreshPlans\(\)[\s\S]{0,300}SyncV2\.rebaseline\(\)/.test(src));
    ok("i18n: conferma del ripristino dice che i dati già sincronizzati non tornano indietro (IT+EN)",
      used.includes("Ripristinare il backup? I dati locali verranno sovrascritti, ma i dati già sincronizzati non vengono riportati indietro.") &&
      /"Ripristinare il backup\? I dati locali verranno sovrascritti, ma i dati già sincronizzati non vengono riportati indietro\.": \{ en: "[^"]*won't be rolled back/.test(i18n) &&
      !i18n.includes("I dati locali attuali verranno sovrascritti"));
  }
})();

// ---- Suite Spesa: lista dal piano dieta (plan_diet.data.shopping), fallback CATEGORIES, chiavi di spunta ----
console.log("\nSuite Spesa — shopping dal piano dieta, fallback CATEGORIES, chiavi di spunta item.id");
{
  const sb = { window: {}, console };
  vm.createContext(sb);
  const transformClassic = (f) => babel.transformFileSync(join(ROOT, f), { presets: [["@babel/preset-react", { runtime: "classic", development: false }]] }).code;
  let loaded = true;
  try { for (const f of ["parser.jsx", "planconv.jsx", "screens/spesa.jsx"]) vm.runInContext(transformClassic(f), sb, { filename: f }); }
  catch (e) { loaded = false; ok("spesa.jsx si carica sotto vm — " + e.message.split("\n")[0], false); }
  const w = sb.window;
  const J = (x) => JSON.parse(JSON.stringify(x));
  const SL = w.SpesaLogic;
  ok("spesa.jsx espone window.SPESA_CATEGORIES (= CATEGORIES) e window.SpesaLogic", loaded && Array.isArray(w.SPESA_CATEGORIES) && w.SPESA_CATEGORIES.length > 0 && !!SL && typeof SL.spesaCategories === "function" && typeof SL.shoppingFromCategories === "function");
  if (loaded && SL) {
    const CAT = J(w.SPESA_CATEGORIES);
    // Senza `shopping` (nessun piano, piano senza lista): CATEGORIES con le chiavi di sempre `${cat.id}-${i}`.
    const fb = J(SL.spesaCategories(null));
    ok("senza piano → categorie e voci di CATEGORIES, stesso ordine e stessi testi",
      fb.length === CAT.length && fb.every((c, ci) => c.id === CAT[ci].id && c.title === CAT[ci].title && c.color === CAT[ci].color && c.icon === CAT[ci].icon &&
        c.items.length === CAT[ci].items.length && c.items.every((it, i) => it.name === CAT[ci].items[i].name && it.qty1 === CAT[ci].items[i].qty1 && it.qty2 === CAT[ci].items[i].qty2 && it.note === (CAT[ci].items[i].note == null ? null : CAT[ci].items[i].note))));
    ok("senza piano → chiave di spunta = `${cat.id}-${indice}` (identica a prima), es. proteine-0", fb.every((c) => c.items.every((it, i) => it.id === `${c.id}-${i}`)) && fb[0].items[0].id === "proteine-0");
    ok("piano senza `shopping` → stesso fallback", JSON.stringify(J(SL.spesaCategories({ name: "x", variants: [] }))) === JSON.stringify(fb));
    ok("`shopping` non array → fallback", JSON.stringify(J(SL.spesaCategories({ shopping: "boh" }))) === JSON.stringify(fb));
    // Con `shopping` nel piano: quelle categorie, id dell'item come chiave.
    const plan = { shopping: [
      { id: "cat-a", title: "Frutta", color: "#30D158", icon: "leaf", items: [{ id: "uuid-1", name: "Mele", qty1: "1 kg", qty2: "500 g", note: "bio" }, { id: "uuid-2", name: "Pere", qty1: "2", qty2: "1", note: null }] },
      { id: "cat-b", title: "Vuota", color: "#FF453A", items: [] },
    ] };
    const pc = J(SL.spesaCategories(plan));
    ok("con `shopping` → mostra le categorie del piano (non CATEGORIES)", pc.length === 2 && pc[0].id === "cat-a" && pc[0].title === "Frutta" && pc[0].color === "#30D158" && pc[0].icon === "leaf");
    ok("con `shopping` → la chiave di spunta è item.id", pc[0].items.map((it) => it.id).join() === "uuid-1,uuid-2" && pc[0].items[0].name === "Mele" && pc[0].items[0].qty2 === "500 g" && pc[0].items[0].note === "bio" && pc[0].items[1].note === null);
    ok("categoria senza icona → icona di riserva; senza voci → items []", pc[1].icon === "spark" && pc[1].items.length === 0);
    ok("`shopping: []` (lista svuotata di proposito) → lista vuota, NON il fallback", J(SL.spesaCategories({ shopping: [] })).length === 0);

    // Migrazione: shoppingFromCategories(CATEGORIES) → item proteine-0…, stessi testi, `note` assente → null.
    const mig = J(SL.shoppingFromCategories(w.SPESA_CATEGORIES));
    ok("migrazione: item proteine-0… con gli stessi testi di CATEGORIES, note assente → null",
      mig[0].id === "proteine" && mig[0].items[0].id === "proteine-0" && mig[0].items[0].name === CAT[0].items[0].name && mig[0].items[0].qty1 === CAT[0].items[0].qty1 &&
      mig[0].items[0].note === null && mig[0].items[1].note === CAT[0].items[1].note && mig[0].icon === "flame" && mig[0].items.every((it, i) => it.id === `proteine-${i}`));
    ok("migrazione: stesse chiavi di spunta del fallback (le spunte esistenti restano valide)", JSON.stringify(mig) === JSON.stringify(fb));
    ok("migrazione: ogni voce ha id univoco, qty1 e qty2", (() => { const ids = mig.flatMap((c) => c.items.map((it) => it.id)); return new Set(ids).size === ids.length && mig.every((c) => c.items.every((it) => typeof it.qty1 === "string" && typeof it.qty2 === "string")); })());

    // planconv: `shopping` non cambia ciò che le schermate leggono dal piano (toLegacyDieta) e il piano si copia intero.
    const dietaTxt = readFileSync(join(ROOT, "dieta.txt"), "utf8");
    const dp = J(w.PlanConv.dietPlanFromText(dietaTxt, { id: "diet-x", name: "x", validFrom: "2026-11-03" }));
    const withShop = { ...dp.data, shopping: mig };
    ok("toLegacyDieta ignora `shopping` (stessa forma di parseDieta, nessuna chiave in più)",
      JSON.stringify(J(w.PlanConv.toLegacyDieta(withShop))) === JSON.stringify(J(w.PlanConv.toLegacyDieta(dp.data))) && !("shopping" in J(w.PlanConv.toLegacyDieta(withShop))));
    ok("planToText non si altera con `shopping`", w.PlanConv.planToText(null, withShop) === w.PlanConv.planToText(null, dp.data));
    ok("activePlan conserva `shopping` nel data del piano", (() => { const a = J(w.PlanConv.activePlan([{ collection: "dietPlan", id: "diet-x", updatedAt: 1, data: withShop }], "dietPlan")); return JSON.stringify(a.data.shopping) === JSON.stringify(mig); })());
  }
  // Sorgente: la schermata usa item.id (non ricostruisce più la chiave dall'indice) e legge plan_diet.
  const spesaSrc = readFileSync(join(ROOT, "screens", "spesa.jsx"), "utf8");
  const comp = spesaSrc.slice(spesaSrc.indexOf("const SpesaItem"));
  ok("spesa.jsx: spunte per item.id, mai `${cat.id}-${i}` nei componenti", /checked\[it\.id\]/.test(comp) && /onToggle\(it\.id\)/.test(comp) && !/\$\{cat\.id\}-\$\{i\}/.test(comp));
  ok("spesa.jsx: legge plan_diet (e si aggiorna col sync) e non itera più CATEGORIES nei componenti", /get\("plan_diet"/.test(comp) && /"plan_diet"\]/.test(comp) && !/CATEGORIES/.test(comp));
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
