import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getBillingReadinessStatus } from "../functions/_lib/plans";
import type { Env } from "../functions/_lib/types";

const fallbackOnly = getBillingReadinessStatus({
  NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID: "price_public_starter_must_not_be_live_ready",
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: "price_public_pro_must_not_be_live_ready",
  DZN_APP_URL: "https://dayz-network.com",
} as Env);

assert.equal(fallbackOnly.starterConfigured, true, "Checkout compatibility may still see public Starter fallback.");
assert.equal(fallbackOnly.proConfigured, true, "Checkout compatibility may still see public Pro fallback.");
assert.equal(fallbackOnly.liveConfigurationReady, false, "Public fallback price aliases must not make live billing ready.");
assert.equal(fallbackOnly.priceSources.starter.source, "public_fallback");
assert.equal(fallbackOnly.priceSources.pro.source, "public_fallback");
assert.equal(fallbackOnly.priceSources.starter.liveReady, false);
assert.equal(fallbackOnly.priceSources.pro.liveReady, false);
assert.equal(fallbackOnly.missingLiveRequiredVars.includes("STRIPE_PRICE_STARTER"), true);
assert.equal(fallbackOnly.missingLiveRequiredVars.includes("STRIPE_PRICE_PRO"), true);
assert.equal(fallbackOnly.publicFallbackPriceVarsDetected.includes("NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID"), true);
assert.equal(fallbackOnly.publicFallbackPriceVarsDetected.includes("NEXT_PUBLIC_STRIPE_PRO_PRICE_ID"), true);
assert.equal(fallbackOnly.readinessChecks.some((check) => check.key === "human-approved-live-step" && check.severity === "info" && check.ok === false), true);
assert.equal(fallbackOnly.productionMutationAllowedByReadinessCheck, false);
assert.equal(fallbackOnly.humanApprovalRequiredForLiveBilling, true);

const testMode = getBillingReadinessStatus({
  STRIPE_PRICE_STARTER: "price_server_starter",
  STRIPE_PRICE_PRO: "price_server_pro",
  STRIPE_SECRET_KEY: "sk_test_secret_value_must_not_leak",
  STRIPE_WEBHOOK_SECRET: "whsec_test_value_must_not_leak",
  DZN_APP_URL: "https://dayz-network.com",
} as Env);

assert.equal(testMode.starterConfigured, true);
assert.equal(testMode.proConfigured, true);
assert.equal(testMode.modeHint, "test");
assert.equal(testMode.liveConfigurationReady, false, "Test-mode Stripe secret must not pass live readiness.");
assert.deepEqual(testMode.missingLiveRequiredVars, ["STRIPE_SECRET_KEY"]);
assert.equal(testMode.readinessChecks.find((check) => check.key === "stripe-live-secret")?.ok, false);

const previewUrl = getBillingReadinessStatus({
  STRIPE_PRICE_STARTER: "price_server_starter",
  STRIPE_PRICE_PRO: "price_server_pro",
  STRIPE_SECRET_KEY: "sk_live_secret_value_must_not_leak",
  STRIPE_WEBHOOK_SECRET: "whsec_live_value_must_not_leak",
  DZN_APP_URL: "https://codex-preview.dzn-network.pages.dev",
} as Env);

assert.equal(previewUrl.liveConfigurationReady, false, "Preview Pages URLs must not pass live readiness.");
assert.equal(previewUrl.missingLiveRequiredVars.includes("DZN_APP_URL"), true);
assert.equal(previewUrl.readinessChecks.find((check) => check.key === "production-app-url")?.ok, false);

const liveReady = getBillingReadinessStatus({
  STRIPE_PRICE_STARTER: "price_server_starter",
  STRIPE_PRICE_PRO: "price_server_pro",
  STRIPE_PRICE_PREMIUM: "price_legacy_premium",
  STRIPE_PRICE_NETWORK: "price_legacy_network",
  STRIPE_PRICE_PARTNER: "price_legacy_partner",
  STRIPE_SECRET_KEY: "sk_live_secret_value_must_not_leak",
  STRIPE_WEBHOOK_SECRET: "whsec_live_value_must_not_leak",
  DZN_APP_URL: "https://dayz-network.com",
} as Env);

assert.equal(liveReady.liveConfigurationReady, true);
assert.equal(liveReady.priceSources.starter.source, "server");
assert.equal(liveReady.priceSources.pro.source, "server");
assert.deepEqual(liveReady.activePlans.map((plan) => plan.plan_key), ["starter", "pro"]);
assert.equal(liveReady.premiumConfigured, false);
assert.deepEqual(liveReady.missingRequiredVars, []);
assert.deepEqual(liveReady.missingLiveRequiredVars, []);
assert.deepEqual(liveReady.legacyVarsDetected, ["STRIPE_PRICE_PREMIUM", "STRIPE_PRICE_NETWORK", "STRIPE_PRICE_PARTNER"]);
assert.equal(liveReady.readinessChecks.filter((check) => check.severity === "blocker").every((check) => check.ok), true);
assert.equal(liveReady.readinessChecks.find((check) => check.key === "human-approved-live-step")?.ok, false);

for (const [label, payload] of Object.entries({ fallbackOnly, testMode, previewUrl, liveReady })) {
  const text = JSON.stringify(payload);
  assert.equal(/sk_(?:test|live)_secret_value_must_not_leak/.test(text), false, `${label} must not expose Stripe secret values.`);
  assert.equal(/whsec_(?:test|live|endpoint|readiness|value)_/.test(text), false, `${label} must not expose webhook secret values.`);
  assert.equal(/price_(?:public|server|legacy)_/.test(text), false, `${label} must not expose Stripe Price IDs.`);
}

const stripeSetupDoc = readFileSync("docs/STRIPE_LIVE_SETUP.md", "utf8");
for (const snippet of [
  "Live billing remains a high-risk human-approved operation.",
  "`NEXT_PUBLIC_STRIPE_*_PRICE_ID` values are compatibility fallbacks only",
  "liveConfigurationReady",
  "Creating live Stripe products, changing live Price IDs, changing webhook endpoints, setting production secrets, importing customers, applying D1 migrations, or enabling live payments still requires a separate explicit high-risk human approval",
  "npm run check:billing-config",
]) {
  assert.equal(stripeSetupDoc.includes(snippet), true, `Stripe live setup doc should include: ${snippet}`);
}

const billingPlansDoc = readFileSync("docs/BILLING_PLANS.md", "utf8");
for (const snippet of [
  "Live Stripe Readiness",
  "`NEXT_PUBLIC_STRIPE_*_PRICE_ID` variables are compatibility fallbacks only",
  "The readiness check is read-only.",
]) {
  assert.equal(billingPlansDoc.includes(snippet), true, `Billing plans doc should include: ${snippet}`);
}

const dashboardSource = readFileSync("components/onboarding/dashboard.tsx", "utf8");
for (const snippet of [
  "Live billing is not ready yet.",
  "Secret values and Price IDs are never shown here.",
  "Live Stripe changes still require explicit human approval.",
]) {
  assert.equal(dashboardSource.includes(snippet), true, `Dashboard readiness warning should include: ${snippet}`);
}

const configCheckSource = readFileSync("scripts/check-billing-config.ts", "utf8");
for (const snippet of [
  "Live billing configuration ready?",
  "Readiness check is read-only",
  "Live setup missing:",
]) {
  assert.equal(configCheckSource.includes(snippet), true, `Billing config check should include: ${snippet}`);
}

console.log("Stripe live readiness regression checks passed.");
