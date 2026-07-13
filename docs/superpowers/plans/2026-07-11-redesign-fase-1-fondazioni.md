# Redesign Fitness Hub — Fase 1: Fondazioni — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posare le fondazioni del redesign: nuovi token colore/tipografia in `styles.css` (font di sistema, via i webfont), componenti condivisi `ui.jsx`, `theme-color` aggiornato nei 3 punti sincronizzati, marchio LF al posto dell'avatar arancione.

**Architecture:** Solo fondazioni: nessuno screen viene ridisegnato in questa fase (fase 2). I token cambiano valore ma **mantengono i nomi esistenti** (`--bg`, `--card`, `--text-2`…) così tutte le schermate attuali restano funzionanti con la nuova pelle. `ui.jsx` introduce i componenti che le fasi 2–3 useranno. TabBar resta a 6 voci (lo switch a 5 è in fase 2).

**Tech Stack:** React 18 UMD via CDN + Babel standalone (runtime, fino alla fase 4), CSS custom properties, IndexedDB via `window.storage`.

**Spec:** `docs/superpowers/specs/2026-07-11-redesign-app-design.md` · Mockup: https://claude.ai/code/artifact/25b1ce87-50db-44bb-8fb4-514c1dcbc536

## Global Constraints

- **Mai `import`/`export` ES**: ogni componente termina con `window.Nome = Nome;`.
- **Persistenza solo `window.storage`** (mai localStorage/sessionStorage). Questa fase non tocca dati.
- **Niente tag `<form>`**: solo `onClick`/`onChange`.
- **NIENTE commit/push**: gli agenti editano solo file locali; committa il deploy script di Lorenzo.
- **Validazione dopo ogni edit JSX**: `npx @babel/core --presets @babel/preset-react <file>.jsx >/dev/null` (unico "compile check" del progetto; per i .jsx non toccati non serve).
- **Colori solo via token CSS** (`var(--…)`); l'unica definizione di gradiente di marca è il token `--brand-grad`.
- **Load order in `index.html`**: un global dev'essere definito prima del file che lo usa; `ui.jsx` va DOPO `icons.jsx` e PRIMA di `screens/*`.
- Verifica in browser: `cd ~/Documents/Web\ Apps/Fitness\ App && python3 -m http.server 8080` → `http://localhost:8080` (Chrome/Safari, anche finestra ristretta ~390px per la vista mobile).

---

### Task 1: Nuovi token in `styles.css` (palette + font di sistema)

**Files:**
- Modify: `styles.css:1-71` (header, @import, blocco `:root`, blocco `.theme-light`)
- Modify: `styles.css:75-84` (body: rimozione font-feature-settings di General Sans)
- Modify: `styles.css` (fine file: utility nuove)

**Interfaces:**
- Produces: token CSS che TUTTO il codice successivo usa: `--bg --bg-2 --card --card-2 --card-3 --border --border-2 --nav-bg --safe-bg --statusbar-bg --track --text --text-2 --text-3 --accent --accent-2 --brand-2 --brand-grad --success --warning --danger --display --body --mono --r-sm --r --r-lg --r-xl`; classi utility `.tnum`, `.ui-cap`, `.ui-card`, `.ui-card--hero`, `.ui-sheet-backdrop`, `.ui-sheet`.

- [ ] **Step 1: Sostituisci header + @import + `:root` (righe 1–43)**

Il blocco attuale da riga 1 a riga 43 (da `/* Lorenzo Fitness Hub…` fino alla `}` dopo `--r-xl: 28px;`) diventa:

