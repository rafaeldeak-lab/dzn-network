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
import {
  PUBLIC_CURRENT_PLAYERS_SQL,
  PUBLIC_MAX_PLAYERS_SQL,
  PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL,
  PUBLIC_PLAYER_COUNT_STATUS_SQL,
} from "../../_lib/player-counts";
import { getPublicBadgeAwardMap, type ServerBadgeAwardRow } from "../../_lib/badge-awards";
import { getPublicServerLeaderboardById, getRankedPublicServers, type PublicLeaderboardPlayer, type PublicLeaderboardServer } from "../../_lib/public-leaderboards";
import { buildAchievementShowcase, buildServerReputationSummary, type AchievementShowcase, type ReputationSummary } from "../../_lib/reputation";
import { resolvePublicServerVisualLoadout, type PublicServerVisualLoadout } from "../../_lib/server-visual-loadouts";
import { explainServerVisibility, getFeaturedServerCandidates, getRecommendedServers, getServerDiscoveryScore, getServerVisibilityConfig, getSpotlightEligibleServers, type VisibilityExplanation, type VisibilityTier } from "../../_lib/server-visibility";
import { calculateServerScoreBreakdown, type ServerScoreBreakdown } from "../../_lib/server-ranking";
import type { Env, PagesFunction } from "../../_lib/types";
import { getServerVisualShowcase, type PlanVisualTreatment, type ProfileFrameVisual, type ServerThemeBannerVisual, type VisualBadge } from "../../../lib/badges/visuals";
import { buildServerBadgeCollection, type PublicLockedBadge, type ServerBadgeCollection } from "../../../lib/badges/rules";
import { normalizeListingPlanKey } from "../../../lib/billing/plans";
import {
  SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES,
  SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES,
  getServerLifecycleDisplay,
  normalizeServerLifecycleStatus,
  serverLifecycleInSql,
  serverLifecycleSqlExpression,
} from "../../../lib/server-lifecycle";

type PublicServerRow = {
  id: string;
  public_slug: string | null;
  server_name: string;
  server_type: string;
  tags_json: string | null;
  status: string;
  lifecycle_status?: string | null;
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
  advert_banner_url: string | null;
  advert_banner_alt: string | null;
  owner_announcement: string | null;
  fresh_wipe_promo: string | null;
  last_bumped_at: string | null;
  next_bump_at: string | null;
  bump_count_current_period: number | null;
  bump_period_start: string | null;
  bump_period_end: string | null;
  featured_until: string | null;
  featured_label: string | null;
  plan_key: string | null;
  subscription_status: string | null;
  active_promotions_json: string | null;
  network_rank?: number | null;
  longest_kill?: number | null;
};

type PublicServerRankingSnapshot = Omit<PublicLeaderboardServer, "rank"> & {
  rank: number | null;
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

type PublicPromotion = {
  promotionType: string;
  status: string;
  endsAt: string | null;
};

type PublicGalleryImage = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  sort_order: number;
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
  advert_banner_url: string | null;
  advert_banner_alt: string | null;
  owner_announcement: string | null;
  fresh_wipe_promo: string | null;
  gallery_images: PublicGalleryImage[];
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
  plan_key: "free" | "pro";
  premium_status: "standard" | "premium";
  visibility_weight: number;
  visibilityWeight: number;
  discoveryScore: number;
  visibilityTier: VisibilityTier;
  isFeaturedEligible: boolean;
  isSpotlightEligible: boolean;
  visibilityExplanation: VisibilityExplanation;
  activePromotions?: PublicPromotion[];
  reputation: ReputationSummary;
  achievement_showcase: AchievementShowcase;
  badges?: VisualBadge[];
  earnedBadges?: VisualBadge[];
  lockedBadges?: PublicLockedBadge[];
  showcaseBadges?: VisualBadge[];
  crowns?: VisualBadge[];
  reputationVisual?: VisualBadge;
  profileFrame?: ProfileFrameVisual;
  themeBanner?: ServerThemeBannerVisual;
  planVisualTreatment?: PlanVisualTreatment;
  visualLoadout?: {
    source: PublicServerVisualLoadout["source"];
    animationEnabled: boolean;
    cardStyle: PublicServerVisualLoadout["cardStyle"];
    accentColour: string;
    showcaseBadgeCodes: string[];
    profileFrameKey: string;
    themeBannerKey: string;
  };
  cardStyle?: PublicServerVisualLoadout["cardStyle"];
  accentColour?: string;
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
    public_listing: "Active" | "Historical";
    last_sync_at: string | null;
  };
  lifecycle?: {
    status: string;
    label: string;
    message: string;
    owner_action: string;
    historical: boolean;
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
      ok: true,
      servers: [],
      featured: [],
      recommended: [],
      spotlight: [],
      stats: {
        total_servers: 0,
        online_servers: 0,
        total_players: 0,
        total_kills: 0,
      },
      error: slug ? "public_server_profile_load_failed" : "public_servers_load_failed",
      message: slug ? "Unable to load this public server right now." : "Unable to load public servers right now.",
      server: slug ? null : undefined,
      generated_at: new Date().toISOString(),
      source: "empty_no_cache",
      stale: true,
      fallback_reason: "live_query_failed_no_snapshot",
      retry_after_seconds: 10,
    }, { headers: publicApiErrorHeaders(), status: 200 });
  }
};

