import { requireCronSecret } from "../../_lib/cron-auth";
import { requireDb } from "../../_lib/db";
import { json, readJson } from "../../_lib/http";
import { readNitradoAdminLogs } from "../../_lib/nitrado";
import { sanitizeResponseExcerpt } from "../../_lib/nitrado-diagnostics";
import type { Env, PagesFunction } from "../../_lib/types";

type DebugNitradoAdminLogsBody = {
  serviceId?: string;
  serverId?: string;
};

export const onRequestPost: PagesFunction = async (context) => {
  const unauthorized = requireCronSecret(context.request, context.env);
  if (unauthorized) return unauthorized;

  const body = await readJson<DebugNitradoAdminLogsBody>(context.request);
  const serviceId = sanitizeServiceId(body.serviceId);
  if (!serviceId) {
    return json({ ok: false, error: "invalid_request", message: "serviceId is required." }, { status: 400 });
  }

  const db = requireDb(context.env);
  const linkedServer = await resolveLinkedServer(context.env, serviceId, body.serverId);
  if (!linkedServer) {
    return json({ ok: false, error: "server_not_found", message: "No linked server found for that Nitrado service id." }, { status: 404 });
  }

  try {
    const token = await getNitradoTokenForDebug(context.env, linkedServer.id, linkedServer.user_id);
    const result = await readNitradoAdminLogs(serviceId, token, {
      diagnostics: {
        db,
        serverId: linkedServer.id,
        serviceId,
        fileName: "admin_logs",
        filePath: "admin_logs/current",
        budget: {
          maxRows: 2,
          rowsRecorded: 0,
        },
      },
    });

    const preview = result.logText
      ? sanitizeResponseExcerpt(result.entries.slice(0, 8).join("\n"), 500)
      : null;

    return json({
      ok: result.ok,
      serviceId,
      serverId: linkedServer.id,
      source: result.source,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      shape: result.rawShape,
      lineCount: result.lineCount,
      containsAdminLogStarted: Boolean(result.latestStartedAt),
      latestStartedAt: result.latestStartedAt,
      inferredAdmFileName: result.inferredAdmFileName,
      preview,
      errorCode: result.errorCode,
      message: result.errorMessage,
    });
  } catch (error) {
    return json({
      ok: false,
      serviceId,
      serverId: linkedServer.id,
      source: "admin_logs",
      error: "nitrado_admin_logs_debug_failed",
      message: sanitizeResponseExcerpt(error instanceof Error ? error.message : "Nitrado admin logs diagnostic failed.", 500),
    }, { status: 500 });
  }
};

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

export const onRequestGet: PagesFunction = () => json(
  { error: "Method not allowed", allowed: ["POST"] },
  { status: 405, headers: { Allow: "POST" } },
);

async function resolveLinkedServer(env: Env, serviceId: string, serverId?: string | null) {
  const db = requireDb(env);
  return db
    .prepare(
      `SELECT id, user_id, nitrado_service_id
       FROM linked_servers
       WHERE nitrado_service_id = ?
         AND (? IS NULL OR id = ?)
         AND lower(COALESCE(status, 'pending')) NOT IN ('deleted', 'merged')
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`,
    )
    .bind(serviceId, serverId ?? null, serverId ?? null)
    .first<{ id: string; user_id: string; nitrado_service_id: string }>();
}

async function getNitradoTokenForDebug(env: Env, linkedServerId: string, userId: string) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const { decryptToken } = await import("../../_lib/crypto");
  const row = await requireDb(env)
    .prepare(
      `SELECT encrypted_token, token_iv, token_auth_tag
       FROM nitrado_connections
       WHERE user_id = ? AND linked_server_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    )
    .bind(userId, linkedServerId)
    .first<{ encrypted_token: string; token_iv: string; token_auth_tag: string }>();
  if (!row) throw new Error("No Nitrado token found for this linked server");
  return decryptToken(row.encrypted_token, row.token_iv, row.token_auth_tag, env.TOKEN_ENCRYPTION_KEY);
}

function sanitizeServiceId(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[0-9]{4,20}$/.test(text) ? text : null;
}
