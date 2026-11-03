// CLI di migrazione: dati vecchi (foglio Google via Worker legacy, SOLO GET, + backup JSON della PWA)
// → record del nuovo backend di sync. Senza --push è un dry-run: non scrive nulla da nessuna parte.
//   node migrate/migrate.mjs --api <url> --token-file <path> [--backup <file.json>] [--push] [--verify] [--sheet <legacyUrl>]
// Idempotente: `now` è mezzogiorno locale del giorno di migrazione e deviceId è fisso, quindi
// rilanciare la migrazione lo stesso giorno produce change identici → tutti `stale`.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./load-parser.mjs";
import { workoutPlanFromText, dietPlanFromText } from "./plans.mjs";
import { recordsFromSheet, recordsFromBackup, mergeChanges, sanitizeChanges } from "./records.mjs";

export const LEGACY_SHEET_URL = "https://fitness-hub-proxy.lorefara97.workers.dev";
const LEGACY_ORIGIN = "https://fara2106.github.io";
const DEVICE_ID = "migration";
// Lotti del push: al massimo 500 change E 1,5 MB di JSON per richiesta (il Worker rifiuta oltre 2 MB).
export const BATCH_MAX_CHANGES = 500;
export const BATCH_MAX_BYTES = 1.5 * 1024 * 1024;
// Righe massime che il Worker legacy restituisce (google-apps-script.gs): con esattamente
// questo numero di righe lo storico più vecchio potrebbe essere rimasto fuori.
const LEGACY_LIMITS = { checkIn: 30, pesoCorporeo: 90, pesiPerEsercizio: 12 };
const MAX_DIFFS = 20;
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pad = (n) => String(n).padStart(2, "0");

// Mezzogiorno locale del giorno di `ms` (Ruling 13).
export function noonOf(ms = Date.now()) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
}

function planMeta(now) {
  const d = new Date(now);
  const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return { ym, label, validFrom: `${ym}-${pad(d.getDate())}` };
}

// ── lettura del foglio (solo GET, come sheetsAPI.get di api.jsx) ─────────────
async function sheetGet(fetchFn, sheetUrl, action) {
  const url = new URL(sheetUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("_cb", String(Date.now()));
  const res = await fetchFn(url.toString(), { method: "GET", headers: { Origin: LEGACY_ORIGIN }, cache: "no-store" });
  if (!res.ok) throw new Error(`foglio ${action}: HTTP ${res.status}`);
  const json = await res.json();
  if (json && json.success === false) throw new Error(`foglio ${action}: ${json.error || "errore del backend"}`);
  return json;
}

// google-apps-script.gs: getCheckIn/getPesoCorporeo → array; getPesi/getSettings → oggetto piatto.
async function readSheet(fetchFn, sheetUrl) {
  const [checkIn, pesoCorporeo, pesi, settings] = await Promise.all(
    ["getCheckIn", "getPesoCorporeo", "getPesi", "getSettings"].map((a) => sheetGet(fetchFn, sheetUrl, a)),
  );
  return { checkIn, pesoCorporeo, pesi, settings };
}

// ── piani ───────────────────────────────────────────────────────────────────
function buildPlan(kind, sheetText, repoRoot, now, log) {
  const { ym, label, validFrom } = planMeta(now);
  const isWorkout = kind === "workout";
  const noun = isWorkout ? "scheda" : "dieta";
  const make = isWorkout ? workoutPlanFromText : dietPlanFromText;
  const meta = { id: `${isWorkout ? "workout" : "diet"}-${ym}`, name: `${isWorkout ? "Scheda" : "Dieta"} ${label}`, validFrom };
  let source = "foglio";
  let plan = null;
  if (typeof sheetText === "string" && sheetText.trim() !== "") {
    try {
      plan = make(sheetText, meta);
      const items = isWorkout ? plan.data.days : plan.data.variants;
      if (!items.length) { plan = null; log(`  attenzione: ${noun} del foglio senza contenuto, uso il file del repo`); }
    } catch (e) {
      plan = null;
      log(`  attenzione: ${noun} del foglio non leggibile (${e.message}), uso il file del repo`);
    }
  }
  if (!plan) {
    source = isWorkout ? "scheda.txt del repo" : "dieta.txt del repo";
    plan = make(readFileSync(`${repoRoot}/${isWorkout ? "scheda" : "dieta"}.txt`, "utf8"), meta);
  }
  return { plan, source };
}

function planSummary(workout, diet) {
  const days = workout.data.days;
  const variants = diet.data.variants;
  return {
    workout: { days: days.length, exercises: days.reduce((n, d) => n + d.exercises.length, 0) },
    diet: {
      variants: variants.length,
      meals: variants.reduce((n, v) => n + v.meals.length, 0),
      supplements: variants.reduce((n, v) => n + v.supplements.length, 0),
    },
  };
}

// ── backup PWA ──────────────────────────────────────────────────────────────
function parseBackup(backupJson) {
  if (backupJson == null) return null;
  let b = backupJson;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { throw new Error("backup non valido: il file non è JSON"); }
  }
  if (!isObj(b) || b._lfhBackup !== 1 || !isObj(b.data)) {
    throw new Error("backup non valido: atteso un export di Impostazioni → Backup (_lfhBackup: 1 e data oggetto)");
  }
  return b;
}

