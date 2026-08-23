import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluateBumpEligibility, publicAdvertisingFromState } from "../functions/_lib/advertising";
import { getBillingPlanSummaries, getBillingReadinessStatus, getCheckoutConfigured, getOwnerBillingStatus, getPlanConfig, getPlanFromStripePriceId, upsertOwnerEntitlements } from "../functions/_lib/plans";
import { onRequest as billingPlansHandler } from "../functions/api/billing/plans";
import { onRequest as checkoutHandler } from "../functions/api/billing/create-checkout-session";
import { onRequest as billingReadinessHandler } from "../functions/api/billing/readiness";
import { onRequest as webhookHandler } from "../functions/api/stripe/webhook";
import { sortPublicServersForDiscovery } from "../functions/api/public/servers";
import { canUseProFeature, getBumpCooldownDays, getListingLimits, getSubscriptionPlanPublicContract, getSubscriptionPlanPublicContracts, hasListingAutoPost, isProListing, normalizeListingPlanKey } from "../lib/billing/plans";
import type { Env, PagesFunction } from "../functions/_lib/types";

const starter = getPlanConfig("starter");
const pro = getPlanConfig("pro");
const premium = getPlanConfig("premium");

assert.equal(starter.can_use_ad_bumps, true);
assert.equal(pro.can_use_ad_bumps, true);
assert.equal(pro.included_bumps_per_month, 2);
assert.equal(pro.max_linked_servers, 3);
assert.equal(pro.monthly_price, 10);
assert.equal(pro.visibility_weight, 4);
assert.equal(pro.public_publish_interval_minutes, 1440);
assert.equal(premium.max_linked_servers, 3);
assert.equal(premium.included_bumps_per_month, 2);
assert.equal(premium.monthly_price, 10);
assert.equal(Math.round(premium.monthly_price * 100), 1000);
assert.equal(premium.visibility_weight, 4);
assert.equal(premium.public_publish_interval_minutes, 1440);
assert.equal(getPlanConfig("free").max_linked_servers, 1);
assert.equal(getPlanConfig("network").plan_key, "premium");
assert.equal(getPlanConfig("partner").plan_key, "premium");
assert.equal(getPlanConfig("network").monthly_price, 10);
assert.equal(getPlanConfig("partner").monthly_price, 10);

const publicContracts = getSubscriptionPlanPublicContracts();
assert.deepEqual(publicContracts.map((contract) => contract.key), ["starter", "pro"]);
assert.deepEqual(publicContracts.map((contract) => contract.priceLabel), ["£0 today, then £2/month", "£10/month"]);
assert.deepEqual(publicContracts.map((contract) => contract.trialDays), [2, 0]);
assert.deepEqual(publicContracts.map((contract) => contract.publicPublishingIntervalMinutes), [4320, 1440]);
assert.deepEqual(publicContracts.map((contract) => contract.visibilityWeight), [1, 4]);
assert.deepEqual(publicContracts.map((contract) => contract.promotionCreditsPerMonth), [0, 2]);
assert.deepEqual(publicContracts.map((contract) => contract.badgeShowcaseLimit), [3, 8]);
assert.equal(getSubscriptionPlanPublicContract("premium")?.key, "pro");
assert.equal(getSubscriptionPlanPublicContract("network")?.key, "pro");
assert.equal(getSubscriptionPlanPublicContract("partner")?.key, "pro");
assert.equal(getSubscriptionPlanPublicContract("free"), null);
for (const contract of publicContracts) {
  const fairness = contract.fairnessGuarantees.join(" ");
  assert.match(fairness, /Does not change ADM data collection/i);
  assert.match(fairness, /Does not change leaderboard rank/i);
  assert.match(fairness, /Does not allow badges, crowns or seasonal wins to be bought/i);
  assert.equal(/stripe|checkout|webhook|secret/i.test(JSON.stringify(contract)), false, "Public subscription contract must not expose billing implementation details.");
}

const now = new Date("2026-05-17T12:00:00.000Z");
assert.equal(evaluateBumpEligibility({ entitlements: starter, state: null, now }).ok, true);
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
      bump_count_current_period: 2,
    },
    now,
  }).code,
  "cooldown",
);

