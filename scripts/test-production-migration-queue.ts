import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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
assert.match(source, /expectedValue === "NONE"/);
assert.match(source, /expectedValue !== undefined/);
assert.match(source, /Duplicate migration prefixes/);
assert.match(source, /databaseName = "dzn_network_db"/);
assert.match(source, /"--config",\s*"wrangler\.toml"/);
assert.match(source, /"--env",\s*"production"/);

const numberedMigrations = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));
const prefixes = numberedMigrations.map((name) => name.slice(0, 4));
assert.equal(new Set(prefixes).size, prefixes.length, "Local migrations must never reuse a production prefix.");
assert.deepEqual(
  numberedMigrations.filter((name) => /^009[0-4]_/.test(name)),
  [
    "0090_server_community_member_sources.sql",
    "0091_server_review_owner_replies.sql",
    "0092_server_public_cache_rank_timestamp.sql",
    "0093_dzn_comms_owner_message_archive.sql",
    "0094_dzn_owner_discord_access.sql",
  ],
  "The source queue must retain the production 0092 history and allocate later additive migrations after it.",
);
assert.match(
  readFileSync("migrations/0092_server_public_cache_rank_timestamp.sql", "utf8"),
  /ALTER TABLE server_public_cache ADD COLUMN network_rank_updated_at TEXT/,
  "The restored 0092 source file must match the live rank-cache schema migration.",
);

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
