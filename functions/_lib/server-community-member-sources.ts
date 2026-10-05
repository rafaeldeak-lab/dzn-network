import { requireDb } from "./db";
import { isDznAdminDiscordId } from "./admin";
import { isDznPulseEnabled } from "./feature-flags";
import type { Env, SessionUser } from "./types";

const CURRENT_WRITE_ACCESS = `(
  (? = 1 AND EXISTS (SELECT 1 FROM users access_actor WHERE access_actor.id = ? AND access_actor.discord_id = ?))
  OR EXISTS (
    SELECT 1 FROM linked_servers access_server
     WHERE access_server.id = ?
       AND access_server.user_id = ?
       AND lower(COALESCE(access_server.status, 'pending')) NOT IN ('deleted', 'merged')
       AND (access_server.merged_into_server_id IS NULL OR access_server.merged_into_server_id = '')
  )
)`;

export type CommunityCandidateAction = "import" | "reject";

const COMMUNITY_SOURCE_EXPORT_MAX_ROWS = 160;
const COMMUNITY_SOURCE_EXPORT_ACTIONS = new Set([
  "candidate_created",
  "candidate_imported",
  "candidate_rejected",
  "candidate_duplicate",
  "candidate_no_match",
]);
const COMMUNITY_SOURCE_EXPORT_RESULTS = new Set(["accepted", "rejected", "skipped"]);

type CandidateRow = {
  id: string;
  candidate_discord_id: string | null;
  candidate_username: string | null;
  role_label: string | null;
  status: "pending" | "imported" | "rejected" | "duplicate" | "no_match";
  matched_user_id: string | null;
  imported_member_id: string | null;
  existing_member_id: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
  matched_username: string | null;
  public_handle: string | null;
  public_profile_status: string | null;
  public_profile_enabled: number | null;
};

export async function listCommunityMemberSourceQueue(env: Env, actor: SessionUser, linkedServerId: string) {
  const db = requireDb(env);
  const readAccess = currentWriteAccessBindings(env, actor, linkedServerId);
  const [candidates, audit] = await Promise.all([
    db.prepare(
      `SELECT candidates.id, candidates.candidate_discord_id, candidates.candidate_username,
              candidates.role_label, candidates.status, users.id AS matched_user_id,
              candidates.imported_member_id, existing_members.id AS existing_member_id,
              candidates.reason, candidates.created_at,
              candidates.updated_at,
              CASE
                WHEN player_public_profiles.status = 'active'
                 AND player_profile_privacy_preferences.public_profile_enabled = 1
                 AND player_profile_privacy_preferences.show_display_name = 1
                THEN users.username
                WHEN player_public_profiles.status = 'active'
                 AND player_profile_privacy_preferences.public_profile_enabled = 1
                THEN 'DZN Player'
                ELSE NULL
              END AS matched_username,
              CASE
                WHEN player_public_profiles.status = 'active'
                 AND player_profile_privacy_preferences.public_profile_enabled = 1
                THEN player_public_profiles.handle
                ELSE NULL
              END AS public_handle,
              player_public_profiles.status AS public_profile_status,
              player_profile_privacy_preferences.public_profile_enabled
       FROM server_community_member_candidates candidates
       LEFT JOIN users
              ON (candidates.status = 'pending' AND users.discord_id = candidates.candidate_discord_id)
              OR (candidates.status != 'pending' AND users.id = candidates.matched_user_id)
       LEFT JOIN player_public_profiles ON player_public_profiles.user_id = users.id
       LEFT JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
       LEFT JOIN server_community_members existing_members
              ON existing_members.linked_server_id = candidates.linked_server_id
             AND existing_members.user_id = users.id
       WHERE candidates.linked_server_id = ?
         AND ${CURRENT_WRITE_ACCESS}
         AND (
           candidates.status = 'pending'
           OR candidates.id IN (
             SELECT recent.id
             FROM server_community_member_candidates recent
             WHERE recent.linked_server_id = ? AND recent.status != 'pending'
             ORDER BY recent.updated_at DESC
             LIMIT 100
           )
         )
       ORDER BY CASE candidates.status WHEN 'pending' THEN 0 ELSE 1 END,
                candidates.updated_at DESC`,
    ).bind(linkedServerId, ...readAccess, linkedServerId).all<CandidateRow>(),
    db.prepare(
      `SELECT id, candidate_id, action, result_status, reason, created_at
       FROM server_community_member_source_audit
       WHERE linked_server_id = ?
         AND ${CURRENT_WRITE_ACCESS}
       ORDER BY created_at DESC
       LIMIT 100`,
    ).bind(linkedServerId, ...readAccess).all<Record<string, unknown>>(),
  ]);
  return {
    candidates: (candidates.results ?? []).map(toCandidatePayload),
    audit: audit.results ?? [],
  };
}

