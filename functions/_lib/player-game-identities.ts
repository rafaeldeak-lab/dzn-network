import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { isPlatformOwnerDiscordId } from "./platform-owner";
import { requireServerOwnerOrDznAdmin } from "./public-cache";
import type { PlayerGameIdentityDecisionDelivery } from "./player-game-identity-notifications";
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
  requester_discord_id: string;
  account_name: string | null;
  account_avatar: string | null;
  request_source: "gamertag_lookup" | "legacy_exact_id";
};

export type OwnerPlayerGameIdentityClaimPayloadRow = PlayerGameIdentityClaimRow & {
  user_id: string;
  requester_discord_id: string;
  account_name: string | null;
  account_avatar_url: string | null;
  request_source: "gamertag_lookup" | "legacy_exact_id";
  submitted_player_id: string;
  review_context: {
    evidence_status: "ready_for_owner_review";
    account_label: string;
    server_label: string;
    game_profile_label: string;
    checks: Array<{
      label: string;
      detail: string;
      status: "ready" | "warning";
    }>;
    approve_when: string[];
    reject_when: string[];
    missing_evidence_guidance: string;
    boundary: string;
  };
};

export type OwnerPlayerGameIdentityHistoryRow = {
  id: string;
  claim_id: string | null;
  link_id: string | null;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  user_id: string;
  account_name: string | null;
  account_avatar?: string | null;
  account_avatar_url: string | null;
  requester_discord_id: string | null;
  player_id: string;
  player_name: string | null;
  action: "claim_approved" | "claim_rejected" | "link_revoked";
  result: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string | null;
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
  server_name: string | null;
};

