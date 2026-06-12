# Lorenzo Fitness Hub — Contesto completo per Claude

> Documento di handoff: leggilo per intero prima di toccare il codice. Contiene
> architettura, vincoli, stato dei file, bug risolti e problemi ancora aperti.
> Ultimo aggiornamento: **12 giugno 2026**.

Sono Lorenzo Faraoni (lorefara97@gmail.com). Sto sviluppando una PWA fitness
personale chiamata **Lorenzo Fitness Hub**, hostata su GitHub Pages.

- **URL app**: `https://fara2106.github.io/fitness-hub/`
- **Repo**: `https://github.com/fara2106/fitness-hub`
- **Cartella locale**: `~/Documents/Web Apps/Fitness App/`

---

## ⚠️ Stack tecnico — VINCOLI CRITICI (non violare mai)

- **React 18 via CDN + Babel standalone** — tutti i componenti sono esposti come
  `window.NomeComponente` (es. `window.AppFrame`, `window.Dashboard`).
  **MAI** usare `import`/`export` ES module.
- **`window.storage`** (IndexedDB-backed, lettura sincrona dopo init) —
  **MAI** usare `localStorage`/`sessionStorage`.
- **Nessun tag HTML `<form>`** — solo `onClick`/`onChange`.
- **Nessun bundler** — i file JSX sono caricati in ordine da `index.html` via
  `<script type="text/babel" src="...?v=BUILD">`.
- Ogni nuovo componente deve finire con `window.NomeComponente = NomeComponente;`.

---

## Architettura backend

### Google Apps Script (backend REST)
- **URL deployment**: `https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec`
- Fogli Google Sheets: `PesoCorporeo` (Data|Peso), `SerieAllenamento`, `Sessioni`,
  `Movimenti`, `CheckIn`, `Settings` (Key|Value).
- `Settings._saveSettings` fa upsert per chiave; `_getSettings` collassa le righe
  in un oggetto flat.

### Cloudflare Worker (proxy CORS)
- **URL proxy**: `https://fitness-hub-proxy.lorefara97.workers.dev`
- Proxy semplice (NON cachea): GET → inoltra querystring ad Apps Script;
  POST → inoltra il body. Tutte le chiamate ad Apps Script passano da qui.

### api.jsx — `window.sheetsAPI` / `window.groqAPI`
```javascript
window.sheetsAPI.getPesoCorporeo()   // → [{ date, weight }, ...]
window.sheetsAPI.getPesi() / getUltimiPesi() / getCheckIn(date?)
window.sheetsAPI.savePeso(d) / savePesoCorporeo(d) / saveSessione(d) / saveMovimento(d) / saveCheckIn(d)
window.sheetsAPI.getSettings()       // → { key: value, ... } flat
window.sheetsAPI.saveSettings({ key, value })
window.groqAPI.complete({ messages, systemPrompt, model, maxTokens })
window.playBeep(freq,dur,gain) / window.todayKey() / window.getTodaySession()
window._cloudPushAll()               // push forzato di TUTTO locale→cloud (bottone "Sincronizza ora")
window._saveSettingRetry(key, value) // push singolo con 2 retry
```
NB: `sheetsAPI.get()` aggiunge sempre `_cb=Date.now()` + `fetch(..., {cache:"no-store"})`
per evitare risposte GET stale dalla cache HTTP.

---

## Struttura file
```
~/Documents/Web Apps/Fitness App/
├── index.html        ← entry, registra SW, monta AppFrame, script versionati ?v=BUILD
├── styles.css
├── app.jsx           ← AppFrame, routing, stato globale, _cloudSync, _cloudPushMissing, _cloudPushAll, _saveSettingRetry, StatusBar
├── api.jsx           ← sheetsAPI (GET con cache-buster), groqAPI, playBeep, todayKey, getTodaySession
├── storage.jsx       ← window.storage (IndexedDB + coda scritture _pending)
├── i18n.jsx, icons.jsx, nav.jsx (TabBar/Sidebar), parser.jsx, anatomy.jsx, design-canvas.jsx, tweaks-panel.jsx
├── google-apps-script.gs   ← codice Apps Script (già deployato)
├── cloudflare-worker.js    ← codice del proxy (già deployato)
├── manifest.json
├── sw.js             ← Service Worker (network-first, CACHE_NAME bumpato a ogni deploy)
├── Deploy GitHub Pages.command  ← script di deploy
└── screens/ dashboard.jsx, scheda.jsx, dieta.jsx, spesa.jsx, coach.jsx, storico.jsx, impostazioni.jsx, onboarding.jsx
```

---

