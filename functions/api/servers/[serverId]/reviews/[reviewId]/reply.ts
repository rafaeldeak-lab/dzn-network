import { requireDb } from "../../../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../../../_lib/http";
import { getRequestSessionUser } from "../../../../../_lib/owner-access";
import { requireServerOwnerOrDznAdmin } from "../../../../../_lib/public-cache";
import { validateOwnerReplyInput } from "../../../../../_lib/review-moderation";
import { ensureServerReviewsSchema, recordReviewModerationAction } from "../../../../../_lib/server-reviews";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

type ReplyRequestBody = {
  body?: unknown;
};

const BODY_LIMIT_BYTES = 2048;

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "PUT" && request.method !== "DELETE") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  const linkedServerId = sanitizeId(params.serverId, 80);
  const reviewId = sanitizeId(params.reviewId, 100);
  if (!linkedServerId || !reviewId) return json({ error: "Invalid review route." }, { status: 400 });

  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    const status = access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403;
    return json({ error: access.reason ?? "forbidden" }, { status });
  }
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  await ensureServerReviewsSchema(env);
  const review = await requireDb(env)
    .prepare(
      `SELECT id, linked_server_id
       FROM server_reviews
       WHERE id = ?
         AND linked_server_id = ?
         AND status != 'deleted'
       LIMIT 1`,
    )
    .bind(reviewId, linkedServerId)
    .first<{ id: string; linked_server_id: string }>();
  if (!review) return json({ error: "Review not found." }, { status: 404 });

  if (request.method === "DELETE") return removeOwnerReply(env, user, linkedServerId, reviewId);
  return upsertOwnerReply(env, request, user, linkedServerId, reviewId);
};

async function upsertOwnerReply(env: Env, request: Request, user: SessionUser, linkedServerId: string, reviewId: string) {
  const bodyResult = await readBoundedJson<ReplyRequestBody>(request, BODY_LIMIT_BYTES);
  if (!bodyResult.ok) {
    return json({ ok: false, error: bodyResult.error, message: bodyResult.message }, { status: bodyResult.status });
  }

  const validation = validateOwnerReplyInput(bodyResult.value);
  if (!validation.ok) return json({ error: validation.error, reason: validation.reason ?? null }, { status: 400 });

  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `UPDATE server_reviews SET
        owner_reply_body = ?,
        owner_reply_author_user_id = ?,
        owner_reply_author_name = ?,
        owner_reply_created_at = COALESCE(owner_reply_created_at, ?),
        owner_reply_updated_at = ?,
        updated_at = ?
       WHERE id = ?
         AND linked_server_id = ?
         AND status != 'deleted'`,
    )
    .bind(validation.value.body, user.id, user.username, now, now, now, reviewId, linkedServerId)
    .run();

  await recordReviewModerationAction(env, {
    reviewId,
    linkedServerId,
    actor: user,
    actorRole: "owner",
    action: "owner_reply_upserted",
    createdAt: now,
  });

  return json({ ok: true, review_id: reviewId, owner_reply_updated_at: now });
}

async function removeOwnerReply(env: Env, user: SessionUser, linkedServerId: string, reviewId: string) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `UPDATE server_reviews SET
        owner_reply_body = NULL,
        owner_reply_author_user_id = NULL,
        owner_reply_author_name = NULL,
        owner_reply_created_at = NULL,
        owner_reply_updated_at = NULL,
        updated_at = ?
       WHERE id = ?
         AND linked_server_id = ?
         AND status != 'deleted'`,
    )
    .bind(now, reviewId, linkedServerId)
    .run();

  await recordReviewModerationAction(env, {
    reviewId,
    linkedServerId,
    actor: user,
    actorRole: "owner",
    action: "owner_reply_removed",
    createdAt: now,
  });

  return json({ ok: true, review_id: reviewId, owner_reply_removed_at: now });
}

function sanitizeId(value: unknown, maxLength: number) {
  return typeof value === "string" && new RegExp(`^[a-zA-Z0-9-]{8,${maxLength}}$`).test(value) ? value : null;
}
