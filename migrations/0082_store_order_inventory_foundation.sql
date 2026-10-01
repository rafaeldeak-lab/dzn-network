-- Inactive DZN Store order and inventory foundation.
-- This schema prepares private sandbox ledgers only. It does not add checkout,
-- payments, fulfilment, receipts, Supporter Cards, customer charging, or public UI.

CREATE TABLE IF NOT EXISTS store_inventory_policies (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  stock_mode TEXT NOT NULL CHECK (stock_mode IN ('unlimited', 'finite')),
  stock_limit INTEGER CHECK (
    (stock_mode = 'unlimited' AND stock_limit IS NULL) OR
    (stock_mode = 'finite' AND typeof(stock_limit) = 'integer' AND stock_limit BETWEEN 1 AND 1000000)
  ),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_quantity) = 'integer' AND reserved_quantity >= 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (typeof(sold_quantity) = 'integer' AND sold_quantity >= 0),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active = 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (stock_mode = 'unlimited' OR reserved_quantity + sold_quantity <= stock_limit),
  FOREIGN KEY(product_id) REFERENCES store_products(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store_purchase_policies (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  max_quantity_per_order INTEGER NOT NULL DEFAULT 1 CHECK (max_quantity_per_order = 1),
  lifetime_limit_per_account INTEGER NOT NULL CHECK (
    typeof(lifetime_limit_per_account) = 'integer' AND lifetime_limit_per_account BETWEEN 1 AND 1000
  ),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active = 0),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES store_products(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE CHECK (
    order_number = upper(order_number) AND
    length(order_number) BETWEEN 8 AND 40 AND
    order_number NOT GLOB '*[^A-Z0-9-]*'
  ),
  purchasing_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'cancelled', 'expired', 'blocked_by_flag', 'manual_review'
  )),
  ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK (ledger_scope IN ('local', 'sandbox')),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode = 0),
  product_count INTEGER NOT NULL DEFAULT 1 CHECK (product_count = 1),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK (currency = 'gbp'),
  subtotal_amount_minor INTEGER NOT NULL CHECK (
    typeof(subtotal_amount_minor) = 'integer' AND subtotal_amount_minor > 0 AND subtotal_amount_minor <= 1000000
  ),
  tax_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(tax_amount_minor) = 'integer' AND tax_amount_minor >= 0 AND tax_amount_minor <= 1000000
  ),
  total_amount_minor INTEGER NOT NULL CHECK (
    typeof(total_amount_minor) = 'integer' AND
    total_amount_minor = subtotal_amount_minor + tax_amount_minor AND
    total_amount_minor > 0 AND total_amount_minor <= 1000000
  ),
  catalog_product_snapshot_json TEXT NOT NULL CHECK (
    json_valid(catalog_product_snapshot_json) AND json_type(catalog_product_snapshot_json) = 'object'
  ),
  catalog_price_snapshot_json TEXT NOT NULL CHECK (
    json_valid(catalog_price_snapshot_json) AND json_type(catalog_price_snapshot_json) = 'object'
  ),
  inventory_policy_snapshot_json TEXT NOT NULL CHECK (
    json_valid(inventory_policy_snapshot_json) AND json_type(inventory_policy_snapshot_json) = 'object'
  ),
  purchase_limit_snapshot_json TEXT NOT NULL CHECK (
    json_valid(purchase_limit_snapshot_json) AND json_type(purchase_limit_snapshot_json) = 'object'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  FOREIGN KEY(purchasing_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS store_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL CHECK (
    product_name_snapshot = trim(product_name_snapshot) AND length(product_name_snapshot) BETWEEN 1 AND 120
  ),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  currency TEXT NOT NULL DEFAULT 'gbp' CHECK (currency = 'gbp'),
  unit_amount_minor INTEGER NOT NULL CHECK (
    typeof(unit_amount_minor) = 'integer' AND unit_amount_minor > 0 AND unit_amount_minor <= 1000000
  ),
  tax_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(tax_amount_minor) = 'integer' AND tax_amount_minor >= 0 AND tax_amount_minor <= 1000000
  ),
  total_amount_minor INTEGER NOT NULL CHECK (
    typeof(total_amount_minor) = 'integer' AND
    total_amount_minor = unit_amount_minor + tax_amount_minor AND
    total_amount_minor > 0 AND total_amount_minor <= 1000000
  ),
  account_bound INTEGER NOT NULL DEFAULT 1 CHECK (account_bound = 1),
  guaranteed_purchase INTEGER NOT NULL DEFAULT 1 CHECK (guaranteed_purchase = 1),
  no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK (no_competitive_advantage = 1),
  grants_spins INTEGER NOT NULL DEFAULT 0 CHECK (grants_spins = 0),
  grants_xp INTEGER NOT NULL DEFAULT 0 CHECK (grants_xp = 0),
  grants_rank_advantage INTEGER NOT NULL DEFAULT 0 CHECK (grants_rank_advantage = 0),
  grants_discovery_advantage INTEGER NOT NULL DEFAULT 0 CHECK (grants_discovery_advantage = 0),
  grants_review_advantage INTEGER NOT NULL DEFAULT 0 CHECK (grants_review_advantage = 0),
  grants_event_advantage INTEGER NOT NULL DEFAULT 0 CHECK (grants_event_advantage = 0),
  grants_server_wars_advantage INTEGER NOT NULL DEFAULT 0 CHECK (grants_server_wars_advantage = 0),
  grants_ctf_advantage INTEGER NOT NULL DEFAULT 0 CHECK (grants_ctf_advantage = 0),
  grants_owner_subscription_access INTEGER NOT NULL DEFAULT 0 CHECK (grants_owner_subscription_access = 0),
  grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK (grants_competitive_eligibility = 0),
  item_snapshot_json TEXT NOT NULL CHECK (
    json_valid(item_snapshot_json) AND json_type(item_snapshot_json) = 'object'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES store_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY(product_id) REFERENCES store_products(id) ON DELETE RESTRICT,
  FOREIGN KEY(price_id) REFERENCES store_prices(id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS trg_store_orders_immutable_totals
BEFORE UPDATE OF product_count, currency, subtotal_amount_minor, tax_amount_minor, total_amount_minor,
  catalog_product_snapshot_json, catalog_price_snapshot_json,
  inventory_policy_snapshot_json, purchase_limit_snapshot_json
ON store_orders
BEGIN
  SELECT RAISE(ABORT, 'store order totals and snapshots are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_orders_immutable_identity
BEFORE UPDATE OF order_number, purchasing_user_id, ledger_scope, livemode
ON store_orders
BEGIN
  SELECT RAISE(ABORT, 'store order identity and ledger scope are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_order_items_immutable
BEFORE UPDATE ON store_order_items
BEGIN
  SELECT RAISE(ABORT, 'store order items are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_order_items_no_delete
BEFORE DELETE ON store_order_items
BEGIN
  SELECT RAISE(ABORT, 'store order items are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_store_order_item_matches_order
BEFORE INSERT ON store_order_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM store_orders
    WHERE id = NEW.order_id
      AND currency = NEW.currency
      AND subtotal_amount_minor = NEW.unit_amount_minor
      AND tax_amount_minor = NEW.tax_amount_minor
      AND total_amount_minor = NEW.total_amount_minor
  ) OR NOT EXISTS (
    SELECT 1 FROM store_prices
    WHERE id = NEW.price_id AND product_id = NEW.product_id
  ) THEN RAISE(ABORT, 'store order item totals and catalog references must match') END;
END;

CREATE INDEX IF NOT EXISTS idx_store_inventory_policies_active
ON store_inventory_policies(active, stock_mode, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_purchase_policies_active
ON store_purchase_policies(active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_orders_user_status_created
ON store_orders(purchasing_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_orders_status_created
ON store_orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_store_order_items_product_price
ON store_order_items(product_id, price_id);
