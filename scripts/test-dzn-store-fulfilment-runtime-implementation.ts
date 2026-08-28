import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION,
  DZN_STORE_WEBHOOK_FULFILMENT_FLAG,
  canProcessDznStoreSandboxFulfilment,
} from "../functions/_lib/dzn-store-fulfilment";
import {
  DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG,
  DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE,
  DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
  receiveDznStoreSandboxWebhookReceipt,
} from "../functions/_lib/dzn-store-webhook";
import type { Env } from "../functions/_lib/types";

const ROUTE = "functions/api/stripe/store-webhook.ts";
const HELPER = "functions/_lib/dzn-store-webhook.ts";
const FULFILMENT_HELPER = "functions/_lib/dzn-store-fulfilment.ts";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const FULFILMENT_LEDGER_MIGRATION = "migrations/0073_dzn_store_fulfilment_ledger_schema.sql";
const DOC = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md";
const HANDOFF = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_HANDOFF.md";
const PREFLIGHT = "docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION_PREFLIGHT.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const PACKAGE_JSON = "package.json";
const WEBHOOK_SECRET = "whsec_dznstorefulfilmentruntime00000001";
const NOW = new Date("2026-08-28T12:00:00.000Z");

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

const STORE_FULFILMENT_FLAGS = {
  ...STORE_WEBHOOK_FLAGS,
  [DZN_STORE_WEBHOOK_FULFILMENT_FLAG]: "true",
};

type StoreWebhookResult = Awaited<ReturnType<typeof receiveDznStoreSandboxWebhookReceipt>>;
type StoreWebhookSuccessBody = Extract<StoreWebhookResult["body"], { ok: true }>;

async function main() {
  assertConstants();
  assertFilesExist();
  assertAccessGates();
  await assertDisabledDefaultRemainsReceiptOnly();
  await assertFulfilmentFailureAfterReceiptIsRetryable();
  await assertCheckoutCompletedCreatesOneEntitlementNoCardByDefault();
  await assertSupporterCardIsIssuedOnlyWhenFlagged();
  await assertDuplicateStripeRetriesDoNotDuplicateLedgers();
  await assertExistingAccountBoundEntitlementBlocksDuplicateGrant();
  await assertMismatchedCheckoutSessionGoesToManualReview();
  await assertPaymentIntentCannotFulfilAlone();
  await assertFullRefundRevokesOnlyStoreEntitlementAndCard();
  await assertDisputeCreatedSuspendsAndLostDisputeRevokes();
  assertRuntimeSourceBoundaries();
  assertDocsAndPackageScript();
  console.log("DZN Store fulfilment runtime implementation tests passed.");
}

function assertConstants() {
  assert.equal(DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE, "/api/stripe/store-webhook");
  assert.equal(DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION, "2026-08-28.sandbox-webhook-receipt-v1");
  assert.equal(DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION, "2026-08-28.store-fulfilment-runtime-v1");
  assert.equal(DZN_STORE_WEBHOOK_FULFILMENT_FLAG, "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED");
}

