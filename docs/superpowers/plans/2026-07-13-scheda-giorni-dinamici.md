# Scheda a giorni dinamici — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere Scheda/Dashboard/Coach capaci di gestire N giorni di allenamento con nomi arbitrari (Push/Pull/Legs…), con N dinamico letto dal file `scheda.txt`.

**Architecture:** `parseScheda` diventa l'unica fonte di verità e restituisce una lista ordinata `days:[…]`. Helper condivisi (`getSchedule`, `getSelectedSession`) in `parser.jsx`; `getTodaySession` (api.jsx) delega alla sessione selezionata manualmente; Scheda/Dashboard/Coach leggono i giorni dinamici. Toggle "Oggi riposo" per i giorni di cardio.

**Tech Stack:** React 18 via CDN + Babel standalone (no build, no bundler), `window.*` globals, `window.storage` (IndexedDB). Nessun `import`/`export`.

## Global Constraints

- **No build step.** Ogni file espone globali con `window.NomeComponente = …`. Mai `import`/`export`.
- **Persistenza solo `window.storage`.** Mai `localStorage`/`sessionStorage`.
- **No `<form>`**; wiring diretto `onClick`/`onChange`.
- **Load order (index.html):** `storage → api → parser → i18n/icons/anatomy/nav → screens → app`. `api.jsx` carica PRIMA di `parser.jsx`: ok perché `getTodaySession` chiama `getSelectedSession` a runtime (non a load-time).
- **Validazione (no test runner):** `node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"` su ogni `.jsx` toccato. `npx @babel/core` NON funziona.
- **Agenti NON committano/pushano.** Il commit + deploy (bump `CACHE_NAME`/`?v=`) lo fa solo Lorenzo col suo script; poi SW sticky iOS (chiudere e riaprire la PWA).
- **i18n:** ogni `t("chiave")` nuova va aggiunta a IT **e** EN in `i18n.jsx`.
- **Chiavi storage nuove:** `schedaSelectedDay` (key del giorno selezionato), `restDay_<data>` (toggle riposo, per-giorno, spazzato a 90gg da `_cleanupOldDailyKeys`).

---

### Task 1: Parser — nuovo contratto `parseScheda` + helper condivisi

**Files:**
- Modify: `parser.jsx:34-143` (riscrittura di `window.parseScheda`; aggiunta `getSchedule`, `getSelectedSession`, `_musclesFromExercises`)
- Test: `scratchpad/test-parser.mjs` (script Node, non parte del deploy)

**Interfaces:**
- Produces:
  - `window.parseScheda(text) -> { days: Array<{ num:number, key:string, name:string, focus:string[], exercises:Exercise[], altMap:Object }> }`
  - `window.getSchedule() -> { days: [...] }` (legge `schedaData` da storage; `{days:[]}` se assente/non valido)
  - `window.getSelectedSession() -> day | null` (null se `restDay_<oggi>` attivo o nessun giorno)
  - `Exercise` invariato: `{ name, muscles:string[], sets:[{peso,rip,rpe}], rest, notes, ripRange, history:[], alternatives:[] }`

- [ ] **Step 1: Scrivere lo script di test del parser**

Crea `scratchpad/test-parser.mjs`:

