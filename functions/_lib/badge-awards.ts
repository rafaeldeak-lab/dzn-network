import { buildServerBadgeCollection, automaticAwardableEvaluations, getBadgeRule, normalizeBadgeCode, type ServerBadgeStatsInput, type ServerBadgeCollection } from "../../lib/badges/rules";
import { normalizePlanKey } from "../../lib/billing/plans";
import { requireDb } from "./db";
import { calculateServerScore } from "./server-ranking";
import type { Env } from "./types";

export type ServerBadgeAwardRow = {
  id: string;
  server_id: string;
  badge_code: string;
  awarded_at: string;
  award_type: string;
  source: string;
  is_active: number;
  expires_at: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

export type BadgeUnlockProgressRow = {
  server_id: string;
  badge_code: string;
  current_value: number;
  target_value: number;
  progress_percent: number;
  updated_at: string;
};

type BadgeServerStatsRow = {
  id: string;
  server_name: string | null;
  server_type: string | null;
  server_category: string | null;
  status: string | null;
  created_at: string | null;
  plan_key: string | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  longest_kill: number | null;
  last_event_at: string | null;
  featured_until: string | null;
};

type CrownCandidate = BadgeServerStatsRow & {
  score: number;
};

export async function ensureBadgeAwardSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of BADGE_AWARD_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function evaluateServerBadgeUnlocks(env: Env, serverId: string): Promise<ServerBadgeCollection> {
  await ensureBadgeAwardSchema(env);
  const input = await getServerBadgeStatsInput(env, serverId);
  const existingAwards = await getActiveAwardRows(env, serverId);
  const existingCodes = existingAwards.map((award) => award.badge_code);
  const earnedAtByCode = Object.fromEntries(existingAwards.map((award) => [award.badge_code, award.awarded_at]));
  const evaluationInput = {
    ...input,
    awardedBadgeCodes: existingCodes,
    activeCrownCodes: existingCodes.filter((code) => getBadgeRule(code)?.isCrown),
    seasonalBadgeCodes: existingCodes.filter((code) => getBadgeRule(code)?.isSeasonal),
    earnedAtByCode,
  };

  for (const evaluation of automaticAwardableEvaluations(evaluationInput)) {
    const award = await awardBadge(env, serverId, evaluation.rule.badgeCode, "system", {
      source: "badge_unlock_rule",
      currentValue: evaluation.currentValue,
      targetValue: evaluation.targetValue,
    });
    earnedAtByCode[evaluation.rule.badgeCode] = award.awarded_at;
  }
  await updateBadgeProgressFromCollection(env, serverId, input);

  const refreshedAwards = await getActiveAwardRows(env, serverId);
  return buildServerBadgeCollection({
    ...input,
    awardedBadgeCodes: refreshedAwards.map((award) => award.badge_code),
    activeCrownCodes: refreshedAwards.filter((award) => getBadgeRule(award.badge_code)?.isCrown).map((award) => award.badge_code),
    seasonalBadgeCodes: refreshedAwards.filter((award) => getBadgeRule(award.badge_code)?.isSeasonal).map((award) => award.badge_code),
    earnedAtByCode: Object.fromEntries(refreshedAwards.map((award) => [award.badge_code, award.awarded_at])),
  });
}

export async function evaluateAllServerBadgeUnlocks(env: Env, limit = 25) {
  await ensureBadgeAwardSchema(env);
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
       ORDER BY datetime(COALESCE(updated_at, created_at)) DESC
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(100, Math.round(limit))))
    .all<{ id: string }>();

  const evaluated: string[] = [];
  for (const row of result.results ?? []) {
    await evaluateServerBadgeUnlocks(env, row.id);
    evaluated.push(row.id);
  }
  return { evaluatedCount: evaluated.length, evaluatedServerIds: evaluated };
}

