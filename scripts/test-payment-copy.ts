import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PAYMENT_COPY, PAYMENT_FAQS, pricingReturnTo } from "../lib/billing/payment-copy";
import { getSubscriptionPlanPublicContracts } from "../lib/billing/plans";
import { getPublicLegalSellerDisclosure } from "../lib/legal-seller";
import { getBillingPlanSummaries } from "../functions/_lib/plans";
import type { Env } from "../functions/_lib/types";
import { DZN_PUBLIC_CONTACT, DZN_SUPPORT_EMAIL, DZN_SUPPORT_EMAIL_HREF } from "../lib/support";

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
assert.match(PAYMENT_COPY.refunds, /refund.*applicable law.*statutory consumer rights/i);
assert.match(PAYMENT_COPY.recovery, /fails.*recovery.*does not start another trial/i);
assert.equal(PAYMENT_FAQS.length, 8);
for (const value of [null, "//evil.example", "https://evil.example", "/setup?paid=true", "/owner", "/dashboard/other"]) {
  assert.equal(pricingReturnTo(value), "/setup");
}
assert.equal(pricingReturnTo("/dashboard"), "/dashboard");
assert.equal(pricingReturnTo("/setup"), "/setup");
const route = readFileSync("app/pricing/page.tsx", "utf8");
const checkout = readFileSync("components/onboarding/pricing-checkout.tsx", "utf8");
assert.ok(route.includes("PAYMENT_FAQS") && route.includes("PAYMENT_COPY.consent"));
for (const policyRoute of ["terms", "privacy", "refunds"]) {
  const policy = readFileSync(`app/${policyRoute}/page.tsx`, "utf8");
  assert.match(policy, /DZN_SUPPORT_EMAIL/);
  assert.doesNotMatch(policy, /no refunds|non-refundable|waive all|tax included/i);
  assert.ok(route.includes(`href=\"/${policyRoute}\"`), `Pricing should link to /${policyRoute}.`);
}
const terms = readFileSync("app/terms/page.tsx", "utf8");
assert.match(terms, /GBP 0.*two-day trial.*GBP 2 per month/i);
assert.match(terms, /Pro[\s\S]*GBP 10[\s\S]*no free trial[\s\S]*GBP 10 per month/i);
assert.match(terms, /Manage Billing[\s\S]*turn off renewal/i);
assert.match(terms, /does not itself create paid access/i);
assert.match(terms, /cannot lawfully be excluded/i);
assert.match(terms, /getPublicLegalSellerDisclosure/);
assert.match(terms, /Live subscription checkout remains unavailable/);
assert.doesNotMatch(terms, /seller\.(?:legalSellerName|contactAddressLines)|Legal seller:/,
  "Public terms must not render private identity or arbitrary environment address values.");
