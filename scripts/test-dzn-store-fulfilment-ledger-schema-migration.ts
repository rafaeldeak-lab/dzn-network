import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const DOC = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md";
const HANDOFF = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION_HANDOFF.md";
const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT.md";
const PREFLIGHT_HANDOFF = "docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_PREFLIGHT_HANDOFF.md";
const PRIOR_PREFLIGHT = "docs/DZN_STORE_WEBHOOK_FULFILMENT_APPROVAL_PREFLIGHT.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const PACKAGE_JSON = "package.json";

const ALLOWED_TABLES = [
  "account_entitlements",
  "supporter_cards",
  "store_fulfilment_attempts",
  "store_order_status_history",
  "store_entitlement_status_history",
  "store_refund_dispute_audit",
] as const;

const BLOCKED_TABLES = [
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
  "owner_billing_accounts",
  "owner_plan_entitlements",
  "server_subscriptions",
  "server_owners",
  "linked_servers",
  "nitrado_connections",
  "server_rankings",
  "leaderboards",
  "server_reviews",
  "review_score",
  "badge_awards",
  "dzn_seasons",
  "competitive_events",
  "ctf_tournament",
  "server_wars",
  "player_progression_award_sources",
  "player_xp",
  "player_calling_card_awards",
  "player_profile_privacy_preferences",
  "community_member",
  "retained_export",
] as const;

const FIXED_ZERO_ENTITLEMENT_FLAGS = [
  "grants_owner_subscription_access",
  "grants_spins",
  "grants_xp",
  "grants_rank_advantage",
  "grants_discovery_advantage",
  "grants_review_advantage",
  "grants_event_advantage",
  "grants_server_wars_advantage",
  "grants_ctf_advantage",
  "grants_competitive_eligibility",
] as const;

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/_lib/dzn-store-fulfilment.ts",
  "functions/_lib/dzn-store-entitlements.ts",
  "functions/_lib/dzn-supporter-cards.ts",
  "functions/_lib/dzn-store-wheel.ts",
  "functions/api/stripe/store-fulfilment.ts",
  "functions/api/store/fulfilment.ts",
  "functions/api/store/webhook-fulfilment.ts",
  "functions/api/account/purchases.ts",
  "functions/api/wheel",
  "components/supporter",
  "components/wheel",
  "app/account/purchases",
  "app/wheel",
] as const;

main();

function main() {
  assertFilesExist();
  assertMigrationNumbering();
  assertMigrationCreatesOnlyApprovedTables();
  assertAccountEntitlementSchema();
  assertSupporterCardSchema();
  assertFulfilmentAttemptSchema();
  assertStatusHistorySchema();
  assertRefundDisputeAuditSchema();
  assertNoForbiddenSchemaOrMutation();
  assertExistingReceiptLedgerStillBlocksRuntimeWrites();
  assertRuntimeRemainsDisabled();
  assertDocsAndBacklog();
  assertPackageScript();
  console.log("DZN Store fulfilment ledger schema migration tests passed.");
}

