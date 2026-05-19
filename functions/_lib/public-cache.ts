import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { getAdmDiscoveryIntervalMinutes, getAdmPullInterval, getServerStatusInterval, normalizePlanKey, type PlanKey } from "./plans";
import { upsertServerPublicCache } from "./automation";
import type { Env, SessionUser } from "./types";

type AccessCheckResult = {
  allowed: boolean;
  reason?: "unauthenticated" | "not_found" | "forbidden";
  server?: {
    id: string;
    user_id: string;
    guild_id: string | null;
  };
};

type PublicCacheSourceRows = {
  linked_servers: Record<string, unknown> | null;
  server_sync_state: Record<string, unknown> | null;
  server_public_cache: Record<string, unknown> | null;
  server_stats: Record<string, unknown> | null;
  server_subscriptions: Record<string, unknown> | null;
  adm_sync_state: Record<string, unknown> | null;
  latest_kill_event: Record<string, unknown> | null;
  latest_player_event: Record<string, unknown> | null;
};

export type PublicCacheDebugPayload = {
  ok: true;
  server_id: string;
  guild_id: string | null;
  public_slug: string | null;
  plan_key: PlanKey;
  subscription_status: string | null;
  source_tables: PublicCacheSourceRows;
  timestamps: {
    metadata_last_checked_at: string | null;
    status_last_checked_at: string | null;
    adm_last_processed_at: string | null;
    public_cache_updated_at: string | null;
    public_cache_last_status_update_at: string | null;
    public_cache_last_adm_update_at: string | null;
    profile_last_sync_display_source: "sync_runs" | "adm_sync_state" | "metadata" | "player_count" | "public_cache" | "server_stats" | "none";
    profile_last_sync_display_at: string | null;
  };
  staleness: {
    public_cache_age_minutes: number | null;
    metadata_age_minutes: number | null;
    status_age_minutes: number | null;
    adm_age_minutes: number | null;
  };
  plan_due_state: {
    status_interval_minutes: number;
    adm_discovery_interval_minutes: number;
    adm_processing_interval_minutes: number;
    next_status_due_at: string | null;
    next_adm_discovery_due_at: string | null;
    next_adm_pull_due_at: string | null;
    status_due: boolean;
    adm_discovery_due: boolean;
    adm_processing_due: boolean;
    skipped_reason: string | null;
  };
  cron: {
    last_metadata_cron_at: string | null;
    last_adm_cron_at: string | null;
    last_discord_posts_cron_at: string | null;
    last_cloudflare_cron_at: string | null;
    last_github_backup_cron_at: string | null;
    last_cron_source: string | null;
    last_cron_status: string | null;
    last_cron_error: string | null;
  };
  problem_flags: string[];
};

type RebuildResult = {
  ok: true;
  before: PublicCacheDebugPayload;
  after: PublicCacheDebugPayload;
  rebuilt_at: string;
};

