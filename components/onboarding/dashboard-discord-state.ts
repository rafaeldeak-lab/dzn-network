import type { DiscordChannelsResponse, DiscordPostingChannel } from "./types";

export type DiscordChannelCache = {
  server_id: string;
  guild_id: string;
  channels: DiscordPostingChannel[];
  last_channel_fetch_success_at: string;
  verification_received_at: number;
  last_channel_count: number;
  last_postable_channel_count: number;
  last_bot_connected_state: boolean | null;
  guild_name: string | null;
};

const VERIFICATION_MAX_AGE_MS = 5 * 60 * 1000;

export function isCurrentDiscordCache(cache: DiscordChannelCache | null, serverId: string, guildId: string, now = Date.now()) {
  if (!cache || cache.server_id !== serverId || cache.guild_id !== guildId || !guildId || !Array.isArray(cache.channels)) return false;
  const age = now - cache.verification_received_at;
  return Number.isFinite(age) && age >= 0 && age < VERIFICATION_MAX_AGE_MS && cache.last_bot_connected_state === true;
}

export function verifiedDiscordCache(response: DiscordChannelsResponse, serverId: string, guildId: string, receivedAt = Date.now()): DiscordChannelCache | null {
  if (response.selected_server_id !== serverId || response.selected_guild_id !== guildId ||
      response.ok !== true || response.bot_connected !== true || response.error_code || response.errorCode ||
      response.diagnostics?.using_cached_channel_state === true || !Array.isArray(response.channels)) return null;
  return {
    server_id: serverId,
    guild_id: guildId,
    channels: response.channels,
    last_channel_fetch_success_at: response.diagnostics?.last_fetch_success_at ?? response.fetched_at,
    // Expire against the same browser clock that recorded receipt, not the API clock.
    verification_received_at: receivedAt,
    last_channel_count: response.channels.length,
    last_postable_channel_count: response.channels.filter(channel => channel.can_post).length,
    last_bot_connected_state: true,
    guild_name: response.guild_name ?? null,
  };
}

export function discordSetupEvidence(response: DiscordChannelsResponse | null, cache: DiscordChannelCache | null, serverId: string, guildId: string, failed = false, now = Date.now()) {
  const scoped = response?.selected_server_id === serverId && response.selected_guild_id === guildId ? response : null;
  const error = scoped?.error_code ?? scoped?.errorCode;
  const unavailable = failed || scoped?.ok === false || Boolean(error);
  // A failed live check must outrank a previously successful browser cache.
  const connected = !unavailable && scoped?.bot_connected !== false && isCurrentDiscordCache(cache, serverId, guildId, now);
  const count = connected ? cache!.channels.length : 0;
  const botLabel = error === "missing_bot_token" ? "Not configured"
    : scoped?.bot_connected === false ? "Not installed"
      : unavailable ? "Check unavailable"
        : connected ? "Verified" : "Not checked yet";
  return { connected, channelsDiscovered: connected && count > 0, count, botLabel,
    channelLabel: connected ? `${count} found` : unavailable ? "Check unavailable" : "Not checked yet" };
}