export async function awardBadge(env: Env, serverId: string, badgeCode: string, source = "system", metadata: Record<string, unknown> | null = null): Promise<ServerBadgeAwardRow> {
  await ensureBadgeAwardSchema(env);
  const db = requireDb(env);
  const code = normalizeBadgeCode(badgeCode);
  const rule = getBadgeRule(code);
  const now = new Date().toISOString();
  const existing = await db
    .prepare(
      `SELECT *
       FROM server_badge_awards
       WHERE server_id = ? AND badge_code = ?
       ORDER BY is_active DESC, datetime(awarded_at) ASC
       LIMIT 1`,
    )
    .bind(serverId, code)
    .first<ServerBadgeAwardRow>();

  if (existing) {
    if (Number(existing.is_active) !== 1) {
      const awardedAt = rule?.isPermanent === false || rule?.isCrown ? now : existing.awarded_at;
      await db
        .prepare("UPDATE server_badge_awards SET is_active = 1, source = ?, awarded_at = ?, metadata_json = ?, updated_at = ? WHERE id = ?")
        .bind(source, awardedAt, safeJson(metadata), now, existing.id)
        .run();
      return { ...existing, is_active: 1, source, awarded_at: awardedAt, metadata_json: safeJson(metadata), updated_at: now };
    }
    return existing;
  }

  const row: ServerBadgeAwardRow = {
    id: `badge_${randomId()}`,
    server_id: serverId,
    badge_code: code,
    awarded_at: now,
    award_type: rule?.isCrown ? "crown" : rule?.isSeasonal ? "seasonal" : rule?.unlockType === "plan" ? "plan" : rule?.manualOnly ? "manual" : "automatic",
    source,
    is_active: 1,
    expires_at: null,
    metadata_json: safeJson(metadata),
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO server_badge_awards (
        id, server_id, badge_code, awarded_at, award_type, source, is_active, expires_at, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.server_id, row.badge_code, row.awarded_at, row.award_type, row.source, row.is_active, row.expires_at, row.metadata_json, row.created_at, row.updated_at)
    .run();
  return row;
}

export async function revokeLiveBadge(env: Env, serverId: string, badgeCode: string, reason = "live_badge_revoked") {
  await ensureBadgeAwardSchema(env);
  const code = normalizeBadgeCode(badgeCode);
  await requireDb(env)
    .prepare("UPDATE server_badge_awards SET is_active = 0, metadata_json = ?, updated_at = ? WHERE server_id = ? AND badge_code = ? AND is_active = 1")
    .bind(safeJson({ reason }), new Date().toISOString(), serverId, code)
    .run();
}

export async function updateBadgeProgress(env: Env, serverId: string, badgeCode: string, currentValue: number, targetValue: number, progressPercent: number) {
  await ensureBadgeAwardSchema(env);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO badge_unlock_progress (server_id, badge_code, current_value, target_value, progress_percent, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, badge_code) DO UPDATE SET
         current_value = excluded.current_value,
         target_value = excluded.target_value,
         progress_percent = excluded.progress_percent,
         updated_at = excluded.updated_at`,
    )
    .bind(serverId, normalizeBadgeCode(badgeCode), safeNumber(currentValue), safeNumber(targetValue), safeNumber(progressPercent), now)
    .run();
}

export async function getEarnedServerBadges(env: Env, serverId: string) {
  await ensureBadgeAwardSchema(env);
  return getActiveAwardRows(env, serverId);
}

export async function getLockedServerBadges(env: Env, serverId: string) {
  const input = await getServerBadgeStatsInput(env, serverId);
  const awards = await getActiveAwardRows(env, serverId);
  return buildServerBadgeCollection({
    ...input,
    awardedBadgeCodes: awards.map((award) => award.badge_code),
    activeCrownCodes: awards.filter((award) => getBadgeRule(award.badge_code)?.isCrown).map((award) => award.badge_code),
    seasonalBadgeCodes: awards.filter((award) => getBadgeRule(award.badge_code)?.isSeasonal).map((award) => award.badge_code),
    earnedAtByCode: Object.fromEntries(awards.map((award) => [award.badge_code, award.awarded_at])),
  }).lockedBadges;
}

export async function getServerBadgeShowcase(env: Env, serverId: string) {
  const collection = await evaluateServerBadgeUnlocks(env, serverId);
  return collection.showcaseBadges;
}

export async function refreshCrownHolders(env: Env, limit = 500) {
  await ensureBadgeAwardSchema(env);
  const candidates = await getCrownCandidates(env, limit);
  const selections = new Map<string, CrownCandidate>();

  const consider = (crownCode: string, candidate: CrownCandidate) => {
    const existing = selections.get(crownCode);
    if (!existing || candidate.score > existing.score) selections.set(crownCode, candidate);
  };

  for (const candidate of candidates) {
    const category = String(candidate.server_category ?? candidate.server_type ?? "").toLowerCase();
    if (category.includes("deathmatch")) consider("king_of_deathmatch", candidate);
    if (category.includes("pve")) consider("king_of_pve", candidate);
    if (category.includes("pvp")) consider("king_of_pvp", candidate);
    if (category.includes("pve") || category.includes("survival") || category.includes("pvp")) consider("king_of_survival", candidate);
    consider("king_of_dzn", candidate);
  }

  const updated: Array<{ crownCode: string; serverId: string; previousServerId: string | null; score: number }> = [];
  for (const [crownCode, candidate] of selections) {
    const previous = await setCrownHolder(env, crownCode, candidate.id, candidate.score);
    updated.push({ crownCode, serverId: candidate.id, previousServerId: previous, score: candidate.score });
  }
  return { updated };
}

export async function getPublicBadgeAwardMap(env: Env, serverIds: string[]) {
  const byServer = new Map<string, { awards: ServerBadgeAwardRow[]; crownCodes: string[] }>();
  for (const serverId of serverIds) byServer.set(serverId, { awards: [], crownCodes: [] });
  if (!serverIds.length) return byServer;

  try {
    const db = requireDb(env);
    const placeholders = serverIds.map(() => "?").join(", ");
    const awards = await db
      .prepare(`SELECT * FROM server_badge_awards WHERE server_id IN (${placeholders}) AND is_active = 1`)
      .bind(...serverIds)
      .all<ServerBadgeAwardRow>();
    for (const award of awards.results ?? []) {
      const entry = byServer.get(award.server_id) ?? { awards: [], crownCodes: [] };
      entry.awards.push(award);
      byServer.set(award.server_id, entry);
    }

    const crowns = await db
      .prepare(`SELECT crown_code, server_id FROM crown_holders WHERE server_id IN (${placeholders})`)
      .bind(...serverIds)
      .all<{ crown_code: string; server_id: string }>();
    for (const crown of crowns.results ?? []) {
      const entry = byServer.get(crown.server_id) ?? { awards: [], crownCodes: [] };
      entry.crownCodes.push(crown.crown_code);
      byServer.set(crown.server_id, entry);
    }
  } catch (error) {
    console.warn("DZN badge awards unavailable for public output", error instanceof Error ? error.message : "unknown error");
  }

  return byServer;
}

async function updateBadgeProgressFromCollection(env: Env, serverId: string, input: ServerBadgeStatsInput) {
  for (const evaluation of automaticAwardableEvaluations({ ...input, awardedBadgeCodes: [] }).concat(
    buildServerBadgeCollection(input).lockedBadges.map((badge) => ({
      rule: getBadgeRule(badge.code)!,
      unlocked: false,
      currentValue: badge.currentValue,
      targetValue: badge.targetValue,
      progressPercent: badge.progressPercent,
      source: "locked" as const,
      lockedReason: badge.requirementLabel,
    })).filter((evaluation) => evaluation.rule),
  )) {
    await updateBadgeProgress(env, serverId, evaluation.rule.badgeCode, evaluation.currentValue, evaluation.targetValue, evaluation.progressPercent);
  }
}

async function getServerBadgeStatsInput(env: Env, serverId: string): Promise<ServerBadgeStatsInput> {
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.server_name,
        linked_servers.server_type,
        linked_servers.server_category,
        linked_servers.status,
        linked_servers.created_at,
        COALESCE(server_subscriptions.plan_key, 'starter') AS plan_key,
        COALESCE(server_stats.total_kills, (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS total_kills,
        COALESCE(server_stats.total_deaths, (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL), 0) AS total_deaths,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
        server_stats.last_event_at,
        server_advertising_state.featured_until
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(serverId)
    .first<BadgeServerStatsRow>();
  if (!row) throw new Error(`Server not found for badge evaluation: ${serverId}`);
  return statsRowToBadgeInput(row);
}

async function getActiveAwardRows(env: Env, serverId: string) {
  await ensureBadgeAwardSchema(env);
  const result = await requireDb(env)
    .prepare("SELECT * FROM server_badge_awards WHERE server_id = ? AND is_active = 1 ORDER BY datetime(awarded_at) DESC")
    .bind(serverId)
    .all<ServerBadgeAwardRow>();
  return result.results ?? [];
}

async function getCrownCandidates(env: Env, limit: number) {
  const result = await requireDb(env)
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.server_name,
        linked_servers.server_type,
        linked_servers.server_category,
        linked_servers.status,
        linked_servers.created_at,
        COALESCE(server_subscriptions.plan_key, 'starter') AS plan_key,
        COALESCE(server_stats.total_kills, 0) AS total_kills,
        COALESCE(server_stats.total_deaths, 0) AS total_deaths,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
        server_stats.last_event_at,
        server_advertising_state.featured_until
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
       LIMIT ?`,
    )
    .bind(Math.max(1, Math.min(1000, Math.round(limit))))
    .all<BadgeServerStatsRow>();

  return (result.results ?? []).map((row) => ({
    ...row,
    score: calculateServerScore({
      kills: row.total_kills,
      deaths: row.total_deaths,
      uniquePlayers: row.unique_players,
      joins: row.total_joins,
      longestKill: row.longest_kill,
      statsSyncActive: Number(row.total_kills ?? 0) > 0 || Number(row.total_joins ?? 0) > 0,
    }),
  }));
}

