// Converter dati esistenti → Change[] per il backend di sync (Task 5).
//   recordsFromSheet : risposte del Worker legacy (foglio Google)
//   recordsFromBackup: JSON di Impostazioni → Backup della PWA
//   mergeChanges     : unisce più liste (stesso collection/id → merge superficiale)
// Puro: nessun I/O. `opts.now` rende deterministici i timestamp delle voci senza data.

import { validateChange } from "../src/validate.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_KEY_RE = /^(.+_)(\d{4}-\d{2}-\d{2})$/;

// Oggi scritti nel codice della PWA (coach/dieta), d'ora in poi impostazione.
const EXCLUDED_FOODS = ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"];

// Mai migrate (segreti, diagnostica, code di sync, testo grezzo dei piani, flag locali).
const NEVER_MIGRATED = new Set([
  "groqApiKey", "errorLog", "sheetsQueue", "settingsPending", "settingsEdits",
  "groqModel", "schedaData", "dietaData", "onboardingDone",
]);
const isNeverMigrated = (k) => NEVER_MIGRATED.has(k) || /_src$/.test(k) || /_at$/.test(k);

// ── helper ──────────────────────────────────────────────────────────────────
const noon = (date) => new Date(`${date}T12:00:00`).getTime();
// Data di calendario vera (niente 2026-13-45, né 2026-02-30 che slitta a marzo)
// con mezzogiorno locale finito e > 0 (niente date prima del 1970).
const isDate = (s) => {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const ms = noon(s);
  return Number.isFinite(ms) && ms > 0 && localDateKey(ms) === s;
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nameKey = (s) => String(s == null ? "" : s).trim().toLowerCase();

function localDateKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Le settings del foglio sono stringhe JSON; il backup ha valori già parsati.
// Tollera entrambe le forme: stringa JSON valida → parse, altrimenti il valore com'è.
function parseMaybe(v) {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
}

// "72,5" → 72.5; non numerico → null.
function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Valore di setting: numeri in stringa ("72") diventano numeri, il resto com'è.
function settingValue(v) {
  const n = typeof v === "string" ? toNumber(v) : null;
  return n !== null ? n : v;
}
const hasValue = (v) => v !== null && v !== undefined && v !== "";

const change = (collection, id, data, updatedAt) => ({ collection, id, data, updatedAt });

// dayState = un record per campo del giorno (Ruling 7: LWW per record, così check-in, note e cardio
// scritti da device diversi nello stesso giorno non si cancellano a vicenda):
//   id `${date}:${field}` (checkIn|hydration|notes|rest|dietVariant), data { date, field, value };
//   cardio: un record per attività, id `${date}:cardio:${activityId}`, value = attività senza `when`.
const dayField = (date, field, value, at) => change("dayState", `${date}:${field}`, { date, field, value }, at);
const cardioChange = (date, entry, at) =>
  change("dayState", `${date}:cardio:${entry.id}`, { date, field: "cardio", value: entry }, at);

// ── indici sui piani migrati ────────────────────────────────────────────────
function indexWorkout(plan) {
  const days = (plan && plan.data && plan.data.days) || [];
  const byName = new Map(); // nome minuscolo → { ex, planId } (prima occorrenza)
  for (const d of days) for (const ex of d.exercises || []) {
    const k = nameKey(ex.name);
    if (!byName.has(k)) byName.set(k, { ex, planId: plan.id });
  }
  return { plan, days, byName };
}

// Per ogni variante (nell'ordine del piano): pasti `${time}|${name}` → mealId e
// integratori key → supplementId (se una variante ripete un key vince il primo).
function indexDiet(plan) {
  const variants = (plan && plan.data && plan.data.variants) || [];
  return variants.map((v) => {
    const meals = new Map();
    for (const m of v.meals || []) {
      const k = `${m.time}|${m.name}`;
      if (!meals.has(k)) meals.set(k, m.id);
    }
    const supps = new Map();
    for (const s of v.supplements || []) if (!supps.has(s.key)) supps.set(s.key, s.id);
    return { key: v.key, meals, supps };
  });
}

function newStats(stats) {
  const s = stats || {};
  s.discarded = Object.assign({
    mealCheck: 0, supplementCheck: 0, setLog: 0, setLogPositional: 0, workoutSession: 0, cardio: 0, invalid: 0,
  }, s.discarded);
  s.positional = s.positional || { count: 0, from: null, to: null };
  s.ignoredKeys = s.ignoredKeys || {};
  s.invalidSamples = s.invalidSamples || [];
  return s;
}

// ── mapping condivisi ───────────────────────────────────────────────────────
function exNotesChanges(notes, now) {
  const out = [];
  if (!isObj(notes)) return out;
  for (const [name, text] of Object.entries(notes)) {
    const k = nameKey(name);
    if (!k || typeof text !== "string" || text.trim() === "") continue;
    out.push(change("exerciseNote", k, { exerciseName: k, text }, now));
  }
  return out;
}

function shoppingCheckChanges(checked, now) {
  const out = [];
  if (!isObj(checked)) return out;
  for (const [key, v] of Object.entries(checked)) {
    if (key === "") continue;
    out.push(change("shoppingCheck", key, { checked: !!v }, now));
  }
  return out;
}

function shoppingExtraChanges(extra, now) {
  const out = [];
  if (!Array.isArray(extra)) return out;
  for (const item of extra) {
    if (!isObj(item) || !hasValue(item.id)) continue;
    out.push(change("shoppingExtra", String(item.id), item, now));
  }
  return out;
}

const excludedFoodsChange = (now) => change("settings", "excludedFoods", { value: EXCLUDED_FOODS.slice() }, now);

// ── foglio Google ───────────────────────────────────────────────────────────
export function recordsFromSheet(sheet, plans, opts = {}) {
  const now = opts.now ?? Date.now();
  const st = newStats(opts.stats);
  const { checkIn, pesoCorporeo, pesi, settings } = sheet || {};
  const wi = indexWorkout(plans && plans.workout);
  const out = [];

  // getCheckIn → dayState `${date}:checkIn` (stessa data: vince l'ultima riga, via mergeChanges)
  for (const r of Array.isArray(checkIn) ? checkIn : []) {
    if (!r) continue;
    if (!isDate(r.date)) { st.discarded.invalid++; continue; }
    const sleep = Number(r.sleep) || 0, energy = Number(r.energy) || 0;
    if (!sleep && !energy) continue; // come la PWA: riga vuota ignorata
    out.push(dayField(r.date, "checkIn", { sleep, energy, ailments: r.ailments || "" }, noon(r.date)));
  }

  // getPesoCorporeo → bodyWeight
  for (const r of Array.isArray(pesoCorporeo) ? pesoCorporeo : []) {
    if (!r) continue;
    if (!isDate(r.date)) { st.discarded.invalid++; continue; }
    const kg = toNumber(r.weight);
    if (kg === null || kg <= 0) continue;
    out.push(change("bodyWeight", r.date, { date: r.date, kg }, noon(r.date)));
  }

  // getPesi → setLog (setN 1-based nel foglio → setIndex 0-based)
  for (const [name, rows] of Object.entries(isObj(pesi) ? pesi : {})) {
    const hit = wi.byName.get(nameKey(name));
    const exerciseId = hit ? hit.ex.id : `name:${nameKey(name)}`;
    const planId = hit ? hit.planId : null;
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r) continue;
      if (!isDate(r.date)) { st.discarded.invalid++; continue; }
      const setN = Number(r.setN);
      if (!Number.isInteger(setN) || setN < 1) continue;
      const setIndex = setN - 1;
      // Il foglio salva 0 quando il peso manca (Number("") = 0) e in `rip` le ripetizioni
      // del piano, non quelle fatte: peso 0 → "", reps sempre null.
      const weight = hasValue(r.peso) && toNumber(r.peso) !== 0 ? String(r.peso) : "";
      out.push(change("setLog", `${r.date}:${exerciseId}:${setIndex}`, {
        date: r.date, exerciseId, exerciseName: name, planId, setIndex,
        weight, reps: null, done: true, substitutedWith: null,
      }, noon(r.date)));
    }
  }

  // getSettings
  const s = isObj(settings) ? settings : {};
  if (hasValue(s.weightGoal)) out.push(change("settings", "weightGoal", { value: settingValue(s.weightGoal) }, now));
  if (hasValue(s.spesaFreq)) out.push(change("settings", "spesaFreq", { value: settingValue(s.spesaFreq) }, now));
  out.push(excludedFoodsChange(now));
  out.push(...shoppingCheckChanges(parseMaybe(hasValue(s.spesaChecked2) ? s.spesaChecked2 : s.spesaChecked), now));
  out.push(...shoppingExtraChanges(parseMaybe(s.spesaExtra), now));
  out.push(...exNotesChanges(parseMaybe(s.exNotes), now));

  // bodyWeight (settings) = ultimo peso noto, senza data → impostazione, non una pesata di oggi
  const kg = toNumber(s.bodyWeight);
  if (kg !== null && kg > 0) out.push(change("settings", "bodyWeight", { value: kg }, now));

  return sanitizeChanges(mergeChanges(out), st);
}

