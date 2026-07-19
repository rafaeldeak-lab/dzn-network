export const SERVER_LIFECYCLE_STATUSES = [
  "active_live",
  "active_degraded",
  "token_needs_resave",
  "nitrado_upstream_down",
  "stale_monitoring",
  "expired_detected",
  "deletion_imminent",
  "final_sync_pending",
  "final_sync_complete",
  "legacy_offline",
  "archived_hidden",
] as const;

export type ServerLifecycleStatus = typeof SERVER_LIFECYCLE_STATUSES[number];

export type ServerLifecycleTask =
  | "metadata"
  | "player_count"
  | "adm_discovery"
  | "adm_processing"
  | "discord_posting"
  | "server_wars"
  | "public_live";

export type ServerLifecycleRow = {
  lifecycle_status?: unknown;
  status?: unknown;
  linked_status?: unknown;
  listing_visibility?: unknown;
  public_visibility?: unknown;
  owner_action_required?: unknown;
  next_retry_after?: unknown;
  final_sync_attempted_at?: unknown;
};

export const SERVER_LIFECYCLE_STOP_ACTIVE_SYNC: ServerLifecycleStatus[] = [
  "token_needs_resave",
  "final_sync_complete",
  "legacy_offline",
  "archived_hidden",
];

export const SERVER_LIFECYCLE_REDUCED_SYNC: ServerLifecycleStatus[] = [
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
  "expired_detected",
  "deletion_imminent",
  "final_sync_pending",
];

export const SERVER_LIFECYCLE_NORMAL_SYNC: ServerLifecycleStatus[] = ["active_live"];

export const SERVER_LIFECYCLE_ACTIVE_ADM_STATUSES: ServerLifecycleStatus[] = [
  "active_live",
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
  "final_sync_pending",
];

export const SERVER_LIFECYCLE_ACTIVE_METADATA_STATUSES: ServerLifecycleStatus[] = [
  "active_live",
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
];

export const SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES: ServerLifecycleStatus[] = [
  "active_live",
  "active_degraded",
  "nitrado_upstream_down",
  "stale_monitoring",
];

export const SERVER_LIFECYCLE_PUBLIC_HISTORICAL_STATUSES: ServerLifecycleStatus[] = [
  "active_live",
  "active_degraded",
  "token_needs_resave",
  "nitrado_upstream_down",
  "stale_monitoring",
  "expired_detected",
  "deletion_imminent",
  "final_sync_pending",
  "final_sync_complete",
  "legacy_offline",
];

export const SERVER_LIFECYCLE_HEALTH_WARNING_ONLY: ServerLifecycleStatus[] = [
  "token_needs_resave",
  "nitrado_upstream_down",
  "final_sync_complete",
  "legacy_offline",
  "archived_hidden",
];

const SERVER_LIFECYCLE_STATUS_SET = new Set<string>(SERVER_LIFECYCLE_STATUSES);

export function normalizeServerLifecycleStatus(row: ServerLifecycleRow | unknown): ServerLifecycleStatus {
  const record = row && typeof row === "object" ? row as ServerLifecycleRow : { lifecycle_status: row };
  const status = normalizedText(record.status ?? record.linked_status);
  const visibility = normalizedText(record.listing_visibility ?? record.public_visibility);

  if (["deleted", "merged", "archived"].includes(status) || ["hidden", "archived", "deleted"].includes(visibility)) {
    return "archived_hidden";
  }
  if (["inactive", "suspended", "legacy_offline"].includes(status)) {
    return "legacy_offline";
  }

  const lifecycleStatus = normalizedText(record.lifecycle_status);
  if (SERVER_LIFECYCLE_STATUS_SET.has(lifecycleStatus)) return lifecycleStatus as ServerLifecycleStatus;
  return "active_live";
}

export function getServerLifecycleDisplay(status: ServerLifecycleStatus) {
  switch (status) {
    case "active_live":
      return {
        label: "Active live",
        message: "Full sync is enabled.",
        ownerAction: "No action needed.",
      };
    case "active_degraded":
      return {
        label: "Active degraded",
        message: "Sync is running with backoff while DZN preserves the last known good data.",
        ownerAction: "DZN will retry automatically.",
      };
    case "token_needs_resave":
      return {
        label: "Token needs re-save",
        message: "Sync is paused until the Nitrado token can be decrypted and verified again.",
        ownerAction: "Re-save Nitrado token.",
      };
    case "nitrado_upstream_down":
      return {
        label: "Nitrado temporarily unavailable",
        message: "DZN is backing off retries while Nitrado is unavailable.",
        ownerAction: "DZN will retry automatically.",
      };
    case "stale_monitoring":
      return {
        label: "Stale monitoring",
        message: "Server has not produced new readable activity recently, so checks are reduced.",
        ownerAction: "Run a manual check if the server is active again.",
      };
    case "expired_detected":
      return {
        label: "Server appears expired",
        message: "DZN detected an expired or unavailable service and is preparing a bounded final sync.",
        ownerAction: "Reconnect service or run final sync.",
      };
    case "deletion_imminent":
      return {
        label: "Deletion imminent",
        message: "DZN will attempt one bounded final sync before stopping live sync.",
        ownerAction: "Run final sync or mark as legacy/offline.",
      };
    case "final_sync_pending":
      return {
        label: "Final sync pending",
        message: "Only one bounded final sync is eligible. Historical stats will be preserved.",
        ownerAction: "Run final sync.",
      };
    case "final_sync_complete":
      return {
        label: "Final sync completed",
        message: "Live sync has stopped. Historical stats are preserved.",
        ownerAction: "Reactivate sync only if the server is live again.",
      };
    case "legacy_offline":
      return {
        label: "Legacy offline",
        message: "Historical stats are preserved and recurring live sync is stopped.",
        ownerAction: "Reactivate sync if the server returns.",
      };
    case "archived_hidden":
      return {
        label: "Archived / hidden",
        message: "This server is hidden from active public surfaces and no active sync is running.",
        ownerAction: "Reactivate or unhide only if this server is real and live.",
      };
  }
}

