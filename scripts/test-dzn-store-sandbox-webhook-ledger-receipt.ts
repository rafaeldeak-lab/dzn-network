import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { onRequest as storeWebhookRoute } from "../functions/api/stripe/store-webhook";
import {
  canReceiveDznStoreSandboxWebhookReceipt,
  DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG,
  DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE,
  DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
  receiveDznStoreSandboxWebhookReceipt,
} from "../functions/_lib/dzn-store-webhook";
import type { Env, PagesContext } from "../functions/_lib/types";

const ROUTE = "functions/api/stripe/store-webhook.ts";
const HELPER = "functions/_lib/dzn-store-webhook.ts";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const CHECKOUT_HELPER = "functions/_lib/dzn-store-checkout.ts";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const DOC = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md";
const HANDOFF = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const CHECKOUT_SESSION_DOC = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md";
const CHECKOUT_SESSION_HANDOFF = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md";
const PACKAGE_JSON = "package.json";

const WEBHOOK_SECRET = "whsec_dznstorewebhookreceipt0000000001";

const STORE_WEBHOOK_FLAGS = {
  DZN_STORE_SANDBOX_RUNTIME: "local",
  DZN_STORE_ENABLED: "true",
  DZN_STORE_CHECKOUT_ENABLED: "true",
  DZN_STORE_SANDBOX_CHECKOUT_ENABLED: "true",
  [DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG]: "true",
  DZN_STORE_LIVE_CHECKOUT_ENABLED: "false",
  DZN_STORE_WEBHOOK_FULFILMENT_ENABLED: "false",
  DZN_SUPPORTER_CARDS_ENABLED: "false",
  DZN_EARNED_SPINS_ENABLED: "false",
  DZN_REWARD_WHEEL_ENABLED: "false",
  DZN_LIVE_CHECKOUT_ENABLED: "false",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

type RouteJsonPayload = Record<string, unknown> & {
  receipt?: Record<string, unknown>;
  safety?: Record<string, unknown>;
};

async function main() {
  assertConstants();
  assertFilesExist();
  await assertDisabledByDefault();
  await assertFulfilmentAndLiveFlagsBlockReceipt();
  await assertWebhookSecretRequired();
  await assertInvalidSignatureRejected();
  await assertRecordsSanitizedCheckoutReceipt();
  await assertDuplicateEventsAreReceiptOnly();
  await assertLiveModeEventsAreBlocked();
  await assertClassifiesReceiptEventFamilies();
  assertNoForbiddenRuntimeOrProductionMutationPaths();
  assertDocsAndPackageScripts();
  console.log("DZN Store sandbox webhook event ledger receipt tests passed.");
}

function assertConstants() {
  assert.equal(DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE, "/api/stripe/store-webhook");
  assert.equal(DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION, "2026-08-28.sandbox-webhook-receipt-v1");
  assert.equal(DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG, "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    STRIPE_HELPER,
    OWNER_WEBHOOK,
    ORDER_HELPER,
    CHECKOUT_HELPER,
    ORDER_LEDGER_MIGRATION,
    DOC,
    HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    CHECKOUT_SESSION_DOC,
    CHECKOUT_SESSION_HANDOFF,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

async function assertDisabledByDefault() {
  const db = new FakeD1Database();
  const request = signedStoreWebhookRequest(checkoutCompletedEvent());
  const result = await receiveDznStoreSandboxWebhookReceipt(
    { DB: db, DZN_STORE_SANDBOX_RUNTIME: "local", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } as unknown as Env,
    request,
  );

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "STORE_DISABLED");
  assert.equal(result.body.receipt_recorded, false);
  assert.equal(db.paymentEvents.length, 0, "Disabled Store flags must not write receipt rows.");
}

async function assertFulfilmentAndLiveFlagsBlockReceipt() {
  for (const [flag, value, expectedError] of [
    ["DZN_STORE_WEBHOOK_FULFILMENT_ENABLED", "true", "STORE_WEBHOOK_FULFILMENT_MUST_STAY_DISABLED"],
    ["DZN_STORE_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_SUPPORTER_CARDS_ENABLED", "true", "STORE_SUPPORTER_CARD_RUNTIME_MUST_STAY_DISABLED"],
    ["DZN_EARNED_SPINS_ENABLED", "true", "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED"],
    ["DZN_REWARD_WHEEL_ENABLED", "true", "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED"],
  ] as const) {
    const db = new FakeD1Database();
    const result = await receiveDznStoreSandboxWebhookReceipt(
      { DB: db, ...STORE_WEBHOOK_FLAGS, [flag]: value } as unknown as Env,
      signedStoreWebhookRequest(checkoutCompletedEvent()),
    );
    assert.equal(result.status, 403, `${flag} must block Store webhook receipt.`);
    assert.equal(result.body.error, expectedError, `${flag} should use the canonical Store sandbox blocker.`);
    assert.equal(result.body.receipt_recorded, false);
    assert.equal(db.paymentEvents.length, 0, `${flag} must block before ledger writes.`);
  }
}

async function assertWebhookSecretRequired() {
  for (const secret of [undefined, "", "sk_test_not_a_webhook_secret", "whsec_short"] as const) {
    const result = await receiveDznStoreSandboxWebhookReceipt(
      { DB: new FakeD1Database(), ...STORE_WEBHOOK_FLAGS, STRIPE_WEBHOOK_SECRET: secret } as unknown as Env,
      signedStoreWebhookRequest(checkoutCompletedEvent()),
    );
    assert.equal(result.status, 403);
    assert.equal(result.body.error, "STORE_STRIPE_WEBHOOK_SECRET_REQUIRED");
  }

  const allowed = canReceiveDznStoreSandboxWebhookReceipt({ DB: new FakeD1Database(), ...STORE_WEBHOOK_FLAGS } as unknown as Env);
  assert.equal(allowed.ok, true, "Complete local/test sandbox flags plus a webhook secret should allow receipt verification.");
}

async function assertInvalidSignatureRejected() {
  const db = new FakeD1Database(["orderid001"]);
  const { response, json } = await callRoute({
    db,
    request: signedStoreWebhookRequest(checkoutCompletedEvent(), "whsec_wrongwebhooksecret000000"),
  });

  assert.equal(response.status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error, "STORE_WEBHOOK_SIGNATURE_INVALID");
  assert.equal(json.receipt_recorded, false);
  assert.equal(db.paymentEvents.length, 0, "Invalid signatures must not write receipt rows.");
}

async function assertRecordsSanitizedCheckoutReceipt() {
  const db = new FakeD1Database(["orderid001"]);
  const event = checkoutCompletedEvent({
    data: {
      object: {
        id: "cs_test_store_checkout_001",
        object: "checkout.session",
        client_reference_id: "orderid001",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        payment_intent: "pi_test_store_payment_001",
        customer: "cus_test_private_customer_001",
        customer_email: "private@example.test",
        customer_details: {
          email: "private@example.test",
          name: "Private Customer",
          address: { line1: "1 Private Road" },
        },
        payment_method_details: {
          card: { last4: "4242" },
        },
        metadata: {
          dzn_context: "dzn_store_sandbox",
          dzn_order_id: "orderid001",
          dzn_product_key: "dzn-founding-supporter-pack",
          customer_email: "private@example.test",
        },
      },
    },
  });
  const body = JSON.stringify(event);
  const { response, json } = await callRoute({
    db,
    request: signedStoreWebhookRequest(event, WEBHOOK_SECRET, body),
  });

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.received, true);
  assert.equal(json.receipt?.recorded, true);
  assert.equal(json.receipt?.duplicate, false);
  assert.equal(json.receipt?.event_type, "checkout.session.completed");
  assert.equal(json.receipt?.event_class, "checkout");
  assert.equal(json.receipt?.processing_status, "received");
  assert.equal(json.receipt?.livemode, false);
  assert.equal(json.receipt?.related_order_linked, true);
  assert.deepEqual(json.safety, expectedSafety());

  const responseText = JSON.stringify(json);
  assert.doesNotMatch(responseText, /private@example\.test|cus_test|pi_test|cs_test|evt_store/i, "Webhook response must not expose private Stripe ids or customer details.");

  assert.equal(db.paymentEvents.length, 1);
  const row = db.paymentEvents[0];
  assert.equal(row.stripe_event_id, event.id);
  assert.equal(row.event_type, "checkout.session.completed");
  assert.equal(row.event_class, "checkout");
  assert.equal(row.ledger_scope, "local");
  assert.equal(row.livemode, 0);
  assert.equal(row.processing_status, "received");
  assert.equal(row.related_order_id, "orderid001");
  assert.equal(row.stripe_checkout_session_id, "cs_test_store_checkout_001");
  assert.equal(row.stripe_payment_intent_id, "pi_test_store_payment_001");
  assert.equal(row.stripe_charge_id, null);
  assert.equal(row.stripe_refund_id, null);
  assert.equal(row.stripe_dispute_id, null);
  assert.equal(row.raw_event_sha256, createHash("sha256").update(body).digest("hex"));
  assert.equal(row.fulfilment_attempted, 0);
  assert.equal(row.entitlement_write_attempted, 0);
  assert.equal(row.supporter_card_write_attempted, 0);

  const summaryText = row.sanitized_summary_json;
  assert.match(summaryText, /"raw_event_body_stored":false/);
  assert.match(summaryText, /"customer_details_stored":false/);
  assert.match(summaryText, /"payment_method_details_stored":false/);
  assert.match(summaryText, /"webhook_fulfilment_attempted":false/);
  assert.doesNotMatch(summaryText, /private@example\.test|Private Customer|1 Private Road|cus_test_private|4242|customer_email|billing_address|card_number|\bcvc\b/i);
  assertNoForbiddenSql(db.operations);
}

async function assertDuplicateEventsAreReceiptOnly() {
  const db = new FakeD1Database(["orderid001"]);
  const event = checkoutCompletedEvent();

  const first = await callRoute({ db, request: signedStoreWebhookRequest(event) });
  const second = await callRoute({ db, request: signedStoreWebhookRequest(event) });

  assert.equal(first.response.status, 200);
  assert.equal(first.json.receipt?.recorded, true);
  assert.equal(second.response.status, 200);
  assert.equal(second.json.receipt?.recorded, false);
  assert.equal(second.json.receipt?.duplicate, true);
  assert.equal(second.json.receipt?.processing_status, "duplicate");
  assert.equal(db.paymentEvents.length, 1, "Duplicate Stripe event ids must not create additional rows.");
  assertNoForbiddenSql(db.operations);
}

async function assertLiveModeEventsAreBlocked() {
  const db = new FakeD1Database(["orderid001"]);
  const event = checkoutCompletedEvent({
    livemode: true,
    data: {
      object: {
        id: "cs_live_store_checkout_001",
        object: "checkout.session",
        client_reference_id: "orderid001",
      },
    },
  });
  const { response, json } = await callRoute({ db, request: signedStoreWebhookRequest(event) });

  assert.equal(response.status, 422);
  assert.equal(json.ok, false);
  assert.equal(json.error, "STORE_WEBHOOK_LIVE_EVENT_BLOCKED");
  assert.equal(json.receipt_recorded, false);
  assert.equal(db.paymentEvents.length, 0, "Live-mode events must be blocked before ledger writes.");
}

async function assertClassifiesReceiptEventFamilies() {
  const db = new FakeD1Database(["orderid001"]);
  const cases: Array<{
    event: StripeEventFixture;
    expected: Partial<PaymentEventRow>;
  }> = [
    {
      event: stripeEvent("payment_intent.succeeded", {
        id: "pi_test_payment_family_001",
        object: "payment_intent",
        status: "succeeded",
        metadata: { dzn_order_id: "orderid001" },
      }),
      expected: {
        event_class: "payment_intent",
        processing_status: "received",
        stripe_payment_intent_id: "pi_test_payment_family_001",
      },
    },
    {
      event: stripeEvent("refund.created", {
        id: "re_test_refund_family_001",
        object: "refund",
        payment_intent: "pi_test_payment_family_001",
        charge: "ch_test_refund_family_001",
        metadata: { dzn_order_id: "orderid001" },
      }),
      expected: {
        event_class: "refund",
        processing_status: "received",
        stripe_payment_intent_id: "pi_test_payment_family_001",
        stripe_charge_id: "ch_test_refund_family_001",
        stripe_refund_id: "re_test_refund_family_001",
      },
    },
    {
      event: stripeEvent("charge.refunded", {
        id: "ch_test_charge_refunded_001",
        object: "charge",
        payment_intent: "pi_test_payment_family_001",
        metadata: { dzn_order_id: "orderid001" },
      }),
      expected: {
        event_class: "refund",
        processing_status: "received",
        stripe_payment_intent_id: "pi_test_payment_family_001",
        stripe_charge_id: "ch_test_charge_refunded_001",
      },
    },
    {
      event: stripeEvent("charge.dispute.created", {
        id: "du_test_dispute_family_001",
        object: "dispute",
        charge: "ch_test_dispute_family_001",
        metadata: { dzn_order_id: "orderid001" },
      }),
      expected: {
        event_class: "dispute",
        processing_status: "received",
        stripe_charge_id: "ch_test_dispute_family_001",
        stripe_dispute_id: "du_test_dispute_family_001",
      },
    },
    {
      event: stripeEvent("customer.created", {
        id: "cus_test_ignored_family_001",
        object: "customer",
      }),
      expected: {
        event_class: "ignored",
        processing_status: "ignored",
        related_order_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        stripe_refund_id: null,
        stripe_dispute_id: null,
      },
    },
  ];

  for (const item of cases) {
    const result = await callRoute({ db, request: signedStoreWebhookRequest(item.event) });
    assert.equal(result.response.status, 200);
    const row = db.paymentEvents.find((candidate) => candidate.stripe_event_id === item.event.id);
    assert.ok(row, `${item.event.type} should be recorded.`);
    for (const [key, value] of Object.entries(item.expected)) {
      assert.equal(row[key as keyof PaymentEventRow], value, `${item.event.type} should map ${key}.`);
    }
    assert.equal(row.fulfilment_attempted, 0);
    assert.equal(row.entitlement_write_attempted, 0);
    assert.equal(row.supporter_card_write_attempted, 0);
  }
  assertNoForbiddenSql(db.operations);
}

function assertNoForbiddenRuntimeOrProductionMutationPaths() {
  const route = read(ROUTE);
  const helper = read(HELPER);
  const stripeHelper = read(STRIPE_HELPER);
  const ownerWebhook = read(OWNER_WEBHOOK);
  const runtime = `${route}\n${helper}`;

  for (const required of [
    "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED",
    "STRIPE_WEBHOOK_SECRET",
    "verifyStripeWebhookWithRawBody",
    "await request.text()",
    "INSERT INTO store_payment_events",
    "ON CONFLICT(stripe_event_id) DO NOTHING",
    "raw_event_sha256",
    "sanitized_summary_json",
    "fulfilment_attempted",
    "entitlement_write_attempted",
    "supporter_card_write_attempted",
    "STORE_WEBHOOK_LIVE_EVENT_BLOCKED",
    "STORE_WEBHOOK_SIGNATURE_INVALID",
  ]) {
    assert.equal(`${runtime}\n${stripeHelper}`.includes(required), true, `Store webhook receipt runtime should include ${required}.`);
  }

  assert.equal(route.includes("getRequestSessionUser"), false, "Stripe webhooks are authenticated by signature, not player sessions.");
  assert.equal(route.includes("receiveDznStoreSandboxWebhookReceipt"), true, "Route should delegate to the Store webhook receipt helper.");
  assert.equal(stripeHelper.includes("export async function verifyStripeWebhook"), true, "Existing owner billing webhook verifier should remain exported.");
  assert.equal(stripeHelper.includes("export async function verifyStripeWebhookWithRawBody"), true, "Store webhook receipt should use the raw verified body for hashing.");
  assert.equal(stripeHelper.includes('request.headers.get("stripe-signature")'), true, "Verifier must read Stripe-Signature.");
  assert.equal(stripeHelper.includes("timingSafeEqual"), true, "Verifier must keep timing-safe signature comparison.");

  for (const forbidden of [
    /\bstripeFormRequest\b/i,
    /\bstripeGetRequest\b/i,
    /\bfetch\s*\(/i,
    /\bcheckout\.sessions\.create\b/i,
    /\/checkout\/sessions/i,
    /\bINSERT\s+INTO\s+store_orders\b/i,
    /\bUPDATE\s+store_orders\b/i,
    /\bINSERT\s+INTO\s+store_order_items\b/i,
    /\bUPDATE\s+store_order_items\b/i,
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
    /\bowner_billing_accounts\b/i,
    /\bowner_plan_entitlements\b/i,
    /\blinked_servers\b/i,
    /\bnitrado/i,
    /\bdiscord/i,
    /\banalytics\b/i,
    /\bgtag\b/i,
    /\bposthog\b/i,
    /\bwrangler\b/i,
    /\bissue #49\b/i,
  ]) {
    assert.doesNotMatch(runtime, forbidden, `Store webhook receipt must not contain forbidden runtime pattern ${forbidden}.`);
  }

  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of [
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
      "DZN_STORE_SANDBOX_RUNTIME",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable Store webhook receipt flags.`);
    }
  }

  assert.equal(ownerWebhook.includes("checkout.session.completed"), true, "Existing owner webhook must remain subscription-oriented.");
  for (const table of ["store_orders", "store_order_items", "store_payment_events", "account_entitlements", "supporter_cards", "earned_spins", "spin_ledger", "wheel_cooldowns"]) {
    assert.equal(ownerWebhook.includes(table), false, `Owner subscription webhook must not touch Store table ${table}.`);
  }

  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));
  const allowedStoreWebhookRuntime = new Set([
    ROUTE,
    HELPER,
    STRIPE_HELPER,
    ORDER_HELPER,
    CHECKOUT_HELPER,
    OWNER_WEBHOOK,
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/create-portal-session.ts",
    "functions/api/store/orders.ts",
    "functions/api/store/orders/[orderId]/checkout.ts",
    "functions/_lib/plans.ts",
    "functions/_lib/dzn-store-catalog.ts",
    "app/store/page.tsx",
    "components/store/dzn-store-preview-page.tsx",
  ].map((path) => path.replace(/\\/g, "/")));
  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (allowedStoreWebhookRuntime.has(path)) continue;
    const source = read(path);
    assert.doesNotMatch(source, /\bDZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED\b/i, `${path} must not read Store webhook receipt flags.`);
    assert.doesNotMatch(source, /\bINSERT\s+INTO\s+store_payment_events\b/i, `${path} must not write Store payment events.`);
    assert.doesNotMatch(source, /\bUPDATE\s+store_payment_events\b/i, `${path} must not update Store payment events.`);
  }
}

function assertDocsAndPackageScripts() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "DZN Store Sandbox Webhook Event Ledger Receipt",
      "`functions/api/stripe/store-webhook.ts`",
      "`functions/_lib/dzn-store-webhook.ts`",
      "`POST /api/stripe/store-webhook`",
      "disabled by default",
      "`DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED=true`",
      "`STRIPE_WEBHOOK_SECRET` must be a bounded `whsec_` signing secret",
      "Verify the `Stripe-Signature` header against the unmodified raw request body before parsing.",
      "Test-mode events only.",
      "writes only `store_payment_events`",
      "`sanitized_summary_json`",
      "Raw event SHA-256 hash",
      "No fulfilment is attempted.",
      "No account entitlement is granted.",
      "No Supporter Card is issued.",
      "No earned spin is minted.",
      "No reward wheel runtime runs.",
      "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
      "Issue #49 remains reserved for final live checkout activation.",
      "Next should be Store webhook fulfilment approval preflight",
    ]],
    [HANDOFF, [
      "DZN Store Sandbox Webhook Event Ledger Receipt Handoff",
      "Protected OneDrive checkout was not modified.",
      "Branch: `codex/dzn-store-sandbox-webhook-ledger-receipt-20260828`",
      "`POST /api/stripe/store-webhook`",
      "receipt-only",
      "No fulfilment.",
      "No entitlements.",
      "No Supporter Cards.",
      "No earned spins.",
      "No wheel runtime.",
      "No live checkout.",
      "No production D1 writes.",
      "No issue #49 change.",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store sandbox webhook event ledger receipt slice is now delivered",
      "`docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md`",
      "records sanitized test-mode `store_payment_events` receipt rows only",
      "no fulfilment, account entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout activation, Stripe Product/Price mutation, Cloudflare secret/config mutation, production D1 write, or issue #49 change",
    ]],
    [BACKLOG, [
      "DZN Store Sandbox Webhook Event Ledger Receipt",
      "`docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md`",
      "receipt-only",
      "No Store webhook fulfilment",
    ]],
    [MASTER_SPEC, [
      "DZN Store Sandbox Webhook Event Ledger Receipt Slice",
      "`docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md`",
      "verified Stripe signature",
      "sanitized test-mode `store_payment_events`",
      "No fulfilment, entitlements, Supporter Cards, earned spins, reward wheel runtime, production D1 write, live checkout, or issue #49 change",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store sandbox webhook event ledger receipt slice may add `POST /api/stripe/store-webhook`",
      "records only sanitized test-mode `store_payment_events` receipt rows",
      "It must not fulfil orders, grant entitlements, issue Supporter Cards, mint earned spins, run the wheel, mutate Stripe Products/Prices",
    ]],
    [BILLING_PLANS, [
      "The DZN Store sandbox webhook event ledger receipt slice adds a disabled-by-default signed receipt route",
      "It records only sanitized test-mode `store_payment_events` rows",
      "It does not grant owner access, account entitlements, Supporter Cards, spins, XP, rankings, discovery, reviews, badges, seasons, events, Server Wars, CTF scoring, or competitive eligibility",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "The Store sandbox webhook event ledger receipt route",
      "`POST /api/stripe/store-webhook`",
      "`DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED=true`",
      "no fulfilment",
      "does not approve live checkout or issue #49 changes",
    ]],
    [CHECKOUT_SESSION_DOC, [
      "The follow-on DZN Store sandbox webhook event ledger receipt slice may record sanitized test-mode `store_payment_events` rows only.",
      "No Store webhook fulfilment is processed.",
    ]],
    [CHECKOUT_SESSION_HANDOFF, [
      "Follow-on delivered: DZN Store sandbox webhook event ledger receipt",
      "No Store webhook fulfilment.",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assert.equal(source.includes(snippet), true, `${path} should document: ${snippet}`);
    }
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-sandbox-webhook-ledger-receipt"],
    "tsx scripts/test-dzn-store-sandbox-webhook-ledger-receipt.ts",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-sandbox-webhook-ledger-receipt"),
    true,
    "Full npm test should include the Store sandbox webhook receipt guard.",
  );
}

async function callRoute(input: { db: FakeD1Database; request: Request }) {
  const response = await storeWebhookRoute({
    request: input.request,
    env: { DB: input.db, ...STORE_WEBHOOK_FLAGS } as unknown as Env,
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

function signedStoreWebhookRequest(event: StripeEventFixture, secret = WEBHOOK_SECRET, rawBody = JSON.stringify(event)) {
  const timestamp = "1787865600";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return new Request("https://dzn.test/api/stripe/store-webhook", {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
  });
}

function checkoutCompletedEvent(patch: Partial<StripeEventFixture> = {}): StripeEventFixture {
  return stripeEvent("checkout.session.completed", {
    id: "cs_test_store_checkout_001",
    object: "checkout.session",
    client_reference_id: "orderid001",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_test_store_payment_001",
    metadata: {
      dzn_context: "dzn_store_sandbox",
      dzn_order_id: "orderid001",
      dzn_product_key: "dzn-founding-supporter-pack",
    },
  }, patch);
}

let eventCounter = 0;

function stripeEvent(type: string, object: Record<string, unknown>, patch: Partial<StripeEventFixture> = {}): StripeEventFixture {
  eventCounter += 1;
  return {
    id: `evt_store_receipt_${eventCounter.toString().padStart(4, "0")}`,
    object: "event",
    api_version: "2026-02-25.clover",
    created: 1787865600 + eventCounter,
    livemode: false,
    type,
    data: { object },
    ...patch,
  };
}

function expectedSafety() {
  return {
    webhook_fulfilment_attempted: false,
    entitlement_write_attempted: false,
    supporter_card_write_attempted: false,
    earned_spin_write_attempted: false,
    wheel_runtime_attempted: false,
    stripe_product_price_mutation_attempted: false,
    cloudflare_config_mutation_attempted: false,
    production_d1_write_attempted: false,
    issue_49_changed: false,
  };
}

function assertNoForbiddenSql(operations: FakeOperation[]) {
  const sql = operations.map((operation) => operation.sql).join("\n");
  assert.match(sql, /INSERT INTO store_payment_events/i, "Webhook receipt should write only the payment-event ledger.");
  for (const forbidden of [
    /\bUPDATE\s+store_orders\b/i,
    /\bINSERT\s+INTO\s+store_orders\b/i,
    /\bINSERT\s+INTO\s+store_order_items\b/i,
    /\baccount_entitlements\b/i,
    /\bsupporter_cards\b/i,
    /\bearned_spins\b/i,
    /\bspin_ledger\b/i,
    /\bwheel_cooldowns\b/i,
    /\blinked_servers\b/i,
    /\bowner_billing_accounts\b/i,
    /\bowner_plan_entitlements\b/i,
    /\bserver_rank/i,
    /\bdiscovery_score\b/i,
    /\breviews?\b/i,
    /\bevents?\b/i,
    /\bctf\b/i,
    /\bserver_war/i,
    /\bplayer_xp\b/i,
    /\bpublic_profile\b/i,
  ]) {
    assert.doesNotMatch(sql, forbidden, `Webhook receipt SQL must not touch ${forbidden}.`);
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

type StripeEventFixture = {
  id: string;
  object: string;
  api_version: string;
  created: number;
  livemode: boolean;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

type FakeOperation =
  | { type: "first"; sql: string; bindings: unknown[] }
  | { type: "run"; sql: string; bindings: unknown[] };

type PaymentEventRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  event_class: string;
  api_version: string | null;
  ledger_scope: string;
  livemode: 0;
  received_at: string;
  processing_status: string;
  related_order_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  stripe_dispute_id: string | null;
  raw_event_sha256: string;
  sanitized_summary_json: string;
  fulfilment_attempted: 0;
  entitlement_write_attempted: 0;
  supporter_card_write_attempted: 0;
};

class FakeD1Database {
  operations: FakeOperation[] = [];
  paymentEvents: PaymentEventRow[] = [];
  private readonly existingOrderIds: Set<string>;

  constructor(orderIds: string[] = []) {
    this.existingOrderIds = new Set(orderIds);
  }

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  first(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "first", sql, bindings });
    if (/SELECT\s+id\s+FROM\s+store_orders/i.test(sql)) {
      const id = typeof bindings[0] === "string" ? bindings[0] : null;
      return id && this.existingOrderIds.has(id) ? { id } : null;
    }
    return null;
  }

  run(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "run", sql, bindings });
    if (/INSERT\s+INTO\s+store_payment_events/i.test(sql)) {
      const stripeEventId = String(bindings[1]);
      if (this.paymentEvents.some((row) => row.stripe_event_id === stripeEventId)) {
        return { success: true, meta: { changes: 0 } };
      }
      this.paymentEvents.push({
        id: String(bindings[0]),
        stripe_event_id: stripeEventId,
        event_type: String(bindings[2]),
        event_class: String(bindings[3]),
        api_version: typeof bindings[4] === "string" ? bindings[4] : null,
        ledger_scope: String(bindings[5]),
        livemode: 0,
        received_at: String(bindings[6]),
        processing_status: String(bindings[7]),
        related_order_id: typeof bindings[8] === "string" ? bindings[8] : null,
        stripe_checkout_session_id: typeof bindings[9] === "string" ? bindings[9] : null,
        stripe_payment_intent_id: typeof bindings[10] === "string" ? bindings[10] : null,
        stripe_charge_id: typeof bindings[11] === "string" ? bindings[11] : null,
        stripe_refund_id: typeof bindings[12] === "string" ? bindings[12] : null,
        stripe_dispute_id: typeof bindings[13] === "string" ? bindings[13] : null,
        raw_event_sha256: String(bindings[14]),
        sanitized_summary_json: String(bindings[15]),
        fulfilment_attempted: 0,
        entitlement_write_attempted: 0,
        supporter_card_write_attempted: 0,
      });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
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
