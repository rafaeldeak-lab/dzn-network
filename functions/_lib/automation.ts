import { requireDb } from "./db";
import {
  getAdmPullInterval,
  getPlanConfig,
  getPlanPriority,
  getServerStatusInterval,
  hasAutoPost,
  normalizePlanKey,
  type PlanKey,
} from "./plans";
import type { Env } from "./types";
import type { AutoPostType } from "../../lib/billing/plans";

export const ACTIVE_BILLING_STATUSES = ["active", "trialing"] as const;

export type AutomationSyncServer = {
  id: string;
  user_id: string;
  guild_id: string;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  current_players: number | null;
  max_players: number | null;
  player_count_last_checked_at: string | null;
  metadata_last_checked_at: string | null;
  player_count_status: string | null;
  plan_key: PlanKey;
  subscription_status: string;
  next_status_check_due_at: string | null;
  next_adm_pull_due_at: string | null;
};

export async function ensureAutomationSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of AUTOMATION_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function ensureAutomationRowsForLinkedServers(env: Env) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const rows = await db
    .prepare(
      `SELECT linked_servers.guild_id, linked_servers.server_name, linked_servers.display_name,
              linked_servers.hostname, linked_servers.nitrado_service_name, linked_servers.current_players,
              linked_servers.max_players, linked_servers.is_online, linked_servers.server_status,
              linked_servers.metadata_last_checked_at, linked_servers.player_count_last_checked_at,
              linked_servers.user_id, users.discord_id AS owner_discord_id,
              owner_billing_accounts.stripe_customer_id, owner_billing_accounts.stripe_subscription_id,
              owner_billing_accounts.plan_key, owner_billing_accounts.plan_status,
              owner_billing_accounts.current_period_start, owner_billing_accounts.current_period_end,
              owner_billing_accounts.cancel_at_period_end
       FROM linked_servers
       LEFT JOIN users ON users.id = linked_servers.user_id
       LEFT JOIN owner_billing_accounts ON owner_billing_accounts.discord_user_id = users.discord_id
       WHERE linked_servers.guild_id IS NOT NULL
         AND linked_servers.guild_id != ''
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .all<{
      guild_id: string;
      server_name: string | null;
      display_name: string | null;
      hostname: string | null;
      nitrado_service_name: string | null;
      current_players: number | null;
      max_players: number | null;
      is_online: number | null;
      server_status: string | null;
      metadata_last_checked_at: string | null;
      player_count_last_checked_at: string | null;
      owner_discord_id: string | null;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      plan_key: string | null;
      plan_status: string | null;
      current_period_start: string | null;
      current_period_end: string | null;
      cancel_at_period_end: number | null;
    }>();

  for (const row of rows.results ?? []) {
    const status = row.plan_status ?? "inactive";
    const planKey = normalizePlanKey(row.plan_key);
    await upsertServerSubscription(env, {
      guildId: row.guild_id,
      ownerDiscordId: row.owner_discord_id ?? "",
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripePriceId: null,
      planKey,
      status,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: Number(row.cancel_at_period_end ?? 0) === 1,
      forceDue: isActiveSubscriptionStatus(status),
    });
    await upsertServerPublicCache(env, {
      guildId: row.guild_id,
      planKey,
      publicServerName: firstString(row.display_name, row.hostname, row.server_name, row.nitrado_service_name),
      currentPlayers: row.current_players,
      maxPlayers: row.max_players,
      serverOnline: row.is_online,
      serverStatus: row.server_status,
      lastStatusUpdateAt: row.player_count_last_checked_at ?? row.metadata_last_checked_at,
    });
  }
}

export async function upsertServerSubscription(env: Env, input: {
  guildId: string;
  ownerDiscordId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  planKey: PlanKey;
  status: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  forceDue?: boolean;
}) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO server_subscriptions (
        id, guild_id, owner_discord_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        plan_key, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        owner_discord_id = excluded.owner_discord_id,
        stripe_customer_id = COALESCE(excluded.stripe_customer_id, server_subscriptions.stripe_customer_id),
        stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, server_subscriptions.stripe_subscription_id),
        stripe_price_id = COALESCE(excluded.stripe_price_id, server_subscriptions.stripe_price_id),
        plan_key = excluded.plan_key,
        status = excluded.status,
        current_period_start = COALESCE(excluded.current_period_start, server_subscriptions.current_period_start),
        current_period_end = COALESCE(excluded.current_period_end, server_subscriptions.current_period_end),
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.guildId,
      input.ownerDiscordId,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.stripePriceId ?? null,
      input.planKey,
      input.status,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ? 1 : 0,
      now,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO server_sync_state (
        id, guild_id, next_status_check_due_at, next_adm_pull_due_at, status_data_freshness,
        adm_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        next_status_check_due_at = CASE
          WHEN ? THEN ?
          ELSE COALESCE(server_sync_state.next_status_check_due_at, ?)
        END,
        next_adm_pull_due_at = CASE
          WHEN ? THEN ?
          ELSE COALESCE(server_sync_state.next_adm_pull_due_at, ?)
        END,
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.guildId,
      now,
      now,
      "unknown",
      "waiting_for_schedule",
      now,
      now,
      input.forceDue ? 1 : 0,
      now,
      now,
      input.forceDue ? 1 : 0,
      now,
      now,
    )
    .run();
}

export async function syncServerSubscriptionsForOwner(env: Env, discordUserId: string, values: {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  planKey: PlanKey;
  status: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}) {
  await ensureAutomationSchema(env);
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.guild_id
       FROM linked_servers
       JOIN users ON users.id = linked_servers.user_id
       WHERE users.discord_id = ?
         AND linked_servers.guild_id IS NOT NULL
         AND linked_servers.guild_id != ''
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')`,
    )
    .bind(discordUserId)
    .all<{ guild_id: string }>();

  for (const row of rows.results ?? []) {
    await upsertServerSubscription(env, {
      guildId: row.guild_id,
      ownerDiscordId: discordUserId,
      ...values,
      forceDue: isActiveSubscriptionStatus(values.status),
    });
  }
}

