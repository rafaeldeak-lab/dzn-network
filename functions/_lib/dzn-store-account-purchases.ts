import { DZN_FOUNDING_SUPPORTER_PRODUCT_KEY, readDznStoreCatalogFlags } from "./dzn-store-catalog";
import {
  readDznStoreSandboxRuntime,
  sandboxLedgerScopeForRuntime,
  type DznStoreSandboxLedgerScope,
  type DznStoreSandboxRuntime,
} from "./dzn-store-orders";
import type { Env, SessionUser } from "./types";

export const DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE = "/api/account/purchases";
export const DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_FLAG = "DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ENABLED";
export const DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG = "DZN_SUPPORTER_CARD_PRIVATE_REVEAL_ENABLED";
export const DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION = "2026-08-31.store-account-purchases-read-model-v2";

const MAX_PURCHASE_ROWS = 50;
const MAX_AUDIT_ROWS = 200;

export type DznStoreAccountPurchasesReadModelAccess =
  | {
      ok: true;
      runtime: DznStoreSandboxRuntime;
      ledgerScope: DznStoreSandboxLedgerScope;
    }
  | {
      ok: false;
      status: 403 | 404;
      code: string;
      message: string;
      runtime: DznStoreSandboxRuntime | null;
    };

export type DznStoreAccountPurchasesResult =
  | { ok: true; status: 200; body: DznStoreAccountPurchasesPayload }
  | { ok: false; status: 403 | 404 | 503; body: DznStoreAccountPurchasesErrorPayload };

export type DznStoreAccountPurchasesPayload = {
  ok: true;
  private: true;
  cache: "no-store";
  scope: "current_user";
  route: typeof DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE;
  schema_version: typeof DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION;
  generated_at: string;
  account: {
    display_name: string;
  };
  purchases_count: number;
  purchases: DznStorePurchaseSummary[];
  entitlements_count: number;
  entitlements: DznStoreEntitlementSummary[];
  supporter_cards_count: number;
  supporter_cards: DznStoreSupporterCardStatus[];
  safety: DznStoreAccountPurchasesSafety;
  unavailable_actions: readonly string[];
};

export type DznStoreAccountPurchasesErrorPayload = {
  ok: false;
  private: true;
  cache: "no-store";
  scope: "current_user";
  route: typeof DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE;
  schema_version: typeof DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION;
  error: string;
  message: string;
  purchases_available: false;
  live_checkout_enabled: false;
  safety: DznStoreAccountPurchasesSafety;
};

export type DznStorePurchaseSummary = {
  purchase_ref: string;
  status: string;
  ledger_scope: DznStoreSandboxLedgerScope;
  livemode: false;
  product_count: number;
  currency: string;
  subtotal_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  selected_theme_key: string | null;
  terms_version: string;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  revoked_at: string | null;
  product: {
    product_key: string;
    name: string;
    product_type: string;
    fulfilment_kind: string;
    quantity: number;
    unit_amount_minor: number;
    tax_amount_minor: number;
    total_amount_minor: number;
  };
  labels: {
    guaranteed_purchase: boolean;
    account_bound: boolean;
    no_competitive_advantage: boolean;
  };
  entitlement: DznStoreEntitlementSummary | null;
  supporter_card: DznStoreSupporterCardStatus | null;
  payment_receipt: DznStorePaymentReceiptSummary;
  fulfilment: DznStoreFulfilmentSummary | null;
  refund_or_dispute: DznStoreRefundDisputeSummary | null;
  order_status_history: DznStoreStatusHistoryEntry[];
  entitlement_status_history: DznStoreStatusHistoryEntry[];
  fair_progression_boundary: DznStoreFairProgressionBoundary;
};

export type DznStoreEntitlementSummary = {
  purchase_ref: string;
  entitlement_key: string;
  product_key: string;
  product_type: string;
  fulfilment_kind: string;
  status: string;
  visibility_state: string;
  granted_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
  ledger_scope: DznStoreSandboxLedgerScope;
  livemode: false;
  fair_progression_boundary: DznStoreFairProgressionBoundary;
};

