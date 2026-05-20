import { importAdmFilesForServer } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

type BulkAdmJsonBody = {
  files?: Array<{
    filename?: string;
    admText?: string;
  }>;
  filename?: string;
  admText?: string;
  source?: string;
  preview?: boolean;
};

type BulkAdmInputFile = {
  filename: string;
  admText: string;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return bulkAdmError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed) {
      return bulkAdmError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const url = new URL(request.url);
    const parsed = await parseBulkAdmRequest(request);
    const previewOnly = url.searchParams.get("preview") === "1" || parsed.preview === true;
    const source = sanitizeSource(parsed.source) ?? (previewOnly ? "manual_preview" : "manual_file_upload");

    if (!parsed.files.length) {
      return bulkAdmError(400, "missing_adm_files", "Upload or paste at least one ADM file.");
    }

    if (!previewOnly) {
      return bulkAdmError(400, "chunked_import_required", "ADM file imports must use chunked import jobs. The dashboard processes each selected file in small chunks to avoid Cloudflare request limits.", {
        files_accepted: parsed.files.length,
        retryable: true,
      });
    }

    const result = await importAdmFilesForServer(env, {
      linkedServerId,
      files: parsed.files,
      source,
      previewOnly,
    });

    return json(result, {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return bulkAdmError(500, "bulk_adm_import_failed", "Unable to process ADM files.", {
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

async function parseBulkAdmRequest(request: Request): Promise<{
  files: BulkAdmInputFile[];
  source?: string;
  preview?: boolean;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const form = await request.formData();
    const files: BulkAdmInputFile[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") continue;
      if (!("text" in value) || typeof value.text !== "function") continue;
      const filename = sanitizeFilename(value.name || key);
      const admText = await value.text();
      if (filename && admText.trim()) files.push({ filename, admText });
    }

    const pastedFilename = stringFormValue(form.get("filename"));
    const pastedText = stringFormValue(form.get("admText"));
    if (pastedFilename && pastedText) files.push({ filename: pastedFilename, admText: pastedText });

    return {
      files,
      source: stringFormValue(form.get("source")) ?? undefined,
      preview: parseBooleanFormValue(form.get("preview")),
    };
  }

  const body = await readJson<BulkAdmJsonBody>(request);
  const files: BulkAdmInputFile[] = [];
  for (const file of Array.isArray(body.files) ? body.files : []) {
    const filename = typeof file.filename === "string" ? file.filename : "";
    const admText = typeof file.admText === "string" ? file.admText : "";
    if (filename.trim() && admText.trim()) files.push({ filename, admText });
  }
  if (typeof body.filename === "string" && typeof body.admText === "string" && body.filename.trim() && body.admText.trim()) {
    files.push({ filename: body.filename, admText: body.admText });
  }
  return { files, source: body.source, preview: body.preview };
}

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function sanitizeFilename(value: string) {
  const trimmed = value.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  return trimmed.slice(0, 220);
}

function sanitizeSource(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function stringFormValue(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseBooleanFormValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "preview"].includes(value.trim().toLowerCase());
}

function bulkAdmError(status: number, errorCode: string, message: string, details: unknown = null) {
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

function isDebugRequest(request: Request) {
  try {
    return new URL(request.url).searchParams.get("debug") === "1";
  } catch {
    return false;
  }
}
