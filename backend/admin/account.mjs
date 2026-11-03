#!/usr/bin/env node
// Gestione degli account di fitness-hub-api (solo dal Mac di chi amministra).
//
//   node backend/admin/account.mjs create         --email <e> --owner <ownerId> (--local <db.sqlite> | --remote)
//   node backend/admin/account.mjs reset-password --email <e>                 (--local <db.sqlite> | --remote)
//   node backend/admin/account.mjs sessions       --email <e>                 (--local <db.sqlite> | --remote)
//   node backend/admin/account.mjs revoke         --email <e> [--session <prefisso id>] (--local … | --remote)
//   node backend/admin/account.mjs login          --email <e> --api <url> [--device-name <n>] [--out <file>]
//   node backend/admin/account.mjs init-pepper    [--pepper-file <file>]
//
// La password si legge SOLO dal terminale, senza eco (due volte per create/reset-password, devono coincidere,
// almeno 10 caratteri). Non si accetta come argomento né da variabili d'ambiente e non viene mai stampata.
// L'hash si calcola qui col pepper del Worker (secret PASSWORD_PEPPER), letto da ~/.config/fitness-hub/pepper
// (permessi 600 obbligatori; `init-pepper` lo crea e dice come caricarlo con wrangler). Il pepper non si stampa mai.
// --remote: gli statement con hash/salt vanno a wrangler come FILE (mode 600 in una cartella temporanea, cancellato
// subito dopo), mai negli argomenti; le sole letture/revoche senza segreti passano da --command. Mai stampati.
// --local: un file SQLite (test e sviluppo; lo schema si crea se manca).
// login: POST /v1/auth/login su --api e scrive il token di sessione in ~/.config/fitness-hub/session (600).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, realpathSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { hashPassword, passwordProblem, normalizeEmail, isValidEmail, pepperBytes, toHex, randomBytes } from "../src/auth.mjs";

const BACKEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_NAME = "fitness-hub-db";
const OWNER_RE = /^[A-Za-z0-9-]{1,64}$/;
const USAGE = `uso:
  account.mjs create         --email <e> --owner <ownerId> (--local <db> | --remote)
  account.mjs reset-password --email <e> (--local <db> | --remote)
  account.mjs sessions       --email <e> (--local <db> | --remote)
  account.mjs revoke         --email <e> [--session <prefisso>] (--local <db> | --remote)
  account.mjs login          --email <e> --api <url> [--device-name <nome>] [--out <file>]
  account.mjs init-pepper    [--pepper-file <file>]
Opzione comune: --pepper-file <file> (default ~/.config/fitness-hub/pepper, permessi 600).
La password si digita nel terminale (senza eco): mai come argomento o variabile d'ambiente.`;

class UsageError extends Error {}
class Failure extends Error {}

// --- SQL --------------------------------------------------------------------------------------------

const lit = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(Math.trunc(v)) : `'${String(v).replace(/'/g, "''")}'`);

// Argomenti di `npx` per il runner remoto (nessuna shell). `{ file }` per gli statement con segreti (hash, salt),
// `{ command }` solo per letture e revoche senza segreti.
export function remoteArgs({ file, command }) {
  const base = ["wrangler", "d1", "execute", DB_NAME, "--remote", "--json", "--yes"];
  return file ? [...base, "--file", file] : [...base, "--command", command];
}

// Toglie da un testo d'errore SQL e valori lunghi in esadecimale (hash, salt) prima di stamparlo.
const redact = (text, sql) => String(text || "").split(sql).join("[sql]").replace(/[0-9a-f]{32,}/gi, "[…]").slice(0, 2000);