export async function requireServerOwnerOrDznAdmin(env: Env, user: SessionUser | null, linkedServerId: string): Promise<AccessCheckResult> {
  if (!user) return { allowed: false, reason: "unauthenticated" };
  const server = await requireDb(env)
    .prepare(
      `SELECT id, user_id, guild_id
       FROM linked_servers
       WHERE id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<{ id: string; user_id: string; guild_id: string | null }>();

  if (!server) return { allowed: false, reason: "not_found" };
  if (server.user_id === user.id || isDznAdminDiscordId(env, user.discord_id) || env.MOCK_AUTH === "1" || env.MOCK_AUTH === "true") {
    return { allowed: true, server };
  }
  return { allowed: false, reason: "forbidden", server };
}

export async function getPublicCacheDebugForServer(env: Env, linkedServerId: string): Promise<PublicCacheDebugPayload> {
  const rows = await readPublicCacheRows(env, linkedServerId);
  const linked = rows.linked_servers;
  if (!linked) throw new Error("Server not found");

  const guildId = stringValue(linked.guild_id);
  const subscription = rows.server_subscriptions;
  const sync = rows.server_sync_state;
  const cache = rows.server_public_cache;
  const stats = rows.server_stats;
  const adm = rows.adm_sync_state;
  const planKey = normalizePlanKey(stringValue(subscription?.plan_key));
  const subscriptionStatus = stringValue(subscription?.status);
  const now = new Date().toISOString();
  const latestSync = latestTimestampWithSource([
    ["sync_runs", stringValue((linked as Record<string, unknown>).latest_success_sync_at)],
    ["adm_sync_state", stringValue(adm?.last_sync_at)],
    ["metadata", stringValue(linked.metadata_last_checked_at)],
    ["player_count", stringValue(linked.player_count_last_checked_at)],
    ["public_cache", stringValue(cache?.updated_at)],
    ["server_stats", stringValue(stats?.updated_at)],
  ]);
  const metadataAt = stringValue(linked.metadata_last_checked_at);
  const statusAt = stringValue(sync?.last_status_check_at) ?? metadataAt;
  const admAt = latestTimestamp([
    stringValue(sync?.last_adm_pull_at),
    stringValue(adm?.last_sync_at),
    stringValue(stats?.updated_at),
  ]);
  const cacheUpdatedAt = stringValue(cache?.updated_at);
  const cacheStatusAt = stringValue(cache?.last_status_update_at);
  const cacheAdmAt = stringValue(cache?.last_adm_update_at);
  const problemFlags = buildPublicCacheProblemFlags({
    linked,
    sync,
    cache,
    subscription,
    metadataAt,
    statusAt,
    admAt,
    cacheUpdatedAt,
    cacheStatusAt,
    cacheAdmAt,
    now,
    planKey,
  });
  const cron = await readCronFreshness(env);

  if (!cron.last_cloudflare_cron_at && !cron.last_github_backup_cron_at) {
    problemFlags.push("no_automation_cron_checkins");
  }

  return {
    ok: true,
    server_id: stringValue(linked.id) ?? linkedServerId,
    guild_id: guildId,
    public_slug: stringValue(linked.public_slug),
    plan_key: planKey,
    subscription_status: subscriptionStatus,
    source_tables: rows,
    timestamps: {
      metadata_last_checked_at: metadataAt,
      status_last_checked_at: statusAt,
      adm_last_processed_at: admAt,
      public_cache_updated_at: cacheUpdatedAt,
      public_cache_last_status_update_at: cacheStatusAt,
      public_cache_last_adm_update_at: cacheAdmAt,
      profile_last_sync_display_source: latestSync.source,
      profile_last_sync_display_at: latestSync.value,
    },
    staleness: {
      public_cache_age_minutes: ageMinutes(cacheUpdatedAt, now),
      metadata_age_minutes: ageMinutes(metadataAt, now),
      status_age_minutes: ageMinutes(statusAt, now),
      adm_age_minutes: ageMinutes(admAt, now),
    },
    plan_due_state: buildPlanDueState(planKey, subscriptionStatus, linked, sync, now),
    cron,
    problem_flags: [...new Set(problemFlags)],
  };
}

export async function rebuildPublicCacheForServer(env: Env, linkedServerId: string): Promise<RebuildResult> {
  const before = await getPublicCacheDebugForServer(env, linkedServerId);
  const linked = before.source_tables.linked_servers;
  if (!linked) throw new Error("Server not found");
  const guildId = before.guild_id;
  if (!guildId) throw new Error("Server has no Discord guild id");

  await upsertServerPublicCache(env, {
    guildId,
    planKey: before.plan_key,
    publicServerName: firstString(
      stringValue(linked.display_name),
      stringValue(linked.hostname),
      stringValue(linked.server_name),
      stringValue(linked.nitrado_service_name),
    ),
    currentPlayers: numberValue(linked.current_players),
    maxPlayers: numberValue(linked.max_players) ?? numberValue(linked.player_slots),
    serverOnline: numberValue(linked.is_online),
    serverStatus: stringValue(linked.server_status),
    lastStatusUpdateAt: latestTimestamp([
      stringValue(linked.player_count_last_checked_at),
      stringValue(linked.metadata_last_checked_at),
      before.timestamps.status_last_checked_at,
    ]),
    lastAdmUpdateAt: latestTimestamp([
      before.timestamps.adm_last_processed_at,
      stringValue(before.source_tables.server_stats?.updated_at),
      stringValue(before.source_tables.adm_sync_state?.last_sync_at),
    ]),
  });

  return {
    ok: true,
    before,
    after: await getPublicCacheDebugForServer(env, linkedServerId),
    rebuilt_at: new Date().toISOString(),
  };
}

async function readPublicCacheRows(env: Env, linkedServerId: string): Promise<PublicCacheSourceRows> {
  const db = requireDb(env);
  const linked = await db
    .prepare(
      `SELECT
        linked_servers.id,
        linked_servers.user_id,
        linked_servers.guild_id,
        linked_servers.discord_guild_id,
        linked_servers.public_slug,
        linked_servers.status,
        linked_servers.nitrado_service_id,
        linked_servers.display_name,
        linked_servers.hostname,
        linked_servers.server_name,
        linked_servers.nitrado_service_name,
        linked_servers.current_players,
        linked_servers.max_players,
        linked_servers.player_slots,
        linked_servers.is_online,
        linked_servers.server_status,
        linked_servers.metadata_last_checked_at,
        linked_servers.player_count_last_checked_at,
        linked_servers.updated_at,
        (
          SELECT COALESCE(finished_at, started_at, created_at)
          FROM sync_runs
          WHERE sync_runs.linked_server_id = linked_servers.id
            AND lower(sync_runs.status) IN ('completed', 'idle', 'no_new_lines', 'no_supported_events')
          ORDER BY COALESCE(sync_runs.finished_at, sync_runs.started_at, sync_runs.created_at) DESC
          LIMIT 1
        ) AS latest_success_sync_at
       FROM linked_servers
       WHERE linked_servers.id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<Record<string, unknown>>();

  const guildId = stringValue(linked?.guild_id);
  const [sync, cache, stats, subscription, adm, latestKill, latestPlayer] = await Promise.all([
    guildId
      ? db.prepare("SELECT * FROM server_sync_state WHERE guild_id = ? LIMIT 1").bind(guildId).first<Record<string, unknown>>()
      : null,
    guildId
      ? db.prepare("SELECT * FROM server_public_cache WHERE guild_id = ? LIMIT 1").bind(guildId).first<Record<string, unknown>>()
      : null,
    db.prepare("SELECT * FROM server_stats WHERE linked_server_id = ? LIMIT 1").bind(linkedServerId).first<Record<string, unknown>>(),
    guildId
      ? db.prepare("SELECT * FROM server_subscriptions WHERE guild_id = ? LIMIT 1").bind(guildId).first<Record<string, unknown>>()
      : null,
    db.prepare("SELECT * FROM adm_sync_state WHERE linked_server_id = ? LIMIT 1").bind(linkedServerId).first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, event_type, killer_name, victim_name, weapon, distance, occurred_at, created_at
         FROM kill_events
         WHERE linked_server_id = ?
         ORDER BY COALESCE(occurred_at, created_at) DESC
         LIMIT 1`,
      )
      .bind(linkedServerId)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT id, event_type, player_name, occurred_at, created_at
         FROM player_events
         WHERE linked_server_id = ?
         ORDER BY COALESCE(occurred_at, created_at) DESC
         LIMIT 1`,
      )
      .bind(linkedServerId)
      .first<Record<string, unknown>>(),
  ]);

  return {
    linked_servers: linked ?? null,
    server_sync_state: sync ?? null,
    server_public_cache: cache ?? null,
    server_stats: stats ?? null,
    server_subscriptions: subscription ?? null,
    adm_sync_state: adm ?? null,
    latest_kill_event: latestKill ?? null,
    latest_player_event: latestPlayer ?? null,
  };
}