export async function setCrownHolder(env: Env, crownCode: string, serverId: string, score: number) {
  const db = requireDb(env);
  const code = normalizeBadgeCode(crownCode);
  const now = new Date().toISOString();
  const current = await db.prepare("SELECT server_id FROM crown_holders WHERE crown_code = ? LIMIT 1").bind(code).first<{ server_id: string }>();
  if (current?.server_id === serverId) {
    await db.prepare("UPDATE crown_holders SET score_snapshot = ?, updated_at = ? WHERE crown_code = ?").bind(score, now, code).run();
    await awardBadge(env, serverId, code, "crown", { score });
    return current.server_id;
  }
  if (current?.server_id) await revokeLiveBadge(env, current.server_id, code, "crown_transferred");

  await db
    .prepare(
      `INSERT INTO crown_holders (crown_code, server_id, awarded_at, score_snapshot, previous_server_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(crown_code) DO UPDATE SET
         server_id = excluded.server_id,
         awarded_at = excluded.awarded_at,
         score_snapshot = excluded.score_snapshot,
         previous_server_id = excluded.previous_server_id,
         updated_at = excluded.updated_at`,
    )
    .bind(code, serverId, now, score, current?.server_id ?? null, now, now)
    .run();
  await awardBadge(env, serverId, code, "crown", { score, previousServerId: current?.server_id ?? null });
  return current?.server_id ?? null;
}

