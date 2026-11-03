import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, loadPlanConv } from "../migrate/load-parser.mjs";

const SERVER = fileURLToPath(new URL("../dev/local-server.mjs", import.meta.url));
const CLI = fileURLToPath(new URL("../migrate/add-shopping.mjs", import.meta.url));
const TOKEN = "tok-add-shopping-" + "q".repeat(40);

function startServer(args) {
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "", err = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/^ready (http:\/\/127\.0\.0\.1:\d+)$/m);
      if (m) resolve({ child, url: m[1] });
    });
    child.stderr.on("data", (d) => { err += d; });
    child.on("exit", (c) => reject(new Error(`local-server terminato (${c}): ${err}`)));
    setTimeout(() => reject(new Error("local-server non pronto")), 8000);
  });
}

async function pull(url, cursor = 0) {
  const res = await fetch(`${url}/v1/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "test", cursor, changes: [] }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

const runCli = (url, tokenFile, ...extra) => spawnSync(process.execPath, [CLI, "--api", url, "--token-file", tokenFile, ...extra], { encoding: "utf8" });

test("add-shopping: dry-run non scrive; --push scrive UN change con le altre chiavi intatte; rifiuta se già presente", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lfh-addshop-"));
  const { dietPlanFromText } = loadPlanConv();
  const dietTxt = readFileSync(join(REPO_ROOT, "dieta.txt"), "utf8");
  const diet = dietPlanFromText(dietTxt, { id: "diet-test", name: "Dieta test", validFrom: "2026-11-03" });
  const archived = dietPlanFromText(dietTxt, { id: "diet-old", name: "Vecchia", validFrom: "2026-01-01" });
  archived.data.status = "archived"; archived.data.validTo = "2026-11-03";
  const seed = join(dir, "seed.json");
  writeFileSync(seed, JSON.stringify([
    { collection: "dietPlan", id: "diet-old", data: archived.data, updatedAt: 1000 },
    { collection: "dietPlan", id: "diet-test", data: diet.data, updatedAt: 2000 },
    { collection: "settings", id: "lang", data: { value: "it" }, updatedAt: 1500 },
  ]));
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, TOKEN + "\n");
  const srv = await startServer(["--port", "0", "--token", TOKEN, "--seed", seed]);
  try {
    const before = await pull(srv.url);

    // Dry-run: conteggi, piano e validFrom; nessun token; nessuna scrittura.
    const dry = runCli(srv.url, tokenFile);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!(dry.stdout + dry.stderr).includes(TOKEN), "il token non va stampato");
    assert.match(dry.stdout, /diet-test/);
    assert.match(dry.stdout, /validFrom 2026-11-03/);
    assert.match(dry.stdout, /6 categorie, \d+ voci/);
    assert.match(dry.stdout, /Dry-run/);
    const afterDry = await pull(srv.url);
    assert.equal(afterDry.cursor, before.cursor, "il dry-run non ha scritto nulla");
    assert.equal(afterDry.changes.length, before.changes.length);

    // --push: un solo change, solo `shopping` in più, updatedAt > quello del record.
    const t0 = Date.now();
    const push = runCli(srv.url, tokenFile, "--push");
    assert.equal(push.status, 0, push.stdout + push.stderr);
    assert.ok(!(push.stdout + push.stderr).includes(TOKEN));
    const delta = await pull(srv.url, before.cursor);
    assert.equal(delta.changes.length, 1, "esattamente un change dopo il push");
    const c = delta.changes[0];
    assert.equal(c.collection, "dietPlan");
    assert.equal(c.id, "diet-test");
    assert.ok(c.updatedAt >= t0 - 1 && c.updatedAt > 2000);
    const { shopping, ...rest } = c.data;
    assert.equal(JSON.stringify(rest), JSON.stringify(diet.data), "le altre chiavi restano identiche (anche l'ordine)");
    assert.ok(Array.isArray(shopping) && shopping.length === 6);
    assert.equal(shopping[0].id, "proteine");
    assert.equal(shopping[0].icon, "flame");
    assert.equal(shopping[0].items[0].id, "proteine-0");
    assert.equal(shopping[0].items[0].name, "Petto di pollo");
    assert.equal(shopping[0].items[0].note, null);
    assert.equal(shopping[0].items[1].note, "🧊 compra fresco");
    const total = shopping.reduce((n, cat) => n + cat.items.length, 0);
    assert.match(push.stdout, new RegExp(`6 categorie, ${total} voci`));
    // Gli altri record non sono stati toccati.
    const all = await pull(srv.url);
    const old = all.changes.find((r) => r.id === "diet-old");
    assert.equal(JSON.stringify(old.data), JSON.stringify(archived.data));

    // Seconda volta: rifiuta (exit 1) e non scrive; con --force sostituisce.
    const again = runCli(srv.url, tokenFile, "--push");
    assert.equal(again.status, 1);
    assert.match(again.stdout, /già `shopping`/);
    assert.equal((await pull(srv.url, delta.cursor)).changes.length, 0);
    const forced = runCli(srv.url, tokenFile, "--push", "--force");
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    const d2 = await pull(srv.url, delta.cursor);
    assert.equal(d2.changes.length, 1);
    assert.ok(d2.changes[0].updatedAt > c.updatedAt, "updatedAt cresce sempre (max(now, updatedAt+1))");
  } finally {
    srv.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("add-shopping: senza piano dieta attivo non scrive nulla ed esce con 1", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lfh-addshop-"));
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, TOKEN);
  const srv = await startServer(["--port", "0", "--token", TOKEN]);
  try {
    const r = runCli(srv.url, tokenFile, "--push");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Nessun piano dieta attivo/);
    assert.equal((await pull(srv.url)).changes.length, 0);
  } finally {
    srv.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
