import { ensureMockUser, getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../../_lib/http";
import { isMockAuth } from "../../../../_lib/mock";
import { validateReportReason } from "../../../../_lib/review-moderation";
import { notifyReviewModerationOwner } from "../../../../_lib/review-moderation-dashboard";
import { ensureServerReviewsSchema, recordReviewModerationAction } from "../../../../_lib/server-reviews";
import type { Env, PagesFunction, SessionUser } from "../../../../_lib/types";

type ReportBody = {
  reason?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Log in with Discord to report a review." }, { status: 401 });

  const reviewId = sanitizeId(params.reviewId);
  if (!reviewId) return json({ error: "Invalid review id" }, { status: 400 });

  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const review = await db
    .prepare(
      `SELECT
         server_reviews.id,
         server_reviews.linked_server_id,
         server_reviews.report_count,
         linked_servers.user_id AS owner_user_id,
         COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name
       FROM server_reviews
       INNER JOIN linked_servers ON linked_servers.id = server_reviews.linked_server_id
       WHERE server_reviews.id = ?
         AND server_reviews.status != 'deleted'
       LIMIT 1`,
    )
    .bind(reviewId)
    .first<{ id: string; linked_server_id: string; report_count: number; owner_user_id: string | null; server_name: string | null }>();
  if (!review) return json({ error: "Review not found." }, { status: 404 });

  const body = await readBoundedJson<ReportBody>(request, 2048);
  if (!body.ok) return json({ error: body.error, message: body.message }, { status: body.status });
  const reason = validateReportReason(body.value.reason);
  const now = new Date().toISOString();
  try {
    await db
      .prepare("INSERT INTO server_review_reports (id, review_id, reporter_discord_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), reviewId, user.discord_id, reason, now)
      .run();
  } catch {
    return json({ error: "You have already reported this review." }, { status: 409 });
  }

  const nextReportCount = Number(review.report_count ?? 0) + 1;
  await db
    .prepare("UPDATE server_reviews SET report_count = ?, status = CASE WHEN ? >= 3 THEN 'pending' ELSE status END, updated_at = ? WHERE id = ?")
    .bind(nextReportCount, nextReportCount, now, reviewId)
    .run();
  await recordReviewModerationAction(env, {
    reviewId,
    linkedServerId: review.linked_server_id,
    actor: user,
    actorRole: "player",
    action: "review_reported",
    reason,
    createdAt: now,
  });
  if (nextReportCount >= 3) {
    await recordReviewModerationAction(env, {
      reviewId,
      linkedServerId: review.linked_server_id,
      actor: null,
      actorRole: "system",
      action: "review_auto_pending",
      reason: "Report threshold reached.",
      createdAt: now,
    });
    await notifyReviewModerationOwner(env, {
      ownerUserId: review.owner_user_id,
      linkedServerId: review.linked_server_id,
      reviewId,
      serverName: review.server_name,
      kind: "review_auto_pending",
      title: "Review needs moderation",
      body: `${review.server_name ?? "Your server"} has a review in the moderation queue after multiple reports.`,
      createdAt: now,
    });
  }

  return json({ ok: true, report_count: nextReportCount });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,100}$/.test(value) ? value : null;
}
