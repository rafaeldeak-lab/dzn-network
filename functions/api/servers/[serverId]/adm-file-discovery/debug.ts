import { decryptToken } from "../../../../_lib/crypto";
import { getSessionUser, requireDb } from "../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../_lib/http";
import { debugNitradoAdmFileDiscovery } from "../../../../_lib/nitrado";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { Env, PagesFunction } from "../../../../_lib/types";

type LinkedServerDebugRow = {
  id: string;
  user_id: string;
  guild_id: string | null;
  nitrado_service_id: string | null;
  display_name: string | null;
  hostname: string | null;
  server_name: string | null;
  nitrado_service_name: string | null;
  adm_path: string | null;
};

type SavedAdmDiscoveryState = {
  newest_available_adm_filename: string | null;
  newest_available_adm_timestamp: string | null;
  newest_readable_adm_filename: string | null;
  newest_readable_adm_timestamp: string | null;
  last_processed_adm_filename: string | null;
  last_processed_adm_line: number | null;
  last_adm_discovery_check_at: string | null;
  next_adm_discovery_due_at: string | null;
  adm_discovery_status: string | null;
};

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const user = await getSessionUser(env, request);
  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    return json(
      { error: access.reason === "not_found" ? "Server not found" : "Forbidden" },
      { status: access.reason === "not_found" ? 404 : 403 },
    );
  }

  const db = requireDb(env);
  const server = await db
    .prepare(
      `SELECT id, user_id, guild_id, nitrado_service_id, display_name, hostname,
              server_name, nitrado_service_name,
              (SELECT adm_path FROM server_log_config WHERE linked_server_id = linked_servers.id LIMIT 1) AS adm_path
       FROM linked_servers
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(linkedServerId)
    .first<LinkedServerDebugRow>();

  if (!server) return json({ error: "Server not found" }, { status: 404 });
  if (!server.nitrado_service_id) return json({ error: "Selected server has no Nitrado service id." }, { status: 409 });

  const [token, state] = await Promise.all([
    getNitradoTokenForLinkedServer(env, server),
    getSavedAdmDiscoveryState(env, server),
  ]);

  const url = new URL(request.url);
  const knownLatestFile = url.searchParams.get("known_latest_file") || "DayZServer_PS4_x64_2026-05-20_06-02-03.ADM";
  const debug = await debugNitradoAdmFileDiscovery(token, server.nitrado_service_id, {
    preferredAdmFileName: state?.newest_available_adm_filename ?? state?.last_processed_adm_filename ?? undefined,
    preferredAdmPath: server.adm_path,
    previousLatestAdmFileName: state?.newest_available_adm_filename ?? state?.last_processed_adm_filename ?? undefined,
    knownLatestFileName: knownLatestFile,
    sampleLimit: 12,
  });

  return json({
    ...debug,
    linked_server_id: server.id,
    server_name: debug.server_name ?? server.display_name ?? server.hostname ?? server.server_name ?? server.nitrado_service_name,
    current_saved_state: state,
  }, {
    headers: {
      "cache-control": "private, no-store, no-cache, must-revalidate",
      vary: "Cookie",
    },
  });
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "GET, OPTIONS" },
});

async function getNitradoTokenForLinkedServer(env: Env, server: { id: string; user_id: string }) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const row = await requireDb(env)
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ? AND linked_server_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(server.user_id, server.id)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();
  if (!row) throw new Error("No Nitrado token found for this linked server");
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

async function getSavedAdmDiscoveryState(env: Env, server: LinkedServerDebugRow) {
  const byGuild = server.guild_id
    ? await requireDb(env)
      .prepare(
        `SELECT newest_available_adm_filename, newest_available_adm_timestamp,
                newest_readable_adm_filename, newest_readable_adm_timestamp,
                last_adm_discovery_check_at, next_adm_discovery_due_at,
                adm_discovery_status
         FROM server_sync_state
         WHERE guild_id = ?
         LIMIT 1`,
      )
      .bind(server.guild_id)
      .first<Partial<SavedAdmDiscoveryState>>()
    : null;
  const byAdm = await requireDb(env)
    .prepare(
      `SELECT last_processed_file AS last_processed_adm_filename,
              last_processed_line AS last_processed_adm_line
       FROM adm_sync_state
       WHERE linked_server_id = ?
       LIMIT 1`,
    )
    .bind(server.id)
    .first<Partial<SavedAdmDiscoveryState>>();

  return {
    newest_available_adm_filename: byGuild?.newest_available_adm_filename ?? null,
    newest_available_adm_timestamp: byGuild?.newest_available_adm_timestamp ?? null,
    newest_readable_adm_filename: byGuild?.newest_readable_adm_filename ?? null,
    newest_readable_adm_timestamp: byGuild?.newest_readable_adm_timestamp ?? null,
    last_processed_adm_filename: byAdm?.last_processed_adm_filename ?? null,
    last_processed_adm_line: byAdm?.last_processed_adm_line ?? null,
    last_adm_discovery_check_at: byGuild?.last_adm_discovery_check_at ?? null,
    next_adm_discovery_due_at: byGuild?.next_adm_discovery_due_at ?? null,
    adm_discovery_status: byGuild?.adm_discovery_status ?? null,
  } satisfies SavedAdmDiscoveryState;
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}
