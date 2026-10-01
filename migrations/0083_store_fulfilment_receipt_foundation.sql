-- Inactive DZN Store fulfilment and receipt foundation.
-- This schema is sandbox-only and append-only. It does not activate payments,
-- customer-visible receipts, automated fulfilment, Supporter Cards, or public UI.

CREATE TABLE IF NOT EXISTS store_fulfilment_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  purchasing_user_id TEXT NOT NULL,
  fulfilment_kind TEXT NOT NULL CHECK (fulfilment_kind IN (
    'supporter_card', 'cosmetic_entitlement', 'profile_frame', 'chat_badge', 'theme_pack', 'event_theme'
  )),
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK (ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode = 0),
  automated INTEGER NOT NULL DEFAULT 0 CHECK (automated = 0),
  customer_visible INTEGER NOT NULL DEFAULT 0 CHECK (customer_visible = 0),
  target_snapshot_json TEXT NOT NULL CHECK (
    json_valid(target_snapshot_json) AND json_type(target_snapshot_json) = 'object'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_fulfilment_actions (
  id TEXT PRIMARY KEY,
  fulfilment_request_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (typeof(sequence_number) = 'integer' AND sequence_number >= 1),
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN (
    'pending_operator_review', 'blocked', 'ready', 'completed', 'reversed'
  )),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'request_created', 'operator_blocked', 'operator_cleared', 'operator_completed', 'operator_reversed'
  )),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason = trim(reason) AND length(reason) BETWEEN 3 AND 500),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(evidence_json) AND json_type(evidence_json) = 'object'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(fulfilment_request_id, sequence_number),
  FOREIGN KEY(fulfilment_request_id) REFERENCES store_fulfilment_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (
    (sequence_number = 1 AND from_status IS NULL AND to_status = 'pending_operator_review' AND action_type = 'request_created') OR
    (sequence_number > 1 AND from_status IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS store_receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE CHECK (
    receipt_number = upper(receipt_number) AND
    length(receipt_number) BETWEEN 8 AND 40 AND
    receipt_number NOT GLOB '*[^A-Z0-9-]*'
  ),
  order_id TEXT NOT NULL UNIQUE,
  fulfilment_request_id TEXT NOT NULL UNIQUE,
  purchasing_user_id TEXT NOT NULL,
  receipt_status TEXT NOT NULL DEFAULT 'sandbox_issued' CHECK (receipt_status = 'sandbox_issued'),
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK (ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode = 0),
  customer_visible INTEGER NOT NULL DEFAULT 0 CHECK (customer_visible = 0),
  currency TEXT NOT NULL CHECK (currency = 'gbp'),
  subtotal_amount_minor INTEGER NOT NULL CHECK (typeof(subtotal_amount_minor) = 'integer' AND subtotal_amount_minor > 0),
  tax_amount_minor INTEGER NOT NULL CHECK (typeof(tax_amount_minor) = 'integer' AND tax_amount_minor >= 0),
  total_amount_minor INTEGER NOT NULL CHECK (
    typeof(total_amount_minor) = 'integer' AND total_amount_minor = subtotal_amount_minor + tax_amount_minor
  ),
  order_snapshot_json TEXT NOT NULL CHECK (
    json_valid(order_snapshot_json) AND json_type(order_snapshot_json) = 'object'
  ),
  seller_snapshot_json TEXT NOT NULL CHECK (
    json_valid(seller_snapshot_json) AND json_type(seller_snapshot_json) = 'object'
  ),
  issued_by_user_id TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(fulfilment_request_id) REFERENCES store_fulfilment_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(issued_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS trg_store_fulfilment_request_matches_order
BEFORE INSERT ON store_fulfilment_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM store_orders o
    JOIN store_order_items i ON i.order_id = o.id
    JOIN store_products p ON p.id = i.product_id
    WHERE o.id = NEW.order_id
      AND o.purchasing_user_id = NEW.purchasing_user_id
      AND p.fulfilment_kind = NEW.fulfilment_kind
      AND o.livemode = 0
  ) THEN RAISE(ABORT, 'fulfilment request must match the sandbox order account and product') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_store_fulfilment_requests_immutable
BEFORE UPDATE ON store_fulfilment_requests
BEGIN
  SELECT RAISE(ABORT, 'store fulfilment requests are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_fulfilment_requests_no_delete
BEFORE DELETE ON store_fulfilment_requests
BEGIN
  SELECT RAISE(ABORT, 'store fulfilment requests are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_fulfilment_action_transition
BEFORE INSERT ON store_fulfilment_actions
BEGIN
  SELECT CASE
    WHEN NEW.sequence_number = 1 AND EXISTS (
      SELECT 1 FROM store_fulfilment_actions WHERE fulfilment_request_id = NEW.fulfilment_request_id
    ) THEN RAISE(ABORT, 'initial fulfilment action already exists')
    WHEN NEW.sequence_number > 1 AND NOT EXISTS (
      SELECT 1 FROM store_fulfilment_actions previous
      WHERE previous.fulfilment_request_id = NEW.fulfilment_request_id
        AND previous.sequence_number = NEW.sequence_number - 1
        AND previous.to_status = NEW.from_status
    ) THEN RAISE(ABORT, 'fulfilment action must continue the audited sequence')
    WHEN NEW.action_type = 'request_created' AND NOT (
      NEW.sequence_number = 1 AND NEW.from_status IS NULL AND NEW.to_status = 'pending_operator_review'
    ) THEN RAISE(ABORT, 'request creation must be the initial fulfilment action')
    WHEN NEW.action_type = 'operator_blocked' AND NOT (NEW.from_status IN ('pending_operator_review', 'ready') AND NEW.to_status = 'blocked')
      THEN RAISE(ABORT, 'invalid blocked transition')
    WHEN NEW.action_type = 'operator_cleared' AND NOT (NEW.from_status IN ('pending_operator_review', 'blocked') AND NEW.to_status = 'ready')
      THEN RAISE(ABORT, 'invalid ready transition')
    WHEN NEW.action_type = 'operator_completed' AND NOT (NEW.from_status = 'ready' AND NEW.to_status = 'completed')
      THEN RAISE(ABORT, 'invalid completed transition')
    WHEN NEW.action_type = 'operator_reversed' AND NOT (NEW.from_status = 'completed' AND NEW.to_status = 'reversed')
      THEN RAISE(ABORT, 'invalid reversed transition')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_store_fulfilment_actions_immutable
BEFORE UPDATE ON store_fulfilment_actions
BEGIN
  SELECT RAISE(ABORT, 'store fulfilment actions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_fulfilment_actions_no_delete
BEFORE DELETE ON store_fulfilment_actions
BEGIN
  SELECT RAISE(ABORT, 'store fulfilment actions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_receipt_matches_completed_fulfilment
BEFORE INSERT ON store_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM store_orders o
    JOIN store_fulfilment_requests f ON f.order_id = o.id
    WHERE o.id = NEW.order_id
      AND f.id = NEW.fulfilment_request_id
      AND o.purchasing_user_id = NEW.purchasing_user_id
      AND o.currency = NEW.currency
      AND o.subtotal_amount_minor = NEW.subtotal_amount_minor
      AND o.tax_amount_minor = NEW.tax_amount_minor
      AND o.total_amount_minor = NEW.total_amount_minor
      AND o.livemode = 0
      AND (SELECT a.to_status FROM store_fulfilment_actions a
           WHERE a.fulfilment_request_id = f.id
           ORDER BY a.sequence_number DESC LIMIT 1) = 'completed'
  ) THEN RAISE(ABORT, 'sandbox receipt must match a completed fulfilment and immutable order totals') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_store_receipts_immutable
BEFORE UPDATE ON store_receipts
BEGIN
  SELECT RAISE(ABORT, 'store receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_receipts_no_delete
BEFORE DELETE ON store_receipts
BEGIN
  SELECT RAISE(ABORT, 'store receipts are immutable');
END;

CREATE INDEX IF NOT EXISTS idx_store_fulfilment_requests_user_created
ON store_fulfilment_requests(purchasing_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_fulfilment_actions_request_sequence
ON store_fulfilment_actions(fulfilment_request_id, sequence_number DESC);

CREATE INDEX IF NOT EXISTS idx_store_fulfilment_actions_actor_created
ON store_fulfilment_actions(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_receipts_user_issued
ON store_receipts(purchasing_user_id, issued_at DESC);
