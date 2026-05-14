import { getReadableAdmLinesForLinkedServer, type SyncLinkedServer } from "../../_lib/adm-sync";
import { getCurrentLinkedServer, getSessionUser } from "../../_lib/db";
import { json, methodNotAllowed } from "../../_lib/http";
import { isMockNitrado } from "../../_lib/mock";
import { mockNitradoLogAccessDiagnostics } from "../../_lib/nitrado";
import type { PagesFunction } from "../../_lib/types";

export const onRequest: PagesFunction = async ({ request, env }) => {
  if (request.method !== "GET") return methodNotAllowed();

  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "Unauthorized" }, { status: 401 });

  const linkedServer = await getCurrentLinkedServer(env, user.id, { includePrivateAdmPath: true });
  if (!linkedServer) return json({ error: "No linked server found" }, { status: 400 });
  const serviceId = typeof linkedServer?.nitrado_service_id === "string" ? linkedServer.nitrado_service_id : null;
  if (!serviceId) return json({ error: "No linked Nitrado service found" }, { status: 400 });

  try {
    const diagnostics = isMockNitrado(env.MOCK_NITRADO)
      ? mockNitradoLogAccessDiagnostics(serviceId)
      : (await getReadableAdmLinesForLinkedServer(env, toSyncLinkedServer(linkedServer, user.id), { isMock: false })).diagnostics;
    if (!diagnostics) return json({ error: "Log access diagnostics unavailable" }, { status: 400 });
    return json({ diagnostics });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Log access diagnostics failed" }, { status: 400 });
  }
};

function toSyncLinkedServer(linkedServer: Record<string, unknown>, userId: string): SyncLinkedServer {
  return {
    id: String(linkedServer.id),
    user_id: typeof linkedServer.user_id === "string" ? linkedServer.user_id : userId,
    nitrado_service_id: typeof linkedServer.nitrado_service_id === "string" ? linkedServer.nitrado_service_id : null,
    adm_path: typeof linkedServer.adm_path === "string" ? linkedServer.adm_path : null,
  };
}
