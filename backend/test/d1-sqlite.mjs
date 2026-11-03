// Adattatore di test: imita l'API di D1 sopra node:sqlite (solo il necessario).
import { DatabaseSync } from "node:sqlite";

export function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  const prepare = (sql) => {
    const make = (args) => ({
      bind: (...a) => make(a),
      all: async () => ({ results: sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) }),
      first: async (col) => {
        const row = sqlite.prepare(sql).get(...args);
        if (!row) return null;
        return col ? row[col] : { ...row };
      },
      run: async () => ({ success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
      _run: () => ({ success: true, meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
    });
    return make([]);
  };
  return {
    prepare,
    exec: async (sql) => { sqlite.exec(sql); },
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
