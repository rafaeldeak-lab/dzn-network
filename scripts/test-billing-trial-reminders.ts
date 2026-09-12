import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createWebhookFixture } from "./fixtures/billing-webhook";
import { createSession } from "../functions/_lib/db";
import { onRequest as webhook } from "../functions/api/stripe/webhook";
import { onRequestPost as refresh } from "../functions/api/dzn-pulse/notifications/refresh-billing";
import { currentTrialEndingNotice } from "../functions/_lib/billing-trial-reminders";
import { listUserNotifications, countUnreadNotifications, markNotificationRead, clearReadNotifications } from "../functions/_lib/dzn-pulse";
import type { Env, SessionUser } from "../functions/_lib/types";

const user: SessionUser = { id: "user-owner", discord_id: "discord-owner", username: "Owner", avatar: null };
const other: SessionUser = { ...user, id: "user-other", discord_id: "discord-other" };
const migration = readFileSync("migrations/0068_billing_trial_reminder_state.sql", "utf8");
const now = () => Math.floor(Date.now() / 1000);
const subscription = (overrides: Record<string, unknown> = {}) => ({ id: "sub_owner", object: "subscription", customer: "cus_owner", livemode: false,
  status: "trialing", metadata: { discord_user_id: user.discord_id, private_evidence: "must-not-leak" },
  current_period_start: now() - 86400, current_period_end: now() + 2592000, trial_end: now() + 3600,
  cancel_at_period_end: false, cancel_at: null, pause_collection: null,
  items: { data: [{ price: { id: "price_starter_fixture" } }] }, ...overrides });
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(withMigration = true) {
  const f = await createWebhookFixture();
  f.db.sqlite.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, session_token_hash TEXT, expires_at TEXT, created_at TEXT);
    ALTER TABLE users ADD COLUMN username TEXT; ALTER TABLE users ADD COLUMN avatar TEXT;
    ALTER TABLE linked_servers ADD COLUMN server_name TEXT; ALTER TABLE linked_servers ADD COLUMN display_name TEXT;
    ALTER TABLE linked_servers ADD COLUMN hostname TEXT; ALTER TABLE linked_servers ADD COLUMN nitrado_service_id TEXT;
    ALTER TABLE linked_servers ADD COLUMN nitrado_service_name TEXT;
    CREATE TABLE competitive_events (id TEXT PRIMARY KEY, name TEXT);
    UPDATE linked_servers SET nitrado_service_id = 'synthetic-service';`);
  f.db.sqlite.exec(readFileSync("migrations/0052_dzn_pulse.sql", "utf8"));
  if (withMigration) f.db.sqlite.exec(migration);
  const env: Env = { ...f.env, DZN_PULSE_ENABLED: "true", DZN_BILLING_REMINDERS_ENABLED: "true", DZN_BILLING_TRIAL_REMINDERS_ENABLED: "true" };
  const session = await createSession(env, user.id);
  const otherSession = await createSession(env, other.id);
  f.db.allWrites = []; f.db.writes = [];
  return { ...f, env, cookie: `dzn_session=${session.token}`, otherCookie: `dzn_session=${otherSession.token}` };
}
async function deliver(f: Fixture, id: string, expected = 200, signatureValid = true, bodyOverrides: Record<string, unknown> = {}) {
  const body = JSON.stringify({ id, type: "customer.subscription.updated", livemode: false,
    data: { object: { id: "sub_owner", object: "subscription", customer: "cus_owner", trial_end: 1, ...bodyOverrides } } });
  const time = now();
  const signature = createHmac("sha256", signatureValid ? f.env.STRIPE_WEBHOOK_SECRET! : "wrong").update(`${time}.${body}`).digest("hex");
  const response = await webhook({ env: f.env, request: new Request("https://local.test/api/stripe/webhook", { method: "POST", body,
    headers: { "stripe-signature": `t=${time},v1=${signature}` } }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null) });
  assert.equal(response.status, expected, await response.text());
}
async function visit(f: Fixture, cookie = f.cookie, body = {}) {
  return refresh({ env: f.env, request: new Request("https://local.test/api/dzn-pulse/notifications/refresh-billing", {
    method: "POST", headers: { cookie, origin: "https://local.test", "content-type": "application/json" }, body: JSON.stringify(body),
  }) } as Parameters<typeof refresh>[0]);
}
const count = (f: Fixture, table: string) => f.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
const captured = (f: Fixture) => f.db.sqlite.prepare("SELECT * FROM billing_trial_reminder_state WHERE discord_user_id = 'discord-owner'").get();
const protectedTables = ["users", "linked_servers", "owner_billing_accounts", "owner_plan_entitlements", "owner_starter_trial_claims", "server_subscriptions", "server_sync_state", "billing_webhook_versions", "billing_webhook_receipts", "billing_trial_reminder_state"];
const snapshot = (f: Fixture) => JSON.stringify(protectedTables.map(table => f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));

async function main() {
  const originalFetch = globalThis.fetch;
  let provider: () => Promise<Record<string, unknown>> = async () => subscription(); let reads = 0; let groups = 0;
  const fixtures: Fixture[] = [];
  async function make(migration = true) { const f = await fixture(migration); fixtures.push(f); return f; }
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.stripe.com/v1/subscriptions/sub_owner");
    assert.equal(init?.method, "GET", "No provider mutations"); reads++;
    return Response.json(await provider());
  };
  try {
    for (const flag of [undefined, "false", "TRUE", "1"]) {
      const f = await make(false); f.env.DZN_BILLING_TRIAL_REMINDERS_ENABLED = flag;
      await deliver(f, "evt_disabled"); assert.equal(await currentTrialEndingNotice(f.env, user), null);
      assert.equal(f.db.allWrites.some(sql => sql.includes("billing_trial_reminder_state")), false); groups++;
    }
    const f = await make(); const exactEnd = now() + 3600;
    provider = async () => subscription({ trial_end: exactEnd });
    await deliver(f, "evt_bad_signature", 400, false); assert.equal(count(f, "billing_trial_reminder_state"), 0);
    await Promise.all(Array.from({ length: 8 }, () => deliver(f, "evt_trial")));
    assert.equal(count(f, "billing_trial_reminder_state"), 1); assert.equal(count(f, "billing_webhook_receipts"), 1);
    assert.equal(captured(f)?.trial_end, exactEnd, "Ignore event body trial_end; use current verified provider object");
    assert.throws(() => f.db.sqlite.exec("INSERT INTO billing_trial_reminder_state SELECT * FROM billing_trial_reminder_state"), /UNIQUE/);
    for (const invalid of [-1, 0, 1.5, 253402300800]) {
      assert.throws(() => f.db.sqlite.exec(`UPDATE billing_trial_reminder_state SET trial_end = ${invalid}`), /CHECK/);
    }
    assert.equal(captured(f)?.trial_end, exactEnd); groups++;
    const writes = f.db.allWrites.length; const fetches = reads;
    await deliver(f, "evt_trial"); assert.equal(f.db.allWrites.length, writes); assert.equal(reads, fetches);
    const before = snapshot(f);
    const responses = await Promise.all(Array.from({ length: 8 }, () => visit(f, f.cookie, { user_id: other.id, trial_end: now() + 10 })));
    assert.ok(responses.every(r => r.status === 200)); assert.equal(count(f, "user_notifications"), 1);
    assert.match(responses[0].headers.get("cache-control") ?? "", /private.*no-store/);
    let result = await listUserNotifications(f.env, user, { filter: "billing" });
    assert.equal(result.items.length, 1); assert.equal(result.items[0].type, "billing_trial_ending");
    assert.equal(result.items[0].metadata.trial_ends_at, new Date(exactEnd * 1000).toISOString());
    assert.match(result.items[0].body, /UTC/); assert.equal(result.items[0].action_url, "/dashboard");
    assert.doesNotMatch(JSON.stringify(result), /cus_owner|sub_owner|discord-owner|must-not-leak|payload_hash|event_id.*evt_|sk_test|whsec/);
    assert.equal((await listUserNotifications(f.env, other)).items.length, 0);
    assert.equal((await markNotificationRead(f.env, other, result.items[0].id)).status, 404);
    assert.equal(await countUnreadNotifications(f.env, user), 1);
    await markNotificationRead(f.env, user, result.items[0].id);
    assert.equal((await clearReadNotifications(f.env, user)).cleared, 1);
    await visit(f); assert.equal((await listUserNotifications(f.env, user)).items.length, 0);
    assert.equal(count(f, "user_notifications"), 1); assert.equal(snapshot(f), before); assert.equal(reads, fetches);
    for (const sql of f.db.allWrites.slice(writes)) assert.match(sql, /^\s*(INSERT OR IGNORE INTO|UPDATE|DELETE FROM) user_notifications/);
    groups++;

    for (const value of [null, undefined, "123", "", 0, -1, 123.5, 253402300800, {}]) {
      const bad = await make(); provider = async () => subscription({ trial_end: value }); await deliver(bad, "evt_bad_date");
      assert.equal(captured(bad)?.trial_end, null); await visit(bad);
      assert.equal(count(bad, "user_notifications"), 0, "Never substitute billing-period end or visit time"); groups++;
    }
    for (const patch of [{ status: "active" }, { status: "canceled" }, { status: "past_due" }, { status: "unpaid" }, { status: "paused" },
      { cancel_at_period_end: true }, { cancel_at: now() + 1800 }, { pause_collection: { behavior: "void" } },
      { livemode: undefined }, { items: { data: [{ price: { id: "price_pro_fixture" } }] } }]) {
      const changed = await make(); provider = async () => subscription(); await deliver(changed, "evt_initial"); await visit(changed);
      assert.equal(await countUnreadNotifications(changed.env, user), 1);
      provider = async () => subscription(patch); await deliver(changed, "evt_changed");
      assert.equal(captured(changed)?.trial_end, null); assert.equal((await listUserNotifications(changed.env, user)).items.length, 0); groups++;
    }
    for (const [offset, visible] of [[86460, false], [86400, true], [60, true], [0, false], [-1, false]] as const) {
      f.db.sqlite.exec(`UPDATE billing_trial_reminder_state SET trial_end = unixepoch('now') + ${offset}`);
      assert.equal(Boolean(await currentTrialEndingNotice(f.env, user)), visible); groups++;
    }
    const stale = await make(); provider = async () => subscription(); await deliver(stale, "evt_stale_initial"); await visit(stale);
    stale.env.DZN_BILLING_TRIAL_REMINDERS_ENABLED = "false";
    provider = async () => subscription({ status: "canceled" }); await deliver(stale, "evt_flag_off_cancel");
    stale.env.DZN_BILLING_TRIAL_REMINDERS_ENABLED = "true";
    assert.equal(await currentTrialEndingNotice(stale.env, user), null);
    stale.db.sqlite.exec("UPDATE owner_billing_accounts SET plan_status = 'trialing'");
    assert.equal(await currentTrialEndingNotice(stale.env, user), null, "Revision mismatch blocks stale projection after flag-off updates"); groups++;

    const missing = await make(false); provider = async () => subscription(); await deliver(missing, "evt_missing_schema", 500);
    assert.equal(count(missing, "billing_webhook_receipts"), 0); assert.equal(count(missing, "owner_billing_accounts"), 0);
    assert.equal(await currentTrialEndingNotice(missing.env, user), null);
    missing.env.DZN_BILLING_TRIAL_REMINDERS_ENABLED = "false"; await deliver(missing, "evt_missing_schema"); groups++;

    const interrupted = await make();
    interrupted.db.sqlite.exec("CREATE TRIGGER fail_trial BEFORE INSERT ON billing_trial_reminder_state BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    await deliver(interrupted, "evt_rollback", 500); assert.equal(count(interrupted, "owner_billing_accounts"), 0);
    assert.equal(count(interrupted, "billing_webhook_receipts"), 0); assert.equal(count(interrupted, "billing_trial_reminder_state"), 0);
    interrupted.db.sqlite.exec("DROP TRIGGER fail_trial"); await deliver(interrupted, "evt_rollback"); groups++;
    interrupted.db.loseBatchResponse = true; await deliver(interrupted, "evt_lost_response");
    assert.equal(count(interrupted, "billing_trial_reminder_state"), 1); groups++;

    const extension = await make(); provider = async () => subscription(); await deliver(extension, "evt_original"); await visit(extension);
    provider = async () => subscription({ trial_end: now() + 172800 }); await deliver(extension, "evt_extension");
    assert.equal((await listUserNotifications(extension.env, user)).items.length, 0);
    provider = async () => subscription({ trial_end: now() + 7200 }); await deliver(extension, "evt_revised_deadline"); await visit(extension);
    result = await listUserNotifications(extension.env, user);
    assert.equal(result.items.length, 1); assert.equal(count(extension, "user_notifications"), 2, "One receipt per confirmed deadline; stale one hidden"); groups++;
    extension.db.sqlite.exec("UPDATE owner_billing_accounts SET stripe_subscription_id = 'sub_replacement'");
    assert.equal(await currentTrialEndingNotice(extension.env, user), null); groups++;

    const on = await make(); const off = await make(); off.env.DZN_BILLING_TRIAL_REMINDERS_ENABLED = "false";
    provider = async () => subscription(); await deliver(on, "evt_equivalence"); await deliver(off, "evt_equivalence");
    assert.deepEqual(on.db.allWrites.filter(sql => !sql.includes("billing_trial_reminder_state")), off.db.allWrites, "Enabling reminder capture cannot alter other billing write scope");
    for (const flag of ["DZN_PULSE_ENABLED", "DZN_BILLING_REMINDERS_ENABLED", "DZN_BILLING_TRIAL_REMINDERS_ENABLED"] as const) {
      on.env[flag] = "false"; assert.equal(await currentTrialEndingNotice(on.env, user), null); on.env[flag] = "true";
    }
    on.env.STRIPE_SECRET_KEY = "sk_live_synthetic"; assert.equal(await currentTrialEndingNotice(on.env, user), null, "Test projection cannot appear in live mode"); groups++;
    const foreign = await make(); provider = async () => subscription(); await deliver(foreign, "evt_owner_initial");
    const originalState = snapshot(foreign);
    provider = async () => subscription({ metadata: { discord_user_id: other.discord_id } });
    await deliver(foreign, "evt_foreign", 500); assert.equal(snapshot(foreign), originalState); groups++;
    foreign.db.sqlite.exec("INSERT INTO owner_billing_accounts (id, discord_user_id, stripe_customer_id, plan_key, plan_status, created_at, updated_at) VALUES ('ambiguous', 'discord-other', 'cus_owner', 'free', 'free', 'now', 'now')");
    assert.equal(await currentTrialEndingNotice(foreign.env, user), null); assert.equal(await currentTrialEndingNotice(foreign.env, other), null); groups++;
    const race = await make(); provider = async () => subscription(); await deliver(race, "evt_visit_race");
    assert.ok(await currentTrialEndingNotice(race.env, user));
    race.db.beforeBatch = async () => { race.db.sqlite.exec("UPDATE owner_billing_accounts SET cancel_at_period_end = 1"); };
    await visit(race); assert.equal(count(race, "user_notifications"), 0, "Write-time recheck denies a newly canceled trial"); groups++;
    const late = await make(); provider = async () => subscription(); await deliver(late, "evt_current");
    late.db.sqlite.exec("UPDATE owner_billing_accounts SET stripe_subscription_id = 'sub_new'");
    const originalTrial = captured(late); await deliver(late, "evt_old_subscription");
    assert.deepEqual(captured(late), originalTrial); assert.equal(await currentTrialEndingNotice(late.env, user), null); groups++;
    console.log(`Verified trial reminders: ${groups} groups passed. Signed synthetic-provider proof, exact deadline, private delivery, atomic rollback, stale-state and isolation verified.`);
  } finally { globalThis.fetch = originalFetch; for (const f of fixtures) f.db.sqlite.close(); }
}

async function localD1Proof() {
  const { Miniflare } = await import("miniflare");
  const seed = await fixture(); const originalFetch = globalThis.fetch;
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }",
    compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false });
  try {
    const db = await mf.getD1Database("DB");
    console.log("Local trial D1 emulator ready; copying synthetic schema.");
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
    let status = "trialing"; const end = now() + 3600; let providerReads = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return originalFetch(input, init);
      assert.equal(url.href, "https://api.stripe.com/v1/subscriptions/sub_owner"); assert.equal(init?.method, "GET");
      providerReads++; return Response.json(subscription({ status, trial_end: end }));
    };
    const f = { ...seed, env: { ...seed.env, DB: db as unknown as D1Database } };
    console.log("Synthetic seed ready; checking concurrent signed receipts and owner visits.");
    await Promise.all(Array.from({ length: 8 }, () => deliver(f, "evt_local_trial")));
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM billing_webhook_receipts").first())?.n, 1);
    assert.equal((await db.prepare("SELECT trial_end FROM billing_trial_reminder_state").first())?.trial_end, end);
    const beforeReads = providerReads;
    const responses = await Promise.all(Array.from({ length: 8 }, () => visit(f)));
    assert.ok(responses.every(r => r.status === 200)); assert.equal(providerReads, beforeReads);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM user_notifications").first())?.n, 1);
    assert.equal((await listUserNotifications(f.env, other)).items.length, 0);
    const before = [];
    console.log("Concurrent delivery passed; checking late-failure rollback and cancellation retry.");
    for (const table of protectedTables) before.push((await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results);
    await db.prepare("CREATE TRIGGER fail_trial BEFORE INSERT ON billing_trial_reminder_state BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END").run();
    status = "canceled"; await deliver(f, "evt_local_cancel", 500);
    const after = [];
    for (const table of protectedTables) after.push((await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results);
    assert.deepEqual(after, before, "Late trial projection failure rolls back the entire payment reconciliation");
    await db.prepare("DROP TRIGGER fail_trial").run(); await deliver(f, "evt_local_cancel");
    assert.equal((await db.prepare("SELECT trial_end FROM billing_trial_reminder_state").first())?.trial_end, null);
    assert.equal((await listUserNotifications(f.env, user)).items.length, 0);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    console.log("PASS actual local workerd/D1: concurrent signed receipts and visits dedupe; late failure rolls back payment and trial state; retry commits cancellation and hides the notice.");
  } finally { globalThis.fetch = originalFetch; await mf.dispose(); seed.db.sqlite.close(); }
}
(process.argv.includes("--d1") ? localD1Proof() : main()).catch(error => { console.error(error); process.exitCode = 1; });
