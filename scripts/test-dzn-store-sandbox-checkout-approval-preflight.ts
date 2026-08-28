import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PREFLIGHT = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md";
const HANDOFF = "docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT_HANDOFF.md";
const SAFE_PREFLIGHT = "docs/DZN_SAFE_MONETISATION_SUPPORTER_IMPLEMENTATION_PREFLIGHT.md";
const BACKLOG = "docs/DZN_SAFE_MONETISATION_SUPPORTER_SYSTEM_BACKLOG.md";
const MASTER_SPEC = "docs/DZN_PLAYER_OWNER_PLATFORM_SPEC.md";
const PUBLIC_ACCESS_POLICY = "docs/PUBLIC_ACCESS_POLICY.md";
const BILLING_PLANS = "docs/BILLING_PLANS.md";
const STRIPE_LIVE_CHECKLIST = "docs/STRIPE_LIVE_ACTIVATION_CHECKLIST.md";
const STORE_PUBLIC_HANDOFF = "docs/DZN_STORE_PUBLIC_PREVIEW_CONTRACT_HANDOFF.md";
const STRIPE_HELPER = "functions/_lib/stripe.ts";
const PLANS_HELPER = "functions/_lib/plans.ts";
const OWNER_CHECKOUT_ROUTE = "functions/api/billing/create-checkout-session.ts";
const OWNER_PORTAL_ROUTE = "functions/api/billing/create-portal-session.ts";
const OWNER_WEBHOOK = "functions/api/stripe/webhook.ts";
const STORE_CATALOG_HELPER = "functions/_lib/dzn-store-catalog.ts";
const STORE_CATALOG_MIGRATION = "migrations/0071_dzn_store_catalog_admin_draft.sql";
const STORE_ORDER_LEDGER_MIGRATION = "migrations/0072_dzn_store_order_ledger_schema.sql";
const STORE_ORDER_ROUTE = "functions/api/store/orders.ts";
const STORE_ORDER_HELPER = "functions/_lib/dzn-store-orders.ts";
const STORE_CHECKOUT_SESSION_ROUTE = "functions/api/store/orders/[orderId]/checkout.ts";
const STORE_CHECKOUT_SESSION_HELPER = "functions/_lib/dzn-store-checkout.ts";
const STORE_CHECKOUT_SESSION_DOC = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL.md";
const STORE_CHECKOUT_SESSION_HANDOFF = "docs/DZN_STORE_SANDBOX_CHECKOUT_SESSION_APPROVAL_HANDOFF.md";
const STORE_WEBHOOK_ROUTE = "functions/api/stripe/store-webhook.ts";
const STORE_WEBHOOK_HELPER = "functions/_lib/dzn-store-webhook.ts";
const STORE_WEBHOOK_DOC = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT.md";
const STORE_WEBHOOK_HANDOFF = "docs/DZN_STORE_SANDBOX_WEBHOOK_LEDGER_RECEIPT_HANDOFF.md";
const STORE_PREVIEW_PAGE = "app/store/page.tsx";
const STORE_PREVIEW_COMPONENT = "components/store/dzn-store-preview-page.tsx";
const PACKAGE_JSON = "package.json";

