# Scheda + Player + refactor keyed-by-id — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un Player allenamento a schermo intero in `scheda.jsx`, rifattorizzare lo stato per-posizione in una mappa keyed-by-id che elimina il bleed tra giorni, ed estrarre i dati hardcoded in un fallback testuale parsato.

**Architecture:** Tre pezzi. (A) Estrazione dati: nuovo `defaults.jsx` con il testo grezzo di `scheda.txt`/`dieta.txt`; `getSchedule()` fa fallback a `parseScheda(SCHEDA_TXT_FALLBACK)`; `_DEFAULT_DAYS` eliminato. (B) Refactor: nuovo modulo puro `schedaState.jsx` (`exId`, lettura per-giorno, persistenza flat) testabile dall'harness; `scheda.jsx` indicizza tutto lo stato per `` `${dayKey}#${pos}` ``, `switchTo` non swappa più stato. (C) Player: vista interna a `scheda.jsx` (`mode: "list"|"player"`), un esercizio alla volta, riusa `TimerOverlay`/`SubstitutePopover`/`Confetti`/`handleSaveSession`.

**Tech Stack:** React 18 via CDN + Babel standalone (nessun build step). Test: harness Node `test/run.mjs` (`@babel/core` + `node:vm`).

## Global Constraints

- **No build step.** Ogni componente esposto come global: `window.Nome = Nome;`. **Mai** `import`/`export` ES nei file `.jsx`.
- **Persistenza `window.storage`** (IndexedDB). Mai `localStorage`/`sessionStorage`.
- **Nessun `<form>`** — `onClick`/`onChange` diretti.
- **Load order in `index.html`**: un global va definito prima del file che lo usa. Ogni nuovo `.jsx` va aggiunto alla lista `<script type="text/babel" src="...?v=BUILD">` E alla precache di `sw.js`.
- **`npm test` dopo ogni edit** (smoke su ogni `.jsx` + unit parser/state).
- **Niente RPE / mesociclo** — rimossi il 14/07, non reintrodurre né in UI né nel prompt coach.
- **Riuso obbligatorio** (non reimplementare): `TimerOverlay` (timestamp `endRef` + Wake Lock), `SubstitutePopover`, `HistoryPopover`, `Confetti`, `handleSaveSession`.
- **Deploy**: NON in questo lavoro. A fine piano: solo commit locali; il deploy (bump `CACHE_NAME` in `sw.js` + `?v=` in `index.html`) lo fa Lorenzo con lo script. I passi che toccano `index.html`/`sw.js` aggiungono solo le nuove righe, senza bump globale.

## File Structure

- **Create `defaults.jsx`** — `window.SCHEDA_TXT_FALLBACK` / `window.DIETA_TXT_FALLBACK` (testo grezzo dei `.txt`). Generato, non scritto a mano.
- **Create `dev/gen-defaults.mjs`** — rigenera `defaults.jsx` dai `.txt` (in `dev/`, escluso dal build Pages).
- **Create `schedaState.jsx`** — modulo puro (no React): `exId`, `getDayState`, `readSchedaProg`, `writeSchedaProg`, `schedaProgKey`.
- **Modify `parser.jsx`** — `getSchedule()` fa fallback al testo embedded.
- **Modify `screens/scheda.jsx`** — rimuove `_DEFAULT_DAYS`; stato keyed-by-id; `switchTo` senza swap; nuovo Player.
- **Modify `screens/coach.jsx`** — usa i fallback quando storage è vuoto.
- **Modify `i18n.jsx`** — nuove stringhe Player (IT+EN).
- **Modify `test/run.mjs`** — Suite dati (drift + fallback validi) + Suite `schedaState`.
- **Modify `index.html`, `sw.js`, `package.json`** — registrazione nuovi file + script gen.

---

## Task 1: Estrazione dati — `defaults.jsx` + fallback in `getSchedule`

**Files:**
- Create: `dev/gen-defaults.mjs`
- Create: `defaults.jsx` (via lo script sopra)
- Modify: `package.json` (script `gen:defaults`)
- Modify: `parser.jsx:144-149` (`getSchedule`)
- Modify: `test/run.mjs` (carica `defaults.jsx` nel sandbox + nuovi assert)
- Modify: `screens/scheda.jsx:3-55` (rimuove `_DEFAULT_DAYS`, semplifica `_buildSchedule`)
- Modify: `screens/coach.jsx:30-31`
- Modify: `index.html:119` (script prima di `parser.jsx`)
- Modify: `sw.js:20` (precache)

**Interfaces:**
- Produces: `window.SCHEDA_TXT_FALLBACK: string`, `window.DIETA_TXT_FALLBACK: string`. `window.getSchedule(): {days:[...]}` (ora non ritorna mai `{days:[]}` se il fallback è valido).

