-- DZN Store sandbox order ledger schema.
-- Local/sandbox only: adds order, order-item, and payment-event ledgers for
-- future disabled-by-default Store checkout work. This migration does not add
-- checkout routes, webhook fulfilment, account entitlement writes, Supporter
-- Card issuance, earned spins, wheel runtime, live checkout, or production
-- service mutation.

CREATE TABLE IF NOT EXISTS store_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  purchasing_user_id TEXT NOT NULL,
  purchasing_discord_id_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
    'draft',
    'checkout_created',
    'checkout_expired',
    'cancelled',
    'payment_pending',
    'paid',
    'payment_failed',
    'refunded',
    'disputed',
    'revoked',
    'blocked_by_flag',
    'manual_review'
  )),
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  product_count INTEGER NOT NULL DEFAULT 1 CHECK(product_count = 1),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK(currency = lower(currency) AND currency IN ('gbp')),
  subtotal_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_amount_minor >= 0),
  tax_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_amount_minor >= 0),
  total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(total_amount_minor >= 0 AND total_amount_minor = subtotal_amount_minor + tax_amount_minor),
  selected_theme_key TEXT,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_customer_ref_hash TEXT,
  immutable_product_snapshot_json TEXT NOT NULL DEFAULT '{}',
  immutable_price_snapshot_json TEXT NOT NULL DEFAULT '{}',
  store_flags_snapshot_json TEXT NOT NULL DEFAULT '{}',
  tax_snapshot_json TEXT NOT NULL DEFAULT '{}',
  terms_version TEXT NOT NULL,
  checkout_idempotency_key_hash TEXT UNIQUE,
  checkout_session_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  refunded_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS store_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
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
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity = 1),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK(currency = lower(currency) AND currency IN ('gbp')),
  unit_amount_minor INTEGER NOT NULL CHECK(unit_amount_minor >= 0),
  tax_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_amount_minor >= 0),
  total_amount_minor INTEGER NOT NULL CHECK(total_amount_minor >= 0 AND total_amount_minor = unit_amount_minor + tax_amount_minor),
  item_snapshot_json TEXT NOT NULL DEFAULT '{}',
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id),
  FOREIGN KEY(order_id) REFERENCES store_orders(id),
  FOREIGN KEY(product_id) REFERENCES store_products(id),
  FOREIGN KEY(price_id) REFERENCES store_prices(id)
);

CREATE TABLE IF NOT EXISTS store_payment_events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_class TEXT NOT NULL CHECK(event_class IN ('checkout', 'payment_intent', 'refund', 'dispute', 'ignored')),
  api_version TEXT,
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK(processing_status IN (
    'received',
    'processed',
    'duplicate',
    'ignored',
    'failed',
    'blocked_by_flag',
    'manual_review'
  )),
  related_order_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  stripe_dispute_id TEXT,
  raw_event_sha256 TEXT NOT NULL CHECK(length(raw_event_sha256) = 64 AND raw_event_sha256 = lower(raw_event_sha256)),
  sanitized_summary_json TEXT NOT NULL DEFAULT '{}',
  failure_code TEXT,
  failure_message TEXT,
  fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0),
  entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0),
  supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0),
  FOREIGN KEY(related_order_id) REFERENCES store_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_store_orders_user_status_created
  ON store_orders(purchasing_user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_store_orders_checkout_session
  ON store_orders(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_orders_payment_intent
  ON store_orders(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_orders_status_created
  ON store_orders(status, created_at);

CREATE INDEX IF NOT EXISTS idx_store_order_items_order_id
  ON store_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_store_order_items_product_price
  ON store_order_items(product_id, price_id);

CREATE INDEX IF NOT EXISTS idx_store_payment_events_type_status_received
  ON store_payment_events(event_type, processing_status, received_at);

CREATE INDEX IF NOT EXISTS idx_store_payment_events_related_order
  ON store_payment_events(related_order_id, received_at)
  WHERE related_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_payment_events_checkout_session
  ON store_payment_events(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_payment_events_payment_intent
  ON store_payment_events(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_payment_events_raw_hash
  ON store_payment_events(raw_event_sha256);
