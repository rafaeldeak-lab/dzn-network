CREATE TABLE IF NOT EXISTS server_subscriptions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL UNIQUE,
  owner_discord_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_price_id TEXT,
  plan_key TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'inactive',
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_subscriptions_owner_discord_id ON server_subscriptions(owner_discord_id);
CREATE INDEX IF NOT EXISTS idx_server_subscriptions_stripe_customer_id ON server_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_server_subscriptions_stripe_subscription_id ON server_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_server_subscriptions_plan_status ON server_subscriptions(plan_key, status);

CREATE TABLE IF NOT EXISTS server_sync_state (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL UNIQUE,
  last_status_check_at TEXT,
  next_status_check_due_at TEXT,
  last_successful_status_check_at TEXT,
  last_failed_status_check_at TEXT,
  last_status_error TEXT,
  current_player_count INTEGER,
  max_player_count INTEGER,
  server_online INTEGER,
  server_status TEXT,
  status_data_freshness TEXT,
  currently_checking_status INTEGER NOT NULL DEFAULT 0,
  last_adm_pull_at TEXT,
  next_adm_pull_due_at TEXT,
  last_successful_adm_pull_at TEXT,
  last_failed_adm_pull_at TEXT,
  last_adm_error TEXT,
  last_seen_adm_filename TEXT,
  last_seen_adm_modified_at TEXT,
  last_processed_adm_filename TEXT,
  last_processed_adm_offset INTEGER,
  last_new_adm_found_at TEXT,
  last_server_restart_at TEXT,
  adm_status TEXT,
  currently_syncing_adm INTEGER NOT NULL DEFAULT 0,
  manual_refresh_locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_due ON server_sync_state(next_status_check_due_at);
CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_due ON server_sync_state(next_adm_pull_due_at);
CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_lock ON server_sync_state(currently_checking_status);
CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_lock ON server_sync_state(currently_syncing_adm);

CREATE TABLE IF NOT EXISTS server_posting_destinations (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  post_type TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  discord_webhook_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  required_feature TEXT,
  min_plan_key TEXT,
  created_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(guild_id, post_type)
);

CREATE INDEX IF NOT EXISTS idx_server_posting_destinations_guild_id ON server_posting_destinations(guild_id);
CREATE INDEX IF NOT EXISTS idx_server_posting_destinations_post_type ON server_posting_destinations(post_type);

CREATE TABLE IF NOT EXISTS server_posting_state (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  post_type TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  discord_message_id TEXT,
  last_posted_at TEXT,
  last_edited_at TEXT,
  last_payload_hash TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(guild_id, post_type, discord_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_server_posting_state_guild_id ON server_posting_state(guild_id);
CREATE INDEX IF NOT EXISTS idx_server_posting_state_post_type ON server_posting_state(post_type);

CREATE TABLE IF NOT EXISTS server_public_cache (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL UNIQUE,
  plan_key TEXT NOT NULL DEFAULT 'starter',
  public_server_name TEXT,
  current_player_count INTEGER,
  max_player_count INTEGER,
  server_online INTEGER,
  server_status TEXT,
  leaderboard_snapshot_json TEXT,
  event_snapshot_json TEXT,
  network_rank INTEGER,
  partner_featured INTEGER NOT NULL DEFAULT 0,
  last_status_update_at TEXT,
  last_adm_update_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_public_cache_plan_key ON server_public_cache(plan_key);
CREATE INDEX IF NOT EXISTS idx_server_public_cache_network_rank ON server_public_cache(network_rank);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  post_type TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  run_after TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_guild_type ON automation_jobs(guild_id, job_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_jobs_unique_queued_post
ON automation_jobs(guild_id, job_type, COALESCE(post_type, ''))
WHERE status IN ('queued', 'running');