- [ ] **Step 1: Scrivi il generatore `dev/gen-defaults.mjs`**

```js
// dev/gen-defaults.mjs — rigenera defaults.jsx dai .txt del repo.
// Lancio: npm run gen:defaults. Il testo va incorporato COM'È (drift-test in run.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const scheda = readFileSync(join(ROOT, "scheda.txt"), "utf8");
const dieta = readFileSync(join(ROOT, "dieta.txt"), "utf8");

const out = `// defaults.jsx — GENERATO da dev/gen-defaults.mjs. NON modificare a mano.
// Fallback testuale (stesso formato dei .txt) usato quando storage è vuoto
// (primissima apertura offline / fetch fallito). Rigenera: npm run gen:defaults.
window.SCHEDA_TXT_FALLBACK = ${JSON.stringify(scheda)};
window.DIETA_TXT_FALLBACK = ${JSON.stringify(dieta)};
`;
writeFileSync(join(ROOT, "defaults.jsx"), out);
console.log("defaults.jsx rigenerato (" + scheda.length + " + " + dieta.length + " char)");
```

- [ ] **Step 2: Aggiungi lo script npm**

In `package.json`, dentro `"scripts"`, aggiungi (accanto a `"test"`):

```json
"gen:defaults": "node dev/gen-defaults.mjs"
```

