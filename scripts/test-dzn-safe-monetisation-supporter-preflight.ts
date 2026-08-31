import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const HANDOFF = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT_HANDOFF.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const PLANS_HELPER = "functions/_lib/plans.ts";
const STRIPE_WEBHOOK = "functions/api/stripe/webhook.ts";
const CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const STORE_CATALOG_HELPER = "functions/_lib/dzn-store-catalog.ts";
const STORE_CATALOG_MIGRATION = "migrations/0071_dzn_store_catalog_admin_draft.sql";
const STORE_ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const STORE_FULFILMENT_LEDGER_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const STORE_CHECKOUT_SESSION_ROUTE = "functions/api/store/orders/[orderId]/checkout.ts";
const STORE_CHECKOUT_SESSION_HELPER = "functions/_lib/dzn-store-checkout.ts";
const STORE_CHECKOUT_SESSION_DOC = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md";
const STORE_CHECKOUT_SESSION_HANDOFF = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const STORE_WEBHOOK_DOC = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md";
const STORE_WEBHOOK_HANDOFF = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT_HANDOFF.md";
const STORE_PREVIEW_PAGE = "app/store/page.tsx";
const STORE_PREVIEW_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const STORE_ACCOUNT_PURCHASES_PAGE = "app/account/purchases/page.tsx";
const STORE_ACCOUNT_PURCHASES_COMPONENT = "components/store/dzn-store-account-purchases-page.tsx";
const PACKAGE_JSON = "package.json";

const PREFLIGHT_SNIPPETS = [
  "DZN Safe Monetisation And Supporter System Implementation Preflight",
  "This slice is implementation preflight only.",
  "One-time Stripe Checkout Sessions.",
  "Store, supporter, purchase, account-entitlement, or wheel routes.",
  "Supporter Card issuance.",
  "Earned-spin ledgers or wheel runtime.",
  "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
  "Issue #49 remains reserved for final live owner-subscription checkout activation",
  "Current DZN Architecture Found",
  "`lib/billing/plans.ts`",
  "`functions/_lib/plans.ts`",
  "`functions/_lib/stripe.ts`",
  "`functions/api/billing/create-checkout-session.ts`",
  "`functions/api/stripe/webhook.ts`",
  "Store entitlements are player/account cosmetics and supporter recognition only.",
  "Stripe Checkout Sessions are created server-side",
  "Store checkout must use `mode=payment`, not subscription mode.",
  "Stripe webhook verification must use the `Stripe-Signature` header and the unmodified raw request body.",
  "Stripe idempotency keys apply to retryable `POST` requests and must not contain sensitive information.",
  "Stripe Tax or equivalent tax/VAT records must be considered before live checkout",
  "This design supersedes the earlier paid-spin idea.",
  "Players must never be able to purchase spins directly or indirectly",
  "DZN Founding Supporter Pack.",
  "Catalog and admin draft schema",
  "Store browse and preview UI",
  "Order creation and one-time Checkout",
  "Webhook event ledger",
  "Idempotent fulfilment",
  "Supporter Card issuance",
  "Earned-spin award ledger",
  "Wheel runtime",
  "Account purchases and entitlements",
  "Refund, reversal, and chargeback handling",
  "Admin pricing and availability",
  "Live activation review",
  "No new Cloudflare variables or `cloudflare-env.d.ts` entries are added by this preflight.",
  "`DZN_STORE_ENABLED`",
  "`DZN_STORE_CHECKOUT_ENABLED`",
  "`DZN_STORE_SANDBOX_CHECKOUT_ENABLED`",
  "`DZN_STORE_WEBHOOK_FULFILMENT_ENABLED`",
  "`DZN_SUPPORTER_CARDS_ENABLED`",
  "`DZN_EARNED_SPINS_ENABLED`",
  "`DZN_REWARD_WHEEL_ENABLED`",
  "`DZN_STORE_ADMIN_ENABLED`",
  "`DZN_STORE_LIVE_CHECKOUT_ENABLED`",
  "`NEXT_PUBLIC_DZN_STORE_ENABLED`",
  "`store_products`",
  "`store_prices`",
  "`store_orders`",
  "`store_order_items`",
  "`store_payment_events`",
  "`account_entitlements`",
  "`supporter_cards`",
  "`earned_spins`",
  "`spin_ledger`",
  "`wheel_cooldowns`",
  "Payment And Webhook Contract",
  "Store checkout is account/player purchase billing with `mode=payment`.",
  "Never grant an entitlement from the success-page redirect.",
  "Tax, Receipts, And Payment Data Boundaries",
  "Fair Progression Boundary",
  "Cosmetic calling-card packs must remain separate from earned calling-card awards.",
  "Rollback Plan",
  "Security Proof Required Before Runtime",
  "Players cannot buy spins directly.",
  "Payment webhooks cannot fulfil the same order twice.",
  "Store purchases cannot alter XP, rankings, scoring, reviews, discovery, badges, seasons, events, Server Wars, CTF scoring, public profile visibility, retained exports, owner entitlement, server ownership, or competitive eligibility.",
  "This Slice's Test Contract",
  "The follow-on DZN Store catalog and admin product/price draft model slice may add only `store_products`, `store_prices`, and local admin draft validation.",
  "DZN Store public browse and Supporter Card preview contract: delivered as a read-only preview contract slice",
  "The next payment-facing step must be a DZN Store sandbox order and checkout approval preflight",
];

