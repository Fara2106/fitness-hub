# Fase 3 — App Swift per iPhone (Fitness Hub nativo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un'app SwiftUI per l'iPhone di Lorenzo che arriva alla parità con la PWA (Home, Scheda + Player, Dieta, Spesa, Coach, Storico, Impostazioni), aggiunge l'editor dei piani con il loro storico e l'esperienza nativa (timer a schermo bloccato, Live Activity, Salute). Si sincronizza offline-first sullo stesso backend D1 della PWA, è in Liquid Glass e ha un'icona nuova a livelli.

**Architecture:** Repo privato separato `Fitness Hub iOS` con un pacchetto Swift **`FitnessCore`** che contiene tutta la logica senza UI: record, store SQLite locale, motore di sync, identità, dominio e calcoli portati dalla PWA. Si testa con `swift test` su macOS, in pochi secondi e senza simulatore. Sopra c'è un target app SwiftUI sottile (Observation) più un'estensione widget per la Live Activity. Il progetto Xcode si genera con XcodeGen da `project.yml`. Il backend (`backend/` di questo repo) riceve la preparazione minima per la fase 5: ogni record ha un **proprietario** sul server e `GET /v1/me` restituisce l'id del proprietario del token. Nell'app l'identità è un modulo a parte: tutto il resto riceve solo un `ownerId` e un header di autorizzazione.

