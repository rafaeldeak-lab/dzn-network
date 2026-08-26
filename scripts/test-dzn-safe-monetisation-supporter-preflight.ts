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
  "Next should be the DZN Store catalog and admin product/price draft model",
];

const INTEGRATION_SNIPPETS: Record<string, string[]> = {
  [BACKLOG]: [
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "Implementation Preflight",
    "safe production implementation sequence",
    "keeps `DZN_LIVE_CHECKOUT_ENABLED` unset/false",
    "The first future runtime step after the preflight should be the DZN Store catalog and admin product/price draft model",
  ],
  [MASTER_SPEC]: [
    "DZN Safe Monetisation And Supporter System Implementation Preflight Slice",
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "One-time Stripe Checkout using `mode=payment` only after checkout flags are enabled.",
    "delivered as a documentation/test-guard slice",
    "DZN Store catalog and admin product/price draft model: next safe implementation slice",
  ],
  [PUBLIC_ACCESS_POLICY]: [
    "The DZN Safe Monetisation And Supporter System Implementation Preflight Slice may define the real production store/catalog/order/payment/spin-ledger/supporter-card implementation sequence",
    "one-time Checkout `mode=payment` boundary",
    "It must not implement `/store`, `/account/purchases`, reward wheel, store checkout, store webhook fulfilment",
    "Future store purchases are player/account cosmetics only",
    "The next safe implementation step should be the DZN Store catalog and admin product/price draft model",
  ],
  [BILLING_PLANS]: [
    "Future Store And Supporter Purchases",
    "`docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md`",
    "Future one-time Store purchases are separate from Starter/Pro owner subscriptions.",
    "Players must never be able to buy wheel spins.",
    "This preflight does not add checkout, products, Prices, webhook fulfilment",
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
  "functions/api/store",
  "functions/api/supporter",
  "functions/api/wheel",
  "functions/api/billing/create-store-checkout-session.ts",
  "functions/api/billing/create-one-time-checkout-session.ts",
  "functions/api/stripe/store-webhook.ts",
  "functions/api/stripe/store",
  "app/store/page.tsx",
  "app/account/purchases/page.tsx",
  "app/purchases/page.tsx",
  "app/supporter/page.tsx",
  "app/wheel/page.tsx",
  "components/store",
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
  assertNoStoreMigrations();
  assertNoRuntimeEnvOrConfigFlags();
  assertNoStoreRuntimePatterns();
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

function assertNoStoreMigrations() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenNamedMigrations = migrationFiles.filter((path) =>
    /(?:store|supporter|wheel|monetisation|monetization|purchase|payment_event|account_entitlement|earned_spin|spin_ledger|wheel_cooldown)/i.test(path),
  );
  assert.deepEqual(forbiddenNamedMigrations, [], "Implementation preflight must not add store/supporter/wheel migration files.");

  for (const path of migrationFiles.filter((path) => path.endsWith(".sql"))) {
    const source = read(path);
    for (const table of FORBIDDEN_TABLE_NAMES) {
      assert.equal(source.includes(table), false, `${path} must not create future store table ${table} in this preflight.`);
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

function assertNoStoreRuntimePatterns() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  const allowExistingSubscriptionFiles = new Set([STRIPE_HELPER, STRIPE_WEBHOOK, CHECKOUT_ROUTE].map((path) => path.replace(/\\/g, "/")));
  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (allowExistingSubscriptionFiles.has(path)) continue;
    const source = read(path);
    for (const pattern of FORBIDDEN_RUNTIME_STORE_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must not contain Store/Supporter/Wheel runtime pattern ${pattern}.`);
    }
  }
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
