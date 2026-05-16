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
    .prepare("SELECT id, report_count FROM server_reviews WHERE id = ? AND status != 'deleted' LIMIT 1")
    .bind(reviewId)
    .first<{ id: string; report_count: number }>();
  if (!review) return json({ error: "Review not found." }, { status: 404 });

  const body = await readJson<ReportBody>(request);
  const now = new Date().toISOString();
  try {
    await db
      .prepare("INSERT INTO server_review_reports (id, review_id, reporter_discord_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), reviewId, user.discord_id, validateReportReason(body.reason), now)
      .run();
  } catch {
    return json({ error: "You have already reported this review." }, { status: 409 });
  }

  const nextReportCount = Number(review.report_count ?? 0) + 1;
  await db
    .prepare("UPDATE server_reviews SET report_count = ?, status = CASE WHEN ? >= 3 THEN 'pending' ELSE status END, updated_at = ? WHERE id = ?")
    .bind(nextReportCount, nextReportCount, now, reviewId)
    .run();

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
