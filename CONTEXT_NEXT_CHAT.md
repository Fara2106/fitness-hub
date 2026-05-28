# Contesto progetto: Lorenzo Fitness Hub
Sono Lorenzo Faraoni (lorefara97@gmail.com). Sto sviluppando una PWA fitness personale chiamata **Lorenzo Fitness Hub**, hostata su GitHub Pages: `https://fara2106.github.io/fitness-hub`. Repository: `https://github.com/fara2106/fitness-hub`. Cartella locale: `~/Documents/Web Apps/Fitness App/`.

---

## Stack tecnico — VINCOLI CRITICI (non modificare mai)
- **React 18 via CDN + Babel standalone** — tutti i componenti esposti come `window.ComponentName`. MAI usare import/export ES module.
- **`window.storage`** (IndexedDB-backed, sincrono dopo init) — MAI usare `localStorage` o `sessionStorage`.
- **Nessun tag HTML `<form>`** — solo `onClick`/`onChange`.
- **Nessun bundler** — i file JSX vengono caricati in ordine dall'`index.html` tramite `<script type="text/babel">`.

---

## Architettura backend

### Google Apps Script (backend REST)
- **URL deployment attivo**: `https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec`
- Versione deployata: **v5**
- Fogli Google Sheets: `PesoCorporeo`, `SerieAllenamento`, `Sessioni`, `Movimenti`, `CheckIn`, `Settings` (Key | Value)

### Cloudflare Worker (proxy CORS)
- **URL proxy**: `https://fitness-hub-proxy.lorefara97.workers.dev`
- Tutte le chiamate ad Apps Script passano per questo proxy

### api.jsx — window.sheetsAPI e window.groqAPI
```javascript
window.sheetsAPI.getPesi()
window.sheetsAPI.getPesoCorporeo()
window.sheetsAPI.getUltimiPesi()
window.sheetsAPI.getCheckIn(date?)
window.sheetsAPI.savePeso(d)
window.sheetsAPI.savePesoCorporeo(d)
window.sheetsAPI.saveSessione(d)
window.sheetsAPI.saveMovimento(d)
window.sheetsAPI.saveCheckIn(d)
window.sheetsAPI.getSettings()        // → { key: value, ... } flat object
window.sheetsAPI.saveSettings(d)      // { key, value }
window.sheetsAPI.testConnection()
window.groqAPI.complete({ messages, systemPrompt, model, maxTokens })
window.playBeep(freq, duration, gain)
window.todayKey()                     // → "YYYY-MM-DD"
window.getTodaySession()              // → { id, label, muscles, muscleKeys } | null
// Upper A = lunedì, Lower = mercoledì, Upper B = venerdì
```

---

## Sync cross-device — STATO ATTUALE (post-fix)

### Cosa viene sincronizzato via foglio Settings:
| Chiave | Push | Pull |
|---|---|---|
| `groqApiKey` | Impostazioni → salva | `_cloudSync()` — cloud wins sempre |
| `schedaData` | Carica file .txt | `_cloudSync()` |
| `dietaData` | Carica file .txt | `_cloudSync()` |
| `spesaChecked` | Toggle checkbox (lifted a AppFrame) | `_cloudSync()` + foreground |
| `spesaFreq` | Cambio frequenza (lifted a AppFrame) | `_cloudSync()` + foreground |
| `bodyWeight` | Ogni modifica | `_cloudSync()` |
| `weekNum` | Ogni modifica | `_cloudSync()` |
| `onboardingDone` | Prima volta che si setta (push cloud) | `_cloudSync()` |

### Logica `_cloudSync(opts)` — riscritta in questa sessione:
- Ogni chiamata (`getPesoCorporeo`, `getSettings`) ha il suo **timeout individuale** tramite `_safe(promise, ms)`
- `pesiMs = 8000`, `settingsMs = 15000` (startup) | `pesiMs = 6000`, `settingsMs = 8000` (foreground)
- **`Promise.all`** aspetta entrambe — nessun race globale che svuota lo storage
- onboarding auto-bypass: `hasGroq || hasBW` (OR, non AND come prima)
- `onboardingDone = "true"` pushato al cloud la prima volta che viene impostato
- Foreground re-sync aggiorna anche `spesaChecked` e `spesaFreq` in stato React

### Bug risolto in questa sessione (root cause):
La struttura precedente era `Promise.allSettled(...)` dentro `Promise.race(..., setTimeout(4000))`.
Google Apps Script ha un **cold start di 2-5 secondi** → il timer da 4s vinceva la race prima che `getSettings` finisse → `initState()` partiva con storage vuoto → onboarding ad ogni apertura su iPhone.

### Stato attuale git:
- Ultimo commit: `6aba5dc` — "fix: sync mobile - timeout individuali, OR onboarding, push onboardingDone cloud"
- **⚠️ VERIFICARE**: fare `git push origin main` se non ancora fatto

---

