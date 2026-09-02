import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { requireServerOwnerOrDznAdmin } from "./public-cache";
import type { Env, SessionUser } from "./types";

export type PlayerGameIdentityStatus = "pending" | "approved" | "rejected" | "cancelled";
export type PlayerGameIdentityLinkStatus = "active" | "revoked";

export type PlayerGameIdentityClaimRow = {
  id: string;
  linked_server_id: string;
  player_profile_id: string;
  player_id: string;
  player_name: string | null;
  status: PlayerGameIdentityStatus;
  requested_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  server_name: string | null;
  public_slug: string | null;
  reviewer_name: string | null;
};

export type PlayerGameIdentityLinkRow = {
  id: string;
  linked_server_id: string;
  player_profile_id: string;
  player_id: string;
  player_name: string | null;
  status: PlayerGameIdentityLinkStatus;
  verified_source: "owner_approved" | "dzn_admin_approved";
  verified_at: string | null;
  revoked_at: string | null;
  server_name: string | null;
  public_slug: string | null;
};

export type OwnerPlayerGameIdentityClaimRow = PlayerGameIdentityClaimRow & {
  user_id: string;
  account_name: string | null;
};

type PlayerProfileCandidateRow = {
  id: string;
  linked_server_id: string;
  player_id: string;
  player_name: string | null;
  discord_id: string | null;
  server_name: string | null;
  public_slug: string | null;
};

type PublicIdentityServerRow = {
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
};

type ActiveLinkRow = {
  id: string;
  user_id: string;
  discord_id: string;
  linked_server_id: string;
};

type PendingClaimRow = {
  id: string;
  user_id: string;
};

type ReviewableClaimRow = {
  id: string;
  user_id: string;
  discord_id: string;
  linked_server_id: string;
  player_profile_id: string;
  player_id: string;
  player_name: string | null;
  status: PlayerGameIdentityStatus;
};

type CreateClaimInput = {
  linked_server_id?: unknown;
  server_id?: unknown;
  public_slug?: unknown;
  server_slug?: unknown;
  player_id?: unknown;
};

type ReviewClaimInput = {
  action?: unknown;
  review_note?: unknown;
  note?: unknown;
};

export type CreatePlayerGameIdentityClaimResult =
  | { ok: true; status: 200 | 201; claim: PlayerGameIdentityClaimRow; already_linked?: true; message: string }
  | { ok: false; status: 400 | 404 | 409 | 429 | 503; error: string; message: string };

export type ReviewPlayerGameIdentityClaimResult =
  | { ok: true; status: 200; claim_id: string; link_id: string | null; action: "approved" | "rejected"; message: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string; message: string };

const MAX_PENDING_IDENTITY_CLAIMS_PER_USER = 5;
const MAX_REVIEW_NOTE_LENGTH = 240;
const publicServerWhere = `
  lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged')
  AND lower(COALESCE(linked_servers.listing_visibility, 'public')) != 'hidden'
  AND (linked_servers.merged_into_server_id IS NULL OR linked_servers.merged_into_server_id = '')
  AND linked_servers.public_slug IS NOT NULL
  AND trim(linked_servers.public_slug) != ''
`;

export function sanitizePlayerGameIdentityServerId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 96) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

export function sanitizePlayerGameIdentityServerRef(value: unknown) {
  if (typeof value !== "string") return null;
  const ref = value.trim();
  if (!ref || ref.length > 96) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(ref) && !/^[a-z0-9-]+$/.test(ref)) return null;
  return ref;
}

export function sanitizePlayerGameIdentityPlayerId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 160) return null;
  if (/[\u0000-\u001f\u007f<>]/.test(id)) return null;
  return id;
}

export function parsePlayerGameIdentityClaimInput(input: CreateClaimInput) {
  const serverRef = sanitizePlayerGameIdentityServerRef(input.linked_server_id ?? input.server_id ?? input.public_slug ?? input.server_slug);
  const playerId = sanitizePlayerGameIdentityPlayerId(input.player_id);
  if (!serverRef) return { ok: false as const, error: "INVALID_SERVER_ID", message: "Choose a valid public DZN server." };
  if (!playerId) return { ok: false as const, error: "INVALID_PLAYER_ID", message: "Enter the exact ADM player ID shown by the server owner." };
  return { ok: true as const, serverRef, playerId };
}

