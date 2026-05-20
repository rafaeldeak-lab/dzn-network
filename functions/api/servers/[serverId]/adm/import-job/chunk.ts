import { processAdmImportJobLineChunk } from "../../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../../_lib/types";

type ChunkAdmImportJobBody = {
  jobId?: string;
  filename?: string;
  chunkIndex?: number;
  startLine?: number;
  lines?: string[];
  previousLines?: string[];
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return admImportJobError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed) {
      return admImportJobError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const body = await readJson<ChunkAdmImportJobBody>(request);
    const jobId = sanitizeJobId(body.jobId);
    if (!jobId) return admImportJobError(400, "missing_job_id", "ADM import job id is required.");
    const filename = typeof body.filename === "string" ? body.filename : "";
    if (!filename.trim()) return admImportJobError(400, "missing_filename", "ADM filename is required.");
    if (!Array.isArray(body.lines) || !body.lines.some((line) => typeof line === "string" && line.trim())) {
      return admImportJobError(400, "missing_chunk_lines", "ADM import chunk lines are required.");
    }

    const result = await processAdmImportJobLineChunk(env, {
      linkedServerId,
      jobId,
      filename,
      chunkIndex: Number(body.chunkIndex ?? 0),
      startLine: Number(body.startLine ?? 0),
      lines: body.lines,
      previousLines: Array.isArray(body.previousLines) ? body.previousLines : [],
    });
    return admImportJobJson(result);
  } catch (error) {
    return admImportJobError(500, "adm_import_job_chunk_failed", "Unable to process ADM import chunk.", debugDetails(request, error));
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });

function admImportJobJson(result: unknown) {
  return json(result, { headers: { "cache-control": "private, no-store, no-cache, must-revalidate", vary: "Cookie" } });
}

function admImportJobError(status: number, errorCode: string, message: string, details: unknown = null) {
  return json({ ok: false, error_code: errorCode, message, details }, {
    status,
    headers: { "cache-control": "private, no-store, no-cache, must-revalidate", vary: "Cookie" },
  });
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizeJobId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function debugDetails(request: Request, error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    stack: isDebugRequest(request) && error instanceof Error ? error.stack : undefined,
  };
}

function isDebugRequest(request: Request) {
  try {
    return new URL(request.url).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}
