import {
  DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
  readDznStoreCatalogFlags,
  type DznStoreCatalogFlags,
} from "./dzn-store-catalog";
import {
  DZN_STORE_SANDBOX_RUNTIME_FLAG,
  DZN_STORE_TERMS_VERSION,
  readDznStoreSandboxRuntime,
  sandboxLedgerScopeForRuntime,
  type DznStoreSandboxLedgerScope,
  type DznStoreSandboxRuntime,
} from "./dzn-store-orders";
import { stripeId, type StripeEvent } from "./stripe";
import type { Env } from "./types";

export const DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION = "2026-08-28.store-fulfilment-runtime-v1";
export const DZN_STORE_WEBHOOK_FULFILMENT_FLAG = "DZN_STORE_WEBHOOK_FULFILMENT_ENABLED";
export const DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG_NAME = "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED";

const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const STRIPE_ID_PATTERN = /^[A-Za-z0-9_]{3,128}$/;
const SUPPORTER_THEME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SUPPORTER_CARD_SERIAL_RETRY_LIMIT = 8;

type StoreFulfilmentEnvRecord = Record<string, unknown>;

export type DznStoreFulfilmentPaymentRefs = {
  eventClass: "checkout" | "payment_intent" | "refund" | "dispute" | "ignored";
  processingStatus: "received" | "ignored";
  relatedOrderCandidate: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeRefundId: string | null;
  stripeDisputeId: string | null;
};

export type DznStoreFulfilmentResult = {
  attempted: boolean;
  status: "disabled" | "fulfilled" | "duplicate" | "manual_review" | "blocked_by_flag" | "no_op" | "failed";
  reason_code: string;
  duplicate: boolean;
  event_type: string;
  event_class: DznStoreFulfilmentPaymentRefs["eventClass"];
  order_linked: boolean;
  order_status: string | null;
  entitlement_write_attempted: boolean;
  entitlement_written: boolean;
  supporter_card_write_attempted: boolean;
  supporter_card_written: boolean;
  refund_dispute_audit_written: boolean;
  live_checkout_enabled: false;
};

type StoreFulfilmentOptions = {
  now?: Date;
  createId?: () => string;
  hashValue?: (value: string) => Promise<string>;
};

type StoreFulfilmentAccess =
  | {
      ok: true;
      runtime: DznStoreSandboxRuntime;
      ledgerScope: DznStoreSandboxLedgerScope;
      flags: DznStoreCatalogFlags;
    }
  | {
      ok: false;
      status: 403;
      code: string;
      message: string;
      runtime: DznStoreSandboxRuntime | null;
      flags: DznStoreCatalogFlags;
    };

type StorePaymentEventRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  event_class: DznStoreFulfilmentPaymentRefs["eventClass"];
  ledger_scope: DznStoreSandboxLedgerScope;
  livemode: number;
  processing_status: string;
  related_order_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  stripe_dispute_id: string | null;
};

type StoreOrderItemRow = {
  order_id: string;
  order_number: string;
  purchasing_user_id: string;
  purchaser_username: string | null;
  order_status: string;
  ledger_scope: DznStoreSandboxLedgerScope;
  order_livemode: number;
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
  entitlement_id: string | null;
  entitlement_status: string | null;
  supporter_card_id: string | null;
  supporter_card_status: string | null;
};

type StoreFulfilmentAttemptRow = {
  id: string;
  status: DznStoreFulfilmentResult["status"] | "received" | "eligible";
  entitlement_id: string | null;
  supporter_card_id: string | null;
};

type StoreEntitlementRow = {
  id: string;
  status: string;
  source_order_item_id: string;
};

type StoreSupporterCardRow = {
  id: string;
  serial_number: string;
  status: string;
};

type ValidationResult =
  | { ok: true }
  | { ok: false; status: "manual_review" | "blocked_by_flag" | "no_op" | "failed"; code: string };

export function canProcessDznStoreSandboxFulfilment(env: Env | StoreFulfilmentEnvRecord = {}): StoreFulfilmentAccess {
  const flags = readDznStoreCatalogFlags(env as StoreFulfilmentEnvRecord);
  const runtime = readDznStoreSandboxRuntime(env);
  const ownerLiveCheckoutEnabled = parseBooleanFlag(readEnvValue(env, "DZN_LIVE_CHECKOUT_ENABLED"));
  const stripeSecret = normalizeString(readEnvValue(env, "STRIPE_SECRET_KEY"));

  if (!runtime) return blockedAccess("STORE_SANDBOX_RUNTIME_REQUIRED", `${DZN_STORE_SANDBOX_RUNTIME_FLAG}=local or test is required before sandbox Store fulfilment.`, flags, runtime);
  if (!flags.storeEnabled) return blockedAccess("STORE_DISABLED", "DZN Store is disabled.", flags, runtime);
  if (!flags.checkoutEnabled) return blockedAccess("STORE_CHECKOUT_DISABLED", "DZN Store checkout/order flow is disabled.", flags, runtime);
  if (!flags.sandboxCheckoutEnabled) return blockedAccess("STORE_SANDBOX_CHECKOUT_DISABLED", "DZN Store sandbox checkout/order flow is disabled.", flags, runtime);
  if (!parseBooleanFlag(readEnvValue(env, DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG_NAME))) {
    return blockedAccess("STORE_SANDBOX_WEBHOOK_RECEIPT_DISABLED", "DZN Store sandbox webhook receipt must be enabled before fulfilment can run.", flags, runtime);
  }
  if (!flags.webhookFulfilmentEnabled) return blockedAccess("STORE_WEBHOOK_FULFILMENT_DISABLED", "DZN Store webhook fulfilment is disabled.", flags, runtime);
  if (flags.liveCheckoutEnabled || ownerLiveCheckoutEnabled) {
    return blockedAccess("STORE_LIVE_CHECKOUT_BLOCKED", "Live checkout remains blocked for Store fulfilment.", flags, runtime);
  }
  if (stripeSecret && !stripeSecret.startsWith("sk_test_")) {
    return blockedAccess("STORE_STRIPE_LIVE_SECRET_BLOCKED", "DZN Store sandbox fulfilment rejects live Stripe API secrets.", flags, runtime);
  }
  if (flags.earnedSpinsEnabled) {
    return blockedAccess("STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED", "Store fulfilment cannot run while earned-spin runtime is enabled.", flags, runtime);
  }
  if (flags.rewardWheelEnabled) {
    return blockedAccess("STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED", "Store fulfilment cannot run while reward wheel runtime is enabled.", flags, runtime);
  }

  return {
    ok: true,
    runtime,
    ledgerScope: sandboxLedgerScopeForRuntime(runtime),
    flags,
  };
}

