import assert from "node:assert/strict";

import { evaluateBumpEligibility, publicAdvertisingFromState } from "../functions/_lib/advertising";
import { getBillingPlanSummaries, getCheckoutConfigured, getOwnerBillingStatus, getPlanConfig, getPlanFromStripePriceId, upsertOwnerEntitlements } from "../functions/_lib/plans";
import { onRequest as billingPlansHandler } from "../functions/api/billing/plans";
import { onRequest as checkoutHandler } from "../functions/api/billing/create-checkout-session";
import { onRequest as webhookHandler } from "../functions/api/stripe/webhook";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import type { Env, PagesFunction } from "../functions/_lib/types";

const starter = getPlanConfig("starter");
const pro = getPlanConfig("pro");
const network = getPlanConfig("network");

assert.equal(starter.can_use_ad_bumps, false);
assert.equal(pro.can_use_ad_bumps, true);
assert.equal(pro.max_linked_servers, 3);
assert.equal(network.max_linked_servers, 10);
assert.equal(getPlanConfig("free").max_linked_servers, 1);

const now = new Date("2026-05-17T12:00:00.000Z");
assert.deepEqual(evaluateBumpEligibility({ entitlements: starter, state: null, now }).code, "upgrade_required");
assert.equal(evaluateBumpEligibility({ entitlements: pro, state: null, now }).ok, true);
assert.deepEqual(
  evaluateBumpEligibility({
    entitlements: pro,
    state: {
      last_bumped_at: "2026-05-17T00:30:00.000Z",
      bump_count_current_period: 1,
    },
    now,
  }).code,
  "cooldown",
);
assert.deepEqual(
  evaluateBumpEligibility({
    entitlements: pro,
    state: {
      last_bumped_at: "2026-05-15T00:30:00.000Z",
      bump_count_current_period: 3,
    },
    now,
  }).code,
  "limit_reached",
);

const featured = publicAdvertisingFromState({ featured_until: "2026-05-18T12:00:00.000Z", featured_label: "featured" }, now);
const boosted = publicAdvertisingFromState({ last_bumped_at: "2026-05-17T10:00:00.000Z" }, now);
const organic = publicAdvertisingFromState(null, now);
assert.equal(featured.badge_label, "FEATURED");
assert.equal(boosted.badge_label, "BOOSTED");
assert.equal(boosted.boosted_until, "2026-05-18T10:00:00.000Z");
assert.equal(boosted.boosted_time_left_label, "22h left");
assert.equal(organic.badge_label, null);
assert.equal(organic.boosted_until, null);
assert.equal(organic.boosted_time_left_label, null);

const sorted = sortPublicServersForDiscovery([
  { advertising: organic, rank: 1, score: 500, created_at: "2026-05-17T00:00:00.000Z", id: "organic" },
  { advertising: boosted, rank: 9, score: 10, created_at: "2026-05-17T00:00:00.000Z", id: "boosted" },
  { advertising: featured, rank: 99, score: 1, created_at: "2026-05-17T00:00:00.000Z", id: "featured" },
]);
assert.equal(sorted[0].id, "featured");
assert.equal(sorted[1].id, "boosted");
assert.equal(sorted[2].id, "organic");
assert.equal(sorted[1].rank, 9);
assert.equal(sorted[1].score, 10);
assert.equal(sorted[2].rank, 1);
assert.equal(sorted[2].score, 500);
assert.equal(JSON.stringify(sorted).includes("stripe_customer_id"), false);
assert.equal(JSON.stringify(sorted).includes("stripe_subscription_id"), false);

const env = {
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID: "price_starter",
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_pro",
  NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID: "price_network",
  NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID: "price_partner",
} as Env;
assert.equal(getPlanFromStripePriceId(env, "price_pro"), "pro");
assert.equal(getPlanFromStripePriceId(env, "price_missing"), "free");
assert.deepEqual(getCheckoutConfigured(env), { starter: true, pro: true, network: true, partner: true });