function statsRowToBadgeInput(row: BadgeServerStatsRow): ServerBadgeStatsInput {
  return {
    serverId: row.id,
    planKey: normalizePlanKey(row.plan_key),
    createdAt: row.created_at,
    totalKills: safeNumber(row.total_kills),
    totalDeaths: safeNumber(row.total_deaths),
    totalJoins: safeNumber(row.total_joins),
    totalDisconnects: safeNumber(row.total_disconnects),
    uniquePlayers: safeNumber(row.unique_players),
    longestKill: safeNumber(row.longest_kill),
    category: row.server_category ?? row.server_type,
    active: safeNumber(row.total_kills) > 0 || safeNumber(row.total_joins) > 0 || Boolean(row.last_event_at),
    verified: lower(row.status) === "live",
    featured: Boolean(row.featured_until && Date.parse(row.featured_until) > Date.now()),
  };
}

function safeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function lower(value: unknown) {
  return String(value ?? "").toLowerCase();
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

const BADGE_AWARD_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS server_badge_awards (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    badge_code TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    award_type TEXT NOT NULL,
    source TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_badge_awards_server ON server_badge_awards(server_id, awarded_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_badge_awards_code_active ON server_badge_awards(badge_code, is_active)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_server_badge_awards_active_unique ON server_badge_awards(server_id, badge_code) WHERE is_active = 1",
  `CREATE TABLE IF NOT EXISTS badge_unlock_progress (
    server_id TEXT NOT NULL,
    badge_code TEXT NOT NULL,
    current_value REAL NOT NULL DEFAULT 0,
    target_value REAL NOT NULL DEFAULT 0,
    progress_percent REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (server_id, badge_code)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_badge_unlock_progress_badge ON badge_unlock_progress(badge_code, progress_percent)",
  `CREATE TABLE IF NOT EXISTS crown_holders (
    crown_code TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    score_snapshot REAL NOT NULL DEFAULT 0,
    previous_server_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_crown_holders_server ON crown_holders(server_id)",
];
