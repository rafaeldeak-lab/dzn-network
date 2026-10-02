-- Additive Store commerce runtime. Existing 0081-0083 foundation ledgers remain intact.
-- Public checkout remains controlled by runtime flags and Stripe readiness.

CREATE TABLE IF NOT EXISTS store_catalog_publications (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL UNIQUE CHECK (stripe_price_id GLOB 'price_*' AND length(stripe_price_id) BETWEEN 9 AND 128),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'published', 'paused', 'archived')),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  stock_mode TEXT NOT NULL DEFAULT 'unlimited' CHECK (stock_mode IN ('unlimited', 'finite')),
  stock_limit INTEGER,
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
  lifetime_limit_per_account INTEGER NOT NULL DEFAULT 1 CHECK (lifetime_limit_per_account BETWEEN 1 AND 1000),
  published_by_user_id TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, price_id),
  CHECK ((active = 0) OR (status = 'published' AND published_at IS NOT NULL)),
  CHECK ((stock_mode = 'unlimited' AND stock_limit IS NULL) OR
    (stock_mode = 'finite' AND stock_limit BETWEEN 1 AND 1000000 AND reserved_quantity + sold_quantity <= stock_limit)),
  FOREIGN KEY(product_id) REFERENCES store_products(id) ON DELETE RESTRICT,
  FOREIGN KEY(price_id) REFERENCES store_prices(id) ON DELETE RESTRICT,
  FOREIGN KEY(published_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_commerce_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  purchasing_user_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'checkout_pending' CHECK (status IN (
    'checkout_pending', 'checkout_ready', 'paid', 'fulfilment_pending', 'fulfilled',
    'cancelled', 'expired', 'payment_failed', 'refunded', 'disputed', 'manual_review'
  )),
  stripe_mode TEXT NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK (currency = 'gbp'),
  subtotal_amount_minor INTEGER NOT NULL CHECK (subtotal_amount_minor BETWEEN 1 AND 1000000),
  tax_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount_minor BETWEEN 0 AND 1000000),
  total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor = subtotal_amount_minor + tax_amount_minor),
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  checkout_url_expires_at TEXT,
  immutable_item_snapshot_json TEXT NOT NULL CHECK (json_valid(immutable_item_snapshot_json) AND json_type(immutable_item_snapshot_json) = 'object'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  fulfilled_at TEXT,
  cancelled_at TEXT,
  refunded_at TEXT,
  UNIQUE(purchasing_user_id, request_key),
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY(publication_id) REFERENCES store_catalog_publications(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_commerce_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  fulfilment_kind TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK (currency = 'gbp'),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor BETWEEN 1 AND 1000000),
  total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor = unit_amount_minor),
  no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK (no_competitive_advantage = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_commerce_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id) REFERENCES store_products(id) ON DELETE RESTRICT,
  FOREIGN KEY(price_id) REFERENCES store_prices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_commerce_events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  order_id TEXT,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  raw_body_sha256 TEXT NOT NULL CHECK (length(raw_body_sha256) = 64),
  processing_status TEXT NOT NULL CHECK (processing_status IN ('processed', 'ignored', 'manual_review')),
  safe_summary_json TEXT NOT NULL CHECK (json_valid(safe_summary_json) AND json_type(safe_summary_json) = 'object'),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_commerce_orders(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_commerce_fulfilments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  purchasing_user_id TEXT NOT NULL,
  fulfilment_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'reversed', 'manual_review')),
  entitlement_key TEXT NOT NULL,
  granted_at TEXT,
  reversed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_commerce_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_commerce_receipts (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE,
  purchasing_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'refunded', 'void')),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK (currency = 'gbp'),
  subtotal_amount_minor INTEGER NOT NULL,
  tax_amount_minor INTEGER NOT NULL,
  total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor = subtotal_amount_minor + tax_amount_minor),
  seller_snapshot_json TEXT NOT NULL CHECK (json_valid(seller_snapshot_json) AND json_type(seller_snapshot_json) = 'object'),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_commerce_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS trg_store_catalog_publication_matches_draft
