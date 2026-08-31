import { DZN_FOUNDING_SUPPORTER_PRODUCT_KEY } from "./dzn-store-catalog";
import {
  canReadDznStorePrivateSupporterCardReveal,
  DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG,
} from "./dzn-store-account-purchases";
import type { Env, SessionUser } from "./types";

export const DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE = "/api/account/supporter-cards/[cardRef]/reveal";
export const DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION = "2026-08-31.store-supporter-card-private-reveal-v1";

const PURCHASE_REF_PATTERN = /^DZN-STORE-[0-9]{8}-[A-Z0-9]{6,32}$/;
const REVEALABLE_CARD_STATUSES = new Set(["active", "hidden"]);

type EnvRecord = Record<string, unknown>;

export type DznStoreSupporterCardPrivateRevealResult =
  | { ok: true; status: 200; body: DznStoreSupporterCardPrivateRevealPayload }
  | { ok: false; status: 401 | 403 | 404 | 409 | 503; body: DznStoreSupporterCardPrivateRevealErrorPayload };

export type DznStoreSupporterCardPrivateRevealPayload = {
  ok: true;
  private: true;
  cache: "no-store";
  scope: "current_user";
  route: typeof DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE;
  schema_version: typeof DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION;
  generated_at: string;
  card: {
    card_ref: string;
    purchase_ref: string;
    product_key: typeof DZN_FOUNDING_SUPPORTER_PRODUCT_KEY;
    product_name: string;
    card_type: "founding_supporter";
    card_type_label: "DZN Founding Supporter";
    status: "active" | "hidden";
    visibility_state: "visible" | "hidden";
    serial_number: string;
    display_name_snapshot: string;
    supporter_since: string;
    selected_theme_key: string;
    theme_label: string;
    issued_at: string;
    suspended_at: string | null;
    revoked_at: string | null;
    card_art: {
      available: false;
      reason: "card_art_generation_requires_future_approved_slice";
      alt_text: string;
    };
    public_reveal: {
      available: false;
      reason: "public_reveal_requires_future_opt_in_slice";
    };
  };
  safety: DznStoreSupporterCardPrivateRevealSafety;
};

export type DznStoreSupporterCardPrivateRevealErrorPayload = {
  ok: false;
  private: true;
  cache: "no-store";
  scope: "current_user";
  route: typeof DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE;
  schema_version: typeof DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION;
  error: string;
  message: string;
  card_reveal_available: false;
  live_checkout_enabled: false;
  safety: DznStoreSupporterCardPrivateRevealSafety;
};

export type DznStoreSupporterCardPrivateRevealSafety = {
  read_only: true;
  current_user_only: true;
  private_no_store: true;
  display_safe_ref_only: true;
  serial_listed_only_after_ownership_proof: true;
  raw_internal_ids_returned: false;
  raw_discord_ids_returned: false;
  stripe_ids_returned: false;
  private_payment_data_returned: false;
  provider_event_payload_returned: false;
  private_support_notes_returned: false;
  generated_card_art_returned: false;
  card_art_generation: false;
  public_reveal: false;
  sharing_controls: false;
  screenshot_export_controls: false;
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
  retained_export_effect: false;
  moderation_effect: false;
  competitive_eligibility_effect: false;
};

type StoreSupporterCardRevealRow = {
  purchase_ref: string;
  order_status: string;
  order_refunded_at: string | null;
  order_revoked_at: string | null;
  ledger_scope: "local" | "sandbox";
  product_key: string;
  product_name_snapshot: string;
  product_type: string;
  fulfilment_kind: string;
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
  entitlement_status: string;
  entitlement_visibility_state: string;
  entitlement_livemode: number;
  entitlement_suspended_at: string | null;
  entitlement_revoked_at: string | null;
  card_status: string;
  card_visibility_state: string;
  card_livemode: number;
  serial_number: string;
  card_type: string;
  display_name_snapshot: string;
  supporter_since: string;
  selected_theme_key: string;
  issued_at: string;
  suspended_at: string | null;
  revoked_at: string | null;
  payment_receipt_count: number;
  fulfilment_attempt_count: number;
};

type StoreSupporterCardRevealOptions = {
  now?: Date;
};

export function normalizeDznStoreSupporterCardRevealRef(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!PURCHASE_REF_PATTERN.test(normalized)) return null;
  return normalized;
}

export function canRevealDznStorePrivateSupporterCard(env: Env | EnvRecord = {}) {
  return canReadDznStorePrivateSupporterCardReveal(env);
}

