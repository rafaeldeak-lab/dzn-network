import { ensureMockUser, getSessionUser, requireDb } from "../../_lib/db";
import { canManageDiscordGuild } from "../../_lib/discord";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth } from "../../_lib/mock";
import { readPlayerSavedServersForUser } from "../../_lib/player-saved-servers";
import { privateNoStoreHeaders } from "../../_lib/performance";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type PlayerHubCommunityRow = {
  id: string;
  guild_id: string;
  name: string;
  icon_url: string | null;
  permissions: string | null;
  is_owner: number | null;
};

type PlayerHubCommunityMembershipRow = {
  guild_id: string;
  name: string;
  icon_url: string | null;
  relationship: "member" | "administrator" | "owner" | null;
  last_seen_at: string | null;
};

type PlayerHubCommunityMatch = {
  guild_id: string;
  name: string;
  icon_url: string | null;
  relationship: "member" | "administrator" | "owner" | "matched";
  relationship_label: string;
  match_keys: string[];
  last_seen_at: string | null;
};

type PlayerHubCommunitySource = "player_discord_community_memberships" | "cached_discord_manageable_guilds" | "unavailable";

type PlayerHubCommunitiesReadModel = {
  communities: Array<{
    guild_id: string;
    name: string;
    icon_url: string | null;
    relationship: PlayerHubCommunityMatch["relationship"];
    relationship_label: string;
    public_server_count: number;
    matched_servers: ReturnType<typeof uniqueCommunityServers>;
  }>;
  source: PlayerHubCommunitySource;
  lastCheckedAt: string | null;
};

type PlayerHubCommunityServerRow = {
  linked_server_id: string;
  discord_guild_id: string | null;
  guild_id: string | null;
  public_slug: string;
  server_name: string;
  server_type: string;
  platform: string | null;
  map_name: string | null;
  current_players: number | null;
  max_players: number | null;
};

type PlayerHubEventRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  event_type: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  server_limit: number | null;
  team_limit: number | null;
  registered_servers: number | null;
  created_at: string | null;
};

type PlayerHubEventServerRow = {
  event_id: string;
  server_id: string;
};

type PlayerHubSuggestedEventRelevanceLevel = "followed_server" | "matched_community" | "public_network";

type PlayerHubSuggestedEventRelevance = {
  level: PlayerHubSuggestedEventRelevanceLevel;
  label: string;
  reasons: string[];
  presentation_only: true;
};

type PlayerHubSuggestedEventContext = {
  savedServerIds: string[];
  matchedCommunityServerIds: string[];
};

type PlayerHubProfileAggregateRow = {
  linked_game_profiles: number | null;
  linked_public_servers: number | null;
  total_kills: number | null;
  total_deaths: number | null;
  total_suicides: number | null;
  longest_kill_distance: number | null;
  last_seen_at: string | null;
};

type PlayerHubFeaturedProfileServerRow = {
  linked_server_id: string;
  public_slug: string;
  server_name: string;
  server_type: string | null;
  platform: string | null;
  map_name: string | null;
  kills: number | null;
  deaths: number | null;
  longest_kill_distance: number | null;
  last_seen_at: string | null;
};

type PlayerHubProfileProgressionReadModel = {
  profileSummary: {
    display_name: string;
    private_profile_href: string;
    public_profile_href: string | null;
    public_profile_status: "not_configured";
    public_profile_message: string;
    linked_game_profiles: number;
    linked_public_servers: number;
    last_seen_at: string | null;
    source: "player_profiles" | "unavailable";
    private: true;
    presentation_only: true;
  };
  progressionSummary: {
    status: "stats_available" | "empty" | "unavailable";
    source: "player_profiles" | "unavailable";
    gameplay_totals: {
      kills: number;
      deaths: number;
      suicides: number;
      longest_kill_distance: number;
    };
    featured_server: {
      linked_server_id: string;
      public_slug: string;
      server_name: string;
      server_type: string;
      platform: string | null;
      map_name: string | null;
      kills: number;
      deaths: number;
      longest_kill_distance: number;
      last_seen_at: string | null;
    } | null;
    tracks: Array<{
      key: "xp" | "challenges" | "calling_cards";
      label: string;
      status: "future_earned_runtime";
      description: string;
    }>;
    message: string;
    private: true;
    presentation_only: true;
  };
  profileEntries: Array<{
    key: string;
    label: string;
    href: string;
    status: string;
    description: string;
  }>;
};

