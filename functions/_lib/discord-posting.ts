import { ensureAutomationSchema, isActiveSubscriptionStatus } from "./automation";
import { requireDb } from "./db";
import { getAdmPullInterval, getServerStatusInterval, hasAutoPost, normalizePlanKey } from "./plans";
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
  last_edited_at?: string | null;
  last_dispatch_attempt_at?: string | null;
  last_dispatch_status?: string | null;
  last_dispatch_error?: string | null;
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

export type DeliveryMode = "bot" | "webhook" | "not_configured";
export type PostingPermissionMode = DeliveryMode | "missing_permissions";
export type PostingPermissionCheck = {
  ok: boolean;
  mode: PostingPermissionMode;
  missing_permissions: string[];
  warning: string | null;
  checked_at: string | null;
};
export type DiscordDeliveryOperation = "edited" | "sent" | "none";
export type DiscordDeliveryResult = { mode: DeliveryMode; messageId: string | null; operation: DiscordDeliveryOperation };
export type DiscordPostDispatchStatus =
  | "success"
  | "sent"
  | "edited"
  | "skipped_unchanged"
  | "skipped_not_due"
  | "skipped_plan_locked"
  | "skipped_disabled"
  | "failed"
  | "no_message_id"
  | "queued";
export type DiscordPostDispatchDetail = {
  guild_id: string;
  post_type: AutoPostType;
  channel_id: string | null;
  status: DiscordPostDispatchStatus | "skipped";
  message_id: string | null;
  reason: string | null;
  old_payload_hash?: string | null;
  new_payload_hash?: string | null;
  last_edited_at?: string | null;
  message_state_found?: boolean;
};
export type DiscordPostingChannel = {
  channel_id: string;
  channel_name: string;
  channel_type: "text" | "announcement";
  category_name: string | null;
  position: number;
  category_position: number | null;
  can_view: boolean;
  can_send: boolean;
  can_embed: boolean;
  can_read_history: boolean;
  can_manage_messages: boolean;
  can_post: boolean;
  missing_permissions: string[];
  permission_source: DiscordPermissionSource;
  permission_diagnostics: DiscordPostingChannelPermissionDiagnostics;
};
export type DiscordPermissionSource =
  | "administrator"
  | "guild_roles"
  | "category_overwrite"
  | "channel_overwrite"
  | "member_overwrite"
  | "unknown";
export type DiscordPostingChannelPermissionDiagnostics = {
  selected_channel_id: string;
  selected_channel_name: string;
  bot_user_id: string | null;
  bot_role_ids: string[];
  bot_role_names: string[];
  bot_has_administrator: boolean;
  base_guild_permissions: string | null;
  effective_channel_permissions: string | null;
  permission_source: DiscordPermissionSource;
  missing_permissions: string[];
};
export type DiscordChannelFetchErrorCode =
  | "missing_bot_token"
  | "discord_api_403"
  | "bot_not_in_guild"
  | "discord_api_error"
  | "discord_api_invalid_response";

export class DiscordChannelFetchError extends Error {
  constructor(
    public readonly code: DiscordChannelFetchErrorCode,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "DiscordChannelFetchError";
  }
}

const DISCORD_CHANNEL_PERMISSION_WARNING =
  "DZN cannot auto-post here yet. Please give the bot permission to View Channel, Send Messages, Embed Links, and Read Message History.";
const DISCORD_PERMISSION_ONE = BigInt(1);
const DISCORD_ADMINISTRATOR_PERMISSION = DISCORD_PERMISSION_ONE << BigInt(3);
const REQUIRED_BOT_CHANNEL_PERMISSIONS = [
  ["View Channel", DISCORD_PERMISSION_ONE << BigInt(10)],
  ["Send Messages", DISCORD_PERMISSION_ONE << BigInt(11)],
  ["Embed Links", DISCORD_PERMISSION_ONE << BigInt(14)],
  ["Read Message History", DISCORD_PERMISSION_ONE << BigInt(16)],
] as const;
const OPTIONAL_BOT_CHANNEL_PERMISSIONS = [
  ["Manage Messages", DISCORD_PERMISSION_ONE << BigInt(13)],
] as const;
export const REQUIRED_BOT_PERMISSION_LABELS = REQUIRED_BOT_CHANNEL_PERMISSIONS.map(([label]) => label);
export const OPTIONAL_BOT_PERMISSION_LABELS = OPTIONAL_BOT_CHANNEL_PERMISSIONS.map(([label]) => label);

class DiscordDeliveryError extends Error {
  constructor(message: string, public readonly status: number, public readonly operation: "post" | "edit", public readonly mode: "bot" | "webhook") {
    super(message);
    this.name = "DiscordDeliveryError";
  }
}

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
  let edited = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const results: DiscordPostDispatchDetail[] = [];

  for (const job of jobs.results ?? []) {
    processed += 1;
    await db.prepare("UPDATE automation_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").bind(now, job.id).run();
    try {
      const result = await processPostJob(env, job);
      results.push(result);
      if (result.status === "edited") edited += 1;
      else if (result.status === "sent" || result.status === "success") sent += 1;
      else skipped += 1;
      await db.prepare("UPDATE automation_jobs SET status = 'completed', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), job.id).run();
    } catch (error) {
      failed += 1;
      results.push({
        guild_id: job.guild_id,
        post_type: job.post_type,
        channel_id: null,
        status: "failed",
        message_id: null,
        reason: error instanceof Error ? error.message : "Discord post update failed",
      });
      const nextAttempt = job.attempts + 1;
      const finalStatus = nextAttempt >= job.max_attempts ? "failed" : "queued";
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** nextAttempt) * 60 * 1000).toISOString();
      await db
        .prepare("UPDATE automation_jobs SET status = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?")
        .bind(finalStatus, error instanceof Error ? error.message : "Discord post update failed", retryAt, new Date().toISOString(), job.id)
        .run();
    }
  }

  const due = await processDuePostingDestinations(env, {
    maxJobs: Math.max(1, maxJobs - processed),
  });
  processed += due.processed;
  edited += due.edited;
  sent += due.sent;
  skipped += due.skipped;
  failed += due.failed;
  results.push(...due.results);

  const posted = edited + sent;
  console.log("DZN DISCORD AUTO POST DISPATCH READY", { processed, edited, sent, posted, skipped, failed });
  return { ok: true, processed, edited, sent, posted, skipped, failed, results };
}

