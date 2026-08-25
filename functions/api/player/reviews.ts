import { json, methodNotAllowed, readBoundedJson } from "../../_lib/http";
import { getRequestSessionUser } from "../../_lib/owner-access";
import { validateReviewInput } from "../../_lib/review-moderation";
import {
  ensureServerReviewsSchema,
  getApprovedReviewSummary,
  getExistingActiveReview,
  recordReviewModerationAction,
  viewerReviewState,
} from "../../_lib/server-reviews";
import type { PagesFunction, SessionUser } from "../../_lib/types";

type ReviewRequestBody = {
  linked_server_id?: unknown;
  rating?: unknown;
  title?: unknown;
  body?: unknown;
};

const BODY_LIMIT_BYTES = 4096;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });
  if (!env.DB) return json({ error: "Review storage is not available." }, { status: 503 });

  const bodyResult = await readBoundedJson<ReviewRequestBody>(request, BODY_LIMIT_BYTES);
  if (!bodyResult.ok) {
    return json({ ok: false, error: bodyResult.error, message: bodyResult.message }, { status: bodyResult.status });
  }

  const linkedServerId = sanitizeLinkedServerId(bodyResult.value.linked_server_id);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const validation = validateReviewInput(bodyResult.value);
  if (!validation.ok) return json({ error: validation.error, reason: validation.reason ?? null }, { status: 400 });

  await ensureServerReviewsSchema(env);
  const server = await env.DB
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
         AND lower(COALESCE(listing_visibility, 'public')) != 'hidden'
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string; user_id: string }>();

  if (!server) return json({ error: "Server not found." }, { status: 404 });
  if (server.user_id === user.id) return json({ error: "Owners cannot review their own server." }, { status: 403 });

  const existing = await getExistingActiveReview(env, linkedServerId, user.discord_id);
  if (existing) {
    const cooldownUntil = new Date(new Date(existing.updated_at).getTime() + 24 * 60 * 60 * 1000);
    if (cooldownUntil.getTime() > Date.now()) {
      return json({ error: `You can update your review again in ${hoursUntil(cooldownUntil)} hours.`, cooldown_until: cooldownUntil.toISOString() }, { status: 429 });
    }
  }

  const now = new Date().toISOString();
  const avatarUrl = discordAvatarUrl(user);
  const reviewId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await env.DB
      .prepare(
        `UPDATE server_reviews SET
          reviewer_name = ?,
          reviewer_avatar_url = ?,
          rating = ?,
          title = ?,
          body = ?,
          status = 'approved',
          moderation_reason = NULL,
          updated_at = ?,
          last_edited_at = ?
         WHERE id = ?
           AND linked_server_id = ?
           AND reviewer_discord_id = ?`,
      )
      .bind(user.username, avatarUrl, validation.value.rating, validation.value.title, validation.value.body, now, now, reviewId, linkedServerId, user.discord_id)
      .run();
  } else {
    await env.DB
      .prepare(
        `INSERT INTO server_reviews (
          id, linked_server_id, reviewer_discord_id, reviewer_name, reviewer_avatar_url,
          rating, title, body, status, moderation_reason, report_count, created_at, updated_at, last_edited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', NULL, 0, ?, ?, NULL)`,
      )
      .bind(reviewId, linkedServerId, user.discord_id, user.username, avatarUrl, validation.value.rating, validation.value.title, validation.value.body, now, now)
      .run();
  }

  await recordReviewModerationAction(env, {
    reviewId,
    linkedServerId,
    actor: user,
    actorRole: "player",
    action: existing ? "player_review_updated" : "player_review_created",
    createdAt: now,
  });

  const savedReview = await getExistingActiveReview(env, linkedServerId, user.discord_id);
  const summary = await getApprovedReviewSummary(env, linkedServerId, user);
  return json({
    ok: true,
    review_id: reviewId,
    ...summary,
    viewer: viewerReviewState({ viewer: user, serverOwnerUserId: server.user_id, existingReview: savedReview }),
  });
};

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function discordAvatarUrl(user: SessionUser) {
  if (!user.avatar) return null;
  if (/^https?:\/\//i.test(user.avatar)) return user.avatar;
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.discord_id)}/${encodeURIComponent(user.avatar)}.png`;
}

function hoursUntil(date: Date) {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / (60 * 60 * 1000)));
}
