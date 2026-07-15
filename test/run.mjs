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

// ---- Esito ----
console.log("\n" + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
