import { fetchDiscordGuilds, guildIconUrl } from "../../_lib/discord";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, mockGuilds } from "../../_lib/mock";
import { getRequestSessionUser } from "../../_lib/owner-access";
import type { DiscordGuild, Env, PagesFunction } from "../../_lib/types";

type MatchedCommunityRow = {
  linked_server_id: string;
  public_slug: string | null;
  server_name: string | null;
  server_type: string | null;
  server_category: string | null;
  platform: string | null;
  map_name: string | null;
  current_players: number | null;
  max_players: number | null;
  public_short_description: string | null;
  public_discord_invite: string | null;
  status: string | null;
  listing_visibility: string | null;
  linked_server_guild_id: string | null;
  stored_discord_guild_id: string | null;
  guild_name: string | null;
  guild_icon_url: string | null;
};

type StoredDiscordToken = {
  access_token: string | null;
  expires_at: string | null;
};

export type SafeMatchedServer = ReturnType<typeof toSafeMatchedServer>;

export type PlayerCommunitySummary = {
  guild_id: string;
  guild_name: string;
  guild_icon_url: string | null;
  matched_servers: SafeMatchedServer[];
};

export type PlayerCommunitiesPayload = {
  ok: true;
  communities: PlayerCommunitySummary[];
  needs_discord_refresh: boolean;
  matched_guild_count: number;
  matched_server_count: number;
  fetched_at: string;
  error?: string;
};

export type PlayerCommunitiesResult = {
  status: 200 | 401;
  payload: PlayerCommunitiesPayload;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getRequestSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const result = await getPlayerCommunitiesPayload(env, user);
  return json(result.payload, { status: result.status });
};

export async function getPlayerCommunitiesPayload(env: Env, user: { id: string }): Promise<PlayerCommunitiesResult> {
  if (isMockAuth(env.MOCK_AUTH)) {
    const communities = mockGuilds.map((guild) => ({
      guild_id: guild.id,
      guild_name: guild.name,
      guild_icon_url: guildIconUrl(guild),
      matched_servers: [],
    }));
    return {
      status: 200,
      payload: {
        ok: true,
        communities,
        needs_discord_refresh: false,
        matched_guild_count: mockGuilds.length,
        matched_server_count: 0,
        fetched_at: new Date().toISOString(),
      },
    };
  }

  const token = await readSavedAccessToken(env, user.id);
  if (!token) {
    return {
      status: 200,
      payload: emptyCommunitiesPayload(true),
    };
  }

  let guilds: DiscordGuild[] = [];
  try {
    guilds = await fetchDiscordGuilds(token);
  } catch {
    return {
      status: 401,
      payload: {
        ...emptyCommunitiesPayload(true),
        error: "Discord guild permissions need refreshing. Log out and back in, then open your player communities again.",
      },
    };
  }

  const guildIds = uniqueGuildIds(guilds);
  const matchedRows = guildIds.length > 0 ? await findMatchedCommunities(env, guildIds) : [];
  const communities = groupCommunities(guilds, matchedRows);

  return {
    status: 200,
    payload: {
      ok: true,
      communities,
      needs_discord_refresh: false,
      matched_guild_count: communities.length,
      matched_server_count: matchedRows.length,
      fetched_at: new Date().toISOString(),
    },
  };
}

function emptyCommunitiesPayload(needsDiscordRefresh: boolean): PlayerCommunitiesPayload {
  return {
    ok: true,
    communities: [],
    needs_discord_refresh: needsDiscordRefresh,
    matched_guild_count: 0,
    matched_server_count: 0,
    fetched_at: new Date().toISOString(),
  };
}

async function readSavedAccessToken(env: Env, userId: string) {
  if (!env.DB) return null;
  try {
    const token = await env.DB
      .prepare(
        `SELECT access_token, expires_at
         FROM discord_oauth_tokens
         WHERE user_id = ?
         LIMIT 1`,
      )
      .bind(userId)
      .first<StoredDiscordToken>();
    if (!token?.access_token) return null;

    const expiresAt = token.expires_at ? Date.parse(token.expires_at) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000) return null;
    return token.access_token;
  } catch {
    return null;
  }
}

