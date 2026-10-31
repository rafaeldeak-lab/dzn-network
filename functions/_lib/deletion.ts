import { requireDb } from "./db";
import {
  releaseOwnerDiscordRoleMutationLease,
  reserveOwnerDiscordAccountDeletionLease,
  reserveOwnerDiscordLinkedServerDeletionLease,
  renewOwnerDiscordAccountDeletionLease,
  renewOwnerDiscordLinkedServerDeletionLease,
  revokeOwnerDiscordRoleForAccountDeletion,
  revokeOwnerDiscordRoleForLinkedServerDeletion,
} from "./owner-discord-delivery";
import type { OwnerDiscordRoleMutationLease } from "./owner-discord-delivery";
import type { Env } from "./types";

export const OWNER_DELETE_FORBIDDEN_MESSAGE = "Only the original server owner who linked this server to DZN can permanently delete it.";
const DELETION_RATE_LIMIT_WINDOW_MS = 60_000;
const DELETION_RATE_LIMIT_ATTEMPTS = 8;
const ACCOUNT_DELETION_OPERATION_NOTIFICATION_TYPE = "internal_account_deletion_operation";
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

export type AccountDeletionOperation = {
  operationId: string | null;
};

type LinkedServerForDeletion = {
  id: string;
  user_id: string;
  server_name: string;
  public_slug: string | null;
};

