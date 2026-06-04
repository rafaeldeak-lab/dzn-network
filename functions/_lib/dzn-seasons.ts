import { awardBadge } from "./badge-awards";
import { requireDb } from "./db";
import type { Env } from "./types";

export type DznSeasonCategory = "deathmatch" | "pvp" | "pve" | "survival";

export type DznSeasonRow = {
  id: string;
  slug: string;
  name: string;
  category: DznSeasonCategory;
  status: string;
  starts_at: string;
  ends_at: string;
  scoring_rules_json: string | null;
  created_at: string;
  updated_at: string;
};

export type DznSeasonEntryRow = {
  id: string;
  season_id: string;
  server_id: string;
  category: DznSeasonCategory;
  joined_at: string;
  status: string;
  snapshot_start_json: string | null;
  snapshot_current_json: string | null;
  final_score: number | null;
  rank: number | null;
  created_at: string;
  updated_at: string;
};

export type DznSeasonScoreResult = {
  score: number;
  metrics: Record<string, number | string | boolean>;
  missingMetrics: string[];
};

export type DznSeasonAwardRow = {
  id: string;
  season_id: string;
  server_id: string;
  award_code: string;
  rank: number | null;
  awarded_at: string;
  metadata_json: string | null;
};

export type DznSeasonRefreshEntry = {
  entryId: string;
  seasonId: string;
  serverId: string;
  score: number;
  rank: number | null;
  capturedAt: string;
  metrics: Record<string, number | string | boolean>;
};

export type DznSeasonRefreshResult = {
  ok: true;
  seasonId: string;
  refreshed: number;
  snapshotsCreated: number;
  capturedAt: string;
  warnings: string[];
  entries: DznSeasonRefreshEntry[];
};

export type DznActiveSeasonRefreshResult = {
  ok: true;
  seasonsChecked: number;
  entriesRefreshed: number;
  snapshotsCreated: number;
  warnings: string[];
};

export type DznSeasonRefreshOptions = {
  limit?: number | null;
  maxLimit?: number | null;
  allowCompleted?: boolean | null;
  capturedAt?: string | null;
};

export type DznSeasonScoringMetricRule = {
  key: string;
  label: string;
  source: string;
  available: boolean;
  placeholder?: number;
  weight?: number;
  note?: string;
};

export type DznSeasonScoringRules = {
  version: 1;
  category: DznSeasonCategory;
  metrics: DznSeasonScoringMetricRule[];
  missingMetricPolicy: "safe_zero_placeholder";
};

export type DznAdminSeasonCreateInput = {
  name?: unknown;
  slug?: unknown;
  category?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  scoringRules?: unknown;
};

export type DznAdminSeasonUpdateInput = {
  name?: unknown;
  slug?: unknown;
  category?: unknown;
  status?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  scoringRules?: unknown;
};

export type DznAdminSeasonMutationResult = {
  ok: true;
  season: DznAdminSeasonSummary;
  warnings: string[];
};

export type DznAdminSeasonEntry = {
  id: string;
  seasonId: string;
  serverId: string;
  category: DznSeasonCategory;
  joinedAt: string;
  status: string;
  score: number | null;
  rank: number | null;
  lastScoreRefreshAt: string | null;
  hasScoreSnapshot: boolean;
};

export type DznAdminSeasonAward = {
  id: string;
  seasonId: string;
  serverId: string;
  awardCode: string;
  rank: number | null;
  awardedAt: string;
  metadata: Record<string, unknown>;
};

export type DznAdminSeasonSummary = {
  id: string;
  slug: string;
  name: string;
  category: DznSeasonCategory;
  status: string;
  startsAt: string;
  endsAt: string;
  scoringRules: Record<string, unknown>;
  entryCount: number;
  scoredEntryCount: number;
  scoreSnapshotCount: number;
  awardsCount: number;
  lastScoreRefreshAt: string | null;
  awardFinaliseStatus: string;
  canRefresh: boolean;
  canFinalise: boolean;
  warnings: string[];
  entries: DznAdminSeasonEntry[];
  awards: DznAdminSeasonAward[];
};

export type DznAdminSeasonManagement = {
  ok: true;
  seasons: DznAdminSeasonSummary[];
  activeSeasons: DznAdminSeasonSummary[];
  upcomingSeasons: DznAdminSeasonSummary[];
  completedSeasons: DznAdminSeasonSummary[];
  warnings: string[];
};

type DznSeasonWithScoreStatusRow = DznSeasonRow & {
  last_score_refresh_at?: string | null;
  score_snapshot_count?: number | null;
};

type DznSeasonEntryWithScoreStatusRow = DznSeasonEntryRow & {
  entry_last_score_refresh_at?: string | null;
  entry_score_snapshot_count?: number | null;
};

type DznAdminSeasonRow = DznSeasonRow & {
  entry_count?: number | null;
  scored_entry_count?: number | null;
  score_snapshot_count?: number | null;
  awards_count?: number | null;
  last_score_refresh_at?: string | null;
};

type SeasonServerRow = {
  id: string;
  server_name: string | null;
  server_category: string | null;
  server_type: string | null;
  status: string | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  last_event_at: string | null;
  stats_updated_at: string | null;
};

export class DznSeasonError extends Error {
  status: number;
  errorCode: string;

  constructor(errorCode: string, message: string, status = 400) {
    super(message);
    this.name = "DznSeasonError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

export const SEASON_REFRESH_DEFAULT_LIMIT = 10;
export const SEASON_REFRESH_MAX_LIMIT = 25;

const ACTIVE_SEASON_STATUSES = ["registration_open", "active", "live", "upcoming"];
const COMPLETED_SEASON_STATUSES = ["completed", "finalised", "finalized", "archived"];
const ALLOWED_ADMIN_SEASON_STATUSES = new Set([...ACTIVE_SEASON_STATUSES, ...COMPLETED_SEASON_STATUSES]);
const INTERNAL_SEASON_REFRESH_MAX_LIMIT = 500;
const PUBLIC_SEASON_SELECT = `dzn_seasons.*,
              (SELECT MAX(captured_at)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_seasons.id) AS last_score_refresh_at,
              (SELECT COUNT(*)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_seasons.id) AS score_snapshot_count`;

export async function getActiveSeasons(env: Env) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const rows = await requireDb(env)
    .prepare(
      `SELECT ${PUBLIC_SEASON_SELECT}
       FROM dzn_seasons
       WHERE lower(status) IN ('registration_open', 'active', 'live', 'upcoming')
       ORDER BY datetime(starts_at) ASC, datetime(ends_at) ASC`,
    )
    .all<DznSeasonWithScoreStatusRow>();
  return (rows.results ?? []).map(toPublicSeason);
}

export async function getPublicSeasons(env: Env, limit = 100) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const capped = Math.max(1, Math.min(250, Math.round(limit)));
  const rows = await requireDb(env)
    .prepare(
      `SELECT ${PUBLIC_SEASON_SELECT}
       FROM dzn_seasons
       ORDER BY
         CASE lower(status)
           WHEN 'live' THEN 0
           WHEN 'active' THEN 1
           WHEN 'registration_open' THEN 2
           WHEN 'upcoming' THEN 3
           WHEN 'completed' THEN 4
           ELSE 5
         END,
         datetime(starts_at) DESC,
         datetime(ends_at) DESC
       LIMIT ?`,
    )
    .bind(capped)
    .all<DznSeasonWithScoreStatusRow>();
  return (rows.results ?? []).map(toPublicSeason);
}

