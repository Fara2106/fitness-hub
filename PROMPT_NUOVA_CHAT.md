# Contesto progetto: Lorenzo Fitness Hub

Sono Lorenzo Faraoni (lorefara97@gmail.com). Sto sviluppando una PWA fitness personale chiamata **Lorenzo Fitness Hub**, hostata su GitHub Pages all'indirizzo `https://fara2106.github.io/fitness-hub`. Il repository è `https://github.com/fara2106/fitness-hub`. La cartella locale è `~/Documents/Web Apps/Fitness App/`.

---

## Stack tecnico — VINCOLI CRITICI (non modificare mai)

- **React 18 via CDN + Babel standalone** — tutti i componenti sono esposti come `window.ComponentName` (es. `window.AppFrame`, `window.Dashboard`, ecc.). MAI usare import/export ES module.
- **`window.storage`** (IndexedDB-backed, asincrono) — MAI usare `localStorage` o `sessionStorage`.
- **Nessun tag HTML `<form>`** — solo `onClick`/`onChange`.
- **Nessun bundler** — i file JSX vengono caricati direttamente nell'index.html tramite `<script type="text/babel">`.
- I file JSX vengono caricati in ordine nell'index.html; ogni componente deve essere definito prima di essere usato.

---

## Architettura backend

### Google Apps Script (backend REST)
- **URL deployment attivo**: `https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec`
- Versione deployata: **v5** (include `getSettings`/`saveSettings`)
- Fogli Google Sheets:
  - `PesoCorporeo` — Data | Peso
  - `SerieAllenamento` — Data | Esercizio | SetN | Peso | Rip | RPE | Sessione | Settimana
  - `Sessioni` — Data | Tipo | Settimana | SerieCompletate | SerieTotal | Note | OraInizio
  - `Movimenti` — Data | Tipo | Minuti | Km | Note
  - `CheckIn` — Data | Sonno | Energia | Fastidi
  - `Settings` — Key | Value (sync cross-device)

### Cloudflare Worker (proxy CORS)
- **URL proxy**: `https://fitness-hub-proxy.lorefara97.workers.dev`
- Tutte le chiamate a Apps Script passano per questo proxy

### api.jsx — window.sheetsAPI e window.groqAPI
```javascript
// Endpoints disponibili:
window.sheetsAPI.getPesi()
window.sheetsAPI.getPesoCorporeo()
window.sheetsAPI.getUltimiPesi()
window.sheetsAPI.getCheckIn(date?)
window.sheetsAPI.savePeso(d)           // { date, esercizio, setN, peso, rip, rpe, sessione, weekNum }
window.sheetsAPI.savePesoCorporeo(d)   // { date, weight }
window.sheetsAPI.saveSessione(d)       // { date, type, weekNum, setsCompleted, totalSets, notes }
window.sheetsAPI.saveMovimento(d)      // { date, type, min, km, note }
window.sheetsAPI.saveCheckIn(d)        // { date, sleep, energy, ailments }
window.sheetsAPI.getSettings()         // → { key: value, ... }
window.sheetsAPI.saveSettings(d)       // { key, value }
window.sheetsAPI.testConnection()

window.groqAPI.complete({ messages, systemPrompt, model, maxTokens })
window.playBeep(freq, duration, gain)
window.todayKey()   // → "YYYY-MM-DD"
window.getTodaySession()  // → { id, label, muscles, muscleKeys } oppure null (giorno riposo)
// Upper A = lunedì, Lower = mercoledì, Upper B = venerdì
```

---

## Sync cross-device (completamente implementato)

Il foglio **Settings** (key-value) su Google Sheets è il backend di sync.

### Cosa viene sincronizzato:
| Chiave | Push automatico | Pull automatico |
|---|---|---|
| `groqApiKey` | Quando salvata in Impostazioni | Avvio + foreground |
| `schedaData` | Quando file .txt caricato | Avvio + foreground |
| `dietaData` | Quando file .txt caricato | Avvio + foreground |
| `spesaChecked` | Ogni toggle checkbox spesa | Avvio + foreground |
| `spesaFreq` | Quando cambia frequenza spesa | Avvio + foreground |
| `bodyWeight` | Ogni modifica peso | Avvio + foreground |
| `weekNum` | Ogni modifica settimana | Avvio + foreground |

