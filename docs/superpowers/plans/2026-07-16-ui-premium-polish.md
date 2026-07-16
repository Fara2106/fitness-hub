# UI Premium Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare la UI live (redesign 2026-07-15) a livello "premium": motion GSAP, materiali vetro/ombre, tipografia, skeleton/empty state/pressable, pull-to-refresh in Home.

**Architecture:** GSAP core caricato come UMD via CDN (`window.gsap`); nuovo modulo `motion.jsx` (global `window.Motion`) con guard totali (no gsap / reduced-motion → no-op); token CSS nuovi in `styles.css`; componenti condivisi nuovi in `ui.jsx` (`UIEmpty`, `UISkeleton`, `UIAnimatedNumber`); orchestrazione ingresso schermata e pull-to-refresh centralizzati in `app.jsx`. Le schermate ricevono solo ritocchi puntuali.

**Tech Stack:** React 18 UMD + Babel standalone (NO build step), GSAP 3 core UMD, CSS vanilla, harness di test Node (`npm test`, `@babel/core` + `node:vm`).

**Spec:** `docs/superpowers/specs/2026-07-16-ui-premium-polish-design.md`

## Global Constraints

- **No build step**: niente `import`/`export`; ogni file `.jsx` termina con `window.Nome = Nome;` e va nella lista script di `index.html` (ordine di caricamento conta).
- **Niente** `localStorage`/`sessionStorage` (solo `window.storage`), **niente** `<form>`, **niente** webfont.
- Colori SOLO via CSS vars; ogni novità visiva va definita per ENTRAMBI i temi (dark = `:root`, light = `.theme-light`).
- Dopo OGNI file toccato: `cd ~/Documents/Web\ Apps/Fitness\ App && npm test` → exit 0.
- Ogni stringa UI nuova → `t("chiave italiana")` + voce `{ en: "..." }` in `I18N_DICT` (`i18n.jsx`). Ogni `<Icon name="…">` deve esistere in `icons.jsx` (verifica: `grep 'case "nome"' icons.jsx`).
- Icone disponibili (estratto): bolt, calendar, cart, check, chevron, clock, cloud, doc, dumbbell, flame, fork, gear, key, leaf, moon, pill, refresh, robot, scale, send, spark, sun, trend-up, upload, user, wave, x.
- `window.gsap` può essere ASSENTE (CDN bloccata/offline): mai un crash, mai UI bloccata in stato intermedio.
- NON deployare fino al task finale (Task 9). I commit intermedi restano locali su `main`.
- Messaggi di commit: terminare con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Fondazioni CSS (token, materiali, skeleton, pressable)

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Produces (usati dai task successivi): token `--shadow-1/2/3`, `--hair`, `--hair-top`, `--glass`; classi `.skeleton`, `.pressable`.
- Fix incluso: `--hair` è GIÀ usato da `nav.jsx:32` (`borderTop: "1px solid var(--hair)"`) ma NON è mai stato definito → oggi quel bordo è silenziosamente invalido.

- [ ] **Step 1: Aggiungi i token dark** in `:root` (dopo il blocco `--r-*`, riga ~43):

```css
  /* Materiali premium (2026-07-16) */
  --hair:     rgba(255,255,255,0.08);  /* bordi hairline (usato anche da nav.jsx) */
  --hair-top: rgba(255,255,255,0.05);  /* highlight superiore card */
  --glass:    rgba(21,21,27,0.72);     /* superficie vetro (sheet/barre) */
  --shadow-1: 0 1px 2px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.18);
  --shadow-2: 0 4px 12px rgba(0,0,0,0.32), 0 12px 32px rgba(0,0,0,0.28);
  --shadow-3: 0 8px 24px rgba(0,0,0,0.45), 0 24px 64px rgba(0,0,0,0.40);
```

- [ ] **Step 2: Aggiungi gli override light** dentro `.theme-light` (dopo `--danger`, riga ~73):

```css
  --hair:     rgba(0,0,0,0.07);
  --hair-top: rgba(255,255,255,0.85);
  --glass:    rgba(255,255,255,0.78);
  --shadow-1: 0 1px 2px rgba(16,24,40,0.06), 0 2px 8px rgba(16,24,40,0.06);
  --shadow-2: 0 4px 12px rgba(16,24,40,0.10), 0 12px 32px rgba(16,24,40,0.10);
  --shadow-3: 0 8px 24px rgba(16,24,40,0.16), 0 24px 64px rgba(16,24,40,0.14);
```

- [ ] **Step 3: Vetro più trasparente sulle barre** — sostituisci i valori `--nav-bg`:
  - dark (riga ~15): `--nav-bg: rgba(11,11,15,0.72);`
  - light (riga ~56): `--nav-bg: rgba(247,247,250,0.72);`
  (Il blur c'è già inline in `nav.jsx`; abbassare l'alpha rende il vetro reale.)

