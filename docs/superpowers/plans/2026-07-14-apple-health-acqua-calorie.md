# Apple Salute → App (acqua + calorie bruciate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare in Dashboard l'acqua e le calorie bruciate di oggi lette da Apple Salute (sola lettura), portate via Apple Shortcut → push-worker → app.

**Architecture:** Un Apple Shortcut sul telefono legge Salute e fa `POST /healthdata` al push-worker (KV, token-guarded). L'app fa `GET /healthdata`, tiene i valori in stato React e li mostra in Dashboard; il Coach usa l'acqua reale. Direzione unica Salute→app, solo dati di oggi.

**Tech Stack:** React 18 via CDN + Babel (no build), `window.storage` (IndexedDB), Cloudflare Worker + KV, Apple Shortcuts.

## Global Constraints

- **No build step.** Client `.jsx`: MAI `import`/`export`; globali via `window.X`. Persistenza = `window.storage` only.
- **Il Worker** (`push-worker/worker.js`) è ES modules + npm (separato dal client) — corretto lì.
- **Nuovo file client** va aggiunto a `index.html` e a `STATIC_ASSETS` in `sw.js` (qui NON creiamo nuovi file client → non serve).
- **Validazione (no test runner):** client `.jsx` = `node -e "require('@babel/core').transformFileSync('<file>.jsx', {presets:['@babel/preset-react']})"`; worker = `node --check`; endpoint = `curl`.
- **Deploy app-code** (`.jsx`) = bump `CACHE_NAME` (sw.js) + `?v=` (index.html) via `Deploy GitHub Pages.command`. SW sticky iOS.
- **Worker deploy:** `cd push-worker && ./node_modules/.bin/wrangler deploy` (wrangler è già autenticato all'account di Lorenzo in questa sessione).
- **Base URL worker:** `https://fitness-hub-push.lorefara97.workers.dev` (già in `push.jsx` come `_PUSH_BASE`).
- **Contratti dati:**
  - KV chiave `healthdata` = `{ date:"YYYY-MM-DD", waterMl:number, kcal:number, updatedAt:number }`.
  - `POST /healthdata` body `{ date, waterMl, kcal, token }` → 401 se `token !== env.HEALTH_TOKEN`.
  - `GET /healthdata` → `{ date, waterMl, kcal, updatedAt }` o `{}`.
  - Unità: acqua **mL** (intero), mostrata in **L** (`waterMl/1000`); target 3 L (3000 mL). Calorie **kcal** (intero).
  - "Freschezza": mostrare i valori solo se `healthData.date === todayKey()`.

---

## Task 1: Worker — endpoint `/healthdata` (GET + POST token-guarded)

**Files:**
- Modify: `push-worker/worker.js` (aggiungi 2 rami nel `fetch` handler + helper)

**Interfaces:**
- Consumes: `readConfig`? No — usa una entry KV separata `healthdata`. Usa `env.PUSH_KV`, `json()`, `CORS` già presenti.
- Produces: `GET /healthdata`, `POST /healthdata`. KV key `"healthdata"`.

- [ ] **Step 1: Aggiungi i due rami nel `fetch` handler, subito prima di `return json({ ok: false, error: "not found" }, 404);`**

```js
    if (request.method === "GET" && url.pathname === "/healthdata") {
      const raw = await env.PUSH_KV.get("healthdata");
      return json(raw ? JSON.parse(raw) : {});
    }

    if (request.method === "POST" && url.pathname === "/healthdata") {
      let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
      if (!body || body.token !== env.HEALTH_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);
      const rec = {
        date: String(body.date || "").slice(0, 10),
        waterMl: Math.max(0, Math.round(Number(body.waterMl) || 0)),
        kcal: Math.max(0, Math.round(Number(body.kcal) || 0)),
        updatedAt: Date.now(),
      };
      await env.PUSH_KV.put("healthdata", JSON.stringify(rec));
      return json({ ok: true, ...rec });
    }
```

- [ ] **Step 2: Valida sintassi**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App/push-worker && node --check worker.js`
Expected: nessun output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add push-worker/worker.js
git commit -m "feat(health): endpoint /healthdata GET+POST (KV, token) sul push-worker"
```

---

## Task 2: [OPS-agent] Genera HEALTH_TOKEN, deploy worker, verifica

**Files:** nessuno nel repo (secret d'ambiente). Al termine: comunica `HEALTH_TOKEN` a Lorenzo (per lo Shortcut, Task 8).

> Eseguibile dall'agent: wrangler è già autenticato in questa sessione.

- [ ] **Step 1: Genera un token casuale e impostalo come secret**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App/push-worker
TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
echo "HEALTH_TOKEN=$TOKEN"   # annota: serve a Lorenzo per lo Shortcut
printf "%s" "$TOKEN" | ./node_modules/.bin/wrangler secret put HEALTH_TOKEN
```

- [ ] **Step 2: Deploy del worker**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App/push-worker && ./node_modules/.bin/wrangler deploy 2>&1 | grep -i "Current Version"
```

- [ ] **Step 3: Verifica endpoint (POST col token → GET)**

```bash
BASE=https://fitness-hub-push.lorefara97.workers.dev
TODAY=$(date +%F)
curl -s -X POST "$BASE/healthdata" -H "Content-Type: application/json" -d "{\"date\":\"$TODAY\",\"waterMl\":1600,\"kcal\":540,\"token\":\"$TOKEN\"}"; echo
curl -s "$BASE/healthdata"; echo
# atteso: {"ok":true,...} poi {"date":"<oggi>","waterMl":1600,"kcal":540,"updatedAt":...}
# controllo negativo: token errato → 401
curl -s -X POST "$BASE/healthdata" -H "Content-Type: application/json" -d "{\"date\":\"$TODAY\",\"waterMl\":1,\"kcal\":1,\"token\":\"x\"}"; echo
```
Expected: primo POST `ok:true`; GET riporta i valori; POST con token errato `{"ok":false,"error":"unauthorized"}`.

- [ ] **Step 4:** Registra `HEALTH_TOKEN` (da consegnare a Lorenzo nel Task 8). Nessun commit (secret).

---

## Task 3: Client — `window.healthAPI.get()` in push.jsx

**Files:**
- Modify: `push.jsx` (aggiungi `window.healthAPI` dentro l'IIFE, riusa `_PUSH_BASE`)

**Interfaces:**
- Consumes: `_PUSH_BASE` (const già nell'IIFE).
- Produces: `window.healthAPI.get()` → Promise che risolve `{ date, waterMl, kcal, updatedAt }` o `null`.

- [ ] **Step 1: Dentro l'IIFE di `push.jsx`, prima di `window.pushAPI = pushAPI;`, aggiungi**

```jsx
  window.healthAPI = {
    async get() {
      if (!_PUSH_BASE) return null;
      try {
        const r = await fetch(_PUSH_BASE + "/healthdata", { cache: "no-store" });
        const d = await r.json();
        return (d && typeof d.waterMl === "number") ? d : null;
      } catch (_) { return null; }
    },
  };
```

- [ ] **Step 2: Valida**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('push.jsx', {presets:['@babel/preset-react']})"`
Expected: nessun output.

- [ ] **Step 3: Commit**

```bash
git add push.jsx
git commit -m "feat(health): window.healthAPI.get() (legge /healthdata)"
```

---

## Task 4: App — stato `healthData` + fetch + props (rimuove hydration manuale)

**Files:**
- Modify: `app.jsx`

**Interfaces:**
- Consumes: `window.healthAPI.get()` (Task 3); `window.todayKey`.
- Produces: `state.healthData` (`{date,waterMl,kcal,updatedAt}|null`) passato a `Dashboard` (prop `healthData`) e a `Coach` (prop `healthData`). Rimuove le prop `hydration`/`setHydration`.

- [ ] **Step 1: In `initState()` sostituisci la riga `hydration` con `healthData` (cache locale per display offline)**

Da:
```js
      hydration:    st.get(`hydration_${today}`, 3),
```
A:
```js
      healthData:   st.get("healthData", null),
```

- [ ] **Step 2: Nel default di `useState` (la riga lunga `React.useState({ screen: ... })`), sostituisci `hydration: 3,` con `healthData: null,`**

```js
  const [state, setStateRaw] = React.useState({ screen: initialScreen, scheda: "Upper A", isHome: false, activities: [], checkIn: { sleep: 4, energy: 4, ailments: "" }, healthData: null, bodyWeight: 100, theme: "system", spesaChecked: {}, spesaFreq: 1 });
```

- [ ] **Step 3: In `setState` rimuovi la persistenza di `hydration`** — elimina la riga:
```js
      if (next.hydration  !== prev.hydration)  window.storage.set(`hydration_${t}`, next.hydration);
```
(nessuna sostituzione: `healthData` viene salvato dal fetch, non dall'editing utente.)

- [ ] **Step 4: Aggiungi un helper di fetch salute + chiamalo all'init e nel polling.**

Nell'effect di init (quello con `_reconcileRepoFiles().finally(...)`), dopo `setInitialized(true);` aggiungi una chiamata `pullHealth();`. Definisci `pullHealth` (vicino a `pullAndApply`, o subito prima dell'effect di init) così:
```js
  const pullHealth = React.useCallback(() => {
    if (!window.healthAPI) return;
    window.healthAPI.get().then(d => {
      if (!d) return;
      if (window.storage) window.storage.set("healthData", d);
      setStateRaw(prev => ({ ...prev, healthData: d }));
    });
  }, []);
```
E nell'effect di init, dentro il `.finally` finale:
```js
    _reconcileRepoFiles().finally(() => _cloudSync()).finally(() => {
      const s = initState();
      setStateRaw(s);
      setLang(window.storage ? window.storage.get("lang", "it") : "it");
      setInitialized(true);
      pullHealth();
    });
```

- [ ] **Step 5: Nel `pullAndApply` (effect di re-sync periodico) aggiungi `pullHealth()` e togli `hydration` dal merge.**

Sostituisci il corpo di `pullAndApply` così (rimuovi la riga `hydration: s.hydration,` e aggiungi `pullHealth()`):
```js
    const pullAndApply = () => {
      if (document.visibilityState !== "visible") return;
      pullHealth();
      _cloudSync({ pesiMs: 6000, settingsMs: 8000 }).finally(() => {
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
```

- [ ] **Step 6: Aggiorna le props passate a Dashboard e Coach.**

Dashboard (nel `case "dashboard":`) — sostituisci:
```js
        hydration={state.hydration} setHydration={(v) => set(st => ({ ...st, hydration: v }))}
```
con:
```js
        healthData={state.healthData}
```

Coach (nel `case "coach":`) — sostituisci `hydration={state.hydration}` con `healthData={state.healthData}`:
```js
      return <Coach {...pass} activities={state.activities} checkIn={state.checkIn} healthData={state.healthData} bodyWeight={state.bodyWeight} />;
```

- [ ] **Step 7: Valida**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('app.jsx', {presets:['@babel/preset-react']})"`
Expected: nessun output.

- [ ] **Step 8: Commit**

```bash
git add app.jsx
git commit -m "feat(health): stato healthData + fetch (init/polling); rimuove hydration manuale"
```

---

## Task 5: Dashboard — idratazione sola lettura + card calorie bruciate

**Files:**
- Modify: `screens/dashboard.jsx` (riscrive `HydrationCard`, aggiunge `CalorieCard`, aggiorna firma `Dashboard` + render)
- Modify: `i18n.jsx` (chiavi nuove IT+EN)

**Interfaces:**
- Consumes: prop `healthData` (`{date,waterMl,kcal,updatedAt}|null`) da `Dashboard`.
- Produces: `HydrationCard({healthData})`, `CalorieCard({healthData})`.

- [ ] **Step 1: Aggiungi le chiavi i18n in `i18n.jsx`** (dopo `"Idratazione": {...}` o vicino; formato dict condiviso `"IT": { en: "EN" }`)

```js
  "Calorie bruciate": { en: "Calories burned" },
  "Nessun dato da Salute oggi": { en: "No Health data today" },
  "da Apple Salute": { en: "from Apple Health" },
  "agg.": { en: "upd." },
  "Registra l'acqua in Apple Salute": { en: "Log water in Apple Health" },
```
(Se `"Idratazione"` non c'è, aggiungila: `"Idratazione": { en: "Hydration" }` — verifica prima con grep per non duplicare.)

- [ ] **Step 2: Sostituisci l'intero componente `HydrationCard` (linee ~95-131) con la versione sola-lettura**

```jsx
// ── Idratazione (sola lettura da Apple Salute) ─────────────────────────────
const HydrationCard = ({ healthData }) => {
  const t = useT();
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const fresh = healthData && healthData.date === today && typeof healthData.waterMl === "number";
  const waterMl = fresh ? healthData.waterMl : 0;
  const upd = fresh && healthData.updatedAt
    ? new Date(healthData.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="ui-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="ui-cap">{t("Idratazione")}</span>
        {fresh
          ? <span className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>
              {(waterMl / 1000).toFixed(2)}<span style={{ color: "var(--text-2)", fontWeight: 500 }}> / 3.00 L</span>
            </span>
          : <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Nessun dato da Salute oggi")}</span>}
      </div>
      {fresh && <div><UIProgress value={waterMl / 3000} /></div>}
      <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--text-3)" }}>
        {upd ? `${t("da Apple Salute")} · ${t("agg.")} ${upd}` : t("Registra l'acqua in Apple Salute")}
      </div>
    </div>
  );
};

// ── Calorie bruciate (sola lettura da Apple Salute) ────────────────────────
const CalorieCard = ({ healthData }) => {
  const t = useT();
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const fresh = healthData && healthData.date === today && typeof healthData.kcal === "number";
  const upd = fresh && healthData.updatedAt
    ? new Date(healthData.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="ui-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="ui-cap">{t("Calorie bruciate")}</span>
        {fresh
          ? <span className="tnum" style={{ fontSize: 15, fontWeight: 700 }}>
              {Math.round(healthData.kcal)}<span style={{ color: "var(--text-2)", fontSize: 11, fontWeight: 500 }}> kcal</span>
            </span>
          : <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Nessun dato da Salute oggi")}</span>}
      </div>
      {upd && <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--text-3)" }}>{`${t("da Apple Salute")} · ${t("agg.")} ${upd}`}</div>}
    </div>
  );
};
```

- [ ] **Step 3: Aggiorna la firma di `Dashboard`** — sostituisci `hydration, setHydration,` con `healthData,` nell'elenco parametri:
```js
const Dashboard = ({ device, onNav, activities, addActivity, checkIn, setCheckIn, healthData, bodyWeight, setBodyWeight }) => {
```

- [ ] **Step 4: Aggiorna il render** — sostituisci `<HydrationCard hydration={hydration} setHydration={setHydration} />` con:
```jsx
      <HydrationCard healthData={healthData} />
      <CalorieCard healthData={healthData} />
```

- [ ] **Step 5: Valida**

Run:
```bash
cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('screens/dashboard.jsx', {presets:['@babel/preset-react']})" && node -e "require('@babel/core').transformFileSync('i18n.jsx', {presets:['@babel/preset-react']})"
```
Expected: nessun output.

- [ ] **Step 6: Commit**

```bash
git add screens/dashboard.jsx i18n.jsx
git commit -m "feat(health): Dashboard idratazione sola-lettura + card Calorie bruciate da Salute"
```

---

## Task 6: Coach — usa l'acqua reale da Salute

**Files:**
- Modify: `screens/coach.jsx`

**Interfaces:**
- Consumes: prop `healthData` (da app.jsx, Task 4).
- Produces: `_buildSystemPrompt` usa `waterMl` invece di `hydration`.

- [ ] **Step 1: In `_buildSystemPrompt`, cambia il parametro e il blocco idratazione.**

Firma: sostituisci `hydration` con `waterMl` nell'oggetto destrutturato:
```js
function _buildSystemPrompt({ activities, checkIn, waterMl, bodyWeight, lang }) {
```
Blocco idratazione (sostituisci le righe 57-60):
```js
  // ── Idratazione (da Apple Salute) ───────────────────────────────────────────
  if (typeof waterMl === "number") {
    prompt += `\nIdratazione: ${(waterMl / 1000).toFixed(2)}L su 3L target.`;
  }
```

- [ ] **Step 2: Aggiorna il componente `Coach`** — firma da `hydration` a `healthData`, e passa `waterMl` a `_buildSystemPrompt`.

Firma:
```js
const Coach = ({ device, activities = [], checkIn, healthData, bodyWeight }) => {
```
Nella chiamata `_buildSystemPrompt({ activities, checkIn, hydration, bodyWeight, lang })` sostituisci con il calcolo di `waterMl` fresco:
```js
        systemPrompt: _buildSystemPrompt({
          activities, checkIn, bodyWeight, lang,
          waterMl: (healthData && healthData.date === (window.todayKey ? window.todayKey() : "") && typeof healthData.waterMl === "number") ? healthData.waterMl : null,
        }),
```

- [ ] **Step 3: Valida**

Run: `cd ~/Documents/Web\ Apps/Fitness\ App && node -e "require('@babel/core').transformFileSync('screens/coach.jsx', {presets:['@babel/preset-react']})"`
Expected: nessun output.

- [ ] **Step 4: Commit**

```bash
git add screens/coach.jsx
git commit -m "feat(health): Coach usa l'acqua reale da Salute (waterMl) invece dei bicchieri manuali"
```

---

## Task 7: Deploy Pages

**Files:** deploy (bump cache). Prerequisito: Task 2 (worker live).

- [ ] **Step 1: Deploy app-code**

```bash
cd ~/Documents/Web\ Apps/Fitness\ App && SW_HASH=$(date '+%Y%m%d%H%M%S') && sed -i '' "s/const CACHE_NAME = \"fitness-hub-[^\"]*\"/const CACHE_NAME = \"fitness-hub-v3-${SW_HASH}\"/" sw.js && sed -i '' "s/?v=[A-Za-z0-9]*/?v=${SW_HASH}/g" index.html && git add sw.js index.html && git commit -m "🏋️ Deploy $(date '+%Y-%m-%d %H:%M') — Apple Salute acqua+calorie" && git push origin main
```

- [ ] **Step 2: Verifica build Pages + file live**

```bash
for i in $(seq 1 8); do ST=$(gh api repos/Fara2106/fitness-hub/pages/builds/latest --jq .status 2>/dev/null); echo "$ST"; [ "$ST" = built ] && break; sleep 12; done
curl -s "https://fara2106.github.io/fitness-hub/screens/dashboard.jsx?cb=$(date +%s)" | grep -c "CalorieCard"
```
Expected: build `built`; grep ≥ 1.

---

## Task 8: [OPS — Lorenzo] Costruisci lo Shortcut + automazione

**Files:** nessuno. Serve `HEALTH_TOKEN` (dal Task 2).

- [ ] **Step 1:** Comandi Rapidi → nuovo comando **"Sync Salute → Fitness Hub"**.
- [ ] **Step 2:** *Trova campioni di salute* → Tipo **Acqua**, intervallo **Oggi** → *Calcola statistiche* **Somma** → converti in **mL** (variabile `waterMl`).
- [ ] **Step 3:** *Trova campioni di salute* → Tipo **Energia attiva**, intervallo **Oggi** → *Calcola statistiche* **Somma** (kcal) (variabile `kcal`).
- [ ] **Step 4:** *Data* di oggi formattata `YYYY-MM-DD` (variabile `date`).
- [ ] **Step 5:** *Ottieni contenuto di URL* → **POST** a `https://fitness-hub-push.lorefara97.workers.dev/healthdata`, header `Content-Type: application/json`, corpo JSON: `{ "date": <date>, "waterMl": <waterMl>, "kcal": <kcal>, "token": "<HEALTH_TOKEN>" }`.
- [ ] **Step 6:** Automazione → *Ora del giorno* (es. ogni ora) → esegui il comando, **"Chiedi prima di eseguire" OFF**.
- [ ] **Step 7: QA** — logga un po' d'acqua in Salute, fai girare il comando, apri l'app: la card Idratazione mostra i litri + "agg. HH:MM" e la card Calorie mostra i kcal. Il Coach cita l'acqua reale.

---

## Self-Review

**Spec coverage:**
- §3.1 endpoint POST/GET /healthdata + token → Task 1. ✓
- §3.2 KV `healthdata` → Task 1. ✓
- §3.3 HEALTH_TOKEN secret → Task 2. ✓
- §4.1 app fetch init+polling + stato healthData → Task 4. ✓
- §4.2 idratazione sola lettura (via +/-) → Task 5 (HydrationCard riscritta, niente bottoni/setHydration). ✓
- §4.3 calorie readout → Task 5 (CalorieCard). ✓
- §4.4 Coach acqua reale → Task 6. ✓
- §4.5 hydration legacy rimosso → Task 4 (initState/state/setState/pullAndApply) + Task 5 (Dashboard) + Task 6 (Coach). ✓
- §5 Shortcut → Task 8. ✓
- §9 validazione → ogni task ha Babel/node --check/curl; QA on-device Task 8. ✓

**Placeholder scan:** nessun TBD/TODO. `HEALTH_TOKEN` è un secret generato in Task 2, non un placeholder. ✓

**Type consistency:** `healthData` `{date,waterMl,kcal,updatedAt}` uniforme worker↔healthAPI↔app↔Dashboard↔Coach. Prop `healthData` sostituisce `hydration`/`setHydration` in modo coerente in app.jsx (Task 4), Dashboard (Task 5), Coach (Task 6). `waterMl` (mL) usato ovunque; display in L via `/1000`. ✓

**Nota cleanup:** la chiave storage per-giorno `hydration_<date>` resta gestita dal regex di `_cleanupOldDailyKeys` (`hydration_` è nel pattern) — le vecchie chiavi si auto-cancellano dopo 90 giorni; non serve toccare il regex.
