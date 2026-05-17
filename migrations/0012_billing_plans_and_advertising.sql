CREATE TABLE IF NOT EXISTS owner_billing_accounts (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_key TEXT NOT NULL DEFAULT 'free',
  plan_status TEXT NOT NULL DEFAULT 'free',
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_owner_billing_accounts_discord_user_id
ON owner_billing_accounts(discord_user_id);

CREATE INDEX IF NOT EXISTS idx_owner_billing_accounts_stripe_customer_id
ON owner_billing_accounts(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_owner_billing_accounts_stripe_subscription_id
ON owner_billing_accounts(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS owner_plan_entitlements (
  discord_user_id TEXT PRIMARY KEY,
  plan_key TEXT NOT NULL DEFAULT 'free',
  max_linked_servers INTEGER NOT NULL DEFAULT 1,
  can_use_reviews INTEGER NOT NULL DEFAULT 0,
  can_use_public_listing INTEGER NOT NULL DEFAULT 1,
  can_use_advanced_analytics INTEGER NOT NULL DEFAULT 0,
  can_join_events INTEGER NOT NULL DEFAULT 0,
  can_use_ad_bumps INTEGER NOT NULL DEFAULT 0,
  included_bumps_per_month INTEGER NOT NULL DEFAULT 0,
  bump_cooldown_hours INTEGER NOT NULL DEFAULT 24,
  can_use_featured_slots INTEGER NOT NULL DEFAULT 0,
  stat_history_days INTEGER NOT NULL DEFAULT 7,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_advertising_state (
  linked_server_id TEXT PRIMARY KEY,
  owner_discord_id TEXT NOT NULL,
  last_bumped_at TEXT,
  bump_count_current_period INTEGER NOT NULL DEFAULT 0,
  bump_period_start TEXT,
  bump_period_end TEXT,
  featured_until TEXT,
  featured_label TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_advertising_state_owner_discord_id
ON server_advertising_state(owner_discord_id);

CREATE INDEX IF NOT EXISTS idx_server_advertising_state_featured_until
ON server_advertising_state(featured_until);

CREATE TABLE IF NOT EXISTS server_ad_bump_events (
  id TEXT PRIMARY KEY,
  linked_server_id TEXT NOT NULL,
  owner_discord_id TEXT NOT NULL,
  bump_type TEXT NOT NULL DEFAULT 'included',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_server_ad_bump_events_linked_server_id
ON server_ad_bump_events(linked_server_id);

CREATE INDEX IF NOT EXISTS idx_server_ad_bump_events_owner_discord_id
ON server_ad_bump_events(owner_discord_id);

CREATE INDEX IF NOT EXISTS idx_server_ad_bump_events_created_at
ON server_ad_bump_events(created_at);
