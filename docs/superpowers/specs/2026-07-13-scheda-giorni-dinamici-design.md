# Design — Scheda a giorni dinamici (Push/Pull/Legs e oltre)

Data: 2026-07-13
Autore: Lorenzo Faraoni (+ Claude)
Stato: approvato, pronto per il piano di implementazione

## Problema

L'app è cablata su uno split **Upper/Lower a 3 giorni fissi** (`Upper A` / `Lower` / `Upper B`).
`parseScheda` riconosce solo header contenenti quei nomi; `_buildSchedule`,
`getTodaySession`, il prompt del Coach e alcuni conteggi in Dashboard assumono 3 giorni.

Lorenzo ha aggiornato `scheda.txt` con un programma **Push/Pull/Legs a 5 giorni**
(`# PUSH - Giorno 1`, `# PULL - Giorno 2`, `# LEGS ... - Giorno 3`,
`# PUSH 2 - Giorno 4`, `# PULL 2 + ADDOME - Giorno 5`; riducibile a 4).
Nessun header contiene Upper/Lower → `parseScheda` restituisce tutto `null` →
la validazione dell'import scarta il file ("Formato non valido") e la scheda in app non si aggiorna.

## Obiettivo

Rendere Scheda / Dashboard / Coach capaci di gestire **N giorni con nomi arbitrari**,
dove **N è dinamico** e desunto dal file (può cambiare nel tempo: 3, 4, 5…).
Nessun conteggio hardcoded: tutto deriva da `days.length`.

## Decisioni di design (dal brainstorming)

1. **Sessione di "oggi" = selezione manuale.** Niente mappa giorno-della-settimana.
   Il giorno selezionato è la fonte di verità, persistito e letto da Dashboard/Coach.
2. **Etichette tab = numerate `G1 … GN`.** Nome descrittivo (Push/Pull/Legs) + Focus
   mostrati come intestazione dentro la sessione.
3. **Toggle "Oggi riposo"** in Dashboard, per i giorni di cardio.
4. **Fonte di verità unica nel parser** (non patch sparse per ogni consumer).

## Architettura

### 1. `parser.jsx` — nuovo contratto di `parseScheda`

`parseScheda(text)` restituisce un oggetto con lista **ordinata** di giorni:

```js
{ days: [
    { key: "Giorno 1", name: "Push", focus: ["Petto","Spalle","Tricipiti"],
      exercises: [ /* come oggi */ ], altMap: { /* come oggi */ } },
    ...
] }
```

Regole di parsing:
- Un nuovo giorno inizia **solo** su un header che termina con `- Giorno N`
  (regex `/-\s*Giorno\s+(\d+)\s*$/i`). Questo evita il falso positivo della riga
  `# Reducibile a 4 giorni: salta il Giorno 5 …` (contiene "Giorno 5" ma non è un header).
- `key = "Giorno " + N` (stabile, usato come chiave interna/tab/persistenza).
- `name` = testo dell'header prima di `- Giorno N` (ripulito): `Push`, `Pull`,
  `Legs (mantenimento) + Upper Extra`, `Push 2`, `Pull 2 + Addome`.
- `focus` = dalla riga `# Focus:` del giorno, split su `·` → array di label.
- Righe `# Riscaldamento`, `# Stretching`, `# PETTO:`, ecc. → ignorate (come oggi).
- Commenti alternative `# X → Y / Z` → invariati (popolano `altMap` del giorno corrente).
- Separatore `---` → chiude il giorno corrente (come oggi).
- **Precedenza detection**: se il file NON contiene alcun `- Giorno N`, ricadi sul
  riconoscimento legacy `UPPER A` / `LOWER` / `UPPER B` (retro-compatibilità con file vecchi),
  producendo comunque `days: [...]` con quei nomi come `key` e `name`.

Helper condivisi (nuovi, in `parser.jsx`), unica fonte di verità:
- `window.getSchedule()` → legge `schedaData` da storage, chiama `parseScheda`, e
  restituisce `days: [...]`; se assente/non valido → schedule di default (fallback attuale).
- `window.getSelectedSession()` → legge la chiave `schedaSelectedDay` + `getSchedule()`,
  restituisce il giorno selezionato (default: primo giorno). Restituisce `null` se
  il toggle riposo di oggi è attivo (`restDay_<oggi>`).

### 2. `screens/scheda.jsx`

- `_buildSchedule()` usa `getSchedule().days` invece dei 3 nomi fissi → produce una mappa
  `{ key → exercises }` ordinata (quanti giorni ci sono nel file).