## window.storage — API + dati
```javascript
window.storage.get(key, def) / set(key, value) / remove(key) / clear() / isReady() / onReady(cb)
```
Chiavi: `checkIn_YYYY-MM-DD`, `hydration_YYYY-MM-DD`, `gym_YYYY-MM-DD`,
`integ_YYYY-MM-DD`, `notes_YYYY-MM-DD`, `activities`, `schedaData`, `dietaData`,
`spesaChecked` (locale resta questo nome), `spesaFreq`, `bodyWeight`, `weightLog`,
`weekNum`, `theme`, `lang`, `groqApiKey`, `sheetsUrl`, `onboardingDone`, `profile`.

---

## Sync cross-device — architettura (foglio Settings)

| Chiave cloud | Push locale→cloud | Pull cloud→locale |
|---|---|---|
| `groqApiKey` | Impostazioni (con retry) | `_cloudSync` — cloud wins |
| `schedaData` / `dietaData` | Upload file .txt (con retry) | `_cloudSync` |
| **`spesaChecked2`** | ogni toggle (AppFrame setState) + retry | `_cloudSync` (retro-compat: `s.spesaChecked2 || s.spesaChecked`) |
| `spesaFreq` | cambio frequenza | `_cloudSync` |
| `bodyWeight` / `weekNum` | ogni modifica | `_cloudSync` |
| `onboardingDone` | prima volta | `_cloudSync` |

- **`_cloudSync(opts)`**: legge `getPesoCorporeo` + `getSettings` con timeout
  individuali (`_safe`). Se il pull settings FALLISCE → `cloudKeys=null` e NON
  pusha (anti-clobber). Auto-skip onboarding se `hasGroq || hasBW`.
- **`_cloudPushMissing(cloudKeys)`**: pusha (con retry) solo chiavi presenti in
  locale ma assenti nel cloud, e SOLO se il pull è riuscito.
- **Pull periodico ogni 45s** mentre l'app è visibile + ri-sync su
  `visibilitychange` (foreground).
- Dati allenamento/cardio/checkin: letti dal vivo dal cloud nelle schermate
  Storico/Scheda (`getCheckIn`, `getPesoCorporeo`, `getUltimiPesi`).
- **Conflitti**: oggi last-writer-wins (nessun merge se lo stesso campo è
  modificato su due device offline).

---

## ✅ Cosa funziona

- Onboarding a step (salta i passi già configurati), routing, tema dark/light/auto, IT/EN.
- Dashboard: check-in sonno/energia/fastidi, idratazione, palestra oggi + dots
  settimana, log movimento/cardio, peso corporeo con sparkline, riepilogo muscoli.
- Scheda: schede Upper A / Lower / Upper B (da `scheda.txt` o fallback hardcoded),
  set/RPE/PR, timer di recupero con beep, sostituzioni esercizi, salvataggio su Sheets.
- Dieta: timeline cronologica pasti + integratori, slider orario giornata,
  varianti per orario allenamento (mattina/17/21/22), conteggio integratori.
- Spesa: lista per categorie, quantità in base a frequenza (1 o 2 spese/sett),
  sync `spesaChecked2`.
- Coach AI (Groq, llama-3.3-70b-versatile): prompt costruito con peso, settimana,
  sessione, check-in, idratazione, cardio, note, `schedaData`/`dietaData`.
- Storico: trend peso (Recharts), cardio, heatmap check-in 14 giorni.
- Impostazioni: profilo, peso, settimana mesociclo, API key con test, import file,
  sync manuale, reset completo.
- Sync cross-device via foglio Settings (verificato su 2 device simulati in Chrome).

---

## 🐞 Bug risolti — sessioni precedenti

1. **storage.jsx — race scritture**: `set()` prima che IndexedDB fosse pronto
   andavano perse. Aggiunta coda `_pending` drenata all'apertura del DB.
2. **Push cloud inaffidabile**: i push erano fire-and-forget; aggiunto
   `_saveSettingRetry` (2 retry).
3. **Anti-clobber**: se il pull settings falliva il codice ripushava dati locali
   stale. Ora `cloudKeys=null` ⇒ niente push.
4. **Spesa — righe duplicate** nel foglio `Settings`: spostata sulla chiave pulita
   `spesaChecked2` (locale resta `spesaChecked`). Pull retro-compatibile.
5. **GET cachate**: `_cb=Date.now()` + `cache:"no-store"`; asset `?v=BUILD`;
   Service Worker network-first.
6. **Sync automatico**: pull periodico ogni 45s + startup + foreground.
7. **Barre nere safe-area** (parziale): rimosso padding env() dal contenitore;
   StatusBar/TabBar assorbono gli inset.

---

## 🐞 Bug risolti — sessione 12 giugno 2026

Tutti corretti nei **file locali** (NON ancora deployati finché non lanci lo
script di deploy dal Mac). Verificati con transform `@babel/preset-react`.