export async function getSeasonBySlug(env: Env, slug: string) {
  if (!env.DB) return null;
  await ensureDznSeasonSchema(env);
  const clean = cleanSlug(slug);
  if (!clean) return null;
  const row = await requireDb(env)
    .prepare(`SELECT ${PUBLIC_SEASON_SELECT} FROM dzn_seasons WHERE slug = ? OR id = ? LIMIT 1`)
    .bind(clean, clean)
    .first<DznSeasonWithScoreStatusRow>();
  return row ? toPublicSeason(row) : null;
}

export async function getEligibleServersForSeason(env: Env, seasonId: string) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.server_name,
              linked_servers.server_category,
              linked_servers.server_type,
              linked_servers.status,
              COALESCE(server_stats.total_kills, 0) AS total_kills,
              COALESCE(server_stats.total_deaths, 0) AS total_deaths,
              COALESCE(server_stats.total_joins, 0) AS total_joins,
              COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
              COALESCE(server_stats.unique_players, 0) AS unique_players,
              server_stats.last_event_at,
              server_stats.updated_at AS stats_updated_at
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .all<SeasonServerRow>();
  return (rows.results ?? [])
    .filter((server) => normalizeSeasonCategory(server.server_category ?? server.server_type) === season.category)
    .map(toPublicEligibleServer);
}

export async function joinServerToSeason(env: Env, serverId: string, seasonId: string) {
  await ensureDznSeasonSchema(env);
  const [season, server] = await Promise.all([findSeason(env, seasonId), getSeasonServer(env, serverId)]);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  if (!server) throw new DznSeasonError("SERVER_NOT_FOUND", "Server not found.", 404);
  if (!seasonOpenForJoin(season)) throw new DznSeasonError("SEASON_NOT_OPEN", "This season is not open for entry.", 400);
  const serverCategory = normalizeSeasonCategory(server.server_category ?? server.server_type);
  if (!serverCategory || serverCategory !== season.category) {
    throw new DznSeasonError("CATEGORY_MISMATCH", "Servers can only join DZN seasons that match their category.", 403);
  }
  const existing = await getSeasonEntry(env, season.id, server.id);
  if (existing && existing.status !== "withdrawn") {
    throw new DznSeasonError("ALREADY_JOINED", "This server has already joined that season.", 409);
  }

  const now = new Date().toISOString();
  const score = calculateSeasonScoreFromStats(server, season);
  const id = crypto.randomUUID();
  await requireDb(env)
    .prepare(
      `INSERT INTO dzn_season_entries (
        id, season_id, server_id, category, joined_at, status, snapshot_start_json, snapshot_current_json,
        final_score, rank, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'joined', ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(season_id, server_id) DO UPDATE SET
        status = CASE WHEN dzn_season_entries.status = 'withdrawn' THEN 'joined' ELSE dzn_season_entries.status END,
        snapshot_current_json = excluded.snapshot_current_json,
        final_score = excluded.final_score,
        updated_at = excluded.updated_at`,
    )
    .bind(id, season.id, server.id, season.category, now, safeJson(score.metrics), safeJson(score.metrics), score.score, now, now)
    .run();
  await refreshSeasonScores(env, season.id, 250);
  return getSeasonEntry(env, season.id, server.id);
}

export async function getServerSeasonStatus(env: Env, serverId: string) {
  if (!env.DB) {
    return {
      serverCategory: null,
      eligibleSeasons: [],
      joinedSeasons: [],
      ineligibleSeasons: [],
      activeEntries: [],
      upcomingEligible: [],
      categorySafetyMessage: CATEGORY_SAFETY_MESSAGE,
    };
  }
  await ensureDznSeasonSchema(env);
  const server = await getSeasonServer(env, serverId);
  if (!server) throw new DznSeasonError("SERVER_NOT_FOUND", "Server not found.", 404);
  const serverCategory = normalizeSeasonCategory(server.server_category ?? server.server_type);
  const seasons = await getPublicSeasons(env, 100);
  const entryRows = await requireDb(env)
    .prepare(
      `SELECT dzn_season_entries.*,
              dzn_seasons.slug,
              dzn_seasons.name,
              dzn_seasons.status AS season_status,
              dzn_seasons.starts_at,
              dzn_seasons.ends_at,
              (SELECT MAX(captured_at)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_season_entries.season_id
                 AND dzn_season_score_snapshots.server_id = dzn_season_entries.server_id) AS entry_last_score_refresh_at,
              (SELECT COUNT(*)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_season_entries.season_id
                 AND dzn_season_score_snapshots.server_id = dzn_season_entries.server_id) AS entry_score_snapshot_count
       FROM dzn_season_entries
       JOIN dzn_seasons ON dzn_seasons.id = dzn_season_entries.season_id
       WHERE dzn_season_entries.server_id = ?
         AND dzn_season_entries.status != 'withdrawn'
       ORDER BY datetime(dzn_seasons.starts_at) DESC`,
    )
    .bind(server.id)
    .all<DznSeasonEntryWithScoreStatusRow & {
      slug: string;
      name: string;
      season_status: string;
      starts_at: string;
      ends_at: string;
    }>();
  const entries = entryRows.results ?? [];
  const awardsBySeasonId = await getServerSeasonAwardMap(env, server.id);
  const entryBySeasonId = new Map(entries.map((entry) => [
    entry.season_id,
    { ...toPublicOwnerSeasonEntry(entry), awards: awardsBySeasonId.get(entry.season_id) ?? [] },
  ]));
  const eligibleSeasons = [];
  const joinedSeasons = [];
  const ineligibleSeasons = [];

  for (const season of seasons) {
    const entry = entryBySeasonId.get(season.id);
    if (entry) {
      joinedSeasons.push({ ...season, entry });
      continue;
    }
    if (!serverCategory) {
      ineligibleSeasons.push({ ...season, reason: "Set a server category before joining same-category seasons." });
      continue;
    }
    if (season.category !== serverCategory) {
      ineligibleSeasons.push({ ...season, reason: `Only ${categoryLabel(season.category)} servers can join this season.` });
      continue;
    }
    if (!seasonOpenForJoin({ ...season, starts_at: season.startsAt, ends_at: season.endsAt, scoring_rules_json: null, created_at: "", updated_at: "" } as DznSeasonRow)) {
      ineligibleSeasons.push({ ...season, reason: "This season is not open for entry." });
      continue;
    }
    eligibleSeasons.push(season);
  }

  return {
    serverCategory,
    eligibleSeasons,
    joinedSeasons,
    ineligibleSeasons,
    activeEntries: joinedSeasons.filter((season) => ACTIVE_SEASON_STATUSES.includes(String(season.status).toLowerCase())),
    upcomingEligible: eligibleSeasons.filter((season) => ["registration_open", "upcoming"].includes(String(season.status).toLowerCase())),
    categorySafetyMessage: CATEGORY_SAFETY_MESSAGE,
  };
}

export async function calculateSeasonScore(env: Env, serverId: string, season: DznSeasonRow | { id: string; category: string }) {
  const server = await getSeasonServer(env, serverId);
  if (!server) throw new DznSeasonError("SERVER_NOT_FOUND", "Server not found.", 404);
  const category = normalizeSeasonCategory(season.category);
  if (!category) throw new DznSeasonError("SEASON_CATEGORY_INVALID", "Season category is invalid.", 400);
  const serverCategory = normalizeSeasonCategory(server.server_category ?? server.server_type);
  if (!serverCategory || serverCategory !== category) {
    throw new DznSeasonError("CATEGORY_MISMATCH", "Servers can only refresh scores inside their joined season category.", 403);
  }
  return calculateSeasonScoreFromStats(server, { ...season, category } as DznSeasonRow);
}