- **Tab** (`tab-pills`): renderizzano `G1 … GN` (numerate) con scroll orizzontale se
  eccedono la larghezza. `switchTo(key)` invariato nella meccanica per-posizione
  (`completion/substitutions/occupied/pesos` sostituiti insieme — vedi bug "bleed tra giorni").
- Dentro la sessione: intestazione `Giorno N · <name>` + chip del `focus`.
- Persistenza progressi `schedaProg_<data>`: invariata (chiave = `key` del giorno, es. `"Giorno 1"`).
- Pesi da Sheets (`getUltimiPesi`, `savePeso`): **invariati** — richiamati per nome esercizio,
  indipendenti dal giorno. `savePeso.sessione` = `name` del giorno (etichetta leggibile).
- Al cambio tab / apertura sessione: aggiorna `schedaSelectedDay` in storage.
- L'auto-detect on mount (oggi basato su `getTodaySession`) diventa: apri il giorno
  `schedaSelectedDay` (o il primo se assente).

### 3. `api.jsx` — `getTodaySession`

Riscritta data-driven (delega a `getSelectedSession`):
```
window.getTodaySession = () =>
  restDay attivo oggi ? null
  : { key, label, name, focus, muscles }  della sessione selezionata
```
- `muscles` / `muscleKeys`: derivati dal `focus` del giorno; fallback ai muscoli rilevati
  dagli esercizi (`_detectMuscles`) se `focus` assente.
- Restituisce `null` quando `restDay_<oggi>` è attivo (giorno di riposo) → riusa la
  gestione null già presente in Dashboard/Coach.

### 4. `screens/dashboard.jsx`

- **Hero "Oggi"**: mostra la sessione selezionata (nome + chip focus) con CTA
  "Inizia allenamento" → apre quel giorno in Scheda. Se `restDay` attivo → stato riposo
  (cardio: camminata + ellittica), niente CTA allenamento.
- **Toggle "Oggi riposo"**: persistito come `restDay_<data>` (locale, per giorno, spazzato
  dopo 90 giorni da `_cleanupOldDailyKeys`). On → hero riposo + variante pasto "riposo" +
  Coach informato.
- **Variante pasto** (`ore17` vs `riposo`): riposo se `restDay` attivo, altrimenti allenamento.
- **Riepilogo settimana**: il target `/3` diventa `/ days.length` (dinamico).

### 5. `screens/coach.jsx`

- `_buildSystemPrompt`: sostituisce le righe hardcoded
  ("Upper/Lower 3×/settimana · Upper A (Lun), Lower (Mer), Upper B (Ven)…")
  con un riassunto generato dai giorni reali: numero giorni, nomi (Push/Pull/Legs…),
  e la sessione selezionata di oggi (o "riposo" se il toggle è attivo).
- Il fallback hardcoded testuale sullo split viene reso generico o rimosso.

### 6. `screens/impostazioni.jsx` — validazione import

- `_validateSchedaText`: valida il nuovo formato → `ok` se `getSchedule`/`parseScheda`
  produce `days.length ≥ 1`; feedback con conteggio `giorni · esercizi`.
- `_validateDietaText`: **invariato** (la dieta non cambia struttura).

## Chiavi di storage (riassunto)

- `schedaSelectedDay` (nuova) — `key` del giorno attualmente selezionato. Locale.
- `restDay_<data>` (nuova) — boolean toggle riposo del giorno. Locale, per-giorno, spazzata a 90gg.
- `schedaProg_<data>` — invariata (progressi per giorno+data).
- `schedaData` / `dietaData` — invariate (testo importato).

## Cosa NON cambia

- Persistenza pesi per nome esercizio (Sheets).
- Meccanica per-posizione e `switchTo` (solo chiavi dinamiche).
- Cloud sync delle chiavi esistenti; timer; mesociclo 8 settimane; tema; i18n food.
- Dieta e relativo parser/validatore.

## Rischi / note

- **Bug family "bleed tra giorni"**: qualsiasi nuovo stato per-posizione va aggiunto a
  `switchTo` E al blocco persistito. Le chiavi restano indicizzate per posizione.
- Etichette lunghe (Giorno 3/5): mitigato da tab numerate `GN` + scroll orizzontale.
- Retro-compatibilità legacy Upper/Lower mantenuta come fallback di parsing.
- Deploy solo da Lorenzo; SW sticky iOS dopo il deploy.

## Validazione (no test runner)

- `node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"`
  su ogni `.jsx` toccato.
- Script Node che esegue `parseScheda` sul reale `scheda.txt` e verifica
  `days.length === 5` con nomi/esercizi attesi (come già usato in diagnosi).
- Cross-check: nuove chiavi `t(...)` presenti in IT+EN; `<Icon>` esistenti.
- QA visiva on-device: la fa Lorenzo (Chrome MCP non collegato in sessione).