```js
import fs from "fs";
import babel from "@babel/core";
global.window = {};
const code = babel.transformFileSync("parser.jsx", { presets: ["@babel/preset-react"] }).code;
eval(code);

const text = fs.readFileSync("scheda.txt", "utf8");
const { days } = window.parseScheda(text);

let ok = true;
const expect = (cond, msg) => { if (!cond) { ok = false; console.error("FAIL:", msg); } };

expect(Array.isArray(days), "days deve essere un array");
expect(days.length === 5, `days.length atteso 5, ricevuto ${days.length}`);
expect(days[0].key === "Giorno 1", `day[0].key atteso 'Giorno 1', ricevuto '${days[0] && days[0].key}'`);
expect(days[0].num === 1, "day[0].num atteso 1");
expect(/push/i.test(days[0].name), `day[0].name dovrebbe contenere 'Push', ricevuto '${days[0] && days[0].name}'`);
expect(days[0].exercises.length > 0, "day[0] deve avere esercizi");
expect(days[0].focus.length > 0, "day[0] deve avere focus");
// la riga "# Reducibile a 4 giorni ... Giorno 5" NON deve creare un 6° giorno
expect(days.length === 5, "una riga con 'Giorno 5' nel testo non deve creare un giorno extra");
// legacy fallback
const legacy = window.parseScheda("# Upper A\nEsercizio | Serie | Rip | Recupero | Note\nPanca | 3 | 8-10 | 90 | Muscoli: petto\n---\n# Lower\nEsercizio | Serie | Rip | Recupero | Note\nSquat | 3 | 8-10 | 120 | Muscoli: quadricipiti");
expect(legacy.days.length === 2, `legacy days.length atteso 2, ricevuto ${legacy.days.length}`);
expect(legacy.days[0].key === "Upper A", `legacy key atteso 'Upper A', ricevuto '${legacy.days[0] && legacy.days[0].key}'`);

console.log(ok ? "OK — tutti i check del parser passano" : "ERRORI nel parser (vedi sopra)");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Eseguire il test per verificarlo fallire**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node scratchpad/test-parser.mjs`
Expected: FAIL (il vecchio `parseScheda` restituisce `{ "Upper A": … }`, non `{ days }` → `days` è `undefined`).

- [ ] **Step 3: Riscrivere `window.parseScheda` + aggiungere helper**

In `parser.jsx`, sostituisci l'intera funzione `window.parseScheda = function (text) { … };` (da riga 34 a riga 143) con:

```js
window.parseScheda = function (text) {
  if (!text) return { days: [] };
  const lines = text.split("\n");
  const days = [];       // lista ordinata
  let cur = null;        // giorno corrente
  let inTable = false;

  // Un header di giorno finisce con "- Giorno N" (evita falsi positivi come
  // "# Reducibile a 4 giorni: salta il Giorno 5 …" che contiene "Giorno 5" a metà frase).
  const DAY_RE = /-\s*giorno\s+(\d+)\s*$/i;
  // Se il file non ha nessun "- Giorno N", si usa il riconoscimento legacy Upper/Lower.
  const hasNumbered = lines.some(l => DAY_RE.test(l.trim().replace(/^#\s*/, "")));

  const startDay = (num, name, key) => {
    cur = { num, key, name, focus: [], exercises: [], altMap: {} };
    days.push(cur);
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line === "---") { cur = null; inTable = false; continue; }

    if (line.startsWith("# ")) {
      const body = line.slice(2).trim();

      if (hasNumbered) {
        const m = body.match(DAY_RE);
        if (m) {
          const num = parseInt(m[1], 10);
          const name = body.replace(DAY_RE, "").replace(/[-–·|]+\s*$/, "").trim() || ("Giorno " + num);
          startDay(num, "Giorno " + num, name);
          continue;
        }
      } else {
        const up = body.toUpperCase();
        if (up.includes("UPPER A")) { startDay(days.length + 1, "Upper A", "Upper A"); continue; }
        if (up.includes("UPPER B")) { startDay(days.length + 1, "Upper B", "Upper B"); continue; }
        if (up.includes("LOWER"))   { startDay(days.length + 1, "Lower",   "Lower");   continue; }
      }

      // Riga Focus del giorno corrente
      const fm = body.match(/^focus:\s*(.+)$/i);
      if (fm && cur) { cur.focus = fm[1].split(/[·,|]/).map(s => s.trim()).filter(Boolean); continue; }

      // Commento alternative: "# Panca → Push-up / Dip"
      if (body.includes("→") && cur) {
        const [exPart, altPart] = body.split("→").map(s => s.trim());
        if (exPart && altPart) {
          cur.altMap[exPart.toLowerCase()] = altPart.split("/").map(s => s.trim()).filter(Boolean);
        }
        continue;
      }
      continue; // altri commenti "# …" ignorati
    }

    if (!cur) continue;

    if (line.startsWith("Esercizio |")) { inTable = true; continue; }

    if (inTable && line.includes("|")) {
      const parts = line.split("|").map(s => s.trim());
      if (parts.length < 4) continue;
      const [name, setsStr, ripStr, restStr, notes = ""] = parts;
      if (!name || name.toLowerCase().includes("esercizio")) continue;

      const setsCount = parseInt(setsStr) || 3;
      const rest = parseInt(restStr) || 90;
      const muscles = _detectMuscles(notes);
      const ripMatch = ripStr.match(/(\d+)[-–](\d+)/);
      const ripVal = ripMatch ? parseInt(ripMatch[1]) : (parseInt(ripStr) || 10);
      const ripRange = ripStr;
      const sets = Array.from({ length: setsCount }, (_, si) => ({
        peso: 0, rip: ripVal, rpe: Math.min(10, 7 + si),
      }));

      cur.exercises.push({ name, muscles, sets, rest, notes, ripRange, history: [], alternatives: [] });
    }
  }

  // Aggancia le alternative per giorno
  days.forEach(d => {
    d.exercises.forEach(ex => {
      const k = Object.keys(d.altMap).find(key =>
        ex.name.toLowerCase().includes(key) || key.includes(ex.name.toLowerCase().slice(0, 8)));
      if (k) ex.alternatives = d.altMap[k];
    });
  });

  return { days };
};

// Muscoli unici aggregati dagli esercizi (fallback quando manca il Focus del giorno).
function _musclesFromExercises(exercises) {
  const seen = [];
  (exercises || []).forEach(ex => (ex.muscles || []).forEach(m => {
    const c = m.charAt(0).toUpperCase() + m.slice(1);
    if (!seen.includes(c)) seen.push(c);
  }));
  return seen.slice(0, 6);
}

// Schedule corrente dal file salvato (unica fonte di verità per tutti i consumer).
window.getSchedule = function () {
  const st = window.storage;
  const text = st ? st.get("schedaData", null) : null;
  if (!text) return { days: [] };
  try { return window.parseScheda(text); } catch (_) { return { days: [] }; }
};

// Sessione selezionata manualmente (o null se oggi è riposo / nessun giorno).
window.getSelectedSession = function () {
  const st = window.storage;
  const todayK = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  if (st && st.get("restDay_" + todayK, false)) return null;
  const days = (window.getSchedule().days) || [];
  if (!days.length) return null;
  const selKey = st ? st.get("schedaSelectedDay", null) : null;
  return days.find(d => d.key === selKey) || days[0];
};
```

