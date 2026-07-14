# Spec — Notifiche push (promemoria pasti / integratori / allenamento)

**Data:** 2026-07-14 · **Autore:** Lorenzo + Claude · **Stato:** approvata (design), pronta per il piano

## 1. Obiettivo

Promemoria push **anche ad app chiusa** su iPhone (PWA installata sulla Home) per:
- **Pasti** — agli orari dei pasti del giorno
- **Integratori** — agli orari di assunzione
- **Allenamento** — nei giorni di palestra

Con orari **precompilati dai dati esistenti** (dieta/scheda), **modificabili** dall'utente, organizzati **per tipo di giornata** e con **recupero allenamento** (sposta al giorno prima/dopo in caso di imprevisto).

Utente singolo (Lorenzo), uno o più dispositivi.

## 2. Vincoli iOS (realtà da rispettare)

- Web Push su iOS funziona **solo per PWA installata sulla Home**, **iOS ≥ 16.4**. Da scheda Safari non arriva nulla.
- iOS **non** supporta la programmazione locale di notifiche a tempo (Notification Triggers è Chrome-only) → serve un **mittente remoto** che invia al momento giusto.
- Il permesso notifiche deve partire da un **gesto utente** (tap su un bottone).
- La subscription può cambiare/scadere → gestire `pushsubscriptionchange` e ri-subscribe.
- Consegna non garantita né istantanea (accettato dall'utente).

## 3. Architettura

Quattro pezzi. La "logica di piano" sta nel **client**; il Worker resta banale.

```
[PWA client]  --subscribe + config-->  [push-worker /save]  -->  [Cloudflare KV]
   |  permesso, pushManager.subscribe(VAPID pub)                        ^
   |  costruisce weekly + daytypes + overrides                          |
   v                                                          [push-worker CRON ogni minuto]
[sw.js: push -> showNotification]  <----- Web Push (VAPID) ------  legge KV, calcola ora Roma,
[sw.js: notificationclick -> apre app]                            manda i reminder dovuti
```

1. **Client (PWA)** — nuova sezione "Promemoria" in Impostazioni: permesso, subscribe, editor orari, invio config al Worker.
2. **`sw.js`** — handler `push` (mostra notifica) + `notificationclick` (apre/focalizza l'app).
3. **Chiavi VAPID** — pubblica nel client, privata come **secret** del Worker.
4. **push-worker** (Cloudflare Worker **dedicato e nuovo**, il proxy attuale resta invariato) — con **Cron Trigger** + **KV**, invia le push. Cifratura payload via **libreria web-push compatibile Workers** bundlata da wrangler (niente crypto a mano).

## 4. Modello dati

### 4.1 KV (una entry per utente, chiave singola es. `config`)
```json
{
  "subscriptions": [ { /* PushSubscription JSON: endpoint, keys{p256dh,auth} */ } ],
  "weekly": { "mon":"ore17", "tue":"riposo", "wed":"ore17", "thu":"riposo",
              "fri":"ore17", "sat":"riposo", "sun":"riposo" },
  "daytypes": {
    "riposo":  [ { "id":"colazione", "cat":"pasto", "label":"Colazione", "time":"08:00", "on":true }, ... ],
    "ore17":   [ ... ], "mattina":[ ... ], "ore21":[ ... ], "ore22":[ ... ]
  },
  "overrides": { "2026-07-16":"riposo", "2026-07-17":"ore17" },
  "tz": "Europe/Rome",
  "updatedAt": 1720000000000
}
```
- `cat` ∈ `pasto | integratore | allenamento` (per icona/testo notifica).
- `overrides`: eccezioni datate; **precedenza** su `weekly`. Date passate si potano (client alla scrittura, o Worker alla lettura).

### 4.2 Storage locale (IndexedDB via `window.storage`) — chiavi sincronizzabili
- `notifConfig` — stesso oggetto `{ weekly, daytypes, overrides }` (senza `subscriptions`, che sono per-device).
- `notifEnabled` — bool.
- `notifSub` — la PushSubscription di **questo** device (per confronto/ri-subscribe).
- (Nota: valutare in fase di piano se aggiungere `notifConfig` alle chiavi cloud-sync in `app.jsx`. La config è comunque già in KV, quindi la sync via Settings-sheet è opzionale/deferibile.)

### 4.3 Endpoint push-worker
- `POST /save` — body `{ subscription, config }` → upsert KV (aggiunge/aggiorna la subscription nell'array per endpoint; sostituisce weekly/daytypes/overrides). Risposta `{ ok:true }`.
- `POST /unsubscribe` — body `{ endpoint }` → rimuove quella subscription.
- `GET /health` — diagnostica.
- CORS aperto come il proxy attuale. **Solo POST/GET + OPTIONS.**
- (Nessuna auth forte v1: utente singolo, dati non sensibili. Valutare un token condiviso semplice in fase di piano.)

## 5. Flusso permessi / subscribe (client)

1. Utente apre Impostazioni → Promemoria → tap "**Attiva notifiche**".
2. Guardie oneste **prima** di chiedere il permesso:
   - `'serviceWorker' in navigator && 'PushManager' in window` → altrimenti "non supportato".
   - `window.navigator.standalone === true` (PWA installata) → altrimenti messaggio "Aggiungi prima l'app alla Home".
3. `Notification.requestPermission()` → se `granted`:
   - `reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC) })`.
   - Salva `notifSub` locale + `notifEnabled=true`.
   - `POST /save` con subscription + config corrente.
4. Se `denied` → stato "bloccate, riattiva da Impostazioni iOS".
5. Handler `pushsubscriptionchange` nel sw.js → ri-subscribe e `POST /save`.

## 6. `sw.js` — aggiunte (bump `CACHE_NAME` via deploy)

```js
self.addEventListener("push", (event) => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || "Lorenzo Fitness Hub";
  const body  = data.body  || "Promemoria";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: BASE + "/icon-192.png", badge: BASE + "/icon-192.png",
    tag: data.tag || "reminder", data: { url: BASE + "/", screen: data.screen || null },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || (BASE + "/");
  event.waitUntil(clients.matchAll({ type:"window", includeUncontrolled:true }).then((wins) => {
    for (const w of wins) { if (w.url.includes(BASE) && "focus" in w) return w.focus(); }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
```
Payload atteso dal Worker: `{ title, body, tag, screen }`.

## 7. push-worker — logica cron

- Cron: `* * * * *` (ogni minuto). Free tier ampiamente sufficiente.
- Ad ogni tick:
  1. Legge `config` da KV. Se assente o `subscriptions` vuoto → esce.
  2. Ora locale Roma via `Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome', weekday, hour, minute})` → `weekdayKey` (`mon`…`sun`), `HH:MM`. **DST gestito da Intl**, niente offset manuali.
  3. `daytype = overrides[YYYY-MM-DD] ?? weekly[weekdayKey]`.
  4. `reminders = daytypes[daytype]` → per ogni `r` con `r.on && r.time === HH:MM`: costruisce payload `{ title, body, tag:r.id }` (testo per `cat`) e invia web-push a **ogni** subscription.
  5. Su risposta `404/410` da un endpoint → rimuove quella subscription da KV (garbage collection).
  6. Pota `overrides` con data < oggi.
- Firma VAPID (ES256 JWT) + cifratura payload: **libreria web-push per Workers** (es. `webpush-webcrypto` o equivalente), bundlata con wrangler. Segreto: `VAPID_PRIVATE` + `VAPID_SUBJECT` (mailto) via `wrangler secret put`.

## 8. UI — Impostazioni → Promemoria

Nuova sezione (nuovo componente, es. `screens/promemoria.jsx` o dentro `impostazioni.jsx` — deciso in fase di piano). Contiene:

1. **Stato + interruttore master** "Attiva notifiche" con diagnostica iOS (supporto / installata / permesso).
2. **Baseline settimanale** — 7 righe Lun–Dom, ognuna con un selettore del **tipo di giornata** (riposo/mattina/ore17/ore21/ore22). Precompilata dallo schema noto (Lun/Mer/Ven → ore17, resto riposo).
3. **Editor per tipo di giornata** — per il tipo selezionato, la lista dei reminder (pasto/integratore/allenamento) con **orario editabile** (input time) e **toggle on/off**. Precompilati (§9).
4. **Sposta allenamento** — flusso rapido: scegli la data di allenamento da saltare → "sposta a giorno prima / giorno dopo" → scrive due `overrides` (origine→riposo, target→daytype allenamento). Lista degli override attivi con possibilità di annullarli.
5. Ogni modifica → salva `notifConfig` locale **e** `POST /save` al Worker (debounce).

## 9. Precompilazione orari (dai dati esistenti)

- **Pasti**: orari da `_MEAL_META` in `parser.jsx` per i pasti presenti nel tipo di giornata (colazione, spuntino, pranzo, merenda, cena, pre/post-WO).
- **Integratori**: da `sortTime` delle liste `_INTEGRATORI[daytype]` in `parser.jsx`.
- **Allenamento**: un reminder alla mattina del giorno di palestra (orario default configurabile, es. 30 min prima dello slot).
- La precompilazione genera i `daytypes` di default alla prima attivazione; l'utente poi edita. Se cambia la dieta importata, offrire un bottone "Rigenera orari da piano" (non sovrascrivere automaticamente le personalizzazioni).

## 10. VAPID / sicurezza

- Coppia VAPID generata una volta (comando fornito in fase di implementazione). **Pubblica** hardcoded nel client (`api.jsx` o config), **privata** solo come secret del Worker.
- Nessun dato sensibile nei payload (solo testo promemoria).
- Valutare un token condiviso minimale sugli endpoint `/save` `/unsubscribe` per evitare abusi (utente singolo → basso rischio).

## 11. Cosa costruisco io / cosa deployi tu

**Io (agent) — solo file locali:**
- `sw.js` — handler `push` + `notificationclick`.
- Client — sezione Promemoria (UI + logica permessi/subscribe + costruzione config + POST al Worker) + helper `urlB64ToUint8Array` + VAPID pubblica.
- `push-worker/` — nuovo Worker (codice + `wrangler.toml` con cron + binding KV + dipendenza web-push) + README di deploy.
- i18n IT/EN per le nuove stringhe. Validazione Babel di ogni `.jsx`.

**Tu (Lorenzo) — deploy/ops (gli agent non possono):**
1. Generare coppia VAPID (comando che ti do).
2. Creare il Worker `fitness-hub-push` + **KV namespace** + **Cron Trigger** (`wrangler` o dashboard).
3. `wrangler secret put VAPID_PRIVATE` + `VAPID_SUBJECT`; incollare la pubblica nel client.
4. Deploy del Worker; deploy delle Pages col tuo script.
5. Su iPhone: PWA installata sulla Home, aprire, Promemoria → Attiva → concedere il permesso. (SW sticky: chiudere e riaprire la PWA dopo il deploy.)

## 12. Scope

**Dentro v1:** categorie pasti/integratori/allenamento; baseline settimanale per tipo di giornata; editor orari; override "sposta allenamento"; multi-device (array subscription); notifica che al tap apre l'app.

**Fuori v1 (YAGNI):** snooze, storico notifiche, azioni nella notifica, testo AI personalizzato, promemoria idratazione periodici, sync della config via Settings-sheet (KV è già la fonte per il Worker).

## 13. Rischi e mitigazioni

- **Cifratura payload** (rischio tecnico #1) → libreria vetata per Workers, non crypto a mano.
- **Fragilità token iOS** → `pushsubscriptionchange` + GC su 404/410 + stato chiaro in UI.
- **Config stantìa se non apri l'app** → modello evergreen (weekly baseline nel KV, non finestra datata) → funziona a prescindere.
- **SW sticky iOS** → nota deploy: chiudere/riaprire la PWA.
- **Cron ogni minuto vs orari a 1 min** → i `time` sono `HH:MM`, match esatto al minuto: ok.

## 14. File toccati / creati

- **Modificati:** `sw.js` (push/click), `index.html` (eventuale nuovo script screen + `?v=`/lista), `i18n.jsx`, `screens/impostazioni.jsx` (entry alla sezione), `api.jsx` (VAPID pub + eventuale helper endpoint push).
- **Creati:** `screens/promemoria.jsx` (o sezione in impostazioni), `push-worker/worker.js`, `push-worker/wrangler.toml`, `push-worker/README.md`.
- **Deploy:** `CACHE_NAME` in `sw.js` + `?v=` in `index.html` (dallo script di deploy).

## 15. Validazione

- Ogni `.jsx` transformato con `@babel/preset-react` (no test runner).
- `t("…")` nuove presenti in IT+EN; `<Icon name>` esistenti.
- Worker: test locale `wrangler dev` + invio push di prova a un device reale.
- Checklist QA on-device: attivazione permesso, ricezione a orario, tap→apre app, sposta-allenamento, revoca permesso, multi-device.