async function readCronFreshness(env: Env) {
  const db = requireDb(env);
  const [metadata, adm, discord, cloudflare, github, latest] = await Promise.all([
    db.prepare("SELECT MAX(created_at) AS at FROM automation_cron_runs WHERE job_type = 'metadata'").first<{ at: string | null }>(),
    db.prepare("SELECT MAX(created_at) AS at FROM automation_cron_runs WHERE job_type = 'adm'").first<{ at: string | null }>(),
    db.prepare("SELECT MAX(created_at) AS at FROM automation_cron_runs WHERE job_type = 'discord-posts'").first<{ at: string | null }>(),
    db.prepare("SELECT MAX(created_at) AS at FROM automation_cron_runs WHERE source = 'cloudflare'").first<{ at: string | null }>(),
    db.prepare("SELECT MAX(created_at) AS at FROM automation_cron_runs WHERE source = 'github-backup'").first<{ at: string | null }>(),
    db.prepare("SELECT source, status, error_message FROM automation_cron_runs ORDER BY created_at DESC LIMIT 1").first<{ source: string | null; status: string | null; error_message: string | null }>(),
  ]).catch(() => [null, null, null, null, null, null] as const);

  return {
    last_metadata_cron_at: metadata?.at ?? null,
    last_adm_cron_at: adm?.at ?? null,
    last_discord_posts_cron_at: discord?.at ?? null,
    last_cloudflare_cron_at: cloudflare?.at ?? null,
    last_github_backup_cron_at: github?.at ?? null,
    last_cron_source: latest?.source ?? null,
    last_cron_status: latest?.status ?? null,
    last_cron_error: latest?.error_message ?? null,
  };
}

