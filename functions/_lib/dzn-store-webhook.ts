import { requireDb } from "./db";
import { readDznStoreCatalogFlags, type DznStoreCatalogFlags } from "./dzn-store-catalog";
import {
  processDznStoreSandboxWebhookFulfilment,
  type DznStoreFulfilmentResult,
} from "./dzn-store-fulfilment";
import {
  DZN_STORE_SANDBOX_RUNTIME_FLAG,
  readDznStoreSandboxRuntime,
  sandboxLedgerScopeForRuntime,
  type DznStoreSandboxLedgerScope,
  type DznStoreSandboxRuntime,
} from "./dzn-store-orders";
import {
  stripeId,
  stripeTimestamp,
  verifyStripeWebhookWithRawBody,
  type StripeEvent,
  type StripeWebhookVerificationResult,
} from "./stripe";
import type { Env } from "./types";

export const DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION = "2026-08-28.sandbox-webhook-receipt-v1";
export const DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE = "/api/stripe/store-webhook";
export const DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG = "DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ENABLED";
export const DZN_STORE_WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;

const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9_]{8,}$/;
const STRIPE_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]{3,128}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const STRIPE_ID_PATTERN = /^[A-Za-z0-9_]{3,128}$/;

export type DznStorePaymentEventClass = "checkout" | "payment_intent" | "refund" | "dispute" | "ignored";
export type DznStorePaymentEventProcessingStatus = "received" | "ignored";

export type DznStoreSandboxWebhookReceiptResult =
  | { ok: true; status: 200; body: DznStoreSandboxWebhookReceiptSuccessPayload }
  | { ok: false; status: 400 | 403 | 422 | 503; body: DznStoreSandboxWebhookReceiptErrorPayload };

export type DznStoreSandboxWebhookReceiptSuccessPayload = {
  ok: true;
  received: true;
  receipt: {
    recorded: boolean;
    duplicate: boolean;
    route: typeof DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE;
    schema_version: typeof DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION;
    ledger_scope: DznStoreSandboxLedgerScope;
    event_type: string;
    event_class: DznStorePaymentEventClass;
    processing_status: DznStorePaymentEventProcessingStatus | "duplicate";
    livemode: false;
    related_order_linked: boolean;
    raw_event_sha256_recorded: true;
    sanitized_summary_recorded: true;
  };
  fulfilment: DznStoreFulfilmentResult | null;
  safety: StoreWebhookSafetyPayload;
};

export type DznStoreSandboxWebhookReceiptErrorPayload = {
  ok: false;
  error: string;
  message: string;
  received: false;
  receipt_recorded: boolean;
  live_checkout_enabled: false;
  safety: StoreWebhookSafetyPayload;
};

type StoreWebhookSafetyPayload = {
  webhook_fulfilment_attempted: boolean;
  entitlement_write_attempted: boolean;
  supporter_card_write_attempted: boolean;
  earned_spin_write_attempted: false;
  wheel_runtime_attempted: false;
  stripe_product_price_mutation_attempted: false;
  cloudflare_config_mutation_attempted: false;
  production_d1_write_attempted: false;
  issue_49_changed: false;
};

type StoreWebhookEnvRecord = Record<string, unknown>;

type StoreWebhookOptions = {
  now?: Date;
  createId?: () => string;
  hashValue?: (value: string) => Promise<string>;
  verifyWebhook?: (
    request: Request,
    webhookSecret: string,
    options: { maxBytes: number },
  ) => Promise<StripeWebhookVerificationResult>;
};

type StorePaymentEventRefs = {
  eventClass: DznStorePaymentEventClass;
  processingStatus: DznStorePaymentEventProcessingStatus;
  relatedOrderCandidate: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeRefundId: string | null;
  stripeDisputeId: string | null;
};

