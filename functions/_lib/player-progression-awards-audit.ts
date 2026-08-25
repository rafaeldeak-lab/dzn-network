import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { json } from "./http";
import {
  getRequestSessionUser,
  ownerAccessErrorResponse,
  requireActiveOwnerEntitlement,
  returnToFromRequest,
} from "./owner-access";
import type { Env, SessionUser } from "./types";

export type ProgressionAwardAuditRole = "owner" | "admin";

export type ProgressionAwardAuditActor = {
  user: SessionUser;
  role: ProgressionAwardAuditRole;
};

export type ProgressionAwardAuditStatus =
  | "finished"
  | "pending"
  | "progressed"
  | "awarded"
  | "duplicate"
  | "skipped"
  | "failed"
  | "all";

export type ProgressionAwardAuditItem = {
  id: string;
  user_id: string;
  player_name: string | null;
  challenge_id: string;
  challenge_slug: string | null;
  challenge_title: string | null;
  linked_server_id: string | null;
  server_name: string | null;
  public_slug: string | null;
  source_type: string;
  source_id: string;
  source_table: string | null;
  adapter_key: string | null;
  progress_value: number;
  verification_status: string;
  verified_at: string | null;
  processed_at: string | null;
  result_status: string;
  result_message: string | null;
  attempt_count: number;
  last_attempted_at: string | null;
  retry_count: number;
  last_retried_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  retry_available: boolean;
};

type ProgressionAwardAuditRow = ProgressionAwardAuditItem & {
  owner_user_id: string | null;
};

type AuditCountRow = {
  result_status: string | null;
  count: number | null;
};

const AUDIT_STATUSES = new Set<ProgressionAwardAuditStatus>([
  "finished",
  "pending",
  "progressed",
  "awarded",
  "duplicate",
  "skipped",
  "failed",
  "all",
]);

export async function authorizeProgressionAwardAuditRequest(env: Env, request: Request): Promise<
  | { ok: true; actor: ProgressionAwardAuditActor }
  | { ok: false; response: Response }
> {
  let user: SessionUser | null = null;
  try {
    user = await getRequestSessionUser(env, request);
  } catch {
    user = null;
  }

  if (!user) {
    return {
      ok: false,
      response: json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in with Discord to view progression award audit history." }, { status: 401 }),
    };
  }

  if (isDznAdminDiscordId(env, user.discord_id)) {
    return { ok: true, actor: { user, role: "admin" } };
  }

  const ownerAccess = await requireActiveOwnerEntitlement(env, user, returnToFromRequest(request));
  if (!ownerAccess.allowed) {
    return { ok: false, response: ownerAccessErrorResponse(ownerAccess) };
  }

  return { ok: true, actor: { user, role: "owner" } };
}