const MAX_MATCHED_COMMUNITIES = 8;
const MAX_COMMUNITY_MATCH_CANDIDATES = 200;
const MAX_COMMUNITY_SERVER_PREVIEWS = 3;
const MAX_SUGGESTED_EVENTS = 5;
const MAX_SUGGESTED_EVENT_CANDIDATES = 24;
const MAX_SUGGESTED_EVENT_RELEVANCE_SERVER_IDS = 128;

const ownerSetupHref = "/pricing?intent=owner_setup&returnTo=%2Fsetup";
const communityMembershipRefreshHref = "/api/player/community-memberships/refresh";

const publicServerWhere = `
  lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  AND linked_servers.public_slug IS NOT NULL
  AND trim(linked_servers.public_slug) != ''
`;

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) {
    return json(
      { ok: false, error: "UNAUTHORIZED", message: "Log in with Discord to open your Player Hub." },
      { status: 401, headers: privateNoStoreHeaders() },
    );
  }

  const [savedServers, communities, profileProgression] = await Promise.all([
    readSafeSavedServers(env, user.id),
    readMatchedCommunities(env, user.id),
    readPlayerProfileProgression(env, user),
  ]);
  const communityServerIds = matchedCommunityServerIds(communities.communities);
  const events = await readSuggestedEvents(env, {
    savedServerIds: savedServers.savedServerIds,
    matchedCommunityServerIds: communityServerIds,
  });

  return json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      account: {
        display_name: user.username || "DZN Player",
        avatar: user.avatar,
        player_home_href: "/player",
        private_profile_href: "/player/profile",
      },
      saved_servers: savedServers.savedServers,
      saved_server_ids: savedServers.savedServerIds,
      matched_communities: communities.communities,
      discord_membership_status: {
        source: communities.source,
        last_checked_at: communities.lastCheckedAt,
        refresh_href: communityMembershipRefreshHref,
        refresh_method: "POST",
        requires_relogin: false,
        private: true,
        presentation_only: true,
        message: communityMembershipStatusMessage(communities.source, communities.lastCheckedAt),
      },
      suggested_events: events.events,
      profile_summary: profileProgression.profileSummary,
      progression_summary: profileProgression.progressionSummary,
      profile_entries: profileProgression.profileEntries,
      owner_setup: {
        href: ownerSetupHref,
        gated: true,
        requires_entitlement: true,
        label: "Owner pricing",
        description: "Server setup, Nitrado linking, and owner tools still start from pricing and the entitlement gate.",
      },
      sources: {
        saved_servers: savedServers.source,
        matched_communities: communities.source,
        suggested_events: events.source,
        profile_progression: profileProgression.profileSummary.source,
      },
      suggested_event_relevance: {
        private: true,
        presentation_only: true,
        uses_followed_servers: savedServers.savedServerIds.length > 0,
        uses_matched_communities: communityServerIds.length > 0,
        message: "Suggested events are privately ordered for this Player Hub only.",
      },
      fairness_boundary: [
        "Saved servers are private player preferences only.",
        "Matched communities are private player Discord membership context.",
        "Profile and progression summaries are private current-user read models only.",
        "Player Hub surfacing cannot alter billing, server ownership, rankings, discovery, reviews, events, scoring, awards, or competitive eligibility.",
      ],
    },
    { headers: privateNoStoreHeaders() },
  );
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

