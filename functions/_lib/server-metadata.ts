import { decryptToken, sha256 } from "./crypto";
import {
  type AutomationSyncServer,
  getAutomationContextForLinkedServer,
  getDueStatusAutomationServers,
  markStatusCheckStarted,
  queueDiscordPostUpdatesForGuild,
  recordStatusCheckResult,
  upsertServerPublicCache,
} from "./automation";
import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import { geolocateServerIp, shouldRefreshServerGeo } from "./geoip";
import { isMockNitrado } from "./mock";
import { patchHomeStatsPlayerCountsFromFreshMetadata } from "./player-counts";
import type { Env } from "./types";

const NITRADO_API = "https://api.nitrado.net";
const METADATA_STALE_MS = 2 * 60 * 1000;
export type PlayerCountStatus = "fresh" | "stale" | "unavailable" | "unknown";

export type ScheduledMetadataSyncServerResult = {
  linked_server_id: string;
  service_id: string | null;
  server_name: string | null;
  status: "succeeded" | "failed" | "skipped";
  changed: boolean;
  current_players: number | null;
  max_players: number | null;
  player_count_status: PlayerCountStatus;
  player_count_last_checked_at: string | null;
  metadata_last_checked_at: string | null;
  message: string;
};

export type ScheduledMetadataSyncResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  updated_player_counts: number;
  budget_exhausted?: boolean;
  results: ScheduledMetadataSyncServerResult[];
};

export type LinkedServerMetadata = {
  hostname: string | null;
  description: string | null;
  max_players: number | null;
  current_players: number | null;
  ip_address: string | null;
  game_port: number | null;
  query_port: number | null;
  map_name: string | null;
  mission: string | null;
  server_status: string | null;
  is_online: boolean;
  game: string | null;
  platform: string | null;
  server_mode: string;
  server_mode_source: "auto" | "manual";
  raw_metadata: Record<string, unknown>;
  metadata_hash: string;
  metadata_last_checked_at: string;
  player_count_last_checked_at: string;
  player_count_source: "nitrado" | "mock_nitrado";
  player_count_status: PlayerCountStatus;
};

type LinkedServerMetadataRow = {
  id: string;
  user_id: string;
  nitrado_service_id: string | null;
  nitrado_service_name: string | null;
  server_name: string | null;
  server_type: string | null;
  tags_json: string | null;
  region: string | null;
  platform: string | null;
  display_name: string | null;
  hostname: string | null;
  max_players: number | null;
  current_players: number | null;
  ip_address: string | null;
  server_status: string | null;
  server_mode: string | null;
  server_mode_source: string | null;
  metadata_hash: string | null;
  metadata_last_checked_at: string | null;
  metadata_last_changed_at: string | null;
  player_count_last_checked_at: string | null;
  player_count_source: string | null;
  player_count_status: string | null;
  geo_latitude: number | null;
  geo_longitude: number | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  geo_timezone: string | null;
  geo_source: string | null;
  geo_last_checked_at: string | null;
};

