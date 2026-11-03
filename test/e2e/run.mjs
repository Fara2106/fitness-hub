// test/e2e/run.mjs — test end-to-end in WebKit (motore di Safari) sul backend VERO
// in-process: il Worker fitness-hub-api (backend/src/worker.mjs) con un D1 su
// node:sqlite, intercettato con page.route (vedi mock.mjs). Ogni scenario crea un
// backend nuovo; più context WebKit sullo stesso backend = più device. Lancio:
// `npm run test:e2e` (serve WebKit di Playwright: `npx playwright-core install webkit`
// la prima volta). Serve il repo in locale sotto /fitness-hub/ come GitHub Pages;
// solo /groq del proxy legacy è finto. Exit 0 = tutto verde; exit 1 = almeno un FAIL.
// `E2E_ONLY=<regex>` lancia solo gli scenari il cui nome corrisponde.
// Copre i bug della QA 2026-11-03 e i modi di rompersi del sync v2 (palestra offline,
// race fra device, pull durante la modifica, piano cambiato in giornata).
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installMock, newBackend, seedPlans, records, getRecord, backendSeq, TOKEN } from "./mock.mjs";

const require = createRequire(import.meta.url);
const { webkit, devices } = require("playwright-core");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.error("  FAIL " + name + (extra ? " — " + extra : "")); }
}

// ── Server statico: /fitness-hub/* → repo ───────────────────────────────────
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!path.startsWith("/fitness-hub/")) { res.writeHead(404); return res.end(); }
  let rel = path.slice("/fitness-hub/".length) || "index.html";
  if (rel.includes("..")) { res.writeHead(403); return res.end(); }
  try {
    const buf = await readFile(join(ROOT, rel));
    res.writeHead(200, { "Content-Type": TYPES[extname(rel)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  } catch (_) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://localhost:${server.address().port}`;
const URL0 = `${ORIGIN}/fitness-hub/index.html`;

const TMP = await mkdtemp(join(tmpdir(), "lfh-e2e-"));
const browser = await webkit.launch();
const IPHONE = { ...devices["iPhone 15 Pro"], serviceWorkers: "block" };
const IPAD = { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices["iPad Pro 11"].userAgent, serviceWorkers: "block" };
// Come un device già in uso: onboarding fatto + peso di profilo.
const SEED_FIRST = { onboardingDone: true, bodyWeight: 90 };
const SEED_NEW = { onboardingDone: true };

const ready = (page) => page.waitForFunction(() => document.querySelector(".lfh-scroll"), null, { timeout: 15000 });

// Apre l'app come un device vero: link `#sync=<token>` (consumato dall'app, che poi
// ripulisce l'URL) → primo sync → storage seminato (onboarding, peso) → reload.
// link:false = device mai collegato. Ritorna { ctx, page }.
async function openApp(ctxOpts, backend, { link = true, seed = SEED_NEW } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  await installMock(ctx, backend, { origin: ORIGIN });
  const page = await ctx.newPage();
  page._errors = [];
  page._desk = ctxOpts === IPAD;
  page.on("pageerror", e => page._errors.push(e.message));
  await page.goto(link ? URL0 + "#sync=" + TOKEN : URL0);
  await ready(page).catch(() => page.waitForSelector("body"));
  await page.evaluate(seed => { for (const k of Object.keys(seed)) window.storage.set(k, seed[k]); }, seed);
  await page.waitForTimeout(250);
  await page.reload();
  await ready(page);
  if (link) await sync(page);
  await page.waitForTimeout(500);
  return { ctx, page };
}
// Voci di navigazione con i nomi della TabBar (iPhone); sulla Sidebar (iPad) hanno altri nomi.
const SIDEBAR = { Home: "Dashboard", Scheda: "Allenamento", Spesa: "Lista spesa", "Lista spesa": "Lista spesa", Coach: "AI Coach", Setup: "Impostazioni" };
const nav = (page, label) => page.getByText(page._desk ? (SIDEBAR[label] || label) : label, { exact: true }).last().click();
const store = (page, k) => page.evaluate(k => window.storage.get(k, null), k);
const sync = (page) => page.evaluate(() => window.SyncV2.syncNow());
const today = (page) => page.evaluate(() => window.todayKey());
const pending = (page) => page.evaluate(() => window.SyncV2.status().pending);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Aspetta (max 15 s) che un predicato asincrono diventi vero; ritorna l'ultimo valore.
async function until(fn, timeout = 15000) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (_) {}
    if (v || Date.now() - t0 > timeout) return v;
    await sleep(150);
  }
}
const setLogs = async (backend, date) => (await records(backend, "setLog")).filter(r => r.data.date === date);

async function scenario(name, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY, "i").test(name)) return;
  console.log("\n" + name);
  try { await fn(); } catch (e) { ok(name + " (eccezione)", false, (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); }
}

