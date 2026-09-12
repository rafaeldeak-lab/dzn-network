import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCheckoutFixture } from "./fixtures/billing-checkout";
import { ensureBillingSchema, ensureStarterTrialClaimSchema } from "../functions/_lib/plans";
import { createSession } from "../functions/_lib/db";
import { canShowPaymentSetupNotice } from "../functions/_lib/billing-reminders";
import { listUserNotifications, countUnreadNotifications, markNotificationRead, markAllNotificationsRead, clearReadNotifications } from "../functions/_lib/dzn-pulse";
import { onRequestPost as refresh, onRequestGet as invalidGet } from "../functions/api/dzn-pulse/notifications/refresh-billing";
import { onRequestGet as list } from "../functions/api/dzn-pulse/notifications";
import type { Env, PagesFunction, SessionUser } from "../functions/_lib/types";

const user: SessionUser = { id: "owner", discord_id: "discord-owner", username: "Owner", avatar: null };
const other: SessionUser = { id: "other", discord_id: "discord-other", username: "Other", avatar: null };

async function fixture() {
  const { db, env } = createCheckoutFixture();
  db.sqlite.exec(readFileSync("migrations/0001_initial_schema.sql", "utf8"));
  db.sqlite.exec(`
    ALTER TABLE linked_servers ADD COLUMN merged_into_server_id TEXT;
    ALTER TABLE linked_servers ADD COLUMN display_name TEXT;
    ALTER TABLE linked_servers ADD COLUMN hostname TEXT;
    CREATE TABLE competitive_events (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE server_subscriptions (id TEXT PRIMARY KEY, guild_id TEXT, owner_discord_id TEXT, plan_key TEXT, status TEXT);
    INSERT INTO users (id, discord_id, username) VALUES ('owner', 'discord-owner', 'Owner'), ('other', 'discord-other', 'Other');
    INSERT INTO linked_servers (id, user_id, guild_id, discord_guild_id, server_name, server_type, nitrado_service_id, status)
      VALUES ('server', 'owner', 'guild', 'guild-row', 'Synthetic server', 'PVE', '12345', 'pending');
  `);
  db.sqlite.exec(readFileSync("migrations/0052_dzn_pulse.sql", "utf8"));
  await ensureBillingSchema(env);
  await ensureStarterTrialClaimSchema(env);
  env.DZN_PULSE_ENABLED = "true";
  env.DZN_BILLING_REMINDERS_ENABLED = "true";
  const ownerSession = await createSession(env, user.id);
  const otherSession = await createSession(env, other.id);
  db.statements.length = 0;
  return { db, env, cookie: `dzn_session=${ownerSession.token}`, otherCookie: `dzn_session=${otherSession.token}` };
}

async function invoke(handler: PagesFunction, env: Env, cookie = "", origin: string | null = "https://local.test", body = {}) {
  return handler({ request: new Request("https://local.test/api/dzn-pulse/notifications/refresh-billing", {
    method: handler === invalidGet || handler === list ? "GET" : "POST",
    headers: { cookie, ...(origin === null ? {} : { origin }), "content-type": "application/json" },
    ...(handler === invalidGet || handler === list ? {} : { body: JSON.stringify(body) }),
  }), env } as Parameters<PagesFunction>[0]);
}

