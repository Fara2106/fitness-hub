// test/e2e/run.mjs — test end-to-end in WebKit (motore di Safari) con
// backend finto. Lancio: `npm run test:e2e` (serve WebKit di Playwright:
// `npx playwright-core install webkit` la prima volta). Serve il repo in
// locale sotto /fitness-hub/ come GitHub Pages; nessuna chiamata al backend
// vero. Exit 0 = tutto verde; exit 1 = almeno un FAIL.
// Copre i bug trovati nella QA 2026-11-03: se uno torna, qui diventa rosso.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installMock, newState } from "./mock.mjs";

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
const URL0 = `http://localhost:${server.address().port}/fitness-hub/index.html`;

const TMP = await mkdtemp(join(tmpdir(), "lfh-e2e-"));
const browser = await webkit.launch();
const IPHONE = { ...devices["iPhone 15 Pro"], serviceWorkers: "block" };
const IPAD = { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: devices["iPad Pro 11"].userAgent, serviceWorkers: "block" };
const BASE_SETTINGS = { onboardingDone: "true", bodyWeight: "90" };

async function openApp(ctxOpts, state, mockOpts) {
  const ctx = await browser.newContext(ctxOpts);
  await installMock(ctx, state, mockOpts);
  const page = await ctx.newPage();
  page._errors = [];
  page.on("pageerror", e => page._errors.push(e.message));
  await page.goto(URL0);
  await page.waitForFunction(() => document.querySelector(".lfh-scroll"), null, { timeout: 15000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}
const nav = (page, label) => page.getByText(label, { exact: true }).last().click();
const store = (page, k) => page.evaluate(k => window.storage.get(k, null), k);

async function scenario(name, fn) {
  console.log("\n" + name);
  try { await fn(); } catch (e) { ok(name + " (eccezione)", false, e.message.split("\n")[0]); }
}

// ── 1. Player: sessione completa ────────────────────────────────────────────
await scenario("Player — sessione completa, salvataggio, duplicati", async () => {
  const st = newState(BASE_SETTINGS);
  const { ctx, page } = await openApp(IPHONE, st);
  await nav(page, "Scheda"); await page.waitForTimeout(600);
  const total = Number(await page.evaluate(() => (document.body.innerText.match(/\/(\d+) serie completate/) || [])[1]));
  await page.getByRole("button", { name: /Inizia allenamento/ }).click(); await page.waitForTimeout(400);

  // Overlay sopra la TabBar: al centro di "Serie fatta" c'è proprio il bottone.
  const onTop = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Serie fatta/.test(x.textContent));
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && b.contains(el);
  });
  ok("Player sopra la TabBar (bottone 'Serie fatta' cliccabile)", onTop);

  await page.locator("input.num").first().fill("42");
  for (let guard = 0; guard < 80; guard++) {
    if (await page.getByText("Sessione completata").count()) break;
    const salta = page.getByRole("button", { name: /^(Salta|Riprendi)$/ });
    if (await salta.count()) { await salta.first().click(); await page.waitForTimeout(120); continue; }
    const btn = page.getByRole("button", { name: /Serie fatta|Dopo/ });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(350); }
    else await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const pesi = st.log.filter(l => l.startsWith("POST savePeso"));
  ok(`tutte le ${total} serie inviate a Sheets (anche l'ultima)`, pesi.length === total, `inviate ${pesi.length}`);
  ok("peso digitato nel Player salvato sulla serie giusta", (pesi[0] || "").endsWith("#1=42"), pesi[0]);
  const sumSets = Number(await page.evaluate(() => (document.body.innerText.match(/esercizi · (\d+) serie/) || [])[1]));
  ok("riepilogo conta tutte le serie", sumSets === total, `riepilogo ${sumSets}`);
  await page.getByRole("button", { name: "Fatto" }).click(); await page.waitForTimeout(300);
  ok("lista allineata al peso del Player", (await page.locator('input[placeholder="kg o elastico"]').first().inputValue()) === "42");
  const before = st.log.length;
  await page.getByRole("button", { name: /Sessione completa|Chiudi sessione/ }).click(); await page.waitForTimeout(1200);
  ok("risalvataggio: nessuna riga duplicata su Sheets", !st.log.slice(before).some(l => l.startsWith("POST save")));
  ok("nessun errore JS", page._errors.length === 0, page._errors.join(" | "));
  await ctx.close();
});

