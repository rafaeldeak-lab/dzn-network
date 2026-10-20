import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  "0105_games_hub_night_run_recon.sql",
  "0107_dzn_command_centre.sql",
  "0108_dzn_survival_command_expeditions.sql",
  "0109_dzn_survival_command_loadouts.sql",
  "0110_games_hub_night_run_route_control.sql",
  "0111_games_hub_circuit_forge_grid_control.sql",
  "0112_dzn_survival_command_field_orders.sql",
  "0113_dzn_server_status_evidence.sql",
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
  6,
  "The production D1 token must be scoped to the six Wrangler-only steps.",
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
assert.match(workflow, /verify-state-preservation-before/);
assert.match(workflow, /verify-state-preservation-after/);
assert.match(workflow, /Private state-preservation baseline captured/);
assert.match(workflow, /survival-command-loadout-migration/);
assert.match(workflow, /night-run-route-control-migration/);
assert.match(workflow, /circuit-forge-grid-control-migration/);
assert.match(workflow, /Drain protected writes before the preservation baseline/);
assert.equal(
  (workflow.match(/MIGRATION_NAME.*0109_dzn_survival_command_loadouts\.sql/g) ?? []).length,
  1,
  "The 0109 migration must remain explicitly gated by protected-write maintenance and draining.",
);
assert.ok(
  (workflow.match(/MIGRATION_NAME.*0110_games_hub_night_run_route_control\.sql/g) ?? []).length >= 2,
  "The 0110 migration must remain explicitly gated by protected-write maintenance and draining.",
);
assert.ok(
  (workflow.match(/MIGRATION_NAME.*0111_games_hub_circuit_forge_grid_control\.sql/g) ?? []).length >= 2,
  "The 0111 migration must remain explicitly gated by protected-write maintenance and draining.",
);
assert.ok(
  (workflow.match(/MIGRATION_NAME.*0112_dzn_survival_command_field_orders\.sql/g) ?? []).length >= 2,
  "The 0112 migration must remain explicitly gated by protected-write maintenance and draining.",
);
assert.match(workflow, /0109_dzn_survival_command_loadouts\.sql\)[\s\S]*?survival-command-loadout-maintenance/);
assert.match(workflow, /0110_games_hub_night_run_route_control\.sql\)[\s\S]*?night-run-route-control-maintenance/);
assert.match(workflow, /0112_dzn_survival_command_field_orders\.sql\)[\s\S]*?survival-command-field-orders-maintenance/);
assert.match(workflow, /REQUIRED_CONSECUTIVE_EMPTY_READS=2/);
assert.match(workflow, /test:survival-command-loadout-migration-maintenance/);
assert.match(workflow, /test:night-run-route-control-migration-maintenance/);
assert.match(workflow, /test:circuit-forge-grid-control-migration-maintenance/);
assert.match(workflow, /test:survival-command-field-orders-migration-maintenance/);
assert.match(workflow, /test:server-status-evidence-migration/);
assert.match(workflow, /SESSION_LABEL="Night Run"/);
assert.match(workflow, /SESSION_LABEL="Circuit Forge"/);
assert.match(workflow, /SESSION_LABEL="Survival Command"/);
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
assert.match(controller, /source hash does not match the approved state-preservation plan/);
assert.match(controller, /Production state preservation, default initialization, constraints, and foreign keys passed/);
assert.match(controller, /internal_account_deletion_operation/);
assert.match(controller, /Account-deletion operations are still active/);
assert.match(controller, /Expected Wrangler JSON array/);
assert.doesNotMatch(controller, /migrations apply/i);
assert.doesNotMatch(controller, /CLOUDFLARE_API_TOKEN/);
assert.doesNotMatch(controller, /wrangler\s+d1/i);

const migrationNames = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));
const relayRushIndex = migrationNames.indexOf("0096_games_hub_relay_rush.sql");
assert.ok(relayRushIndex > 0, "Relay Rush must have an established predecessor.");
const commandCentreIndex = migrationNames.indexOf("0107_dzn_command_centre.sql");
assert.ok(commandCentreIndex > 0, "Command Centre must have an established predecessor.");
const survivalExpeditionsIndex = migrationNames.indexOf("0108_dzn_survival_command_expeditions.sql");
assert.ok(survivalExpeditionsIndex > commandCentreIndex, "Survival Command expeditions must follow Command Centre.");
const survivalLoadoutsIndex = migrationNames.indexOf("0109_dzn_survival_command_loadouts.sql");
assert.equal(migrationNames[survivalLoadoutsIndex - 1], "0108_dzn_survival_command_expeditions.sql");
const survivalFieldOrdersIndex = migrationNames.indexOf("0112_dzn_survival_command_field_orders.sql");
assert.equal(migrationNames[survivalFieldOrdersIndex - 1], "0111_games_hub_circuit_forge_grid_control.sql");
const serverStatusEvidenceIndex = migrationNames.indexOf("0113_dzn_server_status_evidence.sql");
assert.equal(serverStatusEvidenceIndex, survivalFieldOrdersIndex + 1, "Per-server status evidence must follow the field-order migration.");

