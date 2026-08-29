import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md";
const PREFLIGHT_HANDOFF = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT_HANDOFF.md";
const IMPLEMENTATION_DOC = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md";
const IMPLEMENTATION_HANDOFF = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_HANDOFF.md";
const MIGRATION_DOC = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md";
const MIGRATION_HANDOFF = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const FULFILMENT_LEDGER_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_CHECKOUT_HELPER = "functions/_lib/dzn-store-checkout.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const PACKAGE_JSON = "package.json";

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const BLOCKED_SOURCE_CONFIG_FLAGS = [
  "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
  "DZN_SUPPORTER_CARDS_ENABLED",
  "DZN_EARNED_SPINS_ENABLED",
  "DZN_REWARD_WHEEL_ENABLED",
  "DZN_STORE_LIVE_CHECKOUT_ENABLED",
  "DZN_LIVE_CHECKOUT_ENABLED=true",
] as const;

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/_lib/dzn-store-entitlements.ts",
  "functions/_lib/dzn-supporter-cards.ts",
  "functions/_lib/dzn-store-wheel.ts",
  "functions/api/stripe/store-fulfilment.ts",
  "functions/api/store/fulfilment.ts",
  "functions/api/store/webhook-fulfilment.ts",
  "functions/api/store/orders/[orderId]/fulfil.ts",
  "functions/api/wheel",
  "components/supporter",
  "components/wheel",
  "app/account/purchases",
  "app/wheel",
] as const;

main();