const INTEGRATION_SNIPPETS: Record<string, string[]> = {
  [BACKLOG]: [
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "Implementation Preflight",
    "safe production implementation sequence",
    "keeps `DZN_LIVE_CHECKOUT_ENABLED` unset/false",
    "The first runtime step after the preflight is the DZN Store catalog and admin product/price draft model",
  ],
  [MASTER_SPEC]: [
    "DZN Safe Monetisation And Supporter System Implementation Preflight Slice",
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "One-time Stripe Checkout using `mode=payment` only after checkout flags are enabled.",
    "delivered as a documentation/test-guard slice",
    "DZN Store catalog and admin product/price draft model: delivered as the first safe implementation slice",
  ],
  [PUBLIC_ACCESS_POLICY]: [
    "The DZN Safe Monetisation And Supporter System Implementation Preflight Slice may define the real production store/catalog/order/payment/spin-ledger/supporter-card implementation sequence",
    "one-time Checkout `mode=payment` boundary",
    "It must not implement account purchases, reward wheel, store checkout, store webhook fulfilment",
    "The `/store` route is a public-safe, read-only DZN Store preview contract",
    "Future store purchases are player/account cosmetics only",
    "The DZN Store catalog and admin product/price draft model slice may add only the inactive `store_products` and `store_prices` schema",
  ],
  [BILLING_PLANS]: [
    "Future Store And Supporter Purchases",
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "Future one-time Store purchases are separate from Starter/Pro owner subscriptions.",
    "Players must never be able to buy wheel spins.",
    "The DZN Store catalog and admin product/price draft model adds only inactive product/price metadata",
    "The read-only `/store` preview is not an owner subscription checkout path",
  ],
  [STRIPE_LIVE_CHECKLIST]: [
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "does not approve store live checkout",
    "Stripe product/Price mutation",
    "Cloudflare secret changes",
    "production D1 writes",
    "issue #49 changes",
  ],
  [HANDOFF]: [
    "DZN Safe Monetisation And Supporter System Implementation Preflight Handoff",
    "Protected OneDrive checkout was not modified.",
    "Future Store purchases are player/account cosmetic entitlements only.",
    "Completed:",
    "`npm run test:dzn-safe-monetisation-supporter-preflight`",
    "`npm test`",
    "Codex Security diff scan:",
    "Result: zero findings.",
    "No live checkout was enabled.",
    "Next should be the DZN Store catalog and admin product/price draft model",
  ],
};

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

const FUTURE_STORE_FLAGS = [
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
];

const FORBIDDEN_TABLE_NAMES = [
  "store_products",
  "store_prices",
  "store_orders",
  "store_order_items",
  "store_payment_events",
  "account_entitlements",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
];

const ALLOWED_CATALOG_TABLE_NAMES = ["store_products", "store_prices"];

