import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { countUnreadNotifications, countUnreadReviewNotifications, createNotification } from "./dzn-pulse";
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
export type BulkReviewModerationDashboardAction = "hold" | "remove" | "dismiss_reports";

export type ReviewModerationActor = {
  user: SessionUser;
  role: ReviewModerationRole;
};

export type ReviewModerationCounts = {
  total: number;
  needs_review: number;
  pending: number;
  reported: number;
  approved: number;
  replied: number;
};

export type ReviewModerationNotificationCounts = {
  unread_total: number;
  review_notifications: number;
  review_queue: number;
};

export type ReviewModerationHistoryItem = {
  action: string;
  actor_role: string;
  reason: string | null;
  created_at: string;
};

export type ReviewReportPattern = {
  pattern_key: string;
  reason: string;
  review_count: number;
  total_reports: number;
  latest_report_at: string | null;
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
  status_history: ReviewModerationHistoryItem[];
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

type BulkDashboardActionInput = {
  action?: unknown;
  pattern_key?: unknown;
  reason?: unknown;
  limit?: unknown;
  min_report_count?: unknown;
};

type ReviewModerationError = {
  ok: false;
  status: 400 | 401 | 402 | 403 | 404 | 503;
  error: string;
  message: string;
};

const QUEUE_FILTERS = new Set<ReviewModerationQueueFilter>(["needs_review", "pending", "reported", "approved", "replied", "all"]);
const DASHBOARD_ACTIONS = new Set<ReviewModerationDashboardAction>(["approve", "hold", "remove", "dismiss_reports", "reply", "remove_reply"]);
const BULK_DASHBOARD_ACTIONS = new Set<BulkReviewModerationDashboardAction>(["hold", "remove", "dismiss_reports"]);

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
  const conditions = scopedReviewConditions(actor, bindings);

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

  const baseItems = (rows.results ?? []).map(toReviewModerationItem);
  const [items, counts, reportPatterns] = await Promise.all([
    attachStatusHistory(env, baseItems),
    readReviewModerationCounts(env, actor),
    actor.role === "admin" ? readRepeatedReportPatterns(env, actor).catch(() => []) : Promise.resolve([]),
  ]);
  const notificationCounts = await readModerationNotificationCounts(env, actor, counts);

  return {
    ok: true as const,
    role: actor.role,
    status: filter,
    counts,
    notification_counts: notificationCounts,
    report_patterns: reportPatterns,
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

export async function bulkModerateRepeatedReports(
  env: Env,
  actor: ReviewModerationActor,
  input: BulkDashboardActionInput,
): Promise<
  | {
      ok: true;
      action: BulkReviewModerationDashboardAction;
      pattern_key: string;
      matched_count: number;
      updated_count: number;
      review_ids: string[];
      updated_at: string;
    }
  | ReviewModerationError
> {
  if (actor.role !== "admin") {
    return moderationError(403, "ADMIN_ONLY_BULK_TRIAGE", "Only DZN admins can run bulk review triage.");
  }

  const action = normalizeBulkDashboardAction(input.action);
  if (!action) return moderationError(400, "INVALID_BULK_ACTION", "Choose a valid bulk moderation action.");

  const patternKey = normalizeReportPatternKey(input.pattern_key);
  if (!patternKey) return moderationError(400, "INVALID_REPORT_PATTERN", "Choose a repeated report pattern.");

  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const minReportCount = clampBulkMinReportCount(input.min_report_count);
  const limit = clampBulkLimit(input.limit);
  const patternSummary = await readReportPatternSummary(env, actor, patternKey);
  if (!patternSummary || (patternSummary.review_count < 2 && patternSummary.report_rows < 3)) {
    return moderationError(400, "REPORT_PATTERN_NOT_REPEATED", "Bulk triage is only available for repeated report patterns.");
  }

  const reviews = await db
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
       WHERE server_reviews.status != 'deleted'
         AND COALESCE(server_reviews.report_count, 0) >= ?
         AND EXISTS (
           SELECT 1
           FROM server_review_reports
           WHERE server_review_reports.review_id = server_reviews.id
             AND ${reportPatternExpression()} = ?
         )
       ORDER BY COALESCE(server_reviews.report_count, 0) DESC,
                datetime(COALESCE(server_reviews.updated_at, server_reviews.created_at)) DESC
       LIMIT ?`,
    )
    .bind(minReportCount, patternKey, limit)
    .all<ReviewModerationRow>();

  const targets = reviews.results ?? [];
  const now = new Date().toISOString();
  const reason = cleanModerationReason(input.reason) ?? `Bulk triage for repeated report pattern: ${patternKey}`;
  let auditAction: ReviewModerationAction = "review_reports_dismissed";

  for (const review of targets) {
    if (action === "dismiss_reports") {
      auditAction = "review_reports_dismissed";
      await db
        .prepare("UPDATE server_reviews SET status = 'approved', report_count = 0, moderation_reason = ?, updated_at = ? WHERE id = ?")
        .bind(reason, now, review.id)
        .run();
    } else if (action === "hold") {
      auditAction = "review_moderation_pending";
      await db
        .prepare("UPDATE server_reviews SET status = 'pending', moderation_reason = ?, updated_at = ? WHERE id = ?")
        .bind(reason, now, review.id)
        .run();
    } else {
      auditAction = "review_moderation_removed";
      await db
        .prepare("UPDATE server_reviews SET status = 'deleted', moderation_reason = ?, updated_at = ? WHERE id = ?")
        .bind(reason, now, review.id)
        .run();
    }

    await recordReviewModerationAction(env, {
      reviewId: review.id,
      linkedServerId: review.linked_server_id,
      actor: actor.user,
      actorRole: "admin",
      action: auditAction,
      reason,
      createdAt: now,
    });

    if (review.owner_user_id && review.owner_user_id !== actor.user.id) {
      await notifyReviewModerationOwner(env, {
        ownerUserId: review.owner_user_id,
        linkedServerId: review.linked_server_id,
        reviewId: review.id,
        serverName: review.server_name,
        kind: `bulk_${action}`,
        title: "Review queue bulk triage",
        body: `${review.server_name} review queue was updated by DZN moderation.`,
        createdAt: now,
      });
    }
  }

  return {
    ok: true,
    action,
    pattern_key: patternKey,
    matched_count: targets.length,
    updated_count: targets.length,
    review_ids: targets.map((review) => review.id),
    updated_at: now,
  };
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
      type: reviewPulseNotificationType(input.kind),
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
    status_history: [],
  };
}

async function attachStatusHistory(env: Env, items: ReviewModerationItem[]) {
  if (!items.length) return items;
  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await requireDb(env)
    .prepare(
      `SELECT review_id, actor_role, action, reason, created_at
       FROM server_review_moderation_actions
       WHERE review_id IN (${placeholders})
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .bind(...ids, Math.min(800, ids.length * 8))
    .all<{ review_id: string; actor_role: string; action: string; reason: string | null; created_at: string }>()
    .catch(() => ({ results: [] as Array<{ review_id: string; actor_role: string; action: string; reason: string | null; created_at: string }> }));

  const byReview = new Map<string, ReviewModerationHistoryItem[]>();
  for (const row of rows.results ?? []) {
    const entry: ReviewModerationHistoryItem = {
      action: sanitizeHistoryText(row.action, 80),
      actor_role: sanitizeHistoryText(row.actor_role, 32),
      reason: row.reason ? sanitizeHistoryText(row.reason, 240) : null,
      created_at: row.created_at,
    };
    const list = byReview.get(row.review_id) ?? [];
    if (list.length < 8) list.push(entry);
    byReview.set(row.review_id, list);
  }

  return items.map((item) => ({
    ...item,
    status_history: byReview.get(item.id) ?? [],
  }));
}

async function readReviewModerationCounts(env: Env, actor: ReviewModerationActor): Promise<ReviewModerationCounts> {
  const bindings: unknown[] = [];
  const conditions = scopedReviewConditions(actor, bindings);
  const row = await requireDb(env)
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN server_reviews.status = 'pending' OR COALESCE(server_reviews.report_count, 0) > 0 THEN 1 ELSE 0 END) AS needs_review,
         SUM(CASE WHEN server_reviews.status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN COALESCE(server_reviews.report_count, 0) > 0 THEN 1 ELSE 0 END) AS reported,
         SUM(CASE WHEN server_reviews.status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN server_reviews.owner_reply_body IS NOT NULL THEN 1 ELSE 0 END) AS replied
       FROM server_reviews
       INNER JOIN linked_servers ON linked_servers.id = server_reviews.linked_server_id
       WHERE ${conditions.join(" AND ")}`,
    )
    .bind(...bindings)
    .first<Partial<ReviewModerationCounts>>()
    .catch(() => null);

  return {
    total: countValue(row?.total),
    needs_review: countValue(row?.needs_review),
    pending: countValue(row?.pending),
    reported: countValue(row?.reported),
    approved: countValue(row?.approved),
    replied: countValue(row?.replied),
  };
}

async function readModerationNotificationCounts(
  env: Env,
  actor: ReviewModerationActor,
  counts: ReviewModerationCounts,
): Promise<ReviewModerationNotificationCounts> {
  const [unreadTotal, reviewNotifications] = await Promise.all([
    countUnreadNotifications(env, actor.user).catch(() => 0),
    countUnreadReviewNotifications(env, actor.user).catch(() => 0),
  ]);

  return {
    unread_total: countValue(unreadTotal),
    review_notifications: reviewNotifications,
    review_queue: counts.needs_review,
  };
}

async function readRepeatedReportPatterns(env: Env, actor: ReviewModerationActor): Promise<ReviewReportPattern[]> {
  const bindings: unknown[] = [];
  const conditions = scopedReviewConditions(actor, bindings);
  conditions.push("COALESCE(server_reviews.report_count, 0) > 0");
  const rows = await requireDb(env)
    .prepare(
      `SELECT
         ${reportPatternExpression()} AS pattern_key,
         COALESCE(NULLIF(TRIM(server_review_reports.reason), ''), 'No reason provided') AS reason,
         COUNT(DISTINCT server_reviews.id) AS review_count,
         COUNT(*) AS total_reports,
         MAX(server_review_reports.created_at) AS latest_report_at
       FROM server_review_reports
       INNER JOIN server_reviews ON server_reviews.id = server_review_reports.review_id
       INNER JOIN linked_servers ON linked_servers.id = server_reviews.linked_server_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY pattern_key
       HAVING COUNT(DISTINCT server_reviews.id) >= 2 OR COUNT(*) >= 3
       ORDER BY COUNT(DISTINCT server_reviews.id) DESC,
                COUNT(*) DESC,
                datetime(MAX(server_review_reports.created_at)) DESC
       LIMIT 8`,
    )
    .bind(...bindings)
    .all<{ pattern_key: string; reason: string | null; review_count: number | null; total_reports: number | null; latest_report_at: string | null }>();

  return (rows.results ?? []).map((row) => ({
    pattern_key: normalizeReportPatternKey(row.pattern_key) ?? "no_reason",
    reason: sanitizeHistoryText(row.reason || "No reason provided", 140),
    review_count: countValue(row.review_count),
    total_reports: countValue(row.total_reports),
    latest_report_at: row.latest_report_at,
  }));
}

async function readReportPatternSummary(env: Env, actor: ReviewModerationActor, patternKey: string) {
  const bindings: unknown[] = [];
  const conditions = scopedReviewConditions(actor, bindings);
  conditions.push("COALESCE(server_reviews.report_count, 0) > 0");
  const row = await requireDb(env)
    .prepare(
      `SELECT
         COUNT(DISTINCT server_reviews.id) AS review_count,
         COUNT(*) AS report_rows,
         COUNT(*) AS total_reports
       FROM server_review_reports
       INNER JOIN server_reviews ON server_reviews.id = server_review_reports.review_id
       INNER JOIN linked_servers ON linked_servers.id = server_reviews.linked_server_id
       WHERE ${conditions.join(" AND ")}
         AND ${reportPatternExpression()} = ?`,
    )
    .bind(...bindings, patternKey)
    .first<{ review_count: number | null; report_rows: number | null; total_reports: number | null }>()
    .catch(() => null);
  if (!row) return null;
  return {
    review_count: countValue(row.review_count),
    report_rows: countValue(row.report_rows),
    total_reports: countValue(row.total_reports),
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

function normalizeBulkDashboardAction(value: unknown): BulkReviewModerationDashboardAction | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return BULK_DASHBOARD_ACTIONS.has(normalized as BulkReviewModerationDashboardAction) ? normalized as BulkReviewModerationDashboardAction : null;
}

function normalizeReportPatternKey(value: unknown) {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().toLowerCase();
  if (!normalized || normalized.length > 160) return null;
  return normalized === "no reason provided" ? "no_reason" : normalized;
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

function clampBulkLimit(value: unknown) {
  const numeric = Math.trunc(Number(value ?? 25));
  if (!Number.isFinite(numeric)) return 25;
  return Math.max(1, Math.min(numeric, 50));
}

function clampBulkMinReportCount(value: unknown) {
  const numeric = Math.trunc(Number(value ?? 1));
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(numeric, 25));
}

function clampRating(value: number) {
  return Math.min(5, Math.max(1, Math.round(Number(value) || 1)));
}

function moderationError(status: ReviewModerationError["status"], error: string, message: string): ReviewModerationError {
  return { ok: false, status, error, message };
}

function scopedReviewConditions(actor: ReviewModerationActor, bindings: unknown[]) {
  const conditions = ["server_reviews.status != 'deleted'"];
  if (actor.role === "owner") {
    conditions.push("linked_servers.user_id = ?");
    bindings.push(actor.user.id);
  }
  return conditions;
}

function reportPatternExpression() {
  return "COALESCE(NULLIF(LOWER(TRIM(server_review_reports.reason)), ''), 'no_reason')";
}

function reviewPulseNotificationType(kind: string) {
  const normalized = kind.trim().toLowerCase();
  if (normalized.startsWith("bulk_")) return "review_bulk_triage";
  if (normalized.includes("pending") || normalized.includes("report")) return "review_needs_moderation";
  return "review_moderation_alert";
}

function countValue(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function sanitizeHistoryText(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