const REQUIRED_PREFLIGHT_SNIPPETS = [
  "DZN Store Sandbox Order And Checkout Approval Preflight",
  "This slice is approval preflight only.",
  "`DZN_LIVE_CHECKOUT_ENABLED` remains unset/false.",
  "Issue #49 remains reserved for final live owner-subscription checkout activation",
  "Architecture Baseline",
  "`functions/api/billing/create-checkout-session.ts` creates Starter/Pro owner subscription Checkout Sessions with `mode: \"subscription\"`.",
  "`functions/_lib/stripe.ts` owns Stripe API helpers and raw-body webhook signature verification.",
  "External References Reviewed On 2026-08-27",
  "https://docs.stripe.com/api/checkout/sessions/create",
  "https://docs.stripe.com/webhooks/signature",
  "https://docs.stripe.com/api/idempotent_requests",
  "https://docs.stripe.com/api/events/types",
  "https://docs.stripe.com/refunds",
  "https://docs.stripe.com/disputes/api",
  "Approval Gates Before Runtime",
  "Authenticated Order Creation Contract",
  "POST /api/store/orders",
  "The backend must derive the purchasing DZN user and Discord identity from the session.",
  "Feature gates before any Stripe call",
  "`DZN_STORE_SANDBOX_CHECKOUT_ENABLED=true`",
  "`DZN_STORE_LIVE_CHECKOUT_ENABLED=false`",
  "One-Time Stripe Checkout Session Shape",
  "mode = payment",
  "client_reference_id = local DZN Store order id or order number",
  "metadata[dzn_context] = dzn_store",
  "Use `mode=payment`, not subscription mode.",
  "Use a Stripe idempotency key derived from the local order id",
  "Do not fulfil from the Checkout success redirect.",
  "Webhook Event Ledger Contract",
  "POST /api/stripe/store-webhook",
  "Verify the `Stripe-Signature` header against the unmodified raw request body before parsing.",
  "`checkout.session.completed`",
  "`checkout.session.async_payment_succeeded`",
  "`checkout.session.expired`",
  "`payment_intent.succeeded`",
  "`refund.created`",
  "`refund.updated`",
  "`charge.refunded`",
  "`charge.dispute.created`",
  "`charge.dispute.closed`",
  "Duplicate Stripe event ids must be side-effect-free.",
  "Idempotent Fulfilment Rules",
  "Exactly-once controls",
  "Never issue more than one Founding Supporter Card per qualifying account.",
  "Refund, Reversal, And Chargeback Revocation Plan",
  "Partial refunds require a separate product/refund policy review",
  "Tax, Receipt, And Private Payment Record Boundaries",
  "Do not store in DZN:",
  "Feature-Flag Defaults",
  "`DZN_STORE_WEBHOOK_FULFILMENT_ENABLED`",
  "Rollback Path",
  "Proof Matrix Before Runtime",
  "Success redirect does not grant",
  "Purchases cannot grant spins",
  "No Stripe live objects, Cloudflare secrets/config, production D1 writes, deployments, live checkout activation, or issue #49 changes",
  "Explicitly Blocked From This Preflight",
  "Next should be the DZN Store sandbox order ledger schema preflight/implementation slice only if deliberately approved",
];

const INTEGRATION_SNIPPETS: Record<string, string[]> = {
  [SAFE_PREFLIGHT]: [
    "The DZN Store sandbox order and checkout approval preflight is delivered as a documentation/test-guard slice",
    "`docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`",
    "The next payment-facing step must be a DZN Store sandbox order and checkout approval preflight",
    "No checkout route, order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change is added by the approval preflight.",
  ],
  [BACKLOG]: [
    "DZN Store Sandbox Order And Checkout Approval Preflight",
    "`docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`",
    "defines future `POST /api/store/orders` and `POST /api/stripe/store-webhook` contracts",
    "It creates no checkout route, order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 write, live checkout activation, or issue #49 change.",
  ],
  [MASTER_SPEC]: [
    "DZN Store Sandbox Order And Checkout Approval Preflight Slice",
    "`docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`",
    "future `POST /api/store/orders` contract",
    "one-time Stripe Checkout Session shape using `mode=payment`",
    "delivered as a documentation/test-guard slice",
  ],
  [PUBLIC_ACCESS_POLICY]: [
    "The DZN Store sandbox order and checkout approval preflight slice may define future authenticated `POST /api/store/orders`",
    "future `POST /api/stripe/store-webhook`",
    "It must not add checkout routes, order tables, payment webhook handlers, entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes.",
  ],
  [BILLING_PLANS]: [
    "The DZN Store sandbox order and checkout approval preflight defines the future authenticated order creation and one-time Stripe Checkout contract",
    "`mode=payment`",
    "No checkout route, Store order table, payment webhook, entitlement write, Supporter Card issuance, earned-spin ledger, wheel runtime, live checkout activation, or issue #49 change is added by that preflight.",
  ],
  [STRIPE_LIVE_CHECKLIST]: [
    "`docs/DZN_STORE_SANDBOX_ORDER_CHECKOUT_APPROVAL_PREFLIGHT.md`",
    "defines sandbox order creation, one-time Checkout Session shape, webhook event ledger, idempotent fulfilment, refund/chargeback revocation, tax/receipt records, feature flags, rollback, and proof matrix",
    "does not approve or implement checkout routes, order tables, Store webhooks, entitlement writes, Supporter Card issuance, earned-spin ledgers, wheel runtime, Stripe object mutation, Cloudflare secret/config mutation, production D1 writes, live checkout activation, or issue #49 changes",
  ],
  [STORE_PUBLIC_HANDOFF]: [
    "Next should be the DZN Store sandbox order and checkout approval preflight",
    "No checkout sessions.",
    "No orders.",
    "No webhooks.",
  ],
  [HANDOFF]: [
    "DZN Store Sandbox Order And Checkout Approval Preflight Handoff",
    "Protected OneDrive checkout was not modified.",
    "Contract Defined",
    "Future authenticated `POST /api/store/orders`.",
    "Server-side one-time Stripe Checkout Session shape using `mode=payment`.",
    "Future `POST /api/stripe/store-webhook` verification and event-ledger rules.",
    "Production-Mutation Confirmation",
    "Next should be the DZN Store sandbox order ledger schema preflight/implementation slice only if deliberately approved",
  ],
};

