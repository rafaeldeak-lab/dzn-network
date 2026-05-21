import { ensureLinkedServerMetadataColumns, ensureMockUser, getSessionUser, requireDb } from "../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../_lib/http";
import { isMockAuth } from "../../../_lib/mock";
import { getServerCategoryLabel, normalizeServerCategory } from "../../../_lib/server-categories";
import type { Env, PagesFunction, SessionUser } from "../../../_lib/types";

type SettingsBody = {
  server_category?: unknown;
};

export const onRequest: PagesFunction = async ({ request, env, params }) => {
  if (request.method !== "PATCH") return methodNotAllowed();

  const user = await resolveUser(env, request);
  if (!user) return json({ ok: false, error: "UNAUTHORIZED", message: "Log in to update server settings." }, { status: 401 });

  const serverId = sanitizeLinkedServerId(typeof params.serverId === "string" ? params.serverId : "");
  if (!serverId) return json({ ok: false, error: "INVALID_SERVER_ID", message: "Invalid server id." }, { status: 400 });

  const body = await readJson<SettingsBody>(request);
  const normalizedCategory = normalizeServerCategory(typeof body.server_category === "string" ? body.server_category : "");
  if (!normalizedCategory) {
    return json({ ok: false, error: "INVALID_SERVER_CATEGORY", message: "Choose a valid server category." }, { status: 400 });
  }

  const db = requireDb(env);
  await ensureLinkedServerMetadataColumns(env);
  await ensureServerCategoryColumn(env);
  const server = await db
    .prepare(
      `SELECT id, user_id
       FROM linked_servers
       WHERE id = ?
         AND lower(COALESCE(status, 'pending')) != 'deleted'
         AND lower(COALESCE(status, 'pending')) != 'merged'
         AND (merged_into_server_id IS NULL OR merged_into_server_id = '')
       LIMIT 1`,
    )
    .bind(serverId)
    .first<{ id: string; user_id: string | null }>();

  if (!server) return json({ ok: false, error: "SERVER_NOT_FOUND", message: "Server not found." }, { status: 404 });
  if (server.user_id !== user.id) {
    return json({ ok: false, error: "FORBIDDEN", message: "You do not have access to this server." }, { status: 403 });
  }

  await db
    .prepare("UPDATE linked_servers SET server_category = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(normalizedCategory, serverId)
    .run();

  return json({
    ok: true,
    server: {
      id: serverId,
      server_category: normalizedCategory,
      server_category_label: getServerCategoryLabel(normalizedCategory),
    },
  });
};

async function resolveUser(env: Env, request: Request): Promise<SessionUser | null> {
  const user = await getSessionUser(env, request);
  if (user || !isMockAuth(env.MOCK_AUTH)) return user;

  const mock = await ensureMockUser(env);
  return {
    id: mock.userId,
    discord_id: mock.user.id,
    username: mock.user.username,
    avatar: mock.user.avatar,
  };
}

function sanitizeLinkedServerId(value: string) {
  const trimmed = value.trim();
  return /^[a-zA-Z0-9_-]{6,80}$/.test(trimmed) ? trimmed : "";
}

async function ensureServerCategoryColumn(env: Env) {
  const db = requireDb(env);
  const rows = await db.prepare("PRAGMA table_info(linked_servers)").all<{ name: string }>();
  const names = new Set((rows.results ?? []).map((row) => row.name));
  if (!names.has("server_category")) {
    await db.prepare("ALTER TABLE linked_servers ADD COLUMN server_category TEXT").run();
  }
}
