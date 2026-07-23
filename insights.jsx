// insights.jsx — window.Insights: logica pura per le funzionalità "insight"
// (storico per-esercizio, riepilogo sessione, report settimanale, deload,
// aderenza pasti, sostituzioni alimenti, e1RM). NIENTE accesso a storage/DOM:
// tutte le funzioni ricevono dati e restituiscono dati → unit-test in npm test.
(function () {

  // Parser numerico permissivo: "82,5" → 82.5; testo ("elastico") → null.
  function _num(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().replace(",", ".");
    if (!s || !/^[0-9]+(\.[0-9]+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return n > 0 ? n : null;
  }

  // ── e1RM (formula di Epley) ───────────────────────────────────────────────
  function e1rm(peso, rip) {
    const p = _num(peso), r = Number(rip);
    if (p == null || !r || r < 1) return null;
    if (r === 1) return p;
    return Math.round(p * (1 + r / 30) * 10) / 10;
  }

  // ── Storico per-esercizio dal payload getPesi ─────────────────────────────
  // pesiMap: { "nome lower": [{date,setN,peso,rip,sessione}, …] (cronologico) }
  // → ultime `limit` sessioni (per data, desc): [{date, sets:[{peso,rip}], top, tonnage}]
  function exerciseSessions(pesiMap, name, limit) {
    limit = limit || 3;
    const rows = (pesiMap && pesiMap[String(name || "").toLowerCase().trim()]) || [];
    const byDate = {};
    rows.forEach(r => {
      if (!r || !r.date) return;
      (byDate[r.date] = byDate[r.date] || []).push({ peso: r.peso, rip: r.rip });
    });
    return Object.keys(byDate).sort().reverse().slice(0, limit).map(date => {
      const sets = byDate[date];
      let top = 0, tonnage = 0;
      sets.forEach(s => {
        const p = _num(s.peso);
        if (p != null) {
          if (p > top) top = p;
          tonnage += p * (Number(s.rip) || 0);
        }
      });
      return { date, sets, top: top || null, tonnage: Math.round(tonnage) };
    });
  }

  // ── Riepilogo di fine sessione ────────────────────────────────────────────
  // Confronto: per ogni esercizio fatto oggi, l'ultima sessione nota in pesiMap
  // (top e tonnage). durationMin: null se manca il timestamp di inizio.
  function sessionSummary(args) {
    const { exercises, dayKey, completion, substitutions, pesos, exIdFn,
            startTs, endTs, pesiMap } = args;
    let setsDone = 0, tonnage = 0, prevTonnage = 0, hasPrev = false;
    const perExercise = [];
    (exercises || []).forEach((ex, i) => {
      const id = exIdFn(dayKey, i);
      const comp = (completion && completion[id]) || [];
      const done = comp.filter(Boolean).length;
      if (!done) return;
      const name = (substitutions && substitutions[id]) || ex.name;
      const exPesos = (pesos && pesos[id]) || ex.sets.map(s => String(s.peso == null ? "" : s.peso));
      let top = null;
      ex.sets.forEach((s, j) => {
        if (!comp[j]) return;
        setsDone++;
        const p = _num(exPesos[j] != null && String(exPesos[j]).trim() !== "" ? exPesos[j] : s.peso);
        if (p != null) {
          tonnage += p * (Number(s.rip) || 0);
          if (top == null || p > top) top = p;
        }
      });
      const prevSessions = exerciseSessions(pesiMap, name, 1);
      const prev = prevSessions[0] || null;
      if (prev) { hasPrev = true; prevTonnage += prev.tonnage; }
      perExercise.push({
        name,
        top,
        prevTop: prev ? prev.top : null,
        delta: (top != null && prev && prev.top != null) ? Math.round((top - prev.top) * 10) / 10 : null,
      });
    });
    const durationMin = (startTs && endTs && endTs > startTs)
      ? Math.max(1, Math.round((endTs - startTs) / 60000)) : null;
    return {
      setsDone,
      exCount: perExercise.length,
      durationMin,
      tonnage: Math.round(tonnage),
      prevTonnage: hasPrev ? Math.round(prevTonnage) : null,
      perExercise,
    };
  }

  // ── Report settimanale (ultimi 7 giorni fino a `today` incluso) ───────────
  // gymFlags: {date:true}; muscleHist: [{date, muscleSets:{Gruppo:n}}];
  // weightLog: [{date,weight}] asc; prMap: {nome:{peso,date}}; checkinDates: [date].
  function weeklyReport(args) {
    const { today, weightLog, gymFlags, muscleHist, prMap, checkinDates, plannedSessions } = args;
    const days = [];
    const prevDays = [];
    const base = new Date(today + "T12:00:00");
    for (let i = 0; i < 14; i++) {
      const d = new Date(base); d.setDate(d.getDate() - i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      (i < 7 ? days : prevDays).push(k);
    }
    const inWeek = (date) => days.indexOf(date) !== -1;

    const sessions = days.filter(d => gymFlags && gymFlags[d]).length;
    const byGroup = {};
    let totalSets = 0;
    (muscleHist || []).forEach(h => {
      if (!h || !inWeek(h.date) || !h.muscleSets) return;
      Object.keys(h.muscleSets).forEach(g => {
        const n = Number(h.muscleSets[g]) || 0;
        byGroup[g] = (byGroup[g] || 0) + n;
        totalSets += n;
      });
    });
    const order = Object.keys(byGroup).sort((a, b) => byGroup[b] - byGroup[a]);

    const avg = (dates) => {
      const w = (weightLog || []).filter(e => e && dates.indexOf(e.date) !== -1).map(e => e.weight);
      if (!w.length) return null;
      return Math.round((w.reduce((s, x) => s + x, 0) / w.length) * 10) / 10;
    };
    const avgWeight = avg(days);
    const prevAvgWeight = avg(prevDays);
    const weightDelta = (avgWeight != null && prevAvgWeight != null)
      ? Math.round((avgWeight - prevAvgWeight) * 10) / 10 : null;

    const prs = [];
    Object.keys(prMap || {}).forEach(nome => {
      const pr = prMap[nome];
      if (pr && inWeek(pr.date)) prs.push({ esercizio: nome, peso: pr.peso, date: pr.date });
    });
    prs.sort((a, b) => (b.peso || 0) - (a.peso || 0));

    const checkins = (checkinDates || []).filter(inWeek).length;

    return { sessions, planned: plannedSessions || 3, totalSets, byGroup, order,
             avgWeight, prevAvgWeight, weightDelta, prs, checkins };
  }

  // ── Deload (seduta scarica) ───────────────────────────────────────────────
  // checkIns: array dal più recente (oggi) al più vecchio: {sleep, energy, ailments}.
  // Regole: fastidi segnalati oggi → deload; media di oggi ≤ 2.5 → deload;
  // media ≤ 3 sia oggi che ieri → deload (fatica accumulata).
  function deloadAdvice(checkIns) {
    const list = (checkIns || []).filter(Boolean);
    const today = list[0];
    if (!today) return { deload: false, reason: null };
    if (String(today.ailments || "").trim()) return { deload: true, reason: "fastidi" };
    const score = (c) => ((Number(c.sleep) || 0) + (Number(c.energy) || 0)) / 2;
    if (score(today) > 0 && score(today) <= 2.5) return { deload: true, reason: "energia" };
    const y = list[1];
    if (y && score(today) > 0 && score(today) <= 3 && score(y) > 0 && score(y) <= 3) {
      return { deload: true, reason: "recupero" };
    }
    return { deload: false, reason: null };
  }

  // Peso scarico: −10% arrotondato al multiplo di 2.5 (o 1 kg sotto i 20 kg).
  function deloadWeight(raw) {
    const p = _num(raw);
    if (p == null) return null;
    const step = p < 20 ? 1 : 2.5;
    const target = p * 0.9;
    const v = Math.round(target / step) * step;
    return v > 0 && v < p ? v : null;
  }

  // ── Media mobile del peso (finestra su giorni di calendario) ──────────────
  // weightLog asc [{date, weight}] → [{date, ma}] (media delle misurazioni
  // negli ultimi `win` giorni fino a quella data inclusa).
  function movingAverage(weightLog, win) {
    win = win || 7;
    const log = (weightLog || []).filter(e => e && e.date && e.weight > 0);
    return log.map(e => {
      const from = new Date(e.date + "T12:00:00");
      from.setDate(from.getDate() - (win - 1));
      const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
      const slice = log.filter(x => x.date >= fromKey && x.date <= e.date);
      const avg = slice.reduce((s, x) => s + x.weight, 0) / slice.length;
      return { date: e.date, ma: Math.round(avg * 100) / 100 };
    });
  }

  // ── Proiezione verso l'obiettivo peso ─────────────────────────────────────
  // Regressione lineare sui pesi degli ultimi `days` giorni → ritmo kg/settimana
  // e, se un target è impostato e il trend va nella direzione giusta, la data
  // stimata di arrivo. null se i dati non bastano (<2 punti nel periodo).
  function weightProjection(weightLog, targetKg, days) {
    days = days || 21;
    const log = (weightLog || []).filter(e => e && e.date && e.weight > 0);
    if (log.length < 2) return null;
    const lastDate = log[log.length - 1].date;
    const cut = new Date(lastDate + "T12:00:00");
    cut.setDate(cut.getDate() - days);
    const cutKey = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
    const pts = log.filter(e => e.date >= cutKey);
    if (pts.length < 2) return null;
    const t0 = new Date(pts[0].date + "T12:00:00").getTime();
    const xs = pts.map(e => (new Date(e.date + "T12:00:00").getTime() - t0) / 86400000);
    const ys = pts.map(e => e.weight);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
    if (!den) return null;
    const slopePerDay = num / den;
    const current = ys[ys.length - 1];
    const out = { ratePerWeek: Math.round(slopePerDay * 7 * 100) / 100, current };
    const target = _num(targetKg);
    if (target != null) {
      out.target = target;
      const diff = target - current;
      if (Math.abs(diff) <= 0.3) {
        out.reached = true;
      } else if (slopePerDay !== 0 && (diff > 0) === (slopePerDay > 0)) {
        const daysTo = diff / slopePerDay;
        if (daysTo > 0 && daysTo < 730) {
          const eta = new Date(lastDate + "T12:00:00");
          eta.setDate(eta.getDate() + Math.round(daysTo));
          out.etaDays = Math.round(daysTo);
          out.etaDate = `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, "0")}-${String(eta.getDate()).padStart(2, "0")}`;
        }
      }
    }
    return out;
  }

  // ── Aderenza pasti ────────────────────────────────────────────────────────
  function mealAdherence(checkedMap, totalMeals) {
    const done = Object.keys(checkedMap || {}).filter(k => checkedMap[k]).length;
    const total = Number(totalMeals) || 0;
    return { done: Math.min(done, total), total, pct: total ? Math.round(Math.min(done, total) / total * 100) : 0 };
  }

  // ── Sostituzioni alimenti (equivalenza kcal per 100g, valori standard) ────
  // Gruppi: si sostituisce SOLO dentro lo stesso gruppo. La grammatura
  // equivalente mantiene le kcal della porzione originale.
  const FOOD_GROUPS = [
    { id: "carbo", items: [
      { match: /\briso\b/,            name: "Riso (secco)",      kcal: 360 },
      { match: /\bpasta\b/,           name: "Pasta (secca)",     kcal: 360 },
      { match: /\bpane\b/,            name: "Pane",              kcal: 250 },
      { match: /\bpatat/,             name: "Patate",            kcal: 77  },
      { match: /\bgallette\b/,        name: "Gallette",          kcal: 380 },
    ]},
    { id: "proteine", items: [
      { match: /\bpollo\b/,           name: "Pollo (petto)",     kcal: 110 },
      { match: /\btacchino\b/,        name: "Tacchino",          kcal: 105 },
      { match: /\bmanzo\b|\bbisteccc?a\b|\bvitello\b/, name: "Manzo magro", kcal: 130 },
      { match: /\bmerluzzo\b/,        name: "Merluzzo",          kcal: 82  },
      { match: /\borata\b/,           name: "Orata",             kcal: 100 },
      { match: /\bsalmone\b/,         name: "Salmone",           kcal: 185 },
      { match: /\btonno\b/,           name: "Tonno al naturale", kcal: 105 },
      { match: /\buova\b|\buovo\b/,   name: "Uova",              kcal: 143 },
    ]},
    { id: "grassi", items: [
      { match: /\bolio\b/,            name: "Olio EVO",          kcal: 900 },
      { match: /\bnoci\b/,            name: "Noci",              kcal: 650 },
      { match: /\bmandorl/,           name: "Mandorle",          kcal: 600 },
    ]},
  ];

  function _swapsFrom(group, base, grams) {
    const kcal = base.kcal * grams / 100;
    return group.items
      .filter(it => it !== base)
      .map(it => ({ name: it.name, grams: Math.round(kcal / it.kcal * 100 / 5) * 5 }))
      .filter(s => s.grams >= 5);
  }

  function _findBase(text) {
    for (const group of FOOD_GROUPS) {
      const base = group.items.find(it => it.match.test(text));
      if (base) return { group, base };
    }
    return null;
  }

  // foodSwaps("Riso basmati", "80g") → [{name:"Pasta (secca)", grams:80}, {name:"Patate", grams:375}, …]
  // Supporta due formati: qty separata ("80–100g") + alimento nel testo, oppure
  // il formato del dieta.txt parsato dove i grammi stanno NEL testo
  // ("Carboidrato (scegli 1): 80g pasta farro | 80g riso rosso | …"): si usa il
  // primo segmento "NNg alimento" riconosciuto come base dell'equivalenza.
  // Ritorna [] se nessun alimento è riconosciuto o mancano i grammi.
  function foodSwaps(foodText, qtyText) {
    const text = String(foodText || "").toLowerCase();
    // 1) grammatura nel campo qty ("80g", "80–100g": prende il primo numero)
    const mQty = String(qtyText || "").match(/(\d+)\s*[–\-e]?\s*\d*\s*g/);
    if (mQty) {
      const hit = _findBase(text);
      if (hit) return _swapsFrom(hit.group, hit.base, parseInt(mQty[1], 10));
    }
    // 2) grammatura nel testo: primo segmento (split su | e +) tipo "NNg alimento"
    for (const seg of text.split(/[|+]/)) {
      const m = seg.match(/(\d+)\s*g\s+(.+)/);
      if (!m) continue;
      const hit = _findBase(m[2]);
      if (hit) return _swapsFrom(hit.group, hit.base, parseInt(m[1], 10));
    }
    return [];
  }

  window.Insights = {
    e1rm, exerciseSessions, sessionSummary, weeklyReport,
    deloadAdvice, deloadWeight, mealAdherence, foodSwaps,
    movingAverage, weightProjection,
  };
})();
