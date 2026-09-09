import type { PlayerGameIdentityStatus } from "./player-game-identities";

export type PlayerSupportRequest = {
  id: string; user_id: string; discord_id: string; account_name: string | null;
  linked_server_id: string; server_name: string | null; server_status: string | null;
  owner_user_id: string | null; owner_name: string | null; guild_id: string | null;
  player_profile_id: string; player_id: string; player_name: string | null;
  status: PlayerGameIdentityStatus; requested_at: string; reviewed_at: string | null;
  reviewer_id: string | null; reviewer_name: string | null; review_note: string | null;
  imported_profile_present: number; active_link_id: string | null;
};
export type PlayerSupportEvent = {
  id: string; action: string; result: string; actor_user_id: string | null; actor_name: string | null;
  note: string | null; link_id: string | null; created_at: string;
};
export type PlayerSupportList = { ok: true; items: PlayerSupportRequest[]; nextCursor: string | null };
export type PlayerSupportDetail = { ok: true; request: PlayerSupportRequest; history: PlayerSupportEvent[]; nextCursor: string | null };

const statuses = new Set(["pending", "approved", "rejected", "cancelled"]);
const requestColumns = `c.id, c.user_id, c.discord_id, u.username AS account_name,
  c.linked_server_id, COALESCE(NULLIF(s.display_name,''), NULLIF(s.hostname,''), s.server_name, s.nitrado_service_name) AS server_name,
  s.status AS server_status, s.user_id AS owner_user_id, owner.username AS owner_name, s.guild_id,
  c.player_profile_id, c.player_id, c.player_name, c.status, c.requested_at, c.reviewed_at,
  c.reviewed_by_user_id AS reviewer_id, reviewer.username AS reviewer_name, c.review_note,
  EXISTS (SELECT 1 FROM player_profiles p WHERE p.id = c.player_profile_id
    AND p.linked_server_id = c.linked_server_id AND p.player_id = c.player_id) AS imported_profile_present,
  (SELECT l.id FROM player_game_identity_links l WHERE l.linked_server_id = c.linked_server_id
    AND l.player_profile_id = c.player_profile_id AND l.player_id = c.player_id AND l.user_id = c.user_id
    AND l.discord_id = c.discord_id AND l.status = 'active' AND l.revoked_at IS NULL LIMIT 1) AS active_link_id`;
const requestJoins = `FROM player_game_identity_claims c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN linked_servers s ON s.id = c.linked_server_id
  LEFT JOIN users owner ON owner.id = s.user_id
  LEFT JOIN users reviewer ON reviewer.id = c.reviewed_by_user_id`;

export async function readPlayerRequestSupport(db: D1Database, params: URLSearchParams): Promise<PlayerSupportList | PlayerSupportDetail | { ok: false; status: 400 | 404; message: string }> {
  const requestId = params.get("request");
  const search = (params.get("q") ?? "").trim();
  const status = params.get("status") ?? "";
  const cursor = decodeCursor(params.get("cursor"));
  if (search.length > 100 || (status && !statuses.has(status)) || cursor === false
    || (requestId !== null && !/^[A-Za-z0-9_-]{1,96}$/.test(requestId))) {
    return { ok: false, status: 400, message: "Invalid request filters." };
  }
  if (requestId) {
    const request = await db.prepare(`SELECT ${requestColumns} ${requestJoins} WHERE c.id = ? LIMIT 1`)
      .bind(requestId).first<PlayerSupportRequest>();
    if (!request) return { ok: false, status: 404, message: "Request not found." };
    const bindings: unknown[] = [requestId];
    const cursorSql = cursor ? "AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))" : "";
    if (cursor) bindings.push(cursor.at, cursor.at, cursor.id);
    const result = await db.prepare(`SELECT a.id, a.action, a.result, a.actor_user_id, actor.username AS actor_name,
      a.note, a.link_id, a.created_at FROM player_game_identity_audit_log a
      LEFT JOIN users actor ON actor.id = a.actor_user_id
      WHERE a.claim_id = ? ${cursorSql} ORDER BY a.created_at DESC, a.id DESC LIMIT 51`)
      .bind(...bindings).all<PlayerSupportEvent>();
    const rows = result.results ?? [];
    return { ok: true, request: safeRequest(request), history: rows.slice(0, 50).map(row => ({ ...row, actor_name: safeText(row.actor_name), note: safeText(row.note) })),
      nextCursor: rows.length > 50 ? encodeCursor(rows[49].created_at, rows[49].id) : null };
  }
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (status) { clauses.push("c.status = ?"); bindings.push(status); }
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const searchColumns = ["c.id", "c.user_id", "c.discord_id", "c.player_id", "c.player_name", "c.linked_server_id", "s.guild_id",
      "s.server_name", "s.display_name", "s.hostname", "s.nitrado_service_name", "u.username"];
    clauses.push(`(${searchColumns
      .map(column => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    bindings.push(...Array(searchColumns.length).fill(pattern));
  }
  if (cursor) { clauses.push("(c.requested_at < ? OR (c.requested_at = ? AND c.id < ?))"); bindings.push(cursor.at, cursor.at, cursor.id); }
  const result = await db.prepare(`SELECT ${requestColumns} ${requestJoins}
    ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY c.requested_at DESC, c.id DESC LIMIT 26`)
    .bind(...bindings).all<PlayerSupportRequest>();
  const rows = result.results ?? [];
  return { ok: true, items: rows.slice(0, 25).map(safeRequest),
    nextCursor: rows.length > 25 ? encodeCursor(rows[24].requested_at, rows[24].id) : null };
}

function safeRequest(row: PlayerSupportRequest): PlayerSupportRequest {
  return { ...row, account_name: safeText(row.account_name), server_name: safeText(row.server_name),
    owner_name: safeText(row.owner_name), player_name: safeText(row.player_name),
    reviewer_name: safeText(row.reviewer_name), review_note: safeText(row.review_note) };
}

function safeText(value: string | null) {
  if (!value) return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/(?:Bearer\s+\S+|(?:sk|rk)_(?:live|test)_\S+|whsec_\S+)/gi, "[redacted]")
    .replace(/\b(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[link withheld]").slice(0, 500);
}

function encodeCursor(at: string, id: string) { return btoa(JSON.stringify({ at, id })); }
function decodeCursor(value: string | null): { at: string; id: string } | null | false {
  if (!value) return null;
  if (value.length > 512) return false;
  try {
    const parsed = JSON.parse(atob(value)) as { at?: unknown; id?: unknown };
    if (typeof parsed.at !== "string" || !/^\d{4}-\d{2}-\d{2}[T ][\d:.Z+-]{5,25}$/.test(parsed.at)
      || typeof parsed.id !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(parsed.id)) return false;
    return { at: parsed.at, id: parsed.id };
  } catch { return false; }
}
