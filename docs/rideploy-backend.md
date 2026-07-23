# Rideploy backend — checklist (10 minuti, dal PC)

Due incolla + un secret. Entrambi **backward-compatible**: se qualcosa va storto
l'app continua a funzionare come oggi. Quando hai finito, dillo a Claude che
verifica tutto da terminale (probe `/groq`, `getAll`, `getSessioni`).

## 1 · Worker Cloudflare (~4 min)

Sblocca: Coach senza chiave sui device nuovi, risposte in streaming via proxy,
hardening `/groq` (Origin obbligatoria, cap payload, rate-limit).

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **fitness-hub-proxy** → **Edit code**.
2. Seleziona tutto il codice nell'editor e **incolla l'intero contenuto di
   [`cloudflare-worker.js`](../cloudflare-worker.js)** (dal repo, versione corrente).
   ⚠️ Occhio all'auto-indent dell'editor: dopo l'incolla controlla che in fondo
   al file non ci siano righe spezzate (successe il 20/07).
3. **Deploy**.
4. Torna al Worker → **Settings → Variables and Secrets → Add**:
   - Type: **Secret**
   - Name: `GROQ_API_KEY`
   - Value: la tua chiave `gsk_…` — la trovi/rigeneri su
     [console.groq.com/keys](https://console.groq.com/keys) (se la rigeneri,
     aggiorna anche quella salvata in Impostazioni → AI Coach sull'iPhone,
     oppure cancellala da lì: senza chiave locale l'app userà il proxy).
   - **Deploy/Save**.
5. Verifica rapida (o lascia fare a Claude):
   `https://fitness-hub-proxy.lorefara97.workers.dev/groq` → deve rispondere
   `{"success":true,"groq":true}`.

> NB: il secret `APP_TOKEN` esistente NON va toccato.

## 2 · Google Apps Script (~4 min)

Sblocca: sync a 1 chiamata (getAll), Misure nel cloud, tab Registro completa
(getSessioni), auto-backup settimanale (saveBackup).

1. Apri il Google Sheet del fitness → **Estensioni → Apps Script**.
2. Nell'editor, seleziona tutto e **incolla l'intero contenuto di
   [`google-apps-script.gs`](../google-apps-script.gs)** (dal repo). Salva (⌘S).
3. **Deploy → Gestisci deployment** → matita ✏️ sul deployment **esistente** →
   Versione: **Nuova versione** → **Esegui il deployment**.
   ⚠️ NON creare un "Nuovo deployment": cambierebbe l'URL `/exec` e il Worker
   punterebbe ancora a quello vecchio. La "Nuova versione" mantiene lo STESSO URL.
4. La Script Property `APP_TOKEN` esistente resta valida, non serve toccarla.

## 3 · Dopo (30 secondi)

- Chiudi e riapri la PWA su iPhone/iPad (o tocca "Aggiorna" se appare il banner).
- Di' a Claude "ho fatto i rideploy" → verifica end-to-end da terminale:
  - GET `/groq` → `{groq:true}`; POST di prova → risposta del modello (streaming);
  - `getAll` → risposta con `.settings` (in app: log `[sync] getAll` sparisce);
  - `getSessioni` → array del registro; primo auto-backup al sync successivo.
