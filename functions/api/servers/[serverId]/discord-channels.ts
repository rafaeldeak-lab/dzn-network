import { getSessionUser, requireDb } from "../../../_lib/db";
import {
  DiscordChannelFetchError,
  fetchDiscordPostingChannels,
  type DiscordPostingChannel,
} from "../../../_lib/discord-posting";
import { json, methodNotAllowed } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type ChannelFetchDiagnostics = {
  selected_server_id: string | null;
  selected_guild_id: string | null;
  guild_name: string | null;
  bot_token_configured: boolean;
  bot_connected: boolean | null;
  channels_fetched_count: number;
  postable_channels_count: number;
  last_fetch_error_code: string | null;
  last_fetch_error_message: string | null;
  last_fetch_status: number | null;
  last_fetch_attempt_at: string;
  last_fetch_success_at: string | null;
  using_cached_channel_state: boolean;
  last_fetch_time: string;
};

type LinkedServerAccess = {
  id: string;
  guild_id: string | null;
  discord_guild_id: string | null;
  server_name: string | null;
  display_name: string | null;
  guild_name: string | null;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ error: "Unauthorized", error_code: "not_authorized" }, { status: 401 });

  const url = new URL(request.url);
  const liveRefresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("live") === "1";
  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const server = await requireManageableServer(env, user.id, linkedServerId);
  if (!server) {
    return json({
      error: "Server not found or you do not have permission to manage it.",
      ...emptyResponse({
        selectedServerId: linkedServerId,
        selectedGuildId: null,
        guildName: null,
        botTokenConfigured: hasDiscordBotToken(env),
        botConnected: null,
        fetchedAt: new Date().toISOString(),
        errorCode: "not_authorized",
        errorMessage: "Logged-in user cannot manage this DZN server.",
        botInviteUrl: null,
      }),
    }, { status: 403 });
  }

  const fetchedAt = new Date().toISOString();
  const selectedGuildId = normalizeDiscordId(server.guild_id);
  const guildName = server.guild_name ?? server.display_name ?? server.server_name ?? null;
  const botTokenConfigured = hasDiscordBotToken(env);
  if (!selectedGuildId) {
    return json({
      error: "No Discord server is linked to this DZN server.",
      ...emptyResponse({
        selectedServerId: server.id,
        selectedGuildId: null,
        guildName,
        botTokenConfigured,
        botConnected: null,
        fetchedAt,
        errorCode: "missing_guild_id",
        errorMessage: "The selected dashboard server does not have a stored Discord guild ID.",
        botInviteUrl: null,
      }),
    });
  }

  if (isMockAuth(env.MOCK_AUTH)) {
    const channels = [
      mockChannel("123456789012345678", "auto-leaderboards", "Automation"),
      mockChannel("123456789012345679", "killfeed", "Feeds"),
      mockChannel("123456789012345680", "admin-alerts", "Admin", ["Embed Links"]),
    ];
    return json(channelResponse({
      ok: true,
      channels,
      selectedServerId: server.id,
      selectedGuildId,
      guildName: guildName ?? "Mock Discord Server",
      botTokenConfigured: true,
      botConnected: true,
      fetchedAt,
      manualFallback: false,
      warning: null,
      errorCode: null,
      errorMessage: null,
      errorStatus: null,
      retryable: false,
      botInviteUrl: buildBotInviteUrl(env, selectedGuildId),
      usingCachedChannelState: false,
      lastFetchSuccessAt: fetchedAt,
    }));
  }

  if (!liveRefresh) {
    const cachedChannels = await readCachedDiscordPostingChannels(env, selectedGuildId);
    return json(channelResponse({
      ok: true,
      channels: cachedChannels,
      selectedServerId: server.id,
      selectedGuildId,
      guildName,
      botTokenConfigured,
      botConnected: null,
      fetchedAt,
      manualFallback: true,
      warning: cachedChannels.length
        ? "Using saved Discord posting destinations. Open Discord Posts and refresh channels to verify live channel permissions."
        : null,
      errorCode: null,
      errorMessage: null,
      errorStatus: null,
      retryable: false,
      botInviteUrl: buildBotInviteUrl(env, selectedGuildId),
      usingCachedChannelState: true,
      lastFetchSuccessAt: null,
    }));
  }

  try {
    const channels = await fetchDiscordPostingChannels(env, selectedGuildId);
    return json(channelResponse({
      ok: true,
      channels,
      selectedServerId: server.id,
      selectedGuildId,
      guildName,
      botTokenConfigured,
      botConnected: true,
      fetchedAt,
      manualFallback: false,
      warning: null,
      errorCode: null,
      errorMessage: null,
      errorStatus: null,
      retryable: false,
      botInviteUrl: buildBotInviteUrl(env, selectedGuildId),
      usingCachedChannelState: false,
      lastFetchSuccessAt: fetchedAt,
    }));
  } catch (error) {
    const classified = classifyChannelFetchError(error);
    const cachedChannels = await readCachedDiscordPostingChannels(env, selectedGuildId).catch(() => []);
    return json({
      error: classified.message,
      ...channelResponse({
        ok: false,
        channels: cachedChannels,
        selectedServerId: server.id,
        selectedGuildId,
        guildName,
        botTokenConfigured,
        botConnected: classified.botConnected,
        fetchedAt,
        errorCode: classified.code,
        errorMessage: classified.message,
        errorStatus: classified.status,
        retryable: classified.retryable,
        botInviteUrl: classified.code === "bot_not_in_guild" ? buildBotInviteUrl(env, selectedGuildId) : null,
        manualFallback: true,
        warning: classified.message,
        usingCachedChannelState: true,
        lastFetchSuccessAt: null,
      }),
      warning: classified.message,
      bot_invite_url: classified.code === "bot_not_in_guild" ? buildBotInviteUrl(env, selectedGuildId) : null,
    });
  }
};

