// localdata.jsx — window.LocalData: storico e progressione letti dai record locali
// (cache di SyncV2, già allineata al backend D1) al posto del vecchio client Google Sheets.
//
// Tutte le funzioni sono SINCRONE e restituiscono le stesse forme (e gli stessi ordinamenti,
// cronologici) che le schermate ricevevano da sheetsAPI:
//   getPesi(opts?)            → { "<esercizio minuscolo>": [{ date, setN, peso, rip, sessione }] }  (ultime 12 serie)
//   getUltimiPesi(opts?)      → { "<esercizio minuscolo>": [peso serie 1, peso serie 2, …] }
//   getUltimiPesi(nome, opts?)→ [{ setN, peso, rip }]  ultima sessione dell'esercizio
//   getSessioni()             → [{ date, type, setsCompleted, totalSets, notes, ora }]  (ultime 60)
//   getCheckIn(date?)         → [{ date, sleep, energy, ailments }]  (ultimi 30, o quello della data)
//   getPesoCorporeo()         → [{ date, weight }]  (ultimi 90)
//   getMisure()               → [{ date, vita?, fianchi?, torace?, braccio?, coscia? }]  (ultime 120)
// opts = { before: "YYYY-MM-DD" } → solo serie di giorni PRIMA di quella data (la Scheda esclude
// "oggi": le serie spuntate ora sono già nei record e falserebbero confronto e pre-compilazione).
//
// Conta solo ciò che è stato fatto: setLog con done:true. Tombstone esclusi. `peso` è un numero se il
// peso è numerico ("82,5" → 82.5), altrimenti il testo (colore dell'elastico). Un esercizio sostituito
// compare sotto il nome del SOSTITUTO (come sul foglio); `setN` = setIndex + 1. `rip`: il setLog non
// conserva le ripetizioni (reps null) → quelle previste dal piano (limite inferiore, come parseScheda)
// cercando l'id dell'esercizio in tutti i piani allenamento noti; null se non ricostruibili.
(function () {
  const PESI_PER_ESERCIZIO = 12;
  const MAX_SESSIONI = 60, MAX_CHECKIN = 30, MAX_PESO = 90, MAX_MISURE = 120;
  const MISURE = ["vita", "fianchi", "torace", "braccio", "coscia"];

  function list(collection) {
    const SV = window.SyncV2;
    if (!SV || !SV.listRecords) return [];
    return SV.listRecords(collection).filter((r) => r && !r.deleted && r.data && typeof r.data === "object");
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const nameKey = (s) => String(s == null ? "" : s).toLowerCase().trim();

  // "82,5" → 82.5 ; testo → testo ; vuoto → null
  function pesoOf(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const n = s.replace(",", ".");
    return /^[0-9]+(\.[0-9]+)?$/.test(n) ? parseFloat(n) : s;
  }

  // id esercizio → ripetizioni previste (limite inferiore) da TUTTI i piani allenamento noti.
  function plannedRepsIndex() {
    const idx = new Map();
    const lower = (reps) => {
      const s = reps == null ? "" : String(reps);
      const m = s.match(/(\d+)[-–](\d+)/);
      return m ? parseInt(m[1]) : (parseInt(s) || 10);
    };
    const add = (planData) => {
      ((planData && planData.days) || []).forEach((d) => (d.exercises || []).forEach((ex) => {
        if (ex && ex.id != null && ex.reps != null && !idx.has(ex.id)) idx.set(ex.id, lower(ex.reps));
      }));
    };
    const SV = window.SyncV2;
    if (SV && SV.activePlans) { const a = SV.activePlans(); if (a && a.workout) add(a.workout.data); }
    list("workoutPlan").forEach((r) => add(r.data));
    return idx;
  }

  // Serie fatte, cronologiche: [{ key, date, setIndex, peso, rip, sessione }]
  function doneSets(opts) {
    const before = opts && opts.before;
    const reps = plannedRepsIndex();
    const rows = [];
    list("setLog").forEach((r) => {
      const d = r.data;
      if (!d.done || !isDate(d.date) || !Number.isInteger(d.setIndex) || d.setIndex < 0) return;
      if (before && !(d.date < before)) return;
      const name = (typeof d.substitutedWith === "string" && d.substitutedWith.trim()) ? d.substitutedWith : d.exerciseName;
      const key = nameKey(name);
      if (!key) return;
      const rip = Number.isFinite(d.reps) && d.reps > 0 ? d.reps : (reps.has(d.exerciseId) ? reps.get(d.exerciseId) : null);
      rows.push({ key, date: d.date, setIndex: d.setIndex, peso: pesoOf(d.weight), rip, sessione: "" });
    });
    rows.sort((a, b) => byDate(a, b) || (a.setIndex - b.setIndex)); // stabile: a parità, ordine dei record
    return rows;
  }

  function getPesi(opts) {
    const map = {};
    doneSets(opts).forEach((r) => {
      (map[r.key] = map[r.key] || []).push({ date: r.date, setN: r.setIndex + 1, peso: r.peso, rip: r.rip, sessione: r.sessione });
    });
    Object.keys(map).forEach((k) => { map[k] = map[k].slice(-PESI_PER_ESERCIZIO); });
    return map;
  }

  // Ultimo peso noto per numero di serie (come il vecchio getUltimiPesi: serie senza peso o a 0 non contano).
  function getUltimiPesi(a, b) {
    const named = typeof a === "string";
    const opts = named ? b : a;
    const map = {};
    doneSets(opts).forEach((r) => {
      if (r.peso == null || r.peso === 0) return;
      const arr = (map[r.key] = map[r.key] || []);
      while (arr.length < r.setIndex) arr.push(null);
      arr[r.setIndex] = r.peso;
    });
    if (!named) return map;
    // per nome: l'ultima sessione dell'esercizio, serie in ordine
    const rows = doneSets(opts).filter((r) => r.key === nameKey(a) && r.peso != null && r.peso !== 0);
    if (!rows.length) return [];
    const last = rows[rows.length - 1].date;
    return rows.filter((r) => r.date === last).map((r) => ({ setN: r.setIndex + 1, peso: r.peso, rip: r.rip }));
  }

  function getSessioni() {
    const plan = (() => { const a = window.SyncV2 && window.SyncV2.activePlans ? window.SyncV2.activePlans() : null; return a && a.workout ? a.workout.data : null; })();
    const doneByDate = {};
    list("setLog").forEach((r) => { if (r.data.done && isDate(r.data.date)) doneByDate[r.data.date] = (doneByDate[r.data.date] || 0) + 1; });
    const notes = {};
    list("dayState").forEach((r) => { if (r.data.field === "notes" && isDate(r.data.date) && typeof r.data.value === "string") notes[r.data.date] = r.data.value; });
    const ora = (ms) => {
      if (!Number.isFinite(ms) || ms <= 0) return "";
      const d = new Date(ms);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    };
    const rows = list("workoutSession").filter((r) => r.data.done && isDate(r.data.date)).map((r) => {
      const d = r.data;
      const setsCompleted = doneByDate[d.date] || 0;
      // Totale serie previsto: dal giorno del piano attivo, solo se plausibile (piano cambiato → 0).
      const day = plan && (plan.days || []).find((x) => x.id === d.dayId);
      let totalSets = day ? (day.exercises || []).reduce((n, ex) => n + (Number(ex.sets) || 0), 0) : 0;
      if (totalSets < setsCompleted) totalSets = 0;
      return { date: d.date, type: d.dayName || "", setsCompleted, totalSets, notes: notes[d.date] || "", ora: ora(d.startedAt) };
    });
    rows.sort(byDate);
    return rows.slice(-MAX_SESSIONI);
  }

  function getCheckIn(date) {
    let rows = list("dayState").filter((r) => r.data.field === "checkIn" && isDate(r.data.date) && r.data.value && typeof r.data.value === "object")
      .map((r) => ({
        date: r.data.date,
        sleep: Number(r.data.value.sleep) || 0,
        energy: Number(r.data.value.energy) || 0,
        ailments: String(r.data.value.ailments || ""),
      }));
    rows.sort(byDate);
    return date ? rows.filter((r) => r.date === date) : rows.slice(-MAX_CHECKIN);
  }

  function getPesoCorporeo() {
    const rows = list("bodyWeight").filter((r) => isDate(r.data.date)).map((r) => ({ date: r.data.date, weight: Number(r.data.kg) || 0 }))
      .filter((r) => r.weight > 0);
    rows.sort(byDate);
    return rows.slice(-MAX_PESO);
  }

  function getMisure() {
    const rows = list("bodyMeasure").filter((r) => isDate(r.data.date)).map((r) => {
      const out = { date: r.data.date };
      MISURE.forEach((c) => { const v = Number(r.data[c]); if (v > 0) out[c] = v; });
      return out;
    });
    rows.sort(byDate);
    return rows.slice(-MAX_MISURE);
  }

  window.LocalData = { getPesi, getUltimiPesi, getSessioni, getCheckIn, getPesoCorporeo, getMisure };
})();
