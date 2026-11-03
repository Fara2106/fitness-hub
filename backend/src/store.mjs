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
export async function applyChanges(db, deviceId, changes, now) {
  if (!changes.length) return { applied: 0, stale: 0 };
  const bump = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'seq'");
  const upsert = db.prepare(
    `INSERT INTO records (collection, id, data, updated_at, deleted, device_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT value FROM meta WHERE key = 'seq'))
     ON CONFLICT (collection, id) DO UPDATE SET
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
      c.collection, c.id, c.data == null ? null : JSON.stringify(c.data),
      Math.min(c.updatedAt, limit), c.deleted ? 1 : 0, deviceId
    ));
  }
  const results = await db.batch(stmts);
  let applied = 0;
  for (let i = 1; i < results.length; i += 2) applied += results[i].meta.changes > 0 ? 1 : 0;
  return { applied, stale: changes.length - applied };
}

export async function pullSince(db, cursor, limit) {
  const { results } = await db
    .prepare(
      `SELECT collection, id, data, updated_at, deleted, device_id, seq
       FROM records WHERE seq > ? ORDER BY seq LIMIT ?`
    )
    .bind(cursor, limit + 1)
    .all();
  const more = results.length > limit;
  const page = more ? results.slice(0, limit) : results;
  const changes = page.map((r) => ({
    collection: r.collection,
    id: r.id,
    data: r.data == null ? null : JSON.parse(r.data),
    updatedAt: r.updated_at,
    deleted: !!r.deleted,
    deviceId: r.device_id,
    seq: r.seq,
  }));
  return { changes, cursor: changes.length ? changes[changes.length - 1].seq : cursor, more };
}
