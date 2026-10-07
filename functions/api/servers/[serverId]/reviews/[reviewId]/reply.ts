import { getSessionUser, requireDb } from "../../../../../_lib/db";
import { json, methodNotAllowed, readBoundedJson } from "../../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../../_lib/public-cache";
import { validateOwnerReplyInput } from "../../../../../_lib/review-moderation";
import { isServerReviewOwnerRepliesEnabled } from "../../../../../_lib/server-reviews";
import type { Env, PagesFunction, SessionUser } from "../../../../../_lib/types";

type ReplyBody = { body?: unknown };

const BODY_LIMIT_BYTES = 2_048;

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST" && request.method !== "DELETE") return methodNotAllowed();
  if (!isServerReviewOwnerRepliesEnabled(env)) return json({ ok: false, message: "Server review responses are not enabled on this environment." }, { status: 404 });
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-origin review responses are not allowed." }, { status: 403 });

  const linkedServerId = sanitizeId(params.serverId, 80);
  const reviewId = sanitizeId(params.reviewId, 100);
  if (!linkedServerId || !reviewId) return json({ ok: false, message: "Invalid review route." }, { status: 400 });

  const user = await getSessionUser(env, request);
  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    const status = access.reason === "unauthenticated" ? 401 : access.reason === "not_found" ? 404 : 403;
    return json({ ok: false, message: access.reason === "unauthenticated" ? "Log in to manage this server's review responses." : "Only this server owner or a DZN admin can manage review responses." }, { status });
  }
  if (!user) return json({ ok: false, message: "Log in to manage this server's review responses." }, { status: 401 });

  return request.method === "DELETE"
    ? removeReply(env, user, linkedServerId, reviewId)
    : upsertReply(env, request, user, linkedServerId, reviewId);
};

async function upsertReply(env: Env, request: Request, user: SessionUser, linkedServerId: string, reviewId: string) {
  const body = await readBoundedJson<ReplyBody>(request, BODY_LIMIT_BYTES);
  if (!body.ok) return json({ ok: false, message: body.message }, { status: body.status });
  const validated = validateOwnerReplyInput(body.value);
  if (!validated.ok) return json({ ok: false, message: validated.error }, { status: 400 });

  const existing = await findReview(env, linkedServerId, reviewId);
  if (!existing) return json({ ok: false, message: "Review not found." }, { status: 404 });

  const now = new Date().toISOString();
  const nextVersion = existing.owner_reply_version + 1;
  const decisionId = crypto.randomUUID();
  const results = await requireDb(env).batch([
    requireDb(env).prepare(
      `UPDATE server_reviews
          SET owner_reply_body = ?, owner_reply_author_user_id = ?, owner_reply_author_name = ?,
              owner_reply_created_at = COALESCE(owner_reply_created_at, ?), owner_reply_updated_at = ?,
              owner_reply_version = ?
        WHERE id = ? AND linked_server_id = ? AND status = 'approved' AND owner_reply_version = ?`,
    ).bind(validated.value.body, user.id, user.username, now, now, nextVersion, reviewId, linkedServerId, existing.owner_reply_version),
    requireDb(env).prepare(
      `INSERT INTO server_review_owner_reply_audit (
         id, review_id, linked_server_id, actor_user_id, actor_discord_id, actor_name,
         action, previous_version, next_version, created_at
       ) SELECT ?, ?, ?, ?, ?, ?, 'upsert', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM server_reviews
            WHERE id = ? AND linked_server_id = ? AND owner_reply_version = ?
         )`,
    ).bind(decisionId, reviewId, linkedServerId, user.id, user.discord_id, user.username, existing.owner_reply_version, nextVersion, now, reviewId, linkedServerId, nextVersion),
  ]);

  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return json({ ok: false, message: "This review response changed while you were saving it. Refresh and try again." }, { status: 409 });
  }
  return json({ ok: true, reviewId, ownerReplyUpdatedAt: now, ownerReplyVersion: nextVersion });
}

async function removeReply(env: Env, user: SessionUser, linkedServerId: string, reviewId: string) {
  const existing = await findReview(env, linkedServerId, reviewId);
  if (!existing) return json({ ok: false, message: "Review not found." }, { status: 404 });
  if (!existing.owner_reply_body) return json({ ok: false, message: "This review has no server response to remove." }, { status: 409 });

  const now = new Date().toISOString();
  const nextVersion = existing.owner_reply_version + 1;
  const decisionId = crypto.randomUUID();
  const results = await requireDb(env).batch([
    requireDb(env).prepare(
      `UPDATE server_reviews
          SET owner_reply_body = NULL, owner_reply_author_user_id = NULL, owner_reply_author_name = NULL,
              owner_reply_created_at = NULL, owner_reply_updated_at = NULL, owner_reply_version = ?
        WHERE id = ? AND linked_server_id = ? AND status = 'approved'
          AND owner_reply_body IS NOT NULL AND owner_reply_version = ?`,
    ).bind(nextVersion, reviewId, linkedServerId, existing.owner_reply_version),
    requireDb(env).prepare(
      `INSERT INTO server_review_owner_reply_audit (
         id, review_id, linked_server_id, actor_user_id, actor_discord_id, actor_name,
         action, previous_version, next_version, created_at
       ) SELECT ?, ?, ?, ?, ?, ?, 'remove', ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM server_reviews
            WHERE id = ? AND linked_server_id = ? AND owner_reply_version = ?
         )`,
    ).bind(decisionId, reviewId, linkedServerId, user.id, user.discord_id, user.username, existing.owner_reply_version, nextVersion, now, reviewId, linkedServerId, nextVersion),
  ]);

  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return json({ ok: false, message: "This review response changed while you were removing it. Refresh and try again." }, { status: 409 });
  }
  return json({ ok: true, reviewId, ownerReplyRemovedAt: now, ownerReplyVersion: nextVersion });
}

async function findReview(env: Env, linkedServerId: string, reviewId: string) {
  return requireDb(env).prepare(
    `SELECT id, owner_reply_body, owner_reply_version
       FROM server_reviews
      WHERE id = ? AND linked_server_id = ? AND status = 'approved'
      LIMIT 1`,
  ).bind(reviewId, linkedServerId).first<{ id: string; owner_reply_body: string | null; owner_reply_version: number }>();
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function sanitizeId(value: unknown, maxLength: number) {
  return typeof value === "string" && new RegExp(`^[a-zA-Z0-9-]{8,${maxLength}}$`).test(value) ? value : null;
}
