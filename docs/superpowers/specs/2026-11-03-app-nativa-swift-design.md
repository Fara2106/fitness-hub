# Fitness Hub nativo (Swift) + sync unica — design

Data: 2026-11-03 · Stato: in approvazione (risposte di Lorenzo integrate) · Autore: brainstorming con Lorenzo

## 1. Intento e perché

Lorenzo usa Fitness Hub (oggi una PWA su GitHub Pages) in quattro momenti della
giornata: **la mattina** (cosa lo aspetta oggi: allenamento o riposo, pasti,
integratori, check-in), **quando fa la spesa**, **quando si allena**, **quando
prepara i pasti**. Vuole un'app **nativa in Swift** per iPhone e iPad, per uso
personale, che si senta come un'app iOS vera e lo accompagni in tutti e quattro
i momenti.

Due cambi di fondo rispetto a oggi, decisi da Lorenzo:

- **Scheda e dieta si inseriscono e modificano dentro l'app**, riga per riga.
  Niente più file `.txt`. Il piano cambia circa **una volta al mese** e arriva in
  forme diverse (non c'è un formato sorgente da importare).
- **Tutto si sincronizza fra web, app iPhone e app iPad.** Il foglio Google era
  solo il posto dove l'app salvava i dati: può essere sostituito.

Motivi pratici (emersi nella QA del 2026-11-03): la PWA su iOS soffre di service
worker "appiccicosi", aggiornamenti incerti, status bar/bande gestite da iOS,
storage evictable, nessuna vibrazione/notifica affidabile a fine recupero; il
backend Google Sheets/Apps Script è lento (~2,7 s a chiamata), con quote, e non
adatto a dati strutturati.

## 2. Obiettivi

1. App SwiftUI per **iPhone e iPad** (stesso codice, layout adattivo) con
   **parità funzionale** con la PWA attuale: Home "oggi", Scheda + Player, Dieta
   del giorno, Spesa, Coach AI, Storico (peso, forza, volume, misure, registro),
   Impostazioni.
2. **Editor in-app** per scheda allenamento e dieta (sezione 5), veloci da usare
   a mano, con **"nuovo piano dal precedente"**.
3. **Storico dei piani**: i piani passati restano consultabili in sola lettura;
   Lorenzo può eliminarli a mano.
4. **Sync unica** fra app iPhone, app iPad e web su un nuovo backend (sezione 7),
   **offline-first**: tutto funziona senza rete (palestra, supermercato) e si
   allinea quando torna.
5. **Si sincronizza tutto**, compreso ciò che oggi resta sul singolo device:
   check-in, allenamento in corso, pasti spuntati, integratori spuntati,
   idratazione, movimento, note del giorno, record personali, chat del Coach.
6. **Prima versione già completa e precaricata** con la scheda e la dieta
   attuali di Lorenzo (migrazione automatica, sezione 9).
7. Esperienza nativa nei momenti chiave: **fine recupero affidabile a schermo
   bloccato** (notifica locale + suono/vibrazione), **Live Activity** del timer
   di recupero, **Apple Salute** (scrittura peso e allenamenti).

## 3. Non-obiettivi (v1)

- Pubblicazione sull'App Store (uso personale; eventualmente TestFlight dopo).
- Importare piani da PDF/foto (possibile in seguito con l'IA).
- Apple Watch, widget della schermata Home, Siri/Comandi (dopo la v1).
- Multi-utente / account: c'è un solo utente, Lorenzo.
- Editor di piani nella **versione web** (vedi decisioni, sezione 11).

## 4. Anti-obiettivi (sarebbe un fallimento anche se "funziona")

- Perdere dati durante la migrazione o nel passaggio PWA → app nativa.
- Un'app che senza rete non si apre o non lascia spuntare serie/pasti/spesa.
- Modifiche fatte su due device che si cancellano a vicenda (bug già visto e
  corretto nella PWA il 2026-11-03: niente "vince l'intero oggetto").
- Cambiare il piano a metà giornata e ritrovarsi le spunte di oggi attribuite a
  un altro esercizio (bug già visto e corretto nella PWA).
- Integratori o alimenti "inventati" dall'app: **gli integratori compaiono solo
  se previsti dalla dieta**; nessuna lista fissa nel codice.
- Chiavi o segreti nel repo (il repo è pubblico).

## 5. Funzionalità

### 5.1 Piani (scheda e dieta) — editor

**Scheda allenamento**
- Giorni: crea, rinomina, riordina (trascinamento), duplica, elimina. Numero
  libero. Ogni giorno ha nome (es. "PUSH", "Upper A") e focus muscolari.
- Esercizi del giorno: nome, serie, ripetizioni (numero o intervallo "8-12" o
  testo "max"), recupero in secondi, note tecniche, muscoli coinvolti,
  alternative (lista di nomi proposti dal "sostituisci" nel Player).
- Inserimento rapido: tastiere numeriche dove servono, suggerimenti dai nomi già
  usati, riordino a trascinamento.

**Dieta**
- Varianti del giorno: crea/rinomina/elimina (oggi: riposo, allenamento mattina,
  ore 17, ore 21, ore 22 — non più fisse). Ogni variante può indicare se è un
  giorno di allenamento e l'orario dell'allenamento (serve a Home e integratori
  "pre/durante allenamento").
- Pasti per variante: nome e orario liberi.
- Dentro un pasto: **opzioni** ("scegli 1") e/o **righe per categoria** con
  alternative (es. Carboidrato: 80g riso basmati | 80g pasta farro …), ciascuna
  con alimento e quantità (testo libero, es. "80g", "2 uova").
- Integratori per variante, per momento della giornata, con orario. **Solo se la
  dieta li prevede.**
- Alimenti da escludere sempre: impostazione modificabile (oggi: pasta di ceci,
  pasta di lenticchie, pasta di piselli, bevanda di mandorla).

**Ciclo di vita**
- Un solo piano **attivo** per tipo (scheda / dieta) alla volta.
- "Nuovo piano dal precedente": copia profonda del piano attivo da modificare;
  quando lo si attiva, il precedente va in **storico** (sola lettura).
- Storico: elenco dei piani passati con periodo di validità; eliminazione
  manuale con conferma. Gli allenamenti/log restano collegati al piano con cui
  sono stati fatti (anche dopo l'eliminazione del piano: i log conservano nomi
  e valori, vedi 6).
- Cambio piano in giornata: il progresso di oggi resta legato all'esercizio/
  pasto per cui è stato registrato; non "scivola" su altri elementi.

### 5.2 Uso quotidiano (parità con la PWA)

- **Home "oggi"**: giorno di allenamento selezionato o riposo ("Oggi riposo"),
  prossimo pasto, check-in (sonno, energia, fastidi), peso con trend, movimento,
  riepilogo settimana, report settimanale (dom/lun), nudge contestuali.
- **Scheda + Player**: lista del giorno con serie spuntabili e pesi (testo
  libero: kg o colore elastico), sostituzioni, note setup per esercizio,
  progressione suggerita, deload da check-in, PR, timer di recupero
  (auto-recupero anche tra esercizi), riepilogo di fine sessione (durata,
  tonnellaggio, confronto, PR), condivisione. Salvataggio idempotente: chiudere
  due volte non duplica nulla.
- **Dieta del giorno**: variante del giorno, timeline pasti + integratori,
  spunta pasti e integratori, aderenza, equivalenze alimentari, idratazione,
  cardio.
- **Spesa**: lista generata dalla dieta attiva (quantità per 1 o 2 spese a
  settimana, come oggi), articoli extra manuali, spunte; si aggiorna da sola
  quando cambia la dieta.
- **Coach AI**: chat con contesto (piano attivo, dieta, check-in, peso, note,
  aderenza, misure), risposte in streaming, markdown minimo; esclusioni
  alimentari sempre rispettate. Modello e chiave lato server (sezione 8).
- **Storico**: peso (media mobile, obiettivo e proiezione), forza (e1RM per
  esercizio), volume, misure corporee, registro sessioni, check-in.
- **Impostazioni**: tema (sistema/chiaro/scuro), lingua IT/EN, alimenti esclusi,
  esporta/ripristina backup su file, diagnostica, stato sync.

### 5.3 Esperienza nativa (v1)

- Timer di recupero con **notifica locale** a fine recupero anche a schermo
  bloccato/app in background, suono + vibrazione (haptics); **Live Activity**
  (Dynamic Island / schermata di blocco) col conto alla rovescia.
- **Apple Salute**: scrittura del peso corporeo e delle sessioni di
  allenamento (tipo allenamento di forza, durata). Lettura del peso da Salute
  opzionale (se c'è una bilancia smart) — da attivare in Impostazioni.
- Avvio istantaneo dai dati locali; nessuna schermata di attesa per la rete.
- iPad: layout a due colonne dove ha senso (es. lista esercizi + dettaglio,
  editor), Sidebar come nella PWA.

## 6. Modello dati (logico)

Tutte le entità hanno `id` (UUID), `updatedAt`, `deletedAt` (tombstone) e
`deviceId` dell'ultima modifica, per la sync.

- **Piani**: `WorkoutPlan`(nome, stato: attivo|storico, validoDa, validoA) →
  `WorkoutDay`(ordine, nome, focus[]) → `Exercise`(ordine, nome, serie,
  ripetizioni testo, recuperoSec, note, muscoli[], alternative[]).
  `DietPlan`(come sopra) → `DietVariant`(ordine, nome, allenamento?: orario) →
  `Meal`(ordine, nome, orario) → `MealOption`/`MealLine`(etichetta, alimenti
  [{nome, quantità}]) ; `Supplement`(variante, momento, orario, nome).
- **Log giornalieri** (chiave = data): `DayState`(giorno scheda selezionato,
  variante dieta, riposo, check-in, idratazione, note, cardio),
  `SetLog`(data, esercizio id **+ nome esercizio + piano id al momento**,
  indice serie, peso testo, ripetizioni, fatto, sostituito con),
  `WorkoutSession`(data, giorno, inizio, fine, riepilogo), `MealCheck`,
  `SupplementCheck`.
- **Misure**: `BodyWeight`(data, kg), `BodyMeasure`(data, vita, fianchi, …).
- **Spesa**: spunte per articolo generato (id stabile derivato da alimento) e
  `ShoppingExtra`(nome).
- **Varie**: `ExerciseNote`(nome esercizio, testo), `PersonalRecord` (derivabile
  dai SetLog, ma memorizzato per velocità), `CoachMessage`, `Settings`
  (esclusioni, lingua, tema, frequenza spesa, obiettivo peso).

Granularità pensata per la sync: ogni serie, spunta, pasto o articolo è un
record a sé → le modifiche su device diversi si sommano naturalmente.

## 7. Sync e backend

- **Backend nuovo su Cloudflare**, nello stesso account del Worker attuale:
  Worker + **database D1** (SQLite gestito), API JSON.
- **Offline-first**: ogni client tiene una copia locale completa e una coda di
  modifiche; push delle modifiche + pull di quelle altrui "dal cursore X"
  (per `updatedAt` lato server). Avvio sempre dai dati locali.
- **Conflitti**: last-writer-wins **per record** (non per oggetto intero);
  eliminazioni come tombstone. Grazie alla granularità (sezione 6) i casi reali
  (spunte diverse su iPhone e iPad) si sommano.
- **Accesso**: utente unico. Token personale lungo, generato una volta,
  conservato nel Keychain (app) / storage locale (web); il Worker lo verifica.
  Nessun segreto nel repo. CORS: origine della PWA + richieste dalle app native.
- **Coach**: il Worker fa da ponte verso Groq con la chiave nel secret
  `GROQ_API_KEY` (già previsto oggi), con lista modelli e ripiego
  (`openai/gpt-oss-120b` → `qwen/qwen3.8-27b` → `openai/gpt-oss-20b`, verificati
  il 2026-11-03; i modelli Groq vengono ritirati: la lista va tenuta aggiornabile
  lato server) e tetto minimo di token per i modelli che "ragionano".
- **Backup**: ripristino a una data del database (funzione di D1) + esporta /
  ripristina su file dalle Impostazioni (come oggi).
- **Google Sheets / Apps Script**: dismessi dopo la migrazione. Il foglio resta
  intatto, Lorenzo lo cancella quando vuole.

## 8. Versione web (PWA)

- Resta su GitHub Pages, passa al nuovo backend (stessa sync offline-first).
- Funzioni quotidiane come oggi (Home, Scheda + Player, Dieta, Spesa, Coach,
  Storico), lette dal **modello strutturato** invece che dai `.txt`.
- **Editor dei piani: solo nelle app native in v1** (la web mostra i piani e lo
  storico in sola lettura). Rivedibile.
- Il parser `.txt` resta solo per la migrazione iniziale.

## 9. Migrazione (una tantum)

1. Scheda e dieta attuali (`scheda.txt` / `dieta.txt` / `schedaData` /
   `dietaData` nel foglio) → convertite col parser esistente nel modello
   strutturato → **piano attivo** di ciascun tipo. Gli integratori vengono dal
   blocco `INTEGRATORI` del file (logica già in `parser.jsx` `_resolveSupps`).
2. Dati del foglio Google (check-in, eventuali pesi/serie/sessioni, settings) →
   tabelle corrispondenti.
3. Dati locali del telefono (storage IndexedDB della PWA: progressi del giorno,
   pesi, note, spunte, misure, chat) → tramite il **backup JSON** già esistente
   (Impostazioni → Backup → Esporta), importato nel nuovo backend.
4. Verifica: conteggi prima/dopo per ogni tipo di dato; niente si cancella dalle
   fonti vecchie.

## 10. Vincoli e contesto tecnico

- Mac di Lorenzo: Xcode 27.2, iOS SDK 27.2, Swift 6.4. Simulatori iPhone/iPad
  disponibili (procedura QA in memoria `ios-simulator-qa-setup`).
- Installazione v1: **Apple ID gratuito** da Xcode (l'app scade ogni 7 giorni e
  va reinstallata dal Mac). Alcune capacità potrebbero richiedere l'Apple
  Developer Program a pagamento (99 €/anno) — da verificare in fase di piano:
  Apple Salute (HealthKit), Live Activity/widget (App Group), notifiche push
  remote (non servono: le notifiche del timer sono locali).
- Codice Swift in una cartella/progetto separato dalla PWA (la PWA è servita da
  GitHub Pages che pubblica tutto il repo: nessun segreto, niente artefatti
  pesanti nel repo pubblico).
- Lingue: IT (principale) + EN, come oggi. Nomi degli alimenti restano come
  scritti nel piano.
- Ogni regola già imparata nella PWA vale anche qui (vedi CLAUDE.md): niente
  stato per posizione senza identità, salvataggi idempotenti, nessun overlay
  che finisce sotto la barra, ecc.

## 11. Decisioni

**Di Lorenzo**
- App nativa in **Swift**, per **iPhone e iPad**, uso personale.
- Scheda **e** dieta inserite/modificate **in-app**, a mano, riga per riga;
  niente `.txt`.
- **Storico dei piani**, eliminabile a mano.
- **Integratori solo se previsti dalla dieta.**
- **Sync fra web, app iPhone e app iPad**; il foglio Google serviva solo a
  salvare i dati → sostituibile.
- **Prima versione completa**, già **precaricata** con i piani attuali.

**Scelte mie (da confermare o correggere)**
- Backend Cloudflare Worker + D1 (stesso account), offline-first,
  last-writer-wins per record.
- Editor solo nelle app native in v1; web in sola lettura per i piani.
- Esperienza nativa v1: notifica locale + Live Activity del timer, Apple Salute
  (scrittura peso e allenamenti).
- Fuori dalla v1: import da PDF/foto, App Store, Watch, widget, Siri.
- Installazione con Apple ID gratuito finché non si decide per il programma a
  pagamento.

## 12. Risposte di Lorenzo alla rilettura da costruttore

- **Versione iOS**: iPhone e iPad sono su **iOS 27.2** → deployment target
  **iOS 27.0** per iPhone e iPad (nessun vincolo di retrocompatibilità).
- **Apple Developer Program**: **più avanti**. In v1 si installa con l'Apple ID
  gratuito. Apple Salute e Live Activity vengono costruite ma **attivate solo se
  le capacità sono disponibili** sul team personale (da verificare all'inizio
  della fase 3); se non lo sono restano pronte e disattivate, e si accendono
  quando arriva il programma a pagamento. Il resto dell'app non dipende da esse.
- **Cloudflare**: gli agenti **possono creare e pubblicare** il backend (D1 +
  Worker) dall'account di Lorenzo tramite `wrangler`, dopo un **login una
  tantum fatto da Lorenzo** sul Mac. Segreti (token app, `GROQ_API_KEY`) solo
  come secret del Worker, mai nel repo.

## 12b. Lasciato a chi costruisce

- Struttura del progetto Xcode, architettura SwiftUI (es. Observation +
  SwiftData o altro storage locale), librerie (preferire zero dipendenze).
- Schema SQL concreto di D1, formato dell'API di sync, strategia del cursore.
- Grafici dello Storico (Swift Charts suggerito).
- Design visivo: coerente con la PWA (tema scuro di default, marchio LF,
  "liquid glass"), adattato alle convenzioni iOS.
- Ordine interno dei lavori, purché rispetti le fasi qui sotto.

## 13. Fasi

1. **Backend + modello + migrazione** (Worker + D1, API sync, import dei dati
   attuali). Verificabile con test, senza toccare l'uso quotidiano.
2. **PWA sul nuovo backend** (lettura modello strutturato, sync unica);
   dismissione di Apps Script/Sheets. *Scelta mia:* prima dell'app Swift, così
   durante la costruzione dell'app PWA e app scrivono sullo stesso database e i
   dati non divergono.
3. **App Swift iPhone** completa sul nuovo backend (parità + editor + storico
   piani + esperienza nativa).
4. **iPad** (layout adattivo; stesso target).

La generazione della lista spesa riusa la logica attuale di `screens/spesa.jsx`
(quantità per 1 o 2 spese a settimana), portata sul modello strutturato.

Ogni fase si chiude con QA su simulatore (e sul device di Lorenzo per le
funzioni che il simulatore non copre: notifiche a schermo bloccato, Salute,
Live Activity).