## Struttura file
```
~/Documents/Web Apps/Fitness App/
├── index.html              # Entry point, carica tutti i JSX in ordine
├── styles.css              # CSS globale con variabili tema dark/light
├── app.jsx                 # AppFrame, routing, stato globale, cloud sync
├── api.jsx                 # sheetsAPI, groqAPI, playBeep, todayKey
├── storage.jsx             # window.storage (IndexedDB wrapper)
├── i18n.jsx                # LangContext, useT(), traduzioni it/en
├── icons.jsx               # window.Icon component (SVG icons)
├── nav.jsx                 # TabBar (mobile), Sidebar (desktop)
├── parser.jsx              # Parser scheda.txt e dieta.txt
├── anatomy.jsx             # Componente anatomia muscolare
├── design-canvas.jsx       # Canvas per design tweaks
├── tweaks-panel.jsx        # Pannello tweaks UI
├── google-apps-script.gs   # Codice Apps Script (v5, deployato)
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
└── screens/
    ├── dashboard.jsx
    ├── scheda.jsx
    ├── dieta.jsx
    ├── spesa.jsx           # ← spesaChecked/spesaFreq ora lifted a AppFrame
    ├── coach.jsx           # ← ora legge schedaData/dietaData da storage + ora del giorno
    ├── storico.jsx
    ├── impostazioni.jsx
    └── onboarding.jsx
```

---

## window.storage — API
```javascript
window.storage.get(key, defaultValue)   // sincrono dopo init (legge da cache in-memory)
window.storage.set(key, value)          // sincrono in-memory + async persist su IndexedDB
window.storage.clear()
window.storage.isReady()                // boolean
window.storage.onReady(callback)
```

### Schemi dati in storage
```javascript
storage.get(`checkIn_${YYYY-MM-DD}`, { sleep: 4, energy: 4, ailments: "" })
storage.get(`hydration_${YYYY-MM-DD}`, 3)
storage.get("activities", [])
storage.get("schedaData", null)
storage.get("dietaData", null)
storage.get("spesaChecked", {})         // { "proteine-0": true, ... }
storage.get("spesaFreq", 1)             // 1 o 2
storage.get("bodyWeight", 100)
storage.get("weekNum", 1)               // 1-8
storage.get("theme", "dark")
storage.get("lang", "it")
storage.get("groqApiKey", "")
storage.get("onboardingDone", false)
```

---

## Stato AppFrame (app.jsx)
```javascript
{
  screen, scheda, isHome,
  activities, checkIn, hydration,
  weekNum, bodyWeight, theme,
  spesaChecked,   // ← lifted in questa sessione
  spesaFreq,      // ← lifted in questa sessione
}
```
`setState` in AppFrame persiste + synca al cloud ogni cambio rilevante.

---

## AI Coach (coach.jsx) — stato attuale
`_buildSystemPrompt` ora include:
- Ora attuale + momento della giornata (mattina/pranzo/pomeriggio/sera)
- `schedaData` da storage (fino a 3000 chars) se caricato
- `dietaData` da storage (fino a 3000 chars) se caricato
- checkIn, idratazione, cardio recente, note sessione
- Fallback hardcoded se i file non sono caricati

---

## Tema e CSS
- Dark mode default, light mode con classe `theme-light` su `<html>`
- Classi utility: `.card`, `.card.lift`, `.btn`, `.btn.ghost`, `.pill`, `.num`, `.muted`, `.bar`, `.fade-up`, `.spinner`, `.input`, `.input-mono`, `.ios-list`, `.row`, `.check`, `.check.on`
- Variabili: `--bg`, `--card`, `--card-2`, `--card-3`, `--text`, `--text-2`, `--text-3`, `--border`, `--accent`, `--success`, `--danger`
- Prop `device` su tutti i componenti: `"mobile"` | `"desktop"`

---

## PWA
- `manifest.json`: `start_url: "/fitness-hub/"`, `scope: "/fitness-hub/"`, `display: "standalone"`
- `sw.js`: tutti i path asset prefissati con `/fitness-hub`
- `index.html`: `navigator.serviceWorker.register('./sw.js')` (path relativo)
- StatusBar nascosta se PWA installata (`_isStandalone`)

---

## ⚠️ BUG NOTI / PROSSIMI FIX

### 1. Versione mobile ancora non aggiornata
La PWA su iPhone ha cache aggressiva dal Service Worker. Dopo ogni push bisogna:
- Aggiornare il `CACHE_VERSION` in `sw.js` per invalidare la cache
- **Oppure**: l'utente deve fare "Rimuovi dal Home Screen" + reinstallare (workaround)
- **Fix da fare**: incrementare automaticamente il version hash in `sw.js` a ogni deploy

### 2. Possibili bug su mobile da verificare
- Onboarding ancora comparso su iPhone dopo il fix? → verificare che `onboardingDone` venga pushato al cloud correttamente
- `spesaChecked` si sincronizza in entrambe le direzioni?
- Coach riceve `schedaData`/`dietaData` correttamente?
- Eventuali errori JavaScript specifici di Safari/WebKit

### 3. Service Worker cache busting
Il `sw.js` attuale usa un `CACHE_VERSION` statico. Ogni volta che si deploya, bisogna incrementarlo manualmente. Questo causa il problema "versione mobile non aggiornata". Considerare:
- Script di build che aggiorna automaticamente il version string
- O usare `skipWaiting()` + `clients.claim()` in modo più aggressivo

---

## Comandi utili
```bash
# Push a GitHub Pages
cd ~/Documents/Web\ Apps/Fitness\ App && git add -A && git commit -m "messaggio" && git push origin main

# Rimuovere lock se bloccato
rm -f ~/Documents/Web\ Apps/Fitness\ App/.git/index.lock
```
