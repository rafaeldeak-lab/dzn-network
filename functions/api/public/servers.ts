import { ensureAdmSyncSchema } from "../../_lib/adm-sync";
import { advertisingSortScore, publicAdvertisingFromState, type PublicAdvertising } from "../../_lib/advertising";
import { ensureLinkedServerMetadataColumns, requireDb } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, isMockNitrado } from "../../_lib/mock";
import { uniquePublicSlug } from "../../_lib/onboarding";
import { ensureBillingSchema } from "../../_lib/plans";
import { isPublicViewerLoggedIn, publicAccessCacheHeaders, publicApiErrorHeaders } from "../../_lib/public-auth";
import {
  logPublicApi503RootCause,
  logPublicApiLoadFailed,
  logPublicApiSnapshotFallbackServed,
  publicApiSnapshotAccess,
  publicApiSnapshotFallbackHeaders,
  publicApiSnapshotKey,
  readPublicApiCache,
  safePublicCacheError,
  withPublicApiMetadata,
  writePublicApiCache,
} from "../../_lib/public-api-cache";
import { getPublicServerLeaderboardById, getRankedPublicServers, type PublicLeaderboardPlayer, type PublicLeaderboardServer } from "../../_lib/public-leaderboards";
import type { ServerScoreBreakdown } from "../../_lib/server-ranking";
import type { Env, PagesFunction } from "../../_lib/types";

type PublicServerRow = {
  id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string;
  tags_json: string | null;
  status: string;
  nitrado_service_id: string | null;
  nitrado_service_name: string | null;
  player_slots: number | null;
  max_players: number | null;
  current_players: number | null;
  platform: string | null;
  map_name: string | null;
  mission: string | null;
  server_mode: string | null;
  server_status: string | null;
  is_online: number | null;
  metadata_last_checked_at: string | null;
  player_count_last_checked_at: string | null;
  player_count_source: string | null;
  player_count_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  adm_path: string | null;
  adm_logs_found: number | null;
  adm_last_checked_at: string | null;
  adm_sync_latest_file: string | null;
  adm_sync_latest_path: string | null;
  adm_sync_status: string | null;
  adm_sync_message: string | null;
  adm_sync_at: string | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_joins: number | null;
  total_disconnects: number | null;
  unique_players: number | null;
  server_stats_updated_at: string | null;
  public_cache_updated_at: string | null;
  latest_success_sync_status: string | null;
  latest_success_sync_trigger: string | null;
  latest_success_sync_at: string | null;
  public_short_description: string | null;
  public_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  public_rules: string | null;
  public_language: string | null;
  public_region_label: string | null;
  public_listing_updated_at: string | null;
  last_bumped_at: string | null;
  bump_count_current_period: number | null;
  bump_period_start: string | null;
  bump_period_end: string | null;
  featured_until: string | null;
  featured_label: string | null;
};

type PublicRecentEvent = {
  source: "kill" | "player";
  event_type: string;
  label: string;
  player_name: string | null;
  killer_name: string | null;
  victim_name: string | null;
  weapon: string | null;
  distance: number | null;
  occurred_at: string | null;
  created_at: string | null;
};

export type RatingBreakdown = Record<1 | 2 | 3 | 4 | 5, number>;

export type PublicServerRatingSummary = {
  average_rating: number | null;
  review_count: number;
  rating_breakdown: RatingBreakdown;
};

export type ReviewAggregateRow = {
  linked_server_id: string;
  rating: number | null;
  review_count: number | null;
};

type SafePublicServer = {
  linked_server_id: string;
  public_slug: string;
  server_name: string;
  server_type: string;
  tags_json: string;
  status: string;
  nitrado_service_name: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
  adm_status: "Connected" | "Discovered" | "Needs Review";
  stats_sync: "Active" | "Pending" | "Not Started";
  player_slots: number | null;
  max_players: number | null;
  current_players: number | null;
  platform: string | null;
  map_name: string | null;
  mission: string | null;
  server_status: string | null;
  is_online: boolean;
  last_sync_at: string | null;
  metadata_last_checked_at: string | null;
  player_count_last_checked_at: string | null;
  player_count_source: string | null;
  player_count_status: string | null;
  public_short_description: string | null;
  public_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  public_rules: string | null;
  public_language: string | null;
  public_region_label: string | null;
  public_listing_updated_at: string | null;
  created_at: string | null;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  longest_kill: number;
  kd: number | null;
  kd_label: string;
  rank: number | null;
  score: number;
  score_label: string;
  score_breakdown: ServerScoreBreakdown | null;
  stats_sync_active: boolean;
  average_rating: number | null;
  review_count: number;
  rating_breakdown: RatingBreakdown;
  advertising: PublicAdvertising;
  recent_events: PublicRecentEvent[];
  top_players?: PublicLeaderboardPlayer[];
  pvp_leaderboard?: PublicLeaderboardPlayer[];
  tags?: string[];
  stats?: {
    total_kills: number;
    total_deaths: number;
    total_joins: number;
    total_disconnects: number;
    unique_players: number;
    longest_kill: number;
    kd: number | null;
    kd_label: string;
    rank: number | null;
    score: number;
    score_label: string;
  };
  network_status?: {
    adm_status: "Connected" | "Discovered" | "Needs Review";
    stats_sync: "Active" | "Pending" | "Not Started";
    public_listing: "Active";
    last_sync_at: string | null;
  };
  access_level?: "full" | "preview";
  is_locked?: boolean;
  locked_reason?: string | null;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const url = new URL(request.url);
  const slug = sanitizeSlug(url.searchParams.get("slug"));
  const viewerLoggedIn = await isPublicViewerLoggedIn(request, env);
  const headers = publicAccessCacheHeaders(viewerLoggedIn);
  const accessLevel = publicApiSnapshotAccess(viewerLoggedIn);
  const cacheKey = publicApiSnapshotKey("servers", accessLevel, slug ? `profile:${slug}` : null);
  const endpoint = "/api/public/servers";
  const requestId = request.headers.get("cf-ray");

  try {
    const generatedAt = new Date().toISOString();
    const payload = await getPublicServersPayload(env, slug, viewerLoggedIn);
    await writePublicApiCache(env, cacheKey, payload, generatedAt, accessLevel).catch((error) => {
      console.warn("DZN PUBLIC SERVERS CACHE WRITE FAILED", safePublicCacheError(error));
    });
    return json(withPublicApiMetadata(payload, {
      generated_at: generatedAt,
      source: "live",
      stale: false,
    }), { headers });
  } catch (error) {
    logPublicApiLoadFailed(endpoint, 503, error, requestId);
    const cached = await readPublicApiCache<Record<string, unknown>>(env, cacheKey).catch(() => null);
    if (cached) {
      logPublicApiSnapshotFallbackServed(endpoint, cacheKey, requestId);
      return json(withPublicApiMetadata(cached.payload, {
        generated_at: cached.generated_at,
        source: "snapshot",
        stale: true,
        fallback_reason: "live_query_failed_using_snapshot",
        snapshot_generated_at: cached.generated_at,
        message: "Showing last known data while live refresh recovers.",
      }), { headers: publicApiSnapshotFallbackHeaders(viewerLoggedIn) });
    }
    logPublicApi503RootCause(endpoint, error, requestId, slug ? "server_profile_live_query" : "server_listing_live_query");
    return json({
      ok: false,
      error: slug ? "public_server_profile_load_failed" : "public_servers_load_failed",
      message: slug ? "Unable to load this public server right now." : "Unable to load public servers right now.",
      generated_at: new Date().toISOString(),
      source: "empty_no_cache",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
      retry_after_seconds: 10,
    }, { headers: publicApiErrorHeaders(), status: 503 });
  }
};

