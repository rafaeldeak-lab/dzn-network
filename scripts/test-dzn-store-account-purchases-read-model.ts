import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { onRequest as accountPurchasesRoute } from "../functions/api/account/purchases";
import {
  canReadDznStoreAccountPurchasesReadModel,
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_FLAG,
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE,
  DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
  readDznStoreAccountPurchasesReadModel,
} from "../functions/_lib/dzn-store-account-purchases";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const ROUTE = "functions/api/account/purchases.ts";
const HELPER = "functions/_lib/dzn-store-account-purchases.ts";
const ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const STORE_CHECKOUT_ROUTE = "functions/api/store/orders/[orderId]/checkout.ts";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const FULFILMENT_LEDGER_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const DOC = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md";
const HANDOFF = "docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION_HANDOFF.md";
const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT.md";
const PREFLIGHT_HANDOFF = "docs/DZN_STORE_FULFILMENT_RECONCILIATION_READ_MODEL_PREFLIGHT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const PACKAGE_JSON = "package.json";
const NOW = new Date("2026-08-29T12:00:00.000Z");

const READ_MODEL_FLAGS = {
  DZN_STORE_SANDBOX_RUNTIME: "local",
  DZN_STORE_ENABLED: "true",
  [DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_FLAG]: "true",
  DZN_STORE_LIVE_CHECKOUT_ENABLED: "false",
  DZN_LIVE_CHECKOUT_ENABLED: "false",
  DZN_EARNED_SPINS_ENABLED: "false",
  DZN_REWARD_WHEEL_ENABLED: "false",
};

const TEST_USER: SessionUser = {
  id: "mock-user",
  discord_id: "mock-discord-user",
  username: "RafaelDeak",
  avatar: null,
};

const SOURCE_CONFIG_FILES = [
  "cloudflare-env.d.ts",
  "wrangler.toml",
  "wrangler.adm-sync.toml",
  "wrangler.auto-update.toml",
] as const;

const FORBIDDEN_READ_MODEL_PATHS = [
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
  "app/account/entitlements",
  "app/store/purchases",
  "app/store/supporter-card",
  "app/admin/store/reconciliation",
  "app/admin/store/refund-disputes",
  "components/store/account-entitlements.tsx",
  "components/store/supporter-card-reveal.tsx",
  "components/store/refund-dispute-queue.tsx",
  "components/supporter",
  "functions/api/wheel",
  "app/wheel",
] as const;

const FORBIDDEN_RESPONSE_VALUES = [
  "mock-user",
  "mock-discord-user",
  "other-user",
  "other-discord-user",
  "order_internal_player",
  "order_internal_wrong_scope",
  "order_internal_hidden_other",
  "item_internal_player",
  "item_internal_wrong_scope",
  "item_internal_hidden_other",
  "entitlement_internal_player",
  "entitlement_internal_hidden_other",
  "card_internal_player",
  "card_internal_hidden_other",
  "DZN-SUP-000001",
  "DZN-SUP-999999",
  "cs_test_store_player",
  "pi_test_store_player",
  "cus_test_private",
  "ch_test_private",
  "re_test_private",
  "du_test_private",
  "evt_store_player",
  "private@example.test",
  "raw_event_sha256",
  "stripe_checkout_session_id",
  "stripe_payment_intent_id",
  "stripe_customer",
  "DZN-STORE-20260829-SANDBOX88",
] as const;