export async function readDznStorePrivateSupporterCardReveal(
  env: Env,
  user: SessionUser,
  cardRef: string,
  options: StoreSupporterCardRevealOptions = {},
): Promise<DznStoreSupporterCardPrivateRevealResult> {
  const access = canRevealDznStorePrivateSupporterCard(env);
  if (!access.ok) return revealError(access.status, access.code, access.message);

  const normalizedRef = normalizeDznStoreSupporterCardRevealRef(cardRef);
  if (!normalizedRef) {
    return revealError(404, "STORE_SUPPORTER_CARD_UNAVAILABLE", "Supporter Card is not available for this account.");
  }
  if (!env.DB) {
    return revealError(503, "STORE_SUPPORTER_CARD_DB_UNAVAILABLE", "Private Supporter Card status could not be read right now.");
  }

  let row: StoreSupporterCardRevealRow | null = null;
  try {
    row = await env.DB
      .prepare(
        `SELECT
           store_orders.order_number AS purchase_ref,
           store_orders.status AS order_status,
           store_orders.refunded_at AS order_refunded_at,
           store_orders.revoked_at AS order_revoked_at,
           store_orders.ledger_scope,
           store_order_items.product_key,
           store_order_items.product_name_snapshot,
           store_order_items.product_type,
           store_order_items.fulfilment_kind,
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
           account_entitlements.status AS entitlement_status,
           account_entitlements.visibility_state AS entitlement_visibility_state,
           account_entitlements.livemode AS entitlement_livemode,
           account_entitlements.suspended_at AS entitlement_suspended_at,
           account_entitlements.revoked_at AS entitlement_revoked_at,
           supporter_cards.status AS card_status,
           supporter_cards.visibility_state AS card_visibility_state,
           supporter_cards.livemode AS card_livemode,
           supporter_cards.serial_number,
           supporter_cards.card_type,
           supporter_cards.display_name_snapshot,
           supporter_cards.supporter_since,
           supporter_cards.selected_theme_key,
           supporter_cards.issued_at,
           supporter_cards.suspended_at,
           supporter_cards.revoked_at,
           (
             SELECT COUNT(*)
             FROM store_payment_events
             WHERE store_payment_events.id = supporter_cards.issued_by_payment_event_id
               AND store_payment_events.related_order_id = store_orders.id
               AND store_payment_events.processing_status = 'processed'
               AND store_payment_events.livemode = 0
           ) AS payment_receipt_count,
           (
             SELECT COUNT(*)
             FROM store_fulfilment_attempts
             WHERE store_fulfilment_attempts.order_id = store_orders.id
               AND store_fulfilment_attempts.order_item_id = store_order_items.id
               AND store_fulfilment_attempts.supporter_card_id = supporter_cards.id
               AND store_fulfilment_attempts.status IN ('fulfilled', 'duplicate')
               AND store_fulfilment_attempts.livemode = 0
           ) AS fulfilment_attempt_count
         FROM supporter_cards
         INNER JOIN account_entitlements
           ON account_entitlements.id = supporter_cards.entitlement_id
          AND account_entitlements.user_id = supporter_cards.user_id
          AND account_entitlements.source_order_id = supporter_cards.source_order_id
          AND account_entitlements.source_order_item_id = supporter_cards.source_order_item_id
          AND account_entitlements.livemode = 0
         INNER JOIN store_orders
           ON store_orders.id = supporter_cards.source_order_id
          AND store_orders.purchasing_user_id = supporter_cards.user_id
          AND store_orders.livemode = 0
          AND store_orders.ledger_scope = ?
         INNER JOIN store_order_items
           ON store_order_items.id = supporter_cards.source_order_item_id
          AND store_order_items.order_id = store_orders.id
         WHERE supporter_cards.user_id = ?
           AND supporter_cards.livemode = 0
           AND supporter_cards.ledger_scope = ?
           AND store_orders.order_number = ?
           AND store_order_items.product_key = ?
           AND store_order_items.product_type = 'supporter_pack'
           AND store_order_items.fulfilment_kind = 'supporter_card'
         LIMIT 1`,
      )
      .bind(access.ledgerScope, user.id, access.ledgerScope, normalizedRef, DZN_FOUNDING_SUPPORTER_PRODUCT_KEY)
      .first<StoreSupporterCardRevealRow>();
  } catch {
    return revealError(503, "STORE_SUPPORTER_CARD_READ_FAILED", "Private Supporter Card status could not be read right now.");
  }

  if (!row) {
    return revealError(404, "STORE_SUPPORTER_CARD_UNAVAILABLE", "Supporter Card is not available for this account.");
  }

  const status = row.card_status;
  if (!isRevealableRow(row)) {
    return revealError(409, "STORE_SUPPORTER_CARD_NOT_PRIVATELY_VIEWABLE", "Supporter Card is not privately viewable right now.");
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      private: true,
      cache: "no-store",
      scope: "current_user",
      route: DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE,
      schema_version: DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION,
      generated_at: (options.now ?? new Date()).toISOString(),
      card: {
        card_ref: row.purchase_ref,
        purchase_ref: row.purchase_ref,
        product_key: DZN_FOUNDING_SUPPORTER_PRODUCT_KEY,
        product_name: boundedText(row.product_name_snapshot, "DZN FOUNDING SUPPORTER PACK"),
        card_type: "founding_supporter",
        card_type_label: "DZN Founding Supporter",
        status: status as "active" | "hidden",
        visibility_state: row.card_visibility_state === "hidden" ? "hidden" : "visible",
        serial_number: row.serial_number,
        display_name_snapshot: boundedText(row.display_name_snapshot, "DZN Player"),
        supporter_since: row.supporter_since,
        selected_theme_key: boundedSlug(row.selected_theme_key, "signal-crown"),
        theme_label: themeLabel(row.selected_theme_key),
        issued_at: row.issued_at,
        suspended_at: nullableText(row.suspended_at),
        revoked_at: nullableText(row.revoked_at),
        card_art: {
          available: false,
          reason: "card_art_generation_requires_future_approved_slice",
          alt_text: `Private DZN Founding Supporter Card for ${boundedText(row.display_name_snapshot, "DZN Player")}`,
        },
        public_reveal: {
          available: false,
          reason: "public_reveal_requires_future_opt_in_slice",
        },
      },
      safety: safetyBoundary(),
    },
  };
}

