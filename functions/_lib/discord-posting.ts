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
  if (!destination || Number(destination.enabled ?? 0) !== 1 || !destination.discord_webhook_url) return "skipped";

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

  const webhookUrl = destination.discord_webhook_url;
  let discordMessageId = state?.discord_message_id ?? null;
  if (discordMessageId) {
    const editResponse = await fetch(`${webhookUrl}/messages/${encodeURIComponent(discordMessageId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!editResponse.ok && editResponse.status !== 404) throw new Error(`Discord edit failed with ${editResponse.status}`);
    if (editResponse.status === 404) discordMessageId = null;
  }
  if (!discordMessageId) {
    const sendResponse = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!sendResponse.ok) throw new Error(`Discord post failed with ${sendResponse.status}`);
    const message = await sendResponse.json().catch(() => null) as { id?: string } | null;
    discordMessageId = typeof message?.id === "string" ? message.id : null;
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
    .bind(crypto.randomUUID(), job.guild_id, job.post_type, destination.discord_channel_id, discordMessageId, now, now, payloadHash, now, now)
    .run();
  return "posted";
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
