import { getBillingReadinessStatus } from "../functions/_lib/plans";
import type { Env } from "../functions/_lib/types";

const readiness = getBillingReadinessStatus(process.env as unknown as Env);

printBoolean("STRIPE_SECRET_KEY present", readiness.stripeSecretConfigured);
printBoolean("STRIPE_WEBHOOK_SECRET present", readiness.webhookSecretConfigured);
for (const plan of readiness.activePlans) {
  const source = readiness.priceSources[plan.plan_key];
  printBoolean(`${source.envVar} present`, source.source === "server");
  printBoolean(`${source.publicFallbackEnvVar} fallback present`, source.source === "public_fallback");
}

console.log(`Stripe mode hint: ${readiness.modeHint}`);
console.log(`Checkout configured for Starter? ${readiness.starterConfigured ? "yes" : "no"}`);
console.log(`Checkout configured for Pro? ${readiness.proConfigured ? "yes" : "no"}`);
console.log(`Live billing configuration ready? ${readiness.liveConfigurationReady ? "yes" : "no"}`);
console.log(`Live checkout enabled? ${readiness.liveCheckoutEnabled ? "yes" : "no"}`);
console.log(`Checkout session creation allowed? ${readiness.checkoutSessionCreationAllowed ? "yes" : "no"}`);
console.log(`Checkout safety mode: ${readiness.checkoutSafetyMode}`);
console.log("Readiness check is read-only; it does not create Stripe products, apply migrations, update secrets, or enable live billing.");

if (readiness.missingRequiredVars.length) {
  console.log(`Checkout missing: ${readiness.missingRequiredVars.join(", ")}`);
}
if (readiness.missingLiveRequiredVars.length) {
  console.log(`Live setup missing: ${readiness.missingLiveRequiredVars.join(", ")}`);
}
if (readiness.publicFallbackPriceVarsDetected.length) {
  console.log(`Public fallback aliases detected: ${readiness.publicFallbackPriceVarsDetected.join(", ")}`);
}
if (readiness.legacyVarsDetected.length) {
  console.log(`Legacy compatibility vars detected: ${readiness.legacyVarsDetected.join(", ")}`);
}

for (const check of readiness.readinessChecks) {
  const mark = check.ok ? "PASS" : check.severity.toUpperCase();
  console.log(`${mark}: ${check.label} - ${check.detail}`);
}

console.log("DZN billing config check complete.");

function printBoolean(label: string, value: boolean) {
  console.log(`${label}? ${value ? "yes" : "no"}`);
}
