import { requireDb } from "./db";
import { readBoundedJson } from "./http";
import type { Env, SessionUser } from "./types";

export const REVIEW_MODERATION_STATUSES = ["pending", "approved", "hidden"] as const;
export type ReviewModerationStatus = (typeof REVIEW_MODERATION_STATUSES)[number];
export type ReviewModerationAction = "approve" | "hide";

export type ReviewModerationFilters = {
  status: ReviewModerationStatus;
  query: string;
};

export type ReviewModerationInput = {
  reviewId: string;
  moderationVersion: number;
  action: ReviewModerationAction;
  reason: string;
};

type ReviewModerationRow = {
  id: string;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  moderation_reason: string | null;
  report_count: number;
  moderation_version: number;
  created_at: string;
  updated_at: string;
  active_report_count: number;
  report_reasons: string | null;
  first_reported_at: string | null;
};

export function parseReviewModerationFilters(url: URL): ReviewModerationFilters {
  const requestedStatus = url.searchParams.get("status")?.trim().toLowerCase();
  const status = REVIEW_MODERATION_STATUSES.includes(requestedStatus as ReviewModerationStatus)
    ? requestedStatus as ReviewModerationStatus
    : "pending";
  return {
    status,
    query: normalizeSearch(url.searchParams.get("q")),
  };
}

export function validateReviewModerationInput(value: unknown):
  | { ok: true; value: ReviewModerationInput }
  | { ok: false; status: 400; message: string } {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reviewId = typeof input.reviewId === "string" ? input.reviewId.trim() : "";
  const moderationVersion = input.moderationVersion;
  const action = input.action === "approve" || input.action === "hide" ? input.action : null;
  const reason = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim() : "";

  if (!/^[a-zA-Z0-9-]{8,100}$/.test(reviewId)) {
    return { ok: false, status: 400, message: "Choose a valid review." };
  }
  if (typeof moderationVersion !== "number" || !Number.isInteger(moderationVersion) || moderationVersion < 0) {
    return { ok: false, status: 400, message: "Refresh the review queue before deciding." };
  }
  if (!action) return { ok: false, status: 400, message: "Choose approve or hide." };
  if (reason.length < 5 || reason.length > 240) {
    return { ok: false, status: 400, message: "Enter a clear reason between 5 and 240 characters." };
  }
  return { ok: true, value: { reviewId, moderationVersion, action, reason } };
}

export async function readReviewModerationQueue(env: Env, filters: ReviewModerationFilters) {
  const db = requireDb(env);
  const search = `%${filters.query}%`;
  const rows = await db.prepare(
    `SELECT reviews.id, reviews.linked_server_id, servers.server_name, servers.public_slug,
            reviews.reviewer_name, reviews.reviewer_avatar_url, reviews.rating, reviews.title,
            reviews.body, reviews.status, reviews.moderation_reason, reviews.report_count, reviews.moderation_version,
            reviews.created_at, reviews.updated_at,
            COUNT(CASE WHEN reports.id IS NOT NULL AND reports.resolution_status IS NULL THEN 1 END) AS active_report_count,
            GROUP_CONCAT(CASE WHEN reports.resolution_status IS NULL THEN NULLIF(TRIM(reports.reason), '') END, ' | ') AS report_reasons,
            MIN(CASE WHEN reports.resolution_status IS NULL THEN reports.created_at END) AS first_reported_at
       FROM server_reviews AS reviews
       JOIN linked_servers AS servers ON servers.id = reviews.linked_server_id
       LEFT JOIN server_review_reports AS reports ON reports.review_id = reviews.id
      WHERE reviews.status = ?
        AND (? = '' OR COALESCE(servers.server_name, '') LIKE ? OR COALESCE(reviews.reviewer_name, '') LIKE ?
             OR COALESCE(reviews.title, '') LIKE ? OR reviews.body LIKE ?)
      GROUP BY reviews.id
      ORDER BY active_report_count DESC, reviews.updated_at DESC
      LIMIT 100`,
  ).bind(filters.status, filters.query, search, search, search, search).all<ReviewModerationRow>();

  const audit = await db.prepare(
    `SELECT audit.id, audit.review_id, audit.action, audit.previous_status, audit.next_status,
            audit.reason, audit.report_count, audit.actor_name, audit.created_at,
            servers.server_name, reviews.reviewer_name
       FROM server_review_moderation_audit AS audit
       LEFT JOIN linked_servers AS servers ON servers.id = audit.linked_server_id
       LEFT JOIN server_reviews AS reviews ON reviews.id = audit.review_id
      ORDER BY audit.created_at DESC
      LIMIT 80`,
  ).all<Record<string, unknown>>();

  return { reviews: rows.results ?? [], audit: audit.results ?? [] };
}

