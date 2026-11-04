// recordmap.jsx — ponte puro fra le chiavi locali della PWA e i record del backend v2.
//
//   window.RecordMap = {
//     groupsForKey(key, value?, ctx?) → string[]            gruppi da ricalcolare quando cambia `key`
//     buildGroup(groupId, get, ctx)   → { records: [{collection,id,data}], window?: {collection,minId},
//                                         protect?: {collection, planExerciseIds} }
//     isProtected(groupResult, collection, id) → boolean   id da non tombstonare mai (Ruling 12)
//     carryOver(collection, prevData, nextData) → nextData  campi che la PWA non gestisce, tenuti dal record noto
//     keysForRecord(record, ctx)      → string[]            chiavi locali da ricostruire
//     rebuildKeys(keys, getRecord, listRecords, ctx) → { [key]: value | undefined }
//     DIRECT: Set(["workoutPlan","dietPlan"])               collezioni gestite direttamente dal motore
//     MUSCLE_GROUP: { muscolo: gruppo }                     tabella muscleSets_ (condivisa con scheda.jsx)
//   }
//   get(key, def) legge lo storage; getRecord(collection,id) / listRecords(collection) leggono la
//   cache dei record; ctx = { workout: {id,data}|null, diet: {id,data}|null, today: "YYYY-MM-DD" }.
//
// Gruppo = insieme deterministico di record prodotto da alcune chiavi locali (groupsForKey):
//   day:<d> (dayState checkIn/hydration/notes/rest), variant:<d> (dayState dietVariant),
//   cardio:<d> (dayState, un record per attività), meals:<d>, supps:<d>, sets:<d>, session:<d>,
//   coach:<d>, weights, measures, exNotes, prs, shopping, shoppingExtra, settings.
// dayState è un record per campo (Ruling 7): id `${date}:${field}` / `${date}:cardio:<id>`.
// Mapping, id e forme dei `data` = backend/migrate/records.mjs (recordsFromBackup) e
// backend/CONTRACT.md; parità testata in backend/test/recordmap-parity.test.mjs. In più rispetto
// alla migrazione: spunte tolte → done:false / checked:false (mai tombstone), settings bodyWeight.
//
// `window` di buildGroup: il motore NON tombstona id della collezione < minId (date in ordine
// lessicale). Serve per le liste locali a finestra (weightLog 90, bodyMeasures 120, activities 50)
// e per ciò che lo sweep a 90 giorni ha già tolto: ciò che esce dalla finestra resta sul server.
// Le liste hanno la finestra SOLO quando sono al limite (Ruling 15): sotto il limite nessuna voce
// è uscita, quindi una cancellazione (anche della più vecchia) è un tombstone.
// minId = NONE ("\uffff") = "non toccare niente del gruppo" (dati locali incompleti).
//
// rebuildKeys: chiave nel risultato con valore → scrivi; con undefined → rimuovi; chiave ASSENTE
// dal risultato → lascia com'è (manca il piano per ricostruirla, o il dato non è sul server).
//
// Niente rete, niente window.storage diretto: tutto passa dagli argomenti. Legge a chiamata
// window.PlanConv (planconv.jsx) e window.schedaPlanSig (schedaState.jsx).
(function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const DAY_KEY_RE = /^(checkIn_|hydration_|notes_|restDay_|dietaVariant_|dietaCheck_|integ_|schedaProg_|gymSaved_|gym_|gymStart_|muscleSets_|coachChat_)(\d{4}-\d{2}-\d{2})$/;
  const GROUP_RE = /^(day|variant|cardio|meals|supps|sets|session|coach):(\d{4}-\d{2}-\d{2})$/;
  const NONE = "\uffff";
  const HORIZON_DAYS = 90;     // sweep _cleanupOldDailyKeys (app.jsx): chiavi per-giorno < oggi−90 rimosse
  const ACTIVITY_DAYS = 60;    // Ruling 5: `activities` ricalcola il cardio degli ultimi 60 giorni
  const CAP = { activities: 50, weightLog: 90, bodyMeasures: 120 }; // stessi tagli della PWA
  const SETTINGS_KEYS = ["spesaFreq", "weightGoal", "bodyWeight", "lang", "theme"];
  // dayState = un record per campo (Ruling 7): id `${date}:${field}`, data { date, field, value };
  // cardio: un record per attività, id `${date}:cardio:${activityId}`. Campo → chiave locale:
  const DAY_FIELD_KEY = { checkIn: "checkIn_", hydration: "hydration_", notes: "notes_", rest: "restDay_", dietVariant: "dietaVariant_" };
  const DIRECT = new Set(["workoutPlan", "dietPlan"]);

  // Muscolo principale → gruppo della card "Settimana": unica tabella, usata anche da
  // screens/scheda.jsx (handleSaveSession → muscleSets_<data>) via RecordMap.MUSCLE_GROUP.
  const MUSCLE_GROUP = {
    petto: "Petto", schiena: "Schiena", spalle: "Spalle", trapezi: "Spalle",
    quadricipiti: "Gambe", femorali: "Gambe", glutei: "Gambe", polpacci: "Gambe",
    bicipiti: "Braccia", tricipiti: "Braccia", addome: "Core",
  };

  // ── helper ────────────────────────────────────────────────────────────────
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const hasValue = (v) => v !== null && v !== undefined && v !== "";
  const nameKey = (s) => String(s == null ? "" : s).trim().toLowerCase();
  const pad = (n) => String(n).padStart(2, "0");
  const localDateKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const isDate = (s) => {
    if (typeof s !== "string" || !DATE_RE.test(s)) return false;
    const ms = new Date(`${s}T12:00:00`).getTime();
    return Number.isFinite(ms) && ms > 0 && localDateKey(ms) === s;
  };
  const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return localDateKey(new Date(y, m - 1, d + n, 12).getTime()); };
  const todayOf = (ctx) => (ctx && isDate(ctx.today) ? ctx.today : localDateKey(Date.now()));
  const live = (r) => !!(r && !r.deleted && isObj(r.data));
  const rec = (collection, id, data) => ({ collection, id, data });
  const noTouch = (collection) => ({ records: [], window: { collection, minId: NONE } });
  // Data di un record: data.date, altrimenti il prefisso dell'id (tombstone: data null).
  const dayRec = (date, field, value) => rec("dayState", `${date}:${field}`, { date, field, value });
  // Campo di un dayState: data.field, altrimenti dall'id `${date}:${field}[:…]` (tombstone).
  const dayFieldOf = (r) => (r && isObj(r.data) && r.data.field) || String((r && r.id) || "").slice(11).split(":")[0];
  const recordDate = (r) => {
    if (r && isObj(r.data) && isDate(r.data.date)) return r.data.date;
    const head = String((r && r.id) || "").slice(0, 10);
    return isDate(head) ? head : null;
  };

  // ── indici sui piani (stesse regole di records.mjs) ───────────────────────
  const wCache = new WeakMap(), dCache = new WeakMap();

  function workoutIndex(plan) {
    if (!plan || !isObj(plan.data) || !Array.isArray(plan.data.days)) return null;
    if (wCache.has(plan.data)) return wCache.get(plan.data);
    const byId = new Map(), dayById = new Map();
    plan.data.days.forEach((d, di) => {
      dayById.set(d.id, d);
      (d.exercises || []).forEach((ex, pos) => byId.set(ex.id, { ex, exKey: `Giorno ${di + 1}#${pos}` }));
    });
    const idx = { plan, days: plan.data.days, byId, dayById };
    wCache.set(plan.data, idx);
    return idx;
  }
  const exAt = (wi, exKey) => {
    const m = /^Giorno (\d+)#(\d+)$/.exec(exKey);
    return m ? ((wi.days[Number(m[1]) - 1] || {}).exercises || [])[Number(m[2])] || null : null;
  };

  // Per variante: pasti `${time}|${name}` → mealId, integratori key → id (vince il primo).
  function dietIndex(plan) {
    if (!plan || !isObj(plan.data) || !Array.isArray(plan.data.variants)) return null;
    if (dCache.has(plan.data)) return dCache.get(plan.data);
    const mealById = new Map(), suppById = new Map();
    const variants = plan.data.variants.map((v) => {
      const meals = new Map(), supps = new Map();
      (v.meals || []).forEach((m) => {
        const k = `${m.time}|${m.name}`;
        if (!meals.has(k)) meals.set(k, m.id);
        mealById.set(m.id, { variant: v.key, key: k });
      });
      (v.supplements || []).forEach((s) => {
        if (!supps.has(s.key)) supps.set(s.key, s.id);
        suppById.set(s.id, { variant: v.key, key: s.key });
      });
      return { key: v.key, meals, supps };
    });
    const idx = { variants, mealById, suppById };
    dCache.set(plan.data, idx);
    return idx;
  }

  // Variante dieta del giorno: dietaVariant_<data> se è nel piano; altrimenti come la migrazione
  // (la variante con più spunte vere, spareggio = ordine del piano); se nessuna spunta vera
  // combacia, la stessa scelta su tutte le voci (così una spunta tolta resta mappabile).
  function dayVariant(date, get, di) {
    if (!di) return null;
    const explicit = get(`dietaVariant_${date}`, null);
    const hit = di.variants.find((v) => v.key === explicit);
    if (hit) return hit;
    const meals = isObj(get(`dietaCheck_${date}`, null)) ? get(`dietaCheck_${date}`, null) : {};
    const supps = isObj(get(`integ_${date}`, null)) ? get(`integ_${date}`, null) : {};
    const pick = (onlyTrue) => {
      const mk = Object.keys(meals).filter((k) => !onlyTrue || meals[k]);
      const sk = Object.keys(supps).filter((k) => !onlyTrue || supps[k]);
      let best = null, bestHits = 0;
      for (const v of di.variants) {
        const hits = mk.filter((k) => v.meals.has(k)).length + sk.filter((k) => v.supps.has(k)).length;
        if (hits > bestHits) { best = v; bestHits = hits; }
      }
      return best;
    };
    return pick(true) || pick(false);
  }

  // ── groupsForKey ──────────────────────────────────────────────────────────
  function groupsForKey(key, value, ctx) {
    const m = DAY_KEY_RE.exec(key);
    if (m) {
      const d = m[2];
      switch (m[1]) {
        case "checkIn_": case "hydration_": case "notes_": case "restDay_": return [`day:${d}`];
        case "dietaVariant_": return [`variant:${d}`, `meals:${d}`, `supps:${d}`];
        case "dietaCheck_": return [`meals:${d}`, `variant:${d}`];
        case "integ_": return [`supps:${d}`, `variant:${d}`];
        case "schedaProg_": return [`sets:${d}`, `session:${d}`];
        case "gymSaved_": return [`sets:${d}`];
        case "gym_": case "gymStart_": return [`session:${d}`];
        case "coachChat_": return [`coach:${d}`];
        default: return []; // muscleSets_: derivata dai setLog, non è una sorgente
      }
    }
    switch (key) {
      case "activities": {
        // Ruling 5: la lista è condivisa fra i giorni → il cardio degli ultimi 60 giorni.
        const today = todayOf(ctx), out = [];
        for (let i = 0; i < ACTIVITY_DAYS; i++) out.push(`cardio:${addDays(today, -i)}`);
        return out;
      }
      case "weightLog": return ["weights"];
      case "bodyMeasures": return ["measures"];
      case "exNotes": return ["exNotes"];
      case "prMap": return ["prs"];
      case "spesaChecked": return ["shopping"];
      case "spesaExtra": return ["shoppingExtra"];
      default: return SETTINGS_KEYS.includes(key) ? ["settings"] : [];
    }
  }

  // ── buildGroup ────────────────────────────────────────────────────────────
  const DATED_COLLECTION = { day: "dayState", variant: "dayState", cardio: "dayState", meals: "mealCheck", supps: "supplementCheck", sets: "setLog", session: "workoutSession", coach: "coachMessage" };

  function buildGroup(groupId, get, ctx) {
    const g = GROUP_RE.exec(groupId);
    if (g) {
      const kind = g[1], date = g[2];
      // Oltre l'orizzonte dello sweep le chiavi locali non ci sono più: il server resta com'è.
      if (date < addDays(todayOf(ctx), -HORIZON_DAYS)) return noTouch(DATED_COLLECTION[kind]);
      switch (kind) {
        case "day": return dayGroup(date, get);
        case "variant": return variantGroup(date, get, ctx);
        case "cardio": return cardioGroup(date, get);
        case "meals": return checksGroup(date, get, ctx, "meals");
        case "supps": return checksGroup(date, get, ctx, "supps");
        case "sets": return setsGroup(date, get, ctx);
        case "session": return sessionGroup(date, get, ctx);
        case "coach": return coachGroup(date, get);
      }
    }
    switch (groupId) {
      case "weights": return listGroup(get("weightLog", []), "bodyWeight", (e) => {
        const kg = toNumber(e.weight);
        return kg !== null && kg > 0 ? { date: e.date, kg } : null;
      }, CAP.weightLog);
      case "measures": return listGroup(get("bodyMeasures", []), "bodyMeasure", (e) => (isObj(e) ? { ...e } : null), CAP.bodyMeasures);
      case "exNotes": {
        const notes = get("exNotes", {}), records = [];
        for (const [name, text] of Object.entries(isObj(notes) ? notes : {})) {
          const k = nameKey(name);
          if (!k || typeof text !== "string" || text.trim() === "") continue;
          records.push(rec("exerciseNote", k, { exerciseName: k, text }));
        }
        return { records };
      }
      case "prs": {
        // Nomi che differiscono solo per maiuscole → stesso id: vince il PR col peso più alto
        // (a pari peso, o pesi non numerici, l'ultimo nell'ordine di prMap).
        const prs = get("prMap", {}), byId = new Map();
        for (const [name, r] of Object.entries(isObj(prs) ? prs : {})) {
          const k = nameKey(name);
          if (!k || !isObj(r)) continue;
          const prev = byId.get(k);
          const w = toNumber(r.peso), pw = prev ? toNumber(prev.data.peso) : null;
          if (prev && w !== null && pw !== null && w < pw) continue;
          byId.set(k, rec("personalRecord", k, { exerciseName: name, ...r }));
        }
        return { records: [...byId.values()] };
      }
      case "shopping": {
        const checked = get("spesaChecked", {}), records = [];
        for (const [k, v] of Object.entries(isObj(checked) ? checked : {})) {
          if (k !== "") records.push(rec("shoppingCheck", k, { checked: !!v }));
        }
        return { records };
      }
      case "shoppingExtra": {
        const extra = get("spesaExtra", []), records = [];
        for (const item of Array.isArray(extra) ? extra : []) {
          if (isObj(item) && hasValue(item.id)) records.push(rec("shoppingExtra", String(item.id), item));
        }
        return { records };
      }
      case "settings": {
        const records = [];
        for (const k of SETTINGS_KEYS) {
          const v = get(k, null);
          if (hasValue(v)) records.push(rec("settings", k, { value: v }));
        }
        return { records };
      }
    }
    throw new Error(`RecordMap: gruppo sconosciuto "${groupId}"`);
  }

  function toNumber(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    const s = v.trim().replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // Lista locale a finestra → un record per data. Al limite (cap, stesso taglio della PWA) la
  // finestra parte dalla data più vecchia presente: ciò che è prima resta sul server. Sotto il
  // limite niente finestra: nessuna voce è uscita, ogni voce sparita è una cancellazione vera.
  function listGroup(list, collection, toData, cap) {
    const byDate = new Map(); // stessa data ripetuta → vince l'ultima voce
    const arr = Array.isArray(list) ? list : [];
    let minId = NONE;
    for (const e of arr) {
      if (!e || !isDate(e.date)) continue;
      if (e.date < minId) minId = e.date;
      const data = toData(e);
      if (data) byDate.set(e.date, rec(collection, e.date, data));
      else byDate.delete(e.date);
    }
    const records = [...byDate.values()];
    return arr.length >= cap ? { records, window: { collection, minId } } : { records };
  }

  // dayState del giorno, un record per campo: checkIn_/hydration_/notes_/restDay_. Un campo tolto
  // in locale (note cancellate, riposo tolto) sparisce dal gruppo → tombstone di quel solo record.
  function dayGroup(date, get) {
    const records = [];
    const checkIn = get(`checkIn_${date}`, null);
    if (isObj(checkIn)) records.push(dayRec(date, "checkIn", checkIn));
    const hydration = get(`hydration_${date}`, null);
    if (hasValue(hydration)) records.push(dayRec(date, "hydration", hydration));
    const notes = get(`notes_${date}`, null);
    if (hasValue(notes)) records.push(dayRec(date, "notes", notes));
    if (get(`restDay_${date}`, false) === true) records.push(dayRec(date, "rest", true));
    return { records };
  }

  // dayState dietVariant: la stessa variante risolta usata per le spunte (dayVariant: dietaVariant_
  // solo se è nel piano attivo, altrimenti la scelta della migrazione). Senza piano: non si tocca.
  function variantGroup(date, get, ctx) {
    const di = dietIndex(ctx && ctx.diet);
    if (!di) return noTouch("dayState");
    const v = dayVariant(date, get, di);
    return { records: v ? [dayRec(date, "dietVariant", v.key)] : [] };
  }

  // dayState cardio: un record per attività del giorno (senza `when`, che è un'etichetta).
  // Lista piena (CAP): i giorni fino al più vecchio presente possono aver perso voci tagliate in
  // locale → nessun record e nessun tombstone (sul server restano).
  function cardioGroup(date, get) {
    const acts = get("activities", []);
    const list = (Array.isArray(acts) ? acts : []).filter((a) => isObj(a) && Number.isSafeInteger(a.id) && a.id > 0);
    if ((Array.isArray(acts) ? acts.length : 0) >= CAP.activities) {
      const oldest = list.map((a) => localDateKey(a.id)).reduce((m, d) => (d < m ? d : m), NONE);
      if (date <= oldest) return noTouch("dayState");
    }
    const byId = new Map();
    for (const a of list) {
      if (localDateKey(a.id) !== date) continue;
      const { when, ...entry } = a;
      byId.set(a.id, rec("dayState", `${date}:cardio:${a.id}`, { date, field: "cardio", value: entry }));
    }
    return { records: [...byId.values()] };
  }

  // mealCheck / supplementCheck: tutte le voci (vere e false) sulla variante del giorno.
  function checksGroup(date, get, ctx, kind) {
    const collection = kind === "meals" ? "mealCheck" : "supplementCheck";
    const di = dietIndex(ctx && ctx.diet);
    if (!di) return noTouch(collection);
    const v = dayVariant(date, get, di);
    const src = get(kind === "meals" ? `dietaCheck_${date}` : `integ_${date}`, null);
    const records = [];
    if (v && isObj(src)) {
      for (const [k, on] of Object.entries(src)) {
        if (kind === "meals") {
          const mealId = v.meals.get(k);
          if (mealId) records.push(rec(collection, `${date}:${mealId}`, { date, mealId, done: !!on }));
        } else {
          const supplementId = v.supps.get(k);
          if (supplementId) records.push(rec(collection, `${date}:${supplementId}`, { date, supplementId, done: !!on }));
        }
      }
    }
    return { records };
  }

  // setLog da schedaProg_<data>: una serie per indice registrato (spuntata o no, o col peso).
  // Esercizio: names[exKey] → gymSaved_ della data → posizione nel piano attivo (records.mjs);
  // senza nome e piano attivo valido da dopo quella data → scartato.
  // protect (Ruling 12): i setLog di esercizi che NON sono nel piano attivo (piano cambiato in
  // giornata, o id `name:`) non si tombstonano mai: sono storico, la Scheda non li mostra più.
  function setsGroup(date, get, ctx) {
    const wi = workoutIndex(ctx && ctx.workout);
    if (!wi) return noTouch("setLog");
    const protect = { collection: "setLog", planExerciseIds: [...wi.byId.keys()] };
    const prog = get(`schedaProg_${date}`, null);
    const records = [];
    if (!isObj(prog)) return { records, protect };
    const completion = isObj(prog.completion) ? prog.completion : {};
    const subs = isObj(prog.substitutions) ? prog.substitutions : {};
    const pesos = isObj(prog.pesos) ? prog.pesos : {};
    const names = isObj(prog.names) ? prog.names : {};
    const savedRaw = get(`gymSaved_${date}`, null);
    const saved = isObj(savedRaw) ? savedRaw : {};
    const validFrom = wi.plan.data.validFrom || null;
    const ids = new Set([].concat(Object.keys(completion), Object.keys(pesos), Object.keys(subs)));

    // Ruling 37: setLog di oggi fuori dal piano attivo (piano cambiato in giornata dall'app) per nome+serie.
    // Se la serie esiste già così e la PWA non l'ha ancora scritta col nuovo id, non si duplica.
    const offPlan = new Set(), mine = new Set();
    const listAll = ctx && typeof ctx.records === "function" ? ctx.records("setLog") : null;
    for (const r of Array.isArray(listAll) ? listAll : []) {
      if (!r || r.deleted || !isObj(r.data) || r.data.date !== date) continue;
      mine.add(r.id);
      if (r.data.done === true && !wi.byId.has(r.data.exerciseId) && Number.isInteger(r.data.setIndex)) offPlan.add(`${nameKey(r.data.exerciseName)}:${r.data.setIndex}`);
    }

    for (const exKey of ids) {
      const comp = Array.isArray(completion[exKey]) ? completion[exKey] : [];
      const pes = Array.isArray(pesos[exKey]) ? pesos[exKey] : [];
      const sub = hasValue(subs[exKey]) ? subs[exKey] : null;
      const ex = exAt(wi, exKey);
      const name = hasValue(names[exKey]) ? nameKey(names[exKey]) : savedName(saved, exKey, subs[exKey]);

      let exerciseId, exerciseName, planId;
      if (ex && (name === null || name === nameKey(ex.name))) {
        if (name === null && validFrom && validFrom > date) continue; // piano nuovo: posizione inaffidabile
        exerciseId = ex.id; exerciseName = ex.name; planId = wi.plan.id;
      } else if (name !== null) {
        exerciseId = `name:${name}`; exerciseName = name; planId = null;
      } else continue;

      let n = Math.max(comp.length, pes.length);
      if (!n && sub !== null && ex) n = ex.sets || 0;
      for (let setIndex = 0; setIndex < n; setIndex++) {
        const w = pes[setIndex];
        const rid = `${date}:${exerciseId}:${setIndex}`;
        if (planId !== null && offPlan.has(`${nameKey(exerciseName)}:${setIndex}`) && !mine.has(rid)) continue;
        records.push(rec("setLog", rid, {
          date, exerciseId, exerciseName, planId, setIndex,
          weight: hasValue(w) ? String(w) : "", reps: null,
          done: !!comp[setIndex], substitutedWith: sub,
        }));
      }
    }
    return { records, protect };
  }

  // Ruling 12: un id è protetto (mai tombstone dal motore) se il gruppo lo dichiara in `protect`.
  // setLog: id `${date}:${exerciseId}:${setIndex}` → protetto se exerciseId non è del piano attivo.
  function isProtected(res, collection, id) {
    const p = res && res.protect;
    if (!p || p.collection !== collection) return false;
    const s = String(id), cut = s.lastIndexOf(":");
    if (cut <= 11) return false;
    return !p.planExerciseIds.includes(s.slice(11, cut));
  }

  // Campi che la PWA non registra ma l'app nativa sì: ricalcolando un gruppo non vanno azzerati.
  // setLog.reps: la PWA scrive sempre null (non conta le ripetizioni fatte) → resta quello del record noto.
  function carryOver(collection, prev, next) {
    if (collection === "setLog" && isObj(prev) && isObj(next) && next.reps == null && Number.isFinite(prev.reps)) {
      return Object.assign({}, next, { reps: prev.reps });
    }
    return next;
  }

  // gymSaved_<data> = { "Giorno N#pos#serie": "nome|peso" }: nome dell'esercizio fatto, salvo
  // sostituzione (allora non dice quale esercizio del piano c'era) → null. Come records.mjs.
  function savedName(saved, exKey, substitution) {
    for (const [k, v] of Object.entries(saved)) {
      if (!k.startsWith(`${exKey}#`) || !/^\d+$/.test(k.slice(exKey.length + 1)) || typeof v !== "string") continue;
      const cut = v.lastIndexOf("|");
      const n = nameKey(cut >= 0 ? v.slice(0, cut) : v);
      if (!n) continue;
      if (hasValue(substitution) && n === nameKey(substitution)) return null;
      return n;
    }
    return null;
  }

  // workoutSession: solo a sessione chiusa (gym_ = true), giorno con più serie spuntate.
  function sessionGroup(date, get, ctx) {
    const wi = workoutIndex(ctx && ctx.workout);
    if (!wi) return noTouch("workoutSession");
    if (get(`gym_${date}`, false) !== true) return { records: [] };
    const prog = get(`schedaProg_${date}`, null);
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
    if (!d) return { records: [] };
    const gymStart = get(`gymStart_${date}`, null);
    const start = Number(gymStart);
    return { records: [rec("workoutSession", `${date}:${d.id}`, {
      date, dayId: d.id, dayName: d.name,
      startedAt: gymStart != null && Number.isSafeInteger(start) && start > 0 ? start : null,
      done: true,
    })] };
  }

  // Indice stabile per messaggio: i messaggi ricostruiti dal server portano `index` (anche non
  // contiguo, es. scritti dall'app nativa); quelli nuovi della PWA non lo hanno e prendono
  // max+1 in ordine. Mai l'indice di posizione: una chat troncata/rinumerata sovrascriverebbe
  // record già sincronizzati e tombstonerebbe quelli con indice più alto.
  function coachGroup(date, get) {
    const chat = get(`coachChat_${date}`, null), records = [];
    const list = (Array.isArray(chat) ? chat : []).filter(isObj);
    const used = new Set();
    let max = -1;
    for (const m of list) {
      if (Number.isSafeInteger(m.index) && m.index >= 0 && !used.has(m.index)) { used.add(m.index); if (m.index > max) max = m.index; }
    }
    const seen = new Set();
    for (const m of list) {
      let index = m.index;
      if (!(Number.isSafeInteger(index) && index >= 0) || seen.has(index)) index = ++max;
      seen.add(index);
      records.push(rec("coachMessage", `${date}:${index}`, {
        date, index, role: m.role, text: m.text != null ? m.text : (m.content != null ? m.content : ""),
      }));
    }
    return { records };
  }

  // ── keysForRecord ─────────────────────────────────────────────────────────
  function keysForRecord(record) { // ctx non serve: il mapping dipende solo dal record
    if (!record || DIRECT.has(record.collection)) return [];
    const d = recordDate(record);
    switch (record.collection) {
      case "dayState": {
        const field = dayFieldOf(record);
        if (field === "cardio") return ["activities"];
        return d && DAY_FIELD_KEY[field] ? [`${DAY_FIELD_KEY[field]}${d}`] : [];
      }
      case "mealCheck": return d ? [`dietaCheck_${d}`] : [];
      case "supplementCheck": return d ? [`integ_${d}`] : [];
      case "setLog": return d ? [`schedaProg_${d}`, `muscleSets_${d}`] : [];
      case "workoutSession": return d ? [`gym_${d}`, `gymStart_${d}`, `muscleSets_${d}`] : [];
      case "coachMessage": return d ? [`coachChat_${d}`] : [];
      case "bodyWeight": return ["weightLog"];
      case "bodyMeasure": return ["bodyMeasures"];
      case "exerciseNote": return ["exNotes"];
      case "personalRecord": return ["prMap"];
      case "shoppingCheck": return ["spesaChecked"];
      case "shoppingExtra": return ["spesaExtra"];
      case "settings": return SETTINGS_KEYS.includes(record.id) ? [record.id] : [];
      default: return [];
    }
  }

  // Istante per ordinare le attività: id numerico (Date.now() della PWA), altrimenti `startedAt`
  // (cardio da Salute, id "hk-<uuid>"), altrimenti mezzogiorno della data del record.
  function activityTime(v, date) {
    const id = Number(v.id);
    if (Number.isFinite(id) && id > 0) return id;
    const st = Number(v.startedAt);
    if (Number.isFinite(st) && st > 0) return st;
    const d = isDate(date) ? new Date(`${date}T12:00:00`).getTime() : NaN;
    return Number.isFinite(d) ? d : 0;
  }

  // ── rebuildKeys ───────────────────────────────────────────────────────────
  function rebuildKeys(keys, getRecord, listRecords, ctx) {
    const lists = new Map();
    const all = (collection) => {
      if (!lists.has(collection)) lists.set(collection, (listRecords(collection) || []).filter(live));
      return lists.get(collection);
    };
    const onDate = (collection, date) => all(collection).filter((r) => r.data.date === date);
    const one = (collection, id) => { const r = getRecord(collection, id); return live(r) ? r.data : null; };
    const out = {};
    const put = (k, v) => { out[k] = v; };

    for (const key of new Set(keys || [])) {
      const m = DAY_KEY_RE.exec(key);
      if (m) {
        const date = m[2];
        const field = (f) => { const d = one("dayState", `${date}:${f}`); return d ? d.value : undefined; };
        switch (m[1]) {
          case "checkIn_": { const v = field("checkIn"); put(key, isObj(v) ? v : undefined); break; }
          case "hydration_": { const v = field("hydration"); put(key, hasValue(v) ? v : undefined); break; }
          case "notes_": { const v = field("notes"); put(key, hasValue(v) ? v : undefined); break; }
          case "restDay_": put(key, field("rest") === true ? true : undefined); break;
          case "dietaVariant_": { const v = field("dietVariant"); put(key, hasValue(v) ? v : undefined); break; }
          case "dietaCheck_": rebuildChecks(key, date, field("dietVariant"), "meals", onDate, ctx, out); break;
          case "integ_": rebuildChecks(key, date, field("dietVariant"), "supps", onDate, ctx, out); break;
          case "schedaProg_": rebuildProg(key, date, onDate, ctx, out); break;
          case "gym_": // la PWA non toglie mai gym_: senza sessione chiusa la chiave resta com'è
            if (onDate("workoutSession", date).some((r) => r.data.done)) put(key, true);
            break;
          case "gymStart_": {
            const s = onDate("workoutSession", date).find((r) => Number.isSafeInteger(r.data.startedAt) && r.data.startedAt > 0);
            if (s) put(key, s.data.startedAt); // nessun inizio registrato → la chiave locale resta
            break;
          }
          case "muscleSets_": rebuildMuscleSets(key, date, onDate, ctx, out); break;
          case "coachChat_": {
            const msgs = onDate("coachMessage", date).slice().sort((a, b) => a.data.index - b.data.index)
              .map((r) => ({ role: r.data.role, text: r.data.text, index: r.data.index }));
            put(key, msgs.length ? msgs : undefined);
            break;
          }
          // gymSaved_: solo locale (registro invii al foglio), mai ricostruita
        }
        continue;
      }
      switch (key) {
        case "activities": {
          const acts = [];
          all("dayState").forEach((r) => {
            if (r.data.field === "cardio" && isObj(r.data.value)) acts.push({ a: { ...r.data.value, when: "Oggi" }, t: activityTime(r.data.value, r.data.date) }); // `when` come app.jsx
          });
          acts.sort((x, y) => y.t - x.t); // più recente prima (app.jsx)
          put(key, acts.map((x) => x.a).slice(0, CAP.activities));
          break;
        }
        case "weightLog":
          put(key, all("bodyWeight").filter((r) => isDate(r.data.date)).map((r) => ({ date: r.data.date, weight: r.data.kg }))
            .sort((a, b) => a.date.localeCompare(b.date)).slice(-CAP.weightLog));
          break;
        case "bodyMeasures":
          put(key, all("bodyMeasure").filter((r) => isDate(r.data.date)).map((r) => ({ ...r.data }))
            .sort((a, b) => a.date.localeCompare(b.date)).slice(-CAP.bodyMeasures));
          break;
        case "exNotes": {
          const o = {};
          all("exerciseNote").forEach((r) => { o[r.data.exerciseName] = r.data.text; });
          put(key, o);
          break;
        }
        case "prMap": {
          const o = {};
          all("personalRecord").forEach((r) => { const { exerciseName, ...rest } = r.data; o[exerciseName] = rest; });
          put(key, o);
          break;
        }
        case "spesaChecked": {
          const o = {};
          all("shoppingCheck").forEach((r) => { o[r.id] = !!r.data.checked; });
          put(key, o);
          break;
        }
        case "spesaExtra": {
          const num = (r) => (Number.isFinite(Number(r.id)) ? Number(r.id) : Infinity);
          put(key, all("shoppingExtra").slice().sort((a, b) => num(a) - num(b) || String(a.id).localeCompare(String(b.id)))
            .map((r) => r.data)); // aggiunti in coda con id = Date.now() (spesa.jsx)
          break;
        }
        default:
          if (SETTINGS_KEYS.includes(key)) {
            const s = one("settings", key);
            put(key, s && hasValue(s.value) ? s.value : undefined);
          }
      }
    }
    return out;
  }

  // dietaCheck_/integ_ dai record del giorno nel piano dieta attivo; a parità di chiave locale
  // vince la variante del giorno (dayState.dietVariant).
  function rebuildChecks(key, date, pref, kind, onDate, ctx, out) {
    const di = dietIndex(ctx && ctx.diet);
    if (!di) return;
    const byId = kind === "meals" ? di.mealById : di.suppById;
    const idField = kind === "meals" ? "mealId" : "supplementId";
    const recs = onDate(kind === "meals" ? "mealCheck" : "supplementCheck", date)
      .map((r) => ({ r, info: byId.get(r.data[idField]) })).filter((x) => x.info);
    if (!recs.length) { out[key] = undefined; return; }
    recs.sort((a, b) => (a.info.variant === pref) - (b.info.variant === pref));
    const o = {};
    recs.forEach(({ r, info }) => { o[info.key] = !!r.data.done; });
    out[key] = o;
  }

  // schedaProg_<data> dai setLog del giorno che appartengono al piano attivo (gli altri restano
  // sul server, storico letto altrove). Forma canonica: completion se c'è una serie spuntata,
  // pesos se c'è un peso, substitutions se sostituito, names per ogni esercizio, sig del piano.
  function rebuildProg(key, date, onDate, ctx, out) {
    const wi = workoutIndex(ctx && ctx.workout);
    if (!wi) return;
    const byEx = new Map();
    onDate("setLog", date).forEach((r) => {
      const hit = wi.byId.get(r.data.exerciseId);
      if (!hit || !Number.isInteger(r.data.setIndex) || r.data.setIndex < 0) return;
      if (!byEx.has(hit.exKey)) byEx.set(hit.exKey, { ex: hit.ex, logs: [] });
      byEx.get(hit.exKey).logs.push(r.data);
    });
    if (!byEx.size) { out[key] = undefined; return; }
    const prog = { completion: {}, substitutions: {}, pesos: {}, names: {}, sig: null };
    for (const [exKey, { ex, logs }] of byEx) {
      const n = Math.max(ex.sets || 0, ...logs.map((l) => l.setIndex + 1));
      const comp = new Array(n).fill(false), pes = new Array(n).fill("");
      let sub = null;
      logs.forEach((l) => {
        comp[l.setIndex] = !!l.done;
        pes[l.setIndex] = hasValue(l.weight) ? String(l.weight) : "";
        if (sub === null && hasValue(l.substitutedWith)) sub = l.substitutedWith;
      });
      if (comp.some(Boolean)) prog.completion[exKey] = comp;
      if (pes.some((w) => w !== "")) prog.pesos[exKey] = pes;
      if (sub !== null) prog.substitutions[exKey] = sub;
      prog.names[exKey] = nameKey(ex.name);
    }
    const PC = window.PlanConv;
    if (typeof window.schedaPlanSig === "function" && PC) prog.sig = window.schedaPlanSig(PC.toLegacyScheda(wi.plan.data).days);
    out[key] = prog;
  }

  // muscleSets_<data> come handleSaveSession di scheda.jsx: per i giorni delle sessioni chiuse,
  // serie spuntate per gruppo del primo muscolo dell'esercizio del piano, in ordine di esercizio.
  function rebuildMuscleSets(key, date, onDate, ctx, out) {
    const sessions = onDate("workoutSession", date).filter((r) => r.data.done);
    if (!sessions.length) return; // nessuna sessione chiusa nota: la chiave locale resta com'è
    const wi = workoutIndex(ctx && ctx.workout);
    const days = wi ? sessions.map((s) => wi.dayById.get(s.data.dayId)).filter(Boolean) : [];
    if (!days.length) return; // giorno non nel piano attivo: non ricostruibile, resta com'è
    const done = onDate("setLog", date).filter((r) => r.data.done);
    const daily = {};
    days.forEach((d) => (d.exercises || []).forEach((ex) => {
      const n = done.filter((r) => r.data.exerciseId === ex.id).length;
      if (!n) return;
      const g = MUSCLE_GROUP[(ex.muscles && ex.muscles[0]) || ""] || "Altro";
      daily[g] = (daily[g] || 0) + n;
    }));
    out[key] = daily;
  }

  const RecordMap = { groupsForKey, buildGroup, keysForRecord, rebuildKeys, isProtected, carryOver, DIRECT, MUSCLE_GROUP };
  window.RecordMap = RecordMap;
})();
