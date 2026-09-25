import { requireDb } from "./db";
import { isDiscordNotificationsEnabled } from "./feature-flags";
import { parsePlatformOwnerDiscordIds } from "./platform-owner";
import type { Env } from "./types";

export type OwnerRequestNotificationRecipient = {
  userId: string;
  discordId: string;
};

type OwnerDeliveryRow = {
  id: string;
  claim_id: string;
  recipient_discord_id: string;
  attempt_count: number;
  server_name: string | null;
  player_name: string | null;
  requester_name: string | null;
};

const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 30, 120, 360] as const;

export async function hasOwnerRequestNotificationLedger(env: Env) {
  const row = await requireDb(env).prepare(
    "SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = 'player_game_identity_owner_notification_deliveries' LIMIT 1",
  ).first<{ ready: number }>().catch(() => null);
  return row?.ready === 1;
}

export async function resolveOwnerRequestNotificationRecipients(env: Env, serverOwnerUserId: string) {
  const db = requireDb(env);
  const recipients = new Map<string, OwnerRequestNotificationRecipient>();
  const owner = await db.prepare(
    "SELECT id, discord_id FROM users WHERE id = ? AND discord_id IS NOT NULL LIMIT 1",
  ).bind(serverOwnerUserId).first<{ id: string; discord_id: string | null }>();
  if (owner?.discord_id) recipients.set(owner.id, { userId: owner.id, discordId: owner.discord_id });

  const platformDiscordIds = parsePlatformOwnerDiscordIds(env.DZN_PLATFORM_OWNER_DISCORD_IDS);
  if (platformDiscordIds.length) {
    const rows = await db.prepare(
      `SELECT id, discord_id FROM users WHERE discord_id IN (${platformDiscordIds.map(() => "?").join(", ")})`,
    ).bind(...platformDiscordIds).all<{ id: string; discord_id: string }>();
    for (const row of rows.results ?? []) {
      if (row.discord_id) recipients.set(row.id, { userId: row.id, discordId: row.discord_id });
    }
  }
  return [...recipients.values()];
}

export function prepareOwnerRequestWebsiteNotification(
  db: D1Database,
  input: { claimId: string; linkedServerId: string; recipient: OwnerRequestNotificationRecipient; serverName: string; playerName: string; requesterName: string },
) {
  return db.prepare(
    `INSERT OR IGNORE INTO user_notifications (
      id, user_id, server_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at, expires_at
    ) VALUES (?, ?, ?, 'player_link_review_requested', 'Player stat link needs review', ?,
      '/owner/player-game-identity-claims', 750, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+90 days'))`,
  ).bind(
    crypto.randomUUID(),
    input.recipient.userId,
    input.linkedServerId,
    `${safeText(input.requesterName)} asked to link the ${safeText(input.playerName)} profile on ${safeText(input.serverName)}. The gamertag is only a candidate; verify ownership before deciding.`,
    `player-link-review:${input.claimId}:${input.recipient.userId}`,
    JSON.stringify({ claim_id: input.claimId, request_kind: "stat_link_review" }),
  );
}

