import { requireDb } from "./db";
import type { Env, SessionUser } from "./types";

export type CommunityCandidateAction = "import" | "reject";

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

export async function listCommunityMemberSourceQueue(env: Env, linkedServerId: string) {
  const db = requireDb(env);
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
       LEFT JOIN users ON users.discord_id = candidates.candidate_discord_id
       LEFT JOIN player_public_profiles ON player_public_profiles.user_id = users.id
       LEFT JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
       LEFT JOIN server_community_members existing_members
              ON existing_members.linked_server_id = candidates.linked_server_id
             AND existing_members.user_id = users.id
       WHERE candidates.linked_server_id = ?
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
    ).bind(linkedServerId, linkedServerId).all<CandidateRow>(),
    db.prepare(
      `SELECT id, candidate_id, action, result_status, reason, created_at
       FROM server_community_member_source_audit
       WHERE linked_server_id = ?
       ORDER BY created_at DESC
       LIMIT 100`,
    ).bind(linkedServerId).all<Record<string, unknown>>(),
  ]);
  return {
    candidates: (candidates.results ?? []).map(toCandidatePayload),
    audit: audit.results ?? [],
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
       LIMIT 1`,
    ).bind(linkedServerId, discordId).first<{ id: string }>();
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
         ON CONFLICT DO NOTHING`,
      ).bind(candidateId, linkedServerId, linkedServerId, discordId, candidateUsername, roleLabel, linkedServerId, linkedServerId, duplicateReason, pendingReason, actor.id, actor.discord_id, now, now, matched.id, discordId)
    : db.prepare(
        `INSERT INTO server_community_member_candidates (
           id, linked_server_id, candidate_discord_id, candidate_username, role_label,
           status, matched_user_id, reason, created_by_user_id, created_at, updated_at
         ) SELECT ?, ?, NULL, ?, ?, 'no_match', NULL, ?,
                  (SELECT id FROM users WHERE id = ? AND discord_id = ?), ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE discord_id = ?)
         ON CONFLICT DO NOTHING`,
      ).bind(candidateId, linkedServerId, candidateUsername, roleLabel, noMatchReason, actor.id, actor.discord_id, now, now, discordId);
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
  const saved = await db.prepare("SELECT status, reason FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
    .bind(candidateId, linkedServerId).first<{ status: CandidateRow["status"]; reason: string | null }>();
  if (!saved) {
    const concurrentPending = matched && !existing
      ? await db.prepare(
          `SELECT id FROM server_community_member_candidates
           WHERE linked_server_id = ? AND candidate_discord_id = ? AND status = 'pending'
           LIMIT 1`,
        ).bind(linkedServerId, discordId).first<{ id: string }>()
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
                 WHERE linked_server_id = ? AND matched_user_id = users.id
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1
              ) AS latest_status
         FROM users
        WHERE users.discord_id = ?
        LIMIT 1`,
    ).bind(linkedServerId, linkedServerId, discordId).first<{ id: string; member_exists: number; latest_status: CandidateRow["status"] | null }>();
    if (currentMatch?.member_exists) {
      return { ok: true as const, status: 200, candidate_status: "duplicate" as const, message: "That DZN account is already in this server directory." };
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
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE discord_id = ?)`,
      ).bind(candidateId, linkedServerId, candidateUsername, roleLabel, deletedReason, actor.id, actor.discord_id, now, now, discordId),
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
    const noMatchSaved = await db.prepare("SELECT status FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
      .bind(candidateId, linkedServerId).first<{ status: string }>();
    return noMatchSaved?.status === "no_match"
      ? { ok: true as const, status: 201, candidate_status: "no_match" as const, message: deletedReason }
      : { ok: false as const, status: 409, error: "SOURCE_STATE_CHANGED", message: "The account source state changed while it was being queued. Refresh and try again." };
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
  const candidate = await db.prepare(
    `SELECT candidates.id, candidates.candidate_discord_id, candidates.role_label,
            candidates.status, users.id AS matched_user_id, player_public_profiles.handle,
            player_profile_privacy_preferences.public_profile_enabled
     FROM server_community_member_candidates candidates
     LEFT JOIN users ON users.discord_id = candidates.candidate_discord_id
     LEFT JOIN player_public_profiles ON player_public_profiles.user_id = users.id AND player_public_profiles.status = 'active'
     LEFT JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = users.id
     WHERE candidates.id = ? AND candidates.linked_server_id = ?
     LIMIT 1`,
  ).bind(id, linkedServerId).first<{
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
         SET status = 'rejected', reason = ?,
             reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
             decision_nonce = ?, updated_at = ?
         WHERE id = ? AND linked_server_id = ? AND status = 'pending'`,
      ).bind(reason ?? "Rejected by the server owner.", actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId),
      conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_rejected", result: "rejected", reason: reason ?? "Rejected by the server owner.", now, status: "rejected", decisionNonce }),
    ]);
    const rejected = await db.prepare("SELECT status, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
      .bind(id, linkedServerId).first<{ status: string; decision_nonce: string | null }>();
    return rejected?.status === "rejected" && rejected.decision_nonce === decisionNonce
      ? { ok: true as const, status: 200, message: "Candidate rejected and recorded." }
      : { ok: true as const, status: 200, message: `Candidate was already decided as ${rejected?.status ?? "unavailable"} by another request.` };
  }
  if (candidate.matched_user_id) {
    const existingMember = await db.prepare(
      "SELECT id FROM server_community_members WHERE linked_server_id = ? AND user_id = ? LIMIT 1",
    ).bind(linkedServerId, candidate.matched_user_id).first<{ id: string }>();
    if (existingMember) {
      const duplicateReason = "That DZN account is already in this server directory. The existing member was not changed.";
      await db.batch([
        db.prepare(
          `UPDATE server_community_member_candidates
           SET status = 'duplicate', reason = ?,
               reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
               decision_nonce = ?, updated_at = ?
           WHERE id = ? AND linked_server_id = ? AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM server_community_members
                WHERE linked_server_id = ? AND user_id = ?
             )`,
        ).bind(duplicateReason, actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, linkedServerId, candidate.matched_user_id),
        conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_duplicate", result: "skipped", reason: duplicateReason, now, status: "duplicate", decisionNonce }),
      ]);
      const duplicate = await db.prepare("SELECT status, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
        .bind(id, linkedServerId).first<{ status: string; decision_nonce: string | null }>();
      return duplicate?.status === "duplicate" && duplicate.decision_nonce === decisionNonce
        ? { ok: true as const, status: 200, message: duplicateReason }
        : { ok: true as const, status: 200, message: `Candidate was already decided as ${duplicate?.status ?? "unavailable"} by another request.` };
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
          AND NOT EXISTS (
            SELECT 1 FROM server_community_members members
             WHERE members.linked_server_id = ? AND members.user_id = ?
          )`,
    ).bind(memberId, linkedServerId, candidate.role_label, actor.id, actor.discord_id, now, now, candidate.matched_user_id, id, linkedServerId, linkedServerId, candidate.matched_user_id),
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
  const imported = await db.prepare("SELECT status, imported_member_id, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
    .bind(id, linkedServerId).first<{ status: string; imported_member_id: string | null; decision_nonce: string | null }>();
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
           SELECT 1 FROM server_community_members
            WHERE linked_server_id = ? AND user_id = ?
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
         ) AS eligible`,
    ).bind(
      linkedServerId, candidate.matched_user_id,
      candidate.matched_user_id, id, linkedServerId,
      candidate.matched_user_id, id, linkedServerId,
    ).first<{ member_exists: number; identity_current: number; eligible: number }>();

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
             )`,
        ).bind(noMatchReason, actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId),
        conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_no_match", result: "skipped", reason: noMatchReason, now, status: "no_match", decisionNonce }),
      ]);
      const noMatch = await db.prepare("SELECT status, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
        .bind(id, linkedServerId).first<{ status: string; decision_nonce: string | null }>();
      if (noMatch?.status === "no_match" && noMatch.decision_nonce === decisionNonce) {
        return { ok: true as const, status: 200, message: noMatchReason };
      }
    }

    if (!currentState?.eligible) {
      return {
        ok: true as const,
        status: 200,
        message: "Candidate remains pending because the player's public-profile eligibility changed. Refresh and retry after the player restores it.",
      };
    }

    const duplicateReason = "That DZN account is already in this server directory. The existing member was not changed.";
    if (currentState.member_exists) {
      await db.batch([
        db.prepare(
          `UPDATE server_community_member_candidates
           SET status = 'duplicate', reason = ?,
               reviewed_by_user_id = (SELECT id FROM users WHERE id = ? AND discord_id = ?), reviewed_at = ?,
               decision_nonce = ?, updated_at = ?
           WHERE id = ? AND linked_server_id = ? AND status = 'pending'
             AND EXISTS (
               SELECT 1 FROM server_community_members
                WHERE linked_server_id = ? AND user_id = ?
             )`,
        ).bind(duplicateReason, actor.id, actor.discord_id, now, decisionNonce, now, id, linkedServerId, linkedServerId, candidate.matched_user_id),
        conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, actorId: actor.id, actorDiscordId: actor.discord_id, action: "candidate_duplicate", result: "skipped", reason: duplicateReason, now, status: "duplicate", decisionNonce }),
      ]);
      const duplicate = await db.prepare("SELECT status, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
        .bind(id, linkedServerId).first<{ status: string; decision_nonce: string | null }>();
      if (duplicate?.status === "duplicate" && duplicate.decision_nonce === decisionNonce) {
        return { ok: true as const, status: 200, message: duplicateReason };
      }
    }

    return { ok: true as const, status: 200, message: "Candidate remains pending because eligibility changed during import. Refresh and retry." };
  }
  return { ok: true as const, status: 200, message: "Candidate imported privately. The player must approve the directory invitation." };
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

function toCandidatePayload(row: CandidateRow) {
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
    has_existing_member: Boolean(row.existing_member_id),
    can_import: row.status === "pending"
      && (Boolean(row.existing_member_id) || (
        Boolean(row.matched_user_id && row.public_handle)
        && row.public_profile_status === "active"
        && row.public_profile_enabled === 1
      )),
  };
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