function verifyLedger(names: string[]) {
  const directory = mkdtempSync(join(process.cwd(), ".dzn-migration-ledger-test-"));
  const ledgerPath = join(directory, "ledger.json");
  writeFileSync(ledgerPath, JSON.stringify([{ results: names.map((name) => ({ name })) }]), "utf8");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs",
        "scripts/dzn-single-migration-production-rollout.ts",
        "verify-ledger",
        "--migration",
        "0096_games_hub_relay_rush.sql",
        "--ledger",
        ledgerPath,
        "--phase",
        "before",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.error, undefined, `Could not run the ledger verifier: ${result.error?.message ?? "unknown error"}`);
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const expectedBeforeRelayRush = migrationNames.slice(0, relayRushIndex);
const historicalLedgerOrder = expectedBeforeRelayRush.filter((name) => name !== "0065_dzn_comms_read_history.sql");
historicalLedgerOrder.splice(
  historicalLedgerOrder.indexOf("0076_public_profile_discord_identity_consent.sql") + 1,
  0,
  "0065_dzn_comms_read_history.sql",
);

const reorderedLedger = verifyLedger(historicalLedgerOrder);
assert.equal(reorderedLedger.status, 0, reorderedLedger.output);
assert.match(reorderedLedger.output, /ledger before verification passed/);

const missingLedger = verifyLedger(historicalLedgerOrder.filter((name) => name !== "0095_dzn_owner_discord_delivery.sql"));
assert.notEqual(missingLedger.status, 0, "The verifier must reject a missing predecessor migration.");
assert.match(missingLedger.output, /Missing names: 0095_dzn_owner_discord_delivery\.sql/);

const unexpectedLedger = verifyLedger([...historicalLedgerOrder, "9999_unexpected.sql"]);
assert.notEqual(unexpectedLedger.status, 0, "The verifier must reject an unexpected migration name.");
assert.match(unexpectedLedger.output, /Unexpected names: 9999_unexpected\.sql/);

const commandCentreDirectory = mkdtempSync(join(process.cwd(), ".dzn-command-centre-migration-test-"));
try {
  const ledgerPath = join(commandCentreDirectory, "ledger.json");
  writeFileSync(ledgerPath, JSON.stringify([{ results: migrationNames.slice(0, commandCentreIndex).map((name) => ({ name })) }]), "utf8");
  const commandCentreLedger = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/dzn-single-migration-production-rollout.ts",
      "verify-ledger",
      "--migration",
      "0107_dzn_command_centre.sql",
      "--ledger",
      ledgerPath,
      "--phase",
      "before",
    ],
    { encoding: "utf8" },
  );
  assert.equal(commandCentreLedger.status, 0, `${commandCentreLedger.stdout ?? ""}${commandCentreLedger.stderr ?? ""}`);

  const stageDirectory = join(commandCentreDirectory, "stage");
  const commandCentreStage = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/dzn-single-migration-production-rollout.ts",
      "prepare",
      "--migration",
      "0107_dzn_command_centre.sql",
      "--stage-dir",
      stageDirectory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(commandCentreStage.status, 0, `${commandCentreStage.stdout ?? ""}${commandCentreStage.stderr ?? ""}`);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    expectedObjectSql: Record<string, string>;
  };
  assert.deepEqual(Object.keys(prepared.expectedObjectSql).sort(), [
    "dzn_command_centre_buildings",
    "dzn_command_centre_profiles",
    "dzn_command_centre_spend_ledger",
    "idx_dzn_command_centre_buildings_state",
    "idx_dzn_command_centre_spend_history",
  ]);
} finally {
  rmSync(commandCentreDirectory, { force: true, recursive: true });
}

const survivalExpeditionsDirectory = mkdtempSync(join(process.cwd(), ".dzn-survival-expeditions-migration-test-"));
try {
  const ledgerPath = join(survivalExpeditionsDirectory, "ledger.json");
  writeFileSync(ledgerPath, JSON.stringify([{ results: migrationNames.slice(0, survivalExpeditionsIndex).map((name) => ({ name })) }]), "utf8");
  const survivalExpeditionsLedger = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/dzn-single-migration-production-rollout.ts",
      "verify-ledger",
      "--migration",
      "0108_dzn_survival_command_expeditions.sql",
      "--ledger",
      ledgerPath,
      "--phase",
      "before",
    ],
    { encoding: "utf8" },
  );
  assert.equal(survivalExpeditionsLedger.status, 0, `${survivalExpeditionsLedger.stdout ?? ""}${survivalExpeditionsLedger.stderr ?? ""}`);

  const stageDirectory = join(survivalExpeditionsDirectory, "stage");
  const survivalExpeditionsStage = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/dzn-single-migration-production-rollout.ts",
      "prepare",
      "--migration",
      "0108_dzn_survival_command_expeditions.sql",
      "--stage-dir",
      stageDirectory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(survivalExpeditionsStage.status, 0, `${survivalExpeditionsStage.stdout ?? ""}${survivalExpeditionsStage.stderr ?? ""}`);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    migration: { predecessor: string; tables: Array<{ name: string; foreignKeys: Array<{ from: string; table: string; to: string; onDelete: string }> }> };
    expectedObjectSql: Record<string, string>;
  };
  assert.equal(prepared.migration.predecessor, "0107_dzn_command_centre.sql");
  assert.deepEqual(Object.keys(prepared.expectedObjectSql).sort(), [
    "dzn_survival_command_expeditions",
    "dzn_survival_command_profiles",
    "dzn_survival_command_resolution_ledger",
    "idx_dzn_survival_command_expeditions_daily",
    "idx_dzn_survival_command_expeditions_user_recent",
    "idx_dzn_survival_command_one_active_expedition",
    "idx_dzn_survival_command_resolution_history",
  ]);
  assert.match(
    prepared.expectedObjectSql.idx_dzn_survival_command_one_active_expedition,
    /^CREATE UNIQUE INDEX idx_dzn_survival_command_one_active_expedition /,
  );
  assert.deepEqual(
    prepared.migration.tables.find((table) => table.name === "dzn_survival_command_resolution_ledger")?.foreignKeys,
    [
      { from: "user_id", table: "users", to: "id", onDelete: "CASCADE" },
      { from: "expedition_id", table: "dzn_survival_command_expeditions", to: "id", onDelete: "CASCADE" },
    ],
  );
} finally {
  rmSync(survivalExpeditionsDirectory, { force: true, recursive: true });
}

