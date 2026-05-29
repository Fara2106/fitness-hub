# Contesto progetto: Lorenzo Fitness Hub

Sono Lorenzo Faraoni (lorefara97@gmail.com). Sto sviluppando una PWA fitness personale chiamata **Lorenzo Fitness Hub**, hostata su GitHub Pages: `https://fara2106.github.io/fitness-hub`. Repository: `https://github.com/fara2106/fitness-hub`. Cartella locale: `~/Documents/Web Apps/Fitness App/`.

---

## Stack tecnico — VINCOLI CRITICI (non modificare mai)
- **React 18 via CDN + Babel standalone** — tutti i componenti esposti come `window.ComponentName` (es. `window.AppFrame`, `window.Dashboard`). MAI usare import/export ES module.
- **`window.storage`** (IndexedDB-backed, sincrono dopo init) — MAI usare `localStorage` o `sessionStorage`.
- **Nessun tag HTML `<form>`** — solo `onClick`/`onChange`.
- **Nessun bundler** — i file JSX vengono caricati in ordine dall'`index.html` tramite `<script type="text/babel">`.

---

## Architettura backend

### Google Apps Script (backend REST)
- **URL deployment attivo**: `https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec`
- Versione deployata: **v5**
- Fogli Google Sheets: `PesoCorporeo` (Data|Peso), `SerieAllenamento`, `Sessioni`, `Movimenti`, `CheckIn`, `Settings` (Key|Value)

### Cloudflare Worker (proxy CORS)
- **URL proxy**: `https://fitness-hub-proxy.lorefara97.workers.dev`
- Tutte le chiamate ad Apps Script passano per questo proxy

### api.jsx — window.sheetsAPI e window.groqAPI
```javascript
window.sheetsAPI.getPesi()
window.sheetsAPI.getPesoCorporeo()        // → [{ date, weight }, ...]
window.sheetsAPI.getUltimiPesi()
window.sheetsAPI.getCheckIn(date?)
window.sheetsAPI.savePeso(d)              // { date, esercizio, setN, peso, rip, rpe, sessione, weekNum }
window.sheetsAPI.savePesoCorporeo(d)      // { date, weight }
window.sheetsAPI.saveSessione(d)          // { date, type, weekNum, setsCompleted, totalSets, notes }
window.sheetsAPI.saveMovimento(d)         // { date, type, min, km, note }
window.sheetsAPI.saveCheckIn(d)           // { date, sleep, energy, ailments }
window.sheetsAPI.getSettings()            // → { key: value, ... }  flat object
window.sheetsAPI.saveSettings(d)          // { key, value }
window.sheetsAPI.testConnection()
window.groqAPI.complete({ messages, systemPrompt, model, maxTokens })
window.playBeep(freq, duration, gain)
window.todayKey()                         // → "YYYY-MM-DD"
window.getTodaySession()                  // → { id, label, muscles, muscleKeys } | null
// Upper A = lunedì, Lower = mercoledì, Upper B = venerdì
window._cloudPushAll()                    // → Promise — pusha tutto locale → cloud
```

---

## Struttura file
```
~/Documents/Web Apps/Fitness App/
├── index.html
├── styles.css
├── app.jsx          ← AppFrame, routing, stato globale, _cloudSync, _cloudPushMissing
├── api.jsx          ← sheetsAPI, groqAPI, playBeep, todayKey, getTodaySession
├── storage.jsx      ← window.storage (IndexedDB wrapper)
├── i18n.jsx         ← LangContext, useT(), traduzioni it/en
├── icons.jsx        ← window.Icon component (SVG icons)
├── nav.jsx          ← TabBar (mobile), Sidebar (desktop)
├── parser.jsx       ← Parser scheda.txt e dieta.txt
├── anatomy.jsx      ← Componente anatomia muscolare
├── design-canvas.jsx
├── tweaks-panel.jsx
├── google-apps-script.gs   ← Codice Apps Script (v5, già deployato)
├── manifest.json
├── sw.js            ← Service Worker, CACHE_NAME = "fitness-hub-v6-20260529"
└── screens/
    ├── dashboard.jsx
    ├── scheda.jsx
    ├── dieta.jsx
    ├── spesa.jsx    ← spesaChecked/spesaFreq lifted ad AppFrame
    ├── coach.jsx    ← legge schedaData/dietaData da storage + ora del giorno
    ├── storico.jsx
    ├── impostazioni.jsx
    └── onboarding.jsx
```