export async function getDueStatusAutomationServers(env: Env, maxServers: number): Promise<AutomationSyncServer[]> {
  await ensureAutomationRowsForLinkedServers(env);
  const now = new Date().toISOString();
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id, linked_servers.user_id, linked_servers.guild_id,
              linked_servers.nitrado_service_id, linked_servers.display_name, linked_servers.hostname,
              linked_servers.server_name, linked_servers.nitrado_service_name,
              linked_servers.current_players, linked_servers.max_players,
              linked_servers.player_count_last_checked_at, linked_servers.metadata_last_checked_at,
              linked_servers.player_count_status, server_subscriptions.plan_key,
              server_subscriptions.status AS subscription_status,
              server_sync_state.next_status_check_due_at, server_sync_state.next_adm_pull_due_at
       FROM linked_servers
       JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(server_subscriptions.status) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_checking_status, 0) = 0
         AND COALESCE(server_sync_state.next_status_check_due_at, '1970-01-01T00:00:00.000Z') <= ?
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY server_sync_state.next_status_check_due_at ASC, linked_servers.updated_at DESC
       LIMIT ?`,
    )
    .bind(now, maxServers)
    .all<AutomationSyncServer>();
  return (rows.results ?? []).sort((a, b) => getPlanPriority(b.plan_key) - getPlanPriority(a.plan_key));
}

export async function getAutomationContextForLinkedServer(env: Env, linkedServerId: string) {
  await ensureAutomationRowsForLinkedServers(env);
  const row = await requireDb(env)
    .prepare(
      `SELECT linked_servers.guild_id, server_subscriptions.plan_key, server_subscriptions.status
       FROM linked_servers
       LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ guild_id: string | null; plan_key: string | null; status: string | null }>();
  if (!row?.guild_id) return null;
  return {
    guildId: row.guild_id,
    planKey: normalizePlanKey(row.plan_key),
    subscriptionStatus: row.status ?? "inactive",
  };
}

export async function markStatusCheckStarted(env: Env, guildId: string) {
  await requireDb(env)
    .prepare("UPDATE server_sync_state SET currently_checking_status = 1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?")
    .bind(guildId)
    .run();
}

