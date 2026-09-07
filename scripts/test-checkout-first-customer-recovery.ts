import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createSession } from "../functions/_lib/db";
import { upsertBillingAccount } from "../functions/_lib/plans";
import { onRequest as checkout } from "../functions/api/billing/create-checkout-session";
import { onRequest as webhook } from "../functions/api/stripe/webhook";
import { checkoutResponseFromRequest } from "./fixtures/billing-checkout";
import { createWebhookFixture } from "./fixtures/billing-webhook";

type Row = Record<string, unknown>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
const fixtures: Awaited<ReturnType<typeof createWebhookFixture>>[] = [];
const sessions = new Map<string, ReturnType<typeof checkoutResponseFromRequest> & { subscription?: string }>();
const subscriptions = new Map<string, Row>();
const originalFetch = globalThis.fetch;
const calls: Array<{ method: string; params: URLSearchParams; key: string | null }> = [];
let created = 0;
let eventNumber = 0;
let throwAfterCreate = false;
let sessionOverride: Row | null = null;
async function fixture() {
  const f = await createWebhookFixture();
  fixtures.push(f);
  f.env.DZN_APP_URL = "https://local.test";
  f.db.sqlite.exec(`ALTER TABLE users ADD COLUMN username TEXT;
    ALTER TABLE users ADD COLUMN avatar TEXT;
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT, session_token_hash TEXT, expires_at TEXT, created_at TEXT);`);
  const session = await createSession(f.env, "user-owner");
  f.db.allWrites = [];
  return { ...f, token: session.token };
}
async function request(f: Fixture, plan = "pro", expected = 200, authenticated = true, acceptedOffer?: string) {
  const response = await checkout({ env: f.env, request: new Request("https://local.test/api/billing/create-checkout-session", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { cookie: `dzn_session=${f.token}` } : {}) },
    body: JSON.stringify({ plan_key: plan, returnTo: "/setup", discord_user_id: "discord-other", stripe_customer_id: "cus_forged", accepted_offer: acceptedOffer }),
  }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
  const body = await response.json() as { errorCode?: string; url?: string; offer?: { confirmation: string } };
  assert.equal(response.status, expected, JSON.stringify(body));
  assert.doesNotMatch(JSON.stringify(body), /cus_|sub_|discord-|params_json|whsec|sk_test|fingerprint/);
  if (authenticated) assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/);
  return body;
}
const current = (f: Fixture) => f.db.sqlite.prepare("SELECT * FROM billing_checkout_attempts WHERE discord_user_id = 'discord-owner' AND state != 'closed'").get();
const account = (f: Fixture) => f.db.sqlite.prepare("SELECT * FROM owner_billing_accounts WHERE discord_user_id = 'discord-owner'").get();
const snapshot = (f: Fixture) => ["billing_checkout_attempts", "owner_starter_trial_claims", "owner_billing_accounts", "owner_plan_entitlements", "server_subscriptions", "server_sync_state"]
  .map(table => f.db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
async function paymentEvent(f: Fixture, type: string, object: Row) {
  const body = JSON.stringify({ id: `evt_lifecycle_${++eventNumber}`, type, livemode: false, data: { object } });
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", f.env.STRIPE_WEBHOOK_SECRET!).update(`${time}.${body}`).digest("hex");
  const response = await webhook({ env: f.env, request: new Request("https://local.test/api/stripe/webhook", {
    method: "POST", body, headers: { "stripe-signature": `t=${time},v1=${signature}` },
  }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
  assert.equal(response.status, 200, await response.text());
}
async function completeAndCancel(f: Fixture, plan = "pro", lostResponse = false) {
  throwAfterCreate = lostResponse;
  await request(f, plan, lostResponse ? 503 : 200);
  const session = sessions.get(`cs_fixture_${created}`)!;
  const sub = { id: `sub_fixture_${created}`, object: "subscription", customer: `cus_fixture_${created}`, livemode: false,
    status: plan === "starter" ? "trialing" : "active", metadata: { discord_user_id: "discord-owner" },
    current_period_start: 1788220800, current_period_end: 1790812800, cancel_at_period_end: false,
    items: { data: [{ price: { id: plan === "starter" ? "price_starter_fixture" : "price_pro_fixture" } }] } };
  Object.assign(session, { status: "complete", customer: sub.customer, subscription: sub.id });
  subscriptions.set(sub.id, sub);
  await paymentEvent(f, "checkout.session.completed", session);
  sub.status = "canceled";
  await paymentEvent(f, "customer.subscription.deleted", sub);
  return { session, sub };
}
async function run() {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    assert.match(url, /^https:\/\/api\.stripe\.com\/v1\/(checkout\/sessions(?:\/cs_fixture_\d+)?|subscriptions\/sub_fixture_\d+|prices\/price_starter_fixture)$/);
    const params = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ method, params, key: new Headers(init?.headers).get("Idempotency-Key") });
    if (url.includes("/prices/")) return Response.json({ id: "price_starter_fixture", active: true, livemode: false,
      currency: "gbp", unit_amount: 200, type: "recurring", billing_scheme: "per_unit",
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } });
    if (url.includes("/subscriptions/")) { assert.equal(method, "GET"); return Response.json(subscriptions.get(url.split("/").at(-1)!)); }
    if (method === "GET") return Response.json(sessionOverride ?? sessions.get(url.split("/").at(-1)!));
    assert.equal(method, "POST");
    const session = checkoutResponseFromRequest(init, { id: `cs_fixture_${++created}`, url: `https://checkout.stripe.com/c/pay/cs_fixture_${created}` });
    sessions.set(session.id, session);
    if (throwAfterCreate) { throwAfterCreate = false; throw new Error("synthetic lost response"); }
    return Response.json(session);
  };
  for (const [plan, replacement] of [["starter", "pro"], ["pro", "pro"], ["starter", "starter"]]) {
    const f = await fixture();
    const linked = f.db.sqlite.prepare("SELECT * FROM linked_servers ORDER BY 1").all();
    const { session, sub } = await completeAndCancel(f, plan);
    const attempt = current(f)!;
    assert.equal(attempt.stripe_customer_id, null);
    assert.equal(account(f)?.stripe_customer_id, session.customer);
    const claim = f.db.sqlite.prepare("SELECT * FROM owner_starter_trial_claims").all();
    const oldPosts = calls.filter(call => call.method === "POST");
    assert.equal((await request(f, "pro", 409)).errorCode, "CHECKOUT_COMPLETED");
    assert.equal(current(f), undefined);
    const closed = f.db.sqlite.prepare("SELECT * FROM billing_checkout_attempts WHERE id = ?").get(attempt.id)!;
    for (const key of ["stripe_customer_id", "params_json", "stripe_key_fingerprint", "stripe_session_id", "first_requested_at"]) assert.equal(closed[key], attempt[key]);
    assert.equal(calls.filter(call => call.method === "POST").length, oldPosts.length);
    assert.equal(account(f)?.plan_status, "canceled");
    assert.equal(f.db.sqlite.prepare("SELECT plan_key FROM owner_plan_entitlements").get()?.plan_key, "free");
    assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM owner_starter_trial_claims").all(), claim);
    if (plan === "starter") assert.equal((await request(f, "starter", 409)).errorCode, "STARTER_PAID_CONFIRMATION_REQUIRED");
    const paidOffer = replacement === "starter" ? (await request(f, "starter", 409)).offer!.confirmation : undefined;
    await request(f, replacement, 200, true, paidOffer);
    const newPost = calls.filter(call => call.method === "POST").at(-1)!;
    assert.equal(newPost.params.get("customer"), session.customer);
    assert.notEqual(newPost.key, oldPosts.at(-1)!.key);
    assert.equal(newPost.params.has("subscription_data[trial_period_days]"), false);
    const next = sessions.get(`cs_fixture_${created}`)!;
    const nextSub = { ...sub, id: `sub_fixture_${created}`, status: "active", items: { data: [{ price: { id: replacement === "starter" ? "price_starter_fixture" : "price_pro_fixture" } }] } };
    Object.assign(next, { status: "complete", subscription: nextSub.id });
    subscriptions.set(nextSub.id, nextSub);
    await paymentEvent(f, "checkout.session.completed", next);
    assert.equal(account(f)?.stripe_subscription_id, nextSub.id);
    assert.equal(account(f)?.plan_key, replacement);
    assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM linked_servers ORDER BY 1").all(), linked);
    assert.equal(account(f)?.discord_user_id, "discord-owner");
    console.log(`PASS first-time ${plan}: signed completion/customer assignment/cancellation, GET-only close, fresh deliberate ${replacement} checkout and verified replacement; no reused trial`);
  }

  const denied = await fixture();
  const { session } = await completeAndCancel(denied);
  const before = snapshot(denied);
  const postCount = calls.filter(call => call.method === "POST").length;
  for (const change of [{ customer: "cus_foreign" }, { customer: null }, { subscription: "sub_foreign" },
    { status: "open" }, { status: "expired" }, { client_reference_id: "discord-other" }, { livemode: true }]) {
    sessionOverride = { ...session, ...change };
    await request(denied, "pro", "client_reference_id" in change || "livemode" in change ? 502 : 409);
    assert.deepEqual(snapshot(denied), before);
  }
  sessionOverride = null;
  await request(denied, "pro", 401, false);
  assert.deepEqual(snapshot(denied), before);
  assert.equal(calls.filter(call => call.method === "POST").length, postCount);
  console.log("PASS wrong/missing customer, wrong subscription, incomplete/expired Session, foreign owner, mode mismatch and unauthenticated requests cannot close or create checkout");

  const unknown = await fixture();
  await completeAndCancel(unknown, "pro", true);
  const unknownBefore = snapshot(unknown);
  const callsBefore = calls.length;
  assert.equal((await request(unknown, "pro", 409)).errorCode, "CHECKOUT_REVIEW_REQUIRED");
  assert.equal(calls.length, callsBefore);
  assert.deepEqual(snapshot(unknown), unknownBefore);
  console.log("PASS assigned customer with unknown Session stays blocked for review without another provider request");

  for (const race of ["replacement", "foreign-customer"]) {
    const f = await fixture();
    const { session: oldSession } = await completeAndCancel(f);
    const beforeAttempt = current(f);
    f.db.afterFirst = async sql => {
      if (!sql.startsWith("SELECT discord_user_id FROM owner_billing_accounts WHERE stripe_customer_id")) return;
      f.db.afterFirst = undefined;
      await upsertBillingAccount(f.env, { discordUserId: race === "replacement" ? "discord-owner" : "discord-other",
        stripeCustomerId: String(oldSession.customer), stripeSubscriptionId: "sub_changed", planKey: "pro", planStatus: "active" });
    };
    assert.equal((await request(f, "pro", 503)).errorCode, "CHECKOUT_RETRY_REQUIRED");
    assert.deepEqual(current(f), beforeAttempt);
    console.log(`PASS ${race} change during provider read cannot close the pending attempt using stale account proof`);
  }
  for (const f of fixtures) assert.equal(f.env.DZN_LIVE_CHECKOUT_ENABLED, "false");
}
run().finally(() => { globalThis.fetch = originalFetch; for (const f of fixtures) f.db.sqlite.close(); })
  .catch(error => { console.error(error); process.exitCode = 1; });
