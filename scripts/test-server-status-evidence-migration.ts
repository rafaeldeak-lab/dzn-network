import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync("migrations/0113_dzn_server_status_evidence.sql", "utf8");

assert.match(source, /^ALTER TABLE linked_servers\s+ADD COLUMN server_status_confirmed_at TEXT;\s*$/m);
assert.doesNotMatch(source, /\b(?:DROP|TRUNCATE|INSERT|UPDATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i);

const stageDirectory = join(process.cwd(), `.dzn-server-status-evidence-stage-test-${process.pid}`);
let statePreservation: {
  beforeColumnVariants?: string[][];
  afterColumnVariants?: string[][];
} | undefined;
try {
  const staged = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/dzn-single-migration-production-rollout.ts",
      "prepare",
      "--migration",
      "0113_dzn_server_status_evidence.sql",
      "--stage-dir",
      stageDirectory,
    ],
    { encoding: "utf8" },
  );
  assert.equal(staged.status, 0, `${staged.stdout ?? ""}${staged.stderr ?? ""}`);
  const plan = JSON.parse(readFileSync(join(stageDirectory, "migration-plan.json"), "utf8")) as {
    migration: {
      predecessor: string;
      statePreservation?: {
        addedColumns: Array<{ name: string; expectedValue: string | null }>;
        rowColumns: string[];
        allowConcurrentInserts?: boolean;
        beforeColumnVariants?: string[][];
      };
    };
  };
  assert.equal(plan.migration.predecessor, "0112_dzn_survival_command_field_orders.sql");
  assert.deepEqual(plan.migration.statePreservation?.addedColumns, [{ name: "server_status_confirmed_at", expectedValue: null }]);
  assert.deepEqual(plan.migration.statePreservation?.rowColumns, ["id", "user_id", "guild_id", "discord_guild_id", "nitrado_service_id"]);
  assert.equal(plan.migration.statePreservation?.allowConcurrentInserts, true);
  assert.equal(plan.migration.statePreservation?.beforeColumnVariants?.length, 1);
  statePreservation = plan.migration.statePreservation;
} finally {
  rmSync(stageDirectory, { force: true, recursive: true });
}

assert.ok(statePreservation?.beforeColumnVariants?.[0]);
assert.ok(statePreservation?.afterColumnVariants?.[0]);
const verificationDirectory = join(process.cwd(), `.dzn-server-status-evidence-verification-test-${process.pid}`);
mkdirSync(verificationDirectory);
try {
  const wrappedRows = (rows: unknown[]) => JSON.stringify([{ results: rows }]);
  const write = (name: string, rows: unknown[]) => {
    const path = join(verificationDirectory, name);
    writeFileSync(path, wrappedRows(rows), "utf8");
    return path;
  };
  const fingerprint = (name: string, value: string) => {
    const path = join(verificationDirectory, name);
    writeFileSync(path, value.repeat(64).slice(0, 64), "utf8");
    return path;
  };
  const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/dzn-single-migration-production-rollout.ts", ...args], { encoding: "utf8" });
  const beforeRows = [{ id: "server-a", user_id: "owner-a", guild_id: "guild-a", discord_guild_id: "discord-a", nitrado_service_id: "service-a" }];
  const afterRows = [...beforeRows, { id: "server-b", user_id: "owner-b", guild_id: "guild-b", discord_guild_id: "discord-b", nitrado_service_id: "service-b" }];
  const commonArgs = [
    "verify-state-preservation-after",
    "--migration", "0113_dzn_server_status_evidence.sql",
    "--objects", write("objects.json", [{ type: "table", name: "linked_servers", tbl_name: "linked_servers", sql: "CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), server_status_confirmed_at TEXT)" }]),
    "--table-info", write("table-info.json", statePreservation.afterColumnVariants![0].map((name) => ({ name }))),
    "--foreign-keys", write("foreign-keys.json", [{ from: "user_id", table: "users", to: "id", on_delete: "NO ACTION" }]),
    "--foreign-key-check", write("foreign-key-check.json", []),
    "--before-row-count", write("before-count.json", [{ row_count: 1 }]),
    "--after-row-count", write("after-count.json", [{ row_count: 2 }]),
    "--before-fingerprint", fingerprint("before.sha256", "a"),
    "--after-fingerprint", fingerprint("after.sha256", "b"),
    "--before-rows", write("before-rows.json", beforeRows),
    "--after-rows", write("after-rows.json", afterRows),
  ];
  const concurrentInsert = run([...commonArgs, "--defaults", write("defaults-after-insert.json", [{ id: "server-a", server_status_confirmed_at: null }])]);
  assert.equal(concurrentInsert.status, 0, `${concurrentInsert.stdout ?? ""}${concurrentInsert.stderr ?? ""}`);
  const missingPreexistingDefault = run([...commonArgs, "--defaults", write("defaults-missing-existing.json", [{ id: "server-b", server_status_confirmed_at: null }])]);
  assert.notEqual(missingPreexistingDefault.status, 0, "The verifier must reject a defaults read that omits a pre-existing linked server.");
} finally {
  rmSync(verificationDirectory, { force: true, recursive: true });
}

const localVerification = spawnSync(
  process.execPath,
  ["-e", String.raw`
    const assert = require("node:assert/strict");
    const { readFileSync } = require("node:fs");
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(":memory:");
    try {
      database.exec([
        "PRAGMA foreign_keys = ON;",
        "CREATE TABLE users (id TEXT PRIMARY KEY);",
        "CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), guild_id TEXT NOT NULL, server_status TEXT, is_online INTEGER, metadata_last_checked_at TEXT, player_count_last_checked_at TEXT, player_count_source TEXT, player_count_status TEXT);",
        "INSERT INTO users (id) VALUES ('owner-a');",
        "INSERT INTO linked_servers (id, user_id, guild_id, server_status, is_online, metadata_last_checked_at, player_count_last_checked_at, player_count_source, player_count_status) VALUES ('server-a', 'owner-a', 'guild-a', 'started', 1, '2026-10-20T01:01:32.789Z', '2026-10-20T01:01:32.789Z', 'nitrado', 'unavailable');",
      ].join("\n"));
      const preservedQuery = "SELECT id, user_id, guild_id, server_status, is_online, metadata_last_checked_at, player_count_last_checked_at, player_count_source, player_count_status FROM linked_servers";
      const before = database.prepare(preservedQuery).all();
      database.exec(readFileSync("migrations/0113_dzn_server_status_evidence.sql", "utf8"));
      const columns = database.prepare("SELECT name FROM pragma_table_info('linked_servers') ORDER BY cid").all();
      assert.equal(columns.at(-1)?.name, "server_status_confirmed_at");
      assert.deepEqual(database.prepare("SELECT * FROM pragma_foreign_key_check").all(), []);
      assert.deepEqual(database.prepare(preservedQuery).all(), before, "The additive migration must preserve existing per-server state exactly.");
      assert.deepEqual(database.prepare("SELECT id FROM linked_servers WHERE server_status_confirmed_at IS NOT NULL").all(), [], "Existing rows start without status evidence.");
    } finally {
      database.close();
    }
  `],
  { encoding: "utf8" },
);
assert.equal(localVerification.status, 0, `${localVerification.stdout ?? ""}${localVerification.stderr ?? ""}`);
console.log("Server-status evidence migration tests passed.");
