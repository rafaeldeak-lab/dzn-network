import { getSessionUser, requireDb } from "./db";
import type { Env, SessionUser } from "./types";

export type OwnerDiscordAccessStatus = "pending" | "approved" | "rejected" | "revoked";
type AccessRequestInput = { linkedServerId?: unknown; note?: unknown };
type AccessDecisionInput = { requestId?: unknown; action?: unknown; reason?: unknown; decisionNonce?: unknown };
const OWNER_ACCESS_PAGE_SIZE = 50;

export function isOwnerDiscordAccessEnabled(env: Env) {
  return env.DZN_OWNER_DISCORD_ACCESS_ENABLED?.trim().toLowerCase() === "true";
}

export async function getOwnerDiscordAccessApplicant(env: Env, request: Request) {
  const user = await getSessionUser(env, request);
  if (!user) return { ok: false as const, status: 401, message: "Log in with Discord to request DZN server-owner access." };
  if (!(await hasAccessSchema(env))) return unavailable();
  const db = requireDb(env);
  const [servers, requests] = await Promise.all([
    db.prepare(`SELECT id, COALESCE(NULLIF(display_name, ''), NULLIF(hostname, ''), NULLIF(server_name, ''), 'DZN server') AS server_name,
                       public_slug, status, lifecycle_status
                  FROM linked_servers
                 WHERE user_id = ?
                   AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
                   AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
                 ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
                 LIMIT 25`).bind(user.id).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, linked_server_id, linked_server_id_snapshot, server_name, request_note, status, decision_reason, reviewed_at, created_at, updated_at
                  FROM dzn_owner_discord_access_requests
                 WHERE requester_user_id = ?
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 50`).bind(user.id).all<Record<string, unknown>>(),
  ]);
  return {
    ok: true as const,
    user: { username: clean(user.username, 80) ?? "DZN member" },
    servers: (servers.results ?? []).map((row) => safeServer(row)),
    requests: (requests.results ?? []).map((row) => safeApplicantRequest(row)),
    discordAccessConfigured: false,
    delivery: "Approval is recorded here. A private Discord invite is issued only after the central server integration passes its separate permission check.",
  };
}

export async function createOwnerDiscordAccessRequest(env: Env, request: Request, rawInput: unknown) {
  const input = asObject<AccessRequestInput>(rawInput);
  const user = await getSessionUser(env, request);
  if (!user) return { ok: false as const, status: 401, message: "Log in with Discord to request DZN server-owner access." };
  if (!(await hasAccessSchema(env))) return unavailable();
  const linkedServerId = id(input.linkedServerId, 100);
  const note = clean(input.note, 400);
  if (!linkedServerId) return { ok: false as const, status: 400, message: "Choose the DZN server you own." };
  const db = requireDb(env);
  const server = await db.prepare(`SELECT id, COALESCE(NULLIF(display_name, ''), NULLIF(hostname, ''), NULLIF(server_name, ''), 'DZN server') AS server_name
                                     FROM linked_servers
                                    WHERE id = ? AND user_id = ?
                                      AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
                                      AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
                                    LIMIT 1`).bind(linkedServerId, user.id).first<{ id: string; server_name: string }>();
  if (!server) return { ok: false as const, status: 403, message: "That server is not available for your owner-access request." };
  const existing = await db.prepare(`SELECT id, linked_server_id, linked_server_id_snapshot, server_name, request_note, status, decision_reason, reviewed_at, created_at, updated_at
                                       FROM dzn_owner_discord_access_requests
                                      WHERE requester_user_id = ? AND linked_server_id = ? AND status IN ('pending', 'approved')
                                      LIMIT 1`).bind(user.id, linkedServerId).first<Record<string, unknown>>();
  if (existing) return { ok: true as const, duplicate: true, request: safeApplicantRequest(existing) };

  const now = new Date().toISOString();
  const requestId = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO dzn_owner_discord_access_requests (
        id, requester_user_id, requester_discord_id, requester_username, linked_server_id, linked_server_id_snapshot, server_name, request_note, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
        .bind(requestId, user.id, user.discord_id, clean(user.username, 100), linkedServerId, linkedServerId, clean(server.server_name, 160) ?? "DZN server", note, now, now),
      db.prepare(`INSERT INTO dzn_owner_discord_access_audit (
        id, request_id, actor_user_id, actor_discord_id, actor_username, action, previous_status, next_status, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, 'requested', NULL, 'pending', ?, ?)`)
        .bind(crypto.randomUUID(), requestId, user.id, user.discord_id, clean(user.username, 100), note, now),
    ]);
  } catch (error) {
    if (!isActiveRequestConflict(error)) throw error;
    const duplicate = await db.prepare(`SELECT id, linked_server_id, linked_server_id_snapshot, server_name, request_note, status, decision_reason, reviewed_at, created_at, updated_at
                                          FROM dzn_owner_discord_access_requests
                                         WHERE requester_user_id = ? AND linked_server_id = ? AND status IN ('pending', 'approved')
                                         LIMIT 1`).bind(user.id, linkedServerId).first<Record<string, unknown>>();
    if (duplicate) return { ok: true as const, duplicate: true, request: safeApplicantRequest(duplicate) };
    throw error;
  }
  return { ok: true as const, duplicate: false, request: safeApplicantRequest({ id: requestId, linked_server_id: linkedServerId, linked_server_id_snapshot: linkedServerId, server_name: server.server_name, request_note: note, status: "pending", decision_reason: null, reviewed_at: null, created_at: now, updated_at: now }) };
}

export async function listOwnerDiscordAccessRequests(env: Env, filters: { status?: unknown; query?: unknown; cursor?: unknown } = {}) {
  if (!(await hasAccessSchema(env))) return unavailable();
  const status = statusFilter(filters.status);
  const query = clean(filters.query, 80);
  const cursor = decodeOwnerAccessCursor(typeof filters.cursor === "string" ? filters.cursor : null);
  if (filters.cursor !== undefined && filters.cursor !== null && !cursor) return { ok: false as const, status: 400, message: "The owner-access cursor is invalid." };
  const where = ["1 = 1"];
  const values: unknown[] = [];
  const statusOrder = "CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END";
  if (status) { where.push("r.status = ?"); values.push(status); }
  if (query) {
    const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    where.push("(lower(r.server_name) LIKE lower(?) ESCAPE '\\' OR lower(COALESCE(r.requester_username, '')) LIKE lower(?) ESCAPE '\\' OR r.requester_discord_id LIKE ? ESCAPE '\\')");
    values.push(like, like, like);
  }
  where.push(`(? IS NULL OR ${statusOrder} > ? OR (${statusOrder} = ? AND (julianday(r.updated_at) < julianday(?) OR (julianday(r.updated_at) = julianday(?) AND r.id < ?))))`);
  values.push(cursor?.statusOrder ?? null, cursor?.statusOrder ?? null, cursor?.statusOrder ?? null, cursor?.updatedAt ?? null, cursor?.updatedAt ?? null, cursor?.id ?? null);
  const rows = await requireDb(env).prepare(`SELECT r.id, r.requester_discord_id, r.requester_username, r.linked_server_id, r.linked_server_id_snapshot, r.server_name,
      r.request_note, r.status, r.decision_reason, r.reviewed_by_username, r.reviewed_at, r.created_at, r.updated_at,
      u.avatar AS requester_avatar
    FROM dzn_owner_discord_access_requests r
    LEFT JOIN users u ON u.id = r.requester_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${statusOrder}, r.updated_at DESC, r.id DESC
    LIMIT ?`).bind(...values, OWNER_ACCESS_PAGE_SIZE + 1).all<Record<string, unknown>>();
  const audit = await requireDb(env).prepare(`SELECT a.id, a.request_id, a.action, a.previous_status, a.next_status, a.reason, a.actor_username, a.created_at, r.server_name
    FROM dzn_owner_discord_access_audit a JOIN dzn_owner_discord_access_requests r ON r.id = a.request_id
    ORDER BY a.created_at DESC, a.id DESC LIMIT 100`).all<Record<string, unknown>>();
  const pageRows = (rows.results ?? []).slice(0, OWNER_ACCESS_PAGE_SIZE);
  const nextCursor = (rows.results ?? []).length > OWNER_ACCESS_PAGE_SIZE && pageRows.at(-1)
    ? encodeOwnerAccessCursor(pageRows.at(-1)!)
    : null;
  return {
    ok: true as const,
    requests: pageRows.map(safeOwnerRequest),
    audit: (audit.results ?? []).map(safeAudit),
    page: { limit: OWNER_ACCESS_PAGE_SIZE, has_more: nextCursor !== null, next_cursor: nextCursor },
    discordAccessConfigured: false,
    delivery: "No invitation or role change is sent from this queue until the separate central Discord configuration is complete.",
  };
}

export async function decideOwnerDiscordAccessRequest(env: Env, actor: SessionUser, rawInput: unknown) {
  const input = asObject<AccessDecisionInput>(rawInput);
  if (!(await hasAccessSchema(env))) return unavailable();
  const requestId = id(input.requestId, 100);
  const action = input.action === "approved" || input.action === "rejected" || input.action === "revoked" ? input.action : null;
  const reason = clean(input.reason, 400);
  const decisionNonce = id(input.decisionNonce, 100);
  if (!requestId || !action || !decisionNonce) return { ok: false as const, status: 400, message: "Refresh the request and enter a decision." };
  if (!reason || reason.length < 5) return { ok: false as const, status: 400, message: "Record a clear decision reason of at least five characters." };
  const db = requireDb(env);
  const current = await db.prepare(`SELECT id, status, requester_user_id, linked_server_id
                                      FROM dzn_owner_discord_access_requests
                                     WHERE id = ?
                                     LIMIT 1`).bind(requestId).first<{ id: string; status: OwnerDiscordAccessStatus; requester_user_id: string; linked_server_id: string }>();
  if (!current) return { ok: false as const, status: 404, message: "The owner-access request was not found." };
  if (current.status === action) return { ok: true as const, duplicate: true, status: action };
  if ((action === "approved" || action === "rejected") && current.status !== "pending") return { ok: false as const, status: 409, message: "This request is no longer waiting for a decision." };
  if (action === "revoked" && current.status !== "approved") return { ok: false as const, status: 409, message: "Only an approved request can be revoked." };
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare(`UPDATE dzn_owner_discord_access_requests
                   SET status = ?, decision_reason = ?, decision_nonce = ?, reviewed_by_user_id = ?, reviewed_by_discord_id = ?, reviewed_by_username = ?, reviewed_at = ?, updated_at = ?
                 WHERE id = ? AND status = ?
                   AND (? != 'approved' OR EXISTS (
                     SELECT 1 FROM linked_servers
                      WHERE id = dzn_owner_discord_access_requests.linked_server_id
                        AND user_id = dzn_owner_discord_access_requests.requester_user_id
                        AND lower(COALESCE(status, 'pending')) = 'live'
                        AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
                        AND EXISTS (
                          SELECT 1 FROM onboarding_checks
                           WHERE onboarding_checks.linked_server_id = linked_servers.id
                             AND onboarding_checks.token_valid = 1
                             AND onboarding_checks.service_access = 1
                             AND onboarding_checks.dayz_service_detected = 1
                        )
                   ))`)
      .bind(action, reason, decisionNonce, actor.id, actor.discord_id, clean(actor.username, 100), now, now, requestId, current.status, action),
    db.prepare(`INSERT INTO dzn_owner_discord_access_audit (
      id, request_id, actor_user_id, actor_discord_id, actor_username, action, previous_status, next_status, reason, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE changes() = 1`)
      .bind(crypto.randomUUID(), requestId, actor.id, actor.discord_id, clean(actor.username, 100), action, current.status, action, reason, now),
  ]);
  if (Number(result[0]?.meta?.changes ?? 0) !== 1 || Number(result[1]?.meta?.changes ?? 0) !== 1) return { ok: false as const, status: 409, message: "This request changed while you were reviewing it. Refresh and try again." };
  return { ok: true as const, duplicate: false, status: action, delivery: "The decision is recorded. No Discord invite, message, or role change has been sent because central Discord access delivery is not configured yet." };
}

async function hasAccessSchema(env: Env) {
  const db = requireDb(env);
  const rows = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('dzn_owner_discord_access_requests', 'dzn_owner_discord_access_audit')").all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name)).size === 2;
}

function unavailable() { return { ok: false as const, status: 503, message: "DZN owner Discord access is not available on this environment yet." }; }
function asObject<T>(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as T : {} as T; }
function id(value: unknown, max: number) { const text = typeof value === "string" ? value.trim() : ""; return text && text.length <= max && /^[A-Za-z0-9_-]+$/.test(text) ? text : null; }
function clean(value: unknown, max: number) { const text = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ") : ""; return text ? text.slice(0, max) : null; }
function statusFilter(value: unknown): OwnerDiscordAccessStatus | null { return value === "pending" || value === "approved" || value === "rejected" || value === "revoked" ? value : null; }
function isActiveRequestConflict(error: unknown) { return /unique constraint failed: dzn_owner_discord_access_requests\.requester_user_id, dzn_owner_discord_access_requests\.linked_server_id/i.test(error instanceof Error ? error.message : String(error)); }
function encodeOwnerAccessCursor(row: Record<string, unknown>) {
  const updatedAt = canonicalTimestamp(row.updated_at);
  const requestId = id(row.id, 100);
  const order = ownerAccessStatusOrder(row.status);
  if (!updatedAt || !requestId || order === null) return null;
  return base64UrlEncode(JSON.stringify({ v: 1, o: order, t: updatedAt, id: requestId }));
}
function decodeOwnerAccessCursor(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]{8,1024}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<{ v: number; o: number; t: string; id: string }>;
    const updatedAt = parsed.v === 1 ? canonicalTimestamp(parsed.t) : null;
    const requestId = id(parsed.id, 100);
    const statusOrder = Number.isInteger(parsed.o) && parsed.o !== undefined && parsed.o >= 0 && parsed.o <= 3 ? parsed.o : null;
    return updatedAt && requestId && statusOrder !== null ? { statusOrder, updatedAt, id: requestId } : null;
  } catch { return null; }
}
function canonicalTimestamp(value: unknown) { if (typeof value !== "string" || value.length > 40) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function ownerAccessStatusOrder(value: unknown) { const status = statusFilter(value); return status === "pending" ? 0 : status === "approved" ? 1 : status === "rejected" ? 2 : status === "revoked" ? 3 : null; }
function base64UrlEncode(value: string) { const bytes = new TextEncoder().encode(value); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function base64UrlDecode(value: string) { const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="); return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))); }
function safeServer(row: Record<string, unknown>) { return { id: String(row.id ?? ""), name: clean(row.server_name, 160) ?? "DZN server", slug: clean(row.public_slug, 120), status: clean(row.status, 60), lifecycleStatus: clean(row.lifecycle_status, 60) }; }
function safeApplicantRequest(row: Record<string, unknown>) { return { id: String(row.id ?? ""), linkedServerId: String(row.linked_server_id ?? row.linked_server_id_snapshot ?? ""), serverName: clean(row.server_name, 160) ?? "DZN server", note: clean(row.request_note, 400), status: statusFilter(row.status) ?? "pending", decisionReason: clean(row.decision_reason, 400), reviewedAt: clean(row.reviewed_at, 80), createdAt: clean(row.created_at, 80), updatedAt: clean(row.updated_at, 80) }; }
function safeOwnerRequest(row: Record<string, unknown>) { return { ...safeApplicantRequest(row), requester: { username: clean(row.requester_username, 100) ?? "Discord member", discordId: clean(row.requester_discord_id, 32), avatarUrl: avatarUrl(clean(row.requester_discord_id, 32), clean(row.requester_avatar, 128)) }, reviewedBy: clean(row.reviewed_by_username, 100) }; }
function safeAudit(row: Record<string, unknown>) { return { id: String(row.id ?? ""), requestId: String(row.request_id ?? ""), serverName: clean(row.server_name, 160) ?? "DZN server", action: clean(row.action, 40), previousStatus: statusFilter(row.previous_status), nextStatus: statusFilter(row.next_status) ?? "pending", reason: clean(row.reason, 400), actorUsername: clean(row.actor_username, 100), createdAt: clean(row.created_at, 80) }; }
function avatarUrl(discordId: string | null, avatar: string | null) { return discordId && avatar ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordId)}/${encodeURIComponent(avatar)}.webp?size=128` : null; }
