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

// ---- Esito ----
console.log("\n" + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
