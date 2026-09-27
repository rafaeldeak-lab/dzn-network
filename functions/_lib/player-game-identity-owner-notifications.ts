import { requireDb } from "./db";
import { verifyDiscordPostingChannel } from "./discord-posting";
import { isDznAdminDiscordId } from "./admin";
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
  linked_server_id: string;
  server_owner_user_id: string;
  guild_id: string | null;
  recipient_user_id: string;
  recipient_discord_id: string;
  attempt_count: number;
  claim_status: string;
  server_name: string | null;
  player_name: string | null;
  requester_name: string | null;
};

type PendingOwnerReconciliationRow = {
  claim_id: string;
  linked_server_id: string;
  server_owner_user_id: string;
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

  for (const recipient of await resolvePlatformAdminNotificationRecipients(env)) {
    recipients.set(recipient.userId, recipient);
  }
  return [...recipients.values()];
}

async function resolvePlatformAdminNotificationRecipients(env: Env) {
  const db = requireDb(env);
  const recipients: OwnerRequestNotificationRecipient[] = [];
  const platformDiscordIds = parsePlatformOwnerDiscordIds(env.DZN_PLATFORM_OWNER_DISCORD_IDS);
  if (platformDiscordIds.length) {
    const rows = await db.prepare(
      `SELECT id, discord_id FROM users WHERE discord_id IN (${platformDiscordIds.map(() => "?").join(", ")})`,
    ).bind(...platformDiscordIds).all<{ id: string; discord_id: string }>();
    for (const row of rows.results ?? []) {
      if (row.discord_id && isDznAdminDiscordId(env, row.discord_id)) {
        recipients.push({ userId: row.id, discordId: row.discord_id });
      }
    }
  }
  return recipients;
}

export function prepareOwnerRequestWebsiteNotification(
  db: D1Database,
  input: { claimId: string; linkedServerId: string; recipient: OwnerRequestNotificationRecipient; serverName: string; playerName: string; requesterName: string },
) {
  return db.prepare(
    `INSERT INTO user_notifications (
      id, user_id, server_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at, expires_at
    ) SELECT ?, ?, NULL, 'player_link_review_requested', 'Player stat link needs review', ?,
      '/owner/player-game-identity-claims', 750, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+90 days')
    WHERE EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id=? AND status='pending')
    ON CONFLICT(user_id, dedupe_key) DO UPDATE SET
      title=excluded.title, body=excluded.body, action_url=excluded.action_url, priority=excluded.priority,
      metadata=excluded.metadata, read_at=NULL, created_at=CURRENT_TIMESTAMP, expires_at=datetime('now', '+90 days')
    WHERE datetime(user_notifications.expires_at) <= datetime('now')`,
  ).bind(
    crypto.randomUUID(),
    input.recipient.userId,
    `${safeText(input.requesterName)} asked to link the ${safeText(input.playerName)} profile on ${safeText(input.serverName)}. The gamertag is only a candidate; verify ownership before deciding.`,
    `player-link-review:${input.claimId}:${input.recipient.userId}`,
    JSON.stringify({ claim_id: input.claimId, request_kind: "stat_link_review" }),
    input.claimId,
  );
}

