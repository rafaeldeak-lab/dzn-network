import { requireDb } from "./db";
import { creatorEventAdminDeniedPayload, isPlatformCreatorEventAdmin } from "./platform-creator";
import type { Env, SessionUser } from "./types";

export const SUGGESTION_PUBLIC_STATUSES = ["public_voting", "shortlisted", "accepted", "converted_to_event"] as const;
export const SUGGESTION_STATUS_FILTERS = ["all_public", ...SUGGESTION_PUBLIC_STATUSES] as const;
export const SUGGESTION_SORTS = ["trending", "newest", "most_supported", "most_active"] as const;
export const SUGGESTION_SUBMISSION_COOLDOWN_MS = 10 * 60 * 1000;
export const SUGGESTION_VOTE_CHANGE_COOLDOWN_MS = 1500;

const SUGGESTION_DAILY_LIMIT = 3;
const SUGGESTION_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type EventSuggestionSort = typeof SUGGESTION_SORTS[number];
export type EventSuggestionStatusFilter = typeof SUGGESTION_STATUS_FILTERS[number];

export type EventSuggestionInput = {
  title?: string | null;
  description?: string | null;
  competition_format?: string | null;
  platform?: string | null;
  map_name?: string | null;
  suggested_server_slug?: string | null;
  suggested_server_id?: string | null;
  open_to_any_server?: boolean | number | string | null;
  suggested_date_start?: string | null;
  suggested_date_end?: string | null;
  structure_notes?: string | null;
  additional_notes?: string | null;
};

export type SuggestionMutationKind = "submit" | "vote" | "report";

export function unauthorizedSuggestionMutationPayload(kind: SuggestionMutationKind) {
  const message = kind === "submit"
    ? "Log in with Discord to submit a suggestion."
    : kind === "vote"
      ? "Log in with Discord to vote."
      : "Log in with Discord to report a suggestion.";
  return {
    ok: false as const,
    status: 401,
    error: "UNAUTHORIZED",
    message,
  };
}

export type EventSuggestionModerationAction =
  | "approve_public_voting"
  | "request_revision"
  | "shortlist"
  | "accept"
  | "reject"
  | "archive"
  | "restore";

export type PublicSuggestionCursorPayload = {
  version: 1;
  sort: EventSuggestionSort;
  statusFilter: EventSuggestionStatusFilter;
  primarySortValue: number | string;
  secondarySortValue?: number | string | null;
  createdAt: string;
  id: string;
};

export type SuggestionSortRow = {
  id: string;
  created_at: string;
  public_status?: string | null;
  upvote_count?: number | null;
  downvote_count?: number | null;
  hot_score?: number | null;
};

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
  suggested_server_slug: string | null;
  suggested_server_name: string | null;
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
  converted_event_status?: string | null;
  converted_event_visibility?: string | null;
};