// SQL in un file 600 dentro una cartella temporanea 700 (mkdtemp); file e cartella si cancellano sempre.
export async function withSqlFile(sql, fn) {
  const dir = mkdtempSync(join(tmpdir(), "lfh-sql-"));
  chmodSync(dir, 0o700);
  const file = join(dir, "q.sql");
  try {
    writeFileSync(file, "", { mode: 0o600 });
    chmodSync(file, 0o600);
    writeFileSync(file, sql);
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `lenient`: per le scritture via --file (API di import di wrangler) basta l'exit code 0, anche se l'output
// non è il JSON delle query (non servono risultati).
function runWrangler(args, sql, { lenient = false } = {}) {
  const r = spawnSync("npx", args, { cwd: BACKEND_DIR, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  if (lenient && r.status === 0 && !Array.isArray(parsed)) return { ok: true, results: [], changes: 0 };
  if (r.status !== 0 || !Array.isArray(parsed)) {
    const msg = parsed && parsed.error ? JSON.stringify(parsed.error) : `${r.stdout || ""}\n${r.stderr || ""}`;
    return { ok: false, error: `wrangler non riuscito (exit ${r.status}): ${redact(msg, sql)}` };
  }
  const results = parsed.flatMap((p) => p.results || []);
  const changes = parsed.reduce((n, p) => n + ((p.meta && p.meta.changes) || 0), 0);
  return { ok: parsed.every((p) => p.success !== false), results, changes };
}

function defaultRunRemote(sql, { secret = false } = {}) {
  if (secret) return withSqlFile(sql, (file) => runWrangler(remoteArgs({ file }), sql, { lenient: true }));
  return runWrangler(remoteArgs({ command: sql }), sql);
}

// Destinazione: stessa interfaccia per --local e --remote; `run(statements)` esegue gli statement in ordine
// (in un'unica transazione / un unico invio a wrangler) → { results (dell'ultima SELECT), changes }.
// `secret: true` = gli statement contengono hash/salt (remoto: via file, mai negli argomenti).
async function openTarget(values, io) {
  if (values.local && values.remote) throw new UsageError("usa --local oppure --remote, non entrambi");
  if (values.remote) {
    const runRemote = io.runRemote || defaultRunRemote;
    return {
      async run(statements, { secret = false } = {}) {
        const sql = statements.join(";\n");
        const r = await runRemote(sql, { secret });
        if (!r.ok) throw new Failure(r.error || "esecuzione remota non riuscita");
        return { results: r.results || [], changes: r.changes || 0 };
      },
      close() {},
    };
  }
  if (values.local) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(values.local);
    db.exec(readFileSync(join(BACKEND_DIR, "schema.sql"), "utf8"));
    return {
      async run(statements) {
        let results = [];
        let changes = 0;
        db.exec("BEGIN");
        try {
          for (const sql of statements) {
            const st = db.prepare(sql);
            if (st.columns().length) results = st.all().map((r) => ({ ...r }));
            else changes += st.run().changes;
          }
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw new Failure(redact(e.message, statements.join(";")));
        }
        return { results, changes };
      },
      close() { db.close(); },
    };
  }
  throw new UsageError("serve --local <file> oppure --remote");
}

// --- lettura della password ----------------------------------------------------------------------------

// Un blocco di input dal terminale in modalità raw → { buf, done?, error? }. Invio chiude; Ctrl-C / Ctrl-D (a vuoto)
// annullano; Backspace/Canc cancellano; ogni altro carattere di controllo (Tab, Esc/frecce, …) è RIFIUTATO con un
// messaggio, non scartato in silenzio (la password salvata sarebbe diversa da quella che si crede di aver digitato).
export function feedSecret(buf, chunk) {
  for (const ch of String(chunk)) {
    if (ch === "\r" || ch === "\n") return { buf, done: true };
    if (ch === "\u0003" || (ch === "\u0004" && !buf)) return { buf, error: "annullato" };
    if (ch === "\u007f" || ch === "\b") { buf = buf.slice(0, -1); continue; }
    if (ch < " " || (ch >= "\u0080" && ch <= "\u009f")) {
      const name = ch === "\t" ? "Tab" : ch === "\u001b" ? "Esc o un tasto freccia" : `U+${ch.codePointAt(0).toString(16).padStart(4, "0").toUpperCase()}`;
      return { buf, error: `carattere di controllo non ammesso nella password (${name}): riprova` };
    }
    buf += ch;
  }
  return { buf };
}

// Terminale: modalità raw, nessuna eco. Test harness: righe da uno stream iniettato (`allowNonTty`, mai da argv/env).
function secretReader(io) {
  const stdin = io.stdin;
  if (stdin && stdin.isTTY && typeof stdin.setRawMode === "function") {
    return (prompt) => new Promise((resolve, reject) => {
      io.stderr.write(prompt);
      let buf = "";
      const done = (err) => {
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        io.stderr.write("\n");
        if (err) reject(err); else resolve(buf);
      };
      const onData = (chunk) => {
        const r = feedSecret(buf, chunk);
        buf = r.buf;
        if (r.error) return done(new Failure(r.error));
        if (r.done) return done();
      };
      stdin.setEncoding("utf8");
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    });
  }
  if (io.allowNonTty && stdin) {
    const it = createInterface({ input: stdin, terminal: false })[Symbol.asyncIterator]();
    return async (prompt) => {
      io.stderr.write(prompt + "\n");
      const { value, done } = await it.next();
      if (done) throw new Failure("password non inserita");
      return value;
    };
  }
  return () => { throw new Failure("la password si legge solo da un terminale interattivo (stdin non è un terminale)"); };
}

// Prima di tutto il resto: la password si può leggere solo da un terminale (o dallo stream del test harness).
function requireTerminal(io) {
  const tty = io.stdin && io.stdin.isTTY && typeof io.stdin.setRawMode === "function";
  if (!tty && !(io.allowNonTty && io.stdin)) throw new Failure("la password si legge solo da un terminale interattivo (stdin non è un terminale)");
}

async function askNewPassword(read) {
  const a = await read("Nuova password (non viene mostrata): ");
  const b = await read("Ripeti la password: ");
  if (a !== b) throw new Failure("le password non coincidono");
  const problem = passwordProblem(a);
  if (problem) throw new Failure(problem);
  return a;
}

// --- pepper ------------------------------------------------------------------------------------------------

const defaultPepperFile = () => join(homedir(), ".config", "fitness-hub", "pepper");
const pepperPath = (values, io) => values["pepper-file"] || io.pepperFile || defaultPepperFile();
const uploadCommand = (file) => `cd "${BACKEND_DIR}" && npx wrangler secret put PASSWORD_PEPPER < "${file}"`;

// Pepper per calcolare gli hash: iniettato dai test (`io.pepper`) oppure dal file (solo se permessi 600, mai stampato).
function loadPepper(values, io) {
  if (io.pepper) return io.pepper;
  const file = pepperPath(values, io);
  let st;
  try { st = statSync(file); } catch { throw new Failure(`manca il pepper (${file}): lancia prima \`account.mjs init-pepper\``); }
  if (!st.isFile() || (st.mode & 0o077) !== 0) throw new Failure(`il file del pepper deve avere permessi 600: chmod 600 "${file}"`);
  const pepper = readFileSync(file, "utf8").trim();
  try { pepperBytes(pepper); } catch { throw new Failure(`pepper non valido in ${file} (servono almeno 64 caratteri esadecimali)`); }
  return pepper;
}

// Crea il pepper (32 byte casuali, hex) se manca, con permessi 600. Stampa solo il comando per caricarlo nel Worker.
async function cmdInitPepper(values, io, out) {
  const file = pepperPath(values, io);
  if (existsSync(file)) {
    loadPepper(values, { ...io, pepper: undefined });
    out(`il pepper esiste già: ${file} (non viene sovrascritto)`);
  } else {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, toHex(randomBytes(32)), { mode: 0o600, flag: "wx" });
    chmodSync(file, 0o600);
    out(`pepper creato: ${file} (permessi 600)`);
  }
  out(`per caricarlo nel Worker (una volta, prima del deploy):\n  ${uploadCommand(file)}`);
}

// --- comandi ---------------------------------------------------------------------------------------------

async function findAccount(target, email) {
  const { results } = await target.run([`SELECT id, email, disabled FROM accounts WHERE email = ${lit(email)} COLLATE NOCASE`]);
  return results[0] || null;
}

async function cmdCreate(values, io, out) {
  requireTerminal(io);
  if (!values.owner || !OWNER_RE.test(values.owner)) throw new UsageError("--owner deve essere un id (lettere, cifre, trattini)");
  const email = values.email;
  const target = await openTarget(values, io);
  try {
    const { results } = await target.run([`SELECT id FROM accounts WHERE email = ${lit(email)} COLLATE NOCASE OR id = ${lit(values.owner)}`]);
    if (results.length) throw new Failure("esiste già un account con questa email o questo owner");
    const pepper = loadPepper(values, io);
    const password = await askNewPassword(secretReader(io));
    const h = await hashPassword(password, pepper);
    await target.run([
      `INSERT INTO accounts (id, email, pw_hash, pw_salt, pw_iter, pw_ver, created_at, disabled) VALUES (${[values.owner, email, h.hash, h.salt, h.iter, h.ver, Date.now()].map(lit).join(", ")}, 0)`,
    ], { secret: true });
    out(`account creato: ${email} (owner ${values.owner})`);
  } finally {
    target.close();
  }
}

async function cmdResetPassword(values, io, out) {
  requireTerminal(io);
  const target = await openTarget(values, io);
  try {
    const acc = await findAccount(target, values.email);
    if (!acc) throw new Failure("account non trovato");
    const pepper = loadPepper(values, io);
    const password = await askNewPassword(secretReader(io));
    const h = await hashPassword(password, pepper);
    // hash nuovo (con segreti: via file in remoto), poi revoca delle sessioni (senza segreti) per contarle
    await target.run([
      `UPDATE accounts SET pw_hash = ${lit(h.hash)}, pw_salt = ${lit(h.salt)}, pw_iter = ${lit(h.iter)}, pw_ver = ${lit(h.ver)} WHERE id = ${lit(acc.id)}`,
    ], { secret: true });
    const r = await target.run([`UPDATE sessions SET revoked = 1 WHERE account_id = ${lit(acc.id)} AND revoked = 0`]);
    out(`password cambiata per ${acc.email}; sessioni revocate: ${r.changes}`);
  } finally {
    target.close();
  }
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d+Z$/, "Z") : "-");

async function cmdSessions(values, io, out) {
  const target = await openTarget(values, io);
  try {
    const acc = await findAccount(target, values.email);
    if (!acc) throw new Failure("account non trovato");
    const { results } = await target.run([
      `SELECT substr(id, 1, 8) AS sid, device_name, created_at, last_used_at, expires_at, revoked FROM sessions WHERE account_id = ${lit(acc.id)} ORDER BY created_at`,
    ]);
    out(`${acc.email} (owner ${acc.id})${acc.disabled ? " — DISATTIVATO" : ""}: ${results.length} sessioni`);
    const now = Date.now();
    for (const s of results) {
      const state = s.revoked ? "revocata" : s.expires_at <= now ? "scaduta" : "attiva";
      out(`  ${s.sid}  ${state.padEnd(8)}  ${String(s.device_name || "-").slice(0, 40).padEnd(20)}  creata ${iso(s.created_at)}  usata ${iso(s.last_used_at)}  scade ${iso(s.expires_at)}`);
    }
  } finally {
    target.close();
  }
}

async function cmdRevoke(values, io, out) {
  if (values.session !== undefined && !/^[0-9a-f]{8,64}$/.test(values.session)) throw new UsageError("--session: almeno 8 caratteri esadecimali (vedi `sessions`)");
  const target = await openTarget(values, io);
  try {
    const acc = await findAccount(target, values.email);
    if (!acc) throw new Failure("account non trovato");
    const only = values.session ? ` AND substr(id, 1, ${values.session.length}) = ${lit(values.session)}` : "";
    const r = await target.run([`UPDATE sessions SET revoked = 1 WHERE account_id = ${lit(acc.id)} AND revoked = 0${only}`]);
    out(`sessioni revocate: ${r.changes}`);
  } finally {
    target.close();
  }
}

async function cmdLogin(values, io, out) {
  requireTerminal(io);
  if (!values.api) throw new UsageError("serve --api <url>");
  let api;
  try { api = new URL(values.api); } catch { throw new UsageError("--api non è un URL"); }
  const local = api.hostname === "127.0.0.1" || api.hostname === "localhost";
  if (api.protocol !== "https:" && !(local && api.protocol === "http:")) throw new UsageError("--api deve essere https (http solo su localhost)");
  const password = await secretReader(io)("Password (non viene mostrata): ");
  const doFetch = io.fetch || globalThis.fetch;
  const res = await doFetch(new URL("/v1/auth/login", api), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: values.email, password, deviceName: values["device-name"] || "Mac (CLI admin)" }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || !body || typeof body.session !== "string") {
    throw new Failure(`accesso non riuscito (${res.status}): ${body && body.error ? body.error : "risposta non valida"}`);
  }
  const file = values.out || join(homedir(), ".config", "fitness-hub", "session");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // prima i permessi (anche su un file già esistente), poi il contenuto
  writeFileSync(file, "", { mode: 0o600 });
  chmodSync(file, 0o600);
  writeFileSync(file, body.session + "\n");
  out(`accesso riuscito: ${body.email} (owner ${body.ownerId}); sessione salvata in ${file} (scade ${iso(body.expiresAt)})`);
}