export type DznStoreSupporterCardStatus = {
  purchase_ref: string;
  product_key: string;
  status: string;
  visibility_state: string;
  supporter_since: string | null;
  selected_theme_key: string | null;
  issued_at: string | null;
  suspended_at: string | null;
  revoked_at: string | null;
  private_reveal_available: boolean;
  public_reveal_available: false;
  reveal_blocked_reason: "supporter_card_private_reveal_disabled" | "supporter_card_not_privately_viewable" | null;
};

export type DznStorePaymentReceiptSummary =
  | {
      recorded: false;
      status: "not_recorded";
    }
  | {
      recorded: true;
      event_type: string;
      event_class: string;
      processing_status: string;
      received_at: string | null;
      processed_at: string | null;
      failure_code: string | null;
      receipt_source: "sanitized_store_payment_events";
    };

export type DznStoreFulfilmentSummary = {
  status: string;
  event_type: string;
  eligibility_failure_code: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type DznStoreRefundDisputeSummary = {
  event_type: string;
  refund_kind: string | null;
  dispute_status: string | null;
  local_decision: string;
  decision_reason: string;
  created_at: string | null;
};

export type DznStoreStatusHistoryEntry = {
  status: string;
  reason_code: string;
  actor_type: string;
  created_at: string | null;
};

export type DznStoreAccountPurchasesSafety = {
  read_only: true;
  sanitized_ledgers_only: true;
  current_user_only: true;
  private_supporter_card_reveal: boolean;
  public_supporter_card_reveal: false;
  webhook_replay_route: false;
  manual_review_route: false;
  refund_dispute_operator_route: false;
  notifications: false;
  live_checkout_enabled: false;
  stripe_mutation: false;
  cloudflare_config_mutation: false;
  production_d1_write: false;
  earned_spin_write: false;
  reward_wheel_runtime: false;
  issue_49_changed: false;
  billing_effect: false;
  owner_entitlement_effect: false;
  server_ownership_effect: false;
  ranking_effect: false;
  discovery_effect: false;
  review_effect: false;
  badge_effect: false;
  season_effect: false;
  event_effect: false;
  server_wars_effect: false;
  ctf_effect: false;
  xp_award_effect: false;
  calling_card_award_effect: false;
  public_profile_visibility_effect: false;
  competitive_eligibility_effect: false;
};

export type DznStoreFairProgressionBoundary = {
  grants_spins: false;
  grants_xp: false;
  grants_rank_advantage: false;
  grants_discovery_advantage: false;
  grants_review_advantage: false;
  grants_event_advantage: false;
  grants_server_wars_advantage: false;
  grants_ctf_advantage: false;
  grants_owner_subscription_access: false;
  grants_competitive_eligibility: false;
};

type StoreAccountPurchasesOptions = {
  now?: Date;
};

type StorePurchaseRow = {
  order_id: string;
  order_number: string;
  order_status: string;
  ledger_scope: DznStoreSandboxLedgerScope;
  order_livemode: number;
  product_count: number;
  currency: string;
  subtotal_amount_minor: number;
  tax_amount_minor: number;
  total_amount_minor: number;
  selected_theme_key: string | null;
  terms_version: string;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  revoked_at: string | null;
  order_item_id: string;
  product_key: string;
  product_name_snapshot: string;
  product_type: string;
  fulfilment_kind: string;
  quantity: number;
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
  entitlement_key: string | null;
  entitlement_status: string | null;
  entitlement_visibility_state: string | null;
  entitlement_granted_at: string | null;
  entitlement_suspended_at: string | null;
  entitlement_revoked_at: string | null;
  supporter_card_status: string | null;
  supporter_card_visibility_state: string | null;
  supporter_since: string | null;
  supporter_card_theme_key: string | null;
  supporter_card_issued_at: string | null;
  supporter_card_suspended_at: string | null;
  supporter_card_revoked_at: string | null;
};

type PaymentEventRow = {
  related_order_id: string;
  event_type: string;
  event_class: string;
  processing_status: string;
  received_at: string | null;
  processed_at: string | null;
  failure_code: string | null;
};

type FulfilmentAttemptRow = {
  order_id: string;
  event_type: string;
  status: string;
  eligibility_failure_code: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type RefundDisputeAuditRow = {
  order_id: string;
  event_type: string;
  refund_kind: string | null;
  dispute_status: string | null;
  local_decision: string;
  decision_reason: string;
  created_at: string | null;
};

type OrderStatusHistoryRow = {
  order_id: string;
  to_status: string;
  reason_code: string;
  actor_type: string;
  created_at: string | null;
};

type EntitlementStatusHistoryRow = {
  order_id: string;
  to_status: string;
  reason_code: string;
  actor_type: string;
  created_at: string | null;
};

type EnvRecord = Record<string, unknown>;

export function canReadDznStoreAccountPurchasesReadModel(env: Env | EnvRecord = {}): DznStoreAccountPurchasesReadModelAccess {
  const readModelEnabled = parseBooleanFlag(readEnvValue(env, DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_FLAG));
  const flags = readDznStoreCatalogFlags(env as EnvRecord);
  const runtime = readDznStoreSandboxRuntime(env as Env);
  const ownerLiveCheckoutEnabled = parseBooleanFlag(readEnvValue(env, "DZN_LIVE_CHECKOUT_ENABLED"));

  if (!readModelEnabled) {
    return blockedAccess("STORE_ACCOUNT_PURCHASES_READ_MODEL_DISABLED", "DZN Store Account Purchases are not available yet.", runtime, 404);
  }
  if (!flags.storeEnabled) {
    return blockedAccess("STORE_DISABLED", "DZN Store is disabled.", runtime, 404);
  }
  if (!runtime) {
    return blockedAccess("STORE_SANDBOX_RUNTIME_REQUIRED", "DZN Store Account Purchases require local/test sandbox runtime.", runtime, 403);
  }
  if (flags.liveCheckoutEnabled || ownerLiveCheckoutEnabled) {
    return blockedAccess("STORE_LIVE_CHECKOUT_BLOCKED", "Live checkout remains blocked for this Store read model.", runtime, 403);
  }
  if (flags.earnedSpinsEnabled) {
    return blockedAccess("STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED", "Earned-spin runtime is outside this Store read model slice.", runtime, 403);
  }
  if (flags.rewardWheelEnabled) {
    return blockedAccess("STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED", "Reward wheel runtime is outside this Store read model slice.", runtime, 403);
  }

  return {
    ok: true,
    runtime,
    ledgerScope: sandboxLedgerScopeForRuntime(runtime),
  };
}

export function canReadDznStorePrivateSupporterCardReveal(env: Env | EnvRecord = {}): DznStoreAccountPurchasesReadModelAccess {
  const readModelAccess = canReadDznStoreAccountPurchasesReadModel(env);
  if (!readModelAccess.ok) return readModelAccess;

  const privateRevealEnabled = parseBooleanFlag(readEnvValue(env, DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG));
  if (!privateRevealEnabled) {
    return blockedAccess(
      "STORE_SUPPORTER_CARD_PRIVATE_REVEAL_DISABLED",
      "Private Supporter Card reveal is not available yet.",
      readModelAccess.runtime,
      404,
    );
  }

  return readModelAccess;
}

export async function readDznStoreAccountPurchasesReadModel(
  env: Env,
  user: SessionUser,
  options: StoreAccountPurchasesOptions = {},
): Promise<DznStoreAccountPurchasesResult> {
  const access = canReadDznStoreAccountPurchasesReadModel(env);
  if (!access.ok) return readModelError(access.status, access.code, access.message);
  if (!env.DB) {
    return readModelError(503, "STORE_ACCOUNT_PURCHASES_DB_UNAVAILABLE", "DZN Store Account Purchases could not be read right now.");
  }

  try {
    const purchases = await readPurchaseRows(env.DB, user.id, access.ledgerScope);
    const orderIds = purchases.map((row) => row.order_id);
    const [paymentEvents, fulfilmentAttempts, refundDisputeAudits, orderStatusHistory, entitlementStatusHistory] = await Promise.all([
      readPaymentEvents(env.DB, orderIds),
      readFulfilmentAttempts(env.DB, orderIds),
      readRefundDisputeAudits(env.DB, orderIds),
      readOrderStatusHistory(env.DB, orderIds),
      readEntitlementStatusHistory(env.DB, orderIds),
    ]);

    const paymentEventsByOrder = groupByOrderId(paymentEvents, "related_order_id");
    const fulfilmentByOrder = groupByOrderId(fulfilmentAttempts, "order_id");
    const refundsByOrder = groupByOrderId(refundDisputeAudits, "order_id");
    const orderHistoryByOrder = groupByOrderId(orderStatusHistory, "order_id");
    const entitlementHistoryByOrder = groupByOrderId(entitlementStatusHistory, "order_id");

    const privateRevealAccess = canReadDznStorePrivateSupporterCardReveal(env);
    const privateRevealAvailable = privateRevealAccess.ok;
    const summaries = purchases.map((row) => purchaseSummary(row, {
      paymentEvents: paymentEventsByOrder.get(row.order_id) ?? [],
      fulfilmentAttempts: fulfilmentByOrder.get(row.order_id) ?? [],
      refundDisputeAudits: refundsByOrder.get(row.order_id) ?? [],
      orderStatusHistory: orderHistoryByOrder.get(row.order_id) ?? [],
      entitlementStatusHistory: entitlementHistoryByOrder.get(row.order_id) ?? [],
      privateRevealAvailable,
    }));

    const entitlements = summaries.flatMap((purchase) => purchase.entitlement ? [purchase.entitlement] : []);
    const supporterCards = summaries.flatMap((purchase) => purchase.supporter_card ? [purchase.supporter_card] : []);

    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        private: true,
        cache: "no-store",
        scope: "current_user",
        route: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE,
        schema_version: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
        generated_at: (options.now ?? new Date()).toISOString(),
        account: {
          display_name: displayNameForUser(user),
        },
        purchases_count: summaries.length,
        purchases: summaries,
        entitlements_count: entitlements.length,
        entitlements,
        supporter_cards_count: supporterCards.length,
        supporter_cards: supporterCards,
        safety: safetyBoundary({ privateRevealAvailable }),
        unavailable_actions: unavailableActions(privateRevealAvailable),
      },
    };
  } catch {
    return readModelError(503, "STORE_ACCOUNT_PURCHASES_READ_FAILED", "DZN Store Account Purchases could not be read right now.");
  }
}

