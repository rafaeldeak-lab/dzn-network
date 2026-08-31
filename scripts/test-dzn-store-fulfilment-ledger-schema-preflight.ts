import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT_HANDOFF.md";
const PRIOR_PREFLIGHT = "docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md";
const PRIOR_HANDOFF = "docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT_HANDOFF.md";
const RECEIPT_DOC = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const FUTURE_FULFILMENT_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const FULFILMENT_RUNTIME_DOC = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_CHECKOUT_HELPER = "functions/_lib/dzn-store-checkout.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const SITE_HEADER = "components/site-header.tsx";
const PLAYER_HUB_API = "functions/api/player/hub.ts";
const PACKAGE_JSON = "package.json";

const INTEGRATION_DOCS = [
  PRIOR_PREFLIGHT,
  PRIOR_HANDOFF,
  RECEIPT_DOC,
  SAFE_PREFLIGHT,
  BACKLOG,
  MASTER_SPEC,
  PUBLIC_ACCESS_POLICY,
  BILLING_PLANS,
  STRIPE_LIVE_CHECKLIST,
] as const;

const FUTURE_SCHEMA_OBJECTS = [
  "account_entitlements",
  "supporter_cards",
  "store_fulfilment_attempts",
  "store_order_status_history",
  "store_entitlement_status_history",
  "store_refund_dispute_audit",
] as const;

const STILL_BLOCKED_SCHEMA_OBJECTS = [
  ...FUTURE_SCHEMA_OBJECTS,
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
] as const;

const RUNTIME_FILES_TO_CHECK = [
  STORE_WEBHOOK_HELPER,
  STORE_WEBHOOK_ROUTE,
  STORE_CHECKOUT_HELPER,
  STORE_ORDER_HELPER,
  OWNER_WEBHOOK,
  OWNER_CHECKOUT_ROUTE,
] as const;

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const BLOCKED_STORE_FLAGS_IN_SOURCE_CONFIG = [
  "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
  "DZN_SUPPORTER_CARDS_ENABLED",
  "DZN_EARNED_SPINS_ENABLED",
  "DZN_REWARD_WHEEL_ENABLED",
  "DZN_STORE_LIVE_CHECKOUT_ENABLED",
  "DZN_LIVE_CHECKOUT_ENABLED=true",
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
  "app/wheel",
] as const;

main();