```css
/* Lorenzo Fitness Hub — design tokens & base styles
   Redesign 2026-07: iOS premium — font di sistema (zero webfont),
   gradiente LF (--brand-grad) unico colore di marca, semantici solo con significato. */

/* ── DARK theme (default) ── */
:root {
  color-scheme: dark; /* form controls/scrollbar nativi coerenti col tema */
  --bg:      #0b0b0f;
  --bg-2:    #121218;
  --card:    #15151b;
  --card-2:  #1d1d25;
  --card-3:  #26262f;
  --border:  #23232b;
  --border-2:#2e2e38;
  --nav-bg:  rgba(11,11,15,0.92);   /* TabBar / barre flottanti (theme-aware) */
  --safe-bg: #0b0b0f;               /* tono TabBar (fallback dietro tutto) */
  /* Striscia status bar iOS (standalone, black-translucent = orologio SEMPRE bianco).
     Dark: si fonde con lo sfondo. Light: tono scuro (vedi .theme-light) perché
     il testo bianco iOS non è cambiabile a runtime dalla pagina. */
  --statusbar-bg: var(--bg);
  --track:   rgba(255,255,255,0.08); /* sfondo "binario" di barre di progresso */

  --text:    #f2f2f7;
  --text-2:  #8e8e9a;
  --text-3:  #5a5a66;

  --accent:  #0a84ff;
  --accent-2:#5ac8fa;
  --brand-2: #5e5ce6;
  --brand-grad: linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%); /* UNICO colore di marca */
  --success: #30d158;   /* SOLO "fatto" */
  --warning: #ffd60a;   /* SOLO "attenzione" */
  --danger:  #ff453a;   /* SOLO "errore" */
  --purple:  #bf5af2;   /* legacy: referenziato dagli screens pre-redesign; rimuovere a fine fase 2 */

  --display: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --body:    -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --mono:    ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;

  --r-sm: 10px;
  --r:    16px;
  --r-lg: 22px;
  --r-xl: 28px;
}
```

Nota: spariscono le due righe `@import url('https://api.fontshare.com/...')` e `@import url('https://fonts.googleapis.com/...jetbrains...')` — è voluto (Sezione 3 della spec: zero webfont).

- [ ] **Step 2: Sostituisci il blocco `.theme-light` (righe 45–71 originali)**

```css
/* ── LIGHT theme ── */
.theme-light {
  color-scheme: light;
  --bg:      #f2f2f7;
  --bg-2:    #ffffff;
  --card:    #ffffff;
  --card-2:  #f2f2f7;
  --card-3:  #e8e8ed;
  --border:  #e2e4ea;
  --border-2:#d5d7de;
  --nav-bg:  rgba(247,247,250,0.92);
  --safe-bg: #f7f7fa; /* tono TabBar chiaro (fallback dietro tutto) */
  /* Light: l'orologio iOS resta bianco (black-translucent) → striscia scura
     (tono ground dark) per renderlo leggibile; si fonde col notch/Dynamic Island */
  --statusbar-bg: rgba(11,11,15,0.90);
  --track:   rgba(0,0,0,0.08);

  --text:    #17181c;
  --text-2:  #6a6e78;
  --text-3:  #9a9aa3;

  --accent:  #007aff;
  --accent-2:#5ac8fa;
  --brand-2: #5e5ce6;
  --brand-grad: linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%);
  --success: #34c759;
  --warning: #b36b00;  /* ambra scurita: leggibile su fondo chiaro */
  --danger:  #ff3b30;
}
```

- [ ] **Step 3: Body — rimuovi le feature OpenType di General Sans**

In `body { … }` (righe 75–84 originali) elimina SOLO la riga:

```css
  font-feature-settings: "ss01","ss02";
```

(erano stylistic set di General Sans; su SF Pro non hanno significato).

- [ ] **Step 4: Aggiungi le utility del design system in coda a `styles.css`**

```css
/* ── Redesign 2026-07: utility del design system ── */
.tnum { font-variant-numeric: tabular-nums; }

.ui-cap {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-2);
}

.ui-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 14px;
}

/* Card "hero" (Oggi in Home): bagliori radiali del gradiente LF */
.ui-card--hero { position: relative; overflow: hidden; }
.ui-card--hero::before {
  content: "";
  position: absolute;
  inset: -40% 55% 55% -20%;
  background: radial-gradient(closest-side, rgba(10,132,255,0.28), transparent);
  pointer-events: none;
}
.ui-card--hero::after {
  content: "";
  position: absolute;
  inset: 55% -20% -40% 60%;
  background: radial-gradient(closest-side, rgba(94,92,230,0.22), transparent);
  pointer-events: none;
}
.ui-card--hero > * { position: relative; }

/* Bottom sheet (menu ⋯, editor piani) */
.ui-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.ui-sheet {
  width: 100%;
  max-width: 560px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 22px 22px 0 0;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
  max-height: 82dvh;
  overflow: auto;
}
@media (prefers-reduced-motion: no-preference) {
  .ui-sheet { animation: ui-sheet-up 0.22s cubic-bezier(0.22, 0.8, 0.3, 1); }
  @keyframes ui-sheet-up {
    from { transform: translateY(24px); opacity: 0.6; }
    to   { transform: translateY(0);    opacity: 1; }
  }
}
```

