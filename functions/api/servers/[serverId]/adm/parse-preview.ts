import { previewManualAdmText } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

type ManualAdmPreviewBody = {
  filename?: string;
  admText?: string;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  try {
    const linkedServerId = sanitizeLinkedServerId(params.serverId);
    if (!linkedServerId) return previewError(400, "invalid_server_id", "Invalid server id.");

    const user = await getSessionUser(env, request);
    const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
    if (!access.allowed) {
      return previewError(
        access.reason === "not_found" ? 404 : 403,
        access.reason === "not_found" ? "server_not_found" : "forbidden",
        access.reason === "not_found" ? "Server not found." : "Forbidden.",
      );
    }

    const body = await readJson<ManualAdmPreviewBody>(request);
    const filename = typeof body.filename === "string" ? body.filename : "";
    const admText = typeof body.admText === "string" ? body.admText : "";
    if (!filename.trim()) return previewError(400, "missing_filename", "ADM filename is required.");
    if (!admText.trim()) return previewError(400, "missing_adm_text", "ADM text is required.");

    return json(previewManualAdmText({ filename, admText }), {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return previewError(500, "manual_adm_parse_preview_failed", "Unable to preview ADM text.", {
      error: error instanceof Error ? error.message : String(error),
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

function sanitizeLinkedServerId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value) ? value : null;
}

function previewError(status: number, errorCode: string, message: string, details: unknown = null) {
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
