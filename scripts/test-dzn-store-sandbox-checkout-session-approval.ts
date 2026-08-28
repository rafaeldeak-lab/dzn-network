import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { onRequest as storeCheckoutRoute } from "../functions/api/store/orders/[orderId]/checkout";
import {
  canCreateDznStoreSandboxCheckoutSession,
  checkoutIdempotencyKeyFromHash,
  createDznStoreSandboxCheckoutSession,
  DZN_STORE_CHECKOUT_SESSION_BODY_LIMIT_BYTES,
  DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG,
  DZN_STORE_SANDBOX_CHECKOUT_SESSION_ROUTE,
  DZN_STORE_SANDBOX_CHECKOUT_SESSION_SCHEMA_VERSION,
  validateDznStoreSandboxCheckoutBody,
  validateDznStoreSandboxCheckoutOrderId,
  type StoreCheckoutSessionRequest,
} from "../functions/_lib/dzn-store-checkout";
import { DZN_STORE_STRIPE_PRICE_ID_PATTERN } from "../functions/_lib/dzn-store-orders";
import type { Env, PagesContext, SessionUser } from "../functions/_lib/types";

const ROUTE = "functions/api/store/orders/[orderId]/checkout.ts";
const HELPER = "functions/_lib/dzn-store-checkout.ts";
const ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const DOC = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md";
const HANDOFF = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md";
const ORDER_DOC = "docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL.md";
const ORDER_HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_CREATION_ROUTE_APPROVAL_HANDOFF.md";
const CHECKOUT_PREFLIGHT = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md";
const CHECKOUT_PREFLIGHT_HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
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

const CHECKOUT_FLAGS = {
  ...STORE_ROUTE_FLAGS,
  [DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG]: "true",
  STRIPE_SECRET_KEY: "sk_test_dzn_store_checkout_session_placeholder",
};

const TEST_USER: SessionUser = {
  id: "user_test_player_001",
  discord_id: "discord_private_123456789",
  username: "Rafael DZN",
  avatar: null,
};

const MOCK_AUTH_USER_ID = "mock-user";
const CHECKOUT_IDEMPOTENCY_HASH = createHash("sha256").update("dzn-store-order:orderid001:checkout-v1").digest("hex");

type RouteJsonPayload = Record<string, unknown> & {
  checkout_available?: unknown;
  stripe_checkout_session_created?: unknown;
  order?: {
    id?: unknown;
    status?: unknown;
    checkout?: {
      available?: unknown;
      url?: unknown;
      session_id?: unknown;
      stripe_checkout_session_created?: unknown;
      livemode?: unknown;
      mode?: unknown;
      expires_at?: unknown;
    };
  };
};

