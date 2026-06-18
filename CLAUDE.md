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
npx @babel/core --presets @babel/preset-react <file>.jsx >/dev/null   # or transform all *.jsx + screens/*.jsx
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

In `screens/scheda.jsx`, several pieces of state are indexed **by position** within a workout (`completion`, `substitutions`, `occupied`, `pesosRef`). When switching tabs (Upper A → Lower → Upper B) **all of them must be reset together**, or stale data (notably weights via `pesosRef.current = {}`) lands on the wrong exercise and gets saved to Sheets. Any new per-position state must be added to that reset.

## Domain reference

- Training: Upper/Lower split, 3×/week on an 8-week mesocycle — Upper A (Mon), Lower (Wed), Upper B (Fri); cardio (walk + elliptical) on rest days. `getTodaySession()` maps weekday → session.
- AI Coach (`screens/coach.jsx`, `_buildSystemPrompt`): feeds weight, mesocycle week, today's session, check-in, hydration, recent cardio, day notes, `schedaData`/`dietaData` (≤3000 chars, hardcoded fallback). Replies in the app language (IT/EN). **Always excludes from diet: chickpea pasta, lentils, peas, almond drink.**
- Theme: default `"system"` (follows macOS/iOS via `prefers-color-scheme`, with anti-flash script in `index.html` `<head>`). Dark default; light adds `theme-light` on `<html>`. Use CSS vars (`--bg --card --text --border --accent --nav-bg --track …`); never hardcode colors. Anti-flash also updates `<meta name="theme-color">`.
- i18n in `i18n.jsx` (IT/EN). Food names in Diet/Spesa stay Italian by design (plan data, not UI).
- Local data files `scheda.txt` / `dieta.txt` are parsed by `parser.jsx`; both have hardcoded fallbacks if absent.

## Open issues / watch list

- iOS home-indicator band — SOLVED (root cause proven on-device with a red TabBar / green page-background diagnostic build): the bottom strip is **NOT paintable by the page** — no element (`#root`/`html`/`body`/TabBar) reaches it, not even with `height:100dvh`; a bright-green `<html>`/`#root` background did NOT show there. iOS reserves that strip and colors it itself via **`<meta name="theme-color">`** (default was `#0a0a0a`/`#f2f2f7` = the black/white band). **Fix: set `theme-color` to the TabBar tone `#141416` (dark) / `#f9f9fb` (light)** so the iOS-painted strip blends with the TabBar. Must be changed in THREE places kept in sync: the static `<meta>` in `index.html`, the anti-flash inline script in `index.html`, and `_applyTheme()` in `app.jsx`. Dead-end attempts (do NOT retry): TabBar `padding-bottom`, anchoring `#root` to 4 edges, `height:100dvh`, recoloring `<html>`/`--safe-bg`. `100dvh` on `#root` + `body{overflow:hidden}` were kept (harmless, correct height handling); `--safe-bg` kept only as a behind-everything fallback.
- **iOS service worker can get permanently stuck serving an OLD build** (this masked the band fix across several deploys — the device never ran the new code). Confirm a deploy actually reached the device before debugging anything visual: a temporary glaring change (e.g. red TabBar) is the fastest check. To force-update a stuck install: remove the Home-screen icon, then Settings → Safari → Advanced → Website Data → delete `github.io` (or Clear History and Website Data), reopen in Safari, re-add to Home.
- iOS light-theme status bar: `apple-mobile-web-app-status-bar-style` is `black-translucent` (white text); clock can be hard to read in light mode.
- `Settings` sheet has legacy duplicate `spesaChecked` rows + `_diag_*`/`_test_sync` test keys — harmless, deletable by hand in the Google Sheet.
- No sync indicator in the UI yet; no offline merge (last-writer-wins).
