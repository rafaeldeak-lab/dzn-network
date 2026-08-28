-- DZN Store fulfilment ledger schema.
-- Local/sandbox only: adds private schema for future verified Store fulfilment
-- audits and account-bound cosmetic/supporter ledgers. This migration is
-- schema-only and does not fulfil orders, issue cards, mint spins, run the
-- wheel, enable live checkout, or mutate provider/config state.

CREATE TABLE IF NOT EXISTS account_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  source_order_id TEXT NOT NULL,
  source_order_item_id TEXT NOT NULL,
  source_product_key TEXT NOT NULL,
  source_product_type TEXT NOT NULL,
  source_fulfilment_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'suspended', 'revoked', 'manual_review')),
  visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible', 'hidden')),
  granted_by_payment_event_id TEXT NOT NULL,
  revoked_by_payment_event_id TEXT,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suspended_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  status_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  grants_owner_subscription_access INTEGER NOT NULL DEFAULT 0 CHECK(grants_owner_subscription_access = 0),
  grants_spins INTEGER NOT NULL DEFAULT 0 CHECK(grants_spins = 0),
  grants_xp INTEGER NOT NULL DEFAULT 0 CHECK(grants_xp = 0),
  grants_rank_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_rank_advantage = 0),
  grants_discovery_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_discovery_advantage = 0),
  grants_review_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_review_advantage = 0),
  grants_event_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_event_advantage = 0),
  grants_server_wars_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_server_wars_advantage = 0),
  grants_ctf_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_ctf_advantage = 0),
  grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK(grants_competitive_eligibility = 0),
  UNIQUE(source_order_item_id),
  UNIQUE(user_id, entitlement_key, source_order_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(source_order_id) REFERENCES store_orders(id),
  FOREIGN KEY(source_order_item_id) REFERENCES store_order_items(id),
  FOREIGN KEY(granted_by_payment_event_id) REFERENCES store_payment_events(id),
  FOREIGN KEY(revoked_by_payment_event_id) REFERENCES store_payment_events(id)
);

CREATE TABLE IF NOT EXISTS supporter_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL UNIQUE,
  source_order_id TEXT NOT NULL,
  source_order_item_id TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE CHECK(serial_number GLOB 'DZN-SUP-[0-9][0-9][0-9][0-9][0-9][0-9]'),
  card_type TEXT NOT NULL DEFAULT 'founding_supporter' CHECK(card_type IN ('founding_supporter')),
  display_name_snapshot TEXT NOT NULL,
  supporter_since TEXT NOT NULL,
  selected_theme_key TEXT NOT NULL,
  insignia_seed_hash TEXT NOT NULL,
  generated_insignia_json TEXT NOT NULL,
  visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible', 'hidden')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'suspended', 'revoked', 'manual_review')),
  issued_by_payment_event_id TEXT NOT NULL,
  revoked_by_payment_event_id TEXT,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suspended_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  UNIQUE(user_id, card_type),
  UNIQUE(source_order_item_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(entitlement_id) REFERENCES account_entitlements(id),
  FOREIGN KEY(source_order_id) REFERENCES store_orders(id),
  FOREIGN KEY(source_order_item_id) REFERENCES store_order_items(id),
  FOREIGN KEY(issued_by_payment_event_id) REFERENCES store_payment_events(id),
  FOREIGN KEY(revoked_by_payment_event_id) REFERENCES store_payment_events(id)
);

CREATE TABLE IF NOT EXISTS store_fulfilment_attempts (
  id TEXT PRIMARY KEY,
  attempt_key TEXT NOT NULL UNIQUE,
  payment_event_id TEXT NOT NULL UNIQUE,
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  status TEXT NOT NULL CHECK(status IN ('received', 'blocked_by_flag', 'eligible', 'fulfilled', 'duplicate', 'manual_review', 'failed', 'no_op')),
  eligibility_failure_code TEXT,
  entitlement_id TEXT,
  supporter_card_id TEXT,
  fulfilment_flags_snapshot_json TEXT NOT NULL DEFAULT '{}',
  safe_event_summary_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, payment_event_id),
  FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id),
  FOREIGN KEY(order_id) REFERENCES store_orders(id),
  FOREIGN KEY(order_item_id) REFERENCES store_order_items(id),
  FOREIGN KEY(entitlement_id) REFERENCES account_entitlements(id),
  FOREIGN KEY(supporter_card_id) REFERENCES supporter_cards(id)
);