function purchaseSummary(
  row: StorePurchaseRow,
  linkedRows: {
    paymentEvents: PaymentEventRow[];
    fulfilmentAttempts: FulfilmentAttemptRow[];
    refundDisputeAudits: RefundDisputeAuditRow[];
    orderStatusHistory: OrderStatusHistoryRow[];
    entitlementStatusHistory: EntitlementStatusHistoryRow[];
    privateRevealAvailable: boolean;
  },
): DznStorePurchaseSummary {
  const purchaseRef = row.order_number;
  const entitlement = entitlementSummary(row, purchaseRef);
  const supporterCard = supporterCardStatus(row, purchaseRef, linkedRows.privateRevealAvailable);

  return {
    purchase_ref: purchaseRef,
    status: normalizeDisplayText(row.order_status, "unknown"),
    ledger_scope: row.ledger_scope,
    livemode: false,
    product_count: safeInteger(row.product_count),
    currency: normalizeDisplayText(row.currency, "gbp"),
    subtotal_amount_minor: safeInteger(row.subtotal_amount_minor),
    tax_amount_minor: safeInteger(row.tax_amount_minor),
    total_amount_minor: safeInteger(row.total_amount_minor),
    selected_theme_key: nullableDisplayText(row.selected_theme_key),
    terms_version: normalizeDisplayText(row.terms_version, "unknown"),
    created_at: nullableDisplayText(row.created_at),
    updated_at: nullableDisplayText(row.updated_at),
    paid_at: nullableDisplayText(row.paid_at),
    refunded_at: nullableDisplayText(row.refunded_at),
    revoked_at: nullableDisplayText(row.revoked_at),
    product: {
      product_key: normalizeDisplayText(row.product_key, "unknown-product"),
      name: normalizeDisplayText(row.product_name_snapshot, "DZN Store Product"),
      product_type: normalizeDisplayText(row.product_type, "unknown"),
      fulfilment_kind: normalizeDisplayText(row.fulfilment_kind, "unknown"),
      quantity: safeInteger(row.quantity),
      unit_amount_minor: safeInteger(row.unit_amount_minor),
      tax_amount_minor: safeInteger(row.item_tax_amount_minor),
      total_amount_minor: safeInteger(row.item_total_amount_minor),
    },
    labels: {
      guaranteed_purchase: row.guaranteed_purchase === 1,
      account_bound: row.account_bound === 1,
      no_competitive_advantage: row.no_competitive_advantage === 1 && fairProgressionBoundaryFromRow(row),
    },
    entitlement,
    supporter_card: supporterCard,
    payment_receipt: paymentReceiptSummary(linkedRows.paymentEvents[0]),
    fulfilment: fulfilmentSummary(linkedRows.fulfilmentAttempts[0]),
    refund_or_dispute: refundDisputeSummary(linkedRows.refundDisputeAudits[0]),
    order_status_history: linkedRows.orderStatusHistory.slice(0, 8).map(statusHistoryEntry),
    entitlement_status_history: linkedRows.entitlementStatusHistory.slice(0, 8).map(statusHistoryEntry),
    fair_progression_boundary: fairProgressionBoundary(),
  };
}

