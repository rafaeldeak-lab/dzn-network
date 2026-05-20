import { requireDb } from "./db";
import {
  getAdmDiscoveryIntervalMinutes,
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
export const AUTOMATION_CRON_SOURCES = ["cloudflare", "github-backup", "manual"] as const;
export const AUTOMATION_CRON_MIGRATION_NAME = "0016_automation_cron_runs.sql";
export const AUTOMATION_CRON_METRICS_MIGRATION_NAME = "0024_cron_run_metrics.sql";
export const AUTOMATION_MIGRATION_WARNING =
  "Automation is running, but D1 migration history needs attention. Rerun npm run db:migrate:remote once Cloudflare account permissions are fixed.";

export type AutomationCronSource = typeof AUTOMATION_CRON_SOURCES[number];
export type AutomationCronJobType = "metadata" | "adm" | "discord-posts";
export type AutomationCronStatus = "started" | "success" | "failed" | "partial";

type AutomationCronRunRow = {
  source: string | null;
  job_type: string | null;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
  error_message: string | null;
  duration_ms: number | null;
  processed_count: number | null;
  skipped_count: number | null;
  failed_count: number | null;
};

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
  next_adm_discovery_due_at: string | null;
  next_adm_pull_due_at: string | null;
  newest_available_adm_filename?: string | null;
  newest_available_adm_timestamp?: string | null;
  newest_readable_adm_filename?: string | null;
  newest_readable_adm_timestamp?: string | null;
  observed_adm_cadence_minutes?: number | null;
  last_playerlist_at?: string | null;
  last_useful_adm_event_at?: string | null;
};

