# Backend di sync — Fitness Hub

Worker Cloudflare `fitness-hub-api` + database D1 `fitness-hub-db`. Accesso con account (email + password → sessione;
vedi "Account e sessioni"); il vecchio token personale `SYNC_TOKEN` vale solo durante il passaggio.
Sincronizza i record dell'app (piani, serie, pesi, spunte, note, impostazioni...) con Last-Writer-Wins per record
e tombstone per le eliminazioni. Zero dipendenze runtime.

## Endpoint

- `GET /v1/health` → `{ ok: true, version: "1" }` (senza token)
- `GET /v1/me` con `Authorization: Bearer <sessione>` → `{ ownerId, email, epoch }` (401 senza token o con token
  sbagliato, scaduto o revocato). Con `LEGACY_TOKEN_ENABLED = "true"` anche il token `SYNC_TOKEN` vale, per il
  proprietario `PRIMARY_OWNER` (variabile in `wrangler.toml`, un UUID: è un identificatore, non un segreto). Se in quel
  caso `PRIMARY_OWNER` manca, `/v1/me` e `/v1/sync` rispondono 500 "configurazione mancante" senza scrivere nulla.
- `POST /v1/auth/login | logout | password | register | apple | apple/link`: vedi "Account e sessioni" e `CONTRACT.md` (Accesso).
- `POST /v1/sync` con `Authorization: Bearer <sessione>`
  - richiesta: `{ deviceId, cursor, changes: Change[] }` (al massimo 500 change, `data` al massimo 64 KB)
  - risposta: `{ cursor, more, changes: Record[], applied, stale, conflicts: Record[], epoch, reset }`
    (pull paginato da 500 per `seq`)
    - `conflicts`: la versione corrente del server di ogni change risultato `stale` (senza doppioni; `[]` se nessuno)
    - `epoch`: identità del database (riga `epoch` di `meta`; `null` se lo schema non l'ha ancora)
    - `reset`: `true` quando il `cursor` inviato supera il `seq` del server (database azzerato o ripristinato):
      in quel caso il pull riparte da 0
  - `Change`: `{ collection, id, data: object|null, updatedAt (ms, intero > 0), deleted? }`
  - `Record`: `{ collection, id, data, updatedAt, deleted, deviceId, seq }`

Collezioni ammesse: workoutPlan, dietPlan, dayState, setLog, workoutSession, mealCheck, supplementCheck,
bodyWeight, bodyMeasure, shoppingCheck, shoppingExtra, exerciseNote, personalRecord, coachMessage, settings.
CORS: `https://fara2106.github.io` e `localhost`/`127.0.0.1`; le richieste senza `Origin` (app native) sono ammesse.
Contratto completo e id deterministici: `.superpowers/sdd/2026-11-03-fase1-backend-sync/global-constraints.md` e piano fase 1
(`docs/superpowers/plans/2026-11-03-fase1-backend-sync.md`).

## Proprietario dei record (preparazione fase 5)

Ogni riga di `records` ha un `owner` e la chiave primaria è `(owner, collection, id)`: lo stesso `collection/id` di
due proprietari sono due record distinti, e pull, `conflicts` e LWW lavorano sempre dentro un solo proprietario.
`meta` (`seq`, `epoch`) resta globale. `resolveOwner(request, env)` in `src/worker.mjs` è l'unico punto che decide di
chi è la richiesta (oggi: confronto a tempo costante con `SYNC_TOKEN` → `PRIMARY_OWNER`; in fase 5 una tabella account).
I client non vedono nulla di diverso: il contratto dei record è invariato.

### Migrazione `0002_owner.sql` (DB con lo schema vecchio)

`schema.sql` crea lo schema nuovo sui DB vergini; un DB esistente si porta avanti con `migrations/0002_owner.sql`, che
ricostruisce `records` con la colonna `owner` mantenendo `seq` e `meta` (quindi i cursori dei client restano validi).
Il file contiene il segnaposto `__PRIMARY_OWNER__`, da sostituire con `sed` al lancio (D1 esegue il file come un unico
lotto transazionale: niente `BEGIN`/`COMMIT`; su un DB già migrato il lotto fallisce e non cambia nulla). Prima annotare
il bookmark di Time Travel:

```bash
cd backend
npx wrangler d1 time-travel info fitness-hub-db      # annota il bookmark
OWNER=$(grep '^PRIMARY_OWNER' wrangler.toml | sed -E 's/.*"([^"]+)".*/\1/')
sed "s/__PRIMARY_OWNER__/$OWNER/g" migrations/0002_owner.sql > /tmp/0002_owner.sql
npx wrangler d1 execute fitness-hub-db --remote --file=/tmp/0002_owner.sql
npx wrangler deploy                                  # il nuovo Worker richiede lo schema migrato (e viceversa)
rm /tmp/0002_owner.sql
```

Se qualcosa non torna: `time-travel restore` al bookmark, ridistribuire la versione precedente del Worker e cambiare
l'epoch (vedi "Backup del database").

## Account e sessioni (Task 9A)

Tabelle (`migrations/0003_accounts.sql`, incluse anche in `schema.sql`):

- `accounts(id = ownerId, email UNIQUE NOCASE, pw_hash, pw_salt, pw_iter, pw_ver, apple_sub UNIQUE, created_at, disabled)`.
  Password (`pw_ver = 1`): `pw_hash = HMAC-SHA256(PEPPER, PBKDF2-SHA256(password, salt, 25.000))` con WebCrypto, salt
  casuale da 16 byte, confronto a tempo costante, minimo 10 caratteri. 25.000 iterazioni stanno nei 10 ms di CPU del
  piano Workers gratuito (~3 ms per verifica); il **pepper** (secret `PASSWORD_PEPPER`, ≥ 32 byte hex, mai nel DB né nel
  repo) fa sì che un dump del DB da solo non basti per provare password offline. Senza pepper le rotte con password
  rispondono 500 "configurazione mancante" (mai un hash senza). `pw_ver`/`pw_iter` sono per riga: un login riuscito
  con valori diversi da quelli attuali rifà l'hash (`rehashIfNeeded`); per uno schema nuovo si aggiunge un `pw_ver`.
- `sessions(id = SHA-256 hex del token, account_id, device_name, created_at, last_used_at, expires_at, revoked)`.
  Il token (32 byte casuali, base64url) si restituisce una volta sola e non si salva mai in chiaro. Scadenza scorrevole
  180 giorni, aggiornata al massimo una volta all'ora per sessione.
- `login_attempts(key, at)`: ogni tentativo (login, cambio password, Apple, registrazione) si **addebita prima di
  verificare**, in un unico lotto atomico (pota le righe oltre 15 minuti, inserisce `email:<minuscola>` e
  `ip:<CF-Connecting-IP>`, conta): oltre **20 per email** o **5 per IP** in 15 minuti → `429` senza verificare nulla
  (e la riga appena inserita si toglie, così martellare non allunga il blocco). Le richieste concorrenti sono
  serializzate dal lotto: non aggirano il limite. Il successo cancella le righe di quell'email e di quell'IP.
- Un `5xx` (o l'errore Cloudflare 1102 "CPU superata") su `/v1/auth/*` vuol dire **"riprova"**, non "password
  sbagliata": la password sbagliata è sempre e solo `401 credenziali non valide`.

Secret: `PASSWORD_PEPPER` (vedi sotto, `init-pepper`) e, durante il passaggio, `SYNC_TOKEN`.
Variabili (`[vars]` di `wrangler.toml`): `LEGACY_TOKEN_ENABLED` (`"true"` durante il passaggio: `SYNC_TOKEN` →
`PRIMARY_OWNER`), `REGISTRATION_OPEN` (`"false"`: `/v1/auth/register` → 403), `APPLE_SIGNIN_ENABLED` (`"false"`:
`/v1/auth/apple*` → 404), `APPLE_BUNDLE_ID` (`aud` atteso nel JWT di Apple). Con Apple acceso il Worker scarica le
chiavi da `https://appleid.apple.com/auth/keys` (in cache 1 ora; un `kid` sconosciuto forza un nuovo download al massimo
una volta al minuto) e verifica RS256, `iss`, `aud`, `exp`, `iat`, `sub` e `nonce` = SHA-256 del nonce inviato.

### CLI `admin/account.mjs`

La password si digita **nel terminale, senza eco** (due volte per `create`/`reset-password`, devono coincidere, almeno
10 caratteri; Tab, Esc/frecce e altri caratteri di controllo sono rifiutati con un messaggio). Non si accetta come
argomento (`--password` → errore) né da variabili d'ambiente, e con uno stdin che non è un terminale la CLI si rifiuta.
L'hash si calcola sul Mac col pepper letto da `~/.config/fitness-hub/pepper` (permessi 600 obbligatori, altrimenti
rifiuta; `--pepper-file` per un altro file). Non stampa mai password, pepper, hash o SQL.

```bash
node backend/admin/account.mjs init-pepper                              # crea il pepper (se manca) e dice come caricarlo
node backend/admin/account.mjs create         --email <e> --owner <PRIMARY_OWNER> --remote
node backend/admin/account.mjs reset-password --email <e> --remote      # revoca anche tutte le sessioni
node backend/admin/account.mjs sessions       --email <e> --remote      # elenco (id abbreviato a 8 caratteri)
node backend/admin/account.mjs revoke         --email <e> [--session <prefisso>] --remote
node backend/admin/account.mjs login          --email <e> --api https://fitness-hub-api.lorefara97.workers.dev
```

`--remote` usa `npx wrangler d1 execute fitness-hub-db --remote --json --yes` (dalla cartella `backend/`, senza shell):
gli statement con hash e salt passano come `--file` (file 600 in una cartella temporanea 700, cancellata subito dopo),
mai negli argomenti; le sole letture e revoche senza segreti usano `--command`. `--local <file.sqlite>` lavora su un DB
locale (test e sviluppo).
`login` chiede la password, chiama `POST /v1/auth/login` e salva la sessione in `~/.config/fitness-hub/session`
(permessi 600; `--out` per un altro file): serve agli strumenti di sola lettura dal Mac.

### Messa in produzione (ordine obbligato) e migrazione `0003_accounts.sql`

La migrazione aggiunge solo tabelle e indici (`IF NOT EXISTS`, idempotente): `records` e `meta` non cambiano.
Il pepper deve esistere nel Worker PRIMA del deploy (senza, login → 500) e sul Mac PRIMA di creare l'account.

```bash
cd backend
node admin/account.mjs init-pepper                     # 1. ~/.config/fitness-hub/pepper (600), mai stampato
npx wrangler secret put PASSWORD_PEPPER < ~/.config/fitness-hub/pepper   # 2. secret del Worker (da file, niente eco)
npx wrangler d1 time-travel info fitness-hub-db        # 3. annota il bookmark
npx wrangler d1 execute fitness-hub-db --remote --file=migrations/0003_accounts.sql   # 4.
npx wrangler deploy                                    # 5. LEGACY_TOKEN_ENABLED = "true": la PWA col token continua
```

Il pepper non si cambia: cambiarlo invalida tutte le password (servirebbe `reset-password`). Se si perde il file sul Mac
ma il secret è nel Worker, il login continua a funzionare; per creare o resettare account serve di nuovo lo stesso valore.

## Server locale per i test (`dev/local-server.mjs`)

Il Worker vero con D1 su `node:sqlite` (riusa `test/d1-sqlite.mjs`), su `http://127.0.0.1` soltanto. Lo usano i test
d'integrazione e gli UI test dell'app Swift, mai il backend di produzione.

```bash
node backend/dev/local-server.mjs --port 8787 [--token <token-di-test>] [--account <email>:<password>] \
  [--db <file>] [--seed <records.json>] [--owner <id>]
```

`--token` accende il token legacy (`LEGACY_TOKEN_ENABLED`) verso `--owner`. Il pepper è uno fisso e pubblico di test
(`--pepper-file` per sceglierne un altro). `--account` crea all'avvio un **account di
test** con id = `--owner` (se non esiste già nel `--db`): la password sta sulla riga di comando, quindi **solo per test
locali, mai con credenziali vere né contro la produzione**. Serve almeno uno dei due.

`--port 0` sceglie una porta libera; `--db` persiste su file (default in memoria); `--seed` è un array JSON di `Change`
applicati all'avvio come device `seed` (passano dal Worker, quindi stessa validazione e stesso LWW); `--owner` cambia il
proprietario (default `local-owner`). Stampa `ready http://127.0.0.1:<porta>` appena è in ascolto e non stampa mai il token.

## Contratto per i client (fase 2 PWA, fase 3 app)

- `updatedAt` di ogni modifica = `max(Date.now(), updatedAt locale del record + 1)`: sempre crescente anche con
  l'orologio del dispositivo indietro.
- Dopo ogni sync adottare i record dell'echo (`changes`) e quelli di `conflicts` (la modifica locale ha perso: vince
  la versione del server).
