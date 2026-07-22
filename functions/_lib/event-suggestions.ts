import { requireDb } from "./db";
import { creatorEventAdminDeniedPayload, isPlatformCreatorEventAdmin } from "./platform-creator";
import type { Env, SessionUser } from "./types";

export const SUGGESTION_PUBLIC_STATUSES = ["public_voting", "shortlisted", "accepted", "converted_to_event"] as const;
export const SUGGESTION_SORTS = ["trending", "newest", "most_supported", "most_discussed"] as const;

export type EventSuggestionSort = typeof SUGGESTION_SORTS[number];

export type EventSuggestionInput = {
  title?: string | null;
  description?: string | null;
  competition_format?: string | null;
  platform?: string | null;
  map_name?: string | null;
  suggested_server_id?: string | null;
  open_to_any_server?: boolean | number | string | null;
  suggested_date_start?: string | null;
  suggested_date_end?: string | null;
  structure_notes?: string | null;
  additional_notes?: string | null;
};

export type EventSuggestionModerationAction =
  | "approve_public_voting"
  | "request_revision"
  | "shortlist"
  | "accept"
  | "reject"
  | "archive"
  | "restore";

type SuggestionRow = {
  id: string;
  submitted_by_user_id: string;
  title: string;
  description: string;
  normalized_title: string;
  content_fingerprint: string;
  competition_format: string;
  platform: string;
  map_name: string | null;
  suggested_server_id: string | null;
  open_to_any_server: number | null;
  suggested_date_start: string | null;
  suggested_date_end: string | null;
  structure_notes: string | null;
  moderation_status: string;
  public_status: string;
  creator_decision: string | null;
  converted_event_id: string | null;
  creator_response: string | null;
  upvote_count: number | null;
  downvote_count: number | null;
  report_count: number | null;
  hot_score: number | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  moderated_at: string | null;
  converted_event_slug?: string | null;
};

type VoteRow = {
  vote_value: number | null;
  updated_at: string | null;
};

type ModerationTarget = {
  moderation_status: string;
  public_status: string;
  creator_decision: string | null;
};

const SUGGESTION_SELECT_COLUMNS = `
  event_suggestions.id,
  event_suggestions.submitted_by_user_id,
  event_suggestions.title,
  event_suggestions.description,
  event_suggestions.normalized_title,
  event_suggestions.content_fingerprint,
  event_suggestions.competition_format,
  event_suggestions.platform,
  event_suggestions.map_name,
  event_suggestions.suggested_server_id,
  event_suggestions.open_to_any_server,
  event_suggestions.suggested_date_start,
  event_suggestions.suggested_date_end,
  event_suggestions.structure_notes,
  event_suggestions.moderation_status,
  event_suggestions.public_status,
  event_suggestions.creator_decision,
  event_suggestions.converted_event_id,
  event_suggestions.creator_response,
  event_suggestions.upvote_count,
  event_suggestions.downvote_count,
  event_suggestions.report_count,
  event_suggestions.hot_score,
  event_suggestions.created_at,
  event_suggestions.updated_at,
  event_suggestions.published_at,
  event_suggestions.moderated_at,
  competitive_events.slug AS converted_event_slug
`;

const REQUIRED_SUGGESTION_TABLES: Record<string, readonly string[]> = {
  event_suggestions: [
    "id",
    "submitted_by_user_id",
    "title",
    "description",
    "normalized_title",
    "content_fingerprint",
    "competition_format",
    "platform",
    "moderation_status",
    "public_status",
    "converted_event_id",
    "upvote_count",
    "downvote_count",
    "report_count",
    "hot_score",
    "created_at",
    "updated_at",
  ],
  event_suggestion_votes: ["suggestion_id", "user_id", "vote_value", "created_at", "updated_at"],
  event_suggestion_reports: ["id", "suggestion_id", "reporter_user_id", "reason", "status", "created_at"],
  event_suggestion_moderation_actions: ["id", "suggestion_id", "actor_user_id", "action", "created_at"],
  competitive_events: ["id", "name", "slug", "description", "category", "event_type", "status", "visibility", "created_by"],
  competitive_event_activity: ["id", "event_id", "server_id", "activity_type", "message", "metadata", "created_at"],
};

const COMPETITION_FORMATS = new Set([
  "server_vs_server",
  "player_vs_player",
  "clan_squad",
  "stat_race",
  "community_challenge",
  "manual_referee",
]);

