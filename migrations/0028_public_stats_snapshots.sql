CREATE TABLE IF NOT EXISTS public_stats_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source TEXT,
  stale_allowed_until TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_public_stats_snapshots_updated_at
  ON public_stats_snapshots(updated_at);

CREATE INDEX IF NOT EXISTS idx_public_stats_snapshots_key
  ON public_stats_snapshots(snapshot_key);