const COMMANDS = { "init-pepper": cmdInitPepper, create: cmdCreate, "reset-password": cmdResetPassword, sessions: cmdSessions, revoke: cmdRevoke, login: cmdLogin };

// → exit code (0 ok, 1 errore, 2 uso). `io` = { stdin, stdout, stderr, allowNonTty?, runRemote?, fetch? }.
export async function main(argv, io = {}) {
  const out = (line) => io.stdout.write(line + "\n");
  const err = (line) => io.stderr.write(line + "\n");
  try {
    // Mai la password come argomento, in nessuna forma (--password, --password=…, --pass, -p).
    if (argv.some((a) => /^--?(pass|pw|p$|p=)/i.test(a))) {
      throw new UsageError("la password non si passa come argomento: si digita nel terminale quando richiesta");
    }
    const [cmd, ...rest] = argv;
    if (!Object.hasOwn(COMMANDS, cmd || "")) throw new UsageError(cmd ? `comando sconosciuto: ${cmd}` : "manca il comando");
    const { values } = parseArgs({
      args: rest,
      options: {
        email: { type: "string" }, owner: { type: "string" }, local: { type: "string" }, remote: { type: "boolean" },
        session: { type: "string" }, api: { type: "string" }, out: { type: "string" }, "device-name": { type: "string" },
        "pepper-file": { type: "string" },
      },
      strict: true,
    });
    if (cmd !== "init-pepper") {
      values.email = normalizeEmail(values.email);
      if (!isValidEmail(values.email)) throw new UsageError("--email mancante o non valida");
    }
    await COMMANDS[cmd](values, io, out);
    return 0;
  } catch (e) {
    if (e instanceof UsageError || (e && e.code && String(e.code).startsWith("ERR_PARSE_ARGS"))) {
      err(`errore: ${e.message}\n${USAGE}`);
      return 2;
    }
    err(`errore: ${e instanceof Failure ? e.message : redact(e && e.message ? e.message : String(e), "")}`);
    return 1;
  }
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invokedDirectly) {
  main(process.argv.slice(2), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr })
    .then((code) => { process.exitCode = code; });
}