async function readSafeSavedServers(env: Env, userId: string) {
  try {
    return {
      ...(await readPlayerSavedServersForUser(env, userId)),
      source: "player_saved_servers" as const,
    };
  } catch {
    return {
      savedServerIds: [],
      savedServers: [],
      source: "unavailable" as const,
    };
  }
}

async function readPlayerProfileProgression(env: Env, user: SessionUser): Promise<PlayerHubProfileProgressionReadModel> {
  const displayName = user.username || "DZN Player";
  try {
    const db = requireDb(env);
    const [aggregateRows, featuredRows] = await Promise.all([
      db
        .prepare(
          `SELECT
            COUNT(player_profiles.id) AS linked_game_profiles,
            COUNT(DISTINCT player_profiles.linked_server_id) AS linked_public_servers,
            COALESCE(SUM(COALESCE(player_profiles.kills, 0)), 0) AS total_kills,
            COALESCE(SUM(COALESCE(player_profiles.deaths, 0)), 0) AS total_deaths,
            COALESCE(SUM(COALESCE(player_profiles.suicides, 0)), 0) AS total_suicides,
            COALESCE(MAX(COALESCE(player_profiles.longest_kill_distance, 0)), 0) AS longest_kill_distance,
            MAX(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) AS last_seen_at
           FROM player_profiles
           INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
           WHERE player_profiles.discord_id = ?
             AND ${publicServerWhere}`,
        )
        .bind(user.discord_id)
        .all<PlayerHubProfileAggregateRow>(),
      db
        .prepare(
          `SELECT
            player_profiles.linked_server_id,
            linked_servers.public_slug,
            COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
            COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
            linked_servers.platform,
            linked_servers.map_name,
            player_profiles.kills,
            player_profiles.deaths,
            player_profiles.longest_kill_distance,
            COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at) AS last_seen_at
           FROM player_profiles
           INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
           WHERE player_profiles.discord_id = ?
             AND ${publicServerWhere}
           ORDER BY COALESCE(player_profiles.kills, 0) DESC,
             COALESCE(player_profiles.longest_kill_distance, 0) DESC,
             datetime(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) DESC
           LIMIT 1`,
        )
        .bind(user.discord_id)
        .all<PlayerHubFeaturedProfileServerRow>(),
    ]);

    const aggregate = aggregateRows.results?.[0] ?? null;
    const linkedGameProfiles = normalizeNullableNumber(aggregate?.linked_game_profiles) ?? 0;

    return buildProfileProgressionReadModel({
      displayName,
      source: "player_profiles",
      status: linkedGameProfiles > 0 ? "stats_available" : "empty",
      aggregate,
      featuredServer: featuredRows.results?.[0] ?? null,
    });
  } catch {
    return buildProfileProgressionReadModel({
      displayName,
      source: "unavailable",
      status: "unavailable",
      aggregate: null,
      featuredServer: null,
    });
  }
}