export async function refreshActiveSeasonScores(env: Env, limit = SEASON_REFRESH_DEFAULT_LIMIT): Promise<DznActiveSeasonRefreshResult> {
  await ensureDznSeasonSchema(env);
  const capped = capRefreshLimit(limit, SEASON_REFRESH_DEFAULT_LIMIT, SEASON_REFRESH_MAX_LIMIT);
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM dzn_seasons
       WHERE lower(status) IN ('registration_open', 'active', 'live', 'upcoming')
       ORDER BY datetime(starts_at) ASC, datetime(ends_at) ASC`,
    )
    .all<DznSeasonRow>();

  let seasonsChecked = 0;
  let entriesRefreshed = 0;
  let snapshotsCreated = 0;
  let remaining = capped;
  const warnings: string[] = [];

  for (const season of rows.results ?? []) {
    if (remaining <= 0) {
      warnings.push(`Season refresh batch limit reached after ${entriesRefreshed} entries.`);
      break;
    }
    seasonsChecked += 1;
    const result = await refreshSeasonScores(env, season.id, {
      limit: remaining,
      maxLimit: SEASON_REFRESH_MAX_LIMIT,
      allowCompleted: false,
    });
    entriesRefreshed += result.refreshed;
    snapshotsCreated += result.snapshotsCreated;
    remaining -= result.refreshed;
    warnings.push(...result.warnings);
  }

  return { ok: true, seasonsChecked, entriesRefreshed, snapshotsCreated, warnings };
}

export async function refreshSeasonScores(env: Env, seasonId: string, limitOrOptions: number | DznSeasonRefreshOptions = 50): Promise<DznSeasonRefreshResult> {
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const options = normalizeRefreshOptions(limitOrOptions);
  const capturedAt = cleanCapturedAt(options.capturedAt) ?? new Date().toISOString();
  const warnings: string[] = [];

  if (isCompletedSeasonStatus(season.status) && !options.allowCompleted) {
    return {
      ok: true,
      seasonId: season.id,
      refreshed: 0,
      snapshotsCreated: 0,
      capturedAt,
      warnings: [`Season ${season.slug} is completed; score refresh skipped.`],
      entries: [],
    };
  }
  if (seasonEnded(season) && !isCompletedSeasonStatus(season.status)) {
    warnings.push(`Season ${season.slug} has ended; scores refreshed only, finalisation is still manual.`);
  }

  const capped = capRefreshLimit(options.limit, 50, options.maxLimit ?? INTERNAL_SEASON_REFRESH_MAX_LIMIT);
  const entries = await getSeasonEntriesForRefresh(env, season.id, capped);
  const scored: Array<{ entry: DznSeasonEntryRow; score: DznSeasonScoreResult }> = [];
  const seenServers = new Set<string>();
  for (const entry of entries) {
    if (seenServers.has(entry.server_id)) {
      warnings.push(`Duplicate season entry skipped for server ${entry.server_id}.`);
      continue;
    }
    seenServers.add(entry.server_id);
    if (normalizeSeasonCategory(entry.category) !== season.category) {
      warnings.push(`Entry ${entry.id} skipped because its category no longer matches season ${season.slug}.`);
      continue;
    }
    try {
      const score = await calculateSeasonScore(env, entry.server_id, season);
      scored.push({ entry, score });
    } catch (error) {
      if (error instanceof DznSeasonError) {
        warnings.push(`Entry ${entry.id} skipped: ${error.message}`);
        continue;
      }
      throw error;
    }
  }

  const refreshedByEntryId = new Map(scored.map((item) => [item.entry.id, item]));
  const allEntries = await getSeasonEntries(env, season.id, INTERNAL_SEASON_REFRESH_MAX_LIMIT);
  const ranked = allEntries
    .map((entry) => {
      const refreshed = refreshedByEntryId.get(entry.id);
      return {
        entry,
        score: refreshed ? refreshed.score.score : safeNumber(entry.final_score),
      };
    })
    .sort((a, b) => b.score - a.score || a.entry.joined_at.localeCompare(b.entry.joined_at));

  const rankByEntryId = new Map<string, number>();
  let rank = 1;
  for (const item of ranked) {
    rankByEntryId.set(item.entry.id, rank);
    rank += 1;
  }

  let snapshotsCreated = 0;
  const refreshedEntries: DznSeasonRefreshEntry[] = [];
  for (const item of scored) {
    const nextRank = rankByEntryId.get(item.entry.id) ?? null;
    const inserted = await insertSeasonScoreSnapshot(env, {
      seasonId: season.id,
      serverId: item.entry.server_id,
      score: item.score.score,
      rank: nextRank,
      metrics: item.score.metrics,
      capturedAt,
    });
    if (inserted) snapshotsCreated += 1;
    else warnings.push(`Snapshot already exists for server ${item.entry.server_id} at ${capturedAt}; duplicate skipped.`);
    await requireDb(env)
      .prepare("UPDATE dzn_season_entries SET snapshot_current_json = ?, final_score = ?, rank = ?, updated_at = ? WHERE id = ?")
      .bind(safeJson(item.score.metrics), item.score.score, nextRank, capturedAt, item.entry.id)
      .run();
    refreshedEntries.push({
      entryId: item.entry.id,
      seasonId: season.id,
      serverId: item.entry.server_id,
      score: item.score.score,
      rank: nextRank,
      capturedAt,
      metrics: item.score.metrics,
    });
  }

  for (const item of ranked) {
    if (refreshedByEntryId.has(item.entry.id)) continue;
    const nextRank = rankByEntryId.get(item.entry.id) ?? null;
    if (item.entry.rank === nextRank) continue;
    await requireDb(env)
      .prepare("UPDATE dzn_season_entries SET rank = ? WHERE id = ?")
      .bind(nextRank, item.entry.id)
      .run();
  }

  return {
    ok: true,
    refreshed: scored.length,
    seasonId: season.id,
    snapshotsCreated,
    capturedAt,
    warnings,
    entries: refreshedEntries,
  };
}

export async function finaliseSeason(env: Env, seasonId: string) {
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const refreshed = await refreshSeasonScores(env, season.id, { limit: 500, maxLimit: 500, allowCompleted: true });
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare("UPDATE dzn_seasons SET status = 'completed', updated_at = ? WHERE id = ?")
    .bind(now, season.id)
    .run();
  await requireDb(env)
    .prepare("UPDATE dzn_season_entries SET status = 'completed', updated_at = ? WHERE season_id = ? AND status != 'withdrawn'")
    .bind(now, season.id)
    .run();
  const awards = await awardSeasonBadges(env, season.id);
  return {
    ok: true,
    seasonId: season.id,
    entriesFinalised: refreshed.refreshed,
    awardsCreated: awards.awardsCreated,
    badgesAwarded: awards.badgesAwarded,
    warnings: awards.warnings,
    awards: awards.awards,
  };
}

export async function getSeasonLeaderboard(env: Env, seasonId: string) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const rows = await requireDb(env)
    .prepare(
      `SELECT dzn_season_entries.*,
              linked_servers.server_name,
              linked_servers.public_slug,
              (SELECT MAX(captured_at)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_season_entries.season_id
                 AND dzn_season_score_snapshots.server_id = dzn_season_entries.server_id) AS entry_last_score_refresh_at
       FROM dzn_season_entries
       JOIN linked_servers ON linked_servers.id = dzn_season_entries.server_id
       WHERE dzn_season_entries.season_id = ?
         AND dzn_season_entries.status != 'withdrawn'
       ORDER BY dzn_season_entries.rank ASC, dzn_season_entries.final_score DESC`,
    )
    .bind(season.id)
    .all<DznSeasonEntryRow & { server_name: string | null; public_slug: string | null }>();
  return (rows.results ?? []).map(toPublicLeaderboardEntry);
}

export async function awardSeasonBadges(env: Env, seasonId: string) {
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const leaderboard = await getSeasonLeaderboard(env, season.id);
  const winners = leaderboard.filter((entry) => Number(entry.rank ?? 0) > 0 && Number(entry.rank ?? 0) <= 3);
  const awarded = [];
  const warnings = [];
  let awardsCreated = 0;
  let badgesAwarded = 0;
  const now = new Date().toISOString();
  for (const entry of winners) {
    const rank = Number(entry.rank);
    const badgeCode = rank === 1 ? seasonalChampionBadgeFor(season) : null;
    const awardCode = badgeCode ?? seasonAwardCodeForRank(rank);
    const metadata = {
      seasonSlug: season.slug,
      seasonName: season.name,
      score: entry.score,
      badgeCode,
      awardLabel: seasonAwardLabelForRank(rank, badgeCode),
      permanentSeasonalBadge: Boolean(badgeCode && rank === 1),
    };
    const insert = await requireDb(env)
      .prepare(
        `INSERT INTO dzn_season_awards (id, season_id, server_id, award_code, rank, awarded_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(season_id, server_id, award_code) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), season.id, entry.serverId, awardCode, rank, now, safeJson(metadata))
      .run();
    if (Number((insert as { meta?: { changes?: number } }).meta?.changes ?? 0) > 0) awardsCreated += 1;
    let badgeAwarded = false;
    if (rank === 1 && badgeCode) {
      const hadBadge = await hasActiveSeasonBadge(env, entry.serverId, badgeCode);
      await awardBadge(env, entry.serverId, badgeCode, "season", { seasonId: season.id, seasonSlug: season.slug, rank, score: entry.score, permanent: true });
      badgeAwarded = !hadBadge;
      if (badgeAwarded) badgesAwarded += 1;
    }
    if (rank === 1 && !badgeCode) warnings.push(`No seasonal badge mapping found for season ${season.slug}; champion award stored as metadata only.`);
    awarded.push({ serverId: entry.serverId, awardCode, badgeCode, rank, badgeAwarded });
  }
  return { awardsCreated, badgesAwarded, awards: awarded, warnings };
}

