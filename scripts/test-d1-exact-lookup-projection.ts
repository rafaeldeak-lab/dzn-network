import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  EXACT_LINKED_SERVER_LOOKUP_PROJECTION,
  EXACT_LINKED_SERVER_LOOKUP_SQL,
} from "../functions/_lib/db";

type WranglerRun = {
  status: number;
  stdout: string;
  stderr: string;
};

type WranglerJsonResult = {
  results?: Record<string, unknown>[];
};

type WranglerJsonContainer = WranglerJsonResult & {
  result?: WranglerJsonResult[] | WranglerJsonResult;
};

const linkedServerId = "local-d1-linked-900003";
const ownerUserId = "local-d1-owner-a";
const joinedWildcardOutputs = [
  "guild_name",
  "guild_icon_url",
  "adm_path",
  "adm_logs_found",
  "adm_last_checked_at",
] as const;
const forbiddenProjectionFields = [
  "encrypted_token",
  "token_iv",
  "token_auth_tag",
  "session_token_hash",
  "bot_access_token",
  "access_token",
  "refresh_token",
] as const;

const require = createRequire(import.meta.url);
const repoRoot = resolve(process.cwd());
const wranglerBin = require.resolve("wrangler/bin/wrangler.js");
const configPath = resolve(repoRoot, "wrangler.toml");
const databaseName = discoverLocalD1DatabaseName(configPath);

const localRoot = mkdtempSync(
  join(tmpdir(), "dzn-d1-exact-projection-"),
);
const sqlRoot = join(localRoot, "sql");
const persistRoot = join(localRoot, "state");
mkdirSync(sqlRoot, { recursive: true });
mkdirSync(persistRoot, { recursive: true });

let linkedServerTableColumnCount = 0;
let oldProjectionCount = 0;
let oldWildcardExecution = "NOT_RUN";
let oldFailureCategory = "not_run";
let boundedProjectionCount = 0;
let boundedExecution = "NOT_RUN";
let uniqueOutputNames = false;
let credentialFieldsProjected = true;
let temporaryStateRemoved = false;

try {
  const migrationArgs = [
    "d1",
    "migrations",
    "apply",
    databaseName,
    "--local",
    "--persist-to",
    persistRoot,
    "--config",
    configPath,
  ];
  assertLocalOnlyD1Args(migrationArgs);
  requireWranglerSuccess("migrations_apply", runWrangler(migrationArgs, { allowFailure: true }));

  const pragmaFile = writeSqlFile("pragma-linked-servers.sql", "PRAGMA table_info(linked_servers);");
  const linkedServerColumns = requireD1Success("pragma_linked_servers", executeLocalD1File(pragmaFile))
    .map((row) => String(row.name || ""));
  linkedServerTableColumnCount = linkedServerColumns.length;
  assert.equal(linkedServerTableColumnCount, 100, "Migration-backed linked_servers column count must remain 100.");

  oldProjectionCount = linkedServerTableColumnCount + joinedWildcardOutputs.length;
  assert.equal(oldProjectionCount, 105, "Legacy wildcard query projection count must match the proven 105-column defect.");
  assert.deepEqual(
    duplicateNames([...linkedServerColumns, ...joinedWildcardOutputs]),
    [],
    "Legacy wildcard joined output names should not collide; the proven defect is result width.",
  );

  const projectionOutputNames = EXACT_LINKED_SERVER_LOOKUP_PROJECTION.map(outputName);
  boundedProjectionCount = EXACT_LINKED_SERVER_LOOKUP_PROJECTION.length;
  assert.equal(boundedProjectionCount < 90, true, "Bounded exact lookup projection must retain D1 result-column headroom.");
  assert.equal(projectionOutputNames.length, boundedProjectionCount, "Every bounded projection expression must have an output name.");
  assert.deepEqual(duplicateNames(projectionOutputNames), [], "Bounded exact lookup projection output names must be unique.");
  uniqueOutputNames = true;
  credentialFieldsProjected = forbiddenProjectionFields.some((field) =>
    EXACT_LINKED_SERVER_LOOKUP_PROJECTION.some((expression) => expression.toLowerCase().includes(field)),
  );
  assert.equal(credentialFieldsProjected, false, "Bounded exact lookup projection must not select credential/session fields.");

  const seedFile = writeSqlFile("seed.sql", seedSql());
  requireD1Success("seed", executeLocalD1File(seedFile));

  const oldWildcardFile = writeSqlFile("old-wildcard-query.sql", oldWildcardLookupSql());
  const oldWildcardResult = executeLocalD1File(oldWildcardFile, { allowFailure: true });
  assert.notEqual(oldWildcardResult.status, 0, "Old wildcard exact lookup must fail through Wrangler local D1.");
  oldFailureCategory = classifyFailure(oldWildcardResult);
  assert.equal(oldFailureCategory, "too_many_result_columns", "Old wildcard exact lookup must fail only on result-column width.");
  oldWildcardExecution = "EXPECTED_FAILURE";

  const boundedQueryFile = writeSqlFile("bounded-query.sql", exactLookupSql());
  const boundedRows = requireD1Success("bounded_exact_lookup", executeLocalD1File(boundedQueryFile));
  assert.equal(boundedRows.length, 1, "Bounded exact linked-server lookup must read one local D1 row.");
  const boundedColumnNames = Object.keys(boundedRows[0] ?? {});
  assert.equal(
    boundedColumnNames.length,
    boundedProjectionCount,
    "Wrangler local D1 bounded lookup result column count must equal the committed projection count.",
  );
  assert.deepEqual(
    boundedColumnNames,
    projectionOutputNames,
    "Wrangler local D1 bounded lookup must expose the same unique output names.",
  );
  assert.equal(boundedRows[0]?.nitrado_service_id, "900003", "Synthetic exact linked-server row must be readable.");
  boundedExecution = "PASS";
} finally {
  rmSync(localRoot, {
    recursive: true,
    force: true,
  });
  temporaryStateRemoved = !existsSync(localRoot);
  assert.equal(temporaryStateRemoved, true, "Temporary Wrangler local D1 state must be removed.");
}

