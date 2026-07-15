# Redesign Scheda + Player + refactor keyed-by-id — design

**Data:** 15 luglio 2026 · **Approvato da:** Lorenzo (scope, id-strategy, design A–D)
**Contesto:** filone 1 dei due aperti dopo Fase 2·Home (vedi `docs/superpowers/specs/2026-07-11-redesign-app-design.md`, sez. "Scheda + Player"). Aggiorna quello spec rimuovendo RPE/mesociclo (rimossi dall'app il 14/07).

## Scope (confermato)

**IN questo giro:** (A) Player a schermo intero, (B) refactor stato per-posizione → keyed-by-id, (C) estrazione dati hardcoded, (D) test + regressione bleed.

**FUORI scope (giro a sé):** Editor piani strutturato (GUI su scheda/dieta con serializzatori round-trip in `parser.jsx`) — è lo step 3 separato nella roadmap dello spec 07-11. RPE e mesociclo: già rimossi, non ricompaiono.

## Vincoli di progetto (non violare)

- No build step: React 18 via CDN + Babel standalone; ogni componente esposto come global `window.Nome = Nome;`, niente `import`/`export`.
- Persistenza `window.storage` (IndexedDB), mai `localStorage`.
- Nessun `<form>`; nuovi file `.jsx` vanno aggiunti alla lista ordinata in `index.html` con `?v=BUILD` (load order conta).
- `npm test` dopo ogni edit.

---

## A · Player a schermo intero

Vista interna a `scheda.jsx` — **niente nuova route**. Nuovo stato locale nel componente `Scheda`:

- `mode: "list" | "player"` (default `"list"`).
- `cursor`: posizione dell'esercizio corrente nel giorno attivo (`0..n-1`). La serie corrente = prima serie non completata di quell'esercizio (o l'ultima se tutte fatte).

**Ingresso al player:**

- Da Home: la CTA "Inizia allenamento" già imposta `window._schedaIntent = "player"` (dashboard.jsx:305). Al mount, `Scheda` legge e consuma l'intent (`if (window._schedaIntent === "player") { setMode("player"); window._schedaIntent = null; }`) e apre il player sul giorno corrente.
- Da Scheda: nuovo bottone "Inizia allenamento" in cima alla lista → `setMode("player")`.

**Contenuto del player (un esercizio alla volta, overlay full-screen sullo stile `TimerOverlay`):**

- eyebrow `"Serie n di m"` (n = serie corrente, m = totale serie esercizio);
- nome esercizio (sostituto se presente, con originale barrato sotto);
- **peso gigante** della serie corrente, **editabile inline** (stesso valore/flusso `pesos` dell'ExerciseCard, scritto nel ref keyed-by-id);
- `× rip` e range rip;
- riga **"L'ultima volta: … kg × …"** — fonte in ordine: `sheetsWeights[nome][setIdx]` se presente, altrimenti il peso di default della scheda. **Nessuna chiamata backend extra**, nessun RPE;
- bottone unico **"Serie fatta"** → marca la serie completata **e avvia automaticamente il timer di recupero** (riusa `TimerOverlay` con `ex.rest`); al termine del timer (o alla chiusura) → avanza: prossima serie dello stesso esercizio, oppure primo esercizio successivo con serie da fare;
- toggle "auto-timer" (on di default): se off, "Serie fatta" avanza senza aprire il timer;
- peek **"Dopo: ‹prossimo esercizio›"** in basso;
- **✕** → torna a `mode: "list"` (stato interamente preservato — è lo stesso stato);
- **⋯** → riusa `SubstitutePopover` (sostituzione) e l'area note esistente.

**Fine sessione:** dopo l'ultimo esercizio, schermata "Sessione completa" con CTA **Chiudi sessione** → chiama lo stesso `handleSaveSession` esistente (`gym_<date>` + `muscleSets_<date>` + `saveSessione` + `savePeso` per serie completata). Confetti riusati.

**Riuso obbligatorio (non reimplementare):** `TimerOverlay` (timestamp-based `endRef` + Wake Lock), `SubstitutePopover`, `HistoryPopover`, `Confetti`, `handleSaveSession`.

La **lista attuale resta** come vista alternativa; player e lista sono due proiezioni dello **stesso** stato condiviso.

---

## B · Refactor stato per-posizione → keyed-by-id `${dayKey}#${pos}`

### Problema attuale

`completion`, `substitutions`, `occupied`, `pesosRef` sono indicizzati per **posizione** nell'array del giorno corrente. `switchTo(tab)` deve **sostituirli tutti insieme** caricando il blocco della tab di destinazione; ogni nuovo stato per-posizione dimenticato in `switchTo` causa il bleed (pesi/spunte che atterrano sull'esercizio sbagliato e finiscono su Sheets). È la "famiglia bug bleed tra giorni".

### Modello nuovo

- **id derivato** (non memorizzato nel testo, così il round-trip col futuro Editor resta possibile): `exId(dayKey, pos) = ` `` `${dayKey}#${pos}` `` (es. `"Upper A#0"`).
- Lo stato diventa **una mappa piatta keyed-by-id valida per TUTTI i giorni insieme**: `completion["Upper A#0"]`, `completion["Lower#0"]`, ecc.
- `switchTo(day)` **cambia solo `scheda` (il giorno mostrato)** + persiste `schedaSelectedDay`. **Non tocca più lo stato.** Render e salvataggio leggono lo stato via `exId(scheda, pos)`. Leggere lo stato di un giorno mentre se ne renderizza un altro è **strutturalmente impossibile** → il bleed sparisce per costruzione, non per disciplina.
- `occupied` resta effimero (non persistito, com'è oggi), ma anch'esso keyed-by-id.
- `pesosRef` resta un `React.useRef` (per il salvataggio Sheets), keyed-by-id anziché per-indice.

### Persistenza `schedaProg_<date>`

- **Prima:** `{ [tab]: { completion:{idx:[]}, substitutions:{idx}, pesos:{idx:[]} } }`.
- **Dopo:** blocco piatto `{ completion:{id:[]}, substitutions:{id}, pesos:{id:[]} }` (nessuna annidatura per-tab: l'id contiene già il giorno).
- `_loadProg()`/`_saveProg()` non prendono più `tab`; leggono/scrivono il blocco piatto.
- **Migrazione:** nessuna conversione del vecchio formato. È progresso di giornata effimero (spazzato a 90 gg da `_cleanupOldDailyKeys()`); una sessione *in corso il giorno del deploy* riparte pulita — accettabile, una tantum. Chiavi giornaliere e sweep invariati.

### `handleSaveSession`

Legge `completion`/`pesosRef`/`substitutions` via `exId(scheda, i)` invece che per indice; per il resto identico (stesse chiamate `saveSessione`/`savePeso`, stessa logica `muscleSets`).

---

## C · Estrazione dati hardcoded

### Problema

`_DEFAULT_DAYS` in `scheda.jsx` (~36 righe) è un **duplicato in forma strutturata** di `scheda.txt`. `coach.jsx` ha un fallback dieta hardcoded analogo (≤3000 char). Due formati per lo stesso contenuto → rischio di divergenza.

### Approccio: fallback = testo grezzo, parsato dallo stesso parser

- Nuovo file **`defaults.jsx`**, registrato in `index.html` **prima di `parser.jsx`** (con `?v=BUILD`): espone `window.SCHEDA_TXT_FALLBACK` e `window.DIETA_TXT_FALLBACK` = il contenuto grezzo di `scheda.txt` / `dieta.txt` come stringhe.
- `getSchedule()` (parser.jsx): quando `schedaData` manca in storage, ritorna `parseScheda(window.SCHEDA_TXT_FALLBACK)` invece di `{days:[]}`.
- `_buildSchedule()` (scheda.jsx): **elimina `_DEFAULT_DAYS`**; usa sempre `getSchedule()` (che ora ha il fallback interno).
- `coach.jsx`: il fallback dieta hardcoded usa `parseDieta(window.DIETA_TXT_FALLBACK)` (o il testo direttamente nel prompt), eliminando la stringa duplicata.
- Risultato: **un solo formato (testo)**, zero divergenza struttura↔testo, `scheda.jsx` più corto, fallback sempre allineato al `.txt`.

Nota: `app.jsx` continua a caricare `scheda.txt`/`dieta.txt` dal repo in storage al boot (versioning `_src`); il fallback embedded serve solo alla primissima apertura offline o a un fetch fallito. `defaults.jsx` va aggiunto alla precache di `sw.js`.

---

## D · Test & regressione bleed

- **Unit (`npm test`, `test/run.mjs`):**
  - `exId(day, pos)` produce id attesi;
  - simulazione mappa keyed-by-id: cambio giorno con progressi misti (Upper A parziale → Lower → Upper B → back-to-Upper A) → assert che nessuno stato migri sull'esercizio sbagliato e che i valori originali di Upper A siano intatti al rientro;
  - `parseScheda(SCHEDA_TXT_FALLBACK)` → `days.length ≥ 1` e ogni giorno ha esercizi (fallback valido); idem `parseDieta(DIETA_TXT_FALLBACK)`.
- **Smoke:** Babel su `defaults.jsx` + `scheda.jsx` modificato (già coperto dal giro smoke su ogni `.jsx`).
- **QA (emulazione/on-device):** flusso player completo (auto-timer, avanzamento serie→esercizio, ✕/⋯, editing peso, chiusura sessione → Sheets), toggle lista↔player, e il giro cambio-giorno con spunte miste (regressione bleed).

---

## Criteri di completamento

1. Player raggiungibile da Home e da Scheda; un esercizio alla volta; "Serie fatta" → auto-timer → avanzamento; chiusura sessione salva su Sheets come oggi.
2. Stato interamente keyed-by-id; `switchTo` non swappa più stato; test bleed verde.
3. `_DEFAULT_DAYS` eliminato; fallback via `defaults.jsx` parsato; app funzionante anche senza `schedaData` in storage.
4. `npm test` verde; QA player + bleed superata.
5. Nessun RPE/mesociclo nella UI o nel prompt coach.

## Rischi

- **Regressione bleed** durante il refactor → mitigata dal test unit dedicato prima dell'implementazione UI (TDD).
- **Perdita progressi in corso al deploy** (cambio formato `schedaProg_`) → una tantum, accettata.
- **Salvataggio Sheets** deve continuare a leggere pesi/serie corretti via id → coperto da QA chiusura sessione con dati reali.
