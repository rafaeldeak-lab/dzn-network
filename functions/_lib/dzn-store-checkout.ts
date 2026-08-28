import { requireDb } from "./db";
import {
  canCreateDznStoreSandboxOrder,
  DZN_STORE_STRIPE_PRICE_ID_PATTERN,
  type DznStoreSandboxLedgerScope,
} from "./dzn-store-orders";
import {
  getAppUrl,
  stripeFormRequest,
  stripeId,
  stripeTimestamp,
  type StripeCheckoutSession,
} from "./stripe";
import type { Env, SessionUser } from "./types";

export const DZN_STORE_SANDBOX_CHECKOUT_SESSION_SCHEMA_VERSION = "2026-08-27.sandbox-checkout-session-v1";
export const DZN_STORE_SANDBOX_CHECKOUT_SESSION_ROUTE = "/api/store/orders/:orderId/checkout";
export const DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG = "DZN_STORE_SANDBOX_CHECKOUT_SESSION_ENABLED";
export const DZN_STORE_CHECKOUT_SESSION_BODY_LIMIT_BYTES = 1024;

const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_RETURN_TO_LENGTH = 200;

const FORBIDDEN_CHECKOUT_FIELDS = [
  "userId",
  "user_id",
  "discordId",
  "discord_id",
  "discordUserId",
  "discord_user_id",
  "ownerId",
  "owner_id",
  "serverId",
  "server_id",
  "linkedServerId",
  "linked_server_id",
  "billingAccountId",
  "billing_account_id",
  "entitlementId",
  "entitlement_id",
  "productKey",
  "product_key",
  "priceId",
  "price_id",
  "stripePriceId",
  "stripe_price_id",
  "stripeCustomerId",
  "stripe_customer_id",
  "stripeCheckoutSessionId",
  "stripe_checkout_session_id",
  "stripePaymentIntentId",
  "stripe_payment_intent_id",
  "quantity",
  "amount",
  "currency",
  "livemode",
  "status",
  "successUrl",
  "success_url",
  "cancelUrl",
  "cancel_url",
] as const;

const ALLOWED_CHECKOUT_BODY_FIELDS = new Set(["returnTo"]);

export type DznStoreSandboxCheckoutRequestBody = {
  returnTo?: unknown;
};

export type DznStoreSandboxCheckoutInput = {
  orderId: string;
  returnTo: string;
};

export type DznStoreSandboxCheckoutResult =
  | { ok: true; status: 200; body: DznStoreSandboxCheckoutSuccessPayload }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 503; body: DznStoreSandboxCheckoutErrorPayload };

export type DznStoreSandboxCheckoutSuccessPayload = {
  ok: true;
  order: {
    id: string;
    order_number: string;
    status: "checkout_created";
    ledger_scope: DznStoreSandboxLedgerScope;
    livemode: false;
    checkout: {
      available: true;
      url: string;
      session_id: null;
      stripe_checkout_session_created: true;
      livemode: false;
      mode: "payment";
      expires_at: string | null;
    };
    safety: {
      account_bound: true;
      guaranteed_purchase: true;
      no_competitive_advantage: true;
      grants_spins: false;
      grants_xp: false;
      grants_owner_subscription_access: false;
      grants_competitive_eligibility: false;
    };
  };
  next_step: "redirect_to_test_mode_stripe_checkout";
};

export type DznStoreSandboxCheckoutErrorPayload = {
  ok: false;
  error: string;
  message: string;
  checkout_available: false;
  stripe_checkout_session_created: false;
  live_checkout_enabled: false;
};

export type StoreCheckoutSessionRequest = (
  env: Env,
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  options: { idempotencyKey: string },
) => Promise<StripeCheckoutSession>;

type SandboxCheckoutOptions = {
  request: Request;
  now?: Date;
  requestStripeCheckoutSession?: StoreCheckoutSessionRequest;
  hashValue?: (value: string) => Promise<string>;
};

type StoreCheckoutEnvRecord = Record<string, unknown>;

