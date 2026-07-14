# Spec — Acqua + calorie bruciate da Apple Salute (sola lettura)

**Data:** 2026-07-14 · **Autore:** Lorenzo + Claude · **Stato:** approvata (design), pronta per il piano

## 1. Obiettivo

Mostrare nell'app due dati provenienti da **Apple Salute**, in **sola lettura**:
- **Acqua** bevuta oggi (Lorenzo la logga già in Salute).
- **Calorie bruciate** oggi (energia attiva da Apple Watch).

Direzione **unica**: Salute → app. Niente scrittura app → Salute.

## 2. Vincolo tecnico (perché serve uno Shortcut)

Una PWA **non può accedere a HealthKit** (nessuna API web). L'unico modo di portare dati da Salute all'app è un **Apple Shortcut** sull'iPhone di Lorenzo che legge Salute e fa un POST a un backend che l'app legge. Lo Shortcut lo costruisce Lorenzo (solo lui ha l'accesso a Salute); il resto lo fa/deploya l'agent.

```
Apple Salute → Shortcut (iPhone, periodico) → POST /healthdata (push-worker + KV) → GET /healthdata → app (Dashboard)
```

Conseguenza accettata: l'aggiornamento **non è istantaneo** (dipende dalla frequenza dell'automazione, es. ogni ora).

## 3. Architettura

Si riusa il **push-worker Cloudflare** esistente (`fitness-hub-push.lorefara97.workers.dev`), che ha già KV e viene deployato dall'agent.

### 3.1 Endpoint (nuovi, sul push-worker)
- `POST /healthdata` — body `{ date:"YYYY-MM-DD", waterMl:number, kcal:number, token:string }`.
  - Valida `token === env.HEALTH_TOKEN` (segreto condiviso; altrimenti 401). Evita scritture random sull'endpoint pubblico.
  - Salva in KV chiave `healthdata` = `{ date, waterMl, kcal, updatedAt: Date.now() }` (upsert, ultimo vince).
  - Risposta `{ ok:true }`.
- `GET /healthdata` — ritorna `{ date, waterMl, kcal, updatedAt }` (o `{}` se assente). CORS aperto come gli altri.

### 3.2 KV
Chiave singola `healthdata` (utente singolo): `{ date, waterMl, kcal, updatedAt }`.

### 3.3 Sicurezza
`HEALTH_TOKEN` come **secret** del worker (`wrangler secret put HEALTH_TOKEN`), generato dall'agent e passato a Lorenzo per lo Shortcut. Il GET è pubblico (dati non sensibili, sola lettura).

## 4. App (Dashboard) — modifiche

### 4.1 Lettura dati
`app.jsx` fetch `GET /healthdata` all'avvio e nel giro di sync periodico (già esistente, ~45s + su visibilitychange). Nuovo stato `healthData = { date, waterMl, kcal, updatedAt }` passato come prop a Dashboard (e l'acqua al Coach). Se il fetch fallisce → `healthData` resta l'ultimo noto / null (nessun crash, badge "non aggiornato").

