-- DZN Store catalog and admin product/price draft model.
-- Adds only disabled-by-default product and price metadata for future admin
-- catalog work. This does not add checkout, orders, payment events,
-- account entitlements, supporter cards, earned spins, or wheel runtime.

CREATE TABLE IF NOT EXISTS store_products (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK(product_type IN (
    'supporter_pack',
    'profile_theme',
    'calling_card_pack',
    'chat_cosmetic_pack',
    'group_branding_pack',
    'event_presentation_theme'
  )),
  fulfilment_kind TEXT NOT NULL CHECK(fulfilment_kind IN (
    'supporter_card',
    'cosmetic_entitlement',
    'profile_frame',
    'chat_badge',
    'theme_pack',
    'event_theme'
  )),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'approved', 'paused', 'archived')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  account_bound INTEGER NOT NULL DEFAULT 1 CHECK(account_bound = 1),
  guaranteed_purchase INTEGER NOT NULL DEFAULT 1 CHECK(guaranteed_purchase = 1),
  no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK(no_competitive_advantage = 1),
  grants_spins INTEGER NOT NULL DEFAULT 0 CHECK(grants_spins = 0),
  grants_xp INTEGER NOT NULL DEFAULT 0 CHECK(grants_xp = 0),
  grants_rank_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_rank_advantage = 0),
  grants_discovery_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_discovery_advantage = 0),
  grants_review_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_review_advantage = 0),
  grants_event_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_event_advantage = 0),
  grants_server_wars_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_server_wars_advantage = 0),
  grants_ctf_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_ctf_advantage = 0),
  grants_owner_subscription_access INTEGER NOT NULL DEFAULT 0 CHECK(grants_owner_subscription_access = 0),
  grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK(grants_competitive_eligibility = 0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK(currency = lower(currency) AND currency IN ('gbp')),
  unit_amount_minor INTEGER NOT NULL CHECK(unit_amount_minor > 0),
  min_amount_minor INTEGER CHECK(min_amount_minor IS NULL),
  allow_pay_what_you_want INTEGER NOT NULL DEFAULT 0 CHECK(allow_pay_what_you_want = 0),
  stripe_price_id TEXT UNIQUE CHECK(stripe_price_id IS NULL),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'approved', 'paused', 'archived')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES store_products(id)
);

CREATE INDEX IF NOT EXISTS idx_store_products_status_active
  ON store_products(status, active, product_type, created_at);

CREATE INDEX IF NOT EXISTS idx_store_products_product_key
  ON store_products(product_key);

CREATE INDEX IF NOT EXISTS idx_store_prices_product_status
  ON store_prices(product_id, status, active, effective_from);

CREATE INDEX IF NOT EXISTS idx_store_prices_stripe_price_id
  ON store_prices(stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;