export async function listProgressionAwardAudit(
  env: Env,
  actor: ProgressionAwardAuditActor,
  options: { status?: string | null; limit?: number | null } = {},
) {
  const db = requireDb(env);
  const status = normalizeAuditStatus(options.status);
  const limit = clampAuditLimit(options.limit);
  const bindings: unknown[] = [];
  const conditions = scopedAuditConditions(actor, bindings);
  applyStatusFilter(status, conditions);
  bindings.push(limit);

  const rows = await db
    .prepare(
      `SELECT
         player_progression_award_sources.id,
         player_progression_award_sources.user_id,
         users.username AS player_name,
         player_progression_award_sources.challenge_id,
         player_challenges.slug AS challenge_slug,
         player_challenges.title AS challenge_title,
         player_progression_award_sources.linked_server_id,
         linked_servers.user_id AS owner_user_id,
         COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
         linked_servers.public_slug,
         player_progression_award_sources.source_type,
         player_progression_award_sources.source_id,
         player_progression_award_sources.source_table,
         player_progression_award_sources.adapter_key,
         player_progression_award_sources.progress_value,
         player_progression_award_sources.verification_status,
         player_progression_award_sources.verified_at,
         player_progression_award_sources.processed_at,
         player_progression_award_sources.result_status,
         player_progression_award_sources.result_message,
         player_progression_award_sources.attempt_count,
         player_progression_award_sources.last_attempted_at,
         player_progression_award_sources.retry_count,
         player_progression_award_sources.last_retried_at,
         player_progression_award_sources.created_at,
         player_progression_award_sources.updated_at
       FROM player_progression_award_sources
       LEFT JOIN users ON users.id = player_progression_award_sources.user_id
       LEFT JOIN player_challenges ON player_challenges.id = player_progression_award_sources.challenge_id
       LEFT JOIN linked_servers ON linked_servers.id = player_progression_award_sources.linked_server_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY datetime(COALESCE(player_progression_award_sources.processed_at, player_progression_award_sources.updated_at, player_progression_award_sources.created_at)) DESC,
                player_progression_award_sources.id DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<ProgressionAwardAuditRow>();

  const counts = await readProgressionAwardAuditCounts(env, actor);
  return {
    ok: true,
    role: actor.role,
    filter: status,
    count: rows.results?.length ?? 0,
    counts,
    retry: {
      available_failed_rows: counts.failed,
      protected_job: "/api/cron/player-progression/awards",
      request_body: { retry_failed: true },
    },
    awards: (rows.results ?? []).map(toAuditItem),
  };
}

async function readProgressionAwardAuditCounts(env: Env, actor: ProgressionAwardAuditActor) {
  const bindings: unknown[] = [];
  const conditions = scopedAuditConditions(actor, bindings);
  const rows = await requireDb(env)
    .prepare(
      `SELECT result_status, COUNT(*) AS count
       FROM player_progression_award_sources
       LEFT JOIN linked_servers ON linked_servers.id = player_progression_award_sources.linked_server_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY result_status`,
    )
    .bind(...bindings)
    .all<AuditCountRow>();

  const counts = {
    pending: 0,
    progressed: 0,
    awarded: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    total: 0,
  };
  for (const row of rows.results ?? []) {
    const key = normalizeResultStatus(row.result_status);
    const count = Math.max(0, Math.trunc(Number(row.count ?? 0)));
    counts[key] += count;
    counts.total += count;
  }
  return counts;
}

function scopedAuditConditions(actor: ProgressionAwardAuditActor, bindings: unknown[]) {
  const conditions = ["player_progression_award_sources.verification_status = 'verified'"];
  if (actor.role !== "admin") {
    conditions.push("player_progression_award_sources.linked_server_id IS NOT NULL");
    conditions.push("linked_servers.user_id = ?");
    bindings.push(actor.user.id);
  }
  return conditions;
}

function applyStatusFilter(status: ProgressionAwardAuditStatus, conditions: string[]) {
  if (status === "all") return;
  if (status === "finished") {
    conditions.push("player_progression_award_sources.result_status IN ('awarded', 'skipped', 'failed')");
    return;
  }
  conditions.push(`player_progression_award_sources.result_status = '${status}'`);
}

function toAuditItem(row: ProgressionAwardAuditRow): ProgressionAwardAuditItem {
  const resultStatus = normalizeResultStatus(row.result_status);
  return {
    id: stringOrEmpty(row.id),
    user_id: stringOrEmpty(row.user_id),
    player_name: nullableString(row.player_name),
    challenge_id: stringOrEmpty(row.challenge_id),
    challenge_slug: nullableString(row.challenge_slug),
    challenge_title: nullableString(row.challenge_title),
    linked_server_id: nullableString(row.linked_server_id),
    server_name: nullableString(row.server_name),
    public_slug: nullableString(row.public_slug),
    source_type: stringOrEmpty(row.source_type),
    source_id: stringOrEmpty(row.source_id),
    source_table: nullableString(row.source_table),
    adapter_key: nullableString(row.adapter_key),
    progress_value: Math.max(0, Math.trunc(Number(row.progress_value ?? 0))),
    verification_status: stringOrDefault(row.verification_status, "verified"),
    verified_at: nullableString(row.verified_at),
    processed_at: nullableString(row.processed_at),
    result_status: resultStatus,
    result_message: nullableString(row.result_message),
    attempt_count: Math.max(0, Math.trunc(Number(row.attempt_count ?? 0))),
    last_attempted_at: nullableString(row.last_attempted_at),
    retry_count: Math.max(0, Math.trunc(Number(row.retry_count ?? 0))),
    last_retried_at: nullableString(row.last_retried_at),
    created_at: nullableString(row.created_at),
    updated_at: nullableString(row.updated_at),
    retry_available: resultStatus === "failed",
  };
}

function normalizeAuditStatus(value: unknown): ProgressionAwardAuditStatus {
  if (typeof value !== "string") return "finished";
  const normalized = value.trim().toLowerCase();
  return AUDIT_STATUSES.has(normalized as ProgressionAwardAuditStatus)
    ? normalized as ProgressionAwardAuditStatus
    : "finished";
}

function normalizeResultStatus(value: unknown): "pending" | "progressed" | "awarded" | "duplicate" | "skipped" | "failed" {
  if (value === "pending" || value === "progressed" || value === "awarded" || value === "duplicate" || value === "skipped" || value === "failed") return value;
  return "failed";
}

function clampAuditLimit(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : 50;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringOrEmpty(value: unknown) {
  return stringOrDefault(value, "");
}