const FORBIDDEN_NON_CATALOG_TABLE_NAMES = FORBIDDEN_TABLE_NAMES.filter((table) => !ALLOWED_CATALOG_TABLE_NAMES.includes(table));
const ALLOWED_ORDER_LEDGER_TABLE_NAMES = ["store_orders", "store_order_items", "store_payment_events"];
const FORBIDDEN_NON_LEDGER_TABLE_NAMES = FORBIDDEN_TABLE_NAMES.filter(
  (table) => ![...ALLOWED_CATALOG_TABLE_NAMES, ...ALLOWED_ORDER_LEDGER_TABLE_NAMES].includes(table),
);
const ALLOWED_FULFILMENT_LEDGER_TABLE_NAMES = [
  "account_entitlements",
  "supporter_cards",
  "store_fulfilment_attempts",
  "store_order_status_history",
  "store_entitlement_status_history",
  "store_refund_dispute_audit",
];
const FORBIDDEN_NON_FULFILMENT_LEDGER_TABLE_NAMES = FORBIDDEN_TABLE_NAMES.filter(
  (table) => ![...ALLOWED_CATALOG_TABLE_NAMES, ...ALLOWED_ORDER_LEDGER_TABLE_NAMES, ...ALLOWED_FULFILMENT_LEDGER_TABLE_NAMES].includes(table),
);
const ALLOWED_STORE_MIGRATIONS = [STORE_CATALOG_MIGRATION, STORE_ORDER_LEDGER_MIGRATION, STORE_FULFILMENT_LEDGER_MIGRATION];

const FORBIDDEN_PROVIDER_DEPENDENCIES = [
  /^openai$/i,
  /^ai$/i,
  /^@ai-sdk\//i,
  /^langchain$/i,
  /^@langchain\//i,
  /^anthropic$/i,
  /^@anthropic-ai\//i,
];