- [ ] **Step 5: Verifica in browser**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && python3 -m http.server 8080` → apri `http://localhost:8080`.
Atteso: app funzionante con la nuova pelle (fondo `#0b0b0f`, card più scure e bordate, font di sistema). In DevTools → Network: **nessuna richiesta** a `fontshare` o `fonts.googleapis`. Toggle tema in Impostazioni: light coerente (fondo `#f2f2f7`, card bianche). Nessun testo illeggibile nelle 6 schermate.

---

### Task 2: `theme-color` nei 3 punti sincronizzati + fallback inline

**Files:**
- Modify: `index.html:8` (meta statico)
- Modify: `index.html:22-34` (fallback letterali nello `<style>` inline)
- Modify: `index.html:57` (script anti-flash)
- Modify: `app.jsx:105` (`_applyTheme`)

**Interfaces:**
- Consumes: i toni definiti in Task 1 (`--safe-bg`: dark `#0b0b0f`, light `#f7f7fa`).
- Produces: striscia home-indicator iOS coerente con la nuova TabBar in entrambi i temi.

- [ ] **Step 1: Meta statico (`index.html:8`)**

```html
<meta name="theme-color" content="#0b0b0f" />
```

- [ ] **Step 2: Fallback letterali nello `<style>` inline di `index.html`**

Riga 22: `html { height: 100%; margin: 0; background: var(--safe-bg, #0b0b0f); }`
Riga 23: `body { height: 100%; margin: 0; overflow: hidden; background: var(--bg, #0b0b0f); }`
Riga 34 (dentro `#root`): `background: var(--bg, #0b0b0f);`

- [ ] **Step 3: Anti-flash (`index.html:57`)**

```js
    if (meta) meta.setAttribute("content", light ? "#f7f7fa" : "#0b0b0f");
```

Aggiorna anche il commento alla riga 19 sostituendo `#141416/#f9f9fb` con `#0b0b0f/#f7f7fa`.

- [ ] **Step 4: `_applyTheme` (`app.jsx:105`)**

```js
  if (meta) meta.setAttribute("content", light ? "#f7f7fa" : "#0b0b0f");
```

Aggiorna il commento alla riga 103 (`--nav-bg ≈ #0b0b0f / #f7f7fa`).

- [ ] **Step 5: Valida Babel su app.jsx**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && npx @babel/core --presets @babel/preset-react app.jsx >/dev/null && echo OK`
Atteso: `OK` (nessun errore di sintassi).

- [ ] **Step 6: Verifica in browser**

Ricarica `http://localhost:8080`. In DevTools Elements: `<meta name="theme-color">` = `#0b0b0f` (tema dark) e diventa `#f7f7fa` passando a Light da Impostazioni → Tema. Nessun flash bianco all'avvio in dark.

---

### Task 3: `ui.jsx` — componenti condivisi + registrazione in `index.html`

**Files:**
- Create: `ui.jsx`
- Modify: `index.html:106` circa (lista script: nuova riga dopo `icons.jsx`)

**Interfaces:**
- Consumes: `React` (globale UMD), `Icon` da `icons.jsx` (`<Icon name size strokeWidth />`), token CSS di Task 1.
- Produces (globali usati dalle fasi 2–3, firme esatte):
  - `window.UIAvatarLF({ size = 34, onClick })`
  - `window.UIHeader({ eyebrow, title, right, onProfile })` — se `right` è assente e `onProfile` è presente mostra `UIAvatarLF`
  - `window.UICard({ hero, style, onClick, children })`
  - `window.UIRow({ icon, title, sub, value, chevron, onClick, children })`
  - `window.UISegmented({ options, value, onChange, mini })` — `options: [{ id, label }]`
  - `window.UIChip({ active, children, onClick })`
  - `window.UIProgress({ value, height = 4 })` — `value` in 0..1
  - `window.UIButton({ variant = "primary" | "quiet", disabled, onClick, style, children })`
  - `window.UIStatTile({ cap, value, unit, onClick, children })`
  - `window.UISheet({ open, onClose, title, children })`