export function canReceiveDznStoreSandboxWebhookReceipt(env: Env | StoreWebhookEnvRecord = {}) {
  const flags = readDznStoreCatalogFlags(env as StoreWebhookEnvRecord);
  const runtime = readDznStoreSandboxRuntime(env);
  const ownerLiveCheckoutEnabled = parseBooleanFlag(readEnvValue(env, "DZN_LIVE_CHECKOUT_ENABLED"));

  if (!runtime) {
    return blockedReceiptAccess("STORE_SANDBOX_RUNTIME_REQUIRED", `${DZN_STORE_SANDBOX_RUNTIME_FLAG}=local or test is required before sandbox Store webhook receipt.`, flags, runtime);
  }
  if (!flags.storeEnabled) {
    return blockedReceiptAccess("STORE_DISABLED", "DZN Store is disabled.", flags, runtime);
  }
  if (!flags.checkoutEnabled) {
    return blockedReceiptAccess("STORE_CHECKOUT_DISABLED", "DZN Store checkout/order flow is disabled.", flags, runtime);
  }
  if (!flags.sandboxCheckoutEnabled) {
    return blockedReceiptAccess("STORE_SANDBOX_CHECKOUT_DISABLED", "DZN Store sandbox checkout/order flow is disabled.", flags, runtime);
  }
  if (flags.liveCheckoutEnabled || ownerLiveCheckoutEnabled) {
    return blockedReceiptAccess("STORE_LIVE_CHECKOUT_BLOCKED", "Live checkout remains blocked for Store webhook receipt.", flags, runtime);
  }
  if (flags.earnedSpinsEnabled) {
    return blockedReceiptAccess("STORE_EARNED_SPINS_RUNTIME_MUST_STAY_DISABLED", "Store webhook receipt cannot run while earned-spin runtime is enabled.", flags, runtime);
  }
  if (flags.rewardWheelEnabled) {
    return blockedReceiptAccess("STORE_REWARD_WHEEL_RUNTIME_MUST_STAY_DISABLED", "Store webhook receipt cannot run while reward wheel runtime is enabled.", flags, runtime);
  }

  if (!parseBooleanFlag(readEnvValue(env, DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG))) {
    return {
      ok: false as const,
      status: 403 as const,
      code: "STORE_SANDBOX_WEBHOOK_RECEIPT_DISABLED",
      message: "DZN Store sandbox webhook receipt is disabled.",
    };
  }

  const webhookSecret = normalizeString(readEnvValue(env, "STRIPE_WEBHOOK_SECRET"));
  if (!webhookSecret || !STRIPE_WEBHOOK_SECRET_PATTERN.test(webhookSecret)) {
    return {
      ok: false as const,
      status: 403 as const,
      code: "STORE_STRIPE_WEBHOOK_SECRET_REQUIRED",
      message: "DZN Store sandbox webhook receipt requires a bounded Stripe webhook signing secret.",
    };
  }

  return {
    ok: true as const,
    runtime,
    ledgerScope: sandboxLedgerScopeForRuntime(runtime),
    flags,
    webhookSecret,
  };
}

export async function receiveDznStoreSandboxWebhookReceipt(
  env: Env,
  request: Request,
  options: StoreWebhookOptions = {},
): Promise<DznStoreSandboxWebhookReceiptResult> {
  const access = canReceiveDznStoreSandboxWebhookReceipt(env);
  if (!access.ok) return storeWebhookError(access.status, access.code, access.message);

  const verifyWebhook = options.verifyWebhook ?? verifyStripeWebhookWithRawBody;
  let verified: StripeWebhookVerificationResult;
  try {
    verified = await verifyWebhook(request, access.webhookSecret, { maxBytes: DZN_STORE_WEBHOOK_BODY_LIMIT_BYTES });
  } catch (error) {
    return storeWebhookError(400, "STORE_WEBHOOK_SIGNATURE_INVALID", error instanceof Error ? error.message : "Invalid DZN Store webhook signature.");
  }

  const { event, rawBody } = verified;
  const envelope = validateStripeEventEnvelope(event);
  if (!envelope.ok) return storeWebhookError(400, envelope.error, envelope.message);

  if (event.livemode !== false) {
    return storeWebhookError(422, "STORE_WEBHOOK_LIVE_EVENT_BLOCKED", "DZN Store sandbox webhook receipt accepts Stripe test-mode events only.");
  }

  let db: D1Database;
  try {
    db = requireDb(env);
  } catch {
    return storeWebhookError(503, "STORE_WEBHOOK_DB_UNAVAILABLE", "DZN Store payment-event ledger is not configured.");
  }

  const refs = extractPaymentEventRefs(event);
  const relatedOrderId = refs.relatedOrderCandidate
    ? await resolveRelatedOrderId(db, refs.relatedOrderCandidate).catch(() => null)
    : null;
  const nowIso = (options.now ?? new Date()).toISOString();
  const rawEventSha256 = await (options.hashValue ?? sha256Hex)(rawBody);
  const sanitizedSummary = JSON.stringify(createSanitizedWebhookSummary(event, refs, {
    ledgerScope: access.ledgerScope,
    relatedOrderLinked: Boolean(relatedOrderId),
  }));

  try {
    const result = await db
      .prepare(
        `INSERT INTO store_payment_events (
           id,
           stripe_event_id,
           event_type,
           event_class,
           api_version,
           ledger_scope,
           livemode,
           received_at,
           processed_at,
           processing_status,
           related_order_id,
           stripe_checkout_session_id,
           stripe_payment_intent_id,
           stripe_charge_id,
           stripe_refund_id,
           stripe_dispute_id,
           raw_event_sha256,
           sanitized_summary_json,
           failure_code,
           failure_message,
           fulfilment_attempted,
           entitlement_write_attempted,
           supporter_card_write_attempted
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0)
         ON CONFLICT(stripe_event_id) DO NOTHING`,
      )
      .bind(
        createIdentifier(options.createId),
        event.id,
        event.type,
        refs.eventClass,
        safeEnumString(event.api_version),
        access.ledgerScope,
        nowIso,
        refs.processingStatus,
        relatedOrderId,
        refs.stripeCheckoutSessionId,
        refs.stripePaymentIntentId,
        refs.stripeChargeId,
        refs.stripeRefundId,
        refs.stripeDisputeId,
        rawEventSha256,
        sanitizedSummary,
      )
      .run();

    const recorded = resultChanges(result) === 1;
    let fulfilment: DznStoreFulfilmentResult | null = null;
    if (access.flags.webhookFulfilmentEnabled) {
      try {
        fulfilment = await processDznStoreSandboxWebhookFulfilment(env, {
          db,
          event,
          refs,
          ledgerScope: access.ledgerScope,
        }, options);
      } catch {
        return storeWebhookError(503, "STORE_FULFILMENT_RUNTIME_FAILED", "DZN Store webhook fulfilment failed after recording the receipt. Retry is safe because receipt and fulfilment ledgers are idempotent.", storeWebhookSafety({
          attempted: true,
          status: "failed",
          reason_code: "STORE_FULFILMENT_RUNTIME_FAILED",
          duplicate: false,
          event_type: event.type,
          event_class: refs.eventClass,
          order_linked: Boolean(relatedOrderId),
          order_status: null,
          entitlement_write_attempted: false,
          entitlement_written: false,
          supporter_card_write_attempted: false,
          supporter_card_written: false,
          refund_dispute_audit_written: false,
          live_checkout_enabled: false,
        }), recorded);
      }
    }
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        received: true,
        receipt: {
          recorded,
          duplicate: !recorded,
          route: DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE,
          schema_version: DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
          ledger_scope: access.ledgerScope,
          event_type: event.type,
          event_class: refs.eventClass,
          processing_status: recorded ? refs.processingStatus : "duplicate",
          livemode: false,
          related_order_linked: Boolean(relatedOrderId),
          raw_event_sha256_recorded: true,
          sanitized_summary_recorded: true,
        },
        fulfilment,
        safety: storeWebhookSafety(fulfilment),
      },
    };
  } catch {
    return storeWebhookError(503, "STORE_WEBHOOK_LEDGER_WRITE_FAILED", "DZN Store webhook receipt could not be recorded.");
  }
}

