// CLI: aggiunge la lista della spesa (`shopping`) al dietPlan ATTIVO sul server (Task 8, fase 3).
// La lista oggi è scritta nel codice della PWA (CATEGORIES in screens/spesa.jsx): qui la si porta nel
// piano, con gli id degli item = le chiavi di spunta di sempre (`proteine-0`…), così le spunte
// `shoppingCheck` esistenti restano valide. Dry-run di default: legge e basta, non scrive nulla.
//   node migrate/add-shopping.mjs --api <url> --token-file <path> [--push] [--force]
// - legge il piano attivo con un pull completo su POST /v1/sync (Bearer);
// - nuovo `data` = data esistente + `shopping` (le altre chiavi restano com'erano);
// - --push manda UN change con updatedAt = max(Date.now(), record.updatedAt + 1);
// - se il piano ha già `shopping` rifiuta (exit 1), salvo --force. Il token non viene mai stampato.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadShoppingTools } from "./load-parser.mjs";

const DEVICE_ID = "add-shopping";
const MAX_RECORD_BYTES = 60 * 1024; // il server rifiuta oltre 64 KB; teniamo margine

async function post(fetchFn, api, token, body) {
  const res = await fetchFn(`${String(api).replace(/\/+$/, "")}/v1/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* corpo non JSON */ }
  if (!res.ok) throw new Error(`sync: HTTP ${res.status}${json && json.error ? ` — ${json.error}` : ""}`);
  if (!json) throw new Error("sync: risposta non JSON");
  return json;
}

// Pull completo dal cursore 0: record vivi più recenti per collezione/id. Ritorna anche il cursore finale.
async function pullAll(fetchFn, api, token) {
  const byKey = new Map();
  let cursor = 0, last = 0;
  for (;;) {
    const r = await post(fetchFn, api, token, { deviceId: DEVICE_ID, cursor, changes: [] });
    for (const c of r.changes) byKey.set(`${c.collection}/${c.id}`, c);
    last = Number.isSafeInteger(r.cursor) ? r.cursor : last;
    if (!r.more) return { records: [...byKey.values()], cursor: last };
    if (!(r.cursor > cursor)) throw new Error("sync: il cursor non avanza durante il pull");
    cursor = r.cursor;
  }
}

export async function runAddShopping(opts = {}) {
  const { fetch: fetchFn = globalThis.fetch, api, token, push = false, force = false, now = () => Date.now(), tools = loadShoppingTools() } = opts;
  const out = opts.log || (() => {});
  const log = (s) => out(token ? String(s).split(token).join("***") : s);
  const result = { ok: false, pushed: false };
  try {
    if (!api || !token) throw new Error("--api e --token-file sono obbligatori");
    const shopping = tools.shoppingFromCategories(tools.categories);
    const items = shopping.reduce((n, c) => n + c.items.length, 0);
    result.categories = shopping.length; result.items = items;

    const { records, cursor } = await pullAll(fetchFn, api, token);
    const active = tools.activePlan(records, "dietPlan");
    if (!active) { log("Nessun piano dieta attivo sul server: niente da fare."); return result; }
    const rec = records.find((r) => r.collection === "dietPlan" && r.id === active.id);
    result.planId = active.id; result.validFrom = active.data.validFrom || null;
    log(`Piano dieta attivo: ${active.id} (validFrom ${active.data.validFrom || "?"})`);
    log(`Lista da aggiungere: ${shopping.length} categorie, ${items} voci (id ${shopping[0].items[0].id} … ${shopping[shopping.length - 1].items.slice(-1)[0].id})`);

    if (active.data.shopping !== undefined && !force) {
      log("Il piano attivo ha già `shopping`: rifiuto (usa --force per sostituirla).");
      result.refused = true;
      return result;
    }
    const data = { ...active.data, shopping };
    const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
    if (bytes > MAX_RECORD_BYTES) throw new Error(`il piano con la spesa supera il limite (${bytes} byte)`);
    if (!push) {
      log("Dry-run: non è stato scritto nulla. Rilancia con --push per applicare.");
      result.ok = true;
      return result;
    }
    const updatedAt = Math.max(now(), (rec.updatedAt || 0) + 1);
    const r = await post(fetchFn, api, token, {
      deviceId: DEVICE_ID, cursor, changes: [{ collection: "dietPlan", id: active.id, data, updatedAt }],
    });
    log(`Push: applied ${r.applied}, stale ${r.stale}`);
    if (r.applied !== 1) throw new Error("il server non ha applicato la modifica (stale)");
    // Verifica in sola lettura: il piano sul server ha `shopping`.
    const after = await pullAll(fetchFn, api, token);
    const a2 = tools.activePlan(after.records, "dietPlan");
    const okShop = !!(a2 && a2.id === active.id && JSON.stringify(a2.data.shopping) === JSON.stringify(shopping));
    log(okShop ? "Verifica: il piano attivo sul server ha la lista della spesa." : "Verifica FALLITA: la lista non risulta sul server.");
    result.pushed = true; result.ok = okShop;
    return result;
  } catch (e) {
    if (token && e && typeof e.message === "string") e.message = e.message.split(token).join("***");
    throw e;
  }
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { api: { type: "string" }, "token-file": { type: "string" }, push: { type: "boolean", default: false }, force: { type: "boolean", default: false } },
  });
  let token;
  if (values["token-file"]) {
    token = readFileSync(values["token-file"], "utf8").trim();
    if (!token) throw new Error("il file del token è vuoto");
  }
  const r = await runAddShopping({ api: values.api, token, push: values.push, force: values.force, log: (s) => console.log(s) });
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`Errore: ${e.message}`); process.exitCode = 2; },
  );
}
