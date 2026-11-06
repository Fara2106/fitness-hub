# Contratto dei record — fitness-hub-api

Formato dei `data` di ogni collezione: è il contratto fra backend, PWA (fase 2) e app Swift (fase 3).
Protocollo di sync (push/pull, cursore, `conflicts`, `epoch`/`reset`, regola di `updatedAt`): vedi `README.md`.

## Regole generali

- Date: stringhe `YYYY-MM-DD` (data locale). `updatedAt`: ms epoch, intero.
- Un record = `{ collection, id, data, updatedAt, deleted, deviceId, seq }`. Eliminazione = tombstone (`deleted: true`, `data: null`).
- Conflitti: last-writer-wins **per record** → i dati che due device possono toccare insieme stanno in record separati (una serie, una spunta, un giorno).
- Id deterministici: rifare la stessa operazione (retry, migrazione ripetuta) non crea duplicati.

## Piani

`workoutPlan` (id es. `workout-2026-11`):
```
{ name, status: "active"|"archived"|"draft", validFrom, validTo|null,
  days: [{ id, name, focus: string[],
           exercises: [{ id, name, sets: number, reps: string, restSec: number, notes,
                         muscles: string[], alternatives: string[] }] }] }
```

`dietPlan` (id es. `diet-2026-11`):
```
{ name, status, validFrom, validTo|null,
  variants: [{ id, key, name, training: { time: "HH:MM" }|null,
               meals: [{ id, name, time: "HH:MM",
                         options: [{ id, text }],                 // "scegli 1"
                         lines: [{ id, label|null, choices: string[] }],  // componenti sempre presenti
                         note?: string|null }],                   // opzionale
               supplements: [{ id, key, name, moment, time: "HH:MM" }] }],
  shopping?: [{ id, title, color, icon?, items: [{ id, name, qty1, qty2, note|null }] }] }   // opzionale
```

