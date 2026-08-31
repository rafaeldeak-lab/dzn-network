import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const CATALOG_MIGRATION = "migrations/0071_dzn_store_catalog_admin_draft.sql";
const DOC = "docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md";
const HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA_HANDOFF.md";
const CHECKOUT_PREFLIGHT = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md";
const CHECKOUT_HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const STORE_PREVIEW_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const STORE_CHECKOUT_SESSION_ROUTE = "functions/api/store/orders/[orderId]/checkout.ts";
const STORE_CHECKOUT_SESSION_HELPER = "functions/_lib/dzn-store-checkout.ts";
const STORE_CHECKOUT_SESSION_DOC = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md";
const STORE_CHECKOUT_SESSION_HANDOFF = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const STORE_SUPPORTER_CARD_REVEAL_ROUTE = "functions/api/account/supporter-cards/[cardRef]/reveal.ts";
const STORE_SUPPORTER_CARD_REVEAL_HELPER = "functions/_lib/dzn-store-supporter-card-reveal.ts";
const STORE_WEBHOOK_DOC = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md";
const STORE_WEBHOOK_HANDOFF = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT_HANDOFF.md";
const PACKAGE_JSON = "package.json";

const LEDGER_TABLES = ["store_orders", "store_order_items", "store_payment_events"] as const;
const BLOCKED_TABLES = ["account_entitlements", "supporter_cards", "earned_spins", "spin_ledger", "wheel_cooldowns"] as const;

const STORE_FLAGS = [
  "DZN_STORE_ENABLED",
  "DZN_STORE_CHECKOUT_ENABLED",
  "DZN_STORE_SANDBOX_CHECKOUT_ENABLED",
  "DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED",
  "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED",
  "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
  "DZN_SUPPORTER_CARDS_ENABLED",
  "DZN_EARNED_SPINS_ENABLED",
  "DZN_REWARD_WHEEL_ENABLED",
  "DZN_STORE_ADMIN_ENABLED",
  "DZN_STORE_LIVE_CHECKOUT_ENABLED",
  "NEXT_PUBLIC_DZN_STORE_ENABLED",
] as const;

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/supporter",
  "functions/api/wheel",
  "functions/api/billing/create-store-checkout-session.ts",
  "functions/api/billing/create-one-time-checkout-session.ts",
  "functions/api/stripe/store",
  "app/purchases/page.tsx",
  "app/supporter/page.tsx",
  "app/wheel/page.tsx",
  "components/supporter",
  "components/wheel",
  "lib/store.ts",
  "lib/store",
  "lib/supporter.ts",
  "lib/supporter",
  "lib/wheel.ts",
  "lib/wheel",
  "functions/_lib/store.ts",
  "functions/_lib/supporter.ts",
  "functions/_lib/wheel.ts",
];

const FORBIDDEN_SCHEMA_COUPLINGS = [
  /\bowner_billing_accounts\b/i,
  /\bowner_plan_entitlements\b/i,
  /\bserver_subscriptions\b/i,
  /\bserver_owners\b/i,
  /\blinked_servers\b/i,
  /\bnitrado_connections\b/i,
  /\bserver_rankings\b/i,
  /\bleaderboards\b/i,
  /\bdiscovery_score\b/i,
  /\bserver_reviews\b/i,
  /\breview_score\b/i,
  /\bserver_badge_awards\b/i,
  /\bbadge_unlock_progress\b/i,
  /\bdzn_seasons\b/i,
  /\bcompetitive_events\b/i,
  /\bctf_tournament/i,
  /\bserver_war/i,
  /\bplayer_progression_award_sources\b/i,
  /\bplayer_xp\b/i,
  /\bpublic_profile/i,
  /\bcommunity_member/i,
];

