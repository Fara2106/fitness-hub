// planconv.jsx — piani strutturati (workoutPlan / dietPlan del backend) ⇄ forme del parser.
//
//   window.PlanConv = {
//     workoutPlanFromText(text, {id,name,validFrom}) → {collection:"workoutPlan", id, data}
//     dietPlanFromText(text, {id,name,validFrom})    → {collection:"dietPlan",    id, data}
//     toLegacyScheda(planData) → { days: [...] }          (forma di parseScheda)
//     toLegacyDieta(planData)  → { riposo, mattina, … }   (forma di parseDieta)
//     planToText(workoutData, dietData) → string          (testo compatto per il prompt del Coach)
//     activePlan(records, collection) → { id, data } | null
//   }
//
// Dipende da parser.jsx (parseScheda/parseDieta + tabelle _MEAL_META/_SUPP_COLORS/…
// esposte su window); le legge a chiamata, non al caricamento. Niente DOM/storage:
// gira identico nel browser e in node:vm (backend/migrate/plans.mjs lo carica così).
// Gli id sono path-like e deterministici: una migrazione ripetuta dà gli stessi id.
(function () {
  // ── Scheda ────────────────────────────────────────────────────────────────
  function workoutPlanFromText(text, { id, name, validFrom }) {
    const parsed = window.parseScheda(text);
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

  // ── Dieta ─────────────────────────────────────────────────────────────────
  // Stessi titoli di sezione di parser.jsx (_SECTION_KEYS); i titoli dei pasti
  // arrivano da _MEAL_META (window._MEAL_META), così non possono divergere.
  const SECTIONS = {
    "GIORNO SENZA ALLENAMENTO": { key: "riposo", name: "Giorno senza allenamento", training: null },
    "ALLENAMENTO MATTINA": { key: "mattina", name: "Allenamento mattina", training: { time: "08:00" } }, // 08:00 = _WO_START.mattina del parser (pre-WO 07:15 = 45' prima)
    "ALLENAMENTO ORE 17": { key: "ore17", name: "Allenamento ore 17", training: { time: "17:00" } },
    "ALLENAMENTO ORE 21": { key: "ore21", name: "Allenamento ore 21", training: { time: "21:00" } },
    "ALLENAMENTO ORE 22": { key: "ore22", name: "Allenamento ore 22", training: { time: "22:00" } },
  };
  const LEGACY_KEYS = Object.keys(SECTIONS).map((h) => SECTIONS[h].key); // le cinque sezioni di parseDieta
  const NO_FILE_SUPPS = [];

  const mealHeadings = () => Object.keys(window._MEAL_META).sort((a, b) => b.length - a.length);
  const isExcluded = (t) => window._EXCLUDED_FOODS.some((e) => t.toLowerCase().includes(e));
  const isMealHeading = (line, heads) => heads.some((k) => line.toUpperCase().startsWith(k));

  // Legge il testo e restituisce, per ogni sezione, i pasti con il solo contenuto
  // (options/lines); titolo e orario arrivano da parseDieta (stesso indice).
  function walkDiet(text) {
    const heads = mealHeadings();
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
      if (isMealHeading(line, heads)) {
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

  function dietPlanFromText(text, { id, name, validFrom }) {
    const parsed = window.parseDieta(text);
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

  // ── Adattatori verso le forme del parser ──────────────────────────────────
  // Stessa regola di parseScheda per le ripetizioni di una serie: "8-12" → 8.
  function ripLower(reps) {
    const s = reps == null ? "" : String(reps);
    const m = s.match(/(\d+)[-–](\d+)/);
    return m ? parseInt(m[1]) : (parseInt(s) || 10);
  }

  // Il piano non conserva il numero di "Giorno N" scritto nel file, solo l'ordine:
  // num = posizione + 1, key = "Giorno N" (la chiave stabile che usano exId e
  // schedaSelectedDay; per le schede numerate dal file coincide con quella del parser).
  function toLegacyScheda(planData) {
    const days = ((planData && planData.days) || []).map((d, i) => {
      const altMap = {};
      const exercises = (d.exercises || []).map((ex) => {
        const alternatives = ex.alternatives || [];
        if (alternatives.length) altMap[String(ex.name).toLowerCase()] = alternatives;
        const rip = ripLower(ex.reps);
        return {
          name: ex.name,
          muscles: ex.muscles || [],
          sets: Array.from({ length: ex.sets }, () => ({ peso: 0, rip })),
          rest: ex.restSec,
          notes: ex.notes || "",
          ripRange: ex.reps,
          history: [],
          alternatives,
        };
      });
      return { num: i + 1, key: "Giorno " + (i + 1), name: d.name, focus: d.focus || [], exercises, altMap };
    });
    return { days };
  }

  // Un pasto strutturato → { time, emoji, title, primary, others } come parseDieta:
  // opzioni "scegli 1": la prima in primary, le altre in others; righe con più
  // scelte: prime 4 in primary, il resto in "Altre opzioni: …" (others).
  // Limite noto: nel piano non resta l'ordine reciproco tra opzioni e righe, né se
  // il file aveva righe "- Opzione N:" o "- voce" in un pasto "scegli 1" → qui
  // vale sempre "prima opzione in primary, il resto in others".
  function legacyMeal(m, emojiByTitle) {
    const primary = [], others = [];
    (m.options || []).forEach((o, k) => (k === 0 && !primary.length ? primary : others).push({ food: o.text, qty: "" }));
    (m.lines || []).forEach((l) => {
      const ch = l.choices || [];
      if (!ch.length) return;
      if (l.label == null) { ch.forEach((c) => primary.push({ food: c, qty: "" })); return; }
      primary.push({ food: `${l.label}: ${ch.slice(0, 4).join(" | ")}`, qty: "" });
      if (ch.length > 4) others.push({ food: `Altre opzioni: ${ch.slice(4).join(" | ")}`, qty: "" });
    });
    return { time: m.time, emoji: emojiByTitle[m.name] || "🍽️", title: m.name, primary, others };
  }

  function toLegacyDieta(planData) {
    if (!planData || !Array.isArray(planData.variants)) return null;
    const META = window._MEAL_META, DEF = window._INTEGRATORI_DEFAULT, COLORS = window._SUPP_COLORS;
    const emojiByTitle = {};
    Object.keys(META).forEach((k) => { emojiByTitle[META[k].title] = META[k].emoji; });
    const out = {};
    planData.variants.forEach((v) => {
      const base = DEF[v.key] || [];
      // Gli integratori sono solo quelli del piano (nessuna lista fissa); la lista
      // curata serve solo da lookup del colore per i prodotti noti.
      const integratori = (v.supplements && v.supplements.length)
        ? v.supplements.map((s) => {
            const known = base.find((b) => b.type === s.key);
            return { name: s.name, time: s.moment, sortTime: s.time, color: known ? known.color : (COLORS[s.key] || "#8E8E93"), type: s.key };
          })
        : [];
      out[v.key] = { meals: (v.meals || []).map((m) => legacyMeal(m, emojiByTitle)), integratori };
    });
    // Come parseDieta: le cinque sezioni esistono sempre.
    LEGACY_KEYS.forEach((k) => { if (!out[k]) out[k] = { meals: [], integratori: [] }; });
    return out;
  }

  // ── Testo per il Coach ────────────────────────────────────────────────────
  const TEXT_MAX = 3000;
  const CUT = "\n[…troncato]";
  const clip = (s) => (s.length <= TEXT_MAX ? s : s.slice(0, TEXT_MAX - CUT.length) + CUT);
  const firstN = (arr, n) => (arr.length > n ? arr.slice(0, n).join(" | ") + " | …" : arr.join(" | "));

  function workoutText(data) {
    if (!data || !Array.isArray(data.days)) return "";
    const rows = [`SCHEDA ALLENAMENTO${data.name ? " – " + data.name : ""}`];
    data.days.forEach((d, i) => {
      const focus = (d.focus || []).length ? ` (${d.focus.join(", ")})` : "";
      const ex = (d.exercises || []).map((e) => `${e.name} ${e.sets}x${e.reps} rec ${e.restSec}s`);
      rows.push(`Giorno ${i + 1} ${d.name}${focus}: ${ex.join("; ")}`);
    });
    return rows.join("\n");
  }

  function dietText(data) {
    if (!data || !Array.isArray(data.variants)) return "";
    const rows = [`PIANO ALIMENTARE${data.name ? " – " + data.name : ""}`];
    data.variants.forEach((v) => {
      rows.push(`[${v.name}]`);
      (v.meals || []).forEach((m) => {
        const parts = [];
        if ((m.options || []).length) parts.push(firstN(m.options.map((o) => o.text), 2));
        (m.lines || []).forEach((l) => parts.push(l.label == null ? firstN(l.choices, 2) : `${l.label}: ${firstN(l.choices, 2)}`));
        rows.push(`${m.name} ${m.time}: ${parts.join("; ")}`);
      });
      if ((v.supplements || []).length) {
        rows.push("Integratori: " + v.supplements.map((s) => s.name).join(", "));
      }
    });
    return rows.join("\n");
  }

  // Testo compatto (italiano) di scheda e dieta per il prompt del Coach: una
  // sezione per piano, ciascuna ≤ 3000 caratteri (taglio con "[…troncato]").
  function planToText(workoutData, dietData) {
    return [workoutText(workoutData), dietText(dietData)].filter(Boolean).map(clip).join("\n\n");
  }

  // ── Piano attivo ──────────────────────────────────────────────────────────
  // Tra i record della collezione: status "active" e non tombstone; vince il
  // validFrom più recente (a pari data: updatedAt, poi id, per essere deterministico).
  function activePlan(records, collection) {
    let best = null;
    (records || []).forEach((r) => {
      if (!r || r.collection !== collection || r.deleted || !r.data || r.data.status !== "active") return;
      const k = [r.data.validFrom || "", r.updatedAt || 0, r.id || ""];
      if (!best || k[0] > best.k[0] || (k[0] === best.k[0] && (k[1] > best.k[1] || (k[1] === best.k[1] && k[2] > best.k[2])))) {
        best = { k, rec: r };
      }
    });
    return best ? { id: best.rec.id, data: best.rec.data } : null;
  }

  const PlanConv = { workoutPlanFromText, dietPlanFromText, toLegacyScheda, toLegacyDieta, planToText, activePlan };
  window.PlanConv = PlanConv;
})();
