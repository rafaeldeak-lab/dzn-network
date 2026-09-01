export type TrustedPlayerGameplayAggregateRow = {
  linked_game_profiles: number | null;
  linked_public_servers: number | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_suicides: number | null;
  longest_kill_distance: number | null;
  last_seen_at: string | null;
};

export type TrustedPlayerFeaturedServerRow = {
  linked_server_id: string;
  public_slug: string;
  server_name: string | null;
  server_type: string | null;
  platform: string | null;
  map_name: string | null;
  kills: number | null;
  deaths: number | null;
  longest_kill_distance: number | null;
  last_seen_at: string | null;
};

export const PUBLIC_PLAYER_STAT_SERVER_WHERE = `
  lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  AND linked_servers.public_slug IS NOT NULL
  AND trim(linked_servers.public_slug) != ''
`;

const trustedPublicPlayerProfileStatsCte = `
  trusted_public_player_profiles AS (
    SELECT
      player_profiles.id,
      player_profiles.linked_server_id,
      NULLIF(trim(player_profiles.player_id), '') AS player_id,
      COALESCE(player_profiles.kills, 0) AS profile_kills,
      COALESCE(player_profiles.deaths, 0) AS profile_deaths,
      COALESCE(player_profiles.suicides, 0) AS profile_suicides,
      COALESCE(player_profiles.longest_kill_distance, 0) AS profile_longest_kill_distance,
      COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at) AS profile_last_seen_at
    FROM player_profiles
    INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
    WHERE player_profiles.discord_id = ?
      AND player_profiles.discord_id IS NOT NULL
      AND trim(player_profiles.discord_id) != ''
      AND ${PUBLIC_PLAYER_STAT_SERVER_WHERE}
  ),
  trusted_public_player_profile_event_stats AS (
    SELECT
      trusted_public_player_profiles.id,
      COUNT(DISTINCT CASE WHEN kill_events.killer_id = trusted_public_player_profiles.player_id THEN kill_events.id END) AS event_kills,
      COUNT(DISTINCT CASE WHEN kill_events.victim_id = trusted_public_player_profiles.player_id THEN kill_events.id END) AS event_deaths,
      COALESCE(MAX(CASE WHEN kill_events.killer_id = trusted_public_player_profiles.player_id THEN COALESCE(kill_events.distance, 0) ELSE 0 END), 0) AS event_longest_kill_distance,
      MAX(COALESCE(kill_events.occurred_at, kill_events.created_at)) AS event_last_seen_at
    FROM trusted_public_player_profiles
    LEFT JOIN kill_events
      ON kill_events.linked_server_id = trusted_public_player_profiles.linked_server_id
      AND trusted_public_player_profiles.player_id IS NOT NULL
      AND (
        kill_events.killer_id = trusted_public_player_profiles.player_id
        OR kill_events.victim_id = trusted_public_player_profiles.player_id
      )
    GROUP BY trusted_public_player_profiles.id
  ),
  trusted_public_player_profile_resolved_stats AS (
    SELECT
      trusted_public_player_profiles.id,
      trusted_public_player_profiles.linked_server_id,
      CASE
        WHEN COALESCE(trusted_public_player_profile_event_stats.event_kills, 0) > trusted_public_player_profiles.profile_kills
        THEN COALESCE(trusted_public_player_profile_event_stats.event_kills, 0)
        ELSE trusted_public_player_profiles.profile_kills
      END AS resolved_kills,
      CASE
        WHEN COALESCE(trusted_public_player_profile_event_stats.event_deaths, 0) > trusted_public_player_profiles.profile_deaths
        THEN COALESCE(trusted_public_player_profile_event_stats.event_deaths, 0)
        ELSE trusted_public_player_profiles.profile_deaths
      END AS resolved_deaths,
      trusted_public_player_profiles.profile_suicides AS resolved_suicides,
      CASE
        WHEN COALESCE(trusted_public_player_profile_event_stats.event_longest_kill_distance, 0) > trusted_public_player_profiles.profile_longest_kill_distance
        THEN COALESCE(trusted_public_player_profile_event_stats.event_longest_kill_distance, 0)
        ELSE trusted_public_player_profiles.profile_longest_kill_distance
      END AS resolved_longest_kill_distance,
      CASE
        WHEN trusted_public_player_profile_event_stats.event_last_seen_at IS NULL THEN trusted_public_player_profiles.profile_last_seen_at
        WHEN trusted_public_player_profiles.profile_last_seen_at IS NULL THEN trusted_public_player_profile_event_stats.event_last_seen_at
        WHEN datetime(trusted_public_player_profile_event_stats.event_last_seen_at) > datetime(trusted_public_player_profiles.profile_last_seen_at)
        THEN trusted_public_player_profile_event_stats.event_last_seen_at
        ELSE trusted_public_player_profiles.profile_last_seen_at
      END AS resolved_last_seen_at
    FROM trusted_public_player_profiles
    LEFT JOIN trusted_public_player_profile_event_stats
      ON trusted_public_player_profile_event_stats.id = trusted_public_player_profiles.id
  )
`;

export async function readTrustedPlayerGameplayAggregate(db: D1Database, discordId: string) {
  const result = await db
    .prepare(
      `WITH
       ${trustedPublicPlayerProfileStatsCte}
       SELECT
        COUNT(trusted_public_player_profile_resolved_stats.id) AS linked_game_profiles,
        COUNT(DISTINCT trusted_public_player_profile_resolved_stats.linked_server_id) AS linked_public_servers,
        COALESCE(SUM(trusted_public_player_profile_resolved_stats.resolved_kills), 0) AS total_kills,
        COALESCE(SUM(trusted_public_player_profile_resolved_stats.resolved_deaths), 0) AS total_deaths,
        COALESCE(SUM(trusted_public_player_profile_resolved_stats.resolved_suicides), 0) AS total_suicides,
        COALESCE(MAX(trusted_public_player_profile_resolved_stats.resolved_longest_kill_distance), 0) AS longest_kill_distance,
        MAX(trusted_public_player_profile_resolved_stats.resolved_last_seen_at) AS last_seen_at
       FROM trusted_public_player_profile_resolved_stats`,
    )
    .bind(discordId)
    .first<TrustedPlayerGameplayAggregateRow>();

  return result ?? null;
}

export async function readTrustedPlayerFeaturedServer(db: D1Database, discordId: string) {
  const result = await db
    .prepare(
      `WITH
       ${trustedPublicPlayerProfileStatsCte}
       SELECT
        linked_servers.id AS linked_server_id,
        linked_servers.public_slug,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
        linked_servers.platform,
        linked_servers.map_name,
        trusted_public_player_profile_resolved_stats.resolved_kills AS kills,
        trusted_public_player_profile_resolved_stats.resolved_deaths AS deaths,
        trusted_public_player_profile_resolved_stats.resolved_longest_kill_distance AS longest_kill_distance,
        trusted_public_player_profile_resolved_stats.resolved_last_seen_at AS last_seen_at
       FROM trusted_public_player_profile_resolved_stats
       INNER JOIN linked_servers ON linked_servers.id = trusted_public_player_profile_resolved_stats.linked_server_id
       ORDER BY COALESCE(trusted_public_player_profile_resolved_stats.resolved_kills, 0) DESC,
         COALESCE(trusted_public_player_profile_resolved_stats.resolved_longest_kill_distance, 0) DESC,
         datetime(trusted_public_player_profile_resolved_stats.resolved_last_seen_at) DESC
       LIMIT 1`,
    )
    .bind(discordId)
    .first<TrustedPlayerFeaturedServerRow>();

  return result ?? null;
}