function entitlementSummary(row: StorePurchaseRow, purchaseRef: string): DznStoreEntitlementSummary | null {
  if (!row.entitlement_key || !row.entitlement_status) return null;
  return {
    purchase_ref: purchaseRef,
    entitlement_key: normalizeDisplayText(row.entitlement_key, "unknown-entitlement"),
    product_key: normalizeDisplayText(row.product_key, "unknown-product"),
    product_type: normalizeDisplayText(row.product_type, "unknown"),
    fulfilment_kind: normalizeDisplayText(row.fulfilment_kind, "unknown"),
    status: normalizeDisplayText(row.entitlement_status, "unknown"),
    visibility_state: normalizeDisplayText(row.entitlement_visibility_state, "visible"),
    granted_at: nullableDisplayText(row.entitlement_granted_at),
    suspended_at: nullableDisplayText(row.entitlement_suspended_at),
    revoked_at: nullableDisplayText(row.entitlement_revoked_at),
    ledger_scope: row.ledger_scope,
    livemode: false,
    fair_progression_boundary: fairProgressionBoundary(),
  };
}

function supporterCardStatus(row: StorePurchaseRow, purchaseRef: string, privateRevealEnabled: boolean): DznStoreSupporterCardStatus | null {
  if (!row.supporter_card_status) return null;
  const canRevealPrivately = privateRevealEnabled && isPrivatelyRevealableSupporterCardRow(row);
  return {
    purchase_ref: purchaseRef,
    product_key: normalizeDisplayText(row.product_key, "unknown-product"),
    status: normalizeDisplayText(row.supporter_card_status, "unknown"),
    visibility_state: normalizeDisplayText(row.supporter_card_visibility_state, "visible"),
    supporter_since: nullableDisplayText(row.supporter_since),
    selected_theme_key: nullableDisplayText(row.supporter_card_theme_key) ?? nullableDisplayText(row.selected_theme_key),
    issued_at: nullableDisplayText(row.supporter_card_issued_at),
    suspended_at: nullableDisplayText(row.supporter_card_suspended_at),
    revoked_at: nullableDisplayText(row.supporter_card_revoked_at),
    private_reveal_available: canRevealPrivately,
    public_reveal_available: false,
    reveal_blocked_reason: canRevealPrivately
      ? null
      : privateRevealEnabled
        ? "supporter_card_not_privately_viewable"
        : "supporter_card_private_reveal_disabled",
  };
}