// ── backup PWA ──────────────────────────────────────────────────────────────
export function recordsFromBackup(backup, plans, stats, opts = {}) {
  const now = opts.now ?? Date.now();
  const st = newStats(stats);
  const data = (backup && isObj(backup.data)) ? backup.data : {};
  const wi = indexWorkout(plans && plans.workout);
  const variants = indexDiet(plans && plans.diet);
  const out = [];
  const ignore = (k) => { st.ignoredKeys[k] = (st.ignoredKeys[k] || 0) + 1; };
  // Chiavi per-giorno lette insieme (spunte dieta, scheda, sessione) → elaborate dopo il giro.
  const days = new Map();
  const day = (date) => { if (!days.has(date)) days.set(date, {}); return days.get(date); };
  const schedaImportedOn = importDate(data.schedaData_at);

  for (const [key, raw] of Object.entries(data)) {
    if (isNeverMigrated(key)) { ignore(key); continue; }
    const val = parseMaybe(raw);
    const dm = DAY_KEY_RE.exec(key);

    if (dm) {
      const prefix = dm[1], date = dm[2];
      if (!isDate(date)) { st.discarded.invalid++; continue; }
      const at = noon(date);
      switch (prefix) {
        case "checkIn_":
          if (isObj(val)) out.push(dayField(date, "checkIn", val, at));
          break;
        case "hydration_":
          if (hasValue(val)) out.push(dayField(date, "hydration", val, at));
          break;
        case "notes_":
          if (hasValue(val)) out.push(dayField(date, "notes", val, at));
          break;
        case "coachChat_":
          (Array.isArray(val) ? val : []).forEach((m, index) => {
            if (!isObj(m)) return;
            out.push(change("coachMessage", `${date}:${index}`, {
              date, index, role: m.role, text: m.text != null ? m.text : (m.content != null ? m.content : ""),
            }, at));
          });
          break;
        case "dietaCheck_": day(date).meals = val; break;
        case "integ_": day(date).supps = val; break;
        case "schedaProg_": day(date).prog = val; break;
        case "gym_":
          if (val === true) day(date).gym = true;
          else if (val !== false) ignore(prefix);
          break;
        case "gymStart_": day(date).gymStart = val; break;
        case "gymSaved_": // fonte dei nomi per schedaProg_ senza `names`, non migrato di per sé
          day(date).gymSaved = val;
          ignore(prefix);
          break;
        case "restDay_":
          if (val === true) out.push(dayField(date, "rest", true, at));
          else if (val !== false) ignore(prefix);
          break;
        default:
          ignore(prefix); // muscleSets_, nudgeDismissed_, …
      }
      continue;
    }

    switch (key) {
      case "weightLog":
        for (const e of Array.isArray(val) ? val : []) {
          if (!e) continue;
          if (!isDate(e.date)) { st.discarded.invalid++; continue; }
          const kg = toNumber(e.weight);
          if (kg === null || kg <= 0) continue;
          out.push(change("bodyWeight", e.date, { date: e.date, kg }, noon(e.date)));
        }
        break;
      case "bodyMeasures":
        for (const e of Array.isArray(val) ? val : []) {
          if (!isObj(e)) continue;
          if (!isDate(e.date)) { st.discarded.invalid++; continue; }
          out.push(change("bodyMeasure", e.date, { ...e }, noon(e.date)));
        }
        break;
      case "exNotes": out.push(...exNotesChanges(val, now)); break;
      case "activities":
        // { id: Date.now(), type, min, km, note, when } → un dayState cardio per attività, nel giorno di `id`
        for (const a of Array.isArray(val) ? val : []) {
          if (!isObj(a) || !Number.isSafeInteger(a.id) || a.id <= 0) { st.discarded.cardio++; continue; }
          const date = localDateKey(a.id);
          if (!isDate(date)) { st.discarded.cardio++; continue; }
          const { when, ...entry } = a; // `when` è un'etichetta ("Oggi"), non un dato
          out.push(cardioChange(date, entry, noon(date)));
        }
        break;
      case "prMap":
        for (const [name, rec] of Object.entries(isObj(val) ? val : {})) {
          const k = nameKey(name);
          if (!k || !isObj(rec)) continue;
          out.push(change("personalRecord", k, { exerciseName: name, ...rec }, now));
        }
        break;
      case "spesaChecked": out.push(...shoppingCheckChanges(val, now)); break;
      case "spesaExtra": out.push(...shoppingExtraChanges(val, now)); break;
      case "weightGoal": case "spesaFreq": case "lang": case "theme":
        if (hasValue(val)) out.push(change("settings", key, { value: val }, now));
        break;
      default: ignore(key);
    }
  }
  for (const [date, d] of days) {
    out.push(...dietChecks(date, d.meals, d.supps, variants, st));
    out.push(...setLogsFromProg(date, d.prog, d.gymSaved, wi, st, schedaImportedOn));
    if (d.gym) {
      const ws = workoutSessionChange(date, d.prog, d.gymStart, wi);
      if (ws) out.push(ws); else st.discarded.workoutSession++;
    } else if (d.gymStart !== undefined) {
      ignore("gymStart_"); // sessione iniziata ma mai chiusa: nessun workoutSession
    }
  }
  out.push(excludedFoodsChange(now));
  return sanitizeChanges(mergeChanges(out), st);
}