const FORBIDDEN_RUNTIME_PATTERNS = [
  /\bstore_orders\b/i,
  /\bstore_order_items\b/i,
  /\bstore_payment_events\b/i,
  /\bINSERT\s+INTO\s+store_orders\b/i,
  /\bINSERT\s+INTO\s+store_order_items\b/i,
  /\bINSERT\s+INTO\s+store_payment_events\b/i,
  /\bcheckout\.sessions\.create\b/i,
  /\/checkout\/sessions/i,
  /\bmode\s*[:=]\s*["']payment["']/i,
  /\bpayment_intent\.succeeded\b/i,
  /\bcharge\.refunded\b/i,
  /\bcharge\.dispute/i,
  /\bverifyStripeWebhook\b/i,
];

main();

function main() {
  assertFilesExist();
  assertMigrationNumbering();
  assertOrderSchema();
  assertOrderItemSchema();
  assertPaymentEventSchema();
  assertNoForbiddenSchemaCouplings();
  assertNoRuntimePathsOrLedgerUsage();
  assertNoRuntimeEnvOrConfigFlags();
  assertExistingBillingRuntimeUnchanged();
  assertDocsAndBacklog();
  assertPackageScript();
  console.log("DZN Store sandbox order ledger schema tests passed.");
}

function assertFilesExist() {
  for (const path of [
    MIGRATION,
    CATALOG_MIGRATION,
    DOC,
    HANDOFF,
    CHECKOUT_PREFLIGHT,
    CHECKOUT_HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    OWNER_CHECKOUT_ROUTE,
    OWNER_WEBHOOK,
    STRIPE_HELPER,
    STORE_ORDER_ROUTE,
    STORE_ORDER_HELPER,
    STORE_CHECKOUT_SESSION_ROUTE,
    STORE_CHECKOUT_SESSION_HELPER,
    STORE_CHECKOUT_SESSION_DOC,
    STORE_CHECKOUT_SESSION_HANDOFF,
    STORE_WEBHOOK_ROUTE,
    STORE_WEBHOOK_HELPER,
    STORE_FULFILMENT_HELPER,
    STORE_WEBHOOK_DOC,
    STORE_WEBHOOK_HANDOFF,
    STORE_PREVIEW_COMPONENT,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertMigrationNumbering() {
  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"));
  assert.equal(migrationFiles.includes(MIGRATION), true, "0072 Store order ledger migration should exist.");
  assert.equal(migrationFiles.filter((path) => path.startsWith("migrations/0072_")).length, 1, "There must be exactly one 0072 migration.");
  assert.equal(migrationFiles.includes(CATALOG_MIGRATION), true, "0071 Store catalog migration should remain present.");
}

function assertOrderSchema() {
  const migration = read(MIGRATION);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_orders/i);
  assert.match(migration, /id TEXT PRIMARY KEY/i);
  assert.match(migration, /order_number TEXT NOT NULL UNIQUE/i);
  assert.match(migration, /purchasing_user_id TEXT NOT NULL/i);
  assert.match(migration, /purchasing_discord_id_hash TEXT/i);
  assert.match(migration, /ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK\(ledger_scope IN \('local', 'sandbox'\)\)/i);
  assert.match(migration, /livemode INTEGER NOT NULL DEFAULT 0 CHECK\(livemode = 0\)/i);
  assert.match(migration, /product_count INTEGER NOT NULL DEFAULT 1 CHECK\(product_count = 1\)/i);
  assert.match(migration, /currency TEXT NOT NULL DEFAULT 'gbp'/i);
  assert.match(migration, /total_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK\(total_amount_minor >= 0 AND total_amount_minor = subtotal_amount_minor \+ tax_amount_minor\)/i);
  assert.match(migration, /stripe_checkout_session_id TEXT UNIQUE/i);
  assert.match(migration, /stripe_payment_intent_id TEXT UNIQUE/i);
  assert.match(migration, /stripe_customer_ref_hash TEXT/i);
  assert.match(migration, /immutable_product_snapshot_json TEXT NOT NULL DEFAULT '\{\}'/i);
  assert.match(migration, /immutable_price_snapshot_json TEXT NOT NULL DEFAULT '\{\}'/i);
  assert.match(migration, /store_flags_snapshot_json TEXT NOT NULL DEFAULT '\{\}'/i);
  assert.match(migration, /tax_snapshot_json TEXT NOT NULL DEFAULT '\{\}'/i);
  assert.match(migration, /checkout_idempotency_key_hash TEXT UNIQUE/i);
  assert.match(migration, /FOREIGN KEY\(purchasing_user_id\) REFERENCES users\(id\)/i);
  assert.doesNotMatch(migration, /\bfulfilled\b|fulfilled_at|fulfilment_status/i, "This schema must not support entitlement fulfilment yet.");
}

function assertOrderItemSchema() {
  const migration = read(MIGRATION);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_order_items/i);
  assert.match(migration, /order_id TEXT NOT NULL/i);
  assert.match(migration, /product_id TEXT NOT NULL/i);
  assert.match(migration, /price_id TEXT NOT NULL/i);
  assert.match(migration, /product_key TEXT NOT NULL/i);
  assert.match(migration, /product_name_snapshot TEXT NOT NULL/i);
  assert.match(migration, /quantity INTEGER NOT NULL DEFAULT 1 CHECK\(quantity = 1\)/i);
  assert.match(migration, /UNIQUE\(order_id\)/i);
  assert.match(migration, /FOREIGN KEY\(order_id\) REFERENCES store_orders\(id\)/i);
  assert.match(migration, /FOREIGN KEY\(product_id\) REFERENCES store_products\(id\)/i);
  assert.match(migration, /FOREIGN KEY\(price_id\) REFERENCES store_prices\(id\)/i);

  for (const snippet of [
    "account_bound INTEGER NOT NULL DEFAULT 1 CHECK(account_bound = 1)",
    "guaranteed_purchase INTEGER NOT NULL DEFAULT 1 CHECK(guaranteed_purchase = 1)",
    "no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK(no_competitive_advantage = 1)",
    "grants_spins INTEGER NOT NULL DEFAULT 0 CHECK(grants_spins = 0)",
    "grants_xp INTEGER NOT NULL DEFAULT 0 CHECK(grants_xp = 0)",
    "grants_rank_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_rank_advantage = 0)",
    "grants_discovery_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_discovery_advantage = 0)",
    "grants_review_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_review_advantage = 0)",
    "grants_event_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_event_advantage = 0)",
    "grants_server_wars_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_server_wars_advantage = 0)",
    "grants_ctf_advantage INTEGER NOT NULL DEFAULT 0 CHECK(grants_ctf_advantage = 0)",
    "grants_owner_subscription_access INTEGER NOT NULL DEFAULT 0 CHECK(grants_owner_subscription_access = 0)",
    "grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK(grants_competitive_eligibility = 0)",
  ]) {
    assert.equal(migration.includes(snippet), true, `Order item schema must include safety constraint: ${snippet}`);
  }
}

function assertPaymentEventSchema() {
  const migration = read(MIGRATION);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_payment_events/i);
  assert.match(migration, /stripe_event_id TEXT NOT NULL UNIQUE/i);
  assert.match(migration, /event_class TEXT NOT NULL CHECK\(event_class IN \('checkout', 'payment_intent', 'refund', 'dispute', 'ignored'\)\)/i);
  assert.match(migration, /ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK\(ledger_scope IN \('local', 'sandbox'\)\)/i);
  assert.match(migration, /livemode INTEGER NOT NULL DEFAULT 0 CHECK\(livemode = 0\)/i);
  assert.match(migration, /processing_status TEXT NOT NULL DEFAULT 'received'/i);
  for (const status of ["received", "processed", "duplicate", "ignored", "failed", "blocked_by_flag", "manual_review"]) {
    assert.equal(migration.includes(`'${status}'`), true, `Payment event schema must include processing status ${status}.`);
  }
  assert.match(migration, /related_order_id TEXT/i);
  assert.match(migration, /stripe_checkout_session_id TEXT/i);
  assert.match(migration, /stripe_payment_intent_id TEXT/i);
  assert.match(migration, /stripe_charge_id TEXT/i);
  assert.match(migration, /stripe_refund_id TEXT/i);
  assert.match(migration, /stripe_dispute_id TEXT/i);
  assert.match(migration, /raw_event_sha256 TEXT NOT NULL CHECK\(length\(raw_event_sha256\) = 64 AND raw_event_sha256 = lower\(raw_event_sha256\)\)/i);
  assert.match(migration, /sanitized_summary_json TEXT NOT NULL DEFAULT '\{\}'/i);
  assert.match(migration, /fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK\(fulfilment_attempted = 0\)/i);
  assert.match(migration, /entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK\(entitlement_write_attempted = 0\)/i);
  assert.match(migration, /supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK\(supporter_card_write_attempted = 0\)/i);
  assert.match(migration, /FOREIGN KEY\(related_order_id\) REFERENCES store_orders\(id\)/i);

  for (const forbidden of [/raw_event_body/i, /raw_payload/i, /card_number/i, /\bcvc\b/i, /payment_method_details/i, /billing_address/i]) {
    assert.doesNotMatch(migration, forbidden, `Payment event schema must not store private payment payload field ${forbidden}.`);
  }
}

function assertNoForbiddenSchemaCouplings() {
  const migration = read(MIGRATION);
  const createdTables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(createdTables, [...LEDGER_TABLES], "0072 should create exactly the three Store ledger tables.");

  for (const table of BLOCKED_TABLES) {
    assert.equal(migration.includes(table), false, `${MIGRATION} must not create or reference blocked table ${table}.`);
  }
  for (const pattern of FORBIDDEN_SCHEMA_COUPLINGS) {
    assert.doesNotMatch(migration, pattern, `${MIGRATION} must not couple to protected system ${pattern}.`);
  }
  for (const forbidden of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bcheckout\.sessions\.create\b/i,
    /\bmode\s*[:=]\s*["']payment["']/i,
    /\bSTRIPE_SECRET_KEY\b/i,
    /\bSTRIPE_WEBHOOK_SECRET\b/i,
  ]) {
    assert.doesNotMatch(migration, forbidden, `${MIGRATION} must not include runtime/write/mutation pattern ${forbidden}.`);
  }
}

function assertNoRuntimePathsOrLedgerUsage() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the Store order route approval slice.`);
  }

  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  const allowedExistingPaymentFiles = new Set([
    OWNER_CHECKOUT_ROUTE,
    OWNER_WEBHOOK,
    STRIPE_HELPER,
    "functions/_lib/dzn-store-catalog.ts",
    "app/store/page.tsx",
    STORE_PREVIEW_COMPONENT,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedOrderRouteFiles = new Set([
    STORE_ORDER_ROUTE,
    STORE_ORDER_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedCheckoutSessionFiles = new Set([
    STORE_CHECKOUT_SESSION_ROUTE,
    STORE_CHECKOUT_SESSION_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedWebhookReceiptFiles = new Set([
    STORE_WEBHOOK_ROUTE,
    STORE_WEBHOOK_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));
  const approvedFulfilmentRuntimeFiles = new Set([
    STORE_FULFILMENT_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));
  const approvedAccountPurchasesReadModelFiles = new Set([
    "functions/api/account/purchases.ts",
    "functions/_lib/dzn-store-account-purchases.ts",
  ].map((path) => path.replace(/\\/g, "/")));
  const approvedSupporterCardPrivateRevealFiles = new Set([
    STORE_SUPPORTER_CARD_REVEAL_ROUTE,
    STORE_SUPPORTER_CARD_REVEAL_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));

  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (approvedSupporterCardPrivateRevealFiles.has(path)) {
      const source = read(path);
      assert.equal(
        source.includes("DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED") || source.includes("readDznStorePrivateSupporterCardReveal"),
        true,
        `${path} must be part of the approved private Supporter Card reveal slice.`,
      );
      assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, `${path} must remain read-only.`);
      assert.doesNotMatch(source, /\b(?:checkout\.sessions\.create|stripeFormRequest|stripeGetRequest|fetch\s*\(|\/checkout\/sessions|wrangler)\b/i, `${path} must not create checkout sessions or mutate providers.`);
      assert.doesNotMatch(source, /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:earned_spins|spin_ledger|wheel_cooldowns|owner_billing_accounts|owner_plan_entitlements|linked_servers|server_rankings|server_reviews|player_xp|player_calling_card_awards)\b/i, `${path} must not touch protected wheel, billing, owner, ranking, review, or progression systems.`);
      continue;
    }
    if (approvedAccountPurchasesReadModelFiles.has(path)) {
      const source = read(path);
      assert.equal(
        source.includes("DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED") || source.includes("readDznStoreAccountPurchasesReadModel"),
        true,
        `${path} must be part of the approved Account Purchases read-model slice.`,
      );
      assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, `${path} must remain read-only.`);
      assert.doesNotMatch(source, /\b(?:checkout\.sessions\.create|stripeFormRequest|stripeGetRequest|fetch\s*\(|\/checkout\/sessions|wrangler)\b/i, `${path} must not create checkout sessions or mutate providers.`);
      assert.doesNotMatch(source, /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:earned_spins|spin_ledger|wheel_cooldowns)\b/i, `${path} must not touch Store wheel tables.`);
      continue;
    }
    if (approvedFulfilmentRuntimeFiles.has(path)) {
      const source = read(path);
      for (const required of [
        "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
        "DZN_STORE_SANDBOX_RUNTIME",
        "STORE_LIVE_CHECKOUT_BLOCKED",
        "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED",
        "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED",
        "STORE_PAYMENT_INTENT_EVENT_NO_GRANT",
      ]) {
        assert.equal(source.includes(required), true, `${path} must keep approved fulfilment runtime guard ${required}.`);
      }
      for (const forbidden of [
        /\bstripeFormRequest\b/i,
        /\bstripeGetRequest\b/i,
        /\bfetch\s*\(/i,
        /\bcheckout\.sessions\.create\b/i,
        /\/checkout\/sessions/i,
        /\bINSERT\s+INTO\s+earned_spins\b/i,
        /\bINSERT\s+INTO\s+spin_ledger\b/i,
        /\bwheel_cooldowns\b/i,
        /\bowner_billing_accounts\b/i,
        /\bowner_plan_entitlements\b/i,
        /\blinked_servers\b/i,
        /\bnitrado/i,
        /\bwrangler\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain forbidden approved-runtime pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowedOrderRouteFiles.has(path)) {
      const source = read(path);
      assert.equal(source.includes("INSERT INTO store_orders"), path === STORE_ORDER_HELPER, `${path} must keep Store order inserts isolated to the helper.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), path === STORE_ORDER_HELPER, `${path} must keep Store order item inserts isolated to the helper.`);
      assert.equal(source.includes("checkout_session_creation_requires_future_approval") || path === STORE_ORDER_ROUTE, true, `${path} must keep checkout unavailable.`);
      for (const forbidden of [
        /\bstore_payment_events\b/i,
        /\bINSERT\s+INTO\s+store_payment_events\b/i,
        /\baccount_entitlements\b/i,
        /\bsupporter_cards\b/i,
        /\bearned_spins\b/i,
        /\bspin_ledger\b/i,
        /\bwheel_cooldowns\b/i,
        /\bcheckout\.sessions\.create\b/i,
        /\/checkout\/sessions/i,
        /\bmode\s*[:=]\s*["']payment["']/i,
        /\bpayment_intent\.succeeded\b/i,
        /\bcharge\.refunded\b/i,
        /\bcharge\.dispute/i,
        /\bverifyStripeWebhook\b/i,
        /\bstripeFormRequest\b/i,
        /\bSTRIPE_SECRET_KEY\b/i,
        /\bSTRIPE_WEBHOOK_SECRET\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store checkout/webhook/fulfilment pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowedCheckoutSessionFiles.has(path)) {
      const source = read(path);
      assert.equal(
        source.includes("createDznStoreSandboxCheckoutSession") || source.includes("DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED"),
        true,
        `${path} must be part of the approved sandbox Checkout Session slice.`,
      );
      assert.equal(source.includes("INSERT INTO store_orders"), false, `${path} must not insert Store orders.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), false, `${path} must not insert Store order items.`);
      assert.equal(source.includes("INSERT INTO store_payment_events"), false, `${path} must not insert Store payment events.`);
      assert.equal(source.includes("UPDATE store_orders"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep Store order checkout updates isolated to the helper.`);
      assert.equal(source.includes("/checkout/sessions"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep Stripe Checkout API calls isolated to the helper.`);
      for (const forbidden of [
        /\bcheckout\.sessions\.create\b/i,
        /\bpayment_intent\.succeeded\b/i,
        /\bcharge\.refunded\b/i,
        /\bcharge\.dispute/i,
        /\bverifyStripeWebhook\b/i,
        /\bstore_payment_events\b/i,
        /\baccount_entitlements\b/i,
        /\bsupporter_cards\b/i,
        /\bearned_spins\b/i,
        /\bspin_ledger\b/i,
        /\bwheel_cooldowns\b/i,
        /\bSTRIPE_WEBHOOK_SECRET\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store webhook/fulfilment pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowedWebhookReceiptFiles.has(path)) {
      const source = read(path);
      assert.equal(
        source.includes("receiveDznStoreSandboxWebhookReceipt") || source.includes("DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED"),
        true,
        `${path} must be part of the approved sandbox webhook receipt slice.`,
      );
      assert.equal(source.includes("INSERT INTO store_orders"), false, `${path} must not insert Store orders.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), false, `${path} must not insert Store order items.`);
      assert.equal(source.includes("UPDATE store_orders"), false, `${path} must not update Store orders.`);
      assert.equal(source.includes("INSERT INTO store_payment_events"), path === STORE_WEBHOOK_HELPER, `${path} must keep Store payment-event inserts isolated to the webhook helper.`);
      for (const forbidden of [
        /\bcheckout\.sessions\.create\b/i,
        /\/checkout\/sessions/i,
        /\bstripeFormRequest\b/i,
        /\bINSERT\s+INTO\s+account_entitlements\b/i,
        /\bUPDATE\s+account_entitlements\b/i,
        /\baccount_entitlements\b/i,
        /\bINSERT\s+INTO\s+supporter_cards\b/i,
        /\bUPDATE\s+supporter_cards\b/i,
        /\bsupporter_cards\b/i,
        /\bINSERT\s+INTO\s+earned_spins\b/i,
        /\bUPDATE\s+earned_spins\b/i,
        /\bearned_spins\b/i,
        /\bINSERT\s+INTO\s+spin_ledger\b/i,
        /\bspin_ledger\b/i,
        /\bwheel_cooldowns\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store fulfilment pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowedExistingPaymentFiles.has(path)) {
      const source = read(path);
      for (const table of LEDGER_TABLES) {
        assert.equal(source.includes(table), false, `${path} must not use ledger table ${table} yet.`);
      }
      continue;
    }

    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not contain Store order/payment runtime pattern ${pattern}.`);
    }
  }
}

function assertNoRuntimeEnvOrConfigFlags() {
  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of STORE_FLAGS) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable future Store flag ${flag} in this schema slice.`);
    }
  }
}