CREATE TABLE IF NOT EXISTS store_order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  payment_event_id TEXT,
  from_status TEXT CHECK(from_status IS NULL OR from_status IN (
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
  to_status TEXT NOT NULL CHECK(to_status IN (
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
  reason_code TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('stripe_webhook', 'system', 'admin_review')),
  safe_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  UNIQUE(order_id, payment_event_id, to_status),
  FOREIGN KEY(order_id) REFERENCES store_orders(id),
  FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id)
);

CREATE TABLE IF NOT EXISTS store_entitlement_status_history (
  id TEXT PRIMARY KEY,
  entitlement_id TEXT,
  supporter_card_id TEXT,
  order_id TEXT NOT NULL,
  payment_event_id TEXT,
  from_status TEXT CHECK(from_status IS NULL OR from_status IN ('active', 'hidden', 'suspended', 'revoked', 'manual_review')),
  to_status TEXT NOT NULL CHECK(to_status IN ('active', 'hidden', 'suspended', 'revoked', 'manual_review')),
  reason_code TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('stripe_webhook', 'system', 'admin_review')),
  safe_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  CHECK(entitlement_id IS NOT NULL OR supporter_card_id IS NOT NULL),
  UNIQUE(entitlement_id, payment_event_id, to_status),
  UNIQUE(supporter_card_id, payment_event_id, to_status),
  FOREIGN KEY(entitlement_id) REFERENCES account_entitlements(id),
  FOREIGN KEY(supporter_card_id) REFERENCES supporter_cards(id),
  FOREIGN KEY(order_id) REFERENCES store_orders(id),
  FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id)
);

CREATE TABLE IF NOT EXISTS store_refund_dispute_audit (
  id TEXT PRIMARY KEY,
  payment_event_id TEXT NOT NULL UNIQUE,
  order_id TEXT,
  event_type TEXT NOT NULL,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  stripe_dispute_id TEXT,
  amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor >= 0),
  currency TEXT CHECK(currency IS NULL OR currency = lower(currency)),
  refund_kind TEXT CHECK(refund_kind IN ('none', 'partial', 'full')),
  dispute_status TEXT,
  local_decision TEXT NOT NULL CHECK(local_decision IN ('recorded', 'suspend', 'revoke', 'restore', 'manual_review', 'ignored')),
  decision_reason TEXT NOT NULL,
  safe_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0),
  FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id),
  FOREIGN KEY(order_id) REFERENCES store_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_user_status_granted
  ON account_entitlements(user_id, status, granted_at);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_order
  ON account_entitlements(source_order_id);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_granted_event
  ON account_entitlements(granted_by_payment_event_id);

CREATE INDEX IF NOT EXISTS idx_supporter_cards_user_status
  ON supporter_cards(user_id, status);

CREATE INDEX IF NOT EXISTS idx_supporter_cards_order
  ON supporter_cards(source_order_id);

CREATE INDEX IF NOT EXISTS idx_supporter_cards_issued_event
  ON supporter_cards(issued_by_payment_event_id);

CREATE INDEX IF NOT EXISTS idx_store_fulfilment_attempts_order_status_created
  ON store_fulfilment_attempts(order_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_store_fulfilment_attempts_stripe_event
  ON store_fulfilment_attempts(stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_store_fulfilment_attempts_status_created
  ON store_fulfilment_attempts(status, created_at);

CREATE INDEX IF NOT EXISTS idx_store_order_status_history_order_created
  ON store_order_status_history(order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_store_order_status_history_status_created
  ON store_order_status_history(to_status, created_at);

CREATE INDEX IF NOT EXISTS idx_store_entitlement_status_history_order_created
  ON store_entitlement_status_history(order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_store_entitlement_status_history_status_created
  ON store_entitlement_status_history(to_status, created_at);

CREATE INDEX IF NOT EXISTS idx_store_refund_dispute_audit_order_created
  ON store_refund_dispute_audit(order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_store_refund_dispute_audit_event_created
  ON store_refund_dispute_audit(event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_store_refund_dispute_audit_decision_created
  ON store_refund_dispute_audit(local_decision, created_at);

CREATE INDEX IF NOT EXISTS idx_store_refund_dispute_audit_refund_id
  ON store_refund_dispute_audit(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_store_refund_dispute_audit_dispute_id
  ON store_refund_dispute_audit(stripe_dispute_id)
  WHERE stripe_dispute_id IS NOT NULL;
