import { getSessionUser, requireDb } from "../../_lib/db";
import { canManageDiscordGuild } from "../../_lib/discord";
import { DiscordChannelFetchError, fetchDiscordPostingChannels } from "../../_lib/discord-posting";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockAuth, mockGuilds } from "../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../_lib/types";

type ManagedGuild = {
  guild_id: string;
  name: string | null;
  permissions: string | null;
  is_owner: number | boolean | null;
};

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized", error_code: "not_authorized" }, { status: 401 });

  const url = new URL(request.url);
  const guildId = normalizeDiscordId(url.searchParams.get("guild_id"));
  const checkedAt = new Date().toISOString();
  if (!guildId) {
    return json(botStatusResponse({
      guildId: null,
      guildName: null,
      botTokenConfigured: hasDiscordBotToken(env),
      botConnected: false,
      channelsFetchedCount: 0,
      postableChannelsCount: 0,
      errorCode: "missing_guild_id",
      errorMessage: "No Discord server is selected. Please choose a server first.",
      checkedAt,
      inviteUrl: null,
    }));
  }

  const guild = await requireManagedGuild(env, user.id, guildId);
  if (!guild) {
    return json(botStatusResponse({
      guildId,
      guildName: null,
      botTokenConfigured: hasDiscordBotToken(env),
      botConnected: false,
      channelsFetchedCount: 0,
      postableChannelsCount: 0,
      errorCode: "not_authorized",
      errorMessage: "You need Owner or Administrator access to connect this Discord server to DZN.",
      checkedAt,
      inviteUrl: buildBotInviteUrl(env, guildId),
    }), { status: 403 });
  }

  if (isMockAuth(env.MOCK_AUTH)) {
    return json(botStatusResponse({
      guildId,
      guildName: guild.name ?? "Mock Discord Server",
      botTokenConfigured: true,
      botConnected: true,
      channelsFetchedCount: 3,
      postableChannelsCount: 2,
      errorCode: null,
      errorMessage: null,
      checkedAt,
      inviteUrl: buildBotInviteUrl(env, guildId),
    }));
  }

  try {
    const channels = await fetchDiscordPostingChannels(env, guildId);
    return json(botStatusResponse({
      guildId,
      guildName: guild.name,
      botTokenConfigured: hasDiscordBotToken(env),
      botConnected: true,
      channelsFetchedCount: channels.length,
      postableChannelsCount: channels.filter((channel) => channel.can_post).length,
      errorCode: null,
      errorMessage: null,
      checkedAt,
      inviteUrl: buildBotInviteUrl(env, guildId),
    }));
  } catch (error) {
    const classified = classifyBotStatusError(error);
    return json(botStatusResponse({
      guildId,
      guildName: guild.name,
      botTokenConfigured: hasDiscordBotToken(env),
      botConnected: false,
      channelsFetchedCount: 0,
      postableChannelsCount: 0,
      errorCode: classified.code,
      errorMessage: classified.message,
      checkedAt,
      inviteUrl: buildBotInviteUrl(env, guildId),
    }));
  }
};

async function requireManagedGuild(env: Env, userId: string, guildId: string): Promise<ManagedGuild | null> {
  if (isMockAuth(env.MOCK_AUTH)) {
    const mock = mockGuilds.find((guild) => guild.id === guildId) ?? mockGuilds[0];
    return mock ? { guild_id: mock.id, name: mock.name, permissions: mock.permissions, is_owner: mock.owner ? 1 : 0 } : null;
  }
  const guild = await requireDb(env)
    .prepare(
      `SELECT guild_id, name, permissions, is_owner
       FROM discord_guilds
       WHERE owner_user_id = ? AND guild_id = ?
       LIMIT 1`,
    )
    .bind(userId, guildId)
    .first<ManagedGuild>();
  if (!guild) return null;
  const owner = Boolean(guild.is_owner);
  const permissions = typeof guild.permissions === "string" ? guild.permissions : String(guild.permissions ?? "0");
  return canManageDiscordGuild({ owner, permissions }) ? guild : null;
}

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;
  return {
    id: "mock-user",
    discord_id: "mock-discord-user",
    username: "RafaelDeak",
    avatar: null,
  };
}

function botStatusResponse(input: {
  guildId: string | null;
  guildName: string | null;
  botTokenConfigured: boolean;
  botConnected: boolean;
  channelsFetchedCount: number;
  postableChannelsCount: number;
  errorCode: "missing_bot_token" | "missing_guild_id" | "bot_not_in_guild" | "discord_api_403" | "discord_api_error" | "not_authorized" | null;
  errorMessage: string | null;
  checkedAt: string;
  inviteUrl: string | null;
}) {
  return {
    ok: input.botConnected && input.channelsFetchedCount > 0,
    guild_id: input.guildId,
    guild_name: input.guildName,
    bot_token_configured: input.botTokenConfigured,
    bot_connected: input.botConnected,
    channels_available: input.channelsFetchedCount > 0,
    channels_fetched_count: input.channelsFetchedCount,
    postable_channels_count: input.postableChannelsCount,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    invite_url: input.inviteUrl,
    checked_at: input.checkedAt,
  };
}

function classifyBotStatusError(error: unknown) {
  if (error instanceof DiscordChannelFetchError) {
    if (error.code === "missing_bot_token") {
      return {
        code: "missing_bot_token" as const,
        message: "DISCORD_BOT_TOKEN is missing from Cloudflare Pages production. Add/rotate it, redeploy Pages, then click Verify Bot Connection. If the bot is already installed, DZN cannot verify/control it until DISCORD_BOT_TOKEN is configured.",
      };
    }
    if (error.code === "bot_not_in_guild") {
      return {
        code: "bot_not_in_guild" as const,
        message: "DZN Bot is not installed in this Discord server yet. Add the bot to enable auto-posts, channel discovery, slash commands, and Discord automation.",
      };
    }
    if (error.code === "discord_api_403") {
      return {
        code: "discord_api_403" as const,
        message: "Discord returned 403 while DZN checked bot access. Reconnect the bot or check server permissions.",
      };
    }
    return {
      code: "discord_api_error" as const,
      message: error.message,
    };
  }
  return {
    code: "discord_api_error" as const,
    message: error instanceof Error ? error.message : "Discord bot verification failed.",
  };
}

function buildBotInviteUrl(env: Env, guildId: string | null) {
  const clientId = typeof env.DISCORD_CLIENT_ID === "string" ? env.DISCORD_CLIENT_ID.trim() : "";
  if (!clientId) return "https://discord.com/oauth2/authorize?permissions=8&scope=bot%20applications.commands";
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", "8");
  url.searchParams.set("scope", "bot applications.commands");
  if (guildId) {
    url.searchParams.set("guild_id", guildId);
    url.searchParams.set("disable_guild_select", "true");
  }
  return url.toString();
}

function normalizeDiscordId(value: unknown) {
  return typeof value === "string" && /^\d{12,24}$/.test(value.trim()) ? value.trim() : null;
}

function hasDiscordBotToken(env: Env) {
  return typeof env.DISCORD_BOT_TOKEN === "string" && env.DISCORD_BOT_TOKEN.trim().length > 0;
}