async function main() {
  assertFilesExist();
  assertConstants();
  assertAccessGates();
  await assertRouteDisabledByDefault();
  await assertRouteRequiresLoginWhenEnabled();
  await assertDbUnavailableIsPrivateNoStore();
  await assertPrivateCurrentUserReadModel();
  await assertHelperMatchesRoutePayload();
  assertRuntimeBoundary();
  assertDocsAndPackageScript();
  console.log("DZN Store Account Purchases read-model implementation tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    ORDER_HELPER,
    FULFILMENT_HELPER,
    STORE_WEBHOOK_HELPER,
    STORE_WEBHOOK_ROUTE,
    STORE_ORDER_ROUTE,
    STORE_CHECKOUT_ROUTE,
    ORDER_LEDGER_MIGRATION,
    FULFILMENT_LEDGER_MIGRATION,
    DOC,
    HANDOFF,
    PREFLIGHT,
    PREFLIGHT_HANDOFF,
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

function assertConstants() {
  assert.equal(DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE, "/api/account/purchases");
  assert.equal(DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_FLAG, "DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED");
  assert.equal(DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION, "2026-08-29.store-account-purchases-read-model-v1");
}

function assertAccessGates() {
  const enabled = canReadDznStoreAccountPurchasesReadModel(READ_MODEL_FLAGS);
  assert.equal(enabled.ok, true, "Explicit local/test read-model flag should enable the private read model.");

  const disabled = canReadDznStoreAccountPurchasesReadModel({
    DZN_STORE_SANDBOX_RUNTIME: "local",
    DZN_STORE_ENABLED: "true",
  });
  assert.equal(disabled.ok, false, "Account Purchases read model must be disabled by default.");
  if (!disabled.ok) {
    assert.equal(disabled.status, 404);
    assert.equal(disabled.code, "STORE_ACCOUNT_PURCHASES_READ_MODEL_DISABLED");
  }

  for (const [flag, value, expectedCode] of [
    ["DZN_STORE_ENABLED", "false", "STORE_DISABLED"],
    ["DZN_STORE_SANDBOX_RUNTIME", "", "STORE_SANDBOX_RUNTIME_REQUIRED"],
    ["DZN_STORE_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_EARNED_SPINS_ENABLED", "true", "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED"],
    ["DZN_REWARD_WHEEL_ENABLED", "true", "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED"],
  ] as const) {
    const result = canReadDznStoreAccountPurchasesReadModel({
      ...READ_MODEL_FLAGS,
      [flag]: value,
    });
    assert.equal(result.ok, false, `${flag}=${value} should block this read model.`);
    if (!result.ok) assert.equal(result.code, expectedCode);
  }
}

async function assertRouteDisabledByDefault() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    MOCK_AUTH: "true",
    DZN_STORE_SANDBOX_RUNTIME: "local",
    DZN_STORE_ENABLED: "true",
    DZN_LIVE_CHECKOUT_ENABLED: "false",
  } as unknown as Env);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 404);
  assert.equal(body.ok, false);
  assert.equal(body.error, "STORE_ACCOUNT_PURCHASES_READ_MODEL_DISABLED");
  assert.equal(body.private, true);
  assert.equal(body.cache, "no-store");
  assert.equal(db.operations.length, 0, "Disabled read model must block before D1 access.");
  assertPrivateNoStoreHeaders(response);
}

async function assertRouteRequiresLoginWhenEnabled() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    ...READ_MODEL_FLAGS,
  } as unknown as Env);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Unauthorized");
  assert.equal(body.private, true);
  assert.equal(db.operations.length, 0, "Missing session cookie should fail before Store ledger reads.");
  assertPrivateNoStoreHeaders(response);
}

async function assertDbUnavailableIsPrivateNoStore() {
  const response = await callRoute({
    MOCK_AUTH: "true",
    ...READ_MODEL_FLAGS,
  } as unknown as Env);
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error, "STORE_ACCOUNT_PURCHASES_DB_UNAVAILABLE");
  assert.equal(body.live_checkout_enabled, false);
  assertPrivateNoStoreHeaders(response);
}

