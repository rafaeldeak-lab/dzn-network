import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(".github/workflows/dzn-state-preserving-migration-production-rollout.yml", "utf8");
const controller = readFileSync("scripts/dzn-state-preserving-migration-production-rollout.ts", "utf8");
const migration = readFileSync("migrations/0106_games_hub_cipher_grid_specialist.sql");

assert.match(workflow, /name: DZN State-Preserving Migration Production Rollout/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /\n  push:/);
assert.doesNotMatch(workflow, /\n  pull_request:/);
assert.doesNotMatch(workflow, /\n  schedule:/);
assert.match(workflow, /if: github\.ref_name == 'main'/);
assert.match(workflow, /APPLY_EXACTLY_ONE_DZN_STATE_PRESERVING_MIGRATION/);
assert.match(workflow, /0106_games_hub_cipher_grid_specialist\.sql/);
assert.match(workflow, /d1 time-travel info/);
assert.match(workflow, /migrations apply/);
assert.equal((workflow.match(/migrations apply/g) ?? []).length, 1, "The workflow must have exactly one migration application command.");
assert.match(workflow, /verify-write-quiesce/);
assert.match(workflow, /https:\/\/dayz-network\.com\/api\/health\/state-preserving-migration/);
assert.match(workflow, /MAINTENANCE_STATUS.*200/);
assert.match(workflow, /test:account-deletion-maintenance/);
assert.match(workflow, /Drain in-flight account-deletion leases before the preservation baseline/);
assert.match(workflow, /DRAIN_ATTEMPTS=30/);
assert.match(workflow, /REQUIRED_CONSECUTIVE_EMPTY_READS=2/);
assert.match(workflow, /verify-account-deletion-leases/);
assert.match(workflow, /hashes only/);
assert.match(workflow, /Feature activation: intentionally not performed/);
assert.match(workflow, /Website deployment: intentionally not performed/);
assert.doesNotMatch(workflow, /wrangler pages/i);
assert.doesNotMatch(workflow, /wrangler deploy/i);
assert.doesNotMatch(workflow, /discord\.com/i);
assert.doesNotMatch(workflow, /stripe/i);

assert.match(controller, /MIGRATION_SHA256/);
assert.match(controller, /source hash does not match the approved data-preservation plan/);
assert.match(controller, /Cipher Grid session fingerprint changed/);
assert.match(controller, /Protected writes are not quiesced/);
assert.match(controller, /dzn_owner_discord_access_role_mutations/);
assert.match(controller, /active_account_deletion_lease_count/);
assert.match(controller, /Account-deletion leases are still active/);
assert.match(controller, /Staging table .* remained/);
assert.match(controller, /foreign_key_check/);
assert.match(controller, /SELECT user_id, id, answer, attempts_json, status, version, started_at, updated_at/);
assert.doesNotMatch(controller, /migrations apply/i);
assert.doesNotMatch(controller, /CLOUDFLARE_API_TOKEN/);

