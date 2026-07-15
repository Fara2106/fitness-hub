# Spec — Hardening & manutenibilità (Approccio ①)

Data: 2026-07-15 · Autore: Lorenzo Faraoni (+ agente)

## Obiettivo

Migliorie software a **basso rischio** sull'app viva, senza cambiare la UI e senza
toccare la macchina a stati fragile della Scheda (rimandata al futuro redesign
Scheda+Player). Il valore principale è introdurre una **rete di test** dove oggi non
c'è nessun test runner, più pulizia di repo e codice morto.

Scope deciso via brainstorming (vedi conversazione 2026-07-15): Approccio ① —
"rete di sicurezza + pulizia". Esclusi esplicitamente: estrazione dei dati hardcoded
di scheda/dieta (Approccio ②) e qualunque refactor dello stato per-posizione della
Scheda.

## Contesto / vincoli del progetto

- Nessun build step: React 18 + Babel standalone via CDN. Ogni componente è un global
  `window.Nome`. Mai `import`/`export` ES nei file `.jsx` spediti.
- L'unico "compile check" disponibile è `@babel/core` + `@babel/preset-react`
  (già in `devDependencies`). Nessun test runner.
- Deploy su GitHub Pages con Jekyll in legacy mode; `_config.yml` esclude `docs/`,
  `node_modules/`, i `.command`. I file app (`index.html`, `launch.html`, `*.jsx`,
  `*.css`) non hanno front matter → copiati verbatim.
- Regola cache: qualunque modifica a file **spediti** (`.jsx/.css/.html/sw.js/icone`)
  richiede il bump di `CACHE_NAME` in `sw.js` + tutti i `?v=` in `index.html`, altrimenti
  il service worker serve codice stale. Modifiche a `docs/`/config non richiedono bump.

## Componenti

### 1. Igiene repo — cartella `dev/`

- `git mv design-canvas.jsx dev/design-canvas.jsx` e `git mv tweaks-panel.jsx dev/tweaks-panel.jsx`.
- Aggiungere `- dev/` all'`exclude:` di `_config.yml`.
- **Motivazione**: entrambi i file (~1500 righe totali) sono tooling di design **non
  referenziato** da nessun file caricato (`index.html`, `launch.html`, nessun `.jsx`).
  Verificato con grep: le uniche occorrenze del loro nome sono dentro se stessi.
- **Effetto runtime**: nullo (non erano mai caricati). Restano versionati, solo fuori
  dal sito pubblicato.

### 2. Test harness — cartella `test/`

Runner Node a zero dipendenze esterne, usa solo `@babel/core` (già installato) e i
moduli built-in `node:vm`, `node:fs`, `node:path`. Lanciabile con `npm test`.

- `test/run.mjs` — entry point. Esegue due suite, stampa `PASS`/`FAIL` per assert,
  esce con codice ≠ 0 se qualcosa fallisce.
- `test/fixtures/scheda-ppl.txt` — scheda Push/Pull/Legs di esempio (header
  `# PUSH - Giorno 1`, alcuni esercizi con serie/reps).
- `test/fixtures/dieta.txt` — dieta di esempio (sezioni + pasti + opzioni).

**Suite A — smoke "compila tutto"**: per ogni `.jsx` in root + `screens/` (e `dev/` se
presente), chiamare `require('@babel/core').transformFileSync(file, {presets:['@babel/preset-react']})`.
Se lancia → FAIL con nome file. Automatizza il check manuale documentato in CLAUDE.md.

**Suite B — unit del parser**: trasformare `parser.jsx` con preset-react, eseguire il
codice in una sandbox `node:vm` con un contesto che espone uno **shim minimale di
`window`** (oggetto vuoto su cui il file appende `parseScheda`, `parseDieta`, ecc.).
Le funzioni testate sono **pure** (prendono testo, ritornano oggetti) e non toccano
`storage`/`fetch`. Asserzioni:

- `window.parseScheda(fixturePPL)` → `days.length` pari al numero di giorni del fixture,
  e `days.every(d => d.exercises.length > 0)`.
