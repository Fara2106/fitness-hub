# Contesto progetto: Lorenzo Fitness Hub

Sono Lorenzo Faraoni (lorefara97@gmail.com). Sto sviluppando una PWA fitness personale chiamata **Lorenzo Fitness Hub**, hostata su GitHub Pages.

- **URL app**: `https://fara2106.github.io/fitness-hub/`
- **Repo**: `https://github.com/fara2106/fitness-hub`
- **Cartella locale**: `~/Documents/Web Apps/Fitness App/`
- **Ultimo commit noto**: `2aae01c` (29 mag 2026)

---

## Stack tecnico — VINCOLI CRITICI (non modificare mai)

- **React 18 via CDN + Babel standalone** — tutti i componenti esposti come `window.ComponentName` (es. `window.AppFrame`, `window.Dashboard`). MAI usare import/export ES module.
- **`window.storage`** (IndexedDB-backed, sincrono dopo init) — MAI usare `localStorage`/`sessionStorage`.
- **Nessun tag HTML `<form>`** — solo `onClick`/`onChange`.
- **Nessun bundler** — i file JSX caricati in ordine da `index.html` via `<script type="text/babel" src="...?v=BUILD">`.

---

## Architettura backend

### Google Apps Script (backend REST)
- **URL deployment**: `https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec`
- Fogli Google Sheets: `PesoCorporeo` (Data|Peso), `SerieAllenamento`, `Sessioni`, `Movimenti`, `CheckIn`, `Settings` (Key|Value).
- `Settings._saveSettings` fa upsert per chiave; `_getSettings` collassa le righe in un oggetto flat.

### Cloudflare Worker (proxy CORS)
- **URL proxy**: `https://fitness-hub-proxy.lorefara97.workers.dev`
- Proxy semplice (NON cachea): GET → inoltra querystring ad Apps Script; POST → inoltra il body. Tutte le chiamate ad Apps Script passano da qui.

### api.jsx — window.sheetsAPI / window.groqAPI
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
NB: `sheetsAPI.get()` ora aggiunge sempre `_cb=Date.now()` + `fetch(..., {cache:"no-store"})` per evitare risposte GET stale dalla cache HTTP (vedi sotto).

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
├── Deploy GitHub Pages.command  ← script di deploy (vedi sotto)
└── screens/ dashboard.jsx, scheda.jsx, dieta.jsx, spesa.jsx, coach.jsx, storico.jsx, impostazioni.jsx, onboarding.jsx
```

---

## window.storage — API + dati
```javascript
window.storage.get(key, def) / set(key, value) / remove(key) / clear() / isReady() / onReady(cb)
```
Chiavi: `checkIn_YYYY-MM-DD`, `hydration_YYYY-MM-DD`, `activities`, `schedaData`, `dietaData`,
`spesaChecked` (locale resta questo nome), `spesaFreq`, `bodyWeight`, `weekNum`, `theme`, `lang`,
`groqApiKey`, `onboardingDone`, `profile`, `weightLog`.

---

## Sync cross-device — architettura attuale (foglio Settings)

| Chiave cloud | Push locale→cloud | Pull cloud→locale |
|---|---|---|
| `groqApiKey` | Impostazioni (con retry) | `_cloudSync` — cloud wins |
| `schedaData` / `dietaData` | Upload file .txt (con retry) | `_cloudSync` |
| **`spesaChecked2`** | ogni toggle (AppFrame setState) + retry | `_cloudSync` (retro-compat: `s.spesaChecked2 || s.spesaChecked`) |
| `spesaFreq` | cambio frequenza | `_cloudSync` |
| `bodyWeight` / `weekNum` | ogni modifica | `_cloudSync` |
| `onboardingDone` | prima volta | `_cloudSync` |

- **`_cloudSync(opts)`**: legge `getPesoCorporeo` + `getSettings` con timeout individuali (`_safe`). Se il pull settings FALLISCE → `cloudKeys=null` e NON pusha (anti-clobber). Auto-skip onboarding se `hasGroq || hasBW`.
- **`_cloudPushMissing(cloudKeys)`**: pusha (con retry) solo chiavi presenti in locale ma assenti nel cloud, e SOLO se il pull è riuscito.
- **Pull periodico ogni 45s** mentre l'app è visibile + ri-sync su `visibilitychange` (foreground).
- Dati allenamento/cardio/checkin: letti dal vivo dal cloud nelle schermate Storico/Scheda (`getCheckIn`, `getPesoCorporeo`, `getUltimiPesi`).

---

## ⚠️ BUG RISOLTI in questa sessione (tutti deployati e verificati)

1. **storage.jsx — race scritture**: le `set()` prima che IndexedDB fosse pronto andavano perse. Aggiunta coda `_pending` drenata all'apertura del DB (senza sovrascrivere scritture recenti).
2. **Push cloud inaffidabile**: i push erano fire-and-forget; un errore di rete cancellava il dato. Aggiunto `_saveSettingRetry` (2 retry), usato da `_cloudPushMissing`, `_cloudPushAll` e dagli handler in Impostazioni (chiave Groq + import file).
3. **Anti-clobber**: se il pull settings falliva, il codice ripushava dati locali stale sovrascrivendo il cloud. Ora `cloudKeys=null` ⇒ niente push.
4. **Spesa non sincronizzava — righe duplicate**: nel foglio `Settings` esistono righe DUPLICATE per la chiave `spesaChecked` (il salvataggio aggiorna la prima riga, la lettura restituisce l'ultima riga stale = `{proteine-3:true}` fantasma). **Aggirato** spostando la spesa sulla chiave cloud pulita **`spesaChecked2`** (lo storage locale resta `spesaChecked`). Pull retro-compatibile.
5. **GET cachate (causa generale di sync inaffidabile)**: gli `<script src>` e le `getSettings` venivano serviti dalla cache HTTP/Fastly/SW → girava codice/dati vecchi. Risolto con:
   - `sheetsAPI.get()`: `_cb=Date.now()` + `cache:"no-store"`.
   - **Versioning asset**: ogni `<script>`/`css` in `index.html` ha `?v=BUILD`, bumpato a un timestamp a ogni deploy → URL unici che battono ogni cache.
   - **Service Worker** passato da stale-while-revalidate a **network-first** per i file statici; `CACHE_NAME` bumpato a ogni deploy.
6. **Sync automatico**: aggiunto pull periodico ogni 45s (solo se l'app è visibile), oltre a startup + foreground.
7. **Barre nere safe-area**: rimosso `padding-top/bottom: env(safe-area-inset-*)` da `.lfh.mobile`; la `StatusBar` riempie il notch (spacer `var(--bg)` in standalone) e la `TabBar` assorbe l'inset inferiore nel proprio sfondo.
8. **Banda nera grande sotto la tab bar (iPhone PWA)**: NON era la safe-area ma `height:100%` che non riempiva il viewport standalone iOS (~300px di nero). Risolto con `#root { position: fixed; inset: 0; height: 100dvh; }` in `index.html`.