assert.equal(normalizeListingPlanKey(null), "free");
assert.equal(normalizeListingPlanKey("starter", "active"), "starter");
assert.equal(normalizeListingPlanKey("pro", "active"), "pro");
assert.equal(normalizeListingPlanKey("premium", "trialing"), "pro");
assert.equal(normalizeListingPlanKey("partner", "active"), "pro");
assert.equal(normalizeListingPlanKey("network", "active"), "pro");
assert.equal(normalizeListingPlanKey("pro", "past_due"), "free");
assert.equal(isProListing({ plan_key: "premium", subscription_status: "active" }), true);
assert.equal(isProListing({ plan_key: "pro", subscription_status: "canceled" }), false);
assert.equal(getListingLimits({ plan_key: "free" }).descriptionLimit, 500);
assert.equal(getListingLimits({ plan_key: "starter", subscription_status: "active" }).publicLabel, "Starter Listing");
assert.equal(getListingLimits({ plan_key: "premium", subscription_status: "active" }).descriptionLimit, 2500);
assert.equal(getListingLimits({ plan_key: "premium", subscription_status: "active" }).galleryLimit, 4);
assert.equal(getListingLimits({ plan_key: "free" }).galleryLimit, 0);
assert.equal(getBumpCooldownDays({ plan_key: "free" }), 30);
assert.equal(getBumpCooldownDays({ plan_key: "network", subscription_status: "active" }), 7);
assert.equal(canUseProFeature({ plan_key: "free" }, "custom_banner"), false);
assert.equal(canUseProFeature({ plan_key: "pro", subscription_status: "active" }, "custom_banner"), true);
assert.equal(hasListingAutoPost({ plan_key: "free" }, "server_advert"), true);
assert.equal(hasListingAutoPost({ plan_key: "free" }, "weekly_recap"), false);
assert.equal(hasListingAutoPost({ plan_key: "premium", subscription_status: "active" }, "weekly_recap"), true);

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
  NEXT_PUBLIC_STRIPE_PREMIUM_PRICE_ID: "price_premium",
  STRIPE_PRICE_NETWORK: "price_network_legacy",
  STRIPE_PRICE_PARTNER: "price_partner_legacy",
} as Env;
assert.equal(getPlanFromStripePriceId(env, "price_pro"), "pro");
assert.equal(getPlanFromStripePriceId(env, "price_premium"), "premium");
assert.equal(getPlanFromStripePriceId(env, "price_network_legacy"), "premium");
assert.equal(getPlanFromStripePriceId(env, "price_partner_legacy"), "premium");
assert.equal(getPlanFromStripePriceId(env, "price_missing"), "free");
assert.deepEqual(getCheckoutConfigured(env), { starter: true, pro: true });
assert.equal(getPlanFromStripePriceId({
  NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID: "price_network_public_legacy",
  NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID: "price_partner_public_legacy",
} as unknown as Env, "price_network_public_legacy"), "free");
assert.equal(getPlanFromStripePriceId({
  NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID: "price_network_public_legacy",
  NEXT_PUBLIC_STRIPE_PARTNER_PRICE_ID: "price_partner_public_legacy",
} as unknown as Env, "price_partner_public_legacy"), "free");

const partialEnv = {
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID: "price_1TY4c6JPrnZ0cnkH7207aAi4",
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_1TY4dDJPrnZ0cnkH4OhfEHmW",
} as Env;
assert.deepEqual(getCheckoutConfigured(partialEnv), { starter: true, pro: true });
const planSummaries = getBillingPlanSummaries(partialEnv);
assert.equal(planSummaries.find((plan) => plan.plan_key === "starter")?.configured, true);
assert.equal(planSummaries.some((plan) => String(plan.plan_key) === "premium"), false);
assert.deepEqual(planSummaries.map((plan) => plan.name), ["Starter", "Pro"]);
assert.equal(planSummaries.find((plan) => plan.plan_key === "starter")?.features.includes("No monthly promotion credits"), true);
assert.equal(planSummaries.find((plan) => plan.plan_key === "pro")?.features.includes("2 monthly promotion credits"), true);
assert.equal(planSummaries.find((plan) => plan.plan_key === "starter")?.public_contract.promotionCreditsPerMonth, 0);
assert.equal(planSummaries.find((plan) => plan.plan_key === "pro")?.public_contract.promotionCreditsPerMonth, 2);
assert.equal(planSummaries.find((plan) => plan.plan_key === "pro")?.public_contract.discoveryTreatment, "full_dzn_access");
assert.equal(planSummaries.every((plan) => plan.public_contract.trackingGuarantee.includes("All ADM tracking continues unchanged")), true);
const planSummaryKeys = planSummaries.map((plan) => String(plan.plan_key));
assert.equal(planSummaryKeys.includes("network"), false);
assert.equal(planSummaryKeys.includes("partner"), false);
assert.equal(JSON.stringify(planSummaries).includes("sk_test"), false);

