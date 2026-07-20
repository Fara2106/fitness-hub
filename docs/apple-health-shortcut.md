# Apple Health → Fitness Hub (via Comando rapido iOS)

Una PWA **non può leggere Apple Health** (nessuna API HealthKit dal browser/web clip).
L'integrazione si fa con un **Comando rapido** (Shortcuts) che legge il peso da
Salute e lo invia al backend Google Sheets del Fitness Hub. Al successivo sync
l'app lo tira giù e lo fonde nel `weightLog` (dedup per data, vedi `_cloudSync`).

## Comando rapido "Peso → Fitness Hub"

Crea un nuovo Comando rapido con questi passaggi:

1. **Trova campioni di salute**
   - Tipo: `Peso`
   - Ordina per `Data di inizio` (decrescente), Limite `1`.
2. **Ottieni dettagli campioni di salute** → `Valore` (il numero in kg). Salvalo in una variabile `Peso`.
3. **Data corrente** → **Formatta data** → formato personalizzato `yyyy-MM-dd`. Variabile `Oggi`.
4. **Ottieni contenuto di URL**
   - URL: `https://fitness-hub-proxy.lorefara97.workers.dev`
   - Metodo: `POST`
   - Intestazioni: `Content-Type` = `application/json`
   - Corpo richiesta: **JSON**
     ```json
     {
       "action": "savePesoCorporeo",
       "date": "«Oggi»",
       "weight": «Peso»
     }
     ```
     (sostituisci `«Oggi»` e `«Peso»` con le variabili dei passi 3 e 2).

Poi apri il Fitness Hub e fai **Sincronizza ora** (o aspetta il sync automatico):
il peso comparirà nel trend Storico e alimenta anche progressione/volume.

## Automazione (opzionale, il vero valore)

In **Comandi rapidi → Automazione → Crea automazione personale**:
- **Ora del giorno**: es. ogni mattina alle 08:00 → esegui il comando qui sopra
  (spunta "Esegui immediatamente" per non ricevere la richiesta di conferma).
- Oppure **App → Salute → Quando registro un peso** → esegui il comando.

Così ogni pesata su Salute finisce da sola nel Fitness Hub, senza digitare nulla.

## Passi / cardio (non ancora)

Il backend attuale ha l'endpoint per il **peso** (`savePesoCorporeo`) ma non una
colonna dedicata ai passi giornalieri da Health. Per portarci anche i passi
servirebbe: (a) una colonna/azione lato Apps Script, (b) un secondo comando
rapido `Trova campioni di salute → Passi`. Fuori scope per ora — il peso è
l'integrazione a valore immediato.

## Sicurezza

Il comando invia solo `{date, weight}` al tuo stesso backend (lo stesso proxy che
usa l'app). Nessun dato Health lascia il tuo ecosistema oltre a ciò che l'app già
sincronizza. Il proxy è un semplice inoltro CORS senza storage.