export function prepareOwnerRequestDiscordDelivery(
  db: D1Database,
  input: { id: string; claimId: string; linkedServerId: string; recipient: OwnerRequestNotificationRecipient },
) {
  return db.prepare(
    `INSERT INTO player_game_identity_owner_notification_deliveries (
      id, claim_id, recipient_user_id, recipient_discord_id, linked_server_id, status,
      attempt_count, next_attempt_at, created_at, updated_at
    ) SELECT ?, ?, ?, ?, ?, 'queued', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id=? AND status='pending')
    ON CONFLICT(claim_id, recipient_user_id) DO UPDATE SET
      recipient_discord_id=excluded.recipient_discord_id, linked_server_id=excluded.linked_server_id,
      status='queued', attempt_count=0, next_attempt_at=CURRENT_TIMESTAMP, last_attempt_at=NULL,
      delivered_at=NULL, result_code=NULL, lease_id=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
    WHERE (player_game_identity_owner_notification_deliveries.status='skipped'
      AND player_game_identity_owner_notification_deliveries.result_code='recipient_no_longer_authorized')
      OR player_game_identity_owner_notification_deliveries.recipient_discord_id<>excluded.recipient_discord_id`,
  ).bind(input.id, input.claimId, input.recipient.userId, input.recipient.discordId, input.linkedServerId, input.claimId);
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
  await reconcilePendingOwnerRequestRecipients(env, maxJobs);
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
      `SELECT d.id, d.claim_id, d.linked_server_id, s.user_id AS server_owner_user_id, s.guild_id,
              d.recipient_user_id, d.recipient_discord_id, d.attempt_count,
              c.status AS claim_status,
              COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
              c.player_name, u.username AS requester_name
       FROM player_game_identity_owner_notification_deliveries d
       JOIN player_game_identity_claims c ON c.id=d.claim_id
       JOIN linked_servers s ON s.id=d.linked_server_id
       JOIN users u ON u.id=c.user_id
       WHERE d.id=? AND d.lease_id=? AND d.status='processing' LIMIT 1`,
    ).bind(candidate.id, leaseId).first<OwnerDeliveryRow>();
    if (!row) continue;
    if (row.claim_status !== "pending") {
      await db.prepare(
        `UPDATE player_game_identity_owner_notification_deliveries
         SET status='skipped', result_code='claim_not_pending', lease_id=NULL, lease_expires_at=NULL,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND lease_id=? AND status='processing'`,
      ).bind(row.id, leaseId).run();
      skipped++;
      continue;
    }
    const currentRecipients = await resolveOwnerRequestNotificationRecipients(env, row.server_owner_user_id);
    const stillAuthorized = currentRecipients.some((recipient) => (
      recipient.userId === row.recipient_user_id && recipient.discordId === row.recipient_discord_id
    ));
    if (!stillAuthorized) {
      const statements = currentRecipients.flatMap((recipient) => [
        prepareOwnerRequestWebsiteNotification(db, {
          claimId: row.claim_id,
          linkedServerId: row.linked_server_id,
          recipient,
          serverName: row.server_name || "DZN Server",
          playerName: row.player_name || "game profile",
          requesterName: row.requester_name || "A player",
        }),
        prepareOwnerRequestDiscordDelivery(db, {
          id: crypto.randomUUID(),
          claimId: row.claim_id,
          linkedServerId: row.linked_server_id,
          recipient,
        }),
      ]);
      statements.push(
        db.prepare(
          `UPDATE user_notifications
           SET read_at=COALESCE(read_at, CURRENT_TIMESTAMP), expires_at=CURRENT_TIMESTAMP,
               metadata=json_set(COALESCE(metadata, '{}'), '$.review_status', 'recipient_no_longer_authorized', '$.terminalized_at', CURRENT_TIMESTAMP)
           WHERE user_id=? AND dedupe_key=?
             AND EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id=? AND status='pending')`,
        ).bind(row.recipient_user_id, `player-link-review:${row.claim_id}:${row.recipient_user_id}`, row.claim_id),
        db.prepare(
          `UPDATE player_game_identity_owner_notification_deliveries
           SET status='skipped', result_code='recipient_no_longer_authorized', lease_id=NULL, lease_expires_at=NULL,
              updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND lease_id=? AND status='processing'
             AND EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id=? AND status='pending')`,
        ).bind(row.id, leaseId, row.claim_id),
      );
      await db.batch(statements);
      skipped++;
      continue;
    }
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

