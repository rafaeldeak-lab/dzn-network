import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT_HANDOFF.md";
const RUNTIME_DOC = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md";
const RUNTIME_HANDOFF = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const FULFILMENT_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const PACKAGE_JSON = "package.json";

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const FUTURE_FLAGS_THAT_MUST_NOT_BE_CONFIGURED = [
  "DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED",
  "DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED",
  "DZN_STORE_WEBHOOK_REPLAY_ENABLED",
  "DZN_STORE_MANUAL_REVIEW_ENABLED",
  "DZN_STORE_OPERATOR_REFUND_WORKFLOW_ENABLED",
  "DZN_STORE_LIVE_CHECKOUT_ENABLED=true",
  "DZN_LIVE_CHECKOUT_ENABLED=true",
  "DZN_EARNED_SPINS_ENABLED=true",
  "DZN_REWARD_WHEEL_ENABLED=true",
] as const;

const FORBIDDEN_NEW_RUNTIME_PATHS = [
  "functions/api/account/entitlements.ts",
  "functions/api/store/account-purchases.ts",
  "functions/api/store/entitlements.ts",
  "functions/api/store/reconciliation.ts",
  "functions/api/store/webhook-replay.ts",
  "functions/api/store/manual-review.ts",
  "functions/api/store/refund-disputes.ts",
  "functions/api/admin/store/replay.ts",
  "functions/api/admin/store/manual-review.ts",
  "functions/api/admin/store/refund-disputes.ts",
  "functions/api/admin/store/reconciliation.ts",
  "app/account/purchases",
  "app/account/entitlements",
  "app/store/purchases",
  "app/store/supporter-card",
  "app/admin/store/reconciliation",
  "app/admin/store/refund-disputes",
  "components/store/account-purchases.tsx",
  "components/store/account-entitlements.tsx",
  "components/store/supporter-card-reveal.tsx",
  "components/store/refund-dispute-queue.tsx",
  "components/supporter",
] as const;

const FORBIDDEN_RUNTIME_PATTERNS = [
  /\bDZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED\b/,
  /\bDZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED\b/,
  /\bDZN_STORE_WEBHOOK_REPLAY_ENABLED\b/,
  /\bDZN_STORE_MANUAL_REVIEW_ENABLED\b/,
  /\bDZN_STORE_OPERATOR_REFUND_WORKFLOW_ENABLED\b/,
  /\/api\/account\/purchases/i,
  /\/api\/account\/entitlements/i,
  /webhook[-_/]?replay/i,
  /manual[-_/]?review[-_/]?route/i,
  /refund[-_/]?dispute[-_/]?queue/i,
  /\bINSERT\s+INTO\s+earned_spins\b/i,
  /\bINSERT\s+INTO\s+spin_ledger\b/i,
  /\bUPDATE\s+wheel_cooldowns\b/i,
  /\breward_wheel\b/i,
  /\bcheckout\.sessions\.create\b/i,
  /\/checkout\/sessions/i,
  /\bstripeFormRequest\b/i,
  /\bstripeGetRequest\b/i,
  /\bwrangler\b/i,
] as const;

main();