async function main() {
  assertFilesExist();
  assertConstantsAndValidation();
  assertLedgerSchemaSupportsCheckoutSession();
  await assertDefaultDisabledLocalTestOnlyAndTestSecretOnly();
  await assertRouteAuthAndBodyBoundaries();
  await assertCheckoutRequiresOwnedPendingSafeOrder();
  await assertSuccessfulTestModeCheckoutSessionWrite();
  await assertStripeSafetyFailuresDoNotUpdateOrders();
  assertNoForbiddenRuntimeOrProductionMutationPaths();
  assertDocsAndPackageScripts();
  console.log("DZN Store sandbox Checkout Session approval tests passed.");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    ORDER_HELPER,
    STRIPE_HELPER,
    STORE_ORDER_ROUTE,
    OWNER_CHECKOUT_ROUTE,
    OWNER_WEBHOOK,
    ORDER_LEDGER_MIGRATION,
    DOC,
    HANDOFF,
    ORDER_DOC,
    ORDER_HANDOFF,
    CHECKOUT_PREFLIGHT,
    CHECKOUT_PREFLIGHT_HANDOFF,
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

function assertConstantsAndValidation() {
  assert.equal(DZN_STORE_SANDBOX_CHECKOUT_SESSION_ROUTE, "/api/store/orders/:orderId/checkout");
  assert.equal(DZN_STORE_SANDBOX_CHECKOUT_SESSION_SCHEMA_VERSION, "2026-08-27.sandbox-checkout-session-v1");
  assert.equal(DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG, "DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED");
  assert.equal(DZN_STORE_CHECKOUT_SESSION_BODY_LIMIT_BYTES, 1024);
  assert.equal(DZN_STORE_STRIPE_PRICE_ID_PATTERN.test("price_dzn_sandbox_founder_1000"), true);
  assert.equal(DZN_STORE_STRIPE_PRICE_ID_PATTERN.test("pi_not_a_price"), false);

  const validOrderId = validateDznStoreSandboxCheckoutOrderId("orderid001");
  assert.equal(validOrderId.ok, true, "Valid order id should pass.");
  const invalidOrderId = validateDznStoreSandboxCheckoutOrderId("../order");
  assert.equal(invalidOrderId.ok, false, "Invalid order id should fail.");

  const validBody = validateDznStoreSandboxCheckoutBody({ returnTo: "/store?checkout=1" });
  assert.equal(validBody.ok, true, "Valid checkout body should pass.");
  if (validBody.ok) assert.equal(validBody.value.returnTo, "/store?checkout=1");

  const emptyBody = validateDznStoreSandboxCheckoutBody({});
  assert.equal(emptyBody.ok, true, "Empty checkout body should default safely.");
  if (emptyBody.ok) assert.equal(emptyBody.value.returnTo, "/store");

  for (const unsafeReturnTo of ["https://dayz-network.com/store", "//evil.example/store", "/store\r\nlocation:/evil"]) {
    const result = validateDznStoreSandboxCheckoutBody({ returnTo: unsafeReturnTo });
    assert.equal(result.ok, false, `Unsafe returnTo should be rejected: ${unsafeReturnTo}`);
    if (!result.ok) assert.equal(result.error, "INVALID_RETURN_TO");
  }

  for (const [field, value] of [
    ["user_id", "attacker"],
    ["discord_id", "123"],
    ["owner_id", "owner"],
    ["server_id", "server"],
    ["productKey", "dzn-founding-supporter-pack"],
    ["priceId", "price_founder_sandbox_1000"],
    ["stripe_price_id", "price_test_123"],
    ["stripe_customer_id", "cus_test"],
    ["stripe_checkout_session_id", "cs_test"],
    ["stripe_payment_intent_id", "pi_test"],
    ["success_url", "https://evil.example"],
    ["cancel_url", "https://evil.example"],
    ["quantity", 2],
    ["amount", 999],
    ["currency", "gbp"],
    ["livemode", true],
    ["status", "paid"],
  ] as const) {
    const result = validateDznStoreSandboxCheckoutBody({ [field]: value });
    assert.equal(result.ok, false, `Client-supplied ${field} must be rejected.`);
    if (!result.ok) assert.equal(result.error, "FORBIDDEN_CHECKOUT_FIELD");
  }

  assert.equal(checkoutIdempotencyKeyFromHash(CHECKOUT_IDEMPOTENCY_HASH), `dzn-store-sbx-${CHECKOUT_IDEMPOTENCY_HASH}`);
  assert.equal(checkoutIdempotencyKeyFromHash("not-a-hash"), null);
}

function assertLedgerSchemaSupportsCheckoutSession() {
  const migration = read(ORDER_LEDGER_MIGRATION);
  for (const snippet of [
    "'checkout_created'",
    "stripe_checkout_session_id TEXT UNIQUE",
    "stripe_payment_intent_id TEXT UNIQUE",
    "stripe_customer_ref_hash TEXT",
    "checkout_idempotency_key_hash TEXT UNIQUE",
    "checkout_session_expires_at TEXT",
  ]) {
    assert.equal(migration.includes(snippet), true, `${ORDER_LEDGER_MIGRATION} must support checkout session state: ${snippet}`);
  }
}

async function assertDefaultDisabledLocalTestOnlyAndTestSecretOnly() {
  const missingRuntime = canCreateDznStoreSandboxCheckoutSession({
    DZN_STORE_ENABLED: "true",
    DZN_STORE_CHECKOUT_ENABLED: "true",
    DZN_STORE_SANDBOX_CHECKOUT_ENABLED: "true",
    [DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG]: "true",
    STRIPE_SECRET_KEY: "sk_test_safe",
  });
  assert.equal(missingRuntime.ok, false, "Store checkout must require explicit local/test runtime.");
  if (!missingRuntime.ok) assert.equal(missingRuntime.code, "STORE_SANDBOX_RUNTIME_REQUIRED");

  const disabledDb = new FakeD1Database(validOrderRow());
  const disabledStripe = fakeStripeRecorder();
  const disabled = await createDznStoreSandboxCheckoutSession(
    { DB: disabledDb, DZN_STORE_SANDBOX_RUNTIME: "local" } as unknown as Env,
    TEST_USER,
    { orderId: "orderid001", returnTo: "/store" },
    { request: testRequest(), requestStripeCheckoutSession: disabledStripe.request },
  );
  assert.equal(disabled.ok, false, "Store checkout must be disabled by default.");
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.error, "STORE_DISABLED");
  assert.equal(disabledDb.operations.length, 0, "Disabled checkout route must block before D1 access.");
  assert.equal(disabledStripe.calls.length, 0, "Disabled checkout route must block before Stripe access.");

  const missingSessionFlagDb = new FakeD1Database(validOrderRow());
  const missingSessionFlagStripe = fakeStripeRecorder();
  const missingSessionFlag = await createDznStoreSandboxCheckoutSession(
    { DB: missingSessionFlagDb, ...STORE_ROUTE_FLAGS, STRIPE_SECRET_KEY: "sk_test_safe" } as unknown as Env,
    TEST_USER,
    { orderId: "orderid001", returnTo: "/store" },
    { request: testRequest(), requestStripeCheckoutSession: missingSessionFlagStripe.request },
  );
  assert.equal(missingSessionFlag.ok, false, "Checkout Session creation must require its own explicit flag.");
  assert.equal(missingSessionFlag.body.error, "STORE_SANDBOX_CHECKOUT_SESSION_DISABLED");
  assert.equal(missingSessionFlagDb.operations.length, 0, "Missing checkout-session flag must block before D1.");
  assert.equal(missingSessionFlagStripe.calls.length, 0, "Missing checkout-session flag must block before Stripe.");

  for (const stripeSecret of [undefined, "", "sk_live_forbidden", "rk_test_restricted"] as const) {
    const db = new FakeD1Database(validOrderRow());
    const stripe = fakeStripeRecorder();
    const result = await createDznStoreSandboxCheckoutSession(
      { DB: db, ...STORE_ROUTE_FLAGS, [DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG]: "true", STRIPE_SECRET_KEY: stripeSecret } as unknown as Env,
      TEST_USER,
      { orderId: "orderid001", returnTo: "/store" },
      { request: testRequest(), requestStripeCheckoutSession: stripe.request },
    );
    assert.equal(result.ok, false, `Secret ${stripeSecret ?? "<missing>"} must not create checkout.`);
    assert.equal(result.body.error, "STORE_STRIPE_TEST_SECRET_REQUIRED");
    assert.equal(db.operations.length, 0, "Invalid Stripe secret must block before D1.");
    assert.equal(stripe.calls.length, 0, "Invalid Stripe secret must block before Stripe.");
  }

  for (const liveFlag of ["DZN_STORE_LIVE_CHECKOUT_ENABLED", "DZN_LIVE_CHECKOUT_ENABLED"] as const) {
    const db = new FakeD1Database(validOrderRow());
    const stripe = fakeStripeRecorder();
    const result = await createDznStoreSandboxCheckoutSession(
      { DB: db, ...CHECKOUT_FLAGS, [liveFlag]: "true" } as unknown as Env,
      TEST_USER,
      { orderId: "orderid001", returnTo: "/store" },
      { request: testRequest(), requestStripeCheckoutSession: stripe.request },
    );
    assert.equal(result.ok, false, `${liveFlag}=true must block sandbox Store checkout.`);
    assert.equal(result.body.error, "STORE_LIVE_CHECKOUT_BLOCKED");
    assert.equal(db.operations.length, 0, `${liveFlag}=true must block before D1.`);
    assert.equal(stripe.calls.length, 0, `${liveFlag}=true must block before Stripe.`);
  }

  for (const enabledRuntimeFlag of [
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "DZN_SUPPORTER_CARDS_ENABLED",
    "DZN_EARNED_SPINS_ENABLED",
    "DZN_REWARD_WHEEL_ENABLED",
  ] as const) {
    const db = new FakeD1Database(validOrderRow());
    const stripe = fakeStripeRecorder();
    const result = await createDznStoreSandboxCheckoutSession(
      { DB: db, ...CHECKOUT_FLAGS, [enabledRuntimeFlag]: "true" } as unknown as Env,
      TEST_USER,
      { orderId: "orderid001", returnTo: "/store" },
      { request: testRequest(), requestStripeCheckoutSession: stripe.request },
    );
    assert.equal(result.ok, false, `${enabledRuntimeFlag}=true must be out of scope.`);
    assert.equal(db.operations.length, 0, `${enabledRuntimeFlag}=true must block before D1.`);
    assert.equal(stripe.calls.length, 0, `${enabledRuntimeFlag}=true must block before Stripe.`);
  }
}

