import { requireDb } from "./db";
import type { Env } from "./types";

export const OWNER_DELETE_FORBIDDEN_MESSAGE = "Only the original server owner who linked this server to DZN can permanently delete it.";
const DELETION_RATE_LIMIT_WINDOW_MS = 60_000;
const DELETION_RATE_LIMIT_ATTEMPTS = 8;
const deletionAttempts = new Map<string, { count: number; resetAt: number }>();

export type DeletionCounts = {
  linkedServers: number;
  serverStats: number;
  playerProfiles: number;
  playerEvents: number;
  killEvents: number;
  admRawEvents: number;
  admSyncState: number;
  syncRuns: number;
  sessions: number;
  nitradoConnections: number;
  onboardingChecks: number;
  serverLogConfig: number;
  serverMetadataVersions: number;
  serverSlugAliases: number;
  discordGuilds: number;
  users: number;
};

type LinkedServerForDeletion = {
  id: string;
  user_id: string;
  server_name: string;
  public_slug: string | null;
};

export function emptyDeletionCounts(): DeletionCounts {
  return {
    linkedServers: 0,
    serverStats: 0,
    playerProfiles: 0,
    playerEvents: 0,
    killEvents: 0,
    admRawEvents: 0,
    admSyncState: 0,
    syncRuns: 0,
    sessions: 0,
    nitradoConnections: 0,
    onboardingChecks: 0,
    serverLogConfig: 0,
    serverMetadataVersions: 0,
    serverSlugAliases: 0,
    discordGuilds: 0,
    users: 0,
  };
}

export function isDeletionRateLimited(key: string) {
  const now = Date.now();
  const existing = deletionAttempts.get(key);
  if (!existing || existing.resetAt <= now) {
    deletionAttempts.set(key, { count: 1, resetAt: now + DELETION_RATE_LIMIT_WINDOW_MS });
    return false;
  }

  existing.count += 1;
  deletionAttempts.set(key, existing);
  return existing.count > DELETION_RATE_LIMIT_ATTEMPTS;
}

export async function getLinkedServerForDeletion(env: Env, linkedServerId: string) {
  const db = requireDb(env);
  return db
    .prepare("SELECT id, user_id, server_name, public_slug FROM linked_servers WHERE id = ? LIMIT 1")
    .bind(linkedServerId)
    .first<LinkedServerForDeletion>();
}

export async function deleteOwnedLinkedServerData(env: Env, userId: string, linkedServerId: string) {
  const db = requireDb(env);
  const server = await getLinkedServerForDeletion(env, linkedServerId);
  if (!server) {
    return { ok: false as const, status: 404, error: "Linked server not found" };
  }
  if (server.user_id !== userId) {
    return { ok: false as const, status: 403, error: OWNER_DELETE_FORBIDDEN_MESSAGE };
  }

  const deleted = emptyDeletionCounts();
  deleted.serverSlugAliases += await deleteOptionalLinkedServerRows(db, "server_slug_aliases", linkedServerId);
  deleted.serverMetadataVersions += await deleteOptionalLinkedServerRows(db, "server_metadata_versions", linkedServerId);
  deleted.syncRuns += await deleteLinkedServerRows(db, "sync_runs", linkedServerId);
  deleted.admSyncState += await deleteLinkedServerRows(db, "adm_sync_state", linkedServerId);
  deleted.admRawEvents += await deleteLinkedServerRows(db, "adm_raw_events", linkedServerId);
  deleted.playerEvents += await deleteLinkedServerRows(db, "player_events", linkedServerId);
  deleted.killEvents += await deleteLinkedServerRows(db, "kill_events", linkedServerId);
  if (await tableExists(db, "user_notifications") && await tableExists(db, "player_game_identity_claims")) {
    await deleteRows(db,
      `DELETE FROM user_notifications
       WHERE type = 'player_link_review_requested'
         AND json_extract(metadata, '$.claim_id') IN (
           SELECT id FROM player_game_identity_claims WHERE linked_server_id = ?
         )`,
      [linkedServerId],
    );
  }
  deleted.playerProfiles += await deleteLinkedServerRows(db, "player_profiles", linkedServerId);
  deleted.serverStats += await deleteLinkedServerRows(db, "server_stats", linkedServerId);
  deleted.admRawEvents += await deleteOptionalLinkedServerRows(db, "adm_raw_lines", linkedServerId);
  deleted.onboardingChecks += await deleteLinkedServerRows(db, "onboarding_checks", linkedServerId);
  deleted.serverLogConfig += await deleteLinkedServerRows(db, "server_log_config", linkedServerId);
  deleted.nitradoConnections += await deleteLinkedServerRows(db, "nitrado_connections", linkedServerId, "user_id = ?", [userId]);

  const linkedResult = await db
    .prepare("DELETE FROM linked_servers WHERE id = ? AND user_id = ?")
    .bind(linkedServerId, userId)
    .run();
  deleted.linkedServers += changes(linkedResult);

  return {
    ok: true as const,
    deleted,
    server: {
      id: server.id,
      server_name: server.server_name,
      public_slug: server.public_slug,
    },
  };
}