const survivalLoadoutsDirectory = mkdtempSync(join(process.cwd(), ".dzn-survival-loadouts-migration-test-"));
try {
  const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/dzn-single-migration-production-rollout.ts", ...args], { encoding: "utf8" });
  const wrappedRows = (rows: unknown[]) => JSON.stringify([{ results: rows }]);
  const write = (name: string, value: string) => {
    const path = join(survivalLoadoutsDirectory, name);
    writeFileSync(path, value, "utf8");
    return path;
  };
  const ledgerPath = write("ledger.json", wrappedRows(migrationNames.slice(0, survivalLoadoutsIndex).map((name) => ({ name }))));
  const loadoutsLedger = run(["verify-ledger", "--migration", "0109_dzn_survival_command_loadouts.sql", "--ledger", ledgerPath, "--phase", "before"]);
  assert.equal(loadoutsLedger.status, 0, `${loadoutsLedger.stdout ?? ""}${loadoutsLedger.stderr ?? ""}`);

  const stageDirectory = join(survivalLoadoutsDirectory, "stage");
  const preparedStage = run(["prepare", "--migration", "0109_dzn_survival_command_loadouts.sql", "--stage-dir", stageDirectory]);
  assert.equal(preparedStage.status, 0, `${preparedStage.stdout ?? ""}${preparedStage.stderr ?? ""}`);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    migration: { statePreservation?: { sourceHash: string; addedColumns: Array<{ name: string; expectedValue: string }> } };
    expectedObjectSql: Record<string, string>;
  };
  assert.equal(prepared.migration.statePreservation?.sourceHash, "80cbe71073858d889f617c423b6b0f0a43cb89d1d52788ed4fcc519e2a20ad43");
  assert.deepEqual(prepared.migration.statePreservation?.addedColumns, [{ name: "loadout", expectedValue: "field_kit" }]);
  assert.deepEqual(Object.keys(prepared.expectedObjectSql).sort(), [
    "dzn_survival_command_loadout_unlocks",
    "dzn_survival_command_spend_ledger",
    "idx_dzn_survival_command_loadout_history",
  ]);

  const expeditionRow = {
    id: "expedition-a",
    user_id: "user-a",
    request_id: "request-a",
    sector: "perimeter",
    approach: "scout",
    status: "deployed",
    seed: "abcdefghijklmnop",
    deployment_day: "2026-10-19",
    deployment_cost: 1,
    started_at: 1,
    ready_at: 2,
    resolved_at: null,
    version: 0,
  };
  const beforeObjects = write("before-objects.json", wrappedRows([{
    type: "table",
    name: "dzn_survival_command_expeditions",
    tbl_name: "dzn_survival_command_expeditions",
    sql: "CREATE TABLE dzn_survival_command_expeditions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL, sector TEXT NOT NULL CHECK (sector IN ('perimeter', 'rail_yard', 'radio_ridge', 'blacksite')), approach TEXT NOT NULL CHECK (approach IN ('scout', 'balanced', 'breach')), status TEXT NOT NULL, seed TEXT NOT NULL, deployment_day TEXT NOT NULL, deployment_cost INTEGER NOT NULL, started_at INTEGER NOT NULL, ready_at INTEGER NOT NULL, resolved_at INTEGER, version INTEGER NOT NULL DEFAULT 0, UNIQUE (user_id, request_id))",
  }]));
  const beforeInfo = write("before-info.json", wrappedRows(["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version"].map((name) => ({ name }))));
  const foreignKeys = write("foreign-keys.json", wrappedRows([{ from: "user_id", table: "users", to: "id", on_delete: "CASCADE" }]));
  const foreignKeyCheck = write("foreign-key-check.json", wrappedRows([]));
  const operationQuery = run(["print-account-deletion-operation-query"]);
  assert.equal(operationQuery.status, 0, operationQuery.stderr);
  assert.match(operationQuery.stdout, /FROM user_notifications/);
  const drainedOperations = run(["verify-account-deletion-operations", "--operations", write("drained-operations.json", wrappedRows([{ active_account_deletion_operation_count: 0 }]))]);
  assert.equal(drainedOperations.status, 0, `${drainedOperations.stdout ?? ""}${drainedOperations.stderr ?? ""}`);
  const activeOperations = run(["verify-account-deletion-operations", "--operations", write("active-operations.json", wrappedRows([{ active_account_deletion_operation_count: 1 }]))]);
  assert.notEqual(activeOperations.status, 0, "The rollout must reject an active account deletion operation.");
  assert.match(`${activeOperations.stdout ?? ""}${activeOperations.stderr ?? ""}`, /Account-deletion operations are still active/);
  const baseline = run(["verify-state-preservation-before", "--migration", "0109_dzn_survival_command_loadouts.sql", "--objects", beforeObjects, "--table-info", beforeInfo, "--foreign-keys", foreignKeys, "--foreign-key-check", foreignKeyCheck]);
  assert.equal(baseline.status, 0, `${baseline.stdout ?? ""}${baseline.stderr ?? ""}`);

  const beforeRows = write("before-rows.json", wrappedRows([expeditionRow]));
  const afterRows = write("after-rows.json", wrappedRows([expeditionRow]));
  const beforeFingerprint = join(survivalLoadoutsDirectory, "before.sha256");
  const afterFingerprint = join(survivalLoadoutsDirectory, "after.sha256");
  const beforeHash = run(["fingerprint", "--rows", beforeRows]);
  const afterHash = run(["fingerprint", "--rows", afterRows]);
  assert.equal(beforeHash.status, 0, beforeHash.stderr);
  assert.equal(afterHash.status, 0, afterHash.stderr);
  writeFileSync(beforeFingerprint, beforeHash.stdout.trim(), "utf8");
  writeFileSync(afterFingerprint, afterHash.stdout.trim(), "utf8");
  const afterObjects = write("after-objects.json", wrappedRows([{
    type: "table",
    name: "dzn_survival_command_expeditions",
    tbl_name: "dzn_survival_command_expeditions",
    sql: "CREATE TABLE dzn_survival_command_expeditions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL, sector TEXT NOT NULL CHECK (sector IN ('perimeter', 'rail_yard', 'radio_ridge', 'blacksite')), approach TEXT NOT NULL CHECK (approach IN ('scout', 'balanced', 'breach')), status TEXT NOT NULL, seed TEXT NOT NULL, deployment_day TEXT NOT NULL, deployment_cost INTEGER NOT NULL, started_at INTEGER NOT NULL, ready_at INTEGER NOT NULL, resolved_at INTEGER, version INTEGER NOT NULL DEFAULT 0, UNIQUE (user_id, request_id), loadout TEXT NOT NULL DEFAULT 'field_kit' CHECK (loadout IN ('field_kit', 'signal_scanner', 'recovery_kit', 'convoy_plating')))",
  }]));
  const afterInfo = write("after-info.json", wrappedRows(["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout"].map((name) => ({ name }))));
  const verified = run([
    "verify-state-preservation-after",
    "--migration", "0109_dzn_survival_command_loadouts.sql",
    "--objects", afterObjects,
    "--table-info", afterInfo,
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", write("before-count.json", wrappedRows([{ row_count: 1 }])),
    "--after-row-count", write("after-count.json", wrappedRows([{ row_count: 1 }])),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("defaults.json", wrappedRows([{ id: "expedition-a", loadout: "field_kit" }])),
  ]);
  assert.equal(verified.status, 0, `${verified.stdout ?? ""}${verified.stderr ?? ""}`);
  assert.match(verified.stdout, /1 dzn_survival_command_expeditions rows retained/);

  const incorrectDefault = run([
    "verify-state-preservation-after",
    "--migration", "0109_dzn_survival_command_loadouts.sql",
    "--objects", afterObjects,
    "--table-info", afterInfo,
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", join(survivalLoadoutsDirectory, "before-count.json"),
    "--after-row-count", join(survivalLoadoutsDirectory, "after-count.json"),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("incorrect-defaults.json", wrappedRows([{ id: "expedition-a", loadout: "signal_scanner" }])),
  ]);
  assert.notEqual(incorrectDefault.status, 0, "The verifier must reject an incorrect default for preserved expedition rows.");
  assert.match(`${incorrectDefault.stdout ?? ""}${incorrectDefault.stderr ?? ""}`, /was not initialized to field_kit/);
} finally {
  rmSync(survivalLoadoutsDirectory, { force: true, recursive: true });
}

