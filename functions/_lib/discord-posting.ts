import { ensureAutomationSchema, isActiveSubscriptionStatus } from "./automation";
import { requireDb } from "./db";
import { hasAutoPost, normalizePlanKey } from "./plans";
import type { Env } from "./types";
import type { AutoPostType } from "../../lib/billing/plans";

type QueuedPostJob = {
  id: string;
  guild_id: string;
  post_type: AutoPostType;
  attempts: number;
  max_attempts: number;
};

type PostingDestination = {
  guild_id: string;
  post_type: AutoPostType;
  discord_channel_id: string;
  discord_webhook_url: string | null;
  enabled: number;
};

type PostingState = {
  discord_message_id: string | null;
  last_payload_hash: string | null;
};

type PublicCache = {
  public_server_name: string | null;
  current_player_count: number | null;
  max_player_count: number | null;
  server_online: number | null;
  server_status: string | null;
  last_status_update_at: string | null;
  last_adm_update_at: string | null;
  network_rank: number | null;
};

type DiscordPayload = ReturnType<typeof renderDiscordPostPayload>;

type DeliveryMode = "bot" | "webhook" | "not_configured";
export type PostingPermissionMode = DeliveryMode | "missing_permissions";
export type PostingPermissionCheck = {
  ok: boolean;
  mode: PostingPermissionMode;
  missing_permissions: string[];
  warning: string | null;
  checked_at: string | null;
};

const DISCORD_CHANNEL_PERMISSION_WARNING =
  "DZN cannot auto-post here yet. Please give the bot permission to View Channel, Send Messages, Embed Links, and Read Message History.";
const DISCORD_PERMISSION_ONE = BigInt(1);
const REQUIRED_BOT_CHANNEL_PERMISSIONS = [
  ["View Channel", DISCORD_PERMISSION_ONE << BigInt(10)],
  ["Send Messages", DISCORD_PERMISSION_ONE << BigInt(11)],
  ["Manage Messages", DISCORD_PERMISSION_ONE << BigInt(13)],
  ["Embed Links", DISCORD_PERMISSION_ONE << BigInt(14)],
  ["Read Message History", DISCORD_PERMISSION_ONE << BigInt(16)],
] as const;

export async function dispatchQueuedDiscordPostUpdates(env: Env, options: { maxJobs?: number } = {}) {
  await ensureAutomationSchema(env);
  const maxJobs = Math.max(1, Math.min(Math.trunc(Number(options.maxJobs ?? 25)) || 25, 100));
  const db = requireDb(env);
  const now = new Date().toISOString();
  const jobs = await db
    .prepare(
      `SELECT id, guild_id, post_type, attempts, max_attempts
       FROM automation_jobs
       WHERE status = 'queued'
         AND job_type = 'discord-post-update'
         AND post_type IS NOT NULL
         AND run_after <= ?
       ORDER BY run_after ASC, created_at ASC
       LIMIT ?`,
    )
    .bind(now, maxJobs)
    .all<QueuedPostJob>();

  let processed = 0;
  let posted = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs.results ?? []) {
    processed += 1;
    await db.prepare("UPDATE automation_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").bind(now, job.id).run();
    try {
      const result = await processPostJob(env, job);
      if (result === "posted") posted += 1;
      else skipped += 1;
      await db.prepare("UPDATE automation_jobs SET status = 'completed', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), job.id).run();
    } catch (error) {
      failed += 1;
      const nextAttempt = job.attempts + 1;
      const finalStatus = nextAttempt >= job.max_attempts ? "failed" : "queued";
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** nextAttempt) * 60 * 1000).toISOString();
      await db
        .prepare("UPDATE automation_jobs SET status = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?")
        .bind(finalStatus, error instanceof Error ? error.message : "Discord post update failed", retryAt, new Date().toISOString(), job.id)
        .run();
    }
  }

  console.log("DZN DISCORD AUTO POST DISPATCH READY", { processed, posted, skipped, failed });
  return { ok: true, processed, posted, skipped, failed };
}

