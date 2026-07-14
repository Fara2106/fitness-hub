// Verifica risoluzione daytype + due reminders senza inviare nulla.
import assert from "node:assert";

const WD = ["sun","mon","tue","wed","thu","fri","sat"];
function resolveDaytype(cfg, ymd, weekday) {
  return (cfg.overrides && cfg.overrides[ymd]) || (cfg.weekly && cfg.weekly[weekday]) || null;
}
function dueReminders(cfg, ymd, weekday, hhmm) {
  const dt = resolveDaytype(cfg, ymd, weekday);
  if (!dt) return [];
  return ((cfg.daytypes && cfg.daytypes[dt]) || []).filter(r => r.on && r.time === hhmm);
}

const cfg = {
  weekly: { mon: "ore17", tue: "riposo" },
  daytypes: {
    ore17: [{ id: "pranzo", cat: "pasto", label: "Pranzo", time: "13:00", on: true }],
    riposo: [{ id: "colazione", cat: "pasto", label: "Colazione", time: "08:00", on: true }],
  },
  overrides: { "2026-07-20": "riposo" }, // lunedì spostato a riposo
};

// baseline lunedì → ore17 → pranzo alle 13:00
assert.deepEqual(dueReminders(cfg, "2026-07-13", "mon", "13:00").map(r => r.id), ["pranzo"]);
// override lunedì 20 → riposo → nessun pranzo, ma colazione alle 08:00
assert.deepEqual(dueReminders(cfg, "2026-07-20", "mon", "13:00"), []);
assert.deepEqual(dueReminders(cfg, "2026-07-20", "mon", "08:00").map(r => r.id), ["colazione"]);
// orario non in lista → niente
assert.deepEqual(dueReminders(cfg, "2026-07-13", "mon", "09:00"), []);
console.log("dry-run OK");
