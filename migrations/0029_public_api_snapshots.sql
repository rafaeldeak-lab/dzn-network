CREATE TABLE IF NOT EXISTS public_api_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  access_level TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_public_api_snapshots_access_level
  ON public_api_snapshots(access_level);

CREATE INDEX IF NOT EXISTS idx_public_api_snapshots_updated_at
  ON public_api_snapshots(updated_at);