- Nuovo cursore = `cursor` della risposta; con `more: true` richiamare subito.
- `reset: true` oppure `epoch` diverso da quello salvato → cursore 0 e ripull completo (salvare il nuovo `epoch`).
- Lotti di al massimo 500 change e 1,5 MB di JSON per richiesta (il Worker rifiuta oltre 2 MB).
- Eliminazione = tombstone: `deleted: true, data: null` (mai cancellazioni fisiche).

## Test

```bash
cd backend && npm test
```

(`node --test test/*.test.mjs`, Node 26, D1 simulato con `node:sqlite`.)

## Deploy

```bash
cd backend
npx wrangler d1 create fitness-hub-db            # copia database_id in wrangler.toml
npx wrangler d1 execute fitness-hub-db --remote --file=schema.sql   # idempotente: rilanciarlo aggiunge l'epoch a un DB esistente
npx wrangler secret put SYNC_TOKEN               # incolla il contenuto di ~/.config/fitness-hub/sync-token
npx wrangler deploy
```

## Token

Vive in `~/.config/fitness-hub/sync-token` (permessi 600) e come secret `SYNC_TOKEN` del Worker. Mai nel repo (è pubblico).
Per ruotarlo:

```bash
mkdir -p ~/.config/fitness-hub && (umask 077; openssl rand -hex 32 > ~/.config/fitness-hub/sync-token)
cd backend && npx wrangler secret put SYNC_TOKEN   # incolla il nuovo valore
```

