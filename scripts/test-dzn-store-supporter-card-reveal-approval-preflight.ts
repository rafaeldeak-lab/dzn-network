import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT_HANDOFF.md";
const ACCOUNT_UI_DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md";
const ACCOUNT_UI_HANDOFF = "docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL_HANDOFF.md";
const ACCOUNT_READ_MODEL_DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md";
const ACCOUNT_READ_MODEL_HANDOFF = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION_HANDOFF.md";
const RECONCILIATION_PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md";
const RECONCILIATION_HANDOFF = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const ACCOUNT_PAGE = "app/account/purchases/page.tsx";
const ACCOUNT_COMPONENT = "components/store/dzn-store-account-purchases-page.tsx";
const ACCOUNT_READ_MODEL_ROUTE = "functions/api/account/purchases.ts";
const ACCOUNT_READ_MODEL_HELPER = "functions/_lib/dzn-store-account-purchases.ts";
const REVEAL_ROUTE = "functions/api/account/supporter-cards/[cardRef]/reveal.ts";
const REVEAL_HELPER = "functions/_lib/dzn-store-supporter-card-reveal.ts";
const REVEAL_DOC = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION.md";
const REVEAL_HANDOFF = "docs/DZN_STORE_SUPPORTER_CARD_REVEAL_IMPLEMENTATION_HANDOFF.md";
const REVEAL_TEST = "scripts/test-dzn-store-supporter-card-reveal-implementation.ts";
const FULFILMENT_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const PACKAGE_JSON = "package.json";

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const FORBIDDEN_REVEAL_RUNTIME_PATHS = [
  "functions/api/account/supporter-card-reveal.ts",
  "functions/api/store/supporter-card-reveal.ts",
  "functions/api/store/supporter-cards",
  "functions/api/public/supporter-cards",
  "functions/api/supporter-cards",
  "functions/api/supporter-card",
  "functions/api/account/purchases/supporter-card.ts",
  "app/account/supporter-card",
  "app/account/supporter-cards",
  "app/store/supporter-card",
  "app/supporter-card",
  "app/supporter-cards",
  "components/store/supporter-card-reveal.tsx",
  "components/store/dzn-supporter-card-reveal.tsx",
  "components/supporter",
  "components/supporter-card",
  "lib/supporter-card-art.ts",
] as const;

const FORBIDDEN_SOURCE_CONFIG_FLAGS = [
  "DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED",
  "DZN_SUPPORTER_CARD_PUBLIC_REVEAL_ENABLED",
  "DZN_SUPPORTER_CARD_ART_GENERATION_ENABLED",
  "DZN_SUPPORTER_CARD_SHARE_ENABLED",
  "DZN_SUPPORTER_CARD_EXPORT_ENABLED",
  "DZN_STORE_LIVE_CHECKOUT_ENABLED=true",
  "DZN_LIVE_CHECKOUT_ENABLED=true",
  "DZN_EARNED_SPINS_ENABLED=true",
  "DZN_REWARD_WHEEL_ENABLED=true",
] as const;

const FORBIDDEN_ACCOUNT_UI_PATTERNS = [
  /\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i,
  /\/api\/store\/supporter-card/i,
  /\/api\/public\/supporter-cards/i,
  /\/api\/stripe/i,
  /\/api\/billing/i,
  /\/api\/wheel/i,
  /\/api\/admin\/store/i,
  /\bcheckout\.sessions\.create\b/i,
  /\bstripeFormRequest\b/i,
  /\bstripeGetRequest\b/i,
  /\bnavigator\.share\b/i,
  /\bnavigator\.clipboard\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\banalytics\b/i,
  /\bgtag\b/i,
  /\bposthog\b/i,
  /\btrackEvent\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+/i,
  /\bDELETE\s+FROM\b/i,
  /\bwrangler\b/i,
] as const;

const FORBIDDEN_ACCOUNT_UI_RAW_FIELDS = [
  "DZN-SUP-",
  "generated_insignia_json",
  "insignia_seed_hash",
  "stripe_event_id",
  "stripe_checkout_session_id",
  "stripe_payment_intent_id",
  "stripe_customer",
  "payment_method",
  "billing_address",
  "discord_id",
  "user_id",
  "order_id",
  "order_item_id",
  "entitlement_id",
  "supporter_card_id",
  "raw_body",
  "provider_payload",
] as const;