- [ ] **Step 4: Eseguire il test per verificarlo passare + Babel**

Run:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App
node -e "require('@babel/core').transformFileSync('parser.jsx', {presets:['@babel/preset-react']}); console.log('Babel OK')"
node scratchpad/test-parser.mjs
```
Expected: `Babel OK` e `OK — tutti i check del parser passano`.

- [ ] **Step 5: Segnare completato** (niente git commit — regola progetto). Passare al Task 2.

---

### Task 2: Schermo Scheda — giorni dinamici, tab `G1…GN`, selezione persistita

**Files:**
- Modify: `screens/scheda.jsx` — `_DEFAULT_SCHEDULE`→`_DEFAULT_DAYS` (righe 4-40), `_buildSchedule` (42-72), stato/tab/heading/switchTo (≈542-597, 748-761), `savePeso.sessione` (≈690)

**Interfaces:**
- Consumes: `window.getSchedule()`, `_DEFAULT_DAYS` (fallback locale). Day = `{num,key,name,focus,exercises,altMap}`.
- Produces: scrive `schedaSelectedDay` in storage a ogni `switchTo`.

- [ ] **Step 1: Convertire il default in formato `days` array**

In `screens/scheda.jsx`, rinomina il blocco `const _DEFAULT_SCHEDULE = { "Upper A":[…], "Lower":[…], "Upper B":[…] };` avvolgendo i tre array esistenti in una lista `days` (mantieni identici gli array di esercizi già presenti):

```js
const _DEFAULT_DAYS = [
  { num: 1, key: "Upper A", name: "Upper A", focus: ["Petto", "Schiena", "Bicipiti"], altMap: {}, exercises: [ /* … array "Upper A" esistente … */ ] },
  { num: 2, key: "Lower",   name: "Lower",   focus: ["Gambe", "Glutei", "Core"],      altMap: {}, exercises: [ /* … array "Lower" esistente … */ ] },
  { num: 3, key: "Upper B", name: "Upper B", focus: ["Schiena", "Spalle", "Tricipiti"],altMap: {}, exercises: [ /* … array "Upper B" esistente … */ ] },
];
```

- [ ] **Step 2: Riscrivere `_buildSchedule` per restituire la lista giorni**

Sostituisci l'intera funzione `_buildSchedule` (righe 42-72) con:

```js
// Costruisce la lista ordinata di giorni dal file (o fallback ai default).
function _buildSchedule() {
  const sched = window.getSchedule ? window.getSchedule() : { days: [] };
  const days = (sched && sched.days) || [];
  if (!days.length) return _DEFAULT_DAYS;
  return days.map(d => ({
    ...d,
    exercises: (d.exercises || []).map(ex => ({
      ...ex,
      alternatives: (ex.alternatives && ex.alternatives.length) ? ex.alternatives : (ex.alternatives || []),
      history: ex.history || [],
    })),
  }));
}
```

- [ ] **Step 3: Adeguare stato, selezione corrente ed esercizi**

Nel componente Scheda, sostituisci `const [SCHEDULE] = React.useState(() => _buildSchedule());` (riga 542) con:

```js
const [days] = React.useState(() => _buildSchedule());
const current = days.find(d => d.key === scheda) || days[0] || { key: "", num: 0, name: "", focus: [], exercises: [] };
```

Poi sostituisci gli usi di `SCHEDULE`:
- riga ~563 in `switchTo`: `const exs = (days.find(d => d.key === k) || {}).exercises || [];`
- riga ~597: `const exercises = current.exercises || [];`

- [ ] **Step 4: `switchTo` persiste il giorno selezionato**

In `switchTo(k)` (≈561-572) aggiungi, dopo `setScheda(k);`:

```js
    if (window.storage) window.storage.set("schedaSelectedDay", k);
