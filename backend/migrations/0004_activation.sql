-- 0004: codici di attivazione monouso (Task 18B). L'app nativa, che non ha il token legacy, crea l'account del
-- proprietario con un codice generato da `admin/account.mjs invite` (valido 30 minuti, una volta sola).
-- Solo una tabella nuova, idempotente (IF NOT EXISTS): records, meta, accounts e sessions non si toccano.
-- Niente BEGIN/COMMIT (D1 esegue il file in un lotto).
CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY,                      -- SHA-256 hex del codice normalizzato: il codice in chiaro non si salva mai
  owner TEXT NOT NULL,                      -- ownerId dell'account che il codice crea
  expires_at INTEGER NOT NULL,              -- ms; valido finché expires_at > adesso
  used_at INTEGER                           -- ms dell'attivazione; NULL = non ancora usato
);
