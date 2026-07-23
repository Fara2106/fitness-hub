// dev/build.mjs — precompila i .jsx in un unico bundle JS (app.compiled.js).
//
// PERCHÉ: prima index.html caricava Babel standalone (~3 MB) e compilava
// ~370 KB di JSX A OGNI AVVIO sul device → secondi di attesa su iPhone.
// Ora la compilazione avviene una volta sola qui; index.html carica solo
// app.compiled.js (script classico) e Babel standalone è sparito dal runtime.
//
// COME: ogni file è compilato con @babel/preset-react (stessa trasformazione
// del vecchio Babel standalone e di npm test) e incapsulato in una IIFE, così
// i top-level di file diversi non collidono. La comunicazione tra file resta
// quella di sempre: export espliciti su window.* (vedi CLAUDE.md).
//
// USO:  npm run build   (obbligatorio dopo ogni modifica ai .jsx)
// Il drift è coperto da `npm test` (Suite bundle: rigenera e confronta byte).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ordine di caricamento (ex <script type="text/babel"> in index.html):
// un globale deve essere definito PRIMA del file che lo usa.
export const BUNDLE_FILES = [
  // Core utilities
  "storage.jsx",
  "api.jsx",
  "push.jsx",
  "defaults.jsx",
  "parser.jsx",
  // Components
  "i18n.jsx",
  "icons.jsx",
  "ui.jsx",
  "motion.jsx",
  "anatomy.jsx",
  "nav.jsx",
  "schedaState.jsx",
  "progress.jsx",
  "insights.jsx",
  // Screens
  "screens/onboarding.jsx",
  "screens/dashboard.jsx",
  "screens/scheda.jsx",
  "screens/dieta.jsx",
  "screens/spesa.jsx",
  "screens/coach.jsx",
  "screens/storico.jsx",
  "screens/impostazioni.jsx",
  "screens/promemoria.jsx",
  // App frame + mount
  "app.jsx",
  "mount.jsx",
];

export const BUNDLE_PATH = join(ROOT, "app.compiled.js");

export function buildBundle() {
  const parts = [
    "/* app.compiled.js — GENERATO da dev/build.mjs, NON modificare a mano.",
    " * Sorgente: i .jsx del repo (vedi BUNDLE_FILES in dev/build.mjs).",
    " * Rigenera con `npm run build`; drift-test in `npm test` (Suite bundle). */",
  ].join("\n");
  const out = [parts];
  for (const rel of BUNDLE_FILES) {
    const { code } = babel.transformFileSync(join(ROOT, rel), {
      // runtime "classic" = React.createElement dal globale React (CDN).
      // Il default di Babel 8 ("automatic") emette `import` ESM → inutilizzabile
      // in uno script classico senza bundler.
      presets: [["@babel/preset-react", { runtime: "classic", development: false }]],
      comments: false,   // i commenti restano nei sorgenti .jsx
      compact: false,    // righe leggibili → stack trace utili in Diagnostica
    });
    // IIFE per file: i top-level (const/let/function) restano privati al file;
    // ciò che serve altrove è già esportato esplicitamente su window.*.
    out.push(`// ══ ${rel} ══\n;(function () {\n${code}\n})();`);
  }
  return out.join("\n\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundle = buildBundle();
  writeFileSync(BUNDLE_PATH, bundle);
  const kb = (bundle.length / 1024).toFixed(0);
  console.log(`app.compiled.js scritto (${BUNDLE_FILES.length} file, ${kb} KB)`);
}
