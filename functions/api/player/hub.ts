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
};

const MAX_MATCHED_COMMUNITIES = 8;
const MAX_COMMUNITY_SERVER_PREVIEWS = 3;
const MAX_SUGGESTED_EVENTS = 5;

const ownerSetupHref = "/pricing?intent=owner_setup&returnTo=%2Fsetup";

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

  const [savedServers, communities, events] = await Promise.all([
    readSafeSavedServers(env, user.id),
    readMatchedCommunities(env, user.id),
    readSuggestedEvents(env),
  ]);

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
      suggested_events: events.events,
      profile_entries: [
        {
          key: "private_profile",
          label: "Personal profile",
          href: "/player/profile",
          status: "available",
          description: "Manage private player profile entry points and future display controls.",
        },
        {
          key: "public_profile",
          label: "Public profile preview",
          href: "/player/profile",
          status: "profile_controls_required",
          description: "Public profile publishing stays controlled by saved player privacy preferences.",
        },
        {
          key: "progression",
          label: "Progression showcase",
          href: "/player/profile",
          status: "foundation_ready",
          description: "XP, challenge progress, and calling-card display remain earned player-side systems.",
        },
      ],
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
      },
      fairness_boundary: [
        "Saved servers are private player preferences only.",
        "Matched communities are read-only cached Discord context.",
        "Player Hub surfacing cannot alter billing, server ownership, rankings, discovery, reviews, events, scoring, progression, or competitive eligibility.",
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

async function readMatchedCommunities(env: Env, userId: string) {
  try {
    const db = requireDb(env);
    const guildRows = await db
      .prepare(
        `SELECT id, guild_id, name, icon_url, permissions, is_owner
         FROM discord_guilds
         WHERE owner_user_id = ?
         ORDER BY name ASC
         LIMIT ?`,
      )
      .bind(userId, MAX_MATCHED_COMMUNITIES)
      .all<PlayerHubCommunityRow>();

    const guilds = (guildRows.results ?? []).filter((guild) => Boolean(guild.id && guild.guild_id));
    if (!guilds.length) {
      return { communities: [], source: "cached_discord_manageable_guilds" as const };
    }

    const dbGuildIds = [...new Set(guilds.map((guild) => guild.id).filter(Boolean))];
    const discordGuildIds = [...new Set(guilds.map((guild) => guild.guild_id).filter(Boolean))];
    const matchClauses: string[] = [];
    const bindings: unknown[] = [];
    if (dbGuildIds.length) {
      matchClauses.push(`linked_servers.discord_guild_id IN (${dbGuildIds.map(() => "?").join(", ")})`);
      bindings.push(...dbGuildIds);
    }
    if (discordGuildIds.length) {
      matchClauses.push(`linked_servers.guild_id IN (${discordGuildIds.map(() => "?").join(", ")})`);
      bindings.push(...discordGuildIds);
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
    const communities = guilds.map((guild) => {
      const matchedServers = uniqueCommunityServers([
        ...(serverRowsByCommunity.get(guild.id) ?? []),
        ...(serverRowsByCommunity.get(guild.guild_id) ?? []),
      ]).slice(0, MAX_COMMUNITY_SERVER_PREVIEWS);
      const owner = Number(guild.is_owner ?? 0) === 1;
      const administrator = canManageDiscordGuild({ owner, permissions: guild.permissions ?? "0" });
      return {
        guild_id: guild.guild_id,
        name: guild.name || "Discord Community",
        icon_url: guild.icon_url,
        relationship: owner ? "owner" : administrator ? "administrator" : "matched",
        relationship_label: owner ? "Owner" : administrator ? "Admin" : "Matched",
        public_server_count: matchedServers.length,
        matched_servers: matchedServers,
      };
    });

    return { communities, source: "cached_discord_manageable_guilds" as const };
  } catch {
    return { communities: [], source: "unavailable" as const };
  }
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

async function readSuggestedEvents(env: Env) {
  try {
    const events = await requireDb(env)
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
      .bind(MAX_SUGGESTED_EVENTS)
      .all<PlayerHubEventRow>();

    return {
      events: (events.results ?? []).map((event) => ({
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
      })),
      source: "public_competitive_events" as const,
    };
  } catch {
    return { events: [], source: "unavailable" as const };
  }
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