function protectedSnapshot(db: Awaited<ReturnType<typeof fixture>>["db"]) {
  return JSON.stringify(["users", "linked_servers", "owner_billing_accounts", "owner_plan_entitlements", "owner_starter_trial_claims", "billing_checkout_attempts", "server_subscriptions"]
    .map((table) => db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}

function assertNarrowWrites(statements: string[]) {
  for (const sql of statements.filter((text) => /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)/i.test(text))) {
    assert.match(sql, /^\s*(INSERT OR IGNORE INTO user_notifications|UPDATE user_notifications|DELETE FROM user_notifications)/i);
  }
}

async function main() {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error("No provider, analytics, email or Discord calls allowed"); };
  let cases = 0;
  try {
    for (const flag of [undefined, "false", "TRUE", "1"]) {
      const { db, env, cookie } = await fixture(); env.DZN_BILLING_REMINDERS_ENABLED = flag;
      assert.equal((await invoke(refresh, env, cookie)).status, 404);
      assert.equal(await canShowPaymentSetupNotice(env, user), false);
      assert.equal(db.statements.length, 0, "Disabled must not access billing or write notifications");
      db.sqlite.close(); cases++;
    }
    {
      const { db, env, cookie, otherCookie } = await fixture();
      assert.equal((await invoke(refresh, env)).status, 401);
      assert.equal((await invoke(list, env)).status, 401);
      assert.equal((await invoke(invalidGet, env, cookie)).status, 405);
      assert.equal((await invoke(refresh, env, cookie, "https://foreign.test")).status, 403);
      assert.equal((await invoke(refresh, env, cookie, null)).status, 403);
      env.MOCK_AUTH = "true";
      assert.equal((await invoke(refresh, env)).status, 401, "No mock-auth fallback for reminder writes");
      const before = protectedSnapshot(db);
      assert.equal((await invoke(refresh, env, otherCookie, "https://local.test", { user_id: user.id, discord_id: user.discord_id, server_id: "server" })).status, 200);
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM user_notifications").get()?.n, 0, "Player cannot target an owner in the body");
      const responses = await Promise.all(Array.from({ length: 8 }, () => invoke(refresh, env, cookie, "https://local.test", { user_id: other.id, title: "forged", action_url: "https://foreign.test" })));
      assert.ok(responses.every((r) => r.status === 200));
      assert.match(responses[0].headers.get("cache-control") ?? "", /private.*no-store/);
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM user_notifications").get()?.n, 1);
      const items = await listUserNotifications(env, user, { filter: "billing" });
      assert.equal(items.items.length, 1); assert.equal(items.unreadCount, 1);
      assert.equal(items.items[0].title, "Please set up payment");
      assert.equal(items.items[0].category, "billing");
      assert.match(items.items[0].body, /two-day trial, then GBP 2\/month/);
      assert.equal(items.items[0].action_url, "/pricing?intent=owner_setup&returnTo=%2Fsetup");
      assert.equal(items.items[0].server_id, null);
      const listed = await invoke(list, env, cookie);
      assert.equal(listed.status, 200);
      assert.match(listed.headers.get("cache-control") ?? "", /private.*no-store/);
      assert.deepEqual(items.items[0].metadata, { checkout_available: true });
      assert.doesNotMatch(JSON.stringify(items), /discord-owner|stripe_customer|stripe_subscription|first_claimed|params_json|sk_test/);
      assert.equal((await listUserNotifications(env, other)).items.length, 0);
      assert.equal(await countUnreadNotifications(env, other), 0);
      assert.equal((await markNotificationRead(env, other, items.items[0].id)).status, 404);
      assert.equal(await countUnreadNotifications(env, user), 1);
      assert.equal((await markNotificationRead(env, user, items.items[0].id)).status, 200);
      assert.equal(await countUnreadNotifications(env, user), 0);
      assert.equal((await clearReadNotifications(env, other)).cleared, 0);
      assert.equal((await clearReadNotifications(env, user)).cleared, 1);
      await invoke(refresh, env, cookie);
      assert.equal((await listUserNotifications(env, user)).items.length, 0, "Clearing cannot recreate the notice");
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM user_notifications").get()?.n, 1, "Single private delivery receipt retained");
      assert.equal(protectedSnapshot(db), before);
      assertNarrowWrites(db.statements);
      db.sqlite.close(); cases++;
    }
    const exclusions = [
      "DELETE FROM linked_servers",
      "UPDATE linked_servers SET user_id = 'other'",
      "UPDATE linked_servers SET status = 'deleted'",
      "UPDATE linked_servers SET status = 'merged'",
      "UPDATE linked_servers SET merged_into_server_id = 'canonical'",
      "UPDATE linked_servers SET nitrado_service_id = NULL",
      ...["free", "active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired"].map((status) =>
        `INSERT INTO owner_billing_accounts (id, discord_user_id, plan_key, plan_status, created_at, updated_at) VALUES ('account', 'discord-owner', 'starter', '${status}', 'now', 'now')`),
      ...["starter", "pro", "premium", "network", "partner", "unknown"].map((plan) =>
        `INSERT INTO owner_plan_entitlements (discord_user_id, plan_key, updated_at) VALUES ('discord-owner', '${plan}', 'now')`),
      "INSERT INTO owner_starter_trial_claims (id, discord_user_id, status, claimed_at, updated_at) VALUES ('claim', 'discord-owner', 'checkout_created', 'now', 'now')",
      "INSERT INTO owner_starter_trial_claims (id, discord_user_id, status, claimed_at, updated_at) VALUES ('claim', 'discord-owner', 'trial_started', 'now', 'now')",
      "INSERT INTO billing_checkout_attempts (id, discord_user_id, plan_key, stripe_mode, stripe_key_fingerprint, stripe_api_version, params_json, state, created_at, updated_at) VALUES ('attempt', 'discord-owner', 'starter', 'test', 'hash', 'version', '{}', 'prepared', 0, 0)",
      "INSERT INTO server_subscriptions VALUES ('sub', 'guild', 'discord-owner', 'premium', 'active')",
      "INSERT INTO server_subscriptions VALUES ('sub', 'other-guild', 'discord-owner', 'pro', 'active')",
      "INSERT INTO server_subscriptions VALUES ('sub', 'guild', 'former-owner', 'free', 'trialing')",
    ];
    for (const sql of exclusions) {
      const { db, env, cookie } = await fixture();
      await invoke(refresh, env, cookie);
      assert.equal(await countUnreadNotifications(env, user), 1);
      db.sqlite.exec(sql);
      const before = protectedSnapshot(db);
      assert.equal((await invoke(refresh, env, cookie)).status, 200);
      assert.equal(await canShowPaymentSetupNotice(env, user), false, sql);
      assert.equal((await listUserNotifications(env, user)).items.length, 0, "New billing state must hide old notice immediately");
      assert.equal(await countUnreadNotifications(env, user), 0);
      assert.equal(protectedSnapshot(db), before);
      assertNarrowWrites(db.statements);
      db.sqlite.close(); cases++;
    }
    {
      const { db, env, cookie } = await fixture();
      await invoke(refresh, env, cookie);
      env.STRIPE_SECRET_KEY = "sk_live_fixture";
      let items = await listUserNotifications(env, user);
      assert.match(items.items[0].body, /temporarily unavailable/);
      assert.match(items.items[0].body, /trial has not started/);
      assert.deepEqual(items.items[0].metadata, { checkout_available: false });
      env.DZN_BILLING_REMINDERS_ENABLED = "false";
      assert.equal((await listUserNotifications(env, user)).items.length, 0);
      assert.equal(await countUnreadNotifications(env, user), 0);
      env.DZN_BILLING_REMINDERS_ENABLED = "true";
      db.sqlite.exec("DROP TABLE billing_checkout_attempts");
      items = await listUserNotifications(env, user);
      assert.equal(items.items.length, 0, "Missing prerequisite schema fails closed without breaking ordinary Pulse");
      const result = await invoke(refresh, env, cookie);
      assert.equal(result.status, 503);
      assert.deepEqual(await result.json(), { ok: false, error: "billing_reminder_unavailable" });
      db.sqlite.close(); cases++;
    }
    {
      const { db, env, cookie } = await fixture();
      await invoke(refresh, env, cookie);
      db.sqlite.prepare("INSERT INTO user_notifications (id, user_id, type, title, body, dedupe_key) VALUES ('news', 'owner', 'dzn_news', 'News', 'News body', 'news')").run();
      assert.equal((await listUserNotifications(env, user, { filter: "news" })).items.length, 1);
      assert.equal((await listUserNotifications(env, user, { filter: "billing" })).items.length, 1);
      await markAllNotificationsRead(env, user);
      assert.equal(await countUnreadNotifications(env, user), 0);
      assert.equal((await clearReadNotifications(env, user)).cleared, 2);
      assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM user_notifications").get()?.n, 1);
      assertNarrowWrites(db.statements); db.sqlite.close(); cases++;
    }
    assert.equal(providerCalls, 0);
    console.log(`Private payment reminder: ${cases} eligibility, auth, privacy, dedupe, read/clear, stale-state and isolation groups passed; zero provider calls.`);
  } finally { globalThis.fetch = originalFetch; }
}