main();

function main() {
  assertFilesExist();
  assertPreflightContract();
  assertHandoffContract();
  assertIntegratedDocs();
  assertRuntimeBoundary();
  assertAccountPurchasesStaysRevealBlocked();
  assertPackageScriptWired();
  console.log("DZN Store Supporter Card reveal approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    ACCOUNT_UI_DOC,
    ACCOUNT_UI_HANDOFF,
    ACCOUNT_READ_MODEL_DOC,
    ACCOUNT_READ_MODEL_HANDOFF,
    RECONCILIATION_PREFLIGHT,
    RECONCILIATION_HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    ACCOUNT_PAGE,
    ACCOUNT_COMPONENT,
    ACCOUNT_READ_MODEL_ROUTE,
    ACCOUNT_READ_MODEL_HELPER,
    REVEAL_ROUTE,
    REVEAL_HELPER,
    REVEAL_DOC,
    REVEAL_HANDOFF,
    REVEAL_TEST,
    FULFILMENT_MIGRATION,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightContract() {
  const doc = read(PREFLIGHT);
  for (const snippet of [
    "# DZN Store Supporter Card Reveal Approval Preflight",
    "This slice is approval preflight only.",
    "No card reveal route.",
    "No private Supporter Card reveal component.",
    "No public Supporter Card reveal.",
    "No card-art generation.",
    "No sharing controls.",
    "No screenshot/download/export action.",
    "No notification route or notification writes.",
    "No migration.",
    "No live checkout activation.",
    "No earned-spin ledger.",
    "No reward wheel runtime.",
    "No Stripe Product, Price, Customer, Checkout Session, refund, dispute, payment, webhook endpoint, or API mutation.",
    "No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.",
    "No issue #49 change.",
    "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
    "The personal player page/nav button remains a separate player UX slice",
    "private_reveal_available: false",
    "public_reveal_available: false",
    "reveal_blocked_reason: \"supporter_card_reveal_requires_future_approved_slice\"",
    "`serial_number`, `insignia_seed_hash`, and `generated_insignia_json`",
    "Proposed path: `GET /api/account/supporter-cards/[cardRef]/reveal`.",
    "`DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED=true`",
    "`DZN_STORE_SANDBOX_RUNTIME=local` or `DZN_STORE_SANDBOX_RUNTIME=test`",
    "display-safe `cardRef` or existing `purchase_ref`, never raw",
    "The formatted Supporter Card serial number.",
    "It must never return raw `generated_insignia_json`, `insignia_seed_hash`, payment identifiers, raw user ids, or Stripe metadata.",
    "`supporter_cards.user_id` equals the authenticated DZN user id.",
    "`account_entitlements.user_id` equals the authenticated DZN user id.",
    "`store_orders.purchasing_user_id` equals the authenticated DZN user id.",
    "Private reveal and public visibility are separate decisions.",
    "The first private reveal implementation must not add screenshot, download, export, print-to-image, share-link, copy-link, or public-share controls.",
    "This preflight adds no audit table and no reveal-view logging.",
    "If DZN later wants security audit rows for reveal views, that must be separately approved before implementation.",
    "Owner Starter/Pro plans must not force a Supporter Card public, hide it, reveal it, or use it as an owner entitlement.",
    "Store account entitlements and Supporter Cards remain account-bound cosmetic/supporter recognition only.",
    "The Store private Supporter Card reveal implementation is now delivered separately",
    "Next should be the Store private Supporter Card reveal visual polish and manual QA slice only if deliberately approved",
  ]) {
    assertIncludes(doc, snippet, `${PREFLIGHT} should contain: ${snippet}`);
  }

  for (const url of [
    "https://docs.stripe.com/webhooks/signature",
    "https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted",
    "https://docs.stripe.com/api/idempotent_requests",
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
    "review score",
    "badges",
    "seasons",
    "events",
    "CTF scoring",
    "Server Wars scoring",
    "XP awards",
    "calling-card awards",
    "public profile visibility",
    "retained exports",
    "moderation decisions",
    "earned spins",
    "reward wheel",
    "competitive eligibility",
  ]) {
    assertIncludes(doc, isolation, `${PREFLIGHT} must preserve isolation for ${isolation}.`);
  }
}

function assertHandoffContract() {
  const handoff = read(HANDOFF);
  for (const snippet of [
    "# DZN Store Supporter Card Reveal Approval Preflight Handoff",
    "Branch: `codex/dzn-store-supporter-card-reveal-preflight-20260831`",
    "Base: `c023a3fe2bb1fd0278b2f312e3e9bd409653d034`",
    "Stacked on: `codex/dzn-store-account-purchases-ui-shell-20260831`",
    "Protected OneDrive checkout was not modified.",
    "No card reveal route.",
    "No private Supporter Card reveal component.",
    "No public Supporter Card reveal.",
    "No card-art generation.",
    "No screenshot, download, export, copy-link, or sharing controls.",
    "No notification route or notification writes.",
    "No migration after `migrations/0073_dzn_store_fulfilment_ledger_schema.sql`.",
    "No live checkout activation.",
    "No earned-spin ledger.",
    "No reward wheel runtime.",
    "No issue #49 change.",
    "The Store private Supporter Card reveal implementation is now delivered separately",
    "`functions/api/account/supporter-cards/[cardRef]/reveal.ts`",
    "Next should be the Store private Supporter Card reveal visual polish and manual QA slice only if deliberately approved",
  ]) {
    assertIncludes(handoff, snippet, `${HANDOFF} should contain: ${snippet}`);
  }
}

function assertIntegratedDocs() {
  for (const [path, snippets] of [
    [ACCOUNT_UI_DOC, [
      "The Store private Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
      "The Store private Supporter Card reveal implementation is now delivered separately",
    ]],
    [ACCOUNT_UI_HANDOFF, [
      "The Store private Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [ACCOUNT_READ_MODEL_DOC, [
      "The Store private Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [ACCOUNT_READ_MODEL_HANDOFF, [
      "The Store private Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [RECONCILIATION_PREFLIGHT, [
      "The Store private Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [RECONCILIATION_HANDOFF, [
      "The Store private Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store Supporter Card reveal approval preflight is now delivered",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [BACKLOG, [
      "## DZN Store Supporter Card Reveal Approval Preflight",
      "Delivered in `docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`.",
    ]],
    [MASTER_SPEC, [
      "## DZN Store Supporter Card Reveal Approval Preflight Slice",
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store Supporter Card reveal approval preflight slice is documentation/test-guard work only.",
    ]],
    [BILLING_PLANS, [
      "The DZN Store Supporter Card reveal approval preflight defines the future private reveal boundary",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_SUPPORTER_CARD_REVEAL_APPROVAL_PREFLIGHT.md` defines the future private Supporter Card reveal boundary",
    ]],
  ] satisfies Array<[string, string[]]>) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should contain: ${snippet}`);
    }
  }
}

function assertRuntimeBoundary() {
  for (const path of FORBIDDEN_REVEAL_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not exist in this preflight slice.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  const storeMigrationFiles = migrationFiles.filter((path) => path.includes("_dzn_store_"));
  assert.equal(storeMigrationFiles.at(-1), FULFILMENT_MIGRATION, "This preflight must not add a Store migration after 0073.");

  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of FORBIDDEN_SOURCE_CONFIG_FLAGS) {
      assert.equal(source.includes(flag), false, `${path} must not configure ${flag}.`);
    }
  }
}

function assertAccountPurchasesStaysRevealBlocked() {
  const page = read(ACCOUNT_PAGE);
  assertIncludes(page, "<DznStoreAccountPurchasesPage />", `${ACCOUNT_PAGE} should remain the same private UI shell route.`);

  const component = read(ACCOUNT_COMPONENT);
  assertIncludes(component, 'data-supporter-card-reveal="private-local-test-guarded"', "Account Purchases UI must declare private reveal as guarded.");
  assertIncludes(component, 'data-public-supporter-card-reveal="blocked"', "Account Purchases UI must still declare public reveal blocked.");
  assertIncludes(component, "Reveal private card", "Account Purchases UI may expose only the approved private reveal action.");
  assertIncludes(component, "Private reveal disabled", "Account Purchases UI must visibly disable reveal when flags/status block it.");
  assertIncludes(component, 'const ACCOUNT_PURCHASES_ENDPOINT = "/api/account/purchases";', "Account Purchases UI must consume the existing read model.");
  assertIncludes(component, 'const SUPPORTER_CARD_REVEAL_ENDPOINT_PREFIX = "/api/account/supporter-cards";', "Account Purchases UI must use only the approved private reveal endpoint prefix.");
  assertIncludes(component, 'credentials: "include"', "Account Purchases UI must include session credentials.");
  assertIncludes(component, 'cache: "no-store"', "Account Purchases UI must request private no-store data.");
  assertIncludes(component, 'data-card-art-generation="blocked"', "Account Purchases UI must keep card-art generation blocked.");
  assertIncludes(component, 'data-sharing-controls="blocked"', "Account Purchases UI must keep sharing controls blocked.");
  assertIncludes(component, 'data-screenshot-export-controls="blocked"', "Account Purchases UI must keep screenshot/export controls blocked.");

  for (const pattern of FORBIDDEN_ACCOUNT_UI_PATTERNS) {
    assert.doesNotMatch(component, pattern, `${ACCOUNT_COMPONENT} must not add reveal/share/payment/runtime pattern ${pattern}.`);
    assert.doesNotMatch(page, pattern, `${ACCOUNT_PAGE} must not add reveal/share/payment/runtime pattern ${pattern}.`);
  }

  for (const field of FORBIDDEN_ACCOUNT_UI_RAW_FIELDS) {
    if (field === "DZN-SUP-") {
      assertIncludes(component, "DZN-SUP-******", `${ACCOUNT_COMPONENT} may show only the approved masked visual placeholder.`);
      assert.doesNotMatch(component, /DZN-SUP-\d{6}/, `${ACCOUNT_COMPONENT} must not bake in a real-looking Supporter Card serial.`);
      continue;
    }
    assert.equal(component.includes(field), false, `${ACCOUNT_COMPONENT} must not reference private card/payment field ${field}.`);
  }

  const helper = read(ACCOUNT_READ_MODEL_HELPER);
  for (const snippet of [
    "private_reveal_available: canRevealPrivately",
    "public_reveal_available: false",
    'reveal_blocked_reason: canRevealPrivately',
    '"supporter_card_private_reveal_disabled"',
    "supporter_cards.user_id = store_orders.purchasing_user_id",
    "account_entitlements.user_id = store_orders.purchasing_user_id",
    "account_entitlements.livemode = 0",
    "supporter_cards.livemode = 0",
  ]) {
    assertIncludes(helper, snippet, `${ACCOUNT_READ_MODEL_HELPER} should keep blocked/sanitized status contract: ${snippet}`);
  }

  for (const field of [
    "serial_number",
    "generated_insignia_json",
    "insignia_seed_hash",
    "stripe_checkout_session_id",
    "stripe_payment_intent_id",
    "stripe_customer_id",
    "payment_method",
    "billing_address",
    "discord_id",
    "raw_body",
    "provider_payload",
  ]) {
    assert.equal(helper.includes(field), false, `${ACCOUNT_READ_MODEL_HELPER} must not expose ${field} through Account Purchases.`);
  }
}

function assertPackageScriptWired() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-supporter-card-reveal-approval-preflight"],
    "tsx scripts/test-dzn-store-supporter-card-reveal-approval-preflight.ts",
    "Focused Supporter Card reveal approval preflight test should be wired into package scripts.",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-supporter-card-reveal-approval-preflight",
    "Full npm test should include the Supporter Card reveal approval preflight guard.",
  );
  assert.equal(
    packageJson.scripts?.["test:dzn-store-supporter-card-reveal-implementation"],
    "tsx scripts/test-dzn-store-supporter-card-reveal-implementation.ts",
    "Focused Supporter Card private reveal implementation test should be wired into package scripts.",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-supporter-card-reveal-implementation",
    "Full npm test should include the Supporter Card private reveal implementation guard.",
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

function assertIncludes(source: string, snippet: string, message?: string) {
  assert.equal(source.includes(snippet), true, message ?? `Expected source to include ${snippet}`);
}