async function assertRouteAuthAndBodyBoundaries() {
  const unauthDb = new FakeD1Database(validOrderRow({ purchasing_user_id: MOCK_AUTH_USER_ID }));
  const unauthenticated = await callRoute({
    env: { DB: unauthDb, ...CHECKOUT_FLAGS } as unknown as Env,
    orderId: "orderid001",
    body: {},
  });
  assert.equal(unauthenticated.response.status, 401, "Route must require an authenticated DZN player.");
  assert.equal(unauthDb.operations.length, 0, "Unauthenticated route must not touch D1.");
  assert.equal(unauthenticated.json.checkout_available, false);

  const method = await storeCheckoutRoute({
    request: new Request("https://dzn.test/api/store/orders/orderid001/checkout", { method: "GET" }),
    env: { MOCK_AUTH: "true", ...CHECKOUT_FLAGS, DB: new FakeD1Database(validOrderRow({ purchasing_user_id: MOCK_AUTH_USER_ID })) } as unknown as Env,
    params: { orderId: "orderid001" },
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  } satisfies PagesContext);
  assert.equal(method.status, 405, "Only POST should be accepted.");

  const invalidParam = await callRoute({
    env: { MOCK_AUTH: "true", DB: new FakeD1Database(validOrderRow({ purchasing_user_id: MOCK_AUTH_USER_ID })), ...CHECKOUT_FLAGS } as unknown as Env,
    orderId: "../bad",
    body: {},
  });
  assert.equal(invalidParam.response.status, 400, "Invalid order id params must be rejected.");
  assert.equal(invalidParam.json.stripe_checkout_session_created, false);

  const tooLarge = await storeCheckoutRoute({
    request: new Request("https://dzn.test/api/store/orders/orderid001/checkout", {
      method: "POST",
      body: JSON.stringify({ returnTo: `/${"x".repeat(DZN_STORE_CHECKOUT_SESSION_BODY_LIMIT_BYTES)}` }),
      headers: { "content-type": "application/json" },
    }),
    env: { MOCK_AUTH: "true", ...CHECKOUT_FLAGS, DB: new FakeD1Database(validOrderRow({ purchasing_user_id: MOCK_AUTH_USER_ID })) } as unknown as Env,
    params: { orderId: "orderid001" },
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  } satisfies PagesContext);
  assert.equal(tooLarge.status, 413, "Oversized checkout bodies must be rejected.");

  const forbiddenBody = await callRoute({
    env: { MOCK_AUTH: "true", DB: new FakeD1Database(validOrderRow({ purchasing_user_id: MOCK_AUTH_USER_ID })), ...CHECKOUT_FLAGS } as unknown as Env,
    orderId: "orderid001",
    body: { priceId: "attacker-price" },
  });
  assert.equal(forbiddenBody.response.status, 400, "Client price authority must be rejected by the route.");
  assert.equal(forbiddenBody.json.stripe_checkout_session_created, false);
}