```

- [ ] **Step 5: Auto-selezione on mount (rimpiazza il vecchio getTodaySession)**

Sostituisci l'effetto "Auto-detect today's session" (righe 589-595) con:

```js
  // On mount: apri il giorno persistito (o il primo). Persiste la scelta.
  React.useEffect(() => {
    const saved = window.storage ? window.storage.get("schedaSelectedDay", null) : null;
    const target = (days.find(d => d.key === saved) || days[0]);
    if (target && target.key !== scheda) switchTo(target.key);
    else if (target && window.storage) window.storage.set("schedaSelectedDay", target.key);
  }, []);
```

- [ ] **Step 6: Tab numerate + intestazione giorno**

Sostituisci il blocco `{/* Tab pills */}` (righe 748-761) con:

```jsx
      {/* Tab pills — giorni numerati G1…GN */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: "100%", overflowX: "auto" }}>
        <div className="tab-pills">
          {days.map(d => (
            <button
              key={d.key}
              className={d.key === scheda ? "on" : ""}
              onClick={() => switchTo(d.key)}
            >
              {"G" + d.num}
            </button>
          ))}
        </div>
      </div>

      {/* Intestazione giorno: Giorno N · Nome + focus */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, padding: "0 2px" }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t("Giorno")} {current.num} · {current.name}</span>
        {(current.focus || []).map(f => <UIChip key={f}>{f}</UIChip>)}
      </div>
