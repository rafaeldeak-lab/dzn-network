import {
  ensureMockUser,
  getDiscordOAuthToken,
  getSessionUser,
  requireDb,
  storeDiscordOAuthToken,
  storeGuilds,
} from "../../_lib/db";
import {
  canManageDiscordGuild,
  fetchDiscordGuilds,
  guildIconUrl,
  refreshDiscordAccessToken,
} from "../../_lib/discord";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, mockGuilds } from "../../_lib/mock";
import type { DiscordGuild, Env, PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  let user = await getSessionUser(env, request);
  if (!user && isMockAuth(env.MOCK_AUTH)) {
    const mock = await ensureMockUser(env);
    user = {
      id: mock.userId,
      discord_id: mock.user.id,
      username: mock.user.username,
      avatar: mock.user.avatar,
    };
  }

  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  if (isMockAuth(env.MOCK_AUTH)) {
    return json({
      guilds: mockGuilds.map(toSafeGuild),
      fetched_at: new Date().toISOString(),
      fresh,
    });
  }

  if (fresh) {
    const token = await getUsableDiscordAccessToken(env, user.id);
    if (!token) {
      return json(
        {
          error: "Discord guild permissions need refreshing. Log out and back in, then try Refresh Discord Servers again.",
          guilds: await getCachedGuilds(env, user.id),
          fetched_at: new Date().toISOString(),
          fresh: false,
        },
        { status: 401 },
      );
    }

    try {
      const guilds = (await fetchDiscordGuilds(token)).filter(canManageDiscordGuild);
      await storeGuilds(env, user.id, guilds);
      return json({
        guilds: guilds.map(toSafeGuild),
        fetched_at: new Date().toISOString(),
        fresh: true,
      });
    } catch {
      return json(
        {
          error: "Discord rejected the saved guild permission token. Log out and back in to refresh Discord permissions.",
          guilds: await getCachedGuilds(env, user.id),
          fetched_at: new Date().toISOString(),
          fresh: false,
        },
        { status: 401 },
      );
    }
  }

  return json({
    guilds: await getCachedGuilds(env, user.id),
    fetched_at: new Date().toISOString(),
    fresh: false,
  });
};

async function getCachedGuilds(env: Env, userId: string) {
  const db = requireDb(env);
  const result = await db
    .prepare(
      `SELECT guild_id, name, icon, icon_url, permissions, is_owner
       FROM discord_guilds
       WHERE owner_user_id = ?
       ORDER BY name ASC`,
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  return (result.results ?? []).map((guild) => {
    const owner = Boolean(guild.is_owner);
    const permissions = typeof guild.permissions === "string" ? guild.permissions : String(guild.permissions ?? "0");
    const administrator = owner || canManageDiscordGuild({ owner, permissions });
    return {
      id: String(guild.guild_id ?? ""),
      guild_id: String(guild.guild_id ?? ""),
      name: String(guild.name ?? "Discord Server"),
      icon: typeof guild.icon === "string" ? guild.icon : null,
      icon_url: typeof guild.icon_url === "string" ? guild.icon_url : null,
      owner,
      administrator,
      manageable: administrator,
      permissions,
      bot_present: false,
    };
  });
}

async function getUsableDiscordAccessToken(env: Env, userId: string) {
  const token = await getDiscordOAuthToken(env, userId);
  if (!token?.access_token) return null;

  const expiresAt = token.expires_at ? Date.parse(token.expires_at) : Number.NaN;
  const isExpired = Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000;
  if (!isExpired) return token.access_token;
  if (!token.refresh_token) return null;

  const refreshed = await refreshDiscordAccessToken(env, token.refresh_token).catch(() => null);
  if (!refreshed?.access_token) return null;
  await storeDiscordOAuthToken(env, userId, refreshed);
  return refreshed.access_token;
}

function toSafeGuild(guild: DiscordGuild) {
  const owner = Boolean(guild.owner);
  const administrator = owner || canManageDiscordGuild(guild);
  return {
    id: guild.id,
    guild_id: guild.id,
    name: guild.name,
    icon: guild.icon,
    icon_url: guildIconUrl(guild),
    owner,
    administrator,
    manageable: administrator,
    permissions: guild.permissions,
    bot_present: false,
  };
}