1. **Storico irraggiungibile su mobile** *(grave, funzionale)* — la TabBar
   esclude `storico` e nessuna schermata ci navigava. Aggiunto accesso in
   **Impostazioni → Progressi → Storico**.
   File: `screens/impostazioni.jsx` (nuova prop `onNav` + `ISection` "Progressi"),
   commento corretto in `nav.jsx`.

2. **`api.jsx` sovrascriveva i default** — `_setDefaults()` girava prima che
   IndexedDB caricasse, quindi rileggeva sempre vuoto e sovrascriveva
   `groqApiKey` / `sheetsUrl` salvati. Ora gira dentro `window.storage.onReady()`.

3. **Scheda — bleed tra giorni** — cambiando tab (Upper A → Lower) si azzerava
   solo `completion`; sostituzioni e stato "macchina occupata" (indicizzati per
   posizione) restavano sugli esercizi sbagliati. Ora si azzerano anche
   `substitutions` e `occupied` al cambio scheda. File: `screens/scheda.jsx`.

4. **Dashboard — plurale errato** — "2 volt**ae**" → ora "2 volte" /
   "1 volta". File: `screens/dashboard.jsx`.

5. **Cardio "Ellittica" non loggabile** — mancava in `ACTIVITY_META`, quindi le
   sessioni di ellittica venivano marcate come "Corsa" e non c'era il bottone nel
   logger. Aggiunta col tipo 🔄 (#5AC8FA), coerente con storico/dieta/coach.
   File: `screens/dashboard.jsx`.

6. **Banda scura in fondo nella PWA iOS** — `#root` aveva
   `position:fixed; inset:0` **ma anche** `height:100dvh`. Con `position:fixed`
   una `height` esplicita vince su `bottom:0` e ancora il root solo in alto:
   nella zona della home-indicator restava scoperto il `body` (`--bg`, quasi
   nero) = la barra scura sotto la TabBar. **Fix**: ancorato `#root` a tutti e
   quattro i bordi (`top/right/bottom/left:0`, niente `height`), così riempie
   tutto il viewport e il `padding-bottom: env(safe-area-inset-bottom)` della
   TabBar colora la home-indicator. File: `index.html`.

---

## ✅ Sessione 12 giugno 2026 (pomeriggio) — tema sistema + i18n EN + light theme

Tutte modifiche nei **file locali** (deploy da fare dal Mac). Sintassi verificata
con `@babel/preset-react` su tutti i 16 file JSX + cross-check automatico:
le 193 chiavi `t()` statiche usate nelle schermate sono tutte coperte dal dizionario.

1. **Tema segue il sistema (Mac/iOS)** — default cambiato da `"dark"` a
   `"system"`; `_applyTheme` ora aggiorna anche `<meta name="theme-color">`
   (#0a0a0a / #f2f2f7); aggiunto listener live su `prefers-color-scheme` (se il
   sistema passa a scuro/chiaro mentre l'app è aperta, si riallinea da sola);
   script anti-flash in `<head>` di `index.html` che applica il tema di sistema
   prima del mount React. `color-scheme: dark/light` in `styles.css` per form
   control nativi coerenti. File: `app.jsx`, `index.html`, `styles.css`.
   NB: chi aveva salvato un tema esplicito lo mantiene; basta scegliere "Auto"
   in Impostazioni → Aspetto.

2. **Light theme — sfondi hardcoded sistemati** — nuove variabili `--nav-bg`
   (TabBar + barra input Coach, prima `rgba(20,20,22,…)` fisso) e `--track`
   (binari delle barre di progresso, prima `rgba(255,255,255,0.08)` fisso:
   dashboard, spesa, onboarding). Ago del DayTimeSlider e griglia Recharts ora
   theme-aware. File: `styles.css`, `nav.jsx`, `screens/coach.jsx`,
   `screens/dashboard.jsx`, `screens/spesa.jsx`, `screens/onboarding.jsx`,
   `screens/dieta.jsx`, `screens/storico.jsx`.

3. **i18n EN completata** — dizionario passato da ~270 a ~430 voci: Impostazioni
   (tutte le sezioni, modale reset, sync), Storico, Coach (saluto, quick prompt,
   errori), Dieta (slider giornata, titoli pasti, orari integratori), Spesa
   (frequenza, "se esaurito", Dispensa), Scheda (avvisi check-in, tooltip RPE,
   macchina occupata, salvataggio) e i ~60 nomi esercizio/alternative della
   scheda fallback. Stringhe prima hardcoded ora passano da `t()`; i giorni della
   settimana (GymCard) usano il locale corrente. File: `i18n.jsx` + tutte le screen.

4. **Coach AI bilingue** — il system prompt ora dice al modello di rispondere
   nella lingua dell'app (IT/EN). File: `screens/coach.jsx`.

5. **Saluto dinamico in Dashboard** — "Buongiorno / Buon pomeriggio / Buonasera
   Lorenzo" in base all'ora (prima sempre "Buongiorno"). File: `screens/dashboard.jsx`.

6. **Rules of Hooks** — il bottone "Sincronizza ora" usava `useState` dentro una
   IIFE nel render di Impostazioni (fragile): estratto nel componente dedicato
   `SyncNowRow`. File: `screens/impostazioni.jsx`.

7. Versione UI: **v2.6.0 · build 2026.06**.

---

## 🔧 Problemi ancora APERTI / da verificare

- **[DA VERIFICARE SU IPHONE]** Banda scura in basso: il fix strutturale
  (`#root` ancorato ai 4 bordi) è nei file locali ma **lo screenshot del 12/06
  mostra ancora la build vecchia deployata**. Procedura: lanciare il deploy →
  aprire la PWA → attendere il reload automatico del SW → **chiudere la PWA dal
  multitasking e riaprirla** (su iOS il SW è "appiccicoso"). Ora la TabBar usa
  `var(--nav-bg)` e assorbe la safe-area, quindi la zona home-indicator deve
  risultare dello stesso colore della TabBar.
- **Status bar iOS in tema chiaro**: `apple-mobile-web-app-status-bar-style` è
  `black-translucent` (testo bianco, fissato all'installazione). In tema light
  l'orologio di sistema può risultare poco leggibile. Eventuale fix: passare a
  `default` e re-installare la PWA (da valutare).
- **Pulizia foglio Settings (facoltativa)**: restano righe duplicate legacy di
  `spesaChecked` + chiavi di test `_diag_*` / `_test_sync`. Ignorate (la spesa usa
  `spesaChecked2`), ma cancellabili a mano dal Google Sheet.
- **Fix definitivo Apps Script (facoltativo)**: rendere `_getSettings` "first-wins"
  e/o `_saveSettings` dedup delle righe, per evitare in futuro il problema dei
  duplicati. Richiede re-deploy del Web App da `script.google.com`.
- **Indicatore visivo di sync** in corso/completato nell'app (nice-to-have).
- **Merge conflitti offline** su due device (oggi last-writer-wins).
- **Nomi cibo nella Dieta/Spesa**: restano in italiano anche in EN (sono dati del
  piano alimentare, non UI). Traducibili in futuro se serve.

---

## Service Worker — stato
- `sw.js`: `CACHE_NAME = "fitness-hub-v3-<timestamp>"` (bumpato a ogni deploy).
- HTML: network-first. File statici: network-first con fallback cache (offline).
  API (hostname diverso): sempre rete.
- `skipWaiting()` + `clients.claim()` + reload su `controllerchange` in index.html.
  Su iOS il SW resta "appiccicoso": serve chiudere/riaprire la PWA una volta.

---

## Deploy — workflow
Doppio click su **`Deploy GitHub Pages.command`** (gira sul Mac con le credenziali
git). Lo script:
1. Rimuove eventuali lock git residui (`index.lock`, `HEAD.lock`, ecc.).
2. Bumpa `CACHE_NAME` in `sw.js` (timestamp).
3. Bumpa tutti i `?v=...` in `index.html` (timestamp) — cache-busting asset.
4. `git add -A` → commit → `git push origin main`.

⚠️ **Da un agente/sandbox NON si può committare/pushare**: niente credenziali
GitHub e la `.git` è in sola-scrittura limitata. Un agente può solo **modificare i
file locali**; il deploy va fatto da Lorenzo sul Mac con lo script.

Comandi utili:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App
rm -f .git/index.lock .git/HEAD.lock   # se git si blocca
```

---

## AI Coach (coach.jsx) — `_buildSystemPrompt`
Include: peso, settimana mesociclo, sessione di oggi, data/ora + momento del
giorno, check-in (sonno/energia/fastidi + alert recupero), idratazione, cardio
recente, note scheda del giorno, `schedaData` e `dietaData` da storage (fino 3000
char, fallback hardcoded). Esclude SEMPRE dalla dieta: pasta di ceci, lenticchie,
piselli, bevanda di mandorla.

## Tema / CSS
Dark default, light con classe `theme-light` su `<html>`. Variabili:
`--bg --bg-2 --card --card-2 --card-3 --text --text-2 --text-3 --border --accent
--accent-2 --success --warning --danger`. Prop `device` ("mobile"|"desktop") su
tutti i componenti. Layout root: `.lfh`, `.lfh-scroll`, `.lfh-status`.

## Schede allenamento (riferimento)
Split Upper/Lower 3×/settimana su mesociclo di 8 settimane:
Upper A (Lun), Lower (Mer), Upper B (Ven). Cardio (camminata + ellittica) nei
giorni di riposo. `getTodaySession()` mappa: Lun→Upper A, Mer→Lower, Ven→Upper B,
resto→riposo.