async function assertPrivateCurrentUserReadModel() {
  const db = seededDb();
  const response = await callRoute({
    DB: db,
    MOCK_AUTH: "true",
    ...READ_MODEL_FLAGS,
  } as unknown as Env);
  const body = await response.json() as AccountPurchasesPayload;
  const text = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.private, true);
  assert.equal(body.cache, "no-store");
  assert.equal(body.scope, "current_user");
  assert.equal(body.route, DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE);
  assert.equal(body.schema_version, DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION);
  assert.equal(body.account.display_name, "RafaelDeak");
  assert.equal(body.purchases_count, 2);
  assert.equal(body.purchases.length, 2);
  assert.equal(body.entitlements_count, 1);
  assert.equal(body.supporter_cards_count, 1);
  assert.equal(body.safety.read_only, true);
  assert.equal(body.safety.sanitized_ledgers_only, true);
  assert.equal(body.safety.current_user_only, true);
  assert.equal(body.safety.live_checkout_enabled, false);
  assert.equal(body.safety.stripe_mutation, false);
  assert.equal(body.safety.cloudflare_config_mutation, false);
  assert.equal(body.safety.production_d1_write, false);
  assert.equal(body.safety.earned_spin_write, false);
  assert.equal(body.safety.reward_wheel_runtime, false);
  assert.equal(body.safety.billing_effect, false);
  assert.equal(body.safety.ranking_effect, false);
  assert.equal(body.safety.discovery_effect, false);
  assert.equal(body.safety.review_effect, false);
  assert.equal(body.safety.badge_effect, false);
  assert.equal(body.safety.season_effect, false);
  assert.equal(body.safety.event_effect, false);
  assert.equal(body.safety.server_wars_effect, false);
  assert.equal(body.safety.ctf_effect, false);
  assert.equal(body.safety.xp_award_effect, false);
  assert.equal(body.safety.calling_card_award_effect, false);
  assert.equal(body.safety.public_profile_visibility_effect, false);
  assert.equal(body.safety.competitive_eligibility_effect, false);

  const paidPurchase = body.purchases.find((purchase) => purchase.purchase_ref === "DZN-STORE-20260829-PLAYER01");
  assert.ok(paidPurchase, "Owned paid purchase should be returned by public-safe order number.");
  assert.equal(paidPurchase.status, "paid");
  assert.equal(paidPurchase.labels.guaranteed_purchase, true);
  assert.equal(paidPurchase.labels.account_bound, true);
  assert.equal(paidPurchase.labels.no_competitive_advantage, true);
  assert.equal(paidPurchase.payment_receipt.recorded, true);
  assert.equal(paidPurchase.entitlement?.status, "active");
  assert.equal(paidPurchase.supporter_card?.status, "active");
  assert.equal(paidPurchase.supporter_card?.private_reveal_available, false);
  assert.equal(paidPurchase.supporter_card?.public_reveal_available, false);
  assert.equal(paidPurchase.supporter_card?.reveal_blocked_reason, "supporter_card_reveal_requires_future_approved_slice");
  assert.equal(paidPurchase.fair_progression_boundary.grants_spins, false);
  assert.equal(paidPurchase.fair_progression_boundary.grants_xp, false);
  assert.equal(paidPurchase.fair_progression_boundary.grants_owner_subscription_access, false);
  assert.equal(paidPurchase.fair_progression_boundary.grants_competitive_eligibility, false);

  const draftPurchase = body.purchases.find((purchase) => purchase.purchase_ref === "DZN-STORE-20260829-DRAFT01");
  assert.ok(draftPurchase, "Owned draft purchase should be returned without invented fulfilment state.");
  assert.equal(draftPurchase.status, "draft");
  assert.equal(draftPurchase.payment_receipt.recorded, false);
  assert.equal(draftPurchase.entitlement, null);
  assert.equal(draftPurchase.supporter_card, null);

  assert.equal(text.includes("DZN-STORE-20260829-HIDDEN99"), false, "Other users' purchases must not be returned.");
  for (const forbidden of FORBIDDEN_RESPONSE_VALUES) {
    assert.equal(text.includes(forbidden), false, `Response must not expose ${forbidden}.`);
  }

  assertPrivateNoStoreHeaders(response);
  assert.equal(db.operations.some((operation) => operation.type === "run"), false, "Read model must not perform D1 writes.");
  for (const operation of db.operations) {
    assert.equal(operation.type, "all", "Read model should use SELECT list reads only.");
    assert.doesNotMatch(operation.sql, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i);
    assert.doesNotMatch(operation.sql, /\b(?:earned_spins|spin_ledger|wheel_cooldowns|owner_billing_accounts|server_rankings|leaderboards|server_reviews|player_xp|player_calling_card_awards)\b/i);
  }
}

async function assertHelperMatchesRoutePayload() {
  const db = seededDb();
  const result = await readDznStoreAccountPurchasesReadModel({
    DB: db,
    ...READ_MODEL_FLAGS,
  } as unknown as Env, TEST_USER, { now: NOW });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  if (result.body.ok) {
    assert.equal(result.body.generated_at, NOW.toISOString());
    assert.equal(result.body.purchases_count, 2);
    assert.equal(result.body.entitlements[0].purchase_ref, "DZN-STORE-20260829-PLAYER01");
    assert.equal(result.body.supporter_cards[0].private_reveal_available, false);
  }
}