- [ ] **Step 1: Crea `ui.jsx` con questo contenuto completo**

```jsx
// ui.jsx — componenti condivisi del design system (Redesign 2026-07)
// Regole: colori SOLO via token CSS; --brand-grad è l'unico colore di marca;
// bersagli touch ≥ 44pt; niente <form>; ogni componente esposto su window.

const UIAvatarLF = ({ size = 34, onClick }) => (
  <button
    onClick={onClick}
    aria-label="Profilo"
    style={{
      width: size, height: size,
      minWidth: 44, minHeight: 44,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "transparent", border: 0, padding: 0, cursor: "pointer",
    }}
  >
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.29),
      background: "var(--brand-grad)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: Math.round(size * 0.44), letterSpacing: "-0.03em",
      color: "#fff",
    }}>LF</span>
  </button>
);

const UIHeader = ({ eyebrow, title, right, onProfile }) => (
  <div style={{
    display: "flex", alignItems: "flex-end", justifyContent: "space-between",
    gap: 10, padding: "4px 4px 0",
  }}>
    <div style={{ minWidth: 0 }}>
      {eyebrow ? <div className="ui-cap" style={{ marginBottom: 2 }}>{eyebrow}</div> : null}
      <div style={{
        fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
        letterSpacing: "-0.02em", lineHeight: 1.1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{title}</div>
    </div>
    {right != null ? right : (onProfile ? <UIAvatarLF onClick={onProfile} /> : null)}
  </div>
);

const UICard = ({ hero, style, onClick, children }) => (
  <div
    className={"ui-card" + (hero ? " ui-card--hero" : "")}
    onClick={onClick}
    style={onClick ? Object.assign({ cursor: "pointer" }, style) : style}
  >
    {children}
  </div>
);

const UIRow = ({ icon, title, sub, value, chevron, onClick, children }) => (
  <div
    onClick={onClick}
    style={{
      display: "flex", alignItems: "center", gap: 10,
      minHeight: 44, padding: "4px 0",
      cursor: onClick ? "pointer" : "default",
    }}
  >
    {icon ? (
      <span style={{
        width: 30, height: 30, borderRadius: 9, flexShrink: 0,
        background: "var(--card-2)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-2)",
      }}>
        <Icon name={icon} size={15} strokeWidth={1.8} />
      </span>
    ) : null}
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
      {sub ? <span style={{ display: "block", fontSize: 12, color: "var(--text-2)" }}>{sub}</span> : null}
    </span>
    {children}
    {value != null ? (
      <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{value}</span>
    ) : null}
    {chevron ? <span style={{ color: "var(--text-3)", fontSize: 16, fontWeight: 600 }}>›</span> : null}
  </div>
);

const UISegmented = ({ options, value, onChange, mini }) => (
  <div style={{
    display: "flex", gap: 3, padding: 3,
    background: "var(--card)", border: "1px solid var(--border)",
    borderRadius: 11, flex: mini ? "0 0 auto" : 1,
  }}>
    {options.map(op => {
      const on = op.id === value;
      return (
        <button
          key={op.id}
          onClick={() => onChange(op.id)}
          style={{
            flex: mini ? "0 0 auto" : 1,
            minHeight: mini ? 30 : 38,
            padding: mini ? "4px 10px" : "7px 8px",
            textAlign: "center",
            fontSize: mini ? 11.5 : 12.5, fontWeight: 600,
            color: on ? "#fff" : "var(--text-2)",
            background: on ? "var(--brand-grad)" : "transparent",
            border: 0, borderRadius: 8, cursor: "pointer",
            transition: "color 0.15s",
          }}
        >{op.label}</button>
      );
    })}
  </div>
);

const UIChip = ({ active, onClick, children }) => (
  <span
    onClick={onClick}
    style={{
      fontSize: 11, fontWeight: 500,
      color: active ? "#fff" : "var(--text-2)",
      background: active ? "var(--brand-grad)" : "var(--card-2)",
      border: "1px solid " + (active ? "transparent" : "var(--border)"),
      borderRadius: 999, padding: "3px 9px",
      cursor: onClick ? "pointer" : "default",
      whiteSpace: "nowrap",
    }}
  >{children}</span>
);

const UIProgress = ({ value, height = 4 }) => (
  <div style={{ height, borderRadius: 999, background: "var(--track)", overflow: "hidden" }}>
    <div style={{
      height: "100%", borderRadius: 999,
      width: Math.max(0, Math.min(1, value || 0)) * 100 + "%",
      background: "var(--brand-grad)",
      transition: "width 0.25s",
    }} />
  </div>
);

const UIButton = ({ variant = "primary", disabled, onClick, style, children }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    style={Object.assign({
      minHeight: 44, borderRadius: 12, border: 0,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      width: "100%", padding: "0 16px",
      fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.5 : 1,
      background: variant === "primary" ? "var(--brand-grad)" : "var(--card-2)",
      color: variant === "primary" ? "#fff" : "var(--text)",
      ...(variant === "quiet" ? { border: "1px solid var(--border)" } : {}),
    }, style)}
  >{children}</button>
);

const UIStatTile = ({ cap, value, unit, onClick, children }) => (
  <UICard onClick={onClick} style={{ flex: 1, minWidth: 0 }}>
    <div className="ui-cap" style={{ marginBottom: 4 }}>{cap}</div>
    <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
      {value}{unit ? <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)", marginLeft: 3 }}>{unit}</span> : null}
    </div>
    {children}
  </UICard>
);

const UISheet = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="ui-sheet-backdrop" onClick={onClose}>
      <div className="ui-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</span>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            style={{
              minWidth: 44, minHeight: 44, border: 0, background: "transparent",
              color: "var(--text-2)", fontSize: 17, cursor: "pointer",
            }}
          >✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

window.UIAvatarLF = UIAvatarLF;
window.UIHeader   = UIHeader;
window.UICard     = UICard;
window.UIRow      = UIRow;
window.UISegmented = UISegmented;
window.UIChip     = UIChip;
window.UIProgress = UIProgress;
window.UIButton   = UIButton;
window.UIStatTile = UIStatTile;
window.UISheet    = UISheet;
```

