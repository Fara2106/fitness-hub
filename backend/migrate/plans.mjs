// Converter scheda.txt / dieta.txt → record workoutPlan / dietPlan strutturati.
// Gli id sono path-like e deterministici: una migrazione ripetuta dà gli stessi id.
import { loadParser } from "./load-parser.mjs";

const NO_FILE_SUPPS = [];

// ── Scheda ──────────────────────────────────────────────────────────────────
export function workoutPlanFromText(text, { id, name, validFrom }) {
  const { parseScheda } = loadParser();
  const parsed = parseScheda(text);
  const days = parsed.days.map((d, i) => {
    const dayId = `${id}/d${i}`;
    return {
      id: dayId,
      name: d.name,
      focus: d.focus,
      exercises: d.exercises.map((ex, j) => ({
        id: `${dayId}/e${j}`,
        name: ex.name,
        sets: ex.sets.length,
        reps: ex.ripRange,
        restSec: ex.rest,
        notes: ex.notes || "",
        muscles: ex.muscles,
        alternatives: ex.alternatives || [],
      })),
    };
  });
  return {
    collection: "workoutPlan",
    id,
    data: { name, status: "active", validFrom, validTo: null, days },
  };
}

// ── Dieta ───────────────────────────────────────────────────────────────────
// Stessi titoli di sezione e di pasto di parser.jsx (_SECTION_KEYS / _MEAL_META).
const SECTIONS = {
  "GIORNO SENZA ALLENAMENTO": { key: "riposo", name: "Giorno senza allenamento", training: null },
  "ALLENAMENTO MATTINA": { key: "mattina", name: "Allenamento mattina", training: { time: "08:00" } }, // 08:00 = _WO_START.mattina del parser (pre-WO 07:15 = 45' prima)
  "ALLENAMENTO ORE 17": { key: "ore17", name: "Allenamento ore 17", training: { time: "17:00" } },
  "ALLENAMENTO ORE 21": { key: "ore21", name: "Allenamento ore 21", training: { time: "21:00" } },
  "ALLENAMENTO ORE 22": { key: "ore22", name: "Allenamento ore 22", training: { time: "22:00" } },
};
const MEAL_HEADINGS = [
  "COLAZIONE", "SPUNTINO", "PRANZO", "MERENDA ALLE 18:00", "MERENDA", "PRE-WORKOUT", "POST-WORKOUT",
  "PRE WO", "POST WO", "PRE-WO", "POST-WO", "POST ALLENAMENTO", "CENA",
].sort((a, b) => b.length - a.length);
const EXCLUDED = ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"];
const isExcluded = (t) => EXCLUDED.some((e) => t.toLowerCase().includes(e));
const isMealHeading = (line) => MEAL_HEADINGS.some((k) => line.toUpperCase().startsWith(k));

// Legge il testo e restituisce, per ogni sezione, i pasti con il solo contenuto
// (options/lines); titolo e orario arrivano da parseDieta (stesso indice).
function walkDiet(text) {
  const sections = [];
  let sec = null, meal = null, inSupps = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "---") { sec = null; meal = null; inSupps = false; continue; }
    const head = SECTIONS[line.replace(/^#\s+/, "")];
    if (line.startsWith("# ") && head) {
      sec = { ...head, meals: [], hasSuppBlock: false };
      sections.push(sec);
      meal = null; inSupps = false;
      continue;
    }
    if (!sec) continue;
    if (line.toUpperCase().startsWith("INTEGRATORI")) { inSupps = true; meal = null; sec.hasSuppBlock = true; continue; }
    if (inSupps && line.startsWith("- ")) continue;
    if (line.startsWith("#")) continue;
    if (isMealHeading(line)) {
      inSupps = false;
      meal = { pick1: /scegli\s*1/i.test(line), options: [], lines: [] };
      sec.meals.push(meal);
      continue;
    }
    if (!meal) continue;

    if (/^- Opzione \d+:/.test(line)) {
      const t = line.replace(/^- Opzione \d+:\s*/, "").trim();
      if (t && !isExcluded(t)) meal.options.push(t);
    } else if (line.startsWith("- ")) {
      const t = line.slice(2).trim();
      if (!t || t.toLowerCase().startsWith("note:") || isExcluded(t)) continue;
      if (meal.pick1) meal.options.push(t);
      else meal.lines.push({ label: null, choices: [t] });
    } else if (/^Note:/i.test(line)) {
      continue;
    } else if (/^Nessun/i.test(line)) {
      meal.lines.push({ label: null, choices: [line] });
    } else if (line.includes(":")) {
      const ci = line.indexOf(":");
      const label = line.slice(0, ci).trim();
      const rest = line.slice(ci + 1);
      if (line.includes("|")) {
        const choices = rest.split("|").map((s) => s.trim()).filter(Boolean).filter((s) => !isExcluded(s));
        if (choices.length) meal.lines.push({ label, choices });
      } else {
        const v = rest.trim();
        if (v && !isExcluded(v)) meal.lines.push({ label, choices: [v] });
      }
    }
  }
  return sections;
}

export function dietPlanFromText(text, { id, name, validFrom }) {
  const { parseDieta } = loadParser();
  const parsed = parseDieta(text);
  const variants = walkDiet(text).map((sec, i) => {
    const vId = `${id}/v${i}`;
    const p = parsed[sec.key];
    if (p.meals.length !== sec.meals.length) {
      throw new Error(`dieta: ${sec.key} ha ${sec.meals.length} pasti nel testo ma ${p.meals.length} per parseDieta`);
    }
    const meals = sec.meals.map((m, j) => {
      const mId = `${vId}/m${j}`;
      return {
        id: mId,
        name: p.meals[j].title,
        time: p.meals[j].time,
        options: m.options.map((t, k) => ({ id: `${mId}/o${k}`, text: t })),
        lines: m.lines.map((l, k) => ({ id: `${mId}/l${k}`, label: l.label, choices: l.choices })),
      };
    });
    // Integratori SOLO dal blocco INTEGRATORI del file (mai dalla lista fissa).
    const supplements = sec.hasSuppBlock
      ? p.integratori.map((s, k) => ({ id: `${vId}/s${k}`, key: s.type, name: s.name, moment: s.time, time: s.sortTime }))
      : NO_FILE_SUPPS;
    return { id: vId, key: sec.key, name: sec.name, training: sec.training, meals, supplements };
  });
  return {
    collection: "dietPlan",
    id,
    data: { name, status: "active", validFrom, validTo: null, variants },
  };
}
