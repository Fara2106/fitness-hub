# Prompt 2 — per Claude Code (porta il look approvato nel repo)

> Da usare in una sessione Claude Code **dentro il repo** `Fitness App`, dopo aver approvato il mockup del Prompt 1.
> Allega/incolla insieme a questo prompt: l'Artifact HTML del Prompt 1 (o i suoi token + gli screenshot delle schermate) come **riferimento visivo**.
> Scopo: applicare il nuovo look ai file `.jsx` reali SENZA rompere lo stack e SENZA toccare il backend.

===

Devi applicare un redesign visivo (che ti fornisco come mockup HTML/screenshot di riferimento) alla mia PWA fitness **Lorenzo Fitness Hub**, restando dentro il suo stack no-build. È un progetto reale in produzione: rompere i vincoli sotto trasforma l'app in una pagina bianca. Leggi prima `CLAUDE.md` nella root: è la fonte di verità, questo prompt ne è il sommario operativo.

## Regola d'oro: solo restyle, struttura invariata

Il mockup cambia **solo l'aspetto**. Non cambiare quali schermate esistono, la navigazione, i flussi, i nomi delle chiavi di storage, né la logica. Se un cambio visivo richiedesse di toccare la logica, **fermati e chiedi**.

## Vincoli di stack — DA NON VIOLARE

- **React 18 via CDN + Babel standalone. Nessun build step.** Ogni componente è un global: ogni file finisce con `window.NomeComponente = NomeComponente;`. **Mai** `import`/`export`.
- **Persistenza SOLO `window.storage`** (IndexedDB). Mai `localStorage`/`sessionStorage`.
- **Niente `<form>`** — collega `onClick`/`onChange` direttamente.
- **Nessun bundler.** I `.jsx` sono caricati in ordine fisso da `index.html` con `<script type="text/babel" src="...?v=BUILD">`. Un file nuovo va aggiunto a quella lista **nell'ordine giusto** (un global va definito prima del file che lo usa).
- **Colori solo via variabili CSS** (`--bg --card --text --border --accent --brand-grad --nav-bg --track` …). Mai colori hardcoded. Dark è default; light aggiunge `.theme-light` su `<html>`. Tema di default `"system"` (segue `prefers-color-scheme`, con anti-flash script nell'`<head>` di `index.html`).
- **Font di sistema**, zero webfont (CDN font bloccate; è una PWA offline-first).

## Backend e sync — INTOCCABILI

- **Non modificare** `api.jsx` (endpoint/logica di `sheetsAPI`/`groqAPI`), `storage.jsx`, `google-apps-script.gs`, `cloudflare-worker.js`. Il backend Google Sheets funziona: lascialo così.
- Non rinominare né rimuovere le **chiavi di sync**: `groqApiKey`, `schedaData`/`dietaData`, `spesaChecked2`, `spesaFreq`, `bodyWeight`, `weekNum`, `onboardingDone`. (Gotcha spesa: chiave cloud `spesaChecked2`, chiave locale `spesaChecked` — non toccare.)
- Non toccare le chiavi per-giorno né la loro pulizia: `schedaProg_<date>`, `gym_<date>`, `muscleSets_<date>`, `coachChat_<date>`, `_cleanupOldDailyKeys()`.

## Gotcha da preservare (non introdurre regressioni)

- **`screens/scheda.jsx` — bleed tra i giorni**: `completion`, `substitutions`, `occupied`, `pesosRef` sono indicizzati **per posizione** e vanno sostituiti **tutti insieme** in `switchTo(tab)`, caricando il blocco per-tab da `schedaProg_<date>`. Qualsiasi nuovo stato per-posizione va aggiunto a `switchTo` **e** al blocco persistito. Non reintrodurre il bug dei pesi che finiscono sull'esercizio sbagliato.
- **Recharts (Storico)** richiede il `<script>` di `prop-types` caricato **prima** di Recharts in `index.html`. Non rimuoverlo.
- **Rest timer** (`TimerOverlay`) è timestamp-based (`endRef`) + Wake Lock. Non tornare a un contatore `setInterval`.
- **Shell iOS**: non toccare i due `<meta name="theme-color" media=…>` (dark `#0b0b0f` / light `#f7f7fa`), il `#root { position:fixed; inset:0 }`, né `--statusbar-bg`. Sono fix hard-won della safe-area iOS.

## Metodo di lavoro (in quest'ordine)

1. **Token prima di tutto**: aggiorna la palette/tipografia/spacing/raggi in `styles.css` (`:root` e `.theme-light`) secondo la "Design spec" del mockup. Verifica che dark **e** light restino coerenti.
2. **Componenti condivisi**: aggiorna `ui.jsx` (i global `UIAvatarLF/UIHeader/UICard/UIRow/UISegmented/UIChip/UIProgress/UIButton/UIStatTile/UISheet`) così che il restyle si propaghi. Preferisci cambiare qui piuttosto che nelle singole schermate.
3. **Schermata per schermata**, una alla volta, in `screens/`: `dashboard, scheda, dieta, spesa, coach, storico, impostazioni, onboarding`. Applica il nuovo look riusando i componenti `UI*`. Ferma e mostrami il risultato dopo ognuna prima di passare alla successiva.
4. Se aggiungi un file nuovo, aggiungilo a `index.html` nell'ordine corretto.

## Validazione (non c'è test runner)

Dopo ogni file modificato, verifica che transpili:

```bash
cd ~/Documents/Web\ Apps/Fitness\ App
node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"
```

Cross-check quando pertinente:
- Ogni `t("chiave")` usata nelle schermate esiste in `i18n.jsx` (IT **e** EN).
- Ogni `<Icon name="…">` esiste in `icons.jsx`.
- Nessun colore hardcoded introdotto (solo variabili CSS).

## Deploy — NON farlo

Non fare `git commit`/`push` e non lanciare lo script di deploy: non hai le credenziali e il deploy lo fa solo Lorenzo dal suo Mac (`Deploy GitHub Pages.command`). **Solo modifiche a file locali.** Alla fine dammi:
- l'elenco dei file toccati,
- conferma che ognuno passa Babel,
- un promemoria che dopo il deploy su iPhone va chiusa e riaperta la PWA (service worker "sticky").

## Consegna attesa

File `.jsx`/`styles.css` modificati, look allineato al mockup, stack e backend intatti, tutto validato con Babel, niente commit. Procedi token → `ui.jsx` → schermate, fermandoti a ogni schermata per la mia review.