- [ ] **Step 4: Card con ombra + hairline highlight** — aggiorna `.ui-card` (riga ~454) e `.card` (riga ~147):

```css
.card {
  background: var(--card);
  border-radius: var(--r);
  border: 1px solid var(--border);
  position: relative;
  box-shadow: var(--shadow-1), inset 0 1px 0 var(--hair-top);
}
```
```css
.ui-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 14px;
  box-shadow: var(--shadow-1), inset 0 1px 0 var(--hair-top);
}
```

- [ ] **Step 5: Sheet in vetro** — aggiorna `.ui-sheet` (riga ~489): sostituisci `background: var(--card);` con:

```css
  background: var(--glass);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  backdrop-filter: blur(24px) saturate(1.8);
  box-shadow: var(--shadow-3);
```
e subito DOPO il blocco `.ui-sheet` aggiungi il fallback:

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ui-sheet { background: var(--card); }
}
```

- [ ] **Step 6: Glow hero più morbidi** — in `.ui-card--hero::before` porta l'alpha da `0.28` a `0.22`; in `::after` da `0.22` a `0.16`.

- [ ] **Step 7: Utility `.skeleton` e `.pressable`** — aggiungi in fondo al file:

```css
/* ── Premium polish 2026-07-16 ── */
@keyframes skeletonShimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--card-2) 25%, var(--card-3) 50%, var(--card-2) 75%);
  background-size: 200% 100%;
  animation: skeletonShimmer 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }

.pressable { transition: transform 0.12s ease, opacity 0.12s ease; -webkit-tap-highlight-color: transparent; }
.pressable:active { transform: scale(0.97); opacity: 0.85; }
```

- [ ] **Step 8: Verifica** — `npm test` → exit 0 (il CSS non è testato ma il run conferma che nulla è rotto).

- [ ] **Step 9: Commit**

```bash
git add styles.css
git commit -m "feat(ui): token materiali premium — ombre, hairline, vetro, skeleton, pressable

Definisce --hair (già usato da nav.jsx ma mai dichiarato).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: GSAP via CDN + `motion.jsx` + Suite Motion nel test harness (TDD)

**Files:**
- Create: `motion.jsx`
- Modify: `index.html` (2 script tag), `sw.js` (STATIC_ASSETS), `test/run.mjs` (nuova suite)

**Interfaces:**
- Produces: global `window.Motion` con:
  - `Motion.enabled() → boolean` (gsap presente E niente reduced-motion)
  - `Motion.screenEnter(container)` — stagger d'ingresso; target: `[data-reveal]` dentro `container`, fallback figli del primo figlio; no-op sicuro.
  - `Motion.pop(el)` — micro-pop elastico.
  - `Motion.countTo(el, from, to, opts?)` — tween numerico su `el.textContent`; `opts.decimals` (default 0), `opts.duration` (default 0.6), `opts.format(v)`. SENZA gsap scrive subito il valore finale formattato.
- NOTA deviazione spec: GSAP NON va in `STATIC_ASSETS` di `sw.js` — il fetch handler del SW **bypassa le richieste cross-origin** (riga `if (url.hostname !== self.location.hostname) return;`), quindi una copia precachata non verrebbe mai servita. Offline vale la HTTP cache del browser (come per React); senza gsap le guard rendono tutto no-op. `motion.jsx` (same-origin) invece SÌ va in precache.

- [ ] **Step 1: Scrivi la suite di test (failing)** — in `test/run.mjs`, PRIMA del blocco finale di summary (le ultime righe che stampano il totale/exit code), aggiungi:

```js
// ---- Suite Motion: motion.jsx (guard gsap/reduced-motion) ----
console.log("\nSuite Motion — motion.jsx (no-op senza gsap, tween con gsap fake)");
{
  const sb = { window: {}, console };
  vm.createContext(sb);
  try {
    vm.runInContext(transform(join(ROOT, "motion.jsx")), sb, { filename: "motion.jsx" });
    ok("motion.jsx si carica sotto vm", true);
  } catch (e) {
    ok("motion.jsx si carica sotto vm — " + e.message.split("\n")[0], false);
  }
  const M = sb.window.Motion;
  ok("Motion esposto su window", !!M);
  if (M) {
    ok("enabled() === false senza gsap", M.enabled() === false);
    let threw = false;
    try { M.screenEnter(null); M.pop(null); M.countTo(null, 0, 10); } catch (_) { threw = true; }
    ok("API no-op senza gsap/elemento (nessuna eccezione)", !threw);
    const el = { textContent: "" };
    M.countTo(el, 0, 82.5, { decimals: 1 });
    ok("countTo senza gsap scrive subito il valore finale", el.textContent === "82.5");
    // gsap fake: registra le chiamate e salta subito alla fine dei tween
    const calls = [];
    sb.window.gsap = {
      fromTo: (t, a, b) => calls.push("fromTo"),
      to: (t, cfg) => { calls.push("to"); if ("v" in cfg) { t.v = cfg.v; cfg.onUpdate && cfg.onUpdate(); } },
    };
    ok("enabled() === true con gsap fake", M.enabled() === true);
    M.pop({});
    ok("pop() con gsap chiama fromTo", calls.includes("fromTo"));
    const el2 = { textContent: "" };
    M.countTo(el2, 80, 82.5, { decimals: 1 });
    ok("countTo con gsap arriva al valore finale", el2.textContent === "82.5" && calls.includes("to"));
    const fakeItems = [{}, {}];
    const container = { querySelectorAll: () => fakeItems, firstElementChild: null };
    const before = calls.length;
    M.screenEnter(container);
    ok("screenEnter con gsap anima i [data-reveal]", calls.length > before);
    const empty = { querySelectorAll: () => [], firstElementChild: null };
    let threw2 = false;
    try { M.screenEnter(empty); } catch (_) { threw2 = true; }
    ok("screenEnter senza elementi è no-op", !threw2);
  }
}
```

- [ ] **Step 2: Verifica che fallisca** — `npm test` → la Suite Motion deve stampare FAIL su "motion.jsx si carica sotto vm" (file inesistente) ed exit 1.

- [ ] **Step 3: Crea `motion.jsx`** (root del progetto):

```jsx
// motion.jsx — sistema motion centralizzato (GSAP core via CDN → window.gsap).
// REGOLA: ogni API è un no-op sicuro se gsap è assente, se l'utente ha
// prefers-reduced-motion, o se l'elemento è null. Mai lanciare, mai lasciare
// la UI in uno stato visivo intermedio.

const Motion = (() => {
  const reduced = () => {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  };
  const g = () => (typeof window.gsap !== "undefined" && window.gsap ? window.gsap : null);

  return {
    enabled() { return !!g() && !reduced(); },

    // Ingresso schermata: stagger dei [data-reveal] dentro il container di
    // scroll; se nessuno è marcato, i figli diretti del primo figlio (il
    // wrapper della schermata). Max 12 elementi: il resto è sotto il fold.
    screenEnter(container) {
      const gsap = g();
      if (!gsap || reduced() || !container) return;
      let items = Array.prototype.slice.call(container.querySelectorAll("[data-reveal]"));
      if (!items.length && container.firstElementChild) {
        items = Array.prototype.slice.call(container.firstElementChild.children);
      }
      items = items.slice(0, 12);
      if (!items.length) return;
      gsap.fromTo(items,
        { y: 12, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", stagger: 0.04,
          overwrite: "auto", clearProps: "transform,opacity" });
    },

    // Micro-pop elastico (spunte, toggle, badge).
    pop(el) {
      const gsap = g();
      if (!gsap || reduced() || !el) return;
      gsap.fromTo(el, { scale: 0.6 },
        { scale: 1, duration: 0.45, ease: "back.out(2.5)", overwrite: "auto", clearProps: "transform" });
    },

    // Tween numerico su textContent (peso, contatori). Senza gsap/motion
    // scrive direttamente il valore finale: il dato è SEMPRE corretto.
    countTo(el, from, to, opts) {
      if (!el) return;
      opts = opts || {};
      const dec = opts.decimals != null ? opts.decimals : 0;
      const fmt = opts.format || ((v) => Number(v).toFixed(dec));
      const gsap = g();
      if (!gsap || reduced()) { el.textContent = fmt(to); return; }
      const state = { v: from };
      gsap.to(state, {
        v: to, duration: opts.duration || 0.6, ease: "power2.out", overwrite: "auto",
        onUpdate: () => { el.textContent = fmt(state.v); },
      });
    },
  };
})();

window.Motion = Motion;
```

- [ ] **Step 4: Verifica che passi** — `npm test` → Suite Motion tutta PASS, exit 0.

- [ ] **Step 5: Script tag in `index.html`** — dopo la riga di Recharts (`<script>if (typeof Recharts !== 'undefined') window.Recharts = Recharts;</script>`, riga ~113) aggiungi:

```html
<!-- GSAP core (motion premium). Se la CDN è bloccata l'app funziona identica: motion.jsx fa da guard. -->
<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js" crossorigin="anonymous"></script>
```

