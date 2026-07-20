// progress.jsx — logica PURA (no React) per le feature "coach silenzioso":
// progressione carichi, record personali (PR), volume settimanale per gruppo,
// nudge in-app e merge robusto del weightLog. Esposta come window.WorkoutProgress.
// Nessun import/export (stack CDN): funzioni pure, testate in test/run.mjs.
(function () {

  // Peso NUMERICO (kg) o null. Accetta virgola decimale; scarta testo libero
  // tipo "elastico rosso"/"corpo libero" (che nel Player è un peso valido ma
  // non progredibile numericamente).
  function parseWeight(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(",", ".");
    if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return (isFinite(n) && n > 0) ? n : null;
  }

  // Micro-step di progressione "da palestra" in base al carico attuale.
  function suggestStep(weight) {
    if (weight == null) return null;
    if (weight < 10) return 1;      // isolamento leggero / manubri piccoli
    if (weight < 40) return 2.5;    // manubri / macchine medie
    return 5;                       // bilanciere pesante
  }

  // Suggerimento prossimo carico a partire dall'ultimo fatto.
  // Ritorna { last, step, next } oppure null se l'ultimo non è numerico.
  function suggestNext(lastRaw) {
    const w = parseWeight(lastRaw);
    if (w == null) return null;
    const step = suggestStep(w);
    return { last: w, step: step, next: Math.round((w + step) * 100) / 100 };
  }

  // ── Record personali (PR) ────────────────────────────────────────────────
  // prMap: { "<esercizio>": { peso:number, date:"YYYY-MM-DD" } }
  // sets:  [{ esercizio, peso(raw), date }] (serie completate della sessione)
  // Ritorna { prMap (nuova), newPRs:[{ esercizio, peso, prev }] }.
  function applySession(prMap, sets) {
    const next = Object.assign({}, prMap || {});
    const newPRs = [];
    for (const s of (sets || [])) {
      const w = parseWeight(s && s.peso);
      const name = s && s.esercizio;
      if (w == null || !name) continue;
      const cur = next[name];
      if (!cur || w > cur.peso) {
        // Evita doppioni nella stessa sessione: tieni il massimo.
        const dup = newPRs.find(p => p.esercizio === name);
        if (dup) { if (w > dup.peso) { dup.peso = w; dup.prev = cur ? cur.peso : null; } }
        else newPRs.push({ esercizio: name, peso: w, prev: cur ? cur.peso : null });
        next[name] = { peso: w, date: (s && s.date) || null };
      }
    }
    return { prMap: next, newPRs: newPRs };
  }

  function bestFor(prMap, esercizio) {
    const r = prMap && prMap[esercizio];
    return r ? r.peso : null;
  }

  // ── Volume per gruppo muscolare ──────────────────────────────────────────
  // history: [{ date:"YYYY-MM-DD", muscleSets:{ Gruppo:conteggio } }]
  // Somma i set per gruppo sulle entry passate (il chiamante filtra la finestra
  // temporale). Ritorna { byGroup, total, order } con order = gruppi per volume desc.
  function aggregateVolume(history) {
    const byGroup = {};
    let total = 0;
    for (const h of (history || [])) {
      const ms = (h && h.muscleSets) || {};
      for (const g in ms) {
        const v = ms[g] || 0;
        byGroup[g] = (byGroup[g] || 0) + v;
        total += v;
      }
    }
    const order = Object.keys(byGroup).sort((a, b) => byGroup[b] - byGroup[a]);
    return { byGroup: byGroup, total: total, order: order };
  }

  // Elenco delle ultime `n` date (YYYY-MM-DD) fino a `todayStr` incluso.
  function lastNDates(todayStr, n) {
    const out = [];
    const d = new Date(todayStr + "T00:00:00");
    if (isNaN(d)) return out;
    for (let i = 0; i < n; i++) {
      const dd = new Date(d);
      dd.setDate(d.getDate() - i);
      out.push(dd.getFullYear() + "-" +
        String(dd.getMonth() + 1).padStart(2, "0") + "-" +
        String(dd.getDate()).padStart(2, "0"));
    }
    return out;
  }

  // ── Nudge in-app (NON push OS) ───────────────────────────────────────────
  // ctx: { isWorkoutDay, gymDone, checkInDone, hydration, hydrationTarget, hour, dismissed:[id] }
  // Ritorna il primo nudge pertinente { id, kind, text } oppure null.
  function nextNudge(ctx) {
    ctx = ctx || {};
    const dismissed = ctx.dismissed || [];
    const has = (id) => dismissed.indexOf(id) === -1;
    const h = typeof ctx.hour === "number" ? ctx.hour : 12;

    if (ctx.isWorkoutDay && !ctx.gymDone && h >= 9 && h < 22 && has("workout")) {
      return { id: "workout", kind: "workout", text: "Oggi tocca allenarti — inizia quando vuoi." };
    }
    if (!ctx.checkInDone && h >= 20 && has("checkin")) {
      return { id: "checkin", kind: "checkin", text: "Registra il check-in serale (sonno/energia)." };
    }
    const target = ctx.hydrationTarget || 8;
    if (typeof ctx.hydration === "number" && ctx.hydration < target && h >= 12 && has("hydration")) {
      return { id: "hydration", kind: "hydration", text: "Sei indietro con l'acqua — bevi un bicchiere." };
    }
    return null;
  }

  // ── Merge robusto del weightLog ──────────────────────────────────────────
  // Unisce due liste [{date, weight}] deduplicando per data. In caso di stessa
  // data, `prefer` ("cloud"|"local") decide chi vince (default cloud = Sheets).
  // Ritorna la lista ordinata per data ascendente.
  function mergeWeightLog(local, cloud, prefer) {
    prefer = prefer === "local" ? "local" : "cloud";
    const map = {};
    const put = (list) => {
      for (const e of (list || [])) {
        if (!e || !e.date) continue;
        map[e.date] = { date: e.date, weight: e.weight };
      }
    };
    // L'ultimo che scrive vince → metti prima il perdente.
    if (prefer === "cloud") { put(local); put(cloud); }
    else { put(cloud); put(local); }
    return Object.values(map).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  window.WorkoutProgress = {
    parseWeight: parseWeight,
    suggestStep: suggestStep,
    suggestNext: suggestNext,
    applySession: applySession,
    bestFor: bestFor,
    aggregateVolume: aggregateVolume,
    lastNDates: lastNDates,
    nextNudge: nextNudge,
    mergeWeightLog: mergeWeightLog,
  };
})();