export async function exportCommunityMemberSourceAudit(
  env: Env,
  actor: SessionUser,
  linkedServerId: string,
  input: { action?: unknown; result?: unknown; query?: unknown; limit?: unknown } = {},
) {
  const db = requireDb(env);
  const access = currentWriteAccessBindings(env, actor, linkedServerId);
  const action = normalizeExportFilter(input.action, COMMUNITY_SOURCE_EXPORT_ACTIONS);
  const result = normalizeExportFilter(input.result, COMMUNITY_SOURCE_EXPORT_RESULTS);
  const query = cleanText(input.query, 96)?.toLowerCase() ?? "";
  const requestedLimitText = typeof input.limit === "string" ? input.limit.trim() : input.limit;
  const requestedLimit = requestedLimitText === "" || requestedLimitText == null ? null : Number(requestedLimitText);
  const limit = requestedLimit !== null && Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), COMMUNITY_SOURCE_EXPORT_MAX_ROWS))
    : COMMUNITY_SOURCE_EXPORT_MAX_ROWS;
  const conditions = ["linked_server_id = ?", CURRENT_WRITE_ACCESS];
  const bindings: unknown[] = [linkedServerId, ...access];
  if (action !== "all") {
    conditions.push("action = ?");
    bindings.push(action);
  }
  if (result !== "all") {
    conditions.push("result_status = ?");
    bindings.push(result);
  }
  if (query) {
    conditions.push("(LOWER(COALESCE(action, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(result_status, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(reason, '')) LIKE ? ESCAPE '\\')");
    const search = `%${escapeSqlLike(query)}%`;
    bindings.push(search, search, search);
  }
  bindings.push(limit + 1);
  const rows = await db.prepare(
    `SELECT id, candidate_id, action, result_status, reason, created_at
       FROM server_community_member_source_audit
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?`,
  ).bind(...bindings).all<Record<string, unknown>>();
  const safeRows = (rows.results ?? []).slice(0, limit).map(toExportSafeAuditRow);
  const generatedAt = new Date().toISOString();
  return {
    ok: true as const,
    status: 200 as const,
    body: buildCommunitySourceAuditCsv(safeRows, { action, result, linkedServerId }, generatedAt),
    filename: `dzn-community-source-audit-${generatedAt.slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}.csv`,
    rowCount: safeRows.length,
    truncated: (rows.results ?? []).length > limit,
    limit,
    generatedAt,
    policy: {
      ownerAdminOnly: true,
      maxRowsPerDownload: COMMUNITY_SOURCE_EXPORT_MAX_ROWS,
      persistence: "download_only" as const,
      exportHistory: "session_only" as const,
      sharingLinks: false,
      rawIdentifiers: false,
    },
  };
}

