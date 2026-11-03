// Carica parser.jsx (PWA) in un sandbox node:vm, come fa test/run.mjs.
// Usa @babel/core + @babel/preset-react dal node_modules alla radice del repo.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");

export function loadParser() {
  const require = createRequire(join(REPO_ROOT, "package.json"));
  const babel = require("@babel/core");
  const code = babel.transformFileSync(join(REPO_ROOT, "parser.jsx"), {
    presets: ["@babel/preset-react"],
  }).code;
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "parser.jsx" });
  const { parseScheda, parseDieta } = sandbox.window;
  // JSON round-trip: gli oggetti nati nel contesto vm hanno prototipi diversi
  // (deepStrictEqual fallirebbe); così il chiamante riceve oggetti "normali".
  const plain = (fn) => (text) => JSON.parse(JSON.stringify(fn(text)));
  return { parseScheda: plain(parseScheda), parseDieta: plain(parseDieta) };
}
