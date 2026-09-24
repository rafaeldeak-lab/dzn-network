import { isDiscordNotificationsEnabled } from "./feature-flags";
import type { Env } from "./types";

export type PlayerGameIdentityDecisionDelivery = {
  claimId: string;
  userId: string;
  discordId: string;
  action: "approved" | "rejected";
  serverName: string;
  playerName: string;
};

export async function dispatchPlayerGameIdentityDecisionDiscord(
  env: Env,
  delivery: PlayerGameIdentityDecisionDelivery,
) {
  if (!isDiscordNotificationsEnabled(env)) return { ok: true, skipped: true, reason: "discord_notifications_disabled" } as const;
  const token = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!token) return { ok: false, skipped: true, reason: "discord_bot_token_missing" } as const;
  if (!/^\d{5,32}$/.test(delivery.discordId)) return { ok: false, skipped: true, reason: "discord_recipient_invalid" } as const;

  try {
    const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient_id: delivery.discordId }),
    });
    if (!channelResponse.ok) return { ok: false, skipped: false, reason: `discord_dm_channel_${channelResponse.status}` } as const;
    const channel = await channelResponse.json().catch(() => null) as { id?: unknown } | null;
    const channelId = typeof channel?.id === "string" && /^\d{5,32}$/.test(channel.id) ? channel.id : null;
    if (!channelId) return { ok: false, skipped: false, reason: "discord_dm_channel_invalid" } as const;

    const approved = delivery.action === "approved";
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        content: approved
          ? `Your DZN game-stat link for **${safeDiscordText(delivery.playerName)}** on **${safeDiscordText(delivery.serverName)}** was approved. Open your Game Account page to view the connected stats.`
          : `Your DZN game-stat link request for **${safeDiscordText(delivery.playerName)}** on **${safeDiscordText(delivery.serverName)}** was not approved. Open your Game Account page to view the decision and contact the server owner if you need help.`,
        allowed_mentions: { parse: [] },
        components: [],
      }),
    });
    return messageResponse.ok
      ? { ok: true, skipped: false, reason: "discord_dm_delivered" } as const
      : { ok: false, skipped: false, reason: `discord_dm_message_${messageResponse.status}` } as const;
  } catch {
    return { ok: false, skipped: false, reason: "discord_dm_request_failed" } as const;
  }
}

function normalizeBotToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim().replace(/^Bot\s+/i, "");
  return token.length >= 20 && !/\s/.test(token) ? token : null;
}

function safeDiscordText(value: string) {
  return value.replace(/[*_`~|>@]/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || "game profile";
}
