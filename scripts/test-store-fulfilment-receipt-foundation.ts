import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { all(): Array<Record<string, unknown>> };
    close(): void;
  };
};

const migrations = ["0081_store_catalog_foundation.sql", "0082_store_order_inventory_foundation.sql", "0083_store_fulfilment_receipt_foundation.sql"]
  .map((name) => readFileSync(`migrations/${name}`, "utf8"));
const migration = migrations[2];

assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE|DELETE FROM|TRUNCATE/i);
assert.doesNotMatch(migration, /STRIPE_|checkout|payment_intent|supporter_cards/i);
assert.match(migration, /livemode INTEGER NOT NULL DEFAULT 0 CHECK \(livemode = 0\)/);
assert.match(migration, /automated INTEGER NOT NULL DEFAULT 0 CHECK \(automated = 0\)/);
assert.match(migration, /customer_visible INTEGER NOT NULL DEFAULT 0 CHECK \(customer_visible = 0\)/);

const db = new DatabaseSync(":memory:");
db.exec(`PRAGMA foreign_keys = ON; CREATE TABLE users (id TEXT PRIMARY KEY); ${migrations.join("\n")}`);
db.exec(`
  INSERT INTO users (id) VALUES ('buyer'), ('operator');
  INSERT INTO store_products (id, product_key, name, description, product_type, fulfilment_kind)
  VALUES ('product', 'dzn-theme', 'DZN Theme', 'Account-bound theme.', 'profile_theme', 'theme_pack');
  INSERT INTO store_prices (id, product_id, unit_amount_minor) VALUES ('price', 'product', 1000);
  INSERT INTO store_orders (id, order_number, purchasing_user_id, subtotal_amount_minor, tax_amount_minor,
    total_amount_minor, catalog_product_snapshot_json, catalog_price_snapshot_json,
    inventory_policy_snapshot_json, purchase_limit_snapshot_json)
  VALUES ('order', 'DZN-ORDER-003', 'buyer', 1000, 200, 1200, '{}', '{}', '{}', '{}');
  INSERT INTO store_order_items (id, order_id, product_id, price_id, product_key, product_name_snapshot,
    unit_amount_minor, tax_amount_minor, total_amount_minor, item_snapshot_json)
  VALUES ('item', 'order', 'product', 'price', 'dzn-theme', 'DZN Theme', 1000, 200, 1200, '{}');
  INSERT INTO store_fulfilment_requests (id, order_id, purchasing_user_id, fulfilment_kind, target_snapshot_json)
  VALUES ('fulfilment', 'order', 'buyer', 'theme_pack', '{"account":"buyer"}');
  INSERT INTO store_fulfilment_actions (id, fulfilment_request_id, sequence_number, from_status, to_status,
    action_type, actor_user_id, reason)
  VALUES ('action-1', 'fulfilment', 1, NULL, 'pending_operator_review', 'request_created', 'operator', 'Manual sandbox request created.');
`);

assert.throws(() => db.exec("UPDATE store_fulfilment_requests SET customer_visible = 1 WHERE id = 'fulfilment'"), /immutable/);
assert.throws(() => db.exec("DELETE FROM store_fulfilment_actions WHERE id = 'action-1'"), /immutable/);
assert.throws(() => db.exec(`INSERT INTO store_fulfilment_actions VALUES
  ('bad-sequence','fulfilment',3,'pending_operator_review','ready','operator_cleared','operator','Skipped sequence.','{}',CURRENT_TIMESTAMP)`), /audited sequence/);
assert.throws(() => db.exec(`INSERT INTO store_fulfilment_actions VALUES
  ('bad-repeat','fulfilment',2,'pending_operator_review','pending_operator_review','request_created','operator','Repeated request.','{}',CURRENT_TIMESTAMP)`), /initial fulfilment action/);
assert.throws(() => db.exec(`INSERT INTO store_receipts (id, receipt_number, order_id, fulfilment_request_id,
  purchasing_user_id, currency, subtotal_amount_minor, tax_amount_minor, total_amount_minor,
  order_snapshot_json, seller_snapshot_json, issued_by_user_id)
  VALUES ('early','DZN-RECEIPT-1','order','fulfilment','buyer','gbp',1000,200,1200,'{}','{}','operator')`), /completed fulfilment/);

db.exec(`
  INSERT INTO store_fulfilment_actions (id, fulfilment_request_id, sequence_number, from_status, to_status,
    action_type, actor_user_id, reason)
  VALUES ('action-2', 'fulfilment', 2, 'pending_operator_review', 'ready', 'operator_cleared', 'operator', 'Sandbox evidence checked.');
  INSERT INTO store_fulfilment_actions (id, fulfilment_request_id, sequence_number, from_status, to_status,
    action_type, actor_user_id, reason)
  VALUES ('action-3', 'fulfilment', 3, 'ready', 'completed', 'operator_completed', 'operator', 'Sandbox fulfilment completed.');
  INSERT INTO store_receipts (id, receipt_number, order_id, fulfilment_request_id, purchasing_user_id,
    currency, subtotal_amount_minor, tax_amount_minor, total_amount_minor, order_snapshot_json,
    seller_snapshot_json, issued_by_user_id)
  VALUES ('receipt','DZN-RECEIPT-003','order','fulfilment','buyer','gbp',1000,200,1200,'{}','{}','operator');
`);

assert.throws(() => db.exec("UPDATE store_receipts SET customer_visible = 1 WHERE id = 'receipt'"), /immutable/);
assert.throws(() => db.exec("DELETE FROM store_receipts WHERE id = 'receipt'"), /immutable/);
assert.throws(() => db.exec(`INSERT INTO store_fulfilment_requests
  (id, order_id, purchasing_user_id, fulfilment_kind, target_snapshot_json)
  VALUES ('wrong', 'order', 'operator', 'theme_pack', '{}')`), /must match/);
assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

for (const table of ["store_fulfilment_requests", "store_fulfilment_actions", "store_receipts"]) {
  assert.ok(db.prepare(`PRAGMA table_info('${table}')`).all().length > 0);
}
for (const index of ["idx_store_fulfilment_requests_user_created", "idx_store_fulfilment_actions_request_sequence",
  "idx_store_fulfilment_actions_actor_created", "idx_store_receipts_user_issued"]) {
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().some((row) => row.name === index));
}

db.close();
console.log("Store fulfilment and receipt foundation checks passed.");