type ViewerVoteRow = {
  suggestion_id: string | null;
  vote_value: number | null;
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

type SchemaReadyResult =
  | { ok: true; status?: 200 }
  | { ok: false; status: number; error: string; errorCode?: string; message: string; missingCount?: number };

type ValidationResult =
  | { ok: true; value: ValidatedSuggestionInput }
  | { ok: false; status: number; error: string; message: string };

type ValidatedSuggestionInput = {
  title: string;
  description: string;
  normalizedTitle: string;
  contentFingerprint: string;
  competitionFormat: string;
  platform: string;
  mapName: string | null;
  suggestedServerId: string | null;
  suggestedServerSlug: string | null;
  suggestedServerName: string | null;
  openToAnyServer: boolean;
  suggestedDateStart: string | null;
  suggestedDateEnd: string | null;
  structureNotes: string | null;
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
  linked_servers.public_slug AS suggested_server_slug,
  COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS suggested_server_name,
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
  competitive_events.slug AS converted_event_slug,
  competitive_events.status AS converted_event_status,
  competitive_events.visibility AS converted_event_visibility
`;

const PUBLIC_SUGGESTION_SERVER_SQL_PREDICATE = `
  linked_servers.id IS NOT NULL
  AND lower(COALESCE(linked_servers.status, 'pending')) = 'live'
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (linked_servers.merged_into_server_id IS NULL OR trim(linked_servers.merged_into_server_id) = '')
`;

const PUBLIC_SUGGESTION_SELECT_COLUMNS = `
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
  CASE
    WHEN ${PUBLIC_SUGGESTION_SERVER_SQL_PREDICATE}
    THEN linked_servers.public_slug
    ELSE NULL
  END AS suggested_server_slug,
  CASE
    WHEN ${PUBLIC_SUGGESTION_SERVER_SQL_PREDICATE}
    THEN COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name)
    ELSE NULL
  END AS suggested_server_name,
  event_suggestions.open_to_any_server,
  event_suggestions.suggested_date_start,
  event_suggestions.suggested_date_end,
  event_suggestions.structure_notes,
  event_suggestions.moderation_status,
  event_suggestions.public_status,
  event_suggestions.creator_decision,
  CASE
    WHEN competitive_events.visibility = 'public' AND competitive_events.status != 'draft'
    THEN event_suggestions.converted_event_id
    ELSE NULL
  END AS converted_event_id,
  event_suggestions.creator_response,
  event_suggestions.upvote_count,
  event_suggestions.downvote_count,
  event_suggestions.report_count,
  event_suggestions.hot_score,
  event_suggestions.created_at,
  event_suggestions.updated_at,
  event_suggestions.published_at,
  event_suggestions.moderated_at,
  CASE
    WHEN competitive_events.visibility = 'public' AND competitive_events.status != 'draft'
    THEN competitive_events.slug
    ELSE NULL
  END AS converted_event_slug,
  CASE
    WHEN competitive_events.visibility = 'public' AND competitive_events.status != 'draft'
    THEN competitive_events.status
    ELSE NULL
  END AS converted_event_status,
  CASE
    WHEN competitive_events.visibility = 'public' AND competitive_events.status != 'draft'
    THEN competitive_events.visibility
    ELSE NULL
  END AS converted_event_visibility
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
  linked_servers: ["id", "public_slug", "status", "listing_visibility", "merged_into_server_id", "display_name", "hostname", "server_name", "nitrado_service_name"],
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
const CREATOR_PUBLIC_RESPONSE_ACTIONS = new Set<EventSuggestionModerationAction>(["approve_public_voting", "shortlist", "accept", "request_revision"]);

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

const ALLOWED_TRANSITIONS: Record<string, readonly EventSuggestionModerationAction[]> = {
  submitted: ["approve_public_voting", "request_revision", "reject", "archive"],
  pending_moderation: ["approve_public_voting", "request_revision", "reject", "archive"],
  public_voting: ["shortlist", "request_revision", "reject", "archive"],
  shortlisted: ["accept", "request_revision", "reject", "archive"],
  accepted: ["archive"],
  revision_requested: ["restore", "reject", "archive"],
  rejected: ["restore", "archive"],
  archived: ["restore"],
  converted_to_event: [],
};

const PUBLIC_STATUS_BY_MODERATION: Record<string, string> = {
  pending_moderation: "submitted",
  submitted: "submitted",
  public_voting: "public_voting",
  shortlisted: "shortlisted",
  accepted: "accepted",
  revision_requested: "revision_requested",
  rejected: "rejected",
  archived: "archived",
  converted_to_event: "converted_to_event",
};

const schemaReadiness = new WeakMap<object, Map<string, Promise<SchemaReadyResult>>>();

export async function listPublicEventSuggestions(
  env: Env,
  options: { sort?: string | null; status?: string | null; limit?: number | string | null; cursor?: string | null; viewerUserId?: string | null } = {},
) {
  if (!env.DB) return unavailableSuggestionList("d1_unavailable");
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const limit = sanitizeLimit(options.limit, 20, 100);
  const sort = normalizeSort(options.sort);
  const statusFilter = normalizeStatusFilter(options.status);
  const cursor = parsePublicSuggestionCursor(options.cursor, { sort, statusFilter });
  if (!cursor.ok) return cursor;

  const db = requireDb(env);
  const statusBindings = statusFilter === "all_public" ? [...SUGGESTION_PUBLIC_STATUSES] : [statusFilter];
  const statuses = statusBindings.map(() => "?").join(", ");
  const keyset = cursor.cursor ? suggestionCursorWhere(sort, cursor.cursor) : { sql: "", bindings: [] as unknown[] };
  const orderBy = suggestionOrderBy(sort);
  const rows = await db
    .prepare(
      `SELECT ${PUBLIC_SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       LEFT JOIN linked_servers ON linked_servers.id = event_suggestions.suggested_server_id
       WHERE event_suggestions.public_status IN (${statuses})
       ${keyset.sql}
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
    .bind(...statusBindings, ...keyset.bindings, limit + 1)
    .all<SuggestionRow>();
  const resultRows = rows.results ?? [];
  const pageRows = resultRows.slice(0, limit);
  const viewerVotes = options.viewerUserId ? await loadViewerVotesForSuggestions(db, options.viewerUserId, pageRows.map((row) => row.id)) : new Map<string, -1 | 1>();
  return {
    ok: true,
    suggestions: pageRows.map((row) => toPublicSuggestion(row, viewerVotes.get(row.id) ?? 0)),
    nextCursor: resultRows.length > limit ? makeCursor(pageRows[pageRows.length - 1], sort, statusFilter) : null,
    generatedAt: new Date().toISOString(),
    source: "live",
    sort,
    statusFilter,
    pageSize: limit,
  };
}

export async function createEventSuggestion(env: Env, user: SessionUser | null, input: EventSuggestionInput) {
  if (!user) return unauthorizedSuggestionMutationPayload("submit");
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const validation = await validateSuggestionInput(input, env);
  if (!validation.ok) return validation;
  const db = requireDb(env);
  const mutationNowMs = Date.now();
  const mutationNowIso = new Date(mutationNowMs).toISOString();
  const mutationCutoffIso = new Date(mutationNowMs - SUGGESTION_SUBMISSION_COOLDOWN_MS).toISOString();
  const dailyCutoffIso = new Date(mutationNowMs - SUGGESTION_DAILY_WINDOW_MS).toISOString();
  const [recent, today, recentTitles] = await Promise.all([
    db.prepare("SELECT created_at FROM event_suggestions WHERE submitted_by_user_id = ? ORDER BY datetime(created_at) DESC LIMIT 1").bind(user.id).first<{ created_at: string }>(),
    db.prepare("SELECT COUNT(*) AS count FROM event_suggestions WHERE submitted_by_user_id = ? AND julianday(created_at) IS NOT NULL AND julianday(created_at) >= julianday(?)").bind(user.id, dailyCutoffIso).first<{ count: number | null }>(),
    db.prepare("SELECT normalized_title FROM event_suggestions WHERE submitted_by_user_id = ? ORDER BY datetime(created_at) DESC LIMIT 20").bind(user.id).all<{ normalized_title: string }>(),
  ]);
  if (recent && submissionTimestampBlocksCooldown(recent.created_at, mutationCutoffIso)) {
    return { ok: false, status: 429, error: "SUBMISSION_COOLDOWN", message: "Wait before submitting another suggestion." };
  }
  if (Number(today?.count ?? 0) >= SUGGESTION_DAILY_LIMIT) {
    return { ok: false, status: 429, error: "DAILY_LIMIT_REACHED", message: "Daily suggestion limit reached." };
  }
  if ((recentTitles.results ?? []).some((row) => nearDuplicateScore(row.normalized_title, validation.value.normalizedTitle) >= 0.86)) {
    return { ok: false, status: 409, error: "NEAR_DUPLICATE_SUGGESTION", message: "A similar suggestion is already in review." };
  }

  const id = crypto.randomUUID();
  try {
    const insert = await db
      .prepare(
        `INSERT INTO event_suggestions (
          id, submitted_by_user_id, title, description, normalized_title, content_fingerprint,
          competition_format, platform, map_name, suggested_server_id, open_to_any_server,
          suggested_date_start, suggested_date_end, structure_notes, moderation_status,
          public_status, hot_score, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_moderation', 'submitted', 0, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM event_suggestions
          WHERE content_fingerprint = ?
        )
          AND NOT EXISTS (
            SELECT 1
            FROM event_suggestions
            WHERE submitted_by_user_id = ?
              AND (
                created_at IS NULL
                OR julianday(created_at) IS NULL
                OR julianday(created_at) > julianday(?)
              )
          )
          AND (
            SELECT COUNT(*)
            FROM event_suggestions
            WHERE submitted_by_user_id = ?
              AND julianday(created_at) IS NOT NULL
              AND julianday(created_at) >= julianday(?)
          ) < ?`,
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
        mutationNowIso,
        mutationNowIso,
        validation.value.contentFingerprint,
        user.id,
        mutationCutoffIso,
        user.id,
        dailyCutoffIso,
        SUGGESTION_DAILY_LIMIT,
      )
      .run();
    if (d1ChangedRows(insert) !== 1) {
      const blocked = await classifyBlockedSuggestionSubmission(db, user.id, validation.value.contentFingerprint, mutationCutoffIso, dailyCutoffIso);
      return blocked;
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { ok: false, status: 409, error: "DUPLICATE_SUGGESTION", message: "A similar suggestion is already in review." };
    }
    return { ok: false, status: 500, error: "SUGGESTION_CREATE_FAILED", message: "Suggestion could not be submitted." };
  }

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
  if (!user) return unauthorizedSuggestionMutationPayload("vote");
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const desiredVote = normalizeDesiredVote(voteValue);
  if (desiredVote === null) return { ok: false, status: 400, error: "INVALID_VOTE", message: "Vote must be 1, -1, or 0." };
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
  const existingVote = Number(existing?.vote_value ?? 0);
  if (existingVote === desiredVote) {
    const counts = await readSuggestionCounters(env, suggestionId);
    return { ok: true, status: 200, suggestionId, userVote: desiredVote, ...publicVoteCounters(counts) };
  }

  const mutationNowMs = Date.now();
  const mutationNowIso = new Date(mutationNowMs).toISOString();
  const mutationCutoffIso = new Date(mutationNowMs - SUGGESTION_VOTE_CHANGE_COOLDOWN_MS).toISOString();

  const mutation = desiredVote === 0
    ? db
      .prepare(
        `DELETE FROM event_suggestion_votes
         WHERE suggestion_id = ?
           AND user_id = ?
           AND julianday(updated_at) <= julianday(?)`,
      )
      .bind(suggestionId, user.id, mutationCutoffIso)
    : db
      .prepare(
        `INSERT INTO event_suggestion_votes (suggestion_id, user_id, vote_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(suggestion_id, user_id) DO UPDATE SET
           vote_value = excluded.vote_value,
           updated_at = excluded.updated_at
         WHERE julianday(event_suggestion_votes.updated_at) <= julianday(?)`,
      )
      .bind(suggestionId, user.id, desiredVote, mutationNowIso, mutationNowIso, mutationCutoffIso);
  const [mutationResult] = await db.batch([mutation, refreshSuggestionCountersStatement(db, suggestionId)]);
  if (d1ChangedRows(mutationResult) !== 1) {
    const current = await db
      .prepare("SELECT vote_value FROM event_suggestion_votes WHERE suggestion_id = ? AND user_id = ? LIMIT 1")
      .bind(suggestionId, user.id)
      .first<{ vote_value: number | null }>();
    const currentVote = Number(current?.vote_value ?? 0);
    if (currentVote === desiredVote) {
      const counts = await readSuggestionCounters(env, suggestionId);
      return { ok: true, status: 200, suggestionId, userVote: desiredVote, ...publicVoteCounters(counts) };
    }
    return { ok: false, status: 429, error: "VOTE_RATE_LIMITED", message: "Wait briefly before changing your vote." };
  }
  const counts = await readSuggestionCounters(env, suggestionId);
  return { ok: true, status: 200, suggestionId, userVote: desiredVote, ...publicVoteCounters(counts) };
}

export async function reportEventSuggestion(env: Env, user: SessionUser | null, suggestionId: string, input: { reason?: string | null; note?: string | null }) {
  if (!user) return unauthorizedSuggestionMutationPayload("report");
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env, { conversion: false });
  if (!schema.ok) return schema;
  const reason = normalizeEnum(input.reason, REPORT_REASONS);
  if (!reason) return { ok: false, status: 400, error: "INVALID_REPORT_REASON", message: "Choose a report reason." };
  const note = sanitizePlainText(input.note, 280);
  const db = requireDb(env);
  const suggestion = await db.prepare("SELECT id, submitted_by_user_id, public_status FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<SuggestionRow>();
  if (!suggestion) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  if (!SUGGESTION_PUBLIC_STATUSES.includes(suggestion.public_status as typeof SUGGESTION_PUBLIC_STATUSES[number])) {
    return { ok: false, status: 409, error: "SUGGESTION_NOT_PUBLIC", message: "Suggestion is not open for reports." };
  }
  if (suggestion.submitted_by_user_id === user.id) {
    return { ok: false, status: 403, error: "SELF_REPORT_DENIED", message: "Self-reporting is disabled for suggestions." };
  }
  const existingReport = await db
    .prepare("SELECT id FROM event_suggestion_reports WHERE suggestion_id = ? AND reporter_user_id = ? AND status = 'open' LIMIT 1")
    .bind(suggestionId, user.id)
    .first<{ id: string }>();
  if (existingReport) {
    return { ok: true, status: 200, suggestionId, idempotent: true, message: "Report received for moderator review." };
  }
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO event_suggestion_reports (id, suggestion_id, reporter_user_id, reason, safe_note, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
      )
      .bind(crypto.randomUUID(), suggestionId, user.id, reason, note || null),
    refreshSuggestionCountersStatement(db, suggestionId),
  ]);
  return { ok: true, status: 200, suggestionId, idempotent: false, message: "Report received for moderator review." };
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
    conditions.push("(event_suggestions.moderation_status = ? OR event_suggestions.public_status = ?)");
    bindings.push(status, status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await requireDb(env)
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       LEFT JOIN linked_servers ON linked_servers.id = event_suggestions.suggested_server_id
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
  const isPublicResponseAction = CREATOR_PUBLIC_RESPONSE_ACTIONS.has(action);
  const creatorResponse = isPublicResponseAction ? sanitizePlainText(input.creator_response, 600) : "";
  if (creatorResponse) {
    const moderation = moderateSuggestionContent(creatorResponse);
    if (!moderation.ok) return { ok: false, status: 422, error: "CREATOR_RESPONSE_UNSAFE", message: "Creator response must be public-safe." };
  }
  const db = requireDb(env);
  const existing = await db.prepare("SELECT id, moderation_status, public_status FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<SuggestionRow>();
  if (!existing) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  const transition = validateModerationTransition(existing.moderation_status, existing.public_status, action);
  if (!transition.ok) return transition;
  if (transition.idempotent) {
    if (!isPublicResponseAction) {
      await db.prepare("UPDATE event_suggestions SET creator_response = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND creator_response IS NOT NULL").bind(suggestionId).run();
    }
    const current = await loadOwnerSuggestion(env, suggestionId);
    return { ok: true, status: 200, idempotent: true, suggestion: current };
  }

  const moderatedAt = new Date().toISOString();
  const batchResult = await db.batch([
    db
      .prepare(
        `UPDATE event_suggestions
         SET moderation_status = ?,
             public_status = ?,
             creator_decision = ?,
             creator_response = CASE
               WHEN ? = 1 THEN CASE WHEN ? != '' THEN ? ELSE creator_response END
               ELSE NULL
             END,
             published_at = CASE WHEN ? = 'public_voting' AND published_at IS NULL THEN ? ELSE published_at END,
             moderated_at = ?,
             updated_at = ?
         WHERE id = ?
           AND moderation_status = ?
           AND public_status = ?`,
      )
      .bind(
        target.moderation_status,
        target.public_status,
        target.creator_decision,
        isPublicResponseAction ? 1 : 0,
        creatorResponse,
        creatorResponse,
        target.public_status,
        moderatedAt,
        moderatedAt,
        moderatedAt,
        suggestionId,
        existing.moderation_status,
        existing.public_status,
      ),
    db
      .prepare(
        `INSERT INTO event_suggestion_moderation_actions (id, suggestion_id, actor_user_id, action, previous_status, new_status, safe_reason, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(crypto.randomUUID(), suggestionId, user!.id, action, existing.moderation_status, target.moderation_status, reason || creatorResponse || "status update", moderatedAt),
  ]);
  if (d1ChangedRows(batchResult[0]) !== 1) {
    const current = await loadOwnerSuggestion(env, suggestionId);
    if (!current) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
    if (current.moderationStatus === target.moderation_status && current.publicStatus === target.public_status) {
      return { ok: true, status: 200, idempotent: true, suggestion: current };
    }
    return {
      ok: false,
      status: 409,
      error: "SUGGESTION_STATE_CONFLICT",
      message: "Suggestion state changed before moderation could be recorded.",
      suggestion: current,
    };
  }
  const updated = await loadOwnerSuggestion(env, suggestionId);
  return { ok: true, status: 200, idempotent: false, suggestion: updated };
}

export async function convertSuggestionToEventDraft(env: Env, user: SessionUser | null, suggestionId: string, input: { reason?: string | null } = {}) {
  const creatorDenied = creatorEventAdminDeniedPayload(env, user);
  if (creatorDenied) return creatorDenied;
  if (!env.DB) return { ok: false, status: 503, error: "SUGGESTIONS_UNAVAILABLE", message: "Suggestion storage is unavailable." };
  const schema = await validateEventSuggestionSchema(env);
  if (!schema.ok) return schema;
  const db = requireDb(env);
  const suggestion = await db
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       LEFT JOIN linked_servers ON linked_servers.id = event_suggestions.suggested_server_id
       WHERE event_suggestions.id = ?
       LIMIT 1`,
    )
    .bind(suggestionId)
    .first<SuggestionRow>();
  if (!suggestion) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
  if (suggestion.converted_event_id) {
    const event = await db.prepare("SELECT id, slug FROM competitive_events WHERE id = ? LIMIT 1").bind(suggestion.converted_event_id).first<{ id: string; slug: string }>();
    return { ok: true, status: 200, idempotent: true, eventId: suggestion.converted_event_id, eventSlug: event?.slug ?? null, message: "Suggestion already has a private event draft." };
  }
  if (!["shortlisted", "accepted"].includes(suggestion.moderation_status) || !["shortlisted", "accepted"].includes(suggestion.public_status)) {
    return { ok: false, status: 409, error: "SUGGESTION_NOT_CONVERTIBLE", message: "Only shortlisted or accepted suggestions can become drafts." };
  }

  const eventId = deterministicSuggestionEventId(suggestionId);
  const slug = deterministicSuggestionDraftSlug(suggestion);
  const category = defaultDraftCategory(suggestion.competition_format);
  const eventType = draftEventType(suggestion.competition_format);
  const description = `${suggestion.description}\n\nConverted from community suggestion. Creator review required before publication.`.slice(0, 1200);
  const reason = sanitizePlainText(input.reason, 500) || "creator conversion";
  const activityId = deterministicSuggestionActivityId(suggestionId);
  const moderationActionId = deterministicSuggestionModerationActionId(suggestionId);
  const convertedAt = new Date().toISOString();

  const existingDraft = await db.prepare("SELECT id, slug FROM competitive_events WHERE id = ? LIMIT 1").bind(eventId).first<{ id: string; slug: string }>();
  if (existingDraft) {
    const current = await db.prepare("SELECT converted_event_id FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<{ converted_event_id: string | null }>();
    if (current?.converted_event_id === existingDraft.id) {
      return { ok: true, status: 200, idempotent: true, eventId: existingDraft.id, eventSlug: existingDraft.slug, message: "Suggestion already has a private event draft." };
    }
    return { ok: false, status: 409, error: "DRAFT_ALREADY_EXISTS", message: "A draft already exists for this suggestion." };
  }

  let batchResult: unknown[];
  try {
    batchResult = await db.batch([
      db
        .prepare(
          `UPDATE event_suggestions
           SET public_status = 'converted_to_event',
               moderation_status = 'converted_to_event',
               creator_decision = 'converted_to_event',
               moderated_at = ?,
               updated_at = ?
           WHERE id = ?
             AND converted_event_id IS NULL
             AND moderation_status IN ('shortlisted', 'accepted')
             AND public_status IN ('shortlisted', 'accepted')`,
        )
        .bind(convertedAt, convertedAt, suggestionId),
      db
        .prepare(
          `INSERT INTO competitive_events (
            id, name, slug, description, category, event_type, status, visibility, premium_tier,
            starts_at, ends_at, created_by, rules, rewards, created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, 'draft', 'private', 'pro', ?, ?, ?, ?, NULL, ?, ?
          WHERE changes() = 1`,
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
          convertedAt,
          convertedAt,
        ),
      db
        .prepare(
          `UPDATE event_suggestions
           SET converted_event_id = ?,
               updated_at = ?
           WHERE id = ?
             AND converted_event_id IS NULL
             AND moderation_status = 'converted_to_event'
             AND public_status = 'converted_to_event'
             AND EXISTS (SELECT 1 FROM competitive_events WHERE id = ?)
             AND changes() = 1`,
        )
        .bind(eventId, convertedAt, suggestionId, eventId),
      db
        .prepare(
          `INSERT OR IGNORE INTO competitive_event_activity (id, event_id, server_id, activity_type, message, metadata, created_at)
           SELECT ?, ?, NULL, 'suggestion_converted_to_draft', ?, ?, ?
           WHERE changes() = 1`,
        )
        .bind(activityId, eventId, `Community suggestion converted to draft: ${suggestion.title}.`, JSON.stringify({ suggestion_id: suggestionId }), convertedAt),
      db
        .prepare(
          `INSERT OR IGNORE INTO event_suggestion_moderation_actions (id, suggestion_id, actor_user_id, action, previous_status, new_status, safe_reason, created_at)
           SELECT ?, ?, ?, 'convert_to_event_draft', ?, 'converted_to_event', ?, ?
           WHERE changes() = 1`,
        )
        .bind(moderationActionId, suggestionId, user!.id, suggestion.moderation_status, reason, convertedAt),
    ]);
  } catch {
    const existingConversion = await waitForExistingSuggestionDraft(env, suggestionId, eventId);
    if (existingConversion.ok) {
      return existingConversion.result;
    }
    if (existingConversion.draftExists) {
      return { ok: false, status: 409, error: "DRAFT_ALREADY_EXISTS", message: "A draft already exists for this suggestion." };
    }
    return { ok: false, status: 500, error: "SUGGESTION_CONVERSION_FAILED", message: "Suggestion could not be converted safely." };
  }
  if (d1ChangedRows(batchResult[0]) !== 1) {
    const existingConversion = await waitForExistingSuggestionDraft(env, suggestionId, eventId);
    if (existingConversion.ok) {
      return existingConversion.result;
    }
    if (existingConversion.missing) return { ok: false, status: 404, error: "SUGGESTION_NOT_FOUND", message: "Suggestion not found." };
    if (existingConversion.alreadyTransitioned) return { ok: false, status: 409, error: "SUGGESTION_ALREADY_TRANSITIONED", message: "Suggestion already moved to another state." };
    return { ok: false, status: 409, error: "SUGGESTION_STATE_CONFLICT", message: "Suggestion state changed before conversion could be finalized." };
  }

  const [event, updatedSuggestion] = await Promise.all([
    db.prepare("SELECT id, slug, status, visibility FROM competitive_events WHERE id = ? LIMIT 1").bind(eventId).first<{ id: string; slug: string; status: string; visibility: string }>(),
    db.prepare("SELECT converted_event_id FROM event_suggestions WHERE id = ? LIMIT 1").bind(suggestionId).first<{ converted_event_id: string | null }>(),
  ]);
  if (!event || updatedSuggestion?.converted_event_id !== eventId) {
    return { ok: false, status: 409, error: "SUGGESTION_CONVERSION_CONFLICT", message: "Suggestion conversion could not be finalized." };
  }
  return { ok: true, status: 200, idempotent: false, eventId: event.id, eventSlug: event.slug, message: "Suggestion converted to a private event draft." };
}

async function waitForExistingSuggestionDraft(env: Env, suggestionId: string, expectedEventId: string) {
  for (const delayMs of [0, 25, 75]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const current = await requireDb(env)
      .prepare("SELECT converted_event_id, moderation_status, public_status FROM event_suggestions WHERE id = ? LIMIT 1")
      .bind(suggestionId)
      .first<Pick<SuggestionRow, "converted_event_id" | "moderation_status" | "public_status">>();
    if (!current) return { ok: false as const, missing: true as const };
    if (current.converted_event_id) {
      const event = await requireDb(env)
        .prepare("SELECT id, slug FROM competitive_events WHERE id = ? LIMIT 1")
        .bind(current.converted_event_id)
        .first<{ id: string; slug: string }>();
      if (event) {
        return {
          ok: true as const,
          result: { ok: true as const, status: 200, idempotent: true, eventId: event.id, eventSlug: event.slug, message: "Suggestion already has a private event draft." },
        };
      }
      return { ok: false as const, alreadyTransitioned: true as const };
    }
    const draft = await requireDb(env)
      .prepare("SELECT id, slug FROM competitive_events WHERE id = ? LIMIT 1")
      .bind(expectedEventId)
      .first<{ id: string; slug: string }>();
    if (draft) return { ok: false as const, draftExists: true as const };
    if (current.moderation_status === "converted_to_event" || current.public_status === "converted_to_event") {
      return { ok: false as const, alreadyTransitioned: true as const };
    }
  }
  return { ok: false as const };
}

export async function validateEventSuggestionSchema(env: Env, options: { conversion?: boolean } = {}) {
  if (!env.DB) return { ok: false as const, status: 503, error: "D1_UNAVAILABLE", message: "D1 DB binding is not configured." };
  const key = options.conversion === false ? "suggestions" : "full";
  const dbObject = env.DB as unknown as object;
  let cache = schemaReadiness.get(dbObject);
  if (!cache) {
    cache = new Map();
    schemaReadiness.set(dbObject, cache);
  }
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = validateEventSuggestionSchemaNow(env, options).catch((error) => ({
    ok: false as const,
    status: 500,
    error: "EVENT_SUGGESTIONS_SCHEMA_NOT_READY",
    errorCode: "EVENT_SUGGESTIONS_SCHEMA_NOT_READY",
    message: "Event suggestion storage is not ready.",
    missingCount: safeMissingCount(error),
  })).then((result) => {
    const current = schemaReadiness.get(dbObject);
    if (!result.ok && current?.get(key) === promise) {
      current.delete(key);
      if (current.size === 0) schemaReadiness.delete(dbObject);
    }
    return result;
  });
  cache.set(key, promise);
  return promise;
}

export function resetEventSuggestionSchemaReadinessForTests(env?: Env) {
  if (env?.DB) schemaReadiness.delete(env.DB as unknown as object);
}

async function validateEventSuggestionSchemaNow(env: Env, options: { conversion?: boolean } = {}) {
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

export async function validateSuggestionInput(input: EventSuggestionInput, env?: Env): Promise<ValidationResult> {
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
  const submittedServerSlug = sanitizePublicSlug(input.suggested_server_slug ?? input.suggested_server_id);
  const openToAnyServer = parseBoolean(input.open_to_any_server, !submittedServerSlug);
  let suggestedServerId: string | null = null;
  let suggestedServerSlug: string | null = null;
  let suggestedServerName: string | null = null;
  if (!openToAnyServer) {
    if (!submittedServerSlug) return { ok: false as const, status: 400, error: "SUGGESTED_SERVER_REQUIRED", message: "Choose a public server or keep the suggestion open to any server." };
    if (!env?.DB) return { ok: false as const, status: 503, error: "SUGGESTED_SERVER_LOOKUP_UNAVAILABLE", message: "Suggested server lookup is unavailable." };
    const resolved = await resolvePublicSuggestionServer(env, submittedServerSlug);
    if (!resolved) return { ok: false as const, status: 400, error: "INVALID_SUGGESTED_SERVER", message: "Choose a public eligible server." };
    suggestedServerId = resolved.id;
    suggestedServerSlug = resolved.public_slug;
    suggestedServerName = resolved.server_name;
  }
  const suggestedDateStart = parseSuggestionDate(input.suggested_date_start);
  if (!suggestedDateStart.ok) return suggestedDateStart;
  const suggestedDateEnd = parseSuggestionDate(input.suggested_date_end);
  if (!suggestedDateEnd.ok) return suggestedDateEnd;
  if (suggestedDateStart.value && suggestedDateEnd.value && Date.parse(suggestedDateEnd.value) < Date.parse(suggestedDateStart.value)) {
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
      suggestedServerSlug,
      suggestedServerName,
      openToAnyServer,
      suggestedDateStart: suggestedDateStart.value,
      suggestedDateEnd: suggestedDateEnd.value,
      structureNotes: structureNotes || null,
    },
  };
}

export function moderateSuggestionContent(value: string) {
  const normalized = normalizeSuggestionText(value);
  const compact = normalizeSuggestionTextCompact(value);
  if (/<[a-z][\s\S]*>/i.test(value)) return { ok: false as const, reason: "HTML_NOT_ALLOWED" };
  if (/@\s*(?:everyone|here)/i.test(value)) return { ok: false as const, reason: "MASS_MENTION_NOT_ALLOWED" };
  if (/<\s*@\s*&?\s*\d{5,32}\s*>|<\s*#\s*\d{5,32}\s*>/.test(value)) return { ok: false as const, reason: "RAW_DISCORD_MENTION_NOT_ALLOWED" };
  if (/d\s*i\s*s\s*c\s*o\s*r\s*d\s*(?:\.|dot)?\s*(?:gg|com\s*\/\s*invite)\s*\/?/i.test(value)) return { ok: false as const, reason: "DISCORD_INVITE_NOT_ALLOWED" };
  if (/https?:\/\/|www\.|(?:^|[\s])(?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|co|dev|app|xyz|info|biz|ru|uk)(?:[\/\s]|$)/i.test(value)) {
    return { ok: false as const, reason: "URL_NOT_ALLOWED" };
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return { ok: false as const, reason: "PERSONAL_INFORMATION_NOT_ALLOWED" };
  if (/\+?\d[\d\s().-]{8,}\d/.test(value)) return { ok: false as const, reason: "PERSONAL_INFORMATION_NOT_ALLOWED" };
  if (/(.)\1{8,}/i.test(normalized) || /(.)\1{12,}/i.test(compact)) return { ok: false as const, reason: "SPAM_PATTERN" };
  for (const term of BLOCKED_TERMS) {
    const spaced = normalizeSuggestionText(term);
    const compactTerm = normalizeSuggestionTextCompact(term);
    if (normalized.includes(spaced) || compact.includes(compactTerm)) return { ok: false as const, reason: "BLOCKED_LANGUAGE" };
  }
  return { ok: true as const };
}

export function normalizeSuggestionText(value: string) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (char) => LEET_MAP[char] ?? char)
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[\s._\-|/\\:;,'"~`^*+=()[\]{}<>]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSuggestionTextCompact(value: string) {
  return normalizeSuggestionText(value).replace(/\s+/g, "");
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

export function validateModerationTransition(previousModerationStatus: string, previousPublicStatus: string, action: EventSuggestionModerationAction) {
  if (previousModerationStatus === "converted_to_event" || previousPublicStatus === "converted_to_event") {
    return { ok: false as const, status: 409, error: "SUGGESTION_CONVERTED_TERMINAL", message: "Converted suggestions cannot be moved back." };
  }
  const target = moderationTarget(action);
  if (!target) return { ok: false as const, status: 400, error: "INVALID_MODERATION_ACTION", message: "Unsupported moderation action." };
  if (!moderationStatusesAlign(previousModerationStatus, previousPublicStatus)) {
    return { ok: false as const, status: 409, error: "INVALID_MODERATION_STATE", message: "Suggestion moderation state is inconsistent." };
  }
  const idempotent = previousModerationStatus === target.moderation_status && previousPublicStatus === target.public_status;
  if (idempotent) return { ok: true as const, idempotent: true };
  const allowed = ALLOWED_TRANSITIONS[previousModerationStatus] ?? [];
  if (!allowed.includes(action)) {
    return { ok: false as const, status: 409, error: "INVALID_MODERATION_TRANSITION", message: "Suggestion cannot move to that state from its current state." };
  }
  return { ok: true as const, idempotent: false };
}

export function encodePublicSuggestionCursor(payload: PublicSuggestionCursorPayload) {
  const json = JSON.stringify(payload);
  const binary = String.fromCharCode(...new TextEncoder().encode(json));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parsePublicSuggestionCursor(
  value: unknown,
  expected: { sort: EventSuggestionSort; statusFilter: EventSuggestionStatusFilter },
): { ok: true; cursor: PublicSuggestionCursorPayload | null } | { ok: false; status: 400; error: string; message: string } {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, cursor: null };
  if (text.length > 600 || !/^[A-Za-z0-9_-]+$/.test(text)) {
    return { ok: false, status: 400, error: "INVALID_CURSOR", message: "Suggestion cursor is invalid." };
  }
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PublicSuggestionCursorPayload>;
    if (payload.version !== 1 || payload.sort !== expected.sort || payload.statusFilter !== expected.statusFilter) {
      return { ok: false, status: 400, error: "CURSOR_MISMATCH", message: "Suggestion cursor does not match the requested list." };
    }
    if (!payload.id || !payload.createdAt || !Number.isFinite(Date.parse(payload.createdAt))) {
      return { ok: false, status: 400, error: "INVALID_CURSOR", message: "Suggestion cursor is invalid." };
    }
    if (!Number.isFinite(Number(payload.primarySortValue))) {
      if (expected.sort !== "newest") return { ok: false, status: 400, error: "INVALID_CURSOR", message: "Suggestion cursor is invalid." };
    }
    if (["most_supported", "most_active"].includes(expected.sort) && !Number.isFinite(Number(payload.secondarySortValue))) {
      return { ok: false, status: 400, error: "INVALID_CURSOR", message: "Suggestion cursor is invalid." };
    }
    return { ok: true, cursor: payload as PublicSuggestionCursorPayload };
  } catch {
    return { ok: false, status: 400, error: "INVALID_CURSOR", message: "Suggestion cursor is invalid." };
  }
}

export function paginateSuggestionRowsForTest(
  rows: SuggestionSortRow[],
  options: { sort: EventSuggestionSort; statusFilter: EventSuggestionStatusFilter; limit: number; cursor?: string | null },
) {
  const parsed = parsePublicSuggestionCursor(options.cursor, { sort: options.sort, statusFilter: options.statusFilter });
  if (!parsed.ok) return parsed;
  const filtered = rows
    .filter((row) => options.statusFilter === "all_public" || row.public_status === options.statusFilter)
    .sort((left, right) => compareSuggestionRows(left, right, options.sort));
  const afterCursor = parsed.cursor ? filtered.filter((row) => compareRowToCursor(row, parsed.cursor!, options.sort) > 0) : filtered;
  const page = afterCursor.slice(0, options.limit);
  return {
    ok: true as const,
    rows: page,
    nextCursor: afterCursor.length > options.limit ? makeCursor(page[page.length - 1] as SuggestionRow, options.sort, options.statusFilter) : null,
  };
}

function refreshSuggestionCountersStatement(db: D1Database, suggestionId: string) {
  return db
    .prepare(
      `UPDATE event_suggestions
       SET upvote_count = (
             SELECT COUNT(*) FROM event_suggestion_votes
             WHERE suggestion_id = event_suggestions.id AND vote_value = 1
           ),
           downvote_count = (
             SELECT COUNT(*) FROM event_suggestion_votes
             WHERE suggestion_id = event_suggestions.id AND vote_value = -1
           ),
           report_count = (
             SELECT COUNT(*) FROM event_suggestion_reports
             WHERE suggestion_id = event_suggestions.id AND status = 'open'
           ),
           hot_score = (
             (
               SELECT COUNT(*) * 2.0 FROM event_suggestion_votes
               WHERE suggestion_id = event_suggestions.id AND vote_value = 1
             )
             - (
               SELECT COUNT(*) * 1.25 FROM event_suggestion_votes
               WHERE suggestion_id = event_suggestions.id AND vote_value = -1
             )
             - (
               SELECT COUNT(*) * 3.0 FROM event_suggestion_reports
               WHERE suggestion_id = event_suggestions.id AND status = 'open'
             )
             + (1.0 / MAX(1.0, ((strftime('%s', 'now') - strftime('%s', event_suggestions.created_at)) / 3600.0)))
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(suggestionId);
}

async function readSuggestionCounters(env: Env, suggestionId: string) {
  const row = await requireDb(env)
    .prepare("SELECT upvote_count, downvote_count, report_count, hot_score FROM event_suggestions WHERE id = ? LIMIT 1")
    .bind(suggestionId)
    .first<{ upvote_count: number | null; downvote_count: number | null; report_count: number | null; hot_score: number | null }>();
  const upvoteCount = Number(row?.upvote_count ?? 0);
  const downvoteCount = Number(row?.downvote_count ?? 0);
  const reportCount = Number(row?.report_count ?? 0);
  return { upvoteCount, downvoteCount, reportCount, netScore: upvoteCount - downvoteCount, hotScore: Number(row?.hot_score ?? 0) };
}

async function classifyBlockedSuggestionSubmission(
  db: D1Database,
  userId: string,
  contentFingerprint: string,
  mutationCutoffIso: string,
  dailyCutoffIso: string,
) {
  const recent = await db
    .prepare(
      `SELECT created_at
       FROM event_suggestions
       WHERE submitted_by_user_id = ?
         AND (
           created_at IS NULL
           OR julianday(created_at) IS NULL
           OR julianday(created_at) > julianday(?)
         )
       LIMIT 1`,
    )
    .bind(userId, mutationCutoffIso)
    .first<{ created_at: string | null }>();
  if (recent) {
    return { ok: false as const, status: 429, error: "SUBMISSION_COOLDOWN", message: "Wait before submitting another suggestion." };
  }
  const today = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM event_suggestions
       WHERE submitted_by_user_id = ?
         AND julianday(created_at) IS NOT NULL
         AND julianday(created_at) >= julianday(?)`,
    )
    .bind(userId, dailyCutoffIso)
    .first<{ count: number | null }>();
  if (Number(today?.count ?? 0) >= SUGGESTION_DAILY_LIMIT) {
    return { ok: false as const, status: 429, error: "DAILY_LIMIT_REACHED", message: "Daily suggestion limit reached." };
  }
  const duplicate = await db
    .prepare("SELECT id FROM event_suggestions WHERE content_fingerprint = ? LIMIT 1")
    .bind(contentFingerprint)
    .first<{ id: string }>();
  if (duplicate) {
    return { ok: false as const, status: 409, error: "DUPLICATE_SUGGESTION", message: "A similar suggestion is already in review." };
  }
  return { ok: false as const, status: 409, error: "SUGGESTION_NOT_ACCEPTED", message: "Suggestion could not be accepted. Refresh and try again." };
}

function d1ChangedRows(result: unknown) {
  const meta = result && typeof result === "object" ? (result as { meta?: Record<string, unknown> }).meta : null;
  const raw = meta?.changes ?? meta?.rows_written ?? meta?.rowsWritten ?? meta?.rows_affected ?? meta?.rowsAffected;
  const changes = Number(raw ?? 0);
  return Number.isFinite(changes) ? changes : 0;
}

function publicVoteCounters(counts: { upvoteCount: number; downvoteCount: number; netScore: number; hotScore: number }) {
  return {
    upvoteCount: counts.upvoteCount,
    downvoteCount: counts.downvoteCount,
    netScore: counts.netScore,
    hotScore: counts.hotScore,
  };
}

async function loadOwnerSuggestion(env: Env, suggestionId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT ${SUGGESTION_SELECT_COLUMNS}
       FROM event_suggestions
       LEFT JOIN competitive_events ON competitive_events.id = event_suggestions.converted_event_id
       LEFT JOIN linked_servers ON linked_servers.id = event_suggestions.suggested_server_id
       WHERE event_suggestions.id = ?
       LIMIT 1`,
    )
    .bind(suggestionId)
    .first<SuggestionRow>();
  return row ? toOwnerSuggestion(row) : null;
}

async function resolvePublicSuggestionServer(env: Env, submittedSlug: string) {
  const slug = sanitizePublicSlug(submittedSlug);
  if (!slug) return null;
  return requireDb(env)
    .prepare(
      `SELECT
         id,
         public_slug,
         COALESCE(NULLIF(display_name, ''), NULLIF(hostname, ''), server_name, nitrado_service_name) AS server_name
       FROM linked_servers
       WHERE lower(public_slug) = ?
         AND ${PUBLIC_SUGGESTION_SERVER_SQL_PREDICATE}
       LIMIT 1`,
    )
    .bind(slug)
    .first<{ id: string; public_slug: string; server_name: string }>();
}

async function loadViewerVotesForSuggestions(db: D1Database, viewerUserId: string, suggestionIds: readonly string[]) {
  const ids = [...new Set(suggestionIds.filter(Boolean))].slice(0, 100);
  const votes = new Map<string, -1 | 1>();
  if (!ids.length) return votes;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT suggestion_id, vote_value
       FROM event_suggestion_votes
       WHERE user_id = ?
         AND suggestion_id IN (${placeholders})`,
    )
    .bind(viewerUserId, ...ids)
    .all<ViewerVoteRow>();
  for (const row of rows.results ?? []) {
    const suggestionId = typeof row.suggestion_id === "string" ? row.suggestion_id : "";
    const vote = Number(row.vote_value);
    if (suggestionId && (vote === 1 || vote === -1)) votes.set(suggestionId, vote);
  }
  return votes;
}

function suggestionCursorWhere(sort: EventSuggestionSort, cursor: PublicSuggestionCursorPayload) {
  if (sort === "newest") {
    return {
      sql: "AND (datetime(event_suggestions.created_at) < datetime(?) OR (event_suggestions.created_at = ? AND event_suggestions.id < ?))",
      bindings: [cursor.createdAt, cursor.createdAt, cursor.id],
    };
  }
  if (sort === "most_supported") {
    return {
      sql: `AND (
        (event_suggestions.upvote_count - event_suggestions.downvote_count) < ?
        OR ((event_suggestions.upvote_count - event_suggestions.downvote_count) = ? AND event_suggestions.upvote_count < ?)
        OR ((event_suggestions.upvote_count - event_suggestions.downvote_count) = ? AND event_suggestions.upvote_count = ? AND datetime(event_suggestions.created_at) < datetime(?))
        OR ((event_suggestions.upvote_count - event_suggestions.downvote_count) = ? AND event_suggestions.upvote_count = ? AND event_suggestions.created_at = ? AND event_suggestions.id < ?)
      )`,
      bindings: [
        Number(cursor.primarySortValue),
        Number(cursor.primarySortValue),
        Number(cursor.secondarySortValue ?? 0),
        Number(cursor.primarySortValue),
        Number(cursor.secondarySortValue ?? 0),
        cursor.createdAt,
        Number(cursor.primarySortValue),
        Number(cursor.secondarySortValue ?? 0),
        cursor.createdAt,
        cursor.id,
      ],
    };
  }
  if (sort === "most_active") {
    return {
      sql: `AND (
        (event_suggestions.upvote_count + event_suggestions.downvote_count) < ?
        OR ((event_suggestions.upvote_count + event_suggestions.downvote_count) = ? AND event_suggestions.upvote_count < ?)
        OR ((event_suggestions.upvote_count + event_suggestions.downvote_count) = ? AND event_suggestions.upvote_count = ? AND datetime(event_suggestions.created_at) < datetime(?))
        OR ((event_suggestions.upvote_count + event_suggestions.downvote_count) = ? AND event_suggestions.upvote_count = ? AND event_suggestions.created_at = ? AND event_suggestions.id < ?)
      )`,
      bindings: [
        Number(cursor.primarySortValue),
        Number(cursor.primarySortValue),
        Number(cursor.secondarySortValue ?? 0),
        Number(cursor.primarySortValue),
        Number(cursor.secondarySortValue ?? 0),
        cursor.createdAt,
        Number(cursor.primarySortValue),
        Number(cursor.secondarySortValue ?? 0),
        cursor.createdAt,
        cursor.id,
      ],
    };
  }
  return {
    sql: `AND (
      event_suggestions.hot_score < ?
      OR (event_suggestions.hot_score = ? AND datetime(event_suggestions.created_at) < datetime(?))
      OR (event_suggestions.hot_score = ? AND event_suggestions.created_at = ? AND event_suggestions.id < ?)
    )`,
    bindings: [Number(cursor.primarySortValue), Number(cursor.primarySortValue), cursor.createdAt, Number(cursor.primarySortValue), cursor.createdAt, cursor.id],
  };
}

function suggestionOrderBy(sort: EventSuggestionSort) {
  if (sort === "newest") return "datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
  if (sort === "most_supported") return "(event_suggestions.upvote_count - event_suggestions.downvote_count) DESC, event_suggestions.upvote_count DESC, datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
  if (sort === "most_active") return "(event_suggestions.upvote_count + event_suggestions.downvote_count) DESC, event_suggestions.upvote_count DESC, datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
  return "event_suggestions.hot_score DESC, datetime(event_suggestions.created_at) DESC, event_suggestions.id DESC";
}

function makeCursor(row: SuggestionRow | SuggestionSortRow | undefined, sort: EventSuggestionSort, statusFilter: EventSuggestionStatusFilter) {
  if (!row) return null;
  return encodePublicSuggestionCursor({
    version: 1,
    sort,
    statusFilter,
    primarySortValue: primarySortValue(row, sort),
    secondarySortValue: secondarySortValue(row, sort),
    createdAt: row.created_at,
    id: row.id,
  });
}

function compareSuggestionRows(left: SuggestionSortRow, right: SuggestionSortRow, sort: EventSuggestionSort) {
  if (sort === "newest") return compareCreatedId(left, right);
  const primary = Number(primarySortValue(right, sort)) - Number(primarySortValue(left, sort));
  if (primary) return primary;
  if (sort === "most_supported" || sort === "most_active") {
    const secondary = Number(secondarySortValue(right, sort) ?? 0) - Number(secondarySortValue(left, sort) ?? 0);
    if (secondary) return secondary;
  }
  return compareCreatedId(left, right);
}

function compareCreatedId(left: SuggestionSortRow, right: SuggestionSortRow) {
  const dateDiff = Date.parse(right.created_at) - Date.parse(left.created_at);
  if (dateDiff) return dateDiff;
  return right.id.localeCompare(left.id);
}

function compareRowToCursor(row: SuggestionSortRow, cursor: PublicSuggestionCursorPayload, sort: EventSuggestionSort) {
  const cursorRow: SuggestionSortRow = {
    id: cursor.id,
    created_at: cursor.createdAt,
    upvote_count: sort === "most_supported" ? Number(cursor.secondarySortValue ?? 0) : undefined,
    downvote_count: sort === "most_supported" ? Number(cursor.secondarySortValue ?? 0) - Number(cursor.primarySortValue) : undefined,
    hot_score: sort === "trending" ? Number(cursor.primarySortValue) : undefined,
  };
  if (sort === "most_active") {
    cursorRow.upvote_count = Number(cursor.secondarySortValue ?? 0);
    cursorRow.downvote_count = Number(cursor.primarySortValue) - Number(cursor.secondarySortValue ?? 0);
  }
  return compareSuggestionRows(row, cursorRow, sort);
}

function primarySortValue(row: SuggestionSortRow, sort: EventSuggestionSort) {
  if (sort === "newest") return row.created_at;
  if (sort === "most_supported") return Number(row.upvote_count ?? 0) - Number(row.downvote_count ?? 0);
  if (sort === "most_active") return Number(row.upvote_count ?? 0) + Number(row.downvote_count ?? 0);
  return Number(row.hot_score ?? 0);
}

function secondarySortValue(row: SuggestionSortRow, sort: EventSuggestionSort) {
  return sort === "most_supported" || sort === "most_active" ? Number(row.upvote_count ?? 0) : null;
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

function moderationStatusesAlign(moderationStatus: string, publicStatus: string) {
  return PUBLIC_STATUS_BY_MODERATION[moderationStatus] === publicStatus;
}

function requiresReason(action: string) {
  return ["request_revision", "reject", "archive", "restore"].includes(action);
}

function toPublicSuggestion(row: SuggestionRow, userVote: -1 | 0 | 1 = 0) {
  const upvotes = Number(row.upvote_count ?? 0);
  const downvotes = Number(row.downvote_count ?? 0);
  const total = upvotes + downvotes;
  const publicConvertedEvent =
    row.converted_event_visibility === "public" &&
    row.converted_event_status !== "draft" &&
    Boolean(row.converted_event_slug);
  const suggestedServerUnavailable = !row.open_to_any_server && Boolean(row.suggested_server_id) && !row.suggested_server_slug && !row.suggested_server_name;
  return {
    id: row.id,
    title: row.title,
    description: summarizeDescription(row.description),
    competitionFormat: row.competition_format,
    platform: row.platform,
    mapName: row.map_name,
    suggestedServerScope: row.open_to_any_server ? "open_to_any_server" : suggestedServerUnavailable ? "specific_server_unavailable" : "specific_server",
    suggestedServerSlug: row.suggested_server_slug ?? null,
    suggestedServerName: row.suggested_server_name ?? null,
    status: row.public_status,
    creatorResponse: row.creator_response,
    convertedEventId: publicConvertedEvent ? row.converted_event_id : null,
    convertedEventSlug: publicConvertedEvent ? row.converted_event_slug ?? null : null,
    upvotes,
    downvotes,
    netScore: upvotes - downvotes,
    totalVotes: total,
    userVote,
    votePercentage: total ? Math.round((upvotes / total) * 100) : null,
    hotScore: Number(row.hot_score ?? 0),
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOwnerSuggestion(row: SuggestionRow) {
  return {
    ...toPublicSuggestion(row),
    convertedEventId: row.converted_event_id,
    convertedEventSlug: row.converted_event_slug ?? null,
    description: row.description,
    moderationStatus: row.moderation_status,
    publicStatus: row.public_status,
    creatorDecision: row.creator_decision,
    suggestedDateStart: row.suggested_date_start,
    suggestedDateEnd: row.suggested_date_end,
    structureNotes: row.structure_notes,
    submittedBy: maskInternalUserRef(row.submitted_by_user_id),
    reportCount: Number(row.report_count ?? 0),
    moderatedAt: row.moderated_at,
  };
}

export function projectSuggestionForPublicTest(overrides: Record<string, unknown>) {
  return toPublicSuggestion(testSuggestionRow(overrides));
}

export function projectSuggestionForOwnerTest(overrides: Record<string, unknown>) {
  return toOwnerSuggestion(testSuggestionRow(overrides));
}

function testSuggestionRow(overrides: Record<string, unknown>): SuggestionRow {
  return {
    id: "suggestion-test",
    submitted_by_user_id: "user-test",
    title: "Preview tournament suggestion",
    description: "A creator reviewed community event suggestion with enough context for a safe public card.",
    normalized_title: "preview tournament suggestion",
    content_fingerprint: "fingerprint-test",
    competition_format: "server_vs_server",
    platform: "playstation",
    map_name: null,
    suggested_server_id: null,
    suggested_server_slug: null,
    suggested_server_name: null,
    open_to_any_server: 1,
    suggested_date_start: null,
    suggested_date_end: null,
    structure_notes: null,
    moderation_status: "converted_to_event",
    public_status: "converted_to_event",
    creator_decision: "converted_to_event",
    converted_event_id: null,
    creator_response: null,
    upvote_count: 0,
    downvote_count: 0,
    report_count: 0,
    hot_score: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    published_at: null,
    moderated_at: null,
    converted_event_slug: null,
    converted_event_status: null,
    converted_event_visibility: null,
    ...overrides,
  } as SuggestionRow;
}

function unavailableSuggestionList(reason: string) {
  const localDemo = false;
  if (localDemo) return {
    ok: true,
    suggestions: [],
    nextCursor: null,
    generatedAt: new Date().toISOString(),
    source: "demo",
    reason,
  };
  return {
    ok: true,
    suggestions: [],
    nextCursor: null,
    generatedAt: new Date().toISOString(),
    source: "unavailable",
    reason,
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

function sanitizePublicSlug(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{2,95}$/.test(text) ? text : null;
}

function parseSuggestionDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true as const, value: null };
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return { ok: false as const, status: 400, error: "INVALID_DATE", message: "Preferred dates must be valid." };
  return { ok: true as const, value: new Date(parsed).toISOString() };
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

function normalizeStatusFilter(value: unknown): EventSuggestionStatusFilter {
  const normalized = String(value ?? "all_public").trim().toLowerCase();
  return SUGGESTION_STATUS_FILTERS.includes(normalized as EventSuggestionStatusFilter) ? normalized as EventSuggestionStatusFilter : "all_public";
}

function normalizeDesiredVote(value: unknown) {
  const parsed = Number(value);
  if (parsed === 1 || parsed === -1 || parsed === 0) return parsed as -1 | 0 | 1;
  return null;
}

function submissionTimestampBlocksCooldown(value: string | null | undefined, cutoffIso: string) {
  const valueMs = parseSuggestionTimestampMs(value);
  const cutoffMs = parseSuggestionTimestampMs(cutoffIso);
  return !Number.isFinite(valueMs) || !Number.isFinite(cutoffMs) || valueMs > cutoffMs;
}

function parseSuggestionTimestampMs(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return Date.parse(`${text.replace(" ", "T")}Z`);
  }
  return Date.parse(text);
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

async function fingerprintContent(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deterministicSuggestionEventId(suggestionId: string) {
  const clean = String(suggestionId ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 72);
  return `suggestion-draft-${clean || stableHash(suggestionId)}`;
}

function deterministicSuggestionDraftSlug(suggestion: SuggestionRow) {
  const base = cleanSlug(suggestion.title).slice(0, 48) || "community-suggestion";
  return `${base}-${stableHash(suggestion.id)}`;
}

function deterministicSuggestionActivityId(suggestionId: string) {
  return `suggestion-conversion-activity-${stableHash(suggestionId)}`;
}

function deterministicSuggestionModerationActionId(suggestionId: string) {
  return `suggestion-conversion-action-${stableHash(suggestionId)}`;
}

function cleanSlug(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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

function isUniqueConstraintError(error: unknown) {
  return /unique|constraint|content_fingerprint/i.test(error instanceof Error ? error.message : String(error ?? ""));
}

function safeMissingCount(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = text.match(/missingCount[=:](\d+)/i);
  return match ? Number(match[1]) : undefined;
}
