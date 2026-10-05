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
              candidates.role_label, candidates.status, candidates.matched_user_id,
              candidates.imported_member_id, candidates.reason, candidates.created_at,
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
       LEFT JOIN users ON users.id = candidates.matched_user_id
       LEFT JOIN player_public_profiles ON player_public_profiles.user_id = candidates.matched_user_id
       LEFT JOIN player_profile_privacy_preferences ON player_profile_privacy_preferences.user_id = candidates.matched_user_id
       WHERE candidates.linked_server_id = ?
       ORDER BY CASE candidates.status WHEN 'pending' THEN 0 ELSE 1 END,
                candidates.updated_at DESC
       LIMIT 100`,
    ).bind(linkedServerId).all<CandidateRow>(),
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
  const status = existing ? "duplicate" : matched ? "pending" : "no_match";
  const action = existing ? "candidate_duplicate" : matched ? "candidate_created" : "candidate_no_match";
  const result = matched && !existing ? "accepted" : "skipped";
  const reason = existing
    ? "That DZN account is already in this server directory."
    : matched
      ? "Exact DZN Discord account match found. Owner review is required."
      : "No DZN account currently matches that Discord user ID.";
  const candidateId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT INTO server_community_member_candidates (
         id, linked_server_id, candidate_discord_id, candidate_username, role_label,
         status, matched_user_id, reason, created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(candidateId, linkedServerId, matched && !existing ? discordId : null, cleanText(input.username, 64), cleanText(input.roleLabel, 36), status, matched?.id ?? null, reason, actor.id, now, now),
    db.prepare(
      `INSERT INTO server_community_member_source_audit (
         id, linked_server_id, candidate_id, member_user_id, actor_user_id,
         action, result_status, reason, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), linkedServerId, candidateId, matched?.id ?? null, actor.id, action, result, reason, now),
  ]);
  return { ok: true as const, status: 201, candidate_status: status, message: reason };
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
         SET status = 'rejected', reason = ?, reviewed_by_user_id = ?, reviewed_at = ?,
             decision_nonce = ?, updated_at = ?
         WHERE id = ? AND linked_server_id = ? AND status = 'pending'`,
      ).bind(reason ?? "Rejected by the server owner.", actor.id, now, decisionNonce, now, id, linkedServerId),
      conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, memberUserId: candidate.matched_user_id, actorId: actor.id, action: "candidate_rejected", result: "rejected", reason: reason ?? "Rejected by the server owner.", now, status: "rejected", decisionNonce }),
    ]);
    const rejected = await db.prepare("SELECT status, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
      .bind(id, linkedServerId).first<{ status: string; decision_nonce: string | null }>();
    return rejected?.status === "rejected" && rejected.decision_nonce === decisionNonce
      ? { ok: true as const, status: 200, message: "Candidate rejected and recorded." }
      : { ok: true as const, status: 200, message: `Candidate was already decided as ${rejected?.status ?? "unavailable"} by another request.` };
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
       ) SELECT ?, ?, ?, ?, 0, 'owner_public_handle', ?, ?, ?
         FROM server_community_member_candidates candidates
        WHERE candidates.id = ? AND candidates.linked_server_id = ? AND candidates.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM server_community_members members
             WHERE members.linked_server_id = ? AND members.user_id = ?
          )`,
    ).bind(memberId, linkedServerId, candidate.matched_user_id, candidate.role_label, actor.id, now, now, id, linkedServerId, linkedServerId, candidate.matched_user_id),
    db.prepare(
      `UPDATE server_community_member_candidates
       SET status = 'imported', matched_user_id = ?,
           imported_member_id = ?,
           reason = ?, reviewed_by_user_id = ?, reviewed_at = ?, decision_nonce = ?, updated_at = ?
       WHERE id = ? AND linked_server_id = ? AND status = 'pending'
         AND EXISTS (SELECT 1 FROM server_community_members WHERE id = ? AND linked_server_id = ? AND user_id = ?)`,
    ).bind(candidate.matched_user_id, memberId, reason ?? "Imported privately; player approval is still required.", actor.id, now, decisionNonce, now, id, linkedServerId, memberId, linkedServerId, candidate.matched_user_id),
    db.prepare(
      `INSERT INTO server_community_member_audit (
         id, linked_server_id, member_user_id, actor_user_id, action,
         role_label, public_member_enabled, created_at
       ) SELECT ?, ?, ?, ?, 'add', ?, 0, ?
         FROM server_community_member_candidates
        WHERE id = ? AND linked_server_id = ? AND status = 'imported'
          AND decision_nonce = ? AND imported_member_id = ?`,
    ).bind(crypto.randomUUID(), linkedServerId, candidate.matched_user_id, actor.id, candidate.role_label, now, id, linkedServerId, decisionNonce, memberId),
    conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, memberUserId: candidate.matched_user_id, actorId: actor.id, action: "candidate_imported", result: "accepted", reason: reason ?? "Imported privately; player approval is still required.", now, status: "imported", decisionNonce, importedMemberId: memberId }),
  ]);
  const imported = await db.prepare("SELECT status, imported_member_id, decision_nonce FROM server_community_member_candidates WHERE id = ? AND linked_server_id = ? LIMIT 1")
    .bind(id, linkedServerId).first<{ status: string; imported_member_id: string | null; decision_nonce: string | null }>();
  if (imported?.status === "imported" && (imported.imported_member_id !== memberId || imported.decision_nonce !== decisionNonce)) {
    return { ok: true as const, status: 200, message: "Candidate was already imported by another request." };
  }
  if (imported?.status !== "imported" || imported.imported_member_id !== memberId || imported.decision_nonce !== decisionNonce) {
    const duplicateReason = "That DZN account is already in this server directory. The existing member was not changed.";
    await db.batch([
      db.prepare(
        `UPDATE server_community_member_candidates
         SET status = 'duplicate', reason = ?, reviewed_by_user_id = ?, reviewed_at = ?,
             decision_nonce = ?, updated_at = ?
         WHERE id = ? AND linked_server_id = ? AND status = 'pending'`,
      ).bind(duplicateReason, actor.id, now, decisionNonce, now, id, linkedServerId),
      conditionalDecisionAuditStatement(db, { linkedServerId, candidateId: id, memberUserId: candidate.matched_user_id, actorId: actor.id, action: "candidate_duplicate", result: "skipped", reason: duplicateReason, now, status: "duplicate", decisionNonce }),
    ]);
    return { ok: true as const, status: 200, message: duplicateReason };
  }
  return { ok: true as const, status: 200, message: "Candidate imported privately. The player must approve the directory invitation." };
}

function conditionalDecisionAuditStatement(db: D1Database, input: { linkedServerId: string; candidateId: string; memberUserId: string | null; actorId: string; action: string; result: string; reason: string; now: string; status: "imported" | "rejected" | "duplicate"; decisionNonce: string; importedMemberId?: string }) {
  return db.prepare(
    `INSERT INTO server_community_member_source_audit (
       id, linked_server_id, candidate_id, member_user_id, actor_user_id,
       action, result_status, reason, created_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM server_community_member_candidates
      WHERE id = ? AND linked_server_id = ? AND status = ?
        AND decision_nonce = ?
        AND (? IS NULL OR imported_member_id = ?)`,
  ).bind(crypto.randomUUID(), input.linkedServerId, input.candidateId, input.memberUserId, input.actorId, input.action, input.result, input.reason, input.now, input.candidateId, input.linkedServerId, input.status, input.decisionNonce, input.importedMemberId ?? null, input.importedMemberId ?? null);
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
    can_import: row.status === "pending"
      && Boolean(row.matched_user_id && row.public_handle)
      && row.public_profile_status === "active"
      && row.public_profile_enabled === 1,
  };
}

function cleanDiscordId(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
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
