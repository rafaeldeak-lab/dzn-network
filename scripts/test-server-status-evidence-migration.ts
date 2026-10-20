import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync("migrations/0113_dzn_server_status_evidence.sql", "utf8");

assert.match(source, /^CREATE TABLE dzn_server_status_evidence \(/m);
assert.match(source, /server_id TEXT PRIMARY KEY NOT NULL REFERENCES linked_servers\(id\) ON DELETE CASCADE/i);
assert.match(source, /server_status_confirmed_at TEXT NOT NULL/i);
assert.doesNotMatch(source, /\b(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i);

const stageDirectory = join(process.cwd(), `.dzn-server-status-evidence-stage-test-${process.pid}`);
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
      tables: Array<{ name: string; columns: string[]; foreignKeys: Array<{ from: string; table: string; to: string; onDelete: string }> }>;
      statePreservation?: unknown;
    };
  };
  assert.equal(plan.migration.predecessor, "0112_dzn_survival_command_field_orders.sql");
  assert.equal(plan.migration.statePreservation, undefined);
  assert.deepEqual(plan.migration.tables, [{
    name: "dzn_server_status_evidence",
    columns: ["server_id", "server_status_confirmed_at"],
    foreignKeys: [{ from: "server_id", table: "linked_servers", to: "id", onDelete: "CASCADE" }],
  }]);
} finally {
  rmSync(stageDirectory, { force: true, recursive: true });
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
        "CREATE TABLE linked_servers (id TEXT PRIMARY KEY, server_status TEXT, is_online INTEGER);",
        "INSERT INTO linked_servers (id, server_status, is_online) VALUES ('server-a', 'started', 1);",
      ].join("\n"));
      const before = database.prepare("SELECT id, server_status, is_online FROM linked_servers").all();
      database.exec(readFileSync("migrations/0113_dzn_server_status_evidence.sql", "utf8"));
      const columns = database.prepare("SELECT name FROM pragma_table_info('dzn_server_status_evidence') ORDER BY cid").all();
      assert.deepEqual(columns.map((column) => column.name), ["server_id", "server_status_confirmed_at"]);
      assert.deepEqual(database.prepare("SELECT * FROM pragma_foreign_key_check").all(), []);
      assert.deepEqual(database.prepare("SELECT id, server_status, is_online FROM linked_servers").all(), before, "The migration must not alter existing linked-server state.");
      assert.deepEqual(database.prepare("SELECT * FROM dzn_server_status_evidence").all(), [], "Status evidence starts with a zero-row baseline.");
      database.exec("INSERT INTO dzn_server_status_evidence (server_id, server_status_confirmed_at) VALUES ('server-a', '2026-10-20T02:00:00.000Z');");
      database.exec("DELETE FROM linked_servers WHERE id = 'server-a';");
      assert.deepEqual(database.prepare("SELECT * FROM dzn_server_status_evidence").all(), [], "Evidence must be removed with its linked server.");
    } finally {
      database.close();
    }
  `],
  { encoding: "utf8" },
);
assert.equal(localVerification.status, 0, `${localVerification.stdout ?? ""}${localVerification.stderr ?? ""}`);
console.log("Server-status evidence migration tests passed.");
