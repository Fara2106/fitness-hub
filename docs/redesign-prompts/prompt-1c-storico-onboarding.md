# Prompt 1c — completa Storico + Onboarding (continuazione)

> Da incollare **nella STESSA conversazione/progetto Claude Design** dove hai già disegnato Home/Scheda/Dieta/Spesa e poi Coach/Impostazioni. Riusa token, frame iPhone e componenti già stabiliti. Mockup visivo, NON codice di produzione.

===

Perfetto per **Coach e Impostazioni** — approvate. Ora **completa le ultime 2 schermate** dello stesso redesign: **Storico** e **Onboarding**. Stessi token, stesso frame iPhone, stessi componenti, stessa cura dark/light. Regola invariata: **solo restyle** — struttura, campi e navigazione identici, nessuna funzione aggiunta o tolta.

Aggiorna l'Artifact mostrando queste 2 schermate nel frame iPhone, navigabili, in dark e light, riusando i componenti già definiti (Header con eyebrow+titolo, Card, Row, Segmented control, Chip, Progress, Button primario/secondario/ghost, StatTile, bolle/liste). In fondo aggiungi 2-3 righe di "Design spec" per ognuna.

Contesto app (invariato): allenamento a **giorni dinamici** (es. Push/Pull/Legs), **niente mesociclo/settimane né RPE**. Lo **Storico non è in tab bar**: si apre da Impostazioni → Progressi.

## Le 2 schermate

### 1. Storico — progressi
- **Header**: eyebrow "Progressi" + titolo "Storico".
- Sotto l'header, **3 StatTile** riepilogo settimana affiancate: **Attività** (n°), **Minuti** ('), **km totali**.
- **Segmented control a 3**: `⚖️ Peso` · `🏃 Cardio` · `📋 Check-in`. Il contenuto cambia sotto:
  - **Peso**: card "Trend peso corporeo" con **line chart** del peso nel tempo, poi lista "Ultime misurazioni" (righe data · valore kg). Empty state: "Nessun dato peso — aggiorna il peso dalla Dashboard".
  - **Cardio**: card "Attività recenti (N)" con righe attività (emoji tipo · durata · km/nota). Empty state: "Nessuna attività registrata" + link "Vai alla Dashboard".
  - **Check-in**: card "Ultimi 14 giorni" con un mini-trend a barre/heatmap, poi **3 medie** affiancate: `🌙 Media sonno`, `⚡ Media energia`, `📋 Giorni log` (es. 9/14). Empty state: "Nessun check-in disponibile".
- In fondo, due scorciatoie di navigazione: "Dashboard" e "Allenamento".

### 2. Onboarding — wizard iniziale a step, a tutto schermo
- Sono **3 step** (l'app salta automaticamente quelli già configurati, quindi mostrali come "Step X di N" dinamico):
  1. **Collega Google Sheets** — campo per l'URL Apps Script.
  2. **API key Groq** — campo per la key (con mostra/nascondi).
  3. **Il tuo peso attuale** — campo peso in kg.
- **Header** minimale: marchio "Fitness Hub" a sinistra + bottone "Salta" in alto a destra.
- Sotto l'header: **progress a barrette** (una per step attivo, quelle fatte piene).
- Corpo centrato: riga "Step X di N · «nome step»", **titolo grande** dello step, campo/illustrazione dello step (icona grande a tema: Sheets / chiave / bilancia).
- **Footer**: "Indietro" (dal 2° step in poi) + bottone primario "Continua" — sull'ultimo step diventa "Iniziamo".

## Regole finali
- Solo restyle: stesse schermate, stessi campi, stessi flussi.
- Ogni scelta forte → una riga nella "Design spec".
- Con queste due il set è completo (Home · Scheda · Dieta · Spesa · Coach · Impostazioni · Storico · Onboarding).