export async function applyReviewModerationDecision(env: Env, actor: SessionUser, input: ReviewModerationInput) {
  const db = requireDb(env);
  const existing = await db.prepare(
    `SELECT reviews.id, reviews.linked_server_id, reviews.status, reviews.moderation_version,
            COUNT(CASE WHEN reports.id IS NOT NULL AND reports.resolution_status IS NULL THEN 1 END) AS active_report_count
       FROM server_reviews AS reviews
       LEFT JOIN server_review_reports AS reports ON reports.review_id = reviews.id
      WHERE reviews.id = ? AND reviews.status != 'deleted'
      GROUP BY reviews.id
      LIMIT 1`,
  ).bind(input.reviewId).first<{ id: string; linked_server_id: string; status: string; moderation_version: number; active_report_count: number }>();
  if (!existing) return { ok: false as const, status: 404, message: "Review not found." };

  const nextStatus = input.action === "approve" ? "approved" : "hidden";
  const now = new Date().toISOString();
  const decisionId = crypto.randomUUID();
  const nextVersion = input.moderationVersion + 1;
  const results = await db.batch([
    db.prepare(
      `UPDATE server_reviews
          SET status = ?, moderation_reason = ?, report_count = 0, updated_at = ?,
              moderation_version = ?, moderation_decision_id = ?
        WHERE id = ? AND moderation_version = ?`,
    ).bind(nextStatus, input.reason, now, nextVersion, decisionId, input.reviewId, input.moderationVersion),
    db.prepare(
      `UPDATE server_review_reports
          SET resolution_status = ?, resolved_at = ?, resolved_by_user_id = ?
        WHERE review_id = ? AND resolution_status IS NULL
          AND EXISTS (SELECT 1 FROM server_reviews WHERE id = ? AND moderation_decision_id = ?)`,
    ).bind(input.action === "approve" ? "dismissed" : "actioned", now, actor.id, input.reviewId, input.reviewId, decisionId),
    db.prepare(
      `INSERT INTO server_review_moderation_audit (
         id, review_id, linked_server_id, actor_user_id, actor_discord_id, actor_name,
         action, previous_status, next_status, reason, report_count, created_at
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM server_reviews WHERE id = ? AND moderation_decision_id = ?)`,
    ).bind(
      decisionId, input.reviewId, existing.linked_server_id, actor.id, actor.discord_id,
      actor.username, input.action, existing.status, nextStatus, input.reason,
      Number(existing.active_report_count ?? 0), now, input.reviewId, decisionId,
    ),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return { ok: false as const, status: 409, message: "This review changed while you were deciding. Refresh and try again." };
  }
  return { ok: true as const, reviewId: input.reviewId, status: nextStatus };
}

export async function readReviewModerationRequest(request: Request) {
  const parsed = await readBoundedJson<unknown>(request, 2_048);
  if (!parsed.ok) return { ok: false as const, status: parsed.status, message: parsed.message };
  return validateReviewModerationInput(parsed.value);
}

function normalizeSearch(value: string | null) {
  return (value ?? "").replace(/[%_]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}