export async function recordStatusCheckResult(env: Env, values: {
  guildId: string;
  planKey: PlanKey;
  ok: boolean;
  currentPlayers?: number | null;
  maxPlayers?: number | null;
  serverOnline?: boolean | number | null;
  serverStatus?: string | null;
  error?: string | null;
}) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const nextDue = addMinutesIso(now, getServerStatusInterval(values.planKey));
  const freshness = values.ok ? "fresh" : "failed";
  await db
    .prepare(
      `UPDATE server_sync_state SET
        last_status_check_at = ?,
        next_status_check_due_at = ?,
        last_successful_status_check_at = CASE WHEN ? THEN ? ELSE last_successful_status_check_at END,
        last_failed_status_check_at = CASE WHEN ? THEN last_failed_status_check_at ELSE ? END,
        last_status_error = CASE WHEN ? THEN NULL ELSE ? END,
        current_player_count = COALESCE(?, current_player_count),
        max_player_count = COALESCE(?, max_player_count),
        server_online = COALESCE(?, server_online),
        server_status = COALESCE(?, server_status),
        status_data_freshness = ?,
        currently_checking_status = 0,
        updated_at = ?
       WHERE guild_id = ?`,
    )
    .bind(
      now,
      nextDue,
      values.ok ? 1 : 0,
      now,
      values.ok ? 1 : 0,
      now,
      values.ok ? 1 : 0,
      values.error ?? null,
      values.currentPlayers ?? null,
      values.maxPlayers ?? null,
      values.serverOnline === true || values.serverOnline === 1 ? 1 : values.serverOnline === false || values.serverOnline === 0 ? 0 : null,
      values.serverStatus ?? null,
      freshness,
      now,
      values.guildId,
    )
    .run();
}

export async function getDueAdmAutomationServers(env: Env, maxServers: number, minSyncIntervalMs: number): Promise<AutomationSyncServer[]> {
  await ensureAutomationRowsForLinkedServers(env);
  const now = new Date().toISOString();
  const rows = await requireDb(env)
    .prepare(
      `SELECT linked_servers.id, linked_servers.user_id, linked_servers.guild_id,
              linked_servers.nitrado_service_id, linked_servers.display_name, linked_servers.hostname,
              linked_servers.server_name, linked_servers.nitrado_service_name,
              linked_servers.current_players, linked_servers.max_players,
              linked_servers.player_count_last_checked_at, linked_servers.metadata_last_checked_at,
              linked_servers.player_count_status, server_subscriptions.plan_key,
              server_subscriptions.status AS subscription_status,
              server_sync_state.next_status_check_due_at, server_sync_state.next_adm_pull_due_at
       FROM linked_servers
       JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
       LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(server_subscriptions.status) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_syncing_adm, 0) = 0
         AND COALESCE(server_sync_state.next_adm_pull_due_at, '1970-01-01T00:00:00.000Z') <= ?
         AND (
           adm_sync_state.last_sync_at IS NULL
           OR (strftime('%s', 'now') - strftime('%s', adm_sync_state.last_sync_at)) * 1000 >= ?
         )
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY server_sync_state.next_adm_pull_due_at ASC, linked_servers.updated_at DESC
       LIMIT ?`,
    )
    .bind(now, minSyncIntervalMs, maxServers)
    .all<AutomationSyncServer>();
  return (rows.results ?? []).sort((a, b) => getPlanPriority(b.plan_key) - getPlanPriority(a.plan_key));
}

export async function markAdmPullStarted(env: Env, guildId: string) {
  await requireDb(env)
    .prepare("UPDATE server_sync_state SET currently_syncing_adm = 1, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?")
    .bind(guildId)
    .run();
}

export async function recordAdmPullResult(env: Env, values: {
  guildId: string;
  planKey: PlanKey;
  ok: boolean;
  status: string;
  error?: string | null;
  latestAdmFile?: string | null;
  processedAdmFile?: string | null;
  processedOffset?: number | null;
  newDataFound?: boolean;
}) {
  const now = new Date().toISOString();
  const nextDue = addMinutesIso(now, getAdmPullInterval(values.planKey));
  await requireDb(env)
    .prepare(
      `UPDATE server_sync_state SET
        last_adm_pull_at = ?,
        next_adm_pull_due_at = ?,
        last_successful_adm_pull_at = CASE WHEN ? THEN ? ELSE last_successful_adm_pull_at END,
        last_failed_adm_pull_at = CASE WHEN ? THEN last_failed_adm_pull_at ELSE ? END,
        last_adm_error = CASE WHEN ? THEN NULL ELSE ? END,
        last_seen_adm_filename = COALESCE(?, last_seen_adm_filename),
        last_processed_adm_filename = COALESCE(?, last_processed_adm_filename),
        last_processed_adm_offset = COALESCE(?, last_processed_adm_offset),
        last_new_adm_found_at = CASE WHEN ? THEN ? ELSE last_new_adm_found_at END,
        adm_status = ?,
        currently_syncing_adm = 0,
        manual_refresh_locked_until = ?,
        updated_at = ?
       WHERE guild_id = ?`,
    )
    .bind(
      now,
      nextDue,
      values.ok ? 1 : 0,
      now,
      values.ok ? 1 : 0,
      now,
      values.ok ? 1 : 0,
      values.error ?? null,
      values.latestAdmFile ?? null,
      values.processedAdmFile ?? null,
      values.processedOffset ?? null,
      values.newDataFound ? 1 : 0,
      now,
      normalizeAdmAutomationStatus(values.status),
      addMinutesIso(now, getPlanConfig(values.planKey).manual_adm_refresh_cooldown_minutes),
      now,
      values.guildId,
    )
    .run();
}

