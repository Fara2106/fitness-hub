-- 0002: ogni record ha un proprietario (owner). Da lanciare UNA volta su un DB con lo schema vecchio.
-- __PRIMARY_OWNER__ è un segnaposto: si sostituisce con sed al lancio (vedi README), non va scritto qui.
-- Niente BEGIN/COMMIT: D1 esegue il file come un unico lotto transazionale. `seq` e la tabella `meta`
-- (seq, epoch) restano intatti, quindi i cursori dei client restano validi.
-- Su un DB già nuovo (con `owner`) l'INSERT fallisce: il lotto torna indietro, nulla cambia.
DROP TABLE IF EXISTS records_new;
CREATE TABLE records_new (
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
-- `SELECT <owner>, *` di proposito: con lo schema vecchio (7 colonne) combacia, con uno già nuovo (8 colonne)
-- fallisce, così rilanciare la migrazione non può riassegnare tutti i record a un unico proprietario.
INSERT INTO records_new SELECT '__PRIMARY_OWNER__', * FROM records;
DROP TABLE records;
ALTER TABLE records_new RENAME TO records;
CREATE INDEX idx_records_owner_seq ON records (owner, seq);
