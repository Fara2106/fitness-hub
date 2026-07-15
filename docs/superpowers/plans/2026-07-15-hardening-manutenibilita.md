# Hardening & Manutenibilità — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre una rete di test Node dove oggi non esiste alcun test runner, ripulire il repo (file di tooling non spediti, codice morto, launcher stale) — tutto a basso rischio, senza cambiare la UI né la macchina a stati della Scheda.

**Architecture:** Runner Node a zero dipendenze esterne (usa solo `@babel/core`, già in devDependencies, + built-in `node:vm`/`node:fs`). Trasforma i `.jsx` con `@babel/preset-react` e, per il parser, li esegue in una sandbox `vm` con uno shim minimale di `window`. Le altre modifiche sono spostamenti di file, esclusioni Jekyll e rimozione di dati inerti.

**Tech Stack:** Node 26 (ESM `.mjs`), `@babel/core` + `@babel/preset-react`, `node:vm`. GitHub Pages/Jekyll per il deploy.

## Global Constraints

- Nessun build step: React 18 + Babel standalone via CDN; ogni componente `.jsx` spedito è un global `window.Nome`; **mai** `import`/`export` ES nei file spediti (il runner `.mjs` in `test/` NON è spedito → lì l'ESM è ok).
- Persistenza runtime solo `window.storage` — non toccata da questo piano.
- Cache: ogni modifica a file **spediti** (`.jsx/.css/.html/sw.js/icone`) richiede bump `CACHE_NAME` in `sw.js` + tutti i `?v=` in `index.html`. Modifiche a `docs/`, `test/`, `dev/`, `_config.yml`, `package.json`, `launch.html` → **niente bump** (non toccano l'app viva/precache).
- Validazione per-file disponibile: `node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"`.
- Working dir: `~/Documents/Web Apps/Fitness App`.

---

### Task 1: Test harness (`test/` + `npm test`)

Il deliverable centrale. Runner con due suite: smoke "compila tutto" + unit del parser. Fixture verificate contro il `parser.jsx` attuale (parseScheda → 3 giorni×2 esercizi; parseDieta → sezioni riposo/ore17).

**Files:**
- Create: `test/run.mjs`
- Create: `test/fixtures/scheda-ppl.txt`
- Create: `test/fixtures/dieta.txt`
- Modify: `package.json` (aggiunge blocco `scripts`)
- Modify: `_config.yml` (aggiunge `- test/` all'exclude)

**Interfaces:**
- Consumes: contratto esistente di `parser.jsx` — `window.parseScheda(text) -> {days:[{num,key,name,focus:[],exercises:[{name,sets:[],...}]}]}`, `window.parseDieta(text) -> {<sectionKey>:{meals:[{title,...}],integratori:[]}} | null`, `window.foodEmoji(text) -> string`.
- Produces: comando `npm test` (exit 0 = tutto verde, ≠0 = almeno un FAIL).

- [ ] **Step 1: Creare la fixture scheda** — `test/fixtures/scheda-ppl.txt`:

```
# PUSH - Giorno 1
# Focus: Pettorali · Spalle · Tricipiti
Esercizio | Serie | Ripetizioni | Recupero | Note
Panca piana | 4 | 8-10 | 90 | pettorali
Alzate laterali | 3 | 12-15 | 60 | spalle

# PULL - Giorno 2
# Focus: Dorso · Bicipiti
Esercizio | Serie | Ripetizioni | Recupero | Note
Trazioni | 4 | 6-8 | 120 | dorso
Curl bilanciere | 3 | 10-12 | 60 | bicipiti

# LEGS - Giorno 3
# Focus: Quadricipiti · Femorali · Polpacci
Esercizio | Serie | Ripetizioni | Recupero | Note
Squat | 4 | 6-8 | 150 | quadricipiti
Stacco rumeno | 3 | 8-10 | 120 | femorali
```

- [ ] **Step 2: Creare la fixture dieta** — `test/fixtures/dieta.txt`:

```
# PIANO NUTRIZIONALE - TEST

---

# GIORNO SENZA ALLENAMENTO

COLAZIONE (scegli 1 opzione):
- Opzione 1: 40g gallette + 50g marmellata
- Opzione 2: 150g yogurt greco + 20g miele

PRANZO:
Carboidrato (scegli 1): 80g riso basmati | 100g pane integrale
Verdure: 300g verdure a scelta
Proteine: 150g pollo

CENA:
- 200g merluzzo + 300g verdure

---

# ALLENAMENTO ORE 17

PRANZO:
- 80g pasta integrale + 150g pollo

POST-WO:
- 30g proteine whey + banana
```

- [ ] **Step 3: Scrivere il runner** — `test/run.mjs` (codice completo, verificato in prototipo):

```javascript
// test/run.mjs — test harness a zero dipendenze esterne (usa solo @babel/core).
// Due suite: A) smoke "tutti i .jsx compilano", B) unit del parser in sandbox vm.
// Lancio: `npm test`. Exit 0 = tutto verde; exit 1 = almeno un FAIL.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.error("  FAIL " + name); }
}
function transform(absPath) {
  return babel.transformFileSync(absPath, { presets: ["@babel/preset-react"] }).code;
}

// ---- Suite A: smoke "tutti i .jsx compilano" ----
console.log("\nSuite A — smoke: ogni .jsx passa @babel/preset-react");
const SCAN_DIRS = [".", "screens", "dev"];
for (const d of SCAN_DIRS) {
  let entries;
  try { entries = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const f of entries.filter(x => x.endsWith(".jsx")).sort()) {
    const rel = (d === "." ? "" : d + "/") + f;
    try { transform(join(ROOT, d, f)); ok("transform " + rel, true); }
    catch (e) { ok("transform " + rel + " — " + e.message.split("\n")[0], false); }
  }
}

// ---- Suite B: unit del parser ----
console.log("\nSuite B — parser (sandbox vm + shim window)");
const sandbox = { window: {}, console };
vm.createContext(sandbox);
try {
  vm.runInContext(transform(join(ROOT, "parser.jsx")), sandbox, { filename: "parser.jsx" });
  ok("parser.jsx si carica sotto vm", true);
} catch (e) {
  ok("parser.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
}
const W = sandbox.window;

if (typeof W.parseScheda === "function") {
  const s = W.parseScheda(readFileSync(join(DIR, "fixtures", "scheda-ppl.txt"), "utf8"));
  ok("parseScheda: 3 giorni", s.days.length === 3);
  ok("parseScheda: ogni giorno ha esercizi", s.days.every(d => d.exercises.length > 0));
  ok("parseScheda: focus del G1 parsato", s.days[0].focus.length === 3);
  ok("parseScheda: spazzatura -> {days:[]}", JSON.stringify(W.parseScheda("boh\nnon valida")) === '{"days":[]}');
  ok("parseScheda: input non stringa -> {days:[]}", JSON.stringify(W.parseScheda(null)) === '{"days":[]}');
} else ok("parseScheda esiste", false);

if (typeof W.parseDieta === "function") {
  const d = W.parseDieta(readFileSync(join(DIR, "fixtures", "dieta.txt"), "utf8"));
  ok("parseDieta: sezione riposo presente", !!(d && d.riposo));
  ok("parseDieta: riposo ha 3 pasti", !!(d && d.riposo && d.riposo.meals.length === 3));
  ok("parseDieta: ore17 ha 2 pasti", !!(d && d.ore17 && d.ore17.meals.length === 2));
  ok("parseDieta: input vuoto -> null", W.parseDieta("") === null);
} else ok("parseDieta esiste", false);

if (typeof W.foodEmoji === "function") {
  ok("foodEmoji('pollo') non vuoto", typeof W.foodEmoji("pollo") === "string" && W.foodEmoji("pollo").length > 0);
} else ok("foodEmoji esiste", false);

// ---- Esito ----
console.log("\n" + pass + " pass, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 4: Aggiungere lo script npm** — `package.json` diventa:

```json
{
  "scripts": {
    "test": "node test/run.mjs"
  },
  "devDependencies": {
    "@babel/core": "^8.0.1",
    "@babel/preset-react": "^8.0.1"
  }
}
```

- [ ] **Step 5: Lanciare i test — devono passare**

Run: `npm test`
Expected: termina con `... pass, 0 fail` ed exit code 0. Suite A elenca tutti i `.jsx` di root+screens (dev/ ancora vuota in questo task) come PASS; Suite B tutti PASS.

- [ ] **Step 6: Sanity — verificare che i test "mordano"**

Introdurre di proposito un errore di sintassi, poi ripristinare:
```bash
printf '\nconst x = (' >> parser.jsx      # rompe parser.jsx
npm test; echo "exit=$?"                    # atteso: FAIL su transform parser.jsx + FAIL Suite B, exit=1
git checkout -- parser.jsx                  # ripristina
npm test; echo "exit=$?"                    # atteso: 0 fail, exit=0
```
Expected: primo run exit=1 con almeno un FAIL; dopo il ripristino exit=0.

- [ ] **Step 7: Escludere `test/` dalla build Pages** — in `_config.yml`, dentro la lista `exclude:`, aggiungere la riga `  - test/` (sotto `- node_modules/`).

- [ ] **Step 8: Commit (niente bump cache — non tocca l'app viva)**

```bash
git add test/ package.json _config.yml
git commit -m "test: harness Node (smoke compila-tutto + unit parser) via npm test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Igiene repo — cartella `dev/`

Sposta i due file di tooling non spediti fuori dalla root pubblicata.

**Files:**
- Move: `design-canvas.jsx` → `dev/design-canvas.jsx`
- Move: `tweaks-panel.jsx` → `dev/tweaks-panel.jsx`
- Modify: `_config.yml` (aggiunge `- dev/` all'exclude)

**Interfaces:**
- Consumes: nulla (i file non sono referenziati da alcun file caricato — verificato con grep).
- Produces: nulla a runtime.

- [ ] **Step 1: Spostare i file con git**

```bash
mkdir -p dev
git mv design-canvas.jsx dev/design-canvas.jsx
git mv tweaks-panel.jsx dev/tweaks-panel.jsx
```

- [ ] **Step 2: Escludere `dev/` dalla build Pages** — in `_config.yml`, dentro `exclude:`, aggiungere `  - dev/`.

- [ ] **Step 3: Verificare che nulla li referenzi ancora**

Run: `grep -rn "design-canvas\|tweaks-panel\|DesignCanvas\|TweaksPanel" index.html launch.html *.jsx screens/*.jsx`
Expected: nessun output (i file spediti non li citano). Se compare qualcosa, fermarsi e indagare.

- [ ] **Step 4: Lanciare i test — la smoke ora include `dev/`**

Run: `npm test`
Expected: `0 fail`, exit 0. Suite A ora elenca anche `dev/design-canvas.jsx` e `dev/tweaks-panel.jsx` come PASS (entrambi verificati compilabili).

- [ ] **Step 5: Commit (niente bump cache)**

```bash
git add -A
git commit -m "chore(repo): sposta design-canvas/tweaks-panel in dev/ (fuori dalla build Pages)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Fix `launch.html` (launcher di sviluppo locale)

Riallinea la lista script del launcher locale a `index.html` (mancano `push.jsx`, `ui.jsx`, `promemoria.jsx`).

**Files:**
- Modify: `launch.html`

**Interfaces:**
- Consumes: ordine di caricamento di `index.html`.
- Produces: nulla a runtime dell'app pubblicata (launch.html è solo per uso locale).

- [ ] **Step 1: Aggiungere `push.jsx`** — dopo la riga `<script type="text/babel" src="api.jsx"></script>` inserire:

```html
<script type="text/babel" src="push.jsx"></script>
```

- [ ] **Step 2: Aggiungere `ui.jsx`** — dopo la riga `<script type="text/babel" src="icons.jsx"></script>` inserire:

```html
<script type="text/babel" src="ui.jsx"></script>
```

- [ ] **Step 3: Aggiungere `promemoria.jsx`** — dopo la riga `<script type="text/babel" src="screens/impostazioni.jsx"></script>` inserire:

```html
<script type="text/babel" src="screens/promemoria.jsx"></script>
```

- [ ] **Step 4: Verificare che la lista jsx di launch.html combaci con index.html**

Run:
```bash
diff <(grep -o 'src="[^"]*\.jsx' index.html) <(grep -o 'src="[^"]*\.jsx' launch.html)
```
Expected: nessuna differenza (exit 0). Se differiscono, correggere l'ordine finché il diff è vuoto.

- [ ] **Step 5: Commit (niente bump cache — launch.html non è l'entry point né in precache)**

```bash
git add launch.html
git commit -m "fix(dev): riallinea launch.html a index.html (push/ui/promemoria mancanti)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rimozione codice morto in `dieta.jsx` + deploy

Rimuove i campi `kcal`/`kcalMin` inerti; è l'unico file **spedito** toccato → richiede deploy con bump cache. Ultimo task così il deploy porta con sé anche i commit precedenti.

**Files:**
- Modify: `screens/dieta.jsx`
- Modify (deploy): `sw.js` (`CACHE_NAME`), `index.html` (`?v=`)

**Interfaces:**
- Consumes: nulla.
- Produces: nessun cambiamento di comportamento (i campi non erano renderizzati — verificato: nessun uso `.kcal`/`{kcal}`/`kcalMin` in render).

- [ ] **Step 1: Confermare che `kcal`/`kcalMin` non sono usati in render**

Run: `grep -nE "\.kcal\b|\{ *kcal *\}|kcalMin[^:]" screens/dieta.jsx`
Expected: nessun output. (Le uniche occorrenze devono essere le *definizioni* `kcal: NNN` / `kcalMin: N`.) Se compare un uso reale, fermarsi: non è codice morto.

- [ ] **Step 2: Rimuovere `kcalMin` dagli oggetti cardio** — nell'array delle attività cardio (righe ~11-15), togliere `, kcalMin: N` da ciascun oggetto. Esempio: `{ id: "corsa", label: "Corsa", emoji: "🏃", kcalMin: 8 }` → `{ id: "corsa", label: "Corsa", emoji: "🏃" }`.

- [ ] **Step 3: Rimuovere `kcal: NNN,` dagli oggetti pasto** — in ogni oggetto pasto dei dati fallback, togliere il campo `kcal: NNN,`. Esempio: `{ time:"08:00", sortTime:"08:00", emoji:"🌅", title:"Colazione", kcal:520, ...}` → stesso oggetto senza `kcal:520,`. Lasciare intatti `time/sortTime/emoji/title` e il resto.

- [ ] **Step 4: Verificare che non resti alcun `kcal`**

Run: `grep -nc "kcal" screens/dieta.jsx`
Expected: `0`.

- [ ] **Step 5: Lanciare i test — dieta.jsx compila ancora**

Run: `npm test`
Expected: `0 fail`, exit 0 (Suite A include `screens/dieta.jsx`; deve restare PASS).

- [ ] **Step 6: Deploy completo (bump cache OBBLIGATORIO)**

Preferire lo script esistente:
```bash
"./Deploy GitHub Pages.command"
```
Se non eseguibile in sessione, replicarlo manualmente: rimuovere eventuali lock git stantii, bumpare `CACHE_NAME` in `sw.js` a un nuovo timestamp, bumpare **tutti** i `?v=…` in `index.html` allo stesso valore, poi:
```bash
git add -A
git commit -m "chore(dieta): rimuove dati kcal morti + deploy (bump cache)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 7: Nota post-deploy** — ricordare a Lorenzo che il SW iOS è sticky: chiudere la PWA dal multitasking e riaprirla perché il nuovo SW prenda il controllo. Le modifiche non-app (dev/, test/, launch.html) sono già in `main` coi commit precedenti, portati su dal push.

---

## Self-Review

**Spec coverage:**
- Spec §1 (dev/) → Task 2 ✓
- Spec §2 (test harness) → Task 1 ✓ (smoke + unit parser + fixtures + npm test + exclude test/)
- Spec §3 (dead code kcal) → Task 4 ✓
- Spec §4 (launch.html) → Task 3 ✓
- Spec "Deploy: commit A senza bump / commit B con bump" → Task 1/2/3 committano senza bump; Task 4 fa il deploy con bump e porta su tutto ✓
- Spec "Fuori scope" (refactor Scheda, estrazione dati) → nessun task li tocca ✓

**Placeholder scan:** nessun TBD/TODO; ogni step ha comando + output atteso o codice completo. ✓

**Type/name consistency:** `parseScheda`/`parseDieta`/`foodEmoji` e le chiavi `days`/`meals`/`riposo`/`ore17`/`focus` usate nei test combaciano col contratto reale di `parser.jsx` (verificato in prototipo). Il runner `run.mjs` è coerente tra i task (Suite A cresce quando dev/ compare in Task 2). ✓

**Ordine/rischio:** i task 1-3 non toccano l'app viva (nessun bump). Solo Task 4 tocca un file spedito e fa il deploy, per ultimo. ✓