function buildProfileProgressionReadModel(input: {
  displayName: string;
  source: "player_profiles" | "unavailable";
  status: PlayerHubProfileProgressionReadModel["progressionSummary"]["status"];
  aggregate: PlayerHubProfileAggregateRow | null;
  featuredServer: PlayerHubFeaturedProfileServerRow | null;
}): PlayerHubProfileProgressionReadModel {
  const linkedGameProfiles = normalizeNullableNumber(input.aggregate?.linked_game_profiles) ?? 0;
  const linkedPublicServers = normalizeNullableNumber(input.aggregate?.linked_public_servers) ?? 0;
  const kills = normalizeNullableNumber(input.aggregate?.total_kills) ?? 0;
  const deaths = normalizeNullableNumber(input.aggregate?.total_deaths) ?? 0;
  const suicides = normalizeNullableNumber(input.aggregate?.total_suicides) ?? 0;
  const longestKillDistance = normalizeNullableNumber(input.aggregate?.longest_kill_distance) ?? 0;
  const featured = input.featuredServer
    ? {
        linked_server_id: input.featuredServer.linked_server_id,
        public_slug: input.featuredServer.public_slug,
        server_name: input.featuredServer.server_name || "DZN Server",
        server_type: input.featuredServer.server_type || "DayZ",
        platform: input.featuredServer.platform,
        map_name: input.featuredServer.map_name,
        kills: normalizeNullableNumber(input.featuredServer.kills) ?? 0,
        deaths: normalizeNullableNumber(input.featuredServer.deaths) ?? 0,
        longest_kill_distance: normalizeNullableNumber(input.featuredServer.longest_kill_distance) ?? 0,
        last_seen_at: input.featuredServer.last_seen_at,
      }
    : null;

  return {
    profileSummary: {
      display_name: input.displayName,
      private_profile_href: "/player/profile",
      public_profile_href: null,
      public_profile_status: "not_configured",
      public_profile_message: "Public profile publishing and visibility controls stay in the dedicated profile privacy slices.",
      linked_game_profiles: linkedGameProfiles,
      linked_public_servers: linkedPublicServers,
      last_seen_at: input.aggregate?.last_seen_at ?? null,
      source: input.source,
      private: true,
      presentation_only: true,
    },
    progressionSummary: {
      status: input.status,
      source: input.source,
      gameplay_totals: {
        kills,
        deaths,
        suicides,
        longest_kill_distance: longestKillDistance,
      },
      featured_server: featured,
      tracks: [
        {
          key: "xp",
          label: "XP",
          status: "future_earned_runtime",
          description: "XP stays blocked until trusted server-side award sources are connected.",
        },
        {
          key: "challenges",
          label: "Challenges",
          status: "future_earned_runtime",
          description: "Challenge progress will be earned player-side and cannot be paid into.",
        },
        {
          key: "calling_cards",
          label: "Calling cards",
          status: "future_earned_runtime",
          description: "Calling-card awards remain account-bound earned cosmetics when that runtime lands.",
        },
      ],
      message: profileProgressionMessage(input.status),
      private: true,
      presentation_only: true,
    },
    profileEntries: [
      {
        key: "private_profile",
        label: "Personal profile",
        href: "/player/profile",
        status: "available",
        description: "Open the private player profile entry point for account-specific profile tools.",
      },
      {
        key: "public_profile",
        label: "Public profile controls",
        href: "/player/profile",
        status: "not_configured",
        description: "Public profile publishing still requires saved privacy preferences and never bypasses opt-in controls.",
      },
      {
        key: "progression",
        label: "Progression summary",
        href: "/player/profile",
        status: input.status === "stats_available" ? "stats_ready" : input.status,
        description: "Current-player gameplay summaries are read-only; XP and calling cards remain earned-only future runtimes.",
      },
    ],
  };
}

function profileProgressionMessage(status: PlayerHubProfileProgressionReadModel["progressionSummary"]["status"]) {
  if (status === "unavailable") {
    return "Profile/progression summary storage is unavailable in this environment, so DZN shows safe private fallback copy only.";
  }
  if (status === "empty") {
    return "No Discord-linked public gameplay profile rows were found for this account yet.";
  }
  return "This private summary is read from Discord-linked gameplay profile rows and is presentation-only.";
}