const partialEnv = {
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID: "price_1TY4c6JPrnZ0cnkH7207aAi4",
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_1TY4dDJPrnZ0cnkH4OhfEHmW",
} as Env;
assert.deepEqual(getCheckoutConfigured(partialEnv), { starter: true, pro: true, network: false, partner: false });
const planSummaries = getBillingPlanSummaries(partialEnv);
assert.equal(planSummaries.find((plan) => plan.plan_key === "starter")?.configured, true);
assert.equal(planSummaries.find((plan) => plan.plan_key === "network")?.configured, false);
assert.equal(JSON.stringify(planSummaries).includes("sk_test"), false);

const statements: string[] = [];
const bindings: unknown[][] = [];
const fakeEnv = {
  DB: {
    prepare(query: string) {
      statements.push(query);
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return this;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async first() {
          return null;
        },
        async all() {
          return { success: true, meta: {}, results: [] };
        },
        async raw() {
          return [];
        },
      };
    },
    async batch() {
      return [];
    },
    async exec() {
      return { success: true, meta: {} };
    },
  },
} as unknown as Env;

async function run() {
  await upsertOwnerEntitlements(fakeEnv, "discord-1", "pro", "active");
  assert.equal(bindings.some((values) => values.includes("discord-1") && values.includes("pro")), true);
  await upsertOwnerEntitlements(fakeEnv, "discord-2", "pro", "canceled");
  assert.equal(bindings.some((values) => values.includes("discord-2") && values.includes("free")), true);
  assert.equal(statements.some((statement) => statement.includes("owner_plan_entitlements")), true);

  const plansResponse = await billingPlansHandler(makeContext(billingPlansHandler, new Request("https://local.test/api/billing/plans"), partialEnv));
  assert.equal(plansResponse.status, 200);
  const plansJson = (await plansResponse.json()) as { plans: Array<{ plan_key: string; configured: boolean }> };
  assert.equal(plansJson.plans.find((plan) => plan.plan_key === "starter")?.configured, true);
  assert.equal(plansJson.plans.find((plan) => plan.plan_key === "partner")?.configured, false);

  const unauthCheckout = await checkoutHandler(makeContext(checkoutHandler, new Request("https://local.test/api/billing/create-checkout-session", { method: "POST" }), {} as Env));
  assert.equal(unauthCheckout.status, 401);

  const missingPriceCheckout = await checkoutHandler(makeContext(
    checkoutHandler,
    new Request("https://local.test/api/billing/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ plan_key: "network" }),
      headers: { "content-type": "application/json" },
    }),
    { ...fakeEnv, MOCK_AUTH: "true" } as Env,
  ));
  assert.equal(missingPriceCheckout.status, 400);
  assert.match(await missingPriceCheckout.text(), /not configured/i);

  let capturedStripeBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    capturedStripeBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.test/session" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const checkoutResponse = await checkoutHandler(makeContext(
      checkoutHandler,
      new Request("https://local.test/api/billing/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan_key: "pro", returnTo: "/dashboard" }),
        headers: { "content-type": "application/json" },
      }),
      {
        ...fakeEnv,
        MOCK_AUTH: "true",
        STRIPE_SECRET_KEY: "sk_test_placeholder",
        NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_1TY4dDJPrnZ0cnkH4OhfEHmW",
        NEXT_PUBLIC_APP_URL: "https://dzn-network.pages.dev",
      } as Env,
    ));
    assert.equal(checkoutResponse.status, 200);
    assert.match(capturedStripeBody, /line_items%5B0%5D%5Bprice%5D=price_1TY4dDJPrnZ0cnkH4OhfEHmW/);
    assert.match(capturedStripeBody, /metadata%5Bdiscord_user_id%5D=mock-discord-user/);
    assert.match(capturedStripeBody, /metadata%5Bplan_key%5D=pro/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const invalidWebhook = await webhookHandler(makeContext(
    webhookHandler,
    new Request("https://local.test/api/stripe/webhook", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=invalid" },
    }),
    { STRIPE_WEBHOOK_SECRET: "whsec_test" } as Env,
  ));
  assert.equal(invalidWebhook.status, 400);

  const webhookPayload = JSON.stringify({
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test",
        customer: "cus_test",
        subscription: "sub_test",
        metadata: { discord_user_id: "discord-webhook", plan_key: "pro" },
      },
    },
  });
  const checkoutPeriodStart = Math.floor(Date.parse("2026-05-17T00:00:00.000Z") / 1000);
  const checkoutPeriodEnd = Math.floor(Date.parse("2026-06-17T00:00:00.000Z") / 1000);
  const webhookBindings: unknown[][] = [];
  const webhookEnv = createFakeEnv({ bindings: webhookBindings }) as Env;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "sub_test",
    object: "subscription",
    customer: "cus_test",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [{
        current_period_start: checkoutPeriodStart,
        current_period_end: checkoutPeriodEnd,
        price: { id: "price_1TY4dDJPrnZ0cnkH4OhfEHmW" },
      }],
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const signedWebhook = await webhookHandler(makeContext(
      webhookHandler,
      new Request("https://local.test/api/stripe/webhook", {
        method: "POST",
        body: webhookPayload,
        headers: { "stripe-signature": await stripeSignatureHeader(webhookPayload, "whsec_test") },
      }),
      {
        ...webhookEnv,
        STRIPE_SECRET_KEY: "sk_test_placeholder",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_1TY4dDJPrnZ0cnkH4OhfEHmW",
      } as Env,
    ));
    assert.equal(signedWebhook.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(webhookBindings.some((values) => values.includes("discord-webhook") && values.includes("pro")), true);
  assert.equal(webhookBindings.some((values) => values.includes("2026-06-17T00:00:00.000Z")), true);

  const rootPeriodBindings: unknown[][] = [];
  const rootPeriodPayload = JSON.stringify({
    id: "evt_created",
    type: "customer.subscription.created",
    data: {
      object: {
        id: "sub_created",
        object: "subscription",
        customer: "cus_created",
        status: "active",
        current_period_start: checkoutPeriodStart,
        current_period_end: checkoutPeriodEnd,
        cancel_at_period_end: true,
        metadata: { discord_user_id: "discord-created", plan_key: "pro" },
        items: { data: [{ price: { id: "price_1TY4dDJPrnZ0cnkH4OhfEHmW" } }] },
      },
    },
  });
  const rootPeriodResponse = await webhookHandler(makeContext(
    webhookHandler,
    new Request("https://local.test/api/stripe/webhook", {
      method: "POST",
      body: rootPeriodPayload,
      headers: { "stripe-signature": await stripeSignatureHeader(rootPeriodPayload, "whsec_test") },
    }),
    {
      ...createFakeEnv({ bindings: rootPeriodBindings }),
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_1TY4dDJPrnZ0cnkH4OhfEHmW",
    } as Env,
  ));
  assert.equal(rootPeriodResponse.status, 200);
  assert.equal(rootPeriodBindings.some((values) => values.includes("2026-06-17T00:00:00.000Z")), true);
  assert.equal(rootPeriodBindings.some((values) => values.includes(1)), true);

  const deletedBindings: unknown[][] = [];
  const deletedEnv = createFakeEnv({
    account: {
      discord_user_id: "discord-deleted",
      plan_key: "pro",
      plan_status: "active",
      current_period_start: "2026-05-01T00:00:00.000Z",
      current_period_end: "2026-06-01T00:00:00.000Z",
      cancel_at_period_end: 0,
    },
    bindings: deletedBindings,
  }) as Env;
  const deletedPayload = JSON.stringify({
    id: "evt_deleted",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_deleted",
        object: "subscription",
        customer: "cus_deleted",
        status: "canceled",
        current_period_start: 1772323200,
        current_period_end: 1775001600,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_1TY4dDJPrnZ0cnkH4OhfEHmW" } }] },
      },
    },
  });
  const deletedResponse = await webhookHandler(makeContext(
    webhookHandler,
    new Request("https://local.test/api/stripe/webhook", {
      method: "POST",
      body: deletedPayload,
      headers: { "stripe-signature": await stripeSignatureHeader(deletedPayload, "whsec_test") },
    }),
    {
      ...deletedEnv,
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_1TY4dDJPrnZ0cnkH4OhfEHmW",
    } as Env,
  ));
  assert.equal(deletedResponse.status, 200);
  assert.equal(deletedBindings.some((values) => values.includes("discord-deleted") && values.includes("free")), true);

  const activeStatus = await getOwnerBillingStatus(createFakeEnv({
    account: {
      discord_user_id: "discord-active",
      plan_key: "pro",
      plan_status: "active",
      current_period_start: "2026-05-17T00:00:00.000Z",
      current_period_end: "2026-06-17T00:00:00.000Z",
      cancel_at_period_end: 0,
      stripe_customer_id: "cus_active",
    },
  }) as Env, {
    id: "user-active",
    discord_id: "discord-active",
    username: "Active",
    avatar: null,
  });
  assert.equal(activeStatus.plan_key, "pro");
  assert.equal(activeStatus.current_period_end, "2026-06-17T00:00:00.000Z");
  assert.equal(activeStatus.current_period_end_label, "17 Jun 2026");

  const cancelStatus = await getOwnerBillingStatus(createFakeEnv({
    account: {
      discord_user_id: "discord-cancel",
      plan_key: "pro",
      plan_status: "active",
      current_period_end: "2026-06-17T00:00:00.000Z",
      cancel_at_period_end: 1,
      stripe_customer_id: "cus_cancel",
    },
  }) as Env, {
    id: "user-cancel",
    discord_id: "discord-cancel",
    username: "Cancel",
    avatar: null,
  });
  assert.equal(cancelStatus.cancel_at_period_end, true);
  assert.equal(cancelStatus.current_period_end_label, "17 Jun 2026");

  const missingPeriodStatus = await getOwnerBillingStatus(createFakeEnv({
    account: {
      discord_user_id: "discord-missing-period",
      plan_key: "pro",
      plan_status: "active",
      current_period_end: null,
      cancel_at_period_end: 0,
      stripe_customer_id: "cus_missing",
    },
  }) as Env, {
    id: "user-missing",
    discord_id: "discord-missing-period",
    username: "Missing",
    avatar: null,
  });
  assert.equal(missingPeriodStatus.current_period_end_label, "Awaiting Stripe update");

  console.log("Billing plan and advertising tests passed.");
}

void run();

function createFakeEnv(options: {
  account?: Record<string, unknown>;
  statements?: string[];
  bindings?: unknown[][];
} = {}) {
  const localStatements = options.statements ?? [];
  const localBindings = options.bindings ?? [];
  return {
    DB: {
      prepare(query: string) {
        localStatements.push(query);
        return {
          bind(...values: unknown[]) {
            localBindings.push(values);
            return this;
          },
          async run() {
            return { success: true, meta: {} };
          },
          async first() {
            if (/SELECT \* FROM owner_billing_accounts/i.test(query) && options.account) return options.account;
            return null;
          },
          async all() {
            return { success: true, meta: {}, results: [] };
          },
          async raw() {
            return [];
          },
        };
      },
      async batch() {
        return [];
      },
      async exec() {
        return { success: true, meta: {} };
      },
    },
  };
}

function makeContext(handler: PagesFunction, request: Request, env: Env): Parameters<typeof handler>[0] {
  return {
    request,
    env,
    params: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  };
}

async function stripeSignatureHeader(payload: string, secret: string) {
  const timestamp = "1770000000";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}