function main() {
  assertFilesExist();
  assertHistoricalPreflightContract();
  assertDeliveredRuntimeDocs();
  assertReceiptAndFulfilmentRuntimeBoundaries();
  assertNoSourceConfigEnablesRuntime();
  assertPackageScript();
  console.log("DZN Store fulfilment runtime implementation approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    PREFLIGHT_HANDOFF,
    IMPLEMENTATION_DOC,
    IMPLEMENTATION_HANDOFF,
    MIGRATION_DOC,
    MIGRATION_HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    ORDER_LEDGER_MIGRATION,
    FULFILMENT_LEDGER_MIGRATION,
    STORE_WEBHOOK_HELPER,
    STORE_FULFILMENT_HELPER,
    STRIPE_HELPER,
    STORE_WEBHOOK_ROUTE,
    STORE_CHECKOUT_HELPER,
    OWNER_WEBHOOK,
    OWNER_CHECKOUT_ROUTE,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertHistoricalPreflightContract() {
  const doc = read(PREFLIGHT);
  for (const snippet of [
    "# DZN Store Fulfilment Runtime Implementation Approval Preflight",
    "This slice is approval preflight only.",
    "## Runtime Flag Contract",
    "`DZN_STORE_WEBHOOK_FULFILMENT_ENABLED`",
    "`DZN_SUPPORTER_CARDS_ENABLED`",
    "`DZN_EARNED_SPINS_ENABLED`",
    "`DZN_REWARD_WHEEL_ENABLED`",
    "`DZN_STORE_LIVE_CHECKOUT_ENABLED`",
    "`DZN_LIVE_CHECKOUT_ENABLED`",
    "## Exact Write Scope",
    "`store_fulfilment_attempts`",
    "`store_order_status_history`",
    "`account_entitlements`",
    "`store_entitlement_status_history`",
    "`supporter_cards`",
    "`store_refund_dispute_audit`",
    "Success redirects must never grant or reveal entitlements by themselves.",
    "PaymentIntent events are not grant events for the first runtime.",
    "Store payments must never mint spins, improve wheel odds, bypass wheel cooldowns, or run the reward wheel.",
    "Next should be DZN Store fulfilment runtime implementation only if deliberately approved",
    "Delivered follow-on implementation",
    "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`",
    "`functions/_lib/dzn-store-fulfilment.ts`",
  ]) {
    assertIncludes(doc, snippet, `${PREFLIGHT} should contain: ${snippet}`);
  }
}

function assertDeliveredRuntimeDocs() {
  for (const [path, snippets] of [
    [IMPLEMENTATION_DOC, [
      "DZN Store Fulfilment Runtime Implementation",
      "disabled by default",
      "`POST /api/stripe/store-webhook`",
      "`DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true`",
      "PaymentIntent events do not fulfil alone",
      "No earned spins",
      "No reward wheel runtime",
      "No live checkout",
      "No production D1 writes",
      "Issue #49 remains reserved",
    ]],
    [IMPLEMENTATION_HANDOFF, [
      "DZN Store Fulfilment Runtime Implementation Handoff",
      "Branch: `codex/dzn-store-fulfilment-runtime-implementation-20260828`",
      "Protected OneDrive checkout was not modified.",
      "No earned spins.",
      "No reward wheel runtime.",
      "No live checkout.",
      "No production D1 writes.",
      "No issue #49 change.",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store fulfilment runtime implementation slice is now delivered",
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`",
      "disabled-by-default local/test Store fulfilment runtime",
    ]],
    [BACKLOG, [
      "DZN Store Fulfilment Runtime Implementation",
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`",
      "PaymentIntent events remain no-grant",
    ]],
    [MASTER_SPEC, [
      "DZN Store Fulfilment Runtime Implementation Slice",
      "`functions/_lib/dzn-store-fulfilment.ts`",
      "Store account entitlements remain separate from owner Starter/Pro entitlements",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store fulfilment runtime implementation slice may process verified test-mode Store payment receipts",
      "Store entitlements remain private account-bound cosmetic/supporter records",
    ]],
    [BILLING_PLANS, [
      "The DZN Store fulfilment runtime implementation adds disabled-by-default local/test processing",
      "Store fulfilment remains separate from owner Starter/Pro billing",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md` adds disabled-by-default local/test Store fulfilment runtime",
      "does not approve live checkout",
      "does not approve issue #49 changes",
    ]],
  ] satisfies Array<[string, string[]]>) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should contain: ${snippet}`);
    }
  }
}

function assertReceiptAndFulfilmentRuntimeBoundaries() {
  const route = read(STORE_WEBHOOK_ROUTE);
  const webhookHelper = read(STORE_WEBHOOK_HELPER);
  const fulfilmentHelper = read(STORE_FULFILMENT_HELPER);
  const stripeHelper = read(STRIPE_HELPER);
  const checkoutHelper = read(STORE_CHECKOUT_HELPER);
  const ownerCheckout = read(OWNER_CHECKOUT_ROUTE);
  const ownerWebhook = read(OWNER_WEBHOOK);

  assertIncludes(route, "receiveDznStoreSandboxWebhookReceipt", "Store webhook route should stay delegated to the receipt helper.");
  assertIncludes(webhookHelper, "verifyStripeWebhookWithRawBody", "Store webhook helper should verify raw Stripe signatures.");
  assert.match(`${webhookHelper}\n${stripeHelper}`, /\bawait\s+request\.text\(\)/, "Store webhook flow should read the raw body before parsing.");
  assertIncludes(webhookHelper, "INSERT INTO store_payment_events", "Store webhook helper should record the receipt row first.");
  assertIncludes(webhookHelper, "processDznStoreSandboxWebhookFulfilment", "Store webhook helper should call only the approved fulfilment helper.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+account_entitlements\b/i, "Webhook helper must not write account entitlements directly.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+supporter_cards\b/i, "Webhook helper must not issue Supporter Cards directly.");

  for (const required of [
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "DZN_STORE_SANDBOX_RUNTIME",
    "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED",
    "STORE_WEBHOOK_FULFILMENT_DISABLED",
    "STORE_LIVE_CHECKOUT_BLOCKED",
    "STORE_STRIPE_LIVE_SECRET_BLOCKED",
    "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED",
    "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED",
    "checkout.session.completed",
    "STORE_CHECKOUT_COMPLETED_FULFILLED",
    "STORE_PAYMENT_INTENT_EVENT_NO_GRANT",
    "STORE_ASYNC_PAYMENT_SUCCESS_DISABLED",
    "STORE_FULL_REFUND_REVOKED",
    "STORE_DISPUTE_LOST_REVOKED",
  ]) {
    assertIncludes(fulfilmentHelper, required, `${STORE_FULFILMENT_HELPER} should keep ${required}.`);
  }

  for (const forbidden of [
    /\bstripeFormRequest\b/i,
    /\bstripeGetRequest\b/i,
    /\bfetch\s*\(/i,
    /\bcheckout\.sessions\.create\b/i,
    /\/checkout\/sessions/i,
    /\brefunds\.create\b/i,
    /\bdisputes\.close\b/i,
    /\bINSERT\s+INTO\s+earned_spins\b/i,
    /\bUPDATE\s+earned_spins\b/i,
    /\bINSERT\s+INTO\s+spin_ledger\b/i,
    /\bUPDATE\s+spin_ledger\b/i,
    /\bwheel_cooldowns\b/i,
    /\breward_wheel\b/i,
    /\bowner_billing_accounts\b/i,
    /\bowner_plan_entitlements\b/i,
    /\blinked_servers\b/i,
    /\bnitrado/i,
    /\bwrangler\b/i,
  ]) {
    assert.doesNotMatch(fulfilmentHelper, forbidden, `Approved runtime helper must not contain forbidden pattern ${forbidden}.`);
  }

  assertIncludes(checkoutHelper, 'mode: "payment"', "Store checkout should remain one-time payment mode.");
  assert.doesNotMatch(checkoutHelper, /\bmode:\s*"subscription"\b/i, "Store checkout must not become a subscription checkout.");
  assertIncludes(ownerCheckout, 'mode: "subscription"', "Owner checkout should remain subscription mode.");
  assert.doesNotMatch(ownerCheckout, /\bmode:\s*"payment"\b/i, "Owner checkout should not gain Store payment mode.");
  for (const forbidden of ["account_entitlements", "supporter_cards", "earned_spins", "spin_ledger", "wheel_cooldowns"]) {
    assert.doesNotMatch(ownerWebhook, new RegExp(`\\b${forbidden}\\b`, "i"), `Owner subscription webhook must not touch ${forbidden}.`);
  }

  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in this approved runtime slice.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), FULFILMENT_LEDGER_MIGRATION, "No new migration after 0073 should be added by this runtime slice.");
}

function assertNoSourceConfigEnablesRuntime() {
  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of BLOCKED_SOURCE_CONFIG_FLAGS) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable ${flag}.`);
    }
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-fulfilment-runtime-implementation-preflight"],
    "tsx scripts/test-dzn-store-fulfilment-runtime-implementation-preflight.ts",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-fulfilment-runtime-implementation-preflight",
    "Full test chain should include the Store fulfilment runtime implementation preflight guard.",
  );
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (!stat.isDirectory()) return [root];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}

function assertIncludes(haystack: string, needle: string, message?: string) {
  assert.equal(haystack.includes(needle), true, message ?? `Expected source to include ${needle}.`);
}