// Gioca una sessione completa dal Player: peso 42 sulla prima serie, poi tutte le serie fatte
// (salta i timer di recupero). Ritorna il numero di serie del giorno.
async function playSession(page, onStart) {
  await nav(page, "Scheda"); await page.waitForTimeout(600);
  const total = Number(await page.evaluate(() => (document.body.innerText.match(/\/(\d+) serie completate/) || [])[1]));
  await page.getByRole("button", { name: /Inizia allenamento/ }).click(); await page.waitForTimeout(400);
  if (onStart) await onStart();
  await page.locator("input.num").first().fill("42");
  for (let guard = 0; guard < 80; guard++) {
    if (await page.getByText("Sessione completata").count()) break;
    const salta = page.getByRole("button", { name: /^(Salta|Riprendi)$/ });
    if (await salta.count()) { await salta.first().click(); await page.waitForTimeout(120); continue; }
    const btn = page.getByRole("button", { name: /Serie fatta|Dopo/ });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(350); }
    else await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1000);
  return total;
}
// Dal riepilogo di fine sessione alla lista, poi "Sessione completa" (scrive la sessione).
async function closeSession(page) {
  await page.getByRole("button", { name: "Fatto" }).click(); await page.waitForTimeout(300);
  await page.getByRole("button", { name: /Sessione completa|Chiudi sessione/ }).click(); await page.waitForTimeout(1000);
}
// Spunta le prime `n` serie del giorno dalla lista della Scheda (salta il timer).
async function tickSets(page, n) {
  for (let k = 0; k < n; k++) {
    await page.locator(".card.lift").first().locator("button.check").nth(k).click(); await page.waitForTimeout(250);
    const sk = page.getByRole("button", { name: /^(Salta|Riprendi)$/ }); if (await sk.count()) await sk.first().click();
    await page.waitForTimeout(150);
  }
}
// Registro dello Storico (Setup → Storico → Registro): testo della pagina.
async function registroText(page) {
  if (!page._desk) { await nav(page, "Setup"); await page.waitForTimeout(400); }
  await page.getByText("Storico", { exact: true }).last().click(); await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Registro/ }).click(); await page.waitForTimeout(500);
  return bodyText(page);
}

// ── 1. Player: sessione completa ────────────────────────────────────────────
await scenario("Player — sessione completa, salvataggio, duplicati", async () => {
  const be = await newBackend(); await seedPlans(be);
  const { ctx, page } = await openApp(IPHONE, be, { seed: SEED_FIRST });
  // Overlay sopra la TabBar: al centro di "Serie fatta" c'è proprio il bottone.
  const onTop = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Serie fatta/.test(x.textContent));
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && b.contains(el);
  }).then(v => ok("Player sopra la TabBar (bottone 'Serie fatta' cliccabile)", v));
  const total = await playSession(page, onTop);
  const d = await today(page);
  await sync(page);
  const sets = await setLogs(be, d);
  const done = sets.filter(r => r.data.done);
  ok(`tutte le ${total} serie sul backend (anche l'ultima), una volta sola`, done.length === total && sets.length === total, `done ${done.length}, record ${sets.length}`);
  ok("serie legate agli esercizi del piano attivo (nessun name:<…>)", sets.every(r => r.data.planId === "workout-seed" && !r.data.exerciseId.startsWith("name:")), JSON.stringify(sets.slice(0, 1)));
  const sess = (await records(be, "workoutSession")).find(r => r.data.date === d);
  const plan = (await getRecord(be, "workoutPlan", "workout-seed")).data;
  const day = plan.days.find(x => sess && x.id === sess.data.dayId);
  const first = day && (await getRecord(be, "setLog", `${d}:${day.exercises[0].id}:0`));
  ok("peso digitato nel Player salvato sulla serie giusta (prima serie, primo esercizio)", first && first.data.weight === "42" && first.data.done === true, JSON.stringify(first && first.data));
  const sumSets = Number(await page.evaluate(() => (document.body.innerText.match(/esercizi · (\d+) serie/) || [])[1]));
  ok("riepilogo conta tutte le serie", sumSets === total, `riepilogo ${sumSets}`);
  await page.getByRole("button", { name: "Fatto" }).click(); await page.waitForTimeout(300);
  ok("lista allineata al peso del Player", (await page.locator('input[placeholder="kg o elastico"]').first().inputValue()) === "42");
  await sync(page);
  const maxSetSeq = async () => Math.max(...(await setLogs(be, d)).map(r => r.seq));
  const seq0 = await maxSetSeq();
  await page.getByRole("button", { name: /Sessione completa|Chiudi sessione/ }).click(); await page.waitForTimeout(1200);
  await sync(page);
  ok("sessione chiusa sul backend", (await records(be, "workoutSession")).some(r => r.data.date === d && r.data.done === true));
  ok("risalvataggio alla chiusura: nessuna serie duplicata né riscritta sul backend", (await setLogs(be, d)).length === total && (await maxSetSeq()) === seq0, `seq ${seq0}→${await maxSetSeq()}`);
  ok("niente in coda a fine sessione", (await pending(page)) === 0);
  ok("nessun errore JS", page._errors.length === 0, page._errors.join(" | "));
  await ctx.close();
});