const PLATFORMS = new Set(["playstation", "xbox", "pc", "cross_platform", "unsure"]);
const REPORT_REASONS = new Set(["spam", "abuse", "duplicate", "unsafe_content", "personal_information", "other"]);

const BLOCKED_TERMS = [
  "nigger",
  "faggot",
  "retard",
  "kike",
  "coon",
  "rape",
  "kill yourself",
  "dox",
  "doxx",
  "swat",
];

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "!": "i",
};

export async function listPublicEventSuggestions(env: Env, options: { sort?: string | null; limit?: number | string | null; cursor?: string | null } = {}) {
  if (!env.DB) {
    return {
      ok: true,
      suggestions: demoSuggestions(),
      nextCursor: null,
      generatedAt: new Date().toISOString(),
      source: "display_fallback",
    };
  }
  const schema = await validateEventSuggestionSchema(env);
  if (!schema.ok) return schema;
  const limit = sanitizeLimit(options.limit, 20, 100);
  const sort = normalizeSort(options.sort);
  const cursor = parseCursor(options.cursor);
  const db = requireDb(env);
  const statuses = SUGGESTION_PUBLIC_STATUSES.map(() => "?").join(", ");
  const bindings: unknown[] = [...SUGGESTION_PUBLIC_STATUSES];
  const cursorWhere = cursor ? "AND (datetime(event_suggestions.created_at) < datetime(?) OR (event_suggestions.created_at = ? AND event_suggestions.id < ?))" : "";
  if (cursor) bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  const orderBy = suggestionOrderBy(sort);
  const rows = await db
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       WHERE event_suggestions.public_status IN (${statuses})
       ${cursorWhere}
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
    .bind(...bindings, limit + 1)
    .all<SuggestionRow>();
  const resultRows = rows.results ?? [];
  const pageRows = resultRows.slice(0, limit);
  return {
    ok: true,
    suggestions: pageRows.map(toPublicSuggestion),
    nextCursor: resultRows.length > limit ? makeCursor(pageRows[pageRows.length - 1]) : null,
    generatedAt: new Date().toISOString(),
    source: "live",
    sort,
    pageSize: limit,
  };
}

