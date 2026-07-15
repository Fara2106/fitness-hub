# Toast "Aggiorna" per update PWA — design

**Data:** 15 luglio 2026 · **Approvato da:** Lorenzo (design + banner persistente)

## Problema

Quando esce una nuova versione dell'app, oggi l'update dovrebbe applicarsi da solo (`sw.js` fa `skipWaiting()`+`clients.claim()`, e `index.html` fa auto-reload silenzioso su `controllerchange`). Ma su iOS standalone la catena è "sticky" e non scatta in modo affidabile → Lorenzo finisce per ricaricare a mano la pagina / ri-aggiungere il segnalibro. Serve un **banner persistente in alto** con un bottone **Aggiorna** che applichi l'update con un tap.

## Approccio

Passare dal modello "auto-update silenzioso" al pattern standard **"waiting worker + prompt utente"**: il nuovo SW resta in attesa, la pagina lo rileva e mostra un banner, il tap su Aggiorna attiva il nuovo SW (`skipWaiting`) e ricarica. Si riusa il ponte SW↔React già esistente per la sync (`window._syncState` + evento `"lfh-sync"` → `SyncBadge` in `nav.jsx`): stesso schema con un nuovo evento `"lfh-sw-update"`.

## Vincoli di progetto

- No build step (React via CDN + Babel); globals `window.Nome`, no import/export ES.
- Persistenza `window.storage`; no `<form>`.
- Token UI da `styles.css` (CSS vars: `--accent`, `--card`, `--text`, `--border`…); mai colori hardcoded.
- i18n IT+EN in `i18n.jsx`.
- `npm test` (smoke) dopo l'edit.
- Deploy = bump `CACHE_NAME`+`?v=` (lo fa Lorenzo). **Il toast diventa operativo dal deploy SUCCESSIVO** a quello che lo introduce (il primo update rilevabile è quello dopo che questo codice è già installato).

## Componenti

### 1. `sw.js` — passaggio al pattern "waiting"

- **Rimuovere `self.skipWaiting()`** dall'handler `install`: il nuovo SW resta in stato `waiting` invece di auto-attivarsi, così la pagina può mostrare il prompt e l'utente decide quando applicare.
- Aggiungere un handler messaggi:
  ```js
  self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  });
  ```
- `activate` con `self.clients.claim()` resta invariato (corretto: una volta attivo, il nuovo SW controlla subito le pagine).

### 2. `index.html` — rilevamento update + ponte

Nello `<script>` di registrazione SW (righe ~157-180):
- Mantenere `controllerchange → window.location.reload()` con guard `_refreshing` (scatta DOPO che l'utente tocca Aggiorna → `skipWaiting` → nuovo SW attivo → reload). Nessun reload a sorpresa perché senza `skipWaiting` in install il controllerchange non avviene più da solo.
- Mantenere `reg.update()` immediato + ogni 60s.
- Nuova logica di rilevamento, dopo `register().then(reg => …)`:
  - Funzione `_promptUpdate(worker)`: espone `window._swApplyUpdate = () => worker.postMessage({ type: "SKIP_WAITING" })` e fa `window.dispatchEvent(new Event("lfh-sw-update"))`. Setta anche `window._swUpdateReady = true` (così un mount tardivo di React può leggere lo stato anche se ha perso l'evento).
  - Se `reg.waiting` esiste già al load → `_promptUpdate(reg.waiting)`.
  - `reg.addEventListener("updatefound", () => { const nw = reg.installing; nw && nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) _promptUpdate(nw); }); })` — la condizione `navigator.serviceWorker.controller` presente distingue un **aggiornamento** dalla **prima installazione** (alla prima installazione non c'è controller e non si mostra il banner).

### 3. `app.jsx` (`AppFrame`) — banner React

- Stato `updateReady` (init da `window._swUpdateReady === true` per coprire l'evento perso prima del mount).
- `useEffect`: listener su `"lfh-sw-update"` → `setUpdateReady(true)`; cleanup su unmount.
- Renderizzare un **`UpdateBanner`** in cima al frame (sotto la `StatusBar`, sopra il contenuto), visibile solo se `updateReady`:
  - full-width, non-modale, tono `--accent`; testo `t("Nuova versione disponibile")` + bottone `t("Aggiorna")`;
  - **persistente**: nessuna ✕, resta finché non si aggiorna;
  - tap Aggiorna → `window._swApplyUpdate && window._swApplyUpdate()` (→ skipWaiting → reload). Reload sicuro anche a metà allenamento (progressi in `schedaProg_<date>`).
- Il banner può essere un piccolo componente locale in `app.jsx` (come altri elementi di frame lì) usando i token UI; non serve un nuovo file.

### 4. `i18n.jsx`

Due chiavi nuove (IT key → EN):
- `"Nuova versione disponibile"` → `"New version available"`
- `"Aggiorna"` → `"Update"`

## Criteri di completamento

1. Con un nuovo SW disponibile, appare un banner persistente in alto con "Aggiorna".
2. Tap Aggiorna → il nuovo SW si attiva e la pagina si ricarica sulla versione nuova, senza chiusura/riapertura manuale.
3. Alla **prima** installazione del SW (nessun controller) il banner NON appare.
4. Nessun reload silenzioso/non richiesto (rimosso `skipWaiting` da install).
5. `npm test` verde; i18n IT+EN presenti.

## Limiti onesti (iOS)

- Il banner migliora l'**applicazione** dell'update (un tap). *Quando* iOS rileva la versione nuova dipende da iOS (di norma al cold start della PWA); non forzabile.
- Se cambia icona/manifest, iOS richiede comunque di ri-aggiungere alla home (limite iOS).

## Rischi

- **Loop di reload**: mitigato dal guard `_refreshing` esistente su `controllerchange`.
- **Evento perso prima del mount React**: mitigato da `window._swUpdateReady` letto all'init dello stato.
- **Regressione auto-update**: rimuovere `skipWaiting` cambia il comportamento da "auto" a "su richiesta" — è l'intento; documentare in CLAUDE.md (watch list SW).