export function privateRevealErrorPayload(status: DznStoreSupporterCardPrivateRevealResult["status"], error: string, message: string) {
  return revealError(status === 200 ? 503 : status, error, message).body;
}

export function supporterCardRevealSafetyBoundary(): DznStoreSupporterCardPrivateRevealSafety {
  return safetyBoundary();
}

function revealError(
  status: Exclude<DznStoreSupporterCardPrivateRevealResult["status"], 200>,
  error: string,
  message: string,
): Extract<DznStoreSupporterCardPrivateRevealResult, { ok: false }> {
  return {
    ok: false,
    status,
    body: {
      ok: false,
      private: true,
      cache: "no-store",
      scope: "current_user",
      route: DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_ROUTE,
      schema_version: DZN_STORE_SUPPORTER_CARD_PRIVATE_REVEAL_SCHEMA_VERSION,
      error,
      message,
      card_reveal_available: false,
      live_checkout_enabled: false,
      safety: safetyBoundary(),
    },
  };
}

function isRevealableRow(row: StoreSupporterCardRevealRow) {
  return row.purchase_ref !== ""
    && row.order_status === "paid"
    && row.order_refunded_at === null
    && row.order_revoked_at === null
    && row.ledger_scope !== undefined
    && row.product_key === DZN_FOUNDING_SUPPORTER_PRODUCT_KEY
    && row.product_type === "supporter_pack"
    && row.fulfilment_kind === "supporter_card"
    && row.card_type === "founding_supporter"
    && row.account_bound === 1
    && row.guaranteed_purchase === 1
    && row.no_competitive_advantage === 1
    && row.grants_spins === 0
    && row.grants_xp === 0
    && row.grants_rank_advantage === 0
    && row.grants_discovery_advantage === 0
    && row.grants_review_advantage === 0
    && row.grants_event_advantage === 0
    && row.grants_server_wars_advantage === 0
    && row.grants_ctf_advantage === 0
    && row.grants_owner_subscription_access === 0
    && row.grants_competitive_eligibility === 0
    && row.entitlement_livemode === 0
    && row.card_livemode === 0
    && REVEALABLE_CARD_STATUSES.has(row.entitlement_status)
    && REVEALABLE_CARD_STATUSES.has(row.card_status)
    && row.entitlement_suspended_at === null
    && row.entitlement_revoked_at === null
    && row.suspended_at === null
    && row.revoked_at === null
    && /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/.test(row.selected_theme_key)
    && /^DZN-SUP-[0-9]{6}$/.test(row.serial_number)
    && row.payment_receipt_count > 0
    && row.fulfilment_attempt_count > 0
    && Boolean(row.display_name_snapshot)
    && Boolean(row.supporter_since)
    && Boolean(row.issued_at);
}

function safetyBoundary(): DznStoreSupporterCardPrivateRevealSafety {
  return {
    read_only: true,
    current_user_only: true,
    private_no_store: true,
    display_safe_ref_only: true,
    serial_listed_only_after_ownership_proof: true,
    raw_internal_ids_returned: false,
    raw_discord_ids_returned: false,
    stripe_ids_returned: false,
    private_payment_data_returned: false,
    provider_event_payload_returned: false,
    private_support_notes_returned: false,
    generated_card_art_returned: false,
    card_art_generation: false,
    public_reveal: false,
    sharing_controls: false,
    screenshot_export_controls: false,
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
    retained_export_effect: false,
    moderation_effect: false,
    competitive_eligibility_effect: false,
  };
}

function themeLabel(value: string) {
  return boundedSlug(value, "signal-crown")
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function boundedSlug(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const text = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(text)) return fallback;
  return text;
}

function boundedText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : fallback;
}

function nullableText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
}

export function dznStorePrivateSupporterCardRevealFlagName() {
  return DZN_SUPPORTER_CARD_PRIVATE_REVEAL_FLAG;
}