assert.deepEqual(DZN_PUBLIC_CONTACT, {
  name: "DZN Network",
  addressLines: ["Suite RA01, 195-197 Wood Street", "London", "E17 3NU", "United Kingdom"],
});
assert.equal(DZN_SUPPORT_EMAIL, "dznnetworksupport@gmail.com");
assert.equal(DZN_SUPPORT_EMAIL_HREF, "mailto:dznnetworksupport@gmail.com");
const publicContact = readFileSync("components/site/public-contact.tsx", "utf8");
assert.match(publicContact, /DZN_PUBLIC_CONTACT\.name/);
assert.match(publicContact, /DZN_PUBLIC_CONTACT\.addressLines/);
assert.match(publicContact, /DZN_SUPPORT_EMAIL_HREF/);
assert.doesNotMatch(publicContact, /process\.env|legalSeller|phone|tel:|fetch\(|useEffect/);
assert.match(readFileSync("components/site/policy-page.tsx", "utf8"), /<PublicContact\s*\/>/);
assert.match(route, /<PublicContact\s*\/>/);
const tradingContactOnly = getBillingPlanSummaries({
  DZN_PUBLIC_LEGAL_SELLER_NAME: DZN_PUBLIC_CONTACT.name,
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: DZN_PUBLIC_CONTACT.addressLines.join(" | "),
  STRIPE_PRICE_STARTER: "price_fixture_starter",
  STRIPE_PRICE_PRO: "price_fixture_pro",
  STRIPE_SECRET_KEY: "sk_live_fixture_not_a_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_not_a_secret",
  DZN_APP_URL: "https://dayz-network.com",
  DZN_LIVE_CHECKOUT_ENABLED: "true",
} as Env);
assert.ok(tradingContactOnly.every(p => p.checkout_enabled === false),
  "Publishing the approved trading contact must not bypass seller readiness, even with checkout requested.");
assert.equal(getPublicLegalSellerDisclosure({}).complete, false);
assert.equal(getPublicLegalSellerDisclosure({
  DZN_PUBLIC_LEGAL_SELLER_NAME: "DZN Network",
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: "United Kingdom",
}).complete, false, "Trading-name and country placeholders must not satisfy the live seller disclosure.");
const completeSeller = getPublicLegalSellerDisclosure({
  DZN_PUBLIC_LEGAL_SELLER_NAME: "Example Legal Seller",
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: "1 Example Street | London | AB1 2CD | United Kingdom",
});
assert.equal(completeSeller.complete, false, "Configured but unpublished seller details must not satisfy readiness.");
assert.equal(completeSeller.legalSellerNameReady, true);
assert.equal(completeSeller.contactAddressReady, true);
assert.equal(completeSeller.publishedContactMatches, false);
assert.deepEqual(completeSeller.contactAddressLines, ["1 Example Street", "London", "AB1 2CD", "United Kingdom"]);
const publishedFixture = {
  name: "Example Legal Seller",
  addressLines: ["1 Example Street", "London", "AB1 2CD", "United Kingdom"],
};
const sellerFixture = {
  DZN_PUBLIC_LEGAL_SELLER_NAME: publishedFixture.name,
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: publishedFixture.addressLines.join(" | "),
};
assert.equal(getPublicLegalSellerDisclosure(sellerFixture, publishedFixture).complete, true,
  "The pure helper must accept valid seller details only when they match its explicit published-contact fixture.");
assert.equal(getPublicLegalSellerDisclosure({
  ...sellerFixture,
  DZN_PUBLIC_LEGAL_SELLER_NAME: ` ${publishedFixture.name} `,
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: publishedFixture.addressLines.join("\r\n"),
}, publishedFixture).complete, true, "Existing whitespace and address separator handling is preserved.");
for (const mismatch of [
  { ...publishedFixture, name: "Different Legal Seller" },
  { ...publishedFixture, name: publishedFixture.name.toLowerCase() },
  { ...publishedFixture, addressLines: [...publishedFixture.addressLines, "Extra line"] },
  { ...publishedFixture, addressLines: publishedFixture.addressLines.slice(1) },
  { ...publishedFixture, addressLines: [...publishedFixture.addressLines].reverse() },
]) {
  assert.equal(getPublicLegalSellerDisclosure(sellerFixture, mismatch).complete, false);
}
const brandOnlySeller = getPublicLegalSellerDisclosure({
  DZN_PUBLIC_LEGAL_SELLER_NAME: DZN_PUBLIC_CONTACT.name,
  DZN_PUBLIC_LEGAL_CONTACT_ADDRESS: DZN_PUBLIC_CONTACT.addressLines.join(" | "),
});
assert.equal(brandOnlySeller.publishedContactMatches, true);
assert.equal(brandOnlySeller.complete, false, "Publication matching must not weaken existing seller-name validation.");
const refunds = readFileSync("app/refunds/page.tsx", "utf8");
assert.match(refunds, /cancel before the trial deadline.*avoid the first GBP 2 payment/i);
assert.match(refunds, /does not automatically refund.*already completed/i);
assert.match(refunds, /required by law[\s\S]*does not limit statutory consumer rights/i);
const privacy = readFileSync("app/privacy/page.tsx", "utf8");
assert.match(privacy, /Stripe handles payment-card information/i);
assert.match(privacy, /does not store full card numbers/i);
assert.match(privacy, /does not sell personal data/i);
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
