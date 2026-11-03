# Fase 1 — Backend sync (Cloudflare Worker + D1) e migrazione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un nuovo backend (Worker `fitness-hub-api` + database D1) con API di sync offline-first a token e una migrazione idempotente che porta dentro scheda, dieta e dati attuali. (Niente proxy del Coach: l'IA gira sul dispositivo, decisione di Lorenzo del 2026-11-03.)

**Architecture:** Store generico a record (`collection`, `id`, `data` JSON) con numero di sequenza server per il cursore di pull e last-writer-wins per record. La logica vive in moduli ES puri (store, http, converter) testati in Node con `node:sqlite` dietro un adattatore che imita l'API D1. Il Worker attuale `fitness-hub-proxy` (Sheets) resta acceso e intatto fino alla fase 2.

**Tech Stack:** JavaScript ES modules, Cloudflare Workers + D1, `wrangler` 4.156.2 (via `npx`), test con `node --test` + `node:sqlite` (Node 26), zero dipendenze runtime.

**Spec:** `docs/superpowers/specs/2026-11-03-app-nativa-swift-design.md` (sezioni 6, 7, 9, 12)

## Global Constraints

- Nessun segreto nel repo (repo pubblico, GitHub Pages serve tutto). Token e chiavi solo come secret del Worker o fuori dal repo.
- Utente unico, accesso con token personale lungo (`Authorization: Bearer <token>`), confronto a tempo costante.
- Last-writer-wins **per record**; eliminazioni come tombstone (`deleted: true`), mai DELETE fisico via API.
- Offline-first: ogni modifica porta `updatedAt` del client (ms epoch) e `deviceId`.
- Nessuna integrazione Groq/IA nel backend: il Coach usa l'IA del dispositivo; il backend sincronizza solo `coachMessage`.
- CORS: origine `https://fara2106.github.io` e `http://localhost:*`/`http://127.0.0.1:*` (sviluppo); richieste senza `Origin` (app native) ammesse — protegge il token.
- Gli integratori della dieta migrata vengono SOLO dal blocco `INTEGRATORI` del file (via `parseDieta` di `parser.jsx`), mai dalla lista fissa se il file non ne ha.
- Il Worker legacy `fitness-hub-proxy`, il foglio Google e la PWA NON vengono modificati in questa fase.
- Tutti i comandi di test da `backend/`: `node --test test/`.

## Decisioni di questa fase (chi esegue non le rimette in discussione)

- **Piani come documento unico**: `workoutPlan` e `dietPlan` sono un record ciascuno con giorni/esercizi (o varianti/pasti/integratori) annidati, ognuno con `id` UUID stabile. Si modificano mensilmente da un device alla volta: LWW sul piano intero è accettabile. I log giornalieri sono invece granulari (un record per serie, spunta, giorno).
- **Collezioni ammesse** (whitelist): `workoutPlan`, `dietPlan`, `dayState`, `setLog`, `workoutSession`, `mealCheck`, `supplementCheck`, `bodyWeight`, `bodyMeasure`, `shoppingCheck`, `shoppingExtra`, `exerciseNote`, `personalRecord`, `coachMessage`, `settings`.
- **Id deterministici** per i log: `dayState` = `YYYY-MM-DD`; `setLog` = `${date}:${exerciseId}:${setIndex}`; `workoutSession` = `${date}:${dayId}`; `mealCheck` = `${date}:${mealId}`; `supplementCheck` = `${date}:${supplementId}`; `bodyWeight`/`bodyMeasure` = data; `exerciseNote`/`personalRecord` = nome esercizio minuscolo; `settings` = chiave. Così migrazioni ripetute e retry non duplicano.
- **Nomi**: Worker `fitness-hub-api`, database D1 `fitness-hub-db`, secret `SYNC_TOKEN`. Token salvato in locale in `~/.config/fitness-hub/sync-token` (permessi 600), mai nel repo.

## Formato dei record (contratto con PWA e app Swift)

```
Change (client → server):  { collection, id, data: object|null, updatedAt: number, deleted?: boolean }
Record (server → client):  { collection, id, data, updatedAt, deleted, deviceId, seq }
POST /v1/sync  req: { deviceId: string, cursor: number, changes: Change[] }
               res: { cursor: number, more: boolean, changes: Record[], applied: number, stale: number }
GET  /v1/health res: { ok: true, version: "1" }
```

