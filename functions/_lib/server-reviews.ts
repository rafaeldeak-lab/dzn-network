import { requireDb } from "./db";
import { readPublicProfileLinksByDiscordIds, type PublicProfileLink } from "./player-public-profiles";
import { reviewCooldownUntil } from "./review-moderation";
import type { Env, SessionUser } from "./types";

export type ServerReviewRow = {
  id: string;
  linked_server_id: string;
  reviewer_discord_id: string;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  moderation_reason: string | null;
  report_count: number;
  moderation_version: number;
  owner_reply_body: string | null;
  owner_reply_author_name: string | null;
  owner_reply_created_at: string | null;
  owner_reply_updated_at: string | null;
  owner_reply_version: number;
  created_at: string;
  updated_at: string;
  last_edited_at: string | null;
};

export type PublicReviewSummary = {
  average_rating: number;
  review_count: number;
  rating_breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
  reviews: PublicReview[];
};

export type PublicReview = {
  id: string;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  rating: number;
  title: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  moderation_version: number;
  owner_reply_version: number;
  public_profile_handle: string | null;
  public_profile_href: string | null;
  owner_reply: PublicOwnerReply | null;
  is_own_review?: boolean;
};

export type PublicOwnerReply = {
  body: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicReviewAggregateRow = {
  average_rating: number | null;
  review_count: number | null;
  rating_1_count: number | null;
  rating_2_count: number | null;
  rating_3_count: number | null;
  rating_4_count: number | null;
  rating_5_count: number | null;
};

export function isServerReviewOwnerRepliesEnabled(env: Env) {
  return env.DZN_SERVER_REVIEW_OWNER_REPLIES_ENABLED?.trim().toLowerCase() === "true";
}

export async function ensureServerReviewsSchema(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_reviews (
        id TEXT PRIMARY KEY,
        linked_server_id TEXT NOT NULL,
        reviewer_discord_id TEXT NOT NULL,
        reviewer_name TEXT,
        reviewer_avatar_url TEXT,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        title TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'approved',
        moderation_reason TEXT,
        report_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_edited_at TEXT,
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_reviews_linked_server_id ON server_reviews(linked_server_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_reviews_reviewer_discord_id ON server_reviews(reviewer_discord_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_reviews_status ON server_reviews(status)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_reviews_created_at ON server_reviews(created_at)").run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_reviews_one_active_per_user
       ON server_reviews(linked_server_id, reviewer_discord_id)
       WHERE status != 'deleted'`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_review_reports (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        reporter_discord_id TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(review_id) REFERENCES server_reviews(id)
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_review_reports_one_per_user
       ON server_review_reports(review_id, reporter_discord_id)`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_review_reports_review_id ON server_review_reports(review_id)").run();
}

export async function getApprovedReviewSummary(env: Env, linkedServerId: string, viewer?: SessionUser | null): Promise<PublicReviewSummary> {
  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const ownerReplyColumns = selectOwnerReplyColumns(env);
  const [result, aggregate] = await Promise.all([
    db
      .prepare(
        `SELECT id, linked_server_id, reviewer_discord_id, reviewer_name, reviewer_avatar_url, rating,
              title, body, status, moderation_reason, report_count, moderation_version,
              ${ownerReplyColumns},
              created_at, updated_at, last_edited_at
       FROM server_reviews
       WHERE linked_server_id = ?
         AND status = 'approved'
       ORDER BY created_at DESC
       LIMIT 50`,
      )
      .bind(linkedServerId)
      .all<ServerReviewRow>(),
    db
      .prepare(
        `SELECT
          ROUND(AVG(rating), 1) AS average_rating,
          COUNT(*) AS review_count,
          COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) AS rating_1_count,
          COALESCE(SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END), 0) AS rating_2_count,
          COALESCE(SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END), 0) AS rating_3_count,
          COALESCE(SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END), 0) AS rating_4_count,
          COALESCE(SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END), 0) AS rating_5_count
         FROM server_reviews
         WHERE linked_server_id = ?
           AND status = 'approved'`,
      )
      .bind(linkedServerId)
      .first<PublicReviewAggregateRow>(),
  ]);

  const rows = result.results ?? [];
  const publicProfileLinksByDiscordId = await readPublicProfileLinksByDiscordIds(env, rows.map((row) => row.reviewer_discord_id));
  return {
    ...buildPublicReviewSummary(rows, viewer?.discord_id ?? null, publicProfileLinksByDiscordId),
    ...buildPublicReviewAggregateSummary(aggregate),
  };
}

export function buildPublicReviewAggregateSummary(aggregate?: PublicReviewAggregateRow | null): Omit<PublicReviewSummary, "reviews"> {
  const reviewCount = nonNegativeInteger(aggregate?.review_count);
  return {
    average_rating: reviewCount ? roundToSingleDecimal(aggregate?.average_rating) : 0,
    review_count: reviewCount,
    rating_breakdown: {
      1: nonNegativeInteger(aggregate?.rating_1_count),
      2: nonNegativeInteger(aggregate?.rating_2_count),
      3: nonNegativeInteger(aggregate?.rating_3_count),
      4: nonNegativeInteger(aggregate?.rating_4_count),
      5: nonNegativeInteger(aggregate?.rating_5_count),
    },
  };
}

export function buildPublicReviewSummary(
  rows: ServerReviewRow[],
  viewerDiscordId?: string | null,
  publicProfileLinksByDiscordId: ReadonlyMap<string, PublicProfileLink> = new Map(),
): PublicReviewSummary {
  const approved = rows.filter((row) => row.status === "approved");
  const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingTotal = 0;

  for (const row of approved) {
    const rating = clampRating(row.rating);
    breakdown[rating] += 1;
    ratingTotal += rating;
  }

  return {
    average_rating: approved.length ? Math.round((ratingTotal / approved.length) * 10) / 10 : 0,
    review_count: approved.length,
    rating_breakdown: breakdown,
    reviews: approved.map((row) => {
      const publicProfile = publicProfileLinksByDiscordId.get(row.reviewer_discord_id);
      return {
        id: row.id,
        reviewer_name: row.reviewer_name,
        reviewer_avatar_url: row.reviewer_avatar_url,
        rating: clampRating(row.rating),
        title: row.title,
        body: row.body,
        created_at: row.created_at,
        updated_at: row.updated_at,
        moderation_version: row.moderation_version,
        owner_reply_version: row.owner_reply_version,
        public_profile_handle: publicProfile?.handle ?? null,
        public_profile_href: publicProfile?.href ?? null,
        owner_reply: publicOwnerReply(row),
        is_own_review: Boolean(viewerDiscordId && row.reviewer_discord_id === viewerDiscordId),
      };
    }),
  };
}

export async function getExistingActiveReview(env: Env, linkedServerId: string, reviewerDiscordId: string) {
  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const ownerReplyColumns = selectOwnerReplyColumns(env);
  return db
    .prepare(
      `SELECT id, linked_server_id, reviewer_discord_id, reviewer_name, reviewer_avatar_url, rating,
              title, body, status, moderation_reason, report_count, moderation_version,
              ${ownerReplyColumns},
              created_at, updated_at, last_edited_at
       FROM server_reviews
       WHERE linked_server_id = ?
         AND reviewer_discord_id = ?
         AND status != 'deleted'
       LIMIT 1`,
    )
    .bind(linkedServerId, reviewerDiscordId)
    .first<ServerReviewRow>();
}

function selectOwnerReplyColumns(env: Env) {
  if (isServerReviewOwnerRepliesEnabled(env)) {
    return "owner_reply_body, owner_reply_author_name, owner_reply_created_at, owner_reply_updated_at, owner_reply_version";
  }
  return "NULL AS owner_reply_body, NULL AS owner_reply_author_name, NULL AS owner_reply_created_at, NULL AS owner_reply_updated_at, 0 AS owner_reply_version";
}

function publicOwnerReply(row: ServerReviewRow): PublicOwnerReply | null {
  if (!row.owner_reply_body || !row.owner_reply_created_at || !row.owner_reply_updated_at) return null;
  return {
    body: row.owner_reply_body,
    author_name: row.owner_reply_author_name,
    created_at: row.owner_reply_created_at,
    updated_at: row.owner_reply_updated_at,
  };
}

export function viewerReviewState(options: {
  viewer: SessionUser | null;
  serverOwnerUserId: string | null;
  existingReview?: ServerReviewRow | null;
  now?: Date;
}) {
  if (!options.viewer) {
    return { authenticated: false, can_review: false, reason: "login_required" as const, cooldown_until: null, existing_review_id: null };
  }
  if (options.serverOwnerUserId && options.serverOwnerUserId === options.viewer.id) {
    return { authenticated: true, can_review: false, reason: "owner" as const, cooldown_until: null, existing_review_id: options.existingReview?.id ?? null };
  }
  const cooldownUntil = reviewCooldownUntil(options.existingReview?.updated_at, options.now);
  if (cooldownUntil) {
    return { authenticated: true, can_review: false, reason: "cooldown" as const, cooldown_until: cooldownUntil, existing_review_id: options.existingReview?.id ?? null };
  }
  return { authenticated: true, can_review: true, reason: null, cooldown_until: null, existing_review_id: options.existingReview?.id ?? null };
}

function clampRating(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(Number(value) || 1))) as 1 | 2 | 3 | 4 | 5;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function roundToSingleDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : 0;
}