const migrations = readdirSync("migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
assert.equal(migrations[migrations.indexOf("0106_games_hub_cipher_grid_specialist.sql") - 1], "0105_games_hub_night_run_recon.sql");
assert.equal(createHash("sha256").update(migration).digest("hex"), "80554d1d221ce9eeb560c202b978e8376f4f1bd0315681a44e78627f347afb47");

const directory = mkdtempSync(join(process.cwd(), ".dzn-state-migration-test-"));
const wrappedRows = (rows: unknown[]) => JSON.stringify([{ results: rows }]);
const write = (name: string, value: string) => {
  const path = join(directory, name);
  writeFileSync(path, value, "utf8");
  return path;
};
const rows = [{ user_id: "user-a", id: "game-a", answer: "NIGHT", attempts_json: "[]", status: "playing", version: 0, started_at: 1, updated_at: 2 }];
const objects = [{ type: "table", name: "dzn_cipher_grid_sessions", tbl_name: "dzn_cipher_grid_sessions", sql: "CREATE TABLE dzn_cipher_grid_sessions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL UNIQUE, answer TEXT NOT NULL CHECK (length(answer) IN (5, 6) AND answer = upper(answer)), attempts_json TEXT NOT NULL CHECK (json_valid(attempts_json) AND json_type(attempts_json) = 'array'), status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')), version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 6), started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)" }];
const tableInfo = COLUMNS().map((name) => ({ name }));
const foreignKeys = [{ from: "user_id", table: "users", to: "id", on_delete: "CASCADE" }];
const beforeRows = write("before-rows.json", wrappedRows(rows));
const afterRows = write("after-rows.json", wrappedRows(rows));
const beforeFingerprint = join(directory, "before.sha256");
const afterFingerprint = join(directory, "after.sha256");
const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/dzn-state-preserving-migration-production-rollout.ts", ...args], { encoding: "utf8" });

try {
  const quiescedConfig = write("quiesced-wrangler.toml", "[env.production.vars]\nDZN_GAMES_CIPHER_GRID_ENABLED = \"false\"\nDZN_ACCOUNT_DELETE_ENABLED = \"false\"\n");
  const quiesced = run(["verify-write-quiesce", "--config", quiescedConfig]);
  assert.equal(quiesced.status, 0, `${quiesced.stdout}\n${quiesced.stderr}`);
  assert.match(quiesced.stdout, /write paths are source-configured as disabled/);
  const activeConfig = write("active-wrangler.toml", "[env.production.vars]\nDZN_GAMES_CIPHER_GRID_ENABLED = \"true\"\nDZN_ACCOUNT_DELETE_ENABLED = \"false\"\n");
  const active = run(["verify-write-quiesce", "--config", activeConfig]);
  assert.notEqual(active.status, 0, "The rollout must reject an active Cipher Grid write path.");
  assert.match(`${active.stdout}\n${active.stderr}`, /Protected writes are not quiesced/);
  const activeAccountDeleteConfig = write("active-account-delete-wrangler.toml", "[env.production.vars]\nDZN_GAMES_CIPHER_GRID_ENABLED = \"false\"\nDZN_ACCOUNT_DELETE_ENABLED = \"true\"\n");
  const activeAccountDelete = run(["verify-write-quiesce", "--config", activeAccountDeleteConfig]);
  assert.notEqual(activeAccountDelete.status, 0, "The rollout must reject an active account deletion path.");
  assert.match(`${activeAccountDelete.stdout}\n${activeAccountDelete.stderr}`, /DZN_ACCOUNT_DELETE_ENABLED/);

  const noLeases = run(["verify-account-deletion-leases", "--leases", write("no-account-deletion-leases.json", wrappedRows([{ active_account_deletion_lease_count: 0 }]))]);
  assert.equal(noLeases.status, 0, `${noLeases.stdout}\n${noLeases.stderr}`);
  assert.match(noLeases.stdout, /No active account-deletion leases remain/);
  const activeLeases = run(["verify-account-deletion-leases", "--leases", write("active-account-deletion-leases.json", wrappedRows([{ active_account_deletion_lease_count: 1 }]))]);
  assert.notEqual(activeLeases.status, 0, "The rollout must refuse to baseline while an account deletion lease remains active.");
  assert.match(`${activeLeases.stdout}\n${activeLeases.stderr}`, /Account-deletion leases are still active/);
  const leaseQuery = run(["print-account-deletion-lease-query"]);
  assert.equal(leaseQuery.status, 0, leaseQuery.stderr);
  assert.match(leaseQuery.stdout, /operation = 'account_deletion'/);
  assert.match(leaseQuery.stdout, /julianday\(expires_at\)/);

  const before = run(["fingerprint", "--rows", beforeRows]);
  const after = run(["fingerprint", "--rows", afterRows]);
  assert.equal(before.status, 0, before.stderr);
  assert.equal(after.status, 0, after.stderr);
  writeFileSync(beforeFingerprint, before.stdout.trim(), "utf8");
  writeFileSync(afterFingerprint, after.stdout.trim(), "utf8");
  const verified = run([
    "verify-after",
    "--objects", write("objects.json", wrappedRows(objects)),
    "--table-info", write("table-info.json", wrappedRows(tableInfo)),
    "--foreign-keys", write("foreign-keys.json", wrappedRows(foreignKeys)),
    "--foreign-key-check", write("foreign-key-check.json", wrappedRows([])),
    "--before-row-count", write("before-count.json", wrappedRows([{ row_count: 1 }])),
    "--after-row-count", write("after-count.json", wrappedRows([{ row_count: 1 }])),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
  ]);
  assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
  assert.match(verified.stdout, /1 preserved Cipher Grid sessions/);
  writeFileSync(afterFingerprint, "0".repeat(64), "utf8");
  const mismatch = run([
    "verify-after",
    "--objects", join(directory, "objects.json"),
    "--table-info", join(directory, "table-info.json"),
    "--foreign-keys", join(directory, "foreign-keys.json"),
    "--foreign-key-check", join(directory, "foreign-key-check.json"),
    "--before-row-count", join(directory, "before-count.json"),
    "--after-row-count", join(directory, "after-count.json"),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
  ]);
  assert.notEqual(mismatch.status, 0, "The verifier must reject changed session data.");
  assert.match(`${mismatch.stdout}\n${mismatch.stderr}`, /fingerprint changed/);
} finally {
  rmSync(directory, { force: true, recursive: true });
}

console.log("State-preserving migration production rollout safety tests passed.");

function COLUMNS() {
  return ["user_id", "id", "answer", "attempts_json", "status", "version", "started_at", "updated_at"];
}
