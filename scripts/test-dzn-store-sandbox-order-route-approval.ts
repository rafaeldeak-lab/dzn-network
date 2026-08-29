import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { onRequest as storeOrdersRoute } from "../functions/api/store/orders";
import {
  canCreateDznStoreSandboxOrder,
  createDznStoreSandboxOrder,
  DZN_STORE_ORDER_BODY_LIMIT_BYTES,
  DZN_STORE_SANDBOX_ORDER_ROUTE,
  DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION,
  DZN_STORE_SANDBOX_RUNTIME_FLAG,
  DZN_STORE_TERMS_VERSION,
  validateDznStoreSandboxOrderBody,
  type DznStoreSandboxOrderInput,
} from "../functions/_lib/dzn-store-orders";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const ROUTE = "functions/api/store/orders.ts";
const HELPER = "functions/_lib/dzn-store-orders.ts";
const CATALOG_HELPER = "functions/_lib/dzn-store-catalog.ts";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const DOC = "docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md";
const HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL_HANDOFF.md";
const ORDER_LEDGER_DOC = "docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA.md";
const ORDER_LEDGER_HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_LEDGER_SCHEMA_HANDOFF.md";
const CHECKOUT_PREFLIGHT = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md";
const CHECKOUT_SESSION_DOC = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md";
const CHECKOUT_SESSION_HANDOFF = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const PACKAGE_JSON = "package.json";

const STORE_ROUTE_FLAGS = {
  DZN_STORE_SANDBOX_RUNTIME: "local",
  DZN_STORE_ENABLED: "true",
  DZN_STORE_CHECKOUT_ENABLED: "true",
  DZN_STORE_SANDBOX_CHECKOUT_ENABLED: "true",
  DZN_STORE_LIVE_CHECKOUT_ENABLED: "false",
  DZN_STORE_WEBHOOK_FULFILMENT_ENABLED: "false",
  DZN_SUPPORTER_CARDS_ENABLED: "false",
  DZN_EARNED_SPINS_ENABLED: "false",
  DZN_REWARD_WHEEL_ENABLED: "false",
  DZN_LIVE_CHECKOUT_ENABLED: "false",
};

const TEST_USER: SessionUser = {
  id: "user_test_player_001",
  discord_id: "discord_private_123456789",
  username: "Rafael DZN",
  avatar: null,
};

const VALID_INPUT: DznStoreSandboxOrderInput = {
  productKey: "dzn-founding-supporter-pack",
  priceId: "price_founder_sandbox_1000",
  supporterCardThemeKey: "signal-crown",
  returnTo: "/store",
  clientMutationId: "client_order_001",
};

type RouteJsonPayload = Record<string, unknown> & {
  checkout_available?: unknown;
  order?: {
    status?: unknown;
    checkout?: {
      available?: unknown;
    };
  };
};

