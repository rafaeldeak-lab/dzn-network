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

const migrationNames = readdirSync("migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort((left, right) => left.localeCompare(right));
const relayRushIndex = migrationNames.indexOf("0096_games_hub_relay_rush.sql");
assert.ok(relayRushIndex > 0, "Relay Rush must have an established predecessor.");
const commandCentreIndex = migrationNames.indexOf("0107_dzn_command_centre.sql");
assert.ok(commandCentreIndex > 0, "Command Centre must have an established predecessor.");
const survivalExpeditionsIndex = migrationNames.indexOf("0108_dzn_survival_command_expeditions.sql");
assert.ok(survivalExpeditionsIndex > commandCentreIndex, "Survival Command expeditions must follow Command Centre.");

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

console.log("Single-migration production rollout safety tests passed.");
