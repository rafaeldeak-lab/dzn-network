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
assert.match(migration, /metadata_json TEXT NOT NULL DEFAULT '\{\}' CHECK \(metadata_json = '\{\}'\)/);
assert.match(migration, /product_key = lower\(product_key\)/);
assert.match(migration, /product_key NOT GLOB '\*\[\^a-z0-9-\]\*'/);
assert.match(migration, /name = trim\(name\) AND length\(name\) BETWEEN 1 AND 120/);
assert.match(migration, /description = trim\(description\) AND length\(description\) BETWEEN 10 AND 1000/);
assert.match(migration, /typeof\(unit_amount_minor\) = 'integer'/);
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
assert.throws(() => db.exec("UPDATE store_products SET metadata_json = 'not json' WHERE id = 'product_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_products SET metadata_json = '[]' WHERE id = 'product_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec(`UPDATE store_products SET metadata_json = '{"grantsXp":true}' WHERE id = 'product_001'`), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_products SET fulfilment_kind = 'event_theme' WHERE id = 'product_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_products SET name = ' ' WHERE id = 'product_001'"), /CHECK constraint failed/);
assert.throws(() => db.exec("UPDATE store_products SET description = 'Too short' WHERE id = 'product_001'"), /CHECK constraint failed/);
for (const productKey of ["PACK", "pack_name", "-pack", "pa", `p${"a".repeat(81)}`]) {
  assert.throws(() => db.exec(`INSERT INTO store_products (
    id, product_key, name, description, product_type, fulfilment_kind
  ) VALUES (
    'product_${productKey.length}', '${productKey}', 'Profile theme',
    'Account-bound profile presentation cosmetics.', 'profile_theme', 'theme_pack'
  )`), /CHECK constraint failed/);
}
assert.throws(() => db.exec(`INSERT INTO store_prices (
  id, product_id, currency, unit_amount_minor, stripe_price_id
) VALUES ('price_001', 'product_001', 'gbp', 1000, 'price_live_blocked')`), /CHECK constraint failed/);
assert.throws(() => db.exec("INSERT INTO store_prices (id, product_id, unit_amount_minor) VALUES ('price_real', 'product_001', 1.5)"), /CHECK constraint failed/);
assert.throws(() => db.exec("INSERT INTO store_prices (id, product_id, unit_amount_minor) VALUES ('price_large', 'product_001', 1000001)"), /CHECK constraint failed/);

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
});
assert.equal(validProduct.ok, true);
if (validProduct.ok) {
  assert.equal(validProduct.value.active, false);
  assert.equal(validProduct.value.metadataJson, '{}');
}

for (const unsafe of [
  { active: true },
  { grantsXp: true },
  { grantsCompetitiveEligibility: true },
  { accountBound: false },
  { name: {} },
  { description: {} },
  { productType: ["profile_theme"] },
  { metadataJson: { theme: "signal-crown" } },
  { description: "Buy XP and rank advantages for your account." },
  { name: "XP Pack" },
  { name: "Rank Boost" },
  { name: "Rank Advantage" },
  { name: "Spin Pack" },
  { name: "Event Advantage Pack" },
  { name: "Competitive Advantage Pack" },
  { name: "Competitive-Advantage Pack" },
  { description: "Get a ranking boost with this purchase." },
  { description: "Includes 10 spins with this purchase." },
  { description: "Cosmetic theme with an event advantage." },
  { description: "Cosmetic theme with an event\nadvantage." },
  { metadataJson: JSON.stringify({ grantsXp: true }) },
  { metadataJson: JSON.stringify({ grants_xp: true }) },
  { metadataJson: JSON.stringify({ "grants-xp": true }) },
  { metadataJson: JSON.stringify({ presentation: { grantsCompetitiveEligibility: true } }) },
  { metadataJson: `${"[".repeat(3950)}0${"]".repeat(3950)}` },
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
  { productId: "product_001", currency: ["gbp"], unitAmountMinor: 1000 },
  { productId: "product_001", currency: "gbp", unitAmountMinor: 1000, minAmountMinor: {} },
  { productId: "product_001", currency: "gbp", unitAmountMinor: 1000, stripePriceId: {} },
]) assert.equal(validateStorePriceDraft(unsafe).ok, false, JSON.stringify(unsafe));

db.close();
console.log("Store catalog foundation checks passed.");
