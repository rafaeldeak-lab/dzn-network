import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSession, getSessionUser } from "../functions/_lib/db";
import { handleStrongholdBootstrap } from "../functions/_lib/stronghold-bootstrap";
import { onRequest } from "../functions/api/stronghold/bootstrap";
import type { Env } from "../functions/_lib/types";
import { GamesLocalD1 } from "./lib/games-hub-local";

const serverId = "11111111-1111-4111-8111-111111111111";
const otherServerId = "22222222-2222-4222-8222-222222222222";
const guild = "200000000000000001";
const otherGuild = "200000000000000002";
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture() {
  const db = new GamesLocalD1();
  db.sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of ["0001_initial_schema.sql", "0012_billing_plans_and_advertising.sql", "0015_automation_pipeline.sql",
    "0041_owner_server_settings.sql", "0054_server_lifecycle_resource_control.sql", "0061_player_discord_community_memberships.sql"])
    db.sqlite.exec(readFileSync(`migrations/${migration}`, "utf8"));
  for (const [id, discordId] of [["owner", "100000000000000001"], ["member", "100000000000000002"],
    ["outsider", "100000000000000003"], ["free-owner", "100000000000000004"]]) {
    db.sqlite.prepare("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run(id, discordId, id);
  }
  const start = new Date(Date.now() - 86_400_000).toISOString();
  const end = new Date(Date.now() + 86_400_000).toISOString();
  const billing = db.sqlite.prepare(`INSERT INTO owner_billing_accounts
    (id, discord_user_id, stripe_customer_id, stripe_subscription_id, plan_key, plan_status, current_period_start, current_period_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  billing.run("owner-billing", "100000000000000001", "cus_test_owner", "sub_test_owner", "pro", "active", start, end);
  billing.run("member-billing", "100000000000000002", null, null, "free", "free", null, null);
  billing.run("free-owner-billing", "100000000000000004", null, null, "free", "free", null, null);
  const server = db.sqlite.prepare(`INSERT INTO linked_servers
    (id, user_id, guild_id, discord_guild_id, server_name, server_type, status, lifecycle_status)
    VALUES (?, ?, ?, ?, 'Synthetic test server', 'PVE', 'live', 'active_live')`);
  server.run(serverId, "owner", guild, "cached-guild-one");
  server.run(otherServerId, "free-owner", otherGuild, "cached-guild-two");
  db.sqlite.prepare(`INSERT INTO server_subscriptions
    (id, guild_id, owner_discord_id, stripe_customer_id, stripe_subscription_id, plan_key, status, current_period_start, current_period_end, created_at, updated_at)
    VALUES ('server-pro', ?, '100000000000000001', 'cus_test_owner', 'sub_test_owner', 'pro', 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(guild, start, end);
  const member = db.sqlite.prepare(`INSERT INTO player_discord_community_memberships
    (id, user_id, guild_id, guild_name, relationship, source, last_seen_at)
    VALUES (?, ?, ?, 'Synthetic community', 'member', 'discord_oauth_guilds', CURRENT_TIMESTAMP)`);
  member.run("member-one", "member", guild);
  member.run("owner-one", "owner", guild);
  member.run("member-two", "member", otherGuild);
  const env = { DB: db as unknown as D1Database, SESSION_SECRET: "isolated-stronghold-test-secret-not-production",
    DZN_STRONGHOLD_BOOTSTRAP_ENABLED: "true" } as Env;
  const cookies: Record<string, string> = {};
  for (const id of ["owner", "member", "outsider"]) cookies[id] = `dzn_session=${(await createSession(env, id)).token}`;
  return { db, env, cookies };
}

async function withFixture(action: (f: Fixture) => Promise<void>) {
  const f = await fixture();
  try { await action(f); } finally { f.db.sqlite.close(); }
}

function request(f: Fixture, options: { cookie?: string; query?: string; method?: string; origin?: string; headers?: Record<string, string> } = {}) {
  return new Request(`https://local.test/api/stronghold/bootstrap?${options.query ?? `serverId=${serverId}`}`, {
    method: options.method ?? "GET",
    headers: { cookie: options.cookie ?? f.cookies.member, ...(options.origin ? { origin: options.origin } : {}), ...options.headers },
  });
}

async function body(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  return response.json() as Promise<Record<string, unknown>>;
}

test("the actual route uses a genuine stored DZN session and permits a Free member of a Pro owner", () => withFixture(async f => {
  const response = await onRequest({ request: request(f), env: f.env, params: {}, data: {}, waitUntil: () => {}, next: async () => new Response() });
  const payload = await body(response, 200);
  assert.deepEqual(payload.user, { id: "member" });
  assert.deepEqual(payload.community, { id: serverId });
  assert.equal(payload.authority, "member");
  assert.equal(payload.gameplayReady, false);
  assert.equal(payload.readOnly, true);
  assert.deepEqual(payload.capabilities, { readBootstrap: true, play: false, contribute: false, manageBase: false, registerWar: false });
  assert.doesNotMatch(JSON.stringify(payload), /cus_test|sub_test|100000000000|200000000000|session_token|stripe|billing/i);
}));

test("absent, forged and expired sessions cannot access bootstrap", () => withFixture(async f => {
  await body(await handleStrongholdBootstrap(request(f, { cookie: "" }), f.env), 401);
  await body(await handleStrongholdBootstrap(request(f, { cookie: "dzn_session=forged" }), f.env), 401);
  f.db.sqlite.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE user_id = 'member'").run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 401);
}));

test("same-day expired ISO sessions are denied despite the inherited lexical comparison", () => withFixture(async f => {
  const expired = new Date();
  expired.setUTCHours(0, 0, 0, 0);
  assert.ok(expired.getTime() < Date.now());
  f.db.sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 'member'").run(expired.toISOString());
  // Reproduce the inherited bug, then prove the new route closes it locally.
  assert.equal((await getSessionUser(f.env, request(f)))?.id, "member");
  await body(await handleStrongholdBootstrap(request(f), f.env), 401);
}));

test("malformed, empty and timezone-less session expiries fail closed", () => withFixture(async f => {
  const today = new Date().toISOString().slice(0, 10);
  for (const expiry of ["not-a-date", "", `${today}T23:59:59`, `${today}T23:59:59+00:00`, "9999-02-30T12:00:00Z"]) {
    f.db.sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 'member'").run(expiry);
    await body(await handleStrongholdBootstrap(request(f), f.env), 401);
  }
}));

test("a second valid session cannot extend an expired cookie for the same user", () => withFixture(async f => {
  const expired = new Date();
  expired.setUTCHours(0, 0, 0, 0);
  f.db.sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 'member'").run(expired.toISOString());
  const validSession = await createSession(f.env, "member");
  await body(await handleStrongholdBootstrap(request(f, { cookie: `dzn_session=${validSession.token}` }), f.env), 200);
  await body(await handleStrongholdBootstrap(request(f), f.env), 401);
}));

test("ambiguous duplicate session hashes cannot borrow another account's expiry", () => withFixture(async f => {
  f.db.sqlite.prepare(`INSERT INTO sessions (id, user_id, session_token_hash, expires_at)
    SELECT 'duplicate-session', 'owner', session_token_hash, expires_at FROM sessions WHERE user_id = 'member'`).run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 401);
}));

test("bootstrap validity is also bounded by the exact session expiry", () => withFixture(async f => {
  const expiresAt = Date.now() + 60_000;
  f.db.sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 'member'").run(new Date(expiresAt).toISOString());
  const payload = await body(await handleStrongholdBootstrap(request(f), f.env), 200);
  assert.equal(payload.validUntil, expiresAt);
}));

test("the switch is absent by default and mock or unconfigured auth is unavailable", () => withFixture(async f => {
  delete f.env.DZN_STRONGHOLD_BOOTSTRAP_ENABLED;
  await body(await handleStrongholdBootstrap(request(f), f.env), 503);
  f.env.DZN_STRONGHOLD_BOOTSTRAP_ENABLED = "TRUE";
  await body(await handleStrongholdBootstrap(request(f), f.env), 503);
  f.env.DZN_STRONGHOLD_BOOTSTRAP_ENABLED = "true";
  f.env.MOCK_AUTH = "true";
  await body(await handleStrongholdBootstrap(request(f), f.env), 503);
  delete f.env.MOCK_AUTH;
  delete f.env.SESSION_SECRET;
  await body(await handleStrongholdBootstrap(request(f), f.env), 503);
  f.env.SESSION_SECRET = "isolated-stronghold-test-secret-not-production";
  f.db.sqlite.prepare("INSERT INTO users (id, discord_id, username) VALUES ('mock-user', '100000000000000099', 'Synthetic mock')").run();
  const mockSession = await createSession(f.env, "mock-user");
  await body(await handleStrongholdBootstrap(request(f, { cookie: `dzn_session=${mockSession.token}` }), f.env), 401);
}));

test("no mutation methods or cross-origin access are introduced", () => withFixture(async f => {
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await handleStrongholdBootstrap(request(f, { method }), f.env);
    await body(response, 405);
    assert.equal(response.headers.get("allow"), "GET");
  }
  await body(await handleStrongholdBootstrap(request(f, { origin: "https://foreign.test" }), f.env), 403);
  await body(await handleStrongholdBootstrap(request(f, { headers: { "sec-fetch-site": "cross-site" } }), f.env), 403);
  await body(await handleStrongholdBootstrap(request(f, { origin: "https://local.test" }), f.env), 200);
}));