`workoutPlan.data`: `{ name, status: "active"|"archived", validFrom, validTo|null, days: [{ id, name, focus: string[], exercises: [{ id, name, sets: number, reps: string, restSec: number, notes, muscles: string[], alternatives: string[] }] }] }`

`dietPlan.data`: `{ name, status, validFrom, validTo|null, variants: [{ id, key, name, training: { time: "HH:MM" }|null, meals: [{ id, name, time: "HH:MM", options: [{ id, text }], lines: [{ id, label, choices: string[] }] }], supplements: [{ id, name, moment, time: "HH:MM" }] }] }`
(`options` = "scegli 1"; `lines` = componenti sempre presenti con eventuali alternative; `key` = `riposo|mattina|ore17|ore21|ore22` per le varianti migrate.)

## Review Focus

1. **Orologio di un device sbagliato** (es. 2 ore avanti): `updatedAt` nel futuro non deve far vincere quel device per sempre → il server limita `updatedAt` a `now + 5 min`. Test in Task 1.
2. **Stessa modifica rimandata** (retry dopo rete caduta): nessun duplicato, risultato identico. Test in Task 1.
3. **Device offline che riporta in vita un record eliminato** con un `updatedAt` più vecchio della cancellazione: la cancellazione vince. Test in Task 1.
4. **Primo sync di un device nuovo con migliaia di record**: il pull è paginato (`more: true`) e a fine ciclo il device ha tutto, senza buchi né doppioni. Test in Task 1.
5. **Payload sbagliati** (JSON rotto, collezione sconosciuta, 5.000 modifiche, dati enormi): 400 con messaggio chiaro e **nulla applicato a metà**. Test in Task 2.

---

### Task 1: Store a record con LWW, tombstone e pull paginato

**Files:**
- Create: `backend/schema.sql`, `backend/src/store.mjs`, `backend/test/d1-sqlite.mjs` (adattatore di test), `backend/test/store.test.mjs`, `backend/package.json` (`{"type":"module","private":true,"scripts":{"test":"node --test test/"}}`)

**Interfaces:**
- Produces: `applyChanges(db, deviceId: string, changes: Change[], now: number) → Promise<{ applied: number, stale: number }>`; `pullSince(db, cursor: number, limit: number) → Promise<{ changes: Record[], cursor: number, more: boolean }>`; `COLLECTIONS: Set<string>`; `MAX_FUTURE_MS = 300000`. `createD1(): D1-like` in `test/d1-sqlite.mjs` (supporta `prepare(sql).bind(...).all()/first()/run()` e `batch(stmts[])` in transazione).

`schema.sql`: tabella `records(collection TEXT, id TEXT, data TEXT, updated_at INTEGER, deleted INTEGER, device_id TEXT, seq INTEGER, PRIMARY KEY(collection,id))`, indice su `seq`; tabella `meta(key TEXT PRIMARY KEY, value INTEGER)` con riga `('seq', 0)`.

- [ ] **Step 1: Scrivi i test**

`store.test.mjs` (ognuno su un `createD1()` nuovo con lo schema applicato):
- `applica e rilegge`: 2 change → `pullSince(db,0,100)` restituisce 2 record, `cursor` = seq massimo, `more:false`.
- `LWW: vince updatedAt più recente`: stesso id con `updatedAt` 1000 poi 900 → `data` resta quello del 1000, `stale === 1`.
- `pari merito: vince deviceId lessicograficamente maggiore` (determinismo tra device).
- `retry idempotente`: lo stesso change due volte → un solo record, `data` invariato.
- `futuro limitato`: `updatedAt = now + 3_600_000` → salvato come `now + 300000`; un change successivo con `updatedAt = now + 400000` vince.
- `tombstone vince su update più vecchio`: `deleted:true` a 2000, poi update a 1500 → resta `deleted:true`, `stale:1`.
- `pull paginato`: 1.250 change, `pullSince` con `limit 500` in ciclo → 3 pagine (`more` true, true, false), 1.250 id distinti totali.
- `pull incrementale`: dopo il cursore, una nuova modifica compare da sola nel pull successivo.

- [ ] **Step 2: Lancia `cd backend && node --test test/store.test.mjs`** → FAIL (moduli mancanti).
- [ ] **Step 3: Implementa `createD1` e `store.mjs`**
  - `applyChanges`: per ogni change legge il record esistente, decide LWW (updatedAt clampato, poi `deviceId` come spareggio), e scrive tutti i vincitori in **un'unica `db.batch`**; ogni scrittura prende `seq = meta.seq + n` (aggiorna `meta.seq` nello stesso batch). I perdenti contano come `stale` e non toccano il DB.
  - `pullSince`: `SELECT … WHERE seq > ? ORDER BY seq LIMIT ?+1`; `more` = righe > limit; `cursor` = seq dell'ultima riga restituita (o il cursore in ingresso se vuoto). `data` → JSON parse; `deleted` → boolean.
