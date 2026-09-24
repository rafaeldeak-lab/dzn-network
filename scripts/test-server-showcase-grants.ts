import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Miniflare } from "miniflare";
import { createSession, ensureLinkedServerMetadataColumns } from "../functions/_lib/db";
import { getOwnerEntitlements, upsertBillingAccount } from "../functions/_lib/plans";
import { canUseShowcaseFeature, NUKETOWN_SHOWCASE_SCOPE as scope, readServerShowcaseAccess, showcaseWriteGuard } from "../functions/_lib/server-showcase-access";
import { changeShowcaseGrant, readShowcaseGrantSupport } from "../functions/_lib/server-showcase-grants";
import { categoryPolicyForPlan, readOwnerServerSettings, updateServerListing } from "../functions/_lib/server-settings";
import { onRequest as gallery } from "../functions/api/servers/[serverId]/gallery";
import { onRequest as ownerApi } from "../functions/api/owner/server-showcase-access";
import type { Env, PagesFunction, SessionUser } from "../functions/_lib/types";
import { onRequestGet as visualGet, onRequestPut as visualPut } from "../functions/api/servers/[serverId]/visual-loadout";
import { getAvailableShowcaseBadgesForServer, resolvePublicServerVisualLoadout, resolveServerVisualLoadout, saveServerVisualLoadout, validateServerVisualLoadout } from "../functions/_lib/server-visual-loadouts";
import { getAvailableFrameVisuals, getAvailableThemeBannerVisuals } from "../lib/badges/visuals";
import { getPublicServersPayload, onRequest as publicServers, refreshPublicShowcaseSnapshot } from "../functions/api/public/servers";
import { formatPublicVisibilitySummary, publicListingPlanLabel, publicVisibilityTierLabel } from "../lib/showcase-labels";
import { getPublicAdvancedLeaderboardsPayload, getServerAdvancedShowcasePayload, queryPositionSamples } from "../functions/_lib/advanced-leaderboards";
import { onRequestGet as dashboardAdvancedStats } from "../functions/api/servers/[serverId]/dashboard/advanced-stats";
import { onRequestGet as dashboardHealth } from "../functions/api/servers/[serverId]/dashboard/health";
import { onRequest as advertisingBump } from "../functions/api/servers/[serverId]/advertising/bump";
import { dashboardSelectedServerAccess } from "../components/onboarding/dashboard-detail-display";
import { createServerWarChallenge, getOwnerServerWarsPayload, getServerWarOpponentOptions } from "../functions/_lib/server-wars";
import { processServerMatchmakingOptIn } from "../functions/_lib/ctf-tournaments";
import { getAutomationContextForLinkedServer, queueDiscordPostUpdatesForGuild } from "../functions/_lib/automation";
import { dispatchQueuedDiscordPostUpdates } from "../functions/_lib/discord-posting";
import { onRequest as postingDestinations } from "../functions/api/servers/[serverId]/posting-destinations";

type Row = Record<string, unknown>;
type Sqlite = { exec(sql: string): void; close(): void; prepare(sql: string): {
  run(...args: unknown[]): { changes: number }; get(...args: unknown[]): Row | undefined; all(...args: unknown[]): Row[];
} };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
const migrationFiles = readdirSync("migrations").filter(name => name.endsWith(".sql")).sort();

class LocalD1 {
  sqlite = new DatabaseSync(":memory:");
  beforeWrite: ((sql: string) => void) | null = null;
  beforeBatch: (() => void) | null = null;
  beforeFirst: ((sql: string) => void | Promise<void>) | null = null;
  afterFirst: ((sql: string, value: Row | null) => void | Promise<void>) | null = null;
  prepare(sql: string) {
    const statement = (values: unknown[] = []) => ({
      bind: (...args: unknown[]) => statement(args),
      run: async () => {
        this.beforeWrite?.(sql);
        if (/^\s*SELECT\b/i.test(sql)) return { success: true, results: this.sqlite.prepare(sql).all(...values), meta: { changes: 0 } };
        return { success: true, results: [], meta: this.sqlite.prepare(sql).run(...values) };
      },
      first: async () => {
        await this.beforeFirst?.(sql);
        const value = this.sqlite.prepare(sql).get(...values) ?? null;
        await this.afterFirst?.(sql, value);
        return value;
      },
      all: async () => ({ success: true, results: this.sqlite.prepare(sql).all(...values) }),
    });
    return statement();
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.beforeBatch?.();
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const actor: SessionUser = { id: scope.ownerUserId, discord_id: scope.ownerDiscordId, username: "Synthetic owner", avatar: null };
const other: SessionUser = { id: "other-owner", discord_id: "99990000", username: "Synthetic other", avatar: null };
const inactive = { plan_key: "pro", subscription_status: "canceled" };
const image = { url: "https://local.test/synthetic.jpg", width: 1600, height: 900, sizeBytes: 1000, mimeType: "image/jpeg" };
const proVisual = { showcaseBadges: [], profileFrameKey: "diamond", themeBannerKey: "space", animationEnabled: true };
const freeVisual = { showcaseBadges: [], profileFrameKey: "bronze", themeBannerKey: "apocalypse", animationEnabled: false };
const visualFallback = { showcaseBadges: [], profileFrame: getAvailableFrameVisuals().diamond,
  themeBanner: getAvailableThemeBannerVisuals().space, cardStyle: "premium" as const };
const originalFetch = globalThis.fetch;
let passed = 0;

async function fixture(migrate = true) {
  const db = new LocalD1();
  const env = { DB: db as unknown as D1Database, SESSION_SECRET: "local-test-only", DZN_PLATFORM_OWNER_DISCORD_IDS: scope.ownerDiscordId } as Env;
  for (const name of migrationFiles) {
    if (!migrate && name === "0069_server_showcase_grants.sql") continue;
    db.sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  await ensureLinkedServerMetadataColumns(env);
  for (const user of [actor, other]) db.sqlite.prepare("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run(user.id, user.discord_id, user.username);
  db.sqlite.prepare("INSERT INTO discord_guilds (id, guild_id, owner_user_id, name) VALUES ('synthetic-guild', ?, ?, 'Synthetic guild')").run(scope.guildId, scope.ownerUserId);
  for (const [id, owner, service, guild] of [
    [scope.linkedServerId, scope.ownerUserId, scope.nitradoServiceId, scope.guildId],
    ["same-guild-other-server", scope.ownerUserId, "10000001", scope.guildId],
    ["same-owner-other-guild", scope.ownerUserId, "10000002", "11110000"],
    ["foreign-owner-server", other.id, "10000003", "22220000"],
  ]) db.sqlite.prepare(`INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, nitrado_service_id, server_name,
      server_type, server_category, status, lifecycle_status, public_slug, public_description)
    VALUES (?, ?, ?, 'synthetic-guild', ?, 'NukeTown DEATHMATCH', 'deathmatch', 'deathmatch', 'live', 'active_live', ?, ?)`)
    .run(id, owner, guild, service, id, "A synthetic populated public listing for a local-only server test.");
  db.sqlite.prepare(`INSERT INTO server_subscriptions (id, guild_id, owner_discord_id, plan_key, status,
    stripe_customer_id, stripe_subscription_id, current_period_end, created_at, updated_at)
    VALUES ('synthetic-subscription', ?, ?, 'pro', 'canceled', 'cus_synthetic', 'sub_synthetic', '2026-07-18', '2026-01-01', '2026-01-01')`)
    .run(scope.guildId, scope.ownerDiscordId);
  return { db, env };
}

async function test(name: string, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, migrate = true) {
  const f = await fixture(migrate);
  try { await run(f); passed++; console.log(`PASS ${name}`); }
  finally { f.db.sqlite.close(); }
}
async function grant(env: Env) {
  const requestId = randomUUID();
  const result = await changeShowcaseGrant(env, actor, { action: "grant", requestId });
  assert.equal(result.status, 200);
  return requestId;
}
function grantExpiring(db: LocalD1, seconds = 1) {
  const id = randomUUID();
  db.sqlite.prepare(`INSERT INTO server_showcase_grants (
    id, linked_server_id, owner_user_id, owner_discord_id, guild_id, nitrado_service_id,
    created_by_user_id, created_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 second'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))`)
    .run(id, scope.linkedServerId, scope.ownerUserId, scope.ownerDiscordId, scope.guildId,
      scope.nitradoServiceId, actor.id, `+${seconds} seconds`);
  const expiresAt = String(db.sqlite.prepare("SELECT expires_at FROM server_showcase_grants WHERE id = ?").get(id)?.expires_at);
  return { id, expiresAt };
}
function waitUntilAfter(iso: string) {
  const waitMs = Math.max(0, Date.parse(iso) - Date.now() + 50);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
}
function revokeSql(db: LocalD1, id: string) {
  db.sqlite.prepare("UPDATE server_showcase_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revocation_reason = 'support_correction' WHERE id = ?").run(id);
}
async function invoke(handler: PagesFunction, env: Env, user: SessionUser | null, method: string, body?: unknown, serverId: string = scope.linkedServerId, origin = "https://local.test") {
  const session = user ? await createSession(env, user.id) : null;
  const headers: Record<string, string> = { origin, "content-type": "application/json" };
  if (session) headers.cookie = `dzn_session=${session.token}`;
  return handler({ env, request: new Request("https://local.test/api/synthetic", { method, headers,
    body: method === "GET" ? undefined : JSON.stringify(body) }), params: { serverId }, waitUntil: () => {},
    next: async () => new Response(), data: {} } as Parameters<PagesFunction>[0]);
}

function seedPublicMedia(db: LocalD1) {
  db.sqlite.exec(`UPDATE linked_servers SET advert_banner_url = 'https://local.test/synthetic.jpg',
    owner_announcement = 'Synthetic owner announcement', fresh_wipe_promo = 'Synthetic wipe notice',
    listing_visibility = 'public', is_online = 1, server_status = 'started', map_name = 'chernarusplus'`);
  for (const server of db.sqlite.prepare("SELECT id FROM linked_servers").all()) {
    db.sqlite.prepare(`INSERT INTO server_gallery_images (id, server_id, url, width, height, size_bytes, mime_type, sort_order, created_at, updated_at)
      VALUES (?, ?, 'https://local.test/synthetic.jpg', 1600, 900, 1000, 'image/jpeg', 0, '2026-09-01', '2026-09-01')`).run(randomUUID(), server.id);
    db.sqlite.prepare(`INSERT INTO kill_events (id, linked_server_id, killer_name, victim_name, weapon, distance, occurred_at)
      VALUES (?, ?, 'Synthetic player', 'Synthetic opponent', 'Mosin9130', 150, '2026-09-01T12:00:00Z')`).run(randomUUID(), server.id);
  }
}

async function publicProfile(env: Env, id: string = scope.linkedServerId, loggedIn = true) {
  const payload = await getPublicServersPayload(env, id, loggedIn);
  assert.ok("server" in payload && payload.server, `Populated public profile required for ${id}`);
  return payload.server;
}

async function run() {
  globalThis.fetch = async () => { throw new Error("Network is forbidden in showcase tests"); };
  await test("migration grants nobody and preserves billing", async ({ db, env }) => {
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grants").get()?.n, 0);
    assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
    assert.equal(db.sqlite.prepare("SELECT status FROM server_subscriptions").get()?.status, "canceled");
  });
  await test("unapplied migration fails closed without changing billing", async ({ env }) => {
    assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
    assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, { plan_key: "premium", subscription_status: "active" })).listing.listingPlanKey, "pro");
  }, false);
  await test("advertising GET stays read-only when owner billing schema is unavailable", async ({ db, env }) => {
    db.sqlite.exec("DROP TABLE owner_billing_accounts");
    const response = await invoke(advertisingBump, env, actor, "GET", undefined, "same-guild-other-server");
    assert.equal(response.status, 200);
    const body = await response.json() as { advertising: { effective_listing_plan: string; access_source: string } };
    assert.equal(body.advertising.effective_listing_plan, "free");
    assert.equal(body.advertising.access_source, "billing");
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'owner_billing_accounts'").get()?.count, 0);
  });
  await test("exact grant enables Pro listing without a paid subscription or account slots", async ({ db, env }) => {
    await upsertBillingAccount(env, { discordUserId: actor.discord_id, planKey: "free", planStatus: "free" });
    const entitlements = await getOwnerEntitlements(env, actor.discord_id);
    const subscription = db.sqlite.prepare("SELECT * FROM server_subscriptions").get();
    await grant(env);
    const access = await readServerShowcaseAccess(env, scope.linkedServerId, inactive);
    assert.equal(access.source, "complimentary_showcase"); assert.equal(access.billingStatus, "canceled");
    assert.equal(access.listing.listingPlanKey, "pro"); assert.equal(canUseShowcaseFeature(access, "gallery_images"), true);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").get(), subscription);
    assert.deepEqual(await getOwnerEntitlements(env, actor.discord_id), entitlements);
    for (const id of ["same-guild-other-server", "same-owner-other-guild", "foreign-owner-server", "NukeTown DEATHMATCH", scope.nitradoServiceId]) {
      const isolated = await readServerShowcaseAccess(env, id, inactive);
      assert.equal(isolated.source, "billing", id); assert.equal(canUseShowcaseFeature(isolated, "gallery_images"), false, id);
    }
  });
  await test("exact grant enables NukeTown Server Wars hosting without fabricating billing", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const locked = await getOwnerServerWarsPayload(env, actor, scope.linkedServerId);
    assert.equal(locked.ok, true);
    if (!locked.ok) throw new Error("Expected owner Server Wars payload");
    assert.equal(locked.access.canCreateChallenge, false);
    assert.equal(locked.access.accessSource, "billing");

    await grant(env);
    const unlocked = await getOwnerServerWarsPayload(env, actor, scope.linkedServerId);
    assert.equal(unlocked.ok, true);
    if (!unlocked.ok) throw new Error("Expected owner Server Wars payload");
    assert.equal(unlocked.access.configuredPlan, "pro");
    assert.equal(unlocked.access.effectivePlan, "pro");
    assert.equal(unlocked.access.subscriptionStatus, "canceled");
    assert.equal(unlocked.access.accessSource, "complimentary_showcase");
    assert.equal(unlocked.access.canCreateChallenge, true);

    const opponents = await getServerWarOpponentOptions(env, actor, scope.linkedServerId, "NukeTown", "deathmatch_war");
    assert.equal(opponents.ok, true);
    if (!opponents.ok) throw new Error("Expected Server Wars opponents");
    assert.ok(opponents.servers.some(server => server.id === "foreign-owner-server"));

    const created = await createServerWarChallenge(env, actor, scope.linkedServerId, {
      opponentServerId: "foreign-owner-server",
      rulesetKey: "deathmatch_war",
      title: "NukeTown exact grant challenge",
    });
    assert.equal(created.ok, true);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_war_events").get()?.n, 1);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_war_participants").get()?.n, 2);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_war_challenges").get()?.n, 1);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);