function assertRuntimeBoundary() {
  for (const path of FORBIDDEN_READ_MODEL_PATHS) {
    assert.equal(existsSync(path), false, `${path} must remain out of scope for this read-model implementation.`);
  }

  const migrationFiles = listFiles("migrations")
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  assert.equal(migrationFiles.at(-1), FULFILMENT_LEDGER_MIGRATION, "This read-model slice must not add a migration after 0073.");

  const helper = read(HELPER);
  const route = read(ROUTE);
  for (const source of [helper, route]) {
    assert.doesNotMatch(source, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i, "Account Purchases code must be read-only.");
    assert.doesNotMatch(source, /\b(?:checkout\.sessions\.create|stripeFormRequest|stripeGetRequest|fetch\s*\(|\/checkout\/sessions|wrangler)\b/i, "Account Purchases code must not call Stripe, network, or Wrangler.");
    assert.doesNotMatch(source, /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:earned_spins|spin_ledger|wheel_cooldowns)\b/i, "Account Purchases code must not touch earned spins or wheel runtime tables.");
  }

  for (const path of SOURCE_CONFIG_FILES) {
    if (!existsSync(path)) continue;
    const source = read(path);
    for (const flag of [
      DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_FLAG,
      "DZN_STORE_LIVE_CHECKOUT_ENABLED=true",
      "DZN_LIVE_CHECKOUT_ENABLED=true",
      "DZN_EARNED_SPINS_ENABLED=true",
      "DZN_REWARD_WHEEL_ENABLED=true",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not configure ${flag}.`);
    }
  }
}

function assertDocsAndPackageScript() {
  const docs: Array<[string, string[]]> = [
    [DOC, [
      "# DZN Store Account Purchases Read-Model Implementation",
      "`GET /api/account/purchases`",
      "`DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED`",
      "private/no-store",
      "current authenticated user",
      "No public Supporter Card reveal.",
      "no live checkout activation",
      "no issue #49 change",
    ]],
    [HANDOFF, [
      "# DZN Store Account Purchases Read-Model Implementation Handoff",
      "Branch: `codex/dzn-store-account-purchases-read-model-20260829`",
      "Protected OneDrive checkout was not modified.",
      "`GET /api/account/purchases`",
      "No public Supporter Card reveal.",
      "No live checkout activation.",
      "No issue #49 change.",
    ]],
    [PREFLIGHT, [
      "The Store private Account Purchases and Entitlements read-model implementation is now delivered separately",
      "`docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md`",
    ]],
    [PREFLIGHT_HANDOFF, [
      "The Store private Account Purchases and Entitlements read-model implementation is now delivered separately",
      "`functions/api/account/purchases.ts`",
    ]],
    [BACKLOG, [
      "## DZN Store Account Purchases Read-Model Implementation",
      "Delivered in `docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md`.",
    ]],
    [MASTER_SPEC, [
      "## DZN Store Account Purchases Read-Model Implementation Slice",
      "`functions/api/account/purchases.ts`",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store Account Purchases read-model implementation adds `GET /api/account/purchases`",
    ]],
    [BILLING_PLANS, [
      "The DZN Store Account Purchases read-model implementation adds a disabled-by-default private read-only route",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_IMPLEMENTATION.md` adds the disabled-by-default private Account Purchases read model",
    ]],
  ];

  for (const [path, snippets] of docs) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should contain: ${snippet}`);
    }
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-account-purchases-read-model"],
    "tsx scripts/test-dzn-store-account-purchases-read-model.ts",
    "Focused Account Purchases read-model test should be wired into package scripts.",
  );
  assertIncludes(packageJson.scripts?.test ?? "", "npm run test:dzn-store-account-purchases-read-model");
}

async function callRoute(env: Env, method = "GET") {
  const request = new Request("https://dzn.test/api/account/purchases", { method });
  return accountPurchasesRoute({
    request,
    env,
    params: {},
    waitUntil: () => undefined,
    next: () => Promise.resolve(new Response(null, { status: 404 })),
    data: {},
  } satisfies PagesContext);
}

function assertPrivateNoStoreHeaders(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.match(response.headers.get("vary") ?? "", /Cookie/i);
  assert.equal(response.headers.get("x-dzn-cache"), "BYPASS");
}

function seededDb() {
  const db = new FakeD1Database();
  db.orders.push(
    makeOrder({
      id: "order_internal_player",
      order_number: "DZN-STORE-20260829-PLAYER01",
      purchasing_user_id: "mock-user",
      status: "paid",
      paid_at: "2026-08-29T11:00:00.000Z",
      updated_at: "2026-08-29T11:01:00.000Z",
    }),
    makeOrder({
      id: "order_internal_draft",
      order_number: "DZN-STORE-20260829-DRAFT01",
      purchasing_user_id: "mock-user",
      status: "draft",
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
      paid_at: null,
      selected_theme_key: "ember-signal",
      updated_at: "2026-08-29T10:00:00.000Z",
    }),
    makeOrder({
      id: "order_internal_wrong_scope",
      order_number: "DZN-STORE-20260829-SANDBOX88",
      purchasing_user_id: "mock-user",
      ledger_scope: "sandbox",
      status: "paid",
      paid_at: "2026-08-29T09:30:00.000Z",
      updated_at: "2026-08-29T09:31:00.000Z",
    }),
    makeOrder({
      id: "order_internal_hidden_other",
      order_number: "DZN-STORE-20260829-HIDDEN99",
      purchasing_user_id: "other-user",
      purchasing_discord_id_hash: "other-discord-user",
      status: "paid",
      paid_at: "2026-08-29T09:00:00.000Z",
      updated_at: "2026-08-29T09:01:00.000Z",
    }),
  );
  db.items.push(
    makeItem({ id: "item_internal_player", order_id: "order_internal_player" }),
    makeItem({ id: "item_internal_draft", order_id: "order_internal_draft", product_key: "profile-theme-pack", product_name_snapshot: "DZN Profile Theme Pack", product_type: "profile_theme", fulfilment_kind: "theme_pack" }),
    makeItem({ id: "item_internal_wrong_scope", order_id: "order_internal_wrong_scope" }),
    makeItem({ id: "item_internal_hidden_other", order_id: "order_internal_hidden_other" }),
  );
  db.paymentEvents.push({
    related_order_id: "order_internal_player",
    event_type: "checkout.session.completed",
    event_class: "checkout",
    processing_status: "processed",
    received_at: "2026-08-29T11:00:04.000Z",
    processed_at: "2026-08-29T11:00:06.000Z",
    failure_code: null,
    stripe_event_id: "evt_store_player",
    stripe_checkout_session_id: "cs_test_store_player",
    stripe_payment_intent_id: "pi_test_store_player",
    stripe_customer_ref_hash: "cus_test_private",
  });
  db.paymentEvents.push({
    related_order_id: "order_internal_hidden_other",
    event_type: "checkout.session.completed",
    event_class: "checkout",
    processing_status: "processed",
    received_at: "2026-08-29T09:00:04.000Z",
    processed_at: "2026-08-29T09:00:06.000Z",
    failure_code: null,
    stripe_event_id: "evt_store_hidden_other",
    stripe_checkout_session_id: "cs_test_hidden_other",
    stripe_payment_intent_id: "pi_test_hidden_other",
    stripe_customer_ref_hash: "cus_test_hidden_other",
  });
  db.fulfilmentAttempts.push({
    order_id: "order_internal_player",
    event_type: "checkout.session.completed",
    status: "fulfilled",
    eligibility_failure_code: null,
    started_at: "2026-08-29T11:00:04.000Z",
    finished_at: "2026-08-29T11:00:07.000Z",
  });
  db.entitlements.push({
    id: "entitlement_internal_player",
    user_id: "mock-user",
    entitlement_key: "dzn_store_dzn-founding-supporter-pack",
    source_order_id: "order_internal_player",
    source_order_item_id: "item_internal_player",
    source_product_key: "dzn-founding-supporter-pack",
    source_product_type: "supporter_pack",
    source_fulfilment_kind: "supporter_card",
    status: "active",
    visibility_state: "visible",
    granted_at: "2026-08-29T11:00:07.000Z",
    suspended_at: null,
    revoked_at: null,
  });
  db.entitlements.push({
    id: "entitlement_internal_hidden_other",
    user_id: "other-user",
    entitlement_key: "dzn_store_dzn-founding-supporter-pack",
    source_order_id: "order_internal_hidden_other",
    source_order_item_id: "item_internal_hidden_other",
    source_product_key: "dzn-founding-supporter-pack",
    source_product_type: "supporter_pack",
    source_fulfilment_kind: "supporter_card",
    status: "active",
    visibility_state: "visible",
    granted_at: "2026-08-29T09:00:07.000Z",
    suspended_at: null,
    revoked_at: null,
  });
  db.supporterCards.push({
    id: "card_internal_player",
    user_id: "mock-user",
    entitlement_id: "entitlement_internal_player",
    source_order_id: "order_internal_player",
    source_order_item_id: "item_internal_player",
    serial_number: "DZN-SUP-000001",
    status: "active",
    visibility_state: "visible",
    supporter_since: "2026-08-29T11:00:07.000Z",
    selected_theme_key: "signal-crown",
    issued_at: "2026-08-29T11:00:07.000Z",
    suspended_at: null,
    revoked_at: null,
  });
  db.supporterCards.push({
    id: "card_internal_hidden_other",
    user_id: "other-user",
    entitlement_id: "entitlement_internal_hidden_other",
    source_order_id: "order_internal_hidden_other",
    source_order_item_id: "item_internal_hidden_other",
    serial_number: "DZN-SUP-999999",
    status: "active",
    visibility_state: "visible",
    supporter_since: "2026-08-29T09:00:07.000Z",
    selected_theme_key: "signal-crown",
    issued_at: "2026-08-29T09:00:07.000Z",
    suspended_at: null,
    revoked_at: null,
  });
  db.orderStatusHistory.push({
    order_id: "order_internal_player",
    to_status: "paid",
    reason_code: "STORE_CHECKOUT_COMPLETED_FULFILLED",
    actor_type: "stripe_webhook",
    created_at: "2026-08-29T11:00:07.000Z",
  });
  db.entitlementStatusHistory.push({
    order_id: "order_internal_player",
    to_status: "active",
    reason_code: "STORE_ENTITLEMENT_GRANTED",
    actor_type: "stripe_webhook",
    created_at: "2026-08-29T11:00:07.000Z",
  });
  db.refundDisputeAudits.push({
    order_id: "order_internal_player",
    event_type: "charge.refunded",
    refund_kind: "none",
    dispute_status: null,
    local_decision: "recorded",
    decision_reason: "STORE_REFUND_AUDIT_NOOP",
    created_at: "2026-08-29T11:10:00.000Z",
    stripe_charge_id: "ch_test_private",
    stripe_refund_id: "re_test_private",
    stripe_dispute_id: "du_test_private",
  });
  return db;
}

function makeOrder(patch: Partial<OrderSeed> = {}): OrderSeed {
  return {
    id: "order_internal_player",
    order_number: "DZN-STORE-20260829-PLAYER01",
    purchasing_user_id: "mock-user",
    purchasing_discord_id_hash: "mock-discord-user",
    status: "paid",
    ledger_scope: "local",
    livemode: 0,
    product_count: 1,
    currency: "gbp",
    subtotal_amount_minor: 1000,
    tax_amount_minor: 0,
    total_amount_minor: 1000,
    selected_theme_key: "signal-crown",
    stripe_checkout_session_id: "cs_test_store_player",
    stripe_payment_intent_id: "pi_test_store_player",
    stripe_customer_ref_hash: "cus_test_private",
    terms_version: "dzn-store-sandbox-order-v1",
    created_at: "2026-08-29T10:59:00.000Z",
    updated_at: "2026-08-29T11:01:00.000Z",
    paid_at: "2026-08-29T11:00:00.000Z",
    refunded_at: null,
    revoked_at: null,
    ...patch,
  };
}

function makeItem(patch: Partial<ItemSeed> = {}): ItemSeed {
  return {
    id: "item_internal_player",
    order_id: "order_internal_player",
    product_key: "dzn-founding-supporter-pack",
    product_name_snapshot: "DZN FOUNDING SUPPORTER PACK",
    product_type: "supporter_pack",
    fulfilment_kind: "supporter_card",
    quantity: 1,
    unit_amount_minor: 1000,
    tax_amount_minor: 0,
    total_amount_minor: 1000,
    account_bound: 1,
    guaranteed_purchase: 1,
    no_competitive_advantage: 1,
    grants_spins: 0,
    grants_xp: 0,
    grants_rank_advantage: 0,
    grants_discovery_advantage: 0,
    grants_review_advantage: 0,
    grants_event_advantage: 0,
    grants_server_wars_advantage: 0,
    grants_ctf_advantage: 0,
    grants_owner_subscription_access: 0,
    grants_competitive_eligibility: 0,
    ...patch,
  };
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

type AccountPurchasesPayload = {
  ok: true;
  private: true;
  cache: "no-store";
  scope: "current_user";
  route: string;
  schema_version: string;
  account: { display_name: string };
  purchases_count: number;
  purchases: Array<{
    purchase_ref: string;
    status: string;
    labels: {
      guaranteed_purchase: boolean;
      account_bound: boolean;
      no_competitive_advantage: boolean;
    };
    payment_receipt: { recorded: boolean };
    entitlement: { status: string } | null;
    supporter_card: {
      status: string;
      private_reveal_available: false;
      public_reveal_available: false;
      reveal_blocked_reason: string;
    } | null;
    fair_progression_boundary: Record<string, false>;
  }>;
  entitlements_count: number;
  entitlements: Array<{ purchase_ref: string }>;
  supporter_cards_count: number;
  supporter_cards: Array<{ private_reveal_available: false }>;
  safety: Record<string, boolean>;
};

type SqlOperation = {
  type: "all" | "first" | "run";
  sql: string;
  bindings: unknown[];
};

type OrderSeed = {
  id: string;
  order_number: string;
  purchasing_user_id: string;
  purchasing_discord_id_hash: string;
  status: string;
  ledger_scope: "local" | "sandbox";
  livemode: 0;
  product_count: number;
  currency: string;
  subtotal_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  selected_theme_key: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_ref_hash: string | null;
  terms_version: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  revoked_at: string | null;
};

type ItemSeed = {
  id: string;
  order_id: string;
  product_key: string;
  product_name_snapshot: string;
  product_type: string;
  fulfilment_kind: string;
  quantity: 1;
  unit_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  account_bound: 1;
  guaranteed_purchase: 1;
  no_competitive_advantage: 1;
  grants_spins: 0;
  grants_xp: 0;
  grants_rank_advantage: 0;
  grants_discovery_advantage: 0;
  grants_review_advantage: 0;
  grants_event_advantage: 0;
  grants_server_wars_advantage: 0;
  grants_ctf_advantage: 0;
  grants_owner_subscription_access: 0;
  grants_competitive_eligibility: 0;
};

type EntitlementSeed = {
  id: string;
  user_id: string;
  entitlement_key: string;
  source_order_id: string;
  source_order_item_id: string;
  source_product_key: string;
  source_product_type: string;
  source_fulfilment_kind: string;
  status: string;
  visibility_state: string;
  granted_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
};

type SupporterCardSeed = {
  id: string;
  user_id: string;
  entitlement_id: string;
  source_order_id: string;
  source_order_item_id: string;
  serial_number: string;
  status: string;
  visibility_state: string;
  supporter_since: string | null;
  selected_theme_key: string | null;
  issued_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
};

type PaymentEventSeed = {
  related_order_id: string;
  event_type: string;
  event_class: string;
  processing_status: string;
  received_at: string | null;
  processed_at: string | null;
  failure_code: string | null;
  stripe_event_id: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_ref_hash: string | null;
};

type FulfilmentAttemptSeed = {
  order_id: string;
  event_type: string;
  status: string;
  eligibility_failure_code: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type StatusHistorySeed = {
  order_id: string;
  to_status: string;
  reason_code: string;
  actor_type: string;
  created_at: string | null;
};

type RefundDisputeSeed = {
  order_id: string;
  event_type: string;
  refund_kind: string | null;
  dispute_status: string | null;
  local_decision: string;
  decision_reason: string;
  created_at: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  stripe_dispute_id: string | null;
};

class FakeD1Database {
  operations: SqlOperation[] = [];
  orders: OrderSeed[] = [];
  items: ItemSeed[] = [];
  entitlements: EntitlementSeed[] = [];
  supporterCards: SupporterCardSeed[] = [];
  paymentEvents: PaymentEventSeed[] = [];
  fulfilmentAttempts: FulfilmentAttemptSeed[] = [];
  orderStatusHistory: StatusHistorySeed[] = [];
  entitlementStatusHistory: StatusHistorySeed[] = [];
  refundDisputeAudits: RefundDisputeSeed[] = [];

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  all(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "all", sql, bindings });
    if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(sql)) {
      throw new Error(`Read-model test blocked write SQL: ${sql}`);
    }
    if (/FROM\s+store_orders/i.test(sql) && /INNER\s+JOIN\s+store_order_items/i.test(sql)) {
      return this.readPurchases(bindings);
    }
    if (/FROM\s+store_payment_events/i.test(sql)) return this.readByBoundOrderIds(this.paymentEvents, "related_order_id", bindings);
    if (/FROM\s+store_fulfilment_attempts/i.test(sql)) return this.readByBoundOrderIds(this.fulfilmentAttempts, "order_id", bindings);
    if (/FROM\s+store_refund_dispute_audit/i.test(sql)) return this.readByBoundOrderIds(this.refundDisputeAudits, "order_id", bindings);
    if (/FROM\s+store_order_status_history/i.test(sql)) return this.readByBoundOrderIds(this.orderStatusHistory, "order_id", bindings);
    if (/FROM\s+store_entitlement_status_history/i.test(sql)) return this.readByBoundOrderIds(this.entitlementStatusHistory, "order_id", bindings);
    return [];
  }

  first(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "first", sql, bindings });
    return null;
  }

  run(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "run", sql, bindings });
    throw new Error(`Read-model test blocked D1 write: ${sql}`);
  }

  private readPurchases(bindings: unknown[]) {
    const userId = String(bindings[0]);
    const ledgerScope = String(bindings[1]);
    return this.orders
      .filter((order) => order.purchasing_user_id === userId && order.ledger_scope === ledgerScope && order.livemode === 0)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, Number(bindings[2]))
      .flatMap((order) => {
        const item = this.items.find((candidate) => candidate.order_id === order.id);
        if (!item) return [];
        const entitlement = this.entitlements.find((candidate) => candidate.source_order_item_id === item.id && candidate.user_id === order.purchasing_user_id) ?? null;
        const card = this.supporterCards.find((candidate) => candidate.source_order_item_id === item.id && candidate.user_id === order.purchasing_user_id) ?? null;
        return [{
          order_id: order.id,
          order_number: order.order_number,
          order_status: order.status,
          ledger_scope: order.ledger_scope,
          order_livemode: order.livemode,
          product_count: order.product_count,
          currency: order.currency,
          subtotal_amount_minor: order.subtotal_amount_minor,
          tax_amount_minor: order.tax_amount_minor,
          total_amount_minor: order.total_amount_minor,
          selected_theme_key: order.selected_theme_key,
          terms_version: order.terms_version,
          created_at: order.created_at,
          updated_at: order.updated_at,
          paid_at: order.paid_at,
          refunded_at: order.refunded_at,
          revoked_at: order.revoked_at,
          order_item_id: item.id,
          product_key: item.product_key,
          product_name_snapshot: item.product_name_snapshot,
          product_type: item.product_type,
          fulfilment_kind: item.fulfilment_kind,
          quantity: item.quantity,
          unit_amount_minor: item.unit_amount_minor,
          item_tax_amount_minor: item.tax_amount_minor,
          item_total_amount_minor: item.total_amount_minor,
          account_bound: item.account_bound,
          guaranteed_purchase: item.guaranteed_purchase,
          no_competitive_advantage: item.no_competitive_advantage,
          grants_spins: item.grants_spins,
          grants_xp: item.grants_xp,
          grants_rank_advantage: item.grants_rank_advantage,
          grants_discovery_advantage: item.grants_discovery_advantage,
          grants_review_advantage: item.grants_review_advantage,
          grants_event_advantage: item.grants_event_advantage,
          grants_server_wars_advantage: item.grants_server_wars_advantage,
          grants_ctf_advantage: item.grants_ctf_advantage,
          grants_owner_subscription_access: item.grants_owner_subscription_access,
          grants_competitive_eligibility: item.grants_competitive_eligibility,
          entitlement_key: entitlement?.entitlement_key ?? null,
          entitlement_status: entitlement?.status ?? null,
          entitlement_visibility_state: entitlement?.visibility_state ?? null,
          entitlement_granted_at: entitlement?.granted_at ?? null,
          entitlement_suspended_at: entitlement?.suspended_at ?? null,
          entitlement_revoked_at: entitlement?.revoked_at ?? null,
          supporter_card_status: card?.status ?? null,
          supporter_card_visibility_state: card?.visibility_state ?? null,
          supporter_since: card?.supporter_since ?? null,
          supporter_card_theme_key: card?.selected_theme_key ?? null,
          supporter_card_issued_at: card?.issued_at ?? null,
          supporter_card_suspended_at: card?.suspended_at ?? null,
          supporter_card_revoked_at: card?.revoked_at ?? null,
        }];
      });
  }

  private readByBoundOrderIds<Row extends Record<string, unknown>>(rows: Row[], key: keyof Row, bindings: unknown[]) {
    const orderIds = new Set(bindings.slice(0, -1).map((binding) => String(binding)));
    const limit = Number(bindings.at(-1));
    return rows
      .filter((row) => typeof row[key] === "string" && orderIds.has(String(row[key])))
      .slice(0, Number.isFinite(limit) ? limit : rows.length);
  }
}

class FakeD1Statement {
  private bindings: unknown[] = [];

  constructor(private readonly db: FakeD1Database, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  all<T>() {
    return Promise.resolve({ results: this.db.all(this.sql, this.bindings) as T[] });
  }

  first<T>() {
    return Promise.resolve(this.db.first(this.sql, this.bindings) as T | null);
  }

  run() {
    return Promise.resolve(this.db.run(this.sql, this.bindings));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