const nightRunRouteControlDirectory = mkdtempSync(join(process.cwd(), ".dzn-night-run-route-control-migration-test-"));
try {
  const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/dzn-single-migration-production-rollout.ts", ...args], { encoding: "utf8" });
  const wrappedRows = (rows: unknown[]) => JSON.stringify([{ results: rows }]);
  const write = (name: string, value: string) => {
    const path = join(nightRunRouteControlDirectory, name);
    writeFileSync(path, value, "utf8");
    return path;
  };
  const routeControlIndex = migrationNames.indexOf("0110_games_hub_night_run_route_control.sql");
  assert.equal(migrationNames[routeControlIndex - 1], "0109_dzn_survival_command_loadouts.sql");
  const ledgerPath = write("ledger.json", wrappedRows(migrationNames.slice(0, routeControlIndex).map((name) => ({ name }))));
  const routeControlLedger = run(["verify-ledger", "--migration", "0110_games_hub_night_run_route_control.sql", "--ledger", ledgerPath, "--phase", "before"]);
  assert.equal(routeControlLedger.status, 0, `${routeControlLedger.stdout ?? ""}${routeControlLedger.stderr ?? ""}`);

  const stageDirectory = join(nightRunRouteControlDirectory, "stage");
  const preparedStage = run(["prepare", "--migration", "0110_games_hub_night_run_route_control.sql", "--stage-dir", stageDirectory]);
  assert.equal(preparedStage.status, 0, `${preparedStage.stdout ?? ""}${preparedStage.stderr ?? ""}`);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    migration: { statePreservation?: { sourceHash: string; addedColumns: Array<{ name: string; expectedValue: string }> } };
    expectedObjectSql: Record<string, string>;
  };
  assert.equal(prepared.migration.statePreservation?.sourceHash, "97c632a2d541eaeb480b9a4f455678abf139de69df0aedc9bdb47b9376126f22");
  assert.deepEqual(prepared.migration.statePreservation?.addedColumns, [
    { name: "decoy_armed", expectedValue: "0" },
    { name: "decoy_used", expectedValue: "0" },
    { name: "burst_used", expectedValue: "0" },
    { name: "gate_extension_ms", expectedValue: "0" },
  ]);
  assert.deepEqual(Object.keys(prepared.expectedObjectSql), ["idx_dzn_night_run_route_control"]);

  const row = {
    user_id: "user-a",
    id: "night-run-a",
    lane_sequence_json: "[\"left\",\"centre\",\"right\"]",
    gate_index: 2,
    collisions: 0,
    status: "playing",
    version: 4,
    gate_started_at: 1,
    started_at: 2,
    updated_at: 3,
  };
  const beforeSql = "CREATE TABLE dzn_night_run_sessions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL UNIQUE, lane_sequence_json TEXT NOT NULL CHECK (json_valid(lane_sequence_json) AND json_type(lane_sequence_json) = 'array'), gate_index INTEGER NOT NULL DEFAULT 0 CHECK (gate_index BETWEEN 0 AND 9), collisions INTEGER NOT NULL DEFAULT 0 CHECK (collisions BETWEEN 0 AND 2), status TEXT NOT NULL DEFAULT 'playing', version INTEGER NOT NULL DEFAULT 0, gate_started_at INTEGER NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)";
  const afterSql = `${beforeSql.slice(0, -1)}, decoy_armed INTEGER NOT NULL DEFAULT 0 CHECK (decoy_armed IN (0, 1)), decoy_used INTEGER NOT NULL DEFAULT 0 CHECK (decoy_used IN (0, 1)), burst_used INTEGER NOT NULL DEFAULT 0 CHECK (burst_used IN (0, 1)), gate_extension_ms INTEGER NOT NULL DEFAULT 0 CHECK (gate_extension_ms IN (0, 900)))`;
  const columns = ["user_id", "id", "lane_sequence_json", "gate_index", "collisions", "status", "version", "gate_started_at", "started_at", "updated_at"];
  const foreignKeys = write("foreign-keys.json", wrappedRows([{ from: "user_id", table: "users", to: "id", on_delete: "CASCADE" }]));
  const foreignKeyCheck = write("foreign-key-check.json", wrappedRows([]));
  const baseline = run([
    "verify-state-preservation-before",
    "--migration", "0110_games_hub_night_run_route_control.sql",
    "--objects", write("before-objects.json", wrappedRows([{ type: "table", name: "dzn_night_run_sessions", tbl_name: "dzn_night_run_sessions", sql: beforeSql }])),
    "--table-info", write("before-info.json", wrappedRows(columns.map((name) => ({ name })))),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
  ]);
  assert.equal(baseline.status, 0, `${baseline.stdout ?? ""}${baseline.stderr ?? ""}`);
  const beforeRows = write("before-rows.json", wrappedRows([row]));
  const afterRows = write("after-rows.json", wrappedRows([row]));
  const beforeFingerprint = join(nightRunRouteControlDirectory, "before.sha256");
  const afterFingerprint = join(nightRunRouteControlDirectory, "after.sha256");
  const beforeHash = run(["fingerprint", "--rows", beforeRows]);
  const afterHash = run(["fingerprint", "--rows", afterRows]);
  assert.equal(beforeHash.status, 0, beforeHash.stderr);
  assert.equal(afterHash.status, 0, afterHash.stderr);
  writeFileSync(beforeFingerprint, beforeHash.stdout.trim(), "utf8");
  writeFileSync(afterFingerprint, afterHash.stdout.trim(), "utf8");
  const defaultQuery = run(["print-state-preservation-defaults-query", "--migration", "0110_games_hub_night_run_route_control.sql"]);
  assert.equal(defaultQuery.status, 0, defaultQuery.stderr);
  assert.match(defaultQuery.stdout, /SELECT id, decoy_armed, decoy_used, burst_used, gate_extension_ms FROM dzn_night_run_sessions/);
  const verified = run([
    "verify-state-preservation-after",
    "--migration", "0110_games_hub_night_run_route_control.sql",
    "--objects", write("after-objects.json", wrappedRows([{ type: "table", name: "dzn_night_run_sessions", tbl_name: "dzn_night_run_sessions", sql: afterSql }])),
    "--table-info", write("after-info.json", wrappedRows([...columns, "decoy_armed", "decoy_used", "burst_used", "gate_extension_ms"].map((name) => ({ name })))),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", write("before-count.json", wrappedRows([{ row_count: 1 }])),
    "--after-row-count", write("after-count.json", wrappedRows([{ row_count: 1 }])),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("defaults.json", wrappedRows([{ id: "night-run-a", decoy_armed: 0, decoy_used: 0, burst_used: 0, gate_extension_ms: 0 }])),
  ]);
  assert.equal(verified.status, 0, `${verified.stdout ?? ""}${verified.stderr ?? ""}`);
  assert.match(verified.stdout, /1 dzn_night_run_sessions rows retained/);
  const incorrectDefault = run([
    "verify-state-preservation-after",
    "--migration", "0110_games_hub_night_run_route_control.sql",
    "--objects", join(nightRunRouteControlDirectory, "after-objects.json"),
    "--table-info", join(nightRunRouteControlDirectory, "after-info.json"),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", join(nightRunRouteControlDirectory, "before-count.json"),
    "--after-row-count", join(nightRunRouteControlDirectory, "after-count.json"),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("incorrect-defaults.json", wrappedRows([{ id: "night-run-a", decoy_armed: 0, decoy_used: 1, burst_used: 0, gate_extension_ms: 0 }])),
  ]);
  assert.notEqual(incorrectDefault.status, 0, "The verifier must reject any incorrect default for a preserved Night Run session.");
  assert.match(`${incorrectDefault.stdout ?? ""}${incorrectDefault.stderr ?? ""}`, /decoy_used was not initialized to 0/);
} finally {
  rmSync(nightRunRouteControlDirectory, { force: true, recursive: true });
}