### Verifiche fatte (Chrome desktop, simulando 2 device)
- Spesa: **pull** (device A scrive nel cloud → device B al load riceve) ✓ e **push** (toggle UI → cloud `spesaChecked2`) ✓.
- `groqApiKey`, `schedaData`, `dietaData` confermati presenti nel cloud (seeding ok).

---

## Service Worker — stato
- `sw.js`: `CACHE_NAME = "fitness-hub-v3-<timestamp>"` (bumpato a ogni deploy dallo script).
- HTML: network-first. File statici: **network-first** con fallback cache (offline). API (hostname diverso): sempre rete.
- `skipWaiting()` + `clients.claim()` + reload su `controllerchange` in index.html. Su iOS il SW resta "appiccicoso": serve chiudere/riaprire la PWA una volta per adottarlo.

---

## Deploy — workflow
Doppio click su **`Deploy GitHub Pages.command`** (gira sul Mac con le credenziali git). Lo script ora:
1. Rimuove eventuali lock git residui (`index.lock`, `HEAD.lock`, `config.lock`, `refs/heads/*.lock`).
2. Bumpa `CACHE_NAME` in `sw.js` (timestamp).
3. Bumpa tutti i `?v=...` in `index.html` (timestamp) — cache-busting asset.
4. `git add -A` → commit → `git push origin main`.

⚠️ Da un agente/sandbox NON si può committare/pushare: niente credenziali GitHub e la `.git` è in sola-scrittura limitata (lascia lock orfani). Usare sempre lo script sul Mac.

Comandi utili:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App
rm -f .git/index.lock .git/HEAD.lock   # se git si blocca
```

---

## 🔧 TODO / note aperte
- **Pulizia foglio Settings (facoltativa)**: restano righe duplicate legacy di `spesaChecked` + chiavi di test `_diag_*` e `_test_sync`. Sono ignorate (la spesa usa `spesaChecked2`), ma si possono cancellare a mano dal Google Sheet.
- **Fix definitivo Apps Script (facoltativo)**: rendere `_getSettings` "first-wins" e/o `_saveSettings` dedup delle righe, per evitare in futuro il problema dei duplicati su qualsiasi chiave. Richiede re-deploy del Web App da `script.google.com`.
- **iPhone**: dopo ogni deploy, chiudere la PWA dal multitasking e riaprirla (1 volta) per caricare gli asset versionati nuovi. Verificare su device reale che la banda nera in basso sia sparita.
- Eventuale indicatore visivo di sync in corso/completato nell'app.
- Gestione conflitti merge se lo stesso campo è modificato su due device offline (oggi last-writer-wins).

---

## AI Coach (coach.jsx) — `_buildSystemPrompt`
Include: peso, settimana mesociclo, sessione di oggi, data/ora + momento del giorno, check-in (sonno/energia/fastidi + alert recupero), idratazione, cardio recente, note scheda del giorno, `schedaData` e `dietaData` da storage (fino 3000 char, fallback hardcoded).

## Tema / CSS
Dark default, light con classe `theme-light` su `<html>`. Variabili: `--bg --card --card-2 --card-3 --text --text-2 --text-3 --border --accent --success --danger`. Prop `device` ("mobile"|"desktop") su tutti i componenti. Layout root: `.lfh`, `.lfh-scroll`, `.lfh-status`.