async function assertCheckoutRequiresOwnedPendingSafeOrder() {
  const missingDb = new FakeD1Database(null);
  const missingStripe = fakeStripeRecorder();
  const missing = await createDznStoreSandboxCheckoutSession(
    { DB: missingDb, ...CHECKOUT_FLAGS } as unknown as Env,
    TEST_USER,
    { orderId: "orderid001", returnTo: "/store" },
    { request: testRequest(), requestStripeCheckoutSession: missingStripe.request },
  );
  assert.equal(missing.status, 404, "Missing or cross-user orders should return 404.");
  assert.equal(missingStripe.calls.length, 0, "Missing orders must not call Stripe.");

  const crossUserDb = new FakeD1Database(validOrderRow({ purchasing_user_id: "other_user" }));
  const crossUserStripe = fakeStripeRecorder();
  const crossUser = await createDznStoreSandboxCheckoutSession(
    { DB: crossUserDb, ...CHECKOUT_FLAGS } as unknown as Env,
    TEST_USER,
    { orderId: "orderid001", returnTo: "/store" },
    { request: testRequest(), requestStripeCheckoutSession: crossUserStripe.request },
  );
  assert.equal(crossUser.status, 404, "Cross-user order ids must not reveal private order state.");
  assert.equal(crossUserStripe.calls.length, 0, "Cross-user orders must not call Stripe.");

  for (const rowPatch of [
    { status: "checkout_created" },
    { stripe_checkout_session_id: "cs_test_existing" },
    { ledger_scope: "production" },
    { livemode: 1 },
    { product_count: 2 },
    { quantity: 2 },
    { currency: "usd" },
    { tax_amount_minor: 100, total_amount_minor: 1100 },
    { price_status: "draft" },
    { price_active: 0 },
    { stripe_price_id: null },
    { stripe_price_id: "pi_not_a_price" },
    { account_bound: 0 },
    { guaranteed_purchase: 0 },
    { no_competitive_advantage: 0 },
    { grants_spins: 1 },
    { grants_xp: 1 },
    { grants_rank_advantage: 1 },
    { grants_discovery_advantage: 1 },
    { grants_review_advantage: 1 },
    { grants_event_advantage: 1 },
    { grants_server_wars_advantage: 1 },
    { grants_ctf_advantage: 1 },
    { grants_owner_subscription_access: 1 },
    { grants_competitive_eligibility: 1 },
    { checkout_idempotency_key_hash: "bad" },
  ] as const) {
    const db = new FakeD1Database(validOrderRow(rowPatch));
    const stripe = fakeStripeRecorder();
    const result = await createDznStoreSandboxCheckoutSession(
      { DB: db, ...CHECKOUT_FLAGS } as unknown as Env,
      TEST_USER,
      { orderId: "orderid001", returnTo: "/store" },
      { request: testRequest(), requestStripeCheckoutSession: stripe.request },
    );
    assert.equal(result.ok, false, `Unsafe row patch ${JSON.stringify(rowPatch)} must be rejected.`);
    assert.equal(stripe.calls.length, 0, `Unsafe row patch ${JSON.stringify(rowPatch)} must not call Stripe.`);
    assert.equal(db.operations.some((operation) => operation.type === "run"), false, `Unsafe row patch ${JSON.stringify(rowPatch)} must not update order.`);
  }
}

