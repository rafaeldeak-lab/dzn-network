import { requireDb } from "./db";
import { storeDraftAdminEnabled } from "./store-catalog-admin";
import type { Env, SessionUser } from "./types";

const ACTIONS = new Set(["note", "hold", "escalate"]);
const EVIDENCE_CATEGORIES = new Set([
  "none",
  "webhook_mode_mismatch",
  "payment_state_mismatch",
  "stock_conflict",
  "dispute_conflict",
  "duplicate_retry",
  "other",
]);
const IDENTIFIER = /^[A-Za-z0-9_-]{3,128}$/;
const REQUEST_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const CURSOR = /^([^~]{1,64})~([A-Za-z0-9_-]{3,128})$/;
const PROVIDER_IDENTIFIER = /\b(?:ch|cs|cus|evt|in|pi|pm|seti|src|sub|tok)_[A-Za-z0-9_]+\b/i;
const DISCORD_SNOWFLAKE = /(?:^|\D)\d{17,20}(?:\D|$)/;
const MAX_PAGE_SIZE = 100;

type ListOptions = {
  cursor?: string | null;
  limit?: number;
  mode?: string | null;
  query?: string | null;
};

type ReviewRow = {
  id: string;
  order_number: string;
  status: string;
  stripe_mode: string;
  livemode: number;
  currency: string;
  total_amount_minor: number;
  stock_reservation_state: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  product_key: string;
  product_name: string;
  fulfilment_kind: string;
  customer_username: string;
  customer_avatar: string | null;
  latest_event_type: string | null;
  latest_event_status: string | null;
  latest_event_at: string | null;
  latest_action: string | null;
  latest_action_reason: string | null;
  latest_action_evidence_category: string | null;
  latest_action_at: string | null;
  action_count: number;
};

export function storeManualReviewEnabled(env: Env) {
  return storeDraftAdminEnabled(env);
}

export async function listStoreManualReviewOrders(env: Env, options: ListOptions = {}) {
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return invalid("INVALID_PAGE_SIZE", `Use a page size between 1 and ${MAX_PAGE_SIZE}.`);
  }
  const mode = options.mode?.trim() || "all";
  if (!new Set(["all", "test", "live"]).has(mode)) return invalid("INVALID_MODE", "Use all, test, or live mode.");
  const query = options.query?.trim() ?? "";
  if (query.length > 80) return invalid("INVALID_QUERY", "Search text must be 80 characters or fewer.");
  const cursor = decodeCursor(options.cursor);
  if (!cursor.ok) return invalid("INVALID_CURSOR", "The Store review cursor is invalid.");

  const filters = ["o.status = 'manual_review'"];
  const binds: unknown[] = [];
  if (mode !== "all") {
    filters.push("o.stripe_mode = ?");
    binds.push(mode);
  }
  if (query) {
    const like = `%${escapeLike(query)}%`;
    filters.push("(o.order_number LIKE ? ESCAPE '\\' OR i.product_name LIKE ? ESCAPE '\\' OR i.product_key LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    binds.push(like, like, like, like);
  }
  if (cursor.value) {
    filters.push("(o.updated_at < ? OR (o.updated_at = ? AND o.id < ?))");
    binds.push(cursor.value.updatedAt, cursor.value.updatedAt, cursor.value.id);
  }

  try {
    const result = await requireDb(env).prepare(`SELECT
      o.id, o.order_number, o.status, o.stripe_mode, o.livemode, o.currency,
      o.total_amount_minor, o.stock_reservation_state, o.created_at, o.updated_at, o.paid_at,
      i.product_key, i.product_name, i.fulfilment_kind,
      u.username AS customer_username,
      CASE WHEN u.avatar IS NOT NULL AND u.avatar <> '' THEN
        '/api/owner/store/manual-review-avatar/' || o.id
        ELSE NULL END AS customer_avatar,
      (SELECT e.event_type FROM store_commerce_events e WHERE e.order_id = o.id ORDER BY e.received_at DESC, e.id DESC LIMIT 1) AS latest_event_type,
      (SELECT e.processing_status FROM store_commerce_events e WHERE e.order_id = o.id ORDER BY e.received_at DESC, e.id DESC LIMIT 1) AS latest_event_status,
      (SELECT e.received_at FROM store_commerce_events e WHERE e.order_id = o.id ORDER BY e.received_at DESC, e.id DESC LIMIT 1) AS latest_event_at,
      (SELECT a.action FROM store_commerce_manual_review_actions a WHERE a.order_id = o.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS latest_action,
      (SELECT a.reason FROM store_commerce_manual_review_actions a WHERE a.order_id = o.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS latest_action_reason,
      (SELECT a.evidence_category FROM store_commerce_manual_review_actions a WHERE a.order_id = o.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS latest_action_evidence_category,
      (SELECT a.created_at FROM store_commerce_manual_review_actions a WHERE a.order_id = o.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS latest_action_at,
      (SELECT COUNT(*) FROM store_commerce_manual_review_actions a WHERE a.order_id = o.id) AS action_count
      FROM store_commerce_orders o
      JOIN store_commerce_order_items i ON i.order_id = o.id
      JOIN users u ON u.id = o.purchasing_user_id
      WHERE ${filters.join(" AND ")}
      ORDER BY o.updated_at DESC, o.id DESC
      LIMIT ?`).bind(...binds, limit + 1).all<ReviewRow>();
    if (!result.success) return unavailable();
    const rows = result.results ?? [];
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      ok: true as const,
      status: 200 as const,
      items,
      page: {
        limit,
        hasMore: rows.length > limit,
        nextCursor: rows.length > limit && last ? `${last.updated_at}~${last.id}` : null,
      },
      safety: {
        platformOwnerOnly: true,
        paymentStateMutable: false,
        fulfilmentStateMutable: false,
        providerCalls: false,
        rawStripeReferencesExposed: false,
      },
    };
  } catch {
    return unavailable();
  }
}

