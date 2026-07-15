// dev/gen-defaults.mjs — rigenera defaults.jsx dai .txt del repo.
// Lancio: npm run gen:defaults. Il testo va incorporato COM'È (drift-test in run.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const scheda = readFileSync(join(ROOT, "scheda.txt"), "utf8");
const dieta = readFileSync(join(ROOT, "dieta.txt"), "utf8");

const out = `// defaults.jsx — GENERATO da dev/gen-defaults.mjs. NON modificare a mano.
// Fallback testuale (stesso formato dei .txt) usato quando storage è vuoto
// (primissima apertura offline / fetch fallito). Rigenera: npm run gen:defaults.
window.SCHEDA_TXT_FALLBACK = ${JSON.stringify(scheda)};
window.DIETA_TXT_FALLBACK = ${JSON.stringify(dieta)};
`;
writeFileSync(join(ROOT, "defaults.jsx"), out);
console.log("defaults.jsx rigenerato (" + scheda.length + " + " + dieta.length + " char)");
