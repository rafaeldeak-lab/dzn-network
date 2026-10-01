import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { all(): Array<Record<string, unknown>>; get(): Record<string, unknown> | undefined };
    close(): void;
  };
};

const catalogMigration = readFileSync("migrations/0081_store_catalog_foundation.sql", "utf8");
const orderMigration = readFileSync("migrations/0082_store_order_inventory_foundation.sql", "utf8");

assert.doesNotMatch(orderMigration, /DROP TABLE|ALTER TABLE|DELETE FROM|TRUNCATE/i);
assert.doesNotMatch(orderMigration, /checkout\.sessions\.create|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/i);
assert.doesNotMatch(orderMigration, /store_payment_events|store_fulfilments|store_receipts|supporter_cards/i);
assert.match(orderMigration, /livemode INTEGER NOT NULL DEFAULT 0 CHECK \(livemode = 0\)/);
assert.match(orderMigration, /active INTEGER NOT NULL DEFAULT 0 CHECK \(active = 0\)/);
assert.match(orderMigration, /trg_store_orders_immutable_totals/);
assert.match(orderMigration, /trg_store_orders_immutable_identity/);
assert.match(orderMigration, /trg_store_order_items_immutable/);
assert.match(orderMigration, /trg_store_order_item_matches_order/);

const db = new DatabaseSync(":memory:");
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id TEXT PRIMARY KEY);
  ${catalogMigration}
  ${orderMigration}
`);

assert.deepEqual(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'store_%' ORDER BY name").all().map((row) => row.name),
  [
    "store_inventory_policies",
    "store_order_items",
    "store_orders",
    "store_prices",
    "store_products",
    "store_purchase_policies",
  ],
);
assert.deepEqual(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_store_%' ORDER BY name").all().map((row) => row.name),
  [
    "trg_store_order_item_matches_order",
    "trg_store_order_items_immutable",
    "trg_store_order_items_no_delete",
    "trg_store_orders_immutable_identity",
    "trg_store_orders_immutable_totals",
  ],
);
assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

db.exec(`
  INSERT INTO users (id) VALUES ('user_001');
  INSERT INTO store_products (
    id, product_key, name, description, product_type, fulfilment_kind
  ) VALUES (
    'product_001', 'dzn-supporter-pack', 'DZN Supporter Pack',
    'Permanent account-bound supporter recognition.', 'supporter_pack', 'supporter_card'
  );
  INSERT INTO store_prices (id, product_id, unit_amount_minor)
  VALUES ('price_001', 'product_001', 1000);
  INSERT INTO store_products (
    id, product_key, name, description, product_type, fulfilment_kind
  ) VALUES (
    'product_002', 'dzn-profile-theme', 'DZN Profile Theme',
    'Permanent account-bound profile presentation.', 'profile_theme', 'theme_pack'
  );
  INSERT INTO store_prices (id, product_id, unit_amount_minor)
  VALUES ('price_002', 'product_002', 1000);
  INSERT INTO store_inventory_policies (
    id, product_id, stock_mode, stock_limit, created_by_user_id, updated_by_user_id
  ) VALUES ('inventory_001', 'product_001', 'finite', 10, 'user_001', 'user_001');
  INSERT INTO store_purchase_policies (
    id, product_id, lifetime_limit_per_account, created_by_user_id, updated_by_user_id
  ) VALUES ('limit_001', 'product_001', 1, 'user_001', 'user_001');
  INSERT INTO store_orders (
    id, order_number, purchasing_user_id, subtotal_amount_minor, tax_amount_minor,
    total_amount_minor, catalog_product_snapshot_json, catalog_price_snapshot_json,
    inventory_policy_snapshot_json, purchase_limit_snapshot_json
  ) VALUES (
    'order_001', 'DZN-ORDER-001', 'user_001', 1000, 200, 1200,
    '{"productKey":"dzn-supporter-pack"}', '{"unitAmountMinor":1000}',
    '{"stockMode":"finite","stockLimit":10}', '{"lifetimeLimitPerAccount":1}'
  );
  INSERT INTO store_order_items (
    id, order_id, product_id, price_id, product_key, product_name_snapshot,
    unit_amount_minor, tax_amount_minor, total_amount_minor, item_snapshot_json
  ) VALUES (
    'item_001', 'order_001', 'product_001', 'price_001', 'dzn-supporter-pack',
    'DZN Supporter Pack', 1000, 200, 1200, '{"quantity":1}'
  );