function validateStripeEventEnvelope(event: StripeEvent) {
  if (!event || typeof event !== "object") {
    return webhookValidationError("STORE_WEBHOOK_EVENT_INVALID", "DZN Store webhook body must be a Stripe event object.");
  }
  if (!STRIPE_EVENT_ID_PATTERN.test(String(event.id ?? ""))) {
    return webhookValidationError("STORE_WEBHOOK_EVENT_ID_INVALID", "DZN Store webhook body must include a bounded Stripe event id.");
  }
  if (!safeEnumString(event.type)) {
    return webhookValidationError("STORE_WEBHOOK_EVENT_TYPE_INVALID", "DZN Store webhook body must include a bounded Stripe event type.");
  }
  if (!asRecord(event.data?.object)) {
    return webhookValidationError("STORE_WEBHOOK_EVENT_OBJECT_INVALID", "DZN Store webhook body must include a Stripe event data object.");
  }
  return { ok: true as const };
}

function extractPaymentEventRefs(event: StripeEvent): StorePaymentEventRefs {
  const object = asRecord(event.data?.object) ?? {};
  const metadata = metadataRecord(object.metadata);
  const eventClass = classifyEvent(event.type);
  const checkoutSessionId = eventClass === "checkout" ? stripeProviderId(object.id, ["cs_"]) : null;
  const paymentIntentId = eventClass === "payment_intent"
    ? stripeProviderId(object.id, ["pi_"])
    : stripeProviderId(object.payment_intent, ["pi_"]);
  const refundId = eventClass === "refund" && event.type.startsWith("refund.") ? stripeProviderId(object.id, ["re_"]) : null;
  const chargeId = event.type === "charge.refunded"
    ? stripeProviderId(object.id, ["ch_"])
    : stripeProviderId(object.charge, ["ch_"]);
  const disputeId = eventClass === "dispute" ? stripeProviderId(object.id, ["du_", "dp_"]) : null;
  const relatedOrderCandidate = normalizeRecordId(metadata.dzn_order_id)
    ?? normalizeRecordId(object.client_reference_id)
    ?? null;

  return {
    eventClass,
    processingStatus: eventClass === "ignored" ? "ignored" : "received",
    relatedOrderCandidate,
    stripeCheckoutSessionId: checkoutSessionId,
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: chargeId,
    stripeRefundId: refundId,
    stripeDisputeId: disputeId,
  };
}