async function assertSuccessfulTestModeCheckoutSessionWrite() {
  const db = new FakeD1Database(validOrderRow());
  const stripe = fakeStripeRecorder();
  const result = await createDznStoreSandboxCheckoutSession(
    { DB: db, ...CHECKOUT_FLAGS, DZN_APP_URL: "https://dzn.test" } as unknown as Env,
    TEST_USER,
    { orderId: "orderid001", returnTo: "/store?from=preview" },
    {
      request: testRequest(),
      now: new Date("2026-08-27T14:00:00.000Z"),
      requestStripeCheckoutSession: stripe.request,
      hashValue,
    },
  );

  assert.equal(result.ok, true, "A safe pending local/test order should create one test-mode Checkout Session.");
  assert.equal(result.status, 200);
  assert.equal(result.body.order.status, "checkout_created");
  assert.equal(result.body.order.ledger_scope, "local");
  assert.equal(result.body.order.livemode, false);
  assert.equal(result.body.order.checkout.available, true);
  assert.equal(result.body.order.checkout.url, "https://checkout.stripe.com/c/pay/cs_test_store_orderid001");
  assert.equal(result.body.order.checkout.session_id, null, "Route must not expose raw Checkout Session id as a field.");
  assert.equal(result.body.order.checkout.stripe_checkout_session_created, true);
  assert.equal(result.body.order.checkout.livemode, false);
  assert.equal(result.body.order.checkout.mode, "payment");
  assert.equal(result.body.order.checkout.expires_at, "2026-08-27T15:00:00.000Z");
  assert.equal(result.body.next_step, "redirect_to_test_mode_stripe_checkout");
  assert.deepEqual(result.body.order.safety, {
    account_bound: true,
    guaranteed_purchase: true,
    no_competitive_advantage: true,
    grants_spins: false,
    grants_xp: false,
    grants_owner_subscription_access: false,
    grants_competitive_eligibility: false,
  });

  assert.equal(stripe.calls.length, 1, "Exactly one Stripe Checkout Session request should be made.");
  const call = stripe.calls[0];
  assert.equal(call.path, "/checkout/sessions");
  assert.equal(call.params.mode, "payment");
  assert.equal(call.params["line_items[0][price]"], "price_dzn_sandbox_founder_1000");
  assert.equal(call.params["line_items[0][quantity]"], 1);
  assert.equal(call.params.client_reference_id, "orderid001");
  assert.equal(call.params.allow_promotion_codes, false);
  assert.equal(call.params.success_url, "https://dzn.test/store?from=preview&store_checkout=success&order=orderid001");
  assert.equal(call.params.cancel_url, "https://dzn.test/store?from=preview&store_checkout=cancelled&order=orderid001");
  assert.equal(call.params["metadata[dzn_context]"], "dzn_store_sandbox");
  assert.equal(call.params["metadata[dzn_order_id]"], "orderid001");
  assert.equal(call.params["metadata[dzn_product_key]"], "dzn-founding-supporter-pack");
  assert.equal(call.params["payment_intent_data[metadata][dzn_context]"], "dzn_store_sandbox");
  assert.equal(call.options.idempotencyKey, `dzn-store-sbx-${CHECKOUT_IDEMPOTENCY_HASH}`);
  assert.doesNotMatch(JSON.stringify(call), /discord_private_123456789|Rafael DZN|cus_test_customer_001/i, "Stripe request metadata and idempotency must not contain raw private identity or customer data.");

  const lookup = db.operations.find((operation) => operation.type === "first");
  assert.ok(lookup, "Checkout should read one owned pending order.");
  assert.match(lookup.sql, /FROM store_orders/i);
  assert.match(lookup.sql, /INNER JOIN store_order_items/i);
  assert.match(lookup.sql, /INNER JOIN store_prices/i);
  assert.deepEqual(lookup.bindings, ["orderid001", TEST_USER.id]);

  const update = db.operations.find((operation) => operation.type === "run");
  assert.ok(update, "Checkout should update only the Store order header.");
  assert.match(update.sql, /UPDATE store_orders/i);
  assert.doesNotMatch(update.sql, /INSERT\s+INTO|DELETE\s+FROM|store_payment_events|account_entitlements|supporter_cards|earned_spins|spin_ledger|wheel_cooldowns/i);
  assert.equal(update.bindings[0], "cs_test_store_orderid001");
  assert.equal(update.bindings[1], "pi_test_store_orderid001");
  assert.match(String(update.bindings[2]), /^[a-f0-9]{64}$/, "Stripe customer must be stored as a hash, not as a raw customer id.");
  assert.equal(update.bindings[3], "2026-08-27T15:00:00.000Z");
  assert.equal(update.bindings[5], "2026-08-27T14:00:00.000Z");
  assert.equal(update.bindings[6], "orderid001");
  assert.equal(update.bindings[7], TEST_USER.id);
  assert.doesNotMatch(JSON.stringify(update.bindings), /cus_test_customer_001|discord_private_123456789/i, "Checkout update must not store raw customer or Discord ids.");

  const flags = JSON.parse(String(update.bindings[4])) as Record<string, unknown>;
  assert.equal(flags.schema_version, DZN_STORE_SANDBOX_CHECKOUT_SESSION_SCHEMA_VERSION);
  assert.equal(flags.route, DZN_STORE_SANDBOX_CHECKOUT_SESSION_ROUTE);
  assert.equal(flags.sandbox_checkout_session_enabled, true);
  assert.equal(flags.store_live_checkout_enabled, false);
  assert.equal(flags.owner_live_checkout_enabled, false);
  assert.equal(flags.webhook_fulfilment_enabled, false);
  assert.equal(flags.supporter_cards_enabled, false);
  assert.equal(flags.earned_spins_enabled, false);
  assert.equal(flags.reward_wheel_enabled, false);
  assert.equal(flags.stripe_secret_mode, "test");
  assert.equal(flags.entitlement_write_attempted, false);
  assert.equal(flags.supporter_card_write_attempted, false);
  assert.equal(flags.earned_spin_write_attempted, false);
  assert.equal(flags.wheel_runtime_attempted, false);

  const serializedResponse = JSON.stringify(result.body);
  assert.doesNotMatch(serializedResponse, /discord_private_123456789|user_test_player_001|cus_test_customer_001|pi_test_store_orderid001/i, "Response must not expose raw private identifiers or payment refs.");
}

async function assertStripeSafetyFailuresDoNotUpdateOrders() {
  for (const [description, sessionPatch, expectedError] of [
    ["live session id", { id: "cs_live_forbidden", livemode: false, mode: "payment", url: "https://checkout.stripe.com/c/pay/cs_live_forbidden" }, "STORE_STRIPE_SESSION_NOT_TEST_MODE"],
    ["live mode true", { livemode: true }, "STORE_STRIPE_SESSION_LIVE_MODE_BLOCKED"],
    ["subscription mode", { mode: "subscription" }, "STORE_STRIPE_SESSION_MODE_INVALID"],
    ["missing url", { url: null }, "STORE_STRIPE_SESSION_URL_MISSING"],
  ] as const) {
    const db = new FakeD1Database(validOrderRow());
    const stripe = fakeStripeRecorder(sessionPatch);
    const result = await createDznStoreSandboxCheckoutSession(
      { DB: db, ...CHECKOUT_FLAGS } as unknown as Env,
      TEST_USER,
      { orderId: "orderid001", returnTo: "/store" },
      { request: testRequest(), requestStripeCheckoutSession: stripe.request },
    );
    assert.equal(result.ok, false, `${description} should fail.`);
    assert.equal(result.body.error, expectedError);
    assert.equal(db.operations.some((operation) => operation.type === "run"), false, `${description} must not update Store orders.`);
  }
}