export async function recordStoreManualReviewAction(env: Env, actor: SessionUser, input: unknown) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const orderId = String(value.orderId ?? "").trim();
  const requestKey = String(value.requestKey ?? "").trim();
  const action = String(value.action ?? "").trim();
  const reason = String(value.reason ?? "").trim();
  const evidenceCategory = String(value.evidenceCategory ?? "none").trim();
  if (!IDENTIFIER.test(orderId)) return invalid("INVALID_ORDER", "Select a valid manual-review order.");
  if (!REQUEST_KEY.test(requestKey)) return invalid("INVALID_REQUEST_KEY", "Use a valid idempotency key.");
  if (!ACTIONS.has(action)) return invalid("INVALID_ACTION", "Use note, hold, or escalate.");
  if (reason.length < 3 || reason.length > 500) return invalid("INVALID_REASON", "Reason must be between 3 and 500 characters.");
  if (PROVIDER_IDENTIFIER.test(reason) || DISCORD_SNOWFLAKE.test(reason)) {
    return invalid("SENSITIVE_IDENTIFIER", "Do not paste payment references or Discord account IDs into review notes.");
  }
  if (!EVIDENCE_CATEGORIES.has(evidenceCategory)) return invalid("INVALID_EVIDENCE_CATEGORY", "Select a valid evidence category.");

  const db = requireDb(env);
  try {
    const existing = await db.prepare(`SELECT id, order_id, actor_user_id, action, reason, evidence_category, created_at
      FROM store_commerce_manual_review_actions WHERE request_key = ?`).bind(requestKey).first<Record<string, unknown>>();
    if (existing) {
      const exact = existing.order_id === orderId && existing.actor_user_id === actor.id
        && existing.action === action && existing.reason === reason && existing.evidence_category === evidenceCategory;
      return exact
        ? { ok: true as const, status: 200 as const, duplicate: true, action: publicAction(existing) }
        : { ok: false as const, status: 409 as const, error: "REQUEST_KEY_CONFLICT", message: "That request key was already used for another review action." };
    }

    const id = `store_review_${crypto.randomUUID()}`;
    const result = await db.prepare(`INSERT INTO store_commerce_manual_review_actions (
      id, request_key, order_id, actor_user_id, action, reason, evidence_category, order_status_snapshot
    ) SELECT ?, ?, o.id, ?, ?, ?, ?, 'manual_review'
      FROM store_commerce_orders o WHERE o.id = ? AND o.status = 'manual_review'`)
      .bind(id, requestKey, actor.id, action, reason, evidenceCategory, orderId).run();
    if (!result.success || Number(result.meta.changes ?? 0) !== 1) {
      return { ok: false as const, status: 409 as const, error: "ORDER_NO_LONGER_REQUIRES_REVIEW", message: "Refresh the queue; this order no longer requires manual review." };
    }
    const stored = await db.prepare(`SELECT id, order_id, action, reason, evidence_category, created_at
      FROM store_commerce_manual_review_actions WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    return { ok: true as const, status: 201 as const, duplicate: false, action: stored ? publicAction(stored) : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint failed:.*request_key/i.test(message)) {
      const existing = await db.prepare(`SELECT id, order_id, actor_user_id, action, reason, evidence_category, created_at
        FROM store_commerce_manual_review_actions WHERE request_key = ?`).bind(requestKey).first<Record<string, unknown>>();
      const exact = existing?.order_id === orderId && existing.actor_user_id === actor.id
        && existing.action === action && existing.reason === reason && existing.evidence_category === evidenceCategory;
      return exact
        ? { ok: true as const, status: 200 as const, duplicate: true, action: publicAction(existing) }
        : { ok: false as const, status: 409 as const, error: "REQUEST_KEY_CONFLICT", message: "That request key was already used for another review action." };
    }
    if (/must still require manual review/i.test(message)) {
      return { ok: false as const, status: 409 as const, error: "ORDER_NO_LONGER_REQUIRES_REVIEW", message: "Refresh the queue; this order no longer requires manual review." };
    }
    return unavailable();
  }
}

function publicAction(row: Record<string, unknown>) {
  return {
    id: row.id,
    order_id: row.order_id,
    action: row.action,
    reason: row.reason,
    evidence_category: row.evidence_category,
    created_at: row.created_at,
  };
}

export async function readStoreManualReviewAvatarSource(env: Env, orderId: string) {
  if (!IDENTIFIER.test(orderId)) return null;
  const row = await requireDb(env).prepare(`SELECT u.discord_id, u.avatar
    FROM store_commerce_orders o JOIN users u ON u.id = o.purchasing_user_id
    WHERE o.id = ? AND o.status = 'manual_review' LIMIT 1`).bind(orderId).first<{ discord_id: string; avatar: string | null }>();
  if (!row?.avatar || !/^\d+$/.test(row.discord_id) || !/^[A-Za-z0-9_]+$/.test(row.avatar)) return null;
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(row.discord_id)}/${encodeURIComponent(row.avatar)}.webp?size=128`;
}

function decodeCursor(raw: string | null | undefined) {
  if (!raw) return { ok: true as const, value: null };
  const match = CURSOR.exec(raw);
  if (!match || !Number.isFinite(Date.parse(match[1]))) return { ok: false as const };
  return { ok: true as const, value: { updatedAt: match[1], id: match[2] } };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function invalid(error: string, message: string) {
  return { ok: false as const, status: 400 as const, error, message };
}

function unavailable() {
  return { ok: false as const, status: 503 as const, error: "STORE_REVIEW_UNAVAILABLE", message: "The Store review ledger is not available in this environment yet." };
}