- [ ] **Step 3: Genera `defaults.jsx`**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && npm run gen:defaults`
Expected: stampa `defaults.jsx rigenerato (4653 + 10734 char)` (i numeri possono variare se i `.txt` cambiano). Crea `defaults.jsx` in root.

- [ ] **Step 4: Scrivi i test dati falliti in `test/run.mjs`**

In `test/run.mjs`, dopo il caricamento di `parser.jsx` nel sandbox (dopo la riga `vm.runInContext(transform(join(ROOT, "parser.jsx")), sandbox, ...)` e il relativo `ok(...)`), **prima** di `const W = sandbox.window;` NON serve; inserisci il blocco **dopo** `const W = sandbox.window;` così:

```js
// ---- Suite dati: defaults.jsx (fallback embedded) ----
console.log("\nSuite dati — defaults.jsx allineato + fallback validi");
try {
  vm.runInContext(transform(join(ROOT, "defaults.jsx")), sandbox, { filename: "defaults.jsx" });
  ok("defaults.jsx si carica sotto vm", true);
} catch (e) {
  ok("defaults.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
}
ok("SCHEDA_TXT_FALLBACK === scheda.txt (no drift)",
  W.SCHEDA_TXT_FALLBACK === readFileSync(join(ROOT, "scheda.txt"), "utf8"));
ok("DIETA_TXT_FALLBACK === dieta.txt (no drift)",
  W.DIETA_TXT_FALLBACK === readFileSync(join(ROOT, "dieta.txt"), "utf8"));
if (typeof W.parseScheda === "function") {
  const sf = W.parseScheda(W.SCHEDA_TXT_FALLBACK);
  ok("fallback scheda: ≥1 giorno con esercizi",
    sf.days.length >= 1 && sf.days.every(d => d.exercises.length > 0));
  ok("getSchedule() senza storage → fallback non vuoto",
    W.getSchedule().days.length >= 1);
}
if (typeof W.parseDieta === "function") {
  const df = W.parseDieta(W.DIETA_TXT_FALLBACK);
  ok("fallback dieta: sezione riposo presente", !!(df && df.riposo));
}
```

- [ ] **Step 5: Esegui i test — verifica che il drift-test passi ma `getSchedule` fallback fallisca**

Run: `npm test`
Expected: i test di drift PASSANO; `getSchedule() senza storage → fallback non vuoto` **FALLISCE** (getSchedule attuale ritorna `{days:[]}` quando manca `schedaData`). Questo è il rosso che guida lo Step 6.

- [ ] **Step 6: Modifica `getSchedule` in `parser.jsx` per il fallback**

Sostituisci `parser.jsx:144-149`:

```js
window.getSchedule = function () {
  const st = window.storage;
  const text = (st ? st.get("schedaData", null) : null) || window.SCHEDA_TXT_FALLBACK || null;
  if (!text) return { days: [] };
  try { return window.parseScheda(text); } catch (_) { return { days: [] }; }
};
```

- [ ] **Step 7: Esegui i test — ora tutto verde**

Run: `npm test`
Expected: tutti i PASS, incluso `getSchedule() senza storage → fallback non vuoto`.

- [ ] **Step 8: Rimuovi `_DEFAULT_DAYS` e semplifica `_buildSchedule` in `scheda.jsx`**

In `screens/scheda.jsx`, **elimina** l'intero blocco `const _DEFAULT_DAYS = [ … ];` (righe 3-40) e sostituisci `_buildSchedule` (righe 42-55) con:

```js
// Lista ordinata dei giorni: sempre da getSchedule() (che ha il fallback
// testuale embedded in defaults.jsx quando storage è vuoto).
function _buildSchedule() {
  const sched = window.getSchedule ? window.getSchedule() : { days: [] };
  const days = (sched && sched.days) || [];
  return days.map(d => ({
    ...d,
    exercises: (d.exercises || []).map(ex => ({ ...ex, history: ex.history || [] })),
  }));
}
```

- [ ] **Step 9: Aggancia i fallback nel coach**

In `screens/coach.jsx`, sostituisci le righe 30-31:

```js
  const schedaData = (st ? st.get("schedaData", null) : null) || window.SCHEDA_TXT_FALLBACK || null;
  const dietaData  = (st ? st.get("dietaData",  null) : null) || window.DIETA_TXT_FALLBACK  || null;
```

- [ ] **Step 10: Registra `defaults.jsx` in `index.html` e `sw.js`**

In `index.html`, aggiungi **prima** della riga `parser.jsx` (index.html:119):

```html
<script type="text/babel" src="defaults.jsx?v=20260714231312"></script>
```

In `sw.js`, dentro `STATIC_ASSETS` (dopo `BASE + "/storage.jsx",`, prima di `BASE + "/parser.jsx",`):

```js
  BASE + "/defaults.jsx",
```

- [ ] **Step 11: `npm test` finale + commit**

Run: `npm test`
Expected: tutti verdi (lo smoke ora transla anche `defaults.jsx`).

```bash
git add defaults.jsx dev/gen-defaults.mjs package.json parser.jsx screens/scheda.jsx screens/coach.jsx test/run.mjs index.html sw.js
git commit -m "$(cat <<'EOF'
feat(scheda): estrai dati hardcoded in defaults.jsx (fallback testuale parsato)

_DEFAULT_DAYS (Upper/Lower a bilanciere, ormai divergente dal PPL in
scheda.txt) rimosso. getSchedule() fa fallback a parseScheda(SCHEDA_TXT_
FALLBACK). Coach usa i fallback a storage vuoto. Drift-test in run.mjs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Modulo puro `schedaState.jsx` (exId + persistenza flat)

**Files:**
- Create: `schedaState.jsx`
- Modify: `test/run.mjs` (Suite `schedaState`)
- Modify: `index.html` (script prima di `scheda.jsx`)
- Modify: `sw.js` (precache)

**Interfaces:**
- Produces:
  - `window.exId(dayKey: string, pos: number): string` → `` `${dayKey}#${pos}` ``
  - `window.getDayState(map: object, dayKey: string, n: number): any[]` → `[map[exId(dayKey,0)], … map[exId(dayKey,n-1)]]`
  - `window.schedaProgKey(dateKey: string): string` → `` `schedaProg_${dateKey}` ``
  - `window.readSchedaProg(storage, dateKey): {completion, substitutions, pesos}` (blocco piatto)
  - `window.writeSchedaProg(storage, dateKey, patch): void`

- [ ] **Step 1: Scrivi la Suite `schedaState` (test falliti) in `test/run.mjs`**

In `test/run.mjs`, **prima** del blocco `// ---- Esito ----`, inserisci:

```js
// ---- Suite schedaState (modulo puro, sandbox vm) ----
console.log("\nSuite schedaState — id + persistenza keyed-by-id");
try {
  vm.runInContext(transform(join(ROOT, "schedaState.jsx")), sandbox, { filename: "schedaState.jsx" });
  ok("schedaState.jsx si carica sotto vm", true);
} catch (e) {
  ok("schedaState.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
}
if (typeof W.exId === "function") {
  ok("exId compone dayKey#pos", W.exId("Upper A", 3) === "Upper A#3");
  ok("exId distingue giorni alla stessa posizione", W.exId("Upper A", 0) !== W.exId("Lower", 0));

  // Bleed simulation: la mappa piatta isola i giorni per costruzione.
  const completion = {};
  completion[W.exId("Upper A", 0)] = [true, true, false];
  completion[W.exId("Lower", 0)]   = [false];
  const upA = W.getDayState(completion, "Upper A", 1);
  const low = W.getDayState(completion, "Lower", 1);
  ok("getDayState: Upper A legge solo i suoi id", JSON.stringify(upA[0]) === JSON.stringify([true, true, false]));
  ok("getDayState: scrivere Lower non tocca Upper A", JSON.stringify(low[0]) === JSON.stringify([false]));
  ok("getDayState: posizione assente → undefined", W.getDayState(completion, "Upper A", 2)[1] === undefined);
}
if (typeof W.readSchedaProg === "function") {
  // Fake storage sincrono in stile window.storage.
  const fake = { _d: {}, get(k, d) { return k in this._d ? this._d[k] : d; }, set(k, v) { this._d[k] = v; } };
  const empty = W.readSchedaProg(fake, "2026-07-15");
  ok("readSchedaProg: blocco vuoto ha completion/substitutions/pesos",
    empty && empty.completion && empty.substitutions && empty.pesos);
  W.writeSchedaProg(fake, "2026-07-15", { completion: { "Upper A#0": [true] } });
  W.writeSchedaProg(fake, "2026-07-15", { pesos: { "Upper A#0": ["80"] } });
  const merged = W.readSchedaProg(fake, "2026-07-15");
  ok("writeSchedaProg: merge preserva chiavi precedenti",
    merged.completion["Upper A#0"][0] === true && merged.pesos["Upper A#0"][0] === "80");
  ok("schedaProgKey usa la data", W.schedaProgKey("2026-07-15") === "schedaProg_2026-07-15");
}
```

- [ ] **Step 2: Esegui — verifica il rosso**

Run: `npm test`
Expected: FAIL su `schedaState.jsx si carica sotto vm` (file inesistente) e a cascata.

- [ ] **Step 3: Scrivi `schedaState.jsx`**

```js
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
```

- [ ] **Step 4: Esegui — verifica il verde**

Run: `npm test`
Expected: tutti i PASS della Suite `schedaState`.

- [ ] **Step 5: Registra `schedaState.jsx` in `index.html` e `sw.js`**

In `index.html`, aggiungi **prima** di `screens/scheda.jsx` (dopo `nav.jsx`, es. index.html:126):

```html
<script type="text/babel" src="schedaState.jsx?v=20260714231312"></script>
```

In `sw.js`, dentro `STATIC_ASSETS` (dopo `BASE + "/nav.jsx",`):

```js
  BASE + "/schedaState.jsx",
```

- [ ] **Step 6: Commit**

```bash
git add schedaState.jsx test/run.mjs index.html sw.js
git commit -m "$(cat <<'EOF'
feat(scheda): modulo puro schedaState (exId keyed-by-id + prog flat)

exId(dayKey,pos), getDayState, read/writeSchedaProg (blocco piatto).
Testato in run.mjs con simulazione bleed tra giorni.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wiring `scheda.jsx` allo stato keyed-by-id

Rifattorizza il componente `Scheda` perché tutto lo stato per-esercizio sia indicizzato per `exId(scheda, i)` e `switchTo` non swappi più stato. Nessun cambiamento visivo: stessa lista, stesso salvataggio.

**Files:**
- Modify: `screens/scheda.jsx` (funzioni `_progKey`/`_loadProg`/`_saveProg` → rimosse; componente `Scheda` righe 517-842; mapping `ExerciseCard`)
- Test: smoke (`npm test`) + QA manuale bleed

**Interfaces:**
- Consumes: `window.exId`, `window.getDayState`, `window.readSchedaProg`, `window.writeSchedaProg` (Task 2).

- [ ] **Step 1: Rimuovi gli helper prog per-tab in `scheda.jsx`**

**Elimina** il blocco `_progKey`/`_loadProg`/`_saveProg` (righe 57-75 attuali). Verranno sostituiti dagli helper globali di `schedaState.jsx`. Aggiungi in cima al file (dopo `_buildSchedule`) un piccolo accessor per la data:

```js
// Chiave giorno per la persistenza dei progressi (schedaProg_<date>).
function _todayK() {
  return window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Converti gli stati iniziali del componente a keyed-by-id**

In `const Scheda = (...)`, sostituisci le inizializzazioni di stato (righe ~521-535) con la versione che carica il blocco piatto UNA volta e mantiene mappe keyed-by-id valide per tutti i giorni:

```js
  const [days]  = React.useState(() => _buildSchedule());
  const current = days.find(d => d.key === scheda) || days[0] || { key: "", num: 0, name: "", focus: [], exercises: [] };

  // Blocco progressi di giornata (piatto, keyed-by-id, valido per TUTTI i giorni).
  const [prog, setProg] = React.useState(() => window.readSchedaProg(window.storage, _todayK()));
  const completion    = prog.completion;      // { "Day#pos": [bool,…] }
  const substitutions = prog.substitutions;   // { "Day#pos": "nome alt" }
  const [timer, setTimer]   = React.useState(null);
  const [occupied, setOccupied] = React.useState({}); // effimero, keyed-by-id
  const [showConfetti, setShowConfetti] = React.useState(false);
  const [notes, setNotes]   = React.useState(() => window.storage ? window.storage.get(`notes_${_todayK()}`, "") : "");
  const [sheetsWeights, setSheetsWeights] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const prevDoneRef = React.useRef(null);
  // Ref pesi condiviso per il salvataggio Sheets, keyed-by-id.
  const pesosRef = React.useRef(null);
  if (pesosRef.current === null) pesosRef.current = Object.assign({}, prog.pesos);
```

- [ ] **Step 3: Aggiungi un helper di scrittura progressi e riscrivi `switchTo`**

Subito dopo gli stati, aggiungi un writer che aggiorna sia lo stato React sia storage, e riscrivi `switchTo` così che **cambi solo il giorno mostrato** (nessuno swap di stato):

```js
  // Persiste una patch nel blocco piatto e aggiorna lo stato locale.
  const patchProg = (patch) => {
    window.writeSchedaProg(window.storage, _todayK(), patch);
    setProg(p => ({
      completion:    Object.assign({}, p.completion,    patch.completion),
      substitutions: Object.assign({}, p.substitutions, patch.substitutions),
      pesos:         Object.assign({}, p.pesos,          patch.pesos),
    }));
  };

  // Cambia SOLO il giorno mostrato. Lo stato è keyed-by-id e vive per tutti i
  // giorni insieme → niente swap, niente bleed.
  const switchTo = (k) => {
    setScheda(k);
    if (window.storage) window.storage.set("schedaSelectedDay", k);
    const exs = (days.find(d => d.key === k) || {}).exercises || [];
    const tot = exs.reduce((n, ex) => n + ex.sets.length, 0);
    const done = exs.reduce((n, ex, i) => n + ((completion[window.exId(k, i)] || []).filter(Boolean).length), 0);
    setOccupied({});
    prevDoneRef.current = tot > 0 && done === tot; // no confetti rientrando in sessione completa
  };
```

- [ ] **Step 4: Rimuovi il vecchio effect di persistenza per-tab**

**Elimina** l'effect che salvava `_saveProg(scheda, { completion, substitutions })` (righe ~555-557): ora la persistenza avviene dentro `patchProg`, non serve più un effect su `scheda`.

- [ ] **Step 5: Aggiorna i calcoli derivati e `toggleSet` a keyed-by-id**

Sostituisci il calcolo `completedSets`/`totalSets` e `toggleSet` (righe ~577-613) con:

```js
  const exercises = current.exercises || [];
  const totalSets = exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const completedSets = exercises.reduce(
    (n, ex, i) => n + ((completion[window.exId(scheda, i)] || []).filter(Boolean).length), 0
  );
  const pct = totalSets ? (completedSets / totalSets) * 100 : 0;
  const allDone = completedSets > 0 && completedSets === totalSets;
  if (prevDoneRef.current === null) prevDoneRef.current = allDone;

  const toggleSet = (exIdx, setIdx) => {
    if (navigator.vibrate) navigator.vibrate([100]);
    const id = window.exId(scheda, exIdx);
    const arr = [...(completion[id] || new Array(exercises[exIdx].sets.length).fill(false))];
    const wasCompleted = arr[setIdx];
    arr[setIdx] = !arr[setIdx];
    patchProg({ completion: { [id]: arr } });
    if (!wasCompleted) {
      const restSecs = exercises[exIdx]?.rest || 90;
      setTimeout(() => setTimer(restSecs), 50);
    }
  };
```

- [ ] **Step 6: Aggiorna `handleSaveSession` a keyed-by-id**

Dentro `handleSaveSession`, dove costruisce `muscleSets` e salva le serie, l'accesso allo stato per-esercizio deve usare `exId(scheda, exIdx)`. Sostituisci i due punti:

Nel calcolo `daily` (muscleSets):
```js
        exercises.forEach((ex, exIdx) => {
          const done = (completion[window.exId(scheda, exIdx)] || []).filter(Boolean).length;
          if (!done) return;
          const g = GROUP[(ex.muscles && ex.muscles[0]) || ""] || "Altro";
          daily[g] = (daily[g] || 0) + done;
        });
```

Nel salvataggio serie:
```js
        exercises.forEach((ex, exIdx) => {
          const id = window.exId(scheda, exIdx);
          const exCompletion = completion[id] || [];
          const exName = substitutions[id] || ex.name;
          const exPesos = pesosRef.current[id] || ex.sets.map(s => String(s.peso));
          ex.sets.forEach((s, setIdx) => {
            if (!exCompletion[setIdx]) return;
            const raw = exPesos[setIdx];
            const peso = (raw != null && String(raw).trim() !== "") ? raw : s.peso;
            savePromises.push(
              window.sheetsAPI.savePeso({
                date: today, esercizio: exName, setN: setIdx + 1,
                peso, rip: s.rip, sessione: current.name || scheda,
              })
            );
          });
        });
```

- [ ] **Step 7: Aggiorna il mapping `ExerciseCard` a keyed-by-id**

Nella `.map` che renderizza gli `ExerciseCard` (righe ~765-784), usa `exId(scheda, i)`:

```js
        {exercises.map((ex, i) => {
          const id = window.exId(scheda, i);
          return (
            <ExerciseCard
              key={id}
              ex={ex}
              isDesktop={isDesktop}
              completed={completion[id] || new Array(ex.sets.length).fill(false)}
              onToggleSet={(j) => toggleSet(i, j)}
              onRest={(s) => setTimer(s)}
              occupied={occupied[id]}
              onOccupied={() => setOccupied(o => ({ ...o, [id]: !o[id] }))}
              substituted={substitutions[id]}
              onSubstitute={(name) => patchProg({ substitutions: { [id]: name } })}
              sheetsWeights={sheetsWeights}
              savedPesos={pesosRef.current[id]}
              onPesosChange={(pesos) => {
                pesosRef.current[id] = pesos;
                patchProg({ pesos: { [id]: pesos } });
              }}
            />
          );
        })}
```

- [ ] **Step 8: Verifica lo smoke + QA bleed manuale**

Run: `npm test`
Expected: smoke verde (tutti i `.jsx` transpilano), Suite `schedaState` verde.

QA manuale (browser/emulazione, servita locale): apri Scheda → G1, spunta 2 serie del 1° esercizio, digita un peso; passa a G2, spunta 1 serie; passa a G3; torna a G1 → **le spunte e il peso di G1 devono essere identici a prima** (nessun bleed), G2/G3 indipendenti. Chiudi sessione con dati misti e verifica su Sheets che i pesi finiscano sull'esercizio giusto.

- [ ] **Step 9: Commit**

```bash
git add screens/scheda.jsx
git commit -m "$(cat <<'EOF'
refactor(scheda): stato per-posizione → keyed-by-id (elimina bleed by construction)

completion/substitutions/occupied/pesos ora indicizzati per exId(day,pos)
in una mappa piatta valida per tutti i giorni. switchTo non swappa più
stato. schedaProg_<date> passa a blocco piatto (progresso effimero, no
migrazione). handleSaveSession legge per id.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Player a schermo intero

**Files:**
- Modify: `i18n.jsx` (nuove stringhe)
- Modify: `screens/scheda.jsx` (nuovo componente `WorkoutPlayer` + `mode`/`cursor` + ingresso intent + bottone lista)
- Modify: `screens/dashboard.jsx` — nessuna (la CTA imposta già `window._schedaIntent`)
- Test: smoke + QA player

**Interfaces:**
- Consumes: `TimerOverlay`, `SubstitutePopover`, `exId`, `patchProg`, `handleSaveSession`, `completion`, `substitutions`, `pesosRef`, `sheetsWeights` (dal componente `Scheda`).

- [ ] **Step 1: Aggiungi le stringhe i18n**

In `i18n.jsx`, dentro `I18N_DICT` (in una nuova sezione `// Player`), aggiungi:

```js
  // Player
  "Serie {n} di {m}": { en: "Set {n} of {m}" },
  "Serie fatta": { en: "Set done" },
  "L'ultima volta": { en: "Last time" },
  "Dopo": { en: "Next" },
  "Auto-recupero": { en: "Auto-rest" },
  "Sessione completa": { en: "Session complete" },
  "Chiudi e salva": { en: "Finish & save" },
  "Esci dal player": { en: "Exit player" },
  "Nessuno storico": { en: "No history" },
```

Nota: `"Inizia allenamento"` esiste già. Il pattern `Serie {n} di {m}` viene usato con replace manuale (vedi Step 3), non è interpolazione automatica.

- [ ] **Step 2: Aggiungi stato `mode`/`cursor` e consumo dell'intent nel componente `Scheda`**

Dopo gli stati esistenti (Task 3 Step 2), aggiungi:

```js
  const [mode, setMode] = React.useState("list");   // "list" | "player"
  const [cursor, setCursor] = React.useState(0);      // indice esercizio nel player
  const [autoRest, setAutoRest] = React.useState(true);

  // Ingresso al player da Home (CTA "Inizia allenamento" imposta _schedaIntent).
  React.useEffect(() => {
    if (window._schedaIntent === "player") {
      window._schedaIntent = null;
      setCursor(0);
      setMode("player");
    }
  }, []);
```

- [ ] **Step 3: Scrivi il componente `WorkoutPlayer`**

In `screens/scheda.jsx`, **prima** di `const Scheda = (...)`, aggiungi il componente. Un esercizio alla volta; "Serie fatta" marca la prima serie non completata e (se autoRest) apre il timer; alla chiusura del timer avanza. Riusa `SubstitutePopover`.

```js
// ── Workout Player (vista a schermo intero, un esercizio alla volta) ────────
const WorkoutPlayer = ({
  dayKey, dayName, exercises, cursor, setCursor,
  completion, substitutions, pesosRef, sheetsWeights,
  autoRest, setAutoRest, onPatch, onClose, onFinish,
}) => {
  const t = useT();
  const [showSubs, setShowSubs] = React.useState(false);
  const [restSecs, setRestSecs] = React.useState(null);

  const ex = exercises[cursor];
  if (!ex) return null;
  const id = window.exId(dayKey, cursor);
  const done = completion[id] || new Array(ex.sets.length).fill(false);
  // Serie corrente = prima non completata (o l'ultima se tutte fatte).
  const rawIdx = done.findIndex(x => !x);
  const curSet = rawIdx === -1 ? Math.max(0, ex.sets.length - 1) : rawIdx;
  const allSetsDone = done.length > 0 && done.every(Boolean);

  // Peso della serie corrente: pesi digitati oggi → Sheets → default scheda.
  const savedP = pesosRef.current[id];
  const pesoVal = (savedP && savedP[curSet] != null)
    ? savedP[curSet]
    : (() => {
        const k = ex ? ex.name.toLowerCase() : "";
        if (sheetsWeights && sheetsWeights[k] && sheetsWeights[k][curSet] != null) return String(sheetsWeights[k][curSet]);
        return String(ex && ex.sets[curSet] ? ex.sets[curSet].peso || "" : "");
      })();

  const setPeso = (v) => {
    const arr = (pesosRef.current[id] || ex.sets.map(s => String(s.peso || ""))).slice();
    arr[curSet] = v;
    pesosRef.current[id] = arr;
    onPatch({ pesos: { [id]: arr } });
  };

  const advance = () => {
    if (cursor < exercises.length - 1) setCursor(cursor + 1);
    else onFinish(); // ultimo esercizio → schermata chiusura
  };

  const serieFatta = () => {
    if (navigator.vibrate) navigator.vibrate([100]);
    const arr = [...done];
    arr[curSet] = true;
    onPatch({ completion: { [id]: arr } });
    const nowAllDone = arr.every(Boolean);
    if (autoRest && !nowAllDone) setRestSecs(ex.rest || 90);
    else if (nowAllDone) setTimeout(advance, 250);
  };

  const label = substitutions[id] ? t(substitutions[id]) : t(ex.name);
  const next = exercises[cursor + 1];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9990,
      background: "var(--bg)", display: "flex", flexDirection: "column",
      padding: "max(env(safe-area-inset-top), 20px) 20px calc(env(safe-area-inset-bottom) + 20px)",
    }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button className="btn ghost" style={{ padding: "8px 10px" }} title={t("Esci dal player")} onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
        <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{dayName} · {cursor + 1}/{exercises.length}</div>
        <button className="btn ghost" style={{ padding: "8px 10px", background: showSubs ? "rgba(10,132,255,0.18)" : "var(--card-2)" }} onClick={() => setShowSubs(s => !s)}>
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {showSubs && (
        <SubstitutePopover
          alternatives={ex.alternatives}
          current={substitutions[id]}
          original={ex.name}
          onPick={(name) => { onPatch({ substitutions: { [id]: name } }); setShowSubs(false); }}
          onClose={() => setShowSubs(false)}
        />
      )}

      {/* Centro: esercizio corrente */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 10 }}>
        <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>
          {t("Serie {n} di {m}").replace("{n}", curSet + 1).replace("{m}", ex.sets.length)}
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.02, maxWidth: 340 }}>{label}</h2>
        {substitutions[id] && <div className="muted" style={{ fontSize: 12, textDecoration: "line-through", marginTop: -4 }}>{t(ex.name)}</div>}

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
          <input
            type="text" value={pesoVal} onChange={(e) => setPeso(e.target.value)}
            placeholder={t("kg o elastico")} className="input num"
            style={{ width: 150, textAlign: "center", fontSize: 40, fontWeight: 700, padding: "8px 10px", borderRadius: 14 }}
          />
          <span className="num" style={{ fontSize: 22, fontWeight: 600, color: "var(--text-2)" }}>× {ex.sets[curSet].rip}</span>
        </div>

        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          {(ex.history && ex.history.length)
            ? `${t("L'ultima volta")}: ${ex.history[0].peso} kg × ${ex.history[0].rip}`
            : t("Nessuno storico")}
        </div>

        {/* Puntini serie */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {done.map((d, i) => (
            <span key={i} style={{
              width: 9, height: 9, borderRadius: "50%",
              background: d ? "var(--success)" : (i === curSet ? "var(--accent)" : "var(--track)"),
            }} />
          ))}
        </div>
      </div>

      {/* Peek prossimo */}
      {next && (
        <div className="muted" style={{ fontSize: 12.5, textAlign: "center", marginBottom: 10 }}>
          {t("Dopo")}: {substitutions[window.exId(dayKey, cursor + 1)] ? t(substitutions[window.exId(dayKey, cursor + 1)]) : t(next.name)}
        </div>
      )}

      {/* Azioni */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button className="btn primary" style={{ width: "100%", padding: 16, fontSize: 16, fontWeight: 600 }} onClick={serieFatta}>
          <Icon name="check" size={17} color="#fff" /> {allSetsDone ? t("Dopo") : t("Serie fatta")}
        </button>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12.5, color: "var(--text-2)" }}>
          <input type="checkbox" checked={autoRest} onChange={(e) => setAutoRest(e.target.checked)} />
          {t("Auto-recupero")} ({ex.rest || 90}s)
        </label>
      </div>

      {restSecs != null && (
        <TimerOverlay seconds={restSecs} onClose={() => { setRestSecs(null); advance(); }} />
      )}
    </div>
  );
};
```

- [ ] **Step 4: Aggiungi il bottone "Inizia allenamento" nella lista e il rendering del player**

Nel `return` di `Scheda`, subito dopo il blocco segmented giorni (dopo la chiusura del `<div>` dei tab, prima dell'intestazione giorno), aggiungi il bottone (solo in modalità lista):

```js
      {/* CTA player */}
      <button
        className="btn primary"
        style={{ width: "100%", padding: 13, fontSize: 15, fontWeight: 600 }}
        onClick={() => { setCursor(0); setMode("player"); }}
      >
        <Icon name="check" size={16} color="#fff" /> {t("Inizia allenamento")}
      </button>
```

E in fondo al `return`, accanto a `{timer != null && …}` e `{showConfetti && …}`, aggiungi il render del player:

```js
      {mode === "player" && (
        <WorkoutPlayer
          dayKey={scheda}
          dayName={current.name}
          exercises={exercises}
          cursor={cursor}
          setCursor={setCursor}
          completion={completion}
          substitutions={substitutions}
          pesosRef={pesosRef}
          sheetsWeights={sheetsWeights}
          autoRest={autoRest}
          setAutoRest={setAutoRest}
          onPatch={patchProg}
          onClose={() => setMode("list")}
          onFinish={() => setMode("list")}
        />
      )}
```

Nota: `onFinish` riporta alla lista, dove la CTA "Chiudi sessione" (già presente, ora evidenziata dal completamento) salva su Sheets con `handleSaveSession`. Il confetti di sessione completa scatta già via l'effect `allDone` esistente (che ora legge `completion` keyed-by-id).

- [ ] **Step 5: Smoke + QA player**

Run: `npm test`
Expected: smoke verde.

QA manuale: da Home → "Inizia allenamento" apre il player sul giorno corrente; "Serie fatta" marca la serie e (auto-recupero on) apre il timer; alla chiusura del timer avanza alla serie/esercizio successivo; ✕ torna alla lista con lo stato preservato; ⋯ sostituisce; editing peso persiste nella lista; all'ultimo esercizio torna alla lista con la CTA "Chiudi sessione" attiva → salva su Sheets. Verifica anche che il giro bleed (Task 3 Step 8) resti ok dopo aver usato il player.

- [ ] **Step 6: Commit**

```bash
git add screens/scheda.jsx i18n.jsx
git commit -m "$(cat <<'EOF'
feat(scheda): Player allenamento a schermo intero (un esercizio alla volta)

Ingresso da Home (_schedaIntent) o bottone lista. Serie fatta → auto-timer
di recupero → avanzamento. Riusa TimerOverlay/SubstitutePopover. Stato
condiviso keyed-by-id con la lista. Nuove stringhe i18n IT+EN. No RPE.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Note finali

- **Deploy**: fuori scope. A lavoro finito, Lorenzo esegue `Deploy GitHub Pages.command` (bump `CACHE_NAME` + `?v=`), poi su iPhone chiude/riapre la PWA (SW sticky). I nuovi file `defaults.jsx` e `schedaState.jsx` sono già in precache e in `index.html` con `?v=` — il bump del deploy li versiona insieme agli altri.
- **Aggiornare CLAUDE.md** dopo il merge: sezione "Recurring bug family — bleed" va riscritta (ora risolto per costruzione via keyed-by-id) e la sezione Player documentata.
- **Memoria**: aggiornare `redesign-status.md` (filone 1 chiuso) e `hardening-status.md` (refactor stato Scheda fatto, non più rimandato).
</content>
