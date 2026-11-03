-- Schema per i database NUOVI (idempotente). Un DB creato con lo schema precedente (senza `owner`)
-- si porta avanti con migrations/0002_owner.sql PRIMA di rilanciare questo file.
CREATE TABLE IF NOT EXISTS records (
  owner TEXT NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (owner, collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_owner_seq ON records (owner, seq);
-- meta è globale (seq ed epoch valgono per tutto il database, non per proprietario).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', 0);
-- epoch: identità del database. Cambia dopo un azzeramento o un restore (vedi README):
-- il client che vede un epoch diverso riparte da cursore 0. Il modulo lo tiene entro
-- Number.MAX_SAFE_INTEGER (JS lo legge senza perdere cifre) ed evita l'overflow di abs().
INSERT OR IGNORE INTO meta (key, value) VALUES ('epoch', abs(random() % 9007199254740991));
