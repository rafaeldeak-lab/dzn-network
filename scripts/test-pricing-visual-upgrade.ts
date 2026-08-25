import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function includesAll(source: string, snippets: string[], label: string) {
  for (const snippet of snippets) {
    assert.equal(source.includes(snippet), true, `${label} should include ${snippet}`);
  }
}

function featureCountForPlan(source: string, planKey: "starter" | "pro") {
  const keyIndex = source.indexOf(`key: "${planKey}"`);
  assert.notEqual(keyIndex, -1, `${planKey} plan block should exist.`);
  const featuresIndex = source.indexOf("features: [", keyIndex);
  assert.notEqual(featuresIndex, -1, `${planKey} features array should exist.`);
  const featureEnd = source.indexOf("],", featuresIndex);
  assert.notEqual(featureEnd, -1, `${planKey} features array should close.`);
  const featureBlock = source.slice(featuresIndex, featureEnd);
  return (featureBlock.match(/^\s+"[^"]+",?$/gm) ?? []).length;
}

function assertAsset(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  assert.equal(statSync(path).size > 1000, true, `${path} should be a real image asset.`);
}

const pricingPage = read("app/pricing/page.tsx");
const globals = read("app/globals.css");
const masterSpec = read("docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md");

includesAll(
  pricingPage,
  [
    "PricingBackground",
    "dzn-pricing-bg-layer",
    "dzn-pricing-fog-layer",
    "/media/dzn-pricing-bg-layer.png",
    "/media/dzn-pricing-fog-ember-overlay.png",
    "/media/dzn-pricing-starter-card.png",
    "/media/dzn-pricing-pro-card.png",
  ],
  "Pricing page animated background",
);

includesAll(
  globals,
  [
    ".dzn-pricing-bg-layer",
    ".dzn-pricing-fog-layer",
    "@keyframes dzn-pricing-bg-drift",
    "@keyframes dzn-pricing-fog-drift",
    "prefers-reduced-motion: reduce",
  ],
  "Pricing background CSS",
);

includesAll(
  pricingPage,
  [
    "Green tick included",
    "Red X not included",
    "text-emerald-300",
    "text-red-400",
    "h-6 w-6",
    "included(",
    "excluded(",
  ],
  "Pricing comparison tick/cross treatment",
);

includesAll(
  pricingPage,
  [
    "Full DZN Access",
    "Up to 3 linked DayZ servers",
    "Enhanced Pro server profile presentation",
    "Custom advert banner",
    "Owner announcement tools",
    "Fresh wipe and event promo blocks",
    "Multiple Discord post-type channels",
    "Advanced owner analytics",
    "Event promotion tools",
    "Featured and spotlight eligibility",
    "2 promotion credits per billing period",
    "Server Wars and event-hosting upgrade path",
  ],
  "Pro upgrade feature depth",
);

assert.equal(
  featureCountForPlan(pricingPage, "pro") >= featureCountForPlan(pricingPage, "starter") + 6,
  true,
  "Pro should have a materially richer visible feature list than Starter.",
);

includesAll(
  pricingPage,
  [
    "Start Starter trial",
    "Go Pro",
    "£0 today",
    "then £2/month",
    "£10/month",
    "2-day free trial",
    "Payment method required for checkout",
    "createCheckoutSession(planKey, returnTo)",
    "getBillingPlans()",
    "DZN_LIVE_CHECKOUT_ENABLED=true",
  ],
  "Pricing billing contract",
);

includesAll(
  pricingPage,
  [
    "Does Pro affect leaderboard rank?",
    "Can badges be bought?",
    "Do Starter servers still compete?",
    "What does Pro improve?",
    "Paid leaderboard boost",
    "Paid review score boost",
    "Paid season/crown boost",
    "No paid advantage",
  ],
  "Pricing fairness copy",
);

assert.equal(/Premium|Network Listing|Partner Listing|Network plan|Partner plan/.test(pricingPage), false, "Pricing page must not offer legacy plans.");
assert.equal(/DZN_LIVE_CHECKOUT_ENABLED\s*:\s*["'`]true["'`]/i.test(pricingPage), false, "Pricing page must not enable live checkout through object config.");
assert.equal(/DZN_LIVE_CHECKOUT_ENABLED\s*=\s*["'`]true["'`]/i.test(pricingPage), false, "Pricing page must not enable live checkout through assignment.");
assert.equal(/paid leaderboard rank|leaderboard rank boost|improves leaderboard rank|buy better leaderboard/i.test(pricingPage), false, "Pricing page must not imply bought rank.");

assertAsset("public/media/dzn-pricing-bg-layer.png");
assertAsset("public/media/dzn-pricing-fog-ember-overlay.png");
assertAsset("public/media/dzn-pricing-starter-card.png");
assertAsset("public/media/dzn-pricing-pro-card.png");

includesAll(
  masterSpec,
  [
    "Pricing Visual Comparison Upgrade Slice",
    "Clear green ticks and red X marks",
    "DZN-themed animated background",
    "Issue #49 remains reserved",
  ],
  "Master spec pricing visual slice",
);

console.log("Pricing visual upgrade tests passed.");