export async function getSeasonAwards(env: Env, seasonId: string) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const rows = await requireDb(env)
    .prepare(
      `SELECT dzn_season_awards.*,
              linked_servers.server_name,
              linked_servers.public_slug
       FROM dzn_season_awards
       LEFT JOIN linked_servers ON linked_servers.id = dzn_season_awards.server_id
       WHERE dzn_season_awards.season_id = ?
       ORDER BY dzn_season_awards.rank ASC, datetime(dzn_season_awards.awarded_at) ASC`,
    )
    .bind(season.id)
    .all<DznSeasonAwardRow & { server_name: string | null; public_slug: string | null }>();
  return (rows.results ?? []).map(toPublicSeasonAward);
}

export async function getAdminSeasonManagement(env: Env, limit = 100): Promise<DznAdminSeasonManagement> {
  if (!env.DB) {
    return {
      ok: true,
      seasons: [],
      activeSeasons: [],
      upcomingSeasons: [],
      completedSeasons: [],
      warnings: ["D1 DB binding is not configured."],
    };
  }
  await ensureDznSeasonSchema(env);
  const capped = Math.max(1, Math.min(250, Math.round(Number(limit) || 100)));
  const seasonRows = await requireDb(env)
    .prepare(
      `SELECT dzn_seasons.*,
              (SELECT COUNT(*)
               FROM dzn_season_entries
               WHERE dzn_season_entries.season_id = dzn_seasons.id
                 AND dzn_season_entries.status != 'withdrawn') AS entry_count,
              (SELECT COUNT(*)
               FROM dzn_season_entries
               WHERE dzn_season_entries.season_id = dzn_seasons.id
                 AND dzn_season_entries.status != 'withdrawn'
                 AND dzn_season_entries.final_score IS NOT NULL
                 AND dzn_season_entries.rank IS NOT NULL) AS scored_entry_count,
              (SELECT COUNT(*)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_seasons.id) AS score_snapshot_count,
              (SELECT COUNT(*)
               FROM dzn_season_awards
               WHERE dzn_season_awards.season_id = dzn_seasons.id) AS awards_count,
              (SELECT MAX(captured_at)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_seasons.id) AS last_score_refresh_at
       FROM dzn_seasons
       ORDER BY
         CASE lower(status)
           WHEN 'live' THEN 0
           WHEN 'active' THEN 1
           WHEN 'registration_open' THEN 2
           WHEN 'upcoming' THEN 3
           WHEN 'completed' THEN 4
           WHEN 'finalised' THEN 5
           WHEN 'finalized' THEN 5
           ELSE 6
         END,
         datetime(starts_at) DESC,
         datetime(ends_at) DESC
       LIMIT ?`,
    )
    .bind(capped)
    .all<DznAdminSeasonRow>();

  const seasons: DznAdminSeasonSummary[] = [];
  for (const row of seasonRows.results ?? []) {
    const [entries, awards] = await Promise.all([
      getAdminSeasonEntries(env, row.id),
      getAdminSeasonAwards(env, row.id),
    ]);
    seasons.push(toAdminSeasonSummary(row, entries, awards));
  }

  return {
    ok: true,
    seasons,
    activeSeasons: seasons.filter((season) => ["live", "active"].includes(String(season.status).toLowerCase())),
    upcomingSeasons: seasons.filter((season) => ["registration_open", "upcoming"].includes(String(season.status).toLowerCase())),
    completedSeasons: seasons.filter((season) => isCompletedSeasonStatus(season.status)),
    warnings: [],
  };
}

export function getDefaultScoringRulesForCategory(categoryInput: unknown): DznSeasonScoringRules {
  const category = normalizeSeasonCategory(categoryInput);
  if (!category) throw new DznSeasonError("SEASON_CATEGORY_INVALID", "Season category must be Deathmatch, PvP, PvE, or Survival.", 400);
  const safe = (key: string, label: string, source: string, weight: number): DznSeasonScoringMetricRule => ({
    key,
    label,
    source,
    available: true,
    weight,
  });
  const placeholder = (key: string, label: string, note: string): DznSeasonScoringMetricRule => ({
    key,
    label,
    source: "aggregate_placeholder",
    available: false,
    placeholder: 0,
    weight: 0,
    note,
  });
  const shared = {
    version: 1 as const,
    category,
    missingMetricPolicy: "safe_zero_placeholder" as const,
  };
  if (category === "deathmatch") {
    return {
      ...shared,
      metrics: [
        safe("total_kills", "Total kills", "server_stats.total_kills", 60),
        safe("kd_ratio", "K/D", "derived:total_kills/total_deaths", 25),
        safe("activity", "Activity", "server_stats.total_joins + unique_players", 15),
      ],
    };
  }
  if (category === "pvp") {
    return {
      ...shared,
      metrics: [
        safe("total_kills", "Total kills", "server_stats.total_kills", 45),
        placeholder("longest_kill", "Longest kill", "Kept as safe zero until aggregate longest-kill input exists."),
        safe("kd_ratio", "K/D", "derived:total_kills/total_deaths", 25),
        safe("activity", "Activity", "server_stats.total_joins + unique_players", 15),
      ],
    };
  }
  if (category === "pve") {
    return {
      ...shared,
      metrics: [
        safe("activity", "Activity", "server_stats.total_joins + unique_players", 45),
        placeholder("survival_time", "Survival time", "Kept as safe zero until aggregate survival-time input exists."),
        safe("deaths_avoided", "Deaths avoided", "derived:activity - total_deaths", 25),
      ],
    };
  }
  return {
    ...shared,
    metrics: [
      placeholder("longest_lived", "Longest lived", "Kept as safe zero until aggregate longest-lived input exists."),
      safe("activity", "Activity", "server_stats.total_joins + unique_players", 45),
      safe("deaths_avoided", "Deaths avoided", "derived:activity - total_deaths", 25),
    ],
  };
}

