# Redesign Fitness Hub — design doc

**Data:** 11 luglio 2026 · **Approvato da:** Lorenzo (sezioni 1, 2, 3 + concept A+Player)
**Mockup di riferimento:** https://claude.ai/code/artifact/25b1ce87-50db-44bb-8fb4-514c1dcbc536

## Obiettivo

L'app funziona nei dati ma è "macchinosa per iPhone" su tre assi, tutti confermati da Lorenzo:
1. **Lenta ad aprirsi** (Babel compila 376 KB di JSX sul telefono a ogni avvio freddo).
2. **Troppi tap/scroll** nelle azioni quotidiane (palestra, pasti, check-in, spesa) e il cambio scheda/dieta è introvabile (sepolto in Impostazioni → File di testo).
3. **Estetica incoerente** (colori decorativi arbitrari, card-dentro-card, brand LF assente dalla UI).

Stile scelto: **iOS premium** — scuro elegante, un solo accento di marca, colori semantici solo con significato.
Impianto scelto: **Concept A (tab riordinate) + Player palestra a schermo intero**.

## Sezione 1 — Design system

### Token colore (dark / light speculare)

| Token | Dark | Light | Ruolo |
|---|---|---|---|
| `--bg` | `#0B0B0F` | `#F2F2F7` | sfondo pagina |
| `--card` | `#15151B` | `#FFFFFF` | unica elevazione |
| `--border` | `#23232B` | `#E2E4EA` | hairline: bordi, divisori |
| `--text` | `#F2F2F7` | `#17181C` | testo primario |
| `--text-2` | `#8E8E9A` | `#6A6E78` | testo secondario |
| brand | `linear-gradient(135deg, #0A84FF, #5E5CE6)` | idem | **unico colore di marca**: CTA, stati attivi, progressi, avatar LF |
| semantici | `#30D158` / `#FFD60A` / `#FF453A` | toni scuriti equivalenti | SOLO fatto / attenzione / errore |

Regole: mai colore hardcodato nei componenti (solo token); i colori semantici non si usano mai come decorazione (via: pillole viola/ambra del check-in, striscia rossa "Proteine", banner giallo integratori, avatar arancione).

**`theme-color` (watch list!):** la nuova tonalità TabBar/ground cambia i valori del meta `theme-color`. Va aggiornato **nei tre punti sincronizzati**: meta statico in `index.html`, script anti-flash in `index.html`, `_applyTheme()` in `app.jsx`. Il fix della status bar light (`--statusbar-bg`) resta, ricalibrato sui nuovi toni.

### Tipografia

- **Font di sistema** (`-apple-system` → SF Pro su iOS). Rimossi i webfont General Sans e JetBrains Mono (e l'`@import` Fontshare in `styles.css`, oggi render-blocking).
- Scala: Large 28/700 (-0.02em) · Title 20/650 · Head 16/600 · Body 15/400 · Foot 13/400 · Cap 11/600 uppercase (+0.07em).
- Numeri dati: `font-variant-numeric: tabular-nums` (pesi, kcal, serie, quantità).

### Componenti condivisi (nuovo file `ui.jsx`)

Card · ListRow (icona? titolo/sottotitolo, valore/chevron) · SegmentedControl · Chip · ProgressBar (riempimento gradiente) · PrimaryButton (gradiente) · StatTile · Sheet/menu ⋯. Esposti come globali `window.UI...`; **`ui.jsx` va aggiunto all'ordine di caricamento in `index.html`** dopo `icons.jsx`, prima degli screens (in fase 3 anche in `dev.html`).

### Icone e spaziatura

- Solo il set SVG di `icons.jsx` (stroke 1.8 coerente); **mai emoji come icone UI**.
- Griglia 4 pt; bersagli touch ≥ 44 pt; una sola elevazione (mai card-dentro-card: dentro una card ci sono righe divise da hairline).
- Transizioni 150–200 ms solo `transform`/`opacity`, con `prefers-reduced-motion` rispettato.

## Sezione 2 — Navigazione e flussi (Concept A + Player)

### Navigazione

- **TabBar a 5**: Home, Scheda, Dieta, Spesa, Coach. "Setup" esce.
- **Profilo** (ex Impostazioni) si apre dall'**avatar LF** in alto a destra, presente nell'header compatto di ogni schermata. Route interna invariata (`impostazioni`), etichette i18n nuove ("Profilo" IT / "Profile" EN).
- Header compatti: eyebrow 11 + titolo 24 (non più ~40).
- Storico: resta dentro Profilo → Progressi (scelta confermata).

### Home (dashboard.jsx)

Ordine: 1) **Hero "Oggi"** — sessione del giorno (da `getTodaySession()`), chips gruppi muscolari, CTA *Inizia allenamento* → Scheda in modalità player; nei giorni di riposo: cardio consigliato. 2) **Riga "Prossimo pasto"** calcolata dall'ora corrente sui dati dieta → tap = Dieta ancorata al pasto. 3) **Check-in compresso**: Sonno/Energia come 5 tacche (bersagli ≥ 44 pt), "Fastidi" espandibile. 4) **Due StatTile**: Peso (tap = log rapido inline, stesso flusso `bodyWeight` + push Sheets di oggi, spostato da Impostazioni) e Mesociclo W/8. Saluto ridotto a header compatto.