type StoreCheckoutOrderRow = {
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

export function canCreateDznStoreSandboxCheckoutSession(env: Env | StoreCheckoutEnvRecord = {}) {
  const base = canCreateDznStoreSandboxOrder(env as Env);
  if (!base.ok) {
    return {
      ok: false as const,
      status: base.status,
      code: base.code,
      message: base.message,
    };
  }

  if (!parseBooleanFlag(readEnvValue(env, DZN_STORE_SANDBOX_CHECKOUT_SESSION_FLAG))) {
    return {
      ok: false as const,
      status: 403 as const,
      code: "STORE_SANDBOX_CHECKOUT_SESSION_DISABLED",
      message: "DZN Store sandbox Checkout Session creation is disabled.",
    };
  }

  const secret = normalizeString(readEnvValue(env, "STRIPE_SECRET_KEY"));
  if (!secret) {
    return {
      ok: false as const,
      status: 403 as const,
      code: "STORE_STRIPE_TEST_SECRET_REQUIRED",
      message: "A test-mode Stripe secret is required before creating sandbox Store Checkout Sessions.",
    };
  }
  if (!secret.startsWith("sk_test_")) {
    return {
      ok: false as const,
      status: 403 as const,
      code: "STORE_STRIPE_TEST_SECRET_REQUIRED",
      message: "Sandbox Store Checkout Sessions require a Stripe test-mode secret key.",
    };
  }

  return {
    ok: true as const,
    runtime: base.runtime,
    flags: base.flags,
    stripeSecretMode: "test" as const,
  };
}

export function validateDznStoreSandboxCheckoutOrderId(value: unknown) {
  const orderId = normalizeRecordId(value);
  if (!orderId) {
    return validationError("INVALID_ORDER_ID", "Choose a valid pending DZN Store order.");
  }
  return { ok: true as const, value: orderId };
}

export function validateDznStoreSandboxCheckoutBody(input: unknown) {
  const record = asRecord(input);
  if (!record) {
    return validationError("INVALID_CHECKOUT_BODY", "Request body must be a JSON object.");
  }

  for (const field of Object.keys(record)) {
    if (!ALLOWED_CHECKOUT_BODY_FIELDS.has(field)) {
      return validationError("FORBIDDEN_CHECKOUT_FIELD", "Checkout Session creation derives product, price, identity, amount, Stripe, status, and redirect state on the server.");
    }
  }

  for (const field of FORBIDDEN_CHECKOUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      return validationError("FORBIDDEN_CHECKOUT_FIELD", "Checkout Session creation derives product, price, identity, amount, Stripe, status, and redirect state on the server.");
    }
  }

  const returnTo = normalizeReturnTo(record.returnTo);
  if (record.returnTo !== undefined && !returnTo) {
    return validationError("INVALID_RETURN_TO", "Return URL must be a same-site path.");
  }

  return {
    ok: true as const,
    value: {
      returnTo: returnTo ?? "/store",
    },
  };
}

