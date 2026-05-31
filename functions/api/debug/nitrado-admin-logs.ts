import { requireCronSecret } from "../../_lib/cron-auth";
import { json, readJson } from "../../_lib/http";
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

  const db = await requireAuthenticatedDb(context.env);
  const linkedServer = await resolveLinkedServer(context.env, serviceId, body.serverId);
  if (!linkedServer) {
    return json({ ok: false, error: "server_not_found", message: "No linked server found for that Nitrado service id." }, { status: 404 });
  }

  try {
    const token = await getNitradoTokenForDebug(context.env, linkedServer.id, linkedServer.user_id);
    const { readNitradoAdminLogs } = await import("../../_lib/nitrado");
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

export const onRequestOptions: PagesFunction = ({ request, env }) => {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  return new Response(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS" },
  });
};

export const onRequestGet: PagesFunction = (context) => authenticatedMethodNotAllowed(context);

async function resolveLinkedServer(env: Env, serviceId: string, serverId?: string | null) {
  const db = await requireAuthenticatedDb(env);
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
  const db = await requireAuthenticatedDb(env);
  const row = await db
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

async function requireAuthenticatedDb(env: Env) {
  const { requireDb } = await import("../../_lib/db");
  return requireDb(env);
}

function authenticatedMethodNotAllowed({ request, env }: Parameters<PagesFunction>[0]) {
  const unauthorized = requireCronSecret(request, env);
  if (unauthorized) return unauthorized;
  return json(
    { error: "Method not allowed", allowed: ["POST"] },
    { status: 405, headers: { Allow: "POST" } },
  );
}

function sanitizeServiceId(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[0-9]{4,20}$/.test(text) ? text : null;
}

function sanitizeResponseExcerpt(value: unknown, maxLength = 500) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer REDACTED")
    .replace(/(token|access_token|authorization|signature|sig|secret|key)=([^&\s]+)/gi, "$1=REDACTED")
    .replace(/[A-Za-z0-9._~+/=-]{80,}/g, "REDACTED")
    .slice(0, maxLength);
}
