import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  canValidateDznStoreDrafts,
  DZN_FOUNDING_SUPPORTER_DRAFT_PRODUCT,
  DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
  DZN_STORE_CATALOG_FEATURE_FLAGS,
  DZN_STORE_CATALOG_SCHEMA_VERSION,
  DZN_STORE_CATALOG_TABLES,
  DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS,
  readDznStoreCatalogFlags,
  validateDznStorePriceDraft,
  validateDznStoreProductDraft,
} from "../functions/_lib/dzn-store-catalog";

const MIGRATION = "migrations/0071_dzn_store_catalog_admin_draft.sql";
const HELPER = "functions/_lib/dzn-store-catalog.ts";
const PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_CATALOG_ADMIN_DRAFT_HANDOFF.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const PACKAGE_JSON = "package.json";
const STORE_PAGE = "app/store/page.tsx";
const STORE_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const DZN_STORE_BLOCKED_RUNTIME_TABLES = [
  "store_orders",
  "store_order_items",
  "store_payment_events",
  "account_entitlements",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
];

main();

function main() {
  assertFilesExist();
  assertMigrationIsCatalogOnly();
  assertFlagsAreDefaultDisabledAndAdminOnly();
  assertProductValidation();
  assertPriceValidation();
  assertNoCheckoutWebhookOrFulfilmentRuntime();
  assertNoRuntimeRoutesOrUi();
  assertDocsAndBacklog();
  assertPackageScript();
  console.log("DZN Store catalog and admin product/price draft model tests passed.");
}