### Scheda (scheda.jsx) + Player

- Lista: riga-serie **spuntabile con tap sull'intera riga**, peso editabile inline, prossima serie evidenziata; progress hairline sotto l'header; segmented A/Lower/B invariato nella logica (`switchTo`).
- **Player a schermo intero** (vista interna a `scheda.jsx`, niente nuova route): si entra con "Inizia allenamento" (Home o Scheda). Un esercizio alla volta: eyebrow "Serie n di m", nome, peso gigante, × rip, RPE target, riga "l'ultima volta: … kg × … · RPE …" (fonte: il più recente `gym_<date>` locale della stessa sessione; se assente, il peso già in scheda — nessuna chiamata extra al backend), bottone unico **Serie fatta** → salva e **avvia in automatico il timer di recupero** (disattivabile); peek "Dopo: <esercizio>"; ✕ per tornare alla lista; ⋯ per sostituzione/note. Wake Lock e timer timestamp-based (`endRef`) **riusati identici** (non reimplementare).
- **Vincolo bleed-between-days:** il player opera sugli stessi stati per-posizione (`completion`, `substitutions`, `occupied`, `pesosRef`); ogni eventuale nuovo stato per-posizione va aggiunto a `switchTo` E al blocco persistito `schedaProg_<date>`. Chiusura sessione: flusso attuale (`gym_<date>` + `muscleSets_<date>`), reso più visibile a fine lista/player.
- Menu ⋯ della schermata: **"Modifica scheda"** (editor strutturato, v. sotto) + "Incolla testo" / "Importa .txt" come vie secondarie (FileImporter validato esistente, `schedaData_at`).

### Dieta (dieta.jsx)

Ordine: 1) **"Adesso"** — pasto corrente/prossimo in cima, già espanso (alimenti + quantità + kcal/macro del pasto). 2) Altri pasti collassati in ordine orario. 3) Macro giorno come riga compatta 4 valori. 4) **Integratori**: una riga "Prossimo · <nome> tra <min>" + contatore n/10, tap espande la lista; la timeline a pallini viene rimossa. 5) Attività/orario sessione in blocco compatto. Menu ⋯: **"Modifica dieta"** (editor strutturato, v. sotto) + incolla/importa come vie secondarie (+ `dietaData_at`). Nomi alimenti restano in italiano (dati piano, non UI).

### Spesa (spesa.jsx)

Categorie neutre (icona + conteggio n/m, **niente rosso**); righe con checkbox grande a sinistra (riga intera tappabile), barrato al fatto; progress hairline sotto l'header. La frequenza spesa (1×/2×) esce dalla cima → menu ⋯ (chiavi invariate: locale `spesaChecked`, cloud `spesaChecked2`, `spesaFreq`). Reset con conferma.

### Coach (coach.jsx)

