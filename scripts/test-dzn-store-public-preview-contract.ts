import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
  DZN_STORE_PUBLIC_PREVIEW_BLOCKED_ACTIONS,
  DZN_STORE_PUBLIC_PREVIEW_PRODUCTS,
  readDznStorePublicPreviewContract,
} from "../functions/_lib/dzn-store-catalog";

const HELPER = "functions/_lib/dzn-store-catalog.ts";
const STORE_PAGE = "app/store/page.tsx";
const STORE_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const GLOBAL_CSS = "app/globals.css";
const HANDOFF = "docs/DZN_STORE_PUBLIC_PREVIEW_CONTRACT_HANDOFF.md";
const CATALOG_HANDOFF = "docs/DZN_STORE_CATALOG_ADMIN_DRAFT_HANDOFF.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const PACKAGE_JSON = "package.json";

const REQUIRED_PRODUCT_KEYS = [
  "dzn-founding-supporter-pack",
  "dzn-profile-theme-pack",
  "dzn-cosmetic-calling-card-pack",
  "dzn-chat-profile-cosmetic-pack",
  "dzn-group-banner-insignia-pack",
  "dzn-event-presentation-theme",
] as const;

const REQUIRED_BLOCKED_ACTIONS = [
  "create_checkout_session",
  "create_order",
  "record_payment_event",
  "grant_account_entitlement",
  "issue_supporter_card",
  "grant_earned_spin",
  "run_reward_wheel",
  "bind_stripe_price",
  "enable_live_checkout",
] as const;

