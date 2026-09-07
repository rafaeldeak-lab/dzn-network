import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createOrResumeCheckout, CheckoutRecoveryError } from "../functions/_lib/billing-checkout";
import { upsertBillingAccount, upsertStarterTrialClaimFromStripe } from "../functions/_lib/plans";
import { createCheckoutFixture, checkoutResponseFromRequest } from "./fixtures/billing-checkout";

async function run() {
  const fixture = createCheckoutFixture();
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('local'); } }",
    compatibilityDate: "2026-05-08", d1Databases: ["DB"], d1Persist: false });
  const originalFetch = globalThis.fetch;
  try {
    await upsertBillingAccount(fixture.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_return", stripeSubscriptionId: "sub_old", planKey: "starter", planStatus: "canceled" });
    await upsertStarterTrialClaimFromStripe(fixture.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_return", stripeSubscriptionId: "sub_old", status: "canceled" });
    const db = await mf.getD1Database("DB");
    const schema = fixture.db.sqlite.prepare("SELECT name, type, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name").all();
    for (const row of schema) await db.prepare(String(row.sql)).run();
    for (const { name, type } of schema) {
      if (type !== "table") continue;
      assert.match(String(name), /^[a-z_]+$/);
      for (const row of fixture.db.sqlite.prepare(`SELECT * FROM ${name}`).all()) {
        const columns = Object.keys(row); columns.forEach(column => assert.match(column, /^[a-z_]+$/));
        await db.prepare(`INSERT INTO ${name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
      }
    }
    const env = { ...fixture.env, DB: db as unknown as D1Database };
    const input = { discordUserId: "discord-owner", planKey: "starter" as const, priceId: "price_starter_fixture", returnTo: "/dashboard" };
    const request = new Request("https://local.test/api/billing/create-checkout-session");
    const keys = new Set<string>(); let session: ReturnType<typeof checkoutResponseFromRequest> | undefined;
    globalThis.fetch = async (value, init) => {
      const url = new URL(value instanceof Request ? value.url : String(value));
      if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return originalFetch(value, init);
      if (url.href === "https://api.stripe.com/v1/prices/price_starter_fixture") return Response.json({ id: "price_starter_fixture", active: true,
        livemode: false, currency: "gbp", unit_amount: 200, type: "recurring", billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } });
      assert.match(url.href, /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions(?:\/cs_fixture)?$/);
      if (init?.method === "POST") {
        keys.add(new Headers(init.headers).get("Idempotency-Key")!);
        assert.equal(new URLSearchParams(String(init.body)).has("subscription_data[trial_period_days]"), false);
        session ??= checkoutResponseFromRequest(init);
      }
      return Response.json(session);
    };
    let acceptedOffer: string | undefined;
    try { await createOrResumeCheckout(env, request, input); }
    catch (error) { assert.ok(error instanceof CheckoutRecoveryError); acceptedOffer = error.offer?.confirmation; }
    assert.ok(acceptedOffer); assert.equal(keys.size, 0);
    const claimBefore = (await db.prepare("SELECT * FROM owner_starter_trial_claims").all()).results;
    await Promise.all(Array.from({ length: 8 }, () => createOrResumeCheckout(env, request, { ...input, acceptedOffer })));
    assert.equal(keys.size, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM billing_checkout_attempts").first())?.n, 1);
    assert.deepEqual((await db.prepare("SELECT * FROM owner_starter_trial_claims").all()).results, claimBefore);
    assert.equal((await db.prepare("SELECT plan_status FROM owner_billing_accounts").first())?.plan_status, "canceled");
    assert.equal((await db.prepare("SELECT plan_key FROM owner_plan_entitlements").first())?.plan_key, "free");
    console.log("PASS local workerd/D1: conditional paid-attempt creation converges under eight concurrent requests; no trial/account/entitlement mutation");
  } finally { globalThis.fetch = originalFetch; await mf.dispose(); fixture.db.sqlite.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
