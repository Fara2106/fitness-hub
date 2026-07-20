# Sicurezza — hardening 2026-07-20

Riepilogo delle misure e cosa devi fare tu (solo per la parte backend).

## Cosa è già live (lato client, deployato)
- **SRI** (`integrity`) su tutti gli script CDN, inclusi `prop-types`/`recharts`/`gsap`
  (prima mancava): se una CDN servisse codice manomesso, il browser lo **rifiuta**.
- **Content-Security-Policy** (`<meta>` in `index.html`): `connect-src` **blindato** ai
  soli host legittimi (proxy Cloudflare, worker push, `api.groq.com`) → anche in caso
  di codice iniettato, **niente esfiltrazione** verso domini terzi. Più `object-src
  'none'`, `base-uri 'self'`, `form-action 'none'`. (`script-src` deve consentire
  `'unsafe-eval'` perché Babel standalone compila il JSX a runtime, e `'unsafe-inline'`
  per gli script di bootstrap: la CSP non è quindi ermetica sull'esecuzione, ma
  **blocca il furto di dati**, che è il rischio concreto qui.)

## Cosa devi attivare tu (backend — chiude l'esposizione seria)

**Problema:** il repo è pubblico e contiene l'URL Apps Script; il backend non aveva
autorizzazione → chiunque poteva chiamare `getSettings` e leggere i dati **inclusa la
chiave Groq** (sincronizzata nel foglio Settings).

**Soluzione (token condiviso, tenuto FUORI dal repo):**

1. Genera un token casuale lungo, es. da terminale:
   ```
   openssl rand -hex 32
   ```
2. **Cloudflare Worker** (`fitness-hub-proxy`): incolla il nuovo `cloudflare-worker.js`
   → Deploy. Poi Worker → **Settings → Variables and Secrets** → aggiungi un **Secret**:
   `APP_TOKEN` = il token del passo 1.
3. **Apps Script** (`google-apps-script.gs`): aggiorna il codice (già modificato nel
   repo) e ri-deploya la Web App. Poi **Progetto → Impostazioni progetto → Proprietà
   script** → aggiungi `APP_TOKEN` = **lo stesso** token.

**Ordine consigliato:** deploya prima il codice (Worker + .gs) SENZA i segreti → tutto
continua a funzionare (comportamento legacy). Poi imposta `APP_TOKEN` su **entrambi**
nello stesso momento → l'enforcement si attiva. Da quel momento:
- Un attacco **diretto** a `script.google.com` (URL noto dal repo) senza token → **rifiutato**.
- `getSettings` (e tutto) richiede il token → la **chiave Groq nel foglio non è più leggibile** da estranei.
- Il **client non cambia**: il Worker inietta il token in modo trasparente.

## Limiti onesti (per non dare falsa sicurezza)
- Un client **non-browser** (curl) può falsificare l'header `Origin`, quindi
  l'allowlist Origin del Worker non è ermetica: la protezione vera è il **token**
  (che vive solo nel Worker/Script Properties, mai nel repo).
- Il Worker resta l'unica porta: se un domani vuoi alzare ancora l'asticella, si può
  aggiungere **rate-limiting** (Cloudflare) o una **Web App Apps Script privata**
  (accesso "solo io", con OAuth) — ma per un'app personale il token + Origin è un buon
  compromesso.
- La chiave Groq a riposo sul device (IndexedDB) non è cifrata: accettabile perché
  locale. In alternativa si può **non sincronizzarla** affatto (resta solo sul device).

## Già a posto (verificato nel codice)
Nessun `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`; nessun segreto
hardcoded; nessun `localStorage`; HTTPS ovunque; versioni CDN pinnate.
