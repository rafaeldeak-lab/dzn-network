import { json, methodNotAllowed } from "../../../../_lib/http";
import type { PagesFunction } from "../../../../_lib/types";

export const onRequestPost: PagesFunction = () => admImportJobError(
  410,
  "chunked_import_required",
  "Full ADM import-job requests are disabled. Use /adm/import-job/start, /adm/import-job/chunk, and /adm/import-job/finish so only small line chunks reach the Worker.",
  { retryable: true },
);

export const onRequestGet: PagesFunction = () => methodNotAllowed();
export const onRequestPut: PagesFunction = () => methodNotAllowed();
export const onRequestDelete: PagesFunction = () => methodNotAllowed();

export const onRequestOptions: PagesFunction = () => new Response(null, {
  status: 204,
  headers: { Allow: "POST, OPTIONS" },
});

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