async function reconcilePendingOwnerRequestRecipients(env: Env, maxClaims: number) {
  const db = requireDb(env);
  const platformRecipients = await resolvePlatformAdminNotificationRecipients(env);
  const platformIds = platformRecipients.map((recipient) => recipient.userId);
  const platformPlaceholders = platformIds.map(() => "?").join(", ");
  const formerDeliveryScope = platformIds.length
    ? `AND current_delivery.recipient_user_id NOT IN (${platformPlaceholders})`
    : "";
  const formerAlertScope = platformIds.length
    ? `AND current_alert.user_id NOT IN (${platformPlaceholders})`
    : "";
  const missingPlatformConditions = platformRecipients.map(() => `
         OR NOT EXISTS (
           SELECT 1 FROM player_game_identity_owner_notification_deliveries platform_delivery
           WHERE platform_delivery.claim_id=c.id AND platform_delivery.recipient_user_id=?
             AND platform_delivery.recipient_discord_id=?
             AND NOT (platform_delivery.status='skipped' AND platform_delivery.result_code='recipient_no_longer_authorized')
         )
         OR NOT EXISTS (
           SELECT 1 FROM user_notifications platform_alert
           WHERE platform_alert.user_id=?
             AND platform_alert.dedupe_key=('player-link-review:' || c.id || ':' || ?)
             AND datetime(platform_alert.expires_at) > datetime('now')
         )`).join("");
  const bindings: unknown[] = [
    ...platformIds,
    ...platformIds,
    ...platformRecipients.flatMap((recipient) => [recipient.userId, recipient.discordId, recipient.userId, recipient.userId]),
    maxClaims,
  ];
  const claims = await db.prepare(
    `SELECT c.id AS claim_id, c.linked_server_id, s.user_id AS server_owner_user_id,
            COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
            c.player_name, requester.username AS requester_name
     FROM player_game_identity_claims c
     JOIN linked_servers s ON s.id=c.linked_server_id
     JOIN users owner_user ON owner_user.id=s.user_id AND owner_user.discord_id IS NOT NULL
     JOIN users requester ON requester.id=c.user_id
     WHERE c.status='pending'
       AND EXISTS (SELECT 1 FROM player_game_identity_owner_notification_deliveries existing WHERE existing.claim_id=c.id)
       AND (
         NOT EXISTS (
           SELECT 1 FROM player_game_identity_owner_notification_deliveries current_delivery
           WHERE current_delivery.claim_id=c.id AND current_delivery.recipient_user_id=s.user_id
             AND current_delivery.recipient_discord_id=owner_user.discord_id
             AND NOT (current_delivery.status='skipped' AND current_delivery.result_code='recipient_no_longer_authorized')
         )
         OR NOT EXISTS (
           SELECT 1 FROM user_notifications current_alert
           WHERE current_alert.user_id=s.user_id
             AND current_alert.dedupe_key=('player-link-review:' || c.id || ':' || s.user_id)
             AND datetime(current_alert.expires_at) > datetime('now')
         )
         OR EXISTS (
           SELECT 1 FROM player_game_identity_owner_notification_deliveries current_delivery
           WHERE current_delivery.claim_id=c.id AND current_delivery.recipient_user_id<>s.user_id
             ${formerDeliveryScope}
             AND NOT (current_delivery.status='skipped' AND current_delivery.result_code='recipient_no_longer_authorized')
         )
         OR EXISTS (
           SELECT 1 FROM user_notifications current_alert
           WHERE current_alert.type='player_link_review_requested'
             AND json_extract(current_alert.metadata, '$.claim_id')=c.id
             AND current_alert.user_id<>s.user_id
             ${formerAlertScope}
             AND datetime(current_alert.expires_at) > datetime('now')
         )
         ${missingPlatformConditions}
       )
     ORDER BY datetime(c.created_at), c.id
     LIMIT ?`,
  ).bind(...bindings).all<PendingOwnerReconciliationRow>();

  for (const claim of claims.results ?? []) {
    const recipients = await resolveOwnerRequestNotificationRecipients(env, claim.server_owner_user_id);
    if (!recipients.length) continue;
    const recipientIds = recipients.map((recipient) => recipient.userId);
    const placeholders = recipientIds.map(() => "?").join(", ");
    const statements = recipients.flatMap((recipient) => [
      prepareOwnerRequestWebsiteNotification(db, {
        claimId: claim.claim_id,
        linkedServerId: claim.linked_server_id,
        recipient,
        serverName: claim.server_name || "DZN Server",
        playerName: claim.player_name || "game profile",
        requesterName: claim.requester_name || "A player",
      }),
      prepareOwnerRequestDiscordDelivery(db, {
        id: crypto.randomUUID(),
        claimId: claim.claim_id,
        linkedServerId: claim.linked_server_id,
        recipient,
      }),
    ]);
    statements.push(
      db.prepare(
        `UPDATE user_notifications
         SET read_at=COALESCE(read_at, CURRENT_TIMESTAMP), expires_at=CURRENT_TIMESTAMP,
             metadata=json_set(COALESCE(metadata, '{}'), '$.review_status', 'recipient_no_longer_authorized', '$.terminalized_at', CURRENT_TIMESTAMP)
         WHERE type='player_link_review_requested'
           AND json_extract(metadata, '$.claim_id')=?
           AND user_id NOT IN (${placeholders})
           AND EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id=? AND status='pending')`,
      ).bind(claim.claim_id, ...recipientIds, claim.claim_id),
      db.prepare(
        `UPDATE player_game_identity_owner_notification_deliveries
         SET status='skipped', result_code='recipient_no_longer_authorized', lease_id=NULL, lease_expires_at=NULL,
             updated_at=CURRENT_TIMESTAMP
         WHERE claim_id=? AND recipient_user_id NOT IN (${placeholders})
           AND EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id=? AND status='pending')`,
      ).bind(claim.claim_id, ...recipientIds, claim.claim_id),
    );
    await db.batch(statements);
  }
}

