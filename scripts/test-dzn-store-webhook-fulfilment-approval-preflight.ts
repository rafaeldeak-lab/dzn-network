import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const PREFLIGHT = "docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT_HANDOFF.md";
const RECEIPT_DOC = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md";
const RECEIPT_HANDOFF = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const FULFILMENT_RUNTIME_DOC = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const STORE_CHECKOUT_HELPER = "functions/_lib/dzn-store-checkout.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const PACKAGE_JSON = "package.json";

const INTEGRATION_DOCS = [
  SAFE_PREFLIGHT,
  BACKLOG,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
  BILLING_PLANS,
  STRIPE_LIVE_CHECKLIST,
  RECEIPT_DOC,
  RECEIPT_HANDOFF,
] as const;

const RUNTIME_FILES_TO_CHECK = [
  STORE_WEBHOOK_HELPER,
  STORE_WEBHOOK_ROUTE,
  STORE_ORDER_HELPER,
  STORE_CHECKOUT_HELPER,
  OWNER_WEBHOOK,
  OWNER_CHECKOUT_ROUTE,
] as const;

const BLOCKED_TABLES = [
  "account_entitlements",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
] as const;

const BLOCKED_STORE_FLAGS_IN_SOURCE_CONFIG = [
  "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
  "DZN_SUPPORTER_CARDS_ENABLED",
  "DZN_EARNED_SPINS_ENABLED",
  "DZN_REWARD_WHEEL_ENABLED",
  "DZN_STORE_LIVE_CHECKOUT_ENABLED",
  "DZN_LIVE_CHECKOUT_ENABLED=true",
] as const;

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const FORBIDDEN_NEW_RUNTIME_PATHS = [
  "functions/_lib/dzn-store-entitlements.ts",
  "functions/_lib/dzn-supporter-cards.ts",
  "functions/_lib/dzn-store-wheel.ts",
  "functions/api/stripe/store-fulfilment.ts",
  "functions/api/store/fulfilment.ts",
  "functions/api/store/webhook-fulfilment.ts",
  "functions/api/wheel",
  "components/supporter",
  "components/wheel",
  "app/account/purchases",
  "app/wheel",
] as const;

