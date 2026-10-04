import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { hmacSha256 } from "../functions/_lib/crypto";
import { handleDznCommsMessageHistoryRequest } from "../functions/_lib/dzn-comms-read-history";
import { runDznCommsRetention } from "../functions/_lib/dzn-comms-live";
import { handleDznCommsReactionRemoval, handleDznCommsReactions } from "../functions/_lib/dzn-comms-reactions";
import type { Env } from "../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    all(...values: unknown[]): Row[];
    get(...values: unknown[]): Row | undefined;
    run(...values: unknown[]): { changes: number | bigint };
  };
};

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
const sessionSecret = "dzn-comms-reaction-session-secret-32-bytes";
const ledgerSecret = "dzn-comms-reaction-ledger-secret-32-bytes";

async function fixture(includeReactionMigration = true) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL, expires_at TEXT NOT NULL);
    INSERT INTO users VALUES
      ('player','100','Player',NULL), ('other','200','Other',NULL),
      ('outsider','300','Outsider',NULL), ('owner','999','Owner',NULL);`);
  sqlite.exec(readFileSync("migrations/0065_dzn_comms_read_history.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0071_dzn_comms_live_moderation.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0072_dzn_comms_private_rate_ledgers.sql", "utf8"));
  if (includeReactionMigration) sqlite.exec(readFileSync("migrations/0078_dzn_comms_reactions.sql", "utf8"));
  sqlite.exec(`
    INSERT INTO dzn_comms_channels (id, slug, kind, name, visibility, is_readable)
      VALUES ('private-channel', 'squad-room', 'private_group', 'Squad Room', 'private_group', 1);
    INSERT INTO dzn_comms_private_group_members (channel_id, user_id, role, membership_state)
      VALUES ('private-channel', 'player', 'member', 'active');
    INSERT INTO dzn_comms_messages
      (id, channel_id, author_user_id, author_display_name, author_role_label, body, visibility_state, source_label, expires_at)
      VALUES
      ('public-message', 'dzn-global-chat', 'other', 'Other', 'Member', 'Public message', 'visible', 'test', datetime('now','+1 day')),
      ('second-message', 'dzn-global-chat', 'other', 'Other', 'Member', 'Second message', 'visible', 'test', datetime('now','+1 day')),
      ('private-message', 'private-channel', 'other', 'Other', 'Member', 'Private message', 'visible', 'test', datetime('now','+1 day'));`);
  for (const [id, token] of [["player", "player-token"], ["other", "other-token"], ["outsider", "outsider-token"], ["owner", "owner-token"]]) {
    sqlite.prepare("INSERT INTO sessions (id,user_id,session_token_hash,expires_at) VALUES (?,?,?,datetime('now','+1 day'))")
      .run(`session-${id}`, id, await hmacSha256(token, sessionSecret));
  }

  let queryCount = 0;
  let afterMembershipCheck: (() => void) | null = null;
  const prepare = (sql: string, bindings: unknown[] = []) => {
    const execute = () => {
      queryCount += 1;
      if (/^\s*(?:SELECT|PRAGMA)/i.test(sql)) return { results: sqlite.prepare(sql).all(...bindings), success: true, meta: { changes: 0 } };
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    };
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      first: async <T>() => {
        queryCount += 1;
        const result = sqlite.prepare(sql).get(...bindings) as T | undefined ?? null;
        if (sql.includes("SELECT 1 AS allowed FROM dzn_comms_private_group_members") && afterMembershipCheck) {
          const hook = afterMembershipCheck;
          afterMembershipCheck = null;
          hook();
        }
        return result;
      },
      all: async () => execute(),
      run: async () => execute(),
      execute,
    };
  };
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    DB: db,
    SESSION_SECRET: sessionSecret,
    DZN_COMMS_LEDGER_SECRET: ledgerSecret,
    DZN_COMMS_LIVE_ENABLED: "true",
    DZN_COMMS_LIVE_SCOPE: "local_test",
    DZN_COMMS_REACTIONS_READ_ENABLED: "true",
    DZN_COMMS_REACTIONS_WRITE_ENABLED: "true",
    DZN_COMMS_REACTIONS_SCOPE: "local_test",
    DZN_COMMS_PRIVATE_GROUPS_ENABLED: "true",
  } as unknown as Env;
  return {
    sqlite,
    env,
    count: (table: string) => Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0),
    queryCount: () => queryCount,
    resetQueryCount: () => { queryCount = 0; },
    setAfterMembershipCheck: (hook: (() => void) | null) => { afterMembershipCheck = hook; },
    close: () => sqlite.close(),
  };
}

function request(method: "GET" | "POST" | "DELETE", path: string, token: string | null, body?: unknown, origin = "http://127.0.0.1") {
  const headers = new Headers();
  if (token) headers.set("cookie", `dzn_session=${token}`);
  if (method !== "GET") {
    headers.set("origin", origin);
    headers.set("content-type", "application/json");
  }
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

async function payload(response: Response) {
  return await response.json() as {
    code?: string;
    result?: string;
    replayed?: boolean;
    counts?: { key: string; emoji: string; label: string; count: number; current_user_reacted: boolean }[];
    messages?: { id: string; reactions?: { counts: { count: number; current_user_reacted: boolean }[] } }[];
  };
}

async function testMigrationAndFlags() {
  const f = await fixture();
  try {
    const required = ["dzn_comms_message_reactions", "dzn_comms_reaction_mutations", "dzn_comms_reaction_rate_slots"];
    const tables = new Set(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)));
    assert.deepEqual(required.filter((table) => !tables.has(table)), []);
    assert.equal(f.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.throws(() => f.sqlite.prepare(`INSERT INTO dzn_comms_message_reactions
      (id,message_id,actor_user_id,reaction_key) VALUES ('bad','public-message','player','client-supplied')`).run());
    const disabled = { ...f.env, DZN_COMMS_REACTIONS_READ_ENABLED: "false", DZN_COMMS_REACTIONS_WRITE_ENABLED: "false" } as Env;
    assert.equal((await handleDznCommsReactions(request("GET", "/api/comms/messages/public-message/reactions", null), disabled, "public-message")).status, 404);
    const noSecret = { ...f.env, DZN_COMMS_LEDGER_SECRET: undefined } as Env;
    assert.equal((await handleDznCommsReactions(request("GET", "/api/comms/messages/public-message/reactions", null), noSecret, "public-message")).status, 404);
  } finally { f.close(); }
}

async function testPublicReactionLifecycle() {
  const f = await fixture();
  try {
    const path = "/api/comms/messages/public-message/reactions";
    assert.equal((await handleDznCommsReactions(request("GET", path, null), f.env, "public-message")).status, 200);
    assert.equal((await handleDznCommsReactions(request("POST", path, null, {}), f.env, "public-message")).status, 401);
    assert.equal((await handleDznCommsReactions(request("POST", path, "player-token", {}, "https://evil.example"), f.env, "public-message")).status, 403);
    assert.equal((await handleDznCommsReactions(request("POST", path, "player-token", {
      clientMutationId: "reaction-request-0001", reactionKey: "money",
    }), f.env, "public-message")).status, 422);

    const input = { clientMutationId: "reaction-request-0002", reactionKey: "heart" };
    const added = await handleDznCommsReactions(request("POST", path, "player-token", input), f.env, "public-message");
    assert.equal(added.status, 201);
    assert.equal((await payload(added)).result, "added");
    assert.equal(f.count("dzn_comms_message_reactions"), 1);
    assert.equal(f.count("dzn_comms_reaction_mutations"), 1);
    const receipt = f.sqlite.prepare("SELECT actor_mutation_key, request_hash FROM dzn_comms_reaction_mutations").get();
    assert.equal(JSON.stringify(receipt).includes("player"), false, "Mutation receipts must not store the raw user ID.");
    assert.notEqual(f.sqlite.prepare("SELECT actor_rate_key FROM dzn_comms_reaction_rate_slots").get()?.actor_rate_key, "player");

    const replay = await handleDznCommsReactions(request("POST", path, "player-token", input), f.env, "public-message");
    assert.equal((await payload(replay)).replayed, true);
    assert.equal(f.count("dzn_comms_message_reactions"), 1);
    assert.equal((await handleDznCommsReactions(request("POST", path, "player-token", { ...input, reactionKey: "fire" }), f.env, "public-message")).status, 409);
    assert.equal((await payload(await handleDznCommsReactions(request("POST", path, "player-token", {
      clientMutationId: "reaction-request-0003", reactionKey: "heart",
    }), f.env, "public-message"))).result, "already_present");
    assert.equal((await handleDznCommsReactions(request("POST", path, "other-token", {
      clientMutationId: "reaction-request-0004", reactionKey: "heart",
    }), f.env, "public-message")).status, 201);

    const anonymous = await payload(await handleDznCommsReactions(request("GET", path, null), f.env, "public-message"));
    assert.deepEqual(anonymous.counts, [{ key: "heart", emoji: "\u{1F49C}", label: "Heart", count: 2, current_user_reacted: false }]);
    const signedIn = await payload(await handleDznCommsReactions(request("GET", path, "player-token"), f.env, "public-message"));
    assert.equal(signedIn.counts?.[0]?.current_user_reacted, true);
    f.resetQueryCount();
    const history = await payload(await handleDznCommsMessageHistoryRequest(
      request("GET", "/api/comms/message-history?channel=global-chat", "player-token"), f.env,
    ));
    assert.ok(f.queryCount() <= 8, `History plus all reaction summaries must stay bounded; observed ${f.queryCount()} D1 queries.`);
    const historyMessage = history.messages?.find((message) => message.id === "public-message");
    assert.equal(historyMessage?.reactions?.counts[0]?.count, 2);
    assert.equal(historyMessage?.reactions?.counts[0]?.current_user_reacted, true);

    const removePath = `${path}/heart`;
    const removed = await handleDznCommsReactionRemoval(request("DELETE", removePath, "player-token", {
      clientMutationId: "reaction-request-0005",
    }), f.env, "public-message", "heart");
    assert.equal((await payload(removed)).result, "removed");
    assert.equal((await payload(await handleDznCommsReactions(request("GET", path, null), f.env, "public-message"))).counts?.[0]?.count, 1);
    const absent = await handleDznCommsReactionRemoval(request("DELETE", removePath, "player-token", {
      clientMutationId: "reaction-request-0006",
    }), f.env, "public-message", "heart");
    assert.equal((await payload(absent)).result, "already_absent");
  } finally { f.close(); }
}

async function testPrivateScopeAndModerationRemoval() {
  const f = await fixture();
  try {
    const privatePath = "/api/comms/messages/private-message/reactions";
    const privateDisabled = { ...f.env, DZN_COMMS_PRIVATE_GROUPS_ENABLED: "false" } as Env;
    assert.equal((await handleDznCommsReactions(request("GET", privatePath, "player-token"), privateDisabled, "private-message")).status, 404);
    assert.equal((await handleDznCommsReactions(request("POST", privatePath, "player-token", {
      clientMutationId: "reaction-private-disabled-add", reactionKey: "salute",
    }), privateDisabled, "private-message")).status, 404);
    assert.equal((await handleDznCommsReactionRemoval(request("DELETE", `${privatePath}/salute`, "player-token", {
      clientMutationId: "reaction-private-disabled-remove",
    }), privateDisabled, "private-message", "salute")).status, 404);
    assert.equal(f.count("dzn_comms_reaction_mutations"), 0, "A disabled private-group switch must prevent reaction receipts and writes.");
    assert.equal((await handleDznCommsReactions(request("GET", privatePath, "outsider-token"), f.env, "private-message")).status, 404);
    assert.equal((await handleDznCommsReactions(request("GET", privatePath, "player-token"), f.env, "private-message")).status, 200);
    assert.equal((await handleDznCommsReactions(request("POST", privatePath, "outsider-token", {
      clientMutationId: "reaction-private-0001", reactionKey: "salute",
    }), f.env, "private-message")).status, 404);
    assert.equal((await handleDznCommsReactions(request("POST", privatePath, "player-token", {
      clientMutationId: "reaction-private-0002", reactionKey: "salute",
    }), f.env, "private-message")).status, 201);
    assert.equal((await handleDznCommsReactions(request("POST", privatePath, "player-token", {
      clientMutationId: "reaction-private-0002", reactionKey: "salute",
    }), privateDisabled, "private-message")).status, 404, "A disabled switch must block mutation replay receipts.");
    f.sqlite.prepare("UPDATE dzn_comms_private_group_members SET membership_state = 'removed' WHERE channel_id = ? AND user_id = ?")
      .run("private-channel", "player");
    assert.equal((await handleDznCommsReactionRemoval(request("DELETE", `${privatePath}/salute`, "player-token", {
      clientMutationId: "reaction-private-0003",
    }), f.env, "private-message", "salute")).status, 404);

    const publicPath = "/api/comms/messages/second-message/reactions";
    assert.equal((await handleDznCommsReactions(request("POST", publicPath, "player-token", {
      clientMutationId: "reaction-hidden-0001", reactionKey: "fire",
    }), f.env, "second-message")).status, 201);
    f.sqlite.prepare("UPDATE dzn_comms_messages SET visibility_state='hidden' WHERE id='second-message'").run();
    assert.equal(f.sqlite.prepare("SELECT active FROM dzn_comms_message_reactions WHERE message_id='second-message'").get()?.active, 0);
    assert.equal((await handleDznCommsReactions(request("GET", publicPath, null), f.env, "second-message")).status, 404);
  } finally { f.close(); }
}

async function testRateLimitAndRetentionCompatibility() {
  const limited = await fixture();
  try {
    const path = "/api/comms/messages/public-message/reactions";
    for (let index = 0; index < 30; index += 1) {
      const response = await handleDznCommsReactions(request("POST", path, "player-token", {
        clientMutationId: `rate-limit-request-${String(index).padStart(3, "0")}`,
        reactionKey: "boost",
      }), limited.env, "public-message");
      assert.notEqual(response.status, 429);
    }
    assert.equal((await handleDznCommsReactions(request("POST", path, "player-token", {
      clientMutationId: "rate-limit-request-999", reactionKey: "boost",
    }), limited.env, "public-message")).status, 429);
  } finally { limited.close(); }

  const migrated = await fixture();
  try {
    migrated.sqlite.prepare(`INSERT INTO dzn_comms_reaction_mutations
      (id,actor_mutation_key,message_id,reaction_key,action,request_hash,result,response_status,expires_at)
      VALUES ('expired-receipt','expired-key','public-message','heart','add','hash','added',201,datetime('now','-1 day'))`).run();
    migrated.sqlite.prepare(`INSERT INTO dzn_comms_reaction_rate_slots
      (actor_rate_key,minute_bucket,slot,created_at) VALUES ('expired-rate','old',1,datetime('now','-3 day'))`).run();
    const result = await runDznCommsRetention(migrated.env.DB, new Date());
    assert.equal(result.reactionMutationReceiptsDeleted, 1);
    assert.equal(result.reactionRateSlotsDeleted, 1);
  } finally { migrated.close(); }

  const legacy = await fixture(false);
  try {
    const result = await runDznCommsRetention(legacy.env.DB, new Date());
    assert.equal(result.reactionMutationReceiptsDeleted, 0, "Retention must stay compatible before migration 0078 is applied.");
    assert.equal(result.reactionRateSlotsDeleted, 0);
  } finally { legacy.close(); }
}

async function testPrivateRevocationRaces() {
  const read = await fixture();
  try {
    read.setAfterMembershipCheck(() => read.sqlite.prepare(
      "UPDATE dzn_comms_private_group_members SET membership_state = 'removed' WHERE channel_id = 'private-channel' AND user_id = 'player'",
    ).run());
    assert.equal((await handleDznCommsReactions(
      request("GET", "/api/comms/messages/private-message/reactions", "player-token"), read.env, "private-message",
    )).status, 404, "A reaction summary must not survive in-flight membership revocation.");
  } finally { read.close(); }

  const added = await fixture();
  try {
    added.setAfterMembershipCheck(() => added.sqlite.prepare(
      "UPDATE dzn_comms_private_group_members SET membership_state = 'removed' WHERE channel_id = 'private-channel' AND user_id = 'player'",
    ).run());
    const response = await handleDznCommsReactions(request("POST", "/api/comms/messages/private-message/reactions", "player-token", {
      clientMutationId: "reaction-private-race-add", reactionKey: "salute",
    }), added.env, "private-message");
    assert.equal(response.status, 404);
    assert.equal(added.count("dzn_comms_message_reactions"), 0, "Revoked membership must prevent the private reaction write.");
    assert.equal(added.count("dzn_comms_reaction_mutations"), 0, "Revoked membership must prevent a private mutation receipt.");
  } finally { added.close(); }

  const replay = await fixture();
  try {
    const input = { clientMutationId: "reaction-private-race-replay", reactionKey: "salute" };
    assert.equal((await handleDznCommsReactions(request("POST", "/api/comms/messages/private-message/reactions", "player-token", input), replay.env, "private-message")).status, 201);
    replay.setAfterMembershipCheck(() => replay.sqlite.prepare(
      "UPDATE dzn_comms_private_group_members SET membership_state = 'removed' WHERE channel_id = 'private-channel' AND user_id = 'player'",
    ).run());
    assert.equal((await handleDznCommsReactions(request("POST", "/api/comms/messages/private-message/reactions", "player-token", input), replay.env, "private-message")).status, 404, "A replay must recheck current private membership.");
  } finally { replay.close(); }

  const removed = await fixture();
  try {
    assert.equal((await handleDznCommsReactions(request("POST", "/api/comms/messages/private-message/reactions", "player-token", {
      clientMutationId: "reaction-private-race-remove-seed", reactionKey: "salute",
    }), removed.env, "private-message")).status, 201);
    removed.setAfterMembershipCheck(() => removed.sqlite.prepare(
      "UPDATE dzn_comms_private_group_members SET membership_state = 'removed' WHERE channel_id = 'private-channel' AND user_id = 'player'",
    ).run());
    assert.equal((await handleDznCommsReactionRemoval(request("DELETE", "/api/comms/messages/private-message/reactions/salute", "player-token", {
      clientMutationId: "reaction-private-race-remove",
    }), removed.env, "private-message", "salute")).status, 404);
    assert.equal(removed.sqlite.prepare("SELECT active FROM dzn_comms_message_reactions WHERE message_id='private-message' AND actor_user_id='player' AND reaction_key='salute'").get()?.active, 1, "Revoked membership must prevent the private reaction removal.");
  } finally { removed.close(); }
}

async function main() {
  await testMigrationAndFlags();
  await testPublicReactionLifecycle();
  await testPrivateScopeAndModerationRemoval();
  await testPrivateRevocationRaces();
  await testRateLimitAndRetentionCompatibility();
  console.log("DZN Comms reaction runtime tests passed.");
}

void main();
