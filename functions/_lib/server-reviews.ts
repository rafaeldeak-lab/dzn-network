import { requireDb } from "./db";
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
  owner_reply_body: string | null;
  owner_reply_author_user_id: string | null;
  owner_reply_author_name: string | null;
  owner_reply_created_at: string | null;
  owner_reply_updated_at: string | null;
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
  owner_reply: PublicOwnerReviewReply | null;
  created_at: string;
  updated_at: string;
  is_own_review?: boolean;
};

export type PublicOwnerReviewReply = {
  body: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewModerationAction =
  | "player_review_created"
  | "player_review_updated"
  | "review_reported"
  | "review_auto_pending"
  | "owner_reply_upserted"
  | "owner_reply_removed";

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
        owner_reply_body TEXT,
        owner_reply_author_user_id TEXT,
        owner_reply_author_name TEXT,
        owner_reply_created_at TEXT,
        owner_reply_updated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_edited_at TEXT,
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await ensureServerReviewsColumn(env, "owner_reply_body", "TEXT");
  await ensureServerReviewsColumn(env, "owner_reply_author_user_id", "TEXT");
  await ensureServerReviewsColumn(env, "owner_reply_author_name", "TEXT");
  await ensureServerReviewsColumn(env, "owner_reply_created_at", "TEXT");
  await ensureServerReviewsColumn(env, "owner_reply_updated_at", "TEXT");
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

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_review_moderation_actions (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        linked_server_id TEXT NOT NULL,
        actor_user_id TEXT,
        actor_discord_id TEXT,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(review_id) REFERENCES server_reviews(id),
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_review_moderation_actions_review_id ON server_review_moderation_actions(review_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_review_moderation_actions_linked_server_id ON server_review_moderation_actions(linked_server_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_review_moderation_actions_created_at ON server_review_moderation_actions(created_at)").run();
}

export async function getApprovedReviewSummary(env: Env, linkedServerId: string, viewer?: SessionUser | null): Promise<PublicReviewSummary> {
  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT id, linked_server_id, reviewer_discord_id, reviewer_name, reviewer_avatar_url, rating,
              title, body, status, moderation_reason, report_count,
              owner_reply_body, owner_reply_author_user_id, owner_reply_author_name, owner_reply_created_at, owner_reply_updated_at,
              created_at, updated_at, last_edited_at
       FROM server_reviews
       WHERE linked_server_id = ?
         AND status = 'approved'
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .bind(linkedServerId)
    .all<ServerReviewRow>();

  return buildPublicReviewSummary(result.results ?? [], viewer?.discord_id ?? null);
}

export function buildPublicReviewSummary(rows: ServerReviewRow[], viewerDiscordId?: string | null): PublicReviewSummary {
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
    reviews: approved.map((row) => ({
      id: row.id,
      reviewer_name: row.reviewer_name,
      reviewer_avatar_url: row.reviewer_avatar_url,
      rating: clampRating(row.rating),
      title: row.title,
      body: row.body,
      owner_reply: publicOwnerReply(row),
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_own_review: Boolean(viewerDiscordId && row.reviewer_discord_id === viewerDiscordId),
    })),
  };
}

export async function getExistingActiveReview(env: Env, linkedServerId: string, reviewerDiscordId: string) {
  await ensureServerReviewsSchema(env);
  const db = requireDb(env);
  return db
    .prepare(
      `SELECT id, linked_server_id, reviewer_discord_id, reviewer_name, reviewer_avatar_url, rating,
              title, body, status, moderation_reason, report_count,
              owner_reply_body, owner_reply_author_user_id, owner_reply_author_name, owner_reply_created_at, owner_reply_updated_at,
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

export async function recordReviewModerationAction(env: Env, input: {
  reviewId: string;
  linkedServerId: string;
  actor: SessionUser | null;
  actorRole: "player" | "owner" | "admin" | "system";
  action: ReviewModerationAction;
  reason?: string | null;
  createdAt?: string;
}) {
  await ensureServerReviewsSchema(env);
  await requireDb(env)
    .prepare(
      `INSERT INTO server_review_moderation_actions (
        id, review_id, linked_server_id, actor_user_id, actor_discord_id, actor_role, action, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.reviewId,
      input.linkedServerId,
      input.actor?.id ?? null,
      input.actor?.discord_id ?? null,
      input.actorRole,
      input.action,
      input.reason ?? null,
      input.createdAt ?? new Date().toISOString(),
    )
    .run();
}

async function ensureServerReviewsColumn(env: Env, columnName: string, definition: string) {
  const db = requireDb(env);
  const result = await db.prepare("PRAGMA table_info(server_reviews)").all<{ name: string }>();
  const existing = new Set((result.results ?? []).map((row) => row.name));
  if (!existing.has(columnName)) {
    await db.prepare(`ALTER TABLE server_reviews ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function publicOwnerReply(row: ServerReviewRow): PublicOwnerReviewReply | null {
  if (!row.owner_reply_body || !row.owner_reply_created_at || !row.owner_reply_updated_at) return null;
  return {
    body: row.owner_reply_body,
    author_name: row.owner_reply_author_name,
    created_at: row.owner_reply_created_at,
    updated_at: row.owner_reply_updated_at,
  };
}

function clampRating(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(Number(value) || 1))) as 1 | 2 | 3 | 4 | 5;
}
