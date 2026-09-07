import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createSession } from "../functions/_lib/db";
import { CHECKOUT_RETRY_SECONDS } from "../functions/_lib/billing-checkout";
import { ensureBillingSchema, ensureStarterTrialClaimSchema, upsertBillingAccount } from "../functions/_lib/plans";
import { onRequest } from "../functions/api/billing/create-checkout-session";
import { checkoutResponseFromRequest, checkoutPriceFixture, createCheckoutFixture } from "./fixtures/billing-checkout";

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Row = Record<string, unknown>;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let clock = originalNow();
Date.now = () => clock;
const fixtures: ReturnType<typeof createCheckoutFixture>[] = [];
const sessions = new Map<string, ReturnType<typeof checkoutResponseFromRequest>>();
const keyedRequests = new Map<string, { body: string; version: string | null; session: ReturnType<typeof checkoutResponseFromRequest> }>();
const calls: Array<{ method: string; key: string | null; body: string }> = [];
let failAfterCreate = false;
let providerError = false;
let badResponse: Row | null = null;
let created = 0;

async function fixture(migration = true) {
  const f = createCheckoutFixture({ migration });
  fixtures.push(f);
  await ensureBillingSchema(f.env);
  await ensureStarterTrialClaimSchema(f.env);
  f.db.sqlite.exec("INSERT INTO users (id, discord_id) VALUES ('owner', 'discord-owner'), ('other', 'discord-other')");
  const owner = await createSession(f.env, "owner");
  const other = await createSession(f.env, "other");
  f.db.statements.length = 0;
  return { ...f, owner: owner.token, other: other.token };
}

async function request(f: Fixture, plan = "starter", options: { token?: string; body?: Row; expected?: number } = {}) {
  const response = await onRequest({ env: f.env, request: new Request("https://local.test/api/billing/create-checkout-session", {
    method: "POST", headers: { cookie: `dzn_session=${options.token ?? f.owner}`, "Content-Type": "application/json" },
    body: JSON.stringify({ plan_key: plan, returnTo: "/setup", ...options.body }),
  }), params: {}, data: {}, waitUntil() {}, next: async () => new Response(null, { status: 404 }) });
  const body = await response.json() as { url?: string; errorCode?: string; error?: string };
  if (options.expected !== undefined) assert.equal(response.status, options.expected, JSON.stringify(body));
  if (response.status !== 401 && response.status !== 403) assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/);
  assert.doesNotMatch(JSON.stringify(body), /sk_test|sk_live|whsec|params_json|discord-owner|discord-other|private-provider-error|fingerprint/);
  return { response, body };
}
function attempt(f: Fixture, owner = "discord-owner") { return f.db.sqlite.prepare("SELECT * FROM billing_checkout_attempts WHERE discord_user_id = ? AND state != 'closed'").get(owner)!; }
function claim(f: Fixture) { return f.db.sqlite.prepare("SELECT * FROM owner_starter_trial_claims WHERE discord_user_id = 'discord-owner'").get(); }