async function processPostJob(env: Env, job: QueuedPostJob): Promise<DiscordPostDispatchDetail> {
  const db = requireDb(env);
  const subscription = await db
    .prepare("SELECT plan_key, status FROM server_subscriptions WHERE guild_id = ? LIMIT 1")
    .bind(job.guild_id)
    .first<{ plan_key: string | null; status: string | null }>();
  const planKey = normalizePlanKey(subscription?.plan_key);
  if (!isActiveSubscriptionStatus(subscription?.status) || !hasAutoPost(planKey, job.post_type)) {
    return {
      guild_id: job.guild_id,
      post_type: job.post_type,
      channel_id: null,
      status: "skipped_plan_locked",
      message_id: null,
      reason: "Subscription inactive or plan does not allow this auto-post type.",
    };
  }

  const destination = await db
    .prepare("SELECT guild_id, post_type, discord_channel_id, discord_webhook_url, enabled FROM server_posting_destinations WHERE guild_id = ? AND post_type = ? LIMIT 1")
    .bind(job.guild_id, job.post_type)
    .first<PostingDestination>();
  if (!destination) {
    return {
      guild_id: job.guild_id,
      post_type: job.post_type,
      channel_id: null,
      status: "skipped_disabled",
      message_id: null,
      reason: "No saved posting destination exists.",
    };
  }

  return processConfiguredPostingDestination(env, destination, planKey, { force: true });
}

