import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ACCOUNT_PAGE = "app/account/purchases/page.tsx";
const ACCOUNT_COMPONENT = "components/store/dzn-store-account-purchases-page.tsx";
const STORE_PREVIEW_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const ACCOUNT_READ_MODEL_ROUTE = "functions/api/account/purchases.ts";
const ACCOUNT_READ_MODEL_HELPER = "functions/_lib/dzn-store-account-purchases.ts";
const READ_MODEL_TEST = "scripts/test-dzn-store-account-purchases-read-model.ts";
const DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md";
const HANDOFF = "docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL_HANDOFF.md";
const READ_MODEL_DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md";
const READ_MODEL_HANDOFF = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION_HANDOFF.md";
const RECONCILIATION_PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const PACKAGE_JSON = "package.json";

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const ALLOWED_UI_PATHS = [
  ACCOUNT_PAGE,
  ACCOUNT_COMPONENT,
] as const;

const FORBIDDEN_RUNTIME_PATHS = [
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
  "functions/api/supporter",
  "functions/api/wheel",
  "app/account/entitlements",
  "app/store/purchases",
  "app/store/supporter-card",
  "app/admin/store/reconciliation",
  "app/admin/store/refund-disputes",
  "app/purchases/page.tsx",
  "app/supporter/page.tsx",
  "app/wheel/page.tsx",
  "components/store/account-entitlements.tsx",
  "components/store/supporter-card-reveal.tsx",
  "components/store/refund-dispute-queue.tsx",
  "components/supporter",
  "components/wheel",
] as const;

