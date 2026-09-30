import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createPlayerGameIdentityClaim, reviewPlayerGameIdentityClaim } from "../functions/_lib/player-game-identities";
import { dispatchQueuedOwnerRequestNotifications } from "../functions/_lib/player-game-identity-owner-notifications";
import { revokePlayerGameIdentityLink } from "../functions/_lib/player-game-identity-revocation";
import type { Env, SessionUser } from "../functions/_lib/types";

type Row = Record<string, unknown>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): {
  all(...values: unknown[]): Row[]; get(...values: unknown[]): Row | undefined;
  run(...values: unknown[]): { changes: number | bigint };
} };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
export const identityTestUser = (id: string, discordId = id): SessionUser => ({ id, discord_id: discordId, username: id, avatar: null });

export function identityTransactionFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, discord_id TEXT, username TEXT, avatar TEXT);
    CREATE TABLE linked_servers (id TEXT PRIMARY KEY, user_id TEXT, guild_id TEXT, status TEXT,
      listing_visibility TEXT, merged_into_server_id TEXT, display_name TEXT, hostname TEXT,
      server_name TEXT, nitrado_service_name TEXT, public_slug TEXT);
    CREATE TABLE player_profiles (id TEXT PRIMARY KEY, linked_server_id TEXT, player_id TEXT,
      player_name TEXT, discord_id TEXT, last_seen_at TEXT, updated_at TEXT, created_at TEXT);
    INSERT INTO users VALUES ('owner-a','owner-discord','Owner A',NULL), ('owner-b','other-owner','Owner B',NULL),
      ('player-a','discord-a','Player A',NULL), ('player-b','discord-b','Player B',NULL), ('admin','admin-discord','Admin',NULL);
    INSERT INTO linked_servers (id,user_id,guild_id,status,listing_visibility,server_name,public_slug)
      VALUES ('server-a','owner-a','guild-a','active','public','Server A','server-a');
    INSERT INTO player_profiles (id,linked_server_id,player_id,player_name) VALUES ('profile-a','server-a','game-a','Survivor');
  `);
  sqlite.exec(readFileSync("migrations/0064_player_game_identity_links.sql", "utf8"));
  sqlite.exec("CREATE TABLE competitive_events (id TEXT PRIMARY KEY)");
  sqlite.exec(readFileSync("migrations/0052_dzn_pulse.sql", "utf8"));
  sqlite.exec(`INSERT INTO player_game_identity_claims
    (id,user_id,discord_id,linked_server_id,player_profile_id,player_id,player_name)
    VALUES ('claim-a','player-a','discord-a','server-a','profile-a','game-a','Survivor')`);
  let beforeBatch: (() => void) | undefined;
  let failAt = -1;
  let writes = 0;
  const prepare = (sql: string, bindings: unknown[] = []) => {
    const execute = () => {
      if (/^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...bindings), success: true, meta: { changes: 0 } };
      writes++;
      const result = sqlite.prepare(sql).run(...bindings);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    };
    return { bind: (...values: unknown[]) => prepare(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
      all: async () => execute(), run: async () => execute(), execute };
  };
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      const hook = beforeBatch; beforeBatch = undefined; hook?.();
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement, index) => {
          if (index === failAt) throw new Error("Injected interruption");
          return statement.execute();
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, env: { DB: db, DZN_ADMIN_DISCORD_IDS: "admin-discord", DZN_PLATFORM_OWNER_DISCORD_IDS: "platform-discord" } as unknown as Env,
    setBeforeBatch: (hook: () => void) => { beforeBatch = hook; }, failAt: (index: number) => { failAt = index; },
    writes: () => writes, close: () => sqlite.close(),
    state: () => ({ claim: sqlite.prepare("SELECT * FROM player_game_identity_claims").all(),
      links: sqlite.prepare("SELECT * FROM player_game_identity_links").all(),
      profiles: sqlite.prepare("SELECT * FROM player_profiles").all(),
      audit: sqlite.prepare("SELECT * FROM player_game_identity_audit_log").all(),
      notifications: sqlite.prepare("SELECT * FROM user_notifications").all() }),
  };
}

export async function testPlayerGameIdentityTransactions() {
  const owner = identityTestUser("owner-a");
  for (const action of ["approve", "reject"] as const) {
    const f = identityTransactionFixture();
    try {
      const result = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action, note: "Owner evidence checked" });
      assert.equal(result.ok, true);
      const state = f.state();
      assert.equal(state.claim[0].status, action === "approve" ? "approved" : "rejected");
      assert.equal(state.audit.length, action === "approve" ? 2 : 1);
      assert.equal(state.links.length, action === "approve" ? 1 : 0);
      assert.equal(state.notifications.length, 1, "Each committed owner decision must create one player account notification.");
      assert.equal(state.notifications[0].type, action === "approve" ? "player_link_approved" : "player_link_rejected");
      assert.equal(state.notifications[0].user_id, "player-a");
      assert.equal(state.profiles[0].discord_id, null, "New links must not overwrite legacy attribution");
      if (result.ok && action === "approve") assert.equal(result.link_id, state.links[0].id);
      const before = f.state();
      const repeat = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action });
      assert.equal(repeat.status, 409);
      assert.deepEqual(f.state(), before);
    } finally { f.close(); }
  }
  const restoredLink = identityTransactionFixture();
  try {
    restoredLink.sqlite.exec(readFileSync("migrations/0073_player_link_notification_delivery.sql", "utf8"));
    restoredLink.sqlite.exec("INSERT INTO notification_preferences (user_id,discord_enabled) VALUES ('player-a',1)");
    restoredLink.env.DZN_DISCORD_NOTIFICATIONS_ENABLED = "true";
    const firstApproval = await reviewPlayerGameIdentityClaim(restoredLink.env, owner, "claim-a", {
      action: "approve",
      note: "Initial verified link.",
    });
    assert.ok(firstApproval.ok && firstApproval.link_id);
    const revoked = await revokePlayerGameIdentityLink(restoredLink.env, owner, firstApproval.link_id, {
      confirm: true,
      reason: "Controlled account-link delivery test.",
    });
    assert.equal(revoked.status, 200);
    const replacement = await createPlayerGameIdentityClaim(restoredLink.env, identityTestUser("player-a", "discord-a"), {
      server_slug: "server-a",
      player_id: "game-a",
    });
    assert.equal(replacement.status, 201);
    assert.ok(replacement.ok && replacement.claim.id !== "claim-a");
    const restored = await reviewPlayerGameIdentityClaim(restoredLink.env, owner, replacement.ok ? replacement.claim.id : "", {
      action: "approve",
      note: "Restore the same verified account after notification proof.",
    });
    assert.equal(restored.status, 200, "A revoked player must be able to restore the same verified game account.");
    assert.equal(restored.ok && restored.link_id, firstApproval.link_id, "Restoration must reactivate the exact audited link instead of creating a duplicate history row.");
    assert.equal(restoredLink.sqlite.prepare("SELECT COUNT(*) AS count FROM player_game_identity_links WHERE status='active'").get()?.count, 1);
    assert.equal(restoredLink.sqlite.prepare("SELECT COUNT(*) AS count FROM player_game_identity_links").get()?.count, 1);
    const revokedAgain = await revokePlayerGameIdentityLink(restoredLink.env, owner, firstApproval.link_id, {
      confirm: true,
      reason: "Second verified revocation after restoration.",
    });
    assert.equal(revokedAgain.status, 200, "A restored link must remain revocable without reusing its first notification key.");
    assert.equal(restoredLink.sqlite.prepare("SELECT COUNT(*) AS count FROM user_notifications WHERE type='player_link_revoked'").get()?.count, 2);
    assert.equal(restoredLink.sqlite.prepare("SELECT COUNT(DISTINCT dedupe_key) AS count FROM user_notifications WHERE type='player_link_revoked'").get()?.count, 2);
    assert.equal(restoredLink.sqlite.prepare("SELECT COUNT(*) AS count FROM player_game_identity_notification_deliveries WHERE event_type='revoked'").get()?.count, 2);
    assert.equal(restoredLink.sqlite.prepare("SELECT status FROM player_game_identity_links WHERE id = ?").get(firstApproval.link_id)?.status, "revoked");
    assert.deepEqual(restoredLink.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { restoredLink.close(); }
  for (const action of ["approve", "reject"] as const) {
    for (let failure = 0; failure < (action === "approve" ? 6 : 3); failure++) {
      const f = identityTransactionFixture();
      try {
        const before = f.state(); f.failAt(failure);
        assert.equal((await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action })).status, 503);
        assert.deepEqual(f.state(), before, `${action} interruption at ${failure} must roll back every write`);
      } finally { f.close(); }
    }
  }
  for (const concurrentChange of [
    "UPDATE player_game_identity_claims SET status = 'rejected' WHERE id = 'claim-a'",
    "UPDATE linked_servers SET user_id = 'owner-b' WHERE id = 'server-a'",
    "UPDATE linked_servers SET status = 'deleted' WHERE id = 'server-a'",
    "UPDATE player_profiles SET discord_id = 'discord-b' WHERE id = 'profile-a'",
    "UPDATE player_profiles SET player_id = 'changed-game' WHERE id = 'profile-a'",
  ]) {
    const f = identityTransactionFixture();
    try {
      f.setBeforeBatch(() => f.sqlite.exec(concurrentChange));
      assert.equal((await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action: "approve" })).status, 409);
      assert.equal(f.state().links.length, 0); assert.equal(f.state().audit.length, 0);
    } finally { f.close(); }
  }
  for (const actions of [["approve", "reject"], ["reject", "approve"], ["approve", "approve"]]) {
    const f = identityTransactionFixture();
    try {
      const results = await Promise.all(actions.map(action => reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action })));
      assert.equal(results.filter(r => r.ok).length, 1, "Only one concurrent decision may commit");
      assert.equal(results.filter(r => r.status === 409).length, 1);
      const state = f.state();
      assert.equal(state.links.length, state.claim[0].status === "approved" ? 1 : 0);
      assert.equal(state.audit.filter(row => row.action === "claim_approved" || row.action === "claim_rejected").length, 1);
    } finally { f.close(); }
  }
  const denied = identityTransactionFixture();
  try {
    assert.equal((await reviewPlayerGameIdentityClaim(denied.env, identityTestUser("owner-b"), "claim-a", { action: "approve" })).status, 403);
    assert.equal(denied.writes(), 0);
  } finally { denied.close(); }
  for (const mockAuth of [undefined, "false", "true", "1"]) {
    for (const action of ["approve", "reject"]) {
      const f = identityTransactionFixture();
      try {
        f.env.MOCK_AUTH = mockAuth;
        const before = f.state();
        const result = await reviewPlayerGameIdentityClaim(f.env, identityTestUser("owner-b"), "claim-a", { action });
        assert.equal(result.status, mockAuth === "true" || mockAuth === "1" ? 200 : 403);
        if (!result.ok) assert.deepEqual(f.state(), before, "Disabled mock access must preserve real tenant isolation");
      } finally { f.close(); }
    }
  }
  const conflict = identityTransactionFixture();
  try {
    conflict.sqlite.exec("UPDATE player_profiles SET discord_id='discord-b'");
    assert.equal((await reviewPlayerGameIdentityClaim(conflict.env, owner, "claim-a", { action: "approve" })).status, 409);
    assert.equal(conflict.state().links.length, 0);
    assert.equal(conflict.state().profiles[0].discord_id, "discord-b");
  } finally { conflict.close(); }
  for (const existingOwner of ["player-a", "player-b"]) {
    const f = identityTransactionFixture();
    try {
      f.setBeforeBatch(() => f.sqlite.prepare(`INSERT INTO player_game_identity_links
        (id,user_id,discord_id,linked_server_id,player_profile_id,player_id,status,verified_source,verified_by_user_id)
        VALUES ('existing-link', ?, ?, 'server-a','profile-a','game-a','active','owner_approved','owner-a')`)
        .run(existingOwner, existingOwner === "player-a" ? "discord-a" : "discord-b"));
      const result = await reviewPlayerGameIdentityClaim(f.env, owner, "claim-a", { action: "approve" });
      assert.equal(result.status, existingOwner === "player-a" ? 200 : 409);
      assert.equal(f.state().links.length, 1);
      if (result.ok) {
        assert.equal(result.link_id, "existing-link");
        assert.equal(f.state().audit.find(row => row.action === "link_created")?.result, "already_linked");
      } else assert.equal(f.state().audit.length, 0);
    } finally { f.close(); }
  }
  const rejectAccessChanged = identityTransactionFixture();
  try {
    rejectAccessChanged.setBeforeBatch(() => rejectAccessChanged.sqlite.exec("UPDATE linked_servers SET user_id='owner-b'"));
    assert.equal((await reviewPlayerGameIdentityClaim(rejectAccessChanged.env, owner, "claim-a", { action: "reject" })).status, 409);
    assert.equal(rejectAccessChanged.state().claim[0].status, "pending");
    assert.equal(rejectAccessChanged.state().audit.length, 0);
  } finally { rejectAccessChanged.close(); }
  for (const shouldFail of [false, true]) {
    const f = identityTransactionFixture();
    try {
      f.sqlite.exec("DELETE FROM player_game_identity_claims");
      const before = f.state(); if (shouldFail) f.failAt(1);
      const result = await createPlayerGameIdentityClaim(f.env, identityTestUser("player-a", "discord-a"), { server_slug: "server-a", player_id: "game-a" });
      assert.equal(result.status, shouldFail ? 503 : 201);
      if (shouldFail) assert.deepEqual(f.state(), before);
      else { assert.equal(f.state().claim.length, 1); assert.equal(f.state().audit.length, 1); }
    } finally { f.close(); }
  }
  const ownerNotifications = identityTransactionFixture();
  const originalFetch = globalThis.fetch;
  try {
    ownerNotifications.sqlite.exec(`DELETE FROM player_game_identity_claims;
      UPDATE users SET discord_id='888888888888888888' WHERE id='owner-a';
      UPDATE users SET discord_id='666666666666666666' WHERE id='owner-b';
      INSERT INTO users VALUES ('platform-owner','999999999999999999','Platform Owner',NULL);
      INSERT INTO users VALUES ('platform-observer','777777777777777777','Platform Observer',NULL);`);
    ownerNotifications.sqlite.exec(readFileSync("migrations/0075_player_link_owner_request_notifications.sql", "utf8"));
    ownerNotifications.sqlite.exec(`INSERT OR REPLACE INTO notification_preferences (user_id,discord_enabled)
      VALUES ('owner-a',1),('owner-b',1),('platform-owner',1);`);
    Object.assign(ownerNotifications.env, {
      DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
      DZN_PLATFORM_OWNER_DISCORD_IDS: "999999999999999999,777777777777777777",
      DZN_ADMIN_DISCORD_IDS: "999999999999999999",
      DISCORD_BOT_TOKEN: "test-token-with-enough-length",
    });
    const discordBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/users/@me/channels")) return Response.json({ id: "998877665544332211" });
      discordBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return Response.json({ id: "message-a" });
    }) as typeof fetch;
    const result = await createPlayerGameIdentityClaim(
      ownerNotifications.env,
      identityTestUser("player-a", "discord-a"),
      { server_slug: "server-a", player_id: "game-a" },
    );
    assert.equal(result.status, 201);
    const notices = ownerNotifications.sqlite.prepare("SELECT user_id,server_id,type,dedupe_key,metadata FROM user_notifications ORDER BY user_id").all();
    assert.deepEqual(notices.map((row) => row.user_id), ["owner-a", "platform-owner"], "Only the server owner and an authorized platform admin receive website review alerts.");
    assert.ok(notices.every((row) => row.type === "player_link_review_requested"));
    assert.ok(notices.every((row) => row.server_id === null), "Review alerts must not prevent the referenced server from being deleted.");
    assert.equal(JSON.stringify(notices).includes("game-a"), false, "Owner alerts must not expose the hidden exact game ID.");
    const deliveries = ownerNotifications.sqlite.prepare("SELECT recipient_user_id,status FROM player_game_identity_owner_notification_deliveries ORDER BY recipient_user_id").all();
    assert.deepEqual(deliveries.map((row) => row.recipient_user_id), ["owner-a", "platform-owner"]);
    const deliveryResult = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, {
      deliveryIds: result.ok ? result.owner_delivery_ids : [],
      maxJobs: 2,
    });
    assert.equal(deliveryResult.delivered, 2);
    assert.equal(discordBodies.length, 2);
    assert.ok(discordBodies.every((body) => String(body.content).includes("not proof they played or own the profile")));
    assert.ok(discordBodies.every((body) => !String(body.content).includes("game-a")));
    ownerNotifications.env.DZN_ADMIN_DISCORD_IDS = "removed-admin";
    const removedPlatformAdmin = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(removedPlatformAdmin.processed, 0, "Removing platform review access must not send another notification.");
    const removedPlatformAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='platform-owner'").get();
    assert.ok(removedPlatformAlert?.read_at && removedPlatformAlert.expires_at, "A removed platform admin must lose the actionable website alert.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT result_code FROM player_game_identity_owner_notification_deliveries WHERE recipient_user_id='platform-owner'").get()?.result_code, "recipient_no_longer_authorized");
    ownerNotifications.env.DZN_ADMIN_DISCORD_IDS = "999999999999999999";
    const restoredPlatformAdmin = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(restoredPlatformAdmin.delivered, 1, "A newly restored platform admin must receive the pending review request.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT read_at FROM user_notifications WHERE user_id='platform-owner'").get()?.read_at, null);
    ownerNotifications.sqlite.exec("UPDATE linked_servers SET user_id='owner-b' WHERE id='server-a'");
    const deliveredOwnershipChanged = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(deliveredOwnershipChanged.delivered, 1, "A delivered pending claim must be reconciled and sent to a new current owner.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT status FROM player_game_identity_owner_notification_deliveries WHERE recipient_user_id='owner-b'").get()?.status, "delivered");
    const deliveredFormerAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='owner-a' AND type='player_link_review_requested'").get();
    assert.ok(deliveredFormerAlert?.read_at && deliveredFormerAlert.expires_at, "Ownership reconciliation must expire the former owner's website alert even after delivery completed.");
    ownerNotifications.sqlite.exec("UPDATE linked_servers SET user_id='owner-a' WHERE id='server-a'");
    const deliveredOwnershipReturned = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(deliveredOwnershipReturned.delivered, 1, "A returning current owner must be reactivated after a delivered A-to-B-to-A transfer.");
    const deliveredRestoredAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='owner-a' AND type='player_link_review_requested'").get();
    assert.equal(deliveredRestoredAlert?.read_at, null, "A returning current owner's website alert must become actionable again.");
    ownerNotifications.sqlite.exec(`UPDATE notification_preferences SET discord_enabled=0 WHERE user_id='owner-a';
      UPDATE player_game_identity_owner_notification_deliveries
      SET status='queued', attempt_count=0, next_attempt_at=CURRENT_TIMESTAMP, delivered_at=NULL, result_code=NULL
      WHERE recipient_user_id='owner-a';`);
    const fetchesBeforeOptOut = discordBodies.length;
    const optedOut = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(optedOut.skipped, 1, "Owner Discord delivery must respect the recipient's saved opt-out.");
    assert.equal(discordBodies.length, fetchesBeforeOptOut, "An opted-out owner must not trigger a Discord request.");
    ownerNotifications.sqlite.exec(`UPDATE notification_preferences SET discord_enabled=1 WHERE user_id='owner-a';
      UPDATE player_game_identity_owner_notification_deliveries
      SET status='queued', attempt_count=0, next_attempt_at=CURRENT_TIMESTAMP, delivered_at=NULL, result_code=NULL
      WHERE recipient_user_id='owner-a';
      UPDATE player_game_identity_claims SET status='approved' WHERE id='${result.ok ? result.claim.id : "missing"}';`);
    const fetchesBeforeResolved = discordBodies.length;
    const resolved = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(resolved.skipped, 1, "A resolved claim must terminalize its outstanding owner delivery.");
    assert.equal(discordBodies.length, fetchesBeforeResolved, "A resolved claim must not trigger a stale owner DM.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT result_code FROM player_game_identity_owner_notification_deliveries WHERE recipient_user_id='owner-a'").get()?.result_code, "claim_not_pending");
    ownerNotifications.sqlite.exec(`UPDATE player_game_identity_claims SET status='pending' WHERE id='${result.ok ? result.claim.id : "missing"}';`);
    ownerNotifications.sqlite.exec(`UPDATE linked_servers SET user_id='owner-b' WHERE id='server-a';
      UPDATE player_game_identity_owner_notification_deliveries
      SET status='queued', attempt_count=0, next_attempt_at=CURRENT_TIMESTAMP, delivered_at=NULL, result_code=NULL
      WHERE recipient_user_id='owner-a';`);
    const fetchesBeforeOwnershipChange = discordBodies.length;
    const ownershipChanged = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(ownershipChanged.delivered, 1, "A pending review must be delivered to the replacement owner in the same bounded run.");
    assert.equal(discordBodies.length, fetchesBeforeOwnershipChange + 1, "Only the newly authorized owner may receive the replacement Discord request.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT result_code FROM player_game_identity_owner_notification_deliveries WHERE recipient_user_id='owner-a'").get()?.result_code, "recipient_no_longer_authorized");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT status FROM player_game_identity_owner_notification_deliveries WHERE recipient_user_id='owner-b'").get()?.status, "delivered", "The current server owner must receive the replacement delivery.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT COUNT(*) AS count FROM user_notifications WHERE user_id='owner-b'").get()?.count, 1, "The current server owner must receive a replacement website alert.");
    const staleOwnerAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='owner-a' AND type='player_link_review_requested'").get();
    assert.ok(staleOwnerAlert?.read_at && staleOwnerAlert.expires_at, "The former owner's website alert must be expired when review access is revoked.");
    const repeated = await createPlayerGameIdentityClaim(
      ownerNotifications.env,
      identityTestUser("player-a", "discord-a"),
      { server_slug: "server-a", player_id: "game-a" },
    );
    assert.equal(repeated.status, 200);
    assert.equal(ownerNotifications.sqlite.prepare("SELECT COUNT(*) AS count FROM user_notifications").get()?.count, 3, "A repeated pending request must not duplicate the reconciled owner alerts.");
    ownerNotifications.sqlite.exec("UPDATE linked_servers SET user_id='owner-a' WHERE id='server-a'");
    const ownershipReturned = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(ownershipReturned.delivered, 1, "The replacement owner delivery must reroute again when ownership returns.");
    assert.equal(ownerNotifications.sqlite.prepare("SELECT status FROM player_game_identity_owner_notification_deliveries WHERE recipient_user_id='owner-a'").get()?.status, "delivered", "A returning current owner must receive a new delivery after a prior authorization skip.");
    const restoredOwnerAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='owner-a' AND type='player_link_review_requested'").get();
    assert.equal(restoredOwnerAlert?.read_at, null, "A returning owner's website alert must become actionable again.");
    assert.ok(new Date(String(restoredOwnerAlert?.expires_at)).getTime() > Date.now(), "A returning owner's website alert must receive a fresh expiry.");
    const supersededOwnerAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='owner-b' AND type='player_link_review_requested'").get();
    assert.ok(supersededOwnerAlert?.read_at && supersededOwnerAlert.expires_at, "The superseded owner's website alert must be expired.");
    ownerNotifications.sqlite.exec("UPDATE user_notifications SET read_at=CURRENT_TIMESTAMP, expires_at=CURRENT_TIMESTAMP WHERE user_id='owner-a' AND type='player_link_review_requested'");
    ownerNotifications.setBeforeBatch(() => ownerNotifications.sqlite.exec(`UPDATE player_game_identity_claims SET status='rejected' WHERE id='${result.ok ? result.claim.id : "missing"}'`));
    const resolvedDuringReconciliation = await dispatchQueuedOwnerRequestNotifications(ownerNotifications.env, { maxJobs: 1 });
    assert.equal(resolvedDuringReconciliation.processed, 0, "A claim resolved between reconciliation selection and writes must not reopen delivery.");
    const guardedAlert = ownerNotifications.sqlite.prepare("SELECT read_at,expires_at FROM user_notifications WHERE user_id='owner-a' AND type='player_link_review_requested'").get();
    assert.ok(guardedAlert?.read_at && new Date(String(guardedAlert.expires_at)).getTime() <= Date.now(), "Reconciliation must not reopen a resolved claim alert.");
    ownerNotifications.sqlite.exec(`UPDATE player_game_identity_claims SET status='pending' WHERE id='${result.ok ? result.claim.id : "missing"}'`);
    const rejected = await reviewPlayerGameIdentityClaim(ownerNotifications.env, owner, result.ok ? result.claim.id : "missing", { action: "reject" });
    assert.equal(rejected.status, 200);
    const resolvedNotices = ownerNotifications.sqlite.prepare(
      "SELECT read_at, expires_at, json_extract(metadata, '$.review_status') AS review_status FROM user_notifications WHERE type='player_link_review_requested'",
    ).all();
    assert.ok(resolvedNotices.every((row) => row.read_at && row.expires_at), "Deciding a claim must terminalize every matching website review alert.");
    assert.ok(resolvedNotices.every((row) => row.review_status === "rejected"), "Resolved owner alerts must record the final review status.");
  } finally {
    globalThis.fetch = originalFetch;
    ownerNotifications.close();
  }
  const channelRetry = identityTransactionFixture();
  const retryFetch = globalThis.fetch;
  try {
    channelRetry.sqlite.exec(`DELETE FROM player_game_identity_claims;
      UPDATE users SET discord_id='888888888888888888' WHERE id='owner-a';`);
    channelRetry.sqlite.exec(readFileSync("migrations/0075_player_link_owner_request_notifications.sql", "utf8"));
    channelRetry.sqlite.exec(`CREATE TABLE server_discord_channel_settings (
      id TEXT PRIMARY KEY, linked_server_id TEXT NOT NULL, guild_id TEXT NOT NULL,
      channel_type TEXT NOT NULL, channel_id TEXT NOT NULL,
      bot_can_view INTEGER, bot_can_send INTEGER, bot_can_embed INTEGER, bot_can_read_history INTEGER
    );
    INSERT INTO server_discord_channel_settings VALUES (
      'review-channel-setting','server-a','guild-a','player_link_approvals','123456789012345678',1,1,1,1
    );
    INSERT OR REPLACE INTO notification_preferences (user_id,discord_enabled) VALUES ('owner-a',1);`);
    Object.assign(channelRetry.env, {
      DZN_DISCORD_NOTIFICATIONS_ENABLED: "true",
      DZN_PLATFORM_OWNER_DISCORD_IDS: "",
      DZN_ADMIN_DISCORD_IDS: "",
      DISCORD_BOT_TOKEN: "test-token-with-enough-length",
    });
    const requiredBits = ((BigInt(1) << BigInt(10)) | (BigInt(1) << BigInt(11)) | (BigInt(1) << BigInt(14)) | (BigInt(1) << BigInt(16))).toString();
    let verificationUnavailable = true;
    let contextUnavailable = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/channels/123456789012345678")) {
        if (verificationUnavailable) return new Response("", { status: 503 });
        return Response.json({
          id: "123456789012345678",
          guild_id: "guild-a",
          type: 0,
          name: "private-reviews",
          permission_overwrites: [
            { id: "guild-a", type: 0, allow: "0", deny: (BigInt(1) << BigInt(10)).toString() },
            { id: "bot-role", type: 0, allow: (BigInt(1) << BigInt(10)).toString(), deny: "0" },
          ],
        });
      }
      if (url.endsWith("/users/@me")) return Response.json({ id: "bot-user" });
      if (url.endsWith("/guilds/guild-a/members/bot-user")) return Response.json({ roles: ["bot-role"] });
      if (url.endsWith("/guilds/guild-a/roles")) {
        if (contextUnavailable) return new Response("", { status: 503 });
        return Response.json([
          { id: "guild-a", name: "@everyone", permissions: requiredBits },
          { id: "bot-role", name: "DZN Bot", permissions: requiredBits, tags: { bot_id: "bot-user" } },
        ]);
      }
      if (url.endsWith("/channels/123456789012345678/messages")) return new Response("", { status: 429 });
      if (url.endsWith("/users/@me/channels")) return new Response("", { status: 403 });
      throw new Error(`Unexpected Discord request: ${url}`);
    }) as typeof fetch;
    const claim = await createPlayerGameIdentityClaim(
      channelRetry.env,
      identityTestUser("player-a", "discord-a"),
      { server_slug: "server-a", player_id: "game-a" },
    );
    assert.equal(claim.status, 201);
    channelRetry.sqlite.exec("ALTER TABLE server_discord_channel_settings RENAME TO unavailable_server_discord_channel_settings");
    const lookupRetry = await dispatchQueuedOwnerRequestNotifications(channelRetry.env, {
      deliveryIds: claim.ok ? claim.owner_delivery_ids : [],
      maxJobs: 1,
    });
    assert.equal(lookupRetry.retried, 1, "A temporary review-channel lookup failure must remain retryable when the owner DM fallback is closed.");
    let retryRow = channelRetry.sqlite.prepare("SELECT status,result_code FROM player_game_identity_owner_notification_deliveries").get();
    assert.equal(retryRow?.status, "retry");
    assert.equal(retryRow?.result_code, "discord_restricted_channel_lookup_failed");
    channelRetry.sqlite.exec("ALTER TABLE unavailable_server_discord_channel_settings RENAME TO server_discord_channel_settings");
    channelRetry.sqlite.exec("UPDATE player_game_identity_owner_notification_deliveries SET next_attempt_at=CURRENT_TIMESTAMP");
    const retryResult = await dispatchQueuedOwnerRequestNotifications(channelRetry.env, {
      deliveryIds: claim.ok ? claim.owner_delivery_ids : [],
      maxJobs: 1,
    });
    assert.equal(retryResult.retried, 1, "A temporary private-channel verification failure must remain retryable when the owner DM fallback is closed.");
    retryRow = channelRetry.sqlite.prepare("SELECT status,result_code FROM player_game_identity_owner_notification_deliveries").get();
    assert.equal(retryRow?.status, "retry");
    assert.equal(retryRow?.result_code, "discord_restricted_channel_verify_503");
    verificationUnavailable = false;
    contextUnavailable = true;
    channelRetry.sqlite.exec("UPDATE player_game_identity_owner_notification_deliveries SET next_attempt_at=CURRENT_TIMESTAMP");
    const contextRetry = await dispatchQueuedOwnerRequestNotifications(channelRetry.env, {
      deliveryIds: claim.ok ? claim.owner_delivery_ids : [],
      maxJobs: 1,
    });
    assert.equal(contextRetry.retried, 1, "A temporary Discord roles lookup failure must remain retryable when the owner DM fallback is closed.");
    retryRow = channelRetry.sqlite.prepare("SELECT status,result_code FROM player_game_identity_owner_notification_deliveries").get();
    assert.equal(retryRow?.status, "retry");
    assert.equal(retryRow?.result_code, "discord_restricted_channel_verify_503");
    contextUnavailable = false;
    channelRetry.sqlite.exec("UPDATE player_game_identity_owner_notification_deliveries SET next_attempt_at=CURRENT_TIMESTAMP");
    const channelPostRetry = await dispatchQueuedOwnerRequestNotifications(channelRetry.env, {
      deliveryIds: claim.ok ? claim.owner_delivery_ids : [],
      maxJobs: 1,
    });
    assert.equal(channelPostRetry.retried, 1, "A rate-limited private channel must remain retryable when the owner DM fallback is closed.");
    retryRow = channelRetry.sqlite.prepare("SELECT status,result_code FROM player_game_identity_owner_notification_deliveries").get();
    assert.equal(retryRow?.status, "retry");
    assert.equal(retryRow?.result_code, "discord_restricted_channel_message_429");
  } finally {
    globalThis.fetch = retryFetch;
    channelRetry.close();
  }
  const gamertag = identityTransactionFixture();
  try {
    gamertag.sqlite.exec("DELETE FROM player_game_identity_claims; UPDATE player_profiles SET player_id='game-id-secret-123456' WHERE id='profile-a'");
    const result = await createPlayerGameIdentityClaim(
      gamertag.env,
      identityTestUser("player-a", "discord-a"),
      { server_slug: "server-a", player_reference: "survivor" },
    );
    assert.equal(result.status, 201, "A unique server-scoped visible gamertag should create a review request.");
    assert.equal(gamertag.state().claim[0].player_profile_id, "profile-a");
    assert.equal(gamertag.state().claim[0].player_id, "game-id-secret-123456", "The pending claim must store the hidden exact ID resolved server-side.");
    assert.equal(result.ok && result.claim.player_id, "game...3456", "The player-facing response must mask the hidden exact ID.");
    assert.match(String(gamertag.state().audit[0].note), /^request_source=gamertag_lookup;/, "The audit record must preserve gamertag provenance for owner review.");
  } finally { gamertag.close(); }
  const ambiguousGamertag = identityTransactionFixture();
  try {
    ambiguousGamertag.sqlite.exec(`DELETE FROM player_game_identity_claims;
      INSERT INTO player_profiles (id,linked_server_id,player_id,player_name)
      VALUES ('profile-b','server-a','game-b','SURVIVOR')`);
    const before = ambiguousGamertag.state();
    const result = await createPlayerGameIdentityClaim(
      ambiguousGamertag.env,
      identityTestUser("player-a", "discord-a"),
      { server_slug: "server-a", player_reference: "Survivor" },
    );
    assert.equal(result.status, 409, "Duplicate gamertags inside one server must fail closed.");
    assert.equal(ambiguousGamertag.state().claim.length, before.claim.length, "Ambiguous names must not create a claim.");
    assert.equal(ambiguousGamertag.state().links.length, 0, "Ambiguous names must never create a verified link.");
  } finally { ambiguousGamertag.close(); }
  console.log("Identity claim transactions: rollback, conflicts, fresh ownership and concurrent decisions passed.");
}