function assertFilesExist() {
  for (const path of [
    ROUTE,
    HELPER,
    FULFILMENT_HELPER,
    STRIPE_HELPER,
    OWNER_WEBHOOK,
    OWNER_CHECKOUT_ROUTE,
    ORDER_LEDGER_MIGRATION,
    FULFILMENT_LEDGER_MIGRATION,
    PREFLIGHT,
    DOC,
    HANDOFF,
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

function assertAccessGates() {
  const enabled = canProcessDznStoreSandboxFulfilment({ DB: new FakeD1Database(), ...STORE_FULFILMENT_FLAGS } as unknown as Env);
  assert.equal(enabled.ok, true, "Explicit local/test sandbox flags should allow Store fulfilment runtime.");

  const disabled = canProcessDznStoreSandboxFulfilment({ DB: new FakeD1Database(), ...STORE_WEBHOOK_FLAGS } as unknown as Env);
  assert.equal(disabled.ok, false, "Fulfilment must be disabled by default.");
  assert.equal(disabled.code, "STORE_WEBHOOK_FULFILMENT_DISABLED");

  for (const [flag, value, expectedCode] of [
    ["DZN_STORE_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_LIVE_CHECKOUT_ENABLED", "true", "STORE_LIVE_CHECKOUT_BLOCKED"],
    ["DZN_EARNED_SPINS_ENABLED", "true", "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED"],
    ["DZN_REWARD_WHEEL_ENABLED", "true", "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED"],
    ["STRIPE_SECRET_KEY", "sk_live_not_allowed", "STORE_STRIPE_LIVE_SECRET_BLOCKED"],
  ] as const) {
    const result = canProcessDznStoreSandboxFulfilment({ DB: new FakeD1Database(), ...STORE_FULFILMENT_FLAGS, [flag]: value } as unknown as Env);
    assert.equal(result.ok, false, `${flag} should block Store fulfilment runtime.`);
    assert.equal(result.code, expectedCode);
  }
}

async function assertDisabledDefaultRemainsReceiptOnly() {
  const db = seededDb();
  const result = await callWebhook(db, checkoutCompletedEvent(), STORE_WEBHOOK_FLAGS);

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.receipt.recorded, true);
  assert.equal(result.body.fulfilment, null);
  assert.deepEqual(result.body.safety, expectedSafety());
  assert.equal(db.paymentEvents.length, 1, "Receipt should still be recorded when fulfilment is disabled.");
  assert.equal(db.fulfilmentAttempts.length, 0, "Disabled default must create no fulfilment attempts.");
  assert.equal(db.accountEntitlements.length, 0, "Disabled default must create no account entitlement.");
  assert.equal(db.supporterCards.length, 0, "Disabled default must issue no Supporter Card.");
}

async function assertFulfilmentFailureAfterReceiptIsRetryable() {
  const db = new FulfilmentReadThrowingD1Database();
  const order = makeOrder();
  db.orders.set(order.order_id, order);
  const response = await receiveDznStoreSandboxWebhookReceipt(
    { DB: db, ...STORE_FULFILMENT_FLAGS } as unknown as Env,
    signedStoreWebhookRequest(checkoutCompletedEvent()),
    {
      now: NOW,
      createId: nextDeterministicId,
      hashValue: hashValue,
    },
  );

  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "STORE_FULFILMENT_RUNTIME_FAILED");
  assert.equal(response.body.receipt_recorded, true, "The signed receipt should remain recorded for an idempotent retry.");
  assert.equal(response.body.safety.webhook_fulfilment_attempted, true);
  assert.equal(response.body.safety.entitlement_write_attempted, false);
  assert.equal(response.body.safety.supporter_card_write_attempted, false);
  assert.equal(db.paymentEvents.length, 1);
  assert.equal(db.fulfilmentAttempts.length, 0);
  assert.equal(db.accountEntitlements.length, 0);
  assert.equal(db.supporterCards.length, 0);
}

async function assertCheckoutCompletedCreatesOneEntitlementNoCardByDefault() {
  const db = seededDb();
  const result = await callWebhook(db, checkoutCompletedEvent(), STORE_FULFILMENT_FLAGS);

  assert.equal(result.status, 200);
  assert.equal(result.body.receipt.recorded, true);
  assert.equal(result.body.fulfilment?.status, "fulfilled");
  assert.equal(result.body.fulfilment?.reason_code, "STORE_CHECKOUT_COMPLETED_FULFILLED");
  assert.equal(result.body.fulfilment?.entitlement_write_attempted, true);
  assert.equal(result.body.fulfilment?.entitlement_written, true);
  assert.equal(result.body.fulfilment?.supporter_card_write_attempted, false);
  assert.equal(result.body.safety.webhook_fulfilment_attempted, true);
  assert.equal(result.body.safety.entitlement_write_attempted, true);
  assert.equal(result.body.safety.supporter_card_write_attempted, false);

  assert.equal(db.orders.get("orderid001")?.order_status, "paid");
  assert.equal(db.orderStatusHistory.length, 1);
  assert.equal(db.orderStatusHistory[0].to_status, "paid");
  assert.equal(db.fulfilmentAttempts.length, 1);
  assert.equal(db.fulfilmentAttempts[0].status, "fulfilled");
  assert.equal(db.accountEntitlements.length, 1);
  assert.equal(db.accountEntitlements[0].user_id, "user_test_player_001");
  assert.equal(db.accountEntitlements[0].source_order_item_id, "itemid001");
  assert.equal(db.accountEntitlements[0].status, "active");
  assert.equal(db.accountEntitlements[0].grants_spins, 0);
  assert.equal(db.accountEntitlements[0].grants_xp, 0);
  assert.equal(db.accountEntitlements[0].grants_owner_subscription_access, 0);
  assert.equal(db.accountEntitlements[0].grants_competitive_eligibility, 0);
  assert.equal(db.supporterCards.length, 0, "Supporter Cards remain independently disabled.");

  const responseText = JSON.stringify(result.body);
  assert.doesNotMatch(responseText, /cs_test|pi_test|cus_test|ch_test|re_test|du_test|private@example\.test|discord_private|user_test_player_001/i);
}

async function assertSupporterCardIsIssuedOnlyWhenFlagged() {
  const db = seededDb();
  const flags = { ...STORE_FULFILMENT_FLAGS, DZN_SUPPORTER_CARDS_ENABLED: "true" };
  const result = await callWebhook(db, checkoutCompletedEvent(), flags);

  assert.equal(result.status, 200);
  assert.equal(result.body.fulfilment?.status, "fulfilled");
  assert.equal(result.body.fulfilment?.supporter_card_write_attempted, true);
  assert.equal(result.body.fulfilment?.supporter_card_written, true);
  assert.equal(db.accountEntitlements.length, 1);
  assert.equal(db.supporterCards.length, 1);
  assert.equal(db.supporterCards[0].user_id, "user_test_player_001");
  assert.match(db.supporterCards[0].serial_number, /^DZN-SUP-[0-9]{6}$/);
  assert.equal(db.supporterCards[0].selected_theme_key, "signal-crown");
  assert.equal(db.supporterCards[0].status, "active");
  assert.doesNotMatch(db.supporterCards[0].generated_insignia_json, /cs_test|pi_test|cus_test|private@example/i);
}

async function assertDuplicateStripeRetriesDoNotDuplicateLedgers() {
  const db = seededDb();
  const flags = { ...STORE_FULFILMENT_FLAGS, DZN_SUPPORTER_CARDS_ENABLED: "true" };
  const event = checkoutCompletedEvent();

  const first = await callWebhook(db, event, flags);
  const second = await callWebhook(db, event, flags);

  assert.equal(first.body.fulfilment?.status, "fulfilled");
  assert.equal(second.body.receipt.duplicate, true);
  assert.equal(second.body.fulfilment?.status, "duplicate");
  assert.equal(second.body.fulfilment?.reason_code, "STORE_FULFILMENT_EVENT_ALREADY_PROCESSED");
  assert.equal(db.paymentEvents.length, 1);
  assert.equal(db.fulfilmentAttempts.length, 1);
  assert.equal(db.accountEntitlements.length, 1);
  assert.equal(db.supporterCards.length, 1);
  assert.equal(db.orderStatusHistory.length, 1);
}

async function assertExistingAccountBoundEntitlementBlocksDuplicateGrant() {
  const db = seededDb();
  db.accountEntitlements.push({
    id: "entitlementid_existing",
    user_id: "user_test_player_001",
    entitlement_key: "dzn_store_dzn-founding-supporter-pack",
    source_order_id: "previousorder001",
    source_order_item_id: "previousitem001",
    source_product_key: "dzn-founding-supporter-pack",
    source_product_type: "supporter_pack",
    source_fulfilment_kind: "supporter_card",
    status: "active",
    visibility_state: "visible",
    granted_by_payment_event_id: "paymenteventseed",
    revoked_by_payment_event_id: null,
    grants_owner_subscription_access: 0,
    grants_spins: 0,
    grants_xp: 0,
    grants_rank_advantage: 0,
    grants_discovery_advantage: 0,
    grants_review_advantage: 0,
    grants_event_advantage: 0,
    grants_server_wars_advantage: 0,
    grants_ctf_advantage: 0,
    grants_competitive_eligibility: 0,
  });

  const result = await callWebhook(db, checkoutCompletedEvent(), { ...STORE_FULFILMENT_FLAGS, DZN_SUPPORTER_CARDS_ENABLED: "true" });

  assert.equal(result.status, 200);
  assert.equal(result.body.fulfilment?.status, "manual_review");
  assert.equal(result.body.fulfilment?.reason_code, "STORE_ENTITLEMENT_ACCOUNT_ALREADY_EXISTS");
  assert.equal(db.orders.get("orderid001")?.order_status, "manual_review", "Duplicate account-bound Store purchases should be flagged for support/refund handling.");
  assert.equal(db.fulfilmentAttempts[0].status, "manual_review");
  assert.equal(db.accountEntitlements.length, 1, "A second one-time account-bound entitlement must not be created.");
  assert.equal(db.supporterCards.length, 0, "A second Supporter Card must not be issued.");
}

async function assertMismatchedCheckoutSessionGoesToManualReview() {
  const db = seededDb({ stripe_checkout_session_id: "cs_test_expected_session_999" });
  const result = await callWebhook(db, checkoutCompletedEvent(), STORE_FULFILMENT_FLAGS);

  assert.equal(result.status, 200);
  assert.equal(result.body.fulfilment?.status, "manual_review");
  assert.equal(result.body.fulfilment?.reason_code, "STORE_CHECKOUT_SESSION_MISMATCH");
  assert.equal(db.orders.get("orderid001")?.order_status, "manual_review");
  assert.equal(db.fulfilmentAttempts[0].status, "manual_review");
  assert.equal(db.accountEntitlements.length, 0);
  assert.equal(db.supporterCards.length, 0);
}

async function assertPaymentIntentCannotFulfilAlone() {
  const db = seededDb();
  const event = stripeEvent("payment_intent.succeeded", {
    id: "pi_test_store_payment_001",
    object: "payment_intent",
    status: "succeeded",
    amount: 1000,
    currency: "gbp",
    metadata: {
      dzn_context: "dzn_store_sandbox",
      dzn_order_id: "orderid001",
    },
  });

  const result = await callWebhook(db, event, STORE_FULFILMENT_FLAGS);
  assert.equal(result.status, 200);
  assert.equal(result.body.fulfilment?.status, "no_op");
  assert.equal(result.body.fulfilment?.reason_code, "STORE_PAYMENT_INTENT_EVENT_NO_GRANT");
  assert.equal(db.orders.get("orderid001")?.order_status, "checkout_created");
  assert.equal(db.accountEntitlements.length, 0);
  assert.equal(db.supporterCards.length, 0);
}

async function assertFullRefundRevokesOnlyStoreEntitlementAndCard() {
  const db = seededDb({ order_status: "paid" });
  seedFulfilledStoreItem(db);
  const event = stripeEvent("charge.refunded", {
    id: "ch_test_refund_001",
    object: "charge",
    payment_intent: "pi_test_store_payment_001",
    amount_refunded: 1000,
    currency: "gbp",
    metadata: {
      dzn_context: "dzn_store_sandbox",
      dzn_order_id: "orderid001",
    },
  });

  const result = await callWebhook(db, event, { ...STORE_FULFILMENT_FLAGS, DZN_SUPPORTER_CARDS_ENABLED: "true" });
  assert.equal(result.status, 200);
  assert.equal(result.body.fulfilment?.status, "fulfilled");
  assert.equal(result.body.fulfilment?.reason_code, "STORE_FULL_REFUND_REVOKED");
  assert.equal(result.body.fulfilment?.refund_dispute_audit_written, true);
  assert.equal(db.orders.get("orderid001")?.order_status, "refunded");
  assert.equal(db.accountEntitlements[0].status, "revoked");
  assert.equal(db.supporterCards[0].status, "revoked");
  assert.equal(db.refundDisputeAudit.length, 1);
  assert.equal(db.refundDisputeAudit[0].local_decision, "revoke");
  assert.equal(db.refundDisputeAudit[0].refund_kind, "full");
}

async function assertDisputeCreatedSuspendsAndLostDisputeRevokes() {
  const db = seededDb({ order_status: "paid" });
  seedFulfilledStoreItem(db);
  const created = stripeEvent("charge.dispute.created", {
    id: "du_test_dispute_001",
    object: "dispute",
    charge: "ch_test_dispute_001",
    amount: 1000,
    currency: "gbp",
    status: "needs_response",
    metadata: {
      dzn_context: "dzn_store_sandbox",
      dzn_order_id: "orderid001",
    },
  });
  const closed = stripeEvent("charge.dispute.closed", {
    id: "du_test_dispute_001",
    object: "dispute",
    charge: "ch_test_dispute_001",
    amount: 1000,
    currency: "gbp",
    status: "lost",
    metadata: {
      dzn_context: "dzn_store_sandbox",
      dzn_order_id: "orderid001",
    },
  });

  const first = await callWebhook(db, created, { ...STORE_FULFILMENT_FLAGS, DZN_SUPPORTER_CARDS_ENABLED: "true" });
  assert.equal(first.body.fulfilment?.reason_code, "STORE_DISPUTE_CREATED_SUSPENDED");
  assert.equal(db.orders.get("orderid001")?.order_status, "disputed");
  assert.equal(db.accountEntitlements[0].status, "suspended");
  assert.equal(db.supporterCards[0].status, "suspended");

  const second = await callWebhook(db, closed, { ...STORE_FULFILMENT_FLAGS, DZN_SUPPORTER_CARDS_ENABLED: "true" });
  assert.equal(second.body.fulfilment?.reason_code, "STORE_DISPUTE_LOST_REVOKED");
  assert.equal(db.orders.get("orderid001")?.order_status, "revoked");
  assert.equal(db.accountEntitlements[0].status, "revoked");
  assert.equal(db.supporterCards[0].status, "revoked");
  assert.equal(db.refundDisputeAudit.length, 2);
}

function assertRuntimeSourceBoundaries() {
  const route = read(ROUTE);
  const helper = read(HELPER);
  const fulfilmentHelper = read(FULFILMENT_HELPER);
  const stripeHelper = read(STRIPE_HELPER);
  const runtime = `${route}\n${helper}\n${fulfilmentHelper}`;

  for (const required of [
    "verifyStripeWebhookWithRawBody",
    "await request.text()",
    "INSERT INTO store_payment_events",
    "ON CONFLICT(stripe_event_id) DO NOTHING",
    "processDznStoreSandboxWebhookFulfilment",
    "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
    "supporterCardsEnabled",
    "INSERT INTO store_fulfilment_attempts",
    "UPDATE store_orders",
    "INSERT INTO store_order_status_history",
    "INSERT INTO account_entitlements",
    "INSERT INTO store_entitlement_status_history",
    "INSERT INTO supporter_cards",
    "INSERT INTO store_refund_dispute_audit",
    "STORE_PAYMENT_INTENT_EVENT_NO_GRANT",
    "STORE_ASYNC_PAYMENT_SUCCESS_DISABLED",
    "STORE_FULL_REFUND_REVOKED",
    "STORE_DISPUTE_LOST_REVOKED",
  ]) {
    assertIncludes(`${runtime}\n${stripeHelper}`, required, `Runtime should include ${required}.`);
  }

  for (const forbidden of [
    /\bstripeFormRequest\b/i,
    /\bstripeGetRequest\b/i,
    /\bfetch\s*\(/i,
    /\bcheckout\.sessions\.create\b/i,
    /\/checkout\/sessions/i,
    /\brefunds\.create\b/i,
    /\bdisputes\.close\b/i,
    /\bINSERT\s+INTO\s+earned_spins\b/i,
    /\bUPDATE\s+earned_spins\b/i,
    /\bINSERT\s+INTO\s+spin_ledger\b/i,
    /\bUPDATE\s+spin_ledger\b/i,
    /\bwheel_cooldowns\b/i,
    /\breward_wheel\b/i,
    /\bowner_billing_accounts\b/i,
    /\bowner_plan_entitlements\b/i,
    /\bserver_subscriptions\b/i,
    /\blinked_servers\b/i,
    /\bnitrado/i,
    /\bDiscord\s+API\b/i,
    /\banalytics\b/i,
    /\bgtag\b/i,
    /\bposthog\b/i,
    /\bwrangler\b/i,
    /\bissue\s+#49\b/i,
    /\bDZN_STORE_LIVE_CHECKOUT_ENABLED\s*[:=]\s*["']?true/i,
    /\bDZN_LIVE_CHECKOUT_ENABLED\s*[:=]\s*["']?true/i,
  ]) {
    assert.doesNotMatch(runtime, forbidden, `Store fulfilment runtime must not contain forbidden pattern ${forbidden}.`);
  }

  const ownerWebhook = read(OWNER_WEBHOOK);
  for (const table of [
    "store_fulfilment_attempts",
    "account_entitlements",
    "supporter_cards",
    "store_refund_dispute_audit",
    "earned_spins",
    "spin_ledger",
    "wheel_cooldowns",
  ]) {
    assert.equal(ownerWebhook.includes(table), false, `Owner subscription webhook must not touch Store table ${table}.`);
  }
  assert.equal(read(OWNER_CHECKOUT_ROUTE).includes('mode: "subscription"'), true, "Owner checkout must remain subscription mode.");

  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of [
      "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED",
      "DZN_SUPPORTER_CARDS_ENABLED",
      "DZN_EARNED_SPINS_ENABLED",
      "DZN_REWARD_WHEEL_ENABLED",
      "DZN_STORE_LIVE_CHECKOUT_ENABLED",
      "DZN_LIVE_CHECKOUT_ENABLED=true",
    ]) {
      assert.equal(source.includes(flag), false, `${path} must not source-control-enable ${flag}.`);
    }
  }

  assertNoForbiddenSqlRuntimeTables();
}

function assertDocsAndPackageScript() {
  const checks: Array<[string, string[]]> = [
    [DOC, [
      "DZN Store Fulfilment Runtime Implementation",
      "`functions/_lib/dzn-store-fulfilment.ts`",
      "`functions/_lib/dzn-store-webhook.ts`",
      "`POST /api/stripe/store-webhook`",
      "disabled by default",
      "`DZN_STORE_WEBHOOK_FULFILMENT_ENABLED=true`",
      "local/test",
      "checkout.session.completed",
      "`store_fulfilment_attempts`",
      "`store_order_status_history`",
      "`account_entitlements`",
      "`supporter_cards`",
      "`store_refund_dispute_audit`",
      "PaymentIntent events do not fulfil alone",
      "No earned spins",
      "No reward wheel runtime",
      "No live checkout",
      "No Stripe Product/Price mutation",
      "No Cloudflare config mutation",
      "No production D1 writes",
      "Issue #49 remains reserved",
    ]],
    [HANDOFF, [
      "DZN Store Fulfilment Runtime Implementation Handoff",
      "Branch: `codex/dzn-store-fulfilment-runtime-implementation-20260828`",
      "Protected OneDrive checkout was not modified.",
      "No earned spins.",
      "No reward wheel runtime.",
      "No live checkout.",
      "No production D1 writes.",
      "No issue #49 change.",
    ]],
    [PREFLIGHT, [
      "Delivered follow-on implementation",
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`",
      "`functions/_lib/dzn-store-fulfilment.ts`",
    ]],
    [SAFE_PREFLIGHT, [
      "The DZN Store fulfilment runtime implementation slice is now delivered",
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`",
      "disabled-by-default local/test Store fulfilment runtime",
    ]],
    [BACKLOG, [
      "DZN Store Fulfilment Runtime Implementation",
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md`",
      "PaymentIntent events remain no-grant",
    ]],
    [MASTER_SPEC, [
      "DZN Store Fulfilment Runtime Implementation Slice",
      "`functions/_lib/dzn-store-fulfilment.ts`",
      "Store account entitlements remain separate from owner Starter/Pro entitlements",
    ]],
    [PUBLIC_ACCESS_POLICY, [
      "The DZN Store fulfilment runtime implementation slice may process verified test-mode Store payment receipts",
      "Store entitlements remain private account-bound cosmetic/supporter records",
    ]],
    [BILLING_PLANS, [
      "The DZN Store fulfilment runtime implementation adds disabled-by-default local/test processing",
      "Store fulfilment remains separate from owner Starter/Pro billing",
    ]],
    [STRIPE_LIVE_CHECKLIST, [
      "`docs/DZN_STORE_FULFILMENT_RUNTIME_IMPLEMENTATION.md` adds disabled-by-default local/test Store fulfilment runtime",
      "does not approve live checkout",
      "does not approve issue #49 changes",
    ]],
  ];

  for (const [path, snippets] of checks) {
    const source = read(path);
    for (const snippet of snippets) {
      assertIncludes(source, snippet, `${path} should document: ${snippet}`);
    }
  }

  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-fulfilment-runtime-implementation"],
    "tsx scripts/test-dzn-store-fulfilment-runtime-implementation.ts",
  );
  assertIncludes(
    packageJson.scripts?.test ?? "",
    "npm run test:dzn-store-fulfilment-runtime-implementation",
    "Full npm test should include the Store fulfilment runtime implementation guard.",
  );
}

async function callWebhook(db: FakeD1Database, event: StripeEventFixture, envPatch: Record<string, unknown>) {
  const response = await receiveDznStoreSandboxWebhookReceipt(
    { DB: db, ...envPatch } as unknown as Env,
    signedStoreWebhookRequest(event),
    {
      now: NOW,
      createId: nextDeterministicId,
      hashValue: hashValue,
    },
  );
  return { status: response.status, body: response.body as StoreWebhookSuccessBody };
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

function checkoutCompletedEvent(patch: Partial<StripeEventFixture> = {}) {
  return stripeEvent("checkout.session.completed", {
    id: "cs_test_store_checkout_001",
    object: "checkout.session",
    client_reference_id: "orderid001",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: 1000,
    currency: "gbp",
    payment_intent: "pi_test_store_payment_001",
    customer: "cus_test_private_customer_001",
    customer_email: "private@example.test",
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
    id: `evt_store_fulfil_${eventCounter.toString().padStart(4, "0")}`,
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

function seededDb(orderPatch: Partial<StoreOrderRow> = {}) {
  const db = new FakeD1Database();
  const order = makeOrder(orderPatch);
  db.orders.set(order.order_id, order);
  return db;
}

function makeOrder(patch: Partial<StoreOrderRow> = {}): StoreOrderRow {
  return {
    order_id: "orderid001",
    order_number: "DZN-STORE-0001",
    purchasing_user_id: "user_test_player_001",
    purchaser_username: "Rafael DZN",
    order_status: "checkout_created",
    ledger_scope: "local",
    order_livemode: 0,
    product_count: 1,
    currency: "gbp",
    subtotal_amount_minor: 1000,
    tax_amount_minor: 0,
    total_amount_minor: 1000,
    selected_theme_key: "signal-crown",
    stripe_checkout_session_id: "cs_test_store_checkout_001",
    stripe_payment_intent_id: "pi_test_store_payment_001",
    immutable_product_snapshot_json: JSON.stringify({
      product_key: "dzn-founding-supporter-pack",
      product_type: "supporter_pack",
      fulfilment_kind: "supporter_card",
    }),
    immutable_price_snapshot_json: JSON.stringify({
      price_id: "priceid001",
      currency: "gbp",
      total_amount_minor: 1000,
    }),
    terms_version: "dzn-store-sandbox-order-v1",
    checkout_session_expires_at: "2026-08-28T13:00:00.000Z",
    paid_at: null,
    refunded_at: null,
    revoked_at: null,
    order_item_id: "itemid001",
    product_id: "productid001",
    price_id: "priceid001",
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
    entitlement_id: null,
    entitlement_status: null,
    supporter_card_id: null,
    supporter_card_status: null,
    ...patch,
  };
}

function seedFulfilledStoreItem(db: FakeD1Database) {
  db.accountEntitlements.push({
    id: "entitlementid001",
    user_id: "user_test_player_001",
    entitlement_key: "dzn_store_dzn-founding-supporter-pack",
    source_order_id: "orderid001",
    source_order_item_id: "itemid001",
    source_product_key: "dzn-founding-supporter-pack",
    source_product_type: "supporter_pack",
    source_fulfilment_kind: "supporter_card",
    status: "active",
    visibility_state: "visible",
    granted_by_payment_event_id: "paymenteventseed",
    revoked_by_payment_event_id: null,
    grants_owner_subscription_access: 0,
    grants_spins: 0,
    grants_xp: 0,
    grants_rank_advantage: 0,
    grants_discovery_advantage: 0,
    grants_review_advantage: 0,
    grants_event_advantage: 0,
    grants_server_wars_advantage: 0,
    grants_ctf_advantage: 0,
    grants_competitive_eligibility: 0,
  });
  db.supporterCards.push({
    id: "cardid001",
    user_id: "user_test_player_001",
    entitlement_id: "entitlementid001",
    source_order_id: "orderid001",
    source_order_item_id: "itemid001",
    serial_number: "DZN-SUP-000001",
    display_name_snapshot: "Rafael DZN",
    selected_theme_key: "signal-crown",
    generated_insignia_json: "{}",
    status: "active",
  });
}

function assertNoForbiddenSqlRuntimeTables() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  const allowedStoreRuntimePaths = new Set([
    ROUTE,
    HELPER,
    FULFILMENT_HELPER,
    "functions/api/store/orders.ts",
    "functions/api/store/orders/[orderId]/checkout.ts",
    "functions/_lib/dzn-store-orders.ts",
    "functions/_lib/dzn-store-checkout.ts",
    "functions/_lib/dzn-store-catalog.ts",
    "functions/api/billing/create-checkout-session.ts",
    "functions/api/billing/create-portal-session.ts",
    "functions/_lib/plans.ts",
    "app/store/page.tsx",
    "components/store/dzn-store-preview-page.tsx",
  ].map((path) => path.replace(/\\/g, "/")));

  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    const source = read(rawPath);
    if (!allowedStoreRuntimePaths.has(path)) {
      for (const table of [
        "store_payment_events",
        "store_fulfilment_attempts",
        "account_entitlements",
        "supporter_cards",
        "store_refund_dispute_audit",
      ]) {
        assert.doesNotMatch(source, new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "i"), `${path} must not write Store fulfilment table ${table}.`);
      }
    }
    for (const forbidden of ["earned_spins", "spin_ledger", "wheel_cooldowns"]) {
      assert.doesNotMatch(source, new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${forbidden}\\b`, "i"), `${path} must not write ${forbidden}.`);
    }
  }
}

let deterministicIdCounter = 0;

function nextDeterministicId() {
  deterministicIdCounter += 1;
  return `testid${deterministicIdCounter.toString().padStart(4, "0")}`;
}

async function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

type StoreOrderRow = {
  order_id: string;
  order_number: string;
  purchasing_user_id: string;
  purchaser_username: string | null;
  order_status: string;
  ledger_scope: "local" | "sandbox";
  order_livemode: 0;
  product_count: number;
  currency: string;
  subtotal_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  selected_theme_key: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  immutable_product_snapshot_json: string;
  immutable_price_snapshot_json: string;
  terms_version: string;
  checkout_session_expires_at: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  revoked_at: string | null;
  order_item_id: string;
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
  entitlement_id: string | null;
  entitlement_status: string | null;
  supporter_card_id: string | null;
  supporter_card_status: string | null;
};

type PaymentEventRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  event_class: string;
  ledger_scope: "local" | "sandbox";
  livemode: 0;
  processing_status: string;
  related_order_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  stripe_dispute_id: string | null;
};

