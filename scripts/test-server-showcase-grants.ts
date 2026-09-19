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
  prepare(sql: string) {
    const statement = (values: unknown[] = []) => ({
      bind: (...args: unknown[]) => statement(args),
      run: async () => {
        this.beforeWrite?.(sql);
        if (/^\s*SELECT\b/i.test(sql)) return { success: true, results: this.sqlite.prepare(sql).all(...values), meta: { changes: 0 } };
        return { success: true, results: [], meta: this.sqlite.prepare(sql).run(...values) };
      },
      first: async () => this.sqlite.prepare(sql).get(...values) ?? null,
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
  await test("exact grant includes only NukeTown in Pro global advanced boards beyond the metadata window", async ({ db, env }) => {
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
    for (const [id, serverId, serviceId] of [
      ["nuketown-build", scope.linkedServerId, scope.nitradoServiceId],
      ["neighbor-build", "same-guild-other-server", "10000001"],
    ]) {
      db.sqlite.prepare(`INSERT INTO build_events (id, linked_server_id, nitrado_service_id, player_name, event_type,
        source_adm_file, source_line_number, occurred_at, raw_line)
        VALUES (?, ?, ?, 'Synthetic builder', 'built', 'synthetic.ADM', 1, '2026-09-19T00:00:00Z', 'synthetic')`)
        .run(id, serverId, serviceId);
    }
    await grant(env);

    const payload = await getPublicAdvancedLeaderboardsPayload(env, { limit: 20 });
    for (const metricKey of ["build_score", "balanced_activity_score"]) {
      const board = payload.boards.find((candidate) => candidate.metricKey === metricKey);
      assert.ok(board, `${metricKey} board required`);
      const nuketown = board.rows.find((row) => row.serverId === scope.linkedServerId);
      assert.ok(nuketown, `NukeTown must appear on ${metricKey}`);
      assert.equal(nuketown.isPremiumShowcase, true, metricKey);
      assert.equal(board.rows.some((row) => row.serverId === "same-guild-other-server"), false, `${metricKey} grant must remain exact-server`);
    }
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
    const guard = showcaseWriteGuard("same-guild-other-server", actor.id, access);
    assert.equal(db.sqlite.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).get(...guard.values)?.allowed, 1);
    db.sqlite.exec("UPDATE server_subscriptions SET status = 'active'");
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
