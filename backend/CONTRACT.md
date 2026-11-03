# Contratto dei record — fitness-hub-api

Formato dei `data` di ogni collezione: è il contratto fra backend, PWA (fase 2) e app Swift (fase 3).
Protocollo di sync (push/pull, cursore, `conflicts`, `epoch`/`reset`, regola di `updatedAt`): vedi `README.md`.

## Regole generali

- Date: stringhe `YYYY-MM-DD` (data locale). `updatedAt`: ms epoch, intero.
- Un record = `{ collection, id, data, updatedAt, deleted, deviceId, seq }`. Eliminazione = tombstone (`deleted: true`, `data: null`).
- Conflitti: last-writer-wins **per record** → i dati che due device possono toccare insieme stanno in record separati (una serie, una spunta, un giorno).
- Id deterministici: rifare la stessa operazione (retry, migrazione ripetuta) non crea duplicati.

## Piani

`workoutPlan` (id es. `workout-2026-11`):
```
{ name, status: "active"|"archived", validFrom, validTo|null,
  days: [{ id, name, focus: string[],
           exercises: [{ id, name, sets: number, reps: string, restSec: number, notes,
                         muscles: string[], alternatives: string[] }] }] }
```

`dietPlan` (id es. `diet-2026-11`):
```
{ name, status, validFrom, validTo|null,
  variants: [{ id, key, name, training: { time: "HH:MM" }|null,
               meals: [{ id, name, time: "HH:MM",
                         options: [{ id, text }],                 // "scegli 1"
                         lines: [{ id, label|null, choices: string[] }] }],  // componenti sempre presenti
               supplements: [{ id, key, name, moment, time: "HH:MM" }] }] }
```
`key` della variante: `riposo|mattina|ore17|ore21|ore22` per quelle migrate. `key` dell'integratore: chiave di spunta stabile (`vitac`, `ps`, `custom-<nome>`…). Gli integratori esistono solo se la dieta li prevede. Gli id interni dei piani migrati sono percorsi (`<planId>/d0/e2`, `<planId>/v1/m3/o0`, `<planId>/v0/s4`); quelli creati dall'editor possono essere UUID.

## Log giornalieri

| Collezione | id | data |
|---|---|---|
| `dayState` | `YYYY-MM-DD` | `{ date, checkIn?: { sleep, energy, ailments }, hydration?, notes?, dietVariant?, rest?, cardio?: [{ id, type, min, km, note }] }` — `dietVariant` = key della variante dieta del giorno |
| `setLog` | `${date}:${exerciseId}:${setIndex}` (setIndex da 0) | `{ date, exerciseId, exerciseName, planId\|null, setIndex, weight: string, reps: number\|null, done, substitutedWith: string\|null }` — `exerciseName`/`planId` conservano il contesto anche se il piano cambia o viene eliminato; `exerciseId` = `name:<nome minuscolo>` se l'esercizio non è nel piano |
| `workoutSession` | `${date}:${dayId}` | `{ date, dayId, dayName, startedAt: ms\|null, done }` |
| `mealCheck` | `${date}:${mealId}` | `{ date, mealId, done }` |
| `supplementCheck` | `${date}:${supplementId}` | `{ date, supplementId, done }` |

## Misure e varie

| Collezione | id | data |
|---|---|---|
| `bodyWeight` | data | `{ date, kg: number }` |
| `bodyMeasure` | data | `{ date, …misure in cm }` |
| `shoppingCheck` | chiave articolo | `{ checked: boolean }` |
| `shoppingExtra` | id articolo | l'articolo extra (`{ id, name, … }`) |
| `exerciseNote` | nome esercizio minuscolo | `{ exerciseName, text }` |
| `personalRecord` | nome esercizio minuscolo | `{ exerciseName, … }` |
| `coachMessage` | `${date}:${index}` | `{ date, index, role, text }` |
| `settings` | chiave | `{ value }` — chiavi: `excludedFoods` (string[]), `spesaFreq`, `weightGoal`, `bodyWeight` (peso profilo), `lang`, `theme` |

## Decisioni aperte (fase 3)

- Alimenti di opzioni/righe come testo libero (`"80g riso basmati"`) oppure strutturati `{ nome, quantità }` (spec §6): da decidere con l'editor in-app, tenendo il piano sotto il limite di 64 KB per record.
- Le righe "Note:" della dieta originale non sono migrate (il pasto non ha un campo note).
