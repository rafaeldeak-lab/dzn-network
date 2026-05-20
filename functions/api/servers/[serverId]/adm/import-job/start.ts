import { startAdmImportLineJobForServer } from "../../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../../_lib/types";

type StartAdmImportJobBody = {
  filename?: string;
  totalLines?: number;
  totalChunks?: number;
  chunkSize?: number;
  source?: string;
  importHitLines?: boolean;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  let requestDetails: Record<string, unknown> = {};
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

    const body = await readJson<StartAdmImportJobBody>(request);
    const filename = typeof body.filename === "string" ? body.filename : "";
    if (!filename.trim()) return admImportJobError(400, "missing_filename", "ADM filename is required.");
    const totalLines = Number(body.totalLines ?? 0);
    if (!Number.isFinite(totalLines) || totalLines <= 0) return admImportJobError(400, "missing_total_lines", "ADM total line count is required.");
    requestDetails = {
      filename,
      totalLines,
      totalChunks: Number(body.totalChunks ?? 0),
      chunkSize: Number(body.chunkSize ?? 10),
      source: body.source ?? "manual_file_upload",
    };

    const result = await startAdmImportLineJobForServer(env, {
      linkedServerId,
      filename,
      totalLines,
      totalChunks: Number(body.totalChunks ?? 0),
      chunkSize: Number(body.chunkSize ?? 10),
      source: body.source ?? "manual_file_upload",
      importHitLines: body.importHitLines === true,
    });
    return admImportJobJson(result);
  } catch (error) {
    return admImportJobError(500, "adm_import_job_start_failed", "Unable to start ADM import job.", {
      ...requestDetails,
      ...debugDetails(request, error),
    });
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