function assertExistingBillingRuntimeUnchanged() {
  const ownerCheckout = read(OWNER_CHECKOUT_ROUTE);
  assert.equal(ownerCheckout.includes('mode: "subscription"'), true, "Owner checkout must remain subscription mode.");
  assert.equal(ownerCheckout.includes('mode: "payment"'), false, "Owner checkout must not gain Store one-time payment mode.");
  assert.equal(ownerCheckout.includes("getCheckoutSafetyStatus"), true, "Owner checkout must keep canonical checkout safety.");

  const ownerWebhook = read(OWNER_WEBHOOK);
  assert.equal(ownerWebhook.includes("checkout.session.completed"), true, "Existing owner webhook must continue subscription checkout handling.");
  assert.equal(ownerWebhook.includes("customer.subscription.updated"), true, "Existing owner webhook must continue subscription update handling.");
  for (const table of [...LEDGER_TABLES, ...BLOCKED_TABLES]) {
    assert.equal(ownerWebhook.includes(table), false, `Owner subscription webhook must not touch Store table ${table}.`);
  }

  const stripeHelper = read(STRIPE_HELPER);
  assert.equal(stripeHelper.includes("export async function verifyStripeWebhook"), true, "Stripe helper must keep raw webhook verification.");
  assert.equal(stripeHelper.includes('request.headers.get("stripe-signature")'), true, "Webhook verifier must read Stripe-Signature.");
  assert.equal(stripeHelper.includes("await request.text()"), true, "Webhook verifier must preserve raw request body.");
  assert.equal(stripeHelper.includes("timingSafeEqual"), true, "Webhook verifier must keep timing-safe signature comparison.");
}

