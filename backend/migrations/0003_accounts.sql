-- 0003: account (email + password, Accedi con Apple), sessioni e tentativi di accesso.
-- Solo tabelle e indici nuovi, idempotente (IF NOT EXISTS): `records` e `meta` non si toccano.
-- L'id dell'account È l'ownerId dei record: l'account di Lorenzo si crea con la CLI admin/account.mjs
-- e --owner <PRIMARY_OWNER>, così i suoi record restano suoi. Niente BEGIN/COMMIT (D1 esegue il file in un lotto).
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                      -- = ownerId dei record
  email TEXT UNIQUE COLLATE NOCASE,         -- minuscola; NULL per un account solo Apple
  pw_hash TEXT,                             -- PBKDF2-SHA256, hex (32 byte); NULL = nessuna password
  pw_salt TEXT,                             -- 16 byte casuali, hex
  pw_iter INTEGER,                          -- iterazioni usate per QUESTA riga (oggi 100000)
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
  at INTEGER                                -- ms dell'errore; righe oltre 15 minuti potate a ogni errore
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key_at ON login_attempts (key, at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_at ON login_attempts (at);
