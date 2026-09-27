import { requireDb } from "./db";
import { isDznAdminDiscordId } from "./admin";
import { requireServerOwnerOrDznAdmin } from "./public-cache";
import type { Env, SessionUser } from "./types";

const CODE_TTL_MINUTES = 30;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function issuePlayerGameIdentityProofCode(env: Env, actor: SessionUser, claimId: string) {
  if (!isOpaqueId(claimId)) return failure(400, "INVALID_CLAIM_ID", "Invalid link request reference.");
  try {
    const db = requireDb(env);
    const claim = await db.prepare(
      `SELECT id, linked_server_id, status FROM player_game_identity_claims WHERE id = ? LIMIT 1`,
    ).bind(claimId).first<{ id: string; linked_server_id: string; status: string }>();
    if (!claim) return failure(404, "CLAIM_NOT_FOUND", "Link request not found.");
    const access = await requireServerOwnerOrDznAdmin(env, actor, claim.linked_server_id);
    if (!access.allowed) return failure(403, "FORBIDDEN", "Only this server owner or a DZN admin can issue a proof code.");
    if (claim.status !== "pending") return failure(409, "CLAIM_NOT_PENDING", "This link request is no longer pending.");
    const verified = await db.prepare(`SELECT 1 AS verified FROM player_game_identity_proof_codes WHERE claim_id = ? AND status = 'consumed' LIMIT 1`).bind(claim.id).first<{ verified: number }>();
    if (verified?.verified === 1) return failure(409, "PROOF_ALREADY_VERIFIED", "This request has already completed its one-time proof check.");

    const code = generateProofCode();
    const hash = await hashProofCode(code);
    const id = crypto.randomUUID();
    const hasGlobalAccess = isDznAdminDiscordId(env, actor.discord_id) || env.MOCK_AUTH === "1" || env.MOCK_AUTH === "true";
    const currentAccess = `EXISTS (
      SELECT 1 FROM linked_servers server
      WHERE server.id = ? AND (? = 1 OR server.user_id = ?)
        AND lower(COALESCE(server.status, 'pending')) NOT IN ('deleted', 'merged')
        AND (server.merged_into_server_id IS NULL OR server.merged_into_server_id = '')
    )`;
    const results = await db.batch([
      db.prepare(`UPDATE player_game_identity_proof_codes SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE claim_id = ? AND status = 'active' AND ${currentAccess}`)
        .bind(claim.id, claim.linked_server_id, hasGlobalAccess ? 1 : 0, actor.id),
      db.prepare(
        `INSERT INTO player_game_identity_proof_codes (id, claim_id, linked_server_id, issued_by_user_id, code_hash, status, expires_at)
         SELECT ?, ?, ?, ?, ?, 'active', datetime('now', '+${CODE_TTL_MINUTES} minutes')
         WHERE EXISTS (SELECT 1 FROM player_game_identity_claims WHERE id = ? AND status = 'pending') AND ${currentAccess}`,
      ).bind(id, claim.id, claim.linked_server_id, actor.id, hash, claim.id, claim.linked_server_id, hasGlobalAccess ? 1 : 0, actor.id),
    ]);
    if (results[1].meta.changes !== 1) return failure(409, "CLAIM_CHANGED", "This link request changed. Refresh and try again.");
    return { ok: true as const, status: 201 as const, code, expires_in_minutes: CODE_TTL_MINUTES, message: "One-time proof code created. Share it only with this requesting player." };
  } catch {
    return failure(503, "PROOF_CODES_UNAVAILABLE", "Proof codes are not available in this environment yet.");
  }
}

export async function redeemPlayerGameIdentityProofCode(env: Env, user: SessionUser, input: { claim_id?: unknown; proof_code?: unknown }) {
  const claimId = typeof input.claim_id === "string" ? input.claim_id.trim() : "";
  const code = normalizeProofCode(input.proof_code);
  if (!isOpaqueId(claimId) || !code) return failure(400, "INVALID_PROOF_CODE", "Enter the complete proof code from the server owner.");
  try {
    const db = requireDb(env);
    const hash = await hashProofCode(code);
    const result = await db.prepare(
      `UPDATE player_game_identity_proof_codes
       SET status = 'consumed', consumed_by_user_id = ?, consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE claim_id = ? AND code_hash = ? AND status = 'active' AND datetime(expires_at) > CURRENT_TIMESTAMP
         AND EXISTS (
           SELECT 1 FROM player_game_identity_claims claims
           WHERE claims.id = player_game_identity_proof_codes.claim_id
             AND claims.user_id = ? AND claims.discord_id = ? AND claims.status = 'pending'
         )`,
    ).bind(user.id, claimId, hash, user.id, user.discord_id).run();
    if (result.meta.changes !== 1) return failure(409, "PROOF_CODE_REJECTED", "That code is invalid, expired, already used, or belongs to another request.");
    return { ok: true as const, status: 200 as const, message: "Proof code accepted. The owner can now see that this request completed the one-time check." };
  } catch {
    return failure(503, "PROOF_CODES_UNAVAILABLE", "Proof codes are not available in this environment yet.");
  }
}

export async function hasPlayerGameIdentityProofCodes(db: D1Database) {
  const row = await db.prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'player_game_identity_proof_codes' LIMIT 1`).first<{ present: number }>();
  return row?.present === 1;
}

function generateProofCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  return `DZN-${value.slice(0, 4)}-${value.slice(4)}`;
}

function normalizeProofCode(value: unknown) {
  if (typeof value !== "string") return null;
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  return /^DZN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(compact) ? compact : null;
}

async function hashProofCode(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isOpaqueId(value: string) {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

function failure(status: 400 | 403 | 404 | 409 | 503, error: string, message: string) {
  return { ok: false as const, status, error, message };
}