function assertFilesExist() {
  for (const path of [
    MIGRATION,
    ORDER_LEDGER_MIGRATION,
    DOC,
    HANDOFF,
    PREFLIGHT,
    PREFLIGHT_HANDOFF,
    PRIOR_PREFLIGHT,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    STORE_WEBHOOK_HELPER,
    STORE_WEBHOOK_ROUTE,
    OWNER_WEBHOOK,
    OWNER_CHECKOUT_ROUTE,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertMigrationNumbering() {
  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.includes(ORDER_LEDGER_MIGRATION), true, "0072 Store order ledger migration should remain present.");
  assert.equal(migrationFiles.includes(MIGRATION), true, "0073 Store fulfilment ledger schema migration should exist.");
  assert.equal(migrationFiles.filter((path) => path.startsWith("migrations/0073_")).length, 1, "There must be exactly one 0073 migration.");
  assert.equal(migrationFiles.at(-1), MIGRATION, "0073 should be the latest migration after numbering was rechecked.");
}

function assertMigrationCreatesOnlyApprovedTables() {
  const migration = read(MIGRATION);
  const createdTables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(createdTables, [...ALLOWED_TABLES], "0073 should create exactly the approved Store fulfilment ledger tables.");

  for (const table of ALLOWED_TABLES) {
    assert.match(migration, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`, "i"), `${table} table should be created.`);
  }
}

function assertAccountEntitlementSchema() {
  const migration = read(MIGRATION);
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS account_entitlements",
    "id TEXT PRIMARY KEY",
    "user_id TEXT NOT NULL",
    "entitlement_key TEXT NOT NULL",
    "source_order_id TEXT NOT NULL",
    "source_order_item_id TEXT NOT NULL",
    "source_product_key TEXT NOT NULL",
    "source_product_type TEXT NOT NULL",
    "source_fulfilment_kind TEXT NOT NULL",
    "status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'suspended', 'revoked', 'manual_review'))",
    "visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible', 'hidden'))",
    "granted_by_payment_event_id TEXT NOT NULL",
    "revoked_by_payment_event_id TEXT",
    "ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox'))",
    "livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)",
    "UNIQUE(source_order_item_id)",
    "UNIQUE(user_id, entitlement_key, source_order_id)",
    "FOREIGN KEY(user_id) REFERENCES users(id)",
    "FOREIGN KEY(source_order_id) REFERENCES store_orders(id)",
    "FOREIGN KEY(source_order_item_id) REFERENCES store_order_items(id)",
    "FOREIGN KEY(granted_by_payment_event_id) REFERENCES store_payment_events(id)",
    "FOREIGN KEY(revoked_by_payment_event_id) REFERENCES store_payment_events(id)",
    "idx_account_entitlements_user_status_granted",
    "idx_account_entitlements_order",
    "idx_account_entitlements_granted_event",
  ]) {
    assertIncludes(migration, snippet, `${MIGRATION} should include account_entitlements guard: ${snippet}`);
  }

  for (const flag of FIXED_ZERO_ENTITLEMENT_FLAGS) {
    assertIncludes(migration, `${flag} INTEGER NOT NULL DEFAULT 0 CHECK(${flag} = 0)`, `Store entitlements must keep ${flag} fixed to zero.`);
  }
}

function assertSupporterCardSchema() {
  const migration = read(MIGRATION);
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS supporter_cards",
    "user_id TEXT NOT NULL",
    "entitlement_id TEXT NOT NULL UNIQUE",
    "source_order_id TEXT NOT NULL",
    "source_order_item_id TEXT NOT NULL",
    "serial_number TEXT NOT NULL UNIQUE CHECK(serial_number GLOB 'DZN-SUP-[0-9][0-9][0-9][0-9][0-9][0-9]')",
    "card_type TEXT NOT NULL DEFAULT 'founding_supporter' CHECK(card_type IN ('founding_supporter'))",
    "display_name_snapshot TEXT NOT NULL",
    "supporter_since TEXT NOT NULL",
    "selected_theme_key TEXT NOT NULL",
    "insignia_seed_hash TEXT NOT NULL",
    "generated_insignia_json TEXT NOT NULL",
    "visibility_state TEXT NOT NULL DEFAULT 'visible' CHECK(visibility_state IN ('visible', 'hidden'))",
    "status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'suspended', 'revoked', 'manual_review'))",
    "issued_by_payment_event_id TEXT NOT NULL",
    "revoked_by_payment_event_id TEXT",
    "ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox'))",
    "livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)",
    "UNIQUE(user_id, card_type)",
    "UNIQUE(source_order_item_id)",
    "FOREIGN KEY(entitlement_id) REFERENCES account_entitlements(id)",
    "FOREIGN KEY(issued_by_payment_event_id) REFERENCES store_payment_events(id)",
    "FOREIGN KEY(revoked_by_payment_event_id) REFERENCES store_payment_events(id)",
    "idx_supporter_cards_user_status",
    "idx_supporter_cards_order",
    "idx_supporter_cards_issued_event",
  ]) {
    assertIncludes(migration, snippet, `${MIGRATION} should include supporter_cards guard: ${snippet}`);
  }
}

function assertFulfilmentAttemptSchema() {
  const migration = read(MIGRATION);
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS store_fulfilment_attempts",
    "attempt_key TEXT NOT NULL UNIQUE",
    "payment_event_id TEXT NOT NULL UNIQUE",
    "stripe_event_id TEXT NOT NULL",
    "event_type TEXT NOT NULL",
    "order_id TEXT NOT NULL",
    "order_item_id TEXT",
    "livemode INTEGER NOT NULL DEFAULT 0 CHECK(livemode = 0)",
    "ledger_scope TEXT NOT NULL DEFAULT 'sandbox' CHECK(ledger_scope IN ('local', 'sandbox'))",
    "status TEXT NOT NULL CHECK(status IN ('received', 'blocked_by_flag', 'eligible', 'fulfilled', 'duplicate', 'manual_review', 'failed', 'no_op'))",
    "entitlement_id TEXT",
    "supporter_card_id TEXT",
    "fulfilment_flags_snapshot_json TEXT NOT NULL DEFAULT '{}'",
    "safe_event_summary_json TEXT NOT NULL DEFAULT '{}'",
    "UNIQUE(order_id, payment_event_id)",
    "FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id)",
    "FOREIGN KEY(entitlement_id) REFERENCES account_entitlements(id)",
    "FOREIGN KEY(supporter_card_id) REFERENCES supporter_cards(id)",
    "idx_store_fulfilment_attempts_order_status_created",
    "idx_store_fulfilment_attempts_stripe_event",
    "idx_store_fulfilment_attempts_status_created",
  ]) {
    assertIncludes(migration, snippet, `${MIGRATION} should include fulfilment-attempt guard: ${snippet}`);
  }
}

function assertStatusHistorySchema() {
  const migration = read(MIGRATION);
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS store_order_status_history",
    "CREATE TABLE IF NOT EXISTS store_entitlement_status_history",
    "actor_type TEXT NOT NULL CHECK(actor_type IN ('stripe_webhook', 'system', 'admin_review'))",
    "safe_summary_json TEXT NOT NULL DEFAULT '{}'",
    "CHECK(entitlement_id IS NOT NULL OR supporter_card_id IS NOT NULL)",
    "UNIQUE(order_id, payment_event_id, to_status)",
    "UNIQUE(entitlement_id, payment_event_id, to_status)",
    "UNIQUE(supporter_card_id, payment_event_id, to_status)",
    "FOREIGN KEY(order_id) REFERENCES store_orders(id)",
    "FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id)",
    "FOREIGN KEY(entitlement_id) REFERENCES account_entitlements(id)",
    "FOREIGN KEY(supporter_card_id) REFERENCES supporter_cards(id)",
    "idx_store_order_status_history_order_created",
    "idx_store_order_status_history_status_created",
    "idx_store_entitlement_status_history_order_created",
    "idx_store_entitlement_status_history_status_created",
  ]) {
    assertIncludes(migration, snippet, `${MIGRATION} should include status-history guard: ${snippet}`);
  }
}

function assertRefundDisputeAuditSchema() {
  const migration = read(MIGRATION);
  for (const snippet of [
    "CREATE TABLE IF NOT EXISTS store_refund_dispute_audit",
    "payment_event_id TEXT NOT NULL UNIQUE",
    "order_id TEXT",
    "event_type TEXT NOT NULL",
    "stripe_charge_id TEXT",
    "stripe_refund_id TEXT",
    "stripe_dispute_id TEXT",
    "amount_minor INTEGER CHECK(amount_minor IS NULL OR amount_minor >= 0)",
    "currency TEXT CHECK(currency IS NULL OR currency = lower(currency))",
    "refund_kind TEXT CHECK(refund_kind IN ('none', 'partial', 'full'))",
    "local_decision TEXT NOT NULL CHECK(local_decision IN ('recorded', 'suspend', 'revoke', 'restore', 'manual_review', 'ignored'))",
    "decision_reason TEXT NOT NULL",
    "safe_summary_json TEXT NOT NULL DEFAULT '{}'",
    "FOREIGN KEY(payment_event_id) REFERENCES store_payment_events(id)",
    "idx_store_refund_dispute_audit_order_created",
    "idx_store_refund_dispute_audit_event_created",
    "idx_store_refund_dispute_audit_decision_created",
    "idx_store_refund_dispute_audit_refund_id",
    "WHERE stripe_refund_id IS NOT NULL",
    "idx_store_refund_dispute_audit_dispute_id",
    "WHERE stripe_dispute_id IS NOT NULL",
  ]) {
    assertIncludes(migration, snippet, `${MIGRATION} should include refund/dispute audit guard: ${snippet}`);
  }
}

function assertNoForbiddenSchemaOrMutation() {
  const migration = read(MIGRATION);
  for (const table of BLOCKED_TABLES) {
    assert.doesNotMatch(migration, new RegExp(`\\b${table}\\b`, "i"), `${MIGRATION} must not reference blocked table/system ${table}.`);
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
    /\braw_event_body\b/i,
    /\braw_payload\b/i,
    /\bcard_number\b/i,
    /\bcvc\b/i,
    /\bbilling_address\b/i,
    /\bpayment_method_details\b/i,
  ]) {
    assert.doesNotMatch(migration, forbidden, `${MIGRATION} must remain schema-only and private-payment-safe: ${forbidden}`);
  }
}

function assertExistingReceiptLedgerStillBlocksRuntimeWrites() {
  const migration = read(ORDER_LEDGER_MIGRATION);
  for (const snippet of [
    "fulfilment_attempted INTEGER NOT NULL DEFAULT 0 CHECK(fulfilment_attempted = 0)",
    "entitlement_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(entitlement_write_attempted = 0)",
    "supporter_card_write_attempted INTEGER NOT NULL DEFAULT 0 CHECK(supporter_card_write_attempted = 0)",
  ]) {
    assertIncludes(migration, snippet, `${ORDER_LEDGER_MIGRATION} should retain receipt-only blocker: ${snippet}`);
  }
}

function assertRuntimeRemainsDisabled() {
  const webhookHelper = read(STORE_WEBHOOK_HELPER);
  assert.match(webhookHelper, /\bINSERT INTO store_payment_events\b/i, "Store webhook should still record only receipt rows.");
  assert.doesNotMatch(webhookHelper, /\bUPDATE\s+store_orders\b/i, "Store webhook must not fulfil by updating orders.");

  for (const path of [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path))) {
    const source = read(path);
    for (const table of ALLOWED_TABLES) {
      assert.doesNotMatch(source, new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "i"), `${path} must not write future fulfilment table ${table}.`);
    }
  }

  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in this schema migration slice.`);
  }

  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of [
      "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
      "DZN_SUPPORTER_CARDS_ENABLED",
      "DZN_EARNED_SPINS_ENABLED",
      "DZN_REWARD_WHEEL_ENABLED",
      "DZN_STORE_LIVE_CHECKOUT_ENABLED",
      "DZN_LIVE_CHECKOUT_ENABLED=true",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable ${flag}.`);
    }
  }

  const ownerCheckout = read(OWNER_CHECKOUT_ROUTE);
  assert.equal(ownerCheckout.includes('mode: "subscription"'), true, "Owner checkout must remain subscription-only.");
  assert.equal(ownerCheckout.includes('mode: "payment"'), false, "Owner checkout must not gain Store one-time payment mode.");

  const ownerWebhook = read(OWNER_WEBHOOK);
  for (const table of [...ALLOWED_TABLES, "earned_spins", "spin_ledger", "wheel_cooldowns"]) {
    assert.equal(ownerWebhook.includes(table), false, `Owner subscription webhook must not touch Store table ${table}.`);
  }
}

function assertDocsAndBacklog() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "DZN Store Fulfilment Ledger Schema Migration",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
      "`account_entitlements`",
      "`supporter_cards`",
      "`store_fulfilment_attempts`",
      "`store_order_status_history`",
      "`store_entitlement_status_history`",
      "`store_refund_dispute_audit`",
      "local/test-only",
      "`livemode = 0`",
      "Store fulfilment runtime remains disabled",
      "No Supporter Card issuance",
      "No earned spins",
      "No reward wheel runtime",
      "No live checkout",
      "No production D1 writes",
      "Issue #49 remains reserved",
    ]],
    [HANDOFF, [
      "DZN Store Fulfilment Ledger Schema Migration Handoff",
      "Protected OneDrive checkout was not modified.",
      "Branch: `codex/dzn-store-fulfilment-ledger-schema-migration-20260828`",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
      "No runtime fulfilment.",
      "No Supporter Card issuance.",
      "No earned spins.",
      "No reward wheel runtime.",
      "No live checkout.",
      "No production D1 writes.",
      "No issue #49 change.",
    ]],
    [PREFLIGHT, [
      "Approved follow-on implementation",
      "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md`",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
    ]],
    [PREFLIGHT_HANDOFF, [
      "Approved follow-on implemented",
      "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md`",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
    ]],
    [PRIOR_PREFLIGHT, [
      "Delivered follow-on reference: the DZN Store fulfilment ledger schema migration approval preflight",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store fulfilment ledger schema migration implementation slice is now delivered",
      "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md`",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
      "runtime fulfilment remains disabled",
    ]],
    [BACKLOG, [
      "DZN Store Fulfilment Ledger Schema Migration Implementation",
      "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md`",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
      "Store fulfilment runtime remains disabled",
    ]],
    [MASTER_SPEC, [
      "DZN Store Fulfilment Ledger Schema Migration Slice",
      "`migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
      "local/test-only fulfilment ledger schema",
      "No runtime fulfilment, Supporter Card issuance, earned spins, reward wheel runtime, live checkout, production D1 apply, or issue #49 change",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store fulfilment ledger schema migration slice may add `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`",
      "local/test-only private Store fulfilment ledger schema",
      "It must not add runtime fulfilment",
    ]],
    [BILLING_PLANS, [
      "The DZN Store fulfilment ledger schema migration adds local/test-only private ledger tables",
      "It does not grant owner access, account entitlements at runtime, Supporter Cards at runtime, spins, XP, rankings",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_FULFILMENT_LEDGER_SCHEMA_MIGRATION.md` adds source-controlled local/test fulfilment ledger schema only",
      "does not approve production D1 migration application",
      "does not approve Store webhook fulfilment",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should document: ${snippet}`);
    }
  }
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-fulfilment-ledger-schema-migration"],
    "tsx scripts/test-dzn-store-fulfilment-ledger-schema-migration.ts",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-fulfilment-ledger-schema-migration",
    "Full test chain should include the fulfilment ledger schema migration guard.",
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
  assert.equal(haystack?.includes(needle), true, message ?? `Expected source to include ${needle}`);
}