export function parsePlayerGameIdentityReviewInput(input: ReviewClaimInput) {
  const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
  const note = sanitizeReviewNote(input.review_note ?? input.note);
  if (action !== "approve" && action !== "reject") {
    return { ok: false as const, error: "INVALID_ACTION", message: "Choose approve or reject." };
  }
  return { ok: true as const, action, note };
}

export async function readPlayerGameIdentityReadModel(env: Env, user: SessionUser) {
  try {
    const db = requireDb(env);
    const [linksResult, claimsResult] = await Promise.all([
      db
        .prepare(
          `SELECT
            player_game_identity_links.id,
            player_game_identity_links.linked_server_id,
            player_game_identity_links.player_profile_id,
            player_game_identity_links.player_id,
            player_game_identity_links.player_name,
            player_game_identity_links.status,
            player_game_identity_links.verified_source,
            player_game_identity_links.verified_at,
            player_game_identity_links.revoked_at,
            COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
            linked_servers.public_slug
           FROM player_game_identity_links
           INNER JOIN linked_servers ON linked_servers.id = player_game_identity_links.linked_server_id
           WHERE player_game_identity_links.user_id = ?
             AND player_game_identity_links.discord_id = ?
             AND player_game_identity_links.status = 'active'
             AND player_game_identity_links.revoked_at IS NULL
           ORDER BY datetime(player_game_identity_links.verified_at) DESC
           LIMIT 20`,
        )
        .bind(user.id, user.discord_id)
        .all<PlayerGameIdentityLinkRow>(),
      db
        .prepare(
          `SELECT
            player_game_identity_claims.id,
            player_game_identity_claims.linked_server_id,
            player_game_identity_claims.player_profile_id,
            player_game_identity_claims.player_id,
            player_game_identity_claims.player_name,
            player_game_identity_claims.status,
            player_game_identity_claims.requested_at,
            player_game_identity_claims.reviewed_at,
            player_game_identity_claims.review_note,
            COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
            linked_servers.public_slug,
            reviewers.username AS reviewer_name
           FROM player_game_identity_claims
           INNER JOIN linked_servers ON linked_servers.id = player_game_identity_claims.linked_server_id
           LEFT JOIN users reviewers ON reviewers.id = player_game_identity_claims.reviewed_by_user_id
           WHERE player_game_identity_claims.user_id = ?
             AND player_game_identity_claims.discord_id = ?
           ORDER BY datetime(player_game_identity_claims.requested_at) DESC
           LIMIT 20`,
        )
        .bind(user.id, user.discord_id)
        .all<PlayerGameIdentityClaimRow>(),
    ]);

    return {
      ok: true as const,
      source: "player_game_identity_links" as const,
      private: true as const,
      presentation_only: true as const,
      active_links: sanitizeLinkRows(linksResult.results ?? []),
      claims: sanitizeClaimRows(claimsResult.results ?? []),
      proof_flow: {
        player_step: "Submit the exact server and ADM player ID from the server owner or approved evidence.",
        owner_step: "A matching server owner or DZN admin approves the claim from the private review queue.",
        match_rule: "DZN links stats only by exact linked_server_id plus ADM player_id. Display names and public handles are never proof.",
      },
      boundary:
        "Verified game identity links are private account bridges for stats display only. They do not affect billing, ownership, scoring, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or competitive eligibility.",
    };
  } catch {
    return {
      ok: true as const,
      source: "unavailable" as const,
      private: true as const,
      presentation_only: true as const,
      active_links: [] as PlayerGameIdentityLinkRow[],
      claims: [] as PlayerGameIdentityClaimRow[],
      proof_flow: {
        player_step: "Submit the exact server and ADM player ID from the server owner or approved evidence.",
        owner_step: "A matching server owner or DZN admin approves the claim from the private review queue.",
        match_rule: "DZN links stats only by exact linked_server_id plus ADM player_id. Display names and public handles are never proof.",
      },
      boundary:
        "Verified game identity link storage is unavailable in this environment. Existing direct Discord-linked profiles remain the compatibility path.",
    };
  }
}