test("client-supplied identities, plans, roles and duplicate server selectors are rejected", () => withFixture(async f => {
  for (const query of ["serverId=public-slug", "serverId=200000000000000001", "", `serverId=${serverId}&userId=owner`,
    `serverId=${serverId}&role=owner`, `serverId=${serverId}&plan=pro`, `serverId=${serverId}&serverId=${otherServerId}`]) {
    await body(await handleStrongholdBootstrap(request(f, { query }), f.env), 400);
  }
}));

test("switching to another canonical server cannot borrow the first server's Pro coverage", () => withFixture(async f => {
  const payload = await body(await handleStrongholdBootstrap(request(f, { query: `serverId=${otherServerId}` }), f.env), 403);
  assert.equal(payload.error, "COVERED_PRO_REQUIRED");
  await body(await handleStrongholdBootstrap(request(f, { query: "serverId=33333333-3333-4333-8333-333333333333" }), f.env), 404);
}));

test("another authenticated account cannot borrow a member's guild association", () => withFixture(async f => {
  const payload = await body(await handleStrongholdBootstrap(request(f, { cookie: f.cookies.outsider,
    headers: { "x-user-id": "owner", "x-role": "owner", "x-plan": "pro" } }), f.env), 403);
  assert.equal(payload.error, "MEMBERSHIP_REQUIRED");
}));