// Data locale (YYYY-MM-DD) di schedaData_at (ISO dalla PWA, oppure ms), null se illeggibile.
function importDate(v) {
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms > 0 ? localDateKey(ms) : null;
}

// Una variante dieta per giorno (Ruling 15): quella che contiene più spunte del giorno
// (pasti `dietaCheck_` + integratori `integ_`; spareggio: ordine delle varianti nel piano).
// Tutte le spunte vanno su quella variante; quelle che lì non esistono sono scartate e contate.
// Nessuna variante contiene almeno una spunta → nessuna scelta, tutto scartato.
function dietChecks(date, meals, supps, variants, st) {
  const on = (obj) => Object.entries(isObj(obj) ? obj : {}).filter(([, v]) => v).map(([k]) => k);
  const mealKeys = on(meals), suppKeys = on(supps);
  if (!mealKeys.length && !suppKeys.length) return [];
  let best = null, bestHits = 0;
  for (const v of variants) {
    const hits = mealKeys.filter((k) => v.meals.has(k)).length + suppKeys.filter((k) => v.supps.has(k)).length;
    if (hits > bestHits) { best = v; bestHits = hits; }
  }
  if (!best) {
    st.discarded.mealCheck += mealKeys.length;
    st.discarded.supplementCheck += suppKeys.length;
    return [];
  }
  const at = noon(date);
  const out = [dayField(date, "dietVariant", best.key, at)];
  for (const k of mealKeys) {
    const mealId = best.meals.get(k);
    if (!mealId) { st.discarded.mealCheck++; continue; }
    out.push(change("mealCheck", `${date}:${mealId}`, { date, mealId, done: true }, at));
  }
  for (const k of suppKeys) {
    const supplementId = best.supps.get(k);
    if (!supplementId) { st.discarded.supplementCheck++; continue; }
    out.push(change("supplementCheck", `${date}:${supplementId}`, { date, supplementId, done: true }, at));
  }
  return out;
}

