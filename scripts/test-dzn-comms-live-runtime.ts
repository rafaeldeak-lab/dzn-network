import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { hmacSha256 } from "../functions/_lib/crypto";
import { handleDznCommsModeration, handleDznCommsReport, handleDznCommsSend, runDznCommsRetention } from "../functions/_lib/dzn-comms-live";
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
async function receiptKey(actorId: string, requestId: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`dzn-comms-receipt:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${actorId.normalize("NFKC")}\n${requestId.normalize("NFKC")}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
  sqlite.exec(readFileSync("migrations/0072_dzn_comms_private_rate_ledgers.sql", "utf8"));
  const requiredTables = ["dzn_comms_channels", "dzn_comms_messages", "dzn_comms_send_receipts", "dzn_comms_reports", "dzn_comms_moderation_audit"];
  const installedTables = new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
  assert.deepEqual(requiredTables.filter((table) => !installedTables.has(table)), [], "Both Comms migrations must install the required tables.");
  assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0, "Comms migrations must preserve foreign-key integrity.");
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
    DZN_COMMS_OWNER_MODERATION_ENABLED: "true",
    DZN_COMMS_OWNER_MODERATION_SCOPE: "local_test",
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

function request(path: string, token: string | null, body: unknown, origin = "http://127.0.0.1", baseUrl = "http://127.0.0.1") {
  const headers = new Headers({ origin, "content-type": "application/json" });
  if (token) headers.set("cookie", `dzn_session=${token}`);
  return new Request(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function getRequest(path: string, token: string | null) {
  const headers = new Headers();
  if (token) headers.set("cookie", `dzn_session=${token}`);
  return new Request(`http://127.0.0.1${path}`, { headers });
}

async function payload(response: Response) {
  return await response.json() as { ok?: boolean; code?: string; replayed?: boolean; message_id?: string };
}