function classifyEvent(eventType: string): DznStorePaymentEventClass {
  if (eventType.startsWith("checkout.session.")) return "checkout";
  if (eventType.startsWith("payment_intent.")) return "payment_intent";
  if (eventType.startsWith("refund.") || eventType === "charge.refunded") return "refund";
  if (eventType.startsWith("charge.dispute.")) return "dispute";
  return "ignored";
}

async function resolveRelatedOrderId(db: D1Database, candidate: string) {
  const row = await db
    .prepare("SELECT id FROM store_orders WHERE id = ? AND livemode = 0 LIMIT 1")
    .bind(candidate)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function createSanitizedWebhookSummary(
  event: StripeEvent,
  refs: StorePaymentEventRefs,
  context: { ledgerScope: DznStoreSandboxLedgerScope; relatedOrderLinked: boolean },
) {
  const object = asRecord(event.data?.object) ?? {};
  const metadata = metadataRecord(object.metadata);

  return {
    schema_version: DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_SCHEMA_VERSION,
    route: DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_ROUTE,
    event_type: event.type,
    event_class: refs.eventClass,
    processing_status: refs.processingStatus,
    api_version: safeEnumString(event.api_version),
    stripe_created_at: stripeTimestamp(event.created),
    ledger_scope: context.ledgerScope,
    livemode: false,
    object_type: safeEnumString(object.object),
    mode: safeEnumString(object.mode),
    status: safeEnumString(object.status),
    payment_status: safeEnumString(object.payment_status),
    related_order_linked: context.relatedOrderLinked,
    provider_references_present: {
      checkout_session: Boolean(refs.stripeCheckoutSessionId),
      payment_intent: Boolean(refs.stripePaymentIntentId),
      charge: Boolean(refs.stripeChargeId),
      refund: Boolean(refs.stripeRefundId),
      dispute: Boolean(refs.stripeDisputeId),
    },
    dzn_metadata_keys: Object.keys(metadata).filter(safeMetadataKey).sort().slice(0, 20),
    sandbox_guards: {
      store_runtime_flag: DZN_STORE_SANDBOX_RUNTIME_FLAG,
      webhook_receipt_flag: DZN_STORE_SANDBOX_WEBHOOK_RECEIPT_FLAG,
      webhook_fulfilment_attempted: false,
      entitlement_write_attempted: false,
      supporter_card_write_attempted: false,
      earned_spin_write_attempted: false,
      wheel_runtime_attempted: false,
      raw_event_body_stored: false,
      customer_details_stored: false,
      payment_method_details_stored: false,
      live_checkout_enabled: false,
    },
  };
}

function storeWebhookError(
  status: DznStoreSandboxWebhookReceiptResult["status"],
  error: string,
  message: string,
  safety: StoreWebhookSafetyPayload = storeWebhookSafety(),
  receiptRecorded = false,
): DznStoreSandboxWebhookReceiptResult {
  return {
    ok: false,
    status: status === 200 ? 503 : status,
    body: {
      ok: false,
      error,
      message,
      received: false,
      receipt_recorded: receiptRecorded,
      live_checkout_enabled: false,
      safety,
    },
  };
}

function blockedReceiptAccess(
  code: string,
  message: string,
  flags: DznStoreCatalogFlags,
  runtime: DznStoreSandboxRuntime | null,
) {
  void flags;
  void runtime;
  return {
    ok: false as const,
    status: 403 as const,
    code,
    message,
  };
}

function webhookValidationError(error: string, message: string) {
  return { ok: false as const, error, message };
}

function storeWebhookSafety(fulfilment: DznStoreFulfilmentResult | null = null): StoreWebhookSafetyPayload {
  return {
    webhook_fulfilment_attempted: Boolean(fulfilment?.attempted),
    entitlement_write_attempted: Boolean(fulfilment?.entitlement_write_attempted),
    supporter_card_write_attempted: Boolean(fulfilment?.supporter_card_write_attempted),
    earned_spin_write_attempted: false,
    wheel_runtime_attempted: false,
    stripe_product_price_mutation_attempted: false,
    cloudflare_config_mutation_attempted: false,
    production_d1_write_attempted: false,
    issue_49_changed: false,
  };
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

function normalizeRecordId(value: unknown) {
  const text = normalizeString(value);
  if (!text || !RECORD_ID_PATTERN.test(text)) return null;
  return text;
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

function safeEnumString(value: unknown) {
  const text = normalizeString(value);
  if (!text || text.length > 64 || !/^[a-z0-9_.-]+$/i.test(text)) return null;
  return text;
}

function safeMetadataKey(key: string) {
  return key.length <= 64 && /^dzn_[a-z0-9_.-]+$/i.test(key);
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

function readEnvValue(env: Env | StoreWebhookEnvRecord, key: string) {
  return (env as unknown as StoreWebhookEnvRecord)[key];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