### Logica in app.jsx:
- `_cloudSync()` gira all'avvio e ogni volta che l'app torna in primo piano (Page Visibility API), con timeout 4s
- Se `bodyWeight > 0` e `groqApiKey` presenti in cloud → `onboardingDone = true` automaticamente (salta onboarding su nuovi device)
- `setState` in AppFrame pusha ogni cambio di `bodyWeight`, `weekNum`, `checkIn` al cloud

---

## PWA

- `manifest.json`: `start_url: "/fitness-hub/"`, `scope: "/fitness-hub/"`, `display: "standalone"`
- `sw.js`: tutti i path asset prefissati con `/fitness-hub`
- `index.html`: `navigator.serviceWorker.register('./sw.js')` (path relativo, non assoluto)
- **StatusBar** (barra fake "9:41"): nascosta se installata come PWA:
```javascript
const _isStandalone = window.navigator.standalone === true
  || window.matchMedia("(display-mode: standalone)").matches;
const StatusBar = () => _isStandalone ? null : <div className="lfh-status">...</div>;
```

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
├── google-apps-script.gs   # Codice Apps Script (v5, già deployato)
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker
└── screens/
    ├── dashboard.jsx       # Home con check-in, attività, peso
    ├── scheda.jsx          # Scheda allenamento (legge schedaData da storage)
    ├── dieta.jsx           # Piano alimentare (legge dietaData da storage)
    ├── spesa.jsx           # Lista spesa con categorie e frequenza
    ├── coach.jsx           # AI Coach (usa groqAPI)
    ├── storico.jsx         # Storico allenamenti
    ├── impostazioni.jsx    # Impostazioni (API key, file upload, tema, reset)
    └── onboarding.jsx      # Onboarding prima apertura
```

---

## window.storage — API

```javascript
window.storage.get(key, defaultValue)   // legge (sincrono dopo init)
window.storage.set(key, value)          // scrive
window.storage.clear()                  // resetta tutto
window.storage.isReady()               // boolean
window.storage.onReady(callback)        // callback quando pronto
```

## Schemi dati in storage

```javascript
storage.get(`checkIn_${YYYY-MM-DD}`, { sleep: 4, energy: 4, ailments: "" })
storage.get(`hydration_${YYYY-MM-DD}`, 3)
storage.get("activities", [])        // array { id, type, when, ... }
storage.get("schedaData", null)      // testo grezzo scheda.txt
storage.get("dietaData", null)       // testo grezzo dieta.txt
storage.get("spesaChecked", {})      // es. { "proteine-0": true }
storage.get("spesaFreq", 1)          // 1 o 2 volte/settimana
storage.get("bodyWeight", 100)
storage.get("weekNum", 1)            // settimana corrente 1-4
storage.get("theme", "dark")         // "dark" | "light" | "system"
storage.get("lang", "it")            // "it" | "en"
storage.get("groqApiKey", "")
storage.get("onboardingDone", false)
```

---

## Tema e CSS

- Dark mode di default, light mode tramite classe `theme-light` su `<html>`
- Classi utility: `.card`, `.card.lift`, `.btn`, `.btn.ghost`, `.pill`, `.num`, `.muted`, `.bar`, `.fade-up`, `.spinner`, `.input`, `.input-mono`, `.ios-list`, `.row`, `.check`, `.check.on`
- Variabili: `--bg`, `--card`, `--card-2`, `--card-3`, `--text`, `--text-2`, `--text-3`, `--border`, `--accent`, `--success`, `--danger`
- Layout root: `.lfh` (root flex column), `.lfh-scroll` (scroll area), `.lfh-status` (status bar)
- Prop `device` su tutti i componenti: `"mobile"` | `"desktop"`

---

## Stato attuale ✅

- PWA installabile e funzionante su iPhone e desktop
- Sync cross-device implementato e testato (getSettings risponde correttamente)
- Apps Script v5 deployato sul deployment corretto (`AKfycbz7...`)
- Push/pull automatico di tutti i dati principali
- Re-sync automatico quando l'app torna in primo piano

## Pending ⚠️

**git push** — app.jsx ha modifiche staged non ancora pushate (re-sync foreground + auto-push bodyWeight/weekNum). Per applicare:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App && rm -f .git/index.lock && git config user.email "lorefara97@gmail.com" && git config user.name "Lorenzo Faraoni" && git commit -m "sync: auto-push bodyWeight/weekNum, re-sync on foreground" && git push origin main
```
