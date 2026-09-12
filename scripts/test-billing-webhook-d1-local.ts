import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Miniflare } from "miniflare";
import { syncServerSubscriptionsForOwner } from "../functions/_lib/automation";
import { upsertBillingAccount } from "../functions/_lib/plans";
import { onRequest } from "../functions/api/stripe/webhook";
import { createWebhookFixture } from "./fixtures/billing-webhook";

// In-memory workerd/D1 only; never loads Wrangler config or provider credentials.
async function run() {
  const fixture = await createWebhookFixture();
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }",
    compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  const originalFetch = globalThis.fetch;
  try {
    const periodStart = 1788220800;
    const periodEnd = 1790812800;
    const initial = { stripeCustomerId: "cus_owner", stripeSubscriptionId: "sub_owner", planKey: "starter" as const,
      currentPeriodStart: new Date(periodStart * 1000).toISOString(), currentPeriodEnd: new Date(periodEnd * 1000).toISOString(), status: "past_due" };
    await upsertBillingAccount(fixture.env, { discordUserId: "discord-owner", ...initial, planStatus: initial.status });
    await syncServerSubscriptionsForOwner(fixture.env, "discord-owner", { ...initial, stripePriceId: "price_starter_fixture" });
    const db = await mf.getD1Database("DB");
    const schema = fixture.db.sqlite.prepare(`SELECT name, type, sql FROM sqlite_master WHERE sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`).all();
    for (const row of schema) await db.prepare(String(row.sql)).run();
    for (const { name, type } of schema) {
      if (type !== "table") continue;
      assert.match(String(name), /^[a-z_]+$/);
      for (const row of fixture.db.sqlite.prepare(`SELECT * FROM "${name}"`).all()) {
        const columns = Object.keys(row);
        for (const column of columns) assert.match(column, /^[a-z_]+$/);
        await db.prepare(`INSERT INTO "${name}" (${columns.map(column => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .bind(...Object.values(row)).run();
      }
    }
    const env = { ...fixture.env, DB: db as unknown as D1Database };
    let status = "active";
    let providerReads = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return originalFetch(input, init);
      assert.equal(url.href, "https://api.stripe.com/v1/subscriptions/sub_owner");
      assert.equal(init?.method, "GET");
      providerReads++;
      return Response.json({ id: "sub_owner", object: "subscription", customer: "cus_owner", livemode: false, status,
        metadata: { discord_user_id: "discord-owner" }, current_period_start: periodStart, current_period_end: periodEnd,
        cancel_at_period_end: false, items: { data: [{ price: { id: "price_starter_fixture" } }] } });
    };
    async function deliver(id: string, requestEnv = env) {
      const body = JSON.stringify({ id, livemode: false, type: "invoice.paid",
        data: { object: { object: "invoice", customer: "cus_owner", subscription: "sub_owner" } } });
      const time = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET!).update(`${time}.${body}`).digest("hex");
      return onRequest({ env: requestEnv, request: new Request("https://local.test/api/stripe/webhook", {
        method: "POST", body, headers: { "stripe-signature": `t=${time},v1=${sig}` },
      }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
    }
    const allStatuses = await Promise.all(Array.from({ length: 8 }, async () => (await deliver("evt_local_duplicate")).status));
    assert.deepEqual(allStatuses, Array(8).fill(200));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM billing_webhook_receipts").first())?.n, 1);
    assert.equal((await db.prepare("SELECT version FROM billing_webhook_versions").first())?.version, 1);
    assert.equal((await db.prepare("SELECT plan_status FROM owner_billing_accounts").first())?.plan_status, "active");
    const reads = providerReads;
    assert.equal((await deliver("evt_local_duplicate")).status, 200);
    assert.equal(providerReads, reads);
    console.log("PASS local workerd/D1: eight concurrent signed deliveries commit one receipt and one revision");

    const tables = ["billing_webhook_receipts", "billing_webhook_versions", "owner_billing_accounts", "owner_plan_entitlements",
      "owner_starter_trial_claims", "server_subscriptions", "server_sync_state", "linked_servers", "users"];
    async function snapshot() {
      const rows = [];
      for (const table of tables) rows.push((await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results);
      return rows;
    }
    const before = await snapshot();
    status = "canceled";
    const failingDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements: D1PreparedStatement[]) => {
        // Fail after receipt, revision, trial, account and entitlement writes have executed.
        const injected = [...statements];
        injected.splice(5, 0, db.prepare("INSERT INTO billing_webhook_versions VALUES ('invalid-mode', 'injected', 1)") as unknown as D1PreparedStatement);
        return db.batch(injected as unknown as Parameters<typeof db.batch>[0]);
      },
    } as unknown as D1Database;
    assert.equal((await deliver("evt_local_rollback", { ...env, DB: failingDb })).status, 500);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await deliver("evt_local_rollback")).status, 200);
    assert.equal((await db.prepare("SELECT plan_status FROM owner_billing_accounts").first())?.plan_status, "canceled");
    assert.equal((await db.prepare("SELECT plan_key FROM owner_plan_entitlements").first())?.plan_key, "free");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM billing_webhook_receipts").first())?.n, 2);
    console.log("PASS local workerd/D1: injected late SQL failure rolls back every write; identical retry commits cancellation");
  } finally {
    globalThis.fetch = originalFetch;
    await mf.dispose();
    fixture.db.sqlite.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