test("revoked, stale, future and non-OAuth membership evidence fails closed", () => withFixture(async f => {
  f.db.sqlite.prepare("UPDATE player_discord_community_memberships SET revoked_at = CURRENT_TIMESTAMP WHERE id = 'member-one'").run();
  assert.equal((await body(await handleStrongholdBootstrap(request(f), f.env), 403)).error, "MEMBERSHIP_REQUIRED");
  f.db.sqlite.prepare("UPDATE player_discord_community_memberships SET revoked_at = NULL, last_seen_at = datetime('now', '-16 minutes') WHERE id = 'member-one'").run();
  assert.equal((await body(await handleStrongholdBootstrap(request(f), f.env), 403)).error, "MEMBERSHIP_REFRESH_REQUIRED");
  f.db.sqlite.prepare("UPDATE player_discord_community_memberships SET last_seen_at = datetime('now', '+5 minutes') WHERE id = 'member-one'").run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
  f.db.sqlite.prepare("UPDATE player_discord_community_memberships SET last_seen_at = CURRENT_TIMESTAMP, source = 'public_directory' WHERE id = 'member-one'").run();
  assert.equal((await body(await handleStrongholdBootstrap(request(f), f.env), 403)).error, "MEMBERSHIP_REQUIRED");
}));

test("real owner authority is distinct from an administrator membership label", () => withFixture(async f => {
  f.db.sqlite.prepare("UPDATE player_discord_community_memberships SET relationship = 'administrator' WHERE id = 'member-one'").run();
  assert.equal((await body(await handleStrongholdBootstrap(request(f), f.env), 200)).authority, "member");
  const owner = await body(await handleStrongholdBootstrap(request(f, { cookie: f.cookies.owner }), f.env), 200);
  assert.equal(owner.authority, "owner");
  assert.deepEqual(owner.capabilities, { readBootstrap: true, play: false, contribute: false, manageBase: false, registerWar: false });
}));

test("a stale active server projection cannot override Free or lapsed owner billing", () => withFixture(async f => {
  f.db.sqlite.prepare("UPDATE owner_billing_accounts SET plan_key = 'free' WHERE id = 'owner-billing'").run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
  f.db.sqlite.prepare("UPDATE owner_billing_accounts SET plan_key = 'pro', current_period_end = '2000-01-01T00:00:00Z' WHERE id = 'owner-billing'").run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
}));

test("a server projection belonging to someone else is not covered", () => withFixture(async f => {
  f.db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = '100000000000000004' WHERE id = 'server-pro'").run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
  f.db.sqlite.prepare("UPDATE server_subscriptions SET owner_discord_id = '100000000000000001', stripe_subscription_id = 'sub_another' WHERE id = 'server-pro'").run();
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
}));

test("disabled, merged and missing-schema servers do not fall back to access", () => withFixture(async f => {
  f.db.sqlite.prepare("UPDATE linked_servers SET status = 'suspended' WHERE id = ?").run(serverId);
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
  f.db.sqlite.prepare("UPDATE linked_servers SET status = 'live', merged_into_server_id = ? WHERE id = ?").run(otherServerId, serverId);
  await body(await handleStrongholdBootstrap(request(f), f.env), 403);
  f.db.sqlite.exec("DROP TABLE player_discord_community_memberships");
  const failure = await body(await handleStrongholdBootstrap(request(f), f.env), 503);
  assert.deepEqual(failure, { error: "UNAVAILABLE" });
}));

test("successful and denied bootstrap requests cannot alter existing D1 state", () => withFixture(async f => {
  const before = f.db.sqlite.prepare("SELECT total_changes() AS changes").get()?.changes;
  const schemaBefore = f.db.sqlite.prepare("SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table'").get()?.tables;
  await body(await handleStrongholdBootstrap(request(f), f.env), 200);
  await body(await handleStrongholdBootstrap(request(f, { cookie: f.cookies.outsider }), f.env), 403);
  await body(await handleStrongholdBootstrap(request(f, { query: `serverId=${otherServerId}` }), f.env), 403);
  assert.equal(f.db.sqlite.prepare("SELECT total_changes() AS changes").get()?.changes, before);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table'").get()?.tables, schemaBefore);
}));
