# Banner "Aggiorna" per update PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare un banner persistente in alto quando è disponibile una nuova versione della PWA; un tap su "Aggiorna" attiva il nuovo service worker e ricarica, senza chiusura/riapertura manuale.

**Architecture:** Pattern standard "waiting worker + prompt". `sw.js` non fa più `skipWaiting()` all'install (il nuovo SW resta in attesa). `index.html` rileva il worker in attesa e fa da ponte verso React via evento `"lfh-sw-update"` + globals `window._swApplyUpdate`/`window._swUpdateReady` (stesso schema del ponte sync `"lfh-sync"` già esistente). `app.jsx` (`AppFrame`) mostra un banner persistente; il tap invia `SKIP_WAITING` al worker, che si attiva → `controllerchange` → reload.

**Tech Stack:** React 18 via CDN + Babel standalone (no build step). Service Worker API.

## Global Constraints

- **No build step:** globals `window.Nome`, MAI `import`/`export` ES. `UpdateBanner` vive DENTRO `app.jsx` (nessun nuovo file).
- **Persistenza `window.storage`**; no `<form>`.
- **Token UI da `styles.css`** (CSS vars `--accent` ecc.); mai colori hardcoded (unica eccezione: testo bianco `#fff` sul banner accent, come già altrove nel progetto per bottoni primary).
- **i18n IT+EN** in `i18n.jsx`, pattern `"IT": { en: "EN" }`.
- **`npm test`** dopo l'edit (smoke transpila `app.jsx`/`i18n.jsx`; `sw.js` non è un `.jsx` → validarlo con `node --check`).
- **Deploy fuori scope**: al deploy Lorenzo bumpa `CACHE_NAME`+`?v=`. NON bumpare in questo lavoro (aggiungere solo codice). Il banner diventa operativo dal deploy SUCCESSIVO a quello che lo introduce.
- **QA reale è manuale**: il flusso update non è testabile nell'harness (niente DOM/SW). Verifica end-to-end = on-device di Lorenzo dopo due deploy.

## File Structure

- **Modify `sw.js`** — togliere `skipWaiting()` da `install`; aggiungere handler `message` per `SKIP_WAITING`.
- **Modify `index.html`** — script registrazione SW: rilevamento update + ponte (`lfh-sw-update`, `_swApplyUpdate`, `_swUpdateReady`).
- **Modify `app.jsx`** — `UpdateBanner` + stato `updateReady` + listener + render in `wrap`.
- **Modify `i18n.jsx`** — 2 chiavi.

---

## Task 1: SW "waiting" + ponte in index.html

**Files:**
- Modify: `sw.js:40-45` (install), + nuovo handler message
- Modify: `index.html:157-180` (script registrazione SW)
- Test: `node --check sw.js`

**Interfaces:**
- Produces: `window._swApplyUpdate: () => void`, `window._swUpdateReady: boolean`, evento `window` `"lfh-sw-update"`. Il SW risponde al messaggio `{type:"SKIP_WAITING"}` con `self.skipWaiting()`.

- [ ] **Step 1: Rimuovi `skipWaiting` da install e aggiungi l'handler message in `sw.js`**

Sostituisci l'handler `install` (`sw.js:40-45`), togliendo la riga `self.skipWaiting();`:

```js
// ── Install: pre-cacha tutti i file statici ──────────────────────────────────
// NB: NIENTE self.skipWaiting() → il nuovo SW resta "waiting" finché l'utente
// non tocca "Aggiorna" nel banner (vedi index.html + app.jsx). Così l'update
// non si applica in modo silenzioso/imprevedibile.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});
```

Poi aggiungi, subito dopo l'handler `activate` (dopo `sw.js:59`), un handler messaggi:

```js
// ── Message: il banner "Aggiorna" chiede di attivare subito questo SW ─────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
```

- [ ] **Step 2: Verifica la sintassi di `sw.js`**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node --check sw.js`
Expected: nessun output, exit 0 (sintassi valida).

- [ ] **Step 3: Aggiungi rilevamento update + ponte in `index.html`**

Sostituisci l'intero blocco `<script>` di registrazione SW (`index.html:156-181`, da `<script>` a `</script>` incluso il contenuto) con:

```html
<script>
if ('serviceWorker' in navigator) {
  // Ricarica quando un nuovo SW prende il controllo (scatta DOPO che l'utente
  // tocca "Aggiorna" → SKIP_WAITING → il nuovo SW si attiva). Guard anti-loop.
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_refreshing) return;
    _refreshing = true;
    console.log('[SW] Nuovo SW attivo, ricarico...');
    window.location.reload();
  });

  // Ponte verso React: segnala che c'è un update pronto e come applicarlo.
  // Stesso schema del ponte sync ("lfh-sync"). _swUpdateReady copre il caso in
  // cui React monti DOPO l'evento (lo stato iniziale lo rilegge).
  function _promptUpdate(worker) {
    if (!worker) return;
    window._swApplyUpdate = () => worker.postMessage({ type: 'SKIP_WAITING' });
    window._swUpdateReady = true;
    try { window.dispatchEvent(new Event('lfh-sw-update')); } catch (_) {}
    console.log('[SW] Update disponibile, banner mostrato.');
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        if (!reg) { console.warn('[SW] Registrazione bloccata dall\'ambiente (nessun registration object) — ok in test/automazione'); return; }
        console.log('[SW] Registrato:', reg.scope);
        // Controlla aggiornamenti subito e poi ogni 60s
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 60000);

        // Se un worker è già in attesa al load → update pronto.
        if (reg.waiting && navigator.serviceWorker.controller) _promptUpdate(reg.waiting);

        // Nuovo worker trovato: quando è "installed" E c'è già un controller
        // (= aggiornamento, non prima installazione) → mostra il banner.
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) _promptUpdate(nw);
          });
        });
      })
      .catch(err => console.warn('[SW] Registrazione non riuscita (normale se l\'ambiente blocca i service worker):', err && err.message ? err.message : err));
  });
}
</script>
```

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App
git add sw.js index.html
git commit -m "$(cat <<'EOF'
feat(sw): pattern waiting-worker per update controllato dall'utente

install non fa più skipWaiting → il nuovo SW resta in attesa. index.html
rileva il worker waiting e fa da ponte a React (evento lfh-sw-update +
window._swApplyUpdate/_swUpdateReady). Il SW attiva se stesso su messaggio
SKIP_WAITING. controllerchange→reload resta (scatta dopo il tap utente).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Banner React + i18n

**Files:**
- Modify: `i18n.jsx` (2 chiavi)
- Modify: `app.jsx` (`UpdateBanner` prima di `AppFrame`; stato `updateReady` + effect in `AppFrame`; render in `wrap`)
- Test: `npm test`

**Interfaces:**
- Consumes: evento `"lfh-sw-update"`, `window._swUpdateReady`, `window._swApplyUpdate` (Task 1).

- [ ] **Step 1: Aggiungi le chiavi i18n**

In `i18n.jsx`, dentro `I18N_DICT` (una nuova sezione `// Update`), aggiungi:

```js
  // Update
  "Nuova versione disponibile": { en: "New version available" },
  "Aggiorna": { en: "Update" },
```

- [ ] **Step 2: Aggiungi il componente `UpdateBanner` in `app.jsx`**

In `app.jsx`, subito prima di `const AppFrame = (...)` (app.jsx:329), aggiungi:

```js
// ── Banner "Aggiorna": persistente in alto quando c'è un nuovo SW in attesa ──
const UpdateBanner = ({ onApply }) => {
  const t = useT();
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9995,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      padding: "calc(env(safe-area-inset-top) + 9px) 16px 9px",
      background: "var(--accent)", color: "#fff",
      fontSize: 13.5, fontWeight: 600,
      boxShadow: "0 2px 12px rgba(0,0,0,0.28)",
    }}>
      <span>🔄 {t("Nuova versione disponibile")}</span>
      <button
        onClick={onApply}
        style={{
          background: "rgba(255,255,255,0.22)", color: "#fff", border: 0,
          borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}
      >{t("Aggiorna")}</button>
    </div>
  );
};
```

- [ ] **Step 3: Aggiungi stato + listener in `AppFrame`**

In `AppFrame`, accanto agli altri `React.useState` (es. dopo `const [initialized, setInitialized] = …`, app.jsx:357), aggiungi lo stato e l'effect:

```js
  const [updateReady, setUpdateReady] = React.useState(() => !!window._swUpdateReady);
  React.useEffect(() => {
    const onUpd = () => setUpdateReady(true);
    window.addEventListener("lfh-sw-update", onUpd);
    return () => window.removeEventListener("lfh-sw-update", onUpd);
  }, []);
```

- [ ] **Step 4: Renderizza il banner in `wrap`**

Sostituisci la funzione `wrap` (app.jsx:458-462) con la versione che include il banner (appare in TUTTI i branch di render, dentro il `LangContext` così `useT` funziona):

```js
  const wrap = (content) => (
    <LangContext.Provider value={{ lang, setLang: globalCtx.setLang }}>
      {updateReady && <UpdateBanner onApply={() => window._swApplyUpdate && window._swApplyUpdate()} />}
      {content}
    </LangContext.Provider>
  );
```

- [ ] **Step 5: Verifica lo smoke**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && npm test`
Expected: tutti i PASS (smoke transpila `app.jsx` + `i18n.jsx`; suite parser/schedaState/dati verdi). Nessuna regressione.

- [ ] **Step 6: Commit**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App
git add app.jsx i18n.jsx
git commit -m "$(cat <<'EOF'
feat(app): banner persistente "Aggiorna" quando c'è un update PWA

UpdateBanner (token UI, in alto) mostrato quando AppFrame riceve
lfh-sw-update (o window._swUpdateReady al mount). Tap → _swApplyUpdate →
SKIP_WAITING → reload. Chiavi i18n IT+EN. Reso in wrap → tutti i branch.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verifica end-to-end (manuale, Lorenzo — post-deploy)

Non automatizzabile nell'harness. Dopo che questo codice è deployato (deploy N):
1. Fai un deploy N+1 con una modifica qualsiase (bump `CACHE_NAME`+`?v=`).
2. Apri la PWA già installata: dopo il check update (di norma al cold start) deve apparire il **banner in alto "🔄 Nuova versione disponibile · Aggiorna"**.
3. Tap **Aggiorna** → la pagina si ricarica da sola sulla versione N+1, senza chiusura/riapertura manuale.
4. Alla PRIMA installazione (device nuovo) il banner NON deve apparire.

## Self-review checklist (dopo l'implementazione)

- `sw.js` install non contiene più `skipWaiting`; handler `message` presente.
- `index.html`: `_promptUpdate` solo se `navigator.serviceWorker.controller` presente (no banner alla prima install); `controllerchange`→reload con guard; `reg.update()` periodico intatto.
- `app.jsx`: `updateReady` init da `window._swUpdateReady`; banner reso in `wrap` (tutti i branch); `onApply` guarda `window._swApplyUpdate`.
- i18n: entrambe le chiavi in IT+EN.
- Nessun bump cache/`?v=` in questo lavoro.