async function main() {
  assertFilesExist();
  assertRouteConstants();
  await assertDefaultDisabledAndLocalTestOnly();
  assertBodyValidationRejectsClientAuthority();
  await assertRouteAuthAndBodyBoundaries();
  await assertSuccessfulPendingSandboxOrderWrite();
  await assertCatalogSafetyBlocksProtectedOutcomes();
  assertNoForbiddenRuntimeOrProductionMutationPaths();
  assertDocsAndPackageScripts();
  console.log("DZN Store sandbox order creation route approval tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    CATALOG_HELPER,
    ORDER_LEDGER_MIGRATION,
    DOC,
    HANDOFF,
    ORDER_LEDGER_DOC,
    ORDER_LEDGER_HANDOFF,
    CHECKOUT_PREFLIGHT,
    CHECKOUT_SESSION_DOC,
    CHECKOUT_SESSION_HANDOFF,
    STORE_WEBHOOK_ROUTE,
    STORE_WEBHOOK_HELPER,
    STORE_FULFILMENT_HELPER,
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

function assertRouteConstants() {
  assert.equal(DZN_STORE_SANDBOX_ORDER_ROUTE, "/api/store/orders");
  assert.equal(DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION, "2026-08-27.sandbox-order-route-v1");
  assert.equal(DZN_STORE_SANDBOX_RUNTIME_FLAG, "DZN_STORE_SANDBOX_RUNTIME");
  assert.equal(DZN_STORE_ORDER_BODY_LIMIT_BYTES, 4096);
  assert.equal(DZN_STORE_TERMS_VERSION, "dzn-store-sandbox-order-v1");
}

async function assertDefaultDisabledAndLocalTestOnly() {
  const missingRuntime = canCreateDznStoreSandboxOrder({
    DZN_STORE_ENABLED: "true",
    DZN_STORE_CHECKOUT_ENABLED: "true",
    DZN_STORE_SANDBOX_CHECKOUT_ENABLED: "true",
  });
  assert.equal(missingRuntime.ok, false, "Store order writes must require explicit local/test runtime.");
  if (!missingRuntime.ok) assert.equal(missingRuntime.code, "STORE_SANDBOX_RUNTIME_REQUIRED");

  const db = new FakeD1Database(validCatalogRow());
  const disabled = await createDznStoreSandboxOrder({ DB: db, [DZN_STORE_SANDBOX_RUNTIME_FLAG]: "local" } as unknown as Env, TEST_USER, VALID_INPUT);
  assert.equal(disabled.ok, false, "Store orders must be disabled by default.");
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.error, "STORE_DISABLED");
  assert.equal(db.operations.length, 0, "Disabled Store order route must block before D1 access.");

  for (const liveFlag of ["DZN_STORE_LIVE_CHECKOUT_ENABLED", "DZN_LIVE_CHECKOUT_ENABLED"] as const) {
    const liveDb = new FakeD1Database(validCatalogRow());
    const result = await createDznStoreSandboxOrder({
      DB: liveDb,
      ...STORE_ROUTE_FLAGS,
      [liveFlag]: "true",
    } as unknown as Env, TEST_USER, VALID_INPUT);
    assert.equal(result.ok, false, `${liveFlag}=true must block sandbox order creation.`);
    assert.equal(result.body.error, "STORE_LIVE_CHECKOUT_BLOCKED");
    assert.equal(liveDb.operations.length, 0, `${liveFlag}=true must block before D1 access.`);
  }

  for (const enabledRuntimeFlag of [
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "DZN_SUPPORTER_CARDS_ENABLED",
    "DZN_EARNED_SPINS_ENABLED",
    "DZN_REWARD_WHEEL_ENABLED",
  ] as const) {
    const blockedDb = new FakeD1Database(validCatalogRow());
    const result = await createDznStoreSandboxOrder({
      DB: blockedDb,
      ...STORE_ROUTE_FLAGS,
      [enabledRuntimeFlag]: "true",
    } as unknown as Env, TEST_USER, VALID_INPUT);
    assert.equal(result.ok, false, `${enabledRuntimeFlag}=true must be out of scope for this route slice.`);
    assert.equal(blockedDb.operations.length, 0, `${enabledRuntimeFlag}=true must block before D1 access.`);
  }
}

function assertBodyValidationRejectsClientAuthority() {
  const valid = validateDznStoreSandboxOrderBody({
    productKey: "DZN_FOUNDING_SUPPORTER_PACK",
    priceId: "price_founder_sandbox_1000",
    supporterCardThemeKey: "Signal_Crown",
    returnTo: "/store?preview=1",
    clientMutationId: "clientOrder001",
  });
  assert.equal(valid.ok, true, "Valid client body should normalize to safe order input.");
  if (valid.ok) {
    assert.equal(valid.value.productKey, "dzn-founding-supporter-pack");
    assert.equal(valid.value.supporterCardThemeKey, "signal-crown");
    assert.equal(valid.value.returnTo, "/store?preview=1");
  }

  for (const [field, value] of [
    ["user_id", "attacker"],
    ["discord_id", "123"],
    ["owner_id", "owner"],
    ["server_id", "server"],
    ["billing_account_id", "billing"],
    ["entitlement_id", "entitlement"],
    ["stripe_price_id", "price_test"],
    ["stripe_customer_id", "cus_test"],
    ["stripe_checkout_session_id", "cs_test"],
    ["stripe_payment_intent_id", "pi_test"],
    ["quantity", 2],
    ["amount", 999],
    ["currency", "gbp"],
    ["livemode", true],
    ["status", "paid"],
  ] as const) {
    const result = validateDznStoreSandboxOrderBody({
      productKey: VALID_INPUT.productKey,
      priceId: VALID_INPUT.priceId,
      supporterCardThemeKey: VALID_INPUT.supporterCardThemeKey,
      [field]: value,
    });
    assert.equal(result.ok, false, `Client-supplied ${field} must be rejected.`);
    if (!result.ok) assert.equal(result.error, "FORBIDDEN_ORDER_FIELD");
  }

  for (const unsafeReturnTo of ["https://dayz-network.com/store", "//evil.example/store", "/store\r\nlocation:/evil"]) {
    const result = validateDznStoreSandboxOrderBody({
      productKey: VALID_INPUT.productKey,
      priceId: VALID_INPUT.priceId,
      supporterCardThemeKey: VALID_INPUT.supporterCardThemeKey,
      returnTo: unsafeReturnTo,
    });
    assert.equal(result.ok, false, `Unsafe returnTo should be rejected: ${unsafeReturnTo}`);
    if (!result.ok) assert.equal(result.error, "INVALID_RETURN_TO");
  }
}

async function assertRouteAuthAndBodyBoundaries() {
  const unauthDb = new FakeD1Database(validCatalogRow());
  const unauthenticated = await callRoute({
    env: { DB: unauthDb, ...STORE_ROUTE_FLAGS } as unknown as Env,
    body: VALID_INPUT,
  });
  assert.equal(unauthenticated.response.status, 401, "Route must require an authenticated DZN player.");
  assert.equal(unauthDb.operations.length, 0, "Unauthenticated route must not touch D1.");
  assert.equal(unauthenticated.json.checkout_available, false);

  const tooLarge = await storeOrdersRoute({
    request: new Request("https://dzn.test/api/store/orders", {
      method: "POST",
      body: JSON.stringify({ productKey: "x".repeat(DZN_STORE_ORDER_BODY_LIMIT_BYTES) }),
      headers: { "content-type": "application/json" },
    }),
    env: { MOCK_AUTH: "true", ...STORE_ROUTE_FLAGS, DB: new FakeD1Database(validCatalogRow()) } as unknown as Env,
    params: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  } satisfies PagesContext);
  assert.equal(tooLarge.status, 413, "Oversized route bodies must be rejected.");

  const method = await storeOrdersRoute({
    request: new Request("https://dzn.test/api/store/orders", { method: "GET" }),
    env: { MOCK_AUTH: "true", ...STORE_ROUTE_FLAGS, DB: new FakeD1Database(validCatalogRow()) } as unknown as Env,
    params: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  } satisfies PagesContext);
  assert.equal(method.status, 405, "Only POST should be accepted.");
}

async function assertSuccessfulPendingSandboxOrderWrite() {
  const db = new FakeD1Database(validCatalogRow());
  let idIndex = 0;
  const result = await createDznStoreSandboxOrder(
    { DB: db, ...STORE_ROUTE_FLAGS } as unknown as Env,
    TEST_USER,
    VALID_INPUT,
    {
      now: new Date("2026-08-27T10:00:00.000Z"),
      createId: () => ["orderid001", "itemid001", "ordernum01"][idIndex++] ?? `extraid${idIndex}`,
      hashValue,
    },
  );

  assert.equal(result.ok, true, "Enabled local/test flags should allow one pending sandbox order write.");
  assert.equal(result.status, 201);
  assert.equal(result.body.order.status, "draft");
  assert.equal(result.body.order.ledger_scope, "local");
  assert.equal(result.body.order.livemode, false);
  assert.equal(result.body.order.product_count, 1);
  assert.equal(result.body.order.product.product_key, "dzn-founding-supporter-pack");
  assert.equal(result.body.order.price.currency, "gbp");
  assert.equal(result.body.order.checkout.available, false);
  assert.equal(result.body.order.checkout.url, null);
  assert.equal(result.body.order.checkout.session_id, null);
  assert.equal(result.body.next_step, "checkout_session_creation_requires_future_approval");
  assert.deepEqual(result.body.order.safety, {
    account_bound: true,
    guaranteed_purchase: true,
    no_competitive_advantage: true,
    grants_spins: false,
    grants_xp: false,
    grants_owner_subscription_access: false,
    grants_competitive_eligibility: false,
  });

  const first = db.operations.find((operation) => operation.type === "first");
  assert.ok(first, "Catalog lookup should occur after flags pass.");
  assert.match(first.sql, /FROM store_products/i);
  assert.match(first.sql, /INNER JOIN store_prices/i);
  assert.match(first.sql, /store_products\.status = 'approved'/i);
  assert.match(first.sql, /store_prices\.status = 'approved'/i);

  const batch = db.operations.find((operation) => operation.type === "batch");
  assert.ok(batch, "Order write should use one D1 batch.");
  assert.equal(batch.statements.length, 2, "Exactly order header and order item inserts are allowed.");
  assert.match(batch.statements[0].sql, /INSERT INTO store_orders/i);
  assert.match(batch.statements[1].sql, /INSERT INTO store_order_items/i);
  assert.doesNotMatch(batch.statements.map((statement) => statement.sql).join("\n"), /store_payment_events|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns/i);
  assert.doesNotMatch(JSON.stringify(batch.statements.flatMap((statement) => statement.bindings)), /discord_private_123456789/i, "Raw Discord id must not be stored in order bindings.");
  assert.match(JSON.stringify(batch.statements.flatMap((statement) => statement.bindings)), /[a-f0-9]{64}/, "Hashed private references should be bounded SHA-256 strings.");

  const testRuntimeDb = new FakeD1Database(validCatalogRow());
  let testRuntimeIdIndex = 0;
  const testRuntime = await createDznStoreSandboxOrder(
    { DB: testRuntimeDb, ...STORE_ROUTE_FLAGS, DZN_STORE_SANDBOX_RUNTIME: "test" } as unknown as Env,
    TEST_USER,
    VALID_INPUT,
    {
      now: new Date("2026-08-27T10:05:00.000Z"),
      createId: () => ["orderid002", "itemid002", "ordernum02"][testRuntimeIdIndex++] ?? `testruntime${testRuntimeIdIndex}`,
      hashValue,
    },
  );
  assert.equal(testRuntime.ok, true, "Test runtime should still be accepted for local/test-only sandbox order creation.");
  assert.equal(testRuntime.body.order.ledger_scope, "sandbox", "Test runtime must persist the schema-approved sandbox ledger scope.");
  const testRuntimeBatch = testRuntimeDb.operations.find((operation) => operation.type === "batch");
  assert.ok(testRuntimeBatch, "Test runtime should still write the sandbox order batch.");
  assert.equal(testRuntimeBatch.statements[0].bindings[4], "sandbox", "Persisted order ledger scope must match the migration check constraint.");

  const routeDb = new FakeD1Database(validCatalogRow());
  const created = await callRoute({
    env: { MOCK_AUTH: "true", DB: routeDb, ...STORE_ROUTE_FLAGS } as unknown as Env,
    body: VALID_INPUT,
  });
  assert.equal(created.response.status, 201, "Route should create a pending sandbox order when mock-authenticated and explicitly enabled.");
  assert.ok(created.json.order, "Route success payload should include an order object.");
  assert.ok(created.json.order.checkout, "Route success payload should include checkout state.");
  assert.equal(created.json.order.status, "draft");
  assert.equal(created.json.order.checkout.available, false);
  assert.equal(routeDb.operations.some((operation) => operation.type === "batch"), true);
}

async function assertCatalogSafetyBlocksProtectedOutcomes() {
  const unsafe = validCatalogRow({ grants_xp: 1 });
  const unsafeDb = new FakeD1Database(unsafe);
  const result = await createDznStoreSandboxOrder({ DB: unsafeDb, ...STORE_ROUTE_FLAGS } as unknown as Env, TEST_USER, VALID_INPUT, { hashValue });
  assert.equal(result.ok, false, "Unsafe catalog rows must be blocked server-side.");
  assert.equal(result.status, 422);
  assert.equal(result.body.error, "STORE_PRODUCT_PAID_OUTCOME_BLOCKED");
  assert.equal(unsafeDb.operations.some((operation) => operation.type === "batch"), false, "Unsafe catalog rows must not write orders.");

  for (const rowPatch of [
    { account_bound: 0 },
    { guaranteed_purchase: 0 },
    { no_competitive_advantage: 0 },
    { stripe_price_id: "pi_not_a_price" },
    { allow_pay_what_you_want: 1 },
    { min_amount_minor: 500 },
    { currency: "usd" },
  ] as const) {
    const db = new FakeD1Database(validCatalogRow(rowPatch));
    const blocked = await createDznStoreSandboxOrder({ DB: db, ...STORE_ROUTE_FLAGS } as unknown as Env, TEST_USER, VALID_INPUT, { hashValue });
    assert.equal(blocked.ok, false, `Catalog row patch ${JSON.stringify(rowPatch)} must be blocked.`);
    assert.equal(db.operations.some((operation) => operation.type === "batch"), false);
  }

  const boundPriceDb = new FakeD1Database(validCatalogRow({ stripe_price_id: "price_dzn_sandbox_founder_1000" }));
  const boundPrice = await createDznStoreSandboxOrder({ DB: boundPriceDb, ...STORE_ROUTE_FLAGS } as unknown as Env, TEST_USER, VALID_INPUT, { hashValue });
  assert.equal(boundPrice.ok, true, "A valid server-controlled Stripe Price binding can be prepared for the approved checkout-session slice.");
  if (boundPrice.ok) {
    assert.equal(JSON.stringify(boundPrice.body).includes("price_dzn_sandbox_founder_1000"), false, "Order creation response must not expose server Stripe Price bindings.");
    assert.equal(boundPrice.body.order.checkout.available, false, "Order creation must still not create checkout.");
  }

  const themeDb = new FakeD1Database(validCatalogRow());
  const badTheme = await createDznStoreSandboxOrder(
    { DB: themeDb, ...STORE_ROUTE_FLAGS } as unknown as Env,
    TEST_USER,
    { ...VALID_INPUT, supporterCardThemeKey: "not-approved" },
    { hashValue },
  );
  assert.equal(badTheme.ok, false, "Unapproved Supporter Card theme must be rejected.");
  assert.equal(badTheme.body.error, "STORE_SUPPORTER_CARD_THEME_NOT_APPROVED");
}

function assertNoForbiddenRuntimeOrProductionMutationPaths() {
  const helper = read(HELPER);
  const route = read(ROUTE);
  const combinedRuntime = `${helper}\n${route}`;

  for (const required of [
    "readDznStoreCatalogFlags",
    "DZN_STORE_SANDBOX_RUNTIME",
    "DZN_LIVE_CHECKOUT_ENABLED",
    "STORE_DISABLED",
    "STORE_CHECKOUT_DISABLED",
    "STORE_SANDBOX_CHECKOUT_DISABLED",
    "STORE_LIVE_CHECKOUT_BLOCKED",
    "INSERT INTO store_orders",
    "INSERT INTO store_order_items",
    "checkout_session_creation_requires_future_approval",
    "stripe_checkout_session_created: false",
  ]) {
    assert.equal(combinedRuntime.includes(required), true, `Runtime should include required route guard: ${required}`);
  }

  assert.equal(route.includes("getRequestSessionUser"), true, "Route should use existing DZN session auth.");
  assert.equal(route.includes("readBoundedJson"), true, "Route should keep request bodies bounded.");
  assert.equal(route.includes("createDznStoreSandboxOrder"), true, "Route should delegate guarded order writes to the helper.");

  for (const forbidden of [
    /\bcheckout\.sessions\.create\b/i,
    /\/checkout\/sessions/i,
    /\bstripeFormRequest\b/i,
    /\bverifyStripeWebhook\b/i,
    /\bSTRIPE_SECRET_KEY\b/i,
    /\bSTRIPE_WEBHOOK_SECRET\b/i,
    /\bpayment_intent\.succeeded\b/i,
    /\bcharge\.refunded\b/i,
    /\bcharge\.dispute/i,
    /\bmode\s*[:=]\s*["']payment["']/i,
    /\bfetch\s*\(/i,
    /\bstore_payment_events\b/i,
    /\baccount_entitlements\b/i,
    /\bsupporter_cards\b/i,
    /\bearned_spins\b/i,
    /\bspin_ledger\b/i,
    /\bwheel_cooldowns\b/i,
    /\bowner_billing_accounts\b/i,
    /\bowner_plan_entitlements\b/i,
    /\blinked_servers\b/i,
    /\bnitrado/i,
    /\banalytics\b/i,
    /\bgtag\b/i,
    /\bposthog\b/i,
    /\bwrangler\b/i,
    /\bissue #49\b/i,
  ]) {
    assert.doesNotMatch(combinedRuntime, forbidden, `Order route slice must not contain forbidden runtime pattern ${forbidden}.`);
  }

  for (const path of [
    "functions/api/stripe/store",
    "functions/api/supporter",
    "functions/api/wheel",
    "functions/api/billing/create-store-checkout-session.ts",
    "functions/api/billing/create-one-time-checkout-session.ts",
    "app/account/purchases/page.tsx",
    "app/purchases/page.tsx",
    "app/supporter/page.tsx",
    "app/wheel/page.tsx",
    "components/supporter",
    "components/wheel",
    "lib/supporter",
    "lib/wheel",
    "functions/_lib/supporter.ts",
    "functions/_lib/wheel.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must remain unimplemented by this order route slice.`);
  }

  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of [
      "DZN_STORE_ENABLED",
      "DZN_STORE_CHECKOUT_ENABLED",
      "DZN_STORE_SANDBOX_CHECKOUT_ENABLED",
      "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
      "DZN_SUPPORTER_CARDS_ENABLED",
      "DZN_EARNED_SPINS_ENABLED",
      "DZN_REWARD_WHEEL_ENABLED",
      "DZN_STORE_ADMIN_ENABLED",
      "DZN_STORE_LIVE_CHECKOUT_ENABLED",
      "DZN_STORE_SANDBOX_RUNTIME",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable Store sandbox order flags.`);
    }
  }

  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));
  const allowedOrderRuntime = new Set([
    HELPER,
    ROUTE,
    CATALOG_HELPER,
    STORE_WEBHOOK_ROUTE,
    STORE_WEBHOOK_HELPER,
    STORE_FULFILMENT_HELPER,
    "functions/_lib/stripe.ts",
    "functions/_lib/plans.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/create-portal-session.ts",
    "functions/api/stripe/webhook.ts",
    "functions/api/account/purchases.ts",
    "functions/_lib/dzn-store-account-purchases.ts",
    "app/store/page.tsx",
    "components/store/dzn-store-preview-page.tsx",
  ].map((path) => path.replace(/\\/g, "/")));
  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (allowedOrderRuntime.has(path)) continue;
    const source = read(path);
    assert.doesNotMatch(source, /\bINSERT\s+INTO\s+store_orders\b/i, `${path} must not write Store orders.`);
    assert.doesNotMatch(source, /\bINSERT\s+INTO\s+store_order_items\b/i, `${path} must not write Store order items.`);
    assert.doesNotMatch(source, /\bstore_payment_events\b/i, `${path} must not touch Store payment events.`);
  }
}

function assertDocsAndPackageScripts() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "DZN Store Sandbox Order Creation Route Approval",
      "`functions/api/store/orders.ts`",
      "`functions/_lib/dzn-store-orders.ts`",
      "disabled by default",
      "`DZN_STORE_SANDBOX_RUNTIME=local` or `test`",
      "It writes only `store_orders` and `store_order_items`",
      "No Stripe Checkout Session is created.",
      "No Store webhook is processed.",
      "No account entitlement is granted.",
      "No Supporter Card is issued.",
      "No earned spin is minted.",
      "No reward wheel runtime runs.",
      "No Cloudflare variables, secrets, bindings, Pages config, or Workers config are added.",
      "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
      "Issue #49 remains reserved for final live checkout activation.",
      "Next should be the DZN Store sandbox Checkout Session creation approval slice",
    ]],
    [HANDOFF, [
      "DZN Store Sandbox Order Creation Route Approval Handoff",
      "Protected OneDrive checkout was not modified.",
      "Branch: `codex/dzn-store-sandbox-order-route-approval-20260827`",
      "`POST /api/store/orders`",
      "writes pending sandbox orders only",
      "No Stripe Checkout Sessions.",
      "No Store webhooks.",
      "No entitlements.",
      "No Supporter Cards.",
      "No earned spins.",
      "No reward wheel.",
      "No production D1 write.",
      "No live checkout activation.",
      "No issue #49 change.",
    ]],
    [ORDER_LEDGER_DOC, [
      "Follow-On Order Creation Route Slice",
      "`functions/api/store/orders.ts`",
      "`functions/_lib/dzn-store-orders.ts`",
      "It writes only `store_orders` and `store_order_items`",
      "It still creates no Stripe Checkout Sessions",
    ]],
    [ORDER_LEDGER_HANDOFF, [
      "Follow-On Order Creation Route Slice",
      "`POST /api/store/orders`",
      "disabled-by-default authenticated route",
      "No checkout session is created.",
    ]],
    [CHECKOUT_PREFLIGHT, [
      "Follow-On Order Creation Route Slice",
      "`POST /api/store/orders` now creates only a pending local/sandbox order",
      "Checkout Session creation remains future-only",
    ]],
    [BACKLOG, [
      "DZN Store Sandbox Order Creation Route Approval",
      "The order route slice adds a disabled-by-default authenticated `POST /api/store/orders`",
      "It writes only pending local/test `store_orders` and `store_order_items`",
      "It creates no Stripe Checkout Session",
    ]],
    [MASTER_SPEC, [
      "DZN Store Sandbox Order Creation Route Approval Slice",
      "`POST /api/store/orders`",
      "pending local/test order ledger writes only",
      "checkout remains unavailable in the response",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store sandbox order creation route approval slice may add authenticated `POST /api/store/orders`",
      "It is not a public checkout route",
      "It must not expose raw Discord ids, Stripe ids, tax internals, or private payment state.",
    ]],
    [BILLING_PLANS, [
      "The DZN Store sandbox order creation route is separate from Starter/Pro owner subscriptions",
      "It does not create Stripe Checkout Sessions or grant owner setup access.",
      "It does not change `DZN_LIVE_CHECKOUT_ENABLED`.",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md`",
      "adds a disabled-by-default local/test pending-order route only",
      "does not approve Stripe Checkout Session creation",
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
    packageJson.scripts?.["test:dzn-store-sandbox-order-route-approval"],
    "tsx scripts/test-dzn-store-sandbox-order-route-approval.ts",
    "Focused Store sandbox order route approval test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-sandbox-order-route-approval"),
    true,
    "Full npm test should include the Store sandbox order route approval guard.",
  );
}

async function callRoute(input: { env: Env; body: unknown }) {
  const response = await storeOrdersRoute({
    request: new Request("https://dzn.test/api/store/orders", {
      method: "POST",
      body: JSON.stringify(input.body),
      headers: { "content-type": "application/json" },
    }),
    env: input.env,
    params: {},
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  } satisfies PagesContext);
  return {
    response,
    json: await response.json() as RouteJsonPayload,
  };
}

function validCatalogRow(patch: Partial<FakeCatalogRow> = {}): FakeCatalogRow {
  return {
    product_id: "prod_founder_sandbox",
    product_key: "dzn-founding-supporter-pack",
    name: "DZN FOUNDING SUPPORTER PACK",
    description: "Guaranteed account-bound supporter cosmetics only.",
    product_type: "supporter_pack",
    fulfilment_kind: "supporter_card",
    product_status: "approved",
    product_active: 1,
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
    metadata_json: JSON.stringify({
      supporterCardThemeKeys: ["signal-crown", "ember-relay", "survivor-static"],
    }),
    price_id: "price_founder_sandbox_1000",
    currency: "gbp",
    unit_amount_minor: 1000,
    min_amount_minor: null,
    allow_pay_what_you_want: 0,
    stripe_price_id: null,
    price_status: "approved",
    price_active: 1,
    effective_from: "2026-08-27T00:00:00.000Z",
    effective_to: null,
    ...patch,
  };
}

function hashValue(value: string) {
  return Promise.resolve(createHash("sha256").update(value).digest("hex"));
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

type FakeCatalogRow = {
  product_id: string;
  product_key: string;
  name: string;
  description: string;
  product_type: "supporter_pack";
  fulfilment_kind: "supporter_card";
  product_status: string;
  product_active: number;
  account_bound: number;
  guaranteed_purchase: number;
  no_competitive_advantage: number;
  grants_spins: number;
  grants_xp: number;
  grants_rank_advantage: number;
  grants_discovery_advantage: number;
  grants_review_advantage: number;
  grants_event_advantage: number;
  grants_server_wars_advantage: number;
  grants_ctf_advantage: number;
  grants_owner_subscription_access: number;
  grants_competitive_eligibility: number;
  metadata_json: string;
  price_id: string;
  currency: string;
  unit_amount_minor: number;
  min_amount_minor: number | null;
  allow_pay_what_you_want: number;
  stripe_price_id: string | null;
  price_status: string;
  price_active: number;
  effective_from: string;
  effective_to: string | null;
};

type FakeOperation =
  | { type: "first"; sql: string; bindings: unknown[]; statements: [] }
  | { type: "run"; sql: string; bindings: unknown[]; statements: [] }
  | { type: "all"; sql: string; bindings: unknown[]; statements: [] }
  | { type: "batch"; sql: ""; bindings: []; statements: Array<{ sql: string; bindings: unknown[] }> };

class FakeD1Database {
  operations: FakeOperation[] = [];

  constructor(private readonly catalogRow: FakeCatalogRow | null) {}

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]) {
    this.operations.push({
      type: "batch",
      sql: "",
      bindings: [],
      statements: statements.map((statement) => ({
        sql: statement.sql,
        bindings: statement.bindings,
      })),
    });
    return statements.map(() => ({ success: true, results: [] }));
  }

  first(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "first", sql, bindings, statements: [] });
    if (/FROM\s+store_products/i.test(sql)) return this.catalogRow;
    return null;
  }

  run(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "run", sql, bindings, statements: [] });
    return { success: true };
  }

  all(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "all", sql, bindings, statements: [] });
    return { results: [] };
  }
}

class FakeD1Statement {
  bindings: unknown[] = [];

  constructor(private readonly db: FakeD1Database, readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  async first<T>() {
    return this.db.first(this.sql, this.bindings) as T | null;
  }

  async run() {
    return this.db.run(this.sql, this.bindings);
  }

  async all<T>() {
    return this.db.all(this.sql, this.bindings) as { results: T[] };
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