const FORBIDDEN_STORE_RUNTIME_PATTERNS = [
  /\bcheckout\.sessions\.create\b/i,
  /\/checkout\/sessions/i,
  /\bcreateCheckoutSession\b/i,
  /\bstripeFormRequest\b/i,
  /\bverifyStripeWebhook\b/i,
  /\bSTRIPE_SECRET_KEY\b/i,
  /\bSTRIPE_WEBHOOK_SECRET\b/i,
  /\bpayment_intent\b/i,
  /\bcharge\.refunded\b/i,
  /\bcharge\.dispute/i,
  /\bmode\s*[:=]\s*["']payment["']/i,
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\banalytics\b/i,
  /\bgtag\b/i,
  /\bposthog\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+owner_plan_entitlements\b/i,
  /\bUPDATE\s+server_owners\b/i,
  /\bstore_orders\b/i,
  /\bstore_order_items\b/i,
  /\bstore_payment_events\b/i,
  /\baccount_entitlements\b/i,
  /\bsupporter_cards\b/i,
  /\bearned_spins\b/i,
  /\bspin_ledger\b/i,
  /\bwheel_cooldowns\b/i,
];

main();

function main() {
  assertFilesExist();
  assertPreviewContractDefaults();
  assertPreviewProducts();
  assertStoreRouteAndComponent();
  assertVisualTreatment();
  assertNoRuntimeRoutesOrBlockedFiles();
  assertDocsAndPackageScripts();
  console.log("DZN Store public browse and Supporter Card preview contract tests passed.");
}

function assertFilesExist() {
  for (const path of [
    HELPER,
    STORE_PAGE,
    STORE_COMPONENT,
    GLOBAL_CSS,
    HANDOFF,
    CATALOG_HANDOFF,
    BACKLOG,
    PREFLIGHT,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreviewContractDefaults() {
  const defaults = readDznStorePublicPreviewContract({});
  assert.equal(defaults.enabled, false, "Store public preview must be disabled by default.");
  assert.equal(defaults.state, "disabled_by_default");
  assert.equal(defaults.statusLabel, "Store preview disabled by default");
  assert.deepEqual(defaults.blockedRuntimeActions, [...REQUIRED_BLOCKED_ACTIONS]);

  const onlyPublic = readDznStorePublicPreviewContract({ NEXT_PUBLIC_DZN_STORE_ENABLED: "true" });
  assert.equal(onlyPublic.enabled, false, "Public flag alone must not enable the preview contract.");

  const onlyServer = readDznStorePublicPreviewContract({ DZN_STORE_ENABLED: "true" });
  assert.equal(onlyServer.enabled, false, "Server flag alone must not enable the preview contract.");

  const enabled = readDznStorePublicPreviewContract({
    DZN_STORE_ENABLED: "true",
    NEXT_PUBLIC_DZN_STORE_ENABLED: "true",
  });
  assert.equal(enabled.enabled, true, "Both Store flags are required to mark the read-only preview enabled.");
  assert.equal(enabled.state, "enabled_read_only_preview");
  assert.equal(enabled.products, DZN_STORE_PUBLIC_PREVIEW_PRODUCTS);
}

function assertPreviewProducts() {
  assert.deepEqual(DZN_STORE_PUBLIC_PREVIEW_PRODUCTS.map((product) => product.productKey), [...REQUIRED_PRODUCT_KEYS]);
  assert.deepEqual(DZN_STORE_PUBLIC_PREVIEW_BLOCKED_ACTIONS, [...REQUIRED_BLOCKED_ACTIONS]);

  for (const product of DZN_STORE_PUBLIC_PREVIEW_PRODUCTS) {
    assert.equal(product.catalogStatus, "preview_only", `${product.name} must stay preview-only.`);
    assert.equal(product.active, false, `${product.name} must not be active.`);
    assert.equal(product.checkoutAvailable, false, `${product.name} must not be checkoutable.`);
    assert.equal(product.accountBound, true, `${product.name} must be account-bound.`);
    assert.equal(product.guaranteedPurchase, true, `${product.name} must be guaranteed-purchase metadata.`);
    assert.equal(product.noCompetitiveAdvantage, true, `${product.name} must keep the Fair Progression Boundary.`);
    assert.ok(product.exactContents.length >= 3, `${product.name} should show exact contents before payment.`);
    assert.ok(product.safetyLabels.includes("Guaranteed purchase"), `${product.name} needs a guaranteed-purchase label.`);
    assert.ok(product.safetyLabels.includes("Account-bound"), `${product.name} needs an account-bound label.`);
    assert.ok(product.safetyLabels.some((label) => /No competitive advantage|No ranking impact|No XP impact|No event advantage|Presentation only/i.test(label)), `${product.name} needs a no-advantage or presentation-only label.`);

    const visibleCopy = [
      product.name,
      product.strapline,
      product.description,
      product.previewPriceLabel,
      ...product.exactContents,
      ...product.safetyLabels,
      ...product.previewNotes,
    ].join("\n");

    for (const forbidden of [
      /\bXP boost\b/i,
      /\brank boost\b/i,
      /\bbuy spins\b/i,
      /\badditional spins\b/i,
      /\bbetter reward odds\b/i,
      /\bowner setup access\b/i,
      /\bNitrado access\b/i,
      /\bServer Wars advantage\b/i,
      /\bCTF advantage\b/i,
      /\bcompetitive eligibility advantage\b/i,
      /\bdonation\b/i,
    ]) {
      assert.doesNotMatch(visibleCopy, forbidden, `${product.name} must not advertise forbidden paid benefits.`);
    }
  }

  const supporter = DZN_STORE_PUBLIC_PREVIEW_PRODUCTS.find((product) => product.productKey === DZN_FOUNDING_SUPPORTER_PRODUCT_KEY);
  assert.ok(supporter, "Founding Supporter preview product should exist.");
  assert.equal(supporter.name, "DZN FOUNDING SUPPORTER PACK");
  assert.equal(supporter.supporterCardPreview?.sampleSerial, "DZN-SUP-002481");
  assert.deepEqual(supporter.supporterCardPreview?.themeOptions, ["Signal Crown", "Ember Relay", "Survivor Static"]);
  assert.deepEqual(supporter.supporterCardPreview?.permanentFields, ["Serial number", "Display name", "Supporter Since", "Selected theme", "Generated insignia"]);
  assert.ok(supporter.exactContents.includes("Permanent Supporter profile badge with public hide control"));
  assert.ok(supporter.safetyLabels.includes("No buyable spins"));
}

function assertStoreRouteAndComponent() {
  const page = read(STORE_PAGE);
  assert.equal(page.includes('title: "DZN Store Preview"'), true, "Store route should expose preview metadata.");
  assert.equal(page.includes("<DznStorePreviewPage />"), true, "Store route should render only the preview page.");
  assertReadOnlySource(page, STORE_PAGE);

  const component = read(STORE_COMPONENT);
  assert.equal(component.includes('"use client"'), false, "Store preview must be server-rendered with no client runtime.");
  assert.equal(component.includes("readDznStorePublicPreviewContract()"), true, "Store preview should read the static preview contract.");
  assert.equal(component.includes('data-dzn-store-preview="read-only"'), true, "Store preview should declare read-only state.");
  assert.equal(component.includes('data-dzn-store-checkout="disabled"'), true, "Store preview should declare checkout disabled.");
  assert.equal(component.includes("Checkout disabled"), true, "Store preview must clearly show that checkout is disabled.");
  assert.equal(component.includes("Issue #49 and live checkout activation remain untouched."), true);
  assert.equal(component.includes("Guaranteed account-bound cosmetics, never competitive power."), true);
  assert.equal(component.includes("/pricing?intent=owner_setup&returnTo=%2Fsetup"), true, "Owner setup should still go through pricing.");
  assert.equal(component.includes("href=\"/player\""), true, "Player access should remain free and separate.");
  assertReadOnlySource(component, STORE_COMPONENT);
}

function assertVisualTreatment() {
  const component = read(STORE_COMPONENT);
  assert.equal(component.includes("/media/dzn-pricing-bg-layer.png"), true, "Store preview should use the DZN cinematic background layer.");
  assert.equal(component.includes("/media/dzn-pricing-fog-ember-overlay.png"), true, "Store preview should use the DZN fog overlay.");
  assert.equal(component.includes("dzn-store-bg-layer"), true, "Store preview should use the Store animated background class.");
  assert.equal(component.includes("dzn-store-fog-layer"), true, "Store preview should use the Store fog animation class.");

  const css = read(GLOBAL_CSS);
  for (const snippet of [
    ".dzn-store-page",
    ".dzn-store-bg-layer",
    ".dzn-store-fog-layer",
    "@keyframes dzn-store-bg-drift",
    "@keyframes dzn-store-fog-drift",
    "@media (prefers-reduced-motion: reduce)",
  ]) {
    assert.equal(css.includes(snippet), true, `Store visual CSS should include ${snippet}.`);
  }
}

function assertNoRuntimeRoutesOrBlockedFiles() {
  for (const path of [
    "functions/api/store",
    "functions/api/supporter",
    "functions/api/wheel",
    "functions/api/billing/create-store-checkout-session.ts",
    "functions/api/billing/create-one-time-checkout-session.ts",
    "functions/api/stripe/store-webhook.ts",
    "app/account/purchases/page.tsx",
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
  ]) {
    assert.equal(existsSync(path), false, `${path} must remain unimplemented in this preview contract slice.`);
  }
}

function assertDocsAndPackageScripts() {
  const checks: Array<[string, string[]]> = [
    [HANDOFF, [
      "DZN Store Public Browse And Supporter Card Preview Contract Handoff",
      "Read-only `/store` preview",
      "disabled by default",
      "No checkout sessions",
      "No orders",
      "No webhooks",
      "No entitlements",
      "No supporter cards are issued",
      "No earned spins",
      "No wheel runtime",
      "No Stripe object mutation",
      "No Cloudflare secret/config mutation",
      "No production D1 write",
      "No issue #49 change",
      "Next should be the DZN Store sandbox order and checkout approval preflight",
    ]],
    [CATALOG_HANDOFF, [
      "DZN Store public browse and Supporter Card preview contract",
      "`app/store/page.tsx`",
      "`components/store/dzn-store-preview-page.tsx`",
    ]],
    [BACKLOG, [
      "DZN Store Public Browse And Supporter Card Preview Contract",
      "The public preview slice adds a disabled-by-default, read-only `/store` surface",
      "Checkout creation, order creation, webhook fulfilment, account entitlement writes, Supporter Card issuance, earned spins, wheel runtime, Stripe product/Price changes, Cloudflare secret changes, production D1 writes, live checkout, and issue #49 remain out of scope.",
    ]],
    [PREFLIGHT, [
      "DZN Store public browse and Supporter Card preview contract: delivered as a read-only preview contract slice",
      "The next payment-facing step must be a DZN Store sandbox order and checkout approval preflight",
    ]],
    [MASTER_SPEC, [
      "DZN Store Public Browse And Supporter Card Preview Contract Slice",
      "`/store`",
      "`components/store/dzn-store-preview-page.tsx`",
      "No checkout sessions, orders, webhooks, entitlements, supporter-card issuance, earned spins, wheel runtime, Stripe object mutation, Cloudflare secret mutation, production D1 write, live checkout activation, or issue #49 change.",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The `/store` route is a public-safe, read-only DZN Store preview contract",
      "It is disabled by default through the Store preview contract state",
      "It may render safe catalog preview metadata only.",
    ]],
    [BILLING_PLANS, [
      "The read-only `/store` preview is not an owner subscription checkout path",
      "It does not create one-time Checkout Sessions, orders, entitlements, supporter cards, earned spins, wheel runtime, or live payment activation.",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assert.equal(source.includes(snippet), true, `${path} should include: ${snippet}`);
    }
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-public-preview-contract"],
    "tsx scripts/test-dzn-store-public-preview-contract.ts",
    "Focused Store public preview contract test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-public-preview-contract"),
    true,
    "Full npm test should include the Store public preview contract guard.",
  );
}

function assertReadOnlySource(source: string, path: string) {
  for (const forbidden of FORBIDDEN_STORE_RUNTIME_PATTERNS) {
    assert.doesNotMatch(source, forbidden, `${path} must not contain Store checkout/payment/runtime pattern ${forbidden}.`);
  }
}

function read(path: string) {
  assert.equal(existsSync(path), true, `${path} should exist.`);
  return readFileSync(path, "utf8");
}