function assertFilesExist() {
  for (const path of [MIGRATION, HELPER, PREFLIGHT, HANDOFF, BACKLOG, MASTER_SPEC, PUBLIC_ACCESS_POLICY, BILLING_PLANS, PACKAGE_JSON]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertMigrationIsCatalogOnly() {
  const migration = read(MIGRATION);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_products/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_prices/i);
  assert.match(migration, /DEFAULT 'draft'/i);
  assert.match(migration, /active INTEGER NOT NULL DEFAULT 0 CHECK\(active IN \(0, 1\)\)/i);
  assert.match(migration, /account_bound INTEGER NOT NULL DEFAULT 1 CHECK\(account_bound = 1\)/i);
  assert.match(migration, /guaranteed_purchase INTEGER NOT NULL DEFAULT 1 CHECK\(guaranteed_purchase = 1\)/i);
  assert.match(migration, /no_competitive_advantage INTEGER NOT NULL DEFAULT 1 CHECK\(no_competitive_advantage = 1\)/i);
  assert.match(migration, /grants_spins INTEGER NOT NULL DEFAULT 0 CHECK\(grants_spins = 0\)/i);
  assert.match(migration, /grants_xp INTEGER NOT NULL DEFAULT 0 CHECK\(grants_xp = 0\)/i);
  assert.match(migration, /grants_owner_subscription_access INTEGER NOT NULL DEFAULT 0 CHECK\(grants_owner_subscription_access = 0\)/i);
  assert.match(migration, /grants_competitive_eligibility INTEGER NOT NULL DEFAULT 0 CHECK\(grants_competitive_eligibility = 0\)/i);
  assert.match(migration, /currency TEXT NOT NULL DEFAULT 'gbp'/i);
  assert.match(migration, /unit_amount_minor INTEGER NOT NULL CHECK\(unit_amount_minor > 0\)/i);
  assert.match(migration, /min_amount_minor INTEGER CHECK\(min_amount_minor IS NULL\)/i);
  assert.match(migration, /allow_pay_what_you_want INTEGER NOT NULL DEFAULT 0 CHECK\(allow_pay_what_you_want = 0\)/i);
  assert.match(migration, /stripe_price_id TEXT UNIQUE CHECK\(stripe_price_id IS NULL\)/i);

  for (const table of DZN_STORE_CATALOG_TABLES) {
    assert.equal(migration.includes(table), true, `Migration should include the catalog table ${table}.`);
  }
  for (const table of DZN_STORE_BLOCKED_RUNTIME_TABLES) {
    assert.equal(migration.includes(table), false, `Migration must not add blocked runtime table ${table}.`);
  }

  for (const forbidden of [
    /CREATE TABLE IF NOT EXISTS store_orders/i,
    /CREATE TABLE IF NOT EXISTS store_payment_events/i,
    /CREATE TABLE IF NOT EXISTS account_entitlements/i,
    /CREATE TABLE IF NOT EXISTS supporter_cards/i,
    /CREATE TABLE IF NOT EXISTS earned_spins/i,
    /CREATE TABLE IF NOT EXISTS spin_ledger/i,
    /CREATE TABLE IF NOT EXISTS wheel_cooldowns/i,
    /FOREIGN KEY\(product_id\) REFERENCES owner_plan_entitlements/i,
    /server_owners/i,
    /server_rank/i,
    /discovery_score/i,
    /player_xp/i,
    /badge_awards/i,
    /season/i,
    /ctf_tournament/i,
    /server_wars_score/i,
  ]) {
    assert.doesNotMatch(migration, forbidden, `Catalog migration must not include blocked runtime or competitive coupling ${forbidden}.`);
  }
}

function assertFlagsAreDefaultDisabledAndAdminOnly() {
  assert.equal(DZN_STORE_CATALOG_SCHEMA_VERSION, "2026-08-26.store-catalog-draft-v1");
  assert.equal(DZN_FOUNDING_SUPPORTER_PRODUCT_KEY, "dzn-founding-supporter-pack");
  assert.deepEqual(DZN_FOUNDING_SUPPORTER_DRAFT_PRODUCT, {
    productKey: "dzn-founding-supporter-pack",
    name: "DZN FOUNDING SUPPORTER PACK",
    productType: "supporter_pack",
    fulfilmentKind: "supporter_card",
  });

  const defaults = readDznStoreCatalogFlags({});
  assert.deepEqual(defaults, {
    storeEnabled: false,
    checkoutEnabled: false,
    sandboxCheckoutEnabled: false,
    webhookFulfilmentEnabled: false,
    supporterCardsEnabled: false,
    earnedSpinsEnabled: false,
    rewardWheelEnabled: false,
    adminEnabled: false,
    liveCheckoutEnabled: false,
    publicStoreEnabled: false,
  });

  assert.equal(canValidateDznStoreDrafts({}, true), false, "Admin validation must be disabled by default.");
  assert.equal(canValidateDznStoreDrafts({
    DZN_STORE_ENABLED: "true",
    DZN_STORE_ADMIN_ENABLED: "true",
  }, false), false, "Enabled draft validation still requires an admin-authenticated caller.");
  assert.equal(canValidateDznStoreDrafts({
    DZN_STORE_ENABLED: "true",
    DZN_STORE_ADMIN_ENABLED: "true",
  }, true), true, "Only enabled flags plus admin auth may validate drafts.");

  assert.equal(Object.values(DZN_STORE_CATALOG_FEATURE_FLAGS).includes("DZN_STORE_LIVE_CHECKOUT_ENABLED"), true);
}

function assertProductValidation() {
  const valid = validateDznStoreProductDraft({
    productKey: DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
    name: "DZN FOUNDING SUPPORTER PACK",
    description: "Guaranteed account-bound supporter cosmetics only. No competitive advantage.",
    productType: "supporter_pack",
    fulfilmentKind: "supporter_card",
    metadataJson: JSON.stringify({
      labels: ["Guaranteed purchase", "Account-bound", "No competitive advantage"],
      included: ["Supporter Card preview", "Supporter profile badge", "Supporter profile frame"],
    }),
  });
  assert.equal(valid.ok, true, "Founding Supporter catalog draft should validate.");
  if (valid.ok) {
    assert.equal(valid.value.active, false);
    assert.equal(valid.value.accountBound, true);
    assert.equal(valid.value.guaranteedPurchase, true);
    assert.equal(valid.value.noCompetitiveAdvantage, true);
    assert.equal(valid.value.status, "draft");
  }

  for (const field of DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS) {
    const invalid = validateDznStoreProductDraft({
      productKey: `bad-${field.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: `Bad ${field}`,
      description: "A deliberately invalid paid benefit.",
      productType: "supporter_pack",
      fulfilmentKind: "supporter_card",
      [field]: true,
    });
    assert.equal(invalid.ok, false, `${field} must be rejected when true.`);
    assert.equal(invalid.errors.some((entry) => entry.code === "FORBIDDEN_PAID_OUTCOME"), true, `${field} should return the paid-outcome error.`);
  }

  const paidSpinCopy = validateDznStoreProductDraft({
    productKey: "buy-extra-spins",
    name: "Extra Spins",
    description: "Purchase this bundle to unlock three extra spins and better reward odds.",
    productType: "chat_cosmetic_pack",
    fulfilmentKind: "chat_badge",
  });
  assert.equal(paidSpinCopy.ok, false, "Paid spin copy must be rejected.");
  assert.equal(paidSpinCopy.errors.some((entry) => entry.code === "FORBIDDEN_PAID_BENEFIT"), true);

  const rankingCopy = validateDznStoreProductDraft({
    productKey: "rank-boost",
    name: "Rank Boost",
    description: "Boost ranking, discovery score, and review score for your profile.",
    productType: "profile_theme",
    fulfilmentKind: "theme_pack",
  });
  assert.equal(rankingCopy.ok, false, "Ranking/discovery/review boosts must be rejected.");

  const ownerAccessCopy = validateDznStoreProductDraft({
    productKey: "owner-setup-unlock",
    name: "Owner Setup Unlock",
    description: "Unlock owner setup, Nitrado linking, and server management access.",
    productType: "supporter_pack",
    fulfilmentKind: "supporter_card",
  });
  assert.equal(ownerAccessCopy.ok, false, "Store products must not unlock owner setup or Nitrado.");

  const activeDraft = validateDznStoreProductDraft({
    productKey: "profile-theme-neon",
    name: "Profile Theme Neon",
    description: "Guaranteed account-bound cosmetic profile theme.",
    productType: "profile_theme",
    fulfilmentKind: "theme_pack",
    active: true,
  });
  assert.equal(activeDraft.ok, false, "Initial catalog draft validation must reject active products.");

  const approvedStatus = validateDznStoreProductDraft({
    productKey: "approved-too-soon",
    name: "Approved Too Soon",
    description: "Guaranteed account-bound cosmetic profile theme.",
    productType: "profile_theme",
    fulfilmentKind: "theme_pack",
    status: "approved",
  });
  assert.equal(approvedStatus.ok, false, "Initial catalog draft validation must reject non-draft product statuses.");

  const incompatible = validateDznStoreProductDraft({
    productKey: "event-theme-as-card",
    name: "Event Theme As Card",
    description: "Guaranteed account-bound event presentation cosmetic.",
    productType: "event_presentation_theme",
    fulfilmentKind: "supporter_card",
  });
  assert.equal(incompatible.ok, false, "Product type and fulfilment kind compatibility should be enforced.");
}

function assertPriceValidation() {
  const valid = validateDznStorePriceDraft({
    productId: "prod_founder_pack",
    currency: "GBP",
    unitAmountMinor: 1000,
  });
  assert.equal(valid.ok, true, "GBP inactive local price draft should validate.");
  if (valid.ok) {
    assert.equal(valid.value.currency, "gbp");
    assert.equal(valid.value.active, false);
    assert.equal(valid.value.allowPayWhatYouWant, false);
    assert.equal(valid.value.stripePriceId, null);
    assert.equal(valid.value.minAmountMinor, null);
  }

  const zero = validateDznStorePriceDraft({ productId: "prod_founder_pack", unitAmountMinor: 0 });
  assert.equal(zero.ok, false, "Store price drafts should be positive even though the schema is forward-compatible.");

  const active = validateDznStorePriceDraft({ productId: "prod_founder_pack", unitAmountMinor: 1000, active: true });
  assert.equal(active.ok, false, "Initial price drafts must remain inactive.");

  const approvedStatus = validateDznStorePriceDraft({ productId: "prod_founder_pack", unitAmountMinor: 1000, status: "approved" });
  assert.equal(approvedStatus.ok, false, "Initial price draft validation must reject non-draft statuses.");

  const pwyw = validateDznStorePriceDraft({
    productId: "prod_founder_pack",
    unitAmountMinor: 1000,
    allowPayWhatYouWant: true,
    minAmountMinor: 500,
  });
  assert.equal(pwyw.ok, false, "Pay-what-you-want must remain future-only.");

  const stripeBound = validateDznStorePriceDraft({
    productId: "prod_founder_pack",
    unitAmountMinor: 1000,
    stripePriceId: "price_live_should_not_bind",
  });
  assert.equal(stripeBound.ok, false, "Draft validation must not accept Stripe Price bindings in this slice.");
}

function assertNoCheckoutWebhookOrFulfilmentRuntime() {
  const helper = read(HELPER);
  for (const forbidden of [
    /checkout\.sessions\.create/i,
    /\/checkout\/sessions/i,
    /\bmode\s*[:=]\s*["']payment["']/i,
    /STRIPE_SECRET_KEY/i,
    /STRIPE_WEBHOOK_SECRET/i,
    /verifyStripeWebhook/i,
    /stripeFormRequest/i,
    /payment_intent/i,
    /charge\.refunded/i,
    /charge\.dispute/i,
    /INSERT\s+INTO\s+store_orders/i,
    /INSERT\s+INTO\s+store_payment_events/i,
    /INSERT\s+INTO\s+account_entitlements/i,
    /INSERT\s+INTO\s+supporter_cards/i,
    /INSERT\s+INTO\s+earned_spins/i,
    /INSERT\s+INTO\s+spin_ledger/i,
    /UPDATE\s+owner_plan_entitlements/i,
    /UPDATE\s+server_owners/i,
    /fetch\s*\(/i,
  ]) {
    assert.doesNotMatch(helper, forbidden, `Catalog helper must not include checkout/webhook/fulfilment runtime ${forbidden}.`);
  }

  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of Object.values(DZN_STORE_CATALOG_FEATURE_FLAGS)) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable Store flag ${flag} in this slice.`);
    }
  }
}

function assertNoRuntimeRoutesOrUi() {
  assert.equal(existsSync(STORE_ORDER_ROUTE), true, "The later order-route approval slice may add the Store order route.");
  assert.equal(existsSync(STORE_ORDER_HELPER), true, "The later order-route approval slice may add the Store order helper.");

  for (const path of [
    "functions/api/supporter",
    "functions/api/wheel",
    "functions/api/billing/create-store-checkout-session.ts",
    "functions/api/billing/create-one-time-checkout-session.ts",
    "app/purchases/page.tsx",
    "app/supporter/page.tsx",
    "app/wheel/page.tsx",
    "components/supporter",
    "components/wheel",
  ]) {
    assert.equal(existsSync(path), false, `${path} must remain unimplemented after the catalog and read-only preview slices.`);
  }

  assert.equal(existsSync(STORE_PAGE), true, "The only Store route allowed after this slice is the read-only preview page.");
  assert.equal(existsSync(STORE_COMPONENT), true, "The only Store component allowed after this slice is the read-only preview component.");

  const previewSources = [
    [STORE_PAGE, read(STORE_PAGE)],
    [STORE_COMPONENT, read(STORE_COMPONENT)],
  ] as const;
  for (const [path, source] of previewSources) {
    assert.equal(source.includes("checkout.sessions.create"), false, `${path} must not create checkout sessions.`);
    assert.equal(source.includes("createCheckoutSession"), false, `${path} must not call checkout helpers.`);
    assert.equal(source.includes("/api/store"), false, `${path} must not call Store APIs.`);
    assert.equal(source.includes("/api/billing"), false, `${path} must not call billing APIs.`);
    assert.equal(source.includes("fetch("), false, `${path} must not fetch Store runtime data.`);
    assert.equal(source.includes("STRIPE_SECRET_KEY"), false, `${path} must not read Stripe secrets.`);
    assert.equal(source.includes("verifyStripeWebhook"), false, `${path} must not verify or handle webhooks.`);
  }
}

function assertDocsAndBacklog() {
  const checks: Array<[string, string[]]> = [
    [HANDOFF, [
      "DZN Store Catalog And Admin Product/Price Draft Model Handoff",
      "store_products",
      "store_prices",
      "No checkout creation",
      "No webhook fulfilment",
      "No supporter card table or issuance",
      "No earned-spin ledger",
      "No live checkout",
      "Next should be the DZN Store public browse and Supporter Card preview contract",
      "DZN Store public browse and Supporter Card preview contract",
      "`app/store/page.tsx`",
      "`components/store/dzn-store-preview-page.tsx`",
    ]],
    [BACKLOG, [
      "DZN Store Catalog And Admin Product/Price Draft Model",
      "DZN Store Public Browse And Supporter Card Preview Contract",
      "The catalog slice adds only `store_products` and `store_prices`",
      "The public preview slice adds a disabled-by-default, read-only `/store` surface",
      "Product validation rejects any paid spin, XP, rank, discovery, review, event, Server Wars, CTF, owner setup, Nitrado, or competitive eligibility benefit.",
      "Checkout creation, payment webhook fulfilment, account entitlement writes, Supporter Card issuance, earned spins, wheel runtime, Stripe product/Price changes, Cloudflare secret changes, production D1 writes, live checkout, and issue #49 remain out of scope.",
    ]],
    [MASTER_SPEC, [
      "DZN Store Catalog And Admin Product/Price Draft Model Slice",
      "DZN Store Public Browse And Supporter Card Preview Contract Slice",
      "`migrations/0071_dzn_store_catalog_admin_draft.sql`",
      "`functions/_lib/dzn-store-catalog.ts`",
      "validation rejects active product/price drafts",
      "DZN Store public browse and Supporter Card preview contract",
      "`/store`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store catalog and admin product/price draft model slice may add only the inactive `store_products` and `store_prices` schema",
      "The catalog helper is local validation only",
      "The `/store` route is a public-safe, read-only DZN Store preview contract",
      "No account purchases, checkout, webhook fulfilment, account entitlement, supporter-card issuance, earned-spin, or wheel runtime route is introduced.",
    ]],
    [BILLING_PLANS, [
      "The DZN Store catalog and admin product/price draft model adds only inactive product/price metadata",
      "It does not create Stripe Products or Prices",
      "Draft validation keeps Stripe Price IDs unbound in this slice",
      "The read-only `/store` preview is not an owner subscription checkout path",
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
    packageJson.scripts?.["test:dzn-store-catalog-admin-draft"],
    "tsx scripts/test-dzn-store-catalog-admin-draft.ts",
    "Focused Store catalog draft test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-catalog-admin-draft"),
    true,
    "Full npm test should include the Store catalog draft guard.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-public-preview-contract"),
    true,
    "Full npm test should include the Store public preview contract guard.",
  );
}

function read(path: string) {
  return readFileSync(path, "utf8");
}