async function processPostJob(env: Env, job: QueuedPostJob): Promise<"posted" | "skipped"> {
  const db = requireDb(env);
  const subscription = await db
    .prepare("SELECT plan_key, status FROM server_subscriptions WHERE guild_id = ? LIMIT 1")
    .bind(job.guild_id)
    .first<{ plan_key: string | null; status: string | null }>();
  const planKey = normalizePlanKey(subscription?.plan_key);
  if (!isActiveSubscriptionStatus(subscription?.status) || !hasAutoPost(planKey, job.post_type)) return "skipped";

  const destination = await db
    .prepare("SELECT guild_id, post_type, discord_channel_id, discord_webhook_url, enabled FROM server_posting_destinations WHERE guild_id = ? AND post_type = ? LIMIT 1")
    .bind(job.guild_id, job.post_type)
    .first<PostingDestination>();
  if (!destination || Number(destination.enabled ?? 0) !== 1) return "skipped";

  const cache = await db
    .prepare("SELECT * FROM server_public_cache WHERE guild_id = ? LIMIT 1")
    .bind(job.guild_id)
    .first<PublicCache>();
  const payload = renderDiscordPostPayload(job.post_type, cache, planKey);
  const payloadHash = await hashPayload(payload);
  const state = await db
    .prepare("SELECT discord_message_id, last_payload_hash FROM server_posting_state WHERE guild_id = ? AND post_type = ? AND discord_channel_id = ? LIMIT 1")
    .bind(job.guild_id, job.post_type, destination.discord_channel_id)
    .first<PostingState>();
  if (state?.last_payload_hash === payloadHash) return "skipped";

  const delivery = await deliverDiscordPayload(env, destination, payload, state?.discord_message_id ?? null);
  if (delivery.mode === "not_configured") {
    await recordPostingStateError(env, destination, "Configure the DZN bot token/channel permission or add a webhook URL.");
    return "skipped";
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO server_posting_state (
        id, guild_id, post_type, discord_channel_id, discord_message_id, last_posted_at,
        last_edited_at, last_payload_hash, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(guild_id, post_type, discord_channel_id) DO UPDATE SET
        discord_message_id = COALESCE(excluded.discord_message_id, server_posting_state.discord_message_id),
        last_edited_at = excluded.last_edited_at,
        last_payload_hash = excluded.last_payload_hash,
        last_error = NULL,
        updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), job.guild_id, job.post_type, destination.discord_channel_id, delivery.messageId, now, now, payloadHash, now, now)
    .run();
  return "posted";
}