```

(Verifica che `UIChip` sia disponibile come globale — è definito in `ui.jsx`, caricato prima degli screens.)

- [ ] **Step 7: Etichetta sessione leggibile su Sheets**

Alla riga ≈690, cambia `sessione: scheda,` in `sessione: current.name || scheda,`.

- [ ] **Step 8: Validazione Babel + aggiungere chiave i18n "Giorno"**

In `i18n.jsx` aggiungi in entrambi i dizionari (se assente): IT `"Giorno": "Giorno"`, EN `"Giorno": "Day"`.

Run:
```bash
node -e "require('@babel/core').transformFileSync('screens/scheda.jsx', {presets:['@babel/preset-react']}); console.log('scheda OK')"
node -e "require('@babel/core').transformFileSync('i18n.jsx', {presets:['@babel/preset-react']}); console.log('i18n OK')"
```
Expected: `scheda OK`, `i18n OK`.

---

### Task 3: `api.jsx` — `getTodaySession` data-driven

**Files:**
- Modify: `api.jsx:139-145`

**Interfaces:**
- Consumes: `window.getSelectedSession()`, `_musclesFromExercises` (parser).
- Produces: `getTodaySession() -> { id, key, label, name, focus, muscles, muscleKeys } | null`. Campi `label` e `muscles` mantenuti (usati da Coach e Dashboard).

- [ ] **Step 1: Riscrivere `getTodaySession`**

Sostituisci righe 139-145 con:

```js
window.getTodaySession = function () {
  const day = window.getSelectedSession ? window.getSelectedSession() : null;
  if (!day) return null; // riposo o nessun giorno
  const muscles = (day.focus && day.focus.length)
    ? day.focus
    : (window._musclesFromExercises ? window._musclesFromExercises(day.exercises) : []);
  return {
    id: day.key,
    key: day.key,
    label: (day.name || day.key || "").toUpperCase(),
    name: day.name || day.key,
    focus: day.focus || [],
    muscles: muscles,
    muscleKeys: muscles.map(m => String(m).toLowerCase()),
  };
};
```

- [ ] **Step 2: Esporre `_musclesFromExercises` come globale**

In `parser.jsx`, dopo la definizione di `_musclesFromExercises`, aggiungi:
```js
window._musclesFromExercises = _musclesFromExercises;
```

- [ ] **Step 3: Validazione Babel**

Run:
```bash
node -e "require('@babel/core').transformFileSync('api.jsx', {presets:['@babel/preset-react']}); console.log('api OK')"
node -e "require('@babel/core').transformFileSync('parser.jsx', {presets:['@babel/preset-react']}); console.log('parser OK')"
```
Expected: `api OK`, `parser OK`.

---

### Task 4: Dashboard — hero su sessione selezionata, toggle "Oggi riposo", target dinamico

**Files:**
- Modify: `screens/dashboard.jsx` (≈287, 332, hero 361-381, week 446); `i18n.jsx`

**Interfaces:**
- Consumes: `window.getTodaySession()`, `window.getSchedule()`.
- Produces: scrive `restDay_<data>` in storage.

- [ ] **Step 1: Stato toggle riposo + sessione gated**

Sotto la riga `const today = window.todayKey ? … ;` (≈288) aggiungi:

```js
  const [restDay, setRestDay] = React.useState(() => window.storage ? window.storage.get("restDay_" + today, false) : false);
  const toggleRest = () => {
    const next = !restDay;
    if (window.storage) window.storage.set("restDay_" + today, next);
    setRestDay(next);
  };
  const daysCount = (window.getSchedule ? (window.getSchedule().days || []).length : 0) || 3;
```

Poi cambia la riga 287 da:
```js
  const todaySession = window.getTodaySession ? window.getTodaySession() : null;
```
a:
```js
  const _rawSession = window.getTodaySession ? window.getTodaySession() : null;
  const todaySession = restDay ? null : _rawSession;
```
(Nota: `restDay` è definito dopo la riga 287; sposta le tre const del toggle **sopra** questa riga, subito dopo `const today = …`.)

- [ ] **Step 2: `nextMeal` reagisce al toggle riposo**

Alla riga 332 cambia `const nextMeal = React.useMemo(() => _nextMealHome(), [today]);` in:
```js
  const nextMeal = React.useMemo(() => _nextMealHome(), [today, restDay]);