export async function createDznStoreSandboxCheckoutSession(
  env: Env,
  user: SessionUser,
  input: DznStoreSandboxCheckoutInput,
  options: SandboxCheckoutOptions,
): Promise<DznStoreSandboxCheckoutResult> {
  const access = canCreateDznStoreSandboxCheckoutSession(env);
  if (!access.ok) return storeCheckoutError(access.status, access.code, access.message);

  let db: D1Database;
  try {
    db = requireDb(env);
  } catch {
    return storeCheckoutError(503, "STORE_CHECKOUT_DB_UNAVAILABLE", "DZN Store order storage is not configured.");
  }

  let row: StoreCheckoutOrderRow | null = null;
  try {
    row = await db
      .prepare(
        `SELECT
           store_orders.id AS order_id,
           store_orders.order_number,
           store_orders.purchasing_user_id,
           store_orders.status,
           store_orders.ledger_scope,
           store_orders.livemode,
           store_orders.product_count,
           store_orders.currency,
           store_orders.subtotal_amount_minor,
           store_orders.tax_amount_minor,
           store_orders.total_amount_minor,
           store_orders.selected_theme_key,
           store_orders.checkout_idempotency_key_hash,
           store_orders.stripe_checkout_session_id,
           store_orders.stripe_payment_intent_id,
           store_orders.stripe_customer_ref_hash,
           store_order_items.product_id,
           store_order_items.price_id,
           store_order_items.product_key,
           store_order_items.product_name_snapshot,
           store_order_items.product_type,
           store_order_items.fulfilment_kind,
           store_order_items.quantity,
           store_order_items.currency AS item_currency,
           store_order_items.unit_amount_minor,
           store_order_items.tax_amount_minor AS item_tax_amount_minor,
           store_order_items.total_amount_minor AS item_total_amount_minor,
           store_order_items.account_bound,
           store_order_items.guaranteed_purchase,
           store_order_items.no_competitive_advantage,
           store_order_items.grants_spins,
           store_order_items.grants_xp,
           store_order_items.grants_rank_advantage,
           store_order_items.grants_discovery_advantage,
           store_order_items.grants_review_advantage,
           store_order_items.grants_event_advantage,
           store_order_items.grants_server_wars_advantage,
           store_order_items.grants_ctf_advantage,
           store_order_items.grants_owner_subscription_access,
           store_order_items.grants_competitive_eligibility,
           store_prices.stripe_price_id,
           store_prices.status AS price_status,
           store_prices.active AS price_active
         FROM store_orders
         INNER JOIN store_order_items ON store_order_items.order_id = store_orders.id
         INNER JOIN store_prices ON store_prices.id = store_order_items.price_id
         WHERE store_orders.id = ?
           AND store_orders.purchasing_user_id = ?
         LIMIT 1`,
      )
      .bind(input.orderId, user.id)
      .first<StoreCheckoutOrderRow>();
  } catch {
    return storeCheckoutError(503, "STORE_ORDER_LOOKUP_FAILED", "Pending DZN Store order could not be checked.");
  }

  if (!row) {
    return storeCheckoutError(404, "STORE_ORDER_NOT_FOUND", "Pending DZN Store order was not found.");
  }

  const safety = validateOrderRowForCheckout(row);
  if (!safety.ok) return storeCheckoutError(safety.status, safety.error, safety.message);

  const idempotencyKey = checkoutIdempotencyKeyFromHash(row.checkout_idempotency_key_hash);
  if (!idempotencyKey) {
    return storeCheckoutError(422, "STORE_CHECKOUT_IDEMPOTENCY_KEY_INVALID", "Pending DZN Store order is missing a valid checkout idempotency key.");
  }

  const successUrl = storeCheckoutRedirectUrl(env, options.request, input.returnTo, "success", row.order_id);
  const cancelUrl = storeCheckoutRedirectUrl(env, options.request, input.returnTo, "cancelled", row.order_id);
  const params = {
    mode: "payment",
    "line_items[0][price]": row.stripe_price_id,
    "line_items[0][quantity]": 1,
    client_reference_id: row.order_id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: false,
    "metadata[dzn_context]": "dzn_store_sandbox",
    "metadata[dzn_order_id]": row.order_id,
    "metadata[dzn_order_number]": row.order_number,
    "metadata[dzn_product_key]": row.product_key,
    "metadata[dzn_ledger_scope]": row.ledger_scope,
    "payment_intent_data[metadata][dzn_context]": "dzn_store_sandbox",
    "payment_intent_data[metadata][dzn_order_id]": row.order_id,
    "payment_intent_data[metadata][dzn_product_key]": row.product_key,
  };

  const requestStripeCheckoutSession = options.requestStripeCheckoutSession ?? createStripeCheckoutSessionViaStripeApi;
  let session: StripeCheckoutSession;
  try {
    session = await requestStripeCheckoutSession(env, "/checkout/sessions", params, { idempotencyKey });
  } catch {
    return storeCheckoutError(503, "STORE_STRIPE_CHECKOUT_SESSION_FAILED", "Stripe test-mode Checkout Session could not be created.");
  }

  const checked = validateStripeCheckoutSession(session);
  if (!checked.ok) return storeCheckoutError(503, checked.error, checked.message);
  const checkoutUrl = session.url;
  if (!checkoutUrl) return storeCheckoutError(503, "STORE_STRIPE_SESSION_URL_MISSING", "Stripe did not return a sandbox Checkout Session URL.");

  const nowIso = (options.now ?? new Date()).toISOString();
  const paymentIntentId = stripeId(session.payment_intent);
  const customerId = stripeId(session.customer);
  const customerHash = customerId ? await (options.hashValue ?? sha256Hex)(`stripe-customer:${customerId}`) : null;
  const expiresAt = stripeTimestamp(session.expires_at);
  const flagsSnapshot = JSON.stringify({
    schema_version: DZN_STORE_SANDBOX_CHECKOUT_SESSION_SCHEMA_VERSION,
    route: DZN_STORE_SANDBOX_CHECKOUT_SESSION_ROUTE,
    runtime: access.runtime,
    ledger_scope: row.ledger_scope,
    store_enabled: access.flags.storeEnabled,
    checkout_enabled: access.flags.checkoutEnabled,
    sandbox_checkout_enabled: access.flags.sandboxCheckoutEnabled,
    sandbox_checkout_session_enabled: true,
    store_live_checkout_enabled: false,
    owner_live_checkout_enabled: false,
    webhook_fulfilment_enabled: false,
    supporter_cards_enabled: false,
    earned_spins_enabled: false,
    reward_wheel_enabled: false,
    stripe_secret_mode: "test",
    stripe_checkout_session_created: true,
    webhook_fulfilment_attempted: false,
    entitlement_write_attempted: false,
    supporter_card_write_attempted: false,
    earned_spin_write_attempted: false,
    wheel_runtime_attempted: false,
  });

  try {
    const update = await db
      .prepare(
        `UPDATE store_orders
         SET status = 'checkout_created',
             stripe_checkout_session_id = ?,
             stripe_payment_intent_id = ?,
             stripe_customer_ref_hash = ?,
             checkout_session_expires_at = ?,
             store_flags_snapshot_json = ?,
             updated_at = ?
         WHERE id = ?
           AND purchasing_user_id = ?
           AND status = 'draft'
           AND livemode = 0
           AND stripe_checkout_session_id IS NULL`,
      )
      .bind(session.id, paymentIntentId, customerHash, expiresAt, flagsSnapshot, nowIso, row.order_id, user.id)
      .run();
    if (resultChanges(update) !== 1) {
      return storeCheckoutError(409, "STORE_CHECKOUT_LEDGER_UPDATE_CONFLICT", "Pending DZN Store order changed before checkout could be recorded.");
    }
  } catch {
    return storeCheckoutError(503, "STORE_CHECKOUT_LEDGER_UPDATE_FAILED", "DZN Store order checkout state could not be recorded.");
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      order: {
        id: row.order_id,
        order_number: row.order_number,
        status: "checkout_created",
        ledger_scope: row.ledger_scope as DznStoreSandboxLedgerScope,
        livemode: false,
        checkout: {
          available: true,
          url: checkoutUrl,
          session_id: null,
          stripe_checkout_session_created: true,
          livemode: false,
          mode: "payment",
          expires_at: expiresAt,
        },
        safety: {
          account_bound: true,
          guaranteed_purchase: true,
          no_competitive_advantage: true,
          grants_spins: false,
          grants_xp: false,
          grants_owner_subscription_access: false,
          grants_competitive_eligibility: false,
        },
      },
      next_step: "redirect_to_test_mode_stripe_checkout",
    },
  };
}

