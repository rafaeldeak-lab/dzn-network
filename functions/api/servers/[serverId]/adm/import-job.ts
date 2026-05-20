import { createAdmImportJobForServer, processNextAdmImportJobChunk } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

type AdmImportJobBody = {
  action?: "create" | "process";
  job_id?: string;
  filename?: string;
  admText?: string;
  source?: string;
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

    const body = await readJson<AdmImportJobBody>(request);
    if (body.action === "process") {
      const jobId = sanitizeJobId(body.job_id);
      if (!jobId) return admImportJobError(400, "missing_job_id", "ADM import job id is required.");
      const result = await processNextAdmImportJobChunk(env, { linkedServerId, jobId });
      return admImportJobJson(result);
    }

    const filename = typeof body.filename === "string" ? body.filename : "";
    const admText = typeof body.admText === "string" ? body.admText : "";
    if (!filename.trim()) return admImportJobError(400, "missing_filename", "ADM filename is required.");
    if (!admText.trim()) return admImportJobError(400, "missing_adm_text", "ADM text is required.");
    const result = await createAdmImportJobForServer(env, {
      linkedServerId,
      filename,
      admText,
      source: body.source ?? "manual_file_upload",
    });
    return admImportJobJson(result);
  } catch (error) {
    return admImportJobError(500, "adm_import_job_failed", "Unable to process ADM import job.", {
      error: error instanceof Error ? error.message : String(error),
      stack: isDebugRequest(request) && error instanceof Error ? error.stack : undefined,
    });
  }
};

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

function admImportJobJson(result: unknown) {
  return json(result, {
    headers: {
      "cache-control": "private, no-store, no-cache, must-revalidate",
      vary: "Cookie",
    },
  });
}

function admImportJobError(status: number, errorCode: string, message: string, details: unknown = null) {
  return json({
    ok: false,
    error_code: errorCode,
    message,
    details,
  }, {
    status,
    headers: {
      "cache-control": "private, no-store, no-cache, must-revalidate",
      vary: "Cookie",
    },
  });
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizeJobId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function isDebugRequest(request: Request) {
  try {
    return new URL(request.url).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}