- [ ] **Step 4: Lancia i test** → PASS (8/8).
- [ ] **Step 5: Commit** `feat(backend): store a record con LWW, tombstone e pull paginato`

### Task 2: Worker HTTP — auth, CORS, validazione, `/v1/sync`, `/v1/health`

**Files:**
- Create: `backend/src/worker.mjs` (export default `{ fetch(request, env) }`), `backend/src/validate.mjs`, `backend/test/worker.test.mjs`, `backend/wrangler.toml` (name `fitness-hub-api`, `main = "src/worker.mjs"`, `compatibility_date = "2026-11-01"`, binding D1 `DB` → `fitness-hub-db`, `database_id` segnaposto da compilare in Task 6)

**Interfaces:**
- Consumes: `applyChanges`, `pullSince`, `COLLECTIONS` (Task 1).
- Produces: `validateSyncBody(body) → { ok: true, value } | { ok: false, error: string }`; limiti `MAX_CHANGES = 500`, `MAX_DATA_BYTES = 65536`, `MAX_ID_LEN = 128`, `PULL_LIMIT = 500`; `checkToken(request, env) → boolean` (tempo costante, falso se `env.SYNC_TOKEN` assente).

- [ ] **Step 1: Scrivi i test** (`env = { DB: createD1() con schema, SYNC_TOKEN: "t".repeat(64) }`, richieste costruite con `new Request`):
  - `GET /v1/health` senza token → 200 `{ ok:true, version:"1" }`.
  - `POST /v1/sync` senza token o con token sbagliato → 401; con `SYNC_TOKEN` non configurato → 401.
  - sync valido: push 2 change + pull dal cursore 0 → 200, `applied:2`, `changes.length === 2`.
  - due device: A spinge `mealCheck 2026-11-03:m1`, B spinge `mealCheck 2026-11-03:m2`; B fa pull → vede entrambi (le spunte si sommano).
  - JSON non valido → 400 `{ error }` e nessun record scritto; collezione `foo` → 400; 501 change → 400; `data` > 64 KB → 400; id vuoto o > 128 caratteri → 400 — in tutti i casi, se una sola modifica del lotto è invalida, **nessuna** viene applicata.
  - CORS: `OPTIONS` da `https://fara2106.github.io` → 204 con `Access-Control-Allow-Origin` uguale all'origine; da `https://evil.example` → 403; richiesta senza `Origin` con token valido → 200.
  - rotta sconosciuta → 404.
- [ ] **Step 2: Lancia** `node --test test/worker.test.mjs` → FAIL.
- [ ] **Step 3: Implementa `validate.mjs` e `worker.mjs`** (router minimo su `URL.pathname`; risposte JSON con header CORS; `now = Date.now()` passato allo store).
- [ ] **Step 4: Lancia** `node --test test/` → PASS (store + worker).
- [ ] **Step 5: Commit** `feat(backend): worker con auth a token, CORS, validazione e /v1/sync`

### Task 3: (rimosso)

Il ponte Groq `/v1/coach` non si fa più: il Coach usa l'IA del dispositivo (spec §5.2). Numerazione dei task successivi invariata.

### Task 4: Converter scheda e dieta → piani strutturati

**Files:**
- Create: `backend/migrate/load-parser.mjs` (carica `parser.jsx` in `node:vm` con `@babel/core` del repo, come `test/run.mjs`), `backend/migrate/plans.mjs`, `backend/test/plans.test.mjs`

**Interfaces:**
- Consumes: `window.parseScheda`, `window.parseDieta` (da `parser.jsx`).
- Produces: `workoutPlanFromText(text, { id, name, validFrom }) → { collection:"workoutPlan", id, data }`; `dietPlanFromText(text, { id, name, validFrom }) → { collection:"dietPlan", id, data }`. Id di giorni/esercizi/varianti/pasti/opzioni/righe/integratori **deterministici** (hash stabile di `planId + percorso`, es. `${planId}/d0/e2`) così una migrazione ripetuta produce gli stessi id.