type CreateClaimInput = {
  linked_server_id?: unknown;
  server_id?: unknown;
  public_slug?: unknown;
  server_slug?: unknown;
  player_id?: unknown;
  player_reference?: unknown;
  player_name?: unknown;
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
  | { ok: true; status: 200; claim_id: string; link_id: string | null; action: "approved" | "rejected"; message: string; delivery: PlayerGameIdentityDecisionDelivery }
  | { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string; message: string };

const MAX_PENDING_IDENTITY_CLAIMS_PER_USER = 5;
const MAX_REVIEW_NOTE_LENGTH = 240;
const OWNER_HISTORY_PAGE_SIZE = 50;
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
  const requestSource = input.player_reference !== undefined || input.player_name !== undefined ? "gamertag_lookup" as const : "legacy_exact_id" as const;
  const playerReference = sanitizePlayerGameIdentityPlayerId(input.player_reference ?? input.player_name ?? input.player_id);
  if (!serverRef) return { ok: false as const, error: "INVALID_SERVER_ID", message: "Choose a valid DZN server." };
  if (!playerReference) return { ok: false as const, error: "INVALID_PLAYER_REFERENCE", message: "Enter the DayZ gamertag shown on this server." };
  return { ok: true as const, serverRef, playerReference, requestSource };
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
    const [linksResult, claimsResult, revokedResult] = await Promise.all([
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
      db.prepare(`SELECT l.id, l.player_name, l.revoked_at,
          COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
          (SELECT a.note FROM player_game_identity_audit_log a WHERE a.link_id = l.id
            AND a.action = 'link_revoked' AND a.result = 'accepted' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS reason
        FROM player_game_identity_links l JOIN linked_servers s ON s.id = l.linked_server_id
        WHERE l.user_id = ? AND l.discord_id = ? AND l.status = 'revoked' AND l.revoked_at IS NOT NULL
        ORDER BY l.revoked_at DESC, l.id DESC LIMIT 20`).bind(user.id, user.discord_id)
        .all<{ id: string; player_name: string | null; server_name: string | null; revoked_at: string; reason: string | null }>(),
    ]);

    return {
      ok: true as const,
      source: "player_game_identity_links" as const,
      private: true as const,
      presentation_only: true as const,
      active_links: sanitizeLinkRows(linksResult.results ?? []),
      revoked_links: revokedResult.results ?? [],
      claims: sanitizeClaimRows(claimsResult.results ?? []),
      proof_flow: {
        player_step: "Choose the server you play on and enter the exact DayZ gamertag shown there.",
        owner_step: "A matching server owner or DZN admin checks the resolved imported profile in the private review queue.",
        match_rule: "A gamertag can only locate a review candidate. Stats link only after approval of the exact server profile and hidden game ID.",
      },
      boundary:
        "Verified game links only decide which stats appear on your profile. They do not affect billing, ownership, scoring, rankings, discovery, reviews, events, XP, calling cards, Server Wars, CTF, or competitive eligibility.",
    };
  } catch {
    return {
      ok: true as const,
      source: "unavailable" as const,
      private: true as const,
      presentation_only: true as const,
      active_links: [] as PlayerGameIdentityLinkRow[],
      revoked_links: [],
      claims: [] as PlayerGameIdentityClaimRow[],
      proof_flow: {
        player_step: "Choose the server you play on and enter the exact DayZ gamertag shown there.",
        owner_step: "A matching server owner or DZN admin checks the resolved imported profile in the private review queue.",
        match_rule: "A gamertag can only locate a review candidate. Stats link only after approval of the exact server profile and hidden game ID.",
      },
      boundary:
        "Game stat linking storage is unavailable in this environment. Existing direct Discord-linked profiles remain the compatibility path.",
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
        message: "No public DZN server matched that choice. Pick another server or ask the owner for the server code.",
      };
    }

    const profileRows = await readPlayerProfileCandidates(db, server.linked_server_id, parsed.playerReference);
    if (profileRows.length > 1) {
      await writeGameIdentityAudit(env, {
        action: "claim_requested",
        result: "conflict",
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: server.linked_server_id,
        note: "Ambiguous gamertag claim rejected because more than one profile row matched inside the selected server.",
      });
      return {
        ok: false,
        status: 409,
        error: "AMBIGUOUS_PLAYER_REFERENCE",
        message: "More than one profile uses that gamertag on this server. Ask the server owner or DZN support to resolve it; DZN will not guess.",
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
        note: "No exact gamertag or game ID matched inside the selected server.",
      });
      return {
        ok: false,
        status: 404,
        error: "PLAYER_REFERENCE_NOT_FOUND",
        message: "That gamertag has not appeared in this server's imported logs yet. Check the spelling, play on the server, then try again after the next log import.",
      };
    }

    const existingDirect = await readDirectDiscordProfile(db, user.discord_id, server.linked_server_id, profile.player_id);
    if (existingDirect) {
      return {
        ok: true,
        status: 200,
        already_linked: true,
        claim: claimFromProfile(existingDirect, "approved"),
        message: "This game profile is already linked to your Discord account.",
      };
    }

    const activeLink = await readActiveGameIdentityLink(db, server.linked_server_id, profile.player_id);
    if (activeLink) {
      if (activeLink.user_id === user.id && activeLink.discord_id === user.discord_id) {
        return {
          ok: true,
          status: 200,
          already_linked: true,
          claim: claimFromActiveLink(activeLink, activeLink.linked_server_id, profile.player_id),
          message: "This game profile is already verified for your account.",
        };
      }
      await writeGameIdentityAudit(env, {
        action: "claim_requested",
        result: "conflict",
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: server.linked_server_id,
        playerProfileId: profile.id,
        playerId: profile.player_id,
        note: "Rejected because the resolved game profile already has an active verified link.",
      });
      return {
        ok: false,
        status: 409,
        error: "PLAYER_ID_ALREADY_LINKED",
        message: "That game profile is already verified for another DZN account.",
      };
    }

    const pending = await readPendingProfileClaim(db, user.id, server.linked_server_id, profile.player_id);
    if (pending) {
      const claim = await readPlayerGameIdentityClaimById(db, pending.id, user.id, user.discord_id);
      if (claim) {
        return { ok: true, status: 200, claim: sanitizeClaimRows([claim])[0], message: "This identity claim is already waiting for owner/admin approval." };
      }
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
        note: "Rejected because the game profile already has another Discord ID attached.",
      });
      return {
        ok: false,
        status: 409,
        error: "PLAYER_ID_ALREADY_LINKED",
        message: "That game ID is already linked to another Discord account.",
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
    await db.batch([
      db.prepare(
        `INSERT INTO player_game_identity_claims (
          id, user_id, discord_id, linked_server_id, player_profile_id, player_id, player_name, status, requested_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .bind(claimId, user.id, user.discord_id, profile.linked_server_id, profile.id, profile.player_id, profile.player_name),
      prepareGameIdentityAudit(db, {
        action: "claim_requested",
        result: "accepted",
        claimId,
        userId: user.id,
        actorUserId: user.id,
        linkedServerId: profile.linked_server_id,
        playerProfileId: profile.id,
        playerId: profile.player_id,
        note: `request_source=${parsed.requestSource}; Pending server-scoped reference resolved to one exact imported profile for owner/admin review.`,
      }),
    ]);

    const claim = await readPlayerGameIdentityClaimById(db, claimId, user.id, user.discord_id);
    if (!claim) throw new Error("Claim was not readable after creation.");
    return { ok: true, status: 201, claim: sanitizeClaimRows([claim])[0], message: "Link request sent. A server owner or DZN admin must approve it before stats link to your account." };
  } catch {
    return {
      ok: false,
      status: 503,
      error: "IDENTITY_LINKING_UNAVAILABLE",
      message: "Game identity linking is not available in this environment yet.",
    };
  }
}

export async function readOwnerPlayerGameIdentityClaims(
  env: Env,
  user: SessionUser,
  options: { historyCursor?: { createdAt: string; id: string } | null } = {},
) {
  try {
    const db = requireDb(env);
    const isAdmin = isDznAdminDiscordId(env, user.discord_id);
    const hasGlobalHistoryAccess = isPlatformOwnerDiscordId(env, user.discord_id);
    const historyCursor = options.historyCursor ?? null;
    const [result, historyResult] = await Promise.all([db
      .prepare(
        `SELECT
          player_game_identity_claims.id,
          player_game_identity_claims.user_id,
          player_game_identity_claims.discord_id AS requester_discord_id,
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
          claim_users.avatar AS account_avatar,
          reviewers.username AS reviewer_name,
          COALESCE((
            SELECT CASE
              WHEN request_audit.note LIKE 'request_source=gamertag_lookup;%' THEN 'gamertag_lookup'
              ELSE 'legacy_exact_id'
            END
            FROM player_game_identity_audit_log request_audit
            WHERE request_audit.claim_id = player_game_identity_claims.id
              AND request_audit.action = 'claim_requested'
              AND request_audit.result = 'accepted'
            ORDER BY datetime(request_audit.created_at) DESC, request_audit.id DESC
            LIMIT 1
          ), 'legacy_exact_id') AS request_source
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
      .all<OwnerPlayerGameIdentityClaimRow>(),
      db.prepare(
        `SELECT
          audit.id,
          audit.claim_id,
          audit.link_id,
          audit.linked_server_id,
          COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name) AS server_name,
          linked_servers.public_slug,
          audit.user_id,
          requesters.username AS account_name,
          requesters.avatar AS account_avatar,
          COALESCE(claims.discord_id, links.discord_id) AS requester_discord_id,
          COALESCE(NULLIF(audit.player_id, ''), claims.player_id, links.player_id, '') AS player_id,
          COALESCE(claims.player_name, links.player_name) AS player_name,
          audit.action,
          audit.result,
          audit.note,
          audit.actor_user_id,
          actors.username AS actor_name,
          audit.created_at
         FROM player_game_identity_audit_log audit
         INNER JOIN linked_servers ON linked_servers.id = audit.linked_server_id
         LEFT JOIN player_game_identity_claims claims ON claims.id = audit.claim_id
         LEFT JOIN player_game_identity_links links ON links.id = audit.link_id
         LEFT JOIN users requesters ON requesters.id = audit.user_id
         LEFT JOIN users actors ON actors.id = audit.actor_user_id
         WHERE audit.action IN ('claim_approved', 'claim_rejected', 'link_revoked')
           AND audit.result = 'accepted'
           AND (? = 1 OR linked_servers.user_id = ?)
           AND (
             ? IS NULL
             OR datetime(audit.created_at) < datetime(?)
             OR (datetime(audit.created_at) = datetime(?) AND audit.id < ?)
           )
         ORDER BY datetime(audit.created_at) DESC, audit.id DESC
         LIMIT ?`,
      ).bind(
        hasGlobalHistoryAccess ? 1 : 0,
        user.id,
        historyCursor?.createdAt ?? null,
        historyCursor?.createdAt ?? null,
        historyCursor?.createdAt ?? null,
        historyCursor?.id ?? null,
        OWNER_HISTORY_PAGE_SIZE + 1,
      ).all<OwnerPlayerGameIdentityHistoryRow>(),
    ]);
    const historyRows = (historyResult.results ?? []).map(({ account_avatar: avatar, ...row }) => ({
      ...row,
      account_avatar_url: discordAvatarUrl(row.requester_discord_id ?? "", avatar ?? null),
    }));
    const historyHasMore = historyRows.length > OWNER_HISTORY_PAGE_SIZE;
    const historyPage = historyRows.slice(0, OWNER_HISTORY_PAGE_SIZE);
    const lastHistoryRow = historyPage.at(-1);

    return {
      ok: true as const,
      source: "player_game_identity_claims" as const,
      private: true as const,
      owner_or_admin_only: true as const,
      claims: sanitizeOwnerClaimRows(result.results ?? []),
      history: historyPage,
      history_has_more: historyHasMore,
      history_next_cursor: historyHasMore && lastHistoryRow?.created_at
        ? JSON.stringify([lastHistoryRow.created_at, lastHistoryRow.id])
        : null,
      boundary: "Claim review can approve only an exact server plus game ID match. It is not a billing, scoring, ranking, review, event, or progression control.",
    };
  } catch {
    return {
      ok: true as const,
      source: "unavailable" as const,
      private: true as const,
      owner_or_admin_only: true as const,
      claims: [] as OwnerPlayerGameIdentityClaimRow[],
      history: [] as OwnerPlayerGameIdentityHistoryRow[],
      history_has_more: false,
      history_next_cursor: null as string | null,
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
          claims.id, claims.user_id, claims.discord_id, claims.linked_server_id, claims.player_profile_id,
          claims.player_id, claims.player_name, claims.status,
          COALESCE(NULLIF(servers.display_name, ''), NULLIF(servers.hostname, ''), servers.server_name, servers.nitrado_service_name) AS server_name
         FROM player_game_identity_claims claims
         INNER JOIN linked_servers servers ON servers.id = claims.linked_server_id
         WHERE claims.id = ?
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

    const reviewerIsAdmin = isDznAdminDiscordId(env, actor.discord_id);
    const reviewerHasGlobalAccess = reviewerIsAdmin || env.MOCK_AUTH === "1" || env.MOCK_AUTH === "true";
    const currentOwnerGuard = `EXISTS (
      SELECT 1 FROM linked_servers s WHERE s.id = player_game_identity_claims.linked_server_id
        AND (? = 1 OR s.user_id = ?)
        AND lower(COALESCE(s.status, 'pending')) NOT IN ('deleted', 'merged')
        AND (s.merged_into_server_id IS NULL OR s.merged_into_server_id = '')
    )`;
    if (parsed.action === "reject") {
      const results = await db.batch([
        db.prepare(
          `UPDATE player_game_identity_claims
           SET status = 'rejected', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending' AND ${currentOwnerGuard}`,
        ).bind(actor.id, parsed.note, claim.id, reviewerHasGlobalAccess ? 1 : 0, actor.id),
        prepareGameIdentityAudit(db, {
          action: "claim_rejected",
          result: "accepted",
          claimId: claim.id,
          userId: claim.user_id,
          actorUserId: actor.id,
          linkedServerId: claim.linked_server_id,
          playerProfileId: claim.player_profile_id,
          playerId: claim.player_id,
          note: parsed.note,
        }, { previousWrite: true }),
        preparePlayerLinkDecisionNotification(db, claim, "rejected", { previousWrite: true }),
      ]);
      if (results[0].meta.changes !== 1) return reviewChangedResult();
      return { ok: true, status: 200, claim_id: claim.id, link_id: null, action: "rejected", message: "Identity claim rejected.", delivery: decisionDelivery(claim, "rejected") };
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
        note: "Approval blocked because the exact game profile row no longer exists.",
      });
      return { ok: false, status: 409, error: "PLAYER_PROFILE_NOT_FOUND", message: "The exact game profile row no longer exists." };
    }

    const activeLink = await readActiveGameIdentityLink(db, claim.linked_server_id, claim.player_id);
    if ((activeLink && (activeLink.user_id !== claim.user_id || activeLink.discord_id !== claim.discord_id))
      || (exactProfile.discord_id && exactProfile.discord_id.trim() && exactProfile.discord_id !== claim.discord_id)) {
      await writeGameIdentityAudit(env, {
        action: "claim_approved",
        result: "conflict",
        claimId: claim.id,
        userId: claim.user_id,
        actorUserId: actor.id,
        linkedServerId: claim.linked_server_id,
        playerProfileId: claim.player_profile_id,
        playerId: claim.player_id,
        note: "Approval blocked because the game ID is already actively linked to another account.",
      });
      return { ok: false, status: 409, error: "PLAYER_ID_ALREADY_LINKED", message: "That game ID is already actively linked." };
    }

    const linkId = crypto.randomUUID();
    const decisionId = crypto.randomUUID();
    const verifiedSource = reviewerIsAdmin ? "dzn_admin_approved" : "owner_approved";
    // The conditional transition and its unique audit event fence every later write in this transaction.
    const decisionGate = `EXISTS (SELECT 1 FROM player_game_identity_audit_log WHERE id = ?)`;
    const results = await db.batch([
      db.prepare(
        `UPDATE player_game_identity_claims
         SET status = 'approved', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending' AND ${currentOwnerGuard}
           AND EXISTS (
             SELECT 1 FROM player_profiles p
             WHERE p.id = player_game_identity_claims.player_profile_id
               AND p.linked_server_id = player_game_identity_claims.linked_server_id
               AND p.player_id = player_game_identity_claims.player_id
               AND (p.discord_id IS NULL OR trim(p.discord_id) = '' OR p.discord_id = player_game_identity_claims.discord_id)
           )
           AND NOT EXISTS (
             SELECT 1 FROM player_game_identity_links l
             WHERE l.linked_server_id = player_game_identity_claims.linked_server_id
               AND l.player_id = player_game_identity_claims.player_id
               AND l.status = 'active' AND l.revoked_at IS NULL
               AND (l.user_id != player_game_identity_claims.user_id OR l.discord_id != player_game_identity_claims.discord_id
                 OR l.player_profile_id != player_game_identity_claims.player_profile_id)
           )`,
      ).bind(actor.id, parsed.note, claim.id, reviewerHasGlobalAccess ? 1 : 0, actor.id),
      prepareGameIdentityAudit(db, {
        action: "claim_approved", result: "accepted", claimId: claim.id, userId: claim.user_id,
        actorUserId: actor.id, linkedServerId: claim.linked_server_id,
        playerProfileId: claim.player_profile_id, playerId: claim.player_id, note: parsed.note,
      }, { previousWrite: true, id: decisionId }),
      db.prepare(
          `INSERT INTO player_game_identity_links (
            id, user_id, discord_id, linked_server_id, player_profile_id, player_id, player_name, status, verified_source, verified_by_user_id, verified_at, created_at, updated_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          WHERE ${decisionGate} AND NOT EXISTS (
            SELECT 1 FROM player_game_identity_links WHERE linked_server_id = ? AND player_id = ?
              AND status = 'active' AND revoked_at IS NULL
          )`,
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
          decisionId, claim.linked_server_id, claim.player_id,
        ),
      db.prepare(
        `INSERT INTO player_game_identity_audit_log (
          id, claim_id, link_id, user_id, actor_user_id, linked_server_id, player_profile_id, player_id, action, result, note, created_at
        ) SELECT ?, ?, l.id, l.user_id, ?, l.linked_server_id, l.player_profile_id, l.player_id,
          'link_created', CASE WHEN l.id = ? THEN 'accepted' ELSE 'already_linked' END, ?, CURRENT_TIMESTAMP
          FROM player_game_identity_links l
          WHERE l.linked_server_id = ? AND l.player_id = ? AND l.status = 'active' AND l.revoked_at IS NULL
            AND ${decisionGate}`,
      ).bind(crypto.randomUUID(), claim.id, actor.id, linkId, parsed.note, claim.linked_server_id, claim.player_id, decisionId),
      preparePlayerLinkDecisionNotification(db, claim, "approved", { decisionId }),
      db.prepare(
        `SELECT id FROM player_game_identity_links
         WHERE linked_server_id = ? AND player_id = ? AND status = 'active' AND revoked_at IS NULL AND ${decisionGate}`,
      ).bind(claim.linked_server_id, claim.player_id, decisionId),
    ]);
    if (results[0].meta.changes !== 1) return reviewChangedResult();
    const linkedId = (results[results.length - 1]?.results?.[0] as { id?: string } | undefined)?.id;
    if (!linkedId) throw new Error("Committed link result unavailable");
    return { ok: true, status: 200, claim_id: claim.id, link_id: linkedId, action: "approved", message: "Link request approved and connected by exact game ID.", delivery: decisionDelivery(claim, "approved") };
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

async function readPlayerProfileCandidates(db: D1Database, linkedServerId: string, playerReference: string) {
  const exactIdResult = await db
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
    .bind(linkedServerId, playerReference)
    .all<PlayerProfileCandidateRow>();
  const exactIdRows = exactIdResult.results ?? [];
  if (exactIdRows.length > 0) return exactIdRows;

  const gamertagResult = await db
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
         AND lower(trim(player_profiles.player_name)) = lower(trim(?))
         AND player_profiles.player_name IS NOT NULL
         AND trim(player_profiles.player_name) != ''
         AND player_profiles.player_id IS NOT NULL
         AND trim(player_profiles.player_id) != ''
         AND ${publicServerWhere}
       ORDER BY datetime(COALESCE(player_profiles.last_seen_at, player_profiles.updated_at, player_profiles.created_at)) DESC
       LIMIT 2`,
    )
    .bind(linkedServerId, playerReference)
    .all<PlayerProfileCandidateRow>();
  return gamertagResult.results ?? [];
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

type GameIdentityAuditInput = {
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
};

function prepareGameIdentityAudit(db: D1Database, input: GameIdentityAuditInput, options: { previousWrite?: boolean; id?: string } = {}) {
  return db.prepare(
      `INSERT INTO player_game_identity_audit_log (
        id, claim_id, link_id, user_id, actor_user_id, linked_server_id, player_profile_id, player_id, action, result, note, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP ${options.previousWrite ? "WHERE changes() = 1" : ""}`,
    )
    .bind(
      options.id ?? crypto.randomUUID(),
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
    );
}

function preparePlayerLinkDecisionNotification(
  db: D1Database,
  claim: ReviewableClaimRow,
  action: "approved" | "rejected",
  options: { previousWrite?: boolean; decisionId?: string },
) {
  const approved = action === "approved";
  const condition = options.previousWrite
    ? "changes() = 1"
    : "EXISTS (SELECT 1 FROM player_game_identity_audit_log WHERE id = ?)";
  const bindings: unknown[] = [
    crypto.randomUUID(),
    claim.user_id,
    null,
    approved ? "player_link_approved" : "player_link_rejected",
    approved ? "Game stats link approved" : "Game stats link not approved",
    approved
      ? `Your ${claim.player_name || "game profile"} stats link for ${claim.server_name || "this DZN server"} is now active.`
      : `Your ${claim.player_name || "game profile"} link request for ${claim.server_name || "this DZN server"} was not approved.`,
    "/player/profile#game-account",
    approved ? 700 : 650,
    `player-link-decision:${claim.id}:${action}`,
    JSON.stringify({ claim_id: claim.id, decision: action }),
  ];
  if (options.decisionId) bindings.push(options.decisionId);
  return db.prepare(
    `INSERT OR IGNORE INTO user_notifications (
      id, user_id, server_id, type, title, body, action_url, priority, dedupe_key, metadata, created_at, expires_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+90 days')
      WHERE ${condition}`,
  ).bind(...bindings);
}

function decisionDelivery(claim: ReviewableClaimRow, action: "approved" | "rejected"): PlayerGameIdentityDecisionDelivery {
  return {
    claimId: claim.id,
    userId: claim.user_id,
    discordId: claim.discord_id,
    action,
    serverName: claim.server_name || "DZN Server",
    playerName: claim.player_name || "game profile",
  };
}

async function writeGameIdentityAudit(env: Env, input: GameIdentityAuditInput) {
  await prepareGameIdentityAudit(requireDb(env), input).run();
}

function reviewChangedResult(): ReviewPlayerGameIdentityClaimResult {
  return { ok: false, status: 409, error: "CLAIM_CHANGED", message: "This request, account or server access changed. Refresh before reviewing it again." };
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
    account_avatar_url: discordAvatarUrl(row.requester_discord_id, row.account_avatar),
    request_source: row.request_source,
    submitted_player_id: row.player_id,
    review_context: {
      evidence_status: "ready_for_owner_review" as const,
      account_label: row.account_name || "DZN Player",
      server_label: row.server_name || "DZN Server",
      game_profile_label: row.player_name || "Imported ADM profile",
      checks: [
        {
          label: "Owner scoped",
          detail: "This queue only returns pending claims for servers owned by the current user, or for DZN admins.",
          status: "ready" as const,
        },
        {
          label: "Exact server match",
          detail: "The request was matched to one public DZN server before it entered review.",
          status: "ready" as const,
        },
        row.request_source === "gamertag_lookup"
          ? {
              label: "Gamertag candidate only",
              detail: "The player entered a public gamertag. DZN resolved one imported profile inside this server, but that name is not ownership proof.",
              status: "warning" as const,
            }
          : {
              label: "Legacy exact-ID request",
              detail: "The player supplied the exact imported game ID through the legacy request path. The owner must still verify ownership independently.",
              status: "warning" as const,
            },
        {
          label: "Name is context only",
          detail: "Display names, Discord names, leaderboard names, and public profile handles are never proof.",
          status: "warning" as const,
        },
      ],
      approve_when: [
        "The owner or DZN admin has independently confirmed the resolved exact game profile belongs to this account.",
        "The server and imported game profile shown here match evidence that is stronger than the public gamertag alone.",
      ],
      reject_when: [
        "The player entered the wrong gamertag, supplied the wrong legacy ID, or selected the wrong server.",
        "The owner or DZN admin cannot confirm the evidence from this claim.",
      ],
      missing_evidence_guidance: "Do not approve from the gamertag or leaderboard position alone. Confirm ownership through the server owner's independent evidence, or reject the request.",
      boundary:
        "This review can only connect existing stats display to the right account. It does not change billing, ownership, scoring, rankings, discovery, reviews, progression, events, or competitive eligibility.",
    },
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

function discordAvatarUrl(discordId: string, avatarHash: string | null) {
  if (!/^\d{5,32}$/.test(discordId) || !avatarHash || !/^[A-Za-z0-9_]{2,128}$/.test(avatarHash)) return null;
  return `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordId)}/${encodeURIComponent(avatarHash)}.webp?size=128`;
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