// ── 1b. Palestra offline ────────────────────────────────────────────────────
await scenario("Player offline — 12/12 serie senza rete, poi online", async () => {
  const be = await newBackend(); await seedPlans(be);
  const A = await openApp(IPHONE, be, { seed: SEED_FIRST });
  const B = await openApp(IPAD, be);
  const d = await today(A.page);

  await A.ctx.setOffline(true);
  const total = await playSession(A.page);
  await closeSession(A.page);
  ok("serie fatte offline: nulla sul backend, tutto in coda", (await setLogs(be, d)).length === 0 && (await pending(A.page)) > 0, `in coda ${await pending(A.page)}`);
  const off = await sync(A.page);
  ok("sync offline non perde la coda", !off.ok && (await pending(A.page)) > 0, JSON.stringify(off));

  // Intanto l'altro device (online) spunta la spesa.
  await nav(B.page, "Spesa"); await B.page.waitForTimeout(500);
  await B.page.getByText("Salmone fresco", { exact: true }).click();
  await sync(B.page);
  ok("B (online) ha mandato la spunta della spesa", (await records(be, "shoppingCheck")).length === 1);

  await A.ctx.setOffline(false);
  const on = await sync(A.page);
  ok("tornata la rete: sync ok", on.ok === true, JSON.stringify(on));
  const sets = await setLogs(be, d);
  ok(`arrivano tutte le ${total} serie, una volta sola`, sets.filter(r => r.data.done).length === total && sets.length === total, `done ${sets.filter(r => r.data.done).length}, record ${sets.length}`);
  ok("sessione chiusa arrivata", (await records(be, "workoutSession")).some(r => r.data.date === d && r.data.done));
  ok("coda vuota", (await pending(A.page)) === 0);
  ok("il sync di A non ha cancellato la spunta di B", (await records(be, "shoppingCheck")).filter(r => r.data.checked).length === 1);

  await sync(B.page);
  const reg = await registroText(B.page);
  ok(`Storico sull'altro device: ${total}/${total} serie nel Registro`, new RegExp(`${total}/${total}\\s+serie`).test(reg), (reg.match(/\d+\/\d+\s+serie|\d+ serie/g) || []).join(","));
  await sync(A.page);
  const la = await store(A.page, "spesaChecked");
  ok("A vede la spunta di B (si tengono entrambe le cose)", la && Object.values(la).filter(Boolean).length === 1);
  ok("nessun errore JS", A.page._errors.length === 0 && B.page._errors.length === 0, [...A.page._errors, ...B.page._errors].join(" | "));
  await A.ctx.close(); await B.ctx.close();
});

// ── 2. Upload scheda/dieta ──────────────────────────────────────────────────
await scenario("Upload scheda/dieta", async () => {
  const repo = await readFile(join(ROOT, "scheda.txt"), "utf8");
  const NEW = "﻿" + repo.replace("Push-up (bodyweight)", "Panca IMPORTATA").replace(/\n/g, "\r\n");
  const schedaFile = join(TMP, "scheda-nuova.txt"); await writeFile(schedaFile, NEW);
  const badFile = join(TMP, "note.txt"); await writeFile(badFile, "comprare latte\nchiamare Marco\n");
  const dieta = (await readFile(join(ROOT, "dieta.txt"), "utf8")).split("200g frutta fresca (no macedonie)").join("150g yogurt IMPORTATO");
  const dietaFile = join(TMP, "dieta-nuova.txt"); await writeFile(dietaFile, dieta);

  // a) import + pull concorrente (backend lento: il pull è in volo mentre si importa)
  const be = await newBackend(); await seedPlans(be);
  const { ctx, page } = await openApp(IPHONE, be, { seed: SEED_FIRST });
  be.delay = 1500;
  await nav(page, "Setup"); await page.waitForTimeout(500);
  const planStr = async () => JSON.stringify(await store(page, "plan_workout"));
  const before = await planStr();
  await page.locator("input[type=file]").nth(0).setInputFiles(badFile); await page.waitForTimeout(400);
  ok("file non valido rifiutato, scheda intatta", (await planStr()) === before && (await records(be, "workoutPlan")).length === 1);
  await page.evaluate(() => { window.SyncV2.syncNow(); });          // pull in volo
  await page.locator("input[type=file]").nth(0).setInputFiles(schedaFile); await page.waitForTimeout(300);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(3500);
  const after = await planStr();
  ok("import sopravvive a un pull concorrente", after.includes("Panca IMPORTATA"));
  ok("BOM e a-capo Windows normalizzati", after.includes("Panca IMPORTATA") && !after.includes("\\r") && !after.includes("\\ufeff"));
  be.delay = 0;
  await sync(page);
  const wp = await records(be, "workoutPlan");
  const act = wp.filter(r => r.data.status === "active");
  ok("import arrivato sul backend: un solo piano attivo, il precedente archiviato",
    wp.length === 2 && act.length === 1 && JSON.stringify(act[0].data).includes("Panca IMPORTATA") && wp.some(r => r.id === "workout-seed" && r.data.status === "archived"),
    wp.map(r => r.id + ":" + r.data.status).join(","));
  await page.locator("input[type=file]").nth(1).setInputFiles(dietaFile); await page.waitForTimeout(1500);
  await sync(page);
  const dp = await records(be, "dietPlan");
  ok("dieta importata sul backend (attiva) e precedente archiviata",
    dp.filter(r => r.data.status === "active").length === 1 && JSON.stringify(dp.find(r => r.data.status === "active").data).includes("150g yogurt IMPORTATO") && dp.some(r => r.id === "diet-seed" && r.data.status === "archived"));
  // "Prossimo pasto" dipende dall'ora: orologio fisso alle 10:30 (spuntino) per renderlo deterministico.
  const noon = new Date(); noon.setHours(10, 30, 0, 0);
  await ctx.clock.setFixedTime(noon);
  await nav(page, "Home"); await page.waitForTimeout(700);
  ok("dieta importata visibile in Home", (await bodyText(page)).includes("150g yogurt IMPORTATO"));
  await ctx.close();

  // b) device nuovo: il backend ha l'import → lo riceve e NON lo sovrascrive col .txt del repo
  const seqBefore = await backendSeq(be);
  const d2 = await openApp(IPAD, be);
  await d2.page.waitForTimeout(800);
  ok("device nuovo riceve l'import dal backend", JSON.stringify(await store(d2.page, "plan_workout")).includes("Panca IMPORTATA"));
  ok("device nuovo NON sovrascrive il backend col .txt del repo",
    (await records(be, "workoutPlan")).length === 2 &&
    JSON.stringify((await records(be, "workoutPlan")).find(r => r.data.status === "active").data).includes("Panca IMPORTATA"));
  ok("device nuovo senza dati propri: niente da inviare", (await backendSeq(be)) === seqBefore, `seq ${seqBefore}→${await backendSeq(be)}`);
  await d2.ctx.close();
});