// gym_<data> = true → workoutSession del giorno con più serie spuntate in schedaProg_
// (Giorno N → giorno N-1 del piano; spareggio: N più basso). null se non deducibile.
function workoutSessionChange(date, prog, gymStart, wi) {
  const completion = isObj(prog) && isObj(prog.completion) ? prog.completion : {};
  const perDay = new Map();
  for (const [id, sets] of Object.entries(completion)) {
    const m = /^Giorno (\d+)#\d+$/.exec(id);
    if (!m || !Array.isArray(sets)) continue;
    const n = sets.filter(Boolean).length;
    if (n) perDay.set(Number(m[1]), (perDay.get(Number(m[1])) || 0) + n);
  }
  let bestN = null;
  for (const [n, count] of perDay) {
    if (bestN === null || count > perDay.get(bestN) || (count === perDay.get(bestN) && n < bestN)) bestN = n;
  }
  const d = bestN === null ? null : wi.days[bestN - 1];
  if (!d) return null;
  const start = Number(gymStart);
  return change("workoutSession", `${date}:${d.id}`, {
    date, dayId: d.id, dayName: d.name,
    startedAt: gymStart != null && Number.isSafeInteger(start) && start > 0 ? start : null,
    done: true,
  }, noon(date));
}

// schedaProg_<data> = { completion:{exId:[bool]}, substitutions:{exId:nome}, pesos:{exId:[str]}, names:{exId:nome minuscolo}, sig }
// exId = "Giorno N#pos" (schedaState.jsx) → giorno N-1, esercizio pos del piano migrato.
// Nome dell'esercizio fatto quel giorno (Ruling 16): names[exId] → gymSaved_ della stessa data → nessuno.
//   con nome: uguale all'esercizio del piano in quella posizione → id del piano, altrimenti name:<nome>;
//   senza nome: scheda reimportata (schedaData_at) dopo quel giorno → scartato (setLogPositional),
//   altrimenti mappato per posizione e contato in stats.positional { count, from, to }.
function setLogsFromProg(date, prog, gymSaved, wi, st, schedaImportedOn) {
  const out = [];
  if (!isObj(prog)) return out;
  const completion = isObj(prog.completion) ? prog.completion : {};
  const subs = isObj(prog.substitutions) ? prog.substitutions : {};
  const pesos = isObj(prog.pesos) ? prog.pesos : {};
  const names = isObj(prog.names) ? prog.names : {};
  const saved = isObj(gymSaved) ? gymSaved : {};
  const at = noon(date);

  for (const [id, sets] of Object.entries(completion)) {
    if (!Array.isArray(sets)) continue;
    const done = sets.filter(Boolean).length;
    const m = /^Giorno (\d+)#(\d+)$/.exec(id);
    const ex = m ? ((wi.days[Number(m[1]) - 1] || {}).exercises || [])[Number(m[2])] : null;
    const name = hasValue(names[id]) ? nameKey(names[id]) : savedName(saved, id, subs[id]);

    let exerciseId, exerciseName, planId;
    if (ex && (name === null || name === nameKey(ex.name))) {
      if (name === null) {
        if (schedaImportedOn !== null && schedaImportedOn > date) { st.discarded.setLogPositional += done; continue; }
        const p = st.positional;
        p.count += done;
        if (done && (p.from === null || date < p.from)) p.from = date;
        if (done && (p.to === null || date > p.to)) p.to = date;
      }
      exerciseId = ex.id; exerciseName = ex.name; planId = wi.plan.id;
    } else if (name !== null) {
      exerciseId = `name:${name}`; exerciseName = name; planId = null; // la scheda è cambiata dopo quella sessione
    } else {
      st.discarded.setLog += done;
      continue;
    }
    sets.forEach((on, setIndex) => {
      if (!on) return;
      const w = Array.isArray(pesos[id]) ? pesos[id][setIndex] : undefined;
      out.push(change("setLog", `${date}:${exerciseId}:${setIndex}`, {
        date, exerciseId, exerciseName, planId, setIndex,
        weight: hasValue(w) ? String(w) : "", reps: null,
        done: true, substitutedWith: hasValue(subs[id]) ? subs[id] : null,
      }, at));
    });
  }
  return out;
}

