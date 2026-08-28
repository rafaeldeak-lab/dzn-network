import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT_HANDOFF.md";
const MIGRATION_DOC = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md";
const MIGRATION_HANDOFF = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION_HANDOFF.md";
const SCHEMA_PREFLIGHT = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md";
const WEBHOOK_PREFLIGHT = "docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const FULFILMENT_LEDGER_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const STORE_CHECKOUT_HELPER = "functions/_lib/dzn-store-checkout.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const PACKAGE_JSON = "package.json";

const INTEGRATION_DOCS = [
  MIGRATION_DOC,
  MIGRATION_HANDOFF,
  SCHEMA_PREFLIGHT,
  WEBHOOK_PREFLIGHT,
  SAFE_PREFLIGHT,
  BACKLOG,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
  BILLING_PLANS,
  STRIPE_LIVE_CHECKLIST,
] as const;

const LOCAL_TEST_FULFILMENT_TABLES = [
  "account_entitlements",
  "supporter_cards",
  "store_fulfilment_attempts",
  "store_order_status_history",
  "store_entitlement_status_history",
  "store_refund_dispute_audit",
] as const;

const FORBIDDEN_WHEEL_TABLES = [
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
] as const;

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/_lib/dzn-store-fulfilment.ts",
  "functions/_lib/dzn-store-entitlements.ts",
  "functions/_lib/dzn-supporter-cards.ts",
  "functions/_lib/dzn-store-wheel.ts",
  "functions/api/stripe/store-fulfilment.ts",
  "functions/api/store/fulfilment.ts",
  "functions/api/store/webhook-fulfilment.ts",
  "functions/api/store/orders/[orderId]/fulfil.ts",
  "functions/api/account/purchases.ts",
  "functions/api/wheel",
  "components/supporter",
  "components/wheel",
  "app/account/purchases",
  "app/wheel",
] as const;

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

main();