// ── 2b. Cambio piano in giornata ────────────────────────────────────────────
await scenario("Cambio scheda e dieta in giornata", async () => {
  const days = [["UPPER A", [["Panca piana manubri", 4], ["Rematore", 4], ["Military press", 3]]],
                ["LOWER A", [["Squat", 4], ["Affondi", 3]]], ["UPPER B", [["Trazioni", 4]]], ["LOWER B", [["Stacco rumeno", 4]]]];
  const scheda4 = days.map(([n, exs], i) => `# ${n} - Giorno ${i + 1}\n# Focus: Test\n\nEsercizio | Serie | Rip | Recupero | Note tecniche\n` +
    exs.map(([e, k]) => `${e} | ${k} | 8 | 90 | nota\n`).join("")).join("\n---\n\n");
  const schedaFile = join(TMP, "scheda-4g.txt"); await writeFile(schedaFile, scheda4);
  // dieta con SOLO riposo + ore 17
  const lines = (await readFile(join(ROOT, "dieta.txt"), "utf8")).split("\n"); const keep = []; let skip = false;
  for (const l of lines) {
    if (/^# ALLENAMENTO (MATTINA|ORE 21|ORE 22)/.test(l)) skip = true;
    else if (/^# ALLENAMENTO ORE 17|^# NOTE GENERALI/.test(l)) skip = false;
    if (!skip) keep.push(l);
  }
  const dietaFile = join(TMP, "dieta-2v.txt");
  await writeFile(dietaFile, keep.join("\n").split("200g frutta fresca (no macedonie)").join("170g yogurt NUOVO")
    .split("(2ª assunzione)\n").join("(2ª assunzione), Magnesio 300mg\n"));

  const be = await newBackend(); await seedPlans(be);
  const { ctx, page } = await openApp(IPHONE, be, { seed: SEED_FIRST });
  const d = await today(page);
  await nav(page, "Scheda"); await page.waitForTimeout(500);
  await tickSets(page, 2);
  ok("prima del cambio: 2 serie spuntate", /2\/12 serie completate/.test(await bodyText(page)));
  await sync(page);
  ok("le 2 serie sono sul backend", (await setLogs(be, d)).filter(r => r.data.done).length === 2);
  await nav(page, "Setup"); await page.waitForTimeout(400);
  await page.locator("input[type=file]").nth(0).setInputFiles(schedaFile); await page.waitForTimeout(600);
  await nav(page, "Scheda"); await page.waitForTimeout(600);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.innerText).filter(t => /^G\d/.test(t)).length);
  ok("nuova scheda: 4 giorni", tabs === 4, String(tabs));
  const txt = await bodyText(page);
  ok("le spunte di oggi NON passano al nuovo esercizio", /UPPER A/.test(txt) && /0\/11 serie completate/.test(txt), (txt.match(/\d+\/\d+ serie completate/) || [])[0]);
  await sync(page);
  const done = (await setLogs(be, d)).filter(r => r.data.done);
  ok("sul backend le 2 serie restano quelle di prima (piano precedente, leggibili per nome), nessuna sul nuovo piano",
    done.length === 2 && done.every(r => r.data.planId === "workout-seed" && r.data.exerciseName), JSON.stringify(done.map(r => [r.data.planId, r.data.exerciseName])));
  await nav(page, "Setup"); await page.waitForTimeout(400);
  await page.locator("input[type=file]").nth(1).setInputFiles(dietaFile); await page.waitForTimeout(600);
  await nav(page, "Dieta"); await page.waitForTimeout(600);
  await page.locator("button", { hasText: /Mattina$/ }).first().click(); await page.waitForTimeout(400);
  const dd = await bodyText(page);
  ok("variante assente → pasti del piano importato (non quelli preimpostati)", dd.includes("170g yogurt NUOVO"));
  ok("variante assente → avviso con la variante usata", /non ha questa variante: mostro «Ore 17»/.test(dd));
  ok("integratori letti dal file (Magnesio aggiunto nel piano)", dd.includes("Magnesio 300mg"));
  ok("nessun errore JS", page._errors.length === 0, page._errors.join(" | "));
  await ctx.close();
});