async function processConfiguredPostingDestination(
  env: Env,
  destination: PostingDestination,
  planKey: string,
  options: { force?: boolean } = {},
): Promise<DiscordPostDispatchDetail> {
  if (Number(destination.enabled ?? 0) !== 1) {
    await recordPostingDispatchStatus(env, destination, "skipped_disabled", "Posting destination is disabled.");
    return {
      guild_id: destination.guild_id,
      post_type: destination.post_type,
      channel_id: destination.discord_channel_id,
      status: "skipped_disabled",
      message_id: null,
      reason: "Posting destination is disabled.",
    };
  }

  if (!hasAutoPost(planKey, destination.post_type)) {
    await recordPostingDispatchStatus(env, destination, "skipped_plan_locked", "Current plan does not allow this auto-post type.");
    return {
      guild_id: destination.guild_id,
      post_type: destination.post_type,
      channel_id: destination.discord_channel_id,
      status: "skipped_plan_locked",
      message_id: null,
      reason: "Current plan does not allow this auto-post type.",
    };
  }

  const db = requireDb(env);
  const cache = await db
    .prepare("SELECT * FROM server_public_cache WHERE guild_id = ? LIMIT 1")
    .bind(destination.guild_id)
    .first<PublicCache>();
  const payload = renderDiscordPostPayload(destination.post_type, cache, planKey);
  const payloadHash = await hashPayload(payload);
  const state = await db
    .prepare("SELECT discord_message_id, last_payload_hash, last_edited_at FROM server_posting_state WHERE guild_id = ? AND post_type = ? AND discord_channel_id = ? LIMIT 1")
    .bind(destination.guild_id, destination.post_type, destination.discord_channel_id)
    .first<PostingState>();
  const oldPayloadHash = state?.last_payload_hash ?? null;
  if (!options.force && state?.last_payload_hash === payloadHash) {
    await recordPostingDispatchStatus(env, destination, "skipped_unchanged", null);
    return {
      guild_id: destination.guild_id,
      post_type: destination.post_type,
      channel_id: destination.discord_channel_id,
      status: "skipped_unchanged",
      message_id: state.discord_message_id ?? null,
      reason: "Payload unchanged.",
      old_payload_hash: oldPayloadHash,
      new_payload_hash: payloadHash,
      last_edited_at: state.last_edited_at ?? null,
      message_state_found: true,
    };
  }

  try {
    const delivery = await deliverDiscordPayload(env, destination, payload, state?.discord_message_id ?? null);
    if (delivery.mode === "not_configured") {
      await recordPostingStateError(env, destination, "Configure the DZN bot token/channel permission or add a webhook URL.");
      return {
        guild_id: destination.guild_id,
        post_type: destination.post_type,
        channel_id: destination.discord_channel_id,
        status: "no_message_id",
        message_id: state?.discord_message_id ?? null,
        reason: "Configure the DZN bot token/channel permission or add a webhook URL.",
        old_payload_hash: oldPayloadHash,
        new_payload_hash: payloadHash,
        last_edited_at: state?.last_edited_at ?? null,
        message_state_found: Boolean(state),
      };
    }

    const lastEditedAt = new Date().toISOString();
    await recordDiscordPostingDeliveryState(env, destination, delivery, payloadHash, delivery.operation === "edited" ? "edited" : "sent", lastEditedAt);
    return {
      guild_id: destination.guild_id,
      post_type: destination.post_type,
      channel_id: destination.discord_channel_id,
      status: delivery.operation === "edited" ? "edited" : "sent",
      message_id: delivery.messageId,
      reason: state ? null : "no_message_state_found_for_destination",
      old_payload_hash: oldPayloadHash,
      new_payload_hash: payloadHash,
      last_edited_at: lastEditedAt,
      message_state_found: Boolean(state),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord post update failed";
    await recordPostingStateError(env, destination, message);
    throw error;
  }
}

async function processDuePostingDestinations(env: Env, options: { maxJobs: number; guildId?: string; force?: boolean }) {
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT destinations.guild_id, destinations.post_type, destinations.discord_channel_id,
              destinations.discord_webhook_url, destinations.enabled,
              subscriptions.plan_key, subscriptions.status AS subscription_status,
              state.last_edited_at
       FROM server_posting_destinations AS destinations
       JOIN server_subscriptions AS subscriptions ON subscriptions.guild_id = destinations.guild_id
       LEFT JOIN server_posting_state AS state
         ON state.guild_id = destinations.guild_id
        AND state.post_type = destinations.post_type
        AND state.discord_channel_id = destinations.discord_channel_id
       WHERE (? IS NULL OR destinations.guild_id = ?)
         AND lower(COALESCE(subscriptions.status, 'inactive')) IN ('active', 'trialing')
         AND COALESCE(destinations.enabled, 0) = 1
       ORDER BY COALESCE(state.last_edited_at, '1970-01-01T00:00:00.000Z') ASC
       LIMIT ?`,
    )
    .bind(options.guildId ?? null, options.guildId ?? null, Math.max(1, options.maxJobs * 4))
    .all<PostingDestination & { plan_key: string | null; subscription_status: string | null; last_edited_at: string | null }>();

  let processed = 0;
  let edited = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const results: DiscordPostDispatchDetail[] = [];

  for (const row of rows.results ?? []) {
    if (processed >= options.maxJobs) break;
    const planKey = normalizePlanKey(row.plan_key);
    if (!options.force && !isAutoPostDue(row.post_type, planKey, row.last_edited_at)) continue;
    processed += 1;
    try {
      const result = await processConfiguredPostingDestination(env, row, planKey, { force: options.force });
      results.push(result);
      if (result.status === "edited") edited += 1;
      else if (result.status === "sent" || result.status === "success") sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      results.push({
        guild_id: row.guild_id,
        post_type: row.post_type,
        channel_id: row.discord_channel_id,
        status: "failed",
        message_id: null,
        reason: error instanceof Error ? error.message : "Discord post update failed",
      });
    }
  }

  return { processed, edited, sent, posted: edited + sent, skipped, failed, results };
}

export async function dispatchDiscordPostsForGuild(env: Env, guildId: string, options: { maxJobs?: number; force?: boolean } = {}) {
  await ensureAutomationSchema(env);
  const maxJobs = Math.max(1, Math.min(Math.trunc(Number(options.maxJobs ?? 25)) || 25, 100));
  const result = await processDuePostingDestinations(env, { guildId, maxJobs, force: options.force ?? true });
  return {
    ok: result.failed === 0,
    processed: result.processed,
    edited: result.edited,
    sent: result.sent,
    posted: result.posted,
    skipped: result.skipped,
    failed: result.failed,
    results: result.results,
  };
}

export async function sendDiscordTestPost(env: Env, destination: {
  guild_id: string;
  post_type: AutoPostType;
  discord_channel_id: string;
  discord_webhook_url?: string | null;
}, existingMessageId: string | null = null) {
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
  }, payload, existingMessageId);
  if (result.mode === "not_configured") throw new Error("Configure the DZN bot token/channel permission or add a webhook URL.");
  return result;
}

export async function recordDiscordPostingDeliveryState(env: Env, destination: {
  guild_id: string;
  post_type: AutoPostType;
  discord_channel_id: string;
}, delivery: DiscordDeliveryResult, payloadHash: string | null = null, dispatchStatus: DiscordPostDispatchStatus = "success", checkedAt?: string) {
  if (delivery.mode === "not_configured") return;
  const now = checkedAt ?? new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_posting_state (
        id, guild_id, post_type, discord_channel_id, discord_message_id, last_posted_at,
        last_edited_at, last_payload_hash, last_error, last_dispatch_attempt_at,
        last_dispatch_status, last_dispatch_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)
      ON CONFLICT(guild_id, post_type, discord_channel_id) DO UPDATE SET
        discord_message_id = COALESCE(excluded.discord_message_id, server_posting_state.discord_message_id),
        last_posted_at = COALESCE(server_posting_state.last_posted_at, excluded.last_posted_at),
        last_edited_at = excluded.last_edited_at,
        last_payload_hash = excluded.last_payload_hash,
        last_error = NULL,
        last_dispatch_attempt_at = excluded.last_dispatch_attempt_at,
        last_dispatch_status = excluded.last_dispatch_status,
        last_dispatch_error = NULL,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      destination.guild_id,
      destination.post_type,
      destination.discord_channel_id,
      delivery.messageId,
      now,
      now,
      payloadHash,
      now,
      dispatchStatus,
      now,
      now,
    )
    .run();
}

export function classifyDiscordPostingError(error: unknown): PostingPermissionCheck {
  const checkedAt = new Date().toISOString();
  if (error instanceof DiscordDeliveryError && error.mode === "bot") {
    if (error.status === 401) {
      return {
        ok: false,
        mode: "not_configured",
        missing_permissions: [],
        warning: "DZN bot posting is not configured correctly. Check the bot token or provide a webhook fallback.",
        checked_at: checkedAt,
      };
    }
    if (error.status === 403 || error.status === 404) {
      return {
        ok: false,
        mode: "missing_permissions",
        missing_permissions: [...REQUIRED_BOT_PERMISSION_LABELS],
        warning: permissionWarning(REQUIRED_BOT_PERMISSION_LABELS),
        checked_at: checkedAt,
      };
    }
  }

  return {
    ok: false,
    mode: "not_configured",
    missing_permissions: [],
    warning: error instanceof Error ? error.message : "Discord test post failed.",
    checked_at: checkedAt,
  };
}

export function getPostingDeliveryMode(env: Env, destination: {
  discord_channel_id?: string | null;
  discord_webhook_url?: string | null;
}): DeliveryMode {
  if (env.DISCORD_BOT_TOKEN && destination.discord_channel_id) return "bot";
  if (destination.discord_webhook_url) return "webhook";
  return "not_configured";
}

export async function fetchDiscordPostingChannels(env: Env, guildId: string): Promise<DiscordPostingChannel[]> {
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!botToken) throw new DiscordChannelFetchError("missing_bot_token", "DISCORD_BOT_TOKEN is not configured in Cloudflare Pages.");
  const response = await fetchDiscordApi(botToken, `/guilds/${encodeURIComponent(guildId)}/channels`);
  if (!response.ok) {
    if (response.status === 403) throw new DiscordChannelFetchError("discord_api_403", "Discord returned 403 while fetching guild channels.", response.status);
    if (response.status === 404) throw new DiscordChannelFetchError("bot_not_in_guild", "DZN bot is not connected to this Discord server.", response.status);
    throw new DiscordChannelFetchError("discord_api_error", `Discord channel fetch failed with ${response.status}.`, response.status);
  }
  const channels = await response.json().catch(() => null) as DiscordChannel[] | null;
  if (!Array.isArray(channels)) {
    throw new DiscordChannelFetchError("discord_api_invalid_response", "Discord returned an unexpected channel response.");
  }
  const permissionContext = await getBotGuildPermissionContext(botToken, guildId);
  const categories = new Map<string, { name: string | null; position: number | null; channel: DiscordChannel }>(
    channels
      .filter((channel) => Number(channel.type) === 4 && typeof channel.name === "string")
      .map((channel) => [String(channel.id), { name: channel.name ?? null, position: numberOrNull(channel.position), channel }]),
  );

  return channels
    .filter((channel) => isPostableChannelType(channel.type) && typeof channel.id === "string")
    .map((channel) => {
      const category = typeof channel.parent_id === "string" ? categories.get(channel.parent_id) ?? null : null;
      const evaluation = permissionContext
        ? getChannelPermissionEvaluationFromContext(permissionContext, channel, category?.channel ?? null)
        : {
            permissions: parsePermissionBits(channel.permissions),
            source: "unknown" as const,
            botHasAdministrator: false,
          };
      const permissions = evaluation.permissions;
      const missing = getMissingRequiredBotPermissions(evaluation);
      const canManageMessages = permissions === null ? false : OPTIONAL_BOT_CHANNEL_PERMISSIONS.every(([, bit]) => (permissions & bit) === bit);
      const channelId = String(channel.id);
      const channelName = String(channel.name ?? "unknown-channel");
      return {
        channel_id: channelId,
        channel_name: channelName,
        channel_type: Number(channel.type) === 5 ? "announcement" as const : "text" as const,
        category_name: category?.name ?? null,
        position: numberOrNull(channel.position) ?? 0,
        category_position: category?.position ?? null,
        can_view: permissions === null ? true : !missing.includes("View Channel"),
        can_send: permissions === null ? true : !missing.includes("Send Messages"),
        can_embed: permissions === null ? true : !missing.includes("Embed Links"),
        can_read_history: permissions === null ? true : !missing.includes("Read Message History"),
        can_manage_messages: evaluation.botHasAdministrator || canManageMessages,
        can_post: evaluation.botHasAdministrator || permissions === null ? true : missing.length === 0,
        missing_permissions: missing,
        permission_source: evaluation.source,
        permission_diagnostics: buildChannelPermissionDiagnostics(channelId, channelName, permissionContext ?? null, evaluation, missing),
      };
    })
    .sort((a, b) =>
      (a.category_position ?? Number.MAX_SAFE_INTEGER) - (b.category_position ?? Number.MAX_SAFE_INTEGER)
      || a.position - b.position
      || a.channel_name.localeCompare(b.channel_name)
    );
}

export async function verifyDiscordPostingChannel(env: Env, guildId: string, channelId: string): Promise<DiscordPostingChannel | null> {
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (!botToken) return null;
  const response = await fetchDiscordApi(botToken, `/channels/${encodeURIComponent(channelId)}`);
  if (!response.ok) return null;
  const channel = await response.json().catch(() => null) as DiscordChannel | null;
  if (!channel || channel.guild_id !== guildId || !isPostableChannelType(channel.type)) return null;
  const permissionContext = await getBotGuildPermissionContext(botToken, guildId);
  const category = await getChannelParentCategory(botToken, guildId, channel);
  const evaluation = permissionContext
    ? getChannelPermissionEvaluationFromContext(permissionContext, channel, category)
    : {
        permissions: await getBotChannelPermissionBits(botToken, channel),
        source: "unknown" as const,
        botHasAdministrator: false,
      };
  const permissions = evaluation.permissions;
  const missing = getMissingRequiredBotPermissions(evaluation);
  const canManageMessages = permissions === null ? false : OPTIONAL_BOT_CHANNEL_PERMISSIONS.every(([, bit]) => (permissions & bit) === bit);
  const channelName = String(channel.name ?? "unknown-channel");
  return {
    channel_id: channelId,
    channel_name: channelName,
    channel_type: Number(channel.type) === 5 ? "announcement" : "text",
    category_name: typeof category?.name === "string" ? category.name : null,
    position: numberOrNull(channel.position) ?? 0,
    category_position: numberOrNull(category?.position),
    can_view: permissions === null ? true : !missing.includes("View Channel"),
    can_send: permissions === null ? true : !missing.includes("Send Messages"),
    can_embed: permissions === null ? true : !missing.includes("Embed Links"),
    can_read_history: permissions === null ? true : !missing.includes("Read Message History"),
    can_manage_messages: evaluation.botHasAdministrator || canManageMessages,
    can_post: evaluation.botHasAdministrator || permissions === null ? true : missing.length === 0,
    missing_permissions: missing,
    permission_source: evaluation.source,
    permission_diagnostics: buildChannelPermissionDiagnostics(channelId, channelName, permissionContext ?? null, evaluation, missing),
  };
}

export async function checkDiscordPostingPermissions(env: Env, destination: {
  discord_channel_id?: string | null;
  discord_webhook_url?: string | null;
}): Promise<PostingPermissionCheck> {
  const checkedAt = new Date().toISOString();
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (botToken && destination.discord_channel_id) {
    try {
      const response = await fetchDiscordApi(botToken, `/channels/${encodeURIComponent(destination.discord_channel_id)}`);
      if (!response.ok) {
        if (response.status === 401) {
          return {
            ok: Boolean(destination.discord_webhook_url),
            mode: destination.discord_webhook_url ? "webhook" : "not_configured",
            missing_permissions: [],
            warning: destination.discord_webhook_url ? null : "DZN bot posting is not configured correctly. Check the bot token or provide a webhook fallback.",
            checked_at: checkedAt,
          };
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
          mode: "missing_permissions",
          missing_permissions: ["View Channel"],
          warning: permissionWarning(["View Channel"]),
          checked_at: checkedAt,
        };
      }

      const channel = await response.json().catch(() => null) as DiscordChannel | null;
      const permissions = await getBotChannelPermissionBits(botToken, channel);
      if (permissions !== null) {
        const missing = REQUIRED_BOT_CHANNEL_PERMISSIONS
          .filter(([, bit]) => (permissions & bit) !== bit)
          .map(([label]) => label);
        if (missing.length > 0) {
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
            mode: "missing_permissions",
            missing_permissions: missing,
            warning: permissionWarning(missing),
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
        ok: Boolean(destination.discord_webhook_url),
        mode: destination.discord_webhook_url ? "webhook" : "missing_permissions",
        missing_permissions: destination.discord_webhook_url ? [] : ["View Channel"],
        warning: destination.discord_webhook_url ? null : permissionWarning(["View Channel"]),
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
): Promise<DiscordDeliveryResult> {
  const botToken = normalizeBotToken(env.DISCORD_BOT_TOKEN);
  if (botToken && destination.discord_channel_id) {
    try {
      const delivery = await sendOrEditWithBot(botToken, destination.discord_channel_id, payload, existingMessageId);
      return { mode: "bot", ...delivery };
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
    const delivery = await sendOrEditWithWebhook(destination.discord_webhook_url, payload, existingMessageId);
    return { mode: "webhook", ...delivery };
  }

  return { mode: "not_configured", messageId: null, operation: "none" };
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
    if (editResponse.ok) return { messageId, operation: "edited" as const };
    if (![403, 404].includes(editResponse.status)) {
      throw new DiscordDeliveryError(`Discord bot edit failed with ${editResponse.status}`, editResponse.status, "edit", "bot");
    }
    messageId = null;
  }

  const sendResponse = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(stripWebhookOnlyFields(payload)),
  });
  if (!sendResponse.ok) {
    throw new DiscordDeliveryError(`Discord bot post failed with ${sendResponse.status}`, sendResponse.status, "post", "bot");
  }
  const message = await sendResponse.json().catch(() => null) as { id?: string } | null;
  return { messageId: typeof message?.id === "string" ? message.id : null, operation: "sent" as const };
}

async function sendOrEditWithWebhook(webhookUrl: string, payload: DiscordPayload, existingMessageId: string | null) {
  let messageId = existingMessageId;
  if (messageId) {
    const editResponse = await fetch(`${webhookUrl}/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (editResponse.ok) return { messageId, operation: "edited" as const };
    if (editResponse.status !== 404) {
      throw new DiscordDeliveryError(`Discord webhook edit failed with ${editResponse.status}`, editResponse.status, "edit", "webhook");
    }
    messageId = null;
  }
  const sendResponse = await fetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!sendResponse.ok) {
    throw new DiscordDeliveryError(`Discord webhook post failed with ${sendResponse.status}`, sendResponse.status, "post", "webhook");
  }
  const message = await sendResponse.json().catch(() => null) as { id?: string } | null;
  return { messageId: typeof message?.id === "string" ? message.id : null, operation: "sent" as const };
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
        last_edited_at, last_payload_hash, last_error, last_dispatch_attempt_at,
        last_dispatch_status, last_dispatch_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 'failed', ?, ?, ?)
      ON CONFLICT(guild_id, post_type, discord_channel_id) DO UPDATE SET
        last_error = excluded.last_error,
        last_dispatch_attempt_at = excluded.last_dispatch_attempt_at,
        last_dispatch_status = excluded.last_dispatch_status,
        last_dispatch_error = excluded.last_dispatch_error,
        updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), destination.guild_id, destination.post_type, destination.discord_channel_id, message, now, message, now, now)
    .run();
}