Header: contesto reale (W# · sessione · peso · check-in) come chips; **il nome modello sparisce dalla UI** (resta in `api.jsx`; visibile in Profilo → Connessioni). Suggerimenti contestuali all'ora (pre/post workout). Senza API key: empty state con CTA "Configura in Profilo". Persistenza `coachChat_<date>` invariata.

### Profilo (impostazioni.jsx)

Sezioni in ordine: **card utente** (tessera LF gradiente — via l'avatar arancione) → **Piani** (Scheda + Dieta: data ultimo aggiornamento, **Modifica** [editor strutturato], Incolla/Importa .txt, **Ripristina precedente**) → **Progressi** (Storico) → **Aspetto** (Tema, Lingua) → **Connessioni** (API key Groq con stato, modello indicato qui; stato sync/SyncBadge). Peso e settimana mesociclo **escono da Profilo**: vivono in Home — la tile Peso apre il log rapido, la tile Mesociclo apre lo stepper −/+ (stessa logica `weekNum` attuale, clamp 1..8).

### Editor piani — cambio scheda/dieta strutturato (scelta di Lorenzo: opzione 3)

Il cambio piano non passa più (solo) da file: **si modificano esercizi e pasti direttamente in-app**. L'editor è una GUI sopra il formato testo esistente — il modello dati non cambia.

**Meccanica (round-trip):** parse del testo attuale → modifica sulla struttura → **serializzazione canonica** in testo (nuove `window.serializeScheda` / `window.serializeDieta` in `parser.jsx`) → **ri-parse di verifica** (il risultato deve riprodurre la struttura) → salvataggio in `schedaData`/`dietaData` (stesse chiavi, stesso sync, `*_at` aggiornato). Prima di applicare: **backup in `schedaData_prev`/`dietaData_prev` (solo locali, non nel set sync)** con azione "Ripristina precedente" nel foglio Piani.

**Editor scheda** (da ⋯ in Scheda o Profilo → Piani): i tre giorni fissi (Upper A / Lower / Upper B) → elenco esercizi riordinabili (frecce ▲▼); tap su un esercizio apre il foglio campi: **nome, serie (stepper), range rip (es. "6-10"), recupero in s (stepper da 15 s), gruppi muscolari (chips → scritti come token "Muscoli: …" nella nota, che è ciò che `_detectMuscles` legge), note, alternative** (lista di nomi). Aggiungi/elimina esercizio.

**Editor dieta** (da ⋯ in Dieta o Profilo → Piani): picker della variante giorno (Riposo / Mattina / Ore 17 / Ore 21 / Ore 22) → pasti della variante → righe alimento (testo libero o "etichetta: valore"); aggiungi/elimina alimento; aggiungi/elimina pasto scegliendo tra i tipi riconosciuti dal parser (Colazione, Spuntino, Pranzo, Merenda, Pre/Post-workout, Cena).

**Limiti onesti (dal formato dati):** le kcal per pasto non esistono nel formato testo → non editabili (non se ne mostrano di inventate); gli integratori sono statici in `parser.jsx` → fuori scope; i giorni scheda sono i tre del programma. Le esclusioni dieta (`_isExcluded`) continuano a filtrare in parsing.

### Onboarding (onboarding.jsx)

Solo restyle coi nuovi componenti; flusso e logica `onboardingDone` invariati.

## Sezione 3 — Performance

Misure reali (trasferimento compresso, 11/07/2026): primo avvio oggi **921 KB** = React+DOM 47 + **Babel 654** + Recharts/prop-types 123 + JSX 97. Dopo: **~144 KB** subito, +123 KB solo in Storico. Il guadagno quotidiano vero: spariscono ~3 MB di Babel ri-analizzati e 376 KB ricompilati a ogni avvio freddo.

1. **Precompilazione al deploy.** `Deploy GitHub Pages.command` esegue anche: `npx @babel/core` (`@babel/preset-react`) su tutti i `*.jsx` + `screens/*.jsx` → **`.js` accanto a ciascun sorgente** (stesso nome, estensione diversa: `storage.jsx` → `storage.js`); **se la compilazione fallisce il deploy si interrompe** (niente push di build rotte). `index.html` carica i `.js` con `?v=` (il bump esistente continua a funzionare); **niente più `babel.min.js`**. Si continua a sviluppare sui `.jsx`.
2. **Chi committa i `.js`:** il deploy stesso — GitHub Pages serve il repository, quindi i compilati **devono** essere committati, e il `git add -A` già presente nello script li include. Mai editarli a mano (sono artefatti generati; nota in testa a ciascuno).
3. **`dev.html`** (nuovo, in fase 3): copia di index.html con Babel standalone + `.jsx`, per QA locale e sessioni agente.
4. **Recharts on-demand**: `storico.jsx` inietta gli script alla prima apertura — **prop-types PRIMA di Recharts** (trappola nota) — con stato di caricamento; rimossi i due `<script>` globali da `index.html` (prod).
5. **`sw.js`**: il precache passa ai `.js` compilati (+ `index.html`, css, icone); il bump `CACHE_NAME` del deploy invalida come oggi.
6. **Zero webfont** (v. Sezione 1).

## Invarianti (da NON toccare)

- Globali `window.*`, niente `import/export`; niente `<form>`; persistenza solo `window.storage`; `_setDefaults()` dentro `onReady`.
- Motore sync (`_cloudSync`, `_cloudPushMissing`, `_saveSettingRetry`, anti-clobber, chiavi synced) e chiavi storage/cloud **invariate** — il redesign non cambia il modello dati.
- Chiavi per-giorno (`schedaProg_`, `gym_`, `muscleSets_`, `coachChat_`) e `_cleanupOldDailyKeys()` invariati.
- Backend (Apps Script, worker Cloudflare) intatto.
- Esclusioni dieta del coach (pasta di ceci, lenticchie, piselli, bevanda di mandorla) intatte.

## Fasi di consegna (ognuna deployabile e QA-ta)

1. **Fondazioni**: token in `styles.css` (font di sistema, via i webfont), `ui.jsx` (componenti condivisi, incl. UIHeader con avatar), theme-color ×3, marchio LF al posto dell'avatar arancione in `nav.jsx`. La TabBar resta a 6 in questa fase. QA + deploy.
2. **Schermate**: Home → Scheda+Player → Dieta → Spesa → Coach → Profilo → Onboarding (in quest'ordine; deploy intermedi possibili). Ogni schermata adotta UIHeader (avatar→Profilo); **lo switch TabBar 6→5 avviene qui, quando tutte le schermate hanno l'avatar** (Profilo sempre raggiungibile). Nel foglio Piani arrivano subito Incolla/Importa + Ripristina (percorso base del cambio piano). QA per schermata.
3. **Editor piani**: serializzatori in `parser.jsx` (+ round-trip test), editor scheda, editor dieta. QA dedicato (modifica → verifica in Scheda/Dieta → sync → riavvio).
4. **Performance**: dev.html, script deploy con compile, index.html → .js, Recharts lazy, sw.js. È la fase più delicata: ultima, con QA completo e verifica su device (ricordare SW sticky iOS: chiudere la PWA dal multitasking; se serve, procedura di reset della watch list).

## Criteri di successo

- `index.html` di produzione senza `babel.min.js` e senza webfont; zero compilazione a runtime.
- Cambio piano raggiungibile in ≤ 2 tap da Scheda, Dieta e Profilo; **modificare un esercizio o un pasto non richiede mai un file**; ogni modifica è annullabile (Ripristina precedente).
- In palestra: spuntare una serie = 1 tap grande; timer parte da solo.
- Nessun colore fuori token; niente emoji-icone; QA Playwright (390×844, IT/EN, dark/light) verde su tutti i flussi della checklist Cowork.
- Dati e sync: identici prima/dopo (stesse chiavi, stessi formati).

## Rischi e mitigazioni

- **SW sticky iOS** può mascherare i deploy → verifica con cambiamento vistoso temporaneo se un dubbio sorge (procedura in CLAUDE.md).
- **Compile al deploy fallita** → lo script si ferma prima del push.
- **Regressioni bleed tra giorni in Scheda** → il player riusa gli stati esistenti; test dedicato cambio tab con progressi misti.
- **Recharts lazy rompe Storico** → mantenere ordine prop-types→Recharts, fallback messaggio d'errore con retry.
- **Serializzazione non fedele** (editor piani) → il salvataggio esige il ri-parse di verifica: se la struttura non coincide, si blocca con errore chiaro e i dati restano intatti; backup `_prev` sempre scritto prima di applicare.
