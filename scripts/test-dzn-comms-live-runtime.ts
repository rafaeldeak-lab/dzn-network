import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { hmacSha256 } from "../functions/_lib/crypto";
import { handleDznCommsModeration, handleDznCommsReport, handleDznCommsSend } from "../functions/_lib/dzn-comms-live";
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
const secret = "dzn-comms-runtime-test-secret-32-bytes-minimum";

async function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_token_hash TEXT NOT NULL, expires_at TEXT NOT NULL);
    INSERT INTO users VALUES
      ('player','100','Player',NULL),
      ('other','200','Other',NULL),
      ('owner','999','Owner',NULL);
  `);
  sqlite.exec(readFileSync("migrations/0065_dzn_comms_read_history.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0071_dzn_comms_live_moderation.sql", "utf8"));
  for (const [id, token] of [["player", "player-token"], ["other", "other-token"], ["owner", "owner-token"]]) {
    sqlite.prepare("INSERT INTO sessions (id,user_id,session_token_hash,expires_at) VALUES (?,?,?,datetime('now','+1 day'))")
      .run(`session-${id}`, id, await hmacSha256(token, secret));
  }

  let failAt = -1;
  let beforeBatch: (() => void) | undefined;
  const prepare = (sql: string, bindings: unknown[] = []) => {
    const execute = () => {
      if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...bindings), success: true, meta: { changes: 0 } };
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    };
    return {
      bind: (...values: unknown[]) => prepare(sql, values),
      first: async <T>() => sqlite.prepare(sql).get(...bindings) as T | undefined ?? null,
      all: async () => execute(),
      run: async () => execute(),
      execute,
    };
  };
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      const hook = beforeBatch;
      beforeBatch = undefined;
      hook?.();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement, index) => {
          if (index === failAt) throw new Error("Injected D1 interruption");
          return statement.execute();
        });
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
    SESSION_SECRET: secret,
    DZN_COMMS_LIVE_ENABLED: "true",
    DZN_COMMS_LIVE_SCOPE: "local_test",
    DZN_PLATFORM_OWNER_DISCORD_IDS: "999",
  } as unknown as Env;
  return {
    sqlite,
    env,
    failAt: (index: number) => { failAt = index; },
    beforeBatch: (hook: () => void) => { beforeBatch = hook; },
    count: (table: string) => Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0),
    close: () => sqlite.close(),
  };
}

function request(path: string, token: string | null, body: unknown, origin = "http://127.0.0.1") {
  const headers = new Headers({ origin, "content-type": "application/json" });
  if (token) headers.set("cookie", `dzn_session=${token}`);
  return new Request(`http://127.0.0.1${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function payload(response: Response) {
  return await response.json() as { ok?: boolean; code?: string; replayed?: boolean };
}

