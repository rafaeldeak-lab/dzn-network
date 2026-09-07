import assert from "node:assert/strict";
import { createSession } from "../functions/_lib/db";
import { ensureBillingSchema, ensureStarterTrialClaimSchema, upsertBillingAccount } from "../functions/_lib/plans";
import { onRequest } from "../functions/api/billing/create-checkout-session";
import { checkoutPriceFixture, checkoutResponseFromRequest, createCheckoutFixture } from "./fixtures/billing-checkout";

const originalFetch = globalThis.fetch;
const fixtures: ReturnType<typeof createCheckoutFixture>[] = [];
const expectedProtected = new Map<ReturnType<typeof createCheckoutFixture>["db"], unknown>();
const sessions = new Map<string, { body: string; session: ReturnType<typeof checkoutResponseFromRequest> }>();
const reads: string[] = [], posts: string[] = [];
let override: Record<string, unknown> = {};
let priceFailure: number | "throw" | "invalid-json" | "null" | null = null;
let loseResponse = false;
async function fixture() {
  const f = createCheckoutFixture(); fixtures.push(f);
  await ensureBillingSchema(f.env); await ensureStarterTrialClaimSchema(f.env);
  f.db.sqlite.exec("INSERT INTO users(id, discord_id) VALUES ('owner', 'discord-owner')");
  const token = (await createSession(f.env, "owner")).token;
  return { ...f, token };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const rows = (f: Fixture, table: string) => f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
const protectedRows = (f: Fixture) => ["owner_billing_accounts", "owner_plan_entitlements"].map(table => rows(f, table));
const ledgerRows = (f: Fixture) => ["billing_checkout_attempts", "owner_starter_trial_claims"].map(table => rows(f, table));
async function request(f: Fixture, plan: "starter" | "pro", status: number, token = f.token) {
  const response = await onRequest({ env: f.env, request: new Request("https://local.test/api/billing/create-checkout-session", {
    method: "POST", headers: { cookie: `dzn_session=${token}`, "content-type": "application/json" },
    body: JSON.stringify({ plan_key: plan, returnTo: "/setup", price: "price_forged", amount: 1, currency: "usd", trial_period_days: 99 }),
  }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
  const body = await response.json() as { errorCode?: string; url?: string };
  assert.equal(response.status, status, JSON.stringify(body));
  assert.doesNotMatch(JSON.stringify(body), /\bprice_|sk_|whsec|discord-owner|private-provider|params_json|fingerprint/);
  if (status !== 401 && status !== 403) assert.match(response.headers.get("cache-control") ?? "", /private, no-store/);
  return body;
}
async function run() {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.stripe.com");
    const method = init?.method ?? "GET";
    if (url.pathname.startsWith("/v1/prices/")) {
      assert.equal(method, "GET"); reads.push(url.pathname);
      if (priceFailure === "throw") throw new Error("private-provider-error");
      if (typeof priceFailure === "number") return Response.json({ error: { message: "private-provider-error" } }, { status: priceFailure });
      if (priceFailure === "invalid-json") return new Response("not json");
      if (priceFailure === "null") return Response.json(null);
      return Response.json({ ...checkoutPriceFixture(url.pathname.split("/").at(-1)!), ...override });
    }
    if (method === "GET") {
      assert.match(url.pathname, /^\/v1\/checkout\/sessions\/cs_price_\d+$/);
      return Response.json([...sessions.values()].find(row => url.pathname.endsWith(`/${row.session.id}`))?.session);
    }
    assert.equal(url.pathname, "/v1/checkout/sessions"); assert.equal(method, "POST");
    const key = new Headers(init?.headers).get("idempotency-key")!;
    assert.match(key, /^dzn-checkout-/); posts.push(key);
    const body = String(init?.body); const saved = sessions.get(key);
    if (saved) assert.equal(body, saved.body, "Uncertain retries preserve the exact request and key");
    else sessions.set(key, { body, session: checkoutResponseFromRequest(init, { id: `cs_price_${sessions.size}`, url: `https://checkout.stripe.com/c/pay/cs_price_${sessions.size}` }) });
    if (loseResponse) { loseResponse = false; throw new Error("private-provider-lost-response"); }
    return Response.json(sessions.get(key)!.session);
  };
  const badPrices: Record<string, unknown>[] = [
    { id: "price_other" }, { active: false }, { livemode: true }, { currency: "usd" }, { currency: "GBP" },
    { unit_amount: 499 }, { unit_amount: 999 }, { unit_amount: 0 }, { unit_amount: null }, { unit_amount: "200" },
    { type: "one_time" }, { billing_scheme: "tiered" }, { transform_quantity: { divide_by: 2, round: "up" } },
    { custom_unit_amount: { minimum: 1 } }, { recurring: null },
    { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } },
    { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
    { recurring: { interval: "month", interval_count: 1 } },
  ];
  for (const plan of ["starter", "pro"] as const) {
    for (const bad of badPrices) {
      const f = await fixture(); const snapshot = protectedRows(f), before = posts.length;
      override = bad;
      assert.equal((await request(f, plan, 503)).errorCode, "CHECKOUT_PRICE_REVIEW_REQUIRED");
      assert.deepEqual(ledgerRows(f), [[], []]); assert.deepEqual(protectedRows(f), snapshot); assert.equal(posts.length, before);
    }
    override = {};
    for (const failure of [403, 404, 500, "throw", "invalid-json", "null"] as const) {
      const f = await fixture(), before = posts.length; priceFailure = failure;
      await request(f, plan, 503); assert.deepEqual(ledgerRows(f), [[], []]); assert.equal(posts.length, before);
    }
    priceFailure = null;
    const f = await fixture(), before = sessions.size;
    await Promise.all(Array.from({ length: 8 }, () => request(f, plan, 200)));
    assert.equal(sessions.size, before + 1); assert.equal(rows(f, "billing_checkout_attempts").length, 1);
    assert.equal(rows(f, "owner_starter_trial_claims").length, plan === "starter" ? 1 : 0);
    const params = new URLSearchParams([...sessions.values()].at(-1)!.body);
    assert.equal(params.get("line_items[0][price]"), `price_${plan}_fixture`);
    assert.equal(params.get("line_items[0][quantity]"), "1"); assert.equal(params.get("payment_method_collection"), "always");
    assert.equal(params.get("subscription_data[trial_period_days]"), plan === "starter" ? "2" : null);
    assert.equal(params.has("amount"), false); assert.equal(params.get("allow_promotion_codes"), "false");
    assert.deepEqual(protectedRows(f), [[], []]);
  }
  console.log("PASS both plans: 38 incorrect prices and 12 provider failures reject before attempts/trials/Session writes; correct concurrent requests retain exact advertised contract");

  const f = await fixture(); loseResponse = true;
  await request(f, "starter", 503);
  const frozen = ledgerRows(f), before = posts.length, key = posts.at(-1)!;
  f.env.STRIPE_PRICE_STARTER = "price_new_wrong_binding";
  override = { unit_amount: 499 };
  assert.equal((await request(f, "starter", 503)).errorCode, "CHECKOUT_PRICE_REVIEW_REQUIRED");
  assert.equal(reads.at(-1), "/v1/prices/price_starter_fixture");
  assert.deepEqual(ledgerRows(f), frozen); assert.equal(posts.length, before);
  override = {}; await request(f, "starter", 200); assert.equal(posts.at(-1), key);
  const opened = ledgerRows(f); const openPosts = posts.length;
  override = { active: false }; await request(f, "starter", 503);
  assert.deepEqual(ledgerRows(f), opened); assert.equal(posts.length, openPosts);
  override = {}; priceFailure = 500;
  sessions.get(key)!.session.status = "expired";
  const beforeReads = reads.length;
  assert.equal((await request(f, "starter", 409)).errorCode, "CHECKOUT_EXPIRED");
  assert.equal(reads.length, beforeReads, "Provider-confirmed expiry can close safely without Price service availability");
  assert.equal(rows(f, "owner_starter_trial_claims").length, 0);
  priceFailure = null;
  console.log("PASS interrupted and known-Session retries check the frozen Price, preserve reservations and never substitute a new binding; confirmed expiry remains safe");

  const complete = await fixture(); await request(complete, "pro", 200);
  const completedSession = sessions.get(posts.at(-1)!)!.session;
  Object.assign(completedSession, { status: "complete", customer: "cus_closed", subscription: "sub_closed" });
  await upsertBillingAccount(complete.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_closed", stripeSubscriptionId: "sub_closed", planKey: "pro", planStatus: "canceled" });
  const completeBaseline = protectedRows(complete); expectedProtected.set(complete.db, completeBaseline);
  priceFailure = 500;
  const completeReads = reads.length, completePosts = posts.length;
  assert.equal((await request(complete, "pro", 409)).errorCode, "CHECKOUT_COMPLETED");
  assert.equal(rows(complete, "billing_checkout_attempts")[0].state, "closed");
  assert.equal(reads.length, completeReads); assert.equal(posts.length, completePosts);
  assert.deepEqual(protectedRows(complete), completeBaseline);
  priceFailure = null;
  console.log("PASS completed same-account canceled subscription closes its exact attempt during a Price-service outage without a replacement or entitlement mutation");

  const paused = await fixture(), callsBefore = reads.length + posts.length;
  await request(paused, "starter", 401, "invalid");
  paused.env.STRIPE_SECRET_KEY = "sk_live_blocked";
  await request(paused, "starter", 403); await request(paused, "pro", 403);
  assert.equal(reads.length + posts.length, callsBefore); assert.deepEqual(ledgerRows(paused), [[], []]);
  for (const f of fixtures) {
    assert.deepEqual(f.db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    assert.deepEqual(protectedRows({ ...f, token: "" }), expectedProtected.get(f.db) ?? [[], []]);
  }
  console.log("PASS authentication and disabled live checkout gate all provider work; all fixtures retain clean foreign keys and no account/entitlement grants");
}
run().finally(() => { globalThis.fetch = originalFetch; for (const f of fixtures) f.db.sqlite.close(); })
  .catch(error => { console.error(error); process.exitCode = 1; });