poi aggiorna il token su tutti i client.

## Migrazione dei dati esistenti

Legge il foglio Google tramite il Worker legacy (solo GET, non lo modifica) e, se dato, un backup JSON della PWA
(Impostazioni → Backup). I piani vengono da `schedaData`/`dietaData` del foglio, altrimenti da `scheda.txt`/`dieta.txt` del repo.

```bash
cd backend
# 1. dry-run: stampa i conteggi, non scrive nulla
node migrate/migrate.mjs --backup ~/Downloads/backup.json
# 2. push (idempotente, si può rilanciare lo stesso giorno: tutto stale)
node migrate/migrate.mjs --api https://fitness-hub-api.<account>.workers.dev \
  --token-file ~/.config/fitness-hub/sync-token --backup ~/Downloads/backup.json --push
# 3. verifica: pull completo e confronto dei conteggi (exit code 1 se differiscono)
node migrate/migrate.mjs --api https://... --token-file ~/.config/fitness-hub/sync-token --backup ~/Downloads/backup.json --verify
```

`--push --verify` si possono combinare. Il token non viene mai stampato. `--sheet <url>` cambia l'URL del Worker legacy.
Il push va a lotti di al massimo 500 change e 1,5 MB. La verifica scarica tutto dal cursore 0 e controlla, per ogni record
atteso, che esista con lo stesso `data` (ne stampa al massimo 20 diversi) oltre ai conteggi per collezione: pensata per
un DB appena migrato. Il dry-run avvisa se il foglio ha esattamente il numero massimo di righe che il Worker legacy
restituisce (check-in 30, peso 90, serie 12 per esercizio): lo storico più vecchio potrebbe mancare.

