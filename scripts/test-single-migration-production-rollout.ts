import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/dzn-single-migration-production-rollout.yml", "utf8");
const controller = readFileSync("scripts/dzn-single-migration-production-rollout.ts", "utf8");

const migrations = [
  "0096_games_hub_relay_rush.sql",
  "0097_games_hub_cipher_grid.sql",
  "0098_games_hub_echo_array.sql",
  "0099_games_hub_outpost_run.sql",
  "0100_games_hub_signal_shift.sql",
  "0101_games_hub_circuit_forge.sql",
  "0102_games_hub_ranger_range.sql",
];

assert.match(workflow, /name: DZN Single Migration Production Rollout/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /\n  push:/);
assert.doesNotMatch(workflow, /\n  pull_request:/);
assert.doesNotMatch(workflow, /\n  schedule:/);
assert.match(workflow, /if: github\.ref_name == 'main'/);
assert.match(workflow, /APPLY_EXACTLY_ONE_DZN_MIGRATION/);
assert.match(workflow, /approved_commit must be the exact 40-character main SHA/);
assert.match(workflow, /main HEAD \$\{ROLLOUT_COMMIT\} does not match approved_commit/);
assert.match(workflow, /type: choice/);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /contents: read/);
assert.doesNotMatch(workflow, /contents: write/);
assert.doesNotMatch(workflow, /actions: write/);
assert.doesNotMatch(workflow, /id-token: write/);
assert.doesNotMatch(
  workflow,
  /^      (?:CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN|CLOUDFLARE_API_TOKEN):/m,
  "The production D1 token must never be available to the whole job.",
);
const scopedToken = "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_SERVER_LIFECYCLE_PRODUCTION_TOKEN }}";
assert.equal(
  workflow.split(scopedToken).length - 1,
  5,
  "The production D1 token must be scoped to the five Wrangler-only steps.",
);
assert.ok(
  workflow.indexOf(scopedToken) > workflow.indexOf("- name: Install source dependencies"),
  "Dependency installation must run before any step receives the production D1 token.",
);
assert.doesNotMatch(workflow, /printf "CLOUDFLARE_API_TOKEN=/);
assert.deepEqual(
  workflow
    .split(/\r?\n/)
    .filter((line) => line.includes("${{ inputs."))
    .map((line) => line.trim()),
  [
    "ROLLOUT_CONFIRMATION_INPUT: ${{ inputs.confirm_production_migration }}",
    "APPROVED_COMMIT_INPUT: ${{ inputs.approved_commit }}",
    "MIGRATION_NAME_INPUT: ${{ inputs.migration_name }}",
  ],
  "Workflow dispatch values must be carried through environment variables, never interpolated into shell source.",
);
assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN_FALLBACK/);
assert.match(workflow, /d1 time-travel info/);
assert.doesNotMatch(
  workflow,
  /d1 time-travel info[\s\S]*?--timestamp/,
  "The recovery bookmark must use Cloudflare's current bookmark rather than a truncated client timestamp.",
);
assert.match(workflow, /verify-ledger/);
assert.match(workflow, /verify-baseline/);
assert.match(workflow, /verify-schema/);
assert.match(workflow, /migrations apply/);
assert.equal((workflow.match(/migrations apply/g) ?? []).length, 1, "The workflow must have exactly one migration application command.");
assert.match(workflow, /--config "\$\{MIGRATION_STAGE\}\/wrangler\.toml"/);
assert.match(workflow, /Feature activation: intentionally not performed/);
assert.match(workflow, /Website deployment: intentionally not performed/);

for (const migration of migrations) {
  assert.match(workflow, new RegExp(migration.replace(".", "\\.")));
  assert.match(controller, new RegExp(`"${migration.replace(".", "\\.")}"`));
}

for (const forbidden of [
  /wrangler pages/i,
  /wrangler deploy/i,
  /pages secret/i,
  /discord\.com/i,
  /stripe/i,
  /npx\s+.*nitrado/i,
  /curl\s+.*-X\s*POST/i,
  /d1 execute[\s\S]*--file/i,
]) {
  assert.doesNotMatch(workflow, forbidden, `Production migration workflow must not include ${forbidden}.`);
}

assert.match(controller, /const MIGRATION_PLANS/);
assert.match(controller, /Single-migration rollout targets must be additive schema-only SQL/);
assert.match(controller, /Duplicate migration prefixes/);
assert.match(controller, /migrations_dir = "migrations"/);
assert.match(controller, /Production migration ledger .* verification passed/);
assert.match(controller, /Production zero-object baseline passed/);
assert.match(controller, /Production schema, index, constraint, foreign-key, and zero-row verification passed/);
assert.match(controller, /Expected Wrangler JSON array/);
assert.doesNotMatch(controller, /migrations apply/i);
assert.doesNotMatch(controller, /CLOUDFLARE_API_TOKEN/);
assert.doesNotMatch(controller, /wrangler\s+d1/i);

console.log("Single-migration production rollout safety tests passed.");