const missingPremiumReadiness = getBillingReadinessStatus({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_SECRET_KEY: "sk_test_readiness",
  STRIPE_WEBHOOK_SECRET: "whsec_readiness",
} as Env);
assert.equal(missingPremiumReadiness.premiumConfigured, false);
assert.equal(missingPremiumReadiness.missingRequiredVars.includes("STRIPE_PRICE_PREMIUM"), false);

const completeReadiness = getBillingReadinessStatus({
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_PREMIUM: "price_premium",
  STRIPE_PRICE_NETWORK: "price_network_legacy",
  STRIPE_SECRET_KEY: "sk_live_secret_value_must_not_leak",
  STRIPE_WEBHOOK_SECRET: "whsec_secret_value_must_not_leak",
} as Env);
assert.equal(completeReadiness.starterConfigured, true);
assert.equal(completeReadiness.proConfigured, true);
assert.equal(completeReadiness.premiumConfigured, false);
assert.deepEqual(completeReadiness.activePlans.map((plan) => plan.plan_key), ["starter", "pro"]);
assert.deepEqual(completeReadiness.missingRequiredVars, []);
assert.deepEqual(completeReadiness.legacyVarsDetected, ["STRIPE_PRICE_PREMIUM", "STRIPE_PRICE_NETWORK"]);
assert.equal(completeReadiness.modeHint, "live");
assert.equal(JSON.stringify(completeReadiness).includes("sk_live_secret_value_must_not_leak"), false);
assert.equal(JSON.stringify(completeReadiness).includes("whsec_secret_value_must_not_leak"), false);
assert.equal(JSON.stringify(completeReadiness).includes("price_premium"), false);