export async function createPlayerGameIdentityClaim(
  env: Env,
  user: SessionUser,
  input: CreateClaimInput,
): Promise<CreatePlayerGameIdentityClaimResult> {
  const parsed = parsePlayerGameIdentityClaimInput(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, message: parsed.message };

  try {
    const db = requireDb(env);
    const server = await readPublicIdentityServer(db, parsed.serverRef);
    if (!server) {
      return {
        ok: false,
        status: 404,
        error: "SERVER_NOT_FOUND",
        message: "No public DZN server matched that slug or server ID.",
      };
    }

    const existingDirect = await readDirectDiscordProfile(db, user.discord_id, server.linked_server_id, parsed.playerId);
    if (existingDirect) {
      return {
        ok: true,
        status: 200,
        already_linked: true,
        claim: claimFromProfile(existingDirect, "approved"),
        message: "This ADM player profile is already linked to your Discord account.",
      };
    }

    const activeLink = await readActiveGameIdentityLink(db, server.linked_server_id, parsed.playerId);
    if (activeLink) {
      if (activeLink.user_id === user.id && activeLink.discord_id === user.discord_id) {
        return {
          ok: true,
          status: 200,
          already_linked: true,
          claim: claimFromActiveLink(activeLink, activeLink.linked_server_id, parsed.playerId),
          message: "This ADM player profile is already verified for your account.",
        };
      }
      await writeGameIdentityAudit(env, {
        action: "claim_requested",
        result: "conflict",
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: server.linked_server_id,
        playerId: parsed.playerId,
        note: "Rejected because the ADM player profile already has an active verified link.",
      });
      return {
        ok: false,
        status: 409,
        error: "PLAYER_ID_ALREADY_LINKED",
        message: "That ADM player ID is already verified for another DZN account.",
      };
    }

    const pending = await readPendingProfileClaim(db, user.id, server.linked_server_id, parsed.playerId);
    if (pending) {
      const claim = await readPlayerGameIdentityClaimById(db, pending.id, user.id, user.discord_id);
      if (claim) {
        return { ok: true, status: 200, claim, message: "This identity claim is already waiting for owner/admin approval." };
      }
    }

    const profileRows = await readExactPlayerProfileCandidates(db, server.linked_server_id, parsed.playerId);
    if (profileRows.length > 1) {
      await writeGameIdentityAudit(env, {
        action: "claim_requested",
        result: "conflict",
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: server.linked_server_id,
        playerId: parsed.playerId,
        note: "Ambiguous ADM player ID claim rejected because more than one public profile row matched.",
      });
      return {
        ok: false,
        status: 409,
        error: "AMBIGUOUS_PLAYER_ID",
        message: "More than one ADM player profile matched that server/player ID pair. DZN will not guess.",
      };
    }

    const profile = profileRows[0] ?? null;
    if (!profile) {
      await writeGameIdentityAudit(env, {
        action: "claim_requested",
        result: "not_found",
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: server.linked_server_id,
        playerId: parsed.playerId,
        note: "No exact public ADM player profile row matched the requested server and player ID.",
      });
      return {
        ok: false,
        status: 404,
        error: "PLAYER_ID_NOT_FOUND",
        message: "No exact ADM player ID was found for that public server. DZN will not match by player name.",
      };
    }

    if (profile.discord_id && profile.discord_id !== user.discord_id) {
      await writeGameIdentityAudit(env, {
        action: "claim_requested",
        result: "conflict",
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: profile.linked_server_id,
        playerProfileId: profile.id,
        playerId: profile.player_id,
        note: "Rejected because the ADM player profile already has another Discord ID attached.",
      });
      return {
        ok: false,
        status: 409,
        error: "PLAYER_ID_ALREADY_LINKED",
        message: "That ADM player ID is already linked to another Discord account.",
      };
    }

    const pendingCount = await db
      .prepare("SELECT COUNT(*) AS count FROM player_game_identity_claims WHERE user_id = ? AND status = 'pending'")
      .bind(user.id)
      .first<{ count: number | null }>();
    if ((Number(pendingCount?.count ?? 0) || 0) >= MAX_PENDING_IDENTITY_CLAIMS_PER_USER) {
      return {
        ok: false,
        status: 429,
        error: "TOO_MANY_PENDING_CLAIMS",
        message: "You already have several pending identity claims. Wait for review before adding more.",
      };
    }

    const claimId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO player_game_identity_claims (
          id, user_id, discord_id, linked_server_id, player_profile_id, player_id, player_name, status, requested_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(claimId, user.id, user.discord_id, profile.linked_server_id, profile.id, profile.player_id, profile.player_name)
      .run();

    await writeGameIdentityAudit(env, {
      action: "claim_requested",
      result: "accepted",
      claimId,
      userId: user.id,
      actorUserId: user.id,
      linkedServerId: profile.linked_server_id,
      playerProfileId: profile.id,
      playerId: profile.player_id,
      note: "Pending exact ADM player ID claim created for owner/admin review.",
    });

    const claim = await readPlayerGameIdentityClaimById(db, claimId, user.id, user.discord_id);
    if (!claim) throw new Error("Claim was not readable after creation.");
    return { ok: true, status: 201, claim, message: "Identity claim created. A server owner or DZN admin must approve it before stats link to your account." };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "IDENTITY_LINKING_UNAVAILABLE",
      message: "Game identity linking is not available in this environment yet.",
    };
  }
}

