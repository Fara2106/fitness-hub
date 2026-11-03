// test/e2e/mock.mjs — backend per i test e2e: il Worker VERO (backend/src/worker.mjs)
// con un D1 in-process (node:sqlite + backend/schema.sql), servito alle pagine via
// page.route su https://fitness-hub-api.lorefara97.workers.dev/**. Un `backend`
// condiviso fra più context = più device sullo stesso cloud. Il proxy legacy
// (fitness-hub-proxy) resta finto SOLO per /groq (Coach fino alla fase 3).
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../backend/src/worker.mjs";
import { createD1 } from "../../backend/test/d1-sqlite.mjs";
import { workoutPlanFromText, dietPlanFromText } from "../../backend/migrate/plans.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const API = "https://fitness-hub-api.lorefara97.workers.dev";
export const PROXY = "https://fitness-hub-proxy.lorefara97.workers.dev";
export const TOKEN = "e2e0".repeat(16);          // 64 hex: token di test (mai un segreto vero)

// Risposta finta del Coach: SSE come Groq, con markdown da rendere.
const GROQ_SSE = [
  { delta: { content: "**Post-allenamento:** " } },
  { delta: { content: "riso e pollo.\n- Idratati" } },
].map(c => "data: " + JSON.stringify({ choices: [c] }) + "\n\n").join("") + "data: [DONE]\n\n";

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

// Nuovo backend vuoto. `delay` (ms) rallenta ogni risposta (per riprodurre le race);
// `down` = rete assente lato server (le richieste falliscono come offline).
export async function newBackend() {
  const DB = createD1();
  await DB.exec(await readFile(join(ROOT, "backend", "schema.sql"), "utf8"));
  return { env: { DB, SYNC_TOKEN: TOKEN, PRIMARY_OWNER: "owner-test" }, delay: 0, down: false, log: [] };
}

const parseRow = (r) => ({
  collection: r.collection, id: r.id, data: r.data == null ? null : JSON.parse(r.data),
  updatedAt: r.updated_at, deleted: !!r.deleted, deviceId: r.device_id, seq: r.seq,
});
// Record vivi (non tombstone) di una collezione, ordinati per id.
export async function records(backend, collection) {
  const { results } = await backend.env.DB.prepare(
    "SELECT * FROM records WHERE collection = ? AND deleted = 0 ORDER BY id").bind(collection).all();
  return results.map(parseRow);
}
export async function getRecord(backend, collection, id) {
  const row = await backend.env.DB.prepare("SELECT * FROM records WHERE collection = ? AND id = ?").bind(collection, id).first();
  return row ? parseRow(row) : null;
}
export async function backendSeq(backend) {
  return Number(await backend.env.DB.prepare("SELECT value FROM meta WHERE key = 'seq'").first("value"));
}

// Backend "già migrato": piani attivi dalla scheda.txt / dieta.txt del repo, scritti
// col protocollo vero (POST /v1/sync) come farebbe la migrazione della fase 1.
export async function seedPlans(backend) {
  const scheda = await readFile(join(ROOT, "scheda.txt"), "utf8");
  const dieta = await readFile(join(ROOT, "dieta.txt"), "utf8");
  const opts = { name: "Piano di partenza", validFrom: "2026-01-01" };
  const recs = [workoutPlanFromText(scheda, { ...opts, id: "workout-seed" }), dietPlanFromText(dieta, { ...opts, id: "diet-seed" })];
  const res = await worker.fetch(new Request(API + "/v1/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify({ deviceId: "seed", cursor: 0, changes: recs.map(r => ({ collection: r.collection, id: r.id, data: r.data, updatedAt: Date.now(), deleted: false })) }),
  }), backend.env);
  if (res.status !== 200) throw new Error("seedPlans: " + res.status + " " + await res.text());
}

// Intercetta il Worker v2 (backend vero) e il /groq del proxy legacy.
export async function installMock(ctx, backend, { origin } = {}) {
  await ctx.route(API + "/**", async (route) => {
    const req = route.request();
    if (backend.down) return route.abort("internetdisconnected");
    if (backend.delay) await new Promise(r => setTimeout(r, backend.delay));
    if (backend.down) return route.abort("internetdisconnected");
    const headers = { ...req.headers() };
    if (!headers.origin && origin) headers.origin = origin;
    const body = req.method() === "GET" || req.method() === "HEAD" ? undefined : req.postData() || "";
    const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers, body }), backend.env);
    const text = await res.text();
    backend.log.push(`${req.method()} ${new URL(req.url()).pathname} → ${res.status}`);
    return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: text });
  });
  await ctx.route(PROXY + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    const url = new URL(req.url());
    if (url.pathname !== "/groq") return route.fulfill({ status: 404, headers: H, body: "{}" });
    if (req.method() === "GET") return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ groq: true }) });
    const g = JSON.parse(req.postData() || "{}");
    if (g.stream) return route.fulfill({ status: 200, headers: { ...H, "Content-Type": "text/event-stream" }, body: GROQ_SSE });
    // Come Groq coi modelli che "ragionano": con un tetto di token piccolo
    // il ragionamento lo esaurisce e il testo arriva vuoto.
    const content = (g.max_tokens || 0) >= 256 ? "OK" : "";
    return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ choices: [{ message: { content }, finish_reason: content ? "stop" : "length" }] }) });
  });
  return backend;
}