async function testSendRuntime() {
  const f = await fixture();
  try {
    assert.equal((await handleDznCommsSend(request("/api/comms/messages", null, {}), f.env)).status, 401);
    assert.equal((await handleDznCommsSend(request("/api/comms/messages", "player-token", {}, "https://evil.example"), f.env)).status, 403);
    const ipv6Request = request("/api/comms/messages", "player-token", {}, "http://[::1]", "http://[::1]");
    assert.notEqual((await handleDznCommsSend(ipv6Request, f.env)).status, 404, "Bracketed IPv6 loopback must be accepted in local_test scope.");
    const input = { channelSlug: "global-chat", clientRequestId: "request-00000001", body: "Hello DZN" };
    const sent = await handleDznCommsSend(request("/api/comms/messages", "player-token", input), f.env);
    assert.equal(sent.status, 201);
    assert.equal(f.count("dzn_comms_messages"), 1);
    const storedMessage = f.sqlite.prepare("SELECT expires_at FROM dzn_comms_messages WHERE id = ?").get((await payload(sent)).message_id) as { expires_at?: string } | undefined;
    assert.ok(storedMessage?.expires_at, "Accepted messages must receive an explicit expiry timestamp.");
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
    f.sqlite.prepare("UPDATE dzn_comms_send_slots SET accepted_at = datetime('now','-10 seconds')").run();
    const second = await handleDznCommsSend(request("/api/comms/messages", "player-token", { ...input, clientRequestId: "request-00000003" }), f.env);
    assert.equal(second.status, 201);
    const receiptKeys = f.sqlite.prepare("SELECT actor_receipt_key FROM dzn_comms_send_receipts ORDER BY created_at, id").all();
    assert.equal(receiptKeys.length, 2);
    assert.notEqual(receiptKeys[0]?.actor_receipt_key, receiptKeys[1]?.actor_receipt_key, "Separate requests from one account must not share a correlatable receipt key.");
  } finally { f.close(); }

  const replayQuota = await fixture();
  try {
    const input = { channelSlug: "global-chat", clientRequestId: "request-replay-quota", body: "Replay quota" };
    assert.equal((await handleDznCommsSend(request("/api/comms/messages", "player-token", input), replayQuota.env)).status, 201);
    for (let index = 1; index < 30; index += 1) {
      assert.equal((await handleDznCommsSend(request("/api/comms/messages", "player-token", input), replayQuota.env)).status, 200);
    }
    const limited = await handleDznCommsSend(request("/api/comms/messages", "player-token", input), replayQuota.env);
    assert.equal(limited.status, 429, "Idempotent replays must still consume the authenticated attempt quota.");
    assert.equal((await payload(limited)).code, "RATE_LIMITED");
    assert.equal(replayQuota.count("dzn_comms_attempt_slots"), 30);
    assert.equal(replayQuota.count("dzn_comms_messages"), 1);
  } finally { replayQuota.close(); }

  const expired = await fixture();
  try {
    const playerReceiptKey = await receiptKey("player", "request-expired-1");
    expired.sqlite.prepare(`INSERT INTO dzn_comms_send_receipts
      (id,actor_receipt_key,channel_id,client_request_id,body_hash,decision,response_status,reason_code,expires_at)
      VALUES ('expired',?,'dzn-global-chat','request-expired-1','old-hash','block',422,'SPAM_BLOCKED',datetime('now','-1 day'))`).run(playerReceiptKey);
    const replaced = await handleDznCommsSend(request("/api/comms/messages", "player-token", {
      channelSlug: "global-chat", clientRequestId: "request-expired-1", body: "Fresh request after receipt expiry",
    }), expired.env);
    assert.equal(replaced.status, 201, "Expired idempotency receipts must not block a fresh request ID lifecycle.");
    assert.equal(expired.count("dzn_comms_send_receipts"), 1);
    assert.equal(expired.count("dzn_comms_messages"), 1);
  } finally { expired.close(); }

  const rollback = await fixture();
  try {
    rollback.failAt(2);
    const result = await handleDznCommsSend(request("/api/comms/messages", "player-token", {
      channelSlug: "global-chat", clientRequestId: "request-rollback-1", body: "Rollback me",
    }), rollback.env);
    assert.equal(result.status, 503);
    assert.equal((await payload(result)).code, "CHAT_STORAGE_UNAVAILABLE");
    assert.equal(rollback.count("dzn_comms_messages"), 0);
    assert.equal(rollback.count("dzn_comms_send_slots"), 0);
    assert.equal(rollback.count("dzn_comms_attempt_slots"), 1, "The authenticated attempt remains counted even when message storage fails.");
    assert.equal(rollback.count("dzn_comms_send_receipts"), 0);
  } finally { rollback.close(); }

  const raced = await fixture();
  try {
    const playerReceiptKey = await receiptKey("player", "request-race-0001");
    raced.beforeBatch(() => raced.sqlite.prepare(`INSERT INTO dzn_comms_send_receipts
      (id,actor_receipt_key,channel_id,client_request_id,body_hash,decision,response_status,reason_code,expires_at)
      VALUES ('raced',?,'dzn-global-chat','request-race-0001','different-hash','block',422,'SPAM_BLOCKED',datetime('now','+1 day'))`).run(playerReceiptKey));
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
    assert.equal((await handleDznCommsModeration(getRequest("/api/owner/comms/moderate", "other-token"), f.env)).status, 403, "A non-platform owner must not read the moderation queue.");
    const queue = await handleDznCommsModeration(getRequest("/api/owner/comms/moderate", "owner-token"), f.env);
    assert.equal(queue.status, 200);
    const queuePayload = await queue.json() as { reports?: Array<{ message_id: string }> };
    assert.equal(queuePayload.reports?.[0]?.message_id, "message-other", "The owner queue must expose reported messages.");
    const hidden = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId: "message-other", action: "hide", reason: "review",
    }), { ...f.env, DZN_COMMS_LIVE_ENABLED: "false" } as Env);
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

  const erased = await fixture();
  try {
    const sent = await handleDznCommsSend(request("/api/comms/messages", "other-token", {
      channelSlug: "global-chat", clientRequestId: "delete-request-0001", body: "Sensitive text to erase",
    }), erased.env);
    assert.equal(sent.status, 201);
    const messageId = (await payload(sent)).message_id!;
    erased.sqlite.prepare("UPDATE dzn_comms_send_slots SET accepted_at = datetime('now','-10 seconds')").run();
    const retained = await handleDznCommsSend(request("/api/comms/messages", "other-token", {
      channelSlug: "global-chat", clientRequestId: "retain-request-0001", body: "Retained message",
    }), erased.env);
    assert.equal(retained.status, 201);
    const retainedMessageId = (await payload(retained)).message_id!;
    erased.sqlite.prepare(`INSERT INTO dzn_comms_reports (id,message_id,reporter_user_id,reason_code)
      VALUES ('report-delete',?,'player','personal_information')`).run(messageId);
    const receiptBefore = erased.sqlite.prepare("SELECT actor_receipt_key,send_rate_key,send_minute_bucket,send_slot FROM dzn_comms_send_receipts WHERE message_id = ?").get(messageId);
    const retainedReceipt = erased.sqlite.prepare("SELECT actor_receipt_key FROM dzn_comms_send_receipts WHERE message_id = ?").get(retainedMessageId);
    const attemptKeys = erased.sqlite.prepare("SELECT DISTINCT actor_attempt_key FROM dzn_comms_attempt_slots").all();
    assert.match(String(receiptBefore?.actor_receipt_key), /^[a-f0-9]{64}$/, "Accepted sends must use a pseudonymous receipt key.");
    assert.notEqual(receiptBefore?.actor_receipt_key, retainedReceipt?.actor_receipt_key, "Receipts for one author must use unlinkable per-request keys.");
    assert.deepEqual(attemptKeys.length, 1, "One author's attempt quota must retain one pseudonymous key.");
    assert.match(String(attemptKeys[0]?.actor_attempt_key), /^[a-f0-9]{64}$/, "Attempt quotas must not retain the raw account ID.");
    assert.match(String(receiptBefore?.send_rate_key), /^[a-f0-9]{64}$/, "Accepted sends must use a pseudonymous rate key.");
    assert.ok(receiptBefore?.send_minute_bucket && receiptBefore?.send_slot, "The receipt must persist the exact allocated slot.");
    assert.equal(erased.count("dzn_comms_send_slots"), 2);
    const response = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId, action: "delete", reason: "personal information",
    }), erased.env);
    assert.equal(response.status, 200);
    const row = erased.sqlite.prepare("SELECT body,author_user_id,visibility_state FROM dzn_comms_messages WHERE id = ?").get(messageId) as Row;
    assert.equal(row.body, "Message deleted.");
    assert.equal(row.author_user_id, null);
    assert.equal(row.visibility_state, "deleted");
    assert.equal(erased.sqlite.prepare("SELECT status FROM dzn_comms_reports WHERE id = 'report-delete'").get()?.status, "resolved");
    const receiptAfter = erased.sqlite.prepare("SELECT actor_receipt_key,message_id,send_rate_key,send_minute_bucket,send_slot FROM dzn_comms_send_receipts WHERE client_request_id = 'delete-request-0001'").get();
    assert.match(String(receiptAfter?.actor_receipt_key), /^[a-f0-9]{64}$/, "Erasure may retain only the per-request replay key.");
    assert.notEqual(receiptAfter?.actor_receipt_key, retainedReceipt?.actor_receipt_key, "An erased receipt must not join to the author's retained receipts.");
    assert.equal(receiptAfter?.message_id, null, "Erasure must unlink the retained receipt from the message.");
    assert.equal(receiptAfter?.send_rate_key, null, "Erasure must clear the receipt's pseudonymous rate key.");
    assert.equal(receiptAfter?.send_minute_bucket, null, "Erasure must clear the receipt's exact rate minute.");
    assert.equal(receiptAfter?.send_slot, null, "Erasure must clear the receipt's exact rate slot.");
    assert.equal(erased.count("dzn_comms_send_slots"), 2, "Erasure must retain every pseudonymous accepted-send slot until normal retention.");
    const postErasureSend = await handleDznCommsSend(request("/api/comms/messages", "other-token", {
      channelSlug: "global-chat", clientRequestId: "after-delete-0001", body: "Immediate follow-up",
    }), erased.env);
    assert.equal(postErasureSend.status, 429, "Moderation erasure must not refund the five-second or per-minute send quota.");
  } finally { erased.close(); }

  const erasedAfterSlotExpiry = await fixture();
  try {
    erasedAfterSlotExpiry.sqlite.prepare(`INSERT INTO dzn_comms_messages
      (id,channel_id,author_user_id,author_display_name,body,visibility_state)
      VALUES ('message-delete-late','dzn-global-chat','other','Other','Old sensitive text','visible')`).run();
    erasedAfterSlotExpiry.sqlite.prepare(`INSERT INTO dzn_comms_send_receipts
      (id,actor_receipt_key,channel_id,client_request_id,body_hash,decision,response_status,message_id,created_at,expires_at)
      VALUES ('receipt-delete-late','other','dzn-global-chat','delete-late-request','hash','allow',201,'message-delete-late',datetime('now','-3 days'),datetime('now','+4 days'))`).run();
    erasedAfterSlotExpiry.sqlite.prepare(`INSERT INTO dzn_comms_send_slots (actor_rate_key,minute_bucket,slot,accepted_at)
      VALUES ('unrelated-pseudonymous-rate-key',strftime('%Y-%m-%dT%H:%M','now'),1,CURRENT_TIMESTAMP)`).run();
    const response = await handleDznCommsModeration(request("/api/owner/comms/moderate", "owner-token", {
      messageId: "message-delete-late", action: "delete", reason: "personal information",
    }), erasedAfterSlotExpiry.env);
    assert.equal(response.status, 200);
    assert.equal(erasedAfterSlotExpiry.count("dzn_comms_send_slots"), 1, "Erasure must not search for or remove an unrelated pseudonymous rate slot.");
    assert.equal(erasedAfterSlotExpiry.sqlite.prepare("SELECT message_id FROM dzn_comms_send_receipts WHERE id = 'receipt-delete-late'").get()?.message_id, null, "Late erasure must still unlink the retained receipt.");
    assert.equal(erasedAfterSlotExpiry.sqlite.prepare("SELECT visibility_state FROM dzn_comms_messages WHERE id = 'message-delete-late'").get()?.visibility_state, "deleted");
  } finally { erasedAfterSlotExpiry.close(); }

  const unavailableReport = await fixture();
  try {
    unavailableReport.sqlite.prepare(`INSERT INTO dzn_comms_messages
      (id,channel_id,author_user_id,author_display_name,body,visibility_state)
      VALUES ('message-storage','dzn-global-chat','other','Other','Review this','visible')`).run();
    unavailableReport.failAt(1);
    const failed = await handleDznCommsReport(request("/api/comms/reports", "player-token", {
      messageId: "message-storage", reason: "other",
    }), unavailableReport.env);
    assert.equal(failed.status, 503);
    assert.equal((await payload(failed)).code, "REPORT_STORAGE_UNAVAILABLE");
    assert.equal(unavailableReport.count("dzn_comms_reports"), 0);
    assert.equal(unavailableReport.count("dzn_comms_report_slots"), 0);
  } finally { unavailableReport.close(); }
}