export async function processDznStoreSandboxWebhookFulfilment(
  env: Env,
  input: {
    db: D1Database;
    event: StripeEvent;
    refs: DznStoreFulfilmentPaymentRefs;
    ledgerScope: DznStoreSandboxLedgerScope;
  },
  options: StoreFulfilmentOptions = {},
): Promise<DznStoreFulfilmentResult> {
  const access = canProcessDznStoreSandboxFulfilment(env);
  const nowIso = (options.now ?? new Date()).toISOString();
  if (!access.ok) {
    return fulfilmentResult(false, "disabled", access.code, input.event, input.refs, {
      orderLinked: false,
      orderStatus: null,
    });
  }

  if (input.event.livemode !== false) {
    return fulfilmentResult(false, "blocked_by_flag", "STORE_WEBHOOK_LIVE_EVENT_BLOCKED", input.event, input.refs, {
      orderLinked: false,
      orderStatus: null,
    });
  }

  const paymentEvent = await readPaymentEventByStripeEventId(input.db, input.event.id);
  if (!paymentEvent) {
    return fulfilmentResult(false, "no_op", "STORE_PAYMENT_EVENT_RECEIPT_MISSING", input.event, input.refs, {
      orderLinked: false,
      orderStatus: null,
    });
  }

  const orderId = await resolveFulfilmentOrderId(input.db, paymentEvent, input.refs);
  if (!orderId) {
    return fulfilmentResult(false, "no_op", "STORE_FULFILMENT_ORDER_NOT_LINKED", input.event, input.refs, {
      orderLinked: false,
      orderStatus: null,
    });
  }

  const order = await readFulfilmentOrder(input.db, orderId);
  if (!order) {
    return fulfilmentResult(false, "no_op", "STORE_FULFILMENT_ORDER_NOT_FOUND", input.event, input.refs, {
      orderLinked: false,
      orderStatus: null,
    });
  }

  const attemptKey = await createAttemptKey(paymentEvent.id, input.event.id, options.hashValue ?? sha256Hex);
  const attemptId = createIdentifier(options.createId);
  const insertedAttempt = await insertFulfilmentAttempt(input.db, {
    id: attemptId,
    attemptKey,
    paymentEvent,
    order,
    status: "received",
    access,
    refs: input.refs,
    event: input.event,
    nowIso,
  });
  if (!insertedAttempt) {
    const existing = await readFulfilmentAttempt(input.db, paymentEvent.id);
    return fulfilmentResult(true, "duplicate", "STORE_FULFILMENT_EVENT_ALREADY_PROCESSED", input.event, input.refs, {
      orderLinked: true,
      orderStatus: order.order_status,
      entitlementWriteAttempted: Boolean(existing?.entitlement_id),
      supporterCardWriteAttempted: Boolean(existing?.supporter_card_id),
      duplicate: true,
    });
  }

  if (input.event.type === "checkout.session.completed") {
    return fulfilCheckoutSessionCompleted(input.db, input.event, input.refs, access, paymentEvent, order, attemptId, nowIso, options);
  }

  if (isRefundOrDisputeEvent(input.event.type)) {
    return handleRefundOrDisputeEvent(input.db, input.event, input.refs, access, paymentEvent, order, attemptId, nowIso, options);
  }

  await finalizeFulfilmentAttempt(input.db, attemptId, {
    status: "no_op",
    code: input.event.type === "checkout.session.async_payment_succeeded"
      ? "STORE_ASYNC_PAYMENT_SUCCESS_DISABLED"
      : input.refs.eventClass === "payment_intent"
        ? "STORE_PAYMENT_INTENT_EVENT_NO_GRANT"
        : "STORE_EVENT_IGNORED_FOR_FULFILMENT",
    nowIso,
  });
  return fulfilmentResult(true, "no_op", input.event.type === "checkout.session.async_payment_succeeded"
    ? "STORE_ASYNC_PAYMENT_SUCCESS_DISABLED"
    : input.refs.eventClass === "payment_intent"
      ? "STORE_PAYMENT_INTENT_EVENT_NO_GRANT"
      : "STORE_EVENT_IGNORED_FOR_FULFILMENT", input.event, input.refs, {
    orderLinked: true,
    orderStatus: order.order_status,
  });
}

async function fulfilCheckoutSessionCompleted(
  db: D1Database,
  event: StripeEvent,
  refs: DznStoreFulfilmentPaymentRefs,
  access: Extract<StoreFulfilmentAccess, { ok: true }>,
  paymentEvent: StorePaymentEventRow,
  order: StoreOrderItemRow,
  attemptId: string,
  nowIso: string,
  options: StoreFulfilmentOptions,
) {
  const validation = validateCheckoutGrant(event, order);
  if (!validation.ok) {
    await moveOrderToReviewState(db, order, paymentEvent, validation.status, validation.code, access.ledgerScope, nowIso, options.createId);
    await finalizeFulfilmentAttempt(db, attemptId, {
      status: validation.status,
      code: validation.code,
      nowIso,
    });
    return fulfilmentResult(true, validation.status, validation.code, event, refs, {
      orderLinked: true,
      orderStatus: order.order_status,
    });
  }

  const orderPaid = await markOrderPaid(db, order, paymentEvent, access.ledgerScope, nowIso, options.createId);
  if (!orderPaid.ok) {
    await finalizeFulfilmentAttempt(db, attemptId, {
      status: orderPaid.status,
      code: orderPaid.code,
      nowIso,
    });
    return fulfilmentResult(true, orderPaid.status, orderPaid.code, event, refs, {
      orderLinked: true,
      orderStatus: order.order_status,
    });
  }

  const entitlement = await ensureAccountEntitlement(db, order, paymentEvent, access.ledgerScope, nowIso, options.createId);
  if (!entitlement.ok) {
    const status = entitlement.code === "STORE_ENTITLEMENT_ACCOUNT_ALREADY_EXISTS" ? "manual_review" : "failed";
    if (status === "manual_review") {
      await updateOrderStatus(db, {
        order: { ...order, order_status: "paid" },
        paymentEvent,
        toStatus: "manual_review",
        reasonCode: entitlement.code,
        ledgerScope: access.ledgerScope,
        nowIso,
        createId: options.createId,
      });
    }
    await finalizeFulfilmentAttempt(db, attemptId, {
      status,
      code: entitlement.code,
      nowIso,
    });
    return fulfilmentResult(true, status, entitlement.code, event, refs, {
      orderLinked: true,
      orderStatus: status === "manual_review" ? "manual_review" : "paid",
      entitlementWriteAttempted: true,
    });
  }

  await insertEntitlementStatusHistory(db, {
    id: createIdentifier(options.createId),
    entitlementId: entitlement.row.id,
    supporterCardId: null,
    orderId: order.order_id,
    paymentEventId: paymentEvent.id,
    fromStatus: null,
    toStatus: entitlement.row.status,
    reasonCode: entitlement.inserted ? "store_checkout_completed" : "store_entitlement_already_exists",
    ledgerScope: access.ledgerScope,
    nowIso,
  });

  const card = await maybeIssueSupporterCard(db, order, entitlement.row, paymentEvent, access, nowIso, options);
  if (!card.ok) {
    await finalizeFulfilmentAttempt(db, attemptId, {
      status: card.status,
      code: card.code,
      entitlementId: entitlement.row.id,
      nowIso,
    });
    return fulfilmentResult(true, card.status, card.code, event, refs, {
      orderLinked: true,
      orderStatus: "paid",
      entitlementWriteAttempted: true,
      entitlementWritten: entitlement.inserted,
      supporterCardWriteAttempted: card.attempted,
    });
  }

  await finalizeFulfilmentAttempt(db, attemptId, {
    status: entitlement.inserted || card.inserted ? "fulfilled" : "duplicate",
    code: entitlement.inserted || card.inserted ? "STORE_CHECKOUT_COMPLETED_FULFILLED" : "STORE_ORDER_ITEM_ALREADY_FULFILLED",
    entitlementId: entitlement.row.id,
    supporterCardId: card.row?.id ?? null,
    nowIso,
  });

  return fulfilmentResult(true, entitlement.inserted || card.inserted ? "fulfilled" : "duplicate", entitlement.inserted || card.inserted
    ? "STORE_CHECKOUT_COMPLETED_FULFILLED"
    : "STORE_ORDER_ITEM_ALREADY_FULFILLED", event, refs, {
    orderLinked: true,
    orderStatus: "paid",
    entitlementWriteAttempted: true,
    entitlementWritten: entitlement.inserted,
    supporterCardWriteAttempted: card.attempted,
    supporterCardWritten: card.inserted,
    duplicate: !entitlement.inserted && !card.inserted,
  });
}