export function canRunServerLifecycleTask(row: ServerLifecycleRow, task: ServerLifecycleTask, options: { now?: string | Date; manual?: boolean } = {}) {
  const status = normalizeServerLifecycleStatus(row);
  const manual = options.manual === true;
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.parse(String(options.now ?? new Date().toISOString()));
  const retryDue = isDue(row.next_retry_after, nowMs);

  if (status === "archived_hidden") return { allowed: false, status, skipReason: "skipped_archived" };
  if (status === "legacy_offline") return { allowed: false, status, skipReason: "skipped_legacy" };
  if (status === "final_sync_complete") return { allowed: false, status, skipReason: "skipped_final_sync_complete" };
  if (status === "token_needs_resave" && task !== "public_live") return { allowed: false, status, skipReason: "skipped_token_needs_resave" };

  if (status === "final_sync_pending") {
    const attempted = typeof row.final_sync_attempted_at === "string" && row.final_sync_attempted_at.trim() !== "";
    const allowed = !attempted && (task === "adm_discovery" || task === "adm_processing");
    return { allowed, status, skipReason: allowed ? null : "skipped_final_sync_complete" };
  }

  if (SERVER_LIFECYCLE_REDUCED_SYNC.includes(status) && !retryDue && !manual) {
    return { allowed: false, status, skipReason: "skipped_backoff" };
  }

  if ((task === "metadata" || task === "player_count") && !SERVER_LIFECYCLE_ACTIVE_METADATA_STATUSES.includes(status)) {
    return { allowed: false, status, skipReason: "skipped_inactive" };
  }
  if ((task === "adm_discovery" || task === "adm_processing") && !SERVER_LIFECYCLE_ACTIVE_ADM_STATUSES.includes(status)) {
    return { allowed: false, status, skipReason: "skipped_inactive" };
  }
  if ((task === "public_live" || task === "server_wars") && !SERVER_LIFECYCLE_PUBLIC_LIVE_STATUSES.includes(status)) {
    return { allowed: false, status, skipReason: "skipped_inactive" };
  }
  if (task === "discord_posting" && !["active_live", "active_degraded"].includes(status)) {
    return { allowed: false, status, skipReason: "skipped_inactive" };
  }
  return { allowed: true, status, skipReason: null };
}

export function classifyServerLifecycleError(message: unknown): {
  status: ServerLifecycleStatus | null;
  reason: string | null;
  ownerActionRequired: boolean;
  ownerActionReason: string | null;
  retryAfterMs: number | null;
} {
  const text = String(message ?? "").trim();
  const normalized = text.toLowerCase();
  if (!normalized) {
    return { status: null, reason: null, ownerActionRequired: false, ownerActionReason: null, retryAfterMs: null };
  }
  if (/token_encryption_key|decrypt|ciphertext authentication|aes-gcm|nitrado_auth_invalid|unauthori[sz]ed|forbidden|invalid token|expired token/.test(normalized)) {
    return {
      status: "token_needs_resave",
      reason: "nitrado_token_needs_resave",
      ownerActionRequired: true,
      ownerActionReason: "Re-save Nitrado token.",
      retryAfterMs: null,
    };
  }
  if (/service.*deleted|service.*expired|not found|404|deleted|expired|deletion_imminent/.test(normalized)) {
    return {
      status: "expired_detected",
      reason: "nitrado_service_expired_or_deleted",
      ownerActionRequired: true,
      ownerActionReason: "Reconnect service or run final sync.",
      retryAfterMs: 6 * 60 * 60 * 1000,
    };
  }
  if (/nitrado_upstream_down|upstream|temporar|timeout|timed out|fetch_timeout|rate.?limit|429|500|502|503|504/.test(normalized)) {
    return {
      status: "nitrado_upstream_down",
      reason: "nitrado_upstream_retry_scheduled",
      ownerActionRequired: false,
      ownerActionReason: null,
      retryAfterMs: 15 * 60 * 1000,
    };
  }
  return { status: "active_degraded", reason: "sync_failure_backoff", ownerActionRequired: false, ownerActionReason: null, retryAfterMs: 10 * 60 * 1000 };
}

export function serverLifecycleSqlExpression(alias = "linked_servers") {
  return `CASE
    WHEN lower(COALESCE(${alias}.status, 'pending')) IN ('deleted', 'merged', 'archived') THEN 'archived_hidden'
    WHEN lower(COALESCE(${alias}.listing_visibility, 'public')) IN ('hidden', 'archived', 'deleted') THEN 'archived_hidden'
    WHEN lower(COALESCE(${alias}.status, 'pending')) IN ('inactive', 'suspended', 'legacy_offline') THEN 'legacy_offline'
    ELSE lower(COALESCE(${alias}.lifecycle_status, 'active_live'))
  END`;
}

export function serverLifecycleInSql(values: readonly ServerLifecycleStatus[]) {
  return values.map((value) => `'${value}'`).join(", ");
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isDue(value: unknown, nowMs: number) {
  if (value === null || value === undefined || value === "") return true;
  const timestamp = Date.parse(String(value));
  return !Number.isFinite(timestamp) || timestamp <= nowMs;
}