### Cutover della fase 2: azzerare e rimigrare

**Fatto il 2026-11-03 alle 16:3x** (backup iPhone delle 16:35 → 9 record, verify OK; PWA deployata subito dopo, iPhone collegato). La sezione resta come procedura per un eventuale nuovo azzeramento.

La migrazione di oggi è reale, ma al passaggio della PWA al nuovo backend (fase 2) D1 si azzera e si rimigra dai dati
aggiornati. Rilanciare la CLI su un D1 già popolato NON è un recupero dei dati nuovi: gli stessi record con lo stesso
`updatedAt` risultano `stale`. Prima di rimigrare:

```bash
npx wrangler d1 execute fitness-hub-db --remote --command "DELETE FROM records; UPDATE meta SET value = 0 WHERE key = 'seq'; UPDATE meta SET value = abs(random() % 9007199254740991) WHERE key = 'epoch'"
```

Il nuovo `epoch` fa ripartire da zero i client che avevano già sincronizzato.

## Backup del database

D1 Time Travel (ripristino a un istante recente):

```bash
npx wrangler d1 time-travel info fitness-hub-db
npx wrangler d1 time-travel restore fitness-hub-db --timestamp=<ISO8601>
```

Dopo un restore cambiare SEMPRE l'epoch, così i client riscaricano tutto invece di tenere un cursore che non vale più:

```bash
npx wrangler d1 execute fitness-hub-db --remote --command "UPDATE meta SET value = abs(random() % 9007199254740991) WHERE key = 'epoch'"
```