async function testRetentionRuntime() {
  const f = await fixture();
  try {
    f.sqlite.prepare(`INSERT INTO dzn_comms_messages
      (id,channel_id,author_user_id,author_display_name,body,visibility_state,expires_at)
      VALUES ('expired-message','dzn-global-chat','other','Other','Expired private text','visible','2026-01-01T00:00:00.000Z')`).run();
    f.sqlite.prepare(`INSERT INTO dzn_comms_send_receipts
      (id,actor_receipt_key,channel_id,client_request_id,body_hash,decision,response_status,expires_at)
      VALUES ('old-receipt','player','dzn-global-chat','old-request','hash','allow',201,'2026-01-01T00:00:00.000Z')`).run();
    f.sqlite.prepare(`INSERT INTO dzn_comms_reports (id,message_id,reporter_user_id,reason_code)
      VALUES ('expired-report','expired-message','player','other')`).run();
    const result = await runDznCommsRetention(f.env.DB, new Date("2026-09-24T12:00:00.000Z"));
    assert.equal(result.messagesErased, 1);
    assert.equal(result.reportsResolved, 1);
    assert.equal(result.receiptsDeleted, 1);
    const message = f.sqlite.prepare("SELECT body,author_user_id,author_display_name,visibility_state FROM dzn_comms_messages WHERE id = 'expired-message'").get();
    assert.equal(message?.body, "Message expired.");
    assert.equal(message?.author_user_id, null);
    assert.equal(message?.author_display_name, "DZN Safety");
    assert.equal(message?.visibility_state, "expired");
    assert.equal(f.sqlite.prepare("SELECT status FROM dzn_comms_reports WHERE id = 'expired-report'").get()?.status, "resolved");
  } finally { f.close(); }
}