// ── 3. Spesa: due device nello stesso momento ──────────────────────────────
await scenario("Spesa — spunte su due device nello stesso momento", async () => {
  const be = await newBackend();
  const A = await openApp(IPHONE, be, { seed: SEED_FIRST });
  const B = await openApp(IPAD, be);
  be.delay = 800;
  await nav(A.page, "Spesa"); await nav(B.page, "Spesa");
  await A.page.waitForTimeout(600);
  await Promise.all([
    A.page.getByText("Petto di pollo", { exact: true }).click(),
    B.page.getByText("Salmone fresco", { exact: true }).click(),
  ]);
  // Entrambi i sync partono insieme (race), poi due giri di pull.
  await Promise.all([sync(A.page), sync(B.page)]);
  for (let i = 0; i < 2; i++) { await sync(A.page); await sync(B.page); }
  be.delay = 0;
  const cloud = (await records(be, "shoppingCheck")).filter(r => r.data.checked).map(r => r.id);
  ok("il backend contiene le spunte di entrambi i device", cloud.length === 2, JSON.stringify(cloud));
  const la = await store(A.page, "spesaChecked"), lb = await store(B.page, "spesaChecked");
  ok("entrambi i device vedono entrambe le spunte",
    cloud.length === 2 && cloud.every(k => la && la[k] && lb && lb[k]), JSON.stringify({ la, lb }));
  // E nella UI dell'altro device, non solo nello storage.
  const ui = async (p) => p.evaluate(() => [...document.querySelectorAll("button.check.on, .check.on")].length);
  ok("la UI di A mostra le 2 spunte", (await ui(A.page)) >= 2, String(await ui(A.page)));
  await A.ctx.close(); await B.ctx.close();
});

// ── 3b. Dieta: variante ore21 e spunte propagate ───────────────────────────
await scenario("Dieta — variante Ore 21 e spunte su un altro device", async () => {
  const be = await newBackend(); await seedPlans(be);
  const A = await openApp(IPHONE, be, { seed: SEED_FIRST });
  const B = await openApp(IPAD, be);
  const d = await today(A.page);
  await nav(A.page, "Dieta"); await A.page.waitForTimeout(600);
  if (!(await A.page.locator(".ios-toggle.blue.on").count())) { await A.page.locator(".ios-toggle.blue").first().click(); await A.page.waitForTimeout(300); }
  await A.page.getByRole("button", { name: /Ore 21/ }).click(); await A.page.waitForTimeout(300);
  await A.page.locator('button[aria-label="Pasto fatto"]').nth(0).click(); await A.page.waitForTimeout(200);
  await A.page.locator('button[aria-label="Pasto fatto"]').nth(2).click(); await A.page.waitForTimeout(200);
  await A.page.locator("button", { hasText: "💊" }).first().click(); await A.page.waitForTimeout(300);
  await sync(A.page);
  const dv = await getRecord(be, "dayState", `${d}:dietVariant`);
  ok("backend: variante del giorno = ore21", dv && dv.data.value === "ore21", JSON.stringify(dv && dv.data));
  ok("backend: 2 pasti e 1 integratore spuntati", (await records(be, "mealCheck")).filter(r => r.data.done).length === 2 && (await records(be, "supplementCheck")).filter(r => r.data.done).length === 1);

  await sync(B.page);
  await nav(B.page, "Dieta"); await B.page.waitForTimeout(700);
  const snap = (p) => p.evaluate(() => ({
    meals: [...document.querySelectorAll('button[aria-label="Pasto fatto"]')].map(b => (b.parentElement.firstChild.innerText || "").replace(/\s+/g, " ").trim() + (b.classList.contains("on") ? " ✓" : "")),
    supps: [...document.querySelectorAll("button")].filter(b => b.textContent.includes("💊")).map(b => b.textContent.replace(/\s+/g, " ").trim() + (/line-through/.test(getComputedStyle(b.querySelector("div > div")).textDecorationLine) ? " ✓" : "")),
    ore21: (() => { const b = [...document.querySelectorAll("button")].find(x => /Ore 21$/.test(x.textContent.trim())); return b ? getComputedStyle(b).fontWeight : null; })(),
  }));
  const sa = await snap(A.page), sb = await snap(B.page);
  ok("B salva la variante ore21 del giorno", (await store(B.page, `dietaVariant_${d}`)) === "ore21");
  ok("B mostra Ore 21 selezionata", sb.ore21 === "600" || sb.ore21 === "bold", String(sb.ore21));
  ok("B mostra gli stessi pasti, con le stesse spunte", sb.meals.length > 0 && JSON.stringify(sb.meals) === JSON.stringify(sa.meals) && sb.meals.filter(x => x.endsWith("✓")).length === 2, JSON.stringify(sb.meals));
  ok("B mostra lo stesso integratore spuntato", sb.supps.length > 0 && JSON.stringify(sb.supps) === JSON.stringify(sa.supps) && sb.supps.filter(x => x.endsWith("✓")).length === 1, JSON.stringify(sb.supps));
  ok("nessun errore JS", A.page._errors.length === 0 && B.page._errors.length === 0, [...A.page._errors, ...B.page._errors].join(" | "));
  await A.ctx.close(); await B.ctx.close();
});

