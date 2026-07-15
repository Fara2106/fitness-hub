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

// Blocco piatto persistito: { completion:{id:[]}, substitutions:{id}, pesos:{id:[]} }.
function readSchedaProg(storage, dateKey) {
  const all = storage ? storage.get(schedaProgKey(dateKey), null) : null;
  return {
    completion:    (all && all.completion)    || {},
    substitutions: (all && all.substitutions) || {},
    pesos:         (all && all.pesos)          || {},
  };
}

function writeSchedaProg(storage, dateKey, patch) {
  if (!storage) return;
  const cur = readSchedaProg(storage, dateKey);
  const next = {
    completion:    Object.assign({}, cur.completion,    patch.completion),
    substitutions: Object.assign({}, cur.substitutions, patch.substitutions),
    pesos:         Object.assign({}, cur.pesos,          patch.pesos),
  };
  storage.set(schedaProgKey(dateKey), next);
}

window.exId = exId;
window.getDayState = getDayState;
window.schedaProgKey = schedaProgKey;
window.readSchedaProg = readSchedaProg;
window.writeSchedaProg = writeSchedaProg;
