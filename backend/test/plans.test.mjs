import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadParser, REPO_ROOT } from "../migrate/load-parser.mjs";
import { workoutPlanFromText, dietPlanFromText } from "../migrate/plans.mjs";

const schedaTxt = readFileSync(join(REPO_ROOT, "scheda.txt"), "utf8");
const dietaTxt = readFileSync(join(REPO_ROOT, "dieta.txt"), "utf8");
const { parseScheda, parseDieta } = loadParser();
const OPTS = { name: "Piano", validFrom: "2026-01-01" };
const workout = () => workoutPlanFromText(schedaTxt, { ...OPTS, id: "wp1" });
const diet = () => dietPlanFromText(dietaTxt, { ...OPTS, id: "dp1" });
const variant = (k) => diet().data.variants.find((v) => v.key === k);

test("scheda: 3 giorni con i nomi attesi e record attivo", () => {
  const r = workout();
  assert.equal(r.collection, "workoutPlan");
  assert.equal(r.id, "wp1");
  assert.equal(r.data.status, "active");
  assert.equal(r.data.validTo, null);
  assert.deepEqual(r.data.days.map((d) => d.name), ["PUSH", "PULL", "LEGS + CORE (mantenimento)"]);
});

test("scheda: esercizi per giorno = parseScheda, id path-like", () => {
  const parsed = parseScheda(schedaTxt).days;
  workout().data.days.forEach((d, i) => {
    assert.equal(d.exercises.length, parsed[i].exercises.length);
    assert.equal(d.id, `wp1/d${i}`);
    assert.deepEqual(d.focus, parsed[i].focus);
    d.exercises.forEach((e, j) => {
      assert.equal(e.id, `wp1/d${i}/e${j}`);
      assert.deepEqual(e.muscles, parsed[i].exercises[j].muscles);
      assert.deepEqual(e.alternatives, parsed[i].exercises[j].alternatives);
    });
  });
});

test("scheda: Push-up (bodyweight) sets/reps/rest/notes", () => {
  const ex = workout().data.days[0].exercises.find((e) => e.name === "Push-up (bodyweight)");
  assert.equal(ex.sets, 3);
  assert.equal(ex.reps, "8-12");
  assert.equal(ex.restSec, 60);
  assert.match(ex.notes, /^Corpo in linea/);
});

test("scheda: le alternative del parser (# Esercizio → A / B) sono riportate", () => {
  const txt = "# PUSH - Giorno 1\n# Focus: Petto\n# Push-up → Dip / Panca\nEsercizio | Serie | Rip | Recupero | Note\nPush-up | 3 | 8-12 | 60 | x\n";
  const ex = workoutPlanFromText(txt, { ...OPTS, id: "w" }).data.days[0].exercises[0];
  assert.deepEqual(ex.alternatives, ["Dip", "Panca"]);
});

test("dieta: varianti nell'ordine del file con le chiavi attese", () => {
  const r = diet();
  assert.equal(r.collection, "dietPlan");
  assert.equal(r.data.status, "active");
  assert.deepEqual(r.data.variants.map((v) => v.key), ["riposo", "mattina", "ore17", "ore21", "ore22"]);
  assert.deepEqual(r.data.variants.map((v) => v.name), [
    "Giorno senza allenamento", "Allenamento mattina", "Allenamento ore 17", "Allenamento ore 21", "Allenamento ore 22"]);
});

test("dieta: training null per riposo, orario per le altre", () => {
  assert.equal(variant("riposo").training, null);
  assert.deepEqual(variant("mattina").training, { time: "08:00" });
  assert.deepEqual(variant("ore17").training, { time: "17:00" });
  assert.deepEqual(variant("ore21").training, { time: "21:00" });
  assert.deepEqual(variant("ore22").training, { time: "22:00" });
});

test("dieta: pasti per variante = parseDieta; name/time = title/time del parser (Ruling 9)", () => {
  const parsed = parseDieta(dietaTxt);
  for (const v of diet().data.variants) {
    const p = parsed[v.key].meals;
    assert.equal(v.meals.length, p.length, v.key);
    v.meals.forEach((m, j) => {
      assert.equal(m.name, p[j].title, `${v.key}[${j}] name`);
      assert.equal(m.time, p[j].time, `${v.key}[${j}] time`);
    });
  }
});

test("dieta riposo: COLAZIONE 4 options, PRANZO line Carboidrato con 6 choices", () => {
  const meals = variant("riposo").meals;
  const col = meals.find((m) => m.name === "Colazione");
  assert.equal(col.options.length, 4);
  assert.match(col.options[0].text, /^40g gallette/);
  assert.deepEqual(col.lines, []); // "Note: caffè sempre ok" non diventa contenuto
  const pranzo = meals.find((m) => m.name === "Pranzo");
  const carbo = pranzo.lines.find((l) => l.label === "Carboidrato (scegli 1)");
  assert.equal(carbo.choices.length, 6);
  assert.equal(pranzo.lines.find((l) => l.label === "Condimento").choices.length, 1);
});

