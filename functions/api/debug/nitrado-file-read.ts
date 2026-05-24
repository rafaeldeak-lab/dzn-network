import { requireCronSecret } from "../../_lib/cron-auth";
import { requireDb } from "../../_lib/db";
import { json, readJson } from "../../_lib/http";
import { sanitizeResponseExcerpt } from "../../_lib/nitrado-diagnostics";
import type { Env, PagesFunction } from "../../_lib/types";

type DebugNitradoFileReadBody = {
  serviceId?: string;
  serverId?: string;
  filePath?: string;
};

type DiagnosticAttemptRow = {
  method: string;
  endpoint_kind: string;
  attempt_number: number | null;
  status: string;
  http_status: number | null;
  http_status_text: string | null;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string | null;
};

export const onRequestPost: PagesFunction = async (context) => {
  const unauthorized = requireCronSecret(context.request, context.env);
  if (unauthorized) return unauthorized;

  const body = await readJson<DebugNitradoFileReadBody>(context.request);
  const serviceId = sanitizeServiceId(body.serviceId);
  const filePath = sanitizeFilePath(body.filePath);
  if (!serviceId || !filePath) {
    return json({ ok: false, error: "invalid_request", message: "serviceId and filePath are required." }, { status: 400 });
  }

  const db = requireDb(context.env);
  const linkedServer = await resolveLinkedServer(context.env, serviceId, body.serverId);
  if (!linkedServer) {
    return json({ ok: false, error: "server_not_found", message: "No linked server found for that Nitrado service id." }, { status: 404 });
  }

  try {
    const token = await getNitradoTokenForDebug(context.env, linkedServer.id, linkedServer.user_id);
    const { latestAdmFileReadDiagnostic, readAdmFileTextWithFallback } = await import("../../_lib/nitrado");
    const startedAt = new Date(Date.now() - 1000).toISOString();
    const filename = filePath.split("/").filter(Boolean).at(-1) ?? filePath;
    const read = await readAdmFileTextWithFallback({
      token,
      serviceId,
      fileName: filename,
      originalPath: filePath,
      options: {
        mode: "full",
        fullDownloadFallback: true,
        maxPathVariants: 1,
        maxTokenizedAttempts: 1,
        maxChunkedReadChunks: 4,
        diagnostics: {
          db,
          serverId: linkedServer.id,
          serviceId,
          fileName: filename,
          filePath,
          budget: {
            maxRows: 8,
            rowsRecorded: 0,
          },
        },
      },
    });

    const attempts = await db
      .prepare(
        `SELECT method, endpoint_kind, attempt_number, status, http_status, http_status_text,
                error_code, error_message, duration_ms, created_at
         FROM nitrado_file_read_attempts
         WHERE service_id = ?
           AND (file_name = ? OR file_path = ?)
           AND created_at >= ?
         ORDER BY created_at ASC`,
      )
      .bind(serviceId, filename, filePath, startedAt)
      .all<DiagnosticAttemptRow>();

    const rows = attempts.results ?? [];
    const seek = rows.find((row) => row.endpoint_kind === "nitrado_seek") ?? null;
    const download = rows.find((row) => row.endpoint_kind === "nitrado_download") ?? null;
    const tokenizedAttempts = rows.filter((row) => row.endpoint_kind === "tokenized_url").map(formatAttempt);
    const latest = latestAdmFileReadDiagnostic(read);

    console.log("DZN NITRADO LOG DOWNLOAD ATTEMPTED", {
      serviceId,
      filePath,
      ok: read.ok,
      latestError: latest?.message ?? null,
    });

    return json({
      ok: read.ok,
      serviceId,
      serverId: linkedServer.id,
      filePath,
      seek: seek ? formatAttempt(seek) : null,
      download: download ? formatAttempt(download) : null,
      tokenizedAttempts,
      latestDiagnostic: latest,
      textLength: read.text?.length ?? 0,
      textPreview: read.ok ? sanitizeResponseExcerpt(read.text?.slice(0, 500), 500) : null,
    });
  } catch (error) {
    return json({
      ok: false,
      serviceId,
      serverId: linkedServer.id,
      filePath,
      error: "nitrado_file_read_debug_failed",
      message: sanitizeResponseExcerpt(error instanceof Error ? error.message : "Nitrado file read diagnostic failed.", 500),
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

function formatAttempt(row: DiagnosticAttemptRow) {
  return {
    method: row.method,
    endpointKind: row.endpoint_kind,
    attemptNumber: row.attempt_number ?? 1,
    status: row.status,
    httpStatus: row.http_status,
    httpStatusText: row.http_status_text,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

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

function sanitizeFilePath(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 500 || !/\.adm$/i.test(text) || text.includes("\0")) return null;
  return text.replace(/^\/+/, "");
}