export async function createEventSuggestion(env: Env, user: SessionUser | null, input: EventSuggestionInput) {
  if (!user) return { ok: false, status: 401, error: "UNAUTHORIZED", message: "Log in with Discord to submit a suggestion." };
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const validation = await validateSuggestionInput(input);
  if (!validation.ok) return validation;
  const db = requireDb(env);
  const [duplicate, recent, today, recentTitles] = await Promise.all([
    db.prepare("SELECT id FROM event_suggestions WHERE content_fingerprint = ? LIMIT 1").bind(validation.value.contentFingerprint).first<{ id: string }>(),
    db.prepare("SELECT created_at FROM event_suggestions WHERE submitted_by_user_id = ? ORDER BY datetime(created_at) DESC LIMIT 1").bind(user.id).first<{ created_at: string }>(),
    db.prepare("SELECT COUNT(*) AS count FROM event_suggestions WHERE submitted_by_user_id = ? AND datetime(created_at) >= datetime('now', '-1 day')").bind(user.id).first<{ count: number | null }>(),
    db.prepare("SELECT normalized_title FROM event_suggestions WHERE submitted_by_user_id = ? ORDER BY datetime(created_at) DESC LIMIT 20").bind(user.id).all<{ normalized_title: string }>(),
  ]);
  if (duplicate) return { ok: false, status: 409, error: "DUPLICATE_SUGGESTION", message: "A similar suggestion is already in review." };
  if ((recentTitles.results ?? []).some((row) => nearDuplicateScore(row.normalized_title, validation.value.normalizedTitle) >= 0.86)) {
    return { ok: false, status: 409, error: "NEAR_DUPLICATE_SUGGESTION", message: "A similar suggestion is already in review." };
  }
  if (recent && Date.now() - Date.parse(recent.created_at) < 10 * 60 * 1000) {
    return { ok: false, status: 429, error: "SUBMISSION_COOLDOWN", message: "Wait before submitting another suggestion." };
  }
  if (Number(today?.count ?? 0) >= 3) {
    return { ok: false, status: 429, error: "DAILY_LIMIT_REACHED", message: "Daily suggestion limit reached." };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO event_suggestions (
        id, submitted_by_user_id, title, description, normalized_title, content_fingerprint,
        competition_format, platform, map_name, suggested_server_id, open_to_any_server,
        suggested_date_start, suggested_date_end, structure_notes, moderation_status,
        public_status, hot_score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_moderation', 'submitted', 0, ?, ?)`,
    )
    .bind(
      id,
      user.id,
      validation.value.title,
      validation.value.description,
      validation.value.normalizedTitle,
      validation.value.contentFingerprint,
      validation.value.competitionFormat,
      validation.value.platform,
      validation.value.mapName,
      validation.value.suggestedServerId,
      validation.value.openToAnyServer ? 1 : 0,
      validation.value.suggestedDateStart,
      validation.value.suggestedDateEnd,
      validation.value.structureNotes,
      now,
      now,
    )
    .run();

  return {
    ok: true,
    status: 200,
    suggestion: {
      id,
      title: validation.value.title,
      moderationStatus: "pending_moderation",
      publicStatus: "submitted",
    },
    message: "Suggestion submitted for creator moderation.",
  };
}

export async function voteOnEventSuggestion(env: Env, user: SessionUser | null, suggestionId: string, voteValue: unknown) {
  if (!user) return { ok: false, status: 401, error: "UNAUTHORIZED", message: "Log in with Discord to vote." };
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const normalizedVote = Number(voteValue) === -1 ? -1 : Number(voteValue) === 1 ? 1 : 0;
  if (!normalizedVote) return { ok: false, status: 400, error: "INVALID_VOTE", message: "Vote must be 1 or -1." };
  const db = requireDb(env);
  const suggestion = await db.prepare("SELECT id, submitted_by_user_id, public_status, created_at FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<SuggestionRow>();
  if (!suggestion) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  if (!SUGGESTION_PUBLIC_STATUSES.includes(suggestion.public_status as typeof SUGGESTION_PUBLIC_STATUSES[number])) {
    return { ok: false, status: 409, error: "SUGGESTION_NOT_PUBLIC", message: "Suggestion is not open for public voting." };
  }
  if (suggestion.submitted_by_user_id === user.id) {
    return { ok: false, status: 403, error: "SELF_VOTE_DENIED", message: "Self-voting is disabled for suggestions." };
  }
  const existing = await db.prepare("SELECT vote_value, updated_at FROM event_suggestion_votes WHERE suggestion_id = ? AND user_id = ? LIMIT 1").bind(suggestionId, user.id).first<VoteRow>();
  if (existing?.updated_at && Date.now() - Date.parse(existing.updated_at) < 1500) {
    return { ok: false, status: 429, error: "VOTE_RATE_LIMITED", message: "Wait briefly before changing your vote." };
  }
  if (Number(existing?.vote_value) === normalizedVote) {
    await db.prepare("DELETE FROM event_suggestion_votes WHERE suggestion_id = ? AND user_id = ?").bind(suggestionId, user.id).run();
  } else {
    await db
      .prepare(
        `INSERT INTO event_suggestion_votes (suggestion_id, user_id, vote_value, created_at, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(suggestion_id, user_id) DO UPDATE SET
           vote_value = excluded.vote_value,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(suggestionId, user.id, normalizedVote)
      .run();
  }
  const counts = await refreshSuggestionCounters(env, suggestionId, suggestion.created_at);
  return { ok: true, status: 200, suggestionId, userVote: Number(existing?.vote_value) === normalizedVote ? 0 : normalizedVote, ...counts };
}

export async function reportEventSuggestion(env: Env, user: SessionUser | null, suggestionId: string, input: { reason?: string | null; note?: string | null }) {
  if (!user) return { ok: false, status: 401, error: "UNAUTHORIZED", message: "Log in with Discord to report a suggestion." };
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const reason = normalizeEnum(input.reason, REPORT_REASONS) ?? "other";
  const note = sanitizePlainText(input.note, 280);
  const db = requireDb(env);
  const suggestion = await db.prepare("SELECT id, created_at FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<SuggestionRow>();
  if (!suggestion) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  const existingReport = await db
    .prepare("SELECT id FROM event_suggestion_reports WHERE suggestion_id = ? AND reporter_user_id = ? AND status = 'open' LIMIT 1")
    .bind(suggestionId, user.id)
    .first<{ id: string }>();
  if (existingReport) {
    const counts = await refreshSuggestionCounters(env, suggestionId, suggestion.created_at);
    return { ok: true, status: 200, suggestionId, reportCount: counts.reportCount, idempotent: true };
  }
  await db
    .prepare(
      `INSERT INTO event_suggestion_reports (id, suggestion_id, reporter_user_id, reason, safe_note, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
    )
    .bind(crypto.randomUUID(), suggestionId, user.id, reason, note || null)
    .run();
  const counts = await refreshSuggestionCounters(env, suggestionId, suggestion.created_at);
  return { ok: true, status: 200, suggestionId, reportCount: counts.reportCount };
}

export async function listOwnerEventSuggestions(env: Env, user: SessionUser | null, options: { status?: string | null; limit?: number | string | null } = {}) {
  if (!user) return { ok: false, status: 401, error: "UNAUTHORIZED" };
  if (!env.DB) return { ok: true, status: 200, creatorEventAdmin: isPlatformCreatorEventAdmin(user, env), suggestions: [], generatedAt: new Date().toISOString() };
  const schema = await validateEventSuggestionSchema(env);
  if (!schema.ok) return schema;
  const creatorEventAdmin = isPlatformCreatorEventAdmin(user, env);
  const limit = sanitizeLimit(options.limit, 30, 100);
  const status = sanitizePlainText(options.status, 40);
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (status && status !== "all") {
    conditions.push("(moderation_status = ? OR public_status = ?)");
    bindings.push(status, status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await requireDb(env)
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       ${where}
       ORDER BY datetime(event_suggestions.updated_at) DESC, event_suggestions.id DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit)
    .all<SuggestionRow>();
  return {
    ok: true,
    status: 200,
    creatorEventAdmin,
    suggestions: (rows.results ?? []).map(toOwnerSuggestion),
    generatedAt: new Date().toISOString(),
  };
}

export async function moderateEventSuggestion(
  env: Env,
  user: SessionUser | null,
  suggestionId: string,
  input: { action?: string | null; reason?: string | null; creator_response?: string | null },
) {
  const creatorDenied = creatorEventAdminDeniedPayload(env, user);
  if (creatorDenied) return creatorDenied;
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const action = String(input.action ?? "").trim() as EventSuggestionModerationAction;
  const target = moderationTarget(action);
  if (!target) return { ok: false, status: 400, error: "INVALID_MODERATION_ACTION", message: "Unsupported moderation action." };
  const reason = sanitizePlainText(input.reason, 500);
  if (requiresReason(action) && reason.length < 6) {
    return { ok: false, status: 400, error: "REASON_REQUIRED", message: "A safe moderation reason is required." };
  }
  const creatorResponse = sanitizePlainText(input.creator_response, 600);
  const db = requireDb(env);
  const existing = await db.prepare("SELECT id, moderation_status, public_status FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<SuggestionRow>();
  if (!existing) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  const idempotent = existing.moderation_status === target.moderation_status && existing.public_status === target.public_status;
  if (!idempotent) {
    await db
      .prepare(
        `UPDATE event_suggestions
         SET moderation_status = ?,
             public_status = ?,
             creator_decision = ?,
             creator_response = COALESCE(NULLIF(?, ''), creator_response),
             published_at = CASE WHEN ? = 'public_voting' AND published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END,
             moderated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(target.moderation_status, target.public_status, target.creator_decision, creatorResponse, target.public_status, suggestionId)
      .run();
  }
  await insertSuggestionModerationAction(env, suggestionId, user!.id, action, existing.moderation_status, target.moderation_status, reason || creatorResponse || "status update");
  const updated = await db
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       WHERE event_suggestions.id = ?
       LIMIT 1`,
    )
    .bind(suggestionId)
    .first<SuggestionRow>();
  return { ok: true, status: 200, idempotent, suggestion: updated ? toOwnerSuggestion(updated) : null };
}

export async function convertSuggestionToEventDraft(env: Env, user: SessionUser | null, suggestionId: string, input: { reason?: string | null } = {}) {
  const creatorDenied = creatorEventAdminDeniedPayload(env, user);
  if (creatorDenied) return creatorDenied;
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: true });
  if (!schema.ok) return schema;
  const db = requireDb(env);
  const suggestion = await db
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       WHERE event_suggestions.id = ?
       LIMIT 1`,
    )
    .bind(suggestionId)
    .first<SuggestionRow>();
  if (!suggestion) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  if (suggestion.converted_event_id) {
    const existing = await db.prepare("SELECT id, slug FROM competitive_events WHERE id = ? LIMIT 1").bind(suggestion.converted_event_id).first<{ id: string; slug: string }>();
    return {
      ok: true,
      status: 200,
      idempotent: true,
      eventId: suggestion.converted_event_id,
      eventSlug: existing?.slug ?? null,
      message: "Suggestion was already converted to an event draft.",
    };
  }
  if (!["shortlisted", "accepted"].includes(suggestion.public_status) && !["shortlisted", "accepted"].includes(suggestion.moderation_status)) {
    return { ok: false, status: 409, error: "SUGGESTION_NOT_ACCEPTED", message: "Only shortlisted or accepted suggestions can become official drafts." };
  }
  const eventId = crypto.randomUUID();
  const slug = await makeUniqueDraftSlug(env, cleanSlug(suggestion.title) || "community-suggestion");
  const category = defaultDraftCategory(suggestion.competition_format);
  const eventType = draftEventType(suggestion.competition_format);
  const description = `${suggestion.description}\n\nConverted from community suggestion. Creator review required before publication.`.slice(0, 1200);
  const reason = sanitizePlainText(input.reason, 500) || "creator conversion";
  await db.batch([
    db
      .prepare(
        `INSERT INTO competitive_events (
          id, name, slug, description, category, event_type, status, visibility, premium_tier,
          starts_at, ends_at, created_by, rules, rewards, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 'private', 'pro', ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        eventId,
        suggestion.title,
        slug,
        description,
        category,
        eventType,
        suggestion.suggested_date_start,
        suggestion.suggested_date_end,
        user!.id,
        "Draft converted from community suggestion. Final rules must be reviewed and locked by the platform creator.",
      ),
    db
      .prepare(
        `UPDATE event_suggestions
         SET converted_event_id = ?,
             public_status = 'converted_to_event',
             moderation_status = 'converted_to_event',
             creator_decision = 'converted_to_event',
             moderated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND converted_event_id IS NULL`,
      )
      .bind(eventId, suggestionId),
    db
      .prepare(
        `INSERT INTO competitive_event_activity (id, event_id, server_id, activity_type, message, metadata, created_at)
         VALUES (?, ?, NULL, 'suggestion_converted_to_draft', ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(crypto.randomUUID(), eventId, `Community suggestion converted to draft: ${suggestion.title}.`, JSON.stringify({ suggestion_id: suggestionId })),
    db
      .prepare(
        `INSERT INTO event_suggestion_moderation_actions (id, suggestion_id, actor_user_id, action, previous_status, new_status, safe_reason, created_at)
         VALUES (?, ?, ?, 'convert_to_event_draft', ?, 'converted_to_event', ?, CURRENT_TIMESTAMP)`,
      )
      .bind(crypto.randomUUID(), suggestionId, user!.id, suggestion.moderation_status, reason),
  ]);
  return { ok: true, status: 200, idempotent: false, eventId, eventSlug: slug, message: "Suggestion converted to a private event draft." };
}

export async function validateEventSuggestionSchema(env: Env, options: { conversion?: boolean } = {}) {
  if (!env.DB) return { ok: false as const, status: 503, error: "D1_UNAVAILABLE", message: "D1 DB binding is not configured." };
  const requiredTables = options.conversion === false
    ? Object.fromEntries(Object.entries(REQUIRED_SUGGESTION_TABLES).filter(([table]) => !["competitive_events", "competitive_event_activity"].includes(table)))
    : REQUIRED_SUGGESTION_TABLES;
  const missing: string[] = [];
  const db = requireDb(env);
  for (const [table, columns] of Object.entries(requiredTables)) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const names = new Set((info.results ?? []).map((row) => row.name));
    if (names.size === 0) {
      missing.push(table);
      continue;
    }
    for (const column of columns) {
      if (!names.has(column)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length) {
    return {
      ok: false as const,
      status: 500,
      error: "EVENT_SUGGESTIONS_SCHEMA_NOT_READY",
      errorCode: "EVENT_SUGGESTIONS_SCHEMA_NOT_READY",
      message: "Event suggestion storage is not ready.",
      missingCount: missing.length,
    };
  }
  return { ok: true as const };
}

export async function validateSuggestionInput(input: EventSuggestionInput) {
  const rawCombined = [input.title, input.description, input.structure_notes, input.additional_notes].map((value) => String(value ?? "")).join("\n");
  const rawModeration = moderateSuggestionContent(rawCombined);
  if (!rawModeration.ok) return { ok: false as const, status: 422, error: rawModeration.reason, message: "Suggestion content requires revision before review." };
  const title = sanitizePlainText(input.title, 90);
  if (title.length < 8) return { ok: false as const, status: 400, error: "TITLE_TOO_SHORT", message: "Title must be at least 8 characters." };
  const description = sanitizePlainText(input.description, 2400);
  const words = description.split(/\s+/).filter(Boolean).length;
  if (words < 40 || words > 250) return { ok: false as const, status: 400, error: "DESCRIPTION_WORD_COUNT", message: "Description must be 40 to 250 words." };
  const structureNotes = sanitizePlainText([input.structure_notes, input.additional_notes].filter(Boolean).join("\n"), 1000);
  const combined = `${title}\n${description}\n${structureNotes}`;
  const moderation = moderateSuggestionContent(combined);
  if (!moderation.ok) return { ok: false as const, status: 422, error: moderation.reason, message: "Suggestion content requires revision before review." };
  const competitionFormat = normalizeEnum(input.competition_format, COMPETITION_FORMATS);
  if (!competitionFormat) return { ok: false as const, status: 400, error: "INVALID_COMPETITION_FORMAT", message: "Competition format is not supported." };
  const platform = normalizeEnum(input.platform, PLATFORMS);
  if (!platform) return { ok: false as const, status: 400, error: "INVALID_PLATFORM", message: "Platform is not supported." };
  const mapName = sanitizePlainText(input.map_name, 80) || null;
  const suggestedServerId = sanitizeIdentifier(input.suggested_server_id);
  const openToAnyServer = parseBoolean(input.open_to_any_server, !suggestedServerId);
  const suggestedDateStart = sanitizeDate(input.suggested_date_start);
  const suggestedDateEnd = sanitizeDate(input.suggested_date_end);
  if (suggestedDateStart && suggestedDateEnd && Date.parse(suggestedDateEnd) < Date.parse(suggestedDateStart)) {
    return { ok: false as const, status: 400, error: "INVALID_DATE_RANGE", message: "Preferred end date must be after the start date." };
  }
  const normalizedTitle = normalizeSuggestionText(title);
  const contentFingerprint = await fingerprintContent(`${normalizedTitle}\n${normalizeSuggestionText(description)}`);
  return {
    ok: true as const,
    value: {
      title,
      description,
      normalizedTitle,
      contentFingerprint,
      competitionFormat,
      platform,
      mapName,
      suggestedServerId,
      openToAnyServer,
      suggestedDateStart,
      suggestedDateEnd,
      structureNotes: structureNotes || null,
    },
  };
}

export function moderateSuggestionContent(value: string) {
  const normalized = normalizeSuggestionText(value);
  if (/<[a-z][\s\S]*>/i.test(value)) return { ok: false as const, reason: "HTML_NOT_ALLOWED" };
  if (/@everyone|@here/i.test(value)) return { ok: false as const, reason: "MASS_MENTION_NOT_ALLOWED" };
  if (/<@&?\d{5,32}>|<#\d{5,32}>/.test(value)) return { ok: false as const, reason: "RAW_DISCORD_MENTION_NOT_ALLOWED" };
  if (/discord(?:\.gg|\.com\/invite)\//i.test(value)) return { ok: false as const, reason: "DISCORD_INVITE_NOT_ALLOWED" };
  if (/https?:\/\/|www\./i.test(value)) return { ok: false as const, reason: "URL_NOT_ALLOWED" };
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return { ok: false as const, reason: "PERSONAL_INFORMATION_NOT_ALLOWED" };
  if (/\+?\d[\d\s().-]{8,}\d/.test(value)) return { ok: false as const, reason: "PERSONAL_INFORMATION_NOT_ALLOWED" };
  if (/(.)\1{8,}/i.test(normalized)) return { ok: false as const, reason: "SPAM_PATTERN" };
  for (const term of BLOCKED_TERMS) {
    if (normalized.includes(normalizeSuggestionText(term))) return { ok: false as const, reason: "BLOCKED_LANGUAGE" };
  }
  return { ok: true as const };
}

export function normalizeSuggestionText(value: string) {
  const stripped = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (char) => LEET_MAP[char] ?? char)
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[\s._\-|/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

export function computeSuggestionHotScore(input: { upvotes: number; downvotes: number; reports: number; createdAt?: string | null }) {
  const up = Math.max(0, Math.trunc(input.upvotes));
  const down = Math.max(0, Math.trunc(input.downvotes));
  const total = up + down;
  const ratio = total ? up / total : 0;
  const ageHours = input.createdAt && Number.isFinite(Date.parse(input.createdAt))
    ? Math.max(1, (Date.now() - Date.parse(input.createdAt)) / 3_600_000)
    : 1;
  const volume = Math.log10(total + 1);
  const recency = 1 / Math.pow(ageHours, 0.28);
  const reportPenalty = Math.min(0.65, Math.max(0, input.reports) * 0.08);
  return Math.round((ratio * 0.55 + volume * 0.35 + recency * 0.1 - reportPenalty) * 10000) / 10000;
}

async function refreshSuggestionCounters(env: Env, suggestionId: string, createdAt?: string | null) {
  const db = requireDb(env);
  const [votes, reports] = await Promise.all([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
           SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes
         FROM event_suggestion_votes
         WHERE suggestion_id = ?`,
      )
      .bind(suggestionId)
      .first<{ upvotes: number | null; downvotes: number | null }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM event_suggestion_reports WHERE suggestion_id = ? AND status = 'open'")
      .bind(suggestionId)
      .first<{ count: number | null }>(),
  ]);
  const upvoteCount = Number(votes?.upvotes ?? 0);
  const downvoteCount = Number(votes?.downvotes ?? 0);
  const reportCount = Number(reports?.count ?? 0);
  const hotScore = computeSuggestionHotScore({ upvotes: upvoteCount, downvotes: downvoteCount, reports: reportCount, createdAt });
  await db
    .prepare(
      `UPDATE event_suggestions
       SET upvote_count = ?, downvote_count = ?, report_count = ?, hot_score = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(upvoteCount, downvoteCount, reportCount, hotScore, suggestionId)
    .run();
  return { upvoteCount, downvoteCount, reportCount, netScore: upvoteCount - downvoteCount, hotScore };
}

async function insertSuggestionModerationAction(
  env: Env,
  suggestionId: string,
  actorUserId: string,
  action: string,
  previousStatus: string | null,
  newStatus: string | null,
  safeReason: string | null,
) {
  await requireDb(env)
    .prepare(
      `INSERT INTO event_suggestion_moderation_actions (id, suggestion_id, actor_user_id, action, previous_status, new_status, safe_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(crypto.randomUUID(), suggestionId, actorUserId, action, previousStatus, newStatus, sanitizePlainText(safeReason, 500) || null)
    .run();
}

function moderationTarget(action: string): ModerationTarget | null {
  switch (action) {
    case "approve_public_voting":
      return { moderation_status: "public_voting", public_status: "public_voting", creator_decision: "approved_for_voting" };
    case "request_revision":
      return { moderation_status: "revision_requested", public_status: "revision_requested", creator_decision: "revision_requested" };
    case "shortlist":
      return { moderation_status: "shortlisted", public_status: "shortlisted", creator_decision: "shortlisted" };
    case "accept":
      return { moderation_status: "accepted", public_status: "accepted", creator_decision: "accepted" };
    case "reject":
      return { moderation_status: "rejected", public_status: "rejected", creator_decision: "rejected" };
    case "archive":
      return { moderation_status: "archived", public_status: "archived", creator_decision: "archived" };
    case "restore":
      return { moderation_status: "pending_moderation", public_status: "submitted", creator_decision: "restored" };
    default:
      return null;
  }
}

function requiresReason(action: string) {
  return ["request_revision", "reject", "archive", "restore"].includes(action);
}

function toPublicSuggestion(row: SuggestionRow) {
  const upvotes = Number(row.upvote_count ?? 0);
  const downvotes = Number(row.downvote_count ?? 0);
  const total = upvotes + downvotes;
  return {
    id: row.id,
    title: row.title,
    description: summarizeDescription(row.description),
    competitionFormat: row.competition_format,
    platform: row.platform,
    mapName: row.map_name,
    suggestedServerScope: row.open_to_any_server ? "open_to_any_server" : "specific_server",
    status: row.public_status,
    creatorResponse: row.creator_response,
    convertedEventId: row.converted_event_id,
    convertedEventSlug: row.converted_event_slug ?? null,
    upvotes,
    downvotes,
    netScore: upvotes - downvotes,
    votePercentage: total ? Math.round((upvotes / total) * 100) : null,
    reportCount: Number(row.report_count ?? 0),
    hotScore: Number(row.hot_score ?? 0),
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOwnerSuggestion(row: SuggestionRow) {
  return {
    ...toPublicSuggestion(row),
    description: row.description,
    moderationStatus: row.moderation_status,
    publicStatus: row.public_status,
    creatorDecision: row.creator_decision,
    suggestedDateStart: row.suggested_date_start,
    suggestedDateEnd: row.suggested_date_end,
    structureNotes: row.structure_notes,
    submittedBy: maskInternalUserRef(row.submitted_by_user_id),
    moderatedAt: row.moderated_at,
  };
}

function sanitizePlainText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeEnum(value: unknown, allowed: Set<string>) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.has(normalized) ? normalized : null;
}

function sanitizeIdentifier(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{3,96}$/.test(text) ? text : null;
}

function sanitizeDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

function sanitizeLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function normalizeSort(value: unknown): EventSuggestionSort {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SUGGESTION_SORTS.includes(normalized as EventSuggestionSort) ? normalized as EventSuggestionSort : "trending";
}

function nearDuplicateScore(left: string, right: string) {
  const leftTerms = new Set(normalizeSuggestionText(left).split(" ").filter(Boolean));
  const rightTerms = new Set(normalizeSuggestionText(right).split(" ").filter(Boolean));
  if (!leftTerms.size || !rightTerms.size) return 0;
  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) overlap += 1;
  }
  return overlap / Math.max(leftTerms.size, rightTerms.size);
}

function suggestionOrderBy(sort: EventSuggestionSort) {
  if (sort === "newest") return "datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
  if (sort === "most_supported") return "(event_suggestions.upvote_count - event_suggestions.downvote_count) DESC, event_suggestions.upvote_count DESC, datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
  if (sort === "most_discussed") return "event_suggestions.report_count DESC, datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
  return "event_suggestions.hot_score DESC, datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
}

function makeCursor(row: SuggestionRow | undefined) {
  if (!row) return null;
  return `${encodeURIComponent(row.created_at)}|${encodeURIComponent(row.id)}`;
}

function parseCursor(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || !text.includes("|")) return null;
  const [createdAtRaw, idRaw] = text.split("|", 2);
  const createdAt = decodeURIComponent(createdAtRaw ?? "");
  const id = decodeURIComponent(idRaw ?? "");
  if (!createdAt || !id || !Number.isFinite(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

async function fingerprintContent(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanSlug(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function makeUniqueDraftSlug(env: Env, baseSlug: string) {
  const db = requireDb(env);
  let candidate = baseSlug || "community-suggestion";
  for (let index = 0; index < 20; index += 1) {
    const existing = await db.prepare("SELECT id FROM competitive_events WHERE slug = ? LIMIT 1").bind(candidate).first<{ id: string }>();
    if (!existing) return candidate;
    candidate = `${baseSlug}-${index + 2}`;
  }
  return `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
}

function draftEventType(format: string) {
  if (format === "player_vs_player" || format === "stat_race") return "kill_race";
  if (format === "clan_squad") return "faction_wars";
  return "community_cup";
}

function defaultDraftCategory(format: string) {
  if (format === "player_vs_player" || format === "stat_race") return "deathmatch";
  if (format === "manual_referee") return "pvp_pve";
  return "pvp";
}

function summarizeDescription(description: string) {
  return description.length > 260 ? `${description.slice(0, 257).trim()}...` : description;
}

function maskInternalUserRef(value: string) {
  return value.length > 10 ? `${value.slice(0, 4)}...${value.slice(-4)}` : "user";
}

function demoSuggestions() {
  return [
    {
      id: "demo-suggestion-1",
      title: "Weekend Deathmatch Invitational",
      description: "A creator-reviewed community concept for a short Deathmatch bracket with verified rosters and manual dispute review.",
      competitionFormat: "server_vs_server",
      platform: "playstation",
      mapName: "Chernarus",
      suggestedServerScope: "open_to_any_server",
      status: "public_voting",
      creatorResponse: null,
      convertedEventId: null,
      convertedEventSlug: null,
      upvotes: 18,
      downvotes: 2,
      netScore: 16,
      votePercentage: 90,
      reportCount: 0,
      hotScore: 1.42,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}