async function findMatchedCommunities(env: Env, guildIds: string[]) {
  if (!env.DB || guildIds.length === 0) return [];
  const boundedGuildIds = guildIds.slice(0, 100);
  const placeholders = boundedGuildIds.map(() => "?").join(", ");

  const result = await env.DB
    .prepare(
      `SELECT
         linked_servers.id AS linked_server_id,
         linked_servers.public_slug,
         COALESCE(
           linked_servers.display_name,
           linked_servers.hostname,
           linked_servers.server_name,
           linked_servers.nitrado_service_name,
           'DZN Server'
         ) AS server_name,
         linked_servers.server_type,
         linked_servers.server_category,
         linked_servers.platform,
         linked_servers.map_name,
         linked_servers.current_players,
         linked_servers.max_players,
         linked_servers.public_short_description,
         linked_servers.public_discord_invite,
         linked_servers.status,
         linked_servers.listing_visibility,
         linked_servers.guild_id AS linked_server_guild_id,
         discord_guilds.guild_id AS stored_discord_guild_id,
         discord_guilds.name AS guild_name,
         discord_guilds.icon_url AS guild_icon_url
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE (
           linked_servers.guild_id IN (${placeholders})
           OR discord_guilds.guild_id IN (${placeholders})
         )
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'deleted'
         AND lower(COALESCE(linked_servers.status, 'pending')) != 'merged'
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
       ORDER BY
         CASE WHEN lower(COALESCE(linked_servers.status, 'pending')) = 'live' THEN 0 ELSE 1 END,
         linked_servers.updated_at DESC,
         linked_servers.created_at DESC
       LIMIT 25`,
    )
    .bind(...boundedGuildIds, ...boundedGuildIds)
    .all<MatchedCommunityRow>();

  return result.results ?? [];
}

function uniqueGuildIds(guilds: DiscordGuild[]) {
  const ids = new Set<string>();
  for (const guild of guilds) {
    if (/^\d{12,24}$/.test(guild.id)) ids.add(guild.id);
  }
  return Array.from(ids);
}

function groupCommunities(guilds: DiscordGuild[], rows: MatchedCommunityRow[]) {
  const guildsById = new Map(guilds.map((guild) => [guild.id, guild]));
  const rowsByGuildId = new Map<string, MatchedCommunityRow[]>();

  for (const row of rows) {
    const guildId = row.linked_server_guild_id ?? row.stored_discord_guild_id;
    if (!guildId) continue;
    const list = rowsByGuildId.get(guildId) ?? [];
    list.push(row);
    rowsByGuildId.set(guildId, list);
  }

  return Array.from(rowsByGuildId.entries()).map(([guildId, matchedRows]) => {
    const guild = guildsById.get(guildId);
    const firstRow = matchedRows[0];
    return {
      guild_id: guildId,
      guild_name: firstRow.guild_name ?? guild?.name ?? "Discord Community",
      guild_icon_url: firstRow.guild_icon_url ?? (guild ? guildIconUrl(guild) : null),
      matched_servers: matchedRows.map(toSafeMatchedServer),
    };
  });
}

function toSafeMatchedServer(row: MatchedCommunityRow) {
  return {
    linked_server_id: row.linked_server_id,
    public_slug: row.public_slug,
    server_name: row.server_name ?? "DZN Server",
    server_type: row.server_type,
    server_category: row.server_category,
    platform: row.platform,
    map_name: row.map_name,
    current_players: row.current_players,
    max_players: row.max_players,
    public_short_description: row.public_short_description,
    public_discord_invite: row.public_discord_invite,
    status: row.status,
    listing_visibility: row.listing_visibility,
  };
}