BEFORE INSERT ON store_catalog_publications
WHEN NOT EXISTS (
  SELECT 1 FROM store_products p JOIN store_prices pr ON pr.product_id = p.id
  WHERE p.id = NEW.product_id AND pr.id = NEW.price_id
    AND p.active = 0 AND pr.active = 0
    AND p.status IN ('draft', 'review') AND pr.status IN ('draft', 'review')
    AND p.account_bound = 1 AND p.guaranteed_purchase = 1 AND p.no_competitive_advantage = 1
    AND p.grants_spins = 0 AND p.grants_xp = 0 AND p.grants_rank_advantage = 0
    AND p.grants_discovery_advantage = 0 AND p.grants_review_advantage = 0
    AND p.grants_event_advantage = 0 AND p.grants_server_wars_advantage = 0
    AND p.grants_ctf_advantage = 0 AND p.grants_owner_subscription_access = 0
    AND p.grants_competitive_eligibility = 0 AND pr.currency = 'gbp'
    AND pr.allow_pay_what_you_want = 0 AND pr.min_amount_minor IS NULL AND pr.stripe_price_id IS NULL
)
BEGIN SELECT RAISE(ABORT, 'publication must reference a safe current Store draft'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_orders_immutable
BEFORE UPDATE OF order_number, purchasing_user_id, publication_id, request_key, stripe_mode, livemode,
  currency, subtotal_amount_minor, tax_amount_minor, total_amount_minor, immutable_item_snapshot_json
ON store_commerce_orders
BEGIN SELECT RAISE(ABORT, 'commerce order identity and totals are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_order_stock_guard
BEFORE INSERT ON store_commerce_orders
WHEN NOT EXISTS (
  SELECT 1 FROM store_catalog_publications pub
  WHERE pub.id = NEW.publication_id AND pub.active = 1 AND pub.status = 'published'
    AND (pub.stock_mode = 'unlimited' OR pub.reserved_quantity + pub.sold_quantity < pub.stock_limit)
)
BEGIN SELECT RAISE(ABORT, 'Store item is paused or sold out'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_order_reserve_stock
AFTER INSERT ON store_commerce_orders
BEGIN
  UPDATE store_catalog_publications SET reserved_quantity = reserved_quantity + 1, updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.publication_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_store_catalog_publication_identity_immutable
BEFORE UPDATE OF product_id, price_id, stripe_price_id, published_by_user_id ON store_catalog_publications
BEGIN SELECT RAISE(ABORT, 'Store publication identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_order_items_immutable
BEFORE UPDATE ON store_commerce_order_items
BEGIN SELECT RAISE(ABORT, 'commerce order items are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_order_item_matches_publication
BEFORE INSERT ON store_commerce_order_items
WHEN NOT EXISTS (
  SELECT 1 FROM store_commerce_orders o
  JOIN store_catalog_publications pub ON pub.id = o.publication_id
  JOIN store_products p ON p.id = pub.product_id
  JOIN store_prices pr ON pr.id = pub.price_id
  WHERE o.id = NEW.order_id AND pub.product_id = NEW.product_id AND pub.price_id = NEW.price_id
    AND p.product_key = NEW.product_key AND p.name = NEW.product_name
    AND p.fulfilment_kind = NEW.fulfilment_kind AND pr.currency = NEW.currency
    AND pr.unit_amount_minor = NEW.unit_amount_minor AND o.total_amount_minor = NEW.total_amount_minor
)
BEGIN SELECT RAISE(ABORT, 'commerce order item must match its immutable publication and order'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_order_status_transition
BEFORE UPDATE OF status ON store_commerce_orders
WHEN NOT (
  OLD.status = NEW.status OR
  (OLD.status = 'checkout_pending' AND NEW.status IN ('checkout_ready','cancelled','expired','manual_review')) OR
  (OLD.status = 'checkout_ready' AND NEW.status IN ('paid','fulfilment_pending','fulfilled','cancelled','expired','payment_failed','manual_review')) OR
  (OLD.status = 'paid' AND NEW.status IN ('fulfilment_pending','fulfilled','refunded','disputed','manual_review')) OR
  (OLD.status = 'fulfilment_pending' AND NEW.status IN ('fulfilled','refunded','disputed','manual_review')) OR
  (OLD.status = 'fulfilled' AND NEW.status IN ('refunded','disputed','manual_review')) OR
  (OLD.status = 'disputed' AND NEW.status IN ('fulfilled','refunded','manual_review'))
)
BEGIN SELECT RAISE(ABORT, 'invalid commerce order status transition'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_order_items_no_delete
BEFORE DELETE ON store_commerce_order_items
BEGIN SELECT RAISE(ABORT, 'commerce order items are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_events_immutable
BEFORE UPDATE ON store_commerce_events
BEGIN SELECT RAISE(ABORT, 'commerce payment events are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_store_commerce_events_no_delete
BEFORE DELETE ON store_commerce_events
BEGIN SELECT RAISE(ABORT, 'commerce payment events are immutable'); END;

CREATE INDEX IF NOT EXISTS idx_store_catalog_publications_public ON store_catalog_publications(active, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_commerce_orders_user ON store_commerce_orders(purchasing_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_commerce_orders_status ON store_commerce_orders(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_commerce_events_order ON store_commerce_events(order_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_commerce_fulfilments_user ON store_commerce_fulfilments(purchasing_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_commerce_receipts_user ON store_commerce_receipts(purchasing_user_id, issued_at DESC);