function buildPlanDueState(
  planKey: PlanKey,
  subscriptionStatus: string | null,
  linked: Record<string, unknown>,
  sync: Record<string, unknown> | null,
  now: string,
) {
  const nextStatus = stringValue(sync?.next_status_check_due_at);
  const nextDiscovery = stringValue(sync?.next_adm_discovery_due_at);
  const nextAdm = stringValue(sync?.next_adm_pull_due_at);
  const statusDue = isDue(nextStatus, now);
  const admDiscoveryDue = isDue(nextDiscovery, now);
  const admProcessingDue = isDue(nextAdm, now);
  const active = ["active", "trialing"].includes((subscriptionStatus ?? "").toLowerCase());
  let skippedReason: string | null = null;
  if (!active) skippedReason = "no_active_subscription";
  else if (!stringValue(linked.nitrado_service_id)) skippedReason = "missing_nitrado_service";
  else if (numberValue(sync?.currently_checking_status) === 1) skippedReason = "currently_checking_status";
  else if (numberValue(sync?.currently_syncing_adm) === 1) skippedReason = "currently_syncing_adm";
  else if (!statusDue && !admDiscoveryDue && !admProcessingDue) skippedReason = "not_due";

  return {
    status_interval_minutes: getServerStatusInterval(planKey),
    adm_discovery_interval_minutes: getAdmDiscoveryIntervalMinutes(planKey),
    adm_processing_interval_minutes: getAdmPullInterval(planKey),
    next_status_due_at: nextStatus,
    next_adm_discovery_due_at: nextDiscovery,
    next_adm_pull_due_at: nextAdm,
    status_due: statusDue,
    adm_discovery_due: admDiscoveryDue,
    adm_processing_due: admProcessingDue,
    skipped_reason: skippedReason,
  };
}

function buildPublicCacheProblemFlags(input: {
  linked: Record<string, unknown>;
  sync: Record<string, unknown> | null;
  cache: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  metadataAt: string | null;
  statusAt: string | null;
  admAt: string | null;
  cacheUpdatedAt: string | null;
  cacheStatusAt: string | null;
  cacheAdmAt: string | null;
  now: string;
  planKey: PlanKey;
}) {
  const flags: string[] = [];
  const active = ["active", "trialing"].includes((stringValue(input.subscription?.status) ?? "").toLowerCase());
  if (!input.cache) flags.push("public_cache_missing");
  if (!active) flags.push("subscription_not_active");
  if (isOlderThan(latestTimestamp([input.cacheStatusAt, input.cacheAdmAt, input.cacheUpdatedAt]), input.now, 30)) flags.push("public_cache_stale");
  if (isNewerBy(input.metadataAt, input.cacheStatusAt, 60)) flags.push("metadata_newer_than_public_cache");
  if (isNewerBy(input.statusAt, input.cacheStatusAt, 60)) flags.push("status_sync_newer_than_public_cache");
  if (isNewerBy(input.admAt, input.cacheAdmAt, 60)) flags.push("adm_newer_than_public_cache");
  if (numberValue(input.sync?.currently_checking_status) === 1 && isOlderThan(stringValue(input.sync?.updated_at), input.now, 10)) flags.push("status_lock_stuck");
  if (numberValue(input.sync?.currently_syncing_adm) === 1 && isOlderThan(stringValue(input.sync?.updated_at), input.now, 30)) flags.push("adm_lock_stuck");
  if (isOlderThan(input.statusAt, input.now, Math.max(getServerStatusInterval(input.planKey) * 3, 5))) flags.push("metadata_status_stale_for_plan");
  return flags;
}

function latestTimestamp(values: Array<string | null | undefined>) {
  const sorted = values
    .filter((value): value is string => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return sorted[0] ?? null;
}

function latestTimestampWithSource(values: Array<[PublicCacheDebugPayload["timestamps"]["profile_last_sync_display_source"], string | null | undefined]>) {
  const sorted = values
    .filter((entry): entry is [PublicCacheDebugPayload["timestamps"]["profile_last_sync_display_source"], string] => typeof entry[1] === "string" && entry[1].length > 0 && Number.isFinite(Date.parse(entry[1])))
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  return sorted[0] ? { source: sorted[0][0], value: sorted[0][1] } : { source: "none" as const, value: null };
}

function ageMinutes(value: string | null, now: string) {
  if (!value) return null;
  const start = Date.parse(value);
  const end = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}

function isDue(value: string | null, now: string) {
  if (!value) return true;
  const due = Date.parse(value);
  const current = Date.parse(now);
  return Number.isFinite(due) && Number.isFinite(current) ? due <= current : true;
}

function isOlderThan(value: string | null, now: string, minutes: number) {
  const age = ageMinutes(value, now);
  return age !== null && age > minutes;
}

function isNewerBy(newer: string | null, older: string | null, seconds: number) {
  if (!newer || !older) return Boolean(newer && !older);
  const newerMs = Date.parse(newer);
  const olderMs = Date.parse(older);
  return Number.isFinite(newerMs) && Number.isFinite(olderMs) && newerMs - olderMs > seconds * 1000;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? null;
}