- [ ] **Step 2: Valida Babel**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && npx @babel/core --presets @babel/preset-react ui.jsx >/dev/null && echo OK`
Atteso: `OK`.

- [ ] **Step 3: Registra `ui.jsx` in `index.html`**

Nella lista script, subito DOPO la riga di `icons.jsx` (attorno alla riga 106) aggiungi, copiando il `?v=` corrente dalle righe adiacenti:

```html
<script type="text/babel" src="ui.jsx?v=20260618110215"></script>
```

(il deploy script bumpa tutti i `?v=` — basta che il formato coincida con le righe vicine).

- [ ] **Step 4: Verifica in browser**

Ricarica `http://localhost:8080`. In console: `typeof window.UIHeader` → `"function"` (idem `UICard`, `UISheet`). Nessun errore rosso in console; l'app renderizza come prima (nessuno screen usa ancora i componenti).

---

### Task 4: `nav.jsx` — marchio LF nella Sidebar, token nel SyncBadge

**Files:**
- Modify: `nav.jsx:145-150` (avatar arancione → tessera LF)
- Modify: `nav.jsx:183` (SyncBadge: colore error → token)

**Interfaces:**
- Consumes: token `--brand-grad`, `--warning` (Task 1).
- Produces: nessun nuovo global; `window.TabBar/Sidebar/SyncBadge/NAV_ITEMS` invariati.

- [ ] **Step 1: Sostituisci l'avatar arancione della Sidebar**

Il blocco attuale (righe 145–150):

```jsx
          <div style={{
            width: 32, height: 32, borderRadius: 999,
            background: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 13, color: "#1a0a04",
          }}>L</div>
```

diventa:

```jsx
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: "var(--brand-grad)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 13, color: "#fff", letterSpacing: "-0.03em",
          }}>LF</div>
```

- [ ] **Step 2: Anche il brand in alto nella Sidebar usa il token**

