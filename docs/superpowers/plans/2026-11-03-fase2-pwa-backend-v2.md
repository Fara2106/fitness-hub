# Fase 2 — PWA sul nuovo backend (sync v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La PWA smette di usare Google Sheets/Apps Script e si sincronizza con `fitness-hub-api` (Worker + D1, fase 1), offline-first, leggendo scheda e dieta dai piani strutturati invece che dai `.txt`.

**Architecture:** Un **ponte** traduce le chiavi locali che le schermate già usano (`checkIn_<data>`, `dietaCheck_<data>`, `schedaProg_<data>`, `weightLog`, …) da e verso i record del backend (`backend/CONTRACT.md`): le schermate restano quasi intatte. Tre moduli puri nuovi — `planconv.jsx` (piani strutturati ⇄ forme del parser), `recordmap.jsx` (chiavi locali ⇄ record), `syncv2.jsx` (motore: cache record, coda, push/pull, cursore) — sostituiscono il motore Sheets di `app.jsx`. Lo storico (Storico, progressione, PR) legge dalla cache locale dei record tramite `localdata.jsx`, con le stesse forme che restituiva `sheetsAPI`.

**Tech Stack:** React 18 via CDN + JSX precompilato (`dev/build.mjs` → `app.compiled.js`), `window.storage` (IndexedDB), test `npm test` (`test/run.mjs`, vm + Babel) e `npm run test:e2e` (Playwright WebKit); backend fase 1 in `backend/` (riusato in-process nei test).

**Spec:** `docs/superpowers/specs/2026-11-03-app-nativa-swift-design.md` (§7 sync, §8 versione web, §9 migrazione, §13 fasi) + contratto `backend/CONTRACT.md` + protocollo client in `backend/README.md` ("Contratto per i client").

## Global Constraints

- Regole PWA di CLAUDE.md (vincolanti): niente `import`/`export` nei `.jsx`, ogni file finisce con `window.X = X`; nuovo `.jsx` → aggiunto a `BUNDLE_FILES` in `dev/build.mjs` PRIMA dei file che lo usano; dopo ogni modifica a un `.jsx`: `npm run build` + `npm test`; persistenza solo `window.storage`; niente `<form>`; colori solo da CSS vars; ogni `t("…")` esiste in IT e EN di `i18n.jsx`; overlay a schermo intero via `UIPortal` + `.lfh-overlay`; stato per-esercizio keyed-by-id `exId(dayKey,pos)`.
- Protocollo client (README backend): `updatedAt = max(Date.now(), locale.updatedAt + 1)`; adottare i record dell'echo e di `conflicts`; cursore = `cursor` della risposta; `reset:true` o `epoch` cambiato → cursore 0 e ripull completo; lotti ≤ 500 change e ≤ 1,5 MB; tombstone = `deleted:true, data:null`.
- `deviceId`, token, cursore, epoch e coda sono **locali al device**: mai sincronizzati, mai nell'export del backup (Impostazioni → Backup).
- Nessun segreto nel repo. Il token sta solo in `window.storage` (`syncToken`) del device.
- CSP `connect-src`: aggiungere `https://fitness-hub-api.lorefara97.workers.dev`; restano il proxy legacy (serve ancora `/groq`), il worker push e `api.groq.com`.
- Decisioni di Lorenzo (2026-11-03): il **Coach web tiene Groq** (proxy `/groq` del Worker legacy) fino alla fase 3, le chat si sincronizzano già; l'**import `.txt` resta temporaneo** sul web e crea un nuovo piano strutturato attivo archiviando il precedente.
- Le chiavi locali per-giorno restano soggette allo sweep a 90 giorni (`_cleanupOldDailyKeys`); i record sul server restano per sempre.

## Decisioni di questa fase (chi esegue non le rimette in discussione)