export function checkoutIdempotencyKeyFromHash(value: unknown) {
  const hash = normalizeString(value)?.toLowerCase();
  if (!hash || !HASH_PATTERN.test(hash)) return null;
  return `dzn-store-sbx-${hash}`;
}

function validateOrderRowForCheckout(row: StoreCheckoutOrderRow) {
  if (row.status !== "draft") {
    return row.stripe_checkout_session_id
      ? checkoutRowError(409, "STORE_ORDER_CHECKOUT_ALREADY_CREATED", "DZN Store order already has a sandbox Checkout Session.")
      : checkoutRowError(409, "STORE_ORDER_NOT_PENDING", "DZN Store order is not pending checkout.");
  }
  if (row.stripe_checkout_session_id) {
    return checkoutRowError(409, "STORE_ORDER_CHECKOUT_ALREADY_CREATED", "DZN Store order already has a sandbox Checkout Session.");
  }
  if (Number(row.livemode) !== 0 || row.ledger_scope !== "local" && row.ledger_scope !== "sandbox") {
    return checkoutRowError(422, "STORE_ORDER_SCOPE_INVALID", "DZN Store order must be local/sandbox and fixed to livemode false.");
  }
  if (Number(row.product_count) !== 1 || Number(row.quantity) !== 1) {
    return checkoutRowError(422, "STORE_ORDER_QUANTITY_INVALID", "DZN Store sandbox checkout supports exactly one account-bound item.");
  }
  if (row.currency !== "gbp" || row.item_currency !== "gbp") {
    return checkoutRowError(422, "STORE_ORDER_CURRENCY_UNSUPPORTED", "DZN Store sandbox checkout supports GBP orders only.");
  }
  const subtotal = asInteger(row.subtotal_amount_minor);
  const tax = asInteger(row.tax_amount_minor);
  const total = asInteger(row.total_amount_minor);
  const unit = asInteger(row.unit_amount_minor);
  const itemTax = asInteger(row.item_tax_amount_minor);
  const itemTotal = asInteger(row.item_total_amount_minor);
  if (subtotal <= 0 || tax !== 0 || total !== subtotal || unit !== subtotal || itemTax !== 0 || itemTotal !== total) {
    return checkoutRowError(422, "STORE_ORDER_AMOUNT_INVALID", "DZN Store order totals must match the immutable sandbox price snapshot.");
  }
  if (row.price_status !== "approved" || Number(row.price_active) !== 1) {
    return checkoutRowError(422, "STORE_PRICE_NOT_APPROVED", "DZN Store sandbox checkout requires an approved active price.");
  }
  if (!row.stripe_price_id) {
    return checkoutRowError(422, "STORE_STRIPE_TEST_PRICE_REQUIRED", "DZN Store sandbox checkout requires a server-side Stripe test Price binding.");
  }
  if (!DZN_STORE_STRIPE_PRICE_ID_PATTERN.test(row.stripe_price_id)) {
    return checkoutRowError(422, "STORE_STRIPE_TEST_PRICE_INVALID", "DZN Store sandbox checkout requires a bounded server-side Stripe Price id.");
  }
  if (Number(row.account_bound) !== 1 || Number(row.guaranteed_purchase) !== 1 || Number(row.no_competitive_advantage) !== 1) {
    return checkoutRowError(422, "STORE_ORDER_SAFETY_FLAGS_INVALID", "DZN Store item must remain account-bound, guaranteed, and no-competitive-advantage.");
  }
  for (const field of [
    row.grants_spins,
    row.grants_xp,
    row.grants_rank_advantage,
    row.grants_discovery_advantage,
    row.grants_review_advantage,
    row.grants_event_advantage,
    row.grants_server_wars_advantage,
    row.grants_ctf_advantage,
    row.grants_owner_subscription_access,
    row.grants_competitive_eligibility,
  ]) {
    if (Number(field) !== 0) {
      return checkoutRowError(422, "STORE_ORDER_PAID_OUTCOME_BLOCKED", "DZN Store purchases cannot grant spins, XP, ranking, discovery, reviews, events, Server Wars, CTF, owner access, or competitive eligibility.");
    }
  }

  return { ok: true as const };
}