function main() {
  assertFilesExist();
  assertPreflightContract();
  assertIntegratedDocs();
  assertOnlyApprovedFulfilmentMigrationAdded();
  assertExistingLedgerStillBlocksFulfilment();
  assertRuntimeRemainsReceiptOnly();
  assertNoSourceConfigEnablesFulfilment();
  assertPlayerProfileEntryDiscovery();
  assertPackageScriptWired();
  console.log("DZN Store fulfilment ledger schema preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    PRIOR_PREFLIGHT,
    PRIOR_HANDOFF,
    RECEIPT_DOC,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    ORDER_LEDGER_MIGRATION,
    FUTURE_FULFILMENT_MIGRATION,
    STORE_WEBHOOK_HELPER,
    STORE_FULFILMENT_HELPER,
    FULFILMENT_RUNTIME_DOC,
    STORE_WEBHOOK_ROUTE,
    STORE_CHECKOUT_HELPER,
    STORE_ORDER_HELPER,
    OWNER_WEBHOOK,
    OWNER_CHECKOUT_ROUTE,
    SITE_HEADER,
    PLAYER_HUB_API,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightContract() {
  const doc = read(PREFLIGHT);
  for (const snippet of [
    "# DZN Store Fulfilment Ledger Schema Migration Approval Preflight",
    "This slice is approval preflight only.",
    "No new migration file.",
    "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
    "Current `POST /api/stripe/store-webhook` remains receipt-only.",
    "Current `store_payment_events` fulfilment blockers remain fixed to `0`.",
    "The safer future migration approach is to leave receipt rows immutable",
    "migrations/0073_dzn_store_fulfilment_ledger_schema.sql",
    "Earned spins and wheel ledgers require a later dedicated earned-only progression/wheel slice.",
    "Future `account_entitlements` rows are private account-owned Store cosmetic/supporter entitlements only.",
    "Future `supporter_cards` rows represent the one-time DZN Founding Supporter Card.",
    "Future `store_fulfilment_attempts` rows are the idempotency and audit boundary",
    "Future status history rows provide a non-destructive audit trail",
    "Future `store_refund_dispute_audit` rows reconcile Stripe refund/dispute events",
    "Full refunds, reversals, and lost disputes revoke only the affected Store entitlement/card.",
    "Partial refunds move to `manual_review`",
    "The future migration must not:",
    "Adding schema later does not authorize runtime fulfilment.",
    "No new migration file is added.",
    "Personal Player Page Entry Note",
    "The current application already exposes `/player` as the logged-in Player Hub and `/player/profile` as the private player profile/progression surface.",
    "Next should be DZN Store fulfilment ledger schema migration implementation only if deliberately approved",
  ]) {
    assertIncludes(doc, snippet, `${PREFLIGHT} should contain: ${snippet}`);
  }

  for (const schemaObject of FUTURE_SCHEMA_OBJECTS) {
    assertIncludes(doc, schemaObject, `${PREFLIGHT} should define future ${schemaObject}.`);
  }

  for (const snippet of [
    "UNIQUE(source_order_item_id)",
    "UNIQUE(user_id, entitlement_key, source_order_id)",
    "UNIQUE(user_id, card_type)",
    "UNIQUE(serial_number)",
    "UNIQUE(payment_event_id)",
    "UNIQUE(order_id, payment_event_id)",
    "UNIQUE(order_id, payment_event_id, to_status)",
    "UNIQUE(entitlement_id, payment_event_id, to_status)",
    "UNIQUE(supporter_card_id, payment_event_id, to_status)",
  ]) {
    assertIncludes(doc, snippet, `${PREFLIGHT} should define uniqueness guard ${snippet}.`);
  }

  for (const url of [
    "https://docs.stripe.com/webhooks/signature",
    "https://docs.stripe.com/webhooks",
    "https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted",
    "https://docs.stripe.com/api/events/types",
    "https://docs.stripe.com/api/idempotent_requests",
    "https://docs.stripe.com/refunds",
    "https://docs.stripe.com/disputes/how-disputes-work",
    "https://developers.cloudflare.com/d1/best-practices/local-development/",
    "https://developers.cloudflare.com/d1/wrangler-commands/#migrations",
    "https://developers.cloudflare.com/d1/worker-api/prepared-statements/",
  ]) {
    assertIncludes(doc, url, `${PREFLIGHT} should cite ${url}.`);
  }
}

function assertIntegratedDocs() {
  for (const path of INTEGRATION_DOCS) {
    const source = read(path);
    assertIncludes(source, "DZN Store fulfilment ledger schema migration approval preflight", `${path} should reference this preflight.`);
  }

  assertIncludes(read(PRIOR_PREFLIGHT), "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`");
  assertIncludes(read(PRIOR_HANDOFF), "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`");
  assertIncludes(read(SAFE_PREFLIGHT), "The DZN Store fulfilment ledger schema migration approval preflight is now delivered");
  assertIncludes(read(BACKLOG), "## DZN Store Fulfilment Ledger Schema Migration Approval Preflight");
  assertIncludes(read(MASTER_SPEC), "## DZN Store Fulfilment Ledger Schema Migration Approval Preflight Slice");
  assertIncludes(read(PUBLIC_ACCESS_POLICY), "The DZN Store fulfilment ledger schema migration approval preflight slice is documentation/test-guard work only.");
  assertIncludes(read(BILLING_PLANS), "The DZN Store fulfilment ledger schema migration approval preflight defines the future local/test schema contract.");
  assertIncludes(read(STRIPE_LIVE_CHECKLIST), "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md`");
}

function assertOnlyApprovedFulfilmentMigrationAdded() {
  assert.equal(existsSync(FUTURE_FULFILMENT_MIGRATION), true, `${FUTURE_FULFILMENT_MIGRATION} should exist after deliberate approval.`);
  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"));
  const fulfilmentLedgerMigrations = migrationFiles.filter((path) =>
    /fulfil(?:l)?ment.*ledger|account_entitlement|supporter_card|refund_dispute|wheel_cooldown|spin_ledger|earned_spins/i.test(path),
  );
  assert.deepEqual(
    fulfilmentLedgerMigrations,
    [FUTURE_FULFILMENT_MIGRATION],
    "Only the deliberately approved 0073 fulfilment ledger schema migration should be present.",
  );

  const migration = read(FUTURE_FULFILMENT_MIGRATION);
  const createdTables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(createdTables, [...FUTURE_SCHEMA_OBJECTS], "The approved migration should create exactly the future schema objects defined by this preflight.");
  for (const blocked of ["earned_spins", "spin_ledger", "wheel_cooldowns"]) {
    assert.doesNotMatch(migration, new RegExp(`\\b${blocked}\\b`, "i"), `${FUTURE_FULFILMENT_MIGRATION} must not add ${blocked}.`);
  }
  for (const forbidden of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bDROP\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bcheckout\.sessions\.create\b/i,
    /\/checkout\/sessions/i,
    /\bSTRIPE_SECRET_KEY\b/i,
    /\bSTRIPE_WEBHOOK_SECRET\b/i,
    /\bDZN_LIVE_CHECKOUT_ENABLED\s*=\s*true\b/i,
    /\bDZN_STORE_LIVE_CHECKOUT_ENABLED\s*=\s*true\b/i,
    /\bwrangler\b/i,
    /\bissue\s+#49\b/i,
  ]) {
    assert.doesNotMatch(migration, forbidden, `${FUTURE_FULFILMENT_MIGRATION} must remain schema-only: ${forbidden}`);
  }
}

function assertExistingLedgerStillBlocksFulfilment() {
  const migration = read(ORDER_LEDGER_MIGRATION);
  for (const snippet of [
    "fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)",
    "entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)",
    "supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)",
  ]) {
    assertIncludes(migration, snippet, `${ORDER_LEDGER_MIGRATION} should retain ${snippet}`);
  }

  for (const table of STILL_BLOCKED_SCHEMA_OBJECTS) {
    assert.doesNotMatch(migration, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i"), `${ORDER_LEDGER_MIGRATION} must not create ${table}.`);
  }

  for (const forbidden of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bDROP\s+TABLE\b/i,
  ]) {
    assert.doesNotMatch(migration, forbidden, `${ORDER_LEDGER_MIGRATION} must remain schema-only.`);
  }
}

function assertRuntimeRemainsReceiptOnly() {
  const webhookHelper = read(STORE_WEBHOOK_HELPER);
  assert.match(webhookHelper, /\bINSERT INTO store_payment_events\b/i, "Webhook helper should still insert receipt rows.");
  assertIncludes(webhookHelper, "processDznStoreSandboxWebhookFulfilment", "Webhook helper should delegate to the approved runtime follow-on only after signed receipt handling.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+account_entitlements\b/i, "Webhook helper must not insert account entitlements directly.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+supporter_cards\b/i, "Webhook helper must not issue Supporter Cards directly.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+store_orders\b/i, "Webhook helper must not create Store orders.");
  assert.doesNotMatch(webhookHelper, /\bDELETE\s+FROM\b/i, "Webhook helper must not delete rows.");

  const fulfilmentHelper = read(STORE_FULFILMENT_HELPER);
  for (const snippet of [
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "DZN_STORE_SANDBOX_RUNTIME",
    "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED",
    "STORE_LIVE_CHECKOUT_BLOCKED",
    "STORE_STRIPE_LIVE_SECRET_BLOCKED",
    "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED",
    "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED",
    "STORE_PAYMENT_INTENT_EVENT_NO_GRANT",
  ]) {
    assertIncludes(fulfilmentHelper, snippet, `${STORE_FULFILMENT_HELPER} should keep approved local/test runtime guard ${snippet}.`);
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
    for (const table of STILL_BLOCKED_SCHEMA_OBJECTS) {
      assert.doesNotMatch(source, new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "i"), `${path} must not write ${table}.`);
      if (!path.endsWith("dzn-store-checkout.ts") && !path.endsWith("dzn-store-orders.ts")) {
        assert.doesNotMatch(source, new RegExp(`\\b${table}\\b`, "i"), `${path} must not reference ${table}.`);
      }
    }
  }

  for (const path of FORBIDDEN_NEW_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in this preflight slice.`);
  }
}

function assertNoSourceConfigEnablesFulfilment() {
  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of BLOCKED_STORE_FLAGS_IN_SOURCE_CONFIG) {
      assert.equal(source.includes(flag), false, `${path} must not add or enable ${flag}.`);
    }
  }
}

function assertPlayerProfileEntryDiscovery() {
  const header = read(SITE_HEADER);
  assertIncludes(header, '{ href: "/player", label: "Player Hub", active: "player" }', "Site header should expose the Player Hub entry.");
  const hub = read(PLAYER_HUB_API);
  assertIncludes(hub, 'href: "/player/profile"', "Player Hub API should expose a private player profile entry.");
  assert.match(hub, /publicProfileReady \? privacy\.public_href! : "\/player\/profile"/, "Player Hub should expose either public profile link or profile settings entry.");
  assertIncludes(read(MASTER_SPEC), "The player navigation access polish slice adds a more explicit authenticated `My Player` header action to `/player`");
}

function assertPackageScriptWired() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-fulfilment-ledger-schema-preflight"],
    "tsx scripts/test-dzn-store-fulfilment-ledger-schema-preflight.ts",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-fulfilment-ledger-schema-preflight",
    "Full test chain should include the fulfilment ledger schema preflight guard.",
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
  assert.equal(haystack.includes(needle), true, message ?? `Expected source to include ${needle}`);
}