**Tech Stack:** Swift 6.4 (strict concurrency), SwiftUI per iOS 27 (Liquid Glass: `glassEffect`, `GlassEffectContainer`, `.buttonStyle(.glass)`, `tabViewBottomAccessory`), Observation, SQLite3 di sistema, Swift Charts, Foundation Models, ActivityKit + WidgetKit, HealthKit, UserNotifications, Swift Testing (`import Testing`), XCUITest, XcodeGen (strumento di build già installato via brew, non una dipendenza dell'app). Backend: Worker JS + D1 (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-03-app-nativa-swift-design.md` (§2, §5, §6, §7, §10, §12, §13 con la "Preparazione nella fase 3", §14) + contratto `backend/CONTRACT.md` + protocollo client in `backend/README.md` ("Contratto per i client") + regole "Sync v2" di `CLAUDE.md`.

## Global Constraints

- Deployment target **iOS 27.0**, solo iPhone in questa fase (`TARGETED_DEVICE_FAMILY = 1`; l'iPad arriva in fase 4). Device: iPhone 18 Pro Max (`00008160-000661061A200036`). Simulatore di QA: iPhone 18 Pro (iOS 27.2).
- Nessuna libreria di terze parti nell'app né in `FitnessCore`: solo framework Apple.
- Repo dell'app: `/Users/lorenzofaraoni/Documents/Web (Apps)/Fitness Hub iOS` (git locale, **privato**: niente GitHub Pages; si pubblica su GitHub privato solo se Lorenzo lo chiede). Questo piano e le modifiche a backend/PWA restano nel repo `Fitness App`.
- Bundle id `it.faraoni.fitnesshub`, estensione `it.faraoni.fitnesshub.LiveActivity`, team personale `599MS2BZ63` (Apple ID gratuito: profili da 7 giorni).
- **Nessun segreto nei repo.** Il token sta solo nel Keychain dell'app (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), sul Mac in `~/.config/fitness-hub/sync-token`. Mai nei log, nei test, negli screenshot o in chat.
- **I test non toccano mai il backend di produzione.** Unit test: server finto in Swift. Integrazione e UI test: Worker vero in-process su `http://127.0.0.1:8787` (`backend/dev/local-server.mjs`, token di test). Solo l'app installata sull'iPhone parla con `https://fitness-hub-api.lorefara97.workers.dev`.
- Contratto record = `backend/CONTRACT.md`: stessi id, stesse forme di `data`, stesse collezioni. Ogni modifica al contratto aggiorna `CONTRACT.md` e resta compatibile con la PWA (campi nuovi opzionali, la PWA ignora quello che non conosce).
- Protocollo client (README backend): `updatedAt = max(nowMs, updatedAtLocale + 1)`; dopo ogni sync si adottano i record dell'echo e di `conflicts`; cursore = `cursor` della risposta, con `more: true` si richiama subito; `reset: true` o `epoch` diverso → cursore 0 e ripull completo, **la coda resta**; lotti ≤ 500 change e ≤ 1,5 MB; eliminazione = tombstone `deleted: true, data: null`.
- LWW per record: spunta tolta = `done:false` / `checked:false`, mai tombstone. `dayState` va per campo (`${date}:${field}`).
- **Identità separata (preparazione fase 5):** solo il modulo `Identity` conosce le credenziali. Store locale, motore di sync e UI ricevono `ownerId` + `authorizationHeader()`. Lo store locale vive in `Application Support/accounts/<ownerId>/`.
- **Account (decisione di Lorenzo, 2026-11-03, sostituisce il token incollato):** accesso con **email + password** su app e PWA (Task 9A-9C). Il server rilascia una **sessione** (token opaco casuale, salvato solo come hash, scadenza scorrevole 180 giorni) che il client usa come `Bearer`. **Accedi con Apple** è costruito ma spento (flag `APPLE_SIGNIN` nell'app, `APPLE_SIGNIN_ENABLED` nel Worker) finché Lorenzo non ha il programma a pagamento. Registrazione **chiusa** (`REGISTRATION_OPEN` falso): l'unico account è quello di Lorenzo, con il suo `ownerId` di oggi. **Nessuno, nemmeno Claude, scrive o legge la password di Lorenzo:** la crea lui con una CLI che la chiede senza eco. `SYNC_TOKEN` resta valido solo durante il passaggio e poi viene rimosso (Task 9C).
- **Integratori solo se previsti dalla dieta**: nessuna lista fissa di integratori o alimenti nel codice Swift.
- Lingue IT (sviluppo) + EN con String Catalog `Localizable.xcstrings`. L'app segue la lingua scelta in iOS (Impostazioni iOS → app → Lingua). Il record `settings.lang` resta della PWA. I nomi degli alimenti restano come scritti nel piano.
- **Liquid Glass secondo le HIG:** il vetro sta sul livello di navigazione e controllo (tab bar, toolbar, pulsanti flottanti, sheet, accessorio del timer, comandi del Player). Il contenuto (card, liste) usa sfondi di sistema. Niente vetro su vetro: i gruppi vicini vanno in `GlassEffectContainer`. Tema sistema/chiaro/scuro dal record `settings.theme` (`system|light|dark`) via `preferredColorScheme`.
- Regole imparate dalla PWA (CLAUDE.md): stato per esercizio sempre per id, mai per posizione; chiudere la sessione due volte non duplica nulla; il cambio piano in giornata non sposta le spunte.
- Comandi di verifica: `swift test --package-path Packages/FitnessCore` · `xcodegen generate` · `xcodebuild test -project FitnessHub.xcodeproj -scheme FitnessHub -destination 'platform=iOS Simulator,name=iPhone 18 Pro'` · backend `cd backend && npm test` · PWA `npm run build && npm test` (+ `npm run test:e2e` se si tocca la PWA).
- Commit frequenti nel repo giusto: app → `Fitness Hub iOS`; backend/PWA/docs → `Fitness App` (deploy PWA solo col flusso di CLAUDE.md).

## Decisioni di questa fase (chi esegue non le rimette in discussione)

- **Store locale = SQLite3 di sistema** (wrapper minimo in `FitnessCore`), non SwiftData. Tabelle: `records` (cache completa dei record del proprietario), `outbox` (change in attesa, uno per `collection/id`, coalescente), `meta` (chiave/valore: `cursor`, `epoch`, `deviceId`, `selectedWorkoutDay`, `lastSync`, `errorLog`). Il dominio legge i record e li decodifica in tipi `Codable` con indici in memoria (≈10k record/anno, ci stanno).
- **Scrittura = record diretto.** Ogni azione dell'utente fa un upsert di un record del contratto nello store e nell'outbox. Push dopo 1,5 s di quiete. Non ci sono chiavi locali né un ponte come nella PWA.
- **Quando si sincronizza:** all'avvio, al ritorno in primo piano, ogni 45 s mentre l'app è attiva, quando torna la rete (`NWPathMonitor`) e dopo 1,5 s da una modifica. Mai a schermata ferma in attesa della rete: si parte sempre dai dati locali.
- **Primo collegamento:** store nuovo per quel proprietario → pull completo. L'outbox contiene solo modifiche vere dell'utente con il loro `updatedAt`, quindi decide il LWW del server. Non serve il "rebaseline" della PWA, che esiste solo perché la PWA ricostruiva record da chiavi vecchie.
- **Modifiche in attesa vincono in locale:** un record che arriva dal pull e ha un change in outbox non sovrascrive la cache finché l'outbox non è confermato (o finché il server non lo rifiuta con `conflicts`, e allora vince il server).
- **Giorno di scheda selezionato** = device-local (`meta.selectedWorkoutDay`), come `schedaSelectedDay` nella PWA. "Oggi riposo" = `dayState` `rest` (sincronizzato).
- **Variante dieta di oggi:** `dayState.dietVariant` se esiste ed è una variante del piano attivo. Altrimenti: giorno di allenamento (giorno selezionato e niente `rest`) → prima variante del piano con `training != null`; giorno di riposo → prima con `training == null`. Cambiarla a mano, o spuntare un pasto o un integratore, scrive `dietVariant`.
- **Alimenti come testo libero** (chiude la decisione aperta di `CONTRACT.md`): `options[].text` e `lines[].choices[]` restano stringhe. L'editor aiuta con quantità + alimento ma salva testo. Nuovo campo opzionale `meal.note: string|null` (per le righe "Note:" non migrate).
- **Lista della spesa nel piano dieta.** Oggi la PWA ha la lista scritta nel codice (`CATEGORIES` in `screens/spesa.jsx`, chiavi `${cat.id}-${indice}`). Diventa il campo opzionale `dietPlan.data.shopping: [{ id, title, color, items: [{ id, name, qty1, qty2, note|null }] }]`. Gli item migrati tengono l'id di oggi (`proteine-4`…), così le spunte esistenti restano valide. La lista si modifica nell'editor dieta e segue il piano: "nuovo dal precedente" la copia **con gli stessi id degli item**. La PWA legge `shopping` dal piano e ricade su `CATEGORIES` solo se manca.
- **Ciclo di vita dei piani:** `status` aggiunge `"draft"` (`active|archived|draft`; la PWA ignora già tutto ciò che non è `active`). "Nuovo piano dal precedente" fa una copia profonda con **id nuovi (UUID) per giorni, esercizi, varianti, pasti, opzioni, righe e integratori** e `status: "draft"`. "Attiva" mette la bozza `active` con `validFrom` = oggi e il piano attivo precedente `archived` con `validTo` = oggi, in un unico lotto. Il piano attivo si può correggere sul posto (gli id restano). Eliminare un piano dello storico = tombstone, dopo conferma. Prima di salvare, l'editor rifiuta un piano che codificato supera 60 KB (il limite del server è 64 KB).
- **Ids nuovi** creati dall'app: `UUID().uuidString.lowercased()`. Ids dei record di log: esattamente quelli del contratto (`${date}:${exerciseId}:${setIndex}`, `${date}:${mealId}`…). `exerciseNote` / `personalRecord`: nome esercizio in minuscolo.
- **Coach:** Foundation Models (`SystemLanguageModel.default`), niente rete. Contesto compatto costruito da `CoachContext` (puro, in `FitnessCore`) entro **6.000 caratteri**, esclusioni da `settings.excludedFoods`, risposta in streaming. La chat si salva come `coachMessage` `${date}:${index}`, con `index` = massimo indice del giorno + 1.
- **Capacità condizionate (Apple ID gratuito):** HealthKit e Live Activity sono dietro i flag di compilazione `HEALTHKIT` / `LIVE_ACTIVITY` (in `Config/Capabilities.xcconfig`), decisi dal Task 1. Se un flag è spento il codice resta compilato e testato, l'entitlement e il target non vengono firmati, e le Impostazioni mostrano "Richiede il programma sviluppatori".
- **Backup su file:** `{ "format": "fitnesshub-records-v1", "exportedAt": ms, "ownerId": string, "records": Record[] }`. Il ripristino chiede conferma e rimette in outbox ogni record con `updatedAt` per regola, così vince sul server.

## Review Focus

1. **Palestra senza rete:** 12 serie spuntate offline con l'app chiusa e riaperta a metà → al ritorno della rete arrivano tutte, una volta sola, e la PWA le vede. Test nel Task 5 (motore) e nel Task 19 (UI test offline).
2. **Pull mentre si modifica** (peso in digitazione nel Player, spunta appena fatta): il valore locale non torna indietro. Test nel Task 5 (`pendingWinsLocally`) e nel Task 11.
3. **Cambio piano in giornata** (bozza attivata dall'editor dopo aver spuntato serie e pasti): le spunte di oggi restano sugli elementi del piano vecchio, e lo storico e i PR le leggono per nome. Test nel Task 6 e nel Task 15.
4. **App sospesa o schermo bloccato durante il recupero:** la notifica arriva all'ora giusta anche se l'app è stata chiusa, e saltare il recupero la cancella. Test nel Task 17 (scheduler puro) e QA sul device nel Task 19.
5. **Token sbagliato, revocato o assente** (401, rete assente, `epoch` cambiato): l'app resta usabile in locale, la coda non si perde, il badge dice cosa succede, e nessun token finisce in log o diagnostica. Test nel Task 5 e nel Task 9.

---

### Task 1: Repo, progetto XcodeGen e verifica delle capacità con l'Apple ID gratuito (controller, con Lorenzo)

**Files (repo `Fitness Hub iOS`):**
- Create: `project.yml`, `Config/Capabilities.xcconfig`, `Config/Base.xcconfig`, `App/FitnessHubApp.swift` (schermata vuota "Fitness Hub"), `App/FitnessHub.entitlements` (HealthKit), `App/Info.plist` (`NSSupportsLiveActivities = YES`, `NSHealthUpdateUsageDescription`, `NSHealthShareUsageDescription`), `LiveActivity/RestTimerLiveActivity.swift` (widget minimo con `Text(timerInterval:)`), `Packages/FitnessCore/Package.swift` (+ `Sources/FitnessCore/FitnessCore.swift`, `Tests/FitnessCoreTests/SmokeTests.swift`), `.gitignore` (`DerivedData/`, `*.xcuserstate`, `build/`), `README.md`, `scripts/install-iphone.sh`, `docs/capabilities.md`
- Generated + committed: `FitnessHub.xcodeproj`

**Interfaces:**
- Produces: target `FitnessHub` (app) + `FitnessHubLiveActivity` (estensione, embedded solo se `LIVE_ACTIVITY`) + `FitnessHubUITests`; pacchetto locale `FitnessCore` (piattaforme `.iOS("27.0")`, `.macOS("27.0")`); flag `HEALTHKIT`, `LIVE_ACTIVITY` in `SWIFT_ACTIVE_COMPILATION_CONDITIONS`; `scripts/install-iphone.sh` (build firmata per `00008160-000661061A200036` con `-allowProvisioningUpdates`, poi `xcrun devicectl device install app`).

- [ ] **Step 1:** crea il repo (`git init`) e i file. Poi `xcodegen generate` e `swift test --package-path Packages/FitnessCore` → PASS (1 test smoke).
- [ ] **Step 2:** `xcodebuild build -scheme FitnessHub -destination 'platform=iOS Simulator,name=iPhone 18 Pro'` → BUILD SUCCEEDED.
- [ ] **Step 3: Sonda delle capacità sul device.** Prima avvisa Lorenzo: sull'iPhone ci sono già due app firmate col team personale (`it.faraoni.stylevault`, `com.lorenzofaraoni.vocali`, profili in scadenza il 10/11); l'Apple ID gratuito ammette poche app attive e circa 10 App ID nuovi a settimana; la sonda usa i bundle id definitivi, così non spreca App ID. Lancia `scripts/install-iphone.sh` con entrambi i flag accesi e registra in `docs/capabilities.md` l'esito di ciascuna voce:
  - firma con entitlement `com.apple.developer.healthkit` (errore "Personal development teams … do not support" → HealthKit **no**);
  - provisioning ed embedding dell'estensione widget (Live Activity: non serve un App Group, perché lo stato passa da ActivityKit);
  - installazione e avvio dell'app (Lorenzo autorizza lo sviluppatore in Impostazioni → Generali → VPN e gestione dispositivi, se iOS lo chiede);
  - con l'app aperta sull'iPhone: richiesta di autorizzazione a Salute che compare, e una Live Activity di prova avviata da un pulsante di debug che si vede sulla Dynamic Island.
- [ ] **Step 4:** imposta `Config/Capabilities.xcconfig` secondo l'esito (`HEALTHKIT`/`LIVE_ACTIVITY` sì o no; con un flag spento, `project.yml` non firma quell'entitlement e non incorpora l'estensione). Rigenera e ricompila per il device → installazione OK.
- [ ] **Step 5:** ricorda a Lorenzo di **attivare Apple Intelligence sull'iPhone** (Impostazioni → Apple Intelligence e Siri → attiva, poi attendi il download del modello) e annota in `docs/capabilities.md` lo stato di `SystemLanguageModel.default.availability`, letto da un pulsante di debug temporaneo.
- [ ] **Step 6:** aggiorna la memoria del progetto (capacità disponibili, limite delle app gratuite). Commit `chore: progetto Xcode, pacchetto FitnessCore, sonda capacità Apple ID gratuito`.

### Task 2: Tre proposte d'icona a livelli (Liquid Glass)

Va subito dopo il Task 1: Lorenzo sceglie mentre si costruisce il resto.

**Files (repo `Fitness Hub iOS`):**
- Create: `Design/Icon/proposta-{1,2,3}/` (livelli SVG separati: sfondo, livello medio, primo piano; niente testo), `Design/Icon/anteprime.html` (pagina di confronto)
- Dopo la scelta: `App/AppIcon.icon/` (bundle Icon Composer: `icon.json` + `Assets/*.svg`), referenziato in `project.yml` come icona dell'app (`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`)

- [ ] **Step 1:** disegna 3 concetti distinti, coerenti col marchio LF e col blu→verde della PWA, pensati per il vetro: forme semplici e piene, profondità data dai livelli e non da ombre disegnate, leggibili a 60 pt. Ogni concetto ha 2–4 livelli SVG.
- [ ] **Step 2:** `anteprime.html` mostra ogni proposta in versione predefinita, scura, tinta (monocromatica) e trasparente, a 1024/180/60 px, su sfondi chiaro e scuro. Pubblicala come Artifact privato e manda il link a Lorenzo; **aspetta la sua scelta**.
- [ ] **Step 3:** costruisci `App/AppIcon.icon` con la proposta scelta (livelli con `glass: true` dove serve, varianti dark/tinted dichiarate in `icon.json`). Verifica: `xcodebuild build` per simulatore senza warning di `actool` sull'icona, e uno screenshot della Home del simulatore con l'app installata.
- [ ] **Step 4:** commit `feat: icona a livelli <nome proposta>` (le proposte non scelte restano in `Design/Icon/`).

### Task 3: Backend — proprietario dei record, `GET /v1/me`, server locale per i test

**Files (repo `Fitness App`):**
- Create: `backend/migrations/0002_owner.sql`, `backend/dev/local-server.mjs`, `backend/test/owner.test.mjs`
- Modify: `backend/schema.sql` (schema nuovo per i DB vergini), `backend/src/store.mjs`, `backend/src/worker.mjs`, `backend/wrangler.toml` (`[vars] PRIMARY_OWNER = "<uuid generato una volta>"`), `backend/test/*.test.mjs` (owner nei test esistenti), `backend/README.md`, `backend/CONTRACT.md` (vedi Task 4 per i campi nuovi)

**Interfaces:**
- Produces: tabella `records(owner TEXT NOT NULL, collection, id, data, updated_at, deleted, device_id, seq, PRIMARY KEY (owner, collection, id))` + indice `(owner, seq)`; `meta` resta globale (`seq`, `epoch`). `applyChanges(db, owner, deviceId, changes, now)`, `currentRecords(db, owner, keys)`, `pullSince(db, owner, cursor, limit)`. `resolveOwner(request, env) → Promise<string|null>`: il token `SYNC_TOKEN` corrisponde a `env.PRIMARY_OWNER`. È l'unico punto da estendere in fase 5 (tabella account). `GET /v1/me` (con token) → `{ ownerId, epoch }`; senza token o con token sbagliato → 401.
- Produces: `node backend/dev/local-server.mjs --port 8787 --token <t> [--db <file>] [--seed <records.json>]` (`--seed` = array di `Change` applicati all'avvio come device `seed`) = Worker vero + D1 su `node:sqlite` (riusa `backend/test/d1-sqlite.mjs`), stampa `ready http://127.0.0.1:8787`. Lo usano i test d'integrazione Swift e gli UI test.

- [ ] **Step 1: Test** (`owner.test.mjs`): due owner nello stesso DB non si vedono a vicenda nel pull, nei `conflicts` né nel LWW (stesso `collection/id` su owner diversi = due record); `GET /v1/me` → `{ ownerId: PRIMARY_OWNER, epoch }`, 401 senza token; la migrazione `0002_owner.sql` applicata a un DB con lo schema vecchio e 13 record → stessi 13 record con `owner = PRIMARY_OWNER`, stessi `seq`, `epoch` invariato (i cursori dei client restano validi).
- [ ] **Step 2:** `cd backend && npm test` → FAIL.
- [ ] **Step 3:** implementa. La migrazione ricostruisce la tabella (`records_new` → copia → `DROP` → `RENAME`) dentro una transazione e ricrea gli indici. `PRIMARY_OWNER` entra nella migrazione per sostituzione (`sed`) al momento del lancio, non scritto nel file.
- [ ] **Step 4:** `npm test` → PASS (i 98 esistenti adattati + i nuovi). Verifica a mano `local-server.mjs`: `curl` di `/v1/health` e `/v1/me`.
- [ ] **Step 5: Live (controller).** `npx wrangler d1 time-travel info fitness-hub-db` (annota il bookmark) → `npx wrangler d1 execute fitness-hub-db --remote --file=<migrazione con l'owner sostituito>` → `npx wrangler deploy` → verifica con lo script di pull in sola lettura: stesso numero di record di prima, `/v1/me` risponde, e una spunta dalla PWA arriva ancora. Se qualcosa non torna: `time-travel restore` al bookmark, ridistribuisci la versione precedente del Worker, cambia l'epoch (README).
- [ ] **Step 6:** commit `feat(backend): proprietario dei record e /v1/me (preparazione fase 5)` e push. Aggiorna la sezione "Backend v2" di `CLAUDE.md` e la memoria.

### Task 4: FitnessCore — record, modelli del contratto, fixture di parità dalla PWA

**Files:**
- Create (repo `Fitness App`): `dev/gen-swift-fixtures.mjs <outDir>`. Carica in `node:vm` `parser.jsx`, `planconv.jsx`, `recordmap.jsx`, `insights.jsx`, `progress.jsx` come fa `test/run.mjs` e scrive i JSON elencati sotto.
- Create (repo app): `Packages/FitnessCore/Sources/FitnessCore/Records/{JSONValue.swift, SyncRecord.swift, Collection.swift}`, `Domain/Plans.swift`, `Domain/Logs.swift`, `Tests/FitnessCoreTests/Fixtures/*.json`, `Tests/FitnessCoreTests/ContractTests.swift`
- Modify (repo `Fitness App`): `backend/CONTRACT.md` (`status: draft`, `meal.note`, `dietPlan.shopping`, alimenti come testo libero: decisione chiusa)

**Interfaces:**
- Produces: `enum JSONValue: Codable, Hashable, Sendable` (null/bool/number(Double)/string/array/object, numeri interi preservati in uscita); `struct SyncRecord: Codable, Sendable { collection: RecordCollection; id: String; data: JSONValue?; updatedAt: Int64; deleted: Bool; deviceId: String?; seq: Int64? }`; `struct Change: Codable, Sendable { collection; id; data: JSONValue?; updatedAt: Int64; deleted: Bool }`; `enum RecordCollection: String, Codable, CaseIterable` (le 15 collezioni del contratto).
- Produces (tipi del contratto, tutti `Codable, Hashable, Sendable`, chiavi JSON identiche a `CONTRACT.md`): `WorkoutPlanData { name, status: PlanStatus, validFrom, validTo, days: [WorkoutDay] }`, `WorkoutDay { id, name, focus: [String], exercises: [Exercise] }`, `Exercise { id, name, sets: Int, reps: String, restSec: Int, notes: String, muscles: [String], alternatives: [String] }`, `DietPlanData { name, status, validFrom, validTo, variants: [DietVariant], shopping: [ShoppingCategory]? }`, `DietVariant { id, key, name, training: TrainingInfo?, meals: [Meal], supplements: [Supplement] }`, `Meal { id, name, time, options: [MealOption], lines: [MealLine], note: String? }`, `MealOption { id, text }`, `MealLine { id, label: String?, choices: [String] }`, `Supplement { id, key, name, moment, time }`, `ShoppingCategory { id, title, color, items: [ShoppingItem] }`, `ShoppingItem { id, name, qty1, qty2, note: String? }`, `enum PlanStatus: String { active, archived, draft }`; log: `DayStateValue` (enum per campo: `checkIn(CheckIn{sleep, energy, ailments})`, `hydration(Double)`, `notes(String)`, `rest(Bool)`, `dietVariant(String)`, `cardio(Cardio{id, type, min, km, note})`), `SetLogData`, `WorkoutSessionData`, `MealCheckData`, `SupplementCheckData`, `BodyWeightData`, `BodyMeasureData` (`date` + `[String: Double]`), `ShoppingCheckData`, `ShoppingExtraData`, `ExerciseNoteData`, `PersonalRecordData { exerciseName, peso: Double, date: String? }`, `CoachMessageData { date, index, role, text }`, `SettingValue`.
- Fixture: `plans.json` (record `workoutPlan`/`dietPlan` da `scheda.txt`/`dieta.txt` via `PlanConv`), `records-sample.json` (record di tutte le collezioni da `recordmap` su `backend/test/fixtures/pwa-backup-sample.json`), `insights-cases.json`, `progress-cases.json` (input → output delle funzioni JS citate nel Task 7).

- [ ] **Step 1: Test** (`ContractTests`): ogni record di `plans.json` e `records-sample.json` si decodifica nel tipo della sua collezione e si ricodifica in JSON **semanticamente uguale** all'originale (confronto `JSONValue`); un `dietPlan` senza `shopping`/`note`/`draft` si decodifica (campi opzionali); `JSONValue` mantiene `3` come intero e `2.5` come decimale.
- [ ] **Step 2:** `swift test --package-path Packages/FitnessCore` → FAIL.
- [ ] **Step 3:** implementa i tipi. Genera le fixture con `node dev/gen-swift-fixtures.mjs "<repo app>/Packages/FitnessCore/Tests/FitnessCoreTests/Fixtures"` e committale nel repo app (il generatore nel repo `Fitness App`).
- [ ] **Step 4:** `swift test` → PASS.
- [ ] **Step 5:** commit in entrambi i repo: `feat(core): record e modelli del contratto` / `docs(contract): draft, meal.note, shopping nel piano dieta; generatore fixture Swift`.

### Task 5: FitnessCore — store SQLite, identità, motore di sync

**Files:**
- Create: `Sources/FitnessCore/Store/{SQLite.swift, LocalStore.swift}`, `Sources/FitnessCore/Identity/{Identity.swift, KeychainTokenStore.swift}`, `Sources/FitnessCore/Sync/{SyncTransport.swift, HTTPSyncTransport.swift, SyncEngine.swift, SyncStatus.swift}`, `Tests/FitnessCoreTests/{LocalStoreTests, SyncEngineTests, FakeSyncServer, LiveServerTests}.swift`

**Interfaces:**
- Produces: `final class LocalStore: @unchecked Sendable` (serializzato su una coda privata) — `init(directory: URL) throws` (file `fitness.sqlite`), `record(_ c: RecordCollection, _ id: String) -> SyncRecord?`, `records(_ c: RecordCollection) -> [SyncRecord]` (senza tombstone), `write(_ c: RecordCollection, _ id: String, data: JSONValue?, now: Int64) -> SyncRecord` (applica la regola `updatedAt`, aggiorna cache e outbox), `applyRemote(_ records: [SyncRecord])` (salta i `collection/id` che hanno un change in outbox), `adoptConflicts(_ records: [SyncRecord])` (sovrascrive cache, rimuove l'outbox di quelle chiavi), `outbox(limit: Int) -> [Change]`, `confirm(_ changes: [Change])` (rimuove dall'outbox solo se l'`updatedAt` coincide ancora), `meta(_ key: String) -> String?`, `setMeta(_ key: String, _ value: String?)`, `changes: AsyncStream<Set<RecordCollection>>` (notifica le collezioni toccate).
- Produces: `enum StorePaths { static func directory(for ownerId: String, base: URL) -> URL }` (`base` = Application Support nell'app);
- Produces: `struct Identity: Sendable, Equatable { ownerId: String }`; `protocol IdentityProvider: Sendable { func current() -> Identity?; func authorizationHeader() throws -> String; func link(token: String, baseURL: URL) async throws -> Identity; func unlink() }`; `final class TokenIdentityProvider: IdentityProvider` (token nel Keychain service `it.faraoni.fitnesshub.sync`; `link` chiama `GET /v1/me` e salva `ownerId` in UserDefaults; il token non compare in `description`, log o errori).
- Produces: `protocol SyncTransport: Sendable { func sync(_ body: SyncRequest, authorization: String) async throws -> SyncResponse; func me(authorization: String) async throws -> MeResponse }`; `SyncRequest { deviceId, cursor: Int64, changes: [Change] }`; `SyncResponse { cursor, more, changes: [SyncRecord], applied, stale, conflicts: [SyncRecord], epoch: Int64?, reset: Bool }`; `actor SyncEngine { init(store: LocalStore, transport: SyncTransport, identity: IdentityProvider); func syncNow() async -> SyncOutcome; var status: SyncStatus }`; `enum SyncStatus: Sendable { idle, syncing, ok(lastSync: Date), offline, unlinked, error(String) }`; `SyncOutcome { pushed: Int, pulled: Int, status: SyncStatus }`.

- [ ] **Step 1: Test** (Swift Testing, `FakeSyncServer` = LWW + seq + epoch + `conflicts` come `backend/src/store.mjs`, in memoria):
  - `writeAppliesUpdatedAtRule`: orologio indietro → `updatedAt` = locale + 1.
  - `twoDevicesMerge`: A spunta un pasto, B spunta la spesa, due `syncNow()` a testa → entrambi vedono entrambi i record, nessun doppione.
  - `offlineQueueSurvivesRestart`: transport che lancia `URLError(.notConnectedToInternet)` → status `offline`, outbox persistito; nuovo `LocalStore` sullo stesso file + rete ok → un solo invio, outbox vuoto.
  - `pendingWinsLocally`: change locale in outbox + record più vecchio in arrivo dal pull → la cache tiene il valore locale; dopo il push resta il locale.
  - `staleAdoptsServer`: change più vecchio del server → `conflicts` → cache = versione del server, outbox vuoto.
  - `resetAndEpochRepull`: `reset: true` o `epoch` diverso → nuovo pull da cursore 0, outbox intatto, nuovo `epoch` salvato.
  - `batches`: 1.200 change → 3 richieste, ognuna ≤ 500 change e ≤ 1,5 MB.
  - `unauthorized`: 401 → status `error("non autorizzato")`, outbox intatto; nessuna identità → `unlinked`, nessuna richiesta.
  - `tokenNeverLeaks`: `String(describing:)` di identità, errori e `SyncStatus` non contiene il token di test.
  - `ownerScopedDirectory`: `StorePaths.directory(for: "abc", base: tmp)` → `tmp/accounts/abc/`; due owner = due file SQLite distinti.
- [ ] **Step 2:** `swift test` → FAIL.
- [ ] **Step 3:** implementa. `deviceId` = `ios-<uuid>` generato una volta e salvato in `meta`. Il cursore si aggiorna solo dopo aver applicato la pagina. Con `more: true` si continua nello stesso `syncNow()`. Gli errori HTTP diventano messaggi in italiano senza corpo della richiesta.
- [ ] **Step 4:** `LiveServerTests` (saltati se manca `FH_LIVE_SERVER`): con `node backend/dev/local-server.mjs --port 8787 --token test-token` acceso, due `SyncEngine` con store diversi fanno lo scenario `twoDevicesMerge` contro il Worker vero, e `link()` ottiene l'`ownerId` da `/v1/me`. Run: `FH_LIVE_SERVER=http://127.0.0.1:8787 FH_LIVE_TOKEN=test-token swift test --filter LiveServer` → PASS.
- [ ] **Step 5:** `swift test` → PASS. Commit `feat(core): store SQLite, identità separata, motore di sync offline-first`.

### Task 6: FitnessCore — dominio: letture e scritture del giorno

**Files:**
- Create: `Sources/FitnessCore/Domain/{FitnessData.swift, Today.swift, Plans+Active.swift, WorkoutLog.swift, DietLog.swift, BodyLog.swift, PlanLifecycle.swift}`, `Tests/FitnessCoreTests/{FitnessDataTests, PlanLifecycleTests}.swift`

**Interfaces:**
- Consumes: `LocalStore`, tipi del Task 4.
- Produces: `@MainActor @Observable final class FitnessData` (si aggiorna da `LocalStore.changes`; ogni proprietà calcolata dipende da un contatore di revisione per collezione), con:
  - piani: `activeWorkoutPlan: (id: String, data: WorkoutPlanData)?`, `activeDietPlan`, `plans(_ kind: PlanKind) -> [(id, data)]` (attivo, bozze, archiviati per `validFrom` decrescente). La regola dell'attivo è la stessa di `PlanConv.activePlan`: `status == active`, poi `validFrom`, `updatedAt`, `id` più alti.
  - oggi: `today: String` (data locale `yyyy-MM-dd`, cambia a mezzanotte), `selectedWorkoutDay(on:) -> WorkoutDay?`, `selectWorkoutDay(_ id: String)`, `isRest(_ date) -> Bool`, `setRest(_ date, _ on: Bool)`, `dietVariant(on:) -> DietVariant?` (regola delle Decisioni), `setDietVariant(_ date, key:)`.
  - scheda: `sets(on date) -> [String: SetLogData]` (per id record), `setSet(date:, exercise: Exercise, planId:, setIndex:, weight:, reps:, done:, substitutedWith:)`, `closeSession(date:, day: WorkoutDay, startedAt: Int64?) -> SessionSummary` (scrive `workoutSession` `done:true` e aggiorna i `personalRecord`; idempotente), `exerciseNote(_ name) / setExerciseNote`.
  - dieta: `mealDone(date, mealId) / setMealDone`, `supplementDone / setSupplementDone` (entrambi scrivono anche `dietVariant`), `checkIn(date) / setCheckIn`, `hydration / setHydration`, `notes / setNotes`, `cardio(date) -> [Cardio] / addCardio / removeCardio` (tombstone).
  - corpo: `weights: [BodyWeightData]` (ordinate), `logWeight(date, kg)` (aggiorna anche `settings.bodyWeight`), `removeWeight(date)`, `measures / saveMeasure`.
  - impostazioni: `setting(_ key) -> JSONValue? / setSetting(_ key, _ value)` (`excludedFoods`, `spesaFreq`, `weightGoal`, `bodyWeight`, `theme`).
- Produces: `PlanLifecycle.duplicateAsDraft(_ plan: WorkoutPlanData|DietPlanData, name: String) -> (id: String, data)` (id nuovi ovunque tranne gli item della spesa), `activate(draftId:, kind:, today:) -> [Change]` (bozza attiva + vecchio archiviato), `encodedSize(_:) -> Int`, `maxPlanBytes = 60_000`.

- [ ] **Step 1: Test:**
  - ogni scrittura produce l'id e il `data` del contratto: confronto con i record corrispondenti di `records-sample.json` per gli stessi input.
  - `setMealDone(false)` → record `done:false`, non tombstone; `removeCardio` → tombstone di `${date}:cardio:${id}`.
  - `closeSession` chiamato due volte → un solo `workoutSession`, PR aggiornati una sola volta.
  - **cambio piano in giornata:** serie spuntate su `workout-2026-11/d0/e0`, poi `activate` di una bozza duplicata → `sets(on: oggi)` contiene ancora le serie con `exerciseName` del piano vecchio; il giorno selezionato del piano nuovo non le mostra sui suoi esercizi.
  - `dietVariant`: con record salvato → quella; senza, giorno di allenamento → prima variante con `training`; con `rest` → prima senza `training`; record che punta a una variante assente → regola di default.
  - `duplicateAsDraft`: nessun id in comune col piano sorgente tranne `shopping[].items[].id`; `status == draft`.
  - `activate`: due change, vecchio `archived` con `validTo = today`, nuovo `active` con `validFrom = today`.
  - piano oltre 60.000 byte → `PlanLifecycle.validate` restituisce `.tooLarge(bytes)`.
- [ ] **Step 2:** `swift test` → FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** `swift test` → PASS.
- [ ] **Step 5:** commit `feat(core): dominio del giorno, ciclo di vita dei piani`.

### Task 7: FitnessCore — calcoli portati dalla PWA (parità con fixture)

**Files:**
- Create: `Sources/FitnessCore/Logic/{Insights.swift, Progression.swift, ShoppingList.swift, CoachContext.swift, Timeline.swift}`, `Tests/FitnessCoreTests/{InsightsParityTests, ProgressionParityTests, ShoppingListTests, CoachContextTests, TimelineTests}.swift`

**Interfaces:**
- Produces: `enum Insights` con `e1rm(weight: String, reps: Int?) -> Double?`, `exerciseSessions(_ logs: [SetLogData], name: String, limit: Int) -> [ExerciseSession]`, `sessionSummary(…) -> SessionSummary { durationMin, tonnage, deltaVsPrevious, prs }`, `weeklyReport(…)`, `deloadAdvice(_ checkIns: [CheckIn]) -> DeloadAdvice`, `deloadWeight(_ raw: String) -> Double?`, `movingAverage(_ weights: [BodyWeightData], window: Int) -> [Double?]`, `weightProjection(_ weights:, targetKg:, days:) -> WeightProjection?`, `mealAdherence(done: Int, total: Int) -> Double`, `foodSwaps(food: String, qty: String) -> [FoodSwap]` (stesse soglie e tabelle di `insights.jsx`); `enum Progression` con `parseWeight(String) -> Double?`, `suggestNext(lastRaw: String?) -> String?`, `applySession(prs: [String: PersonalRecordData], sets: [SetLogData]) -> (prs, newPRs)`; `ShoppingList.items(plan: DietPlanData?, fallback: [ShoppingCategory]) -> [ShoppingCategory]` e `quantity(_ item: ShoppingItem, freq: Int) -> String`; `CoachContext.build(question: String, data: CoachInputs, lang: String) -> String` (≤ 6.000 caratteri; sezioni: oggi, sessione, check-in ultimi 3, peso e trend, aderenza, sintesi piano attivo, esclusioni; si tagliano prima le sezioni meno pertinenti alla domanda: allenamento/cibo/peso per parole chiave IT+EN); `Timeline.build(variant: DietVariant) -> [TimelineEntry]` (pasti + integratori in ordine di orario, come `_buildTimeline` in `screens/dieta.jsx:220`).

- [ ] **Step 1: Test:** ogni caso di `insights-cases.json` e `progress-cases.json` dà lo stesso risultato in Swift (numeri entro 1e-9; stesse stringhe). `ShoppingList.items(plan: nil, …)` = fallback; `quantity` sceglie `qty2` con `freq == 2`. `CoachContext`: con dati enormi (365 pesi, piano completo) resta ≤ 6.000 caratteri e contiene sempre le esclusioni; una domanda su "pasta" tiene la sezione dieta. `Timeline` ordina per orario `HH:MM`, a pari orario prima i pasti.
- [ ] **Step 2:** `swift test` → FAIL.
- [ ] **Step 3:** porta la logica leggendo `insights.jsx`, `progress.jsx`, `screens/dieta.jsx` (`_buildTimeline`), `screens/coach.jsx` (`_buildSystemPrompt`, solo come riferimento per i contenuti). Niente lista fissa di integratori.
- [ ] **Step 4:** `swift test` → PASS.
- [ ] **Step 5:** commit `feat(core): insights, progressione, spesa, contesto Coach (parità PWA)`.

### Task 8: Lista della spesa nel piano dieta (backend dati + PWA)

**Files (repo `Fitness App`):**
- Create: `backend/migrate/add-shopping.mjs` (dry-run di default; `--push`: aggiunge `shopping` al `dietPlan` attivo sul server, con `updatedAt` per regola)
- Modify: `screens/spesa.jsx` (lista da `plan_diet.data.shopping`, fallback `CATEGORIES`; `window.SPESA_CATEGORIES = CATEGORIES` esposto per lo script), `planconv.jsx` (nessuna perdita di `shopping` nelle conversioni), `test/run.mjs` (Suite Spesa), `sw.js`/`index.html` (bump del deploy)

- [ ] **Step 1: Test** (`npm test`): con `plan_diet` che ha `shopping` la Spesa mostra quelle categorie e usa `item.id` come chiave di spunta; senza `shopping` → `CATEGORIES` con chiavi `${cat.id}-${i}` (identiche a oggi); `add-shopping.mjs` in dry-run produce `shopping` con item `proteine-0…` e gli stessi testi di `CATEGORIES`.
- [ ] **Step 2:** `npm run build && npm test` → FAIL, poi implementa → PASS; `npm run test:e2e` → PASS.
- [ ] **Step 3: Live (controller):** dry-run → mostra a Lorenzo il numero di categorie e voci → con il suo ok `--push` → verifica in sola lettura che il `dietPlan` attivo abbia `shopping`. Deploy della PWA col flusso di CLAUDE.md. Lorenzo apre la Spesa: stesse voci, spunte intatte.
- [ ] **Step 4:** commit + deploy `feat(pwa): lista della spesa dal piano dieta`.

### Task 9: App — guscio, design system Liquid Glass, collegamento, sync

**Files (repo app):**
- Create: `App/AppEnvironment.swift` (costruisce identità, store per proprietario, `FitnessData`, `SyncEngine`; URL backend: produzione, oppure in DEBUG l'argomento di lancio `-syncBaseURL`), `App/SyncCoordinator.swift` (trigger: avvio, `scenePhase == .active`, timer 45 s, `NWPathMonitor`, 1,5 s dopo una modifica), `App/RootView.swift` (TabView), `Design/{Theme.swift, GlassComponents.swift, SyncBadge.swift, Haptics.swift}`, `Features/Link/LinkView.swift`, `Resources/Localizable.xcstrings`, `UITests/LaunchTests.swift`
- Modify: `project.yml`

**Interfaces:**
- Consumes: `TokenIdentityProvider`, `LocalStore`, `SyncEngine`, `FitnessData`.
- Produces: `@MainActor @Observable final class AppEnvironment { identity: Identity?; data: FitnessData?; sync: SyncCoordinator?; func link(token: String) async throws; func unlink() }` (store in `StorePaths.directory(for: ownerId, base: Application Support)`). Tab: **Oggi**, **Allenamento**, **Dieta**, **Spesa**, **Coach** (`Tab(…, systemImage:)`, `.tabBarMinimizeBehavior(.onScrollDown)`). Storico, Piani e Impostazioni si aprono dall'avatar LF in alto in Oggi, come nella PWA. Componenti: `GlassCard`, `GlassPill`, `PrimaryGlassButton` (`.buttonStyle(.glassProminent)`), `SectionHeader`, `SyncBadge(status:)`.
- Launch argument DEBUG (in `App/DebugLaunch.swift`, tutto sotto `#if DEBUG`, assente in Release): `-syncBaseURL http://127.0.0.1:8787 -syncToken <t> -resetStore YES` (collega e pulisce lo store all'avvio), `-theme light|dark`, `-today yyyy-MM-dd` (data finta per `FitnessData.today`), `-forceOffline YES` (transport che fallisce finché non arriva la notifica Darwin `it.faraoni.fitnesshub.online`, inviata dall'UI test), `-fakeCoach YES` (Task 16). Servono solo agli UI test.

- [ ] **Step 1: UI test** (`LaunchTests`, server locale del Task 3 avviato dallo script `scripts/uitest.sh`, che lancia `local-server.mjs`, esegue `xcodebuild test` e spegne il server): senza token → schermata "Collega" con campo e pulsante "Incolla"; con token di test → le 5 tab, `SyncBadge` "Sincronizzato"; tema scuro e chiaro (argomento `-theme`) senza testi illeggibili (snapshot di accessibilità: nessun elemento con contrasto sotto 4.5:1 secondo `XCUIApplication.performAccessibilityAudit()`).
- [ ] **Step 2:** `scripts/uitest.sh` → FAIL.
- [ ] **Step 3:** implementa. "Collega": campo sicuro + pulsante "Incolla dagli appunti" (`PasteButton`); il token incollato non si mostra mai per intero; errore 401 → "Token non valido". Dopo il collegamento il primo sync parte subito, con indicatore di avanzamento non bloccante.
- [ ] **Step 4:** `scripts/uitest.sh` → PASS; `swift test` → PASS.
- [ ] **Step 5:** commit `feat(app): guscio, Liquid Glass, collegamento e sync`.

### Task 9A: Backend — account con email e password, sessioni, Accedi con Apple spento

**Files (repo `Fitness App`):**
- Create: `backend/migrations/0003_accounts.sql`, `backend/src/auth.mjs` (hash password, sessioni, verifica JWT Apple), `backend/admin/account.mjs` (CLI), `backend/test/auth.test.mjs`
- Modify: `backend/schema.sql`, `backend/src/worker.mjs` (route + `resolveOwner`), `backend/wrangler.toml` (`[vars] REGISTRATION_OPEN = "false"`, `APPLE_SIGNIN_ENABLED = "false"`, `APPLE_BUNDLE_ID = "it.faraoni.fitnesshub"`), `backend/dev/local-server.mjs` (`--account <email>:<password>` crea un account di test all'avvio, solo per test), `backend/README.md`, `backend/CONTRACT.md` (sezione Accesso)

**Interfaces:**
- Tabelle: `accounts(id TEXT PRIMARY KEY /* = ownerId */, email TEXT UNIQUE COLLATE NOCASE, pw_hash TEXT, pw_salt TEXT, pw_iter INTEGER, apple_sub TEXT UNIQUE, created_at INTEGER, disabled INTEGER DEFAULT 0)`, `sessions(id TEXT PRIMARY KEY /* SHA-256 hex del token */, account_id TEXT, device_name TEXT, created_at INTEGER, last_used_at INTEGER, expires_at INTEGER, revoked INTEGER DEFAULT 0)`, `login_attempts(key TEXT, at INTEGER)`.
- Password: PBKDF2-SHA256 con WebCrypto, 100.000 iterazioni (limite dei Worker), salt casuale da 16 byte, confronto a tempo costante. Password minima 10 caratteri.
- Endpoint: `POST /v1/auth/login {email, password, deviceName}` → `200 { session, ownerId, email, expiresAt }` | `401 {error:"credenziali non valide"}` (stesso messaggio per email inesistente e password sbagliata) | `429` dopo 5 errori in 15 minuti per email o per IP. `POST /v1/auth/logout` (Bearer) → revoca la sessione. `POST /v1/auth/password {current, next}` (Bearer) → cambia password e revoca le altre sessioni. `POST /v1/auth/register` → `403` se `REGISTRATION_OPEN != "true"`. `POST /v1/auth/apple {identityToken, nonce, deviceName}` → `404` se `APPLE_SIGNIN_ENABLED != "true"`; altrimenti verifica il JWT di Apple (RS256 con le chiavi pubbliche `https://appleid.apple.com/auth/keys`, in cache 1 h; `iss = https://appleid.apple.com`, `aud = APPLE_BUNDLE_ID`, `exp`, `nonce` = SHA-256 del nonce inviato) e accede all'account con quel `apple_sub`, senza creare account se la registrazione è chiusa. `POST /v1/auth/apple/link` (Bearer + identityToken) collega l'Apple ID all'account corrente. `GET /v1/me` → `{ ownerId, email, epoch }`.
- `resolveOwner(request, env)`: Bearer = sessione valida (hash trovato, non revocata, non scaduta) → `account_id`, ed estende `last_used_at`/`expires_at` (al massimo una scrittura all'ora per sessione). `SYNC_TOKEN` resta valido verso `PRIMARY_OWNER` solo se `env.LEGACY_TOKEN_ENABLED == "true"` (vero durante il passaggio).
- CLI `node backend/admin/account.mjs create --email <e> --owner <PRIMARY_OWNER> [--local <db>|--remote]`, `reset-password --email <e>`, `sessions --email <e>`, `revoke --email <e>`: la password si legge **dal terminale senza eco** (due volte, devono coincidere), non viene mai stampata né accettata come argomento o variabile d'ambiente; la scrittura remota passa da `wrangler d1 execute --remote --command` con valori già hashati.

- [ ] **Step 1: Test** (`auth.test.mjs`, D1 su `node:sqlite`): login ok → sessione che funziona su `/v1/sync` e `/v1/me` per l'owner giusto; password sbagliata ed email inesistente → stesso 401; 6° tentativo → 429; logout → la sessione dà 401; cambio password → le altre sessioni danno 401; sessione scaduta → 401; `register` → 403; `/v1/auth/apple` → 404 con flag spento; con flag acceso e una coppia di chiavi RSA di test (JWKS finto iniettato) → JWT valido entra, `aud`/`iss`/`exp`/`nonce` sbagliati → 401; `SYNC_TOKEN` accettato solo con `LEGACY_TOKEN_ENABLED`; la tabella `sessions` non contiene mai il token in chiaro; la CLI rifiuta `--password` come argomento.
- [ ] **Step 2:** `cd backend && npm test` → FAIL → implementa → PASS (+ `npm test` e `npm run test:e2e` della PWA ancora verdi).
- [ ] **Step 3: Live (controller):** bookmark Time Travel → migrazione `0003` remota → `wrangler deploy` con `LEGACY_TOKEN_ENABLED = "true"` → verifica che la PWA (token) sincronizzi ancora. Poi **Lorenzo** lancia nel suo Terminale `node backend/admin/account.mjs create --email <la sua email> --owner <PRIMARY_OWNER> --remote` e sceglie la password (Claude non la vede). Verifica: `POST /v1/auth/login` fatto da Lorenzo nell'app/PWA (Task 9B/9C), non da Claude.
- [ ] **Step 4:** commit + push `feat(backend): account email+password, sessioni, Accedi con Apple (spento)`.

### Task 9B: App — Accedi (email e password), Accedi con Apple spento, Account

**Files (repo app):** Create `Packages/FitnessCore/Sources/FitnessCore/Identity/AccountIdentityProvider.swift` (+ test), `Features/Account/{LoginView.swift, AccountView.swift, ChangePasswordView.swift}`, `UITests/LoginTests.swift`; Modify `App/AppEnvironment.swift`, `App/RootView.swift`, `Config/Capabilities.xcconfig` (`APPLE_SIGNIN` spento), `project.yml` (entitlement `com.apple.developer.applesignin` solo con il flag), `scripts/uitest.sh` (`--account` di test), `App/DebugLaunch.swift`; Delete `Features/Link/LinkView.swift` (sostituita).

**Interfaces:**
- `final class AccountIdentityProvider: IdentityProvider` con `login(email:password:deviceName:) async throws -> Identity`, `loginWithApple(identityToken:nonce:) async throws -> Identity` (compilato sempre, raggiungibile solo con `#if APPLE_SIGNIN`), `logout() async` (revoca sul server se c'è rete, cancella sempre la sessione dal Keychain), `changePassword(current:next:) async throws`, `email: String?`. La sessione sta nel Keychain (stesso `SecretStore`), l'`ownerId` e l'email in UserDefaults. Un 401 durante il sync → stato `sessionExpired` → l'app mostra "Accedi di nuovo" senza perdere outbox né dati locali.
- `LoginView`: campi email (`.textContentType(.username)`, tastiera email) e password (`SecureField`, `.textContentType(.password)`, così Portachiavi iCloud può proporla e salvarla), "Accedi" in vetro prominente, errori chiari ("Email o password non corretti", "Troppi tentativi: riprova tra qualche minuto", "Nessuna connessione"). Sotto, solo con `APPLE_SIGNIN`: `SignInWithAppleButton`. Nessun pulsante "Registrati" finché la registrazione è chiusa.
- `AccountView` (dal profilo LF): email, "Cambia password", "Esci" (conferma: "I dati restano su questo iPhone e sul server"), riga "Accedi con Apple: in arrivo" spenta senza flag.
- DEBUG: `-loginEmail`/`-loginPassword` per gli UI test contro il server locale (mai in Release).

- [ ] **Step 1: Test:** `AccountIdentityProvider` col server finto: login salva la sessione e l'owner; credenziali sbagliate → errore tipizzato; logout cancella sempre il Keychain anche offline; `description` e gli errori non contengono la password né la sessione. **UI test** (server locale con `--account test@example.com:<password di test generata dallo script>`): login → tab; password sbagliata → messaggio; esci → torna ad Accedi; sessione revocata dal server → "Accedi di nuovo".
- [ ] **Step 2:** FAIL → implementa → PASS (`swift test` + `scripts/uitest.sh`).
- [ ] **Step 3:** commit `feat(app): accesso con email e password, Accedi con Apple predisposto`.

### Task 9C: PWA — Accedi al posto del token, passaggio dei device, via il token legacy

**Files (repo `Fitness App`):** `screens/impostazioni.jsx` (sezione Account: Accedi / email / Esci / Cambia password al posto del campo token), `screens/onboarding.jsx` (passo Accedi, saltabile), `syncv2.jsx` (`login`/`logout` → `syncToken` = sessione; 401 → stato `expired` con invito ad accedere; via il link `#sync=`), `i18n.jsx`, `test/run.mjs`, `test/e2e/run.mjs`, `test/e2e/mock.mjs` (account di test), `backend/wrangler.toml` (alla fine `LEGACY_TOKEN_ENABLED = "false"`), `CLAUDE.md`, `backend/README.md`.

**Creazione dell'account dalla PWA (richiesta di Lorenzo, 2026-11-03: niente Terminale):** endpoint `POST /v1/auth/claim {email, password, deviceName}` in `backend/src/worker.mjs`, autorizzato **solo** col token legacy (`LEGACY_TOKEN_ENABLED == "true"` e Bearer = `SYNC_TOKEN`) e **solo se non esiste ancora un account** con `id = PRIMARY_OWNER`: crea l'account per `PRIMARY_OWNER` (stesso hash/pepper di `account.mjs`, stesse regole sulla password, stesso limite di tentativi) e restituisce `{ session, ownerId, email, expiresAt }`; altrimenti `409` (account già esistente) o `401`. La PWA, se è collegata col token legacy, mostra in Impostazioni → Account e nell'onboarding **"Crea il tuo account"** (email, password, conferma password, avviso "almeno 10 caratteri"): al successo salva la sessione al posto del token. Test backend in `backend/test/auth.test.mjs` (claim ok una volta, secondo claim 409, claim senza/ con token sbagliato 401, claim con flag legacy spento 401) e PWA.

- [ ] **Step 1: Test:** `npm test` (claim/login salvano la sessione, logout la cancella, 401 → `expired` con coda intatta, `#sync=` ignorato) ed e2e (due device che accedono con lo stesso account di test vedono le stesse spunte; sessione revocata → invito ad accedere; nessuna password in storage né in `errorLog`).
- [ ] **Step 2:** FAIL → implementa → PASS; deploy PWA col flusso di CLAUDE.md.
- [ ] **Step 3: Passaggio (con Lorenzo):** Lorenzo accede con email e password sulla PWA da Home e nell'app; verifica dal server che i suoi device scrivano con le sessioni. Poi `LEGACY_TOKEN_ENABLED = "false"` + `wrangler deploy` + `wrangler secret delete SYNC_TOKEN`; il file `~/.config/fitness-hub/sync-token` si cancella (con il suo ok). Gli strumenti da Mac (migrate, add-shopping, controlli in sola lettura) passano a una sessione ottenuta con `account.mjs login`, salvata in `~/.config/fitness-hub/session` (600).
- [ ] **Step 4:** commit + push; CLAUDE.md e memoria aggiornati.

### Task 10: App — Oggi (Home)

**Files:** Create `Features/Today/{TodayView.swift, TodayHeroCard.swift, NextMealRow.swift, CheckInCard.swift, WeightTile.swift, HydrationCard.swift, MovementCard.swift, WeekSummaryCard.swift, WeeklyReportCard.swift}`, `UITests/TodayTests.swift`

**Interfaces:** Consumes `FitnessData` (oggi, piani, check-in, peso, idratazione, cardio, `Insights.weeklyReport`, `Progression` per i nudge). Produces la navigazione "Inizia allenamento" → tab Allenamento con il Player aperto (`AppRouter.openPlayer()` in `App/AppRouter.swift`).

- [ ] **Step 1: UI test:** con i dati di `records-sample.json` caricati sul server locale (`local-server.mjs --seed <file>`): Oggi mostra il giorno selezionato o "Oggi riposo", il prossimo pasto della variante del giorno, il check-in (sonno/energia a 5 tacche, fastidi) che si salva e dopo un sync compare sul server; il peso registrato da sheet aggiorna il riquadro; il report settimanale c'è solo domenica e lunedì (argomento DEBUG `-today 2026-11-08`).
- [ ] **Step 2:** FAIL → implementa la parità con `screens/dashboard.jsx` (pull-to-refresh = `syncNow`) → PASS.
- [ ] **Step 3:** commit `feat(app): Oggi`.

### Task 11: App — Allenamento: lista, Player, timer in-app, riepilogo

**Files:** Create `Features/Workout/{WorkoutView.swift, DayPicker.swift, ExerciseCard.swift, SetRow.swift, PlayerView.swift, RestTimer.swift, SubstitutionSheet.swift, SessionSummaryView.swift, LastSessionsCard.swift}`, `UITests/WorkoutTests.swift`; `FitnessCore/Logic/RestTimerState.swift` + test

**Interfaces:**
- Consumes: `FitnessData` (scheda), `Insights`, `Progression`.
- Produces: `struct RestTimerState: Codable, Sendable { endsAt: Date; exerciseName: String; nextLabel: String }` con `remaining(at: Date) -> TimeInterval` (basato sull'ora di fine, come `TimerOverlay`), `RestTimer` (`@Observable`): `start(seconds:context:)`, `skip()`, `addTime(_:)`, `onFinish`. Il Task 17 ci aggancia notifica e Live Activity tramite `protocol RestTimerSideEffects { func started(_ s: RestTimerState); func cancelled(); func finished() }`. Il timer attivo si vede come `.tabViewBottomAccessory` (mini-timer in vetro) quando si lascia il Player.

- [ ] **Step 1: Test** (Swift Testing): `RestTimerState.remaining` con `Date` iniettata (app sospesa 90 s → 0, mai negativo). **UI test:** spunta serie in lista → il Player mostra le stesse spunte (stato condiviso per id); "Serie fatta" avvia il recupero e poi passa alla serie o all'esercizio successivo (recupero anche fra esercizi); sostituzione da `alternatives`; nota setup salvata; chiusura → riepilogo (durata, tonnellaggio, PR) e un solo `workoutSession`; **offline**: argomento `-forceOffline` (transport che fallisce), 12 serie, app terminata e rilanciata, rete ripristinata → 12 `setLog` sul server, nessun doppione.
- [ ] **Step 2:** FAIL → implementa la parità con `screens/scheda.jsx` (Player a schermo intero con `fullScreenCover`; peso grande come testo libero: kg o colore elastico; chip deload da `Insights.deloadAdvice`; condivisione del riepilogo con `ShareLink`) → PASS.
- [ ] **Step 3:** commit `feat(app): scheda, Player, recupero, riepilogo`.

### Task 12: App — Dieta del giorno

**Files:** Create `Features/Diet/{DietView.swift, VariantPicker.swift, TimelineView.swift, MealCard.swift, SupplementRow.swift, FoodSwapSheet.swift, CardioSheet.swift}`, `UITests/DietTests.swift`

- [ ] **Step 1: UI test:** la variante iniziale segue la regola (con `dietVariant` del giorno sul server → quella); la timeline mette pasti e integratori in ordine; con un piano senza integratori in una variante non ne compare nessuno; spunta pasto → record `mealCheck` + `dietVariant` sul server; pill di aderenza; ⇄ apre le equivalenze (`Insights.foodSwaps`); idratazione e cardio si salvano.
- [ ] **Step 2:** FAIL → implementa la parità con `screens/dieta.jsx` (alimenti esclusi evidenziati se compaiono nel piano) → PASS.
- [ ] **Step 3:** commit `feat(app): dieta del giorno`.

### Task 13: App — Spesa

**Files:** Create `Features/Shopping/{ShoppingView.swift, ShoppingCategorySection.swift, ShoppingExtraRow.swift}`, `UITests/ShoppingTests.swift`; `FitnessCore/Logic/ShoppingFallback.swift` (lo stesso `CATEGORIES` della PWA, usato solo se il piano non ha `shopping`). Parità: `dev/gen-swift-fixtures.mjs` scrive anche `shopping-fallback.json` da `window.SPESA_CATEGORIES` (Task 8), e un test di `FitnessCore` lo confronta col fallback Swift.

- [ ] **Step 1: UI test:** voci dal `shopping` del piano attivo; spunta → `shoppingCheck` con id dell'item (`proteine-4`); 1 o 2 spese a settimana cambia le quantità e salva `settings.spesaFreq`; articolo extra aggiunto ed eliminato (tombstone); "Svuota spunte".
- [ ] **Step 2:** FAIL → implementa la parità con `screens/spesa.jsx` → PASS.
- [ ] **Step 3:** commit `feat(app): spesa`.

### Task 14: App — Storico (Swift Charts)

**Files:** Create `Features/History/{HistoryView.swift, WeightChart.swift, StrengthChart.swift, VolumeChart.swift, MeasuresView.swift, SessionLogView.swift, CheckInHistoryView.swift}`, `UITests/HistoryTests.swift`

- [ ] **Step 1: UI test** con dati seed: le 6 sezioni della PWA (peso con media mobile 7 g, obiettivo e proiezione; forza e1RM per esercizio, compresi esercizi di piani archiviati o eliminati, letti per `exerciseName`; volume per muscolo; misure con inserimento; registro sessioni; check-in). Ogni grafico ha un'etichetta di accessibilità con l'ultimo valore.
- [ ] **Step 2:** FAIL → implementa la parità con `screens/storico.jsx` → PASS.
- [ ] **Step 3:** commit `feat(app): storico`.

### Task 15: App — Editor dei piani e storico dei piani

**Files:** Create `Features/Plans/{PlansView.swift, PlanDetailView.swift, WorkoutPlanEditor.swift, WorkoutDayEditor.swift, ExerciseEditor.swift, DietPlanEditor.swift, VariantEditor.swift, MealEditor.swift, SupplementEditor.swift, ShoppingEditor.swift, NameSuggestions.swift}`, `UITests/PlanEditorTests.swift`

**Interfaces:** Consumes `FitnessData.plans`, `PlanLifecycle`. Le modifiche si salvano come record del piano (bozza o attivo) a ogni conferma di un foglio di modifica, non a ogni tasto.

- [ ] **Step 1: UI test:**
  - Piani → scheda attiva → "Nuovo dal precedente" → bozza → rinomina un giorno, aggiungi un esercizio (serie/ripetizioni "8-12"/recupero con tastiera numerica, suggerimento dal nome già usato), riordina per trascinamento → "Attiva" → la tab Allenamento mostra il piano nuovo, il vecchio è in "Storico piani" con il periodo, in sola lettura.
  - Stesso flusso per la dieta: variante con allenamento alle 17:00, pasto con 2 opzioni e una riga "Carboidrato" con 2 alternative, integratore "pre allenamento" alle 16:30, voce di spesa nuova.
  - **Cambio piano in giornata:** con serie e pasti spuntati oggi, attiva il piano nuovo → lo storico di oggi mostra ancora le serie sugli esercizi vecchi, e nessuna spunta compare su elementi nuovi.
  - Eliminare un piano archiviato chiede conferma e poi il piano sparisce (tombstone sul server).
  - Piano troppo grande → avviso e salvataggio rifiutato.
  - Alimenti esclusi modificabili (Impostazioni → Alimenti esclusi, record `settings.excludedFoods`).
- [ ] **Step 2:** FAIL → implementa (`List` con `.onMove` / `.onDelete`, fogli in vetro, `EditButton`) → PASS.
- [ ] **Step 3:** la PWA mostra il piano nuovo dopo il sync (verifica con `npm run test:e2e`, aggiungendo uno scenario con un piano `draft` che deve restare invisibile).
- [ ] **Step 4:** commit `feat(app): editor dei piani e storico`.

### Task 16: App — Coach con Apple Intelligence

**Files:** Create `Features/Coach/{CoachView.swift, CoachSession.swift, CoachAvailabilityView.swift, MarkdownLite.swift}`, `UITests/CoachTests.swift`

**Interfaces:**
- Consumes: `CoachContext.build`, `FitnessData` (oggi, check-in, peso, aderenza, piani, `settings.excludedFoods`).
- Produces: `protocol CoachModel: Sendable { var availability: CoachAvailability { get }; func stream(instructions: String, prompt: String) -> AsyncThrowingStream<String, Error> }`; `FoundationCoachModel` (`LanguageModelSession(instructions:)` + `streamResponse(to:)`, una sessione per giorno con riassunto dei messaggi precedenti se si supera il contesto); `FakeCoachModel` per gli UI test (argomento `-fakeCoach`).

- [ ] **Step 1: UI test** con `FakeCoachModel`: domanda → risposta in streaming visibile e messaggi salvati come `coachMessage` (`index` crescente); markdown minimo (grassetto, elenchi); con `availability = .unavailable(.appleIntelligenceNotEnabled)` la vista spiega come attivarla (Impostazioni → Apple Intelligence e Siri) e non c'è il campo di input.
- [ ] **Step 2:** FAIL → implementa. Istruzioni in IT o EN secondo la lingua dell'app: rispondere breve e pratico, **mai** proporre gli alimenti esclusi → PASS.
- [ ] **Step 3: QA reale** sul simulatore (se il Mac ha Apple Intelligence attiva) o sull'iPhone: 3 domande (allenamento di oggi, sostituzione di un alimento escluso, andamento del peso) → risposte pertinenti, nessun alimento escluso proposto. Annota i risultati nel ledger.
- [ ] **Step 4:** commit `feat(app): Coach sul dispositivo`.

### Task 17: App — esperienza nativa: notifiche, haptics, Live Activity, Salute

**Files:** Create `Native/{RestNotifications.swift, MealReminders.swift, RestLiveActivity.swift, HealthSync.swift, Capabilities.swift}`, `LiveActivity/RestTimerLiveActivity.swift` (completo), `Shared/RestTimerAttributes.swift` (in entrambi i target), `FitnessCore/Logic/ReminderPlanner.swift` + test

**Interfaces:**
- Consumes: `RestTimerSideEffects` (Task 11), `FitnessData`.
- Produces: `RestNotifications: RestTimerSideEffects` (`UNTimeIntervalNotificationTrigger` alla fine del recupero, id fisso `rest-timer` sostituito a ogni avvio e cancellato a `skip`; categoria con suono e `interruptionLevel = .timeSensitive` se concesso, altrimenti `.active`); `RestLiveActivity: RestTimerSideEffects` (solo con `#if LIVE_ACTIVITY`: `Activity.request` con `staleDate = endsAt`, fine con `.immediate` a skip/fine); `CompositeSideEffects`; `ReminderPlanner.plan(variant: DietVariant, date: Date, now: Date) -> [Reminder { id, at: Date, title, body }]` (pasti e integratori di oggi non ancora passati; id `meal-<mealId>` / `supp-<suppId>`); `MealReminders.reschedule()` (all'avvio, al cambio variante, a mezzanotte; massimo 32 notifiche in attesa); `HealthSync` (solo con `#if HEALTHKIT`): `requestAuthorization()`, `saveWeight(kg:date:)` a ogni pesata, `saveWorkout(start:end:)` (`.traditionalStrengthTraining`) alla chiusura della sessione, `latestWeight()` per la lettura opzionale; `Capabilities.healthKit` / `.liveActivity` (flag di compilazione + disponibilità a runtime).

**Dati Apple Watch da Salute (richiesta di Lorenzo, 2026-11-03):** solo lettura, dietro `#if HEALTHKIT` e interruttore "Usa i dati di Apple Watch". `HealthSync` aggiunge: `matchingWorkout(start:end:) async -> WatchWorkoutStats?` (`HKWorkout` di forza con sovrapposizione ≥ 50% con la sessione: durata, calorie attive, FC media e massima da `HKStatisticsQuery` sui campioni `heartRate` del periodo); alla chiusura della sessione, se esiste un allenamento del Watch corrispondente, l'app **non** salva il proprio `HKWorkout` e mostra le statistiche nel riepilogo; `cardioWorkouts(since:) async -> [WatchCardio]` (camminata, ellittica, corsa, bici: tipo, minuti, km, calorie) importati come `dayState` cardio con id `${date}:cardio:hk-<uuid HealthKit>` (id stabile = nessun doppione a ogni import; mai sovrascrivere un cardio inserito a mano), all'avvio e al ritorno in primo piano per gli ultimi 7 giorni; nello Storico (Task 14 già fatto o no: aggiungere qui una sezione "Apple Watch") calorie attive e FC media per allenamento. Mappatura dei tipi in `FitnessCore/Logic/WatchImport.swift` (pura, testata). Permessi letti: `workoutType`, `heartRate`, `activeEnergyBurned`, `distanceWalkingRunning`.

- [ ] **Step 1: Test** (Swift Testing): `WatchImport` mappa i tipi HealthKit nei tipi cardio della PWA, calcola gli id stabili e non produce doppioni reimportando gli stessi allenamenti; un cardio manuale con lo stesso orario non viene toccato; il criterio di sovrapposizione ≥ 50% sceglie l'allenamento giusto fra due. `ReminderPlanner` con variante di 5 pasti e 3 integratori alle 12:30 → solo gli eventi dopo le 12:30, ordinati, id stabili; senza integratori nel piano → nessun promemoria di integratori. Notifiche e Live Activity come side effect: `RestTimer` con un `SpySideEffects` → `started` all'avvio, `cancelled` a skip, `finished` alla fine; `addTime` → nuovo `started` con l'ora di fine aggiornata.
- [ ] **Step 2:** FAIL → implementa → PASS. Impostazioni (Task 18) ottiene gli interruttori: promemoria pasti e integratori, Salute (scrivi peso e allenamenti, leggi peso), Live Activity.
- [ ] **Step 3: QA sul device (con Lorenzo):** recupero da 60 s con schermo bloccato → notifica, suono e vibrazione all'ora giusta; Live Activity nella Dynamic Island e sulla schermata di blocco, se il flag è acceso; pesata → compare in Salute, se il flag è acceso. Esiti nel ledger e in `docs/capabilities.md`.
- [ ] **Step 4:** commit `feat(app): notifiche, Live Activity, Salute`.

### Task 18: App — Impostazioni

**Files:** Create `Features/Settings/{SettingsView.swift, SyncSettingsView.swift, ExcludedFoodsView.swift, BackupView.swift, DiagnosticsView.swift, NativeFeaturesView.swift, FeedbackView.swift, MailComposer.swift}`, `FitnessCore/Store/Backup.swift` + test, `FitnessCore/Diagnostics/ErrorLog.swift` + test, `FitnessCore/Feedback/FeedbackMessage.swift` + test, `UITests/SettingsTests.swift`

**Interfaces:** `Backup.export(store:, ownerId:) -> Data` (formato delle Decisioni), `Backup.restore(_ data: Data, into store: LocalStore, now: Int64) throws -> Int` (valida `format` e `ownerId`, rimette tutto in outbox); `ErrorLog.record(_ message: String)` (massimo 200 voci in `meta.errorLog`, testo ripulito da qualsiasi cosa somigli al token: `[0-9a-f]{32,}` → `«redatto»`); `FeedbackMessage.build(kind: FeedbackKind, text: String, tech: TechInfo?) -> (recipient: String, subject: String, body: String)` con `enum FeedbackKind { defect, improvement }`, `TechInfo { appVersion, build, iosVersion, deviceModel }`, `recipient = "lorefara97@gmail.com"`, oggetto `"[Fitness Hub] Difetto: <prime 6 parole>"` / `"[Fitness Hub] Miglioramento: …"` (EN: `Bug` / `Improvement`), corpo = testo dell'utente + (solo se `tech != nil`) un blocco "Info tecniche"; `mailtoURL(…) -> URL` per il fallback.

**Feedback (richiesta di Lorenzo, 2026-11-03):** Impostazioni → "Segnala un problema o un miglioramento". Scelta Difetto/Miglioramento, campo di testo, avviso sempre visibile sopra il campo: *"Descrivi solo il difetto o l'idea. Non inserire dati sensibili: salute, peso, dieta, dati personali, password."* "Invia" apre `MFMailComposeViewController` già compilato (l'utente rilegge e invia dal proprio Mail); senza Mail configurata → `mailto:` con `openURL`; senza nessuna app di posta → messaggio "Configura un account Mail" e pulsante per copiare indirizzo e testo. Interruttore "Allega info tecniche (versione app, iOS, modello)" spento di default. **Mai** credenziali o dati d'accesso (oggi il token, in fase 5 la sessione dell'account), dati dei piani, pesi, check-in o log degli errori nel messaggio. Fase 5: invio dal server senza esporre l'indirizzo (fuori da questo piano).

- [ ] **Step 1: Test:** backup → restore su uno store vuoto = stessi record (senza tombstone); file con `format` sbagliato → errore e store intatto; `ErrorLog` non conserva una stringa esadecimale di 64 caratteri. `FeedbackMessage`: oggetto con prefisso e tipo giusti (IT/EN), testo lungo troncato a 6 parole nell'oggetto; con `tech == nil` il corpo non contiene "Info tecniche"; il corpo non contiene mai la stringa del token di test anche se lo store ne ha uno (il builder non riceve né store né identità: verificalo con la firma); `mailtoURL` codifica correttamente spazi, accenti e a capo. **UI test:** tema sistema/chiaro/scuro (salva `settings.theme`), alimenti esclusi, frequenza spesa, obiettivo peso, Sincronizzazione (badge, ultimo sync, "Sincronizza ora", "Scollega" con conferma), esporta/ripristina con `fileExporter`/`fileImporter`, Diagnostica (copia/svuota), link "Lingua" alle impostazioni iOS dell'app, interruttori del Task 17 (disattivati con la spiegazione se la capacità manca), Feedback (avviso visibile, "Invia" disabilitato con testo vuoto; sul simulatore senza Mail compare il ripiego con "Copia").
- [ ] **Step 2:** FAIL → implementa → PASS.
- [ ] **Step 3:** commit `feat(app): impostazioni, backup, diagnostica`.

### Task 18B: Crea il tuo account nell'app (codice di attivazione monouso)

Richiesta di Lorenzo (2026-11-03): l'account lo crea nell'app completa, non nella PWA né dal Terminale.

**Files:** (repo `Fitness App`) `backend/src/worker.mjs`, `backend/src/auth.mjs`, `backend/migrations/0004_activation.sql` (+ `schema.sql`), `backend/admin/account.mjs` (sottocomando `invite`), `backend/test/auth.test.mjs`, `backend/README.md`, `backend/CONTRACT.md`; (repo app) `Packages/FitnessCore/.../Identity/AccountIdentityProvider.swift` (`activate(code:email:password:deviceName:)`), `Features/Account/CreateAccountView.swift`, `Features/Account/LoginView.swift` (link "Crea il tuo account"), `UITests/LoginTests.swift`, `Localizable.xcstrings`.

**Interfaces:** tabella `activation_codes(id TEXT PRIMARY KEY /* SHA-256 hex del codice */, owner TEXT, expires_at INTEGER, used_at INTEGER)`. `node backend/admin/account.mjs invite --owner <PRIMARY_OWNER> --remote` genera un codice di 10 caratteri leggibili (alfabeto senza 0/O/1/I), salva solo l'hash, scadenza 30 minuti, e lo stampa una volta. `POST /v1/auth/activate {code, email, password, deviceName}` → crea l'account per l'`owner` del codice se il codice è valido, non usato, non scaduto e non esiste già un account con quell'id; segna il codice come usato nello stesso batch; stesso hash/pepper, regole password e limite tentativi di `claim`; risponde `{ session, ownerId, email, expiresAt }`, altrimenti `401` (codice non valido o scaduto, stesso messaggio) o `409` (account già esistente). Nell'app, sotto "Accedi": "Prima volta? **Crea il tuo account**" → codice, email, password, conferma; al successo si entra subito.

- [ ] **Step 1: Test:** backend (codice valido una volta sola; scaduto, riusato o sbagliato → 401; account esistente → 409; due attivazioni concorrenti → un solo account; il codice in chiaro non è mai in D1) e app (UI test con codice generato dal server locale: crea → tab; codice sbagliato → messaggio).
- [ ] **Step 2:** FAIL → implementa → PASS (`cd backend && npm test`, `swift test`, `scripts/uitest.sh`).
- [ ] **Step 3:** commit in entrambi i repo; deploy del Worker (migrazione 0004 prima, bookmark Time Travel) prima del Task 19.

### Task 19: QA finale, installazione sull'iPhone, documentazione (controller, con Lorenzo)

**Files:** Modify (repo app) `README.md` (build, test, installazione, rinnovo ogni 7 giorni); (repo `Fitness App`) `CLAUDE.md` (sezione "App nativa (fase 3)": dove sta il repo, comandi, regole), memoria del progetto.

- [ ] **Step 1:** `swift test` + `scripts/uitest.sh` + `cd backend && npm test` + `npm test` + `npm run test:e2e` → tutto PASS (output nel ledger).
- [ ] **Step 2: QA su simulatore** iPhone 18 Pro, tema chiaro e scuro, con il server locale e il seed: un giro di tutte le schermate con screenshot. Scenario a due "device": l'app sul simulatore e la PWA in Playwright sullo stesso server locale; spunte e serie da una parte compaiono dall'altra. Vanno controllati anche vetro e leggibilità.
- [ ] **Step 3: Installazione sull'iPhone di Lorenzo e passaggio agli account** (`scripts/install-iphone.sh`, backend di produzione): il controller genera il codice di attivazione (`account.mjs invite --owner <PRIMARY_OWNER> --remote`) e lo dà a Lorenzo; Lorenzo crea l'account nell'app ("Crea il tuo account") e poi fa **Accedi** nella PWA. Verifica dal server (sola lettura, con una sessione ottenuta da Lorenzo o col token legacy finché esiste): arrivano record con `deviceId` `ios-…` e dalla PWA con la sessione. Prova incrociata: una spunta nell'app compare nella PWA e viceversa. Poi `LEGACY_TOKEN_ENABLED = "false"`, `wrangler deploy`, `wrangler secret delete SYNC_TOKEN` (con l'ok di Lorenzo, comando lanciato da lui se il classificatore lo blocca), cancellazione di `~/.config/fitness-hub/sync-token`.
- [ ] **Step 4:** spiega a Lorenzo il rinnovo dei 7 giorni (`scripts/install-iphone.sh` con l'iPhone sulla stessa rete o collegato al Mac) e proponigli un promemoria settimanale (non crearlo senza il suo sì).
- [ ] **Step 5:** documentazione + memoria; commit e push docs nel repo `Fitness App` (niente bump della cache PWA); commit nel repo app.

### Task 20 (dopo il collaudo, solo con il via di Lorenzo): Coach web in sola lettura

Spec §8: quando l'app iPhone è in uso, il Coach web mostra le chat sincronizzate e non chiama più Groq.

**Files (repo `Fitness App`):** `screens/coach.jsx` (sola lettura: elenco dei `coachChat_<data>` con un rimando all'app), `api.jsx` (via `groqAPI`), `index.html` (CSP senza `api.groq.com` e senza il proxy legacy), `i18n.jsx`, `test/run.mjs`, `test/e2e/run.mjs`.

- [ ] **Step 1:** test (`npm test`: nessun `groqAPI` nel bundle; e2e: il Coach mostra una chat seminata e nessun campo di input) → FAIL → implementa → PASS.
- [ ] **Step 2:** deploy PWA col flusso di CLAUDE.md. Ricorda a Lorenzo che può spegnere il Worker `fitness-hub-proxy` ed eliminare la chiave Groq (azioni sue).
