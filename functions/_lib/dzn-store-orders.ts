import { requireDb } from "./db";
import {
  DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
  DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS,
  isProductFulfilmentCompatible,
  readDznStoreCatalogFlags,
  type DznStoreCatalogFlags,
  type DznStoreFulfilmentKind,
  type DznStoreOutcomeField,
  type DznStoreProductType,
} from "./dzn-store-catalog";
import type { Env, SessionUser } from "./types";

export const DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION = "2026-08-27.sandbox-order-route-v1";
export const DZN_STORE_SANDBOX_ORDER_ROUTE = "/api/store/orders";
export const DZN_STORE_SANDBOX_RUNTIME_FLAG = "DZN_STORE_SANDBOX_RUNTIME";
export const DZN_STORE_ORDER_BODY_LIMIT_BYTES = 4096;
export const DZN_STORE_TERMS_VERSION = "dzn-store-sandbox-order-v1";

const STORE_SANDBOX_RUNTIMES = ["local", "test"] as const;
const PRODUCT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,80}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const THEME_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const CLIENT_MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const DZN_STORE_STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9_]{3,128}$/;
const MAX_RETURN_TO_LENGTH = 200;

const FORBIDDEN_REQUEST_FIELDS = [
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
] as const;

const PAID_OUTCOME_COLUMN_BY_FIELD: Record<DznStoreOutcomeField, keyof StoreCatalogRow> = {
  grantsSpins: "grants_spins",
  grantsXp: "grants_xp",
  grantsRankAdvantage: "grants_rank_advantage",
  grantsDiscoveryAdvantage: "grants_discovery_advantage",
  grantsReviewAdvantage: "grants_review_advantage",
  grantsEventAdvantage: "grants_event_advantage",
  grantsServerWarsAdvantage: "grants_server_wars_advantage",
  grantsCtfAdvantage: "grants_ctf_advantage",
  grantsOwnerSubscriptionAccess: "grants_owner_subscription_access",
  grantsCompetitiveEligibility: "grants_competitive_eligibility",
};

export type DznStoreSandboxRuntime = (typeof STORE_SANDBOX_RUNTIMES)[number];

export type DznStoreSandboxLedgerScope = "local" | "sandbox";

export type DznStoreSandboxOrderRequestBody = {
  productKey?: unknown;
  priceId?: unknown;
  supporterCardThemeKey?: unknown;
  returnTo?: unknown;
  clientMutationId?: unknown;
};

export type DznStoreSandboxOrderInput = {
  productKey: string;
  priceId: string;
  supporterCardThemeKey: string | null;
  returnTo: string;
  clientMutationId: string | null;
};

export type DznStoreSandboxOrderBlockCode =
  | "STORE_SANDBOX_RUNTIME_REQUIRED"
  | "STORE_DISABLED"
  | "STORE_CHECKOUT_DISABLED"
  | "STORE_SANDBOX_CHECKOUT_DISABLED"
  | "STORE_LIVE_CHECKOUT_BLOCKED"
  | "STORE_WEBHOOK_FULFILMENT_MUST_STAY_DISABLED"
  | "STORE_SUPPORTER_CARD_RUNTIME_MUST_STAY_DISABLED"
  | "STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED"
  | "STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED";

export type DznStoreSandboxOrderResult =
  | { ok: true; status: 201; body: DznStoreSandboxOrderSuccessPayload }
  | { ok: false; status: 400 | 403 | 404 | 422 | 503; body: DznStoreSandboxOrderErrorPayload };

