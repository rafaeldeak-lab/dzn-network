import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checklist = readFileSync("docs/STORE_CATALOG_ACTIVATION_CHECKLIST.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

for (const required of [
  "0081_store_catalog_foundation.sql",
  "the only pending production migration",
  "DZN_STORE_ENABLED",
  "DZN_STORE_ADMIN_ENABLED",
  "D1 Time Travel recovery bookmark",
  "PRAGMA foreign_key_check",
  "store_products",
  "store_prices",
  "idx_store_products_status_active",
  "idx_store_prices_product_status",
  "idx_store_prices_stripe_price",
  "Both Store tables contain zero rows immediately after migration.",
  "The public Store remains off after this checklist.",
  "separate schemas, threat review, tests, release approval, and live verification",
]) assert.equal(checklist.includes(required), true, `Store activation checklist should include: ${required}`);

assert.match(checklist, /Stop if any condition is unverified/);
assert.match(checklist, /Do not edit the migration ledger manually/);
assert.match(checklist, /generic instruction[\s\S]*is not sufficient approval/i);
assert.doesNotMatch(checklist, /(?:token|secret|password)\s*[=:]\s*\S+/i);

const scripts = packageJson.scripts ?? {};
assert.equal(typeof scripts["test:store-catalog-foundation"], "string");
assert.equal(scripts["test:store-catalog-foundation"].includes("test-store-catalog-activation-checklist.ts"), true);

for (const [name, command] of Object.entries(scripts)) {
  if (/^test:/.test(name)) continue;
  const appliesMigration = /wrangler\s+d1\s+migrations\s+apply/i.test(command);
  const targetsStore = /(?:0081_store_catalog|DZN_STORE_)/i.test(`${name} ${command}`);
  assert.equal(appliesMigration && targetsStore, false, `${name} must not automate Store production migration application.`);
  assert.doesNotMatch(command, /DZN_STORE_(?:ENABLED|ADMIN_ENABLED)\s*=\s*(?:true|1)/i, `${name} must not automate Store activation.`);
}

console.log("Store catalog activation checklist checks passed.");