async function requireManageableServer(env: Env, userId: string, linkedServerId: string): Promise<LinkedServerAccess | null> {
  return requireDb(env)
    .prepare(
      `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.discord_guild_id,
              linked_servers.server_name, linked_servers.display_name,
              discord_guilds.name AS guild_name
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE linked_servers.id = ? AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId, userId)
    .first<LinkedServerAccess>();
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

function channelResponse(input: {
  ok: boolean;
  channels: DiscordPostingChannel[];
  selectedServerId: string;
  selectedGuildId: string | null;
  guildName: string | null;
  botTokenConfigured: boolean;
  botConnected: boolean | null;
  fetchedAt: string;
  manualFallback: boolean;
  warning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorStatus: number | null;
  retryable: boolean;
  botInviteUrl: string | null;
  usingCachedChannelState?: boolean;
  lastFetchSuccessAt?: string | null;
}) {
  return {
    ok: input.ok,
    channels: input.channels,
    manual_fallback: input.manualFallback,
    warning: input.warning ?? undefined,
    fetched_at: input.fetchedAt,
    selected_server_id: input.selectedServerId,
    selected_guild_id: input.selectedGuildId,
    guild_name: input.guildName,
    bot_token_configured: input.botTokenConfigured,
    bot_connected: input.botConnected,
    error_code: input.errorCode,
    errorCode: input.errorCode,
    status: input.errorStatus,
    message: input.warning ?? input.errorMessage ?? undefined,
    retryable: input.retryable,
    bot_invite_url: input.botInviteUrl,
    diagnostics: buildDiagnostics({
      selectedServerId: input.selectedServerId,
      selectedGuildId: input.selectedGuildId,
      guildName: input.guildName,
      botTokenConfigured: input.botTokenConfigured,
      botConnected: input.botConnected,
      fetchedAt: input.fetchedAt,
      channels: input.channels,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      errorStatus: input.errorStatus,
      lastFetchSuccessAt: input.lastFetchSuccessAt ?? (input.errorCode ? null : input.fetchedAt),
      usingCachedChannelState: Boolean(input.usingCachedChannelState),
    }),
  };
}

function emptyResponse(input: {
  selectedServerId: string | null;
  selectedGuildId: string | null;
  guildName: string | null;
  botTokenConfigured: boolean;
  botConnected: boolean | null;
  fetchedAt: string;
  errorCode: string;
  errorMessage: string;
  errorStatus?: number | null;
  retryable?: boolean;
  botInviteUrl: string | null;
}) {
  return {
    ok: false,
    channels: [] as DiscordPostingChannel[],
    manual_fallback: true,
    fetched_at: input.fetchedAt,
    selected_server_id: input.selectedServerId,
    selected_guild_id: input.selectedGuildId,
    guild_name: input.guildName,
    bot_token_configured: input.botTokenConfigured,
    bot_connected: input.botConnected,
    error_code: input.errorCode,
    errorCode: input.errorCode,
    status: input.errorStatus ?? null,
    message: input.errorMessage,
    retryable: Boolean(input.retryable),
    bot_invite_url: input.botInviteUrl,
    diagnostics: buildDiagnostics({
      selectedServerId: input.selectedServerId,
      selectedGuildId: input.selectedGuildId,
      guildName: input.guildName,
      botTokenConfigured: input.botTokenConfigured,
      botConnected: input.botConnected,
      fetchedAt: input.fetchedAt,
      channels: [],
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      errorStatus: input.errorStatus ?? null,
      lastFetchSuccessAt: null,
      usingCachedChannelState: false,
    }),
  };
}

function buildDiagnostics(input: {
  selectedServerId: string | null;
  selectedGuildId: string | null;
  guildName: string | null;
  botTokenConfigured: boolean;
  botConnected: boolean | null;
  fetchedAt: string;
  channels: DiscordPostingChannel[];
  errorCode: string | null;
  errorMessage: string | null;
  errorStatus: number | null;
  lastFetchSuccessAt: string | null;
  usingCachedChannelState: boolean;
}): ChannelFetchDiagnostics {
  return {
    selected_server_id: input.selectedServerId,
    selected_guild_id: input.selectedGuildId,
    guild_name: input.guildName,
    bot_token_configured: input.botTokenConfigured,
    bot_connected: input.botConnected,
    channels_fetched_count: input.channels.length,
    postable_channels_count: input.channels.filter((channel) => channel.can_post).length,
    last_fetch_error_code: input.errorCode,
    last_fetch_error_message: input.errorMessage,
    last_fetch_status: input.errorStatus,
    last_fetch_attempt_at: input.fetchedAt,
    last_fetch_success_at: input.lastFetchSuccessAt,
    using_cached_channel_state: input.usingCachedChannelState,
    last_fetch_time: input.fetchedAt,
  };
}

function classifyChannelFetchError(error: unknown) {
  if (error instanceof DiscordChannelFetchError) {
    if (error.code === "missing_bot_token") {
      return {
        code: "missing_bot_token",
        message: "DISCORD_BOT_TOKEN is missing in Cloudflare Pages, so DZN cannot fetch Discord channels automatically.",
        status: 424,
        retryable: false,
        botConnected: null,
      };
    }
    if (error.code === "bot_not_in_guild") {
      return {
        code: "bot_not_in_guild",
        message: "DZN bot is not connected to this Discord server yet. Invite the bot to enable auto posts.",
        status: 424,
        retryable: false,
        botConnected: false,
      };
    }
    if (error.code === "discord_api_403") {
      return {
        code: "discord_api_403",
        message: "Discord returned 403 while DZN tried to fetch this server's channels. Check bot permissions and guild access.",
        status: 424,
        retryable: false,
        botConnected: null,
      };
    }
    if ((error.status ?? 0) >= 500 || error.code === "discord_api_invalid_response") {
      return {
        code: "channel_fetch_unavailable",
        message: "Discord channel refresh is temporarily unavailable. Existing saved setups remain active.",
        status: 503,
        retryable: true,
        botConnected: null,
      };
    }
    return {
      code: error.code,
      message: error.message,
      status: 424,
      retryable: false,
      botConnected: null,
    };
  }
  return {
    code: "channel_fetch_unavailable",
    message: "Discord channel refresh is temporarily unavailable. Existing saved setups remain active.",
    status: 503,
    retryable: true,
    botConnected: null,
  };
}

function buildBotInviteUrl(env: Env, guildId: string | null) {
  const clientId = typeof env.DISCORD_CLIENT_ID === "string" ? env.DISCORD_CLIENT_ID.trim() : "";
  if (!clientId || !guildId) return null;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("permissions", "274878294016");
  url.searchParams.set("guild_id", guildId);
  url.searchParams.set("disable_guild_select", "true");
  return url.toString();
}

async function readCachedDiscordPostingChannels(env: Env, guildId: string): Promise<DiscordPostingChannel[]> {
  const rows = await requireDb(env)
    .prepare(
      `SELECT destinations.discord_channel_id,
              MAX(destinations.updated_at) AS updated_at,
              MAX(state.last_error) AS last_error
       FROM server_posting_destinations destinations
       LEFT JOIN server_posting_state state
         ON state.guild_id = destinations.guild_id
        AND state.discord_channel_id = destinations.discord_channel_id
       WHERE destinations.guild_id = ?
       GROUP BY destinations.discord_channel_id
       ORDER BY MAX(destinations.updated_at) DESC
       LIMIT 50`,
    )
    .bind(guildId)
    .all<{ discord_channel_id: string; updated_at: string | null; last_error: string | null }>();

  return (rows.results ?? []).map((row, index) => {
    const missing = parseMissingPermissions(row.last_error);
    return {
      channel_id: row.discord_channel_id,
      channel_name: `saved-${row.discord_channel_id.slice(-4)}`,
      channel_type: "text",
      category_name: "Saved destinations",
      position: index,
      category_position: 0,
      can_view: !missing.includes("View Channel"),
      can_send: !missing.includes("Send Messages"),
      can_embed: !missing.includes("Embed Links"),
      can_read_history: !missing.includes("Read Message History"),
      can_manage_messages: !missing.includes("Manage Messages"),
      can_post: missing.length === 0,
      missing_permissions: missing,
      permission_source: "unknown",
      permission_diagnostics: {
        selected_channel_id: row.discord_channel_id,
        selected_channel_name: `saved-${row.discord_channel_id.slice(-4)}`,
        bot_user_id: null,
        bot_role_ids: [],
        bot_role_names: [],
        bot_has_administrator: false,
        base_guild_permissions: null,
        effective_channel_permissions: null,
        permission_source: "unknown",
        missing_permissions: missing,
      },
    };
  });
}

function parseMissingPermissions(value: string | null) {
  const match = value?.match(/Missing:\s*([^.]*)\./i);
  if (!match?.[1]) return [];
  return match[1].split(",").map((permission) => permission.trim()).filter(Boolean);
}

function hasDiscordBotToken(env: Env) {
  return typeof env.DISCORD_BOT_TOKEN === "string" && env.DISCORD_BOT_TOKEN.trim().length > 0;
}

function normalizeDiscordId(value: unknown) {
  return typeof value === "string" && /^\d{12,24}$/.test(value.trim()) ? value.trim() : null;
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function mockChannel(channelId: string, channelName: string, categoryName: string, missingPermissions: string[] = []): DiscordPostingChannel {
  const canPost = missingPermissions.length === 0;
  return {
    channel_id: channelId,
    channel_name: channelName,
    channel_type: "text",
    category_name: categoryName,
    position: 0,
    category_position: 0,
    can_view: !missingPermissions.includes("View Channel"),
    can_send: !missingPermissions.includes("Send Messages"),
    can_embed: !missingPermissions.includes("Embed Links"),
    can_read_history: !missingPermissions.includes("Read Message History"),
    can_manage_messages: !missingPermissions.includes("Manage Messages"),
    can_post: canPost,
    missing_permissions: missingPermissions,
    permission_source: canPost ? "administrator" : "channel_overwrite",
    permission_diagnostics: {
      selected_channel_id: channelId,
      selected_channel_name: channelName,
      bot_user_id: "mock-bot",
      bot_role_ids: ["mock-dzn-bot-role"],
      bot_role_names: ["DZN Bot"],
      bot_has_administrator: canPost,
      base_guild_permissions: canPost ? "8" : "0",
      effective_channel_permissions: canPost ? "8" : "0",
      permission_source: canPost ? "administrator" : "channel_overwrite",
      missing_permissions: missingPermissions,
    },
  };
}
