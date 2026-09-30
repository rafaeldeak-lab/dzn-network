import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import {
  canManageStoreDrafts,
  validateStorePriceDraft,
  validateStoreProductDraft,
} from "../functions/_lib/store-catalog-foundation";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => { exec(sql: string): void; prepare(sql: string): { all(): Array<Record<string, unknown>>; get(): Record<string, unknown> | undefined }; close(): void } };

const migration = readFileSync("migrations/0081_store_catalog_foundation.sql", "utf8");
assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/i);
assert.doesNotMatch(migration, /store_orders|payment_events|account_entitlements|supporter_cards|earned_spins|spin_ledger/i);
assert.match(migration, /active INTEGER NOT NULL DEFAULT 0/);
assert.match(migration, /active INTEGER NOT NULL DEFAULT 0 CHECK \(active = 0\)/);
assert.match(migration, /stripe_price_id TEXT UNIQUE CHECK \(stripe_price_id IS NULL\)/);
assert.doesNotMatch(migration, /'approved'|'paused'|'archived'/);
assert.match(migration, /grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK \(grants_competitive_eligibility = 0\)/);
assert.match(migration, /FOREIGN KEY\(product_id\) REFERENCES store_products\(id\) ON DELETE CASCADE/);

const db = new DatabaseSync(":memory:");
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (id TEXT PRIMARY KEY);
  ${migration}
`);
assert.deepEqual(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'store_%' ORDER BY name").all().map((row) => row.name),
  ["store_prices", "store_products"],
);
const productColumns = db.prepare("PRAGMA table_info('store_products')").all();
assert.equal(productColumns.find((row) => row.name === "active")?.dflt_value, "0");
assert.equal(productColumns.find((row) => row.name === "account_bound")?.dflt_value, "1");
assert.ok(db.prepare("PRAGMA index_list('store_prices')").all().some((row) => row.name === "idx_store_prices_product_status"));
db.exec(`INSERT INTO store_products (
  id, product_key, name, description, product_type, fulfilment_kind
) VALUES (
  'product_001', 'dzn-founding-supporter-pack', 'DZN Founding Supporter Pack',
  'Permanent account-bound supporter recognition.', 'supporter_pack', 'supporter_card'
)`);
assert.throws(() => db.exec("UPDATE store_products SET active = 1 WHERE id = 'product_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_products SET status = 'approved' WHERE id = 'product_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec(`INSERT INTO store_prices (
  id, product_id, currency, unit_amount_minor, stripe_price_id
) VALUES ('price_001', 'product_001', 'gbp', 1000, 'price_live_blocked')`), /CHECK constraint failed/);

assert.equal(canManageStoreDrafts({}, true), false);
assert.equal(canManageStoreDrafts({ DZN_STORE_ENABLED: "true", DZN_STORE_ADMIN_ENABLED: "true" }, false), false);
assert.equal(canManageStoreDrafts({ DZN_STORE_ENABLED: "true", DZN_STORE_ADMIN_ENABLED: "true" }, true), true);

const validProduct = validateStoreProductDraft({
  productKey: "dzn-founding-supporter-pack",
  name: "DZN Founding Supporter Pack",
  description: "Permanent account-bound profile cosmetics and supporter recognition.",
  productType: "supporter_pack",
  fulfilmentKind: "supporter_card",
  accountBound: true,
  guaranteedPurchase: true,
  noCompetitiveAdvantage: true,
  metadataJson: JSON.stringify({ theme: "signal-crown" }),
});
assert.equal(validProduct.ok, true);
if (validProduct.ok) {
  assert.equal(validProduct.value.active, false);
  assert.equal(validProduct.value.metadataJson, '{"theme":"signal-crown"}');
}

for (const unsafe of [
  { active: true },
  { grantsXp: true },
  { grantsCompetitiveEligibility: true },
  { accountBound: false },
  { description: "Buy XP and rank advantages for your account." },
  { name: "XP Pack" },
  { description: "Get a ranking boost with this purchase." },
  { metadataJson: JSON.stringify({ grantsXp: true }) },
  { metadataJson: JSON.stringify({ presentation: { grantsCompetitiveEligibility: true } }) },
]) {
  const result = validateStoreProductDraft({
    productKey: "dzn-profile-theme-pack",
    name: "Profile Theme Pack",
    description: "Guaranteed account-bound profile presentation cosmetics.",
    productType: "profile_theme",
    fulfilmentKind: "theme_pack",
    ...unsafe,
  });
  assert.equal(result.ok, false, JSON.stringify(unsafe));
}

const validPrice = validateStorePriceDraft({ productId: "product_001", currency: "gbp", unitAmountMinor: 1000 });
assert.equal(validPrice.ok, true);
for (const unsafe of [
  { productId: "product_001", currency: "usd", unitAmountMinor: 1000 },
  { productId: "product_001", currency: "gbp", unitAmountMinor: 0 },
  { productId: "product_001", currency: "gbp", unitAmountMinor: 1000, active: true },
  { productId: "product_001", currency: "gbp", unitAmountMinor: 1000, stripePriceId: "price_live" },
  { productId: "product_001", currency: "gbp", unitAmountMinor: 1000, allowPayWhatYouWant: true },
  { productId: "product_001", currency: "gbp", unitAmountMinor: true },
  { productId: "product_001", currency: "gbp", unitAmountMinor: [1000] },
  { productId: "product_001", currency: "gbp", unitAmountMinor: "1000" },
]) assert.equal(validateStorePriceDraft(unsafe).ok, false, JSON.stringify(unsafe));

db.close();
console.log("Store catalog foundation checks passed.");