export async function upsertServerPublicCache(env: Env, input: {
  guildId: string;
  planKey: PlanKey;
  publicServerName?: string | null;
  currentPlayers?: number | null;
  maxPlayers?: number | null;
  serverOnline?: boolean | number | null;
  serverStatus?: string | null;
  leaderboardSnapshotJson?: string | null;
  eventSnapshotJson?: string | null;
  networkRank?: number | null;
  partnerFeatured?: boolean;
  lastStatusUpdateAt?: string | null;
  lastAdmUpdateAt?: string | null;
}) {
  await ensureAutomationSchema(env);
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT INTO server_public_cache (
        id, guild_id, plan_key, public_server_name, current_player_count, max_player_count,
        server_online, server_status, leaderboard_snapshot_json, event_snapshot_json, network_rank,
        partner_featured, last_status_update_at, last_adm_update_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        plan_key = excluded.plan_key,
        public_server_name = COALESCE(excluded.public_server_name, server_public_cache.public_server_name),
        current_player_count = COALESCE(excluded.current_player_count, server_public_cache.current_player_count),
        max_player_count = COALESCE(excluded.max_player_count, server_public_cache.max_player_count),
        server_online = COALESCE(excluded.server_online, server_public_cache.server_online),
        server_status = COALESCE(excluded.server_status, server_public_cache.server_status),
        leaderboard_snapshot_json = COALESCE(excluded.leaderboard_snapshot_json, server_public_cache.leaderboard_snapshot_json),
        event_snapshot_json = COALESCE(excluded.event_snapshot_json, server_public_cache.event_snapshot_json),
        network_rank = COALESCE(excluded.network_rank, server_public_cache.network_rank),
        partner_featured = excluded.partner_featured,
        last_status_update_at = COALESCE(excluded.last_status_update_at, server_public_cache.last_status_update_at),
        last_adm_update_at = COALESCE(excluded.last_adm_update_at, server_public_cache.last_adm_update_at),
        updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.guildId,
      input.planKey,
      input.publicServerName ?? null,
      input.currentPlayers ?? null,
      input.maxPlayers ?? null,
      input.serverOnline === true || input.serverOnline === 1 ? 1 : input.serverOnline === false || input.serverOnline === 0 ? 0 : null,
      input.serverStatus ?? null,
      input.leaderboardSnapshotJson ?? null,
      input.eventSnapshotJson ?? null,
      input.networkRank ?? null,
      input.partnerFeatured ? 1 : 0,
      input.lastStatusUpdateAt ?? null,
      input.lastAdmUpdateAt ?? null,
      now,
    )
    .run();
}