`dietPlan.variants[].dayKind` (opzionale, dal 2026-11-06): `"any"` = variante valida in qualsiasi giorno (nell'app «Qualsiasi giorno»), sempre con `training: null`. Assente = come prima: `training` presente è giorno di allenamento, `null` è riposo. Se c'è anche `training`, vince `training`. La PWA legge il campo con la stessa regola dell'app (`PlanConv.pickDietVariant`) e non riscrive i piani. Con almeno una `key` fuori da `riposo|mattina|ore17|ore21|ore22` mostra un selettore con tutte le varianti del piano e non usa mai `_FALLBACK`.

Alimenti = **testo libero**: `options[].text` e `lines[].choices[]` sono stringhe (`"80g riso basmati"`); l'editor dell'app aiuta con quantità + alimento ma salva testo.

`status`: `active` = piano in uso (uno solo per tipo, `validFrom` più recente), `archived` = storico, `draft` = bozza dell'editor ("nuovo piano dal precedente"). La PWA (`activePlan`) ignora già tutto ciò che non è `active`, quindi una bozza non cambia nulla finché non viene attivata. Attivare = bozza `active` con `validFrom` = oggi + piano precedente `archived` con `validTo` = oggi, nello stesso lotto.

`meal.note`: testo libero del pasto (le righe "Note:" della dieta originale). Opzionale: la PWA lo ignora, il converter `.txt` non lo scrive.

`shopping` (lista della spesa del piano): opzionale. `qty1` = quantità per 1 spesa a settimana, `qty2` = per ciascuna di 2 spese. Gli item migrati dalla lista scritta nel codice della PWA (`CATEGORIES` in `screens/spesa.jsx`) tengono la chiave di oggi, `${cat.id}-${indice}` (`proteine-4`…), così le spunte `shoppingCheck` esistenti restano valide; "nuovo dal precedente" copia la lista con gli **stessi id degli item**. `icon` (opzionale) è il nome dell'icona della PWA (`flame`, `bolt`, `leaf`, `scale`, `pill`, `spark`); se manca la PWA usa `spark`. La PWA legge `shopping` dal piano attivo (`plan_diet`) e ricade sulla lista nel codice solo se la chiave manca (un array vuoto = lista vuota); la chiave di spunta è l'`id` dell'item. Un import `.txt` della dieta nella PWA copia `shopping` dal piano attivo nel nuovo. `backend/migrate/add-shopping.mjs` aggiunge la lista migrata al piano attivo (dry-run di default).
`key` della variante: `riposo|mattina|ore17|ore21|ore22` per quelle migrate. `key` dell'integratore: chiave di spunta stabile (`vitac`, `ps`, `custom-<nome>`…). Gli integratori esistono solo se la dieta li prevede. Gli id interni dei piani migrati sono percorsi (`<planId>/d0/e2`, `<planId>/v1/m3/o0`, `<planId>/v0/s4`); quelli creati dall'editor possono essere UUID.

Il client Swift conserva le chiavi che non conosce (round-trip): aggiungere campi opzionali è sicuro. Vale per ogni oggetto dei `data` (piano, giorno, esercizio, variante, pasto, categoria della spesa…, e i log): chi rilegge e risalva un record non cancella i campi aggiunti da un altro client o da una versione successiva del contratto (test: `UnknownKeysTests` in FitnessCore).

## Log giornalieri

| Collezione | id | data |
|---|---|---|
| `dayState` | `${date}:${field}` con `field` = `checkIn`\|`hydration`\|`caffeine`\|`notes`\|`rest`\|`dietVariant`; cardio: `${date}:cardio:${activityId}` | `{ date, field, value }` — un record per campo del giorno (LWW per campo: un check-in su un device e il cardio su un altro nello stesso giorno non si cancellano). `value`: `checkIn` → `{ sleep, energy, ailments }`, `hydration` → numero, `notes` → stringa, `rest` → `true`, `dietVariant` → key della variante dieta del giorno, `cardio` → `{ id, type, min, km, note }` (un record per attività). Campo tolto → tombstone di quel record; campo mai impostato → nessun record |
| `setLog` | `${date}:${exerciseId}:${setIndex}` (setIndex da 0) | `{ date, exerciseId, exerciseName, planId\|null, setIndex, weight: string, reps: number\|null, done, substitutedWith: string\|null }` — `exerciseName`/`planId` conservano il contesto anche se il piano cambia o viene eliminato; `exerciseId` = `name:<nome minuscolo>` se l'esercizio non è nel piano |
| `workoutSession` | `${date}:${dayId}` | `{ date, dayId, dayName, startedAt: ms\|null, done }` |
| `mealCheck` | `${date}:${mealId}` | `{ date, mealId, done }` |
| `supplementCheck` | `${date}:${supplementId}` | `{ date, supplementId, done }` |

## Misure e varie

| Collezione | id | data |
|---|---|---|
| `bodyWeight` | data | `{ date, kg: number }` |
| `bodyMeasure` | data | `{ date, …misure in cm }` |
| `shoppingCheck` | chiave articolo | `{ checked: boolean }` |
| `shoppingExtra` | id articolo | l'articolo extra (`{ id, name, … }`) |
| `exerciseNote` | nome esercizio minuscolo | `{ exerciseName, text }` |
| `personalRecord` | nome esercizio minuscolo | `{ exerciseName, … }` |
| `coachMessage` | `${date}:${index}` | `{ date, index, role, text }` |
| `customExercise` | UUID | `{ name, muscles: string[], levels: { zona: "principale"\|"secondario" }, equipment: string\|null, notes, hasImage: boolean }` — esercizio creato dall'app iOS, tombstone alla cancellazione; la PWA lo ignora |
| `settings` | chiave | `{ value }` — chiavi: `excludedFoods` (string[]), `spesaFreq`, `weightGoal`, `bodyWeight` (peso profilo), `lang`, `theme` |

## Forme osservate nelle fixture della PWA

Le fixture di parità (`node dev/gen-swift-fixtures.mjs <outDir>`: record prodotti da `PlanConv` e `RecordMap`, cioè da quello che la PWA scrive davvero) fanno fede dove questo documento è generico. Precisazioni:

- `dayState` `waterEntry`/`caffeineEntry`: id `${date}:<field>:<uuid>`, `value` `{ id, amount, at }`, una voce dello storico dell'app (ml o mg, `at` in ms). Il totale del giorno resta in `hydration` (bicchieri da 250 ml) e `caffeine` (mg). La PWA le ignora.
- `dayState` `cardio`: `value.id` è un **numero** (timestamp in ms di creazione dell'attività, intero sicuro); l'`id` del record è la sua forma in stringa (`${date}:cardio:1793275200000`). `value` = `{ id, type, min, km, note }` senza l'etichetta `when` della PWA. **Eccezione (app nativa, fase 3 Task 17): cardio importato da Salute/Apple Watch** → `value.id` = stringa `"hk-<uuid HealthKit in minuscolo>"`, id del record `${date}:cardio:hk-<uuid>` (stabile: reimportare non crea doppioni; un import eliminato resta tombstone e non si reimporta), `${date}` = giorno locale di inizio, `type` fra quelli della PWA (`camminata`, `ellittica`, `corsa`, `bike`, `hiit`), `min` intero, `km` a 2 decimali, `note: ""`, più il campo facoltativo `startedAt` (ms, inizio dell'allenamento). La PWA lo mostra in `activities` ma il suo gruppo `cardio:<data>` prende solo id numerici, quindi non lo riscrive né lo tombstona (test in `test/run.mjs`). `rest` ha sempre `value: true` (campo tolto = tombstone, mai `false`); `hydration` è un numero; `checkIn` = `{ sleep, energy, ailments }` con sleep/energy interi 0-5 e `ailments` stringa.
- `shoppingExtra`: `data` = l'articolo come lo scrive la PWA, `{ id: number, name }` (id numerico = timestamp in ms, l'`id` del record ne è la stringa); l'app Swift scrive id stringa (UUID). Entrambe le forme sono valide, la chiave di spunta resta `extra-<id>`.
- `personalRecord`: `data` = `{ exerciseName, peso: number, date: string|null }`; l'`id` è il nome in minuscolo, ma `exerciseName` conserva le maiuscole di come l'esercizio è scritto nel piano.
- `bodyMeasure`: `{ date, <misura>: number … }`, chiavi libere in cm (`vita`, `petto`, `braccio`…).
- `setLog`: `reps` è `null` (la PWA non registra le ripetizioni fatte); `weight` è una stringa libera (`"82,5"`, `"rosso"` per l'elastico, `""`).
- `settings`: `{ value }` con `value` di qualunque tipo JSON (`excludedFoods` = array di stringhe, `spesaFreq`/`weightGoal`/`bodyWeight` = numeri, `lang`/`theme` = stringhe).
- `mealCheck` / `supplementCheck` / `shoppingCheck` / `setLog`: spunta tolta = `done: false` / `checked: false` (mai tombstone).
- `workoutSession`: scritto solo a sessione chiusa (`done: true`), `startedAt` ms o `null`.

## Accesso (dal Task 9A, fase 3)

Ogni richiesta a `/v1/sync` e `/v1/me` porta `Authorization: Bearer <sessione>`. La sessione si ottiene con email + password
e appartiene a un **account**: l'id dell'account È l'`ownerId` dei record (l'account di Lorenzo ha l'ownerId di oggi).

- `POST /v1/auth/login` `{ email, password, deviceName }` → `200 { session, ownerId, email, expiresAt }`.
  `401 { error: "credenziali non valide" }` per email inesistente, password sbagliata o account disattivato (stesso
  messaggio). `429` (con `Retry-After`) oltre 20 tentativi in 15 minuti per la stessa email o 5 per lo stesso IP
  (un login riuscito azzera entrambi). `400` input mancante. **`5xx` (o errore Cloudflare 1102) = "riprova più tardi"**:
  il client non deve mai mostrarlo come password sbagliata (solo `401` lo è).
- `session`: token opaco (32 byte casuali, base64url, 43 caratteri). Il server ne salva solo lo SHA-256. Scadenza
  **scorrevole di 180 giorni** dall'ultimo uso (`expiresAt` della risposta è solo indicativo). Il client lo tiene nel
  Keychain (app) o nello storage device-local (PWA), mai nei log, nei backup o nella diagnostica.
- `401` su `/v1/sync` o `/v1/me` = sessione scaduta, revocata o account disattivato → il client resta usabile in locale,
  tiene la coda e chiede di accedere di nuovo.
- `POST /v1/auth/logout` (Bearer) → `{ ok: true }`, revoca la sessione.
- `POST /v1/auth/password` (Bearer) `{ current, next }` → `{ ok: true }`; revoca tutte le ALTRE sessioni dell'account.
  `401` password attuale sbagliata, `400` nuova password sotto i 10 caratteri.
- `POST /v1/auth/claim` (Bearer = il vecchio `SYNC_TOKEN`) `{ email, password, deviceName }` → `200 { session, ownerId,
  email, expiresAt }`: crea l'account di `PRIMARY_OWNER` dalla PWA ancora collegata col token, **una volta sola**.
  `409` se l'account esiste già (anche un claim concorrente), `401` senza il token legacy giusto o con
  `LEGACY_TOKEN_ENABLED` spento, `400` email/password non valide (minimo 10 caratteri), `429` come il login.
- `POST /v1/auth/activate` (senza Bearer) `{ code, email, password, deviceName }` → `200 { session, ownerId, email,
  expiresAt }`: l'app nativa crea l'account del proprietario del **codice di attivazione monouso** (generato con
  `admin/account.mjs invite`, valido 30 minuti, una volta sola). `code`: 10 caratteri da
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, mostrato `XXXXX-XXXXX`, accettato con o senza trattino e senza distinzione di
  maiuscole (spazi ai lati ignorati). `401 { error: "codice non valido o scaduto" }` per codice sbagliato, scaduto o già
  usato (stesso messaggio); `409 { error: "account già esistente" }` se l'account di quell'owner (o quell'email) esiste
  già, e il codice resta valido; `400` codice mancante, email non valida o password sotto i 10 caratteri; `429` (con
  `Retry-After`) oltre 5 tentativi in 15 minuti per IP o per codice; `500` = riprova (mai "codice sbagliato").
- `POST /v1/auth/register` → `403` finché `REGISTRATION_OPEN` non è `"true"` (registrazione chiusa).
- `POST /v1/auth/apple` `{ identityToken, nonce, deviceName }` e `POST /v1/auth/apple/link` (Bearer) `{ identityToken, nonce }`:
  `404` finché `APPLE_SIGNIN_ENABLED` non è `"true"`. `nonce` = nonce grezzo del client; nella richiesta ad Apple il client
  mette il suo SHA-256 esadecimale minuscolo (il server confronta il claim `nonce` con SHA-256(nonce inviato)).
  Con la registrazione chiusa un Apple ID non collegato dà `401` (nessun account creato); `link` → `409` se l'Apple ID è
  già di un altro account.
- `GET /v1/me` → `{ ownerId, email, hasPassword, epoch }`.
- Durante il passaggio (`LEGACY_TOKEN_ENABLED = "true"`) il vecchio `SYNC_TOKEN` vale ancora per `PRIMARY_OWNER` su
  `/v1/sync`, `/v1/me` e `/v1/auth/claim` (non sulle altre `/v1/auth/*`). Poi si spegne (Task 9C).
- CORS come `/v1/sync`: la PWA (`https://fara2106.github.io`) può chiamare tutte le rotte `/v1/auth/*`.

## Decisioni

- Alimenti come testo libero: **decisione chiusa** (vedi `dietPlan`). Il piano resta sotto il limite di 64 KB per record (l'editor rifiuta un piano che codificato lo supera).
- Le righe "Note:" della dieta originale non sono migrate dal converter `.txt`, ma il pasto ha ora il campo opzionale `note`.
