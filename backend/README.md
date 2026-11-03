# Backend di sync — Fitness Hub

Worker Cloudflare `fitness-hub-api` + database D1 `fitness-hub-db`. Un solo utente, accesso con token personale.
Sincronizza i record dell'app (piani, serie, pesi, spunte, note, impostazioni...) con Last-Writer-Wins per record
e tombstone per le eliminazioni. Zero dipendenze runtime.

## Endpoint

- `GET /v1/health` → `{ ok: true, version: "1" }` (senza token)
- `POST /v1/sync` con `Authorization: Bearer <token>`
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