function validateStripeCheckoutSession(session: StripeCheckoutSession) {
  if (!session.id || !session.id.startsWith("cs_test_")) {
    return checkoutRowError(503, "STORE_STRIPE_SESSION_NOT_TEST_MODE", "Stripe returned a non-test Store Checkout Session.");
  }
  if (session.livemode !== false) {
    return checkoutRowError(503, "STORE_STRIPE_SESSION_LIVE_MODE_BLOCKED", "Stripe returned a live-mode Store Checkout Session.");
  }
  if (session.mode !== undefined && session.mode !== null && session.mode !== "payment") {
    return checkoutRowError(503, "STORE_STRIPE_SESSION_MODE_INVALID", "Stripe returned a non-payment Store Checkout Session.");
  }
  if (!session.url) {
    return checkoutRowError(503, "STORE_STRIPE_SESSION_URL_MISSING", "Stripe did not return a sandbox Checkout Session URL.");
  }
  return { ok: true as const };
}

function storeCheckoutRedirectUrl(env: Env, request: Request, returnTo: string, status: "success" | "cancelled", orderId: string) {
  const appUrl = getAppUrl(env, request);
  const safePath = normalizeReturnTo(returnTo) ?? "/store";
  const url = new URL(safePath, appUrl);
  url.searchParams.set("store_checkout", status);
  url.searchParams.set("order", orderId);
  return url.toString();
}

function createStripeCheckoutSessionViaStripeApi(
  env: Env,
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  options: { idempotencyKey: string },
) {
  return stripeFormRequest<StripeCheckoutSession>(env, path, params, options);
}

function checkoutRowError(status: DznStoreSandboxCheckoutResult["status"], error: string, message: string) {
  return { ok: false as const, status: status === 200 ? 503 : status, error, message };
}

function storeCheckoutError(status: DznStoreSandboxCheckoutResult["status"], error: string, message: string): DznStoreSandboxCheckoutResult {
  return {
    ok: false,
    status: status === 200 ? 503 : status,
    body: {
      ok: false,
      error,
      message,
      checkout_available: false,
      stripe_checkout_session_created: false,
      live_checkout_enabled: false,
    },
  };
}

function resultChanges(result: D1Result) {
  const changes = Number(result.meta?.changes ?? result.meta?.rows_written ?? result.meta?.rowsWritten ?? 0);
  return Number.isFinite(changes) ? changes : 0;
}

function validationError(error: string, message: string) {
  return {
    ok: false as const,
    status: 400 as const,
    error,
    message,
  };
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeReturnTo(value: unknown) {
  const text = normalizeString(value);
  if (!text) return null;
  if (text.length > MAX_RETURN_TO_LENGTH) return null;
  if (!text.startsWith("/") || text.startsWith("//")) return null;
  if (/[\r\n]/.test(text)) return null;
  return text;
}

function normalizeRecordId(value: unknown) {
  const text = normalizeString(value);
  if (!text || !RECORD_ID_PATTERN.test(text)) return null;
  return text;
}

function normalizeString(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function parseBooleanFlag(value: unknown) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readEnvValue(env: Env | StoreCheckoutEnvRecord, key: string) {
  return (env as unknown as StoreCheckoutEnvRecord)[key];
}

function asInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number)) return -1;
  return number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
