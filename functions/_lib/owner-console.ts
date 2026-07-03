import {
  SERVER_LIFECYCLE_STATUSES,
  canRunServerLifecycleTask,
  getServerLifecycleDisplay,
  normalizeServerLifecycleStatus,
  type ServerLifecycleStatus,
  type ServerLifecycleTask,
} from "../../lib/server-lifecycle";
import { readDznFeatureFlags } from "./feature-flags";
import type { Env } from "./types";

const KNOWN_SERVERS = {
  nuketownServiceId: "18765761",
  warlordsServiceId: "900002",
};

const LIFECYCLE_OWNER_LABELS: Record<ServerLifecycleStatus, string> = {
  active_live: "Live sync active",
  active_degraded: "Live but degraded",
  token_needs_resave: "Token needs re-save",
  nitrado_upstream_down: "Nitrado temporarily unavailable",
  stale_monitoring: "Stale monitoring",
  expired_detected: "Server appears expired",
  deletion_imminent: "Deletion may be imminent",
  final_sync_pending: "Final sync pending",
  final_sync_complete: "Final sync complete - live sync stopped",
  legacy_offline: "Legacy offline - historical stats preserved",
  archived_hidden: "Archived / hidden - active sync disabled",
};

export type OwnerResourceTaskState = {
  task: ServerLifecycleTask;
  enabled: boolean;
  skipReason: string | null;
};

export type OwnerServerResourceState = {
  admSyncEnabled: boolean;
  metadataRefreshEnabled: boolean;
  playerCountPollingEnabled: boolean;
  discordPostingEnabled: boolean;
  serverWarsEligible: boolean;
  publicLiveEligible: boolean;
  consumingScheduledResources: boolean;
  excludedFromActiveSync: boolean;
  skippedReason: string | null;
  tasks: OwnerResourceTaskState[];
};

export type OwnerServerRow = {
  id: string;
  serverName: string;
  slug: string | null;
  owner: {
    userId: string | null;
    username: string | null;
    discordId: string | null;
  };
  guild: {
    guildId: string | null;
    discordGuildId: string | null;
    name: string | null;
  };
  nitradoServiceId: string | null;
  nitradoServiceName: string | null;
  serverType: string | null;
  status: string | null;
  listingVisibility: string | null;
  lifecycleStatus: ServerLifecycleStatus;
  lifecycleLabel: string;
  lifecycleMessage: string;
  lifecycleReason: string | null;
  ownerActionRequired: boolean;
  ownerActionReason: string | null;
  syncResourceStatus: "active" | "reduced" | "stopped";
  playerCount: {
    current: number | null;
    max: number | null;
    status: string | null;
    source: string | null;
    freshness: string | null;
    lastSuccessfulCheckAt: string | null;
    lastFailedCheckAt: string | null;
  };
  adm: {
    latestFile: string | null;
    latestProcessedFile: string | null;
    lastProcessedOffset: number | null;
    lastProcessedLine: number | null;
    latestImportedEventAt: string | null;
    lastSuccessfulImportAt: string | null;
    lastAttemptedReadAt: string | null;
    status: string | null;
  };
  tokenStatus: "readable" | "decrypt_failed" | "needs_resave" | "unknown";
  publicProfileUrl: string | null;
  dashboardUrl: string | null;
  plan: {
    key: string | null;
    status: string | null;
  };
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalJoins: number;
    totalDisconnects: number;
    uniquePlayers: number;
    buildScore: number;
    lastEventAt: string | null;
    lastBuildAt: string | null;
  };
  resource: OwnerServerResourceState;
  nextRetryAfter: string | null;
  nextMetadataCheckAt: string | null;
  nextPlayerCountCheckAt: string | null;
  nextAdmDiscoveryAt: string | null;
  nextAdmProcessingAt: string | null;
  lastSkipReason: string | null;
  badges: string[];
  knownRole: "nuketown" | "pandora" | "warlords" | null;
};