---

## window.storage — API
```javascript
window.storage.get(key, defaultValue)   // sincrono dopo init (cache in-memory)
window.storage.set(key, value)          // sincrono in-memory + async persist IndexedDB
window.storage.clear()
window.storage.isReady()                // boolean
window.storage.onReady(callback)
```

### Dati in storage
```javascript
storage.get(`checkIn_${YYYY-MM-DD}`, { sleep: 4, energy: 4, ailments: "" })
storage.get(`hydration_${YYYY-MM-DD}`, 3)
storage.get("activities", [])
storage.get("schedaData", null)         // testo grezzo scheda.txt
storage.get("dietaData", null)          // testo grezzo dieta.txt
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

## Stato globale AppFrame (app.jsx)
```javascript
{
  screen, scheda, isHome,
  activities, checkIn, hydration,
  weekNum, bodyWeight, theme,
  spesaChecked,   // lifted: sync bidirezionale via AppFrame setState
  spesaFreq,      // lifted: sync bidirezionale via AppFrame setState
}
```
`setState` in AppFrame persiste in storage + pusha al cloud ogni cambio rilevante.

---

## Sync cross-device — architettura attuale

### Cosa viene sincronizzato (foglio Settings su Google Sheets):
| Chiave | Push locale→cloud | Pull cloud→locale |
|---|---|---|
| `groqApiKey` | Impostazioni → salva | `_cloudSync` — cloud wins sempre |
| `schedaData` | Upload file .txt | `_cloudSync` |
| `dietaData` | Upload file .txt | `_cloudSync` |
| `spesaChecked` | Ogni toggle (via AppFrame setState) | `_cloudSync` + foreground |
| `spesaFreq` | Cambio frequenza (via AppFrame setState) | `_cloudSync` + foreground |
| `bodyWeight` | Ogni modifica peso | `_cloudSync` |
| `weekNum` | Ogni modifica settimana | `_cloudSync` |
| `onboardingDone` | Prima volta che viene settato | `_cloudSync` |

### `_cloudSync(opts)` — logica attuale in app.jsx:
```javascript
// Ogni chiamata ha timeout individuale tramite _safe()
const [pesiRes, settingsRes] = await Promise.all([
  _safe(sheetsAPI.getPesoCorporeo(), pesiMs),     // default 8s startup, 6s foreground
  _safe(sheetsAPI.getSettings(),    settingsMs),  // default 15s startup, 8s foreground
]);
// Processa pesi → storage
// Processa settings → storage (groqApiKey, schedaData, dietaData, spesaChecked, ...)
// Auto-skip onboarding: hasGroq || hasBW  (OR, non AND)
// Push onboardingDone al cloud la prima volta
// Chiama _cloudPushMissing(cloudKeys) → pusha locale→cloud le chiavi mancanti nel cloud
```

### `_cloudPushMissing(cloudKeys)`:
Dopo ogni pull, confronta le chiavi locali con quelle ricevute dal cloud. Se esistono dati locali che il cloud non ha (es. groqApiKey inserita prima del sync), li pusha automaticamente.

### `window._cloudPushAll()`:
Pusha forzatamente TUTTO locale → cloud. Chiamato dal bottone "Sincronizza ora" in Impostazioni.

### Foreground re-sync (Page Visibility API):
Quando l'app torna in primo piano → `_cloudSync({ pesiMs: 6000, settingsMs: 8000 })` → aggiorna stato React per `bodyWeight`, `weekNum`, `checkIn`, `hydration`, `spesaChecked`, `spesaFreq`.

---

## Service Worker — stato attuale
```javascript
// sw.js
const CACHE_NAME = "fitness-hub-v6-20260529";
```
- **Install**: pre-cacha tutti i file statici, chiama `skipWaiting()`
- **Activate**: elimina vecchie cache, chiama `clients.claim()`
- **HTML navigation**: network-first (serve sempre versione fresca)
- **File statici (JSX/CSS)**: stale-while-revalidate (serve cache, aggiorna in background)
- **API calls (hostname diverso)**: sempre rete, mai cache

**⚠️ IMPORTANTE**: ad ogni deploy che modifica file JS/CSS, aggiornare `CACHE_NAME` in `sw.js` (es. incrementare la data) per invalidare la cache su iOS e forzare l'aggiornamento.

---

## AI Coach (coach.jsx) — `_buildSystemPrompt`
Include:
- Peso, settimana mesociclo, sessione di oggi, data e ora completa + momento della giornata
- Check-in (sonno/energia/fastidi) con alert se recupero scarso
- Idratazione attuale
- Cardio recente (ultimi 5)
- Note scheda del giorno
- **`schedaData`** da storage (file caricato, fino a 3000 chars) — fallback hardcoded se assente
- **`dietaData`** da storage (file caricato, fino a 3000 chars) — fallback hardcoded se assente

---

## Tema e CSS
- Dark mode default, light mode con classe `theme-light` su `<html>`
- Classi utility: `.card`, `.card.lift`, `.btn`, `.btn.ghost`, `.pill`, `.num`, `.muted`, `.bar`, `.fade-up`, `.spinner`, `.input`, `.input-mono`, `.ios-list`, `.row`, `.check`, `.check.on`
- Variabili CSS: `--bg`, `--card`, `--card-2`, `--card-3`, `--text`, `--text-2`, `--text-3`, `--border`, `--accent`, `--success`, `--danger`
- Prop `device` su tutti i componenti: `"mobile"` | `"desktop"`
- Layout root: `.lfh`, `.lfh-scroll`, `.lfh-status`

---

## PWA
- `manifest.json`: `start_url: "/fitness-hub/"`, `scope: "/fitness-hub/"`, `display: "standalone"`
- `sw.js`: tutti i path prefissati con `/fitness-hub`
- `index.html`: `navigator.serviceWorker.register('./sw.js')` (path relativo)
- StatusBar nascosta se installata come PWA (`_isStandalone`)

---

## Commit recenti (git log)
```
a13551c fix: bump SW cache v6 per forzare aggiornamento su iOS
10d296d fix: SW auto-reload + network-first per HTML + check ogni 60s
6b2df84 fix: sync bidirezionale + bottone Sincronizza ora
4a20bb4 fix: spesa setState→set, SW cache bust v3, auto-bump deploy
6aba5dc fix: sync mobile - timeout individuali, OR onboarding, push onboardingDone cloud
70dbee8 sync: fix cross-device sync + coach context completo
```

---

## ⚠️ Stato attuale e bug noti

### Sync mobile — fix applicati, da verificare su iPhone:
1. **`_cloudSync()` riscritta** con timeout individuali (no più race condition da 4s)
2. **`spesaChecked`/`spesaFreq`** lifted ad AppFrame → sync reattivo in foreground
3. **`onboardingDone`** persistito nel cloud → sopravvive a pulizia IndexedDB di iOS
4. **SW cache v6** aggiornata → iPhone deve ricaricare i file nuovi alla prossima apertura
5. **Da verificare su dispositivo reale**: chiudere PWA dal multitasking e riaprire

### Possibili bug ancora da investigare:
- Comportamento onboarding su iPhone dopo i fix (testare fresh install)
- Sincronizzazione bidirezionale spesa: spuntare su iPhone → verificare su PC e viceversa
- Coach: verificare che `schedaData`/`dietaData` arrivino correttamente nel prompt
- Eventuali errori JavaScript specifici Safari/WebKit (da vedere con console)
- `_cloudPushMissing`: verificare che non faccia push ridondanti in loop

### Da fare / miglioramenti futuri:
- Script di deploy automatico che aggiorna `CACHE_NAME` in `sw.js` ad ogni commit
- Mostrare indicatore visivo del sync in corso/completato nell'app
- Gestire conflitti di merge quando stesso campo modificato su due device offline

---

## Comandi utili
```bash
# Push a GitHub Pages
cd ~/Documents/Web\ Apps/Fitness\ App && git add -A && git commit -m "messaggio" && git push origin main

# Se git è bloccato da index.lock
rm -f ~/Documents/Web\ Apps/Fitness\ App/.git/index.lock
```