export async function queueDiscordPostUpdatesForGuild(env: Env, guildId: string, planKey: PlanKey, postTypes: AutoPostType[], reason: string) {
  await ensureAutomationSchema(env);
  const now = new Date().toISOString();
  for (const postType of postTypes) {
    if (!hasAutoPost(planKey, postType)) continue;
    await requireDb(env)
      .prepare(
        `INSERT OR IGNORE INTO automation_jobs (
          id, guild_id, job_type, post_type, status, attempts, max_attempts, last_error, run_after, created_at, updated_at
        ) VALUES (?, ?, 'discord-post-update', ?, 'queued', 0, 5, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), guildId, postType, reason, now, now, now)
      .run();
  }
}

export function isActiveSubscriptionStatus(status: string | null | undefined) {
  return ACTIVE_BILLING_STATUSES.includes((status ?? "").toLowerCase() as typeof ACTIVE_BILLING_STATUSES[number]);
}

export function addMinutesIso(value: string, minutes: number) {
  return new Date(Date.parse(value) + Math.max(0, minutes) * 60 * 1000).toISOString();
}

function normalizeAdmAutomationStatus(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "completed") return "new_data_found";
  if (normalized === "no_new_lines") return "no_new_log_available";
  if (normalized === "adm_not_generated_yet" || normalized === "no_adm_file") return "waiting_after_restart";
  if (normalized === "adm_file_unreadable") return "waiting_for_nitrado_log";
  return normalized;
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

const AUTOMATION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS server_subscriptions (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL UNIQUE,
    owner_discord_id TEXT NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    plan_key TEXT NOT NULL DEFAULT 'starter',
    status TEXT NOT NULL DEFAULT 'inactive',
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_subscriptions_owner_discord_id ON server_subscriptions(owner_discord_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_subscriptions_stripe_customer_id ON server_subscriptions(stripe_customer_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_subscriptions_stripe_subscription_id ON server_subscriptions(stripe_subscription_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_subscriptions_plan_status ON server_subscriptions(plan_key, status)",
  `CREATE TABLE IF NOT EXISTS server_sync_state (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL UNIQUE,
    last_status_check_at TEXT,
    next_status_check_due_at TEXT,
    last_successful_status_check_at TEXT,
    last_failed_status_check_at TEXT,
    last_status_error TEXT,
    current_player_count INTEGER,
    max_player_count INTEGER,
    server_online INTEGER,
    server_status TEXT,
    status_data_freshness TEXT,
    currently_checking_status INTEGER NOT NULL DEFAULT 0,
    last_adm_pull_at TEXT,
    next_adm_pull_due_at TEXT,
    last_successful_adm_pull_at TEXT,
    last_failed_adm_pull_at TEXT,
    last_adm_error TEXT,
    last_seen_adm_filename TEXT,
    last_seen_adm_modified_at TEXT,
    last_processed_adm_filename TEXT,
    last_processed_adm_offset INTEGER,
    last_new_adm_found_at TEXT,
    last_server_restart_at TEXT,
    adm_status TEXT,
    currently_syncing_adm INTEGER NOT NULL DEFAULT 0,
    manual_refresh_locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_due ON server_sync_state(next_status_check_due_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_due ON server_sync_state(next_adm_pull_due_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_lock ON server_sync_state(currently_checking_status)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_lock ON server_sync_state(currently_syncing_adm)",
  `CREATE TABLE IF NOT EXISTS server_posting_destinations (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    post_type TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL,
    discord_webhook_url TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    required_feature TEXT,
    min_plan_key TEXT,
    created_by_discord_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(guild_id, post_type)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_posting_destinations_guild_id ON server_posting_destinations(guild_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_posting_destinations_post_type ON server_posting_destinations(post_type)",
  `CREATE TABLE IF NOT EXISTS server_posting_state (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    post_type TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL,
    discord_message_id TEXT,
    last_posted_at TEXT,
    last_edited_at TEXT,
    last_payload_hash TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(guild_id, post_type, discord_channel_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_posting_state_guild_id ON server_posting_state(guild_id)",
  "CREATE INDEX IF NOT EXISTS idx_server_posting_state_post_type ON server_posting_state(post_type)",
  `CREATE TABLE IF NOT EXISTS server_public_cache (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL UNIQUE,
    plan_key TEXT NOT NULL DEFAULT 'starter',
    public_server_name TEXT,
    current_player_count INTEGER,
    max_player_count INTEGER,
    server_online INTEGER,
    server_status TEXT,
    leaderboard_snapshot_json TEXT,
    event_snapshot_json TEXT,
    network_rank INTEGER,
    partner_featured INTEGER NOT NULL DEFAULT 0,
    last_status_update_at TEXT,
    last_adm_update_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_public_cache_plan_key ON server_public_cache(plan_key)",
  "CREATE INDEX IF NOT EXISTS idx_server_public_cache_network_rank ON server_public_cache(network_rank)",
  `CREATE TABLE IF NOT EXISTS automation_jobs (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    post_type TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    run_after TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs(status, run_after)",
  "CREATE INDEX IF NOT EXISTS idx_automation_jobs_guild_type ON automation_jobs(guild_id, job_type)",
];