async function readMatchedCommunities(env: Env, userId: string): Promise<PlayerHubCommunitiesReadModel> {
  try {
    const db = requireDb(env);
    const membershipRows = await readPlayerCommunityMembershipRows(db, userId).catch(() => null);
    const managedGuildRows = await readManagedDiscordGuildRows(db, userId);
    const guilds = mergeCommunityMatches(membershipRows ?? [], managedGuildRows);
    const source: PlayerHubCommunitySource = membershipRows?.length
      ? "player_discord_community_memberships"
      : managedGuildRows.length
        ? "cached_discord_manageable_guilds"
        : membershipRows
          ? "player_discord_community_memberships"
          : "cached_discord_manageable_guilds";

    if (!guilds.length) {
      return { communities: [], source, lastCheckedAt: latestCommunityMembershipSeenAt(guilds) };
    }

    const discordGuildIds = [...new Set(guilds.map((guild) => guild.guild_id).filter(Boolean))];
    const internalGuildIds = [...new Set(guilds.flatMap((guild) => guild.match_keys).filter((key) => !discordGuildIds.includes(key)))];
    const matchClauses: string[] = [];
    const bindings: unknown[] = [];
    if (discordGuildIds.length) {
      matchClauses.push(`linked_servers.guild_id IN (${discordGuildIds.map(() => "?").join(", ")})`);
      bindings.push(...discordGuildIds);
    }
    if (internalGuildIds.length) {
      matchClauses.push(`linked_servers.discord_guild_id IN (${internalGuildIds.map(() => "?").join(", ")})`);
      bindings.push(...internalGuildIds);
    }

    const serverRows = matchClauses.length
      ? await db
          .prepare(
            `SELECT
              linked_servers.id AS linked_server_id,
              linked_servers.discord_guild_id,
              linked_servers.guild_id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
              COALESCE(NULLIF(linked_servers.server_category, ''), NULLIF(linked_servers.server_mode, ''), linked_servers.server_type) AS server_type,
              linked_servers.platform,
              linked_servers.map_name,
              linked_servers.current_players,
              linked_servers.max_players
             FROM linked_servers
             WHERE (${matchClauses.join(" OR ")})
               AND ${publicServerWhere}
             ORDER BY linked_servers.updated_at DESC, linked_servers.created_at DESC
             LIMIT ?`,
          )
          .bind(...bindings, MAX_MATCHED_COMMUNITIES * MAX_COMMUNITY_SERVER_PREVIEWS)
          .all<PlayerHubCommunityServerRow>()
      : { results: [] as PlayerHubCommunityServerRow[] };

    const serverRowsByCommunity = groupCommunityServerRows(serverRows.results ?? []);
    const communities = guilds
      .map((guild) => {
        const matchedServers = uniqueCommunityServers(guild.match_keys.flatMap((key) => serverRowsByCommunity.get(key) ?? []))
          .slice(0, MAX_COMMUNITY_SERVER_PREVIEWS);
        return {
          guild_id: guild.guild_id,
          name: guild.name || "Discord Community",
          icon_url: guild.icon_url,
          relationship: guild.relationship,
          relationship_label: guild.relationship_label,
          public_server_count: matchedServers.length,
          matched_servers: matchedServers,
        };
      })
      .filter((community) => community.public_server_count > 0)
      .slice(0, MAX_MATCHED_COMMUNITIES);

    return { communities, source, lastCheckedAt: latestCommunityMembershipSeenAt(guilds) };
  } catch {
    return { communities: [], source: "unavailable" as const, lastCheckedAt: null };
  }
}

async function readPlayerCommunityMembershipRows(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `SELECT
        guild_id,
        guild_name AS name,
        guild_icon_url AS icon_url,
        relationship,
        last_seen_at
       FROM player_discord_community_memberships
       WHERE user_id = ?
         AND revoked_at IS NULL
       ORDER BY CASE relationship
         WHEN 'owner' THEN 0
         WHEN 'administrator' THEN 1
         WHEN 'member' THEN 2
         ELSE 3
       END, lower(guild_name) ASC
       LIMIT ?`,
    )
    .bind(userId, MAX_COMMUNITY_MATCH_CANDIDATES)
    .all<PlayerHubCommunityMembershipRow>();

  return (result.results ?? []).filter((row) => Boolean(row.guild_id && row.name));
}

