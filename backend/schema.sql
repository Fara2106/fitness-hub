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
-- Account, sessioni e tentativi di accesso: stesso testo di migrations/0003_accounts.sql (per i DB nuovi).
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                      -- = ownerId dei record
  email TEXT UNIQUE COLLATE NOCASE,         -- minuscola; NULL per un account solo Apple
  pw_hash TEXT,                             -- hex (32 byte); NULL = nessuna password. pw_ver 1: HMAC-SHA256(pepper, PBKDF2-SHA256)
  pw_salt TEXT,                             -- 16 byte casuali, hex
  pw_iter INTEGER,                          -- iterazioni PBKDF2 usate per QUESTA riga (oggi 25000)
  pw_ver INTEGER,                           -- schema dell'hash (1 = PBKDF2 + pepper); un login riuscito rifà gli hash vecchi
  apple_sub TEXT UNIQUE,                    -- `sub` di Accedi con Apple, se collegato
  created_at INTEGER,
  disabled INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                      -- SHA-256 hex del token: il token in chiaro non si salva mai
  account_id TEXT,
  device_name TEXT,
  created_at INTEGER,
  last_used_at INTEGER,
  expires_at INTEGER,                       -- scadenza scorrevole (180 giorni dall'ultimo uso)
  revoked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT,                                 -- `email:<minuscola>` oppure `ip:<CF-Connecting-IP>`
  at INTEGER                                -- ms del tentativo (addebitato prima di verificare); potate oltre 15 minuti
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key_at ON login_attempts (key, at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_at ON login_attempts (at);
