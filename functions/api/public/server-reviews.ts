import { requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { getOptionalDiscordUser } from "../../_lib/public-auth";
import { getApprovedReviewSummary, getExistingActiveReview, viewerReviewState } from "../../_lib/server-reviews";
import type { Env, PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const url = new URL(request.url);
  const slug = sanitizeSlug(url.searchParams.get("slug"));
  if (!slug) return json({ error: "Missing server slug" }, { status: 400 });

  const server = await resolveServerBySlug(env, slug);
  if (!server) {
    return json({
      average_rating: 0,
      review_count: 0,
      rating_breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      reviews: [],
      viewer: { authenticated: false, can_review: false, reason: "server_not_found", cooldown_until: null, existing_review_id: null },
    });
  }

  const viewer = await getOptionalDiscordUser(request, env);
  const existingReview = viewer ? await getExistingActiveReview(env, server.id, viewer.discord_id) : null;
  const summary = await getApprovedReviewSummary(env, server.id, viewer);
  return json({
    ...applyServerReviewsAccess(summary, Boolean(viewer)),
    viewer: viewerReviewState({ viewer, serverOwnerUserId: server.user_id, existingReview }),
  });
};

async function resolveServerBySlug(env: Env, slug: string) {
  if (!env.DB) return null;
  const db = requireDb(env);
  return db
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE lower(public_slug) = ?
         AND lower(COALESCE(status, 'pending')) = 'live'
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(slug)
    .first<{ id: string; user_id: string }>();
}

function sanitizeSlug(value: string | null) {
  return value?.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90) || null;
}

export function applyServerReviewsAccess<T extends {
  reviews: unknown[];
}>(summary: T, viewerLoggedIn: boolean): T & {
  access_level: "full" | "preview";
  is_locked: boolean;
  locked_reason: string | null;
} {
  if (viewerLoggedIn) {
    return {
      ...summary,
      access_level: "full",
      is_locked: false,
      locked_reason: null,
    };
  }

  return {
    ...summary,
    reviews: [],
    access_level: "preview",
    is_locked: true,
    locked_reason: "Log in with Discord to unlock server reviews.",
  };
}