- **Gruppi.** Ogni chiave locale appartiene a uno o più *gruppi*; un gruppo produce un insieme di record deterministico. Gruppi: `day:<data>` → `dayState` (da `checkIn_`, `hydration_`, `notes_`, `restDay_`, `dietaVariant_`, voci di `activities` di quella data); `meals:<data>` → `mealCheck` (da `dietaCheck_` + variante del giorno); `supps:<data>` → `supplementCheck` (da `integ_` + variante); `sets:<data>` → `setLog` (da `schedaProg_`); `session:<data>` → `workoutSession` (da `gym_`, `gymStart_`, `schedaProg_`); `weights` → `bodyWeight` (da `weightLog`); `measures` → `bodyMeasure` (`bodyMeasures`); `exNotes` → `exerciseNote`; `prs` → `personalRecord` (`prMap`); `shopping` → `shoppingCheck` (`spesaChecked`); `shoppingExtra` → `shoppingExtra` (`spesaExtra`); `coach:<data>` → `coachMessage` (`coachChat_`); `settings` → `settings` (`spesaFreq`, `weightGoal`, `bodyWeight`, `lang`, `theme`). Mapping, id e forme dei `data` = quelli di `backend/migrate/records.mjs` / `CONTRACT.md` (parità testata).
- **Spunte live.** Togliere una spunta produce un update con `done:false` (o `checked:false`), non un tombstone; il tombstone è solo per record spariti dal gruppo (es. pesata cancellata).
- **Finestre locali.** `weightLog` (90 voci), `activities` (50), `bodyMeasures` (120) e lo sweep a 90 giorni tagliano dati vecchi in locale: **mai tombstone per ciò che esce dalla finestra**. Per le liste si tombstonano solo id con data ≥ la data più vecchia ancora presente nella lista; lo sweep e la ricostruzione da pull scrivono in modo *silenzioso* (non generano push).
- **Variante dieta del giorno.** Nuova chiave locale `dietaVariant_<data>` (= key della variante mostrata: `riposo|mattina|ore17|ore21|ore22|…`), scritta quando l'utente cambia variante o spunta un pasto/integratore; la Dieta parte da lì se presente. Sincronizzata come `dayState.dietVariant`; senza di essa la variante si sceglie come nella migrazione (più spunte, poi ordine del piano). Aggiunta allo sweep 90 gg.
- **Piani.** Record `workoutPlan`/`dietPlan`: attivo = `status:"active"` con `validFrom` più recente. Copia locale strutturata in `plan_workout` / `plan_diet` (`{ id, data }`). Le schermate ricevono le **forme del parser** tramite `PlanConv.toLegacyScheda` / `toLegacyDieta` (stesse forme di `parseScheda`/`parseDieta`). Senza piani locali (device mai collegato) → fallback `SCHEDA_TXT_FALLBACK`/`DIETA_TXT_FALLBACK` parsati come oggi. `setLog.exerciseId` = id dell'esercizio del piano attivo in posizione `Giorno N#pos`.
- **Primo sync di un device (cursore 0, nessun indice gruppi):** prima pull completo e ricostruzione delle chiavi locali dai record del server; poi push SOLO dei gruppi locali che non hanno record sul server. Un device con dati vecchi non sovrascrive mai dati più nuovi.
- **Modifiche in attesa vincono in locale:** un record in arrivo dal pull per cui la coda ha una modifica locale non ancora confermata non tocca le chiavi locali.
- **Import `.txt` (temporaneo):** id `workout-YYYYMMDD-HHMM` / `diet-YYYYMMDD-HHMM`, nome dal file, `validFrom` = oggi; il piano attivo precedente → `status:"archived"`, `validTo` = oggi. Conversione con `PlanConv` (stesso codice usato da `backend/migrate/plans.mjs`, vedi Task 1).
- **Token:** incollato in Impostazioni → Sincronizzazione oppure aperto una volta il link `https://fara2106.github.io/fitness-hub/#sync=<token>` (la PWA lo salva e ripulisce l'hash con `history.replaceState`). Senza token l'app funziona solo in locale (badge "non collegato"), la coda resta.
- **Cutover:** subito prima del deploy PWA si azzera D1 e si rimigra (Ruling 18 della fase 1) con un backup fresco; dopo, il primo sync di ogni device (regola sopra) porta i dati solo-locali. Il Worker legacy resta acceso per `/groq`; foglio e Apps Script non vengono più chiamati (Lorenzo li elimina quando vuole).

## Review Focus

1. **Palestra offline:** serie spuntate senza rete, poi rete che torna → arrivano tutte, una volta sola; se nel frattempo un altro device ha spuntato la spesa, si tengono entrambe le cose. Test in Task 3 e Task 7.
2. **Device con dati vecchi al primo sync** (es. Safari mai aperto da un mese): non riporta indietro check-in/peso/spunte più recenti già sul server. Test in Task 3.
3. **Pull mentre si sta modificando** (Player aperto, peso in digitazione, Dieta con spunte appena fatte): la modifica locale in coda non viene sovrascritta né fatta sparire. Test in Task 3 e Task 7.
4. **Dati che escono dalla finestra locale** (weightLog oltre 90 voci, sweep a 90 giorni): sul server restano, nessun tombstone. Test in Task 2 e Task 3.
5. **Piano cambiato in giornata su un altro device** (import `.txt`): le spunte di oggi non passano a un altro esercizio/pasto; lo storico resta leggibile per nome. Test in Task 4 e Task 7.

---

### Task 1: `planconv.jsx` — piani strutturati ⇄ forme del parser, `storage.onChange`

**Files:**
- Create: `planconv.jsx`
- Modify: `storage.jsx` (listener), `backend/migrate/plans.mjs` (diventa un wrapper che carica `planconv.jsx` in vm come fa `load-parser.mjs`), `dev/build.mjs` (`planconv.jsx` dopo `parser.jsx`), `test/run.mjs` (Suite PlanConv)

**Interfaces:**
- Produces: `window.PlanConv = { workoutPlanFromText(text, {id,name,validFrom}) → {collection:"workoutPlan", id, data}, dietPlanFromText(text, {id,name,validFrom}) → {collection:"dietPlan", id, data}, toLegacyScheda(planData) → { days: [...] } (forma di parseScheda), toLegacyDieta(planData) → { riposo:{meals,integratori}, … } (forma di parseDieta), planToText(workoutData, dietData) → string (testo compatto per il prompt del Coach, ≤ 3000 caratteri per piano), activePlan(records: Record[], collection) → {id,data}|null }`.
- Produces: `window.storage.onChange(fn) → unsubscribe`, `fn(key, value, { silent })` chiamato da `set`/`remove`; `set(key, value, { silent: true })` e `remove(key, { silent: true })` notificano con `silent:true` (il ponte li ignora).

- [ ] **Step 1: Test** (Suite PlanConv in `test/run.mjs`, vm con `parser.jsx` + `planconv.jsx`):
  - `toLegacyScheda(workoutPlanFromText(scheda.txt).data)` deep-equal a `parseScheda(scheda.txt)` sui campi che le schermate usano (`days[].num/key/name/focus`, `exercises[].name/muscles/sets.length/rest/notes/ripRange/alternatives`).
  - `toLegacyDieta(dietPlanFromText(dieta.txt).data)` deep-equal a `parseDieta(dieta.txt)` per ogni variante: `meals[].time/title/emoji`, testi di `primary`+`others` nello stesso ordine, `integratori[].name/time/sortTime/type/color`.
  - id deterministici identici a quelli prodotti oggi da `backend/migrate/plans.mjs` (stesso `planId`) — confronta col JSON committato in un fixture generato prima del refactor.
  - `activePlan`: due piani `active` → vince `validFrom` più recente; `archived` ignorati; tombstone ignorati.
  - `storage.onChange`: `set` notifica `silent:false`, `set(…,{silent:true})` notifica `silent:true`, unsubscribe funziona.
- [ ] **Step 2:** `npm test` → FAIL (PlanConv assente).
- [ ] **Step 3:** sposta la logica di `backend/migrate/plans.mjs` in `planconv.jsx` (stesso comportamento, regole Ruling 4/8/9 della fase 1) e scrivi gli adattatori; emoji/colore/orari curati vengono dalle tabelle che `parser.jsx` già espone (esporta via `window` quelle che mancano, senza cambiarne il contenuto). `plans.mjs` carica `planconv.jsx` via vm e riesporta le stesse funzioni.
- [ ] **Step 4:** `npm run build && npm test` → PASS; `cd backend && npm test` → PASS (95, invariati).
- [ ] **Step 5: Commit** `feat(pwa): PlanConv piani strutturati ⇄ forme del parser + storage.onChange`

### Task 2: `recordmap.jsx` — chiavi locali ⇄ record

**Files:**
- Create: `recordmap.jsx`
- Modify: `dev/build.mjs` (dopo `planconv.jsx`), `test/run.mjs` (Suite RecordMap), `backend/test/` (un test di parità che carica `recordmap.jsx` in vm)

**Interfaces:**
- Consumes: `PlanConv.activePlan`, piani strutturati (`plan_workout`/`plan_diet`).
- Produces: `window.RecordMap = { groupsForKey(key) → string[], buildGroup(groupId, get, ctx) → { records: {collection,id,data}[], window?: { collection, minId } }, keysForRecord(record, ctx) → string[] (chiavi locali da ricostruire), rebuildKeys(keys, getRecord, listRecords, ctx) → { [storageKey]: value|undefined } (undefined = rimuovi), DIRECT: Set(["workoutPlan","dietPlan"]) }` dove `get(key, def)` legge lo storage, `getRecord(collection,id)`/`listRecords(collection)` leggono la cache record, `ctx = { workout: {id,data}|null, diet: {id,data}|null, today }`.

- [ ] **Step 1: Test** (Suite RecordMap):
  - per ogni famiglia di chiavi del ponte (vedi "Gruppi"): `buildGroup` produce id e `data` identici a `recordsFromBackup` di `backend/migrate/records.mjs` per lo stesso input (test di parità in `backend/test/recordmap-parity.test.mjs`, input = `backend/test/fixtures/pwa-backup-sample.json`).
  - round-trip: `rebuildKeys(keysForRecord(r), …)` dai record di `buildGroup` ricostruisce valori uguali all'input (`checkIn_`, `dietaCheck_`, `integ_`, `schedaProg_` completion/pesos/substitutions/names, `weightLog`, `prMap`, `spesaChecked`, `spesaExtra`, `coachChat_`, settings).
  - spunta tolta: `dietaCheck_` con `false` → `mealCheck` `done:false` (non assente).
  - finestra: `weightLog` con 90 voci dal 2026-08-05 → `window = { collection:"bodyWeight", minId:"2026-08-05" }`.
  - `dietaVariant_` presente → spunte mappate su quella variante; assente → stessa scelta della migrazione.
  - `muscleSets_<data>` ricostruito dai `setLog` del giorno + muscoli del piano (stessa forma che scrive oggi `scheda.jsx` alla chiusura).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** implementa `recordmap.jsx` (funzioni pure, nessun accesso a rete o `window.storage` diretto).
- [ ] **Step 4:** `npm run build && npm test` → PASS; `cd backend && npm test` → PASS.
- [ ] **Step 5: Commit** `feat(pwa): RecordMap chiavi locali ⇄ record`

### Task 3: `syncv2.jsx` — motore di sync

**Files:**
- Create: `syncv2.jsx`
- Modify: `dev/build.mjs` (dopo `recordmap.jsx`), `test/run.mjs` (Suite SyncV2: carica in vm `storage` finto + `planconv`/`recordmap`/`syncv2`, `fetch` instradato in-process su `backend/src/worker.mjs` + `backend/test/d1-sqlite.mjs`)

**Interfaces:**
- Consumes: `RecordMap`, `PlanConv`, `storage.onChange`.
- Produces: `window.SyncV2 = { API: "https://fitness-hub-api.lorefara97.workers.dev", init({ storage, fetch }), setToken(token) → Promise<{ok, error?}>, hasToken() → boolean, syncNow() → Promise<{ ok, pushed, pulled, error? }>, putRecords(changes) (scrittura diretta, per i piani), getRecord(collection,id), listRecords(collection) → Record[], activePlans() → { workout, diet }, status() }`; stato pubblicato come oggi in `window._syncState` + evento `"lfh-sync"` (`status: "idle"|"syncing"|"ok"|"error"|"offline"|"unlinked"`, `last`), e dopo ogni applicazione di record in arrivo l'evento `"lfh-data"` con `detail: { keys: string[] }`.
- Storage locale (device-only): `syncToken`, `v2deviceId`, `v2cursor`, `v2epoch`, `v2outbox` (`{ "<collection>/<id>": Change }`, coalescente), `v2grp:<groupId>` (id prodotti l'ultima volta dal gruppo), cache record `r:<collection>:<id>`.

- [ ] **Step 1: Test** (Suite SyncV2, due "device" con storage separati sullo stesso backend in-process):
  - A spunta un pasto, B spunta la spesa, entrambi `syncNow()` due volte → entrambi vedono entrambe le cose, nessun record doppio.
  - offline: `fetch` che fallisce → coda persistita; rete di nuovo ok → un solo invio, `v2outbox` vuota.
  - primo sync di B con `checkIn_` vecchio in locale e versione più recente sul server → B adotta quella del server e non la ripusha.
  - modifica locale in coda + record in arrivo più vecchio per la stessa chiave → la chiave locale non cambia; dopo il push vince la locale.
  - stale + `conflicts` → la chiave locale si riallinea alla versione del server.
  - `reset:true` (cursore oltre `meta.seq`) ed `epoch` cambiato → ripull da 0 senza perdere la coda.
  - `weightLog` che scorre oltre 90 voci e `storage.remove(…,{silent:true})` dello sweep → nessun tombstone inviato.
  - token assente o 401 → `status "unlinked"`/`"error"`, coda intatta, nessuna eccezione.
  - lotti: 1.200 change in coda → 3 richieste, ognuna ≤ 500 change e ≤ 1,5 MB.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** implementa. Push debounced 1,5 s dopo una modifica non silenziosa; le chiavi modificate → `groupsForKey` → `buildGroup` → diff con la cache → change (`updatedAt` per regola) in `v2outbox`; tombstone per id spariti dal gruppo solo dentro `window`. Applicazione in arrivo: aggiorna cache, `keysForRecord` → `rebuildKeys` → `storage.set(…,{silent:true})` solo per chiavi di date ≥ oggi−90, salta record con modifica in coda; piani → `plan_workout`/`plan_diet`.
- [ ] **Step 4:** `npm run build && npm test` → PASS.
- [ ] **Step 5: Commit** `feat(pwa): SyncV2 motore offline-first sul backend D1`

### Task 4: Collegamento all'app — avvio, piani, refresh schermate

**Files:**
- Modify: `app.jsx` (via `_cloudSync`, `_saveSettingRetry`, `_MERGE`/`_markEdits`/`_pullMerged`, `_reconcileRepoFiles`, `_cloudPushMissing`/`_cloudPushAll`, `_maybeAutoBackup`; al loro posto `SyncV2.init` + `syncNow` all'avvio, ogni 45 s se visibile, al ritorno in foreground e su `online`; `applySynced` su `"lfh-data"`; `setState` scrive solo storage), `parser.jsx` (`getSchedule` dal piano attivo via `PlanConv.toLegacyScheda`, fallback invariato), `screens/dieta.jsx` (`_getDieta` da `plan_diet`; `dietaVariant_<data>`), `screens/dashboard.jsx` (la funzione in testa al file, ~riga 21, che oggi fa `parseDieta(storage dietaData)` → da `plan_diet`), `screens/scheda.jsx`, `screens/spesa.jsx`, `screens/storico.jsx` (ricaricano lo stato letto da storage su `"lfh-data"`), `app.jsx` `_cleanupOldDailyKeys` (regex + `dietaVariant_`, rimozioni `silent`), `nav.jsx` (`SyncBadge`: stato `unlinked`), `i18n.jsx`

**Interfaces:**
- Consumes: `SyncV2.*`, `PlanConv.toLegacyScheda/toLegacyDieta`.
- Produces: nessuna chiamata a `window.sheetsAPI` resta in `app.jsx`; tutte le schermate leggono i piani dal piano attivo.

- [ ] **Step 1: Test** (`test/run.mjs`): `getSchedule()` con `plan_workout` in storage restituisce i giorni del piano (nomi/esercizi del piano, non del fallback); senza `plan_workout` → fallback come oggi. `grep` nel bundle: nessuna occorrenza di `sheetsAPI.` in `app.jsx`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** implementa le modifiche elencate; la Scheda continua a usare `sanitizeSchedaProg` col piano attivo (cambio piano in giornata).
- [ ] **Step 4:** `npm run build && npm test` → PASS; `npm run test:e2e` gira (gli scenari Sheets falliranno: aggiornati in Task 7 — annota quali).
- [ ] **Step 5: Commit** `feat(pwa): app sul motore SyncV2, piani dal modello strutturato`

### Task 5: Storico e progressione dai record locali; via Sheets dal client

**Files:**
- Create: `localdata.jsx` (dopo `syncv2.jsx` in `BUNDLE_FILES`)
- Modify: `screens/storico.jsx`, `screens/scheda.jsx` (chiusura sessione senza `saveSessione`/`savePeso`; `getUltimiPesi`/`getPesi` → `LocalData`), `screens/dashboard.jsx` (niente `savePesoCorporeo`/`saveMovimento`), `screens/coach.jsx` (prompt con `PlanConv.planToText` + `settings.excludedFoods` con fallback alla lista attuale; Groq invariato), `api.jsx` (resta solo `groqAPI`, `playBeep`, `todayKey`, `getTodaySession` e helper non-Sheets; via `sheetsAPI`, coda `sheetsQueue`, `drainQueue`), `screens/impostazioni.jsx` (via `testConnection`), `test/run.mjs` (Suite LocalData)

**Interfaces:**
- Consumes: `SyncV2.listRecords`.
- Produces: `window.LocalData = { getPesi() → { [esercizio]: [{date,setN,peso,rip}] }, getUltimiPesi(nomeEsercizio) → [{setN,peso,rip}], getSessioni() → forma attuale di sheetsAPI.getSessioni, getCheckIn() → [{date,sleep,energy,ailments}], getPesoCorporeo() → [{date,weight}], getMisure() → forma attuale di getMisure }` — stesse forme (e ordinamenti) che le schermate ricevevano da `sheetsAPI`; tutte sincrone sulla cache.

- [ ] **Step 1: Test** (Suite LocalData, cache con setLog/workoutSession/dayState/bodyWeight/bodyMeasure da fixture): ogni funzione restituisce la forma attesa; setLog di un piano archiviato o `name:` compare sotto `exerciseName`; tombstone esclusi; `setN` = `setIndex + 1`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** implementa `localdata.jsx`, sostituisci le chiamate, rimuovi `sheetsAPI` da `api.jsx` e dai client. `grep -n "sheetsAPI" *.jsx screens/*.jsx` → vuoto.
- [ ] **Step 4:** `npm run build && npm test` → PASS.
- [ ] **Step 5: Commit** `feat(pwa): storico e progressione dai record locali, rimosso il client Sheets`

### Task 6: Impostazioni — collegamento, piani, import temporaneo, backup, CSP

**Files:**
- Modify: `screens/impostazioni.jsx`, `screens/onboarding.jsx` (nessun passo Sheets), `index.html` (CSP), `mount.jsx` o `syncv2.jsx` (gestione `#sync=<token>` all'avvio), `i18n.jsx`, `test/run.mjs`

**Interfaces:**
- Consumes: `SyncV2.setToken/status/syncNow/putRecords/listRecords`, `PlanConv.*FromText`, `PlanConv.activePlan`.

- [ ] **Step 1: Test** (`test/run.mjs`, funzioni pure estratte dove serve):
  - `#sync=<64 hex>` → `syncToken` salvato, hash ripulito; hash diverso → ignorato.
  - import `.txt` scheda valido → 2 change: nuovo `workoutPlan` `active` con id `workout-YYYYMMDD-HHMM`, vecchio attivo `archived` con `validTo` = oggi; file non valido → nessun change, messaggio d'errore (stessa validazione di oggi).
  - export backup: senza `syncToken`, `v2deviceId`, `v2cursor`, `v2epoch`, `v2outbox`, `v2grp:*`, `r:*`, `groqApiKey`, `errorLog`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Impostazioni → **Sincronizzazione**: stato (badge), campo token + "Collega" (prova con `syncNow`), "Sincronizza ora", ultimo sync. **Piani**: piano attivo scheda/dieta (nome, dal) + elenco archiviati (nome, periodo), sola lettura; dentro, "Importa .txt (temporaneo)" che sostituisce l'attuale `FileImporter`. CSP come da Global Constraints. Chiavi i18n IT+EN.
- [ ] **Step 4:** `npm run build && npm test` → PASS.
- [ ] **Step 5: Commit** `feat(pwa): impostazioni sync v2, piani in sola lettura, import .txt temporaneo`

### Task 7: E2E sul backend vero in-process

**Files:**
- Modify: `test/e2e/mock.mjs` (le richieste a `https://fitness-hub-api.lorefara97.workers.dev/**` vengono servite da `backend/src/worker.mjs` + `createD1()` con `SYNC_TOKEN` di test; `/groq` del proxy legacy resta finto), `test/e2e/run.mjs` (scenari)

- [ ] **Step 1: Scenari** (WebKit, due contesti = due device sullo stesso backend):
  - Player: 12/12 serie spuntate offline (`context.setOffline(true)`), poi online → sull'altro device lo Storico mostra 12 serie, nessun doppione.
  - Spesa: spunte diverse dai due device in contemporanea → entrambe ovunque.
  - Dieta: spunte su A con variante ore21 → B apre la Dieta e mostra ore21 con le stesse spunte.
  - Import `.txt` su A con un giorno rinominato → B mostra il nuovo nome; le spunte di oggi su B restano sugli esercizi giusti; Impostazioni → Piani elenca il precedente come archiviato.
  - Pull durante modifica: B ha un peso digitato non ancora inviato, arriva un pull → il valore non cambia.
  - Link `#sync=` collega il device; senza token l'app funziona e il badge dice "non collegato".
  - Restano verdi gli scenari esistenti non-Sheets (error boundary, Coach markdown, reset scroll, overlay sopra la TabBar).
- [ ] **Step 2:** `npm run test:e2e` → PASS tutti.
- [ ] **Step 3: Commit** `test(e2e): scenari sync v2 a due device sul backend in-process`

### Task 8: Cutover (controller, dal vivo) e documentazione

**Files:**
- Modify: `CLAUDE.md` (sezione sync riscritta su v2; "Backend v2" aggiornata; vecchie note Sheets segnate come storiche), `backend/README.md` (cutover fatto), memoria di progetto

- [ ] **Step 1:** chiedi a Lorenzo backup freschi dei device con dati (PWA da icona Home ed eventualmente Safari), salvati in Download.
- [ ] **Step 2:** `cd backend` → dry-run della migrazione con ogni backup, **mostra i conteggi a Lorenzo**; con il suo ok: azzera D1 (`DELETE FROM records; UPDATE meta SET value=0 WHERE key='seq'; UPDATE meta SET value=abs(random() % 9007199254740991) WHERE key='epoch'`), `--push --verify` (dopo le 12 locali).
- [ ] **Step 3:** deploy PWA con lo script (bump `CACHE_NAME` + `?v=` + build) e push.
- [ ] **Step 4:** collega i device: genera il link `#sync=` per Lorenzo (mai nel repo o nei log), verifica su simulatore iPhone (PWA standalone) e chiedi a Lorenzo la prova sul suo iPhone: una spunta su un device compare sull'altro.
- [ ] **Step 5:** documentazione + commit/push docs: `docs: CLAUDE.md sync v2 (fase 2)`.
