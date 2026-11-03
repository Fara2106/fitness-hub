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

// Pasti e integratori: se lo stesso pasto/integratore compare in più varianti
// vince la PRIMA trovata (ordine delle varianti nel piano).
function indexDiet(plan) {
  const variants = (plan && plan.data && plan.data.variants) || [];
  const meals = new Map(); // `${time}|${name}` → mealId
  const supps = new Map(); // key → supplementId
  for (const v of variants) {
    for (const m of v.meals || []) {
      const k = `${m.time}|${m.name}`;
      if (!meals.has(k)) meals.set(k, m.id);
    }
    for (const s of v.supplements || []) if (!supps.has(s.key)) supps.set(s.key, s.id);
  }
  return { meals, supps };
}

function newStats(stats) {
  const s = stats || {};
  s.discarded = Object.assign({ mealCheck: 0, supplementCheck: 0, setLog: 0, invalid: 0 }, s.discarded);
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

  // getCheckIn → dayState.checkIn (stessa data: vince l'ultima riga, via mergeChanges)
  for (const r of Array.isArray(checkIn) ? checkIn : []) {
    if (!r) continue;
    if (!isDate(r.date)) { st.discarded.invalid++; continue; }
    const sleep = Number(r.sleep) || 0, energy = Number(r.energy) || 0;
    if (!sleep && !energy) continue; // come la PWA: riga vuota ignorata
    out.push(change("dayState", r.date, {
      date: r.date, checkIn: { sleep, energy, ailments: r.ailments || "" },
    }, noon(r.date)));
  }

  // getPesoCorporeo → bodyWeight
  const weightDates = new Set();
  for (const r of Array.isArray(pesoCorporeo) ? pesoCorporeo : []) {
    if (!r) continue;
    if (!isDate(r.date)) { st.discarded.invalid++; continue; }
    const kg = toNumber(r.weight);
    if (kg === null || kg <= 0) continue;
    weightDates.add(r.date);
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
      const reps = Number(r.rip);
      out.push(change("setLog", `${r.date}:${exerciseId}:${setIndex}`, {
        date: r.date, exerciseId, exerciseName: name, planId, setIndex,
        weight: hasValue(r.peso) ? String(r.peso) : "", reps: Number.isFinite(reps) && r.rip !== "" && r.rip != null ? reps : null,
        done: true, substitutedWith: null,
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

  // bodyWeight (settings) → peso di oggi, solo se il foglio non ha già la riga di oggi
  const today = localDateKey(now);
  const kg = toNumber(s.bodyWeight);
  if (kg !== null && kg > 0 && !weightDates.has(today)) {
    out.push(change("bodyWeight", today, { date: today, kg }, now));
  }

  return sanitizeChanges(mergeChanges(out), st);
}

// ── backup PWA ──────────────────────────────────────────────────────────────
export function recordsFromBackup(backup, plans, stats, opts = {}) {
  const now = opts.now ?? Date.now();
  const st = newStats(stats);
  const data = (backup && isObj(backup.data)) ? backup.data : {};
  const wi = indexWorkout(plans && plans.workout);
  const di = indexDiet(plans && plans.diet);
  const out = [];
  const ignore = (k) => { st.ignoredKeys[k] = (st.ignoredKeys[k] || 0) + 1; };

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
          if (isObj(val)) out.push(change("dayState", date, { date, checkIn: val }, at));
          break;
        case "hydration_":
          if (hasValue(val)) out.push(change("dayState", date, { date, hydration: val }, at));
          break;
        case "notes_":
          if (hasValue(val)) out.push(change("dayState", date, { date, notes: val }, at));
          break;
        case "coachChat_":
          (Array.isArray(val) ? val : []).forEach((m, index) => {
            if (!isObj(m)) return;
            out.push(change("coachMessage", `${date}:${index}`, {
              date, index, role: m.role, text: m.text != null ? m.text : (m.content != null ? m.content : ""),
            }, at));
          });
          break;
        case "dietaCheck_":
          for (const [mk, on] of Object.entries(isObj(val) ? val : {})) {
            if (!on) continue;
            const mealId = di.meals.get(mk);
            if (!mealId) { st.discarded.mealCheck++; continue; }
            out.push(change("mealCheck", `${date}:${mealId}`, { date, mealId, done: true }, at));
          }
          break;
        case "integ_":
          for (const [type, on] of Object.entries(isObj(val) ? val : {})) {
            if (!on) continue;
            const supplementId = di.supps.get(type);
            if (!supplementId) { st.discarded.supplementCheck++; continue; }
            out.push(change("supplementCheck", `${date}:${supplementId}`, { date, supplementId, done: true }, at));
          }
          break;
        case "schedaProg_":
          out.push(...setLogsFromProg(date, val, wi, st));
          break;
        default:
          ignore(prefix); // gym_, muscleSets_, gymStart_, gymSaved_, restDay_, …
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
  out.push(excludedFoodsChange(now));
  return sanitizeChanges(mergeChanges(out), st);
}

// schedaProg_<data> = { completion:{exId:[bool]}, substitutions:{exId:nome}, pesos:{exId:[str]}, names:{exId:nome minuscolo}, sig }
// exId = "Giorno N#pos" (schedaState.jsx) → giorno N-1, esercizio pos del piano migrato.
function setLogsFromProg(date, prog, wi, st) {
  const out = [];
  if (!isObj(prog)) return out;
  const completion = isObj(prog.completion) ? prog.completion : {};
  const subs = isObj(prog.substitutions) ? prog.substitutions : {};
  const pesos = isObj(prog.pesos) ? prog.pesos : {};
  const names = isObj(prog.names) ? prog.names : {};
  const at = noon(date);

  for (const [id, sets] of Object.entries(completion)) {
    if (!Array.isArray(sets)) continue;
    const m = /^Giorno (\d+)#(\d+)$/.exec(id);
    const ex = m ? ((wi.days[Number(m[1]) - 1] || {}).exercises || [])[Number(m[2])] : null;
    const saved = hasValue(names[id]) ? nameKey(names[id]) : null;

    let exerciseId, exerciseName, planId;
    if (ex && (saved === null || saved === nameKey(ex.name))) {
      exerciseId = ex.id; exerciseName = ex.name; planId = wi.plan.id;
    } else if (saved !== null) {
      exerciseId = `name:${saved}`; exerciseName = saved; planId = null; // la scheda è cambiata dopo quella sessione
    } else {
      sets.forEach((on) => { if (on) st.discarded.setLog++; });
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

// ── merge ───────────────────────────────────────────────────────────────────
// Stesso collection/id: vince updatedAt maggiore (a pari valore, il change che
// compare dopo negli argomenti). Se entrambi i data sono oggetti → merge
// superficiale (i campi del vincitore sovrascrivono). Ordine = prima apparizione.
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
      merged.data = isObj(later.data) && isObj(earlier.data) ? { ...earlier.data, ...later.data } : later.data;
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