async function handleRefundOrDisputeEvent(
  db: D1Database,
  event: StripeEvent,
  refs: DznStoreFulfilmentPaymentRefs,
  access: Extract<StoreFulfilmentAccess, { ok: true }>,
  paymentEvent: StorePaymentEventRow,
  order: StoreOrderItemRow,
  attemptId: string,
  nowIso: string,
  options: StoreFulfilmentOptions,
) {
  const decision = refundDisputeDecision(event, order);
  await insertRefundDisputeAudit(db, {
    id: createIdentifier(options.createId),
    paymentEvent,
    event,
    order,
    decision,
    refs,
    ledgerScope: access.ledgerScope,
    nowIso,
  });

  if (decision.orderStatus) {
    await updateOrderStatus(db, {
      order,
      paymentEvent,
      toStatus: decision.orderStatus,
      reasonCode: decision.code,
      ledgerScope: access.ledgerScope,
      nowIso,
      createId: options.createId,
    });
  }

  const entitlementChanged = decision.entitlementStatus
    ? await updateAccountEntitlementStatus(db, order, paymentEvent, decision.entitlementStatus, decision.code, access.ledgerScope, nowIso, options.createId)
    : { attempted: false, changed: false };
  const cardChanged = decision.entitlementStatus
    ? await updateSupporterCardStatus(db, order, paymentEvent, decision.entitlementStatus, decision.code, access.ledgerScope, nowIso, options.createId)
    : { attempted: false, changed: false };

  await finalizeFulfilmentAttempt(db, attemptId, {
    status: decision.attemptStatus,
    code: decision.code,
    entitlementId: order.entitlement_id,
    supporterCardId: order.supporter_card_id,
    nowIso,
  });

  return fulfilmentResult(true, decision.attemptStatus, decision.code, event, refs, {
    orderLinked: true,
    orderStatus: decision.orderStatus ?? order.order_status,
    entitlementWriteAttempted: entitlementChanged.attempted,
    entitlementWritten: entitlementChanged.changed,
    supporterCardWriteAttempted: cardChanged.attempted,
    supporterCardWritten: cardChanged.changed,
    refundDisputeAuditWritten: true,
  });
}

function validateCheckoutGrant(event: StripeEvent, order: StoreOrderItemRow): ValidationResult {
  const object = asRecord(event.data.object) ?? {};
  const metadata = metadataRecord(object.metadata);
  const checkoutSessionId = stripeProviderId(object.id, ["cs_test_"]);
  if (!checkoutSessionId) return validationError("manual_review", "STORE_CHECKOUT_SESSION_NOT_TEST_MODE");
  if (safeEnumString(object.object) !== "checkout.session") return validationError("manual_review", "STORE_CHECKOUT_OBJECT_INVALID");
  if (safeEnumString(object.mode) !== "payment") return validationError("manual_review", "STORE_CHECKOUT_MODE_INVALID");
  if (safeEnumString(object.status) !== "complete") return validationError("manual_review", "STORE_CHECKOUT_STATUS_INVALID");
  if (safeEnumString(object.payment_status) !== "paid") return validationError("manual_review", "STORE_CHECKOUT_PAYMENT_STATUS_INVALID");
  if (order.stripe_checkout_session_id !== checkoutSessionId) return validationError("manual_review", "STORE_CHECKOUT_SESSION_MISMATCH");
  if (!["checkout_created", "payment_pending", "paid"].includes(order.order_status)) return validationError("manual_review", "STORE_ORDER_STATUS_NOT_ELIGIBLE");

  const paymentIntentId = stripeProviderId(object.payment_intent, ["pi_"]);
  if (paymentIntentId && order.stripe_payment_intent_id && order.stripe_payment_intent_id !== paymentIntentId) {
    return validationError("manual_review", "STORE_PAYMENT_INTENT_MISMATCH");
  }

  const amountTotal = asOptionalInteger(object.amount_total);
  if (amountTotal !== null && amountTotal !== asInteger(order.total_amount_minor)) {
    return validationError("manual_review", "STORE_CHECKOUT_AMOUNT_MISMATCH");
  }

  const currency = safeEnumString(object.currency);
  if (currency && currency !== "gbp") return validationError("manual_review", "STORE_CHECKOUT_CURRENCY_MISMATCH");
  if (metadata.dzn_order_id && metadata.dzn_order_id !== order.order_id) return validationError("manual_review", "STORE_METADATA_ORDER_MISMATCH");
  if (metadata.dzn_product_key && metadata.dzn_product_key !== order.product_key) return validationError("manual_review", "STORE_METADATA_PRODUCT_MISMATCH");
  if (!validateOrderSafety(order)) return validationError("manual_review", "STORE_ORDER_SAFETY_FLAGS_INVALID");
  if (!validateImmutableSnapshots(order)) return validationError("manual_review", "STORE_ORDER_IMMUTABLE_SNAPSHOT_MISMATCH");
  if (order.terms_version !== DZN_STORE_TERMS_VERSION) return validationError("manual_review", "STORE_ORDER_TERMS_VERSION_MISMATCH");
  if (order.fulfilment_kind === "supporter_card" && !normalizeSupporterTheme(order.selected_theme_key)) {
    return validationError("manual_review", "STORE_SUPPORTER_CARD_THEME_MISSING");
  }
  if (order.order_status === "paid" && order.entitlement_id) return { ok: true };

  return { ok: true };
}

function validateOrderSafety(order: StoreOrderItemRow) {
  return Number(order.order_livemode) === 0
    && Number(order.product_count) === 1
    && Number(order.quantity) === 1
    && (order.ledger_scope === "local" || order.ledger_scope === "sandbox")
    && order.currency === "gbp"
    && order.item_currency === "gbp"
    && asInteger(order.subtotal_amount_minor) > 0
    && asInteger(order.tax_amount_minor) === 0
    && asInteger(order.total_amount_minor) === asInteger(order.subtotal_amount_minor)
    && asInteger(order.unit_amount_minor) === asInteger(order.subtotal_amount_minor)
    && asInteger(order.item_tax_amount_minor) === 0
    && asInteger(order.item_total_amount_minor) === asInteger(order.total_amount_minor)
    && Number(order.account_bound) === 1
    && Number(order.guaranteed_purchase) === 1
    && Number(order.no_competitive_advantage) === 1
    && Number(order.grants_spins) === 0
    && Number(order.grants_xp) === 0
    && Number(order.grants_rank_advantage) === 0
    && Number(order.grants_discovery_advantage) === 0
    && Number(order.grants_review_advantage) === 0
    && Number(order.grants_event_advantage) === 0
    && Number(order.grants_server_wars_advantage) === 0
    && Number(order.grants_ctf_advantage) === 0
    && Number(order.grants_owner_subscription_access) === 0
    && Number(order.grants_competitive_eligibility) === 0;
}