// ── storico troncato dal foglio (M3) ─────────────────────────────────────────
function truncationWarnings(sheet) {
  const out = [];
  if (Array.isArray(sheet.checkIn) && sheet.checkIn.length === LEGACY_LIMITS.checkIn) {
    out.push(`check-in: ${LEGACY_LIMITS.checkIn} righe (il massimo che il foglio restituisce)`);
  }
  if (Array.isArray(sheet.pesoCorporeo) && sheet.pesoCorporeo.length === LEGACY_LIMITS.pesoCorporeo) {
    out.push(`peso corporeo: ${LEGACY_LIMITS.pesoCorporeo} righe (il massimo che il foglio restituisce)`);
  }
  for (const [name, rows] of Object.entries(isObj(sheet.pesi) ? sheet.pesi : {})) {
    if (Array.isArray(rows) && rows.length === LEGACY_LIMITS.pesiPerEsercizio) {
      out.push(`serie di "${name}": ${LEGACY_LIMITS.pesiPerEsercizio} righe (il massimo per esercizio)`);
    }
  }
  return out;
}

// ── conteggi ────────────────────────────────────────────────────────────────
function countByCollection(changes) {
  const out = {};
  for (const c of changes) {
    const e = (out[c.collection] ||= { live: 0, tombstones: 0 });
    if (c.deleted) e.tombstones++; else e.live++;
  }
  return out;
}

// ── API nuova ───────────────────────────────────────────────────────────────
function makeApi({ fetchFn, api, token }) {
  const url = `${String(api).replace(/\/+$/, "")}/v1/sync`;
  return async function post(body) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* corpo non JSON */ }
    if (!res.ok) throw new Error(`sync: HTTP ${res.status}${json && json.error ? ` — ${json.error}` : ""}`);
    if (!json) throw new Error("sync: risposta non JSON");
    return json;
  };
}

const utf8Bytes = (s) => Buffer.byteLength(s, "utf8");
// Margine per l'involucro { deviceId, cursor, changes: [...] } attorno ai change.
const ENVELOPE_BYTES = 256;