export async function sendDiscordTestPost(env: Env, destination: {
  guild_id: string;
  post_type: AutoPostType;
  discord_channel_id: string;
  discord_webhook_url?: string | null;
}) {
  const payload = {
    username: "DZN Network",
    embeds: [
      {
        title: `DZN Test - ${postTitle(destination.post_type)}`,
        description: "This channel is ready for DZN automatic updates.",
        color: 0x22d3ee,
        footer: { text: "DZN automation test post" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const result = await deliverDiscordPayload(env, {
    guild_id: destination.guild_id,
    post_type: destination.post_type,
    discord_channel_id: destination.discord_channel_id,
    discord_webhook_url: destination.discord_webhook_url ?? null,
    enabled: 1,
  }, payload, null);
  if (result.mode === "not_configured") throw new Error("Configure the DZN bot token/channel permission or add a webhook URL.");
  return result;
}

export function getPostingDeliveryMode(env: Env, destination: {
  discord_channel_id?: string | null;
  discord_webhook_url?: string | null;
}): DeliveryMode {
  if (env.DISCORD_BOT_TOKEN && destination.discord_channel_id) return "bot";
  if (destination.discord_webhook_url) return "webhook";
  return "not_configured";
}

export async function checkDiscordPostingPermissions(env: Env, destination: {
  discord_channel_id?: string | null;
  discord_webhook_url?: string | null;
}): Promise<PostingPermissionCheck> {
  const checkedAt = new Date().toISOString();
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (botToken && destination.discord_channel_id) {
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(destination.discord_channel_id)}`, {
        headers: { authorization: `Bot ${botToken}` },
      });
      if (!response.ok) {
        return {
          ok: false,
          mode: "missing_permissions",
          missing_permissions: ["View Channel"],
          warning: DISCORD_CHANNEL_PERMISSION_WARNING,
          checked_at: checkedAt,
        };
      }

      const channel = await response.json().catch(() => null) as { permissions?: string | number | null } | null;
      const permissions = parsePermissionBits(channel?.permissions);
      if (permissions !== null) {
        const missing = REQUIRED_BOT_CHANNEL_PERMISSIONS
          .filter(([, bit]) => (permissions & bit) !== bit)
          .map(([label]) => label);
        if (missing.length > 0) {
          return {
            ok: false,
            mode: "missing_permissions",
            missing_permissions: missing,
            warning: DISCORD_CHANNEL_PERMISSION_WARNING,
            checked_at: checkedAt,
          };
        }
      }

      return {
        ok: true,
        mode: "bot",
        missing_permissions: [],
        warning: null,
        checked_at: checkedAt,
      };
    } catch {
      return {
        ok: false,
        mode: destination.discord_webhook_url ? "webhook" : "missing_permissions",
        missing_permissions: ["View Channel"],
        warning: destination.discord_webhook_url
          ? "DZN bot permission check failed. Webhook fallback is configured."
          : DISCORD_CHANNEL_PERMISSION_WARNING,
        checked_at: checkedAt,
      };
    }
  }

  if (destination.discord_webhook_url) {
    return {
      ok: true,
      mode: "webhook",
      missing_permissions: [],
      warning: null,
      checked_at: checkedAt,
    };
  }

  return {
    ok: false,
    mode: "not_configured",
    missing_permissions: [],
    warning: "Add a Discord channel ID for bot mode or a webhook fallback before enabling automatic posts.",
    checked_at: checkedAt,
  };
}

async function deliverDiscordPayload(
  env: Env,
  destination: PostingDestination,
  payload: DiscordPayload,
  existingMessageId: string | null,
): Promise<{ mode: DeliveryMode; messageId: string | null }> {
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (botToken && destination.discord_channel_id) {
    try {
      const messageId = await sendOrEditWithBot(botToken, destination.discord_channel_id, payload, existingMessageId);
      return { mode: "bot", messageId };
    } catch (error) {
      if (!destination.discord_webhook_url) throw error;
      console.warn("DZN DISCORD BOT POST FAILED, WEBHOOK FALLBACK", {
        guildId: destination.guild_id,
        postType: destination.post_type,
        message: error instanceof Error ? error.message : "Discord bot post failed",
      });
    }
  }

  if (destination.discord_webhook_url) {
    const messageId = await sendOrEditWithWebhook(destination.discord_webhook_url, payload, existingMessageId);
    return { mode: "webhook", messageId };
  }

  return { mode: "not_configured", messageId: null };
}

async function sendOrEditWithBot(
  botToken: string,
  channelId: string,
  payload: DiscordPayload,
  existingMessageId: string | null,
) {
  const headers = {
    authorization: `Bot ${botToken}`,
    "content-type": "application/json",
  };
  let messageId = existingMessageId;
  if (messageId) {
    const editResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(stripWebhookOnlyFields(payload)),
    });
    if (editResponse.ok) return messageId;
    if (![403, 404].includes(editResponse.status)) throw new Error(`Discord bot edit failed with ${editResponse.status}`);
    messageId = null;
  }

  const sendResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(stripWebhookOnlyFields(payload)),
  });
  if (!sendResponse.ok) throw new Error(`Discord bot post failed with ${sendResponse.status}`);
  const message = await sendResponse.json().catch(() => null) as { id?: string } | null;
  return typeof message?.id === "string" ? message.id : null;
}

async function sendOrEditWithWebhook(webhookUrl: string, payload: DiscordPayload, existingMessageId: string | null) {
  let messageId = existingMessageId;
  if (messageId) {
    const editResponse = await fetch(`${webhookUrl}/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (editResponse.ok) return messageId;
    if (editResponse.status !== 404) throw new Error(`Discord webhook edit failed with ${editResponse.status}`);
    messageId = null;
  }
  const sendResponse = await fetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!sendResponse.ok) throw new Error(`Discord webhook post failed with ${sendResponse.status}`);
  const message = await sendResponse.json().catch(() => null) as { id?: string } | null;
  return typeof message?.id === "string" ? message.id : null;
}

function stripWebhookOnlyFields(payload: DiscordPayload) {
  const { username: _username, ...rest } = payload;
  void _username;
  return rest;
}

async function recordPostingStateError(env: Env, destination: PostingDestination, message: string) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_posting_state (
        id, guild_id, post_type, discord_channel_id, discord_message_id, last_posted_at,
        last_edited_at, last_payload_hash, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
      ON CONFLICT(guild_id, post_type, discord_channel_id) DO UPDATE SET
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), destination.guild_id, destination.post_type, destination.discord_channel_id, message, now, now)
    .run();
}

function normalizeBotToken(value: string | undefined | null) {
  if (!value?.trim()) return null;
  return value.trim().replace(/^Bot\s+/i, "");
}

function parsePermissionBits(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function renderDiscordPostPayload(postType: AutoPostType, cache: PublicCache | null, planKey: string) {
  const serverName = cache?.public_server_name ?? "DZN Server";
  const current = numberOrUnknown(cache?.current_player_count);
  const max = numberOrUnknown(cache?.max_player_count);
  const status = cache?.server_status ?? (cache?.server_online ? "online" : "unknown");
  const title = postTitle(postType);
  const description = postType === "basic_status_embed" || postType === "priority_status_embed"
    ? `Status: ${status}\nPlayers: ${current} / ${max}\nLast checked: ${cache?.last_status_update_at ?? "waiting for status check"}`
    : `Latest ADM update: ${cache?.last_adm_update_at ?? "waiting for ADM check"}\nNetwork rank: ${cache?.network_rank ?? "pending"}`;
  return {
    username: "DZN Network",
    embeds: [
      {
        title: `${title} - ${serverName}`,
        description,
        color: postType === "priority_status_embed" ? 0xfacc15 : 0x8b5cf6,
        footer: {
          text: `DZN ${planKey.toUpperCase()} automation. Nitrado controls fresh log availability.`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function postTitle(postType: AutoPostType) {
  return postType
    .replace(/_embed$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function hashPayload(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function numberOrUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown";
}