export type DznStoreSandboxOrderSuccessPayload = {
  ok: true;
  order: {
    id: string;
    order_number: string;
    status: "draft";
    ledger_scope: DznStoreSandboxLedgerScope;
    livemode: false;
    product_count: 1;
    product: {
      product_key: string;
      name: string;
      product_type: DznStoreProductType;
      fulfilment_kind: DznStoreFulfilmentKind;
    };
    price: {
      price_id: string;
      currency: "gbp";
      unit_amount_minor: number;
      tax_amount_minor: 0;
      total_amount_minor: number;
    };
    selected_theme_key: string | null;
    checkout: {
      available: false;
      url: null;
      session_id: null;
      reason: string;
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
  next_step: "checkout_session_creation_requires_future_approval";
};

export type DznStoreSandboxOrderErrorPayload = {
  ok: false;
  error: string;
  message: string;
  checkout_available: false;
  stripe_checkout_session_created: false;
  live_checkout_enabled: false;
};

type StoreCatalogRow = {
  product_id: string;
  product_key: string;
  name: string;
  description: string;
  product_type: DznStoreProductType;
  fulfilment_kind: DznStoreFulfilmentKind;
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

type SandboxOrderOptions = {
  now?: Date;
  createId?: () => string;
  hashValue?: (value: string) => Promise<string>;
};

type StoreOrderEnvRecord = Record<string, unknown>;

export function canCreateDznStoreSandboxOrder(env: Env | StoreOrderEnvRecord = {}) {
  const flags = readDznStoreCatalogFlags(env as StoreOrderEnvRecord);
  const runtime = readDznStoreSandboxRuntime(env);
  const ownerLiveCheckoutEnabled = parseBooleanFlag(readEnvValue(env, "DZN_LIVE_CHECKOUT_ENABLED"));

  if (!runtime) {
    return blockedAccess("STORE_SANDBOX_RUNTIME_REQUIRED", `${DZN_STORE_SANDBOX_RUNTIME_FLAG}=local or test is required before sandbox Store order writes.`, flags, runtime);
  }
  if (!flags.storeEnabled) {
    return blockedAccess("STORE_DISABLED", "DZN Store is disabled.", flags, runtime);
  }
  if (!flags.checkoutEnabled) {
    return blockedAccess("STORE_CHECKOUT_DISABLED", "DZN Store checkout/order writes are disabled.", flags, runtime);
  }
  if (!flags.sandboxCheckoutEnabled) {
    return blockedAccess("STORE_SANDBOX_CHECKOUT_DISABLED", "DZN Store sandbox checkout/order writes are disabled.", flags, runtime);
  }
  if (flags.liveCheckoutEnabled || ownerLiveCheckoutEnabled) {
    return blockedAccess("STORE_LIVE_CHECKOUT_BLOCKED", "Live checkout remains blocked for this sandbox order route.", flags, runtime);
  }
  if (flags.webhookFulfilmentEnabled) {
    return blockedAccess("STORE_WEBHOOK_FULFILMENT_MUST_STAY_DISABLED", "Store webhook fulfilment must stay disabled for this order-only slice.", flags, runtime);
  }
  if (flags.supporterCardsEnabled) {
    return blockedAccess("STORE_SUPPORTER_CARD_RUNTIME_MUST_STAY_DISABLED", "Supporter Card runtime must stay disabled for this order-only slice.", flags, runtime);
  }
  if (flags.earnedSpinsEnabled) {
    return blockedAccess("STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED", "Earned-spin runtime must stay disabled for this order-only slice.", flags, runtime);
  }
  if (flags.rewardWheelEnabled) {
    return blockedAccess("STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED", "Reward wheel runtime must stay disabled for this order-only slice.", flags, runtime);
  }

  return {
    ok: true as const,
    runtime,
    flags,
    ownerLiveCheckoutEnabled: false,
  };
}

export function validateDznStoreSandboxOrderBody(input: unknown) {
  const record = asRecord(input);
  if (!record) {
    return validationError("INVALID_ORDER_BODY", "Request body must be a JSON object.");
  }

  for (const field of FORBIDDEN_REQUEST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      return validationError("FORBIDDEN_ORDER_FIELD", "Store orders derive purchaser, quantity, amount, currency, Stripe, and owner/server state on the server only.");
    }
  }

  const productKey = normalizeSlug(record.productKey, PRODUCT_KEY_PATTERN);
  if (!productKey) {
    return validationError("INVALID_PRODUCT_KEY", "Choose a valid DZN Store product.");
  }

  const priceId = normalizeRecordId(record.priceId);
  if (!priceId) {
    return validationError("INVALID_PRICE_ID", "Choose a valid DZN Store price.");
  }

  const supporterCardThemeKey = normalizeOptionalSlug(record.supporterCardThemeKey, THEME_KEY_PATTERN);
  if (record.supporterCardThemeKey !== undefined && !supporterCardThemeKey) {
    return validationError("INVALID_SUPPORTER_CARD_THEME", "Choose a valid Supporter Card theme.");
  }

  const returnTo = normalizeReturnTo(record.returnTo);
  if (record.returnTo !== undefined && !returnTo) {
    return validationError("INVALID_RETURN_TO", "Return URL must be a same-site path.");
  }

  const clientMutationId = normalizeOptionalClientMutationId(record.clientMutationId);
  if (record.clientMutationId !== undefined && !clientMutationId) {
    return validationError("INVALID_CLIENT_MUTATION_ID", "Client mutation ids must be bounded non-sensitive tokens.");
  }

  return {
    ok: true as const,
    value: {
      productKey,
      priceId,
      supporterCardThemeKey,
      returnTo: returnTo ?? "/store",
      clientMutationId,
    } satisfies DznStoreSandboxOrderInput,
  };
}

export async function createDznStoreSandboxOrder(
  env: Env,
  user: SessionUser,
  input: DznStoreSandboxOrderInput,
  options: SandboxOrderOptions = {},
): Promise<DznStoreSandboxOrderResult> {
  const access = canCreateDznStoreSandboxOrder(env);
  if (!access.ok) return storeOrderError(access.status, access.code, access.message);

  let db: D1Database;
  try {
    db = requireDb(env);
  } catch {
    return storeOrderError(503, "STORE_ORDER_DB_UNAVAILABLE", "DZN Store order storage is not configured.");
  }

  const now = options.now ?? new Date();
  let catalogRow: StoreCatalogRow | null = null;
  try {
    catalogRow = await db
      .prepare(
        `SELECT
           store_products.id AS product_id,
           store_products.product_key,
           store_products.name,
           store_products.description,
           store_products.product_type,
           store_products.fulfilment_kind,
           store_products.status AS product_status,
           store_products.active AS product_active,
           store_products.account_bound,
           store_products.guaranteed_purchase,
           store_products.no_competitive_advantage,
           store_products.grants_spins,
           store_products.grants_xp,
           store_products.grants_rank_advantage,
           store_products.grants_discovery_advantage,
           store_products.grants_review_advantage,
           store_products.grants_event_advantage,
           store_products.grants_server_wars_advantage,
           store_products.grants_ctf_advantage,
           store_products.grants_owner_subscription_access,
           store_products.grants_competitive_eligibility,
           store_products.metadata_json,
           store_prices.id AS price_id,
           store_prices.currency,
           store_prices.unit_amount_minor,
           store_prices.min_amount_minor,
           store_prices.allow_pay_what_you_want,
           store_prices.stripe_price_id,
           store_prices.status AS price_status,
           store_prices.active AS price_active,
           store_prices.effective_from,
           store_prices.effective_to
         FROM store_products
         INNER JOIN store_prices ON store_prices.product_id = store_products.id
         WHERE store_products.product_key = ?
           AND store_prices.id = ?
           AND store_products.status = 'approved'
           AND store_products.active = 1
           AND store_prices.status = 'approved'
           AND store_prices.active = 1
           AND datetime(store_prices.effective_from) <= datetime(?)
           AND (store_prices.effective_to IS NULL OR datetime(store_prices.effective_to) > datetime(?))
         LIMIT 1`,
      )
      .bind(input.productKey, input.priceId, now.toISOString(), now.toISOString())
      .first<StoreCatalogRow>();
  } catch {
    return storeOrderError(503, "STORE_CATALOG_UNAVAILABLE", "DZN Store catalog could not be checked.");
  }

  if (!catalogRow) {
    return storeOrderError(404, "STORE_PRODUCT_PRICE_NOT_FOUND", "That Store product or price is not available for sandbox order creation.");
  }

  const safety = validateCatalogRowForSandboxOrder(catalogRow, input);
  if (!safety.ok) return storeOrderError(422, safety.error, safety.message);

  const orderId = createIdentifier(options.createId);
  const itemId = createIdentifier(options.createId);
  const orderNumber = createOrderNumber(now, options.createId);
  const subtotalAmountMinor = Math.trunc(Number(catalogRow.unit_amount_minor));
  const taxAmountMinor = 0;
  const totalAmountMinor = subtotalAmountMinor + taxAmountMinor;
  const ledgerScope = sandboxLedgerScopeForRuntime(access.runtime);
  const hashValue = options.hashValue ?? sha256Hex;
  const purchasingDiscordIdHash = await hashValue(`discord:${user.discord_id}`);
  const checkoutIdempotencyKeyHash = await hashValue(`dzn-store-order:${orderId}:checkout-v1`);
  const productSnapshot = JSON.stringify({
    schema_version: DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION,
    product_id: catalogRow.product_id,
    product_key: catalogRow.product_key,
    name: catalogRow.name,
    product_type: catalogRow.product_type,
    fulfilment_kind: catalogRow.fulfilment_kind,
    account_bound: true,
    guaranteed_purchase: true,
    no_competitive_advantage: true,
    selected_theme_key: input.supporterCardThemeKey,
  });
  const priceSnapshot = JSON.stringify({
    schema_version: DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION,
    price_id: catalogRow.price_id,
    currency: "gbp",
    unit_amount_minor: subtotalAmountMinor,
    tax_amount_minor: taxAmountMinor,
    total_amount_minor: totalAmountMinor,
    effective_from: catalogRow.effective_from,
    effective_to: catalogRow.effective_to,
  });
  const flagsSnapshot = JSON.stringify({
    schema_version: DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION,
    route: DZN_STORE_SANDBOX_ORDER_ROUTE,
    runtime: access.runtime,
    ledger_scope: ledgerScope,
    store_enabled: access.flags.storeEnabled,
    checkout_enabled: access.flags.checkoutEnabled,
    sandbox_checkout_enabled: access.flags.sandboxCheckoutEnabled,
    store_live_checkout_enabled: false,
    owner_live_checkout_enabled: false,
    webhook_fulfilment_enabled: false,
    supporter_cards_enabled: false,
    earned_spins_enabled: false,
    reward_wheel_enabled: false,
  });
  const taxSnapshot = JSON.stringify({
    schema_version: DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION,
    tax_amount_minor: taxAmountMinor,
    tax_policy: "not_collected_in_sandbox_order_route",
    tax_review_required_before_checkout: true,
  });
  const itemSnapshot = JSON.stringify({
    schema_version: DZN_STORE_SANDBOX_ORDER_SCHEMA_VERSION,
    product_key: catalogRow.product_key,
    product_name: catalogRow.name,
    price_id: catalogRow.price_id,
    currency: "gbp",
    unit_amount_minor: subtotalAmountMinor,
    total_amount_minor: totalAmountMinor,
    selected_theme_key: input.supporterCardThemeKey,
    client_mutation_id_present: Boolean(input.clientMutationId),
    return_to: input.returnTo,
  });

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO store_orders (
             id,
             order_number,
             purchasing_user_id,
             purchasing_discord_id_hash,
             status,
             ledger_scope,
             livemode,
             product_count,
             currency,
             subtotal_amount_minor,
             tax_amount_minor,
             total_amount_minor,
             selected_theme_key,
             stripe_checkout_session_id,
             stripe_payment_intent_id,
             stripe_customer_ref_hash,
             immutable_product_snapshot_json,
             immutable_price_snapshot_json,
             store_flags_snapshot_json,
             tax_snapshot_json,
             terms_version,
             checkout_idempotency_key_hash,
             checkout_session_expires_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, 'draft', ?, 0, 1, 'gbp', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          orderId,
          orderNumber,
          user.id,
          purchasingDiscordIdHash,
          ledgerScope,
          subtotalAmountMinor,
          taxAmountMinor,
          totalAmountMinor,
          input.supporterCardThemeKey,
          productSnapshot,
          priceSnapshot,
          flagsSnapshot,
          taxSnapshot,
          DZN_STORE_TERMS_VERSION,
          checkoutIdempotencyKeyHash,
          now.toISOString(),
          now.toISOString(),
        ),
      db
        .prepare(
          `INSERT INTO store_order_items (
             id,
             order_id,
             product_id,
             price_id,
             product_key,
             product_name_snapshot,
             product_type,
             fulfilment_kind,
             quantity,
             currency,
             unit_amount_minor,
             tax_amount_minor,
             total_amount_minor,
             item_snapshot_json,
             account_bound,
             guaranteed_purchase,
             no_competitive_advantage,
             grants_spins,
             grants_xp,
             grants_rank_advantage,
             grants_discovery_advantage,
             grants_review_advantage,
             grants_event_advantage,
             grants_server_wars_advantage,
             grants_ctf_advantage,
             grants_owner_subscription_access,
             grants_competitive_eligibility,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'gbp', ?, 0, ?, ?, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
        )
        .bind(
          itemId,
          orderId,
          catalogRow.product_id,
          catalogRow.price_id,
          catalogRow.product_key,
          catalogRow.name,
          catalogRow.product_type,
          catalogRow.fulfilment_kind,
          subtotalAmountMinor,
          totalAmountMinor,
          itemSnapshot,
          now.toISOString(),
        ),
    ]);
  } catch {
    return storeOrderError(503, "STORE_ORDER_WRITE_FAILED", "DZN Store sandbox order could not be recorded.");
  }

  return {
    ok: true,
    status: 201,
    body: {
      ok: true,
      order: {
        id: orderId,
        order_number: orderNumber,
        status: "draft",
        ledger_scope: ledgerScope,
        livemode: false,
        product_count: 1,
        product: {
          product_key: catalogRow.product_key,
          name: catalogRow.name,
          product_type: catalogRow.product_type,
          fulfilment_kind: catalogRow.fulfilment_kind,
        },
        price: {
          price_id: catalogRow.price_id,
          currency: "gbp",
          unit_amount_minor: subtotalAmountMinor,
          tax_amount_minor: 0,
          total_amount_minor: totalAmountMinor,
        },
        selected_theme_key: input.supporterCardThemeKey,
        checkout: {
          available: false,
          url: null,
          session_id: null,
          reason: "Stripe Checkout Session creation requires a later approved checkout runtime slice.",
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
      next_step: "checkout_session_creation_requires_future_approval",
    },
  };
}

export function readDznStoreSandboxRuntime(env: Env | StoreOrderEnvRecord = {}): DznStoreSandboxRuntime | null {
  const value = normalizeString(readEnvValue(env, DZN_STORE_SANDBOX_RUNTIME_FLAG))?.toLowerCase();
  if (!value) return null;
  return STORE_SANDBOX_RUNTIMES.includes(value as DznStoreSandboxRuntime) ? value as DznStoreSandboxRuntime : null;
}

export function sandboxLedgerScopeForRuntime(runtime: DznStoreSandboxRuntime): DznStoreSandboxLedgerScope {
  return runtime === "local" ? "local" : "sandbox";
}

function validateCatalogRowForSandboxOrder(row: StoreCatalogRow, input: DznStoreSandboxOrderInput) {
  if (row.product_status !== "approved" || Number(row.product_active) !== 1) {
    return catalogError("STORE_PRODUCT_NOT_APPROVED", "Store product must be approved and active before sandbox order creation.");
  }
  if (row.price_status !== "approved" || Number(row.price_active) !== 1) {
    return catalogError("STORE_PRICE_NOT_APPROVED", "Store price must be approved and active before sandbox order creation.");
  }
  if (row.currency !== "gbp") {
    return catalogError("STORE_PRICE_CURRENCY_UNSUPPORTED", "This sandbox order route only supports GBP prices.");
  }
  if (!Number.isInteger(Number(row.unit_amount_minor)) || Number(row.unit_amount_minor) <= 0) {
    return catalogError("STORE_PRICE_AMOUNT_INVALID", "Store price amount must be a positive minor-unit value.");
  }
  if (row.min_amount_minor !== null && row.min_amount_minor !== undefined) {
    return catalogError("STORE_PAY_WHAT_YOU_WANT_BLOCKED", "Pay-what-you-want orders require a later approved pricing slice.");
  }
  if (Number(row.allow_pay_what_you_want) !== 0) {
    return catalogError("STORE_PAY_WHAT_YOU_WANT_BLOCKED", "Pay-what-you-want orders require a later approved pricing slice.");
  }
  const stripePriceId = normalizeString(row.stripe_price_id);
  if (stripePriceId && !DZN_STORE_STRIPE_PRICE_ID_PATTERN.test(stripePriceId)) {
    return catalogError("STORE_STRIPE_PRICE_BINDING_INVALID", "Server-side Store Stripe Price binding must be a bounded Price id before checkout can be attempted.");
  }
  if (!isProductFulfilmentCompatible(row.product_type, row.fulfilment_kind)) {
    return catalogError("STORE_PRODUCT_FULFILMENT_INVALID", "Store product fulfilment kind is not compatible with the product type.");
  }
  if (Number(row.account_bound) !== 1 || Number(row.guaranteed_purchase) !== 1 || Number(row.no_competitive_advantage) !== 1) {
    return catalogError("STORE_PRODUCT_SAFETY_FLAGS_INVALID", "Store product must be account-bound, guaranteed, and no-competitive-advantage.");
  }
  for (const field of DZN_STORE_DISALLOWED_PAID_OUTCOME_FIELDS) {
    const column = PAID_OUTCOME_COLUMN_BY_FIELD[field];
    if (Number(row[column]) !== 0) {
      return catalogError("STORE_PRODUCT_PAID_OUTCOME_BLOCKED", "Store products cannot grant spins, XP, ranking, discovery, review, event, Server Wars, CTF, owner access, or competitive eligibility benefits.");
    }
  }

  const allowedThemes = allowedThemeKeys(row.metadata_json);
  if (row.product_key === DZN_FOUNDING_SUPPORTER_PRODUCT_KEY || row.fulfilment_kind === "supporter_card") {
    if (!input.supporterCardThemeKey) {
      return catalogError("STORE_SUPPORTER_CARD_THEME_REQUIRED", "Choose one approved Supporter Card theme before creating a sandbox order.");
    }
    if (allowedThemes.length > 0 && !allowedThemes.includes(input.supporterCardThemeKey)) {
      return catalogError("STORE_SUPPORTER_CARD_THEME_NOT_APPROVED", "Selected Supporter Card theme is not approved for this product.");
    }
  }

  return { ok: true as const };
}

function allowedThemeKeys(metadataJson: string) {
  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataJson || "{}");
  } catch {
    return [];
  }
  const record = asRecord(metadata);
  if (!record) return [];

  const candidates = [
    record.supporterCardThemeKeys,
    record.supporter_card_theme_keys,
    record.themeKeys,
    record.theme_keys,
    record.themeOptions,
    record.theme_options,
  ];

  const keys: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const value of candidate) {
      const key = normalizeOptionalSlug(value, THEME_KEY_PATTERN);
      if (key) keys.push(key);
    }
  }
  return [...new Set(keys)];
}

function blockedAccess(
  code: DznStoreSandboxOrderBlockCode,
  message: string,
  flags: DznStoreCatalogFlags,
  runtime: DznStoreSandboxRuntime | null,
) {
  return {
    ok: false as const,
    status: 403 as const,
    code,
    message,
    runtime,
    flags,
  };
}

function storeOrderError(status: DznStoreSandboxOrderResult["status"], error: string, message: string): DznStoreSandboxOrderResult {
  return {
    ok: false,
    status: status === 201 ? 503 : status,
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

function validationError(error: string, message: string) {
  return {
    ok: false as const,
    status: 400 as const,
    error,
    message,
  };
}

function catalogError(error: string, message: string) {
  return {
    ok: false as const,
    error,
    message,
  };
}

function createIdentifier(createId?: () => string) {
  if (createId) return createId();
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `dzn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function createOrderNumber(now: Date, createId?: () => string) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = createIdentifier(createId).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase().padEnd(10, "0");
  return `DZN-STORE-${date}-${suffix}`;
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

function normalizeSlug(value: unknown, pattern: RegExp) {
  const text = normalizeString(value)?.toLowerCase().replace(/_/g, "-");
  if (!text || !pattern.test(text)) return null;
  return text;
}

function normalizeOptionalSlug(value: unknown, pattern: RegExp) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeSlug(value, pattern);
}

function normalizeOptionalClientMutationId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const text = normalizeString(value);
  if (!text || !CLIENT_MUTATION_ID_PATTERN.test(text)) return null;
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

function readEnvValue(env: Env | StoreOrderEnvRecord, key: string) {
  return (env as unknown as StoreOrderEnvRecord)[key];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