function assertDocsAndBacklog() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "DZN Store Sandbox Order Ledger Schema",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "`store_orders`",
      "`store_order_items`",
      "`store_payment_events`",
      "Applying it to production D1 is not approved by this slice.",
      "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
      "Stripe Checkout Sessions support one-time `payment` mode",
      "Cloudflare D1 migrations are SQL files applied through Wrangler",
      "There is no fulfilled status and no fulfilled timestamp in this schema.",
      "`fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)`",
      "`entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)`",
      "`supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)`",
      "No flag may allow Store purchases to affect owner access",
      "This schema stores only sanitized summaries and raw event hashes",
      "This branch must not run or approve:",
      "`wrangler d1 migrations apply dzn_network_db --remote`",
      "The receipt-only webhook follow-on may now write sanitized `store_payment_events` rows.",
    ]],
    [HANDOFF, [
      "DZN Store Sandbox Order Ledger Schema Handoff",
      "Protected OneDrive checkout was not modified.",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "It is a schema and guard-test slice only.",
      "Fulfilment, entitlement-write, and Supporter Card write blockers fixed to `0`.",
      "No production D1 validation is authorized by this slice.",
      "Follow-on receipt-only Store webhook handling may now write sanitized `store_payment_events` rows.",
    ]],
    [CHECKOUT_PREFLIGHT, [
      "Follow-On Ledger Schema Slice",
      "`docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "local/sandbox-only `store_orders`, `store_order_items`, and `store_payment_events`",
      "still no checkout route, Stripe Checkout Session creation, webhook fulfilment",
    ]],
    [CHECKOUT_HANDOFF, [
      "Follow-On Ledger Schema Slice Delivered",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "store_orders",
      "store_order_items",
      "store_payment_events",
    ]],
    [SAFE_PREFLIGHT, [
      "DZN Store sandbox order ledger schema slice",
      "`docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "allows only `store_orders`, `store_order_items`, and `store_payment_events`",
    ]],
    [BACKLOG, [
      "DZN Store Sandbox Order Ledger Schema",
      "`docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "No Store webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, reward wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is added.",
    ]],
    [MASTER_SPEC, [
      "DZN Store Sandbox Order Ledger Schema Slice",
      "`migrations/0072_dzn_store_order_ledger_schema.sql`",
      "`store_orders`, `store_order_items`, and `store_payment_events`",
      "sandbox/local scoped with `livemode = 0`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store sandbox order ledger schema slice may add `migrations/0072_dzn_store_order_ledger_schema.sql`",
      "The tables are private local/sandbox ledger tables only",
      "It must not add checkout routes, Store APIs, webhook handlers, entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime",
    ]],
    [BILLING_PLANS, [
      "The DZN Store sandbox order ledger schema adds local/sandbox-only `store_orders`, `store_order_items`, and `store_payment_events`",
      "fixed to `livemode = 0`",
      "No Store order creation route, Stripe Checkout Session, webhook fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout activation, production D1 apply, or issue #49 change is added.",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md`",
      "adds source-controlled local/sandbox ledger schema only",
      "does not approve production D1 migration application",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assert.equal(source.includes(snippet), true, `${path} should include: ${snippet}`);
    }
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-order-ledger-schema"],
    "tsx scripts/test-dzn-store-order-ledger-schema.ts",
    "Focused Store order ledger schema test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-order-ledger-schema"),
    true,
    "Full npm test should include the Store order ledger schema guard.",
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
