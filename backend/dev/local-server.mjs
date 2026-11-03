// Server locale: il Worker vero (src/worker.mjs) con D1 simulato su node:sqlite, su http://127.0.0.1.
// Per i test d'integrazione e gli UI test dell'app Swift (mai il backend di produzione).
//   node backend/dev/local-server.mjs --port 8787 [--token <t>] [--account <email>:<password>] [--db <file>]
//                                     [--seed <records.json>] [--owner <id>] [--invite]
// --port 0 = porta libera. --db = persistenza su file (default: in memoria). --seed = array JSON di Change
// applicati all'avvio come device "seed". --token = token legacy (LEGACY_TOKEN_ENABLED acceso) verso --owner.
// --account = crea all'avvio un account DI TEST con id = --owner (password in chiaro sulla riga di comando:
// SOLO per test locali, mai con credenziali vere né contro la produzione). Serve almeno uno fra --token e --account.
// --pepper-file = file col pepper delle password (hex ≥ 32 byte); di default un pepper di TEST fisso e pubblico
// (va bene solo qui: in produzione il pepper è il secret PASSWORD_PEPPER).
// --invite = SOLO per i test (UI test dell'app Swift): crea all'avvio un codice di attivazione per --owner e, dopo
// `ready`, stampa la riga `invite <CODICE>` (il codice in chiaro: mai fuori dal server locale).
// Stampa su stdout `ready http://127.0.0.1:<porta>` e mai il token né la password.
import http from "node:http";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import worker from "../src/worker.mjs";
import { createD1 } from "../test/d1-sqlite.mjs";
import { createAccount, createSession, revokeSession, sha256Hex, createActivationCode } from "../src/auth.mjs";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    token: { type: "string" },
    db: { type: "string" },
    seed: { type: "string" },
    owner: { type: "string", default: "local-owner" },
    account: { type: "string" },
    "pepper-file": { type: "string" },
    invite: { type: "boolean" },
  },
});
if (!values.token && !values.account && !values.invite) {
  console.error("serve almeno uno fra --token, --account <email>:<password> e --invite");
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("--port non valida");
  process.exit(2);
}

const DB = createD1(values.db || ":memory:");
await DB.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
// Pepper di test, pubblico: SOLO per il server locale.
const LOCAL_TEST_PEPPER = "7e57".repeat(16);
const pepper = values["pepper-file"] ? readFileSync(values["pepper-file"], "utf8").trim() : LOCAL_TEST_PEPPER;
const env = {
  PASSWORD_PEPPER: pepper,
  DB, SYNC_TOKEN: values.token, PRIMARY_OWNER: values.owner, LEGACY_TOKEN_ENABLED: values.token ? "true" : "false",
  REGISTRATION_OPEN: "false", APPLE_SIGNIN_ENABLED: "false", APPLE_BUNDLE_ID: "it.faraoni.fitnesshub",
};
if (values.account) {
  const sep = values.account.indexOf(":");
  if (sep < 1) {
    console.error("--account deve essere <email>:<password>");
    process.exit(2);
  }
  const email = values.account.slice(0, sep);
  const exists = await DB.prepare("SELECT 1 FROM accounts WHERE email = ? COLLATE NOCASE OR id = ?").bind(email.trim().toLowerCase(), values.owner).first();
  if (!exists) {
    try {
      await createAccount(DB, { id: values.owner, email, password: values.account.slice(sep + 1), pepper, now: Date.now() });
    } catch (e) {
      console.error(`--account non valido: ${e.message}`);
      process.exit(2);
    }
  }
}

// Seed: passa dal Worker stesso (stessa validazione e stesso LWW di un client vero), a lotti da 500.
if (values.seed) {
  const changes = JSON.parse(readFileSync(values.seed, "utf8"));
  if (!Array.isArray(changes)) {
    console.error("--seed deve essere un array di Change");
    process.exit(2);
  }
  // Con il solo --account il seed passa da una sessione temporanea dell'account (revocata subito dopo).
  let seedToken = values.token;
  let seedSession = null;
  if (!seedToken) {
    seedToken = (await createSession(DB, values.owner, "seed", Date.now())).token;
    seedSession = await sha256Hex(seedToken);
  }
  for (let i = 0; i < changes.length; i += 500) {
    const res = await worker.fetch(new Request("http://127.0.0.1/v1/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${seedToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "seed", cursor: 0, changes: changes.slice(i, i + 500) }),
    }), env);
    if (res.status !== 200) {
      console.error(`seed rifiutato (${res.status}): ${await res.text()}`);
      process.exit(2);
    }
  }
  if (seedSession) await revokeSession(DB, seedSession);
}

// Codice di attivazione di test per --owner (vale 30 minuti, una volta sola), stampato dopo `ready`.
const invite = values.invite ? (await createActivationCode(DB, { owner: values.owner, now: Date.now() })).code : null;

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, v);
    }
    const hasBody = body && req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
      method: req.method, headers, body: hasBody ? body : undefined,
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(`errore: ${e && e.message ? e.message : String(e)}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "errore interno" }));
  }
});
server.listen(port, "127.0.0.1", () => {
  console.log(`ready http://127.0.0.1:${server.address().port}`);
  if (invite) console.log(`invite ${invite}`);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