export async function getPublicServersPayload(env: Env, slug: string | null, viewerLoggedIn = true) {
  if (!env.DB) {
    const mockServers = shouldShowMockServers(env) ? mockPublicServers().map((server) => applyPublicServerAccess(server, viewerLoggedIn)) : [];
    return slug
      ? { ok: true, server: findPublicServerBySlug(mockServers, slug) ?? null, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn }
      : { ok: true, servers: mockServers, stats: buildPublicStats(mockServers), access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
  }

  if (!viewerLoggedIn && !slug) {
    return getPublicServersPreviewPayload(env);
  }

  await ensureLinkedServerMetadataColumns(env);
  await ensureServerLogConfigTable(env);
  await ensureAdmSyncSchema(env);
  await ensureBillingSchema(env);
  await ensurePublicSlugsForLiveServers(env);

  const [rows, rankedServers] = await Promise.all([queryPublicServers(env), getRankedPublicServers(env, 500)]);
  const rankingById = new Map(rankedServers.map((server) => [server.server_id, server]));
  const publicRows = slug ? await findPublicServerRowsBySlug(env, rows, slug) : rows;
  const reviewSummaries = await getPublicServerRatingSummaries(env, publicRows.map((row) => row.id));
  const servers = (await Promise.all(publicRows.map((row) => toSafePublicServer(env, row, rankingById.get(row.id) ?? null, reviewSummaries.get(row.id) ?? emptyPublicServerRatingSummary()))))
    .filter((server): server is SafePublicServer => Boolean(server))
    .map((server) => applyPublicServerAccess(server, viewerLoggedIn));
  sortPublicServersForDiscovery(servers);

  if (slug) {
    if (servers.length === 0 && shouldShowMockServers(env)) {
      const mockServers = mockPublicServers().map((server) => applyPublicServerAccess(server, viewerLoggedIn));
      return { ok: true, server: findPublicServerBySlug(mockServers, slug) ?? null, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
    }
    return getPublicServerProfileBySlug(env, publicRows[0] ?? null, servers[0] ?? null, viewerLoggedIn);
  }

  if (servers.length === 0 && shouldShowMockServers(env)) {
    const mockServers = mockPublicServers().map((server) => applyPublicServerAccess(server, viewerLoggedIn));
    return { ok: true, servers: mockServers, stats: buildPublicStats(mockServers), mock: true, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
  }

  return { ok: true, servers, stats: buildPublicStats(servers), access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
}

async function getPublicServersPreviewPayload(env: Env) {
  const rows = await queryPublicServersPreview(env);
  const servers = rows
    .map(toSafePublicServerPreview)
    .filter((server): server is SafePublicServer => Boolean(server))
    .map((server) => applyPublicServerAccess(server, false));
  sortPublicServersForDiscovery(servers);
  return { ok: true, servers, stats: buildPublicStats(servers), access_level: "preview", is_locked: true };
}

async function queryPublicServersPreview(env: Env) {
  const result = await requireDb(env)
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        COALESCE(NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.tags_json,
        linked_servers.status,
        linked_servers.nitrado_service_id,
        linked_servers.nitrado_service_name,
        COALESCE(server_public_cache.max_player_count, linked_servers.max_players, linked_servers.player_slots) AS player_slots,
        COALESCE(server_public_cache.max_player_count, linked_servers.max_players) AS max_players,
        COALESCE(server_public_cache.current_player_count, linked_servers.current_players) AS current_players,
        linked_servers.platform,
        linked_servers.map_name,
        linked_servers.mission,
        linked_servers.server_mode,
        COALESCE(server_public_cache.server_status, linked_servers.server_status) AS server_status,
        COALESCE(server_public_cache.server_online, linked_servers.is_online) AS is_online,
        COALESCE(server_public_cache.last_status_update_at, linked_servers.metadata_last_checked_at) AS metadata_last_checked_at,
        COALESCE(server_public_cache.last_status_update_at, linked_servers.player_count_last_checked_at) AS player_count_last_checked_at,
        linked_servers.player_count_source,
        linked_servers.player_count_status,
        linked_servers.created_at,
        linked_servers.updated_at,
        discord_guilds.name AS guild_name,
        discord_guilds.icon_url AS guild_icon_url,
        NULL AS adm_path,
        CASE WHEN COALESCE(adm_sync_state.latest_adm_file, '') <> '' OR COALESCE(adm_sync_state.last_processed_file, '') <> '' THEN 1 ELSE 0 END AS adm_logs_found,
        adm_sync_state.last_sync_at AS adm_last_checked_at,
        adm_sync_state.latest_adm_file AS adm_sync_latest_file,
        adm_sync_state.latest_adm_path AS adm_sync_latest_path,
        adm_sync_state.last_sync_status AS adm_sync_status,
        adm_sync_state.last_sync_message AS adm_sync_message,
        adm_sync_state.last_sync_at AS adm_sync_at,
        COALESCE(server_stats.total_kills, 0) AS total_kills,
        COALESCE(server_stats.total_deaths, 0) AS total_deaths,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        server_stats.updated_at AS server_stats_updated_at,
        server_public_cache.updated_at AS public_cache_updated_at,
        CASE
          WHEN COALESCE(server_stats.total_joins, 0) > 0
            OR COALESCE(server_stats.total_disconnects, 0) > 0
            OR COALESCE(server_stats.total_deaths, 0) > 0
            OR COALESCE(server_stats.total_kills, 0) > 0
            OR COALESCE(server_stats.unique_players, 0) > 0
            OR COALESCE(server_public_cache.last_adm_update_at, '') <> ''
            OR COALESCE(adm_sync_state.last_processed_file, '') <> ''
          THEN 'completed' ELSE NULL
        END AS latest_success_sync_status,
        'scheduled_nitrado' AS latest_success_sync_trigger,
        COALESCE(server_public_cache.last_adm_update_at, server_stats.updated_at, adm_sync_state.last_sync_at) AS latest_success_sync_at,
        linked_servers.public_short_description,
        linked_servers.public_description,
        linked_servers.public_discord_invite,
        linked_servers.public_website_url,
        linked_servers.public_rules,
        linked_servers.public_language,
        linked_servers.public_region_label,
        linked_servers.public_listing_updated_at,
        server_advertising_state.last_bumped_at,
        server_advertising_state.bump_count_current_period,
        server_advertising_state.bump_period_start,
        server_advertising_state.bump_period_end,
        server_advertising_state.featured_until,
        server_advertising_state.featured_label
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY
         CASE
           WHEN COALESCE(server_stats.total_kills, 0) > 0 OR COALESCE(server_stats.total_joins, 0) > 0 THEN 0
           WHEN COALESCE(server_public_cache.last_adm_update_at, '') <> '' THEN 1
           ELSE 2
         END ASC,
         COALESCE(server_public_cache.last_adm_update_at, server_stats.updated_at, linked_servers.updated_at, linked_servers.created_at) DESC
       LIMIT 500`,
    )
    .all<PublicServerRow>()
    .catch(() => ({ results: [] as PublicServerRow[] }));
  return canonicalizePublicServerRows(result.results ?? []);
}

async function getPublicServerProfileBySlug(env: Env, row: PublicServerRow | null, server: SafePublicServer | null, viewerLoggedIn: boolean) {
  if (!row || !server) return { ok: true, server: null };

  if (viewerLoggedIn) {
    // Public profile pages are server-scoped. Global leaderboards are only used by
    // global pages; child profile data must always query by this resolved server id.
    const leaderboard = await getPublicServerLeaderboardById(env, row.id, 10);
    server.top_players = leaderboard.slice(0, 5);
    server.pvp_leaderboard = leaderboard;
  }

  return {
    ok: true,
    server,
    selected_server_id: viewerLoggedIn ? row.id : null,
    selected_slug: row.public_slug,
    selected_service_id: viewerLoggedIn ? row.nitrado_service_id : null,
    access_level: viewerLoggedIn ? "full" : "preview",
    is_locked: !viewerLoggedIn,
  };
}

async function queryPublicServers(env: Env) {
  const db = requireDb(env);
  const baseQuery = `
    SELECT
      linked_servers.id,
      linked_servers.public_slug,
      COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
      COALESCE(NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
      linked_servers.tags_json,
      linked_servers.status,
      linked_servers.nitrado_service_id,
      linked_servers.nitrado_service_name,
      COALESCE(server_public_cache.max_player_count, linked_servers.max_players, linked_servers.player_slots) AS player_slots,
      COALESCE(server_public_cache.max_player_count, linked_servers.max_players) AS max_players,
      COALESCE(server_public_cache.current_player_count, linked_servers.current_players) AS current_players,
      linked_servers.platform,
      linked_servers.map_name,
      linked_servers.mission,
      linked_servers.server_mode,
      COALESCE(server_public_cache.server_status, linked_servers.server_status) AS server_status,
      COALESCE(server_public_cache.server_online, linked_servers.is_online) AS is_online,
      COALESCE(server_public_cache.last_status_update_at, linked_servers.metadata_last_checked_at) AS metadata_last_checked_at,
      COALESCE(server_public_cache.last_status_update_at, linked_servers.player_count_last_checked_at) AS player_count_last_checked_at,
      linked_servers.player_count_source,
      linked_servers.player_count_status,
      linked_servers.created_at,
      linked_servers.updated_at,
      discord_guilds.name AS guild_name,
      discord_guilds.icon_url AS guild_icon_url,
      server_log_config.adm_path AS adm_path,
      onboarding_checks.adm_logs_found AS adm_logs_found,
      onboarding_checks.last_tested_at AS adm_last_checked_at,
      adm_sync_state.latest_adm_file AS adm_sync_latest_file,
      adm_sync_state.latest_adm_path AS adm_sync_latest_path,
      adm_sync_state.last_sync_status AS adm_sync_status,
      adm_sync_state.last_sync_message AS adm_sync_message,
      adm_sync_state.last_sync_at AS adm_sync_at,
      (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS total_kills,
      (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL) AS total_deaths,
      server_stats.total_joins,
      server_stats.total_disconnects,
      server_stats.unique_players,
      server_stats.updated_at AS server_stats_updated_at,
      server_public_cache.updated_at AS public_cache_updated_at,
      (
        SELECT status
        FROM sync_runs
        WHERE sync_runs.linked_server_id = linked_servers.id
          AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
        ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
        LIMIT 1
      ) AS latest_success_sync_status,
      (
        SELECT trigger_type
        FROM sync_runs
        WHERE sync_runs.linked_server_id = linked_servers.id
          AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
        ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
        LIMIT 1
      ) AS latest_success_sync_trigger,
      (
        SELECT COALESCE(finished_at, started_at, created_at)
        FROM sync_runs
        WHERE sync_runs.linked_server_id = linked_servers.id
          AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
        ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
        LIMIT 1
      ) AS latest_success_sync_at,
      linked_servers.public_short_description,
      linked_servers.public_description,
      linked_servers.public_discord_invite,
      linked_servers.public_website_url,
      linked_servers.public_rules,
      linked_servers.public_language,
      linked_servers.public_region_label,
      linked_servers.public_listing_updated_at,
      server_advertising_state.last_bumped_at,
      server_advertising_state.bump_count_current_period,
      server_advertising_state.bump_period_start,
      server_advertising_state.bump_period_end,
      server_advertising_state.featured_until,
      server_advertising_state.featured_label
    FROM linked_servers
    LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
    LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
    LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
    LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
    LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
    LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
    LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
    WHERE lower(linked_servers.status) = 'live'
      AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  `;

  const result = await db
    .prepare(
      `${baseQuery}
       ORDER BY
         CASE
           WHEN onboarding_checks.adm_logs_found = 1 THEN 0
           WHEN server_log_config.adm_path IS NOT NULL THEN 2
           ELSE 4
         END ASC,
         linked_servers.updated_at DESC,
         linked_servers.created_at DESC
       LIMIT 500`,
    )
    .all<PublicServerRow>();
  return canonicalizePublicServerRows(result.results ?? []);
}

function canonicalizePublicServerRows(rows: PublicServerRow[]) {
  const byService = new Map<string, PublicServerRow>();
  const passthrough: PublicServerRow[] = [];

  for (const row of rows) {
    const serviceKey = row.nitrado_service_id ? `service:${row.nitrado_service_id}` : null;
    const key = serviceKey ?? row.id;
    if (!serviceKey) {
      passthrough.push(row);
      continue;
    }
    const existing = byService.get(key);
    if (!existing || publicCanonicalScore(row) > publicCanonicalScore(existing)) {
      byService.set(key, row);
    }
  }

  return [...byService.values(), ...passthrough].sort((a, b) => {
    const statusDiff = publicCanonicalScore(b) - publicCanonicalScore(a);
    if (statusDiff) return statusDiff;
    return dateValue(b.updated_at) - dateValue(a.updated_at);
  });
}

function publicCanonicalScore(row: PublicServerRow) {
  return numberOrZero(row.total_kills) * 1000 +
    numberOrZero(row.unique_players) * 100 +
    (row.public_slug ? 20 : 0) +
    (isSuccessfulAdmSyncStatus(row.latest_success_sync_status) || isSuccessfulAdmSyncStatus(row.adm_sync_status) ? 10 : 0) +
    (Number(row.adm_logs_found) === 1 ? 5 : 0);
}

async function findPublicServerRowsBySlug(env: Env, rows: PublicServerRow[], slug: string) {
  const exactPublicSlugMatch = rows.find((row) => sanitizeSlug(row.public_slug) === slug);
  if (exactPublicSlugMatch) return [exactPublicSlugMatch];

  const aliasServerId = await resolveSlugAliasLinkedServerId(env, slug).catch(() => null);
  if (aliasServerId) {
    const aliasMatch = rows.find((row) => row.id === aliasServerId);
    if (aliasMatch) return [aliasMatch];
  }

  const directMatch = rows.find((row) => publicServerRowMatchesSlug(row, slug));
  return directMatch ? [directMatch] : [];
}

async function resolveSlugAliasLinkedServerId(env: Env, slug: string) {
  const db = requireDb(env);
  const table = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'server_slug_aliases'")
    .first<{ name: string }>();
  if (!table) return null;

  const columnResult = await db.prepare("PRAGMA table_info(server_slug_aliases)").all<{ name: string }>();
  const columnNames = new Set((columnResult.results ?? []).map((column) => column.name));
  const slugColumn = ["slug", "alias", "public_slug"].find((column) => columnNames.has(column));
  const serverColumn = ["linked_server_id", "server_id"].find((column) => columnNames.has(column));
  if (!slugColumn || !serverColumn) return null;

  const row = await db
    .prepare(`SELECT ${serverColumn} AS linked_server_id FROM server_slug_aliases WHERE lower(${slugColumn}) = ? LIMIT 1`)
    .bind(slug)
    .first<{ linked_server_id: string }>();
  return row?.linked_server_id ?? null;
}

async function ensurePublicSlugsForLiveServers(env: Env) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name) AS server_name,
        linked_servers.nitrado_service_name,
        linked_servers.public_slug,
        discord_guilds.name AS guild_name
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND (linked_servers.public_slug IS NULL OR linked_servers.public_slug = '')`,
    )
    .all<{ id: string; server_name: string | null; nitrado_service_name: string | null; public_slug: string | null; guild_name: string | null }>();

  for (const server of result.results ?? []) {
    const sourceName = firstString(server.guild_name, server.server_name, server.nitrado_service_name) ?? "dayz-server";
    const slug = await uniquePublicSlug(env, sourceName, server.id);
    await db
      .prepare("UPDATE linked_servers SET public_slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(slug, server.id)
      .run();
  }
}

async function ensureServerLogConfigTable(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_log_config (
        id TEXT PRIMARY KEY,
        linked_server_id TEXT UNIQUE NOT NULL,
        adm_path TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_server_log_config_linked_server_id ON server_log_config(linked_server_id)")
    .run();
}

async function toSafePublicServer(env: Env, row: PublicServerRow, ranking: PublicLeaderboardServer | null, reviewSummary: PublicServerRatingSummary): Promise<SafePublicServer | null> {
  if (!row.public_slug) return null;
  const tagsJson = normalizePublicTagsJson(row.tags_json);
  const tags = parsePublicTags(tagsJson);
  const latestAdmPath = row.adm_sync_latest_path ?? row.adm_path;
  const latestAdmFile = row.adm_sync_latest_file ?? fileNameFromPath(latestAdmPath);
  const hasActivity =
    numberOrZero(row.total_joins) > 0 ||
    numberOrZero(row.total_disconnects) > 0 ||
    numberOrZero(row.total_deaths) > 0 ||
    numberOrZero(row.total_kills) > 0 ||
    numberOrZero(row.unique_players) > 0;
  const latestSyncCompleted = isSuccessfulAdmSyncStatus(row.latest_success_sync_status);
  const admSyncCompleted = isSuccessfulAdmSyncStatus(row.adm_sync_status);
  const readable = latestSyncCompleted || admSyncCompleted || hasActivity || Number(row.adm_logs_found) === 1;
  const admStatus = readable ? "Connected" : latestAdmFile || row.adm_path ? "Discovered" : "Needs Review";
  const statsSync = latestSyncCompleted || admSyncCompleted || hasActivity || (readable && latestSyncCompleted)
    ? "Active"
    : latestAdmFile || row.adm_path
      ? "Pending"
      : "Not Started";
  const lastSyncAt = latestPublicTimestamp([
    row.latest_success_sync_at,
    row.adm_sync_at,
    row.metadata_last_checked_at,
    row.player_count_last_checked_at,
    row.server_stats_updated_at,
  ]);
  const stats = {
    total_kills: numberOrZero(row.total_kills),
    total_deaths: numberOrZero(row.total_deaths),
    total_joins: numberOrZero(row.total_joins),
    total_disconnects: numberOrZero(row.total_disconnects),
    unique_players: numberOrZero(row.unique_players),
    longest_kill: numberOrZero(ranking?.longest_kill),
    kd: ranking?.kd ?? null,
    kd_label: ranking?.kd_label ?? calculatePublicServerKd(numberOrZero(row.total_kills), numberOrZero(row.total_deaths)).label,
    rank: ranking?.rank ?? null,
    score: ranking?.score ?? 0,
    score_label: ranking?.score_label ?? "Pending",
  };
  return {
    linked_server_id: row.id,
    public_slug: row.public_slug,
    server_name: row.server_name,
    server_type: row.server_type,
    tags_json: tagsJson,
    tags,
    status: row.status,
    nitrado_service_name: row.nitrado_service_name,
    guild_name: row.guild_name,
    guild_icon_url: row.guild_icon_url,
    adm_status: admStatus,
    stats_sync: statsSync,
    player_slots: row.player_slots,
    max_players: row.max_players ?? row.player_slots,
    current_players: row.current_players === null ? null : numberOrZero(row.current_players),
    platform: row.platform,
    map_name: row.map_name,
    mission: row.mission,
    server_status: row.server_status,
    is_online: Number(row.is_online) === 1,
    last_sync_at: lastSyncAt,
    metadata_last_checked_at: row.metadata_last_checked_at,
    player_count_last_checked_at: row.player_count_last_checked_at,
    player_count_source: row.player_count_source,
    player_count_status: row.player_count_status,
    public_short_description: row.public_short_description,
    public_description: row.public_description,
    public_discord_invite: row.public_discord_invite,
    public_website_url: row.public_website_url,
    public_rules: row.public_rules,
    public_language: row.public_language,
    public_region_label: row.public_region_label,
    public_listing_updated_at: row.public_listing_updated_at,
    created_at: row.created_at,
    ...stats,
    score_breakdown: ranking?.score_breakdown ?? null,
    stats_sync_active: ranking?.stats_sync_active ?? statsSync === "Active",
    average_rating: reviewSummary.average_rating,
    review_count: reviewSummary.review_count,
    rating_breakdown: reviewSummary.rating_breakdown,
    advertising: publicAdvertisingFromState({
      last_bumped_at: row.last_bumped_at,
      bump_count_current_period: numberOrZero(row.bump_count_current_period),
      bump_period_start: row.bump_period_start,
      bump_period_end: row.bump_period_end,
      featured_until: row.featured_until,
      featured_label: row.featured_label,
    }),
    stats,
    network_status: {
      adm_status: admStatus,
      stats_sync: statsSync,
      public_listing: "Active",
      last_sync_at: lastSyncAt,
    },
    recent_events: await getPublicRecentEvents(env, row.id),
  } satisfies SafePublicServer;
}

function toSafePublicServerPreview(row: PublicServerRow): SafePublicServer | null {
  if (!row.public_slug) return null;
  const tagsJson = normalizePublicTagsJson(row.tags_json);
  const latestAdmPath = row.adm_sync_latest_path ?? row.adm_path;
  const latestAdmFile = row.adm_sync_latest_file ?? fileNameFromPath(latestAdmPath);
  const hasActivity =
    numberOrZero(row.total_joins) > 0 ||
    numberOrZero(row.total_disconnects) > 0 ||
    numberOrZero(row.total_deaths) > 0 ||
    numberOrZero(row.total_kills) > 0 ||
    numberOrZero(row.unique_players) > 0 ||
    Boolean(row.latest_success_sync_at || row.public_cache_updated_at);
  const latestSyncCompleted = isSuccessfulAdmSyncStatus(row.latest_success_sync_status);
  const admSyncCompleted = isSuccessfulAdmSyncStatus(row.adm_sync_status);
  const readable = latestSyncCompleted || admSyncCompleted || hasActivity || Number(row.adm_logs_found) === 1;
  const admStatus = readable ? "Connected" : latestAdmFile || row.adm_path ? "Discovered" : "Needs Review";
  const statsSync = readable ? "Active" : latestAdmFile || row.adm_path ? "Pending" : "Not Started";
  const lastSyncAt = latestPublicTimestamp([
    row.latest_success_sync_at,
    row.adm_sync_at,
    row.metadata_last_checked_at,
    row.player_count_last_checked_at,
    row.server_stats_updated_at,
    row.public_cache_updated_at,
  ]);
  const totalKills = numberOrZero(row.total_kills);
  const totalDeaths = numberOrZero(row.total_deaths);
  const stats = {
    total_kills: totalKills,
    total_deaths: totalDeaths,
    total_joins: numberOrZero(row.total_joins),
    total_disconnects: numberOrZero(row.total_disconnects),
    unique_players: numberOrZero(row.unique_players),
    longest_kill: 0,
    kd: totalDeaths === 0 ? (totalKills > 0 ? totalKills : null) : Number((totalKills / totalDeaths).toFixed(2)),
    kd_label: calculatePublicServerKd(totalKills, totalDeaths).label,
    rank: null,
    score: 0,
    score_label: readable ? "ADM synced" : "Pending",
  };
  return {
    linked_server_id: row.id,
    public_slug: row.public_slug,
    server_name: row.server_name,
    server_type: row.server_type,
    tags_json: tagsJson,
    tags: parsePublicTags(tagsJson),
    status: row.status,
    nitrado_service_name: row.nitrado_service_name,
    guild_name: row.guild_name,
    guild_icon_url: row.guild_icon_url,
    adm_status: admStatus,
    stats_sync: statsSync,
    player_slots: row.player_slots,
    max_players: row.max_players ?? row.player_slots,
    current_players: row.current_players === null ? null : numberOrZero(row.current_players),
    platform: row.platform,
    map_name: row.map_name,
    mission: row.mission,
    server_status: row.server_status,
    is_online: Number(row.is_online) === 1,
    last_sync_at: lastSyncAt,
    metadata_last_checked_at: row.metadata_last_checked_at,
    player_count_last_checked_at: row.player_count_last_checked_at,
    player_count_source: row.player_count_source,
    player_count_status: row.player_count_status,
    public_short_description: row.public_short_description,
    public_description: row.public_description,
    public_discord_invite: row.public_discord_invite,
    public_website_url: row.public_website_url,
    public_rules: row.public_rules,
    public_language: row.public_language,
    public_region_label: row.public_region_label,
    public_listing_updated_at: row.public_listing_updated_at,
    created_at: row.created_at,
    ...stats,
    score_breakdown: null,
    stats_sync_active: statsSync === "Active",
    ...emptyPublicServerRatingSummary(),
    advertising: publicAdvertisingFromState({
      last_bumped_at: row.last_bumped_at,
      bump_count_current_period: numberOrZero(row.bump_count_current_period),
      bump_period_start: row.bump_period_start,
      bump_period_end: row.bump_period_end,
      featured_until: row.featured_until,
      featured_label: row.featured_label,
    }),
    stats,
    network_status: {
      adm_status: admStatus,
      stats_sync: statsSync,
      public_listing: "Active",
      last_sync_at: lastSyncAt,
    },
    recent_events: [],
  };
}

async function getPublicServerRatingSummaries(env: Env, linkedServerIds: string[]) {
  const summaries = new Map<string, PublicServerRatingSummary>();
  for (const linkedServerId of linkedServerIds) {
    summaries.set(linkedServerId, emptyPublicServerRatingSummary());
  }
  if (linkedServerIds.length === 0) return summaries;

  try {
    const db = requireDb(env);
    const placeholders = linkedServerIds.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `SELECT linked_server_id, rating, COUNT(*) AS review_count
         FROM server_reviews
         WHERE linked_server_id IN (${placeholders})
           AND status = 'approved'
         GROUP BY linked_server_id, rating`,
      )
      .bind(...linkedServerIds)
      .all<ReviewAggregateRow>();

    return buildPublicServerRatingSummaries(linkedServerIds, result.results ?? []);
  } catch (error) {
    console.warn("DZN public server rating summaries unavailable", error instanceof Error ? error.message : "unknown error");
    return summaries;
  }
}

export function buildPublicServerRatingSummaries(linkedServerIds: string[], rows: ReviewAggregateRow[]) {
  const summaries = new Map<string, PublicServerRatingSummary>();
  for (const linkedServerId of linkedServerIds) {
    summaries.set(linkedServerId, emptyPublicServerRatingSummary());
  }

  for (const row of rows) {
    const linkedServerId = row.linked_server_id;
    if (!summaries.has(linkedServerId)) continue;

    const rating = publicRatingOrNull(row.rating);
    if (!rating) continue;
    const count = numberOrZero(row.review_count);
    if (count <= 0) continue;

    const summary = summaries.get(linkedServerId) ?? emptyPublicServerRatingSummary();
    summary.rating_breakdown[rating] += count;
    summary.review_count += count;
    summaries.set(linkedServerId, summary);
  }

  for (const [linkedServerId, summary] of summaries) {
    if (summary.review_count === 0) {
      summaries.set(linkedServerId, emptyPublicServerRatingSummary());
      continue;
    }

    const ratingTotal = ([1, 2, 3, 4, 5] as const).reduce((total, rating) => total + rating * summary.rating_breakdown[rating], 0);
    summaries.set(linkedServerId, {
      ...summary,
      average_rating: Math.round((ratingTotal / summary.review_count) * 10) / 10,
    });
  }

  return summaries;
}

export function emptyPublicServerRatingSummary(): PublicServerRatingSummary {
  return {
    average_rating: null,
    review_count: 0,
    rating_breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  };
}

function publicRatingOrNull(value: unknown): 1 | 2 | 3 | 4 | 5 | null {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return Math.min(5, Math.max(1, Math.round(rating))) as 1 | 2 | 3 | 4 | 5;
}

function buildPublicStats(servers: SafePublicServer[]) {
  return {
    totalServers: servers.length,
    pvpServers: servers.filter((server) => server.server_type === "PVP").length,
    pveServers: servers.filter((server) => server.server_type === "PVE").length,
    deathmatchServers: servers.filter((server) => server.server_type === "DEATHMATCH").length,
    statsSyncActive: servers.filter((server) => server.stats_sync === "Active").length,
    statsSyncPending: servers.filter((server) => server.stats_sync !== "Active").length,
  };
}

export function sortPublicServersForDiscovery<T extends {
  advertising?: PublicAdvertising;
  rank: number | null;
  score: number;
  created_at: string | null;
}>(servers: T[]) {
  servers.sort((a, b) => {
    const adDiff = advertisingSortScore(b.advertising ?? publicAdvertisingFromState(null)) - advertisingSortScore(a.advertising ?? publicAdvertisingFromState(null));
    if (adDiff) return adDiff;
    const rankA = typeof a.rank === "number" && a.rank > 0 ? a.rank : Number.MAX_SAFE_INTEGER;
    const rankB = typeof b.rank === "number" && b.rank > 0 ? b.rank : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const scoreDiff = numberOrZero(b.score) - numberOrZero(a.score);
    if (scoreDiff) return scoreDiff;
    return dateValue(b.created_at) - dateValue(a.created_at);
  });
  return servers;
}

export function applyPublicServerAccess(server: SafePublicServer, viewerLoggedIn: boolean): SafePublicServer {
  if (viewerLoggedIn) {
    return {
      ...server,
      access_level: "full",
      is_locked: false,
      locked_reason: null,
    };
  }

  const previewStats = {
    total_kills: numberOrZero(server.total_kills),
    total_deaths: 0,
    total_joins: 0,
    total_disconnects: 0,
    unique_players: 0,
    longest_kill: 0,
    kd: null,
    kd_label: "Login required",
    rank: server.rank,
    score: server.score,
    score_label: server.score_label,
  };
  const publicDescription = truncateText(server.public_description, 260);
  const tags = parsePublicTags(server.tags_json).slice(0, 3);

  return {
    ...server,
    ...previewStats,
    tags_json: JSON.stringify(tags),
    tags,
    last_sync_at: null,
    public_description: publicDescription,
    public_discord_invite: null,
    public_website_url: null,
    public_rules: null,
    score_breakdown: null,
    stats_sync_active: false,
    recent_events: [],
    top_players: [],
    pvp_leaderboard: [],
    stats: previewStats,
    network_status: {
      adm_status: server.adm_status,
      stats_sync: server.stats_sync,
      public_listing: "Active",
      last_sync_at: null,
    },
    access_level: "preview",
    is_locked: true,
    locked_reason: "Log in with Discord to view full server stats.",
  };
}

function findPublicServerBySlug(servers: SafePublicServer[], slug: string) {
  return servers.find((server) => publicServerMatchesSlug(server, slug)) ?? null;
}

function mockPublicServers(): SafePublicServer[] {
  return [
    {
      linked_server_id: "mock-pandora-dayz",
      public_slug: "pandora-dayz",
      server_name: "Pandora DayZ",
      server_type: "PVP / PVE",
      tags_json: JSON.stringify(["Factions", "Trader / Economy", "Events", "Active Admins"]),
      status: "live",
      nitrado_service_name: "Pandora DayZ",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      adm_status: "Discovered",
      stats_sync: "Pending",
      player_slots: 60,
      max_players: 60,
      current_players: 0,
      platform: "PlayStation",
      map_name: "Chernarus",
      mission: null,
      server_status: "online",
      is_online: true,
      last_sync_at: null,
      metadata_last_checked_at: null,
      player_count_last_checked_at: null,
      player_count_source: "nitrado",
      player_count_status: "unknown",
      created_at: new Date().toISOString(),
      total_kills: 0,
      total_deaths: 0,
      total_joins: 0,
      total_disconnects: 0,
      unique_players: 0,
      longest_kill: 0,
      kd: null,
      kd_label: "Awaiting data",
      rank: null,
      score: 0,
      score_label: "Pending",
      score_breakdown: null,
      stats_sync_active: false,
      ...emptyPublicServerRatingSummary(),
      advertising: publicAdvertisingFromState(null),
      ...mockListingFields("Hybrid PvP/PvE community with factions, events, traders, and weekend raids."),
      recent_events: [],
    },
    {
      linked_server_id: "mock-warlords-pvp",
      public_slug: "warlords-pvp",
      server_name: "Warlords PvP",
      server_type: "PVP",
      tags_json: JSON.stringify(["Raid Focused", "Factions", "Weekend Raids", "KOS"]),
      status: "live",
      nitrado_service_name: "Warlords PvP",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      adm_status: "Connected",
      stats_sync: "Active",
      player_slots: 70,
      max_players: 70,
      current_players: 12,
      platform: "PlayStation",
      map_name: "Chernarus",
      mission: null,
      server_status: "online",
      is_online: true,
      last_sync_at: new Date().toISOString(),
      metadata_last_checked_at: new Date().toISOString(),
      player_count_last_checked_at: new Date().toISOString(),
      player_count_source: "nitrado",
      player_count_status: "fresh",
      created_at: new Date().toISOString(),
      total_kills: 12,
      total_deaths: 18,
      total_joins: 42,
      total_disconnects: 36,
      unique_players: 14,
      longest_kill: 0,
      kd: 0.67,
      kd_label: "0.67",
      rank: 1,
      score: 0,
      score_label: "Pending",
      score_breakdown: null,
      stats_sync_active: true,
      ...emptyPublicServerRatingSummary(),
      advertising: publicAdvertisingFromState(null),
      ...mockListingFields("Raid-focused PvP server with active factions and competitive stat tracking."),
      recent_events: [],
    },
    {
      linked_server_id: "mock-apocalypse-dm",
      public_slug: "apocalypse-dm",
      server_name: "Apocalypse DM",
      server_type: "DEATHMATCH",
      tags_json: JSON.stringify(["Hardcore", "Events", "Modded"]),
      status: "live",
      nitrado_service_name: "Apocalypse DM",
      guild_name: "Warlords Community",
      guild_icon_url: null,
      adm_status: "Needs Review",
      stats_sync: "Not Started",
      player_slots: 50,
      max_players: 50,
      current_players: 0,
      platform: "PlayStation",
      map_name: "Deathmatch Arena",
      mission: null,
      server_status: "restarting",
      is_online: false,
      last_sync_at: null,
      metadata_last_checked_at: null,
      player_count_last_checked_at: null,
      player_count_source: "nitrado",
      player_count_status: "unknown",
      created_at: new Date().toISOString(),
      total_kills: 0,
      total_deaths: 0,
      total_joins: 0,
      total_disconnects: 0,
      unique_players: 0,
      longest_kill: 0,
      kd: null,
      kd_label: "Awaiting data",
      rank: null,
      score: 0,
      score_label: "Pending",
      score_breakdown: null,
      stats_sync_active: false,
      ...emptyPublicServerRatingSummary(),
      advertising: publicAdvertisingFromState(null),
      ...mockListingFields("Fast respawn deathmatch arena for clean fights and leaderboard runs."),
      recent_events: [],
    },
  ];
}

function mockListingFields(shortDescription: string) {
  return {
    public_short_description: shortDescription,
    public_description: null,
    public_discord_invite: null,
    public_website_url: null,
    public_rules: null,
    public_language: "English",
    public_region_label: "Community region",
    public_listing_updated_at: new Date().toISOString(),
  };
}

async function getPublicRecentEvents(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT source, event_type, player_name, killer_name, victim_name, weapon, distance, occurred_at, created_at
       FROM (
         SELECT
           'kill' AS source,
           'player_killed' AS event_type,
           NULL AS player_name,
           killer_name,
           victim_name,
           weapon,
           distance,
           occurred_at,
           created_at,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM kill_events
         WHERE linked_server_id = ?
         UNION ALL
         SELECT
           'player' AS source,
           event_type,
           player_name,
           NULL AS killer_name,
           NULL AS victim_name,
           NULL AS weapon,
           NULL AS distance,
           occurred_at,
           created_at,
           COALESCE(occurred_at, created_at) AS sort_time
         FROM player_events
         WHERE linked_server_id = ?
       )
       ORDER BY sort_time DESC, created_at DESC
       LIMIT 6`,
    )
    .bind(linkedServerId, linkedServerId)
    .all<Omit<PublicRecentEvent, "label">>();

  return (result.results ?? []).map((event) => ({
    ...event,
    label: publicEventLabel(event.event_type, event.source),
  })) satisfies PublicRecentEvent[];
}

function normalizePublicTagsJson(value: string | null) {
  if (!value) return "[]";
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return "[]";
    return JSON.stringify(parsed.filter((item): item is string => typeof item === "string").slice(0, 5));
  } catch {
    return "[]";
  }
}

function parsePublicTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function shouldShowMockServers(env: Env) {
  return isMockAuth(env.MOCK_AUTH) || isMockNitrado(env.MOCK_NITRADO);
}

function publicEventLabel(eventType: string, source: "kill" | "player") {
  if (source === "kill" || eventType === "player_killed") return "PvP Kill";
  const labels: Record<string, string> = {
    player_connected: "Connected",
    player_connecting: "Connecting",
    player_disconnected: "Disconnected",
    player_died_stats: "Died",
    player_killed_environment: "Died",
    player_suicide: "Suicide",
    player_hit: "Hit",
    player_hit_explosion: "Hit",
    player_hit_unknown_attacker: "Hit",
    player_placed_object: "Placed Object",
    playerlist_entry: "Player Snapshot",
    plain_player_state: "Player Snapshot",
  };
  return labels[eventType] ?? eventType.replace(/^player_/, "").replace(/_/g, " ");
}

function fileNameFromPath(path: string | null) {
  return path ? path.split("/").filter(Boolean).at(-1) ?? null : null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function calculatePublicServerKd(kills: number, deaths: number) {
  const safeKills = numberOrZero(kills);
  const safeDeaths = numberOrZero(deaths);
  if (safeKills === 0 && safeDeaths === 0) return { value: null, label: "Awaiting data" };
  if (safeKills > 0 && safeDeaths === 0) return { value: safeKills, label: "Flawless" };
  const value = safeDeaths > 0 ? Math.round((safeKills / safeDeaths) * 100) / 100 : 0;
  return { value, label: value.toFixed(2) };
}

function isSuccessfulAdmSyncStatus(value: string | null) {
  return ["completed", "idle", "no_new_lines", "no_supported_events"].includes(String(value ?? "").toLowerCase());
}

function dateValue(value: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function latestPublicTimestamp(values: Array<string | null | undefined>) {
  const sorted = values
    .filter((value): value is string => typeof value === "string" && value.length > 0 && dateValue(value) > 0)
    .sort((a, b) => dateValue(b) - dateValue(a));
  return sorted[0] ?? null;
}

function sanitizeSlug(value: string | null) {
  if (!value) return null;
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return slug || null;
}

function publicServerRowMatchesSlug(row: PublicServerRow, slug: string) {
  const candidates = publicSlugCandidates(row.public_slug, row.server_name, row.nitrado_service_name, row.guild_name);
  return slugCandidates(slug).some((candidate) => candidates.has(candidate));
}

function publicServerMatchesSlug(server: SafePublicServer, slug: string) {
  const candidates = publicSlugCandidates(server.public_slug, server.server_name, server.nitrado_service_name, server.guild_name);
  return slugCandidates(slug).some((candidate) => candidates.has(candidate));
}

function publicSlugCandidates(...values: Array<string | null>) {
  const candidates = new Set<string>();
  for (const value of values) {
    for (const candidate of slugCandidates(value)) {
      candidates.add(candidate);
    }
  }
  return candidates;
}

function slugCandidates(value: string | null) {
  if (!value) return [];
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "").slice(0, 90);
  const hyphenated = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  const preservedHyphen = normalized.replace(/[^a-z0-9-]/g, "").slice(0, 90);
  return Array.from(new Set([compact, hyphenated, preservedHyphen].filter(Boolean)));
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function truncateText(value: string | null, maxLength: number) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