// ── 2. Upload scheda/dieta ──────────────────────────────────────────────────
await scenario("Upload scheda/dieta", async () => {
  const repo = await readFile(join(ROOT, "scheda.txt"), "utf8");
  const NEW = "﻿" + repo.replace("Push-up (bodyweight)", "Panca IMPORTATA").replace(/\n/g, "\r\n");
  const schedaFile = join(TMP, "scheda-nuova.txt"); await writeFile(schedaFile, NEW);
  const badFile = join(TMP, "note.txt"); await writeFile(badFile, "comprare latte\nchiamare Marco\n");
  const dieta = (await readFile(join(ROOT, "dieta.txt"), "utf8")).split("200g frutta fresca (no macedonie)").join("150g yogurt IMPORTATO");
  const dietaFile = join(TMP, "dieta-nuova.txt"); await writeFile(dietaFile, dieta);

  // a) import + pull concorrente (sessione "a regime": dopo un reload)
  const st = newState({ ...BASE_SETTINGS, schedaData: repo });
  const { ctx, page } = await openApp(IPHONE, st, { postDelay: 2500 });
  await page.reload(); await page.waitForFunction(() => document.querySelector(".lfh-scroll"));
  await nav(page, "Setup"); await page.waitForTimeout(500);
  const before = await store(page, "schedaData");
  await page.locator("input[type=file]").nth(0).setInputFiles(badFile); await page.waitForTimeout(400);
  ok("file non valido rifiutato, scheda intatta", (await store(page, "schedaData")) === before);
  await page.locator("input[type=file]").nth(0).setInputFiles(schedaFile); await page.waitForTimeout(300);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1500);
  const after = (await store(page, "schedaData")) || "";
  ok("import sopravvive a un pull concorrente", after.includes("Panca IMPORTATA"));
  ok("BOM e a-capo Windows normalizzati", !after.startsWith("﻿") && !after.includes("\r"));
  await page.waitForTimeout(3000);
  ok("import arrivato nel cloud", (st.settings.schedaData || "").includes("Panca IMPORTATA"));
  await page.locator("input[type=file]").nth(1).setInputFiles(dietaFile); await page.waitForTimeout(3500);
  await nav(page, "Home"); await page.waitForTimeout(600);
  ok("dieta importata visibile in Home", (await page.evaluate(() => document.body.innerText)).includes("150g yogurt IMPORTATO"));
  await ctx.close();

  // b) device nuovo: il cloud ha l'import → non va sovrascritto dal .txt del repo
  const st2 = newState({ ...BASE_SETTINGS, schedaData: after });
  const d2 = await openApp(IPAD, st2);
  await d2.page.waitForTimeout(1500);
  ok("device nuovo riceve l'import dal cloud", ((await store(d2.page, "schedaData")) || "").includes("Panca IMPORTATA"));
  ok("device nuovo NON sovrascrive il cloud col .txt del repo", (st2.settings.schedaData || "").includes("Panca IMPORTATA"));
  await d2.ctx.close();
});

// ── 3. Unione tra device ────────────────────────────────────────────────────
await scenario("Spesa — spunte su due device nello stesso momento", async () => {
  const st = newState({ ...BASE_SETTINGS, spesaChecked2: "{}" });
  const A = await openApp(IPHONE, st, { postDelay: 800 });
  const B = await openApp(IPAD, st, { postDelay: 800 });
  await nav(A.page, "Spesa"); await nav(B.page, "Lista spesa");
  await A.page.waitForTimeout(600);
  await Promise.all([
    A.page.getByText("Petto di pollo", { exact: true }).click(),
    B.page.getByText("Salmone fresco", { exact: true }).click(),
  ]);
  await A.page.waitForTimeout(2500);
  // due giri di pull: il primo eventualmente ri-pusha la voce persa nella race
  for (let i = 0; i < 2; i++) {
    for (const d of [A, B]) await d.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await A.page.waitForTimeout(2500);
  }
  const cloud = JSON.parse(st.settings.spesaChecked2 || "{}");
  const ids = Object.keys(cloud).filter(k => cloud[k]);
  ok("il cloud contiene le spunte di entrambi i device", ids.length === 2, JSON.stringify(cloud));
  const la = await store(A.page, "spesaChecked"), lb = await store(B.page, "spesaChecked");
  ok("entrambi i device vedono entrambe le spunte",
    ids.length === 2 && ids.every(k => la && la[k] && lb && lb[k]), JSON.stringify({ la, lb }));
  await A.ctx.close(); await B.ctx.close();
});

// ── 4. Error boundary ───────────────────────────────────────────────────────
await scenario("Error boundary — una schermata rotta non porta giù l'app", async () => {
  const st = newState(BASE_SETTINGS);
  const { ctx, page } = await openApp(IPHONE, st);
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
  const st = newState(BASE_SETTINGS);
  const { ctx, page } = await openApp(IPHONE, st);
  await nav(page, "Setup"); await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector(".lfh-scroll").scrollTop = 600; });
  await nav(page, "Home"); await page.waitForTimeout(400);
  ok("cambio tab riparte dall'inizio della pagina", (await page.evaluate(() => document.querySelector(".lfh-scroll").scrollTop)) === 0);
  await nav(page, "Coach"); await page.waitForTimeout(800);
  const box = page.getByPlaceholder("Chiedi al coach…");
  await box.fill("Cosa mangio?"); await box.press("Enter");
  await page.waitForTimeout(1500);
  const bold = await page.locator("strong", { hasText: "Post-allenamento:" }).count();
  const txt = await page.evaluate(() => document.body.innerText);
  ok("risposta del Coach mostrata (via proxy /groq)", txt.includes("riso e pollo"));
  ok("markdown reso (grassetto, niente asterischi)", bold === 1 && !txt.includes("**"));
  ok("nessun errore JS", page._errors.length === 0, page._errors.join(" | "));
  await ctx.close();
});

await browser.close();
server.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