async function recordPostingDispatchStatus(
  env: Env,
  destination: PostingDestination,
  status: DiscordPostDispatchStatus,
  error: string | null,
) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_posting_state (
        id, guild_id, post_type, discord_channel_id, discord_message_id, last_posted_at,
        last_edited_at, last_payload_hash, last_error, last_dispatch_attempt_at,
        last_dispatch_status, last_dispatch_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, post_type, discord_channel_id) DO UPDATE SET
        last_error = COALESCE(excluded.last_error, server_posting_state.last_error),
        last_dispatch_attempt_at = excluded.last_dispatch_attempt_at,
        last_dispatch_status = excluded.last_dispatch_status,
        last_dispatch_error = excluded.last_dispatch_error,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      destination.guild_id,
      destination.post_type,
      destination.discord_channel_id,
      error,
      now,
      status,
      error,
      now,
      now,
    )
    .run();
}

type DiscordChannel = {
  id?: string | null;
  name?: string | null;
  type?: number | string | null;
  guild_id?: string | null;
  parent_id?: string | null;
  position?: number | string | null;
  permissions?: string | number | null;
  permission_overwrites?: Array<{
    id: string;
    type: number | string;
    allow?: string | number | null;
    deny?: string | number | null;
  }>;
};

type BotPermissionContext = {
  botUserId: string;
  guildId: string;
  roleIds: Set<string>;
  roleNames: string[];
  basePermissions: bigint;
};