function testPrivateLedgerMigrationRuntime() {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
      INSERT INTO users VALUES ('legacy-player','100','Legacy Player',NULL);`);
    sqlite.exec(readFileSync("migrations/0065_dzn_comms_read_history.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0071_dzn_comms_live_moderation.sql", "utf8"));
    sqlite.exec(`INSERT INTO dzn_comms_send_receipts
        (id,actor_user_id,channel_id,client_request_id,body_hash,decision,response_status,expires_at)
        VALUES ('legacy-receipt','legacy-player','dzn-global-chat','legacy-request','hash','block',422,datetime('now','-1 day'));
      INSERT INTO dzn_comms_send_slots (actor_user_id,minute_bucket,slot,accepted_at)
        VALUES ('legacy-player','2026-09-24T12:00',1,'2026-09-24T12:00:00.000Z');
      INSERT INTO dzn_comms_attempt_slots (actor_user_id,minute_bucket,slot)
        VALUES ('legacy-player','2026-09-24T12:00',1), ('legacy-player','2026-09-24T12:00',2);`);
    sqlite.exec(readFileSync("migrations/0072_dzn_comms_private_rate_ledgers.sql", "utf8"));
    const receiptColumns = new Set(sqlite.prepare("PRAGMA table_info(dzn_comms_send_receipts)").all().map((row) => String(row.name)));
    const slotColumns = new Set(sqlite.prepare("PRAGMA table_info(dzn_comms_send_slots)").all().map((row) => String(row.name)));
    const attemptColumns = new Set(sqlite.prepare("PRAGMA table_info(dzn_comms_attempt_slots)").all().map((row) => String(row.name)));
    assert.equal(receiptColumns.has("actor_user_id"), false, "The upgraded receipt ledger must drop the raw account ID column.");
    assert.equal(slotColumns.has("actor_user_id"), false, "The upgraded accepted-send ledger must drop the raw account ID column.");
    assert.equal(attemptColumns.has("actor_user_id"), false, "The upgraded attempt ledger must drop the raw account ID column.");
    const receipt = sqlite.prepare("SELECT actor_receipt_key FROM dzn_comms_send_receipts WHERE id = 'legacy-receipt'").get();
    const slot = sqlite.prepare("SELECT actor_rate_key FROM dzn_comms_send_slots").get();
    const attempts = sqlite.prepare("SELECT actor_attempt_key FROM dzn_comms_attempt_slots ORDER BY slot").all();
    assert.match(String(receipt?.actor_receipt_key), /^[a-f0-9]{64}$/);
    assert.match(String(slot?.actor_rate_key), /^[a-f0-9]{64}$/);
    assert.equal(attempts.length, 2);
    assert.match(String(attempts[0]?.actor_attempt_key), /^[a-f0-9]{64}$/);
    assert.equal(attempts[0]?.actor_attempt_key, attempts[1]?.actor_attempt_key, "Migration must preserve one actor's existing attempt quota grouping.");
    assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { sqlite.close(); }
}

function testPrivateLedgerMigrationRejectsUnexpiredReceipts() {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
      INSERT INTO users VALUES ('replay-player','100','Replay Player',NULL);`);
    sqlite.exec(readFileSync("migrations/0065_dzn_comms_read_history.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0071_dzn_comms_live_moderation.sql", "utf8"));
    sqlite.exec(`INSERT INTO dzn_comms_send_receipts
        (id,actor_user_id,channel_id,client_request_id,body_hash,decision,response_status,expires_at)
        VALUES ('active-receipt','replay-player','dzn-global-chat','replay-request','hash','allow',201,datetime('now','+1 day'));`);
    assert.throws(
      () => sqlite.exec(readFileSync("migrations/0072_dzn_comms_private_rate_ledgers.sql", "utf8")),
      /constraint failed/i,
      "The privacy migration must fail closed while a legacy replay or conflict decision is still valid.",
    );
    const receiptColumns = new Set(sqlite.prepare("PRAGMA table_info(dzn_comms_send_receipts)").all().map((row) => String(row.name)));
    assert.equal(receiptColumns.has("actor_user_id"), true, "The receipt guard must fail before rebuilding the legacy ledger.");
    assert.equal(receiptColumns.has("actor_receipt_key"), false);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM dzn_comms_send_receipts WHERE id = 'active-receipt'").get()?.total, 1, "A guarded cutover must preserve the reachable legacy receipt.");
  } finally {
    sqlite.close();
  }
}