export async function deleteOwnedAccountData(env: Env, userId: string) {
  const db = requireDb(env);
  const deleted = emptyDeletionCounts();
  const servers = await db
    .prepare("SELECT id FROM linked_servers WHERE user_id = ?")
    .bind(userId)
    .all<{ id: string }>();

  for (const server of servers.results ?? []) {
    const result = await deleteOwnedLinkedServerData(env, userId, server.id);
    if (result.ok) mergeDeletionCounts(deleted, result.deleted);
  }

  deleted.nitradoConnections += await deleteRows(db, "DELETE FROM nitrado_connections WHERE user_id = ?", [userId]);
  if (await tableExists(db, "discord_oauth_tokens")) {
    await deleteRows(db, "DELETE FROM discord_oauth_tokens WHERE user_id = ?", [userId]);
  }
  deleted.sessions += await deleteRows(db, "DELETE FROM sessions WHERE user_id = ?", [userId]);
  deleted.discordGuilds += await deleteRows(
    db,
    `DELETE FROM discord_guilds
     WHERE owner_user_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM linked_servers WHERE linked_servers.discord_guild_id = discord_guilds.id
       )`,
    [userId],
  );
  if (await tableExists(db, "user_notifications")) {
    if (await tableExists(db, "player_game_identity_claims")) {
      await deleteRows(db,
        `DELETE FROM user_notifications
         WHERE type = 'player_link_review_requested'
           AND json_extract(metadata, '$.claim_id') IN (
             SELECT id FROM player_game_identity_claims WHERE user_id = ?
           )`,
        [userId],
      );
    }
    await deleteRows(db, "DELETE FROM user_notifications WHERE user_id = ?", [userId]);
  }
  deleted.users += await eraseOrRetainAccountUser(db, userId);

  return { ok: true as const, deleted };
}

export async function eraseOrRetainAccountUser(db: D1Database, userId: string) {
  if (!(await hasRetainedStoreLedgerReferences(db, userId))) {
    return deleteRows(db, "DELETE FROM users WHERE id = ?", [userId]);
  }

  const touchesUpdatedAt = await tableHasColumn(db, "users", "updated_at");
  const result = await db.prepare(`UPDATE users
    SET discord_id = ?, username = NULL, avatar = NULL${touchesUpdatedAt ? ", updated_at = CURRENT_TIMESTAMP" : ""}
    WHERE id = ?`)
    .bind(`deleted-${crypto.randomUUID()}`, userId)
    .run();
  return changes(result);
}

async function hasRetainedStoreLedgerReferences(db: D1Database, userId: string) {
  const references = [
    ["store_orders", "purchasing_user_id"],
    ["store_fulfilment_requests", "purchasing_user_id"],
    ["store_fulfilment_actions", "actor_user_id"],
    ["store_receipts", "purchasing_user_id"],
    ["store_receipts", "issued_by_user_id"],
    ["store_catalog_publications", "published_by_user_id"],
    ["store_commerce_orders", "purchasing_user_id"],
    ["store_commerce_fulfilments", "purchasing_user_id"],
    ["store_commerce_receipts", "purchasing_user_id"],
    ["store_commerce_entitlements", "purchasing_user_id"],
  ] as const;

  for (const [tableName, columnName] of references) {
    if (!(await tableExists(db, tableName)) || !(await tableHasColumn(db, tableName, columnName))) continue;
    const row = await db.prepare(`SELECT 1 AS found FROM ${tableName} WHERE ${columnName} = ? LIMIT 1`)
      .bind(userId)
      .first<{ found: number }>();
    if (row) return true;
  }
  return false;
}

function mergeDeletionCounts(target: DeletionCounts, source: DeletionCounts) {
  for (const key of Object.keys(target) as Array<keyof DeletionCounts>) {
    target[key] += source[key];
  }
}

async function deleteLinkedServerRows(db: D1Database, tableName: string, linkedServerId: string, extraWhere?: string, extraValues: unknown[] = []) {
  if (!(await tableExists(db, tableName))) return 0;
  const where = extraWhere ? `linked_server_id = ? AND ${extraWhere}` : "linked_server_id = ?";
  return deleteRows(db, `DELETE FROM ${tableName} WHERE ${where}`, [linkedServerId, ...extraValues]);
}

async function deleteOptionalLinkedServerRows(db: D1Database, tableName: string, linkedServerId: string) {
  if (!(await tableExists(db, tableName))) return 0;
  if (!(await tableHasColumn(db, tableName, "linked_server_id"))) return 0;
  return deleteLinkedServerRows(db, tableName, linkedServerId);
}

async function deleteRows(db: D1Database, query: string, values: unknown[]) {
  const statement = db.prepare(query).bind(...values);
  const result = await statement.run();
  return changes(result);
}

async function tableExists(db: D1Database, tableName: string) {
  const result = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(tableName)
    .first<{ name: string }>();
  return Boolean(result);
}

async function tableHasColumn(db: D1Database, tableName: string, columnName: string) {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return (result.results ?? []).some((column) => column.name === columnName);
}

function changes(result: D1Result) {
  return Number(result.meta?.changes ?? 0) || 0;
}