const FORBIDDEN_RUNTIME_STORE_PATTERNS = [
  /\bDZN_STORE_ENABLED\b/,
  /\bDZN_STORE_CHECKOUT_ENABLED\b/,
  /\bDZN_STORE_SANDBOX_CHECKOUT_ENABLED\b/,
  /\bDZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED\b/,
  /\bDZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED\b/,
  /\bDZN_STORE_WEBHOOK_FULFILMENT_ENABLED\b/,
  /\bDZN_SUPPORTER_CARDS_ENABLED\b/,
  /\bDZN_EARNED_SPINS_ENABLED\b/,
  /\bDZN_REWARD_WHEEL_ENABLED\b/,
  /\bDZN_STORE_ADMIN_ENABLED\b/,
  /\bDZN_STORE_LIVE_CHECKOUT_ENABLED\b/,
  /\bNEXT_PUBLIC_DZN_STORE_ENABLED\b/,
  /\bstore_products\b/i,
  /\bstore_prices\b/i,
  /\bstore_orders\b/i,
  /\bstore_order_items\b/i,
  /\bstore_payment_events\b/i,
  /\baccount_entitlements\b/i,
  /\bsupporter_cards\b/i,
  /\bearned_spins\b/i,
  /\bspin_ledger\b/i,
  /\bwheel_cooldowns\b/i,
  /\bDZN-SUP-\b/i,
  /\bcheckout\.sessions\.create\b/i,
  /\/checkout\/sessions/i,
  /\bpayment_intent\.succeeded\b/i,
  /\bcharge\.refunded\b/i,
  /\bcharge\.dispute/i,
  /\bmode\s*[:=]\s*["']payment["']/i,
];

main();

function main() {
  assertFilesExist();
  assertPreflightDoc();
  assertIntegratedDocs();
  assertExistingStripeSafetyContracts();
  assertNoRuntimePaths();
  assertOnlyApprovedStoreMigrations();
  assertNoRuntimeEnvOrConfigFlags();
  assertNoStoreRuntimePatternsBeyondCatalogDraft();
  assertReadOnlyStorePreviewOnly();
  assertNoNewProviderDependencies();
  assertPackageScript();
  console.log("DZN Safe Monetisation and Supporter System implementation preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    STRIPE_HELPER,
    PLANS_HELPER,
    STRIPE_WEBHOOK,
    CHECKOUT_ROUTE,
    PACKAGE_JSON,
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
    STORE_ACCOUNT_PURCHASES_PAGE,
    STORE_ACCOUNT_PURCHASES_COMPONENT,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightDoc() {
  const preflight = read(PREFLIGHT);
  for (const snippet of PREFLIGHT_SNIPPETS) {
    assert.equal(preflight.includes(snippet), true, `Preflight must include: ${snippet}`);
  }

  for (const phrase of [
    "XP.",
    "Earned progression awards.",
    "Ranking, leaderboard, discovery, or review score.",
    "Better wheel reward odds.",
    "Additional spins.",
    "Tournament, bracket, event, CTF, or Server Wars advantage.",
    "Badge, season, crown, or competitive eligibility.",
    "Server ownership or owner subscription entitlement.",
  ]) {
    assert.equal(preflight.includes(phrase), true, `Preflight must explicitly block paid influence on ${phrase}`);
  }
}

function assertIntegratedDocs() {
  for (const [path, snippets] of Object.entries(INTEGRATION_SNIPPETS)) {
    const source = read(path);
    for (const snippet of snippets) {
      assert.equal(source.includes(snippet), true, `${path} must include: ${snippet}`);
    }
  }
}

function assertExistingStripeSafetyContracts() {
  const helper = read(STRIPE_HELPER);
  assert.equal(helper.includes("export async function verifyStripeWebhook"), true, "Existing Stripe helper must keep webhook verification.");
  assert.equal(helper.includes('request.headers.get("stripe-signature")'), true, "Webhook verifier must read the Stripe-Signature header.");
  assert.equal(helper.includes("await request.text()"), true, "Webhook verifier must use the raw request body.");
  assert.equal(helper.includes("timingSafeEqual"), true, "Webhook verifier must keep timing-safe comparison.");

  const subscriptionWebhook = read(STRIPE_WEBHOOK);
  assert.equal(subscriptionWebhook.includes("checkout.session.completed"), true, "Existing subscription webhook should still handle subscription checkout completion.");
  assert.equal(subscriptionWebhook.includes("customer.subscription.updated"), true, "Existing subscription webhook should still handle subscription updates.");
  for (const table of FORBIDDEN_TABLE_NAMES) {
    assert.equal(subscriptionWebhook.includes(table), false, `Subscription webhook must not start writing future store table ${table} in this preflight.`);
  }

  const checkoutRoute = read(CHECKOUT_ROUTE);
  assert.equal(checkoutRoute.includes('mode: "subscription"'), true, "Existing owner checkout route must stay subscription mode.");
  assert.equal(checkoutRoute.includes("getCheckoutSafetyStatus"), true, "Existing owner checkout route must keep the canonical checkout safety gate.");
  assert.equal(checkoutRoute.includes('mode: "payment"'), false, "This preflight must not add one-time payment mode to the owner checkout route.");

  const plansHelper = read(PLANS_HELPER);
  assert.equal(plansHelper.includes("DZN_LIVE_CHECKOUT_ENABLED"), true, "Canonical billing helper must keep the live checkout flag.");
  assert.equal(plansHelper.includes("checkoutSessionCreationAllowed"), true, "Canonical billing helper must expose checkout safety state.");
}

function assertNoRuntimePaths() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by the implementation preflight.`);
  }
}

function assertOnlyApprovedStoreMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenNamedMigrations = migrationFiles.filter((path) =>
    !ALLOWED_STORE_MIGRATIONS.includes(path) &&
    /(?:store|supporter|wheel|monetisation|monetization|purchase|payment_event|account_entitlement|earned_spin|spin_ledger|wheel_cooldown)/i.test(path),
  );
  assert.deepEqual(forbiddenNamedMigrations, [], "Only the approved Store catalog, sandbox order ledger, and fulfilment ledger migrations may be present.");

  for (const path of migrationFiles.filter((path) => path.endsWith(".sql"))) {
    const source = read(path);
    const forbiddenTables = path === STORE_CATALOG_MIGRATION
      ? FORBIDDEN_NON_CATALOG_TABLE_NAMES
      : path === STORE_ORDER_LEDGER_MIGRATION
        ? FORBIDDEN_NON_LEDGER_TABLE_NAMES
        : path === STORE_FULFILMENT_LEDGER_MIGRATION
          ? FORBIDDEN_NON_FULFILMENT_LEDGER_TABLE_NAMES
        : FORBIDDEN_TABLE_NAMES;
    for (const table of forbiddenTables) {
      assert.equal(source.includes(table), false, `${path} must not create blocked future store table ${table}.`);
    }
  }
}

function assertNoRuntimeEnvOrConfigFlags() {
  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of FUTURE_STORE_FLAGS) {
      assert.equal(source.includes(flag), false, `${path} must not declare future Store flag ${flag} in this preflight.`);
    }
  }
}

function assertNoStoreRuntimePatternsBeyondCatalogDraft() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  const allowExistingSubscriptionFiles = new Set([STRIPE_HELPER, STRIPE_WEBHOOK, CHECKOUT_ROUTE].map((path) => path.replace(/\\/g, "/")));
  const allowCatalogDraftFile = STORE_CATALOG_HELPER.replace(/\\/g, "/");
  const allowStorePreviewFiles = new Set([STORE_PREVIEW_PAGE, STORE_PREVIEW_COMPONENT].map((path) => path.replace(/\\/g, "/")));
  const allowStoreOrderFiles = new Set([STORE_ORDER_ROUTE, STORE_ORDER_HELPER].map((path) => path.replace(/\\/g, "/")));
  const allowStoreCheckoutSessionFiles = new Set([STORE_CHECKOUT_SESSION_ROUTE, STORE_CHECKOUT_SESSION_HELPER].map((path) => path.replace(/\\/g, "/")));
  const allowStoreWebhookReceiptFiles = new Set([STORE_WEBHOOK_ROUTE, STORE_WEBHOOK_HELPER].map((path) => path.replace(/\\/g, "/")));
  const allowStoreFulfilmentRuntimeFiles = new Set([STORE_FULFILMENT_HELPER].map((path) => path.replace(/\\/g, "/")));
  const allowStoreAccountPurchasesReadModelFiles = new Set([
    "functions/api/account/purchases.ts",
    "functions/_lib/dzn-store-account-purchases.ts",
  ].map((path) => path.replace(/\\/g, "/")));
  const allowStoreAccountPurchasesUiFiles = new Set([
    STORE_ACCOUNT_PURCHASES_PAGE,
    STORE_ACCOUNT_PURCHASES_COMPONENT,
  ].map((path) => path.replace(/\\/g, "/")));
  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (allowExistingSubscriptionFiles.has(path)) continue;
    const source = read(path);
    if (allowStoreAccountPurchasesUiFiles.has(path)) {
      assert.equal(
        source.includes("<DznStoreAccountPurchasesPage />") || source.includes('const ACCOUNT_PURCHASES_ENDPOINT = "/api/account/purchases";'),
        true,
        `${path} must be part of the approved Account Purchases UI shell slice.`,
      );
      assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, `${path} must not contain Store write/runtime statements.`);
      assert.doesNotMatch(source, /\b(?:checkout\.sessions\.create|stripeFormRequest|stripeGetRequest|\/checkout\/sessions|wrangler)\b/i, `${path} must not create checkout sessions or mutate providers.`);
      assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|sendBeacon|gtag|analytics|trackEvent)\b/i, `${path} must not store share/account history or call analytics.`);
      assert.doesNotMatch(source, /\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i, `${path} must not issue mutating API requests.`);
      continue;
    }
    if (allowStoreAccountPurchasesReadModelFiles.has(path)) {
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
    if (allowStoreFulfilmentRuntimeFiles.has(path)) {
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
    if (allowStoreOrderFiles.has(path)) {
      assert.equal(source.includes("checkout_session_creation_requires_future_approval") || path === STORE_ORDER_ROUTE, true, `${path} must keep checkout creation future-only.`);
      assert.equal(source.includes("INSERT INTO store_orders"), path === STORE_ORDER_HELPER, `${path} must keep order inserts isolated to the Store order helper.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), path === STORE_ORDER_HELPER, `${path} must keep order-item inserts isolated to the Store order helper.`);
      for (const forbidden of [
        /\bstore_payment_events\b/i,
        /\baccount_entitlements\b/i,
        /\bsupporter_cards\b/i,
        /\bearned_spins\b/i,
        /\bspin_ledger\b/i,
        /\bwheel_cooldowns\b/i,
        /\bcheckout\.sessions\.create\b/i,
        /\/checkout\/sessions/i,
        /\bpayment_intent\.succeeded\b/i,
        /\bcharge\.refunded\b/i,
        /\bcharge\.dispute/i,
        /\bmode\s*[:=]\s*["']payment["']/i,
        /\bSTRIPE_SECRET_KEY\b/i,
        /\bSTRIPE_WEBHOOK_SECRET\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store payment/fulfilment/runtime pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowStoreCheckoutSessionFiles.has(path)) {
      assert.equal(
        source.includes("createDznStoreSandboxCheckoutSession") || source.includes("DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED"),
        true,
        `${path} must be part of the approved sandbox Checkout Session slice.`,
      );
      assert.equal(source.includes("INSERT INTO store_orders"), false, `${path} must not insert Store orders.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), false, `${path} must not insert Store order items.`);
      assert.equal(source.includes("INSERT INTO store_payment_events"), false, `${path} must not insert Store payment events.`);
      assert.equal(source.includes("UPDATE store_orders"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep checkout state updates isolated to the Store checkout helper.`);
      assert.equal(source.includes("/checkout/sessions"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep Stripe Checkout API calls isolated to the Store checkout helper.`);
      for (const forbidden of [
        /\bcheckout\.sessions\.create\b/i,
        /\bpayment_intent\.succeeded\b/i,
        /\bcharge\.refunded\b/i,
        /\bcharge\.dispute/i,
        /\bstore_payment_events\b/i,
        /\baccount_entitlements\b/i,
        /\bsupporter_cards\b/i,
        /\bearned_spins\b/i,
        /\bspin_ledger\b/i,
        /\bwheel_cooldowns\b/i,
        /\bDZN-SUP-\b/i,
        /\bSTRIPE_WEBHOOK_SECRET\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store fulfilment/supporter/wheel pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowStoreWebhookReceiptFiles.has(path)) {
      assert.equal(
        source.includes("receiveDznStoreSandboxWebhookReceipt") || source.includes("DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED"),
        true,
        `${path} must be part of the approved sandbox webhook receipt slice.`,
      );
      assert.equal(source.includes("INSERT INTO store_payment_events"), path === STORE_WEBHOOK_HELPER, `${path} must keep payment-event inserts isolated to the Store webhook helper.`);
      assert.equal(source.includes("UPDATE store_orders"), false, `${path} must not update Store orders.`);
      assert.equal(source.includes("INSERT INTO store_orders"), false, `${path} must not insert Store orders.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), false, `${path} must not insert Store order items.`);
      assert.equal(source.includes("/checkout/sessions"), false, `${path} must not create Checkout Sessions.`);
      for (const forbidden of [
        /\bcheckout\.sessions\.create\b/i,
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
        /\bDZN-SUP-\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store fulfilment/supporter/wheel pattern ${forbidden}.`);
      }
      continue;
    }
    const allowedPatternSources = path === allowCatalogDraftFile
      ? [
        "\\bDZN_STORE_ENABLED\\b",
        "\\bDZN_STORE_CHECKOUT_ENABLED\\b",
        "\\bDZN_STORE_SANDBOX_CHECKOUT_ENABLED\\b",
        "\\bDZN_STORE_WEBHOOK_FULFILMENT_ENABLED\\b",
        "\\bDZN_SUPPORTER_CARDS_ENABLED\\b",
        "\\bDZN_EARNED_SPINS_ENABLED\\b",
        "\\bDZN_REWARD_WHEEL_ENABLED\\b",
        "\\bDZN_STORE_ADMIN_ENABLED\\b",
        "\\bDZN_STORE_LIVE_CHECKOUT_ENABLED\\b",
        "\\bNEXT_PUBLIC_DZN_STORE_ENABLED\\b",
        "\\bstore_products\\b",
        "\\bstore_prices\\b",
        "\\bDZN-SUP-\\b",
      ]
      : [];
    const patterns = allowStorePreviewFiles.has(path)
      ? FORBIDDEN_RUNTIME_STORE_PATTERNS.filter((pattern) => pattern.source !== "\\bDZN-SUP-\\b")
      : FORBIDDEN_RUNTIME_STORE_PATTERNS.filter((pattern) => !allowedPatternSources.includes(pattern.source));
    for (const pattern of patterns) {
      assert.doesNotMatch(source, pattern, `${path} must not contain Store/Supporter/Wheel runtime pattern ${pattern}.`);
    }
  }
}

function assertReadOnlyStorePreviewOnly() {
  assert.equal(existsSync(STORE_PREVIEW_PAGE), true, "The public Store preview page should exist.");
  assert.equal(existsSync(STORE_PREVIEW_COMPONENT), true, "The public Store preview component should exist.");
  assert.equal(existsSync(STORE_ACCOUNT_PURCHASES_PAGE), true, "The approved private Account Purchases UI shell page should exist.");
  assert.equal(existsSync(STORE_ACCOUNT_PURCHASES_COMPONENT), true, "The approved private Account Purchases UI shell component should exist.");

  const page = read(STORE_PREVIEW_PAGE);
  assert.equal(page.includes("<DznStorePreviewPage />"), true, "Store route should render the preview component only.");

  const component = read(STORE_PREVIEW_COMPONENT);
  assert.equal(component.includes('"use client"'), false, "Store preview must not add client-side payment runtime.");
  assert.equal(component.includes('data-dzn-store-preview="read-only"'), true, "Store preview must identify itself as read-only.");
  assert.equal(component.includes('data-dzn-store-checkout="disabled"'), true, "Store preview must identify checkout as disabled.");
  assert.equal(component.includes("Checkout disabled"), true, "Store preview must visibly block checkout.");
  assert.equal(component.includes("/api/"), false, "Store preview must not call Store or billing APIs.");
  assert.equal(component.includes("fetch("), false, "Store preview must not fetch runtime Store data.");
  assert.equal(component.includes("createCheckoutSession"), false, "Store preview must not create checkout sessions.");
  assert.equal(component.includes("checkout.sessions.create"), false, "Store preview must not include Stripe checkout runtime.");

  const accountPage = read(STORE_ACCOUNT_PURCHASES_PAGE);
  assert.equal(accountPage.includes("<DznStoreAccountPurchasesPage />"), true, "Account Purchases page should render the UI shell component only.");

  const accountComponent = read(STORE_ACCOUNT_PURCHASES_COMPONENT);
  assert.equal(accountComponent.includes('const ACCOUNT_PURCHASES_ENDPOINT = "/api/account/purchases";'), true, "Account Purchases UI must consume only the private read-model endpoint.");
  assert.equal(accountComponent.includes('cache: "no-store"'), true, "Account Purchases UI must request uncached private account data.");
  assert.equal(accountComponent.includes('credentials: "include"'), true, "Account Purchases UI must include the authenticated session.");
  assert.equal(accountComponent.includes('data-dzn-store-account-purchases-ui="read-only"'), true, "Account Purchases UI must identify itself as read-only.");
  assert.equal(accountComponent.includes('data-supporter-card-reveal="blocked"'), true, "Account Purchases UI must keep Supporter Card reveal blocked.");
  assert.equal(accountComponent.includes('data-live-checkout="disabled"'), true, "Account Purchases UI must identify live checkout as disabled.");
  assert.equal(accountComponent.includes('data-production-mutation="none"'), true, "Account Purchases UI must identify production mutation as absent.");
  assert.equal(accountComponent.includes("checkout.sessions.create"), false, "Account Purchases UI must not include Stripe checkout runtime.");
}

function assertNoNewProviderDependencies() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  });
  const forbidden = dependencyNames.filter((name) => FORBIDDEN_PROVIDER_DEPENDENCIES.some((pattern) => pattern.test(name)));
  assert.deepEqual(forbidden, [], "Preflight must not add AI provider dependencies.");
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-safe-monetisation-supporter-preflight"],
    "tsx scripts/test-dzn-safe-monetisation-supporter-preflight.ts",
    "Focused Safe Monetisation preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-safe-monetisation-supporter-preflight"),
    true,
    "Full npm test should include the Safe Monetisation preflight guard.",
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
