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
    }
    assert.equal((await readShowcaseGrantSupport(env, other)).status, 403);
    assert.deepEqual(db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
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
