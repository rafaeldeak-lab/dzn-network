import assert from "node:assert/strict";
import { createSession } from "../functions/_lib/db";
import { upsertBillingAccount, upsertStarterTrialClaimFromStripe } from "../functions/_lib/plans";
import { onRequest } from "../functions/api/billing/create-checkout-session";
import { createCheckoutFixture, checkoutResponseFromRequest } from "./fixtures/billing-checkout";

const fixtures: ReturnType<typeof createCheckoutFixture>[] = [];
const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; method: string; params: URLSearchParams; key: string | null }> = [];
const sessions = new Map<string, ReturnType<typeof checkoutResponseFromRequest>>();
let priceOverride: Record<string, unknown> = {};
let loseResponse = false;
let beforePrice: (() => void) | null = null;
async function fixture(returning = true) {
  const f = createCheckoutFixture(); fixtures.push(f);
  f.db.sqlite.exec("INSERT INTO users(id, discord_id) VALUES ('user-owner', 'discord-owner'), ('user-other', 'discord-other')");
  const token = (await createSession(f.env, "user-owner")).token;
  const otherToken = (await createSession(f.env, "user-other")).token;
  if (returning) {
    await upsertBillingAccount(f.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_return", stripeSubscriptionId: "sub_old", planKey: "starter", planStatus: "canceled" });
    await upsertStarterTrialClaimFromStripe(f.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_return", stripeSubscriptionId: "sub_old", status: "canceled" });
  }
  f.db.statements.length = 0;
  return { ...f, token, otherToken };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function request(f: Fixture, accepted?: unknown, token = f.token, plan = "starter") {
  const response = await onRequest({ env: f.env, request: new Request("https://local.test/api/billing/create-checkout-session", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: `dzn_session=${token}` },
    body: JSON.stringify({ plan_key: plan, accepted_offer: accepted, price: "price_forged", trial_period_days: 2, discord_user_id: "discord-other" }),
  }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
  const body = await response.json() as { errorCode?: string; url?: string; offer?: { confirmation: string; price_label: string } };
  assert.doesNotMatch(JSON.stringify(body), /cus_|sub_|discord-|price_starter|sk_test|whsec|params_json/);
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  if (body.offer) assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/);
  return { status: response.status, ...body };
}
const rows = (f: Fixture, table: string) => f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
const posts = () => calls.filter(call => call.method === "POST");
async function run() {
  globalThis.fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? "GET";
    assert.match(url, /^https:\/\/api\.stripe\.com\/v1\/(prices\/price_|checkout\/sessions)/);
    const params = new URLSearchParams(String(init?.body ?? ""));
    const key = new Headers(init?.headers).get("Idempotency-Key"); calls.push({ url, method, params, key });
    if (url.includes("/prices/")) {
      assert.equal(method, "GET"); beforePrice?.(); beforePrice = null;
      return Response.json({ id: url.split("/").at(-1), object: "price", active: true, livemode: false, currency: "gbp", unit_amount: 200,
        type: "recurring", billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }, ...priceOverride });
    }
    if (method === "GET") return Response.json([...sessions.values()].find(s => url.endsWith(`/${s.id}`)));
    assert.equal(method, "POST"); assert.ok(key);
    let session = sessions.get(key);
    if (!session) {
      session = checkoutResponseFromRequest(init, { id: `cs_return_${sessions.size}`, url: `https://checkout.stripe.com/c/pay/cs_return_${sessions.size}` });
      sessions.set(key, session);
    }
    if (loseResponse) { loseResponse = false; throw new Error("Synthetic lost response"); }
    return Response.json(session);
  };

  const f = await fixture();
  const prior = rows(f, "owner_starter_trial_claims"); const account = rows(f, "owner_billing_accounts");
  const entitlements = rows(f, "owner_plan_entitlements");
  const offer = await request(f);
  assert.equal(offer.status, 409);
  assert.equal(offer.errorCode, "STARTER_PAID_CONFIRMATION_REQUIRED");
  assert.match(offer.offer!.price_label, /2/);
  assert.equal(posts().length, 0); assert.deepEqual(rows(f, "billing_checkout_attempts"), []);
  assert.equal((await request(f, true)).status, 409);
  assert.equal((await request(f, "forged")).status, 409);
  const accepted = offer.offer!.confirmation;
  const results = await Promise.all(Array.from({ length: 8 }, () => request(f, accepted)));
  assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
  assert.equal(rows(f, "billing_checkout_attempts").length, 1);
  assert.equal(new Set(posts().map(call => call.key)).size, 1);
  const stored = String(rows(f, "billing_checkout_attempts")[0].params_json);
  assert.ok(stored.includes(accepted));
  for (const call of posts()) {
    assert.equal(call.params.get("line_items[0][price]"), "price_starter_fixture");
    assert.equal(call.params.get("customer"), "cus_return");
    assert.equal(call.params.has("subscription_data[trial_period_days]"), false);
    assert.equal(call.params.has("subscription_data[trial_settings][end_behavior][missing_payment_method]"), false);
    assert.equal(call.params.get("allow_promotion_codes"), "false");
    assert.match(call.params.get("custom_text[submit][message]")!, /No new free trial/);
  }
  assert.deepEqual(rows(f, "owner_starter_trial_claims"), prior);
  assert.deepEqual(rows(f, "owner_billing_accounts"), account);
  assert.deepEqual(rows(f, "owner_plan_entitlements"), entitlements);
  const beforeResume = calls.length;
  assert.equal((await request(f)).errorCode, "STARTER_PAID_CONFIRMATION_REQUIRED");
  assert.equal(calls.length, beforeResume, "Old trial requests cannot open paid checkout");
  assert.equal((await request(f, undefined, f.token, "pro")).errorCode, "CHECKOUT_PLAN_CONFLICT");
  f.env.STRIPE_PRICE_STARTER = "price_changed_config";
  assert.equal((await request(f, accepted)).status, 200);
  assert.equal(String(rows(f, "billing_checkout_attempts")[0].params_json), stored);
  sessions.get(posts()[0].key!)!.status = "expired";
  assert.equal((await request(f, accepted)).errorCode, "CHECKOUT_EXPIRED");
  assert.deepEqual(rows(f, "owner_starter_trial_claims"), prior, "Paid checkout expiry must not release a used trial");
  assert.equal((await request(f, accepted)).status, 409, "Changed Price requires fresh confirmation");
  console.log("PASS explicit paid consent, eight concurrent requests, frozen retry terms and used-claim preservation");

  const lost = await fixture(); const consent = (await request(lost)).offer!.confirmation;
  loseResponse = true; assert.equal((await request(lost, consent)).status, 503);
  const lostPost = posts().at(-1)!;
  lost.env.STRIPE_PRICE_STARTER = "price_new";
  assert.equal((await request(lost, consent)).status, 200);
  assert.equal(posts().at(-1)!.key, lostPost.key);
  assert.equal(posts().at(-1)!.params.toString(), lostPost.params.toString());
  console.log("PASS interrupted paid checkout reuses exact parameters and key without a new trial");

  for (const override of [{ unit_amount: 201 }, { currency: "usd" }, { active: false }, { livemode: true }, { id: "price_foreign" },
    { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } }, { recurring: { interval: "month", interval_count: 2, usage_type: "licensed" } },
    { billing_scheme: "tiered" }, { transform_quantity: { divide_by: 10 } }]) {
    const invalid = await fixture(); priceOverride = override; const before = posts().length;
    assert.equal((await request(invalid)).errorCode, "CHECKOUT_PRICE_REVIEW_REQUIRED");
    assert.equal(posts().length, before); assert.equal(rows(invalid, "billing_checkout_attempts").length, 0);
  }
  priceOverride = {};
  console.log("PASS wrong Price, amount, currency, interval, mode or quantity rules cannot produce a paid offer");

  const stale = await fixture(); const staleOffer = (await request(stale)).offer!.confirmation;
  beforePrice = () => stale.db.sqlite.exec("UPDATE owner_billing_accounts SET plan_status = 'active'");
  const beforeStale = posts().length;
  assert.equal((await request(stale, staleOffer)).status, 503);
  assert.equal(posts().length, beforeStale); assert.equal(rows(stale, "billing_checkout_attempts").length, 0);
  for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete"]) {
    stale.db.sqlite.prepare("UPDATE owner_billing_accounts SET plan_status = ?").run(status);
    assert.equal((await request(stale, staleOffer)).errorCode, "SUBSCRIPTION_EXISTS");
  }
  const privateF = await fixture(); const privateOffer = (await request(privateF)).offer!.confirmation;
  const beforePrivate = posts().length;
  assert.equal((await request(privateF, privateOffer, "")).status, 401);
  assert.equal((await request(privateF, privateOffer, privateF.otherToken)).status, 409);
  assert.equal(posts().length, beforePrivate);
  privateF.db.sqlite.exec("UPDATE owner_starter_trial_claims SET discord_user_id = 'discord-other'");
  assert.equal((await request(privateF, privateOffer)).errorCode, "STARTER_TRIAL_UNAVAILABLE");
  console.log("PASS auth, cross-account consent, ambiguous claims, live subscriptions and in-flight account change deny paid creation");

  const first = await fixture(false);
  assert.equal((await request(first, privateOffer)).errorCode, "CHECKOUT_OFFER_CHANGED");
  assert.equal((await request(first)).status, 200);
  assert.equal(posts().at(-1)!.params.get("subscription_data[trial_period_days]"), "2");
  assert.equal((await request(first, privateOffer)).status, 409);
  const paused = await fixture(); paused.env.STRIPE_SECRET_KEY = "sk_live_blocked";
  const beforePaused = calls.length;
  assert.equal((await request(paused, privateOffer)).status, 403); assert.equal(calls.length, beforePaused);
  console.log("PASS first-time trial unchanged, stale paid offer rejected and live checkout remains disabled");
  const allowed = /^(?:\s*)(?:INSERT INTO|UPDATE|DELETE FROM) (?:billing_checkout_attempts|owner_starter_trial_claims)\b/;
  const writes = f.db.statements.filter(sql => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql));
  for (const sql of writes) assert.match(sql, allowed);
}
run().finally(() => { globalThis.fetch = originalFetch; for (const f of fixtures) f.db.sqlite.close(); })
  .catch(error => { console.error(error); process.exitCode = 1; });