export async function createAdminSeason(env: Env, input: DznAdminSeasonCreateInput): Promise<DznAdminSeasonMutationResult> {
  await ensureDznSeasonSchema(env);
  const category = requireSeasonCategory(input.category);
  const seasonInput = validateSeasonConfigInput({
    name: input.name,
    slug: input.slug,
    category,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    scoringRules: input.scoringRules,
    requireScoringRules: true,
  });
  const existing = await findSeason(env, seasonInput.slug);
  if (existing) throw new DznSeasonError("SEASON_SLUG_EXISTS", "A season with this slug already exists.", 409);
  const now = new Date().toISOString();
  const id = `season_${crypto.randomUUID()}`;
  await requireDb(env)
    .prepare(
      `INSERT INTO dzn_seasons (
        id, slug, name, category, status, starts_at, ends_at, scoring_rules_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?)`,
    )
    .bind(id, seasonInput.slug, seasonInput.name, seasonInput.category, seasonInput.startsAt, seasonInput.endsAt, safeJson(seasonInput.scoringRules), now, now)
    .run();
  const season = await getAdminSeasonSummaryById(env, id);
  return { ok: true, season, warnings: [] };
}

export async function updateAdminSeason(env: Env, seasonId: string, input: DznAdminSeasonUpdateInput): Promise<DznAdminSeasonMutationResult> {
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const entryCount = await countSeasonEntries(env, season.id);
  const completed = isCompletedSeasonStatus(season.status);
  const nextName = input.name === undefined ? season.name : cleanSeasonName(input.name);
  const nextSlug = input.slug === undefined ? season.slug : requireSeasonSlug(input.slug);
  const requestedCategory = input.category === undefined ? season.category : requireSeasonCategory(input.category);
  const requestedStatus = input.status === undefined ? season.status : requireSeasonStatus(input.status);
  const requestedStartsAt = input.startsAt === undefined ? season.starts_at : requireSeasonDate(input.startsAt, "startsAt");
  const requestedEndsAt = input.endsAt === undefined ? season.ends_at : requireSeasonDate(input.endsAt, "endsAt");
  const requestedRules = input.scoringRules === undefined ? parseJsonObject(season.scoring_rules_json) : requireScoringRules(input.scoringRules, requestedCategory);

  if (nextSlug !== season.slug) {
    const existing = await findSeason(env, nextSlug);
    if (existing && existing.id !== season.id) throw new DznSeasonError("SEASON_SLUG_EXISTS", "A season with this slug already exists.", 409);
  }
  if (requestedCategory !== season.category && entryCount > 0) {
    throw new DznSeasonError("SEASON_CATEGORY_LOCKED", "Category cannot be changed after season entries exist.", 409);
  }
  if (completed) {
    const destructiveEdit =
      requestedCategory !== season.category ||
      requestedStatus !== season.status ||
      requestedStartsAt !== season.starts_at ||
      requestedEndsAt !== season.ends_at ||
      input.scoringRules !== undefined;
    if (destructiveEdit) {
      throw new DznSeasonError("COMPLETED_SEASON_LOCKED", "Completed seasons only allow name or slug display corrections.", 409);
    }
  }
  ensureValidDateRange(requestedStartsAt, requestedEndsAt);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `UPDATE dzn_seasons
       SET name = ?,
           slug = ?,
           category = ?,
           status = ?,
           starts_at = ?,
           ends_at = ?,
           scoring_rules_json = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextName, nextSlug, requestedCategory, requestedStatus, requestedStartsAt, requestedEndsAt, safeJson(requestedRules), now, season.id)
    .run();
  const updated = await getAdminSeasonSummaryById(env, season.id);
  return { ok: true, season: updated, warnings: [] };
}

export async function ensureDznSeasonSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of DZN_SEASON_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export function calculateSeasonScoreFromStats(server: SeasonServerRow, season: Pick<DznSeasonRow, "category">): DznSeasonScoreResult {
  const kills = safeNumber(server.total_kills);
  const deaths = safeNumber(server.total_deaths);
  const joins = safeNumber(server.total_joins);
  const disconnects = safeNumber(server.total_disconnects);
  const uniquePlayers = safeNumber(server.unique_players);
  const kd = deaths > 0 ? kills / deaths : kills > 0 ? kills : 0;
  const activity = joins + uniquePlayers * 2 + Math.max(0, disconnects) * 0.25;
  const deathsAvoided = Math.max(0, joins - deaths);
  const baseMetrics = {
    totalKills: kills,
    totalDeaths: deaths,
    totalJoins: joins,
    totalDisconnects: disconnects,
    uniquePlayers,
    kd: Math.round(kd * 100) / 100,
    activity: Math.round(activity),
    lastEventAt: server.last_event_at ?? "",
  };

  if (season.category === "deathmatch") {
    return result(kills * 10 + kd * 100 + activity, { ...baseMetrics, categoryScoring: "deathmatch" }, []);
  }
  if (season.category === "pvp") {
    return result(kills * 8 + kd * 80 + activity, { ...baseMetrics, longestKill: 0, categoryScoring: "pvp" }, ["longest_kill"]);
  }
  if (season.category === "pve") {
    return result(activity + deathsAvoided * 5, { ...baseMetrics, deathsAvoided, survivalTime: 0, categoryScoring: "pve" }, ["survival_time"]);
  }
  return result(activity + deathsAvoided * 8, { ...baseMetrics, deathsAvoided, longestLived: 0, categoryScoring: "survival" }, ["longest_lived"]);
}

export function normalizeSeasonCategory(value: unknown): DznSeasonCategory | null {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[()]/g, "").replace(/[\s/-]+/g, "_");
  if (!raw) return null;
  if (["deathmatch", "death_match", "dm"].includes(raw)) return "deathmatch";
  if (["pvp", "pvp_only", "player_versus_player"].includes(raw)) return "pvp";
  if (["pve", "pve_only", "player_versus_environment"].includes(raw)) return "pve";
  if (["survival", "survival_server"].includes(raw)) return "survival";
  return null;
}

async function findSeason(env: Env, rawSeasonId: unknown): Promise<DznSeasonRow | null> {
  const value = cleanSlug(rawSeasonId);
  if (!value) return null;
  const row = await requireDb(env)
    .prepare("SELECT * FROM dzn_seasons WHERE id = ? OR slug = ? LIMIT 1")
    .bind(value, value)
    .first<DznSeasonRow>();
  return row ? { ...row, category: normalizeSeasonCategory(row.category) ?? row.category } as DznSeasonRow : null;
}

async function getSeasonServer(env: Env, rawServerId: unknown): Promise<SeasonServerRow | null> {
  const serverId = cleanIdentifier(rawServerId);
  if (!serverId) return null;
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.server_name,
              linked_servers.server_category,
              linked_servers.server_type,
              linked_servers.status,
              COALESCE(server_stats.total_kills, 0) AS total_kills,
              COALESCE(server_stats.total_deaths, 0) AS total_deaths,
              COALESCE(server_stats.total_joins, 0) AS total_joins,
              COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
              COALESCE(server_stats.unique_players, 0) AS unique_players,
              server_stats.last_event_at,
              server_stats.updated_at AS stats_updated_at
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       WHERE (linked_servers.id = ? OR linked_servers.nitrado_service_id = ? OR linked_servers.public_slug = ?)
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(serverId, serverId, serverId)
    .first<SeasonServerRow>();
}

async function getSeasonEntry(env: Env, seasonId: string, serverId: string) {
  const row = await requireDb(env)
    .prepare("SELECT * FROM dzn_season_entries WHERE season_id = ? AND server_id = ? LIMIT 1")
    .bind(seasonId, serverId)
    .first<DznSeasonEntryRow>();
  return row ? toPublicSeasonEntry(row) : null;
}

async function getSeasonEntries(env: Env, seasonId: string, limit: number) {
  const capped = Math.max(1, Math.min(500, Math.round(limit)));
  const rows = await requireDb(env)
    .prepare("SELECT * FROM dzn_season_entries WHERE season_id = ? AND status != 'withdrawn' ORDER BY datetime(joined_at) ASC LIMIT ?")
    .bind(seasonId, capped)
    .all<DznSeasonEntryRow>();
  return rows.results ?? [];
}

async function getSeasonEntriesForRefresh(env: Env, seasonId: string, limit: number) {
  const capped = capRefreshLimit(limit, SEASON_REFRESH_DEFAULT_LIMIT, INTERNAL_SEASON_REFRESH_MAX_LIMIT);
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM dzn_season_entries
       WHERE season_id = ?
         AND status != 'withdrawn'
       ORDER BY datetime(COALESCE(updated_at, joined_at)) ASC, datetime(joined_at) ASC
       LIMIT ?`,
    )
    .bind(seasonId, capped)
    .all<DznSeasonEntryRow>();
  return rows.results ?? [];
}