type PermissionOverwrite = NonNullable<DiscordChannel["permission_overwrites"]>[number];

type PermissionEvaluation = {
  permissions: bigint | null;
  source: DiscordPermissionSource;
  botHasAdministrator: boolean;
};

async function fetchDiscordApi(botToken: string, path: string) {
  return fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bot ${botToken}` },
  });
}

async function getBotChannelPermissionBits(botToken: string, channel: DiscordChannel | null): Promise<bigint | null> {
  const direct = parsePermissionBits(channel?.permissions);
  if (direct !== null) return direct;
  const guildId = typeof channel?.guild_id === "string" ? channel.guild_id : null;
  if (!guildId) return null;

  try {
    const context = await getBotGuildPermissionContext(botToken, guildId);
    return context ? getChannelPermissionEvaluationFromContext(context, channel).permissions : null;
  } catch {
    return null;
  }
}

async function getBotGuildPermissionContext(botToken: string, guildId: string): Promise<BotPermissionContext | null> {
  const meResponse = await fetchDiscordApi(botToken, "/users/@me");
  if (!meResponse.ok) return null;
  const me = await meResponse.json().catch(() => null) as { id?: string } | null;
  const botUserId = typeof me?.id === "string" ? me.id : null;
  if (!botUserId) return null;

  const [memberResponse, rolesResponse] = await Promise.all([
    fetchDiscordApi(botToken, `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(botUserId)}`),
    fetchDiscordApi(botToken, `/guilds/${encodeURIComponent(guildId)}/roles`),
  ]);
  if (!memberResponse.ok || !rolesResponse.ok) return null;
  const member = await memberResponse.json().catch(() => null) as { roles?: Array<string | number> } | null;
  const roles = await rolesResponse.json().catch(() => null) as Array<{ id?: string | number; name?: string | null; permissions?: string | number | null }> | null;
  if (!Array.isArray(roles)) return null;

  const roleIds = new Set(Array.isArray(member?.roles) ? member.roles.map(String) : []);
  let basePermissions = BigInt(0);
  const roleNames: string[] = [];
  for (const role of roles) {
    const roleId = typeof role.id === "string" || typeof role.id === "number" ? String(role.id) : null;
    if (roleId === guildId || (roleId && roleIds.has(roleId))) {
      basePermissions |= parsePermissionBits(role.permissions) ?? BigInt(0);
      if (roleId !== guildId && typeof role.name === "string" && role.name.trim()) {
        roleNames.push(role.name.trim());
      }
    }
  }
  return { botUserId, guildId, roleIds, roleNames, basePermissions };
}

function getChannelPermissionEvaluationFromContext(context: BotPermissionContext, channel: DiscordChannel | null, category: DiscordChannel | null = null): PermissionEvaluation {
  if (!channel) return { permissions: null, source: "unknown", botHasAdministrator: false };
  const botHasAdministrator = hasPermission(context.basePermissions, DISCORD_ADMINISTRATOR_PERMISSION);
  if (botHasAdministrator) {
    return {
      permissions: context.basePermissions | getRequiredBotPermissionBits() | getOptionalBotPermissionBits(),
      source: "administrator",
      botHasAdministrator: true,
    };
  }

  let permissions = context.basePermissions;
  let source: DiscordPermissionSource = "guild_roles";
  const categoryOverwrites = Array.isArray(category?.permission_overwrites) ? category.permission_overwrites : [];
  if (categoryOverwrites.length > 0) {
    const categoryResult = applyPermissionOverwritesForContext(permissions, categoryOverwrites, context, "category_overwrite");
    permissions = categoryResult.permissions;
    source = categoryResult.source;
  }

  const channelOverwrites = Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [];
  if (channelOverwrites.length > 0) {
    const channelResult = applyPermissionOverwritesForContext(permissions, channelOverwrites, context, "channel_overwrite");
    permissions = channelResult.permissions;
    if (channelResult.source !== "guild_roles") {
      source = channelResult.source;
    }
  }

  return { permissions, source, botHasAdministrator };
}

function applyPermissionOverwritesForContext(
  startingPermissions: bigint,
  overwrites: PermissionOverwrite[],
  context: BotPermissionContext,
  overwriteSource: "category_overwrite" | "channel_overwrite",
) {
  const everyoneOverwrite = overwrites.find((overwrite) => String(overwrite.id) === context.guildId && String(overwrite.type) === "0");
  let permissions = applyPermissionOverwrite(startingPermissions, everyoneOverwrite);
  let source: DiscordPermissionSource = everyoneOverwrite ? overwriteSource : "guild_roles";

  let roleAllow = BigInt(0);
  let roleDeny = BigInt(0);
  for (const overwrite of overwrites) {
    if (String(overwrite.type) !== "0" || !context.roleIds.has(String(overwrite.id))) continue;
    roleAllow |= parsePermissionBits(overwrite.allow) ?? BigInt(0);
    roleDeny |= parsePermissionBits(overwrite.deny) ?? BigInt(0);
  }
  if (roleAllow !== BigInt(0) || roleDeny !== BigInt(0)) {
    source = overwriteSource;
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  const memberOverwrite = overwrites.find((overwrite) => String(overwrite.id) === context.botUserId && String(overwrite.type) === "1");
  if (memberOverwrite) source = "member_overwrite";
  return {
    permissions: applyPermissionOverwrite(permissions, memberOverwrite),
    source,
  };
}

async function getChannelParentCategory(botToken: string, guildId: string, channel: DiscordChannel | null) {
  const parentId = typeof channel?.parent_id === "string" ? channel.parent_id : null;
  if (!parentId) return null;
  try {
    const response = await fetchDiscordApi(botToken, `/guilds/${encodeURIComponent(guildId)}/channels`);
    if (!response.ok) return null;
    const channels = await response.json().catch(() => null) as DiscordChannel[] | null;
    if (!Array.isArray(channels)) return null;
    return channels.find((item) => item.id === parentId && Number(item.type) === 4) ?? null;
  } catch {
    return null;
  }
}

function buildChannelPermissionDiagnostics(
  channelId: string,
  channelName: string,
  context: BotPermissionContext | null,
  evaluation: PermissionEvaluation,
  missingPermissions: string[],
): DiscordPostingChannelPermissionDiagnostics {
  return {
    selected_channel_id: channelId,
    selected_channel_name: channelName,
    bot_user_id: context?.botUserId ?? null,
    bot_role_ids: context ? [...context.roleIds] : [],
    bot_role_names: context?.roleNames ?? [],
    bot_has_administrator: evaluation.botHasAdministrator,
    base_guild_permissions: context ? context.basePermissions.toString() : null,
    effective_channel_permissions: evaluation.permissions?.toString() ?? null,
    permission_source: evaluation.source,
    missing_permissions: missingPermissions,
  };
}

function getMissingRequiredBotPermissions(evaluation: PermissionEvaluation) {
  if (evaluation.botHasAdministrator || evaluation.permissions === null) return [];
  return REQUIRED_BOT_CHANNEL_PERMISSIONS
    .filter(([, bit]) => (evaluation.permissions! & bit) !== bit)
    .map(([label]) => label);
}

function getRequiredBotPermissionBits() {
  return REQUIRED_BOT_CHANNEL_PERMISSIONS.reduce((bits, [, bit]) => bits | bit, BigInt(0));
}

function getOptionalBotPermissionBits() {
  return OPTIONAL_BOT_CHANNEL_PERMISSIONS.reduce((bits, [, bit]) => bits | bit, BigInt(0));
}

function isPostableChannelType(value: unknown) {
  const type = Number(value);
  return type === 0 || type === 5;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyPermissionOverwrite(
  permissions: bigint,
  overwrite?: { allow?: string | number | null; deny?: string | number | null } | null,
) {
  if (!overwrite) return permissions;
  const allow = parsePermissionBits(overwrite.allow) ?? BigInt(0);
  const deny = parsePermissionBits(overwrite.deny) ?? BigInt(0);
  return (permissions & ~deny) | allow;
}

function hasPermission(permissions: bigint, permission: bigint) {
  return (permissions & permission) === permission;
}

export function evaluateDiscordChannelPermissionsForTest(input: {
  guildId: string;
  botUserId: string;
  botRoleIds: string[];
  botRoleNames?: string[];
  basePermissions: string | number | bigint;
  channelId?: string;
  channelName?: string;
  channelPermissionOverwrites?: PermissionOverwrite[];
  categoryPermissionOverwrites?: PermissionOverwrite[];
}) {
  const context: BotPermissionContext = {
    guildId: input.guildId,
    botUserId: input.botUserId,
    roleIds: new Set(input.botRoleIds),
    roleNames: input.botRoleNames ?? [],
    basePermissions: parsePermissionBits(input.basePermissions) ?? BigInt(0),
  };
  const channel: DiscordChannel = {
    id: input.channelId ?? "channel",
    name: input.channelName ?? "channel",
    type: 0,
    permission_overwrites: input.channelPermissionOverwrites ?? [],
  };
  const category: DiscordChannel | null = input.categoryPermissionOverwrites
    ? { id: "category", name: "category", type: 4, permission_overwrites: input.categoryPermissionOverwrites }
    : null;
  const evaluation = getChannelPermissionEvaluationFromContext(context, channel, category);
  const missing = getMissingRequiredBotPermissions(evaluation);
  return {
    can_post: evaluation.botHasAdministrator || evaluation.permissions === null ? true : missing.length === 0,
    missing_permissions: missing,
    permission_source: evaluation.source,
    diagnostics: buildChannelPermissionDiagnostics(channel.id ?? "channel", channel.name ?? "channel", context, evaluation, missing),
  };
}

function permissionWarning(missing: readonly string[]) {
  return missing.length
    ? `${DISCORD_CHANNEL_PERMISSION_WARNING} Missing: ${missing.join(", ")}.`
    : DISCORD_CHANNEL_PERMISSION_WARNING;
}

function normalizeBotToken(value: string | undefined | null) {
  if (!value?.trim()) return null;
  return value.trim().replace(/^Bot\s+/i, "");
}

function parsePermissionBits(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function renderDiscordPostPayload(postType: AutoPostType, cache: PublicCache | null, planKey: string) {
  const now = new Date().toISOString();
  const serverName = cache?.public_server_name ?? "DZN Server";
  const current = numberOrUnknown(cache?.current_player_count);
  const max = numberOrUnknown(cache?.max_player_count);
  const status = cache?.server_status ?? (cache?.server_online ? "online" : "unknown");
  const lastStatusChecked = cache?.last_status_update_at ?? "waiting for status check";
  const planInterval = getServerStatusInterval(planKey);
  const admInterval = getAdmPullInterval(planKey);
  const title = postTitle(postType);
  const statusPost = postType === "basic_status_embed" || postType === "priority_status_embed";
  let embedTitle = statusPost ? `DZN Server Status - ${serverName}` : `${title} - ${serverName}`;
  let footerText = statusPost
    ? "DZN Network - Auto-updated from server status sync"
    : `DZN ${planKey.toUpperCase()} automation. Nitrado controls fresh log availability.`;
  let description: string;

  if (statusPost) {
    description = [
      `Server: ${serverName}`,
      `Status: ${status}`,
      `Players: ${current} / ${max}`,
      `Last checked: ${lastStatusChecked}`,
      `Data freshness: ${cache?.last_status_update_at ? "Fresh" : "Waiting for fresh server data"}`,
      `Plan: ${planKey.toUpperCase()}`,
      `Refresh interval: Every ${planInterval} minute${planInterval === 1 ? "" : "s"}`,
      `Updated at: ${now}`,
    ].join("\n");
  } else if (postType === "admin_logs_embed" || postType === "admin_alerts_embed") {
    const isLogs = postType === "admin_logs_embed";
    embedTitle = isLogs ? "DZN Admin Logs" : "DZN Admin Alerts";
    description = [
      isLogs ? "No new admin log events yet." : "No new admin alerts yet.",
      `Server: ${serverName}`,
      `Last checked: ${cache?.last_adm_update_at ?? now}`,
      `Plan: ${planKey.toUpperCase()}`,
      `ADM check interval: Every ${admInterval} minute${admInterval === 1 ? "" : "s"}`,
      "Auto-updated by DZN",
    ].join("\n");
    footerText = "DZN Network - Auto-updated from ADM automation";
  } else {
    description = [
      `Server: ${serverName}`,
      `Latest ADM update: ${cache?.last_adm_update_at ?? "waiting for ADM check"}`,
      `Network rank: ${cache?.network_rank ?? "pending"}`,
      `Plan: ${planKey.toUpperCase()}`,
      `Updated at: ${now}`,
    ].join("\n");
  }

  return {
    username: "DZN Network",
    embeds: [
      {
        title: embedTitle,
        description,
        color: postType === "priority_status_embed" ? 0xfacc15 : 0x8b5cf6,
        footer: { text: footerText },
        timestamp: now,
      },
    ],
  };
}

// Kept temporarily so older deployed payload snapshots can be compared during incident debugging.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function renderDiscordPostPayloadLegacy(postType: AutoPostType, cache: PublicCache | null, planKey: string) {
  const serverName = cache?.public_server_name ?? "DZN Server";
  const current = numberOrUnknown(cache?.current_player_count);
  const max = numberOrUnknown(cache?.max_player_count);
  const status = cache?.server_status ?? (cache?.server_online ? "online" : "unknown");
  const lastStatusChecked = cache?.last_status_update_at ?? "waiting for status check";
  const planInterval = getServerStatusInterval(planKey);
  const title = postTitle(postType);
  const description = postType === "basic_status_embed" || postType === "priority_status_embed"
    ? [
        `Server: ${serverName}`,
        `Status: ${status}`,
        `Players: ${current} / ${max}`,
        `Last checked: ${lastStatusChecked}`,
        `Data freshness: ${cache?.last_status_update_at ? "Fresh" : "Waiting for fresh server data"}`,
        `Plan: ${planKey.toUpperCase()}`,
        `Refresh interval: Every ${planInterval} minute${planInterval === 1 ? "" : "s"}`,
      ].join("\n")
    : `Latest ADM update: ${cache?.last_adm_update_at ?? "waiting for ADM check"}\nNetwork rank: ${cache?.network_rank ?? "pending"}`;
  return {
    username: "DZN Network",
    embeds: [
      {
        title: postType === "basic_status_embed" || postType === "priority_status_embed"
          ? `DZN Server Status - ${serverName}`
          : `${title} - ${serverName}`,
        description,
        color: postType === "priority_status_embed" ? 0xfacc15 : 0x8b5cf6,
        footer: {
          text: postType === "basic_status_embed" || postType === "priority_status_embed"
            ? "DZN Network • Auto-updated from server status sync"
            : `DZN ${planKey.toUpperCase()} automation. Nitrado controls fresh log availability.`,
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

function isAutoPostDue(postType: AutoPostType, planKey: string, lastEditedAt: string | null | undefined) {
  if (!lastEditedAt) return true;
  const editedAt = Date.parse(lastEditedAt);
  if (!Number.isFinite(editedAt)) return true;
  return Date.now() - editedAt >= getAutoPostIntervalMinutes(postType, planKey) * 60 * 1000;
}

function getAutoPostIntervalMinutes(postType: AutoPostType, planKey: string) {
  if (postType === "basic_status_embed" || postType === "priority_status_embed") {
    return getServerStatusInterval(planKey);
  }
  if (postType === "daily_summary_embed" || postType === "partner_featured_embed") {
    return 24 * 60;
  }
  return getAdmPullInterval(planKey);
}

async function hashPayload(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function numberOrUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown";
}