async function run() {
  globalThis.fetch = async (input, init) => {
    if (/^https:\/\/api\.stripe\.com\/v1\/prices\/price_(starter|pro)_fixture$/.test(String(input))) {
      assert.equal(init?.method ?? "GET", "GET");
      return Response.json(checkoutPriceFixture(String(input).split("/").at(-1)!));
    }
    assert.match(String(input), /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions(?:\/cs_fixture_\d+)?$/);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const key = headers.get("idempotency-key");
    const body = String(init?.body ?? "");
    calls.push({ method, key, body });
    if (providerError) return Response.json({ error: { message: "private-provider-error" } }, { status: 500 });
    if (method === "GET") {
      assert.equal(key, null);
      const id = String(input).split("/").at(-1)!;
      return Response.json(badResponse ?? sessions.get(id));
    }
    assert.equal(method, "POST");
    assert.match(key ?? "", /^dzn-checkout-[0-9a-f-]{36}$/);
    let saved = keyedRequests.get(key!);
    if (saved) {
      assert.equal(saved.body, body, "A replay must use exactly the immutable original parameters.");
      assert.equal(saved.version, headers.get("stripe-version"));
    } else {
      created++;
      const session = checkoutResponseFromRequest(init, { id: `cs_fixture_${created}`, url: `https://checkout.stripe.com/c/pay/cs_fixture_${created}` });
      saved = { body, version: headers.get("stripe-version"), session };
      keyedRequests.set(key!, saved);
      sessions.set(session.id, session);
    }
    if (failAfterCreate) { failAfterCreate = false; throw new Error("private-provider-error"); }
    return Response.json(badResponse ?? saved.session);
  };

  for (const plan of ["starter", "pro"]) {
    const fresh = await fixture();
    const before = created;
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => request(fresh, plan, { expected: 200 })));
    assert.equal(created, before + 1);
    assert.equal(new Set(concurrent.map(result => result.body.url)).size, 1);
    assert.equal(fresh.db.sqlite.prepare("SELECT count(*) AS n FROM billing_checkout_attempts").get()?.n, 1);
    assert.equal(fresh.db.sqlite.prepare("SELECT count(*) AS n FROM owner_starter_trial_claims").get()?.n, plan === "starter" ? 1 : 0);
  }
  console.log("PASS simultaneous first-time Starter and Pro clicks choose one durable attempt and one provider Session");

  const ambiguous = await fixture();
  await upsertBillingAccount(ambiguous.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_shared", planKey: "free", planStatus: "free" });
  await upsertBillingAccount(ambiguous.env, { discordUserId: "discord-other", stripeCustomerId: "cus_shared", planKey: "free", planStatus: "free" });
  const beforeAmbiguous = calls.length;
  for (const plan of ["starter", "pro"]) {
    await Promise.all([request(ambiguous, plan, { expected: 409 }), request(ambiguous, plan, { token: ambiguous.other, expected: 409 })]);
  }
  assert.equal(calls.length, beforeAmbiguous);
  assert.equal(ambiguous.db.sqlite.prepare("SELECT count(*) AS n FROM billing_checkout_attempts").get()?.n, 0);
  assert.equal(claim(ambiguous), undefined);
  console.log("PASS ambiguous shared payment customers are blocked for both owners before Stripe or reservations");

  const f = await fixture();
  const createCount = created;
  failAfterCreate = true;
  await request(f, "starter", { expected: 503 });
  const first = attempt(f);
  assert.equal(claim(f)?.id, first.id);
  assert.equal(first.state, "request_started");
  assert.equal(first.stripe_session_id, null);
  const results = await Promise.all(Array.from({ length: 8 }, () => request(f, "starter", { expected: 200 })));
  assert.equal(new Set(results.map((r) => r.body.url)).size, 1);
  assert.equal(created, createCount + 1);
  assert.equal(claim(f)?.id, first.id);
  assert.equal(claim(f)?.status, "checkout_created");
  assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM billing_checkout_attempts").get()?.n, 1);
  console.log("PASS lost response and simultaneous Starter retries create one provider Session and retain one trial claim");

  const beforePost = calls.filter(c => c.method === "POST").length;
  const resumed = await request(f, "starter", { expected: 200, body: { returnTo: "/different", discord_user_id: "discord-other", idempotency_key: "forged", price: "free" } });
  assert.equal(resumed.body.url, results[0].body.url);
  assert.equal(calls.filter(c => c.method === "POST").length, beforePost, "Known Sessions are retrieved, not created again.");
  await request(f, "pro", { expected: 409 });
  const other = await request(f, "pro", { token: f.other, expected: 200 });
  assert.notEqual(other.body.url, resumed.body.url);
  assert.notEqual(attempt(f, "discord-other").id, first.id);
  assert.equal(attempt(f).params_json, first.params_json);
  await request(f, "starter", { token: "invalid", expected: 401 });
  console.log("PASS private same-account resume, cross-account isolation, forged body fields ignored and plan-switch protection");

  const interrupted = await fixture();
  interrupted.db.failNextSessionSave = true;
  const beforeSave = created;
  await request(interrupted, "pro", { expected: 503 });
  const savedParams = attempt(interrupted).params_json;
  interrupted.env.STRIPE_PRICE_PRO = "price_changed_after_attempt";
  interrupted.env.DZN_APP_URL = "https://changed.local.test";
  await request(interrupted, "pro", { expected: 200, body: { returnTo: "/new" } });
  assert.equal(created, beforeSave + 1);
  assert.equal(attempt(interrupted).params_json, savedParams);
  assert.throws(() => interrupted.db.sqlite.prepare("UPDATE billing_checkout_attempts SET params_json = '{}' WHERE state != 'closed'").run(), /immutable/);
  assert.throws(() => interrupted.db.sqlite.prepare("UPDATE billing_checkout_attempts SET discord_user_id = 'someone-else'").run(), /immutable/);
  console.log("PASS post-provider database failure resumes same immutable request across changed prices/redirects");

  const expiredWindow = await fixture();
  failAfterCreate = true;
  await request(expiredWindow, "starter", { expected: 503 });
  const callsBeforeAge = calls.length;
  const ageAttempt = attempt(expiredWindow);
  clock += CHECKOUT_RETRY_SECONDS * 1000;
  const aged = await request(expiredWindow, "starter", { expected: 409 });
  assert.equal(aged.body.errorCode, "CHECKOUT_REVIEW_REQUIRED");
  assert.equal(calls.length, callsBeforeAge);
  assert.equal(attempt(expiredWindow).id, ageAttempt.id);
  assert.equal(claim(expiredWindow)?.id, ageAttempt.id);
  clock = originalNow();
  expiredWindow.env.STRIPE_SECRET_KEY = "sk_test_changed_key";
  await request(expiredWindow, "starter", { expected: 409 });
  assert.equal(calls.length, callsBeforeAge);
  console.log("PASS retry-window expiry/key rotation block new POSTs without releasing unknown attempts");

  const invalid = await fixture();
  badResponse = { id: "cs_invalid", mode: "subscription", url: "https://evil.invalid" };
  await request(invalid, "starter", { expected: 502 });
  const invalidId = claim(invalid)?.id;
  badResponse = null;
  await request(invalid, "starter", { expected: 200 });
  assert.equal(claim(invalid)?.id, invalidId);
  providerError = true;
  await request(invalid, "starter", { expected: 503 });
  providerError = false;
  const foreignSession = sessions.get(String(attempt(invalid).stripe_session_id))!;
  badResponse = { ...foreignSession, client_reference_id: "discord-other" };
  await request(invalid, "starter", { expected: 502 });
  badResponse = { ...foreignSession, livemode: true };
  await request(invalid, "starter", { expected: 502 });
  badResponse = { ...foreignSession, url: "https://checkout.stripe.com.evil.invalid/steal" };
  await request(invalid, "starter", { expected: 503 });
  badResponse = null;
  assert.equal(claim(invalid)?.id, invalidId);
  console.log("PASS invalid/missing response, provider error, foreign ownership, mode mismatch and unsafe URL never release a trial or leak provider data");

  const failedCreation = await fixture();
  providerError = true;
  await request(failedCreation, "starter", { expected: 503 });
  providerError = false;
  const failureAttempt = attempt(failedCreation);
  const failureKey = calls.at(-1)?.key;
  assert.equal(claim(failedCreation)?.id, failureAttempt.id);
  await request(failedCreation, "starter", { expected: 200 });
  assert.equal(calls.at(-1)?.key, failureKey);
  assert.equal(attempt(failedCreation).id, failureAttempt.id);
  console.log("PASS initial provider HTTP error preserves the attempt key and trial reservation");

  const expired = await fixture();
  await request(expired, "starter", { expected: 200 });
  const oldAttempt = attempt(expired);
  const expiredSession = sessions.get(String(oldAttempt.stripe_session_id))!;
  expiredSession.status = "expired";
  expired.db.failNextClaimRelease = true;
  await request(expired, "starter", { expected: 503 });
  assert.deepEqual(attempt(expired), oldAttempt, "Failed cleanup rolls back the attempt close and preserves the trial reservation.");
  assert.equal(claim(expired)?.id, oldAttempt.id);
  await request(expired, "starter", { expected: 409 });
  assert.equal(claim(expired), undefined);
  assert.equal(attempt(expired), undefined);
  await request(expired, "starter", { expected: 200 });
  assert.notEqual(attempt(expired).id, oldAttempt.id);
  assert.equal(expired.db.sqlite.prepare("SELECT count(*) AS n FROM billing_checkout_attempts WHERE state = 'closed'").get()?.n, 1);
  console.log("PASS verified-expiry cleanup is atomic; only the exact unused reservation is released and attempt history remains immutable");

  const complete = await fixture();
  await request(complete, "pro", { expected: 200 });
  const completeSession = sessions.get(String(attempt(complete).stripe_session_id))!;
  completeSession.status = "complete";
  Object.assign(completeSession, { subscription: "sub_completed", customer: "cus_first_checkout" });
  const completePosts = calls.filter(call => call.method === "POST").length;
  await request(complete, "pro", { expected: 409 });
  assert.equal(calls.filter(call => call.method === "POST").length, completePosts);
  assert.equal(complete.db.sqlite.prepare("SELECT count(*) AS n FROM owner_plan_entitlements").get()?.n, 0);
  await upsertBillingAccount(complete.env, { discordUserId: "discord-owner", stripeCustomerId: "cus_first_checkout", stripeSubscriptionId: "sub_completed", planKey: "pro", planStatus: "canceled" });
  await request(complete, "pro", { expected: 409 });
  assert.equal(attempt(complete), undefined);
  await request(complete, "pro", { expected: 200 });
  assert.equal(calls.filter(call => call.method === "POST").length, completePosts + 1);
  console.log("PASS completed Sessions cannot grant access or create another checkout; exact terminal subscription permits a later deliberate Pro attempt");

  const paid = await fixture();
  await request(paid, "starter", { expected: 200 });
  paid.db.sqlite.exec("UPDATE owner_starter_trial_claims SET status = 'trialing', stripe_subscription_id = 'sub_paid'");
  const paidBefore = claim(paid);
  await request(paid, "starter", { expected: 200 });
  assert.deepEqual(claim(paid), paidBefore, "Fast webhook state cannot be downgraded by checkout attach.");
  sessions.get(String(attempt(paid).stripe_session_id))!.status = "expired";
  await request(paid, "starter", { expected: 409 });
  assert.deepEqual(claim(paid), paidBefore, "A used trial can never be released by expiry cleanup.");
  await request(paid, "starter", { expected: 409 });
  await upsertBillingAccount(paid.env, { discordUserId: "discord-owner", stripeSubscriptionId: "sub_paid", planKey: "starter", planStatus: "past_due" });
  const blockedCalls = calls.length;
  await request(paid, "pro", { expected: 409 });
  assert.equal(calls.length, blockedCalls);
  console.log("PASS webhook-updated trial claims never regress or become reusable; existing overdue subscriptions go to Manage billing");

  const missing = await fixture(false);
  const beforeMissing = calls.length;
  await request(missing, "pro", { expected: 503 });
  assert.equal(calls.length, beforeMissing);
  assert.equal(missing.db.sqlite.prepare("SELECT count(*) AS n FROM owner_starter_trial_claims").get()?.n, 0);
  const paused = await fixture();
  paused.env.STRIPE_SECRET_KEY = "sk_live_blocked";
  await request(paused, "starter", { expected: 403 });
  assert.equal(calls.length, beforeMissing);
  console.log("PASS missing migration and disabled live checkout fail before provider contact or trial reservation");

  for (const fixture of [f, interrupted, expiredWindow, invalid, expired, failedCreation]) {
    assert.equal(fixture.db.sqlite.prepare("SELECT count(*) AS n FROM owner_billing_accounts").get()?.n, 0);
    assert.equal(fixture.db.sqlite.prepare("SELECT count(*) AS n FROM owner_plan_entitlements").get()?.n, 0);
    for (const sql of fixture.db.statements.filter(sql => /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))) {
      assert.match(sql, /^\s*(INSERT INTO|UPDATE|DELETE FROM) (billing_checkout_attempts|owner_starter_trial_claims)\b/);
    }
  }
  const prefixes = readdirSync("migrations").filter(name => /^\d+.*\.sql$/.test(name)).map(name => name.split("_")[0]);
  assert.equal(new Set(prefixes).size, prefixes.length);
  console.log("PASS checkout grants no entitlement, writes only attempt/trial-reservation records and has a unique additive migration number");
}

run().finally(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const f of fixtures) f.db.sqlite.close();
}).catch(error => { console.error(error); process.exitCode = 1; });