```

- [ ] **Step 3: Hero con toggle riposo**

Sostituisci il blocco `{/* Hero "Oggi" */}` (righe 361-381) con:

```jsx
      {/* Hero "Oggi" */}
      <UICard hero>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="ui-cap">{t("Oggi")}</div>
          <button
            onClick={toggleRest}
            style={{ background: restDay ? "var(--accent)" : "transparent", color: restDay ? "#fff" : "var(--text-2)", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 32 }}
          >
            {t("Oggi riposo")}
          </button>
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, margin: "3px 0 12px" }}>
          {todaySession ? todaySession.label : t("Giorno di riposo")}
        </div>
        {todaySession ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {todaySession.muscles.map(m => <UIChip key={m}>{t(m)}</UIChip>)}
            </div>
            <UIButton onClick={startWorkout}>
              <Icon name="dumbbell" size={17} strokeWidth={1.9} /> {t("Inizia allenamento")}
            </UIButton>
          </>
        ) : (
          <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.45 }}>
            {t("Recupero attivo, mobilità e idratazione.")}
          </div>
        )}
      </UICard>
```

- [ ] **Step 4: Target settimana dinamico**

Alla riga ≈446 cambia `{weekGymDays}</span> / 3 {t("sessioni")}` in:
```jsx
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{weekGymDays}</span> / {daysCount} {t("sessioni")}
```

- [ ] **Step 5: i18n + Babel**

In `i18n.jsx` aggiungi in IT+EN: IT `"Oggi riposo": "Oggi riposo"`, EN `"Oggi riposo": "Rest today"`. (Verifica che `"Giorno di riposo"`, `"Recupero attivo, mobilità e idratazione."`, `"Inizia allenamento"`, `"sessioni"`, `"Oggi"` esistano già — sono usati oggi.)

Run:
```bash
node -e "require('@babel/core').transformFileSync('screens/dashboard.jsx', {presets:['@babel/preset-react']}); console.log('dashboard OK')"
node -e "require('@babel/core').transformFileSync('i18n.jsx', {presets:['@babel/preset-react']}); console.log('i18n OK')"
```
Expected: `dashboard OK`, `i18n OK`.

---

### Task 5: Coach — prompt generato dai giorni reali

**Files:**
- Modify: `screens/coach.jsx:40, 43, 79`

**Interfaces:**
- Consumes: `window.getSchedule()`, `window.getTodaySession()`.

- [ ] **Step 1: Riepilogo giorni dinamico nel prompt**

In `_buildSystemPrompt`, subito dopo `const sessLabel = …` (riga 16) aggiungi:
```js
  const _days = window.getSchedule ? (window.getSchedule().days || []) : [];
  const _dayCount = _days.length || 3;
  const _dayNames = _days.map(d => d.name).filter(Boolean).join(", ");
```

Poi sostituisci la riga 40:
```js
Mesociclo: Settimana ${weekNum || 1} / 8 · Upper/Lower 3×/settimana.
```
con:
```js
Mesociclo: Settimana ${weekNum || 1} / 8 · ${_dayCount} sessioni/settimana.
```

E sostituisci la riga 43:
```js
Piano: Upper A (Lun), Lower (Mer), Upper B (Ven). Cardio: camminata + ellittica nei giorni di riposo.
```
con:
```js
Piano (${_dayCount} giorni, selezione manuale): ${_dayNames || "n/d"}. Cardio: camminata + ellittica nei giorni di riposo.
```

- [ ] **Step 2: Fallback generico quando manca il file**

Sostituisci la riga 79:
```js
    prompt += `\n\nScheda: Upper/Lower split 3×/settimana. Esercizi principali: squat, panca, stacco, OHP, trazioni, rematore.`;
```
con:
```js
    prompt += `\n\nScheda: nessun file caricato. Chiedi a Lorenzo di importare la sua scheda .txt dalle Impostazioni.`;