export async function refreshNitradoServerMetadata(
  env: Env,
  options: { linkedServerId: string; userId?: string | null; force?: boolean; softFail?: boolean },
) {
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  await ensureServerMetadataVersionsTable(env);

  const linkedServer = await getLinkedServerMetadataRow(env, options.linkedServerId, options.userId);
  if (!linkedServer) throw new Error("Linked server not found");
  if (!linkedServer.nitrado_service_id) throw new Error("No Nitrado service selected");

  const now = new Date().toISOString();
  if (!options.force && !isMetadataStale(linkedServer.metadata_last_checked_at)) {
    const geo = await resolveGeoUpdate(linkedServer, linkedServer.ip_address, now);
    if (geo) await updateLinkedServerGeo(db, linkedServer.id, geo, now);
    return {
      ok: true,
      changed: false,
      skipped: true,
      message: "Server metadata is fresh",
      metadata_last_checked_at: linkedServer.metadata_last_checked_at,
      metadata_last_changed_at: linkedServer.metadata_last_changed_at,
      metadata_source: "nitrado",
      player_count_last_checked_at: linkedServer.player_count_last_checked_at,
      player_count_source: linkedServer.player_count_source ?? "nitrado",
      player_count_status: normalizePlayerCountStatus(linkedServer.player_count_status),
      metadata: rowToMetadata(linkedServer),
    };
  }

  let metadata: LinkedServerMetadata;
  try {
    metadata = isMockNitrado(env.MOCK_NITRADO)
      ? await mockMetadata(linkedServer, now)
      : await fetchNitradoServerMetadata(env, linkedServer, now);
  } catch (error) {
    await updatePlayerCountFreshness(db, linkedServer.id, {
      checkedAt: now,
      source: "nitrado",
      status: "unavailable",
    });
    console.log("DZN LIVE PLAYER COUNT AUTO REFRESH READY", {
      linkedServerId: linkedServer.id,
      current_players: linkedServer.current_players,
      max_players: linkedServer.max_players,
      status: "unavailable",
    });
    if (options.softFail) {
      return {
        ok: false,
        changed: false,
        skipped: false,
        message: "Nitrado metadata unavailable; keeping previous live player count",
        metadata_last_checked_at: now,
        metadata_last_changed_at: linkedServer.metadata_last_changed_at,
        metadata_source: "nitrado",
        player_count_last_checked_at: now,
        player_count_source: "nitrado",
        player_count_status: "unavailable" as const,
        metadata: {
          ...rowToMetadata(linkedServer),
          metadata_last_checked_at: now,
          player_count_last_checked_at: now,
          player_count_source: "nitrado",
          player_count_status: "unavailable" as const,
        },
      };
    }
    throw error;
  }
  const metadataSource = isMockNitrado(env.MOCK_NITRADO) ? "mock_nitrado" : "nitrado";
  const geo = await resolveGeoUpdate(linkedServer, metadata.ip_address, now);
  const displayName = firstString(metadata.hostname, linkedServer.nitrado_service_name, linkedServer.server_name) ?? "DayZ Server";
  const changes = buildMetadataChanges(linkedServer, metadata, displayName);
  const changed = changes.length > 0 || linkedServer.metadata_hash !== metadata.metadata_hash;
  const previousHash = linkedServer.metadata_hash;

  await db
    .prepare(
      `UPDATE linked_servers SET
        display_name = ?,
        hostname = ?,
        description = ?,
        max_players = ?,
        current_players = ?,
        ip_address = ?,
        game_port = ?,
        query_port = ?,
        map_name = ?,
        mission = ?,
        server_status = ?,
        is_online = ?,
        server_mode = ?,
        server_mode_source = ?,
        metadata_hash = ?,
        metadata_last_checked_at = ?,
        metadata_last_changed_at = CASE WHEN ? THEN ? ELSE metadata_last_changed_at END,
        player_count_last_checked_at = ?,
        player_count_source = ?,
        player_count_status = ?,
        raw_metadata_json = ?,
        server_name = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE server_name END,
        nitrado_service_name = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE nitrado_service_name END,
        region = COALESCE(?, region),
        player_slots = COALESCE(?, player_slots),
        game = COALESCE(?, game),
        platform = COALESCE(?, platform),
        geo_latitude = CASE WHEN ? THEN ? ELSE geo_latitude END,
        geo_longitude = CASE WHEN ? THEN ? ELSE geo_longitude END,
        geo_country = CASE WHEN ? THEN ? ELSE geo_country END,
        geo_region = CASE WHEN ? THEN ? ELSE geo_region END,
        geo_city = CASE WHEN ? THEN ? ELSE geo_city END,
        geo_timezone = CASE WHEN ? THEN ? ELSE geo_timezone END,
        geo_source = CASE WHEN ? THEN ? ELSE geo_source END,
        geo_last_checked_at = CASE WHEN ? THEN ? ELSE geo_last_checked_at END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      displayName,
      metadata.hostname,
      metadata.description,
      metadata.max_players,
      metadata.current_players,
      metadata.ip_address,
      metadata.game_port,
      metadata.query_port,
      metadata.map_name,
      metadata.mission,
      metadata.server_status,
      metadata.is_online ? 1 : 0,
      metadata.server_mode,
      metadata.server_mode_source,
      metadata.metadata_hash,
      metadata.metadata_last_checked_at,
      changed ? 1 : 0,
      changed ? metadata.metadata_last_checked_at : null,
      metadata.player_count_last_checked_at,
      metadata.player_count_source,
      metadata.player_count_status,
      JSON.stringify(metadata.raw_metadata),
      displayName,
      displayName,
      displayName,
      displayName,
      displayName,
      displayName,
      metadata.ip_address,
      metadata.max_players,
      metadata.game,
      metadata.platform,
      geo ? 1 : 0,
      geo?.latitude ?? null,
      geo ? 1 : 0,
      geo?.longitude ?? null,
      geo ? 1 : 0,
      geo?.country ?? null,
      geo ? 1 : 0,
      geo?.region ?? null,
      geo ? 1 : 0,
      geo?.city ?? null,
      geo ? 1 : 0,
      geo?.timezone ?? null,
      geo ? 1 : 0,
      geo?.source ?? null,
      geo ? 1 : 0,
      geo ? now : null,
      linkedServer.id,
    )
    .run();

  if (geo) {
    console.log("DZN SERVER GEO LOCATION UPDATED", {
      linkedServerId: linkedServer.id,
      serviceId: linkedServer.nitrado_service_id,
      source: geo.source,
      approximate: geo.approximate,
      hasCoordinates: geo.latitude !== null && geo.longitude !== null,
    });
  }

  console.log("DZN LIVE PLAYER COUNT FIXED", {
    linkedServerId: linkedServer.id,
    current_players: metadata.current_players,
    max_players: metadata.max_players,
  });
  console.log("DZN LIVE PLAYER COUNT AUTO REFRESH READY", {
    linkedServerId: linkedServer.id,
    current_players: metadata.current_players,
    max_players: metadata.max_players,
    status: metadata.player_count_status,
  });

  if (changed && metadata.metadata_hash !== previousHash) {
    await db
      .prepare(
        `INSERT INTO server_metadata_versions (id, linked_server_id, metadata_hash, changes_json, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(crypto.randomUUID(), linkedServer.id, metadata.metadata_hash, JSON.stringify(changes.slice(0, 12)))
      .run();
  }

  console.log("DZN SERVER METADATA AUTO SYNC COMPLETE");
  await syncPublicCacheFromMetadataRefresh(env, linkedServer.id, displayName, metadata).catch((error) => {
    console.warn("DZN SERVER PUBLIC CACHE METADATA REFRESH SKIPPED", error instanceof Error ? error.message : "public cache update failed");
  });

  return {
    ok: true,
    changed,
    skipped: false,
    message: changed ? "Server info updated from Nitrado" : "Server info checked; no changes found",
    metadata_last_checked_at: metadata.metadata_last_checked_at,
    metadata_last_changed_at: changed ? metadata.metadata_last_checked_at : linkedServer.metadata_last_changed_at,
    metadata_source: metadataSource,
    player_count_last_checked_at: metadata.player_count_last_checked_at,
    player_count_source: metadata.player_count_source,
    player_count_status: metadata.player_count_status,
    metadata: {
      hostname: metadata.hostname,
      display_name: displayName,
      current_players: metadata.current_players,
      max_players: metadata.max_players,
      server_mode: metadata.server_mode,
      server_mode_source: metadata.server_mode_source,
      server_status: metadata.server_status,
      game: metadata.game,
      platform: metadata.platform,
      map_name: metadata.map_name,
      mission: metadata.mission,
      is_online: metadata.is_online,
      metadata_last_checked_at: metadata.metadata_last_checked_at,
      metadata_last_changed_at: changed ? metadata.metadata_last_checked_at : linkedServer.metadata_last_changed_at,
      metadata_source: metadataSource,
      player_count_last_checked_at: metadata.player_count_last_checked_at,
      player_count_source: metadata.player_count_source,
      player_count_status: metadata.player_count_status,
      changed_fields: changes.map((change) => change.field),
    },
  };
}

async function syncPublicCacheFromMetadataRefresh(env: Env, linkedServerId: string, displayName: string, metadata: LinkedServerMetadata) {
  if (metadata.player_count_status !== "fresh") return;
  const context = await getAutomationContextForLinkedServer(env, linkedServerId);
  if (!context) return;
  await upsertServerPublicCache(env, {
    guildId: context.guildId,
    planKey: context.planKey,
    publicServerName: displayName,
    currentPlayers: metadata.current_players,
    maxPlayers: metadata.max_players,
    serverOnline: metadataOnlineValue(metadata),
    serverStatus: metadata.server_status,
    lastStatusUpdateAt: metadata.player_count_last_checked_at,
  });
  await patchHomeStatsPlayerCountsFromFreshMetadata(env).catch((error) => {
    console.warn("DZN HOME STATS PLAYER COUNT SNAPSHOT PATCH SKIPPED", error instanceof Error ? error.message : "home-stats player count patch failed");
  });
}

async function updatePlayerCountFreshness(
  db: D1Database,
  linkedServerId: string,
  values: { checkedAt: string; source: string; status: PlayerCountStatus },
) {
  await db
    .prepare(
      `UPDATE linked_servers SET
        player_count_last_checked_at = ?,
        player_count_source = ?,
        player_count_status = ?,
        metadata_last_checked_at = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(values.checkedAt, values.source, values.status, values.checkedAt, linkedServerId)
    .run();
}

async function updateLinkedServerGeo(db: D1Database, linkedServerId: string, geo: Awaited<ReturnType<typeof geolocateServerIp>>, now: string) {
  await db
    .prepare(
      `UPDATE linked_servers SET
        geo_latitude = ?,
        geo_longitude = ?,
        geo_country = ?,
        geo_region = ?,
        geo_city = ?,
        geo_timezone = ?,
        geo_source = ?,
        geo_last_checked_at = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      geo.latitude,
      geo.longitude,
      geo.country,
      geo.region,
      geo.city,
      geo.timezone,
      geo.source,
      now,
      linkedServerId,
    )
    .run();

  console.log("DZN SERVER GEO LOCATION UPDATED", {
    linkedServerId,
    source: geo.source,
    approximate: geo.approximate,
    hasCoordinates: geo.latitude !== null && geo.longitude !== null,
  });
}

export async function refreshMetadataIfStale(env: Env, linkedServerId: string, userId?: string | null) {
  return refreshNitradoServerMetadata(env, { linkedServerId, userId, force: false, softFail: true }).catch(() => null);
}

export async function refreshLivePlayerCountsForActiveServers(
  env: Env,
  options: { maxServers?: number; skipFreshWithinMs?: number; includeResults?: boolean; deadlineMs?: number; queueDiscordUpdates?: boolean; skipAutomationMaintenance?: boolean } = {},
): Promise<ScheduledMetadataSyncResult> {
  await ensureLinkedServerMetadataColumns(env);
  const maxServers = Math.max(1, Math.min(Math.trunc(Number(options.maxServers ?? 25)) || 25, 100));
  const deadlineAtMs = Date.now() + Math.max(500, Math.min(Math.trunc(Number(options.deadlineMs ?? 20_000)) || 20_000, 30_000));
  const shouldQueueDiscordUpdates = options.queueDiscordUpdates !== false;
  const skipFreshWithinMs = typeof options.skipFreshWithinMs === "number" && Number.isFinite(options.skipFreshWithinMs)
    ? Math.max(0, options.skipFreshWithinMs)
    : null;
  const rows = options.skipAutomationMaintenance === true
    ? await getDueMetadataRefreshServersFast(env, maxServers)
    : await getDueStatusAutomationServers(env, maxServers);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let budgetExhausted = false;
  let updatedPlayerCounts = 0;
  const results: ScheduledMetadataSyncServerResult[] = [];
  for (const row of rows) {
    if (Date.now() >= deadlineAtMs - 750) {
      budgetExhausted = true;
      skipped += 1;
      results.push({
        linked_server_id: row.id,
        service_id: row.nitrado_service_id,
        server_name: firstString(row.display_name, row.hostname, row.server_name, row.nitrado_service_name),
        status: "skipped",
        changed: false,
        current_players: cleanNumber(row.current_players),
        max_players: cleanNumber(row.max_players),
        player_count_status: normalizePlayerCountStatus(row.player_count_status),
        player_count_last_checked_at: row.player_count_last_checked_at,
        metadata_last_checked_at: row.metadata_last_checked_at,
        message: "Metadata refresh budget exhausted before this server",
      });
      break;
    }
    processed += 1;
    const serverName = firstString(row.display_name, row.hostname, row.server_name, row.nitrado_service_name);
    const previousCheckedAt = row.player_count_last_checked_at ?? row.metadata_last_checked_at;
    if (skipFreshWithinMs !== null && !isMetadataStale(previousCheckedAt, skipFreshWithinMs)) {
      skipped += 1;
      results.push({
        linked_server_id: row.id,
        service_id: row.nitrado_service_id,
        server_name: serverName,
        status: "skipped",
        changed: false,
        current_players: cleanNumber(row.current_players),
        max_players: cleanNumber(row.max_players),
        player_count_status: normalizePlayerCountStatus(row.player_count_status),
        player_count_last_checked_at: row.player_count_last_checked_at,
        metadata_last_checked_at: row.metadata_last_checked_at,
        message: "Live player count checked recently; skipped fallback refresh",
      });
      continue;
    }

    try {
      await markStatusCheckStarted(env, row.guild_id);
      const beforeCurrent = cleanNumber(row.current_players);
      const beforeMax = cleanNumber(row.max_players);
      const result = await refreshNitradoServerMetadata(env, {
        linkedServerId: row.id,
        userId: row.user_id,
        force: true,
        softFail: true,
      });
      if (result.ok) succeeded += 1;
      else failed += 1;
      const nextCurrent = cleanNumber(result.metadata?.current_players);
      const nextMax = cleanNumber(result.metadata?.max_players);
      const changed = nextCurrent !== beforeCurrent || nextMax !== beforeMax;
      if (changed) updatedPlayerCounts += 1;
      await recordStatusCheckResult(env, {
        guildId: row.guild_id,
        planKey: row.plan_key,
        ok: result.ok,
        currentPlayers: nextCurrent,
        maxPlayers: nextMax,
        serverOnline: metadataOnlineValue(result.metadata),
        serverStatus: result.metadata?.server_status ?? null,
        error: result.ok ? null : result.message,
      });
      await upsertServerPublicCache(env, {
        guildId: row.guild_id,
        planKey: row.plan_key,
        publicServerName: serverName,
        currentPlayers: nextCurrent,
        maxPlayers: nextMax,
        serverOnline: metadataOnlineValue(result.metadata),
        serverStatus: result.metadata?.server_status ?? null,
        lastStatusUpdateAt: result.player_count_last_checked_at ?? result.metadata_last_checked_at ?? null,
      });
      if (result.ok && shouldQueueDiscordUpdates) {
        await queueDiscordPostUpdatesForGuild(env, row.guild_id, row.plan_key, ["basic_status_embed", "priority_status_embed"], changed ? "status-change" : "status-check");
      }
      results.push({
        linked_server_id: row.id,
        service_id: row.nitrado_service_id,
        server_name: serverName,
        status: result.ok ? "succeeded" : "failed",
        changed,
        current_players: nextCurrent,
        max_players: nextMax,
        player_count_status: normalizePlayerCountStatus(result.player_count_status),
        player_count_last_checked_at: result.player_count_last_checked_at ?? null,
        metadata_last_checked_at: result.metadata_last_checked_at ?? null,
        message: result.message,
      });
    } catch (error) {
      failed += 1;
      await recordStatusCheckResult(env, {
        guildId: row.guild_id,
        planKey: row.plan_key,
        ok: false,
        error: error instanceof Error ? error.message : "Nitrado metadata refresh failed",
      }).catch(() => null);
      results.push({
        linked_server_id: row.id,
        service_id: row.nitrado_service_id,
        server_name: serverName,
        status: "failed",
        changed: false,
        current_players: cleanNumber(row.current_players),
        max_players: cleanNumber(row.max_players),
        player_count_status: "unavailable",
        player_count_last_checked_at: row.player_count_last_checked_at,
        metadata_last_checked_at: row.metadata_last_checked_at,
        message: error instanceof Error ? error.message : "Nitrado metadata refresh failed",
      });
    }
  }

  const summary = {
    processed,
    succeeded,
    failed,
    skipped,
    updated_player_counts: updatedPlayerCounts,
    budget_exhausted: budgetExhausted,
  };

  console.log("DZN LIVE PLAYER COUNT AUTO SYNC READY", summary);
  console.log("DZN METADATA SYNC INDEPENDENT OF ADM READY", summary);
  console.log("DZN LIVE NITRADO PLAYER COUNT SYNC FIXED", summary);
  console.log("DZN PLAYER COUNT REFRESH INDEPENDENT OF ADM", summary);

  return {
    processed,
    succeeded,
    failed,
    skipped,
    updated_player_counts: updatedPlayerCounts,
    budget_exhausted: budgetExhausted,
    results,
  };
}

async function getDueMetadataRefreshServersFast(env: Env, maxServers: number): Promise<AutomationSyncServer[]> {
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
       LEFT JOIN server_sync_state ON server_sync_state.guild_id = linked_servers.guild_id
       WHERE lower(COALESCE(linked_servers.status, 'pending')) = 'live'
         AND linked_servers.nitrado_service_id IS NOT NULL
         AND linked_servers.nitrado_service_id != ''
         AND lower(COALESCE(server_subscriptions.status, 'inactive')) IN ('active', 'trialing')
         AND COALESCE(server_sync_state.currently_checking_status, 0) = 0
         AND COALESCE(server_sync_state.next_status_check_due_at, '1970-01-01T00:00:00.000Z') <= ?
         AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
       ORDER BY
         CASE lower(COALESCE(server_subscriptions.plan_key, 'free'))
           WHEN 'premium' THEN 4
           WHEN 'network' THEN 4
           WHEN 'partner' THEN 4
           WHEN 'pro' THEN 3
           WHEN 'starter' THEN 2
           ELSE 1
         END DESC,
         COALESCE(server_sync_state.next_status_check_due_at, '1970-01-01T00:00:00.000Z') ASC,
         linked_servers.updated_at DESC
       LIMIT ?`,
    )
    .bind(now, maxServers)
    .all<AutomationSyncServer>();
  return rows.results ?? [];
}

export function detectServerModeFromText(values: Array<string | null | undefined>) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  const hasPve = /\b(pve|no\s*kos|roleplay|\brp\b|survival)\b/.test(text);
  const pvpText = text.replace(/\bno\s*kos\b/g, "");
  const hasPvp = /\b(pvp|kos|raid|raids|faction wars?)\b/.test(pvpText);
  if (hasPvp && hasPve) return "PVP / PVE";
  if (/\b(deathmatch|dm|nuketown|arena|instant action)\b/.test(text)) return "DEATHMATCH";
  if (hasPvp) return "PVP";
  if (hasPve) return "PVE";
  return "SURVIVAL";
}

export function isMetadataStale(value: string | null | undefined, staleMs = METADATA_STALE_MS) {
  if (!value) return true;
  const checkedAt = Date.parse(value);
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt > staleMs;
}

async function getLinkedServerMetadataRow(env: Env, linkedServerId: string, userId?: string | null) {
  const db = requireDb(env);
  const where = userId ? "id = ? AND user_id = ?" : "id = ?";
  const values = userId ? [linkedServerId, userId] : [linkedServerId];
  return db
    .prepare(
      `SELECT id, user_id, nitrado_service_id, nitrado_service_name, server_name, server_type,
              tags_json, region, platform, display_name, hostname, max_players, current_players, ip_address,
              server_status, server_mode, server_mode_source, metadata_hash, metadata_last_checked_at,
              metadata_last_changed_at, player_count_last_checked_at, player_count_source, player_count_status,
              geo_latitude, geo_longitude, geo_country, geo_region, geo_city, geo_timezone,
              geo_source, geo_last_checked_at
       FROM linked_servers
       WHERE ${where}
       LIMIT 1`,
    )
    .bind(...values)
    .first<LinkedServerMetadataRow>();
}

async function resolveGeoUpdate(linkedServer: LinkedServerMetadataRow, ipAddress: string | null, now: string) {
  if (!shouldRefreshServerGeo(linkedServer, ipAddress, Date.parse(now))) return null;
  try {
    return await geolocateServerIp(ipAddress, {
      regionHint: firstString(linkedServer.region, linkedServer.platform, linkedServer.server_name, linkedServer.nitrado_service_name),
    });
  } catch (error) {
    console.warn("DZN server GeoIP lookup skipped", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function fetchNitradoServerMetadata(env: Env, linkedServer: LinkedServerMetadataRow, now: string) {
  const token = await getNitradoTokenForLinkedServer(env, linkedServer);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `${NITRADO_API}/services/${encodeURIComponent(linkedServer.nitrado_service_id ?? "")}/gameservers`,
      {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (response.status === 401 || response.status === 403) throw new Error("Nitrado token cannot access this service");
    if (!response.ok) throw new Error("Nitrado metadata fetch failed");
    const payload = await response.json().catch(() => null);
    return normalizeNitradoMetadata(payload, linkedServer, now);
  } finally {
    clearTimeout(timeout);
  }
}

async function mockMetadata(linkedServer: LinkedServerMetadataRow, now: string) {
  const name = linkedServer.nitrado_service_id === "18765761"
    ? "NukeTown DEATHMATCH"
    : linkedServer.nitrado_service_name ?? linkedServer.server_name ?? "Pandora DayZ";
  return normalizeMetadataValues({
    linkedServer,
    now,
    hostname: name,
    description: "Mock DayZ server metadata from MOCK_NITRADO mode",
    maxPlayers: linkedServer.nitrado_service_id === "18765761" ? 10 : 60,
    currentPlayers: 0,
    ipAddress: linkedServer.ip_address ?? "203.0.113.10",
    gamePort: 2302,
    queryPort: 27016,
    mapName: "Chernarusplus",
    mission: "dayzps",
    serverStatus: "online",
    isOnline: true,
    game: "dayzps",
    platform: "PlayStation",
    rawMetadata: { source: "MOCK_NITRADO", hostname: name },
  });
}

function normalizeNitradoMetadata(payload: unknown, linkedServer: LinkedServerMetadataRow, now: string): Promise<LinkedServerMetadata> | LinkedServerMetadata {
  const gameserver = findRecordByKey(payload, "gameserver") ?? {};
  const details = record(gameserver.details);
  const settings = record(gameserver.settings);
  const config = record(settings.config);
  const query = record(gameserver.query);
  const gameSpecific = record(gameserver.game_specific);
  const portList = record(gameserver.portlist);
  const status = record(gameserver.status);
  const statusQuery = record(status.query);

  const hostname = firstString(config.hostname, gameserver.hostname, gameserver.name, query.name, details.name, details.server_name);
  const description = firstString(config.description, gameserver.description, details.description, gameSpecific.description);
  const playerCountPair = parseNitradoPlayerCountPair(
    query.players,
    query.player_count,
    query.players_online,
    query.current_players,
    gameserver.players,
    gameserver.player_count,
    gameserver.players_online,
    gameserver.current_players,
    details.players,
    details.player_count,
    status.players,
    statusQuery.players,
  );
  const maxPlayers = firstNumber(
    gameserver.slots,
    gameserver.max_players,
    gameserver.maxplayers,
    gameserver.player_slots,
    gameserver.player_slots_max,
    config.slots,
    config.maxplayers,
    config.max_players,
    query.slots,
    query.maxplayers,
    query.max_players,
    query.max_players_count,
    query.player_slots,
    details.slots,
    details.maxplayers,
    details.max_players,
    details.player_slots,
    gameSpecific.max_players,
    status.slots,
    status.maxplayers,
    status.max_players,
    statusQuery.maxplayers,
    statusQuery.max_players,
    playerCountPair?.max,
  );
  const currentPlayers = firstNumber(
    query.player_current,
    query.current_players,
    query.players_current,
    query.player_count,
    query.players_online,
    query.online_players,
    query.numplayers,
    query.num_players,
    gameserver.player_current,
    gameserver.current_players,
    gameserver.players_current,
    gameserver.player_count,
    gameserver.players_online,
    query.players,
    gameserver.players,
    details.player_current,
    details.current_players,
    details.players_current,
    details.player_count,
    details.players_online,
    details.players,
    gameSpecific.current_players,
    gameSpecific.players_online,
    status.player_current,
    status.current_players,
    status.players_current,
    status.player_count,
    status.players_online,
    status.players,
    statusQuery.player_current,
    statusQuery.current_players,
    statusQuery.players_current,
    statusQuery.player_count,
    statusQuery.players_online,
    statusQuery.players,
    playerCountPair?.current,
  );
  const ipAddress = normalizeIpAddress(firstString(gameserver.ip, gameserver.address, query.ip, query.address, details.address));
  const gamePort = firstNumber(gameserver.port, config.port, query.port, details.port, portList.game, portList.port);
  const queryPort = firstNumber(gameserver.query_port, config.query_port, query.query_port, details.query_port, portList.query);
  const mapName = firstString(config.map, config.map_name, gameSpecific.map, gameSpecific.map_name, gameserver.map, query.map);
  const mission = firstString(config.mission, gameSpecific.mission, gameSpecific.mission_name, gameserver.mission);
  const serverStatus = firstString(gameserver.status, query.status, details.status, gameserver.server_status);
  const online = firstBoolean(gameserver.online, query.online, gameserver.is_online) ?? /^(online|started|running|active)$/i.test(serverStatus ?? "");
  const game = firstString(gameserver.game, gameserver.game_human, gameserver.game_short, details.game, details.folder_short, details.portlist_short, gameSpecific.game);
  const platform = firstString(gameSpecific.platform, gameserver.platform, details.platform) ?? detectPlatform(`${game ?? ""} ${details.folder_short ?? ""} ${details.portlist_short ?? ""}`);

  return normalizeMetadataValues({
    linkedServer,
    now,
    hostname,
    description,
    maxPlayers,
    currentPlayers,
    ipAddress,
    gamePort,
    queryPort,
    mapName,
    mission,
    serverStatus,
    isOnline: online,
    game,
    platform,
    rawMetadata: safeRawMetadata({
      hostname,
      description,
      maxPlayers,
      currentPlayers,
      ipAddress,
      gamePort,
      queryPort,
      mapName,
      mission,
      serverStatus,
      isOnline: online,
      game,
      platform,
      gameSpecific,
    }),
  });
}

async function normalizeMetadataValues(values: {
  linkedServer: LinkedServerMetadataRow;
  now: string;
  hostname: string | null | undefined;
  description: string | null | undefined;
  maxPlayers: number | null | undefined;
  currentPlayers: number | null | undefined;
  ipAddress: string | null | undefined;
  gamePort: number | null | undefined;
  queryPort: number | null | undefined;
  mapName: string | null | undefined;
  mission: string | null | undefined;
  serverStatus: string | null | undefined;
  isOnline: boolean;
  game: string | null | undefined;
  platform: string | null | undefined;
  rawMetadata: Record<string, unknown>;
}): Promise<LinkedServerMetadata> {
  const tags = parseTags(values.linkedServer.tags_json).join(" ");
  const existingSource = values.linkedServer.server_mode_source;
  const manualMode = existingSource === "manual";
  const serverMode = manualMode
    ? firstString(values.linkedServer.server_mode, values.linkedServer.server_type) ?? "PVP"
    : detectServerModeFromText([values.hostname, values.description, tags, values.mapName, values.mission]);
  const rawMetadata = safeRawMetadata(values.rawMetadata);
  const playerCounts = resolveLivePlayerCounts({
    currentPlayers: values.currentPlayers,
    maxPlayers: values.maxPlayers,
    existingCurrentPlayers: values.linkedServer.current_players,
    existingMaxPlayers: values.linkedServer.max_players,
  });
  if (playerCounts.currentMissing || playerCounts.maxMissing) {
    console.warn("DZN PLAYER COUNT METADATA MISSING", {
      linkedServerId: values.linkedServer.id,
      currentPlayersPresent: !playerCounts.currentMissing,
      maxPlayersPresent: !playerCounts.maxMissing,
    });
  }
  const playerCountStatus: PlayerCountStatus = playerCounts.currentMissing || playerCounts.maxMissing ? "stale" : "fresh";
  if (!playerCounts.currentMissing && playerCounts.current_players === 0) {
    console.log("DZN EXPLICIT ZERO PLAYER COUNT HANDLED", {
      linkedServerId: values.linkedServer.id,
      max_players: playerCounts.max_players,
    });
  }
  const hashInput = JSON.stringify({
    hostname: values.hostname ?? null,
    description: values.description ?? null,
    maxPlayers: playerCounts.max_players,
    currentPlayers: playerCounts.current_players,
    ipAddress: values.ipAddress ?? null,
    gamePort: values.gamePort ?? null,
    queryPort: values.queryPort ?? null,
    mapName: values.mapName ?? null,
    mission: values.mission ?? null,
    serverStatus: values.serverStatus ?? null,
    isOnline: values.isOnline,
    game: values.game ?? null,
    platform: values.platform ?? null,
    serverMode,
  });

  return {
    hostname: cleanString(values.hostname),
    description: cleanString(values.description),
    max_players: playerCounts.max_players,
    current_players: playerCounts.current_players,
    ip_address: cleanString(values.ipAddress),
    game_port: cleanNumber(values.gamePort),
    query_port: cleanNumber(values.queryPort),
    map_name: cleanString(values.mapName),
    mission: cleanString(values.mission),
    server_status: cleanString(values.serverStatus),
    is_online: values.isOnline,
    game: cleanString(values.game),
    platform: cleanString(values.platform),
    server_mode: serverMode,
    server_mode_source: manualMode ? "manual" : "auto",
    raw_metadata: rawMetadata,
    metadata_hash: await sha256(hashInput),
    metadata_last_checked_at: values.now,
    player_count_last_checked_at: values.now,
    player_count_source: rawMetadata.source === "MOCK_NITRADO" ? "mock_nitrado" : "nitrado",
    player_count_status: playerCountStatus,
  };
}

function buildMetadataChanges(linkedServer: LinkedServerMetadataRow, metadata: LinkedServerMetadata, displayName: string) {
  const comparisons: Array<[string, unknown, unknown]> = [
    ["display_name", linkedServer.display_name ?? linkedServer.server_name, displayName],
    ["hostname", linkedServer.hostname, metadata.hostname],
    ["max_players", linkedServer.max_players ?? null, metadata.max_players],
    ["current_players", linkedServer.current_players ?? null, metadata.current_players],
    ["ip_address", linkedServer.ip_address, metadata.ip_address],
    ["server_status", linkedServer.server_status, metadata.server_status],
    ["server_mode", linkedServer.server_mode, metadata.server_mode],
  ];
  return comparisons
    .filter(([, previous, next]) => normalizeCompare(previous) !== normalizeCompare(next))
    .map(([field, previous, next]) => ({ field, previous: previous ?? null, next: next ?? null }));
}

async function getNitradoTokenForLinkedServer(env: Env, linkedServer: LinkedServerMetadataRow) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ? AND linked_server_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(linkedServer.user_id, linkedServer.id)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();
  if (!row) throw new Error("No Nitrado token found for this linked server");
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

async function ensureServerMetadataVersionsTable(env: Env) {
  const db = requireDb(env);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS server_metadata_versions (
        id TEXT PRIMARY KEY,
        linked_server_id TEXT NOT NULL,
        metadata_hash TEXT,
        changes_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(linked_server_id) REFERENCES linked_servers(id)
      )`,
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_metadata_versions_linked_server_id ON server_metadata_versions(linked_server_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_server_metadata_versions_created_at ON server_metadata_versions(created_at)").run();
}

function rowToMetadata(row: LinkedServerMetadataRow) {
  return {
    display_name: firstString(row.display_name, row.hostname, row.server_name, row.nitrado_service_name),
    hostname: row.hostname,
    max_players: row.max_players,
    current_players: row.current_players,
    ip_address: row.ip_address,
    server_status: row.server_status,
    server_mode: row.server_mode ?? row.server_type,
    server_mode_source: row.server_mode_source ?? null,
    metadata_last_checked_at: row.metadata_last_checked_at,
    metadata_last_changed_at: row.metadata_last_changed_at,
    metadata_source: "nitrado",
    player_count_last_checked_at: row.player_count_last_checked_at,
    player_count_source: row.player_count_source ?? "nitrado",
    player_count_status: normalizePlayerCountStatus(row.player_count_status),
  };
}

function findRecordByKey(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const direct = value[key];
  if (isRecord(direct)) return direct;
  for (const child of Object.values(value)) {
    const found = findRecordByKey(child, key);
    if (found) return found;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function parseNitradoPlayerCountPair(...values: unknown[]): { current: number; max: number } | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const match = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) continue;
    const current = Number(match[1]);
    const max = Number(match[2]);
    if (Number.isFinite(current) && Number.isFinite(max)) return { current, max };
  }
  return null;
}

export function resolveLivePlayerCounts(values: {
  currentPlayers: number | null | undefined;
  maxPlayers: number | null | undefined;
  existingCurrentPlayers: number | null | undefined;
  existingMaxPlayers: number | null | undefined;
}) {
  const rawCurrent = cleanNumber(values.currentPlayers);
  const rawMax = cleanNumber(values.maxPlayers);
  const currentMissing = rawCurrent === null;
  const maxMissing = rawMax === null;

  return {
    current_players: rawCurrent ?? cleanNumber(values.existingCurrentPlayers),
    max_players: rawMax ?? cleanNumber(values.existingMaxPlayers),
    currentMissing,
    maxMissing,
    player_count_status: currentMissing || maxMissing ? "stale" as const : "fresh" as const,
  };
}

function normalizePlayerCountStatus(value: unknown): PlayerCountStatus {
  if (value === "fresh" || value === "stale" || value === "unavailable" || value === "unknown") return value;
  return "unknown";
}

function metadataOnlineValue(value: unknown) {
  return value && typeof value === "object" && "is_online" in value
    ? (value as { is_online?: boolean | number | null }).is_online ?? null
    : null;
}

function firstBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string" && /^(true|1|yes|online)$/i.test(value)) return true;
    if (typeof value === "string" && /^(false|0|no|offline)$/i.test(value)) return false;
  }
  return null;
}

function normalizeIpAddress(value: string | null) {
  if (!value) return null;
  const withoutProtocol = value.replace(/^https?:\/\//i, "");
  const withoutPort = withoutProtocol.split(":")[0]?.trim();
  return withoutPort || null;
}

function detectPlatform(value: string) {
  if (/ps4|ps5|playstation/i.test(value)) return "PlayStation";
  if (/xbox|xb/i.test(value)) return "Xbox";
  if (/pc|steam|standalone/i.test(value)) return "PC";
  return null;
}

function parseTags(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function safeRawMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4 || !isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      result[key] = child;
    } else if (Array.isArray(child)) {
      result[key] = child.slice(0, 20).map((item) => (isRecord(item) ? safeRawMetadata(item, depth + 1) : item)).filter((item) => item !== undefined);
    } else if (isRecord(child)) {
      result[key] = safeRawMetadata(child, depth + 1);
    }
  }
  return result;
}

function isSensitiveKey(key: string) {
  return /(password|passwd|secret|token|credential|mysql|^ftp$|ftp_|_ftp|ftpuser|ftp_user|authorization|auth)/i.test(key);
}

function cleanString(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

function cleanNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeCompare(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}