async function readManagedDiscordGuildRows(db: D1Database, userId: string) {
  const guildRows = await db
    .prepare(
      `SELECT id, guild_id, name, icon_url, permissions, is_owner
       FROM discord_guilds
       WHERE owner_user_id = ?
       ORDER BY name ASC
       LIMIT ?`,
    )
    .bind(userId, MAX_COMMUNITY_MATCH_CANDIDATES)
    .all<PlayerHubCommunityRow>();

  return (guildRows.results ?? []).filter((guild) => Boolean(guild.id && guild.guild_id));
}

function mergeCommunityMatches(memberships: PlayerHubCommunityMembershipRow[], managedGuilds: PlayerHubCommunityRow[]) {
  const matches = new Map<string, PlayerHubCommunityMatch>();

  for (const membership of memberships) {
    const relationship = normalizeCommunityRelationship(membership.relationship);
    matches.set(membership.guild_id, {
      guild_id: membership.guild_id,
      name: membership.name || "Discord Community",
      icon_url: membership.icon_url,
      relationship,
      relationship_label: communityRelationshipLabel(relationship),
      match_keys: [membership.guild_id],
      last_seen_at: membership.last_seen_at,
    });
  }

  for (const guild of managedGuilds) {
    const owner = Number(guild.is_owner ?? 0) === 1;
    const relationship = owner
      ? "owner"
      : canManageDiscordGuild({ owner, permissions: guild.permissions ?? "0" })
        ? "administrator"
        : "matched";
    const existing = matches.get(guild.guild_id);
    if (existing) {
      existing.match_keys = [...new Set([...existing.match_keys, guild.guild_id, guild.id].filter(Boolean))];
      if (relationshipPriority(relationship) < relationshipPriority(existing.relationship)) {
        existing.relationship = relationship;
        existing.relationship_label = communityRelationshipLabel(relationship);
      }
      if (!existing.icon_url && guild.icon_url) existing.icon_url = guild.icon_url;
      continue;
    }

    matches.set(guild.guild_id, {
      guild_id: guild.guild_id,
      name: guild.name || "Discord Community",
      icon_url: guild.icon_url,
      relationship,
      relationship_label: communityRelationshipLabel(relationship),
      match_keys: [...new Set([guild.guild_id, guild.id].filter(Boolean))],
      last_seen_at: null,
    });
  }

  return [...matches.values()];
}

function latestCommunityMembershipSeenAt(guilds: PlayerHubCommunityMatch[]) {
  let latest: { value: string; time: number } | null = null;
  for (const guild of guilds) {
    if (!guild.last_seen_at) continue;
    const parsed = Date.parse(guild.last_seen_at);
    const time = Number.isFinite(parsed) ? parsed : 0;
    if (!latest || time > latest.time || (time === latest.time && guild.last_seen_at > latest.value)) {
      latest = { value: guild.last_seen_at, time };
    }
  }
  return latest?.value ?? null;
}

function communityMembershipStatusMessage(source: PlayerHubCommunitySource, lastCheckedAt: string | null) {
  if (source === "unavailable") {
    return "Discord community matching is private but unavailable in this environment.";
  }
  if (source === "cached_discord_manageable_guilds") {
    return "DZN is showing older setup-era guild matches. Refresh Discord matches to check ordinary player memberships.";
  }
  if (!lastCheckedAt) {
    return "Discord community matching is private to your Player Hub. Refresh to check current memberships.";
  }
  return "Discord community matching is private to your Player Hub and can be refreshed from this account.";
}

function normalizeCommunityRelationship(value: PlayerHubCommunityMembershipRow["relationship"]) {
  return value === "owner" || value === "administrator" || value === "member" ? value : "member";
}

function communityRelationshipLabel(value: PlayerHubCommunityMatch["relationship"]) {
  if (value === "owner") return "Owner";
  if (value === "administrator") return "Admin";
  if (value === "member") return "Member";
  return "Matched";
}

function relationshipPriority(value: PlayerHubCommunityMatch["relationship"]) {
  if (value === "owner") return 0;
  if (value === "administrator") return 1;
  if (value === "member") return 2;
  return 3;
}