export async function ensureAutomationSchema(env: Env) {
  const db = requireDb(env);
  for (const statement of AUTOMATION_SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
  await ensureServerSyncStateAdmColumns(db);
  await ensureAutomationCronRunsColumns(db);
  await ensureServerPostingStateDispatchColumns(db);
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

export function normalizeAutomationCronSource(source: unknown, cron?: unknown): AutomationCronSource {
  const explicit = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (explicit === "cloudflare" || explicit === "github-backup" || explicit === "manual") return explicit;
  const cronValue = typeof cron === "string" ? cron.trim().toLowerCase() : "";
  if (cronValue.includes("github")) return "github-backup";
  if (cronValue.includes("cloudflare") || cronValue === "* * * * *") return "cloudflare";
  return "manual";
}

export async function recordAutomationCronRun(env: Env, input: {
  source: AutomationCronSource;
  jobType: AutomationCronJobType;
  status: AutomationCronStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  processedCount?: number | null;
  skippedCount?: number | null;
  failedCount?: number | null;
}) {
  await ensureAutomationSchema(env);
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? now;
  const finishedAt = input.finishedAt ?? now;
  const durationMs = input.durationMs ?? durationBetween(startedAt, finishedAt);
  await requireDb(env)
    .prepare(
      `INSERT INTO automation_cron_runs (
        id, source, endpoint, job_type, started_at, finished_at, status, error_message,
        duration_ms, processed_count, skipped_count, failed_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.source,
      input.jobType,
      input.jobType,
      startedAt,
      finishedAt,
      input.status,
      input.errorMessage ?? null,
      durationMs,
      nullableInteger(input.processedCount),
      nullableInteger(input.skippedCount),
      nullableInteger(input.failedCount),
      now,
    )
    .run();
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
        id, guild_id, next_status_check_due_at, next_adm_discovery_due_at, next_adm_pull_due_at, status_data_freshness,
        adm_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        next_status_check_due_at = CASE
          WHEN ? THEN ?
          ELSE COALESCE(server_sync_state.next_status_check_due_at, ?)
        END,
        next_adm_discovery_due_at = CASE
          WHEN ? THEN ?
          ELSE COALESCE(server_sync_state.next_adm_discovery_due_at, ?)
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
  await recoverStuckAutomationLocks(env);
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
              server_sync_state.next_status_check_due_at, server_sync_state.next_adm_discovery_due_at,
              server_sync_state.next_adm_pull_due_at
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
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare("UPDATE server_sync_state SET currently_checking_status = 1, status_sync_started_at = ?, updated_at = ? WHERE guild_id = ?")
    .bind(now, now, guildId)
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
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const nextDue = addMinutesIso(now, getServerStatusInterval(values.planKey));
  const freshness = values.ok ? "fresh" : "failed";
  const restartDetected = values.ok && isRestartLikeServerStatus(values.serverStatus);
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
        last_server_restart_at = CASE WHEN ? THEN ? ELSE last_server_restart_at END,
        last_restart_detected_source = CASE WHEN ? THEN 'metadata_status' ELSE last_restart_detected_source END,
        last_restart_detected_at = CASE WHEN ? THEN ? ELSE last_restart_detected_at END,
        currently_checking_status = 0,
        status_sync_started_at = NULL,
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
      restartDetected ? 1 : 0,
      now,
      restartDetected ? 1 : 0,
      restartDetected ? 1 : 0,
      now,
      now,
      values.guildId,
    )
    .run();
}

export async function getDueAdmAutomationServers(env: Env, maxServers: number, minSyncIntervalMs: number): Promise<AutomationSyncServer[]> {
  await ensureAutomationRowsForLinkedServers(env);
  await recoverStuckAutomationLocks(env);
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
              server_sync_state.next_status_check_due_at, server_sync_state.next_adm_discovery_due_at,
              server_sync_state.next_adm_pull_due_at,
              server_sync_state.newest_available_adm_filename, server_sync_state.newest_available_adm_timestamp,
              server_sync_state.newest_readable_adm_filename, server_sync_state.newest_readable_adm_timestamp
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

export async function getDueAdmDiscoveryAutomationServers(env: Env, maxServers: number): Promise<AutomationSyncServer[]> {
  await ensureAutomationRowsForLinkedServers(env);
  await recoverStuckAutomationLocks(env);
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
              server_sync_state.next_status_check_due_at, server_sync_state.next_adm_discovery_due_at,
              server_sync_state.next_adm_pull_due_at,
              server_sync_state.newest_available_adm_filename, server_sync_state.newest_available_adm_timestamp,
              server_sync_state.newest_readable_adm_filename, server_sync_state.newest_readable_adm_timestamp
       FROM linked_servers
       JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
       JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(server_subscriptions.status) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_syncing_adm, 0) = 0
         AND COALESCE(server_sync_state.next_adm_discovery_due_at, '1970-01-01T00:00:00.000Z') <= ?
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY server_sync_state.next_adm_discovery_due_at ASC, linked_servers.updated_at DESC
       LIMIT ?`,
    )
    .bind(now, maxServers)
    .all<AutomationSyncServer>();
  return (rows.results ?? []).sort((a, b) => getPlanPriority(b.plan_key) - getPlanPriority(a.plan_key));
}

export async function markAdmPullStarted(env: Env, guildId: string) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare("UPDATE server_sync_state SET currently_syncing_adm = 1, adm_sync_started_at = ?, updated_at = ? WHERE guild_id = ?")
    .bind(now, now, guildId)
    .run();
}

export async function recordAdmDiscoveryResult(env: Env, values: {
  guildId: string;
  planKey: PlanKey;
  ok: boolean;
  status: string;
  error?: string | null;
  newestAvailableAdmFile?: string | null;
  newestAvailableAdmTimestamp?: string | null;
  newestReadableAdmFile?: string | null;
  newestReadableAdmTimestamp?: string | null;
}) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const nextDue = addMinutesIso(now, getAdmDiscoveryIntervalMinutes(values.planKey));
  const currentState = await db
    .prepare(
      `SELECT last_seen_adm_filename, last_server_restart_at, first_adm_after_restart_at
       FROM server_sync_state
       WHERE guild_id = ?
       LIMIT 1`,
    )
    .bind(values.guildId)
    .first<{ last_seen_adm_filename: string | null; last_server_restart_at: string | null; first_adm_after_restart_at: string | null }>()
    .catch(() => null);
  const newestAvailableFile = values.newestAvailableAdmFile ?? null;
  const newestAvailableTimestamp = values.newestAvailableAdmTimestamp ?? null;
  const restartFromAdmFile = detectAdmRestartFromAdmFilenames(currentState?.last_seen_adm_filename ?? null, newestAvailableFile);
  const restartAt = restartFromAdmFile
    ? newestAvailableTimestamp ?? now
    : currentState?.last_server_restart_at ?? null;
  const normalizedStatus = normalizeAdmAutomationStatus(values.status, {
    latestAdmFile: newestAvailableFile,
    lastServerRestartAt: restartAt,
  });
  const firstAdmAfterRestartAt = getFirstObservationAfterRestart(
    currentState?.first_adm_after_restart_at ?? null,
    restartAt,
    newestAvailableTimestamp ?? values.newestReadableAdmTimestamp ?? null,
  );
  const firstAdmDelayMinutes = firstAdmAfterRestartAt && restartAt ? minutesBetweenIso(restartAt, firstAdmAfterRestartAt) : null;

  await db
    .prepare(
      `UPDATE server_sync_state SET
        last_adm_discovery_check_at = ?,
        next_adm_discovery_due_at = ?,
        last_successful_adm_discovery_at = CASE WHEN ? THEN ? ELSE last_successful_adm_discovery_at END,
        last_failed_adm_discovery_at = CASE WHEN ? THEN last_failed_adm_discovery_at ELSE ? END,
        last_adm_discovery_error = CASE WHEN ? THEN NULL ELSE ? END,
        adm_discovery_status = ?,
        last_seen_adm_filename = COALESCE(?, last_seen_adm_filename),
        last_seen_adm_timestamp = COALESCE(?, last_seen_adm_timestamp),
        newest_available_adm_filename = COALESCE(?, newest_available_adm_filename),
        newest_available_adm_timestamp = COALESCE(?, newest_available_adm_timestamp),
        newest_readable_adm_filename = COALESCE(?, newest_readable_adm_filename),
        newest_readable_adm_timestamp = COALESCE(?, newest_readable_adm_timestamp),
        first_adm_after_restart_at = CASE WHEN ? THEN ? ELSE first_adm_after_restart_at END,
        first_adm_after_restart_delay_minutes = CASE WHEN ? THEN ? ELSE first_adm_after_restart_delay_minutes END,
        last_server_restart_at = CASE WHEN ? THEN ? ELSE last_server_restart_at END,
        last_restart_detected_source = CASE WHEN ? THEN 'adm_filename' ELSE last_restart_detected_source END,
        last_restart_detected_at = CASE WHEN ? THEN ? ELSE last_restart_detected_at END,
        adm_status = CASE
          WHEN ? IN ('new_adm_detected', 'new_adm_readable', 'waiting_after_restart', 'latest_adm_unreadable', 'delayed_after_restart', 'no_new_log_available')
          THEN ?
          ELSE adm_status
        END,
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
      normalizedStatus,
      newestAvailableFile,
      newestAvailableTimestamp,
      newestAvailableFile,
      newestAvailableTimestamp,
      values.newestReadableAdmFile ?? null,
      values.newestReadableAdmTimestamp ?? null,
      firstAdmAfterRestartAt ? 1 : 0,
      firstAdmAfterRestartAt,
      firstAdmDelayMinutes !== null ? 1 : 0,
      firstAdmDelayMinutes,
      restartFromAdmFile ? 1 : 0,
      restartAt,
      restartFromAdmFile ? 1 : 0,
      restartFromAdmFile ? 1 : 0,
      now,
      normalizedStatus,
      normalizedStatus,
      now,
      values.guildId,
    )
    .run();
}

export async function recordAdmCadenceObservation(env: Env, values: {
  linkedServerId: string;
  firstUsefulAdmLineAt?: string | null;
  lastUsefulAdmEventAt?: string | null;
  lastPlayerlistAt?: string | null;
}) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT linked_servers.guild_id,
              server_sync_state.last_server_restart_at,
              server_sync_state.first_useful_adm_line_after_restart_at,
              server_sync_state.last_useful_adm_event_at,
              server_sync_state.previous_playerlist_at,
              server_sync_state.last_playerlist_at,
              server_sync_state.observed_playerlist_interval_minutes,
              server_sync_state.observed_adm_cadence_minutes
       FROM linked_servers
       LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(values.linkedServerId)
    .first<{
      guild_id: string | null;
      last_server_restart_at: string | null;
      first_useful_adm_line_after_restart_at: string | null;
      last_useful_adm_event_at: string | null;
      previous_playerlist_at: string | null;
      last_playerlist_at: string | null;
      observed_playerlist_interval_minutes: number | null;
      observed_adm_cadence_minutes: number | null;
    }>();

  const guildId = row?.guild_id;
  if (!guildId) return;

  const restartAt = row.last_server_restart_at ?? null;
  const firstUsefulAfterRestartAt = getFirstObservationAfterRestart(
    row.first_useful_adm_line_after_restart_at ?? null,
    restartAt,
    values.firstUsefulAdmLineAt ?? null,
  );
  const nextLastUseful = maxIso(row.last_useful_adm_event_at ?? null, values.lastUsefulAdmEventAt ?? null);
  const nextPlayerlistAt = maxIso(row.last_playerlist_at ?? null, values.lastPlayerlistAt ?? null);
  const playerlistAdvanced = Boolean(values.lastPlayerlistAt && nextPlayerlistAt === values.lastPlayerlistAt && nextPlayerlistAt !== row.last_playerlist_at);
  const usefulAdvanced = Boolean(values.lastUsefulAdmEventAt && nextLastUseful === values.lastUsefulAdmEventAt && nextLastUseful !== row.last_useful_adm_event_at);
  const playerlistInterval = playerlistAdvanced
    ? minutesBetweenIso(row.last_playerlist_at ?? null, nextPlayerlistAt)
    : row.observed_playerlist_interval_minutes ?? null;
  const usefulInterval = usefulAdvanced
    ? minutesBetweenIso(row.last_useful_adm_event_at ?? null, nextLastUseful)
    : null;
  const observedCadence = playerlistInterval ?? usefulInterval ?? row.observed_adm_cadence_minutes ?? null;

  await db
    .prepare(
      `UPDATE server_sync_state SET
        first_useful_adm_line_after_restart_at = CASE WHEN ? THEN ? ELSE first_useful_adm_line_after_restart_at END,
        previous_playerlist_at = CASE WHEN ? THEN last_playerlist_at ELSE previous_playerlist_at END,
        last_playerlist_at = COALESCE(?, last_playerlist_at),
        observed_playerlist_interval_minutes = COALESCE(?, observed_playerlist_interval_minutes),
        last_useful_adm_event_at = COALESCE(?, last_useful_adm_event_at),
        observed_adm_cadence_minutes = COALESCE(?, observed_adm_cadence_minutes),
        updated_at = ?
       WHERE guild_id = ?`,
    )
    .bind(
      firstUsefulAfterRestartAt ? 1 : 0,
      firstUsefulAfterRestartAt,
      playerlistAdvanced ? 1 : 0,
      nextPlayerlistAt,
      playerlistInterval,
      nextLastUseful,
      observedCadence,
      new Date().toISOString(),
      guildId,
    )
    .run();
}

export async function recordAdmPullResult(env: Env, values: {
  guildId: string;
  planKey: PlanKey;
  ok: boolean;
  status: string;
  error?: string | null;
  latestAdmFile?: string | null;
  latestAdmTimestamp?: string | null;
  newestAvailableAdmFile?: string | null;
  newestAvailableAdmTimestamp?: string | null;
  newestReadableAdmFile?: string | null;
  newestReadableAdmTimestamp?: string | null;
  firstUsefulAdmLineAt?: string | null;
  lastUsefulAdmEventAt?: string | null;
  lastPlayerlistAt?: string | null;
  processedAdmFile?: string | null;
  processedOffset?: number | null;
  processedLine?: number | null;
  newDataFound?: boolean;
}) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const nextDue = addMinutesIso(now, getAdmPullInterval(values.planKey));
  const currentState = await db
    .prepare(
      `SELECT last_seen_adm_filename, last_server_restart_at
       FROM server_sync_state
       WHERE guild_id = ?
       LIMIT 1`,
    )
    .bind(values.guildId)
    .first<{ last_seen_adm_filename: string | null; last_server_restart_at: string | null }>()
    .catch(() => null);
  const newestAvailableFile = values.newestAvailableAdmFile ?? values.latestAdmFile ?? null;
  const newestAvailableTimestamp = values.newestAvailableAdmTimestamp ?? values.latestAdmTimestamp ?? null;
  const newestReadableFile = values.newestReadableAdmFile ?? null;
  const newestReadableTimestamp = values.newestReadableAdmTimestamp ?? null;
  const restartFromAdmFile = detectAdmRestartFromAdmFilenames(currentState?.last_seen_adm_filename ?? null, newestAvailableFile);
  const restartAt = restartFromAdmFile
    ? newestAvailableTimestamp ?? now
    : currentState?.last_server_restart_at ?? null;
  const normalizedStatus = normalizeAdmAutomationStatus(values.status, {
    latestAdmFile: newestAvailableFile,
    lastServerRestartAt: restartAt,
  });
  await db
    .prepare(
      `UPDATE server_sync_state SET
        last_adm_pull_at = ?,
        next_adm_pull_due_at = ?,
        last_successful_adm_pull_at = CASE WHEN ? THEN ? ELSE last_successful_adm_pull_at END,
        last_failed_adm_pull_at = CASE WHEN ? THEN last_failed_adm_pull_at ELSE ? END,
        last_adm_error = CASE WHEN ? THEN NULL ELSE ? END,
        last_seen_adm_filename = COALESCE(?, last_seen_adm_filename),
        last_seen_adm_timestamp = COALESCE(?, last_seen_adm_timestamp),
        newest_available_adm_filename = COALESCE(?, newest_available_adm_filename),
        newest_available_adm_timestamp = COALESCE(?, newest_available_adm_timestamp),
        newest_readable_adm_filename = COALESCE(?, newest_readable_adm_filename),
        newest_readable_adm_timestamp = COALESCE(?, newest_readable_adm_timestamp),
        last_processed_adm_filename = COALESCE(?, last_processed_adm_filename),
        last_processed_adm_offset = COALESCE(?, last_processed_adm_offset),
        last_processed_adm_line = COALESCE(?, last_processed_adm_line),
        last_new_adm_found_at = CASE WHEN ? THEN ? ELSE last_new_adm_found_at END,
        last_server_restart_at = CASE WHEN ? THEN ? ELSE last_server_restart_at END,
        last_restart_detected_source = CASE WHEN ? THEN 'adm_filename' ELSE last_restart_detected_source END,
        last_restart_detected_at = CASE WHEN ? THEN ? ELSE last_restart_detected_at END,
        adm_status = ?,
        currently_syncing_adm = 0,
        adm_sync_started_at = NULL,
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
      newestAvailableFile,
      newestAvailableTimestamp,
      newestAvailableFile,
      newestAvailableTimestamp,
      newestReadableFile,
      newestReadableTimestamp,
      values.processedAdmFile ?? null,
      values.processedOffset ?? null,
      values.processedLine ?? null,
      values.newDataFound ? 1 : 0,
      now,
      restartFromAdmFile ? 1 : 0,
      restartAt,
      restartFromAdmFile ? 1 : 0,
      restartFromAdmFile ? 1 : 0,
      now,
      normalizedStatus,
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
  let queued = 0;
  for (const postType of postTypes) {
    if (!hasAutoPost(planKey, postType)) continue;
    const update = await requireDb(env)
      .prepare(
        `UPDATE automation_jobs SET
          status = 'queued',
          attempts = 0,
          max_attempts = 5,
          last_error = ?,
          run_after = ?,
          updated_at = ?
         WHERE id = (
           SELECT id FROM automation_jobs
           WHERE guild_id = ?
             AND job_type = 'discord-post-update'
             AND post_type = ?
             AND status != 'running'
           ORDER BY
             CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
             updated_at DESC,
             created_at DESC
           LIMIT 1
         )`,
      )
      .bind(reason, now, now, guildId, postType)
      .run();
    if (Number(update.meta?.changes ?? 0) > 0) {
      queued += 1;
      continue;
    }

    const insert = await requireDb(env)
      .prepare(
        `INSERT OR IGNORE INTO automation_jobs (
          id, guild_id, job_type, post_type, status, attempts, max_attempts, last_error, run_after, created_at, updated_at
        ) VALUES (?, ?, 'discord-post-update', ?, 'queued', 0, 5, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), guildId, postType, reason, now, now, now)
      .run();
    if (Number(insert.meta?.changes ?? 0) > 0) queued += 1;
  }
  return queued;
}

export async function getNitradoLogSettingsConfirmation(env: Env, guildId: string) {
  await ensureAutomationSchema(env);
  await ensureServerSyncStateRow(env, guildId);
  const row = await requireDb(env)
    .prepare(
      `SELECT nitrado_reduce_log_output_confirmed, nitrado_log_playerlist_confirmed,
              nitrado_log_settings_confirmed_at, nitrado_log_settings_verification_source,
              nitrado_admin_log_enabled, nitrado_server_log_enabled,
              nitrado_log_settings_last_checked_at, nitrado_log_settings_last_error
       FROM server_sync_state
       WHERE guild_id = ?
       LIMIT 1`,
    )
    .bind(guildId)
    .first<{
      nitrado_reduce_log_output_confirmed: number | null;
      nitrado_log_playerlist_confirmed: number | null;
      nitrado_log_settings_confirmed_at: string | null;
      nitrado_log_settings_verification_source: string | null;
      nitrado_admin_log_enabled: number | null;
      nitrado_server_log_enabled: number | null;
      nitrado_log_settings_last_checked_at: string | null;
      nitrado_log_settings_last_error: string | null;
    }>();
  return {
    nitrado_reduce_log_output_confirmed: Number(row?.nitrado_reduce_log_output_confirmed ?? 0) === 1,
    nitrado_log_playerlist_confirmed: Number(row?.nitrado_log_playerlist_confirmed ?? 0) === 1,
    nitrado_log_settings_confirmed_at: row?.nitrado_log_settings_confirmed_at ?? null,
    nitrado_log_settings_verification_source: row?.nitrado_log_settings_verification_source ?? null,
    nitrado_admin_log_enabled: nullableBoolean(row?.nitrado_admin_log_enabled),
    nitrado_server_log_enabled: nullableBoolean(row?.nitrado_server_log_enabled),
    nitrado_log_settings_last_checked_at: row?.nitrado_log_settings_last_checked_at ?? null,
    nitrado_log_settings_last_error: row?.nitrado_log_settings_last_error ?? null,
  };
}

export async function updateNitradoLogSettingsConfirmation(env: Env, input: {
  guildId: string;
  reduceLogOutputConfirmed: boolean;
  logPlayerlistConfirmed: boolean;
  source?: string | null;
  adminLogEnabled?: boolean | null;
  serverLogEnabled?: boolean | null;
  checkedAt?: string | null;
  lastError?: string | null;
}) {
  await ensureAutomationSchema(env);
  await ensureServerSyncStateRow(env, input.guildId);
  const now = input.checkedAt ?? new Date().toISOString();
  const confirmedAt = input.reduceLogOutputConfirmed && input.logPlayerlistConfirmed ? now : null;
  await requireDb(env)
    .prepare(
      `UPDATE server_sync_state SET
        nitrado_reduce_log_output_confirmed = ?,
        nitrado_log_playerlist_confirmed = ?,
        nitrado_log_settings_confirmed_at = ?,
        nitrado_log_settings_verification_source = ?,
        nitrado_admin_log_enabled = ?,
        nitrado_server_log_enabled = ?,
        nitrado_log_settings_last_checked_at = ?,
        nitrado_log_settings_last_error = ?,
        updated_at = ?
       WHERE guild_id = ?`,
    )
    .bind(
      input.reduceLogOutputConfirmed ? 1 : 0,
      input.logPlayerlistConfirmed ? 1 : 0,
      confirmedAt,
      input.source ?? "manual",
      nullableBooleanInt(input.adminLogEnabled),
      nullableBooleanInt(input.serverLogEnabled),
      input.checkedAt ?? null,
      input.lastError ?? null,
      now,
      input.guildId,
    )
    .run();
  return getNitradoLogSettingsConfirmation(env, input.guildId);
}

export async function recordNitradoLogSettingsVerification(env: Env, input: {
  guildId: string;
  reduceLogOutputDisabled: boolean | null;
  logPlayerlistEnabled: boolean | null;
  adminLogEnabled: boolean | null;
  serverLogEnabled: boolean | null;
  source: string;
  checkedAt?: string | null;
  error?: string | null;
}) {
  await ensureAutomationSchema(env);
  await ensureServerSyncStateRow(env, input.guildId);
  const now = input.checkedAt ?? new Date().toISOString();
  const shouldUpdateReduce = input.reduceLogOutputDisabled !== null;
  const shouldUpdatePlayerlist = input.logPlayerlistEnabled !== null;
  const shouldUpdateConfirmation = shouldUpdateReduce || shouldUpdatePlayerlist;
  const current = await getNitradoLogSettingsConfirmation(env, input.guildId);
  const nextReduceConfirmed = shouldUpdateReduce
    ? input.reduceLogOutputDisabled === true
    : current.nitrado_reduce_log_output_confirmed;
  const nextPlayerlistConfirmed = shouldUpdatePlayerlist
    ? input.logPlayerlistEnabled === true
    : current.nitrado_log_playerlist_confirmed;
  const canAutoConfirm = nextReduceConfirmed && nextPlayerlistConfirmed;
  const sourceForRecord = shouldUpdateConfirmation
    ? input.source
    : current.nitrado_log_settings_verification_source === "manual" &&
        current.nitrado_reduce_log_output_confirmed &&
        current.nitrado_log_playerlist_confirmed
      ? "manual"
      : input.source;
  await requireDb(env)
    .prepare(
      `UPDATE server_sync_state SET
        nitrado_reduce_log_output_confirmed = CASE WHEN ? THEN ? ELSE nitrado_reduce_log_output_confirmed END,
        nitrado_log_playerlist_confirmed = CASE WHEN ? THEN ? ELSE nitrado_log_playerlist_confirmed END,
        nitrado_log_settings_confirmed_at = CASE WHEN ? THEN ? ELSE nitrado_log_settings_confirmed_at END,
        nitrado_log_settings_verification_source = ?,
        nitrado_admin_log_enabled = ?,
        nitrado_server_log_enabled = ?,
        nitrado_log_settings_last_checked_at = ?,
        nitrado_log_settings_last_error = ?,
        updated_at = ?
       WHERE guild_id = ?`,
    )
    .bind(
      shouldUpdateReduce ? 1 : 0,
      input.reduceLogOutputDisabled === true ? 1 : 0,
      shouldUpdatePlayerlist ? 1 : 0,
      input.logPlayerlistEnabled === true ? 1 : 0,
      shouldUpdateConfirmation ? 1 : 0,
      canAutoConfirm ? now : null,
      sourceForRecord,
      nullableBooleanInt(input.adminLogEnabled),
      nullableBooleanInt(input.serverLogEnabled),
      now,
      input.error ?? null,
      now,
      input.guildId,
    )
    .run();
  return getNitradoLogSettingsConfirmation(env, input.guildId);
}

async function ensureServerSyncStateRow(env: Env, guildId: string) {
  const now = new Date().toISOString();
  await requireDb(env)
    .prepare(
      `INSERT OR IGNORE INTO server_sync_state (
        id, guild_id, status_data_freshness, adm_status, created_at, updated_at
      ) VALUES (?, ?, 'unknown', 'waiting_for_schedule', ?, ?)`,
    )
    .bind(crypto.randomUUID(), guildId, now, now)
    .run();
}

export async function recoverStuckAutomationLocks(env: Env) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const statusCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const admCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const statusMessage = "Recovered stale status sync lock after 10 minutes.";
  const admMessage = "Recovered stale ADM sync lock after 30 minutes.";

  const statusResult = await db
    .prepare(
      `UPDATE server_sync_state SET
        currently_checking_status = 0,
        status_sync_started_at = NULL,
        last_failed_status_check_at = COALESCE(last_failed_status_check_at, ?),
        last_status_error = ?,
        status_data_freshness = CASE WHEN status_data_freshness = 'fresh' THEN status_data_freshness ELSE 'failed' END,
        updated_at = ?
       WHERE COALESCE(currently_checking_status, 0) = 1
         AND COALESCE(status_sync_started_at, updated_at) < ?`,
    )
    .bind(now, statusMessage, now, statusCutoff)
    .run();

  const admResult = await db
    .prepare(
      `UPDATE server_sync_state SET
        currently_syncing_adm = 0,
        adm_sync_started_at = NULL,
        last_failed_adm_pull_at = COALESCE(last_failed_adm_pull_at, ?),
        last_adm_error = ?,
        adm_status = CASE
          WHEN adm_status IN ('new_data_found', 'no_new_log_available', 'waiting_after_restart', 'latest_adm_unreadable', 'delayed_after_restart') THEN adm_status
          ELSE 'failed'
        END,
        updated_at = ?
       WHERE COALESCE(currently_syncing_adm, 0) = 1
         AND COALESCE(adm_sync_started_at, last_adm_pull_at, updated_at) < ?`,
    )
    .bind(now, admMessage, now, admCutoff)
    .run();

  const statusRecovered = Number(statusResult.meta?.changes ?? 0);
  const admRecovered = Number(admResult.meta?.changes ?? 0);
  if (statusRecovered > 0 || admRecovered > 0) {
    console.warn("DZN AUTOMATION STUCK LOCKS RECOVERED", {
      statusRecovered,
      admRecovered,
    });
  }
  return { statusRecovered, admRecovered };
}

export async function recoverStuckSyncLocksForServer(env: Env, linkedServerId: string) {
  await ensureAutomationSchema(env);
  const db = requireDb(env);
  const server = await db
    .prepare(
      `SELECT linked_servers.id, linked_servers.guild_id, linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name
       FROM linked_servers
       WHERE linked_servers.id = ?
         AND linked_servers.guild_id IS NOT NULL
         AND linked_servers.guild_id != ''
         AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string; guild_id: string; public_slug: string | null; server_name: string | null }>();
  if (!server?.guild_id) throw new Error("Server not found");

  await ensureServerSyncStateRow(env, server.guild_id);
  const before = await getSyncLockSnapshot(db, server.guild_id);
  const now = new Date().toISOString();
  const statusStale = Boolean(before.currently_checking_status && isOlderThanMinutes(before.status_sync_started_at ?? before.updated_at, 10));
  const admStale = Boolean(before.currently_syncing_adm && isOlderThanMinutes(before.adm_sync_started_at ?? before.last_adm_pull_at ?? before.updated_at, 30));

  if (statusStale) {
    await db
      .prepare(
        `UPDATE server_sync_state SET
          currently_checking_status = 0,
          status_sync_started_at = NULL,
          last_failed_status_check_at = COALESCE(last_failed_status_check_at, ?),
          last_status_error = ?,
          status_data_freshness = CASE WHEN status_data_freshness = 'fresh' THEN status_data_freshness ELSE 'failed' END,
          updated_at = ?
         WHERE guild_id = ?
           AND COALESCE(currently_checking_status, 0) = 1`,
      )
      .bind(now, "Recovered stale status sync lock after 10 minutes.", now, server.guild_id)
      .run();
  }

  if (admStale) {
    await db
      .prepare(
        `UPDATE server_sync_state SET
          currently_syncing_adm = 0,
          adm_sync_started_at = NULL,
          last_failed_adm_pull_at = COALESCE(last_failed_adm_pull_at, ?),
          last_adm_error = ?,
          adm_status = CASE
            WHEN adm_status IN ('new_data_found', 'no_new_log_available', 'waiting_after_restart', 'latest_adm_unreadable', 'delayed_after_restart') THEN adm_status
            ELSE 'failed'
          END,
          updated_at = ?
         WHERE guild_id = ?
           AND COALESCE(currently_syncing_adm, 0) = 1`,
      )
      .bind(now, "Recovered stale ADM sync lock after 30 minutes.", now, server.guild_id)
      .run();
  }

  const after = await getSyncLockSnapshot(db, server.guild_id);
  return {
    ok: true,
    server_id: server.id,
    guild_id: server.guild_id,
    public_slug: server.public_slug,
    server_name: server.server_name,
    recovered_status_lock: statusStale,
    recovered_adm_lock: admStale,
    recovered: statusStale || admStale,
    before,
    after,
  };
}

export async function getAutomationHealth(env: Env) {
  await ensureAutomationRowsForLinkedServers(env);
  await recoverStuckAutomationLocks(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const statusLockCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const admLockCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const admImportJobCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const todayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
  const admImportJobsTableExists = await tableExists(db, "adm_import_jobs");

  const [
    lastRuns,
    latestCronRun,
    latestCloudflareCronRun,
    latestGithubCronRun,
    latestMetadataCronRun,
    latestAdmCronRun,
    latestDiscordPostsCronRun,
    migrationState,
    dueMetadata,
    dueAdmDiscovery,
    dueAdm,
    queuedDiscord,
    failedJobs,
    stuckStatusLocks,
    stuckAdmLocks,
    planCounts,
    statusCounts,
    dueServerDiagnostics,
    newestAdmState,
    latestScheduledAdmJob,
    admImportJobCounts,
    admImportJobTimes,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT
          MAX(last_status_check_at) AS last_metadata_sync_run,
          MAX(last_adm_discovery_check_at) AS last_adm_discovery_run,
          MAX(last_adm_pull_at) AS last_adm_sync_run,
          (SELECT MAX(updated_at) FROM automation_jobs WHERE job_type = 'discord-post-update') AS last_discord_dispatcher_run
         FROM server_sync_state`,
      )
      .first<{
        last_metadata_sync_run: string | null;
        last_adm_discovery_run: string | null;
        last_adm_sync_run: string | null;
        last_discord_dispatcher_run: string | null;
      }>(),
    db
      .prepare(
        `SELECT source, job_type, status, started_at, finished_at, created_at, error_message,
                duration_ms, processed_count, skipped_count, failed_count
         FROM automation_cron_runs
         ORDER BY created_at DESC LIMIT 1`,
      )
      .first<AutomationCronRunRow>(),
    db
      .prepare(
        `SELECT source, job_type, status, started_at, finished_at, created_at, error_message,
                duration_ms, processed_count, skipped_count, failed_count
         FROM automation_cron_runs
         WHERE source = 'cloudflare'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .first<AutomationCronRunRow>(),
    db
      .prepare(
        `SELECT source, job_type, status, started_at, finished_at, created_at, error_message,
                duration_ms, processed_count, skipped_count, failed_count
         FROM automation_cron_runs
         WHERE source = 'github-backup'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .first<AutomationCronRunRow>(),
    db
      .prepare(
        `SELECT source, job_type, status, started_at, finished_at, created_at, error_message,
                duration_ms, processed_count, skipped_count, failed_count
         FROM automation_cron_runs
         WHERE job_type = 'metadata'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .first<AutomationCronRunRow>(),
    db
      .prepare(
        `SELECT source, job_type, status, started_at, finished_at, created_at, error_message,
                duration_ms, processed_count, skipped_count, failed_count
         FROM automation_cron_runs
         WHERE job_type = 'adm'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .first<AutomationCronRunRow>(),
    db
      .prepare(
        `SELECT source, job_type, status, started_at, finished_at, created_at, error_message,
                duration_ms, processed_count, skipped_count, failed_count
         FROM automation_cron_runs
         WHERE job_type = 'discord-posts'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .first<AutomationCronRunRow>(),
    getAutomationCronMigrationState(db),
    countFirst(db,
      `SELECT COUNT(*) AS count
       FROM server_subscriptions
       JOIN server_sync_state ON server_sync_state.guild_id = server_subscriptions.guild_id
       WHERE lower(server_subscriptions.status) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_checking_status, 0) = 0
         AND COALESCE(server_sync_state.next_status_check_due_at, '1970-01-01T00:00:00.000Z') <= ?`,
      now),
    countFirst(db,
      `SELECT COUNT(*) AS count
       FROM server_subscriptions
       JOIN server_sync_state ON server_sync_state.guild_id = server_subscriptions.guild_id
       WHERE lower(server_subscriptions.status) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_syncing_adm, 0) = 0
         AND COALESCE(server_sync_state.next_adm_discovery_due_at, '1970-01-01T00:00:00.000Z') <= ?`,
      now),
    countFirst(db,
      `SELECT COUNT(*) AS count
       FROM server_subscriptions
       JOIN server_sync_state ON server_sync_state.guild_id = server_subscriptions.guild_id
       WHERE lower(server_subscriptions.status) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_syncing_adm, 0) = 0
         AND COALESCE(server_sync_state.next_adm_pull_due_at, '1970-01-01T00:00:00.000Z') <= ?`,
      now),
    countFirst(db, "SELECT COUNT(*) AS count FROM automation_jobs WHERE job_type = 'discord-post-update' AND status = 'queued'"),
    countFirst(db, "SELECT COUNT(*) AS count FROM automation_jobs WHERE status = 'failed'"),
    countFirst(db,
      `SELECT COUNT(*) AS count FROM server_sync_state
       WHERE COALESCE(currently_checking_status, 0) = 1
         AND COALESCE(status_sync_started_at, updated_at) < ?`,
      statusLockCutoff),
    countFirst(db,
      `SELECT COUNT(*) AS count FROM server_sync_state
       WHERE COALESCE(currently_syncing_adm, 0) = 1
         AND COALESCE(adm_sync_started_at, last_adm_pull_at, updated_at) < ?`,
      admLockCutoff),
    db
      .prepare("SELECT plan_key, COUNT(*) AS count FROM server_subscriptions GROUP BY plan_key")
      .all<{ plan_key: string; count: number }>(),
    db
      .prepare("SELECT status, COUNT(*) AS count FROM server_subscriptions GROUP BY status")
      .all<{ status: string; count: number }>(),
    db
      .prepare(
        `SELECT
          linked_servers.id AS linked_server_id,
          linked_servers.guild_id,
          linked_servers.public_slug,
          COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
          linked_servers.nitrado_service_id,
          server_subscriptions.plan_key,
          server_subscriptions.status AS subscription_status,
          server_sync_state.next_status_check_due_at,
          server_sync_state.next_adm_discovery_due_at,
          server_sync_state.next_adm_pull_due_at,
          server_sync_state.currently_checking_status,
          server_sync_state.currently_syncing_adm,
          server_sync_state.status_sync_started_at,
          server_sync_state.adm_sync_started_at,
          CASE
            WHEN lower(COALESCE(linked_servers.status, 'pending')) != 'live' THEN 'not_live'
            WHEN linked_servers.nitrado_service_id IS NULL OR linked_servers.nitrado_service_id = '' THEN 'missing_nitrado_token'
            WHEN lower(COALESCE(server_subscriptions.status, '')) NOT IN ('active', 'trialing') THEN 'no_active_subscription'
            WHEN COALESCE(server_sync_state.currently_checking_status, 0) = 1 THEN 'currently_checking_status'
            WHEN COALESCE(server_sync_state.currently_syncing_adm, 0) = 1 THEN 'currently_syncing_adm'
            WHEN COALESCE(server_sync_state.next_status_check_due_at, '1970-01-01T00:00:00.000Z') <= ?
              OR COALESCE(server_sync_state.next_adm_discovery_due_at, '1970-01-01T00:00:00.000Z') <= ?
              OR COALESCE(server_sync_state.next_adm_pull_due_at, '1970-01-01T00:00:00.000Z') <= ?
            THEN 'due'
            ELSE 'not_due'
          END AS skipped_reason
         FROM linked_servers
         LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
         LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
         WHERE linked_servers.guild_id IS NOT NULL
           AND linked_servers.guild_id != ''
           AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
         ORDER BY linked_servers.updated_at DESC
         LIMIT 50`,
      )
      .bind(now, now, now)
      .all<{
        linked_server_id: string;
        guild_id: string | null;
        public_slug: string | null;
        server_name: string | null;
        nitrado_service_id: string | null;
        plan_key: string | null;
        subscription_status: string | null;
        next_status_check_due_at: string | null;
        next_adm_discovery_due_at: string | null;
        next_adm_pull_due_at: string | null;
        currently_checking_status: number | null;
        currently_syncing_adm: number | null;
        status_sync_started_at: string | null;
        adm_sync_started_at: string | null;
        skipped_reason: string | null;
      }>(),
    db
      .prepare(
        `SELECT newest_available_adm_filename, newest_available_adm_timestamp,
                newest_readable_adm_filename, newest_readable_adm_timestamp,
                next_adm_discovery_due_at, next_adm_pull_due_at
         FROM server_sync_state
         WHERE newest_available_adm_filename IS NOT NULL
            OR newest_readable_adm_filename IS NOT NULL
         ORDER BY COALESCE(newest_available_adm_timestamp, newest_readable_adm_timestamp, updated_at) DESC
         LIMIT 1`,
      )
      .first<{
        newest_available_adm_filename: string | null;
        newest_available_adm_timestamp: string | null;
        newest_readable_adm_filename: string | null;
        newest_readable_adm_timestamp: string | null;
        next_adm_discovery_due_at: string | null;
        next_adm_pull_due_at: string | null;
      }>(),
    admImportJobsTableExists ? db
      .prepare(
        `SELECT id, server_id, filename, source, status, total_lines, current_line,
                chunk_size, total_chunks, chunks_processed, parsed_kills, written_kills,
                joins, disconnects, playerlist_snapshots, error_message, updated_at, completed_at
         FROM adm_import_jobs
         WHERE source = 'scheduled_nitrado'
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
      )
      .first<{
        id: string;
        server_id: string;
        filename: string;
        source: string;
        status: string;
        total_lines: number | null;
        current_line: number | null;
        chunk_size: number | null;
        total_chunks: number | null;
        chunks_processed: number | null;
        parsed_kills: number | null;
        written_kills: number | null;
        joins: number | null;
        disconnects: number | null;
        playerlist_snapshots: number | null;
        error_message: string | null;
        updated_at: string | null;
        completed_at: string | null;
      }>() : Promise.resolve(null),
    admImportJobsTableExists ? db
      .prepare(
        `SELECT
          SUM(CASE WHEN status IN ('queued', 'processing', 'parsing', 'writing', 'rebuilding') THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN status = 'failed_retryable' THEN 1 ELSE 0 END) AS failed_retryable_count,
          SUM(CASE WHEN status IN ('processing', 'parsing', 'writing', 'rebuilding') AND COALESCE(updated_at, created_at) < ? THEN 1 ELSE 0 END) AS stuck_count,
          SUM(CASE WHEN status IN ('completed', 'completed_with_warnings') AND COALESCE(completed_at, updated_at, created_at) >= ? THEN 1 ELSE 0 END) AS completed_today_count
         FROM adm_import_jobs
         WHERE source = 'scheduled_nitrado'`,
      )
      .bind(admImportJobCutoff, todayStart)
      .first<{
        active_count: number | null;
        failed_retryable_count: number | null;
        stuck_count: number | null;
        completed_today_count: number | null;
      }>() : Promise.resolve(null),
    admImportJobsTableExists ? db
      .prepare(
        `SELECT
          MAX(CASE WHEN source = 'scheduled_nitrado' AND chunks_processed > 0 THEN updated_at ELSE NULL END) AS last_chunk_processed_at,
          (SELECT filename FROM adm_import_jobs
           WHERE source = 'scheduled_nitrado'
             AND status IN ('completed', 'completed_with_warnings')
           ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
           LIMIT 1) AS last_completed_adm_file,
          MIN(next_adm_discovery_due_at) AS next_adm_discovery_due_at,
          MIN(next_adm_pull_due_at) AS next_adm_processing_due_at
         FROM server_sync_state
         LEFT JOIN adm_import_jobs ON adm_import_jobs.source = 'scheduled_nitrado'`,
      )
      .first<{
        last_chunk_processed_at: string | null;
        last_completed_adm_file: string | null;
        next_adm_discovery_due_at: string | null;
        next_adm_processing_due_at: string | null;
      }>() : db
      .prepare(
        `SELECT
          NULL AS last_chunk_processed_at,
          NULL AS last_completed_adm_file,
          MIN(next_adm_discovery_due_at) AS next_adm_discovery_due_at,
          MIN(next_adm_pull_due_at) AS next_adm_processing_due_at
         FROM server_sync_state`,
      )
      .first<{
        last_chunk_processed_at: string | null;
        last_completed_adm_file: string | null;
        next_adm_discovery_due_at: string | null;
        next_adm_processing_due_at: string | null;
      }>(),
  ]);

  const cronHealth = buildAutomationCronHealth({
    now,
    latestCronRun,
    latestCloudflareCronRun,
    latestGithubCronRun,
    latestMetadataCronRun,
    latestAdmCronRun,
    latestDiscordPostsCronRun,
  });

  return {
    ok: true,
    checked_at: now,
    last_metadata_sync_run: lastRuns?.last_metadata_sync_run ?? null,
    last_adm_discovery_run: lastRuns?.last_adm_discovery_run ?? null,
    last_adm_sync_run: lastRuns?.last_adm_sync_run ?? null,
    last_discord_dispatcher_run: lastRuns?.last_discord_dispatcher_run ?? null,
    last_cron_trigger_source: latestCronRun?.source ?? "unknown",
    last_cron_trigger_job_type: latestCronRun?.job_type ?? null,
    last_cron_trigger_status: latestCronRun?.status ?? null,
    last_cron_trigger_started_at: latestCronRun?.started_at ?? null,
    last_cron_trigger_finished_at: latestCronRun?.finished_at ?? null,
    last_cron_trigger_at: latestCronRun?.created_at ?? null,
    latest_cloudflare_cron_run_at: latestCloudflareCronRun?.created_at ?? null,
    latest_github_backup_cron_run_at: latestGithubCronRun?.created_at ?? null,
    cron_health: cronHealth,
    last_metadata_cron_run_at: latestMetadataCronRun?.created_at ?? null,
    last_metadata_cron_status: latestMetadataCronRun?.status ?? null,
    last_metadata_cron_source: latestMetadataCronRun?.source ?? null,
    last_metadata_cron_error: latestMetadataCronRun?.error_message ?? null,
    last_adm_cron_run_at: latestAdmCronRun?.created_at ?? null,
    last_adm_cron_status: latestAdmCronRun?.status ?? null,
    last_adm_cron_source: latestAdmCronRun?.source ?? null,
    last_adm_cron_error: latestAdmCronRun?.error_message ?? null,
    last_discord_posts_cron_run_at: latestDiscordPostsCronRun?.created_at ?? null,
    last_discord_posts_cron_status: latestDiscordPostsCronRun?.status ?? null,
    last_discord_posts_cron_source: latestDiscordPostsCronRun?.source ?? null,
    last_discord_posts_cron_error: latestDiscordPostsCronRun?.error_message ?? null,
    due_metadata_jobs: dueMetadata,
    due_adm_discovery_jobs: dueAdmDiscovery,
    due_adm_jobs: dueAdm,
    newest_adm_found: newestAdmState?.newest_available_adm_filename ?? null,
    newest_adm_found_at: newestAdmState?.newest_available_adm_timestamp ?? null,
    newest_adm_readable: Boolean(newestAdmState?.newest_readable_adm_filename && newestAdmState.newest_readable_adm_filename === newestAdmState.newest_available_adm_filename),
    newest_readable_adm_filename: newestAdmState?.newest_readable_adm_filename ?? null,
    newest_readable_adm_timestamp: newestAdmState?.newest_readable_adm_timestamp ?? null,
    latest_scheduled_nitrado_job: latestScheduledAdmJob ? {
      id: latestScheduledAdmJob.id,
      server_id: latestScheduledAdmJob.server_id,
      filename: latestScheduledAdmJob.filename,
      source: latestScheduledAdmJob.source,
      status: latestScheduledAdmJob.status,
      total_lines: nullableInteger(latestScheduledAdmJob.total_lines) ?? 0,
      current_line: nullableInteger(latestScheduledAdmJob.current_line) ?? 0,
      chunk_size: nullableInteger(latestScheduledAdmJob.chunk_size) ?? 0,
      total_chunks: nullableInteger(latestScheduledAdmJob.total_chunks) ?? 0,
      chunks_processed: nullableInteger(latestScheduledAdmJob.chunks_processed) ?? 0,
      parsed_kills: nullableInteger(latestScheduledAdmJob.parsed_kills) ?? 0,
      written_kills: nullableInteger(latestScheduledAdmJob.written_kills) ?? 0,
      joins: nullableInteger(latestScheduledAdmJob.joins) ?? 0,
      disconnects: nullableInteger(latestScheduledAdmJob.disconnects) ?? 0,
      playerlist_snapshots: nullableInteger(latestScheduledAdmJob.playerlist_snapshots) ?? 0,
      error_message: latestScheduledAdmJob.error_message,
      updated_at: latestScheduledAdmJob.updated_at,
      completed_at: latestScheduledAdmJob.completed_at,
    } : null,
    active_adm_import_jobs_count: nullableInteger(admImportJobCounts?.active_count) ?? 0,
    stuck_adm_import_jobs_count: nullableInteger(admImportJobCounts?.stuck_count) ?? 0,
    completed_adm_import_jobs_today: nullableInteger(admImportJobCounts?.completed_today_count) ?? 0,
    failed_retryable_adm_import_jobs: nullableInteger(admImportJobCounts?.failed_retryable_count) ?? 0,
    last_adm_import_chunk_processed_at: admImportJobTimes?.last_chunk_processed_at ?? null,
    last_completed_adm_file: admImportJobTimes?.last_completed_adm_file ?? null,
    next_adm_discovery_due_at: admImportJobTimes?.next_adm_discovery_due_at ?? newestAdmState?.next_adm_discovery_due_at ?? null,
    next_adm_processing_due_at: admImportJobTimes?.next_adm_processing_due_at ?? newestAdmState?.next_adm_pull_due_at ?? null,
    queued_discord_post_jobs: queuedDiscord,
    failed_jobs: failedJobs,
    stuck_currently_checking_status_locks: stuckStatusLocks,
    stuck_currently_syncing_adm_locks: stuckAdmLocks,
    server_count_by_plan: rowsToCountMap(planCounts.results ?? [], "plan_key", ["starter", "pro", "network", "partner"]),
    subscription_count_by_status: rowsToCountMap(statusCounts.results ?? [], "status", ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete"]),
    due_server_diagnostics: (dueServerDiagnostics.results ?? []).map((row) => ({
      linked_server_id: row.linked_server_id,
      guild_id: row.guild_id,
      public_slug: row.public_slug,
      server_name: row.server_name,
      nitrado_service_id: row.nitrado_service_id,
      plan_key: normalizePlanKey(row.plan_key),
      subscription_status: row.subscription_status,
      status_interval_minutes: getServerStatusInterval(normalizePlanKey(row.plan_key)),
      adm_discovery_interval_minutes: getAdmDiscoveryIntervalMinutes(normalizePlanKey(row.plan_key)),
      adm_processing_interval_minutes: getAdmPullInterval(normalizePlanKey(row.plan_key)),
      next_status_check_due_at: row.next_status_check_due_at,
      next_adm_discovery_due_at: row.next_adm_discovery_due_at,
      next_adm_pull_due_at: row.next_adm_pull_due_at,
      currently_checking_status: Number(row.currently_checking_status ?? 0) === 1,
      currently_syncing_adm: Number(row.currently_syncing_adm ?? 0) === 1,
      status_sync_started_at: row.status_sync_started_at,
      adm_sync_started_at: row.adm_sync_started_at,
      status_lock_age_minutes: row.status_sync_started_at ? minutesSince(row.status_sync_started_at, now) : null,
      adm_lock_age_minutes: row.adm_sync_started_at ? minutesSince(row.adm_sync_started_at, now) : null,
      skipped_reason: row.skipped_reason ?? "unknown",
    })),
    automation_cron_runs_table_exists: migrationState.tableExists,
    automation_cron_runs_runtime_created: migrationState.runtimeCreated,
    automation_cron_runs_migration_applied: migrationState.migrationApplied,
    automation_cron_metrics_migration_applied: migrationState.metricsMigrationApplied,
    migrationWarning: migrationState.warning,
    migrationWarningMessage: migrationState.warning ? AUTOMATION_MIGRATION_WARNING : null,
  };
}

export function isActiveSubscriptionStatus(status: string | null | undefined) {
  return ACTIVE_BILLING_STATUSES.includes((status ?? "").toLowerCase() as typeof ACTIVE_BILLING_STATUSES[number]);
}

export function addMinutesIso(value: string, minutes: number) {
  return new Date(Date.parse(value) + Math.max(0, minutes) * 60 * 1000).toISOString();
}

function minutesBetweenIso(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

function maxIso(current: string | null | undefined, candidate: string | null | undefined) {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  const currentMs = Date.parse(current);
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) return current;
  if (!Number.isFinite(currentMs)) return candidate;
  return candidateMs > currentMs ? candidate : current;
}

function getFirstObservationAfterRestart(existing: string | null, restartAt: string | null | undefined, observedAt: string | null | undefined) {
  if (!restartAt || !observedAt) return null;
  const restartMs = Date.parse(restartAt);
  const observedMs = Date.parse(observedAt);
  const existingMs = existing ? Date.parse(existing) : Number.NaN;
  if (!Number.isFinite(restartMs) || !Number.isFinite(observedMs) || observedMs < restartMs) return null;
  if (existing && Number.isFinite(existingMs) && existingMs >= restartMs) return null;
  return observedAt;
}

function normalizeAdmAutomationStatus(value: string, context: { latestAdmFile?: string | null; lastServerRestartAt?: string | null } = {}) {
  const normalized = value.toLowerCase();
  if (normalized === "completed") return "new_data_found";
  if (normalized === "no_new_lines") return "no_new_log_available";
  if (normalized === "adm_not_generated_yet" || normalized === "no_adm_file") {
    return isAdmDelayedAfterRestart(context.lastServerRestartAt) ? "delayed_after_restart" : "waiting_after_restart";
  }
  if (normalized === "adm_file_unreadable") return "latest_adm_unreadable";
  if (normalized === "waiting_after_restart" || normalized === "delayed_after_restart" || normalized === "latest_adm_unreadable") return normalized;
  if (normalized === "new_adm_detected" || normalized === "new_adm_readable" || normalized === "new_data_found" || normalized === "no_new_log_available") return normalized;
  return normalized;
}

function isAdmDelayedAfterRestart(value: string | null | undefined, nowMs = Date.now()) {
  if (!value) return false;
  const restartedAt = Date.parse(value);
  return Number.isFinite(restartedAt) && nowMs - restartedAt >= 45 * 60 * 1000;
}

function detectAdmRestartFromAdmFilenames(previousFile: string | null | undefined, newestFile: string | null | undefined) {
  const previous = admTimestampFromName(previousFile);
  const newest = admTimestampFromName(newestFile);
  return previous !== null && newest !== null && newest > previous;
}

function admTimestampFromName(value: string | null | undefined) {
  const match = value?.match(/(\d{4})[-_](\d{2})[-_](\d{2})[_-](\d{2})[-_](\d{2})[-_](\d{2})/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

function isRestartLikeServerStatus(value: string | null | undefined) {
  return /\b(restart|restarting|starting|stopping|stopped|offline)\b/i.test(String(value ?? ""));
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

async function countFirst(db: D1Database, query: string, ...bindings: unknown[]) {
  const prepared = db.prepare(query);
  const row = await (bindings.length ? prepared.bind(...bindings) : prepared).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function rowsToCountMap<T extends Record<string, unknown> & { count?: unknown }>(rows: T[], key: keyof T, defaults: string[] = []) {
  return {
    ...Object.fromEntries(defaults.map((value) => [value, 0])),
    ...Object.fromEntries(rows.map((row) => [String(row[key] ?? "unknown"), Number(row.count ?? 0)])),
  };
}

function buildAutomationCronHealth(input: {
  now: string;
  latestCronRun: AutomationCronRunRow | null;
  latestCloudflareCronRun: AutomationCronRunRow | null;
  latestGithubCronRun: AutomationCronRunRow | null;
  latestMetadataCronRun: AutomationCronRunRow | null;
  latestAdmCronRun: AutomationCronRunRow | null;
  latestDiscordPostsCronRun: AutomationCronRunRow | null;
}) {
  const cloudflare = summarizeCronRun(input.latestCloudflareCronRun, input.now);
  const github = summarizeCronRun(input.latestGithubCronRun, input.now);
  const latest = summarizeCronRun(input.latestCronRun, input.now);
  const metadata = summarizeCronRun(input.latestMetadataCronRun, input.now);
  const adm = summarizeCronRun(input.latestAdmCronRun, input.now);
  const discordPosts = summarizeCronRun(input.latestDiscordPostsCronRun, input.now);
  const hasSecretMismatch = [latest, cloudflare, github, metadata, adm, discordPosts].some((run) => {
    const error = `${run?.status ?? ""} ${run?.error_message ?? ""}`.toLowerCase();
    return error.includes("cron secret") || error.includes("unauthorized") || error.includes("401");
  });

  let status: "healthy" | "cloudflare_missing" | "github_backup_missing" | "cron_secret_mismatch" | "no_recent_automation";
  let message: string;
  if (hasSecretMismatch) {
    status = "cron_secret_mismatch";
    message = "A cron endpoint recently failed authorization. Check that DZN_CRON_SECRET matches in Pages, Worker, and GitHub.";
  } else if (!latest || latest.age_minutes === null || latest.age_minutes > 10) {
    status = "no_recent_automation";
    message = "No recent automation cron check-in detected.";
  } else if (!cloudflare || cloudflare.age_minutes === null || cloudflare.age_minutes > 5) {
    status = "cloudflare_missing";
    message = "Cloudflare Worker cron has not checked in recently. Automatic updates may not run.";
  } else if (!github || github.age_minutes === null || github.age_minutes > 15) {
    status = "github_backup_missing";
    message = "Cloudflare Worker cron is running, but the GitHub backup cron has not checked in recently.";
  } else {
    status = "healthy";
    message = "Cloudflare Worker Cron and GitHub backup cron are checking in.";
  }

  return {
    status,
    message,
    cloudflare,
    github_backup: github,
    latest,
    metadata,
    adm,
    discord_posts: discordPosts,
  };
}

function summarizeCronRun(row: AutomationCronRunRow | null, now: string) {
  if (!row?.created_at) return null;
  const age = minutesSince(row.created_at, now);
  return {
    source: row.source,
    job_type: row.job_type,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    created_at: row.created_at,
    error_message: row.error_message,
    duration_ms: nullableInteger(row.duration_ms),
    processed_count: nullableInteger(row.processed_count),
    skipped_count: nullableInteger(row.skipped_count),
    failed_count: nullableInteger(row.failed_count),
    age_minutes: age,
  };
}

function minutesSince(value: string | null | undefined, now: string) {
  if (!value) return null;
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(valueMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.round((nowMs - valueMs) / 60000));
}

async function getSyncLockSnapshot(db: D1Database, guildId: string) {
  const row = await db
    .prepare(
      `SELECT currently_checking_status, currently_syncing_adm, updated_at,
              status_sync_started_at, adm_sync_started_at, last_adm_pull_at,
              last_status_error, last_adm_error
       FROM server_sync_state
       WHERE guild_id = ?
       LIMIT 1`,
    )
    .bind(guildId)
    .first<{
      currently_checking_status: number | null;
      currently_syncing_adm: number | null;
      updated_at: string | null;
      status_sync_started_at: string | null;
      adm_sync_started_at: string | null;
      last_adm_pull_at: string | null;
      last_status_error: string | null;
      last_adm_error: string | null;
    }>();
  const updatedAt = row?.updated_at ?? null;
  const statusStartedAt = row?.status_sync_started_at ?? null;
  const admStartedAt = row?.adm_sync_started_at ?? null;
  const admLockStartedAt = admStartedAt ?? row?.last_adm_pull_at ?? updatedAt;
  const statusLockStartedAt = statusStartedAt ?? updatedAt;
  const now = new Date().toISOString();
  return {
    currently_checking_status: Number(row?.currently_checking_status ?? 0) === 1,
    currently_syncing_adm: Number(row?.currently_syncing_adm ?? 0) === 1,
    updated_at: updatedAt,
    status_sync_started_at: statusStartedAt,
    adm_sync_started_at: admStartedAt,
    last_adm_pull_at: row?.last_adm_pull_at ?? null,
    lock_age_minutes: updatedAt ? minutesSince(updatedAt, now) : null,
    status_lock_age_minutes: statusLockStartedAt ? minutesSince(statusLockStartedAt, now) : null,
    adm_lock_age_minutes: admLockStartedAt ? minutesSince(admLockStartedAt, now) : null,
    last_status_error: row?.last_status_error ?? null,
    last_adm_error: row?.last_adm_error ?? null,
  };
}

function isOlderThanMinutes(value: string | null | undefined, minutes: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Date.now() - timestamp > minutes * 60 * 1000;
}

function nullableBoolean(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

function nullableBooleanInt(value: boolean | null | undefined) {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

function nullableInteger(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function durationBetween(startedAt: string, finishedAt: string) {
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) return null;
  return Math.max(0, finishedMs - startedMs);
}

async function ensureAutomationCronRunsColumns(db: D1Database) {
  const columns = await getTableColumns(db, "automation_cron_runs");
  const requiredColumns: Record<string, string> = {
    endpoint: "ALTER TABLE automation_cron_runs ADD COLUMN endpoint TEXT",
    job_type: "ALTER TABLE automation_cron_runs ADD COLUMN job_type TEXT",
    started_at: "ALTER TABLE automation_cron_runs ADD COLUMN started_at TEXT",
    finished_at: "ALTER TABLE automation_cron_runs ADD COLUMN finished_at TEXT",
    error_message: "ALTER TABLE automation_cron_runs ADD COLUMN error_message TEXT",
    duration_ms: "ALTER TABLE automation_cron_runs ADD COLUMN duration_ms INTEGER",
    processed_count: "ALTER TABLE automation_cron_runs ADD COLUMN processed_count INTEGER",
    skipped_count: "ALTER TABLE automation_cron_runs ADD COLUMN skipped_count INTEGER",
    failed_count: "ALTER TABLE automation_cron_runs ADD COLUMN failed_count INTEGER",
  };

  for (const [column, statement] of Object.entries(requiredColumns)) {
    if (!columns.has(column)) {
      await db.prepare(statement).run();
    }
  }

  if (!columns.has("job_type") && columns.has("endpoint")) {
    await db.prepare("UPDATE automation_cron_runs SET job_type = COALESCE(job_type, endpoint)").run();
  }
  await db.prepare("UPDATE automation_cron_runs SET job_type = COALESCE(job_type, 'metadata') WHERE job_type IS NULL").run();
  await db.prepare("UPDATE automation_cron_runs SET started_at = COALESCE(started_at, created_at) WHERE started_at IS NULL").run();
  await db.prepare("UPDATE automation_cron_runs SET finished_at = COALESCE(finished_at, created_at) WHERE finished_at IS NULL").run();
  await db.prepare("UPDATE automation_cron_runs SET status = 'success' WHERE status IN ('completed', 'manual')").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_job_type ON automation_cron_runs(job_type)").run();
}

async function ensureServerSyncStateAdmColumns(db: D1Database) {
  const columns = await getTableColumns(db, "server_sync_state");
  const requiredColumns: Record<string, string> = {
    last_adm_discovery_check_at: "ALTER TABLE server_sync_state ADD COLUMN last_adm_discovery_check_at TEXT",
    next_adm_discovery_due_at: "ALTER TABLE server_sync_state ADD COLUMN next_adm_discovery_due_at TEXT",
    last_successful_adm_discovery_at: "ALTER TABLE server_sync_state ADD COLUMN last_successful_adm_discovery_at TEXT",
    last_failed_adm_discovery_at: "ALTER TABLE server_sync_state ADD COLUMN last_failed_adm_discovery_at TEXT",
    last_adm_discovery_error: "ALTER TABLE server_sync_state ADD COLUMN last_adm_discovery_error TEXT",
    adm_discovery_status: "ALTER TABLE server_sync_state ADD COLUMN adm_discovery_status TEXT",
    status_sync_started_at: "ALTER TABLE server_sync_state ADD COLUMN status_sync_started_at TEXT",
    adm_sync_started_at: "ALTER TABLE server_sync_state ADD COLUMN adm_sync_started_at TEXT",
    last_seen_adm_timestamp: "ALTER TABLE server_sync_state ADD COLUMN last_seen_adm_timestamp TEXT",
    newest_available_adm_filename: "ALTER TABLE server_sync_state ADD COLUMN newest_available_adm_filename TEXT",
    newest_available_adm_timestamp: "ALTER TABLE server_sync_state ADD COLUMN newest_available_adm_timestamp TEXT",
    newest_readable_adm_filename: "ALTER TABLE server_sync_state ADD COLUMN newest_readable_adm_filename TEXT",
    newest_readable_adm_timestamp: "ALTER TABLE server_sync_state ADD COLUMN newest_readable_adm_timestamp TEXT",
    last_processed_adm_line: "ALTER TABLE server_sync_state ADD COLUMN last_processed_adm_line INTEGER",
    last_restart_detected_source: "ALTER TABLE server_sync_state ADD COLUMN last_restart_detected_source TEXT",
    last_restart_detected_at: "ALTER TABLE server_sync_state ADD COLUMN last_restart_detected_at TEXT",
    first_adm_after_restart_at: "ALTER TABLE server_sync_state ADD COLUMN first_adm_after_restart_at TEXT",
    first_adm_after_restart_delay_minutes: "ALTER TABLE server_sync_state ADD COLUMN first_adm_after_restart_delay_minutes INTEGER",
    first_useful_adm_line_after_restart_at: "ALTER TABLE server_sync_state ADD COLUMN first_useful_adm_line_after_restart_at TEXT",
    observed_playerlist_interval_minutes: "ALTER TABLE server_sync_state ADD COLUMN observed_playerlist_interval_minutes INTEGER",
    observed_adm_cadence_minutes: "ALTER TABLE server_sync_state ADD COLUMN observed_adm_cadence_minutes INTEGER",
    previous_playerlist_at: "ALTER TABLE server_sync_state ADD COLUMN previous_playerlist_at TEXT",
    last_playerlist_at: "ALTER TABLE server_sync_state ADD COLUMN last_playerlist_at TEXT",
    last_useful_adm_event_at: "ALTER TABLE server_sync_state ADD COLUMN last_useful_adm_event_at TEXT",
    nitrado_reduce_log_output_confirmed: "ALTER TABLE server_sync_state ADD COLUMN nitrado_reduce_log_output_confirmed INTEGER NOT NULL DEFAULT 0",
    nitrado_log_playerlist_confirmed: "ALTER TABLE server_sync_state ADD COLUMN nitrado_log_playerlist_confirmed INTEGER NOT NULL DEFAULT 0",
    nitrado_log_settings_confirmed_at: "ALTER TABLE server_sync_state ADD COLUMN nitrado_log_settings_confirmed_at TEXT",
    nitrado_log_settings_verification_source: "ALTER TABLE server_sync_state ADD COLUMN nitrado_log_settings_verification_source TEXT",
    nitrado_admin_log_enabled: "ALTER TABLE server_sync_state ADD COLUMN nitrado_admin_log_enabled INTEGER",
    nitrado_server_log_enabled: "ALTER TABLE server_sync_state ADD COLUMN nitrado_server_log_enabled INTEGER",
    nitrado_log_settings_last_checked_at: "ALTER TABLE server_sync_state ADD COLUMN nitrado_log_settings_last_checked_at TEXT",
    nitrado_log_settings_last_error: "ALTER TABLE server_sync_state ADD COLUMN nitrado_log_settings_last_error TEXT",
  };

  for (const [column, statement] of Object.entries(requiredColumns)) {
    if (!columns.has(column)) {
      await db.prepare(statement).run();
    }
  }
  await db.prepare("UPDATE server_sync_state SET status_sync_started_at = COALESCE(status_sync_started_at, last_status_check_at, updated_at) WHERE COALESCE(currently_checking_status, 0) = 1 AND status_sync_started_at IS NULL").run();
  await db.prepare("UPDATE server_sync_state SET adm_sync_started_at = COALESCE(adm_sync_started_at, last_adm_pull_at, updated_at) WHERE COALESCE(currently_syncing_adm, 0) = 1 AND adm_sync_started_at IS NULL").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_discovery_due ON server_sync_state(next_adm_discovery_due_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_sync_state_last_useful_adm_event ON server_sync_state(last_useful_adm_event_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_started ON server_sync_state(status_sync_started_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_started ON server_sync_state(adm_sync_started_at)").run();
}

async function ensureServerPostingStateDispatchColumns(db: D1Database) {
  const columns = await getTableColumns(db, "server_posting_state");
  const requiredColumns: Record<string, string> = {
    last_dispatch_attempt_at: "ALTER TABLE server_posting_state ADD COLUMN last_dispatch_attempt_at TEXT",
    last_dispatch_status: "ALTER TABLE server_posting_state ADD COLUMN last_dispatch_status TEXT",
    last_dispatch_error: "ALTER TABLE server_posting_state ADD COLUMN last_dispatch_error TEXT",
  };

  for (const [column, statement] of Object.entries(requiredColumns)) {
    if (!columns.has(column)) {
      await db.prepare(statement).run();
    }
  }
}

async function getAutomationCronMigrationState(db: D1Database) {
  const cronTableExists = await tableExists(db, "automation_cron_runs");
  const migrationApplied = await isD1MigrationApplied(db, AUTOMATION_CRON_MIGRATION_NAME);
  const metricsMigrationApplied = await isD1MigrationApplied(db, AUTOMATION_CRON_METRICS_MIGRATION_NAME);
  const runtimeCreated = cronTableExists && (migrationApplied !== true || metricsMigrationApplied !== true);
  return {
    tableExists: cronTableExists,
    migrationApplied,
    metricsMigrationApplied,
    runtimeCreated,
    warning: !cronTableExists || migrationApplied !== true || metricsMigrationApplied !== true || runtimeCreated,
  };
}

async function tableExists(db: D1Database, tableName: string) {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(tableName)
    .first<{ name: string }>()
    .catch(() => null);
  return Boolean(row?.name);
}

async function isD1MigrationApplied(db: D1Database, migrationName: string): Promise<boolean | null> {
  const migrationTableExists = await tableExists(db, "d1_migrations");
  if (!migrationTableExists) return false;
  const row = await db
    .prepare("SELECT name FROM d1_migrations WHERE name = ? OR name LIKE ? LIMIT 1")
    .bind(migrationName, `%${migrationName.replace(/\.sql$/, "")}%`)
    .first<{ name: string }>()
    .catch(() => null);
  return Boolean(row?.name);
}

async function getTableColumns(db: D1Database, tableName: string) {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
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
    status_sync_started_at TEXT,
    last_adm_discovery_check_at TEXT,
    next_adm_discovery_due_at TEXT,
    last_successful_adm_discovery_at TEXT,
    last_failed_adm_discovery_at TEXT,
    last_adm_discovery_error TEXT,
    adm_discovery_status TEXT,
    last_adm_pull_at TEXT,
    next_adm_pull_due_at TEXT,
    last_successful_adm_pull_at TEXT,
    last_failed_adm_pull_at TEXT,
    last_adm_error TEXT,
    last_seen_adm_filename TEXT,
    last_seen_adm_modified_at TEXT,
    last_seen_adm_timestamp TEXT,
    newest_available_adm_filename TEXT,
    newest_available_adm_timestamp TEXT,
    newest_readable_adm_filename TEXT,
    newest_readable_adm_timestamp TEXT,
    last_processed_adm_filename TEXT,
    last_processed_adm_offset INTEGER,
    last_processed_adm_line INTEGER,
    last_new_adm_found_at TEXT,
    last_server_restart_at TEXT,
    last_restart_detected_source TEXT,
    last_restart_detected_at TEXT,
    first_adm_after_restart_at TEXT,
    first_adm_after_restart_delay_minutes INTEGER,
    first_useful_adm_line_after_restart_at TEXT,
    observed_playerlist_interval_minutes INTEGER,
    observed_adm_cadence_minutes INTEGER,
    previous_playerlist_at TEXT,
    last_playerlist_at TEXT,
    last_useful_adm_event_at TEXT,
    adm_status TEXT,
    nitrado_reduce_log_output_confirmed INTEGER NOT NULL DEFAULT 0,
    nitrado_log_playerlist_confirmed INTEGER NOT NULL DEFAULT 0,
    nitrado_log_settings_confirmed_at TEXT,
    nitrado_log_settings_verification_source TEXT,
    nitrado_admin_log_enabled INTEGER,
    nitrado_server_log_enabled INTEGER,
    nitrado_log_settings_last_checked_at TEXT,
    nitrado_log_settings_last_error TEXT,
    currently_syncing_adm INTEGER NOT NULL DEFAULT 0,
    adm_sync_started_at TEXT,
    manual_refresh_locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_due ON server_sync_state(next_status_check_due_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_discovery_due ON server_sync_state(next_adm_discovery_due_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_due ON server_sync_state(next_adm_pull_due_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_last_useful_adm_event ON server_sync_state(last_useful_adm_event_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_lock ON server_sync_state(currently_checking_status)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_lock ON server_sync_state(currently_syncing_adm)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_status_started ON server_sync_state(status_sync_started_at)",
  "CREATE INDEX IF NOT EXISTS idx_server_sync_state_adm_started ON server_sync_state(adm_sync_started_at)",
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
  `CREATE TABLE IF NOT EXISTS automation_cron_runs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    endpoint TEXT,
    job_type TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    duration_ms INTEGER,
    processed_count INTEGER,
    skipped_count INTEGER,
    failed_count INTEGER,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_created_at ON automation_cron_runs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_source ON automation_cron_runs(source)",
];