- [ ] **Step 1: Scrivi i test** sui file reali del repo:
  - `scheda.txt` → 3 giorni con nomi `PUSH`, `PULL`, `LEGS + CORE (mantenimento)`; esercizi per giorno = `parseScheda(...).days[i].exercises.length`; `Push-up (bodyweight)` ha `sets 3`, `reps "8-12"`, `restSec 60`; le alternative del parser sono presenti; `status "active"`.
  - `dieta.txt` → varianti con `key` `riposo, mattina, ore17, ore21, ore22`; pasti per variante = `parseDieta(...)[k].meals.length`; nella variante `riposo` la COLAZIONE ha 4 `options` (Opzione 1…4) e il PRANZO ha una `line` con `label "Carboidrato (scegli 1)"` e 6 `choices`; integratori di ogni variante = `parseDieta(...)[k].integratori` (stessi nomi e orari, `ore22` include PS+ alle 18:30); `training` = `null` per `riposo`, `{ time: "17:00" }` per `ore17`.
  - alimenti esclusi (pasta di ceci, lenticchie, piselli, bevanda di mandorla) assenti da `options`/`choices`.
  - stessa chiamata due volte → JSON identico (id deterministici).
- [ ] **Step 2: Lancia** `node --test test/plans.test.mjs` → FAIL.
- [ ] **Step 3: Implementa `plans.mjs`.** Scheda: mappa diretta dall'output di `parseScheda`. Dieta: legge il testo riga per riga con gli stessi titoli di sezione/pasto di `parser.jsx` (`# GIORNO SENZA ALLENAMENTO`…, `COLAZIONE`… con i relativi orari), `- Opzione N:` → `options`, `Etichetta: a | b` → `lines` con `choices`, `- testo` → `lines` con `label null` e una `choice`, `Etichetta: valore` → `lines` con una `choice`; righe `Note:` e blocco `INTEGRATORI` esclusi dai pasti; integratori presi da `parseDieta`.
- [ ] **Step 4: Lancia** `node --test test/` → PASS.
- [ ] **Step 5: Commit** `feat(migrate): converter scheda/dieta → piani strutturati`

### Task 5: Converter dati foglio Google + backup PWA → record

**Files:**
- Create: `backend/migrate/records.mjs`, `backend/test/records.test.mjs`, `backend/test/fixtures/sheet-sample.json`, `backend/test/fixtures/pwa-backup-sample.json` (dati inventati ma nella forma reale)

**Interfaces:**
- Consumes: forma delle risposte del Worker legacy (`getCheckIn` → `[{date,sleep,energy,ailments}]`, `getPesoCorporeo` → `[{date,weight}]`, `getPesi` → `{ esercizio: [{date,setN,peso,rip,...}] }`, `getSettings` → `{chiave: valore}`) e forma del backup PWA (`{ _lfhBackup: 1, data: { chiave: valore } }` di Impostazioni → Backup).
- Produces: `recordsFromSheet(sheet: { checkIn, pesoCorporeo, pesi, settings }) → Change[]`; `recordsFromBackup(backup, plans: { workout, diet }) → Change[]`; `mergeChanges(...lists) → Change[]` (stesso `collection/id`: tiene `updatedAt` maggiore).

