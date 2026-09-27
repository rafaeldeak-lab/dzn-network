import { requireDb } from "./db";
import { isDiscordNotificationsEnabled } from "./feature-flags";
import { getOwnerServer } from "./owner-console";
import type { Env } from "./types";

export async function sendOwnerSetupRecommendation(env: Env, serverId: string) {
  const db = requireDb(env);
  const owner = await db.prepare(
    `SELECT linked_servers.user_id, linked_servers.server_name, users.discord_id
     FROM linked_servers JOIN users ON users.id=linked_servers.user_id
     WHERE linked_servers.id=? LIMIT 1`,
  ).bind(serverId).first<{ user_id: string; server_name: string | null; discord_id: string | null }>();
  if (!owner) return { ok: false as const, status: 404, error: "server_not_found" };
  const support = await getOwnerServer(env, serverId);
  if (!support) return { ok: false as const, status: 404, error: "server_not_found" };
  if (!support.supportBlockers.length) return { ok: false as const, status: 409, error: "no_setup_blockers" };

  const notificationId = crypto.randomUUID();
  const dedupeKey = `owner-setup-recommendation-${serverId}`;
  const blockerSummary = support.supportBlockers.map((item) => item.title).join(", ").slice(0, 420);
  const body = `${safeText(owner.server_name || "Your DZN server")} still needs attention: ${safeText(blockerSummary)}. Open Server Setup to continue from your saved progress.`;
  await db.prepare(
    `INSERT INTO user_notifications
      (id,user_id,server_id,type,title,body,action_url,priority,dedupe_key,metadata,created_at,expires_at)
     VALUES (?, ?, ?, 'server_setup_recommendation', 'Finish your DZN server setup', ?, '/setup#review-test', 800, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+90 days'))
     ON CONFLICT(user_id,dedupe_key) DO UPDATE SET title=excluded.title,body=excluded.body,action_url=excluded.action_url,
       priority=excluded.priority,metadata=excluded.metadata,read_at=NULL,created_at=CURRENT_TIMESTAMP,expires_at=datetime('now', '+90 days')`,
  ).bind(notificationId, owner.user_id, serverId, body, dedupeKey, JSON.stringify({
    server_id: serverId,
    request_kind: "setup_recommendation",
    blocker_keys: support.supportBlockers.map((item) => item.key),
    discord_delivery_status: "not_sent",
  })).run();

  const discord = await deliverSetupDiscord(env, owner, body);
  await db.prepare(
    `UPDATE user_notifications SET metadata=json_set(COALESCE(metadata,'{}'),
       '$.discord_delivery_status', ?, '$.discord_delivery_result', ?, '$.discord_attempted_at', CURRENT_TIMESTAMP)
     WHERE user_id=? AND dedupe_key=?`,
  ).bind(discord.status, discord.result, owner.user_id, dedupeKey).run();
  return { ok: true as const, website: "sent" as const, discord: discord.status };
}

async function deliverSetupDiscord(
  env: Env,
  owner: { user_id: string; discord_id: string | null },
  body: string,
) {
  if (!isDiscordNotificationsEnabled(env)) return { status: "not_sent", result: "discord_notifications_disabled" };
  const preference = await requireDb(env).prepare("SELECT discord_enabled FROM notification_preferences WHERE user_id=?")
    .bind(owner.user_id).first<{ discord_enabled: number | null }>().catch(() => null);
  if (Number(preference?.discord_enabled ?? 0) !== 1) return { status: "not_sent", result: "disabled_by_owner" };
  const discordId = String(owner.discord_id ?? "").trim();
  const token = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!token || !/^\d{5,32}$/.test(discordId)) return { status: "failed", result: token ? "invalid_recipient" : "bot_token_missing" };
  try {
    const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient_id: discordId }),
    });
    const channel = await channelResponse.json().catch(() => null) as { id?: unknown } | null;
    const channelId = channelResponse.ok && typeof channel?.id === "string" && /^\d{5,32}$/.test(channel.id) ? channel.id : null;
    if (!channelId) return { status: "failed", result: `discord_dm_channel_${channelResponse.status}` };
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: body, allowed_mentions: { parse: [] }, components: [] }),
    });
    return messageResponse.ok
      ? { status: "delivered", result: "discord_dm_delivered" }
      : { status: "failed", result: `discord_dm_message_${messageResponse.status}` };
  } catch {
    return { status: "failed", result: "discord_dm_request_failed" };
  }
}

function normalizeBotToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim().replace(/^Bot\s+/i, "");
  return token.length >= 20 && !/\s/.test(token) ? token : null;
}

function safeText(value: string) {
  return value.replace(/[*_`~|>@[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, 480) || "DZN setup needs attention";
}
