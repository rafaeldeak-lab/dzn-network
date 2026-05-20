import { getAdmImportJobProgressForServer } from "../../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../../_lib/db";
import { json, methodNotAllowed } from "../../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../../_lib/types";

export const onRequestGet: PagesFunction = async ({ request, env, params }) => {
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

    const jobId = sanitizeJobId(new URL(request.url).searchParams.get("job_id"));
    if (!jobId) return admImportJobError(400, "missing_job_id", "ADM import job id is required.");

    const job = await getAdmImportJobProgressForServer(env, { linkedServerId, jobId });
    if (!job) return admImportJobError(404, "adm_import_job_not_found", "ADM import job not found.", { jobId });
    return admImportJobJson({ ok: true, job });
  } catch (error) {
    return admImportJobError(500, "adm_import_job_status_failed", "Unable to read ADM import job status.", debugDetails(request, error));
  }
};

export const onRequestPost: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();
export const onRequestOptions: PagesFunction = () => new Response(null, { status: 204, headers: { Allow: "GET, OPTIONS" } });

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
