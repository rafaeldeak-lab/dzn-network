-- Immutable operator annotations for Store commerce orders already in manual review.
-- This migration does not change payment, order, fulfilment, receipt, or entitlement state.

CREATE TABLE IF NOT EXISTS store_commerce_manual_review_actions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL UNIQUE CHECK (
    length(request_key) BETWEEN 8 AND 128 AND request_key NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  order_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('note', 'hold', 'escalate')),
  reason TEXT NOT NULL CHECK (reason = trim(reason) AND length(reason) BETWEEN 3 AND 500),
  evidence_category TEXT NOT NULL CHECK (evidence_category IN (
    'none', 'webhook_mode_mismatch', 'payment_state_mismatch', 'stock_conflict',
    'dispute_conflict', 'duplicate_retry', 'other'
  )),
  order_status_snapshot TEXT NOT NULL CHECK (order_status_snapshot = 'manual_review'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_commerce_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS trg_store_manual_review_action_requires_open_order
BEFORE INSERT ON store_commerce_manual_review_actions
WHEN NOT EXISTS (
  SELECT 1 FROM store_commerce_orders
  WHERE id = NEW.order_id AND status = 'manual_review'
)
BEGIN
  SELECT RAISE(ABORT, 'Store order must still require manual review');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_manual_review_actions_immutable
BEFORE UPDATE ON store_commerce_manual_review_actions
BEGIN
  SELECT RAISE(ABORT, 'Store manual-review actions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_manual_review_actions_no_delete
BEFORE DELETE ON store_commerce_manual_review_actions
BEGIN
  SELECT RAISE(ABORT, 'Store manual-review actions are immutable');
END;

CREATE INDEX IF NOT EXISTS idx_store_manual_review_actions_order_created
ON store_commerce_manual_review_actions(order_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_store_manual_review_actions_actor_created
ON store_commerce_manual_review_actions(actor_user_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_store_manual_review_actions_action_created
ON store_commerce_manual_review_actions(action, sequence DESC);
