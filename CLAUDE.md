# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Lorenzo Fitness Hub** — personal fitness PWA by Lorenzo Faraoni (lorefara97@gmail.com), hosted on GitHub Pages.
- App: `https://fara2106.github.io/fitness-hub/` · Repo: `https://github.com/fara2106/fitness-hub`

## Stack constraints — DO NOT VIOLATE

This project has no build step. Breaking these turns the app into a blank page.

- **React 18 via CDN + Babel standalone.** Every component is exposed as a global: end each component file with `window.NomeComponente = NomeComponente;`. **Never** use ES `import`/`export`.
- **Persistence is `window.storage` only** (IndexedDB-backed, reads sync after init). **Never** use `localStorage`/`sessionStorage`.
- **No `<form>` tags** — wire `onClick`/`onChange` directly.
- **No bundler.** JSX files are loaded in a fixed order by `index.html` via `<script type="text/babel" src="...?v=BUILD">`. A new file must be added to that list (load order matters: a global must be defined before a file that uses it).
- After any edit, the only "compile" check available is the Babel preset; there is no test suite.

## Validate changes (no test runner)

Verify every JSX file still transforms with `@babel/preset-react` before considering work done:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App
node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"   # npx @babel/core NON funziona (nessun bin); vale anche per screens/*.jsx
```
Also cross-check when relevant:
- Every static `t("key")` used in screens exists in `i18n.jsx` (IT + EN dictionaries).
- Every `<Icon name="…">` referenced exists in `icons.jsx`.

## Deploy — agents CANNOT do this

Deploy runs **only on Lorenzo's Mac** via double-clicking `Deploy GitHub Pages.command` (it has the git credentials). The script: clears stale git locks → bumps `CACHE_NAME` in `sw.js` → bumps every `?v=…` in `index.html` → `git add -A` + commit + `git push origin main`.

An agent/sandbox has no GitHub credentials and limited `.git` access: **only edit local files; never attempt to commit or push.** Tell Lorenzo to run the deploy script. iOS service worker is "sticky" — after deploy, close the PWA from multitasking and reopen so the new SW takes over.

## Architecture

**Frontend** (`index.html` load order): React/Babel/Recharts CDNs → `storage.jsx`, `api.jsx`, `parser.jsx` → `i18n.jsx`, `icons.jsx`, `anatomy.jsx`, `nav.jsx` → `screens/*` → `app.jsx` → mount. Device is auto-detected (`mobile`/`desktop`) and passed as a `device` prop to all components.

- `app.jsx` — `AppFrame`: routing, global state, `StatusBar`, and the whole cloud-sync engine (`_cloudSync`, `_cloudPushMissing`, `_cloudPushAll`, `_saveSettingRetry`).
- `api.jsx` — `window.sheetsAPI` (REST to the backend; **every GET appends `_cb=Date.now()` + `fetch(...,{cache:"no-store"})`** to defeat stale HTTP cache) and `window.groqAPI` (AI coach, `llama-3.3-70b-versatile`). Also `playBeep`, `todayKey`, `getTodaySession`. NB: `_setDefaults()` must run inside `window.storage.onReady()` (running before IndexedDB loads overwrites saved settings).
- `storage.jsx` — `window.storage` over IndexedDB with a `_pending` write queue drained on DB open (fixes lost writes before init). API: `get/set/remove/clear/isReady/onReady`.
- `nav.jsx` — `TabBar`/`Sidebar`. **`storico` is intentionally not in the TabBar**; it's reached via Impostazioni → Progressi → Storico.
- `screens/` — `dashboard, scheda, dieta, spesa, coach, storico, impostazioni, onboarding`.

**Backend** (deployed; source kept in repo for reference):
- `google-apps-script.gs` — REST backend over Google Sheets (`PesoCorporeo`, `SerieAllenamento`, `Sessioni`, `Movimenti`, `CheckIn`, `Settings`). `Settings` is a Key|Value sheet; `_getSettings` flattens rows to a flat object, `_saveSettings` upserts by key.
- `cloudflare-worker.js` — dumb CORS proxy (no caching) at `fitness-hub-proxy.lorefara97.workers.dev`; ALL Apps Script calls go through it.

## Cross-device sync (via the `Settings` sheet)

- `_cloudSync(opts)` pulls `getPesoCorporeo` + `getSettings` with per-call timeouts. **Anti-clobber: if the settings pull fails, `cloudKeys=null` and nothing is pushed** (prevents re-pushing stale local data). Cloud-wins on conflicts (last-writer-wins; no field-level merge).
- `_cloudPushMissing` pushes (with retry) only keys present locally but absent in cloud, and only if the pull succeeded.
- Periodic pull every 45s while visible + re-sync on `visibilitychange` foreground.
- Synced keys: `groqApiKey`, `schedaData`/`dietaData`, `spesaChecked2`, `spesaFreq`, `bodyWeight`, `weekNum`, `onboardingDone`.
- **Shopping list gotcha:** cloud key is `spesaChecked2` (the legacy `spesaChecked` caused duplicate rows); local key stays `spesaChecked`. Pull is back-compat: `s.spesaChecked2 || s.spesaChecked`.

## Recurring bug family — "bleed between workout days"

In `screens/scheda.jsx`, several pieces of state are indexed **by position** within a workout (`completion`, `substitutions`, `occupied`, `pesosRef`). When switching tabs (Upper A → Lower → Upper B) **all of them must be replaced together** — done by `switchTo(tab)`, which loads the saved per-tab block from `schedaProg_<date>` (storage). Any new per-position state must be added to `switchTo` AND to the persisted block, or stale data (notably weights) lands on the wrong exercise and gets saved to Sheets.

Workout progress (completion/substitutions/pesos) persists per day+tab in `schedaProg_<date>`: leaving the Scheda tab mid-workout no longer loses it. Closing a session also writes `gym_<date>` + `muscleSets_<date>` (real data for the Dashboard week card). Coach chat persists in `coachChat_<date>`. All per-day keys are swept after 90 days by `_cleanupOldDailyKeys()` in `app.jsx` (uses `storage.keys()`).

## Domain reference

- Training: Upper/Lower split, 3×/week on an 8-week mesocycle — Upper A (Mon), Lower (Wed), Upper B (Fri); cardio (walk + elliptical) on rest days. `getTodaySession()` maps weekday → session.
- AI Coach (`screens/coach.jsx`, `_buildSystemPrompt`): feeds weight, mesocycle week, today's session, check-in, hydration, recent cardio, day notes, `schedaData`/`dietaData` (≤3000 chars, hardcoded fallback). Replies in the app language (IT/EN). **Always excludes from diet: chickpea pasta, lentils, peas, almond drink.**
- Theme: default `"system"` (follows macOS/iOS via `prefers-color-scheme`, with anti-flash script in `index.html` `<head>`). Dark default; light adds `theme-light` on `<html>`. Use CSS vars (`--bg --card --text --border --accent --nav-bg --track …`); never hardcode colors. Anti-flash also updates `<meta name="theme-color">`.
- i18n in `i18n.jsx` (IT/EN). Food names in Diet/Spesa stay Italian by design (plan data, not UI).
- Local data files `scheda.txt` / `dieta.txt` are parsed by `parser.jsx`; both have hardcoded fallbacks if absent.

## Stato lavori — sessione Cowork 10-11/07/2026 (modifiche locali, NON ancora deployate)

Tutte validate con Babel + giro QA interattivo (Playwright/Chromium, emulazione iPhone 390×844). Deploy: solo Lorenzo col suo script; dopo il deploy ricordare il SW sticky iOS.

- `index.html` — React/ReactDOM passati a **production.min** (SRI ricalcolati dai file npm, byte-identici a unpkg; commento nel file per tornare ai dev build). Catch registrazione SW: guard su `reg` undefined + messaggi chiari (prima: TypeError confuso quando l'ambiente blocca i SW).
- `styles.css` + `app.jsx` — fix status bar light theme via `--statusbar-bg` (vedi watch list sotto, DA VERIFICARE SU DEVICE).
- `app.jsx` — push settings in `setState` (weekNum/bodyWeight/spesaChecked2/spesaFreq) ora con `_saveSettingRetry` invece di fire-and-forget; `weekNum` dal pull cloud clampato 1..8.
- `screens/onboarding.jsx` — fix: "Salta" ora setta `onboardingDone` (prima il wizard riappariva a ogni avvio).
- `screens/impostazioni.jsx` + `i18n.jsx` — `FileImporter` (Impostazioni → File di testo) ora VALIDA col parser prima di salvare: file non valido → messaggio d'errore e dati esistenti intatti (prima sovrascriveva e pushava in cloud qualsiasi cosa); aggiunti data ultimo import persistente (`schedaData_at`/`dietaData_at`), feedback ok/errore con conteggi (giorni·esercizi / sezioni·pasti), 10 chiavi i18n IT+EN. Etichette: "Importa scheda (.txt)" / "Importa dieta (.txt)".
- **Icona app: FATTO (11/07)** — Lorenzo ha scelto la proposta 3 ("Anello": anello attività blu→verde + manubrio 45° su scuro). `icon-512.png` = copia della proposta, `icon-192.png` derivata con Pillow LANCZOS. Manifest già ok (punta a quei file, `purpose: any maskable`); `sw.js` li ha in precache → il bump `CACHE_NAME` del deploy li rinfresca. Su iPhone l'icona di un web clip è catturata al momento dell'aggiunta: dopo il deploy va rimossa e ri-aggiunta la PWA alla home per vederla. NB: varianti icona chiaro/scuro NON possibili per le PWA (feature iOS 18 solo per app native con asset catalog; `apple-touch-icon` è statica) — la 3 su fondo scuro funziona bene su entrambi i wallpaper.
- QA completo eseguito: tutti i flussi ok (scheda spunte/timer/cambio giorno, spesa persistenza, coach senza key, tema/lingua, storico Recharts, onboarding). Nessun bug aperto noto oltre la watch list.
- Nota sandbox (per sessioni Cowork future): CDN unpkg/jsdelivr/fontshare bloccate → vendorizzare da npm; worker Cloudflare irraggiungibile → badge Offline atteso; niente font emoji; `npx playwright install chromium-headless-shell` funziona ma serve stub `libXdamage.so.1` (gcc) e ogni chiamata bash ha timeout 45s con processi non persistenti tra chiamate.
- **Redesign Fase 1 (fondazioni) — FATTO 11/07/2026**: nuovi token in styles.css (palette iOS premium, font di sistema, ZERO webfont), `ui.jsx` (componenti condivisi UIAvatarLF/UIHeader/UICard/UIRow/UISegmented/UIChip/UIProgress/UIButton/UIStatTile/UISheet, registrato in index.html dopo icons.jsx), theme-color → #0b0b0f/#f7f7fa nei 3 punti sincronizzati, marchio LF (--brand-grad) in Sidebar. TabBar ancora a 6 (switch a 5 in Fase 2 con gli header). Spec: docs/superpowers/specs/2026-07-11-redesign-app-design.md.
- **Redesign Fase 2 · Home — IMPLEMENTATO 13/07/2026 (QA visiva on-device DA FARE)**: `screens/dashboard.jsx` riscritta coi componenti `ui.jsx`. Header compatto con avatar LF → Profilo (route `impostazioni`) + SyncBadge; Hero "Oggi" (sessione/riposo, chips, CTA "Inizia allenamento" → Scheda, imposta `window._schedaIntent="player"` per il futuro player); riga "Prossimo pasto" calcolata dai dati dieta reali (variante `ore17` se sessione, altrimenti `riposo`; null → riga assente se manca `dietaData`); check-in compresso (Sonno/Energia 5 tacche ≥44pt col gradiente, Fastidi espandibile); StatTile Peso (sheet log rapido, stesso flusso `weightLog`+`bodyWeight`+push Sheets) e Mesociclo (sheet stepper −/+, clamp 1..8) — **spostati QUI da Impostazioni**. Card secondarie retained: Idratazione (ora cablata via nuove props `hydration`/`setHydration` in `app.jsx` — prima era codice morto non renderizzato), Movimento/cardio, riepilogo muscoli settimana; **rimosso il toggle "sei andato in palestra"** (ridondante col player). TabBar ancora a 6 (switch a 5 nell'ultimo piano di Fase 2). Validato Babel + review subagent (Approved); manca solo la QA visiva/interattiva in browser (Chrome non guidabile in questa sessione) — checklist nel piano. Piano: docs/superpowers/plans/2026-07-13-redesign-fase-2-home.md.

## Open issues / watch list

- iOS home-indicator band — SOLVED (root cause proven on-device with a red TabBar / green page-background diagnostic build): the bottom strip is **NOT paintable by the page** — no element (`#root`/`html`/`body`/TabBar) reaches it, not even with `height:100dvh`; a bright-green `<html>`/`#root` background did NOT show there. iOS reserves that strip and colors it itself via **`<meta name="theme-color">`** (default was `#0a0a0a`/`#f2f2f7` = the black/white band). **Fix: set `theme-color` to the TabBar tone `#0b0b0f` (dark) / `#f7f7fa` (light)** so the iOS-painted strip blends with the TabBar. **UPDATE 2026-07-13 (finally live — the 07-11 fix was never deployed until today; deploy was frozen at 18 Jun): the single static `<meta content="#0b0b0f">` + JS `setAttribute` runtime updates DO NOT WORK on iOS standalone — the band stayed black in BOTH themes because iOS ignores runtime theme-color changes and used the static dark value. New fix: TWO media-scoped static metas `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0b0f">` + `... media="(prefers-color-scheme: light)" content="#f7f7fa">` — iOS evaluates `media` on static metas natively and honors it. The anti-flash script + `_applyTheme()` now update BOTH metas (via `querySelectorAll`) for browsers that honor JS + manual theme override. Limitation: on iOS standalone the strip follows OS appearance (media), not the app's manual light/dark override — fine when theme = "system" (default). PENDING on-device verification by Lorenzo.** Dead-end attempts (do NOT retry): single static meta + JS-only update (proven black on device), TabBar `padding-bottom`, anchoring `#root` to 4 edges, `height:100dvh`, recoloring `<html>`/`--safe-bg`. `100dvh` on `#root` + `body{overflow:hidden}` were kept (harmless, correct height handling); `--safe-bg` kept only as a behind-everything fallback.
- **LARGE bottom black band (distinct from the thin home-indicator strip above)** — reported 2026-07-13 on-device (dark mode, ~120pt tall band below the TabBar). NOT theme-color: it's the `--bg`/`--safe-bg` showing because the page got **zoomed** (`#root` is `position:fixed; height:100dvh` → once iOS zooms, the fixed root no longer covers the visual viewport and the body background shows at the bottom). Trigger: viewport allowed pinch-zoom AND iOS auto-zoom on input focus (inputs < 16px). Measured in Chrome iPhone emulation: with no zoom, `#root` and TabBar both reach the viewport bottom (no gap), and TabBar already has `paddingBottom: calc(10px + env(safe-area-inset-bottom))` — so the band is purely zoom-induced. **Fix: viewport `maximum-scale=1.0, user-scalable=no`** (respected in standalone PWA) to block both pinch and auto-zoom. If auto-zoom still sneaks in, raise input `font-size` to ≥16px. PENDING on-device verification.
- **iOS service worker can get permanently stuck serving an OLD build** (this masked the band fix across several deploys — the device never ran the new code). Confirm a deploy actually reached the device before debugging anything visual: a temporary glaring change (e.g. red TabBar) is the fastest check. To force-update a stuck install: remove the Home-screen icon, then Settings → Safari → Advanced → Website Data → delete `github.io` (or Clear History and Website Data), reopen in Safari, re-add to Home.
- iOS light-theme status bar: `apple-mobile-web-app-status-bar-style` is `black-translucent` (white text); clock was hard to read in light mode. FIX ATTEMPTED (verify on device in light theme): unlike the bottom band, the status-bar strip IS page-paintable — `StatusBar` in `app.jsx` now fills it with `--statusbar-bg` (styles.css: dark = `var(--bg)` as before, light = `rgba(20,20,22,0.90)`, TabBar-dark tone) so the white clock stays readable and blends with the notch/Dynamic Island. `theme-color` untouched (it only drives the bottom home-indicator band). Do NOT try switching the meta to `default`/`black` at runtime — iOS ignores runtime changes to that meta.
- `Settings` sheet has legacy duplicate `spesaChecked` rows + `_diag_*`/`_test_sync` test keys — harmless, deletable by hand in the Google Sheet.
- Sync indicator: DONE (v2.7.0) — `window._syncState` + `"lfh-sync"` event set by `_cloudSync` in `app.jsx`; `SyncBadge` in `nav.jsx`, shown in Dashboard header and Impostazioni → Sincronizzazione. Still no offline merge (last-writer-wins).
- **Recharts UMD needs the `prop-types` UMD loaded BEFORE it** (reads global `window.PropTypes`). Without it Recharts crashes ("oneOfType of undefined") and the Storico weight chart hangs on "Caricamento grafico…" forever — broken in prod until v2.7.0. Do not remove the prop-types `<script>` in `index.html`.
- Rest timer (`TimerOverlay`) is timestamp-based (`endRef`) and requests a screen Wake Lock (iOS ≥16.4): stays correct across iOS tab suspension. Don't revert to setInterval-decrement counting.