type FulfilmentAttemptRow = {
  id: string;
  payment_event_id: string;
  stripe_event_id: string;
  event_type: string;
  order_id: string;
  order_item_id: string;
  status: string;
  entitlement_id: string | null;
  supporter_card_id: string | null;
};

type AccountEntitlementRow = {
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
  granted_by_payment_event_id: string;
  revoked_by_payment_event_id: string | null;
  grants_owner_subscription_access: 0;
  grants_spins: 0;
  grants_xp: 0;
  grants_rank_advantage: 0;
  grants_discovery_advantage: 0;
  grants_review_advantage: 0;
  grants_event_advantage: 0;
  grants_server_wars_advantage: 0;
  grants_ctf_advantage: 0;
  grants_competitive_eligibility: 0;
};

type SupporterCardRow = {
  id: string;
  user_id: string;
  entitlement_id: string;
  source_order_id: string;
  source_order_item_id: string;
  serial_number: string;
  display_name_snapshot: string;
  selected_theme_key: string;
  generated_insignia_json: string;
  status: string;
};

class FakeD1Database {
  operations: FakeOperation[] = [];
  orders = new Map<string, StoreOrderRow>();
  paymentEvents: PaymentEventRow[] = [];
  fulfilmentAttempts: FulfilmentAttemptRow[] = [];
  accountEntitlements: AccountEntitlementRow[] = [];
  supporterCards: SupporterCardRow[] = [];
  orderStatusHistory: Array<{ order_id: string; from_status: string | null; to_status: string; reason_code: string }> = [];
  entitlementStatusHistory: Array<{ entitlement_id: string | null; supporter_card_id: string | null; to_status: string; reason_code: string }> = [];
  refundDisputeAudit: Array<{ order_id: string; event_type: string; refund_kind: string | null; local_decision: string }> = [];

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  first(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "first", sql, bindings });
    if (/SELECT\s+id\s+FROM\s+store_orders\s+WHERE\s+id\s+=/i.test(sql)) {
      const order = this.orders.get(String(bindings[0]));
      return order ? { id: order.order_id } : null;
    }
    if (/FROM\s+store_payment_events/i.test(sql)) {
      return this.paymentEvents.find((row) => row.stripe_event_id === bindings[0]) ?? null;
    }
    if (/SELECT\s+status\s+FROM\s+store_orders/i.test(sql)) {
      const order = this.orders.get(String(bindings[0]));
      return order ? { status: order.order_status } : null;
    }
    if (/FROM\s+store_orders/i.test(sql) && /INNER\s+JOIN\s+store_order_items/i.test(sql)) {
      const order = this.orders.get(String(bindings[0]));
      if (!order) return null;
      const entitlement = this.accountEntitlements.find((row) => row.source_order_item_id === order.order_item_id) ?? null;
      const card = this.supporterCards.find((row) => row.source_order_item_id === order.order_item_id) ?? null;
      return {
        ...order,
        entitlement_id: entitlement?.id ?? null,
        entitlement_status: entitlement?.status ?? null,
        supporter_card_id: card?.id ?? null,
        supporter_card_status: card?.status ?? null,
      };
    }
    if (/FROM\s+account_entitlements\s+WHERE\s+source_order_item_id/i.test(sql)) {
      const row = this.accountEntitlements.find((candidate) => candidate.source_order_item_id === bindings[0]);
      return row ? { id: row.id, status: row.status, source_order_item_id: row.source_order_item_id } : null;
    }
    if (/FROM\s+account_entitlements/i.test(sql) && /entitlement_key/i.test(sql)) {
      const row = this.accountEntitlements.find((candidate) => candidate.user_id === bindings[0]
        && candidate.entitlement_key === bindings[1]
        && candidate.source_order_item_id !== bindings[2]
        && candidate.status !== "revoked");
      return row ? { id: row.id, status: row.status, source_order_item_id: row.source_order_item_id } : null;
    }
    if (/FROM\s+supporter_cards\s+WHERE\s+source_order_item_id/i.test(sql)) {
      const row = this.supporterCards.find((candidate) => candidate.source_order_item_id === bindings[0]);
      return row ? { id: row.id, serial_number: row.serial_number, status: row.status } : null;
    }
    if (/FROM\s+supporter_cards\s+WHERE\s+user_id/i.test(sql)) {
      const row = this.supporterCards.find((candidate) => candidate.user_id === bindings[0]);
      return row ? { id: row.id, serial_number: row.serial_number, status: row.status } : null;
    }
    if (/FROM\s+store_fulfilment_attempts\s+WHERE\s+payment_event_id/i.test(sql)) {
      const row = this.fulfilmentAttempts.find((candidate) => candidate.payment_event_id === bindings[0]);
      return row ? {
        id: row.id,
        status: row.status,
        entitlement_id: row.entitlement_id,
        supporter_card_id: row.supporter_card_id,
      } : null;
    }
    return null;
  }

  run(sql: string, bindings: unknown[]) {
    this.operations.push({ type: "run", sql, bindings });
    if (/INSERT\s+INTO\s+store_payment_events/i.test(sql)) return this.insertPaymentEvent(bindings);
    if (/INSERT\s+INTO\s+store_fulfilment_attempts/i.test(sql)) return this.insertFulfilmentAttempt(bindings);
    if (/UPDATE\s+store_fulfilment_attempts/i.test(sql)) return this.updateFulfilmentAttempt(bindings);
    if (/UPDATE\s+store_orders/i.test(sql) && /status\s+=\s+'paid'/i.test(sql)) return this.markOrderPaid(bindings);
    if (/UPDATE\s+store_orders/i.test(sql)) return this.updateOrderStatus(bindings);
    if (/INSERT\s+INTO\s+store_order_status_history/i.test(sql)) return this.insertOrderStatusHistory(bindings);
    if (/INSERT\s+INTO\s+account_entitlements/i.test(sql)) return this.insertAccountEntitlement(bindings);
    if (/INSERT\s+INTO\s+store_entitlement_status_history/i.test(sql)) return this.insertEntitlementStatusHistory(bindings);
    if (/INSERT\s+INTO\s+supporter_cards/i.test(sql)) return this.insertSupporterCard(bindings);
    if (/INSERT\s+INTO\s+store_refund_dispute_audit/i.test(sql)) return this.insertRefundDisputeAudit(bindings);
    if (/UPDATE\s+account_entitlements/i.test(sql)) return this.updateAccountEntitlement(bindings);
    if (/UPDATE\s+supporter_cards/i.test(sql)) return this.updateSupporterCard(bindings);
    return d1Result(0);
  }

  private insertPaymentEvent(bindings: unknown[]) {
    const stripeEventId = String(bindings[1]);
    if (this.paymentEvents.some((row) => row.stripe_event_id === stripeEventId)) return d1Result(0);
    this.paymentEvents.push({
      id: String(bindings[0]),
      stripe_event_id: stripeEventId,
      event_type: String(bindings[2]),
      event_class: String(bindings[3]),
      ledger_scope: String(bindings[5]) as "local" | "sandbox",
      livemode: 0,
      processing_status: String(bindings[7]),
      related_order_id: typeof bindings[8] === "string" ? bindings[8] : null,
      stripe_checkout_session_id: typeof bindings[9] === "string" ? bindings[9] : null,
      stripe_payment_intent_id: typeof bindings[10] === "string" ? bindings[10] : null,
      stripe_charge_id: typeof bindings[11] === "string" ? bindings[11] : null,
      stripe_refund_id: typeof bindings[12] === "string" ? bindings[12] : null,
      stripe_dispute_id: typeof bindings[13] === "string" ? bindings[13] : null,
    });
    return d1Result(1);
  }

  private insertFulfilmentAttempt(bindings: unknown[]) {
    const paymentEventId = String(bindings[2]);
    if (this.fulfilmentAttempts.some((row) => row.payment_event_id === paymentEventId)) return d1Result(0);
    this.fulfilmentAttempts.push({
      id: String(bindings[0]),
      payment_event_id: paymentEventId,
      stripe_event_id: String(bindings[3]),
      event_type: String(bindings[4]),
      order_id: String(bindings[5]),
      order_item_id: String(bindings[6]),
      status: String(bindings[8]),
      entitlement_id: null,
      supporter_card_id: null,
    });
    return d1Result(1);
  }

  private updateFulfilmentAttempt(bindings: unknown[]) {
    const attempt = this.fulfilmentAttempts.find((row) => row.id === bindings[11]);
    if (!attempt) return d1Result(0);
    attempt.status = String(bindings[0]);
    if (typeof bindings[3] === "string") attempt.entitlement_id = bindings[3];
    if (typeof bindings[4] === "string") attempt.supporter_card_id = bindings[4];
    return d1Result(1);
  }

  private markOrderPaid(bindings: unknown[]) {
    const order = this.orders.get(String(bindings[2]));
    if (!order || !["checkout_created", "payment_pending"].includes(order.order_status)) return d1Result(0);
    order.order_status = "paid";
    order.paid_at = String(bindings[0]);
    return d1Result(1);
  }

  private updateOrderStatus(bindings: unknown[]) {
    const status = String(bindings[0]);
    const orderId = String(bindings[bindings.length - 1]);
    const order = this.orders.get(orderId);
    if (!order) return d1Result(0);
    order.order_status = status;
    if (status === "refunded") order.refunded_at = String(bindings[1]);
    if (status === "revoked") order.revoked_at = String(bindings[1]);
    return d1Result(1);
  }

  private insertOrderStatusHistory(bindings: unknown[]) {
    if (this.orderStatusHistory.some((row) => row.order_id === bindings[1] && row.to_status === bindings[4])) return d1Result(0);
    this.orderStatusHistory.push({
      order_id: String(bindings[1]),
      from_status: typeof bindings[3] === "string" ? bindings[3] : null,
      to_status: String(bindings[4]),
      reason_code: String(bindings[5]),
    });
    return d1Result(1);
  }

  private insertAccountEntitlement(bindings: unknown[]) {
    const sourceOrderItemId = String(bindings[4]);
    const userId = String(bindings[1]);
    const entitlementKey = String(bindings[2]);
    if (this.accountEntitlements.some((row) => row.source_order_item_id === sourceOrderItemId)) return d1Result(0);
    if (this.accountEntitlements.some((row) => row.user_id === userId
      && row.entitlement_key === entitlementKey
      && row.source_order_item_id !== sourceOrderItemId
      && row.status !== "revoked")) {
      return d1Result(0);
    }
    this.accountEntitlements.push({
      id: String(bindings[0]),
      user_id: userId,
      entitlement_key: entitlementKey,
      source_order_id: String(bindings[3]),
      source_order_item_id: sourceOrderItemId,
      source_product_key: String(bindings[5]),
      source_product_type: String(bindings[6]),
      source_fulfilment_kind: String(bindings[7]),
      status: "active",
      visibility_state: "visible",
      granted_by_payment_event_id: String(bindings[8]),
      revoked_by_payment_event_id: null,
      grants_owner_subscription_access: 0,
      grants_spins: 0,
      grants_xp: 0,
      grants_rank_advantage: 0,
      grants_discovery_advantage: 0,
      grants_review_advantage: 0,
      grants_event_advantage: 0,
      grants_server_wars_advantage: 0,
      grants_ctf_advantage: 0,
      grants_competitive_eligibility: 0,
    });
    return d1Result(1);
  }

  private insertEntitlementStatusHistory(bindings: unknown[]) {
    this.entitlementStatusHistory.push({
      entitlement_id: typeof bindings[1] === "string" ? bindings[1] : null,
      supporter_card_id: typeof bindings[2] === "string" ? bindings[2] : null,
      to_status: String(bindings[6]),
      reason_code: String(bindings[7]),
    });
    return d1Result(1);
  }

  private insertSupporterCard(bindings: unknown[]) {
    const sourceOrderItemId = String(bindings[4]);
    const serial = String(bindings[5]);
    if (this.supporterCards.some((row) => row.source_order_item_id === sourceOrderItemId || row.user_id === bindings[1] || row.serial_number === serial)) {
      return d1Result(0);
    }
    this.supporterCards.push({
      id: String(bindings[0]),
      user_id: String(bindings[1]),
      entitlement_id: String(bindings[2]),
      source_order_id: String(bindings[3]),
      source_order_item_id: sourceOrderItemId,
      serial_number: serial,
      display_name_snapshot: String(bindings[6]),
      selected_theme_key: String(bindings[8]),
      generated_insignia_json: String(bindings[10]),
      status: "active",
    });
    return d1Result(1);
  }

  private insertRefundDisputeAudit(bindings: unknown[]) {
    const paymentEventId = String(bindings[1]);
    if (this.refundDisputeAudit.some((row) => row.event_type === bindings[3] && this.paymentEvents.find((event) => event.id === paymentEventId))) return d1Result(0);
    this.refundDisputeAudit.push({
      order_id: String(bindings[2]),
      event_type: String(bindings[3]),
      refund_kind: typeof bindings[9] === "string" ? bindings[9] : null,
      local_decision: String(bindings[11]),
    });
    return d1Result(1);
  }

  private updateAccountEntitlement(bindings: unknown[]) {
    const row = this.accountEntitlements.find((candidate) => candidate.id === bindings[12] && candidate.source_order_item_id === bindings[13]);
    if (!row) return d1Result(0);
    row.status = String(bindings[0]);
    if (row.status === "revoked") row.revoked_by_payment_event_id = String(bindings[7]);
    return d1Result(1);
  }

  private updateSupporterCard(bindings: unknown[]) {
    const row = this.supporterCards.find((candidate) => candidate.id === bindings[11] && candidate.source_order_item_id === bindings[12]);
    if (!row) return d1Result(0);
    row.status = String(bindings[0]);
    return d1Result(1);
  }
}

class FulfilmentReadThrowingD1Database extends FakeD1Database {
  first(sql: string, bindings: unknown[]) {
    if (/FROM\s+store_payment_events/i.test(sql) && this.paymentEvents.length > 0) {
      throw new Error("Injected fulfilment read failure.");
    }
    return super.first(sql, bindings);
  }
}

class FakeD1Statement {
  private bindings: unknown[] = [];

  constructor(private readonly db: FakeD1Database, private readonly sql: string) {}

  bind(...bindings: unknown[]) {
    this.bindings = bindings;
    return this;
  }

  first<T>() {
    return Promise.resolve(this.db.first(this.sql, this.bindings) as T | null);
  }

  run() {
    return Promise.resolve(this.db.run(this.sql, this.bindings));
  }
}

function d1Result(changes: number) {
  return { success: true, meta: { changes, rows_written: changes, rowsWritten: changes } };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