async function testSendRuntime() {
  const f = await fixture();
  try {
    assert.equal((await handleDznCommsSend(request("/api/comms/messages", null, {}), f.env)).status, 401);
    assert.equal((await handleDznCommsSend(request("/api/comms/messages", "player-token", {}, "https://evil.example"), f.env)).status, 403);
    const input = { channelSlug: "global-chat", clientRequestId: "request-00000001", body: "Hello DZN" };
    const sent = await handleDznCommsSend(request("/api/comms/messages", "player-token", input), f.env);
    assert.equal(sent.status, 201);
    assert.equal(f.count("dzn_comms_messages"), 1);
    assert.equal(f.count("dzn_comms_send_receipts"), 1);
    const replay = await handleDznCommsSend(request("/api/comms/messages", "player-token", input), f.env);
    assert.equal(replay.status, 200);
    assert.equal((await payload(replay)).replayed, true);
    assert.equal(f.count("dzn_comms_messages"), 1, "An idempotent retry must not duplicate the message.");
    const conflict = await handleDznCommsSend(request("/api/comms/messages", "player-token", { ...input, body: "Different" }), f.env);
    assert.equal(conflict.status, 409);
    assert.equal((await payload(conflict)).code, "REQUEST_ID_CONFLICT");
    const tooFast = await handleDznCommsSend(request("/api/comms/messages", "player-token", { ...input, clientRequestId: "request-00000002" }), f.env);
    assert.equal(tooFast.status, 429, "The five-second send guard must reject an immediate second message.");
  } finally { f.close(); }

  const rollback = await fixture();
  try {
    rollback.failAt(2);
    const result = await handleDznCommsSend(request("/api/comms/messages", "player-token", {
      channelSlug: "global-chat", clientRequestId: "request-rollback-1", body: "Rollback me",
    }), rollback.env);
    assert.equal(result.status, 429);
    assert.equal(rollback.count("dzn_comms_messages"), 0);
    assert.equal(rollback.count("dzn_comms_send_slots"), 0);
    assert.equal(rollback.count("dzn_comms_attempt_slots"), 0);
    assert.equal(rollback.count("dzn_comms_send_receipts"), 0);
  } finally { rollback.close(); }

  const raced = await fixture();
  try {
    raced.beforeBatch(() => raced.sqlite.prepare(`INSERT INTO dzn_comms_send_receipts
      (id,actor_user_id,channel_id,client_request_id,body_hash,decision,response_status,reason_code,expires_at)
      VALUES ('raced','player','dzn-global-chat','request-race-0001','different-hash','block',422,'SPAM_BLOCKED',datetime('now','+1 day'))`).run());
    const result = await handleDznCommsSend(request("/api/comms/messages", "player-token", {
      channelSlug: "global-chat", clientRequestId: "request-race-0001", body: "Original body",
    }), raced.env);
    assert.equal(result.status, 409, "A concurrent different-body receipt must remain a conflict, not a quota error.");
    assert.equal((await payload(result)).code, "REQUEST_ID_CONFLICT");
    assert.equal(raced.count("dzn_comms_messages"), 0);
  } finally { raced.close(); }
}

async function testReportAndModerationRuntime() {
  const f = await fixture();
  try {
    f.sqlite.prepare(`INSERT INTO dzn_comms_messages
      (id,channel_id,author_user_id,author_display_name,body,visibility_state)
      VALUES ('message-other','dzn-global-chat','other','Other','Review this','visible')`).run();
    const reportInput = { messageId: "message-other", reason: "other" };
    const reported = await handleDznCommsReport(request("/api/comms/reports", "player-token", reportInput), f.env);
    assert.equal(reported.status, 202);
    assert.equal(f.count("dzn_comms_reports"), 1);
    const replay = await handleDznCommsReport(request("/api/comms/reports", "player-token", reportInput), f.env);
    assert.equal(replay.status, 202);
    assert.equal((await payload(replay)).replayed, true);
    assert.equal(f.count("dzn_comms_reports"), 1);
    assert.equal((await handleDznCommsModeration(request("/api/owner/comms/moderate", "other-token", {
      messageId: "message-other", action: "hide", reason: "review",
    }), f.env)).status, 403, "A non-platform owner must not moderate chat.");
    const hidden = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId: "message-other", action: "hide", reason: "review",
    }), f.env);
    assert.equal(hidden.status, 200);
    assert.equal(f.count("dzn_comms_moderation_audit"), 1);
    const noOp = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId: "message-other", action: "hide", reason: "repeat",
    }), f.env);
    assert.equal(noOp.status, 409);
    assert.equal((await payload(noOp)).code, "MODERATION_NO_CHANGE");
    assert.equal(f.count("dzn_comms_moderation_audit"), 1, "A no-op must not create a false audit row.");
    const resolved = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId: "message-other", action: "resolve_report", reason: "handled",
    }), f.env);
    assert.equal(resolved.status, 200);
    assert.equal(f.count("dzn_comms_moderation_audit"), 2);
    const resolveNoOp = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId: "message-other", action: "resolve_report", reason: "repeat",
    }), f.env);
    assert.equal(resolveNoOp.status, 409);
    assert.equal(f.count("dzn_comms_moderation_audit"), 2);
  } finally { f.close(); }
}

async function main() {
  await testSendRuntime();
  await testReportAndModerationRuntime();
  console.log("Live Comms handlers: auth, origin, idempotency, conflict, quota, rollback, report and moderation behavior passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
