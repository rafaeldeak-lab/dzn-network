import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { classifyPath } from "./autodev/risk-classifier";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function walk(dir: string, matcher: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name).replace(/\\/g, "/");
    const stats = statSync(path);
    if (stats.isDirectory()) {
      results.push(...walk(path, matcher));
    } else if (matcher(path)) {
      results.push(path);
    }
  }
  return results;
}

const activationDoc = read("docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md");
for (const snippet of [
  "Issue #49",
  "does not approve live billing",
  "Live billing activation is high-risk billing and production-mutation work.",
  "Generic messages such as \"next\", \"continue\", \"fix billing\", or \"set up Stripe\" are not enough.",
  "| Starter | 2-day free trial | GBP 0 today, then GBP 2/month after the trial unless cancelled |",
  "| Pro | Full DZN Access | GBP 10/month charged immediately and renewed monthly |",
  "Premium, Network, and Partner are historical compatibility values only.",
  "Plans must never change:",
  "Starter trial abuse protection is present and reviewed before live billing is enabled.",
  "Live checkout remains paused until the final approved go-live step sets `DZN_LIVE_CHECKOUT_ENABLED=true`.",
  "`NEXT_PUBLIC_STRIPE_*_PRICE_ID` values are fallback compatibility aliases only.",
  "AutoDev must treat these as blocked",
  "`stripe products create`",
  "`stripe prices create`",
  "`wrangler pages secret put STRIPE_SECRET_KEY`",
  "`wrangler pages secret put STRIPE_WEBHOOK_SECRET`",
  "`wrangler pages secret put DZN_LIVE_CHECKOUT_ENABLED`",
]) {
  assert.equal(activationDoc.includes(snippet), true, `Activation checklist should include: ${snippet}`);
}

const stripeSetupDoc = read("docs/STRIPE_LIVE_SETUP.md");
for (const snippet of [
  "Live billing remains a high-risk human-approved operation.",
  "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md",
  "Issue #49",
]) {
  assert.equal(stripeSetupDoc.includes(snippet), true, `Stripe live setup doc should link checklist: ${snippet}`);
}

const billingPlansDoc = read("docs/BILLING_PLANS.md");
for (const snippet of [
  "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md",
  "Issue #49",
  "Live Stripe product/price creation, webhook endpoint changes, Cloudflare secret changes, D1 migration application, customer import, checkout enablement, and payment enablement remain separate high-risk human-approved operations.",
]) {
  assert.equal(billingPlansDoc.includes(snippet), true, `Billing plans doc should include live activation boundary: ${snippet}`);
}

const config = JSON.parse(read(".autodev/config.json"));
assert.equal(config.mode, "pr_only");
assert.equal(config.allowAutomaticProductionDeploy, false);
assert.equal(config.allowProductionMutations, false);
assert.equal(config.codex.autoMerge, false);
assert.equal(config.codex.issueLabelsBlocked.includes("billing"), true);
assert.equal(config.codex.issueLabelsBlocked.includes("stripe"), true);
assert.equal(config.codex.issueLabelsBlocked.includes("production-mutation"), true);

assert.equal(classifyPath("scripts/stripe-live-activation.ts", "stripe products create --name 'DZN Starter'").risk, "blocked");
assert.equal(classifyPath("scripts/stripe-live-prices.ts", "await execa('stripe', ['prices', 'create', '--unit-amount', '200']);").risk, "blocked");
assert.equal(classifyPath("scripts/stripe-live-api.ts", "curl -X POST https://api.stripe.com/v1/products").risk, "blocked");
assert.equal(classifyPath(".github/workflows/stripe-secret.yml", "run: npx wrangler pages secret put STRIPE_SECRET_KEY --project-name dzn-network").risk, "blocked");
assert.equal(classifyPath(".github/workflows/stripe-live-checkout.yml", "run: npx wrangler pages secret put DZN_LIVE_CHECKOUT_ENABLED --project-name dzn-network").risk, "blocked");
assert.equal(classifyPath("wrangler.toml", "DZN_LIVE_CHECKOUT_ENABLED=true").risk, "blocked");
assert.equal(classifyPath("docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md", activationDoc).risk, "low");

const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
assert.equal(typeof scripts["test:stripe-live-activation-checklist"], "string");
assert.equal(scripts.test.includes("test:stripe-live-activation-checklist"), true);

const suspiciousPackageScripts = Object.entries(scripts).filter(([name, command]) => {
  if (name === "test") return false;
  if (/^(test|check):/.test(name)) return false;
  return /\b(?:stripe|billing)\b/i.test(`${name} ${command}`) && /\b(?:activate|go-live|live|provision|secret|webhook|product|price)\b/i.test(`${name} ${command}`);
});
assert.deepEqual(suspiciousPackageScripts, [], "Package scripts must not add live Stripe activation/provisioning commands.");

const automationFiles = [
  ...walk(".github/workflows", (path) => /\.ya?ml$/i.test(path)),
  ...walk("scripts", (path) => /\.(?:ts|js|mjs|cjs|sh)$/i.test(path)),
].filter((path) => {
  if (/^scripts\/test-/.test(path)) return false;
  if (/^scripts\/autodev\/(?:audit|pick-safe-issue|risk-classifier)\.ts$/.test(path)) return false;
  return true;
});

const forbiddenAutomationPatterns: Array<[RegExp, string]> = [
  [/\bstripe\s+(?:products?|prices?|webhook(?:_endpoints)?|customers?|subscriptions?)\s+(?:create|update|delete)\b/i, "Stripe CLI mutation command"],
  [/\bstripe["'`]\s*,\s*\[[\s\S]{0,160}["'`](?:products?|prices?|webhook_endpoints|customers?|subscriptions?)["'`]\s*,\s*["'`](?:create|update|delete)["'`]/i, "Stripe CLI mutation subprocess call"],
  [/\b(?:curl|fetch|Invoke-RestMethod|Invoke-WebRequest)\b[\s\S]{0,180}\bapi\.stripe\.com\/v1\/(?:products|prices|webhook_endpoints|customers|subscriptions)\b[\s\S]{0,180}\b(?:POST|PUT|PATCH|DELETE)\b/i, "direct Stripe API mutation call"],
  [/\b(?:curl|fetch|Invoke-RestMethod|Invoke-WebRequest)\b[\s\S]{0,180}\b(?:POST|PUT|PATCH|DELETE)\b[\s\S]{0,180}\bapi\.stripe\.com\/v1\/(?:products|prices|webhook_endpoints|customers|subscriptions)\b/i, "direct Stripe API mutation call"],
  [/\b(?:npx\s+)?wrangler\s+pages\s+secret\s+put\s+(?:STRIPE_PRICE_STARTER|STRIPE_PRICE_PRO|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|DZN_LIVE_CHECKOUT_ENABLED)\b/i, "Stripe production secret mutation command"],
  [/\bDZN_LIVE_CHECKOUT_ENABLED\b\s*(?:=|:)\s*["'`]?(?:true|1|yes|on)["'`]?\b/i, "live checkout enablement flag assignment"],
];

for (const file of automationFiles) {
  const text = read(file);
  for (const [pattern, label] of forbiddenAutomationPatterns) {
    assert.equal(pattern.test(text), false, `${file} must not contain ${label}.`);
  }
}

console.log("Stripe live activation checklist regression checks passed.");
