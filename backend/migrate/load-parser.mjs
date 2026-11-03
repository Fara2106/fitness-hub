// Carica parser.jsx (PWA) in un sandbox node:vm, come fa test/run.mjs.
// Usa @babel/core + @babel/preset-react dal node_modules alla radice del repo.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");

// Compila e esegue i .jsx indicati (in ordine) nello stesso sandbox con uno shim window.
function loadJsx(files) {
  const require = createRequire(join(REPO_ROOT, "package.json"));
  const babel = require("@babel/core");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  for (const f of files) {
    const code = babel.transformFileSync(join(REPO_ROOT, f), { presets: ["@babel/preset-react"] }).code;
    vm.runInContext(code, sandbox, { filename: f });
  }
  return sandbox.window;
}

// parser.jsx + planconv.jsx (la logica dei piani vive nella PWA, qui solo caricata).
export function loadPlanConv() {
  const { PlanConv } = loadJsx(["parser.jsx", "planconv.jsx"]);
  // JSON round-trip: gli oggetti nati nel contesto vm hanno prototipi diversi.
  const plain = (fn) => (...a) => JSON.parse(JSON.stringify(fn(...a)));
  return {
    workoutPlanFromText: plain(PlanConv.workoutPlanFromText),
    dietPlanFromText: plain(PlanConv.dietPlanFromText),
  };
}

export function loadParser() {
  const { parseScheda, parseDieta } = loadJsx(["parser.jsx"]);
  // JSON round-trip: gli oggetti nati nel contesto vm hanno prototipi diversi
  // (deepStrictEqual fallirebbe); così il chiamante riceve oggetti "normali".
  const plain = (fn) => (text) => JSON.parse(JSON.stringify(fn(text)));
  return { parseScheda: plain(parseScheda), parseDieta: plain(parseDieta) };
}