async function readPurchaseRows(db: D1Database, userId: string, ledgerScope: DznStoreSandboxLedgerScope) {
  const result = await db
    .prepare(
      `SELECT
         store_orders.id AS order_id,
         store_orders.order_number,
         store_orders.status AS order_status,
         store_orders.ledger_scope,
         store_orders.livemode AS order_livemode,
         store_orders.product_count,
         store_orders.currency,
         store_orders.subtotal_amount_minor,
         store_orders.tax_amount_minor,
         store_orders.total_amount_minor,
         store_orders.selected_theme_key,
         store_orders.terms_version,
         store_orders.created_at,
         store_orders.updated_at,
         store_orders.paid_at,
         store_orders.refunded_at,
         store_orders.revoked_at,
         store_order_items.id AS order_item_id,
         store_order_items.product_key,
         store_order_items.product_name_snapshot,
         store_order_items.product_type,
         store_order_items.fulfilment_kind,
         store_order_items.quantity,
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
         account_entitlements.entitlement_key,
         account_entitlements.status AS entitlement_status,
         account_entitlements.visibility_state AS entitlement_visibility_state,
         account_entitlements.granted_at AS entitlement_granted_at,
         account_entitlements.suspended_at AS entitlement_suspended_at,
         account_entitlements.revoked_at AS entitlement_revoked_at,
         supporter_cards.status AS supporter_card_status,
         supporter_cards.visibility_state AS supporter_card_visibility_state,
         supporter_cards.supporter_since,
         supporter_cards.selected_theme_key AS supporter_card_theme_key,
         supporter_cards.issued_at AS supporter_card_issued_at,
         supporter_cards.suspended_at AS supporter_card_suspended_at,
         supporter_cards.revoked_at AS supporter_card_revoked_at
       FROM store_orders
       INNER JOIN store_order_items ON store_order_items.order_id = store_orders.id
       LEFT JOIN account_entitlements
         ON account_entitlements.source_order_item_id = store_order_items.id
        AND account_entitlements.user_id = store_orders.purchasing_user_id
        AND account_entitlements.livemode = 0
       LEFT JOIN supporter_cards
         ON supporter_cards.source_order_item_id = store_order_items.id
        AND supporter_cards.user_id = store_orders.purchasing_user_id
        AND supporter_cards.livemode = 0
       WHERE store_orders.purchasing_user_id = ?
         AND store_orders.livemode = 0
         AND store_orders.ledger_scope = ?
       ORDER BY datetime(COALESCE(store_orders.updated_at, store_orders.created_at)) DESC
       LIMIT ?`,
    )
    .bind(userId, ledgerScope, MAX_PURCHASE_ROWS)
    .all<StorePurchaseRow>();

  return result.results ?? [];
}

