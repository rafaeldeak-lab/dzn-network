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

const ACTIVE_SEASON_STATUSES = ["registration_open", "active", "live", "upcoming"];

export async function getActiveSeasons(env: Env) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
       FROM dzn_seasons
       WHERE lower(status) IN ('registration_open', 'active', 'live', 'upcoming')
       ORDER BY datetime(starts_at) ASC, datetime(ends_at) ASC`,
    )
    .all<DznSeasonRow>();
  return (rows.results ?? []).map(toPublicSeason);
}

export async function getPublicSeasons(env: Env, limit = 100) {
  if (!env.DB) return [];
  await ensureDznSeasonSchema(env);
  const capped = Math.max(1, Math.min(250, Math.round(limit)));
  const rows = await requireDb(env)
    .prepare(
      `SELECT *
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
    .all<DznSeasonRow>();
  return (rows.results ?? []).map(toPublicSeason);
}

export async function getSeasonBySlug(env: Env, slug: string) {
  if (!env.DB) return null;
  await ensureDznSeasonSchema(env);
  const clean = cleanSlug(slug);
  if (!clean) return null;
  const row = await requireDb(env)
    .prepare("SELECT * FROM dzn_seasons WHERE slug = ? OR id = ? LIMIT 1")
    .bind(clean, clean)
    .first<DznSeasonRow>();
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
              dzn_seasons.ends_at
       FROM dzn_season_entries
       JOIN dzn_seasons ON dzn_seasons.id = dzn_season_entries.season_id
       WHERE dzn_season_entries.server_id = ?
         AND dzn_season_entries.status != 'withdrawn'
       ORDER BY datetime(dzn_seasons.starts_at) DESC`,
    )
    .bind(server.id)
    .all<DznSeasonEntryRow & {
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
  return calculateSeasonScoreFromStats(server, { ...season, category } as DznSeasonRow);
}

export async function refreshSeasonScores(env: Env, seasonId: string, limit = 50) {
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const entries = await getSeasonEntries(env, season.id, limit);
  const scored = [];
  for (const entry of entries) {
    const score = await calculateSeasonScore(env, entry.server_id, season);
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score.score - a.score.score || a.entry.joined_at.localeCompare(b.entry.joined_at));

  const capturedAt = new Date().toISOString();
  let rank = 1;
  for (const item of scored) {
    await requireDb(env)
      .prepare(
        `INSERT INTO dzn_season_score_snapshots (id, season_id, server_id, score, rank, metrics_json, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), season.id, item.entry.server_id, item.score.score, rank, safeJson(item.score.metrics), capturedAt)
      .run();
    await requireDb(env)
      .prepare("UPDATE dzn_season_entries SET snapshot_current_json = ?, final_score = ?, rank = ?, updated_at = ? WHERE id = ?")
      .bind(safeJson(item.score.metrics), item.score.score, rank, capturedAt, item.entry.id)
      .run();
    rank += 1;
  }
  return { refreshed: scored.length, seasonId: season.id };
}

export async function finaliseSeason(env: Env, seasonId: string) {
  await ensureDznSeasonSchema(env);
  const season = await findSeason(env, seasonId);
  if (!season) throw new DznSeasonError("SEASON_NOT_FOUND", "Season not found.", 404);
  const refreshed = await refreshSeasonScores(env, season.id, 500);
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
  await refreshSeasonScores(env, season.id, 100);
  const rows = await requireDb(env)
    .prepare(
      `SELECT dzn_season_entries.*,
              linked_servers.server_name,
              linked_servers.public_slug
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

function seasonOpenForJoin(season: DznSeasonRow) {
  return ACTIVE_SEASON_STATUSES.includes(String(season.status ?? "").toLowerCase());
}

function toPublicSeason(row: DznSeasonRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    scoringRules: parseJsonObject(row.scoring_rules_json),
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
  return {
    id: row.id,
    seasonId: row.season_id,
    serverId: row.server_id,
    category: row.category,
    joinedAt: row.joined_at,
    status: row.status,
    finalScore: safeNumber(row.final_score),
    rank: row.rank,
    snapshotCurrent: parseJsonObject(row.snapshot_current_json),
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

function toPublicLeaderboardEntry(row: DznSeasonEntryRow & { server_name: string | null; public_slug: string | null }) {
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
  };
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