type LinkedServerDeletionOptions = {
  skipOwnerDiscordRoleCleanup?: boolean;
  accountDeletionDiscordRoleLease?: OwnerDiscordRoleMutationLease | null;
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

export async function deleteOwnedLinkedServerData(
  env: Env,
  userId: string,
  linkedServerId: string,
  options: LinkedServerDeletionOptions = {},
) {
  const db = requireDb(env);
  const server = await getLinkedServerForDeletion(env, linkedServerId);
  if (!server) {
    return { ok: false as const, status: 404, error: "Linked server not found" };
  }
  if (server.user_id !== userId) {
    return { ok: false as const, status: 403, error: OWNER_DELETE_FORBIDDEN_MESSAGE };
  }

  const heldAccountDeletionLease = options.accountDeletionDiscordRoleLease ?? null;
  const discordRoleReservation = heldAccountDeletionLease
    ? { required: true as const, lease: heldAccountDeletionLease }
    : options.skipOwnerDiscordRoleCleanup
      ? { required: false as const, lease: null }
      : await reserveOwnerDiscordLinkedServerDeletionLease(env, userId, linkedServerId);
  if (discordRoleReservation.required && !discordRoleReservation.lease) {
    return { ok: false as const, status: 409, error: "DZN is still issuing or changing this server owner's Discord access. Retry server removal shortly." };
  }
  const renewDiscordRoleReservation = async () => heldAccountDeletionLease
    ? renewOwnerDiscordAccountDeletionLease(env, heldAccountDeletionLease)
    : renewOwnerDiscordLinkedServerDeletionLease(env, discordRoleReservation.lease);
  const expiredDiscordRoleReservation = () => ({
    ok: false as const,
    status: 409 as const,
    error: "DZN could not keep this server's Discord owner-access cleanup reservation. No further server data was removed; retry server removal shortly.",
  });

  try {
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    if (!options.skipOwnerDiscordRoleCleanup) {
      const discordRoleCleanup = await revokeOwnerDiscordRoleForLinkedServerDeletion(env, userId, linkedServerId, fetch, discordRoleReservation.lease);
      if (!discordRoleCleanup.ok) {
        return { ok: false as const, status: discordRoleCleanup.status, error: discordRoleCleanup.message };
      }
    }
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();

    const deleted = emptyDeletionCounts();
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.serverSlugAliases += await deleteOptionalLinkedServerRows(db, "server_slug_aliases", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.serverMetadataVersions += await deleteOptionalLinkedServerRows(db, "server_metadata_versions", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.syncRuns += await deleteLinkedServerRows(db, "sync_runs", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.admSyncState += await deleteLinkedServerRows(db, "adm_sync_state", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.admRawEvents += await deleteLinkedServerRows(db, "adm_raw_events", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.playerEvents += await deleteLinkedServerRows(db, "player_events", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.killEvents += await deleteLinkedServerRows(db, "kill_events", linkedServerId);
    if (await tableExists(db, "user_notifications") && await tableExists(db, "player_game_identity_claims")) {
      if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
      await deleteRows(db,
        `DELETE FROM user_notifications
         WHERE type = 'player_link_review_requested'
           AND json_extract(metadata, '$.claim_id') IN (
             SELECT id FROM player_game_identity_claims WHERE linked_server_id = ?
           )`,
        [linkedServerId],
      );
    }
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.playerProfiles += await deleteLinkedServerRows(db, "player_profiles", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.serverStats += await deleteLinkedServerRows(db, "server_stats", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.admRawEvents += await deleteOptionalLinkedServerRows(db, "adm_raw_lines", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.onboardingChecks += await deleteLinkedServerRows(db, "onboarding_checks", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.serverLogConfig += await deleteLinkedServerRows(db, "server_log_config", linkedServerId);
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.nitradoConnections += await deleteLinkedServerRows(db, "nitrado_connections", linkedServerId, "user_id = ?", [userId]);

    // Server-owned Vault items and saved displays are only meaningful while
    // their linked server exists. Remove the complete server scope before the
    // linked-server row disappears, just as other server-owned records are
    // removed above.
    if (await tableExists(db, "dzn_vault_showcases")) {
      await deleteRows(db, "DELETE FROM dzn_vault_showcases WHERE scope_type = 'server' AND scope_id = ?", [linkedServerId]);
    }
    if (await tableExists(db, "dzn_vault_grants")) {
      await deleteRows(db, "DELETE FROM dzn_vault_grants WHERE scope_type = 'server' AND scope_id = ?", [linkedServerId]);
    }
    if (await tableExists(db, "dzn_vault_audit")) {
      await deleteRows(db, "DELETE FROM dzn_vault_audit WHERE scope_type = 'server' AND scope_id = ?", [linkedServerId]);
    }

    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
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
  } finally {
    if (!heldAccountDeletionLease) await releaseOwnerDiscordRoleMutationLease(env, discordRoleReservation.lease);
  }
}

export async function reserveAccountDeletionOperation(env: Env, userId: string): Promise<AccountDeletionOperation | null> {
  const db = requireDb(env);
  const deletionOperationId = await beginAccountDeletionOperation(db, userId);
  if (deletionOperationId === "already_active") return null;
  return { operationId: deletionOperationId };
}

export async function releaseAccountDeletionOperation(env: Env, userId: string, operation: AccountDeletionOperation) {
  if (operation.operationId) await clearAccountDeletionOperation(requireDb(env), userId, operation.operationId);
}

export async function deleteOwnedAccountData(env: Env, userId: string, existingOperation?: AccountDeletionOperation) {
  const accountDeletionOperation = existingOperation ?? await reserveAccountDeletionOperation(env, userId);
  if (!accountDeletionOperation) {
    return {
      ok: false as const,
      status: 409 as const,
      message: "DZN is already closing this account. Retry shortly.",
    };
  }
  const deletionOperationId = accountDeletionOperation.operationId;
  const db = requireDb(env);
  let discordRoleLease: OwnerDiscordRoleMutationLease | null = null;
  try {
    const discordRoleReservation = await reserveOwnerDiscordAccountDeletionLease(env, userId);
    discordRoleLease = discordRoleReservation.lease;
    if (discordRoleReservation.required && !discordRoleReservation.lease) {
      return { ok: false as const, status: 409 as const, message: "DZN is still issuing or changing this account's Discord owner access. Retry account closure shortly." };
    }
    const renewDiscordRoleReservation = async () => {
      if (await renewOwnerDiscordAccountDeletionLease(env, discordRoleReservation.lease)) return true;
      return false;
    };
    const expiredDiscordRoleReservation = () => ({
      ok: false as const,
      status: 409 as const,
      message: "DZN could not keep this account's Discord owner-access cleanup reservation. No further account data was removed; retry account closure shortly.",
    });
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    const discordRoleCleanup = await revokeOwnerDiscordRoleForAccountDeletion(env, userId, fetch, discordRoleReservation.lease);
    if (!discordRoleCleanup.ok) return discordRoleCleanup;
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    const deleted = emptyDeletionCounts();
    const servers = await db
      .prepare("SELECT id FROM linked_servers WHERE user_id = ?")
      .bind(userId)
      .all<{ id: string }>();

    for (const server of servers.results ?? []) {
      if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
      const result = await deleteOwnedLinkedServerData(env, userId, server.id, {
        skipOwnerDiscordRoleCleanup: true,
        accountDeletionDiscordRoleLease: discordRoleReservation.lease,
      });
      if (!result.ok) return { ok: false as const, status: result.status, message: result.error };
      mergeDeletionCounts(deleted, result.deleted);
      if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    }

    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.nitradoConnections += await deleteRows(db, "DELETE FROM nitrado_connections WHERE user_id = ?", [userId]);
    if (await tableExists(db, "discord_oauth_tokens")) {
      if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
      await deleteRows(db, "DELETE FROM discord_oauth_tokens WHERE user_id = ?", [userId]);
    }
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
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
        if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
        await deleteRows(db,
          `DELETE FROM user_notifications
           WHERE type = 'player_link_review_requested'
             AND json_extract(metadata, '$.claim_id') IN (
               SELECT id FROM player_game_identity_claims WHERE user_id = ?
             )`,
          [userId],
        );
      }
      if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
      await deleteRows(
        db,
        "DELETE FROM user_notifications WHERE user_id = ? AND type != ?",
        [userId, ACCOUNT_DELETION_OPERATION_NOTIFICATION_TYPE],
      );
    }
    if (!(await renewDiscordRoleReservation())) return expiredDiscordRoleReservation();
    deleted.users += await eraseOrRetainAccountUser(db, userId, deletionOperationId);

    return { ok: true as const, deleted };
  } finally {
    try {
      await releaseAccountDeletionOperation(env, userId, accountDeletionOperation);
    } finally {
      await releaseOwnerDiscordRoleMutationLease(env, discordRoleLease);
    }
  }
}

export async function eraseOrRetainAccountUser(db: D1Database, userId: string, deletionOperationId: string | null = null) {
  const retainForStoreLedger = await hasRetainedStoreLedgerReferences(db, userId);
  const cleanupStatements = await directUserCleanupStatements(db, userId);
  const deletionOperationCleanup = deletionOperationId
    ? [db.prepare("DELETE FROM user_notifications WHERE id = ? AND user_id = ? AND type = ?")
      .bind(deletionOperationId, userId, ACCOUNT_DELETION_OPERATION_NOTIFICATION_TYPE)]
    : [];

  if (!retainForStoreLedger) {
    const results = await db.batch([
      ...cleanupStatements,
      ...deletionOperationCleanup,
      db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ]);
    return changes(results[results.length - 1]);
  }

  const touchesUpdatedAt = await tableHasColumn(db, "users", "updated_at");
  const results = await db.batch([
    ...cleanupStatements,
    ...deletionOperationCleanup,
    db.prepare(`UPDATE users
      SET discord_id = ?, username = NULL, avatar = NULL${touchesUpdatedAt ? ", updated_at = CURRENT_TIMESTAMP" : ""}
      WHERE id = ?`)
      .bind(`deleted-${crypto.randomUUID()}`, userId),
  ]);
  return changes(results[results.length - 1]);
}

async function beginAccountDeletionOperation(db: D1Database, userId: string) {
  if (!(await tableExists(db, "user_notifications"))) return null;
  const operationId = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO user_notifications (
    id, user_id, type, title, body, priority, dedupe_key, metadata, read_at, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1 FROM user_notifications
      WHERE user_id = ? AND type = ?
    )`)
    .bind(
      operationId,
      userId,
      ACCOUNT_DELETION_OPERATION_NOTIFICATION_TYPE,
      "Internal account operation",
      "Internal account operation",
      0,
      `internal-account-deletion-operation:${operationId}`,
      JSON.stringify({ internal: true, operation: "account_deletion" }),
      userId,
      ACCOUNT_DELETION_OPERATION_NOTIFICATION_TYPE,
    )
    .run();
  return changes(result) === 1 ? operationId : "already_active";
}

async function clearAccountDeletionOperation(db: D1Database, userId: string, operationId: string) {
  if (!(await tableExists(db, "user_notifications"))) return;
  await db.prepare("DELETE FROM user_notifications WHERE id = ? AND user_id = ? AND type = ?")
    .bind(operationId, userId, ACCOUNT_DELETION_OPERATION_NOTIFICATION_TYPE)
    .run();
}

async function directUserCleanupStatements(db: D1Database, userId: string) {
  const statements: D1PreparedStatement[] = [];
  const cascadeReferences = [
    ["dzn_hide_seek_reward_ledger", "user_id"],
    ["dzn_hide_seek_sessions", "user_id"],
    ["dzn_word_chain_reward_ledger", "user_id"],
    ["dzn_trivia_reward_ledger", "user_id"],
    ["dzn_trivia_sessions", "user_id"],
    ["dzn_game_reward_ledger", "user_id"],
    ["dzn_game_sessions", "user_id"],
    ["dzn_command_centre_spend_ledger", "user_id"],
    ["dzn_command_centre_buildings", "user_id"],
    ["dzn_command_centre_profiles", "user_id"],
    ["dzn_survival_command_resolution_ledger", "user_id"],
    ["dzn_survival_command_expeditions", "user_id"],
      ["dzn_survival_command_loadout_unlocks", "user_id"],
      ["dzn_survival_command_spend_ledger", "user_id"],
    ["dzn_survival_command_profiles", "user_id"],
    ["player_saved_servers", "user_id"],
    ["player_discord_community_memberships", "user_id"],
    ["player_profile_privacy_preferences", "user_id"],
    ["player_public_profiles", "user_id"],
    ["player_game_identity_claims", "user_id"],
    ["player_game_identity_links", "user_id"],
    ["player_game_identity_audit_log", "user_id"],
    ["dzn_comms_private_group_members", "user_id"],
    ["dzn_comms_send_receipts", "actor_user_id"],
    ["dzn_comms_send_slots", "actor_user_id"],
    ["dzn_comms_attempt_slots", "actor_user_id"],
    ["dzn_comms_report_slots", "reporter_user_id"],
    ["dzn_comms_timeouts", "actor_user_id"],
    ["dzn_comms_reports", "reporter_user_id"],
    ["player_game_identity_notification_deliveries", "user_id"],
    ["onboarding_drafts", "user_id"],
    ["player_game_identity_owner_notification_deliveries", "recipient_user_id"],
    ["player_public_discord_identity_preferences", "user_id"],
    ["dzn_comms_message_reactions", "actor_user_id"],
    ["server_community_members", "user_id"],
  ] as const;
  for (const [tableName, columnName] of cascadeReferences) {
    if (!(await tableExists(db, tableName))) continue;
    statements.push(db.prepare(`DELETE FROM ${tableName} WHERE ${columnName} = ?`).bind(userId));
  }

  // A Cabinet belongs to a player, not to a deleted account. Private player
  // ownership, saved selections and their audit history must all disappear
  // during account deletion. Server collections can outlive an individual
  // owner, so their selections and audit trail remain but lose the actor ID.
  if (await tableExists(db, "dzn_vault_showcases")) {
    statements.push(db.prepare("DELETE FROM dzn_vault_showcases WHERE scope_type = 'player' AND scope_id = ?").bind(userId));
    statements.push(db.prepare("UPDATE dzn_vault_showcases SET updated_by_user_id = NULL WHERE scope_type = 'server' AND updated_by_user_id = ?").bind(userId));
  }
  if (await tableExists(db, "dzn_vault_grants")) {
    statements.push(db.prepare("DELETE FROM dzn_vault_grants WHERE scope_type = 'player' AND scope_id = ?").bind(userId));
  }
  if (await tableExists(db, "dzn_vault_audit")) {
    statements.push(db.prepare("DELETE FROM dzn_vault_audit WHERE scope_type = 'player' AND scope_id = ?").bind(userId));
    statements.push(db.prepare("UPDATE dzn_vault_audit SET actor_user_id = NULL WHERE scope_type = 'server' AND actor_user_id = ?").bind(userId));
  }

  if (await tableExists(db, "server_community_member_candidates")) {
    statements.push(db.prepare(`UPDATE server_community_member_candidates
      SET candidate_discord_id = CASE
            WHEN candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?) THEN NULL
            ELSE candidate_discord_id
          END,
          candidate_username = CASE
            WHEN matched_user_id = ?
              OR candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?)
            THEN NULL
            ELSE candidate_username
          END,
          status = CASE
            WHEN status = 'pending'
             AND candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?)
            THEN 'no_match'
            ELSE status
          END,
          matched_user_id = CASE
            WHEN matched_user_id = ?
              OR (status = 'pending' AND candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?))
            THEN NULL
            ELSE matched_user_id
          END,
          reason = CASE
            WHEN status = 'pending'
             AND candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?)
            THEN 'Player account deleted'
            WHEN matched_user_id = ?
             AND candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?)
            THEN 'Player account deleted'
            ELSE reason
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE matched_user_id = ?
         OR candidate_discord_id = (SELECT discord_id FROM users WHERE id = ?)`).bind(userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId));
    statements.push(db.prepare(`UPDATE server_community_member_candidates
      SET created_by_user_id = CASE WHEN created_by_user_id = ? THEN NULL ELSE created_by_user_id END,
          reviewed_by_user_id = CASE WHEN reviewed_by_user_id = ? THEN NULL ELSE reviewed_by_user_id END,
          updated_at = CURRENT_TIMESTAMP
      WHERE created_by_user_id = ? OR reviewed_by_user_id = ?`).bind(userId, userId, userId, userId));
  }
  if (await tableExists(db, "server_community_member_source_audit")) {
    statements.push(db.prepare(`UPDATE server_community_member_source_audit
      SET member_user_id = CASE WHEN member_user_id = ? THEN NULL ELSE member_user_id END,
          actor_user_id = CASE WHEN actor_user_id = ? THEN NULL ELSE actor_user_id END
      WHERE member_user_id = ? OR actor_user_id = ?`).bind(userId, userId, userId, userId));
  }
  if (await tableExists(db, "server_community_member_audit")) {
    statements.push(db.prepare(`UPDATE server_community_member_audit
      SET member_user_id = CASE WHEN member_user_id = ? THEN NULL ELSE member_user_id END,
          actor_user_id = CASE WHEN actor_user_id = ? THEN NULL ELSE actor_user_id END
      WHERE member_user_id = ? OR actor_user_id = ?`).bind(userId, userId, userId, userId));
  }
  if (await tableExists(db, "dzn_comms_owner_message_archive")) {
    statements.push(db.prepare(`UPDATE dzn_comms_owner_message_archive
      SET author_user_id = NULL,
          author_display_name = 'Deleted DZN member',
          author_role_label = 'Deleted account'
      WHERE author_user_id = ?`).bind(userId));
  }
  if (await tableExists(db, "dzn_owner_discord_access_requests")) {
    statements.push(db.prepare(`UPDATE dzn_owner_discord_access_requests
      SET requester_discord_id = NULL,
          requester_username = NULL
      WHERE requester_user_id = ?`).bind(userId));
  }
  if (await tableExists(db, "dzn_owner_discord_access_delivery_attempts")) {
    statements.push(db.prepare(`UPDATE dzn_owner_discord_access_delivery_attempts
      SET requester_discord_id = CASE
            WHEN requester_user_id = ? THEN NULL
            ELSE requester_discord_id
          END,
          actor_discord_id = CASE WHEN actor_user_id = ? THEN NULL ELSE actor_discord_id END
      WHERE requester_user_id = ?
         OR actor_user_id = ?
         OR request_id IN (
           SELECT id FROM dzn_owner_discord_access_requests WHERE requester_user_id = ?
          )`).bind(userId, userId, userId, userId, userId));
  }
  if (await tableExists(db, "dzn_owner_discord_access_audit")) {
    statements.push(db.prepare(`UPDATE dzn_owner_discord_access_audit
      SET actor_discord_id = NULL,
          actor_username = NULL
      WHERE actor_user_id = ?`).bind(userId));
  }

  if (await tableExists(db, "dzn_word_chain_rounds")) {
    statements.push(db.prepare(`UPDATE dzn_word_chain_rounds
      SET current_user_id = NULL
      WHERE current_user_id = ?`)
      .bind(userId));
  }
  if (await tableExists(db, "dzn_word_chain_entries")) {
    statements.push(db.prepare(`UPDATE dzn_word_chain_entries
      SET user_id = NULL
      WHERE user_id = ?`)
      .bind(userId));
  }
  return statements;
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
    ["store_commerce_manual_review_actions", "actor_user_id"],
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