const FORBIDDEN_RUNTIME_PATHS = [
  "functions/api/supporter",
  "functions/api/wheel",
  "functions/api/billing/create-store-checkout-session.ts",
  "functions/api/billing/create-one-time-checkout-session.ts",
  "functions/api/stripe/store",
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
];

const FUTURE_STORE_FLAGS = [
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
  "NEXT_PUBLIC_DZN_STORE_ENABLED",
];

const RUNTIME_TABLES_BLOCKED_IN_THIS_SLICE = [
  "store_orders",
  "store_order_items",
  "store_payment_events",
  "account_entitlements",
  "supporter_cards",
  "earned_spins",
  "spin_ledger",
  "wheel_cooldowns",
];

const ORDER_LEDGER_TABLES_ALLOWED_AFTER_FOLLOW_ON_SLICE = [
  "store_orders",
  "store_order_items",
  "store_payment_events",
];

const RUNTIME_TABLES_STILL_BLOCKED_AFTER_LEDGER_SCHEMA = RUNTIME_TABLES_BLOCKED_IN_THIS_SLICE.filter(
  (table) => !ORDER_LEDGER_TABLES_ALLOWED_AFTER_FOLLOW_ON_SLICE.includes(table),
);

const CHECKOUT_RUNTIME_PATTERNS = [
  /\bcheckout\.sessions\.create\b/i,
  /\/checkout\/sessions/i,
  /\bmode\s*[:=]\s*["']payment["']/i,
  /\bpayment_intent\.succeeded\b/i,
  /\bpayment_intent\.payment_failed\b/i,
  /\brefund\.created\b/i,
  /\brefund\.updated\b/i,
  /\bcharge\.refunded\b/i,
  /\bcharge\.dispute/i,
  /\bINSERT\s+INTO\s+store_orders\b/i,
  /\bINSERT\s+INTO\s+store_order_items\b/i,
  /\bINSERT\s+INTO\s+store_payment_events\b/i,
  /\bINSERT\s+INTO\s+account_entitlements\b/i,
  /\bINSERT\s+INTO\s+supporter_cards\b/i,
  /\bINSERT\s+INTO\s+earned_spins\b/i,
  /\bINSERT\s+INTO\s+spin_ledger\b/i,
  /\bUPDATE\s+account_entitlements\b/i,
  /\bUPDATE\s+supporter_cards\b/i,
  /\bSTRIPE_SECRET_KEY\b/i,
  /\bSTRIPE_WEBHOOK_SECRET\b/i,
  /\bverifyStripeWebhook\b/i,
  /\bstripeFormRequest\b/i,
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

main();

function main() {
  assertFilesExist();
  assertPreflightDoc();
  assertIntegratedDocs();
  assertExistingPaymentRuntimeStillSubscriptionOnly();
  assertNoRuntimePaths();
  assertNoRuntimeTablesAdded();
  assertNoRuntimeEnvOrConfigFlags();
  assertNoCheckoutRuntimePatternsBeyondAllowedExistingFiles();
  assertStorePreviewStillReadOnly();
  assertNoNewProviderDependencies();
  assertPackageScript();
  console.log("DZN Store sandbox order and checkout approval preflight tests passed.");
}

function assertFilesExist() {
  for (const path of [
    PREFLIGHT,
    HANDOFF,
    SAFE_PREFLIGHT,
    BACKLOG,
    MASTER_SPEC,
    PUBLIC_ACCESS_POLICY,
    BILLING_PLANS,
    STRIPE_LIVE_CHECKLIST,
    STORE_PUBLIC_HANDOFF,
    STRIPE_HELPER,
    PLANS_HELPER,
    OWNER_CHECKOUT_ROUTE,
    OWNER_PORTAL_ROUTE,
    OWNER_WEBHOOK,
    STORE_CATALOG_HELPER,
    STORE_PREVIEW_PAGE,
    STORE_PREVIEW_COMPONENT,
    STORE_ORDER_ROUTE,
    STORE_ORDER_HELPER,
    STORE_CHECKOUT_SESSION_ROUTE,
    STORE_CHECKOUT_SESSION_HELPER,
    STORE_CHECKOUT_SESSION_DOC,
    STORE_CHECKOUT_SESSION_HANDOFF,
    STORE_WEBHOOK_ROUTE,
    STORE_WEBHOOK_HELPER,
    STORE_WEBHOOK_DOC,
    STORE_WEBHOOK_HANDOFF,
    PACKAGE_JSON,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }
}

function assertPreflightDoc() {
  const source = read(PREFLIGHT);
  for (const snippet of REQUIRED_PREFLIGHT_SNIPPETS) {
    assert.equal(source.includes(snippet), true, `${PREFLIGHT} must include: ${snippet}`);
  }

  for (const forbiddenAdvantage of [
    "spins, XP, rank, discovery score, review score, event advantage, Server Wars advantage, CTF advantage, owner subscription access, server ownership, Nitrado access, or competitive eligibility",
    "Store purchases cannot grant XP, earned challenge progress, badges, seasons, crowns, rankings, discovery, review score, events, CTF scoring, Server Wars scoring, public profile visibility, retained exports, moderation outcomes, or competitive eligibility.",
    "Purchases cannot grant spins, bypass wheel cooldowns, alter daily spin allowance, alter reward odds, or change wheel outcomes.",
  ]) {
    assert.equal(source.includes(forbiddenAdvantage), true, `${PREFLIGHT} must preserve Fair Progression Boundary wording.`);
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

function assertExistingPaymentRuntimeStillSubscriptionOnly() {
  const ownerCheckout = read(OWNER_CHECKOUT_ROUTE);
  assert.equal(ownerCheckout.includes('mode: "subscription"'), true, "Owner checkout must remain subscription mode.");
  assert.equal(ownerCheckout.includes('mode: "payment"'), false, "This slice must not add Store payment mode to the owner checkout route.");
  assert.equal(ownerCheckout.includes("getCheckoutSafetyStatus"), true, "Owner checkout must keep the canonical checkout safety gate.");

  const ownerWebhook = read(OWNER_WEBHOOK);
  assert.equal(ownerWebhook.includes("checkout.session.completed"), true, "Existing owner webhook still handles subscription checkout completion.");
  assert.equal(ownerWebhook.includes("customer.subscription.updated"), true, "Existing owner webhook still handles subscription events.");
  for (const table of RUNTIME_TABLES_BLOCKED_IN_THIS_SLICE) {
    assert.equal(ownerWebhook.includes(table), false, `Owner webhook must not write future Store table ${table}.`);
  }

  const stripeHelper = read(STRIPE_HELPER);
  assert.equal(stripeHelper.includes("export async function verifyStripeWebhook"), true, "Stripe helper must keep webhook verification.");
  assert.equal(stripeHelper.includes('request.headers.get("stripe-signature")'), true, "Webhook verification must read Stripe-Signature.");
  assert.equal(stripeHelper.includes("await request.text()"), true, "Webhook verification must preserve raw request body.");
  assert.equal(stripeHelper.includes("timingSafeEqual"), true, "Webhook verification must keep timing-safe comparison.");

  const plansHelper = read(PLANS_HELPER);
  assert.equal(plansHelper.includes("DZN_LIVE_CHECKOUT_ENABLED"), true, "Canonical owner billing helper must keep DZN_LIVE_CHECKOUT_ENABLED.");
  assert.equal(plansHelper.includes("checkoutSessionCreationAllowed"), true, "Canonical owner billing helper must expose checkout safety status.");
}

function assertNoRuntimePaths() {
  for (const path of FORBIDDEN_RUNTIME_PATHS) {
    assert.equal(existsSync(path), false, `${path} must not be introduced by this approval preflight.`);
  }
}

function assertNoRuntimeTablesAdded() {
  const migrationFiles = listFiles("migrations").map((path) => path.replace(/\\/g, "/"));
  const forbiddenNamedMigrations = migrationFiles.filter((path) =>
    path !== STORE_CATALOG_MIGRATION &&
    path !== STORE_ORDER_LEDGER_MIGRATION &&
    /(?:order|orders|payment_event|account_entitlement|supporter_card|earned_spin|spin_ledger|wheel_cooldown|checkout|webhook|purchase)/i.test(path),
  );
  assert.deepEqual(forbiddenNamedMigrations, [], "Only the approved follow-on Store order ledger schema migration may add order/payment ledger tables.");

  for (const path of migrationFiles.filter((path) => path.endsWith(".sql"))) {
    const source = read(path);
    const blockedTables = path === STORE_ORDER_LEDGER_MIGRATION
      ? RUNTIME_TABLES_STILL_BLOCKED_AFTER_LEDGER_SCHEMA
      : RUNTIME_TABLES_BLOCKED_IN_THIS_SLICE;
    for (const table of blockedTables) {
      assert.equal(source.includes(table), false, `${path} must not create blocked Store runtime table ${table}.`);
    }
  }
}

function assertNoRuntimeEnvOrConfigFlags() {
  for (const path of ["cloudflare-env.d.ts", "wrangler.toml", "wrangler.adm-sync.toml", "wrangler.auto-update.toml"].filter(existsSync)) {
    const source = read(path);
    for (const flag of FUTURE_STORE_FLAGS) {
      assert.equal(source.includes(flag), false, `${path} must not declare or enable future Store flag ${flag} in this preflight.`);
    }
  }
}

function assertNoCheckoutRuntimePatternsBeyondAllowedExistingFiles() {
  const runtimeFiles = [
    ...listFiles("app"),
    ...listFiles("components"),
    ...listFiles("functions"),
    ...listFiles("lib"),
  ].filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path));

  const allowedExistingPaymentFiles = new Set([
    PLANS_HELPER,
    STRIPE_HELPER,
    OWNER_CHECKOUT_ROUTE,
    OWNER_PORTAL_ROUTE,
    OWNER_WEBHOOK,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedCatalogAndPreviewFiles = new Set([
    STORE_CATALOG_HELPER,
    STORE_PREVIEW_PAGE,
    STORE_PREVIEW_COMPONENT,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedStoreOrderFiles = new Set([
    STORE_ORDER_ROUTE,
    STORE_ORDER_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedStoreCheckoutSessionFiles = new Set([
    STORE_CHECKOUT_SESSION_ROUTE,
    STORE_CHECKOUT_SESSION_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));
  const allowedStoreWebhookReceiptFiles = new Set([
    STORE_WEBHOOK_ROUTE,
    STORE_WEBHOOK_HELPER,
  ].map((path) => path.replace(/\\/g, "/")));

  for (const rawPath of runtimeFiles) {
    const path = rawPath.replace(/\\/g, "/");
    if (allowedExistingPaymentFiles.has(path)) continue;
    if (allowedStoreOrderFiles.has(path)) {
      const source = read(path);
      assert.equal(source.includes("checkout_session_creation_requires_future_approval") || path === STORE_ORDER_ROUTE, true, `${path} must keep checkout session creation future-only.`);
      assert.equal(source.includes("INSERT INTO store_orders"), path === STORE_ORDER_HELPER, `${path} must keep order inserts isolated to the Store order helper.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), path === STORE_ORDER_HELPER, `${path} must keep order-item inserts isolated to the Store order helper.`);
      for (const forbidden of [
        /\bcheckout\.sessions\.create\b/i,
        /\/checkout\/sessions/i,
        /\bmode\s*[:=]\s*["']payment["']/i,
        /\bpayment_intent\.succeeded\b/i,
        /\bpayment_intent\.payment_failed\b/i,
        /\brefund\.created\b/i,
        /\brefund\.updated\b/i,
        /\bcharge\.refunded\b/i,
        /\bcharge\.dispute/i,
        /\bINSERT\s+INTO\s+store_payment_events\b/i,
        /\bINSERT\s+INTO\s+account_entitlements\b/i,
        /\bINSERT\s+INTO\s+supporter_cards\b/i,
        /\bINSERT\s+INTO\s+earned_spins\b/i,
        /\bINSERT\s+INTO\s+spin_ledger\b/i,
        /\bUPDATE\s+account_entitlements\b/i,
        /\bUPDATE\s+supporter_cards\b/i,
        /\bSTRIPE_SECRET_KEY\b/i,
        /\bSTRIPE_WEBHOOK_SECRET\b/i,
        /\bverifyStripeWebhook\b/i,
        /\bstripeFormRequest\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store checkout/webhook/fulfilment pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowedStoreCheckoutSessionFiles.has(path)) {
      const source = read(path);
      assert.equal(
        source.includes("createDznStoreSandboxCheckoutSession") || source.includes("DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED"),
        true,
        `${path} must be part of the explicit sandbox Checkout Session approval surface.`,
      );
      assert.equal(
        source.includes("getRequestSessionUser") || source.includes("purchasing_user_id"),
        true,
        `${path} must scope Store checkout creation to the authenticated purchasing user.`,
      );
      assert.equal(source.includes("INSERT INTO store_orders"), false, `${path} must not create Store orders.`);
      assert.equal(source.includes("INSERT INTO store_order_items"), false, `${path} must not create Store order items.`);
      assert.equal(source.includes("UPDATE store_orders"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep checkout status updates isolated to the Store checkout helper.`);
      assert.equal(source.includes("/checkout/sessions"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep Stripe Checkout API calls isolated to the Store checkout helper.`);
      assert.equal(source.includes("stripeFormRequest"), path === STORE_CHECKOUT_SESSION_HELPER, `${path} must keep Stripe form requests isolated to the Store checkout helper.`);
      for (const forbidden of [
        /\bcheckout\.sessions\.create\b/i,
        /\bpayment_intent\.succeeded\b/i,
        /\bpayment_intent\.payment_failed\b/i,
        /\brefund\.created\b/i,
        /\brefund\.updated\b/i,
        /\bcharge\.refunded\b/i,
        /\bcharge\.dispute/i,
        /\bINSERT\s+INTO\s+store_payment_events\b/i,
        /\bINSERT\s+INTO\s+account_entitlements\b/i,
        /\bINSERT\s+INTO\s+supporter_cards\b/i,
        /\bINSERT\s+INTO\s+earned_spins\b/i,
        /\bINSERT\s+INTO\s+spin_ledger\b/i,
        /\bUPDATE\s+account_entitlements\b/i,
        /\bUPDATE\s+supporter_cards\b/i,
        /\bSTRIPE_WEBHOOK_SECRET\b/i,
        /\bverifyStripeWebhook\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store webhook/fulfilment pattern ${forbidden}.`);
      }
      continue;
    }
    if (allowedStoreWebhookReceiptFiles.has(path)) {
      const source = read(path);
      assert.equal(
        source.includes("receiveDznStoreSandboxWebhookReceipt") || source.includes("DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED"),
        true,
        `${path} must be part of the explicit sandbox webhook receipt surface.`,
      );
      assert.equal(source.includes("INSERT INTO store_payment_events"), path === STORE_WEBHOOK_HELPER, `${path} must keep Store payment-event inserts isolated to the webhook helper.`);
      assert.equal(source.includes("UPDATE store_orders"), false, `${path} must not update Store orders.`);
      assert.equal(source.includes("INSERT INTO store_orders"), false, `${path} must not insert Store orders.`);
      assert.equal(source.includes("/checkout/sessions"), false, `${path} must not create Checkout Sessions.`);
      assert.equal(source.includes("stripeFormRequest"), false, `${path} must not call Stripe APIs.`);
      for (const forbidden of [
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
        /\bcheckout\.sessions\.create\b/i,
      ]) {
        assert.doesNotMatch(source, forbidden, `${path} must not contain Store fulfilment pattern ${forbidden}.`);
      }
      continue;
    }
    const source = read(path);
    const patterns = allowedCatalogAndPreviewFiles.has(path)
      ? CHECKOUT_RUNTIME_PATTERNS.filter((pattern) => ![
        "\\bDZN_STORE_ENABLED\\b",
        "\\bDZN_STORE_CHECKOUT_ENABLED\\b",
        "\\bDZN_STORE_SANDBOX_CHECKOUT_ENABLED\\b",
        "\\bDZN_STORE_WEBHOOK_FULFILMENT_ENABLED\\b",
        "\\bDZN_SUPPORTER_CARDS_ENABLED\\b",
        "\\bDZN_EARNED_SPINS_ENABLED\\b",
        "\\bDZN_REWARD_WHEEL_ENABLED\\b",
        "\\bDZN_STORE_ADMIN_ENABLED\\b",
        "\\bDZN_STORE_LIVE_CHECKOUT_ENABLED\\b",
        "\\bNEXT_PUBLIC_DZN_STORE_ENABLED\\b",
      ].includes(pattern.source))
      : CHECKOUT_RUNTIME_PATTERNS;
    for (const pattern of patterns) {
      assert.doesNotMatch(source, pattern, `${path} must not contain Store checkout/webhook/payment runtime pattern ${pattern}.`);
    }
  }
}

function assertStorePreviewStillReadOnly() {
  const page = read(STORE_PREVIEW_PAGE);
  assert.equal(page.includes("<DznStorePreviewPage />"), true, "Store route should still render the read-only preview component.");

  const component = read(STORE_PREVIEW_COMPONENT);
  assert.equal(component.includes('"use client"'), false, "Store preview must stay server-rendered.");
  assert.equal(component.includes('data-dzn-store-preview="read-only"'), true, "Store preview must keep read-only marker.");
  assert.equal(component.includes('data-dzn-store-checkout="disabled"'), true, "Store preview must keep checkout disabled marker.");
  assert.equal(component.includes("Checkout disabled"), true, "Store preview must visibly keep checkout disabled.");
  assert.equal(component.includes("/api/store"), false, "Store preview must not call Store APIs.");
  assert.equal(component.includes("/api/billing"), false, "Store preview must not call billing APIs.");
  assert.equal(component.includes("fetch("), false, "Store preview must not fetch runtime Store data.");
  assert.equal(component.includes("checkout.sessions.create"), false, "Store preview must not contain Stripe checkout runtime.");
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
  assert.deepEqual(forbidden, [], "This preflight must not add AI or metered provider dependencies.");
}

function assertPackageScript() {
  const packageJson = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:dzn-store-sandbox-checkout-approval-preflight"],
    "tsx scripts/test-dzn-store-sandbox-checkout-approval-preflight.ts",
    "Focused Store sandbox checkout approval preflight test should be wired into package scripts.",
  );
  assert.equal(
    packageJson.scripts?.test?.includes("npm run test:dzn-store-sandbox-checkout-approval-preflight"),
    true,
    "Full npm test should include the Store sandbox checkout approval preflight guard.",
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
