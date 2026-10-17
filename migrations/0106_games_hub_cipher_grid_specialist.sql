-- Specialist six-letter Cipher Grid sessions. Apply independently after a
-- recovery point and verify the schema before enabling the specialist flag.
CREATE TABLE dzn_cipher_grid_sessions_next (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL CHECK (length(answer) IN (5, 6) AND answer = upper(answer)),
  attempts_json TEXT NOT NULL CHECK (json_valid(attempts_json) AND json_type(attempts_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 6),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO dzn_cipher_grid_sessions_next
  (user_id, id, answer, attempts_json, status, version, started_at, updated_at)
SELECT user_id, id, answer, attempts_json, status, version, started_at, updated_at
FROM dzn_cipher_grid_sessions;

DROP TABLE dzn_cipher_grid_sessions;
ALTER TABLE dzn_cipher_grid_sessions_next RENAME TO dzn_cipher_grid_sessions;
