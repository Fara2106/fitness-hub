# Prompt per nuova chat — Lorenzo Fitness Hub

## Progetto
App fitness React single-page per uso personale (Lorenzo Faraoni). Gira in locale su `http://localhost:8080/launch.html` lanciata da uno script `.command` sul Desktop.

## Stack tecnico
- React 18 via unpkg CDN + Babel standalone (tutti i file `.jsx` caricati come `<script type="text/babel">`)
- **NESSUN bundler** — i file vengono serviti da `python3 -m http.server 8080`
- Tutti i componenti esposti come `window.ComponentName = ComponentName`
- **ATTENZIONE Babel**: le `const` NON vengono hoistate — i componenti devono essere definiti in ordine (dipendenze prima di chi le usa)

## Regole INDEROGABILI
- `window.storage` per la persistenza locale (MAI `localStorage`/`sessionStorage`)
- Tutte le API key da `window.storage`, MAI nel codice sorgente
- Nessun tag HTML `<form>` — solo `onClick`/`onChange`
- ESCLUDERE SEMPRE dalla dieta: pasta di ceci, pasta di lenticchie, pasta di piselli, bevanda di mandorla

## Cartella progetto
`/Users/lorenzofaraoni/Documents/Web Apps/Fitness App/`

## File principali
| File | Ruolo |
|------|-------|
| `launch.html` | Entry point desktop — carica tutti gli script, monta `<AppFrame device="desktop" />` |
| `index.html` | Canvas di design (tutti gli artboard) — NON è il launcher |
| `app.jsx` | Shell: routing, stato globale, persistenza, tema |
| `styles.css` | Design system: variabili CSS, dark/light theme, componenti base |
| `storage.jsx` | IndexedDB-backed sync cache — `window.storage` |
| `api.jsx` | `window.sheetsAPI`, `window.groqAPI`, `window.playBeep`, `window.todayKey`, `window.getTodaySession` |
| `parser.jsx` | `window.parseScheda(text)`, `window.parseDieta(text)` |
| `nav.jsx` | `TabBar` (mobile), `Sidebar` (desktop), `LangContext`, `useT()`, `useLang()` |
| `icons.jsx` | `window.Icon` — set SVG icons |
| `anatomy.jsx` | `window.Anatomy` — figura corpo umano muscoli |
| `screens/dashboard.jsx` | Home con anelli attività, check-in, peso, palestra tracker, cardio |
| `screens/scheda.jsx` | Allenamento: serie, pesi, RPE, timer recupero auto, storico |
| `screens/dieta.jsx` | Piano alimentare: timeline cronologica pasti + integratori + slider orario |
| `screens/spesa.jsx` | Lista spesa settimanale con checkbox |
| `screens/coach.jsx` | Coach AI via Groq API |
| `screens/storico.jsx` | Grafici storici pesi con Recharts |
| `screens/impostazioni.jsx` | Impostazioni, tema, reset |
| `screens/onboarding.jsx` | Schermata iniziale prima configurazione |
| `dieta.txt` | Piano nutrizionale di Lorenzo (testo) |
| `scheda.txt` | Scheda allenamento di Lorenzo (testo) |
| `google-apps-script.gs` | Google Apps Script per sync Sheets |

## Globals da `api.jsx`
```js
window.sheetsAPI       // GET/POST verso Google Sheets Apps Script
window.groqAPI.complete({messages, systemPrompt, model, maxTokens})
window.playBeep(freq, duration, gain)
window.todayKey()      // → "YYYY-MM-DD"
window.getTodaySession() // → {id, label, muscles} per Lun/Mer/Ven, null altrimenti
window.parseScheda(text)
window.parseDieta(text)
```

## Stato attuale delle schermate
- **Dashboard**: anelli attività (palestra giorni/settimana, cardio minuti, attività), check-in sonno/energia, peso corporeo + sparkline, GymCard toggle "sono andato in palestra", MovimentoCard log cardio
- **Scheda**: esercizi con serie/pesi/RPE, timer recupero automatico (parte quando checkki un set), storico pesi da Sheets, sostituisci esercizio, note sessione, salva su Sheets
- **Dieta**: toggle allenamento/riposo + orario, timeline cronologica con pasti E integratori mescolati in ordine orario, slider orario 06-24 con indicatore ora attuale, cardio con slider durata libero
- **Spesa**: lista settimanale con checkbox, frequenza ~1 settimana, tutti gli integratori presenti
- **Coach**: chat AI con Groq (richiede API key in impostazioni)
- **Storico**: grafici pesi con Recharts
- **Impostazioni**: tema dark/light/sistema, settimana programma, reset

## Storage keys importanti
```
onboardingDone          → bool
activities              → array log cardio
checkIn_YYYY-MM-DD      → {sleep, energy, ailments}
hydration_YYYY-MM-DD    → number
integ_YYYY-MM-DD        → {tipo: bool} — integratori assunti
gym_YYYY-MM-DD          → bool — andato in palestra
weekNum                 → 1-8
bodyWeight              → number
weightLog               → [{date, weight}]
weekSessions            → number
weekMuscleSets          → {Petto, Schiena, ...}
notes_YYYY-MM-DD        → string
theme                   → "dark"|"light"|"system"
lang                    → "it"|"en"
schedaData              → testo scheda.txt
dietaData               → testo dieta.txt
sheetsUrl               → URL Apps Script
groqKey                 → API key Groq
spesaChecked            → {cat-idx: bool}
```

## Come lanciare
```bash
# Script .command sul Desktop
PORT=8080
APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"
lsof -ti:$PORT | xargs kill -9 2>/dev/null
nohup python3 -m http.server $PORT --directory "$APP_DIR" > /dev/null 2>&1 &
open "http://localhost:8080/launch.html"
```

## Problemi noti / da verificare
- Il **timer di recupero** (scheda) ora usa `position: fixed` — dovrebbe apparire correttamente
- La **dieta** usa il fallback interno se non c'è `dietaData` in storage (caricare dieta.txt serve un loader)
- Il **coach** richiede Groq API key (va inserita in Impostazioni → Groq API Key)
- Il **sync Sheets** richiede URL Apps Script (va inserito in Impostazioni → Google Sheets URL)

## Dieta di Lorenzo (sintesi)
- Nutrizione personalizzata da dietista (Dr.ssa Mazzotta Manuela)
- 4 varianti giornata: riposo / allenamento mattina / ore 17 / ore 21 / ore 22
- Integratori fissi ogni giorno: Vita C+ Slow Release, Vita B+, Extra Omega+ x2, PS+, Gluta+
- Integratori solo allenamento: MGK+ Liquid, Fuel+, Barretta 4Plus 45g (pre-WO) + OMNIA+ (intra-WO)

## Programma allenamento
- 3 sessioni/settimana: Lunedì Upper A · Mercoledì Lower · Venerdì Upper B
- 8 settimane poi cambio scheda
- RPE = Rate of Perceived Exertion (1-10, sforzo percepito)