function groupCommunityServerRows(rows: PlayerHubCommunityServerRow[]) {
  const groups = new Map<string, PlayerHubCommunityServerRow[]>();
  for (const row of rows) {
    for (const key of [row.discord_guild_id, row.guild_id]) {
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  }
  return groups;
}

function uniqueCommunityServers(rows: PlayerHubCommunityServerRow[]) {
  const seen = new Set<string>();
  const unique = [];
  for (const row of rows) {
    if (!row.linked_server_id || seen.has(row.linked_server_id)) continue;
    seen.add(row.linked_server_id);
    unique.push({
      linked_server_id: row.linked_server_id,
      public_slug: row.public_slug,
      server_name: row.server_name || "DZN Server",
      server_type: row.server_type || "DayZ",
      platform: row.platform,
      map_name: row.map_name,
      current_players: normalizeNullableNumber(row.current_players),
      max_players: normalizeNullableNumber(row.max_players),
    });
  }
  return unique;
}

function matchedCommunityServerIds(communities: PlayerHubCommunitiesReadModel["communities"]) {
  return [...new Set(
    communities.flatMap((community) => community.matched_servers.map((server) => server.linked_server_id).filter(Boolean)),
  )];
}

async function readSuggestedEvents(env: Env, context: PlayerHubSuggestedEventContext) {
  try {
    const db = requireDb(env);
    const events = await db
      .prepare(
        `SELECT
          competitive_events.id,
          competitive_events.name,
          competitive_events.slug,
          competitive_events.description,
          competitive_events.category,
          competitive_events.event_type,
          competitive_events.status,
          competitive_events.starts_at,
          competitive_events.ends_at,
          competitive_events.server_limit,
          competitive_events.team_limit,
          competitive_events.created_at,
          (SELECT COUNT(*) FROM competitive_event_servers WHERE competitive_event_servers.event_id = competitive_events.id) AS registered_servers
         FROM competitive_events
         WHERE lower(COALESCE(competitive_events.visibility, 'public')) != 'private'
           AND lower(COALESCE(competitive_events.status, 'draft')) IN ('live', 'registration_open', 'upcoming', 'standby', 'full')
         ORDER BY CASE lower(COALESCE(competitive_events.status, 'upcoming'))
           WHEN 'live' THEN 0
           WHEN 'registration_open' THEN 1
           WHEN 'upcoming' THEN 2
           WHEN 'standby' THEN 3
           WHEN 'full' THEN 4
           ELSE 5
         END, datetime(COALESCE(competitive_events.starts_at, competitive_events.created_at)) ASC
         LIMIT ?`,
      )
      .bind(MAX_SUGGESTED_EVENT_CANDIDATES)
      .all<PlayerHubEventRow>();

    const eventRows = events.results ?? [];
    const eventServerRows = await readSuggestedEventServerRows(
      db,
      eventRows.map((event) => event.id),
      suggestedEventRelevantServerIds(context),
    ).catch(() => []);
    const serverRowsByEvent = groupSuggestedEventServerRows(eventServerRows);
    const suggestedEvents = orderSuggestedEventsByPrivateRelevance(eventRows, serverRowsByEvent, context)
      .slice(0, MAX_SUGGESTED_EVENTS);

    return {
      events: suggestedEvents.map(({ event, relevance }) => ({
        id: event.id,
        name: event.name,
        slug: event.slug,
        href: `/events/${event.slug}`,
        description: event.description ?? "",
        category: event.category ?? "community",
        category_label: labelFromToken(event.category ?? "community"),
        event_type: event.event_type ?? "community_event",
        event_type_label: labelFromToken(event.event_type ?? "community_event"),
        status: event.status ?? "upcoming",
        status_label: labelFromToken(event.status ?? "upcoming"),
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        registered_servers: normalizeNullableNumber(event.registered_servers) ?? 0,
        server_limit: normalizeNullableNumber(event.server_limit ?? event.team_limit),
        relevance,
      })),
      source: "public_competitive_events" as const,
    };
  } catch {
    return { events: [], source: "unavailable" as const };
  }
}

function suggestedEventRelevantServerIds(context: PlayerHubSuggestedEventContext) {
  return [...new Set([
    ...context.savedServerIds,
    ...context.matchedCommunityServerIds,
  ].filter(Boolean))].slice(0, MAX_SUGGESTED_EVENT_RELEVANCE_SERVER_IDS);
}

async function readSuggestedEventServerRows(db: D1Database, eventIds: string[], relevantServerIds: string[]) {
  const ids = [...new Set(eventIds.filter(Boolean))].slice(0, MAX_SUGGESTED_EVENT_CANDIDATES);
  const serverIds = [...new Set(relevantServerIds.filter(Boolean))].slice(0, MAX_SUGGESTED_EVENT_RELEVANCE_SERVER_IDS);
  if (!ids.length || !serverIds.length) return [];

  const result = await db
    .prepare(
      `SELECT DISTINCT event_id, server_id
       FROM competitive_event_servers
       WHERE event_id IN (${ids.map(() => "?").join(", ")})
         AND server_id IN (${serverIds.map(() => "?").join(", ")})
       ORDER BY event_id ASC, server_id ASC`,
    )
    .bind(...ids, ...serverIds)
    .all<PlayerHubEventServerRow>();

  return result.results ?? [];
}

function groupSuggestedEventServerRows(rows: PlayerHubEventServerRow[]) {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.event_id || !row.server_id) continue;
    const group = groups.get(row.event_id) ?? [];
    group.push(row.server_id);
    groups.set(row.event_id, group);
  }
  return groups;
}

