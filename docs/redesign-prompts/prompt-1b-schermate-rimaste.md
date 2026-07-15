# Prompt 1b — continuazione per Claude Design (le 4 schermate rimaste)

> Da incollare **nella STESSA conversazione/progetto Claude Design** dove hai già disegnato Home/Scheda/Dieta/Spesa (così riusa token, frame iPhone e componenti già stabiliti).
> Scopo: mockup visivo delle ultime 4 schermate — Coach, Storico, Impostazioni/Profilo, Onboarding. NON codice di produzione.

===

Continuiamo lo stesso redesign di questa chat: **stessi token, stesso frame iPhone, stessi componenti e la stessa cura dark/light** che hai già stabilito. Ora disegna le **4 schermate ancora mancanti**. Regola invariata: **solo restyle, struttura e navigazione identiche** — non aggiungere/togliere funzioni, non cambiare i flussi.

Aggiorna l'Artifact esistente (o creane uno nuovo coerente) mostrando queste 4 schermate nel frame iPhone, navigabili, in dark e light, riusando i componenti già definiti (Header con avatar LF, Card, Row, Segmented control, Chip, Progress, Button primario/secondario/ghost, StatTile, Sheet, bolle chat). In fondo, aggiorna la "Design spec" con 2-3 righe di note per ognuna.

Promemoria di contesto (l'app è cambiata): allenamento a **giorni dinamici** (es. Push/Pull/Legs), **niente mesociclo/settimane né RPE**. Tab bar a 6: Dashboard · Scheda · Dieta · Spesa · Coach · Impostazioni (Storico si apre da Impostazioni → Progressi).

## Le 4 schermate

1. **Coach (AI)** — chat con l'allenatore AI.
   - Header compatto: titolo "AI Coach" + **chip di contesto reale** (sessione di oggi, peso, check-in) e stato "Sta scrivendo…"; il nome del modello NON va in evidenza in questa schermata (vive in Impostazioni → Connessioni). Bottone "Nuova chat".
   - Corpo: **bolle messaggio** utente vs coach (con avatar coach), indicatore "sta scrivendo" a puntini. Primo messaggio = saluto del coach.
   - **Empty state senza API key**: card centrale con icona + testo e CTA "Configura in Profilo".
   - Barra input in basso: campo "Chiedi al coach…" + bottone invio + eventuali chip di suggerimenti contestuali all'ora (pre/post workout).

2. **Storico** — progressi (si apre da Impostazioni → Progressi, non è in tab bar).
   - Header: eyebrow "Progressi" + titolo "Storico". Due StatTile riepilogo settimana (Attività, Minuti).
   - **Segmented control** a 3: ⚖️ Peso · 🏃 Cardio · 📋 Check-in.
     - **Peso**: line chart "Trend peso corporeo" + lista "Ultime misurazioni".
     - **Cardio**: lista "Attività recenti" (righe con tipo/durata); empty state "Nessuna attività registrata" + link "Vai alla Dashboard".
     - **Check-in**: trend "Ultimi 14 giorni" + tre medie (Media sonno 🌙, Media energia ⚡, Giorni log 📋).
   - In fondo, scorciatoie di navigazione (Dashboard, Allenamento).

3. **Impostazioni / Profilo** — lista di sezioni raggruppate in Card:
   - **Tessera utente** in alto (gradiente marchio LF, via l'avatar arancione).
   - **Piani**: righe Scheda e Dieta con data ultimo aggiornamento + azioni "Importa/Aggiorna .txt" (e, come traguardo, "Modifica"/"Ripristina precedente"); feedback ok/errore dell'import.
   - **Aspetto**: Tema (Sistema / Scuro / Chiaro come segmented) e Lingua (IT / EN).
   - **Connessioni**: riga API key Groq con stato **Configurato/Mancante**, campo mostra/nascondi, bottone "Testa connessione" (con esito ✓/✗); qui è indicato il **modello** (llama-3.3-70b-versatile).
   - **Sincronizzazione**: "Sincronizza ora" (push dati locali) + "Stato sincronizzazione" con badge/orario ultimo sync.
   - **Progressi**: accesso a Storico.
   - In fondo: **Reset completo** (azione distruttiva, tono rosso, con modale di conferma). Nota: peso e log peso vivono in Home, non qui.

4. **Onboarding** — wizard iniziale a step, a tutto schermo.
   - Header minimale con marchio "Fitness Hub" + bottone "Salta" in alto a destra.
   - Indicatore "Step X di N · «nome step»" + progress; titolo grande dello step; campo/illustrazione dello step (es. "Collega Google Sheets", "API key Groq", "Il tuo peso attuale").
   - Footer con "Indietro" / "Continua" (ultimo step: "Iniziamo").

## Regole finali

- Solo restyle: stesse schermate, stessi campi, stessi flussi.
- Mostrami prima **Coach e Impostazioni** (le più ricche); dopo il mio ok completa Storico e Onboarding.
- Ogni scelta forte accompagnala con una riga nella "Design spec".
