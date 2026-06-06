const PUBLIC_PLAYER_COUNT_FRESHNESS_MS = 30 * 60 * 1000;

export const PUBLIC_PLAYER_COUNT_FRESHNESS_CUTOFF_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes')";

export const PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL = `(
  linked_servers.current_players IS NOT NULL
  AND lower(COALESCE(linked_servers.player_count_status, '')) = 'fresh'
  AND linked_servers.player_count_last_checked_at IS NOT NULL
  AND linked_servers.player_count_last_checked_at >= ${PUBLIC_PLAYER_COUNT_FRESHNESS_CUTOFF_SQL}
)`;

export const PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL = `(
  server_public_cache.current_player_count IS NOT NULL
  AND server_public_cache.last_status_update_at IS NOT NULL
  AND server_public_cache.last_status_update_at >= ${PUBLIC_PLAYER_COUNT_FRESHNESS_CUTOFF_SQL}
)`;

export const PUBLIC_CURRENT_PLAYERS_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} THEN linked_servers.current_players
  WHEN ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN server_public_cache.current_player_count
  ELSE NULL
END`;

export const PUBLIC_MAX_PLAYERS_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} THEN COALESCE(linked_servers.max_players, linked_servers.player_slots)
  WHEN ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN COALESCE(server_public_cache.max_player_count, linked_servers.max_players, linked_servers.player_slots)
  ELSE NULL
END`;

export const PUBLIC_PLAYER_COUNT_CHECKED_AT_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} THEN linked_servers.player_count_last_checked_at
  WHEN ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN server_public_cache.last_status_update_at
  ELSE COALESCE(linked_servers.player_count_last_checked_at, server_public_cache.last_status_update_at)
END`;

export const PUBLIC_PLAYER_COUNT_STATUS_SQL = `CASE
  WHEN ${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} OR ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL} THEN 'fresh'
  ELSE 'stale'
END`;

export const PUBLIC_PLAYER_COUNT_FRESH_SQL = `(${PUBLIC_LINKED_PLAYER_COUNT_FRESH_SQL} OR ${PUBLIC_CACHE_PLAYER_COUNT_FRESH_SQL})`;

export type PublicPlayerCountSourceRow = {
  linkedCurrentPlayers?: number | null;
  linkedMaxPlayers?: number | null;
  linkedCheckedAt?: string | null;
  linkedStatus?: string | null;
  cacheCurrentPlayers?: number | null;
  cacheMaxPlayers?: number | null;
  cacheCheckedAt?: string | null;
};

export function resolveFreshPublicPlayerCount(row: PublicPlayerCountSourceRow, nowMs = Date.now()) {
  const linkedCurrent = finiteNumber(row.linkedCurrentPlayers);
  const linkedFresh = linkedCurrent !== null
    && String(row.linkedStatus ?? "").toLowerCase() === "fresh"
    && isFreshTimestamp(row.linkedCheckedAt, nowMs);
  if (linkedFresh) {
    return {
      currentPlayers: linkedCurrent,
      maxPlayers: finiteNumber(row.linkedMaxPlayers),
      checkedAt: row.linkedCheckedAt ?? null,
      status: "fresh" as const,
      source: "linked_servers" as const,
    };
  }

  const cacheCurrent = finiteNumber(row.cacheCurrentPlayers);
  const cacheFresh = cacheCurrent !== null && isFreshTimestamp(row.cacheCheckedAt, nowMs);
  if (cacheFresh) {
    return {
      currentPlayers: cacheCurrent,
      maxPlayers: finiteNumber(row.cacheMaxPlayers) ?? finiteNumber(row.linkedMaxPlayers),
      checkedAt: row.cacheCheckedAt ?? null,
      status: "fresh" as const,
      source: "server_public_cache" as const,
    };
  }

  return {
    currentPlayers: null,
    maxPlayers: null,
    checkedAt: row.linkedCheckedAt ?? row.cacheCheckedAt ?? null,
    status: "stale" as const,
    source: "none" as const,
  };
}

export function sumFreshPublicPlayers(rows: PublicPlayerCountSourceRow[], nowMs = Date.now()) {
  return rows.reduce((total, row) => total + (resolveFreshPublicPlayerCount(row, nowMs).currentPlayers ?? 0), 0);
}

function isFreshTimestamp(value: string | null | undefined, nowMs: number) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) && nowMs - time <= PUBLIC_PLAYER_COUNT_FRESHNESS_MS;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