function testPrivateLedgerMigrationRejectsActiveQuotas() {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT, avatar TEXT);
      INSERT INTO users VALUES ('active-player','100','Active Player',NULL);`);
    sqlite.exec(readFileSync("migrations/0065_dzn_comms_read_history.sql", "utf8"));
    sqlite.exec(readFileSync("migrations/0071_dzn_comms_live_moderation.sql", "utf8"));
    sqlite.exec(`INSERT INTO dzn_comms_attempt_slots (actor_user_id,minute_bucket,slot)
        VALUES ('active-player',strftime('%Y-%m-%dT%H:%M','now'),1);
      INSERT INTO dzn_comms_send_slots (actor_user_id,minute_bucket,slot,accepted_at)
        VALUES ('active-player',strftime('%Y-%m-%dT%H:%M','now'),1,CURRENT_TIMESTAMP);`);
    assert.throws(
      () => sqlite.exec(readFileSync("migrations/0072_dzn_comms_private_rate_ledgers.sql", "utf8")),
      /constraint failed/i,
      "The privacy migration must fail closed while legacy quotas are still enforceable.",
    );
    const attemptColumns = new Set(sqlite.prepare("PRAGMA table_info(dzn_comms_attempt_slots)").all().map((row) => String(row.name)));
    assert.equal(attemptColumns.has("actor_user_id"), true, "A guarded failure must happen before rebuilding the legacy ledger.");
    assert.equal(attemptColumns.has("actor_attempt_key"), false);
  } finally {
    sqlite.close();
  }
}

async function main() {
  testPrivateLedgerMigrationRejectsUnexpiredReceipts();
  testPrivateLedgerMigrationRejectsActiveQuotas();
  testPrivateLedgerMigrationRuntime();
  await testSendRuntime();
  await testReportAndModerationRuntime();
  await testRetentionRuntime();
  console.log("Live Comms handlers: auth, origin, idempotency, conflict, quota, rollback, report and moderation behavior passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
