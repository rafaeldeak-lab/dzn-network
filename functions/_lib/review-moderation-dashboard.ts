import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { createNotification } from "./dzn-pulse";
import { json } from "./http";
import {
  getRequestSessionUser,
  ownerAccessErrorResponse,
  requireActiveOwnerEntitlement,
  returnToFromRequest,
} from "./owner-access";
import { validateOwnerReplyInput, validateReportReason } from "./review-moderation";
import { ensureServerReviewsSchema, recordReviewModerationAction, type ReviewModerationAction } from "./server-reviews";
import type { Env, SessionUser } from "./types";

export type ReviewModerationRole = "owner" | "admin";
export type ReviewModerationQueueFilter = "needs_review" | "pending" | "reported" | "approved" | "replied" | "all";
export type ReviewModerationDashboardAction = "approve" | "hold" | "remove" | "dismiss_reports" | "reply" | "remove_reply";

export type ReviewModerationActor = {
  user: SessionUser;
  role: ReviewModerationRole;
};

export type ReviewModerationItem = {
  id: string;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  moderation_reason: string | null;
  report_count: number;
  latest_report_reason: string | null;
  latest_report_at: string | null;
  owner_reply_body: string | null;
  owner_reply_author_name: string | null;
  owner_reply_created_at: string | null;
  owner_reply_updated_at: string | null;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
};

type ReviewModerationRow = ReviewModerationItem & {
  owner_user_id: string | null;
  owner_reply_author_user_id: string | null;
  reviewer_discord_id: string | null;
};

type DashboardActionInput = {
  action?: unknown;
  reason?: unknown;
  body?: unknown;
};

type ReviewModerationError = {
  ok: false;
  status: 400 | 401 | 402 | 403 | 404 | 503;
  error: string;
  message: string;
};

const QUEUE_FILTERS = new Set<ReviewModerationQueueFilter>(["needs_review", "pending", "reported", "approved", "replied", "all"]);
const DASHBOARD_ACTIONS = new Set<ReviewModerationDashboardAction>(["approve", "hold", "remove", "dismiss_reports", "reply", "remove_reply"]);

export async function authorizeReviewModerationRequest(env: Env, request: Request): Promise<
  | { ok: true; actor: ReviewModerationActor }
  | { ok: false; response: Response }
> {
  let user: SessionUser | null = null;
  try {
    user = await getRequestSessionUser(env, request);
  } catch {
    user = null;
  }

  if (!user) {
    return {
      ok: false,
      response: json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in with Discord to moderate reviews." }, { status: 401 }),
    };
  }

  if (isDznAdminDiscordId(env, user.discord_id)) {
    return { ok: true, actor: { user, role: "admin" } };
  }

  const ownerAccess = await requireActiveOwnerEntitlement(env, user, returnToFromRequest(request));
  if (!ownerAccess.allowed) {
    return { ok: false, response: ownerAccessErrorResponse(ownerAccess) };
  }

  return { ok: true, actor: { user, role: "owner" } };
}

