import { isDznAdminDiscordId } from "./admin";
import { requireDb } from "./db";
import { json } from "./http";
import {
  getRequestSessionUser,
  ownerAccessErrorResponse,
  requireActiveOwnerEntitlement,
  returnToFromRequest,
} from "./owner-access";
import {
  normalizePublicProfileHandle,
  playerProfilePrivacyFairness,
  publicPlayerProfileApiHref,
  publicPlayerProfileHref,
} from "./player-profile-privacy";
import type { Env, SessionUser } from "./types";

export type CommunityMemberSourceRole = "owner" | "admin";
export type CommunityMemberCandidateStatus = "pending" | "imported" | "rejected" | "duplicate" | "ambiguous";
export type CommunityMemberMatchStatus = "pending" | "matched" | "no_match" | "duplicate" | "ambiguous";
export type CommunityMemberSourceAuditAction =
  | "candidate_created"
  | "candidate_rejected"
  | "candidate_imported"
  | "candidate_no_match"
  | "duplicate_rejected"
  | "ambiguous_rejected";
export type CommunityMemberSourceAuditResult = "accepted" | "rejected" | "skipped" | "failed";
export type CommunityMemberSourceManagementFilter = CommunityMemberCandidateStatus | "all";
export type CommunityMemberCandidateAction = "import" | "reject";

export type CommunityMemberSourceActor = {
  user: SessionUser;
  role: CommunityMemberSourceRole;
};

export type CommunityMemberCandidateInput = {
  linked_server_id?: unknown;
  dzn_user_id?: unknown;
  candidate_discord_id?: unknown;
  candidate_username?: unknown;
  candidate_display_name?: unknown;
  role_label?: unknown;
  source?: unknown;
  reason?: unknown;
};

export type CommunityMemberCandidateActionInput = {
  action?: unknown;
  reason?: unknown;
  role_label?: unknown;
  public_member_enabled?: unknown;
};

export type CommunityMemberSourceServerOption = {
  id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
};

export type CommunityMemberCandidateItem = {
  id: string;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
  candidate_discord_id_masked: string | null;
  candidate_username: string | null;
  candidate_display_name: string | null;
  role_label: string | null;
  source: string;
  status: CommunityMemberCandidateStatus;
  match_status: CommunityMemberMatchStatus;
  matched_user_id: string | null;
  matched_username: string | null;
  imported_member_id: string | null;
  existing_member_id: string | null;
  reason: string | null;
  created_by_user_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  public_profile_linkable: boolean;
  public_profile: {
    public_handle: string;
    public_href: string;
    public_api_href: string;
  } | null;
};

export type CommunityMemberSourceAuditItem = {
  id: string;
  candidate_id: string | null;
  community_member_id: string | null;
  linked_server_id: string;
  server_name: string;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string;
  actor_user_id: string;
  actor_role: CommunityMemberSourceRole;
  action: CommunityMemberSourceAuditAction;
  result_status: CommunityMemberSourceAuditResult;
  reason: string | null;
  created_at: string | null;
};

type CommunityMemberSourceServerRow = {
  id: string;
  user_id: string | null;
  public_slug: string | null;
  server_name: string | null;
  community_guild_id: string | null;
  community_name: string | null;
};

type CommunityMemberCandidateRow = {
  id: string;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string | null;
  candidate_discord_id: string | null;
  candidate_username: string | null;
  candidate_display_name: string | null;
  role_label: string | null;
  source: string | null;
  status: string | null;
  match_status: string | null;
  matched_user_id: string | null;
  matched_username: string | null;
  imported_member_id: string | null;
  existing_member_id: string | null;
  reason: string | null;
  created_by_user_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  public_profile_enabled: number | null;
  public_handle: string | null;
};

type CommunityMemberSourceAuditRow = {
  id: string;
  candidate_id: string | null;
  community_member_id: string | null;
  linked_server_id: string;
  server_name: string | null;
  public_slug: string | null;
  community_guild_id: string;
  community_name: string | null;
  actor_user_id: string;
  actor_role: string | null;
  action: string | null;
  result_status: string | null;
  reason: string | null;
  created_at: string | null;
};

type UserBridgeRow = {
  id: string;
  discord_id: string | null;
  username: string | null;
};

type BridgeResolution =
  | { status: "matched"; user: UserBridgeRow }
  | { status: "no_match"; user: null }
  | { status: "ambiguous"; user: null };

const CANDIDATE_STATUSES = new Set<CommunityMemberCandidateStatus>([
  "pending",
  "imported",
  "rejected",
  "duplicate",
  "ambiguous",
]);
const CANDIDATE_STATUS_FILTERS = new Set<CommunityMemberSourceManagementFilter>([
  "pending",
  "imported",
  "rejected",
  "duplicate",
  "ambiguous",
  "all",
]);
const MATCH_STATUSES = new Set<CommunityMemberMatchStatus>(["pending", "matched", "no_match", "duplicate", "ambiguous"]);
const AUDIT_ACTIONS = new Set<CommunityMemberSourceAuditAction>([
  "candidate_created",
  "candidate_rejected",
  "candidate_imported",
  "candidate_no_match",
  "duplicate_rejected",
  "ambiguous_rejected",
]);
const AUDIT_RESULTS = new Set<CommunityMemberSourceAuditResult>(["accepted", "rejected", "skipped", "failed"]);
const CANDIDATE_SOURCES = new Set(["owner_import", "admin_import", "discord_guild_snapshot", "manual_review"]);
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 160;

