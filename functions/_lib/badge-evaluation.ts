import {
  awardBadge,
  ensureBadgeAwardSchema,
  evaluateServerBadgeUnlocks,
  getEarnedServerBadges,
  getServerBadgeShowcase,
  refreshCrownHolders,
  setCrownHolder,
  type ServerBadgeAwardRow,
} from "./badge-awards";
import { ensureMockUser, getSessionUser, requireDb } from "./db";
import { isMockAuth } from "./mock";
import { calculateServerScore } from "./server-ranking";
import type { Env, SessionUser } from "./types";
import { getBadgeRule, normalizeBadgeCode, type ServerBadgeCollection } from "../../lib/badges/rules";

export type BadgeAuditAction =
  | "badge_awarded"
  | "badge_revoked"
  | "crown_transferred"
  | "badge_progress_updated"
  | "evaluation_ran"
  | "evaluation_failed";

export type BadgeActor = {
  userId?: string | null;
  role?: string | null;
};

export type BadgeEvaluationServerResult = {
  serverId: string;
  ok: boolean;
  awarded: number;
  updatedProgress: number;
  showcaseBadges: number;
  error?: string;
};

export type BadgeBatchOptions = {
  serverId?: string | null;
  serverIds?: string[];
  limit?: number | null;
  includeCrowns?: boolean | null;
  actor?: BadgeActor | null;
};

export type BadgeBatchResult = {
  ok: boolean;
  evaluated: number;
  awarded: number;
  updatedProgress: number;
  crownsChanged: number;
  skipped: Array<{ serverId: string; reason: string }>;
  warnings: string[];
  serverResults: BadgeEvaluationServerResult[];
  publicProfileRefresh: "badge_awards_persisted";
};

export type BadgeAdminRole = "admin" | "support" | "dev";

export type BadgeAdminAuth =
  | { ok: true; user: SessionUser; role: BadgeAdminRole }
  | { ok: false; status: 401 | 403; payload: { ok: false; errorCode: string; error: string; message: string } };

export type ManualBadgeAwardInput = {
  serverId: string;
  badgeCode: string;
  reason?: string | null;
  awardType?: string | null;
  isActive?: boolean | null;
  actor?: BadgeActor | null;
};

export type ManualCrownTransferInput = {
  serverId: string;
  crownCode: string;
  reason?: string | null;
  actor?: BadgeActor | null;
};

const SAFE_BATCH_LIMIT_DEFAULT = 10;
const SAFE_BATCH_LIMIT_MAX = 25;

const MANUAL_AWARDABLE_BADGES = new Set([
  "founder",
  "early_adopter",
  "beta_veteran",
  "pioneer",
  "dzn_legend",
  "exclusive",
  "top_pick",
  "helping_hand",
  "event_champion",
  "loot_master",
  "spring_champion",
  "summer_champion",
  "autumn_champion",
  "winter_champion",
  "halloween_champion",
  "christmas_champion",
  "easter_champion",
  "new_year_champion",
]);

const MANUAL_AWARD_TYPES = new Set(["manual", "seasonal", "event", "founder", "support"]);