function orderSuggestedEventsByPrivateRelevance(
  events: PlayerHubEventRow[],
  serverRowsByEvent: Map<string, string[]>,
  context: PlayerHubSuggestedEventContext,
) {
  const savedServerIds = new Set(context.savedServerIds.filter(Boolean));
  const communityServerIds = new Set(context.matchedCommunityServerIds.filter(Boolean));

  return events
    .map((event, baseOrder) => {
      const eventServerIds = serverRowsByEvent.get(event.id) ?? [];
      const hasFollowedServer = eventServerIds.some((serverId) => savedServerIds.has(serverId));
      const hasMatchedCommunity = eventServerIds.some((serverId) => communityServerIds.has(serverId));
      const relevance = suggestedEventRelevance(hasFollowedServer, hasMatchedCommunity);
      return { event, baseOrder, relevance };
    })
    .sort((left, right) => {
      const relevanceDifference = suggestedEventRelevancePriority(left.relevance.level) - suggestedEventRelevancePriority(right.relevance.level);
      return relevanceDifference || left.baseOrder - right.baseOrder;
    });
}

function suggestedEventRelevance(hasFollowedServer: boolean, hasMatchedCommunity: boolean): PlayerHubSuggestedEventRelevance {
  const reasons: string[] = [];
  if (hasFollowedServer) reasons.push("A server you follow is entered.");
  if (hasMatchedCommunity) reasons.push("A public server from one of your private Discord matches is entered.");
  if (!reasons.length) reasons.push("General public DZN event suggestion.");

  if (hasFollowedServer) {
    return { level: "followed_server", label: "Followed server", reasons, presentation_only: true };
  }
  if (hasMatchedCommunity) {
    return { level: "matched_community", label: "Matched community", reasons, presentation_only: true };
  }
  return { level: "public_network", label: "Public network", reasons, presentation_only: true };
}

function suggestedEventRelevancePriority(value: PlayerHubSuggestedEventRelevanceLevel) {
  if (value === "followed_server") return 0;
  if (value === "matched_community") return 1;
  return 2;
}

function normalizeNullableNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function labelFromToken(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