async function sendOwnerRequestDiscord(env: Env, row: OwnerDeliveryRow) {
  if (!isDiscordNotificationsEnabled(env)) return { ok: true, skipped: true, reason: "discord_notifications_disabled" } as const;
  const preference = await requireDb(env).prepare(
    "SELECT discord_enabled FROM notification_preferences WHERE user_id = ?",
  ).bind(row.recipient_user_id).first<{ discord_enabled: number | null }>().catch(() => null);
  if (Number(preference?.discord_enabled ?? 0) !== 1) {
    return { ok: true, skipped: true, reason: "discord_notifications_not_enabled_by_owner" } as const;
  }
  const token = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!token) return { ok: false, skipped: true, reason: "discord_bot_token_missing" } as const;
  if (!/^\d{5,32}$/.test(row.recipient_discord_id)) return { ok: false, skipped: true, reason: "discord_recipient_invalid" } as const;
  const content = `New DZN player-stat link review: **${safeText(row.requester_name || "A player")}** asked to link **${safeText(row.player_name || "a game profile")}** on **${safeText(row.server_name || "your server")}**. This is not proof they played or own the profile. Verify the evidence in Owner Console before approving.`;
  let retryableChannelFailure: string | null = null;
  try {
    if (row.recipient_user_id === row.server_owner_user_id && row.guild_id) {
      const selected = await requireDb(env).prepare(
        `SELECT channel_id FROM server_discord_channel_settings
         WHERE linked_server_id=? AND guild_id=? AND channel_type='player_link_approvals'
           AND bot_can_view=1 AND bot_can_send=1 AND bot_can_read_history=1
         LIMIT 1`,
      ).bind(row.linked_server_id, row.guild_id).first<{ channel_id: string }>().catch(() => null);
      if (selected?.channel_id) {
        const channel = await verifyDiscordPostingChannel(env, row.guild_id, selected.channel_id).catch(() => null);
        if (channel?.can_post && channel.restricted_from_everyone) {
          try {
            const channelDelivery = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(selected.channel_id)}/messages`, {
              method: "POST",
              headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ content, allowed_mentions: { parse: [] }, components: [] }),
            });
            if (channelDelivery.ok) return { ok: true, skipped: false, reason: "discord_restricted_channel_delivered" } as const;
            if (channelDelivery.status === 429 || channelDelivery.status >= 500) {
              retryableChannelFailure = `discord_restricted_channel_message_${channelDelivery.status}`;
            }
          } catch {
            retryableChannelFailure = "discord_restricted_channel_request_failed";
          }
        }
      }
    }
    const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient_id: row.recipient_discord_id }),
    });
    if (!channelResponse.ok) return { ok: false, skipped: false, reason: retryableChannelFailure ?? `discord_dm_channel_${channelResponse.status}` } as const;
    const channel = await channelResponse.json().catch(() => null) as { id?: unknown } | null;
    const channelId = typeof channel?.id === "string" && /^\d{5,32}$/.test(channel.id) ? channel.id : null;
    if (!channelId) return { ok: false, skipped: false, reason: retryableChannelFailure ?? "discord_dm_channel_invalid" } as const;
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
        components: [],
      }),
    });
    return response.ok
      ? { ok: true, skipped: false, reason: "discord_dm_delivered" } as const
      : { ok: false, skipped: false, reason: retryableChannelFailure ?? `discord_dm_message_${response.status}` } as const;
  } catch {
    return { ok: false, skipped: false, reason: retryableChannelFailure ?? "discord_dm_request_failed" } as const;
  }
}

function classifyResult(result: Awaited<ReturnType<typeof sendOwnerRequestDiscord>>, attemptCount: number) {
  if (result.ok && !result.skipped) return { status: "delivered", delay: "+0 minutes" } as const;
  if (result.ok && result.skipped) return { status: "skipped", delay: "+0 minutes" } as const;
  const statusCode = Number(result.reason.match(/_(\d{3})$/)?.[1] ?? 0);
  const retryable = result.reason === "discord_dm_request_failed"
    || result.reason === "discord_restricted_channel_request_failed"
    || statusCode === 429
    || statusCode >= 500;
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
