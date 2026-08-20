import { decryptToken, encryptToken } from "./crypto";
import { ensureLinkedServerMetadataColumns, requireDb } from "./db";
import { getOwnerEntitlements } from "./plans";
import type { Env, NitradoService, ServerType } from "./types";

export const LINKED_SERVER_ALLOWANCE_RESERVATION_TTL_MS = 30 * 60 * 1000;

export const LINKED_SERVER_ALLOWANCE_RESERVATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS linked_server_allowance_reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_user_id TEXT,
  linked_server_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'onboarding',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  released_at TEXT,
  expired_at TEXT,
  release_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const LINKED_SERVER_ALLOWANCE_RESERVATIONS_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_lsar_user_status_expires ON linked_server_allowance_reservations(user_id, status, expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_lsar_linked_server_status ON linked_server_allowance_reservations(linked_server_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_lsar_discord_user_status ON linked_server_allowance_reservations(discord_user_id, status)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_lsar_active_linked_server ON linked_server_allowance_reservations(linked_server_id) WHERE status = 'active' AND linked_server_id IS NOT NULL",
] as const;

type ReservationStatus = "active" | "completed" | "released" | "expired";

type LinkedServerAllowanceReservationRow = {
  id: string;
  user_id: string;
  discord_user_id: string | null;
  linked_server_id: string | null;
  status: ReservationStatus;
  expires_at: string;
};

type OwnedLinkedServerRow = {
  id: string;
  user_id: string;
  guild_id: string;
  discord_guild_id: string;
  discord_id: string | null;
  nitrado_service_id: string | null;
  status: string | null;
  merged_into_server_id: string | null;
};

export type LinkedServerAllowanceUsage = {
  limit: number;
  used: number;
  remaining: number;
  canLinkMore: boolean;
};

export type LinkedServerNitradoServiceAttachmentResult = {
  linkedServerId: string;
  createdNewCanonicalServer: boolean;
  reusedSameOwnerCanonicalServer: boolean;
  sourceDraftMerged: boolean;
  reservationCompleted: boolean;
  reservationReleased: boolean;
  pendingReservationAction: "complete" | "release" | null;
  sourceLinkedServerId: string;
};

export class LinkedServerAllowanceExceededError extends Error {
  readonly limit: number;
  readonly currentCount: number;

  constructor(limit: number, currentCount: number) {
    super(linkedServerAllowanceLimitMessage(limit));
    this.name = "LinkedServerAllowanceExceededError";
    this.limit = limit;
    this.currentCount = currentCount;
  }
}

export class LinkedServerOwnershipError extends Error {
  readonly code = "linked_server_not_found";

  constructor() {
    super("Linked server not found");
    this.name = "LinkedServerOwnershipError";
  }
}

export class ExactLinkedServerCredentialMissingError extends Error {
  readonly code = "missing_nitrado_token";

  constructor() {
    super("No saved Nitrado token was found for this linked server.");
    this.name = "ExactLinkedServerCredentialMissingError";
  }
}

export class NitradoServiceAlreadyLinkedError extends Error {
  readonly code = "nitrado_service_already_linked";

  constructor() {
    super("This Nitrado service is already linked to another DZN owner.");
    this.name = "NitradoServiceAlreadyLinkedError";
  }
}

export class NitradoServiceClaimConflictError extends Error {
  readonly code = "nitrado_service_claim_conflict";

  constructor() {
    super("DZN could not safely claim this Nitrado service. Try again.");
    this.name = "NitradoServiceClaimConflictError";
  }
}

export const serverTypes: ServerType[] = ["PVP", "DEATHMATCH", "PVE", "PVP / PVE"];
export const allowedTags = [
  "Raid Focused",
  "Factions",
  "Base Building",
  "Trader / Economy",
  "Events",
  "Survival",
  "Hardcore",
  "No Base Decay",
  "Custom Maps",
  "Weekend Raids",
  "KOS",
  "Active Admins",
  "New Player Friendly",
  "Roleplay",
  "Modded",
];

export function validateServerType(value: string): value is ServerType {
  return serverTypes.includes(value as ServerType);
}

export function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string" && allowedTags.includes(tag))
    .slice(0, 5);
}

