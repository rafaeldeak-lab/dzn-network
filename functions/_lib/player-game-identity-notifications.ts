import { isDiscordNotificationsEnabled } from "./feature-flags";
import type { Env } from "./types";

export type PlayerGameIdentityDecisionDelivery = {
  deliveryId?: string | null;
  claimId: string;
  userId: string;
  discordId: string;
  action: "approved" | "rejected" | "revoked";
  serverName: string;
  playerName: string;
};

type DeliveryRow = {
  id: string;
  claim_id: string | null;
  user_id: string;
  discord_id: string;
  event_type: "approved" | "rejected" | "revoked";
  attempt_count: number;
  server_name: string | null;
  player_name: string | null;
};

const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 30, 120, 360] as const;

export async function hasPlayerGameIdentityDeliveryLedger(env: Env) {
  try {
    const row = await env.DB.prepare(
      "SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = 'player_game_identity_notification_deliveries' LIMIT 1",
    ).first<{ ready: number }>();
    return row?.ready === 1;
  } catch {
    return false;
  }
}

export async function dispatchPlayerGameIdentityDecisionDiscord(
  env: Env,
  delivery: PlayerGameIdentityDecisionDelivery,
) {
  if (!isDiscordNotificationsEnabled(env)) return { ok: true, skipped: true, reason: "discord_notifications_disabled" } as const;
  const preference = await env.DB.prepare(
    "SELECT discord_enabled FROM notification_preferences WHERE user_id = ?",
  ).bind(delivery.userId).first<{ discord_enabled: number | null }>().catch(() => null);
  if (Number(preference?.discord_enabled ?? 0) !== 1) {
    return { ok: true, skipped: true, reason: "discord_notifications_not_enabled_by_player" } as const;
  }
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
    const revoked = delivery.action === "revoked";
    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        content: approved
          ? `Your DZN game-stat link for **${safeDiscordText(delivery.playerName)}** on **${safeDiscordText(delivery.serverName)}** was approved. Open your Game Account page to view the connected stats.`
          : revoked
            ? `Your DZN game-stat link for **${safeDiscordText(delivery.playerName)}** on **${safeDiscordText(delivery.serverName)}** was revoked. Open your Game Account page to view the decision and contact the server owner if you need help.`
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

export async function dispatchQueuedPlayerGameIdentityNotifications(
  env: Env,
  options: { deliveryId?: string | null; maxJobs?: number } = {},
) {
  if (!await hasPlayerGameIdentityDeliveryLedger(env)) {
    return { ok: true, unavailable: true, processed: 0, delivered: 0, retried: 0, failed: 0, skipped: 0 };
  }
  const maxJobs = Math.max(1, Math.min(20, Math.trunc(options.maxJobs ?? 10)));
  await env.DB.prepare(
    `UPDATE player_game_identity_notification_deliveries
     SET status = 'retry', lease_id = NULL, lease_expires_at = NULL, next_attempt_at = CURRENT_TIMESTAMP,
         result_code = 'delivery_lease_expired', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at) <= datetime('now')`,
  ).run();
  const due = await env.DB.prepare(
    `SELECT id FROM player_game_identity_notification_deliveries
     WHERE status IN ('queued', 'retry')
       AND datetime(next_attempt_at) <= datetime('now')
       AND attempt_count < ?
       AND (? IS NULL OR id = ?)
     ORDER BY datetime(next_attempt_at) ASC, datetime(created_at) ASC
     LIMIT ?`,
  ).bind(MAX_ATTEMPTS, options.deliveryId ?? null, options.deliveryId ?? null, maxJobs).all<{ id: string }>();

  let delivered = 0;
  let retried = 0;
  let failed = 0;
  let skipped = 0;
  for (const candidate of due.results ?? []) {
    const leaseId = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      `UPDATE player_game_identity_notification_deliveries
       SET status = 'processing', lease_id = ?, lease_expires_at = datetime('now', '+2 minutes'),
           last_attempt_at = CURRENT_TIMESTAMP, attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('queued', 'retry') AND datetime(next_attempt_at) <= datetime('now')`,
    ).bind(leaseId, candidate.id).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;

    const row = await env.DB.prepare(
      `SELECT d.id, d.claim_id, d.user_id, d.discord_id, d.event_type, d.attempt_count,
         COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
         COALESCE(c.player_name, l.player_name, 'game profile') AS player_name
       FROM player_game_identity_notification_deliveries d
       INNER JOIN linked_servers s ON s.id = d.linked_server_id
       LEFT JOIN player_game_identity_claims c ON c.id = d.claim_id
       LEFT JOIN player_game_identity_links l ON l.id = d.link_id
       WHERE d.id = ? AND d.lease_id = ? AND d.status = 'processing' LIMIT 1`,
    ).bind(candidate.id, leaseId).first<DeliveryRow>();
    if (!row) continue;

    const result = await dispatchPlayerGameIdentityDecisionDiscord(env, {
      deliveryId: row.id,
      claimId: row.claim_id ?? "revoked-link",
      userId: row.user_id,
      discordId: row.discord_id,
      action: row.event_type,
      serverName: row.server_name || "DZN Server",
      playerName: row.player_name || "game profile",
    });
    const outcome = classifyDeliveryResult(result, row.attempt_count);
    await env.DB.prepare(
      `UPDATE player_game_identity_notification_deliveries
       SET status = ?, result_code = ?, delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
           next_attempt_at = CASE WHEN ? = 'retry' THEN datetime('now', ?) ELSE next_attempt_at END,
           lease_id = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_id = ? AND status = 'processing'`,
    ).bind(outcome.status, result.reason, outcome.status, outcome.status, outcome.delay, row.id, leaseId).run();
    if (outcome.status === "delivered") delivered++;
    else if (outcome.status === "retry") retried++;
    else if (outcome.status === "skipped") skipped++;
    else failed++;
  }
  return { ok: failed === 0, unavailable: false, processed: delivered + retried + failed + skipped, delivered, retried, failed, skipped };
}

function classifyDeliveryResult(
  result: Awaited<ReturnType<typeof dispatchPlayerGameIdentityDecisionDiscord>>,
  attemptCount: number,
) {
  if (result.ok && !result.skipped) return { status: "delivered", delay: "+0 minutes" } as const;
  if (result.skipped && ["discord_notifications_disabled", "discord_notifications_not_enabled_by_player"].includes(result.reason)) {
    return { status: "skipped", delay: "+0 minutes" } as const;
  }
  const statusCode = Number(result.reason.match(/_(\d{3})$/)?.[1] ?? 0);
  const retryable = result.reason === "discord_dm_request_failed" || statusCode === 429 || statusCode >= 500;
  if (retryable && attemptCount < MAX_ATTEMPTS) {
    const minutes = RETRY_MINUTES[Math.min(attemptCount - 1, RETRY_MINUTES.length - 1)];
    return { status: "retry", delay: `+${minutes} minutes` } as const;
  }
  return { status: "failed", delay: "+0 minutes" } as const;
}

function normalizeBotToken(value: unknown) {
  if (typeof value !== "string") return null;
  const token = value.trim().replace(/^Bot\s+/i, "");
  return token.length >= 20 && !/\s/.test(token) ? token : null;
}

function safeDiscordText(value: string) {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "link removed")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/gi, (match) => match.replace(/\./g, " dot "))
    .replace(/[*_`~|>@[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "game profile";
}
