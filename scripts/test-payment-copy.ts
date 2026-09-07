import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PAYMENT_COPY, PAYMENT_FAQS, pricingReturnTo } from "../lib/billing/payment-copy";
import { getSubscriptionPlanPublicContracts } from "../lib/billing/plans";
import { getBillingPlanSummaries } from "../functions/_lib/plans";
import type { Env } from "../functions/_lib/types";

const contracts = getSubscriptionPlanPublicContracts();
const plans = getBillingPlanSummaries({} as Env);
assert.deepEqual(contracts.map(p => [p.key, p.monthlyPriceGbp, p.trialDays]), [["starter", 2, 2], ["pro", 10, 0]]);
assert.ok(plans.every(p => p.checkout_enabled === false));
assert.deepEqual(plans.map(p => p.price_label), contracts.map(p => p.priceLabel));
assert.match(PAYMENT_COPY.starterOffer, /Eligible accounts.*£0.*2-day.*£2\/month/);
assert.match(PAYMENT_COPY.starterTerms, /payment method.*eligible.*checkout in Stripe.*verifying.*automatically renews.*cancel/i);
assert.match(PAYMENT_COPY.returningStarter, /no second trial.*separate confirmation.*£2.*£2\/month/i);
assert.match(PAYMENT_COPY.proTerms, /no free trial.*£10.*£10\/month.*cancelled/i);
assert.match(PAYMENT_COPY.player, /Player access is free/);
assert.match(PAYMENT_COPY.cancellation, /Manage Billing.*before.*trial deadline.*does not itself refund/i);
assert.match(PAYMENT_COPY.recovery, /fails.*recovery.*does not start another trial/i);
assert.equal(PAYMENT_FAQS.length, 7);
for (const value of [null, "//evil.example", "https://evil.example", "/setup?paid=true", "/owner", "/dashboard/other"]) {
  assert.equal(pricingReturnTo(value), "/setup");
}
assert.equal(pricingReturnTo("/dashboard"), "/dashboard");
assert.equal(pricingReturnTo("/setup"), "/setup");
const route = readFileSync("app/pricing/page.tsx", "utf8");
const checkout = readFileSync("components/onboarding/pricing-checkout.tsx", "utf8");
assert.ok(route.includes("PAYMENT_FAQS") && route.includes("PAYMENT_COPY.consent"));
assert.ok(checkout.includes("plan?.configured !== true || plan.checkout_enabled !== true"));
assert.ok(checkout.includes("StarterCheckoutButton") && checkout.includes("inFlight.current"));
assert.ok(checkout.includes("failure instanceof ApiRequestError") && checkout.includes("failure.status !== 401"));
const client = readFileSync("components/onboarding/api.ts", "utf8");
assert.ok(client.includes("readonly status?: number") && client.includes("data.offer, response.status"));
assert.ok(!/localStorage|sessionStorage|sendBeacon|analytics|document\.cookie/.test(checkout));
assert.ok(!/window.location.replace|createPortal/.test(route));
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|json|html|txt|xml)$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
for (const file of [...files("app"), ...files("components"), ...files("public")]) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /Basic server listings are free during beta|Free listings are open|Trial ready|Pricing now lives inside the homepage|href[:=]\s*["']\/?#pricing["']/, file);
}
console.log("Payment-copy contract, catalogue consistency, paused-default, return-path and public-surface audit passed.");