    const unrelated = await getOwnerServerWarsPayload(env, actor, "same-guild-other-server");
    assert.equal(unrelated.ok, true);
    if (!unrelated.ok) throw new Error("Expected unrelated owner Server Wars payload");
    assert.equal(unrelated.access.accessSource, "billing");
    assert.equal(unrelated.access.canCreateChallenge, false);
  });
  await test("exact grant enables only NukeTown CTF matchmaking without fabricating billing", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const locked = await processServerMatchmakingOptIn(env, scope.linkedServerId);
    assert.equal(locked.ok, false);
    assert.equal(locked.status, "plan_locked");

    await grant(env);
    const queued = await processServerMatchmakingOptIn(env, scope.linkedServerId);
    assert.equal(queued.ok, true);
    if (!queued.ok) throw new Error("Expected exact grant CTF matchmaking access");
    assert.equal(queued.plan_key, "pro");
    assert.equal(queued.access_source, "complimentary_showcase");
    assert.equal(db.sqlite.prepare("SELECT is_searching_for_match FROM linked_servers WHERE id = ?").get(scope.linkedServerId)?.is_searching_for_match, 1);

    const unrelated = await processServerMatchmakingOptIn(env, "same-guild-other-server");
    assert.equal(unrelated.ok, false);
    assert.equal(unrelated.status, "plan_locked");
    assert.equal(db.sqlite.prepare("SELECT is_searching_for_match FROM linked_servers WHERE id = ?").get("same-guild-other-server")?.is_searching_for_match, 0);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("inactive paid labels preserve Free Discord posts without unlocking Pro posts", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "pro", ["basic_status_embed"], "ambiguous-free-test", {
      linkedServerId: scope.linkedServerId,
    }), 0);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "pro", ["basic_status_embed"], "free-baseline-test", {
      linkedServerId: scope.linkedServerId,
    }), 1);
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "pro", ["priority_status_embed"], "inactive-pro-test", {
      linkedServerId: scope.linkedServerId,
    }), 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM automation_jobs WHERE job_type = 'discord-post-update'").get()?.n, 1);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("exact grant enables only NukeTown Discord queue access without fabricating billing", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const locked = await getAutomationContextForLinkedServer(env, scope.linkedServerId);
    assert.equal(locked?.planKey, "pro");
    assert.equal(locked?.subscriptionStatus, "canceled");
    assert.equal(locked?.accessSource, "billing");
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "pro", ["priority_status_embed"], "canceled-pro-test", {
      linkedServerId: scope.linkedServerId,
    }), 0);

    await grant(env);
    const unlocked = await getAutomationContextForLinkedServer(env, scope.linkedServerId);
    assert.equal(unlocked?.planKey, "pro");
    assert.equal(unlocked?.subscriptionStatus, "active");
    assert.equal(unlocked?.accessSource, "complimentary_showcase");
    const ambiguousResponse = await invoke(postingDestinations, env, actor, "GET");
    assert.equal(ambiguousResponse.status, 200);
    const ambiguousPayload = await ambiguousResponse.json() as { post_type_options: Array<{ key: string; allowed_by_plan: boolean }> };
    assert.equal(ambiguousPayload.post_type_options.find((option) => option.key === "priority_status_embed")?.allowed_by_plan, false);
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "free", ["priority_status_embed"], "ambiguous-grant-test", {
      linkedServerId: scope.linkedServerId,
    }), 0);

    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    const queued = await queueDiscordPostUpdatesForGuild(env, scope.guildId, "free", ["priority_status_embed"], "exact-grant-test", {
      linkedServerId: scope.linkedServerId,
    });
    assert.equal(queued, 1);

    const dispatched = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 1 });
    assert.equal(dispatched.ok, true);
    assert.equal(dispatched.results[0]?.status, "skipped_disabled");
    assert.equal(dispatched.results[0]?.reason, "No saved posting destination exists.");

    const unrelated = await getAutomationContextForLinkedServer(env, "same-guild-other-server");
    assert.equal(unrelated?.accessSource, "billing");
    assert.equal(unrelated?.subscriptionStatus, "canceled");
    const unrelatedQueued = await queueDiscordPostUpdatesForGuild(env, scope.guildId, "free", ["priority_status_embed"], "unrelated-test", {
      linkedServerId: "same-guild-other-server",
    });
    assert.equal(unrelatedQueued, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM automation_jobs WHERE job_type = 'discord-post-update'").get()?.n, 1);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("exact grant unlocks destination controls and eligible due posts cannot be starved", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();

    const response = await invoke(postingDestinations, env, actor, "GET");
    assert.equal(response.status, 200);
    const payload = await response.json() as { post_type_options: Array<{ key: string; allowed_by_plan: boolean; listing_plan_key: string }> };
    const priorityStatus = payload.post_type_options.find((option) => option.key === "priority_status_embed");
    assert.equal(priorityStatus?.allowed_by_plan, true);
    assert.equal(priorityStatus?.listing_plan_key, "pro");

    for (let index = 0; index < 9; index += 1) {
      db.sqlite.prepare(`INSERT INTO server_posting_destinations (
        id, guild_id, post_type, discord_channel_id, enabled, created_by_discord_id, created_at, updated_at
      ) VALUES (?, ?, 'priority_status_embed', ?, 1, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`)
        .run(`ineligible-${String(index).padStart(2, "0")}`, `ineligible-guild-${index}`, `9000000${index}`, actor.discord_id);
    }
    db.sqlite.prepare(`INSERT INTO server_posting_destinations (
      id, guild_id, post_type, discord_channel_id, enabled, created_by_discord_id, created_at, updated_at
    ) VALUES (?, ?, 'priority_status_embed', '99999999', 1, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`)
      .run("zz-eligible", scope.guildId, actor.discord_id);

    const firstTick = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 1 });
    assert.equal(firstTick.ok, true);
    assert.equal(firstTick.processed, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_posting_state WHERE guild_id = '__dzn_internal__'").get()?.n, 1);

    const resumedTick = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 1 });
    assert.equal(resumedTick.ok, true);
    assert.equal(resumedTick.processed, 1);
    assert.equal(resumedTick.results[0]?.guild_id, scope.guildId);
    assert.equal(resumedTick.results[0]?.status, "no_message_id");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("exact grant outranks active Starter only for NukeTown Discord dispatch", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET plan_key = 'starter', status = 'active'").run();
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    db.sqlite.prepare(`INSERT INTO server_posting_destinations (
      id, guild_id, post_type, discord_channel_id, enabled, created_by_discord_id, created_at, updated_at
    ) VALUES (?, ?, 'priority_status_embed', '99999999', 1, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`)
      .run(randomUUID(), scope.guildId, actor.discord_id);

    const dispatched = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 1 });
    assert.equal(dispatched.processed, 1);
    assert.equal(dispatched.results[0]?.guild_id, scope.guildId);
    assert.equal(dispatched.results[0]?.status, "no_message_id");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("revoked grant cannot commit a posting destination save", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const grantId = await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    await getAutomationContextForLinkedServer(env, scope.linkedServerId);
    db.beforeBatch = () => revokeSql(db, grantId);
    const response = await invoke(postingDestinations, env, actor, "POST", {
      post_type: "priority_status_embed",
      discord_channel_id: "99999999",
      enabled: true,
    });
    db.beforeBatch = null;
    assert.equal(response.status, 403);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_posting_destinations WHERE guild_id = ?").get(scope.guildId)?.n, 0);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("a newly eligible same-guild server blocks the atomic destination save", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    db.beforeBatch = () => db.sqlite.prepare("UPDATE linked_servers SET status = 'live', lifecycle_status = 'active_live' WHERE id = 'same-guild-other-server'").run();
    const response = await invoke(postingDestinations, env, actor, "POST", {
      post_type: "priority_status_embed",
      discord_channel_id: "99999999",
      enabled: true,
    });
    db.beforeBatch = null;
    assert.equal(response.status, 403);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_posting_destinations WHERE guild_id = ?").get(scope.guildId)?.n, 0);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("inactive billing cannot race an ambiguous Free destination save", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    db.beforeBatch = () => db.sqlite.prepare("UPDATE linked_servers SET status = 'live', lifecycle_status = 'active_live' WHERE id = 'same-guild-other-server'").run();
    const response = await invoke(postingDestinations, env, actor, "POST", {
      post_type: "basic_status_embed",
      discord_channel_id: "99999999",
      enabled: true,
    });
    db.beforeBatch = null;
    assert.equal(response.status, 403);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_posting_destinations WHERE guild_id = ?").get(scope.guildId)?.n, 0);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("revoked grant blocks a Discord test immediately before delivery", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const grantId = await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    await getAutomationContextForLinkedServer(env, scope.linkedServerId);
    let revoked = false;
    db.beforeFirst = (sql) => {
      if (revoked || !/SELECT discord_message_id FROM server_posting_state/.test(sql)) return;
      revoked = true;
      revokeSql(db, grantId);
    };
    const response = await invoke(postingDestinations, env, actor, "POST", {
      action: "test",
      channel_id: "99999999",
      test_post_type: "priority_status_embed",
      discord_webhook_url: "https://discord.com/api/webhooks/12345678/local-test-token",
    });
    db.beforeFirst = null;
    assert.equal(response.status, 200);
    const payload = await response.json() as { test_post: { ok: boolean; mode: string } };
    assert.equal(revoked, true);
    assert.equal(payload.test_post.ok, false);
    assert.equal(payload.test_post.mode, "access_revoked");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("revoked exact grant blocks a previously queued Discord publish", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const grantId = await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "free", ["priority_status_embed"], "revoke-test", {
      linkedServerId: scope.linkedServerId,
    }), 1);
    revokeSql(db, grantId);
    const dispatched = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 1 });
    assert.equal(dispatched.results[0]?.status, "skipped_plan_locked");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("queued grant delivery revalidates immediately before Discord send", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const grantId = await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    db.sqlite.prepare(`INSERT INTO server_posting_destinations (
      id, guild_id, post_type, discord_channel_id, enabled, created_by_discord_id, created_at, updated_at
    ) VALUES ('queued-delivery', ?, 'priority_status_embed', '99999999', 1, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`)
      .run(scope.guildId, actor.discord_id);
    assert.equal(await queueDiscordPostUpdatesForGuild(env, scope.guildId, "free", ["priority_status_embed"], "queued-race-test", {
      linkedServerId: scope.linkedServerId,
    }), 1);
    let revoked = false;
    db.beforeFirst = (sql) => {
      if (revoked || !/SELECT discord_message_id, last_payload_hash, last_edited_at FROM server_posting_state/.test(sql)) return;
      revoked = true;
      revokeSql(db, grantId);
    };
    const dispatched = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 1 });
    db.beforeFirst = null;
    assert.equal(revoked, true);
    assert.equal(dispatched.results[0]?.status, "skipped_plan_locked");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("scheduled delivery revalidates a cached grant before every Discord send", async ({ db, env }) => {
    const subscriptionBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const grantId = await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'archived', lifecycle_status = 'archived_hidden' WHERE id = 'same-guild-other-server'").run();
    for (const [id, postType, channelId] of [
      ["delivery-a", "priority_status_embed", "99999991"],
      ["delivery-b", "leaderboard_embed", "99999992"],
    ]) {
      db.sqlite.prepare(`INSERT INTO server_posting_destinations (
        id, guild_id, post_type, discord_channel_id, enabled, created_by_discord_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`)
        .run(id, scope.guildId, postType, channelId, actor.discord_id);
    }
    let stateReads = 0;
    db.beforeFirst = (sql) => {
      if (!/SELECT discord_message_id, last_payload_hash, last_edited_at FROM server_posting_state/.test(sql)) return;
      stateReads += 1;
      if (stateReads === 2) revokeSql(db, grantId);
    };
    const dispatched = await dispatchQueuedDiscordPostUpdates(env, { maxJobs: 2 });
    db.beforeFirst = null;
    assert.equal(stateReads, 2);
    assert.equal(dispatched.results[0]?.status, "no_message_id");
    assert.equal(dispatched.results[1]?.status, "skipped_plan_locked");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), subscriptionBefore);
  });
  await test("revoked exact grant rolls back the CTF matchmaking opt-in", async ({ db, env }) => {
    const grantId = await grant(env);
    db.beforeBatch = () => revokeSql(db, grantId);
    const result = await processServerMatchmakingOptIn(env, scope.linkedServerId);
    db.beforeBatch = null;
    assert.equal(result.ok, false);
    assert.equal(result.status, "plan_locked");
    assert.equal(db.sqlite.prepare("SELECT is_searching_for_match FROM linked_servers WHERE id = ?").get(scope.linkedServerId)?.is_searching_for_match, 0);
    assert.equal(db.sqlite.prepare("SELECT status FROM server_subscriptions").get()?.status, "canceled");
  });
  await test("mid-batch exact grant expiry rolls back the CTF matchmaking opt-in", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db, 1);
    let waited = false;
    db.beforeWrite = (sql) => {
      if (waited || !/UPDATE linked_servers SET is_searching_for_match/.test(sql)) return;
      waited = true;
      waitUntilAfter(expiresAt);
    };
    const result = await processServerMatchmakingOptIn(env, scope.linkedServerId);
    db.beforeWrite = null;
    assert.equal(waited, true);
    assert.equal(result.ok, false);
    assert.equal(result.status, "plan_locked");
    assert.equal(db.sqlite.prepare("SELECT is_searching_for_match FROM linked_servers WHERE id = ?").get(scope.linkedServerId)?.is_searching_for_match, 0);
    assert.equal(db.sqlite.prepare("SELECT status FROM server_subscriptions").get()?.status, "canceled");
  });
  await test("revoked exact grant rolls back the complete Server Wars challenge write", async ({ db, env }) => {
    const grantId = await grant(env);
    db.beforeBatch = () => revokeSql(db, grantId);
    const result = await createServerWarChallenge(env, actor, scope.linkedServerId, {
      opponentServerId: "foreign-owner-server",
      rulesetKey: "deathmatch_war",
      title: "Revoked grant challenge",
    });
    db.beforeBatch = null;
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.error, "plan_locked");
    for (const table of ["server_war_events", "server_war_participants", "server_war_challenges"]) {
      assert.equal(db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    }
    assert.equal(db.sqlite.prepare("SELECT status FROM server_subscriptions").get()?.status, "canceled");
  });
  await test("mid-batch exact grant expiry rolls back every Server Wars write", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db, 1);
    let waited = false;
    db.beforeWrite = (sql) => {
      if (waited || !/INSERT INTO server_war_events/.test(sql)) return;
      waited = true;
      waitUntilAfter(expiresAt);
    };
    const result = await createServerWarChallenge(env, actor, scope.linkedServerId, {
      opponentServerId: "foreign-owner-server",
      rulesetKey: "deathmatch_war",
      title: "Expiring grant challenge",
    });
    db.beforeWrite = null;
    assert.equal(waited, true);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.error, "plan_locked");
    for (const table of ["server_war_events", "server_war_participants", "server_war_challenges"]) {
      assert.equal(db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    }
    assert.equal(db.sqlite.prepare("SELECT status FROM server_subscriptions").get()?.status, "canceled");
  });
  await test("Server Wars dashboard labels complimentary access truthfully", async ({ env }) => {
    await grant(env);
    const payload = await getOwnerServerWarsPayload(env, actor, scope.linkedServerId);
    assert.equal(payload.ok, true);
    if (!payload.ok) throw new Error("Expected owner Server Wars payload");
    assert.equal(payload.access.accessSource, "complimentary_showcase");
    const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
    assert.match(dashboardSource, /accessSource === "complimentary_showcase"[\s\S]*Pro \(complimentary\)/);
  });
  await test("active paid Pro takes precedence over a matching complimentary grant", async ({ db, env }) => {
    const grantId = await grant(env);
    db.sqlite.prepare("UPDATE server_subscriptions SET status = 'active'").run();

    for (const planKey of ["pro", "premium", "network", "partner"]) {
      const access = await readServerShowcaseAccess(env, scope.linkedServerId, {
        plan_key: planKey,
        subscription_status: "active",
      });
      assert.equal(access.source, "billing", planKey);
      assert.equal(access.grantId, null, planKey);
      assert.equal(access.listing.listingPlanKey, "pro", planKey);
    }

    const advanced = await (await invoke(dashboardAdvancedStats, env, actor, "GET")).json() as {
      access: { source: string; subscriptionActive: boolean };
    };
    assert.equal(advanced.access.source, "billing");
    assert.equal(advanced.access.subscriptionActive, true);

    const health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as {
      server_access: { source: string };
    };
    assert.equal(health.server_access.source, "billing");

    const advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as {
      advertising: { access_source: string };
    };
    assert.equal(advertising.advertising.access_source, "billing");

    let revoked = false;
    db.beforeWrite = (sql) => {
      if (revoked || !/INSERT INTO server_listing_events/.test(sql)) return;
      revoked = true;
      revokeSql(db, grantId);
    };
    const bumpResponse = await invoke(advertisingBump, env, actor, "POST", {});
    db.beforeWrite = null;
    assert.equal(revoked, true);
    assert.equal(bumpResponse.status, 200);
    assert.equal((await bumpResponse.json() as { server_access: { source: string } }).server_access.source, "billing");
  });
  await test("exact grant unlocks bounded owner analytics and weekly bumps without changing billing", async ({ db, env }) => {
    seedPublicMedia(db);
    const billingBefore = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    await grant(env);

    const advanced = await getServerAdvancedShowcasePayload(env, scope.linkedServerId, { ownerScoped: true, overlayLimit: 220 });
    assert.ok(advanced);
    assert.equal(advanced.access.source, "complimentary_showcase");
    assert.equal(advanced.access.effectivePlan, "pro");
    assert.equal(advanced.access.subscriptionActive, false);
    assert.equal(advanced.access.dashboardAnalytics, true);
    assert.ok(advanced.boards.every(board => !board.locked));

    const advancedResponse = await invoke(dashboardAdvancedStats, env, actor, "GET");
    assert.equal(advancedResponse.status, 200);
    assert.match(advancedResponse.headers.get("cache-control") ?? "", /no-store/);
    assert.doesNotMatch(advancedResponse.headers.get("cache-control") ?? "", /max-age/);
    assert.equal(advancedResponse.headers.get("pragma"), "no-cache");
    const advancedBody = await advancedResponse.json() as { available: boolean; access: { source: string; subscriptionActive: boolean } };
    assert.equal(advancedBody.available, true);
    assert.equal(advancedBody.access.source, "complimentary_showcase");
    assert.equal(advancedBody.access.subscriptionActive, false);

    const healthResponse = await invoke(dashboardHealth, env, actor, "GET");
    assert.equal(healthResponse.status, 200);
    const healthBody = await healthResponse.json() as {
      current_plan: string;
      configured_plan: string;
      subscription_status: string;
      server_access: { source: string; effectiveListingPlan: string };
      plan_limits: { status_interval_minutes: number; adm_discovery_interval_minutes: number; adm_processing_interval_minutes: number };
      warnings: string[];
    };
    assert.equal(healthBody.current_plan, "free");
    assert.equal(healthBody.configured_plan, "pro");
    assert.equal(healthBody.subscription_status, "canceled");
    assert.equal(healthBody.server_access.source, "complimentary_showcase");
    assert.equal(healthBody.server_access.effectiveListingPlan, "pro");
    assert.deepEqual(healthBody.plan_limits, { status_interval_minutes: 60, adm_discovery_interval_minutes: 60, adm_processing_interval_minutes: 1440 });
    assert.equal(healthBody.warnings.includes("subscription_not_active"), true);

    const advertisingResponse = await invoke(advertisingBump, env, actor, "GET");
    assert.equal(advertisingResponse.status, 200);
    const advertisingBody = await advertisingResponse.json() as {
      advertising: { access_source: string; effective_listing_plan: string; bump_cooldown_days: number; included_bumps_per_month: number };
      server_access: { source: string };
    };
    assert.equal(advertisingBody.advertising.access_source, "complimentary_showcase");
    assert.equal(advertisingBody.advertising.effective_listing_plan, "pro");
    assert.equal(advertisingBody.advertising.bump_cooldown_days, 7);
    assert.equal(advertisingBody.advertising.included_bumps_per_month, 2);
    assert.equal(advertisingBody.server_access.source, "complimentary_showcase");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), billingBefore);
  });
  await test("owner analytics resolve only the exact server authorized by id", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE linked_servers SET public_slug = ? WHERE id = ?")
      .run("same-guild-public", "same-guild-other-server");
    db.sqlite.prepare("UPDATE linked_servers SET user_id = ?, public_slug = ? WHERE id = ?")
      .run(other.id, "same-guild-other-server", scope.linkedServerId);

    const response = await invoke(dashboardAdvancedStats, env, actor, "GET", undefined, "same-guild-other-server");
    assert.equal(response.status, 200);
    const body = await response.json() as { server: { id: string } };
    assert.equal(body.server.id, "same-guild-other-server");
  });
  await test("complimentary bump starts a fresh period when owner billing dates are stale", async ({ db, env }) => {
    await upsertBillingAccount(env, {
      discordUserId: actor.discord_id,
      planKey: "free",
      planStatus: "free",
      currentPeriodStart: "2026-06-18T00:00:00.000Z",
      currentPeriodEnd: "2026-07-18T00:00:00.000Z",
    });
    await grant(env);
    const billingBefore = db.sqlite.prepare("SELECT * FROM owner_billing_accounts WHERE discord_user_id = ?").get(actor.discord_id);
    db.sqlite.prepare(`INSERT INTO server_advertising_state (
        linked_server_id, owner_discord_id, last_bumped_at, next_bump_at,
        bump_count_current_period, bump_period_start, bump_period_end, updated_at
      ) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2026-06-08T00:00:00.000Z', 2,
        '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`)
      .run(scope.linkedServerId, actor.discord_id);

    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      const bumpResponse = await invoke(advertisingBump, env, actor, "POST", {});
      assert.equal(bumpResponse.status, 200);
      const bump = await bumpResponse.json() as {
        advertising: { bump_count_current_period: number; bump_period_start: string; bump_period_end: string };
      };
      assert.equal(bump.advertising.bump_count_current_period, 1);
      assert.ok(Date.parse(bump.advertising.bump_period_start) <= now);
      assert.ok(Date.parse(bump.advertising.bump_period_end) > now);

      now += 7 * 24 * 60 * 60 * 1000;
      const samePeriodResponse = await invoke(advertisingBump, env, actor, "POST", {});
      assert.equal(samePeriodResponse.status, 200);
      const samePeriod = await samePeriodResponse.json() as typeof bump;
      assert.equal(samePeriod.advertising.bump_count_current_period, 2);
      assert.equal(samePeriod.advertising.bump_period_start, bump.advertising.bump_period_start);
      assert.equal(samePeriod.advertising.bump_period_end, bump.advertising.bump_period_end);

      now = Date.parse(bump.advertising.bump_period_end) + 1000;
      const rolloverResponse = await invoke(advertisingBump, env, actor, "POST", {});
      assert.equal(rolloverResponse.status, 200);
      const rollover = await rolloverResponse.json() as typeof bump;
      assert.equal(rollover.advertising.bump_count_current_period, 1);
      assert.ok(Date.parse(rollover.advertising.bump_period_start) > Date.parse(bump.advertising.bump_period_start));
      assert.ok(Date.parse(rollover.advertising.bump_period_end) > Date.parse(bump.advertising.bump_period_end));

      const readResponse = await invoke(advertisingBump, env, actor, "GET");
      assert.equal(readResponse.status, 200);
      const read = await readResponse.json() as typeof bump;
      const readState = Object.fromEntries(Object.entries(read.advertising).filter(([key]) => !key.endsWith("_observed_at")));
      const rolloverState = Object.fromEntries(Object.entries(rollover.advertising).filter(([key]) => !key.endsWith("_observed_at")));
      assert.deepEqual(readState, rolloverState);
      assert.deepEqual(
        db.sqlite.prepare("SELECT * FROM owner_billing_accounts WHERE discord_user_id = ?").get(actor.discord_id),
        billingBefore,
      );
    } finally {
      Date.now = originalNow;
    }
  });
  await test("exact grant highlights only NukeTown without changing global advanced ranks beyond the metadata window", async ({ db, env }) => {
    seedPublicMedia(db);
    for (let index = 0; index < 501; index += 1) {
      db.sqlite.prepare(`INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, nitrado_service_id,
        server_name, server_type, server_category, status, lifecycle_status, public_slug, listing_visibility)
        VALUES (?, ?, 'extra-guild', 'synthetic-guild', ?, 'Synthetic extra', 'deathmatch', 'deathmatch',
          'live', 'active_live', ?, 'public')`)
        .run(`extra-${index}`, actor.id, `extra-service-${index}`, `extra-${index}`);
    }
    db.sqlite.prepare("UPDATE linked_servers SET rowid = 10000 WHERE id = ?").run(scope.linkedServerId);
    assert.ok(Number(db.sqlite.prepare("SELECT count(*) AS count FROM linked_servers").get()?.count) > 500);
    db.sqlite.exec(`WITH ranked_free_servers AS (
        SELECT id, nitrado_service_id
        FROM linked_servers
        WHERE id LIKE 'extra-%'
        ORDER BY id
        LIMIT 1
      ), event_numbers(event_number) AS (VALUES (1), (2), (3))
      INSERT INTO build_events (id, linked_server_id, nitrado_service_id, player_name, event_type,
        source_adm_file, source_line_number, occurred_at, raw_line)
      SELECT 'higher-free-build-' || ranked_free_servers.id || '-' || event_numbers.event_number,
        ranked_free_servers.id, ranked_free_servers.nitrado_service_id, 'Synthetic free builder', 'built',
        'synthetic.ADM', event_numbers.event_number, '2026-09-19T00:00:00Z', 'synthetic'
      FROM ranked_free_servers CROSS JOIN event_numbers;`);
    for (const [id, serverId, serviceId] of [
      ["nuketown-build", scope.linkedServerId, scope.nitradoServiceId],
      ["neighbor-build", "same-guild-other-server", "10000001"],
    ]) {
      db.sqlite.prepare(`INSERT INTO build_events (id, linked_server_id, nitrado_service_id, player_name, event_type,
        source_adm_file, source_line_number, occurred_at, raw_line)
        VALUES (?, ?, ?, 'Synthetic builder', 'built', 'synthetic.ADM', 1, '2026-09-19T00:00:00Z', 'synthetic')`)
        .run(id, serverId, serviceId);
    }
    for (const [id, x, y, occurredAt] of [
      ["nuketown-window-position-1", 1000, 1000, "2026-09-19T00:00:00Z"],
      ["nuketown-window-position-2", 1100, 1100, "2026-09-19T00:10:00Z"],
    ] as const) {
      db.sqlite.prepare(`INSERT INTO player_events
        (id, linked_server_id, player_name, event_type, position_x, position_y, occurred_at)
        VALUES (?, ?, 'NukeTown window explorer', 'player_position', ?, ?, ?)`)
        .run(id, scope.linkedServerId, x, y, occurredAt);
    }
    const before = await getPublicAdvancedLeaderboardsPayload(env, { limit: 20 });
    await grant(env);
    const payload = await getPublicAdvancedLeaderboardsPayload(env, { limit: 19 });
    for (const metricKey of ["build_score", "balanced_activity_score"]) {
      const beforeBoard = before.boards.find((candidate) => candidate.metricKey === metricKey);
      const board = payload.boards.find((candidate) => candidate.metricKey === metricKey);
      assert.ok(beforeBoard, `${metricKey} pre-grant board required`);
      assert.ok(board, `${metricKey} board required`);
      const competitiveProjection = (rows: typeof board.rows) => rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== "isPremiumShowcase")));
      assert.deepEqual(
        competitiveProjection(board.rows),
        competitiveProjection(beforeBoard.rows.slice(0, 19)),
        `${metricKey} ranks and values must not change with presentation access`,
      );
      const nuketown = board.rows.find((row) => row.serverId === scope.linkedServerId);
      assert.ok(nuketown, `NukeTown must appear on ${metricKey}`);
      assert.equal(nuketown.isPremiumShowcase, true, metricKey);
      assert.equal(board.rows.find((row) => row.serverId === "same-guild-other-server")?.isPremiumShowcase ?? false, false, `${metricKey} grant must remain exact-server`);
      if (metricKey === "build_score") {
        const higherFree = board.rows.find((row) => row.serverId?.startsWith("extra-"));
        assert.ok(higherFree, "higher-scoring Free server must remain ranked");
        assert.ok(higherFree.rank < nuketown.rank, "presentation access must not outrank a higher-scoring Free server");
        assert.equal(higherFree.isPremiumShowcase, false);
      }
    }
    for (const metricKey of ["most_travelled_server", "most_on_foot_distance", "map_exploration_percent"]) {
      assert.equal(payload.boards.some((board) => board.metricKey === metricKey), false, metricKey);
    }
    assert.match(payload.notes.join(" "), /durable plan-neutral aggregates/i);
  });
  await test("owner analytics use only durable headline totals and bounded event samples", async ({ db, env }) => {
    seedPublicMedia(db);
    await grant(env);
    db.sqlite.prepare(`INSERT INTO server_stats (
      id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects, unique_players, last_event_at
    ) VALUES ('durable-stats', ?, 1, 1, 2, 1, 1, '2026-09-19T00:00:00Z')`).run(scope.linkedServerId);
    const eventQueries: string[] = [];
    const wrappedDb = { prepare(sql: string) {
      if (/\bFROM\s+(?:kill_events|player_events|build_events)\b/i.test(sql)) eventQueries.push(sql);
      return db.prepare(sql);
    } } as unknown as D1Database;
    const payload = await getServerAdvancedShowcasePayload({ ...env, DB: wrappedDb }, scope.linkedServerId, { ownerScoped: true });
    assert.ok(payload);
    assert.ok(eventQueries.length > 0);
    const lifetimeCountQueries = eventQueries.filter(sql => /AS\s+player_events[\s\S]+AS\s+build_events/i.test(sql));
    const sampledQueries = eventQueries.filter(sql => !lifetimeCountQueries.includes(sql));
    assert.equal(lifetimeCountQueries.length, 0, "Request-time analytics must not count full raw event history.");
    assert.equal(payload.summary.eventsTracked, null, "Partial durable counters must not be presented as a complete event total.");
    assert.ok(payload.notes.some(note => note.includes("dedicated durable aggregate")));
    assert.ok(sampledQueries.every(sql => /\bLIMIT\s+\?/i.test(sql)), "Every request-time event row query must be hard bounded");
    assert.ok(sampledQueries.every(sql => /ORDER BY rowid DESC[\s\S]+LIMIT \?/i.test(sql)), "Every bounded event sample must select newest imported rows first");
    assert.match(eventQueries.join("\n"), /FROM player_events[\s\S]+WHERE linked_server_id = \?[\s\S]+ORDER BY rowid DESC[\s\S]+LIMIT \?/, "Position sampling must bound selected-server rows before testing coordinate fields.");
  });
  await test("sparse position history stays inside the newest fixed row window", async ({ db, env }) => {
    db.sqlite.prepare(`INSERT INTO player_events
      (id, linked_server_id, player_name, event_type, position_x, position_y, occurred_at)
      VALUES ('old-coordinate', ?, 'Old explorer', 'player_position', 1000, 1000, '2026-01-01T00:00:00Z')`).run(scope.linkedServerId);
    db.sqlite.exec(`WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 8001
      )
      INSERT INTO player_events (id, linked_server_id, player_name, event_type, occurred_at)
      SELECT 'coordinate-less-' || value, '${scope.linkedServerId}', 'Active player', 'player_connected', '2026-09-19T00:00:00Z'
      FROM sequence;`);
    const samples = await queryPositionSamples(env, { linkedServerId: scope.linkedServerId, limit: 6000 });
    assert.equal(samples.some(sample => sample.playerName === "Old explorer"), false);
  });
  await test("unrelated server imports do not evict selected-server positions", async ({ db, env }) => {
    db.sqlite.prepare(`INSERT INTO player_events
      (id, linked_server_id, player_name, event_type, position_x, position_y, occurred_at)
      VALUES ('target-coordinate', ?, 'Target explorer', 'player_position', 1000, 1000, '2026-01-01T00:00:00Z')`).run(scope.linkedServerId);
    db.sqlite.exec(`WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 8001
      )
      INSERT INTO player_events (id, linked_server_id, player_name, event_type, occurred_at)
      SELECT 'unrelated-event-' || value, 'same-guild-other-server', 'Other player', 'player_connected', '2026-09-19T00:00:00Z'
      FROM sequence;`);
    const samples = await queryPositionSamples(env, { linkedServerId: scope.linkedServerId, limit: 6000 });
    assert.equal(samples.some(sample => sample.playerName === "Target explorer"), true);
  });
  await test("bounded analytics include newest rows without fabricating a lifetime event total", async ({ db, env }) => {
    db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
    db.sqlite.prepare(`INSERT INTO server_stats (
      id, linked_server_id, total_kills, total_deaths, total_joins, total_disconnects, unique_players, last_event_at
    ) VALUES ('large-durable-stats', ?, 6001, 6001, 2001, 1, 2, '2026-09-19T00:00:00Z')`).run(scope.linkedServerId);
    db.sqlite.exec(`WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 6000
      )
      INSERT INTO kill_events (id, linked_server_id, killer_name, victim_name, distance, occurred_at)
      SELECT 'old-kill-' || value, '${scope.linkedServerId}', 'Older player', 'Synthetic victim', 45, '2026-01-01T00:00:00Z'
      FROM sequence;
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 2000
      )
      INSERT INTO player_events (id, linked_server_id, player_name, event_type, position_x, position_y, occurred_at)
      SELECT 'old-position-' || value, '${scope.linkedServerId}', 'Older explorer', 'player_position', 1000, 1000, '2026-01-01T00:00:00Z'
      FROM sequence;`);
    db.sqlite.prepare(`INSERT INTO kill_events (id, linked_server_id, killer_name, victim_name, distance, occurred_at)
      VALUES ('newest-kill', ?, 'Newest player', 'Synthetic victim', 2000, '2026-09-19T00:00:00Z')`).run(scope.linkedServerId);
    db.sqlite.prepare(`INSERT INTO player_events (id, linked_server_id, player_name, event_type, position_x, position_y, occurred_at)
      VALUES ('newest-position', ?, 'Newest explorer', 'player_position', 5000, 5000, '2026-09-19T00:00:00Z')`).run(scope.linkedServerId);
    db.sqlite.prepare(`INSERT INTO build_events (id, linked_server_id, nitrado_service_id, player_name, event_type,
      source_adm_file, source_line_number, occurred_at, raw_line)
      VALUES ('newest-build', ?, ?, 'Newest builder', 'built', 'synthetic.ADM', 1, '2026-09-19T00:00:00Z', 'synthetic')`)
      .run(scope.linkedServerId, scope.nitradoServiceId);

    const payload = await getServerAdvancedShowcasePayload(env, scope.linkedServerId);
    assert.ok(payload);
    const longest = payload.boards.find(board => board.metricKey === "server_longest_kills");
    assert.equal(longest?.rows[0]?.playerName, "Newest player");
    assert.equal(payload.summary.eventsTracked, null);
    assert.ok(payload.notes.some(note => note.includes("dedicated durable aggregate")));
    const samples = await queryPositionSamples(env, { linkedServerId: scope.linkedServerId, limit: 6000 });
    assert.equal(samples.some(sample => sample.occurredAt === "2026-09-19T00:00:00Z"), true);
  });
  await test("bounded fallback preserves freshness for kill-only data", async ({ db, env }) => {
    db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
    db.sqlite.prepare(`INSERT INTO kill_events (id, linked_server_id, killer_name, victim_name, distance, occurred_at)
      VALUES ('freshness-kill', ?, 'Fresh player', 'Synthetic victim', 50, '2026-09-19T12:00:00Z')`).run(scope.linkedServerId);
    const payload = await getServerAdvancedShowcasePayload(env, scope.linkedServerId);
    assert.ok(payload);
    assert.equal(payload.summary.kills, 1);
    assert.equal(payload.summary.lastUpdatedAt, "2026-09-19T12:00:00Z");
  });
  await test("locked owner analytics never reconstruct raw event history", async ({ db, env }) => {
    const wrappedDb = { prepare(sql: string) {
      if (/\bFROM\s+(?:kill_events|player_events|build_events)\b/i.test(sql)) {
        throw new Error("Locked analytics attempted a raw event query");
      }
      return db.prepare(sql);
    } } as unknown as D1Database;
    const payload = await getServerAdvancedShowcasePayload({ ...env, DB: wrappedDb }, scope.linkedServerId, { ownerScoped: true });
    assert.ok(payload);
    assert.equal(payload.access.dashboardAnalytics, false);
    assert.equal(payload.summary.eventsTracked, null);
    assert.ok(payload.notes.some(note => note.includes("exact lifetime event total is unavailable")));
    assert.ok(payload.boards.every(board => board.locked && board.rows.length === 0));
  });
  await test("revoked complimentary grant cannot commit a queued weekly bump", async ({ db, env }) => {
    const grantId = await grant(env);
    let revoked = false;
    db.beforeWrite = (sql) => {
      if (!revoked && /INSERT INTO server_listing_events/.test(sql)) {
        revoked = true;
        revokeSql(db, grantId);
      }
    };
    const response = await invoke(advertisingBump, env, actor, "POST", {});
    db.beforeWrite = null;
    const body = await response.json() as { code?: string };
    assert.equal(revoked, true);
    assert.equal(response.status, 409);
    assert.equal(body.code, "access_changed");
    assert.equal(db.sqlite.prepare("SELECT COALESCE(bump_count_current_period, 0) AS count FROM server_advertising_state WHERE linked_server_id = ?").get(scope.linkedServerId)?.count ?? 0, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_ad_bump_events WHERE linked_server_id = ?").get(scope.linkedServerId)?.count, 0);
  });
  await test("expired complimentary grant uses the database clock at the protected bump write", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db);
    const OriginalDate = globalThis.Date;
    const skewedNow = OriginalDate.parse(expiresAt) - 500;
    class SkewedDate extends OriginalDate {
      constructor(value?: string | number | Date) {
        super(value === undefined ? skewedNow : value instanceof OriginalDate ? value.getTime() : value);
      }
      static now() { return skewedNow; }
    }
    let expired = false;
    db.beforeFirst = (sql) => {
      if (expired || !/INSERT INTO server_advertising_state/.test(sql)) return;
      expired = true;
      waitUntilAfter(expiresAt);
      globalThis.Date = SkewedDate as DateConstructor;
    };
    try {
      const response = await invoke(advertisingBump, env, actor, "POST", {});
      const body = await response.json() as { code?: string };
      assert.equal(response.status, 409, JSON.stringify(body));
      assert.equal(expired, true);
      assert.equal(body.code, "access_changed");
      assert.equal(db.sqlite.prepare("SELECT COALESCE(bump_count_current_period, 0) AS count FROM server_advertising_state WHERE linked_server_id = ?").get(scope.linkedServerId)?.count ?? 0, 0);
      assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_ad_bump_events WHERE linked_server_id = ?").get(scope.linkedServerId)?.count, 0);
    } finally {
      db.beforeFirst = null;
      globalThis.Date = OriginalDate;
    }
  });
  await test("paid downgrade cannot create or commit a queued weekly bump", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET plan_key = 'pro', status = 'active'").run();
    let downgraded = false;
    db.beforeWrite = (sql) => {
      if (!downgraded && /INSERT INTO server_listing_events/.test(sql)) {
        downgraded = true;
        db.sqlite.prepare("UPDATE server_subscriptions SET plan_key = 'starter', status = 'canceled'").run();
      }
    };
    const response = await invoke(advertisingBump, env, actor, "POST", {}, "same-guild-other-server");
    db.beforeWrite = null;
    const body = await response.json() as { code?: string };
    assert.equal(downgraded, true);
    assert.equal(response.status, 409);
    assert.equal(body.code, "access_changed");
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_advertising_state WHERE linked_server_id = ?").get("same-guild-other-server")?.count, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_ad_bump_events WHERE linked_server_id = ?").get("same-guild-other-server")?.count, 0);
  });
  await test("transferred owner cannot create or commit a queued Free bump", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = ?, plan_key = 'pro', status = 'active'").run(other.discord_id);
    await upsertBillingAccount(env, { discordUserId: actor.discord_id, planKey: "free", planStatus: "free" });
    let transferred = false;
    db.beforeWrite = (sql) => {
      if (!transferred && /INSERT INTO server_listing_events/.test(sql)) {
        transferred = true;
        db.sqlite.prepare("UPDATE linked_servers SET user_id = ? WHERE id = ?").run(other.id, "same-guild-other-server");
      }
    };
    const response = await invoke(advertisingBump, env, actor, "POST", {}, "same-guild-other-server");
    db.beforeWrite = null;
    const body = await response.json() as { code?: string };
    assert.equal(transferred, true);
    assert.equal(response.status, 409);
    assert.equal(body.code, "access_changed");
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_advertising_state WHERE linked_server_id = ?").get("same-guild-other-server")?.count, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_ad_bump_events WHERE linked_server_id = ?").get("same-guild-other-server")?.count, 0);
  });
  await test("changed lifecycle cannot create or commit a queued Free bump", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = ?, plan_key = 'starter', status = 'canceled'").run(actor.discord_id);
    let lifecycleChanged = false;
    db.beforeWrite = (sql) => {
      if (!lifecycleChanged && /INSERT INTO server_listing_events/.test(sql)) {
        lifecycleChanged = true;
        db.sqlite.prepare("UPDATE linked_servers SET lifecycle_status = 'archived_hidden' WHERE id = ?").run("same-guild-other-server");
      }
    };
    const response = await invoke(advertisingBump, env, actor, "POST", {}, "same-guild-other-server");
    db.beforeWrite = null;
    const body = await response.json() as { code?: string };
    assert.equal(lifecycleChanged, true);
    assert.equal(response.status, 409);
    assert.equal(body.code, "access_changed");
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_advertising_state WHERE linked_server_id = ?").get("same-guild-other-server")?.count, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM server_ad_bump_events WHERE linked_server_id = ?").get("same-guild-other-server")?.count, 0);
  });
  await test("successful bump response is newer than an overlapping pre-write read", async ({ db, env }) => {
    await grant(env);
    type AdvertisingRead = { generated_at: string; advertising: { bump_count_current_period: number } };
    const observed: { read?: AdvertisingRead } = {};
    const wrappedDb = { prepare(sql: string) {
      const statement = db.prepare(sql);
      if (!/UPDATE server_advertising_state[\s\S]+RETURNING/.test(sql)) return statement;
      const wrap = (current: ReturnType<LocalD1["prepare"]>): ReturnType<LocalD1["prepare"]> => ({
        bind: (...values: unknown[]) => wrap(current.bind(...values)),
        run: () => current.run(),
        all: () => current.all(),
        first: async () => {
          await new Promise(resolve => setTimeout(resolve, 20));
          const response = await invoke(advertisingBump, env, actor, "GET");
          observed.read = await response.json() as AdvertisingRead;
          return current.first();
        },
      });
      return wrap(statement);
    } } as unknown as D1Database;
    const response = await invoke(advertisingBump, { ...env, DB: wrappedDb }, actor, "POST", {});
    const body = await response.json() as { generated_at: string; advertising: { bump_count_current_period: number } };
    assert.equal(response.status, 200);
    assert.ok(observed.read);
    assert.equal(observed.read.advertising.bump_count_current_period, 0);
    assert.equal(body.advertising.bump_count_current_period, 1);
    assert.ok(Date.parse(body.generated_at) >= Date.parse(observed.read.generated_at));
  });
  await test("a delayed advertising GET cannot outrank a newer access snapshot", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET status = 'active'").run();
    type AdvertisingRead = {
      generated_at: string;
      advertising: { effective_listing_plan: string };
    };
    const observed: { fresh?: AdvertisingRead } = {};
    db.afterFirst = async (sql) => {
      if (!sql.includes("SELECT * FROM server_advertising_state")) return;
      db.afterFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      db.sqlite.prepare("UPDATE server_subscriptions SET status = 'canceled'").run();
      observed.fresh = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
      await new Promise(resolve => setTimeout(resolve, 20));
    };

    const stale = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
    assert.ok(observed.fresh);
    assert.equal(stale.advertising.effective_listing_plan, "pro");
    assert.equal(observed.fresh.advertising.effective_listing_plan, "free");
    assert.ok(Date.parse(stale.generated_at) < Date.parse(observed.fresh.generated_at));
  });
  await test("health access observed after advertising wins an overlapping revocation", async ({ db, env }) => {
    const grantId = await grant(env);
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing" | "complimentary_showcase";
        effectiveListingPlan: string;
        billingObservedAt: string;
        showcaseGrantObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing" | "complimentary_showcase";
        effective_listing_plan: string;
        billing_observed_at: string;
        showcase_grant_observed_at: string;
      };
    };
    const observed: { advertising?: AdvertisingRead } = {};
    db.beforeFirst = async (sql) => {
      if (!sql.includes("FROM server_showcase_grants AS grant_row")) return;
      db.beforeFirst = null;
      observed.advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
      await new Promise(resolve => setTimeout(resolve, 20));
      revokeSql(db, grantId);
    };

    const health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
    assert.ok(observed.advertising);
    assert.equal(observed.advertising.advertising.access_source, "complimentary_showcase");
    assert.equal(health.server_access.source, "billing");
    assert.ok(Date.parse(health.server_access.showcaseGrantObservedAt) >
      Date.parse(observed.advertising.advertising.showcase_grant_observed_at));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: health.server_access,
      healthGeneratedAt: health.generated_at,
      advertisingAccess: observed.advertising.advertising,
      advertisingGeneratedAt: observed.advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "free" });
  });
  await test("advertising access observed after health wins an overlapping revocation", async ({ db, env }) => {
    const grantId = await grant(env);
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing" | "complimentary_showcase";
        effectiveListingPlan: string;
        billingObservedAt: string;
        showcaseGrantObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing" | "complimentary_showcase";
        effective_listing_plan: string;
        billing_observed_at: string;
        showcase_grant_observed_at: string;
      };
    };
    const observed: { health?: AccessRead } = {};
    db.beforeFirst = async (sql) => {
      if (!sql.includes("FROM server_showcase_grants AS grant_row")) return;
      db.beforeFirst = null;
      observed.health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
      await new Promise(resolve => setTimeout(resolve, 20));
      revokeSql(db, grantId);
    };

    const advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
    assert.ok(observed.health);
    assert.equal(observed.health.server_access.source, "complimentary_showcase");
    assert.equal(advertising.advertising.access_source, "billing");
    assert.ok(Date.parse(advertising.advertising.showcase_grant_observed_at) >
      Date.parse(observed.health.server_access.showcaseGrantObservedAt));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: observed.health.server_access,
      healthGeneratedAt: observed.health.generated_at,
      advertisingAccess: advertising.advertising,
      advertisingGeneratedAt: advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "free" });
  });
  await test("an advertising response cannot revive a grant revoked after its access read", async ({ db, env }) => {
    const grantId = await grant(env);
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing" | "complimentary_showcase";
        effectiveListingPlan: string;
        billingObservedAt: string;
        showcaseGrantObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing" | "complimentary_showcase";
        effective_listing_plan: string;
        billing_observed_at: string;
        showcase_grant_observed_at: string;
      };
    };
    const observed: { health?: AccessRead } = {};
    db.beforeFirst = async (sql) => {
      if (!sql.includes("SELECT * FROM server_advertising_state")) return;
      db.beforeFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      revokeSql(db, grantId);
      observed.health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
      await new Promise(resolve => setTimeout(resolve, 20));
    };

    const advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
    assert.ok(observed.health);
    assert.equal(advertising.advertising.access_source, "complimentary_showcase");
    assert.equal(observed.health.server_access.source, "billing");
    assert.ok(Date.parse(advertising.generated_at) < Date.parse(observed.health.generated_at));
    assert.ok(Date.parse(observed.health.server_access.showcaseGrantObservedAt) >
      Date.parse(advertising.advertising.showcase_grant_observed_at));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: observed.health.server_access,
      healthGeneratedAt: observed.health.generated_at,
      advertisingAccess: advertising.advertising,
      advertisingGeneratedAt: advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "free" });
  });
  await test("a health response cannot revive billing canceled after its server read", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET status = 'active'").run();
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing";
        effectiveListingPlan: string;
        billingObservedAt: string;
        showcaseGrantObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing";
        effective_listing_plan: string;
        billing_observed_at: string;
        showcase_grant_observed_at: string;
      };
    };
    const observed: { advertising?: AdvertisingRead } = {};
    db.beforeFirst = async (sql) => {
      if (!sql.includes("FROM nitrado_file_read_attempts")) return;
      db.beforeFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      db.sqlite.prepare("UPDATE server_subscriptions SET status = 'canceled'").run();
      observed.advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
      await new Promise(resolve => setTimeout(resolve, 20));
    };

    const health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
    assert.ok(observed.advertising);
    assert.equal(health.server_access.effectiveListingPlan, "pro");
    assert.equal(observed.advertising.advertising.effective_listing_plan, "free");
    assert.ok(Date.parse(health.generated_at) >= Date.parse(observed.advertising.generated_at));
    assert.ok(Date.parse(observed.advertising.advertising.billing_observed_at) >
      Date.parse(health.server_access.billingObservedAt));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: health.server_access,
      healthGeneratedAt: health.generated_at,
      advertisingAccess: observed.advertising.advertising,
      advertisingGeneratedAt: observed.advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "free" });
  });
  await test("newer complimentary access outranks a delayed stale paid health snapshot", async ({ db, env }) => {
    await grant(env);
    db.sqlite.prepare("UPDATE server_subscriptions SET status = 'active'").run();
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing" | "complimentary_showcase";
        effectiveListingPlan: string;
        billingObservedAt: string;
        showcaseGrantObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing" | "complimentary_showcase";
        effective_listing_plan: string;
        billing_observed_at: string;
        showcase_grant_observed_at: string;
      };
    };
    const observed: { advertising?: AdvertisingRead } = {};
    db.afterFirst = async (sql) => {
      if (!sql.includes("COALESCE(server_subscriptions.plan_key, owner_billing_accounts.plan_key) AS plan_key")) return;
      db.afterFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      db.sqlite.prepare("UPDATE server_subscriptions SET status = 'canceled'").run();
      observed.advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
      await new Promise(resolve => setTimeout(resolve, 20));
    };

    const health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
    assert.ok(observed.advertising);
    assert.equal(health.server_access.source, "billing");
    assert.equal(observed.advertising.advertising.access_source, "complimentary_showcase");
    assert.ok(Date.parse(observed.advertising.advertising.billing_observed_at) >
      Date.parse(health.server_access.billingObservedAt));
    assert.equal(health.server_access.showcaseGrantObservedAt, health.server_access.billingObservedAt);
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: health.server_access,
      healthGeneratedAt: health.generated_at,
      advertisingAccess: observed.advertising.advertising,
      advertisingGeneratedAt: observed.advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "complimentary_showcase", effectivePlan: "pro" });
  });
  await test("the final billing snapshot sees a higher-priority subscription inserted during fallback reads", async ({ db, env }) => {
    const subscription = db.sqlite.prepare("SELECT * FROM server_subscriptions").get()!;
    await upsertBillingAccount(env, {
      discordUserId: actor.discord_id,
      planKey: "free",
      planStatus: "free",
    });
    db.sqlite.exec("DELETE FROM server_subscriptions");
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing";
        effectiveListingPlan: string;
        billingObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing";
        effective_listing_plan: string;
        billing_observed_at: string;
      };
    };
    const observed: { health?: AccessRead } = {};
    db.beforeFirst = async (sql) => {
      if (!sql.includes("LEFT JOIN owner_billing_accounts ON owner_billing_accounts.discord_user_id = ?")) return;
      db.beforeFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      const columns = Object.keys(subscription);
      db.sqlite.prepare(`INSERT INTO server_subscriptions (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .run(...Object.values({ ...subscription, status: "active" }));
      observed.health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
    };

    const advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
    assert.ok(observed.health);
    assert.equal(advertising.advertising.effective_listing_plan, "pro");
    assert.equal(observed.health.server_access.effectiveListingPlan, "pro");
    assert.ok(Date.parse(advertising.advertising.billing_observed_at) >=
      Date.parse(observed.health.server_access.billingObservedAt));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: observed.health.server_access,
      healthGeneratedAt: observed.health.generated_at,
      advertisingAccess: advertising.advertising,
      advertisingGeneratedAt: advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "pro" });
  });
  await test("a delayed health query result keeps its database snapshot observation", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET status = 'active'").run();
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing";
        effectiveListingPlan: string;
        billingObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing";
        effective_listing_plan: string;
        billing_observed_at: string;
      };
    };
    const observed: { advertising?: AdvertisingRead } = {};
    db.afterFirst = async (sql) => {
      if (!sql.includes("COALESCE(server_subscriptions.plan_key, owner_billing_accounts.plan_key) AS plan_key")) return;
      db.afterFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      db.sqlite.prepare("UPDATE server_subscriptions SET status = 'canceled'").run();
      observed.advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
      await new Promise(resolve => setTimeout(resolve, 20));
    };

    const health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
    assert.ok(observed.advertising);
    assert.equal(health.server_access.effectiveListingPlan, "pro");
    assert.equal(observed.advertising.advertising.effective_listing_plan, "free");
    assert.ok(Date.parse(observed.advertising.advertising.billing_observed_at) >
      Date.parse(health.server_access.billingObservedAt));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: health.server_access,
      healthGeneratedAt: health.generated_at,
      advertisingAccess: observed.advertising.advertising,
      advertisingGeneratedAt: observed.advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "free" });
  });
  await test("the final billing snapshot sees an owner fallback canceled during the request", async ({ db, env }) => {
    db.sqlite.exec("DELETE FROM server_subscriptions");
    await upsertBillingAccount(env, {
      discordUserId: actor.discord_id,
      planKey: "pro",
      planStatus: "active",
    });
    db.sqlite.exec("DELETE FROM server_subscriptions");
    type AccessRead = {
      generated_at: string;
      server_access: {
        source: "billing";
        effectiveListingPlan: string;
        billingObservedAt: string;
      };
    };
    type AdvertisingRead = {
      generated_at: string;
      advertising: {
        access_source: "billing";
        effective_listing_plan: string;
        billing_observed_at: string;
      };
    };
    const observed: { health?: AccessRead } = {};
    db.afterFirst = async (sql) => {
      if (!sql.includes("AS server_subscription_status")) return;
      db.afterFirst = null;
      await new Promise(resolve => setTimeout(resolve, 20));
      observed.health = await (await invoke(dashboardHealth, env, actor, "GET")).json() as AccessRead;
      await new Promise(resolve => setTimeout(resolve, 20));
      db.sqlite.prepare("UPDATE owner_billing_accounts SET plan_status = 'canceled', updated_at = ? WHERE discord_user_id = ?")
        .run(new Date().toISOString(), actor.discord_id);
    };

    const advertising = await (await invoke(advertisingBump, env, actor, "GET")).json() as AdvertisingRead;
    assert.ok(observed.health);
    assert.equal(observed.health.server_access.effectiveListingPlan, "pro");
    assert.equal(advertising.advertising.effective_listing_plan, "free");
    assert.ok(Date.parse(advertising.advertising.billing_observed_at) >
      Date.parse(observed.health.server_access.billingObservedAt));
    assert.deepEqual(dashboardSelectedServerAccess({
      healthAccess: observed.health.server_access,
      healthGeneratedAt: observed.health.generated_at,
      advertisingAccess: advertising.advertising,
      advertisingGeneratedAt: advertising.generated_at,
      serverDisplayPlan: null,
    }), { source: "billing", effectivePlan: "free" });
  });
  await test("a queued grant read evaluates expiry at the database snapshot", async ({ db, env }) => {
    const createdAt = new Date(Date.now() - 1_000).toISOString();
    const expiresAt = new Date(Date.now() + 100).toISOString();
    db.sqlite.prepare(`INSERT INTO server_showcase_grants (
      id, linked_server_id, owner_user_id, owner_discord_id, guild_id, nitrado_service_id,
      created_by_user_id, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), scope.linkedServerId, scope.ownerUserId, scope.ownerDiscordId, scope.guildId,
        scope.nitradoServiceId, actor.id, createdAt, expiresAt);
    db.beforeFirst = async (sql) => {
      if (!sql.includes("WITH active_grant AS")) return;
      db.beforeFirst = null;
      await new Promise(resolve => setTimeout(resolve, 150));
    };

    const response = await invoke(advertisingBump, env, actor, "GET");
    const body = await response.json() as {
      advertising: {
        access_source: "billing" | "complimentary_showcase";
        showcase_grant_observed_at: string;
      };
    };
    assert.equal(response.status, 200);
    assert.equal(body.advertising.access_source, "billing");
    assert.ok(Date.parse(body.advertising.showcase_grant_observed_at) >= Date.parse(expiresAt));
  });
  await test("concurrent grants create one immutable grant and one audit event", async ({ db, env }) => {
    const results = await Promise.all(Array.from({ length: 8 }, () => changeShowcaseGrant(env, actor, { action: "grant", requestId: randomUUID() })));
    assert.ok(results.every(result => result.status === 200));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grants").get()?.n, 1);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grant_audit").get()?.n, 1);
    assert.throws(() => db.sqlite.exec("UPDATE server_showcase_grants SET plan_key = 'premium'"));
    assert.throws(() => db.sqlite.exec("DELETE FROM server_showcase_grants"));
    assert.throws(() => db.sqlite.exec("DELETE FROM server_showcase_grant_audit"));
    assert.throws(() => db.sqlite.exec("UPDATE server_showcase_grant_audit SET reason = 'changed'"));
    assert.throws(() => db.sqlite.exec("UPDATE server_showcase_grants SET revoked_at = '2026-09-12'"));
  });
  await test("database constraints reject grants for every changed scope field", async ({ db, env }) => {
    const id = await grant(env); revokeSql(db, id);
    const row = db.sqlite.prepare("SELECT * FROM server_showcase_grants").get()!;
    for (const field of ["linked_server_id", "owner_user_id", "owner_discord_id", "guild_id", "nitrado_service_id", "plan_key", "purpose"]) {
      const invalid = { ...row, id: randomUUID(), revoked_at: null, revoked_by_user_id: null, revocation_reason: null, [field]: "different" };
      const columns = Object.keys(invalid);
      assert.throws(() => db.sqlite.prepare(`INSERT INTO server_showcase_grants (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
        .run(...Object.values(invalid)), /CHECK constraint/, field);
    }
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grants").get()?.n, 1);
  });
  await test("unexpected database failures never silently enable or fall back access", async ({ env }) => {
    const failedDb = { prepare: () => { throw new Error("Synthetic database unavailable"); } } as unknown as D1Database;
    await assert.rejects(readServerShowcaseAccess({ ...env, DB: failedDb }, scope.linkedServerId, inactive), /database unavailable/);
  });
  await test("revocation is reasoned, idempotent and cannot revive the original request", async ({ db, env }) => {
    const id = await grant(env);
    assert.equal((await changeShowcaseGrant(env, actor, { action: "revoke", grantId: id, reason: "owner_request" })).status, 200);
    assert.equal((await changeShowcaseGrant(env, actor, { action: "revoke", grantId: id, reason: "owner_request" })).status, 200);
    assert.equal((await changeShowcaseGrant(env, actor, { action: "grant", requestId: id })).status, 409);
    assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
    const events = db.sqlite.prepare("SELECT action, actor_user_id, reason FROM server_showcase_grant_audit ORDER BY sequence").all();
    assert.deepEqual(events.map(row => row.action), ["granted", "revoked"]);
    assert.equal(events[1].actor_user_id, actor.id); assert.equal(events[1].reason, "owner_request");
  });
  for (const [field, value] of [["user_id", other.id], ["guild_id", "different-guild"], ["nitrado_service_id", "different-service"],
    ["status", "suspended"], ["status", "deleted"], ["status", "merged"], ["merged_into_server_id", "other-server"]]) {
    await test(`association invalidation: ${field}=${value}`, async ({ db, env }) => {
      await grant(env);
      const before = db.sqlite.prepare(`SELECT ${field} AS value FROM linked_servers WHERE id = ?`).get(scope.linkedServerId)?.value;
      db.sqlite.prepare(`UPDATE linked_servers SET ${field} = ? WHERE id = ?`).run(value, scope.linkedServerId);
      assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
      db.sqlite.prepare(`UPDATE linked_servers SET ${field} = ? WHERE id = ?`).run(before, scope.linkedServerId);
      assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
      assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grant_audit").get()?.n, 2);
    });
  }
  await test("owner Discord change invalidates grant even after changing back", async ({ db, env }) => {
    await grant(env); db.sqlite.prepare("UPDATE users SET discord_id = 'changed-discord' WHERE id = ?").run(actor.id);
    db.sqlite.prepare("UPDATE users SET discord_id = ? WHERE id = ?").run(actor.discord_id, actor.id);
    assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
  });
  await test("inactive lifecycle and pending verification cannot activate or resolve grant", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE linked_servers SET lifecycle_status = 'archived_hidden' WHERE id = ?").run(scope.linkedServerId);
    assert.equal((await changeShowcaseGrant(env, actor, { action: "grant", requestId: randomUUID() })).status, 409);
    db.sqlite.prepare("UPDATE linked_servers SET lifecycle_status = 'active_live' WHERE id = ?").run(scope.linkedServerId);
    await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'pending' WHERE id = ?").run(scope.linkedServerId);
    assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
  });
  await test("expiration and future grants fail closed", async ({ db, env }) => {
    for (const [createdAt, expiresAt] of [["2020-01-01", "2020-02-01"], ["2999-01-01", null]]) {
      const id = randomUUID();
      db.sqlite.prepare(`INSERT INTO server_showcase_grants (id, linked_server_id, owner_user_id, owner_discord_id, guild_id,
        nitrado_service_id, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, scope.linkedServerId, scope.ownerUserId, scope.ownerDiscordId, scope.guildId, scope.nitradoServiceId, actor.id, createdAt, expiresAt);
      assert.equal((await readServerShowcaseAccess(env, scope.linkedServerId, inactive)).source, "billing");
      revokeSql(db, id);
    }
  });
  await test("audit failure rolls back grant and revocation atomically", async ({ db, env }) => {
    db.sqlite.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON server_showcase_grant_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;");
    await assert.rejects(grant(env), /synthetic audit failure/);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grants").get()?.n, 0);
    db.sqlite.exec("DROP TRIGGER synthetic_audit_failure"); const id = await grant(env);
    db.sqlite.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON server_showcase_grant_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;");
    await assert.rejects(changeShowcaseGrant(env, actor, { action: "revoke", grantId: id, reason: "support_correction" }), /synthetic audit failure/);
    assert.equal(db.sqlite.prepare("SELECT revoked_at FROM server_showcase_grants").get()?.revoked_at, null);
  });
  await test("owner API requires platform authority, same origin and exact confirmation", async ({ db, env }) => {
    assert.equal((await invoke(ownerApi, env, null, "GET")).status, 401);
    assert.equal((await invoke(ownerApi, env, other, "GET")).status, 403);
    assert.equal((await changeShowcaseGrant(env, other, { action: "grant", requestId: randomUUID() })).status, 403);
    const body = { action: "grant", requestId: randomUUID(), confirmation: `grant:${scope.linkedServerId}` };
    assert.equal((await invoke(ownerApi, env, actor, "POST", body, scope.linkedServerId, "https://foreign.test")).status, 403);
    assert.equal((await invoke(ownerApi, env, actor, "POST", { ...body, confirmation: "grant:other" })).status, 400);
    assert.equal((await invoke(ownerApi, env, actor, "POST", { ...body, unused: "x".repeat(3000) })).status, 413);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_showcase_grants").get()?.n, 0);
    const response = await invoke(ownerApi, env, actor, "POST", body); assert.equal(response.status, 200);
    const read = await invoke(ownerApi, env, actor, "GET"); assert.match(read.headers.get("cache-control")!, /no-store/);
    const payload = await read.json() as { effectiveGrantId: string; audit: Row[] };
    assert.equal(payload.effectiveGrantId, body.requestId); assert.equal(payload.audit.length, 1);
    assert.doesNotMatch(JSON.stringify(payload), /stripe|token|secret|password/i);
  });
  await test("support history remains accessible beyond the first page", async ({ db, env }) => {
    for (let i = 0; i < 27; i++) { const id = await grant(env); revokeSql(db, id); }
    const first = await readShowcaseGrantSupport(env, actor);
    const page1 = first.payload as { audit: Row[]; nextAuditCursor: number };
    assert.equal(page1.audit.length, 50); assert.ok(page1.nextAuditCursor > 0);
    const second = await readShowcaseGrantSupport(env, actor, page1.nextAuditCursor);
    const page2 = second.payload as { audit: Row[]; nextAuditCursor: number | null };
    assert.equal(page2.audit.length, 4); assert.equal(page2.nextAuditCursor, null);
    assert.equal(new Set([...page1.audit, ...page2.audit].map(row => row.sequence)).size, 54);
    assert.equal((await readShowcaseGrantSupport(env, actor, -1)).status, 400);
  });
  await test("actual gallery endpoints enforce exact ownership, limits and revocation", async ({ db, env }) => {
    assert.equal((await invoke(gallery, env, null, "GET")).status, 401);
    assert.equal((await invoke(gallery, env, other, "GET")).status, 404);
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [image] })).status, 403);
    const id = await grant(env);
    const read = await invoke(gallery, env, actor, "GET"); const payload = await read.json() as { canPublishGallery: boolean; serverAccess: Row };
    assert.equal(payload.canPublishGallery, true); assert.equal(payload.serverAccess.source, "complimentary_showcase");
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [image] })).status, 200);
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [image] }, "same-guild-other-server")).status, 403);
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [{ ...image, mimeType: "text/html" }] })).status, 400);
    revokeSql(db, id);
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [] })).status, 403);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_gallery_images").get()?.n, 1);
  });
  await test("gallery keeps original images when grant is revoked between read and write", async ({ db, env }) => {
    const id = await grant(env);
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [image] })).status, 200);
    db.beforeBatch = () => { db.beforeBatch = null; revokeSql(db, id); };
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [] })).status, 409);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_gallery_images").get()?.n, 1);
  });
  await test("gallery rejects an expired grant at transaction start without deleting original images", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db);
    db.sqlite.prepare(`INSERT INTO server_gallery_images (
      id, server_id, url, width, height, size_bytes, mime_type, sort_order, created_at, updated_at
    ) VALUES ('previous-image', ?, 'https://local.test/previous.jpg', 1600, 900, 1000, 'image/jpeg', 0, '2026-09-01', '2026-09-01')`)
      .run(scope.linkedServerId);
    db.beforeBatch = () => { db.beforeBatch = null; waitUntilAfter(expiresAt); };
    const response = await invoke(gallery, env, actor, "PUT", { images: [image] });
    assert.equal(response.status, 409, JSON.stringify(await response.json()));
    assert.deepEqual(db.sqlite.prepare("SELECT id, url FROM server_gallery_images").all().map(row => row.url), ["https://local.test/previous.jpg"]);
  });
  await test("gallery rolls back when its grant expires during atomic replacement", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db);
    db.sqlite.prepare(`INSERT INTO server_gallery_images (
      id, server_id, url, width, height, size_bytes, mime_type, sort_order, created_at, updated_at
    ) VALUES ('previous-image', ?, 'https://local.test/previous.jpg', 1600, 900, 1000, 'image/jpeg', 0, '2026-09-01', '2026-09-01')`)
      .run(scope.linkedServerId);
    let expiredDuringBatch = false;
    db.beforeWrite = (sql) => {
      if (expiredDuringBatch || !/^\s*INSERT INTO server_gallery_images/i.test(sql)) return;
      expiredDuringBatch = true;
      waitUntilAfter(expiresAt);
    };
    try {
      const response = await invoke(gallery, env, actor, "PUT", { images: [image] });
      assert.equal(response.status, 409, JSON.stringify(await response.json()));
      assert.equal(expiredDuringBatch, true);
      assert.deepEqual(db.sqlite.prepare("SELECT id, url FROM server_gallery_images").all().map(row => row.url), ["https://local.test/previous.jpg"]);
    } finally {
      db.beforeWrite = null;
    }
  });
  await test("gallery replacement rolls back if an image insert fails", async ({ db, env }) => {
    await grant(env); await invoke(gallery, env, actor, "PUT", { images: [image] });
    const before = db.sqlite.prepare("SELECT * FROM server_gallery_images").all();
    db.sqlite.exec("CREATE TRIGGER synthetic_gallery_failure BEFORE INSERT ON server_gallery_images BEGIN SELECT RAISE(ABORT, 'synthetic image failure'); END;");
    await assert.rejects(invoke(gallery, env, actor, "PUT", { images: [image] }), /synthetic image failure/);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_gallery_images").all(), before);
  });
  await test("settings show complimentary listing separately from truthful billing and category rules", async ({ env }) => {
    await grant(env);
    const result = await readOwnerServerSettings(env, actor, scope.linkedServerId);
    assert.equal(result.status, 200);
    const payload = result.payload as { plan: Row; serverAccess: Row; listing: Row; categoryPolicy: Row };
    assert.equal(payload.plan.subscription_status, "canceled");
    assert.equal(payload.serverAccess.source, "complimentary_showcase"); assert.equal(payload.listing.canUseGallery, true);
    assert.equal(payload.categoryPolicy.cooldownDays, categoryPolicyForPlan("pro", "canceled").cooldownDays);
    assert.equal((await updateServerListing(env, other, scope.linkedServerId, { advertBannerUrl: image.url })).status, 403);
    assert.equal((await updateServerListing(env, actor, "same-guild-other-server", { advertBannerUrl: image.url })).status, 403);
    assert.equal((await updateServerListing(env, actor, scope.linkedServerId, { advertBannerUrl: image.url })).status, 200);
  });
  await test("listing edit rechecks grant at write time", async ({ db, env }) => {
    const id = await grant(env);
    db.beforeWrite = sql => { if (/UPDATE linked_servers SET\s+public_description/.test(sql)) { db.beforeWrite = null; revokeSql(db, id); } };
    assert.equal((await updateServerListing(env, actor, scope.linkedServerId, { advertBannerUrl: image.url })).status, 409);
    assert.equal(db.sqlite.prepare("SELECT advert_banner_url FROM linked_servers WHERE id = ?").get(scope.linkedServerId)?.advert_banner_url, null);
  });
  await test("write guard rejects changed billing and transferred owner", async ({ db, env }) => {
    const access = await readServerShowcaseAccess(env, "same-guild-other-server", inactive);
    const guard = await showcaseWriteGuard(env, "same-guild-other-server", actor.id, access);
    assert.equal(db.sqlite.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).get(...guard.values)?.allowed, 1);
    db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
    assert.equal(db.sqlite.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).get(...guard.values), undefined);
  });
  await test("write guard evaluates complimentary expiry when the protected statement executes", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db);
    const access = await readServerShowcaseAccess(env, scope.linkedServerId, inactive);
    const guard = await showcaseWriteGuard(env, scope.linkedServerId, actor.id, access);
    waitUntilAfter(expiresAt);
    assert.equal(db.sqlite.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).get(...guard.values), undefined);
  });
  await test("legacy paid customers preserve the original listing contract", async ({ db, env }) => {
    for (const plan of ["pro", "premium", "network", "partner"]) {
      db.sqlite.prepare("UPDATE server_subscriptions SET plan_key = ?, status = 'active'").run(plan);
      const response = await invoke(gallery, env, actor, "GET", undefined, "same-guild-other-server");
      const body = await response.json() as { canPublishGallery: boolean; serverAccess: Row };
      assert.equal(body.canPublishGallery, true, plan); assert.equal(body.serverAccess.source, "billing");
      const advertisingResponse = await invoke(advertisingBump, env, actor, "GET", undefined, "same-guild-other-server");
      const advertisingBody = await advertisingResponse.json() as {
        generated_at: string;
        advertising: { access_source: string; effective_listing_plan: string; bump_cooldown_days: number; included_bumps_per_month: number };
      };
      assert.match(advertisingBody.generated_at, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(advertisingBody.advertising.access_source, "billing", plan);
      assert.equal(advertisingBody.advertising.effective_listing_plan, "pro", plan);
      assert.equal(advertisingBody.advertising.bump_cooldown_days, 7, plan);
      assert.equal(advertisingBody.advertising.included_bumps_per_month, 2, plan);
    }
    assert.equal((await readShowcaseGrantSupport(env, other)).status, 403);
    assert.deepEqual(db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  });
  await test("foreign-owner guild billing cannot upgrade advertising access", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = ?, plan_key = 'pro', status = 'active'").run(other.discord_id);
    await upsertBillingAccount(env, { discordUserId: actor.discord_id, planKey: "free", planStatus: "free" });

    const readResponse = await invoke(advertisingBump, env, actor, "GET", undefined, "same-guild-other-server");
    assert.equal(readResponse.status, 200);
    const readBody = await readResponse.json() as {
      advertising: { access_source: string; effective_listing_plan: string; bump_cooldown_days: number; included_bumps_per_month: number };
      entitlements: { plan_key: string };
    };
    assert.equal(readBody.entitlements.plan_key, "free");
    assert.equal(readBody.advertising.access_source, "billing");
    assert.equal(readBody.advertising.effective_listing_plan, "free");
    assert.equal(readBody.advertising.bump_cooldown_days, 30);
    assert.equal(readBody.advertising.included_bumps_per_month, 1);

    const healthResponse = await invoke(dashboardHealth, env, actor, "GET", undefined, "same-guild-other-server");
    assert.equal(healthResponse.status, 200);
    const healthBody = await healthResponse.json() as {
      current_plan: string;
      server_access: { source: string; effectiveListingPlan: string };
    };
    assert.equal(healthBody.current_plan, "free");
    assert.equal(healthBody.server_access.source, "billing");
    assert.equal(healthBody.server_access.effectiveListingPlan, "free");

    const advancedResponse = await invoke(dashboardAdvancedStats, env, actor, "GET", undefined, "same-guild-other-server");
    assert.equal(advancedResponse.status, 200);
    const advancedBody = await advancedResponse.json() as {
      access: { source: string; effectivePlan: string; dashboardAnalytics: boolean };
      boards: Array<{ locked?: boolean; rows: unknown[] }>;
    };
    assert.equal(advancedBody.access.source, "billing");
    assert.equal(advancedBody.access.effectivePlan, "free");
    assert.equal(advancedBody.access.dashboardAnalytics, false);
    assert.ok(advancedBody.boards.every((board) => board.locked === true && board.rows.length === 0));

    const bumpResponse = await invoke(advertisingBump, env, actor, "POST", {}, "same-guild-other-server");
    assert.equal(bumpResponse.status, 200);
    const bumpBody = await bumpResponse.json() as {
      advertising: { access_source: string; effective_listing_plan: string; bump_cooldown_days: number; next_bump_at: string };
    };
    assert.equal(bumpBody.advertising.access_source, "billing");
    assert.equal(bumpBody.advertising.effective_listing_plan, "free");
    assert.equal(bumpBody.advertising.bump_cooldown_days, 30);
    assert.ok(Date.parse(bumpBody.advertising.next_bump_at) - Date.now() > 29 * 24 * 60 * 60 * 1000);
    assert.equal(db.sqlite.prepare("SELECT owner_discord_id FROM server_advertising_state WHERE linked_server_id = ?").get("same-guild-other-server")?.owner_discord_id, actor.discord_id);
  });
  await test("inactive Starter access is consistently locked across dashboard endpoints", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = ?, plan_key = 'starter', status = 'canceled'").run(actor.discord_id);

    const health = await (await invoke(dashboardHealth, env, actor, "GET", undefined, "same-guild-other-server")).json() as {
      current_plan: string;
      server_access: { source: string; effectiveListingPlan: string };
    };
    const advanced = await (await invoke(dashboardAdvancedStats, env, actor, "GET", undefined, "same-guild-other-server")).json() as {
      access: { source: string; effectivePlan: string; dashboardAnalytics: boolean };
    };
    const advertising = await (await invoke(advertisingBump, env, actor, "GET", undefined, "same-guild-other-server")).json() as {
      advertising: { access_source: string; effective_listing_plan: string };
    };

    assert.equal(health.current_plan, "free");
    assert.equal(health.server_access.source, "billing");
    assert.equal(health.server_access.effectiveListingPlan, "free");
    assert.equal(advanced.access.source, "billing");
    assert.equal(advanced.access.effectivePlan, "free");
    assert.equal(advanced.access.dashboardAnalytics, false);
    assert.equal(advertising.advertising.access_source, "billing");
    assert.equal(advertising.advertising.effective_listing_plan, "free");
  });
  await test("owner billing preserves paid access when a shared guild projection belongs to another owner", async ({ db, env }) => {
    db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = ?, plan_key = 'pro', status = 'active'").run(other.discord_id);
    await upsertBillingAccount(env, { discordUserId: actor.discord_id, planKey: "pro", planStatus: "active" });

    const serverId = "same-guild-other-server";
    const health = await (await invoke(dashboardHealth, env, actor, "GET", undefined, serverId)).json() as {
      current_plan: string;
      server_access: { source: string; effectiveListingPlan: string };
    };
    const advanced = await (await invoke(dashboardAdvancedStats, env, actor, "GET", undefined, serverId)).json() as {
      access: { source: string; effectivePlan: string; dashboardAnalytics: boolean };
    };
    const advertising = await (await invoke(advertisingBump, env, actor, "GET", undefined, serverId)).json() as {
      advertising: { access_source: string; effective_listing_plan: string };
    };

    assert.equal(health.current_plan, "pro");
    assert.equal(health.server_access.source, "billing");
    assert.equal(health.server_access.effectiveListingPlan, "pro");
    assert.equal(advanced.access.source, "billing");
    assert.equal(advanced.access.effectivePlan, "pro");
    assert.equal(advanced.access.dashboardAnalytics, true);
    assert.equal(advertising.advertising.access_source, "billing");
    assert.equal(advertising.advertising.effective_listing_plan, "pro");
    const bump = await invoke(advertisingBump, env, actor, "POST", {}, serverId);
    assert.equal(bump.status, 200);
    const bumpBody = await bump.json() as { advertising: { effective_listing_plan: string; bump_cooldown_days: number } };
    assert.equal(bumpBody.advertising.effective_listing_plan, "pro");
    assert.equal(bumpBody.advertising.bump_cooldown_days, 7);
  });
  await test("visual access uses exact grant, real sessions and canonical service aliases", async ({ db, env }) => {
    await grant(env);
    const before = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    assert.equal((await invoke(visualGet, env, null, "GET")).status, 401);
    assert.equal((await invoke(visualPut, env, other, "PUT", proVisual)).status, 403);
    const response = await invoke(visualGet, env, actor, "GET", undefined, scope.nitradoServiceId);
    assert.equal(response.status, 200);
    const body = await response.json() as { loadout: { access: Row }; limits: Row; server: Row; availableFrames: unknown[] };
    assert.equal(body.limits.maxShowcaseBadges, 8); assert.equal(body.availableFrames.length, Object.keys(getAvailableFrameVisuals()).length);
    assert.equal(body.loadout.access.source, "complimentary_showcase");
    assert.equal(body.server.subscriptionStatus, "canceled");
    assert.equal("grantId" in body.loadout.access, false);
    assert.equal((await invoke(visualPut, env, actor, "PUT", proVisual, scope.nitradoServiceId)).status, 200);
    assert.equal(db.sqlite.prepare("SELECT server_id FROM server_visual_loadouts").get()?.server_id, scope.linkedServerId);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").get()?.n, 1);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), before);
  });
  await test("visual grant never changes same-guild or other-owner server access", async ({ env }) => {
    await grant(env);
    for (const id of ["same-guild-other-server", "same-owner-other-guild", "foreign-owner-server"]) {
      const loadout = await resolveServerVisualLoadout(env, id);
      assert.equal(loadout.limits.maxShowcaseBadges, 3, id); assert.equal(loadout.animationEnabled, false, id);
      await assert.rejects(validateServerVisualLoadout(env, id, proVisual), /frame is not available/);
    }
    await assert.rejects(validateServerVisualLoadout(env, scope.linkedServerId, { ...proVisual, showcaseBadges: ["first_blood"] }), /must be earned/);
  });
  await test("inactive paid visual access fails closed and legacy paid plans remain supported", async ({ db, env }) => {
    for (const status of ["canceled", "past_due", "unpaid", "incomplete"]) {
      db.sqlite.prepare("UPDATE server_subscriptions SET status = ?").run(status);
      assert.equal((await resolveServerVisualLoadout(env, scope.linkedServerId)).limits.animationsAllowed, false);
    }
    for (const plan of ["pro", "premium", "network", "partner"]) {
      db.sqlite.prepare("UPDATE server_subscriptions SET plan_key = ?, status = 'active'").run(plan);
      assert.equal((await resolveServerVisualLoadout(env, "same-guild-other-server")).limits.maxShowcaseBadges, 8);
      assert.equal((await invoke(visualPut, env, actor, "PUT", proVisual, "same-guild-other-server")).status, 200);
    }
  });
  await test("visual grant grants slots, never badges or competitive progress", async ({ db, env }) => {
    const id = await grant(env);
    const codes = ["death_dealer", "long_shot_legend", "warlord", "trusted_server", "legacy_server", "veteran", "verified_server", "active_server"];
    assert.deepEqual(await getAvailableShowcaseBadgesForServer(env, scope.linkedServerId), []);
    for (const code of codes) db.sqlite.prepare(`INSERT INTO server_badge_awards
      (id, server_id, badge_code, awarded_at, award_type, source) VALUES (?, ?, ?, '2026-01-01', 'system', 'synthetic_test')`)
      .run(randomUUID(), scope.linkedServerId, code);
    const earned = await getAvailableShowcaseBadgesForServer(env, scope.linkedServerId);
    assert.equal(earned.length, 8);
    const before = db.sqlite.prepare("SELECT * FROM server_badge_awards ORDER BY id").all();
    const loadout = await saveServerVisualLoadout(env, scope.linkedServerId, actor.id, { ...proVisual, showcaseBadges: codes });
    assert.equal(loadout.showcaseBadges.length, 8);
    revokeSql(db, id);
    const publicLoadout = await resolvePublicServerVisualLoadout(env, scope.linkedServerId, "pro", earned, { ...visualFallback, showcaseBadges: earned });
    assert.equal(publicLoadout.showcaseBadges.length, 3);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_badge_awards ORDER BY id").all(), before);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM kill_events").get()?.n, 0);
  });
  await test("unapplied grant migration does not break ordinary visual access", async ({ env }) => {
    assert.equal((await resolveServerVisualLoadout(env, scope.linkedServerId)).limits.animationsAllowed, false);
    assert.equal((await invoke(visualPut, env, actor, "PUT", freeVisual)).status, 200);
  }, false);
  await test("saved public Pro visuals downgrade on revoke without deleting selections", async ({ db, env }) => {
    const id = await grant(env);
    await saveServerVisualLoadout(env, scope.linkedServerId, actor.id, proVisual);
    const before = db.sqlite.prepare("SELECT * FROM server_visual_loadouts").get();
    const active = await resolvePublicServerVisualLoadout(env, scope.linkedServerId, "free", [], visualFallback);
    assert.equal(active.profileFrame.key, "diamond"); assert.equal(active.themeBanner.key, "space");
    assert.equal(active.animationEnabled, true); assert.equal(active.cardStyle, "premium");
    revokeSql(db, id);
    const revoked = await resolvePublicServerVisualLoadout(env, scope.linkedServerId, "premium", [], visualFallback);
    assert.equal(revoked.profileFrame.key, "bronze"); assert.equal(revoked.themeBanner.key, "apocalypse");
    assert.equal(revoked.animationEnabled, false); assert.equal(revoked.cardStyle, "standard");
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_visual_loadouts").get(), before);
    assert.equal((await invoke(visualPut, env, actor, "PUT", proVisual)).status, 400);
    db.sqlite.prepare("UPDATE linked_servers SET status = 'suspended' WHERE id = ?").run(scope.linkedServerId);
    assert.equal((await resolvePublicServerVisualLoadout(env, scope.linkedServerId, "pro", [], visualFallback)).animationEnabled, false);
  });
  await test("public visual fallback obeys plan limits and earned badge provenance", async ({ env }) => {
    const unearned = { code: "not-earned", isPublic: true } as Awaited<ReturnType<typeof getAvailableShowcaseBadgesForServer>>[number];
    const fallback = { ...visualFallback, showcaseBadges: [unearned] };
    const result = await resolvePublicServerVisualLoadout(env, "same-guild-other-server", "free", [], fallback);
    assert.deepEqual(result.showcaseBadges, []); assert.equal(result.profileFrame.key, "bronze");
    assert.equal(result.animationEnabled, false);
  });
  for (const mutation of ["revoke", "owner", "billing", "selection"]) {
    await test(`visual transaction rejects changed ${mutation} without audit or overwrite`, async ({ db, env }) => {
      const id = await grant(env);
      if (mutation === "billing") {
        revokeSql(db, id); db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
      }
      await saveServerVisualLoadout(env, scope.linkedServerId, actor.id, proVisual);
      db.beforeBatch = () => {
        db.beforeBatch = null;
        if (mutation === "revoke") revokeSql(db, id);
        if (mutation === "owner") db.sqlite.prepare("UPDATE linked_servers SET user_id = ? WHERE id = ?").run(other.id, scope.linkedServerId);
        if (mutation === "billing") db.sqlite.exec("UPDATE server_subscriptions SET status = 'canceled'");
        if (mutation === "selection") db.sqlite.exec("UPDATE server_visual_loadouts SET theme_banner_key = 'chernarus'");
      };
      const response = await invoke(visualPut, env, actor, "PUT", { ...proVisual, profileFrameKey: "gold" });
      assert.equal(response.status, 409);
      assert.equal(db.sqlite.prepare("SELECT profile_frame_key FROM server_visual_loadouts").get()?.profile_frame_key, "diamond");
      assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").get()?.n, 1);
    });
  }
  await test("visual transaction rejects an expired grant before audit or overwrite", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db);
    await saveServerVisualLoadout(env, scope.linkedServerId, actor.id, proVisual);
    db.beforeBatch = () => { db.beforeBatch = null; waitUntilAfter(expiresAt); };
    const response = await invoke(visualPut, env, actor, "PUT", { ...proVisual, profileFrameKey: "gold" });
    assert.equal(response.status, 409);
    assert.equal(db.sqlite.prepare("SELECT profile_frame_key FROM server_visual_loadouts").get()?.profile_frame_key, "diamond");
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").get()?.n, 1);
  });
  await test("visual transaction rolls back when its grant expires during the save", async ({ db, env }) => {
    const { expiresAt } = grantExpiring(db);
    await saveServerVisualLoadout(env, scope.linkedServerId, actor.id, proVisual);
    let expiredDuringBatch = false;
    db.beforeWrite = (sql) => {
      if (expiredDuringBatch || !/^\s*INSERT INTO server_visual_loadouts/i.test(sql)) return;
      expiredDuringBatch = true;
      waitUntilAfter(expiresAt);
    };
    try {
      const response = await invoke(visualPut, env, actor, "PUT", { ...proVisual, profileFrameKey: "gold" });
      assert.equal(response.status, 409);
      assert.equal(expiredDuringBatch, true);
      assert.equal(db.sqlite.prepare("SELECT profile_frame_key FROM server_visual_loadouts").get()?.profile_frame_key, "diamond");
      assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").get()?.n, 1);
    } finally {
      db.beforeWrite = null;
    }
  });
  await test("visual save checks owner snapshot from route authorization", async ({ db, env }) => {
    await grant(env);
    db.sqlite.prepare("UPDATE linked_servers SET user_id = ? WHERE id = ?").run(other.id, scope.linkedServerId);
    await assert.rejects(saveServerVisualLoadout(env, scope.linkedServerId, actor.id, freeVisual, actor.id), /access changed/);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_visual_loadouts").get()?.n, 0);
  });
  for (const failedTable of ["server_customisation_audit_log", "server_visual_loadouts"]) {
    await test(`visual save rolls back fully when ${failedTable} fails`, async ({ db, env }) => {
      await grant(env);
      await saveServerVisualLoadout(env, scope.linkedServerId, actor.id, proVisual);
      const before = db.sqlite.prepare("SELECT * FROM server_visual_loadouts").get();
      db.sqlite.exec(`CREATE TRIGGER synthetic_visual_failure BEFORE INSERT ON ${failedTable} BEGIN SELECT RAISE(ABORT, 'synthetic save failure'); END`);
      await assert.rejects(saveServerVisualLoadout(env, scope.linkedServerId, actor.id, { ...proVisual, profileFrameKey: "gold" }), /synthetic save failure/);
      assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_visual_loadouts").get(), before);
      assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").get()?.n, 1);
    });
  }
  await test("public grant unlocks exact media and discovery without billing, scores or badge awards", async ({ db, env }) => {
    seedPublicMedia(db);
    const before = await publicProfile(env);
    const neighbors = await Promise.all(["same-guild-other-server", "same-owner-other-guild", "foreign-owner-server"].map(id => publicProfile(env, id)));
    const billing = db.sqlite.prepare("SELECT * FROM server_subscriptions").all();
    const awards = db.sqlite.prepare("SELECT * FROM server_badge_awards").all();
    assert.equal(before.plan_key, "free"); assert.equal(before.gallery_images.length, 0);
    assert.ok(before.total_kills > 0);
    await grant(env);
    const active = await publicProfile(env);
    assert.equal(active.plan_key, "pro"); assert.equal(active.server_access?.source, "complimentary_showcase");
    assert.equal(active.gallery_images.length, 1); assert.equal(active.advert_banner_url, image.url);
    assert.equal(active.owner_announcement, "Synthetic owner announcement");
    assert.equal(active.isFeaturedEligible, true); assert.ok(active.discoveryScore > before.discoveryScore);
    for (const key of ["score", "rank", "score_breakdown", "reputation", "earnedBadges", "achievement_showcase", "stats", "premium_status"] as const)
      assert.deepEqual(active[key], before[key], key);
    for (const neighbor of neighbors) assert.deepEqual(await publicProfile(env, neighbor.linked_server_id), neighbor);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_subscriptions").all(), billing);
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_badge_awards").all(), awards);
    for (const privateValue of [scope.ownerUserId, scope.ownerDiscordId, "cus_synthetic", "sub_synthetic", "grantId", "billingStatus"])
      assert.equal(JSON.stringify(active).includes(privateValue), false, privateValue);
    assert.equal(publicListingPlanLabel(active.server_access?.source), "Pro Listing (complimentary)");
    assert.equal(publicListingPlanLabel("billing"), "Pro Listing");
    assert.equal(publicVisibilityTierLabel("premium", active.server_access?.source), "Pro Listing (complimentary)");
    assert.equal(publicVisibilityTierLabel("premium", "billing"), "Pro");
    assert.equal(publicVisibilityTierLabel("premium", undefined), "Pro");
    assert.equal(publicVisibilityTierLabel("enhanced", "billing"), "Enhanced");
    assert.equal(publicVisibilityTierLabel("standard", "billing"), "Standard");
    assert.equal(formatPublicVisibilitySummary("Premium visibility", active.server_access?.source), "Pro (complimentary) visibility");
    assert.equal(formatPublicVisibilitySummary("Pro visibility", active.server_access?.source), "Pro (complimentary) visibility");
    assert.equal(formatPublicVisibilitySummary("Premium visibility", "billing"), "Pro visibility");
    assert.equal(formatPublicVisibilitySummary("Standard visibility", undefined), "Standard visibility");
    assert.equal(formatPublicVisibilitySummary(null, active.server_access?.source), null);
    const directory = await getPublicServersPayload(env, null, false);
    assert.ok("spotlightServers" in directory && "featuredServers" in directory);
    const highlighted = [...directory.spotlightServers, ...directory.featuredServers].find(server => server.linked_server_id === scope.linkedServerId);
    assert.ok(highlighted, "The real directory must exercise a featured or spotlight card");
    assert.equal(publicVisibilityTierLabel(highlighted.visibilityTier, highlighted.server_access?.source), "Pro Listing (complimentary)");
    assert.match(formatPublicVisibilitySummary(highlighted.visibilityExplanation.summary, highlighted.server_access?.source) ?? "", /Pro \(complimentary\)/);
  });
  await test("public preview retains login locks while presenting complimentary media", async ({ db, env }) => {
    seedPublicMedia(db); await grant(env);
    const preview = await publicProfile(env, scope.linkedServerId, false);
    assert.equal(preview.plan_key, "pro"); assert.equal(preview.is_locked, true);
    assert.equal(preview.gallery_images.length, 1); assert.equal(preview.total_deaths, 0);
    assert.deepEqual(preview.recent_events, []); assert.deepEqual(preview.pvp_leaderboard, []);
    assert.equal(preview.public_discord_invite, null); assert.equal(preview.last_sync_at, null);
    const directory = await getPublicServersPayload(env, null, false);
    assert.ok("servers" in directory);
    assert.equal(directory.servers.find(server => server.linked_server_id === scope.linkedServerId)?.plan_key, "pro");
    assert.equal(directory.servers.find(server => server.linked_server_id === "same-guild-other-server")?.plan_key, "free");
  });
  await test("public grant revoke hides media but preserves it and real legacy paid access", async ({ db, env }) => {
    seedPublicMedia(db); const id = await grant(env);
    const stored = db.sqlite.prepare("SELECT * FROM server_gallery_images ORDER BY id").all();
    revokeSql(db, id);
    const revoked = await publicProfile(env);
    assert.equal(revoked.plan_key, "free"); assert.equal(revoked.advert_banner_url, null);
    assert.equal(revoked.owner_announcement, null); assert.deepEqual(revoked.gallery_images, []);
    assert.equal(revoked.isFeaturedEligible, false);
    for (const plan of ["pro", "premium", "network", "partner"]) {
      db.sqlite.prepare("UPDATE server_subscriptions SET status = 'active', plan_key = ?").run(plan);
      const paid = await publicProfile(env);
      assert.equal(paid.plan_key, "pro"); assert.equal(paid.server_access?.source, "billing");
      assert.equal(paid.gallery_images.length, 1);
    }
    assert.deepEqual(db.sqlite.prepare("SELECT * FROM server_gallery_images ORDER BY id").all(), stored);
  });
  await test("public reads tolerate unapplied grant migration without paid access", async ({ db, env }) => {
    seedPublicMedia(db);
    const value = await publicProfile(env);
    assert.equal(value.plan_key, "free"); assert.deepEqual(value.gallery_images, []);
  }, false);
  for (const state of ["revoked", "hidden", "transferred", "expired", "unavailable"]) {
    await test(`cached public showcase rechecks ${state} while retaining unrelated servers`, async ({ db, env }) => {
      seedPublicMedia(db); const id = await grant(env);
      const current = await publicProfile(env);
      const neighbor = await publicProfile(env, "same-guild-other-server");
      const cached = { servers: [current, neighbor], featuredServers: [current], stats: { totalServers: 2 }, data: { server: current } };
      const original = JSON.stringify(cached);
      if (state === "revoked") revokeSql(db, id);
      if (state === "hidden") db.sqlite.prepare("UPDATE linked_servers SET listing_visibility = 'hidden' WHERE id = ?").run(scope.linkedServerId);
      if (state === "transferred") db.sqlite.prepare("UPDATE linked_servers SET user_id = ? WHERE id = ?").run(other.id, scope.linkedServerId);
      if (state === "expired") {
        revokeSql(db, id);
        db.sqlite.prepare(`INSERT INTO server_showcase_grants (id, linked_server_id, owner_user_id, owner_discord_id, guild_id,
          nitrado_service_id, created_by_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2020-01-01', '2020-02-01')`)
          .run(randomUUID(), scope.linkedServerId, scope.ownerUserId, scope.ownerDiscordId, scope.guildId, scope.nitradoServiceId, actor.id);
      }
      const checkedEnv = state === "unavailable" ? { ...env, DB: { prepare: () => { throw new Error("Synthetic database unavailable"); } } as unknown as D1Database } : env;
      const result = await refreshPublicShowcaseSnapshot(checkedEnv, cached, false) as { servers: typeof current[]; featuredServers: typeof current[]; data: { server: typeof current | null }; stats: { totalServers: number } };
      assert.equal(JSON.stringify(cached), original, "Do not mutate persisted snapshot input");
      assert.deepEqual(result.servers.find(server => server.linked_server_id === neighbor.linked_server_id), neighbor);
      const target = result.servers.find(server => server.linked_server_id === scope.linkedServerId);
      if (state === "hidden" || state === "unavailable") {
        assert.equal(target, undefined); assert.equal(result.data.server, null); assert.equal(result.stats.totalServers, 1);
      } else {
        assert.equal(target?.plan_key, "free"); assert.deepEqual(target?.gallery_images, []);
        assert.equal(target?.is_locked, true); assert.equal(target?.total_deaths, 0);
      }
      assert.equal(result.featuredServers.some(server => server.linked_server_id === scope.linkedServerId), false);
    });
  }
  await test("snapshot without target performs no added query", async () => {
    const payload = { server: { linked_server_id: "unrelated", gallery_images: [null] } };
    const env = { DB: { prepare: () => { throw new Error("Unexpected query"); } } as unknown as D1Database } as Env;
    assert.equal(await refreshPublicShowcaseSnapshot(env, payload, false), payload);
  });
  await test("real public handler rebuilds stale target after a live slug query fails", async ({ db, env }) => {
    seedPublicMedia(db); const id = await grant(env);
    const request = new Request(`https://local.test/api/public/servers?slug=${scope.linkedServerId}`);
    const invokePublic = (targetEnv: Env) => publicServers({ env: targetEnv, request, params: {}, waitUntil: () => {}, next: async () => new Response(), data: {} } as Parameters<PagesFunction>[0]);
    assert.equal((await invokePublic(env)).status, 200);
    revokeSql(db, id);
    const wrapper = { prepare(sql: string) {
      if (sql.includes("WHERE lower(linked_servers.public_slug) = ?")) throw new Error("Synthetic live slug query failure");
      return db.prepare(sql);
    } } as unknown as D1Database;
    const response = await invokePublic({ ...env, DB: wrapper });
    const body = await response.json() as { source: string; server: Awaited<ReturnType<typeof publicProfile>> };
    assert.equal(body.source, "snapshot"); assert.equal(body.server.plan_key, "free");
    assert.deepEqual(body.server.gallery_images, []); assert.equal(body.server.is_locked, true);
  });
  console.log(`PASS ${passed} populated showcase test scenarios; no external calls`);
  if (process.env.DZN_SHOWCASE_QA_OUTPUT) {
    const f = await fixture();
    try {
      const dir = process.env.DZN_SHOWCASE_QA_OUTPUT;
      mkdirSync(dir, { recursive: true });
      const id = await grant(f.env);
      for (const state of ["complimentary", "revoked", "paid"]) {
        if (state === "revoked") revokeSql(f.db, id);
        if (state === "paid") f.db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
        const payload = await (await invoke(visualGet, f.env, actor, "GET")).json();
        writeFileSync(join(dir, `${state}.json`), JSON.stringify(payload, null, 2));
      }
      seedPublicMedia(f.db);
      f.db.sqlite.exec("UPDATE server_subscriptions SET status = 'canceled'");
      const publicGrant = await grant(f.env);
      for (const state of ["public-complimentary", "public-revoked", "public-paid"]) {
        if (state === "public-revoked") revokeSql(f.db, publicGrant);
        if (state === "public-paid") f.db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
        writeFileSync(join(dir, `${state}.json`), JSON.stringify(await getPublicServersPayload(f.env, scope.linkedServerId, false), null, 2));
        writeFileSync(join(dir, `${state}-directory.json`), JSON.stringify(await getPublicServersPayload(f.env, null, false), null, 2));
      }
    } finally { f.db.sqlite.close(); }
  }
  await runLocalD1();
}