- [ ] **Step 1: Scrivi i test**:
  - check-in del foglio → `dayState` con `checkIn {sleep, energy, ailments}`; due righe stessa data → vince l'ultima.
  - peso → `bodyWeight` (`id` = data, `kg` numero); `bodyWeight` in settings → aggiornamento del giorno di oggi solo se manca la riga.
  - serie (`getPesi`) → `setLog` con `exerciseName` originale, `exerciseId` dell'esercizio con lo stesso nome nel piano migrato se esiste, altrimenti `name:<nome minuscolo>`; `done: true`.
  - backup PWA: `checkIn_<data>` → `dayState.checkIn`; `hydration_<data>` → `dayState.hydration`; `notes_<data>` → `dayState.notes`; `weightLog` → `bodyWeight`; `exNotes` → `exerciseNote`; `prMap` → `personalRecord`; `spesaChecked` → `shoppingCheck`; `spesaExtra` → `shoppingExtra`; `bodyMeasures` → `bodyMeasure`; `coachChat_<data>` → `coachMessage`; `dietaCheck_<data>` → `mealCheck` solo quando il pasto si ritrova nel piano migrato (per nome+orario), altrimenti scartato e contato; `weightGoal`, `spesaFreq`, `lang`, `theme` → `settings`; in più `settings` id `excludedFoods` = `["pasta di ceci","pasta di lenticchie","pasta di piselli","bevanda di mandorla"]` (oggi scritti nel codice, d'ora in poi impostazione).
  - chiavi escluse sempre: `groqApiKey`, `errorLog`, `sheetsQueue`, `settingsPending`, `settingsEdits`.
  - ogni change ha `updatedAt` = timestamp della data del dato (mezzogiorno locale) o `Date.now()` per le settings.
- [ ] **Step 2: Lancia** `node --test test/records.test.mjs` → FAIL.
- [ ] **Step 3: Implementa `records.mjs`.**
- [ ] **Step 4: Lancia** `node --test test/` → PASS.
- [ ] **Step 5: Commit** `feat(migrate): record da foglio Google e backup PWA`

### Task 6: CLI di migrazione, deploy e verifica dal vivo

**Files:**
- Create: `backend/migrate/migrate.mjs`, `backend/test/migrate.test.mjs`, `backend/README.md` (comandi deploy/migrazione, dove sta il token, come ruotarlo)
- Modify: `backend/wrangler.toml` (`database_id` reale), `.gitignore` (`backend/.dev.vars`, `backend/.wrangler/`), `CLAUDE.md` (sezione "Backend v2" con nomi, URL, comandi)

**Interfaces:**
- Consumes: Task 1, 2, 4, 5.
- Produces: `node migrate/migrate.mjs --api <url> --token-file <path> [--backup <file.json>] [--push]`; senza `--push` stampa solo i conteggi per collezione (dry-run). Legge il foglio tramite il Worker legacy con `Origin: https://fara2106.github.io` (solo GET). **Sorgente dei piani**: `settings.schedaData` / `settings.dietaData` del foglio (l'ultima versione sincronizzata, che può essere un import manuale di Lorenzo); solo se mancano, `scheda.txt` / `dieta.txt` del repo. Id piani: `workout-2026-11` / `diet-2026-11`, nome `"Scheda novembre 2026"` / `"Dieta novembre 2026"`, `validFrom` = data della migrazione. Spinge in lotti da 500.

- [ ] **Step 1: Scrivi `migrate.test.mjs`**: con un `fetch` finto che serve il foglio di esempio e un'API costruita su `worker.mjs` + `createD1()`: un dry-run non scrive nulla; `--push` scrive N record; un secondo `--push` lascia invariato il conteggio dei record e tutti i `data`; se il foglio ha `schedaData` diverso da `scheda.txt`, il `workoutPlan` migrato riflette quello del foglio.
- [ ] **Step 2: Lancia** `node --test test/migrate.test.mjs` → FAIL, poi implementa `migrate.mjs`, poi → PASS (`node --test test/` tutto verde).
- [ ] **Step 3: Crea le risorse Cloudflare**:
  `npx wrangler d1 create fitness-hub-db` → copia `database_id` in `wrangler.toml`;
  `npx wrangler d1 execute fitness-hub-db --remote --file=schema.sql` → atteso "Executed".
- [ ] **Step 4: Genera il token e imposta i secret**:
  `mkdir -p ~/.config/fitness-hub && openssl rand -hex 32 > ~/.config/fitness-hub/sync-token && chmod 600 ~/.config/fitness-hub/sync-token`;
  `npx wrangler secret put SYNC_TOKEN < ~/.config/fitness-hub/sync-token`.
- [ ] **Step 5: Deploy** `npx wrangler deploy` → atteso URL `https://fitness-hub-api.<sottodominio>.workers.dev`. Smoke test: `curl <url>/v1/health` → `{"ok":true,"version":"1"}`; `POST /v1/sync` senza token → 401; con token, push+pull di un record `settings` id `_smoke` e poi tombstone dello stesso → 200.
- [ ] **Step 6: Migrazione**:
  dry-run senza backup → stampa i conteggi (attesi: 1 `workoutPlan`, 1 `dietPlan`, 8 `dayState` dai check-in del foglio, 0 `bodyWeight`, 0 `setLog`).
  **Chiedi a Lorenzo** il file di backup dall'iPhone (PWA → Impostazioni → Backup → Esporta, salvato in una cartella che indica) → dry-run con `--backup` → mostra i conteggi a Lorenzo → con il suo ok `--push`.
  Verifica: un pull completo dal vivo restituisce gli stessi conteggi del dry-run; ripetere `--push` non cambia i conteggi.
- [ ] **Step 7: Commit + push** (solo `backend/`, `.gitignore`, `CLAUDE.md`, nessun file dell'app → niente bump di cache): `feat(backend): deploy fitness-hub-api + migrazione dati`