export async function readOwnerPlayerGameIdentityClaims(env: Env, user: SessionUser) {
  try {
    const db = requireDb(env);
    const isAdmin = isDznAdminDiscordId(env, user.discord_id);
    const result = await db
      .prepare(
        `SELECT
          player_game_identity_claims.id,
          player_game_identity_claims.user_id,
          player_game_identity_claims.linked_server_id,
          player_game_identity_claims.player_profile_id,
          player_game_identity_claims.player_id,
          player_game_identity_claims.player_name,
          player_game_identity_claims.status,
          player_game_identity_claims.requested_at,
          player_game_identity_claims.reviewed_at,
          player_game_identity_claims.review_note,
          COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
          linked_servers.public_slug,
          claim_users.username AS account_name,
          reviewers.username AS reviewer_name
         FROM player_game_identity_claims
         INNER JOIN linked_servers ON linked_servers.id = player_game_identity_claims.linked_server_id
         INNER JOIN users claim_users ON claim_users.id = player_game_identity_claims.user_id
         LEFT JOIN users reviewers ON reviewers.id = player_game_identity_claims.reviewed_by_user_id
         WHERE player_game_identity_claims.status = 'pending'
           AND (? = 1 OR linked_servers.user_id = ?)
         ORDER BY datetime(player_game_identity_claims.requested_at) ASC
         LIMIT 100`,
      )
      .bind(isAdmin ? 1 : 0, user.id)
      .all<OwnerPlayerGameIdentityClaimRow>();

    return {
      ok: true as const,
      source: "player_game_identity_claims" as const,
      private: true as const,
      owner_or_admin_only: true as const,
      claims: sanitizeOwnerClaimRows(result.results ?? []),
      boundary: "Claim review can approve only an exact linked_server_id plus ADM player_id match. It is not a billing, scoring, ranking, review, event, or progression control.",
    };
  } catch {
    return {
      ok: true as const,
      source: "unavailable" as const,
      private: true as const,
      owner_or_admin_only: true as const,
      claims: [] as OwnerPlayerGameIdentityClaimRow[],
      boundary: "Game identity claim review storage is unavailable in this environment.",
    };
  }
}

