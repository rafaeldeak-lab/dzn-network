import { ensureMockUser, getSessionUser, requireDb } from "../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { validateReviewInput } from "../../../_lib/review-moderation";
import { ensureServerReviewsSchema, getApprovedReviewSummary, getExistingActiveReview } from "../../../_lib/server-reviews";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type ReviewBody = {
  rating?: unknown;
  title?: unknown;
  body?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "POST") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Log in with Discord to leave a review." }, { status: 401 });

  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const validation = validateReviewInput(await readJson<ReviewBody>(request));
  if (!validation.ok) return json({ error: validation.error }, { status: 400 });

  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const server = await db
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
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
  if (existing) {
    await db
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
      .bind(user.username, avatarUrl, validation.value.rating, validation.value.title, validation.value.body, now, now, existing.id, linkedServerId, user.discord_id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO server_reviews (
          id, linked_server_id, reviewer_discord_id, reviewer_name, reviewer_avatar_url,
          rating, title, body, status, moderation_reason, report_count, created_at, updated_at, last_edited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', NULL, 0, ?, ?, NULL)`,
      )
      .bind(crypto.randomUUID(), linkedServerId, user.discord_id, user.username, avatarUrl, validation.value.rating, validation.value.title, validation.value.body, now, now)
      .run();
  }

  console.log("DZN SERVER REVIEWS READY");
  console.log("DZN REVIEW MODERATION ACTIVE");
  return json({ ok: true, reviews: await getApprovedReviewSummary(env, linkedServerId, user) });
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
