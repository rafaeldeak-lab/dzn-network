import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  dispatchQueuedPlayerGameIdentityNotifications,
  hasPlayerGameIdentityDeliveryLedger,
} from "../functions/_lib/player-game-identity-notifications";
import { reviewPlayerGameIdentityClaim } from "../functions/_lib/player-game-identities";
import { onRequest as runDeliveryQueue } from "../functions/api/sync/player-link-notifications/run";
import type { Env } from "../functions/_lib/types";
import { identityTestUser, identityTransactionFixture } from "./test-player-game-identity-transactions";

type Row = Record<string, unknown>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): {
  all(...values: unknown[]): Row[]; get(...values: unknown[]): Row | undefined;
  run(...values: unknown[]): { changes: number | bigint };
} };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

function d1(sqlite: Sqlite) {
  const prepare = (sql: string, bindings: unknown[] = []) => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings), success: true, meta: { changes: 0 } }),
    run: async () => {
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    },
  });
  return { prepare } as unknown as D1Database;
}

export async function testPlayerGameIdentityDeliveryLedger() {
  const decisionRunnerSource = readFileSync("functions/api/sync/player-link-notifications/run.ts", "utf8");
  const ownerRunnerSource = readFileSync("functions/api/sync/player-link-owner-notifications/run.ts", "utf8");
  assert.doesNotMatch(decisionRunnerSource, /dispatchQueuedOwnerRequestNotifications/, "The guarded one-decision runner must never drain owner-request deliveries.");
  assert.match(ownerRunnerSource, /requireCronSecret[\s\S]*dispatchQueuedOwnerRequestNotifications/, "Owner-request retries must use a separate protected runner and delivery budget.");
  const unavailableEnv = {
    DB: { prepare: () => ({ first: async () => null }) },
    DZN_CRON_SECRET: "unit-test-secret",
  } as unknown as Env;
  const unauthorized = await runDeliveryQueue({
    request: new Request("https://dzn.test/api/sync/player-link-notifications/run", { method: "POST" }),
    env: unavailableEnv, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null),
  });
  assert.equal(unauthorized.status, 401, "The delivery runner must require the existing cron secret.");
  const unavailable = await runDeliveryQueue({
    request: new Request("https://dzn.test/api/sync/player-link-notifications/run", {
      method: "POST", headers: { "x-dzn-cron-secret": "unit-test-secret" },
    }),
    env: unavailableEnv, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null),
  });
  assert.equal(unavailable.status, 200, "The protected runner must stay safe before migration activation.");
  assert.equal((await unavailable.json() as { unavailable?: boolean }).unavailable, true);

  const transaction = identityTransactionFixture();
  try {
    transaction.sqlite.exec(readFileSync("migrations/0073_player_link_notification_delivery.sql", "utf8"));
    Object.assign(transaction.env, {
      DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
      DISCORD_BOT_TOKEN: "test-token-with-enough-length",
    });
    const decision = await reviewPlayerGameIdentityClaim(
      transaction.env,
      identityTestUser("owner-a", "owner-discord"),
      "claim-a",
      { action: "approve", note: "Independent owner proof checked." },
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.ok && typeof decision.delivery.deliveryId, "string");
    const rows = transaction.sqlite.prepare("SELECT * FROM player_game_identity_notification_deliveries").all();
    assert.equal(rows.length, 1, "A decision must atomically queue one Discord delivery when the ledger and feature flag are ready.");
    assert.equal(rows[0].status, "queued");
    assert.equal(rows[0].event_type, "approved");
    assert.deepEqual(transaction.sqlite.prepare("PRAGMA foreign_key_check").all(), [], "The delivery ledger must preserve every foreign key.");
  } finally {
    transaction.close();
  }

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT);
    CREATE TABLE linked_servers (id TEXT PRIMARY KEY, display_name TEXT, hostname TEXT, server_name TEXT, nitrado_service_name TEXT);
    CREATE TABLE player_profiles (id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('player-a','831243159785701398','Player A',NULL);
    INSERT INTO linked_servers VALUES ('server-a','NukeTown',NULL,NULL,NULL);
    INSERT INTO player_profiles VALUES ('profile-a');
  `);
  sqlite.exec(readFileSync("migrations/0064_player_game_identity_links.sql", "utf8"));
  sqlite.exec("CREATE TABLE competitive_events (id TEXT PRIMARY KEY)");
  sqlite.exec(readFileSync("migrations/0052_dzn_pulse.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0073_player_link_notification_delivery.sql", "utf8"));
  sqlite.exec(`INSERT INTO player_game_identity_claims
      (id,user_id,discord_id,linked_server_id,player_profile_id,player_id,player_name,status)
    VALUES ('claim-a','player-a','831243159785701398','server-a','profile-a','game-a','Survivor','approved');
    INSERT INTO player_game_identity_audit_log
      (id,claim_id,user_id,linked_server_id,player_profile_id,player_id,action,result)
    VALUES ('audit-a','claim-a','player-a','server-a','profile-a','game-a','claim_approved','accepted');
    INSERT INTO player_game_identity_notification_deliveries
      (id,audit_id,claim_id,user_id,discord_id,linked_server_id,event_type)
    VALUES ('delivery-a','audit-a','claim-a','player-a','831243159785701398','server-a','approved');
    INSERT INTO notification_preferences (user_id,discord_enabled) VALUES ('player-a',1);
  `);
  const env = {
    DB: d1(sqlite),
    DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
    DISCORD_BOT_TOKEN: "test-token-with-enough-length",
  } as unknown as Env;
  const originalFetch = globalThis.fetch;
  let attempt = 0;
  let messagePosts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/users/@me/channels")) {
      attempt++;
      if (attempt === 1) return new Response("temporary", { status: 503 });
      return Response.json({ id: "998877665544332211" });
    }
    messagePosts++;
    return Response.json({ id: "message-a" });
  }) as typeof fetch;
  try {
    assert.equal(await hasPlayerGameIdentityDeliveryLedger(env), true);
    const first = await dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId: "delivery-a" });
    assert.equal(first.retried, 1, "A temporary Discord failure must schedule a retry.");
    let row = sqlite.prepare("SELECT status,attempt_count,result_code FROM player_game_identity_notification_deliveries WHERE id='delivery-a'").get();
    assert.equal(row?.status, "retry");
    assert.equal(row?.attempt_count, 1);
    sqlite.exec("UPDATE player_game_identity_notification_deliveries SET next_attempt_at=CURRENT_TIMESTAMP WHERE id='delivery-a'");
    const second = await dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId: "delivery-a" });
    assert.equal(second.delivered, 1, "A later successful attempt must finish the same durable delivery.");
    row = sqlite.prepare("SELECT status,attempt_count,result_code FROM player_game_identity_notification_deliveries WHERE id='delivery-a'").get();
    assert.equal(row?.status, "delivered");
    assert.equal(row?.attempt_count, 2);
    assert.equal(row?.result_code, "discord_dm_delivered");

    sqlite.exec(`INSERT INTO player_game_identity_audit_log
        (id,claim_id,user_id,linked_server_id,player_profile_id,player_id,action,result)
      VALUES ('audit-b','claim-a','player-a','server-a','profile-a','game-a','claim_approved','accepted');
      INSERT INTO player_game_identity_notification_deliveries
        (id,audit_id,claim_id,user_id,discord_id,linked_server_id,event_type,status,attempt_count,lease_id,lease_expires_at)
      VALUES ('delivery-b','audit-b','claim-a','player-a','831243159785701398','server-a','approved','processing',5,'unrelated-expired-lease',datetime('now', '-1 minute'));`);

    sqlite.exec(`UPDATE player_game_identity_notification_deliveries
      SET status='processing', attempt_count=5, lease_id='expired-lease',
          lease_expires_at=datetime('now', '-1 minute'), next_attempt_at=CURRENT_TIMESTAMP,
          delivered_at=NULL, result_code=NULL
      WHERE id='delivery-a'`);
    const exhaustedLease = await dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId: "delivery-a" });
    assert.equal(exhaustedLease.processed, 1, "An expired fifth attempt must be counted as a terminal failure, not claimed a sixth time.");
    assert.equal(exhaustedLease.failed, 1);
    assert.equal(exhaustedLease.ok, false);
    row = sqlite.prepare("SELECT status,attempt_count,result_code FROM player_game_identity_notification_deliveries WHERE id='delivery-a'").get();
    assert.equal(row?.status, "failed");
    assert.equal(row?.result_code, "delivery_attempts_exhausted");
    assert.equal(sqlite.prepare("SELECT status FROM player_game_identity_notification_deliveries WHERE id='delivery-b'").get()?.status, "processing", "A targeted dispatch must not consume unrelated exhausted leases before monitoring sees them.");

    const failedRun = await runDeliveryQueue({
      request: new Request("https://dzn.test/api/sync/player-link-notifications/run", {
        method: "POST", headers: { "x-dzn-cron-secret": "unit-test-secret" },
      }),
      env: { ...env, DZN_CRON_SECRET: "unit-test-secret" }, params: {}, data: {}, waitUntil() {}, next: async () => new Response(null),
    });
    assert.equal(failedRun.status, 503, "The guarded runner must surface an exhausted lease as a failed task.");
    const failedRunBody = await failedRun.json() as { task_status?: string; processed?: number; failed?: number };
    assert.equal(failedRunBody.task_status, "failed");
    assert.equal(failedRunBody.processed, 1);
    assert.equal(failedRunBody.failed, 1);
    assert.equal(sqlite.prepare("SELECT status FROM player_game_identity_notification_deliveries WHERE id='delivery-b'").get()?.status, "failed");

    sqlite.exec(`UPDATE player_game_identity_notification_deliveries
      SET status='queued', attempt_count=0, next_attempt_at=CURRENT_TIMESTAMP, delivered_at=NULL, result_code=NULL
      WHERE id='delivery-a'`);
    const messagesBeforeRace = messagePosts;
    const raced = await Promise.all([
      dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId: "delivery-a" }),
      dispatchQueuedPlayerGameIdentityNotifications(env, { deliveryId: "delivery-a" }),
    ]);
    assert.equal(raced.reduce((sum, result) => sum + result.delivered, 0), 1, "Only one dispatcher may claim a delivery.");
    assert.equal(messagePosts - messagesBeforeRace, 1, "A delivery lease must prevent duplicate Discord messages.");
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }

  console.log("Player link delivery ledger: atomic queue, leased retry and delivery receipt passed.");
}

void testPlayerGameIdentityDeliveryLedger().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