export type OwnerOverview = {
  counts: {
    totalLinkedServers: number;
    serversConsumingSyncResources: number;
    serversSkippedFromSync: number;
  } & Record<ServerLifecycleStatus, number>;
  featureFlags: {
    dznPulseEnabled: boolean;
    discordNotificationsEnabled: boolean;
    freeProAdvertisingStatus: "live";
  };
  ownerAccess: {
    allowlistConfigured: boolean;
  };
  knownServers: {
    nuketown: KnownServerSummary | null;
    pandora: KnownServerSummary | null;
    warlords: KnownServerSummary | null;
  };
  health: {
    publicRoutes: StoredJobHealth | null;
    admCycleWatch: StoredJobHealth | null;
    autoUpdateScheduler: StoredJobHealth | null;
  };
  generatedAt: string;
};

export type KnownServerSummary = {
  id: string;
  name: string;
  status: string | null;
  lifecycleStatus: ServerLifecycleStatus;
  lifecycleLabel: string;
  publicVisibility: string | null;
  latestAdmFile: string | null;
  latestImportedEventAt: string | null;
  playerCount: string;
};

export type StoredJobHealth = {
  source: string | null;
  jobType: string | null;
  status: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  processedCount: number | null;
  skippedCount: number | null;
  failedCount: number | null;
  error: string | null;
};

export type OwnerAuditLog = {
  items: never[];
  message: string;
  phase: "phase_1_read_only";
};

type OwnerServerRecord = Record<string, unknown>;

export function getOwnerLifecycleLabel(status: ServerLifecycleStatus) {
  return LIFECYCLE_OWNER_LABELS[status];
}

