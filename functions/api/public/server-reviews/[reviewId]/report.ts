import { ensureMockUser, getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { isMockAuth } from "../../../../_lib/mock";
import { validateReportReason } from "../../../../_lib/review-moderation";
import { ensureServerReviewsSchema } from "../../../../_lib/server-reviews";
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
    .prepare("SELECT id, moderation_version FROM server_reviews WHERE id = ? AND status = 'approved' LIMIT 1")
    .bind(reviewId)
    .first<{ id: string; moderation_version: number }>();
  if (!review) return json({ error: "Review not found." }, { status: 404 });

  const body = await readJson<ReportBody>(request);
  const now = new Date().toISOString();
  const reportId = crypto.randomUUID();
  let results: Awaited<ReturnType<typeof db.batch>>;
  try {
    results = await db.batch([
      db.prepare(
        `INSERT INTO server_review_reports (id, review_id, reporter_discord_id, reason, created_at)
         SELECT ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM server_reviews
             WHERE id = ? AND status = 'approved' AND moderation_version = ?
          )`,
      ).bind(reportId, reviewId, user.discord_id, validateReportReason(body.reason), now, reviewId, review.moderation_version),
      db.prepare(
        `UPDATE server_reviews
            SET report_count = (SELECT COUNT(*) FROM server_review_reports WHERE review_id = ? AND resolution_status IS NULL),
                status = CASE WHEN (SELECT COUNT(*) FROM server_review_reports WHERE review_id = ? AND resolution_status IS NULL) >= 3 THEN 'pending' ELSE status END,
                updated_at = ?, moderation_version = moderation_version + 1
          WHERE id = ? AND status = 'approved' AND moderation_version = ?
            AND EXISTS (SELECT 1 FROM server_review_reports WHERE id = ? AND resolution_status IS NULL)`,
      ).bind(reviewId, reviewId, now, reviewId, review.moderation_version, reportId),
    ]);
  } catch {
    return json({ error: "You have already reported this review." }, { status: 409 });
  }

  if (Number(results[0]?.meta?.changes ?? 0) !== 1 || Number(results[1]?.meta?.changes ?? 0) !== 1) {
    return json({ error: "This review changed while the report was sent. Refresh and try again." }, { status: 409 });
  }

  const nextReportCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM server_review_reports WHERE review_id = ? AND resolution_status IS NULL",
  ).bind(reviewId).first<{ count: number }>();

  return json({ ok: true, report_count: Number(nextReportCount?.count ?? 0) });
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
