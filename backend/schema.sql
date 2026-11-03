CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_seq ON records (seq);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', 0);
