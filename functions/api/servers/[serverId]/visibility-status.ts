import { requireDb } from "../../../_lib/db";
import { json, methodNotAllowed } from "../../../_lib/http";
import {
  getBadgeShowcaseCompleteness,
  getOwnerVisibilityRecommendedActions,
  getProfileCompleteness,
  getServerDiscoveryScore,
  getServerVisibilityConfig,
  getVisibilityUpgradeBenefits,
  getVisualLoadoutCompleteness,
  explainServerVisibility,
} from "../../../_lib/server-visibility";
import {
  getAvailableShowcaseBadgesForServer,
  getServerVisualLoadout,
  getVisualLoadoutPlanLimits,
  resolveOwnerVisualLoadoutServer,
  resolveServerVisualLoadout,
} from "../../../_lib/server-visual-loadouts";
import type { PagesFunction } from "../../../_lib/types";

type VisibilityServerRow = {
  id: string;
  server_name: string | null;
  public_slug: string | null;
  server_category: string | null;
  server_type: string | null;
  tags_json: string | null;
  public_description: string | null;
  public_short_description: string | null;
  public_discord_invite: string | null;
  public_website_url: string | null;
  listing_visibility: string | null;
  current_players: number | null;
  is_online: number | null;
  metadata_last_checked_at: string | null;
  total_joins: number | null;
  unique_players: number | null;
  stats_updated_at: string | null;
  plan_key: string | null;
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const access = await resolveOwnerVisualLoadoutServer(env, request, params.serverId);
  if (!access.ok) return json(errorPayload(access.errorCode, access.message), { status: access.status });

  try {
    const [row, savedLoadout, resolvedLoadout, availableShowcaseBadges] = await Promise.all([
      readVisibilityServerRow(env, access.server.id),
      getServerVisualLoadout(env, access.server.id).catch(() => null),
      resolveServerVisualLoadout(env, access.server.id),
      getAvailableShowcaseBadgesForServer(env, access.server.id),
    ]);

    const server = row ?? fallbackServerRow(access.server);
    const planKey = server.plan_key ?? access.server.plan_key ?? "starter";
    const limits = getVisualLoadoutPlanLimits(planKey);
    const hasStoredStats = numberValue(server.total_joins) > 0 || numberValue(server.unique_players) > 0 || Boolean(server.stats_updated_at);
    const visibilityInput = {
      planKey,
      stats_sync: hasStoredStats ? "Active" : "Pending",
      stats_sync_active: hasStoredStats,
      is_online: Boolean(server.is_online),
      current_players: numberValue(server.current_players),
      total_joins: numberValue(server.total_joins),
      unique_players: numberValue(server.unique_players),
      last_sync_at: server.stats_updated_at,
      metadata_last_checked_at: server.metadata_last_checked_at,
      public_description: server.public_description,
      public_short_description: server.public_short_description,
      public_discord_invite: server.public_discord_invite,
      public_website_url: server.public_website_url,
      tags_json: server.tags_json,
      showcaseBadges: availableShowcaseBadges,
      visualLoadout: {
        source: savedLoadout ? "saved" : "fallback",
        showcaseBadgeCodes: resolvedLoadout.showcaseBadgeCodes,
        profileFrameKey: resolvedLoadout.profileFrameKey,
        themeBannerKey: resolvedLoadout.themeBannerKey,
        animationEnabled: resolvedLoadout.animationEnabled,
      },
    };
    const visibility = getServerVisibilityConfig(visibilityInput);
    const profileCompleteness = getProfileCompleteness({
      ...visibilityInput,
      public_slug: server.public_slug,
      server_category: server.server_category ?? server.server_type,
      listing_visibility: server.listing_visibility,
    });
    const visualLoadoutCompleteness = getVisualLoadoutCompleteness({
      ...visibilityInput,
      savedVisualLoadout: Boolean(savedLoadout),
      profileFrameKey: resolvedLoadout.profileFrameKey,
      themeBannerKey: resolvedLoadout.themeBannerKey,
      animationEnabled: resolvedLoadout.animationEnabled,
      animationsAllowed: limits.animationsAllowed,
    });
    const badgeShowcaseCompleteness = getBadgeShowcaseCompleteness({
      ...visibilityInput,
      selectedShowcaseBadges: resolvedLoadout.showcaseBadgeCodes,
      earnedShowcaseBadges: availableShowcaseBadges,
      maxShowcaseBadges: limits.maxShowcaseBadges,
    });
    const recommendedActions = getOwnerVisibilityRecommendedActions({
      planKey,
      profileCompleteness,
      visualLoadoutCompleteness,
      badgeShowcaseCompleteness,
      isSpotlightEligible: visibility.isSpotlightEligible,
    });

    return json({
      ok: true,
      server: {
        id: access.server.id,
        name: server.server_name,
        publicSlug: server.public_slug,
      },
      planKey: visibility.planKey,
      visibilityTier: visibility.visibilityTier,
      visibilityWeight: visibility.visibilityWeight,
      discoveryScore: getServerDiscoveryScore(visibilityInput),
      isFeaturedEligible: visibility.isFeaturedEligible,
      isSpotlightEligible: visibility.isSpotlightEligible,
      visibilityExplanation: explainServerVisibility(visibilityInput),
      profileCompleteness,
      visualLoadoutCompleteness,
      badgeShowcaseCompleteness,
      recommendedActions,
      upgradeBenefits: getVisibilityUpgradeBenefits(planKey),
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.warn("DZN visibility status unavailable", {
      requestId,
      serverId: access.server.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return json(errorPayload("VISIBILITY_STATUS_UNAVAILABLE", "Visibility status is temporarily unavailable. Please retry.", requestId), { status: 500 });
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestPatch: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});

async function readVisibilityServerRow(env: Parameters<typeof requireDb>[0], serverId: string) {
  return requireDb(env)
    .prepare(
      `SELECT
        linked_servers.id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug,
        linked_servers.server_category,
        linked_servers.server_type,
        linked_servers.tags_json,
        linked_servers.public_description,
        linked_servers.public_short_description,
        linked_servers.public_discord_invite,
        linked_servers.public_website_url,
        linked_servers.listing_visibility,
        linked_servers.current_players,
        linked_servers.is_online,
        linked_servers.metadata_last_checked_at,
        COALESCE(server_stats.total_joins, 0) AS total_joins,
        COALESCE(server_stats.unique_players, 0) AS unique_players,
        server_stats.updated_at AS stats_updated_at,
        COALESCE(server_subscriptions.plan_key, 'starter') AS plan_key
       FROM linked_servers
       LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       ORDER BY CASE lower(COALESCE(server_subscriptions.status, ''))
          WHEN 'active' THEN 0
          WHEN 'trialing' THEN 1
          ELSE 2
        END,
        server_subscriptions.updated_at DESC,
        server_subscriptions.created_at DESC
       LIMIT 1`,
    )
    .bind(serverId)
    .first<VisibilityServerRow>();
}

function fallbackServerRow(server: {
  id: string;
  public_slug: string | null;
  server_name: string | null;
  server_category: string | null;
  server_type: string | null;
  plan_key: string | null;
}): VisibilityServerRow {
  return {
    id: server.id,
    server_name: server.server_name,
    public_slug: server.public_slug,
    server_category: server.server_category,
    server_type: server.server_type,
    tags_json: "[]",
    public_description: null,
    public_short_description: null,
    public_discord_invite: null,
    public_website_url: null,
    listing_visibility: "public",
    current_players: 0,
    is_online: 0,
    metadata_last_checked_at: null,
    total_joins: 0,
    unique_players: 0,
    stats_updated_at: null,
    plan_key: server.plan_key,
  };
}

function errorPayload(errorCode: string, message: string, requestId?: string) {
  return {
    ok: false,
    error: errorCode,
    errorCode,
    message,
    ...(requestId ? { requestId } : {}),
  };
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
