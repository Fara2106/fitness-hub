# Notifiche Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promemoria push (pasti / integratori / allenamento) su iPhone anche ad app chiusa, con orari per tipo di giornata e recupero allenamento.

**Architecture:** La logica di piano sta nel client (PWA), che costruisce una config `{weekly, daytypes, overrides}` e la invia + la propria PushSubscription a un nuovo Cloudflare Worker dedicato. Il Worker salva tutto in KV e con un Cron Trigger (ogni minuto) calcola l'ora locale di Roma, risolve il tipo di giornata e invia le push VAPID. Il `sw.js` mostra la notifica e al tap apre l'app.

**Tech Stack:** React 18 via CDN + Babel standalone (no build), `window.storage` (IndexedDB), Cloudflare Workers + KV + Cron Triggers, Web Push (VAPID), libreria `webpush-webcrypto` (crypto compatibile Workers).

## Global Constraints

- **No build step.** React via CDN + Babel. Ogni componente esposto come globale: `window.Nome = Nome;`. MAI `import`/`export` nei file client (`.jsx`). Il Worker è separato e USA moduli ES (`export default`) + npm via wrangler — quello sì.
- **Persistenza client = `window.storage` only** (IndexedDB). MAI `localStorage`/`sessionStorage`.
- **No `<form>`** — wire `onClick`/`onChange`.
- **Nuovo file `.jsx` va aggiunto a `index.html`** nella lista script (ordine conta: globale definito prima dell'uso) **e** a `STATIC_ASSETS` in `sw.js`.
- **Validazione client:** `node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"` (NON `npx @babel/core`).
- **Validazione Worker:** `node --check push-worker/worker.js`.
- **i18n:** ogni `t("chiave")` nuova esiste in IT **e** EN in `i18n.jsx`. `<Icon name>` deve esistere in `icons.jsx`.
- **Deploy app-code** (`.jsx`/`.css`/`.html`/`sw.js`/icone) = bump obbligatorio `CACHE_NAME` (sw.js) + `?v=` (index.html) via `Deploy GitHub Pages.command`. SW sticky iOS: chiudere/riaprire la PWA dopo il deploy.
- **iOS Web Push:** solo PWA installata sulla Home, iOS ≥ 16.4, permesso da gesto utente.
- **Timezone:** `Europe/Rome` calcolato via `Intl.DateTimeFormat` (DST automatico, niente offset manuali).
- **VAPID public key:** costante nel client, riempita da Lorenzo dopo la generazione (Task 3). VAPID private: solo secret del Worker.
- **push-worker base URL:** costante nel client (`_PUSH_BASE`), riempita da Lorenzo con l'URL del Worker deployato (Task 3).

**Chiavi storage nuove:** `notifEnabled` (bool), `notifConfig` (`{weekly, daytypes, overrides}`), `notifSub` (PushSubscription JSON di questo device).

**Formato reminder:** `{ id: string, cat: "pasto"|"integratore"|"allenamento", label: string, time: "HH:MM", on: boolean }`.
**Daytype keys:** `"riposo" | "mattina" | "ore17" | "ore21" | "ore22"`.
**Weekday keys:** `"mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun"`.

---

## Task 1: push-worker — scaffold, endpoint KV, config wrangler

**Files:**
- Create: `push-worker/worker.js`
- Create: `push-worker/wrangler.toml`
- Create: `push-worker/package.json`
- Create: `push-worker/README.md`

**Interfaces:**
- Produces: endpoint HTTP `POST /save` (body `{subscription, config}`), `POST /unsubscribe` (body `{endpoint}`), `GET /health`. KV key singola `"config"` con shape `{subscriptions:[], weekly:{}, daytypes:{}, overrides:{}, tz, updatedAt}`.
- Consumes: nulla (primo task).

- [ ] **Step 1: Crea `push-worker/package.json`**

```json
{
  "name": "fitness-hub-push",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "webpush-webcrypto": "^1.0.0"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

- [ ] **Step 2: Crea `push-worker/wrangler.toml`**

`kv_namespaces.id` verrà riempito da Lorenzo in Task 3 (lasciare `PLACEHOLDER_KV_ID` — è un valore d'ambiente, non un placeholder di piano).

```toml
name = "fitness-hub-push"
main = "worker.js"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]

kv_namespaces = [
  { binding = "PUSH_KV", id = "PLACEHOLDER_KV_ID" }
]

[triggers]
crons = ["* * * * *"]

[vars]
VAPID_SUBJECT = "mailto:lorefara97@gmail.com"
```

- [ ] **Step 3: Crea `push-worker/worker.js` — solo fetch handler (endpoint) + helper KV**

```js
// fitness-hub-push — Cloudflare Worker (Web Push per Lorenzo Fitness Hub)
// Endpoint: POST /save, POST /unsubscribe, GET /health. Cron: send (Task 2).

const KV_KEY = "config";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

async function readConfig(env) {
  const raw = await env.PUSH_KV.get(KV_KEY);
  if (!raw) return { subscriptions: [], weekly: {}, daytypes: {}, overrides: {}, tz: "Europe/Rome", updatedAt: 0 };
  try { return JSON.parse(raw); } catch (_) {
    return { subscriptions: [], weekly: {}, daytypes: {}, overrides: {}, tz: "Europe/Rome", updatedAt: 0 };
  }
}

