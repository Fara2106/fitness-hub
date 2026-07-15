# Prompt 1 — per Claude.ai (redesign visivo → Artifact)

> Incolla tutto il testo qui sotto (dalla riga `===` in poi) in una nuova conversazione su claude.ai.
> Scopo: ottenere un **mockup visivo navigabile** di tutte le schermate, NON codice di produzione.
> Il porting nello stack reale sarà il Prompt 2 (Claude Code).

===

Sei un product designer specializzato in app iOS premium. Voglio ridisegnare il **look & feel** di una mia PWA fitness personale, mantenendo **struttura e navigazione identiche** — cambia solo lo stile visivo, non i flussi né l'organizzazione delle schermate.

## Cosa devi consegnare

Una **singola Artifact HTML self-contained** (tutto inline: CSS + eventuale JS vanilla, nessuna risorsa esterna, nessun webfont) che funzioni da **mockup visivo navigabile**:

1. Un **frame iPhone** (angoli arrotondati, notch/Dynamic Island, safe-area) che mostra le schermate.
2. Tutte le **8 schermate** ridisegnate (elenco sotto), raggiungibili cliccando la tab bar in basso e i pulsanti principali.
3. Un **toggle Dark / Light** in alto: entrambi i temi devono essere curati (il default è dark).
4. In fondo alla pagina, **fuori dal frame**, una sezione "Design spec" in testo con: la nuova palette come variabili CSS, scala tipografica, spacing, raggi, e 2-3 righe di note per ogni schermata su cosa hai cambiato e perché.

Questo è un **mockup di design**, non l'app vera: usa dati finti realistici, non serve logica funzionante. Non usare React né librerie — solo HTML/CSS (e minimo JS vanilla per navigare tra schermate e togglare il tema).

## Direzione di design

- Estetica **iOS premium**, pulita, ariosa, tattile. Continua e rifinisci la direzione già impostata (vedi token attuali sotto).
- **Un solo colore di marca**: il gradiente `linear-gradient(135deg, #0a84ff → #5e5ce6)`. Usalo con parsimonia (CTA principali, accenti, avatar).
- **Colori semantici riservati e non decorativi**: verde `#30d158` = "fatto/completato", giallo `#ffd60a` = "attenzione", rosso `#ff453a` = "errore". Non usarli come decorazione.
- **Font di sistema** (San Francisco via `-apple-system`), zero webfont.
- Dark come default; light altrettanto rifinito. Tutto guidato da variabili CSS, mai colori hardcoded.
- Componenti coerenti, riutilizzabili, con stati (default/premuto/disabilitato/selezionato) visibili.

## Token attuali di partenza (miglioralì, non ripartire da zero)

```css
--bg:#0b0b0f; --bg-2:#121218; --card:#15151b; --card-2:#1d1d25; --card-3:#26262f;
--border:#23232b; --border-2:#2e2e38; --nav-bg:rgba(11,11,15,0.92);
--track:rgba(255,255,255,0.08);
--text:#f2f2f7; --text-2:#8e8e9a; --text-3:#5a5a66;
--accent:#0a84ff; --accent-2:#5ac8fa; --brand-2:#5e5ce6;
--brand-grad:linear-gradient(135deg,#0a84ff 0%,#5e5ce6 100%);
--success:#30d158; --warning:#ffd60a; --danger:#ff453a;
--display/--body: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
--r-sm:10px; --r:16px; --r-lg:22px; --r-xl:28px;
```

## Inventario componenti da ristilare (mantieni questi ruoli)

Header con avatar "LF", Card, Row (riga lista), Segmented control, Chip, Progress bar, Button (primario/secondario/ghost), StatTile (tessera con numero grande), Sheet (pannello che sale dal basso), Avatar marchio "LF" col gradiente.

## Le 8 schermate (stessa struttura, nuovo look)

Navigazione: **tab bar in basso** con Dashboard · Scheda · Dieta · Spesa · Coach · Impostazioni (Storico raggiunto da Impostazioni → Progressi — non in tab bar).

1. **Dashboard (Home)** — header con avatar LF + badge di sync; hero "Oggi" (sessione di allenamento del giorno o "riposo", chip informative, CTA grande "Inizia allenamento"); riga "Prossimo pasto"; check-in rapido (Sonno ed Energia a 5 tacche, "Fastidi" espandibile); StatTile Peso (tap = log rapido); card secondarie: Idratazione, Movimento/cardio, riepilogo muscoli allenati nella settimana.
2. **Scheda (allenamento)** — **tab dei giorni** dinamici in alto (G1…G5, nomi dal piano, es. Push / Pull / Legs); lista esercizi con spunta di completamento, serie/ripetizioni/peso, sostituzione esercizio; overlay **timer di recupero** a schermo pieno; più un **Player a schermo intero** (un esercizio alla volta, "Serie fatta" → auto-recupero → avanzamento). È la schermata più densa: rendila leggibile e "da palestra" (target grandi, leggibile a distanza).
3. **Dieta** — sezioni per pasto con lista alimenti (i **nomi dei cibi restano in italiano**, sono dati del piano); varianti giorno-allenamento vs giorno-riposo.
4. **Spesa (lista della spesa)** — lista con spunte, raggruppata; controllo frequenza.
5. **Coach (AI)** — interfaccia chat con l'allenatore AI (bolle utente/coach, campo input, stato "sta scrivendo").
6. **Storico** — grafico dell'andamento del peso corporeo (line chart) + cronologia.
7. **Impostazioni** — lista di sezioni: tema (Sistema/Scuro/Chiaro), lingua (IT/EN), import file di testo, sincronizzazione (con badge stato), accesso a Progressi → Storico, profilo.
8. **Onboarding** — wizard iniziale a step con pulsante "Salta".

## Dominio (per rendere i mockup credibili)

App fitness personale, allenamento 3×/settimana a **giorni dinamici** dal piano (es. Push/Pull/Legs, o Upper/Lower), cardio nei giorni di riposo. C'è un coach AI, tracking peso corporeo, dieta e lista spesa. (Niente mesociclo/settimane né RPE — rimossi dall'app.)

## Regole finali

- Non cambiare quali schermate esistono né come si naviga tra loro: **solo restyle**.
- Mostrami prima una **panoramica** (palette + 2-3 schermate chiave: Dashboard, Scheda, Dieta), poi, dopo il mio ok, completa le restanti.
- Ogni scelta forte (colore, gerarchia, componente) accompagnala con una riga di motivazione nella "Design spec" finale.
