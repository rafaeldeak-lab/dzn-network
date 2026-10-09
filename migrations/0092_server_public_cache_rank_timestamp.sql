-- Persist the time at which the durable network-rank snapshot was calculated.
-- Apply this migration independently before relying on rank-specific freshness.

ALTER TABLE server_public_cache ADD COLUMN network_rank_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_server_public_cache_network_rank_updated_at
  ON server_public_cache(network_rank_updated_at DESC);