function seasonOpenForJoin(season: DznSeasonRow) {
  return ACTIVE_SEASON_STATUSES.includes(String(season.status ?? "").toLowerCase());
}

function isCompletedSeasonStatus(status: unknown) {
  return COMPLETED_SEASON_STATUSES.includes(String(status ?? "").toLowerCase());
}

function seasonEnded(season: Pick<DznSeasonRow, "ends_at">) {
  const endsAt = new Date(season.ends_at);
  return !Number.isNaN(endsAt.getTime()) && endsAt.getTime() <= Date.now();
}

function seasonRefreshCopy(season: Pick<DznSeasonRow, "status" | "ends_at">) {
  if (isCompletedSeasonStatus(season.status)) return null;
  if (seasonEnded(season)) return "Final score refresh is available for DZN staff before manual finalisation.";
  if (ACTIVE_SEASON_STATUSES.includes(String(season.status ?? "").toLowerCase())) return "Scores refresh automatically in small safe batches.";
  return null;
}

function normalizeRefreshOptions(limitOrOptions: number | DznSeasonRefreshOptions): Required<DznSeasonRefreshOptions> {
  if (typeof limitOrOptions === "number") {
    return {
      limit: limitOrOptions,
      maxLimit: INTERNAL_SEASON_REFRESH_MAX_LIMIT,
      allowCompleted: false,
      capturedAt: null,
    };
  }
  return {
    limit: limitOrOptions.limit ?? 50,
    maxLimit: limitOrOptions.maxLimit ?? INTERNAL_SEASON_REFRESH_MAX_LIMIT,
    allowCompleted: limitOrOptions.allowCompleted === true,
    capturedAt: limitOrOptions.capturedAt ?? null,
  };
}

function capRefreshLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function cleanCapturedAt(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toPublicSeason(row: DznSeasonRow) {
  const statusRow = row as DznSeasonWithScoreStatusRow;
  const snapshotCount = safeNumber(statusRow.score_snapshot_count);
  const lastScoreRefreshAt = statusRow.last_score_refresh_at ?? null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scoringRules: parseJsonObject(row.scoring_rules_json),
    lastScoreRefreshAt,
    hasScoreSnapshots: snapshotCount > 0,
    leaderboardState: snapshotCount > 0 ? "ready" : "waiting_for_first_score_snapshot",
    nextRefreshCopy: seasonRefreshCopy(row),
  };
}

function toPublicEligibleServer(row: SeasonServerRow) {
  return {
    id: row.id,
    name: row.server_name ?? "Unnamed server",
    category: normalizeSeasonCategory(row.server_category ?? row.server_type),
    statsUpdatedAt: row.stats_updated_at,
  };
}

function toPublicSeasonEntry(row: DznSeasonEntryRow) {
  const statusRow = row as DznSeasonEntryWithScoreStatusRow;
  const snapshotCount = safeNumber(statusRow.entry_score_snapshot_count);
  return {
    id: row.id,
    seasonId: row.season_id,
    serverId: row.server_id,
    category: row.category,
    joinedAt: row.joined_at,
    status: row.status,
    finalScore: row.final_score === null || row.final_score === undefined ? null : safeNumber(row.final_score),
    rank: row.rank,
    snapshotCurrent: parseJsonObject(row.snapshot_current_json),
    lastScoreRefreshAt: statusRow.entry_last_score_refresh_at ?? null,
    hasScoreSnapshot: snapshotCount > 0,
    leaderboardState: snapshotCount > 0 ? "ready" : "waiting_for_first_score_snapshot",
  };
}