export async function reviewPlayerGameIdentityClaim(
  env: Env,
  actor: SessionUser,
  claimId: string,
  input: ReviewClaimInput,
): Promise<ReviewPlayerGameIdentityClaimResult> {
  if (!isSafeOpaqueId(claimId)) {
    return { ok: false, status: 400, error: "INVALID_CLAIM_ID", message: "Invalid identity claim id." };
  }
  const parsed = parsePlayerGameIdentityReviewInput(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error, message: parsed.message };

  try {
    const db = requireDb(env);
    const claim = await db
      .prepare(
        `SELECT
          id, user_id, discord_id, linked_server_id, player_profile_id, player_id, player_name, status
         FROM player_game_identity_claims
         WHERE id = ?
         LIMIT 1`,
      )
      .bind(claimId)
      .first<ReviewableClaimRow>();

    if (!claim) return { ok: false, status: 404, error: "CLAIM_NOT_FOUND", message: "Identity claim was not found." };
    const access = await requireServerOwnerOrDznAdmin(env, actor, claim.linked_server_id);
    if (!access.allowed) {
      return { ok: false, status: 403, error: "FORBIDDEN", message: "Only this server owner or a DZN admin can review that claim." };
    }
    if (claim.status !== "pending") {
      return { ok: false, status: 409, error: "CLAIM_ALREADY_REVIEWED", message: "This identity claim has already been reviewed." };
    }

    if (parsed.action === "reject") {
      await db
        .prepare(
          `UPDATE player_game_identity_claims
           SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(actor.id, parsed.note, claim.id)
        .run();
      await writeGameIdentityAudit(env, {
        action: "claim_rejected",
        result: "accepted",
        claimId: claim.id,
        userId: claim.user_id,
        actorUserId: actor.id,
        linkedServerId: claim.linked_server_id,
        playerProfileId: claim.player_profile_id,
        playerId: claim.player_id,
        note: parsed.note,
      });
      return { ok: true, status: 200, claim_id: claim.id, link_id: null, action: "rejected", message: "Identity claim rejected." };
    }

    const exactProfile = await readExactPlayerProfileById(db, claim);
    if (!exactProfile) {
      await writeGameIdentityAudit(env, {
        action: "claim_approved",
        result: "not_found",
        claimId: claim.id,
        userId: claim.user_id,
        actorUserId: actor.id,
        linkedServerId: claim.linked_server_id,
        playerProfileId: claim.player_profile_id,
        playerId: claim.player_id,
        note: "Approval blocked because the exact ADM player profile row no longer exists.",
      });
      return { ok: false, status: 409, error: "PLAYER_PROFILE_NOT_FOUND", message: "The exact ADM player profile row no longer exists." };
    }

    const activeLink = await readActiveGameIdentityLink(db, claim.linked_server_id, claim.player_id);
    if (activeLink && activeLink.user_id !== claim.user_id) {
      await writeGameIdentityAudit(env, {
        action: "claim_approved",
        result: "conflict",
        claimId: claim.id,
        userId: claim.user_id,
        actorUserId: actor.id,
        linkedServerId: claim.linked_server_id,
        playerProfileId: claim.player_profile_id,
        playerId: claim.player_id,
        note: "Approval blocked because the ADM player ID is already actively linked to another account.",
      });
      return { ok: false, status: 409, error: "PLAYER_ID_ALREADY_LINKED", message: "That ADM player ID is already actively linked." };
    }

    const linkId = activeLink?.id ?? crypto.randomUUID();
    const verifiedSource = isDznAdminDiscordId(env, actor.discord_id) ? "dzn_admin_approved" : "owner_approved";
    if (!activeLink) {
      await db
        .prepare(
          `INSERT INTO player_game_identity_links (
            id, user_id, discord_id, linked_server_id, player_profile_id, player_id, player_name, status, verified_source, verified_by_user_id, verified_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .bind(
          linkId,
          claim.user_id,
          claim.discord_id,
          exactProfile.linked_server_id,
          exactProfile.id,
          exactProfile.player_id,
          exactProfile.player_name,
          verifiedSource,
          actor.id,
        )
        .run();
    }

    await db
      .prepare(
        `UPDATE player_profiles
         SET discord_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND linked_server_id = ?
           AND player_id = ?
           AND (discord_id IS NULL OR trim(discord_id) = '' OR discord_id = ?)`,
      )
      .bind(claim.discord_id, exactProfile.id, exactProfile.linked_server_id, exactProfile.player_id, claim.discord_id)
      .run();
    await db
      .prepare(
        `UPDATE player_game_identity_claims
         SET status = 'approved', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(actor.id, parsed.note, claim.id)
      .run();
    await writeGameIdentityAudit(env, {
      action: "link_created",
      result: activeLink ? "already_linked" : "accepted",
      claimId: claim.id,
      linkId,
      userId: claim.user_id,
      actorUserId: actor.id,
      linkedServerId: claim.linked_server_id,
      playerProfileId: claim.player_profile_id,
      playerId: claim.player_id,
      note: parsed.note,
    });
    await writeGameIdentityAudit(env, {
      action: "claim_approved",
      result: "accepted",
      claimId: claim.id,
      linkId,
      userId: claim.user_id,
      actorUserId: actor.id,
      linkedServerId: claim.linked_server_id,
      playerProfileId: claim.player_profile_id,
      playerId: claim.player_id,
      note: parsed.note,
    });

    return { ok: true, status: 200, claim_id: claim.id, link_id: linkId, action: "approved", message: "Identity claim approved and linked by exact ADM player ID." };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "IDENTITY_REVIEW_UNAVAILABLE",
      message: "Game identity claim review is not available in this environment yet.",
    };
  }
}

async function readPublicIdentityServer(db: D1Database, serverRef: string) {
  const result = await db
    .prepare(
      `SELECT
        linked_servers.id AS linked_server_id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug
       FROM linked_servers
       WHERE (linked_servers.id = ? OR linked_servers.public_slug = ?)
         AND ${publicServerWhere}
       LIMIT 2`,
    )
    .bind(serverRef, serverRef)
    .all<PublicIdentityServerRow>();
  const rows = result.results ?? [];
  return rows.length === 1 ? rows[0] : null;
}

async function readExactPlayerProfileCandidates(db: D1Database, linkedServerId: string, playerId: string) {
  const result = await db
    .prepare(
      `SELECT
        player_profiles.id,
        player_profiles.linked_server_id,
        player_profiles.player_id,
        player_profiles.player_name,
        player_profiles.discord_id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE player_profiles.linked_server_id = ?
         AND player_profiles.player_id = ?
         AND player_profiles.player_id IS NOT NULL
         AND trim(player_profiles.player_id) != ''
         AND ${publicServerWhere}
       ORDER BY datetime(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) DESC
       LIMIT 2`,
    )
    .bind(linkedServerId, playerId)
    .all<PlayerProfileCandidateRow>();
  const rows = result.results ?? [];
  return rows;
}

async function readExactPlayerProfileById(db: D1Database, claim: ReviewableClaimRow) {
  return db
    .prepare(
      `SELECT
        id,
        linked_server_id,
        player_id,
        player_name,
        discord_id,
        NULL AS server_name,
        NULL AS public_slug
       FROM player_profiles
       WHERE id = ?
         AND linked_server_id = ?
         AND player_id = ?
         AND player_id IS NOT NULL
         AND trim(player_id) != ''
       LIMIT 1`,
    )
    .bind(claim.player_profile_id, claim.linked_server_id, claim.player_id)
    .first<PlayerProfileCandidateRow>();
}

async function readDirectDiscordProfile(db: D1Database, discordId: string, linkedServerId: string, playerId: string) {
  return db
    .prepare(
      `SELECT
        player_profiles.id,
        player_profiles.linked_server_id,
        player_profiles.player_id,
        player_profiles.player_name,
        player_profiles.discord_id,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug
       FROM player_profiles
       INNER JOIN linked_servers ON linked_servers.id = player_profiles.linked_server_id
       WHERE player_profiles.discord_id = ?
         AND player_profiles.linked_server_id = ?
         AND player_profiles.player_id = ?
         AND ${publicServerWhere}
       LIMIT 1`,
    )
    .bind(discordId, linkedServerId, playerId)
    .first<PlayerProfileCandidateRow>();
}

async function readActiveGameIdentityLink(db: D1Database, linkedServerId: string, playerId: string) {
  return db
    .prepare(
      `SELECT
        player_game_identity_links.id,
        player_game_identity_links.user_id,
        player_game_identity_links.discord_id,
        player_game_identity_links.linked_server_id
       FROM player_game_identity_links
       WHERE player_game_identity_links.linked_server_id = ?
         AND player_game_identity_links.player_id = ?
         AND player_game_identity_links.status = 'active'
         AND player_game_identity_links.revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(linkedServerId, playerId)
    .first<ActiveLinkRow>();
}

async function readPendingProfileClaim(db: D1Database, userId: string, linkedServerId: string, playerId: string) {
  return db
    .prepare(
      `SELECT player_game_identity_claims.id, player_game_identity_claims.user_id
       FROM player_game_identity_claims
       WHERE player_game_identity_claims.user_id = ?
         AND player_game_identity_claims.linked_server_id = ?
         AND player_game_identity_claims.player_id = ?
         AND player_game_identity_claims.status = 'pending'
       LIMIT 1`,
    )
    .bind(userId, linkedServerId, playerId)
    .first<PendingClaimRow>();
}

async function readPlayerGameIdentityClaimById(db: D1Database, claimId: string, userId: string, discordId: string) {
  return db
    .prepare(
      `SELECT
        player_game_identity_claims.id,
        player_game_identity_claims.linked_server_id,
        player_game_identity_claims.player_profile_id,
        player_game_identity_claims.player_id,
        player_game_identity_claims.player_name,
        player_game_identity_claims.status,
        player_game_identity_claims.requested_at,
        player_game_identity_claims.reviewed_at,
        player_game_identity_claims.review_note,
        COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
        linked_servers.public_slug,
        reviewers.username AS reviewer_name
       FROM player_game_identity_claims
       INNER JOIN linked_servers ON linked_servers.id = player_game_identity_claims.linked_server_id
       LEFT JOIN users reviewers ON reviewers.id = player_game_identity_claims.reviewed_by_user_id
       WHERE player_game_identity_claims.id = ?
         AND player_game_identity_claims.user_id = ?
         AND player_game_identity_claims.discord_id = ?
       LIMIT 1`,
    )
    .bind(claimId, userId, discordId)
    .first<PlayerGameIdentityClaimRow>();
}

async function writeGameIdentityAudit(
  env: Env,
  input: {
    action: "claim_requested" | "claim_approved" | "claim_rejected" | "claim_cancelled" | "link_created" | "link_revoked";
    result: "accepted" | "denied" | "already_linked" | "conflict" | "not_found";
    userId: string;
    actorUserId?: string | null;
    claimId?: string | null;
    linkId?: string | null;
    linkedServerId: string;
    playerProfileId?: string | null;
    playerId?: string | null;
    note?: string | null;
  },
) {
  const db = requireDb(env);
  await db
    .prepare(
      `INSERT INTO player_game_identity_audit_log (
        id, claim_id, link_id, user_id, actor_user_id, linked_server_id, player_profile_id, player_id, action, result, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      crypto.randomUUID(),
      input.claimId ?? null,
      input.linkId ?? null,
      input.userId,
      input.actorUserId ?? null,
      input.linkedServerId,
      input.playerProfileId ?? null,
      input.playerId ?? null,
      input.action,
      input.result,
      sanitizeReviewNote(input.note),
    )
    .run();
}

function sanitizeReviewNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.replace(/\s+/g, " ").trim();
  if (!note) return null;
  return note.slice(0, MAX_REVIEW_NOTE_LENGTH);
}

function sanitizeClaimRows(rows: PlayerGameIdentityClaimRow[]) {
  return rows.map((row) => ({
    ...row,
    player_id: maskPlayerId(row.player_id),
    player_name: row.player_name || null,
    server_name: row.server_name || "DZN Server",
    public_slug: row.public_slug || null,
    reviewer_name: row.reviewer_name || null,
  }));
}

function sanitizeOwnerClaimRows(rows: OwnerPlayerGameIdentityClaimRow[]) {
  return rows.map((row) => ({
    ...sanitizeClaimRows([row])[0],
    user_id: row.user_id,
    account_name: row.account_name || "DZN Player",
  }));
}

function sanitizeLinkRows(rows: PlayerGameIdentityLinkRow[]) {
  return rows.map((row) => ({
    ...row,
    player_id: maskPlayerId(row.player_id),
    player_name: row.player_name || null,
    server_name: row.server_name || "DZN Server",
    public_slug: row.public_slug || null,
  }));
}

function claimFromProfile(profile: PlayerProfileCandidateRow, status: PlayerGameIdentityStatus): PlayerGameIdentityClaimRow {
  return {
    id: profile.id,
    linked_server_id: profile.linked_server_id,
    player_profile_id: profile.id,
    player_id: maskPlayerId(profile.player_id),
    player_name: profile.player_name,
    status,
    requested_at: null,
    reviewed_at: null,
    review_note: null,
    server_name: profile.server_name,
    public_slug: profile.public_slug,
    reviewer_name: null,
  };
}

function claimFromActiveLink(activeLink: ActiveLinkRow, linkedServerId: string, playerId: string): PlayerGameIdentityClaimRow {
  return {
    id: activeLink.id,
    linked_server_id: linkedServerId,
    player_profile_id: "",
    player_id: maskPlayerId(playerId),
    player_name: null,
    status: "approved",
    requested_at: null,
    reviewed_at: null,
    review_note: null,
    server_name: null,
    public_slug: null,
    reviewer_name: null,
  };
}

function maskPlayerId(playerId: string | null) {
  const value = typeof playerId === "string" ? playerId.trim() : "";
  if (!value) return "";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isSafeOpaqueId(value: string) {
  return /^[A-Za-z0-9_-]{1,96}$/.test(value.trim());
}