test("dieta: Ruling 4 — '- testo' in un pasto 'scegli 1' diventa option", () => {
  const mattina = variant("mattina").meals.find((m) => m.name === "Colazione");
  assert.equal(mattina.options.length, 2);
  assert.equal(mattina.lines.length, 0);
  // senza "scegli 1" i '- testo' sono lines senza label
  const spuntino = variant("riposo").meals.find((m) => m.name === "Spuntino");
  assert.equal(spuntino.options.length, 0);
  assert.deepEqual(spuntino.lines.map((l) => l.label), [null, null]);
});

test("dieta: ore22 'Nessun pasto' resta come riga, Note/INTEGRATORI mai nei pasti", () => {
  const post = variant("ore22").meals.at(-1);
  assert.match(post.lines[0].choices[0], /^Nessun pasto aggiuntivo/);
  for (const v of diet().data.variants) {
    for (const m of v.meals) {
      const texts = [...m.options.map((o) => o.text), ...m.lines.flatMap((l) => [l.label ?? "", ...l.choices])];
      for (const t of texts) {
        assert.doesNotMatch(t, /^note:/i);
        assert.doesNotMatch(t, /Vita C|Omega|Gluta|OMNIA|MGK/);
      }
    }
  }
});

test("dieta: integratori = parseDieta (nome, momento, orario, key); ore22 ha PS+ 18:30", () => {
  const parsed = parseDieta(dietaTxt);
  for (const v of diet().data.variants) {
    const p = parsed[v.key].integratori;
    assert.deepEqual(v.supplements.map((s) => [s.name, s.moment, s.time, s.key]),
      p.map((s) => [s.name, s.time, s.sortTime, s.type]));
    assert.ok(v.supplements.every((s, k) => s.id === `dp1/v${v.id.split("/v")[1]}/s${k}`));
  }
  const ps = variant("ore22").supplements.find((s) => s.name === "PS+");
  assert.equal(ps.time, "18:30");
  assert.equal(ps.key, "ps");
});

test("dieta: sezione senza blocco INTEGRATORI → nessun integratore (mai lista fissa)", () => {
  const txt = "---\n\n# GIORNO SENZA ALLENAMENTO\n\nCOLAZIONE:\n- 10g test\n";
  const v = dietPlanFromText(txt, { ...OPTS, id: "d" }).data.variants[0];
  assert.deepEqual(v.supplements, []);
  assert.equal(v.meals.length, 1);
});

test("dieta: alimenti esclusi assenti da options e choices", () => {
  const banned = ["pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"];
  const texts = [];
  for (const v of diet().data.variants) for (const m of v.meals) {
    m.options.forEach((o) => texts.push(o.text));
    m.lines.forEach((l) => l.choices.forEach((c) => texts.push(c)));
  }
  assert.ok(texts.length > 50);
  for (const t of texts) for (const b of banned) assert.ok(!t.toLowerCase().includes(b), `${b} in "${t}"`);
  // un'opzione esclusa nel testo viene scartata
  const x = dietPlanFromText("# GIORNO SENZA ALLENAMENTO\nCOLAZIONE (scegli 1):\n- Opzione 1: 50g pasta di ceci\n- Opzione 2: pane\nPRANZO:\nCarboidrato (scegli 1): pasta di piselli | riso\n", { ...OPTS, id: "x" });
  const m = x.data.variants[0].meals;
  assert.deepEqual(m[0].options.map((o) => o.text), ["pane"]);
  assert.deepEqual(m[1].lines[0].choices, ["riso"]);
});

test("id deterministici: due chiamate → JSON identico, tutti gli id unici", () => {
  assert.equal(JSON.stringify(workout()), JSON.stringify(workout()));
  assert.equal(JSON.stringify(diet()), JSON.stringify(diet()));
  const ids = [];
  const w = workout().data;
  w.days.forEach((d) => { ids.push(d.id); d.exercises.forEach((e) => ids.push(e.id)); });
  diet().data.variants.forEach((v) => {
    ids.push(v.id);
    v.supplements.forEach((s) => ids.push(s.id));
    v.meals.forEach((m) => { ids.push(m.id); m.options.forEach((o) => ids.push(o.id)); m.lines.forEach((l) => ids.push(l.id)); });
  });
  assert.equal(new Set(ids).size, ids.length);
});