// gymSaved_<data> = { "Giorno N#pos#serie": "nome|peso" } (screens/scheda.jsx, chiusura sessione).
// Il nome è quello dell'esercizio fatto: con una sostituzione è il sostituto, che non dice quale
// esercizio del piano c'era in quella posizione → in quel caso nessun nome.
function savedName(saved, id, substitution) {
  for (const [k, v] of Object.entries(saved)) {
    if (!k.startsWith(`${id}#`) || !/^\d+$/.test(k.slice(id.length + 1)) || typeof v !== "string") continue;
    const cut = v.lastIndexOf("|");
    const n = nameKey(cut >= 0 ? v.slice(0, cut) : v);
    if (!n) continue;
    if (hasValue(substitution) && n === nameKey(substitution)) return null;
    return n;
  }
  return null;
}

// ── merge ───────────────────────────────────────────────────────────────────
// Stesso collection/id: vince updatedAt maggiore (a pari valore, il change che
// compare dopo negli argomenti). Se entrambi i data sono oggetti → merge
// superficiale (i campi del vincitore sovrascrivono), tranne dayState: un record
// per campo, il vincitore sostituisce tutto. Ordine = prima apparizione.
export function mergeChanges(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const c of list || []) {
      const k = `${c.collection}\u0000${c.id}`;
      const prev = map.get(k);
      if (!prev) { map.set(k, { ...c }); continue; }
      const later = c.updatedAt >= prev.updatedAt ? c : prev;
      const earlier = later === c ? prev : c;
      const merged = { collection: c.collection, id: c.id, updatedAt: Math.max(prev.updatedAt, c.updatedAt) };
      const shallow = c.collection !== "dayState" && isObj(later.data) && isObj(earlier.data);
      merged.data = shallow ? { ...earlier.data, ...later.data } : later.data;
      if (later.deleted) merged.deleted = true;
      map.set(k, merged);
    }
  }
  return [...map.values()];
}

// ── guardia finale ──────────────────────────────────────────────────────────
// Scarta ogni change che /v1/sync rifiuterebbe (stesse regole di validateChange:
// collezione, id 1..128, updatedAt > 0, data oggetto ≤ 64 KB): il push è
// tutto-o-niente per richiesta, un solo record non valido bloccherebbe il lotto.
// Conta gli scarti in stats.discarded.invalid e ne annota fino a 10 in
// stats.invalidSamples ("collection/id" troncato).
const MAX_SAMPLES = 10;
export function sanitizeChanges(list, stats) {
  const st = stats ? newStats(stats) : null;
  const out = [];
  for (const c of list || []) {
    if (validateChange(c) === null) { out.push(c); continue; }
    if (!st) continue;
    st.discarded.invalid++;
    if (st.invalidSamples.length < MAX_SAMPLES) {
      st.invalidSamples.push(`${c && c.collection}/${c && c.id}`.slice(0, 80));
    }
  }
  return out;
}