export function prepareOwnerRequestDiscordDelivery(
  db: D1Database,
  input: { id: string; claimId: string; linkedServerId: string; recipient: OwnerRequestNotificationRecipient },
) {
  return db.prepare(
    `INSERT OR IGNORE INTO player_game_identity_owner_notification_deliveries (
      id, claim_id, recipient_user_id, recipient_discord_id, linked_server_id, status,
      attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).bind(input.id, input.claimId, input.recipient.userId, input.recipient.discordId, input.linkedServerId);
}

export async function dispatchQueuedOwnerRequestNotifications(
  env: Env,
  options: { deliveryIds?: string[]; maxJobs?: number } = {},
) {
  if (!await hasOwnerRequestNotificationLedger(env)) {
    return { ok: true, unavailable: true, processed: 0, delivered: 0, retried: 0, failed: 0, skipped: 0 };
  }
  const db = requireDb(env);
  const maxJobs = Math.max(1, Math.min(20, Math.trunc(options.maxJobs ?? 10)));
  await db.prepare(
    `UPDATE player_game_identity_owner_notification_deliveries
     SET status = 'retry', lease_id = NULL, lease_expires_at = NULL, next_attempt_at = CURRENT_TIMESTAMP,
         result_code = 'delivery_lease_expired', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at) <= datetime('now')`,
  ).run();
  const ids = options.deliveryIds?.filter((id) => /^[a-zA-Z0-9-]{8,80}$/.test(id)) ?? [];
  const idClause = ids.length ? `AND id IN (${ids.map(() => "?").join(", ")})` : "";
  const due = await db.prepare(
    `SELECT id FROM player_game_identity_owner_notification_deliveries
     WHERE status IN ('queued', 'retry') AND datetime(next_attempt_at) <= datetime('now')
       AND attempt_count < ? ${idClause}
     ORDER BY datetime(next_attempt_at), datetime(created_at) LIMIT ?`,
  ).bind(MAX_ATTEMPTS, ...ids, maxJobs).all<{ id: string }>();

  let delivered = 0;
  let retried = 0;
  let failed = 0;
  let skipped = 0;
  for (const candidate of due.results ?? []) {
    const leaseId = crypto.randomUUID();
    const claimed = await db.prepare(
      `UPDATE player_game_identity_owner_notification_deliveries
       SET status='processing', lease_id=?, lease_expires_at=datetime('now', '+2 minutes'),
           last_attempt_at=CURRENT_TIMESTAMP, attempt_count=attempt_count+1, updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND status IN ('queued','retry') AND datetime(next_attempt_at) <= datetime('now')`,
    ).bind(leaseId, candidate.id).run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;
    const row = await db.prepare(
      `SELECT d.id, d.claim_id, d.recipient_discord_id, d.attempt_count,
              COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
              c.player_name, u.username AS requester_name
       FROM player_game_identity_owner_notification_deliveries d
       JOIN player_game_identity_claims c ON c.id=d.claim_id
       JOIN linked_servers s ON s.id=d.linked_server_id
       JOIN users u ON u.id=c.user_id
       WHERE d.id=? AND d.lease_id=? AND d.status='processing' LIMIT 1`,
    ).bind(candidate.id, leaseId).first<OwnerDeliveryRow>();
    if (!row) continue;
    const result = await sendOwnerRequestDiscord(env, row);
    const outcome = classifyResult(result, row.attempt_count);
    await db.prepare(
      `UPDATE player_game_identity_owner_notification_deliveries
       SET status=?, result_code=?, delivered_at=CASE WHEN ?='delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
           next_attempt_at=CASE WHEN ?='retry' THEN datetime('now', ?) ELSE next_attempt_at END,
           lease_id=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND lease_id=? AND status='processing'`,
    ).bind(outcome.status, result.reason, outcome.status, outcome.status, outcome.delay, row.id, leaseId).run();
    if (outcome.status === "delivered") delivered++;
    else if (outcome.status === "retry") retried++;
    else if (outcome.status === "skipped") skipped++;
    else failed++;
  }
  return { ok: failed === 0, unavailable: false, processed: delivered + retried + failed + skipped, delivered, retried, failed, skipped };
}

async function sendOwnerRequestDiscord(env: Env, row: OwnerDeliveryRow) {
  if (!isDiscordNotificationsEnabled(env)) return { ok: true, skipped: true, reason: "discord_notifications_disabled" } as const;
  const token = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!token) return { ok: false, skipped: true, reason: "discord_bot_token_missing" } as const;
  if (!/^\d{5,32}$/.test(row.recipient_discord_id)) return { ok: false, skipped: true, reason: "discord_recipient_invalid" } as const;
  try {
    const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient_id: row.recipient_discord_id }),
    });
    if (!channelResponse.ok) return { ok: false, skipped: false, reason: `discord_dm_channel_${channelResponse.status}` } as const;
    const channel = await channelResponse.json().catch(() => null) as { id?: unknown } | null;
    const channelId = typeof channel?.id === "string" && /^\d{5,32}$/.test(channel.id) ? channel.id : null;
    if (!channelId) return { ok: false, skipped: false, reason: "discord_dm_channel_invalid" } as const;
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        content: `New DZN player-stat link review: **${safeText(row.requester_name || "A player")}** asked to link **${safeText(row.player_name || "a game profile")}** on **${safeText(row.server_name || "your server")}**. This is not proof they played or own the profile. Verify the evidence in Owner Console before approving.`,
        allowed_mentions: { parse: [] },
        components: [],
      }),
    });
    return response.ok
      ? { ok: true, skipped: false, reason: "discord_dm_delivered" } as const
      : { ok: false, skipped: false, reason: `discord_dm_message_${response.status}` } as const;
  } catch {
    return { ok: false, skipped: false, reason: "discord_dm_request_failed" } as const;
  }
}

function classifyResult(result: Awaited<ReturnType<typeof sendOwnerRequestDiscord>>, attemptCount: number) {
  if (result.ok && !result.skipped) return { status: "delivered", delay: "+0 minutes" } as const;
  if (result.skipped && result.reason === "discord_notifications_disabled") return { status: "skipped", delay: "+0 minutes" } as const;
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

function safeText(value: string) {
  return value
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "link removed")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/gi, (match) => match.replace(/\./g, " dot "))
    .replace(/[*_`~|>@[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "unknown";
}