export async function getPublicServersPayload(env: Env, slug: string | null, viewerLoggedIn = true) {
  if (!env.DB) {
    const mockServers = shouldShowMockServers(env) ? mockPublicServers().map((server) => applyPublicServerAccess(server, viewerLoggedIn)) : [];
    return slug
      ? { ok: true, server: findPublicServerBySlug(mockServers, slug) ?? null, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn }
      : { ok: true, servers: mockServers, ...buildPublicServerVisibilityGroups(mockServers), stats: buildPublicStats(mockServers), access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
  }

  if (!viewerLoggedIn && !slug) {
    return getPublicServersPreviewPayload(env);
  }

  if (slug) {
    return getPublicServerProfileFastPayload(env, slug, viewerLoggedIn);
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
  const badgeAwardMap = await getPublicBadgeAwardMap(env, publicRows.map((row) => row.id));
  const servers = (await Promise.all(publicRows.map((row) => toSafePublicServer(
    env,
    row,
    rankingById.get(row.id) ?? null,
    reviewSummaries.get(row.id) ?? emptyPublicServerRatingSummary(),
    badgeAwardMap.get(row.id) ?? null,
  ))))
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
    return { ok: true, servers: mockServers, ...buildPublicServerVisibilityGroups(mockServers), stats: buildPublicStats(mockServers), mock: true, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
  }

  return { ok: true, servers, ...buildPublicServerVisibilityGroups(servers), stats: buildPublicStats(servers), access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
}

async function getPublicServersPreviewPayload(env: Env) {
  const rows = await queryPublicServersPreview(env);
  const badgeAwardMap = await getPublicBadgeAwardMap(env, rows.map((row) => row.id));
  const servers = (await Promise.all(rows.map((row) => toSafePublicServerPreview(
    env,
    row,
    badgeAwardMap.get(row.id) ?? null,
  ))))
    .filter((server): server is SafePublicServer => Boolean(server))
    .map((server) => applyPublicServerAccess(server, false));
  sortPublicServersForDiscovery(servers);
  return { ok: true, servers, ...buildPublicServerVisibilityGroups(servers), stats: buildPublicStats(servers), access_level: "preview", is_locked: true };
}

async function getPublicServerProfileFastPayload(env: Env, slug: string, viewerLoggedIn: boolean) {
  const directRow = await queryPublicServerBySlug(env, slug);
  const aliasServerId = directRow ? null : await resolveSlugAliasLinkedServerId(env, slug).catch(() => null);
  const row = directRow ?? (aliasServerId ? await queryPublicServerById(env, aliasServerId) : null);

  if (!row) {
    if (shouldShowMockServers(env)) {
      const mockServers = mockPublicServers().map((server) => applyPublicServerAccess(server, viewerLoggedIn));
      return { ok: true, server: findPublicServerBySlug(mockServers, slug) ?? null, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
    }
    return { ok: true, server: null, access_level: viewerLoggedIn ? "full" : "preview", is_locked: !viewerLoggedIn };
  }

  const reviewSummaries = await getPublicServerRatingSummaries(env, [row.id]).catch(() => new Map<string, PublicServerRatingSummary>());
  const badgeAwardMap = await getPublicBadgeAwardMap(env, [row.id]).catch(() => new Map<string, { awards: ServerBadgeAwardRow[]; crownCodes: string[] }>());
  const server = await toSafePublicServer(
    env,
    row,
    lightweightRankingFromPublicRow(row),
    reviewSummaries.get(row.id) ?? emptyPublicServerRatingSummary(),
    badgeAwardMap.get(row.id) ?? null,
  );

  return getPublicServerProfileBySlug(
    env,
    row,
    server ? applyPublicServerAccess(server, viewerLoggedIn) : null,
    viewerLoggedIn,
  );
}

async function queryPublicServerBySlug(env: Env, slug: string) {
  return querySinglePublicServer(env, "lower(linked_servers.public_slug) = ?", slug);
}

async function queryPublicServerById(env: Env, linkedServerId: string) {
  return querySinglePublicServer(env, "linked_servers.id = ?", linkedServerId);
}

async function querySinglePublicServer(env: Env, whereClause: string, value: string) {
  const lifecycleStatusSql = serverLifecycleSqlExpression("linked_servers");
  const row = await requireDb(env)
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.tags_json,
        linked_servers.status,
        ${lifecycleStatusSql} AS lifecycle_status,
        linked_servers.nitrado_service_id,
        linked_servers.nitrado_service_name,
        COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players, linked_servers.player_slots) AS player_slots,
        COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players) AS max_players,
        ${PUBLIC_CURRENT_PLAYERS_SQL} AS current_players,
        linked_servers.platform,
        linked_servers.map_name,
        linked_servers.mission,
        linked_servers.server_mode,
        COALESCE(server_public_cache.server_status, linked_servers.server_status) AS server_status,
        COALESCE(server_public_cache.server_online, linked_servers.is_online) AS is_online,
        COALESCE(linked_servers.metadata_last_checked_at, server_public_cache.last_status_update_at) AS metadata_last_checked_at,
        ${PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL} AS player_count_last_checked_at,
        linked_servers.player_count_source,
        ${PUBLIC_PLAYER_COUNT_STATUS_SQL} AS player_count_status,
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
        (
          (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL)
          + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats'))
        ) AS total_deaths,
        (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_connected') AS total_joins,
        (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_disconnected') AS total_disconnects,
        (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id) AS unique_players,
        COALESCE((SELECT MAX(distance) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id), 0) AS longest_kill,
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
        linked_servers.advert_banner_url,
        linked_servers.advert_banner_alt,
        linked_servers.owner_announcement,
        linked_servers.fresh_wipe_promo,
        server_advertising_state.last_bumped_at,
        server_advertising_state.next_bump_at,
        server_advertising_state.bump_count_current_period,
        server_advertising_state.bump_period_start,
        server_advertising_state.bump_period_end,
        server_advertising_state.featured_until,
        server_advertising_state.featured_label,
        (
          SELECT json_group_array(json_object(
            'promotionType', server_promotions.promotion_type,
            'status', server_promotions.status,
            'endsAt', server_promotions.ends_at
          ))
          FROM server_promotions
          WHERE server_promotions.server_id = linked_servers.id
            AND server_promotions.status = 'active'
            AND server_promotions.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ) AS active_promotions_json,
        COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
        server_subscriptions.status AS subscription_status,
        server_public_cache.network_rank AS network_rank
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
       LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE ${whereClause}
         AND ${lifecycleStatusSql} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES)})
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(value)
    .first<PublicServerRow>();
  return row ? canonicalizePublicServerRows([row])[0] ?? null : null;
}

function lightweightRankingFromPublicRow(row: PublicServerRow): PublicServerRankingSnapshot {
  const kills = numberOrZero(row.total_kills);
  const deaths = numberOrZero(row.total_deaths);
  const uniquePlayers = numberOrZero(row.unique_players);
  const joins = numberOrZero(row.total_joins);
  const longestKill = numberOrZero(row.longest_kill);
  const statsSyncActive = isSuccessfulAdmSyncStatus(row.latest_success_sync_status) ||
    isSuccessfulAdmSyncStatus(row.adm_sync_status) ||
    kills > 0 ||
    deaths > 0 ||
    joins > 0 ||
    uniquePlayers > 0;
  const kd = calculatePublicServerKd(kills, deaths);
  const scoreBreakdown = calculateServerScoreBreakdown({
    kills,
    deaths,
    joins,
    uniquePlayers,
    longestKill,
    statsSyncActive,
  });
  return {
    rank: numberOrZero(row.network_rank) || null,
    server_id: row.id,
    server_name: row.server_name ?? "DZN Server",
    slug: row.public_slug,
    mode: row.server_type,
    kills,
    deaths,
    kd: kd.value,
    kd_label: kd.label,
    longest_kill: longestKill,
    unique_players: uniquePlayers,
    joins,
    stats_sync_active: statsSyncActive,
    score: scoreBreakdown.final_score,
    score_label: String(scoreBreakdown.final_score),
    score_breakdown: scoreBreakdown,
  };
}

async function queryPublicServersPreview(env: Env) {
  const lifecycleStatusSql = serverLifecycleSqlExpression("linked_servers");
  const result = await requireDb(env)
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.tags_json,
        linked_servers.status,
        ${lifecycleStatusSql} AS lifecycle_status,
        linked_servers.nitrado_service_id,
        linked_servers.nitrado_service_name,
        COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players, linked_servers.player_slots) AS player_slots,
        COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players) AS max_players,
        ${PUBLIC_CURRENT_PLAYERS_SQL} AS current_players,
        linked_servers.platform,
        linked_servers.map_name,
        linked_servers.mission,
        linked_servers.server_mode,
        COALESCE(server_public_cache.server_status, linked_servers.server_status) AS server_status,
        COALESCE(server_public_cache.server_online, linked_servers.is_online) AS is_online,
        COALESCE(linked_servers.metadata_last_checked_at, server_public_cache.last_status_update_at) AS metadata_last_checked_at,
        ${PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL} AS player_count_last_checked_at,
        linked_servers.player_count_source,
        ${PUBLIC_PLAYER_COUNT_STATUS_SQL} AS player_count_status,
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
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id) AS total_kills,
        (
          (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL)
          + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats'))
        ) AS total_deaths,
        (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_connected') AS total_joins,
        (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_disconnected') AS total_disconnects,
        (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id) AS unique_players,
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
        linked_servers.advert_banner_url,
        linked_servers.advert_banner_alt,
        linked_servers.owner_announcement,
        linked_servers.fresh_wipe_promo,
        server_advertising_state.last_bumped_at,
        server_advertising_state.next_bump_at,
        server_advertising_state.bump_count_current_period,
        server_advertising_state.bump_period_start,
        server_advertising_state.bump_period_end,
        server_advertising_state.featured_until,
        server_advertising_state.featured_label,
        (
          SELECT json_group_array(json_object(
            'promotionType', server_promotions.promotion_type,
            'status', server_promotions.status,
            'endsAt', server_promotions.ends_at
          ))
          FROM server_promotions
          WHERE server_promotions.server_id = linked_servers.id
            AND server_promotions.status = 'active'
            AND server_promotions.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ) AS active_promotions_json,
        COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
        server_subscriptions.status AS subscription_status
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
       LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE lower(linked_servers.status) = 'live'
         AND ${lifecycleStatusSql} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY
         CASE
           WHEN EXISTS (SELECT 1 FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id LIMIT 1)
             OR EXISTS (SELECT 1 FROM player_events WHERE player_events.linked_server_id = linked_servers.id LIMIT 1) THEN 0
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
    const leaderboard = await getPublicServerLeaderboardById(env, row.id, 10).catch(() => [] as PublicLeaderboardPlayer[]);
    server.top_players = leaderboard.slice(0, 5);
    server.pvp_leaderboard = leaderboard;
  }
  if (server.plan_key === "pro") {
    server.gallery_images = await getPublicServerGalleryImages(env, row.id).catch(() => [] as PublicGalleryImage[]);
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
  const lifecycleStatusSql = serverLifecycleSqlExpression("linked_servers");
  const baseQuery = `
    SELECT
      linked_servers.id,
      linked_servers.public_slug,
      COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
      COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
      linked_servers.tags_json,
      linked_servers.status,
      ${lifecycleStatusSql} AS lifecycle_status,
      linked_servers.nitrado_service_id,
      linked_servers.nitrado_service_name,
      COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players, linked_servers.player_slots) AS player_slots,
      COALESCE(${PUBLIC_MAX_PLAYERS_SQL}, linked_servers.max_players) AS max_players,
      ${PUBLIC_CURRENT_PLAYERS_SQL} AS current_players,
      linked_servers.platform,
      linked_servers.map_name,
      linked_servers.mission,
      linked_servers.server_mode,
      COALESCE(server_public_cache.server_status, linked_servers.server_status) AS server_status,
      COALESCE(server_public_cache.server_online, linked_servers.is_online) AS is_online,
      COALESCE(linked_servers.metadata_last_checked_at, server_public_cache.last_status_update_at) AS metadata_last_checked_at,
      ${PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL} AS player_count_last_checked_at,
      linked_servers.player_count_source,
      ${PUBLIC_PLAYER_COUNT_STATUS_SQL} AS player_count_status,
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
      (
        (SELECT COUNT(*) FROM kill_events WHERE kill_events.linked_server_id = linked_servers.id AND kill_events.victim_name IS NOT NULL)
        + (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type IN ('player_suicide', 'player_killed_environment', 'player_died_stats'))
      ) AS total_deaths,
      (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_connected') AS total_joins,
      (SELECT COUNT(*) FROM player_events WHERE player_events.linked_server_id = linked_servers.id AND player_events.event_type = 'player_disconnected') AS total_disconnects,
      (SELECT COUNT(*) FROM player_profiles WHERE player_profiles.linked_server_id = linked_servers.id) AS unique_players,
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
      linked_servers.advert_banner_url,
      linked_servers.advert_banner_alt,
      linked_servers.owner_announcement,
      linked_servers.fresh_wipe_promo,
      server_advertising_state.last_bumped_at,
      server_advertising_state.next_bump_at,
      server_advertising_state.bump_count_current_period,
      server_advertising_state.bump_period_start,
      server_advertising_state.bump_period_end,
      server_advertising_state.featured_until,
      server_advertising_state.featured_label,
      (
        SELECT json_group_array(json_object(
          'promotionType', server_promotions.promotion_type,
          'status', server_promotions.status,
          'endsAt', server_promotions.ends_at
        ))
        FROM server_promotions
        WHERE server_promotions.server_id = linked_servers.id
          AND server_promotions.status = 'active'
          AND server_promotions.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ) AS active_promotions_json,
      COALESCE(server_subscriptions.plan_key, 'free') AS plan_key,
      server_subscriptions.status AS subscription_status
    FROM linked_servers
    LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
    LEFT JOIN server_log_config ON server_log_config.linked_server_id = linked_servers.id
    LEFT JOIN onboarding_checks ON onboarding_checks.linked_server_id = linked_servers.id
    LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
    LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
    LEFT JOIN server_advertising_state ON server_advertising_state.linked_server_id = linked_servers.id
    LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
    LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
    WHERE lower(linked_servers.status) = 'live'
      AND ${lifecycleStatusSql} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})
      AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
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
  const lifecycleStatusSql = serverLifecycleSqlExpression("linked_servers");
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
         AND ${lifecycleStatusSql} IN (${serverLifecycleInSql(SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES)})
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
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

async function toSafePublicServer(
  env: Env,
  row: PublicServerRow,
  ranking: PublicServerRankingSnapshot | null,
  reviewSummary: PublicServerRatingSummary,
  badgeAwardData: { awards: ServerBadgeAwardRow[]; crownCodes: string[] } | null,
): Promise<SafePublicServer | null> {
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
  const planKey = publicPlanKey(row.plan_key, row.subscription_status);
  const reputation = buildServerReputationSummary({
    planKey,
    createdAt: row.created_at,
    totalKills: stats.total_kills,
    totalDeaths: stats.total_deaths,
    totalJoins: stats.total_joins,
    totalDisconnects: stats.total_disconnects,
    uniquePlayers: stats.unique_players,
    rank: stats.rank,
    score: stats.score,
    category: row.server_type,
    active: statsSync === "Active",
  });
  const achievementShowcase = buildAchievementShowcase({
    planKey,
    createdAt: row.created_at,
    totalKills: stats.total_kills,
    totalDeaths: stats.total_deaths,
    totalJoins: stats.total_joins,
    totalDisconnects: stats.total_disconnects,
    uniquePlayers: stats.unique_players,
    rank: stats.rank,
    score: stats.score,
    category: row.server_type,
    active: statsSync === "Active",
  });
  const advertising = publicAdvertisingFromState({
    last_bumped_at: row.last_bumped_at,
    next_bump_at: row.next_bump_at,
    bump_count_current_period: numberOrZero(row.bump_count_current_period),
    bump_period_start: row.bump_period_start,
    bump_period_end: row.bump_period_end,
    featured_until: row.featured_until,
    featured_label: row.featured_label,
  });
  const activePromotions = parsePublicPromotions(row.active_promotions_json);
  const lifecycleStatus = normalizeServerLifecycleStatus({
    lifecycle_status: row.lifecycle_status,
    status: row.status,
  });
  const lifecycleDisplay = getServerLifecycleDisplay(lifecycleStatus);
  const historicalLifecycle = lifecycleStatus === "legacy_offline" || lifecycleStatus === "final_sync_complete";
  const visualShowcase = getServerVisualShowcase({
    planKey,
    reputationTier: reputation.tier,
    category: row.server_type,
    mapName: row.map_name ?? row.mission,
    achievementShowcase,
  });
  const badgeCollection = buildPublicBadgeCollection({
    row,
    stats,
    planKey,
    statsSync,
    awardData: badgeAwardData,
    featured: advertising.is_featured,
  });
  const automaticShowcaseBadges = badgeCollection.showcaseBadges.length ? badgeCollection.showcaseBadges : visualShowcase.badges;
  const availableShowcaseBadges = badgeCollection.earnedBadges.filter((badge) => badge.isPublic && badge.isShowcaseBadge);
  const publicVisualLoadout = await resolvePublicServerVisualLoadout(
    env,
    row.id,
    planKey,
    availableShowcaseBadges.length ? availableShowcaseBadges : automaticShowcaseBadges,
    {
      showcaseBadges: automaticShowcaseBadges,
      profileFrame: visualShowcase.profileFrame,
      themeBanner: visualShowcase.themeBanner,
      cardStyle: visualShowcase.planVisualTreatment.cardTreatment,
      accentColour: visualShowcase.profileFrame.glowColour,
    },
  );
  const visibilityInput = {
    planKey,
    stats_sync: statsSync,
    stats_sync_active: ranking?.stats_sync_active ?? statsSync === "Active",
    is_online: Number(row.is_online) === 1,
    current_players: row.current_players,
    total_joins: stats.total_joins,
    unique_players: stats.unique_players,
    last_sync_at: lastSyncAt,
    metadata_last_checked_at: row.metadata_last_checked_at,
    public_description: row.public_description,
    public_short_description: row.public_short_description,
    public_discord_invite: row.public_discord_invite,
    public_website_url: row.public_website_url,
    tags,
    reputation,
    earnedBadges: badgeCollection.earnedBadges,
    showcaseBadges: publicVisualLoadout.showcaseBadges,
    crowns: badgeCollection.crowns,
    activePromotions,
    visualLoadout: {
      source: publicVisualLoadout.source,
      animationEnabled: publicVisualLoadout.animationEnabled,
      cardStyle: publicVisualLoadout.cardStyle,
      showcaseBadgeCodes: publicVisualLoadout.showcaseBadges.map((badge) => badge.code),
      profileFrameKey: publicVisualLoadout.profileFrame.key,
      themeBannerKey: publicVisualLoadout.themeBanner.key,
    },
  };
  const visibilityConfig = getServerVisibilityConfig(visibilityInput);
  const discoveryScore = getServerDiscoveryScore(visibilityInput);
  return {
    linked_server_id: row.id,
    public_slug: row.public_slug,
    server_name: row.server_name,
    server_type: row.server_type,
    tags_json: tagsJson,
    tags,
    status: row.status,
    lifecycle: {
      status: lifecycleStatus,
      label: lifecycleDisplay.label,
      message: lifecycleDisplay.message,
      owner_action: lifecycleDisplay.ownerAction,
      historical: historicalLifecycle,
    },
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
    advert_banner_url: planKey === "pro" ? row.advert_banner_url : null,
    advert_banner_alt: planKey === "pro" ? row.advert_banner_alt : null,
    owner_announcement: planKey === "pro" ? row.owner_announcement : null,
    fresh_wipe_promo: planKey === "pro" ? row.fresh_wipe_promo : null,
    gallery_images: [],
    created_at: row.created_at,
    ...stats,
    score_breakdown: ranking?.score_breakdown ?? null,
    stats_sync_active: ranking?.stats_sync_active ?? statsSync === "Active",
    average_rating: reviewSummary.average_rating,
    review_count: reviewSummary.review_count,
    rating_breakdown: reviewSummary.rating_breakdown,
    advertising,
    plan_key: planKey,
    premium_status: reputation.premiumStatus,
    visibility_weight: visibilityConfig.visibilityWeight,
    visibilityWeight: visibilityConfig.visibilityWeight,
    discoveryScore,
    visibilityTier: visibilityConfig.visibilityTier,
    isFeaturedEligible: visibilityConfig.isFeaturedEligible,
    isSpotlightEligible: visibilityConfig.isSpotlightEligible,
    visibilityExplanation: explainServerVisibility(visibilityInput),
    activePromotions,
    reputation,
    achievement_showcase: achievementShowcase,
    ...visualShowcase,
    badges: publicVisualLoadout.showcaseBadges,
    earnedBadges: badgeCollection.earnedBadges,
    lockedBadges: badgeCollection.lockedBadges,
    showcaseBadges: publicVisualLoadout.showcaseBadges,
    crowns: badgeCollection.crowns,
    reputationVisual: badgeCollection.reputationBadge,
    profileFrame: publicVisualLoadout.profileFrame,
    themeBanner: publicVisualLoadout.themeBanner,
    visualLoadout: {
      source: visibilityInput.visualLoadout.source,
      animationEnabled: visibilityInput.visualLoadout.animationEnabled,
      cardStyle: visibilityInput.visualLoadout.cardStyle,
      accentColour: publicVisualLoadout.accentColour,
      showcaseBadgeCodes: visibilityInput.visualLoadout.showcaseBadgeCodes,
      profileFrameKey: visibilityInput.visualLoadout.profileFrameKey,
      themeBannerKey: visibilityInput.visualLoadout.themeBannerKey,
    },
    cardStyle: publicVisualLoadout.cardStyle,
    accentColour: publicVisualLoadout.accentColour,
    stats,
    network_status: {
      adm_status: admStatus,
      stats_sync: statsSync,
      public_listing: historicalLifecycle ? "Historical" : "Active",
      last_sync_at: lastSyncAt,
    },
    recent_events: await getPublicRecentEvents(env, row.id).catch(() => []),
  } satisfies SafePublicServer;
}

async function toSafePublicServerPreview(
  env: Env,
  row: PublicServerRow,
  badgeAwardData: { awards: ServerBadgeAwardRow[]; crownCodes: string[] } | null,
): Promise<SafePublicServer | null> {
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
  const planKey = publicPlanKey(row.plan_key, row.subscription_status);
  const reputation = buildServerReputationSummary({
    planKey,
    createdAt: row.created_at,
    totalKills: stats.total_kills,
    totalDeaths: stats.total_deaths,
    totalJoins: stats.total_joins,
    totalDisconnects: stats.total_disconnects,
    uniquePlayers: stats.unique_players,
    rank: stats.rank,
    score: stats.score,
    category: row.server_type,
    active: statsSync === "Active",
  });
  const achievementShowcase = buildAchievementShowcase({
    planKey,
    createdAt: row.created_at,
    totalKills: stats.total_kills,
    totalDeaths: stats.total_deaths,
    totalJoins: stats.total_joins,
    totalDisconnects: stats.total_disconnects,
    uniquePlayers: stats.unique_players,
    rank: stats.rank,
    score: stats.score,
    category: row.server_type,
    active: statsSync === "Active",
  });
  const visualShowcase = getServerVisualShowcase({
    planKey,
    reputationTier: reputation.tier,
    category: row.server_type,
    mapName: row.map_name ?? row.mission,
    achievementShowcase,
  });
  const advertising = publicAdvertisingFromState({
    last_bumped_at: row.last_bumped_at,
    next_bump_at: row.next_bump_at,
    bump_count_current_period: numberOrZero(row.bump_count_current_period),
    bump_period_start: row.bump_period_start,
    bump_period_end: row.bump_period_end,
    featured_until: row.featured_until,
    featured_label: row.featured_label,
  });
  const activePromotions = parsePublicPromotions(row.active_promotions_json);
  const badgeCollection = buildPublicBadgeCollection({
    row,
    stats,
    planKey,
    statsSync,
    awardData: badgeAwardData,
    featured: advertising.is_featured,
  });
  const automaticShowcaseBadges = badgeCollection.showcaseBadges.length ? badgeCollection.showcaseBadges : visualShowcase.badges;
  const availableShowcaseBadges = badgeCollection.earnedBadges.filter((badge) => badge.isPublic && badge.isShowcaseBadge);
  const publicVisualLoadout = await resolvePublicServerVisualLoadout(
    env,
    row.id,
    planKey,
    availableShowcaseBadges.length ? availableShowcaseBadges : automaticShowcaseBadges,
    {
      showcaseBadges: automaticShowcaseBadges,
      profileFrame: visualShowcase.profileFrame,
      themeBanner: visualShowcase.themeBanner,
      cardStyle: visualShowcase.planVisualTreatment.cardTreatment,
      accentColour: visualShowcase.profileFrame.glowColour,
    },
  );
  const visibilityInput = {
    planKey,
    stats_sync: statsSync,
    stats_sync_active: statsSync === "Active",
    is_online: Number(row.is_online) === 1,
    current_players: row.current_players,
    total_joins: stats.total_joins,
    unique_players: stats.unique_players,
    last_sync_at: lastSyncAt,
    metadata_last_checked_at: row.metadata_last_checked_at,
    public_description: row.public_description,
    public_short_description: row.public_short_description,
    public_discord_invite: row.public_discord_invite,
    public_website_url: row.public_website_url,
    tags: parsePublicTags(tagsJson),
    reputation,
    earnedBadges: badgeCollection.earnedBadges,
    showcaseBadges: publicVisualLoadout.showcaseBadges,
    crowns: badgeCollection.crowns,
    activePromotions,
    visualLoadout: {
      source: publicVisualLoadout.source,
      animationEnabled: publicVisualLoadout.animationEnabled,
      cardStyle: publicVisualLoadout.cardStyle,
      showcaseBadgeCodes: publicVisualLoadout.showcaseBadges.map((badge) => badge.code),
      profileFrameKey: publicVisualLoadout.profileFrame.key,
      themeBannerKey: publicVisualLoadout.themeBanner.key,
    },
  };
  const visibilityConfig = getServerVisibilityConfig(visibilityInput);
  const discoveryScore = getServerDiscoveryScore(visibilityInput);
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
    advert_banner_url: planKey === "pro" ? row.advert_banner_url : null,
    advert_banner_alt: planKey === "pro" ? row.advert_banner_alt : null,
    owner_announcement: planKey === "pro" ? row.owner_announcement : null,
    fresh_wipe_promo: planKey === "pro" ? row.fresh_wipe_promo : null,
    gallery_images: [],
    created_at: row.created_at,
    ...stats,
    score_breakdown: null,
    stats_sync_active: statsSync === "Active",
    ...emptyPublicServerRatingSummary(),
    advertising,
    plan_key: planKey,
    premium_status: reputation.premiumStatus,
    visibility_weight: visibilityConfig.visibilityWeight,
    visibilityWeight: visibilityConfig.visibilityWeight,
    discoveryScore,
    visibilityTier: visibilityConfig.visibilityTier,
    isFeaturedEligible: visibilityConfig.isFeaturedEligible,
    isSpotlightEligible: visibilityConfig.isSpotlightEligible,
    visibilityExplanation: explainServerVisibility(visibilityInput),
    activePromotions,
    reputation,
    achievement_showcase: achievementShowcase,
    ...visualShowcase,
    badges: publicVisualLoadout.showcaseBadges,
    earnedBadges: badgeCollection.earnedBadges,
    lockedBadges: badgeCollection.lockedBadges,
    showcaseBadges: publicVisualLoadout.showcaseBadges,
    crowns: badgeCollection.crowns,
    reputationVisual: badgeCollection.reputationBadge,
    profileFrame: publicVisualLoadout.profileFrame,
    themeBanner: publicVisualLoadout.themeBanner,
    visualLoadout: {
      source: visibilityInput.visualLoadout.source,
      animationEnabled: visibilityInput.visualLoadout.animationEnabled,
      cardStyle: visibilityInput.visualLoadout.cardStyle,
      accentColour: publicVisualLoadout.accentColour,
      showcaseBadgeCodes: visibilityInput.visualLoadout.showcaseBadgeCodes,
      profileFrameKey: visibilityInput.visualLoadout.profileFrameKey,
      themeBannerKey: visibilityInput.visualLoadout.themeBannerKey,
    },
    cardStyle: publicVisualLoadout.cardStyle,
    accentColour: publicVisualLoadout.accentColour,
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

function buildPublicBadgeCollection(input: {
  row: PublicServerRow;
  stats: {
    total_kills: number;
    total_deaths: number;
    total_joins: number;
    total_disconnects: number;
    unique_players: number;
    longest_kill: number;
    rank: number | null;
    score: number;
  };
  planKey: string;
  statsSync: "Active" | "Pending" | "Not Started";
  awardData: { awards: ServerBadgeAwardRow[]; crownCodes: string[] } | null;
  featured: boolean;
}): ServerBadgeCollection {
  const awards = input.awardData?.awards ?? [];
  const awardedBadgeCodes = awards.map((award) => award.badge_code);
  const earnedAtByCode = Object.fromEntries(awards.map((award) => [award.badge_code, award.awarded_at]));
  return buildServerBadgeCollection({
    serverId: input.row.id,
    planKey: input.planKey,
    createdAt: input.row.created_at,
    totalKills: input.stats.total_kills,
    totalDeaths: input.stats.total_deaths,
    totalJoins: input.stats.total_joins,
    totalDisconnects: input.stats.total_disconnects,
    uniquePlayers: input.stats.unique_players,
    longestKill: input.stats.longest_kill,
    rank: input.stats.rank,
    score: input.stats.score,
    category: input.row.server_type,
    active: input.statsSync === "Active",
    verified: String(input.row.status ?? "").toLowerCase() === "live" || input.statsSync === "Active",
    featured: input.featured,
    achievementCount: awardedBadgeCodes.length,
    awardedBadgeCodes,
    activeCrownCodes: input.awardData?.crownCodes ?? [],
    earnedAtByCode,
  });
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

async function getPublicServerGalleryImages(env: Env, linkedServerId: string): Promise<PublicGalleryImage[]> {
  const result = await requireDb(env)
    .prepare(
      `SELECT id, url, width, height, size_bytes, sort_order
       FROM server_gallery_images
       WHERE server_id = ?
       ORDER BY sort_order ASC, created_at ASC
       LIMIT 4`,
    )
    .bind(linkedServerId)
    .all<{
      id: string;
      url: string | null;
      width: number | null;
      height: number | null;
      size_bytes: number | null;
      sort_order: number | null;
    }>();
  return (result.results ?? [])
    .filter((row) => typeof row.url === "string" && row.url.startsWith("https://"))
    .map((row, index) => ({
      id: row.id,
      url: row.url as string,
      width: row.width === null ? null : numberOrZero(row.width),
      height: row.height === null ? null : numberOrZero(row.height),
      size_bytes: row.size_bytes === null ? null : numberOrZero(row.size_bytes),
      sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : index,
    }));
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

function buildPublicServerVisibilityGroups(servers: SafePublicServer[]) {
  const featuredServers = getFeaturedServerCandidates({ servers, limit: 6 });
  const spotlightServers = getSpotlightEligibleServers({ servers, limit: 3 });
  const recommendedServers = getRecommendedServers({ servers, limit: 8 });
  const highlightedIds = new Set([...featuredServers, ...spotlightServers, ...recommendedServers].map((server) => server.linked_server_id));
  const standardServers = servers.filter((server) => !highlightedIds.has(server.linked_server_id)).slice(0, 12);
  return {
    featuredServers,
    spotlightServers,
    recommendedServers,
    standardServers,
  };
}

export function sortPublicServersForDiscovery<T extends {
  advertising?: PublicAdvertising;
  discoveryScore?: number;
  visibility_weight?: number;
  rank: number | null;
  score: number;
  created_at: string | null;
}>(servers: T[]) {
  servers.sort((a, b) => {
    const adDiff = advertisingSortScore(b.advertising ?? publicAdvertisingFromState(null)) - advertisingSortScore(a.advertising ?? publicAdvertisingFromState(null));
    if (adDiff) return adDiff;
    const discoveryDiff = numberOrZero(b.discoveryScore) - numberOrZero(a.discoveryScore);
    if (discoveryDiff) return discoveryDiff;
    const visibilityDiff = numberOrZero(b.visibility_weight) - numberOrZero(a.visibility_weight);
    if (visibilityDiff) return visibilityDiff;
    const rankA = typeof a.rank === "number" && a.rank > 0 ? a.rank : Number.MAX_SAFE_INTEGER;
    const rankB = typeof b.rank === "number" && b.rank > 0 ? b.rank : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const scoreDiff = numberOrZero(b.score) - numberOrZero(a.score);
    if (scoreDiff) return scoreDiff;
    return dateValue(b.created_at) - dateValue(a.created_at);
  });
  return servers;
}

function publicPlanKey(value: unknown, subscriptionStatus?: unknown): "free" | "pro" {
  return normalizeListingPlanKey(value, subscriptionStatus);
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
      ...mockReputationFields("free", { created_at: new Date().toISOString(), server_type: "PVP / PVE", total_kills: 0, total_deaths: 0, total_joins: 0, total_disconnects: 0, unique_players: 0, rank: null, score: 0, active: false }),
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
      ...mockReputationFields("pro", { created_at: new Date().toISOString(), server_type: "PVP", total_kills: 12, total_deaths: 18, total_joins: 42, total_disconnects: 36, unique_players: 14, rank: 1, score: 0, active: true }),
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
      ...mockReputationFields("free", { created_at: new Date().toISOString(), server_type: "DEATHMATCH", total_kills: 0, total_deaths: 0, total_joins: 0, total_disconnects: 0, unique_players: 0, rank: null, score: 0, active: false }),
      ...mockListingFields("Fast respawn deathmatch arena for clean fights and leaderboard runs."),
      recent_events: [],
    },
  ];
}

function mockReputationFields(planKey: "free" | "pro", input: {
  created_at: string;
  server_type: string;
  total_kills: number;
  total_deaths: number;
  total_joins: number;
  total_disconnects: number;
  unique_players: number;
  rank: number | null;
  score: number;
  active: boolean;
}) {
  const reputation = buildServerReputationSummary({
    planKey,
    createdAt: input.created_at,
    totalKills: input.total_kills,
    totalDeaths: input.total_deaths,
    totalJoins: input.total_joins,
    totalDisconnects: input.total_disconnects,
    uniquePlayers: input.unique_players,
    rank: input.rank,
    score: input.score,
    category: input.server_type,
    active: input.active,
  });
  const achievementShowcase = buildAchievementShowcase({
    planKey,
    createdAt: input.created_at,
    totalKills: input.total_kills,
    totalDeaths: input.total_deaths,
    totalJoins: input.total_joins,
    totalDisconnects: input.total_disconnects,
    uniquePlayers: input.unique_players,
    rank: input.rank,
    score: input.score,
    category: input.server_type,
    active: input.active,
  });
  const visualShowcase = getServerVisualShowcase({
    planKey,
    reputationTier: reputation.tier,
    category: input.server_type,
    achievementShowcase,
  });
  const visibilityInput = {
    planKey,
    stats_sync: input.active ? "Active" : "Pending",
    stats_sync_active: input.active,
    total_joins: input.total_joins,
    unique_players: input.unique_players,
    reputation,
    showcaseBadges: visualShowcase.badges,
    visualLoadout: {
      source: "fallback",
      animationEnabled: false,
      cardStyle: visualShowcase.planVisualTreatment.cardTreatment,
      showcaseBadgeCodes: visualShowcase.badges.map((badge) => badge.code),
      profileFrameKey: visualShowcase.profileFrame.key,
      themeBannerKey: visualShowcase.themeBanner.key,
    },
  };
  const visibilityConfig = getServerVisibilityConfig(visibilityInput);
  return {
    plan_key: (planKey === "pro" ? "pro" : "free") as "free" | "pro",
    premium_status: reputation.premiumStatus,
    visibility_weight: visibilityConfig.visibilityWeight,
    visibilityWeight: visibilityConfig.visibilityWeight,
    discoveryScore: getServerDiscoveryScore(visibilityInput),
    visibilityTier: visibilityConfig.visibilityTier,
    isFeaturedEligible: visibilityConfig.isFeaturedEligible,
    isSpotlightEligible: visibilityConfig.isSpotlightEligible,
    visibilityExplanation: explainServerVisibility(visibilityInput),
    reputation,
    achievement_showcase: achievementShowcase,
    ...visualShowcase,
  };
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
    advert_banner_url: null,
    advert_banner_alt: null,
    owner_announcement: null,
    fresh_wipe_promo: null,
    gallery_images: [],
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

function parsePublicPromotions(value: string | null): PublicPromotion[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const promotionType = String(record.promotionType ?? record.promotion_type ?? "").trim().toLowerCase();
        if (!["directory_bump", "featured_rotation", "spotlight_boost"].includes(promotionType)) return null;
        const status = String(record.status ?? "active").trim().toLowerCase();
        if (status !== "active") return null;
        const endsAt = firstString(record.endsAt, record.ends_at);
        if (endsAt && dateValue(endsAt) > 0 && dateValue(endsAt) <= now) return null;
        return { promotionType, status, endsAt };
      })
      .filter((promotion): promotion is PublicPromotion => Boolean(promotion));
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