function assertNoForbiddenRuntimeOrProductionMutationPaths() {
  const route = read(ROUTE);
  const helper = read(HELPER);
  const orderHelper = read(ORDER_HELPER);
  const stripeHelper = read(STRIPE_HELPER);
  const combinedCheckoutRuntime = `${route}\n${helper}`;

  for (const required of [
    "DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED",
    "STRIPE_SECRET_KEY",
    "sk_test_",
    "/checkout/sessions",
    "mode: \"payment\"",
    "stripeFormRequest<StripeCheckoutSession>",
    "idempotencyKey",
    "UPDATE store_orders",
    "stripe_checkout_session_id",
    "stripe_payment_intent_id",
    "stripe_customer_ref_hash",
    "session_id: null",
    "redirect_to_test_mode_stripe_checkout",
  ]) {
    assert.equal(combinedCheckoutRuntime.includes(required), true, `Checkout runtime should include required guard/path: ${required}`);
  }

  assert.equal(route.includes("getRequestSessionUser"), true, "Route should use existing DZN session auth.");
  assert.equal(route.includes("readBoundedJson"), true, "Route should keep request bodies bounded.");
  assert.equal(route.includes("createDznStoreSandboxCheckoutSession"), true, "Route should delegate guarded checkout work to the helper.");
  assert.equal(stripeHelper.includes('"idempotency-key": options.idempotencyKey'), true, "Stripe helper must support order-derived idempotency.");
  assert.equal(orderHelper.includes("DZN_STORE_STRIPE_PRICE_ID_PATTERN"), true, "Order helper should validate server-side Stripe Price bindings.");
  assert.equal(orderHelper.includes("STORE_STRIPE_PRICE_BINDING_BLOCKED_IN_ORDER_SLICE"), false, "Order creation should no longer categorically block server-side test Price bindings.");
  assert.equal(OWNER_CHECKOUT_ROUTE.includes("noop"), false, "Sanity check path string should not be evaluated as source.");

  for (const forbidden of [
    /\bverifyStripeWebhook\b/i,
    /\bSTRIPE_WEBHOOK_SECRET\b/i,
    /\bpayment_intent\.succeeded\b/i,
    /\bcharge\.refunded\b/i,
    /\bcharge\.dispute/i,
    /\bINSERT\s+INTO\s+store_payment_events\b/i,
    /\bstore_payment_events\b/i,
    /\bINSERT\s+INTO\s+account_entitlements\b/i,
    /\bUPDATE\s+account_entitlements\b/i,
    /\baccount_entitlements\b/i,
    /\bINSERT\s+INTO\s+supporter_cards\b/i,
    /\bUPDATE\s+supporter_cards\b/i,
    /\bsupporter_cards\b/i,
    /\bINSERT\s+INTO\s+earned_spins\b/i,
    /\bearned_spins\b/i,
    /\bINSERT\s+INTO\s+spin_ledger\b/i,
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
    assert.doesNotMatch(combinedCheckoutRuntime, forbidden, `Checkout Session slice must not contain forbidden runtime pattern ${forbidden}.`);
  }

  for (const path of [
    "functions/api/stripe/store-webhook.ts",
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
    assert.equal(existsSync(path), false, `${path} must remain unimplemented by this checkout slice.`);
  }

  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of [
      "DZN_STORE_ENABLED",
      "DZN_STORE_CHECKOUT_ENABLED",
      "DZN_STORE_SANDBOX_CHECKOUT_ENABLED",
      "DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED",
      "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
      "DZN_SUPPORTER_CARDS_ENABLED",
      "DZN_EARNED_SPINS_ENABLED",
      "DZN_REWARD_WHEEL_ENABLED",
      "DZN_STORE_ADMIN_ENABLED",
      "DZN_STORE_LIVE_CHECKOUT_ENABLED",
      "DZN_STORE_SANDBOX_RUNTIME",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable Store sandbox checkout flags.`);
    }
  }

  const ownerCheckout = read(OWNER_CHECKOUT_ROUTE);
  assert.equal(ownerCheckout.includes('mode: "subscription"'), true, "Owner checkout must remain subscription mode.");
  assert.equal(ownerCheckout.includes('mode: "payment"'), false, "Store payment mode must not be added to owner subscription checkout.");

  const ownerWebhook = read(OWNER_WEBHOOK);
  assert.equal(ownerWebhook.includes("checkout.session.completed"), true, "Existing owner webhook must remain subscription-oriented.");
  for (const table of ["store_orders", "store_order_items", "store_payment_events", "account_entitlements", "supporter_cards", "earned_spins", "spin_ledger", "wheel_cooldowns"]) {
    assert.equal(ownerWebhook.includes(table), false, `Owner webhook must not touch Store table ${table}.`);
  }

  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));
  const allowedCheckoutRuntime = new Set([
    ROUTE,
    HELPER,
    ORDER_HELPER,
    STORE_ORDER_ROUTE,
    STRIPE_HELPER,
    "functions/_lib/plans.ts",
    "functions/_lib/dzn-store-catalog.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/create-portal-session.ts",
    "functions/api/stripe/webhook.ts",
    "app/store/page.tsx",
    "components/store/dzn-store-preview-page.tsx",
  ].map((path) => path.replace(/\\/g, "/")));
  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (allowedCheckoutRuntime.has(path)) continue;
    const source = read(path);
    assert.doesNotMatch(source, /\bINSERT\s+INTO\s+store_orders\b/i, `${path} must not write Store orders.`);
    assert.doesNotMatch(source, /\bUPDATE\s+store_orders\b/i, `${path} must not update Store orders.`);
    assert.doesNotMatch(source, /\bstore_payment_events\b/i, `${path} must not touch Store payment events.`);
    assert.doesNotMatch(source, /\/checkout\/sessions/i, `${path} must not create Store Checkout Sessions.`);
  }
}

function assertDocsAndPackageScripts() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "DZN Store Sandbox Checkout Session Approval",
      "`functions/api/store/orders/[orderId]/checkout.ts`",
      "`functions/_lib/dzn-store-checkout.ts`",
      "`POST /api/store/orders/:orderId/checkout`",
      "disabled by default",
      "`DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED=true`",
      "`STRIPE_SECRET_KEY` must be a test-mode key beginning with `sk_test_`",
      "uses a server-controlled `store_prices.stripe_price_id`",
      "uses a Stripe idempotency key derived from `store_orders.checkout_idempotency_key_hash`",
      "updates only `store_orders` to `checkout_created`",
      "No Store webhook is processed.",
      "No `store_payment_events` row is written.",
      "No account entitlement is granted.",
      "No Supporter Card is issued.",
      "No earned spin is minted.",
      "No reward wheel runtime runs.",
      "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
      "Issue #49 remains reserved for final live checkout activation.",
      "Next should be the DZN Store sandbox webhook event ledger receipt slice only if deliberately approved",
    ]],
    [HANDOFF, [
      "DZN Store Sandbox Checkout Session Approval Handoff",
      "Protected OneDrive checkout was not modified.",
      "Branch: `codex/dzn-store-sandbox-checkout-session-approval-20260827`",
      "`POST /api/store/orders/:orderId/checkout`",
      "test-mode only",
      "No Store webhooks.",
      "No entitlements.",
      "No Supporter Cards.",
      "No earned spins.",
      "No reward wheel.",
      "No production D1 write.",
      "No live checkout activation.",
      "No issue #49 change.",
    ]],
    [ORDER_DOC, [
      "Follow-On Checkout Session Slice",
      "`POST /api/store/orders/:orderId/checkout`",
      "valid server-side `store_prices.stripe_price_id` is allowed",
      "order creation still creates no Stripe Checkout Session",
    ]],
    [ORDER_HANDOFF, [
      "Follow-On Checkout Session Slice",
      "`functions/api/store/orders/[orderId]/checkout.ts`",
      "`functions/_lib/dzn-store-checkout.ts`",
      "test-mode Stripe Checkout Session only after an owned draft order exists",
    ]],
    [CHECKOUT_PREFLIGHT, [
      "Follow-On Checkout Session Slice",
      "`POST /api/store/orders/:orderId/checkout`",
      "test-mode only Stripe Checkout Session creation",
      "no webhook fulfilment, entitlements, Supporter Cards, earned spins, wheel runtime",
    ]],
    [CHECKOUT_PREFLIGHT_HANDOFF, [
      "Follow-On Checkout Session Slice Delivered",
      "`POST /api/store/orders/:orderId/checkout`",
      "test-mode Checkout Session",
    ]],
    [SAFE_PREFLIGHT, [
      "DZN Store sandbox Checkout Session approval slice",
      "`docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`",
      "test-mode only Checkout Session creation",
      "no Store webhook fulfilment, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout activation, or issue #49 change",
    ]],
    [BACKLOG, [
      "DZN Store Sandbox Checkout Session Approval",
      "`docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`",
      "creates a test-mode only Stripe Checkout Session after a pending local/test order exists",
      "It creates no Store webhook fulfilment, entitlements, Supporter Cards, earned spins, wheel runtime, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change.",
    ]],
    [MASTER_SPEC, [
      "DZN Store Sandbox Checkout Session Approval Slice",
      "`POST /api/store/orders/:orderId/checkout`",
      "test-mode Stripe Checkout Session only",
      "Success redirects still do not fulfil purchases.",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store sandbox Checkout Session approval slice may add authenticated `POST /api/store/orders/:orderId/checkout`",
      "It is private to the purchasing logged-in player",
      "It must not expose raw Discord ids, Stripe customer ids, PaymentIntent ids, webhook event ids, private payment state, or tax internals.",
    ]],
    [BILLING_PLANS, [
      "The DZN Store sandbox Checkout Session route remains separate from Starter/Pro owner subscriptions",
      "`POST /api/store/orders/:orderId/checkout`",
      "test-mode Stripe Checkout Session only",
      "It does not change `DZN_LIVE_CHECKOUT_ENABLED`.",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md`",
      "adds a disabled-by-default test-mode Store Checkout Session route only",
      "does not approve Store webhook fulfilment, entitlement writes, Supporter Card issuance, earned spins, reward wheel runtime, production D1 writes, live checkout activation, or issue #49 changes",
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
    packageJson.scripts?.["test:dzn-store-sandbox-checkout-session-approval"],
    "tsx scripts/test-dzn-store-sandbox-checkout-session-approval.ts",
    "Focused Store sandbox Checkout Session approval test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-sandbox-checkout-session-approval"),
    true,
    "Full npm test should include the Store sandbox Checkout Session approval guard.",
  );
}

async function callRoute(input: { env: Env; orderId: string; body: unknown }) {
  const response = await storeCheckoutRoute({
    request: new Request(`https://dzn.test/api/store/orders/${encodeURIComponent(input.orderId)}/checkout`, {
      method: "POST",
      body: JSON.stringify(input.body),
      headers: { "content-type": "application/json" },
    }),
    env: input.env,
    params: { orderId: input.orderId },
    waitUntil() {},
    next: async () => new Response(null, { status: 404 }),
    data: {},
  } satisfies PagesContext);
  return {
    response,
    json: await response.json() as RouteJsonPayload,
  };
}

function fakeStripeRecorder(sessionPatch: Partial<FakeStripeSession> = {}) {
  const calls: Array<{
    path: string;
    params: Record<string, string | number | boolean | null | undefined>;
    options: { idempotencyKey: string };
  }> = [];

  const request: StoreCheckoutSessionRequest = async (_env, path, params, options) => {
    calls.push({ path, params, options });
    return {
      id: "cs_test_store_orderid001",
      url: "https://checkout.stripe.com/c/pay/cs_test_store_orderid001",
      livemode: false,
      mode: "payment",
      payment_intent: "pi_test_store_orderid001",
      customer: "cus_test_customer_001",
      expires_at: 1787842800,
      metadata: {
        dzn_context: "dzn_store_sandbox",
      },
      ...sessionPatch,
    };
  };

  return { calls, request };
}

function validOrderRow(patch: Partial<FakeOrderRow> = {}): FakeOrderRow {
  return {
    order_id: "orderid001",
    order_number: "DZN-STORE-20260827-ORDERID001",
    purchasing_user_id: TEST_USER.id,
    status: "draft",
    ledger_scope: "local",
    livemode: 0,
    product_count: 1,
    currency: "gbp",
    subtotal_amount_minor: 1000,
    tax_amount_minor: 0,
    total_amount_minor: 1000,
    selected_theme_key: "signal-crown",
    checkout_idempotency_key_hash: CHECKOUT_IDEMPOTENCY_HASH,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    stripe_customer_ref_hash: null,
    product_id: "prod_founder_sandbox",
    price_id: "price_founder_sandbox_1000",
    product_key: "dzn-founding-supporter-pack",
    product_name_snapshot: "DZN FOUNDING SUPPORTER PACK",
    product_type: "supporter_pack",
    fulfilment_kind: "supporter_card",
    quantity: 1,
    item_currency: "gbp",
    unit_amount_minor: 1000,
    item_tax_amount_minor: 0,
    item_total_amount_minor: 1000,
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
    stripe_price_id: "price_dzn_sandbox_founder_1000",
    price_status: "approved",
    price_active: 1,
    ...patch,
  };
}

function testRequest() {
  return new Request("https://dzn.test/api/store/orders/orderid001/checkout", { method: "POST" });
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

type FakeStripeSession = {
  id: string;
  url: string | null;
  livemode: boolean;
  mode: string;
  payment_intent: string | null;
  customer: string | null;
  expires_at: number;
  metadata: Record<string, string>;
};

type FakeOrderRow = {
  order_id: string;
  order_number: string;
  purchasing_user_id: string;
  status: string;
  ledger_scope: string;
  livemode: number;
  product_count: number;
  currency: string;
  subtotal_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  selected_theme_key: string | null;
  checkout_idempotency_key_hash: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_customer_ref_hash: string | null;
  product_id: string;
  price_id: string;
  product_key: string;
  product_name_snapshot: string;
  product_type: string;
  fulfilment_kind: string;
  quantity: number;
  item_currency: string;
  unit_amount_minor: number;
  item_tax_amount_minor: number;
  item_total_amount_minor: number;
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
  stripe_price_id: string | null;
  price_status: string;
  price_active: number;
};

type FakeOperation =
  | { type: "first"; sql: string; bindings: unknown[] }
  | { type: "run"; sql: string; bindings: unknown[] };

class FakeD1Database {
  operations: FakeOperation[] = [];

  constructor(private readonly orderRow: FakeOrderRow | null, private readonly updateChanges = 1) {}

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  first(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "first", sql, bindings });
    if (!/FROM\s+store_orders/i.test(sql)) return null;
    if (!this.orderRow) return null;
    return this.orderRow.order_id === bindings[0] && this.orderRow.purchasing_user_id === bindings[1]
      ? this.orderRow
      : null;
  }

  run(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "run", sql, bindings });
    let changes = 0;
    if (
      /UPDATE\s+store_orders/i.test(sql) &&
      this.orderRow &&
      this.orderRow.order_id === bindings[6] &&
      this.orderRow.purchasing_user_id === bindings[7] &&
      this.orderRow.status === "draft" &&
      Number(this.orderRow.livemode) === 0 &&
      !this.orderRow.stripe_checkout_session_id
    ) {
      changes = this.updateChanges;
      if (changes === 1) {
        this.orderRow.status = "checkout_created";
        this.orderRow.stripe_checkout_session_id = String(bindings[0]);
        this.orderRow.stripe_payment_intent_id = typeof bindings[1] === "string" ? bindings[1] : null;
        this.orderRow.stripe_customer_ref_hash = typeof bindings[2] === "string" ? bindings[2] : null;
      }
    }
    return { success: true, meta: { changes } };
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