`);

assert.throws(
  () => db.exec("UPDATE store_orders SET total_amount_minor = 1300, tax_amount_minor = 300 WHERE id = 'order_001'"),
  /immutable/,
);
assert.throws(() => db.exec("UPDATE store_orders SET purchasing_user_id = 'user_changed' WHERE id = 'order_001'"), /immutable/);
assert.throws(() => db.exec("UPDATE store_order_items SET product_name_snapshot = 'Changed' WHERE id = 'item_001'"), /immutable/);
assert.throws(() => db.exec("DELETE FROM store_order_items WHERE id = 'item_001'"), /immutable/);
assert.throws(
  () => db.exec(`INSERT INTO store_order_items (
    id, order_id, product_id, price_id, product_key, product_name_snapshot,
    unit_amount_minor, tax_amount_minor, total_amount_minor, item_snapshot_json
  ) VALUES (
    'item_bad', 'order_001', 'product_001', 'price_001', 'dzn-supporter-pack',
    'DZN Supporter Pack', 900, 200, 1100, '{}'
  )`),
  /must match|UNIQUE constraint failed/,
);
db.exec(`INSERT INTO store_orders (
  id, order_number, purchasing_user_id, subtotal_amount_minor, tax_amount_minor,
  total_amount_minor, catalog_product_snapshot_json, catalog_price_snapshot_json,
  inventory_policy_snapshot_json, purchase_limit_snapshot_json
) VALUES (
  'order_002', 'DZN-ORDER-002', 'user_001', 1000, 0, 1000,
  '{}', '{}', '{}', '{}'
)`);
assert.throws(
  () => db.exec(`INSERT INTO store_order_items (
    id, order_id, product_id, price_id, product_key, product_name_snapshot,
    unit_amount_minor, tax_amount_minor, total_amount_minor, item_snapshot_json
  ) VALUES (
    'item_mismatch', 'order_002', 'product_001', 'price_002', 'dzn-supporter-pack',
    'DZN Supporter Pack', 1000, 0, 1000, '{}'
  )`),
  /catalog references must match/,
);
assert.throws(() => db.exec("UPDATE store_inventory_policies SET reserved_quantity = 11 WHERE id = 'inventory_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_inventory_policies SET active = 1 WHERE id = 'inventory_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_purchase_policies SET active = 1 WHERE id = 'limit_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_purchase_policies SET lifetime_limit_per_account = 0 WHERE id = 'limit_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_purchase_policies SET max_quantity_per_order = 2 WHERE id = 'limit_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_orders SET livemode = 1 WHERE id = 'order_001'"), /immutable/);
assert.throws(() => db.exec("UPDATE store_orders SET status = 'paid' WHERE id = 'order_001'"), /CHECK constraint failed/);

for (const table of ["store_orders", "store_order_items", "store_inventory_policies", "store_purchase_policies"]) {
  assert.ok(db.prepare(`PRAGMA table_info('${table}')`).all().length > 0, `${table} columns should exist.`);
}
const createdIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
for (const index of [
  "idx_store_inventory_policies_active",
  "idx_store_purchase_policies_active",
  "idx_store_orders_user_status_created",
  "idx_store_orders_status_created",
  "idx_store_order_items_product_price",
]) {
  assert.ok(createdIndexes.includes(index), `${index} should be created.`);
}
assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

db.close();
console.log("Store order and inventory foundation checks passed.");