function validateImmutableSnapshots(order: StoreOrderItemRow) {
  const product = safeJsonRecord(order.immutable_product_snapshot_json);
  const price = safeJsonRecord(order.immutable_price_snapshot_json);
  if (!product || !price) return false;
  return (
    stringValue(product.product_key) === order.product_key
    && stringValue(product.product_type) === order.product_type
    && stringValue(product.fulfilment_kind) === order.fulfilment_kind
  )
    && (
      stringValue(price.price_id) === order.price_id
      && stringValue(price.currency) === "gbp"
      && asOptionalInteger(price.total_amount_minor) === asInteger(order.total_amount_minor)
    );
}

async function markOrderPaid(
  db: D1Database,
  order: StoreOrderItemRow,
  paymentEvent: StorePaymentEventRow,
  ledgerScope: DznStoreSandboxLedgerScope,
  nowIso: string,
  createId?: () => string,
) {
  if (order.order_status === "paid") {
    return { ok: true as const, status: "duplicate" as const, code: "STORE_ORDER_ALREADY_PAID" };
  }

  const update = await db
    .prepare(
      `UPDATE store_orders
       SET status = 'paid',
           paid_at = COALESCE(paid_at, ?),
           updated_at = ?
       WHERE id = ?
         AND status IN ('checkout_created', 'payment_pending')
         AND livemode = 0
         AND ledger_scope IN ('local', 'sandbox')`,
    )
    .bind(nowIso, nowIso, order.order_id)
    .run();

  if (resultChanges(update) !== 1) {
    const current = await readOrderStatus(db, order.order_id);
    if (current === "paid") return { ok: true as const, status: "duplicate" as const, code: "STORE_ORDER_ALREADY_PAID" };
    return { ok: false as const, status: "manual_review" as const, code: "STORE_ORDER_PAID_UPDATE_CONFLICT" };
  }

  await insertOrderStatusHistory(db, {
    id: createIdentifier(createId),
    orderId: order.order_id,
    paymentEventId: paymentEvent.id,
    fromStatus: order.order_status,
    toStatus: "paid",
    reasonCode: "store_checkout_completed",
    ledgerScope,
    nowIso,
  });

  return { ok: true as const, status: "fulfilled" as const, code: "STORE_ORDER_MARKED_PAID" };
}

async function ensureAccountEntitlement(
  db: D1Database,
  order: StoreOrderItemRow,
  paymentEvent: StorePaymentEventRow,
  ledgerScope: DznStoreSandboxLedgerScope,
  nowIso: string,
  createId?: () => string,
) {
  const existing = await readEntitlementForOrderItem(db, order.order_item_id);
  if (existing) return { ok: true as const, row: existing, inserted: false };

  const existingAccountEntitlement = await readActiveEntitlementForUserProduct(db, order.purchasing_user_id, entitlementKey(order.product_key), order.order_item_id);
  if (existingAccountEntitlement) {
    return { ok: false as const, code: "STORE_ENTITLEMENT_ACCOUNT_ALREADY_EXISTS" };
  }

  const entitlementId = createIdentifier(createId);
  const result = await db
    .prepare(
      `INSERT INTO account_entitlements (
         id,
         user_id,
         entitlement_key,
         source_order_id,
         source_order_item_id,
         source_product_key,
         source_product_type,
         source_fulfilment_kind,
         status,
         visibility_state,
         granted_by_payment_event_id,
         granted_at,
         created_at,
         updated_at,
         ledger_scope,
         livemode,
         grants_owner_subscription_access,
         grants_spins,
         grants_xp,
         grants_rank_advantage,
         grants_discovery_advantage,
         grants_review_advantage,
         grants_event_advantage,
         grants_server_wars_advantage,
         grants_ctf_advantage,
         grants_competitive_eligibility
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'visible', ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
       WHERE NOT EXISTS (
         SELECT 1
         FROM account_entitlements
         WHERE user_id = ?
           AND entitlement_key = ?
           AND source_order_item_id <> ?
           AND livemode = 0
           AND status IN ('active', 'hidden', 'suspended', 'manual_review')
       )
       ON CONFLICT(source_order_item_id) DO NOTHING`,
    )
    .bind(
      entitlementId,
      order.purchasing_user_id,
      entitlementKey(order.product_key),
      order.order_id,
      order.order_item_id,
      order.product_key,
      order.product_type,
      order.fulfilment_kind,
      paymentEvent.id,
      nowIso,
      nowIso,
      nowIso,
      ledgerScope,
      order.purchasing_user_id,
      entitlementKey(order.product_key),
      order.order_item_id,
    )
    .run();

  if (resultChanges(result) === 1) {
    return {
      ok: true as const,
      row: { id: entitlementId, status: "active", source_order_item_id: order.order_item_id },
      inserted: true,
    };
  }
  const raceWinner = await readEntitlementForOrderItem(db, order.order_item_id);
  if (raceWinner) return { ok: true as const, row: raceWinner, inserted: false };
  const accountConflict = await readActiveEntitlementForUserProduct(db, order.purchasing_user_id, entitlementKey(order.product_key), order.order_item_id);
  if (accountConflict) return { ok: false as const, code: "STORE_ENTITLEMENT_ACCOUNT_ALREADY_EXISTS" };
  return { ok: false as const, code: "STORE_ENTITLEMENT_INSERT_FAILED" };
}

