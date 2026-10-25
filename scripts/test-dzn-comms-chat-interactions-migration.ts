import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const migration = "0114_dzn_comms_chat_interactions.sql";
const source = readFileSync(`migrations/${migration}`, "utf8");
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => {
  exec(sql: string): void;
  prepare(sql: string): { all(...values: unknown[]): Array<Record<string, unknown>>; get(...values: unknown[]): Record<string, unknown> | undefined; run(...values: unknown[]): unknown };
  close(): void;
} };

const triggers = [
  "dzn_comms_custom_emoji_reaction_visible_insert",
  "dzn_comms_custom_emoji_reaction_visible_reactivate",
  "dzn_comms_custom_emoji_reaction_actor_cap_insert",
  "dzn_comms_custom_emoji_reaction_actor_cap_reactivate",
  "dzn_comms_custom_emoji_reaction_message_cap_insert",
  "dzn_comms_custom_emoji_reaction_message_cap_reactivate",
  "dzn_comms_custom_emoji_reactions_message_unavailable",
  "dzn_comms_legacy_reaction_actor_cap_insert",
  "dzn_comms_legacy_reaction_actor_cap_reactivate",
  "dzn_comms_legacy_reaction_message_cap_insert",
  "dzn_comms_legacy_reaction_message_cap_reactivate",
];

assert.match(source, /^CREATE TABLE IF NOT EXISTS dzn_comms_custom_emoji_reactions \(/m);
assert.match(source, /^CREATE TABLE IF NOT EXISTS dzn_comms_typing_sessions \(/m);
assert.match(source, /CREATE INDEX IF NOT EXISTS idx_dzn_comms_custom_emoji_reactions_message_active/i);
assert.match(source, /CREATE INDEX IF NOT EXISTS idx_dzn_comms_typing_channel_expiry/i);
for (const trigger of triggers) assert.match(source, new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}\\b`, "i"));
const sourceOutsideTriggers = source.replace(/CREATE\s+TRIGGER\s+[\s\S]*?\bEND\s*;/gi, "");
assert.doesNotMatch(sourceOutsideTriggers, /\b(?:DROP|TRUNCATE|INSERT|UPDATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i);

const stageDirectory = mkdtempSync(join(process.cwd(), ".dzn-comms-chat-interactions-stage-test-"));
rmSync(stageDirectory, { force: true, recursive: true });
try {
  const staged = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/dzn-single-migration-production-rollout.ts",
      "prepare",
      "--migration",
      migration,
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
      indexes: string[];
      triggers: string[];
    };
    expectedObjectSql: Record<string, string>;
  };
  assert.equal(plan.migration.predecessor, "0113_dzn_server_status_evidence.sql");
  assert.deepEqual(plan.migration.indexes, ["idx_dzn_comms_custom_emoji_reactions_message_active", "idx_dzn_comms_typing_channel_expiry"]);
  assert.deepEqual(plan.migration.triggers, triggers);
  assert.deepEqual(plan.migration.tables.map((table) => table.name), ["dzn_comms_custom_emoji_reactions", "dzn_comms_typing_sessions"]);
  assert.deepEqual(Object.keys(plan.expectedObjectSql).sort(), [
    "dzn_comms_custom_emoji_reaction_actor_cap_insert",
    "dzn_comms_custom_emoji_reaction_actor_cap_reactivate",
    "dzn_comms_custom_emoji_reaction_message_cap_insert",
    "dzn_comms_custom_emoji_reaction_message_cap_reactivate",
    "dzn_comms_custom_emoji_reaction_visible_insert",
    "dzn_comms_custom_emoji_reaction_visible_reactivate",
    "dzn_comms_custom_emoji_reactions",
    "dzn_comms_custom_emoji_reactions_message_unavailable",
    "dzn_comms_legacy_reaction_actor_cap_insert",
    "dzn_comms_legacy_reaction_actor_cap_reactivate",
    "dzn_comms_legacy_reaction_message_cap_insert",
    "dzn_comms_legacy_reaction_message_cap_reactivate",
    "dzn_comms_typing_sessions",
    "idx_dzn_comms_custom_emoji_reactions_message_active",
    "idx_dzn_comms_typing_channel_expiry",
  ]);
} finally {
  rmSync(stageDirectory, { force: true, recursive: true });
}

const database = new DatabaseSync(":memory:");
try {
  database.exec([
    "PRAGMA foreign_keys = ON;",
    "CREATE TABLE users (id TEXT PRIMARY KEY);",
    "CREATE TABLE dzn_comms_channels (id TEXT PRIMARY KEY);",
    "CREATE TABLE dzn_comms_messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES dzn_comms_channels(id), visibility_state TEXT NOT NULL, expires_at TEXT);",
    "CREATE TABLE dzn_comms_message_reactions (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, reaction_key TEXT NOT NULL, active INTEGER NOT NULL);",
    "INSERT INTO users (id) VALUES ('member');",
    "INSERT INTO dzn_comms_channels (id) VALUES ('dzn-global-chat');",
    "INSERT INTO dzn_comms_messages (id, channel_id, visibility_state) VALUES ('visible-message', 'dzn-global-chat', 'visible'), ('hidden-message', 'dzn-global-chat', 'hidden');",
  ].join("\n"));
  const legacySql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dzn_comms_message_reactions'").get()?.sql ?? "");
  database.exec(source);
  assert.equal(database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'dzn_comms_message_reactions'").get()?.sql, legacySql, "The migration must leave legacy reactions intact.");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.prepare("INSERT INTO dzn_comms_custom_emoji_reactions (id, message_id, actor_user_id, reaction_key) VALUES ('reaction-a', 'visible-message', 'member', 'emoji:1f44d')").run();
  assert.throws(() => database.prepare("INSERT INTO dzn_comms_custom_emoji_reactions (id, message_id, actor_user_id, reaction_key) VALUES ('reaction-b', 'hidden-message', 'member', 'emoji:1f44d')").run());
  database.prepare("UPDATE dzn_comms_messages SET visibility_state = 'hidden' WHERE id = 'visible-message'").run();
  assert.equal(database.prepare("SELECT active FROM dzn_comms_custom_emoji_reactions WHERE id = 'reaction-a'").get()?.active, 0);
  database.prepare("INSERT INTO dzn_comms_typing_sessions (channel_id, actor_user_id, display_name, expires_at) VALUES ('dzn-global-chat', 'member', 'Member', '2099-01-01T00:00:00.000Z')").run();
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM dzn_comms_typing_sessions").get()?.count, 1);
} finally {
  database.close();
}

console.log("DZN Comms chat-interactions migration tests passed.");