// Divide i change in lotti di al massimo maxChanges change e maxBytes byte di JSON per richiesta.
export function makeBatches(changes, { maxChanges = BATCH_MAX_CHANGES, maxBytes = BATCH_MAX_BYTES } = {}) {
  const batches = [];
  let cur = [], bytes = ENVELOPE_BYTES;
  for (const c of changes) {
    const size = utf8Bytes(JSON.stringify(c)) + 1; // + la virgola
    if (cur.length && (cur.length >= maxChanges || bytes + size > maxBytes)) {
      batches.push(cur);
      cur = []; bytes = ENVELOPE_BYTES;
    }
    cur.push(c); bytes += size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function pushAll(post, changes, log) {
  let applied = 0, stale = 0, cursor = 0;
  const batches = makeBatches(changes);
  for (const [i, batch] of batches.entries()) {
    const r = await post({ deviceId: DEVICE_ID, cursor, changes: batch });
    applied += r.applied; stale += r.stale;
    cursor = Number.isSafeInteger(r.cursor) ? r.cursor : cursor;
    log(`  lotto ${i + 1}/${batches.length}: ${batch.length} inviati, applied ${r.applied}, stale ${r.stale}`);
  }
  return { sent: changes.length, applied, stale, batches: batches.length };
}

const keyOf = (c) => `${c.collection}/${c.id}`;

// Pull completo dal cursore 0: collection/id → record vivo o tombstone.
async function pullLive(post) {
  const live = new Map();
  let cursor = 0;
  for (;;) {
    const r = await post({ deviceId: DEVICE_ID, cursor, changes: [] });
    for (const c of r.changes) live.set(keyOf(c), c);
    if (!r.more) return live;
    if (!(r.cursor > cursor)) throw new Error("sync: il cursor non avanza durante il pull");
    cursor = r.cursor;
  }
}

// Ogni record atteso deve esistere sul server con lo stesso stato (vivo/tombstone) e lo stesso data.
function contentDiffs(expected, live) {
  const diffs = [];
  for (const c of expected) {
    const got = live.get(keyOf(c));
    if (!got) { diffs.push({ key: keyOf(c), problem: "manca sul server" }); continue; }
    if (!!got.deleted !== !!c.deleted) {
      diffs.push({ key: keyOf(c), problem: got.deleted ? "eliminato sul server" : "vivo sul server, atteso eliminato" });
      continue;
    }
    if (JSON.stringify(got.data ?? null) !== JSON.stringify(c.data ?? null)) diffs.push({ key: keyOf(c), problem: "contenuto diverso" });
  }
  return diffs;
}

// ── orchestrazione ──────────────────────────────────────────────────────────
export async function runMigration(opts = {}) {
  try {
    return await migrate(opts);
  } catch (e) {
    // Nemmeno un messaggio d'errore deve poter contenere il token.
    if (opts.token && e && typeof e.message === "string") e.message = e.message.split(opts.token).join("***");
    throw e;
  }
}

async function migrate(opts) {
  const {
    fetch: fetchFn = globalThis.fetch, api, token, backupJson = null, push = false, verify = false,
    sheetUrl = LEGACY_SHEET_URL, repoRoot = REPO_ROOT,
  } = opts;
  const now = opts.now ?? noonOf();
  // Il token non deve MAI comparire nei log, nemmeno dentro un messaggio d'errore.
  const out = opts.log || (() => {});
  const log = (s) => out(token ? String(s).split(token).join("***") : s);

  if ((push || verify) && (!api || !token)) throw new Error("--api e --token-file sono obbligatori con --push/--verify");
  const backup = parseBackup(backupJson); // prima di toccare qualsiasi cosa

  log(`Migrazione ${push ? "(--push)" : "dry-run"}: now = ${new Date(now).toISOString()}`);
  const sheet = await readSheet(fetchFn, sheetUrl);
  log("Foglio letto (solo GET).");

  const s = isObj(sheet.settings) ? sheet.settings : {};
  const w = buildPlan("workout", s.schedaData, repoRoot, now, log);
  const d = buildPlan("diet", s.dietaData, repoRoot, now, log);
  const plans = { workout: w.plan, diet: d.plan };
  const planSource = { workout: w.source, diet: d.source };
  const summary = planSummary(w.plan, d.plan);
  const planRecords = [w.plan, d.plan].map((p) => ({ ...p, updatedAt: now }));

  const stats = {};
  const sheetRecords = recordsFromSheet(sheet, plans, { now, stats });
  const backupRecords = backup ? recordsFromBackup(backup, plans, stats, { now }) : [];
  const changes = sanitizeChanges(mergeChanges(planRecords, sheetRecords, backupRecords), stats);
  const counts = countByCollection(changes);
  const truncation = truncationWarnings(sheet);

  log(`Piani: scheda da ${planSource.workout} (${summary.workout.days} giorni, ${summary.workout.exercises} esercizi); `
    + `dieta da ${planSource.diet} (${summary.diet.variants} varianti, ${summary.diet.meals} pasti, ${summary.diet.supplements} integratori)`);
  log(`Record da migrare: ${changes.length}`);
  for (const [col, c] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    log(`  ${col}: ${c.live} vivi${c.tombstones ? `, ${c.tombstones} tombstone` : ""}`);
  }
  log(`Scartati: ${JSON.stringify(stats.discarded)}`);
  if (stats.invalidSamples.length) log(`  esempi non validi: ${stats.invalidSamples.join(", ")}`);
  if (stats.discarded.setLogPositional) {
    log(`Serie scartate perché la scheda è stata reimportata dopo quel giorno (schedaProg_ senza nomi): ${stats.discarded.setLogPositional}`);
  }
  if (stats.positional.count) {
    log(`Serie mappate per posizione nella scheda attuale (schedaProg_ senza nomi): ${stats.positional.count}, `
      + `dal ${stats.positional.from} al ${stats.positional.to}`);
  }
  if (Object.keys(stats.ignoredKeys).length) log(`Chiavi del backup ignorate: ${JSON.stringify(stats.ignoredKeys)}`);
  for (const w of truncation) log(`  attenzione — possibile storico troncato: ${w}`);

  const result = {
    ok: true, counts, total: changes.length, stats, planSource, plans: summary, truncation, changes, push: null, verify: null,
  };
  if (!push && !verify) { log("Dry-run: nessuna scrittura."); return result; }

  const post = makeApi({ fetchFn, api, token });
  if (push) {
    log(`Push verso ${api} ...`);
    result.push = await pushAll(post, changes, log);
    log(`Push completato: applied ${result.push.applied}, stale ${result.push.stale}`);
  }
  if (verify) {
    log("Verifica (pull completo dal cursor 0) ...");
    const live = await pullLive(post);
    const liveCounts = {};
    for (const c of live.values()) if (!c.deleted) liveCounts[c.collection] = (liveCounts[c.collection] || 0) + 1;
    const rows = [];
    for (const col of [...new Set([...Object.keys(counts), ...Object.keys(liveCounts)])].sort()) {
      const expected = counts[col] ? counts[col].live : 0;
      const actual = liveCounts[col] || 0;
      rows.push({ collection: col, expected, actual, ok: expected === actual });
      log(`  ${expected === actual ? "✔" : "✘"} ${col}: atteso ${expected}, sul server ${actual}`);
    }
    const diffs = contentDiffs(changes, live);
    for (const d of diffs.slice(0, MAX_DIFFS)) log(`  ✘ ${d.key}: ${d.problem}`);
    if (diffs.length > MAX_DIFFS) log(`  ... e altre ${diffs.length - MAX_DIFFS} differenze`);
    result.verify = { ok: rows.every((r) => r.ok) && diffs.length === 0, rows, diffs };
    result.ok = result.verify.ok;
    log(result.ok ? "Verifica OK." : `Verifica FALLITA: ${diffs.length ? `${diffs.length} record diversi dall'atteso` : "i conteggi non coincidono"}.`);
  }
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      api: { type: "string" }, "token-file": { type: "string" }, backup: { type: "string" },
      sheet: { type: "string" }, push: { type: "boolean", default: false }, verify: { type: "boolean", default: false },
    },
  });
  let token;
  if (values["token-file"]) {
    token = readFileSync(values["token-file"], "utf8").trim();
    if (!token) throw new Error("il file del token è vuoto");
  }
  let backupJson = null;
  if (values.backup) backupJson = readFileSync(values.backup, "utf8");
  const r = await runMigration({
    api: values.api, token, backupJson, push: values.push, verify: values.verify,
    sheetUrl: values.sheet || LEGACY_SHEET_URL, log: (s) => console.log(s),
  });
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`Errore: ${e.message}`); process.exitCode = 2; },
  );
}