function main() {
  assertFilesExist();
  assertPreflightContract();
  assertIntegratedDocs();
  assertExistingRuntimeStillReceiptOnly();
  assertNoFulfilmentRuntimeWrites();
  assertNoNewRuntimePathsOrMigrations();
  assertNoSourceConfigEnablesRuntime();
  assertPackageScript();
  console.log("DZN Store fulfilment runtime implementation approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    MIGRATION_DOC,
    MIGRATION_HANDOFF,
    SCHEMA_PREFLIGHT,
    WEBHOOK_PREFLIGHT,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    ORDER_LEDGER_MIGRATION,
    FULFILMENT_LEDGER_MIGRATION,
    STORE_WEBHOOK_HELPER,
    STORE_WEBHOOK_ROUTE,
    STORE_ORDER_HELPER,
    STORE_CHECKOUT_HELPER,
    OWNER_WEBHOOK,
    OWNER_CHECKOUT_ROUTE,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightContract() {
  const doc = read(PREFLIGHT);
  for (const snippet of [
    "# DZN Store Fulfilment Runtime Implementation Approval Preflight",
    "This slice is approval preflight only.",
    "No Store webhook fulfilment runtime.",
    "No account entitlement writes.",
    "No Supporter Card issuance.",
    "No earned spins.",
    "No reward wheel runtime.",
    "No live checkout activation.",
    "No issue #49 change.",
    "Current `POST /api/stripe/store-webhook` remains receipt-only.",
    "Future fulfilment must not relax those receipt-row blockers in place.",
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
    "## Verified Fulfilment Sequence",
    "Verify the `Stripe-Signature` header against the unmodified raw body before JSON parsing.",
    "Success redirects must never grant or reveal entitlements by themselves.",
    "## Eligible Event Contract",
    "`checkout.session.completed`",
    "`checkout.session.async_payment_succeeded`",
    "PaymentIntent events are not grant events for the first runtime.",
    "## Order Status Transition Contract",
    "`checkout_created -> paid`",
    "`payment_pending -> paid`",
    "`paid -> disputed`",
    "`paid|disputed -> refunded`",
    "`paid|disputed|refunded -> revoked`",
    "## Idempotency And Concurrency Contract",
    "## Account Entitlement Creation Rules",
    "Attach to `store_orders.purchasing_user_id`.",
    "Keep all no-advantage fields fixed to zero.",
    "## Supporter Card Issuance Rules",
    "Supporter Card issuance is optional in the first runtime",
    "`DZN-SUP-######`",
    "## Refund, Reversal, And Chargeback Rollback Rules",
    "Partial refunds require `manual_review`",
    "## Fair Progression Boundary",
    "Store payments must never mint spins, improve wheel odds, bypass wheel cooldowns, or run the reward wheel.",
    "## Test Matrix For The Future Runtime PR",
    "## Rollback Plan",
    "## Security Proof For This Preflight Slice",
    "Next should be DZN Store fulfilment runtime implementation only if deliberately approved",
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
    assertIncludes(doc, url, `${PREFLIGHT} should cite ${url}.`);
  }
}

function assertIntegratedDocs() {
  for (const path of INTEGRATION_DOCS) {
    assertIncludes(read(path), "DZN Store fulfilment runtime implementation approval preflight", `${path} should reference this preflight.`);
    assertIncludes(read(path), "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`", `${path} should link the preflight doc.`);
  }

  assertIncludes(read(BACKLOG), "## DZN Store Fulfilment Runtime Implementation Approval Preflight");
  assertIncludes(read(MASTER_SPEC), "DZN Store fulfilment runtime implementation approval preflight: delivered");
  assertIncludes(read(PUBLIC_ACCESS_POLICY), "The DZN Store fulfilment runtime implementation approval preflight slice is documentation/test-guard work only.");
  assertIncludes(read(BILLING_PLANS), "defines the future disabled-by-default local/test fulfilment runtime contract");
  assertIncludes(read(STRIPE_LIVE_CHECKLIST), "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md`");
  assertIncludes(read(MIGRATION_DOC), "Delivered follow-on reference: the DZN Store fulfilment runtime implementation approval preflight");
  assertIncludes(read(MIGRATION_HANDOFF), "Delivered follow-on reference: the DZN Store fulfilment runtime implementation approval preflight");
}

function assertExistingRuntimeStillReceiptOnly() {
  const route = read(STORE_WEBHOOK_ROUTE);
  assertIncludes(route, "receiveDznStoreSandboxWebhookReceipt", "Store webhook route should still call only the receipt helper.");
  assert.doesNotMatch(route, /fulfil/i, "Store webhook route must not call fulfilment runtime in this preflight.");

  const webhookHelper = read(STORE_WEBHOOK_HELPER);
  assert.match(webhookHelper, /\bINSERT INTO store_payment_events\b/i, "Webhook helper should still insert only receipt rows.");
  assert.doesNotMatch(webhookHelper, /\bUPDATE\s+store_orders\b/i, "Webhook helper must not update Store orders in this preflight.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+store_fulfilment_attempts\b/i, "Webhook helper must not insert fulfilment attempts in this preflight.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+account_entitlements\b/i, "Webhook helper must not insert account entitlements in this preflight.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+supporter_cards\b/i, "Webhook helper must not issue Supporter Cards in this preflight.");

  const orderMigration = read(ORDER_LEDGER_MIGRATION);
  for (const snippet of [
    "fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)",
    "entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)",
    "supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)",
  ]) {
    assertIncludes(orderMigration, snippet, `${ORDER_LEDGER_MIGRATION} should retain receipt-only blocker ${snippet}.`);
  }
}

function assertNoFulfilmentRuntimeWrites() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  for (const path of runtimeFiles) {
    const source = read(path);
    for (const table of [...LOCAL_TEST_FULFILMENT_TABLES, ...FORBIDDEN_WHEEL_TABLES]) {
      assert.doesNotMatch(source, new RegExp(`\\bINSERT\\s+INTO\\s+${table}\\b`, "i"), `${path} must not insert into ${table}.`);
      assert.doesNotMatch(source, new RegExp(`\\bUPDATE\\s+${table}\\b`, "i"), `${path} must not update ${table}.`);
      assert.doesNotMatch(source, new RegExp(`\\bDELETE\\s+FROM\\s+${table}\\b`, "i"), `${path} must not delete from ${table}.`);
    }
  }

  const checkoutHelper = read(STORE_CHECKOUT_HELPER);
  assertIncludes(checkoutHelper, 'mode: "payment"', "Store checkout should remain one-time payment mode.");
  assert.doesNotMatch(checkoutHelper, /\bmode:\s*"subscription"\b/i, "Store checkout must not become subscription checkout.");

  const ownerCheckout = read(OWNER_CHECKOUT_ROUTE);
  assertIncludes(ownerCheckout, 'mode: "subscription"', "Owner checkout should remain subscription mode.");
  assert.doesNotMatch(ownerCheckout, /\bmode:\s*"payment"\b/i, "Owner checkout should not gain Store payment mode.");

  const ownerWebhook = read(OWNER_WEBHOOK);
  for (const table of [...LOCAL_TEST_FULFILMENT_TABLES, ...FORBIDDEN_WHEEL_TABLES]) {
    assert.doesNotMatch(ownerWebhook, new RegExp(`\\b${table}\\b`, "i"), `Owner subscription webhook must not reference ${table}.`);
  }
}

function assertNoNewRuntimePathsOrMigrations() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in this preflight-only slice.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), FULFILMENT_LEDGER_MIGRATION, "No migration after 0073 should be added by this preflight.");
  assert.equal(migrationFiles.filter((path) => path.startsWith("migrations/0074_")).length, 0, "This preflight must not add a 0074 runtime migration.");

  const fulfilmentMigration = read(FULFILMENT_LEDGER_MIGRATION);
  for (const table of LOCAL_TEST_FULFILMENT_TABLES) {
    assert.match(fulfilmentMigration, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i"), `${FULFILMENT_LEDGER_MIGRATION} should retain ${table}.`);
  }
  for (const table of FORBIDDEN_WHEEL_TABLES) {
    assert.doesNotMatch(fulfilmentMigration, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i"), `${FULFILMENT_LEDGER_MIGRATION} must not add ${table}.`);
  }
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

function assertIncludes(haystack: string | undefined, needle: string, message?: string) {
  assert.equal(haystack?.includes(needle), true, message ?? `Expected source to include ${needle}.`);
}