async function localD1Proof() {
  const { Miniflare } = await import("miniflare");
  const seed = await fixture();
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }",
    compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false });
  const originalFetch = globalThis.fetch;
  try {
    const db = await mf.getD1Database("DB");
    console.log("Local D1 emulator ready; copying synthetic schema and rows.");
    const schema = seed.db.sqlite.prepare(`SELECT name, type, sql FROM sqlite_master WHERE sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`).all();
    for (const row of schema) await db.prepare(String(row.sql)).run();
    const seedOrder = [...schema].sort((a, b) => Number(b.name === "users") - Number(a.name === "users"));
    for (const { name, type } of seedOrder) {
      if (type !== "table") continue;
      assert.match(String(name), /^[a-z_]+$/);
      for (const row of seed.db.sqlite.prepare(`SELECT * FROM "${name}"`).all()) {
        const columns = Object.keys(row);
        for (const column of columns) assert.match(column, /^[a-z_]+$/);
        await db.prepare(`INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .bind(...Object.values(row)).run();
      }
    }
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Local D1 emulator only");
      return originalFetch(input, init);
    };
    const env = { ...seed.env, DB: db as unknown as D1Database };
    console.log("Synthetic seed complete; checking eight concurrent owner refreshes.");
    const statuses = await Promise.all(Array.from({ length: 8 }, async () => (await invoke(refresh, env, seed.cookie)).status));
    assert.deepEqual(statuses, Array(8).fill(200));
    console.log("Concurrent writes returned successfully; checking private read and clear behavior.");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM user_notifications").first())?.n, 1);
    assert.equal((await listUserNotifications(env, user)).unreadCount, 1);
    assert.equal((await listUserNotifications(env, other)).items.length, 0);
    await markAllNotificationsRead(env, user);
    assert.equal((await clearReadNotifications(env, user)).cleared, 1);
    await invoke(refresh, env, seed.cookie);
    assert.equal((await listUserNotifications(env, user)).items.length, 0);
    for (const table of ["owner_billing_accounts", "owner_plan_entitlements", "owner_starter_trial_claims", "billing_checkout_attempts", "server_subscriptions"]) {
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first())?.n, 0);
    }
    assert.equal((await db.prepare("SELECT status FROM linked_servers WHERE id = 'server'").first())?.status, "pending");
    console.log("PASS actual local workerd/D1: eight concurrent authenticated refreshes yield one private receipt; read/clear/revisit cannot recreate it; billing and setup unchanged.");
  } finally { globalThis.fetch = originalFetch; await mf.dispose(); seed.db.sqlite.close(); }
}
(process.argv.includes("--d1") ? localD1Proof() : main()).catch((error) => { console.error(error); process.exitCode = 1; });