function toPublicOwnerSeasonEntry(row: DznSeasonEntryRow & {
  slug: string;
  name: string;
  season_status: string;
  starts_at: string;
  ends_at: string;
}) {
  return {
    ...toPublicSeasonEntry(row),
    seasonSlug: row.slug,
    seasonName: row.name,
    seasonStatus: row.season_status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

function toPublicSeasonAward(row: DznSeasonAwardRow & { server_name?: string | null; public_slug?: string | null }) {
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    seasonId: row.season_id,
    serverId: row.server_id,
    serverName: row.server_name ?? "Unnamed server",
    publicSlug: row.public_slug ?? null,
    awardCode: row.award_code,
    badgeCode: typeof metadata.badgeCode === "string" ? metadata.badgeCode : (SEASONAL_BADGE_CODES.has(row.award_code) ? row.award_code : null),
    label: typeof metadata.awardLabel === "string" ? metadata.awardLabel : seasonAwardLabelForRank(Number(row.rank ?? 0), null),
    rank: row.rank,
    awardedAt: row.awarded_at,
    metadata,
  };
}

function toPublicLeaderboardEntry(row: DznSeasonEntryRow & { server_name: string | null; public_slug: string | null; entry_last_score_refresh_at?: string | null }) {
  return {
    entryId: row.id,
    seasonId: row.season_id,
    serverId: row.server_id,
    serverName: row.server_name ?? "Unnamed server",
    publicSlug: row.public_slug,
    category: row.category,
    score: safeNumber(row.final_score),
    rank: row.rank,
    metrics: parseJsonObject(row.snapshot_current_json),
    lastScoreRefreshAt: row.entry_last_score_refresh_at ?? null,
  };
}

async function getAdminSeasonEntries(env: Env, seasonId: string): Promise<DznAdminSeasonEntry[]> {
  const rows = await requireDb(env)
    .prepare(
      `SELECT dzn_season_entries.*,
              (SELECT MAX(captured_at)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_season_entries.season_id
                 AND dzn_season_score_snapshots.server_id = dzn_season_entries.server_id) AS entry_last_score_refresh_at,
              (SELECT COUNT(*)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_season_entries.season_id
                 AND dzn_season_score_snapshots.server_id = dzn_season_entries.server_id) AS entry_score_snapshot_count
       FROM dzn_season_entries
       WHERE season_id = ?
         AND status != 'withdrawn'
       ORDER BY
         CASE WHEN rank IS NULL THEN 1 ELSE 0 END,
         rank ASC,
         final_score DESC,
         datetime(joined_at) ASC
       LIMIT 250`,
    )
    .bind(seasonId)
    .all<DznSeasonEntryWithScoreStatusRow>();
  return (rows.results ?? []).map((row) => {
    const snapshotCount = safeNumber(row.entry_score_snapshot_count);
    return {
      id: row.id,
      seasonId: row.season_id,
      serverId: row.server_id,
      category: row.category,
      joinedAt: row.joined_at,
      status: row.status,
      score: row.final_score === null || row.final_score === undefined ? null : safeNumber(row.final_score),
      rank: row.rank,
      lastScoreRefreshAt: row.entry_last_score_refresh_at ?? null,
      hasScoreSnapshot: snapshotCount > 0,
    };
  });
}

async function getAdminSeasonAwards(env: Env, seasonId: string): Promise<DznAdminSeasonAward[]> {
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM dzn_season_awards
       WHERE season_id = ?
       ORDER BY
         CASE WHEN rank IS NULL THEN 1 ELSE 0 END,
         rank ASC,
         datetime(awarded_at) DESC
       LIMIT 250`,
    )
    .bind(seasonId)
    .all<DznSeasonAwardRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    seasonId: row.season_id,
    serverId: row.server_id,
    awardCode: row.award_code,
    rank: row.rank,
    awardedAt: row.awarded_at,
    metadata: parseJsonObject(row.metadata_json),
  }));
}

function toAdminSeasonSummary(row: DznAdminSeasonRow, entries: DznAdminSeasonEntry[], awards: DznAdminSeasonAward[]): DznAdminSeasonSummary {
  const entryCount = safeNumber(row.entry_count);
  const scoredEntryCount = safeNumber(row.scored_entry_count);
  const scoreSnapshotCount = safeNumber(row.score_snapshot_count);
  const awardsCount = safeNumber(row.awards_count);
  const completed = isCompletedSeasonStatus(row.status);
  const ended = seasonEnded(row);
  const canRefresh = !completed && entryCount > 0;
  const canFinalise = !completed && ended && entryCount > 0 && scoredEntryCount > 0;
  const warnings = adminSeasonWarnings({ row, entryCount, scoredEntryCount, canFinalise, completed });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scoringRules: parseJsonObject(row.scoring_rules_json),
    entryCount,
    scoredEntryCount,
    scoreSnapshotCount,
    awardsCount,
    lastScoreRefreshAt: row.last_score_refresh_at ?? null,
    awardFinaliseStatus: adminAwardFinaliseStatus({ row, entryCount, scoredEntryCount, awardsCount, canFinalise, completed, ended }),
    canRefresh,
    canFinalise,
    warnings,
    entries,
    awards,
  };
}

function adminSeasonWarnings(input: {
  row: DznAdminSeasonRow;
  entryCount: number;
  scoredEntryCount: number;
  canFinalise: boolean;
  completed: boolean;
}) {
  const warnings: string[] = [];
  if (!input.completed && input.entryCount <= 0) warnings.push("No season entries yet.");
  if (!input.completed && input.entryCount > 0 && input.scoredEntryCount <= 0) warnings.push("Refresh scores before finalising.");
  if (input.canFinalise) warnings.push("Finalise awards permanent seasonal badges.");
  if (input.completed && safeNumber(input.row.awards_count) <= 0) warnings.push("Season is completed with no stored awards.");
  return warnings;
}

function adminAwardFinaliseStatus(input: {
  row: DznAdminSeasonRow;
  entryCount: number;
  scoredEntryCount: number;
  awardsCount: number;
  canFinalise: boolean;
  completed: boolean;
  ended: boolean;
}) {
  if (input.completed && input.awardsCount > 0) return "finalised_with_awards";
  if (input.completed) return "finalised_no_awards";
  if (input.canFinalise) return "ready_to_finalise";
  if (input.entryCount <= 0) return "no_entries";
  if (input.scoredEntryCount <= 0) return "needs_score_refresh";
  if (!input.ended) return "not_ended";
  return "blocked";
}

async function getAdminSeasonSummaryById(env: Env, seasonId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT dzn_seasons.*,
              (SELECT COUNT(*)
               FROM dzn_season_entries
               WHERE dzn_season_entries.season_id = dzn_seasons.id
                 AND dzn_season_entries.status != 'withdrawn') AS entry_count,
              (SELECT COUNT(*)
               FROM dzn_season_entries
               WHERE dzn_season_entries.season_id = dzn_seasons.id
                 AND dzn_season_entries.status != 'withdrawn'
                 AND dzn_season_entries.final_score IS NOT NULL
                 AND dzn_season_entries.rank IS NOT NULL) AS scored_entry_count,
              (SELECT COUNT(*)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_seasons.id) AS score_snapshot_count,
              (SELECT COUNT(*)
               FROM dzn_season_awards
               WHERE dzn_season_awards.season_id = dzn_seasons.id) AS awards_count,
              (SELECT MAX(captured_at)
               FROM dzn_season_score_snapshots
               WHERE dzn_season_score_snapshots.season_id = dzn_seasons.id) AS last_score_refresh_at
       FROM dzn_seasons
       WHERE dzn_seasons.id = ?
       LIMIT 1`,
    )
    .bind(seasonId)
    .first<DznAdminSeasonRow>();
  if (!row) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const [entries, awards] = await Promise.all([
    getAdminSeasonEntries(env, row.id),
    getAdminSeasonAwards(env, row.id),
  ]);
  return toAdminSeasonSummary(row, entries, awards);
}

function validateSeasonConfigInput(input: {
  name: unknown;
  slug: unknown;
  category: DznSeasonCategory;
  startsAt: unknown;
  endsAt: unknown;
  scoringRules: unknown;
  requireScoringRules: boolean;
}) {
  const startsAt = requireSeasonDate(input.startsAt, "startsAt");
  const endsAt = requireSeasonDate(input.endsAt, "endsAt");
  ensureValidDateRange(startsAt, endsAt);
  return {
    name: cleanSeasonName(input.name),
    slug: requireSeasonSlug(input.slug),
    category: input.category,
    startsAt,
    endsAt,
    scoringRules: input.requireScoringRules ? requireScoringRules(input.scoringRules, input.category) : parseOptionalScoringRules(input.scoringRules, input.category),
  };
}

async function countSeasonEntries(env: Env, seasonId: string) {
  const row = await requireDb(env)
    .prepare(
      `SELECT COUNT(*) AS count
       FROM dzn_season_entries
       WHERE season_id = ?
         AND status != 'withdrawn'`,
    )
    .bind(seasonId)
    .first<{ count: number | null }>();
  return safeNumber(row?.count);
}

function cleanSeasonName(value: unknown) {
  const text = String(value ?? "").trim();
  if (text.length < 3 || text.length > 120) throw new DznSeasonError("SEASON_NAME_INVALID", "Season name must be 3 to 120 characters.", 400);
  return text;
}

function requireSeasonSlug(value: unknown) {
  const slug = cleanSlug(value);
  if (!slug) throw new DznSeasonError("SEASON_SLUG_INVALID", "Season slug must be 3 to 120 lowercase letters, numbers, dashes, or underscores.", 400);
  return slug;
}

function requireSeasonCategory(value: unknown): DznSeasonCategory {
  const category = normalizeSeasonCategory(value);
  if (!category) throw new DznSeasonError("SEASON_CATEGORY_INVALID", "Season category must be Deathmatch, PvP, PvE, or Survival.", 400);
  return category;
}