const FORBIDDEN_UI_PATTERNS = [
  /\bmethod\s*:\s*["']POST["']/i,
  /\bmethod\s*:\s*["']PATCH["']/i,
  /\bmethod\s*:\s*["']DELETE["']/i,
  /\/api\/store\/orders/i,
  /\/api\/stripe/i,
  /\/api\/billing/i,
  /\/api\/wheel/i,
  /\/api\/admin\/store/i,
  /\/api\/account\/entitlements/i,
  /checkout\.sessions\.create/i,
  /stripeFormRequest/i,
  /stripeGetRequest/i,
  /\bSTRIPE_SECRET_KEY\b/i,
  /\bSTRIPE_WEBHOOK_SECRET\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\banalytics\b/i,
  /\bgtag\b/i,
  /\bposthog\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+/i,
  /\bDELETE\s+FROM\b/i,
  /\bwrangler\b/i,
] as const;

const FORBIDDEN_RAW_FIELD_REFERENCES = [
  "serial_number",
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
  assertPageRoute();
  assertAccountPurchasesComponent();
  assertStorePreviewLink();
  assertRuntimeBoundary();
  assertDocsAndPackageScripts();
  console.log("DZN Store Account Purchases UI shell tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ACCOUNT_PAGE,
    ACCOUNT_COMPONENT,
    STORE_PREVIEW_COMPONENT,
    ACCOUNT_READ_MODEL_ROUTE,
    ACCOUNT_READ_MODEL_HELPER,
    READ_MODEL_TEST,
    DOC,
    HANDOFF,
    READ_MODEL_DOC,
    READ_MODEL_HANDOFF,
    RECONCILIATION_PREFLIGHT,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPageRoute() {
  const source = read(ACCOUNT_PAGE);
  assert.equal(source.includes('title: "DZN Account Purchases"'), true, "Route should expose Account Purchases metadata.");
  assert.equal(source.includes("<DznStoreAccountPurchasesPage />"), true, "Route should render only the UI shell component.");
  assertReadOnlyUiSource(source, ACCOUNT_PAGE);
}

function assertAccountPurchasesComponent() {
  const source = read(ACCOUNT_COMPONENT);
  assert.equal(source.includes('"use client"'), true, "Account Purchases UI shell should be a client component.");
  assert.equal(source.includes('ACCOUNT_PURCHASES_ENDPOINT = "/api/account/purchases"'), true, "UI must consume the private Account Purchases read model.");
  assert.equal(source.includes("fetchJsonWithRetry<AccountPurchasesApiResponse>(ACCOUNT_PURCHASES_ENDPOINT"), true, "UI must call only the read model endpoint.");
  assert.equal(source.includes('credentials: "include"'), true, "UI must include session credentials.");
  assert.equal(source.includes('cache: "no-store"'), true, "UI must bypass browser/proxy cache.");
  assert.equal(source.includes("error.status === 401"), true, "UI should handle unauthenticated API responses.");
  assert.equal(source.includes("encodeURIComponent(ACCOUNT_PURCHASES_ROUTE)"), true, "Login redirect should preserve the Account Purchases return path.");
  assert.equal(source.includes('data-dzn-store-account-purchases-ui="read-only"'), true, "UI must declare its read-only contract.");
  assert.equal(source.includes('data-dzn-store-account-purchases-endpoint={ACCOUNT_PURCHASES_ENDPOINT}'), true, "UI must declare the endpoint it consumes.");
  assert.equal(source.includes('data-supporter-card-reveal="blocked"'), true, "UI must declare that Supporter Card reveal is blocked.");
  assert.equal(source.includes('data-store-runtime="ui-shell-only"'), true, "UI must declare that it is not runtime fulfilment.");
  assert.equal(source.includes('data-live-checkout="disabled"'), true, "UI must declare live checkout disabled.");
  assert.equal(source.includes('data-production-mutation="none"'), true, "UI must declare no production mutation.");
  assert.equal(source.includes("private_reveal_available"), false, "UI should not branch on a future private reveal grant.");
  assert.equal(source.includes("public_reveal_available"), false, "UI should not branch on a future public reveal grant.");
  assert.equal(source.includes("reveal_blocked_reason"), true, "UI should show the blocked reveal reason from the sanitized status payload.");
  assert.equal(source.includes("Card reveal blocked"), true, "UI should clearly disable Supporter Card reveal.");
  assert.equal(source.includes("Fair Progression Boundary"), true, "UI should display the Fair Progression Boundary.");
  assert.equal(source.includes("No earned spins or reward wheel runtime"), true, "UI should keep wheel runtime out of scope.");
  assert.equal(source.includes("No billing, ranking, scoring, XP, event, review, badge, season, Server Wars, CTF, public-profile, or eligibility impact"), true);
  assertReadOnlyUiSource(source, ACCOUNT_COMPONENT);

  for (const rawField of FORBIDDEN_RAW_FIELD_REFERENCES) {
    assert.equal(source.includes(rawField), false, `${ACCOUNT_COMPONENT} must not reference raw/private field ${rawField}.`);
  }
}

function assertStorePreviewLink() {
  const source = read(STORE_PREVIEW_COMPONENT);
  assert.equal(source.includes('href="/account/purchases"'), true, "Store preview should link to the private Account Purchases shell.");
  assert.equal(source.includes("Purchases"), true, "Store preview should label the private purchases link.");
}

function assertRuntimeBoundary() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must remain out of scope for this UI shell slice.`);
  }
  for (const path of ALLOWED_UI_PATHS) {
    assert.equal(existsSync(path), true, `${path} is the only approved Account Purchases UI path.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), "migrations/0073_dzn_store_fulfilment_ledger_schema.sql", "This UI shell must not add a migration after 0073.");

  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of [
      "DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL_ENABLED",
      "DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED",
      "DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED",
      "DZN_STORE_WEBHOOK_REPLAY_ENABLED",
      "DZN_STORE_MANUAL_REVIEW_ENABLED",
      "DZN_STORE_OPERATOR_REFUND_WORKFLOW_ENABLED",
      "DZN_STORE_LIVE_CHECKOUT_ENABLED=true",
      "DZN_LIVE_CHECKOUT_ENABLED=true",
      "DZN_EARNED_SPINS_ENABLED=true",
      "DZN_REWARD_WHEEL_ENABLED=true",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not configure ${flag}.`);
    }
  }
}

function assertDocsAndPackageScripts() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "# DZN Store Account Purchases UI Shell",
      "`app/account/purchases/page.tsx`",
      "`components/store/dzn-store-account-purchases-page.tsx`",
      "`GET /api/account/purchases`",
      "`credentials: \"include\"`",
      "`cache: \"no-store\"`",
      "No public Supporter Card reveal.",
      "No Supporter Card serial number display.",
      "No live checkout activation.",
      "No Cloudflare variable, secret, binding, Pages config, Workers config, or production D1 mutation.",
      "No issue #49 change.",
      "Store private Supporter Card reveal approval preflight",
    ]],
    [HANDOFF, [
      "# DZN Store Account Purchases UI Shell Handoff",
      "Branch: `codex/dzn-store-account-purchases-ui-shell-20260831`",
      "Stacked on: `codex/dzn-store-account-purchases-read-model-20260829`",
      "Protected OneDrive checkout was not modified.",
      "Added `/account/purchases`.",
      "No public Supporter Card reveal.",
      "No Supporter Card serial number display.",
      "No live checkout activation.",
      "No issue #49 change.",
    ]],
    [READ_MODEL_DOC, [
      "The follow-on Account Purchases UI shell is delivered separately",
      "`docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`",
    ]],
    [READ_MODEL_HANDOFF, [
      "Follow-on delivered separately: Store private Account Purchases UI shell",
    ]],
    [BACKLOG, [
      "## DZN Store Account Purchases UI Shell",
      "Delivered in `docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md`.",
    ]],
    [MASTER_SPEC, [
      "## DZN Store Account Purchases UI Shell Slice",
      "`app/account/purchases/page.tsx`",
      "`components/store/dzn-store-account-purchases-page.tsx`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store Account Purchases UI shell adds `/account/purchases`",
    ]],
    [BILLING_PLANS, [
      "The DZN Store Account Purchases UI shell adds an authenticated private read-only page",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_ACCOUNT_PURCHASES_UI_SHELL.md` adds the private Account Purchases UI shell",
    ]],
    [RECONCILIATION_PREFLIGHT, [
      "The Store private Account Purchases UI shell is now delivered separately",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store Account Purchases UI shell is now delivered",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should contain: ${snippet}`);
    }
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-account-purchases-ui-shell"],
    "tsx scripts/test-dzn-store-account-purchases-ui-shell.ts",
    "Focused Account Purchases UI shell test should be wired into package scripts.",
  );
  assertIncludes(packageJson.scripts?.test ?? "", "npm run test:dzn-store-account-purchases-ui-shell");
}

function assertReadOnlyUiSource(source: string, path: string) {
  for (const pattern of FORBIDDEN_UI_PATTERNS) {
    assert.doesNotMatch(source, pattern, `${path} must remain read-only and must not match ${pattern}.`);
  }
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