// ── 3c. Import con giorno rinominato: spunte di B ai posti giusti ──────────
await scenario("Piano cambiato su A — le spunte di oggi su B restano sugli esercizi giusti", async () => {
  const repo = await readFile(join(ROOT, "scheda.txt"), "utf8");
  const renamed = repo.replace("# PUSH - Giorno 1", "# SPINTA RINNOVATA - Giorno 1").replace("# PULL - Giorno 2", "# TIRATA RINNOVATA - Giorno 2")
    .replace(/# LEGS \+ CORE \(mantenimento\) - Giorno 3/, "# GAMBE RINNOVATE - Giorno 3");
  const file = join(TMP, "scheda-rinominata.txt"); await writeFile(file, renamed);
  const be = await newBackend(); await seedPlans(be);
  const A = await openApp(IPHONE, be, { seed: SEED_FIRST });
  const B = await openApp(IPAD, be);
  const d = await today(A.page);
  await nav(B.page, "Scheda"); await B.page.waitForTimeout(500);
  await tickSets(B.page, 2);
  await sync(B.page);
  const beforeSets = (await setLogs(be, d)).filter(r => r.data.done);
  const names = beforeSets.map(r => r.data.exerciseName).sort();
  ok("B: 2 serie spuntate e sul backend", beforeSets.length === 2);

  await nav(A.page, "Setup"); await A.page.waitForTimeout(400);
  await A.page.locator("input[type=file]").nth(0).setInputFiles(file); await A.page.waitForTimeout(800);
  await sync(A.page);
  const wp = await records(be, "workoutPlan");
  ok("A: nuovo piano attivo sul backend (giorni rinominati)", wp.some(r => r.data.status === "active" && r.data.days.map(x => x.name).join("|").includes("SPINTA RINNOVATA")));

  await sync(B.page);
  await nav(B.page, "Scheda"); await B.page.waitForTimeout(700);
  const txt = await bodyText(B.page);
  ok("B mostra il nuovo nome del giorno", /(SPINTA|TIRATA|GAMBE) RINNOVAT/.test(txt) && !/\bPUSH\b/.test(txt.replace(/Push-up/gi, "")), (txt.match(/[A-Z ]+RINNOVAT\w*/) || [])[0]);
  ok("le spunte di oggi su B restano: stesso conteggio, stesse serie", /2\/12 serie completate/.test(txt), (txt.match(/\d+\/\d+ serie completate/) || [])[0]);
  const ticked = await B.page.evaluate(() => [...document.querySelectorAll(".card.lift")].flatMap(c => [...c.querySelectorAll("button.check.on")].map(() => (c.querySelector(".ex-name, h3, [class*=title]") || c).innerText.split("\n")[0])));
  ok("le spunte sono ancora sul primo esercizio (stesse posizioni di prima)", ticked.length === 2, JSON.stringify(ticked));
  await sync(B.page); await sync(A.page);
  const after = (await setLogs(be, d)).filter(r => r.data.done);
  ok("backend: nessuna serie duplicata né spostata (stessi esercizi per nome)", after.length === 2 && JSON.stringify(after.map(r => r.data.exerciseName).sort()) === JSON.stringify(names), JSON.stringify(after.map(r => [r.data.planId, r.data.exerciseName])));

  await nav(B.page, "Setup"); await B.page.waitForTimeout(500);
  const arch = B.page.getByText(/Piani archiviati \(1\)/);
  ok("Impostazioni → Piani elenca il piano precedente come archiviato", (await arch.count()) === 1);
  await arch.first().click(); await B.page.waitForTimeout(300);
  ok("…con il suo nome", (await bodyText(B.page)).includes("Piano di partenza"));
  ok("nessun errore JS", A.page._errors.length === 0 && B.page._errors.length === 0, [...A.page._errors, ...B.page._errors].join(" | "));
  await A.ctx.close(); await B.ctx.close();
});

// ── 3d. Pull durante la modifica ───────────────────────────────────────────
await scenario("Pull durante la modifica — il peso digitato non cambia", async () => {
  const be = await newBackend(); await seedPlans(be);
  const A = await openApp(IPHONE, be, { seed: SEED_FIRST });
  const B = await openApp(IPAD, be);
  const d = await today(A.page);
  const W = 'input[placeholder="kg o elastico"]';
  await nav(A.page, "Scheda"); await nav(B.page, "Scheda");
  await A.page.waitForTimeout(500);
  await A.page.locator(W).first().fill("50");
  await A.page.waitForTimeout(300);
  await sync(A.page);
  ok("A: peso 50 sul backend", (await setLogs(be, d)).some(r => r.data.weight === "50"));

  // B comincia un sync (il pull con il 50 di A è in volo) e intanto digita 60.
  be.delay = 1500;
  const inFlight = sync(B.page);
  await B.page.waitForTimeout(300);
  await B.page.locator(W).first().fill("60");
  await inFlight;
  be.delay = 0;
  ok("il pull arrivato NON cancella il 60 digitato (campo)", (await B.page.locator(W).first().inputValue()) === "60", await B.page.locator(W).first().inputValue());
  ok("…né il valore salvato sul device", JSON.stringify(await store(B.page, `schedaProg_${d}`)).includes('"60"'));
  await sync(B.page); await sync(A.page);
  const ws = await setLogs(be, d);
  ok("la modifica di B arriva sul backend (e sostituisce il 50)", ws.some(r => r.data.weight === "60") && !ws.some(r => r.data.weight === "50"), JSON.stringify(ws.map(r => r.data.weight)));
  ok("A riceve il 60", (await A.page.locator(W).first().inputValue()) === "60", await A.page.locator(W).first().inputValue());
  ok("nessun errore JS", A.page._errors.length === 0 && B.page._errors.length === 0, [...A.page._errors, ...B.page._errors].join(" | "));
  await A.ctx.close(); await B.ctx.close();
});

// ── 3e. Peso corporeo: dalla Home al backend e all'altro device ────────────
await scenario("Peso — registrazione e sync tra device", async () => {
  const be = await newBackend();
  const A = await openApp(IPHONE, be, { seed: SEED_FIRST });
  await A.page.getByText("Peso", { exact: true }).first().click(); await A.page.waitForTimeout(400);
  await A.page.getByPlaceholder("Aggiorna…").fill("88.4");
  await A.page.getByRole("button", { name: "Salva" }).click(); await A.page.waitForTimeout(800);
  const d = await today(A.page);
  await sync(A.page);
  const bw = await getRecord(be, "bodyWeight", d);
  ok("peso di oggi sul backend (bodyWeight)", bw && bw.data.kg === 88.4 && bw.data.date === d, JSON.stringify(bw && bw.data));
  const st = await getRecord(be, "settings", "bodyWeight");
  ok("peso di profilo aggiornato (settings.bodyWeight)", st && Number(st.data.value) === 88.4, JSON.stringify(st && st.data));
  const B = await openApp(IPAD, be);
  await B.page.waitForTimeout(500);
  const wl = (await store(B.page, "weightLog")) || [];
  ok("l'altro device riceve lo storico peso", wl.some(e => e.date === d && e.weight === 88.4), JSON.stringify(wl));
  ok("l'altro device mostra il peso aggiornato", Number(await store(B.page, "bodyWeight")) === 88.4);
  ok("…anche nella Home", (await bodyText(B.page)).includes("88.4") || (await bodyText(B.page)).includes("88,4"));
  await A.ctx.close(); await B.ctx.close();
});

// ── 3f. Collegamento: link #sync= e device non collegato ───────────────────
await scenario("Collegamento — device non collegato e link #sync=", async () => {
  const be = await newBackend(); await seedPlans(be);
  const C = await openApp(IPHONE, be, { link: false, seed: SEED_FIRST });
  const badge = () => C.page.locator('.pill[title]').evaluateAll(els => els.map(e => e.getAttribute("title")));
  ok("senza token l'app funziona e il badge dice «Non collegato»", (await badge()).includes("Non collegato"), JSON.stringify(await badge()));
  ok("senza token: niente chiamate al backend", !be.log.some(l => l.includes("/v1/sync")), be.log.join(","));
  await nav(C.page, "Spesa"); await C.page.waitForTimeout(500);
  await C.page.getByText("Petto di pollo", { exact: true }).click(); await C.page.waitForTimeout(500);
  const r0 = await sync(C.page);
  // Mai collegato: niente coda (il primo sync porta al server i dati solo-locali), la spunta resta sul device.
  const sc0 = await store(C.page, "spesaChecked");
  ok("senza token la spunta resta sul device e il sync dice «non collegato»", r0.error === "unlinked" && sc0 && sc0["proteine-0"] === true && (await records(be, "shoppingCheck")).length === 0, JSON.stringify([r0, sc0]));
  await nav(C.page, "Scheda"); await C.page.waitForTimeout(500);
  ok("senza token: la Scheda mostra il piano di riserva", /\d+\/\d+ serie completate/.test(await bodyText(C.page)));
  await nav(C.page, "Setup"); await C.page.waitForTimeout(400);
  ok("Impostazioni: «Device non collegato»", (await bodyText(C.page)).includes("Device non collegato"));

  // Link con token SBAGLIATO (64 hex ma non quello del server): rifiutato, resta non collegato.
  const bad = await C.ctx.newPage();
  bad._errors = []; bad.on("pageerror", e => bad._errors.push(e.message));
  await C.page.close();
  await bad.goto(URL0 + "#sync=" + "ab".repeat(32));
  await ready(bad); await bad.waitForTimeout(1500);
  ok("link con token sbagliato: hash ripulito, token non salvato", (await bad.evaluate(() => location.hash)) === "" && (await store(bad, "syncToken")) == null);
  // Link giusto.
  await bad.goto(URL0 + "?l=1#sync=" + TOKEN);
  await ready(bad);
  ok("link giusto: l'hash sparisce dall'URL", await until(() => bad.evaluate(() => location.hash === "")));
  ok("…il token è salvato sul device", (await store(bad, "syncToken")) === TOKEN);
  ok("…la coda arriva sul backend", await until(async () => (await records(be, "shoppingCheck")).filter(r => r.data.checked).length === 1));
  ok("…e il badge non dice più «Non collegato»", await until(async () => !(await bad.locator(".pill[title]").evaluateAll(els => els.map(e => e.getAttribute("title")))).includes("Non collegato")));
  ok("…coda vuota", await until(async () => (await pending(bad)) === 0));
  ok("nessun errore JS", bad._errors.length === 0 && C.page._errors.length === 0, [...bad._errors, ...C.page._errors].join(" | "));
  await C.ctx.close();
});

// ── 4. Error boundary ───────────────────────────────────────────────────────
await scenario("Error boundary — una schermata rotta non porta giù l'app", async () => {
  const be = await newBackend();
  const { ctx, page } = await openApp(IPHONE, be, { seed: SEED_FIRST });
  await page.evaluate(() => { window.Dieta = () => { throw new Error("boom-test"); }; });
  await nav(page, "Dieta"); await page.waitForTimeout(600);
  ok("card di errore al posto della schermata", (await page.getByText("Qualcosa è andato storto qui").count()) === 1);
  ok("TabBar ancora presente", (await page.getByText("Spesa", { exact: true }).count()) > 0);
  const log = (await store(page, "errorLog")) || [];
  ok("errore registrato in Diagnostica", log.some(e => /boom-test/.test(e.msg)), JSON.stringify(log.slice(-1)));
  await page.getByRole("button", { name: "Torna alla Home" }).click(); await page.waitForTimeout(500);
  ok("'Torna alla Home' funziona", (await page.getByText("Inizia allenamento").count()) > 0);
  await ctx.close();
});

// ── 5. Coach (Groq finto) + UI varie ────────────────────────────────────────
await scenario("Coach e UI", async () => {
  const be = await newBackend();
  const { ctx, page } = await openApp(IPHONE, be, { seed: SEED_FIRST });
  await nav(page, "Setup"); await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector(".lfh-scroll").scrollTop = 600; });
  await nav(page, "Home"); await page.waitForTimeout(400);
  ok("cambio tab riparte dall'inizio della pagina", (await page.evaluate(() => document.querySelector(".lfh-scroll").scrollTop)) === 0);
  await nav(page, "Coach"); await page.waitForTimeout(800);
  const box = page.getByPlaceholder("Chiedi al coach…");
  await box.fill("Cosa mangio?"); await box.press("Enter");
  await page.waitForTimeout(1500);
  const bold = await page.locator("strong", { hasText: "Post-allenamento:" }).count();
  const txt = await bodyText(page);
  ok("risposta del Coach mostrata (via proxy /groq)", txt.includes("riso e pollo"));
  ok("markdown reso (grassetto, niente asterischi)", bold === 1 && !txt.includes("**"));
  const conn = await page.evaluate(() => window.groqAPI.testConnection().then(r => r.reply, e => "ERR " + e.message));
  ok("'Testa connessione' non torna vuoto (tetto token per modelli che ragionano)", conn === "OK", conn);
  await sync(page);
  ok("la chat del Coach si sincronizza (coachMessage sul backend)", (await records(be, "coachMessage")).length >= 2, String((await records(be, "coachMessage")).length));
  ok("nessun errore JS", page._errors.length === 0, page._errors.join(" | "));
  await ctx.close();
});

await browser.close();
server.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
