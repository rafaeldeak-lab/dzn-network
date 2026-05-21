-- Additive premium analytics telemetry schema.
-- DZN currently stores player stat counters in player_profiles; do not rewrite or reset existing rows.

ALTER TABLE player_profiles ADD COLUMN highest_killstreak INTEGER DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN current_killstreak INTEGER DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN total_time_alive_seconds INTEGER DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN headshots INTEGER DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN favourite_weapon TEXT DEFAULT 'Unknown';
ALTER TABLE player_profiles ADD COLUMN combat_logs_count INTEGER DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN rage_quits_count INTEGER DEFAULT 0;
ALTER TABLE player_profiles ADD COLUMN spawn_kills_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS player_parser_state (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT,
  last_connected_at TEXT,
  last_combat_activity_at TEXT,
  last_died_at TEXT,
  alive_session_started_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(linked_server_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_weapon_stats (
  player_profile_id TEXT NOT NULL,
  linked_server_id TEXT NOT NULL,
  weapon TEXT NOT NULL,
  kills INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(player_profile_id, weapon)
);

CREATE INDEX IF NOT EXISTS idx_player_profiles_highest_streak ON player_profiles(highest_killstreak DESC);
CREATE INDEX IF NOT EXISTS idx_player_profiles_longest_kill ON player_profiles(longest_kill_distance DESC);
CREATE INDEX IF NOT EXISTS idx_player_profiles_time_alive ON player_profiles(total_time_alive_seconds DESC);
CREATE INDEX IF NOT EXISTS idx_player_profiles_headshots ON player_profiles(headshots DESC);
CREATE INDEX IF NOT EXISTS idx_player_profiles_combat_logs ON player_profiles(combat_logs_count DESC);
CREATE INDEX IF NOT EXISTS idx_player_profiles_rage_quits ON player_profiles(rage_quits_count DESC);
CREATE INDEX IF NOT EXISTS idx_player_profiles_spawn_kills ON player_profiles(spawn_kills_count DESC);
CREATE INDEX IF NOT EXISTS idx_player_parser_state_server_player ON player_parser_state(linked_server_id, player_id);
CREATE INDEX IF NOT EXISTS idx_player_parser_state_combat ON player_parser_state(last_combat_activity_at);
CREATE INDEX IF NOT EXISTS idx_player_weapon_stats_server_weapon ON player_weapon_stats(linked_server_id, weapon, kills DESC);
