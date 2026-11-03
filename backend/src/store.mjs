// Store a record: last-writer-wins per record, tombstone, pull paginato per seq.
export const COLLECTIONS = new Set([
  "workoutPlan", "dietPlan", "dayState", "setLog", "workoutSession", "mealCheck",
  "supplementCheck", "bodyWeight", "bodyMeasure", "shoppingCheck", "shoppingExtra",
  "exerciseNote", "personalRecord", "coachMessage", "settings",
]);
export const MAX_FUTURE_MS = 300000;

// Tutto in un unico db.batch (un round-trip su D1). LWW e seq sono decisi dal DB, quindi
// senza race tra richieste concorrenti: per ogni change si incrementa meta.seq e poi si fa
// un upsert condizionale che vince solo se updated_at è maggiore (spareggio: device_id).
// I change persi lasciano un buco in seq: innocuo, il pull usa `seq > cursor`.
// staleKeys = { collection, id } dei change persi, senza doppioni (per i `conflicts`).
// Ogni record appartiene a un proprietario (owner): chiave primaria (owner, collection, id),
// quindi lo stesso collection/id di due proprietari sono due record distinti.
export async function applyChanges(db, owner, deviceId, changes, now) {
  if (!changes.length) return { applied: 0, stale: 0, staleKeys: [] };
  const bump = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'seq'");
  const upsert = db.prepare(
    `INSERT INTO records (owner, collection, id, data, updated_at, deleted, device_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT value FROM meta WHERE key = 'seq'))
     ON CONFLICT (owner, collection, id) DO UPDATE SET
       data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted,
       device_id = excluded.device_id, seq = excluded.seq
     WHERE excluded.updated_at > records.updated_at
        OR (excluded.updated_at = records.updated_at AND excluded.device_id > records.device_id)`
  );
  const limit = now + MAX_FUTURE_MS;
  const stmts = [];
  for (const c of changes) {
    stmts.push(bump);
    stmts.push(upsert.bind(
      owner, c.collection, c.id, c.data == null ? null : JSON.stringify(c.data),
      Math.min(c.updatedAt, limit), c.deleted ? 1 : 0, deviceId
    ));
  }
  const results = await db.batch(stmts);
  let applied = 0;
  const staleKeys = new Map();
  for (let i = 1; i < results.length; i += 2) {
    if (results[i].meta.changes > 0) { applied++; continue; }
    const c = changes[(i - 1) / 2];
    staleKeys.set(`${c.collection}\u0000${c.id}`, { collection: c.collection, id: c.id });
  }
  return { applied, stale: changes.length - applied, staleKeys: [...staleKeys.values()] };
}

const COLUMNS = "collection, id, data, updated_at, deleted, device_id, seq";
const toRecord = (r) => ({
  collection: r.collection,
  id: r.id,
  data: r.data == null ? null : JSON.parse(r.data),
  updatedAt: r.updated_at,
  deleted: !!r.deleted,
  deviceId: r.device_id,
  seq: r.seq,
});

// Righe correnti del server per le chiavi date (un solo db.batch di SELECT), nello stesso ordine.
export async function currentRecords(db, owner, keys) {
  if (!keys.length) return [];
  const sel = db.prepare(`SELECT ${COLUMNS} FROM records WHERE owner = ? AND collection = ? AND id = ?`);
  const results = await db.batch(keys.map((k) => sel.bind(owner, k.collection, k.id)));
  return results.flatMap((r) => (r.results || []).map(toRecord));
}

// seq corrente ed epoch del database (epoch = null se lo schema non l'ha ancora creato).
export async function readMeta(db) {
  const { results } = await db.prepare("SELECT key, value FROM meta WHERE key IN ('seq', 'epoch')").all();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { seq: m.seq ?? 0, epoch: m.epoch ?? null };
}

export async function pullSince(db, owner, cursor, limit) {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM records WHERE owner = ? AND seq > ? ORDER BY seq LIMIT ?`)
    .bind(owner, cursor, limit + 1)
    .all();
  const more = results.length > limit;
  const page = more ? results.slice(0, limit) : results;
  const changes = page.map(toRecord);
  return { changes, cursor: changes.length ? changes[changes.length - 1].seq : cursor, more };
}