export async function ensureBadgeEvaluationSchema(env: Env) {
  await ensureBadgeAwardSchema(env);
  const db = requireDb(env);
  for (const statement of BADGE_AUDIT_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function evaluateServerBadgesSafely(env: Env, serverId: string, options: { actor?: BadgeActor | null; logEvaluation?: boolean } = {}): Promise<BadgeEvaluationServerResult & { collection?: ServerBadgeCollection }> {
  await ensureBadgeEvaluationSchema(env);
  const normalizedServerId = await resolveBadgeServerId(env, serverId);
  const before = await getEarnedServerBadges(env, normalizedServerId).catch(() => [] as ServerBadgeAwardRow[]);

  try {
    const collection = await evaluateServerBadgeUnlocks(env, normalizedServerId);
    const after = await getEarnedServerBadges(env, normalizedServerId);
    const awarded = activeAwardDifference(before, after);
    const updatedProgress = collection.earnedBadges.length + collection.lockedBadges.length;
    const result = {
      serverId: normalizedServerId,
      ok: true,
      awarded,
      updatedProgress,
      showcaseBadges: collection.showcaseBadges.length,
      collection,
    };
    if (options.logEvaluation !== false) {
      await logBadgeAudit(env, {
        action: "evaluation_ran",
        serverId: normalizedServerId,
        actor: options.actor,
        metadata: {
          awarded,
          updatedProgress,
          showcaseBadges: collection.showcaseBadges.length,
        },
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Badge evaluation failed.";
    await logBadgeAudit(env, {
      action: "evaluation_failed",
      serverId: normalizedServerId,
      actor: options.actor,
      reason: message,
    }).catch(() => undefined);
    return {
      serverId: normalizedServerId,
      ok: false,
      awarded: 0,
      updatedProgress: 0,
      showcaseBadges: 0,
      error: message,
    };
  }
}

export async function evaluateBadgeBatch(env: Env, options: BadgeBatchOptions = {}): Promise<BadgeBatchResult> {
  await ensureBadgeEvaluationSchema(env);
  const limit = clampBatchLimit(options.limit);
  const requestedIds = options.serverId
    ? [options.serverId]
    : Array.isArray(options.serverIds)
      ? options.serverIds
      : [];
  const serverIds = requestedIds.length
    ? requestedIds.slice(0, limit)
    : await listBatchServerIds(env, limit);

  const skipped: BadgeBatchResult["skipped"] = [];
  const warnings: string[] = [];
  const serverResults: BadgeEvaluationServerResult[] = [];
  let awarded = 0;
  let updatedProgress = 0;

  for (const rawServerId of serverIds) {
    try {
      const result = await evaluateServerBadgesSafely(env, rawServerId, { actor: options.actor });
      serverResults.push(stripCollection(result));
      if (result.ok) {
        awarded += result.awarded;
        updatedProgress += result.updatedProgress;
      } else {
        skipped.push({ serverId: result.serverId, reason: result.error ?? "Badge evaluation failed." });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Badge evaluation failed.";
      skipped.push({ serverId: rawServerId, reason });
      warnings.push(`${rawServerId}: ${reason}`);
      await logBadgeAudit(env, {
        action: "evaluation_failed",
        serverId: rawServerId,
        actor: options.actor,
        reason,
      }).catch(() => undefined);
    }
  }

  const crownResult = options.includeCrowns === false ? { crownsChanged: 0 } : await refreshAllCrownHolders(env, { actor: options.actor });

  await logBadgeAudit(env, {
    action: "evaluation_ran",
    serverId: "__batch__",
    actor: options.actor,
    metadata: {
      limit,
      evaluated: serverResults.filter((result) => result.ok).length,
      awarded,
      updatedProgress,
      crownsChanged: crownResult.crownsChanged,
      skipped,
    },
  });

  return {
    ok: skipped.length === 0,
    evaluated: serverResults.filter((result) => result.ok).length,
    awarded,
    updatedProgress,
    crownsChanged: crownResult.crownsChanged,
    skipped,
    warnings,
    serverResults,
    publicProfileRefresh: "badge_awards_persisted",
  };
}

export async function evaluateBadgeBatchForAllServers(env: Env, limit = SAFE_BATCH_LIMIT_DEFAULT) {
  return evaluateBadgeBatch(env, { limit, includeCrowns: true, actor: { role: "system" } });
}

export async function refreshServerBadgeShowcase(env: Env, serverId: string) {
  const normalizedServerId = await resolveBadgeServerId(env, serverId);
  await evaluateServerBadgesSafely(env, normalizedServerId);
  return getServerBadgeShowcase(env, normalizedServerId);
}

export async function refreshAllCrownHolders(env: Env, options: { limit?: number | null; actor?: BadgeActor | null } = {}) {
  await ensureBadgeEvaluationSchema(env);
  const result = await refreshCrownHolders(env, Math.max(1, Math.min(500, Math.round(Number(options.limit ?? 500)))));
  let crownsChanged = 0;
  for (const change of result.updated) {
    const changed = !change.previousServerId || change.previousServerId !== change.serverId;
    if (!changed) continue;
    crownsChanged += 1;
    await logBadgeAudit(env, {
      action: "crown_transferred",
      serverId: change.serverId,
      badgeCode: change.crownCode,
      previousServerId: change.previousServerId,
      actor: options.actor ?? { role: "system" },
      reason: "automatic_crown_refresh",
      metadata: { score: change.score },
    });
  }
  return { crownsChanged, updated: result.updated };
}

export async function rebuildBadgeProgressForServer(env: Env, serverId: string) {
  const result = await evaluateServerBadgesSafely(env, serverId);
  await logBadgeAudit(env, {
    action: "badge_progress_updated",
    serverId: result.serverId,
    metadata: {
      updatedProgress: result.updatedProgress,
      showcaseBadges: result.showcaseBadges,
    },
  });
  return result;
}

export async function manualAwardProtectedBadge(env: Env, input: ManualBadgeAwardInput) {
  await ensureBadgeEvaluationSchema(env);
  const serverId = await resolveBadgeServerId(env, input.serverId);
  const badgeCode = normalizeBadgeCode(input.badgeCode);
  const rule = getBadgeRule(badgeCode);
  if (!rule) throw new BadgeEvaluationError("BADGE_NOT_FOUND", "Badge code is not recognized.", 400);
  if (!MANUAL_AWARDABLE_BADGES.has(badgeCode)) {
    throw new BadgeEvaluationError("BADGE_MANUAL_AWARD_NOT_ALLOWED", "This badge cannot be awarded manually from this endpoint.", 400);
  }

  const awardType = normalizeAwardType(input.awardType, rule.isSeasonal ? "seasonal" : rule.category === "founder" ? "founder" : "manual");
  const reason = sanitizeReason(input.reason);
  const now = new Date().toISOString();
  const metadata = {
    reason,
    awardType,
    actorRole: input.actor?.role ?? null,
    actorUserId: input.actor?.userId ?? null,
  };
  const award = await awardBadge(env, serverId, badgeCode, awardType, metadata);
  await requireDb(env)
    .prepare("UPDATE server_badge_awards SET award_type = ?, source = ?, is_active = ?, metadata_json = ?, updated_at = ? WHERE id = ?")
    .bind(awardType, awardType, input.isActive === false ? 0 : 1, safeJson(metadata), now, award.id)
    .run();
  await logBadgeAudit(env, {
    action: "badge_awarded",
    serverId,
    badgeCode,
    actor: input.actor,
    reason,
    metadata: { awardId: award.id, awardType, isActive: input.isActive !== false },
  });
  return {
    ok: true,
    serverId,
    badgeCode,
    awardId: award.id,
    isActive: input.isActive !== false,
    message: "Badge awarded.",
  };
}

export async function manualTransferCrown(env: Env, input: ManualCrownTransferInput) {
  await ensureBadgeEvaluationSchema(env);
  const serverId = await resolveBadgeServerId(env, input.serverId);
  const crownCode = normalizeBadgeCode(input.crownCode);
  const rule = getBadgeRule(crownCode);
  if (!rule?.isCrown) throw new BadgeEvaluationError("CROWN_INVALID", "Crown code is not recognized.", 400);
  const score = await getServerScoreSnapshot(env, serverId);
  const previousServerId = await setCrownHolder(env, crownCode, serverId, score);
  const reason = sanitizeReason(input.reason);
  await logBadgeAudit(env, {
    action: "crown_transferred",
    serverId,
    badgeCode: crownCode,
    previousServerId,
    actor: input.actor,
    reason,
    metadata: { score, manual: true },
  });
  return {
    ok: true,
    serverId,
    crownCode,
    previousServerId,
    score,
    message: "Crown holder updated.",
  };
}

export async function requireBadgeAdminUser(env: Env, request: Request): Promise<BadgeAdminAuth> {
  let user = await getSessionUser(env, request);
  if (!user && isMockAuth(env.MOCK_AUTH)) {
    const mock = await ensureMockUser(env);
    user = {
      id: mock.userId,
      discord_id: mock.user.id,
      username: mock.user.username,
      avatar: mock.user.avatar,
    };
  }
  if (!user) {
    return {
      ok: false,
      status: 401,
      payload: {
        ok: false,
        error: "NOT_AUTHENTICATED",
        errorCode: "NOT_AUTHENTICATED",
        message: "Log in with an admin or support account.",
      },
    };
  }

  const role = badgeAdminRoleForUser(env, user);
  if (!role) {
    return {
      ok: false,
      status: 403,
      payload: {
        ok: false,
        error: "NOT_AUTHORIZED",
        errorCode: "NOT_AUTHORIZED",
        message: "Only DZN admin or support users can manage protected badges.",
      },
    };
  }

  return { ok: true, user, role };
}

export async function logBadgeAudit(env: Env, input: {
  action: BadgeAuditAction;
  serverId?: string | null;
  badgeCode?: string | null;
  previousServerId?: string | null;
  actor?: BadgeActor | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await ensureBadgeEvaluationSchema(env);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO badge_audit_log (
        id, action, server_id, badge_code, previous_server_id, actor_user_id, actor_role, reason, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `badge_audit_${randomId()}`,
      input.action,
      input.serverId ?? null,
      input.badgeCode ? normalizeBadgeCode(input.badgeCode) : null,
      input.previousServerId ?? null,
      input.actor?.userId ?? null,
      input.actor?.role ?? null,
      input.reason ? input.reason.slice(0, 500) : null,
      safeJson(input.metadata),
      now,
    )
    .run();
}

export async function resolveBadgeServerId(env: Env, rawServerId: string | null | undefined) {
  const value = String(rawServerId ?? "").trim();
  if (!value) throw new BadgeEvaluationError("SERVER_NOT_FOUND", "Server id is required.", 404);
  const row = await requireDb(env)
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE id = ? OR nitrado_service_id = ? OR public_slug = ?
       LIMIT 1`,
    )
    .bind(value, value, value)
    .first<{ id: string }>();
  if (!row?.id) throw new BadgeEvaluationError("SERVER_NOT_FOUND", "Server not found.", 404);
  return row.id;
}

export class BadgeEvaluationError extends Error {
  constructor(public readonly errorCode: string, message: string, public readonly status = 500) {
    super(message);
    this.name = "BadgeEvaluationError";
  }
}

function badgeAdminRoleForUser(env: Env, user: SessionUser): BadgeAdminRole | null {
  if (isMockAuth(env.MOCK_AUTH)) return "dev";
  if (matchesConfiguredDiscordId(env.DZN_DEV_DISCORD_IDS, user.discord_id)) return "dev";
  if (matchesConfiguredDiscordId(env.DZN_SUPPORT_DISCORD_IDS, user.discord_id)) return "support";
  if (matchesConfiguredDiscordId(env.DZN_ADMIN_DISCORD_IDS ?? env.DZN_OWNER_DISCORD_IDS, user.discord_id)) return "admin";
  return null;
}

function matchesConfiguredDiscordId(configured: string | null | undefined, discordId: string | null | undefined) {
  if (!discordId) return false;
  return String(configured ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(discordId);
}

async function listBatchServerIds(env: Env, limit: number) {
  const result = await requireDb(env)
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
}

async function getServerScoreSnapshot(env: Env, serverId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT
        linked_servers.id,
        COALESCE(server_stats.total_kills, (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS total_kills,
        COALESCE(server_stats.total_deaths, (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL), 0) AS total_deaths,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
        server_stats.last_event_at
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(serverId)
    .first<{
      total_kills: number | null;
      total_deaths: number | null;
      total_joins: number | null;
      unique_players: number | null;
      longest_kill: number | null;
      last_event_at: string | null;
    }>();
  if (!row) throw new BadgeEvaluationError("SERVER_NOT_FOUND", "Server not found.", 404);
  return calculateServerScore({
    kills: row.total_kills,
    deaths: row.total_deaths,
    uniquePlayers: row.unique_players,
    joins: row.total_joins,
    longestKill: row.longest_kill,
    statsSyncActive: Number(row.total_kills ?? 0) > 0 || Number(row.total_joins ?? 0) > 0 || Boolean(row.last_event_at),
  });
}

function activeAwardDifference(before: ServerBadgeAwardRow[], after: ServerBadgeAwardRow[]) {
  const beforeCodes = new Set(before.filter((award) => Number(award.is_active) === 1).map((award) => award.badge_code));
  return after.filter((award) => Number(award.is_active) === 1 && !beforeCodes.has(award.badge_code)).length;
}

function stripCollection(result: BadgeEvaluationServerResult & { collection?: ServerBadgeCollection }): BadgeEvaluationServerResult {
  return {
    serverId: result.serverId,
    ok: result.ok,
    awarded: result.awarded,
    updatedProgress: result.updatedProgress,
    showcaseBadges: result.showcaseBadges,
    ...(result.error ? { error: result.error } : {}),
  };
}

function clampBatchLimit(value: number | null | undefined) {
  const numeric = Math.round(Number(value ?? SAFE_BATCH_LIMIT_DEFAULT));
  if (!Number.isFinite(numeric)) return SAFE_BATCH_LIMIT_DEFAULT;
  return Math.max(1, Math.min(SAFE_BATCH_LIMIT_MAX, numeric));
}

function normalizeAwardType(value: unknown, fallback: string) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return MANUAL_AWARD_TYPES.has(normalized) ? normalized : fallback;
}

function sanitizeReason(value: unknown) {
  const reason = String(value ?? "").trim();
  return reason ? reason.slice(0, 500) : null;
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const BADGE_AUDIT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS badge_audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    server_id TEXT,
    badge_code TEXT,
    previous_server_id TEXT,
    actor_user_id TEXT,
    actor_role TEXT,
    reason TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_badge_audit_log_server ON badge_audit_log(server_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_badge_audit_log_badge ON badge_audit_log(badge_code, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_badge_audit_log_action ON badge_audit_log(action, created_at)",
];
