# Backend di sync — Fitness Hub

Worker Cloudflare `fitness-hub-api` + database D1 `fitness-hub-db`. Un solo utente, accesso con token personale.
Sincronizza i record dell'app (piani, serie, pesi, spunte, note, impostazioni...) con Last-Writer-Wins per record
e tombstone per le eliminazioni. Zero dipendenze runtime.

## Endpoint

- `GET /v1/health` → `{ ok: true, version: "1" }` (senza token)
- `POST /v1/sync` con `Authorization: Bearer <token>`
  - richiesta: `{ deviceId, cursor, changes: Change[] }` (al massimo 500 change, `data` al massimo 64 KB)
  - risposta: `{ cursor, more, changes: Record[], applied, stale }` (pull paginato da 500 per `seq`)
  - `Change`: `{ collection, id, data: object|null, updatedAt (ms), deleted? }`
  - `Record`: `{ collection, id, data, updatedAt, deleted, deviceId, seq }`

Collezioni ammesse: workoutPlan, dietPlan, dayState, setLog, workoutSession, mealCheck, supplementCheck,
bodyWeight, bodyMeasure, shoppingCheck, shoppingExtra, exerciseNote, personalRecord, coachMessage, settings.
CORS: `https://fara2106.github.io` e `localhost`/`127.0.0.1`; le richieste senza `Origin` (app native) sono ammesse.
Contratto completo e id deterministici: `.superpowers/sdd/2026-11-03-fase1-backend-sync/global-constraints.md` e piano fase 1
(`docs/superpowers/plans/2026-11-03-fase1-backend-sync.md`).

## Test

```bash
cd backend && npm test
```

(`node --test test/*.test.mjs`, Node 26, D1 simulato con `node:sqlite`.)

## Deploy

```bash
cd backend
npx wrangler d1 create fitness-hub-db            # copia database_id in wrangler.toml
npx wrangler d1 execute fitness-hub-db --remote --file=schema.sql
npx wrangler secret put SYNC_TOKEN               # incolla il contenuto di ~/.config/fitness-hub/sync-token
npx wrangler deploy
```

## Token

Vive in `~/.config/fitness-hub/sync-token` (permessi 600) e come secret `SYNC_TOKEN` del Worker. Mai nel repo (è pubblico).
Per ruotarlo:

```bash
umask 077 && openssl rand -hex 32 > ~/.config/fitness-hub/sync-token
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
La verifica confronta con i soli record vivi della migrazione: pensata per un DB appena migrato.

## Backup del database

D1 Time Travel (ripristino a un istante recente):

```bash
npx wrangler d1 time-travel info fitness-hub-db
npx wrangler d1 time-travel restore fitness-hub-db --timestamp=<ISO8601>
```
