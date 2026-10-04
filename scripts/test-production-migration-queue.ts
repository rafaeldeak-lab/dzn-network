import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/check-production-migration-queue.ts", "utf8");

assert.match(source, /RUN_READ_ONLY_PRODUCTION_MIGRATION_QUEUE_CHECK/);
assert.match(source, /SELECT name FROM d1_migrations ORDER BY id;/);
assert.equal(
  source.match(/SELECT name FROM d1_migrations ORDER BY id;/g)?.length,
  1,
  "The checker must contain exactly one fixed read-only SQL statement.",
);
assert.match(source, /DZN_EXPECTED_PENDING_MIGRATIONS/);
assert.match(source, /Production ledger contains migrations absent from this checkout/);
assert.match(source, /expectedValue !== undefined/);
assert.match(source, /Duplicate migration prefixes/);
assert.match(source, /databaseName = "dzn_network_db"/);

for (const forbidden of [
  /migrations\s+apply/i,
  /d1["',\s]+execute[\s\S]*--file/i,
  /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|VACUUM)\b/i,
  /pages["',\s]+secret/i,
  /wrangler["',\s]+deploy/i,
  /process\.env\.CLOUDFLARE_API_TOKEN/,
]) {
  assert.doesNotMatch(source, forbidden, `Read-only migration queue checker must reject ${forbidden}.`);
}

console.log("Production migration queue safety tests passed.");
