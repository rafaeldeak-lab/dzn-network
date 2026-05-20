import { importAdmTextForServer } from "../../../../_lib/adm-sync";
import { getSessionUser } from "../../../../_lib/db";
import { json, methodNotAllowed, readJson } from "../../../../_lib/http";
import { requireServerOwnerOrDznAdmin } from "../../../../_lib/public-cache";
import type { PagesFunction } from "../../../../_lib/types";

type ManualAdmImportBody = {
  filename?: string;
  admText?: string;
  source?: string;
};

export const onRequestPost: PagesFunction = async ({ request, env, params }) => {
  const linkedServerId = sanitizeLinkedServerId(params.serverId);
  if (!linkedServerId) return json({ error: "Invalid server id" }, { status: 400 });

  const user = await getSessionUser(env, request);
  const access = await requireServerOwnerOrDznAdmin(env, user, linkedServerId);
  if (!access.allowed) {
    return json(
      { error: access.reason === "not_found" ? "Server not found" : "Forbidden" },
      { status: access.reason === "not_found" ? 404 : 403 },
    );
  }

  const body = await readJson<ManualAdmImportBody>(request);
  const filename = typeof body.filename === "string" ? body.filename : "";
  const admText = typeof body.admText === "string" ? body.admText : "";
  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "manual_paste";

  if (!filename.trim()) return json({ error: "ADM filename is required." }, { status: 400 });
  if (!admText.trim()) return json({ error: "ADM text is required." }, { status: 400 });

  try {
    const result = await importAdmTextForServer(env, {
      linkedServerId,
      filename,
      admText,
      source,
    });
    return json(result, {
      headers: {
        "cache-control": "private, no-store, no-cache, must-revalidate",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to import ADM text." }, { status: 400 });
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