async function readPaymentEvents(db: D1Database, orderIds: string[]) {
  if (!orderIds.length) return [];
  const result = await db
    .prepare(
      `SELECT
         related_order_id,
         event_type,
         event_class,
         processing_status,
         received_at,
         processed_at,
         failure_code
       FROM store_payment_events
       WHERE related_order_id IN (${placeholders(orderIds)})
         AND livemode = 0
       ORDER BY datetime(received_at) DESC
       LIMIT ?`,
    )
    .bind(...orderIds, MAX_AUDIT_ROWS)
    .all<PaymentEventRow>();
  return result.results ?? [];
}

async function readFulfilmentAttempts(db: D1Database, orderIds: string[]) {
  if (!orderIds.length) return [];
  const result = await db
    .prepare(
      `SELECT
         order_id,
         event_type,
         status,
         eligibility_failure_code,
         started_at,
         finished_at
       FROM store_fulfilment_attempts
       WHERE order_id IN (${placeholders(orderIds)})
         AND livemode = 0
       ORDER BY datetime(COALESCE(finished_at, started_at, created_at)) DESC
       LIMIT ?`,
    )
    .bind(...orderIds, MAX_AUDIT_ROWS)
    .all<FulfilmentAttemptRow>();
  return result.results ?? [];
}