async function maybeIssueSupporterCard(
  db: D1Database,
  order: StoreOrderItemRow,
  entitlement: StoreEntitlementRow,
  paymentEvent: StorePaymentEventRow,
  access: Extract<StoreFulfilmentAccess, { ok: true }>,
  nowIso: string,
  options: StoreFulfilmentOptions,
) {
  const isSupporterCardProduct = order.product_key === DZN_FOUNDING_SUPPORTER_PRODUCT_KEY && order.fulfilment_kind === "supporter_card";
  if (!isSupporterCardProduct) return { ok: true as const, attempted: false, inserted: false, row: null };
  if (!access.flags.supporterCardsEnabled) return { ok: true as const, attempted: false, inserted: false, row: null };

  const existing = await readSupporterCardForOrderItem(db, order.order_item_id);
  if (existing) return { ok: true as const, attempted: true, inserted: false, row: existing };

  const theme = normalizeSupporterTheme(order.selected_theme_key);
  if (!theme) return { ok: false as const, attempted: true, inserted: false, status: "manual_review" as const, code: "STORE_SUPPORTER_CARD_THEME_MISSING" };

  const hashValue = options.hashValue ?? sha256Hex;
  const displayName = boundedDisplayName(order.purchaser_username) ?? "DZN Player";
  for (let retry = 0; retry < SUPPORTER_CARD_SERIAL_RETRY_LIMIT; retry += 1) {
    const seedHash = await hashValue(`dzn-supporter-card:${order.purchasing_user_id}:${order.order_id}:${order.order_item_id}:${retry}`);
    const serial = supporterSerialFromHash(seedHash);
    const cardId = createIdentifier(options.createId);
    const result = await db
      .prepare(
        `INSERT INTO supporter_cards (
           id,
           user_id,
           entitlement_id,
           source_order_id,
           source_order_item_id,
           serial_number,
           card_type,
           display_name_snapshot,
           supporter_since,
           selected_theme_key,
           insignia_seed_hash,
           generated_insignia_json,
           visibility_state,
           status,
           issued_by_payment_event_id,
           issued_at,
           created_at,
           updated_at,
           ledger_scope,
           livemode
         ) VALUES (?, ?, ?, ?, ?, ?, 'founding_supporter', ?, ?, ?, ?, ?, 'visible', 'active', ?, ?, ?, ?, ?, 0)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        cardId,
        order.purchasing_user_id,
        entitlement.id,
        order.order_id,
        order.order_item_id,
        serial,
        displayName,
        nowIso,
        theme,
        seedHash,
        generatedInsigniaJson(theme, seedHash),
        paymentEvent.id,
        nowIso,
        nowIso,
        nowIso,
        access.ledgerScope,
      )
      .run();

    if (resultChanges(result) === 1) {
      const row = { id: cardId, serial_number: serial, status: "active" };
      await insertEntitlementStatusHistory(db, {
        id: createIdentifier(options.createId),
        entitlementId: null,
        supporterCardId: cardId,
        orderId: order.order_id,
        paymentEventId: paymentEvent.id,
        fromStatus: null,
        toStatus: "active",
        reasonCode: "store_supporter_card_issued",
        ledgerScope: access.ledgerScope,
        nowIso,
      });
      return { ok: true as const, attempted: true, inserted: true, row };
    }

    const existingAfterConflict = await readSupporterCardForOrderItem(db, order.order_item_id)
      ?? await readSupporterCardForUser(db, order.purchasing_user_id);
    if (existingAfterConflict) {
      return { ok: true as const, attempted: true, inserted: false, row: existingAfterConflict };
    }
  }

  return { ok: false as const, attempted: true, inserted: false, status: "manual_review" as const, code: "STORE_SUPPORTER_CARD_SERIAL_COLLISION" };
}

function refundDisputeDecision(event: StripeEvent, order: StoreOrderItemRow) {
  const object = asRecord(event.data.object) ?? {};
  if (event.type === "charge.dispute.created") {
    return {
      attemptStatus: "fulfilled" as const,
      orderStatus: "disputed",
      entitlementStatus: "suspended",
      localDecision: "suspend",
      refundKind: "none",
      disputeStatus: safeEnumString(object.status),
      amountMinor: asOptionalInteger(object.amount),
      currency: safeEnumString(object.currency),
      code: "STORE_DISPUTE_CREATED_SUSPENDED",
    };
  }

  if (event.type === "charge.dispute.closed") {
    const status = safeEnumString(object.status);
    if (status === "lost") {
      return {
        attemptStatus: "fulfilled" as const,
        orderStatus: "revoked",
        entitlementStatus: "revoked",
        localDecision: "revoke",
        refundKind: "none",
        disputeStatus: status,
        amountMinor: asOptionalInteger(object.amount),
        currency: safeEnumString(object.currency),
        code: "STORE_DISPUTE_LOST_REVOKED",
      };
    }
    if (status === "won" && !order.refunded_at && !order.revoked_at && order.order_status === "disputed") {
      return {
        attemptStatus: "fulfilled" as const,
        orderStatus: "paid",
        entitlementStatus: "active",
        localDecision: "restore",
        refundKind: "none",
        disputeStatus: status,
        amountMinor: asOptionalInteger(object.amount),
        currency: safeEnumString(object.currency),
        code: "STORE_DISPUTE_WON_RESTORED",
      };
    }
    return {
      attemptStatus: "manual_review" as const,
      orderStatus: "manual_review",
      entitlementStatus: null,
      localDecision: "manual_review",
      refundKind: "none",
      disputeStatus: status,
      amountMinor: asOptionalInteger(object.amount),
      currency: safeEnumString(object.currency),
      code: "STORE_DISPUTE_CLOSED_MANUAL_REVIEW",
    };
  }

  const amountMinor = asOptionalInteger(object.amount_refunded) ?? asOptionalInteger(object.amount);
  const currency = safeEnumString(object.currency);
  const refundKind = amountMinor !== null && amountMinor >= asInteger(order.total_amount_minor)
    ? "full"
    : amountMinor !== null && amountMinor > 0
      ? "partial"
      : "none";

  if (refundKind === "full") {
    return {
      attemptStatus: "fulfilled" as const,
      orderStatus: "refunded",
      entitlementStatus: "revoked",
      localDecision: "revoke",
      refundKind,
      disputeStatus: null,
      amountMinor,
      currency,
      code: "STORE_FULL_REFUND_REVOKED",
    };
  }

  return {
    attemptStatus: "manual_review" as const,
    orderStatus: "manual_review",
    entitlementStatus: null,
    localDecision: "manual_review",
    refundKind,
    disputeStatus: null,
    amountMinor,
    currency,
    code: "STORE_PARTIAL_REFUND_MANUAL_REVIEW",
  };
}

async function moveOrderToReviewState(
  db: D1Database,
  order: StoreOrderItemRow,
  paymentEvent: StorePaymentEventRow,
  attemptStatus: "manual_review" | "blocked_by_flag" | "no_op" | "failed",
  reasonCode: string,
  ledgerScope: DznStoreSandboxLedgerScope,
  nowIso: string,
  createId?: () => string,
) {
  if (attemptStatus !== "manual_review" && attemptStatus !== "blocked_by_flag") return;
  const toStatus = attemptStatus;
  await updateOrderStatus(db, { order, paymentEvent, toStatus, reasonCode, ledgerScope, nowIso, createId });
}

async function updateOrderStatus(
  db: D1Database,
  input: {
    order: StoreOrderItemRow;
    paymentEvent: StorePaymentEventRow;
    toStatus: string;
    reasonCode: string;
    ledgerScope: DznStoreSandboxLedgerScope;
    nowIso: string;
    createId?: () => string;
  },
) {
  if (input.order.order_status === input.toStatus) return;
  const timestampColumn = input.toStatus === "refunded"
    ? "refunded_at = COALESCE(refunded_at, ?),"
    : input.toStatus === "revoked"
      ? "revoked_at = COALESCE(revoked_at, ?),"
      : "";
  const update = await db
    .prepare(
      `UPDATE store_orders
       SET status = ?,
           ${timestampColumn}
           updated_at = ?
       WHERE id = ?
         AND livemode = 0
         AND ledger_scope IN ('local', 'sandbox')`,
    )
    .bind(...(timestampColumn ? [input.toStatus, input.nowIso, input.nowIso, input.order.order_id] : [input.toStatus, input.nowIso, input.order.order_id]))
    .run();
  if (resultChanges(update) < 1) return;
  await insertOrderStatusHistory(db, {
    id: createIdentifier(input.createId),
    orderId: input.order.order_id,
    paymentEventId: input.paymentEvent.id,
    fromStatus: input.order.order_status,
    toStatus: input.toStatus,
    reasonCode: input.reasonCode,
    ledgerScope: input.ledgerScope,
    nowIso: input.nowIso,
  });
}

async function updateAccountEntitlementStatus(
  db: D1Database,
  order: StoreOrderItemRow,
  paymentEvent: StorePaymentEventRow,
  toStatus: string,
  reasonCode: string,
  ledgerScope: DznStoreSandboxLedgerScope,
  nowIso: string,
  createId?: () => string,
) {
  if (!order.entitlement_id) return { attempted: false, changed: false };
  const timestampAssignments = statusTimestampAssignments(toStatus);
  const result = await db
    .prepare(
      `UPDATE account_entitlements
       SET status = ?,
           ${timestampAssignments}
           revoked_by_payment_event_id = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_by_payment_event_id END,
           revoke_reason = CASE WHEN ? = 'revoked' THEN ? ELSE revoke_reason END,
           status_reason = ?,
           updated_at = ?
       WHERE id = ?
         AND source_order_item_id = ?
         AND livemode = 0`,
    )
    .bind(
      toStatus,
      toStatus,
      nowIso,
      toStatus,
      toStatus,
      nowIso,
      toStatus,
      paymentEvent.id,
      toStatus,
      reasonCode,
      reasonCode,
      nowIso,
      order.entitlement_id,
      order.order_item_id,
    )
    .run();
  const changed = resultChanges(result) > 0;
  if (changed) {
    await insertEntitlementStatusHistory(db, {
      id: createIdentifier(createId),
      entitlementId: order.entitlement_id,
      supporterCardId: null,
      orderId: order.order_id,
      paymentEventId: paymentEvent.id,
      fromStatus: order.entitlement_status,
      toStatus,
      reasonCode,
      ledgerScope,
      nowIso,
    });
  }
  return { attempted: true, changed };
}

async function updateSupporterCardStatus(
  db: D1Database,
  order: StoreOrderItemRow,
  paymentEvent: StorePaymentEventRow,
  toStatus: string,
  reasonCode: string,
  ledgerScope: DznStoreSandboxLedgerScope,
  nowIso: string,
  createId?: () => string,
) {
  if (!order.supporter_card_id) return { attempted: false, changed: false };
  const timestampAssignments = statusTimestampAssignments(toStatus);
  const result = await db
    .prepare(
      `UPDATE supporter_cards
       SET status = ?,
           ${timestampAssignments}
           revoked_by_payment_event_id = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_by_payment_event_id END,
           revoke_reason = CASE WHEN ? = 'revoked' THEN ? ELSE revoke_reason END,
           updated_at = ?
       WHERE id = ?
         AND source_order_item_id = ?
         AND livemode = 0`,
    )
    .bind(
      toStatus,
      toStatus,
      nowIso,
      toStatus,
      toStatus,
      nowIso,
      toStatus,
      paymentEvent.id,
      toStatus,
      reasonCode,
      nowIso,
      order.supporter_card_id,
      order.order_item_id,
    )
    .run();
  const changed = resultChanges(result) > 0;
  if (changed) {
    await insertEntitlementStatusHistory(db, {
      id: createIdentifier(createId),
      entitlementId: null,
      supporterCardId: order.supporter_card_id,
      orderId: order.order_id,
      paymentEventId: paymentEvent.id,
      fromStatus: order.supporter_card_status,
      toStatus,
      reasonCode,
      ledgerScope,
      nowIso,
    });
  }
  return { attempted: true, changed };
}

function statusTimestampAssignments(toStatus: string) {
  void toStatus;
  return `suspended_at = CASE
             WHEN ? = 'suspended' THEN COALESCE(suspended_at, ?)
             WHEN ? = 'active' THEN NULL
             ELSE suspended_at
           END,
           revoked_at = CASE
             WHEN ? = 'revoked' THEN COALESCE(revoked_at, ?)
             ELSE revoked_at
           END,`;
}

async function readPaymentEventByStripeEventId(db: D1Database, stripeEventId: string) {
  return db
    .prepare(
      `SELECT
         id,
         stripe_event_id,
         event_type,
         event_class,
         ledger_scope,
         livemode,
         processing_status,
         related_order_id,
         stripe_checkout_session_id,
         stripe_payment_intent_id,
         stripe_charge_id,
         stripe_refund_id,
         stripe_dispute_id
       FROM store_payment_events
       WHERE stripe_event_id = ?
         AND livemode = 0
       LIMIT 1`,
    )
    .bind(stripeEventId)
    .first<StorePaymentEventRow>();
}

async function resolveFulfilmentOrderId(
  db: D1Database,
  paymentEvent: StorePaymentEventRow,
  refs: DznStoreFulfilmentPaymentRefs,
) {
  if (normalizeRecordId(paymentEvent.related_order_id)) return paymentEvent.related_order_id;
  if (refs.stripeCheckoutSessionId) {
    const row = await db
      .prepare("SELECT id FROM store_orders WHERE stripe_checkout_session_id = ? AND livemode = 0 LIMIT 1")
      .bind(refs.stripeCheckoutSessionId)
      .first<{ id: string }>();
    if (row?.id) return row.id;
  }
  if (refs.stripePaymentIntentId) {
    const row = await db
      .prepare("SELECT id FROM store_orders WHERE stripe_payment_intent_id = ? AND livemode = 0 LIMIT 1")
      .bind(refs.stripePaymentIntentId)
      .first<{ id: string }>();
    if (row?.id) return row.id;
  }
  return null;
}

async function readFulfilmentOrder(db: D1Database, orderId: string) {
  return db
    .prepare(
      `SELECT
         store_orders.id AS order_id,
         store_orders.order_number,
         store_orders.purchasing_user_id,
         users.username AS purchaser_username,
         store_orders.status AS order_status,
         store_orders.ledger_scope,
         store_orders.livemode AS order_livemode,
         store_orders.product_count,
         store_orders.currency,
         store_orders.subtotal_amount_minor,
         store_orders.tax_amount_minor,
         store_orders.total_amount_minor,
         store_orders.selected_theme_key,
         store_orders.stripe_checkout_session_id,
         store_orders.stripe_payment_intent_id,
         store_orders.immutable_product_snapshot_json,
         store_orders.immutable_price_snapshot_json,
         store_orders.terms_version,
         store_orders.checkout_session_expires_at,
         store_orders.paid_at,
         store_orders.refunded_at,
         store_orders.revoked_at,
         store_order_items.id AS order_item_id,
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
         account_entitlements.id AS entitlement_id,
         account_entitlements.status AS entitlement_status,
         supporter_cards.id AS supporter_card_id,
         supporter_cards.status AS supporter_card_status
       FROM store_orders
       INNER JOIN store_order_items ON store_order_items.order_id = store_orders.id
       LEFT JOIN users ON users.id = store_orders.purchasing_user_id
       LEFT JOIN account_entitlements ON account_entitlements.source_order_item_id = store_order_items.id
       LEFT JOIN supporter_cards ON supporter_cards.source_order_item_id = store_order_items.id
       WHERE store_orders.id = ?
         AND store_orders.livemode = 0
       LIMIT 1`,
    )
    .bind(orderId)
    .first<StoreOrderItemRow>();
}

async function readOrderStatus(db: D1Database, orderId: string) {
  const row = await db
    .prepare("SELECT status FROM store_orders WHERE id = ? AND livemode = 0 LIMIT 1")
    .bind(orderId)
    .first<{ status: string }>();
  return row?.status ?? null;
}

async function readEntitlementForOrderItem(db: D1Database, orderItemId: string) {
  return db
    .prepare("SELECT id, status, source_order_item_id FROM account_entitlements WHERE source_order_item_id = ? AND livemode = 0 LIMIT 1")
    .bind(orderItemId)
    .first<StoreEntitlementRow>();
}

async function readActiveEntitlementForUserProduct(db: D1Database, userId: string, key: string, currentOrderItemId: string) {
  return db
    .prepare(
      `SELECT id, status, source_order_item_id
       FROM account_entitlements
       WHERE user_id = ?
         AND entitlement_key = ?
         AND source_order_item_id <> ?
         AND livemode = 0
         AND status IN ('active', 'hidden', 'suspended', 'manual_review')
       LIMIT 1`,
    )
    .bind(userId, key, currentOrderItemId)
    .first<StoreEntitlementRow>();
}

async function readSupporterCardForOrderItem(db: D1Database, orderItemId: string) {
  return db
    .prepare("SELECT id, serial_number, status FROM supporter_cards WHERE source_order_item_id = ? AND livemode = 0 LIMIT 1")
    .bind(orderItemId)
    .first<StoreSupporterCardRow>();
}

async function readSupporterCardForUser(db: D1Database, userId: string) {
  return db
    .prepare("SELECT id, serial_number, status FROM supporter_cards WHERE user_id = ? AND card_type = 'founding_supporter' AND livemode = 0 LIMIT 1")
    .bind(userId)
    .first<StoreSupporterCardRow>();
}

async function readFulfilmentAttempt(db: D1Database, paymentEventId: string) {
  return db
    .prepare("SELECT id, status, entitlement_id, supporter_card_id FROM store_fulfilment_attempts WHERE payment_event_id = ? LIMIT 1")
    .bind(paymentEventId)
    .first<StoreFulfilmentAttemptRow>();
}

async function insertFulfilmentAttempt(
  db: D1Database,
  input: {
    id: string;
    attemptKey: string;
    paymentEvent: StorePaymentEventRow;
    order: StoreOrderItemRow;
    status: "received";
    access: Extract<StoreFulfilmentAccess, { ok: true }>;
    refs: DznStoreFulfilmentPaymentRefs;
    event: StripeEvent;
    nowIso: string;
  },
) {
  const result = await db
    .prepare(
      `INSERT INTO store_fulfilment_attempts (
         id,
         attempt_key,
         payment_event_id,
         stripe_event_id,
         event_type,
         order_id,
         order_item_id,
         livemode,
         ledger_scope,
         status,
         fulfilment_flags_snapshot_json,
         safe_event_summary_json,
         started_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(payment_event_id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.attemptKey,
      input.paymentEvent.id,
      input.paymentEvent.stripe_event_id,
      input.paymentEvent.event_type,
      input.order.order_id,
      input.order.order_item_id,
      input.access.ledgerScope,
      input.status,
      JSON.stringify(flagsSnapshot(input.access)),
      JSON.stringify(safeEventSummary(input.event, input.refs, true)),
      input.nowIso,
      input.nowIso,
      input.nowIso,
    )
    .run();
  return resultChanges(result) === 1;
}

async function finalizeFulfilmentAttempt(
  db: D1Database,
  attemptId: string,
  input: {
    status: DznStoreFulfilmentResult["status"];
    code: string;
    entitlementId?: string | null;
    supporterCardId?: string | null;
    nowIso: string;
  },
) {
  await db
    .prepare(
      `UPDATE store_fulfilment_attempts
       SET status = ?,
           eligibility_failure_code = CASE WHEN ? IN ('manual_review', 'blocked_by_flag', 'failed', 'no_op') THEN ? ELSE eligibility_failure_code END,
           entitlement_id = COALESCE(?, entitlement_id),
           supporter_card_id = COALESCE(?, supporter_card_id),
           error_code = CASE WHEN ? = 'failed' THEN ? ELSE error_code END,
           error_message = CASE WHEN ? = 'failed' THEN ? ELSE error_message END,
           finished_at = COALESCE(finished_at, ?),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.status,
      input.status,
      input.code,
      input.entitlementId ?? null,
      input.supporterCardId ?? null,
      input.status,
      input.code,
      input.status,
      input.code,
      input.nowIso,
      input.nowIso,
      attemptId,
    )
    .run();
}

async function insertOrderStatusHistory(
  db: D1Database,
  input: {
    id: string;
    orderId: string;
    paymentEventId: string;
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    ledgerScope: DznStoreSandboxLedgerScope;
    nowIso: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO store_order_status_history (
         id,
         order_id,
         payment_event_id,
         from_status,
         to_status,
         reason_code,
         actor_type,
         safe_summary_json,
         created_at,
         ledger_scope,
         livemode
       ) VALUES (?, ?, ?, ?, ?, ?, 'stripe_webhook', ?, ?, ?, 0)
       ON CONFLICT(order_id, payment_event_id, to_status) DO NOTHING`,
    )
    .bind(
      input.id,
      input.orderId,
      input.paymentEventId,
      input.fromStatus,
      input.toStatus,
      input.reasonCode,
      JSON.stringify(statusHistorySummary(input.reasonCode, input.toStatus)),
      input.nowIso,
      input.ledgerScope,
    )
    .run();
}

async function insertEntitlementStatusHistory(
  db: D1Database,
  input: {
    id: string;
    entitlementId: string | null;
    supporterCardId: string | null;
    orderId: string;
    paymentEventId: string;
    fromStatus: string | null;
    toStatus: string;
    reasonCode: string;
    ledgerScope: DznStoreSandboxLedgerScope;
    nowIso: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO store_entitlement_status_history (
         id,
         entitlement_id,
         supporter_card_id,
         order_id,
         payment_event_id,
         from_status,
         to_status,
         reason_code,
         actor_type,
         safe_summary_json,
         created_at,
         ledger_scope,
         livemode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stripe_webhook', ?, ?, ?, 0)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.id,
      input.entitlementId,
      input.supporterCardId,
      input.orderId,
      input.paymentEventId,
      input.fromStatus,
      input.toStatus,
      input.reasonCode,
      JSON.stringify(statusHistorySummary(input.reasonCode, input.toStatus)),
      input.nowIso,
      input.ledgerScope,
    )
    .run();
}

async function insertRefundDisputeAudit(
  db: D1Database,
  input: {
    id: string;
    paymentEvent: StorePaymentEventRow;
    event: StripeEvent;
    order: StoreOrderItemRow;
    decision: ReturnType<typeof refundDisputeDecision>;
    refs: DznStoreFulfilmentPaymentRefs;
    ledgerScope: DznStoreSandboxLedgerScope;
    nowIso: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO store_refund_dispute_audit (
         id,
         payment_event_id,
         order_id,
         event_type,
         stripe_charge_id,
         stripe_refund_id,
         stripe_dispute_id,
         amount_minor,
         currency,
         refund_kind,
         dispute_status,
         local_decision,
         decision_reason,
         safe_summary_json,
         created_at,
         ledger_scope,
         livemode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(payment_event_id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.paymentEvent.id,
      input.order.order_id,
      input.event.type,
      input.refs.stripeChargeId,
      input.refs.stripeRefundId,
      input.refs.stripeDisputeId,
      input.decision.amountMinor,
      input.decision.currency,
      input.decision.refundKind,
      input.decision.disputeStatus,
      input.decision.localDecision,
      input.decision.code,
      JSON.stringify(safeRefundDisputeSummary(input.event, input.decision)),
      input.nowIso,
      input.ledgerScope,
    )
    .run();
}

function fulfilmentResult(
  attempted: boolean,
  status: DznStoreFulfilmentResult["status"],
  reasonCode: string,
  event: StripeEvent,
  refs: DznStoreFulfilmentPaymentRefs,
  extra: {
    orderLinked?: boolean;
    orderStatus?: string | null;
    entitlementWriteAttempted?: boolean;
    entitlementWritten?: boolean;
    supporterCardWriteAttempted?: boolean;
    supporterCardWritten?: boolean;
    refundDisputeAuditWritten?: boolean;
    duplicate?: boolean;
  },
): DznStoreFulfilmentResult {
  return {
    attempted,
    status,
    reason_code: reasonCode,
    duplicate: extra.duplicate ?? false,
    event_type: event.type,
    event_class: refs.eventClass,
    order_linked: extra.orderLinked ?? false,
    order_status: extra.orderStatus ?? null,
    entitlement_write_attempted: extra.entitlementWriteAttempted ?? false,
    entitlement_written: extra.entitlementWritten ?? false,
    supporter_card_write_attempted: extra.supporterCardWriteAttempted ?? false,
    supporter_card_written: extra.supporterCardWritten ?? false,
    refund_dispute_audit_written: extra.refundDisputeAuditWritten ?? false,
    live_checkout_enabled: false,
  };
}

function blockedAccess(
  code: string,
  message: string,
  flags: DznStoreCatalogFlags,
  runtime: DznStoreSandboxRuntime | null,
): StoreFulfilmentAccess {
  return {
    ok: false,
    status: 403,
    code,
    message,
    runtime,
    flags,
  };
}

function validationError(status: "manual_review" | "blocked_by_flag" | "no_op" | "failed", code: string): ValidationResult {
  return { ok: false, status, code };
}

function isRefundOrDisputeEvent(eventType: string) {
  return eventType === "charge.refunded"
    || eventType === "refund.created"
    || eventType === "refund.updated"
    || eventType === "charge.dispute.created"
    || eventType === "charge.dispute.closed";
}

function flagsSnapshot(access: Extract<StoreFulfilmentAccess, { ok: true }>) {
  return {
    schema_version: DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION,
    runtime: access.runtime,
    ledger_scope: access.ledgerScope,
    store_enabled: access.flags.storeEnabled,
    checkout_enabled: access.flags.checkoutEnabled,
    sandbox_checkout_enabled: access.flags.sandboxCheckoutEnabled,
    webhook_receipt_enabled: true,
    webhook_fulfilment_enabled: true,
    supporter_cards_enabled: access.flags.supporterCardsEnabled,
    earned_spins_enabled: false,
    reward_wheel_enabled: false,
    store_live_checkout_enabled: false,
    owner_live_checkout_enabled: false,
    stripe_product_price_mutation_attempted: false,
    cloudflare_config_mutation_attempted: false,
    production_d1_write_attempted: false,
    issue_49_changed: false,
  };
}

function safeEventSummary(event: StripeEvent, refs: DznStoreFulfilmentPaymentRefs, orderLinked: boolean) {
  return {
    schema_version: DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION,
    event_type: event.type,
    event_class: refs.eventClass,
    livemode: false,
    order_linked: orderLinked,
    provider_references_present: {
      checkout_session: Boolean(refs.stripeCheckoutSessionId),
      payment_intent: Boolean(refs.stripePaymentIntentId),
      charge: Boolean(refs.stripeChargeId),
      refund: Boolean(refs.stripeRefundId),
      dispute: Boolean(refs.stripeDisputeId),
    },
    raw_event_body_stored: false,
    customer_details_stored: false,
    payment_method_details_stored: false,
    earned_spin_write_attempted: false,
    wheel_runtime_attempted: false,
    public_profile_visibility_changed: false,
    competitive_system_changed: false,
  };
}

function statusHistorySummary(reasonCode: string, toStatus: string) {
  return {
    schema_version: DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION,
    reason_code: reasonCode,
    to_status: toStatus,
    raw_provider_payload_stored: false,
    private_payment_details_stored: false,
    owner_entitlement_changed: false,
    competitive_system_changed: false,
  };
}

function safeRefundDisputeSummary(event: StripeEvent, decision: ReturnType<typeof refundDisputeDecision>) {
  return {
    schema_version: DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION,
    event_type: event.type,
    local_decision: decision.localDecision,
    refund_kind: decision.refundKind,
    dispute_status: decision.disputeStatus,
    raw_provider_payload_stored: false,
    private_payment_details_stored: false,
    unrelated_entitlements_changed: false,
    competitive_system_changed: false,
  };
}

function generatedInsigniaJson(theme: string, seedHash: string) {
  return JSON.stringify({
    schema_version: DZN_STORE_FULFILMENT_RUNTIME_SCHEMA_VERSION,
    theme_key: theme,
    pattern_family: "signal-crown",
    accent_seed: seedHash.slice(0, 16),
    generated_server_side: true,
    private_payment_data_included: false,
    competitive_value: false,
  });
}

function supporterSerialFromHash(hash: string) {
  const number = Number.parseInt(hash.slice(0, 12), 16) % 1_000_000;
  return `DZN-SUP-${number.toString().padStart(6, "0")}`;
}

async function createAttemptKey(paymentEventId: string, stripeEventId: string, hashValue: (value: string) => Promise<string>) {
  const hash = await hashValue(`dzn-store-fulfilment:${paymentEventId}:${stripeEventId}`);
  return `dzn-store-fulfil-${hash.slice(0, 48)}`;
}

function entitlementKey(productKey: string) {
  return `dzn_store_${productKey}`;
}

function resultChanges(result: D1Result) {
  const changes = Number(result.meta?.changes ?? result.meta?.rows_written ?? result.meta?.rowsWritten ?? 0);
  return Number.isFinite(changes) ? changes : 0;
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createIdentifier(createId?: () => string) {
  if (createId) return createId();
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `dzn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function stripeProviderId(value: unknown, allowedPrefixes: string[]) {
  const id = stripeId(value);
  if (!id || id.length > 128 || !STRIPE_ID_PATTERN.test(id)) return null;
  return allowedPrefixes.some((prefix) => id.startsWith(prefix)) ? id : null;
}

function metadataRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) return {} as Record<string, string>;
  const metadata: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") metadata[key] = item;
  }
  return metadata;
}

function safeJsonRecord(value: string) {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeRecordId(value: unknown) {
  const text = normalizeString(value);
  if (!text || !RECORD_ID_PATTERN.test(text)) return null;
  return text;
}

function normalizeSupporterTheme(value: unknown) {
  const text = normalizeString(value);
  if (!text || !SUPPORTER_THEME_PATTERN.test(text)) return null;
  return text;
}

function boundedDisplayName(value: unknown) {
  const text = normalizeString(value);
  if (!text) return null;
  return text.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").slice(0, 96);
}

function safeEnumString(value: unknown) {
  const text = normalizeString(value);
  if (!text || text.length > 64 || !/^[a-z0-9_.-]+$/i.test(text)) return null;
  return text;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asOptionalInteger(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  return number;
}

function asInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number)) return -1;
  return number;
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

function readEnvValue(env: Env | StoreFulfilmentEnvRecord, key: string) {
  return (env as unknown as StoreFulfilmentEnvRecord)[key];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