- `window.parseScheda("spazzatura\nnon valida")` → `{ days: [] }` (la guardia di
  validazione tiene — è ciò che protegge il flusso di import da file rotti).
- `window.parseDieta(fixtureDieta)` → numero di sezioni/pasti atteso.
- `window.foodEmoji("pollo")` → stringa non vuota (un'emoji).

Se lo shim `window` non basta per caricare il file (es. altre dipendenze globali al
top-level), il runner deve fallire con un messaggio chiaro, non in silenzio.

- `package.json` — aggiungere `"scripts": { "test": "node test/run.mjs" }`.
- Aggiungere `- test/` all'`exclude:` di `_config.yml` (i test non si spediscono).

### 3. Codice morto — `screens/dieta.jsx`

- Rimuovere i campi `kcal: NNN` dagli oggetti pasto e `kcalMin: N` dagli oggetti del
  cardio. Verificato con grep: non esistono riferimenti in render (`.kcal`, `{kcal}`,
  `kcalMin` usati) — sono dati morti residui della rimozione kcal dalla UI.
- **File spedito** → richiede deploy con bump cache.

### 4. Fix `launch.html`

- Allineare la lista `<script type="text/babel" src="...">` a quella di `index.html`:
  mancano `push.jsx` (dopo `api.jsx`), `ui.jsx` (dopo `icons.jsx`), `promemoria.jsx`
  (dopo `impostazioni.jsx`). Ordine di caricamento come in `index.html`.
- **Motivazione**: `launch.html` è il launcher di sviluppo locale; oggi è stale e
  aprendolo la Dashboard si rompe (usa componenti di `ui.jsx`).
- `launch.html` è servito da Pages ma NON è l'entry point degli utenti (index.html lo
  è) e non è precache del SW → **niente bump cache**.

## Data flow / interfacce

Nessun cambiamento alle interfacce runtime dell'app. Il test harness è un consumatore
**esterno** e read-only del contratto già esistente di `parser.jsx`
(`window.parseScheda(text) -> {days:[...]}`, `window.parseDieta(text) -> {...}`).
Non modifica `parser.jsx`; lo caratterizza.

## Error handling

- Runner test: ogni assert in try/catch, raccoglie i fallimenti, exit code 1 se ≥1 FAIL.
  Errore di caricamento del file sotto vm = FAIL esplicito (non silenzioso).
- Nessun impatto sui percorsi d'errore dell'app (le modifiche 1/2/4 non toccano codice
  spedito eseguito; la 3 rimuove solo dati inerti).

## Testing

Il deliverable *è* la rete di test. Verifica di completamento:
- `npm test` esce 0 con tutte le asserzioni PASS sullo stato attuale del codice
  (test di caratterizzazione: descrivono il comportamento corrente corretto).
- La suite smoke passa su tutti i `.jsx` correnti.
- Sanity: introdurre di proposito un errore di sintassi in un `.jsx` di prova fa
  fallire la smoke (verifica che il test morda davvero), poi ripristinare.

## Deploy

Due commit separati:
- **Commit A** (no bump cache): `dev/` (file spostati) + `_config.yml` (exclude
  `dev/`, `test/`) + `test/**` + `package.json` (script test) + `launch.html`.
  Non tocca l'app viva → commit + push senza toccare `sw.js`/`?v=`.
- **Commit B** (deploy completo con bump): `screens/dieta.jsx` (rimozione kcal) →
  eseguire lo script di deploy (bump `CACHE_NAME` + tutti i `?v=` + add/commit/push).
- iOS SW sticky: dopo il commit B, chiudere e riaprire la PWA.

## Fuori scope (esplicito)

- Refactor stato per-posizione della Scheda → keyed-by-id (rimandato al redesign
  Scheda+Player).
- Estrazione dei dati hardcoded scheda/dieta in un modulo `data/` (Approccio ②).
- Qualunque cambiamento di UI, layout o comportamento visibile.
- Backend (`google-apps-script.gs`, worker) e chiavi/segreti.