export async function getOwnerOverview(env: Env): Promise<OwnerOverview> {
  const [servers, publicRoutes, admCycleWatch, autoUpdateScheduler] = await Promise.all([
    getOwnerServers(env),
    getLatestStoredJobHealth(env, ["public", "production-smoke", "route-health"]),
    getLatestStoredJobHealth(env, ["adm", "adm-cycle-watch", "adm-cycle"]),
    getLatestStoredJobHealth(env, ["metadata", "player-count", "server-wars", "auto-update"]),
  ]);

  const counts = createLifecycleCounts();
  let serversConsumingSyncResources = 0;
  let serversSkippedFromSync = 0;

  for (const server of servers) {
    counts[server.lifecycleStatus] += 1;
    if (server.resource.consumingScheduledResources) serversConsumingSyncResources += 1;
    if (server.resource.excludedFromActiveSync) serversSkippedFromSync += 1;
  }

  const flags = readDznFeatureFlags(env);

  return {
    counts: {
      ...counts,
      totalLinkedServers: servers.length,
      serversConsumingSyncResources,
      serversSkippedFromSync,
    },
    featureFlags: {
      dznPulseEnabled: flags.dznPulseEnabled,
      discordNotificationsEnabled: flags.discordNotificationsEnabled,
      freeProAdvertisingStatus: "live",
    },
    ownerAccess: {
      allowlistConfigured: String(env.DZN_PLATFORM_OWNER_DISCORD_IDS ?? "").trim().length > 0,
    },
    knownServers: {
      nuketown: toKnownServerSummary(servers.find((server) => server.knownRole === "nuketown")),
      pandora: toKnownServerSummary(servers.find((server) => server.knownRole === "pandora")),
      warlords: toKnownServerSummary(servers.find((server) => server.knownRole === "warlords")),
    },
    health: {
      publicRoutes,
      admCycleWatch,
      autoUpdateScheduler,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function getOwnerServers(env: Env): Promise<OwnerServerRow[]> {
  const result = await env.DB.prepare(
    `SELECT
       linked_servers.id,
       linked_servers.user_id,
       linked_servers.guild_id,
       linked_servers.discord_guild_id,
       linked_servers.nitrado_service_id,
       linked_servers.nitrado_service_name,
       linked_servers.server_name,
       linked_servers.server_type,
       linked_servers.status,
       linked_servers.public_slug,
       linked_servers.listing_visibility,
       linked_servers.lifecycle_status,
       linked_servers.lifecycle_reason,
       linked_servers.lifecycle_updated_at,
       linked_servers.owner_action_required,
       linked_servers.owner_action_reason,
       linked_servers.stale_since,
       linked_servers.expired_detected_at,
       linked_servers.final_sync_attempted_at,
       linked_servers.final_sync_completed_at,
       linked_servers.final_sync_result,
       linked_servers.final_adm_filename,
       linked_servers.latest_imported_event_at,
       linked_servers.updated_at,
       users.discord_id AS owner_discord_id,
       users.username AS owner_username,
       discord_guilds.guild_id AS stored_discord_guild_id,
       discord_guilds.name AS discord_guild_name,
       server_subscriptions.plan_key AS subscription_plan_key,
       server_subscriptions.status AS subscription_status,
       server_sync_state.current_player_count,
       server_sync_state.max_player_count,
       server_sync_state.server_online,
       server_sync_state.server_status,
       server_sync_state.status_data_freshness,
       server_sync_state.last_successful_status_check_at,
       server_sync_state.last_failed_status_check_at,
       server_sync_state.last_status_error,
       server_sync_state.last_seen_adm_filename,
       server_sync_state.last_processed_adm_filename,
       server_sync_state.last_processed_adm_offset,
       server_sync_state.last_successful_adm_pull_at,
       server_sync_state.last_failed_adm_pull_at,
       server_sync_state.last_adm_error,
       server_sync_state.adm_status,
       server_sync_state.next_metadata_check_at,
       server_sync_state.next_player_count_check_at,
       server_sync_state.next_adm_discovery_at,
       server_sync_state.next_adm_processing_at,
       server_sync_state.next_retry_after,
       server_sync_state.last_skip_reason,
       adm_sync_state.latest_adm_file,
       adm_sync_state.last_processed_file,
       adm_sync_state.last_processed_line,
       adm_sync_state.last_processed_offset,
       adm_sync_state.last_sync_status,
       adm_sync_state.last_sync_message,
       adm_sync_state.last_sync_at,
       COALESCE(server_stats.total_kills, 0) AS total_kills,
       COALESCE(server_stats.total_deaths, 0) AS total_deaths,
       COALESCE(server_stats.total_joins, 0) AS total_joins,
       COALESCE(server_stats.total_disconnects, 0) AS total_disconnects,
       COALESCE(server_stats.unique_players, 0) AS unique_players,
       server_stats.last_event_at,
       COALESCE(server_build_stats.build_score, 0) AS build_score,
       server_build_stats.last_build_at,
       server_public_cache.current_player_count AS public_current_player_count,
       server_public_cache.max_player_count AS public_max_player_count,
       server_public_cache.server_status AS public_server_status
     FROM linked_servers
     LEFT JOIN users ON users.id = linked_servers.user_id
     LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
     LEFT JOIN server_subscriptions ON server_subscriptions.guild_id = linked_servers.guild_id
     LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
     LEFT JOIN adm_sync_state ON adm_sync_state.linked_server_id = linked_servers.id
     LEFT JOIN server_stats ON server_stats.linked_server_id = linked_servers.id
     LEFT JOIN server_build_stats ON server_build_stats.linked_server_id = linked_servers.id
     LEFT JOIN server_public_cache ON server_public_cache.guild_id = linked_servers.guild_id
     ORDER BY
       CASE lower(COALESCE(linked_servers.lifecycle_status, 'active_live'))
         WHEN 'active_live' THEN 0
         WHEN 'active_degraded' THEN 1
         WHEN 'nitrado_upstream_down' THEN 2
         WHEN 'token_needs_resave' THEN 3
         WHEN 'legacy_offline' THEN 8
         WHEN 'archived_hidden' THEN 9
         ELSE 5
       END,
       lower(linked_servers.server_name) ASC`,
  ).all<OwnerServerRecord>();

  return (result.results ?? []).map(mapOwnerServerRow);
}

export async function getOwnerServer(env: Env, serverId: string): Promise<OwnerServerRow | null> {
  const server = (await getOwnerServers(env)).find((row) => row.id === serverId || row.slug === serverId);
  return server ?? null;
}

export function getOwnerAuditLog(): OwnerAuditLog {
  return {
    items: [],
    message: "No owner actions recorded yet.",
    phase: "phase_1_read_only",
  };
}

export function buildOwnerResourceState(row: {
  lifecycle_status?: unknown;
  status?: unknown;
  listing_visibility?: unknown;
  next_retry_after?: unknown;
  final_sync_attempted_at?: unknown;
  last_skip_reason?: unknown;
}): OwnerServerResourceState {
  const tasks: OwnerResourceTaskState[] = [
    "adm_discovery",
    "adm_processing",
    "metadata",
    "player_count",
    "discord_posting",
    "server_wars",
    "public_live",
  ].map((task) => {
    const result = canRunServerLifecycleTask(row, task as ServerLifecycleTask);
    return { task: task as ServerLifecycleTask, enabled: result.allowed, skipReason: result.skipReason };
  });

  const findTask = (task: ServerLifecycleTask) => tasks.find((entry) => entry.task === task);
  const scheduledTasks = tasks.filter((entry) => ["adm_discovery", "adm_processing", "metadata", "player_count"].includes(entry.task));
  const consumingScheduledResources = scheduledTasks.some((entry) => entry.enabled);
  const excludedFromActiveSync = scheduledTasks.every((entry) => !entry.enabled);
  const skippedReason =
    normalizedText(row.last_skip_reason) ||
    scheduledTasks.find((entry) => entry.skipReason)?.skipReason ||
    tasks.find((entry) => entry.skipReason)?.skipReason ||
    null;

  return {
    admSyncEnabled: Boolean(findTask("adm_discovery")?.enabled || findTask("adm_processing")?.enabled),
    metadataRefreshEnabled: Boolean(findTask("metadata")?.enabled),
    playerCountPollingEnabled: Boolean(findTask("player_count")?.enabled),
    discordPostingEnabled: Boolean(findTask("discord_posting")?.enabled),
    serverWarsEligible: Boolean(findTask("server_wars")?.enabled),
    publicLiveEligible: Boolean(findTask("public_live")?.enabled),
    consumingScheduledResources,
    excludedFromActiveSync,
    skippedReason,
    tasks,
  };
}

function mapOwnerServerRow(row: OwnerServerRecord): OwnerServerRow {
  const lifecycleStatus = normalizeServerLifecycleStatus({
    lifecycle_status: row.lifecycle_status,
    status: row.status,
    listing_visibility: row.listing_visibility,
    next_retry_after: row.next_retry_after,
    final_sync_attempted_at: row.final_sync_attempted_at,
  });
  const display = getServerLifecycleDisplay(lifecycleStatus);
  const lifecycleLabel = getOwnerLifecycleLabel(lifecycleStatus);
  const resource = buildOwnerResourceState({
    lifecycle_status: row.lifecycle_status,
    status: row.status,
    listing_visibility: row.listing_visibility,
    next_retry_after: row.next_retry_after,
    final_sync_attempted_at: row.final_sync_attempted_at,
    last_skip_reason: row.last_skip_reason,
  });

  const latestAdmFile = stringOrNull(row.latest_adm_file) ?? stringOrNull(row.last_seen_adm_filename);
  const latestProcessedFile = stringOrNull(row.last_processed_file) ?? stringOrNull(row.last_processed_adm_filename);
  const latestImportedEventAt =
    stringOrNull(row.latest_imported_event_at) ??
    stringOrNull(row.last_event_at) ??
    stringOrNull(row.last_build_at) ??
    stringOrNull(row.last_sync_at);
  const lastSuccessfulImportAt = stringOrNull(row.last_sync_at) ?? stringOrNull(row.last_successful_adm_pull_at);
  const tokenStatus = inferSafeTokenStatus(row, lifecycleStatus);
  const slug = stringOrNull(row.public_slug);
  const knownRole = inferKnownServerRole(row);

  return {
    id: String(row.id ?? ""),
    serverName: stringOrNull(row.server_name) ?? "Unnamed server",
    slug,
    owner: {
      userId: stringOrNull(row.user_id),
      username: stringOrNull(row.owner_username),
      discordId: maskDiscordId(row.owner_discord_id),
    },
    guild: {
      guildId: stringOrNull(row.guild_id),
      discordGuildId: stringOrNull(row.stored_discord_guild_id) ?? stringOrNull(row.discord_guild_id),
      name: stringOrNull(row.discord_guild_name),
    },
    nitradoServiceId: stringOrNull(row.nitrado_service_id),
    nitradoServiceName: stringOrNull(row.nitrado_service_name),
    serverType: stringOrNull(row.server_type),
    status: stringOrNull(row.status),
    listingVisibility: stringOrNull(row.listing_visibility),
    lifecycleStatus,
    lifecycleLabel,
    lifecycleMessage: display.message,
    lifecycleReason: safeStatusText(row.lifecycle_reason),
    ownerActionRequired: truthy(row.owner_action_required),
    ownerActionReason: safeStatusText(row.owner_action_reason),
    syncResourceStatus: resource.consumingScheduledResources ? (lifecycleStatus === "active_live" ? "active" : "reduced") : "stopped",
    playerCount: {
      current: numberOrNull(row.current_player_count ?? row.public_current_player_count),
      max: numberOrNull(row.max_player_count ?? row.public_max_player_count),
      status: stringOrNull(row.server_status ?? row.public_server_status),
      source: inferPlayerCountSource(row),
      freshness: stringOrNull(row.status_data_freshness),
      lastSuccessfulCheckAt: stringOrNull(row.last_successful_status_check_at),
      lastFailedCheckAt: stringOrNull(row.last_failed_status_check_at),
    },
    adm: {
      latestFile: latestAdmFile,
      latestProcessedFile,
      lastProcessedOffset: numberOrNull(row.last_processed_offset ?? row.last_processed_adm_offset),
      lastProcessedLine: numberOrNull(row.last_processed_line),
      latestImportedEventAt,
      lastSuccessfulImportAt,
      lastAttemptedReadAt: stringOrNull(row.last_sync_at) ?? stringOrNull(row.last_failed_adm_pull_at),
      status: stringOrNull(row.last_sync_status ?? row.adm_status),
    },
    tokenStatus,
    publicProfileUrl: slug ? `/servers/profile?slug=${encodeURIComponent(slug)}` : null,
    dashboardUrl: `/dashboard?server=${encodeURIComponent(String(row.id ?? ""))}`,
    plan: {
      key: stringOrNull(row.subscription_plan_key),
      status: stringOrNull(row.subscription_status),
    },
    stats: {
      totalKills: numberOrZero(row.total_kills),
      totalDeaths: numberOrZero(row.total_deaths),
      totalJoins: numberOrZero(row.total_joins),
      totalDisconnects: numberOrZero(row.total_disconnects),
      uniquePlayers: numberOrZero(row.unique_players),
      buildScore: numberOrZero(row.build_score),
      lastEventAt: stringOrNull(row.last_event_at),
      lastBuildAt: stringOrNull(row.last_build_at),
    },
    resource,
    nextRetryAfter: stringOrNull(row.next_retry_after),
    nextMetadataCheckAt: stringOrNull(row.next_metadata_check_at),
    nextPlayerCountCheckAt: stringOrNull(row.next_player_count_check_at),
    nextAdmDiscoveryAt: stringOrNull(row.next_adm_discovery_at),
    nextAdmProcessingAt: stringOrNull(row.next_adm_processing_at),
    lastSkipReason: stringOrNull(row.last_skip_reason),
    badges: buildLifecycleBadges(lifecycleStatus),
    knownRole,
  };
}

export const mapOwnerServerRowForTest = mapOwnerServerRow;

function createLifecycleCounts() {
  return Object.fromEntries(SERVER_LIFECYCLE_STATUSES.map((status) => [status, 0])) as Record<ServerLifecycleStatus, number>;
}

function buildLifecycleBadges(status: ServerLifecycleStatus) {
  const badges: string[] = [];
  if (status === "active_live") badges.push("Active");
  if (status === "active_degraded") badges.push("Degraded");
  if (status === "token_needs_resave") badges.push("Token Needs Re-save");
  if (status === "legacy_offline") badges.push("Legacy / Offline");
  if (status === "archived_hidden") badges.push("Archived / Hidden");
  if (status === "nitrado_upstream_down") badges.push("Nitrado Down");
  if (status === "final_sync_complete") badges.push("Final Sync Complete");
  if (status === "final_sync_pending") badges.push("Final Sync Pending");
  return badges;
}

function inferKnownServerRole(row: OwnerServerRecord): OwnerServerRow["knownRole"] {
  const serviceId = stringOrNull(row.nitrado_service_id);
  const haystack = `${row.server_name ?? ""} ${row.nitrado_service_name ?? ""} ${row.public_slug ?? ""}`.toLowerCase();
  if (serviceId === KNOWN_SERVERS.nuketownServiceId || haystack.includes("nuketown")) return "nuketown";
  if (serviceId === KNOWN_SERVERS.warlordsServiceId || haystack.includes("warlords")) return "warlords";
  if (haystack.includes("pandora")) return "pandora";
  return null;
}

function inferSafeTokenStatus(row: OwnerServerRecord, lifecycleStatus: ServerLifecycleStatus): OwnerServerRow["tokenStatus"] {
  if (lifecycleStatus === "token_needs_resave") return "needs_resave";
  const text = [
    row.lifecycle_reason,
    row.owner_action_reason,
    row.last_status_error,
    row.last_adm_error,
    row.last_sync_message,
  ].map((entry) => String(entry ?? "").toLowerCase()).join(" ");
  if (/decrypt|aes-gcm|ciphertext|authentication failed/.test(text)) return "decrypt_failed";
  if (row.nitrado_service_id && (row.last_successful_status_check_at || row.last_successful_adm_pull_at || row.latest_adm_file)) {
    return "readable";
  }
  return "unknown";
}

function inferPlayerCountSource(row: OwnerServerRecord) {
  const freshness = normalizedText(row.status_data_freshness);
  if (freshness.includes("nitrado")) return "nitrado";
  if (freshness.includes("query")) return "query_port";
  if (freshness.includes("adm")) return "adm_playerlist";
  if (row.current_player_count !== null && row.current_player_count !== undefined) return "stored";
  if (row.public_current_player_count !== null && row.public_current_player_count !== undefined) return "public_cache";
  return null;
}

function toKnownServerSummary(server?: OwnerServerRow): KnownServerSummary | null {
  if (!server) return null;
  return {
    id: server.id,
    name: server.serverName,
    status: server.status,
    lifecycleStatus: server.lifecycleStatus,
    lifecycleLabel: server.lifecycleLabel,
    publicVisibility: server.listingVisibility,
    latestAdmFile: server.adm.latestFile,
    latestImportedEventAt: server.adm.latestImportedEventAt,
    playerCount: `${server.playerCount.current ?? "unknown"} / ${server.playerCount.max ?? "unknown"}`,
  };
}

async function getLatestStoredJobHealth(env: Env, jobTypes: string[]): Promise<StoredJobHealth | null> {
  try {
    const placeholders = jobTypes.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `SELECT source, job_type, status, created_at, started_at, finished_at, processed_count, skipped_count, failed_count, error_message
       FROM automation_cron_runs
       WHERE lower(COALESCE(job_type, endpoint, source, '')) IN (${placeholders})
          OR lower(COALESCE(endpoint, source, '')) IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(...jobTypes.map((entry) => entry.toLowerCase()), ...jobTypes.map((entry) => entry.toLowerCase())).first<Record<string, unknown>>();
    if (!result) return null;
    return {
      source: stringOrNull(result.source),
      jobType: stringOrNull(result.job_type),
      status: stringOrNull(result.status),
      createdAt: stringOrNull(result.created_at),
      startedAt: stringOrNull(result.started_at),
      finishedAt: stringOrNull(result.finished_at),
      processedCount: numberOrNull(result.processed_count),
      skippedCount: numberOrNull(result.skipped_count),
      failedCount: numberOrNull(result.failed_count),
      error: safeStatusText(result.error_message),
    };
  } catch {
    return null;
  }
}

function truthy(value: unknown) {
  if (typeof value === "number") return value !== 0;
  const normalized = normalizedText(value);
  return ["1", "true", "yes", "on"].includes(normalized);
}

function stringOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberOrZero(value: unknown) {
  return numberOrNull(value) ?? 0;
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function safeStatusText(value: unknown) {
  const text = stringOrNull(value);
  if (!text) return null;
  return text
    .replace(/[A-Za-z0-9+/=]{32,}/g, "[redacted]")
    .replace(/(token|secret|key)=\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function maskDiscordId(value: unknown) {
  const text = stringOrNull(value);
  if (!text) return null;
  if (text.length <= 8) return "[redacted]";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