const landingSource = readFileSync("components/dzn/dzn-landing-page.tsx", "utf8");
const pricingSection = landingSource.slice(landingSource.indexOf("const pricingPlans"), landingSource.indexOf("function GameModeGrid"));
for (const snippet of [
  "Starter",
  "Pro",
  "£0 today, then £2/month",
  "£10/month",
  "2-day free trial",
  "Cancel before trial expiry to pay nothing",
  "Start Starter trial",
  "Unlock Pro",
  "Full DZN Access",
  "Up to 3 linked DayZ servers",
  "Payment method required",
  "Open Pricing Comparison",
  "role=\"dialog\"",
  "aria-modal=\"true\"",
  "Close pricing comparison",
  "dzn-pricing-modal",
  "dzn-pricing-modal-open",
  "createPortal(pricingModal, document.body)",
  "CheckCircle2",
  "XCircle",
  "Pro Launch Advantage",
  "Pro recommended",
  "Description limit",
  "Gallery images",
  "Custom banner",
  "Bump cooldown",
  "Discord channels",
  "Discord auto posts",
  "Embed design",
  "Owner announcement",
  "Event promotion",
  "Featured and spotlight eligibility",
  "Leaderboard/stat advantage",
  "No paid advantage",
  "Pro helps your server look better, advertise better and understand performance better.",
  "Make the server look worth joining",
  "Quick Answers",
  "Clear answers about Starter and Pro",
  "pricingEntrySignals",
  "pricingValuePillars",
  "pricingTrustPills",
  "Fair competition",
  "Trial first",
  "Powerful tools",
  "Community driven",
  "Leaderboard rankings remain 100% skill-based.",
  "Does Pro affect leaderboard rank?",
  "What does Pro improve?",
  "Do Starter servers still compete?",
  "Can badges be bought?",
]) {
  assert.equal(pricingSection.includes(snippet), true, `Public pricing section should include ${snippet}.`);
}
assert.equal(/Premium|Network Listing|Partner Listing|Network plan|Partner plan/.test(pricingSection), false, "Public pricing section must only show Starter/Pro plans.");
assert.equal(/paid leaderboard rank|leaderboard rank boost|improves leaderboard rank|buy better leaderboard/i.test(pricingSection), false, "Pro pricing copy must not claim paid leaderboard rank.");
assert.equal(landingSource.includes("import { createPortal } from \"react-dom\";"), true, "Pricing modal should portal to document.body instead of rendering inside the animated pricing section.");

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
assert.equal(dashboardSource.includes("Full DZN Access, up to 3 linked servers, custom advert visuals, weekly bumping, enhanced Discord posts, featured and spotlight eligibility, and listing analytics"), true, "Owner billing cards should explain Pro value.");
assert.equal(dashboardSource.includes("Upgrade to Premium"), false, "Owner billing and Discord fallback cards should not present Premium as an advertising upgrade.");
assert.equal(dashboardSource.includes("Promo Credits"), true, "Owner dashboard billing summary should show promotion credit language.");
assert.equal(dashboardSource.includes("Admin billing readiness warning"), true, "Owner dashboard should include an admin-only billing readiness warning.");
assert.equal(dashboardSource.includes("included_bumps_per_month: 3"), false, "Dashboard fallback plans must not keep stale Pro 3 promotion credits.");
assert.equal(dashboardSource.includes("included_bumps_per_month: 12"), false, "Dashboard fallback plans must not keep stale Premium 12 promotion credits.");

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
  const plansJson = (await plansResponse.json()) as { plans: Array<{ plan_key: string; configured: boolean; monthly_price_gbp: number; price_label: string; public_contract: { key: string; promotionCreditsPerMonth: number; badgeShowcaseLimit: number; fairnessGuarantees: string[] } }> };
  assert.deepEqual(plansJson.plans.map((plan) => plan.plan_key), ["starter", "pro"]);
  assert.equal(plansJson.plans.find((plan) => plan.plan_key === "starter")?.configured, true);
  assert.equal(plansJson.plans.some((plan) => plan.plan_key === "premium"), false);
  assert.equal(plansJson.plans.map((plan) => plan.plan_key).includes("network"), false);
  assert.equal(plansJson.plans.map((plan) => plan.plan_key).includes("partner"), false);
  assert.equal(plansJson.plans.find((plan) => plan.plan_key === "starter")?.public_contract.badgeShowcaseLimit, 3);
  assert.equal(plansJson.plans.find((plan) => plan.plan_key === "pro")?.public_contract.promotionCreditsPerMonth, 2);
  assert.equal(plansJson.plans.find((plan) => plan.plan_key === "pro")?.public_contract.fairnessGuarantees.some((item) => /seasonal wins/i.test(item)), true);

  const unauthReadiness = await billingReadinessHandler(makeContext(billingReadinessHandler, new Request("https://local.test/api/billing/readiness"), {} as Env));
  assert.equal(unauthReadiness.status, 401);

  const readinessResponse = await billingReadinessHandler(makeContext(
    billingReadinessHandler,
    new Request("https://local.test/api/billing/readiness"),
    {
      ...fakeEnv,
      MOCK_AUTH: "true",
      STRIPE_PRICE_STARTER: "price_starter_ready",
      STRIPE_PRICE_PRO: "price_pro_ready",
      STRIPE_SECRET_KEY: "sk_test_endpoint_secret_must_not_leak",
      STRIPE_WEBHOOK_SECRET: "whsec_endpoint_secret_must_not_leak",
    } as Env,
  ));
  assert.equal(readinessResponse.status, 200);
  const readinessJson = await readinessResponse.json() as {
    starterConfigured: boolean;
    proConfigured: boolean;
    premiumConfigured: boolean;
    missingRequiredVars: string[];
    activePlans: Array<{ plan_key: string }>;
  };
  assert.equal(readinessJson.starterConfigured, true);
  assert.equal(readinessJson.proConfigured, true);
  assert.equal(readinessJson.premiumConfigured, false);
  assert.equal(readinessJson.missingRequiredVars.includes("STRIPE_PRICE_PREMIUM"), false);
  assert.deepEqual(readinessJson.activePlans.map((plan) => plan.plan_key), ["starter", "pro"]);
  const readinessText = JSON.stringify(readinessJson);
  assert.equal(readinessText.includes("sk_test_endpoint_secret_must_not_leak"), false);
  assert.equal(readinessText.includes("whsec_endpoint_secret_must_not_leak"), false);
  assert.equal(readinessText.includes("price_starter_ready"), false);

  const unauthCheckout = await checkoutHandler(makeContext(checkoutHandler, new Request("https://local.test/api/billing/create-checkout-session", { method: "POST" }), {} as Env));
  assert.equal(unauthCheckout.status, 401);

  const invalidCheckout = await checkoutHandler(makeContext(
    checkoutHandler,
    new Request("https://local.test/api/billing/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ plan_key: "network" }),
      headers: { "content-type": "application/json" },
    }),
    { ...fakeEnv, MOCK_AUTH: "true" } as Env,
  ));
  assert.equal(invalidCheckout.status, 400);
  assert.match(await invalidCheckout.text(), /paid plan/i);

  const legacyPremiumCheckout = await checkoutHandler(makeContext(
    checkoutHandler,
    new Request("https://local.test/api/billing/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ plan_key: "premium" }),
      headers: { "content-type": "application/json" },
    }),
    { ...fakeEnv, MOCK_AUTH: "true" } as Env,
  ));
  assert.equal(legacyPremiumCheckout.status, 400);
  assert.match(await legacyPremiumCheckout.text(), /paid plan/i);

  const missingPriceCheckout = await checkoutHandler(makeContext(
    checkoutHandler,
    new Request("https://local.test/api/billing/create-checkout-session", {
      method: "POST",
      body: JSON.stringify({ plan_key: "pro" }),
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

  const activeCheckoutPrices = {
    starter: "price_starter_active",
    pro: "price_pro_active",
  } as const;
  const activeCheckoutStatements: string[] = [];
  const activeCheckoutBindings: unknown[][] = [];
  const activeCheckoutEnv = createFakeEnv({
    statements: activeCheckoutStatements,
    bindings: activeCheckoutBindings,
  }) as Env;
  const capturedActiveCheckoutBodies: Record<keyof typeof activeCheckoutPrices, string> = {
    starter: "",
    pro: "",
  };
  globalThis.fetch = async (_input, init) => {
    const body = String(init?.body ?? "");
    const matchedPlan = (Object.keys(activeCheckoutPrices) as Array<keyof typeof activeCheckoutPrices>)
      .find((planKey) => body.includes(`metadata%5Bplan_key%5D=${planKey}`));
    if (matchedPlan) capturedActiveCheckoutBodies[matchedPlan] = body;
    return new Response(JSON.stringify({ id: "cs_test", url: "https://checkout.stripe.test/session" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    for (const planKey of Object.keys(activeCheckoutPrices) as Array<keyof typeof activeCheckoutPrices>) {
      const checkoutResponse = await checkoutHandler(makeContext(
        checkoutHandler,
        new Request("https://local.test/api/billing/create-checkout-session", {
          method: "POST",
          body: JSON.stringify({ plan_key: planKey, returnTo: "/dashboard" }),
          headers: { "content-type": "application/json" },
        }),
        {
          ...activeCheckoutEnv,
          MOCK_AUTH: "true",
          STRIPE_SECRET_KEY: "sk_test_placeholder",
          STRIPE_PRICE_STARTER: activeCheckoutPrices.starter,
          STRIPE_PRICE_PRO: activeCheckoutPrices.pro,
          NEXT_PUBLIC_APP_URL: "https://dzn-network.pages.dev",
        } as Env,
      ));
      assert.equal(checkoutResponse.status, 200);
      assert.match(capturedActiveCheckoutBodies[planKey], new RegExp(`line_items%5B0%5D%5Bprice%5D=${activeCheckoutPrices[planKey]}`));
      assert.match(capturedActiveCheckoutBodies[planKey], new RegExp(`metadata%5Bplan_key%5D=${planKey}`));
      assert.match(capturedActiveCheckoutBodies[planKey], /payment_method_collection=always/);
      assert.match(capturedActiveCheckoutBodies[planKey], /allow_promotion_codes=false/);
    }
    assert.match(capturedActiveCheckoutBodies.starter, /subscription_data%5Btrial_period_days%5D=2/);
    assert.match(capturedActiveCheckoutBodies.starter, /subscription_data%5Btrial_settings%5D%5Bend_behavior%5D%5Bmissing_payment_method%5D=cancel/);
    assert.equal(capturedActiveCheckoutBodies.pro.includes("trial_period_days"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    activeCheckoutStatements.filter((statement) => /^\s*INSERT INTO owner_starter_trial_claims/i.test(statement)).length,
    1,
    "Only Starter checkout should reserve a trial claim.",
  );
  assert.equal(
    activeCheckoutBindings.some((values) => values.includes("mock-discord-user") && values.includes("checkout_created")),
    true,
    "Starter checkout should reserve the claim before creating a Stripe session.",
  );

  let blockedStarterFetchCalled = false;
  globalThis.fetch = async () => {
    blockedStarterFetchCalled = true;
    return new Response(JSON.stringify({ id: "cs_blocked", url: "https://checkout.stripe.test/blocked" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const blockedStarterResponse = await checkoutHandler(makeContext(
      checkoutHandler,
      new Request("https://local.test/api/billing/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan_key: "starter", returnTo: "/dashboard" }),
        headers: { "content-type": "application/json" },
      }),
      {
        ...createFakeEnv({
          trialClaim: {
            id: "claim-used",
            discord_user_id: "mock-discord-user",
            stripe_customer_id: null,
            stripe_subscription_id: "sub_used",
            checkout_session_id: "cs_used",
            status: "canceled",
            claimed_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-17T00:00:00.000Z",
          },
        }),
        MOCK_AUTH: "true",
        STRIPE_SECRET_KEY: "sk_test_placeholder",
        STRIPE_PRICE_STARTER: activeCheckoutPrices.starter,
      } as Env,
    ));
    assert.equal(blockedStarterResponse.status, 409);
    assert.match(await blockedStarterResponse.text(), /Starter trial has already been used/i);
    assert.equal(blockedStarterFetchCalled, false, "Used Starter trials must be blocked before calling Stripe.");
  } finally {
    globalThis.fetch = originalFetch;
  }

  let blockedCustomerFetchCalled = false;
  globalThis.fetch = async () => {
    blockedCustomerFetchCalled = true;
    return new Response(JSON.stringify({ id: "cs_blocked_customer", url: "https://checkout.stripe.test/blocked-customer" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const blockedCustomerResponse = await checkoutHandler(makeContext(
      checkoutHandler,
      new Request("https://local.test/api/billing/create-checkout-session", {
        method: "POST",
        body: JSON.stringify({ plan_key: "starter", returnTo: "/dashboard" }),
        headers: { "content-type": "application/json" },
      }),
      {
        ...createFakeEnv({
          account: { stripe_customer_id: "cus_existing" },
          trialClaim: {
            id: "claim-customer-used",
            discord_user_id: "other-discord-user",
            stripe_customer_id: "cus_existing",
            stripe_subscription_id: "sub_existing",
            checkout_session_id: "cs_existing",
            status: "trialing",
            claimed_at: "2026-05-17T00:00:00.000Z",
            updated_at: "2026-05-17T00:00:00.000Z",
          },
        }),
        MOCK_AUTH: "true",
        STRIPE_SECRET_KEY: "sk_test_placeholder",
        STRIPE_PRICE_STARTER: activeCheckoutPrices.starter,
      } as Env,
    ));
    assert.equal(blockedCustomerResponse.status, 409);
    assert.match(await blockedCustomerResponse.text(), /Stripe customer/i);
    assert.equal(blockedCustomerFetchCalled, false, "Used Starter trials must also be blocked by known Stripe customer.");
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

  const starterWebhookPayload = JSON.stringify({
    id: "evt_checkout_starter",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_starter",
        customer: "cus_starter",
        subscription: "sub_starter",
        metadata: { discord_user_id: "discord-starter-webhook", plan_key: "starter" },
      },
    },
  });
  const starterWebhookBindings: unknown[][] = [];
  const starterWebhookEnv = createFakeEnv({ bindings: starterWebhookBindings }) as Env;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "sub_starter",
    object: "subscription",
    customer: "cus_starter",
    status: "trialing",
    cancel_at_period_end: false,
    items: {
      data: [{
        current_period_start: checkoutPeriodStart,
        current_period_end: checkoutPeriodEnd,
        price: { id: "price_starter_webhook" },
      }],
    },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const starterSignedWebhook = await webhookHandler(makeContext(
      webhookHandler,
      new Request("https://local.test/api/stripe/webhook", {
        method: "POST",
        body: starterWebhookPayload,
        headers: { "stripe-signature": await stripeSignatureHeader(starterWebhookPayload, "whsec_test") },
      }),
      {
        ...starterWebhookEnv,
        STRIPE_SECRET_KEY: "sk_test_placeholder",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_PRICE_STARTER: "price_starter_webhook",
      } as Env,
    ));
    assert.equal(starterSignedWebhook.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    starterWebhookBindings.some((values) =>
      values.includes("discord-starter-webhook") &&
      values.includes("cus_starter") &&
      values.includes("sub_starter") &&
      values.includes("cs_starter") &&
      values.includes("trialing")
    ),
    true,
    "Starter checkout webhooks should attach Stripe identifiers to the durable trial claim.",
  );
  assert.equal(starterWebhookBindings.some((values) => values.includes("discord-starter-webhook") && values.includes("starter")), true);

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
  trialClaim?: Record<string, unknown>;
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
            if (/FROM owner_billing_accounts/i.test(query) && options.account) return options.account;
            if (/FROM owner_starter_trial_claims/i.test(query) && options.trialClaim) return options.trialClaim;
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
