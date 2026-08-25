-- Verified progression source adapters and audit metadata.
-- Additive only: stores source provenance for owner/admin audit views and
-- failed-row retry state. Does not alter paid plans, rankings, discovery,
-- reviews, badges, seasons, events, Server Wars scoring, competitive
-- eligibility, ADM gameplay rows, kill_events, player_events, or live billing.

ALTER TABLE player_progression_award_sources ADD COLUMN linked_server_id TEXT;
ALTER TABLE player_progression_award_sources ADD COLUMN source_table TEXT;
ALTER TABLE player_progression_award_sources ADD COLUMN adapter_key TEXT;
ALTER TABLE player_progression_award_sources ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_progression_award_sources ADD COLUMN last_attempted_at TEXT;
ALTER TABLE player_progression_award_sources ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_progression_award_sources ADD COLUMN last_retried_at TEXT;

CREATE INDEX IF NOT EXISTS idx_player_progression_award_sources_server_status
  ON player_progression_award_sources(linked_server_id, result_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_player_progression_award_sources_adapter
  ON player_progression_award_sources(adapter_key, source_table, result_status);