export async function authorizeCommunityMemberSourceRequest(env: Env, request: Request): Promise<
  | { ok: true; actor: CommunityMemberSourceActor }
  | { ok: false; response: Response }
> {
  let user: SessionUser | null = null;
  try {
    user = await getRequestSessionUser(env, request);
  } catch {
    user = null;
  }

  if (!user) {
    return {
      ok: false,
      response: json({ ok: false, error: "NOT_AUTHENTICATED", message: "Log in with Discord to manage trusted community member sources." }, { status: 401 }),
    };
  }

  if (isDznAdminDiscordId(env, user.discord_id)) {
    return { ok: true, actor: { user, role: "admin" } };
  }

  const ownerAccess = await requireActiveOwnerEntitlement(env, user, returnToFromRequest(request));
  if (!ownerAccess.allowed) {
    return { ok: false, response: ownerAccessErrorResponse(ownerAccess) };
  }

  return { ok: true, actor: { user, role: "owner" } };
}

export async function listCommunityMemberSourceManagement(
  env: Env,
  actor: CommunityMemberSourceActor,
  options: { status?: string | null; linkedServerId?: string | null; limit?: number | null } = {},
) {
  const db = requireDb(env);
  const filter = normalizeCandidateStatusFilter(options.status);
  const linkedServerId = cleanIdentifier(options.linkedServerId, 96);
  const limit = clampLimit(options.limit);
  const [servers, candidates, audit, counts] = await Promise.all([
    readCommunityMemberSourceServerOptions(db, actor),
    readCommunityMemberCandidates(db, actor, { status: filter, linkedServerId, limit }),
    readCommunityMemberSourceAudit(db, actor, { linkedServerId, limit }),
    readCommunityMemberSourceCounts(db, actor, linkedServerId),
  ]);

  return {
    ok: true,
    role: actor.role,
    filters: {
      status: filter,
      linked_server_id: linkedServerId,
    },
    counts,
    servers,
    candidates,
    audit,
    safeguards: communityMemberSourceManagementSafeguards(),
    generated_at: new Date().toISOString(),
  };
}