export async function createCommunityMemberCandidate(
  env: Env,
  actor: SessionUser,
  linkedServerId: string,
  input: { discordId: unknown; username: unknown; roleLabel: unknown },
) {
  const discordId = cleanDiscordId(input.discordId);
  if (!discordId) return { ok: false as const, status: 400, error: "INVALID_DISCORD_ID", message: "Enter the player's exact Discord user ID." };
  const db = requireDb(env);
  const writeAccess = currentWriteAccessBindings(env, actor, linkedServerId);
  const now = new Date().toISOString();
  const matched = await db.prepare("SELECT id, username FROM users WHERE discord_id = ? LIMIT 1")
    .bind(discordId).first<{ id: string; username: string | null }>();
  const existing = matched
    ? await db.prepare("SELECT id FROM server_community_members WHERE linked_server_id = ? AND user_id = ? LIMIT 1")
      .bind(linkedServerId, matched.id).first<{ id: string }>()
    : null;
  if (matched && !existing) {
    const pending = await db.prepare(
      `SELECT id FROM server_community_member_candidates
       WHERE linked_server_id = ? AND candidate_discord_id = ? AND status = 'pending'
         AND ${CURRENT_WRITE_ACCESS}
       LIMIT 1`,
    ).bind(linkedServerId, discordId, ...writeAccess).first<{ id: string }>();
    if (pending) {
      return { ok: true as const, status: 200, candidate_status: "pending" as const, message: "That DZN account is already awaiting an owner decision." };
    }
  }
  const duplicateReason = "That DZN account is already in this server directory.";
  const pendingReason = "Exact DZN Discord account match found. Owner review is required.";
  const noMatchReason = "No DZN account currently matches that Discord user ID.";
  const candidateId = crypto.randomUUID();
  const candidateUsername = cleanText(input.username, 64);
  const roleLabel = cleanText(input.roleLabel, 36);
  const candidateInsert = matched
    ? db.prepare(
        `INSERT INTO server_community_member_candidates (
           id, linked_server_id, candidate_discord_id, candidate_username, role_label,
           status, matched_user_id, reason, created_by_user_id, created_at, updated_at
         ) SELECT ?, ?,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM server_community_members
                     WHERE linked_server_id = ? AND user_id = users.id
                  ) THEN NULL ELSE ? END,
                  ?, ?,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM server_community_members
                     WHERE linked_server_id = ? AND user_id = users.id
                  ) THEN 'duplicate' ELSE 'pending' END,
                  users.id,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM server_community_members
                     WHERE linked_server_id = ? AND user_id = users.id
                  ) THEN ? ELSE ? END,
                  (SELECT id FROM users WHERE id = ? AND discord_id = ?), ?, ?
             FROM users
            WHERE users.id = ? AND users.discord_id = ?
              AND ${CURRENT_WRITE_ACCESS}
         ON CONFLICT DO NOTHING`,
      ).bind(candidateId, linkedServerId, linkedServerId, discordId, candidateUsername, roleLabel, linkedServerId, linkedServerId, duplicateReason, pendingReason, actor.id, actor.discord_id, now, now, matched.id, discordId, ...writeAccess)
    : db.prepare(
        `INSERT INTO server_community_member_candidates (
           id, linked_server_id, candidate_discord_id, candidate_username, role_label,
           status, matched_user_id, reason, created_by_user_id, created_at, updated_at
         ) SELECT ?, ?, NULL, ?, ?, 'no_match', NULL, ?,
                  (SELECT id FROM users WHERE id = ? AND discord_id = ?), ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE discord_id = ?)
              AND ${CURRENT_WRITE_ACCESS}
         ON CONFLICT DO NOTHING`,
      ).bind(candidateId, linkedServerId, candidateUsername, roleLabel, noMatchReason, actor.id, actor.discord_id, now, now, discordId, ...writeAccess);
  await db.batch([
    candidateInsert,
    db.prepare(
      `INSERT INTO server_community_member_source_audit (
         id, linked_server_id, candidate_id, member_user_id, actor_user_id,
         action, result_status, reason, created_at
       ) SELECT ?, linked_server_id, id, matched_user_id,
                (SELECT id FROM users WHERE id = ? AND discord_id = ?),
                CASE status
                  WHEN 'pending' THEN 'candidate_created'
                  WHEN 'duplicate' THEN 'candidate_duplicate'
                  ELSE 'candidate_no_match'
                END,
                CASE WHEN status = 'pending' THEN 'accepted' ELSE 'skipped' END,
                reason, ?
           FROM server_community_member_candidates
          WHERE id = ? AND linked_server_id = ?`,
    ).bind(crypto.randomUUID(), actor.id, actor.discord_id, now, candidateId, linkedServerId),
  ]);
  const saved = await db.prepare(
    `SELECT status, reason FROM server_community_member_candidates
      WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
      LIMIT 1`,
  ).bind(candidateId, linkedServerId, ...writeAccess).first<{ status: CandidateRow["status"]; reason: string | null }>();
  if (!saved) {
    const concurrentPending = matched && !existing
      ? await db.prepare(
          `SELECT id FROM server_community_member_candidates
           WHERE linked_server_id = ? AND candidate_discord_id = ? AND status = 'pending'
             AND ${CURRENT_WRITE_ACCESS}
           LIMIT 1`,
        ).bind(linkedServerId, discordId, ...writeAccess).first<{ id: string }>()
      : null;
    if (concurrentPending) {
      return { ok: true as const, status: 200, candidate_status: "pending" as const, message: "That DZN account is already awaiting an owner decision." };
    }

    const currentMatch = await db.prepare(
      `SELECT users.id,
              EXISTS (
                SELECT 1 FROM server_community_members
                 WHERE linked_server_id = ? AND user_id = users.id
              ) AS member_exists,
              (
                SELECT status FROM server_community_member_candidates
                 WHERE linked_server_id = ? AND candidate_discord_id = users.discord_id
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1
              ) AS latest_status
         FROM users
        WHERE users.discord_id = ?
          AND ${CURRENT_WRITE_ACCESS}
        LIMIT 1`,
    ).bind(linkedServerId, linkedServerId, discordId, ...writeAccess).first<{ id: string; member_exists: number; latest_status: CandidateRow["status"] | null }>();
    if (currentMatch?.member_exists) {
      await db.batch([
        db.prepare(
          `INSERT INTO server_community_member_candidates (
             id, linked_server_id, candidate_discord_id, candidate_username, role_label,
             status, matched_user_id, reason, created_by_user_id, created_at, updated_at
           ) SELECT ?, ?, NULL, ?, ?, 'duplicate', users.id, ?,
                    (SELECT id FROM users WHERE id = ? AND discord_id = ?), ?, ?
               FROM users
              WHERE users.discord_id = ?
                AND EXISTS (
                  SELECT 1 FROM server_community_members
                   WHERE linked_server_id = ? AND user_id = users.id
                )
                AND ${CURRENT_WRITE_ACCESS}`,
        ).bind(candidateId, linkedServerId, candidateUsername, roleLabel, duplicateReason, actor.id, actor.discord_id, now, now, discordId, linkedServerId, ...writeAccess),
        db.prepare(
          `INSERT INTO server_community_member_source_audit (
             id, linked_server_id, candidate_id, member_user_id, actor_user_id,
             action, result_status, reason, created_at
           ) SELECT ?, linked_server_id, id, matched_user_id,
                    (SELECT id FROM users WHERE id = ? AND discord_id = ?),
                    'candidate_duplicate', 'skipped', reason, ?
               FROM server_community_member_candidates
              WHERE id = ? AND linked_server_id = ? AND status = 'duplicate'`,
        ).bind(crypto.randomUUID(), actor.id, actor.discord_id, now, candidateId, linkedServerId),
      ]);
      const recoveredDuplicate = await db.prepare(
        `SELECT status FROM server_community_member_candidates
          WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
          LIMIT 1`,
      ).bind(candidateId, linkedServerId, ...writeAccess).first<{ status: string }>();
      return recoveredDuplicate?.status === "duplicate"
        ? { ok: true as const, status: 200, candidate_status: "duplicate" as const, message: "That DZN account is already in this server directory." }
        : { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The account source state changed while it was being queued. Refresh and try again." };
    }
    if (currentMatch?.latest_status) {
      return {
        ok: true as const,
        status: 200,
        candidate_status: currentMatch.latest_status,
        message: `That DZN account's source request was already processed as ${currentMatch.latest_status}. Refresh the queue before trying again.`,
      };
    }
    if (currentMatch) {
      return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The account source state changed while it was being queued. Refresh and try again." };
    }

    const deletedReason = "No DZN account currently matches that Discord user ID.";
    await db.batch([
      db.prepare(
        `INSERT INTO server_community_member_candidates (
           id, linked_server_id, candidate_discord_id, candidate_username, role_label,
           status, matched_user_id, reason, created_by_user_id, created_at, updated_at
         ) SELECT ?, ?, NULL, ?, ?, 'no_match', NULL, ?,
                  (SELECT id FROM users WHERE id = ? AND discord_id = ?), ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE discord_id = ?)
              AND ${CURRENT_WRITE_ACCESS}`,
      ).bind(candidateId, linkedServerId, candidateUsername, roleLabel, deletedReason, actor.id, actor.discord_id, now, now, discordId, ...writeAccess),
      db.prepare(
        `INSERT INTO server_community_member_source_audit (
           id, linked_server_id, candidate_id, member_user_id, actor_user_id,
           action, result_status, reason, created_at
         ) SELECT ?, linked_server_id, id, NULL,
                  (SELECT id FROM users WHERE id = ? AND discord_id = ?),
                  'candidate_no_match', 'skipped', ?, ?
             FROM server_community_member_candidates
            WHERE id = ? AND linked_server_id = ?`,
      ).bind(crypto.randomUUID(), actor.id, actor.discord_id, deletedReason, now, candidateId, linkedServerId),
    ]);
    const noMatchSaved = await db.prepare(
      `SELECT status FROM server_community_member_candidates
        WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
        LIMIT 1`,
    ).bind(candidateId, linkedServerId, ...writeAccess).first<{ status: string }>();
    return noMatchSaved?.status === "no_match"
      ? { ok: true as const, status: 201, candidate_status: "no_match" as const, message: deletedReason }
      : { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The account source state changed while it was being queued. Refresh and try again." };
  }
  if (saved.status === "pending") {
    await notifyOwnerOfImportableCandidate(env, linkedServerId, candidateId).catch((error) => {
      console.warn("DZN community candidate owner notification skipped", {
        candidate_id: candidateId,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  }
  return { ok: true as const, status: 201, candidate_status: saved.status, message: saved.reason ?? "Candidate source recorded." };
}

export async function decideCommunityMemberCandidate(
  env: Env,
  actor: SessionUser,
  linkedServerId: string,
  candidateId: unknown,
  action: unknown,
  reasonInput: unknown,
) {
  const id = cleanId(candidateId);
  const decision: CommunityCandidateAction | null = action === "import" || action === "reject" ? action : null;
  if (!id || !decision) return { ok: false as const, status: 400, error: "INVALID_DECISION", message: "Choose a valid pending candidate and decision." };
  const db = requireDb(env);
  const writeAccess = currentWriteAccessBindings(env, actor, linkedServerId);
  const candidate = await db.prepare(
    `SELECT candidates.id, candidates.candidate_discord_id, candidates.role_label,
            candidates.status, users.id AS matched_user_id, player_public_profiles.handle,
            player_profile_privacy_preferences.public_profile_enabled
     FROM server_community_member_candidates candidates
     LEFT JOIN users ON users.discord_id = candidates.candidate_discord_id
     LEFT JOIN player_public_profiles ON player_public_profiles.user_id = users.id AND player_public_profiles.status = 'active'
     LEFT JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
     WHERE candidates.id = ? AND candidates.linked_server_id = ?
       AND ${CURRENT_WRITE_ACCESS}
     LIMIT 1`,
  ).bind(id, linkedServerId, ...writeAccess).first<{
    id: string; candidate_discord_id: string | null; role_label: string | null; status: string;
    matched_user_id: string | null; handle: string | null; public_profile_enabled: number | null;
  }>();
  if (!candidate) return { ok: false as const, status: 404, error: "CANDIDATE_NOT_FOUND", message: "That candidate is not available for this server." };
  if (candidate.status !== "pending") return { ok: false as const, status: 409, error: "CANDIDATE_ALREADY_DECIDED", message: "That candidate has already been decided." };
  const now = new Date().toISOString();
  const reason = cleanText(reasonInput, 220);
  const decisionNonce = crypto.randomUUID();
  if (decision === "reject") {
    await db.batch([
      db.prepare(
        `UPDATE server_community_member_candidates
         SET status = 'rejected',
             matched_user_id = (
               SELECT id FROM users
                WHERE discord_id = server_community_member_candidates.candidate_discord_id
             ),
             reason = ?,
             reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
             decision_nonce = ?, updated_at = ?
         WHERE id = ? AND linked_server_id = ? AND status = 'pending'
           AND ${CURRENT_WRITE_ACCESS}`,
      ).bind(reason ?? "Rejected by the server owner.", actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, ...writeAccess),
      conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_rejected", result: "rejected", reason: reason ?? "Rejected by the server owner.", now, status: "rejected", decisionNonce }),
    ]);
    const rejected = await db.prepare(
      `SELECT status, decision_nonce FROM server_community_member_candidates
        WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
        LIMIT 1`,
    ).bind(id, linkedServerId, ...writeAccess).first<{ status: string; decision_nonce: string | null }>();
    if (!rejected) {
      return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
    }
    return rejected?.status === "rejected" && rejected.decision_nonce === decisionNonce
      ? { ok: true as const, status: 200, message: "Candidate rejected and recorded." }
      : { ok: true as const, status: 200, message: `Candidate was already decided as ${rejected?.status ?? "unavailable"} by another request.` };
  }
  if (candidate.matched_user_id) {
    const existingMemberState = await db.prepare(
      `SELECT EXISTS (
         SELECT 1 FROM server_community_members
          WHERE linked_server_id = ? AND user_id = ?
       ) AS member_exists
       WHERE ${CURRENT_WRITE_ACCESS}`,
    ).bind(linkedServerId, candidate.matched_user_id, ...writeAccess).first<{ member_exists: number }>();
    if (!existingMemberState) {
      return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
    }
    if (existingMemberState.member_exists) {
      const duplicateReason = "That DZN account is already in this server directory. The existing member was not changed.";
      await db.batch([
        db.prepare(
          `UPDATE server_community_member_candidates
           SET status = 'duplicate',
               matched_user_id = (SELECT id FROM users WHERE discord_id = server_community_member_candidates.candidate_discord_id),
               reason = ?,
               reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
               decision_nonce = ?, updated_at = ?
           WHERE id = ? AND linked_server_id = ? AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM server_community_members
                 WHERE linked_server_id = ?
                   AND user_id = (SELECT id FROM users WHERE discord_id = server_community_member_candidates.candidate_discord_id)
              )
              AND ${CURRENT_WRITE_ACCESS}`,
        ).bind(duplicateReason, actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, linkedServerId, ...writeAccess),
        conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_duplicate", result: "skipped", reason: duplicateReason, now, status: "duplicate", decisionNonce }),
      ]);
      const duplicate = await db.prepare(
        `SELECT status, decision_nonce FROM server_community_member_candidates
          WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
          LIMIT 1`,
      ).bind(id, linkedServerId, ...writeAccess).first<{ status: string; decision_nonce: string | null }>();
      if (duplicate?.status === "duplicate" && duplicate.decision_nonce === decisionNonce) {
        return { ok: true as const, status: 200, message: duplicateReason };
      }
      if (duplicate?.status && duplicate.status !== "pending") {
        return { ok: true as const, status: 200, message: `Candidate was already decided as ${duplicate.status} by another request.` };
      }
      const refreshedIdentity = await db.prepare(
        `SELECT users.id AS matched_user_id
           FROM server_community_member_candidates candidates
           INNER JOIN users ON users.discord_id = candidates.candidate_discord_id
          WHERE candidates.id = ? AND candidates.linked_server_id = ? AND candidates.status = 'pending'
            AND ${CURRENT_WRITE_ACCESS}
          LIMIT 1`,
      ).bind(id, linkedServerId, ...writeAccess).first<{ matched_user_id: string }>();
      if (!refreshedIdentity) {
        return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
      }
      if (refreshedIdentity.matched_user_id !== candidate.matched_user_id) {
        return { ok: true as const, status: 200, message: "Candidate remains pending because the linked Discord identity changed. Refresh before deciding." };
      }
    }
  }
  if (!candidate.matched_user_id || !candidate.handle || candidate.public_profile_enabled !== 1) {
    return { ok: false as const, status: 409, error: "PUBLIC_PROFILE_REQUIRED", message: "The matched player must have an active public DZN profile before import." };
  }
  const memberId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO server_community_members (
         id, linked_server_id, user_id, role_label, public_member_enabled, source,
         created_by_user_id, created_at, updated_at
       ) SELECT ?, ?, users.id, ?, 0, 'owner_public_handle',
                (SELECT id FROM users WHERE id = ? AND discord_id = ?), ?, ?
         FROM server_community_member_candidates candidates
         INNER JOIN users
                 ON users.id = ?
                AND users.discord_id = candidates.candidate_discord_id
         INNER JOIN player_public_profiles profiles
                 ON profiles.user_id = users.id
                AND profiles.status = 'active'
         INNER JOIN player_profile_privacy_preferences privacy
                 ON privacy.user_id = users.id
                AND privacy.public_profile_enabled = 1
        WHERE candidates.id = ? AND candidates.linked_server_id = ? AND candidates.status = 'pending'
          AND ${CURRENT_WRITE_ACCESS}
          AND NOT EXISTS (
            SELECT 1 FROM server_community_members members
             WHERE members.linked_server_id = ? AND members.user_id = ?
          )`,
    ).bind(memberId, linkedServerId, candidate.role_label, actor.id, actor.discord_id, now, now, candidate.matched_user_id, id, linkedServerId, ...writeAccess, linkedServerId, candidate.matched_user_id),
    db.prepare(
      `UPDATE server_community_member_candidates
       SET status = 'imported', matched_user_id = ?,
           imported_member_id = ?,
           reason = ?,
           reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?),
           reviewed_at = ?, decision_nonce = ?, updated_at = ?
       WHERE id = ? AND linked_server_id = ? AND status = 'pending'
         AND EXISTS (SELECT 1 FROM server_community_members WHERE id = ? AND linked_server_id = ? AND user_id = ?)`,
    ).bind(candidate.matched_user_id, memberId, reason ?? "Imported privately; player approval is still required.", actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, memberId, linkedServerId, candidate.matched_user_id),
    db.prepare(
      `INSERT INTO server_community_member_audit (
         id, linked_server_id, member_user_id, actor_user_id, action,
         role_label, public_member_enabled, created_at
       ) SELECT ?, ?, ?,
                (SELECT id FROM users WHERE id = ? AND discord_id = ?),
                'add', ?, 0, ?
         FROM server_community_member_candidates
        WHERE id = ? AND linked_server_id = ? AND status = 'imported'
          AND decision_nonce = ? AND imported_member_id = ?`,
    ).bind(crypto.randomUUID(), linkedServerId, candidate.matched_user_id, actor.id, actor.discord_id, candidate.role_label, now, id, linkedServerId, decisionNonce, memberId),
    conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_imported", result: "accepted", reason: reason ?? "Imported privately; player approval is still required.", now, status: "imported", decisionNonce, importedMemberId: memberId }),
  ]);
  const imported = await db.prepare(
    `SELECT status, imported_member_id, decision_nonce FROM server_community_member_candidates
      WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
      LIMIT 1`,
  ).bind(id, linkedServerId, ...writeAccess).first<{ status: string; imported_member_id: string | null; decision_nonce: string | null }>();
  if (!imported) {
    return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
  }
  if (imported?.status === "imported" && (imported.imported_member_id !== memberId || imported.decision_nonce !== decisionNonce)) {
    return { ok: true as const, status: 200, message: "Candidate was already imported by another request." };
  }
  if (imported && imported.status !== "pending" && imported.status !== "imported") {
    return { ok: true as const, status: 200, message: `Candidate was already decided as ${imported.status} by another request.` };
  }
  if (imported?.status !== "imported" || imported.imported_member_id !== memberId || imported.decision_nonce !== decisionNonce) {
    const currentState = await db.prepare(
      `SELECT
         EXISTS (
            SELECT 1
              FROM server_community_member_candidates current_candidates
              INNER JOIN users current_users
                      ON current_users.discord_id = current_candidates.candidate_discord_id
              INNER JOIN server_community_members current_members
                      ON current_members.linked_server_id = current_candidates.linked_server_id
                     AND current_members.user_id = current_users.id
             WHERE current_candidates.id = ? AND current_candidates.linked_server_id = ?
         ) AS member_exists,
         EXISTS (
           SELECT 1
             FROM server_community_member_candidates candidates
             INNER JOIN users
                     ON users.id = ?
                    AND users.discord_id = candidates.candidate_discord_id
            WHERE candidates.id = ? AND candidates.linked_server_id = ?
         ) AS identity_current,
         EXISTS (
           SELECT 1
             FROM server_community_member_candidates candidates
             INNER JOIN users
                     ON users.id = ?
                    AND users.discord_id = candidates.candidate_discord_id
             INNER JOIN player_public_profiles profiles
                     ON profiles.user_id = users.id
                    AND profiles.status = 'active'
             INNER JOIN player_profile_privacy_preferences privacy
                     ON privacy.user_id = users.id
                    AND privacy.public_profile_enabled = 1
            WHERE candidates.id = ? AND candidates.linked_server_id = ?
          ) AS eligible
       WHERE ${CURRENT_WRITE_ACCESS}`,
    ).bind(
      id, linkedServerId,
      candidate.matched_user_id, id, linkedServerId,
      candidate.matched_user_id, id, linkedServerId,
      ...writeAccess,
    ).first<{ member_exists: number; identity_current: number; eligible: number }>();
    if (!currentState) {
      return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
    }

    if (!currentState?.identity_current) {
      const noMatchReason = "The linked Discord identity changed or is no longer available. No source identifier was retained.";
      await db.batch([
        db.prepare(
          `UPDATE server_community_member_candidates
           SET status = 'no_match', candidate_discord_id = NULL, candidate_username = NULL,
               matched_user_id = NULL, reason = ?,
               reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
               decision_nonce = ?, updated_at = ?
           WHERE id = ? AND linked_server_id = ? AND status = 'pending'
             AND NOT EXISTS (
               SELECT 1
                 FROM users
                WHERE users.discord_id = server_community_member_candidates.candidate_discord_id
             )
             AND ${CURRENT_WRITE_ACCESS}`,
        ).bind(noMatchReason, actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, ...writeAccess),
        conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_no_match", result: "skipped", reason: noMatchReason, now, status: "no_match", decisionNonce }),
      ]);
      const noMatch = await db.prepare(
        `SELECT status, decision_nonce FROM server_community_member_candidates
          WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
          LIMIT 1`,
      ).bind(id, linkedServerId, ...writeAccess).first<{ status: string; decision_nonce: string | null }>();
      if (!noMatch) {
        return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
      }
      if (noMatch?.status === "no_match" && noMatch.decision_nonce === decisionNonce) {
        return { ok: true as const, status: 200, message: noMatchReason };
      }
    }

    const duplicateReason = "That DZN account is already in this server directory. The existing member was not changed.";
    if (currentState.member_exists) {
      await db.batch([
        db.prepare(
          `UPDATE server_community_member_candidates
           SET status = 'duplicate',
               matched_user_id = (SELECT id FROM users WHERE discord_id = server_community_member_candidates.candidate_discord_id),
               reason = ?,
               reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
               decision_nonce = ?, updated_at = ?
           WHERE id = ? AND linked_server_id = ? AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM server_community_members
                 WHERE linked_server_id = ?
                   AND user_id = (SELECT id FROM users WHERE discord_id = server_community_member_candidates.candidate_discord_id)
              )
              AND ${CURRENT_WRITE_ACCESS}`,
        ).bind(duplicateReason, actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, linkedServerId, ...writeAccess),
        conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_duplicate", result: "skipped", reason: duplicateReason, now, status: "duplicate", decisionNonce }),
      ]);
      const duplicate = await db.prepare(
        `SELECT status, decision_nonce FROM server_community_member_candidates
          WHERE id = ? AND linked_server_id = ? AND ${CURRENT_WRITE_ACCESS}
          LIMIT 1`,
      ).bind(id, linkedServerId, ...writeAccess).first<{ status: string; decision_nonce: string | null }>();
      if (!duplicate) {
        return { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The candidate or your server access changed. Refresh and try again." };
      }
      if (duplicate?.status === "duplicate" && duplicate.decision_nonce === decisionNonce) {
        return { ok: true as const, status: 200, message: duplicateReason };
      }
    }

    if (!currentState.eligible) {
      return {
        ok: true as const,
        status: 200,
        message: "Candidate remains pending because the player's public-profile eligibility changed. Refresh and retry after the player restores it.",
      };
    }

    return { ok: true as const, status: 200, message: "Candidate remains pending because eligibility changed during import. Refresh and retry." };
  }
  return { ok: true as const, status: 200, message: "Candidate imported privately. The player must approve the directory invitation." };
}

export async function decideCommunityMemberCandidates(
  env: Env,
  actor: SessionUser,
  linkedServerId: string,
  candidateIds: unknown,
  action: unknown,
  reasonInput: unknown,
) {
  const decision: CommunityCandidateAction | null = action === "import" || action === "reject" ? action : null;
  const ids = Array.isArray(candidateIds) ? candidateIds.map(cleanId) : [];
  if (!decision || ids.length === 0 || ids.length > 25 || ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return { ok: false as const, status: 400, error: "INVALID_BULK_DECISION", message: "Choose between 1 and 25 unique pending candidates." };
  }

  const results: Array<{ id: string; ok: boolean; status: number; error: string | null; message: string }> = [];
  for (const id of ids as string[]) {
    const result = await decideCommunityMemberCandidate(env, actor, linkedServerId, id, decision, reasonInput);
    results.push({ id, ok: result.ok, status: result.status, error: "error" in result && typeof result.error === "string" ? result.error : null, message: result.message });
  }
  const processed = results.filter((result) => result.ok).length;
  const failed = results.length - processed;
  return {
    ok: failed === 0,
    status: failed === 0 ? 200 : 207,
    processed,
    failed,
    results,
    message: failed === 0
      ? `${processed} candidate${processed === 1 ? "" : "s"} processed.`
      : `${processed} processed and ${failed} could not be processed. Review the remaining pending rows.`,
  };
}

function conditionalDecisionAuditStatement(db: D1Database, input: { linkedServerId: string; candidateId: string; actorId: string; actorDiscordId: string; action: string; result: string; reason: string; now: string; status: "imported" | "rejected" | "duplicate" | "no_match"; decisionNonce: string; importedMemberId?: string }) {
  return db.prepare(
    `INSERT INTO server_community_member_source_audit (
       id, linked_server_id, candidate_id, member_user_id, actor_user_id,
       action, result_status, reason, created_at
     ) SELECT ?, ?, ?, matched_user_id,
              (SELECT id FROM users WHERE id = ? AND discord_id = ?),
              ?, ?, ?, ?
       FROM server_community_member_candidates
      WHERE id = ? AND linked_server_id = ? AND status = ?
        AND decision_nonce = ?
        AND (? IS NULL OR imported_member_id = ?)`,
  ).bind(crypto.randomUUID(), input.linkedServerId, input.candidateId, input.actorId, input.actorDiscordId, input.action, input.result, input.reason, input.now, input.candidateId, input.linkedServerId, input.status, input.decisionNonce, input.importedMemberId ?? null, input.importedMemberId ?? null);
}

function currentWriteAccessBindings(env: Env, actor: SessionUser, linkedServerId: string): [number, string, string, string, string] {
  const globalAccess = isDznAdminDiscordId(env, actor.discord_id) || env.MOCK_AUTH === "1" || env.MOCK_AUTH === "true";
  return [globalAccess ? 1 : 0, actor.id, actor.discord_id, linkedServerId, actor.id];
}

async function notifyOwnerOfImportableCandidate(env: Env, linkedServerId: string, candidateId: string) {
  if (!isDznPulseEnabled(env)) return null;
  const now = new Date().toISOString();
  return requireDb(env).prepare(
    `INSERT OR IGNORE INTO user_notifications (
       id, user_id, server_id, type, title, body, action_url, priority,
       dedupe_key, metadata, created_at, expires_at
     )
     SELECT ?, servers.user_id, servers.id, 'community_member_candidate_importable',
            'Community member ready to review',
            substr(COALESCE(NULLIF(users.username, ''), 'DZN player'), 1, 64) ||
              ' has a unique eligible DZN profile and is ready for your private import decision.',
            ?, 58, ?, ?, ?, ?
       FROM server_community_member_candidates candidates
       JOIN linked_servers servers ON servers.id = candidates.linked_server_id
       JOIN users ON users.discord_id = candidates.candidate_discord_id
       JOIN player_public_profiles profiles ON profiles.user_id = users.id AND profiles.status = 'active'
       JOIN player_profile_privacy_preferences privacy ON privacy.user_id = users.id AND privacy.public_profile_enabled = 1
       LEFT JOIN server_community_members members
              ON members.linked_server_id = candidates.linked_server_id AND members.user_id = users.id
      WHERE candidates.id = ? AND candidates.linked_server_id = ? AND candidates.status = 'pending'
        AND lower(COALESCE(servers.status, 'pending')) NOT IN ('deleted', 'merged')
        AND (servers.merged_into_server_id IS NULL OR servers.merged_into_server_id = '')
        AND members.id IS NULL`,
  ).bind(
    crypto.randomUUID(),
    `/dashboard/community?serverId=${encodeURIComponent(linkedServerId)}`,
    `community-member-importable:${candidateId}`,
    JSON.stringify({ candidate_id: candidateId, presentation_only: true }),
    now,
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    candidateId,
    linkedServerId,
  ).run();
}

function toCandidatePayload(row: CandidateRow) {
  const hasExistingMember = Boolean(row.existing_member_id);
  const canImport = row.status === "pending"
    && (hasExistingMember || (
      Boolean(row.matched_user_id && row.public_handle)
      && row.public_profile_status === "active"
      && row.public_profile_enabled === 1
    ));
  return {
    id: row.id,
    candidate_discord_id_masked: maskDiscordId(row.candidate_discord_id),
    candidate_username: row.candidate_username,
    role_label: row.role_label,
    status: row.status,
    reason: row.reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    matched_username: row.matched_username,
    public_handle: row.public_handle,
    has_existing_member: hasExistingMember,
    can_import: canImport,
    readiness: candidateReadiness(row, canImport, hasExistingMember),
  };
}

function candidateReadiness(row: CandidateRow, canImport: boolean, hasExistingMember: boolean) {
  if (row.status === "pending" && hasExistingMember) {
    return { state: "ready" as const, label: "Ready to reconcile", detail: "This player is already in the private directory. Review will preserve their existing visibility choice." };
  }
  if (row.status === "pending" && canImport) {
    return { state: "ready" as const, label: "Ready to import", detail: "A unique eligible DZN profile is matched. Import stays private until the player approves visibility." };
  }
  if (row.status === "pending") {
    return { state: "blocked" as const, label: "Profile eligibility needed", detail: "The matched account needs an active public profile and enabled profile visibility before import." };
  }
  if (row.status === "no_match") {
    return { state: "no_match" as const, label: "No account match", detail: "No current DZN account owns the submitted Discord identity." };
  }
  return { state: "complete" as const, label: row.status.replace("_", " "), detail: "This source check is complete and remains available in decision history." };
}

function normalizeExportFilter(value: unknown, allowed: Set<string>) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.has(text) ? text : "all";
}

function escapeSqlLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toExportSafeAuditRow(row: Record<string, unknown>) {
  return {
    auditRef: exportSafeRef(row.id) ?? "audit",
    candidateRef: exportSafeRef(row.candidate_id),
    action: cleanText(row.action, 64) ?? "unknown",
    result: cleanText(row.result_status, 32) ?? "unknown",
    reason: exportSafeText(row.reason, 220),
    createdAt: cleanText(row.created_at, 64) ?? "",
  };
}

function buildCommunitySourceAuditCsv(
  rows: Array<{ auditRef: string; candidateRef: string | null; action: string; result: string; reason: string | null; createdAt: string }>,
  filters: { action: string; result: string; linkedServerId: string },
  generatedAt: string,
) {
  const header = ["exported_at", "export_safe", "server_ref", "filter_action", "filter_result", "audit_ref", "candidate_ref", "action", "result", "reason", "created_at"];
  const lines = rows.map((row) => [
    generatedAt,
    "true",
    exportSafeRef(filters.linkedServerId) ?? "server",
    filters.action,
    filters.result,
    row.auditRef,
    row.candidateRef ?? "",
    row.action,
    row.result,
    row.reason ?? "",
    row.createdAt,
  ]);
  return [header.map(csvCell).join(","), ...lines.map((line) => line.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const formulaSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(formulaSafe) ? `"${formulaSafe.replaceAll("\"", "\"\"")}"` : formulaSafe;
}

function exportSafeText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength);
  return text?.replace(/\b\d{5,32}\b/g, "[identifier]")
    .replace(/\b(?:admin|owner|player|user|usr)[_-][a-z0-9][a-z0-9_-]*\b/gi, "[identifier]") ?? null;
}

function exportSafeRef(value: unknown) {
  const text = cleanText(value, 96);
  if (!text) return null;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ref-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cleanDiscordId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{17,32}$/.test(text) ? text : null;
}

function cleanId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[a-zA-Z0-9-]{8,80}$/.test(text) ? text : null;
}

function cleanText(value: unknown, maxLength: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.slice(0, maxLength) || null;
}

function maskDiscordId(value: string | null) {
  if (!value) return null;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