async function main() {
  assertFilesExist();
  assertPreflightContract();
  assertIntegratedDocs();
  assertApprovedRuntimeRemainsFlaggedAndLocalTestOnly();
  assertMigrationStillBlocksFulfilment();
  assertNoNewFulfilmentRuntimePaths();
  assertNoSourceConfigEnablesStoreFulfilment();
  assertPackageScriptWired();
  console.log("DZN Store webhook fulfilment approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    RECEIPT_DOC,
    RECEIPT_HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    STORE_WEBHOOK_HELPER,
    STORE_FULFILMENT_HELPER,
    FULFILMENT_RUNTIME_DOC,
    STORE_WEBHOOK_ROUTE,
    STORE_ORDER_HELPER,
    STORE_CHECKOUT_HELPER,
    OWNER_WEBHOOK,
    OWNER_CHECKOUT_ROUTE,
    ORDER_LEDGER_MIGRATION,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightContract() {
  const doc = read(PREFLIGHT);
  for (const snippet of [
    "# DZN Store Webhook Fulfilment Approval Preflight",
    "This slice is approval preflight only.",
    "Current `POST /api/stripe/store-webhook` remains receipt-only.",
    "Current `store_payment_events` fulfilment blockers remain fixed to `0`.",
    "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
    "Issue #49 remains reserved for final live checkout activation.",
    "`checkout.session.completed`",
    "`checkout.session.async_payment_succeeded`",
    "PaymentIntent events are receipt/corroboration only",
    "Success-page redirects must never fulfil purchases.",
    "`draft -> checkout_created`",
    "`checkout_created|payment_pending -> paid`",
    "Exactly one account entitlement per fulfilled source order",
    "Exactly one Founding Supporter Card per qualifying account",
    "Full refund, reversal, and chargeback events revoke only the affected order/account entitlement",
    "Partial refunds require `manual_review`",
    "Store entitlements must never grant or influence",
    "Store payments must never mint spins or run the wheel",
    "No production D1 migration apply is authorized.",
    "No Stripe Product/Price/customer/refund/dispute/webhook endpoint mutation",
    "Next should be DZN Store fulfilment ledger/schema migration approval preflight only if deliberately approved",
  ]) {
    assertIncludes(doc, snippet, `${PREFLIGHT} should contain: ${snippet}`);
  }

  for (const url of [
    "https://docs.stripe.com/webhooks/signature",
    "https://docs.stripe.com/webhooks",
    "https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted",
    "https://docs.stripe.com/api/events/types",
    "https://docs.stripe.com/api/idempotent_requests",
    "https://docs.stripe.com/refunds",
    "https://docs.stripe.com/disputes/how-disputes-work",
    "https://developers.cloudflare.com/d1/worker-api/prepared-statements/",
    "https://developers.cloudflare.com/d1/best-practices/local-development/",
  ]) {
    assertIncludes(doc, url, `${PREFLIGHT} should cite ${url}`);
  }
}

function assertIntegratedDocs() {
  for (const path of INTEGRATION_DOCS) {
    const source = read(path);
    assertIncludes(source, "DZN Store webhook fulfilment approval preflight", `${path} should reference this preflight.`);
  }

  assertIncludes(read(SAFE_PREFLIGHT), "`docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md`");
  assertIncludes(read(BACKLOG), "## DZN Store Webhook Fulfilment Approval Preflight");
  assertIncludes(read(MASTER_SPEC), "## DZN Store Webhook Fulfilment Approval Preflight Slice");
  assertIncludes(read(PUBLIC_ACCESS_POLICY), "The DZN Store webhook fulfilment approval preflight slice is documentation/test-guard work only.");
  assertIncludes(read(BILLING_PLANS), "The DZN Store webhook fulfilment approval preflight defines the future verified test-mode fulfilment contract.");
  assertIncludes(read(STRIPE_LIVE_CHECKLIST), "`docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md`");
  assertIncludes(read(RECEIPT_DOC), "Next should be Store webhook fulfilment approval preflight");
  assertIncludes(read(RECEIPT_HANDOFF), "Next should be Store webhook fulfilment approval preflight");
}

function assertApprovedRuntimeRemainsFlaggedAndLocalTestOnly() {
  const webhookHelper = read(STORE_WEBHOOK_HELPER);
  assert.match(webhookHelper, /\bINSERT INTO store_payment_events\b/i, "Webhook helper should still insert only receipt rows.");
  assertIncludes(webhookHelper, "processDznStoreSandboxWebhookFulfilment", "Webhook helper should delegate to the approved follow-on fulfilment runtime only after receipt verification.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+account_entitlements\b/i, "Webhook helper must not insert account entitlements directly.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+supporter_cards\b/i, "Webhook helper must not issue Supporter Cards directly.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+store_orders\b/i, "Webhook helper must not create Store orders.");
  assert.doesNotMatch(webhookHelper, /\bDELETE\s+FROM\b/i, "Webhook helper must not delete anything.");

  const fulfilmentHelper = read(STORE_FULFILMENT_HELPER);
  for (const required of [
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "DZN_STORE_SANDBOX_RUNTIME",
    "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED",
    "STORE_LIVE_CHECKOUT_BLOCKED",
    "STORE_STRIPE_LIVE_SECRET_BLOCKED",
    "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED",
    "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED",
    "checkout.session.completed",
    "STORE_PAYMENT_INTENT_EVENT_NO_GRANT",
  ]) {
    assertIncludes(fulfilmentHelper, required, `${STORE_FULFILMENT_HELPER} should retain approved runtime guard ${required}.`);
  }
  for (const forbidden of [
    /\bstripeFormRequest\b/i,
    /\bstripeGetRequest\b/i,
    /\bfetch\s*\(/i,
    /\bcheckout\.sessions\.create\b/i,
    /\bINSERT\s+INTO\s+earned_spins\b/i,
    /\bINSERT\s+INTO\s+spin_ledger\b/i,
    /\bwheel_cooldowns\b/i,
    /\bowner_billing_accounts\b/i,
    /\bowner_plan_entitlements\b/i,
    /\blinked_servers\b/i,
    /\bnitrado/i,
    /\bwrangler\b/i,
  ]) {
    assert.doesNotMatch(fulfilmentHelper, forbidden, `${STORE_FULFILMENT_HELPER} must not contain forbidden runtime pattern ${forbidden}.`);
  }

  for (const path of RUNTIME_FILES_TO_CHECK) {
    const source = read(path);
    if (path !== STORE_WEBHOOK_HELPER) {
      assert.doesNotMatch(source, /\bDZN_STORE_WEBHOOK_FULFILMENT_ENABLED\b/, `${path} must not add fulfilment flag handling.`);
    }
    for (const table of BLOCKED_TABLES) {
      assert.doesNotMatch(source, new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "i"), `${path} must not write ${table}.`);
    }
  }
}

function assertMigrationStillBlocksFulfilment() {
  const migration = read(ORDER_LEDGER_MIGRATION);
  for (const snippet of [
    "fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)",
    "entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)",
    "supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)",
  ]) {
    assertIncludes(migration, snippet, `${ORDER_LEDGER_MIGRATION} should retain ${snippet}`);
  }

  for (const table of BLOCKED_TABLES) {
    assert.doesNotMatch(migration, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i"), `${ORDER_LEDGER_MIGRATION} must not add ${table}.`);
  }
}

function assertNoNewFulfilmentRuntimePaths() {
  for (const path of FORBIDDEN_NEW_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in the approval-preflight slice.`);
  }
}

function assertNoSourceConfigEnablesStoreFulfilment() {
  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of BLOCKED_STORE_FLAGS_IN_SOURCE_CONFIG) {
      assert.equal(source.includes(flag), false, `${path} must not add or enable ${flag}.`);
    }
  }
}

function assertPackageScriptWired() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-webhook-fulfilment-approval-preflight"],
    "tsx scripts/test-dzn-store-webhook-fulfilment-approval-preflight.ts",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-webhook-fulfilment-approval-preflight",
    "Full test chain should include the fulfilment approval preflight guard.",
  );
}

function read(path: string) {
  return readFileSync(path, "utf8");
}

function assertIncludes(haystack: string, needle: string, message?: string) {
  assert.equal(haystack.includes(needle), true, message ?? `Expected source to include ${needle}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