function main() {
  assertFilesExist();
  assertPreflightContract();
  assertHandoffContract();
  assertIntegratedDocs();
  assertNoRuntimePathsOrMigrations();
  assertNoSourceConfigEnablesFutureFlags();
  assertExistingRuntimeBoundaryUnchanged();
  assertPackageScriptWired();
  console.log("DZN Store fulfilment reconciliation/read-model preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    RUNTIME_DOC,
    RUNTIME_HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    FULFILMENT_HELPER,
    WEBHOOK_HELPER,
    STORE_WEBHOOK_ROUTE,
    FULFILMENT_MIGRATION,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightContract() {
  const doc = read(PREFLIGHT);
  for (const snippet of [
    "# DZN Store Fulfilment Reconciliation/Read-Model Preflight",
    "This slice is approval preflight only.",
    "No Account Purchases route is added.",
    "No Entitlements route is added.",
    "No Supporter Card reveal UI is added.",
    "No public Supporter Card reveal UI is added.",
    "No webhook replay route is added.",
    "No manual-review operator route is added.",
    "No refund/dispute operator route is added.",
    "No notification is added.",
    "No migration is added.",
    "`DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED`",
    "`DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED`",
    "`DZN_STORE_WEBHOOK_REPLAY_ENABLED`",
    "`DZN_STORE_MANUAL_REVIEW_ENABLED`",
    "`DZN_STORE_OPERATOR_REFUND_WORKFLOW_ENABLED`",
    "private Account Purchases and Entitlements read model",
    "`GET /api/account/purchases`",
    "`GET /api/account/entitlements`",
    "The future Supporter Card reveal/status UI must be private first.",
    "Webhook replay is an admin-only recovery tool, not a customer action.",
    "Manual review handles Store fulfilment exceptions",
    "The future refund/dispute operator workflow must build on `store_refund_dispute_audit`",
    "Success-page redirects",
    "no-store",
    "No production D1 migration apply is authorized.",
    "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
    "Issue #49 remains reserved for final live checkout activation.",
    "Next should be the Store private Account Purchases and Entitlements read-model implementation approval slice",
  ]) {
    assertIncludes(doc, snippet, `${PREFLIGHT} should contain: ${snippet}`);
  }

  for (const url of [
    "https://docs.stripe.com/webhooks/signature",
    "https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted",
    "https://docs.stripe.com/api/events/types",
    "https://docs.stripe.com/refunds",
    "https://docs.stripe.com/disputes/how-disputes-work",
    "https://developers.cloudflare.com/d1/worker-api/prepared-statements/",
    "https://developers.cloudflare.com/d1/best-practices/local-development/",
  ]) {
    assertIncludes(doc, url, `${PREFLIGHT} should cite ${url}.`);
  }

  for (const isolation of [
    "owner billing",
    "`/setup`",
    "Nitrado linking",
    "server ownership",
    "rankings",
    "discovery score",
    "reviews",
    "badges",
    "seasons",
    "events",
    "Server Wars scoring",
    "CTF scoring",
    "XP awards",
    "calling-card awards",
    "public profile visibility",
    "retained exports",
    "moderation decisions",
    "competitive eligibility",
  ]) {
    assertIncludes(doc, isolation, `${PREFLIGHT} must preserve isolation for ${isolation}.`);
  }
}

function assertHandoffContract() {
  const handoff = read(HANDOFF);
  for (const snippet of [
    "# DZN Store Fulfilment Reconciliation/Read-Model Preflight Handoff",
    "Branch: `codex/dzn-store-fulfilment-reconciliation-preflight-20260829`",
    "Base: `9ac2a92cd4b622823ff0bae0e3f10054101c651e`",
    "Protected OneDrive checkout was not modified.",
    "No `GET /api/account/purchases`.",
    "No `GET /api/account/entitlements`.",
    "No account purchases page.",
    "No public Supporter Card reveal.",
    "No webhook replay route.",
    "No manual-review route.",
    "No refund/dispute operator route.",
    "No notification route or notification writes.",
    "No migration after `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`.",
    "No live checkout activation.",
    "No issue #49 change.",
  ]) {
    assertIncludes(handoff, snippet, `${HANDOFF} should contain: ${snippet}`);
  }
}

function assertIntegratedDocs() {
  for (const [path, snippets] of [
    [RUNTIME_DOC, [
      "The DZN Store fulfilment reconciliation/read-model preflight is now delivered",
      "`docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`",
    ]],
    [RUNTIME_HANDOFF, [
      "The DZN Store fulfilment reconciliation/read-model preflight is now delivered",
      "`docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store fulfilment reconciliation/read-model preflight is now delivered",
      "private Account Purchases and Entitlements read models",
    ]],
    [BACKLOG, [
      "## DZN Store Fulfilment Reconciliation/Read-Model Preflight",
      "Delivered in `docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`.",
    ]],
    [MASTER_SPEC, [
      "## DZN Store Fulfilment Reconciliation/Read-Model Preflight Slice",
      "`docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store fulfilment reconciliation/read-model preflight slice is documentation/test-guard work only.",
    ]],
    [BILLING_PLANS, [
      "The DZN Store fulfilment reconciliation/read-model preflight defines future private Account Purchases",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md` defines private Account Purchases",
    ]],
  ] satisfies Array<[string, string[]]>) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should contain: ${snippet}`);
    }
  }
}

function assertNoRuntimePathsOrMigrations() {
  for (const path of FORBIDDEN_NEW_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in this preflight slice.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), FULFILMENT_MIGRATION, "No migration after 0073 should be added by this preflight.");
}

function assertNoSourceConfigEnablesFutureFlags() {
  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of FUTURE_FLAGS_THAT_MUST_NOT_BE_CONFIGURED) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable ${flag}.`);
    }
  }
}

function assertExistingRuntimeBoundaryUnchanged() {
  const webhookRoute = read(STORE_WEBHOOK_ROUTE);
  const webhookHelper = read(WEBHOOK_HELPER);
  const fulfilmentHelper = read(FULFILMENT_HELPER);

  assertIncludes(webhookRoute, "receiveDznStoreSandboxWebhookReceipt", "Store webhook route should remain delegated to the receipt helper.");
  assertIncludes(webhookHelper, "verifyStripeWebhookWithRawBody", "Store webhook helper should keep raw Stripe signature verification.");
  assertIncludes(webhookHelper, "processDznStoreSandboxWebhookFulfilment", "Webhook helper should keep the approved fulfilment helper boundary.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+account_entitlements\b/i, "Webhook helper must not directly write account entitlements.");
  assert.doesNotMatch(webhookHelper, /\bINSERT\s+INTO\s+supporter_cards\b/i, "Webhook helper must not directly issue Supporter Cards.");

  for (const required of [
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "STORE_WEBHOOK_FULFILMENT_DISABLED",
    "STORE_LIVE_CHECKOUT_BLOCKED",
    "STORE_STRIPE_LIVE_SECRET_BLOCKED",
    "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED",
    "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED",
    "checkout.session.completed",
    "STORE_PAYMENT_INTENT_EVENT_NO_GRANT",
    "STORE_FULL_REFUND_REVOKED",
    "STORE_DISPUTE_LOST_REVOKED",
  ]) {
    assertIncludes(fulfilmentHelper, required, `${FULFILMENT_HELPER} should keep guard ${required}.`);
  }

  for (const pattern of FORBIDDEN_RUNTIME_PATTERNS) {
    assert.doesNotMatch(fulfilmentHelper, pattern, `${FULFILMENT_HELPER} must not add reconciliation/read-model runtime pattern ${pattern}.`);
    assert.doesNotMatch(webhookHelper, pattern, `${WEBHOOK_HELPER} must not add reconciliation/read-model runtime pattern ${pattern}.`);
  }
}

function assertPackageScriptWired() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-fulfilment-reconciliation-read-model-preflight"],
    "tsx scripts/test-dzn-store-fulfilment-reconciliation-read-model-preflight.ts",
    "Focused reconciliation/read-model preflight test should be wired into package scripts.",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-fulfilment-reconciliation-read-model-preflight",
    "Full npm test should include the reconciliation/read-model preflight guard.",
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