async function runLocalD1() {
  const fixtureDb = await fixture();
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }",
    compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only local workerd IPC is allowed");
    return originalFetch(input, init);
  };
  try {
    const db = await mf.getD1Database("DB");
    const tables = ["users", "discord_guilds", "linked_servers", "server_subscriptions", "sessions",
      "server_gallery_images", "server_showcase_grants", "server_showcase_grant_audit",
      "server_visual_loadouts", "server_customisation_audit_log", "server_badge_awards"];
    const schema = fixtureDb.db.sqlite.prepare(`SELECT name, tbl_name, type, sql FROM sqlite_master WHERE sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`).all();
    for (const row of schema) if (tables.includes(String(row.tbl_name))) await db.prepare(String(row.sql)).run();
    for (const table of tables) {
      for (const row of fixtureDb.db.sqlite.prepare(`SELECT * FROM ${table}`).all()) {
        const columns = Object.keys(row); columns.forEach(column => assert.match(column, /^[a-z_]+$/));
        await db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .bind(...Object.values(row)).run();
      }
    }
    const env = { ...fixtureDb.env, DB: db as unknown as D1Database };
    const results = await Promise.all(Array.from({ length: 8 }, () => changeShowcaseGrant(env, actor, { action: "grant", requestId: randomUUID() })));
    assert.ok(results.every(result => result.status === 200));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM server_showcase_grants").first())?.n, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM server_showcase_grant_audit").first())?.n, 1);
    const access = await readServerShowcaseAccess(env, scope.linkedServerId, inactive);
    assert.equal(access.source, "complimentary_showcase");
    assert.equal((await invoke(gallery, env, actor, "PUT", { images: [image] })).status, 200);
    assert.equal((await invoke(visualPut, env, actor, "PUT", proVisual)).status, 200);
    const visualBefore = (await db.prepare("SELECT * FROM server_visual_loadouts").all()).results;
    await db.prepare("CREATE TRIGGER synthetic_visual_failure BEFORE INSERT ON server_visual_loadouts BEGIN SELECT RAISE(ABORT, 'synthetic save failure'); END").run();
    await assert.rejects(saveServerVisualLoadout(env, scope.linkedServerId, actor.id, { ...proVisual, profileFrameKey: "gold" }), /synthetic save failure/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").first())?.n, 1);
    await db.prepare("DROP TRIGGER synthetic_visual_failure").run();
    const imagesBefore = (await db.prepare("SELECT * FROM server_gallery_images").all()).results;
    const grantsBefore = (await db.prepare("SELECT * FROM server_showcase_grants").all()).results;
    await db.prepare("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON server_showcase_grant_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END").run();
    await assert.rejects(changeShowcaseGrant(env, actor, { action: "revoke", grantId: access.grantId!, reason: "support_correction" }), /synthetic audit failure/);
    assert.deepEqual((await db.prepare("SELECT * FROM server_showcase_grants").all()).results, grantsBefore);
    await db.prepare("DROP TRIGGER synthetic_audit_failure").run();
    const wrapper = { prepare: db.prepare.bind(db), batch: async (statements: D1PreparedStatement[]) => {
      await changeShowcaseGrant(env, actor, { action: "revoke", grantId: access.grantId!, reason: "owner_request" });
      return db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    } } as unknown as D1Database;
    assert.equal((await invoke(gallery, { ...env, DB: wrapper }, actor, "PUT", { images: [] })).status, 409);
    const visualGrantId = await grant(env);
    const visualWrapper = { prepare: db.prepare.bind(db), batch: async (statements: D1PreparedStatement[]) => {
      await changeShowcaseGrant(env, actor, { action: "revoke", grantId: visualGrantId, reason: "owner_request" });
      return db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
    } } as unknown as D1Database;
    assert.equal((await invoke(visualPut, { ...env, DB: visualWrapper }, actor, "PUT", { ...proVisual, profileFrameKey: "gold" })).status, 409);
    assert.deepEqual((await db.prepare("SELECT * FROM server_visual_loadouts").all()).results, visualBefore);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM server_customisation_audit_log").first())?.n, 1);
    assert.deepEqual((await db.prepare("SELECT * FROM server_gallery_images").all()).results, imagesBefore);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM server_showcase_grant_audit").first())?.n, 4);
    assert.equal((await db.prepare("SELECT status FROM server_subscriptions").first())?.status, "canceled");
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("PASS local workerd/D1: concurrent grants, gallery/visual writes, atomic audit rollback and revocation races; billing untouched");
  } finally { await mf.dispose(); fixtureDb.db.sqlite.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { globalThis.fetch = originalFetch; });
