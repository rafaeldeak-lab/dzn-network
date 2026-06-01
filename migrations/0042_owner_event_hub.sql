-- Additive owner Event Hub, Discord event channel, tournament phase, and scoring schema.
-- Do not remove/reset ADM, player profile, billing, session, subscription, or token data.

ALTER TABLE competitive_events ADD COLUMN requires_discord_posting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitive_events ADD COLUMN official_event INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitive_events ADD COLUMN allow_hybrid_entries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitive_events ADD COLUMN entry_deadline_at TEXT;
ALTER TABLE competitive_events ADD COLUMN matchup_duration_hours INTEGER;
ALTER TABLE competitive_events ADD COLUMN phase_duration_hours INTEGER;
ALTER TABLE competitive_events ADD COLUMN phase_count INTEGER;
ALTER TABLE competitive_events ADD COLUMN scoring_rules_json TEXT;

CREATE TABLE IF NOT EXISTS server_discord_channel_settings (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  server_id TEXT,
  guild_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  channel_kind TEXT,
  bot_can_view INTEGER DEFAULT 0,
  bot_can_send INTEGER DEFAULT 0,
  bot_can_embed INTEGER DEFAULT 0,
  bot_can_read_history INTEGER DEFAULT 0,
  last_verified_at TEXT,
  selected_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(linked_server_id, channel_type)
);
-- channel_type allowed values: default_event, event_announcements, event_live_scoreboard, event_results.

CREATE INDEX IF NOT EXISTS idx_server_discord_channel_settings_server ON server_discord_channel_settings(linked_server_id);
CREATE INDEX IF NOT EXISTS idx_server_discord_channel_settings_guild ON server_discord_channel_settings(guild_id);

CREATE TABLE IF NOT EXISTS discord_guild_channels_cache (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  channel_kind TEXT,
  parent_id TEXT,
  position INTEGER,
  bot_permission_json TEXT,
  last_seen_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS server_event_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  server_id TEXT,
  owner_user_id TEXT,
  guild_id TEXT,
  category_at_entry TEXT,
  plan_key_at_entry TEXT,
  status TEXT NOT NULL DEFAULT 'entered',
  entered_at TEXT,
  withdrawn_at TEXT,
  completed_at TEXT,
  cooldown_until TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(event_id, linked_server_id)
);

CREATE INDEX IF NOT EXISTS idx_server_event_entries_server_status ON server_event_entries(linked_server_id, status);
CREATE INDEX IF NOT EXISTS idx_server_event_entries_event ON server_event_entries(event_id);

CREATE TABLE IF NOT EXISTS event_matchups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  round_number INTEGER,
  server_a_entry_id TEXT,
  server_b_entry_id TEXT,
  server_a_id TEXT NOT NULL,
  server_b_id TEXT NOT NULL,
  status TEXT,
  starts_at TEXT,
  ends_at TEXT,
  scoring_grace_until TEXT,
  server_a_score INTEGER DEFAULT 0,
  server_b_score INTEGER DEFAULT 0,
  winner_server_id TEXT,
  tie_breaker_json TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_matchups_event ON event_matchups(event_id);
CREATE INDEX IF NOT EXISTS idx_event_matchups_status ON event_matchups(status);

CREATE TABLE IF NOT EXISTS event_challenge_phases (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  matchup_id TEXT NOT NULL,
  phase_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category_scope TEXT,
  metric_type TEXT NOT NULL,
  scoring_rules_json TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  scoring_grace_until TEXT,
  status TEXT,
  server_a_score INTEGER DEFAULT 0,
  server_b_score INTEGER DEFAULT 0,
  winner_server_id TEXT,
  finalized_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(matchup_id, phase_number)
);

CREATE INDEX IF NOT EXISTS idx_event_challenge_phases_due ON event_challenge_phases(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS event_phase_scores (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  matchup_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  qualifying_events_count INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT,
  last_scored_at TEXT,
  finalized_at TEXT,
  UNIQUE(phase_id, linked_server_id)
);

CREATE INDEX IF NOT EXISTS idx_event_phase_scores_matchup ON event_phase_scores(matchup_id);

CREATE TABLE IF NOT EXISTS event_cooldowns (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  event_type TEXT,
  plan_key TEXT,
  cooldown_until TEXT NOT NULL,
  source_event_id TEXT,
  source_matchup_id TEXT,
  reason TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_cooldowns_server_until ON event_cooldowns(linked_server_id, cooldown_until);

CREATE TABLE IF NOT EXISTS event_discord_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  matchup_id TEXT,
  phase_id TEXT,
  linked_server_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  message_id TEXT,
  message_type TEXT,
  status TEXT,
  last_payload_hash TEXT,
  last_sent_at TEXT,
  last_edited_at TEXT,
  retry_count INTEGER DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(event_id, matchup_id, phase_id, linked_server_id, message_type)
);

CREATE INDEX IF NOT EXISTS idx_event_discord_messages_retry ON event_discord_messages(status, next_retry_at);

CREATE TABLE IF NOT EXISTS event_reports (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  report_type TEXT,
  generated_at TEXT,
  champion_server_id TEXT,
  summary_json TEXT,
  public_summary_text TEXT,
  admin_notes_json TEXT
);