export async function listReviewModerationQueue(
  env: Env,
  actor: ReviewModerationActor,
  options: { status?: string | null; limit?: number | null } = {},
) {
  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const filter = normalizeQueueFilter(options.status);
  const limit = clampLimit(options.limit);
  const bindings: unknown[] = [];
  const conditions = ["server_reviews.status != 'deleted'"];

  if (actor.role === "owner") {
    conditions.push("linked_servers.user_id = ?");
    bindings.push(actor.user.id);
  }

  if (filter === "needs_review") {
    conditions.push("(server_reviews.status = 'pending' OR COALESCE(server_reviews.report_count, 0) > 0)");
  } else if (filter === "pending") {
    conditions.push("server_reviews.status = 'pending'");
  } else if (filter === "reported") {
    conditions.push("COALESCE(server_reviews.report_count, 0) > 0");
  } else if (filter === "approved") {
    conditions.push("server_reviews.status = 'approved'");
  } else if (filter === "replied") {
    conditions.push("server_reviews.owner_reply_body IS NOT NULL");
  }

  bindings.push(limit);
  const rows = await db
    .prepare(
      `SELECT
         server_reviews.id,
         server_reviews.linked_server_id,
         server_reviews.reviewer_discord_id,
         server_reviews.reviewer_name,
         server_reviews.reviewer_avatar_url,
         server_reviews.rating,
         server_reviews.title,
         server_reviews.body,
         server_reviews.status,
         server_reviews.moderation_reason,
         server_reviews.report_count,
         server_reviews.owner_reply_body,
         server_reviews.owner_reply_author_user_id,
         server_reviews.owner_reply_author_name,
         server_reviews.owner_reply_created_at,
         server_reviews.owner_reply_updated_at,
         server_reviews.created_at,
         server_reviews.updated_at,
         server_reviews.last_edited_at,
         linked_servers.user_id AS owner_user_id,
         linked_servers.public_slug,
         COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
         (
           SELECT server_review_reports.reason
           FROM server_review_reports
           WHERE server_review_reports.review_id = server_reviews.id
           ORDER BY datetime(server_review_reports.created_at) DESC
           LIMIT 1
         ) AS latest_report_reason,
         (
           SELECT server_review_reports.created_at
           FROM server_review_reports
           WHERE server_review_reports.review_id = server_reviews.id
           ORDER BY datetime(server_review_reports.created_at) DESC
           LIMIT 1
         ) AS latest_report_at
       FROM server_reviews
       INNER JOIN linked_servers ON linked_servers.id = server_reviews.linked_server_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE WHEN server_reviews.status = 'pending' OR COALESCE(server_reviews.report_count, 0) > 0 THEN 0 ELSE 1 END ASC,
         COALESCE(server_reviews.report_count, 0) DESC,
         datetime(COALESCE(server_reviews.updated_at, server_reviews.created_at)) DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<ReviewModerationRow>();

  const items = (rows.results ?? []).map(toReviewModerationItem);
  return {
    ok: true as const,
    role: actor.role,
    status: filter,
    counts: queueCounts(items),
    items,
    generated_at: new Date().toISOString(),
  };
}

export async function moderateReviewFromDashboard(
  env: Env,
  actor: ReviewModerationActor,
  reviewIdInput: string,
  input: DashboardActionInput,
): Promise<
  | { ok: true; review_id: string; action: ReviewModerationDashboardAction; updated_at: string }
  | ReviewModerationError
> {
  const reviewId = sanitizeReviewId(reviewIdInput);
  if (!reviewId) return moderationError(400, "INVALID_REVIEW_ID", "Invalid review id.");

  const action = normalizeDashboardAction(input.action);
  if (!action) return moderationError(400, "INVALID_ACTION", "Choose a valid review moderation action.");

  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const review = await readReviewForModeration(env, reviewId);
  if (!review) return moderationError(404, "REVIEW_NOT_FOUND", "Review not found.");
  if (actor.role !== "admin" && review.owner_user_id !== actor.user.id) {
    return moderationError(403, "NOT_SERVER_OWNER", "This review belongs to another server owner.");
  }

  const reason = cleanModerationReason(input.reason);
  const now = new Date().toISOString();
  let auditAction: ReviewModerationAction;
  let auditReason = reason;

  if (action === "approve") {
    auditAction = "review_moderation_approved";
    await db
      .prepare("UPDATE server_reviews SET status = 'approved', report_count = 0, moderation_reason = ?, updated_at = ? WHERE id = ?")
      .bind(reason, now, reviewId)
      .run();
  } else if (action === "hold") {
    auditAction = "review_moderation_pending";
    auditReason = reason ?? "Held for moderation.";
    await db
      .prepare("UPDATE server_reviews SET status = 'pending', moderation_reason = ?, updated_at = ? WHERE id = ?")
      .bind(auditReason, now, reviewId)
      .run();
  } else if (action === "remove") {
    auditAction = "review_moderation_removed";
    auditReason = reason ?? "Removed by moderation.";
    await db
      .prepare("UPDATE server_reviews SET status = 'deleted', moderation_reason = ?, updated_at = ? WHERE id = ?")
      .bind(auditReason, now, reviewId)
      .run();
  } else if (action === "dismiss_reports") {
    auditAction = "review_reports_dismissed";
    await db
      .prepare("UPDATE server_reviews SET status = 'approved', report_count = 0, moderation_reason = ?, updated_at = ? WHERE id = ?")
      .bind(reason, now, reviewId)
      .run();
  } else if (action === "reply") {
    const reply = validateOwnerReplyInput({ body: input.body });
    if (!reply.ok) return moderationError(400, "INVALID_OWNER_REPLY", reply.error);
    auditAction = "owner_reply_upserted";
    auditReason = reason;
    await db
      .prepare(
        `UPDATE server_reviews SET
          owner_reply_body = ?,
          owner_reply_author_user_id = ?,
          owner_reply_author_name = ?,
          owner_reply_created_at = COALESCE(owner_reply_created_at, ?),
          owner_reply_updated_at = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .bind(reply.value.body, actor.user.id, actor.user.username || "DZN Owner", now, now, now, reviewId)
      .run();
  } else {
    auditAction = "owner_reply_removed";
    await db
      .prepare(
        `UPDATE server_reviews SET
          owner_reply_body = NULL,
          owner_reply_author_user_id = NULL,
          owner_reply_author_name = NULL,
          owner_reply_created_at = NULL,
          owner_reply_updated_at = NULL,
          updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, reviewId)
      .run();
  }

  await recordReviewModerationAction(env, {
    reviewId,
    linkedServerId: review.linked_server_id,
    actor: actor.user,
    actorRole: actor.role,
    action: auditAction,
    reason: auditReason,
    createdAt: now,
  });

  if (actor.role === "admin" && review.owner_user_id && review.owner_user_id !== actor.user.id) {
    await notifyReviewModerationOwner(env, {
      ownerUserId: review.owner_user_id,
      linkedServerId: review.linked_server_id,
      reviewId,
      serverName: review.server_name,
      kind: action,
      title: "Review moderation updated",
      body: `${review.server_name} review queue was updated by DZN moderation.`,
      createdAt: now,
    });
  }

  return { ok: true, review_id: reviewId, action, updated_at: now };
}

export async function notifyReviewModerationOwner(env: Env, input: {
  ownerUserId: string | null | undefined;
  linkedServerId: string;
  reviewId: string;
  serverName?: string | null;
  kind: string;
  title: string;
  body: string;
  createdAt?: string;
}) {
  if (!input.ownerUserId) return null;
  try {
    return await createNotification(env, {
      userId: input.ownerUserId,
      serverId: input.linkedServerId,
      type: "dzn_announcement",
      title: input.title,
      body: input.body,
      actionUrl: `/dashboard/reviews?review=${encodeURIComponent(input.reviewId)}`,
      dedupeKey: `review-moderation:${input.kind}:${input.reviewId}:${(input.createdAt ?? new Date().toISOString()).slice(0, 13)}`,
      priority: 70,
      metadata: {
        reviewId: input.reviewId,
        linkedServerId: input.linkedServerId,
        serverName: input.serverName ?? null,
        kind: input.kind,
      },
    });
  } catch {
    return null;
  }
}

async function readReviewForModeration(env: Env, reviewId: string) {
  return requireDb(env)
    .prepare(
      `SELECT
         server_reviews.id,
         server_reviews.linked_server_id,
         server_reviews.reviewer_discord_id,
         server_reviews.reviewer_name,
         server_reviews.reviewer_avatar_url,
         server_reviews.rating,
         server_reviews.title,
         server_reviews.body,
         server_reviews.status,
         server_reviews.moderation_reason,
         server_reviews.report_count,
         server_reviews.owner_reply_body,
         server_reviews.owner_reply_author_user_id,
         server_reviews.owner_reply_author_name,
         server_reviews.owner_reply_created_at,
         server_reviews.owner_reply_updated_at,
         server_reviews.created_at,
         server_reviews.updated_at,
         server_reviews.last_edited_at,
         linked_servers.user_id AS owner_user_id,
         linked_servers.public_slug,
         COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
         NULL AS latest_report_reason,
         NULL AS latest_report_at
       FROM server_reviews
       INNER JOIN linked_servers ON linked_servers.id = server_reviews.linked_server_id
       WHERE server_reviews.id = ?
         AND server_reviews.status != 'deleted'
       LIMIT 1`,
    )
    .bind(reviewId)
    .first<ReviewModerationRow>();
}

function toReviewModerationItem(row: ReviewModerationRow): ReviewModerationItem {
  return {
    id: row.id,
    linked_server_id: row.linked_server_id,
    server_name: row.server_name,
    public_slug: row.public_slug,
    reviewer_name: row.reviewer_name,
    reviewer_avatar_url: row.reviewer_avatar_url,
    rating: clampRating(row.rating),
    title: row.title,
    body: row.body,
    status: row.status,
    moderation_reason: row.moderation_reason,
    report_count: Math.max(0, Number(row.report_count ?? 0)),
    latest_report_reason: row.latest_report_reason,
    latest_report_at: row.latest_report_at,
    owner_reply_body: row.owner_reply_body,
    owner_reply_author_name: row.owner_reply_author_name,
    owner_reply_created_at: row.owner_reply_created_at,
    owner_reply_updated_at: row.owner_reply_updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_edited_at: row.last_edited_at,
  };
}

function normalizeQueueFilter(value: string | null | undefined): ReviewModerationQueueFilter {
  const normalized = String(value ?? "").trim().toLowerCase() as ReviewModerationQueueFilter;
  return QUEUE_FILTERS.has(normalized) ? normalized : "needs_review";
}

function normalizeDashboardAction(value: unknown): ReviewModerationDashboardAction | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DASHBOARD_ACTIONS.has(normalized as ReviewModerationDashboardAction) ? normalized as ReviewModerationDashboardAction : null;
}

function cleanModerationReason(value: unknown) {
  return validateReportReason(value);
}

function sanitizeReviewId(value: string) {
  const normalized = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{3,120}$/.test(normalized) ? normalized : null;
}

function clampLimit(value: number | null | undefined) {
  const numeric = Math.trunc(Number(value ?? 40));
  if (!Number.isFinite(numeric)) return 40;
  return Math.max(1, Math.min(numeric, 100));
}

function clampRating(value: number) {
  return Math.min(5, Math.max(1, Math.round(Number(value) || 1)));
}

function queueCounts(items: ReviewModerationItem[]) {
  return {
    total: items.length,
    needs_review: items.filter((item) => item.status === "pending" || item.report_count > 0).length,
    pending: items.filter((item) => item.status === "pending").length,
    reported: items.filter((item) => item.report_count > 0).length,
    approved: items.filter((item) => item.status === "approved").length,
    replied: items.filter((item) => Boolean(item.owner_reply_body)).length,
  };
}

function moderationError(status: ReviewModerationError["status"], error: string, message: string): ReviewModerationError {
  return { ok: false, status, error, message };
}