export function publicSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || `server-${Date.now()}`;
}

export async function uniquePublicSlug(env: Env, name: string, linkedServerId?: string) {
  const db = requireDb(env);
  const base = publicSlug(name);
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await db
      .prepare("SELECT id FROM linked_servers WHERE public_slug = ? LIMIT 1")
      .bind(candidate)
      .first<{ id: string }>();
    if (!existing || existing.id === linkedServerId) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function ensureDraftLinkedServer(
  env: Env,
  userId: string,
  discordGuildId: string,
  serverType: ServerType,
  tags: string[],
  serverCategory?: string | null,
) {
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  await ensureLinkedServerAllowanceReservationSchema(env);
  const guild = await db
    .prepare("SELECT id, guild_id FROM discord_guilds WHERE guild_id = ? AND owner_user_id = ? LIMIT 1")
    .bind(discordGuildId, userId)
    .first<{ id: string; guild_id: string }>();

  if (!guild) throw new Error("Discord guild not found");
  const owner = await db
    .prepare("SELECT discord_id FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ discord_id: string }>();

  const existingDraft = await db
    .prepare(
      `SELECT id
       FROM linked_servers
       WHERE user_id = ?
         AND lower(COALESCE(status, 'pending')) = 'pending'
         AND (nitrado_service_id IS NULL OR nitrado_service_id = '')
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string }>();
  const linkedServerId = existingDraft?.id ?? crypto.randomUUID();
  const reservation = await reserveLinkedServerAllowance(env, {
    userId,
    discordUserId: owner?.discord_id ?? null,
    linkedServerId,
  });
  if (!reservation.ok) {
    throw new LinkedServerAllowanceExceededError(reservation.limit, reservation.currentCount);
  }

  try {
    if (existingDraft) {
      await db
        .prepare(
          `UPDATE linked_servers SET
            guild_id = ?,
            discord_guild_id = ?,
            server_name = ?,
            server_type = ?,
            server_category = COALESCE(?, server_category),
            tags_json = ?,
            status = 'pending',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        )
        .bind(guild.guild_id, guild.id, "Pending Nitrado Service", serverType, serverCategory ?? null, JSON.stringify(tags), linkedServerId)
        .run();
      return linkedServerId;
    }

    await db
      .prepare(
        `INSERT INTO linked_servers (
          id, user_id, guild_id, discord_guild_id, server_name, server_type, server_category, tags_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(
        linkedServerId,
        userId,
        guild.guild_id,
        guild.id,
        "Pending Nitrado Service",
        serverType,
        serverCategory ?? null,
        JSON.stringify(tags),
      )
      .run();
  } catch (error) {
    await releaseLinkedServerAllowanceReservation(env, {
      reservationId: reservation.reservationId,
      reason: "draft_write_failed",
    }).catch(() => null);
    throw error;
  }

  return linkedServerId;
}

export async function getServerLinkLimitForUser(env: Env, userId: string, discordUserId?: string | null) {
  if (!discordUserId) return 1;
  const entitlements = await getOwnerEntitlements(env, discordUserId);
  return entitlements.max_linked_servers;
}

export async function countLinkedServersForUser(env: Env, userId: string, options: { now?: Date | string } = {}) {
  const db = requireDb(env);
  await ensureLinkedServerAllowanceReservationSchema(env);
  const nowIso = toIsoString(options.now);
  await expireLinkedServerAllowanceReservations(env, { userId, now: nowIso });
  const [linkedServerCount, reservationCount] = await Promise.all([
    countCommittedLinkedServersForUser(db, userId),
    countActiveLinkedServerAllowanceReservationsForUser(db, userId, nowIso),
  ]);
  return linkedServerCount + reservationCount;
}

export async function getLinkedServerAllowanceUsageForUser(
  env: Env,
  input: {
    userId: string;
    discordUserId?: string | null;
    limit?: number;
    now?: Date | string;
  },
): Promise<LinkedServerAllowanceUsage> {
  const limit = clampAllowanceLimit(
    typeof input.limit === "number" ? input.limit : await getServerLinkLimitForUser(env, input.userId, input.discordUserId),
  );
  const used = await countLinkedServersForUser(env, input.userId, { now: input.now });
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    canLinkMore: remaining > 0,
  };
}

export async function storePendingNitradoToken(env: Env, userId: string, linkedServerId: string, token: string) {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    await releaseLinkedServerAllowanceReservation(env, {
      userId,
      linkedServerId,
      reason: "missing_token_encryption_key",
    }).catch(() => null);
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }
  const encrypted = await encryptToken(token, env.TOKEN_ENCRYPTION_KEY);
  const db = requireDb(env);
  try {
    await db
      .prepare(
        `INSERT INTO nitrado_connections (
          id, user_id, linked_server_id, encrypted_token, token_iv, token_auth_tag, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(crypto.randomUUID(), userId, linkedServerId, encrypted.encryptedToken, encrypted.iv, encrypted.authTag)
      .run();
  } catch (error) {
    await releaseLinkedServerAllowanceReservation(env, {
      userId,
      linkedServerId,
      reason: "nitrado_token_write_failed",
    }).catch(() => null);
    throw error;
  }
}

export async function getLatestNitradoToken(env: Env, userId: string) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const db = requireDb(env);
  const row = await db
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();

  if (!row) return null;
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

export async function assertLinkedServerOwnedByUser(env: Env, userId: string, linkedServerId: string) {
  return loadOwnedLinkedServer(env, userId, linkedServerId);
}

export async function getNitradoTokenForLinkedServer(
  env: Env,
  userId: string,
  linkedServerId: string,
): Promise<string | null> {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const db = requireDb(env);
  await loadOwnedLinkedServer(env, userId, linkedServerId);
  const row = await db
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ?
         AND linked_server_id = ?
       ORDER BY updated_at DESC, created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId, linkedServerId)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();

  if (!row) return null;
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

export async function moveNitradoConnectionsForLinkedServer(
  env: Env,
  userId: string,
  sourceLinkedServerId: string,
  targetLinkedServerId: string,
) {
  if (sourceLinkedServerId === targetLinkedServerId) return { moved: 0 };
  const db = requireDb(env);
  await loadOwnedLinkedServer(env, userId, sourceLinkedServerId);
  await loadOwnedLinkedServer(env, userId, targetLinkedServerId);
  const result = await db
    .prepare(
      `UPDATE nitrado_connections
       SET linked_server_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND linked_server_id = ?`,
    )
    .bind(targetLinkedServerId, userId, sourceLinkedServerId)
    .run();
  return { moved: runChanges(result) };
}

export async function linkLatestNitradoConnection(env: Env, userId: string, linkedServerId: string) {
  const db = requireDb(env);
  await db
    .prepare(
      `UPDATE nitrado_connections
       SET linked_server_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = (
         SELECT id FROM nitrado_connections
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1
       )`,
    )
    .bind(linkedServerId, userId)
    .run();
}

export function findService(services: NitradoService[], id: string) {
  return services.find((service) => service.id === id) ?? null;
}

export async function saveLinkedServerNitradoService(
  env: Env,
  userId: string,
  linkedServerId: string,
  service: NitradoService,
  serverType: ServerType,
  tags: string[],
  serverCategory?: string | null,
  options: { finalizeReservation?: boolean } = {},
): Promise<LinkedServerNitradoServiceAttachmentResult> {
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  await ensureLinkedServerAllowanceReservationSchema(env);
  const source = await loadOwnedLinkedServer(env, userId, linkedServerId);
  const finalizeReservation = options.finalizeReservation ?? true;

  const existingService = await db
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE nitrado_service_id = ?
         AND id != ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       ORDER BY
         CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN 0 ELSE 1 END,
         updated_at DESC,
         created_at DESC,
         id DESC
       LIMIT 1`,
    )
    .bind(service.id, linkedServerId)
    .first<{ id: string; user_id: string }>();

  if (existingService) {
    if (existingService.user_id !== userId) {
      await releaseActiveLinkedServerReservation(env, userId, linkedServerId, "nitrado_service_already_linked");
      throw new NitradoServiceAlreadyLinkedError();
    }
    return reuseSameOwnerCanonicalServer(env, {
      userId,
      source,
      canonicalLinkedServerId: existingService.id,
      service,
      serverType,
      tags,
      serverCategory,
      finalizeReservation,
    });
  }

  if (isActiveUnmergedSource(source) && normalizeServiceId(source.nitrado_service_id) === service.id) {
    await updateCanonicalServiceDetails(env, {
      linkedServerId,
      userId,
      service,
      serverType,
      tags,
      serverCategory,
      syncGuildFromSource: false,
      source,
    });
    return {
      linkedServerId,
      createdNewCanonicalServer: false,
      reusedSameOwnerCanonicalServer: false,
      sourceDraftMerged: false,
      reservationCompleted: false,
      reservationReleased: false,
      pendingReservationAction: null,
      sourceLinkedServerId: linkedServerId,
    };
  }

  const sourceServiceId = normalizeServiceId(source.nitrado_service_id);
  if (sourceServiceId && sourceServiceId !== service.id) {
    throw new NitradoServiceClaimConflictError();
  }

  const reservation = await reserveLinkedServerAllowance(env, {
    userId,
    discordUserId: source.discord_id,
    linkedServerId,
  });
  if (!reservation.ok) {
    throw new LinkedServerAllowanceExceededError(reservation.limit, reservation.currentCount);
  }

  try {
    const slug = await uniquePublicSlug(env, service.name, linkedServerId);
    const result = await db
      .prepare(
        `UPDATE linked_servers SET
          nitrado_service_id = ?,
          nitrado_service_name = ?,
          server_name = ?,
          server_type = ?,
          server_category = COALESCE(?, server_category),
          tags_json = ?,
          region = ?,
          game = ?,
          platform = ?,
          ip_address = ?,
          player_slots = ?,
          status = CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN status ELSE 'pending' END,
          public_slug = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND user_id = ?
          AND (nitrado_service_id IS NULL OR nitrado_service_id = '' OR nitrado_service_id = ?)`,
      )
      .bind(
        service.id,
        service.name,
        service.name,
        serverType,
        serverCategory ?? null,
        JSON.stringify(tags),
        service.ipAddress ?? service.region ?? null,
        service.game ?? null,
        service.platform ?? null,
        service.ipAddress ?? null,
        service.playerSlots ?? null,
        slug,
        linkedServerId,
        userId,
        service.id,
      )
      .run();

    if (runChanges(result) < 1) {
      throw new NitradoServiceClaimConflictError();
    }

    let reservationCompleted = false;
    if (finalizeReservation) {
      await completeLinkedServerAllowanceReservation(env, reservation.reservationId, linkedServerId);
      reservationCompleted = true;
    }

    return {
      linkedServerId,
      createdNewCanonicalServer: true,
      reusedSameOwnerCanonicalServer: false,
      sourceDraftMerged: false,
      reservationCompleted,
      reservationReleased: false,
      pendingReservationAction: finalizeReservation ? null : "complete",
      sourceLinkedServerId: linkedServerId,
    };
  } catch (error) {
    const raceResult = await resolveServiceClaimRace(env, {
      userId,
      source,
      service,
      serverType,
      tags,
      serverCategory,
      finalizeReservation,
    }).catch((raceError) => {
      if (raceError instanceof NitradoServiceAlreadyLinkedError || raceError instanceof NitradoServiceClaimConflictError) {
        throw raceError;
      }
      return null;
    });
    if (raceResult) return raceResult;
    await releaseLinkedServerAllowanceReservation(env, {
      reservationId: reservation.reservationId,
      reason: "service_attachment_failed",
    }).catch(() => null);
    if (isUniqueConstraintError(error)) {
      const winner = await findActiveLinkedServerForService(env, service.id, linkedServerId);
      if (winner?.user_id && winner.user_id !== userId) {
        throw new NitradoServiceAlreadyLinkedError();
      }
    }
    throw error;
  }
}

async function loadOwnedLinkedServer(env: Env, userId: string, linkedServerId: string) {
  const normalizedLinkedServerId = linkedServerId.trim();
  if (!normalizedLinkedServerId) throw new LinkedServerOwnershipError();
  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  const row = await db
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.user_id,
              linked_servers.guild_id,
              linked_servers.discord_guild_id,
              linked_servers.nitrado_service_id,
              linked_servers.status,
              linked_servers.merged_into_server_id,
              users.discord_id
       FROM linked_servers
       LEFT JOIN users ON users.id = linked_servers.user_id
       WHERE linked_servers.id = ?
         AND linked_servers.user_id = ?
       LIMIT 1`,
    )
    .bind(normalizedLinkedServerId, userId)
    .first<OwnedLinkedServerRow>();
  if (!row) throw new LinkedServerOwnershipError();
  return row;
}

async function reuseSameOwnerCanonicalServer(
  env: Env,
  input: {
    userId: string;
    source: OwnedLinkedServerRow;
    canonicalLinkedServerId: string;
    service: NitradoService;
    serverType: ServerType;
    tags: string[];
    serverCategory?: string | null;
    finalizeReservation: boolean;
  },
): Promise<LinkedServerNitradoServiceAttachmentResult> {
  await moveNitradoConnectionsForLinkedServer(env, input.userId, input.source.id, input.canonicalLinkedServerId);
  await updateCanonicalServiceDetails(env, {
    linkedServerId: input.canonicalLinkedServerId,
    userId: input.userId,
    service: input.service,
    serverType: input.serverType,
    tags: input.tags,
    serverCategory: input.serverCategory,
    syncGuildFromSource: false,
    source: input.source,
  });
  const sourceDraftMerged = await mergeSourceDraftIntoCanonical(env, input.userId, input.source.id, input.canonicalLinkedServerId);
  const reservationReleased = input.finalizeReservation
    ? await releaseActiveLinkedServerReservation(env, input.userId, input.source.id, "same_owner_canonical_reuse")
    : false;
  return {
    linkedServerId: input.canonicalLinkedServerId,
    createdNewCanonicalServer: false,
    reusedSameOwnerCanonicalServer: true,
    sourceDraftMerged,
    reservationCompleted: false,
    reservationReleased,
    pendingReservationAction: input.finalizeReservation ? null : "release",
    sourceLinkedServerId: input.source.id,
  };
}

async function updateCanonicalServiceDetails(
  env: Env,
  input: {
    linkedServerId: string;
    userId: string;
    service: NitradoService;
    serverType: ServerType;
    tags: string[];
    serverCategory?: string | null;
    syncGuildFromSource: boolean;
    source: OwnedLinkedServerRow;
  },
) {
  const db = requireDb(env);
  const slug = await uniquePublicSlug(env, input.service.name, input.linkedServerId);
  if (input.syncGuildFromSource) {
    await db
      .prepare(
        `UPDATE linked_servers SET
          guild_id = ?,
          discord_guild_id = ?,
          nitrado_service_id = ?,
          nitrado_service_name = ?,
          server_name = ?,
          server_type = ?,
          server_category = COALESCE(?, server_category),
          tags_json = ?,
          region = ?,
          game = ?,
          platform = ?,
          ip_address = ?,
          player_slots = ?,
          status = CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN status ELSE 'pending' END,
          public_slug = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND user_id = ?`,
      )
      .bind(
        input.source.guild_id,
        input.source.discord_guild_id,
        input.service.id,
        input.service.name,
        input.service.name,
        input.serverType,
        input.serverCategory ?? null,
        JSON.stringify(input.tags),
        input.service.ipAddress ?? input.service.region ?? null,
        input.service.game ?? null,
        input.service.platform ?? null,
        input.service.ipAddress ?? null,
        input.service.playerSlots ?? null,
        slug,
        input.linkedServerId,
        input.userId,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `UPDATE linked_servers SET
        nitrado_service_id = ?,
        nitrado_service_name = ?,
        server_name = ?,
        server_type = ?,
        server_category = COALESCE(?, server_category),
        tags_json = ?,
        region = ?,
        game = ?,
        platform = ?,
        ip_address = ?,
        player_slots = ?,
        status = CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN status ELSE 'pending' END,
        public_slug = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND user_id = ?`,
    )
    .bind(
      input.service.id,
      input.service.name,
      input.service.name,
      input.serverType,
      input.serverCategory ?? null,
      JSON.stringify(input.tags),
      input.service.ipAddress ?? input.service.region ?? null,
      input.service.game ?? null,
      input.service.platform ?? null,
      input.service.ipAddress ?? null,
      input.service.playerSlots ?? null,
      slug,
      input.linkedServerId,
      input.userId,
    )
    .run();
}

async function mergeSourceDraftIntoCanonical(env: Env, userId: string, sourceLinkedServerId: string, canonicalLinkedServerId: string) {
  if (sourceLinkedServerId === canonicalLinkedServerId) return false;
  const result = await requireDb(env)
    .prepare(
      `UPDATE linked_servers
       SET status = 'merged',
           merged_into_server_id = ?,
           merged_at = COALESCE(merged_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND user_id = ?
         AND lower(COALESCE(status, 'pending')) = 'pending'
         AND (nitrado_service_id IS NULL OR nitrado_service_id = '')`,
    )
    .bind(canonicalLinkedServerId, sourceLinkedServerId, userId)
    .run();
  return runChanges(result) > 0;
}

async function releaseActiveLinkedServerReservation(env: Env, userId: string, linkedServerId: string, reason: string) {
  const activeReservation = await getActiveLinkedServerAllowanceReservation(env, userId, linkedServerId);
  if (!activeReservation) return false;
  await releaseLinkedServerAllowanceReservation(env, {
    reservationId: activeReservation.id,
    reason,
  });
  return true;
}

async function resolveServiceClaimRace(
  env: Env,
  input: {
    userId: string;
    source: OwnedLinkedServerRow;
    service: NitradoService;
    serverType: ServerType;
    tags: string[];
    serverCategory?: string | null;
    finalizeReservation: boolean;
  },
): Promise<LinkedServerNitradoServiceAttachmentResult | null> {
  const winner = await findActiveLinkedServerForService(env, input.service.id, input.source.id);
  if (!winner) return null;
  if (winner.user_id !== input.userId) {
    await releaseActiveLinkedServerReservation(env, input.userId, input.source.id, "nitrado_service_already_linked");
    throw new NitradoServiceAlreadyLinkedError();
  }
  return reuseSameOwnerCanonicalServer(env, {
    userId: input.userId,
    source: input.source,
    canonicalLinkedServerId: winner.id,
    service: input.service,
    serverType: input.serverType,
    tags: input.tags,
    serverCategory: input.serverCategory,
    finalizeReservation: input.finalizeReservation,
  });
}

async function findActiveLinkedServerForService(env: Env, serviceId: string, excludedLinkedServerId: string) {
  return requireDb(env)
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE nitrado_service_id = ?
         AND id != ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('merged', 'deleted')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       ORDER BY
         CASE WHEN lower(COALESCE(status, 'pending')) = 'live' THEN 0 ELSE 1 END,
         updated_at DESC,
         created_at DESC,
         id DESC
       LIMIT 1`,
    )
    .bind(serviceId, excludedLinkedServerId)
    .first<{ id: string; user_id: string }>();
}

function isActiveUnmergedSource(source: OwnedLinkedServerRow) {
  const status = (source.status ?? "pending").toLowerCase();
  return status !== "merged" && status !== "deleted" && !source.merged_into_server_id;
}

function normalizeServiceId(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isUniqueConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unique|constraint|idx_linked_servers_active_service_id/i.test(message);
}

function runChanges(result: unknown) {
  const changes = (result as { meta?: { changes?: unknown } })?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

export async function ensureLinkedServerAllowanceReservationSchema(env: Env) {
  const db = requireDb(env);
  await db.prepare(LINKED_SERVER_ALLOWANCE_RESERVATIONS_TABLE_SQL).run();
  for (const statement of LINKED_SERVER_ALLOWANCE_RESERVATIONS_INDEX_SQL) {
    await db.prepare(statement).run();
  }
}

export async function reserveLinkedServerAllowance(
  env: Env,
  input: {
    userId: string;
    discordUserId?: string | null;
    linkedServerId?: string | null;
    now?: Date | string;
    ttlMs?: number;
  },
): Promise<
  | { ok: true; reservationId: string; expiresAt: string; reused: boolean }
  | { ok: false; limit: number; currentCount: number }
> {
  await ensureLinkedServerAllowanceReservationSchema(env);
  const db = requireDb(env);
  const nowIso = toIsoString(input.now);
  await expireLinkedServerAllowanceReservations(env, { userId: input.userId, now: nowIso });

  if (input.linkedServerId) {
    const existing = await getActiveLinkedServerAllowanceReservation(env, input.userId, input.linkedServerId, nowIso);
    if (existing) {
      return { ok: true, reservationId: existing.id, expiresAt: existing.expires_at, reused: true };
    }
  }

  const usage = await getLinkedServerAllowanceUsageForUser(env, {
    userId: input.userId,
    discordUserId: input.discordUserId,
    now: nowIso,
  });
  if (!usage.canLinkMore) {
    return { ok: false, limit: usage.limit, currentCount: usage.used };
  }

  const reservationId = crypto.randomUUID();
  const expiresAt = new Date(new Date(nowIso).getTime() + (input.ttlMs ?? LINKED_SERVER_ALLOWANCE_RESERVATION_TTL_MS)).toISOString();
  await db
    .prepare(
      `INSERT INTO linked_server_allowance_reservations (
        id, user_id, discord_user_id, linked_server_id, purpose, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'onboarding', 'active', ?, ?, ?)`,
    )
    .bind(reservationId, input.userId, input.discordUserId ?? null, input.linkedServerId ?? null, expiresAt, nowIso, nowIso)
    .run();
  return { ok: true, reservationId, expiresAt, reused: false };
}

export async function completeLinkedServerAllowanceReservation(
  env: Env,
  reservationId: string,
  linkedServerId: string,
  now: Date | string = new Date(),
) {
  await ensureLinkedServerAllowanceReservationSchema(env);
  const nowIso = toIsoString(now);
  await requireDb(env)
    .prepare(
      `UPDATE linked_server_allowance_reservations
       SET status = 'completed',
           linked_server_id = COALESCE(linked_server_id, ?),
           completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE id = ?
         AND status = 'active'`,
    )
    .bind(linkedServerId, nowIso, nowIso, reservationId)
    .run();
}

export async function releaseLinkedServerAllowanceReservation(
  env: Env,
  input: {
    reservationId?: string | null;
    userId?: string | null;
    linkedServerId?: string | null;
    reason?: string | null;
    now?: Date | string;
  },
) {
  if (!input.reservationId && (!input.userId || !input.linkedServerId)) return;
  await ensureLinkedServerAllowanceReservationSchema(env);
  const nowIso = toIsoString(input.now);
  if (input.userId) await expireLinkedServerAllowanceReservations(env, { userId: input.userId, now: nowIso });
  const reason = input.reason ?? "released";
  const db = requireDb(env);
  if (input.reservationId) {
    await db
      .prepare(
        `UPDATE linked_server_allowance_reservations
         SET status = 'released',
             released_at = COALESCE(released_at, ?),
             release_reason = COALESCE(release_reason, ?),
             updated_at = ?
         WHERE id = ?
           AND status = 'active'`,
      )
      .bind(nowIso, reason, nowIso, input.reservationId)
      .run();
    return;
  }

  await db
    .prepare(
      `UPDATE linked_server_allowance_reservations
       SET status = 'released',
           released_at = COALESCE(released_at, ?),
           release_reason = COALESCE(release_reason, ?),
           updated_at = ?
       WHERE user_id = ?
         AND linked_server_id = ?
         AND status = 'active'`,
    )
    .bind(nowIso, reason, nowIso, input.userId, input.linkedServerId)
    .run();
}

export async function expireLinkedServerAllowanceReservations(
  env: Env,
  input: { userId?: string | null; now?: Date | string } = {},
) {
  const db = requireDb(env);
  const nowIso = toIsoString(input.now);
  const statement = input.userId
    ? db
        .prepare(
          `UPDATE linked_server_allowance_reservations
           SET status = 'expired',
               expired_at = COALESCE(expired_at, ?),
               updated_at = ?
           WHERE user_id = ?
             AND status = 'active'
             AND expires_at <= ?`,
        )
        .bind(nowIso, nowIso, input.userId, nowIso)
    : db
        .prepare(
          `UPDATE linked_server_allowance_reservations
           SET status = 'expired',
               expired_at = COALESCE(expired_at, ?),
               updated_at = ?
           WHERE status = 'active'
             AND expires_at <= ?`,
        )
        .bind(nowIso, nowIso, nowIso);
  await statement.run();
}

export async function getActiveLinkedServerAllowanceReservation(
  env: Env,
  userId: string,
  linkedServerId: string,
  now: Date | string = new Date(),
) {
  await ensureLinkedServerAllowanceReservationSchema(env);
  const nowIso = toIsoString(now);
  await expireLinkedServerAllowanceReservations(env, { userId, now: nowIso });
  return requireDb(env)
    .prepare(
      `SELECT id, user_id, discord_user_id, linked_server_id, status, expires_at
       FROM linked_server_allowance_reservations
       WHERE user_id = ?
         AND linked_server_id = ?
         AND status = 'active'
         AND expires_at > ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId, linkedServerId, nowIso)
    .first<LinkedServerAllowanceReservationRow>();
}

export function linkedServerAllowanceLimitMessage(limit: number) {
  return `Your current plan allows ${limit} linked server${limit === 1 ? "" : "s"}. Upgrade to add more.`;
}

async function countCommittedLinkedServersForUser(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM linked_servers
       WHERE user_id = ?
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
         AND nitrado_service_id IS NOT NULL
         AND nitrado_service_id != ''`,
    )
    .bind(userId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function countActiveLinkedServerAllowanceReservationsForUser(db: D1Database, userId: string, nowIso: string) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM linked_server_allowance_reservations reservations
       WHERE reservations.user_id = ?
         AND reservations.status = 'active'
         AND reservations.expires_at > ?
         AND NOT EXISTS (
           SELECT 1
           FROM linked_servers
           WHERE linked_servers.id = reservations.linked_server_id
             AND linked_servers.user_id = reservations.user_id
             AND lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
             AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
             AND linked_servers.nitrado_service_id IS NOT NULL
             AND linked_servers.nitrado_service_id != ''
         )`,
    )
    .bind(userId, nowIso)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function toIsoString(value: Date | string | undefined) {
  if (typeof value === "string") return value;
  return (value ?? new Date()).toISOString();
}

function clampAllowanceLimit(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
