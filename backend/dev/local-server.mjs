// Server locale: il Worker vero (src/worker.mjs) con D1 simulato su node:sqlite, su http://127.0.0.1.
// Per i test d'integrazione e gli UI test dell'app Swift (mai il backend di produzione).
//   node backend/dev/local-server.mjs --port 8787 --token <t> [--db <file>] [--seed <records.json>] [--owner <id>]
// --port 0 = porta libera. --db = persistenza su file (default: in memoria). --seed = array JSON di Change
// applicati all'avvio come device "seed". Stampa su stdout `ready http://127.0.0.1:<porta>` e mai il token.
import http from "node:http";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import worker from "../src/worker.mjs";
import { createD1 } from "../test/d1-sqlite.mjs";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    token: { type: "string" },
    db: { type: "string" },
    seed: { type: "string" },
    owner: { type: "string", default: "local-owner" },
  },
});
if (!values.token) {
  console.error("manca --token");
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("--port non valida");
  process.exit(2);
}

const DB = createD1(values.db || ":memory:");
await DB.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const env = { DB, SYNC_TOKEN: values.token, PRIMARY_OWNER: values.owner };

// Seed: passa dal Worker stesso (stessa validazione e stesso LWW di un client vero), a lotti da 500.
if (values.seed) {
  const changes = JSON.parse(readFileSync(values.seed, "utf8"));
  if (!Array.isArray(changes)) {
    console.error("--seed deve essere un array di Change");
    process.exit(2);
  }
  for (let i = 0; i < changes.length; i += 500) {
    const res = await worker.fetch(new Request("http://127.0.0.1/v1/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${values.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "seed", cursor: 0, changes: changes.slice(i, i + 500) }),
    }), env);
    if (res.status !== 200) {
      console.error(`seed rifiutato (${res.status}): ${await res.text()}`);
      process.exit(2);
    }
  }
}

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
server.listen(port, "127.0.0.1", () => console.log(`ready http://127.0.0.1:${server.address().port}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.close(() => process.exit(0)));
