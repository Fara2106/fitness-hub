# UI Premium Polish — Design Spec

**Data:** 2026-07-16 · **Stato:** approvata da Lorenzo (conversazione Claude Code)
**Perimetro:** SOLO UI — nessuna logica nuova salvo il trigger del pull-to-refresh (riusa `_cloudSync`). Tutte e 8 le schermate + WorkoutPlayer + TabBar/sheet, in un unico pass coerente.

## Obiettivo

Portare la UI (redesign 2026-07-15 già live) a livello "premium e curato": motion & micro-interazioni, profondità e materiali, tipografia e spaziature, dettagli di finitura. Approccio scelto: **GSAP core via CDN** (opzione B) + pull-to-refresh in Home.

## Vincoli invarianti (da CLAUDE.md)

- No build step: GSAP come UMD `<script>` in `index.html`, global `window.gsap`.
- Ogni nuovo file `.jsx` termina con `window.Nome = Nome;` ed entra nella lista script di `index.html` nell'ordine giusto.
- Niente `localStorage`, niente `<form>`, niente webfont.
- Colori SOLO via CSS vars; entrambi i temi (dark default + `.theme-light`).
- `npm test` dopo ogni edit; nuove stringhe UI → chiavi i18n IT+EN in `i18n.jsx`.
- Deploy finale = bump `CACHE_NAME` in `sw.js` + tutti i `?v=` in `index.html` (tocca file app).

## 1. Dipendenza GSAP

- `https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js` (core only, ~25KB gzip, versione pinnata esatta) in `index.html` dopo Recharts, `crossorigin="anonymous"`.
- **Niente ScrollTrigger** (schermate corte e app-like: peso morto).
- Aggiunto al precache CORE di `sw.js`.
- Guard ovunque: se `window.gsap` è assente (CDN bloccata/offline primo avvio) l'app funziona identica senza animazioni — mai un crash, mai uno stato visivo bloccato (le animazioni partono da stato finale visibile o vi arrivano istantaneamente).

## 2. `motion.jsx` — sistema motion centralizzato (nuovo file)

Global `window.Motion` con API minima:

- `Motion.screenEnter(container)` — stagger d'ingresso dei figli diretti marcati (`[data-reveal]`, fallback `.ui-card`) dentro `.lfh-scroll`: y 12→0 + fade, stagger ~0.04s, durata ~0.4s, ease tipo `power3.out`. Chiamato da `AppFrame` in un effect su cambio `state.screen` — le schermate NON contengono logica di ingresso.
- `Motion.pop(el)` — micro-pop elastico per spunte/toggle (scale 0.6→1.1→1).
- `Motion.countTo(el, from, to, opts)` — tween numerico (peso, kcal, serie) con formattazione (decimali) via callback.
- Tutte le funzioni sono **no-op** se: `prefers-reduced-motion: reduce`, `window.gsap` assente, o elemento null.
- File caricato in `index.html` dopo `ui.jsx` (prima delle screens). Termina con `window.Motion = Motion;`.

## 3. Materiali (styles.css)

- **Vetro reale**: `backdrop-filter: blur(20px) saturate(1.8)` (+ `-webkit-`) su TabBar (`--nav-bg` reso più trasparente), `ui-sheet-backdrop`/`ui-sheet`, barre flottanti. Fallback `@supports not (backdrop-filter: …)` → rgba attuali.
- **Scala ombre a token**: `--shadow-1` (riposo card), `--shadow-2` (elementi flottanti/sheet), `--shadow-3` (overlay/player). Versioni light ricalibrate (ombre più tenui, mai nere piene).
- **Hairline highlight**: bordo superiore luminoso sulle card (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.06)` dark; variante light quasi nulla) — applicato a `.ui-card`/`.card`.
- **Glow hero** più morbidi (raggi più larghi, alpha più bassi) su `.ui-card--hero`.

## 4. Tipografia & ritmo

- `tabular-nums` su OGNI numero visibile (estendere `.tnum`/`.num` dove manca).
- Display numerici grandi (peso in Home, timer/peso nel Player): tracking -0.03/-0.04em, weight 700, dimensioni armonizzate.
- Ritmo verticale su scala 4px: gap/margini uniformati tra schermate (audit per schermata, correzioni puntuali).
- Gerarchia `ui-cap` / titoli / sottotitoli resa identica in tutte le schermate.

## 5. Finiture per schermata

Per tutte e 8 le schermate + Player:

- **Skeleton shimmer** (classe CSS `.skeleton` con gradiente animato, theme-aware) al posto degli spinner testuali: grafico Storico, risposta Coach in arrivo, righe in caricamento.
- **Empty state** curati (icona da `icons.jsx` + titolo + sottotesto): Storico senza dati, Coach senza API key/chat vuota, Spesa tutta spuntata, Dieta/Scheda senza dati importati. Nuove chiavi i18n IT+EN.
- **Pressable**: stato `:active` (scale ~0.97 + leggera riduzione luminosità, transition breve) su ogni card/riga/bottone tappabile che oggi non reagisce al tocco. Classe utility `.pressable`.
- **Micro-interazioni GSAP**: pop sulla spunta serie (Player e lista Scheda), pop su check spesa/dieta, `countTo` sul peso quando si logga e sui contatori di progresso.
- Confetti di chiusura sessione rifiniti (colori dal gradiente brand, curve più naturali).

## 6. Pull-to-refresh (solo Home)

- Gesto touch su `.lfh-scroll` della Dashboard, attivo solo quando `scrollTop === 0` e trascinamento verso il basso; rubber-band con resistenza (GSAP), spinner/indicatore che ruota col progresso.
- Al rilascio oltre soglia (~70px): trigger del **`_cloudSync` esistente** (nessuna logica nuova), indicatore in stato "sync", esito riflesso dal `SyncBadge` esistente; poi ritorno animato.
- Sotto soglia: ritorno elastico senza trigger. Non interferisce con lo scroll normale (listener passivi dove possibile; preventDefault solo durante il gesto attivo).
- Degrado: senza `gsap` il gesto è disattivato (il sync automatico ogni 45s resta).

## 7. Verifica & deploy

- `npm test` + check Babel dopo ogni file toccato; cross-check i18n e icone.
- QA visiva/interattiva in Chrome (emulazione iPhone 390×844) su tutte le schermate, entrambi i temi, `prefers-reduced-motion` on/off, e con `window.gsap` rimosso (guard).
- Deploy: bump `CACHE_NAME` + `?v=` (script deploy). Su iPhone: banner "Aggiorna" (dal deploy di ieri) o cold start.

## Fuori perimetro (esplicito)

- Haptics (l'API vibration non esiste su iOS Safari/PWA).
- ScrollTrigger o altri plugin GSAP.
- Qualsiasi modifica a sync, parser, storage, backend.