function requireSeasonStatus(value: unknown) {
  const status = String(value ?? "").trim().toLowerCase();
  if (!ALLOWED_ADMIN_SEASON_STATUSES.has(status)) {
    throw new DznSeasonError("SEASON_STATUS_INVALID", "Season status is invalid.", 400);
  }
  return status;
}

function requireSeasonDate(value: unknown, field: "startsAt" | "endsAt") {
  const text = String(value ?? "").trim();
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw new DznSeasonError("SEASON_DATE_INVALID", `${field} must be a valid date.`, 400);
  return date.toISOString();
}

function ensureValidDateRange(startsAt: string, endsAt: string) {
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new DznSeasonError("SEASON_DATE_RANGE_INVALID", "Season start must be before season end.", 400);
  }
}

function parseOptionalScoringRules(value: unknown, category: DznSeasonCategory) {
  if (value === undefined || value === null) return getDefaultScoringRulesForCategory(category);
  return requireScoringRules(value, category);
}

function requireScoringRules(value: unknown, category: DznSeasonCategory): Record<string, unknown> {
  const parsed = parseScoringRulesInput(value);
  if (!parsed) throw new DznSeasonError("SEASON_SCORING_RULES_INVALID", "Scoring rules must be a valid JSON object.", 400);
  return { ...parsed, category };
}

function parseScoringRulesInput(value: unknown) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(value) ? value as Record<string, unknown> : null;
}

function isPlainObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function insertSeasonScoreSnapshot(env: Env, input: {
  seasonId: string;
  serverId: string;
  score: number;
  rank: number | null;
  metrics: Record<string, number | string | boolean>;
  capturedAt: string;
}) {
  const existing = await requireDb(env)
    .prepare(
      `SELECT id
       FROM dzn_season_score_snapshots
       WHERE season_id = ? AND server_id = ? AND captured_at = ?
       LIMIT 1`,
    )
    .bind(input.seasonId, input.serverId, input.capturedAt)
    .first<{ id: string }>();
  if (existing?.id) return false;
  await requireDb(env)
    .prepare(
      `INSERT INTO dzn_season_score_snapshots (id, season_id, server_id, score, rank, metrics_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), input.seasonId, input.serverId, input.score, input.rank, safeJson(input.metrics), input.capturedAt)
    .run();
  return true;
}

function seasonalChampionBadgeFor(season: Pick<DznSeasonRow, "name" | "slug" | "starts_at">) {
  const text = `${season.slug} ${season.name}`.toLowerCase();
  if (text.includes("spring")) return "spring_champion";
  if (text.includes("summer")) return "summer_champion";
  if (text.includes("autumn") || text.includes("fall")) return "autumn_champion";
  if (text.includes("winter")) return "winter_champion";
  if (text.includes("halloween")) return "halloween_champion";
  if (text.includes("christmas")) return "christmas_champion";
  if (text.includes("easter")) return "easter_champion";
  if (text.includes("new_year") || text.includes("new-year") || text.includes("new year")) return "new_year_champion";
  const startsAt = new Date(season.starts_at);
  if (Number.isNaN(startsAt.getTime())) return null;
  const month = startsAt.getUTCMonth();
  if (month >= 2 && month <= 4) return "spring_champion";
  if (month >= 5 && month <= 7) return "summer_champion";
  if (month >= 8 && month <= 10) return "autumn_champion";
  return "winter_champion";
}

function seasonAwardCodeForRank(rank: number) {
  if (rank === 1) return "season_champion";
  if (rank === 2) return "season_runner_up";
  if (rank === 3) return "season_third_place";
  return "season_participant";
}

function seasonAwardLabelForRank(rank: number, badgeCode: string | null) {
  if (badgeCode) return humanizeBadgeCode(badgeCode);
  if (rank === 1) return "Season Champion";
  if (rank === 2) return "Season Runner-up";
  if (rank === 3) return "Season Third Place";
  return "Season Award";
}

async function hasActiveSeasonBadge(env: Env, serverId: string, badgeCode: string) {
  try {
    const existing = await requireDb(env)
      .prepare("SELECT id FROM server_badge_awards WHERE server_id = ? AND badge_code = ? AND is_active = 1 LIMIT 1")
      .bind(serverId, badgeCode)
      .first<{ id: string }>();
    return Boolean(existing?.id);
  } catch {
    return false;
  }
}

async function getServerSeasonAwardMap(env: Env, serverId: string) {
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM dzn_season_awards
       WHERE server_id = ?
       ORDER BY rank ASC, datetime(awarded_at) DESC`,
    )
    .bind(serverId)
    .all<DznSeasonAwardRow>();
  const bySeasonId = new Map<string, ReturnType<typeof toPublicSeasonAward>[]>();
  for (const row of rows.results ?? []) {
    const awards = bySeasonId.get(row.season_id) ?? [];
    awards.push(toPublicSeasonAward(row));
    bySeasonId.set(row.season_id, awards);
  }
  return bySeasonId;
}

function humanizeBadgeCode(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function result(score: number, metrics: Record<string, number | string | boolean>, missingMetrics: string[]): DznSeasonScoreResult {
  return {
    score: Math.max(0, Math.round(score)),
    metrics: { ...metrics, missingMetrics: missingMetrics.join(",") },
    missingMetrics,
  };
}

function parseJsonObject(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function safeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function categoryLabel(category: string) {
  if (category === "deathmatch") return "Deathmatch";
  if (category === "pvp") return "PvP";
  if (category === "pve") return "PvE";
  if (category === "survival") return "Survival";
  return "same-category";
}

const CATEGORY_SAFETY_MESSAGE = "Servers only compete against the same category.";

const SEASONAL_BADGE_CODES = new Set([
  "spring_champion",
  "summer_champion",
  "autumn_champion",
  "winter_champion",
  "halloween_champion",
  "christmas_champion",
  "easter_champion",
  "new_year_champion",
]);

function cleanIdentifier(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{3,120}$/.test(text) ? text : "";
}

function cleanSlug(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{3,120}$/.test(text) ? text : "";
}

const DZN_SEASON_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dzn_seasons (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    scoring_rules_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dzn_seasons_status_dates ON dzn_seasons(status, starts_at, ends_at)",
  "CREATE INDEX IF NOT EXISTS idx_dzn_seasons_category ON dzn_seasons(category, status)",
  `CREATE TABLE IF NOT EXISTS dzn_season_entries (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    category TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    status TEXT NOT NULL,
    snapshot_start_json TEXT,
    snapshot_current_json TEXT,
    final_score REAL,
    rank INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(season_id, server_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dzn_season_entries_season_rank ON dzn_season_entries(season_id, rank)",
  "CREATE INDEX IF NOT EXISTS idx_dzn_season_entries_server ON dzn_season_entries(server_id, status)",
  `CREATE TABLE IF NOT EXISTS dzn_season_score_snapshots (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    rank INTEGER,
    metrics_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dzn_season_score_snapshots_season ON dzn_season_score_snapshots(season_id, captured_at)",
  "CREATE INDEX IF NOT EXISTS idx_dzn_season_score_snapshots_server ON dzn_season_score_snapshots(server_id, captured_at)",
  `CREATE TABLE IF NOT EXISTS dzn_season_awards (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    server_id TEXT NOT NULL,
    award_code TEXT NOT NULL,
    rank INTEGER,
    awarded_at TEXT NOT NULL,
    metadata_json TEXT,
    UNIQUE(season_id, server_id, award_code)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dzn_season_awards_season ON dzn_season_awards(season_id, rank)",
  "CREATE INDEX IF NOT EXISTS idx_dzn_season_awards_server ON dzn_season_awards(server_id, awarded_at)",
];