async function writeConfig(env, cfg) {
  await env.PUSH_KV.put(KV_KEY, JSON.stringify(cfg));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const cfg = await readConfig(env);
      return json({ ok: true, subs: cfg.subscriptions.length, updatedAt: cfg.updatedAt });
    }

    if (request.method === "POST" && url.pathname === "/save") {
      let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
      const { subscription, config } = body || {};
      if (!subscription || !subscription.endpoint) return json({ ok: false, error: "no subscription" }, 400);
      const cfg = await readConfig(env);
      // upsert subscription per endpoint
      const others = cfg.subscriptions.filter(s => s.endpoint !== subscription.endpoint);
      cfg.subscriptions = [...others, subscription];
      if (config) {
        cfg.weekly = config.weekly || cfg.weekly;
        cfg.daytypes = config.daytypes || cfg.daytypes;
        cfg.overrides = config.overrides || cfg.overrides;
      }
      cfg.tz = "Europe/Rome";
      cfg.updatedAt = Date.now();
      await writeConfig(env, cfg);
      return json({ ok: true, subs: cfg.subscriptions.length });
    }

    if (request.method === "POST" && url.pathname === "/unsubscribe") {
      let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
      const endpoint = body && body.endpoint;
      if (!endpoint) return json({ ok: false, error: "no endpoint" }, 400);
      const cfg = await readConfig(env);
      cfg.subscriptions = cfg.subscriptions.filter(s => s.endpoint !== endpoint);
      await writeConfig(env, cfg);
      return json({ ok: true, subs: cfg.subscriptions.length });
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
```

- [ ] **Step 4: Crea `push-worker/README.md` con i passi di deploy (per Lorenzo, dettaglio in Task 3)**

```markdown
# fitness-hub-push

Cloudflare Worker per le notifiche push. Deploy: vedi Task 3 del piano
`docs/superpowers/plans/2026-07-14-notifiche-push.md`.

Comandi rapidi:
- `npm install`
- `npx wrangler kv namespace create PUSH_KV` → copia l'id in wrangler.toml
- genera VAPID: `node -e "import('webpush-webcrypto').then(async m => { const k = await m.ApplicationServerKeys.generate(); console.log(await k.toJSON()); })"`
- `npx wrangler secret put VAPID_PRIVATE` (incolla la privata JWK/base64)
- `npx wrangler deploy`
- verifica: `curl https://fitness-hub-push.<account>.workers.dev/health`
```

- [ ] **Step 5: Valida la sintassi del Worker**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node --check push-worker/worker.js`
Expected: nessun output (exit 0 = sintassi ok).

- [ ] **Step 6: Commit**

```bash
git add push-worker/
git commit -m "feat(push): worker scaffold + endpoint save/unsubscribe/health + KV"
```

---

## Task 2: push-worker — cron send (VAPID + payload + GC)

**Files:**
- Modify: `push-worker/worker.js` (aggiungi `scheduled` handler + helper send)
- Create: `push-worker/dry-run.mjs` (smoke locale della logica di risoluzione, senza invio reale)

**Interfaces:**
- Consumes: `readConfig`/`writeConfig` da Task 1; shape KV `{subscriptions, weekly, daytypes, overrides}`.
- Produces: `scheduled(event, env, ctx)` che invia le push dovute; helper puri `romeNow(date)`, `resolveDaytype(cfg, ymd, weekday)`, `dueReminders(cfg, ymd, weekday, hhmm)`, `notifText(reminder)`.

- [ ] **Step 1: Aggiungi in `push-worker/worker.js` gli helper puri (in cima, dopo `KV_KEY`)**

```js
const WD = ["sun","mon","tue","wed","thu","fri","sat"]; // getDay() index

// Ritorna { ymd:"YYYY-MM-DD", weekday:"mon".., hhmm:"HH:MM" } in ora di Roma.
function romeNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  const wdMap = { Sun:"sun",Mon:"mon",Tue:"tue",Wed:"wed",Thu:"thu",Fri:"fri",Sat:"sat" };
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: wdMap[parts.weekday],
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

function resolveDaytype(cfg, ymd, weekday) {
  return (cfg.overrides && cfg.overrides[ymd]) || (cfg.weekly && cfg.weekly[weekday]) || null;
}

function dueReminders(cfg, ymd, weekday, hhmm) {
  const dt = resolveDaytype(cfg, ymd, weekday);
  if (!dt) return [];
  const list = (cfg.daytypes && cfg.daytypes[dt]) || [];
  return list.filter(r => r.on && r.time === hhmm);
}

function notifText(r) {
  const byCat = { pasto: "🍽️", integratore: "💊", allenamento: "🏋️" };
  return { title: "Lorenzo Fitness Hub", body: `${byCat[r.cat] || "⏰"} ${r.label}`, tag: r.id };
}
```

- [ ] **Step 2: Aggiungi l'invio web-push. PRIMA conferma l'API della libreria.**

Leggi il README di `webpush-webcrypto` (npm) per l'API esatta di generazione chiavi e invio. Al 2024 l'API è:
`import { ApplicationServerKeys } from "webpush-webcrypto"` + funzione `sendNotification`/`generatePushHTTPRequest`. Confermare i nomi esatti e adattare il codice sotto di conseguenza (questo è l'unico punto del piano da verificare a runtime contro la libreria).

Aggiungi a `worker.js`:

```js
import { generatePushHTTPRequest, ApplicationServerKeys } from "webpush-webcrypto";

// Invia una push a una subscription. Ritorna lo status HTTP del push service.
async function sendPush(subscription, payloadObj, env) {
  const keys = await ApplicationServerKeys.fromJSON(JSON.parse(env.VAPID_PRIVATE));
  const { headers, body, endpoint } = await generatePushHTTPRequest({
    applicationServerKeys: keys,
    payload: JSON.stringify(payloadObj),
    target: subscription,
    adminContact: env.VAPID_SUBJECT,
    ttl: 60,
  });
  const res = await fetch(endpoint, { method: "POST", headers, body });
  return res.status;
}
```

- [ ] **Step 3: Aggiungi il `scheduled` handler dentro `export default { ... }`**

```js
  async scheduled(event, env, ctx) {
    const cfg = await readConfig(env);
    if (!cfg.subscriptions.length) return;
    const { ymd, weekday, hhmm } = romeNow(new Date(event.scheduledTime || Date.now()));

    const due = dueReminders(cfg, ymd, weekday, hhmm);

    // GC override passati (data < oggi)
    let changed = false;
    for (const k of Object.keys(cfg.overrides || {})) {
      if (k < ymd) { delete cfg.overrides[k]; changed = true; }
    }

    if (due.length) {
      const deadEndpoints = new Set();
      for (const r of due) {
        const payload = notifText(r);
        for (const sub of cfg.subscriptions) {
          try {
            const status = await sendPush(sub, payload, env);
            if (status === 404 || status === 410) deadEndpoints.add(sub.endpoint);
          } catch (_) { /* ignora singolo invio fallito */ }
        }
      }
      if (deadEndpoints.size) {
        cfg.subscriptions = cfg.subscriptions.filter(s => !deadEndpoints.has(s.endpoint));
        changed = true;
      }
    }

    if (changed) { cfg.updatedAt = Date.now(); ctx.waitUntil(writeConfig(env, cfg)); }
  },
```

- [ ] **Step 4: Crea `push-worker/dry-run.mjs` (smoke della logica pura, niente rete)**

```js
// Verifica risoluzione daytype + due reminders senza inviare nulla.
import assert from "node:assert";

const WD = ["sun","mon","tue","wed","thu","fri","sat"];
function resolveDaytype(cfg, ymd, weekday) {
  return (cfg.overrides && cfg.overrides[ymd]) || (cfg.weekly && cfg.weekly[weekday]) || null;
}
function dueReminders(cfg, ymd, weekday, hhmm) {
  const dt = resolveDaytype(cfg, ymd, weekday);
  if (!dt) return [];
  return ((cfg.daytypes && cfg.daytypes[dt]) || []).filter(r => r.on && r.time === hhmm);
}

const cfg = {
  weekly: { mon: "ore17", tue: "riposo" },
  daytypes: {
    ore17: [{ id: "pranzo", cat: "pasto", label: "Pranzo", time: "13:00", on: true }],
    riposo: [{ id: "colazione", cat: "pasto", label: "Colazione", time: "08:00", on: true }],
  },
  overrides: { "2026-07-20": "riposo" }, // lunedì spostato a riposo
};

// baseline lunedì → ore17 → pranzo alle 13:00
assert.deepEqual(dueReminders(cfg, "2026-07-13", "mon", "13:00").map(r => r.id), ["pranzo"]);
// override lunedì 20 → riposo → nessun pranzo, ma colazione alle 08:00
assert.deepEqual(dueReminders(cfg, "2026-07-20", "mon", "13:00"), []);
assert.deepEqual(dueReminders(cfg, "2026-07-20", "mon", "08:00").map(r => r.id), ["colazione"]);
// orario non in lista → niente
assert.deepEqual(dueReminders(cfg, "2026-07-13", "mon", "09:00"), []);
console.log("dry-run OK");
```

- [ ] **Step 5: Esegui lo smoke + valida sintassi Worker**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App/push-worker && node dry-run.mjs && node --check worker.js`
Expected: stampa `dry-run OK`, nessun errore di sintassi.

- [ ] **Step 6: Commit**

```bash
git add push-worker/worker.js push-worker/dry-run.mjs
git commit -m "feat(push): cron scheduled send (VAPID payload, GC endpoint morti, prune override)"
```

---

## Task 3: [OPS — Lorenzo] Generazione VAPID + deploy Worker su Cloudflare

**Files:** nessuno nel repo (config d'ambiente). Al termine Lorenzo comunica: URL del Worker + VAPID public key (serviranno in Task 5).

> Questo task NON è eseguibile da un agent: richiede l'account Cloudflare di Lorenzo. L'agent si ferma qui e passa la palla con i comandi esatti.

- [ ] **Step 1: Installa dipendenze del worker**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App/push-worker && npm install
```

- [ ] **Step 2: Genera la coppia VAPID**

```bash
node -e "import('webpush-webcrypto').then(async m => { const k = await m.ApplicationServerKeys.generate(); console.log(JSON.stringify(await k.toJSON())); })"
```
Salva l'output. Conterrà chiave pubblica e privata (formato JWK/base64url). Nota: confermare i nomi dei campi col README della libreria.

- [ ] **Step 3: Crea il KV namespace e incolla l'id in `wrangler.toml`**

```bash
npx wrangler kv namespace create PUSH_KV
```
Copia l'`id` restituito e sostituisci `PLACEHOLDER_KV_ID` in `push-worker/wrangler.toml`.

- [ ] **Step 4: Imposta i secret**

```bash
npx wrangler secret put VAPID_PRIVATE   # incolla la chiave privata (JSON completo delle keys)
```
(`VAPID_SUBJECT` è già in `[vars]` del wrangler.toml.)

- [ ] **Step 5: Deploy del Worker**

```bash
npx wrangler deploy
```
Annota l'URL: `https://fitness-hub-push.<account>.workers.dev`.

- [ ] **Step 6: Verifica endpoint**

```bash
curl https://fitness-hub-push.<account>.workers.dev/health
```
Expected: `{"ok":true,"subs":0,"updatedAt":0}`.

- [ ] **Step 7: Comunica all'agent:** URL Worker + VAPID **public** key (per Task 5).

---

## Task 4: sw.js — handler push + notificationclick

**Files:**
- Modify: `sw.js` (aggiungi 2 listener; aggiungi la nuova screen a `STATIC_ASSETS`)

**Interfaces:**
- Consumes: payload push `{title, body, tag}` inviato dal Worker (Task 2, `notifText`).
- Produces: notifica visibile + focus/apertura app al tap.

- [ ] **Step 1: Aggiungi in `sw.js` (dopo il listener `fetch`) i due handler**

```js
// ── Push: mostra la notifica ────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || "Lorenzo Fitness Hub";
  const body  = data.body  || "Promemoria";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: BASE + "/icon-192.png",
    badge: BASE + "/icon-192.png",
    tag: data.tag || "reminder",
    data: { url: BASE + "/" },
  }));
});

// ── Tap sulla notifica: focalizza o apre l'app ──────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || (BASE + "/");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if (w.url.includes(BASE) && "focus" in w) return w.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
```

- [ ] **Step 2: Aggiungi la nuova screen al precache**

In `sw.js`, dentro l'array `STATIC_ASSETS`, dopo la riga `BASE + "/screens/impostazioni.jsx",` aggiungi:

```js
  BASE + "/screens/promemoria.jsx",
```

- [ ] **Step 3: Valida la sintassi**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node --check sw.js`
Expected: nessun output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "feat(push): sw.js push + notificationclick handlers, precache promemoria"
```

---

## Task 5: client — `window.pushAPI` (support/permesso/subscribe/sync)

**Files:**
- Create: `push.jsx`
- Modify: `index.html` (aggiungi `<script type="text/babel" src="push.jsx?v=...">` **dopo** `api.jsx` e **prima** degli screens)

**Interfaces:**
- Produces: `window.pushAPI` con `VAPID_PUBLIC` (const), `_PUSH_BASE` (const), `isSupported()`, `isInstalled()`, `permission()`, `enable(config)`, `disable()`, `syncConfig(config)`, `getLocalSub()`.
- Consumes: `window.storage` (chiavi `notifEnabled`, `notifSub`); endpoint Worker `/save` `/unsubscribe`.

- [ ] **Step 1: Crea `push.jsx`**

`VAPID_PUBLIC` e `_PUSH_BASE` restano stringhe vuote finché Lorenzo (Task 3) non fornisce i valori: si riempiono in Task 5-bis (step 3). Con stringhe vuote `isSupported()` resta true ma `enable()` fallisce con messaggio chiaro.

```jsx
// push.jsx — window.pushAPI: gestione permessi + subscription Web Push
(function () {
  const VAPID_PUBLIC = "";                 // ← Lorenzo: incolla la VAPID PUBLIC key (base64url)
  const _PUSH_BASE   = "";                 // ← Lorenzo: incolla l'URL del push-worker (senza slash finale)

  function urlB64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function _reg() {
    if (!("serviceWorker" in navigator)) return null;
    return navigator.serviceWorker.ready;
  }

  const pushAPI = {
    isConfigured() { return !!VAPID_PUBLIC && !!_PUSH_BASE; },
    isSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; },
    isInstalled() {
      return window.navigator.standalone === true ||
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    },
    permission() { return ("Notification" in window) ? Notification.permission : "denied"; },

    getLocalSub() { return window.storage ? window.storage.get("notifSub", null) : null; },

    // Richiede permesso + subscribe + POST /save. Ritorna { ok, error? }.
    async enable(config) {
      if (!this.isSupported()) return { ok: false, error: "unsupported" };
      if (!this.isInstalled()) return { ok: false, error: "not-installed" };
      if (!this.isConfigured()) return { ok: false, error: "not-configured" };
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return { ok: false, error: "denied" };
      const reg = await _reg();
      if (!reg) return { ok: false, error: "no-sw" };
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
        });
      }
      const subJson = sub.toJSON();
      if (window.storage) { window.storage.set("notifSub", subJson); window.storage.set("notifEnabled", true); }
      const res = await this._post("/save", { subscription: subJson, config });
      return res.ok ? { ok: true } : { ok: false, error: "save-failed" };
    },

    async disable() {
      const reg = await _reg();
      let endpoint = null;
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { endpoint = sub.endpoint; try { await sub.unsubscribe(); } catch (_) {} }
      }
      if (window.storage) { window.storage.set("notifEnabled", false); window.storage.remove("notifSub"); }
      if (endpoint) await this._post("/unsubscribe", { endpoint });
      return { ok: true };
    },

    // Aggiorna solo la config (se già abilitato) — reinvia subscription + config.
    async syncConfig(config) {
      if (!window.storage || !window.storage.get("notifEnabled", false)) return { ok: false, error: "disabled" };
      const sub = window.storage.get("notifSub", null);
      if (!sub) return { ok: false, error: "no-sub" };
      return this._post("/save", { subscription: sub, config });
    },

    async _post(path, body) {
      if (!_PUSH_BASE) return { ok: false, error: "not-configured" };
      try {
        const r = await fetch(_PUSH_BASE + path, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return await r.json();
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  };

  window.pushAPI = pushAPI;
})();
```

- [ ] **Step 2: Registra `push.jsx` in `index.html`**

Dopo la riga `<script type="text/babel" src="api.jsx?v=..."></script>` aggiungi (stesso `?v=`):

```html
<script type="text/babel" src="push.jsx?v=20260714154025"></script>
```

- [ ] **Step 3: Valida**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('push.jsx', {presets:['@babel/preset-react']})"`
Expected: nessun output (transform ok).

- [ ] **Step 4: Commit**

```bash
git add push.jsx index.html
git commit -m "feat(push): window.pushAPI (permesso/subscribe/sync) + registrazione script"
```

---

## Task 5-bis: [OPS — Lorenzo, dopo Task 3] Incolla VAPID public + URL Worker

**Files:** Modify `push.jsx` (2 costanti).

- [ ] **Step 1:** In `push.jsx` imposta `VAPID_PUBLIC = "<public key da Task 3>"` e `_PUSH_BASE = "https://fitness-hub-push.<account>.workers.dev"`.
- [ ] **Step 2:** Valida: `node -e "require('@babel/core').transformFileSync('push.jsx', {presets:['@babel/preset-react']})"`.
- [ ] **Step 3:** Commit: `git add push.jsx && git commit -m "chore(push): configura VAPID public + push-worker URL"`.

---

## Task 6: client — generazione schedule di default dai dati piano

**Files:**
- Modify: `parser.jsx` (aggiungi `window.buildDefaultNotifConfig`)
- Create: `push-worker/../scratchpad` NON usato — smoke inline sotto.

**Interfaces:**
- Produces: `window.buildDefaultNotifConfig()` → `{ weekly, daytypes, overrides:{} }` con reminder precompilati.
- Consumes: `_MEAL_META`, `_INTEGRATORI` (già in `parser.jsx`), `window.getTodaySession` pattern (Lun/Mer/Ven allenamento).

- [ ] **Step 1: Aggiungi in `parser.jsx` (in fondo, prima della fine file) il builder**

```js
// ── DEFAULT NOTIF CONFIG ────────────────────────────────────────────────────
// Costruisce weekly + daytypes precompilati dai dati piano. L'utente poi edita.
window.buildDefaultNotifConfig = function () {
  // reminder pasti dai _MEAL_META presenti per un giorno "tipo" (usiamo tutte le voci note)
  const mealsFor = (keys) => keys.map(k => {
    const m = _MEAL_META[k];
    return { id: "pasto_" + k.toLowerCase().replace(/\s+/g, "_"), cat: "pasto", label: m.title, time: m.time, on: true };
  });

  // integratori dal set _INTEGRATORI[daytype]
  const suppsFor = (dt) => (_INTEGRATORI[dt] || []).map((s, i) => ({
    id: "int_" + dt + "_" + i, cat: "integratore", label: s.name, time: s.sortTime, on: true,
  }));

  // allenamento: un promemoria mattutino nei daytype di training
  const workout = (label, time) => ({ id: "allenamento", cat: "allenamento", label, time, on: true });

  const daytypes = {
    riposo:  [...mealsFor(["COLAZIONE","SPUNTINO","PRANZO","MERENDA","CENA"]), ...suppsFor("riposo")],
    mattina: [workout("Allenamento", "07:00"), ...mealsFor(["PRE WO","POST WO","MERENDA","CENA"]), ...suppsFor("mattina")],
    ore17:   [...mealsFor(["COLAZIONE","SPUNTINO","PRANZO"]), workout("Allenamento ore 17", "16:30"), ...suppsFor("ore17")],
    ore21:   [...mealsFor(["COLAZIONE","SPUNTINO","PRANZO","MERENDA"]), workout("Allenamento ore 21", "20:00"), ...suppsFor("ore21")],
    ore22:   [...mealsFor(["COLAZIONE","SPUNTINO","PRANZO"]), workout("Allenamento ore 22", "21:00"), ...suppsFor("ore22")],
  };

  // weekly: Lun/Mer/Ven allenamento ore17 (default slot), resto riposo
  const weekly = { mon:"ore17", tue:"riposo", wed:"ore17", thu:"riposo", fri:"ore17", sat:"riposo", sun:"riposo" };

  return { weekly, daytypes, overrides: {} };
};
```

Nota: `_MEAL_META` include chiavi come `PRE WO`/`POST WO`/`MERENDA`/`CENA` (vedi `parser.jsx`). Se una chiave non esiste, `mealsFor` va in errore → in Step 2 lo smoke lo cattura; adegua le chiavi a quelle realmente presenti in `_MEAL_META`.

- [ ] **Step 2: Smoke con stub `window` in Node**

Run:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App && node -e '
global.window = {}; global.atob = () => "";
const babel = require("@babel/core");
const code = babel.transformFileSync("parser.jsx", {presets:["@babel/preset-react"]}).code;
eval(code);
const c = window.buildDefaultNotifConfig();
const ok = c.weekly.mon === "ore17" && Array.isArray(c.daytypes.riposo) && c.daytypes.riposo.length > 0;
if (!ok) { console.error("SMOKE FAIL", JSON.stringify(c.weekly), c.daytypes.riposo && c.daytypes.riposo.length); process.exit(1); }
console.log("smoke OK — riposo reminders:", c.daytypes.riposo.length, "ore17:", c.daytypes.ore17.length);
'
```
Expected: `smoke OK — riposo reminders: N ore17: M` (N, M > 0). Se errore su chiave `_MEAL_META` mancante, correggi le chiavi in `mealsFor(...)`.

- [ ] **Step 3: Commit**

```bash
git add parser.jsx
git commit -m "feat(push): buildDefaultNotifConfig — schedule precompilato dai dati piano"
```

---

## Task 7: client — schermata Promemoria (toggle master + wiring)

**Files:**
- Create: `screens/promemoria.jsx`
- Modify: `index.html` (script dopo `impostazioni.jsx`, prima di `app.jsx`)
- Modify: `i18n.jsx` (chiavi nuove IT+EN)

**Interfaces:**
- Produces: `window.Promemoria` (componente React), route `"promemoria"`.
- Consumes: `window.pushAPI`, `window.buildDefaultNotifConfig`, `window.storage`, componenti `ui.jsx` (`UIHeader`/`UICard`/`UIRow` se presenti), `Icon`.

- [ ] **Step 1: Aggiungi le chiavi i18n in `i18n.jsx` (IT e EN)**

Nel dizionario IT e nel dizionario EN aggiungi (valori esempio; adegua al tono esistente):

```js
// IT
"Promemoria": "Promemoria",
"Attiva notifiche": "Attiva notifiche",
"Notifiche attive": "Notifiche attive",
"Le notifiche richiedono l'app installata sulla Home": "Le notifiche richiedono l'app installata sulla Home",
"Notifiche non supportate su questo dispositivo": "Notifiche non supportate su questo dispositivo",
"Permesso negato — riattiva da Impostazioni iOS": "Permesso negato — riattiva da Impostazioni iOS",
"Configurazione push mancante": "Configurazione push mancante",
"Orari per giorno": "Orari per giorno",
"Sposta allenamento": "Sposta allenamento",
"Giorno prima": "Giorno prima",
"Giorno dopo": "Giorno dopo",
"Rigenera orari dal piano": "Rigenera orari dal piano",
"Pasti": "Pasti",
"Integratori": "Integratori",
"Allenamento": "Allenamento",
"Riposo": "Riposo",
```

```js
// EN
"Promemoria": "Reminders",
"Attiva notifiche": "Enable notifications",
"Notifiche attive": "Notifications on",
"Le notifiche richiedono l'app installata sulla Home": "Notifications require the app installed to the Home Screen",
"Notifiche non supportate su questo dispositivo": "Notifications not supported on this device",
"Permesso negato — riattiva da Impostazioni iOS": "Permission denied — re-enable in iOS Settings",
"Configurazione push mancante": "Push configuration missing",
"Orari per giorno": "Times by day",
"Sposta allenamento": "Move workout",
"Giorno prima": "Day before",
"Giorno dopo": "Day after",
"Rigenera orari dal piano": "Regenerate times from plan",
"Pasti": "Meals",
"Integratori": "Supplements",
"Allenamento": "Workout",
"Riposo": "Rest",
```

- [ ] **Step 2: Crea `screens/promemoria.jsx` — struttura + toggle master + persistenza config**

Segui i pattern visivi esistenti (`ui.jsx`, `card`, CSS vars). Il componente carica `notifConfig` (o il default), gestisce lo stato abilitato e salva su ogni modifica (locale + `pushAPI.syncConfig`).

```jsx
// screens/promemoria.jsx — impostazioni notifiche push
const Promemoria = ({ device, onNav }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const [config, setConfig] = React.useState(() => {
    const saved = window.storage ? window.storage.get("notifConfig", null) : null;
    return saved || (window.buildDefaultNotifConfig ? window.buildDefaultNotifConfig() : { weekly:{}, daytypes:{}, overrides:{} });
  });
  const [enabled, setEnabled] = React.useState(() => window.storage ? window.storage.get("notifEnabled", false) : false);
  const [status, setStatus] = React.useState("");   // messaggio diagnostico
  const [selDay, setSelDay] = React.useState("ore17");

  const persist = (next) => {
    setConfig(next);
    if (window.storage) window.storage.set("notifConfig", next);
    if (window.pushAPI) window.pushAPI.syncConfig(next);
  };

  const onToggleMaster = async () => {
    if (!window.pushAPI) return;
    if (enabled) {
      await window.pushAPI.disable();
      setEnabled(false); setStatus("");
      return;
    }
    const res = await window.pushAPI.enable(config);
    if (res.ok) { setEnabled(true); setStatus(t("Notifiche attive")); }
    else {
      const map = {
        "unsupported": t("Notifiche non supportate su questo dispositivo"),
        "not-installed": t("Le notifiche richiedono l'app installata sulla Home"),
        "not-configured": t("Configurazione push mancante"),
        "denied": t("Permesso negato — riattiva da Impostazioni iOS"),
      };
      setStatus(map[res.error] || ("Errore: " + res.error));
    }
  };

  const regen = () => { if (window.buildDefaultNotifConfig) persist(window.buildDefaultNotifConfig()); };

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", letterSpacing:0.5, textTransform:"uppercase" }}>{t("Impostazioni")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight:600 }}>{t("Promemoria")}</h1>
      </div>

      {/* Master toggle */}
      <div className="card" style={{ padding:16, display:"flex", alignItems:"center", gap:12 }}>
        <Icon name="pill" size={20} color="var(--accent)" />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{t("Attiva notifiche")}</div>
          {status && <div className="muted" style={{ fontSize:12, marginTop:2 }}>{status}</div>}
        </div>
        <div className={`ios-toggle blue ${enabled ? "on" : ""}`} onClick={onToggleMaster} />
      </div>

      {/* placeholder: editor per giorno (Task 8) e sposta allenamento (Task 9) montati qui */}
      <PromemoriaEditor config={config} persist={persist} selDay={selDay} setSelDay={setSelDay} t={t} />
      <PromemoriaOverrides config={config} persist={persist} t={t} />

      <button onClick={regen} style={{ border:"1px solid var(--border)", background:"var(--card)", color:"var(--text)", borderRadius:14, padding:13, fontSize:14, fontWeight:600, cursor:"pointer" }}>
        {t("Rigenera orari dal piano")}
      </button>
    </div>
  );
};
window.Promemoria = Promemoria;
```

Nota: `PromemoriaEditor` e `PromemoriaOverrides` sono definiti nei Task 8 e 9 **nello stesso file, sopra** `Promemoria`. Fino ad allora, per far transformare il file, definisci due stub temporanei in cima:
```jsx
const PromemoriaEditor = () => null;
const PromemoriaOverrides = () => null;
```
(verranno sostituiti nei task successivi).

- [ ] **Step 3: Registra lo script in `index.html`** (dopo `screens/impostazioni.jsx`, prima di `app.jsx`):

```html
<script type="text/babel" src="screens/promemoria.jsx?v=20260714154025"></script>
```

- [ ] **Step 4: Valida Babel + presenza chiavi i18n**

Run:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('screens/promemoria.jsx', {presets:['@babel/preset-react']})" && node -e "require('@babel/core').transformFileSync('i18n.jsx', {presets:['@babel/preset-react']})"
```
Expected: nessun output.

- [ ] **Step 5: Commit**

```bash
git add screens/promemoria.jsx index.html i18n.jsx
git commit -m "feat(push): schermata Promemoria — toggle master + persistenza config + i18n"
```

---

## Task 8: client — editor orari per tipo di giornata + baseline settimanale

**Files:**
- Modify: `screens/promemoria.jsx` (sostituisci lo stub `PromemoriaEditor`)

**Interfaces:**
- Consumes: `config` (`{weekly, daytypes}`), `persist(next)`, `selDay`, `setSelDay`, `t` (props da `Promemoria`).
- Produces: componente `PromemoriaEditor` che modifica `config.weekly` e `config.daytypes[selDay]`.

- [ ] **Step 1: Sostituisci lo stub `const PromemoriaEditor = () => null;` con l'implementazione**

```jsx
const _DT_LABELS = { riposo:"Riposo", mattina:"Mattina", ore17:"Ore 17", ore21:"Ore 21", ore22:"Ore 22" };
const _WD_ORDER = [["mon","Lun"],["tue","Mar"],["wed","Mer"],["thu","Gio"],["fri","Ven"],["sat","Sab"],["sun","Dom"]];

const PromemoriaEditor = ({ config, persist, selDay, setSelDay, t }) => {
  const setWeekly = (wd, dt) => persist({ ...config, weekly: { ...config.weekly, [wd]: dt } });

  const setReminder = (idx, patch) => {
    const list = (config.daytypes[selDay] || []).map((r, i) => i === idx ? { ...r, ...patch } : r);
    persist({ ...config, daytypes: { ...config.daytypes, [selDay]: list } });
  };

  const list = config.daytypes[selDay] || [];
  const catLabel = { pasto: t("Pasti"), integratore: t("Integratori"), allenamento: t("Allenamento") };

  return (
    <div className="card" style={{ padding:16, display:"flex", flexDirection:"column", gap:14 }}>
      {/* Baseline settimanale */}
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", textTransform:"uppercase", marginBottom:8 }}>{t("Orari per giorno")}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {_WD_ORDER.map(([wd, lbl]) => (
            <div key={wd} style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:44, fontSize:13, fontWeight:600 }}>{lbl}</div>
              <select value={config.weekly[wd] || "riposo"} onChange={e => setWeekly(wd, e.target.value)}
                style={{ flex:1, padding:"7px 10px", borderRadius:9, background:"var(--card-2)", color:"var(--text)", border:"1px solid var(--border)", fontSize:13 }}>
                {Object.keys(_DT_LABELS).map(dt => <option key={dt} value={dt}>{t(_DT_LABELS[dt])}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Selettore tipo giornata da editare */}
      <div className="hscroll" style={{ marginLeft:0, marginRight:0 }}>
        {Object.keys(_DT_LABELS).map(dt => {
          const on = selDay === dt;
          return (
            <button key={dt} onClick={() => setSelDay(dt)} style={{
              padding:"7px 12px", border:0, borderRadius:999, marginRight:4, whiteSpace:"nowrap",
              background: on ? "var(--accent)" : "var(--card-2)", color: on ? "#fff" : "var(--text)",
              fontSize:12.5, fontWeight: on ? 600 : 500, cursor:"pointer",
            }}>{t(_DT_LABELS[dt])}</button>
          );
        })}
      </div>

      {/* Reminder del tipo giornata selezionato */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {list.map((r, i) => (
          <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderTop: i>0 ? "1px solid var(--border)" : "0" }}>
            <span style={{ fontSize:15 }}>{r.cat === "pasto" ? "🍽️" : r.cat === "integratore" ? "💊" : "🏋️"}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.label}</div>
              <div className="muted" style={{ fontSize:11 }}>{catLabel[r.cat]}</div>
            </div>
            <input type="time" value={r.time} onChange={e => setReminder(i, { time: e.target.value })}
              style={{ padding:"5px 8px", borderRadius:8, background:"var(--card-2)", color:"var(--text)", border:"1px solid var(--border)", fontSize:13 }} />
            <div className={`ios-toggle blue ${r.on ? "on" : ""}`} onClick={() => setReminder(i, { on: !r.on })} />
          </div>
        ))}
        {!list.length && <div className="muted" style={{ fontSize:12 }}>—</div>}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Valida Babel**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('screens/promemoria.jsx', {presets:['@babel/preset-react']})"`
Expected: nessun output.

- [ ] **Step 3: Commit**

```bash
git add screens/promemoria.jsx
git commit -m "feat(push): editor orari per tipo giornata + baseline settimanale"
```

---

## Task 9: client — flusso "Sposta allenamento" (override per data)

**Files:**
- Modify: `screens/promemoria.jsx` (sostituisci lo stub `PromemoriaOverrides`)

**Interfaces:**
- Consumes: `config` (`{weekly, daytypes, overrides}`), `persist(next)`, `t`.
- Produces: componente `PromemoriaOverrides`. Scrive `config.overrides[YYYY-MM-DD] = daytype`. Sposta un allenamento: origine → `"riposo"`, target (giorno prima/dopo) → il daytype di allenamento originale.

- [ ] **Step 1: Sostituisci lo stub `const PromemoriaOverrides = () => null;`**

```jsx
// Helper: YYYY-MM-DD locale + weekday key da una Date
function _ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const _WD_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
const _TRAINING = ["mattina","ore17","ore21","ore22"];

const PromemoriaOverrides = ({ config, persist, t }) => {
  const [pick, setPick] = React.useState(() => _ymd(new Date()));

  // daytype effettivo di una data (override → weekly)
  const daytypeOf = (ymd) => {
    if (config.overrides && config.overrides[ymd]) return config.overrides[ymd];
    const wd = _WD_KEYS[new Date(ymd + "T12:00:00").getDay()];
    return (config.weekly && config.weekly[wd]) || "riposo";
  };

  const move = (dir) => {
    const src = pick;
    const srcType = daytypeOf(src);
    if (!_TRAINING.includes(srcType)) return; // niente da spostare se è riposo
    const d = new Date(src + "T12:00:00");
    d.setDate(d.getDate() + (dir === "after" ? 1 : -1));
    const dst = _ymd(d);
    persist({ ...config, overrides: { ...config.overrides, [src]: "riposo", [dst]: srcType } });
  };

  const clearOverride = (ymd) => {
    const next = { ...config.overrides }; delete next[ymd];
    persist({ ...config, overrides: next });
  };

  const todayYmd = _ymd(new Date());
  const active = Object.keys(config.overrides || {}).filter(k => k >= todayYmd).sort();

  return (
    <div className="card" style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", textTransform:"uppercase" }}>{t("Sposta allenamento")}</div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <input type="date" value={pick} min={todayYmd} onChange={e => setPick(e.target.value)}
          style={{ flex:1, padding:"7px 10px", borderRadius:9, background:"var(--card-2)", color:"var(--text)", border:"1px solid var(--border)", fontSize:13 }} />
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => move("before")} style={{ flex:1, border:0, borderRadius:10, padding:"10px", background:"var(--card-2)", color:"var(--text)", fontSize:13, fontWeight:600, cursor:"pointer" }}>← {t("Giorno prima")}</button>
        <button onClick={() => move("after")} style={{ flex:1, border:0, borderRadius:10, padding:"10px", background:"var(--card-2)", color:"var(--text)", fontSize:13, fontWeight:600, cursor:"pointer" }}>{t("Giorno dopo")} →</button>
      </div>
      {active.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {active.map(k => (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5 }}>
              <span className="num" style={{ flex:1 }}>{k} → {config.overrides[k]}</span>
              <button onClick={() => clearOverride(k)} style={{ border:0, background:"transparent", color:"var(--danger)", fontSize:12, cursor:"pointer" }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Valida Babel**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('screens/promemoria.jsx', {presets:['@babel/preset-react']})"`
Expected: nessun output.

- [ ] **Step 3: Commit**

```bash
git add screens/promemoria.jsx
git commit -m "feat(push): flusso sposta allenamento (override per data) + lista override attivi"
```

---

## Task 10: client — voce d'accesso in Impostazioni + routing

**Files:**
- Modify: `screens/impostazioni.jsx` (aggiungi una riga che naviga a `"promemoria"`)
- Modify: `app.jsx` (aggiungi il case route `"promemoria"` → `<Promemoria .../>`)

**Interfaces:**
- Consumes: `window.Promemoria`; il router in `app.jsx` (pattern esistente per le altre screen); `onNav`.
- Produces: navigazione utente Impostazioni → Promemoria.

- [ ] **Step 1: Individua nel router di `app.jsx` come sono montate le screen** (es. `screen === "impostazioni" ? <Impostazioni .../> : ...`). Aggiungi il ramo per `"promemoria"` **replicando il pattern esatto** usato dalle altre screen (stesse props passate, es. `device`, `onNav`).

Esempio (adatta ai nomi reali del file):
```jsx
{screen === "promemoria" && <Promemoria device={device} onNav={navigate} />}
```

- [ ] **Step 2: In `screens/impostazioni.jsx`, aggiungi una riga/bottone nella lista impostazioni** che chiama `onNav("promemoria")`, seguendo il pattern delle altre voci (icona + label). Label: `t("Promemoria")`, icona `pill` (esiste in `icons.jsx`).

```jsx
<button onClick={() => onNav("promemoria")} /* ...stessi stili delle altre righe... */>
  <Icon name="pill" size={18} color="var(--accent)" />
  <span>{t("Promemoria")}</span>
</button>
```

- [ ] **Step 3: Valida Babel dei due file**

Run:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('app.jsx', {presets:['@babel/preset-react']})" && node -e "require('@babel/core').transformFileSync('screens/impostazioni.jsx', {presets:['@babel/preset-react']})"
```
Expected: nessun output.

- [ ] **Step 4: Commit**

```bash
git add app.jsx screens/impostazioni.jsx
git commit -m "feat(push): accesso Impostazioni → Promemoria + route"
```

---

## Task 11: Deploy app-code + QA on-device

**Files:** nessuna modifica di codice; deploy + verifica.

> Prerequisiti: Task 3 e 5-bis completati (Worker online + VAPID/URL nel client).

- [ ] **Step 1: Deploy completo (bump cache obbligatorio)**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App && "./Deploy GitHub Pages.command"
```
(oppure replica: bump `CACHE_NAME` in `sw.js` + `?v=` in `index.html`, poi `git add -A && git commit && git push origin main`.)

- [ ] **Step 2: SW sticky** — su iPhone chiudi la PWA dal multitasking e riaprila (così il nuovo SW prende il controllo).

- [ ] **Step 3: QA on-device (checklist)**
  - [ ] Impostazioni → Promemoria → "Attiva notifiche" → compare il prompt permesso iOS → concedi.
  - [ ] `curl .../health` mostra `subs: 1`.
  - [ ] Imposta un reminder di test 1–2 minuti nel futuro (nel tipo di giornata di oggi) → arriva la notifica ad app chiusa.
  - [ ] Tap sulla notifica → apre/focalizza l'app.
  - [ ] "Sposta allenamento" a giorno dopo → verifica in `.../health` / comportamento il giorno target.
  - [ ] Disattiva notifiche → `subs: 0`.
  - [ ] (Se hai 2 device) attiva su entrambi → `subs: 2`, entrambi ricevono.

- [ ] **Step 4: Aggiorna la memoria** (`redesign-status` o nuova `notifiche-push`) con lo stato LIVE + eventuali quirk iOS emersi.

---

## Self-Review

**Spec coverage:**
- §3 architettura (4 pezzi) → Task 1-2 (worker), 4 (sw), 5 (client lib), 7-9 (UI). ✓
- §4.1 KV shape → Task 1 (readConfig default) + Task 2 (uso). ✓
- §4.2 storage locale `notifConfig/notifEnabled/notifSub` → Task 5 + 7. ✓
- §4.3 endpoint `/save /unsubscribe /health` → Task 1. ✓
- §5 flusso permessi (support/installed/permission/subscribe/pushsubscriptionchange) → Task 5. **Gap:** `pushsubscriptionchange` non ha un task dedicato → vedi nota sotto.
- §6 sw.js push+click → Task 4. ✓
- §7 cron (Intl Roma, override→weekly, due, GC 404/410, prune) → Task 2. ✓
- §8 UI (master, weekly, editor daytype, sposta allenamento) → Task 7-9. ✓
- §9 precompilazione da `_MEAL_META`/`_INTEGRATORI` → Task 6. ✓
- §10 VAPID → Task 3 + 5-bis. ✓
- §11 io/Lorenzo → Task 3, 5-bis, 11 marcati OPS. ✓
- §12 scope v1 → coperto; fuori-scope non pianificato. ✓
- §13 rischi → libreria per crypto (Task 2), GC (Task 2), evergreen weekly (Task 1/2). ✓

**Gap trovato — `pushsubscriptionchange`:** la spec §5 lo cita. Aggiungo qui la nota per l'esecuzione: in Task 4 (sw.js) aggiungere anche:
```js
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const reg = await self.registration;
      // Ri-subscribe non è possibile senza la VAPID key nel SW → si delega al client:
      // al prossimo avvio pushAPI.enable() rifà la subscription. Qui best-effort: nulla di distruttivo.
    } catch (_) {}
  })());
});
```
Decisione: la ri-subscription robusta la fa il **client** al prossimo avvio (in `app.jsx`, all'onReady, se `notifEnabled` è true, chiama `pushAPI.enable(config)` che fa `getSubscription()||subscribe()` e re-`/save`). **Aggiungere in Task 10 Step 1-bis** un hook in `app.jsx` onReady:
```js
if (window.pushAPI && window.storage && window.storage.get("notifEnabled", false)) {
  const cfg = window.storage.get("notifConfig", null);
  if (cfg) window.pushAPI.enable(cfg); // re-subscribe idempotente + re-save
}
```

**Placeholder scan:** `PLACEHOLDER_KV_ID` e le const vuote `VAPID_PUBLIC`/`_PUSH_BASE` sono valori d'ambiente riempiti in task OPS espliciti (3, 5-bis), non placeholder di piano. Nessun "TBD/TODO" logico. ✓

**Type consistency:** reminder `{id,cat,label,time,on}` uniforme in Task 2 (`dueReminders`/`notifText`), 6 (builder), 8 (editor). `daytype`/`weekday` keys uniformi. `config` `{weekly,daytypes,overrides}` uniforme client↔worker. Endpoint path uniformi (`/save`,`/unsubscribe`,`/health`). ✓

**Nota validazione:** progetto senza test runner → i "test" sono Babel transform / `node --check` / smoke script / QA on-device, coerente con CLAUDE.md.