Alla riga 97, `background: "linear-gradient(135deg, #0A84FF 0%, #5e5ce6 100%)",` diventa:

```jsx
          background: "var(--brand-grad)",
```

- [ ] **Step 3: SyncBadge — colore errore via token**

Alla riga 183, in `CFG.error`, `color: "#FF9F0A",` diventa:

```jsx
    error:   { color: "var(--warning)",  bg: "rgba(255,159,10,0.14)",  icon: "cloud-off", label: t("Sync non riuscito") },
```

- [ ] **Step 4: Valida Babel**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && npx @babel/core --presets @babel/preset-react nav.jsx >/dev/null && echo OK`
Atteso: `OK`.

- [ ] **Step 5: Verifica in browser**

Finestra larga (>900px, vista desktop): in Sidebar il riquadro in basso mostra la tessera **LF** col gradiente blu→viola (niente più arancione). Vista mobile: TabBar invariata a 6 voci, tutto navigabile.

---

### Task 5: QA di fase + stato lavori

**Files:**
- Modify: `CLAUDE.md` (sezione "Stato lavori")

**Interfaces:**
- Consumes: tutto quanto sopra.
- Produces: fase 1 dichiarata consegnata; base pulita per il piano di Fase 2.

- [ ] **Step 1: Babel su tutti i file toccati + sanity sull'intero set**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && for f in *.jsx screens/*.jsx; do npx @babel/core --presets @babel/preset-react "$f" >/dev/null || echo "FAIL: $f"; done; echo FINE`
Atteso: solo `FINE`, nessun `FAIL:`.

- [ ] **Step 2: Giro QA completo in browser (390px e desktop, dark e light, IT e EN)**

Checklist (tutte da spuntare):
- Dashboard: check-in tap 1–5 funziona, card sessione visibile, nessun colore "rotto".
- Scheda: cambio tab Upper A/Lower/Upper B, spunta una serie, timer 120s parte, peso editabile.
- Dieta: sezioni e pasti renderizzano; Spesa: spunta articolo persiste al reload.
- Coach: apre senza API key con messaggio; Impostazioni: toggle tema Dark/Light/Auto e lingua IT/EN.
- Storico (da Impostazioni → Progressi): grafico peso carica.
- In Network: zero richieste a fontshare/googleapis; `theme-color` corretto nei due temi.

- [ ] **Step 3: Aggiorna lo stato lavori in `CLAUDE.md`**

Nella sezione "Stato lavori" aggiungi (adattando la data):

```markdown
- **Redesign Fase 1 (fondazioni) — FATTO (data)**: nuovi token in styles.css (palette iOS premium, font di sistema, ZERO webfont), `ui.jsx` (componenti condivisi UIHeader/UICard/UIRow/UISegmented/UIChip/UIProgress/UIButton/UIStatTile/UISheet, registrato in index.html dopo icons.jsx), theme-color → #0b0b0f/#f7f7fa nei 3 punti sincronizzati, marchio LF (--brand-grad) in Sidebar. TabBar ancora a 6 (switch a 5 in Fase 2 con gli header). Spec: docs/superpowers/specs/2026-07-11-redesign-app-design.md.
```

- [ ] **Step 4: Consegna**

Riferisci a Lorenzo l'esito del QA e ricordagli che il deploy (suo script) può partire quando vuole — la fase è autoconsistente e deployabile.

---

## Fuori da questa fase (piani successivi)

- **Fase 2** (piano da scrivere a Fase 1 consegnata): redesign schermate in ordine Home → Scheda+Player → Dieta → Spesa → Coach → Profilo → Onboarding; ogni schermata adotta `UIHeader` con avatar → Profilo; alla fine switch TabBar 6→5 (rimozione `impostazioni` dalle voci mobile); incolla/importa+Ripristina nel foglio Piani; i18n delle nuove etichette ("Profilo").
- **Fase 3**: serializzatori in `parser.jsx` + editor strutturato scheda/dieta (round-trip con ri-parse di verifica, backup `_prev`).
- **Fase 4**: `dev.html`, compile nel deploy script, `index.html` → `.js`, Recharts lazy in `storico.jsx`, `sw.js` precache aggiornato.
