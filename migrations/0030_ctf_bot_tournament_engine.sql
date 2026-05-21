-- Additive CTF tournament and bot registration schema.
-- Do not clear, reset, or rewrite historical player/stat rows.

ALTER TABLE linked_servers ADD COLUMN bot_access_token TEXT;
ALTER TABLE linked_servers ADD COLUMN tournament_channel_id TEXT;
ALTER TABLE linked_servers ADD COLUMN bot_installed_at TEXT;
ALTER TABLE linked_servers ADD COLUMN is_searching_for_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE linked_servers ADD COLUMN matchmaking_opt_in_at TEXT;
ALTER TABLE linked_servers ADD COLUMN dynamic_visibility_score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE kill_events ADD COLUMN event_hash TEXT;
ALTER TABLE player_events ADD COLUMN event_hash TEXT;
ALTER TABLE sessions ADD COLUMN session_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kill_events_event_hash ON kill_events(event_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_events_event_hash ON player_events(event_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_hash ON sessions(session_hash);
CREATE INDEX IF NOT EXISTS idx_server_subscriptions_active_subscription_lookup
  ON server_subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id != '';

CREATE TABLE IF NOT EXISTS ctf_tournaments (
  id TEXT PRIMARY KEY,
  tournament_name TEXT NOT NULL,
  current_phase TEXT NOT NULL DEFAULT 'PRE_WAR_ROSTER',
  phase_ends_at TEXT NOT NULL,
  target_metric TEXT NOT NULL DEFAULT 'KILLS',
  target_flag_points INTEGER NOT NULL DEFAULT 1000,
  broadcast_interval_minutes INTEGER NOT NULL DEFAULT 60,
  grace_period_config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ctf_tournaments_phase ON ctf_tournaments(current_phase);
CREATE INDEX IF NOT EXISTS idx_ctf_tournaments_phase_ends_at ON ctf_tournaments(phase_ends_at);

CREATE TABLE IF NOT EXISTS ctf_match_participants (
  ctf_tournament_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  accumulated_points INTEGER NOT NULL DEFAULT 0,
  has_raised_flag INTEGER NOT NULL DEFAULT 0,
  last_broadcasted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ctf_tournament_id, linked_server_id),
  FOREIGN KEY(ctf_tournament_id) REFERENCES ctf_tournaments(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_ctf_match_participants_server ON ctf_match_participants(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_ctf_match_participants_broadcast ON ctf_match_participants(last_broadcasted_at);

CREATE TABLE IF NOT EXISTS ctf_tournament_rosters (
  ctf_tournament_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ctf_tournament_id, linked_server_id, player_id),
  FOREIGN KEY(ctf_tournament_id) REFERENCES ctf_tournaments(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_ctf_tournament_rosters_player ON ctf_tournament_rosters(player_id);
CREATE INDEX IF NOT EXISTS idx_ctf_tournament_rosters_server ON ctf_tournament_rosters(linked_server_id);

CREATE TABLE IF NOT EXISTS server_activity_index (
  linked_server_id TEXT PRIMARY KEY,
  rolling_7day_log_lines INTEGER NOT NULL DEFAULT 0,
  last_calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activity_tier TEXT NOT NULL DEFAULT 'STABLE',
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS server_discord_webhooks (
  linked_server_id TEXT PRIMARY KEY,
  killfeed_webhook_url TEXT,
  connections_webhook_url TEXT,
  announcements_webhook_url TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE TABLE IF NOT EXISTS ctf_event_audit (
  id TEXT PRIMARY KEY,
  ctf_tournament_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  player_id TEXT,
  point_delta INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  rejected_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ctf_tournament_id, linked_server_id, event_hash),
  FOREIGN KEY(ctf_tournament_id) REFERENCES ctf_tournaments(id),
  FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
);

CREATE INDEX IF NOT EXISTS idx_ctf_event_audit_server ON ctf_event_audit(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_ctf_event_audit_event_hash ON ctf_event_audit(event_hash);