### 4.2 Card idratazione (`HydrationCard`, dashboard.jsx) — diventa SOLA LETTURA
- **Rimuovere i 12 bottoni-bicchiere e `setHydration`** (niente più +/- manuale per l'acqua).
- Mostrare l'acqua da Salute: `waterMl` → litri (es. "1.6 L"), barra di avanzamento verso un **target 3 L**, e riga "agg. HH:MM" da `updatedAt`.
- Se `healthData.date !== oggi` o dato assente → stato gentile ("Nessun dato da Salute oggi — apri lo Shortcut"), niente numero fasullo.

### 4.3 Calorie bruciate — nuovo readout
- Nuovo elemento compatto sulla Dashboard (stat tile o riga nella card Movimento) con `kcal` di oggi + "agg. HH:MM". Stessa regola staleness (mostra solo se `date === oggi`).

### 4.4 Coach
`_buildSystemPrompt` (coach.jsx) oggi usa `hydration` (bicchieri 0–12). Alimentarlo invece con l'**acqua reale in litri** da `healthData.waterMl` (riga tipo "Idratazione: 1.6 L su 3L target"). Se manca il dato, omettere la riga.

### 4.5 Stato `hydration` legacy
Il vecchio `hydration` (intero 0–12, `hydration_<date>`) non serve più per l'acqua. Rimuoverne l'uso in Dashboard e Coach; lo stato/scrittura per-giorno può essere dismesso (decisione minima nel piano: rimuovere vs lasciare inerte). Non introdurre regressioni nel cleanup dei per-day key.

## 5. Shortcut (lo costruisce Lorenzo)

Passi (nomi azioni indicativi, iOS Comandi Rapidi — adattare alla versione):
1. Nuovo comando **"Sync Salute → Fitness Hub"**.
2. **Acqua**: *Trova campioni di salute* → Tipo = **Acqua**, intervallo = **Oggi** → *Calcola statistiche* = **Somma** → converti in **mL** (variabile `waterMl`).
3. **Calorie**: *Trova campioni di salute* → Tipo = **Energia attiva**, intervallo = **Oggi** → *Calcola statistiche* = **Somma** (kcal) (variabile `kcal`).
4. *Data* corrente formattata `YYYY-MM-DD` (variabile `date`).
5. *Ottieni contenuto di URL*: **POST** a `https://fitness-hub-push.lorefara97.workers.dev/healthdata`, header `Content-Type: application/json`, body JSON: `{ "date": <date>, "waterMl": <waterMl>, "kcal": <kcal>, "token": "<HEALTH_TOKEN>" }`.
6. **Automazione**: Comandi Rapidi → Automazione → *Ora del giorno* (es. ogni ora, o alle X) → esegui il comando; **"Chiedi prima di eseguire" OFF** per l'esecuzione silenziosa. (Facoltativo: anche un tap manuale dall'icona del comando.)

Verifica: dopo un run, `GET /healthdata` deve tornare i valori di oggi; l'app li mostra al refresh.

## 6. Divisione lavoro

**Agent:** endpoint `POST/GET /healthdata` + KV + validazione token sul push-worker; generare `HEALTH_TOKEN` + `wrangler secret put` + deploy worker; modifiche Dashboard (idratazione read-only, calorie, lettura da worker) + Coach; deploy Pages.
**Lorenzo:** costruire lo Shortcut + impostare l'automazione + incollare `HEALTH_TOKEN`; QA (loggare acqua in Salute, far girare lo Shortcut, vedere i valori in app).

## 7. Scope

**Dentro v1:** acqua + calorie bruciate di **oggi**, sola lettura, display su Dashboard, Coach alimentato dall'acqua reale.
**Fuori v1 (YAGNI):** direzione app→Salute, storico/grafici, passi, frequenza cardiaca, peso da Salute, sync di ieri/settimana, notifiche su questi dati.

## 8. Error handling / edge

- Fetch `/healthdata` fallito o offline → mostra ultimo noto o "non aggiornato", nessun crash.
- `date !== oggi` → non mostrare numeri vecchi come fossero di oggi.
- Token errato sul POST → 401 (lo Shortcut fallisce lato Lorenzo, dato non aggiornato — visibile dal "agg." fermo).
- Unità: acqua salvata in **mL** (intero), mostrata in L; calorie in **kcal** (intero).

## 9. Validazione

- Worker: `node --check`; test `curl -X POST .../healthdata` con token → poi `GET /healthdata`.
- Client: Babel transform di `dashboard.jsx`, `app.jsx`, `coach.jsx`; chiavi i18n nuove (IT+EN) presenti; `<Icon>` esistenti.
- QA on-device: Shortcut → valori in Dashboard + "agg." aggiornato; Coach cita l'acqua reale.