console.log(
  [
    "D1 exact lookup projection passed:",
    `linkedServerTableColumnCount=${linkedServerTableColumnCount}`,
    `oldProjectionCount=${oldProjectionCount}`,
    `oldWildcardExecution=${oldWildcardExecution}`,
    `oldFailureCategory=${oldFailureCategory}`,
    `boundedProjectionCount=${boundedProjectionCount}`,
    `boundedExecution=${boundedExecution}`,
    `uniqueOutputNames=${String(uniqueOutputNames)}`,
    `credentialFieldsProjected=${String(credentialFieldsProjected)}`,
    `temporaryStateRemoved=${String(temporaryStateRemoved)}`,
  ].join(" "),
);

function runWrangler(
  args: string[],
  options: { allowFailure?: boolean } = {},
): WranglerRun {
  const result = spawnSync(
    process.execPath,
    [wranglerBin, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: "y\n",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        CI: "1",
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    throw new Error(
      `Wrangler process did not start: ${String(error.code || error.name)}`,
    );
  }

  const status = result.status ?? 1;
  if (!options.allowFailure && status !== 0) {
    throw new Error(
      `Wrangler command failed with exit status ${String(status)}.`,
    );
  }

  return {
    status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function executeLocalD1File(file: string, options: { allowFailure?: boolean } = {}) {
  const args = [
    "d1",
    "execute",
    databaseName,
    "--local",
    "--persist-to",
    persistRoot,
    "--config",
    configPath,
    "--file",
    file,
    "--json",
  ];
  assertLocalOnlyD1Args(args);
  return runWrangler(args, { allowFailure: options.allowFailure ?? true });
}

function requireWranglerSuccess(label: string, result: WranglerRun) {
  assert.equal(
    result.status,
    0,
    `${label} failed: status=${String(result.status)} category=${classifyFailure(result)}`,
  );
}

function requireD1Success(label: string, result: WranglerRun) {
  requireWranglerSuccess(label, result);
  return rowsFromWranglerJson(result.stdout);
}

function assertLocalOnlyD1Args(args: readonly string[]) {
  assert.equal(args.includes("--local"), true, "Wrangler D1 proof commands must be local-only.");
  assert.equal(args.includes("--persist-to"), true, "Wrangler D1 proof commands must use isolated local state.");
  assert.equal(args.includes(persistRoot), true, "Wrangler D1 proof commands must use the temporary persist directory.");
  assert.equal(args.includes("--remote"), false, "Wrangler D1 proof commands must not use remote D1.");
  assert.equal(args.includes("--preview"), false, "Wrangler D1 proof commands must not use preview D1.");
}

function rowsFromWranglerJson(output: string) {
  const raw = output.replace(/^\uFEFF/, "").trim();
  const start = raw.search(/[\[{]/);
  assert.notEqual(start, -1, "Wrangler local D1 output must include JSON.");
  const parsed = JSON.parse(raw.slice(start)) as unknown;
  const containers = Array.isArray(parsed) ? parsed : [parsed];
  return containers.flatMap((item) => {
    const container = item as WranglerJsonContainer;
    if (Array.isArray(container.results)) return container.results;
    if (Array.isArray(container.result)) {
      return container.result.flatMap((entry) => entry.results ?? []);
    }
    return container.result?.results ?? [];
  });
}

function classifyFailure(result: WranglerRun) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (/too many columns in result set/i.test(output)) return "too_many_result_columns";
  if (/no such table/i.test(output)) return "missing_table";
  if (/SQLITE_CONSTRAINT|constraint failed/i.test(output)) return "constraint";
  if (/JSON/i.test(output)) return "json_parse";
  return result.status === 0 ? "none" : "unexpected";
}

function writeSqlFile(name: string, sql: string) {
  const file = join(sqlRoot, name);
  writeFileSync(file, `${sql.trim()}\n`, "utf8");
  return file;
}

function discoverLocalD1DatabaseName(path: string) {
  const config = readFileSync(path, "utf8");
  assert.match(config, /\[\[d1_databases\]\]/, "Wrangler config must define a D1 database.");
  const matches = [...config.matchAll(/database_name\s*=\s*"([^"]+)"/g)];
  assert.equal(matches.length, 1, "Wrangler config must expose exactly one D1 database name for this proof.");
  return matches[0][1];
}

function outputName(expression: string) {
  const alias = expression.match(/\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i)?.[1];
  if (alias) return alias;
  return expression.trim().split(".").at(-1)?.trim() ?? "";
}

function duplicateNames(values: readonly string[]) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function exactLookupSql() {
  let sql = EXACT_LINKED_SERVER_LOOKUP_SQL;
  sql = sql.replace("linked_servers.id = ?", `linked_servers.id = ${sqlString(linkedServerId)}`);
  sql = sql.replace("linked_servers.user_id = ?", `linked_servers.user_id = ${sqlString(ownerUserId)}`);
  return `${sql};`;
}

function oldWildcardLookupSql() {
  return `SELECT
    linked_servers.*,
    discord_guilds.name AS guild_name,
    discord_guilds.icon_url AS guild_icon_url,
    server_log_config.adm_path AS adm_path,
    onboarding_checks.adm_logs_found AS adm_logs_found,
    onboarding_checks.last_tested_at AS adm_last_checked_at
  FROM linked_servers
  LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
  LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
  LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
  WHERE linked_servers.id = ${sqlString(linkedServerId)}
    AND linked_servers.user_id = ${sqlString(ownerUserId)}
    AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
    AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
    AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  LIMIT 1;`;
}

function seedSql() {
  return `
    INSERT OR IGNORE INTO users (id, discord_id, username, avatar, created_at, updated_at)
    VALUES (${sqlString(ownerUserId)}, 'local-d1-owner-a-discord', 'Local D1 Owner A', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT OR IGNORE INTO discord_guilds (id, guild_id, owner_user_id, name, icon, icon_url, permissions, is_owner, created_at, updated_at)
    VALUES ('local-d1-guild-row-a', 'local-d1-guild-a', ${sqlString(ownerUserId)}, 'Local D1 Guild A', NULL, 'https://example.test/icon.png', '8', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT OR IGNORE INTO linked_servers (
      id, user_id, guild_id, discord_guild_id, nitrado_service_id, nitrado_service_name, server_name,
      server_type, server_category, tags_json, region, status, public_slug, listing_visibility,
      lifecycle_status, lifecycle_reason, lifecycle_updated_at, owner_action_required,
      latest_imported_event_at, game, platform, ip_address, player_slots, merged_into_server_id,
      created_at, updated_at
    ) VALUES (
      ${sqlString(linkedServerId)}, ${sqlString(ownerUserId)}, 'local-d1-guild-a', 'local-d1-guild-row-a', '900003', 'Local D1 900003', 'Local D1 900003',
      'PVP', 'pvp', '[]', 'EU', 'pending', ${sqlString(linkedServerId)}, 'hidden',
      'active_live', 'local_d1_fixture', CURRENT_TIMESTAMP, 0,
      CURRENT_TIMESTAMP, 'DayZ', 'PC', '203.0.113.10', 60, NULL,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO server_log_config (id, linked_server_id, adm_path, created_at, updated_at)
    VALUES ('local-d1-log-a', ${sqlString(linkedServerId)}, 'games/private/noftp/adm/mock.ADM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    INSERT OR IGNORE INTO onboarding_checks (id, linked_server_id, token_valid, service_access, adm_logs_found, dayz_service_detected, last_tested_at)
    VALUES ('local-d1-check-a', ${sqlString(linkedServerId)}, 1, 1, 1, 1, CURRENT_TIMESTAMP);
  `;
}
