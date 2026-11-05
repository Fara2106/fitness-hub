// schedaState.jsx — logica pura (no React) dello stato Scheda keyed-by-id.
// Lo stato per-esercizio è indicizzato per id STABILE `${dayKey}#${pos}`, non
// per posizione nell'array del giorno corrente: giorni diversi hanno chiavi
// diverse → il "bleed tra giorni" è impossibile per costruzione. Testato in
// test/run.mjs (Suite schedaState).

// id derivato dal giorno + posizione (NON memorizzato nel testo scheda:
// il round-trip col futuro editor resta possibile).
function exId(dayKey, pos) {
  return `${dayKey}#${pos}`;
}

// Estrae i valori di UN giorno da una mappa keyed-by-id: [map[id(day,0)] … map[id(day,n-1)]].
function getDayState(map, dayKey, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((map || {})[exId(dayKey, i)]);
  return out;
}

function schedaProgKey(dateKey) {
  return `schedaProg_${dateKey}`;
}

// Blocco piatto persistito: { completion:{id:[]}, substitutions:{id}, pesos:{id:[]},
// names:{id: nome esercizio}, sig: firma del piano }. names/sig servono a non
// attribuire il progresso di oggi a un altro esercizio quando la scheda cambia
// (import/cloud): gli id sono posizionali, "Giorno 1#0" resta uguale anche se
// all'esercizio 0 ora c'è un altro movimento.
function readSchedaProg(storage, dateKey) {
  const all = storage ? storage.get(schedaProgKey(dateKey), null) : null;
  return {
    completion:    (all && all.completion)    || {},
    substitutions: (all && all.substitutions) || {},
    pesos:         (all && all.pesos)          || {},
    names:         (all && all.names)          || {},
    sig:           (all && all.sig)            || null,
  };
}

// meta (opzionale): { names: {id: nome}, sig } — registrati insieme alla patch.
function writeSchedaProg(storage, dateKey, patch, meta) {
  if (!storage) return;
  const cur = readSchedaProg(storage, dateKey);
  const next = {
    completion:    Object.assign({}, cur.completion,    patch.completion),
    substitutions: Object.assign({}, cur.substitutions, patch.substitutions),
    pesos:         Object.assign({}, cur.pesos,          patch.pesos),
    names:         Object.assign({}, cur.names,          meta && meta.names),
    sig:           (meta && meta.sig) || cur.sig,
  };
  storage.set(schedaProgKey(dateKey), next);
}

// Ruling 62: `pesos` persistiti = solo ciò che l'utente ha toccato. null = serie mai toccata (a video
// la proposta), "" = campo svuotato a mano (a video resta vuoto).
// Un peso proposto (ultima sessione, default scheda) resta a video e in memoria, ma finisce nel
// blocco, e quindi in un setLog, solo con un gesto: peso digitato o serie spuntata.
function schedaPesoAt(saved, n, setIdx, value) {
  const arr = new Array(Math.max(n, setIdx + 1)).fill(null);
  (saved || []).forEach((v, i) => { if (i < arr.length && v != null) arr[i] = v; });
  arr[setIdx] = value == null ? "" : String(value);
  return arr;
}

// Pesi a video di un esercizio: toccati oggi, anche svuotati → ultime sessioni → default scheda.
function schedaShownPesos(saved, ex, lastWeights) {
  const row = lastWeights && lastWeights[String(ex.name || "").toLowerCase()];
  return (ex.sets || []).map((s, i) => {
    const v = saved && saved[i];
    if (v != null) return String(v);
    if (row && row[i] != null) return String(row[i]);
    return String(s.peso || "");
  });
}

// La stessa vista per tutti gli esercizi del piano: { id: [pesi a video] }.
function schedaShownAll(pesos, days, lastWeights) {
  const out = {};
  (days || []).forEach(d => (d.exercises || []).forEach((ex, i) => {
    const id = exId(d.key, i);
    out[id] = schedaShownPesos((pesos || {})[id], ex, lastWeights);
  }));
  return out;
}

// Pesi da registrare con una patch di completion: per ogni serie appena spuntata, quello a video.
function schedaTickPesos(cur, completionPatch, shown) {
  const out = {};
  Object.keys(completionPatch || {}).forEach(id => {
    const arr = completionPatch[id] || [];
    const was = (cur.completion || {})[id] || [];
    let p = (cur.pesos || {})[id];
    arr.forEach((done, i) => {
      const v = shown && shown[id] ? shown[id][i] : null;
      if (done && !was[i] && v != null && v !== "") { p = schedaPesoAt(p, arr.length, i, v); out[id] = p; }
    });
  });
  return out;
}

// Firma del piano: giorni + nomi esercizi + numero serie.
function schedaPlanSig(days) {
  return (days || []).map(d => d.key + ":" + (d.exercises || [])
    .map(e => String(e.name || "").toLowerCase() + "/" + ((e.sets && e.sets.length) || 0)).join(",")).join("|");
}

// Nome (originale, minuscolo) dell'esercizio a un id nel piano corrente.
function schedaNameAt(days, id) {
  const i = String(id).lastIndexOf("#");
  const day = (days || []).find(d => d.key === String(id).slice(0, i));
  const ex = day && (day.exercises || [])[Number(String(id).slice(i + 1))];
  return ex ? { name: String(ex.name || "").toLowerCase(), n: (ex.sets && ex.sets.length) || 0 } : null;
}

// Ripulisce il progresso di oggi rispetto al piano corrente: scarta le voci il
// cui esercizio non esiste più o è cambiato (nome registrato ≠ nome attuale;
// senza nome registrato, se la firma del piano è cambiata) e adatta le serie
// al nuovo numero. → { prog, changed }
function sanitizeSchedaProg(prog, days, sig) {
  const planChanged = !!(prog.sig && sig && prog.sig !== sig);
  const out = { completion: {}, substitutions: {}, pesos: {}, names: {}, sig: sig || prog.sig };
  let changed = !!(sig && prog.sig !== sig);
  const ids = new Set([].concat(Object.keys(prog.completion), Object.keys(prog.substitutions), Object.keys(prog.pesos)));
  ids.forEach(id => {
    const cur = schedaNameAt(days, id);
    const saved = prog.names[id];
    const valid = cur && (saved ? saved === cur.name : !planChanged);
    if (!valid) { changed = true; return; }
    const fit = (arr, fill) => {
      if (!Array.isArray(arr)) return arr;
      if (arr.length === cur.n) return arr;
      changed = true;
      return arr.slice(0, cur.n).concat(new Array(Math.max(0, cur.n - arr.length)).fill(fill));
    };
    if (id in prog.completion)    out.completion[id]    = fit(prog.completion[id], false);
    if (id in prog.pesos)         out.pesos[id]         = fit(prog.pesos[id], null);
    if (id in prog.substitutions) out.substitutions[id] = prog.substitutions[id];
    out.names[id] = cur.name;
    if (!saved) changed = true;
  });
  return { prog: out, changed };
}

window.exId = exId;
window.getDayState = getDayState;
window.schedaProgKey = schedaProgKey;
window.readSchedaProg = readSchedaProg;
window.writeSchedaProg = writeSchedaProg;
window.schedaPesoAt = schedaPesoAt;
window.schedaShownPesos = schedaShownPesos;
window.schedaShownAll = schedaShownAll;
window.schedaTickPesos = schedaTickPesos;
window.schedaPlanSig = schedaPlanSig;
window.schedaNameAt = schedaNameAt;
window.sanitizeSchedaProg = sanitizeSchedaProg;