export async function createCommunityMemberCandidate(
  env: Env,
  actor: CommunityMemberSourceActor,
  input: CommunityMemberCandidateInput,
) {
  const db = requireDb(env);
  const linkedServerId = cleanIdentifier(input.linked_server_id, 96);
  if (!linkedServerId) {
    return errorResult(400, "LINKED_SERVER_REQUIRED", "Choose a linked server before importing community members.");
  }

  const server = await readScopedCommunityServer(db, actor, linkedServerId);
  if (!server) {
    return errorResult(404, "LINKED_SERVER_NOT_FOUND", "That linked server is not available to this owner/admin.");
  }
  if (!server.community_guild_id) {
    return errorResult(422, "COMMUNITY_BRIDGE_REQUIRED", "This linked server does not have a trusted Discord community bridge yet.");
  }

  const candidateDiscordId = cleanDiscordId(input.candidate_discord_id);
  if (input.candidate_discord_id !== undefined && String(input.candidate_discord_id ?? "").trim() && !candidateDiscordId) {
    return errorResult(400, "INVALID_DISCORD_ID", "Discord IDs must be numeric.");
  }
  const dznUserId = cleanIdentifier(input.dzn_user_id, 96);
  if (!candidateDiscordId && !dznUserId) {
    return errorResult(400, "TRUSTED_USER_BRIDGE_REQUIRED", "Provide a Discord ID or DZN user ID so DZN can resolve exactly one user.");
  }

  const roleLabel = cleanRoleLabel(input.role_label);
  const source = cleanCandidateSource(input.source, actor.role);
  const reason = cleanReason(input.reason);
  const bridge = await resolveTrustedUserBridge(db, { discordId: candidateDiscordId, userId: dznUserId });
  let matchStatus: CommunityMemberMatchStatus = bridge.status === "matched" ? "matched" : bridge.status;
  let status: CommunityMemberCandidateStatus = bridge.status === "ambiguous" ? "ambiguous" : "pending";
  let existingMemberId: string | null = null;

  if (bridge.status === "matched") {
    existingMemberId = await readExistingCommunityMemberId(db, server.community_guild_id, bridge.user.id);
    if (existingMemberId) {
      status = "duplicate";
      matchStatus = "duplicate";
    }
  }

  const candidateId = createId("cmcand");
  await db
    .prepare(
      `INSERT INTO community_member_candidates (
         id,
         linked_server_id,
         community_guild_id,
         candidate_discord_id,
         candidate_username,
         candidate_display_name,
         role_label,
         source,
         status,
         match_status,
         matched_user_id,
         imported_member_id,
         reason,
         created_by_user_id,
         reviewed_by_user_id,
         reviewed_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      candidateId,
      server.id,
      server.community_guild_id,
      candidateDiscordId,
      cleanDisplayText(input.candidate_username, 64),
      cleanDisplayText(input.candidate_display_name, 96),
      roleLabel,
      source,
      status,
      matchStatus,
      bridge.status === "matched" ? bridge.user.id : null,
      existingMemberId,
      reason,
      actor.user.id,
      status === "duplicate" || status === "ambiguous" ? actor.user.id : null,
      status === "duplicate" || status === "ambiguous" ? new Date().toISOString() : null,
    )
    .run();

  await writeCommunityMemberSourceAudit(db, actor, {
    candidateId,
    communityMemberId: null,
    linkedServerId: server.id,
    communityGuildId: server.community_guild_id,
    action: "candidate_created",
    resultStatus: "accepted",
    reason: reason ?? sourceManagementReason(status, matchStatus),
  });
  if (status === "duplicate") {
    await writeCommunityMemberSourceAudit(db, actor, {
      candidateId,
      communityMemberId: existingMemberId,
      linkedServerId: server.id,
      communityGuildId: server.community_guild_id,
      action: "duplicate_rejected",
      resultStatus: "skipped",
      reason: "A community member bridge already exists for this Discord/DZN user.",
    });
  } else if (status === "ambiguous") {
    await writeCommunityMemberSourceAudit(db, actor, {
      candidateId,
      communityMemberId: null,
      linkedServerId: server.id,
      communityGuildId: server.community_guild_id,
      action: "ambiguous_rejected",
      resultStatus: "rejected",
      reason: "The supplied source resolved to more than one DZN user.",
    });
  }

  const candidate = await readCommunityMemberCandidateById(db, actor, candidateId);
  return {
    ok: true as const,
    status: 201 as const,
    message: sourceManagementResultMessage(status, matchStatus),
    candidate,
    safeguards: communityMemberSourceManagementSafeguards(),
  };
}

export async function actOnCommunityMemberCandidate(
  env: Env,
  actor: CommunityMemberSourceActor,
  candidateIdValue: unknown,
  input: CommunityMemberCandidateActionInput,
) {
  const db = requireDb(env);
  const candidateId = cleanIdentifier(candidateIdValue, 96);
  if (!candidateId) {
    return errorResult(400, "CANDIDATE_REQUIRED", "Choose a community member candidate first.");
  }

  const action = cleanCandidateAction(input.action);
  if (!action) {
    return errorResult(400, "INVALID_ACTION", "Choose import or reject for this community member candidate.");
  }

  const candidate = await readCommunityMemberCandidateById(db, actor, candidateId);
  if (!candidate) {
    return errorResult(404, "CANDIDATE_NOT_FOUND", "That community member candidate was not found in this owner/admin scope.");
  }

  const reason = cleanReason(input.reason);
  if (action === "reject") {
    await db
      .prepare(
        `UPDATE community_member_candidates
         SET status = 'rejected',
             reviewed_by_user_id = ?,
             reviewed_at = CURRENT_TIMESTAMP,
             reason = COALESCE(?, reason),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(actor.user.id, reason, candidate.id)
      .run();
    await writeCommunityMemberSourceAudit(db, actor, {
      candidateId: candidate.id,
      communityMemberId: candidate.imported_member_id,
      linkedServerId: candidate.linked_server_id,
      communityGuildId: candidate.community_guild_id,
      action: "candidate_rejected",
      resultStatus: "rejected",
      reason: reason ?? "Rejected by owner/admin review.",
    });
    return {
      ok: true as const,
      status: 200 as const,
      message: "Community member candidate rejected.",
      candidate: await readCommunityMemberCandidateById(db, actor, candidate.id),
      safeguards: communityMemberSourceManagementSafeguards(),
    };
  }

  if (candidate.status === "imported" && candidate.imported_member_id) {
    return errorResult(409, "CANDIDATE_ALREADY_IMPORTED", "This candidate has already been imported into the community member bridge.");
  }
  if (candidate.status === "rejected") {
    return errorResult(409, "CANDIDATE_REJECTED", "Rejected candidates must be reviewed as a new candidate before import.");
  }

  const candidateDiscordId = candidate.candidate_discord_id_masked ? await readPrivateCandidateDiscordId(db, candidate.id) : null;
  const bridge = candidate.matched_user_id
    ? await resolveTrustedUserBridge(db, { userId: candidate.matched_user_id, discordId: candidateDiscordId })
    : await resolveTrustedUserBridge(db, { userId: null, discordId: candidateDiscordId });

  if (bridge.status === "ambiguous") {
    await markCandidateRejectedByImport(db, actor, candidate.id, "ambiguous", "ambiguous", "The supplied source resolved to more than one DZN user.");
    await writeCommunityMemberSourceAudit(db, actor, {
      candidateId: candidate.id,
      communityMemberId: null,
      linkedServerId: candidate.linked_server_id,
      communityGuildId: candidate.community_guild_id,
      action: "ambiguous_rejected",
      resultStatus: "rejected",
      reason: "The supplied source resolved to more than one DZN user.",
    });
    return errorResult(409, "AMBIGUOUS_USER_BRIDGE", "DZN rejected this import because the source resolves to more than one user.");
  }

  if (bridge.status === "no_match") {
    await updateCandidateMatchStatus(db, candidate.id, "pending", "no_match", actor.user.id, reason);
    await writeCommunityMemberSourceAudit(db, actor, {
      candidateId: candidate.id,
      communityMemberId: null,
      linkedServerId: candidate.linked_server_id,
      communityGuildId: candidate.community_guild_id,
      action: "candidate_no_match",
      resultStatus: "skipped",
      reason: reason ?? "No unique trusted DZN user bridge exists yet.",
    });
    return errorResult(422, "NO_TRUSTED_USER_BRIDGE", "DZN can import only after the candidate resolves to one existing DZN user.");
  }

  const duplicateMemberId = await readExistingCommunityMemberId(db, candidate.community_guild_id, bridge.user.id);
  if (duplicateMemberId) {
    await db
      .prepare(
        `UPDATE community_member_candidates
         SET status = 'duplicate',
             match_status = 'duplicate',
             matched_user_id = ?,
             imported_member_id = ?,
             reviewed_by_user_id = ?,
             reviewed_at = CURRENT_TIMESTAMP,
             reason = COALESCE(?, reason),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(bridge.user.id, duplicateMemberId, actor.user.id, reason, candidate.id)
      .run();
    await writeCommunityMemberSourceAudit(db, actor, {
      candidateId: candidate.id,
      communityMemberId: duplicateMemberId,
      linkedServerId: candidate.linked_server_id,
      communityGuildId: candidate.community_guild_id,
      action: "duplicate_rejected",
      resultStatus: "skipped",
      reason: reason ?? "A community member bridge already exists for this Discord/DZN user.",
    });
    return errorResult(409, "DUPLICATE_COMMUNITY_MEMBER", "DZN rejected this import because the community member bridge already exists.");
  }

  const memberId = createId("cmem");
  const roleLabel = cleanRoleLabel(input.role_label) ?? candidate.role_label;
  const publicMemberEnabled = input.public_member_enabled === false ? 0 : 1;
  await db
    .prepare(
      `INSERT INTO community_members (
         id,
         community_guild_id,
         user_id,
         role_label,
         display_order,
         public_member_enabled,
         source,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, 'trusted_dzn_bridge', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(memberId, candidate.community_guild_id, bridge.user.id, roleLabel, publicMemberEnabled)
    .run();
  await db
    .prepare(
      `UPDATE community_member_candidates
       SET status = 'imported',
           match_status = 'matched',
           matched_user_id = ?,
           imported_member_id = ?,
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           role_label = COALESCE(?, role_label),
           reason = COALESCE(?, reason),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(bridge.user.id, memberId, actor.user.id, roleLabel, reason, candidate.id)
    .run();
  await writeCommunityMemberSourceAudit(db, actor, {
    candidateId: candidate.id,
    communityMemberId: memberId,
    linkedServerId: candidate.linked_server_id,
    communityGuildId: candidate.community_guild_id,
    action: "candidate_imported",
    resultStatus: "accepted",
    reason: reason ?? "Imported after unique trusted DZN user bridge verification.",
  });

  return {
    ok: true as const,
    status: 200 as const,
    message: "Community member imported into the trusted presentation bridge.",
    candidate: await readCommunityMemberCandidateById(db, actor, candidate.id),
    member: {
      id: memberId,
      community_guild_id: candidate.community_guild_id,
      user_id: bridge.user.id,
      public_member_enabled: Boolean(publicMemberEnabled),
      source: "trusted_dzn_bridge" as const,
    },
    safeguards: communityMemberSourceManagementSafeguards(),
  };
}

export function communityMemberSourceManagementSafeguards() {
  return {
    placement: "community_member_source_management" as const,
    access: "owner_admin_only" as const,
    writes: ["community_member_candidates", "community_member_source_audit", "community_members"] as const,
    public_visibility_controlled_by_player: true,
    public_profile_link_requires_player_opt_in_handle: true,
    trusted_dzn_user_bridge_required: true,
    rejects_duplicate_members: true,
    rejects_ambiguous_user_bridge: true,
    exposes_private_identifiers_publicly: false,
    mutates_live_checkout: false,
    mutates_stripe_products_or_prices: false,
    mutates_cloudflare_secrets: false,
    mutates_production_d1: false,
    mutates_nitrado: false,
    mutates_discord: false,
    merges_issue_49: false,
    affects_public_profile_visibility_without_player_opt_in_handle: false,
    affects_ctf_scoring_rows: false,
    affects_owner_workflow_decisions: false,
    affects_approval_decisions: false,
    affects_bracket_outcomes: false,
    affects_billing: false,
    affects_rankings: false,
    affects_discovery_score: false,
    affects_reviews: false,
    affects_badges: false,
    affects_seasons: false,
    affects_server_wars_scoring: false,
    affects_xp_awards: false,
    affects_calling_card_awards: false,
    affects_competitive_eligibility: false,
    fairness: playerProfilePrivacyFairness(),
  };
}

export function isCommunityMemberSourceSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table:\s*(community_member_candidates|community_member_source_audit|community_members|player_profile_privacy_preferences)|community_member_candidates.*does not exist|community_member_source_audit.*does not exist|no such column:\s*(community_member_candidates|community_member_source_audit|player_profile_privacy_preferences)/i.test(message);
}

export function communityMemberSourceSchemaErrorResponse() {
  return json(
    {
      ok: false,
      error: "COMMUNITY_MEMBER_SOURCE_MANAGEMENT_NOT_CONFIGURED",
      message: "Community member source management tables are not configured in this environment yet.",
      safeguards: communityMemberSourceManagementSafeguards(),
    },
    { status: 503 },
  );
}

async function readCommunityMemberSourceServerOptions(db: D1Database, actor: CommunityMemberSourceActor) {
  const bindings: unknown[] = [];
  const conditions = scopedLinkedServerConditions(actor, bindings);
  conditions.push("discord_guilds.id IS NOT NULL");
  const rows = await db
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              discord_guilds.id AS community_guild_id,
              discord_guilds.name AS community_name
       FROM linked_servers
       INNER JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY server_name ASC, linked_servers.created_at DESC
       LIMIT 120`,
    )
    .bind(...bindings)
    .all<CommunityMemberSourceServerRow>();

  return (rows.results ?? [])
    .filter((row) => row.community_guild_id)
    .map((row): CommunityMemberSourceServerOption => ({
      id: row.id,
      server_name: cleanDisplayText(row.server_name, 96) ?? "DZN Server",
      public_slug: cleanDisplayText(row.public_slug, 96),
      community_guild_id: String(row.community_guild_id ?? ""),
      community_name: cleanDisplayText(row.community_name, 96) ?? cleanDisplayText(row.server_name, 96) ?? "DZN Community",
    }));
}

async function readCommunityMemberCandidates(
  db: D1Database,
  actor: CommunityMemberSourceActor,
  options: { status: CommunityMemberSourceManagementFilter; linkedServerId: string | null; limit: number },
) {
  const bindings: unknown[] = [];
  const conditions = scopedCandidateConditions(actor, bindings);
  if (options.status !== "all") {
    conditions.push("community_member_candidates.status = ?");
    bindings.push(options.status);
  }
  if (options.linkedServerId) {
    conditions.push("community_member_candidates.linked_server_id = ?");
    bindings.push(options.linkedServerId);
  }
  bindings.push(options.limit);

  const rows = await db
    .prepare(
      `SELECT community_member_candidates.id,
              community_member_candidates.linked_server_id,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              community_member_candidates.community_guild_id,
              discord_guilds.name AS community_name,
              community_member_candidates.candidate_discord_id,
              community_member_candidates.candidate_username,
              community_member_candidates.candidate_display_name,
              community_member_candidates.role_label,
              community_member_candidates.source,
              community_member_candidates.status,
              community_member_candidates.match_status,
              community_member_candidates.matched_user_id,
              matched_users.username AS matched_username,
              community_member_candidates.imported_member_id,
              existing_members.id AS existing_member_id,
              community_member_candidates.reason,
              community_member_candidates.created_by_user_id,
              community_member_candidates.reviewed_by_user_id,
              community_member_candidates.reviewed_at,
              community_member_candidates.created_at,
              community_member_candidates.updated_at,
              profile_privacy.public_profile_enabled,
              profile_privacy.public_handle
       FROM community_member_candidates
       INNER JOIN linked_servers ON linked_servers.id = community_member_candidates.linked_server_id
       INNER JOIN discord_guilds ON discord_guilds.id = community_member_candidates.community_guild_id
       LEFT JOIN users matched_users ON matched_users.id = community_member_candidates.matched_user_id
       LEFT JOIN player_profile_privacy_preferences profile_privacy ON profile_privacy.user_id = matched_users.id
       LEFT JOIN community_members existing_members
              ON existing_members.community_guild_id = community_member_candidates.community_guild_id
             AND existing_members.user_id = community_member_candidates.matched_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         CASE community_member_candidates.status
           WHEN 'pending' THEN 0
           WHEN 'ambiguous' THEN 1
           WHEN 'duplicate' THEN 2
           WHEN 'rejected' THEN 3
           ELSE 4
         END ASC,
         datetime(COALESCE(community_member_candidates.updated_at, community_member_candidates.created_at)) DESC,
         community_member_candidates.id DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<CommunityMemberCandidateRow>();

  return (rows.results ?? []).map(toCandidateItem);
}

async function readCommunityMemberSourceAudit(
  db: D1Database,
  actor: CommunityMemberSourceActor,
  options: { linkedServerId: string | null; limit: number },
) {
  const bindings: unknown[] = [];
  const conditions = scopedAuditConditions(actor, bindings);
  if (options.linkedServerId) {
    conditions.push("community_member_source_audit.linked_server_id = ?");
    bindings.push(options.linkedServerId);
  }
  bindings.push(options.limit);

  const rows = await db
    .prepare(
      `SELECT community_member_source_audit.id,
              community_member_source_audit.candidate_id,
              community_member_source_audit.community_member_id,
              community_member_source_audit.linked_server_id,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              community_member_source_audit.community_guild_id,
              discord_guilds.name AS community_name,
              community_member_source_audit.actor_user_id,
              community_member_source_audit.actor_role,
              community_member_source_audit.action,
              community_member_source_audit.result_status,
              community_member_source_audit.reason,
              community_member_source_audit.created_at
       FROM community_member_source_audit
       INNER JOIN linked_servers ON linked_servers.id = community_member_source_audit.linked_server_id
       INNER JOIN discord_guilds ON discord_guilds.id = community_member_source_audit.community_guild_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY datetime(community_member_source_audit.created_at) DESC,
                community_member_source_audit.id DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<CommunityMemberSourceAuditRow>();
  return (rows.results ?? []).map(toAuditItem);
}

async function readCommunityMemberSourceCounts(db: D1Database, actor: CommunityMemberSourceActor, linkedServerId: string | null) {
  const bindings: unknown[] = [];
  const conditions = scopedCandidateConditions(actor, bindings);
  if (linkedServerId) {
    conditions.push("community_member_candidates.linked_server_id = ?");
    bindings.push(linkedServerId);
  }
  const rows = await db
    .prepare(
      `SELECT community_member_candidates.status, COUNT(*) AS count
       FROM community_member_candidates
       INNER JOIN linked_servers ON linked_servers.id = community_member_candidates.linked_server_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY community_member_candidates.status`,
    )
    .bind(...bindings)
    .all<{ status: string | null; count: number | null }>();

  const counts = {
    total: 0,
    pending: 0,
    imported: 0,
    rejected: 0,
    duplicate: 0,
    ambiguous: 0,
  };
  for (const row of rows.results ?? []) {
    const status = normalizeCandidateStatus(row.status);
    const count = Number(row.count ?? 0);
    counts[status] += count;
    counts.total += count;
  }
  return counts;
}

async function readScopedCommunityServer(db: D1Database, actor: CommunityMemberSourceActor, linkedServerId: string) {
  const bindings: unknown[] = [];
  const conditions = scopedLinkedServerConditions(actor, bindings);
  conditions.push("linked_servers.id = ?");
  bindings.push(linkedServerId);
  return db
    .prepare(
      `SELECT linked_servers.id,
              linked_servers.user_id,
              linked_servers.public_slug,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              discord_guilds.id AS community_guild_id,
              discord_guilds.name AS community_name
       FROM linked_servers
       LEFT JOIN discord_guilds ON discord_guilds.id = linked_servers.discord_guild_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<CommunityMemberSourceServerRow>();
}

async function readCommunityMemberCandidateById(db: D1Database, actor: CommunityMemberSourceActor, candidateId: string) {
  const bindings: unknown[] = [];
  const conditions = scopedCandidateConditions(actor, bindings);
  conditions.push("community_member_candidates.id = ?");
  bindings.push(candidateId);

  const row = await db
    .prepare(
      `SELECT community_member_candidates.id,
              community_member_candidates.linked_server_id,
              COALESCE(NULLIF(linked_servers.display_name, ''), NULLIF(linked_servers.hostname, ''), linked_servers.server_name, linked_servers.nitrado_service_name, 'DZN Server') AS server_name,
              linked_servers.public_slug,
              community_member_candidates.community_guild_id,
              discord_guilds.name AS community_name,
              community_member_candidates.candidate_discord_id,
              community_member_candidates.candidate_username,
              community_member_candidates.candidate_display_name,
              community_member_candidates.role_label,
              community_member_candidates.source,
              community_member_candidates.status,
              community_member_candidates.match_status,
              community_member_candidates.matched_user_id,
              matched_users.username AS matched_username,
              community_member_candidates.imported_member_id,
              existing_members.id AS existing_member_id,
              community_member_candidates.reason,
              community_member_candidates.created_by_user_id,
              community_member_candidates.reviewed_by_user_id,
              community_member_candidates.reviewed_at,
              community_member_candidates.created_at,
              community_member_candidates.updated_at,
              profile_privacy.public_profile_enabled,
              profile_privacy.public_handle
       FROM community_member_candidates
       INNER JOIN linked_servers ON linked_servers.id = community_member_candidates.linked_server_id
       INNER JOIN discord_guilds ON discord_guilds.id = community_member_candidates.community_guild_id
       LEFT JOIN users matched_users ON matched_users.id = community_member_candidates.matched_user_id
       LEFT JOIN player_profile_privacy_preferences profile_privacy ON profile_privacy.user_id = matched_users.id
       LEFT JOIN community_members existing_members
              ON existing_members.community_guild_id = community_member_candidates.community_guild_id
             AND existing_members.user_id = community_member_candidates.matched_user_id
       WHERE ${conditions.join(" AND ")}
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<CommunityMemberCandidateRow>();
  return row ? toCandidateItem(row) : null;
}

async function resolveTrustedUserBridge(db: D1Database, input: { discordId?: string | null; userId?: string | null }): Promise<BridgeResolution> {
  if (input.userId) {
    const row = await db
      .prepare("SELECT id, discord_id, username FROM users WHERE id = ? LIMIT 1")
      .bind(input.userId)
      .first<UserBridgeRow>();
    if (!row) return { status: "no_match", user: null };
    if (input.discordId && row.discord_id !== input.discordId) return { status: "no_match", user: null };
    return { status: "matched", user: row };
  }

  if (!input.discordId) return { status: "no_match", user: null };
  const rows = await db
    .prepare("SELECT id, discord_id, username FROM users WHERE discord_id = ? LIMIT 2")
    .bind(input.discordId)
    .all<UserBridgeRow>();
  const results = rows.results ?? [];
  if (results.length === 1) return { status: "matched", user: results[0] };
  if (results.length > 1) return { status: "ambiguous", user: null };
  return { status: "no_match", user: null };
}

async function readExistingCommunityMemberId(db: D1Database, communityGuildId: string, userId: string) {
  const row = await db
    .prepare(
      `SELECT id
       FROM community_members
       WHERE community_guild_id = ?
         AND user_id = ?
       LIMIT 1`,
    )
    .bind(communityGuildId, userId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function readPrivateCandidateDiscordId(db: D1Database, candidateId: string) {
  const row = await db
    .prepare("SELECT candidate_discord_id FROM community_member_candidates WHERE id = ? LIMIT 1")
    .bind(candidateId)
    .first<{ candidate_discord_id: string | null }>();
  return cleanDiscordId(row?.candidate_discord_id);
}

async function markCandidateRejectedByImport(
  db: D1Database,
  actor: CommunityMemberSourceActor,
  candidateId: string,
  status: CommunityMemberCandidateStatus,
  matchStatus: CommunityMemberMatchStatus,
  reason: string,
) {
  await db
    .prepare(
      `UPDATE community_member_candidates
       SET status = ?,
           match_status = ?,
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           reason = COALESCE(?, reason),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(status, matchStatus, actor.user.id, reason, candidateId)
    .run();
}

async function updateCandidateMatchStatus(
  db: D1Database,
  candidateId: string,
  status: CommunityMemberCandidateStatus,
  matchStatus: CommunityMemberMatchStatus,
  reviewerUserId: string,
  reason: string | null,
) {
  await db
    .prepare(
      `UPDATE community_member_candidates
       SET status = ?,
           match_status = ?,
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           reason = COALESCE(?, reason),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(status, matchStatus, reviewerUserId, reason, candidateId)
    .run();
}

async function writeCommunityMemberSourceAudit(
  db: D1Database,
  actor: CommunityMemberSourceActor,
  input: {
    candidateId: string | null;
    communityMemberId: string | null;
    linkedServerId: string;
    communityGuildId: string;
    action: CommunityMemberSourceAuditAction;
    resultStatus: CommunityMemberSourceAuditResult;
    reason: string | null;
  },
) {
  await db
    .prepare(
      `INSERT INTO community_member_source_audit (
         id,
         candidate_id,
         community_member_id,
         linked_server_id,
         community_guild_id,
         actor_user_id,
         actor_role,
         action,
         result_status,
         reason,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      createId("cmaudit"),
      input.candidateId,
      input.communityMemberId,
      input.linkedServerId,
      input.communityGuildId,
      actor.user.id,
      actor.role,
      input.action,
      input.resultStatus,
      cleanReason(input.reason),
    )
    .run();
}

function scopedLinkedServerConditions(actor: CommunityMemberSourceActor, bindings: unknown[]) {
  const conditions = ["lower(COALESCE(linked_servers.status, 'pending')) NOT IN ('deleted', 'merged', 'suspended')"];
  if (actor.role !== "admin") {
    conditions.push("linked_servers.user_id = ?");
    bindings.push(actor.user.id);
  }
  return conditions;
}

function scopedCandidateConditions(actor: CommunityMemberSourceActor, bindings: unknown[]) {
  const conditions = ["1 = 1"];
  if (actor.role !== "admin") {
    conditions.push("linked_servers.user_id = ?");
    bindings.push(actor.user.id);
  }
  return conditions;
}

function scopedAuditConditions(actor: CommunityMemberSourceActor, bindings: unknown[]) {
  const conditions = ["1 = 1"];
  if (actor.role !== "admin") {
    conditions.push("linked_servers.user_id = ?");
    bindings.push(actor.user.id);
  }
  return conditions;
}

function toCandidateItem(row: CommunityMemberCandidateRow): CommunityMemberCandidateItem {
  const handle = normalizePublicProfileHandle(row.public_handle);
  const publicHref = publicPlayerProfileHref(handle);
  const publicApiHref = publicPlayerProfileApiHref(handle);
  const publicProfileLinkable = Boolean(Number(row.public_profile_enabled ?? 0) === 1 && handle && publicHref && publicApiHref);
  return {
    id: row.id,
    linked_server_id: row.linked_server_id,
    server_name: cleanDisplayText(row.server_name, 96) ?? "DZN Server",
    public_slug: cleanDisplayText(row.public_slug, 96),
    community_guild_id: row.community_guild_id,
    community_name: cleanDisplayText(row.community_name, 96) ?? "DZN Community",
    candidate_discord_id_masked: maskDiscordId(row.candidate_discord_id),
    candidate_username: cleanDisplayText(row.candidate_username, 64),
    candidate_display_name: cleanDisplayText(row.candidate_display_name, 96),
    role_label: cleanRoleLabel(row.role_label),
    source: cleanCandidateSource(row.source, "owner"),
    status: normalizeCandidateStatus(row.status),
    match_status: normalizeMatchStatus(row.match_status),
    matched_user_id: cleanDisplayText(row.matched_user_id, 96),
    matched_username: cleanDisplayText(row.matched_username, 64),
    imported_member_id: cleanDisplayText(row.imported_member_id, 96),
    existing_member_id: cleanDisplayText(row.existing_member_id, 96),
    reason: cleanReason(row.reason),
    created_by_user_id: cleanDisplayText(row.created_by_user_id, 96),
    reviewed_by_user_id: cleanDisplayText(row.reviewed_by_user_id, 96),
    reviewed_at: cleanDisplayText(row.reviewed_at, 64),
    created_at: cleanDisplayText(row.created_at, 64),
    updated_at: cleanDisplayText(row.updated_at, 64),
    public_profile_linkable: publicProfileLinkable,
    public_profile: publicProfileLinkable && handle && publicHref && publicApiHref
      ? {
          public_handle: handle,
          public_href: publicHref,
          public_api_href: publicApiHref,
        }
      : null,
  };
}

function toAuditItem(row: CommunityMemberSourceAuditRow): CommunityMemberSourceAuditItem {
  return {
    id: row.id,
    candidate_id: cleanDisplayText(row.candidate_id, 96),
    community_member_id: cleanDisplayText(row.community_member_id, 96),
    linked_server_id: row.linked_server_id,
    server_name: cleanDisplayText(row.server_name, 96) ?? "DZN Server",
    public_slug: cleanDisplayText(row.public_slug, 96),
    community_guild_id: row.community_guild_id,
    community_name: cleanDisplayText(row.community_name, 96) ?? "DZN Community",
    actor_user_id: row.actor_user_id,
    actor_role: row.actor_role === "admin" ? "admin" : "owner",
    action: AUDIT_ACTIONS.has(row.action as CommunityMemberSourceAuditAction) ? row.action as CommunityMemberSourceAuditAction : "candidate_created",
    result_status: AUDIT_RESULTS.has(row.result_status as CommunityMemberSourceAuditResult) ? row.result_status as CommunityMemberSourceAuditResult : "failed",
    reason: cleanReason(row.reason),
    created_at: cleanDisplayText(row.created_at, 64),
  };
}

function normalizeCandidateStatus(value: unknown): CommunityMemberCandidateStatus {
  return CANDIDATE_STATUSES.has(value as CommunityMemberCandidateStatus) ? value as CommunityMemberCandidateStatus : "pending";
}

function normalizeCandidateStatusFilter(value: unknown): CommunityMemberSourceManagementFilter {
  return CANDIDATE_STATUS_FILTERS.has(value as CommunityMemberSourceManagementFilter) ? value as CommunityMemberSourceManagementFilter : "pending";
}

function normalizeMatchStatus(value: unknown): CommunityMemberMatchStatus {
  return MATCH_STATUSES.has(value as CommunityMemberMatchStatus) ? value as CommunityMemberMatchStatus : "pending";
}

function cleanCandidateAction(value: unknown): CommunityMemberCandidateAction | null {
  return value === "import" || value === "reject" ? value : null;
}

function cleanCandidateSource(value: unknown, actorRole: CommunityMemberSourceRole) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (CANDIDATE_SOURCES.has(text)) return text;
  return actorRole === "admin" ? "admin_import" : "owner_import";
}

function cleanDiscordId(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!text) return null;
  return /^\d{5,32}$/.test(text) ? text : null;
}

function cleanIdentifier(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanDisplayText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, maxLength) || null;
}

function cleanRoleLabel(value: unknown) {
  return cleanDisplayText(value, 36);
}

function cleanReason(value: unknown) {
  return cleanDisplayText(value, 220);
}

function clampLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_LIMIT));
}

function maskDiscordId(value: unknown) {
  const discordId = cleanDiscordId(value);
  if (!discordId) return null;
  if (discordId.length <= 8) return `${discordId.slice(0, 2)}...${discordId.slice(-2)}`;
  return `${discordId.slice(0, 4)}...${discordId.slice(-4)}`;
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sourceManagementReason(status: CommunityMemberCandidateStatus, matchStatus: CommunityMemberMatchStatus) {
  if (status === "duplicate" || matchStatus === "duplicate") return "Candidate rejected because the trusted bridge already exists.";
  if (status === "ambiguous" || matchStatus === "ambiguous") return "Candidate rejected because the source resolved to multiple DZN users.";
  if (matchStatus === "no_match") return "Candidate stored for review, but no trusted DZN user bridge exists yet.";
  return "Candidate stored for owner/admin review.";
}

function sourceManagementResultMessage(status: CommunityMemberCandidateStatus, matchStatus: CommunityMemberMatchStatus) {
  if (status === "duplicate" || matchStatus === "duplicate") return "Candidate stored in the audit trail and rejected as a duplicate community member.";
  if (status === "ambiguous" || matchStatus === "ambiguous") return "Candidate stored in the audit trail and rejected because the user bridge is ambiguous.";
  if (matchStatus === "matched") return "Candidate stored with a unique trusted DZN user bridge.";
  return "Candidate stored for review. Import stays blocked until DZN resolves exactly one user.";
}

function errorResult(status: 400 | 404 | 409 | 422, error: string, message: string) {
  return {
    ok: false as const,
    status,
    error,
    message,
    safeguards: communityMemberSourceManagementSafeguards(),
  };
}