```

- [ ] **Step 3: Validazione Babel**

Run: `node -e "require('@babel/core').transformFileSync('screens/coach.jsx', {presets:['@babel/preset-react']}); console.log('coach OK')"`
Expected: `coach OK`.

---

### Task 6: Validazione import scheda

**Files:**
- Modify: `screens/impostazioni.jsx:140-150` (`_validateSchedaText`)

**Interfaces:**
- Consumes: `window.parseScheda(text) -> { days }`.

- [ ] **Step 1: Aggiornare `_validateSchedaText` al nuovo formato**

Sostituisci la funzione `_validateSchedaText` (righe 140-150) con:

```js
function _validateSchedaText(text, t) {
  try {
    if (!window.parseScheda) return { ok: true, detail: "" };
    const p = window.parseScheda(text);
    const days = (p && p.days) || [];
    if (!days.length) return { ok: false };
    const nEx = days.reduce((n, d) => n + ((d.exercises && d.exercises.length) || 0), 0);
    return { ok: true, detail: `${days.length} ${t("giorni")} · ${nEx} ${t("esercizi")}` };
  } catch (_) { return { ok: false }; }
}
```

- [ ] **Step 2: Validazione Babel + test import end-to-end**

Run:
```bash
node -e "require('@babel/core').transformFileSync('screens/impostazioni.jsx', {presets:['@babel/preset-react']}); console.log('impostazioni OK')"
```
Aggiungi in fondo a `scratchpad/test-parser.mjs` (o script separato) un check che simula la validazione:
```js
const v = window.parseScheda(fs.readFileSync("scheda.txt","utf8"));
console.log("validazione import:", (v.days && v.days.length >= 1) ? "OK (" + v.days.length + " giorni)" : "FALLITA");
```
Expected: `impostazioni OK` e `validazione import: OK (5 giorni)`.

---

### Task 7: Validazione integrata + checklist QA on-device

**Files:** nessuna modifica (solo verifica)

- [ ] **Step 1: Sweep Babel su tutti i file toccati**

Run:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App
for f in parser.jsx api.jsx i18n.jsx screens/scheda.jsx screens/dashboard.jsx screens/coach.jsx screens/impostazioni.jsx; do
  node -e "require('@babel/core').transformFileSync('$f', {presets:['@babel/preset-react']}); console.log('OK $f')" || echo "FAIL $f";
done
```
Expected: `OK` per tutti e 7 i file.

- [ ] **Step 2: Test parser sul file reale**

Run: `node scratchpad/test-parser.mjs`
Expected: `OK — tutti i check del parser passano`.

- [ ] **Step 3: Cross-check i18n e icone**

Verifica che le chiavi nuove (`"Giorno"`, `"Oggi riposo"`) esistano in IT **e** EN in `i18n.jsx`, e che nessun `<Icon name>` nuovo sia stato introdotto senza esistere in `icons.jsx`.

- [ ] **Step 4: Consegna a Lorenzo per QA on-device (Chrome MCP non collegato in sessione)**

Checklist da verificare da Lorenzo dopo il deploy (deploy + SW sticky: chiudere e riaprire la PWA):
- Impostazioni → File di testo → Importa scheda (.txt): file selezionabile, messaggio "Importato · 5 giorni · N esercizi".
- Scheda: 5 tab `G1…G5`, intestazione `Giorno N · Nome` + chip focus; cambio tab non fa "bleed" di pesi/spunte tra giorni.
- Pesi da Sheets caricati per esercizio; chiusura sessione salva su Sheets.
- Dashboard: hero mostra la sessione selezionata; toggle "Oggi riposo" → stato riposo + "Prossimo pasto" passa alla variante riposo; target settimana `/5`.
- Coach: risponde citando i giorni reali (Push/Pull/Legs…) e la sessione selezionata / riposo.
- Riavvio app: il giorno selezionato è ricordato.

---

## Self-review (fatto in fase di stesura)

- **Copertura spec:** parser nuovo contratto (T1) ✓, Scheda dinamica+tab+selezione (T2) ✓, getTodaySession data-driven (T3) ✓, Dashboard hero+toggle riposo+target dinamico (T4) ✓, Coach (T5) ✓, validazione import (T6) ✓, retro-compat legacy (T1 hasNumbered+test) ✓, chiavi storage nuove documentate (Global Constraints) ✓.
- **Placeholder:** i `/* … array esistente … */` in T2/Step1 si riferiscono agli array `_DEFAULT_SCHEDULE` già presenti nel file (da riusare tal quali), non a codice mancante.
- **Consistenza tipi:** `days:[{num,key,name,focus,exercises,altMap}]` usato coerentemente in parser/scheda/api/dashboard/coach/impostazioni; `getTodaySession` mantiene `label`+`muscles` richiesti da coach.jsx:16 e dashboard.jsx:365/370.
