import { createRequire } from "module";
const require = createRequire(import.meta.url);
const fs = require("fs");
const babel = require("@babel/core");

global.window = {};
const code = babel.transformFileSync("parser.jsx", { presets: ["@babel/preset-react"] }).code;
eval(code);

const text = fs.readFileSync("scheda.txt", "utf8");
const { days } = window.parseScheda(text);

let ok = true;
const expect = (cond, msg) => { if (!cond) { ok = false; console.error("FAIL:", msg); } };

expect(Array.isArray(days), "days deve essere un array");
expect(days && days.length === 5, `days.length atteso 5, ricevuto ${days && days.length}`);
expect(days && days[0] && days[0].key === "Giorno 1", `day[0].key atteso 'Giorno 1', ricevuto '${days && days[0] && days[0].key}'`);
expect(days && days[0] && days[0].num === 1, "day[0].num atteso 1");
expect(days && days[0] && /push/i.test(days[0].name), `day[0].name dovrebbe contenere 'Push', ricevuto '${days && days[0] && days[0].name}'`);
expect(days && days[0] && days[0].exercises.length > 0, "day[0] deve avere esercizi");
expect(days && days[0] && days[0].focus.length > 0, "day[0] deve avere focus");
// la riga "# Reducibile a 4 giorni ... Giorno 5" NON deve creare un 6° giorno
expect(days && days.length === 5, "una riga con 'Giorno 5' nel testo non deve creare un giorno extra");
// legacy fallback
const legacy = window.parseScheda("# Upper A\nEsercizio | Serie | Rip | Recupero | Note\nPanca | 3 | 8-10 | 90 | Muscoli: petto\n---\n# Lower\nEsercizio | Serie | Rip | Recupero | Note\nSquat | 3 | 8-10 | 120 | Muscoli: quadricipiti");
expect(legacy.days.length === 2, `legacy days.length atteso 2, ricevuto ${legacy.days.length}`);
expect(legacy.days[0].key === "Upper A", `legacy key atteso 'Upper A', ricevuto '${legacy.days[0] && legacy.days[0].key}'`);

// validazione import end-to-end (Task 6)
const v = window.parseScheda(text);
console.log("validazione import:", (v.days && v.days.length >= 1) ? "OK (" + v.days.length + " giorni)" : "FALLITA");

console.log(ok ? "OK — tutti i check del parser passano" : "ERRORI nel parser (vedi sopra)");
process.exit(ok ? 0 : 1);