Poi, dopo la riga di `ui.jsx` (riga ~125), aggiungi (usa lo STESSO `?v=` delle righe adiacenti):

```html
<script type="text/babel" src="motion.jsx?v=20260715194602"></script>
```

- [ ] **Step 6: Precache SW** — in `sw.js`, dentro `STATIC_ASSETS`, dopo `BASE + "/ui.jsx",` aggiungi:

```js
  BASE + "/motion.jsx",
```
(NON aggiungere l'URL GSAP: vedi nota Interfaces.)

- [ ] **Step 7: Verifica finale** — `npm test` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add motion.jsx index.html sw.js test/run.mjs
git commit -m "feat(motion): GSAP core via CDN + window.Motion (guard totali) + Suite Motion

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Ingresso schermata in AppFrame + nuovi componenti `ui.jsx` + pressable automatico

**Files:**
- Modify: `app.jsx` (effect screenEnter), `ui.jsx` (UIEmpty, UISkeleton, UIAnimatedNumber; pressable su UICard/UIRow/UIButton), `nav.jsx` (pressable sui bottoni TabBar)

**Interfaces:**
- Consumes: `window.Motion` (Task 2), classi `.pressable`/`.skeleton` e token `--shadow-1` (Task 1).
- Produces:
  - `window.UIEmpty` — `({ icon = "spark", title, sub, action, style })`
  - `window.UISkeleton` — `({ h = 14, w = "100%", r = 8, style })`
  - `window.UIAnimatedNumber` — `({ value, decimals = 1 })` (value: number)
  - `UICard`/`UIRow` con `onClick` e `UIButton` ottengono automaticamente la classe `pressable` → i task per-schermata NON devono aggiungerla a mano su questi componenti.

- [ ] **Step 1: Effect screenEnter in `app.jsx`** — dentro `AppFrame`, dopo l'effect del tema (riga ~448), aggiungi:

```jsx
  // Motion d'ingresso schermata: stagger delle card dentro il container di
  // scroll a ogni cambio route. Centralizzato qui: le schermate non sanno nulla.
  React.useEffect(() => {
    if (!initialized) return;
    const el = document.querySelector(".lfh-scroll");
    if (el && window.Motion) window.Motion.screenEnter(el);
  }, [state.screen, initialized]);
```
(Nota: sulla route `coach` mobile non esiste `.lfh-scroll` → `el` null → no-op corretto.)

- [ ] **Step 2: Nuovi componenti in `ui.jsx`** — prima del blocco finale `window.UIAvatarLF = …` aggiungi:

```jsx
// — Empty state disegnato (icona + titolo + sottotesto + azione opzionale) —
const UIEmpty = ({ icon = "spark", title, sub, action, style }) => (
  <div style={Object.assign({
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 10, padding: "36px 28px", textAlign: "center",
  }, style)}>
    <span style={{
      width: 58, height: 58, borderRadius: 18,
      background: "var(--card)", border: "1px solid var(--border)",
      boxShadow: "var(--shadow-1), inset 0 1px 0 var(--hair-top)",
      display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)",
    }}>
      <Icon name={icon} size={26} strokeWidth={1.7} />
    </span>
    <span style={{ fontSize: 16, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</span>
    {sub ? <span className="muted" style={{ fontSize: 13, maxWidth: 260, lineHeight: 1.5 }}>{sub}</span> : null}
    {action || null}
  </div>
);

// — Skeleton shimmer (placeholder di caricamento) —
const UISkeleton = ({ h = 14, w = "100%", r = 8, style }) => (
  <span className="skeleton" style={Object.assign({ display: "block", height: h, width: w, borderRadius: r }, style)} />
);

// — Numero animato: al cambio di `value` conta dal valore precedente (Motion.countTo) —
const UIAnimatedNumber = ({ value, decimals = 1 }) => {
  const ref = React.useRef(null);
  const prev = React.useRef(value);
  React.useEffect(() => {
    if (prev.current !== value && ref.current && window.Motion) {
      window.Motion.countTo(ref.current, prev.current, value, { decimals });
    }
    prev.current = value;
  }, [value, decimals]);
  return <span ref={ref} className="tnum">{Number(value).toFixed(decimals)}</span>;
};
```
e in fondo al file aggiungi le tre righe di export:

```jsx
window.UIEmpty    = UIEmpty;
window.UISkeleton = UISkeleton;
window.UIAnimatedNumber = UIAnimatedNumber;
```

- [ ] **Step 3: Pressable automatico** in `ui.jsx`:
  - `UICard`: `className={"ui-card" + (hero ? " ui-card--hero" : "") + (onClick ? " pressable" : "")}`
  - `UIRow`: sul div esterno aggiungi `className={onClick ? "pressable" : undefined}`
  - `UIButton`: aggiungi `className="pressable"` al `<button>`

- [ ] **Step 4: Pressable sulla TabBar** — in `nav.jsx`, nel `<button>` delle voci TabBar (riga ~40) aggiungi `className="pressable"`.

- [ ] **Step 5: Verifica** — `npm test` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add app.jsx ui.jsx nav.jsx
git commit -m "feat(ui): screenEnter stagger + UIEmpty/UISkeleton/UIAnimatedNumber + pressable automatico

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Dashboard + Storico (numeri animati, skeleton grafico, empty state)

**Files:**
- Modify: `screens/dashboard.jsx`, `screens/storico.jsx`, `i18n.jsx`

**Interfaces:**
- Consumes: `UIAnimatedNumber`, `UISkeleton`, `UIEmpty` (Task 3).

- [ ] **Step 1: Peso animato in Home** — `screens/dashboard.jsx` riga ~396: sostituisci

```jsx
<UIStatTile cap={t("Peso")} value={latestWeight.toFixed(1)} unit="kg" onClick={() => setPesoOpen(true)}>
```
con

```jsx
<UIStatTile cap={t("Peso")} value={<UIAnimatedNumber value={latestWeight} decimals={1} />} unit="kg" onClick={() => setPesoOpen(true)}>
```

- [ ] **Step 2: Skeleton grafico Storico** — `screens/storico.jsx` riga ~26-31: dentro il blocco `if (!rechartsReady)`, sostituisci il div "Caricamento grafico…" con:

```jsx
<div style={{ padding: "8px 0" }}>
  <UISkeleton h={180} r={14} />
</div>
```

- [ ] **Step 3: Empty state Storico** — tre punti in `screens/storico.jsx`:
  - riga ~35-42 (`!data || data.length === 0`, blocco col 📉): sostituisci con
    ```jsx
    <UIEmpty icon="trend-up" title={t("Ancora nessun peso")} sub={t("Nessun dato peso — aggiorna il peso dalla Dashboard")} />
    ```
  - riga ~163 ("Nessun check-in disponibile"): sostituisci il div `muted` con
    ```jsx
    <UIEmpty icon="spark" title={t("Nessun check-in")} sub={t("Nessun check-in disponibile")} style={{ padding: "20px 16px" }} />
    ```
  - riga ~380 ("Nessuna attività registrata"): sostituisci il div `muted` con
    ```jsx
    <UIEmpty icon="wave" title={t("Nessuna attività")} sub={t("Nessuna attività registrata")} style={{ padding: "20px 16px" }} />
    ```

- [ ] **Step 4: Chiavi i18n** — in `i18n.jsx` (sezione Storico) aggiungi:

```js
  "Ancora nessun peso": { en: "No weight yet" },
  "Nessun check-in": { en: "No check-ins" },
  "Nessuna attività": { en: "No activity" },
```

- [ ] **Step 5: Audit `tnum`** — in entrambe le schermate, cerca i numeri renderizzati senza `tnum`/`num` (`grep -n "toFixed\|kcal\|kg" screens/dashboard.jsx screens/storico.jsx`) e aggiungi `className="tnum"` agli span/div numerici che ne sono privi (solo dove il numero può cambiare, es. contatori, non alle etichette).

- [ ] **Step 6: Verifica** — `npm test` → exit 0. Poi cross-check: ogni `t("…")` nuova esiste in `i18n.jsx` e ogni `<Icon name>` usato esiste (`grep 'case "wave"' icons.jsx` ecc.).

- [ ] **Step 7: Commit**

```bash
git add screens/dashboard.jsx screens/storico.jsx i18n.jsx
git commit -m "feat(home+storico): peso animato, skeleton grafico, empty state disegnati

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Scheda + Player (pop sulle spunte, confetti brand, tnum)

**Files:**
- Modify: `screens/scheda.jsx`

**Interfaces:**
- Consumes: `window.Motion.pop` (Task 2).

- [ ] **Step 1: Pop sulla spunta serie (lista)** — `screens/scheda.jsx` riga ~165-172: il bottone `className={\`check ${completed ? "on" : ""}\`}`. Nel suo `onClick`, quando la spunta passa a "fatta", aggiungi il pop sull'elemento:

```jsx
onClick={(ev) => {
  if (!completed && window.Motion) window.Motion.pop(ev.currentTarget);
  /* …handler esistente invariato… */
}}
```
(Adatta alla firma reale dell'handler: il pop va PRIMA della chiamata esistente, solo nel passaggio off→on.)

- [ ] **Step 2: Pop su "Serie fatta" nel Player** — riga ~583: il bottone con `<Icon name="check" …/> {allSetsDone ? t("Dopo") : t("Serie fatta")}`. Nello stesso pattern, dentro l'onClick esistente aggiungi come prima riga:

```jsx
if (window.Motion) window.Motion.pop(ev.currentTarget);
```
(anche qui: aggiungi il parametro `ev` se l'handler non lo riceve già).

- [ ] **Step 3: Confetti brand** — riga ~252: sostituisci la palette

```jsx
const colors = ["#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#5AC8FA", "#FF453A"];
```
con la palette brand (gradiente LF + successo):

```jsx
const colors = ["#0A84FF", "#5E5CE6", "#5AC8FA", "#30D158"];
```

- [ ] **Step 4: Audit `tnum`** — `grep -n "toFixed\|× *\|kg" screens/scheda.jsx`: aggiungi `className="tnum"` ai numeri dinamici privi (peso corrente, contatori serie, timer se non già `.num`).

- [ ] **Step 5: Verifica** — `npm test` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add screens/scheda.jsx
git commit -m "feat(scheda): pop GSAP sulle spunte serie, confetti brand, tnum

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Dieta + Spesa (pop sulle spunte, empty state, completamento lista)

**Files:**
- Modify: `screens/dieta.jsx`, `screens/spesa.jsx`, `i18n.jsx`

**Interfaces:**
- Consumes: `Motion.pop`, `UIEmpty` (Task 2/3).

- [ ] **Step 1: Pop sulle spunte Dieta** — `screens/dieta.jsx` riga ~437 (il check del pasto/integratore, `{done && <Icon name="check" …/>}`): nel toggle onClick relativo, aggiungi il pop nel passaggio off→on, stesso pattern del Task 5 Step 1.

- [ ] **Step 2: Empty state Dieta** — riga ~757: sostituisci

```jsx
<div className="muted">{t("Nessun pasto in questa configurazione")}</div>
```
con

```jsx
<UIEmpty icon="fork" title={t("Nessun pasto")} sub={t("Nessun pasto in questa configurazione")} style={{ padding: "24px 16px" }} />
```

- [ ] **Step 3: Pop sulle spunte Spesa** — `screens/spesa.jsx` riga ~100-116 (`SpesaItem`): nel suo onToggle/onClick, pop nel passaggio off→on (stesso pattern).

- [ ] **Step 4: Stato "lista completata"** — in `screens/spesa.jsx` il conteggio è a riga ~231 (`const totalDone = Object.values(checked).filter(Boolean).length;`). Individua dove è disponibile anche il totale degli item (`grep -n "totalItems\|length" screens/spesa.jsx` vicino a totalDone). Quando `totalDone > 0 && totalDone === totalItems`, renderizza SOPRA le categorie:

```jsx
<UIEmpty icon="check" title={t("Spesa completata")} sub={t("Hai preso tutto — ottimo!")} style={{ padding: "18px 16px 6px" }} />
```
(le categorie restano visibili sotto: è una celebrazione, non una sostituzione).

- [ ] **Step 5: Chiavi i18n** — aggiungi in `i18n.jsx`:

```js
  "Nessun pasto": { en: "No meals" },
  "Spesa completata": { en: "Shopping done" },
  "Hai preso tutto — ottimo!": { en: "You got everything — nice!" },
```

- [ ] **Step 6: Verifica** — `npm test` → exit 0 + cross-check i18n/icone come al Task 4.

- [ ] **Step 7: Commit**

```bash
git add screens/dieta.jsx screens/spesa.jsx i18n.jsx
git commit -m "feat(dieta+spesa): pop sulle spunte, empty state, celebrazione lista completata

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Coach + Impostazioni + Onboarding (skeleton risposta, rifiniture)

**Files:**
- Modify: `screens/coach.jsx`, `screens/impostazioni.jsx`, `screens/onboarding.jsx`, `i18n.jsx` (se servono chiavi)

**Interfaces:**
- Consumes: `UISkeleton`, `Motion.pop` (Task 2/3).

- [ ] **Step 1: Skeleton "sta scrivendo" nel Coach** — `screens/coach.jsx` riga ~314: il blocco `{busy && (…)}` che mostra l'indicatore di attesa nella chat. Sostituisci il contenuto del blocco con una bolla skeleton (stessa posizione/allineamento delle bolle assistant esistenti — copia il wrapper della bolla assistant adiacente):

```jsx
{busy && (
  <div style={{ display: "flex", justifyContent: "flex-start" }}>
    <div className="card" style={{ padding: "12px 14px", maxWidth: "78%", borderRadius: 16 }}>
      <UISkeleton h={11} w={180} style={{ marginBottom: 7 }} />
      <UISkeleton h={11} w={120} />
    </div>
  </div>
)}
```
(Adatta il wrapper esterno allo stile reale delle bolle in quel file: guarda come sono renderizzate le bolle `assistant` poco sopra e usa le stesse classi/style del contenitore.)

- [ ] **Step 2: Righe Impostazioni pressable** — in `screens/impostazioni.jsx`: le righe tappabili che NON usano `UIRow` (cerca `onClick` su div: `grep -n "onClick" screens/impostazioni.jsx`). Aggiungi `className="pressable"` (o concatenalo a classi esistenti) SOLO alle righe/card interattive. Quelle basate su `UIRow`/`UIButton` sono già coperte dal Task 3.

- [ ] **Step 3: Onboarding — transizione step** — `screens/onboarding.jsx`: individua lo state dello step corrente (`grep -n "useState\|step" screens/onboarding.jsx`). Aggiungi un effect che rianima il contenuto a ogni cambio step:

```jsx
React.useEffect(() => {
  const el = document.querySelector(".onb-step");
  if (el && window.Motion && window.Motion.enabled() && window.gsap) {
    window.gsap.fromTo(el, { x: 14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: "power2.out", clearProps: "transform,opacity" });
  }
}, [step]);
```
e aggiungi `className="onb-step"` al wrapper del contenuto dello step (il blocco che cambia con lo step). Se il wrapper ha già una classe, concatenala.

- [ ] **Step 4: Verifica** — `npm test` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add screens/coach.jsx screens/impostazioni.jsx screens/onboarding.jsx
git commit -m "feat(coach+setup+onboarding): skeleton risposta coach, pressable, transizione step

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Pull-to-refresh in Home

**Files:**
- Modify: `app.jsx`, `i18n.jsx`

**Interfaces:**
- Consumes: `Motion.enabled()` (Task 2), `pullAndApply` esistente in `app.jsx` (riga ~456), `Icon` (icons.jsx: usare `refresh`).
- Design: sfrutta il rubber-band nativo iOS — durante l'overscroll in alto `scrollTop` diventa NEGATIVO. Niente `preventDefault`, niente lotta col gesto nativo (i listener React su touchmove sono passivi). L'indicatore vive a `top:-48px` dentro il contenuto scrollabile: visibile solo durante il bounce.

- [ ] **Step 1: Esporre il sync manuale** — in `app.jsx`, dentro `AppFrame` aggiungi (vicino agli altri ref/state):

```jsx
  const syncNowRef = React.useRef(null);
```
Nell'effect di re-sync (riga ~452), modifica `pullAndApply` perché RITORNI la promise e registralo nel ref:

```jsx
    const pullAndApply = () => {
      if (document.visibilityState !== "visible") return Promise.resolve();
      return _cloudSync({ pesiMs: 6000, settingsMs: 8000 }).finally(() => {
        const s = initState();
        setStateRaw(prev => ({
          ...prev,
          bodyWeight:   s.bodyWeight,
          checkIn:      s.checkIn,
          spesaChecked: s.spesaChecked,
          spesaFreq:    s.spesaFreq,
        }));
      });
    };
    syncNowRef.current = pullAndApply;
```
e nel cleanup dell'effect aggiungi `syncNowRef.current = null;`.

- [ ] **Step 2: Componente `PullToRefresh`** — in `app.jsx`, a livello di modulo (prima di `AppFrame`), aggiungi:

```jsx
// ── Pull-to-refresh (solo Home) ─────────────────────────────────────────────
// Sfrutta il rubber-band nativo iOS: durante l'overscroll in alto scrollTop è
// negativo. Nessun preventDefault → il gesto resta 100% nativo. L'indicatore
// sta a top:-48 dentro il contenuto: si vede solo durante il bounce.
const PullToRefresh = ({ scrollEl, onRefresh }) => {
  const t = useT();
  const [phase, setPhase] = React.useState("idle"); // idle | sync
  const armedRef = React.useRef(false);
  const iconRef = React.useRef(null);
  const THRESHOLD = 70;

  React.useEffect(() => {
    const el = scrollEl && scrollEl.current;
    if (!el || !(window.Motion && window.Motion.enabled())) return;

    const onScroll = () => {
      const y = -el.scrollTop; // > 0 durante il rubber-band in alto
      if (iconRef.current) {
        const p = Math.max(0, Math.min(1, y / THRESHOLD));
        iconRef.current.style.opacity = String(p);
        iconRef.current.style.transform = `rotate(${p * 270}deg) scale(${0.6 + p * 0.4})`;
      }
      if (y >= THRESHOLD) armedRef.current = true;
    };
    const onTouchEnd = () => {
      if (!armedRef.current) return;
      armedRef.current = false;
      setPhase("sync");
      Promise.resolve(onRefresh && onRefresh()).finally(() => setPhase("idle"));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [scrollEl, onRefresh]);

  return (
    <React.Fragment>
      <div style={{
        position: "absolute", top: -48, left: 0, right: 0, height: 40,
        display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
      }}>
        <span ref={iconRef} style={{ opacity: 0, color: "var(--text-2)", display: "flex" }}>
          <Icon name="refresh" size={20} strokeWidth={2} />
        </span>
      </div>
      {phase === "sync" && (
        <div className="pill" style={{
          position: "fixed", top: "calc(env(safe-area-inset-top) + 10px)",
          left: "50%", transform: "translateX(-50%)", zIndex: 40,
          background: "var(--glass)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          boxShadow: "var(--shadow-2)",
        }}>
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
          {t("Aggiornamento…")}
        </div>
      )}
    </React.Fragment>
  );
};
```

- [ ] **Step 3: Montarlo sulla Home mobile** — in `AppFrame`, aggiungi `const scrollRef = React.useRef(null);` e nel branch mobile NON-coach (riga ~536) sostituisci:

```jsx
<div className="lfh-scroll" style={{ flex: 1 }}>
  <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
</div>
```
con:

```jsx
<div className="lfh-scroll" ref={scrollRef} style={{ flex: 1, position: "relative" }}>
  {state.screen === "dashboard" && (
    <PullToRefresh
      scrollEl={scrollRef}
      onRefresh={() => (syncNowRef.current ? syncNowRef.current() : Promise.resolve())}
    />
  )}
  <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
</div>
```

- [ ] **Step 4: Chiave i18n** — in `i18n.jsx` aggiungi:

```js
  "Aggiornamento…": { en: "Refreshing…" },
```
(Verifica prima con `grep -n '"Aggiornamento' i18n.jsx` che non esista già.)

- [ ] **Step 5: Verifica** — `npm test` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add app.jsx i18n.jsx
git commit -m "feat(home): pull-to-refresh nativo (rubber-band iOS) collegato al cloud sync

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: QA visiva in Chrome + review + deploy

**Files:** nessuna modifica pianificata (fix eventuali emersi dalla QA).

- [ ] **Step 1: Servire l'app in locale** — `cd ~/Documents/Web\ Apps/Fitness\ App && python3 -m http.server 8787` (in background).

- [ ] **Step 2: QA interattiva** (Chrome via claude-in-chrome o playwright-core, viewport 390×844):
  - Home: stagger d'ingresso; peso anima al log; hero glow; pressable su card/CTA; pull-to-refresh (in emulazione il rubber-band non c'è: verificare solo che non ci siano errori console e che la Home funzioni normalmente — il gesto reale si prova on-device).
  - Navigazione fra TUTTE le tab: stagger a ogni cambio, nessun flash, nessun errore console.
  - Scheda: spunta serie → pop; Player: "Serie fatta" → pop + timer; chiusura sessione → confetti brand.
  - Dieta/Spesa: pop spunte; spesa tutta spuntata → celebrazione; empty dieta (config senza pasti se raggiungibile).
  - Coach: senza key → empty esistente; con richiesta in corso → bolla skeleton.
  - Storico: skeleton grafico al primo load, poi chart; empty state se senza dati.
  - Impostazioni/Onboarding: pressable, transizione step onboarding.
  - ENTRAMBI i temi (toggle da Impostazioni) su Home + una schermata a scelta: vetro sheet, ombre light non "sporche".
  - `prefers-reduced-motion: reduce` (emulazione DevTools): nessuna animazione, UI corretta.
  - Guard gsap: blocca `gsap.min.js` (DevTools request blocking) o testa con rete offline → app identica senza animazioni, zero errori console.
- [ ] **Step 3: Fix di quanto emerso** — ogni fix: edit → `npm test` → commit dedicato.
- [ ] **Step 4: Code review** — usa la skill superpowers:requesting-code-review sull'insieme dei commit del branch (baseline: ultimo commit pre-Task 1). Risolvi Critical/Important.
- [ ] **Step 5: Deploy** — esegui `Deploy GitHub Pages.command` (o replica: clear stale git locks → bump `CACHE_NAME` in `sw.js` → bump TUTTI i `?v=` in `index.html` incluso il nuovo `motion.jsx` → `git add -A` → commit → `git push origin main`).
- [ ] **Step 6: Post-deploy** — verifica build Pages (`gh api repos/fara2106/fitness-hub/pages/builds | head`), ricorda a Lorenzo: banner "Aggiorna" o cold start della PWA; QA on-device del pull-to-refresh e del rubber-band (solo lì è verificabile davvero).