async function readRefundDisputeAudits(db: D1Database, orderIds: string[]) {
  if (!orderIds.length) return [];
  const result = await db
    .prepare(
      `SELECT
         order_id,
         event_type,
         refund_kind,
         dispute_status,
         local_decision,
         decision_reason,
         created_at
       FROM store_refund_dispute_audit
       WHERE order_id IN (${placeholders(orderIds)})
         AND livemode = 0
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .bind(...orderIds, MAX_AUDIT_ROWS)
    .all<RefundDisputeAuditRow>();
  return result.results ?? [];
}

async function readOrderStatusHistory(db: D1Database, orderIds: string[]) {
  if (!orderIds.length) return [];
  const result = await db
    .prepare(
      `SELECT
         order_id,
         to_status,
         reason_code,
         actor_type,
         created_at
       FROM store_order_status_history
       WHERE order_id IN (${placeholders(orderIds)})
         AND livemode = 0
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .bind(...orderIds, MAX_AUDIT_ROWS)
    .all<OrderStatusHistoryRow>();
  return result.results ?? [];
}

async function readEntitlementStatusHistory(db: D1Database, orderIds: string[]) {
  if (!orderIds.length) return [];
  const result = await db
    .prepare(
      `SELECT
         order_id,
         to_status,
         reason_code,
         actor_type,
         created_at
       FROM store_entitlement_status_history
       WHERE order_id IN (${placeholders(orderIds)})
         AND livemode = 0
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .bind(...orderIds, MAX_AUDIT_ROWS)
    .all<EntitlementStatusHistoryRow>();
  return result.results ?? [];
}

function paymentReceiptSummary(row: PaymentEventRow | undefined): DznStorePaymentReceiptSummary {
  if (!row) return { recorded: false, status: "not_recorded" };
  return {
    recorded: true,
    event_type: normalizeDisplayText(row.event_type, "unknown"),
    event_class: normalizeDisplayText(row.event_class, "unknown"),
    processing_status: normalizeDisplayText(row.processing_status, "unknown"),
    received_at: nullableDisplayText(row.received_at),
    processed_at: nullableDisplayText(row.processed_at),
    failure_code: nullableDisplayText(row.failure_code),
    receipt_source: "sanitized_store_payment_events",
  };
}

function fulfilmentSummary(row: FulfilmentAttemptRow | undefined): DznStoreFulfilmentSummary | null {
  if (!row) return null;
  return {
    status: normalizeDisplayText(row.status, "unknown"),
    event_type: normalizeDisplayText(row.event_type, "unknown"),
    eligibility_failure_code: nullableDisplayText(row.eligibility_failure_code),
    started_at: nullableDisplayText(row.started_at),
    finished_at: nullableDisplayText(row.finished_at),
  };
}

function refundDisputeSummary(row: RefundDisputeAuditRow | undefined): DznStoreRefundDisputeSummary | null {
  if (!row) return null;
  return {
    event_type: normalizeDisplayText(row.event_type, "unknown"),
    refund_kind: nullableDisplayText(row.refund_kind),
    dispute_status: nullableDisplayText(row.dispute_status),
    local_decision: normalizeDisplayText(row.local_decision, "unknown"),
    decision_reason: normalizeDisplayText(row.decision_reason, "unknown"),
    created_at: nullableDisplayText(row.created_at),
  };
}

function statusHistoryEntry(row: OrderStatusHistoryRow | EntitlementStatusHistoryRow): DznStoreStatusHistoryEntry {
  return {
    status: normalizeDisplayText(row.to_status, "unknown"),
    reason_code: normalizeDisplayText(row.reason_code, "unknown"),
    actor_type: normalizeDisplayText(row.actor_type, "unknown"),
    created_at: nullableDisplayText(row.created_at),
  };
}

function groupByOrderId<Row extends Record<string, unknown>, Key extends keyof Row>(rows: Row[], key: Key) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const orderId = typeof row[key] === "string" ? row[key] : null;
    if (!orderId) continue;
    const group = groups.get(orderId) ?? [];
    group.push(row);
    groups.set(orderId, group);
  }
  return groups;
}

function fairProgressionBoundaryFromRow(row: StorePurchaseRow) {
  return row.grants_spins === 0
    && row.grants_xp === 0
    && row.grants_rank_advantage === 0
    && row.grants_discovery_advantage === 0
    && row.grants_review_advantage === 0
    && row.grants_event_advantage === 0
    && row.grants_server_wars_advantage === 0
    && row.grants_ctf_advantage === 0
    && row.grants_owner_subscription_access === 0
    && row.grants_competitive_eligibility === 0;
}

function fairProgressionBoundary(): DznStoreFairProgressionBoundary {
  return {
    grants_spins: false,
    grants_xp: false,
    grants_rank_advantage: false,
    grants_discovery_advantage: false,
    grants_review_advantage: false,
    grants_event_advantage: false,
    grants_server_wars_advantage: false,
    grants_ctf_advantage: false,
    grants_owner_subscription_access: false,
    grants_competitive_eligibility: false,
  };
}

export function safetyBoundary(options: { privateRevealAvailable?: boolean } = {}): DznStoreAccountPurchasesSafety {
  return {
    read_only: true,
    sanitized_ledgers_only: true,
    current_user_only: true,
    private_supporter_card_reveal: options.privateRevealAvailable === true,
    public_supporter_card_reveal: false,
    webhook_replay_route: false,
    manual_review_route: false,
    refund_dispute_operator_route: false,
    notifications: false,
    live_checkout_enabled: false,
    stripe_mutation: false,
    cloudflare_config_mutation: false,
    production_d1_write: false,
    earned_spin_write: false,
    reward_wheel_runtime: false,
    issue_49_changed: false,
    billing_effect: false,
    owner_entitlement_effect: false,
    server_ownership_effect: false,
    ranking_effect: false,
    discovery_effect: false,
    review_effect: false,
    badge_effect: false,
    season_effect: false,
    event_effect: false,
    server_wars_effect: false,
    ctf_effect: false,
    xp_award_effect: false,
    calling_card_award_effect: false,
    public_profile_visibility_effect: false,
    competitive_eligibility_effect: false,
  };
}

function unavailableActions(privateRevealAvailable = false) {
  const actions = [
    "public_supporter_card_reveal",
    "webhook_replay",
    "manual_review",
    "refund_dispute_operator_workflow",
    "notifications",
    "earned_spins",
    "reward_wheel",
    "live_checkout",
  ];
  if (!privateRevealAvailable) actions.unshift("private_supporter_card_reveal");
  return actions;
}

function isPrivatelyRevealableSupporterCardRow(row: StorePurchaseRow) {
  return row.product_key === DZN_FOUNDING_SUPPORTER_PRODUCT_KEY
    && row.product_type === "supporter_pack"
    && row.fulfilment_kind === "supporter_card"
    && ["active", "hidden"].includes(row.supporter_card_status ?? "")
    && ["active", "hidden"].includes(row.entitlement_status ?? "")
    && row.order_status === "paid"
    && row.refunded_at === null
    && row.revoked_at === null
    && row.account_bound === 1
    && row.guaranteed_purchase === 1
    && row.no_competitive_advantage === 1
    && fairProgressionBoundaryFromRow(row);
}

function readModelError(status: 403 | 404 | 503, error: string, message: string): DznStoreAccountPurchasesResult {
  return {
    ok: false,
    status,
    body: {
      ok: false,
      private: true,
      cache: "no-store",
      scope: "current_user",
      route: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_ROUTE,
      schema_version: DZN_STORE_ACCOUNT_PURCHASES_READ_MODEL_SCHEMA_VERSION,
      error,
      message,
      purchases_available: false,
      live_checkout_enabled: false,
      safety: safetyBoundary(),
    },
  };
}

function blockedAccess(
  code: string,
  message: string,
  runtime: DznStoreSandboxRuntime | null,
  status: 403 | 404,
): DznStoreAccountPurchasesReadModelAccess {
  return {
    ok: false,
    status,
    code,
    message,
    runtime,
  };
}

function displayNameForUser(user: SessionUser) {
  return normalizeDisplayText(user.username, "DZN Player");
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function safeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function normalizeDisplayText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 160);
}

function nullableDisplayText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 160);
}

function parseBooleanFlag(value: unknown) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readEnvValue(env: Env | EnvRecord, key: string) {
  return (env as EnvRecord)[key];
}