const circuitForgeGridControlDirectory = mkdtempSync(join(process.cwd(), ".dzn-circuit-forge-grid-control-migration-test-"));
try {
  const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/dzn-single-migration-production-rollout.ts", ...args], { encoding: "utf8" });
  const wrappedRows = (rows: unknown[]) => JSON.stringify([{ results: rows }]);
  const write = (name: string, value: string) => {
    const path = join(circuitForgeGridControlDirectory, name);
    writeFileSync(path, value, "utf8");
    return path;
  };
  const gridControlIndex = migrationNames.indexOf("0111_games_hub_circuit_forge_grid_control.sql");
  assert.equal(migrationNames[gridControlIndex - 1], "0110_games_hub_night_run_route_control.sql");
  const ledger = write("ledger.json", wrappedRows(migrationNames.slice(0, gridControlIndex).map((name) => ({ name }))));
  const verifiedLedger = run(["verify-ledger", "--migration", "0111_games_hub_circuit_forge_grid_control.sql", "--ledger", ledger, "--phase", "before"]);
  assert.equal(verifiedLedger.status, 0, `${verifiedLedger.stdout ?? ""}${verifiedLedger.stderr ?? ""}`);

  const stageDirectory = join(circuitForgeGridControlDirectory, "stage");
  const preparedStage = run(["prepare", "--migration", "0111_games_hub_circuit_forge_grid_control.sql", "--stage-dir", stageDirectory]);
  assert.equal(preparedStage.status, 0, `${preparedStage.stdout ?? ""}${preparedStage.stderr ?? ""}`);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    migration: { predecessor: string; statePreservation?: { sourceHash: string; addedColumns: Array<{ name: string; expectedValue: string | null }> } };
    expectedObjectSql: Record<string, string>;
  };
  assert.equal(prepared.migration.predecessor, "0110_games_hub_night_run_route_control.sql");
  assert.equal(prepared.migration.statePreservation?.sourceHash, "dbe9a7164829adac8d0b520ea49c159816eb30cb86d865a7f1cda2c0854abcc6");
  assert.deepEqual(prepared.migration.statePreservation?.addedColumns, [
    { name: "diagnostic_used", expectedValue: "0" },
    { name: "phase_used", expectedValue: "0" },
    { name: "diagnostic_index", expectedValue: null },
  ]);
  assert.deepEqual(Object.keys(prepared.expectedObjectSql), ["idx_dzn_circuit_forge_grid_control"]);

  const row = {
    user_id: "user-a",
    id: "circuit-forge-a",
    rotations_json: "[0,1,2]",
    rotations: 3,
    status: "playing",
    version: 3,
    started_at: 1,
    updated_at: 2,
  };
  const beforeSql = "CREATE TABLE dzn_circuit_forge_sessions (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL UNIQUE, rotations_json TEXT NOT NULL CHECK (json_valid(rotations_json) AND json_type(rotations_json) = 'array'), rotations INTEGER NOT NULL DEFAULT 0 CHECK (rotations BETWEEN 0 AND 64), status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'won', 'failed')), version INTEGER NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 64), started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)";
  const afterSql = `${beforeSql.slice(0, -1)}, diagnostic_used INTEGER NOT NULL DEFAULT 0 CHECK (diagnostic_used IN (0, 1)), phase_used INTEGER NOT NULL DEFAULT 0 CHECK (phase_used IN (0, 1)), diagnostic_index INTEGER CHECK (diagnostic_index IS NULL OR (diagnostic_index BETWEEN 0 AND 24 AND diagnostic_index <> 12)))`;
  const columns = ["user_id", "id", "rotations_json", "rotations", "status", "version", "started_at", "updated_at"];
  const foreignKeys = write("foreign-keys.json", wrappedRows([{ from: "user_id", table: "users", to: "id", on_delete: "CASCADE" }]));
  const foreignKeyCheck = write("foreign-key-check.json", wrappedRows([]));
  const baseline = run([
    "verify-state-preservation-before",
    "--migration", "0111_games_hub_circuit_forge_grid_control.sql",
    "--objects", write("before-objects.json", wrappedRows([{ type: "table", name: "dzn_circuit_forge_sessions", tbl_name: "dzn_circuit_forge_sessions", sql: beforeSql }])),
    "--table-info", write("before-info.json", wrappedRows(columns.map((name) => ({ name })))),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
  ]);
  assert.equal(baseline.status, 0, `${baseline.stdout ?? ""}${baseline.stderr ?? ""}`);

  const beforeRows = write("before-rows.json", wrappedRows([row]));
  const afterRows = write("after-rows.json", wrappedRows([row]));
  const beforeFingerprint = join(circuitForgeGridControlDirectory, "before.sha256");
  const afterFingerprint = join(circuitForgeGridControlDirectory, "after.sha256");
  const beforeHash = run(["fingerprint", "--rows", beforeRows]);
  const afterHash = run(["fingerprint", "--rows", afterRows]);
  assert.equal(beforeHash.status, 0, beforeHash.stderr);
  assert.equal(afterHash.status, 0, afterHash.stderr);
  writeFileSync(beforeFingerprint, beforeHash.stdout.trim(), "utf8");
  writeFileSync(afterFingerprint, afterHash.stdout.trim(), "utf8");
  const defaultQuery = run(["print-state-preservation-defaults-query", "--migration", "0111_games_hub_circuit_forge_grid_control.sql"]);
  assert.equal(defaultQuery.status, 0, defaultQuery.stderr);
  assert.match(defaultQuery.stdout, /SELECT id, diagnostic_used, phase_used, diagnostic_index FROM dzn_circuit_forge_sessions/);
  const verified = run([
    "verify-state-preservation-after",
    "--migration", "0111_games_hub_circuit_forge_grid_control.sql",
    "--objects", write("after-objects.json", wrappedRows([{ type: "table", name: "dzn_circuit_forge_sessions", tbl_name: "dzn_circuit_forge_sessions", sql: afterSql }])),
    "--table-info", write("after-info.json", wrappedRows([...columns, "diagnostic_used", "phase_used", "diagnostic_index"].map((name) => ({ name })))),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", write("before-count.json", wrappedRows([{ row_count: 1 }])),
    "--after-row-count", write("after-count.json", wrappedRows([{ row_count: 1 }])),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("defaults.json", wrappedRows([{ id: "circuit-forge-a", diagnostic_used: 0, phase_used: 0, diagnostic_index: null }])),
  ]);
  assert.equal(verified.status, 0, `${verified.stdout ?? ""}${verified.stderr ?? ""}`);
  assert.match(verified.stdout, /1 dzn_circuit_forge_sessions rows retained/);
  const invalidNullDefault = run([
    "verify-state-preservation-after",
    "--migration", "0111_games_hub_circuit_forge_grid_control.sql",
    "--objects", join(circuitForgeGridControlDirectory, "after-objects.json"),
    "--table-info", join(circuitForgeGridControlDirectory, "after-info.json"),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", join(circuitForgeGridControlDirectory, "before-count.json"),
    "--after-row-count", join(circuitForgeGridControlDirectory, "after-count.json"),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("invalid-defaults.json", wrappedRows([{ id: "circuit-forge-a", diagnostic_used: 0, phase_used: 0, diagnostic_index: 3 }])),
  ]);
  assert.notEqual(invalidNullDefault.status, 0, "The verifier must reject a non-null diagnostic index on every preserved Circuit Forge session.");
  assert.match(`${invalidNullDefault.stdout ?? ""}${invalidNullDefault.stderr ?? ""}`, /diagnostic_index was not initialized to NULL/);
} finally {
  rmSync(circuitForgeGridControlDirectory, { force: true, recursive: true });
}

const survivalFieldOrdersDirectory = mkdtempSync(join(process.cwd(), ".dzn-survival-command-field-orders-migration-test-"));
try {
  const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/dzn-single-migration-production-rollout.ts", ...args], { encoding: "utf8" });
  const wrappedRows = (rows: unknown[]) => JSON.stringify([{ results: rows }]);
  const write = (name: string, value: string) => {
    const path = join(survivalFieldOrdersDirectory, name);
    writeFileSync(path, value, "utf8");
    return path;
  };

  const ledger = write("ledger.json", wrappedRows(migrationNames.slice(0, survivalFieldOrdersIndex).map((name) => ({ name }))));
  const verifiedLedger = run(["verify-ledger", "--migration", "0112_dzn_survival_command_field_orders.sql", "--ledger", ledger, "--phase", "before"]);
  assert.equal(verifiedLedger.status, 0, `${verifiedLedger.stdout ?? ""}${verifiedLedger.stderr ?? ""}`);

  const stageDirectory = join(survivalFieldOrdersDirectory, "stage");
  const preparedStage = run(["prepare", "--migration", "0112_dzn_survival_command_field_orders.sql", "--stage-dir", stageDirectory]);
  assert.equal(preparedStage.status, 0, `${preparedStage.stdout ?? ""}${preparedStage.stderr ?? ""}`);
  const prepared = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    migration: { predecessor: string; statePreservation?: { sourceHash: string; addedColumns: Array<{ name: string; expectedValue: null }> } };
    expectedObjectSql: Record<string, string>;
  };
  assert.equal(prepared.migration.predecessor, "0111_games_hub_circuit_forge_grid_control.sql");
  assert.equal(prepared.migration.statePreservation?.sourceHash, "9426b2732c208119ebf5bbdf5f82bebeb998b478c34e1180cb5fbf02ca7d400c");
  assert.deepEqual(prepared.migration.statePreservation?.addedColumns, [
    { name: "field_order", expectedValue: null },
    { name: "field_order_request_id", expectedValue: null },
    { name: "field_order_at", expectedValue: null },
  ]);
  assert.deepEqual(Object.keys(prepared.expectedObjectSql).sort(), [
    "idx_dzn_survival_command_field_order_active",
    "idx_dzn_survival_command_field_order_request",
  ]);
  assert.match(prepared.expectedObjectSql.idx_dzn_survival_command_field_order_request, /^CREATE UNIQUE INDEX idx_dzn_survival_command_field_order_request /);

  const row = {
    id: "expedition-a",
    user_id: "user-a",
    request_id: "request-a",
    sector: "perimeter",
    approach: "scout",
    status: "deployed",
    seed: "0123456789abcdef",
    deployment_day: "2026-10-20",
    deployment_cost: 1,
    started_at: 1,
    ready_at: 2,
    resolved_at: null,
    version: 0,
    loadout: "field_kit",
  };
  const beforeSql = "CREATE TABLE dzn_survival_command_expeditions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL, sector TEXT NOT NULL CHECK (sector IN ('perimeter', 'rail_yard', 'radio_ridge', 'blacksite')), approach TEXT NOT NULL CHECK (approach IN ('scout', 'balanced', 'breach')), status TEXT NOT NULL CHECK (status IN ('deployed', 'resolved')), seed TEXT NOT NULL CHECK (length(seed) >= 16), deployment_day TEXT NOT NULL CHECK (length(deployment_day) = 10), deployment_cost INTEGER NOT NULL CHECK (deployment_cost BETWEEN 1 AND 3), started_at INTEGER NOT NULL, ready_at INTEGER NOT NULL CHECK (ready_at > started_at), resolved_at INTEGER, version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0), loadout TEXT NOT NULL DEFAULT 'field_kit' CHECK (loadout IN ('field_kit', 'signal_scanner', 'recovery_kit', 'convoy_plating')), UNIQUE (user_id, request_id), CHECK ((status = 'deployed' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL)))";
  const afterSql = `${beforeSql.slice(0, -1)}, field_order TEXT CHECK (field_order IS NULL OR field_order IN ('overwatch', 'intercept', 'recovery')), field_order_request_id TEXT, field_order_at INTEGER)`;
  const columns = ["id", "user_id", "request_id", "sector", "approach", "status", "seed", "deployment_day", "deployment_cost", "started_at", "ready_at", "resolved_at", "version", "loadout"];
  const foreignKeys = write("foreign-keys.json", wrappedRows([{ from: "user_id", table: "users", to: "id", on_delete: "CASCADE" }]));
  const foreignKeyCheck = write("foreign-key-check.json", wrappedRows([]));
  const baseline = run([
    "verify-state-preservation-before",
    "--migration", "0112_dzn_survival_command_field_orders.sql",
    "--objects", write("before-objects.json", wrappedRows([{ type: "table", name: "dzn_survival_command_expeditions", tbl_name: "dzn_survival_command_expeditions", sql: beforeSql }])),
    "--table-info", write("before-info.json", wrappedRows(columns.map((name) => ({ name })))),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
  ]);
  assert.equal(baseline.status, 0, `${baseline.stdout ?? ""}${baseline.stderr ?? ""}`);

  const schema = run([
    "verify-schema",
    "--stage-dir", stageDirectory,
    "--objects", write("after-indexes.json", wrappedRows(Object.entries(prepared.expectedObjectSql).map(([name, sql]) => ({ type: "index", name, tbl_name: "dzn_survival_command_expeditions", sql })))),
    "--foreign-key-check", foreignKeyCheck,
  ]);
  assert.equal(schema.status, 0, `${schema.stdout ?? ""}${schema.stderr ?? ""}`);

  const beforeRows = write("before-rows.json", wrappedRows([row]));
  const afterRows = write("after-rows.json", wrappedRows([row]));
  const beforeFingerprint = join(survivalFieldOrdersDirectory, "before.sha256");
  const afterFingerprint = join(survivalFieldOrdersDirectory, "after.sha256");
  const beforeHash = run(["fingerprint", "--rows", beforeRows]);
  const afterHash = run(["fingerprint", "--rows", afterRows]);
  assert.equal(beforeHash.status, 0, beforeHash.stderr);
  assert.equal(afterHash.status, 0, afterHash.stderr);
  writeFileSync(beforeFingerprint, beforeHash.stdout.trim(), "utf8");
  writeFileSync(afterFingerprint, afterHash.stdout.trim(), "utf8");
  const defaultQuery = run(["print-state-preservation-defaults-query", "--migration", "0112_dzn_survival_command_field_orders.sql"]);
  assert.equal(defaultQuery.status, 0, defaultQuery.stderr);
  assert.match(defaultQuery.stdout, /SELECT id, field_order, field_order_request_id, field_order_at FROM dzn_survival_command_expeditions/);
  const verified = run([
    "verify-state-preservation-after",
    "--migration", "0112_dzn_survival_command_field_orders.sql",
    "--objects", write("after-objects.json", wrappedRows([{ type: "table", name: "dzn_survival_command_expeditions", tbl_name: "dzn_survival_command_expeditions", sql: afterSql }])),
    "--table-info", write("after-info.json", wrappedRows([...columns, "field_order", "field_order_request_id", "field_order_at"].map((name) => ({ name })))),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", write("before-count.json", wrappedRows([{ row_count: 1 }])),
    "--after-row-count", write("after-count.json", wrappedRows([{ row_count: 1 }])),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("defaults.json", wrappedRows([{ id: "expedition-a", field_order: null, field_order_request_id: null, field_order_at: null }])),
  ]);
  assert.equal(verified.status, 0, `${verified.stdout ?? ""}${verified.stderr ?? ""}`);
  assert.match(verified.stdout, /1 dzn_survival_command_expeditions rows retained/);
  const invalidNullDefault = run([
    "verify-state-preservation-after",
    "--migration", "0112_dzn_survival_command_field_orders.sql",
    "--objects", join(survivalFieldOrdersDirectory, "after-objects.json"),
    "--table-info", join(survivalFieldOrdersDirectory, "after-info.json"),
    "--foreign-keys", foreignKeys,
    "--foreign-key-check", foreignKeyCheck,
    "--before-row-count", join(survivalFieldOrdersDirectory, "before-count.json"),
    "--after-row-count", join(survivalFieldOrdersDirectory, "after-count.json"),
    "--before-fingerprint", beforeFingerprint,
    "--after-fingerprint", afterFingerprint,
    "--defaults", write("invalid-defaults.json", wrappedRows([{ id: "expedition-a", field_order: "overwatch", field_order_request_id: null, field_order_at: null }])),
  ]);
  assert.notEqual(invalidNullDefault.status, 0, "The verifier must reject a non-null field order on every preserved Survival Command expedition.");
  assert.match(`${invalidNullDefault.stdout ?? ""}${invalidNullDefault.stderr ?? ""}`, /field_order was not initialized to NULL/);
} finally {
  rmSync(survivalFieldOrdersDirectory, { force: true, recursive: true });
}

console.log("Single-migration production rollout safety tests passed.");
